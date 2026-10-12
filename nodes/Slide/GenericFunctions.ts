import type {
	JsonObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	IHttpRequestMethods,
	IDataObject,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

type SlideContext =
	| IExecuteFunctions
	| IHookFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions;

/**
 * Single entry point for every Slide API call.
 *
 * The Authorization header comes from the credential's `authenticate` block, so
 * it is attached centrally and cannot be forgotten by a new request.
 */
export async function slideApiRequest(
	this: SlideContext,
	method: IHttpRequestMethods,
	resource: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const credentials = await this.getCredentials('slideApi');
	const baseUrl = ((credentials.baseUrl as string) || 'https://slide.synquic.com/api').replace(
		/\/$/,
		'',
	);

	const options = {
		method,
		body,
		qs,
		url: `${baseUrl}${resource}`,
		json: true,
	};

	if (!Object.keys(body).length) delete (options as IDataObject).body;
	if (!Object.keys(qs).length) delete (options as IDataObject).qs;

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'slideApi', options);
	} catch (error) {
		// NodeApiError renders Slide's own error message in the n8n UI instead of
		// a raw stack, which is the difference between "missing scope
		// whatsapp:send" and "Request failed with status code 403".
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/**
 * The event catalogue, fetched live from the API.
 *
 * Deliberately NOT hardcoded: unlike Zapier, where trigger keys must exist at
 * build time, n8n can populate a multi-select at design time. So the list a
 * user picks from is always exactly what the API supports, including events
 * added after this node was published.
 */
export async function getWebhookEvents(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const response = await slideApiRequest.call(this, 'GET', '/v1/webhooks/events');
	const events = (response?.data ?? []) as Array<{
		name: string;
		category: string;
		description: string;
	}>;

	return events.map((event) => ({
		name: `${event.category}: ${event.name}`,
		value: event.name,
		description: event.description,
	}));
}

/**
 * True when Slide refused a call because the API key lacks a permission.
 *
 * A 403 has other causes too (the key's IP allow list, a plan without API
 * access), and Slide names the cause in its message. Only the missing
 * permission is matched here, so the caller can say which permission and how
 * to get it without mislabelling the other cases.
 */
export function isMissingScopeError(error: unknown): boolean {
	const failure = (error ?? {}) as {
		httpCode?: string | number | null;
		message?: string;
		description?: string | null;
		messages?: string[];
	};
	if (String(failure.httpCode ?? '') !== '403') return false;

	const said = [failure.message, failure.description, ...(failure.messages ?? [])]
		.filter((part): part is string => typeof part === 'string')
		.join(' ');
	return /scope/i.test(said);
}

/** The longest the node waits before sending a contact write again. */
const CONTACT_RETRY_MAX_SECONDS = 5;

/**
 * How long to wait before sending a refused contact write once more, in
 * seconds, or null when it must not be sent again.
 *
 * Two answers say "send it again", both a 409 for two requests about the same
 * person that arrived together, and neither wrote anything:
 *   CONTACT_UPSERT_IN_PROGRESS  wait the seconds Slide names, then send again
 *   PHONE_IN_USE                send again once
 * Every other refusal is final. A send is never repeated on a guess: without
 * one of these two codes the answer is null.
 */
export function contactRetryDelaySeconds(error: unknown): number | null {
	const failure = (error ?? {}) as {
		httpCode?: string | number | null;
		context?: { data?: IDataObject };
	};
	if (String(failure.httpCode ?? '') !== '409') return null;

	const answered = failure.context?.data ?? {};
	if (answered.code === 'PHONE_IN_USE') return 0;
	if (answered.code === 'CONTACT_UPSERT_IN_PROGRESS') {
		const asked = Number(answered.retryAfter);
		return Number.isFinite(asked) && asked > 0 ? Math.min(asked, CONTACT_RETRY_MAX_SECONDS) : 1;
	}
	return null;
}

/** Options loader shared by the action node's template and sender pickers. */
export async function loadListOptions(
	this: ILoadOptionsFunctions,
	resource: string,
	valueKey: string,
	labelKey: string,
): Promise<INodePropertyOptions[]> {
	const response = await slideApiRequest.call(this, 'GET', resource);
	// Slide's list endpoints are not uniform: some return a bare array, others a
	// paginated { data, meta }. Accept either so a future pagination change
	// cannot silently empty a dropdown.
	const rows = Array.isArray(response) ? response : (response?.data ?? []);

	return (rows as IDataObject[]).map((row) => ({
		name: String(row[labelKey] ?? row[valueKey] ?? ''),
		value: String(row[valueKey] ?? ''),
	}));
}

/**
 * Verify the X-Slide-Signature header on an incoming delivery.
 *
 * `t` is signed alongside the body, so a captured payload cannot be re-stamped
 * as fresh; anything outside the tolerance window is rejected. The body MUST be
 * the raw bytes n8n received — re-serialising parsed JSON reorders keys and
 * changes the hash.
 */
export function verifySlideSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string,
	toleranceSeconds = 300,
): boolean {
	if (!rawBody || !signatureHeader || !secret) return false;

	let timestamp: number | null = null;
	const candidates: string[] = [];

	for (const part of signatureHeader.split(',')) {
		const index = part.indexOf('=');
		if (index === -1) continue;
		const key = part.slice(0, index).trim();
		const value = part.slice(index + 1).trim();
		if (key === 't') {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isNaN(parsed)) timestamp = parsed;
		} else if (key === 'v1') {
			// A header may carry several v1 values during a secret rotation.
			candidates.push(value);
		}
	}

	if (timestamp === null || candidates.length === 0) return false;

	// Math.abs, not a one-sided check: an n8n host whose clock runs behind
	// Slide's would otherwise reject every single delivery.
	if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) return false;

	const expected = createHmac('sha256', secret)
		.update(`${timestamp}.${rawBody}`, 'utf8')
		.digest();

	return candidates.some((candidate) => {
		let received: Buffer;
		try {
			received = Buffer.from(candidate, 'hex');
		} catch {
			return false;
		}
		// timingSafeEqual throws on a length mismatch. Hex-digest length is not
		// secret-dependent, so checking it first leaks nothing.
		if (received.length !== expected.length) return false;
		return timingSafeEqual(received, expected);
	});
}

export { NodeOperationError };

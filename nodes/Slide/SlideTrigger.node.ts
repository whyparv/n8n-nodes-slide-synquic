import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	INodePropertyOptions,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	slideApiRequest,
	getWebhookEvents,
	verifySlideSignature,
} from './GenericFunctions';

export class SlideTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Slide Trigger',
		name: 'slideTrigger',
		icon: 'file:slide.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].length + " event(s)"}}',
		description: 'Starts a workflow when something happens in your Slide account',
		defaults: { name: 'Slide Trigger' },
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'slideApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The account events that should start this workflow. Loaded live from your Slide account, so newly added events appear without updating this node. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: { loadOptionsMethod: 'getEvents' },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Verify Signature',
						name: 'verifySignature',
						type: 'boolean',
						default: true,
						description:
							'Whether to reject deliveries whose HMAC signature does not match. Your webhook URL is not a secret, so leaving this on is what stops anyone who learns the URL from injecting events into this workflow.',
					},
					{
						displayName: 'Raw Payload',
						name: 'rawPayload',
						type: 'boolean',
						default: false,
						description: 'Whether to output the full envelope (ID, type, createdAt, accountId, livemode, data) instead of flattening the event data to the top level',
					},
					{
						displayName: 'Include Test Deliveries',
						name: 'includeTest',
						type: 'boolean',
						default: true,
						description:
							'Whether to run the workflow for test deliveries sent from the Slide dashboard. Turn off in production so only real account activity triggers it.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getWebhookEvents.call(this);
			},
		},
	};

	webhookMethods = {
		default: {
			/**
			 * n8n calls this before create to avoid duplicate registrations.
			 *
			 * The endpoint is verified to still exist AND to still point at this
			 * workflow's URL — a workflow moved to a new host keeps its stored id
			 * but needs a fresh subscription, and answering "yes it exists" would
			 * leave it silently receiving nothing.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;
				if (!webhookId) return false;

				try {
					const endpoint = await slideApiRequest.call(
						this,
						'GET',
						`/v1/webhooks/${webhookId}`,
					);
					const currentUrl = this.getNodeWebhookUrl('default');
					if (endpoint?.url !== currentUrl) return false;
					return endpoint?.isActive === true && endpoint?.status === 'ACTIVE';
				} catch {
					// 404 or any read failure: treat as absent so create() runs and
					// the workflow ends up subscribed either way.
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];

				if (!events?.length) {
					throw new NodeOperationError(
						this.getNode(),
						'Select at least one event for this trigger to listen to.',
					);
				}

				const workflowName = this.getWorkflow().name ?? 'workflow';

				const endpoint = await slideApiRequest.call(this, 'POST', '/v1/webhooks', {
					url: webhookUrl,
					events,
					description: `n8n: ${workflowName}`,
				});

				if (!endpoint?.id) {
					throw new NodeOperationError(
						this.getNode(),
						'Slide did not return a webhook id. The subscription was not created.',
					);
				}

				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = endpoint.id;
				// The signing secret is returned exactly once, at creation. Storing it
				// now is the only chance — it cannot be read back later, only rotated.
				staticData.secret = endpoint.secret;

				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const webhookId = staticData.webhookId as string | undefined;
				if (!webhookId) return true;

				try {
					await slideApiRequest.call(this, 'DELETE', `/v1/webhooks/${webhookId}`);
				} catch (error) {
					// Already gone is the desired end state. Any other failure still
					// clears local state, because leaving a stale id behind would make
					// checkExists claim a subscription that no longer works.
					const status = (error as IDataObject)?.httpCode;
					if (String(status) !== '404') return false;
				} finally {
					delete staticData.webhookId;
					delete staticData.secret;
				}

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const body = this.getBodyData() as IDataObject;
		const options = this.getNodeParameter('options', {}) as IDataObject;

		const verify = options.verifySignature !== false;
		const includeTest = options.includeTest !== false;
		const raw = options.rawPayload === true;

		// ── Signature ──────────────────────────────────────────────────────────
		if (verify) {
			const staticData = this.getWorkflowStaticData('node');
			const secret = staticData.secret as string | undefined;
			const header = (request.headers['x-slide-signature'] as string) || '';

			if (!secret) {
				throw new NodeOperationError(
					this.getNode(),
					'No signing secret is stored for this trigger, so the delivery cannot be verified. Deactivate and reactivate the workflow to re-subscribe, or turn off Verify Signature.',
				);
			}

			// Verify against the RAW bytes. n8n exposes them as request.rawBody;
			// re-serialising the parsed body reorders keys and changes the hash,
			// which is the most common cause of "every delivery fails to verify".
			const rawBody =
				(request as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ??
				JSON.stringify(body);

			if (!verifySlideSignature(rawBody, header, secret)) {
				// Fail closed: an unverified payload never reaches the workflow.
				// 401 also tells Slide this was rejected rather than accepted.
				return { webhookResponse: { status: 401, body: 'invalid signature' } };
			}
		}

		// ── Test deliveries ────────────────────────────────────────────────────
		const isTest = body.livemode === false || (body.data as IDataObject)?.test === true;
		if (isTest && !includeTest) {
			// Acknowledge so Slide does not retry, but start no execution.
			return { webhookResponse: { status: 200, body: 'ok (test delivery ignored)' } };
		}

		// ── Output shape ───────────────────────────────────────────────────────
		if (raw) {
			return { workflowData: [this.helpers.returnJsonArray([body])] };
		}

		const data = (body.data as IDataObject) ?? {};
		return {
			workflowData: [
				this.helpers.returnJsonArray([
					{
						// data first so envelope metadata always wins — a payload field
						// named `id` must never shadow the event id downstream nodes
						// use for idempotency.
						...data,
						eventId: body.id,
						eventType: body.type,
						occurredAt: body.createdAt,
						accountId: body.accountId,
						livemode: body.livemode,
					},
				]),
			],
		};
	}
}

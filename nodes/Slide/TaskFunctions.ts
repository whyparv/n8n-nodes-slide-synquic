import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { slideApiRequest, isMissingScopeError } from './GenericFunctions';

/**
 * The Task and Task Board operations of the Slide node: the request each one
 * sends, and the pickers that fill its drop-downs. The fields themselves are
 * declared in TaskDescription.ts, under the same names.
 *
 * Nothing here is ever sent a second time on a guess: creating a task or a
 * comment twice would leave a duplicate that nobody asked for.
 */

const TASKS_PATH = '/v1/tasks';
const BOARDS_PATH = '/v1/task-boards';

/** The most rows Slide returns on one page of a list. */
const PAGE_SIZE_MAX = 100;
/** A stop for a list whose page count never ends. 1000 pages is 100,000 rows. */
const PAGES_MAX = 1000;

type TaskScope = 'tasks:read' | 'tasks:write' | 'tasks:delete';

const SCOPE_ACTION: Record<TaskScope, string> = {
	'tasks:read': 'read tasks',
	'tasks:write': 'create or change tasks',
	'tasks:delete': 'delete tasks',
};

/** The permission each operation needs, so a refusal can name it. */
const OPERATION_SCOPE: Record<string, Record<string, TaskScope>> = {
	task: {
		create: 'tasks:write',
		get: 'tasks:read',
		getAll: 'tasks:read',
		update: 'tasks:write',
		complete: 'tasks:write',
		delete: 'tasks:delete',
		addComment: 'tasks:write',
		getComments: 'tasks:read',
	},
	taskBoard: {
		create: 'tasks:write',
		get: 'tasks:read',
		getAll: 'tasks:read',
	},
};

/** Fields an Update can empty, and what an empty one is sent as. */
const CLEARABLE: Record<string, null | unknown[]> = {
	description: null,
	assigneeId: null,
	contactId: null,
	startDate: null,
	dueDate: null,
	labels: [],
};

/** A comma-separated string, or a list, as a clean list: no blanks, no padding. */
export function toList(value: unknown): string[] {
	const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
	return parts.map((part) => String(part).trim()).filter(Boolean);
}

/** The same, joined for a query string, or '' when there is nothing to send. */
export function toCsv(value: unknown): string {
	return toList(value).join(',');
}

/** A non-blank text, trimmed, or undefined when blank. */
function text(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	const trimmed = String(value).trim();
	return trimmed === '' ? undefined : trimmed;
}

/**
 * A date as ISO 8601 text, or undefined when blank. A value that is not a date
 * is refused here, with the field's name, rather than as a bare 400 from Slide.
 */
export function toIsoDate(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string | undefined {
	if (value instanceof Date) return value.toISOString();
	const asText = text(value);
	if (asText === undefined) return undefined;
	if (Number.isNaN(Date.parse(asText))) {
		throw new NodeOperationError(context.getNode(), `${label} is not a valid date: "${asText}"`, {
			description: 'Use ISO 8601, for example 2026-11-20 or 2026-11-20T17:30:00+05:30.',
			itemIndex,
		});
	}
	return asText;
}

/**
 * The task fields a Create or an Update may carry, as the request body.
 * A blank field is left out: it is never sent as an empty value.
 */
function taskBody(
	context: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	const body: IDataObject = {};

	for (const key of ['title', 'boardId', 'statusId', 'assigneeId', 'contactId', 'parentId']) {
		const value = text(fields[key]);
		if (value !== undefined) body[key] = value;
	}
	// A description keeps its own spacing; only a blank one is dropped.
	if (text(fields.description) !== undefined) body.description = String(fields.description);
	if (text(fields.priority) !== undefined) body.priority = text(fields.priority);

	const startDate = toIsoDate(context, fields.startDate, 'Start Date', itemIndex);
	if (startDate) body.startDate = startDate;
	const dueDate = toIsoDate(context, fields.dueDate, 'Due Date', itemIndex);
	if (dueDate) body.dueDate = dueDate;

	const labels = toList(fields.labels);
	if (labels.length) body.labels = labels;

	return body;
}

/** The filters of Get Many, as the query string of GET /v1/tasks. */
export function taskListQuery(context: IExecuteFunctions, filters: IDataObject, itemIndex: number): IDataObject {
	const qs: IDataObject = {};

	for (const key of ['boardId', 'contactId', 'search', 'sort', 'dir']) {
		const value = text(filters[key]);
		if (value !== undefined) qs[key] = value;
	}
	for (const key of ['statusIds', 'categories', 'assigneeIds', 'priorities', 'labels']) {
		const value = toCsv(filters[key]);
		if (value) qs[key] = value;
	}

	const dueFrom = toIsoDate(context, filters.dueFrom, 'Due After', itemIndex);
	if (dueFrom) qs.dueFrom = dueFrom;
	const dueTo = toIsoDate(context, filters.dueTo, 'Due Before', itemIndex);
	if (dueTo) qs.dueTo = dueTo;

	// Switches are sent only when on: Slide's answer for "off" is its default.
	if (filters.overdue === true) qs.overdue = 'true';
	if (filters.includeSubtasks === true) qs.includeSubtasks = 'true';

	return qs;
}

/**
 * Every page of a list, or the first `limit` rows of it.
 *
 * The page size stays the same from the first request to the last: a page
 * number only means the same rows while the size does not change.
 */
async function listRows(
	context: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
): Promise<IDataObject[]> {
	const pageSize = returnAll ? PAGE_SIZE_MAX : Math.min(PAGE_SIZE_MAX, Math.max(1, limit));
	const rows: IDataObject[] = [];

	for (let page = 1; page <= PAGES_MAX; page++) {
		const response = await slideApiRequest.call(context, 'GET', path, {}, { ...qs, page, limit: pageSize });
		const received = ((Array.isArray(response) ? response : response?.data) ?? []) as IDataObject[];
		rows.push(...received);

		if (!returnAll && rows.length >= limit) break;
		const totalPages = Number(response?.meta?.totalPages ?? page);
		if (received.length === 0 || page >= totalPages) break;
	}

	return returnAll ? rows : rows.slice(0, limit);
}

/** An ID taken from a parameter, trimmed, ready for a path. Blank is refused. */
function pathId(context: IExecuteFunctions, name: string, label: string, itemIndex: number): string {
	const id = text(context.getNodeParameter(name, itemIndex, ''));
	if (id === undefined) {
		throw new NodeOperationError(context.getNode(), `Enter the ${label}`, { itemIndex });
	}
	return encodeURIComponent(id);
}

/**
 * Run one Task or Task Board operation for one input item.
 * Returns the row, or the rows, to hand on.
 */
export async function executeTaskOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	const scope = OPERATION_SCOPE[resource]?.[operation];
	if (!scope) {
		throw new NodeOperationError(
			this.getNode(),
			`Unsupported operation "${operation}" for resource "${resource}"`,
			{ itemIndex: i },
		);
	}

	try {
		return await run.call(this, resource, operation, i);
	} catch (error) {
		// n8n words every 403 as "Forbidden - perhaps check your credentials?".
		// Here the cause and the fix are both known: the key lacks a permission,
		// and a key's permissions cannot be edited.
		if (isMissingScopeError(error)) {
			throw new NodeOperationError(
				this.getNode(),
				`This API key cannot ${SCOPE_ACTION[scope]}: it needs the permission ${scope}`,
				{
					description: `The permissions of an API key cannot be edited. Create a new key that has ${scope} in your Slide dashboard under Admin, API Keys, then put it in this credential.`,
					itemIndex: i,
				},
			);
		}
		throw error;
	}
}

async function run(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (resource === 'taskBoard') {
		if (operation === 'getAll') {
			const response = await slideApiRequest.call(this, 'GET', BOARDS_PATH);
			return ((Array.isArray(response) ? response : response?.data) ?? []) as IDataObject[];
		}

		if (operation === 'get') {
			const boardId = pathId(this, 'boardId', 'board', i);
			return slideApiRequest.call(this, 'GET', `${BOARDS_PATH}/${boardId}`);
		}

		// create
		const name = text(this.getNodeParameter('name', i, ''));
		if (name === undefined) {
			throw new NodeOperationError(this.getNode(), 'Enter a name for the board', { itemIndex: i });
		}
		const extra = this.getNodeParameter('boardFields', i, {}) as IDataObject;
		const body: IDataObject = { name };
		for (const key of ['description', 'color', 'visibility', 'template']) {
			const value = text(extra[key]);
			if (value !== undefined) body[key] = value;
		}
		const memberIds = toList(extra.memberIds);
		if (memberIds.length) body.memberIds = memberIds;

		return slideApiRequest.call(this, 'POST', BOARDS_PATH, body);
	}

	// ── resource: task ──────────────────────────────────────────────────────
	switch (operation) {
		case 'create': {
			const title = text(this.getNodeParameter('title', i, ''));
			if (title === undefined) {
				throw new NodeOperationError(this.getNode(), 'Enter a title for the task', { itemIndex: i });
			}
			const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
			return slideApiRequest.call(this, 'POST', TASKS_PATH, {
				...taskBody(this, extra, i),
				title,
			});
		}

		case 'get': {
			const taskId = pathId(this, 'taskId', 'task ID', i);
			return slideApiRequest.call(this, 'GET', `${TASKS_PATH}/${taskId}`);
		}

		case 'getAll': {
			const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
			return listRows(
				this,
				TASKS_PATH,
				taskListQuery(this, filters, i),
				this.getNodeParameter('returnAll', i, false) as boolean,
				this.getNodeParameter('limit', i, 50) as number,
			);
		}

		case 'update': {
			const taskId = pathId(this, 'taskId', 'task ID', i);
			const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
			const body = taskBody(this, fields, i);

			const cleared = toList(this.getNodeParameter('clearFields', i, []));
			for (const key of cleared) {
				if (!(key in CLEARABLE)) continue;
				if (key in body) {
					throw new NodeOperationError(
						this.getNode(),
						`"${key}" is both set and cleared`,
						{
							description: 'Remove it from Update Fields or from Clear Fields.',
							itemIndex: i,
						},
					);
				}
				body[key] = CLEARABLE[key] as IDataObject[string];
			}

			if (!Object.keys(body).length) {
				throw new NodeOperationError(this.getNode(), 'Choose at least one field to change', {
					description: 'Add a field under Update Fields, or one under Clear Fields.',
					itemIndex: i,
				});
			}
			return slideApiRequest.call(this, 'PATCH', `${TASKS_PATH}/${taskId}`, body);
		}

		case 'complete': {
			const taskId = pathId(this, 'taskId', 'task ID', i);
			const done = this.getNodeParameter('done', i, true) as boolean;
			return slideApiRequest.call(this, 'POST', `${TASKS_PATH}/${taskId}/complete`, { done });
		}

		case 'delete': {
			const taskId = pathId(this, 'taskId', 'task ID', i);
			return slideApiRequest.call(this, 'DELETE', `${TASKS_PATH}/${taskId}`);
		}

		case 'addComment': {
			const taskId = pathId(this, 'taskId', 'task ID', i);
			const body = text(this.getNodeParameter('comment', i, ''));
			if (body === undefined) {
				throw new NodeOperationError(this.getNode(), 'Enter the comment', { itemIndex: i });
			}
			return slideApiRequest.call(this, 'POST', `${TASKS_PATH}/${taskId}/comments`, { body });
		}

		default: {
			// getComments: the only operation left in OPERATION_SCOPE.
			const taskId = pathId(this, 'taskId', 'task ID', i);
			return listRows(
				this,
				`${TASKS_PATH}/${taskId}/comments`,
				{},
				this.getNodeParameter('returnAll', i, false) as boolean,
				this.getNodeParameter('limit', i, 50) as number,
			);
		}
	}
}

// ── Drop-down pickers ───────────────────────────────────────────────────────

interface BoardRow {
	id: string;
	name: string;
	statuses?: Array<{ id: string; name: string }>;
}

async function fetchBoards(context: ILoadOptionsFunctions): Promise<BoardRow[]> {
	const response = await slideApiRequest.call(context, 'GET', BOARDS_PATH);
	return ((Array.isArray(response) ? response : response?.data) ?? []) as BoardRow[];
}

/**
 * The board the person has already chosen in this node, wherever the field sits
 * (the task's own board, or the board filter). An expression is not a board yet.
 */
function chosenBoardId(context: ILoadOptionsFunctions): string | undefined {
	for (const path of ['boardId', 'additionalFields.boardId', 'updateFields.boardId', 'filters.boardId']) {
		try {
			const value = context.getCurrentNodeParameter(path);
			if (typeof value === 'string' && value.trim() !== '' && !value.startsWith('=')) {
				return value.trim();
			}
		} catch {
			// Not a field of this operation.
		}
	}
	return undefined;
}

export async function loadTaskBoards(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boards = await fetchBoards(this);
	return boards.map((board) => ({ name: String(board.name ?? board.id), value: String(board.id) }));
}

/**
 * The stages of the chosen board. With no board chosen, the stages of every
 * board, each named Board: Stage, since a stage belongs to one board.
 */
export async function loadTaskStatuses(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boards = await fetchBoards(this);
	const chosen = chosenBoardId(this);
	const board = chosen ? boards.find((candidate) => candidate.id === chosen) : undefined;

	if (board) {
		return (board.statuses ?? []).map((status) => ({ name: String(status.name), value: String(status.id) }));
	}
	return boards.flatMap((each) =>
		(each.statuses ?? []).map((status) => ({
			name: `${each.name}: ${status.name}`,
			value: String(status.id),
		})),
	);
}

async function fetchAssignees(context: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const boardId = chosenBoardId(context);
	const response = await slideApiRequest.call(
		context,
		'GET',
		`${TASKS_PATH}/assignees`,
		{},
		boardId ? { boardId } : {},
	);
	const rows = ((Array.isArray(response) ? response : response?.data) ?? []) as Array<{
		id: string;
		name?: string;
		email?: string;
	}>;
	return rows.map((member) => ({
		name: member.email ? `${member.name ?? member.email} (${member.email})` : String(member.name ?? member.id),
		value: String(member.id),
	}));
}

export async function loadTaskAssignees(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return fetchAssignees(this);
}

/** The members, and "Unassigned" (`none`) first, for the assignee filter. */
export async function loadTaskAssigneesWithUnassigned(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return [{ name: 'Unassigned', value: 'none' }, ...(await fetchAssignees(this))];
}

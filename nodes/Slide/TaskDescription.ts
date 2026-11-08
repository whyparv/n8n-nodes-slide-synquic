import type { INodeProperties } from 'n8n-workflow';

/**
 * The Task and Task Board resources of the Slide node: their operations and
 * fields. The request each one makes is built in TaskFunctions.ts, next to the
 * names used here, so a field and its reader stay together.
 *
 * Task boards are the CRM's boards (Marketing, Software, ...). An API key acts
 * for the whole workspace, so it sees every board, private ones included.
 */

const PRIORITIES = [
	{ name: 'High', value: 'HIGH' },
	{ name: 'Low', value: 'LOW' },
	{ name: 'Medium', value: 'MEDIUM' },
	{ name: 'None', value: 'NONE' },
	{ name: 'Urgent', value: 'URGENT' },
];

const CATEGORIES = [
	{ name: 'Cancelled', value: 'CANCELLED' },
	{ name: 'Done', value: 'DONE' },
	{ name: 'In Progress', value: 'IN_PROGRESS' },
	{ name: 'To Do', value: 'TODO' },
];

const ISO_DATE_NOTE =
	'ISO 8601. A date without a time (2026-11-20) is midnight UTC; send a full timestamp with its time zone for a precise time.';

const TASK_ID: INodeProperties = {
	displayName: 'Task ID',
	name: 'taskId',
	type: 'string',
	required: true,
	default: '',
	description: 'The ID of the task, as returned by Create, Get Many or the Slide Trigger',
};

const show = (resource: string, operation: string[]) => ({
	show: { resource: [resource], operation },
});

export const taskProperties: INodeProperties[] = [
	// ── Task operations ──────────────────────────────────────────────────────
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['task'] } },
		default: 'create',
		options: [
			{
				name: 'Add Comment',
				value: 'addComment',
				description: 'Add a comment to a task',
				action: 'Add a comment to a task',
			},
			{
				name: 'Complete',
				value: 'complete',
				description: 'Mark a task done, or reopen it',
				action: 'Complete a task',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a task, or a subtask',
				action: 'Create a task',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a task with its subtasks, comments and files',
				action: 'Delete a task',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get one task with its subtasks and files',
				action: 'Get a task',
			},
			{
				name: 'Get Comments',
				value: 'getComments',
				description: 'Get the comments of a task, oldest first',
				action: 'Get comments of a task',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many tasks, with filters',
				action: 'Get many tasks',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Change a task',
				action: 'Update a task',
			},
		],
	},

	// ── Task Board operations ────────────────────────────────────────────────
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['taskBoard'] } },
		default: 'getAll',
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a task board',
				action: 'Create a task board',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get one board with its stages and members',
				action: 'Get a task board',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many task boards, with their stages and open task count',
				action: 'Get many task boards',
			},
		],
	},

	// ── task: create ─────────────────────────────────────────────────────────
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('task', ['create']),
		description: 'What needs to be done. Up to 300 characters.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: show('task', ['create']),
		options: [
			{
				displayName: 'Assignee Name or ID',
				name: 'assigneeId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskAssignees' },
				description:
					'A member of your workspace. On a private board it must be a member of that board. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Board Name or ID',
				name: 'boardId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskBoards' },
				description:
					'Leave empty for your default board, or for the parent task\'s board when this is a subtask. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'The ID of a contact in your contact list to link to this task',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Up to 20,000 characters',
			},
			{
				displayName: 'Due Date',
				name: 'dueDate',
				type: 'dateTime',
				default: '',
				description: ISO_DATE_NOTE,
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'string',
				default: '',
				description:
					'Comma-separated list. Up to 20 labels of up to 40 characters each; a label cannot contain a comma.',
			},
			{
				displayName: 'Parent Task ID',
				name: 'parentId',
				type: 'string',
				default: '',
				description:
					'Makes this a subtask. A subtask stays on its parent\'s board, and subtasks cannot have subtasks of their own.',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				default: 'NONE',
				options: PRIORITIES,
			},
			{
				displayName: 'Stage Name or ID',
				name: 'statusId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskStatuses' },
				description:
					'The stage on the board. Leave empty for the board\'s default stage. Stages are listed per board. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'dateTime',
				default: '',
				description: `${ISO_DATE_NOTE} It must be on or before the due date`,
			},
		],
	},

	// ── task: get / update / complete / delete / comments ────────────────────
	{ ...TASK_ID, displayOptions: show('task', ['get', 'update', 'complete', 'delete', 'addComment', 'getComments']) },

	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: show('task', ['update']),
		description: 'A field left out, or left blank, is not changed. To empty a field, use Clear Fields below.',
		options: [
			{
				displayName: 'Assignee Name or ID',
				name: 'assigneeId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskAssignees' },
				description:
					'On a private board it must be a member of that board. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Board Name or ID',
				name: 'boardId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskBoards' },
				description:
					'Moves the task and its subtasks to this board. The stage maps by meaning unless you also choose a stage. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
			},
			{
				displayName: 'Due Date',
				name: 'dueDate',
				type: 'dateTime',
				default: '',
				description: ISO_DATE_NOTE,
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'string',
				default: '',
				description: 'Comma-separated list. Replaces the task\'s labels.',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				default: 'NONE',
				options: PRIORITIES,
			},
			{
				displayName: 'Stage Name or ID',
				name: 'statusId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskStatuses' },
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Start Date',
				name: 'startDate',
				type: 'dateTime',
				default: '',
				description: `${ISO_DATE_NOTE} It must be on or before the due date`,
			},
			{
				displayName: 'Title',
				name: 'title',
				type: 'string',
				default: '',
			},
		],
	},
	{
		displayName: 'Clear Fields',
		name: 'clearFields',
		type: 'multiOptions',
		default: [],
		displayOptions: show('task', ['update']),
		description: 'Fields to empty on the task. A blank field above never clears a value; this does.',
		options: [
			{ name: 'Assignee', value: 'assigneeId' },
			{ name: 'Contact', value: 'contactId' },
			{ name: 'Description', value: 'description' },
			{ name: 'Due Date', value: 'dueDate' },
			{ name: 'Labels', value: 'labels' },
			{ name: 'Start Date', value: 'startDate' },
		],
	},

	// ── task: complete ───────────────────────────────────────────────────────
	{
		displayName: 'Done',
		name: 'done',
		type: 'boolean',
		default: true,
		displayOptions: show('task', ['complete']),
		description:
			'Whether to mark the task done (moves it to the board\'s first done stage) or reopen it (moves it to the board\'s default open stage)',
	},

	// ── task: addComment ─────────────────────────────────────────────────────
	{
		displayName: 'Comment',
		name: 'comment',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: show('task', ['addComment']),
		description: 'Up to 10,000 characters. It shows in the task\'s history as written via the API.',
	},

	// ── task: getAll / getComments paging ────────────────────────────────────
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: show('task', ['getAll', 'getComments']),
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: { resource: ['task'], operation: ['getAll', 'getComments'], returnAll: [false] },
		},
		description: 'Max number of results to return',
	},

	// ── task: getAll filters ─────────────────────────────────────────────────
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add filter',
		default: {},
		displayOptions: show('task', ['getAll']),
		options: [
			{
				displayName: 'Assignee Names or IDs',
				name: 'assigneeIds',
				type: 'multiOptions',
				default: [],
				typeOptions: { loadOptionsMethod: 'getTaskAssigneesWithUnassigned' },
				description:
					'Tasks assigned to any of these members. Choose Unassigned for tasks nobody owns. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Board Name or ID',
				name: 'boardId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'getTaskBoards' },
				description:
					'Only tasks on this board. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'Only tasks linked to this contact',
			},
			{
				displayName: 'Direction',
				name: 'dir',
				type: 'options',
				default: 'asc',
				options: [
					{ name: 'Ascending', value: 'asc' },
					{ name: 'Descending', value: 'desc' },
				],
			},
			{
				displayName: 'Due After',
				name: 'dueFrom',
				type: 'dateTime',
				default: '',
				description: 'Only tasks due on or after this date',
			},
			{
				displayName: 'Due Before',
				name: 'dueTo',
				type: 'dateTime',
				default: '',
				description: 'Only tasks due on or before this date',
			},
			{
				displayName: 'Include Subtasks',
				name: 'includeSubtasks',
				type: 'boolean',
				default: false,
				description: 'Whether to include subtasks in the list. By default only top-level tasks are returned.',
			},
			{
				displayName: 'Labels',
				name: 'labels',
				type: 'string',
				default: '',
				description: 'Comma-separated list. Tasks having any of these labels.',
			},
			{
				displayName: 'Overdue Only',
				name: 'overdue',
				type: 'boolean',
				default: false,
				description: 'Whether to return only tasks that are past their due date and not done',
			},
			{
				displayName: 'Priorities',
				name: 'priorities',
				type: 'multiOptions',
				default: [],
				options: PRIORITIES,
				description: 'Tasks with any of these priorities',
			},
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				default: '',
				description: 'Text to look for in the task',
			},
			{
				displayName: 'Sort By',
				name: 'sort',
				type: 'options',
				default: 'position',
				options: [
					{ name: 'Created', value: 'createdAt' },
					{ name: 'Due Date', value: 'dueDate' },
					{ name: 'Position on the Board', value: 'position' },
					{ name: 'Priority', value: 'priority' },
					{ name: 'Start Date', value: 'startDate' },
					{ name: 'Title', value: 'title' },
					{ name: 'Updated', value: 'updatedAt' },
				],
			},
			{
				displayName: 'Stage Names or IDs',
				name: 'statusIds',
				type: 'multiOptions',
				default: [],
				typeOptions: { loadOptionsMethod: 'getTaskStatuses' },
				description:
					'Tasks in any of these stages. Stages are listed as Board: Stage. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Stage Types',
				name: 'categories',
				type: 'multiOptions',
				default: [],
				options: CATEGORIES,
				description: 'Tasks whose stage means any of these, whatever the stage is called on each board',
			},
		],
	},

	// ── taskBoard: get ───────────────────────────────────────────────────────
	{
		displayName: 'Board Name or ID',
		name: 'boardId',
		type: 'options',
		required: true,
		default: '',
		typeOptions: { loadOptionsMethod: 'getTaskBoards' },
		displayOptions: show('taskBoard', ['get']),
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},

	// ── taskBoard: create ────────────────────────────────────────────────────
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: show('taskBoard', ['create']),
		description: 'Up to 60 characters. A name already used by another board is refused.',
	},
	{
		displayName: 'Additional Fields',
		name: 'boardFields',
		type: 'collection',
		placeholder: 'Add field',
		default: {},
		displayOptions: show('taskBoard', ['create']),
		options: [
			{
				displayName: 'Color',
				name: 'color',
				type: 'color',
				default: '',
				description: 'The board\'s colour, as #rrggbb',
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Up to 500 characters',
			},
			{
				displayName: 'Member Names or IDs',
				name: 'memberIds',
				type: 'multiOptions',
				default: [],
				typeOptions: { loadOptionsMethod: 'getTaskAssignees' },
				description:
					'Members of a private board. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Template',
				name: 'template',
				type: 'options',
				default: 'general',
				options: [
					{ name: 'General', value: 'general' },
					{ name: 'Marketing', value: 'marketing' },
					{ name: 'Software', value: 'software' },
				],
				description: 'The set of stages the board starts with',
			},
			{
				displayName: 'Visibility',
				name: 'visibility',
				type: 'options',
				default: 'WORKSPACE',
				options: [
					{ name: 'Private (Members Only)', value: 'PRIVATE' },
					{ name: 'Workspace', value: 'WORKSPACE' },
				],
			},
		],
	},
];

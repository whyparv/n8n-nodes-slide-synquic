import type {
	JsonObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	INodePropertyOptions,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeApiError, NodeOperationError } from 'n8n-workflow';

import { slideApiRequest, loadListOptions } from './GenericFunctions';

export class Slide implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Slide',
		name: 'slide',
		icon: { light: 'file:slide.svg', dark: 'file:slide.dark.svg' },
		group: ['output'],
		version: 1,
		// Exposed to AI Agent nodes as a callable tool. Sending a message or
		// looking up a contact are exactly the kind of actions an agent needs.
		usableAsTool: true,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send messages and manage contacts in Slide',
		defaults: { name: 'Slide' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'slideApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'message',
				options: [
					{ name: 'Message', value: 'message' },
					{ name: 'Contact', value: 'contact' },
				],
			},

			// ── Message operations ────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				default: 'send',
				options: [
					{
						name: 'Send',
						value: 'send',
						description: 'Send over any channel, with optional fallback',
						action: 'Send a message',
					},
					{
						name: 'Send WhatsApp Template',
						value: 'sendWhatsAppTemplate',
						description: 'Send an approved WhatsApp template',
						// eslint-disable-next-line n8n-nodes-base/node-param-operation-option-action-miscased -- "WhatsApp" is a proper noun. The rule's sentence-case autofix rewrote this to "whats app template", which is what merchants then saw in the n8n UI.
						action: 'Send a WhatsApp template',
					},
					{
						name: 'Send Email',
						value: 'sendEmail',
						description: 'Send a transactional email from a template',
						action: 'Send an email',
					},
					{
						name: 'Send SMS',
						value: 'sendSms',
						description: 'Send an SMS from a registered sender ID',
						action: 'Send an SMS',
					},
				],
			},

			// ── Contact operations ────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['contact'] } },
				default: 'search',
				options: [
					{
						name: 'Search',
						value: 'search',
						description: 'Find contacts by email, phone, or name',
						action: 'Search contacts',
					},
					{
						name: 'Create or Update',
						value: 'upsert',
						description: 'Create a new record, or update the current one if it already exists (upsert)',
						action: 'Create or update a contact',
					},
				],
			},

			// ── message: send ─────────────────────────────────────────────────
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				description:
					'Phone number in E.164 format (+919876543210) for WhatsApp, SMS and RCS. Email address for Email. Instagram-scoped user ID for Instagram.',
			},
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'options',
				required: true,
				default: 'whatsapp',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				options: [
					{ name: 'Email', value: 'email' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'RCS', value: 'rcs' },
					{ name: 'SMS', value: 'sms' },
					{ name: 'WhatsApp', value: 'whatsapp' },
				],
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['send'] } },
				options: [
					{
						displayName: 'Fallback Channels',
						name: 'fallbackChannels',
						type: 'multiOptions',
						default: [],
						options: [
							{ name: 'WhatsApp', value: 'whatsapp' },
							{ name: 'SMS', value: 'sms' },
							{ name: 'RCS', value: 'rcs' },
						],
						description:
							'Tried in order if the primary channel fails. Only phone-based channels can be chained, since they share the same recipient address.',
					},
					{
						displayName: 'Email Subject',
						name: 'emailSubject',
						type: 'string',
						default: '',
						description: 'Used when the channel is Email',
					},
					{
						displayName: 'SMS Sender Name or ID',
						name: 'smsSenderId',
						type: 'options',
						default: '',
						typeOptions: { loadOptionsMethod: 'getSmsSenders' },
						description: 'Used when the channel is SMS. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},

			// ── message: sendWhatsAppTemplate ─────────────────────────────────
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				displayOptions: {
					show: { resource: ['message'], operation: ['sendWhatsAppTemplate'] },
				},
				description: 'Recipient phone number in E.164 format',
			},
			{
				displayName: 'Template Name or ID',
				name: 'templateName',
				type: 'options',
				required: true,
				default: '',
				typeOptions: { loadOptionsMethod: 'getWhatsAppTemplates' },
				displayOptions: {
					show: { resource: ['message'], operation: ['sendWhatsAppTemplate'] },
				},
				description: 'An approved WhatsApp template. Choose from the list, or specify an ID using an expression. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Language Code',
				name: 'languageCode',
				type: 'string',
				required: true,
				default: 'en',
				displayOptions: {
					show: { resource: ['message'], operation: ['sendWhatsAppTemplate'] },
				},
				description: 'Must match the approved language of the template',
			},
			{
				displayName: 'Body Variables',
				name: 'bodyVariables',
				type: 'string',
				default: '',
				displayOptions: {
					show: { resource: ['message'], operation: ['sendWhatsAppTemplate'] },
				},
				description:
					'Comma-separated values for the numbered placeholders, in order: the first fills {{1}}, the second {{2}}, and so on. Leave a slot empty to send it blank, for example "Priya,,#1042".',
			},

			// ── message: sendEmail ────────────────────────────────────────────
			{
				displayName: 'To Email',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendEmail'] } },
			},
			{
				displayName: 'Template Name or ID',
				name: 'templateId',
				type: 'options',
				required: true,
				default: '',
				typeOptions: { loadOptionsMethod: 'getEmailTemplates' },
				displayOptions: { show: { resource: ['message'], operation: ['sendEmail'] } },
				description: 'The email template to send. Choose from the list, or specify an ID using an expression. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'From Name',
				name: 'fromName',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendEmail'] } },
			},
			{
				displayName: 'From Email',
				name: 'fromEmail',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendEmail'] } },
				description: 'Must be on a domain you have verified in Slide',
			},
			{
				displayName: 'Additional Fields',
				name: 'emailFields',
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendEmail'] } },
				options: [
					{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
					{ displayName: 'Reply-To', name: 'replyTo', type: 'string', default: '' },
					{
						displayName: 'Subject',
						name: 'subject',
						type: 'string',
						default: '',
						description: 'Overrides the subject defined on the template',
					},
					{
						displayName: 'Template Variables',
						name: 'variables',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						options: [
							{
								name: 'variable',
								displayName: 'Variable',
								values: [
									{ displayName: 'Name', name: 'key', type: 'string', default: '' },
									{ displayName: 'Value', name: 'value', type: 'string', default: '' },
								],
							},
						],
					},
				],
			},

			// ── message: sendSms ──────────────────────────────────────────────
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendSms'] } },
			},
			{
				displayName: 'Sender Name or ID',
				name: 'senderId',
				type: 'options',
				required: true,
				default: '',
				typeOptions: { loadOptionsMethod: 'getSmsSenders' },
				displayOptions: { show: { resource: ['message'], operation: ['sendSms'] } },
				description: 'A registered sender ID. Choose from the list, or specify an ID using an expression. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendSms'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'smsFields',
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: { show: { resource: ['message'], operation: ['sendSms'] } },
				options: [
					{
						displayName: 'DLT Template ID',
						name: 'templateId',
						type: 'string',
						default: '',
						description: 'Required for Indian numbers, where a registered DLT template is mandated',
					},
					{
						displayName: 'Route',
						name: 'route',
						type: 'options',
						default: 'transactional',
						options: [
							{ name: 'Transactional', value: 'transactional' },
							{ name: 'Promotional', value: 'promotional' },
						],
					},
				],
			},

			// ── contact: search ───────────────────────────────────────────────
			{
				displayName: 'Search',
				name: 'search',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['search'] } },
				description: 'An email address, phone number, or name',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { resource: ['contact'], operation: ['search'] } },
				description: 'Max number of results to return',
			},

			// ── contact: upsert ───────────────────────────────────────────────
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['contact'], operation: ['upsert'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'contactFields',
				type: 'collection',
				placeholder: 'Add field',
				default: {},
				displayOptions: { show: { resource: ['contact'], operation: ['upsert'] } },
				options: [
					{ displayName: 'Company', name: 'company', type: 'string', default: '' },
					{ displayName: 'First Name', name: 'firstName', type: 'string', default: '' },
					{ displayName: 'Last Name', name: 'lastName', type: 'string', default: '' },
					{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
					{
						displayName: 'Tags',
						name: 'tags',
						type: 'string',
						default: '',
						description: 'Comma-separated list of tags',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getEmailTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadListOptions.call(this, '/v1/email/templates', 'id', 'name');
			},
			async getWhatsAppTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const options = await loadListOptions.call(
					this,
					'/v1/whatsapp/templates',
					'name',
					'name',
				);
				// Only APPROVED templates can be sent; offering the rest would give
				// the user a choice that always fails at send time.
				return options.filter((option) => option.value !== '');
			},
			async getSmsSenders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return loadListOptions.call(this, '/v1/sms/senders', 'senderId', 'senderId');
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[] = {};

				if (resource === 'message' && operation === 'send') {
					const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const body: IDataObject = {
						to: (this.getNodeParameter('to', i) as string).trim(),
						channel: this.getNodeParameter('channel', i) as string,
					};

					const message = (this.getNodeParameter('message', i, '') as string).trim();
					if (message) body.message = message;

					const fallbacks = (extra.fallbackChannels as string[]) ?? [];
					if (fallbacks.length) body.fallbackChannels = fallbacks;
					if (extra.emailSubject) body.email = { subject: extra.emailSubject };
					if (extra.smsSenderId) body.sms = { senderId: extra.smsSenderId };

					responseData = await slideApiRequest.call(this, 'POST', '/v1/messages/send', body);
				}

				else if (resource === 'message' && operation === 'sendWhatsAppTemplate') {
					const body: IDataObject = {
						to: (this.getNodeParameter('to', i) as string).trim(),
						templateName: this.getNodeParameter('templateName', i) as string,
						languageCode: (this.getNodeParameter('languageCode', i) as string) || 'en',
					};

					const raw = (this.getNodeParameter('bodyVariables', i, '') as string);
					if (raw.trim()) {
						// Split WITHOUT dropping empties: these fill positional {{1}},
						// {{2}}, {{3}} placeholders, so removing a blank middle value
						// would promote the next one into its slot and send customers
						// the wrong values in the wrong places.
						const parameters = raw
							.split(',')
							.map((value) => ({ type: 'text', text: value.trim() }));
						body.components = [{ type: 'body', parameters }];
					}

					responseData = await slideApiRequest.call(
						this,
						'POST',
						'/v1/whatsapp/send-template',
						body,
					);
				}

				else if (resource === 'message' && operation === 'sendEmail') {
					const extra = this.getNodeParameter('emailFields', i, {}) as IDataObject;
					const body: IDataObject = {
						recipient: {
							to: (this.getNodeParameter('to', i) as string).trim(),
							...(extra.firstName ? { firstName: extra.firstName } : {}),
							...(extra.lastName ? { lastName: extra.lastName } : {}),
						},
						templateId: this.getNodeParameter('templateId', i) as string,
						fromName: this.getNodeParameter('fromName', i) as string,
						fromEmail: (this.getNodeParameter('fromEmail', i) as string).trim(),
					};

					if (extra.subject) body.subject = extra.subject;
					if (extra.replyTo) body.replyTo = extra.replyTo;

					const variableRows =
						((extra.variables as IDataObject)?.variable as IDataObject[]) ?? [];
					if (variableRows.length) {
						body.variables = variableRows.reduce((acc: IDataObject, row) => {
							if (row.key) acc[row.key as string] = row.value;
							return acc;
						}, {});
					}

					responseData = await slideApiRequest.call(this, 'POST', '/v1/email/send', body);
				}

				else if (resource === 'message' && operation === 'sendSms') {
					const extra = this.getNodeParameter('smsFields', i, {}) as IDataObject;
					const body: IDataObject = {
						// The API takes a list; one node execution sends to one recipient.
						to: [(this.getNodeParameter('to', i) as string).trim()],
						senderId: this.getNodeParameter('senderId', i) as string,
						message: this.getNodeParameter('message', i) as string,
					};
					if (extra.templateId) body.templateId = extra.templateId;
					if (extra.route) body.route = extra.route;

					responseData = await slideApiRequest.call(this, 'POST', '/v1/sms/send', body);
				}

				else if (resource === 'contact' && operation === 'search') {
					const response = await slideApiRequest.call(
						this,
						'GET',
						'/v1/contacts',
						{},
						{
							search: (this.getNodeParameter('search', i) as string).trim(),
							limit: this.getNodeParameter('limit', i, 10) as number,
							page: 1,
						},
					);
					responseData = (Array.isArray(response) ? response : response?.data) ?? [];
				}

				else if (resource === 'contact' && operation === 'upsert') {
					const extra = this.getNodeParameter('contactFields', i, {}) as IDataObject;
					const body: IDataObject = {
						email: (this.getNodeParameter('email', i) as string).trim(),
					};
					for (const field of ['firstName', 'lastName', 'phone', 'company']) {
						if (extra[field]) body[field] = extra[field];
					}
					if (extra.tags) {
						// Tags are a set, not a sequence — blanks carry no meaning here,
						// so dropping them is safe (unlike template variables above).
						const tags = String(extra.tags)
							.split(',')
							.map((tag) => tag.trim())
							.filter(Boolean);
						if (tags.length) body.tags = tags;
					}

					responseData = await slideApiRequest.call(
						this,
						'POST',
						'/v1/email/contacts',
						body,
					);
				}

				else {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation "${operation}" for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				const rows = Array.isArray(responseData) ? responseData : [responseData];
				returnData.push(
					...rows.map((json) => ({ json, pairedItem: { item: i } })),
				);
			} catch (error) {
				// Honour n8n's "Continue On Fail": one bad row should not abandon the
				// rest of the batch when the user has asked for that behaviour.
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// Wrapped rather than re-thrown raw: NodeApiError renders Slide's
				// own message in the UI and pins the failure to this input item,
				// instead of surfacing an unlabelled stack.
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SlideApi implements ICredentialType {
	name = 'slideApi';

	displayName = 'Slide API';

	documentationUrl = 'https://slide.synquic.com/developers';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in your Slide dashboard under Admin, API Keys. Trigger nodes need the webhooks:read and webhooks:write scopes. Add send scopes (whatsapp:send, email:send, sms:send) for the actions you plan to use.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://slide.synquic.com/api',
			description:
				'Only change this if you are pointing at a self-hosted or staging Slide instance',
		},
	];

	/**
	 * Injected into every request by both nodes, so neither has to remember to
	 * attach the key and no future request can be written without it.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	/**
	 * Powers the "Test" button on the credential.
	 *
	 * Hits the webhook catalogue rather than a generic ping, so the test doubles
	 * as a scope check: a key without webhooks:read returns 403 here and would
	 * be useless for every trigger in this package. Failing at credential-save
	 * time is far kinder than a trigger that saves fine and then never fires.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/webhooks/events',
			method: 'GET',
		},
	};
}

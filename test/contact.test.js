/**
 * Contact operations of the Slide action node.
 *
 * "Create or Update" writes one contact to the contact list (POST /v1/contacts),
 * matched by phone, then by email. "Search" reads the same list
 * (GET /v1/contacts), by free text or by an exact email or phone.
 *
 * The node is driven the way n8n drives it, through a stand-in for the execute
 * context: parameters in, one recorded HTTP request out. No network involved.
 *
 * The saved-workflow tests are the ones that matter most: a workflow saved by
 * an earlier version of this node holds the OLD parameter set (no "Search By",
 * no top-level "Phone"), and must keep working without being opened.
 *
 * Run: npm run build && npm test
 */
const test = require('node:test');
const assert = require('node:assert');

const { Slide } = require('../dist/nodes/Slide/Slide.node.js');
const {
  isMissingScopeError,
  contactRetryDelaySeconds,
} = require('../dist/nodes/Slide/GenericFunctions.js');

const BASE_URL = 'https://api.example.test';

/**
 * A stand-in for n8n's execute context. `params` is what the workflow holds:
 * a parameter that is absent answers the fallback, as n8n answers the default
 * for a field that did not exist when the workflow was saved.
 */
const run = async ({ params, answer = () => ({}), items = [{ json: {} }], continueOnFail = false }) => {
  const requests = [];
  const context = {
    getInputData: () => items,
    getNodeParameter: (name, _index, fallback) => (name in params ? params[name] : fallback),
    getNode: () => ({
      id: '1',
      name: 'Slide',
      type: 'n8n-nodes-slide-synquic.slide',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    getCredentials: async () => ({ apiKey: 'sk_test_PLACEHOLDER', baseUrl: BASE_URL }),
    continueOnFail: () => continueOnFail,
    helpers: {
      async httpRequestWithAuthentication(credentialType, options) {
        requests.push({ credentialType, ...options });
        return answer(options);
      },
    },
  };

  const [output] = await new Slide().execute.call(context);
  return { output, requests };
};

/** What an HTTP client throws for an error status: the status and Slide's own body. */
const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const upsert = (params) => ({ resource: 'contact', operation: 'upsert', ...params });
const search = (params) => ({ resource: 'contact', operation: 'search', ...params });

const CONTACT = {
  id: 'ct_9f2c4b1e',
  unifiedContactId: 'ct_9f2c4b1e',
  name: 'Priya Sharma',
  email: 'priya@example.com',
  phone: '+919876543210',
  tags: [{ id: 'tag_1', name: 'vip', color: '#10b981' }],
};

// ── Create or Update ────────────────────────────────────────────────────────

test('Create or Update posts the contact to /v1/contacts with the fields mapped', async () => {
  const { output, requests } = await run({
    params: upsert({
      email: ' priya@example.com ',
      phone: ' +919876543210 ',
      contactFields: { firstName: 'Priya', lastName: 'Sharma', company: 'Acme', tags: 'vip, , newsletter' },
    }),
    answer: () => ({ ...CONTACT, created: true }),
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/contacts`);
  assert.strictEqual(requests[0].credentialType, 'slideApi');
  assert.strictEqual(requests[0].qs, undefined);
  assert.deepStrictEqual(requests[0].body, {
    email: 'priya@example.com',
    phone: '+919876543210',
    firstName: 'Priya',
    lastName: 'Sharma',
    company: 'Acme',
    tags: ['vip', 'newsletter'],
  });
  // The answer is passed on as it arrived: the contact, and whether it is new.
  assert.deepStrictEqual(output, [{ json: { ...CONTACT, created: true }, pairedItem: { item: 0 } }]);
});

test('a workflow saved before the Phone field existed still sends its phone', async () => {
  // The old parameter set: Email, and Phone under Additional Fields.
  const { requests } = await run({
    params: upsert({ email: 'priya@example.com', contactFields: { phone: '+919876543210', firstName: 'Priya' } }),
  });

  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/contacts`);
  assert.deepStrictEqual(requests[0].body, {
    email: 'priya@example.com',
    phone: '+919876543210',
    firstName: 'Priya',
  });
});

test('the Phone field wins over the one saved under Additional Fields', async () => {
  const { requests } = await run({
    params: upsert({ email: '', phone: '+919876543210', contactFields: { phone: '+911111111111' } }),
  });
  assert.deepStrictEqual(requests[0].body, { phone: '+919876543210' });
});

test('a phone alone is enough: no email key is sent at all', async () => {
  const { requests } = await run({ params: upsert({ email: '', phone: '+919876543210', contactFields: {} }) });
  assert.deepStrictEqual(requests[0].body, { phone: '+919876543210' });
  assert.strictEqual('email' in requests[0].body, false);
});

test('an email alone is enough: no phone key is sent at all', async () => {
  const { requests } = await run({ params: upsert({ email: 'priya@example.com', contactFields: {} }) });
  assert.deepStrictEqual(requests[0].body, { email: 'priya@example.com' });
});

test('neither email nor phone stops before any request is made', async () => {
  const requests = [];
  await assert.rejects(
    run({
      params: upsert({ email: '  ', phone: '', contactFields: { firstName: 'Priya' } }),
      answer: (options) => {
        requests.push(options);
        return {};
      },
    }),
    (error) => {
      assert.strictEqual(error.message, 'Enter an email address or a phone number');
      assert.match(error.description, /matched by phone first, then by email/);
      return true;
    },
  );
  assert.strictEqual(requests.length, 0);
});

test('a key without contacts:write is told so, and how to fix it', async () => {
  const refusal = () => {
    throw httpError(403, { statusCode: 403, message: 'Insufficient scope. Required: contacts:write', error: 'Forbidden' });
  };

  await assert.rejects(run({ params: upsert({ email: 'priya@example.com', contactFields: {} }), answer: refusal }), (error) => {
    assert.strictEqual(
      error.message,
      'This API key cannot create or update contacts: it needs the permission contacts:write',
    );
    assert.match(error.description, /cannot be edited/);
    assert.match(error.description, /Create a new key that has contacts:write/);
    // Never n8n's stock wording for a 403.
    assert.doesNotMatch(error.message, /perhaps check your credentials/);
    return true;
  });

  // With Continue On Fail the same sentence lands on the item.
  const { output } = await run({
    params: upsert({ email: 'priya@example.com', contactFields: {} }),
    answer: refusal,
    continueOnFail: true,
  });
  assert.deepStrictEqual(output, [
    {
      json: { error: 'This API key cannot create or update contacts: it needs the permission contacts:write' },
      pairedItem: { item: 0 },
    },
  ]);
});

test('a 403 with another cause keeps what Slide said, and is not blamed on the permission', async () => {
  await assert.rejects(
    run({
      params: upsert({ email: 'priya@example.com', contactFields: {} }),
      answer: () => {
        throw httpError(403, { statusCode: 403, message: 'This IP address is not allowed for this API key', error: 'Forbidden' });
      },
    }),
    (error) => {
      assert.doesNotMatch(error.message, /contacts:write/);
      assert.strictEqual(error.description, 'This IP address is not allowed for this API key');
      assert.strictEqual(error.httpCode, '403');
      return true;
    },
  );
});

test('a refusal that is not a 403 passes through with what Slide said', async () => {
  await assert.rejects(
    run({
      params: upsert({ phone: '12', contactFields: {} }),
      answer: () => {
        throw httpError(400, { statusCode: 400, code: 'INVALID_PHONE', message: 'phone could not be read as an international number.' });
      },
    }),
    (error) => {
      assert.strictEqual(error.httpCode, '400');
      assert.strictEqual(error.description, 'phone could not be read as an international number.');
      return true;
    },
  );
});

// ── Two requests about the same person at the same moment ───────────────────
//
// Slide answers 409 with a code that says "send it again": nothing was written,
// and the contact is matched by phone or email, so one more try cannot make a
// second contact. The node sends it again ONCE. Every other refusal is final.

/** Answers each request with the next entry: an Error is thrown, anything else returned. */
const inTurn = (...answers) => {
  let turn = 0;
  return () => {
    const next = answers[Math.min(turn, answers.length - 1)];
    turn += 1;
    if (next instanceof Error) throw next;
    return next;
  };
};

const inProgress = () =>
  httpError(409, {
    statusCode: 409,
    code: 'CONTACT_UPSERT_IN_PROGRESS',
    message: 'Another request is creating this contact. Send it again.',
    retryAfter: 1,
  });
const phoneInUse = () =>
  httpError(409, {
    statusCode: 409,
    code: 'PHONE_IN_USE',
    message: 'This phone number already belongs to another contact in this workspace.',
  });

test('CONTACT_UPSERT_IN_PROGRESS: waits the second Slide asks for, then sends the same contact once more', async () => {
  const started = Date.now();
  const { output, requests } = await run({
    params: upsert({ email: 'priya@example.com', contactFields: { firstName: 'Priya' } }),
    answer: inTurn(inProgress(), { ...CONTACT, created: false }),
  });

  assert.strictEqual(requests.length, 2);
  assert.deepStrictEqual(requests[1].body, requests[0].body);
  assert.strictEqual(requests[1].url, `${BASE_URL}/v1/contacts`);
  assert.ok(Date.now() - started >= 950, 'it waited about a second before the second request');
  assert.deepStrictEqual(output, [{ json: { ...CONTACT, created: false }, pairedItem: { item: 0 } }]);
});

test('PHONE_IN_USE: sends the same contact once more, straight away', async () => {
  const { output, requests } = await run({
    params: upsert({ phone: '+919876543210', contactFields: {} }),
    answer: inTurn(phoneInUse(), { ...CONTACT, created: false }),
  });
  assert.strictEqual(requests.length, 2);
  assert.deepStrictEqual(requests[1].body, { phone: '+919876543210' });
  assert.strictEqual(output[0].json.created, false);
});

test('the second try is the last one: a contact write is sent at most twice', async () => {
  const requests = [];
  const again = inTurn(phoneInUse(), phoneInUse(), { ...CONTACT, created: false });
  await assert.rejects(
    run({
      params: upsert({ phone: '+919876543210', contactFields: {} }),
      answer: (options) => {
        requests.push(options);
        return again();
      },
    }),
    (error) => {
      assert.strictEqual(error.httpCode, '409');
      assert.strictEqual(error.description, 'This phone number already belongs to another contact in this workspace.');
      return true;
    },
  );
  assert.strictEqual(requests.length, 2);
});

test('any other refusal is final: one request, no second try', async () => {
  const finals = [
    httpError(409, { statusCode: 409, code: 'WALLET_LOCKED', reason: 'CONTACT_OVERAGE', message: 'The wallet is locked.' }),
    httpError(409, { statusCode: 409, message: 'A tag could not be created. Retry the request.' }),
    httpError(402, { statusCode: 402, code: 'INSUFFICIENT_BALANCE', reason: 'CONTACT_OVERAGE', message: 'Top up to add more contacts.' }),
    httpError(500, { statusCode: 500, message: 'Internal server error' }),
    httpError(503, { statusCode: 503, code: 'CONTACT_ALLOWANCE_UNAVAILABLE', message: 'Try again.' }),
  ];
  for (const refusal of finals) {
    const requests = [];
    await assert.rejects(
      run({
        params: upsert({ email: 'priya@example.com', contactFields: {} }),
        answer: (options) => {
          requests.push(options);
          throw refusal;
        },
      }),
    );
    assert.strictEqual(requests.length, 1, refusal.response.data.code ?? String(refusal.response.status));
  }
});

test('the Message operations never get a second try, whatever the answer', async () => {
  const requests = [];
  await assert.rejects(
    run({
      params: { resource: 'message', operation: 'send', to: '+919876543210', channel: 'sms', message: 'hi', additionalFields: {} },
      answer: (options) => {
        requests.push(options);
        // Even the code that means "send it again" for a contact means nothing here.
        throw phoneInUse();
      },
    }),
  );
  assert.strictEqual(requests.length, 1);
});

test('contactRetryDelaySeconds answers a delay for the two codes only', () => {
  const answered = (httpCode, data) => ({ httpCode, context: { data } });

  assert.strictEqual(contactRetryDelaySeconds(answered('409', { code: 'PHONE_IN_USE' })), 0);
  assert.strictEqual(contactRetryDelaySeconds(answered('409', { code: 'CONTACT_UPSERT_IN_PROGRESS', retryAfter: 1 })), 1);
  // No number given: one second. A long one is capped, so a node never hangs on it.
  assert.strictEqual(contactRetryDelaySeconds(answered('409', { code: 'CONTACT_UPSERT_IN_PROGRESS' })), 1);
  assert.strictEqual(contactRetryDelaySeconds(answered('409', { code: 'CONTACT_UPSERT_IN_PROGRESS', retryAfter: 600 })), 5);

  assert.strictEqual(contactRetryDelaySeconds(answered('409', { code: 'WALLET_LOCKED' })), null);
  assert.strictEqual(contactRetryDelaySeconds(answered('409', {})), null);
  assert.strictEqual(contactRetryDelaySeconds(answered('500', { code: 'PHONE_IN_USE' })), null);
  assert.strictEqual(contactRetryDelaySeconds({ httpCode: '409' }), null);
  assert.strictEqual(contactRetryDelaySeconds(new Error('timeout')), null);
  assert.strictEqual(contactRetryDelaySeconds(null), null);
});

// ── Search ──────────────────────────────────────────────────────────────────

test('a Search saved before "Search By" existed still sends the free-text search', async () => {
  const { output, requests } = await run({
    params: search({ search: ' priya ', limit: 25 }),
    answer: () => ({ data: [CONTACT], meta: { total: 1, page: 1, limit: 25, totalPages: 1 } }),
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/contacts`);
  assert.strictEqual(requests[0].body, undefined);
  assert.deepStrictEqual(requests[0].qs, { search: 'priya', limit: 25, page: 1 });
  // One item per contact found.
  assert.deepStrictEqual(output, [{ json: CONTACT, pairedItem: { item: 0 } }]);
});

test('Search By Email and Phone use the exact filters', async () => {
  const byEmail = await run({ params: search({ searchBy: 'email', search: ' priya@example.com ', limit: 50 }) });
  assert.deepStrictEqual(byEmail.requests[0].qs, { email: 'priya@example.com', limit: 50, page: 1 });

  const byPhone = await run({ params: search({ searchBy: 'phone', search: '98765 43210', limit: 50 }) });
  assert.deepStrictEqual(byPhone.requests[0].qs, { phone: '98765 43210', limit: 50, page: 1 });

  const anyField = await run({ params: search({ searchBy: 'any', search: 'priya', limit: 50 }) });
  assert.deepStrictEqual(anyField.requests[0].qs, { search: 'priya', limit: 50, page: 1 });
});

test('a Search that finds nobody yields no items rather than failing', async () => {
  const { output } = await run({
    params: search({ searchBy: 'email', search: 'nobody@example.com', limit: 50 }),
    answer: () => ({ data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } }),
  });
  assert.deepStrictEqual(output, []);
});

// ── What a saved workflow depends on ────────────────────────────────────────

test('every parameter a saved contact workflow may hold is still there, under the same name', () => {
  const { properties } = new Slide().description;
  const shownFor = (operation) =>
    properties.filter(
      (property) =>
        property.displayOptions?.show?.resource?.includes('contact') &&
        property.displayOptions?.show?.operation?.includes(operation),
    );

  const searchNames = shownFor('search').map((property) => property.name);
  for (const name of ['search', 'limit']) assert.ok(searchNames.includes(name), name);

  const upsertFields = shownFor('upsert');
  const upsertNames = upsertFields.map((property) => property.name);
  for (const name of ['email', 'contactFields']) assert.ok(upsertNames.includes(name), name);

  const collection = upsertFields.find((property) => property.name === 'contactFields');
  assert.deepStrictEqual(
    collection.options.map((option) => option.name).sort(),
    ['company', 'firstName', 'lastName', 'phone', 'tags'],
  );

  // Email OR Phone: neither may be marked required on its own.
  assert.notStrictEqual(upsertFields.find((property) => property.name === 'email').required, true);
  assert.notStrictEqual(upsertFields.find((property) => property.name === 'phone').required, true);

  // The value a saved workflow has for the new field is its default.
  assert.strictEqual(shownFor('search').find((property) => property.name === 'searchBy').default, 'any');

  // The operation values themselves.
  const contactOperations = properties.find(
    (property) => property.name === 'operation' && property.displayOptions?.show?.resource?.includes('contact'),
  );
  assert.deepStrictEqual(contactOperations.options.map((option) => option.value).sort(), ['search', 'upsert']);
});

test('the Message operations are untouched: Send still posts to /v1/messages/send', async () => {
  const { requests } = await run({
    params: {
      resource: 'message',
      operation: 'send',
      to: ' +919876543210 ',
      channel: 'whatsapp',
      message: ' hi ',
      additionalFields: { fallbackChannels: ['sms'], smsSenderId: 'ACMEIN' },
    },
  });
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/messages/send`);
  assert.deepStrictEqual(requests[0].body, {
    to: '+919876543210',
    channel: 'whatsapp',
    message: 'hi',
    fallbackChannels: ['sms'],
    sms: { senderId: 'ACMEIN' },
  });
});

// ── The 403 that means "missing permission" ─────────────────────────────────

test('isMissingScopeError matches a 403 that names a scope, and nothing else', () => {
  assert.strictEqual(isMissingScopeError({ httpCode: '403', description: 'Insufficient scope. Required: contacts:write' }), true);
  assert.strictEqual(isMissingScopeError({ httpCode: 403, message: 'Insufficient scope. Required: contacts:write' }), true);
  assert.strictEqual(isMissingScopeError({ httpCode: '403', messages: ['Insufficient scope. Required: contacts:write'] }), true);

  assert.strictEqual(isMissingScopeError({ httpCode: '403', description: 'This IP address is not allowed for this API key' }), false);
  assert.strictEqual(isMissingScopeError({ httpCode: '401', description: 'Insufficient scope' }), false);
  assert.strictEqual(isMissingScopeError({ httpCode: '403' }), false);
  assert.strictEqual(isMissingScopeError(new Error('scope')), false);
  assert.strictEqual(isMissingScopeError(null), false);
  assert.strictEqual(isMissingScopeError(undefined), false);
});

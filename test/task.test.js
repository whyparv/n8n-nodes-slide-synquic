/**
 * Task and Task Board operations of the Slide action node.
 *
 * Every operation is driven the way n8n drives it, through a stand-in for the
 * execute context: parameters in, the recorded HTTP requests out. No network.
 *
 * Contract: docs/crm-tasks-public-api.md of the Slide repository (routes,
 * scopes, limits). Task events need no test here: the Slide Trigger loads its
 * event list live from the API, so it has nothing hard-coded to keep in step.
 *
 * Run: npm run build && npm test
 */
const test = require('node:test');
const assert = require('node:assert');

const { Slide } = require('../dist/nodes/Slide/Slide.node.js');
const { SlideTrigger } = require('../dist/nodes/Slide/SlideTrigger.node.js');
const {
  toList,
  toCsv,
  loadTaskBoards,
  loadTaskStatuses,
  loadTaskAssignees,
  loadTaskAssigneesWithUnassigned,
} = require('../dist/nodes/Slide/TaskFunctions.js');

const BASE_URL = 'https://api.example.test';
const TASK_ID = 'c1f0a3e2-5b7d-4c11-9a2e-8f3b6d0e4a71';

const NODE = {
  id: '1',
  name: 'Slide',
  type: 'n8n-nodes-slide-synquic.slide',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

const run = async ({ params, answer = () => ({}), items = [{ json: {} }], continueOnFail = false }) => {
  const requests = [];
  const context = {
    getInputData: () => items,
    getNodeParameter: (name, _index, fallback) => (name in params ? params[name] : fallback),
    getNode: () => NODE,
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

/** A stand-in for n8n's load-options context. */
const loader = ({ current = {}, answers = {} }) => {
  const requests = [];
  const context = {
    getNode: () => NODE,
    getCredentials: async () => ({ apiKey: 'sk_test_PLACEHOLDER', baseUrl: BASE_URL }),
    getCurrentNodeParameter: (path) => current[path],
    helpers: {
      async httpRequestWithAuthentication(_credentialType, options) {
        requests.push(options);
        return answers[options.url.replace(BASE_URL, '')];
      },
    },
  };
  return { context, requests };
};

const httpError = (status, data) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

const task = (params) => ({ resource: 'task', ...params });
const board = (params) => ({ resource: 'taskBoard', ...params });

const TASK = {
  id: TASK_ID,
  title: 'Client review: Q4 ad creatives',
  board: { id: 'b1', name: 'Marketing' },
  status: { id: 's1', name: 'Client review', category: 'IN_PROGRESS' },
  priority: 'HIGH',
};

// ── Create ──────────────────────────────────────────────────────────────────

test('Create posts the task to /v1/tasks with every field mapped', async () => {
  const { output, requests } = await run({
    params: task({
      operation: 'create',
      title: '  Client review  ',
      additionalFields: {
        description: 'Walk the client through the final creatives.',
        boardId: 'b1',
        statusId: 's1',
        priority: 'HIGH',
        assigneeId: 'u1',
        contactId: 'ct_1',
        parentId: 'p1',
        startDate: '2026-11-04',
        dueDate: '2026-11-12T18:29:59.999Z',
        labels: 'client, , q4',
      },
    }),
    answer: () => TASK,
  });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks`);
  assert.strictEqual(requests[0].credentialType, 'slideApi');
  assert.deepStrictEqual(requests[0].body, {
    title: 'Client review',
    description: 'Walk the client through the final creatives.',
    boardId: 'b1',
    statusId: 's1',
    priority: 'HIGH',
    assigneeId: 'u1',
    contactId: 'ct_1',
    parentId: 'p1',
    startDate: '2026-11-04',
    dueDate: '2026-11-12T18:29:59.999Z',
    labels: ['client', 'q4'],
  });
  assert.deepStrictEqual(output, [{ json: TASK, pairedItem: { item: 0 } }]);
});

test('Create with only a title sends only the title: blank fields are never sent', async () => {
  const { requests } = await run({
    params: task({
      operation: 'create',
      title: 'Call back',
      additionalFields: { description: '', boardId: '', assigneeId: '  ', labels: ' , ', dueDate: '' },
    }),
  });
  assert.deepStrictEqual(requests[0].body, { title: 'Call back' });
});

test('Create without a title stops before any request is made', async () => {
  const requests = [];
  await assert.rejects(
    run({
      params: task({ operation: 'create', title: '   ', additionalFields: {} }),
      answer: (options) => requests.push(options),
    }),
    (error) => {
      assert.match(error.message, /Enter a title/);
      return true;
    },
  );
  assert.strictEqual(requests.length, 0);
});

test('a date that is not a date is refused with the field name, before any request', async () => {
  await assert.rejects(
    run({ params: task({ operation: 'create', title: 'x', additionalFields: { dueDate: 'next friday' } }) }),
    (error) => {
      assert.match(error.message, /Due Date is not a valid date/);
      return true;
    },
  );
});

// ── Get, Complete, Delete ───────────────────────────────────────────────────

test('Get reads one task', async () => {
  const { requests, output } = await run({
    params: task({ operation: 'get', taskId: ` ${TASK_ID} ` }),
    answer: () => ({ ...TASK, subtasks: [], attachments: [] }),
  });
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}`);
  assert.strictEqual(requests[0].body, undefined);
  assert.strictEqual(output.length, 1);
});

test('a blank task ID is refused before any request is made', async () => {
  for (const operation of ['get', 'update', 'complete', 'delete', 'addComment', 'getComments']) {
    const requests = [];
    await assert.rejects(
      run({
        params: task({ operation, taskId: '  ', comment: 'x', updateFields: { title: 'x' } }),
        answer: (options) => requests.push(options),
      }),
      /Enter the task ID/,
      operation,
    );
    assert.strictEqual(requests.length, 0, operation);
  }
});

test('Complete posts done: true by default, and done: false to reopen', async () => {
  const done = await run({ params: task({ operation: 'complete', taskId: TASK_ID }) });
  assert.strictEqual(done.requests[0].method, 'POST');
  assert.strictEqual(done.requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}/complete`);
  assert.deepStrictEqual(done.requests[0].body, { done: true });

  const reopened = await run({ params: task({ operation: 'complete', taskId: TASK_ID, done: false }) });
  assert.deepStrictEqual(reopened.requests[0].body, { done: false });
});

test('Delete sends DELETE and hands on how many were deleted', async () => {
  const { requests, output } = await run({
    params: task({ operation: 'delete', taskId: TASK_ID }),
    answer: () => ({ deleted: 3 }),
  });
  assert.strictEqual(requests[0].method, 'DELETE');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}`);
  assert.deepStrictEqual(output, [{ json: { deleted: 3 }, pairedItem: { item: 0 } }]);
});

test('a task ID is encoded into the path', async () => {
  const { requests } = await run({ params: task({ operation: 'get', taskId: 'a/b c' }) });
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/a%2Fb%20c`);
});

// ── Update ──────────────────────────────────────────────────────────────────

test('Update patches only the fields that were set', async () => {
  const { requests } = await run({
    params: task({
      operation: 'update',
      taskId: TASK_ID,
      updateFields: { title: 'New title', priority: 'URGENT', dueDate: '2026-11-20', description: '' },
      clearFields: [],
    }),
  });
  assert.strictEqual(requests[0].method, 'PATCH');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}`);
  assert.deepStrictEqual(requests[0].body, { title: 'New title', priority: 'URGENT', dueDate: '2026-11-20' });
});

test('Clear Fields sends null (a list for labels) and nothing else changes', async () => {
  const { requests } = await run({
    params: task({
      operation: 'update',
      taskId: TASK_ID,
      updateFields: {},
      clearFields: ['assigneeId', 'contactId', 'description', 'startDate', 'dueDate', 'labels'],
    }),
  });
  assert.deepStrictEqual(requests[0].body, {
    assigneeId: null,
    contactId: null,
    description: null,
    startDate: null,
    dueDate: null,
    labels: [],
  });
});

test('a field that is both set and cleared is refused, and so is an empty update', async () => {
  await assert.rejects(
    run({
      params: task({
        operation: 'update',
        taskId: TASK_ID,
        updateFields: { dueDate: '2026-11-20' },
        clearFields: ['dueDate'],
      }),
    }),
    /both set and cleared/,
  );

  const requests = [];
  await assert.rejects(
    run({
      params: task({ operation: 'update', taskId: TASK_ID, updateFields: { title: ' ' }, clearFields: [] }),
      answer: (options) => requests.push(options),
    }),
    /Choose at least one field to change/,
  );
  assert.strictEqual(requests.length, 0);
});

// ── Comments ────────────────────────────────────────────────────────────────

test('Add Comment posts the body to the task', async () => {
  const COMMENT = { id: 'cm1', body: 'Approved', source: 'api' };
  const { requests, output } = await run({
    params: task({ operation: 'addComment', taskId: TASK_ID, comment: ' Approved ' }),
    answer: () => COMMENT,
  });
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}/comments`);
  assert.deepStrictEqual(requests[0].body, { body: 'Approved' });
  assert.deepStrictEqual(output, [{ json: COMMENT, pairedItem: { item: 0 } }]);
});

test('an empty comment is refused before any request', async () => {
  await assert.rejects(
    run({ params: task({ operation: 'addComment', taskId: TASK_ID, comment: '  ' }) }),
    /Enter the comment/,
  );
});

test('Get Comments yields one item per comment, within the limit', async () => {
  const { requests, output } = await run({
    params: task({ operation: 'getComments', taskId: TASK_ID, returnAll: false, limit: 2 }),
    answer: () => ({
      data: [{ id: 'cm1' }, { id: 'cm2' }, { id: 'cm3' }],
      meta: { total: 3, page: 1, limit: 2, totalPages: 2 },
    }),
  });
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks/${TASK_ID}/comments`);
  assert.deepStrictEqual(requests[0].qs, { page: 1, limit: 2 });
  assert.deepStrictEqual(
    output.map((item) => item.json.id),
    ['cm1', 'cm2'],
  );
});

// ── Get Many ────────────────────────────────────────────────────────────────

test('Get Many sends the filters as the query string', async () => {
  const { requests } = await run({
    params: task({
      operation: 'getAll',
      returnAll: false,
      limit: 25,
      filters: {
        boardId: 'b1',
        statusIds: ['s1', 's2'],
        categories: ['TODO', 'IN_PROGRESS'],
        assigneeIds: ['none', 'u1'],
        priorities: ['URGENT', 'HIGH'],
        labels: 'client, q4',
        contactId: 'ct_1',
        dueFrom: '2026-11-01',
        dueTo: '2026-11-30',
        overdue: true,
        search: 'creatives',
        includeSubtasks: true,
        sort: 'dueDate',
        dir: 'desc',
      },
    }),
    answer: () => ({ data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } }),
  });
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/tasks`);
  assert.deepStrictEqual(requests[0].qs, {
    boardId: 'b1',
    statusIds: 's1,s2',
    categories: 'TODO,IN_PROGRESS',
    assigneeIds: 'none,u1',
    priorities: 'URGENT,HIGH',
    labels: 'client,q4',
    contactId: 'ct_1',
    dueFrom: '2026-11-01',
    dueTo: '2026-11-30',
    overdue: 'true',
    search: 'creatives',
    includeSubtasks: 'true',
    sort: 'dueDate',
    dir: 'desc',
    page: 1,
    limit: 25,
  });
});

test('Get Many with no filters sends only the page; switches that are off are not sent', async () => {
  const { requests, output } = await run({
    params: task({
      operation: 'getAll',
      returnAll: false,
      limit: 50,
      filters: { overdue: false, includeSubtasks: false, search: '', statusIds: [] },
    }),
    answer: () => ({ data: [TASK], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }),
  });
  assert.deepStrictEqual(requests[0].qs, { page: 1, limit: 50 });
  assert.deepStrictEqual(output, [{ json: TASK, pairedItem: { item: 0 } }]);
});

test('Get Many with Return All walks every page at one fixed page size', async () => {
  const pages = { 1: [{ id: 'a' }, { id: 'b' }], 2: [{ id: 'c' }, { id: 'd' }], 3: [{ id: 'e' }] };
  const { requests, output } = await run({
    params: task({ operation: 'getAll', returnAll: true, limit: 1, filters: {} }),
    answer: (options) => ({
      data: pages[options.qs.page],
      meta: { total: 5, page: options.qs.page, limit: options.qs.limit, totalPages: 3 },
    }),
  });
  assert.deepStrictEqual(
    requests.map((request) => request.qs),
    [
      { page: 1, limit: 100 },
      { page: 2, limit: 100 },
      { page: 3, limit: 100 },
    ],
  );
  assert.deepStrictEqual(
    output.map((item) => item.json.id),
    ['a', 'b', 'c', 'd', 'e'],
  );
});

test('Get Many with a Limit stops as soon as it has enough, and returns no more than asked', async () => {
  const { requests, output } = await run({
    params: task({ operation: 'getAll', returnAll: false, limit: 3, filters: {} }),
    answer: (options) => ({
      data: options.qs.page === 1 ? [{ id: 'a' }, { id: 'b' }, { id: 'c' }] : [{ id: 'z' }],
      meta: { total: 9, page: options.qs.page, limit: 3, totalPages: 3 },
    }),
  });
  assert.strictEqual(requests.length, 1);
  assert.deepStrictEqual(requests[0].qs, { page: 1, limit: 3 });
  assert.strictEqual(output.length, 3);
});

test('a Limit above one page is read across pages, and a list that ends early ends the loop', async () => {
  const { requests, output } = await run({
    params: task({ operation: 'getAll', returnAll: false, limit: 150, filters: {} }),
    answer: (options) => ({
      data: options.qs.page === 1 ? Array.from({ length: 100 }, (_, n) => ({ id: `r${n}` })) : [{ id: 'last' }],
      meta: { total: 101, page: options.qs.page, limit: 100, totalPages: 2 },
    }),
  });
  assert.deepStrictEqual(
    requests.map((request) => request.qs),
    [
      { page: 1, limit: 100 },
      { page: 2, limit: 100 },
    ],
  );
  assert.strictEqual(output.length, 101);
});

test('Get Many that finds nothing yields no items rather than failing', async () => {
  const { output } = await run({
    params: task({ operation: 'getAll', returnAll: true, filters: {} }),
    answer: () => ({ data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 0 } }),
  });
  assert.deepStrictEqual(output, []);
});

// ── Task Board ──────────────────────────────────────────────────────────────

test('Task Board Get Many yields one item per board', async () => {
  const BOARDS = [
    { id: 'b1', name: 'Marketing', openTaskCount: 4 },
    { id: 'b2', name: 'Software', openTaskCount: 0 },
  ];
  const { requests, output } = await run({
    params: board({ operation: 'getAll' }),
    answer: () => ({ data: BOARDS }),
  });
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/task-boards`);
  assert.deepStrictEqual(
    output.map((item) => item.json),
    BOARDS,
  );
});

test('Task Board Get reads one board', async () => {
  const { requests } = await run({ params: board({ operation: 'get', boardId: 'b1' }) });
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/task-boards/b1`);
  await assert.rejects(run({ params: board({ operation: 'get', boardId: ' ' }) }), /Enter the board/);
});

test('Task Board Create posts the board with its options mapped', async () => {
  const { requests } = await run({
    params: board({
      operation: 'create',
      name: ' Campaigns ',
      boardFields: {
        description: 'Q4 push',
        color: '#d4e157',
        visibility: 'PRIVATE',
        template: 'marketing',
        memberIds: ['u1', 'u2'],
      },
    }),
  });
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].url, `${BASE_URL}/v1/task-boards`);
  assert.deepStrictEqual(requests[0].body, {
    name: 'Campaigns',
    description: 'Q4 push',
    color: '#d4e157',
    visibility: 'PRIVATE',
    template: 'marketing',
    memberIds: ['u1', 'u2'],
  });

  const bare = await run({ params: board({ operation: 'create', name: 'Ops', boardFields: {} }) });
  assert.deepStrictEqual(bare.requests[0].body, { name: 'Ops' });

  await assert.rejects(run({ params: board({ operation: 'create', name: ' ', boardFields: {} }) }), /Enter a name/);
});

test('a duplicate board name keeps what Slide said', async () => {
  await assert.rejects(
    run({
      params: board({ operation: 'create', name: 'Marketing', boardFields: {} }),
      answer: () => {
        throw httpError(409, { statusCode: 409, message: 'A board named "Marketing" already exists' });
      },
    }),
    (error) => {
      assert.strictEqual(error.httpCode, '409');
      assert.match(error.description, /already exists/);
      return true;
    },
  );
});

// ── Permissions ─────────────────────────────────────────────────────────────

test('a key missing a permission is told which one, and how to fix it', async () => {
  const refused = (scope) => () => {
    throw httpError(403, { statusCode: 403, message: `Insufficient scope. Required: ${scope}`, error: 'Forbidden' });
  };
  const cases = [
    [task({ operation: 'getAll', filters: {} }), 'tasks:read', 'read tasks'],
    [task({ operation: 'create', title: 'x', additionalFields: {} }), 'tasks:write', 'create or change tasks'],
    [task({ operation: 'delete', taskId: TASK_ID }), 'tasks:delete', 'delete tasks'],
    [board({ operation: 'getAll' }), 'tasks:read', 'read tasks'],
    [board({ operation: 'create', name: 'x', boardFields: {} }), 'tasks:write', 'create or change tasks'],
  ];

  for (const [params, scope, action] of cases) {
    await assert.rejects(run({ params, answer: refused(scope) }), (error) => {
      assert.strictEqual(error.message, `This API key cannot ${action}: it needs the permission ${scope}`);
      assert.match(error.description, new RegExp(`Create a new key that has ${scope}`));
      assert.doesNotMatch(error.message, /perhaps check your credentials/);
      return true;
    });
  }
});

test('a 403 with another cause is not blamed on a permission', async () => {
  await assert.rejects(
    run({
      params: task({ operation: 'get', taskId: TASK_ID }),
      answer: () => {
        throw httpError(403, { statusCode: 403, message: 'This IP address is not allowed for this API key' });
      },
    }),
    (error) => {
      assert.doesNotMatch(error.message, /needs the permission/);
      assert.strictEqual(error.description, 'This IP address is not allowed for this API key');
      return true;
    },
  );
});

test('a task that is not in this workspace passes the 404 through', async () => {
  await assert.rejects(
    run({
      params: task({ operation: 'get', taskId: TASK_ID }),
      answer: () => {
        throw httpError(404, { statusCode: 404, message: 'Task not found' });
      },
    }),
    (error) => {
      assert.strictEqual(error.httpCode, '404');
      return true;
    },
  );
});

test('Continue On Fail puts the failure on the item and carries on', async () => {
  const { output } = await run({
    params: task({ operation: 'get', taskId: TASK_ID }),
    items: [{ json: {} }, { json: {} }],
    continueOnFail: true,
    answer: (() => {
      let calls = 0;
      return () => {
        calls += 1;
        if (calls === 1) throw httpError(404, { statusCode: 404, message: 'Task not found' });
        return TASK;
      };
    })(),
  });
  assert.strictEqual(output.length, 2);
  assert.ok(output[0].json.error);
  assert.deepStrictEqual(output[1].json, TASK);
});

test('a task or comment is never sent a second time: a failed write makes exactly one request', async () => {
  for (const params of [
    task({ operation: 'create', title: 'x', additionalFields: {} }),
    task({ operation: 'addComment', taskId: TASK_ID, comment: 'x' }),
    board({ operation: 'create', name: 'x', boardFields: {} }),
  ]) {
    const requests = [];
    await assert.rejects(
      run({
        params,
        answer: (options) => {
          requests.push(options);
          throw httpError(409, { statusCode: 409, code: 'CONTACT_UPSERT_IN_PROGRESS', retryAfter: 1, message: 'busy' });
        },
      }),
    );
    assert.strictEqual(requests.length, 1);
  }
});

// ── The node's declared fields ──────────────────────────────────────────────

const properties = new Slide().description.properties;
const declared = (resource, operation) =>
  properties
    .filter(
      (property) =>
        property.displayOptions?.show?.resource?.includes(resource) &&
        (!operation || property.displayOptions?.show?.operation?.includes(operation)),
    )
    .map((property) => property.name);
const collectionKeys = (name, resource, operation) =>
  properties
    .find(
      (property) =>
        property.name === name &&
        property.displayOptions?.show?.resource?.includes(resource) &&
        property.displayOptions?.show?.operation?.includes(operation),
    )
    .options.map((option) => option.name);

test('every operation offers the fields it reads, under the names the code reads', () => {
  assert.deepStrictEqual(
    new Set(declared('task', 'create')),
    new Set(['title', 'additionalFields']),
  );
  assert.deepStrictEqual(
    collectionKeys('additionalFields', 'task', 'create').sort(),
    ['assigneeId', 'boardId', 'contactId', 'description', 'dueDate', 'labels', 'parentId', 'priority', 'startDate', 'statusId'],
  );
  assert.deepStrictEqual(
    collectionKeys('updateFields', 'task', 'update').sort(),
    ['assigneeId', 'boardId', 'contactId', 'description', 'dueDate', 'labels', 'priority', 'startDate', 'statusId', 'title'],
  );
  assert.deepStrictEqual(
    properties
      .find((property) => property.name === 'clearFields')
      .options.map((option) => option.value)
      .sort(),
    ['assigneeId', 'contactId', 'description', 'dueDate', 'labels', 'startDate'],
  );
  assert.deepStrictEqual(
    collectionKeys('filters', 'task', 'getAll').sort(),
    [
      'assigneeIds', 'boardId', 'categories', 'contactId', 'dir', 'dueFrom', 'dueTo', 'includeSubtasks',
      'labels', 'overdue', 'priorities', 'search', 'sort', 'statusIds',
    ],
  );
  assert.deepStrictEqual(
    collectionKeys('boardFields', 'taskBoard', 'create').sort(),
    ['color', 'description', 'memberIds', 'template', 'visibility'],
  );
  for (const operation of ['get', 'update', 'complete', 'delete', 'addComment', 'getComments']) {
    assert.ok(declared('task', operation).includes('taskId'), `taskId on ${operation}`);
  }
  assert.ok(declared('task', 'complete').includes('done'));
  assert.ok(declared('task', 'addComment').includes('comment'));
  for (const operation of ['getAll', 'getComments']) {
    assert.ok(declared('task', operation).includes('returnAll'), `returnAll on ${operation}`);
    assert.ok(declared('task', operation).includes('limit'), `limit on ${operation}`);
  }
});

test('every load-options method a task field names exists on the node', () => {
  const methods = Object.keys(new Slide().methods.loadOptions);
  const named = [];
  const walk = (list) => {
    for (const property of list) {
      if (property.typeOptions?.loadOptionsMethod) named.push(property.typeOptions.loadOptionsMethod);
      if (property.options) walk(property.options.filter((option) => option.typeOptions || option.options));
    }
  };
  walk(properties);
  for (const method of ['getTaskBoards', 'getTaskStatuses', 'getTaskAssignees', 'getTaskAssigneesWithUnassigned']) {
    assert.ok(named.includes(method), `${method} is used by a field`);
  }
  for (const method of named) assert.ok(methods.includes(method), `${method} exists`);
});

test('the resources and operations that existed before are still there', () => {
  const resource = properties.find((property) => property.name === 'resource');
  assert.deepStrictEqual(
    resource.options.map((option) => option.value),
    ['message', 'contact', 'task', 'taskBoard'],
  );
  assert.deepStrictEqual(declared('contact', 'search').length > 0, true);
});

test('the trigger lists no event by name: task events arrive from the live catalogue', () => {
  const trigger = new SlideTrigger();
  const events = trigger.description.properties.find((property) => property.name === 'events');
  assert.strictEqual(events.typeOptions.loadOptionsMethod, 'getEvents');
  assert.strictEqual(events.options, undefined);
});

// ── Pickers ─────────────────────────────────────────────────────────────────

const BOARDS = {
  data: [
    { id: 'b1', name: 'Marketing', isDefault: true, statuses: [{ id: 's1', name: 'To do' }, { id: 's2', name: 'Done' }] },
    { id: 'b2', name: 'Software', statuses: [{ id: 's3', name: 'Backlog' }] },
  ],
};

test('the board picker lists boards by name', async () => {
  const { context } = loader({ answers: { '/v1/task-boards': BOARDS } });
  assert.deepStrictEqual(await loadTaskBoards.call(context), [
    { name: 'Marketing', value: 'b1' },
    { name: 'Software', value: 'b2' },
  ]);
});

test('the stage picker lists the chosen board only, or every board by Board: Stage', async () => {
  const chosen = loader({ current: { 'additionalFields.boardId': 'b2' }, answers: { '/v1/task-boards': BOARDS } });
  assert.deepStrictEqual(await loadTaskStatuses.call(chosen.context), [{ name: 'Backlog', value: 's3' }]);

  const none = loader({ answers: { '/v1/task-boards': BOARDS } });
  assert.deepStrictEqual(await loadTaskStatuses.call(none.context), [
    { name: 'Marketing: To do', value: 's1' },
    { name: 'Marketing: Done', value: 's2' },
    { name: 'Software: Backlog', value: 's3' },
  ]);

  // An expression is not a board yet, so it narrows nothing.
  const expression = loader({ current: { boardId: '={{ $json.board }}' }, answers: { '/v1/task-boards': BOARDS } });
  assert.strictEqual((await loadTaskStatuses.call(expression.context)).length, 3);
});

test('the assignee picker lists members, narrowed to the chosen board, with Unassigned for filters', async () => {
  const MEMBERS = { data: [{ id: 'u1', name: 'Asha Rao', email: 'asha@example.com', role: 'ADMIN' }] };

  const all = loader({ answers: { '/v1/tasks/assignees': MEMBERS } });
  assert.deepStrictEqual(await loadTaskAssignees.call(all.context), [
    { name: 'Asha Rao (asha@example.com)', value: 'u1' },
  ]);
  assert.strictEqual(all.requests[0].qs, undefined);

  const narrowed = loader({ current: { 'filters.boardId': 'b2' }, answers: { '/v1/tasks/assignees': MEMBERS } });
  await loadTaskAssignees.call(narrowed.context);
  assert.deepStrictEqual(narrowed.requests[0].qs, { boardId: 'b2' });

  const withNone = loader({ answers: { '/v1/tasks/assignees': MEMBERS } });
  assert.deepStrictEqual((await loadTaskAssigneesWithUnassigned.call(withNone.context))[0], {
    name: 'Unassigned',
    value: 'none',
  });
});

test('toList and toCsv drop blanks and accept a list or a comma-separated text', () => {
  assert.deepStrictEqual(toList(' a, ,b '), ['a', 'b']);
  assert.deepStrictEqual(toList(['a', ' ', 'b']), ['a', 'b']);
  assert.deepStrictEqual(toList(undefined), []);
  assert.strictEqual(toCsv(['x', 'y']), 'x,y');
  assert.strictEqual(toCsv(''), '');
});

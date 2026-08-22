/**
 * Signature verification tests.
 *
 * Two layers, deliberately:
 *
 * 1. GOLDEN VECTORS (always run) — test/vectors.json holds signatures produced
 *    by the Slide backend's own signer. Verifying them proves this node accepts
 *    what the service actually sends. Self-contained, so it works in this
 *    standalone repository and in CI.
 *
 * 2. LIVE PARITY (only inside the Slide monorepo) — if the backend build is
 *    present, sign fresh payloads with it and verify those too. This is what
 *    catches a scheme change at the source, before it reaches the vectors.
 *
 * Why both: vectors alone would silently keep passing if the service changed
 * its scheme, and live parity alone cannot run outside the monorepo.
 *
 * Run: npm run build && npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const { createHmac } = require('crypto');

const { verifySlideSignature } = require('../dist/nodes/Slide/GenericFunctions.js');
const { vectors } = require('./vectors.json');

/** Vectors carry a fixed past timestamp, so age must not be what rejects them. */
const IGNORE_AGE = Number.MAX_SAFE_INTEGER;

/** Local signer used only to build fresh cases for the time-window tests. */
const signNow = (body, secret, ts = Math.floor(Date.now() / 1000)) =>
  `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex')}`;

// ── 1. Golden vectors from the real backend signer ──────────────────────────

for (const v of vectors) {
  test(`accepts a real backend signature: ${v.label}`, () => {
    assert.strictEqual(verifySlideSignature(v.body, v.signature, v.secret, IGNORE_AGE), true);
  });

  test(`rejects a tampered body: ${v.label}`, () => {
    assert.strictEqual(verifySlideSignature(v.body + ' ', v.signature, v.secret, IGNORE_AGE), false);
  });

  test(`rejects the wrong secret: ${v.label}`, () => {
    assert.strictEqual(verifySlideSignature(v.body, v.signature, 'whsec_wrong', IGNORE_AGE), false);
  });
}

// ── 2. Time window, replay, and malformed input ─────────────────────────────

const body = vectors[0].body;
const secret = vectors[0].secret;

test('accepts a freshly signed payload', () => {
  assert.strictEqual(verifySlideSignature(body, signNow(body, secret), secret), true);
});

test('rejects stale and far-future timestamps', () => {
  const now = Math.floor(Date.now() / 1000);
  assert.strictEqual(verifySlideSignature(body, signNow(body, secret, now - 600), secret), false);
  assert.strictEqual(verifySlideSignature(body, signNow(body, secret, now + 600), secret), false);
});

test('tolerates modest clock drift between Slide and the n8n host', () => {
  const drifted = Math.floor(Date.now() / 1000) - 120;
  assert.strictEqual(verifySlideSignature(body, signNow(body, secret, drifted), secret), true);
});

test('a captured delivery cannot be replayed by rewriting the timestamp', () => {
  const old = Math.floor(Date.now() / 1000) - 600;
  const header = signNow(body, secret, old);
  const forged = header.replace(`t=${old}`, `t=${Math.floor(Date.now() / 1000)}`);
  assert.strictEqual(verifySlideSignature(body, forged, secret), false);
});

test('rejects malformed input without throwing', () => {
  for (const header of ['', 'garbage', `t=${Math.floor(Date.now() / 1000)},v1=zzzz`, 't=abc,v1=def']) {
    assert.strictEqual(verifySlideSignature(body, header, secret), false);
  }
  assert.strictEqual(verifySlideSignature('', signNow(body, secret), secret), false);
  assert.strictEqual(verifySlideSignature(body, signNow(body, secret), ''), false);
});

test('accepts a header carrying several v1 values during secret rotation', () => {
  const ts = Math.floor(Date.now() / 1000);
  const good = signNow(body, secret, ts).split(',')[1];
  const other = signNow(body, 'whsec_other', ts).split(',')[1];
  assert.strictEqual(verifySlideSignature(body, `t=${ts},${other},${good}`, secret), true);
});

// ── 3. Live parity — only when the Slide backend build is available ─────────

let backend = null;
try {
  backend = require('./../../backend/dist/src/outbound-webhooks/utils/webhook-signature.util.js');
} catch {
  // Expected in the standalone repo and in CI. The golden vectors above already
  // pin agreement with the service; this block only adds same-repo drift detection.
}

test('live parity with the backend signer (skipped outside the monorepo)', { skip: !backend }, () => {
  const freshSecret = backend.generateWebhookSecret();
  const payload = JSON.stringify({ id: backend.generateEventId(), type: 'contact.created', data: { x: 1 } });
  assert.strictEqual(
    verifySlideSignature(payload, backend.signWebhookPayload(payload, freshSecret), freshSecret),
    true,
    'the backend signing scheme has changed — regenerate test/vectors.json',
  );
});

// ── WhatsApp template component building ────────────────────────────────────
//
// A template whose button carries a variable (dynamic URL, copy code) is
// rejected by WhatsApp with error 131008 unless the button parameter is sent.
// Slide auto-fills quick-reply payloads; these it cannot infer.

const { Slide } = require('../dist/nodes/Slide/Slide.node.js');

const runTemplateSend = async (params) => {
  const captured = [];
  const ctx = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, _i, fallback) =>
      name in params ? params[name] : fallback,
    getNode: () => ({ name: 'Slide' }),
    continueOnFail: () => false,
    getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://example.com' }),
    helpers: {
      httpRequestWithAuthentication: async (_c, options) => {
        captured.push(options);
        return { ok: true };
      },
    },
  };
  await Slide.prototype.execute.call(ctx);
  return captured[0].body;
};

test('sends a URL button parameter so WhatsApp does not reject with 131008', async () => {
  const body = await runTemplateSend({
    resource: 'message',
    operation: 'sendWhatsAppTemplate',
    to: '+919926446622',
    templateName: 'verification',
    languageCode: 'en',
    bodyVariables: '123456',
    buttonVariables: { button: [{ index: 0, buttonType: 'url', value: '123456' }] },
  });

  const button = body.components.find((c) => c.type === 'button');
  assert.ok(button, 'a button component must be sent');
  assert.strictEqual(button.sub_type, 'url');
  // Meta requires index as a string; a number is rejected.
  assert.strictEqual(button.index, '0');
  assert.deepStrictEqual(button.parameters, [{ type: 'text', text: '123456' }]);
});

test('copy-code buttons use the coupon_code parameter shape', async () => {
  const body = await runTemplateSend({
    resource: 'message',
    operation: 'sendWhatsAppTemplate',
    to: '+919926446622',
    templateName: 'promo',
    languageCode: 'en',
    buttonVariables: { button: [{ index: 1, buttonType: 'copy_code', value: 'SAVE20' }] },
  });
  const button = body.components.find((c) => c.type === 'button');
  assert.strictEqual(button.sub_type, 'copy_code');
  assert.strictEqual(button.index, '1');
  assert.deepStrictEqual(button.parameters, [{ type: 'coupon_code', coupon_code: 'SAVE20' }]);
});

test('body and button components are sent together, body first', async () => {
  const body = await runTemplateSend({
    resource: 'message',
    operation: 'sendWhatsAppTemplate',
    to: '+919926446622',
    templateName: 'verification',
    languageCode: 'en',
    bodyVariables: 'Priya,,#1042',
    buttonVariables: { button: [{ index: 0, buttonType: 'url', value: 'abc' }] },
  });
  assert.strictEqual(body.components[0].type, 'body');
  assert.strictEqual(body.components[1].type, 'button');
  // Blank middle variable keeps its slot — see the positional test above.
  assert.deepStrictEqual(
    body.components[0].parameters.map((p) => p.text),
    ['Priya', '', '#1042'],
  );
});

test('a template with no variables sends no components at all', async () => {
  const body = await runTemplateSend({
    resource: 'message',
    operation: 'sendWhatsAppTemplate',
    to: '+919926446622',
    templateName: 'hello',
    languageCode: 'en',
  });
  assert.strictEqual(body.components, undefined);
});

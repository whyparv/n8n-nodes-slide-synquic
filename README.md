# n8n-nodes-slide-synquic

An [n8n](https://n8n.io) community node package for **Slide by Synquic**. It gives n8n two nodes: a **Slide Trigger** that starts a workflow in real time when something happens in your Slide account (a contact is created, a WhatsApp or Instagram message arrives, an email is opened, a voice call completes, a Shopify order is placed), and a **Slide** action node that sends messages across WhatsApp, SMS, RCS, Email, and Instagram and reads or upserts contacts. Triggers are webhook-based, not polled: activating a workflow subscribes an endpoint, deactivating it removes the subscription.

[Installation](#installation) · [Credentials](#credentials) · [Nodes](#nodes) · [How it works](#how-it-works) · [Compatibility](#compatibility)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and enter the package name:

```
n8n-nodes-slide-synquic
```

On a self-hosted instance you can instead install it into your n8n custom nodes directory:

```bash
npm install n8n-nodes-slide-synquic
```

## What it provides

| Node | Type | Credential | What it does |
|---|---|---|---|
| **Slide Trigger** (`slideTrigger`) | Trigger (webhook, `POST`) | Slide API (`slideApi`) | Starts a workflow on one or more Slide account events. |
| **Slide** (`slide`) | Action | Slide API (`slideApi`) | Sends messages and manages contacts. |

### Slide, resources and operations

| Resource | Operation | What it does |
|---|---|---|
| Message | **Send** | Sends over a chosen channel (WhatsApp, SMS, RCS, Email, Instagram) with optional ordered fallback to another phone-based channel. |
| Message | **Send WhatsApp Template** | Sends an approved WhatsApp template, with positional body variables and URL or copy-code button variables. |
| Message | **Send Email** | Sends a transactional email from one of your templates, with template variables, subject override and reply-to. |
| Message | **Send SMS** | Sends an SMS from a registered sender id, with optional DLT template id and transactional or promotional route. |
| Contact | **Search** | Finds contacts by email, phone, or name, with a result limit. |
| Contact | **Create or Update** | Upserts a contact by email, with first and last name, phone, company and tags. |

Template pickers (email templates, WhatsApp templates) and the SMS sender picker are loaded live from your account, so you select a real template rather than typing an id and discovering the typo at run time. Each also accepts an expression if you need a dynamic value.

### Slide Trigger, events and options

The event list is fetched live from your account when you open the node, so events added to Slide later appear without you updating the package. One trigger node can listen to several events at once. Available events include contact created, contact updated, contact lifecycle stage changed, form submitted, inbound WhatsApp, Instagram and SMS messages, WhatsApp message status, completed voice calls, email delivered, opened, clicked, bounced and complained, and Shopify order created and fulfilled.

| Option | Default | Effect |
|---|---|---|
| **Verify Signature** | on | Rejects deliveries whose HMAC signature does not match. Your webhook URL is not a secret, so this is what stops anyone who learns it from injecting events into your workflow. |
| **Raw Payload** | off | Emits the full envelope (`id`, `type`, `createdAt`, `accountId`, `livemode`, `data`) instead of flattening the event data to the top level. |
| **Include Test Deliveries** | on | Runs the workflow for test deliveries sent from the Slide dashboard. Turn off in production so only real account activity triggers it. |

With the default (flattened) output, the event data is spread to the top level and `eventId`, `eventType`, `occurredAt`, `accountId`, and `livemode` are added on top, so a payload field named `id` can never shadow the event id you would use for idempotency downstream.

## Credentials

Create an API key in your Slide dashboard under **Admin, API Keys**, then add a **Slide API** credential in n8n.

| Field | Notes |
|---|---|
| **API Key** | Your Slide API key. Stored as a password field and sent as a Bearer token on every request. |
| **Base URL** | Defaults to the Slide production API. Change it only when pointing at a self-hosted or staging instance. |

The credential's **Test** button calls the webhook event catalogue, so it doubles as a scope check: a key that cannot read the catalogue is useless for every trigger in this package, and failing at save time is kinder than a trigger that saves cleanly and never fires.

Required scopes:

| Use | Scope |
|---|---|
| Any trigger | `webhooks:read`, `webhooks:write` |
| Send / Send WhatsApp Template | `whatsapp:send` |
| Send Email | `email:send` |
| Send SMS | `sms:send` |
| Contact search | `contacts:read` |
| Contact create or update | `email:contacts:write` |

## How it works

**Requests.** Every call goes through one helper that builds the URL from the credential's base URL; the `Authorization: Bearer` header is injected by the credential itself, so it cannot be forgotten by a new request. API errors are wrapped as n8n node errors so the Slide message (for example a missing scope) is shown in the UI instead of a bare status code. The action node honours **Continue On Fail**, emitting an `error` item for the failing input row and carrying on with the rest.

**Subscription lifecycle.** Activating a workflow creates a webhook endpoint on your account pointing at the n8n webhook URL, and stores the returned id and signing secret in the workflow's static data. The signing secret is returned exactly once at creation, so that is the only moment it can be captured. Before creating, n8n checks whether the stored endpoint still exists **and** still points at the current webhook URL, so a workflow moved to a new host resubscribes rather than sitting silently attached to a stale URL. Deactivating deletes the endpoint (an already-deleted endpoint is treated as success) and clears the stored id and secret.

**Signature verification.** Deliveries carry an `X-Slide-Signature` header holding a timestamp (`t=`) and one or more HMAC-SHA256 digests (`v1=`, more than one during a secret rotation). The node computes the HMAC over `<timestamp>.<raw body>` using the stored secret and compares in constant time, rejecting anything outside a five-minute window in either direction (a two-sided check, so an n8n host whose clock runs slightly behind does not reject everything). Verification uses the **raw** request bytes: re-serialising parsed JSON reorders keys and changes the hash, which is the usual cause of "every delivery fails to verify". A delivery that fails verification is answered with `401` and never reaches the workflow.

## Project layout

| Path | What lives there |
|---|---|
| `nodes/Slide/Slide.node.ts` | The action node: properties, option loaders, and `execute`. |
| `nodes/Slide/SlideTrigger.node.ts` | The trigger node: webhook lifecycle and the delivery handler. |
| `nodes/Slide/GenericFunctions.ts` | Shared API request helper, option loaders, and signature verification. |
| `nodes/Slide/*.node.json` | Codex metadata (categories, aliases, documentation links). |
| `nodes/Slide/slide.svg`, `slide.dark.svg` | Node icons, light and dark variants. |
| `credentials/SlideApi.credentials.ts` | The Slide API credential, its auth injection and its test request. |
| `scripts/copy-icons.js` | Validates and copies icons and codex metadata into `dist/`. |
| `test/` | Signature verification tests and their vectors. |
| `.github/workflows/publish.yml` | The npm release workflow. |

## Development

```bash
npm install
npm run build     # tsc, then validate and copy icons and codex metadata into dist/
npm run dev       # tsc --watch
npm run lint      # eslint-plugin-n8n-nodes-base, n8n's own ruleset
npm run lintfix
npm test          # node --test test/*.test.js
```

`npm run build` is more than `tsc`: n8n resolves icons relative to the compiled node file, so `scripts/copy-icons.js` copies icons and `*.node.json` into `dist/` and refuses to build if an SVG is malformed or the codex metadata uses an unsupported field or an unrecognised category.

## Release

`prepublishOnly` runs build, lint, and test, so a broken package cannot be published by hand. Publishing itself happens in GitHub Actions (`.github/workflows/publish.yml`), triggered by pushing a `v*` tag or by running the workflow manually:

```bash
npm version patch && git push && git push --tags
```

The workflow installs with `--ignore-scripts`, builds, lints, tests, verifies that the tag matches the version in `package.json`, and publishes with npm provenance using trusted publishing (OIDC), so there is no long-lived npm token stored as a secret. n8n requires community nodes to be published from CI with provenance in order to be verified, which is why local publishing is not used.

## Compatibility

Built against the n8n nodes API version 1 and tested against `n8n-workflow` 1.82. `n8n-workflow` is a peer dependency supplied by the n8n instance that loads the package.

## Resources

- [Slide API documentation](https://slide.synquic.com/developers)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)

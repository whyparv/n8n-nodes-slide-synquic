# n8n-nodes-slide-synquic

n8n community node for [Slide](https://slide.synquic.com) — real-time triggers for WhatsApp, Instagram, SMS, voice, email, and Shopify events, plus multi-channel messaging actions.

[n8n](https://n8n.io) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Nodes](#nodes) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/), then enter:

```
n8n-nodes-slide-synquic
```

## Credentials

Create an API key in your Slide dashboard under **Admin → API Keys**.

Trigger nodes require the `webhooks:read` and `webhooks:write` scopes. Add the send scopes for the actions you plan to use:

| Action | Scope |
|---|---|
| Send Message / Send WhatsApp Template | `whatsapp:send` |
| Send Email | `email:send` |
| Send SMS | `sms:send` |
| Contact search | `contacts:read` |
| Contact create or update | `email:contacts:write` |

The credential's **Test** button calls the webhook catalogue, so it also verifies the key carries the scopes triggers need. A key missing them fails at save time rather than saving cleanly and never firing.

## Nodes

### Slide Trigger

Starts a workflow when something happens in your Slide account. Real-time via webhooks, not polling — activating the workflow subscribes, deactivating unsubscribes.

One node can listen to several events at once. The event list is fetched live from your account, so events added to Slide later appear without updating this node.

Available events include contact created/updated, lifecycle stage changes, form submissions, inbound WhatsApp/Instagram/SMS messages, WhatsApp delivery status, completed voice calls, email delivered/opened/clicked/bounced/complained, and Shopify order created/fulfilled.

**Options**

- **Verify Signature** (default on) — rejects deliveries whose HMAC signature does not match. Your webhook URL is not a secret, so this is what stops anyone who learns it from injecting events into your workflow.
- **Raw Payload** — emit the full envelope instead of flattening the event data to the top level.
- **Include Test Deliveries** (default on) — turn off in production so only real account activity runs the workflow.

### Slide

| Resource | Operations |
|---|---|
| Message | Send (any channel, with fallback), Send WhatsApp Template, Send Email, Send SMS |
| Contact | Search, Create or Update |

**Send** routes to WhatsApp, SMS, RCS, Email, or Instagram, and can fall back to another phone-based channel if the first does not deliver — one step instead of a step plus an error path plus a second step.

Template and sender fields are dropdowns populated from your account, so you pick a real template rather than typing an ID and finding out at run time.

## Compatibility

Requires n8n 1.x. Tested against n8n-workflow 1.82.

## Resources

- [Slide API documentation](https://slide.synquic.com/developers)
- [Webhook reference, payloads and signature verification](https://slide.synquic.com/developers#webhooks-api)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE)

# @codetay/bankapi-node

Node.js SDK for [BANKAPI.VN](https://bankapi.vn) — API client and webhook
signature verification. Zero runtime dependencies, ESM and CommonJS, Node 20+.

## Install

```bash
npm install @codetay/bankapi-node
```

## Quickstart

```ts
import { BankApi } from '@codetay/bankapi-node';

const client = new BankApi(process.env.BANKAPI_KEY!);

const summary = await client.banking.summary({ days: 7 });
console.log(summary.creditTotal);

// One page at a time
const page = await client.banking.transactions({ limit: 50, direction: 'credit' });
for (const tx of page.items) console.log(tx.id, tx.amount);

// Or every page, fetched lazily
for await (const tx of await client.banking.transactions({ matchStatus: 'unmatched' })) {
  console.log(tx.id);
}
```

The base URL defaults to `https://api.bankapi.vn` and must be `https` — plain
`http` is accepted only for loopback hosts during local development. For an
org-specific host, pass `baseUrl: 'https://acme.bankapi.vn'` — the origin
only; the SDK appends `/v1` itself (exported as `API_VERSION_PATH`), so a
`baseUrl` that already ends in `/v1` throws instead of silently doubling it.

## Payment intents

`createPaymentIntent` and `webhookEndpoints.create` are idempotent: pass
your own `idempotencyKey` to control retries explicitly, or omit it and the
SDK generates one with `crypto.randomUUID()`. A retry with the same key and
the same request body replays the first response instead of creating a
second intent. `BankApiError#replayed` is true only when the replayed
response was itself an error; a successful replay returns the same intent
(same `id`), which is all a caller needs.

```ts
const intent = await client.banking.createPaymentIntent({
  code: 'PN-1042',
  expectedAmount: 150_000,
  expiresInSecs: 900, // optional; server default when omitted
});
console.log(intent.id, intent.status);

// Pass your own key so a retried request is guaranteed to replay, not double-create
const retried = await client.banking.createPaymentIntent(
  { code: 'PN-1042', expectedAmount: 150_000 },
  { idempotencyKey: 'order-1042-attempt-1' },
);

const current = await client.banking.paymentIntent(intent.id);
```

`BankApiError#code` is the registry error code (`problem.type` with the
`urn:bankapi:error:` prefix stripped), typed `string | undefined` since a
server can roll out a new code before this SDK is regenerated. Use
`isErrorCode` to narrow it to the known `ErrorCode` union:

```ts
import { BankApiError, isErrorCode } from '@codetay/bankapi-node';

try {
  await client.banking.createPaymentIntent(input, { idempotencyKey: key });
} catch (err) {
  if (err instanceof BankApiError) {
    console.log(err.code, err.replayed); // e.g. "idempotency.key_reused", false
    if (isErrorCode(err.code) && err.code === 'idempotency.in_progress') {
      // the first request with this key is still executing — back off and retry
    }
  }
}
```

## Webhooks

BankAPI signs webhooks on [Standard Webhooks](https://www.standardwebhooks.com/).
Verify every delivery before you trust it. The raw request body is required:
verification runs over the exact bytes the server signed, so a body that has
already been through `JSON.parse` cannot be verified.

```ts
import { constructEvent, isWebhookEvent } from '@codetay/bankapi-node';

const event = constructEvent(rawBody, request.headers, process.env.BANKAPI_WEBHOOK_SECRET!);
// event.webhookId, event.type, event.api_version, event.created_at, event.org_id, event.data

if (isWebhookEvent(event, 'bank.credit')) {
  event.data.amount; // typed: this branch narrows to BankCreditEvent
}
```

`constructEvent` throws `SignatureVerificationError` on a bad signature, a
missing `webhook-id`/`webhook-timestamp`/`webhook-signature` header, or a
timestamp more than 300 seconds from now in either direction (configurable
via `{ tolerance }`). A signing secret can be rotated: `webhook-signature`
may carry more than one `v1,<base64>` entry, and verification succeeds if
any one matches.

An event type this SDK version does not know yet (the server added one after
this SDK was generated) parses as an `UnknownWebhookEnvelope` instead of
throwing — check `isWebhookEvent` before narrowing, and fall back to
`event.data` typed as `Record<string, unknown>` for anything else.

`event.data` comes from `JSON.parse`, so an integer above `Number.MAX_SAFE_INTEGER`
(2^53-1) loses precision the same way any other `JSON.parse` call would. The
server guarantees exactness only up to that bound end to end, so this is a
documented limit, not a bug: BankAPI amounts realistically never approach it.

Endpoint secrets are `whsec_<base64>`. A secret minted before this SDK
version may be URL-safe base64, padded or not — `decodeSecret` accepts both
alphabets, so an old secret keeps verifying unchanged.

### Express

```ts
import express from 'express';
import { bankapiWebhook } from '@codetay/bankapi-node/express';

const app = express();

app.post(
  '/webhooks/bankapi',
  bankapiWebhook({ secret: process.env.BANKAPI_WEBHOOK_SECRET! }),
  (req, res) => {
    const event = req.bankapiEvent!;
    res.sendStatus(200); // answer fast, do the work asynchronously
  },
);
```

The middleware reuses a raw `Buffer` or string body captured by an earlier `express.raw()`, and reads the request stream itself when nothing captured it. Do not let `express.json()` parse the webhook route: a parsed body cannot be verified, so every delivery would be rejected. Mount the webhook route before `express.json()`, or scope that parser away from this route. An unverified request is answered with `400`, a self-read body larger than 1 MiB with `413`; neither reaches the handler.

### Fastify

```ts
fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
  done(null, body),
);

fastify.post('/webhooks/bankapi', async (request, reply) => {
  const event = constructEvent(request.body as Buffer, request.headers, secret);
  await reply.code(200).send();
});
```

### Next.js (App Router)

```ts
export async function POST(request: Request) {
  const event = constructEvent(await request.text(), request.headers, secret);
  return new Response(null, { status: 200 });
}
```

### Hono

```ts
app.post('/webhooks/bankapi', async (c) => {
  const event = constructEvent(await c.req.text(), c.req.raw.headers, secret);
  return c.body(null, 200);
});
```

### Delivery rules

- Answer `2xx` quickly. The server retries on `408`, `429` and `5xx`.
- **Deduplicate on `event.webhookId`** (the `webhook-id` header) — a retried
  delivery repeats it, while `event.id` is the underlying event and stays
  the same across a rotated secret.
- `event.type` always comes from the signed body.

## Errors

Every API failure throws a subclass of `BankApiError` carrying `status`,
`title`, `detail` and the raw `body`:

| Status       | Error                                                     |
| ------------ | --------------------------------------------------------- |
| 400, 422     | `ValidationError`                                         |
| 401          | `AuthenticationError`                                     |
| 403          | `PermissionError`                                         |
| 404          | `NotFoundError`                                           |
| 429          | `RateLimitError` (with `retryAfter`)                      |
| other        | `BankApiError`                                            |
| no response  | `ConnectionError` (`status` 0, original error on `cause`) |
| 2xx non-JSON | `MalformedResponseError`                                  |

`status: 0` is shared by two distinct cases: `ConnectionError` (no response
was received) and a client-side `ValidationError` raised before any request
was sent (e.g. an `idempotencyKey` that fails the
`^[A-Za-z0-9_-]{1,64}$` pattern). Branch on `instanceof`, not on `status`, to
tell them apart.

`GET` requests are retried twice on `429`, `5xx` and network errors with
exponential backoff and jitter. Mutations are never retried.

## API

```ts
client.banking.summary({ days });
client.banking.connections();
client.banking.connectionsSummary({ days });
client.banking.connection(connectionId);
client.banking.transactions({ limit, cursor, direction, connectionId, from, to, q, matchStatus });
client.banking.transaction(txId);
client.banking.matchTransaction(txId, intentId);
client.banking.paymentIntents({ status, limit, cursor });
client.banking.createPaymentIntent({ code, expectedAmount, expiresInSecs }, { idempotencyKey });
client.banking.paymentIntent(intentId);

client.webhookEndpoints.create(url, eventTypes, description, { idempotencyKey });
client.webhookEndpoints.all({ limit, cursor });
client.webhookEndpoints.get(id);
client.webhookEndpoints.delete(id);
client.webhookEndpoints.enable(id);
client.webhookEndpoints.deliveries(id, { limit, cursor });
```

`create()` is the only call that ever returns the endpoint's signing secret —
store it immediately. The object redacts the secret from `console.log` and
`JSON.stringify` output (a literal `***redacted***` marker) — persist it by
reading `.secret` explicitly.

## Development

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run build         # tsup, ESM + CJS + types
npm run check:package # build + publint + attw
npm run sync-spec     # refresh the pinned OpenAPI contract fixture, webhook vectors and event types
```

Webhook golden vectors are produced by the BankAPI server's own signing code,
so a change to the signing scheme breaks these tests first.

## License

MIT

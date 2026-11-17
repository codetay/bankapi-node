# @codetay/bankapi-node

Node.js SDK for [BANKAPI.VN](https://bankapi.vn) — API client and webhook
signature verification. Zero runtime dependencies, ESM and CommonJS, Node 20+.

## Install

```bash
npm install @codetay/bankapi-node
```

Release candidate (this README documents 3.x): `npm install @codetay/bankapi-node@next`.

## Quickstart

```ts
import { BankApi } from '@codetay/bankapi-node';

const client = new BankApi(process.env.BANKAPI_KEY!);

const summary = await client.banking.summary({ days: 7 });
console.log(summary.creditTotalVnd);

// One page at a time
const page = await client.banking.transactions({ limit: 50, direction: 'credit' });
for (const tx of page.items) console.log(tx.id, tx.amountVnd);

// Or every page, fetched lazily
for await (const tx of await client.banking.transactions({ matchStatus: 'unmatched' })) {
  console.log(tx.id);
}

// connections() is paged too
for await (const conn of await client.banking.connections()) {
  console.log(conn.id, conn.bankCode, conn.status);
}
```

## Base URL and API version

3.x talks only to API v2. Every call goes under `/v2` (exported as
`API_VERSION_PATH`), which the SDK appends itself.

`baseUrl` is the origin only, for example `baseUrl: 'https://acme.bankapi.vn'`.
A `baseUrl` that ends in a version suffix of the form `/vN` (with or without a
trailing slash) throws a `TypeError` instead of calling a doubled path. If your
2.x configuration carries a version suffix, drop it.

The base URL defaults to `https://api.bankapi.vn` and must be `https` — plain
`http` is accepted only for loopback hosts during local development. The
default host serves API v2 from the v2 cutover; until then, point `baseUrl` at
a host that already serves v2.

## API key scopes

| Calls                                       | Scopes                                    |
| ------------------------------------------- | ----------------------------------------- |
| `banking.*` reads                           | `banking:read`                            |
| `matchTransaction`, `createPaymentIntent`   | `banking:write`                           |
| `webhookEndpoints.all`, `get`, `deliveries` | `connector:read`                          |
| `webhookEndpoints.create`                   | `connector:create` **and** `banking:read` |
| `webhookEndpoints.rotateSecret`             | `connector:update` **and** `banking:read` |
| `webhookEndpoints.enable`, `disable`        | `connector:update`                        |
| `webhookEndpoints.delete`                   | `connector:delete`                        |

Setting a destination or taking its signing key needs `banking:read` on top
of the connector scope, since banking events reach every endpoint; without it
the call is refused with `403 access.forbidden`.

There is no `connector:*` wildcard: a key requested with it is refused with
`422 apikey.scope_invalid`. Grant each `connector:` scope you need by name.

## Payment intents

`createPaymentIntent` is idempotent: pass your own `idempotencyKey` to control
retries explicitly, or omit it and the SDK generates one with
`crypto.randomUUID()`. A retry with the same key and the same request body
replays the first response instead of creating a second intent.
`BankApiError#replayed` is true only when the replayed response was itself an
error; a successful replay returns the same intent (same `id`), which is all a
caller needs.

```ts
const intent = await client.banking.createPaymentIntent({
  code: 'PN1042',
  expectedAmountVnd: 150_000,
  expiresInSecs: 900, // optional; server default when omitted
});
console.log(intent.id, intent.status, intent.expectedAmountVnd);

// Pass your own key so a retried request is guaranteed to replay, not double-create
const retried = await client.banking.createPaymentIntent(
  { code: 'PN1042', expectedAmountVnd: 150_000 },
  { idempotencyKey: 'order-1042-attempt-1' },
);

const current = await client.banking.paymentIntent(intent.id);
// current.status, current.matchedTransactionId, current.matchedAt
```

`BankApiError#code` is the registry error code: the problem's `code` field,
or, when a server leaves it out, `problem.type` with the `urn:bankapi:error:`
prefix stripped. It is typed `string | undefined` since a server can roll out
a new code before this SDK is regenerated. Use `isErrorCode` to narrow it to
the known `ErrorCode` union:

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
// event.webhookId, event.type, event.api_version ('2'), event.created_at, event.org_id, event.data

if (isWebhookEvent(event, 'banking.credit')) {
  event.data.amount_vnd; // typed: this branch narrows to BankingCreditEvent
  event.data.transaction_id;
}
```

**Only `banking.credit` is money in.** Record a payment on that one type.
`banking.payment_matched` (an intent matched a credit you already got),
`flow.output` (a flow's output, which may carry `amount_vnd` too) and
`connector.test` (the dashboard's "send test") are not payments: never count
them as one. `banking.debit` is opt-in: an endpoint receives it only when its
`event_types` names it.

Deduplicate on `event.webhookId` (the `webhook-id` header): a retried delivery
repeats it. To be safe against a second endpoint or a replayed event as well,
record a payment once per `data.transaction_id`.

`event.org_id` is the organization's bare UUID with dashes, as the signed
envelope carries it. It is not the `org_…` id that
`GET /v2/orgs` returns; do not compare the two.

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

`event.data` comes from `JSON.parse`, so an `amount_vnd` above
`Number.MAX_SAFE_INTEGER` (2^53-1) loses precision the same way any other
`JSON.parse` call would. The server guarantees exactness only up to that bound
end to end, so this is a documented limit, not a bug: BankAPI amounts
realistically never approach it. The same holds for `amountVnd` on every
resource the client returns.

Endpoint secrets are `whsec_<base64>`. `decodeSecret` accepts both the
standard and the URL-safe base64 alphabets, padded or not.

### Express

```ts
import express from 'express';
import { isWebhookEvent } from '@codetay/bankapi-node';
import { bankapiWebhook } from '@codetay/bankapi-node/express';

const app = express();

app.post(
  '/webhooks/bankapi',
  bankapiWebhook({ secret: process.env.BANKAPI_WEBHOOK_SECRET! }),
  (req, res) => {
    const event = req.bankapiEvent!;
    if (isWebhookEvent(event, 'banking.credit')) {
      // queue event.data.transaction_id / amount_vnd for your own processing
    }
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

## Webhook endpoints

Webhook endpoints are the `webhook` connectors of `/v2/connectors`; the SDK
always sends and lists `type=webhook`.

```ts
const created = await client.webhookEndpoints.create(
  'https://shop.example.com/webhooks/bankapi',
  ['banking.credit'],
  'shop orders',
);
// Store both now: the secret is shown only here, and the url reads back masked.
save(created.id, created.secret);
```

- The target must be `https` on port 443 or 8443 at a public address. A
  loopback or private address is refused.
- Every read shows the url masked (`config.url` with most of the host and
  path hidden), so you cannot find an endpoint by its url. Keep the `id`
  `create` returns.
- `create` is not idempotent. After a timeout, call `all()` before creating
  again, and match on `description`.
- `enable` and `disable` switch an endpoint on or off. Either one ends an
  automatic pause and restarts the failure count.
- `rotateSecret` returns a new secret, shown only there; the previous secret
  keeps verifying until `previousExpiresAt`.
- `get(id)` reads any connector by id, including one that is not a webhook;
  check the result before you act on it.

`create()` and `rotateSecret()` are the only calls that return a signing
secret — store it immediately. Both results redact the secret from
`console.log` and `JSON.stringify` output (a literal `***redacted***` marker) —
persist it by reading `.secret` explicitly.

## Errors

Every API failure throws a subclass of `BankApiError` carrying `status`,
`title`, `detail`, `code` and the raw `body`:

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
exponential backoff and jitter, honouring `Retry-After` up to 60 seconds.
Mutations are never retried.

## API

```ts
client.banking.summary({ days }); // BankingSummary: creditTotalVnd, creditMatchedTotalVnd, debitTotalVnd, …
client.banking.connections({ limit, cursor, q }); // Page<Connection>
client.banking.connectionsSummary({ days });
client.banking.connection(connectionId);
client.banking.transactions({ limit, cursor, direction, connectionId, from, to, q, matchStatus }); // Page<Transaction>
client.banking.transaction(txId); // Transaction: amountVnd, accountNumber, matchStatus, …
client.banking.matchTransaction(txId, intentId); // the matched Transaction
client.banking.paymentIntents({ status, limit, cursor }); // Page<PaymentIntent>
client.banking.createPaymentIntent({ code, expectedAmountVnd, expiresInSecs }, { idempotencyKey });
client.banking.paymentIntent(intentId);

client.webhookEndpoints.create(url, eventTypes, description); // CreatedEndpoint: id, url, secret
client.webhookEndpoints.all({ limit, cursor }); // Page<WebhookEndpoint>
client.webhookEndpoints.get(id);
client.webhookEndpoints.delete(id);
client.webhookEndpoints.enable(id);
client.webhookEndpoints.disable(id);
client.webhookEndpoints.rotateSecret(id); // RotatedSecret: secret, previousExpiresAt
client.webhookEndpoints.deliveries(id, { limit, cursor }); // Page<Delivery>
```

A `Page` holds `items` and `nextCursor`; `for await` walks every page lazily.
Money fields end in `Vnd` and hold whole VND.

## Development

```bash
npm test              # vitest
npm run typecheck     # tsc --noEmit
npm run build         # tsup, ESM + CJS + types
npm run check:package # build + publint + attw
npm run sync-spec     # refresh the pinned OpenAPI contract fixture, webhook vectors and event types
npm run verify-spec   # check the fixtures and generated files against the pinned API-RS and KIT-RS commits
```

The contract fixtures are pinned to two commits recorded in
`test/fixtures/openapi.lock.json`: `api/openapi.json` from API-RS and
`oracle/webhook/webhook_vectors_v2.json` from KIT-RS. Both scripts read the
repositories from `APIRS_DIR` and `KITRS_DIR` (default: `../API-RS` and
`../KIT-RS` next to this checkout). To move the pin, give a tag, branch or
commit of each; the lock records the commit it resolves to:

```bash
APIRS_DIR=../API-RS KITRS_DIR=../KIT-RS npm run sync-spec -- --apirs-ref v0.6.0 --kitrs-ref v0.6.0
```

`sync-spec` without flags re-syncs the refs already in the lock. It also
regenerates `src/error-codes.ts` and `src/webhook-events.ts`.
`npm run verify-spec -- --lock-only` reads no repository: it checks the
fixture hashes and the generated files against the lock.

Webhook golden vectors are produced by the BankAPI server's own signing code,
so a change to the signing scheme breaks these tests first.

`npm run smoke:e2e` runs the built package (`dist/`) against a local
BankAPI dev stack; see `scripts/e2e-smoke.mjs` for the variables it needs. It
is not part of the published package.

## License

MIT

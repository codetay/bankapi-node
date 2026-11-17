# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0-rc.1] - 2026-11-17

The SDK now targets API v2 (the API-RS contract pinned at `v0.6.0` by
`test/fixtures/openapi.lock.json`) and verifies the v2 webhook envelope
against the KIT-RS golden vectors. 3.x talks only to a host that serves API
v2; `https://api.bankapi.vn` serves it from the v2 cutover.

### Breaking

- Every call goes under `/v2` (`API_VERSION_PATH`). A `baseUrl` that ends in
  any version suffix `/vN` now throws a `TypeError`; pass the origin only.
- `BankApiError#code` reads the problem's `code` field first, and falls back
  to the `urn:bankapi:error:` prefix of `type` only when `code` is absent.
- Money fields end in `Vnd` and read only the v2 `*_vnd` keys.
- `TransactionDetail` is now the same type as `Transaction`: v2 returns one
  shape for list, detail and match. `Transaction` carries the full
  `accountNumber` (mask it yourself) instead of `accountNumberMasked`, and its
  nullable fields are `string | null`.
- `Connection.balance` is gone (v2 has no balance on a connection).
  `accountType` and `verifiedAt` are `string | null`. New: `bin`, `vaPrefix`,
  `oauthState`, `virtualAccounts`.
- `banking.connections()` returns a `Page<Connection>` (with `limit`,
  `cursor`, `q`) instead of an array; walk it with `for await`.
- Webhook endpoints are the `webhook` connectors of `/v2/connectors`.
  `webhookEndpoints.create(url, eventTypes, description)` sends no
  `Idempotency-Key` and takes no options argument: the operation is not
  idempotent. After a timeout, call `all()` and match on `description`
  before creating again; every read shows the url masked.
- `webhookEndpoints.enable` sends `PATCH {"active": true}`.
- `WebhookEndpoint.url` is the masked `config.url`; `eventTypes` is
  `string[] | null` (`null`: every public type that is not opt-in).
- `Delivery` follows `ConnectorDelivery`: `id` is now `deliveryId`,
  `createdAt` is now `attemptedAt`, `error` is `string | null`; new
  `status` and `transactionId`.
- Webhook events use the v2 names and the envelope `api_version: '2'`;
  `event.org_id` is the organization's bare UUID. The generated interfaces
  follow the new names (`BankingCreditEvent`, `BankingPaymentMatchedEvent`,
  `FlowOutputEvent` with a `FlowOutputTrigger`, `ConnectorTestEvent`, …).
  Only `banking.credit` is money in; `banking.payment_matched`,
  `flow.output` and `connector.test` are not payments.
- `ERROR_CODES` holds the 200 codes of the v2 registry. Families were
  renamed: `webhook.*` is now `connector.*`, `org.*` is now
  `organization.*`, `payment.*` is now `payments.*`.
- The contract scripts read API-RS and KIT-RS: `sync-spec` and
  `verify-spec` take `APIRS_DIR` and `KITRS_DIR`, and the lock records
  `apirs_ref`, `openapi_sha256`, `kitrs_ref` and `vectors_sha256`.

### Added

- `webhookEndpoints.disable(id)` (`PATCH {"active": false}`).
- `webhookEndpoints.rotateSecret(id)`: returns a `RotatedSecret`
  (`secret`, `previousExpiresAt`), redacted from logs like `CreatedEndpoint`.
- `Transaction`: `bankCode`, `vaNumber`, `matchedAt`; `PaymentIntent`:
  `matchedAt`, `createdAt`; `WebhookEndpoint`: `lastStatusCode`,
  `lastAttemptAt`, `autoDisabledAt`, `createdAt`, `updatedAt`.

### Migrating from 2.x

| 2.x                                                   | 3.0                                                       |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `baseUrl: 'https://acme.bankapi.vn/v1'`               | `baseUrl: 'https://acme.bankapi.vn'`                      |
| `/v1/banking/summary`                                 | `/v2/bank-transactions/summary`                           |
| `/v1/banking/connections`, `…/summary`, `…/{id}`      | `/v2/bank-connections`, `…/summary`, `…/{connection_id}`  |
| `/v1/banking/transactions`, `…/{id}`, `…/match`       | `/v2/bank-transactions`, `…/{transaction_id}`, `…/match`  |
| `/v1/banking/payment-intents`, `…/{id}`               | `/v2/payment-intents`, `…/{intent_id}`                    |
| `/v1/webhooks`, `…/{id}`, `…/deliveries`              | `/v2/connectors?type=webhook`, `…/{connector_id}`, …      |
| `POST /v1/webhooks/{id}/enable`                       | `PATCH /v2/connectors/{connector_id}` `{"active": true}`  |
| `summary.creditTotal` / `creditMatchedTotal`          | `summary.creditTotalVnd` / `creditMatchedTotalVnd`        |
| `summary.debitTotal`                                  | `summary.debitTotalVnd`                                   |
| `tx.amount`                                           | `tx.amountVnd`                                            |
| `createPaymentIntent({ code, expectedAmount })`       | `createPaymentIntent({ code, expectedAmountVnd })`        |
| `intent.expectedAmount`                               | `intent.expectedAmountVnd`                                |
| `TransactionDetail` (extends `Transaction`)           | `TransactionDetail` = `Transaction`                       |
| `detail.accountNumberMasked`                          | `tx.accountNumber` (full; mask it yourself)               |
| `connection.balance`                                  | removed                                                   |
| `await banking.connections()` (array)                 | `Page<Connection>`: `.items`, `for await`                 |
| `create(url, types, description, { idempotencyKey })` | `create(url, types, description)`                         |
| `delivery.id`, `delivery.createdAt`                   | `delivery.deliveryId`, `delivery.attemptedAt`             |
| `bank.credit`, `BankCreditEvent`, `data.amount`       | `banking.credit`, `BankingCreditEvent`, `data.amount_vnd` |
| `bank.payment.matched`                                | `banking.payment_matched`                                 |
| `bank.debit`                                          | `banking.debit` (opt-in)                                  |
| `webhook.test`, `WebhookTestEvent`                    | `connector.test`, `ConnectorTestEvent`                    |
| `org.quota_exceeded`                                  | `quota.exceeded`                                          |
| `org.created`, `org.member_invited`                   | `organization.created`, `organization.member_invited`     |
| error codes `webhook.*`, `org.*`, `payment.*`         | `connector.*`, `organization.*`, `payments.*`             |
| `GOKIT_DIR`, `gokit_ref`                              | `APIRS_DIR` + `KITRS_DIR`, `apirs_ref` + `kitrs_ref`      |

API keys need the exact `connector:` scopes (`connector:create`,
`connector:read`, `connector:update`, `connector:delete`) instead of the
2.x `webhook:` scopes; creating an endpoint and rotating its secret also
need `banking:read`.

## [2.0.0] - 2026-09-28

The server now signs webhooks on
[Standard Webhooks](https://www.standardwebhooks.com/) instead of the old
`X-Webhook-*` headers, matching the GO-KIT envelope v1 contract.

### Breaking

- Verification reads `webhook-id`, `webhook-timestamp` and
  `webhook-signature: v1,<base64>` (possibly more than one signature,
  space-separated) instead of `X-Webhook-Delivery-Id`,
  `X-Webhook-Timestamp` and `X-Webhook-Signature: sha256=<hex>`.
- `WebhookEvent` is now the parsed envelope
  (`{ id, type, api_version, created_at, org_id, data }`) plus
  `webhookId`/`timestamp`. `event.deliveryId` is gone — use
  `event.webhookId`. `event.type` is a generated union of every known event
  type, and `event.data` is typed per event; narrow with the new
  `isWebhookEvent(event, type)`.
- Event types and their `data`/`trigger` shapes are generated from GO-KIT's
  OpenAPI `webhooks` section (`src/webhook-events.ts`, regenerated by
  `npm run sync-spec`). New exports: `isWebhookEvent`, `WEBHOOK_EVENT_TYPES`,
  `WebhookEventType`, `WebhookEnvelope`, `KnownWebhookEnvelope`,
  `UnknownWebhookEnvelope`, and a `<Pascal>Event`/data interface per type
  (e.g. `BankCreditEvent`, `BankCreditData`).
- New exports `verifySignature` (signature + tolerance check without
  parsing the envelope) and `decodeSecret` (decodes a `whsec_` secret,
  accepting both the standard and URL-safe base64 alphabets so a secret
  minted before this version keeps verifying).
- `npm run sync-vectors` is gone; the webhook golden vectors are now synced
  by `npm run sync-spec` alongside the OpenAPI fixture.

### Added

- `WebhookTestEvent` (`webhook.test`), sent by the dashboard's "send test"
  action. Acknowledge it like any other event.
- `ERROR_CODES` now covers every coded 4xx the API returns (182 codes).

## [1.0.1] - 2026-09-11

### Added

- `org.has_credit_ledger` in `ERROR_CODES`, matching the GO-KIT contract at
  `33fb9fa` (the error code the API returns when an organization with a
  credit ledger cannot be removed).

## [1.0.0] - 2026-09-04

The SDK now targets the frozen GO-KIT API contract (pinned by
`test/fixtures/openapi.lock.json`), which moved every endpoint under `/v1`.
**Migrating from 0.x:** if you were passing a `baseUrl` that already ended in
`/v1`, drop the suffix — the SDK appends it now and rejects a `baseUrl` that
already has it. If you inspected `BankApiError` messages to branch on the
failure kind, read the new `error.code` field instead.

### Breaking

- Every request is now sent under `/v1` (`Transport` appends the exported
  `API_VERSION_PATH` after `baseUrl`). `baseUrl` must be the API origin only
  (e.g. `https://acme.bankapi.vn`) — a `baseUrl` that already ends in `/v1`
  now throws instead of doubling the path.

### Added

- `banking.createPaymentIntent(input, { idempotencyKey? })` and
  `banking.paymentIntent(id)`.
- `idempotencyKey` option on `createPaymentIntent` and
  `webhookEndpoints.create` (its signature stays backward compatible — the
  option is a new trailing argument): validated against
  `^[A-Za-z0-9_-]{1,64}$` and sent as the `Idempotency-Key` header; both
  methods generate one with `crypto.randomUUID()` when the caller omits it.
- `BankApiError#code` — the registry error code from `problem.type` with the
  `urn:bankapi:error:` prefix stripped (`undefined` for any other shape) —
  and `BankApiError#replayed`, read from the `Idempotent-Replayed` response
  header.
- Generated `ERROR_CODES`, `ErrorCode`, and `isErrorCode()`, pinned to the
  GO-KIT error-code registry via `npm run gen:error-codes`.
- `npm run sync-spec` / `npm run verify-spec` pin and check the OpenAPI
  fixture against a GO-KIT ref by lock (`test/fixtures/openapi.lock.json`);
  CI now checks out that ref and runs `verify-spec` on every matrix leg.

### Changed

- The OpenAPI fixture and contract tests now track the frozen GO-KIT
  `4ef6a7c` contract instead of the pre-freeze spec.

### Known limitations

- `BankApiError#replayed` is true only when the replayed response was itself
  an error; a successful replay returns the same intent (same `id`), which is
  all a caller needs — a replayed 2xx cannot be told apart from a fresh
  create by any response field, and the 409 `idempotency.in_progress` / 422
  `idempotency.key_reused` errors do not carry `Idempotent-Replayed` either.

## [0.2.0] - 2026-08-28

### Added

- Numeric `Retry-After` headers now drive the retry delay on 429/5xx GET
  retries (capped at 60s); the HTTP-date form still falls back to the
  formula backoff.

### Changed

- `JSON.stringify` on the `create()` result now redacts the signing secret
  with a literal `***redacted***` marker, matching the existing
  `console.log`/`util.inspect` redaction. Read `.secret` explicitly to
  persist it.

## [0.1.0] - 2026-08-27

### Added

- `BankApi` client covering the banking and webhook-endpoint M2M endpoints.
- `constructEvent` webhook signature verification, validated against golden
  vectors generated by the server's own signing code.
- `bankapiWebhook` Express-compatible verification middleware, exported from
  `@codetay/bankapi-node/express`.
- Cursor pagination via `Page`, iterable with `for await`.
- RFC 7807 error mapping and bounded GET-only retry.

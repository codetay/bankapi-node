import {
  bool,
  num,
  numRecord,
  optNum,
  optStr,
  record,
  recordList,
  str,
  strList,
} from './coerce.js';

/**
 * GET /v2/bank-transactions item, GET /v2/bank-transactions/{id} and the match
 * result: v2 has one schema, BankTransaction, for all three.
 */
export interface Transaction {
  id: string;
  /** Whole VND. Above 2^53 the JSON number is already rounded by JSON.parse. */
  amountVnd: number;
  direction: string;
  bankCode: string;
  bankRef: string;
  /** The full account number; mask it yourself before display. */
  accountNumber: string;
  vaNumber: string | null;
  connectionId: string;
  description: string;
  matchStatus: string | null;
  matchedIntentId: string | null;
  matchedAt: string | null;
  matchReviewReason: string | null;
  transactionDate: string;
  lastSeenAt: string;
  redeliveryCount: number;
  createdAt: string;
}

/** Kept for 2.x callers: list, detail and match share one shape in v2. */
export type TransactionDetail = Transaction;

export function toTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: str(raw.id),
    amountVnd: num(raw.amount_vnd),
    direction: str(raw.direction),
    bankCode: str(raw.bank_code),
    bankRef: str(raw.bank_ref),
    accountNumber: str(raw.account_number),
    vaNumber: optStr(raw.va_number),
    connectionId: str(raw.connection_id),
    description: str(raw.description),
    matchStatus: optStr(raw.match_status),
    matchedIntentId: optStr(raw.matched_intent_id),
    matchedAt: optStr(raw.matched_at),
    matchReviewReason: optStr(raw.match_review_reason),
    transactionDate: str(raw.transaction_date),
    lastSeenAt: str(raw.last_seen_at),
    redeliveryCount: num(raw.redelivery_count),
    createdAt: str(raw.created_at),
  };
}

export interface ConnectionCapabilities {
  supportsBalance: boolean;
  supportsDebit: boolean;
}

/** GET /v2/bank-connections item and GET /v2/bank-connections/{id} (schema BankConnection). */
export interface Connection {
  id: string;
  bankCode: string;
  label: string;
  status: string;
  accountType: string | null;
  accountNumber: string | null;
  accountNumberMasked: string | null;
  bin: string | null;
  vaPrefix: string | null;
  oauthState: string;
  capabilities: ConnectionCapabilities;
  /** Raw snake_case records, like the nested summary aggregates. */
  virtualAccounts: Record<string, unknown>[];
  createdAt: string;
  verifiedAt: string | null;
}

export function toConnection(raw: Record<string, unknown>): Connection {
  const capabilities = record(raw.capabilities);
  return {
    id: str(raw.id),
    bankCode: str(raw.bank_code),
    label: str(raw.label),
    status: str(raw.status),
    accountType: optStr(raw.account_type),
    accountNumber: optStr(raw.account_number),
    accountNumberMasked: optStr(raw.account_number_masked),
    bin: optStr(raw.bin),
    vaPrefix: optStr(raw.va_prefix),
    oauthState: str(raw.oauth_state),
    capabilities: {
      supportsBalance: bool(capabilities.supports_balance),
      supportsDebit: bool(capabilities.supports_debit),
    },
    virtualAccounts: recordList(raw.virtual_accounts),
    createdAt: str(raw.created_at),
    verifiedAt: optStr(raw.verified_at),
  };
}

/**
 * GET /v2/bank-transactions/summary (schema TransactionSummary).
 * ponytail: nested aggregates stay raw (their keys are *_vnd snake_case); add typed shapes if devs ask.
 */
export interface BankingSummary {
  count: number;
  creditTotalVnd: number;
  creditMatchedTotalVnd: number;
  debitTotalVnd: number;
  from: string;
  to: string;
  matchCounts: Record<string, number>;
  prev: Record<string, unknown>;
  days: Record<string, unknown>[];
  connections: Record<string, unknown>[];
}

export function toBankingSummary(raw: Record<string, unknown>): BankingSummary {
  return {
    count: num(raw.count),
    creditTotalVnd: num(raw.credit_total_vnd),
    creditMatchedTotalVnd: num(raw.credit_matched_total_vnd),
    debitTotalVnd: num(raw.debit_total_vnd),
    from: str(raw.from),
    to: str(raw.to),
    matchCounts: numRecord(raw.match_counts),
    prev: record(raw.prev),
    days: recordList(raw.days),
    connections: recordList(raw.connections),
  };
}

/** GET /v2/bank-connections/summary (schema ConnectionSummary). */
export interface ConnectionsSummary {
  from: string;
  to: string;
  connections: Record<string, unknown>[];
}

export function toConnectionsSummary(raw: Record<string, unknown>): ConnectionsSummary {
  return {
    from: str(raw.from),
    to: str(raw.to),
    connections: recordList(raw.connections),
  };
}

/** GET /v2/payment-intents item, and the create and get results (schema PaymentIntent). */
export interface PaymentIntent {
  id: string;
  code: string;
  expectedAmountVnd: number;
  status: string;
  matchedTransactionId: string | null;
  matchedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export function toPaymentIntent(raw: Record<string, unknown>): PaymentIntent {
  return {
    id: str(raw.id),
    code: str(raw.code),
    expectedAmountVnd: num(raw.expected_amount_vnd),
    status: str(raw.status),
    matchedTransactionId: optStr(raw.matched_transaction_id),
    matchedAt: optStr(raw.matched_at),
    expiresAt: str(raw.expires_at),
    createdAt: str(raw.created_at),
  };
}

/**
 * GET /v2/connectors item and GET /v2/connectors/{id} (schema Connector, type webhook).
 * Never carries the secret.
 */
export interface WebhookEndpoint {
  id: string;
  /** `config.url` as the API shows it: masked, so keep the id you got at create time. */
  url: string;
  /** `null`: every public event type that is not opt-in. */
  eventTypes: string[] | null;
  active: boolean;
  description: string;
  failureCount: number;
  lastStatusCode: number | null;
  lastAttemptAt: string | null;
  autoDisabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toWebhookEndpoint(raw: Record<string, unknown>): WebhookEndpoint {
  return {
    id: str(raw.id),
    url: str(record(raw.config).url),
    eventTypes:
      raw.event_types === undefined || raw.event_types === null ? null : strList(raw.event_types),
    active: bool(raw.active),
    description: str(raw.description),
    failureCount: num(raw.failure_count),
    lastStatusCode: optNum(raw.last_status_code),
    lastAttemptAt: optStr(raw.last_attempt_at),
    autoDisabledAt: optStr(raw.auto_disabled_at),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
  };
}

/**
 * Keeps a signing secret out of console.log/util.inspect and JSON.stringify output:
 * dumping the object while wiring an integration is the easiest way to leak it into a
 * log file, and the literal marker makes the redaction visible instead of silently
 * dropping the key. Reading `.secret` in code still works; persisting it requires
 * reading `.secret` explicitly.
 */
function redactSecret<T extends { secret: string }>(value: T): T {
  const redacted = () => ({ ...value, secret: '***redacted***' });
  Object.defineProperty(value, Symbol.for('nodejs.util.inspect.custom'), {
    value: redacted,
    enumerable: false,
  });
  Object.defineProperty(value, 'toJSON', { value: redacted, enumerable: false });
  return value;
}

/** POST /v2/connectors result (schema CreatedConnector). The secret is shown ONLY here — store it now. */
export interface CreatedEndpoint {
  id: string;
  /** Masked `config.url`, like every read. */
  url: string;
  secret: string;
}

export function toCreatedEndpoint(raw: Record<string, unknown>): CreatedEndpoint {
  return redactSecret({
    id: str(raw.id),
    url: str(record(raw.config).url),
    secret: str(raw.secret),
  });
}

/** POST /v2/connectors/{id}/rotate-secret result (schema ConnectorSecret). Shown once. */
export interface RotatedSecret {
  secret: string;
  /** Until when the secret before it still verifies; `null` when there was none to keep. */
  previousExpiresAt: string | null;
}

export function toRotatedSecret(raw: Record<string, unknown>): RotatedSecret {
  return redactSecret({
    secret: str(raw.secret),
    previousExpiresAt: optStr(raw.previous_expires_at),
  });
}

/** GET /v2/connectors/{id}/deliveries item (schema ConnectorDelivery). */
export interface Delivery {
  deliveryId: string;
  eventType: string;
  attempt: number;
  /** `succeeded`, `failed` or `skipped`. */
  status: string;
  statusCode: number | null;
  error: string | null;
  transactionId: string | null;
  attemptedAt: string;
}

export function toDelivery(raw: Record<string, unknown>): Delivery {
  return {
    deliveryId: str(raw.delivery_id),
    eventType: str(raw.event_type),
    attempt: num(raw.attempt),
    status: str(raw.status),
    statusCode: optNum(raw.status_code),
    error: optStr(raw.error),
    transactionId: optStr(raw.transaction_id),
    attemptedAt: str(raw.attempted_at),
  };
}

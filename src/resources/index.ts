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

/** One row of GET /banking/transactions (schema BankTransactionItem). */
export interface Transaction {
  id: string;
  amount: number;
  direction: string;
  bankRef: string;
  connectionId: string;
  description: string;
  matchStatus: string;
  matchedIntentId: string;
  transactionDate: string;
  createdAt: string;
}

export function toTransaction(raw: Record<string, unknown>): Transaction {
  return {
    id: str(raw.id),
    amount: num(raw.amount),
    direction: str(raw.direction),
    bankRef: str(raw.bank_ref),
    connectionId: str(raw.connection_id),
    description: str(raw.description),
    matchStatus: str(raw.match_status),
    matchedIntentId: str(raw.matched_intent_id),
    transactionDate: str(raw.transaction_date),
    createdAt: str(raw.created_at),
  };
}

/** GET /banking/transactions/{txId} (schema TransactionDetail). */
export interface TransactionDetail extends Transaction {
  matchReviewReason: string;
  accountNumberMasked: string;
  lastSeenAt: string;
  redeliveryCount: number;
}

export function toTransactionDetail(raw: Record<string, unknown>): TransactionDetail {
  return {
    ...toTransaction(raw),
    matchReviewReason: str(raw.match_review_reason),
    accountNumberMasked: str(raw.account_number_masked),
    lastSeenAt: str(raw.last_seen_at),
    redeliveryCount: num(raw.redelivery_count),
  };
}

export interface ConnectionCapabilities {
  supportsBalance: boolean;
  supportsDebit: boolean;
}

/** GET /banking/connections item (schema BankConnectionItem). */
export interface Connection {
  id: string;
  bankCode: string;
  label: string;
  status: string;
  accountType: string;
  accountNumber: string | null;
  accountNumberMasked: string | null;
  balance: number | null;
  capabilities: ConnectionCapabilities;
  createdAt: string;
  verifiedAt: string;
}

export function toConnection(raw: Record<string, unknown>): Connection {
  const capabilities = record(raw.capabilities);
  return {
    id: str(raw.id),
    bankCode: str(raw.bank_code),
    label: str(raw.label),
    status: str(raw.status),
    accountType: str(raw.account_type),
    accountNumber: optStr(raw.account_number),
    accountNumberMasked: optStr(raw.account_number_masked),
    balance: optNum(raw.balance),
    capabilities: {
      supportsBalance: bool(capabilities.supports_balance),
      supportsDebit: bool(capabilities.supports_debit),
    },
    createdAt: str(raw.created_at),
    verifiedAt: str(raw.verified_at),
  };
}

/**
 * GET /banking/summary (schema TxSummaryOutputBody).
 * ponytail: nested aggregates stay raw; add typed shapes if devs ask.
 */
export interface BankingSummary {
  count: number;
  creditTotal: number;
  creditMatchedTotal: number;
  debitTotal: number;
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
    creditTotal: num(raw.credit_total),
    creditMatchedTotal: num(raw.credit_matched_total),
    debitTotal: num(raw.debit_total),
    from: str(raw.from),
    to: str(raw.to),
    matchCounts: numRecord(raw.match_counts),
    prev: record(raw.prev),
    days: recordList(raw.days),
    connections: recordList(raw.connections),
  };
}

/** GET /banking/connections/summary (schema ConnSummaryOutputBody). */
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

/** GET /banking/payment-intents item (schema IntentResponse). */
export interface PaymentIntent {
  id: string;
  code: string;
  expectedAmount: number;
  status: string;
  matchedTransactionId: string;
  expiresAt: string;
}

export function toPaymentIntent(raw: Record<string, unknown>): PaymentIntent {
  return {
    id: str(raw.id),
    code: str(raw.code),
    expectedAmount: num(raw.expected_amount),
    status: str(raw.status),
    matchedTransactionId: str(raw.matched_transaction_id),
    expiresAt: str(raw.expires_at),
  };
}

/** GET /webhooks item (schema EndpointBody). Never carries the secret. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
  active: boolean;
  description: string;
  failureCount: number;
}

export function toWebhookEndpoint(raw: Record<string, unknown>): WebhookEndpoint {
  return {
    id: str(raw.id),
    url: str(raw.url),
    eventTypes: strList(raw.event_types),
    active: bool(raw.active),
    description: str(raw.description),
    failureCount: num(raw.failure_count),
  };
}

/** POST /webhooks result. The secret is shown ONLY here — store it now. */
export interface CreatedEndpoint {
  id: string;
  url: string;
  secret: string;
}

export function toCreatedEndpoint(raw: Record<string, unknown>): CreatedEndpoint {
  const endpoint: CreatedEndpoint = {
    id: str(raw.id),
    url: str(raw.url),
    secret: str(raw.secret),
  };
  // Keep the signing secret out of console.log/util.inspect output: dumping
  // this object while wiring an integration is the easiest way to leak it
  // into a log file. Reading `.secret` in code still works.
  Object.defineProperty(endpoint, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => ({ id: endpoint.id, url: endpoint.url, secret: '***redacted***' }),
    enumerable: false,
  });
  return endpoint;
}

/** GET /webhooks/{id}/deliveries item (schema DeliveryItem). */
export interface Delivery {
  id: string;
  eventType: string;
  attempt: number;
  statusCode: number | null;
  error: string;
  createdAt: string;
}

export function toDelivery(raw: Record<string, unknown>): Delivery {
  return {
    id: str(raw.id),
    eventType: str(raw.event_type),
    attempt: num(raw.attempt),
    statusCode: optNum(raw.status_code),
    error: str(raw.error),
    createdAt: str(raw.created_at),
  };
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/error-codes.js';

/**
 * Drift guard: every path/method the SDK calls must exist in the pinned
 * openapi.json, and every JSON key a mapper reads must exist in its schema.
 * Refresh the fixture with `npm run sync-spec` when GO-KIT changes its API.
 */
const CALLS: Array<[string, string]> = [
  ['get', '/banking/summary'],
  ['get', '/banking/connections'],
  ['get', '/banking/connections/summary'],
  ['get', '/banking/connections/{connId}'],
  ['get', '/banking/transactions'],
  ['get', '/banking/transactions/{txId}'],
  ['post', '/banking/transactions/{txId}/match'],
  ['get', '/banking/payment-intents'],
  ['post', '/banking/payment-intents'],
  ['get', '/banking/payment-intents/{intentId}'],
  ['get', '/webhooks'],
  ['post', '/webhooks'],
  ['get', '/webhooks/{endpointId}'],
  ['delete', '/webhooks/{endpointId}'],
  ['post', '/webhooks/{endpointId}/enable'],
  ['get', '/webhooks/{endpointId}/deliveries'],
];

const SCHEMA_FIELDS: Record<string, string[]> = {
  BankTransactionItem: [
    'id',
    'amount',
    'direction',
    'bank_ref',
    'connection_id',
    'description',
    'match_status',
    'matched_intent_id',
    'transaction_date',
    'created_at',
  ],
  TransactionDetail: [
    'id',
    'amount',
    'direction',
    'bank_ref',
    'connection_id',
    'description',
    'match_status',
    'matched_intent_id',
    'match_review_reason',
    'account_number_masked',
    'transaction_date',
    'created_at',
    'last_seen_at',
    'redelivery_count',
  ],
  BankConnectionItem: [
    'id',
    'bank_code',
    'label',
    'status',
    'account_type',
    'account_number',
    'account_number_masked',
    'balance',
    'capabilities',
    'created_at',
    'verified_at',
  ],
  IntentResponse: [
    'id',
    'code',
    'expected_amount',
    'status',
    'matched_transaction_id',
    'expires_at',
  ],
  IntentCreateInputBody: ['code', 'expected_amount', 'expires_in_secs'],
  EndpointBody: ['id', 'url', 'event_types', 'active', 'description', 'failure_count'],
  CreateEndpointOutputBody: ['id', 'url', 'secret'],
  DeliveryItem: ['id', 'event_type', 'attempt', 'status_code', 'error', 'created_at'],
  TxMatchInputBody: ['intent_id'],
  TxSummaryOutputBody: [
    'count',
    'credit_total',
    'credit_matched_total',
    'debit_total',
    'from',
    'to',
    'match_counts',
    'prev',
    'days',
    'connections',
  ],
  ConnSummaryOutputBody: ['from', 'to', 'connections'],
  BankCapabilities: ['supports_balance', 'supports_debit'],
};

interface OperationLike {
  operationId?: string;
  'x-idempotent'?: boolean;
  parameters?: Array<{ in: string; name: string }>;
}

interface Spec {
  paths: Record<string, Record<string, OperationLike>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  'x-error-code-registry': Array<{ code: string }>;
}

const spec = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'),
) as Spec;

describe('openapi contract', () => {
  it.each(CALLS)('spec still serves %s %s', (method, path) => {
    expect(spec.paths[path], `spec lost path ${path}`).toBeDefined();
    expect(spec.paths[path]?.[method], `spec lost ${method} ${path}`).toBeDefined();
  });

  it.each(Object.entries(SCHEMA_FIELDS))(
    'schema %s still has every mapped field',
    (name, fields) => {
      const schema = spec.components.schemas[name];
      expect(schema, `spec lost schema ${name}`).toBeDefined();
      for (const field of fields) {
        expect(schema?.properties?.[field], `schema ${name} lost field ${field}`).toBeDefined();
      }
    },
  );
});

describe('generated error codes', () => {
  it('ERROR_CODES matches the registry codes, sorted', () => {
    const registryCodes = spec['x-error-code-registry'].map((entry) => entry.code).sort();
    expect([...ERROR_CODES]).toEqual(registryCodes);
  });
});

describe('idempotent operations', () => {
  const idempotentOps = Object.values(spec.paths)
    .flatMap((methods) => Object.values(methods))
    .filter((op) => op['x-idempotent'] === true);

  it('the registry still marks exactly 6 operations x-idempotent', () => {
    expect(idempotentOps).toHaveLength(6);
  });

  it.each(idempotentOps.map((op) => [op.operationId, op] as const))(
    'operation %s declares the Idempotency-Key header parameter',
    (_operationId, op) => {
      const hasHeader = (op.parameters ?? []).some(
        (param) => param.in === 'header' && param.name === 'Idempotency-Key',
      );
      expect(hasHeader).toBe(true);
    },
  );
});

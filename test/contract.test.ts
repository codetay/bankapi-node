import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

interface Spec {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
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

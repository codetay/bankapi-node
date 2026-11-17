import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/error-codes.js';

/**
 * Drift guard: every path/method the SDK calls must exist in the pinned
 * openapi.json, accept an API key, and carry the Idempotency-Key header exactly
 * when the SDK sends one; every JSON key a mapper reads must exist in its schema.
 * Refresh the fixture with `npm run sync-spec` when API-RS changes its API.
 */
interface Call {
  method: string;
  path: string;
  /** True when the SDK sends an Idempotency-Key on this call. */
  idempotent: boolean;
}

interface SchemaLike {
  properties?: Record<string, unknown>;
  allOf?: SchemaLike[];
  $ref?: string;
}

interface OperationLike {
  operationId?: string;
  'x-idempotent'?: boolean;
  parameters?: Array<{ in: string; name: string }>;
  security?: Array<Record<string, string[]>>;
}

interface Spec {
  paths: Record<string, Record<string, OperationLike>>;
  components: { schemas: Record<string, SchemaLike> };
  'x-error-code-registry': Array<{ code: string }>;
}

const spec = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8'),
) as Spec;

/** Property names of a schema, merged across allOf members and through $ref. */
function fieldsOf(name: string): Set<string> {
  const fields = new Set<string>();
  const visit = (schema: SchemaLike | undefined): void => {
    if (schema === undefined) return;
    if (schema.$ref !== undefined) {
      visit(spec.components.schemas[schema.$ref.replace('#/components/schemas/', '')]);
      return;
    }
    for (const key of Object.keys(schema.properties ?? {})) fields.add(key);
    for (const member of schema.allOf ?? []) visit(member);
  };
  visit(spec.components.schemas[name]);
  return fields;
}

function describeContract(
  name: string,
  calls: Call[],
  schemaFields: Record<string, string[]>,
): void {
  describe(name, () => {
    const rows = calls.map((call) => [call.method, call.path, call] as const);

    it.each(rows)('spec still serves %s %s', (method, path) => {
      expect(spec.paths[path], `spec lost path ${path}`).toBeDefined();
      expect(spec.paths[path]?.[method], `spec lost ${method} ${path}`).toBeDefined();
    });

    it.each(rows)('operation %s %s accepts apiKeyAuth', (method, path) => {
      const security = spec.paths[path]?.[method]?.security ?? [];
      expect(security).toContainEqual({ apiKeyAuth: [] });
    });

    it.each(rows)(
      'the SDK sends Idempotency-Key exactly when %s %s is x-idempotent',
      (method, path, call) => {
        expect(call.idempotent).toBe(spec.paths[path]?.[method]?.['x-idempotent'] === true);
      },
    );

    it.each(Object.entries(schemaFields))(
      'schema %s still has every mapped field',
      (schemaName, fields) => {
        expect(spec.components.schemas[schemaName], `spec lost schema ${schemaName}`).toBeDefined();
        const present = fieldsOf(schemaName);
        for (const field of fields) {
          expect(present.has(field), `schema ${schemaName} lost field ${field}`).toBe(true);
        }
      },
    );
  });
}

describeContract(
  'banking contract',
  [
    { method: 'get', path: '/v2/bank-transactions/summary', idempotent: false },
    { method: 'get', path: '/v2/bank-connections', idempotent: false },
    { method: 'get', path: '/v2/bank-connections/summary', idempotent: false },
    { method: 'get', path: '/v2/bank-connections/{connection_id}', idempotent: false },
    { method: 'get', path: '/v2/bank-transactions', idempotent: false },
    { method: 'get', path: '/v2/bank-transactions/{transaction_id}', idempotent: false },
    { method: 'post', path: '/v2/bank-transactions/{transaction_id}/match', idempotent: false },
    { method: 'get', path: '/v2/payment-intents', idempotent: false },
    { method: 'post', path: '/v2/payment-intents', idempotent: true },
    { method: 'get', path: '/v2/payment-intents/{intent_id}', idempotent: false },
  ],
  {
    BankTransaction: [
      'id',
      'amount_vnd',
      'direction',
      'bank_code',
      'bank_ref',
      'account_number',
      'va_number',
      'connection_id',
      'description',
      'match_status',
      'matched_intent_id',
      'matched_at',
      'match_review_reason',
      'transaction_date',
      'last_seen_at',
      'redelivery_count',
      'created_at',
    ],
    BankConnection: [
      'id',
      'bank_code',
      'label',
      'status',
      'account_type',
      'account_number',
      'account_number_masked',
      'bin',
      'va_prefix',
      'oauth_state',
      'capabilities',
      'virtual_accounts',
      'created_at',
      'verified_at',
    ],
    BankCapabilities: ['supports_balance', 'supports_debit'],
    TransactionSummary: [
      'count',
      'credit_total_vnd',
      'credit_matched_total_vnd',
      'debit_total_vnd',
      'from',
      'to',
      'match_counts',
      'prev',
      'days',
      'connections',
    ],
    ConnectionSummary: ['from', 'to', 'connections'],
    PaymentIntent: [
      'id',
      'code',
      'expected_amount_vnd',
      'status',
      'matched_transaction_id',
      'matched_at',
      'expires_at',
      'created_at',
    ],
    PaymentIntentCreate: ['code', 'expected_amount_vnd', 'expires_in_secs'],
    TransactionMatch: ['intent_id'],
  },
);

// Still the 2.x webhook paths and Go schema names: red on purpose until S3 Task 5.
describeContract(
  'connector contract',
  [
    { method: 'get', path: '/webhooks', idempotent: false },
    { method: 'post', path: '/webhooks', idempotent: true },
    { method: 'get', path: '/webhooks/{endpointId}', idempotent: false },
    { method: 'delete', path: '/webhooks/{endpointId}', idempotent: false },
    { method: 'post', path: '/webhooks/{endpointId}/enable', idempotent: false },
    { method: 'get', path: '/webhooks/{endpointId}/deliveries', idempotent: false },
  ],
  {
    EndpointBody: ['id', 'url', 'event_types', 'active', 'description', 'failure_count'],
    CreateEndpointOutputBody: ['id', 'url', 'secret'],
    DeliveryItem: ['id', 'event_type', 'attempt', 'status_code', 'error', 'created_at'],
  },
);

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

  it('the registry still marks exactly 11 operations x-idempotent', () => {
    expect(idempotentOps).toHaveLength(11);
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

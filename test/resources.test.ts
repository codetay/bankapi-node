import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  toBankingSummary,
  toConnection,
  toConnectionsSummary,
  toCreatedEndpoint,
  toDelivery,
  toPaymentIntent,
  toTransaction,
  toTransactionDetail,
  toWebhookEndpoint,
} from '../src/resources/index.js';

describe('mappers are forward compatible', () => {
  it('ignores unknown fields instead of throwing', () => {
    const tx = toTransaction({ id: 'tx_1', amount: 1000, brand_new_field: 'whatever' });
    expect(tx.id).toBe('tx_1');
    expect(tx.amount).toBe(1000);
    expect('brand_new_field' in tx).toBe(false);
  });

  it('fills defaults when fields are missing', () => {
    expect(toTransaction({})).toEqual({
      id: '',
      amount: 0,
      direction: '',
      bankRef: '',
      connectionId: '',
      description: '',
      matchStatus: '',
      matchedIntentId: '',
      transactionDate: '',
      createdAt: '',
    });
  });
});

describe('toTransactionDetail', () => {
  it('maps every documented field', () => {
    expect(
      toTransactionDetail({
        id: 'tx_1',
        amount: 150000,
        direction: 'credit',
        bank_ref: 'FT123',
        connection_id: 'conn_1',
        description: 'thanh toan',
        match_status: 'matched',
        matched_intent_id: 'pi_1',
        match_review_reason: 'amount',
        account_number_masked: '9704xx',
        transaction_date: '2026-08-27',
        created_at: '2026-08-27T00:00:00Z',
        last_seen_at: '2026-08-27T00:01:00Z',
        redelivery_count: 2,
      }),
    ).toEqual({
      id: 'tx_1',
      amount: 150000,
      direction: 'credit',
      bankRef: 'FT123',
      connectionId: 'conn_1',
      description: 'thanh toan',
      matchStatus: 'matched',
      matchedIntentId: 'pi_1',
      matchReviewReason: 'amount',
      accountNumberMasked: '9704xx',
      transactionDate: '2026-08-27',
      createdAt: '2026-08-27T00:00:00Z',
      lastSeenAt: '2026-08-27T00:01:00Z',
      redeliveryCount: 2,
    });
  });
});

describe('toConnection', () => {
  it('maps nullable fields to null when absent', () => {
    const conn = toConnection({ id: 'conn_1', bank_code: 'ocb' });
    expect(conn.accountNumber).toBeNull();
    expect(conn.accountNumberMasked).toBeNull();
    expect(conn.balance).toBeNull();
    expect(conn.capabilities).toEqual({ supportsBalance: false, supportsDebit: false });
  });

  it('maps capabilities out of snake_case', () => {
    const conn = toConnection({
      id: 'conn_1',
      capabilities: { supports_balance: true, supports_debit: false },
    });
    expect(conn.capabilities).toEqual({ supportsBalance: true, supportsDebit: false });
  });

  it('keeps present nullable values', () => {
    const conn = toConnection({ account_number: '0123', balance: 5000 });
    expect(conn.accountNumber).toBe('0123');
    expect(conn.balance).toBe(5000);
  });
});

describe('toBankingSummary', () => {
  it('maps scalars and keeps nested aggregates raw', () => {
    const summary = toBankingSummary({
      count: 4,
      credit_total: 900,
      credit_matched_total: 400,
      debit_total: 100,
      from: '2026-08-01',
      to: '2026-08-27',
      match_counts: { matched: 3, unmatched: 1 },
      prev: { count: 2 },
      days: [{ day: '2026-08-27', credit_total: 900 }],
      connections: [{ id: 'conn_1' }],
    });
    expect(summary.count).toBe(4);
    expect(summary.creditMatchedTotal).toBe(400);
    expect(summary.matchCounts).toEqual({ matched: 3, unmatched: 1 });
    expect(summary.days).toEqual([{ day: '2026-08-27', credit_total: 900 }]);
    expect(summary.connections).toEqual([{ id: 'conn_1' }]);
  });

  it('defaults nested aggregates to empty containers', () => {
    const summary = toBankingSummary({});
    expect(summary.matchCounts).toEqual({});
    expect(summary.prev).toEqual({});
    expect(summary.days).toEqual([]);
    expect(summary.connections).toEqual([]);
  });
});

describe('toConnectionsSummary', () => {
  it('maps the window and keeps connections raw', () => {
    const summary = toConnectionsSummary({
      from: '2026-08-01',
      to: '2026-08-27',
      connections: [{ id: 'conn_1' }],
    });
    expect(summary).toEqual({
      from: '2026-08-01',
      to: '2026-08-27',
      connections: [{ id: 'conn_1' }],
    });
  });
});

describe('toPaymentIntent', () => {
  it('maps every documented field', () => {
    expect(
      toPaymentIntent({
        id: 'pi_1',
        code: 'PN-42',
        expected_amount: 99000,
        status: 'pending',
        matched_transaction_id: '',
        expires_at: '2026-08-28T00:00:00Z',
      }),
    ).toEqual({
      id: 'pi_1',
      code: 'PN-42',
      expectedAmount: 99000,
      status: 'pending',
      matchedTransactionId: '',
      expiresAt: '2026-08-28T00:00:00Z',
    });
  });
});

describe('toWebhookEndpoint', () => {
  it('maps every documented field and never carries a secret', () => {
    const endpoint = toWebhookEndpoint({
      id: 'wh_1',
      url: 'https://shop.test/hook',
      event_types: ['bank.credit'],
      active: true,
      description: 'shop',
      failure_count: 0,
      secret: 'whsec_should_be_ignored',
    });
    expect(endpoint).toEqual({
      id: 'wh_1',
      url: 'https://shop.test/hook',
      eventTypes: ['bank.credit'],
      active: true,
      description: 'shop',
      failureCount: 0,
    });
  });
});

describe('toDelivery', () => {
  it('maps status_code to null when absent', () => {
    const delivery = toDelivery({ id: 'dl_1', event_type: 'bank.credit', attempt: 2 });
    expect(delivery.statusCode).toBeNull();
    expect(delivery.attempt).toBe(2);
  });
});

describe('toCreatedEndpoint', () => {
  const raw = { id: 'wh_1', url: 'https://shop.test/hook', secret: 'whsec_supersecret' };

  it('exposes the secret to code', () => {
    expect(toCreatedEndpoint(raw).secret).toBe('whsec_supersecret');
  });

  it('redacts the secret when the object is inspected or logged', () => {
    const printed = inspect(toCreatedEndpoint(raw));
    expect(printed).not.toContain('whsec_supersecret');
    expect(printed).toContain('***redacted***');
  });

  it('keeps the redaction hook off enumerable keys', () => {
    const endpoint = toCreatedEndpoint(raw);
    expect(Object.keys(endpoint)).toEqual(['id', 'url', 'secret']);
    const descriptor = Object.getOwnPropertyDescriptor(
      endpoint,
      Symbol.for('nodejs.util.inspect.custom'),
    );
    expect(descriptor?.enumerable).toBe(false);
  });
});

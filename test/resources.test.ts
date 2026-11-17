import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  toBankingSummary,
  toConnection,
  toConnectionsSummary,
  toCreatedEndpoint,
  toDelivery,
  toPaymentIntent,
  toRotatedSecret,
  toTransaction,
  toWebhookEndpoint,
} from '../src/resources/index.js';

describe('mappers are forward compatible', () => {
  it('ignores unknown fields instead of throwing', () => {
    const tx = toTransaction({ id: 'tx_1', amount_vnd: 1000, brand_new_field: 'whatever' });
    expect(tx.id).toBe('tx_1');
    expect(tx.amountVnd).toBe(1000);
    expect('brand_new_field' in tx).toBe(false);
  });

  it('fills defaults when fields are missing', () => {
    expect(toTransaction({})).toEqual({
      id: '',
      amountVnd: 0,
      direction: '',
      bankCode: '',
      bankRef: '',
      accountNumber: '',
      vaNumber: null,
      connectionId: '',
      description: '',
      matchStatus: null,
      matchedIntentId: null,
      matchedAt: null,
      matchReviewReason: null,
      transactionDate: '',
      lastSeenAt: '',
      redeliveryCount: 0,
      createdAt: '',
    });
  });
});

describe('toTransaction', () => {
  it('toTransaction maps every BankTransaction field', () => {
    expect(
      toTransaction({
        id: 'btx_1',
        amount_vnd: 50000,
        direction: 'credit',
        bank_code: 'MB',
        bank_ref: 'FT123',
        account_number: '0123456789',
        va_number: 'VA0042',
        connection_id: 'bcn_1',
        description: 'thanh toan',
        match_status: 'matched',
        matched_intent_id: 'bpi_1',
        matched_at: '2026-11-17T00:02:00Z',
        match_review_reason: 'amount',
        transaction_date: '2026-11-17',
        last_seen_at: '2026-11-17T00:01:00Z',
        redelivery_count: 2,
        created_at: '2026-11-17T00:00:00Z',
      }),
    ).toEqual({
      id: 'btx_1',
      amountVnd: 50000,
      direction: 'credit',
      bankCode: 'MB',
      bankRef: 'FT123',
      accountNumber: '0123456789',
      vaNumber: 'VA0042',
      connectionId: 'bcn_1',
      description: 'thanh toan',
      matchStatus: 'matched',
      matchedIntentId: 'bpi_1',
      matchedAt: '2026-11-17T00:02:00Z',
      matchReviewReason: 'amount',
      transactionDate: '2026-11-17',
      lastSeenAt: '2026-11-17T00:01:00Z',
      redeliveryCount: 2,
      createdAt: '2026-11-17T00:00:00Z',
    });
  });

  it('toTransaction maps absent nullable fields to null', () => {
    const absent = toTransaction({ id: 'btx_1', amount_vnd: 1 });
    const nulled = toTransaction({
      id: 'btx_1',
      amount_vnd: 1,
      match_status: null,
      matched_intent_id: null,
      matched_at: null,
      match_review_reason: null,
      va_number: null,
    });
    for (const tx of [absent, nulled]) {
      expect(tx.matchStatus).toBeNull();
      expect(tx.matchedIntentId).toBeNull();
      expect(tx.matchedAt).toBeNull();
      expect(tx.matchReviewReason).toBeNull();
      expect(tx.vaNumber).toBeNull();
    }
  });

  it('reads only amount_vnd, never the 2.x amount key', () => {
    expect(toTransaction({ amount: 50000 }).amountVnd).toBe(0);
  });
});

describe('toConnection', () => {
  it('maps nullable fields to null when absent', () => {
    const conn = toConnection({ id: 'bcn_1', bank_code: 'MB' });
    expect(conn.accountType).toBeNull();
    expect(conn.accountNumber).toBeNull();
    expect(conn.accountNumberMasked).toBeNull();
    expect(conn.bin).toBeNull();
    expect(conn.vaPrefix).toBeNull();
    expect(conn.verifiedAt).toBeNull();
    expect(conn.virtualAccounts).toEqual([]);
    expect(conn.capabilities).toEqual({ supportsBalance: false, supportsDebit: false });
  });

  it('maps capabilities out of snake_case', () => {
    const conn = toConnection({
      id: 'bcn_1',
      capabilities: { supports_balance: true, supports_debit: false },
    });
    expect(conn.capabilities).toEqual({ supportsBalance: true, supportsDebit: false });
  });

  it('toConnection has no balance and keeps the masked account number', () => {
    const conn = toConnection({
      id: 'bcn_1',
      account_number: '0123456789',
      account_number_masked: '******6789',
      balance: 5000,
    });
    expect('balance' in conn).toBe(false);
    expect(conn.accountNumber).toBe('0123456789');
    expect(conn.accountNumberMasked).toBe('******6789');
  });

  it('toConnection maps bin, va_prefix, oauth_state and virtual_accounts', () => {
    const conn = toConnection({
      id: 'bcn_1',
      account_type: 'business',
      bin: '970422',
      va_prefix: 'XX',
      oauth_state: 'connected',
      virtual_accounts: [{ va_number: 'XX0001', label: 'shop' }],
      verified_at: '2026-11-17T00:00:00Z',
      active_otp_session: { id: 'otp_1' },
    });
    expect(conn.accountType).toBe('business');
    expect(conn.bin).toBe('970422');
    expect(conn.vaPrefix).toBe('XX');
    expect(conn.oauthState).toBe('connected');
    expect(conn.virtualAccounts).toEqual([{ va_number: 'XX0001', label: 'shop' }]);
    expect(conn.verifiedAt).toBe('2026-11-17T00:00:00Z');
    expect('activeOtpSession' in conn).toBe(false);
  });
});

describe('toBankingSummary', () => {
  it('toBankingSummary reads the *_vnd totals', () => {
    const summary = toBankingSummary({
      count: 4,
      credit_total_vnd: 7,
      credit_matched_total_vnd: 4,
      debit_total_vnd: 1,
      from: '2026-11-01',
      to: '2026-11-17',
      match_counts: { matched: 3, unmatched: 1 },
      prev: { count: 2, credit_total_vnd: 5 },
      days: [{ date: '2026-11-17', credit_total_vnd: 7 }],
      connections: [{ id: 'bcn_1' }],
    });
    expect(summary.count).toBe(4);
    expect(summary.creditTotalVnd).toBe(7);
    expect(summary.creditMatchedTotalVnd).toBe(4);
    expect(summary.debitTotalVnd).toBe(1);
    expect(summary.matchCounts).toEqual({ matched: 3, unmatched: 1 });
    expect(summary.prev).toEqual({ count: 2, credit_total_vnd: 5 });
    expect(summary.days).toEqual([{ date: '2026-11-17', credit_total_vnd: 7 }]);
    expect(summary.connections).toEqual([{ id: 'bcn_1' }]);
  });

  it('reads only the *_vnd totals, never the 2.x keys', () => {
    const summary = toBankingSummary({ credit_total: 9, credit_matched_total: 9, debit_total: 9 });
    expect(summary.creditTotalVnd).toBe(0);
    expect(summary.creditMatchedTotalVnd).toBe(0);
    expect(summary.debitTotalVnd).toBe(0);
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
      from: '2026-11-01',
      to: '2026-11-17',
      connections: [{ id: 'bcn_1', today_credit_vnd: 3 }],
    });
    expect(summary).toEqual({
      from: '2026-11-01',
      to: '2026-11-17',
      connections: [{ id: 'bcn_1', today_credit_vnd: 3 }],
    });
  });
});

describe('toPaymentIntent', () => {
  it('toPaymentIntent maps expected_amount_vnd, created_at and matched_at', () => {
    expect(
      toPaymentIntent({
        id: 'bpi_1',
        code: 'PN-42',
        expected_amount_vnd: 99000,
        status: 'matched',
        matched_transaction_id: 'btx_1',
        matched_at: '2026-11-17T00:05:00Z',
        expires_at: '2026-11-18T00:00:00Z',
        created_at: '2026-11-17T00:00:00Z',
      }),
    ).toEqual({
      id: 'bpi_1',
      code: 'PN-42',
      expectedAmountVnd: 99000,
      status: 'matched',
      matchedTransactionId: 'btx_1',
      matchedAt: '2026-11-17T00:05:00Z',
      expiresAt: '2026-11-18T00:00:00Z',
      createdAt: '2026-11-17T00:00:00Z',
    });
  });

  it('maps an unmatched intent to null match fields and ignores the 2.x amount key', () => {
    const intent = toPaymentIntent({ id: 'bpi_1', expected_amount: 99000 });
    expect(intent.expectedAmountVnd).toBe(0);
    expect(intent.matchedTransactionId).toBeNull();
    expect(intent.matchedAt).toBeNull();
  });
});

describe('toWebhookEndpoint', () => {
  it('maps every documented field and never carries a secret', () => {
    const endpoint = toWebhookEndpoint({
      id: 'cnr_1',
      type: 'webhook',
      config: { url: 'https://sh**.test/…hook' },
      event_types: ['banking.credit'],
      active: false,
      description: 'shop',
      failure_count: 5,
      last_status_code: 500,
      last_attempt_at: '2026-11-17T00:01:00Z',
      auto_disabled_at: '2026-11-17T00:02:00Z',
      retry_until: '2026-11-18T00:00:00Z',
      created_at: '2026-11-17T00:00:00Z',
      updated_at: '2026-11-17T00:02:00Z',
      secret: 'whsec_should_be_ignored',
    });
    expect(endpoint).toEqual({
      id: 'cnr_1',
      url: 'https://sh**.test/…hook',
      eventTypes: ['banking.credit'],
      active: false,
      description: 'shop',
      failureCount: 5,
      lastStatusCode: 500,
      lastAttemptAt: '2026-11-17T00:01:00Z',
      autoDisabledAt: '2026-11-17T00:02:00Z',
      createdAt: '2026-11-17T00:00:00Z',
      updatedAt: '2026-11-17T00:02:00Z',
    });
  });

  it('toWebhookEndpoint reads url from config.url and event_types null as null', () => {
    const endpoint = toWebhookEndpoint({
      id: 'cnr_1',
      url: 'https://root-url-is-not-v2.test/hook',
      config: { url: 'https://sh**.test/…hook' },
      event_types: null,
    });
    expect(endpoint.url).toBe('https://sh**.test/…hook');
    expect(endpoint.eventTypes).toBeNull();
    expect(endpoint.lastStatusCode).toBeNull();
    expect(endpoint.lastAttemptAt).toBeNull();
    expect(endpoint.autoDisabledAt).toBeNull();
    expect(toWebhookEndpoint({ id: 'cnr_1' }).eventTypes).toBeNull();
  });
});

describe('toDelivery', () => {
  it('toDelivery maps status_code, error and transaction_id to null when absent', () => {
    const delivery = toDelivery({
      delivery_id: 'd1',
      event_type: 'banking.credit',
      attempt: 2,
      status: 'failed',
      attempted_at: '2026-11-17T00:00:01Z',
    });
    expect(delivery).toEqual({
      deliveryId: 'd1',
      eventType: 'banking.credit',
      attempt: 2,
      status: 'failed',
      statusCode: null,
      error: null,
      transactionId: null,
      attemptedAt: '2026-11-17T00:00:01Z',
    });
  });

  it('maps a failed attempt with its status code and error', () => {
    const delivery = toDelivery({ delivery_id: 'd1', status_code: 500, error: 'HTTP 500' });
    expect(delivery.statusCode).toBe(500);
    expect(delivery.error).toBe('HTTP 500');
  });
});

describe('toCreatedEndpoint', () => {
  const raw = {
    id: 'cnr_1',
    type: 'webhook',
    config: { url: 'https://sh**.test/…hook' },
    secret: 'whsec_supersecret',
  };

  it('exposes the secret to code and reads url from config.url', () => {
    const created = toCreatedEndpoint(raw);
    expect(created.secret).toBe('whsec_supersecret');
    expect(created.url).toBe('https://sh**.test/…hook');
  });

  it('redacts the secret when the object is inspected or logged', () => {
    const printed = inspect(toCreatedEndpoint(raw));
    expect(printed).not.toContain('whsec_supersecret');
    expect(printed).toContain('***redacted***');
  });

  it('redacts the secret in JSON.stringify output', () => {
    const serialized = JSON.stringify(toCreatedEndpoint(raw));
    expect(serialized).not.toContain('whsec_supersecret');
    expect(serialized).toContain('***redacted***');
  });

  it('keeps the redaction hooks off enumerable keys', () => {
    const endpoint = toCreatedEndpoint(raw);
    expect(Object.keys(endpoint)).toEqual(['id', 'url', 'secret']);
    for (const key of [Symbol.for('nodejs.util.inspect.custom'), 'toJSON'] as const) {
      expect(Object.getOwnPropertyDescriptor(endpoint, key)?.enumerable).toBe(false);
    }
  });
});

describe('toRotatedSecret', () => {
  const raw = { secret: 'whsec_rotated', previous_expires_at: '2026-11-18T00:00:00Z' };

  it('exposes the new secret and when the previous one stops verifying', () => {
    const rotated = toRotatedSecret(raw);
    expect(rotated.secret).toBe('whsec_rotated');
    expect(rotated.previousExpiresAt).toBe('2026-11-18T00:00:00Z');
    expect(toRotatedSecret({ secret: 'whsec_rotated' }).previousExpiresAt).toBeNull();
  });

  it('redacts the secret when the object is inspected or logged', () => {
    const printed = inspect(toRotatedSecret(raw));
    expect(printed).not.toContain('whsec_rotated');
    expect(printed).toContain('***redacted***');
  });

  it('redacts the secret in JSON.stringify output', () => {
    const serialized = JSON.stringify(toRotatedSecret(raw));
    expect(serialized).not.toContain('whsec_rotated');
    expect(serialized).toContain('***redacted***');
  });

  it('keeps the redaction hooks off enumerable keys', () => {
    const rotated = toRotatedSecret(raw);
    expect(Object.keys(rotated)).toEqual(['secret', 'previousExpiresAt']);
    for (const key of [Symbol.for('nodejs.util.inspect.custom'), 'toJSON'] as const) {
      expect(Object.getOwnPropertyDescriptor(rotated, key)?.enumerable).toBe(false);
    }
  });
});

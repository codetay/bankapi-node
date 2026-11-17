import { describe, expect, it } from 'vitest';
import { Page } from '../../src/page.js';
import { BankingService } from '../../src/services/banking.js';
import { Transport } from '../../src/transport.js';
import { jsonResponse, stubFetch } from '../helpers/fetch.js';

function make(queue: Array<Response | Error>) {
  const stub = stubFetch(queue);
  const transport = new Transport({
    apiKey: 'k',
    baseUrl: 'https://api.bankapi.vn',
    fetch: stub.fetch,
    sleep: async () => {},
  });
  return { service: new BankingService(transport), stub };
}

describe('summary', () => {
  it('calls GET /v2/bank-transactions/summary without a query by default', async () => {
    const { service, stub } = make([jsonResponse({ count: 2, credit_total_vnd: 500 })]);
    const summary = await service.summary();
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-transactions/summary');
    expect(summary.count).toBe(2);
    expect(summary.creditTotalVnd).toBe(500);
  });

  it('passes days when given', async () => {
    const { service, stub } = make([jsonResponse({})]);
    await service.summary({ days: 7 });
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-transactions/summary?days=7');
  });
});

describe('connections', () => {
  it('connections returns a page and carries limit, cursor and q', async () => {
    const { service, stub } = make([
      jsonResponse({
        items: [{ id: 'bcn_1', bank_code: 'MB' }, { id: 'bcn_2' }],
        next_cursor: null,
      }),
    ]);
    const page = await service.connections({ limit: 2, cursor: 'c1', q: 'shop' });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v2/bank-connections');
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '2', cursor: 'c1', q: 'shop' });
    expect(page).toBeInstanceOf(Page);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.bankCode).toBe('MB');
    expect(page.nextCursor).toBe('');
  });

  it('sends no query when called without options', async () => {
    const { service, stub } = make([jsonResponse({ items: [], next_cursor: null })]);
    const page = await service.connections();
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-connections');
    expect(page.items).toEqual([]);
  });

  it('connections walks to the second page with for await', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'bcn_1' }], next_cursor: 'c2' }),
      jsonResponse({ items: [{ id: 'bcn_2' }], next_cursor: null }),
    ]);
    const seen: string[] = [];
    for await (const conn of await service.connections({ limit: 1, q: 'shop' })) {
      seen.push(conn.id);
    }
    expect(seen).toEqual(['bcn_1', 'bcn_2']);
    expect(stub.calls).toHaveLength(2);
    const second = new URL(stub.calls[1]!.url);
    expect(Object.fromEntries(second.searchParams)).toEqual({
      limit: '1',
      q: 'shop',
      cursor: 'c2',
    });
  });
});

describe('connectionsSummary and connection', () => {
  it('calls the summary endpoint with days', async () => {
    const { service, stub } = make([jsonResponse({ from: 'a', to: 'b', connections: [] })]);
    const summary = await service.connectionsSummary({ days: 30 });
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-connections/summary?days=30');
    expect(summary.from).toBe('a');
  });

  it('url-encodes the connection id', async () => {
    const { service, stub } = make([jsonResponse({ id: 'bcn/1' })]);
    await service.connection('bcn/1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-connections/bcn%2F1');
  });
});

describe('transactions', () => {
  it('maps each filter onto its snake_case query parameter', async () => {
    const { service, stub } = make([jsonResponse({ items: [], next_cursor: null })]);
    await service.transactions({
      limit: 50,
      cursor: 'cur_1',
      direction: 'credit',
      connectionId: 'bcn_1',
      from: '2026-11-01',
      to: '2026-11-17',
      q: 'PN-42',
      matchStatus: 'unmatched',
    });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v2/bank-transactions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      cursor: 'cur_1',
      direction: 'credit',
      connection_id: 'bcn_1',
      from: '2026-11-01',
      to: '2026-11-17',
      q: 'PN-42',
      match_status: 'unmatched',
    });
  });

  it('returns a page of mapped transactions', async () => {
    const { service } = make([
      jsonResponse({ items: [{ id: 'btx_1', amount_vnd: 100 }], next_cursor: 'cur_2' }),
    ]);
    const page = await service.transactions();
    expect(page.items[0]!.id).toBe('btx_1');
    expect(page.items[0]!.amountVnd).toBe(100);
    expect(page.nextCursor).toBe('cur_2');
  });

  it('carries filters into the next page fetch and drops the old cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'btx_1' }], next_cursor: 'cur_2' }),
      jsonResponse({ items: [{ id: 'btx_2' }], next_cursor: null }),
    ]);
    const seen: string[] = [];
    for await (const tx of await service.transactions({ limit: 1, direction: 'credit' })) {
      seen.push(tx.id);
    }
    expect(seen).toEqual(['btx_1', 'btx_2']);
    const second = new URL(stub.calls[1]!.url);
    expect(Object.fromEntries(second.searchParams)).toEqual({
      limit: '1',
      direction: 'credit',
      cursor: 'cur_2',
    });
  });

  it('treats a null or missing next_cursor as exhausted', async () => {
    const { service } = make([
      jsonResponse({ items: [{ id: 'btx_1' }], next_cursor: null }),
      jsonResponse({ items: [{ id: 'btx_1' }] }),
    ]);
    expect((await service.transactions()).nextCursor).toBe('');
    expect((await service.transactions()).nextCursor).toBe('');
  });
});

describe('transaction and matchTransaction', () => {
  it('reads one transaction', async () => {
    const { service, stub } = make([jsonResponse({ id: 'btx_1', redelivery_count: 3 })]);
    const tx = await service.transaction('btx_1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/bank-transactions/btx_1');
    expect(tx.redeliveryCount).toBe(3);
  });

  it('matchTransaction returns the matched transaction', async () => {
    const { service, stub } = make([
      jsonResponse({
        id: 'btx_1',
        amount_vnd: 99000,
        match_status: 'matched',
        matched_intent_id: 'bpi_9',
        matched_at: '2026-11-17T00:05:00Z',
      }),
    ]);
    const tx = await service.matchTransaction('btx_1', 'bpi_9');
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v2/bank-transactions/btx_1/match');
    expect(call.body).toBe('{"intent_id":"bpi_9"}');
    expect(call.headers.get('idempotency-key')).toBeNull();
    expect(tx.matchStatus).toBe('matched');
    expect(tx.matchedIntentId).toBe('bpi_9');
    expect(tx.matchedAt).toBe('2026-11-17T00:05:00Z');
    expect(tx.amountVnd).toBe(99000);
  });
});

describe('paymentIntents', () => {
  it('passes status and limit and returns a page', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'bpi_1', expected_amount_vnd: 99000 }], next_cursor: null }),
    ]);
    const page = await service.paymentIntents({ status: 'pending', limit: 20 });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v2/payment-intents');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'pending', limit: '20' });
    expect(page.items[0]!.expectedAmountVnd).toBe(99000);
  });
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createPaymentIntent', () => {
  it('createPaymentIntent posts expected_amount_vnd and sends an Idempotency-Key', async () => {
    const { service, stub } = make([
      jsonResponse(
        { id: 'bpi_1', code: 'PN-1', expected_amount_vnd: 99000, status: 'pending' },
        { status: 201 },
      ),
    ]);
    const intent = await service.createPaymentIntent({ code: 'PN-1', expectedAmountVnd: 99000 });
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v2/payment-intents');
    expect(JSON.parse(call.body!)).toEqual({ code: 'PN-1', expected_amount_vnd: 99000 });
    expect(call.headers.get('idempotency-key')).toMatch(UUID_V4);
    expect(intent.id).toBe('bpi_1');
    expect(intent.expectedAmountVnd).toBe(99000);
    expect(intent.status).toBe('pending');
  });

  it('includes expires_in_secs when given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'bpi_1' }, { status: 201 })]);
    await service.createPaymentIntent({
      code: 'PN-1',
      expectedAmountVnd: 99000,
      expiresInSecs: 900,
    });
    expect(JSON.parse(stub.calls[0]!.body!)).toEqual({
      code: 'PN-1',
      expected_amount_vnd: 99000,
      expires_in_secs: 900,
    });
  });

  it('sends the caller-supplied Idempotency-Key when given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'bpi_1' }, { status: 201 })]);
    await service.createPaymentIntent(
      { code: 'PN-1', expectedAmountVnd: 99000 },
      { idempotencyKey: 'order-1042-attempt-1' },
    );
    expect(stub.calls[0]!.headers.get('idempotency-key')).toBe('order-1042-attempt-1');
  });
});

describe('paymentIntent', () => {
  it('reads one payment intent by id', async () => {
    const { service, stub } = make([
      jsonResponse({ id: 'bpi_1', code: 'PN-1', status: 'matched' }),
    ]);
    const intent = await service.paymentIntent('bpi_1');
    expect(stub.calls[0]!.method).toBe('GET');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/payment-intents/bpi_1');
    expect(intent.status).toBe('matched');
  });

  it('url-encodes the intent id', async () => {
    const { service, stub } = make([jsonResponse({ id: 'bpi/1' })]);
    await service.paymentIntent('bpi/1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/payment-intents/bpi%2F1');
  });
});

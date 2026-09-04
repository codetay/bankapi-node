import { describe, expect, it } from 'vitest';
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
  it('calls GET /banking/summary without a query by default', async () => {
    const { service, stub } = make([jsonResponse({ count: 2, credit_total: 500 })]);
    const summary = await service.summary();
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/summary');
    expect(summary.count).toBe(2);
    expect(summary.creditTotal).toBe(500);
  });

  it('passes days when given', async () => {
    const { service, stub } = make([jsonResponse({})]);
    await service.summary({ days: 7 });
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/summary?days=7');
  });
});

describe('connections', () => {
  it('returns the plain list, not a page', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'conn_1', bank_code: 'ocb' }, { id: 'conn_2' }] }),
    ]);
    const connections = await service.connections();
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/connections');
    expect(connections).toHaveLength(2);
    expect(connections[0]!.bankCode).toBe('ocb');
  });

  it('returns an empty array when the payload has no items', async () => {
    const { service } = make([jsonResponse({})]);
    await expect(service.connections()).resolves.toEqual([]);
  });
});

describe('connectionsSummary and connection', () => {
  it('calls the summary endpoint with days', async () => {
    const { service, stub } = make([jsonResponse({ from: 'a', to: 'b', connections: [] })]);
    const summary = await service.connectionsSummary({ days: 30 });
    expect(stub.calls[0]!.url).toBe(
      'https://api.bankapi.vn/v1/banking/connections/summary?days=30',
    );
    expect(summary.from).toBe('a');
  });

  it('url-encodes the connection id', async () => {
    const { service, stub } = make([jsonResponse({ id: 'conn/1' })]);
    await service.connection('conn/1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/connections/conn%2F1');
  });
});

describe('transactions', () => {
  it('maps every filter onto its snake_case query parameter', async () => {
    const { service, stub } = make([jsonResponse({ items: [], next_cursor: '' })]);
    await service.transactions({
      limit: 50,
      cursor: 'cur_1',
      direction: 'credit',
      connectionId: 'conn_1',
      from: '2026-08-01',
      to: '2026-08-27',
      q: 'PN-42',
      matchStatus: 'unmatched',
    });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v1/banking/transactions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '50',
      cursor: 'cur_1',
      direction: 'credit',
      connection_id: 'conn_1',
      from: '2026-08-01',
      to: '2026-08-27',
      q: 'PN-42',
      match_status: 'unmatched',
    });
  });

  it('returns a page of mapped transactions', async () => {
    const { service } = make([
      jsonResponse({ items: [{ id: 'tx_1', amount: 100 }], next_cursor: 'cur_2' }),
    ]);
    const page = await service.transactions();
    expect(page.items[0]!.id).toBe('tx_1');
    expect(page.nextCursor).toBe('cur_2');
  });

  it('carries the filters into the next page fetch and drops the old cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'tx_1' }], next_cursor: 'cur_2' }),
      jsonResponse({ items: [{ id: 'tx_2' }], next_cursor: '' }),
    ]);
    const seen: string[] = [];
    for await (const tx of await service.transactions({ limit: 1, direction: 'credit' })) {
      seen.push(tx.id);
    }
    expect(seen).toEqual(['tx_1', 'tx_2']);
    const second = new URL(stub.calls[1]!.url);
    expect(Object.fromEntries(second.searchParams)).toEqual({
      limit: '1',
      direction: 'credit',
      cursor: 'cur_2',
    });
  });

  it('treats a missing next_cursor as exhausted', async () => {
    const { service } = make([jsonResponse({ items: [{ id: 'tx_1' }] })]);
    const page = await service.transactions();
    expect(page.nextCursor).toBe('');
  });
});

describe('transaction and matchTransaction', () => {
  it('reads one transaction detail', async () => {
    const { service, stub } = make([jsonResponse({ id: 'tx_1', redelivery_count: 3 })]);
    const detail = await service.transaction('tx_1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/transactions/tx_1');
    expect(detail.redeliveryCount).toBe(3);
  });

  it('posts the intent id to the match endpoint', async () => {
    const { service, stub } = make([jsonResponse({ id: 'tx_1', match_status: 'matched' })]);
    const detail = await service.matchTransaction('tx_1', 'pi_9');
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v1/banking/transactions/tx_1/match');
    expect(call.body).toBe('{"intent_id":"pi_9"}');
    expect(detail.matchStatus).toBe('matched');
  });
});

describe('paymentIntents', () => {
  it('passes status and limit and returns a page', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'pi_1', expected_amount: 99000 }], next_cursor: '' }),
    ]);
    const page = await service.paymentIntents({ status: 'pending', limit: 20 });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v1/banking/payment-intents');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'pending', limit: '20' });
    expect(page.items[0]!.expectedAmount).toBe(99000);
  });
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createPaymentIntent', () => {
  it('posts the snake_case body without expires_in_secs when omitted', async () => {
    const { service, stub } = make([
      jsonResponse({ id: 'pi_1', code: 'PN-1', expected_amount: 99000, status: 'pending' }),
    ]);
    const intent = await service.createPaymentIntent({ code: 'PN-1', expectedAmount: 99000 });
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v1/banking/payment-intents');
    expect(JSON.parse(call.body!)).toEqual({ code: 'PN-1', expected_amount: 99000 });
    expect(intent.id).toBe('pi_1');
    expect(intent.status).toBe('pending');
  });

  it('includes expires_in_secs when given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'pi_1' })]);
    await service.createPaymentIntent({ code: 'PN-1', expectedAmount: 99000, expiresInSecs: 900 });
    expect(JSON.parse(stub.calls[0]!.body!)).toEqual({
      code: 'PN-1',
      expected_amount: 99000,
      expires_in_secs: 900,
    });
  });

  it('sends a server-generated UUID as Idempotency-Key when none is given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'pi_1' })]);
    await service.createPaymentIntent({ code: 'PN-1', expectedAmount: 99000 });
    expect(stub.calls[0]!.headers.get('idempotency-key')).toMatch(UUID_V4);
  });

  it('sends the caller-supplied Idempotency-Key when given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'pi_1' })]);
    await service.createPaymentIntent(
      { code: 'PN-1', expectedAmount: 99000 },
      { idempotencyKey: 'order-1042-attempt-1' },
    );
    expect(stub.calls[0]!.headers.get('idempotency-key')).toBe('order-1042-attempt-1');
  });
});

describe('paymentIntent', () => {
  it('reads one payment intent by id', async () => {
    const { service, stub } = make([jsonResponse({ id: 'pi_1', code: 'PN-1', status: 'matched' })]);
    const intent = await service.paymentIntent('pi_1');
    expect(stub.calls[0]!.method).toBe('GET');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/payment-intents/pi_1');
    expect(intent.status).toBe('matched');
  });

  it('url-encodes the intent id', async () => {
    const { service, stub } = make([jsonResponse({ id: 'pi/1' })]);
    await service.paymentIntent('pi/1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/payment-intents/pi%2F1');
  });
});

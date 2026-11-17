import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { WebhookEndpointService } from '../../src/services/webhook-endpoints.js';
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
  return { service: new WebhookEndpointService(transport), stub };
}

/** The masked form a v2 read gives back: host partly hidden, only the path tail. */
const MASKED = 'https://sh**.test/…hook';

function connector(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cnr_1',
    type: 'webhook',
    config: { url: MASKED },
    event_types: ['banking.credit'],
    active: true,
    description: 'shop',
    failure_count: 0,
    created_at: '2026-11-17T00:00:00Z',
    updated_at: '2026-11-17T00:00:00Z',
    ...extra,
  };
}

describe('create', () => {
  it('create posts type webhook, config.url, event_types and description', async () => {
    const { service, stub } = make([
      jsonResponse(connector({ secret: 'whsec_abc' }), { status: 201 }),
    ]);
    await service.create('https://shop.test/hook', ['banking.credit'], 'shop');
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v2/connectors');
    expect(JSON.parse(call.body!)).toEqual({
      type: 'webhook',
      config: { url: 'https://shop.test/hook' },
      event_types: ['banking.credit'],
      description: 'shop',
    });
  });

  it('defaults description to an empty string', async () => {
    const { service, stub } = make([jsonResponse(connector(), { status: 201 })]);
    await service.create('https://shop.test/hook', ['banking.credit']);
    expect(JSON.parse(stub.calls[0]!.body!)).toMatchObject({ description: '' });
  });

  it('create sends no Idempotency-Key and takes no options', async () => {
    const { service, stub } = make([jsonResponse(connector(), { status: 201 })]);
    // @ts-expect-error create has no options argument in 3.x: the operation is not idempotent.
    await service.create('https://shop.test/hook', ['banking.credit'], 'shop', {
      idempotencyKey: 'wh-create-1',
    });
    expect(stub.calls[0]!.headers.get('idempotency-key')).toBeNull();
  });

  it('create returns the secret once and redacts it', async () => {
    const { service } = make([jsonResponse(connector({ secret: 'whsec_abc' }), { status: 201 })]);
    const created = await service.create('https://shop.test/hook', ['banking.credit']);
    expect(created.id).toBe('cnr_1');
    expect(created.url).toBe(MASKED);
    expect(created.secret).toBe('whsec_abc');
    expect(inspect(created)).not.toContain('whsec_abc');
    expect(JSON.stringify(created)).not.toContain('whsec_abc');
  });
});

describe('all', () => {
  it('all lists type=webhook with limit and cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [connector()], next_cursor: 'cur_2' }),
      jsonResponse({ items: [connector({ id: 'cnr_2' })], next_cursor: null }),
    ]);
    const seen: string[] = [];
    for await (const endpoint of await service.all({ limit: 1 })) seen.push(endpoint.id);
    expect(seen).toEqual(['cnr_1', 'cnr_2']);
    const first = new URL(stub.calls[0]!.url);
    expect(first.pathname).toBe('/v2/connectors');
    expect(Object.fromEntries(first.searchParams)).toEqual({ type: 'webhook', limit: '1' });
    expect(Object.fromEntries(new URL(stub.calls[1]!.url).searchParams)).toEqual({
      type: 'webhook',
      limit: '1',
      cursor: 'cur_2',
    });
  });
});

describe('get, delete, enable, disable', () => {
  it('get reads the masked config.url as url', async () => {
    const { service, stub } = make([jsonResponse(connector({ failure_count: 4 }))]);
    const endpoint = await service.get('cnr_1');
    expect(stub.calls[0]!.method).toBe('GET');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/connectors/cnr_1');
    expect(endpoint.url).toBe(MASKED);
    expect(endpoint.failureCount).toBe(4);
  });

  it('delete sends DELETE and resolves on 204', async () => {
    const { service, stub } = make([new Response(null, { status: 204 })]);
    await expect(service.delete('cnr_1')).resolves.toBeUndefined();
    expect(stub.calls[0]!.method).toBe('DELETE');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/connectors/cnr_1');
  });

  it('enable sends PATCH {"active":true}', async () => {
    const { service, stub } = make([jsonResponse(connector())]);
    await expect(service.enable('cnr_1')).resolves.toBeUndefined();
    expect(stub.calls[0]!.method).toBe('PATCH');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/connectors/cnr_1');
    expect(JSON.parse(stub.calls[0]!.body!)).toEqual({ active: true });
  });

  it('disable sends PATCH {"active":false}', async () => {
    const { service, stub } = make([jsonResponse(connector({ active: false }))]);
    await expect(service.disable('cnr_1')).resolves.toBeUndefined();
    expect(stub.calls[0]!.method).toBe('PATCH');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v2/connectors/cnr_1');
    expect(JSON.parse(stub.calls[0]!.body!)).toEqual({ active: false });
  });
});

describe('rotateSecret', () => {
  it('rotateSecret posts rotate-secret without a body and redacts the new secret', async () => {
    const { service, stub } = make([
      jsonResponse({ secret: 'whsec_new', previous_expires_at: '2026-11-18T00:00:00Z' }),
    ]);
    const rotated = await service.rotateSecret('cnr_1');
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v2/connectors/cnr_1/rotate-secret');
    expect(call.body).toBeNull();
    expect(call.headers.get('content-type')).toBeNull();
    expect(call.headers.get('idempotency-key')).toBeNull();
    expect(rotated.secret).toBe('whsec_new');
    expect(rotated.previousExpiresAt).toBe('2026-11-18T00:00:00Z');
    expect(inspect(rotated)).not.toContain('whsec_new');
    expect(JSON.stringify(rotated)).not.toContain('whsec_new');
  });
});

describe('deliveries', () => {
  it('deliveries maps delivery_id, attempted_at, status and transaction_id', async () => {
    const { service, stub } = make([
      jsonResponse({
        items: [
          {
            delivery_id: '0b6f2b62-6f0e-4c39-9d1e-3f1c2a7f9b10',
            connector_id: 'cnr_1',
            event_type: 'banking.credit',
            attempt: 1,
            status: 'succeeded',
            status_code: 204,
            source: 'event',
            transaction_id: 'btx_1',
            attempted_at: '2026-11-17T00:00:01Z',
          },
        ],
        next_cursor: null,
      }),
    ]);
    const page = await service.deliveries('cnr_1', { limit: 10 });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v2/connectors/cnr_1/deliveries');
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '10' });
    expect(page.items[0]).toEqual({
      deliveryId: '0b6f2b62-6f0e-4c39-9d1e-3f1c2a7f9b10',
      eventType: 'banking.credit',
      attempt: 1,
      status: 'succeeded',
      statusCode: 204,
      error: null,
      transactionId: 'btx_1',
      attemptedAt: '2026-11-17T00:00:01Z',
    });
  });

  it('keeps the endpoint id when following the cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ delivery_id: 'd1' }], next_cursor: 'cur_2' }),
      jsonResponse({ items: [{ delivery_id: 'd2' }], next_cursor: null }),
    ]);
    const seen: string[] = [];
    for await (const delivery of await service.deliveries('cnr_1')) seen.push(delivery.deliveryId);
    expect(seen).toEqual(['d1', 'd2']);
    const second = new URL(stub.calls[1]!.url);
    expect(second.pathname).toBe('/v2/connectors/cnr_1/deliveries');
    expect(Object.fromEntries(second.searchParams)).toEqual({ cursor: 'cur_2' });
  });
});

describe('ids in paths', () => {
  it('url-encodes the endpoint id on every path', async () => {
    const { service, stub } = make([
      jsonResponse(connector()),
      new Response(null, { status: 204 }),
      jsonResponse(connector()),
      jsonResponse(connector()),
      jsonResponse({ secret: 'whsec_new' }),
      jsonResponse({ items: [], next_cursor: null }),
    ]);
    await service.get('cnr/1');
    await service.delete('cnr/1');
    await service.enable('cnr/1');
    await service.disable('cnr/1');
    await service.rotateSecret('cnr/1');
    await service.deliveries('cnr/1');
    expect(stub.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v2/connectors/cnr%2F1',
      '/v2/connectors/cnr%2F1',
      '/v2/connectors/cnr%2F1',
      '/v2/connectors/cnr%2F1',
      '/v2/connectors/cnr%2F1/rotate-secret',
      '/v2/connectors/cnr%2F1/deliveries',
    ]);
  });
});

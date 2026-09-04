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

describe('create', () => {
  it('posts url, event_types and description, and returns the secret once', async () => {
    const { service, stub } = make([
      jsonResponse({ id: 'wh_1', url: 'https://shop.test/hook', secret: 'whsec_abc' }),
    ]);
    const created = await service.create('https://shop.test/hook', ['bank.credit'], 'shop');
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://api.bankapi.vn/v1/webhooks');
    expect(JSON.parse(call.body!)).toEqual({
      url: 'https://shop.test/hook',
      event_types: ['bank.credit'],
      description: 'shop',
    });
    expect(created.secret).toBe('whsec_abc');
  });

  it('defaults description to an empty string', async () => {
    const { service, stub } = make([jsonResponse({ id: 'wh_1' })]);
    await service.create('https://shop.test/hook', ['bank.credit']);
    expect(JSON.parse(stub.calls[0]!.body!)).toEqual({
      url: 'https://shop.test/hook',
      event_types: ['bank.credit'],
      description: '',
    });
  });

  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('sends an SDK-generated UUID as Idempotency-Key when no options are given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'wh_1' })]);
    await service.create('https://shop.test/hook', ['bank.credit']);
    expect(stub.calls[0]!.headers.get('idempotency-key')).toMatch(UUID_V4);
  });

  it('sends the caller-supplied Idempotency-Key when given', async () => {
    const { service, stub } = make([jsonResponse({ id: 'wh_1' })]);
    await service.create('https://shop.test/hook', ['bank.credit'], 'shop', {
      idempotencyKey: 'wh-create-1',
    });
    expect(stub.calls[0]!.headers.get('idempotency-key')).toBe('wh-create-1');
  });
});

describe('all', () => {
  it('returns a page and keeps the limit when following the cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'wh_1' }], next_cursor: 'cur_2' }),
      jsonResponse({ items: [{ id: 'wh_2' }], next_cursor: '' }),
    ]);
    const seen: string[] = [];
    for await (const endpoint of await service.all({ limit: 1 })) seen.push(endpoint.id);
    expect(seen).toEqual(['wh_1', 'wh_2']);
    expect(Object.fromEntries(new URL(stub.calls[1]!.url).searchParams)).toEqual({
      limit: '1',
      cursor: 'cur_2',
    });
  });
});

describe('get, delete, enable', () => {
  it('reads one endpoint', async () => {
    const { service, stub } = make([jsonResponse({ id: 'wh_1', failure_count: 4 })]);
    const endpoint = await service.get('wh_1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks/wh_1');
    expect(endpoint.failureCount).toBe(4);
  });

  it('deletes an endpoint and resolves to undefined', async () => {
    const { service, stub } = make([new Response(null, { status: 204 })]);
    await expect(service.delete('wh_1')).resolves.toBeUndefined();
    expect(stub.calls[0]!.method).toBe('DELETE');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks/wh_1');
  });

  it('enables an endpoint', async () => {
    const { service, stub } = make([new Response(null, { status: 204 })]);
    await service.enable('wh_1');
    expect(stub.calls[0]!.method).toBe('POST');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks/wh_1/enable');
  });

  it('url-encodes the endpoint id on every path', async () => {
    const { service, stub } = make([new Response(null, { status: 204 })]);
    await service.enable('wh/1');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks/wh%2F1/enable');
  });
});

describe('deliveries', () => {
  it('lists deliveries for one endpoint', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'dl_1', status_code: 500 }], next_cursor: '' }),
    ]);
    const page = await service.deliveries('wh_1', { limit: 10 });
    const url = new URL(stub.calls[0]!.url);
    expect(url.pathname).toBe('/v1/webhooks/wh_1/deliveries');
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '10' });
    expect(page.items[0]!.statusCode).toBe(500);
  });

  it('keeps the endpoint id when following the cursor', async () => {
    const { service, stub } = make([
      jsonResponse({ items: [{ id: 'dl_1' }], next_cursor: 'cur_2' }),
      jsonResponse({ items: [{ id: 'dl_2' }], next_cursor: '' }),
    ]);
    const seen: string[] = [];
    for await (const delivery of await service.deliveries('wh_1')) seen.push(delivery.id);
    expect(seen).toEqual(['dl_1', 'dl_2']);
    expect(new URL(stub.calls[1]!.url).pathname).toBe('/v1/webhooks/wh_1/deliveries');
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  BankApiError,
  ConnectionError,
  MalformedResponseError,
  RateLimitError,
  ValidationError,
} from '../src/errors.js';
import { API_VERSION_PATH, Transport } from '../src/transport.js';
import { VERSION } from '../src/version.js';
import { jsonResponse, stubFetch } from './helpers/fetch.js';

function make(queue: Array<Response | Error>, overrides: Record<string, unknown> = {}) {
  const stub = stubFetch(queue);
  const sleep = vi.fn(async (_ms: number) => {});
  const transport = new Transport({
    apiKey: 'bk_test_key',
    baseUrl: 'https://api.bankapi.vn',
    fetch: stub.fetch,
    sleep,
    ...overrides,
  });
  return { transport, stub, sleep };
}

describe('Transport request shape', () => {
  it('sends the API key, accept and user-agent headers', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await transport.request('GET', '/banking/summary');
    const call = stub.calls[0]!;
    expect(call.url).toBe('https://api.bankapi.vn/v1/banking/summary');
    expect(call.headers.get('x-api-key')).toBe('bk_test_key');
    expect(call.headers.get('accept')).toBe('application/json');
    expect(call.headers.get('user-agent')).toBe(`bankapi-node/${VERSION}`);
  });

  it('appends the query string and drops undefined values', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await transport.request('GET', '/banking/transactions', {
      limit: 50,
      cursor: undefined,
      q: 'thanh toan',
    });
    expect(stub.calls[0]!.url).toBe(
      'https://api.bankapi.vn/v1/banking/transactions?limit=50&q=thanh+toan',
    );
  });

  it('omits the query string entirely when nothing is set', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await transport.request('GET', '/webhooks', { limit: undefined });
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks');
  });

  it('sends a JSON body with a content-type on mutations', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await transport.request('POST', '/webhooks', {}, { url: 'https://x.test' });
    const call = stub.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.body).toBe('{"url":"https://x.test"}');
  });

  it('strips a trailing slash from the base URL', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })], {
      baseUrl: 'https://api.bankapi.vn/',
    });
    await transport.request('GET', '/webhooks');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/webhooks');
  });
});

describe('API_VERSION_PATH', () => {
  it('joins the base URL under /v1 for every path, with and without a query', async () => {
    expect(API_VERSION_PATH).toBe('/v1');
    const { transport, stub } = make([jsonResponse({ ok: true }), jsonResponse({ ok: true })]);
    await transport.request('GET', '/banking/summary');
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/v1/banking/summary');
    await transport.request('GET', '/banking/summary', { days: 7 });
    expect(stub.calls[1]!.url).toBe('https://api.bankapi.vn/v1/banking/summary?days=7');
  });
});

describe('Idempotency-Key', () => {
  it('sends the key verbatim as the Idempotency-Key header', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await transport.request(
      'POST',
      '/webhooks',
      {},
      { url: 'https://x.test' },
      {
        idempotencyKey: 'retry-key_1',
      },
    );
    expect(stub.calls[0]!.headers.get('idempotency-key')).toBe('retry-key_1');
  });

  it('rejects a key with characters outside [A-Za-z0-9_-] before any fetch', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await expect(
      transport.request(
        'POST',
        '/webhooks',
        {},
        { url: 'https://x.test' },
        {
          idempotencyKey: 'bad key!',
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(stub.calls).toHaveLength(0);
  });

  it('rejects a key longer than 64 characters before any fetch', async () => {
    const { transport, stub } = make([jsonResponse({ ok: true })]);
    await expect(
      transport.request(
        'POST',
        '/webhooks',
        {},
        { url: 'https://x.test' },
        {
          idempotencyKey: 'a'.repeat(65),
        },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('Transport decoding', () => {
  it('returns the decoded object on 2xx', async () => {
    const { transport } = make([jsonResponse({ count: 3 })]);
    await expect(transport.request('GET', '/banking/summary')).resolves.toEqual({ count: 3 });
  });

  it('returns an empty object for an empty 2xx body', async () => {
    const { transport } = make([new Response(null, { status: 204 })]);
    await expect(transport.request('DELETE', '/webhooks/wh_1')).resolves.toEqual({});
  });

  it('throws MalformedResponseError when a 2xx body is not JSON', async () => {
    const { transport } = make([new Response('<html>captive portal</html>', { status: 200 })]);
    await expect(transport.request('GET', '/banking/summary')).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });

  it('still maps errors by status when the error body is not problem+json', async () => {
    const { transport } = make([new Response('<html>bad gateway</html>', { status: 502 })]);
    const err = await transport.request('POST', '/webhooks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BankApiError);
    expect((err as BankApiError).status).toBe(502);
  });
});

describe('Transport error mapping', () => {
  it('maps 400 to ValidationError with the problem body', async () => {
    const { transport } = make([
      jsonResponse({ title: 'Bad Request', detail: 'limit too large' }, { status: 400 }),
    ]);
    const err = await transport.request('GET', '/banking/transactions').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).detail).toBe('limit too large');
  });

  it('maps a network failure to ConnectionError with the cause', async () => {
    const boom = new TypeError('fetch failed');
    const { transport } = make([boom], { maxRetries: 0 });
    const err = await transport.request('GET', '/banking/summary').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect((err as ConnectionError).status).toBe(0);
    expect((err as ConnectionError).cause).toBe(boom);
  });
});

describe('Transport retry policy', () => {
  it('retries a GET on 500 and returns the eventual success', async () => {
    const { transport, stub, sleep } = make([
      jsonResponse({}, { status: 500 }),
      jsonResponse({ count: 1 }),
    ]);
    await expect(transport.request('GET', '/banking/summary')).resolves.toEqual({ count: 1 });
    expect(stub.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('retries a GET on 429', async () => {
    const { transport, stub } = make([jsonResponse({}, { status: 429 }), jsonResponse({ ok: 1 })]);
    await transport.request('GET', '/banking/summary');
    expect(stub.calls).toHaveLength(2);
  });

  it('retries a GET on a network error', async () => {
    const { transport, stub } = make([new TypeError('fetch failed'), jsonResponse({ ok: 1 })]);
    await transport.request('GET', '/banking/summary');
    expect(stub.calls).toHaveLength(2);
  });

  it('gives up after maxRetries and throws the last status', async () => {
    const { transport, stub } = make([
      jsonResponse({}, { status: 503 }),
      jsonResponse({}, { status: 503 }),
      jsonResponse({ title: 'Service Unavailable', detail: 'down' }, { status: 503 }),
    ]);
    const err = await transport.request('GET', '/banking/summary').catch((e: unknown) => e);
    expect((err as BankApiError).status).toBe(503);
    expect(stub.calls).toHaveLength(3);
  });

  it('never retries a mutation', async () => {
    const { transport, stub } = make([jsonResponse({}, { status: 500 })]);
    await transport.request('POST', '/webhooks').catch(() => undefined);
    expect(stub.calls).toHaveLength(1);
  });

  it('never retries a 4xx other than 429', async () => {
    const { transport, stub } = make([jsonResponse({}, { status: 404 })]);
    await transport.request('GET', '/webhooks/wh_1').catch(() => undefined);
    expect(stub.calls).toHaveLength(1);
  });

  it('surfaces Retry-After on 429 once retries are exhausted', async () => {
    const { transport } = make(
      [jsonResponse({}, { status: 429, headers: { 'retry-after': '9' } })],
      {
        maxRetries: 0,
      },
    );
    const err = await transport.request('GET', '/banking/summary').catch((e: unknown) => e);
    expect((err as RateLimitError).retryAfter).toBe(9);
  });

  it('honors a numeric Retry-After for the retry delay', async () => {
    const { transport, sleep } = make([
      jsonResponse({}, { status: 429, headers: { 'retry-after': '3' } }),
      jsonResponse({ ok: 1 }),
    ]);
    await transport.request('GET', '/banking/summary');
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it('caps the Retry-After delay at 60s', async () => {
    const { transport, sleep } = make([
      jsonResponse({}, { status: 429, headers: { 'retry-after': '999' } }),
      jsonResponse({ ok: 1 }),
    ]);
    await transport.request('GET', '/banking/summary');
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('falls back to formula backoff on a non-numeric Retry-After', async () => {
    const { transport, sleep } = make([
      jsonResponse(
        {},
        { status: 429, headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } },
      ),
      jsonResponse({ ok: 1 }),
    ]);
    await transport.request('GET', '/banking/summary');
    const delay = sleep.mock.calls[0]![0] as number;
    expect(delay).toBeGreaterThanOrEqual(200);
    expect(delay).toBeLessThanOrEqual(300);
  });

  it('backs off longer on each attempt', async () => {
    const { transport, sleep } = make([
      jsonResponse({}, { status: 500 }),
      jsonResponse({}, { status: 500 }),
      jsonResponse({ ok: 1 }),
    ]);
    await transport.request('GET', '/banking/summary');
    const [first, second] = sleep.mock.calls.map((c) => c[0] as number);
    expect(first).toBeGreaterThanOrEqual(200);
    expect(first).toBeLessThanOrEqual(300);
    expect(second).toBeGreaterThanOrEqual(400);
    expect(second).toBeLessThanOrEqual(500);
  });
});

describe('Transport timeout', () => {
  it('passes an abort signal on every request', async () => {
    const stub = stubFetch([jsonResponse({ ok: 1 })]);
    let seen: AbortSignal | null | undefined;
    const spy = (async (input: string | Request | URL, init?: RequestInit) => {
      seen = init?.signal;
      return stub.fetch(input, init);
    }) as typeof globalThis.fetch;
    const transport = new Transport({
      apiKey: 'k',
      baseUrl: 'https://api.bankapi.vn',
      fetch: spy,
      timeoutMs: 25,
    });
    await transport.request('GET', '/banking/summary');
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});

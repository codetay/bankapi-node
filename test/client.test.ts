import { describe, expect, it } from 'vitest';
import { BankApi } from '../src/client.js';
import { BankingService } from '../src/services/banking.js';
import { WebhookEndpointService } from '../src/services/webhook-endpoints.js';
import { VERSION } from '../src/version.js';
import { jsonResponse, stubFetch } from './helpers/fetch.js';

describe('construction', () => {
  it('accepts a bare API key and defaults to the production base URL', async () => {
    const stub = stubFetch([jsonResponse({})]);
    const client = new BankApi({ apiKey: 'bk_live_1', fetch: stub.fetch });
    await client.banking.summary();
    expect(stub.calls[0]!.url).toBe('https://api.bankapi.vn/banking/summary');
  });

  it('accepts the shorthand string form', () => {
    expect(() => new BankApi('bk_live_1')).not.toThrow();
  });

  it('exposes the package version', () => {
    expect(BankApi.VERSION).toBe(VERSION);
  });

  it('returns the same service instance on repeated access', () => {
    const client = new BankApi('bk_live_1');
    expect(client.banking).toBeInstanceOf(BankingService);
    expect(client.banking).toBe(client.banking);
    expect(client.webhookEndpoints).toBeInstanceOf(WebhookEndpointService);
    expect(client.webhookEndpoints).toBe(client.webhookEndpoints);
  });
});

describe('base URL safety', () => {
  it('accepts an https base URL', () => {
    expect(() => new BankApi({ apiKey: 'k', baseUrl: 'https://sandbox.bankapi.vn' })).not.toThrow();
  });

  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])(
    'allows plain http for the loopback host %s',
    (baseUrl) => {
      expect(() => new BankApi({ apiKey: 'k', baseUrl })).not.toThrow();
    },
  );

  it('rejects plain http against a remote host — the API key would go out in clear text', () => {
    expect(() => new BankApi({ apiKey: 'k', baseUrl: 'http://api.bankapi.vn' })).toThrow(TypeError);
  });

  it('rejects a non-absolute base URL', () => {
    expect(() => new BankApi({ apiKey: 'k', baseUrl: 'api.bankapi.vn' })).toThrow(TypeError);
  });

  it('rejects a non-http scheme', () => {
    expect(() => new BankApi({ apiKey: 'k', baseUrl: 'ftp://api.bankapi.vn' })).toThrow(TypeError);
  });

  it('strips a trailing slash', async () => {
    const stub = stubFetch([jsonResponse({})]);
    const client = new BankApi({
      apiKey: 'k',
      baseUrl: 'https://sandbox.bankapi.vn/',
      fetch: stub.fetch,
    });
    await client.banking.summary();
    expect(stub.calls[0]!.url).toBe('https://sandbox.bankapi.vn/banking/summary');
  });
});

describe('option plumbing', () => {
  it('passes maxRetries through to the transport', async () => {
    const stub = stubFetch([jsonResponse({}, { status: 500 })]);
    const client = new BankApi({ apiKey: 'k', fetch: stub.fetch, maxRetries: 0 });
    await client.banking.summary().catch(() => undefined);
    expect(stub.calls).toHaveLength(1);
  });
});

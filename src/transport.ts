import { ConnectionError, MalformedResponseError, errorFromResponse } from './errors.js';
import { VERSION } from './version.js';

export type QueryValue = string | number | undefined;

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  /** Defaults to globalThis.fetch; inject a stub in tests. */
  fetch?: typeof globalThis.fetch;
  /** GET-only retries on 429/5xx/network error. Default 2. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Overridable for tests so backoff does not cost real time. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * fetch wrapper owning the auth header, JSON codec, problem+json mapping and
 * bounded retry (GET only, 429/5xx/network, backoff + jitter).
 */
export class Transport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TransportOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request(
    method: string,
    path: string,
    query: Record<string, QueryValue> = {},
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = this.buildUrl(path, query);
    const init = this.buildInit(method, body);

    for (let attempt = 0; ;) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        if (this.canRetry(method, attempt)) {
          await this.backoff(++attempt);
          continue;
        }
        throw new ConnectionError(cause instanceof Error ? cause.message : String(cause), cause);
      }

      if (response.ok) {
        return await this.decode(response, true);
      }
      if ((response.status === 429 || response.status >= 500) && this.canRetry(method, attempt)) {
        // An abandoned body keeps the socket allocated in undici — cancel it.
        void response.body?.cancel();
        await this.backoff(++attempt);
        continue;
      }

      throw errorFromResponse(
        response.status,
        await this.decode(response, false),
        response.headers,
      );
    }
  }

  private buildUrl(path: string, query: Record<string, QueryValue>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs === '' ? '' : `?${qs}`}`;
  }

  private buildInit(method: string, body: unknown): RequestInit {
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': `bankapi-node/${VERSION}`,
    };
    if (body === undefined) {
      return { method, headers };
    }
    headers['Content-Type'] = 'application/json';
    return { method, headers, body: JSON.stringify(body) };
  }

  /**
   * Strict mode (2xx path) refuses a non-JSON or non-object body instead of
   * silently returning empty data; the lenient mode (error path) keeps mapping
   * by status even when the error body is not valid problem+json.
   */
  private async decode(response: Response, strict: boolean): Promise<Record<string, unknown>> {
    const raw = await response.text();
    if (raw.trim() === '') return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to the strict/lenient decision below
    }
    if (strict) {
      throw new MalformedResponseError(response.status, 'response body is not a JSON object');
    }
    return {};
  }

  private canRetry(method: string, attempt: number): boolean {
    return method.toUpperCase() === 'GET' && attempt < this.maxRetries;
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(2 ** attempt * 100 + Math.floor(Math.random() * 101));
  }
}

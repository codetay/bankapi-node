import { BankingService } from './services/banking.js';
import { WebhookEndpointService } from './services/webhook-endpoints.js';
import { API_VERSION_PATH, Transport } from './transport.js';
import { VERSION } from './version.js';

const DEFAULT_BASE_URL = 'https://api.bankapi.vn';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface BankApiOptions {
  apiKey: string;
  /** Defaults to https://api.bankapi.vn. Must be https unless it is loopback. */
  baseUrl?: string;
  /** Defaults to globalThis.fetch; inject a stub in tests. */
  fetch?: typeof globalThis.fetch;
  /** GET-only retries on 429/5xx/network error. Default 2. */
  maxRetries?: number;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
}

/** Entry point. Services are created on first access and then reused. */
export class BankApi {
  static readonly VERSION = VERSION;

  private readonly transport: Transport;
  private bankingService: BankingService | null = null;
  private webhookEndpointService: WebhookEndpointService | null = null;

  constructor(options: string | BankApiOptions) {
    const resolved: BankApiOptions = typeof options === 'string' ? { apiKey: options } : options;
    this.transport = new Transport({
      apiKey: resolved.apiKey,
      baseUrl: requireSecureBaseUrl(resolved.baseUrl ?? DEFAULT_BASE_URL),
      fetch: resolved.fetch,
      maxRetries: resolved.maxRetries,
      timeoutMs: resolved.timeoutMs,
    });
  }

  get banking(): BankingService {
    return (this.bankingService ??= new BankingService(this.transport));
  }

  get webhookEndpoints(): WebhookEndpointService {
    return (this.webhookEndpointService ??= new WebhookEndpointService(this.transport));
  }
}

/**
 * The API key rides on every request, so the base URL has to be https — a
 * misconfigured "http://" would put it on the wire in clear text. Plain http
 * is allowed only against a loopback host, for local development.
 */
function requireSecureBaseUrl(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new TypeError('BankAPI base URL must be an absolute URL, e.g. https://api.bankapi.vn');
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  if (scheme !== 'https' && !(scheme === 'http' && isLoopback)) {
    throw new TypeError(
      `BankAPI base URL must use https (got "${scheme}"); plain http is only allowed for loopback hosts.`,
    );
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith(API_VERSION_PATH)) {
    throw new TypeError(
      'baseUrl must be the API origin (e.g. https://acme.bankapi.vn); the SDK appends /v1',
    );
  }

  return trimmed;
}

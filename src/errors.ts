/** Extra context threaded through every BankApiError subclass constructor. */
export interface BankApiErrorOptions {
  cause?: unknown;
  /** problem.type with the urn:bankapi:error: prefix stripped; undefined for any other prefix. */
  code?: string;
  /** From the Idempotent-Replayed response header. */
  replayed?: boolean;
}

/** Base class for every error the SDK throws for an HTTP interaction. */
export class BankApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly body: Record<string, unknown>;
  readonly code?: string;
  readonly replayed: boolean;

  constructor(
    status: number,
    title: string,
    detail: string,
    body: Record<string, unknown> = {},
    options?: BankApiErrorOptions,
  ) {
    super(
      `[${status}] ${title}: ${detail}`,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = new.target.name;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.body = body;
    this.code = options?.code;
    this.replayed = options?.replayed ?? false;
  }
}

export class ValidationError extends BankApiError {}
export class AuthenticationError extends BankApiError {}
export class PermissionError extends BankApiError {}
export class NotFoundError extends BankApiError {}

export class RateLimitError extends BankApiError {
  readonly retryAfter: number | null;

  constructor(
    status: number,
    title: string,
    detail: string,
    body: Record<string, unknown> = {},
    retryAfter: number | null = null,
    options?: BankApiErrorOptions,
  ) {
    super(status, title, detail, body, options);
    this.retryAfter = retryAfter;
  }
}

/**
 * No HTTP response was received (DNS, connect, TLS, abort/timeout). status is
 * always 0; the underlying error is available on `cause`.
 */
export class ConnectionError extends BankApiError {
  constructor(detail: string, cause?: unknown) {
    super(0, 'Connection error', detail, {}, { cause });
  }
}

/**
 * A 2xx response whose body is not a JSON object (e.g. an HTML page from a
 * proxy or captive portal). Raised instead of silently returning empty data;
 * status carries the actual 2xx status code.
 */
export class MalformedResponseError extends BankApiError {
  constructor(status: number, detail: string) {
    super(status, 'Malformed response', detail);
  }
}

/** Webhook verification failure. Not an HTTP error, so not a BankApiError. */
export class SignatureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignatureVerificationError';
  }
}

const ERROR_CODE_PREFIX = 'urn:bankapi:error:';

/** Strips the registry prefix off problem.type; undefined for any other prefix or shape. */
function errorCode(problem: Record<string, unknown>): string | undefined {
  const type = typeof problem.type === 'string' ? problem.type : undefined;
  return type?.startsWith(ERROR_CODE_PREFIX) ? type.slice(ERROR_CODE_PREFIX.length) : undefined;
}

/** The header value match is case-insensitive; the header name lookup already is. */
function isReplayed(headers: Headers): boolean {
  return headers.get('idempotent-replayed')?.trim().toLowerCase() === 'true';
}

/** Build the right error subclass from an RFC 7807 problem+json response. */
export function errorFromResponse(
  status: number,
  problem: Record<string, unknown>,
  headers: Headers,
): BankApiError {
  const title = typeof problem.title === 'string' ? problem.title : 'API error';
  const detail = typeof problem.detail === 'string' ? problem.detail : '';
  const options: BankApiErrorOptions = { code: errorCode(problem), replayed: isReplayed(headers) };

  switch (status) {
    case 400:
    case 422:
      return new ValidationError(status, title, detail, problem, options);
    case 401:
      return new AuthenticationError(status, title, detail, problem, options);
    case 403:
      return new PermissionError(status, title, detail, problem, options);
    case 404:
      return new NotFoundError(status, title, detail, problem, options);
    case 429:
      return new RateLimitError(status, title, detail, problem, retryAfter(headers), options);
    default:
      return new BankApiError(status, title, detail, problem, options);
  }
}

/** Only the delay-seconds form is understood; an HTTP-date yields null. */
function retryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Base class for every error the SDK throws for an HTTP interaction. */
export class BankApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly body: Record<string, unknown>;

  constructor(
    status: number,
    title: string,
    detail: string,
    body: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(`[${status}] ${title}: ${detail}`, options);
    this.name = new.target.name;
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.body = body;
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
  ) {
    super(status, title, detail, body);
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

/** Build the right error subclass from an RFC 7807 problem+json response. */
export function errorFromResponse(
  status: number,
  problem: Record<string, unknown>,
  headers: Headers,
): BankApiError {
  const title = typeof problem.title === 'string' ? problem.title : 'API error';
  const detail = typeof problem.detail === 'string' ? problem.detail : '';

  switch (status) {
    case 400:
    case 422:
      return new ValidationError(status, title, detail, problem);
    case 401:
      return new AuthenticationError(status, title, detail, problem);
    case 403:
      return new PermissionError(status, title, detail, problem);
    case 404:
      return new NotFoundError(status, title, detail, problem);
    case 429:
      return new RateLimitError(status, title, detail, problem, retryAfter(headers));
    default:
      return new BankApiError(status, title, detail, problem);
  }
}

/** Only the delay-seconds form is understood; an HTTP-date yields null. */
function retryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

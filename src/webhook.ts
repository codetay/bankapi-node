import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from './errors.js';
import type { WebhookEnvelope } from './webhook-events.js';

const DEFAULT_TOLERANCE = 300;
const SECRET_PREFIX = 'whsec_';

/** The delivery a verified request came from. webhookId is the dedupe key. */
export interface VerifiedDelivery {
  webhookId: string;
  timestamp: number;
}

/** A verified BankAPI webhook: the v1 envelope plus its delivery headers. */
export type WebhookEvent = WebhookEnvelope & VerifiedDelivery;

export type HeaderBag = Headers | Record<string, string | string[] | undefined>;

export interface ConstructEventOptions {
  /** Max |now - webhook-timestamp| in seconds, both directions. Default 300. */
  tolerance?: number;
  /** Overrides the current Unix time in seconds; for tests. */
  now?: number;
}

/**
 * The HMAC key of a whsec_ secret. Node's base64 decoder accepts the standard
 * and the URL-safe alphabet, padded or not, so secrets minted before envelope
 * v1 (base64url) decode to the same key.
 */
export function decodeSecret(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = Buffer.from(encoded, 'base64');
  if (encoded === '' || key.length === 0) {
    throw new SignatureVerificationError('webhook secret must be whsec_<base64>');
  }
  return key;
}

/**
 * Standard Webhooks verification: any v1 entry of webhook-signature must equal
 * base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{raw body}")), and
 * the timestamp must be within the tolerance. The signature is checked first.
 */
export function verifySignature(
  payload: string | Buffer,
  headers: HeaderBag,
  secret: string,
  options: ConstructEventOptions = {},
): VerifiedDelivery {
  const key = decodeSecret(secret);
  const lookup = normalizeHeaders(headers);
  const webhookId = required(lookup, 'webhook-id');
  const timestampRaw = required(lookup, 'webhook-timestamp');
  const signatureHeader = required(lookup, 'webhook-signature');

  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const expected = createHmac('sha256', key)
    .update(`${webhookId}.${timestampRaw}.`, 'utf8')
    .update(body)
    .digest();
  const matched = signatureHeader.split(' ').some((entry) => {
    const comma = entry.indexOf(',');
    if (comma < 0 || entry.slice(0, comma) !== 'v1') return false;
    const given = Buffer.from(entry.slice(comma + 1), 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) {
    throw new SignatureVerificationError('webhook signature mismatch');
  }

  if (!/^\d+$/.test(timestampRaw)) {
    throw new SignatureVerificationError('webhook-timestamp is not Unix seconds');
  }
  const timestamp = Number(timestampRaw);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (Math.abs(now - timestamp) > tolerance) {
    throw new SignatureVerificationError('webhook timestamp outside tolerance');
  }
  return { webhookId, timestamp };
}

/**
 * Verifies a BankAPI webhook and parses its v1 envelope. An event type this
 * SDK does not know is returned as an UnknownWebhookEnvelope, never an error.
 */
export function constructEvent(
  payload: string | Buffer,
  headers: HeaderBag,
  secret: string,
  options: ConstructEventOptions = {},
): WebhookEvent {
  const delivery = verifySignature(payload, headers, secret, options);
  const raw = typeof payload === 'string' ? payload : payload.toString('utf8');
  return { ...parseEnvelope(raw), ...delivery };
}

function parseEnvelope(raw: string): WebhookEnvelope {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new SignatureVerificationError('signed payload is not JSON');
  }
  const e = asRecord(decoded);
  if (
    typeof e.id !== 'string' ||
    typeof e.type !== 'string' ||
    e.type === '' ||
    typeof e.api_version !== 'string' ||
    typeof e.created_at !== 'string' ||
    typeof e.org_id !== 'string' ||
    typeof e.data !== 'object' ||
    e.data === null ||
    Array.isArray(e.data)
  ) {
    throw new SignatureVerificationError('signed payload is not a webhook envelope');
  }
  return e as unknown as WebhookEnvelope;
}

function normalizeHeaders(headers: HeaderBag): Map<string, string> {
  const out = new Map<string, string>();
  if (headers instanceof Headers) {
    headers.forEach((value, name) => out.set(name.toLowerCase(), value));
    return out;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out.set(name.toLowerCase(), Array.isArray(value) ? (value[0] ?? '') : value);
  }
  return out;
}

function required(headers: Map<string, string>, name: string): string {
  const value = headers.get(name) ?? '';
  if (value === '') {
    throw new SignatureVerificationError(`missing ${name} header`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

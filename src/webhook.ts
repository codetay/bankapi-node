import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError } from './errors.js';

const SIGNATURE_PREFIX = 'sha256=';
const DEFAULT_TOLERANCE = 300;

/** A verified webhook event. deliveryId is the receiver-side idempotency key. */
export interface WebhookEvent {
  type: string;
  deliveryId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type HeaderBag = Headers | Record<string, string | string[] | undefined>;

export interface ConstructEventOptions {
  /** Max |now - timestamp| in seconds (replay guard). Default 300. */
  tolerance?: number;
  /** Overrides the current Unix time in seconds; for tests. */
  now?: number;
}

/**
 * Verifies a BankAPI webhook: HMAC-SHA256 hex over
 * "<delivery_id>.<timestamp>.<raw body>", carried as "sha256=<hex>" in
 * X-Webhook-Signature. The signature is checked before the timestamp
 * tolerance, and the event type is read from the signed body only.
 */
export function constructEvent(
  payload: string | Buffer,
  headers: HeaderBag,
  secret: string,
  options: ConstructEventOptions = {},
): WebhookEvent {
  if (secret === '') {
    throw new SignatureVerificationError('webhook secret must not be empty');
  }

  const lookup = normalizeHeaders(headers);
  const deliveryId = required(lookup, 'x-webhook-delivery-id');
  const timestampRaw = required(lookup, 'x-webhook-timestamp');
  const signatureHeader = required(lookup, 'x-webhook-signature');

  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    throw new SignatureVerificationError('X-Webhook-Signature is not in "sha256=<hex>" form');
  }

  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const hmac = createHmac('sha256', secret);
  hmac.update(`${deliveryId}.${timestampRaw}.`, 'utf8');
  hmac.update(body);
  const expected = Buffer.from(hmac.digest('hex'), 'utf8');
  const provided = Buffer.from(signatureHeader.slice(SIGNATURE_PREFIX.length), 'utf8');

  // Length is compared first: timingSafeEqual throws on a length mismatch,
  // and the digest length is fixed and public anyway.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new SignatureVerificationError('webhook signature mismatch');
  }

  const timestamp = Number.parseInt(timestampRaw, 10);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > tolerance) {
    throw new SignatureVerificationError('webhook timestamp outside tolerance');
  }

  const decoded = parseJsonObject(body.toString('utf8'));
  // The event type comes from the SIGNED body only. X-Webhook-Event is outside
  // the signed string, so honouring it would let a replayed delivery be
  // re-labelled and routed down the wrong branch.
  const type = decoded.event;
  if (typeof type !== 'string' || type === '') {
    throw new SignatureVerificationError('signed payload has no event type');
  }

  return { type, deliveryId, timestamp, data: asRecord(decoded.data) };
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

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

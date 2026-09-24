import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SignatureVerificationError } from '../src/errors.js';
import { constructEvent, decodeSecret, verifySignature } from '../src/webhook.js';
import { isWebhookEvent, WEBHOOK_EVENT_TYPES } from '../src/webhook-events.js';

interface Vector {
  name: string;
  secret: string;
  previous_secret?: string;
  msg_id: string;
  timestamp: string;
  body: string;
  signature_header: string;
}

const file = JSON.parse(
  readFileSync(new URL('./fixtures/webhook_vectors.json', import.meta.url), 'utf8'),
) as { tolerance_seconds: number; standard_webhooks_reference: Vector; vectors: Vector[] };

function byName(name: string): Vector {
  const v = file.vectors.find((x) => x.name === name);
  if (!v) throw new Error(`vector ${name} missing from the GO-KIT fixture`);
  return v;
}

const headersFor = (v: Vector): Record<string, string> => ({
  'webhook-id': v.msg_id,
  'webhook-timestamp': v.timestamp,
  'webhook-signature': v.signature_header,
});
const at = (v: Vector) => ({ now: Number(v.timestamp) });

describe('golden vectors from GO-KIT', () => {
  it('verifies every vector, and a rotating one with either secret', () => {
    expect(file.vectors.length).toBeGreaterThanOrEqual(7);
    for (const v of file.vectors) {
      const event = constructEvent(v.body, headersFor(v), v.secret, at(v));
      expect(event.webhookId).toBe(v.msg_id);
      expect(event.api_version).toBe('v1');
      if (v.previous_secret) {
        expect(constructEvent(v.body, headersFor(v), v.previous_secret, at(v)).id).toBe(event.id);
      }
    }
  });

  it('verifies a Buffer byte for byte', () => {
    const v = byName('bank.credit');
    expect(constructEvent(Buffer.from(v.body, 'utf8'), headersFor(v), v.secret, at(v)).type).toBe(
      'bank.credit',
    );
  });

  it('matches the Standard Webhooks reference signature', () => {
    const v = file.standard_webhooks_reference;
    expect(verifySignature(v.body, headersFor(v), v.secret, at(v)).webhookId).toBe(v.msg_id);
  });

  it('TestLegacySecretVerifies: a base64url secret decodes to the same key', () => {
    const v = byName('bank.credit.legacy_urlsafe_secret');
    expect(v.secret).toMatch(/[-_]/);
    expect(decodeSecret(v.secret)).toHaveLength(32);
    expect(constructEvent(v.body, headersFor(v), v.secret, at(v)).type).toBe('bank.credit');
  });

  it('TestFlowOutputNarrowsToItsOwnType', () => {
    const v = byName('flow.output');
    const event = constructEvent(v.body, headersFor(v), v.secret, at(v));
    expect(isWebhookEvent(event, 'bank.credit')).toBe(false);
    if (!isWebhookEvent(event, 'flow.output')) throw new Error('flow.output did not narrow');
    expect(event.trigger.type).toBe('bank.credit');
    expect(event.data).toEqual({ order: 'DH1245', paid: true });
  });

  it('TestUnknownTypeParsesAsUnknownEnvelope', () => {
    const v = byName('unknown.future_event');
    const event = constructEvent(v.body, headersFor(v), v.secret, at(v));
    expect(event.type).toBe('bank.future_event');
    expect((WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.type)).toBe(false);
    expect(event.data).toEqual({ note: 'receivers must accept unknown types: A & B <tag> > end' });
  });

  it('keeps the exact digits above 2^53 in the signed body (JSON.parse rounds them: documented)', () => {
    const v = byName('bank.credit.amount_above_2_pow_53');
    expect(v.body).toContain('"amount":9007199254740993');
    const event = constructEvent(v.body, headersFor(v), v.secret, at(v));
    if (!isWebhookEvent(event, 'bank.credit')) throw new Error('not bank.credit');
    expect(Number.isSafeInteger(event.data.amount)).toBe(false);
  });

  it('types a calendar-date quota period as data, not an instant', () => {
    const v = byName('org.quota_exceeded');
    const event = constructEvent(v.body, headersFor(v), v.secret, at(v));
    if (!isWebhookEvent(event, 'org.quota_exceeded')) throw new Error('not org.quota_exceeded');
    expect(event.data.period_end_exclusive).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('verification failures', () => {
  const v = byName('bank.credit');

  it('TestToleranceIsSymmetric', () => {
    const ts = Number(v.timestamp);
    for (const now of [ts - 300, ts + 300]) {
      expect(() => constructEvent(v.body, headersFor(v), v.secret, { now })).not.toThrow();
    }
    for (const now of [ts - 301, ts + 301]) {
      expect(() => constructEvent(v.body, headersFor(v), v.secret, { now })).toThrow(
        SignatureVerificationError,
      );
    }
  });

  it('binds the body, the id and the timestamp', () => {
    expect(() => constructEvent(`${v.body} `, headersFor(v), v.secret, at(v))).toThrow(
      'webhook signature mismatch',
    );
    expect(() =>
      constructEvent(v.body, { ...headersFor(v), 'webhook-id': 'other' }, v.secret, at(v)),
    ).toThrow('webhook signature mismatch');
    expect(() =>
      constructEvent(
        v.body,
        { ...headersFor(v), 'webhook-timestamp': String(Number(v.timestamp) + 1) },
        v.secret,
        {
          now: Number(v.timestamp),
        },
      ),
    ).toThrow('webhook signature mismatch');
  });

  it('ignores signature entries that are not v1', () => {
    const header = {
      ...headersFor(v),
      'webhook-signature': v.signature_header.replace(/^v1,/, 'v2,'),
    };
    expect(() => constructEvent(v.body, header, v.secret, at(v))).toThrow(
      'webhook signature mismatch',
    );
  });

  it('rejects missing headers, an empty secret and a body that is not an envelope', () => {
    const { ['webhook-id']: _omit, ...noId } = headersFor(v);
    expect(() => constructEvent(v.body, noId, v.secret, at(v))).toThrow(
      'missing webhook-id header',
    );
    expect(() => constructEvent(v.body, headersFor(v), '', at(v))).toThrow(
      SignatureVerificationError,
    );
    const ref = file.standard_webhooks_reference;
    expect(() => constructEvent(ref.body, headersFor(ref), ref.secret, at(ref))).toThrow(
      'signed payload is not a webhook envelope',
    );
  });

  it('reads headers case-insensitively and from a Headers object', () => {
    const upper = Object.fromEntries(
      Object.entries(headersFor(v)).map(([k, val]) => [k.toUpperCase(), val]),
    );
    expect(constructEvent(v.body, upper, v.secret, at(v)).webhookId).toBe(v.msg_id);
    expect(constructEvent(v.body, new Headers(headersFor(v)), v.secret, at(v)).webhookId).toBe(
      v.msg_id,
    );
  });
});

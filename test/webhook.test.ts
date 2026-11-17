import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SignatureVerificationError } from '../src/errors.js';
import { constructEvent, decodeSecret, verifySignature } from '../src/webhook.js';
import { isWebhookEvent, WEBHOOK_EVENT_TYPES } from '../src/webhook-events.js';

interface Vector {
  name: string;
  note: string;
  secret: string;
  previous_secret?: string;
  must_ignore?: boolean;
  msg_id: string;
  timestamp: string;
  body: string;
  signature_header: string;
}

const file = JSON.parse(
  readFileSync(new URL('./fixtures/webhook_vectors_v2.json', import.meta.url), 'utf8'),
) as { tolerance_seconds: number; standard_webhooks_reference: Vector; vectors: Vector[] };

function byName(name: string): Vector {
  const v = file.vectors.find((x) => x.name === name);
  if (!v) throw new Error(`vector ${name} missing from the KIT-RS fixture`);
  return v;
}

const headersFor = (v: Vector): Record<string, string> => ({
  'webhook-id': v.msg_id,
  'webhook-timestamp': v.timestamp,
  'webhook-signature': v.signature_header,
});
const at = (v: Vector) => ({ now: Number(v.timestamp) });
const eventOf = (v: Vector) => constructEvent(v.body, headersFor(v), v.secret, at(v));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mustIgnore = file.vectors.filter((v) => v.must_ignore === true);

describe('golden vectors from KIT-RS', () => {
  it('verifies every vector, and a rotating one with either secret', () => {
    expect(file.vectors).toHaveLength(9);
    expect(file.vectors.filter((v) => v.previous_secret)).not.toHaveLength(0);
    for (const v of file.vectors) {
      const event = eventOf(v);
      expect(event.webhookId).toBe(v.msg_id);
      expect(event.api_version).toBe('2');
      if (v.previous_secret) {
        expect(constructEvent(v.body, headersFor(v), v.previous_secret, at(v)).id).toBe(event.id);
      }
    }
  });

  it('verifies a Buffer byte for byte', () => {
    const v = byName('banking.credit');
    expect(constructEvent(Buffer.from(v.body, 'utf8'), headersFor(v), v.secret, at(v)).type).toBe(
      'banking.credit',
    );
  });

  it('matches the Standard Webhooks reference signature', () => {
    const v = file.standard_webhooks_reference;
    expect(verifySignature(v.body, headersFor(v), v.secret, at(v)).webhookId).toBe(v.msg_id);
  });

  it('a base64url secret decodes to the same key', () => {
    const v = byName('banking.credit');
    const key = decodeSecret(v.secret);
    const urlSafe = `whsec_${key.toString('base64url')}`;
    expect(urlSafe).not.toContain('=');
    expect(decodeSecret(urlSafe).equals(key)).toBe(true);
    expect(constructEvent(v.body, headersFor(v), urlSafe, at(v)).webhookId).toBe(v.msg_id);
  });

  it('narrows banking.credit and reads amount_vnd', () => {
    const event = eventOf(byName('banking.credit'));
    if (!isWebhookEvent(event, 'banking.credit')) throw new Error('banking.credit did not narrow');
    expect(typeof event.data.amount_vnd).toBe('number');
    expect(event.data.transaction_id).toMatch(/^btx_/);
    expect(event.org_id).toMatch(UUID);
  });

  it('marks exactly banking.payment_matched, flow.output and connector.test must_ignore', () => {
    expect(mustIgnore.map((v) => v.name).sort()).toEqual([
      'banking.payment_matched',
      'connector.test',
      'flow.output',
    ]);
  });

  it.each(mustIgnore.map((v) => [v.name, v] as const))(
    'never narrows a must_ignore vector to banking.credit: %s',
    (_name, v) => {
      const event = eventOf(v);
      expect(event.webhookId).toBe(v.msg_id);
      expect(isWebhookEvent(event, 'banking.credit')).toBe(false);
    },
  );

  it('narrows flow.output to its own type with a FlowOutputTrigger', () => {
    const event = eventOf(byName('flow.output'));
    if (!isWebhookEvent(event, 'flow.output')) throw new Error('flow.output did not narrow');
    expect(event.trigger.type).toBe('banking.credit');
    expect('amount_vnd' in event.data).toBe(true);
  });

  it('parses an unknown type as an UnknownWebhookEnvelope', () => {
    const event = eventOf(byName('unknown.future_event'));
    expect(event.type).toBe('banking.future_event');
    expect((WEBHOOK_EVENT_TYPES as readonly string[]).includes(event.type)).toBe(false);
    expect(event.data).toEqual({ note: 'receivers must accept unknown types: A & B <tag> > end' });
  });

  it('keeps the exact digits above 2^53 in the signed body (JSON.parse rounds them: documented)', () => {
    const v = byName('banking.credit.amount_above_2_pow_53');
    expect(v.body).toContain('"amount_vnd":9007199254740993');
    const event = eventOf(v);
    if (!isWebhookEvent(event, 'banking.credit')) throw new Error('not banking.credit');
    expect(Number.isSafeInteger(event.data.amount_vnd)).toBe(false);
  });

  it('types a calendar-date quota period as data, not an instant', () => {
    const event = eventOf(byName('quota.exceeded'));
    if (!isWebhookEvent(event, 'quota.exceeded')) throw new Error('not quota.exceeded');
    expect(event.data.period_end_exclusive).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('verification failures', () => {
  const v = byName('banking.credit');

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

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignatureVerificationError } from '../src/errors.js';
import { constructEvent } from '../src/webhook.js';

interface Vector {
  secret: string;
  delivery_id: string;
  timestamp: string;
  body: string;
  signature_header: string;
}

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/webhook_vectors.json', import.meta.url), 'utf8'),
) as Vector[];

const SECRET = 'whsec_test';

function sign(deliveryId: string, timestamp: string, body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${deliveryId}.${timestamp}.${body}`).digest('hex')}`;
}

function headersFor(deliveryId: string, timestamp: string, signature: string) {
  return {
    'X-Webhook-Delivery-Id': deliveryId,
    'X-Webhook-Timestamp': timestamp,
    'X-Webhook-Signature': signature,
    'X-Webhook-Event': 'attacker.controlled',
  };
}

describe('constructEvent — golden vectors from the server', () => {
  it('verifies every vector produced by the Go signer', () => {
    expect(vectors.length).toBeGreaterThan(2);
    for (const v of vectors) {
      const event = constructEvent(
        v.body,
        headersFor(v.delivery_id, v.timestamp, v.signature_header),
        v.secret,
        { now: Number(v.timestamp) },
      );
      expect(event.deliveryId).toBe(v.delivery_id);
      expect(event.timestamp).toBe(Number(v.timestamp));
      expect(event.type).toBe((JSON.parse(v.body) as { event: string }).event);
    }
  });

  it('verifies a vector passed as a Buffer, byte for byte', () => {
    const v = vectors[0]!;
    const event = constructEvent(
      Buffer.from(v.body, 'utf8'),
      headersFor(v.delivery_id, v.timestamp, v.signature_header),
      v.secret,
      { now: Number(v.timestamp) },
    );
    expect(event.deliveryId).toBe(v.delivery_id);
  });
});

describe('constructEvent — happy path', () => {
  const body = JSON.stringify({ event: 'bank.credit', data: { amount: 150000 } });
  const ts = '1735689600';
  const id = 'dlv_1';

  it('returns the verified event', () => {
    const event = constructEvent(body, headersFor(id, ts, sign(id, ts, body)), SECRET, {
      now: Number(ts),
    });
    expect(event).toEqual({
      type: 'bank.credit',
      deliveryId: id,
      timestamp: 1735689600,
      data: { amount: 150000 },
    });
  });

  it('ignores X-Webhook-Event and takes the type from the signed body', () => {
    const event = constructEvent(body, headersFor(id, ts, sign(id, ts, body)), SECRET, {
      now: Number(ts),
    });
    expect(event.type).toBe('bank.credit');
  });

  it('looks headers up case-insensitively', () => {
    const event = constructEvent(
      body,
      {
        'x-webhook-delivery-id': id,
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sign(id, ts, body),
      },
      SECRET,
      { now: Number(ts) },
    );
    expect(event.type).toBe('bank.credit');
  });

  it('accepts a fetch Headers instance', () => {
    const headers = new Headers({
      'X-Webhook-Delivery-Id': id,
      'X-Webhook-Timestamp': ts,
      'X-Webhook-Signature': sign(id, ts, body),
    });
    expect(constructEvent(body, headers, SECRET, { now: Number(ts) }).type).toBe('bank.credit');
  });

  it('takes the first value of a repeated node header', () => {
    const event = constructEvent(
      body,
      {
        'x-webhook-delivery-id': [id, 'dlv_other'],
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sign(id, ts, body),
      },
      SECRET,
      { now: Number(ts) },
    );
    expect(event.deliveryId).toBe(id);
  });

  it('defaults data to an empty object when the body has none', () => {
    const noData = JSON.stringify({ event: 'org.created' });
    const event = constructEvent(noData, headersFor(id, ts, sign(id, ts, noData)), SECRET, {
      now: Number(ts),
    });
    expect(event.data).toEqual({});
  });
});

describe('constructEvent — rejections', () => {
  const body = JSON.stringify({ event: 'bank.credit', data: {} });
  const ts = '1735689600';
  const id = 'dlv_1';
  const good = sign(id, ts, body);

  it('rejects an empty secret', () => {
    expect(() => constructEvent(body, headersFor(id, ts, good), '')).toThrow(
      SignatureVerificationError,
    );
  });

  it.each(['x-webhook-delivery-id', 'x-webhook-timestamp', 'x-webhook-signature'])(
    'rejects a missing %s header',
    (missing) => {
      const headers: Record<string, string> = {
        'x-webhook-delivery-id': id,
        'x-webhook-timestamp': ts,
        'x-webhook-signature': good,
      };
      delete headers[missing];
      expect(() => constructEvent(body, headers, SECRET, { now: Number(ts) })).toThrow(
        SignatureVerificationError,
      );
    },
  );

  it('rejects a signature without the sha256= prefix', () => {
    expect(() =>
      constructEvent(body, headersFor(id, ts, good.slice(7)), SECRET, { now: Number(ts) }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a tampered body', () => {
    const tampered = JSON.stringify({ event: 'bank.credit', data: { amount: 999 } });
    expect(() =>
      constructEvent(tampered, headersFor(id, ts, good), SECRET, { now: Number(ts) }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a signature made with a different secret', () => {
    expect(() =>
      constructEvent(body, headersFor(id, ts, sign(id, ts, body, 'whsec_other')), SECRET, {
        now: Number(ts),
      }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a signature of the wrong length without throwing RangeError', () => {
    expect(() =>
      constructEvent(body, headersFor(id, ts, 'sha256=abc'), SECRET, { now: Number(ts) }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a timestamp outside the tolerance, in both directions', () => {
    const headers = headersFor(id, ts, good);
    expect(() => constructEvent(body, headers, SECRET, { now: Number(ts) + 301 })).toThrow(
      SignatureVerificationError,
    );
    expect(() => constructEvent(body, headers, SECRET, { now: Number(ts) - 301 })).toThrow(
      SignatureVerificationError,
    );
  });

  it('accepts a timestamp exactly at the tolerance edge', () => {
    const headers = headersFor(id, ts, good);
    expect(constructEvent(body, headers, SECRET, { now: Number(ts) + 300 }).type).toBe(
      'bank.credit',
    );
  });

  it('honours a custom tolerance', () => {
    const headers = headersFor(id, ts, good);
    expect(() =>
      constructEvent(body, headers, SECRET, { now: Number(ts) + 60, tolerance: 30 }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a correctly signed body that carries no event type', () => {
    const noEvent = JSON.stringify({ data: { amount: 1 } });
    expect(() =>
      constructEvent(noEvent, headersFor(id, ts, sign(id, ts, noEvent)), SECRET, {
        now: Number(ts),
      }),
    ).toThrow(SignatureVerificationError);
  });

  it('rejects a correctly signed body that is not JSON', () => {
    const notJson = 'not json at all';
    expect(() =>
      constructEvent(notJson, headersFor(id, ts, sign(id, ts, notJson)), SECRET, {
        now: Number(ts),
      }),
    ).toThrow(SignatureVerificationError);
  });

  it('checks the signature before the timestamp', () => {
    // A stale delivery with a bad signature must fail on the signature, so a
    // caller cannot distinguish "bad secret" from "expired" by the message.
    expect(() =>
      constructEvent(body, headersFor(id, ts, sign(id, ts, 'other')), SECRET, {
        now: Number(ts) + 10_000,
      }),
    ).toThrow(/signature mismatch/);
  });
});

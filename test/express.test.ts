import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { bankapiWebhook, type WebhookRequest } from '../src/express.js';

const SECRET = 'whsec_test';
const TS = '1735689600';
const ID = 'dlv_1';
const BODY = JSON.stringify({ event: 'bank.credit', data: { amount: 150000 } });

function sign(body: string, timestamp = TS): string {
  return `sha256=${createHmac('sha256', SECRET).update(`${ID}.${timestamp}.${body}`).digest('hex')}`;
}

function makeReq(
  body: string | Buffer | undefined,
  headers: Record<string, string>,
  preParsed?: unknown,
): WebhookRequest {
  const stream =
    body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body as string)]);
  return Object.assign(stream, {
    method: 'POST',
    headers,
    body: preParsed,
  }) as unknown as WebhookRequest;
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    ended: '' as string,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      this.ended = chunk ?? '';
    },
  };
  return res as unknown as typeof res & Parameters<ReturnType<typeof bankapiWebhook>>[1];
}

function goodHeaders(body = BODY, timestamp = TS) {
  return {
    'x-webhook-delivery-id': ID,
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': sign(body, timestamp),
  };
}

/** Runs the middleware and resolves once next() or res.end() has happened. */
async function run(
  req: WebhookRequest,
  res: ReturnType<typeof makeRes>,
  options: Parameters<typeof bankapiWebhook>[0],
) {
  const next = vi.fn();
  const middleware = bankapiWebhook(options);
  await new Promise<void>((resolve) => {
    const originalEnd = res.end.bind(res);
    (res.end as any) = (chunk?: string) => {
      originalEnd(chunk);
      resolve();
    };
    next.mockImplementation(() => resolve());
    middleware(req, res, next);
  });
  return next;
}

const now = () => Number(TS);

describe('bankapiWebhook — accepted deliveries', () => {
  it('verifies a streamed body and attaches the event', async () => {
    const req = makeReq(BODY, goodHeaders());
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now });
    expect(next).toHaveBeenCalledWith();
    expect(req.bankapiEvent).toEqual({
      type: 'bank.credit',
      deliveryId: ID,
      timestamp: Number(TS),
      data: { amount: 150000 },
    });
  });

  it('reuses a Buffer body that an earlier express.raw() already captured', async () => {
    const req = makeReq(undefined, goodHeaders(), Buffer.from(BODY));
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now });
    expect(next).toHaveBeenCalledWith();
    expect(req.bankapiEvent?.type).toBe('bank.credit');
  });

  it('reuses a string body', async () => {
    const req = makeReq(undefined, goodHeaders(), BODY);
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('bankapiWebhook — rejected deliveries', () => {
  it('answers 400 and never calls next when the signature is wrong', async () => {
    const req = makeReq(BODY, { ...goodHeaders(), 'x-webhook-signature': 'sha256=deadbeef' });
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(req.bankapiEvent).toBeUndefined();
  });

  it('answers 400 when the timestamp is outside the tolerance', async () => {
    const req = makeReq(BODY, goodHeaders());
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now: () => Number(TS) + 3600 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('answers 400 when a required header is missing', async () => {
    const headers = goodHeaders();
    delete (headers as Record<string, string>)['x-webhook-timestamp'];
    const req = makeReq(BODY, headers);
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });

  it('does not leak why verification failed', async () => {
    const req = makeReq(BODY, { ...goodHeaders(), 'x-webhook-signature': 'sha256=deadbeef' });
    const res = makeRes();
    await run(req, res, { secret: SECRET, now });
    expect(res.ended).not.toContain('mismatch');
    expect(res.ended).not.toContain(SECRET);
  });

  it('answers 413 and stops when the body exceeds the cap', async () => {
    const big = 'x'.repeat(2048);
    const req = makeReq(big, goodHeaders(big));
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now, maxBodyBytes: 1024 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(413);
  });

  it('honours a custom tolerance', async () => {
    const req = makeReq(BODY, goodHeaders());
    const res = makeRes();
    const next = await run(req, res, { secret: SECRET, now: () => Number(TS) + 60, tolerance: 30 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
  });
});

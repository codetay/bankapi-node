import type { IncomingMessage, ServerResponse } from 'node:http';
import { SignatureVerificationError } from './errors.js';
import { constructEvent, type WebhookEvent } from './webhook.js';

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export interface WebhookMiddlewareOptions {
  /** The endpoint's whsec_ secret. */
  secret: string;
  /** Max |now - timestamp| in seconds. Default 300. */
  tolerance?: number;
  /** Cap on a self-buffered body. Default 1 MiB. */
  maxBodyBytes?: number;
  /** Overrides the current Unix time in seconds; for tests. */
  now?: () => number;
}

export type WebhookRequest = IncomingMessage & {
  body?: unknown;
  bankapiEvent?: WebhookEvent;
};

declare global {
  namespace Express {
    interface Request {
      bankapiEvent?: WebhookEvent;
    }
  }
}

class PayloadTooLargeError extends Error {}

/**
 * Verifies the BankAPI webhook signature before the route handler runs.
 * A verified event is attached as `req.bankapiEvent`; anything unverified is
 * answered with 400 and never reaches the handler.
 *
 * The raw body is read here when no earlier middleware captured it, so this
 * works with or without `express.raw()` mounted and needs no express types at
 * runtime.
 */
export function bankapiWebhook(options: WebhookMiddlewareOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return (req: WebhookRequest, res: ServerResponse, next: (err?: unknown) => void): void => {
    void (async () => {
      let raw: Buffer;
      try {
        raw = await rawBody(req, maxBodyBytes);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          respond(res, 413, 'webhook payload too large');
          return;
        }
        next(error);
        return;
      }

      try {
        req.bankapiEvent = constructEvent(raw, req.headers, options.secret, {
          tolerance: options.tolerance,
          now: options.now?.(),
        });
      } catch (error) {
        if (error instanceof SignatureVerificationError) {
          // The reason is deliberately not echoed back: a caller must not be
          // able to tell a wrong secret from a stale timestamp.
          respond(res, 400, 'webhook signature verification failed');
          return;
        }
        next(error);
        return;
      }

      next();
    })();
  };
}

async function rawBody(req: WebhookRequest, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > maxBytes) {
      req.destroy();
      throw new PayloadTooLargeError('webhook payload too large');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function respond(res: ServerResponse, status: number, error: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error }));
}

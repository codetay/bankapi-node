import { Page } from '../page.js';
import {
  type BankingSummary,
  type Connection,
  type ConnectionsSummary,
  type PaymentIntent,
  type Transaction,
  toBankingSummary,
  toConnection,
  toConnectionsSummary,
  toPaymentIntent,
  toTransaction,
} from '../resources/index.js';
import type { QueryValue, Transport } from '../transport.js';
import { items, nextCursor } from './list.js';

export interface SummaryOptions {
  days?: number;
}

export interface ConnectionListOptions {
  limit?: number;
  cursor?: string;
  q?: string;
}

export interface TransactionListOptions {
  limit?: number;
  cursor?: string;
  direction?: string;
  connectionId?: string;
  from?: string;
  to?: string;
  q?: string;
  matchStatus?: string;
}

export interface PaymentIntentListOptions {
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface CreatePaymentIntentInput {
  code: string;
  /** Whole VND. */
  expectedAmountVnd: number;
  /** Intent TTL in seconds; omit for the server default. */
  expiresInSecs?: number;
}

export interface CreatePaymentIntentOptions {
  /** Defaults to a generated crypto.randomUUID() when omitted. */
  idempotencyKey?: string;
}

export class BankingService {
  constructor(private readonly transport: Transport) {}

  async summary(options: SummaryOptions = {}): Promise<BankingSummary> {
    return toBankingSummary(
      await this.transport.request('GET', '/bank-transactions/summary', { days: options.days }),
    );
  }

  async connections(options: ConnectionListOptions = {}): Promise<Page<Connection>> {
    const data = await this.transport.request('GET', '/bank-connections', {
      limit: options.limit,
      cursor: options.cursor,
      q: options.q,
    });

    return new Page(items(data).map(toConnection), nextCursor(data), (cursor) =>
      this.connections({ ...options, cursor }),
    );
  }

  async connectionsSummary(options: SummaryOptions = {}): Promise<ConnectionsSummary> {
    return toConnectionsSummary(
      await this.transport.request('GET', '/bank-connections/summary', { days: options.days }),
    );
  }

  async connection(connId: string): Promise<Connection> {
    return toConnection(
      await this.transport.request('GET', `/bank-connections/${encodeURIComponent(connId)}`),
    );
  }

  async transactions(options: TransactionListOptions = {}): Promise<Page<Transaction>> {
    const query: Record<string, QueryValue> = {
      limit: options.limit,
      direction: options.direction,
      connection_id: options.connectionId,
      from: options.from,
      to: options.to,
      q: options.q,
      match_status: options.matchStatus,
      cursor: options.cursor,
    };
    const data = await this.transport.request('GET', '/bank-transactions', query);

    return new Page(items(data).map(toTransaction), nextCursor(data), (cursor) =>
      this.transactions({ ...options, cursor }),
    );
  }

  async transaction(txId: string): Promise<Transaction> {
    return toTransaction(
      await this.transport.request('GET', `/bank-transactions/${encodeURIComponent(txId)}`),
    );
  }

  async matchTransaction(txId: string, intentId: string): Promise<Transaction> {
    return toTransaction(
      await this.transport.request(
        'POST',
        `/bank-transactions/${encodeURIComponent(txId)}/match`,
        {},
        { intent_id: intentId },
      ),
    );
  }

  async paymentIntents(options: PaymentIntentListOptions = {}): Promise<Page<PaymentIntent>> {
    const data = await this.transport.request('GET', '/payment-intents', {
      status: options.status,
      limit: options.limit,
      cursor: options.cursor,
    });

    return new Page(items(data).map(toPaymentIntent), nextCursor(data), (cursor) =>
      this.paymentIntents({ ...options, cursor }),
    );
  }

  /** x-idempotent: retried with the same key, this replays the first response. */
  async createPaymentIntent(
    input: CreatePaymentIntentInput,
    options: CreatePaymentIntentOptions = {},
  ): Promise<PaymentIntent> {
    const body: Record<string, unknown> = {
      code: input.code,
      expected_amount_vnd: input.expectedAmountVnd,
    };
    if (input.expiresInSecs !== undefined) body.expires_in_secs = input.expiresInSecs;

    return toPaymentIntent(
      await this.transport.request('POST', '/payment-intents', {}, body, {
        idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      }),
    );
  }

  async paymentIntent(intentId: string): Promise<PaymentIntent> {
    return toPaymentIntent(
      await this.transport.request('GET', `/payment-intents/${encodeURIComponent(intentId)}`),
    );
  }
}

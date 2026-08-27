import { Page } from '../page.js';
import {
  type BankingSummary,
  type Connection,
  type ConnectionsSummary,
  type PaymentIntent,
  type Transaction,
  type TransactionDetail,
  toBankingSummary,
  toConnection,
  toConnectionsSummary,
  toPaymentIntent,
  toTransaction,
  toTransactionDetail,
} from '../resources/index.js';
import type { QueryValue, Transport } from '../transport.js';
import { items, nextCursor } from './list.js';

export interface SummaryOptions {
  days?: number;
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

export class BankingService {
  constructor(private readonly transport: Transport) {}

  async summary(options: SummaryOptions = {}): Promise<BankingSummary> {
    return toBankingSummary(
      await this.transport.request('GET', '/banking/summary', { days: options.days }),
    );
  }

  /** GET /banking/connections is a plain list, not a cursor page. */
  async connections(): Promise<Connection[]> {
    const data = await this.transport.request('GET', '/banking/connections');
    return items(data).map(toConnection);
  }

  async connectionsSummary(options: SummaryOptions = {}): Promise<ConnectionsSummary> {
    return toConnectionsSummary(
      await this.transport.request('GET', '/banking/connections/summary', { days: options.days }),
    );
  }

  async connection(connId: string): Promise<Connection> {
    return toConnection(
      await this.transport.request('GET', `/banking/connections/${encodeURIComponent(connId)}`),
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
    const data = await this.transport.request('GET', '/banking/transactions', query);

    return new Page(items(data).map(toTransaction), nextCursor(data), (cursor) =>
      this.transactions({ ...options, cursor }),
    );
  }

  async transaction(txId: string): Promise<TransactionDetail> {
    return toTransactionDetail(
      await this.transport.request('GET', `/banking/transactions/${encodeURIComponent(txId)}`),
    );
  }

  async matchTransaction(txId: string, intentId: string): Promise<TransactionDetail> {
    return toTransactionDetail(
      await this.transport.request(
        'POST',
        `/banking/transactions/${encodeURIComponent(txId)}/match`,
        {},
        { intent_id: intentId },
      ),
    );
  }

  async paymentIntents(options: PaymentIntentListOptions = {}): Promise<Page<PaymentIntent>> {
    const data = await this.transport.request('GET', '/banking/payment-intents', {
      status: options.status,
      limit: options.limit,
      cursor: options.cursor,
    });

    return new Page(items(data).map(toPaymentIntent), nextCursor(data), (cursor) =>
      this.paymentIntents({ ...options, cursor }),
    );
  }
}

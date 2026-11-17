import { Page } from '../page.js';
import {
  type CreatedEndpoint,
  type Delivery,
  type RotatedSecret,
  type WebhookEndpoint,
  toCreatedEndpoint,
  toDelivery,
  toRotatedSecret,
  toWebhookEndpoint,
} from '../resources/index.js';
import type { Transport } from '../transport.js';
import { items, nextCursor } from './list.js';

export interface EndpointListOptions {
  limit?: number;
  cursor?: string;
}

/** Webhook endpoints are the `webhook` connectors of /v2/connectors. */
export class WebhookEndpointService {
  constructor(private readonly transport: Transport) {}

  /**
   * Not idempotent: after a timeout, call all() before creating again.
   * The returned secret is shown only here — store it before it is lost.
   */
  async create(url: string, eventTypes: string[], description = ''): Promise<CreatedEndpoint> {
    return toCreatedEndpoint(
      await this.transport.request(
        'POST',
        '/connectors',
        {},
        { type: 'webhook', config: { url }, event_types: eventTypes, description },
      ),
    );
  }

  async all(options: EndpointListOptions = {}): Promise<Page<WebhookEndpoint>> {
    const data = await this.transport.request('GET', '/connectors', {
      type: 'webhook',
      limit: options.limit,
      cursor: options.cursor,
    });

    return new Page(items(data).map(toWebhookEndpoint), nextCursor(data), (cursor) =>
      this.all({ ...options, cursor }),
    );
  }

  async get(id: string): Promise<WebhookEndpoint> {
    return toWebhookEndpoint(
      await this.transport.request('GET', `/connectors/${encodeURIComponent(id)}`),
    );
  }

  async delete(id: string): Promise<void> {
    await this.transport.request('DELETE', `/connectors/${encodeURIComponent(id)}`);
  }

  /** Switching on or off ends a pause and starts the failure count again. */
  async enable(id: string): Promise<void> {
    await this.setActive(id, true);
  }

  /** Switching on or off ends a pause and starts the failure count again. */
  async disable(id: string): Promise<void> {
    await this.setActive(id, false);
  }

  /** The new secret is shown only here; the previous one verifies until `previousExpiresAt`. */
  async rotateSecret(id: string): Promise<RotatedSecret> {
    return toRotatedSecret(
      await this.transport.request('POST', `/connectors/${encodeURIComponent(id)}/rotate-secret`),
    );
  }

  async deliveries(id: string, options: EndpointListOptions = {}): Promise<Page<Delivery>> {
    const data = await this.transport.request(
      'GET',
      `/connectors/${encodeURIComponent(id)}/deliveries`,
      { limit: options.limit, cursor: options.cursor },
    );

    return new Page(items(data).map(toDelivery), nextCursor(data), (cursor) =>
      this.deliveries(id, { ...options, cursor }),
    );
  }

  private async setActive(id: string, active: boolean): Promise<void> {
    await this.transport.request('PATCH', `/connectors/${encodeURIComponent(id)}`, {}, { active });
  }
}

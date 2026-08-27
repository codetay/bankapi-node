import { Page } from '../page.js';
import {
  type CreatedEndpoint,
  type Delivery,
  type WebhookEndpoint,
  toCreatedEndpoint,
  toDelivery,
  toWebhookEndpoint,
} from '../resources/index.js';
import type { Transport } from '../transport.js';
import { items, nextCursor } from './list.js';

export interface EndpointListOptions {
  limit?: number;
  cursor?: string;
}

export class WebhookEndpointService {
  constructor(private readonly transport: Transport) {}

  /** The returned secret is shown only here — store it before it is lost. */
  async create(url: string, eventTypes: string[], description = ''): Promise<CreatedEndpoint> {
    return toCreatedEndpoint(
      await this.transport.request(
        'POST',
        '/webhooks',
        {},
        { url, event_types: eventTypes, description },
      ),
    );
  }

  async all(options: EndpointListOptions = {}): Promise<Page<WebhookEndpoint>> {
    const data = await this.transport.request('GET', '/webhooks', {
      limit: options.limit,
      cursor: options.cursor,
    });

    return new Page(items(data).map(toWebhookEndpoint), nextCursor(data), (cursor) =>
      this.all({ ...options, cursor }),
    );
  }

  async get(id: string): Promise<WebhookEndpoint> {
    return toWebhookEndpoint(
      await this.transport.request('GET', `/webhooks/${encodeURIComponent(id)}`),
    );
  }

  async delete(id: string): Promise<void> {
    await this.transport.request('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }

  async enable(id: string): Promise<void> {
    await this.transport.request('POST', `/webhooks/${encodeURIComponent(id)}/enable`);
  }

  async deliveries(id: string, options: EndpointListOptions = {}): Promise<Page<Delivery>> {
    const data = await this.transport.request(
      'GET',
      `/webhooks/${encodeURIComponent(id)}/deliveries`,
      { limit: options.limit, cursor: options.cursor },
    );

    return new Page(items(data).map(toDelivery), nextCursor(data), (cursor) =>
      this.deliveries(id, { ...options, cursor }),
    );
  }
}

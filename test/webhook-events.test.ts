import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENT_TYPES } from '../src/webhook-events.js';

const source = readFileSync(new URL('../src/webhook-events.ts', import.meta.url), 'utf8');

describe('generated webhook events', () => {
  it('stamps api_version 2 on the envelope', () => {
    expect(source).toContain("api_version: '2';");
  });

  it('types the flow.output trigger as FlowOutputTrigger', () => {
    expect(source).toContain('export interface FlowOutputTrigger');
    expect(source).toContain('trigger: FlowOutputTrigger;');
    expect(source).not.toContain('FlowTrigger ');
    expect(source).not.toContain('FlowTrigger;');
  });

  it('renders OpenAPI 3.1 nullable types as T | null', () => {
    expect(source).toContain('period_start?: string | null;');
    expect(source).toContain('period_end?: string | null;');
  });

  it('lists the 13 v2 event types', () => {
    expect([...WEBHOOK_EVENT_TYPES]).toEqual([
      'banking.credit',
      'banking.debit',
      'banking.payment_matched',
      'connector.test',
      'flow.output',
      'organization.created',
      'organization.member_invited',
      'quota.exceeded',
      'subscription.activated',
      'subscription.cancelled',
      'subscription.expired',
      'subscription.past_due',
      'subscription.renewed',
    ]);
    expect(WEBHOOK_EVENT_TYPES).toContain('banking.credit');
    expect(WEBHOOK_EVENT_TYPES).not.toContain('bank.credit');
  });
});

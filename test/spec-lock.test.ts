import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Lock {
  gokit_ref: string;
  sha256: string;
}

interface Spec {
  info: { title: string };
  servers: Array<{ url: string }>;
  'x-error-code-registry': unknown[];
}

const lock = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.lock.json', import.meta.url), 'utf8'),
) as Lock;
const fixtureRaw = readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8');
const spec = JSON.parse(fixtureRaw) as Spec;

describe('openapi spec lock', () => {
  it('has a well-formed GO-KIT ref and fixture hash', () => {
    expect(lock.gokit_ref).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the fixture it locks', () => {
    expect(createHash('sha256').update(fixtureRaw).digest('hex')).toBe(lock.sha256);
  });

  it('pins the frozen BankAPI contract', () => {
    expect(spec.info.title).toBe('BankAPI');
    expect(spec.servers[0]?.url.endsWith('/v1')).toBe(true);
    expect(spec['x-error-code-registry']).toHaveLength(56);
  });
});

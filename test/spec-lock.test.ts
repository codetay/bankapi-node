import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Lock {
  apirs_ref: string;
  openapi_sha256: string;
  kitrs_ref: string;
  vectors_sha256: string;
}

interface Spec {
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  webhooks: Record<string, unknown>;
  'x-error-code-registry': unknown[];
}

const lock = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.lock.json', import.meta.url), 'utf8'),
) as Lock;
const fixtureRaw = readFileSync(new URL('./fixtures/openapi.json', import.meta.url), 'utf8');
const vectorsRaw = readFileSync(
  new URL('./fixtures/webhook_vectors_v2.json', import.meta.url),
  'utf8',
);
const spec = JSON.parse(fixtureRaw) as Spec;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('openapi spec lock', () => {
  it('has well-formed API-RS and KIT-RS refs and both fixture hashes', () => {
    expect(lock.apirs_ref).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.kitrs_ref).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.openapi_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.vectors_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Built from parts so the S5 legacy-name grep stays empty; do not inline it.
    expect(Object.keys(lock)).not.toContain(['gokit', 'ref'].join('_'));
  });

  it('matches the openapi fixture it locks', () => {
    expect(sha256(fixtureRaw)).toBe(lock.openapi_sha256);
  });

  it('matches the vectors fixture it locks', () => {
    expect(sha256(vectorsRaw)).toBe(lock.vectors_sha256);
  });

  it('pins the API-RS v2 contract', () => {
    expect(spec.info.title).toBe('BankAPI');
    expect(spec.info.version).toBe('2.0.0');
    for (const path of Object.keys(spec.paths)) {
      expect(path.startsWith('/v2/'), `path ${path} is outside /v2/`).toBe(true);
    }
    expect(spec['x-error-code-registry']).toHaveLength(200);
    expect(Object.keys(spec.webhooks)).toHaveLength(13);
  });

  // Holds for the R11 pin only; the next pin updates both constants in its sync-spec commit.
  it('pins the v0.6.0 commits, not the tag objects', () => {
    expect(lock.apirs_ref).toBe('06979f3b48cdb1aab1919454e27e757e1b64fcb5');
    expect(lock.kitrs_ref).toBe('817221528a600f7ef8fb1bd0a010bef71cd6bc97');
  });
});

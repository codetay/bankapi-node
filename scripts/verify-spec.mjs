#!/usr/bin/env node
// CI/local gate: fails if test/fixtures/openapi.json has drifted from its
// lock, or if the lock's ref no longer produces byte-identical GO-KIT
// content (e.g. the ref was force-pushed to a different commit).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderErrorCodes } from './lib/error-codes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = resolve(ROOT, 'test/fixtures/openapi.json');
const LOCK_PATH = resolve(ROOT, 'test/fixtures/openapi.lock.json');
const ERROR_CODES_PATH = resolve(ROOT, 'src/error-codes.ts');
const SPEC_PATH_IN_GOKIT = 'api/openapi.json';
// The spec is well under 1 MB today, but a generous cap costs nothing and
// avoids a cryptic ENOBUFS if it grows.
const MAX_BUFFER = 64 * 1024 * 1024;

function resolveGokitDir() {
  const dir = process.env.GOKIT_DIR ?? resolve(ROOT, '../GO-KIT');
  return resolve(process.cwd(), dir);
}

function main() {
  const gokitDir = resolveGokitDir();
  if (!existsSync(gokitDir)) {
    console.error(
      `GO-KIT checkout not found at ${gokitDir}. Set GOKIT_DIR to the path of a GO-KIT clone.`,
    );
    process.exit(2);
  }

  if (!existsSync(LOCK_PATH)) {
    console.error(`Missing ${LOCK_PATH}. Run npm run sync-spec.`);
    process.exit(1);
  }
  if (!existsSync(FIXTURE_PATH)) {
    console.error(`Missing ${FIXTURE_PATH}. Run npm run sync-spec.`);
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  const fixture = readFileSync(FIXTURE_PATH, 'utf8');
  const sha256 = createHash('sha256').update(fixture).digest('hex');

  if (sha256 !== lock.sha256) {
    console.error(
      `test/fixtures/openapi.json does not match its lock (sha256 ${sha256}, expected ${lock.sha256}). Run npm run sync-spec.`,
    );
    process.exit(1);
  }

  const upstream = execFileSync('git', ['show', `${lock.gokit_ref}:${SPEC_PATH_IN_GOKIT}`], {
    cwd: gokitDir,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (upstream !== fixture) {
    console.error(
      `test/fixtures/openapi.json no longer matches GO-KIT@${lock.gokit_ref}. Run npm run sync-spec.`,
    );
    process.exit(1);
  }

  const expectedErrorCodes = renderErrorCodes(JSON.parse(fixture));
  const actualErrorCodes = existsSync(ERROR_CODES_PATH)
    ? readFileSync(ERROR_CODES_PATH, 'utf8')
    : '';
  if (actualErrorCodes !== expectedErrorCodes) {
    console.error('src/error-codes.ts is stale. Run npm run gen:error-codes.');
    process.exit(1);
  }

  console.log(`test/fixtures/openapi.json verified against GO-KIT@${lock.gokit_ref}`);
}

main();

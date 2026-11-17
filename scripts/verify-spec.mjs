#!/usr/bin/env node
// Local gate: fails if a contract fixture has drifted from its lock, if a
// generated file no longer matches the fixture, or if a locked ref no longer
// resolves to the same commit and byte-identical upstream content (e.g. a
// tag was moved, or the lock holds a tag object instead of its commit).
//
// --lock-only (CI) reads no repository: it checks the fixture hashes against
// the lock and the generated files against the fixtures.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderErrorCodes } from './lib/error-codes.mjs';
import { renderWebhookEvents } from './lib/webhook-events.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = resolve(ROOT, 'test/fixtures/openapi.json');
const LOCK_PATH = resolve(ROOT, 'test/fixtures/openapi.lock.json');
const ERROR_CODES_PATH = resolve(ROOT, 'src/error-codes.ts');
const VECTORS_PATH = resolve(ROOT, 'test/fixtures/webhook_vectors_v2.json');
const WEBHOOK_EVENTS_PATH = resolve(ROOT, 'src/webhook-events.ts');
const SPEC_PATH_IN_APIRS = 'api/openapi.json';
const VECTORS_PATH_IN_KITRS = 'oracle/webhook/webhook_vectors_v2.json';
// The spec is well under 1 MB today, but a generous cap costs nothing and
// avoids a cryptic ENOBUFS if it grows.
const MAX_BUFFER = 64 * 1024 * 1024;

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function repoDir(envName, sibling) {
  const dir = resolve(process.cwd(), process.env[envName] ?? resolve(ROOT, '..', sibling));
  if (!existsSync(dir)) {
    fail(`${sibling} checkout not found at ${dir}. Set ${envName} to a ${sibling} clone.`, 2);
  }
  return dir;
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readRequired(path) {
  if (!existsSync(path)) fail(`Missing ${path}. Run npm run sync-spec.`);
  return readFileSync(path, 'utf8');
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function verifyUpstream(name, envName, ref, pathInRepo, fixtureName, fixture) {
  const dir = repoDir(envName, name);
  let commit;
  try {
    commit = git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch (err) {
    // --quiet keeps stderr empty for a missing ref; any output means git refused the directory.
    const reason = String(err.stderr ?? '').trim();
    if (reason !== '') {
      fail(
        `${name} at ${dir} is not a git checkout (${reason.split('\n')[0]}). Set ${envName} to a ${name} clone.`,
        2,
      );
    }
    fail(`Lock ref ${ref} not found in ${name} at ${dir}; fetch it or set ${envName}.`);
  }
  if (commit !== ref) {
    fail(
      `Lock ref ${ref} resolves to commit ${commit} in ${name}; the lock must hold the commit, not a tag object. Run npm run sync-spec.`,
    );
  }
  if (git(dir, ['show', `${ref}:${pathInRepo}`]) !== fixture) {
    fail(`${fixtureName} no longer matches ${name}@${ref}. Run npm run sync-spec.`);
  }
}

function main() {
  const lockOnly = process.argv.slice(2).includes('--lock-only');

  const lock = JSON.parse(readRequired(LOCK_PATH));
  const fixture = readRequired(FIXTURE_PATH);
  const vectors = readRequired(VECTORS_PATH);

  if (sha256(fixture) !== lock.openapi_sha256) {
    fail(
      `test/fixtures/openapi.json does not match its lock (sha256 ${sha256(fixture)}, expected ${lock.openapi_sha256}). Run npm run sync-spec.`,
    );
  }
  if (sha256(vectors) !== lock.vectors_sha256) {
    fail(
      `test/fixtures/webhook_vectors_v2.json does not match its lock (sha256 ${sha256(vectors)}, expected ${lock.vectors_sha256}). Run npm run sync-spec.`,
    );
  }

  const spec = JSON.parse(fixture);
  const actualErrorCodes = existsSync(ERROR_CODES_PATH)
    ? readFileSync(ERROR_CODES_PATH, 'utf8')
    : '';
  if (actualErrorCodes !== renderErrorCodes(spec)) {
    fail('src/error-codes.ts is stale. Run npm run gen:error-codes.');
  }
  const actualEvents = existsSync(WEBHOOK_EVENTS_PATH)
    ? readFileSync(WEBHOOK_EVENTS_PATH, 'utf8')
    : '';
  if (actualEvents !== renderWebhookEvents(spec)) {
    fail('src/webhook-events.ts is stale. Run npm run sync-spec.');
  }

  if (lockOnly) {
    console.log(
      `test/fixtures verified against the lock only (API-RS@${lock.apirs_ref}, KIT-RS@${lock.kitrs_ref}; no repository read)`,
    );
    return;
  }

  verifyUpstream(
    'API-RS',
    'APIRS_DIR',
    lock.apirs_ref,
    SPEC_PATH_IN_APIRS,
    'test/fixtures/openapi.json',
    fixture,
  );
  verifyUpstream(
    'KIT-RS',
    'KITRS_DIR',
    lock.kitrs_ref,
    VECTORS_PATH_IN_KITRS,
    'test/fixtures/webhook_vectors_v2.json',
    vectors,
  );

  console.log(
    `test/fixtures verified against API-RS@${lock.apirs_ref} and KIT-RS@${lock.kitrs_ref}`,
  );
}

main();

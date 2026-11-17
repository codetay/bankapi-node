#!/usr/bin/env node
// Pins the contract fixtures to specific API-RS and KIT-RS commits: copies
// api/openapi.json out of the API-RS git history and the v2 webhook vectors
// out of the KIT-RS git history (so each fixture is exactly what was
// committed at that ref, not whatever happens to be on disk) and records
// both commits + fixture hashes in test/fixtures/openapi.lock.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apirs-ref') args.apirsRef = argv[++i];
    else if (argv[i] === '--kitrs-ref') args.kitrsRef = argv[++i];
  }
  return args;
}

function repoDir(envName, sibling) {
  const dir = resolve(process.cwd(), process.env[envName] ?? resolve(ROOT, '..', sibling));
  if (!existsSync(dir)) {
    console.error(`${sibling} checkout not found at ${dir}. Set ${envName} to a ${sibling} clone.`);
    process.exit(2);
  }
  return dir;
}

function readLock() {
  return existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : {};
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

// `^{commit}` peels an annotated tag to its commit; a bare rev-parse would
// record the tag object's sha instead.
function resolveCommit(cwd, ref, name, envName) {
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch {
    console.error(`Ref ${ref} not found in ${name} at ${cwd}; fetch it or set ${envName}.`);
    process.exit(2);
  }
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const apirsDir = repoDir('APIRS_DIR', 'API-RS');
  const kitrsDir = repoDir('KITRS_DIR', 'KIT-RS');
  const lock = readLock();

  const apirsRefArg = args.apirsRef ?? lock.apirs_ref;
  const kitrsRefArg = args.kitrsRef ?? lock.kitrs_ref;
  if (!apirsRefArg || !kitrsRefArg) {
    console.error(
      'Give --apirs-ref and --kitrs-ref, or keep test/fixtures/openapi.lock.json to read them from.',
    );
    process.exit(2);
  }

  const apirsRef = resolveCommit(apirsDir, apirsRefArg, 'API-RS', 'APIRS_DIR');
  const kitrsRef = resolveCommit(kitrsDir, kitrsRefArg, 'KIT-RS', 'KITRS_DIR');
  const spec = git(apirsDir, ['show', `${apirsRef}:${SPEC_PATH_IN_APIRS}`]);
  const vectors = git(kitrsDir, ['show', `${kitrsRef}:${VECTORS_PATH_IN_KITRS}`]);

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, spec);
  writeFileSync(VECTORS_PATH, vectors);
  writeFileSync(
    LOCK_PATH,
    `${JSON.stringify(
      {
        apirs_ref: apirsRef,
        openapi_sha256: sha256(spec),
        kitrs_ref: kitrsRef,
        vectors_sha256: sha256(vectors),
      },
      null,
      2,
    )}\n`,
  );

  const parsed = JSON.parse(spec);
  writeFileSync(ERROR_CODES_PATH, renderErrorCodes(parsed));
  writeFileSync(WEBHOOK_EVENTS_PATH, renderWebhookEvents(parsed));

  console.log(`Synced test/fixtures/openapi.json from API-RS@${apirsRef}`);
  console.log(`Synced test/fixtures/webhook_vectors_v2.json from KIT-RS@${kitrsRef}`);
  console.log('Regenerated src/error-codes.ts and src/webhook-events.ts');
}

main();

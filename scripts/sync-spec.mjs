#!/usr/bin/env node
// Pins test/fixtures/openapi.json to a specific GO-KIT ref: copies
// api/openapi.json out of the GO-KIT git history (so the fixture is exactly
// what was committed at that ref, not whatever happens to be on disk) and
// records the ref + fixture hash in test/fixtures/openapi.lock.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function parseArgs(argv) {
  let ref;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ref') ref = argv[++i];
  }
  return { ref };
}

function resolveGokitDir() {
  const dir = process.env.GOKIT_DIR ?? resolve(ROOT, '../GO-KIT');
  return resolve(process.cwd(), dir);
}

function readLockRef() {
  if (!existsSync(LOCK_PATH)) return undefined;
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8')).gokit_ref;
}

function main() {
  const { ref: refArg } = parseArgs(process.argv.slice(2));
  const gokitDir = resolveGokitDir();

  if (!existsSync(gokitDir)) {
    console.error(
      `GO-KIT checkout not found at ${gokitDir}. Set GOKIT_DIR to the path of a GO-KIT clone.`,
    );
    process.exit(2);
  }

  const ref = refArg ?? readLockRef();
  if (!ref) {
    console.error(
      'No --ref given and no existing test/fixtures/openapi.lock.json to read a ref from.',
    );
    process.exit(2);
  }

  const sha = execFileSync('git', ['rev-parse', '--verify', ref], {
    cwd: gokitDir,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  }).trim();
  const spec = execFileSync('git', ['show', `${sha}:${SPEC_PATH_IN_GOKIT}`], {
    cwd: gokitDir,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, spec);

  const sha256 = createHash('sha256').update(spec).digest('hex');
  writeFileSync(LOCK_PATH, `${JSON.stringify({ gokit_ref: sha, sha256 }, null, 2)}\n`);

  writeFileSync(ERROR_CODES_PATH, renderErrorCodes(JSON.parse(spec)));

  console.log(`Synced test/fixtures/openapi.json from GO-KIT@${sha}`);
  console.log('Regenerated src/error-codes.ts');
}

main();

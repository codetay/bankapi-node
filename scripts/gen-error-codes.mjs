#!/usr/bin/env node
// Regenerates src/error-codes.ts from the pinned test/fixtures/openapi.json
// x-error-code-registry. Run after npm run sync-spec, or directly whenever
// the fixture is refreshed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderErrorCodes } from './lib/error-codes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = resolve(ROOT, 'test/fixtures/openapi.json');
const OUTPUT_PATH = resolve(ROOT, 'src/error-codes.ts');

function main() {
  const spec = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  writeFileSync(OUTPUT_PATH, renderErrorCodes(spec));
  console.log(
    `Wrote src/error-codes.ts from ${spec['x-error-code-registry'].length} registry codes`,
  );
}

main();

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// Both scripts stop before writing anything when the first ref does not
// resolve, so pointing them at scratch directories never touches the fixtures.
const lock = JSON.parse(
  readFileSync(new URL('./fixtures/openapi.lock.json', import.meta.url), 'utf8'),
) as { apirs_ref: string; kitrs_ref: string };

const scratch = mkdtempSync(join(tmpdir(), 'bankapi-node-spec-'));
const plainDir = mkdtempSync(join(scratch, 'plain-'));
const emptyRepo = mkdtempSync(join(scratch, 'repo-'));
execFileSync('git', ['init', '--quiet', emptyRepo]);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(script: string, dir: string, args: string[] = []) {
  const path = fileURLToPath(new URL(`../scripts/${script}`, import.meta.url));
  const result = spawnSync(process.execPath, [path, ...args], {
    encoding: 'utf8',
    // The ceiling keeps git from finding a checkout above a TMPDIR that lives inside one.
    env: { ...process.env, APIRS_DIR: dir, KITRS_DIR: dir, GIT_CEILING_DIRECTORIES: scratch },
  });
  return { status: result.status, stderr: result.stderr };
}

const syncArgs = ['--apirs-ref', lock.apirs_ref, '--kitrs-ref', lock.kitrs_ref];

describe('spec scripts on a bad repository directory', () => {
  it('verify-spec names the missing ref, the repository and APIRS_DIR', () => {
    const { status, stderr } = run('verify-spec.mjs', emptyRepo);
    expect(status).toBe(1);
    expect(stderr).toContain(`Lock ref ${lock.apirs_ref} not found in API-RS at ${emptyRepo}`);
    expect(stderr).toContain('APIRS_DIR');
  });

  it('verify-spec says a directory is not a git checkout instead of blaming the ref', () => {
    const { status, stderr } = run('verify-spec.mjs', plainDir);
    expect(status).toBe(2);
    expect(stderr).toContain(`API-RS at ${plainDir} is not a git checkout`);
    expect(stderr).toContain('APIRS_DIR');
    expect(stderr).not.toContain('not found in');
  });

  it('sync-spec names the missing ref, the repository and APIRS_DIR', () => {
    const { status, stderr } = run('sync-spec.mjs', emptyRepo, syncArgs);
    expect(status).toBe(2);
    expect(stderr).toContain(`Ref ${lock.apirs_ref} not found in API-RS at ${emptyRepo}`);
    expect(stderr).toContain('APIRS_DIR');
  });

  it('sync-spec says a directory is not a git checkout instead of blaming the ref', () => {
    const { status, stderr } = run('sync-spec.mjs', plainDir, syncArgs);
    expect(status).toBe(2);
    expect(stderr).toContain(`API-RS at ${plainDir} is not a git checkout`);
    expect(stderr).toContain('APIRS_DIR');
    expect(stderr).not.toContain('not found in');
  });
});

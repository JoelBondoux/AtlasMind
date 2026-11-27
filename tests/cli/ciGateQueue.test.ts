import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CI_GATE_HELD_FILE,
  acquireCiGateForJob,
  releaseCiGateForJob,
  runCiGateQueueCli,
  runUnderCiGate,
} from '../../src/cli/ciGateQueue.ts';
import { CI_GATE_STEP_BUNDLE_OPTIONS } from '../../esbuild.config.mjs';

let root: string;
let lock: string;
let runnerTemp: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'atlasmind-gate-step-'));
  lock = path.join(root, 'ci-gate.lock');
  runnerTemp = path.join(root, 'runner-temp');
  mkdirSync(runnerTemp);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const quiet = { log: () => undefined };

function selfHosted(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    RUNNER_ENVIRONMENT: 'self-hosted',
    RUNNER_TEMP: runnerTemp,
    RUNNER_NAME: 'shared-pc-1',
    GITHUB_REPOSITORY: 'octo/app',
    GITHUB_RUN_ID: '42',
    GITHUB_JOB: 'test',
    ...extra,
  };
}

describe('the CI gate queue step on a GitHub Actions runner', () => {
  it('does nothing on a GitHub-hosted runner, in either direction', async () => {
    const env = { RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: runnerTemp, ATLASMIND_CI_GATE_LOCK: lock };
    expect(await acquireCiGateForJob(env, quiet)).toBe('hosted');
    expect(existsSync(lock)).toBe(false);
    expect(releaseCiGateForJob(env, quiet)).toBe('hosted');
  });

  it('fails closed on a self-hosted runner with no lock configured', async () => {
    await expect(acquireCiGateForJob(selfHosted(), quiet)).rejects.toThrow(/ATLASMIND_CI_GATE_LOCK/);
  });

  it('fails closed when the lock is relative rather than absolute', async () => {
    await expect(acquireCiGateForJob(selfHosted({ ATLASMIND_CI_GATE_LOCK: 'ci-gate.lock' }), quiet)).rejects.toThrow(/absolute/);
  });

  it('takes the lock in the shared owner.txt form and keeps its stamp in RUNNER_TEMP for the release step', async () => {
    const env = selfHosted({ ATLASMIND_CI_GATE_LOCK: lock });
    expect(await acquireCiGateForJob(env, quiet)).toBe('acquired');
    const stamp = readFileSync(path.join(lock, 'owner.txt'), 'utf8').trim();
    expect(stamp).toMatch(/^GitHub Actions shared-pc-1 octo\/app run 42 test - pid \d+ - started \d{4}-\d\d-\d\dT[\d:.]+Z$/);
    const held = JSON.parse(readFileSync(path.join(runnerTemp, CI_GATE_HELD_FILE), 'utf8'));
    expect(held).toEqual({ lockDir: lock, stamp });
    expect(releaseCiGateForJob(env, quiet)).toBe('released');
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(path.join(runnerTemp, CI_GATE_HELD_FILE))).toBe(false);
  });

  it('never removes a lock another run holds by the time the release step runs', async () => {
    const env = selfHosted({ ATLASMIND_CI_GATE_LOCK: lock });
    await acquireCiGateForJob(env, quiet);
    // The job ran past the stale age and a waiting gate took the lock over.
    writeFileSync(path.join(lock, 'owner.txt'), 'local gate - pid 7 - started 2026-11-27T12:00:00.000Z\n');
    expect(releaseCiGateForJob(env, quiet)).toBe('not-ours');
    expect(readFileSync(path.join(lock, 'owner.txt'), 'utf8')).toContain('local gate');
  });

  it('releases nothing when this job never acquired (an earlier step failed)', () => {
    expect(releaseCiGateForJob(selfHosted({ ATLASMIND_CI_GATE_LOCK: lock }), quiet)).toBe('nothing-held');
  });

  it('only ever releases the lock the held file names when it matches the configured lock', async () => {
    const env = selfHosted({ ATLASMIND_CI_GATE_LOCK: lock });
    // A held file pointing elsewhere (a different job's leftovers, or tampering) is ignored.
    const elsewhere = path.join(root, 'elsewhere.lock');
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, 'owner.txt'), 'x\n');
    writeFileSync(path.join(runnerTemp, CI_GATE_HELD_FILE), JSON.stringify({ lockDir: elsewhere, stamp: 'x' }));
    expect(releaseCiGateForJob(env, quiet)).toBe('nothing-held');
    expect(existsSync(elsewhere)).toBe(true);
  });
});

describe('running a local gate under the queue', () => {
  it('runs the command and releases after a failure as well as a success', async () => {
    const env = { ATLASMIND_CI_GATE_LOCK: lock };
    const seen: boolean[] = [];
    const failing = await runUnderCiGate(env, ['npm', 'run', 'ci'], {
      ...quiet,
      run: async () => {
        seen.push(existsSync(path.join(lock, 'owner.txt')));
        return 3;
      },
    });
    expect(failing).toBe(3);
    expect(seen).toEqual([true]);
    expect(existsSync(lock)).toBe(false);
  });

  it('just runs the command when no queue is configured off a self-hosted runner', async () => {
    expect(await runUnderCiGate({}, ['node', '-v'], { ...quiet, run: async () => 0 })).toBe(0);
  });

  it('fails closed on a self-hosted runner with no queue', async () => {
    await expect(runUnderCiGate({ RUNNER_ENVIRONMENT: 'self-hosted' }, ['x'], { ...quiet, run: async () => 0 }))
      .rejects.toThrow(/ATLASMIND_CI_GATE_LOCK/);
  });

  it('refuses an empty command', async () => {
    await expect(runUnderCiGate({}, [], { ...quiet, run: async () => 0 })).rejects.toThrow(/command/i);
  });
});

describe('the CI gate queue command line', () => {
  it('rejects an unknown command with usage, exit 2', async () => {
    const errors: string[] = [];
    expect(await runCiGateQueueCli(['frobnicate'], {}, { log: () => undefined, error: line => errors.push(line) })).toBe(2);
    expect(errors.join('\n')).toMatch(/acquire\|release\|run/);
  });

  it('reports a fail-closed acquire as exit 1 with the reason', async () => {
    const errors: string[] = [];
    expect(await runCiGateQueueCli(['acquire'], selfHosted(), { log: () => undefined, error: line => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toMatch(/ATLASMIND_CI_GATE_LOCK/);
  });

  it('ships as a committed, dependency-free bundle that matches its source', async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const fresh = await build({ ...CI_GATE_STEP_BUNDLE_OPTIONS, absWorkingDir: repoRoot, write: false, logLevel: 'silent' });
    const built = fresh.outputFiles[0]!.text.replace(/\r\n/g, '\n');
    const committed = readFileSync(path.join(repoRoot, CI_GATE_STEP_BUNDLE_OPTIONS.outfile as string), 'utf8').replace(/\r\n/g, '\n');
    expect(committed, 'Run `npm run compile` and commit media/bin/atlasmind-ci-gate.mjs').toBe(built);
    // Only Node built-ins: the file is copied into other repositories and run with bare `node`.
    const imports = [...committed.matchAll(/^import\s.*?from\s+["']([^"']+)["']/gm)].map(match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every(name => name!.startsWith('node:'))).toBe(true);
  });
});

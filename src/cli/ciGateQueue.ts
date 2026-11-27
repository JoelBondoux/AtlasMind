/**
 * The CI gate queue as a command, for GitHub Actions steps and local scripts.
 *
 *   node atlasmind-ci-gate.mjs acquire          # early step: wait for the queue, keep the stamp
 *   node atlasmind-ci-gate.mjs release          # last step, `if: always()`
 *   node atlasmind-ci-gate.mjs run -- npm run ci  # a local gate: hold the queue for one command
 *
 * The lock is named by `ATLASMIND_CI_GATE_LOCK` (an absolute directory path)
 * and its stale age by `ATLASMIND_CI_GATE_STALE_HOURS` (default 3). A GitHub
 * Actions job acquires in one step and releases in another, so `acquire` keeps
 * the stamp it wrote in `$RUNNER_TEMP` and `release` removes exactly that lock,
 * never a lock somebody took over after this job ran past the stale age.
 *
 * Three rules decide what happens where:
 *
 * - **On a GitHub-hosted runner both steps do nothing.** That machine is
 *   GitHub's and shared with nobody here, so the same workflow runs on either.
 * - **On a self-hosted runner with no lock configured, `acquire` fails.** A
 *   runner that cannot queue must not run a gate's worth of work beside one; a
 *   silent no-op would look exactly like a queue that works.
 * - **Off a runner, `run` without a lock just runs the command.** The queue is
 *   opt-in for a developer's own machine, and a project's `ci:local` should
 *   still work for somebody who never configured it.
 *
 * Bundled by `esbuild.mjs` into the dependency-free `media/bin/atlasmind-ci-gate.mjs`,
 * which other repositories copy into their own tree and run with bare `node`.
 */

import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  CI_GATE_QUEUE_DEFAULT_STALE_MS,
  releaseCiGateQueueLock,
  resolveCiGateQueueLockPath,
  waitForCiGateQueueLock,
  type CiGateQueueRelease,
} from '../core/ciGateQueue.js';

export const CI_GATE_HELD_FILE = 'atlasmind-ci-gate.json';
export const CI_GATE_LOCK_ENV = 'ATLASMIND_CI_GATE_LOCK';
export const CI_GATE_STALE_HOURS_ENV = 'ATLASMIND_CI_GATE_STALE_HOURS';

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface CiGateStepIo {
  log?: (line: string) => void;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function isSelfHosted(env: Env): boolean {
  return env.RUNNER_ENVIRONMENT === 'self-hosted';
}

function isGitHubHosted(env: Env): boolean {
  return env.RUNNER_ENVIRONMENT === 'github-hosted';
}

function staleMs(env: Env): number {
  const raw = env[CI_GATE_STALE_HOURS_ENV];
  if (raw === undefined || raw.trim() === '') {
    return CI_GATE_QUEUE_DEFAULT_STALE_MS;
  }
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0.25 || hours > 48) {
    throw new Error(`${CI_GATE_STALE_HOURS_ENV} must be a number of hours between 0.25 and 48.`);
  }
  return hours * 60 * 60_000;
}

function configuredLock(env: Env): string | undefined {
  const resolved = resolveCiGateQueueLockPath(env[CI_GATE_LOCK_ENV]);
  if (!resolved.ok) {
    throw new Error(`${CI_GATE_LOCK_ENV}: ${resolved.reason}`);
  }
  return resolved.path;
}

function noQueueOnSelfHosted(): Error {
  return new Error(
    `AtlasMind - This self-hosted runner has no ${CI_GATE_LOCK_ENV}, so it cannot queue with the other CI gates on this computer. `
    + 'Mount the lock\'s folder into the runner and set the variable, or route the job to GitHub-hosted runners.',
  );
}

function heldFile(env: Env): string {
  if (!env.RUNNER_TEMP) {
    throw new Error('AtlasMind - RUNNER_TEMP is not set; acquire and release run inside a GitHub Actions job.');
  }
  return path.join(env.RUNNER_TEMP, CI_GATE_HELD_FILE);
}

function jobOwner(env: Env): string {
  return `GitHub Actions ${env.RUNNER_NAME ?? 'runner'} ${env.GITHUB_REPOSITORY ?? ''} run ${env.GITHUB_RUN_ID ?? '?'} ${env.GITHUB_JOB ?? ''}`;
}

export async function acquireCiGateForJob(env: Env, io: CiGateStepIo = {}): Promise<'hosted' | 'acquired'> {
  const log = io.log ?? console.log;
  if (!isSelfHosted(env)) {
    log('AtlasMind - Not a self-hosted runner: no shared computer queue to join.');
    return 'hosted';
  }
  const lockDir = configuredLock(env);
  if (!lockDir) {
    throw noQueueOnSelfHosted();
  }
  const file = heldFile(env);
  const release = await waitForCiGateQueueLock(lockDir, {
    owner: jobOwner(env),
    staleMs: staleMs(env),
    log,
    ...(io.pollMs !== undefined ? { pollMs: io.pollMs } : {}),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
  try {
    writeFileSync(file, JSON.stringify({ lockDir, stamp: release.stamp }));
  } catch (error) {
    // Without the held file the release step could never let go; give the lock back now.
    release();
    throw error;
  }
  return 'acquired';
}

export function releaseCiGateForJob(env: Env, io: Pick<CiGateStepIo, 'log'> = {}): 'hosted' | 'released' | 'not-ours' | 'nothing-held' {
  const log = io.log ?? console.log;
  if (!isSelfHosted(env)) {
    log('AtlasMind - Not a self-hosted runner: nothing to release.');
    return 'hosted';
  }
  const file = heldFile(env);
  let held: { lockDir?: unknown; stamp?: unknown };
  try {
    held = JSON.parse(readFileSync(file, 'utf8')) as typeof held;
  } catch {
    log('AtlasMind - This job holds no CI gate queue lock.');
    return 'nothing-held';
  }
  rmSync(file, { force: true });
  let expected: string | undefined;
  try {
    expected = configuredLock(env);
  } catch {
    expected = undefined;
  }
  // Release only the lock this runner is configured to queue on, so a held
  // file can never be used to delete an arbitrary directory.
  if (typeof held.lockDir !== 'string' || typeof held.stamp !== 'string' || !expected
    || path.resolve(held.lockDir) !== path.resolve(expected)) {
    log('AtlasMind - The held CI gate record does not name this runner\'s queue lock; left everything in place.');
    return 'nothing-held';
  }
  const outcome = releaseCiGateQueueLock(expected, held.stamp);
  if (outcome === 'released') {
    log(`AtlasMind - CI gate queue released: ${expected}`);
    return 'released';
  }
  if (outcome === 'not-ours') {
    log('AtlasMind - The CI gate queue lock now belongs to another run; left it in place.');
    return 'not-ours';
  }
  log('AtlasMind - The CI gate queue lock was already gone.');
  return 'nothing-held';
}

export interface RunUnderCiGateIo extends CiGateStepIo {
  /** Runs the command and resolves with its exit code. Injected by tests. */
  run?: (command: string, args: readonly string[]) => Promise<number>;
}

/**
 * Never through a shell. On Windows `npm` is a `.cmd` shim that cannot be
 * spawned directly, so when this is itself running under npm (the usual case:
 * a `ci:local` script) npm's own entry point is run with this Node instead.
 */
function resolveGateCommand(command: string, args: readonly string[], env: Env, platform = process.platform): { file: string; args: string[] } {
  const npmCli = env.npm_execpath;
  if (command === 'npm' && npmCli && /\.c?js$/i.test(npmCli)) {
    return { file: process.execPath, args: [npmCli, ...args] };
  }
  if (platform === 'win32' && /^(npm|npx|pnpm|yarn)$/i.test(command)) {
    throw new Error(`AtlasMind - On Windows run "${command}" through an npm script so the gate can start it without a shell.`);
  }
  return { file: command, args: [...args] };
}

function spawnCommand(command: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const resolved = resolveGateCommand(command, args, process.env);
    const child = spawn(resolved.file, resolved.args, { stdio: 'inherit', windowsHide: true, shell: false });
    child.on('error', reject);
    child.on('close', code => resolve(code ?? 1));
  });
}

/** Hold the queue for the length of one command, releasing after a failure as well as a success. */
export async function runUnderCiGate(env: Env, argv: readonly string[], io: RunUnderCiGateIo = {}): Promise<number> {
  const log = io.log ?? console.log;
  const [command, ...args] = argv;
  if (!command) {
    throw new Error('AtlasMind - Give the command to run after `run --`.');
  }
  const lockDir = configuredLock(env);
  if (!lockDir && isSelfHosted(env)) {
    throw noQueueOnSelfHosted();
  }
  const run = io.run ?? spawnCommand;
  if (!lockDir || isGitHubHosted(env)) {
    return run(command, args);
  }
  const owner = `${[command, ...args].join(' ').slice(0, 120)} in ${process.cwd()}`;
  const release: CiGateQueueRelease = await waitForCiGateQueueLock(lockDir, {
    owner,
    staleMs: staleMs(env),
    log,
    ...(io.pollMs !== undefined ? { pollMs: io.pollMs } : {}),
    ...(io.sleep ? { sleep: io.sleep } : {}),
  });
  const onSignal = (): void => {
    release();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await run(command, args);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    const outcome = release();
    if (outcome === 'not-ours') {
      log('AtlasMind - The CI gate queue lock now belongs to another run; left it in place.');
    }
  }
}

export interface CiGateCliIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE = 'Usage: atlasmind-ci-gate acquire|release|run -- <command> [args...]';

/** The command line. Resolves with the process exit code. */
export async function runCiGateQueueCli(argv: readonly string[], env: Env, io: CiGateCliIo): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'acquire') {
      await acquireCiGateForJob(env, { log: io.log });
      return 0;
    }
    if (command === 'release') {
      releaseCiGateForJob(env, { log: io.log });
      return 0;
    }
    if (command === 'run') {
      const separator = rest.indexOf('--');
      return await runUnderCiGate(env, separator >= 0 ? rest.slice(separator + 1) : rest, { log: io.log });
    }
    io.error(USAGE);
    return 2;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

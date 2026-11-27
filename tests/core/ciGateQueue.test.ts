import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CI_GATE_QUEUE_DEFAULT_STALE_MS,
  CI_GATE_TAKEOVER_STALE_MS,
  formatCiGateQueueStamp,
  readCiGateQueueHolder,
  releaseCiGateQueueLock,
  removeStaleCiGateQueueLock,
  resolveCiGateQueueLockPath,
  waitForCiGateQueueLock,
} from '../../src/core/ciGateQueue.ts';

let root: string;
let lock: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'atlasmind-gate-'));
  lock = path.join(root, 'ci-gate.lock');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Age a directory by moving its mtime into the past; age is the only staleness signal. */
function age(dir: string, ms: number): void {
  const when = new Date(Date.now() - ms);
  utimesSync(dir, when, when);
}

const quiet = { log: () => undefined };

describe('the CI gate queue lock path', () => {
  it('is opt-in: nothing configured means no queue', () => {
    expect(resolveCiGateQueueLockPath('')).toEqual({ ok: true, path: undefined });
    expect(resolveCiGateQueueLockPath('   ')).toEqual({ ok: true, path: undefined });
    expect(resolveCiGateQueueLockPath(undefined)).toEqual({ ok: true, path: undefined });
  });

  it('accepts only an absolute directory path, and refuses rather than guessing', () => {
    expect(resolveCiGateQueueLockPath(lock)).toEqual({ ok: true, path: lock });
    const relative = resolveCiGateQueueLockPath('ci-gate.lock');
    expect(relative.ok).toBe(false);
    const traversal = resolveCiGateQueueLockPath(`${root}${path.sep}..${path.sep}x`);
    expect(traversal.ok).toBe(false);
    expect(resolveCiGateQueueLockPath(`${lock}\n`).ok).toBe(false);
  });
});

describe('waiting for and holding the CI gate queue', () => {
  it('takes a free lock, stamps owner.txt in the shared form and releases only its own stamp', async () => {
    const release = await waitForCiGateQueueLock(lock, { owner: 'ci:local my-project', now: () => Date.parse('2026-11-27T10:00:00Z'), ...quiet });
    const text = readFileSync(path.join(lock, 'owner.txt'), 'utf8');
    expect(text).toBe(`ci:local my-project - pid ${process.pid} - started 2026-11-27T10:00:00.000Z\n`);
    expect(release.stamp).toBe(text.trim());
    expect(readCiGateQueueHolder(lock)).toBe(text.trim());
    expect(release()).toBe('released');
    expect(existsSync(lock)).toBe(false);
    // Idempotent: a second call never removes a later holder's lock.
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'someone else - pid 1 - started 2026-11-27T10:05:00.000Z\n');
    expect(release()).toBe('already-released');
    expect(existsSync(lock)).toBe(true);
  });

  it('formats the stamp exactly, so hand-made and other projects\' gates interoperate', () => {
    expect(formatCiGateQueueStamp('GitHub Actions run 7', 4242, Date.parse('2026-01-02T03:04:05.678Z')))
      .toBe('GitHub Actions run 7 - pid 4242 - started 2026-01-02T03:04:05.678Z');
    // An owner cannot smuggle a second line (and so a second stamp) into owner.txt.
    expect(formatCiGateQueueStamp('a\nb\r c', 1, 0)).toBe('a b c - pid 1 - started 1970-01-01T00:00:00.000Z');
  });

  it('stamps the moment it took the lock, not when waiting began, so a waiter never looks like a second holder', async () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'local gate - pid 1 - started 2026-11-27T09:00:00.000Z\n');
    let clock = Date.parse('2026-11-27T10:00:00Z');
    // The other holder took it a minute ago on the same clock, so it is not stale.
    utimesSync(lock, new Date(clock - 60_000), new Date(clock - 60_000));
    const seen: string[] = [];
    const release = await waitForCiGateQueueLock(lock, {
      owner: 'runner job',
      now: () => clock,
      pollMs: 60_000,
      log: line => seen.push(line),
      sleep: async ms => {
        // While this run waits, the other holder still owns the lock and owner.txt is theirs.
        expect(readFileSync(path.join(lock, 'owner.txt'), 'utf8')).toContain('local gate');
        clock += ms;
        rmSync(lock, { recursive: true, force: true });
      },
    });
    expect(release.stamp).toBe(`runner job - pid ${process.pid} - started 2026-11-27T10:01:00.000Z`);
    expect(seen.some(line => line.includes('held by: local gate - pid 1'))).toBe(true);
    release();
  });

  it('waits while another gate holds a fresh lock and never removes it', async () => {
    mkdirSync(lock);
    const theirs = 'other project ci:local - pid 99 - started 2026-11-27T09:00:00.000Z';
    writeFileSync(path.join(lock, 'owner.txt'), `${theirs}\n`);
    const controller = new AbortController();
    let polls = 0;
    await expect(waitForCiGateQueueLock(lock, {
      owner: 'me',
      pollMs: 10,
      signal: controller.signal,
      ...quiet,
      sleep: async () => {
        polls += 1;
        if (polls === 3) controller.abort();
      },
    })).rejects.toThrow(/stopped waiting/i);
    expect(readFileSync(path.join(lock, 'owner.txt'), 'utf8').trim()).toBe(theirs);
  });

  it('takes over a lock older than the stale age, judged by age alone and never by a pid', async () => {
    mkdirSync(lock);
    // The pid is this very process — alive — and still the lock is stale: a pid
    // seen across a container boundary means nothing, so it is never consulted.
    writeFileSync(path.join(lock, 'owner.txt'), `crashed gate - pid ${process.pid} - started 2026-11-27T05:00:00.000Z\n`);
    age(lock, CI_GATE_QUEUE_DEFAULT_STALE_MS + 60_000);
    const lines: string[] = [];
    const release = await waitForCiGateQueueLock(lock, { owner: 'me', log: line => lines.push(line), sleep: async () => undefined });
    expect(readCiGateQueueHolder(lock)).toBe(release.stamp);
    expect(lines.some(line => /took it over/.test(line))).toBe(true);
    release();
  });

  it('does not take over a lock younger than the stale age, even with a dead-looking pid', async () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'gate in a container - pid 999999 - started 2026-11-27T09:59:00.000Z\n');
    age(lock, 60_000);
    const controller = new AbortController();
    await expect(waitForCiGateQueueLock(lock, {
      owner: 'me',
      staleMs: CI_GATE_QUEUE_DEFAULT_STALE_MS,
      signal: controller.signal,
      ...quiet,
      sleep: async () => controller.abort(),
    })).rejects.toThrow(/stopped waiting/i);
    expect(readCiGateQueueHolder(lock)).toContain('gate in a container');
  });

  it('honours a configured stale age', async () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'old - pid 1 - started 2026-11-27T09:00:00.000Z\n');
    age(lock, 31 * 60_000);
    const release = await waitForCiGateQueueLock(lock, { owner: 'me', staleMs: 30 * 60_000, ...quiet, sleep: async () => undefined });
    expect(readCiGateQueueHolder(lock)).toBe(release.stamp);
    release();
  });

  it('creates the lock\'s parent folder when it is missing', async () => {
    const nested = path.join(root, 'shared', 'w', 'ci-gate.lock');
    const release = await waitForCiGateQueueLock(nested, { owner: 'me', ...quiet });
    expect(existsSync(path.join(nested, 'owner.txt'))).toBe(true);
    release();
  });
});

describe('taking over a stale lock without racing another waiter', () => {
  it('does not delete a fresh lock another gate created after both found the old one stale', () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'old - pid 1 - started x\n');
    const observed = readFileSync(path.join(lock, 'owner.txt'), 'utf8');
    // Another waiter took it over first and now holds a fresh lock.
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'fresh - pid 2 - started y\n');
    expect(removeStaleCiGateQueueLock(lock, { observedOwner: observed, isStillStale: () => true })).toBe(false);
    expect(readCiGateQueueHolder(lock)).toBe('fresh - pid 2 - started y');
  });

  it('re-checks staleness under the takeover lock', () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'holder\n');
    const observed = readFileSync(path.join(lock, 'owner.txt'), 'utf8');
    expect(removeStaleCiGateQueueLock(lock, { observedOwner: observed, isStillStale: () => false })).toBe(false);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(`${lock}.takeover`)).toBe(false);
  });

  it('leaves the lock alone while another waiter holds the takeover, and clears a crashed takeover', () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'holder\n');
    const observed = readFileSync(path.join(lock, 'owner.txt'), 'utf8');
    mkdirSync(`${lock}.takeover`);
    expect(removeStaleCiGateQueueLock(lock, { observedOwner: observed, isStillStale: () => true })).toBe(false);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(`${lock}.takeover`)).toBe(true);
    // A takeover older than a minute is a crashed waiter: cleared, and the next look proceeds.
    age(`${lock}.takeover`, CI_GATE_TAKEOVER_STALE_MS + 1_000);
    expect(removeStaleCiGateQueueLock(lock, { observedOwner: observed, isStillStale: () => true })).toBe(false);
    expect(existsSync(`${lock}.takeover`)).toBe(false);
    expect(removeStaleCiGateQueueLock(lock, { observedOwner: observed, isStillStale: () => true })).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('lets only one of two waiters that both saw a stale lock take it', async () => {
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'crashed - pid 1 - started 2026-11-27T01:00:00.000Z\n');
    age(lock, CI_GATE_QUEUE_DEFAULT_STALE_MS + 60_000);
    const controllers = [new AbortController(), new AbortController()];
    const attempts = controllers.map((controller, index) => waitForCiGateQueueLock(lock, {
      owner: `waiter ${index}`,
      signal: controller.signal,
      pollMs: 1,
      ...quiet,
      sleep: async () => {
        // The loser sees a fresh, live lock and keeps waiting; stop it after one look.
        controller.abort();
      },
    }).then(release => ({ index, release }), () => undefined));
    const results = (await Promise.all(attempts)).filter((value): value is NonNullable<typeof value> => Boolean(value));
    expect(results).toHaveLength(1);
    expect(readCiGateQueueHolder(lock)).toBe(results[0]!.release.stamp);
    results[0]!.release();
  });
});

describe('releasing the CI gate queue', () => {
  it('reports gone, not-ours or released, and removes the lock only for its own stamp', () => {
    expect(releaseCiGateQueueLock(lock, 'me - pid 1 - started t')).toBe('gone');
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.txt'), 'someone - pid 2 - started t\n');
    expect(releaseCiGateQueueLock(lock, 'me - pid 1 - started t')).toBe('not-ours');
    expect(existsSync(lock)).toBe(true);
    writeFileSync(path.join(lock, 'owner.txt'), 'me - pid 1 - started t\n');
    expect(releaseCiGateQueueLock(lock, 'me - pid 1 - started t')).toBe('released');
    expect(existsSync(lock)).toBe(false);
  });

  it('treats an empty stamp as nobody\'s, so it can never match an owner-less lock', () => {
    mkdirSync(lock);
    expect(releaseCiGateQueueLock(lock, '')).toBe('not-ours');
    expect(existsSync(lock)).toBe(true);
  });
});

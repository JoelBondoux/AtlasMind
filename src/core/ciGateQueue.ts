/**
 * A machine-wide queue for heavy CI work: one gate at a time on a shared computer.
 *
 * The resource plan in `localCiRunner` admits a gate when enough CPU and memory
 * are free *right now*. That is a check, not a queue: two gates started a minute
 * apart both see free capacity and both start, and so does a self-hosted runner
 * job that arrives while a local `ci:local` is halfway through. On a computer
 * several projects share, the second one is what pushes the commit charge past
 * the limit. This lock makes them take turns instead.
 *
 * The format is a convention, not an AtlasMind invention, and it must stay
 * exactly this so AtlasMind interoperates with gates other projects (and people,
 * by hand) already run on the same computer:
 *
 * - **The lock is a directory**, created with `mkdir`, which is atomic on every
 *   filesystem AtlasMind supports: exactly one creator succeeds.
 * - **`owner.txt` inside it says who holds it**, as
 *   `<owner> - pid <pid> - started <ISO time>`. The time is when the lock was
 *   *taken*, never when waiting began — a waiter that stamped its start time
 *   would read as a second holder that had held the lock all along.
 * - **A lock older than the stale age (three hours by default) is abandoned**
 *   and may be taken over. Age is the *only* staleness signal. A pid is
 *   recorded for people, never consulted: a holder inside a container has a pid
 *   the host cannot see, so "that process is gone" is a guess that would hand a
 *   live gate's lock to somebody else.
 * - **A takeover happens only while holding `<lock>.takeover`** (another atomic
 *   `mkdir`), and only after re-checking under it that the lock is still stale
 *   and `owner.txt` is byte-for-byte what was read when it looked stale. Without
 *   that, two waiters that both saw the same old lock could each remove it, and
 *   the slower would delete the fresh lock the faster had just taken.
 * - **Release removes the lock only while `owner.txt` still holds this holder's
 *   exact stamp.** A holder that ran past the stale age and was taken over must
 *   not, on finishing, delete the new holder's lock.
 *
 * `node:fs` and `node:path` only, so the same file bundles into the
 * dependency-free `atlasmind-ci-gate.mjs` step that other repositories run with
 * bare `node` on a self-hosted runner.
 */

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** Three hours: the shared convention's stale age. */
export const CI_GATE_QUEUE_DEFAULT_STALE_MS = 3 * 60 * 60_000;
/** A takeover lock is held for milliseconds; one older than this is a waiter that crashed mid-takeover. */
export const CI_GATE_TAKEOVER_STALE_MS = 60_000;
/** How often a waiter looks again by default. */
export const CI_GATE_QUEUE_DEFAULT_POLL_MS = 30_000;

const OWNER_FILE = 'owner.txt';

export type CiGateQueueLockPathResolution =
  | { ok: true; path: string | undefined }
  | { ok: false; reason: string };

/**
 * Read a configured lock path. Empty means the queue is off; anything else must
 * be a plain absolute directory path. A relative path would resolve against
 * whichever folder the gate happened to start in, so two gates would each make
 * their own lock and queue with nobody — refused, never resolved.
 */
export function resolveCiGateQueueLockPath(value: string | undefined): CiGateQueueLockPathResolution {
  const raw = value ?? '';
  if (raw.trim() === '') {
    return { ok: true, path: undefined };
  }
  if (/[\u0000-\u001f]/.test(raw) || raw !== raw.trim()) {
    return { ok: false, reason: 'The CI gate queue lock path contains control characters or surrounding spaces.' };
  }
  if (!path.isAbsolute(raw)) {
    return { ok: false, reason: `The CI gate queue lock must be an absolute directory path, not "${raw.slice(0, 120)}".` };
  }
  if (raw.split(/[\\/]+/).includes('..')) {
    return { ok: false, reason: 'The CI gate queue lock path must not contain "..".' };
  }
  return { ok: true, path: raw };
}

/** The exact owner stamp, on one line whatever the owner text contained. */
export function formatCiGateQueueStamp(owner: string, pid: number, takenAtMs: number): string {
  const who = owner.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() || 'unknown gate';
  return `${who} - pid ${pid} - started ${new Date(takenAtMs).toISOString()}`;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Who holds the lock, as its `owner.txt` says, or `undefined` when nobody does or it is being written. */
export function readCiGateQueueHolder(lockDir: string): string | undefined {
  const text = readText(path.join(lockDir, OWNER_FILE))?.trim();
  return text ? text : undefined;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

export interface RemoveStaleCiGateLockOptions {
  /** `owner.txt` exactly as it read when the lock was judged stale (`undefined` if it was absent). */
  observedOwner: string | undefined;
  /** Re-evaluated under the takeover lock; the earlier verdict may be out of date. */
  isStillStale: () => boolean;
  now?: () => number;
}

/**
 * Remove a stale lock without racing another waiter doing the same. Returns
 * `true` only when this call removed it; `false` when another waiter is
 * mid-takeover, the lock has changed, or it is no longer stale — the caller
 * then simply looks again.
 */
export function removeStaleCiGateQueueLock(lockDir: string, options: RemoveStaleCiGateLockOptions): boolean {
  const now = options.now ?? Date.now;
  const takeover = `${lockDir}.takeover`;
  try {
    mkdirSync(takeover);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
    let takeoverAge = 0;
    try {
      takeoverAge = now() - statSync(takeover).mtimeMs;
    } catch {
      // Released meanwhile.
    }
    if (takeoverAge > CI_GATE_TAKEOVER_STALE_MS) {
      rmSync(takeover, { recursive: true, force: true });
    }
    return false;
  }
  try {
    if (!options.isStillStale()) {
      return false;
    }
    if (readText(path.join(lockDir, OWNER_FILE)) !== options.observedOwner) {
      return false;
    }
    rmSync(lockDir, { recursive: true, force: true });
    return true;
  } finally {
    rmSync(takeover, { recursive: true, force: true });
  }
}

export type CiGateQueueReleaseOutcome = 'released' | 'not-ours' | 'gone';

/** Remove the lock only while `owner.txt` still carries `stamp`. */
export function releaseCiGateQueueLock(lockDir: string, stamp: string): CiGateQueueReleaseOutcome {
  let exists = true;
  try {
    statSync(lockDir);
  } catch {
    exists = false;
  }
  if (!exists) {
    return 'gone';
  }
  const current = readText(path.join(lockDir, OWNER_FILE))?.trim();
  if (!stamp || current !== stamp) {
    return 'not-ours';
  }
  rmSync(lockDir, { recursive: true, force: true });
  return 'released';
}

export interface CiGateQueueRelease {
  (): CiGateQueueReleaseOutcome | 'already-released';
  /** The stamp this holder wrote; a later process (a GitHub Actions release step) releases with it. */
  readonly stamp: string;
}

export interface WaitForCiGateQueueOptions {
  /** Who is asking, for `owner.txt` and for whoever is waiting behind. */
  owner: string;
  staleMs?: number;
  pollMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Aborting stops the wait with an error; it never removes anybody's lock. */
  signal?: AbortSignal;
  pid?: number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function stoppedWaiting(lockDir: string): Error {
  return new Error(`Stopped waiting for the CI gate queue at ${lockDir}; nothing was started and no lock was touched.`);
}

/**
 * Wait for the queue, take it, and return its release. The release is
 * idempotent and carries the stamp, so a caller that releases from another
 * process can do so exactly.
 */
export async function waitForCiGateQueueLock(lockDir: string, options: WaitForCiGateQueueOptions): Promise<CiGateQueueRelease> {
  const staleMs = options.staleMs ?? CI_GATE_QUEUE_DEFAULT_STALE_MS;
  const pollMs = options.pollMs ?? CI_GATE_QUEUE_DEFAULT_POLL_MS;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? (ms => defaultSleep(ms, options.signal));
  const pid = options.pid ?? process.pid;
  const ownerFile = path.join(lockDir, OWNER_FILE);
  mkdirSync(path.dirname(lockDir), { recursive: true });
  let lastHolder: string | undefined;

  for (;;) {
    if (options.signal?.aborted) {
      throw stoppedWaiting(lockDir);
    }
    try {
      mkdirSync(lockDir);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
      const ageOf = (): number | undefined => {
        try {
          return now() - statSync(lockDir).mtimeMs;
        } catch {
          return undefined;
        }
      };
      const observedOwner = readText(ownerFile);
      const lockAge = ageOf();
      if (lockAge === undefined) {
        continue; // Released between mkdir and stat: try again at once.
      }
      if (lockAge > staleMs) {
        const isStillStale = (): boolean => (ageOf() ?? 0) > staleMs;
        if (removeStaleCiGateQueueLock(lockDir, { observedOwner, isStillStale, now })) {
          log(`AtlasMind - CI gate queue lock ${lockDir} was over ${Math.round(staleMs / 60_000)} minutes old; took it over.`);
        } else {
          await sleep(Math.min(pollMs, 1_000)); // Another waiter is mid-takeover; look again shortly.
        }
        continue;
      }
      const holder = observedOwner?.trim() || 'unknown (the lock is being written)';
      if (holder !== lastHolder) {
        log(`AtlasMind - Waiting for the CI gate queue (${lockDir}), held by: ${holder}`);
        lastHolder = holder;
      }
      await sleep(pollMs);
      continue;
    }
    // Stamp the moment the lock is taken.
    const stamp = formatCiGateQueueStamp(options.owner, pid, now());
    try {
      writeFileSync(ownerFile, `${stamp}\n`);
    } catch (error) {
      rmSync(lockDir, { recursive: true, force: true });
      throw error;
    }
    log(`AtlasMind - CI gate queue taken: ${lockDir}`);
    let released = false;
    const release = (() => {
      if (released) {
        return 'already-released';
      }
      released = true;
      return releaseCiGateQueueLock(lockDir, stamp);
    }) as CiGateQueueRelease;
    Object.defineProperty(release, 'stamp', { value: stamp, enumerable: true });
    return release;
  }
}

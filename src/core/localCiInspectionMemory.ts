/**
 * What this computer was found to have, and when — the local CI setup answer
 * that used to be forgotten every time VS Code closed.
 *
 * The trusted workflow verdict was made restart-proof by deriving it on every
 * refresh, which works because it is one file read. The *machine* half cannot
 * be treated that way: probing it runs `docker`, `docker info` and `gh auth
 * status`, and doing that on every dashboard render would start processes as a
 * side effect of looking at a page. So the prerequisites reset to
 * `not-inspected` on every extension-host restart, the Pipeline page went back
 * to "Inspect this computer", and the setup ladder asked for a step somebody
 * had already done — the same complaint, arriving through the other half.
 *
 * This module is the memory, and the discipline that keeps it honest.
 *
 * **A memory is a dated observation, never a current reading.** Nothing here
 * returns a boolean on its own: `restoreLocalCiInspection` hands back the
 * observation *with* `observedAt` and an age, and every surface that shows it
 * says when it was taken. A page reporting "Docker: Ready" from a three-week-old
 * probe is making a claim about right now that nobody checked.
 *
 * **A memory guides, it never authorises.** `LocalCiRunnerManager.start` calls
 * `inspect()` again immediately before it lends the machine and refuses if
 * capacity or the engine changed, so nothing restored here can reach a running
 * container. That is what makes remembering safe at all — the run gate does not
 * consult it, and `applyRememberedInspection` restores no lifecycle, no queued
 * run and no container name, asserted by test rather than trusted as a comment.
 *
 * **A memory of a different machine is refused, not adapted.** The record
 * carries a fingerprint of the host it describes (os, arch, CPU count, memory).
 * VS Code's `globalState` is per-machine today, but a profile that moves, a
 * remote extension host, or a future sync would otherwise hand one computer's
 * Docker verdict to another's — and "Docker is installed" about the wrong
 * machine is exactly the reassuring direction to be wrong in.
 *
 * **A memory expires.** Fourteen days, because a fortnight is long enough that
 * the machine may genuinely have changed and short enough that somebody who
 * uses the feature weekly is never asked twice. An expired record restores
 * nothing: the ladder asks again, which is the correct behaviour once the
 * answer is no longer worth believing.
 *
 * **Only the durable half is remembered.** `otherRunningContainers` and the
 * queue state are facts about a moment, not about a setup, and remembering them
 * would put a number on screen that was true once. `imagePresent` is remembered
 * but tied to the image it was observed for, since a changed `image` setting
 * makes the old answer a false pass on the new one.
 *
 * Pure, `vscode`-free, unit-tested.
 */

import type {
  LocalCiCapacity,
  LocalCiEngineSnapshot,
  LocalCiPrerequisitesSnapshot,
  LocalCiRunnerSnapshot,
} from './localCiRunner.js';

/** How long a remembered inspection is worth believing. */
export const LOCAL_CI_INSPECTION_MEMORY_DAYS = 14;

/** Storage key for the `globalState` record. Versioned, so a shape change cannot be misread. */
export const LOCAL_CI_INSPECTION_MEMORY_KEY = 'atlasmind.localCi.inspection.v1';

/** The machine a record describes, so a record about another one can be refused. */
export interface LocalCiMachineFingerprint {
  os: string;
  arch: string;
  cpuCount: number;
  memoryGb: number;
}

/**
 * The durable half of an inspection.
 *
 * Deliberately not `Partial<LocalCiRunnerSnapshot>`: a structural type would
 * quietly start carrying whatever the snapshot grows next, and the decision
 * about what may be remembered is the substance of this module.
 */
export interface LocalCiInspectionMemory {
  /** ISO timestamp of the probe this record came from. */
  observedAt: string;
  machine: LocalCiMachineFingerprint;
  /** The `image` setting in force when `imagePresent` was observed. */
  image: string;
  engine: {
    cliInstalled: boolean;
    available: boolean;
    desktopAvailable: boolean;
    os?: string;
    arch?: string;
    cpuCount?: number;
    memoryGb?: number;
    version?: string;
    imagePresent?: boolean;
  };
  prerequisites: {
    githubCliInstalled: boolean;
    githubAuthenticated: boolean;
  };
}

/** Why a stored record was not used. Named, because a silent drop is unexplainable. */
export type LocalCiInspectionMemoryRefusal =
  /** Nothing stored, or stored in a shape this build cannot read. */
  | 'absent'
  /** Older than `LOCAL_CI_INSPECTION_MEMORY_DAYS`. */
  | 'expired'
  /** Describes a machine that is not this one. */
  | 'other-machine';

export type LocalCiInspectionMemoryOutcome =
  | { restored: true; memory: LocalCiInspectionMemory; ageDays: number; imageMatches: boolean }
  | { restored: false; reason: LocalCiInspectionMemoryRefusal };

/**
 * Capture an inspection worth remembering, or refuse to.
 *
 * Returns `undefined` for a snapshot that was never actually probed. Storing an
 * un-probed snapshot would persist a set of `false` values indistinguishable
 * from a machine with nothing installed — the exact conflation
 * `prerequisites.inspection` exists to prevent, made durable.
 */
export function rememberLocalCiInspection(
  snapshot: Pick<LocalCiRunnerSnapshot, 'engine' | 'prerequisites' | 'host' | 'image'>,
  now: Date = new Date(),
): LocalCiInspectionMemory | undefined {
  if (snapshot.prerequisites.inspection !== 'inspected') {
    return undefined;
  }
  const engine: LocalCiInspectionMemory['engine'] = {
    cliInstalled: snapshot.engine.cliInstalled,
    available: snapshot.engine.available,
    desktopAvailable: snapshot.engine.desktopAvailable,
    ...(snapshot.engine.os ? { os: snapshot.engine.os } : {}),
    ...(snapshot.engine.arch ? { arch: snapshot.engine.arch } : {}),
    ...(typeof snapshot.engine.cpuCount === 'number' ? { cpuCount: snapshot.engine.cpuCount } : {}),
    ...(typeof snapshot.engine.memoryGb === 'number' ? { memoryGb: snapshot.engine.memoryGb } : {}),
    ...(snapshot.engine.version ? { version: snapshot.engine.version } : {}),
    ...(typeof snapshot.engine.imagePresent === 'boolean' ? { imagePresent: snapshot.engine.imagePresent } : {}),
  };
  return {
    observedAt: now.toISOString(),
    machine: fingerprintOf(snapshot.host),
    image: String(snapshot.image ?? ''),
    engine,
    prerequisites: {
      githubCliInstalled: snapshot.prerequisites.githubCliInstalled,
      githubAuthenticated: snapshot.prerequisites.githubAuthenticated,
    },
  };
}

/**
 * The fingerprint of a host capacity reading.
 *
 * Not exported: the fingerprint is an implementation detail of "is this record
 * about this machine", and a caller comparing two of them itself would be a
 * second answer to that question.
 */
function fingerprintOf(host: LocalCiCapacity): LocalCiMachineFingerprint {
  return {
    os: String(host.os ?? ''),
    arch: String(host.arch ?? ''),
    cpuCount: Number(host.cpuCount) || 0,
    memoryGb: Number(host.memoryGb) || 0,
  };
}

/**
 * Decide whether a stored record may be shown, and say why when it may not.
 *
 * Untrusted input by construction — `globalState` survives downgrades and hand
 * edits — so this never throws and never coerces a half-record into a whole
 * one. Anything that does not parse is `absent`, which is the same answer as
 * never having looked and therefore the safe one.
 */
export function restoreLocalCiInspection(
  stored: unknown,
  host: LocalCiCapacity,
  image: string,
  now: Date = new Date(),
): LocalCiInspectionMemoryOutcome {
  const memory = parseMemory(stored);
  if (!memory) {
    return { restored: false, reason: 'absent' };
  }
  const observed = Date.parse(memory.observedAt);
  if (!Number.isFinite(observed)) {
    return { restored: false, reason: 'absent' };
  }
  const ageMs = now.getTime() - observed;
  // A record from the future is a clock change, not evidence. Treated as fresh
  // rather than expired: the alternative is asking somebody to re-inspect
  // because their machine crossed a daylight-saving boundary.
  const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
  if (ageDays > LOCAL_CI_INSPECTION_MEMORY_DAYS) {
    return { restored: false, reason: 'expired' };
  }
  if (!sameMachine(memory.machine, fingerprintOf(host))) {
    return { restored: false, reason: 'other-machine' };
  }
  return {
    restored: true,
    memory,
    ageDays,
    imageMatches: memory.image === String(image ?? ''),
  };
}

/**
 * Fold a restored observation into a snapshot that has not been probed yet.
 *
 * Never overwrites a live reading: if this session has already inspected, the
 * live answer wins outright, because a memory is by definition the older of the
 * two. `imagePresent` is dropped when the `image` setting has changed since the
 * observation — the old answer is about a different image, and reporting it
 * would say the runner software is present when nothing has checked for it.
 */
export function applyRememberedInspection(
  snapshot: LocalCiRunnerSnapshot,
  outcome: LocalCiInspectionMemoryOutcome,
): LocalCiRunnerSnapshot {
  if (!outcome.restored || snapshot.prerequisites.inspection === 'inspected') {
    return snapshot;
  }
  const { memory } = outcome;
  const engine: LocalCiEngineSnapshot = {
    ...snapshot.engine,
    cliInstalled: memory.engine.cliInstalled,
    available: memory.engine.available,
    desktopAvailable: memory.engine.desktopAvailable,
    ...(memory.engine.os ? { os: memory.engine.os } : {}),
    ...(memory.engine.arch ? { arch: memory.engine.arch } : {}),
    ...(typeof memory.engine.cpuCount === 'number' ? { cpuCount: memory.engine.cpuCount } : {}),
    ...(typeof memory.engine.memoryGb === 'number' ? { memoryGb: memory.engine.memoryGb } : {}),
    ...(memory.engine.version ? { version: memory.engine.version } : {}),
    ...(outcome.imageMatches && typeof memory.engine.imagePresent === 'boolean'
      ? { imagePresent: memory.engine.imagePresent }
      : { imagePresent: undefined }),
  };
  const prerequisites: LocalCiPrerequisitesSnapshot = {
    inspection: 'inspected',
    githubCliInstalled: memory.prerequisites.githubCliInstalled,
    githubAuthenticated: memory.prerequisites.githubAuthenticated,
  };
  return { ...snapshot, engine, prerequisites };
}

/**
 * The sentence a surface puts next to a restored reading.
 *
 * Exported so the webview, the `/localci` walkthrough and the `/setup` index
 * describe the same record the same way. Three surfaces phrasing "remembered"
 * differently is how one of them ends up phrasing it as "checked".
 */
export function describeRememberedInspection(outcome: LocalCiInspectionMemoryOutcome): string {
  if (!outcome.restored) {
    return outcome.reason === 'expired'
      ? `The last inspection of this computer is more than ${LOCAL_CI_INSPECTION_MEMORY_DAYS} days old, so AtlasMind is asking again rather than believing it.`
      : outcome.reason === 'other-machine'
        ? 'The stored inspection describes a different computer, so it was not used.'
        : 'This computer has not been inspected yet.';
  }
  const when = outcome.ageDays === 0 ? 'earlier today'
    : outcome.ageDays === 1 ? 'yesterday'
      : `${outcome.ageDays} days ago`;
  return `Remembered from the inspection run ${when}. AtlasMind re-checks this computer immediately before it lends it to a job.`;
}

function sameMachine(left: LocalCiMachineFingerprint, right: LocalCiMachineFingerprint): boolean {
  return left.os === right.os
    && left.arch === right.arch
    && left.cpuCount === right.cpuCount
    && left.memoryGb === right.memoryGb;
}

function parseMemory(stored: unknown): LocalCiInspectionMemory | undefined {
  if (!stored || typeof stored !== 'object') {
    return undefined;
  }
  const record = stored as Record<string, unknown>;
  const machine = record.machine as Record<string, unknown> | undefined;
  const engine = record.engine as Record<string, unknown> | undefined;
  const prerequisites = record.prerequisites as Record<string, unknown> | undefined;
  if (typeof record.observedAt !== 'string' || !machine || !engine || !prerequisites) {
    return undefined;
  }
  return {
    observedAt: record.observedAt,
    machine: {
      os: typeof machine.os === 'string' ? machine.os : '',
      arch: typeof machine.arch === 'string' ? machine.arch : '',
      cpuCount: typeof machine.cpuCount === 'number' ? machine.cpuCount : 0,
      memoryGb: typeof machine.memoryGb === 'number' ? machine.memoryGb : 0,
    },
    image: typeof record.image === 'string' ? record.image : '',
    engine: {
      cliInstalled: engine.cliInstalled === true,
      available: engine.available === true,
      desktopAvailable: engine.desktopAvailable === true,
      ...(typeof engine.os === 'string' ? { os: engine.os } : {}),
      ...(typeof engine.arch === 'string' ? { arch: engine.arch } : {}),
      ...(typeof engine.cpuCount === 'number' ? { cpuCount: engine.cpuCount } : {}),
      ...(typeof engine.memoryGb === 'number' ? { memoryGb: engine.memoryGb } : {}),
      ...(typeof engine.version === 'string' ? { version: engine.version } : {}),
      ...(typeof engine.imagePresent === 'boolean' ? { imagePresent: engine.imagePresent } : {}),
    },
    prerequisites: {
      githubCliInstalled: prerequisites.githubCliInstalled === true,
      githubAuthenticated: prerequisites.githubAuthenticated === true,
    },
  };
}

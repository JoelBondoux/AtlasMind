/**
 * Read-only distance from a declared Git upstream.
 *
 * This module owns the Git meaning of divergence and nothing domain-specific.
 * It receives a resolved component root and an injected argv runner, issues
 * only bounded read commands, and turns their output into deterministic facts.
 * Callers own presentation and persistence of snapshots.
 */

import {
  isSafeGitRef,
  isSafeGitRemoteName,
  type ComponentUpstream,
  type ProjectComponent,
} from './projectComposition.js';

export const UPSTREAM_DIVERGENCE_MAX_EVIDENCE_CHARS = 4 * 1024 * 1024;
export const UPSTREAM_DIVERGENCE_MAX_FILES_PER_SIDE = 50_000;
export const UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS = 250;

export type UpstreamDivergenceGitRunner = (
  repositoryRoot: string,
  args: readonly string[],
) => Promise<string>;

export interface UpstreamDivergenceSnapshot {
  readonly componentId: string;
  readonly upstream: Readonly<Pick<ComponentUpstream, 'remote' | 'ref'>>;
  readonly observedAt: string;
  readonly commitsAhead: number;
  readonly commitsBehind: number;
  readonly filesDiverged: number;
  readonly conflictPronePathCount: number;
}

export type UpstreamDivergenceTrendStatus =
  | 'first-look'
  | 'unchanged'
  | 'growing'
  | 'shrinking'
  | 'mixed';

export interface UpstreamDivergenceTrend {
  readonly status: UpstreamDivergenceTrendStatus;
  readonly since?: string;
  readonly firstLookReason?:
    | 'no-snapshot'
    | 'unreadable-snapshot'
    | 'different-component'
    | 'different-upstream'
    | 'clock-moved-backwards';
  readonly deltas?: Readonly<{
    commitsAhead: number;
    commitsBehind: number;
    filesDiverged: number;
    conflictPronePathCount: number;
  }>;
}

interface UpstreamDivergenceReportBase {
  readonly componentId: string;
  readonly componentLabel: string;
  readonly upstream?: Readonly<Pick<ComponentUpstream, 'remote' | 'ref'>>;
}

export interface AvailableUpstreamDivergenceReport extends UpstreamDivergenceReportBase {
  readonly status: 'available';
  readonly upstream: Readonly<Pick<ComponentUpstream, 'remote' | 'ref'>>;
  readonly observedAt: string;
  readonly mergeBase: string;
  readonly commitsAhead: number;
  readonly commitsBehind: number;
  /** Unique paths changed on either side since the merge base. */
  readonly filesDiverged: number;
  /** A bounded display list; `filesDiverged` remains the exact count. */
  readonly divergedPaths: readonly string[];
  /** Paths changed on both sides since the merge base. These are candidates, not predicted conflicts. */
  readonly conflictPronePathCount: number;
  readonly conflictPronePaths: readonly string[];
  readonly pathsTruncated: boolean;
  readonly trend: UpstreamDivergenceTrend;
}

export interface UnavailableUpstreamDivergenceReport extends UpstreamDivergenceReportBase {
  readonly status: 'not-declared' | 'not-visible' | 'unreadable';
  readonly reason: string;
}

export type UpstreamDivergenceReport =
  | AvailableUpstreamDivergenceReport
  | UnavailableUpstreamDivergenceReport;

export interface CollectUpstreamDivergenceInput {
  readonly component: Pick<ProjectComponent, 'id' | 'label' | 'vcs' | 'upstream'>;
  /** Resolved by WorkspaceScope. Absence is a visibility gap, never an empty repository. */
  readonly repositoryRoot?: string;
  readonly observedAt: string;
  readonly previous?: UpstreamDivergenceSnapshot;
}

interface ParsedPathEvidence {
  readonly paths: readonly string[];
}

/**
 * Gather one component's upstream distance without fetching or changing refs.
 *
 * The runner receives argv arrays, never a shell command. A missing ref, an
 * unreadable repository, malformed Git output, or evidence over the declared
 * bounds produces `unreadable`; none is converted into a zero.
 */
export async function collectUpstreamDivergence(
  input: CollectUpstreamDivergenceInput,
  runGit: UpstreamDivergenceGitRunner,
): Promise<UpstreamDivergenceReport> {
  const base = {
    componentId: input.component.id,
    componentLabel: input.component.label,
  };

  if (input.component.vcs !== 'git') {
    return {
      ...base,
      status: 'not-visible',
      reason: `Version control is ${input.component.vcs}; this Git-only reading cannot see it.`,
    };
  }
  if (!input.component.upstream) {
    return {
      ...base,
      status: 'not-declared',
      reason: 'No upstream remote and ref are declared for this component.',
    };
  }

  const upstream = copySafeUpstream(input.component.upstream);
  if (!upstream) {
    return {
      ...base,
      status: 'unreadable',
      reason: 'The declared upstream could not be interpreted safely.',
    };
  }
  if (typeof input.repositoryRoot !== 'string' || input.repositoryRoot.trim().length === 0) {
    return {
      ...base,
      upstream,
      status: 'not-visible',
      reason: 'The component location did not resolve to a readable Git repository.',
    };
  }
  if (!isUsableTimestamp(input.observedAt)) {
    return {
      ...base,
      upstream,
      status: 'unreadable',
      reason: 'The observation time was not a valid timestamp.',
    };
  }

  const targetRef = `refs/remotes/${upstream.remote}/${upstream.ref}`;
  try {
    const [mergeBaseOutput, countsOutput] = await Promise.all([
      runGit(input.repositoryRoot, ['merge-base', '--', 'HEAD', targetRef]),
      runGit(input.repositoryRoot, ['rev-list', '--left-right', '--count', `HEAD...${targetRef}`]),
    ]);
    const mergeBase = parseMergeBase(mergeBaseOutput);
    const counts = parseCommitCounts(countsOutput);
    if (!mergeBase || !counts) {
      return unreadable(base, upstream);
    }

    const [localOutput, upstreamOutput] = await Promise.all([
      runGit(input.repositoryRoot, pathDiffArgs(mergeBase, 'HEAD')),
      runGit(input.repositoryRoot, pathDiffArgs(mergeBase, targetRef)),
    ]);
    const local = parsePathEvidence(localOutput);
    const remote = parsePathEvidence(upstreamOutput);
    if (!local || !remote) {
      return unreadable(base, upstream);
    }

    const localSet = new Set(local.paths);
    const remoteSet = new Set(remote.paths);
    const divergedPaths = [...new Set([...localSet, ...remoteSet])].sort(comparePaths);
    const conflictPronePaths = [...localSet].filter(candidate => remoteSet.has(candidate)).sort(comparePaths);
    const current: UpstreamDivergenceSnapshot = {
      componentId: input.component.id,
      upstream,
      observedAt: input.observedAt,
      commitsAhead: counts.commitsAhead,
      commitsBehind: counts.commitsBehind,
      filesDiverged: divergedPaths.length,
      conflictPronePathCount: conflictPronePaths.length,
    };

    return {
      ...base,
      status: 'available',
      upstream,
      observedAt: input.observedAt,
      mergeBase,
      commitsAhead: current.commitsAhead,
      commitsBehind: current.commitsBehind,
      filesDiverged: current.filesDiverged,
      divergedPaths: divergedPaths.slice(0, UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS),
      conflictPronePathCount: current.conflictPronePathCount,
      conflictPronePaths: conflictPronePaths.slice(0, UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS),
      pathsTruncated: divergedPaths.length > UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS
        || conflictPronePaths.length > UPSTREAM_DIVERGENCE_MAX_REPORTED_PATHS,
      trend: deriveUpstreamDivergenceTrend(input.previous, current),
    };
  } catch {
    return unreadable(base, upstream);
  }
}

/** A defensive copy suitable for storing as the next comparison baseline. */
export function takeUpstreamDivergenceSnapshot(
  report: UpstreamDivergenceReport,
): UpstreamDivergenceSnapshot | undefined {
  if (report.status !== 'available') {
    return undefined;
  }
  return {
    componentId: report.componentId,
    upstream: { ...report.upstream },
    observedAt: report.observedAt,
    commitsAhead: report.commitsAhead,
    commitsBehind: report.commitsBehind,
    filesDiverged: report.filesDiverged,
    conflictPronePathCount: report.conflictPronePathCount,
  };
}

/** Compare like-for-like readings. Incomparable evidence starts a new baseline. */
export function deriveUpstreamDivergenceTrend(
  previous: UpstreamDivergenceSnapshot | undefined,
  current: UpstreamDivergenceSnapshot,
): UpstreamDivergenceTrend {
  if (!isValidSnapshot(current)) {
    return { status: 'first-look', firstLookReason: 'unreadable-snapshot' };
  }
  if (!previous) {
    return { status: 'first-look', firstLookReason: 'no-snapshot' };
  }
  if (!isValidSnapshot(previous)) {
    return { status: 'first-look', firstLookReason: 'unreadable-snapshot' };
  }
  if (previous.componentId !== current.componentId) {
    return { status: 'first-look', firstLookReason: 'different-component' };
  }
  if (previous.upstream.remote !== current.upstream.remote || previous.upstream.ref !== current.upstream.ref) {
    return { status: 'first-look', firstLookReason: 'different-upstream' };
  }
  if (Date.parse(current.observedAt) < Date.parse(previous.observedAt)) {
    return { status: 'first-look', firstLookReason: 'clock-moved-backwards' };
  }

  const deltas = {
    commitsAhead: current.commitsAhead - previous.commitsAhead,
    commitsBehind: current.commitsBehind - previous.commitsBehind,
    filesDiverged: current.filesDiverged - previous.filesDiverged,
    conflictPronePathCount: current.conflictPronePathCount - previous.conflictPronePathCount,
  };
  const movements = Object.values(deltas);
  const growing = movements.some(value => value > 0);
  const shrinking = movements.some(value => value < 0);
  const status: UpstreamDivergenceTrendStatus = growing && shrinking
    ? 'mixed'
    : growing
      ? 'growing'
      : shrinking
        ? 'shrinking'
        : 'unchanged';
  return { status, since: previous.observedAt, deltas };
}

function pathDiffArgs(mergeBase: string, ref: string): readonly string[] {
  return [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--no-textconv',
    mergeBase,
    ref,
    '--',
  ];
}

function parseMergeBase(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 128) {
    return undefined;
  }
  const candidate = value.trim();
  return /^[0-9a-f]{40,64}$/iu.test(candidate) ? candidate.toLowerCase() : undefined;
}

function parseCommitCounts(value: unknown): { commitsAhead: number; commitsBehind: number } | undefined {
  if (typeof value !== 'string' || value.length > 128) {
    return undefined;
  }
  const match = /^(\d+)\s+(\d+)$/u.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const commitsAhead = Number(match[1]);
  const commitsBehind = Number(match[2]);
  return isSafeCount(commitsAhead) && isSafeCount(commitsBehind)
    ? { commitsAhead, commitsBehind }
    : undefined;
}

function parsePathEvidence(value: unknown): ParsedPathEvidence | undefined {
  if (typeof value !== 'string' || value.length > UPSTREAM_DIVERGENCE_MAX_EVIDENCE_CHARS) {
    return undefined;
  }
  if (value.length === 0) {
    return { paths: [] };
  }
  if (!value.endsWith('\0')) {
    return undefined;
  }
  const tokens = value.split('\0');
  tokens.pop();
  if (tokens.length > UPSTREAM_DIVERGENCE_MAX_FILES_PER_SIDE || tokens.some(path => !isSafeGitPath(path))) {
    return undefined;
  }
  return { paths: [...new Set(tokens)] };
}

function isSafeGitPath(value: string): boolean {
  return value.length > 0
    && value.length <= 4096
    && !value.startsWith('/')
    && !/^[a-z]:[\\/]/iu.test(value)
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !value.split('/').includes('..');
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUsableTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isValidSnapshot(value: unknown): value is UpstreamDivergenceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<UpstreamDivergenceSnapshot>;
  return typeof candidate.componentId === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(candidate.componentId)
    && isSafeGitRemoteName(candidate.upstream?.remote)
    && isSafeGitRef(candidate.upstream?.ref)
    && isUsableTimestamp(candidate.observedAt)
    && isSafeCount(candidate.commitsAhead)
    && isSafeCount(candidate.commitsBehind)
    && isSafeCount(candidate.filesDiverged)
    && isSafeCount(candidate.conflictPronePathCount)
    && candidate.conflictPronePathCount <= candidate.filesDiverged;
}

function copySafeUpstream(value: ComponentUpstream): Pick<ComponentUpstream, 'remote' | 'ref'> | undefined {
  return isSafeGitRemoteName(value.remote) && isSafeGitRef(value.ref)
    ? { remote: value.remote, ref: value.ref }
    : undefined;
}

function unreadable(
  base: Pick<UpstreamDivergenceReportBase, 'componentId' | 'componentLabel'>,
  upstream: Pick<ComponentUpstream, 'remote' | 'ref'>,
): UnavailableUpstreamDivergenceReport {
  return {
    ...base,
    upstream,
    status: 'unreadable',
    reason: 'Git could not produce a complete, bounded upstream-divergence reading.',
  };
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

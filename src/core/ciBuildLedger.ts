/**
 * One list of builds, whatever ran them.
 *
 * The Pipeline page could show GitHub's runs and, separately, whether a local
 * container was currently alive. Nothing put those in one place, so "what has
 * this project run lately" had no answer — which is the question a build page
 * exists to answer, and the reason Buildkite's builds list is the first thing
 * it shows you.
 *
 * Four rules carry the semantics, and the first is the one that keeps the page
 * honest rather than merely useful.
 *
 * **How closely a build was watched is recorded, and a build nobody watched
 * never reports a verdict.** AtlasMind types the direct-local commands into a
 * terminal and deliberately does not read that terminal — so it knows a run was
 * *started* and cannot know how it ended. That is `unobserved`, and
 * `recordCiBuild` forces its status to `unknown` no matter what a caller
 * passes. A green tick beside a run nobody observed would be the worst thing
 * this page could produce: an invented pass, on the surface people would check
 * before shipping.
 *
 * **Hosted progress is polled, and says so.** The GitHub CLI offers no push
 * channel, so a hosted build's liveness is a sequence of requests with backoff,
 * not a stream. Granularity of several seconds is fine; presenting it as a
 * stream would not be, so `observation: 'polled'` travels with the record and
 * `HOSTED_POLL_NOTE` is rendered beside it.
 *
 * **The ledger holds no log output.** `CiBuildRecord` has no field that could
 * carry one — the enforcement is the type, as it is in `workflowAuditRecord` —
 * and a `pointer` says where the detail actually lives instead. Logs are large,
 * frequently contain secrets, and belong in the output channel and the terminal
 * that already have them.
 *
 * **Storage is per-developer.** `CI_BUILD_LEDGER_NOTE` says so in the module,
 * because the obvious place to put this is `project_memory/`, which is
 * git-tracked — and a shared build list would mean "what has *anybody* run",
 * conflict between two people on the same afternoon, and local run history
 * committed into the repository.
 *
 * Pure, clock-injected, unit-tested.
 */

import type { CiRouteEvidence, CiRouteId } from './ciRoutes.js';

/**
 * Where a caller must persist local build records.
 *
 * Stated here rather than at the call site so it travels with the module: this
 * belongs in `workspaceState`, never in the git-tracked SSOT folder. The same
 * reasoning as `OBSERVED_SNAPSHOT_NOTE` in `observedDelta`.
 */
export const CI_BUILD_LEDGER_NOTE =
  'Local build records are per-developer and belong in workspaceState. project_memory/ is committed, so a '
  + 'shared ledger would report what anybody ran, conflict between two people on the same day, and put local '
  + 'run history into the repository.';

/** Rendered beside hosted builds, because the difference is real. */
export const HOSTED_POLL_NOTE =
  'GitHub offers no push channel through its CLI, so hosted progress is checked at intervals rather than '
  + 'streamed. Expect a few seconds of lag.';

export type CiBuildObservation =
  /** AtlasMind is reading the process output as it happens. */
  | 'live'
  /** Fetched at intervals from a remote system. */
  | 'polled'
  /** AtlasMind started it and cannot see how it ended. */
  | 'unobserved';

export type CiBuildStatus = 'running' | 'passed' | 'failed' | 'cancelled' | 'unknown';

export type CiBuildSource = 'local' | 'github';

/** Where the detail lives. Never the detail itself. */
export interface CiBuildPointer {
  kind: 'output-channel' | 'terminal' | 'github-run';
  label: string;
  /** A run id for GitHub; absent for the others. */
  id?: string;
}

export interface CiBuildRecord {
  /** Unique within its source. */
  id: string;
  source: CiBuildSource;
  routeId: CiRouteId;
  routeLabel: string;
  /** Carried on the record so history stays readable after a route changes. */
  evidence: CiRouteEvidence;
  observation: CiBuildObservation;
  status: CiBuildStatus;
  title: string;
  startedAt: string;
  endedAt?: string;
  commitSha?: string;
  branch?: string;
  pointer?: CiBuildPointer;
}

export interface RecordCiBuildInput {
  id: string;
  source: CiBuildSource;
  routeId: CiRouteId;
  routeLabel: string;
  evidence: CiRouteEvidence;
  observation: CiBuildObservation;
  status: CiBuildStatus;
  title: string;
  startedAt: string;
  endedAt?: string;
  commitSha?: string;
  branch?: string;
  pointer?: CiBuildPointer;
}

/**
 * Build a record, forcing the honesty rule rather than trusting the caller.
 *
 * An `unobserved` build is `unknown`, always. A caller with an optimistic view
 * of its own terminal cannot record a pass, and a later refactor cannot
 * introduce one — the rule is here, where a test can walk it, rather than in
 * the handler that happens to construct records today.
 */
export function recordCiBuild(input: RecordCiBuildInput): CiBuildRecord {
  const status: CiBuildStatus = input.observation === 'unobserved' ? 'unknown' : input.status;
  return {
    id: input.id,
    source: input.source,
    routeId: input.routeId,
    routeLabel: input.routeLabel,
    evidence: input.evidence,
    observation: input.observation,
    status,
    title: input.title.slice(0, 200),
    startedAt: input.startedAt,
    ...(input.endedAt ? { endedAt: input.endedAt } : {}),
    ...(input.commitSha ? { commitSha: input.commitSha.slice(0, 40) } : {}),
    ...(input.branch ? { branch: input.branch.slice(0, 160) } : {}),
    ...(input.pointer ? { pointer: { ...input.pointer } } : {}),
  };
}

/** How many local records are kept. Older ones fall off the end. */
export const CI_BUILD_LEDGER_CAP = 50;

/**
 * Add or update a record in the stored local list.
 *
 * Upsert by id, because a live build is recorded when it starts and updated
 * when it ends: appending instead would show the same run twice, once forever
 * `running`.
 */
export function upsertCiBuild(
  existing: readonly CiBuildRecord[],
  record: CiBuildRecord,
  cap = CI_BUILD_LEDGER_CAP,
): CiBuildRecord[] {
  const without = existing.filter(entry => !(entry.id === record.id && entry.source === record.source));
  return [record, ...without]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, Math.max(1, cap));
}

/** Coerce a stored list back into records, dropping anything unreadable. */
export function sanitizeCiBuildLedger(value: unknown): CiBuildRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: CiBuildRecord[] = [];
  for (const entry of value.slice(0, CI_BUILD_LEDGER_CAP * 2)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as Partial<CiBuildRecord>;
    if (typeof raw.id !== 'string' || !raw.id
      || typeof raw.startedAt !== 'string' || !raw.startedAt
      || typeof raw.routeId !== 'string'
      || typeof raw.title !== 'string') {
      continue;
    }
    // Re-applies the honesty rule on read, so a hand-edited or older stored
    // record cannot reintroduce a verdict for a build nobody watched.
    out.push(recordCiBuild({
      id: raw.id,
      source: raw.source === 'github' ? 'github' : 'local',
      routeId: raw.routeId as CiRouteId,
      routeLabel: typeof raw.routeLabel === 'string' ? raw.routeLabel : raw.routeId,
      evidence: (raw.evidence ?? 'this-machine') as CiRouteEvidence,
      observation: raw.observation === 'live' || raw.observation === 'polled' ? raw.observation : 'unobserved',
      status: isBuildStatus(raw.status) ? raw.status : 'unknown',
      title: raw.title,
      startedAt: raw.startedAt,
      ...(typeof raw.endedAt === 'string' ? { endedAt: raw.endedAt } : {}),
      ...(typeof raw.commitSha === 'string' ? { commitSha: raw.commitSha } : {}),
      ...(typeof raw.branch === 'string' ? { branch: raw.branch } : {}),
      ...(raw.pointer && typeof raw.pointer === 'object' ? { pointer: raw.pointer } : {}),
    }));
  }
  return out.slice(0, CI_BUILD_LEDGER_CAP);
}

function isBuildStatus(value: unknown): value is CiBuildStatus {
  return value === 'running' || value === 'passed' || value === 'failed'
    || value === 'cancelled' || value === 'unknown';
}

/** A GitHub run, in the shape the dashboard already fetches. */
export interface GithubRunInput {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  conclusion: string;
  status: string;
  headSha: string;
  headBranch?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Map GitHub's own vocabulary onto the ledger's.
 *
 * `status` and `conclusion` are separate fields there and only one of them is
 * meaningful at a time: a run in progress has no conclusion, and treating an
 * empty conclusion as a failure — or as a pass — is the classic misreading. An
 * unrecognised pairing is `unknown` rather than guessed.
 */
export function githubRunToBuild(run: GithubRunInput): CiBuildRecord {
  const status = String(run.status ?? '').toLowerCase();
  const conclusion = String(run.conclusion ?? '').toLowerCase();
  const resolved: CiBuildStatus = status === 'in_progress' || status === 'queued' || status === 'pending' || status === 'waiting'
    ? 'running'
    : conclusion === 'success' ? 'passed'
      : conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' ? 'failed'
        : conclusion === 'cancelled' ? 'cancelled'
          : 'unknown';
  return recordCiBuild({
    id: String(run.databaseId),
    source: 'github',
    routeId: 'github-hosted',
    routeLabel: 'GitHub-hosted runners',
    evidence: 'declared-matrix',
    observation: 'polled',
    status: resolved,
    title: run.displayTitle || run.workflowName || `Run ${run.databaseId}`,
    startedAt: run.createdAt,
    ...(resolved === 'running' ? {} : { endedAt: run.updatedAt }),
    ...(run.headSha ? { commitSha: run.headSha } : {}),
    ...(run.headBranch ? { branch: run.headBranch } : {}),
    pointer: { kind: 'github-run', label: `Run #${run.databaseId}`, id: String(run.databaseId) },
  });
}

export interface CiBuildLedgerView {
  builds: CiBuildRecord[];
  /** True while anything is still going, so the caller knows to keep polling. */
  hasRunning: boolean;
  /** Builds AtlasMind started but cannot report a verdict for. */
  unobservedCount: number;
  /** Absent GitHub history is *not looked*, never *nothing ran*. */
  githubLoaded: boolean;
}

/**
 * Merge stored local records with freshly fetched GitHub runs.
 *
 * `githubRuns` being `undefined` means nobody has fetched them, and that is
 * carried through as `githubLoaded: false` rather than becoming an empty list —
 * a builds page that shows nothing because nothing was fetched, next to one
 * that shows nothing because nothing ran, would be two very different facts
 * rendered identically.
 */
export function buildCiLedgerView(
  local: readonly CiBuildRecord[],
  githubRuns: readonly GithubRunInput[] | undefined,
  cap = CI_BUILD_LEDGER_CAP,
): CiBuildLedgerView {
  const hosted = (githubRuns ?? []).map(githubRunToBuild);
  const merged = [...local, ...hosted]
    // Newest first; the id breaks ties so two builds started in the same second
    // cannot shuffle between renders.
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))
    .slice(0, Math.max(1, cap));
  return {
    builds: merged,
    hasRunning: merged.some(build => build.status === 'running'),
    unobservedCount: merged.filter(build => build.observation === 'unobserved').length,
    githubLoaded: githubRuns !== undefined,
  };
}

/**
 * How long to wait before checking a hosted build again.
 *
 * Backoff, because a build takes minutes and a fixed one-second poll would
 * spend a rate-limited API for no extra information. Returns `undefined` when
 * nothing is running, which is what stops the loop — a poller that keeps going
 * against a finished build is a background process nobody asked for.
 */
export function nextCiPollDelayMs(attempt: number, hasRunning: boolean): number | undefined {
  if (!hasRunning) {
    return undefined;
  }
  const step = Math.max(0, Math.floor(attempt));
  return Math.min(30_000, 4_000 * (2 ** Math.min(step, 3)));
}

/** One line describing what this record does and does not establish. */
export function describeCiBuild(build: CiBuildRecord): string {
  if (build.observation === 'unobserved') {
    return 'AtlasMind typed these commands into your terminal and does not read it, so it cannot report how they ended.';
  }
  if (build.status === 'running') {
    return build.observation === 'polled'
      ? 'Running. Progress is checked at intervals, not streamed.'
      : 'Running. AtlasMind is reading the output live.';
  }
  if (build.status === 'unknown') {
    return 'Finished, but AtlasMind could not read a verdict for it.';
  }
  return `${build.status === 'passed' ? 'Passed' : build.status === 'failed' ? 'Failed' : 'Cancelled'} — proving ${build.evidence.replace(/-/g, ' ')}.`;
}

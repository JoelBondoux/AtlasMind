/**
 * What moved since you last looked.
 *
 * Every other surface in AtlasMind answers *what is the state?* — the score, the
 * gates, the counts, the gaps. None of them answer *what changed?*, and for
 * somebody working alone or in a small team that is the more useful question by
 * a wide margin: the state is mostly the same every day, so a surface that only
 * reports state is one you learn to skim. A delta is the part worth reading.
 *
 * (`ssotDelta.ts` is a different thing despite the name — it compares memory
 * against code to find drift. This compares the project against its own past.)
 *
 * Five properties are enforced here rather than left to the caller, because each
 * one is a way a delta can lie:
 *
 * 1. **No baseline is a first look, not a change.** With no prior snapshot every
 *    field differs from nothing, and rendering that as "18 things changed" on a
 *    fresh install would be false at the exact moment somebody is deciding
 *    whether to trust the surface.
 *
 * 2. **Unknown → known is not zero → n.** If `gh` was missing last time, the
 *    open-issue count was `undefined`, and reporting "0 → 12 issues" invents a
 *    twelve-issue spike that never happened. It is reported as *now readable*.
 *
 * 3. **Known → unknown is news.** The opposite case is not a gap to skip: a
 *    count that used to read and now does not usually means `gh` logged out or
 *    a file was deleted, and that explains everything else going quiet.
 *
 * 4. **A different repository is not a comparison.** A snapshot taken in one
 *    repo diffed against another produces confident nonsense, so a changed slug
 *    discards the baseline instead of using it.
 *
 * 5. **It never reports back what you just did.** Your current branch and
 *    whether your tree is dirty are *your position*, not the project's
 *    movement. A delta that tells you that you edited a file trains you to
 *    ignore deltas.
 *
 * Pure and clock-free: `now` is passed in. The caller owns storage, and it must
 * be per-developer storage — see `OBSERVED_SNAPSHOT_NOTE`.
 */

import type { WorkflowObservedState } from './workflowCurriculum.js';

/**
 * Where a snapshot may be kept, stated in the module so it cannot be got wrong
 * quietly.
 *
 * `project_memory/` is git-tracked on purpose, which makes it the wrong home for
 * this: a committed watermark would mean "when did *anybody* last look", every
 * glance at the dashboard would be an uncommitted change, and two developers
 * looking on the same day would conflict. It belongs in per-developer editor
 * storage — `workspaceState`, alongside the delivery review's `reviewedAt`.
 */
export const OBSERVED_SNAPSHOT_NOTE =
  'Per-developer only. Never written to project_memory/, which is git-tracked.';

/** How a field moved. */
export type ObservedChangeKind =
  /** Moved in the direction you want. */
  | 'improved'
  /** Moved the wrong way. */
  | 'worsened'
  /** Moved, with no better or worse about it. */
  | 'moved'
  /** Was not readable before and is now. Not a change in the project. */
  | 'now-known'
  /** Was readable before and is not now. Usually a tool, not the project. */
  | 'no-longer-readable';

/** Whether a higher number is better, worse, or neither. */
type Polarity = 'higher' | 'lower' | 'neither';

interface FieldRule {
  readonly label: string;
  readonly polarity: Polarity;
  /**
   * Ranking weight. Consequence, not magnitude: CI turning red matters more
   * than four more open issues, however large the four looks as a percentage.
   */
  readonly significance: number;
  /** Plural noun for count phrasing — "3 more open issues". */
  readonly noun?: string;
}

/**
 * The fields a change is worth reporting for, and how to read a movement in
 * each. Declaration order is stage order, and is the tie-breaker for equal
 * significance so the list is stable between renders.
 *
 * Deliberately absent: `currentBranch`, `workingTreeClean`, `ghInstalled` and
 * `hasChangelog`. The first two are property 5 — your own position, which you
 * do not need told. The last two are implied by fields already here
 * (`ghAuthenticated`, `changelogHasCurrentVersion`), and a delta that reports
 * one movement twice reads as two things happening.
 */
const FIELD_RULES: Partial<Record<keyof WorkflowObservedState, FieldRule>> = {
  // Stage 5 first by weight, not by stage: a red pipeline is the thing you
  // most need to know before anything else on the page.
  ciStatus: { label: 'CI on the current commit', polarity: 'neither', significance: 100 },
  ghAuthenticated: { label: 'GitHub sign-in', polarity: 'higher', significance: 90 },
  protectedBranches: { label: 'Protected branches', polarity: 'higher', significance: 85, noun: 'protected branches' },
  currentVersion: { label: 'Version', polarity: 'neither', significance: 70 },
  workflowEnabled: { label: 'Workflow master switch', polarity: 'neither', significance: 65 },
  integrationBranch: { label: 'Integration branch', polarity: 'neither', significance: 60 },
  openIssueCount: { label: 'Open issues', polarity: 'lower', significance: 50, noun: 'open issues' },
  staleIssueCount: { label: 'Stale issues', polarity: 'lower', significance: 45, noun: 'stale issues' },
  openDependencyPrCount: {
    label: 'Open dependency updates',
    polarity: 'lower',
    significance: 45,
    noun: 'open dependency updates',
  },
  commitsSinceLastTag: { label: 'Commits since the last tag', polarity: 'neither', significance: 40, noun: 'commits' },
  hasTestReport: { label: 'Test report', polarity: 'higher', significance: 40 },
  changelogHasCurrentVersion: { label: 'Changelog entry for this version', polarity: 'higher', significance: 38 },
  staleDocumentCount: { label: 'Stale documents', polarity: 'lower', significance: 35, noun: 'stale documents' },
  nonConformingBranchCount: {
    label: 'Branches off convention',
    polarity: 'lower',
    significance: 30,
    noun: 'branches off convention',
  },
  enabledTestingMethodologyIds: {
    label: 'Enabled testing protocols',
    polarity: 'higher',
    significance: 28,
    noun: 'testing protocols',
  },
  requiredApprovers: { label: 'Required approvers', polarity: 'neither', significance: 25 },
  ciWorkflowCount: { label: 'CI workflows', polarity: 'higher', significance: 22, noun: 'CI workflows' },
  workflowConfigPresent: { label: 'Committed workflow file', polarity: 'higher', significance: 20 },
  hasDebtRegister: { label: 'Tech-debt register', polarity: 'higher', significance: 18 },
  hasPullRequestTemplate: { label: 'Pull request template', polarity: 'higher', significance: 15 },
  hasCodeOwners: { label: 'CODEOWNERS', polarity: 'higher', significance: 15 },
  hasIssueTemplates: { label: 'Issue templates', polarity: 'higher', significance: 12 },
  declaredLabelCount: { label: 'Declared labels', polarity: 'neither', significance: 10, noun: 'declared labels' },
  profile: { label: 'Workflow profile', polarity: 'neither', significance: 10 },
};

/** The fields a delta compares, in ranking order. Exported for tests. */
export const DELTA_TRACKED_FIELDS = Object.keys(FIELD_RULES) as Array<keyof WorkflowObservedState>;

/** One field that moved. */
export interface ObservedChange {
  readonly field: keyof WorkflowObservedState;
  readonly label: string;
  readonly kind: ObservedChangeKind;
  /** Rendered prior value, absent when there was not one. */
  readonly before?: string;
  /** Rendered current value, absent when it is no longer readable. */
  readonly after?: string;
  /** One sentence, in the field's own vocabulary. */
  readonly summary: string;
  readonly significance: number;
}

export type ObservedDeltaStatus =
  /** No usable baseline. One was stored now; there will be a delta next time. */
  | 'first-look'
  /** A baseline existed and something moved. */
  | 'changed'
  /** A baseline existed and nothing tracked moved. */
  | 'unchanged';

export interface ObservedDelta {
  readonly status: ObservedDeltaStatus;
  /** When the baseline was taken. Absent on a first look. */
  readonly since?: string;
  /** Why there is no baseline, when there is not one. */
  readonly firstLookReason?: 'no-snapshot' | 'different-repository' | 'unreadable-snapshot';
  readonly changes: readonly ObservedChange[];
  /** Changes beyond the cap, stated rather than silently dropped. */
  readonly droppedByCap: number;
}

/** A stored reading. Shape kept flat so it survives JSON round-trips. */
export interface ObservedSnapshot {
  readonly takenAt: string;
  /** Guards property 4. Absent when the repo was not resolvable. */
  readonly repoSlug?: string;
  readonly state: Partial<WorkflowObservedState>;
}

/**
 * Reported changes are capped. Above this the list stops being a delta and
 * becomes a second copy of the page — and the cases that produce twenty
 * simultaneous changes are almost always one cause (`gh` came back) rather
 * than twenty events.
 */
export const MAX_REPORTED_CHANGES = 8;

// ── Rendering ────────────────────────────────────────────────────────────────

type Comparable = string | number | boolean | readonly string[] | undefined;

function isPresent(value: Comparable): boolean {
  return value !== undefined && value !== null;
}

function renderValue(value: Comparable): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return String(value);
}

/** Numeric magnitude for count-shaped fields, `undefined` for the rest. */
function magnitudeOf(value: Comparable): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return undefined;
}

function equalValues(a: Comparable, b: Comparable): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    // Order-insensitive: `gh` does not promise a branch order, and a reordered
    // list is not a change anybody made.
    if (a.length !== b.length) {
      return false;
    }
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((entry, index) => entry === right[index]);
  }
  return a === b;
}

function classifyMovement(rule: FieldRule, before: Comparable, after: Comparable): ObservedChangeKind {
  const from = magnitudeOf(before);
  const to = magnitudeOf(after);
  if (rule.polarity === 'neither' || from === undefined || to === undefined) {
    if (rule.polarity !== 'neither' && typeof before === 'boolean' && typeof after === 'boolean') {
      const wantsTrue = rule.polarity === 'higher';
      return after === wantsTrue ? 'improved' : 'worsened';
    }
    return 'moved';
  }
  if (to === from) {
    return 'moved';
  }
  const rose = to > from;
  return rose === (rule.polarity === 'higher') ? 'improved' : 'worsened';
}

function countSentence(rule: FieldRule, from: number, to: number): string {
  const noun = rule.noun ?? rule.label.toLowerCase();
  const difference = Math.abs(to - from);
  const word = to > from ? 'more' : 'fewer';
  const plural = difference === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun;
  return `${difference} ${word} ${plural} — ${from} to ${to}`;
}

function describeMovement(rule: FieldRule, before: Comparable, after: Comparable): string {
  const from = magnitudeOf(before);
  const to = magnitudeOf(after);
  if (from !== undefined && to !== undefined && from !== to && !Array.isArray(before)) {
    return countSentence(rule, from, to);
  }
  if (typeof before === 'boolean' || typeof after === 'boolean') {
    return after === true ? `${rule.label} is now in place` : `${rule.label} is no longer in place`;
  }
  return `${renderValue(before)} → ${renderValue(after)}`;
}

// ── The comparison ───────────────────────────────────────────────────────────

/**
 * Compare a stored reading against the current one.
 *
 * Returns `first-look` — with an empty change list, never a full one — when the
 * baseline is missing, unusable, or from a different repository. The caller
 * stores the new snapshot either way, so the next look has something to say.
 */
export function compareObservedState(
  previous: ObservedSnapshot | undefined,
  current: WorkflowObservedState,
): ObservedDelta {
  const firstLook = (reason: NonNullable<ObservedDelta['firstLookReason']>): ObservedDelta => ({
    status: 'first-look',
    firstLookReason: reason,
    changes: [],
    droppedByCap: 0,
  });

  if (!previous || typeof previous !== 'object') {
    return firstLook('no-snapshot');
  }
  if (typeof previous.takenAt !== 'string' || !previous.takenAt || typeof previous.state !== 'object'
    || previous.state === null) {
    // A snapshot we cannot read is not a baseline of zero. It is no baseline.
    return firstLook('unreadable-snapshot');
  }
  if (isPresent(previous.repoSlug) && isPresent(current.repoSlug) && previous.repoSlug !== current.repoSlug) {
    return firstLook('different-repository');
  }

  const changes: ObservedChange[] = [];
  for (const field of DELTA_TRACKED_FIELDS) {
    const rule = FIELD_RULES[field];
    if (!rule) {
      continue;
    }
    const before = previous.state[field] as Comparable;
    const after = current[field] as Comparable;
    const had = isPresent(before);
    const has = isPresent(after);

    if (!had && !has) {
      continue;
    }
    if (!had && has) {
      // Property 2. Reported so the surface can explain why a number appeared,
      // but never as a movement from zero.
      changes.push({
        field,
        label: rule.label,
        kind: 'now-known',
        after: renderValue(after),
        summary: `${rule.label} can be read now — ${renderValue(after)}. It could not be last time, so there is nothing to compare it against.`,
        // Demoted, not eliminated. It is news about the *reading* rather than
        // the project, so it never outranks the same field actually moving —
        // but a newly visible failing pipeline still belongs above a label
        // count changing, so consequence keeps its say.
        significance: rule.significance / 4,
      });
      continue;
    }
    if (had && !has) {
      // Property 3.
      changes.push({
        field,
        label: rule.label,
        kind: 'no-longer-readable',
        before: renderValue(before),
        summary: `${rule.label} can no longer be read. It was ${renderValue(before)}. Usually a sign a tool stopped answering rather than something changing in the project.`,
        // Above the movement it hides, because it explains the silence.
        significance: rule.significance + 1,
      });
      continue;
    }
    if (equalValues(before, after)) {
      continue;
    }

    changes.push({
      field,
      label: rule.label,
      kind: classifyMovement(rule, before, after),
      before: renderValue(before),
      after: renderValue(after),
      summary: describeMovement(rule, before, after),
      significance: rule.significance,
    });
  }

  const order = new Map(DELTA_TRACKED_FIELDS.map((field, index) => [field, index]));
  changes.sort((a, b) =>
    b.significance - a.significance || (order.get(a.field) ?? 0) - (order.get(b.field) ?? 0));

  const reported = changes.slice(0, MAX_REPORTED_CHANGES);
  return {
    status: changes.length === 0 ? 'unchanged' : 'changed',
    since: previous.takenAt,
    changes: reported,
    droppedByCap: changes.length - reported.length,
  };
}

/**
 * Take the reading to store as the next baseline.
 *
 * Only tracked fields are kept. A snapshot holding everything would grow a
 * dependency on fields nothing compares, and the first person to add a field to
 * `WorkflowObservedState` would silently change what is persisted.
 */
export function takeObservedSnapshot(current: WorkflowObservedState, now: string): ObservedSnapshot {
  const state: Partial<WorkflowObservedState> = {};
  for (const field of DELTA_TRACKED_FIELDS) {
    const value = current[field];
    if (value !== undefined) {
      // Cast once, at the boundary: the loop is heterogeneous by construction
      // and the field/value pairing is guaranteed by the key it came from.
      (state as Record<string, unknown>)[field] = Array.isArray(value) ? [...value] : value;
    }
  }
  return { takenAt: now, repoSlug: current.repoSlug, state };
}

/**
 * How long ago the baseline was taken, in words.
 *
 * "Since you last looked" is doing a lot of work if the last look was in April.
 * A delta whose window is unstated invites reading a quarter's drift as this
 * morning's news.
 */
export function describeSince(takenAt: string | undefined, now: string): string {
  if (!takenAt) {
    return 'since an unknown time';
  }
  const then = Date.parse(takenAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) {
    // Not a timestamp. Slicing ten characters off it and prefixing "since"
    // would present arbitrary text as a date, which is worse than admitting
    // the reading has no usable time on it.
    return 'since an unknown time';
  }
  if (nowMs < then) {
    // A clock that disagrees with itself is not grounds for inventing a
    // duration. Name the instant and let the reader judge.
    return `since ${takenAt.slice(0, 10)}`;
  }
  const minutes = Math.floor((nowMs - then) / 60_000);
  if (minutes < 2) {
    return 'in the last minute';
  }
  if (minutes < 60) {
    return `in the last ${minutes} minutes`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `in the last ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `in the last ${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (days < 60) {
    return `in the last ${Math.floor(days / 7)} weeks`;
  }
  return `since ${takenAt.slice(0, 10)}`;
}

/**
 * The headline. One sentence, because the point of a delta is that it can be
 * read without being studied.
 */
export function summarizeObservedDelta(delta: ObservedDelta, now: string): string {
  if (delta.status === 'first-look') {
    switch (delta.firstLookReason) {
      case 'different-repository':
        return 'This is a different repository from the last reading, so there is nothing to compare. What changes from here will be reported.';
      case 'unreadable-snapshot':
        return 'The last reading could not be read back, so this counts as a first look. What changes from here will be reported.';
      default:
        return 'First look. AtlasMind has recorded where the project stands; from now on this reports what moved.';
    }
  }
  const window = describeSince(delta.since, now);
  if (delta.status === 'unchanged') {
    return `Nothing tracked has moved ${window}.`;
  }
  const worse = delta.changes.filter(change => change.kind === 'worsened').length;
  const better = delta.changes.filter(change => change.kind === 'improved').length;
  const total = delta.changes.length + delta.droppedByCap;
  const parts: string[] = [`${total} ${total === 1 ? 'thing' : 'things'} moved ${window}`];
  if (worse > 0) {
    parts.push(`${worse} the wrong way`);
  }
  if (better > 0) {
    parts.push(`${better} the right way`);
  }
  return `${parts.join(', ')}.`;
}

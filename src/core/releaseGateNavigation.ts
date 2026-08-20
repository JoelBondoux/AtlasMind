/**
 * Where a release gate sends you, and which gate you should read first.
 *
 * The Release page listed eight gates as flat, equally-weighted, unclickable
 * text in evaluation order. Evaluation order is a property of the *checker* —
 * root-cause-first, so a missing changelog is assessed before the notes taken
 * from it — and it is the wrong order for a reader, who wants the one that is
 * actually blocking the release at the top. Worse, several gates named the page
 * holding their evidence in prose ("Open the Pipeline page") and then left you
 * to find it, which is the failure the dashboard's own deep links exist to
 * close: reasoning about a fact and then not offering the way to it.
 *
 * Four rules, all of them about not overstating what is known.
 *
 * **A destination is declared per gate, never inferred.** The mapping is a
 * literal table keyed on `ReleaseGateId`, exhaustive by the type system rather
 * than by a default branch: a new gate id is a compile error here, which is the
 * only way a table like this stays honest as gates are added. There is no
 * fallback destination, because a gate silently routed somewhere unrelated is
 * worse than one that is not clickable — the reader follows it, finds nothing,
 * and learns not to trust the others.
 *
 * **Ranked by consequence, not by evaluation order, with declaration order
 * breaking ties** — the same rule `attentionFeed` and `observedDelta` use, for
 * the same reason: a list that reshuffles between renders is one nobody can
 * scan. `fail` outranks `unknown` outranks `pass`, and within a rank the gates
 * keep the order the evaluator produced, so the root-cause-first reasoning
 * survives inside each band.
 *
 * **`unknown` sorts with the problems, not with the passes.** This is the whole
 * point of the ordering. `releasePreparation` is built around "an unknown is
 * not a pass"; an ordering that sank unknowns to the bottom beside the passing
 * gates would undo that at the last surface before somebody tags a release.
 *
 * **A filter states what it hid.** Filtering is a way of looking, so a filtered
 * board must never read as a complete one — `summarizeReleaseGateView` carries
 * the hidden count and counts every status over the *unfiltered* set, so no
 * renderer can report a subset as the whole.
 *
 * Pure: no `vscode`, no `fs`, no clock. The caller resolves an id to a real
 * navigation, exactly as `githubDeepLinks` does — a webview can name a gate and
 * can never name a destination.
 */

import type { ReleaseGate, ReleaseGateId, ReleaseGateStatus } from './releasePreparation.js';

/**
 * Where the evidence for a gate actually lives.
 *
 * `page` is a dashboard page id; `file` is a workspace-relative path. Both are
 * resolved by the host from this table, never supplied by the webview.
 */
export interface ReleaseGateDestination {
  kind: 'page' | 'file';
  /** A dashboard page id, or a workspace-relative path. */
  target: string;
  /** What the control says. Names the destination, not the gate. */
  label: string;
  /** Why this is the right place — shown as the control's tooltip. */
  reason: string;
}

/**
 * The declared destination per gate. Exhaustive by construction: a `Record` over
 * the id union means a new gate cannot be added without deciding where it goes.
 *
 * `CHANGELOG.md` is a literal here rather than a discovered path because
 * `releasePreparation` reads that exact filename — a second answer to "where is
 * the changelog" is how the two surfaces would eventually disagree.
 */
export const RELEASE_GATE_DESTINATIONS: Record<ReleaseGateId, ReleaseGateDestination> = {
  'changelog-entry': {
    kind: 'file',
    target: 'CHANGELOG.md',
    label: 'Open CHANGELOG.md',
    reason: 'The section for this version is what the release notes are copied from.',
  },
  'notes-body': {
    kind: 'file',
    target: 'CHANGELOG.md',
    label: 'Open CHANGELOG.md',
    reason: 'The notes are this file’s section for the version, verbatim. Write it there.',
  },
  'notes-clean': {
    kind: 'file',
    target: 'CHANGELOG.md',
    label: 'Open CHANGELOG.md',
    reason: 'The secret-shaped text is in the changelog section itself, and a published note cannot be withdrawn.',
  },
  'version-ahead': {
    kind: 'file',
    target: 'package.json',
    label: 'Open package.json',
    reason: 'The manifest version is the one this release would claim.',
  },
  'tag-free': {
    kind: 'page',
    target: 'delivery',
    label: 'Open Delivery',
    reason: 'Tags and the branches they sit on are the delivery pipeline’s subject.',
  },
  'clean-tree': {
    kind: 'page',
    target: 'branches',
    label: 'Open Branches',
    reason: 'Uncommitted work is listed there, against the branch it is on.',
  },
  'ci-green': {
    kind: 'page',
    target: 'pipeline',
    label: 'Open Pipeline',
    reason: 'The failing run is classified there with its evidence.',
  },
  'tests-evidenced': {
    kind: 'page',
    target: 'testing',
    label: 'Open Testing',
    reason: 'Per-policy coverage and the last test report live there.',
  },
};

/**
 * Consequence rank. Lower sorts first.
 *
 * `unknown` sits beside `fail` rather than beside `pass` deliberately — see the
 * module comment. The gap between the numbers is not meaningful; only the order
 * is.
 */
export const RELEASE_GATE_STATUS_RANK: Record<ReleaseGateStatus, number> = {
  fail: 0,
  unknown: 1,
  pass: 2,
};

export type ReleaseGateSort = 'urgency' | 'evaluation';
export type ReleaseGateFilter = 'all' | 'outstanding' | 'blocked' | 'unknown' | 'ready';

/** Which statuses each filter admits. A filter is a set-membership test, nothing cleverer. */
const RELEASE_GATE_FILTER_STATUSES: Record<ReleaseGateFilter, readonly ReleaseGateStatus[]> = {
  all: ['fail', 'unknown', 'pass'],
  // "Outstanding" is the working set: everything that is not a pass. An unknown
  // belongs here because nobody has established that it is fine.
  outstanding: ['fail', 'unknown'],
  blocked: ['fail'],
  unknown: ['unknown'],
  ready: ['pass'],
};

/** The filters offered, in the order they are offered. Declaration order is the UI order. */
export const RELEASE_GATE_FILTERS: readonly { id: ReleaseGateFilter; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every gate that was evaluated.' },
  { id: 'outstanding', label: 'Needs you', hint: 'Blocked and unknown together — everything that is not a pass.' },
  { id: 'blocked', label: 'Blocked', hint: 'Checked, and the answer was no.' },
  { id: 'unknown', label: 'Unknown', hint: 'Asked, and nothing answered. Not a pass.' },
  { id: 'ready', label: 'Ready', hint: 'Checked and satisfied.' },
];

export const RELEASE_GATE_SORTS: readonly { id: ReleaseGateSort; label: string; hint: string }[] = [
  { id: 'urgency', label: 'Urgent first', hint: 'Blocked, then unknown, then ready. Evaluation order breaks ties.' },
  { id: 'evaluation', label: 'Evaluation order', hint: 'The order the gates were checked in — root cause before symptom.' },
];

export function isReleaseGateFilter(value: unknown): value is ReleaseGateFilter {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RELEASE_GATE_FILTER_STATUSES, value);
}

export function isReleaseGateSort(value: unknown): value is ReleaseGateSort {
  return value === 'urgency' || value === 'evaluation';
}

/**
 * The destination for a gate id, or `undefined` for an id this table does not
 * declare.
 *
 * Returning `undefined` rather than a default is the safety property: the id
 * reaches this function from a webview click, and a plausible-looking
 * destination for an id nobody declared is a button that opens the wrong thing
 * while looking as though it worked.
 */
export function resolveReleaseGateDestination(id: unknown): ReleaseGateDestination | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(RELEASE_GATE_DESTINATIONS, id)
    ? RELEASE_GATE_DESTINATIONS[id as ReleaseGateId]
    : undefined;
}

/**
 * Order gates for reading.
 *
 * Stable in both modes: `evaluation` is the identity, and `urgency` sorts only
 * on rank, so gates of equal status keep the evaluator's root-cause-first
 * order. A comparator that fell back on the label would reorder the whole list
 * whenever a gate was renamed.
 */
export function orderReleaseGates(gates: readonly ReleaseGate[], sort: ReleaseGateSort): ReleaseGate[] {
  const ordered = [...gates];
  if (sort === 'evaluation') {
    return ordered;
  }
  return ordered
    .map((gate, index) => ({ gate, index }))
    .sort((left, right) => {
      const byRank = (RELEASE_GATE_STATUS_RANK[left.gate.status] ?? 99)
        - (RELEASE_GATE_STATUS_RANK[right.gate.status] ?? 99);
      return byRank !== 0 ? byRank : left.index - right.index;
    })
    .map(entry => entry.gate);
}

export function filterReleaseGates(gates: readonly ReleaseGate[], filter: ReleaseGateFilter): ReleaseGate[] {
  const admitted = RELEASE_GATE_FILTER_STATUSES[filter] ?? RELEASE_GATE_FILTER_STATUSES.all;
  return gates.filter(gate => admitted.includes(gate.status));
}

export interface ReleaseGateView {
  /** The gates to render, filtered then ordered. */
  gates: ReleaseGate[];
  /** How many were evaluated in total, whatever the filter admits. */
  total: number;
  /** How many the filter is holding back. Zero when nothing is hidden. */
  hidden: number;
  /** Counts per status over the *whole* set, so the chips stay honest while filtered. */
  counts: Record<ReleaseGateStatus, number>;
  /**
   * One sentence stating what is on screen and what is not. Never omitted when
   * something is hidden: a filtered list that does not say so reads as the
   * whole board.
   */
  summary: string;
}

/**
 * Filter, order, and say what that did.
 *
 * The counts are computed over the unfiltered set on purpose. A chip reading
 * "Blocked 3" that counted only what the current filter admits would report
 * zero blocked gates the moment somebody selected "Ready", which is precisely
 * when a reader most needs to know there are three.
 */
export function summarizeReleaseGateView(
  gates: readonly ReleaseGate[],
  filter: ReleaseGateFilter,
  sort: ReleaseGateSort,
): ReleaseGateView {
  const counts: Record<ReleaseGateStatus, number> = { fail: 0, unknown: 0, pass: 0 };
  for (const gate of gates) {
    if (Object.prototype.hasOwnProperty.call(counts, gate.status)) {
      counts[gate.status] += 1;
    }
  }
  const shown = orderReleaseGates(filterReleaseGates(gates, filter), sort);
  const hidden = gates.length - shown.length;
  const label = RELEASE_GATE_FILTERS.find(entry => entry.id === filter)?.label ?? 'All';

  const summary = gates.length === 0
    ? 'No gates evaluated.'
    : hidden === 0
      ? `All ${gates.length} gate${gates.length === 1 ? '' : 's'} shown.`
      : shown.length === 0
        ? `No gate matches the ${label.toLowerCase()} filter. ${hidden} hidden.`
        : `${shown.length} of ${gates.length} shown — ${hidden} hidden by the ${label.toLowerCase()} filter.`;

  return { gates: shown, total: gates.length, hidden, counts, summary };
}

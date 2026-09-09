/**
 * Baselines you can name, so *what changed* can be asked about more than one
 * moment.
 *
 * `observedDelta` answers "what changed since I last looked", and answers it
 * carefully — five rules about the ways a delta can lie. But it holds exactly
 * one baseline, advanced on every render, so the only span available is the one
 * nobody chose. The questions people actually ask are *what has changed since
 * the release*, *since this branch started*, *since the audit* — and none of
 * them could be asked at all.
 *
 * This adds named baselines and nothing else. **The comparison is
 * `compareObservedState`, unchanged**: a second implementation would eventually
 * disagree with the first, and the symptom would be two cards on one dashboard
 * reporting different numbers for the same fortnight. Every rule that module
 * enforces — no baseline is a first look, unknown to known is not zero to n, a
 * changed repository discards the comparison — holds here by construction
 * rather than by being restated.
 *
 * Six rules of its own.
 *
 * **A named baseline is captured deliberately, never on a render.** The "last
 * looked" watermark advances by itself because it means *last looked*; a named
 * one means *the moment somebody chose*, and moving it silently would erase the
 * span it was created to measure. Nothing in this module writes on read.
 *
 * **The age is always stated.** A reading against a six-week-old baseline
 * showing eleven changes is six weeks of work, and rendered without its age it
 * looks like this morning. `describeBaselineSpan` exists so no surface has to
 * remember, and `staleness` grades it.
 *
 * **Past the cap, capture is refused and says which to remove — the oldest is
 * never evicted.** Evicting by age deletes precisely the most valuable one,
 * since the furthest-back baseline is the only one that can answer a question
 * about the whole project. A refusal is an inconvenience; a silent eviction is
 * a lost record.
 *
 * **A baseline is never deleted to make room, and deletion is always somebody's
 * decision.** There is no expiry, no cleanup pass and no eviction anywhere.
 *
 * **A baseline that no longer applies is kept and reported, never removed.**
 * Opening a different repository does not make somebody's named baseline
 * wrong — it makes it inapplicable *here*, which `compareObservedState` already
 * reports as `different-repository`. Deleting it would be an erasure triggered
 * by opening a folder.
 *
 * **A label is untrusted text.** Somebody types it, it is rendered, and an id
 * is derived from it — so it is clamped, control-stripped, and the id is
 * derived deterministically with a collision suffix rather than trusting the
 * label to be unique.
 *
 * Per-developer, like the watermark it extends: `OBSERVED_SNAPSHOT_NOTE`
 * explains why a baseline must not live in git-tracked `project_memory/`, and
 * naming one does not change the reason — the counts inside were read from
 * `gh` at one machine's moment, and two people capturing "1.0" a day apart
 * would produce a conflict over an observation neither of them decided.
 *
 * Pure, clock-injected + unit-tested; storage is the caller's.
 */

import {
  compareObservedState,
  takeObservedSnapshot,
  type ObservedDelta,
  type ObservedScope,
  type ObservedSnapshot,
} from './observedDelta.js';
import type { WorkflowObservedState } from './workflowCurriculum.js';

/**
 * How many named baselines one workspace may hold.
 *
 * Not a storage limit — these are small. It is a limit on how many spans a
 * person can meaningfully choose between: a list of forty is a second
 * navigation problem, and the reason each was captured stops being
 * remembered.
 */
export const MAX_NAMED_BASELINES = 12;

const MAX_LABEL = 60;
const MAX_REASON = 300;

export interface BaselineRule {
  id: string;
  describes: string;
}

/**
 * The rules, published with every register so a surface shows the ones that
 * actually applied rather than a copy that drifted.
 */
export const BASELINE_RULES: readonly BaselineRule[] = [
  { id: 'captured-deliberately', describes: 'A named baseline is captured when somebody asks for one. Nothing here writes on a render.' },
  { id: 'age-stated', describes: 'Every comparison states how old the baseline is, because eleven changes over six weeks is not eleven changes today.' },
  { id: 'cap-refuses', describes: `At ${MAX_NAMED_BASELINES} baselines a new capture is refused and names what to remove. The oldest is never evicted — it is the only one that can answer a question about the whole project.` },
  { id: 'deletion-is-a-decision', describes: 'Nothing expires and nothing is cleaned up. A baseline goes when somebody removes it.' },
  { id: 'inapplicable-is-kept', describes: 'A baseline from another repository is reported as not comparable here, never deleted. Opening a folder is not a reason to lose a record.' },
  { id: 'one-comparison', describes: 'The comparison is the same one the "since you last looked" card uses, so two surfaces cannot disagree about the same fortnight.' },
];

export interface NamedBaseline {
  id: string;
  /** What somebody called it. Untrusted text: clamped and control-stripped. */
  label: string;
  /** Why it was captured, when they said. */
  reason?: string;
  takenAt: string;
  snapshot: ObservedSnapshot;
}

export interface BaselineRegister {
  version: 1;
  baselines: NamedBaseline[];
}

export const EMPTY_BASELINE_REGISTER: BaselineRegister = { version: 1, baselines: [] };

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Read a stored register.
 *
 * Never throws and never partially accepts: an entry without a readable
 * snapshot is dropped, because a baseline that cannot be compared against is
 * worse than an absent one — it offers a span and then reports a first look.
 */
export function sanitizeBaselineRegister(value: unknown): BaselineRegister {
  if (typeof value !== 'object' || value === null) {
    return { version: 1, baselines: [] };
  }
  const raw = value as Record<string, unknown>;
  const list = Array.isArray(raw['baselines']) ? raw['baselines'] : [];
  const used = new Set<string>();
  const baselines: NamedBaseline[] = [];
  for (const entry of list.slice(0, MAX_NAMED_BASELINES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const label = clampText(record['label'], MAX_LABEL);
    const takenAt = clampText(record['takenAt'], 40);
    const snapshot = record['snapshot'];
    if (!label || !takenAt || Number.isNaN(Date.parse(takenAt))) {
      continue;
    }
    if (typeof snapshot !== 'object' || snapshot === null
      || typeof (snapshot as ObservedSnapshot).state !== 'object'
      || (snapshot as ObservedSnapshot).state === null) {
      continue;
    }
    let id = clampText(record['id'], 80) || `baseline-${slugify(label)}`;
    while (used.has(id)) {
      id = `${id}-${used.size}`;
    }
    used.add(id);
    const reason = clampText(record['reason'], MAX_REASON);
    baselines.push({
      id,
      label,
      takenAt,
      ...(reason ? { reason } : {}),
      snapshot: snapshot as ObservedSnapshot,
    });
  }
  return { version: 1, baselines };
}

export type CaptureRefusal = 'no-label' | 'at-capacity' | 'duplicate-label';

export interface CaptureResult {
  /** The register to store. Unchanged when the capture was refused. */
  register: BaselineRegister;
  /** The baseline that was captured, when one was. */
  captured?: NamedBaseline;
  refusal?: CaptureRefusal;
  /** One sentence naming what to change. Present whenever there is a refusal. */
  detail?: string;
}

/**
 * Capture the current reading under a name.
 *
 * Returns the register to store rather than mutating one, so a refusal cannot
 * half-apply and the caller decides when anything is persisted.
 */
export function captureBaseline(input: {
  register: BaselineRegister;
  label: string;
  reason?: string;
  current: WorkflowObservedState;
  scope?: ObservedScope;
  now: string;
}): CaptureResult {
  const label = clampText(input.label, MAX_LABEL);
  if (!label) {
    return {
      register: input.register,
      refusal: 'no-label',
      detail: 'A baseline needs a name. "Before the migration" is what makes it findable in three weeks; a date is already on it.',
    };
  }
  if (input.register.baselines.some(entry => entry.label.toLowerCase() === label.toLowerCase())) {
    return {
      register: input.register,
      refusal: 'duplicate-label',
      detail: `There is already a baseline called "${label}". Two spans with one name cannot be told apart afterwards — remove the old one first, or pick another name.`,
    };
  }
  if (input.register.baselines.length >= MAX_NAMED_BASELINES) {
    // Named rather than evicted. The oldest is the only one that can answer a
    // question about the whole project, so removing it automatically would
    // discard the most valuable record to make room for the least proven.
    const oldest = [...input.register.baselines].sort((a, b) => a.takenAt.localeCompare(b.takenAt))[0];
    return {
      register: input.register,
      refusal: 'at-capacity',
      detail: `There are already ${MAX_NAMED_BASELINES} baselines. Remove one first — nothing is deleted to make room, because the oldest is usually the one worth keeping${oldest ? ` (the oldest here is "${oldest.label}")` : ''}.`,
    };
  }

  const captured: NamedBaseline = {
    id: nextBaselineId(input.register, label),
    label,
    takenAt: input.now,
    ...(clampText(input.reason, MAX_REASON) ? { reason: clampText(input.reason, MAX_REASON) } : {}),
    snapshot: takeObservedSnapshot(input.current, input.now, input.scope),
  };
  return {
    register: { version: 1, baselines: [...input.register.baselines, captured] },
    captured,
  };
}

function nextBaselineId(register: BaselineRegister, label: string): string {
  const base = `baseline-${slugify(label)}` || 'baseline';
  let id = base;
  let n = 1;
  while (register.baselines.some(entry => entry.id === id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

/**
 * Remove one baseline by id.
 *
 * The only way a baseline leaves the register. No expiry, no eviction, no
 * cleanup pass — deleting somebody's record of a span is a decision, and the
 * confirmation lives at the call site.
 */
export function removeBaseline(register: BaselineRegister, id: string): BaselineRegister {
  return { version: 1, baselines: register.baselines.filter(entry => entry.id !== id) };
}

export type BaselineStaleness = 'fresh' | 'recent' | 'old';

/** Beyond this a baseline is describing a different period of the project. */
export const BASELINE_OLD_AFTER_DAYS = 30;
const BASELINE_RECENT_AFTER_DAYS = 7;

export interface BaselineComparison {
  baseline: NamedBaseline;
  delta: ObservedDelta;
  /** Whole days between the baseline and now. */
  ageDays: number;
  staleness: BaselineStaleness;
  /**
   * The span in words, always rendered with the changes.
   *
   * Composed here so no surface can show a delta without it: eleven changes
   * over six weeks and eleven changes today are different findings, and only
   * the age separates them.
   */
  span: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Compare the current reading against one named baseline. */
export function compareAgainstBaseline(input: {
  baseline: NamedBaseline;
  current: WorkflowObservedState;
  scope?: ObservedScope;
  now: string;
}): BaselineComparison {
  const delta = compareObservedState(input.baseline.snapshot, input.current, input.scope);
  const taken = Date.parse(input.baseline.takenAt);
  const now = Date.parse(input.now);
  const ageDays = Number.isFinite(taken) && Number.isFinite(now) && now >= taken
    ? Math.floor((now - taken) / MS_PER_DAY)
    : 0;
  const staleness: BaselineStaleness = ageDays >= BASELINE_OLD_AFTER_DAYS
    ? 'old'
    : ageDays >= BASELINE_RECENT_AFTER_DAYS ? 'recent' : 'fresh';
  return {
    baseline: input.baseline,
    delta,
    ageDays,
    staleness,
    span: describeBaselineSpan(input.baseline, ageDays, delta),
  };
}

/**
 * The sentence a surface must show with any comparison against a baseline.
 *
 * Deliberately not exported. It is always carried on the comparison, which is
 * what makes "the age is always stated" structural: a caller able to compose a
 * span separately could compose one that omits the age, or show the changes
 * without composing one at all.
 */
function describeBaselineSpan(
  baseline: NamedBaseline,
  ageDays: number,
  delta: ObservedDelta,
): string {
  const age = ageDays === 0
    ? 'captured today'
    : ageDays === 1
      ? 'captured yesterday'
      : `captured ${ageDays} days ago`;
  if (delta.status === 'first-look') {
    // The baseline exists; it simply cannot speak about what is on screen. Said
    // as its own fact, because "no changes" would be a different claim.
    const why = delta.firstLookReason === 'different-repository'
      ? 'it was captured against a different repository'
      : delta.firstLookReason === 'different-scope'
        ? 'it was captured over a different set of components'
        : 'it could not be read';
    return `"${baseline.label}", ${age}, cannot be compared here: ${why}.`;
  }
  if (delta.status === 'unchanged') {
    return `Nothing tracked has moved since "${baseline.label}", ${age}.`;
  }
  const count = delta.changes.length + delta.droppedByCap;
  return `${count} change${count === 1 ? '' : 's'} since "${baseline.label}", ${age}.`;
}

/**
 * Baselines in the order a chooser should offer them: newest first.
 *
 * Newest first because the recent span is the one asked for most, and the list
 * is short enough that ordering is a convenience rather than a ranking.
 */
export function orderedBaselines(register: BaselineRegister): NamedBaseline[] {
  return [...register.baselines].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

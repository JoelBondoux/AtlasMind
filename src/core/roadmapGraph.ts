/**
 * The roadmap as a graph — what has to happen before what.
 *
 * The roadmap has always been an ordered list, and an ordered list can only say
 * *this one is more important*. It cannot say **this one cannot start until that
 * one lands**, which is the question anybody planning a release actually asks.
 * Priority order and dependency order are different facts, and a surface that
 * only holds the first quietly presents it as the second — which is how a
 * backlog can look well-sequenced and still be unbuildable in the order it is
 * written.
 *
 * Five rules carry the semantics, and each is asserted by test:
 *
 * 1. **A declared edge always wins, and derivation may never contradict one.**
 *    Somebody draws a link because they know something the text does not say. A
 *    derived edge that reversed it would overwrite knowledge with a keyword
 *    match, so derivation refuses rather than competes, and says it refused.
 *
 * 2. **A derived edge names the declared rule that produced it, and is a
 *    suggestion until somebody accepts it.** Auto-calculation is what makes the
 *    graph usable on a backlog nobody has wired up by hand; silently *writing*
 *    what it inferred would mean a keyword coincidence reordering somebody's
 *    plan behind their back. Suggestions are drawn dashed, one click from real
 *    and one click from gone.
 *
 * 3. **The graph is acyclic by construction, not by hope.** A cycle in a
 *    dependency graph is a plan that cannot be executed, and a layout pass fed
 *    one either loops or silently drops an edge. Derivation never closes a
 *    cycle; a *declared* cycle is reported by name rather than quietly broken,
 *    because the items involved are the finding.
 *
 * 4. **An estimate comes from a published table, never a model.** A number a
 *    model produced in March is not comparable with one it produced in July,
 *    and comparability is the entire point of putting estimates on a plan. The
 *    table travels with the result, so the canvas publishes the rules that
 *    actually graded the work rather than a copy that drifts.
 *
 * 5. **Absent is not zero.** No deadline is `no-deadline`, never "0 days left";
 *    an unmeasured estimate is derived and *says* it was derived. A plan that
 *    renders a missing date as an urgent one teaches people to ignore the dates
 *    that are real.
 *
 * Pure, `vscode`-free, clock-injected, and unit-tested. Persistence lives in
 * `roadmapGraphStore.ts`; the canvas that draws this is the Project Dashboard's
 * Roadmap page.
 */

import type { RoadmapImportRecord } from './roadmapImport.js';

/** Mirrors `DashboardRoadmapItem['focus']`. Duplicated deliberately: this module is pure. */
export type RoadmapFocus = 'security' | 'architecture' | 'delivery' | 'feature' | 'documentation';

/**
 * How early in a build each kind of work belongs.
 *
 * The same ladder `buildMvpSnapshot` already orders an MVP route by, reused
 * rather than re-stated: two orderings of the same five words would eventually
 * disagree, and the symptom would be a canvas whose columns contradict the
 * route on the card above it.
 */
const FOCUS_PHASE_WEIGHT: Readonly<Record<RoadmapFocus, number>> = {
  security: 0,
  architecture: 1,
  delivery: 2,
  feature: 3,
  documentation: 4,
};

/** The declared rules that may produce an edge nobody drew. */
export type RoadmapEdgeRuleId = 'explicit-reference' | 'shared-subject-phase' | 'gate-sequence';

export interface RoadmapEdgeRule {
  id: RoadmapEdgeRuleId;
  label: string;
  /** What the rule looks for. Published on the canvas so a suggestion can be judged. */
  detail: string;
  /** Evaluation order. A lower number is consulted first and wins a tie. */
  rank: number;
}

/**
 * The rule table, in evaluation order.
 *
 * Order is the policy: an item that *says* what it waits for outranks two items
 * that merely share vocabulary, because one is a statement and the other is a
 * coincidence.
 */
export const ROADMAP_EDGE_RULES: readonly RoadmapEdgeRule[] = [
  {
    id: 'explicit-reference',
    label: 'Names what it waits for',
    detail: 'The item says “after”, “once”, “depends on”, “requires”, “needs” or “blocked by”, and the words that follow name another item.',
    rank: 0,
  },
  {
    id: 'shared-subject-phase',
    label: 'Same subject, earlier phase',
    detail: 'Two items share at least two distinctive words, and one is foundation work for the other (security → architecture → delivery → feature → documentation).',
    rank: 1,
  },
  {
    id: 'gate-sequence',
    label: 'Earlier release, same subject',
    detail: 'Two items share a distinctive word and sit on different declared release gates; the earlier release comes first.',
    rank: 2,
  },
];

export type RoadmapEdgeOrigin = 'declared' | 'derived';

/** One dependency: `from` has to land before `to` can. */
export interface RoadmapEdge {
  from: string;
  to: string;
  origin: RoadmapEdgeOrigin;
  /** The rule that produced a derived edge. Absent on a declared one. */
  rule?: RoadmapEdgeRuleId;
  /** What the rule matched on, for the tooltip. Absent on a declared one. */
  evidence?: string;
  createdAt?: string;
  /** Director contact id of whoever drew it. Absent when nobody is on record. */
  createdBy?: string;
}

/** The persisted per-node record — everything the markdown line cannot hold. */
export interface RoadmapNodeRecord {
  id: string;
  /**
   * The normalized item text this record was minted against.
   *
   * A repair path, not the key: the key is `id`, carried in the markdown line,
   * so a rename keeps its deadline and its links. This is what finds a record
   * again when the anchor was lost to a hand edit.
   */
  normalizedText: string;
  /** Declared branch name. Absent means "use the derived one". */
  branch?: string;
  /** ISO calendar date, `YYYY-MM-DD`. Absent means no deadline — never "today". */
  deadline?: string;
  /** Declared estimate in days. Absent means "use the derived one". */
  estimateDays?: number;
  /**
   * Whether this node's estimate assumes AI-assisted coding.
   *
   * Per node rather than per project, because "port the CSS" and "design the
   * migration ladder" are not helped by the same amount, and one project-wide
   * multiplier would be wrong for both.
   */
  aiAssisted?: boolean;
  /**
   * Who is doing this, by Project Director contact id.
   *
   * Deliberately distinct from `addedBy` and `completedBy`, which are *history*
   * — who raised it, who finished it. This is a *plan*: who is expected to pick
   * it up, which is the only one of the three that can be wrong about the
   * future and therefore the only one worth editing.
   *
   * Stored as an id rather than a name so a person renamed in the Director
   * roster stays attached to their work. An id whose contact no longer exists
   * is kept rather than dropped — deleting somebody from the roster is not a
   * statement that their work was unassigned — and surfaces as an unresolved
   * assignment the reader can see and fix.
   */
  assigneeId?: string;
  addedAt?: string;
  addedBy?: string;
  completedAt?: string;
  completedBy?: string;
  /**
   * Where this line was imported from, when it was not typed here.
   *
   * Deliberately its own field rather than folded into `origin`. That one
   * answers "which of our registers raised this", and its `sourceId` is
   * documented as content-derived so it survives a re-scan; an import key is
   * assigned by a system outside this repository and a URL points out of it
   * entirely. One field meaning both would make that comment false, and the two
   * offer different actions — a register origin routes to a dashboard page, an
   * import points at a file or a link somewhere else.
   */
  imported?: RoadmapImportRecord;
  /**
   * Workspace-relative path of this item's plan document — its filing record.
   *
   * Written once when the Plan hand-off first creates the scaffold, and stored
   * rather than re-derived: the filename carries a slug of the text, and
   * re-deriving after a rename would point at a file that does not exist while
   * the real plan sits orphaned beside it. Absent means no plan has been filed.
   */
  planPath?: string;
  /** Canvas position. Absent means the layout pass places it. */
  position?: { x: number; y: number };
  /**
   * The register finding this item was raised from, where there is one.
   *
   * Stored on the *roadmap* side rather than on the register's, because the
   * registers do not all survive a re-scan: the gap analysis is regenerated
   * wholesale from a markdown file, so provenance written there would be
   * destroyed the next time it ran. The roadmap node has a durable id and keeps
   * its record through a rename, so it is the end of the link that can actually
   * hold one — and the register page derives "already on the roadmap" by joining
   * back on `sourceId`.
   */
  origin?: RoadmapNodeOrigin;
}

/** Where a roadmap item came from, when it was not typed in by hand. */
export interface RoadmapNodeOrigin {
  kind: 'gap' | 'debt' | 'risk';
  /** The register's own id. Content-derived in all three, so it survives a re-scan. */
  sourceId: string;
  /** What the finding said, so the item can explain itself without the register. */
  sourceTitle: string;
  raisedAt?: string;
}

/** How urgent a node is, given its deadline and the work still ahead of it. */
export type RoadmapScheduleState =
  | 'done'
  | 'no-deadline'
  | 'overdue'
  | 'at-risk'
  | 'due-soon'
  | 'on-track';

export interface RoadmapNodeSchedule {
  state: RoadmapScheduleState;
  /** Whole days until the deadline; negative once it has passed. Absent with no deadline. */
  daysLeft?: number;
  /**
   * This node's own estimate plus every outstanding prerequisite's.
   *
   * The number that decides `at-risk`: a two-day task due in three days reads
   * comfortable until you notice the five-day task it waits on.
   */
  routeDays: number;
  /** The declared reason for this state, shown on the node. */
  reason: string;
}

export interface RoadmapEstimate {
  days: number;
  source: 'declared' | 'derived';
  /** The rule that produced a derived estimate. Published on the node. */
  rule: string;
  aiAssisted: boolean;
  /** The same work graded with the other assistance setting, for the toggle. */
  alternativeDays: number;
}

/** One roadmap item, resolved against the graph. */
export interface RoadmapGraphNode {
  id: string;
  /** The positional `roadmap-N` id every other dashboard surface already uses. */
  itemId: string;
  text: string;
  completed: boolean;
  focus: RoadmapFocus;
  gates: string[];
  priorityScore: number;
  branch: string;
  branchSource: 'declared' | 'derived' | 'unavailable';
  deadline?: string;
  schedule: RoadmapNodeSchedule;
  estimate: RoadmapEstimate;
  /** Who is expected to do this, by Director contact id. A plan, not history. */
  assigneeId?: string;
  /** Where this line was imported from, when it was not typed here. */
  imported?: RoadmapImportRecord;
  /** The item's filed plan document, when one exists. Workspace-relative. */
  planPath?: string;
  addedAt?: string;
  addedBy?: string;
  completedAt?: string;
  completedBy?: string;
  /** The register finding this was raised from, where there is one. */
  origin?: RoadmapNodeOrigin;
  position: { x: number; y: number };
  positionSource: 'declared' | 'derived';
  /**
   * Layer along the reading axis. Longest-path depth, with sources tightened
   * down to one step before their earliest dependent — so a prerequisite sits
   * beside what it unlocks rather than in a giant first row.
   */
  depth: number;
  /** Direct prerequisites, including completed ones — the plan says how you got here. */
  prerequisites: string[];
  dependents: string[];
  /** Prerequisites that are not done. Empty means this node can start now. */
  blockedBy: string[];
}

export interface RoadmapGraph {
  nodes: RoadmapGraphNode[];
  /** Edges somebody drew, or accepted. Drawn solid. */
  edges: RoadmapEdge[];
  /** Edges derived from the rule table and not yet accepted. Drawn dashed. */
  suggested: RoadmapEdge[];
  /** Node ids by depth, so the canvas can label columns without a second walk. */
  layers: string[][];
  /**
   * Declared cycles, named rather than broken.
   *
   * A cycle is a plan that cannot run, and the items in it are the finding.
   * Nodes inside one are still laid out — at the depth of their earliest member
   * — so the canvas draws, but the cycle is reported so it can be fixed.
   */
  cycles: string[][];
  /** What was capped, refused, or could not be derived. Never silently dropped. */
  notes: string[];
  /** The rules that graded this graph, published with it. */
  rules: readonly RoadmapEdgeRule[];
  /**
   * Which way the tree runs.
   *
   * Carried on the graph rather than left for the canvas to infer from the
   * positions: an edge is drawn from the trailing face of one node to the
   * leading face of the next, and "trailing" is a different side in each
   * orientation. Guessing it from coordinates would get it wrong for exactly the
   * nodes somebody has dragged.
   */
  orientation: RoadmapLayoutOrientation;
}

// ── Bounds ────────────────────────────────────────────────────────────────

/** A canvas past this stops being readable, and a layout pass stops being cheap. */
export const MAX_ROADMAP_GRAPH_NODES = 400;
/** Derived fan-in per node. Three suggestions is a prompt; nine is a hairball. */
export const MAX_DERIVED_EDGES_IN = 3;
/** Derived fan-out per node, for the same reason. */
export const MAX_DERIVED_EDGES_OUT = 4;
/** Total derived edges. A backlog of near-duplicates would otherwise pair off. */
export const MAX_DERIVED_EDGES = 120;

export const ROADMAP_COLUMN_WIDTH = 320;
/**
 * Deliberately a multiple of `ROADMAP_GRID_SIZE`, as are the column width and
 * the margin.
 *
 * Snap-to-grid and auto-align have to agree, or turning snapping on and then
 * auto-aligning would leave every node a few pixels off the grid it claims to
 * be on — and the first drag afterwards would jump.
 *
 * Sized for the card as it actually renders, not its nominal minimum: a card
 * carrying a three-line title, a wrapped chip row and a couple of link chips
 * comfortably passes 200px, so the previous pitch of 200 physically overlapped
 * chip-heavy siblings — the layout cannot measure the DOM, so the pitch has to
 * carry the headroom.
 */
export const ROADMAP_ROW_HEIGHT = 260;
export const ROADMAP_CANVAS_MARGIN = 80;
/** The canvas grid. Shared with the webview's snap-to-grid, which mirrors it. */
export const ROADMAP_GRID_SIZE = 20;

/**
 * Which way the tree runs.
 *
 * Both orientations show the same graph; which one is readable depends on its
 * shape. A long chain with little branching reads best left-to-right; a wide,
 * shallow plan reads best top-down. It is a property of *this roadmap* rather
 * than of the person looking, so it lives in the committed file: two people
 * opening the same plan should see the same picture.
 */
export type RoadmapLayoutOrientation = 'horizontal' | 'vertical';

// ── Text handling ─────────────────────────────────────────────────────────

/**
 * Words that carry no subject.
 *
 * Includes the vocabulary the focus classifier keys on (`security`, `refactor`,
 * `docs`…): those words are what makes two items *the same kind of work*, and
 * treating them as shared subject would link every security item to every other
 * one. The subject is what is left after you know the kind.
 */
const SUBJECT_STOPWORDS = new Set<string>([
  'about', 'across', 'after', 'again', 'against', 'along', 'also', 'and', 'another', 'any',
  'anything', 'around', 'back', 'because', 'been', 'before', 'being', 'below', 'better',
  'between', 'both', 'build', 'building', 'built', 'can', 'change', 'changes', 'check',
  'complete', 'covered', 'create', 'current', 'currently', 'does', 'doing', 'done', 'down',
  'each', 'ensure', 'every', 'existing', 'extra', 'fill', 'first', 'fix', 'fixed', 'for',
  'from', 'full', 'get', 'give', 'good', 'handle', 'has', 'have', 'help', 'here', 'how',
  'implement', 'improve', 'into', 'issue', 'issues', 'item', 'items', 'its', 'just', 'keep',
  'known', 'less', 'let', 'like', 'make', 'making', 'more', 'most', 'move', 'much', 'must',
  'need', 'needed', 'needs', 'new', 'next', 'not', 'now', 'off', 'once', 'only', 'onto',
  'open', 'other', 'our', 'out', 'over', 'own', 'part', 'proper', 'properly', 'rest', 'same',
  'see', 'set', 'should', 'show', 'side', 'since', 'small', 'some', 'start', 'still', 'such',
  'support', 'sure', 'take', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'thing', 'things', 'this', 'those', 'through', 'thing', 'time', 'todo', 'too',
  'under', 'until', 'update', 'updated', 'upon', 'use', 'used', 'using', 'very', 'want',
  'was', 'way', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'why', 'will',
  'with', 'within', 'without', 'work', 'working', 'would', 'write', 'writing', 'you', 'your',
  // The focus classifier's own vocabulary. Shared *kind*, not shared subject.
  'architecture', 'architectural', 'build', 'changelog', 'compliance', 'core', 'delivery',
  'deploy', 'design', 'docs', 'documentation', 'lint', 'performance', 'privacy', 'readme',
  'refactor', 'release', 'reliability', 'secure', 'security', 'test', 'testing', 'tests',
  'verification', 'wiki',
]);

/** Distinctive words in an item, lower-cased and de-duplicated in first-seen order. */
export function roadmapSubjectTokens(text: string): string[] {
  if (typeof text !== 'string') {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    // Four characters, because three-letter words in this vocabulary are almost
    // all generic ("api" is the exception and it is not a subject either).
    if (raw.length < 4 || SUBJECT_STOPWORDS.has(raw) || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/** The key the store uses to repair a record whose markdown anchor was lost. */
export function normalizeRoadmapNodeText(text: string): string {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Estimation ────────────────────────────────────────────────────────────

/** Base days by kind of work. Declared, published, and deliberately coarse. */
const ESTIMATE_BASE_DAYS: Readonly<Record<RoadmapFocus, number>> = {
  security: 4,
  architecture: 5,
  delivery: 3,
  feature: 3,
  documentation: 1,
};

/**
 * How much of the work AI assistance actually removes.
 *
 * One number, stated here rather than tuned per node, because a per-node
 * multiplier is a second estimate wearing a discount's clothes. The toggle
 * chooses whether it applies at all; it does not choose how much.
 */
export const AI_ASSIST_MULTIPLIER = 0.45;

/** Never below half a day: a task somebody has to pick up and land costs a session. */
const MIN_ESTIMATE_DAYS = 0.5;

const COMPLEXITY_MARKERS = /\b(migration|migrate|rewrite|re-write|protocol|integration|integrate|end-to-end|distributed|concurrency|scheduler|parser|encryption|multi-tenant)\b/i;

/**
 * Grade an item's effort from the declared table.
 *
 * Deterministic in every input, so the same backlog produces the same plan on
 * two machines — which is what makes a shared canvas worth committing to.
 */
export function estimateRoadmapEffort(
  text: string,
  focus: RoadmapFocus,
  aiAssisted: boolean,
): { days: number; rule: string } {
  const base = ESTIMATE_BASE_DAYS[focus] ?? ESTIMATE_BASE_DAYS.feature;
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  const sizeFactor = words <= 6 ? 0.75 : words <= 14 ? 1 : words <= 25 ? 1.5 : 2;
  const sizeLabel = words <= 6 ? 'a one-liner' : words <= 14 ? 'a normal-sized item' : words <= 25 ? 'a broad item' : 'a very broad item';
  const complexity = COMPLEXITY_MARKERS.test(String(text ?? '')) ? 2 : 0;

  const unassisted = base * sizeFactor + complexity;
  const raw = aiAssisted ? unassisted * AI_ASSIST_MULTIPLIER : unassisted;
  const days = Math.max(MIN_ESTIMATE_DAYS, Math.round(raw * 2) / 2);

  const parts = [
    `${base}d base for ${focus} work`,
    `×${sizeFactor} for ${sizeLabel} (${words} words)`,
  ];
  if (complexity > 0) {
    parts.push(`+${complexity}d for a complexity marker in the text`);
  }
  parts.push(aiAssisted
    ? `×${AI_ASSIST_MULTIPLIER} for AI-assisted coding`
    : 'no AI-assistance discount applied');
  return { days, rule: parts.join(', ') };
}

/** The full estimate for a node, declared value winning over the derived one. */
export function resolveRoadmapEstimate(
  text: string,
  focus: RoadmapFocus,
  record: Pick<RoadmapNodeRecord, 'estimateDays' | 'aiAssisted'> | undefined,
): RoadmapEstimate {
  const aiAssisted = record?.aiAssisted !== false;
  const derived = estimateRoadmapEffort(text, focus, aiAssisted);
  const alternative = estimateRoadmapEffort(text, focus, !aiAssisted);
  const declared = typeof record?.estimateDays === 'number'
    && Number.isFinite(record.estimateDays)
    && record.estimateDays > 0
    ? Math.round(record.estimateDays * 2) / 2
    : undefined;

  return declared === undefined
    ? { days: derived.days, source: 'derived', rule: derived.rule, aiAssisted, alternativeDays: alternative.days }
    : {
      days: declared,
      source: 'declared',
      rule: `Set by hand. The table would have graded this ${derived.days}d (${derived.rule}).`,
      aiAssisted,
      alternativeDays: alternative.days,
    };
}

// ── Scheduling ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a `YYYY-MM-DD` deadline. Anything else is no deadline, never today. */
export function parseRoadmapDeadline(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  // Round-tripped so `2026-02-31` is refused rather than rolling into March.
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : undefined;
}

/** Whole days from `now` to the deadline. Negative once it has passed. */
export function daysUntilDeadline(deadline: string, now: Date): number {
  const target = new Date(`${deadline}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

/**
 * Grade a node's schedule.
 *
 * Evaluated root-cause first: a passed deadline outranks an unaffordable route,
 * which outranks mere proximity. Reporting "due in 2 days" about something that
 * was due last week is the kind of true-but-useless answer that gets a column
 * ignored.
 */
export function describeRoadmapSchedule(input: {
  completed: boolean;
  deadline?: string;
  routeDays: number;
  now: Date;
}): RoadmapNodeSchedule {
  const { completed, deadline, routeDays, now } = input;
  if (completed) {
    return { state: 'done', routeDays: 0, reason: 'Delivered.' };
  }
  if (deadline === undefined) {
    return {
      state: 'no-deadline',
      routeDays,
      reason: `No deadline set. ${routeDays}d of work on this route.`,
    };
  }
  const daysLeft = daysUntilDeadline(deadline, now);
  if (daysLeft < 0) {
    const overdueBy = Math.abs(daysLeft);
    return {
      state: 'overdue',
      daysLeft,
      routeDays,
      reason: `${overdueBy} day${overdueBy === 1 ? '' : 's'} past the deadline.`,
    };
  }
  if (routeDays > daysLeft) {
    return {
      state: 'at-risk',
      daysLeft,
      routeDays,
      reason: `${routeDays}d of work still ahead on this route, and ${daysLeft}d left.`,
    };
  }
  if (daysLeft <= 3) {
    return {
      state: 'due-soon',
      daysLeft,
      routeDays,
      reason: `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}; ${routeDays}d of work left.`,
    };
  }
  return {
    state: 'on-track',
    daysLeft,
    routeDays,
    reason: `${daysLeft} days left, ${routeDays}d of work on this route.`,
  };
}

// ── Edge derivation ───────────────────────────────────────────────────────

/** What derivation is given about each item. Deliberately not the whole node. */
export interface RoadmapDerivationItem {
  id: string;
  text: string;
  focus: RoadmapFocus;
  completed: boolean;
  gates: string[];
  /** Backlog position, lowest first. Breaks ties so derivation cannot shuffle. */
  order: number;
}

export function edgeKey(edge: Pick<RoadmapEdge, 'from' | 'to'>): string {
  return `${edge.from}->${edge.to}`;
}

const EXPLICIT_REFERENCE = /\b(?:after|once|depends\s+on|dependent\s+on|requires?|needs?|blocked\s+by|following)\b([^.;,]{3,80})/gi;

/**
 * Derive the edges nobody drew.
 *
 * Everything here is a *suggestion*. Nothing in this function writes, and its
 * output is kept apart from declared edges all the way to the canvas, because
 * the moment the two are merged there is no way to tell a decision from a
 * keyword match.
 */
export function deriveRoadmapEdges(
  items: readonly RoadmapDerivationItem[],
  declared: readonly RoadmapEdge[],
  options: { gateOrder?: readonly string[] } = {},
): { suggested: RoadmapEdge[]; notes: string[] } {
  const notes: string[] = [];
  const suggested: RoadmapEdge[] = [];
  if (items.length < 2) {
    return { suggested, notes };
  }

  const byId = new Map(items.map(item => [item.id, item]));
  const tokensById = new Map(items.map(item => [item.id, roadmapSubjectTokens(item.text)]));
  const gateOrder = options.gateOrder ?? [];
  const gateRank = new Map(gateOrder.map((gate, index) => [gate, index]));

  // Declared edges are the floor: derivation may not duplicate one, reverse one,
  // or close a cycle with one. The adjacency is seeded with them and grows as
  // suggestions are accepted into it, so two suggestions cannot close a cycle
  // between themselves either.
  const adjacency = new Map<string, Set<string>>();
  const declaredKeys = new Set<string>();
  for (const edge of declared) {
    declaredKeys.add(edgeKey(edge));
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, new Set());
    }
    adjacency.get(edge.from)?.add(edge.to);
  }

  const reaches = (from: string, to: string): boolean => {
    if (from === to) {
      return true;
    }
    const stack = [from];
    const seen = new Set<string>([from]);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const next of adjacency.get(current) ?? []) {
        if (next === to) {
          return true;
        }
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };

  const inCount = new Map<string, number>();
  const outCount = new Map<string, number>();
  let refusedForContradiction = 0;
  let refusedForCycle = 0;
  let refusedForCap = 0;

  const offer = (from: string, to: string, rule: RoadmapEdgeRuleId, evidence: string): void => {
    if (from === to || !byId.has(from) || !byId.has(to)) {
      return;
    }
    const key = edgeKey({ from, to });
    if (declaredKeys.has(key) || suggested.some(edge => edgeKey(edge) === key)) {
      return;
    }
    // Rule 1: a declared edge the other way is a decision. Never argue with it.
    if (declaredKeys.has(edgeKey({ from: to, to: from }))) {
      refusedForContradiction += 1;
      return;
    }
    // Rule 3: acyclic by construction.
    if (reaches(to, from)) {
      refusedForCycle += 1;
      return;
    }
    if (suggested.length >= MAX_DERIVED_EDGES
      || (inCount.get(to) ?? 0) >= MAX_DERIVED_EDGES_IN
      || (outCount.get(from) ?? 0) >= MAX_DERIVED_EDGES_OUT) {
      refusedForCap += 1;
      return;
    }
    suggested.push({ from, to, origin: 'derived', rule, evidence });
    inCount.set(to, (inCount.get(to) ?? 0) + 1);
    outCount.set(from, (outCount.get(from) ?? 0) + 1);
    if (!adjacency.has(from)) {
      adjacency.set(from, new Set());
    }
    adjacency.get(from)?.add(to);
  };

  // Deterministic order in, deterministic suggestions out. Backlog order decides,
  // because it is the one ordering a person actually chose.
  const ordered = [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  // Rule `explicit-reference` — an item that says what it waits for.
  for (const item of ordered) {
    for (const match of String(item.text).matchAll(EXPLICIT_REFERENCE)) {
      const phraseTokens = roadmapSubjectTokens(match[1] ?? '');
      if (phraseTokens.length === 0) {
        continue;
      }
      let best: { id: string; hits: number } | undefined;
      for (const candidate of ordered) {
        if (candidate.id === item.id) {
          continue;
        }
        const candidateTokens = tokensById.get(candidate.id) ?? [];
        const hits = phraseTokens.filter(token => candidateTokens.includes(token)).length;
        // Two hits, or one hit that is the candidate's only subject word — a
        // single common word ("panel") shared with a twelve-word item is not a
        // reference to it.
        const decisive = hits >= 2 || (hits === 1 && candidateTokens.length <= 2);
        if (decisive && (best === undefined || hits > best.hits)) {
          best = { id: candidate.id, hits };
        }
      }
      if (best !== undefined) {
        offer(best.id, item.id, 'explicit-reference', `“${(match[0] ?? '').trim()}”`);
      }
    }
  }

  // Rule `shared-subject-phase` — same subject, one is foundation for the other.
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const left = ordered[i] as RoadmapDerivationItem;
      const right = ordered[j] as RoadmapDerivationItem;
      const leftPhase = FOCUS_PHASE_WEIGHT[left.focus];
      const rightPhase = FOCUS_PHASE_WEIGHT[right.focus];
      if (leftPhase === rightPhase) {
        continue;
      }
      const shared = (tokensById.get(left.id) ?? []).filter(token => (tokensById.get(right.id) ?? []).includes(token));
      if (shared.length < 2) {
        continue;
      }
      const [from, to] = leftPhase < rightPhase ? [left, right] : [right, left];
      offer(from.id, to.id, 'shared-subject-phase', `both mention ${shared.slice(0, 3).map(token => `“${token}”`).join(' and ')}`);
    }
  }

  // Rule `gate-sequence` — same subject, different declared releases.
  if (gateRank.size > 1) {
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const left = ordered[i] as RoadmapDerivationItem;
        const right = ordered[j] as RoadmapDerivationItem;
        const leftRank = minGateRank(left.gates, gateRank);
        const rightRank = minGateRank(right.gates, gateRank);
        if (leftRank === undefined || rightRank === undefined || leftRank === rightRank) {
          continue;
        }
        const shared = (tokensById.get(left.id) ?? []).filter(token => (tokensById.get(right.id) ?? []).includes(token));
        if (shared.length < 1) {
          continue;
        }
        const [from, to] = leftRank < rightRank ? [left, right] : [right, left];
        offer(from.id, to.id, 'gate-sequence', `both mention “${shared[0]}”, on different releases`);
      }
    }
  }

  if (refusedForContradiction > 0) {
    notes.push(`${refusedForContradiction} suggestion${refusedForContradiction === 1 ? '' : 's'} refused for contradicting a link somebody drew.`);
  }
  if (refusedForCycle > 0) {
    notes.push(`${refusedForCycle} suggestion${refusedForCycle === 1 ? '' : 's'} refused because it would have made the plan circular.`);
  }
  if (refusedForCap > 0) {
    notes.push(`${refusedForCap} further suggestion${refusedForCap === 1 ? '' : 's'} not drawn — the per-item and per-board caps were reached.`);
  }
  return { suggested, notes };
}

function minGateRank(gates: readonly string[], rank: Map<string, number>): number | undefined {
  let best: number | undefined;
  for (const gate of gates) {
    const value = rank.get(gate);
    if (value !== undefined && (best === undefined || value < best)) {
      best = value;
    }
  }
  return best;
}

// ── Resolution ────────────────────────────────────────────────────────────

/** One item as the resolver receives it, before the graph is known. */
export interface RoadmapGraphInputItem {
  id: string;
  itemId: string;
  text: string;
  completed: boolean;
  focus: RoadmapFocus;
  gates: string[];
  priorityScore: number;
  order: number;
  /** The branch AtlasMind would derive for this item, when one could be derived. */
  derivedBranch?: string;
}

export interface RoadmapGraphInput {
  items: readonly RoadmapGraphInputItem[];
  records: readonly RoadmapNodeRecord[];
  declaredEdges: readonly RoadmapEdge[];
  /** Declared release gates in declared order, for the `gate-sequence` rule. */
  gateOrder?: readonly string[];
  /** Off when the project has turned auto-derivation off. Suggestions are then empty. */
  deriveSuggestions?: boolean;
  /**
   * Suggestions somebody already said no to.
   *
   * Applied *after* derivation rather than before, so a dismissal never changes
   * which other suggestions the caps let through — otherwise saying no to one
   * link would silently conjure a different one in its place.
   */
  dismissedEdges?: ReadonlyArray<{ from: string; to: string }>;
  /** Which way the tree runs. Defaults to left-to-right. */
  orientation?: RoadmapLayoutOrientation;
  now?: Date;
}

/**
 * Build the graph the canvas draws.
 *
 * Total: every failure mode here — a dangling edge, a cycle, a node past the cap
 * — degrades to a drawable graph carrying a note, because a roadmap page that
 * throws is worse than one that says what it could not do.
 */
export function resolveRoadmapGraph(input: RoadmapGraphInput): RoadmapGraph {
  const now = input.now ?? new Date();
  const notes: string[] = [];

  const orientation = input.orientation ?? 'horizontal';
  let items = [...input.items];
  if (items.length > MAX_ROADMAP_GRAPH_NODES) {
    notes.push(`Showing the first ${MAX_ROADMAP_GRAPH_NODES} of ${items.length} roadmap items. The rest are in the backlog list below.`);
    items = items.slice(0, MAX_ROADMAP_GRAPH_NODES);
  }
  const byId = new Map(items.map(item => [item.id, item]));
  const recordById = new Map(input.records.map(record => [record.id, record]));

  // Declared edges are filtered to nodes that exist. A dangling edge is dropped
  // and counted rather than drawn to nowhere — but the *count* is stated, since
  // silently losing links is exactly how a plan stops being trustworthy.
  const declared: RoadmapEdge[] = [];
  const declaredKeys = new Set<string>();
  let dangling = 0;
  for (const edge of input.declaredEdges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
      dangling += 1;
      continue;
    }
    const key = edgeKey(edge);
    if (declaredKeys.has(key)) {
      continue;
    }
    declaredKeys.add(key);
    declared.push({ ...edge, origin: 'declared' });
  }
  if (dangling > 0) {
    notes.push(`${dangling} saved link${dangling === 1 ? '' : 's'} point at an item that is no longer on the roadmap, and ${dangling === 1 ? 'is' : 'are'} not drawn.`);
  }

  const derivation = input.deriveSuggestions === false
    ? { suggested: [] as RoadmapEdge[], notes: [] as string[] }
    : deriveRoadmapEdges(
      items.map(item => ({
        id: item.id,
        text: item.text,
        focus: item.focus,
        completed: item.completed,
        gates: item.gates,
        order: item.order,
      })),
      declared,
      input.gateOrder === undefined ? {} : { gateOrder: input.gateOrder },
    );
  notes.push(...derivation.notes);

  const dismissedKeys = new Set((input.dismissedEdges ?? []).map(entry => edgeKey(entry)));
  const suggested = derivation.suggested.filter(edge => !dismissedKeys.has(edgeKey(edge)));
  const dismissedCount = derivation.suggested.length - suggested.length;
  if (dismissedCount > 0) {
    notes.push(`${dismissedCount} suggestion${dismissedCount === 1 ? '' : 's'} hidden because ${dismissedCount === 1 ? 'it was' : 'they were'} dismissed before.`);
  }

  // Adjacency from declared edges only. A suggestion is not part of the plan
  // until it is accepted, so it must not move a column or block a node.
  const prerequisites = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const item of items) {
    prerequisites.set(item.id, []);
    dependents.set(item.id, []);
  }
  for (const edge of declared) {
    prerequisites.get(edge.to)?.push(edge.from);
    dependents.get(edge.from)?.push(edge.to);
  }

  const { depths, cycles } = layerGraph(items.map(item => item.id), prerequisites);
  if (cycles.length > 0) {
    notes.push(`${cycles.length} circular dependenc${cycles.length === 1 ? 'y' : 'ies'} found. A plan cannot run in a circle — the items involved are highlighted.`);
  }

  // Route days need prerequisites resolved first, so estimates are computed in
  // depth order and each node adds its own to the worst of its prerequisites'.
  const estimates = new Map<string, RoadmapEstimate>();
  for (const item of items) {
    estimates.set(item.id, resolveRoadmapEstimate(item.text, item.focus, recordById.get(item.id)));
  }
  const routeDays = computeRouteDays(items, prerequisites, depths, estimates, byId);

  const nodes: RoadmapGraphNode[] = items.map(item => {
    const record = recordById.get(item.id);
    const estimate = estimates.get(item.id) as RoadmapEstimate;
    const deadline = parseRoadmapDeadline(record?.deadline);
    const itemPrerequisites = (prerequisites.get(item.id) ?? []).slice().sort();
    const branchDeclared = typeof record?.branch === 'string' && record.branch.trim().length > 0
      ? record.branch.trim()
      : undefined;
    const branch = branchDeclared ?? item.derivedBranch;

    return {
      id: item.id,
      itemId: item.itemId,
      text: item.text,
      completed: item.completed,
      focus: item.focus,
      gates: item.gates,
      priorityScore: item.priorityScore,
      branch: branch ?? '',
      branchSource: branchDeclared !== undefined ? 'declared' : item.derivedBranch === undefined ? 'unavailable' : 'derived',
      ...(deadline === undefined ? {} : { deadline }),
      schedule: describeRoadmapSchedule({
        completed: item.completed,
        ...(deadline === undefined ? {} : { deadline }),
        routeDays: routeDays.get(item.id) ?? estimate.days,
        now,
      }),
      estimate,
      ...(record?.assigneeId === undefined ? {} : { assigneeId: record.assigneeId }),
      ...(record?.imported === undefined ? {} : { imported: record.imported }),
      ...(record?.planPath === undefined ? {} : { planPath: record.planPath }),
      ...(record?.addedAt === undefined ? {} : { addedAt: record.addedAt }),
      ...(record?.addedBy === undefined ? {} : { addedBy: record.addedBy }),
      ...(record?.completedAt === undefined ? {} : { completedAt: record.completedAt }),
      ...(record?.completedBy === undefined ? {} : { completedBy: record.completedBy }),
      ...(record?.origin === undefined ? {} : { origin: record.origin }),
      position: { x: 0, y: 0 },
      positionSource: 'derived',
      depth: depths.get(item.id) ?? 0,
      prerequisites: itemPrerequisites,
      dependents: (dependents.get(item.id) ?? []).slice().sort(),
      blockedBy: itemPrerequisites.filter(id => byId.get(id)?.completed === false),
    };
  });

  applyRoadmapLayout(nodes, recordById, orientation);

  const layerCount = nodes.reduce((max, node) => Math.max(max, node.depth), 0) + 1;
  const layers: string[][] = Array.from({ length: nodes.length === 0 ? 0 : layerCount }, () => []);
  // Ordered along the *cross* axis, which the orientation decides: siblings in a
  // vertical tree sit side by side, so sorting them by `y` would report them in
  // whatever order they happened to be created.
  const across = (node: RoadmapGraphNode): number => (
    orientation === 'vertical' ? node.position.x : node.position.y
  );
  for (const node of [...nodes].sort((left, right) => across(left) - across(right) || left.id.localeCompare(right.id))) {
    layers[node.depth]?.push(node.id);
  }

  return {
    orientation,
    nodes,
    edges: declared,
    suggested,
    layers,
    cycles,
    notes,
    rules: ROADMAP_EDGE_RULES,
  };
}

/**
 * Longest-path depth per node, plus any cycles.
 *
 * Kahn's algorithm, so a cycle is what is *left over* when the queue drains
 * rather than something detected separately. Leftovers are grouped into the
 * strongly-connected sets a person has to look at, and each is placed at the
 * depth of its earliest resolvable neighbour so the canvas can still draw it.
 */
function layerGraph(
  ids: readonly string[],
  prerequisites: Map<string, string[]>,
): { depths: Map<string, number>; cycles: string[][] } {
  const depths = new Map<string, number>();
  const remaining = new Map<string, number>();
  const dependentsOf = new Map<string, string[]>();
  for (const id of ids) {
    remaining.set(id, (prerequisites.get(id) ?? []).length);
    dependentsOf.set(id, []);
  }
  for (const id of ids) {
    for (const from of prerequisites.get(id) ?? []) {
      dependentsOf.get(from)?.push(id);
    }
  }

  const queue = ids.filter(id => (remaining.get(id) ?? 0) === 0).sort();
  for (const id of queue) {
    depths.set(id, 0);
  }
  let head = 0;
  while (head < queue.length) {
    const current = queue[head] as string;
    head += 1;
    for (const next of dependentsOf.get(current) ?? []) {
      depths.set(next, Math.max(depths.get(next) ?? 0, (depths.get(current) ?? 0) + 1));
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) {
        queue.push(next);
      }
    }
  }

  const stuck = ids.filter(id => !depths.has(id));
  if (stuck.length === 0) {
    return { depths, cycles: [] };
  }

  // Everything still stuck is in, or downstream of, a cycle. Group by mutual
  // reachability so the report names a circle rather than a blob.
  const stuckSet = new Set(stuck);
  const cycles: string[][] = [];
  const assigned = new Set<string>();
  for (const id of stuck) {
    if (assigned.has(id)) {
      continue;
    }
    const group = stuck.filter(other => !assigned.has(other)
      && (other === id || (reachesWithin(id, other, prerequisites, stuckSet) && reachesWithin(other, id, prerequisites, stuckSet))));
    for (const member of group) {
      assigned.add(member);
      // Placed after every resolvable prerequisite, so the drawing still reads
      // left-to-right even though the plan itself does not resolve.
      const base = (prerequisites.get(member) ?? [])
        .map(from => depths.get(from))
        .filter((value): value is number => value !== undefined);
      depths.set(member, base.length > 0 ? Math.max(...base) + 1 : 0);
    }
    if (group.length > 1) {
      cycles.push(group.slice().sort());
    }
  }
  return { depths, cycles };
}

/** Can `from` reach `to` through prerequisite edges, staying inside `scope`? */
function reachesWithin(
  from: string,
  to: string,
  prerequisites: Map<string, string[]>,
  scope: Set<string>,
): boolean {
  const stack = [from];
  const seen = new Set<string>([from]);
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const [node, needs] of prerequisites) {
      if (!needs.includes(current) || !scope.has(node)) {
        continue;
      }
      if (node === to) {
        return true;
      }
      if (!seen.has(node)) {
        seen.add(node);
        stack.push(node);
      }
    }
  }
  return false;
}

/**
 * Days of outstanding work on the longest route into each node, inclusive.
 *
 * Completed prerequisites contribute nothing: they are drawn because they
 * explain how you got here, not because anybody still has to do them.
 */
function computeRouteDays(
  items: readonly RoadmapGraphInputItem[],
  prerequisites: Map<string, string[]>,
  depths: Map<string, number>,
  estimates: Map<string, RoadmapEstimate>,
  byId: Map<string, RoadmapGraphInputItem>,
): Map<string, number> {
  const routeDays = new Map<string, number>();
  const ordered = [...items].sort((left, right) => (depths.get(left.id) ?? 0) - (depths.get(right.id) ?? 0));
  for (const item of ordered) {
    const own = item.completed ? 0 : (estimates.get(item.id)?.days ?? 0);
    let worstPrerequisite = 0;
    for (const from of prerequisites.get(item.id) ?? []) {
      if (byId.get(from)?.completed === true) {
        continue;
      }
      worstPrerequisite = Math.max(worstPrerequisite, routeDays.get(from) ?? 0);
    }
    routeDays.set(item.id, Math.round((own + worstPrerequisite) * 2) / 2);
  }
  return routeDays;
}

/**
 * Place every node.
 *
 * A stored position always wins — dragging a node is a statement about how you
 * read the plan, and a layout pass that overrode it would undo the user's work
 * on every refresh. Everything else goes through a small, fully deterministic
 * layered pipeline (a compact Sugiyama), because the naive version of each
 * step is exactly what made a real backlog unreadable: longest-path layering
 * put every parentless item in one first row wider than the plan, priority
 * ordering interleaved unrelated sub-plans so edges swept the whole canvas,
 * and dense packing from the margin left children nowhere near their parents.
 *
 * The steps, in order: tighten sources down beside their earliest dependent;
 * split the graph into connected components and lay each out as its own block;
 * sweep crossings out with alternating barycentre passes; pull coordinates
 * toward each node's neighbours; and park unlinked items in their own compact
 * grid. Each step is commented where it happens.
 */
function applyRoadmapLayout(
  nodes: RoadmapGraphNode[],
  records: Map<string, RoadmapNodeRecord>,
  orientation: RoadmapLayoutOrientation = 'horizontal',
): void {
  const occupied = new Set<string>();
  const cellKey = (x: number, y: number): string => `${Math.round(x / 16)}:${Math.round(y / 16)}`;

  for (const node of nodes) {
    const stored = records.get(node.id)?.position;
    if (stored !== undefined && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      node.position = { x: clampCoordinate(stored.x), y: clampCoordinate(stored.y) };
      node.positionSource = 'declared';
      occupied.add(cellKey(node.position.x, node.position.y));
    }
  }

  const byId = new Map(nodes.map(node => [node.id, node]));

  // ── 1. Tighten the layers ──────────────────────────────────────────────────
  //
  // Longest-path alone puts every parentless item at depth zero — one first
  // row wider than the whole plan, each item half a canvas from what it
  // unlocks. A source node is pulled down to one step before its *earliest*
  // dependent, so a chain reads locally. Only sources move: everything with a
  // prerequisite is already as deep as its longest chain makes it. Dependents
  // are never sources, so the pass is order-independent.
  for (const node of nodes) {
    if (node.prerequisites.length === 0 && node.dependents.length > 0) {
      const earliest = Math.min(...node.dependents.map(id => byId.get(id)?.depth ?? node.depth + 1));
      node.depth = Math.max(node.depth, earliest - 1);
    }
  }

  // Depth always runs along the *reading* axis and siblings along the cross
  // axis, so the two orientations stay one placement rule with its axes
  // swapped rather than two layouts that could drift apart.
  const crossPitch = orientation === 'vertical' ? ROADMAP_COLUMN_WIDTH : ROADMAP_ROW_HEIGHT;
  const readingPitch = orientation === 'vertical' ? ROADMAP_ROW_HEIGHT : ROADMAP_COLUMN_WIDTH;
  const toPosition = (reading: number, cross: number): { x: number; y: number } => (
    orientation === 'vertical' ? { x: cross, y: reading } : { x: reading, y: cross }
  );
  const crossOf = (position: { x: number; y: number }): number => (
    orientation === 'vertical' ? position.x : position.y
  );
  const quantise = (value: number): number =>
    ROADMAP_CANVAS_MARGIN + Math.round((value - ROADMAP_CANVAS_MARGIN) / crossPitch) * crossPitch;
  const mean = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  // ── 2. Connected components ────────────────────────────────────────────────
  //
  // Each component is laid out as its own block along the cross axis rather
  // than interleaved with the others: an edge should never have to cross an
  // unrelated plan's cards to reach its own. Components keep backlog order —
  // the block whose first member ranks highest is read first.
  const componentOf = new Map<string, number>();
  let componentCount = 0;
  for (const node of nodes) {
    if (componentOf.has(node.id)) {
      continue;
    }
    const stack = [node.id];
    componentOf.set(node.id, componentCount);
    while (stack.length > 0) {
      const current = byId.get(stack.pop() as string);
      for (const neighbour of [...(current?.prerequisites ?? []), ...(current?.dependents ?? [])]) {
        if (byId.has(neighbour) && !componentOf.has(neighbour)) {
          componentOf.set(neighbour, componentCount);
          stack.push(neighbour);
        }
      }
    }
    componentCount += 1;
  }

  const isolated: RoadmapGraphNode[] = [];
  const componentMembers = new Map<number, RoadmapGraphNode[]>();
  for (const node of nodes) {
    if (node.positionSource === 'declared') {
      continue;
    }
    if (node.prerequisites.length === 0 && node.dependents.length === 0) {
      isolated.push(node);
      continue;
    }
    const component = componentOf.get(node.id) as number;
    const bucket = componentMembers.get(component) ?? [];
    bucket.push(node);
    componentMembers.set(component, bucket);
  }

  // A hand-placed neighbour counts as an anchor: being dragged somewhere is
  // exactly the kind of statement a dependent should follow.
  const anchorOf = (id: string, coords: Map<string, number>): number | undefined => {
    const placed = coords.get(id);
    if (placed !== undefined) {
      return placed;
    }
    const neighbour = byId.get(id);
    return neighbour !== undefined && neighbour.positionSource === 'declared'
      ? crossOf(neighbour.position)
      : undefined;
  };

  // One ordered walk along a layer: pull each node toward its anchors, then
  // restore left-to-right order, minimum spacing, the component's own band,
  // and any cell a hand-placed node claims.
  const settleLayer = (
    layer: RoadmapGraphNode[],
    base: number,
    coords: Map<string, number>,
    desiredOf: (node: RoadmapGraphNode) => number | undefined,
  ): void => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const node of layer) {
      const desired = desiredOf(node);
      const floor = previous === Number.NEGATIVE_INFINITY ? base : previous + crossPitch;
      let cross = Math.max(desired === undefined ? floor : quantise(desired), floor);
      const reading = ROADMAP_CANVAS_MARGIN + node.depth * readingPitch;
      let position = toPosition(reading, cross);
      while (occupied.has(cellKey(position.x, position.y))) {
        cross += crossPitch;
        position = toPosition(reading, cross);
      }
      coords.set(node.id, cross);
      previous = cross;
    }
  };

  let cursor = ROADMAP_CANVAS_MARGIN;

  for (const [, members] of [...componentMembers.entries()].sort((left, right) => left[0] - right[0])) {
    // ── 3. Order the layers: barycentre sweeps ─────────────────────────────
    //
    // Down over prerequisites, up over dependents, alternating — a single
    // downward pass leaves the crossings the upward relationships know how to
    // untangle. Stable throughout: a node whose links give no signal keeps its
    // place, so priority survives where the plan is silent, and the result is
    // deterministic — two people opening the same roadmap see one picture.
    const depths = [...new Set(members.map(node => node.depth))].sort((a, b) => a - b);
    const layers = depths.map(depth => members
      .filter(node => node.depth === depth)
      .sort((left, right) => right.priorityScore - left.priorityScore || left.id.localeCompare(right.id)));

    const index = new Map<string, number>();
    const reindex = (): void => {
      for (const layer of layers) {
        layer.forEach((node, i) => index.set(node.id, i));
      }
    };
    const orderBy = (
      layer: RoadmapGraphNode[],
      neighboursOf: (node: RoadmapGraphNode) => string[],
    ): RoadmapGraphNode[] => {
      const keyed = layer.map((node, i) => {
        const values = neighboursOf(node)
          .map(id => index.get(id))
          .filter((value): value is number => value !== undefined);
        return { node, i, key: values.length > 0 ? mean(values) : i };
      });
      keyed.sort((left, right) => left.key - right.key || left.i - right.i);
      return keyed.map(entry => entry.node);
    };
    reindex();
    for (let sweep = 0; sweep < 3; sweep += 1) {
      for (let li = 1; li < layers.length; li += 1) {
        layers[li] = orderBy(layers[li] as RoadmapGraphNode[], node => node.prerequisites);
        reindex();
      }
      for (let li = layers.length - 2; li >= 0; li -= 1) {
        layers[li] = orderBy(layers[li] as RoadmapGraphNode[], node => node.dependents);
        reindex();
      }
    }

    // ── 4. Coordinates: children under parents, parents over children ──────
    //
    // A downward pass pulls each node toward the mean of its prerequisites,
    // an upward pass then centres each node over what it unlocks — quantised
    // to the grid, with order, spacing and the component band preserved —
    // instead of packing every layer densely from the margin.
    const coords = new Map<string, number>();
    for (const layer of layers) {
      settleLayer(layer, cursor, coords, node => {
        const anchors = node.prerequisites
          .map(id => anchorOf(id, coords))
          .filter((value): value is number => value !== undefined);
        return anchors.length > 0 ? mean(anchors) : undefined;
      });
    }
    for (let li = layers.length - 2; li >= 0; li -= 1) {
      settleLayer(layers[li] as RoadmapGraphNode[], cursor, coords, node => {
        const anchors = node.dependents
          .map(id => anchorOf(id, coords))
          .filter((value): value is number => value !== undefined);
        return anchors.length > 0 ? mean(anchors) : coords.get(node.id);
      });
    }

    let extent = cursor;
    for (const member of members) {
      const cross = coords.get(member.id) as number;
      member.position = toPosition(ROADMAP_CANVAS_MARGIN + member.depth * readingPitch, cross);
      occupied.add(cellKey(member.position.x, member.position.y));
      extent = Math.max(extent, cross);
    }
    // One empty slot between components, so blocks read as blocks.
    cursor = extent + 2 * crossPitch;
  }

  // ── 5. Unlinked items park in their own compact block ─────────────────────
  //
  // They say nothing about order, so they get a near-square grid after the
  // components rather than one row wider than the whole plan — and they carry
  // no arrows, so the grid cannot be misread as dependency.
  if (isolated.length > 0) {
    const ordered = [...isolated].sort((left, right) =>
      right.priorityScore - left.priorityScore || left.id.localeCompare(right.id));
    const perRow = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
    const lastInRow = new Map<number, number>();
    ordered.forEach((node, i) => {
      const row = Math.floor(i / perRow);
      const reading = ROADMAP_CANVAS_MARGIN + row * readingPitch;
      const slot = cursor + (i % perRow) * crossPitch;
      let cross = Math.max(slot, (lastInRow.get(row) ?? Number.NEGATIVE_INFINITY) + crossPitch);
      let position = toPosition(reading, cross);
      while (occupied.has(cellKey(position.x, position.y))) {
        cross += crossPitch;
        position = toPosition(reading, cross);
      }
      lastInRow.set(row, cross);
      node.position = position;
      occupied.add(cellKey(position.x, position.y));
    });
  }
}

function clampCoordinate(value: number): number {
  return Math.max(0, Math.min(40000, Math.round(value)));
}

// ── Filtering: the route to one node ──────────────────────────────────────

export interface RoadmapRoute {
  /** The node asked about, every prerequisite of it, and nothing else. */
  nodeIds: string[];
  /** Edge keys on that route, so the canvas can hide the rest. */
  edgeKeys: string[];
  /** Outstanding work on the route, in the order it can be done. */
  order: string[];
  /** Days of outstanding work, from the node's own schedule. */
  routeDays: number;
  /** How many prerequisites are already delivered — shown, not hidden. */
  completedCount: number;
}

/**
 * The route to one node: it, and everything that has to happen first.
 *
 * Ancestors only. A node's *dependents* are what it unlocks, which is a
 * different question ("what does this buy me?") and answered by the node's own
 * card — folding them in here would make "the route to X" include work that
 * happens after X, which is the one thing the filter exists to exclude.
 *
 * Completed prerequisites are **kept**: the plan is meant to show how you got
 * here, and a route that silently starts halfway along misrepresents the work.
 */
export function roadmapRouteTo(graph: RoadmapGraph, nodeId: string): RoadmapRoute | undefined {
  const node = graph.nodes.find(candidate => candidate.id === nodeId);
  if (node === undefined) {
    return undefined;
  }
  const byId = new Map(graph.nodes.map(candidate => [candidate.id, candidate]));
  const included = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const from of byId.get(current)?.prerequisites ?? []) {
      if (!included.has(from)) {
        included.add(from);
        stack.push(from);
      }
    }
  }

  const edgeKeys = graph.edges
    .filter(edge => included.has(edge.from) && included.has(edge.to))
    .map(edge => edgeKey(edge));

  const order = [...included]
    .map(id => byId.get(id))
    .filter((candidate): candidate is RoadmapGraphNode => candidate !== undefined && !candidate.completed)
    .sort((left, right) => left.depth - right.depth
      || right.priorityScore - left.priorityScore
      || left.id.localeCompare(right.id))
    .map(candidate => candidate.id);

  return {
    nodeIds: [...included].sort(),
    edgeKeys,
    order,
    routeDays: node.schedule.routeDays,
    completedCount: [...included].filter(id => byId.get(id)?.completed === true).length,
  };
}

// ── The completion canvas ─────────────────────────────────────────────────

export interface RoadmapCompletionPartition {
  /** Nodes the plan canvas draws: everything outstanding, plus completed work still holding something up. */
  active: RoadmapGraphNode[];
  /** Nodes the completion canvas draws: delivered, with nothing outstanding downstream. */
  completed: RoadmapGraphNode[];
  /** Completed nodes kept on the plan because something outstanding still depends on them. */
  retained: RoadmapGraphNode[];
}

/**
 * Decide which canvas each node belongs on.
 *
 * A completed item leaves the plan — that is the point of finishing it — *unless
 * something outstanding still depends on it*, in which case it stays as the
 * left-hand end of a route somebody is still walking. Removing it would leave
 * the dependent node looking like it starts from nothing, which is precisely the
 * misreading the graph exists to prevent.
 *
 * `retained` is reported separately rather than folded into `active`, so the
 * completion canvas can still *list* them: they were delivered, and a record of
 * delivery that omits half the work because it is load-bearing would be a strange
 * record.
 */
export function partitionRoadmapCompletion(graph: RoadmapGraph): RoadmapCompletionPartition {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const active: RoadmapGraphNode[] = [];
  const completed: RoadmapGraphNode[] = [];
  const retained: RoadmapGraphNode[] = [];

  for (const node of graph.nodes) {
    if (!node.completed) {
      active.push(node);
      continue;
    }
    const holdsSomethingUp = node.dependents.some(id => byId.get(id)?.completed === false);
    completed.push(node);
    if (holdsSomethingUp) {
      active.push(node);
      retained.push(node);
    }
  }

  return {
    active,
    completed: completed.sort(completionOrder),
    retained,
  };
}

/**
 * Completion order: when it landed, then the plan's own order.
 *
 * A node with no recorded completion date sorts **last** rather than first. An
 * unknown date is not "the beginning of time", and putting it at the top of a
 * chronology would make the earliest thing on the page the one nobody dated.
 */
function completionOrder(left: RoadmapGraphNode, right: RoadmapGraphNode): number {
  const leftAt = left.completedAt;
  const rightAt = right.completedAt;
  if (leftAt !== undefined && rightAt !== undefined && leftAt !== rightAt) {
    return leftAt < rightAt ? -1 : 1;
  }
  if (leftAt === undefined && rightAt !== undefined) {
    return 1;
  }
  if (leftAt !== undefined && rightAt === undefined) {
    return -1;
  }
  return left.depth - right.depth || left.id.localeCompare(right.id);
}

/**
 * Lay the completion canvas out chronologically.
 *
 * Columns are *months*, not depths: the question this canvas answers is "when
 * did this land, and what did it come after", and a dependency depth would
 * re-tell the plan rather than the history. Rows keep parallel tracks apart, so
 * two streams of work that ran at once read as two streams.
 *
 * Nodes with no completion date are given their own trailing column labelled as
 * undated, rather than being scattered through the timeline at a guessed point.
 */
export function layoutRoadmapCompletion(nodes: readonly RoadmapGraphNode[]): {
  nodes: RoadmapGraphNode[];
  columns: Array<{ label: string; key: string }>;
} {
  const columnKey = (node: RoadmapGraphNode): string => (
    typeof node.completedAt === 'string' && /^\d{4}-\d{2}/.test(node.completedAt)
      ? node.completedAt.slice(0, 7)
      : 'undated'
  );

  const keys = [...new Set(nodes.map(columnKey))].sort((left, right) => {
    if (left === 'undated') { return 1; }
    if (right === 'undated') { return -1; }
    return left < right ? -1 : 1;
  });
  const columnIndex = new Map(keys.map((key, index) => [key, index]));

  const rowByColumn = new Map<string, number>();
  const placed = [...nodes].sort(completionOrder).map(node => {
    const key = columnKey(node);
    const row = rowByColumn.get(key) ?? 0;
    rowByColumn.set(key, row + 1);
    return {
      ...node,
      position: {
        x: ROADMAP_CANVAS_MARGIN + (columnIndex.get(key) ?? 0) * ROADMAP_COLUMN_WIDTH,
        y: ROADMAP_CANVAS_MARGIN + row * ROADMAP_ROW_HEIGHT,
      },
      positionSource: 'derived' as const,
    };
  });

  return {
    nodes: placed,
    columns: keys.map(key => ({
      key,
      label: key === 'undated' ? 'No date recorded' : formatMonthLabel(key),
    })),
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? `${MONTH_NAMES[index]} ${year}` : key;
}

// ── Lanes: the same plan, split by who is doing it ────────────────────────

/** One person's band on the by-assignee canvas. */
export interface RoadmapLane {
  /** Director contact id, or `''` for the unassigned lane. */
  id: string;
  label: string;
  /** How many items sit in this lane. Shown on the label, never inferred. */
  count: number;
  /** Outstanding days of work in the lane. Completed items are excluded. */
  outstandingDays: number;
  /**
   * True when the lane exists only because a contact id on a node matches
   * nobody in the roster. Reported rather than folded into "unassigned":
   * somebody deleted from the Director roster is not the same as work nobody
   * ever picked up, and merging them would silently rewrite a decision.
   */
  unresolved: boolean;
  /** Where the lane starts on the cross axis, so the renderer can label it. */
  offset: number;
  /** How far the lane extends on the cross axis. */
  extent: number;
}

/**
 * The plan grouped by who is doing it.
 *
 * A separate layout rather than an option on the tree pass, for the reason
 * `layoutRoadmapCompletion` is separate: this is a way of *reading* the plan,
 * not the plan's own arrangement. That distinction decides the one rule that
 * would otherwise be wrong — **stored positions are ignored here**. A node
 * dragged into place on the dependency canvas carries a coordinate that means
 * something in that arrangement and nothing in this one; honouring it would put
 * a node in another person's lane, which is the single most misleading thing
 * this view could do. Dragging is not offered here for the same reason.
 *
 * Depth still runs along the reading axis inside each lane, so a lane is that
 * person's own dependency chain rather than an unordered pile. Lanes run along
 * the cross axis, which makes "who is blocked on whom" visible as an arrow
 * crossing between bands — the question this view exists to answer.
 *
 * Ordering is declared, not derived from size: named people first, alphabetical
 * so the same roster always produces the same picture, then unresolved ids,
 * then unassigned last. Sorting by workload would reshuffle the whole canvas
 * every time somebody finished something.
 */
export function layoutRoadmapByAssignee(
  nodes: readonly RoadmapGraphNode[],
  people: ReadonlyArray<{ id: string; name: string }>,
  orientation: RoadmapLayoutOrientation = 'horizontal',
): { nodes: RoadmapGraphNode[]; lanes: RoadmapLane[] } {
  const nameById = new Map(people.map(person => [person.id, person.name]));
  const laneIdOf = (node: RoadmapGraphNode): string => node.assigneeId ?? '';

  const laneIds = [...new Set(nodes.map(laneIdOf))];
  const ordered = laneIds.sort((left, right) => {
    // Unassigned last, always: it is the absence of a decision, not a person.
    if (left === '') { return 1; }
    if (right === '') { return -1; }
    const leftKnown = nameById.has(left);
    const rightKnown = nameById.has(right);
    if (leftKnown !== rightKnown) { return leftKnown ? -1 : 1; }
    const leftLabel = nameById.get(left) ?? left;
    const rightLabel = nameById.get(right) ?? right;
    return leftLabel.localeCompare(rightLabel) || left.localeCompare(right);
  });

  const lanes: RoadmapLane[] = [];
  const placed: RoadmapGraphNode[] = [];
  let offset = ROADMAP_CANVAS_MARGIN;

  for (const laneId of ordered) {
    const members = nodes.filter(node => laneIdOf(node) === laneId);
    // Depth along the reading axis; ties broken on priority then id, so the
    // arrangement is stable across renders.
    const byDepth = new Map<number, RoadmapGraphNode[]>();
    for (const node of [...members].sort((left, right) =>
      left.depth - right.depth
      || right.priorityScore - left.priorityScore
      || left.id.localeCompare(right.id))) {
      const bucket = byDepth.get(node.depth) ?? [];
      bucket.push(node);
      byDepth.set(node.depth, bucket);
    }

    // A lane is as deep as its fullest column, so two lanes never overlap.
    const rows = Math.max(1, ...[...byDepth.values()].map(bucket => bucket.length));
    const extent = rows * ROADMAP_ROW_HEIGHT;

    for (const [depth, bucket] of byDepth.entries()) {
      bucket.forEach((node, row) => {
        const along = ROADMAP_CANVAS_MARGIN + depth * ROADMAP_COLUMN_WIDTH;
        const across = offset + row * ROADMAP_ROW_HEIGHT;
        placed.push({
          ...node,
          position: orientation === 'vertical'
            ? { x: across, y: along }
            : { x: along, y: across },
          positionSource: 'derived',
        });
      });
    }

    lanes.push({
      id: laneId,
      label: laneId === ''
        ? 'Unassigned'
        : nameById.get(laneId) ?? 'No longer in the roster',
      count: members.length,
      outstandingDays: Math.round(members
        .filter(node => !node.completed)
        .reduce((total, node) => total + node.estimate.days, 0) * 2) / 2,
      unresolved: laneId !== '' && !nameById.has(laneId),
      offset,
      extent,
    });
    offset += extent + ROADMAP_ROW_HEIGHT / 2;
  }

  return { nodes: placed, lanes };
}

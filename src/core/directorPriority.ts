/**
 * Two different questions asked of one Project Director config.
 *
 * The sidebar had two views and one answer. `Project State` says *"waiting on
 * you"* and `Project Director` says *"the project"*, and both counted the same
 * set — every due follow-up plus every assignment owned by the configured self
 * contact. On a project where the director and the developer are the same
 * person that is not a coincidence between two readings, it is one reading
 * printed twice, and the second badge then carries no information at all.
 *
 * So the two questions are separated here, and they are genuinely different:
 *
 * - {@link collectSelfWork} — *what is mine*. Named work, for Project State.
 * - {@link buildDirectorPriorities} — *what should the project do first, and
 *   what is somebody else sitting on*. Ranked work, for Project Director.
 *
 * Six rules keep the second one honest:
 *
 * 1. **Mine means named.** An item is mine when it names me. The one exception
 *    is a *solo* project, where an unowned item has nobody else it could belong
 *    to — on a team project an unowned item is nobody's, which is a finding for
 *    the Director view rather than a row on somebody's personal list.
 * 2. **Rank from a declared table, never a model.** Every item names the rule
 *    that graded it, so the grade can be argued with. A ranking produced in
 *    March must be comparable with one produced in July.
 * 3. **Ranked by consequence, not by magnitude.** Declaration order *is* the
 *    ranking: work that other work waits on outranks work that is merely very
 *    late. Ties break on the same order, so the list cannot shuffle between
 *    renders.
 * 4. **An item is graded once.** The first rule that matches owns it, so a
 *    blocked, overdue, stalled assignment appears at its worst grade rather
 *    than three times.
 * 5. **Unassessed is not clear.** Dependency information is optional, and
 *    *absent* means the question was never asked — never "nothing is blocking
 *    anything". A view that reports a quiet project because it did not look is
 *    worse than one that reports nothing at all.
 * 6. **Capped, with the remainder stated.** A list that silently truncates
 *    reads as "that is everything".
 *
 * Pure and `vscode`-free; the clock is injected.
 */

import type {
  Assignment,
  AssignmentPriority,
  DashboardWorkKind,
  FollowUp,
  ProjectDirectorConfig,
} from '../types.js';
import { calendarDaysBetween, deriveFollowUpUrgency, resolveTeamMode } from './projectDirectorManager.js';
import { normalizeRoadmapNodeText } from './roadmapGraph.js';

/** How long work may sit untouched before it is reported as not moving. */
export const STALLED_AFTER_DAYS = 14;

/** How many priority rows are shown before the remainder is summarised. */
export const DIRECTOR_PRIORITY_VISIBLE_CAP = 8;

/**
 * How urgent, in the only three grades this board makes.
 *
 * `blocking` is deliberately narrow — it means *other outstanding work waits on
 * this one* — because making everything the most severe grade is how nothing
 * is. `next` is not a problem at all; it is the answer to "what should I pick
 * up", which is the question the Director view exists to answer.
 */
export type DirectorPrioritySeverity = 'blocking' | 'late' | 'next';

export type DirectorPriorityRuleId =
  | 'blocked-and-blocking'
  | 'blocking-others'
  | 'overdue-follow-up'
  | 'overdue-assignment'
  | 'stalled'
  | 'blocked'
  | 'unowned-active'
  | 'due-soon-follow-up'
  | 'next-up';

export interface DirectorPriorityRule {
  id: DirectorPriorityRuleId;
  severity: DirectorPrioritySeverity;
  /** What had to be true. Published with every item it grades. */
  rule: string;
}

/**
 * The rule table, published and ordered.
 *
 * Order **is** the ranking, and it is an editorial decision rather than an
 * emergent property of counts: one item that three others wait on outranks a
 * pile of individually late ones, and sorting by lateness would let the pile
 * win.
 */
export const DIRECTOR_PRIORITY_RULES: readonly DirectorPriorityRule[] = [
  {
    id: 'blocked-and-blocking',
    severity: 'blocking',
    rule: 'blocked, and other outstanding work declares a dependency on it',
  },
  {
    id: 'blocking-others',
    severity: 'blocking',
    rule: 'other outstanding work declares a dependency on it',
  },
  {
    id: 'overdue-follow-up',
    severity: 'late',
    rule: 'a commitment to a person is past its date',
  },
  {
    id: 'overdue-assignment',
    severity: 'late',
    rule: 'active work is past its due date',
  },
  {
    id: 'stalled',
    severity: 'late',
    rule: `started or blocked, and nothing has been recorded against it for ${STALLED_AFTER_DAYS} days`,
  },
  {
    id: 'blocked',
    severity: 'late',
    rule: 'marked blocked, with nothing on record saying what for',
  },
  {
    id: 'unowned-active',
    severity: 'next',
    rule: 'active work that names nobody',
  },
  {
    id: 'due-soon-follow-up',
    severity: 'next',
    rule: 'a commitment to a person falls due within three days',
  },
  {
    id: 'next-up',
    severity: 'next',
    rule: 'active work, ordered by its declared priority and due date',
  },
];

const RULE_BY_ID = new Map<DirectorPriorityRuleId, DirectorPriorityRule>(
  DIRECTOR_PRIORITY_RULES.map(rule => [rule.id, rule]),
);

/** Where clicking the row should land. */
export type DirectorPriorityDestination = DashboardWorkKind | 'run' | 'director';

export interface DirectorPriorityItem {
  /** Stable across renders: rule id plus the record it was graded from. */
  id: string;
  ruleId: DirectorPriorityRuleId;
  /** The published rule text, carried so the row can explain its own grade. */
  rule: string;
  severity: DirectorPrioritySeverity;
  title: string;
  /** One line: why it is here, and who it is with. */
  detail: string;
  /** True when the configured self contact owns it. */
  mine: boolean;
  /** The owner's display name, when the roster knows one. */
  ownerName?: string;
  source: { kind: 'assignment' | 'follow-up'; id: string };
  destination: DirectorPriorityDestination;
  /** The id to focus on the destination surface. */
  targetId: string;
  /** Days past due, or days since anything was recorded — whichever the rule measured. */
  ageDays?: number;
  /** Outstanding work waiting on this one. Only set by the two blocking rules. */
  waitingCount?: number;
}

/**
 * Everything the board reads.
 *
 * `dependents` is the field rule 5 is about: **absent means the question was
 * never asked**. A caller that could not read the dependency graph passes
 * nothing and the board says so, rather than quietly grading every item as
 * blocking nobody.
 */
export interface DirectorPriorityInput {
  config?: ProjectDirectorConfig;
  now?: Date;
  /**
   * How many outstanding items wait on a piece of linked work, keyed
   * `${kind}:${id}` to match `Assignment.linkedWork`. An empty map is a real
   * answer — "nothing waits on anything" — and is not the same as absent.
   */
  dependents?: ReadonlyMap<string, number>;
}

export interface DirectorPriorityBoard {
  items: DirectorPriorityItem[];
  /** Everything that qualified, before the cap. */
  totalCount: number;
  /** Qualifying items not shown, so truncation is never silent. */
  droppedByCap: number;
  /** Items graded `blocking` or `late`. What a badge should count. */
  flaggedCount: number;
  /** Flagged items owned by somebody other than the configured self contact. */
  flaggedElsewhereCount: number;
  /** False when no dependency information was supplied at all. */
  dependenciesAssessed: boolean;
  /**
   * True when at least one active item links to work a dependency graph could
   * have had something to say about. Without this a project with no linked work
   * would carry a permanent "not assessed" caveat about a question that could
   * never have had an answer.
   */
  dependenciesMatter: boolean;
  /**
   * What to say when nothing qualifies.
   *
   * `clear` and `unexamined` are different claims: one says the roster was read
   * and everything in it is fine, the other says there is nothing in the roster
   * to read. Reporting the second as the first congratulates a project for
   * never having written anything down.
   */
  emptyState?: 'clear' | 'unexamined';
  /** The one-line headline, computed here so two renderers cannot phrase it differently. */
  summary: string;
}

export interface DirectorSelfWork {
  /** Due or overdue follow-ups this person owns. */
  followUps: FollowUp[];
  /** Active assignments this person owns. */
  assignments: Assignment[];
}

function isActive(assignment: Assignment): boolean {
  return assignment.status !== 'done' && assignment.status !== 'cancelled';
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function priorityRank(priority: AssignmentPriority): number {
  return PRIORITY_RANK[priority] ?? 1;
}

/**
 * Whether an unowned record falls to the configured self contact.
 *
 * Only on a solo project, where there is nobody else it could be. On a team
 * project an unowned item is *nobody's*, which the Director board reports as a
 * finding — putting it on one person's personal list would quietly assign it.
 */
function unownedIsMine(config: ProjectDirectorConfig): boolean {
  return resolveTeamMode(config) === 'solo';
}

function ownsRecord(config: ProjectDirectorConfig, ownerContactId: string | undefined): boolean {
  if (ownerContactId) {
    return Boolean(config.selfContactId) && ownerContactId === config.selfContactId;
  }
  return unownedIsMine(config);
}

/**
 * What is mine — the Project State view's question.
 *
 * Follow-ups are scoped by owner, which is the fix this module exists for: the
 * previous collector took *every* due follow-up regardless of who owned it, so
 * a director's personal list was the whole project's list, and the two sidebar
 * views agreed because they were asking one question twice.
 */
export function collectSelfWork(
  config: ProjectDirectorConfig | undefined,
  now: Date = new Date(),
): DirectorSelfWork {
  if (!config) {
    return { followUps: [], assignments: [] };
  }
  const followUps = config.followUps.filter(followUp => {
    const urgency = deriveFollowUpUrgency(followUp, now);
    return (urgency === 'overdue' || urgency === 'due-soon')
      && ownsRecord(config, followUp.ownerContactId);
  });
  const assignments = config.assignments.filter(assignment =>
    isActive(assignment) && ownsRecord(config, assignment.assigneeContactId));
  return { followUps, assignments };
}

function linkedWorkKey(assignment: Assignment): string | undefined {
  return assignment.linkedWork ? `${assignment.linkedWork.kind}:${assignment.linkedWork.id}` : undefined;
}

/** The parts of `roadmap-graph.json` this join needs, structurally. */
export interface RoadmapDependencyReading {
  nodes: ReadonlyArray<{ id: string; normalizedText: string; completedAt?: string }>;
  edges: ReadonlyArray<{ from: string; to: string; origin: string }>;
}

/**
 * Turn the roadmap graph into the `dependents` map, keyed the way Director
 * assignments are actually keyed.
 *
 * **The two sides do not share an id, and that is the whole difficulty.** A
 * Director assignment on a roadmap item carries the *positional* `roadmap-3`
 * every dashboard surface uses, while the graph is keyed on the durable node id
 * the markdown line carries as an invisible anchor. Joining on id alone would
 * match nothing, and the blocking rule would quietly never fire — a rule that
 * silently never fires is worse than one that is absent, because the board
 * would still read as having looked.
 *
 * So the join goes through the item's **text**, which both sides hold: the
 * assignment's title is the roadmap line it was created from, and the node
 * record stores that line's normalized form. This is the same repair path
 * `roadmapGraphStore` uses when an anchor is lost, and it is deliberately
 * biased to false negatives — a renamed item stops matching and is simply not
 * flagged, rather than adopting whatever text took its place.
 *
 * Only **declared** edges count. A derived suggestion is a keyword match nobody
 * has accepted, and it must not tell somebody their colleague is holding up the
 * release. A dependent counts as still waiting unless its record says it was
 * completed: only a recorded completion is evidence that it landed.
 */
export function roadmapDependentsForAssignments(
  reading: RoadmapDependencyReading,
  assignments: readonly Assignment[],
): ReadonlyMap<string, number> {
  const completed = new Set(reading.nodes.filter(node => node.completedAt).map(node => node.id));
  const waitingByNode = new Map<string, number>();
  for (const edge of reading.edges) {
    if (edge.origin !== 'declared' || completed.has(edge.to)) { continue; }
    waitingByNode.set(edge.from, (waitingByNode.get(edge.from) ?? 0) + 1);
  }

  const nodeIdByText = new Map<string, string>();
  for (const node of reading.nodes) {
    // First record wins: two lines with the same text is a duplicate in the
    // backlog, and picking the later one would move the count between renders.
    if (node.normalizedText && !nodeIdByText.has(node.normalizedText)) {
      nodeIdByText.set(node.normalizedText, node.id);
    }
  }

  const dependents = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.linkedWork?.kind !== 'roadmap') { continue; }
    const nodeId = nodeIdByText.get(normalizeRoadmapNodeText(assignment.title));
    const waiting = nodeId ? waitingByNode.get(nodeId) ?? 0 : 0;
    if (waiting > 0) {
      dependents.set(`roadmap:${assignment.linkedWork.id}`, waiting);
    }
  }
  return dependents;
}

function destinationOf(assignment: Assignment): { destination: DirectorPriorityDestination; targetId: string } {
  if (assignment.linkedWork) {
    return { destination: assignment.linkedWork.kind, targetId: assignment.linkedWork.id };
  }
  if (assignment.linkedRunId) {
    return { destination: 'run', targetId: assignment.linkedRunId };
  }
  return { destination: 'director', targetId: assignment.id };
}

/** Days since anything was recorded against an assignment, when that is knowable. */
function idleDays(assignment: Assignment, now: Date): number | undefined {
  const moved = assignment.updatedAt || assignment.createdAt;
  return moved ? calendarDaysBetween(moved, now) : undefined;
}

/** Days past due, when a due date was declared and is readable. */
function overdueDays(due: string | undefined, now: Date): number | undefined {
  if (!due) { return undefined; }
  const days = calendarDaysBetween(due, now);
  return days !== undefined && days > 0 ? days : undefined;
}

interface Candidate {
  ruleId: DirectorPriorityRuleId;
  item: Omit<DirectorPriorityItem, 'rule' | 'severity'>;
  /** Within a rule, larger sorts first. */
  weight: number;
}

/**
 * Build the ranked board.
 *
 * Rules are evaluated in declaration order and each record is graded by the
 * first rule that matches it, so an item appears once at its worst grade.
 */
export function buildDirectorPriorities(input: DirectorPriorityInput): DirectorPriorityBoard {
  const config = input.config;
  const now = input.now ?? new Date();
  const dependents = input.dependents;
  const dependenciesAssessed = dependents !== undefined;

  if (!config) {
    return {
      items: [],
      totalCount: 0,
      droppedByCap: 0,
      flaggedCount: 0,
      flaggedElsewhereCount: 0,
      dependenciesAssessed,
      dependenciesMatter: false,
      emptyState: 'unexamined',
      summary: 'The Project Director roster has not been read.',
    };
  }

  const nameOf = (contactId: string | undefined): string | undefined =>
    (contactId ? config.contacts.find(contact => contact.id === contactId)?.name : undefined);

  const active = config.assignments.filter(isActive);
  const dueFollowUps = config.followUps.filter(followUp => {
    const urgency = deriveFollowUpUrgency(followUp, now);
    return urgency === 'overdue' || urgency === 'due-soon';
  });
  const dependenciesMatter = active.some(assignment => linkedWorkKey(assignment) !== undefined);

  const candidates: Candidate[] = [];
  const graded = new Set<string>();

  const withWhom = (name: string | undefined, mine: boolean): string =>
    (mine ? 'Yours.' : name ? `With ${name}.` : 'Nobody owns it.');

  const gradeAssignment = (
    assignment: Assignment,
    ruleId: DirectorPriorityRuleId,
    detail: string,
    extra: { ageDays?: number; waitingCount?: number; weight?: number } = {},
  ): void => {
    if (graded.has(assignment.id)) { return; }
    graded.add(assignment.id);
    const { destination, targetId } = destinationOf(assignment);
    const ownerName = nameOf(assignment.assigneeContactId);
    candidates.push({
      ruleId,
      weight: extra.weight ?? extra.waitingCount ?? extra.ageDays ?? -priorityRank(assignment.priority),
      item: {
        id: `${ruleId}:${assignment.id}`,
        ruleId,
        title: assignment.title,
        detail,
        mine: ownsRecord(config, assignment.assigneeContactId),
        ...(ownerName ? { ownerName } : {}),
        source: { kind: 'assignment', id: assignment.id },
        destination,
        targetId,
        ...(extra.ageDays !== undefined ? { ageDays: extra.ageDays } : {}),
        ...(extra.waitingCount !== undefined ? { waitingCount: extra.waitingCount } : {}),
      },
    });
  };

  const gradeFollowUp = (
    followUp: FollowUp,
    ruleId: DirectorPriorityRuleId,
    detail: string,
    ageDays?: number,
  ): void => {
    if (graded.has(followUp.id)) { return; }
    graded.add(followUp.id);
    const ownerName = nameOf(followUp.ownerContactId);
    candidates.push({
      ruleId,
      weight: ageDays ?? 0,
      item: {
        id: `${ruleId}:${followUp.id}`,
        ruleId,
        title: followUp.title,
        detail,
        mine: ownsRecord(config, followUp.ownerContactId),
        ...(ownerName ? { ownerName } : {}),
        source: { kind: 'follow-up', id: followUp.id },
        destination: 'director',
        targetId: followUp.id,
        ...(ageDays !== undefined ? { ageDays } : {}),
      },
    });
  };

  // ── blocking: other work waits on this one ────────────────────────
  if (dependents) {
    for (const assignment of active) {
      const key = linkedWorkKey(assignment);
      const waiting = key ? dependents.get(key) ?? 0 : 0;
      if (waiting <= 0) { continue; }
      const name = nameOf(assignment.assigneeContactId);
      const mine = ownsRecord(config, assignment.assigneeContactId);
      const plural = waiting === 1 ? 'item' : 'items';
      if (assignment.status === 'blocked') {
        gradeAssignment(
          assignment,
          'blocked-and-blocking',
          `Blocked, and ${waiting} outstanding ${plural} cannot start until it lands. ${withWhom(name, mine)}`,
          { waitingCount: waiting, weight: 1000 + waiting },
        );
      } else {
        gradeAssignment(
          assignment,
          'blocking-others',
          `${waiting} outstanding ${plural} cannot start until it lands. ${withWhom(name, mine)}`,
          { waitingCount: waiting },
        );
      }
    }
  }

  // ── late: past a date, or not moving ──────────────────────────────
  for (const followUp of dueFollowUps) {
    if (deriveFollowUpUrgency(followUp, now) !== 'overdue') { continue; }
    const days = overdueDays(followUp.dueDate, now);
    const name = nameOf(followUp.ownerContactId);
    const mine = ownsRecord(config, followUp.ownerContactId);
    gradeFollowUp(
      followUp,
      'overdue-follow-up',
      days === undefined
        ? `Past its date of ${followUp.dueDate}. ${withWhom(name, mine)}`
        : `${days} day${days === 1 ? '' : 's'} past its date. ${withWhom(name, mine)}`,
      days,
    );
  }

  for (const assignment of active) {
    const days = overdueDays(assignment.due, now);
    if (days === undefined) { continue; }
    const name = nameOf(assignment.assigneeContactId);
    const mine = ownsRecord(config, assignment.assigneeContactId);
    gradeAssignment(
      assignment,
      'overdue-assignment',
      `${days} day${days === 1 ? '' : 's'} past its due date. ${withWhom(name, mine)}`,
      { ageDays: days },
    );
  }

  for (const assignment of active) {
    if (assignment.status !== 'in-progress' && assignment.status !== 'blocked') { continue; }
    const idle = idleDays(assignment, now);
    // An unknown age is not a long one. A record carrying no dates cannot be
    // shown as stalled, because "nothing recorded for N days" would be a claim
    // about a measurement nobody took.
    if (idle === undefined || idle < STALLED_AFTER_DAYS) { continue; }
    const name = nameOf(assignment.assigneeContactId);
    const mine = ownsRecord(config, assignment.assigneeContactId);
    gradeAssignment(
      assignment,
      'stalled',
      `${assignment.status === 'blocked' ? 'Blocked' : 'In progress'} with nothing recorded for ${idle} days. ${withWhom(name, mine)}`,
      { ageDays: idle },
    );
  }

  for (const assignment of active) {
    if (assignment.status !== 'blocked') { continue; }
    const name = nameOf(assignment.assigneeContactId);
    const mine = ownsRecord(config, assignment.assigneeContactId);
    gradeAssignment(
      assignment,
      'blocked',
      `Marked blocked. Nothing on record says what for. ${withWhom(name, mine)}`,
    );
  }

  // ── next: what to pick up ─────────────────────────────────────────
  for (const assignment of active) {
    if (assignment.assigneeContactId || unownedIsMine(config)) { continue; }
    gradeAssignment(
      assignment,
      'unowned-active',
      `${assignment.priority} priority and nobody owns it. Work nobody is named on is work nobody starts.`,
      { weight: -priorityRank(assignment.priority) },
    );
  }

  for (const followUp of dueFollowUps) {
    const name = nameOf(followUp.ownerContactId);
    const mine = ownsRecord(config, followUp.ownerContactId);
    gradeFollowUp(
      followUp,
      'due-soon-follow-up',
      `Due ${followUp.dueDate}. ${withWhom(name, mine)}`,
    );
  }

  for (const assignment of active) {
    const name = nameOf(assignment.assigneeContactId);
    const mine = ownsRecord(config, assignment.assigneeContactId);
    const status = String(assignment.status).replace(/-/g, ' ');
    gradeAssignment(
      assignment,
      'next-up',
      `${assignment.priority} priority, ${status}. ${withWhom(name, mine)}`,
      { weight: -priorityRank(assignment.priority) },
    );
  }

  // Rule order is the ranking. Within a rule, the heavier item first, then the
  // title — so the list is fully determined and cannot shuffle between renders.
  const ruleOrder = new Map(DIRECTOR_PRIORITY_RULES.map((rule, index) => [rule.id, index]));
  candidates.sort((a, b) => {
    const byRule = (ruleOrder.get(a.ruleId) ?? 0) - (ruleOrder.get(b.ruleId) ?? 0);
    if (byRule !== 0) { return byRule; }
    if (a.weight !== b.weight) { return b.weight - a.weight; }
    return a.item.title.localeCompare(b.item.title);
  });

  const all: DirectorPriorityItem[] = candidates.map(candidate => {
    const rule = RULE_BY_ID.get(candidate.ruleId);
    return {
      ...candidate.item,
      rule: rule?.rule ?? candidate.ruleId,
      severity: rule?.severity ?? 'next',
    };
  });

  const flagged = all.filter(item => item.severity !== 'next');
  const items = all.slice(0, DIRECTOR_PRIORITY_VISIBLE_CAP);
  const nothingRecorded = config.assignments.length === 0 && config.followUps.length === 0;

  return {
    items,
    totalCount: all.length,
    droppedByCap: Math.max(0, all.length - items.length),
    flaggedCount: flagged.length,
    flaggedElsewhereCount: flagged.filter(item => !item.mine).length,
    dependenciesAssessed,
    dependenciesMatter,
    ...(all.length === 0
      ? { emptyState: (nothingRecorded ? 'unexamined' : 'clear') as 'unexamined' | 'clear' }
      : {}),
    summary: summarize(all, flagged, nothingRecorded, dependenciesAssessed, dependenciesMatter),
  };
}

function summarize(
  all: readonly DirectorPriorityItem[],
  flagged: readonly DirectorPriorityItem[],
  nothingRecorded: boolean,
  dependenciesAssessed: boolean,
  dependenciesMatter: boolean,
): string {
  const caveat = !dependenciesAssessed && dependenciesMatter
    ? ' Nothing was read about what depends on what, so blocking work was not assessed.'
    : '';
  if (all.length === 0) {
    return (nothingRecorded
      ? 'No assignments or follow-ups have been recorded, so there is nothing to rank.'
      : 'Nothing is late, blocked, or waiting to be picked up.') + caveat;
  }
  const blocking = flagged.filter(item => item.severity === 'blocking').length;
  const late = flagged.length - blocking;
  const parts: string[] = [];
  if (blocking > 0) { parts.push(`${blocking} holding up other work`); }
  if (late > 0) { parts.push(`${late} late or not moving`); }
  const rest = all.length - flagged.length;
  if (rest > 0) { parts.push(`${rest} ready to pick up`); }
  return `${parts.join(', ')}.${caveat}`;
}

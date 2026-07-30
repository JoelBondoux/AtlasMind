/**
 * What the board has, and what it has not — a record, never a gate.
 *
 * The ideation panel could already tell you how many cards were on the board. It
 * could not tell you the thing anyone actually wants to know before acting on it:
 * whether the board contains an argument or just a pile of assertions. Five
 * `idea` cards, no evidence, an unresolved contradiction and nothing that ever
 * reached the backlog is a very specific state, and it looked identical to a
 * finished board with the same card count.
 *
 * Four decisions.
 *
 * **Nothing here blocks anything.** `releasePreparation` gates a release because
 * a release cannot be undone; a board can always be edited, so a gate would be
 * theatre with a cost. What this produces is a *reading*, and a reading is
 * allowed to be ignored.
 *
 * **Every check names the rule that produced it.** Same argument as the debt
 * register and the attention feed: a verdict you cannot check is a verdict you
 * can only trust or ignore, and people choose ignore.
 *
 * **Unassessed is not clear.** A board with no cards is not a healthy board; it
 * is one nobody has started. The two must produce different readings, or the
 * panel congratulates you for an empty canvas.
 *
 * **An unresolved contradiction outranks everything.** The board is the one place
 * in AtlasMind that records an argument *against* doing something, and a reading
 * that buried that under "3 cards have no evidence" would waste the only thing
 * this surface knows that an issue tracker does not.
 *
 * Pure: no `vscode`, no I/O, no clock.
 */

import { isDerivableCardKind, type IdeationDerivedRecord } from './ideationDerivation.js';

export interface ReadinessCard {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly archived?: boolean;
  readonly derived?: IdeationDerivedRecord;
}

export interface ReadinessConnection {
  readonly fromCardId: string;
  readonly toCardId: string;
  readonly relation: 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
}

export interface ReadinessRoadmapItem {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
}

export interface IdeationReadinessInput {
  readonly cards: readonly ReadinessCard[];
  readonly connections: readonly ReadinessConnection[];
  readonly roadmapItems: readonly ReadinessRoadmapItem[];
}

/** How much a reading is worth acting on. Ordered by consequence. */
export type ReadinessTone = 'blocking' | 'weak' | 'good' | 'unassessed';

export interface ReadinessObservation {
  readonly id: string;
  readonly tone: ReadinessTone;
  readonly label: string;
  readonly detail: string;
  /** The declared rule that produced it, published so it can be argued with. */
  readonly rule: string;
  readonly count?: number;
}

export interface IdeationReadiness {
  readonly observations: readonly ReadinessObservation[];
  readonly activeCards: number;
  readonly evidenceCards: number;
  readonly unrealized: number;
  readonly contradictions: number;
  /** `unexamined` when the board is empty. Never `clear` in that case. */
  readonly state: 'unexamined' | 'developing' | 'argued';
  readonly summary: string;
}

interface ReadinessRule {
  readonly id: string;
  readonly tone: ReadinessTone;
  readonly rule: string;
  readonly evaluate: (facts: ReadinessFacts) => { label: string; detail: string; count?: number } | undefined;
}

interface ReadinessFacts {
  readonly activeCards: number;
  readonly evidenceCards: number;
  readonly problemCards: number;
  readonly ideaCards: number;
  readonly experimentCards: number;
  readonly riskCards: number;
  readonly requirementCards: number;
  readonly contradictions: number;
  readonly unrealized: number;
  readonly realized: number;
  readonly orphanCards: number;
  readonly unsupportedProblems: number;
}

/**
 * The rule table. Order **is** the ranking, and it is an editorial decision:
 * an argument against the work outranks a gap in the work's support, which
 * outranks a board that has never left the whiteboard.
 */
const RULES: readonly ReadinessRule[] = [
  {
    id: 'contradiction-open',
    tone: 'blocking',
    rule: 'any contradiction edge on the board',
    evaluate: facts => (facts.contradictions > 0
      ? {
        label: `${facts.contradictions} unresolved contradiction${facts.contradictions === 1 ? '' : 's'}`,
        detail: 'A card on this board argues against another. Raising work while hiding that is the '
          + 'worst use of a board that recorded the argument.',
        count: facts.contradictions,
      }
      : undefined),
  },
  {
    id: 'board-empty',
    tone: 'unassessed',
    rule: 'no active cards',
    evaluate: facts => (facts.activeCards === 0
      ? {
        label: 'Nothing on the board',
        detail: 'Not a clean board — an unstarted one. Pick a starter frame, or describe the problem '
          + 'in the composer and let Atlas scaffold it.',
      }
      : undefined),
  },
  {
    id: 'no-evidence',
    tone: 'weak',
    rule: 'active cards, and no evidence card among them',
    evaluate: facts => (facts.activeCards > 0 && facts.evidenceCards === 0
      ? {
        label: 'No evidence recorded',
        detail: 'Every card here is something somebody thinks. A research scan or an evidence card '
          + 'is what turns that into something somebody can check.',
      }
      : undefined),
  },
  {
    id: 'unsupported-problems',
    tone: 'weak',
    rule: 'a problem card with no supporting or causal edge',
    evaluate: facts => (facts.unsupportedProblems > 0
      ? {
        label: `${facts.unsupportedProblems} problem${facts.unsupportedProblems === 1 ? '' : 's'} with nothing behind ${facts.unsupportedProblems === 1 ? 'it' : 'them'}`,
        detail: 'Stated, but nothing on the board says why it is true. These become backlog items '
          + 'nobody can defend six weeks later.',
        count: facts.unsupportedProblems,
      }
      : undefined),
  },
  {
    id: 'assertion-heavy',
    tone: 'weak',
    rule: 'more ideas than problems, requirements and experiments combined',
    evaluate: facts => (facts.ideaCards > facts.problemCards + facts.requirementCards + facts.experimentCards
      && facts.ideaCards > 2
      ? {
        label: 'Mostly ideas',
        detail: `${facts.ideaCards} ideas against ${facts.problemCards + facts.requirementCards + facts.experimentCards} `
          + 'problems, requirements and experiments. A board of ideas is a wish list.',
        count: facts.ideaCards,
      }
      : undefined),
  },
  {
    id: 'no-risk',
    tone: 'weak',
    rule: 'four or more active cards and no risk card',
    evaluate: facts => (facts.activeCards >= 4 && facts.riskCards === 0
      ? {
        label: 'Nothing could go wrong',
        detail: 'No risk card on a board this size usually means the risks have not been looked for '
          + 'rather than that there are none.',
      }
      : undefined),
  },
  {
    id: 'orphans',
    tone: 'weak',
    rule: 'an active card with no connection at all',
    evaluate: facts => (facts.orphanCards > 0
      ? {
        label: `${facts.orphanCards} unconnected card${facts.orphanCards === 1 ? '' : 's'}`,
        detail: 'Connections are what this board knows that a list of notes does not. An unconnected '
          + 'card carries no argument into the backlog.',
        count: facts.orphanCards,
      }
      : undefined),
  },
  {
    id: 'never-realized',
    tone: 'weak',
    rule: 'cards that could become work, and none has',
    evaluate: facts => (facts.unrealized > 0 && facts.realized === 0
      ? {
        label: `${facts.unrealized} card${facts.unrealized === 1 ? '' : 's'} never became work`,
        detail: 'Nothing on this board has reached the roadmap. A board that never leaves the '
          + 'whiteboard is a board nobody will keep updating.',
        count: facts.unrealized,
      }
      : undefined),
  },
  {
    id: 'reaching-backlog',
    tone: 'good',
    rule: 'at least one card has become a roadmap item',
    evaluate: facts => (facts.realized > 0
      ? {
        label: `${facts.realized} card${facts.realized === 1 ? '' : 's'} became work`,
        detail: 'This board is feeding the backlog, which is what stage 0 is for.',
        count: facts.realized,
      }
      : undefined),
  },
  {
    id: 'evidence-backed',
    tone: 'good',
    rule: 'at least one evidence card and one supporting edge',
    evaluate: facts => (facts.evidenceCards > 0 && facts.unsupportedProblems === 0 && facts.problemCards > 0
      ? {
        label: 'Problems are evidenced',
        detail: 'Every problem on the board has something behind it.',
        count: facts.evidenceCards,
      }
      : undefined),
  },
];

export function assessIdeationReadiness(input: IdeationReadinessInput): IdeationReadiness {
  const active = input.cards.filter(card => card.archived !== true);
  const activeIds = new Set(active.map(card => card.id));
  const countKind = (kind: string): number => active.filter(card => card.kind === kind).length;

  // Only edges between two cards that are still on the board. An edge to an
  // archived card is not an argument anybody can read.
  const liveEdges = input.connections.filter(edge =>
    activeIds.has(edge.fromCardId) && activeIds.has(edge.toCardId));

  const connectedIds = new Set<string>();
  for (const edge of liveEdges) {
    connectedIds.add(edge.fromCardId);
    connectedIds.add(edge.toCardId);
  }

  const supportedIds = new Set<string>();
  for (const edge of liveEdges) {
    if (edge.relation === 'supports' || edge.relation === 'causal') {
      // Direction matters: "evidence supports problem" points at the problem.
      supportedIds.add(edge.toCardId);
    }
  }

  const roadmapKeys = new Set(input.roadmapItems.map(item => normalizeRoadmapKey(item.text)));
  const derivable = active.filter(card => isDerivableCardKind(card.kind));
  const realized = derivable.filter(card =>
    card.derived !== undefined && roadmapKeys.has(card.derived.roadmapNormalized)).length;

  const facts: ReadinessFacts = {
    activeCards: active.length,
    evidenceCards: countKind('evidence'),
    problemCards: countKind('problem'),
    ideaCards: countKind('idea'),
    experimentCards: countKind('experiment'),
    riskCards: countKind('risk'),
    requirementCards: countKind('requirement'),
    contradictions: liveEdges.filter(edge => edge.relation === 'contradiction').length,
    unrealized: derivable.length - realized,
    realized,
    orphanCards: active.filter(card => !connectedIds.has(card.id)).length,
    unsupportedProblems: active.filter(card => card.kind === 'problem' && !supportedIds.has(card.id)).length,
  };

  const observations: ReadinessObservation[] = [];
  for (const rule of RULES) {
    const hit = rule.evaluate(facts);
    if (hit) {
      observations.push({
        id: rule.id,
        tone: rule.tone,
        rule: rule.rule,
        label: hit.label,
        detail: hit.detail,
        ...(hit.count === undefined ? {} : { count: hit.count }),
      });
    }
  }

  const state: IdeationReadiness['state'] = facts.activeCards === 0
    ? 'unexamined'
    : observations.some(observation => observation.tone === 'weak' || observation.tone === 'blocking')
      ? 'developing'
      : 'argued';

  return {
    observations,
    activeCards: facts.activeCards,
    evidenceCards: facts.evidenceCards,
    unrealized: facts.unrealized,
    contradictions: facts.contradictions,
    state,
    summary: summarize(state, observations),
  };
}

/**
 * Must match `normalizeForRoadmapMatch` in `ideationDerivation.ts`.
 *
 * Not imported only because that function is the derivation's own contract and
 * this module reads the *result*; a test pins the two together, as it already
 * does for the dashboard's copy.
 */
function normalizeRoadmapKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

function summarize(state: IdeationReadiness['state'], observations: readonly ReadinessObservation[]): string {
  if (state === 'unexamined') {
    return 'Nothing on the board yet.';
  }
  const blocking = observations.filter(observation => observation.tone === 'blocking').length;
  const weak = observations.filter(observation => observation.tone === 'weak').length;
  if (blocking > 0) {
    return `${blocking} thing${blocking === 1 ? '' : 's'} on this board argues against the rest of it.`;
  }
  if (weak > 0) {
    return `${weak} gap${weak === 1 ? '' : 's'} in what this board can defend.`;
  }
  return 'This board carries an argument, not just a list.';
}

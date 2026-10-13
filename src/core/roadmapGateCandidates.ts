/**
 * RoadmapGateCandidates — which backlog items look as if they belong on a release gate.
 *
 * A gate is declared in one click and then sits empty: tagging forty backlog
 * items against "Public beta" one chip at a time is the step nobody finishes, so
 * the gate's route stays a list of three while the backlog holds the other
 * twenty. This module reads the backlog against one gate and lists the items
 * worth a second look — and it is mostly about what it refuses to claim.
 *
 * Six rules:
 *
 * 1. **Candidates come from a declared rule table, never a model.** Every
 *    candidate names each rule that matched and what it matched on, and the
 *    table is published beside the list, so "why is this here?" always has an
 *    answer somebody can disagree with. The same backlog yields the same list.
 * 2. **Ranked by consequence, not by score.** Declaration order *is* the
 *    ranking: an item that something already on the gate waits on outranks an
 *    item that merely shares its vocabulary, because the gate cannot ship
 *    without the first and can ship perfectly well without the second. Score
 *    breaks ties within a rule, then backlog order, then id, so the list cannot
 *    shuffle between renders.
 * 3. **The MVP heuristic is one row, generalised rather than duplicated.**
 *    "Foundational work belongs in the MVP" is the rule the dashboard already
 *    used for its suggested MVP route; it lives here now
 *    (`isFoundationalRoadmapWork`) and the route reads it from here, so the
 *    suggested route and the scan cannot disagree about what foundational
 *    means. It stays scoped to the MVP gate, as it always was: recognising
 *    foundational work is not a claim about which *later* release something
 *    belongs to.
 * 4. **A weak signal never lists an item on its own.** Sharing the gate's usual
 *    kind of work, or waiting on something already on it, corroborates a match;
 *    alone, either would list half the backlog.
 * 5. **Could-not-assess is not none-found.** A gate whose name holds no word
 *    worth looking for, with nothing tagged on it yet, cannot be scanned at all
 *    — and says so, naming why, rather than returning an empty list that reads
 *    as "nothing belongs here". Every rule that could not be applied is listed
 *    with its reason, even when others could.
 * 6. **Nothing here writes anything.** The scan proposes; including an item is
 *    a separate, confirmed act by the caller, through the roadmap's one writer.
 *    Items already on the gate and delivered items are never proposed.
 *
 * Pure, `vscode`-free and unit-tested.
 */

import { MVP_GATE_ID } from './roadmapGates.js';
import { roadmapSubjectTokens, type RoadmapFocus } from './roadmapGraph.js';

export type GateCandidateRuleId =
  | 'prerequisite-of-gated'
  | 'names-gate'
  | 'mvp-foundation'
  | 'shares-subject'
  | 'depends-on-gated'
  | 'same-focus';

export interface GateCandidateRule {
  id: GateCandidateRuleId;
  label: string;
  /** What the rule looks for. Published beside the list so a candidate can be judged. */
  detail: string;
  /** Evaluation order and ranking. Lower is more consequential and is listed first. */
  rank: number;
  /** Contribution to a candidate's score. Breaks ties within the leading rule. */
  weight: number;
  /** False for a rule that only corroborates: it never lists an item on its own. */
  standalone: boolean;
  /** `mvp` when the rule only applies to the built-in MVP gate. */
  scope: 'every-gate' | 'mvp';
}

/** Words too generic to identify a release by name, on top of the subject stopwords. */
export const GATE_NAME_STOPWORDS: readonly string[] = [
  'candidate', 'gate', 'milestone', 'phase', 'sprint', 'stage', 'version',
];

/**
 * How much of the shorter item the shared words must cover.
 *
 * Two shared words mean something between two one-line items and almost
 * nothing between two paragraphs of thirty distinctive words each, which is
 * what a hand-written backlog is full of. Measured on this repository's own
 * roadmap, where the bare count proposed items for sharing "bring" and "keeps".
 */
export const SHARED_SUBJECT_MIN_OVERLAP = 0.25;

/**
 * The rule table, in ranking order.
 *
 * Order is the policy (rule 2): what the gate cannot ship without, then what
 * the item says about itself, then the MVP's own heuristic, then resemblance.
 */
export const GATE_CANDIDATE_RULES: readonly GateCandidateRule[] = [
  {
    id: 'prerequisite-of-gated',
    label: 'Something on this gate waits on it',
    detail: 'An outstanding item already on the gate depends on this one through links somebody drew (directly or through other items). The release cannot ship without it. Suggested links are not counted.',
    rank: 0,
    weight: 40,
    standalone: true,
    scope: 'every-gate',
  },
  {
    id: 'names-gate',
    label: 'Names the release',
    detail: `The item mentions a distinctive word from the gate's name or tag — e.g. “beta” for “Public beta”. Short tags such as “v2” or “mvp” are matched as whole words. Generic words (${GATE_NAME_STOPWORDS.join(', ')}) are not looked for.`,
    rank: 1,
    weight: 30,
    standalone: true,
    scope: 'every-gate',
  },
  {
    id: 'mvp-foundation',
    label: 'Foundational work (MVP only)',
    detail: 'Security or architecture work, or wording such as “core”, “foundation”, “baseline”, “essential”, “launch” or “must”. The heuristic behind the suggested MVP route; applied to the MVP gate only, because foundational is not a claim about a later release.',
    rank: 2,
    weight: 20,
    standalone: true,
    scope: 'mvp',
  },
  {
    id: 'shares-subject',
    label: 'Same subject as work on this gate',
    detail: `The item shares at least two distinctive words with an item already on the gate (the threshold the canvas uses before it suggests a link), and those words are at least ${Math.round(SHARED_SUBJECT_MIN_OVERLAP * 100)}% of the shorter item's distinctive words — so two long paragraphs that happen to share two words do not count.`,
    rank: 3,
    weight: 15,
    standalone: true,
    scope: 'every-gate',
  },
  {
    id: 'depends-on-gated',
    label: 'Waits on work on this gate',
    detail: 'The item depends directly on an item already on the gate. Corroborates another match; never lists an item alone, since work that follows a release may belong to the next one.',
    rank: 4,
    weight: 8,
    standalone: false,
    scope: 'every-gate',
  },
  {
    id: 'same-focus',
    label: 'The gate’s usual kind of work',
    detail: 'The item is the kind of work (security, architecture, delivery, feature, documentation) most of the gate’s items are. Corroborates another match; never lists an item alone, or every feature would be a candidate for every feature release.',
    rank: 5,
    weight: 5,
    standalone: false,
    scope: 'every-gate',
  },
];

/** At most this many candidates are listed; the remainder is counted, never dropped silently. */
export const GATE_CANDIDATE_CAP = 12;

const RULE_BY_ID = new Map(GATE_CANDIDATE_RULES.map(rule => [rule.id, rule] as const));

/**
 * The MVP foundation heuristic — the single definition.
 *
 * Lifted unchanged from the dashboard's backlog prioritiser, which now calls it
 * from here: security and architecture work, or wording that says the item is
 * load-bearing for a first release.
 */
const FOUNDATIONAL_WORDING = /\b(core|auth|foundation|foundational|baseline|essential|launch|ship|release|minimum viable|mvp|must|critical|first)\b/i;

export function isFoundationalRoadmapWork(text: string, focus: RoadmapFocus): boolean {
  return focus === 'security' || focus === 'architecture' || FOUNDATIONAL_WORDING.test(String(text ?? ''));
}

function describeFoundation(text: string, focus: RoadmapFocus): string {
  if (focus === 'security') {
    return 'security work';
  }
  if (focus === 'architecture') {
    return 'architecture work';
  }
  const match = FOUNDATIONAL_WORDING.exec(String(text ?? ''));
  return match ? `says “${match[1]?.toLowerCase()}”` : 'foundational wording';
}

/** One backlog item as the scan receives it. */
export interface GateCandidateInputItem {
  /** Durable id. Echoed back on the candidate, and the only thing a caller should act on. */
  id: string;
  text: string;
  completed: boolean;
  /** Declared gates the item is already on. */
  gates: readonly string[];
  focus: RoadmapFocus;
  /** Backlog position, lowest first. Breaks ties so the list cannot shuffle. */
  order: number;
}

/** A dependency: `from` has to land before `to`. Declared edges only. */
export interface GateCandidateEdge {
  from: string;
  to: string;
}

export interface GateCandidateInput {
  gate: { id: string; label: string };
  items: readonly GateCandidateInputItem[];
  /**
   * Declared dependency edges between item ids. `undefined` means the links
   * could not be read — reported as not assessed — while `[]` means there are
   * none.
   */
  edges?: readonly GateCandidateEdge[] | undefined;
  /** Defaults to {@link GATE_CANDIDATE_CAP}. */
  cap?: number;
}

export interface GateCandidateMatch {
  rule: GateCandidateRuleId;
  /** What the rule matched on, in words. */
  evidence: string;
}

export interface RoadmapGateCandidate {
  id: string;
  text: string;
  focus: RoadmapFocus;
  /** Sum of the matched rules' weights. */
  score: number;
  /** The most consequential rule that matched; decides the ranking. */
  leadingRule: GateCandidateRuleId;
  /** Every rule that matched, most consequential first. Never empty. */
  matches: GateCandidateMatch[];
  /** Other gates the item is already on, so tagging it twice is a visible choice. */
  otherGates: string[];
}

export type GateCandidateStatus =
  /** At least one candidate. */
  | 'candidates'
  /** Rules were applied and nothing matched. */
  | 'none'
  /** No outstanding item is off this gate, so there was nothing to scan. */
  | 'nothing-eligible'
  /** No rule that can list an item could be applied. Not the same as none. */
  | 'unassessable';

export interface GateCandidateSkip {
  rule: GateCandidateRuleId;
  reason: string;
}

export interface RoadmapGateCandidateReport {
  gateId: string;
  gateLabel: string;
  status: GateCandidateStatus;
  /** Ranked, capped at `cap`. */
  candidates: RoadmapGateCandidate[];
  /** Candidates past the cap. Stated, never silently dropped. */
  remainder: number;
  /** Outstanding items not already on the gate — what was actually read. */
  scannedCount: number;
  /** Items left out before scanning, and why. */
  excluded: { onGate: number; completed: number };
  /** Rules that were applied to this gate, in ranking order. */
  applied: GateCandidateRuleId[];
  /** Rules that could not be applied, each with the reason. */
  skipped: GateCandidateSkip[];
  /** One sentence, composed here so no surface restates the result more confidently. */
  summary: string;
}

function clip(text: string, length = 60): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * The words the `names-gate` rule looks for.
 *
 * Distinctive words from the label and the id, plus the id itself as a whole
 * word when the tokeniser would drop it — a tag of three characters or fewer,
 * or one with a digit in it (`v2`, `mvp`, `v1.0`).
 */
export function gateNameTerms(gate: { id: string; label: string }): { words: string[]; literals: string[] } {
  const generic = new Set(GATE_NAME_STOPWORDS);
  const words = roadmapSubjectTokens(`${String(gate.label ?? '')} ${String(gate.id ?? '').replace(/[.-]+/g, ' ')}`)
    .filter(word => !generic.has(word));
  const id = String(gate.id ?? '').toLowerCase();
  const literals = id.length >= 2 && (id.length <= 3 || /\d/.test(id)) && !words.includes(id) ? [id] : [];
  return { words, literals };
}

function matchesLiteral(text: string, literal: string): boolean {
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(literal)}(?![a-z0-9])`, 'i').test(text);
}

/** Every outstanding gated item's ancestors over declared edges, with the nearest gated item that waits on each. */
function prerequisitesOf(
  gatedOutstanding: readonly GateCandidateInputItem[],
  edges: readonly GateCandidateEdge[],
  byId: ReadonlyMap<string, GateCandidateInputItem>,
): Map<string, { via: GateCandidateInputItem; steps: number }> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to) || edge.from === edge.to) {
      continue;
    }
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const found = new Map<string, { via: GateCandidateInputItem; steps: number }>();
  // Breadth-first from each gated item in backlog order, so the nearest — and,
  // on a tie, the earliest — gated item is the one named. Cycle-safe: a
  // hand-edited file can hold a loop, and a scan must not walk it forever.
  for (const root of gatedOutstanding) {
    const seen = new Set<string>([root.id]);
    let frontier = [root.id];
    let steps = 0;
    while (frontier.length > 0) {
      steps += 1;
      const next: string[] = [];
      for (const current of frontier) {
        for (const parent of [...(incoming.get(current) ?? [])].sort()) {
          if (seen.has(parent)) {
            continue;
          }
          seen.add(parent);
          next.push(parent);
          const existing = found.get(parent);
          if (existing === undefined
            || steps < existing.steps
            || (steps === existing.steps && root.order < existing.via.order)) {
            found.set(parent, { via: root, steps });
          }
        }
      }
      frontier = next;
    }
  }
  return found;
}

/** The focus most of the gate's items share, when one clearly leads. */
function dominantFocus(gated: readonly GateCandidateInputItem[]): RoadmapFocus | undefined {
  const counts = new Map<RoadmapFocus, number>();
  for (const item of gated) {
    counts.set(item.focus, (counts.get(item.focus) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  if (first === undefined || first[1] < 2 || (second !== undefined && second[1] === first[1])) {
    return undefined;
  }
  return first[0];
}

/**
 * Scan the backlog for items that may belong on one gate.
 *
 * Total: never throws, and a malformed item is skipped rather than guessed at.
 */
export function scanRoadmapGateCandidates(input: GateCandidateInput): RoadmapGateCandidateReport {
  const gateId = String(input?.gate?.id ?? '');
  const gateLabel = String(input?.gate?.label ?? '') || gateId;
  const cap = Number.isFinite(input?.cap) && (input.cap as number) >= 0 ? Math.floor(input.cap as number) : GATE_CANDIDATE_CAP;
  const isMvp = gateId === MVP_GATE_ID;

  const seenIds = new Set<string>();
  const items: GateCandidateInputItem[] = [];
  for (const item of Array.isArray(input?.items) ? input.items : []) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0 || seenIds.has(item.id) || typeof item.text !== 'string') {
      continue;
    }
    seenIds.add(item.id);
    items.push({
      ...item,
      gates: Array.isArray(item.gates) ? (item.gates as readonly unknown[]).filter((gate): gate is string => typeof gate === 'string') : [],
      order: Number.isFinite(item.order) ? item.order : Number.MAX_SAFE_INTEGER,
    });
  }
  const byOrder = (a: GateCandidateInputItem, b: GateCandidateInputItem): number =>
    a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  items.sort(byOrder);

  const byId = new Map(items.map(item => [item.id, item] as const));
  const gated = items.filter(item => item.gates.includes(gateId));
  const gatedOutstanding = gated.filter(item => !item.completed);
  const completedOff = items.filter(item => item.completed && !item.gates.includes(gateId));
  const eligible = items.filter(item => !item.completed && !item.gates.includes(gateId));
  const excluded = { onGate: gated.length, completed: completedOff.length };

  // ── Which rules can be applied here ─────────────────────────────────
  const applied: GateCandidateRuleId[] = [];
  const skipped: GateCandidateSkip[] = [];
  const terms = gateNameTerms({ id: gateId, label: gateLabel });
  const focus = dominantFocus(gated);
  const edges = input?.edges;
  for (const rule of GATE_CANDIDATE_RULES) {
    let reason: string | undefined;
    switch (rule.id) {
      case 'prerequisite-of-gated':
        reason = edges === undefined
          ? 'The links between items could not be read, so what this gate waits on is unknown.'
          : gatedOutstanding.length === 0
            ? 'Nothing outstanding is on this gate yet, so there is no work it waits on.'
            : undefined;
        break;
      case 'names-gate':
        reason = terms.words.length === 0 && terms.literals.length === 0
          ? `The gate's name “${clip(gateLabel, 40)}” has no distinctive word to look for.`
          : undefined;
        break;
      case 'mvp-foundation':
        reason = isMvp ? undefined : 'Applies to the MVP gate only.';
        break;
      case 'shares-subject':
        reason = gated.length === 0 ? 'Nothing is on this gate yet, so there is no subject to share.' : undefined;
        break;
      case 'depends-on-gated':
        reason = edges === undefined
          ? 'The links between items could not be read.'
          : gated.length === 0 ? 'Nothing is on this gate yet.' : undefined;
        break;
      case 'same-focus':
        reason = focus === undefined
          ? 'No single kind of work clearly leads on this gate (it needs at least two items of one kind, ahead of any other).'
          : undefined;
        break;
    }
    if (reason === undefined) {
      applied.push(rule.id);
    } else {
      skipped.push({ rule: rule.id, reason });
    }
  }

  const base = { gateId, gateLabel, scannedCount: eligible.length, excluded, applied, skipped };

  if (eligible.length === 0) {
    return {
      ...base,
      status: 'nothing-eligible',
      candidates: [],
      remainder: 0,
      summary: items.length === 0
        ? 'The roadmap has no items to scan.'
        : `Every outstanding item is already on ${gateLabel}, so there is nothing to scan.`,
    };
  }

  const standaloneApplied = applied.some(id => RULE_BY_ID.get(id)?.standalone === true);
  if (!standaloneApplied) {
    const why = skipped
      .filter(skip => RULE_BY_ID.get(skip.rule)?.standalone === true)
      .map(skip => skip.reason)
      .join(' ');
    return {
      ...base,
      status: 'unassessable',
      candidates: [],
      remainder: 0,
      summary: `Could not assess ${gateLabel}: ${why} Tag one item for it, or give it a more specific name, and scan again.`,
    };
  }

  // ── Apply them ─────────────────────────────────────────────────────
  const prerequisites = applied.includes('prerequisite-of-gated') && edges !== undefined
    ? prerequisitesOf(gatedOutstanding, edges, byId)
    : new Map<string, { via: GateCandidateInputItem; steps: number }>();
  const gatedIds = new Set(gated.map(item => item.id));
  const waitsOn = new Map<string, GateCandidateInputItem>();
  if (applied.includes('depends-on-gated') && edges !== undefined) {
    for (const edge of edges) {
      const from = byId.get(edge.from);
      if (from !== undefined && gatedIds.has(edge.from) && edge.from !== edge.to) {
        const existing = waitsOn.get(edge.to);
        if (existing === undefined || from.order < existing.order) {
          waitsOn.set(edge.to, from);
        }
      }
    }
  }
  const gatedTokens = gated.map(item => ({ item, tokens: roadmapSubjectTokens(item.text) }));

  const matched: RoadmapGateCandidate[] = [];
  for (const item of eligible) {
    const matches: GateCandidateMatch[] = [];
    const tokens = roadmapSubjectTokens(item.text);

    const prerequisite = prerequisites.get(item.id);
    if (prerequisite !== undefined) {
      matches.push({
        rule: 'prerequisite-of-gated',
        evidence: prerequisite.steps === 1
          ? `“${clip(prerequisite.via.text)}” waits on it`
          : `“${clip(prerequisite.via.text)}” waits on it, through ${prerequisite.steps - 1} other item${prerequisite.steps === 2 ? '' : 's'}`,
      });
    }

    if (applied.includes('names-gate')) {
      const word = terms.words.find(term => tokens.includes(term));
      const literal = word === undefined ? terms.literals.find(term => matchesLiteral(item.text, term)) : undefined;
      const hit = word ?? literal;
      if (hit !== undefined) {
        matches.push({ rule: 'names-gate', evidence: `mentions “${hit}”` });
      }
    }

    if (applied.includes('mvp-foundation') && isFoundationalRoadmapWork(item.text, item.focus)) {
      matches.push({ rule: 'mvp-foundation', evidence: describeFoundation(item.text, item.focus) });
    }

    if (applied.includes('shares-subject')) {
      let best: { item: GateCandidateInputItem; shared: string[] } | undefined;
      for (const entry of gatedTokens) {
        const shared = tokens.filter(token => entry.tokens.includes(token));
        const shorter = Math.min(tokens.length, entry.tokens.length);
        if (shared.length >= 2
          && shared.length >= shorter * SHARED_SUBJECT_MIN_OVERLAP
          && (best === undefined || shared.length > best.shared.length)) {
          best = { item: entry.item, shared };
        }
      }
      if (best !== undefined) {
        matches.push({
          rule: 'shares-subject',
          evidence: `shares ${best.shared.slice(0, 3).map(token => `“${token}”`).join(', ')} with “${clip(best.item.text)}”`,
        });
      }
    }

    const upstream = waitsOn.get(item.id);
    if (upstream !== undefined) {
      matches.push({ rule: 'depends-on-gated', evidence: `waits on “${clip(upstream.text)}”` });
    }

    if (applied.includes('same-focus') && focus !== undefined && item.focus === focus) {
      matches.push({ rule: 'same-focus', evidence: `${focus} work, like most of the gate` });
    }

    // Rule 4: corroboration alone lists nothing.
    if (!matches.some(match => RULE_BY_ID.get(match.rule)?.standalone === true)) {
      continue;
    }
    matches.sort((a, b) => (RULE_BY_ID.get(a.rule)?.rank ?? 99) - (RULE_BY_ID.get(b.rule)?.rank ?? 99));
    matched.push({
      id: item.id,
      text: item.text,
      focus: item.focus,
      score: matches.reduce((sum, match) => sum + (RULE_BY_ID.get(match.rule)?.weight ?? 0), 0),
      leadingRule: matches[0]!.rule,
      matches,
      otherGates: item.gates.filter(gate => gate !== gateId),
    });
  }

  const orderOf = new Map(items.map(item => [item.id, item.order] as const));
  matched.sort((a, b) =>
    (RULE_BY_ID.get(a.leadingRule)?.rank ?? 99) - (RULE_BY_ID.get(b.leadingRule)?.rank ?? 99)
    || b.score - a.score
    || (orderOf.get(a.id) ?? 0) - (orderOf.get(b.id) ?? 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const candidates = matched.slice(0, cap);
  const remainder = matched.length - candidates.length;
  const notAssessed = skipped.length > 0
    ? ` ${skipped.length} rule${skipped.length === 1 ? ' was' : 's were'} not assessed.`
    : '';
  if (candidates.length === 0 && remainder === 0) {
    return {
      ...base,
      status: 'none',
      candidates: [],
      remainder: 0,
      summary: `Scanned ${eligible.length} outstanding item${eligible.length === 1 ? '' : 's'} against ${applied.length} rule${applied.length === 1 ? '' : 's'}; none matched ${gateLabel}.${notAssessed}`,
    };
  }
  return {
    ...base,
    status: 'candidates',
    candidates,
    remainder,
    summary: `${matched.length} of ${eligible.length} outstanding item${eligible.length === 1 ? '' : 's'} may belong on ${gateLabel}${remainder > 0 ? ` — showing the first ${candidates.length}, ${remainder} more not shown` : ''}.${notAssessed}`,
  };
}

/**
 * Keep only the selected ids that the report actually proposed.
 *
 * The webview supplies the selection, so an id that was never a candidate — a
 * stale page, or a crafted message — is refused rather than tagged. Returns the
 * accepted ids in ranking order and the refused ones separately, so the caller
 * can say what it would not do.
 */
export function resolveGateCandidateSelection(
  report: RoadmapGateCandidateReport,
  selected: unknown,
): { accepted: RoadmapGateCandidate[]; refused: string[] } {
  const offered = new Map(report.candidates.map(candidate => [candidate.id, candidate] as const));
  const picked = new Set<string>();
  const refused: string[] = [];
  for (const entry of Array.isArray(selected) ? selected.slice(0, GATE_CANDIDATE_CAP * 2) : []) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 80) {
      continue;
    }
    if (offered.has(entry)) {
      picked.add(entry);
    } else if (!refused.includes(entry)) {
      refused.push(entry);
    }
  }
  return { accepted: report.candidates.filter(candidate => picked.has(candidate.id)), refused };
}

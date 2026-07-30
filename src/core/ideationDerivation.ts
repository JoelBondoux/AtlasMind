/**
 * Ideation as stage 0 of the workflow.
 *
 * The board had nine card kinds — including `problem`, `requirement`, `risk` and
 * `evidence` — and exactly two outbound paths: launch an autonomous run, or append
 * prose to a memory file. Neither reached the backlog, so the eight-stage workflow
 * started at stage 1 (*Planning & Issue Intake*) with nothing feeding it, and a
 * card literally called `requirement` could not become a requirement.
 *
 * Four decisions carry the weight here.
 *
 * **Focus is not decided in this module.** `prioritizeDashboardRoadmapItems`
 * already derives a roadmap item's focus from its *text*, with one published
 * keyword table. A second classifier keyed on card kind would eventually disagree
 * with it, and the disagreement would surface as an item whose priority reason
 * contradicts its own label. So this shapes the text and lets the existing rule
 * read it — which also means a card's wording behaves exactly like a hand-typed
 * item's, with no special case to remember.
 *
 * **A kind becomes a prefix only where it changes what the sentence means.** A
 * `problem` card titled "Webhook has no rate limit" must not enter the backlog as
 * a goal; the work is the fix, not the problem. Same for a `risk`, where the work
 * is the mitigation. A `requirement` or an `idea` needs no prefix — deciding to put
 * an idea on the roadmap *is* the commitment, so hedging it would misreport the
 * decision that was just made.
 *
 * **Connections are the evidence, and direction is load-bearing.** "This depends
 * on X" and "X depends on this" are opposite plans, and a board that records the
 * edge can state which. This is the one thing ideation knows that no hand-typed
 * issue body ever contains — and a `contradiction` is reported rather than
 * dropped, because raising work while hiding the card that argues against it is
 * the worst use of a board that recorded the argument.
 *
 * **Provenance is stored on the card, not written into the roadmap.** Card ids are
 * durable (generated once, kept in the board JSON). Roadmap item ids are *not* —
 * they are positional (`roadmap-${index + 1}`, assigned after filtering), so
 * inserting one item renumbers every item below it. Storing `roadmap-7` anywhere
 * durable would mean something different a week later. The card therefore keeps
 * the item's **normalized text**, which is the same key the roadmap already uses
 * to detect duplicates, and the reverse direction is recovered by matching it.
 * When that match fails, it is reported as broken rather than shown as a link to
 * whatever now occupies the position.
 */

/** Card kinds that can become work. `atlas-response` and `attachment` cannot. */
export const DERIVABLE_CARD_KINDS = [
  'idea',
  'problem',
  'experiment',
  'user-insight',
  'risk',
  'requirement',
  'evidence',
] as const;

export type DerivableCardKind = (typeof DERIVABLE_CARD_KINDS)[number];

export interface IdeationCardSource {
  /** Durable: generated once and stored in the board file. */
  readonly id: string;
  readonly title: string;
  /** The card's own notes, where it has any. */
  readonly summary?: string;
  readonly kind: string;
}

export interface IdeationConnectionSource {
  readonly relation: 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
  readonly direction: 'none' | 'forward' | 'reverse' | 'both';
  /** The card at the other end of the edge. */
  readonly otherTitle: string;
  /** True when this card is the edge's source. Decides how direction reads. */
  readonly outgoing: boolean;
}

/**
 * What the card became, kept on the card.
 *
 * `roadmapNormalized` is the join key, not `roadmapItemId` — see the module note
 * on positional ids. `roadmapText` is kept alongside it so a broken link can say
 * what it used to point at.
 */
export interface IdeationDerivedRecord {
  readonly roadmapText: string;
  readonly roadmapNormalized: string;
  readonly derivedAt: string;
  /** Set once the roadmap item has been filed as an issue. */
  readonly issueNumber?: number;
}

export interface CardDerivation {
  /** The roadmap checklist text. */
  readonly text: string;
  /** Evidence lines from the card's connections, ordered by consequence. */
  readonly evidence: readonly string[];
  /** True when a `contradiction` edge exists, so callers can surface it. */
  readonly contradicted: boolean;
  /** Connections beyond the cap, stated rather than silently dropped. */
  readonly droppedConnections: number;
}

/**
 * Prefixes, and only where the kind changes what the sentence commits to.
 *
 * `undefined` means the title already reads as the work.
 */
const KIND_PREFIX: Readonly<Record<DerivableCardKind, string | undefined>> = {
  // The work is the fix, not the problem. Without this the backlog reads as if
  // the missing rate limit were the goal.
  problem: 'Fix',
  // The work is the mitigation.
  risk: 'Mitigate',
  // A question to answer, which is work, and saying so keeps it from being read
  // as a decision already taken.
  experiment: 'Trial',
  // These already read as the work. Putting an idea on the roadmap *is* the
  // commitment, so hedging it would misreport the decision just made.
  idea: undefined,
  requirement: undefined,
  'user-insight': undefined,
  evidence: undefined,
};

/**
 * How each relation reads, given direction.
 *
 * Getting `dependency` backwards inverts the plan, so both readings are written
 * out rather than computed from a single template.
 */
const RELATION_PHRASING: Readonly<Record<
  IdeationConnectionSource['relation'],
  { readonly outgoing: string; readonly incoming: string; readonly significance: number }
>> = {
  // Highest: it argues against doing this at all.
  contradiction: { outgoing: 'contradicts', incoming: 'is contradicted by', significance: 100 },
  dependency: { outgoing: 'depends on', incoming: 'is depended on by', significance: 80 },
  causal: { outgoing: 'causes', incoming: 'is caused by', significance: 60 },
  supports: { outgoing: 'supports', incoming: 'is supported by', significance: 40 },
  opportunity: { outgoing: 'opens up', incoming: 'is opened up by', significance: 20 },
};

/** Evidence lines cap here. Past this it stops being evidence and becomes the board. */
export const MAX_EVIDENCE_LINES = 6;

/** Roadmap item text caps here, matching the roadmap's own readable line length. */
export const MAX_DERIVED_ITEM_LENGTH = 140;

export function isDerivableCardKind(kind: string): kind is DerivableCardKind {
  return (DERIVABLE_CARD_KINDS as readonly string[]).includes(kind);
}

/**
 * The roadmap's duplicate-detection key, reproduced here.
 *
 * Must stay identical to `normalizeRoadmapText` in the dashboard panel: this is
 * the join between a card and the item it produced, and two normalizers that
 * drift apart would break every existing link at once. A test pins them together.
 */
export function normalizeForRoadmapMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

function cleanCardText(raw: string): string {
  return raw
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lower-case the first letter, but only for an ordinary capitalised word.
 *
 * `Fix: ` + `Webhook has no limit` should read `Fix: webhook has no limit`. But
 * `API`, `GitHub` and `OAuth` carry their capitals as part of the name, and
 * lower-casing the first letter produces `aPI` and `gitHub` — which look like a
 * bug in a tracked file. The test for this exists because the first version
 * checked `/^[A-Z][a-z]/`, which happily matched the `Gi` in `GitHub`.
 *
 * The rule is the whole first word: any capital past the first character means
 * the word is a name, not a sentence opener.
 */
function decapitalizeFirstWord(title: string): string {
  const firstWord = title.split(' ', 1)[0] ?? '';
  if (!/^[A-Z]/.test(firstWord) || /[A-Z]/.test(firstWord.slice(1))) {
    return title;
  }
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/** Cut without cutting a word in half. A mid-word cut reads as a truncation bug. */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * The board's edges touching one card, described from that card's point of view.
 *
 * `outgoing` is what makes direction readable: “this depends on X” and “X depends
 * on this” are opposite plans, and only the edge's orientation relative to *this*
 * card can tell them apart.
 *
 * Lives here rather than in a panel because both panels need it — the board
 * writes the roadmap item, and the dashboard recomputes the evidence when that
 * item becomes an issue. Two copies would eventually disagree about direction,
 * which is the one thing here that must not be wrong.
 */
export function collectCardConnectionSources(
  cards: readonly { id: string; title: string }[],
  connections: readonly {
    fromCardId: string;
    toCardId: string;
    relation: IdeationConnectionSource['relation'];
    direction: IdeationConnectionSource['direction'];
  }[],
  cardId: string,
): IdeationConnectionSource[] {
  const titleOf = new Map(cards.map(card => [card.id, card.title]));
  const sources: IdeationConnectionSource[] = [];
  for (const connection of connections) {
    const outgoing = connection.fromCardId === cardId;
    const incoming = connection.toCardId === cardId;
    if (!outgoing && !incoming) {
      continue;
    }
    const otherTitle = titleOf.get(outgoing ? connection.toCardId : connection.fromCardId);
    if (otherTitle === undefined) {
      // An edge to a card that is gone. Dropped rather than described as a link
      // to nothing.
      continue;
    }
    sources.push({ relation: connection.relation, direction: connection.direction, otherTitle, outgoing });
  }
  return sources;
}

/**
 * Turn a card and its edges into roadmap text plus evidence.
 *
 * Deterministic: the same card and the same edges produce the same result, so the
 * text can be reviewed before it is committed to a tracked file.
 */
export function deriveCardRoadmapText(
  card: IdeationCardSource,
  connections: readonly IdeationConnectionSource[] = [],
): CardDerivation {
  const title = cleanCardText(card.title);
  const prefix = isDerivableCardKind(card.kind) ? KIND_PREFIX[card.kind] : undefined;
  const sentence = prefix === undefined ? title : `${prefix}: ${decapitalizeFirstWord(title)}`;

  const ranked = connections
    .filter(entry => RELATION_PHRASING[entry.relation] !== undefined)
    .filter(entry => cleanCardText(entry.otherTitle) !== '')
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      RELATION_PHRASING[b.entry.relation].significance - RELATION_PHRASING[a.entry.relation].significance
      || a.index - b.index);

  const kept = ranked.slice(0, MAX_EVIDENCE_LINES);
  const evidence = kept.map(({ entry }) => {
    const phrasing = RELATION_PHRASING[entry.relation];
    // `both` reads as outgoing: a mutual edge is true in the outgoing direction
    // too, and picking one keeps the line a sentence rather than a diagram.
    const verb = entry.outgoing || entry.direction === 'both' ? phrasing.outgoing : phrasing.incoming;
    return `This ${verb} “${clamp(cleanCardText(entry.otherTitle), 80)}”.`;
  });

  return {
    text: clamp(sentence, MAX_DERIVED_ITEM_LENGTH),
    evidence,
    contradicted: connections.some(entry => entry.relation === 'contradiction'),
    droppedConnections: ranked.length - kept.length,
  };
}

/**
 * The evidence section for an issue body raised from a card.
 *
 * Separate from `deriveCardRoadmapText` because the roadmap wants one line and an
 * issue wants the reasoning. A contradiction is stated as a caution rather than
 * listed among the supporting points, since it is the one line that argues the
 * work should not happen.
 */
export function buildCardEvidenceSection(card: IdeationCardSource, derivation: CardDerivation): string {
  const lines: string[] = [];
  const summary = cleanCardText(card.summary ?? '');
  if (summary !== '') {
    lines.push(summary, '');
  }
  if (derivation.evidence.length > 0) {
    lines.push('### What the board records', '');
    for (const line of derivation.evidence) {
      lines.push(`- ${line}`);
    }
    if (derivation.droppedConnections > 0) {
      lines.push(
        `- …and ${derivation.droppedConnections} further `
        + `${derivation.droppedConnections === 1 ? 'connection' : 'connections'} on the board.`,
      );
    }
    lines.push('');
  }
  if (derivation.contradicted) {
    lines.push(
      '> **Contradicted on the board.** Another card argues against this. Raising it here does not '
      + 'settle that — read the contradiction before starting.',
      '',
    );
  }
  lines.push(
    `Raised from the ideation board, card \`${card.id}\` (${card.kind}). `
    + 'The board keeps the reasoning; this issue tracks the work.',
  );
  return lines.join('\n');
}

/**
 * Match a card's stored derivation against the roadmap as it is now.
 *
 * Returns the item where the normalized text still matches, and reports a break
 * rather than guessing. A card that says it produced item 7 cannot simply be
 * shown against whatever is at position 7 today — positions move.
 */
export function resolveDerivedRoadmapItem<T extends { id: string; text: string; completed: boolean }>(
  record: IdeationDerivedRecord | undefined,
  items: readonly T[],
): { status: 'none' } | { status: 'matched'; item: T } | { status: 'missing'; was: string } {
  if (!record) {
    return { status: 'none' };
  }
  const found = items.find(item => normalizeForRoadmapMatch(item.text) === record.roadmapNormalized);
  if (found) {
    return { status: 'matched', item: found };
  }
  // Renamed or deleted. Either way the honest answer is "the link no longer
  // resolves", with what it used to say, rather than a link to a different item.
  return { status: 'missing', was: record.roadmapText };
}

/**
 * Which cards on the board have not become work yet.
 *
 * `evidence` and `user-insight` are included: they are the two kinds most likely
 * to sit unused, and they are exactly what a backlog item most needs behind it.
 * Cards that already produced a still-matching roadmap item are excluded, because
 * the point of the list is what is *left*.
 */
export function unrealizedCards<T extends { id: string; text: string; completed: boolean }>(
  cards: readonly (IdeationCardSource & { derived?: IdeationDerivedRecord })[],
  roadmapItems: readonly T[],
): readonly IdeationCardSource[] {
  return cards
    .filter(card => isDerivableCardKind(card.kind))
    .filter(card => resolveDerivedRoadmapItem(card.derived, roadmapItems).status !== 'matched');
}

/**
 * Cards worth prompting about, and why.
 *
 * Deliberately narrow. An `idea` nobody has acted on is not a problem — boards are
 * for holding ideas. A `problem` or a `requirement` sitting unrealized *is* a
 * signal, because somebody wrote down that something is wrong or needed and it
 * never reached the backlog.
 */
export const NAGGABLE_CARD_KINDS = ['problem', 'requirement', 'risk'] as const;

export function countUnrealizedByKind<T extends { id: string; text: string; completed: boolean }>(
  cards: readonly (IdeationCardSource & { derived?: IdeationDerivedRecord })[],
  roadmapItems: readonly T[],
): { total: number; needsAttention: number } {
  const open = unrealizedCards(cards, roadmapItems);
  return {
    total: open.length,
    needsAttention: open.filter(card => (NAGGABLE_CARD_KINDS as readonly string[]).includes(card.kind)).length,
  };
}

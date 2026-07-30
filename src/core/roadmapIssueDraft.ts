/**
 * A roadmap item, turned into an issue draft.
 *
 * The gap this closes: `IssueDraft` existed with only a sanitizer, and issues
 * could only be created by hand-typing a title, a body and a comma-separated
 * label list into a form. Meanwhile the roadmap held the work in a structured,
 * prioritised, gate-tagged list — and nothing connected them. Somebody planning
 * in AtlasMind and tracking in GitHub retyped every item.
 *
 * **No model is in this path.** The same item produces a byte-identical draft
 * every time, which is what makes it reviewable: you can see the rule that chose
 * a label, and you can predict what the next item will produce. A generated issue
 * title is a claim nobody checked, posted publicly under your name.
 *
 * **A draft is not a filed issue.** Nothing here calls `gh`. The output is
 * proposed text, and the confirmation that posts it lives at the call site,
 * behind the same gate as every other issue write.
 *
 * **Labels come only from the declared taxonomy.** An invented label creates it
 * on the repository as a side effect of filing — a write nobody asked for, in a
 * taxonomy the team agreed. Unmatched intents are dropped rather than coerced,
 * and the draft says which were dropped so the omission is visible.
 */

import type { IssueDraft } from './issueTracker.js';

/** The roadmap fields a draft is derived from. Structural, not the whole item. */
export interface RoadmapDraftSource {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
  readonly focus: 'security' | 'architecture' | 'delivery' | 'feature' | 'documentation';
  readonly priorityScore: number;
  readonly priorityReason: string;
  /** Declared gates this item is tagged for, in declared order. */
  readonly gates: readonly string[];
  /**
   * The ideation card this item was raised from, where there is one.
   *
   * Carried into the issue so the chain is followable: card → roadmap item →
   * issue, each step naming the one before it. Following a chain beats copying an
   * issue number back onto the card, which goes stale the moment an issue is
   * transferred or deleted.
   */
  readonly origin?: { readonly cardId: string; readonly cardTitle: string; readonly cardKind: string };
}

/**
 * What a focus means as a label *intent*, before the taxonomy is consulted.
 *
 * Several candidates per focus, in preference order, because label vocabularies
 * differ and matching one of `bug`/`defect` is better than inventing `security`.
 * First match wins; nothing is created.
 */
const FOCUS_LABEL_CANDIDATES: Readonly<Record<RoadmapDraftSource['focus'], readonly string[]>> = {
  security: ['security', 'vulnerability'],
  architecture: ['architecture', 'refactor', 'tech-debt'],
  delivery: ['ci', 'build', 'infrastructure', 'devops'],
  feature: ['enhancement', 'feature'],
  documentation: ['documentation', 'docs'],
};

/** How a focus reads in a sentence. */
const FOCUS_WORDS: Readonly<Record<RoadmapDraftSource['focus'], string>> = {
  security: 'a security concern',
  architecture: 'an architectural change',
  delivery: 'delivery and CI work',
  feature: 'a feature',
  documentation: 'documentation',
};

/**
 * Titles cap here. GitHub's own limit is 256; well short of it keeps a title
 * readable in a list, which is the only place most people ever see it.
 */
export const MAX_DERIVED_TITLE_LENGTH = 120;

export interface RoadmapIssueDraft extends IssueDraft {
  /** The roadmap item this came from, so the two can be reconciled later. */
  readonly roadmapItemId: string;
  /** Passed through, so a caller can follow the chain back to the board. */
  readonly origin?: RoadmapDraftSource['origin'];
  /**
   * Label intents that found nothing in the taxonomy.
   *
   * Reported rather than silently dropped: a draft that quietly loses its
   * `security` label looks like a draft that was never meant to have one.
   */
  readonly droppedLabels: readonly string[];
  /** Set when the item is already ticked off. The caller decides what to do. */
  readonly alreadyComplete: boolean;
}

/** Collapse whitespace and strip the roadmap's own markup from an item's text. */
function cleanItemText(raw: string): string {
  return raw
    // Gate tags are roadmap syntax, not part of the sentence.
    .replace(/(^|\s)#[A-Za-z0-9][A-Za-z0-9._-]*/g, ' ')
    // Checkbox and bullet leaders, if the caller passed a raw line.
    .replace(/^\s*[-*]\s*\[[ xX]\]\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    // Markdown emphasis and inline code, which read as noise in a title.
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cut to a length without cutting a word in half.
 *
 * A title ending mid-word looks like a truncation bug, and somebody reading a
 * list of issues cannot tell ours from theirs.
 */
function clampTitle(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * Derive the draft.
 *
 * `declaredLabels` is the repository's actual label list. Passing an empty list
 * is legitimate — a repository may have none, or they may not have been loaded —
 * and produces a draft with no labels rather than invented ones.
 */
export function deriveRoadmapIssueDraft(
  item: RoadmapDraftSource,
  declaredLabels: readonly string[],
): RoadmapIssueDraft {
  const available = new Map(declaredLabels.map(label => [label.toLowerCase(), label]));
  const labels: string[] = [];
  const dropped: string[] = [];

  const candidates = FOCUS_LABEL_CANDIDATES[item.focus] ?? [];
  const matched = candidates.find(candidate => available.has(candidate.toLowerCase()));
  if (matched !== undefined) {
    // The repository's own spelling, not ours — `Documentation` and
    // `documentation` are the same label to a human and two to `gh`.
    labels.push(available.get(matched.toLowerCase())!);
  } else if (candidates.length > 0) {
    dropped.push(candidates[0]!);
  }

  // A gate is a release milestone in roadmap terms. Where the repository happens
  // to use the same word as a label, honour it; never create it.
  for (const gate of item.gates) {
    const found = available.get(gate.toLowerCase());
    if (found !== undefined && !labels.includes(found)) {
      labels.push(found);
    }
  }

  const cleaned = cleanItemText(item.text);
  const title = clampTitle(cleaned, MAX_DERIVED_TITLE_LENGTH);

  return {
    roadmapItemId: item.id,
    ...(item.origin === undefined ? {} : { origin: item.origin }),
    title,
    body: buildDraftBody(item, cleaned, title, labels, dropped),
    labels,
    droppedLabels: dropped,
    alreadyComplete: item.completed,
  };
}

/**
 * The body.
 *
 * Fixed order, fixed sections, no prose that varies with the item beyond the
 * item's own words — the same reason the title is derived rather than written.
 * The provenance line matters most: an issue that came from a roadmap and does
 * not say so becomes a duplicate the first time somebody reads the roadmap again.
 */
function buildDraftBody(
  item: RoadmapDraftSource,
  cleaned: string,
  title: string,
  labels: readonly string[],
  dropped: readonly string[],
): string {
  const lines: string[] = [];
  lines.push('## What');
  lines.push('');
  // The full text when the title had to be cut, so nothing is lost to the clamp.
  lines.push(cleaned === title ? cleaned : cleaned);
  lines.push('');
  lines.push('## Why now');
  lines.push('');
  lines.push(`This is ${FOCUS_WORDS[item.focus]}. ${item.priorityReason}`);
  lines.push('');
  if (item.gates.length > 0) {
    lines.push(`Tagged for: ${item.gates.map(gate => `\`#${gate}\``).join(', ')}.`);
    lines.push('');
  }
  lines.push('## Where this came from');
  lines.push('');
  // Named by its *file*, not by its id.
  //
  // Roadmap ids are positional — `roadmap-${index + 1}`, assigned after
  // filtering — so inserting one item renumbers every item below it. The first
  // version of this line quoted the id, which would have pointed at a different
  // item within a week. The item's text is already in the issue above; the file
  // is the part that needs naming.
  lines.push(
    'Raised from the AtlasMind roadmap, `roadmap/improvement-plan.md`. '
    + 'The roadmap remains the source of truth for whether this is still wanted; '
    + 'closing this issue does not tick it off, and ticking it off does not close this issue.',
  );
  if (item.origin !== undefined) {
    lines.push('');
    lines.push(
      // The chain, one link at a time: card → roadmap item → issue, each step
      // naming the one before it. Following a chain beats copying an issue
      // number back onto the card, which goes stale the moment an issue is
      // transferred or deleted.
      `That item came from the ideation board — card \`${item.origin.cardId}\` `
      + `(${item.origin.cardKind}), “${item.origin.cardTitle}”. `
      + 'The board keeps the reasoning behind it.',
    );
  }
  if (dropped.length > 0) {
    lines.push('');
    lines.push(
      `> Not labelled ${dropped.map(label => `\`${label}\``).join(', ')} — `
      + 'no matching label exists on this repository, and AtlasMind does not create labels '
      + 'as a side effect of filing an issue.',
    );
  }
  return lines.join('\n');
}

/**
 * Which roadmap items are worth offering as issues, in the order to offer them.
 *
 * Completed items are excluded rather than sorted last: raising an issue for
 * finished work is never the intent, and offering it invites a mis-click that
 * posts publicly. Highest priority first, then declaration order so the list is
 * stable between renders.
 */
export function draftableRoadmapItems(
  items: readonly RoadmapDraftSource[],
): readonly RoadmapDraftSource[] {
  const order = new Map(items.map((item, index) => [item.id, index]));
  return items
    .filter(item => !item.completed)
    .sort((a, b) =>
      b.priorityScore - a.priorityScore || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

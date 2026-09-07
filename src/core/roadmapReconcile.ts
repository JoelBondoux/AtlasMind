/**
 * Folding a roadmap somebody wrote elsewhere into the one AtlasMind manages.
 *
 * The dashboard writes the backlog into a managed block between
 * `atlasmind:roadmap-items:start` and `:end`. When both markers are present it
 * replaces that block in place, which is correct. When they are not — a
 * hand-written roadmap, an older format, a file somebody reformatted — the
 * writer used to emit a fresh document and append **the entire previous file
 * verbatim** under `## Existing Notes`.
 *
 * That duplicates the whole backlog in one save, silently and permanently: every
 * later save updates only the managed block at the top, so the copy below is
 * never touched again. Measured on this repository it produced 123 item lines
 * where there were 72, with 27 anchor ids appearing twice — the exact hazard
 * `roadmapGraphStore` documents about a duplicated line stealing another item's
 * history. Nothing reported it, because both halves looked like a roadmap.
 *
 * Three rules.
 *
 * **Items and prose are separated before anything is preserved.** A checkbox
 * line is backlog and belongs in the managed block; a heading or a paragraph is
 * a note and does not. Appending both together is what made the duplicate, and
 * dropping both would lose the backlog, so the split has to happen first.
 *
 * **An existing item is adopted, never re-added.** Matching is on normalized
 * text, the same key `roadmapImport` adopts by, so a roadmap imported once and
 * reconciled later does not acquire two spellings of the same line. An item
 * already in the incoming set is left alone: the incoming copy is the one the
 * dashboard is holding, and it carries the anchor.
 *
 * **Nothing here writes.** It reports what a reconcile *would* do, so the caller
 * can show the counts and ask. A write to a git-tracked file that reorganises
 * somebody's roadmap is not a thing to do on the way past — which is why the
 * duplicate went unnoticed for as long as it did.
 *
 * Pure + unit-tested.
 */

import { normalizeImportedTitle } from './roadmapImport.js';

export const ROADMAP_ITEMS_START_MARKER = '<!-- atlasmind:roadmap-items:start -->';
export const ROADMAP_ITEMS_END_MARKER = '<!-- atlasmind:roadmap-items:end -->';

/** How many item lines a reconcile will adopt out of an unmanaged document. */
export const MAX_RECONCILED_ITEMS = 300;

export interface UnmanagedRoadmapAssessment {
  /** Both markers present: the writer replaces in place and nothing is at risk. */
  managed: boolean;
  /** Checkbox lines sitting outside any managed block. */
  orphanItemTexts: string[];
  /** Non-item lines, kept verbatim as notes. */
  noteLines: string[];
  /**
   * A save would append the backlog verbatim and duplicate it.
   *
   * The condition worth refusing on: unmanaged *and* carrying items. An
   * unmanaged file of pure prose is safe to preserve, and always was.
   */
  wouldDuplicate: boolean;
  /** Item lines beyond the cap, so a refusal can say what it did not count. */
  truncated: boolean;
}

/** A checkbox line, which is what the dashboard round-trips as an item. */
const ITEM_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX✓~-]?\]\s*(.*)$/;

/**
 * What an unmanaged roadmap document contains.
 *
 * Content inside a managed block is deliberately ignored: it is already the
 * dashboard's, and counting it would report every managed item as an orphan the
 * moment one marker went missing.
 */
export function assessUnmanagedRoadmap(existing: string): UnmanagedRoadmapAssessment {
  const text = typeof existing === 'string' ? existing : '';
  const managed = text.includes(ROADMAP_ITEMS_START_MARKER) && text.includes(ROADMAP_ITEMS_END_MARKER);
  const orphanItemTexts: string[] = [];
  const noteLines: string[] = [];
  let truncated = false;
  let insideBlock = false;
  let fenced = false;

  for (const line of text.split(/\r?\n/)) {
    if (line.includes(ROADMAP_ITEMS_START_MARKER)) {
      insideBlock = true;
      continue;
    }
    if (line.includes(ROADMAP_ITEMS_END_MARKER)) {
      insideBlock = false;
      continue;
    }
    if (insideBlock) {
      continue;
    }
    // A checkbox inside a fence is an example, not a backlog item — adopting it
    // would put documentation into somebody's plan.
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      noteLines.push(line);
      continue;
    }
    const match = fenced ? null : ITEM_LINE.exec(line);
    if (!match) {
      noteLines.push(line);
      continue;
    }
    const body = (match[1] ?? '').trim();
    if (body.length === 0) {
      continue;
    }
    if (orphanItemTexts.length >= MAX_RECONCILED_ITEMS) {
      truncated = true;
      continue;
    }
    orphanItemTexts.push(body);
  }

  return {
    managed,
    orphanItemTexts,
    noteLines,
    wouldDuplicate: !managed && orphanItemTexts.length > 0,
    truncated,
  };
}

export interface RoadmapReconcilePlan {
  /** Orphan items not already present in the incoming set, in document order. */
  adopted: string[];
  /** Orphans already represented in the incoming set. */
  alreadyPresent: number;
  /** What survives as `## Existing Notes`, or empty when there is no prose. */
  notes: string;
  truncated: boolean;
}

/**
 * What a reconcile would adopt, given what the dashboard is about to write.
 *
 * Adoption is one-directional: an orphan the incoming set already has is
 * dropped rather than merged, because the incoming line is the one carrying the
 * durable anchor and merging text into it would rewrite an item nobody edited.
 */
export function planRoadmapReconcile(
  existing: string,
  incomingTexts: readonly string[],
): RoadmapReconcilePlan {
  const assessment = assessUnmanagedRoadmap(existing);
  const known = new Set(incomingTexts.map(text => normalizeImportedTitle(String(text ?? ''))));
  const adopted: string[] = [];
  let alreadyPresent = 0;

  for (const text of assessment.orphanItemTexts) {
    const key = normalizeImportedTitle(text);
    if (key.length === 0 || known.has(key)) {
      alreadyPresent += 1;
      continue;
    }
    known.add(key);
    adopted.push(text);
  }

  // Trailing and leading blank runs collapse: the notes block is what is left
  // after the items were lifted out of it, and that leaves gaps.
  const notes = assessment.noteLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { adopted, alreadyPresent, notes, truncated: assessment.truncated };
}

/**
 * The machine-readable half of a commit message.
 *
 * A commit says what changed in prose. Nothing said *which planned work it was
 * for*, so every analytic that wanted to join code to intent had to guess from
 * wording — and a wrong join is worse than none, because it is counted rather
 * than noticed. `roadmapCostAttribution` already makes this join for money; this
 * makes it for commits, using git's own trailer convention so the answer is
 * readable by `git log`, `git interpret-trailers`, and anything else the project
 * ever points at its own history.
 *
 * Five rules.
 *
 * **Only a link somebody already declared.** The roadmap item comes from the
 * branch a roadmap item declares for itself; the issue number comes from the
 * branch naming convention the workflow file declares. Neither is inferred from
 * the commit's prose. Guessing would put a durable, wrong fact into history.
 *
 * **A value is validated, never cleaned.** A pushed commit message cannot be
 * edited, so a nearly-valid value made plausible is permanent and unfixable. A
 * value that does not parse is dropped and the reason reported, which is the
 * opposite of the usual boundary rule here and correct for the same underlying
 * reason: the cost of being wrong is not symmetric.
 *
 * **Trailers follow git's own rules.** One block at the end, `Key: value` per
 * line, separated from the body by a blank line — so `%(trailers)` sees them and
 * `Co-Authored-By` is joined rather than displaced.
 *
 * **Composing is idempotent.** A key already present is replaced, never
 * appended, so re-drafting a message twice does not accumulate three copies of
 * the same fact.
 *
 * **Nothing here writes a commit.** It returns text a person still reads and
 * still commits, which is the same gate `commitMessageDraft` relies on.
 *
 * Pure — no `fs`, no git, no model.
 */

export type CommitTrailerKey = 'Roadmap-Item' | 'Issue';

export interface CommitTrailerRule {
  key: CommitTrailerKey;
  description: string;
}

/** Published so a surface can say where a link came from. */
export const COMMIT_TRAILER_RULES: readonly CommitTrailerRule[] = [
  {
    key: 'Roadmap-Item',
    description: 'The backlog item this work is for, taken from the branch that item declares. Never inferred from the commit text.',
  },
  {
    key: 'Issue',
    description: 'The tracker issue, taken from the issue number the declared branch naming convention puts in the branch name.',
  },
];

/**
 * A roadmap anchor id, which is what `roadmapGraphStore` mints and writes into
 * the backlog markdown. Constrained because the value reaches a commit message
 * that outlives every chance to correct it.
 */
const ROADMAP_ITEM_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** `<type>/<issue>-<slug>`, the shape the workflow file declares for a branch. */
const BRANCH_ISSUE_PATTERN = /^[a-z]+\/(\d{1,9})-/;

export interface CommitTrailerSet {
  'Roadmap-Item'?: string;
  Issue?: string;
}

export interface ComposeCommitTrailersInput {
  message: string;
  trailers: CommitTrailerSet;
}

export interface ComposeCommitTrailersResult {
  message: string;
  /** Keys actually written, in declared order. */
  applied: CommitTrailerKey[];
  /** Values refused, with why — reported rather than silently dropped. */
  refused: Array<{ key: CommitTrailerKey; value: string; reason: string }>;
}

/** Whether a value may be written for this key. */
export function isValidCommitTrailerValue(key: CommitTrailerKey, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return key === 'Roadmap-Item'
    ? ROADMAP_ITEM_PATTERN.test(trimmed)
    : /^\d{1,9}$/.test(trimmed.replace(/^#/, ''));
}

/**
 * The issue number a branch name declares, or nothing.
 *
 * Read from the convention rather than searched for: a bare number anywhere in a
 * branch name is not an issue reference, and treating it as one is how a commit
 * ends up permanently pointing at somebody else's ticket.
 */
export function issueFromBranchName(branch: string): string | undefined {
  const match = BRANCH_ISSUE_PATTERN.exec(String(branch ?? '').trim().toLowerCase());
  return match?.[1];
}

/**
 * Append or replace the trailer block on a message.
 *
 * The body is left exactly as written — this only ever touches the trailing
 * block, because a function that reflowed somebody's commit message while
 * adding a label would be doing two things and only one of them was asked for.
 */
export function composeCommitTrailers(input: ComposeCommitTrailersInput): ComposeCommitTrailersResult {
  const refused: ComposeCommitTrailersResult['refused'] = [];
  const applied: CommitTrailerKey[] = [];

  const wanted = new Map<CommitTrailerKey, string>();
  for (const rule of COMMIT_TRAILER_RULES) {
    const raw = input.trailers[rule.key];
    if (raw === undefined) {
      continue;
    }
    const value = String(raw).trim().replace(/^#/, '');
    if (!isValidCommitTrailerValue(rule.key, value)) {
      refused.push({
        key: rule.key,
        value: String(raw),
        reason: `Not a valid ${rule.key} value. A commit message cannot be edited once pushed, so this is refused rather than corrected.`,
      });
      continue;
    }
    wanted.set(rule.key, value);
  }

  const { body, trailers } = splitTrailerBlock(String(input.message ?? ''));
  const merged: Array<{ key: string; value: string }> = [];
  const replaced = new Set<string>();

  // Existing trailers keep their position, so a `Co-Authored-By` somebody wrote
  // stays where they put it and only the keys we own are rewritten in place.
  for (const trailer of trailers) {
    const owned = [...wanted.keys()].find(key => key.toLowerCase() === trailer.key.toLowerCase());
    if (owned !== undefined) {
      merged.push({ key: owned, value: wanted.get(owned)! });
      replaced.add(owned);
      applied.push(owned);
      continue;
    }
    merged.push(trailer);
  }
  for (const rule of COMMIT_TRAILER_RULES) {
    if (wanted.has(rule.key) && !replaced.has(rule.key)) {
      merged.push({ key: rule.key, value: wanted.get(rule.key)! });
      applied.push(rule.key);
    }
  }

  if (merged.length === 0) {
    return { message: body, applied, refused };
  }
  const block = merged.map(trailer => `${trailer.key}: ${trailer.value}`).join('\n');
  const trimmedBody = body.replace(/\s+$/, '');
  return {
    message: trimmedBody.length > 0 ? `${trimmedBody}\n\n${block}\n` : `${block}\n`,
    applied,
    refused,
  };
}

/** Every trailer on a message, in the order git would read them. */
export function parseCommitTrailers(message: string): Array<{ key: string; value: string }> {
  return splitTrailerBlock(String(message ?? '')).trailers;
}

/** The links this project cares about, or nothing where they are absent. */
export function readCommitLinks(message: string): CommitTrailerSet {
  const links: CommitTrailerSet = {};
  for (const trailer of parseCommitTrailers(message)) {
    for (const rule of COMMIT_TRAILER_RULES) {
      if (trailer.key.toLowerCase() !== rule.key.toLowerCase()) {
        continue;
      }
      const value = trailer.value.trim().replace(/^#/, '');
      // Read back through the same gate it was written through: a hand-edited
      // history can contain anything, and a surface joining on a malformed id
      // would report a link to an item that does not exist.
      if (isValidCommitTrailerValue(rule.key, value)) {
        links[rule.key] = value;
      }
    }
  }
  return links;
}

/**
 * Split a message into its body and its trailing trailer block.
 *
 * Git's own rule, in the part that matters: the last paragraph counts as
 * trailers only when **every** line in it is `Key: value`. A final paragraph of
 * prose that happens to contain one colon is prose, and treating it as a trailer
 * would invent a label nobody wrote.
 */
function splitTrailerBlock(message: string): { body: string; trailers: Array<{ key: string; value: string }> } {
  const normalized = message.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  // Trailing blank lines are not part of the last paragraph.
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim().length === 0) {
    end -= 1;
  }
  let start = end;
  while (start > 0 && lines[start - 1]!.trim().length > 0) {
    start -= 1;
  }
  if (start === end) {
    return { body: normalized, trailers: [] };
  }

  const candidate = lines.slice(start, end);
  const parsed: Array<{ key: string; value: string }> = [];
  for (const line of candidate) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/.exec(line);
    if (!match) {
      // One prose line is enough to make the whole paragraph prose. The
      // alternative — taking the lines that happen to match — would split a
      // sentence out of somebody's closing paragraph and call it metadata.
      return { body: normalized, trailers: [] };
    }
    parsed.push({ key: match[1]!, value: match[2]!.trim() });
  }

  // A subject line on its own is a message, not a trailer block.
  if (start === 0) {
    return { body: normalized, trailers: [] };
  }
  return { body: lines.slice(0, start).join('\n'), trailers: parsed };
}

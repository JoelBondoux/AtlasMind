/**
 * Labels and milestones — the taxonomy the workflow depends on, managed where
 * it is used.
 *
 * Stage 1 drafts issues with labels drawn only from the declared taxonomy, and
 * an unmatched label is dropped rather than invented. That rule is only as good
 * as the taxonomy behind it, and until now a team could see which labels their
 * issues carried but had to leave the editor to change the set.
 *
 * Two properties carry weight here.
 *
 * **A deletion names every issue that will lose the label.** GitHub deletes a
 * label from the repository *and* from every issue carrying it, in one
 * irreversible step, and its own confirmation does not say how many. That is the
 * whole reason this module exists as more than a list: the count comes from the
 * issue list already on screen, so it costs nothing and it is the difference
 * between an informed decision and a click.
 *
 * **A colour is validated, not cleaned.** GitHub returns six hex digits without
 * a `#`, and the surface renders it into a style attribute. Anything else is
 * dropped rather than repaired — a "colour" reaching a stylesheet is an
 * injection, and a nearly-valid one repaired into something plausible is worse
 * than a missing swatch.
 *
 * Pure and `vscode`-free; every read is a total function over untrusted text.
 */

const MAX_LABELS = 200;
const MAX_MILESTONES = 100;
const MAX_LABEL_NAME = 60;
const MAX_DESCRIPTION = 200;
const MAX_AFFECTED_NAMED = 8;

export interface LabelRecord {
  name: string;
  /** Six hex digits, no `#`, or '' when the feed gave nothing usable. */
  color: string;
  description: string;
  /** Issues currently carrying it, from the list already fetched. */
  issueCount: number;
}

export type MilestoneState = 'open' | 'closed';

export interface MilestoneRecord {
  number: number;
  title: string;
  state: MilestoneState;
  /** ISO date, or '' when none was set. */
  dueOn: string;
  openIssues: number;
  closedIssues: number;
}

/** Control-strip, clamp, and refuse anything that is not a string. */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * A colour, or nothing.
 *
 * Six hex digits exactly. Not lowercased-and-hoped, not padded, not prefixed:
 * this value is rendered into a style attribute, and the only safe answer for
 * anything else is to have no colour.
 */
export function safeLabelColor(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : '';
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

/**
 * Parse `gh label list --json name,color,description`.
 *
 * `issueCount` is filled from the issue list the dashboard already holds, so
 * knowing how many issues a label is on costs no extra request — which is what
 * makes it affordable to show on every row rather than only on a deletion.
 */
export function parseGhLabelList(
  raw: string,
  issues: readonly { labels: readonly string[] }[] = [],
): LabelRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const counts = new Map<string, number>();
  for (const issue of issues) {
    for (const label of issue.labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  const out: LabelRecord[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.slice(0, MAX_LABELS)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = clean(record['name'], MAX_LABEL_NAME);
    // A label with no name is not a label, and repairing one would invent a
    // taxonomy entry nobody declared.
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push({
      name,
      color: safeLabelColor(record['color']),
      description: clean(record['description'], MAX_DESCRIPTION),
      issueCount: counts.get(name) ?? 0,
    });
  }
  // Most-used first: a taxonomy is easiest to reason about when the labels that
  // are actually load-bearing are at the top. Alphabetical within a count so the
  // order is stable.
  return out.sort((a, b) =>
    b.issueCount - a.issueCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Parse `gh api repos/{slug}/milestones?state=all`. Never throws. */
export function parseGhMilestoneList(raw: string): MilestoneRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const out: MilestoneRecord[] = [];
  for (const entry of parsed.slice(0, MAX_MILESTONES)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const number = toPositiveInt(record['number']);
    const title = clean(record['title'], MAX_LABEL_NAME);
    if (number === 0 || !title) {
      continue;
    }
    out.push({
      number,
      title,
      // An unrecognised state reads as `open`, which keeps the milestone visible.
      state: record['state'] === 'closed' ? 'closed' : 'open',
      dueOn: clean(record['due_on'], 40).slice(0, 10),
      openIssues: toPositiveInt(record['open_issues']),
      closedIssues: toPositiveInt(record['closed_issues']),
    });
  }
  // Open first, then soonest due, then by number. A milestone with no due date
  // sorts after dated ones rather than before: an undated milestone is not
  // urgent, it is unscheduled.
  return out.sort((a, b) => {
    if (a.state !== b.state) {
      return a.state === 'open' ? -1 : 1;
    }
    if (Boolean(a.dueOn) !== Boolean(b.dueOn)) {
      return a.dueOn ? -1 : 1;
    }
    return a.dueOn === b.dueOn ? a.number - b.number : (a.dueOn < b.dueOn ? -1 : 1);
  });
}

export interface LabelDeletionImpact {
  label: string;
  /** How many issues carry it. */
  issueCount: number;
  /** Issue numbers, capped for the dialog. */
  named: number[];
  /** How many are not named because of the cap. */
  unnamed: number;
}

/**
 * What deleting a label would take with it.
 *
 * GitHub removes the label from the repository *and* from every issue carrying
 * it, in one step that cannot be undone, and says nothing about how many. This
 * is derived from the issue list already on screen, so it is free — and a
 * deletion that named nothing would be asking somebody to confirm a number they
 * do not have.
 *
 * Closed issues count. A label stripped from a closed issue takes with it the
 * reason that issue was categorised the way it was, and closed issues are what
 * people search when they want to know what happened before.
 */
export function describeLabelDeletionImpact(
  label: string,
  issues: readonly { number: number; labels: readonly string[] }[],
): LabelDeletionImpact {
  const carrying = issues
    .filter(issue => issue.labels.includes(label))
    .map(issue => issue.number)
    .sort((a, b) => a - b);

  return {
    label,
    issueCount: carrying.length,
    named: carrying.slice(0, MAX_AFFECTED_NAMED),
    unnamed: Math.max(0, carrying.length - MAX_AFFECTED_NAMED),
  };
}

/**
 * The confirmation text for a label deletion.
 *
 * Says the count first, because that is the number somebody is deciding on, and
 * names the issues because a count alone cannot be checked. Where the issue list
 * was never loaded it says so rather than reporting zero — "no issues use this"
 * and "we did not look" lead to opposite decisions, and only one of them is
 * safe to act on.
 */
export function describeLabelDeletion(
  impact: LabelDeletionImpact,
  repoSlug: string,
  issuesLoaded: boolean,
): string {
  const where = repoSlug || 'this repository';
  const head = `Delete the label \`${impact.label}\` from ${where}?`;

  if (!issuesLoaded) {
    return [
      head,
      '',
      'The issue list has not been loaded, so AtlasMind cannot tell you which issues would lose this',
      'label. Deleting it removes it from the repository and from every issue carrying it, and that',
      'cannot be undone. Refresh the issue list first.',
    ].join('\n');
  }

  if (impact.issueCount === 0) {
    return [
      head,
      '',
      'No issue currently carries it, so nothing else changes. This still cannot be undone.',
    ].join('\n');
  }

  const named = impact.named.map(number => `#${number}`).join(', ');
  return [
    head,
    '',
    `${impact.issueCount} issue${impact.issueCount === 1 ? '' : 's'} would lose it: ${named}${
      impact.unnamed > 0 ? `, and ${impact.unnamed} more` : ''}.`,
    '',
    'GitHub removes a label from the repository and from every issue carrying it in one step, and',
    'that cannot be undone. If you want to stop using it without losing the record, rename it instead.',
  ].join('\n');
}

/**
 * A label name that is safe to send.
 *
 * GitHub accepts most characters in a label, so this is deliberately permissive
 * about content and strict about the two things that break: emptiness, and
 * length. Returned trimmed, because a label with a trailing space is a label
 * nobody can match against the declared taxonomy.
 */
export function normalizeLabelName(value: unknown): string {
  const cleaned = clean(value, MAX_LABEL_NAME);
  return cleaned;
}

export interface TaxonomyDrift {
  /** Declared in `workflow.json` and absent from the repository. */
  missing: string[];
  /** Present on the repository and not declared. */
  undeclared: string[];
  summary: string;
}

/**
 * Where the declared taxonomy and the repository disagree.
 *
 * Both directions matter and they mean different things. A **declared** label
 * that does not exist is a label the drafter will silently drop, which is the
 * one failure mode stage 1 promises not to have. An **undeclared** label that
 * exists is a label people are using and the workflow will never suggest —
 * usually a sign the declaration is out of date rather than that the label is
 * wrong.
 *
 * Neither is reported as an error. This is a comparison, not a verdict.
 */
export function findTaxonomyDrift(
  declared: readonly string[],
  onRepository: readonly LabelRecord[],
): TaxonomyDrift {
  const existing = new Set(onRepository.map(label => label.name));
  const declaredSet = new Set(declared);
  const missing = declared.filter(name => !existing.has(name));
  const undeclared = onRepository
    .filter(label => !declaredSet.has(label.name))
    .map(label => label.name);

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `${missing.length} declared label${missing.length === 1 ? '' : 's'} ${
        missing.length === 1 ? 'does' : 'do'} not exist on the repository, so ${
        missing.length === 1 ? 'it' : 'they'} will be dropped from any draft`,
    );
  }
  if (undeclared.length > 0) {
    parts.push(
      `${undeclared.length} label${undeclared.length === 1 ? '' : 's'} ${
        undeclared.length === 1 ? 'is' : 'are'} in use and not declared, so ${
        undeclared.length === 1 ? 'it' : 'they'} will never be suggested`,
    );
  }

  return {
    missing,
    undeclared,
    summary: parts.length > 0
      ? `${parts.join('; ')}.`
      : 'The declared taxonomy matches the repository.',
  };
}

/**
 * Synthesising a pull-request draft from a commit range.
 *
 * Removes the two steps people skip — writing the body and linking the issue —
 * without letting a model author either. The determinism requirement from
 * `docs/guided-github-workflow.md` §3.4 is exact: **the same commit range plus
 * the same template produces a byte-identical draft.** No model participates.
 *
 * Two decisions carry the weight:
 *
 * 1. **The title reuses `classifyBumpLevel` rather than parsing commits again.**
 *    That function already reads conventional commits to decide a version bump.
 *    A second parser of the same format would eventually disagree with the
 *    first, and the disagreement would show up as a release whose version does
 *    not match its own pull-request title.
 *
 * 2. **The template is filled, never replaced.** A team's checklist is theirs;
 *    this module inserts under headings it recognises and leaves everything else
 *    exactly as written — including headings it has never heard of. A drafter
 *    that quietly dropped a team's custom section would be worse than one that
 *    left the body empty.
 *
 * Pure and unit-tested.
 */

import { classifyBumpLevel } from './promotionRunner.js';

export interface PullRequestDraftInput {
  headRef: string;
  baseRef: string;
  /** Commit subjects in the range, newest first or oldest first — order-independent. */
  commitSubjects: readonly string[];
  /** The issue this closes, when there is one. */
  issueNumber?: number;
  issueTitle?: string;
  /** Contents of `.github/pull_request_template.md`, when the repository has one. */
  template?: string;
  /** Labels to apply, filtered against the declared taxonomy. */
  labels?: readonly string[];
  /** The project's declared label taxonomy. An unmatched label is dropped. */
  declaredLabels?: readonly string[];
  /** Marks the draft as not-ready. */
  draft?: boolean;
}

export interface PullRequestDraft {
  title: string;
  body: string;
  labels: string[];
  linkedIssue?: number;
  draft: boolean;
  /** Anything the caller should know before this is opened. Never silent. */
  warnings: string[];
}

const MAX_TITLE = 120;

/** Conventional type implied by a bump level, when no single commit supplies one. */
const TYPE_FOR_BUMP: Record<'major' | 'minor' | 'patch', string> = {
  major: 'feat!',
  minor: 'feat',
  patch: 'fix',
};

const CONVENTIONAL_SUBJECT = /^([a-z]+)(\([^)]*\))?(!)?:\s+(.+)$/i;

/**
 * A title for the range.
 *
 * A single commit already carries a human-written conventional subject, and
 * rewriting it would discard the best available description in favour of a
 * derived one. Only a multi-commit range needs synthesis.
 */
export function derivePullRequestTitle(input: {
  commitSubjects: readonly string[];
  issueTitle?: string;
  headRef?: string;
}): string {
  // Keep the *full* messages for classification and take first lines only for
  // display. Conventional commits declare a breaking change with a
  // `BREAKING CHANGE:` footer in the body, so classifying against subjects
  // alone would silently read a major change as a patch.
  const messages = input.commitSubjects
    .map(message => (message ?? '').trim())
    .filter(message => message.length > 0
      && !/^Merge (branch|pull request|remote-tracking)/i.test(message));

  const subjects = messages.map(message => message.split('\n', 1)[0]!.trim());

  if (subjects.length === 1 && CONVENTIONAL_SUBJECT.test(subjects[0]!)) {
    return subjects[0]!.slice(0, MAX_TITLE);
  }

  const bump = classifyBumpLevel(messages);
  const type = TYPE_FOR_BUMP[bump];

  // Prefer the issue title: it describes the *outcome*, which is what a
  // reviewer needs, whereas a commit subject describes one step toward it.
  const description = firstUsable([
    input.issueTitle,
    // A conventional first subject already has its description separated out.
    subjects[0] ? CONVENTIONAL_SUBJECT.exec(subjects[0])?.[4] : undefined,
    subjects[0],
    input.headRef ? describeFromBranch(input.headRef) : undefined,
  ]) ?? 'update';

  return `${type}: ${lowerFirst(description)}`.slice(0, MAX_TITLE);
}

function firstUsable(candidates: readonly (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

/** `feat/142-add-a-thing` → `add a thing`. */
function describeFromBranch(ref: string): string | undefined {
  const slug = ref.split('/').pop() ?? '';
  const withoutIssue = slug.replace(/^\d+-/, '');
  const words = withoutIssue.split('-').filter(Boolean);
  return words.length > 0 ? words.join(' ') : undefined;
}

/**
 * Lower-case a leading word unless it looks like a proper noun or an acronym.
 *
 * `Add recovery window` → `add recovery window`, but `GitHub` and `API` survive
 * — mangling those reads as a typo rather than as a convention.
 */
function lowerFirst(text: string): string {
  const [first = '', ...rest] = text.split(' ');
  if (first.length > 1 && first === first.toUpperCase()) {
    return text;
  }
  if (/^[A-Z][a-z]*[A-Z]/.test(first)) {
    return text;
  }
  return [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(' ');
}

/**
 * Fill the repository's template.
 *
 * Recognised headings get content inserted; everything else is preserved
 * verbatim, including headings this module has never seen. The placeholder line
 * `- Closes #<issue-number>` is replaced rather than appended to, because
 * leaving it would ship a pull request containing a literal `<issue-number>`.
 */
export function fillPullRequestTemplate(options: {
  template: string;
  summary: string;
  issueNumber?: number;
}): string {
  const lines = options.template.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let section = '';

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1]!.trim().toLowerCase();
      out.push(line);
      continue;
    }

    if (section === 'summary' && /^-\s*(What changed\?|Why is this change needed\?)/i.test(line.trim())) {
      // Replace the prompts with the derived summary, once.
      if (!out.some(existing => existing === options.summary)) {
        out.push(options.summary);
      }
      continue;
    }

    if (section === 'linked work' && /^-\s*Closes\s+#<issue-number>/i.test(line.trim())) {
      out.push(options.issueNumber === undefined
        // Stated rather than left blank: "no linked issue" is a fact a reviewer
        // should see, and a silent omission reads as an oversight.
        ? '- No linked issue.'
        : `- Closes #${options.issueNumber}`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** The body used when a repository has no template of its own. */
export function defaultPullRequestBody(options: { summary: string; issueNumber?: number }): string {
  return [
    '## Summary',
    options.summary,
    '',
    '## Linked Work',
    options.issueNumber === undefined ? '- No linked issue.' : `- Closes #${options.issueNumber}`,
    '',
  ].join('\n');
}

/**
 * Build the draft.
 *
 * Every value is a pure derivation of the inputs, so the same range and template
 * produce the same bytes. Anything the caller should know — an unmatched label,
 * a missing issue link — is returned as a warning rather than silently applied
 * or silently dropped.
 */
export function buildPullRequestDraft(input: PullRequestDraftInput): PullRequestDraft {
  const warnings: string[] = [];

  const title = derivePullRequestTitle({
    commitSubjects: input.commitSubjects,
    ...(input.issueTitle === undefined ? {} : { issueTitle: input.issueTitle }),
    headRef: input.headRef,
  });

  const summary = summarise(input);

  const body = input.template && input.template.trim().length > 0
    ? fillPullRequestTemplate({
      template: input.template,
      summary,
      ...(input.issueNumber === undefined ? {} : { issueNumber: input.issueNumber }),
    })
    : defaultPullRequestBody({
      summary,
      ...(input.issueNumber === undefined ? {} : { issueNumber: input.issueNumber }),
    });

  // Labels come only from the declared taxonomy. An unmatched label is dropped
  // and reported — inventing one silently fragments the filters the taxonomy
  // exists to support.
  const declared = input.declaredLabels;
  const requested = input.labels ?? [];
  const labels: string[] = [];
  for (const label of requested) {
    if (declared === undefined || declared.includes(label)) {
      if (!labels.includes(label)) {
        labels.push(label);
      }
    } else {
      warnings.push(`Label \`${label}\` is not in the declared taxonomy and was dropped.`);
    }
  }

  if (input.issueNumber === undefined) {
    warnings.push('No linked issue. The pull request and the reasoning behind it will live in separate places.');
  }
  if (input.commitSubjects.length === 0) {
    warnings.push('The commit range is empty — there may be nothing to open a pull request for.');
  }

  return {
    title,
    body,
    labels,
    ...(input.issueNumber === undefined ? {} : { linkedIssue: input.issueNumber }),
    draft: input.draft === true,
    warnings,
  };
}

/** A one-line summary of the range, stating counts rather than characterising them. */
function summarise(input: PullRequestDraftInput): string {
  const real = input.commitSubjects.filter(
    subject => !/^Merge (branch|pull request|remote-tracking)/i.test((subject ?? '').trim()),
  );
  const count = real.length;
  const scope = input.issueTitle ? ` for ${input.issueTitle}` : '';
  return `- ${count} commit${count === 1 ? '' : 's'} on \`${input.headRef}\`${scope}, merging into \`${input.baseRef}\`.`;
}

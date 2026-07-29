/**
 * Release preparation — stage 6 of the guided workflow.
 *
 * The hard parts of a release already existed and were already pure:
 * `classifyBumpLevel`, `bumpVersion`, `setPackageJsonVersion`,
 * `insertChangelogEntry` and `compareSemver` have shipped in
 * `promotionRunner.ts` since long before this workflow did. What was missing was
 * a *path* — something that puts them in order, checks the preconditions, and
 * says plainly what is not ready yet. This module is that path, and it borrows
 * every one of those functions rather than growing a second copy.
 *
 * Three properties are load-bearing, and each exists because the obvious
 * alternative is wrong:
 *
 * **Release notes are the changelog section, verbatim.** Not summarised, not
 * rewritten, not model-generated. A release note is a permanent public record
 * that a human is accountable for; a generated one is a claim nobody checked
 * attached to a version nobody can change. `extractChangelogSection` copies
 * bytes and marks truncation — it never paraphrases.
 *
 * **A secret in the notes refuses the release rather than being redacted out of
 * it.** This inverts the usual boundary rule on purpose. Elsewhere in AtlasMind
 * untrusted text is redacted and passed on, because the alternative is losing
 * information. Here the text is *outbound and permanent*: quietly redacting it
 * would mean publishing something other than what the author reviewed, and they
 * would have no way to know. The same reasoning `buzzSendPolicy` uses for an
 * outbound message applies with more force to a release that cannot be recalled.
 *
 * **Nothing here executes anything.** `buildReleasePlan` is a pure function over
 * observed state. Applying the plan writes local files only; tagging and
 * publishing stay with the human, at every automation rung, because a published
 * version cannot be withdrawn.
 */

import { classifyBumpLevel, bumpVersion, compareSemver, type BumpLevel } from './promotionRunner.js';
import { redactSecrets } from '../utils/secretRedactor.js';

/** Release notes above this size are truncated, and the truncation is stated. */
export const MAX_RELEASE_NOTES_CHARS = 60_000;

export type ReleaseGateId =
  | 'changelog-entry'
  | 'notes-body'
  | 'notes-clean'
  | 'version-ahead'
  | 'tag-free'
  | 'clean-tree'
  | 'ci-green';

export type ReleaseGateStatus = 'pass' | 'fail' | 'unknown';

export interface ReleaseGate {
  id: ReleaseGateId;
  label: string;
  status: ReleaseGateStatus;
  /** What was actually observed. Never a guess dressed as a fact. */
  detail: string;
  /** The concrete next thing to do. Present whenever the gate is not passing. */
  fixHint?: string;
}

export interface ReleaseNotes {
  /** The changelog heading the notes were taken from, for attribution. */
  heading: string;
  /** The section body, byte-for-byte as the changelog holds it. */
  body: string;
  truncated: boolean;
  /**
   * Secret *shapes* found in the body — names only, never values. A non-empty
   * list blocks the release; it is deliberately not used to rewrite the notes.
   */
  secretTypes: string[];
}

export interface ReleasePlanInput {
  /** The version in the manifest — what a release would publish. */
  currentVersion: string;
  changelog?: string;
  /** Tags that already exist, in any order. Absent means "we could not look". */
  existingTags?: readonly string[];
  /** The most recent published release, if one was readable. */
  lastReleasedVersion?: string;
  /** Commit subjects since the last release, for the bump classification. */
  commitSubjects?: readonly string[];
  workingTreeClean?: boolean;
  /** Latest CI conclusion for the release branch, when it was read. */
  ciConclusion?: 'success' | 'failure' | 'pending' | 'none';
  /** Tag format, so a repo that does not prefix with `v` is not told it is wrong. */
  tagPrefix?: string;
}

export interface ReleasePlan {
  currentVersion: string;
  /** The tag this release would carry. */
  tag: string;
  /** The bump the commit range warrants, by the promotion runner's own rule. */
  suggestedLevel: BumpLevel;
  /** What the *next* version would be if this one is already released. */
  suggestedVersion: string;
  lastReleasedVersion?: string;
  notes?: ReleaseNotes;
  gates: ReleaseGate[];
  /** True only when every gate passes. An `unknown` gate is not a pass. */
  ready: boolean;
  /** Labels of the gates that are not passing, in evaluation order. */
  blockedBy: string[];
}

/**
 * Pull one version's section out of a Keep-a-Changelog document, verbatim.
 *
 * Matches `## [1.2.3] - date`, `## [1.2.3]`, `## 1.2.3` and a `v` prefix on any
 * of them, because all four appear in real changelogs and refusing three of them
 * would report a perfectly good changelog as missing an entry.
 *
 * Total: a malformed document yields `undefined`, never an exception.
 */
export function extractChangelogSection(
  raw: string | undefined,
  version: string,
): ReleaseNotes | undefined {
  if (typeof raw !== 'string' || !raw || typeof version !== 'string' || !version) {
    return undefined;
  }

  const target = version.replace(/^v/i, '');
  const lines = raw.split(/\r?\n/);

  let start = -1;
  let heading = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('## ')) {
      continue;
    }
    // The version is read from the heading rather than the heading matched
    // against a pattern, so decoration around it (dates, links, "— codename")
    // does not stop a real entry being found.
    const found = /^##\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/.exec(line);
    if (found && found[1] === target) {
      start = index;
      heading = line.trim();
      break;
    }
  }

  if (start === -1) {
    return undefined;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('## ')) {
      end = index;
      break;
    }
  }

  // Leading and trailing blank lines are structural, not content: dropping them
  // is the only edit this function makes, and it changes no words.
  const body = lines.slice(start + 1, end).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  const truncated = body.length > MAX_RELEASE_NOTES_CHARS;
  const kept = truncated ? `${body.slice(0, MAX_RELEASE_NOTES_CHARS)}\n\n_[Truncated by AtlasMind — the changelog section is longer than the release-note limit.]_` : body;

  // Detection only. The redacted text is discarded: it exists to answer "is
  // there something secret-shaped in here", and the answer blocks the release
  // rather than editing what gets published.
  const scan = redactSecrets(body);

  return {
    heading,
    body: kept,
    truncated,
    secretTypes: scan.redactedCount > 0 ? [...new Set(scan.redactedTypes)] : [],
  };
}

/** Normalise a tag list to bare versions, so `v1.2.3` and `1.2.3` compare equal. */
function bareVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '');
}

/**
 * Assemble the ordered gate list for a release.
 *
 * Ordering is presentation as well as logic: the gates run cheapest-and-most-
 * fundamental first, so the first failure a user reads is the one closest to the
 * root cause. Being told CI is red is unhelpful when the actual problem is that
 * the changelog has no entry for the version being released.
 *
 * `unknown` is a first-class outcome and never counts as a pass. A gate that
 * could not be evaluated — no tag list because `gh` was unreachable — is a gate
 * whose answer nobody knows, and shipping on an unknown is exactly the habit
 * this stage exists to break.
 */
export function evaluateReleaseGates(
  input: ReleasePlanInput,
  notes: ReleaseNotes | undefined,
): ReleaseGate[] {
  const version = input.currentVersion;
  const prefix = input.tagPrefix ?? 'v';
  const tag = `${prefix}${version}`;
  const gates: ReleaseGate[] = [];

  gates.push(notes
    ? {
      id: 'changelog-entry',
      label: 'Changelog entry',
      status: 'pass',
      detail: `\`CHANGELOG.md\` has a section for ${version}.`,
    }
    : {
      id: 'changelog-entry',
      label: 'Changelog entry',
      status: 'fail',
      detail: input.changelog
        ? `\`CHANGELOG.md\` has no section for ${version}.`
        : 'No `CHANGELOG.md` was readable.',
      fixHint: `Add a \`## [${version}]\` section describing this release. Its text becomes the release notes verbatim.`,
    });

  const body = notes?.body.trim() ?? '';
  gates.push(body.length > 0
    ? {
      id: 'notes-body',
      label: 'Notes have content',
      status: 'pass',
      detail: `${body.split(/\r?\n/).length} lines will be published as the release notes.`,
    }
    : {
      id: 'notes-body',
      label: 'Notes have content',
      status: notes ? 'fail' : 'unknown',
      detail: notes
        ? 'The changelog section for this version is empty.'
        : 'No section to read, so there is nothing to check.',
      fixHint: 'Describe what changed. An empty release note is worse than no release, because it looks deliberate.',
    });

  const secretTypes = notes?.secretTypes ?? [];
  gates.push(secretTypes.length === 0
    ? {
      id: 'notes-clean',
      label: 'No secrets in the notes',
      status: notes ? 'pass' : 'unknown',
      detail: notes
        ? 'Nothing secret-shaped found in the text that would be published.'
        : 'No section to scan.',
      ...(notes ? {} : { fixHint: 'Add the changelog entry first.' }),
    }
    : {
      id: 'notes-clean',
      label: 'No secrets in the notes',
      status: 'fail',
      detail: `The changelog section contains text shaped like a credential (${secretTypes.join(', ')}).`,
      // Refusal, not redaction — see the module header. Publishing an edited
      // version of what the author reviewed is the worse of the two failures.
      fixHint: 'Remove it from `CHANGELOG.md` and rotate the credential. AtlasMind will not publish redacted notes, because you would have no way to know what was removed.',
    });

  const last = input.lastReleasedVersion;
  gates.push(last === undefined
    ? {
      id: 'version-ahead',
      label: 'Version moved on',
      status: 'unknown',
      detail: 'No published release was readable, so there is nothing to compare against.',
      fixHint: 'Refresh the release list, or publish the first release.',
    }
    : compareSemver(version, last) > 0
      ? {
        id: 'version-ahead',
        label: 'Version moved on',
        status: 'pass',
        detail: `${version} is ahead of the last published release (${last}).`,
      }
      : {
        id: 'version-ahead',
        label: 'Version moved on',
        status: 'fail',
        detail: compareSemver(version, last) === 0
          ? `${version} is already published.`
          : `${version} is behind the last published release (${last}).`,
        fixHint: `Bump the manifest version and add a matching changelog entry.`,
      });

  // The tag gate is what stops the double-publish this repository documented and
  // then fixed: an existing tag means the publish workflow has already fired for
  // this version, and running it again fails on "version already exists".
  const tags = input.existingTags;
  gates.push(tags === undefined
    ? {
      id: 'tag-free',
      label: 'Tag is free',
      status: 'unknown',
      detail: 'Tags could not be listed, so a collision cannot be ruled out.',
      fixHint: 'Run `git fetch --tags` and refresh.',
    }
    : tags.some(existing => bareVersion(existing) === bareVersion(tag))
      ? {
        id: 'tag-free',
        label: 'Tag is free',
        status: 'fail',
        detail: `\`${tag}\` already exists.`,
        fixHint: 'Bump to the next version. Never delete or move a published tag — anyone who fetched it keeps the old contents under the new name.',
      }
      : {
        id: 'tag-free',
        label: 'Tag is free',
        status: 'pass',
        detail: `\`${tag}\` is not taken.`,
      });

  gates.push(input.workingTreeClean === undefined
    ? {
      id: 'clean-tree',
      label: 'Working tree clean',
      status: 'unknown',
      detail: 'The working tree state was not read.',
    }
    : input.workingTreeClean
      ? {
        id: 'clean-tree',
        label: 'Working tree clean',
        status: 'pass',
        detail: 'Nothing uncommitted.',
      }
      : {
        id: 'clean-tree',
        label: 'Working tree clean',
        status: 'fail',
        detail: 'There are uncommitted changes.',
        fixHint: 'Commit or stash them. A tag points at a commit, so anything uncommitted is not in the release however finished it feels.',
      });

  const ci = input.ciConclusion;
  gates.push(
    ci === 'success'
      ? { id: 'ci-green', label: 'CI passing', status: 'pass', detail: 'The most recent run succeeded.' }
      : ci === 'failure'
        ? {
          id: 'ci-green',
          label: 'CI passing',
          status: 'fail',
          detail: 'The most recent run failed.',
          fixHint: 'Open the Pipeline page — the failure is classified with its evidence.',
        }
        : ci === 'pending'
          ? {
            id: 'ci-green',
            label: 'CI passing',
            status: 'unknown',
            detail: 'A run is still in progress.',
            fixHint: 'Wait for it to finish.',
          }
          : {
            id: 'ci-green',
            label: 'CI passing',
            status: 'unknown',
            detail: ci === 'none' ? 'No CI runs were found for this branch.' : 'CI status was not read.',
            fixHint: 'Refresh the pipeline, or add a workflow so a release has something verifying it.',
          },
  );

  return gates;
}

/**
 * Build the whole plan: what would be released, and what is stopping it.
 *
 * Pure. Nothing is written, nothing is fetched, and — at every automation rung —
 * nothing is published. `ready` means the gates agree it *could* be released,
 * which is a different statement from anyone having decided that it should be.
 */
export function buildReleasePlan(input: ReleasePlanInput): ReleasePlan {
  const version = (input.currentVersion ?? '').trim();
  const prefix = input.tagPrefix ?? 'v';
  const notes = extractChangelogSection(input.changelog, version);
  const gates = evaluateReleaseGates({ ...input, currentVersion: version }, notes);

  const suggestedLevel = classifyBumpLevel(input.commitSubjects ?? []);
  // Suggested from the last *published* version where there is one — the
  // manifest may already be bumped, and suggesting a bump on top of a bump
  // silently skips a version number.
  const base = input.lastReleasedVersion ?? version;
  const suggestedVersion = bumpVersion(base, suggestedLevel);

  const failing = gates.filter(gate => gate.status !== 'pass');

  return {
    currentVersion: version,
    tag: `${prefix}${version}`,
    suggestedLevel,
    suggestedVersion,
    ...(input.lastReleasedVersion === undefined ? {} : { lastReleasedVersion: input.lastReleasedVersion }),
    ...(notes === undefined ? {} : { notes }),
    gates,
    ready: failing.length === 0,
    blockedBy: failing.map(gate => gate.label),
  };
}

/**
 * The one-line account of where a release stands, for a card kicker or a status
 * line. Names the *first* unpassed gate rather than the count, because "3 gates
 * failing" tells nobody what to do next.
 */
export function describeReleasePlan(plan: ReleasePlan): string {
  if (plan.ready) {
    return `${plan.tag} is ready to tag. Nothing has been published — tagging stays with you.`;
  }
  const first = plan.gates.find(gate => gate.status !== 'pass');
  if (!first) {
    return `${plan.tag} is not ready.`;
  }
  return `${plan.tag} is not ready: ${first.label.toLowerCase()} — ${first.detail}`;
}

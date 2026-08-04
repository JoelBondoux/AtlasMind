/**
 * LensDeclarationDraft — "Ask Atlas" for a declaration file, and the rules that
 * make a model's answer safe to write into a tracked repository file.
 *
 * The guide in `lensDeclarationPlan.ts` can tell somebody what a state-machine
 * declaration is and show them one. It cannot tell them what *their* project's
 * state machines are, and that is the part nobody wants to do by hand. So a
 * model reads the repository and proposes a first draft.
 *
 * Everything here exists because that is a genuinely dangerous thing to offer.
 * `.atlasmind/*.json` is committed, the declarations anchor into source files,
 * and one of them describes where configuration values come from — which is to
 * say, a model is being pointed at the repository and asked to write a file
 * about its settings. Four rules follow, and they are enforced here rather than
 * in the prompt, because a prompt is a request and a function is a guarantee.
 *
 * **A draft that does not normalize is refused, not repaired.** The same
 * normalizer the lens itself uses is the final gate. Repairing a rejected draft
 * would mean AtlasMind inventing the parts the model got wrong, which is the one
 * thing the starter file has always been careful not to do — and it would be
 * invention that arrives *looking* like it was derived from the repository.
 *
 * **An anchor that does not resolve is dropped, and the drop is stated.** Every
 * `source.workspacePath` is checked against the actual workspace. A model asked
 * for a file path produces a plausible one, and a plausible one is worse than
 * none: the declaration renders, the lens draws, you click through, and nothing
 * is there. The declaration survives without its anchor; the claim about where
 * it lives does not survive being unverifiable.
 *
 * **A value that looks like a secret is withheld, never masked into the file.**
 * This is the sharp edge. Drafting `lens-config.json` means a model reading
 * `.env`, `docker-compose.yml`, and CI configuration and writing what it found
 * into a git-tracked file. Masking at *render* time would still leave the
 * credential on disk and in the commit. So the value is removed from the
 * document and the source is marked `present: true` instead — which is the true
 * statement, and the one the lens actually needs.
 *
 * **Merging never overwrites what a human wrote.** On an id collision the
 * existing entry wins and the drafted one is dropped. Somebody who has hand-
 * tuned a declaration and then asks for a draft is asking for the *rest*, not
 * for their work to be replaced.
 *
 * Pure and `vscode`-free — the filesystem arrives as an `anchorExists`
 * predicate — so every rule above is unit-testable rather than assumed.
 */

import { redactSecrets } from '../utils/secretRedactor.js';
import { normalizeLensConfigFile } from './lensConfigResolution.js';
import { normalizeLensContractMappingFile } from './lensContract.js';
import { normalizeLensDataTrustPolicyFile } from './lensDataTrust.js';
import {
  emptyDeclarationDocument,
  findLensDeclarationDescriptor,
  type LensDeclarationKind,
} from './lensDeclarations.js';
import { LENS_DECLARATION_EXAMPLES } from './lensDeclarationPlan.js';
import { normalizeLensStateMachineFile } from './lensStateMachine.js';

/**
 * The most entries one draft may propose.
 *
 * Not a schema limit — the normalizers allow far more. This is a reviewability
 * limit: the whole point is that a person reads the draft before it is written,
 * and nobody reads forty proposed state machines. A first draft that covers the
 * three obvious lifecycles and says so beats one that covers everything and is
 * waved through.
 */
export const LENS_DRAFT_MAX_ENTRIES = 12;

export type LensDraftRuleId =
  /** No JSON document could be found in the model's reply. */
  | 'no-document'
  /** The document was rejected by the same normalizer the lens uses. */
  | 'refused-by-schema'
  /** The draft proposed nothing. */
  | 'empty-draft'
  /** A `source.workspacePath` did not resolve to a file in this workspace. */
  | 'anchor-dropped'
  /** A drafted value looked like a credential and was not written. */
  | 'value-withheld'
  /** A setting's key implies a secret, so its value policy was forced to masked. */
  | 'policy-forced-masked'
  /** The draft proposed more entries than one review can carry. */
  | 'entries-capped';

export interface LensDraftCorrection {
  rule: LensDraftRuleId;
  detail: string;
}

export interface LensDeclarationDraftReview {
  kind: LensDeclarationKind;
  outcome: 'accepted' | 'refused';
  /** Why the draft was refused whole. Absent when accepted. */
  refusal?: string;
  /** The normalized, scrubbed document. Absent when refused. */
  document?: Record<string, unknown>;
  /** How many entries the accepted document declares. */
  declarationCount: number;
  /** Every removal and override, so the omissions are visible rather than silent. */
  corrections: LensDraftCorrection[];
}

export interface LensDraftReviewOptions {
  /**
   * Whether a workspace-relative path exists as a readable file.
   *
   * Injected rather than imported so the anchor rule is testable. A caller that
   * cannot check should pass a predicate returning `false`, which drops every
   * anchor — the safe direction, and one the report states.
   */
  anchorExists: (workspacePath: string) => boolean;
}

/**
 * Review a model's proposed declaration.
 *
 * The order is deliberate: scrub first, normalize second. Scrubbing only ever
 * *removes* — an unverifiable anchor, a credential-shaped value — so it cannot
 * turn a bad document into a passing one. Normalizing last means the gate the
 * lens itself uses is the last thing the document passes, and nothing written
 * to disk has skipped it.
 */
export function reviewLensDeclarationDraft(
  kind: LensDeclarationKind,
  replyText: string,
  options: LensDraftReviewOptions,
): LensDeclarationDraftReview {
  const corrections: LensDraftCorrection[] = [];
  const parsed = extractJsonDocument(replyText);
  if (!parsed) {
    return refuse(kind, 'no-document', 'Atlas did not return a JSON document, so there is nothing to review.', corrections);
  }

  const scrubbed = scrubDocument(kind, parsed, options, corrections);
  const normalized = normalizeDraft(kind, scrubbed);
  if (!normalized) {
    const descriptor = findLensDeclarationDescriptor(kind);
    return refuse(
      kind,
      'refused-by-schema',
      `The draft did not pass the same check ${descriptor.workspacePath} is read with, so it is refused whole rather than partly trusted. Nothing was written.`,
      corrections,
    );
  }
  if (normalized.count === 0) {
    return refuse(kind, 'empty-draft', 'The draft declared nothing. Nothing was written.', corrections);
  }

  return {
    kind,
    outcome: 'accepted',
    document: normalized.document,
    declarationCount: normalized.count,
    corrections,
  };
}

function refuse(
  kind: LensDeclarationKind,
  rule: LensDraftRuleId,
  refusal: string,
  corrections: LensDraftCorrection[],
): LensDeclarationDraftReview {
  return {
    kind,
    outcome: 'refused',
    refusal,
    declarationCount: 0,
    corrections: [...corrections, { rule, detail: refusal }],
  };
}

/**
 * Find the JSON document in a model reply.
 *
 * Models wrap JSON in prose and fences however they feel. A fenced block is
 * preferred because it is the model saying "this is the document"; a bare object
 * is the fallback. Never throws — an unparseable reply is a refusal, not a crash.
 */
export function extractJsonDocument(replyText: string): Record<string, unknown> | undefined {
  const text = typeof replyText === 'string' ? replyText : '';
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)) {
    if (match[1]) {
      candidates.push(match[1]);
    }
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate. A fence containing prose is ordinary.
    }
  }
  return undefined;
}

/** Remove everything unverifiable or unsafe. Only ever deletes; never invents. */
function scrubDocument(
  kind: LensDeclarationKind,
  document: Record<string, unknown>,
  options: LensDraftReviewOptions,
  corrections: LensDraftCorrection[],
): Record<string, unknown> {
  const listKey = DRAFT_LIST_KEYS[kind];
  const rawList = document[listKey];
  const entries = Array.isArray(rawList) ? rawList : [];

  const capped = entries.slice(0, LENS_DRAFT_MAX_ENTRIES);
  if (entries.length > capped.length) {
    corrections.push({
      rule: 'entries-capped',
      detail: `The draft proposed ${entries.length} entries; the first ${capped.length} are shown so they can actually be reviewed. Ask again once these are in place.`,
    });
  }

  const scrubbed = capped.map(entry => scrubEntry(kind, entry, options, corrections));

  // `version` is stamped rather than taken from the model: it is the one field
  // whose correct value AtlasMind knows and the model can only get wrong.
  const result: Record<string, unknown> = { ...document, version: 1, [listKey]: scrubbed };
  if (kind === 'mappings') {
    const suppressions = Array.isArray(document.suppressions) ? document.suppressions : [];
    result.suppressions = suppressions
      .slice(0, LENS_DRAFT_MAX_ENTRIES)
      .map(entry => scrubEntry(kind, entry, options, corrections));
  }
  return result;
}

function scrubEntry(
  kind: LensDeclarationKind,
  entry: unknown,
  options: LensDraftReviewOptions,
  corrections: LensDraftCorrection[],
): unknown {
  if (!isRecord(entry)) {
    return entry;
  }
  const result: Record<string, unknown> = { ...entry };

  // Anchors can sit on the entry itself and on any nested list member.
  stripUnresolvedAnchor(result, options, corrections, describeEntry(result));

  for (const nestedKey of ['states', 'transitions', 'sources']) {
    const nested = result[nestedKey];
    if (!Array.isArray(nested)) {
      continue;
    }
    result[nestedKey] = nested.map(member => {
      if (!isRecord(member)) {
        return member;
      }
      const copy: Record<string, unknown> = { ...member };
      stripUnresolvedAnchor(copy, options, corrections, describeEntry(copy));
      return copy;
    });
  }

  if (kind === 'config') {
    applyValuePolicy(result, corrections);
  }
  return result;
}

/**
 * Drop a `source` whose `workspacePath` does not resolve.
 *
 * The whole `source` object goes, not just the path: a source with a range and
 * no path is a claim about a location in a file nobody named.
 */
function stripUnresolvedAnchor(
  entry: Record<string, unknown>,
  options: LensDraftReviewOptions,
  corrections: LensDraftCorrection[],
  label: string,
): void {
  const source = entry.source;
  if (!isRecord(source)) {
    return;
  }
  const workspacePath = typeof source.workspacePath === 'string' ? source.workspacePath : '';
  if (workspacePath && isSafeWorkspacePath(workspacePath) && options.anchorExists(workspacePath)) {
    return;
  }
  delete entry.source;
  corrections.push({
    rule: 'anchor-dropped',
    detail: workspacePath
      ? `${label}: dropped the link to \`${workspacePath}\` — no such file in this workspace. The declaration is kept; the link is not.`
      : `${label}: dropped a source link that named no file.`,
  });
}

/**
 * A workspace-relative path, and nothing else.
 *
 * Rejected before it reaches `anchorExists`, so a traversal or absolute path
 * never becomes a filesystem probe outside the workspace.
 */
function isSafeWorkspacePath(value: string): boolean {
  if (value.length > 400 || /[\0\r\n]/.test(value)) {
    return false;
  }
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return false;
  }
  return !normalized.split('/').includes('..');
}

/**
 * Enforce the value policy on a drafted setting.
 *
 * Withholding a value and masking a setting look like two protections but are
 * one operation, and the config normalizer is what makes that true: a `display`
 * source must carry a value and must not carry `present`, while a `masked`
 * source must carry `present` and must not carry a value. So deleting a
 * credential from a `display` setting does not produce a safer file — it
 * produces a file the lens refuses to read. A setting that must not show its
 * value has to *become* masked, with every one of its sources converted.
 *
 * Three things make a setting masked here, and only one of them is the model's
 * opinion: its key reads as a credential, one of its drafted values matches a
 * known credential shape, or it arrived with no policy at all. The last is
 * deny-by-default — an unstated policy is not permission to print the value.
 */
function applyValuePolicy(setting: Record<string, unknown>, corrections: LensDraftCorrection[]): void {
  const key = typeof setting.key === 'string' ? setting.key : '';
  const label = key || describeEntry(setting);
  const sources = Array.isArray(setting.sources) ? setting.sources : [];

  const secretKey = SECRET_KEY_PATTERN.test(key) || SECRET_KEY_PATTERN.test(String(setting.id ?? ''));
  const secretValue = sources.some(source =>
    isRecord(source) && source.value !== undefined && source.value !== null && looksLikeSecretValue(String(source.value)));
  const statedPolicy = setting.valuePolicy === 'display' || setting.valuePolicy === 'masked'
    ? setting.valuePolicy
    : undefined;

  const mask = secretKey || secretValue || statedPolicy === undefined;
  if (!mask) {
    return;
  }

  if (statedPolicy !== 'masked') {
    setting.valuePolicy = 'masked';
    corrections.push({
      rule: 'policy-forced-masked',
      detail: secretValue
        ? `\`${label}\`: a drafted value matched a known credential shape, so the setting was masked. Its precedence is still shown; the value is not.`
        : secretKey
          ? `\`${label}\` reads as a credential, so it was masked. Change it yourself if it is not one.`
          : `\`${label}\` arrived with no value policy, so it was masked. An unstated policy is not permission to print the value.`,
    });
  }

  if (sources.length === 0) {
    return;
  }
  setting.sources = sources.map(source => {
    if (!isRecord(source)) {
      return source;
    }
    const copy: Record<string, unknown> = { ...source };
    const hadValue = Object.hasOwn(copy, 'value') && copy.value !== undefined && copy.value !== null;
    delete copy.value;
    // `present` is derived, never invented: a source that carried a value has
    // one; otherwise the model's own `present` stands; otherwise a source that
    // `applies` must have a value to apply, and one that does not, need not.
    copy.present = hadValue ? true : typeof source.present === 'boolean' ? source.present : source.applies === true;
    if (hadValue) {
      corrections.push({
        rule: 'value-withheld',
        detail: `\`${label}\` → \`${String(source.label ?? source.id ?? 'source')}\`: the value was not written to the file, only the fact that one is set. This file is committed.`,
      });
    }
    return copy;
  });
}

/**
 * Whether a drafted value carries a credential shape.
 *
 * Delegates to the shared redactor rather than growing a second pattern list —
 * two of those drift, and the one that drifts is the one nothing is testing.
 * Length alone is deliberately not a signal: a long value is not a secret, and
 * treating it as one would strip the useful values this lens exists to show.
 */
export function looksLikeSecretValue(value: string): boolean {
  return redactSecrets(value).redactedCount > 0;
}

const SECRET_KEY_PATTERN = /(secret|password|passwd|token|api[_\-]?key|apikey|credential|private[_\-]?key|access[_\-]?key|auth|salt|signing)/i;

const DRAFT_LIST_KEYS: Record<LensDeclarationKind, string> = {
  state: 'machines',
  config: 'settings',
  mappings: 'mappings',
  trust: 'fields',
};

function normalizeDraft(
  kind: LensDeclarationKind,
  document: Record<string, unknown>,
): { document: Record<string, unknown>; count: number } | undefined {
  switch (kind) {
    case 'state': {
      const normalized = normalizeLensStateMachineFile(document);
      return normalized && { document: normalized as unknown as Record<string, unknown>, count: normalized.machines.length };
    }
    case 'config': {
      const normalized = normalizeLensConfigFile(document);
      return normalized && { document: normalized as unknown as Record<string, unknown>, count: normalized.settings.length };
    }
    case 'mappings': {
      const normalized = normalizeLensContractMappingFile(document);
      return normalized && {
        document: normalized as unknown as Record<string, unknown>,
        count: normalized.mappings.length + normalized.suppressions.length,
      };
    }
    case 'trust': {
      const normalized = normalizeLensDataTrustPolicyFile(document);
      return normalized && { document: normalized as unknown as Record<string, unknown>, count: normalized.fields.length };
    }
  }
}

export interface LensDraftMergeResult {
  document: Record<string, unknown>;
  /** Entries taken from the draft. */
  added: number;
  /** Drafted entries dropped because an existing entry already claims that id. */
  skipped: number;
  /** Entries that were already in the file and are untouched. */
  kept: number;
}

/**
 * Merge an accepted draft into whatever is already on disk.
 *
 * Existing entries win every collision. Somebody who hand-wrote three machines
 * and then asked for a draft wants the ones they have not written yet — silently
 * replacing their work with a model's version of it would be the single worst
 * thing this feature could do, and it would be invisible in a diff full of
 * additions.
 */
export function mergeLensDeclarationDraft(
  kind: LensDeclarationKind,
  existing: unknown,
  draft: Record<string, unknown>,
): LensDraftMergeResult {
  const listKey = DRAFT_LIST_KEYS[kind];
  const keys = kind === 'mappings' ? [listKey, 'suppressions'] : [listKey];
  const base = isRecord(existing) ? existing : emptyDeclarationDocument(kind);

  const document: Record<string, unknown> = { ...base, version: 1 };
  let added = 0;
  let skipped = 0;
  let kept = 0;

  for (const key of keys) {
    const existingEntries = Array.isArray(base[key]) ? (base[key] as unknown[]) : [];
    const draftEntries = Array.isArray(draft[key]) ? (draft[key] as unknown[]) : [];
    const takenIds = new Set(existingEntries.map(entryId).filter((id): id is string => id !== undefined));

    const accepted: unknown[] = [];
    for (const entry of draftEntries) {
      const id = entryId(entry);
      if (id !== undefined && takenIds.has(id)) {
        skipped += 1;
        continue;
      }
      if (id !== undefined) {
        takenIds.add(id);
      }
      accepted.push(entry);
    }
    kept += existingEntries.length;
    added += accepted.length;
    document[key] = [...existingEntries, ...accepted];
  }

  return { document, added, skipped, kept };
}

function entryId(entry: unknown): string | undefined {
  return isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined;
}

function describeEntry(entry: Record<string, unknown>): string {
  for (const key of ['id', 'key', 'label']) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return 'an entry';
}

/**
 * The prompt.
 *
 * Three things it must do, none of which it is trusted to have done — every one
 * is re-checked above. Saying them anyway costs nothing and makes the draft that
 * arrives closer to the one that survives review, which is the difference
 * between a useful feature and one that refuses four times in a row.
 *
 * The worked example is the *same* one the guide shows, imported rather than
 * retyped: a second copy would drift from the one the user just read, and they
 * would be reviewing a draft against a shape nothing else in the product uses.
 */
export function buildLensDeclarationDraftPrompt(kind: LensDeclarationKind): string {
  const descriptor = findLensDeclarationDescriptor(kind);
  const example = LENS_DECLARATION_EXAMPLES[kind];
  const lines = [
    `Read this repository and propose a first draft of \`${descriptor.workspacePath}\` for AtlasMind Lens.`,
    '',
    `What the file declares: ${descriptor.purpose}`,
    '',
    'Rules:',
    '',
    '1. Derive everything from code you actually opened. If the repository does not show you a lifecycle, a setting, or a field, leave it out. A short accurate draft is the goal; a complete-looking invented one is worse than nothing, because it will be committed and believed.',
    `2. Propose at most ${LENS_DRAFT_MAX_ENTRIES} entries. Pick the ones a new joiner would ask about first.`,
    '3. Anchor an entry with `"source": { "workspacePath": "..." }` only when you have opened that exact file and the path is relative to the repository root. Every anchor is checked against the filesystem and dropped if it does not resolve, so a guess costs you the link and gains nothing.',
    '4. Never write a credential, token, password, or connection string into the file — not even one you found. For a setting whose value is sensitive, set `"valuePolicy": "masked"` and give the source `"present": true` with no `"value"`. This file is committed to the repository.',
    '5. Reply with one JSON document in a ```json fence and nothing else after it. It is checked against the schema and refused whole if it does not pass.',
    '',
    'The shape:',
    '',
    '```json',
    example.json,
    '```',
    '',
    example.closing,
  ];
  return lines.join('\n');
}

/**
 * What the user reads before deciding.
 *
 * Corrections are listed in full rather than counted. "3 corrections" is a
 * number somebody clicks past; "dropped the link to src/orders.ts — no such
 * file" is the sentence that tells them the draft was guessing and the rest of
 * it deserves a closer look.
 */
export function renderLensDraftSummary(
  review: LensDeclarationDraftReview,
  merge?: LensDraftMergeResult,
): string {
  const descriptor = findLensDeclarationDescriptor(review.kind);
  if (review.outcome === 'refused') {
    const lines = [`Atlas could not produce a usable draft of ${descriptor.workspacePath}.`, '', review.refusal ?? ''];
    if (review.corrections.length > 1) {
      lines.push('', 'What happened along the way:', ...review.corrections.slice(0, -1).map(entry => `• ${entry.detail}`));
    }
    lines.push('', 'Nothing was written.');
    return lines.join('\n');
  }

  const lines = [
    `Atlas drafted ${review.declarationCount} ${review.declarationCount === 1 ? 'entry' : 'entries'} for ${descriptor.workspacePath}.`,
  ];
  if (merge) {
    lines.push(
      '',
      merge.kept > 0
        ? `${merge.kept} existing ${merge.kept === 1 ? 'entry stays' : 'entries stay'} untouched; ${merge.added} would be added.`
        : `${merge.added} would be added to a file that has none yet.`,
    );
    if (merge.skipped > 0) {
      lines.push(`${merge.skipped} drafted ${merge.skipped === 1 ? 'entry was' : 'entries were'} dropped because you already declare that id.`);
    }
  }
  if (review.corrections.length > 0) {
    lines.push('', 'Corrections AtlasMind made to the draft:', ...review.corrections.map(entry => `• ${entry.detail}`));
  }
  lines.push('', 'Read it before accepting. It is a proposal derived from the repository, not a verified description of it.');
  return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

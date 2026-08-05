import type { DeploymentStage, DeploymentStageKind } from '../types.js';

/**
 * The nouns a project has **declared** for its own delivery pipeline and Git
 * workflow, in one place.
 *
 * This exists because two surfaces were answering the same question from
 * different sources and disagreeing. A user asking to "promote to staging" was
 * matched against a hand-maintained keyword table in the orchestrator that
 * contained neither `promote` nor `staging`, so the request selected no tools
 * and no context — while `project_memory/operations/delivery.json` had recorded
 * the exact answer (a stage of kind `staging`, carrying `branchRef: develop`).
 * The product knew, and the part of the product that had to act did not.
 *
 * Three rules hold that gap closed:
 *
 * - **Declared only.** A term is a stage's name, its kind, or its branch ref,
 *   read from the file the project maintains. Nothing here invents a stage or
 *   guesses that a repository "probably" has one: a wrong stage name sends a
 *   promotion at the wrong branch, which is precisely the class of mistake that
 *   cannot be undone by editing a file afterwards.
 * - **Kind counts as a name.** The stage in this repository is *called*
 *   `Integration` and is *of kind* `staging`; a user who says "staging" is
 *   naming it correctly. Matching only on the display name reproduces the
 *   original bug for every project whose stage names are not the generic ones.
 * - **A match is a fact, never a verdict.** These functions report what the
 *   message named. Whether that should become a tool, a prompt block, or a
 *   refusal belongs to the caller, which is what lets the same vocabulary serve
 *   skill selection and chat context without either learning the other's rules.
 *
 * Pure and `fs`-free: it takes already-parsed config, so it is unit-testable and
 * cannot become a second reader of the delivery file.
 */

/** Longest a single declared term may be before it is ignored. */
const MAX_TERM_LENGTH = 60;

/** Stages listed in a prompt block. A pipeline longer than this is unusual. */
const MAX_DESCRIBED_STAGES = 8;

/** Characters allowed in a declared term. Anything else means a corrupt file. */
const TERM_PATTERN = /^[\w][\w .\-/]*$/;

/**
 * A stage as this module needs it. Structurally a subset of
 * {@link DeploymentStage} so a real config can be passed straight in, and so a
 * test does not have to build a whole stage to check one rule.
 */
export type ProjectVocabularyStage = Pick<DeploymentStage, 'name' | 'kind'>
  & Partial<Pick<DeploymentStage, 'rank' | 'branchRef' | 'description' | 'isProtected'>>;

export interface ProjectVocabularySource {
  stages?: readonly ProjectVocabularyStage[];
  branches?: {
    integration?: string;
    release?: string;
    protected?: readonly string[];
  };
}

/** Why a message matched a declared stage. Name beats branch beats kind. */
export type DeliveryTermKind = 'name' | 'branch' | 'kind';

export interface DeliveryIntentMatch {
  /** The stage's declared display name, as the project spells it. */
  stageName: string;
  kind: DeploymentStageKind;
  branchRef?: string;
  isProtected: boolean;
  /** The literal term in the message that identified this stage. */
  matchedTerm: string;
  /** Which declared field carried that term. */
  matchedOn: DeliveryTermKind;
}

/**
 * Verbs that mean "move this project's work along its pipeline".
 *
 * Kept separate from the declared nouns because a verb is not project-specific:
 * every team says promote, ship, release or deploy, and none of them writes that
 * down in a config file. `promote` leads the list because it is the word
 * AtlasMind's own delivery model uses and the word that was missing.
 *
 * Verb forms only — `promotion` and `deployment` are nouns, and "what does the
 * promotion policy say?" is a question about the pipeline rather than a request
 * to move something along it. `release` stays ambiguous ("release notes"), which
 * is why a caller should require a declared stage as well before treating a
 * message as a promotion.
 */
const PROMOTION_VERB_PATTERN = /\b(?:promot(?:e|es|ed|ing)|ship(?:s|ped|ping)?|releas(?:e|es|ed|ing)|deploy(?:s|ed|ing)?|publish(?:es|ed|ing)?|roll(?:ed|ing)?[ -]?out|cut\s+(?:a\s+)?release|go[ -]live)\b/i;

/** Whether the message asks to move work along the delivery pipeline. */
export function hasPromotionIntent(message: string): boolean {
  return PROMOTION_VERB_PATTERN.test(message);
}

function normalizeTerm(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  // Control characters are stripped rather than rejected: the file is
  // project-maintained, and a stray character should not cost the whole stage.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_TERM_LENGTH || !TERM_PATTERN.test(cleaned)) {
    return undefined;
  }
  return cleaned;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `term` appears in `message` as a whole word.
 *
 * A substring test would match `main` inside `domain` and `prod` inside
 * `reproduce`, and a delivery term matched by accident is worse than one missed:
 * it would route a promotion at a stage the user never named.
 */
function containsTerm(message: string, term: string): boolean {
  return new RegExp(`(?:^|[^\\w-])${escapeForRegExp(term)}(?:$|[^\\w-])`, 'i').test(message);
}

/**
 * Every declared term for this project, lower-cased and de-duplicated.
 *
 * Used by skill selection to decide whether a message is about delivery at all,
 * without that code having to know what a `DeploymentStage` is.
 */
export function collectProjectVocabulary(source: ProjectVocabularySource): string[] {
  const terms = new Set<string>();
  const add = (value: string | undefined): void => {
    const normalized = normalizeTerm(value);
    if (normalized) {
      terms.add(normalized.toLowerCase());
    }
  };

  for (const stage of source.stages ?? []) {
    add(stage.name);
    add(stage.kind);
    add(stage.branchRef);
  }
  add(source.branches?.integration);
  add(source.branches?.release);
  for (const branch of source.branches?.protected ?? []) {
    add(branch);
  }

  return [...terms].sort((left, right) => left.localeCompare(right));
}

/** Precedence when a message names a stage more than one way. */
const TERM_KIND_RANK: Record<DeliveryTermKind, number> = { name: 0, branch: 1, kind: 2 };

/**
 * The declared stage a message names, if any.
 *
 * When a message names more than one stage — "promote develop to main" — the
 * first declared match wins by precedence and then by declaration order, so the
 * answer is stable across calls. The caller that needs both ends of a promotion
 * should read the pipeline rather than asking this twice.
 */
export function matchDeliveryIntent(
  message: string,
  source: ProjectVocabularySource,
): DeliveryIntentMatch | undefined {
  const candidates: Array<DeliveryIntentMatch & { order: number }> = [];

  (source.stages ?? []).forEach((stage, order) => {
    const name = normalizeTerm(stage.name);
    if (name === undefined) {
      return;
    }
    const branchRef = normalizeTerm(stage.branchRef);
    const kind = normalizeTerm(stage.kind);
    const base = {
      stageName: name,
      kind: stage.kind,
      ...(branchRef === undefined ? {} : { branchRef }),
      isProtected: stage.isProtected === true,
      order,
    };

    if (containsTerm(message, name)) {
      candidates.push({ ...base, matchedTerm: name, matchedOn: 'name' });
    }
    if (branchRef !== undefined && containsTerm(message, branchRef)) {
      candidates.push({ ...base, matchedTerm: branchRef, matchedOn: 'branch' });
    }
    if (kind !== undefined && kind.toLowerCase() !== name.toLowerCase() && containsTerm(message, kind)) {
      candidates.push({ ...base, matchedTerm: kind, matchedOn: 'kind' });
    }
  });

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) =>
    TERM_KIND_RANK[left.matchedOn] - TERM_KIND_RANK[right.matchedOn]
    || left.order - right.order);

  const { order: _order, ...best } = candidates[0]!;
  return best;
}

/**
 * The pipeline as a short prompt block, or `undefined` when nothing is declared.
 *
 * `undefined` rather than an empty heading on purpose: a model shown
 * "Delivery pipeline:" with nothing under it learns the project has no pipeline,
 * which is a stronger and more wrong claim than saying nothing at all.
 */
export function describeDeliveryPipeline(source: ProjectVocabularySource): string | undefined {
  const stages = (source.stages ?? [])
    .map(stage => ({ stage, name: normalizeTerm(stage.name) }))
    .filter((entry): entry is { stage: ProjectVocabularyStage; name: string } => entry.name !== undefined)
    .sort((left, right) => (left.stage.rank ?? 0) - (right.stage.rank ?? 0));

  if (stages.length === 0) {
    return undefined;
  }

  const shown = stages.slice(0, MAX_DESCRIBED_STAGES);
  const lines = shown.map(({ stage, name }) => {
    const branchRef = normalizeTerm(stage.branchRef);
    const where = branchRef === undefined ? 'no branch recorded' : `branch \`${branchRef}\``;
    const protectedNote = stage.isProtected === true ? ', protected' : '';
    return `- ${name} (kind: ${stage.kind}, ${where}${protectedNote})`;
  });

  if (stages.length > shown.length) {
    lines.push(`- …and ${stages.length - shown.length} more declared stage(s).`);
  }

  const remainder = stages.length > shown.length ? ` (${shown.length} of ${stages.length} shown)` : '';
  return [
    `This project declares a delivery pipeline in \`project_memory/operations/delivery.json\`${remainder}.`,
    'Stage names and kinds are both valid ways to refer to a stage — "staging" means the stage whose kind is `staging`, whatever it is named.',
    ...lines,
  ].join('\n');
}

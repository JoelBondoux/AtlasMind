/**
 * The workflow, as data a team owns.
 *
 * Everything else in the guided workflow reads from somewhere: the curriculum
 * from observed state, the ladder from settings, the metrics from `gh`. This is
 * the one place where a team says what *their* workflow is, and it is a
 * committed file rather than a setting for one specific reason: a change to how
 * a team works should arrive as a diff with a reviewer, not as a habit nobody
 * wrote down. That is the difference between a workflow you have and a workflow
 * you can point at.
 *
 * Four rules carry semantics rather than shape, and each exists because the
 * obvious alternative has a failure mode:
 *
 * **`managed: true` stages may be disabled but never deleted.** A team that
 * decides a stage does not apply to them should say so; a team that deletes it
 * leaves no evidence the decision was made. Disabling is a record, deletion is
 * an erasure, and only one of them survives somebody asking "why don't we do
 * code review?" a year later.
 *
 * **`command: ''` is a blocker, not a default.** Inherited from
 * `deliveryManager`, and for the same reason: an empty command that silently
 * did nothing would let a stage report success having run nothing at all.
 *
 * **The file sets intent; settings set the ceiling.** `effective = min(master,
 * ceiling, capability, stage)` — a stage may request `auto` and get `observe`,
 * because a repository must not be able to force unattended action onto
 * somebody's machine. The file can only ever ask.
 *
 * **Profiles seed; they do not govern.** Once the file exists, the file wins.
 * Changing `profile` afterwards never silently rewrites stages — a team that
 * customised their workflow and then flipped a dropdown would lose their work
 * with no diff to notice it in.
 *
 * Pure and `vscode`-free; persistence uses node `fs` only, mirroring
 * `documentsManager.ts` exactly.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sanitizeVersioningPolicy,
  validateVersioningPolicy,
  type VersioningPolicy,
} from './versioningPolicy.js';
import { interpretVersionedDocument, type VersionedDocumentRead } from './schemaMigration.js';
import { WORKFLOW_STAGE_IDS, type WorkflowStageId } from './workflowCurriculum.js';
import { normalizeAutomationLevel, type AutomationLevel } from './workflowAutomation.js';
import { PROTECTED_BRANCH_NAMES } from './branchNaming.js';
import {
  sanitizeProjectComposition,
  validateProjectComposition,
  type ProjectComposition,
} from './projectComposition.js';

export const WORKFLOW_SSOT_PATH = 'project_memory/operations/workflow.json';
export const WORKFLOW_SUMMARY_SSOT_PATH = 'project_memory/operations/workflow.md';

export type WorkflowProfile = 'solo' | 'studio' | 'custom';

/** A branch-name convention. Matches `branchNaming`'s supported set. */
export type BranchConvention = 'type-issue-slug' | 'type-slug' | 'issue-slug';

export interface WorkflowStageConfig {
  id: WorkflowStageId;
  name: string;
  /** Deny by default. A stage is opt-in even once the file exists. */
  enabled: boolean;
  /** What this stage *asks* for. The ladder decides what it gets. */
  automationLevel: AutomationLevel;
  ownerAgentId?: string;
  /** Human attestations — someone ticks these. */
  requiredChecks: string[];
  /**
   * CI contexts that must be green. Deliberately distinct from
   * `requiredChecks`: one is a person saying "I looked", the other is a machine
   * saying "it passed", and a workflow that conflated them would let either
   * stand in for the other.
   */
  requiredStatusChecks: string[];
  /** Reasons this stage cannot run. A non-empty list blocks it outright. */
  blockers: string[];
  /**
   * True for stages AtlasMind ships. A managed stage may be disabled, renamed
   * and re-levelled, but never removed.
   */
  managed: boolean;
  /**
   * A user-authored command this stage runs, where it needs one.
   *
   * **`''` is the blocker, not an oversight.** A stage that needs a command
   * ships with an empty one, and that emptiness is what holds the gate shut
   * until a human supplies a real one — the `deliveryManager` precedent, for
   * the same reason: a command that silently did nothing would let a stage
   * report success having run nothing at all.
   *
   * `undefined` and `''` therefore mean different things and MUST NOT be
   * collapsed. Absent means the stage needs no command; empty means it needs
   * one and does not have it.
   */
  command?: string;
  /**
   * Per-stage testing requirements, where a stage differs from the project's
   * own testing configuration. Empty is the normal case — see `testing.inherit`.
   */
  testingOverrides?: WorkflowTestingOverride[];
}

export interface WorkflowTestingOverride {
  methodologyId: string;
  /** Whether evidence for this methodology is required at this stage. */
  requiredAtStage: boolean;
}

/**
 * The label taxonomy, by category.
 *
 * Categorised rather than a flat list because a drafter picking labels needs to
 * pick *one type* and *one priority*, not an arbitrary subset. A flat list makes
 * "drawn only from the declared taxonomy" satisfiable by any combination,
 * including three conflicting priorities.
 *
 * Every category is optional in practice — a project with no priority labels
 * declares none, and nothing then asks for one.
 */
export interface WorkflowLabelTaxonomy {
  type: string[];
  priority: string[];
  status: string[];
  area: string[];
}

export interface WorkflowConfig {
  version: 1;
  profile: WorkflowProfile;
  status: 'active' | 'specimen';
  branches: {
    integration: string;
    release: string;
    protected: string[];
  };
  naming: {
    convention: BranchConvention;
    maxLength: number;
    types: string[];
  };
  /** The taxonomy issue and pull-request labels are drawn from. */
  labels: WorkflowLabelTaxonomy;
  /**
   * Where testing requirements come from.
   *
   * `inherit: true` is the only value, and it exists to *say something*: testing
   * requirements live in `project_memory/index/testing-config.json` and are
   * deliberately not duplicated here. A second copy would drift, and the two
   * would disagree about what a stage requires with nothing to arbitrate.
   * Per-stage exceptions go in `stages[].testingOverrides`.
   */
  testing: { inherit: true };
  /**
   * How the project numbers its software across branches.
   *
   * Optional, and **absent means undeclared** rather than "use the default"
   * - `versioningPolicy` rule 3. A project that never chose a scheme must not
   * be graded against one, so nothing here is seeded: the surfaces offer
   * `recommendedVersioningPolicy`, and adopting it stays a decision somebody
   * makes, arriving as a diff on this file.
   *
   * It lives here rather than in settings for the reason the label taxonomy
   * does: a versioning scheme is a statement about how a *team* works, and a
   * per-user setting would let two people on one repository disagree about
   * what `develop` produces, with nothing to arbitrate.
   */
  versioning?: VersioningPolicy;
  /** Team-owned component boundaries. Detection may propose, but never writes this field. */
  composition?: ProjectComposition;
  stages: WorkflowStageConfig[];
  updatedAt?: string;
  /**
   * Fields written by a tool this build does not know about, preserved
   * verbatim through a round trip. Dropping them would mean a newer AtlasMind's
   * settings silently vanish the first time an older one saves.
   */
  extra?: Record<string, unknown>;
}

/** Human-readable stage names, matching the curriculum's own ordering. */
const STAGE_NAMES: Record<WorkflowStageId, string> = {
  planning: 'Planning & issue intake',
  branching: 'Branch creation & naming',
  development: 'Local development & orchestration',
  'pull-request': 'Pull requests & reviews',
  ci: 'CI/CD & failure analysis',
  release: 'Release automation',
  maintenance: 'Maintenance & tech debt',
  automation: 'Automation policy',
};

/** Which agent owns each stage today. Absent where the agent does not exist. */
const STAGE_OWNERS: Partial<Record<WorkflowStageId, string>> = {
  planning: 'github-operator',
  branching: 'github-operator',
  'pull-request': 'github-operator',
};

export const DEFAULT_BRANCH_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf'];

/**
 * The starter taxonomy, by category.
 *
 * Deliberately small. A seeded taxonomy nobody chose is a taxonomy nobody
 * applies, and a long one is worse than a short one because the unused labels
 * make the used ones harder to find. `priority` and `status` are seeded empty:
 * plenty of projects run without either, and inventing a priority scheme for
 * somebody teaches them a vocabulary they did not pick.
 */
export const DEFAULT_LABEL_TAXONOMY: WorkflowLabelTaxonomy = {
  type: ['bug', 'enhancement', 'documentation', 'refactor', 'test'],
  priority: [],
  status: [],
  area: [],
};

/** Every declared label, flattened. Order follows the category order. */
export function allDeclaredLabels(taxonomy: WorkflowLabelTaxonomy): string[] {
  return dedupe([...taxonomy.type, ...taxonomy.priority, ...taxonomy.status, ...taxonomy.area]);
}

export interface WorkflowSeedInput {
  profile: WorkflowProfile;
  /** The branch feature work merges into. */
  integrationBranch?: string;
  /** The branch a release is promoted to. */
  releaseBranch?: string;
  /** Labels observed on the repository, used in place of the generic set. */
  observedLabels?: readonly string[];
}

/**
 * Seed a starter configuration from a profile.
 *
 * Every stage ships **disabled** and at **`observe`**, whatever the profile.
 * A profile changes what a team is asked to attest — a studio requires a
 * distinct approver, a solo developer does not — never how much AtlasMind may
 * do unattended. Making the seed itself grant automation would put the
 * deny-by-default guarantee in the hands of a dropdown.
 */
export function seedWorkflowConfig(seed: WorkflowSeedInput): WorkflowConfig {
  const studio = seed.profile === 'studio';
  const integration = sanitizeBranchName(seed.integrationBranch) ?? 'develop';
  const release = sanitizeBranchName(seed.releaseBranch) ?? 'main';

  const stages: WorkflowStageConfig[] = WORKFLOW_STAGE_IDS.map(id => ({
    id,
    name: STAGE_NAMES[id],
    enabled: false,
    automationLevel: 'observe' as AutomationLevel,
    ...(STAGE_OWNERS[id] === undefined ? {} : { ownerAgentId: STAGE_OWNERS[id]! }),
    requiredChecks: defaultRequiredChecks(id, studio),
    // Deliberately empty. A required status check names a *specific* CI context,
    // and AtlasMind does not know what a project calls its workflows. Seeding a
    // guess would produce a check that either blocks forever because nothing
    // ever reports it, or is decorative because nothing enforces it — and both
    // look identical to the team that inherited it.
    requiredStatusChecks: [],
    blockers: [],
    managed: true,
  }));

  // Observed labels land in `type`, the only category whose membership can be
  // inferred without asking. Sorting a repository's labels into priority,
  // status and area would be guessing at what they mean, and a taxonomy that
  // guessed wrong is worse than one that stayed honest about not knowing.
  const observed = (seed.observedLabels ?? [])
    .map(label => sanitizeLabel(label))
    .filter((label): label is string => label !== undefined);

  return {
    version: 1,
    profile: seed.profile,
    status: 'active',
    branches: {
      integration,
      release,
      protected: protectedBranchesFor(release, integration, PROTECTED_BRANCH_NAMES),
    },
    naming: {
      convention: 'type-issue-slug',
      maxLength: 60,
      types: [...DEFAULT_BRANCH_TYPES],
    },
    labels: observed.length > 0
      ? { type: dedupe(observed).slice(0, 60), priority: [], status: [], area: [] }
      : { ...DEFAULT_LABEL_TAXONOMY, type: [...DEFAULT_LABEL_TAXONOMY.type] },
    testing: { inherit: true },
    stages,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The protected set, resolved in one place.
 *
 * Two rules, and the second is the one that is easy to get wrong.
 *
 * **The release branch is always protected.** A workflow whose own promotion
 * target could be force-pushed is not a workflow, so this is added whatever the
 * file says rather than merely validated.
 *
 * **The integration branch is never protected.** `protected` here means "a
 * branch AtlasMind must not create or target directly" — it is what stops branch
 * derivation ever producing a protected name. The integration branch is by
 * definition where work merges, so listing it produces a configuration that
 * contradicts itself: the seed would hand you a workflow whose own integration
 * branch the editor then refuses to accept. `develop` sits in
 * `PROTECTED_BRANCH_NAMES` and is the commonest integration branch there is,
 * so this is the default case rather than an edge one.
 *
 * That this is *not* the same as GitHub branch protection is deliberate. A team
 * can and often should require a pull request into `develop`; that is a setting
 * on GitHub, enforced by GitHub. This list is about what AtlasMind may target.
 */
function protectedBranchesFor(
  release: string,
  integration: string,
  candidates: Iterable<string>,
): string[] {
  return dedupe([release, ...candidates]).filter(branch => branch !== integration);
}

/**
 * The attestations each stage asks for, by profile.
 *
 * The solo and studio difference is exactly one thing — whether a second person
 * looked — and it is expressed as an attestation rather than a gate, because
 * AtlasMind cannot verify who reviewed what and pretending otherwise would make
 * the check theatre.
 */
function defaultRequiredChecks(id: WorkflowStageId, studio: boolean): string[] {
  switch (id) {
    case 'planning':
      return ['Acceptance criteria written'];
    case 'pull-request':
      return studio
        ? ['Reviewed by someone other than the author', 'Linked to an issue']
        : ['Self-reviewed the diff', 'Linked to an issue'];
    case 'release':
      return ['Changelog entry written', 'Version bumped'];
    default:
      return [];
  }
}

// ── Sanitizing ───────────────────────────────────────────────────

/** A branch name that is safe to write into a config file, or `undefined`. */
function sanitizeBranchName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  // The same character set `branchNaming` refuses, checked here too rather
  // than trusted: this value reaches a git command eventually.
  if (!trimmed || trimmed.length > 120 || /[\s~^:?*[\]\\]/.test(trimmed) || trimmed.includes('..')) {
    return undefined;
  }
  return trimmed;
}

/** A label id, constrained rather than coerced. */
function sanitizeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  return cleaned && cleaned.length <= 60 ? cleaned : undefined;
}

/** A free-text line safe to render. Never throws, never returns control chars. */
function sanitizeLine(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Element-wise list equality.
 *
 * Deliberately not `a.join(sep) === b.join(sep)`: a label or check containing
 * the separator would make two different lists compare equal, and "the edit
 * changed nothing" is exactly the wrong answer to report about a change.
 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sanitizeLines(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, cap)
    .map(entry => sanitizeLine(entry))
    .filter((entry): entry is string => entry !== undefined);
}

/**
 * Read the label taxonomy, accepting the flat shape as well as the categorised
 * one.
 *
 * The flat form (`{ declared: [...] }`) shipped for exactly one version before
 * the categories landed. Reading it into `type` costs four lines and means a
 * file written by that version keeps its labels instead of silently losing
 * them — which is the same obligation the unknown-field round trip creates,
 * pointing the other way through time.
 */
function sanitizeLabelTaxonomy(value: unknown): WorkflowLabelTaxonomy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: [], priority: [], status: [], area: [] };
  }
  const raw = value as Record<string, unknown>;
  const category = (key: string): string[] =>
    Array.isArray(raw[key])
      ? dedupe((raw[key] as unknown[])
        .slice(0, 200)
        .map(entry => sanitizeLabel(entry))
        .filter((entry): entry is string => entry !== undefined))
      : [];

  const type = category('type');
  const legacy = category('declared');

  return {
    type: dedupe([...type, ...legacy]),
    priority: category('priority'),
    status: category('status'),
    area: category('area'),
  };
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'version', 'profile', 'status', 'branches', 'naming', 'labels', 'testing', 'versioning',
  'composition', 'stages', 'updatedAt', 'extra',
]);

/**
 * Coerce arbitrary parsed JSON into a usable config, or `undefined`.
 *
 * Total by contract: this reads a file a human may have hand-edited, so every
 * branch degrades rather than throws. A malformed stage is dropped, not
 * repaired into something that looks deliberate.
 */
export function sanitizeWorkflowConfig(input: unknown): WorkflowConfig | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;

  const profile = raw['profile'];
  const normalizedProfile: WorkflowProfile =
    profile === 'studio' || profile === 'custom' ? profile : 'solo';

  const branchesRaw = (raw['branches'] ?? {}) as Record<string, unknown>;
  const integration = sanitizeBranchName(branchesRaw['integration']) ?? 'develop';
  const release = sanitizeBranchName(branchesRaw['release']) ?? 'main';
  const protectedBranches = Array.isArray(branchesRaw['protected'])
    ? branchesRaw['protected']
      .slice(0, 40)
      .map(entry => sanitizeBranchName(entry))
      .filter((entry): entry is string => entry !== undefined)
    : [];

  const namingRaw = (raw['naming'] ?? {}) as Record<string, unknown>;
  const convention = namingRaw['convention'];
  const maxLengthRaw = Number(namingRaw['maxLength']);

  const labels = sanitizeLabelTaxonomy(raw['labels']);

  // Absent stays absent. Seeding a default here is the one thing the design
  // forbids outright: a project would acquire a versioning policy nobody
  // chose, and every surface downstream would grade it against one.
  const versioning = sanitizeVersioningPolicy(raw['versioning']);

  // Builds older than composition support preserve it under `extra`. Read that
  // copy back into its declared home, but never prefer it over a direct field.
  const priorExtra = raw['extra'] && typeof raw['extra'] === 'object' && !Array.isArray(raw['extra'])
    ? raw['extra'] as Record<string, unknown>
    : undefined;
  const compositionSource = raw['composition'] ?? priorExtra?.['composition'];
  const composition = sanitizeProjectComposition(compositionSource);

  const stages = sanitizeStages(raw['stages']);

  // Unknown top-level keys survive the round trip. A newer AtlasMind's settings
  // must not silently disappear the first time an older build saves the file.
  const extra: Record<string, unknown> = {};
  const keepExtra = (key: string, value: unknown): void => {
    Object.defineProperty(extra, key, { value, enumerable: true, configurable: true, writable: true });
  };
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      keepExtra(key, value);
    }
  }
  if (priorExtra) {
    for (const [key, value] of Object.entries(priorExtra)) {
      keepExtra(key, value);
    }
  }
  if (composition) {
    delete extra['composition'];
  } else if (compositionSource !== undefined) {
    // A malformed or future nested shape remains byte-for-byte data instead of
    // becoming a partly repaired declaration or disappearing on the next save.
    keepExtra('composition', compositionSource);
  }

  return {
    version: 1,
    profile: normalizedProfile,
    status: raw['status'] === 'specimen' ? 'specimen' : 'active',
    branches: {
      integration,
      // Whatever the file says, the release branch is protected. This is the one
      // value sanitizing *adds* rather than merely validates, because a config
      // that dropped it would remove a guardrail by omission.
      release,
      protected: protectedBranchesFor(release, integration, protectedBranches),
    },
    naming: {
      convention: convention === 'type-slug' || convention === 'issue-slug' ? convention : 'type-issue-slug',
      maxLength: Number.isFinite(maxLengthRaw) ? Math.max(20, Math.min(120, Math.floor(maxLengthRaw))) : 60,
      types: Array.isArray(namingRaw['types'])
        ? dedupe(sanitizeLines(namingRaw['types'], 30)).slice(0, 30)
        : [...DEFAULT_BRANCH_TYPES],
    },
    labels,
    // The only value. It is here to *say* that testing requirements live in
    // `testing-config.json` and are deliberately not duplicated, so a reader
    // finding no testing rules in this file knows that is the design.
    testing: { inherit: true },
    ...(versioning === undefined ? {} : { versioning }),
    ...(composition === undefined ? {} : { composition }),
    stages,
    ...(typeof raw['updatedAt'] === 'string' ? { updatedAt: raw['updatedAt'] } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/**
 * Read the stage list, restoring any managed stage the file has lost.
 *
 * A managed stage missing from the file is restored **disabled**, which is the
 * safe direction: the team gets the stage back in the record without anything
 * starting to happen. Deleting one by hand is therefore not an error — it just
 * does not work, which is the point.
 */
function sanitizeStages(value: unknown): WorkflowStageConfig[] {
  const byId = new Map<WorkflowStageId, WorkflowStageConfig>();

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 60)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const raw = entry as Record<string, unknown>;
      const id = raw['id'];
      if (typeof id !== 'string' || !(WORKFLOW_STAGE_IDS as readonly string[]).includes(id)) {
        continue;
      }
      const stageId = id as WorkflowStageId;
      byId.set(stageId, {
        id: stageId,
        name: sanitizeLine(raw['name'], 80) ?? STAGE_NAMES[stageId],
        enabled: raw['enabled'] === true,
        automationLevel: normalizeAutomationLevel(raw['automationLevel']),
        ...(sanitizeLine(raw['ownerAgentId'], 80) === undefined
          ? {}
          : { ownerAgentId: sanitizeLine(raw['ownerAgentId'], 80)! }),
        requiredChecks: sanitizeLines(raw['requiredChecks'], 20),
        requiredStatusChecks: sanitizeLines(raw['requiredStatusChecks'], 20),
        blockers: sanitizeLines(raw['blockers'], 20),
        managed: true,
        // `undefined` and `''` are kept apart on purpose: absent means the
        // stage needs no command, empty means it needs one and does not have
        // it. Collapsing them would turn a deliberate blocker into an
        // oversight, or an oversight into a blocker.
        ...(typeof raw['command'] === 'string'
          ? { command: sanitizeLine(raw['command'], 400) ?? '' }
          : {}),
        ...(sanitizeTestingOverrides(raw['testingOverrides']).length > 0
          ? { testingOverrides: sanitizeTestingOverrides(raw['testingOverrides']) }
          : {}),
      });
    }
  }

  return WORKFLOW_STAGE_IDS.map(id => byId.get(id) ?? {
    id,
    name: STAGE_NAMES[id],
    enabled: false,
    automationLevel: 'observe' as AutomationLevel,
    ...(STAGE_OWNERS[id] === undefined ? {} : { ownerAgentId: STAGE_OWNERS[id]! }),
    requiredChecks: [],
    requiredStatusChecks: [],
    blockers: [],
    managed: true,
  });
}

/**
 * Per-stage testing exceptions.
 *
 * A methodology id is an identifier from the project's testing configuration,
 * so it is *constrained* rather than cleaned — an entry naming something that
 * is not an id is dropped, because coercing it would produce an override for a
 * methodology nobody has.
 */
function sanitizeTestingOverrides(value: unknown): WorkflowTestingOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: WorkflowTestingOverride[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 40)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const id = raw['methodologyId'];
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ methodologyId: id, requiredAtStage: raw['requiredAtStage'] === true });
  }
  return out;
}

function isWorkflowConfig(value: unknown): value is WorkflowConfig {
  return sanitizeWorkflowConfig(value) !== undefined;
}

// ── Editing ──────────────────────────────────────────────────────

export interface WorkflowStageEdit {
  id: string;
  enabled?: boolean;
  automationLevel?: string;
  requiredChecks?: string[];
  requiredStatusChecks?: string[];
  blockers?: string[];
  /** `''` clears it back to the blocker; omit to leave it alone. */
  command?: string;
}

export interface WorkflowConfigEdit {
  profile?: string;
  integrationBranch?: string;
  releaseBranch?: string;
  /** One category at a time, so an edit to `type` cannot wipe `area`. */
  labels?: { category: string; values: string[] };
  branchTypes?: string[];
  stages?: WorkflowStageEdit[];
}

export interface WorkflowEditResult {
  config: WorkflowConfig;
  /** Human-readable lines describing what changed, for the confirmation. */
  changes: string[];
  /** Requested edits that were refused, with the reason. */
  refused: string[];
}

/**
 * Apply an edit, and say exactly what it did.
 *
 * The `changes` list is not decoration: this file is committed, so an edit made
 * from a dashboard becomes a diff somebody else reviews. Showing the change
 * before writing it is what keeps the person clicking the button and the person
 * reading the diff looking at the same thing.
 *
 * Refusals are **reported, not silent**. An edit that quietly did nothing would
 * be indistinguishable from one that worked.
 */
export function applyWorkflowConfigEdit(
  current: WorkflowConfig,
  edit: WorkflowConfigEdit,
): WorkflowEditResult {
  const changes: string[] = [];
  const refused: string[] = [];
  const next: WorkflowConfig = {
    ...current,
    branches: { ...current.branches, protected: [...current.branches.protected] },
    naming: { ...current.naming, types: [...current.naming.types] },
    labels: {
      type: [...current.labels.type],
      priority: [...current.labels.priority],
      status: [...current.labels.status],
      area: [...current.labels.area],
    },
    stages: current.stages.map(stage => ({
      ...stage,
      requiredChecks: [...stage.requiredChecks],
      requiredStatusChecks: [...stage.requiredStatusChecks],
      blockers: [...stage.blockers],
    })),
  };

  if (edit.profile !== undefined) {
    const profile = edit.profile === 'studio' || edit.profile === 'custom' || edit.profile === 'solo'
      ? edit.profile
      : undefined;
    if (profile === undefined) {
      refused.push(`"${String(edit.profile).slice(0, 40)}" is not a profile.`);
    } else if (profile !== next.profile) {
      // Profiles seed, they do not govern: the stages are left exactly as they
      // are. A team that customised their workflow and then changed a dropdown
      // must not silently lose that work.
      changes.push(`Profile ${next.profile} → ${profile}. Existing stages are left unchanged.`);
      next.profile = profile;
    }
  }

  if (edit.integrationBranch !== undefined) {
    const branch = sanitizeBranchName(edit.integrationBranch);
    if (branch === undefined) {
      refused.push('The integration branch name contains characters git will not accept.');
    } else if (next.branches.protected.includes(branch)) {
      // Feature work merges into the integration branch constantly. Pointing it
      // at a protected branch would either break every merge or quietly erode
      // the protection, and neither is what the person meant.
      refused.push(`\`${branch}\` is a protected branch, so it cannot also be the integration branch.`);
    } else if (branch !== next.branches.integration) {
      changes.push(`Integration branch ${next.branches.integration} → ${branch}.`);
      next.branches.integration = branch;
    }
  }

  if (edit.releaseBranch !== undefined) {
    const branch = sanitizeBranchName(edit.releaseBranch);
    if (branch === undefined) {
      refused.push('The release branch name contains characters git will not accept.');
    } else if (branch !== next.branches.release) {
      changes.push(`Release branch ${next.branches.release} → ${branch}. It is protected automatically.`);
      next.branches.release = branch;
      next.branches.protected = protectedBranchesFor(branch, next.branches.integration, next.branches.protected);
    }
  }

  if (edit.labels !== undefined) {
    const category = edit.labels.category;
    if (category !== 'type' && category !== 'priority' && category !== 'status' && category !== 'area') {
      refused.push(`"${String(category).slice(0, 40)}" is not a label category.`);
    } else {
      const labels = dedupe(
        edit.labels.values
          .map(label => sanitizeLabel(label))
          .filter((label): label is string => label !== undefined),
      ).slice(0, 200);
      if (!sameList(labels, next.labels[category])) {
        changes.push(`Labels (${category}): ${next.labels[category].length} → ${labels.length}.`);
        next.labels[category] = labels;
      }
    }
  }

  if (edit.branchTypes !== undefined) {
    const types = dedupe(sanitizeLines(edit.branchTypes, 30));
    if (types.length === 0) {
      refused.push('A branch convention needs at least one type.');
    } else if (!sameList(types, next.naming.types)) {
      changes.push(`Branch types: ${next.naming.types.join(', ')} → ${types.join(', ')}.`);
      next.naming.types = types;
    }
  }

  for (const stageEdit of edit.stages ?? []) {
    const stage = next.stages.find(entry => entry.id === stageEdit.id);
    if (!stage) {
      refused.push(`No stage named "${String(stageEdit.id).slice(0, 40)}".`);
      continue;
    }
    if (stageEdit.enabled !== undefined && stageEdit.enabled !== stage.enabled) {
      changes.push(`${stage.name}: ${stageEdit.enabled ? 'enabled' : 'disabled'}.`);
      stage.enabled = stageEdit.enabled;
    }
    if (stageEdit.automationLevel !== undefined) {
      const level = normalizeAutomationLevel(stageEdit.automationLevel);
      if (level !== stage.automationLevel) {
        // Worth stating on every single change, because the number people
        // remember is the one they typed and the one that applies is the
        // minimum of four.
        changes.push(
          `${stage.name}: requests ${stage.automationLevel} → ${level}. `
          + 'Your settings still cap what actually happens.',
        );
        stage.automationLevel = level;
      }
    }
    if (stageEdit.requiredChecks !== undefined) {
      const checks = sanitizeLines(stageEdit.requiredChecks, 20);
      if (!sameList(checks, stage.requiredChecks)) {
        changes.push(`${stage.name}: ${stage.requiredChecks.length} → ${checks.length} attestations.`);
        stage.requiredChecks = checks;
      }
    }
    if (stageEdit.requiredStatusChecks !== undefined) {
      const checks = sanitizeLines(stageEdit.requiredStatusChecks, 20);
      if (!sameList(checks, stage.requiredStatusChecks)) {
        changes.push(`${stage.name}: required CI checks → ${checks.join(', ') || 'none'}.`);
        stage.requiredStatusChecks = checks;
      }
    }
    if (stageEdit.blockers !== undefined) {
      const blockers = sanitizeLines(stageEdit.blockers, 20);
      if (!sameList(blockers, stage.blockers)) {
        changes.push(`${stage.name}: ${blockers.length} blocker${blockers.length === 1 ? '' : 's'}.`);
        stage.blockers = blockers;
      }
    }
    if (stageEdit.command !== undefined) {
      const command = sanitizeLine(stageEdit.command, 400) ?? '';
      if (command !== (stage.command ?? '')) {
        // Clearing it is a real edit with a real consequence, so it is reported
        // as one rather than as "command removed" — the gate closing is the
        // point, and somebody reading the confirmation needs to see that.
        changes.push(command
          ? `${stage.name}: command set to \`${command}\`.`
          : `${stage.name}: command cleared, which blocks the stage until one is supplied.`);
        stage.command = command;
      }
    }
  }

  return { config: next, changes, refused };
}

// ── Derived state ────────────────────────────────────────────────

/**
 * Everything stopping a stage, declared and derived together.
 *
 * The declared `blockers` are reasons a team wrote down. The derived one is the
 * empty command: **`''` IS the blocker, not an oversight.** A stage that needs a
 * command and has none must not run, and expressing that as a derived blocker
 * rather than a special case at the call site means every surface that asks
 * "what is stopping this?" gets the same answer.
 *
 * `undefined` is not a blocker. A stage with no `command` key needs no command,
 * which is the normal case for all eight stages AtlasMind ships today.
 */
export function stageBlockers(stage: WorkflowStageConfig): string[] {
  return [
    ...stage.blockers,
    ...(stage.command === ''
      ? ['No command configured. The stage stays shut until somebody supplies one.']
      : []),
  ];
}

/** True when nothing is stopping the stage. Enabled is a separate question. */
export function isStageRunnable(stage: WorkflowStageConfig): boolean {
  return stageBlockers(stage).length === 0;
}

export interface WorkflowConfigProblem {
  /** The stage the problem is about, where it belongs to one. */
  stageId?: WorkflowStageId;
  detail: string;
}

/**
 * Problems with what the config *names*, as distinct from whether it can be read.
 *
 * Kept separate from `sanitizeWorkflowConfig` on purpose. Sanitizing answers "is
 * this file usable"; this answers "does everything it refers to exist", which
 * needs knowledge a pure reader does not have. An unresolvable owner is
 * **reported, never dropped** — dropping it would leave a stage silently
 * ownerless, which reads as a stage nobody was ever assigned rather than one
 * whose assignee has gone.
 */
export function validateWorkflowConfig(
  config: WorkflowConfig,
  context: {
    knownAgentIds?: readonly string[];
    knownBranches?: readonly string[];
    workspaceLocations?: readonly string[];
    unreadableLocations?: readonly string[];
  } = {},
): WorkflowConfigProblem[] {
  const problems: WorkflowConfigProblem[] = [];
  const known = context.knownAgentIds;

  for (const stage of config.stages) {
    if (known && stage.ownerAgentId && !known.includes(stage.ownerAgentId)) {
      problems.push({
        stageId: stage.id,
        detail: `Owner \`${stage.ownerAgentId}\` is not an agent in this workspace. The stage has no one assigned to it.`,
      });
    }
    if (stage.enabled && stage.command === '') {
      problems.push({
        stageId: stage.id,
        detail: 'Enabled, but its command is empty — so it is blocked. That is the intended behaviour of an empty command, not a fault.',
      });
    }
  }

  if (config.versioning) {
    // Reported here rather than dropped in the sanitizer, so a channel naming
    // a branch nobody created stays visible as exactly that. A silently
    // removed channel reads as one nobody declared.
    const versioning = validateVersioningPolicy(config.versioning, context.knownBranches ?? []);
    for (const detail of [...versioning.errors, ...versioning.warnings]) {
      problems.push({ detail });
    }
  }

  if (config.composition) {
    for (const problem of validateProjectComposition(config.composition, {
      workspaceLocations: context.workspaceLocations,
      unreadableLocations: context.unreadableLocations,
    })) {
      problems.push({ detail: problem.detail });
    }
  }

  if (allDeclaredLabels(config.labels).length === 0) {
    problems.push({
      detail: 'No labels declared. Label suggestions draw only from this taxonomy, so nothing will be suggested.',
    });
  }

  return problems;
}

// ── Markdown mirror ──────────────────────────────────────────────

const LEVEL_NOTE: Record<AutomationLevel, string> = {
  off: 'nothing',
  observe: 'reports only',
  draft: 'prepares, shows nothing to GitHub',
  propose: 'writes after a confirmation',
  auto: 'writes unattended',
};

/**
 * The versioning policy, published so the mirror states the rules that would
 * grade a version rather than a copy of them that drifts.
 *
 * An undeclared policy says so in as many words. It is the one field here
 * whose absence is a decision worth reading, and rendering nothing would make
 * it indistinguishable from a policy that happens to be empty.
 */
function versioningLines(policy: VersioningPolicy | undefined): string[] {
  if (!policy) {
    return ['- **Versioning:** not declared, so AtlasMind derives no version per branch.'];
  }
  const code = String.fromCharCode(96);
  const quoted = (value: string): string => code + value + code;
  const lines = [
    '- **Versioning:** '
      + quoted(policy.scheme)
      + ', numbered from the '
      + (policy.source === 'tag' ? 'last tag' : 'manifest') + '.',
    '- **Bump level:** '
      + (policy.commitConvention === 'conventional'
        ? 'read from conventional commits.'
        : 'chosen by a person.'),
  ];
  if (policy.channels.length === 0) {
    lines.push('- **Channels:** none declared, so no branch produces a version.');
    return lines;
  }
  lines.push('', '| Channel | Branch | Produces | Publishes to |', '|---|---|---|---|');
  for (const channel of policy.channels) {
    lines.push([
      '',
      channel.label,
      quoted(channel.branch),
      channel.prerelease === undefined
        ? 'finished versions'
        : quoted('-' + channel.prerelease + '.N') + ' pre-releases',
      quoted(channel.distTag),
      '',
    ].join(' | ').trim());
  }
  return lines;
}
/** One line per non-empty label category, so empty ones do not add noise. */
function labelLines(taxonomy: WorkflowLabelTaxonomy): string[] {
  const categories: Array<[string, string[]]> = [
    ['Type', taxonomy.type],
    ['Priority', taxonomy.priority],
    ['Status', taxonomy.status],
    ['Area', taxonomy.area],
  ];
  const lines = categories
    .filter(([, values]) => values.length > 0)
    .map(([label, values]) => `- **Labels (${label.toLowerCase()}):** ${values.join(', ')}`);
  return lines.length > 0
    ? lines
    : ['- **Labels:** _none declared_ — nothing will be suggested until some are.'];
}

function compositionLines(composition: ProjectComposition | undefined): string[] {
  if (!composition) {
    return ['- **Composition:** not declared; existing first-workspace-root behaviour applies.'];
  }
  const lines = [
    `- **Composition:** ${composition.components.length} declared component${composition.components.length === 1 ? '' : 's'}.`,
    '',
    '| Component | Role | Location | Archetype | VCS | Home |',
    '|---|---|---|---|---|---|',
  ];
  for (const component of composition.components) {
    const safeLabel = component.label
      .replace(/\\/gu, '\\\\')
      .replace(/\|/gu, '\\|')
      .replace(/\[/gu, '\\[')
      .replace(/\]/gu, '\\]')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;');
    lines.push([
      '',
      safeLabel,
      `\`${component.role}\``,
      `\`${component.location}\``,
      `\`${component.archetype.archetype}\``,
      `\`${component.vcs}\``,
      component.home ? 'yes' : 'no',
      '',
    ].join(' | ').trim());
  }
  return lines;
}

/**
 * The human-readable mirror.
 *
 * Regenerated from the JSON on every save and never hand-edited, so the two
 * cannot disagree. Deterministic — the same config produces byte-identical
 * markdown — which is what makes it reviewable in a diff.
 */
export function renderWorkflowMarkdown(config: WorkflowConfig): string {
  const lines: string[] = [
    '# Workflow',
    '',
    '> Generated from `workflow.json` by AtlasMind. Edit the JSON or the Workflow',
    '> page — this file is regenerated and hand edits are lost.',
    '',
    `- **Profile:** ${config.profile}`,
    `- **Integration branch:** \`${config.branches.integration}\``,
    `- **Release branch:** \`${config.branches.release}\``,
    `- **Protected:** ${config.branches.protected.map(branch => `\`${branch}\``).join(', ')}`,
    `- **Branch names:** \`${config.naming.convention}\`, max ${config.naming.maxLength} characters`,
    `- **Types:** ${config.naming.types.join(', ')}`,
    ...labelLines(config.labels),
    ...versioningLines(config.versioning),
    ...compositionLines(config.composition),
    '',
    'Testing requirements are **not** duplicated here — they come from',
    '`project_memory/index/testing-config.json`. A second copy would drift, and',
    'the two would disagree with nothing to arbitrate. Per-stage exceptions are',
    'in the table below.',
    '',
    '## Stages',
    '',
    'What a stage *requests*. What it gets is the lowest of four independent gates',
    '— this file, your automation ceiling, the matching capability switch, and the',
    'master switch — so a stage asking for `auto` still does nothing until every',
    'one of them agrees.',
    '',
    '| Stage | Enabled | Requests | Attestations | CI checks | Command | Blockers |',
    '|---|---|---|---|---|---|---|',
  ];

  for (const stage of config.stages) {
    lines.push([
      '',
      stage.name,
      stage.enabled ? 'yes' : 'no',
      `\`${stage.automationLevel}\` (${LEVEL_NOTE[stage.automationLevel]})`,
      stage.requiredChecks.length > 0 ? stage.requiredChecks.join('; ') : '—',
      stage.requiredStatusChecks.length > 0 ? stage.requiredStatusChecks.join('; ') : '—',
      // Absent and empty are different facts, and this table is where somebody
      // reviewing a diff finds out which one they are looking at.
      stage.command === undefined ? 'n/a' : stage.command === '' ? '**not set**' : `\`${stage.command}\``,
      stageBlockers(stage).length > 0 ? stageBlockers(stage).join('; ') : '—',
      '',
    ].join(' | ').trim());
  }

  lines.push(
    '',
    '## What this file cannot do',
    '',
    '- It cannot raise your automation ceiling. Personal settings can only lower.',
    '- It cannot remove a stage. A stage you do not use is disabled, so the',
    '  decision stays in the record rather than vanishing from it.',
    '- It cannot authorise a force-push, a tag deletion, a CI re-run, a CI',
    '  workflow edit, or a dependency merge. Those are outside the ladder at',
    '  every level.',
    '- It cannot start a stage whose command is **not set**. An empty command is',
    '  the blocker, not an oversight — it holds the gate shut until a person',
    '  supplies a real one.',
    '',
  );

  return lines.join('\n');
}

// ── Persistence (node fs; vscode-free) ───────────────────────────

export function readWorkflowConfig(workspaceRoot: string): WorkflowConfig | undefined {
  return readWorkflowFile(workspaceRoot).config;
}

/**
 * Read the config, distinguishing "no usable file" from "a file this build must
 * not touch" — the same split `documentsManager` makes, for the same reason.
 */
export function readWorkflowFile(workspaceRoot: string): VersionedDocumentRead<WorkflowConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(workspaceRoot, WORKFLOW_SSOT_PATH), 'utf8'));
  } catch {
    return { preserveExisting: false };
  }
  const read = interpretVersionedDocument('workflow', parsed, isWorkflowConfig);
  return {
    ...read,
    ...(read.config === undefined ? {} : { config: sanitizeWorkflowConfig(read.config)! }),
  };
}

/** Persist the config as JSON and regenerate the markdown mirror alongside it. */
export async function writeWorkflowConfig(workspaceRoot: string, config: WorkflowConfig): Promise<void> {
  const configPath = path.join(workspaceRoot, WORKFLOW_SSOT_PATH);
  const summaryPath = path.join(workspaceRoot, WORKFLOW_SUMMARY_SSOT_PATH);
  await mkdir(path.dirname(configPath), { recursive: true });
  const updated: WorkflowConfig = { ...config, updatedAt: new Date().toISOString() };
  await Promise.all([
    writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8'),
    writeFile(summaryPath, renderWorkflowMarkdown(updated), 'utf-8'),
  ]);
}

/**
 * Holds the config for the extension host.
 *
 * Mirrors `DocumentsManager` deliberately, including the asymmetry that matters:
 * **seeding never writes over a newer-format file**, because that file is not
 * corrupt — this build simply cannot read it — but **an explicit save does**,
 * because refusing somebody's own edit is its own kind of data loss. The
 * obligation that creates is that they must have been told first, which is what
 * `getNotice()` is for.
 */
export class WorkflowConfigManager {
  private config: WorkflowConfig | undefined;
  private preserveExisting = false;
  private notice: string | undefined;

  constructor(private readonly workspaceRoot: string | undefined) {
    this.applyRead();
  }

  private applyRead(): void {
    if (!this.workspaceRoot) {
      this.config = undefined;
      this.preserveExisting = false;
      this.notice = undefined;
      return;
    }
    const read = readWorkflowFile(this.workspaceRoot);
    this.config = read.config;
    this.preserveExisting = read.preserveExisting;
    this.notice = read.notice;
  }

  getConfig(): WorkflowConfig | undefined {
    return this.config;
  }

  hasConfig(): boolean {
    return this.config !== undefined;
  }

  getNotice(): string | undefined {
    return this.notice;
  }

  reload(): WorkflowConfig | undefined {
    this.applyRead();
    return this.config;
  }

  /**
   * Create the file if it does not exist.
   *
   * Unlike the other managers, this is **never** called on render. A workflow
   * configuration is a statement about how a team works, and writing one into
   * somebody's repository because they opened a tab would be putting words in
   * their mouth — in a file that gets committed.
   */
  async create(seed: WorkflowSeedInput): Promise<WorkflowConfig | undefined> {
    if (this.config) {
      return this.config;
    }
    if (this.preserveExisting) {
      return undefined;
    }
    const seeded = seedWorkflowConfig(seed);
    this.config = seeded;
    if (this.workspaceRoot) {
      await writeWorkflowConfig(this.workspaceRoot, seeded);
    }
    return seeded;
  }

  async save(config: WorkflowConfig): Promise<void> {
    this.config = config;
    if (this.workspaceRoot) {
      await writeWorkflowConfig(this.workspaceRoot, config);
      this.preserveExisting = false;
      this.notice = undefined;
    }
  }
}

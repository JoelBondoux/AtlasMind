/**
 * The Atlas Lenses dashboard model — what each lens reads, what question it
 * answers, whether it can answer it right now, and what to do about it.
 *
 * Lens grew one surface at a time, and every surface was reached only by
 * knowing which command to type. Nothing anywhere said what the eight lenses
 * were, which evidence each one needs, or why one of them refuses to open.
 * This module is that answer, and it is deliberately **pure**: the same inputs
 * produce the same dashboard, so what the panel draws can be tested without a
 * webview and cannot drift from what the panel claims.
 *
 * Four rules carry the semantics:
 *
 * - **Unassessed is not ready.** Every input is optional and absent means *not
 *   assessed*, never *nothing there*. A lens whose evidence was never looked at
 *   reads `unknown` and raises its own action, because a dashboard that reports
 *   readiness it never checked is worse than one that reports nothing: it earns
 *   silence by not looking. (The same rule `attentionFeed` keeps.)
 * - **Severity from a declared rule, never a feeling.** Every suggested action
 *   names the rule that raised it and the rule table is published on the page.
 *   A ranking nobody can read is a ranking nobody can argue with.
 * - **Ranked by consequence, not by count.** `RULES` declaration order *is* the
 *   ranking — a lens that cannot open at all outranks one that is merely
 *   waiting for a selection — and ties break on catalog order so the list can
 *   never shuffle between two renders of the same state.
 * - **A cap states its remainder.** Truncation that says nothing reads as
 *   "that was everything".
 *
 * Nothing here executes a command, touches the filesystem, or calls a model.
 */

import type { LensDeclarationFileStatus, LensDeclarationsSnapshot } from './lensDeclarations.js';

/** The eight lenses AtlasMind ships, in catalog order. */
export type LensId =
  | 'code-explorer'
  | 'possible-flow'
  | 'change-impact'
  | 'test-evidence'
  | 'field-wiring'
  | 'state-lifecycle'
  | 'config-resolution'
  | 'change-story';

/** Where a lens gets its facts. Presentation groups by this, and so do the flows. */
export type LensEvidenceSource =
  | 'language-service'
  | 'contract-files'
  | 'repository-declarations'
  | 'git-history';

/**
 * Whether a lens can answer its question right now.
 *
 * `unknown` is a first-class state, not a fallback: it means the evidence for
 * this lens was never assessed, which is a different fact from "assessed and
 * absent" and must not be reported as either ready or blocked.
 */
export type LensReadiness = 'ready' | 'needs-selection' | 'needs-setup' | 'unavailable' | 'unknown';

/** The declared rule that produced a readiness verdict or a suggested action. */
export type LensRuleId =
  | 'no-workspace'
  | 'declaration-invalid'
  | 'declaration-missing'
  | 'declaration-empty'
  | 'no-git-history'
  | 'no-contract-files'
  | 'needs-active-file'
  | 'needs-active-symbol'
  | 'not-assessed';

/** How loudly an action asks for a person. Presentation only; the rule decides. */
export type LensActionSeverity = 'blocking' | 'setup' | 'suggestion';

/** A colour family, named rather than valued so the core stays presentation-free. */
export type LensAccent = 'blue' | 'purple' | 'orange' | 'green' | 'yellow' | 'red' | 'teal' | 'indigo';

export interface LensRule {
  id: LensRuleId;
  /** What the rule detects, published on the dashboard beside the actions it raised. */
  description: string;
  severity: LensActionSeverity;
}

export interface LensCatalogEntry {
  id: LensId;
  name: string;
  /** The question a person actually has, in their words rather than ours. */
  question: string;
  /** One sentence a novice can read without knowing the codebase. */
  plain: string;
  /** What the lens can and cannot prove — the honesty line, always shown. */
  limit: string;
  evidence: LensEvidenceSource;
  /** Which conversation this lens belongs to; the gallery groups by it. */
  group: 'The code' | 'The contract' | 'The declared model' | 'The history';
  accent: LensAccent;
  /** A VS Code codicon id, used for the card glyph. */
  icon: string;
  /** The command this lens opens through. The webview never sends a command. */
  command: string;
  /** Whether the lens is reached from a Code Explorer selection rather than a command. */
  reachedFromSelection: boolean;
}

export interface LensCard extends LensCatalogEntry {
  /** Human label for `evidence`, so a tile can name what it reads. */
  evidenceLabel: string;
  readiness: LensReadiness;
  /** Why it is in that state, phrased for somebody who has not read the docs. */
  readinessReason: string;
  /** The rule that decided, or undefined when the lens is simply ready. */
  rule?: LensRuleId;
}

export interface LensFlowNode {
  id: string;
  column: 'evidence' | 'lens' | 'question';
  label: string;
  detail: string;
  lensId?: LensId;
  accent?: LensAccent;
  readiness?: LensReadiness;
}

export interface LensFlowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  accent: LensAccent;
  /**
   * `live` — the evidence is present; `declared` — it exists but was not
   * assessed; `absent` — assessed and not there. Drawn solid, soft, dashed.
   */
  strength: 'live' | 'declared' | 'absent';
}

export interface LensFlowMap {
  nodes: LensFlowNode[];
  edges: LensFlowEdge[];
}

export interface LensSuggestedAction {
  id: string;
  title: string;
  detail: string;
  rule: LensRuleId;
  severity: LensActionSeverity;
  /** The label of the button that resolves it. */
  actionLabel: string;
  command: string;
  /** A bounded literal argument, when the command takes one. Never user text. */
  commandArg?: string;
  lensId?: LensId;
}

export interface LensDashboardInput {
  /** Absent means no workspace is open — every lens is unavailable. */
  workspaceName?: string;
  /** The Code Explorer's current target. Absent means no file is open. */
  activeTarget?: { kind: 'file' | 'symbol'; label: string; workspacePath: string };
  /** Absent means the declaration files were never inspected. */
  declarations?: LensDeclarationsSnapshot;
  /** Absent means Git was never checked. */
  git?: { repository: boolean; branch?: string };
  /** Absent means the workspace was never scanned for contract sources. */
  contractCandidates?: number;
}

export interface LensDashboardView {
  workspaceName?: string;
  branch?: string;
  lenses: LensCard[];
  flow: LensFlowMap;
  actions: LensSuggestedAction[];
  /** How many actions the cap dropped. Stated, never silent. */
  hiddenActionCount: number;
  rules: LensRule[];
  readyCount: number;
  assessedCount: number;
  /**
   * `clear` only when everything assessed is ready **and** enough was assessed
   * to mean it. `unexamined` is the honest state of a dashboard nobody has
   * given any evidence to.
   */
  emptyState: 'clear' | 'unexamined';
  summary: string;
}

/** The most actions the band shows before it starts stating a remainder. */
export const LENS_ACTION_CAP = 6;

/**
 * How many of the four evidence sources must have been assessed before an
 * all-ready dashboard is allowed to say `clear` rather than `unexamined`.
 */
const ASSESSED_FOR_CLEAR = 3;

/**
 * The rule table, in consequence order. This order **is** the ranking of the
 * actions band; moving a row changes what a person is asked to do first.
 */
export const LENS_RULES: readonly LensRule[] = [
  {
    id: 'no-workspace',
    description: 'No workspace folder is open, so no lens has anything to read.',
    severity: 'blocking',
  },
  {
    id: 'declaration-invalid',
    description: 'A declaration file exists but could not be read as a valid declaration. Somebody wrote it and it is broken, which outranks one that was never written.',
    severity: 'blocking',
  },
  {
    id: 'declaration-missing',
    description: 'A lens that reads a repository declaration has no file to read.',
    severity: 'setup',
  },
  {
    id: 'declaration-empty',
    description: 'The declaration file is a valid starter that declares nothing yet.',
    severity: 'setup',
  },
  {
    id: 'no-git-history',
    description: 'The workspace root is not a Git repository, so committed history cannot be read.',
    severity: 'suggestion',
  },
  {
    id: 'no-contract-files',
    description: 'No schema, SQL, or type-declaration file was found to compare.',
    severity: 'suggestion',
  },
  {
    id: 'needs-active-file',
    description: 'The code lenses follow the active editor and no file is open.',
    severity: 'suggestion',
  },
  {
    id: 'needs-active-symbol',
    description: 'A file is open, but these lenses start from a symbol picked in the Code Explorer.',
    severity: 'suggestion',
  },
  {
    id: 'not-assessed',
    description: 'This evidence was never inspected. Absence of a check is not a clean result.',
    severity: 'suggestion',
  },
];

interface EvidenceDescriptor {
  id: LensEvidenceSource;
  label: string;
  detail: string;
}

const EVIDENCE_SOURCES: readonly EvidenceDescriptor[] = [
  {
    id: 'language-service',
    label: 'Language service',
    detail: 'The extension that already understands this file — the same one that powers Go to Definition.',
  },
  {
    id: 'contract-files',
    label: 'Contract files',
    detail: 'OpenAPI, JSON Schema, SQL, and TypeScript declarations found in the workspace.',
  },
  {
    id: 'repository-declarations',
    label: 'Repository declarations',
    detail: 'The .atlasmind files your project writes by hand. Nothing is guessed from code.',
  },
  {
    id: 'git-history',
    label: 'Git history',
    detail: 'Commits and paths already committed on this branch. Read-only, never a shell.',
  },
];

/**
 * The eight lenses. Catalog order breaks every ranking tie, so it is stable on
 * purpose: the code lenses first because they need no setup, then the ones a
 * project has to declare something for.
 */
export const LENS_CATALOG: readonly LensCatalogEntry[] = [
  {
    id: 'code-explorer',
    name: 'Code Explorer',
    question: 'What is actually in this file?',
    plain: 'The outline of whatever file you are looking at, straight from the language extension that already understands it.',
    limit: 'Structure only. It reports what the language service returned, not what the code does at runtime.',
    evidence: 'language-service',
    group: 'The code',
    accent: 'blue',
    icon: 'list-tree',
    command: 'atlasmind.lens.refresh',
    reachedFromSelection: false,
  },
  {
    id: 'possible-flow',
    name: 'Possible Flow',
    question: 'What can reach this, and what can it reach?',
    plain: 'Follows calls and references out from one symbol so you can see its neighbourhood before you touch it.',
    limit: 'Static evidence. A path being possible does not prove it ever runs.',
    evidence: 'language-service',
    group: 'The code',
    accent: 'purple',
    icon: 'type-hierarchy-sub',
    command: 'atlasmind.lens.moreTargetActions',
    reachedFromSelection: true,
  },
  {
    id: 'change-impact',
    name: 'Change Impact',
    question: 'What breaks if I change this?',
    plain: 'Ranks the callers, callees, and other references that would feel a change to the symbol you picked.',
    limit: 'Code only. Contracts, config, docs, and runtime paths stay unknown, and an empty map never means no impact.',
    evidence: 'language-service',
    group: 'The code',
    accent: 'orange',
    icon: 'radio-tower',
    command: 'atlasmind.lens.moreTargetActions',
    reachedFromSelection: true,
  },
  {
    id: 'test-evidence',
    name: 'Test Evidence',
    question: 'What proves this works?',
    plain: 'Finds the test-like files that already reference the symbol you picked.',
    limit: 'Discovered links, not coverage. Nothing is executed and no assertion is read, so an empty map is missing evidence rather than an untested verdict.',
    evidence: 'language-service',
    group: 'The code',
    accent: 'green',
    icon: 'beaker',
    command: 'atlasmind.lens.moreTargetActions',
    reachedFromSelection: true,
  },
  {
    id: 'field-wiring',
    name: 'Field Wiring',
    question: 'Does this field survive the trip between layers?',
    plain: 'Puts two contracts side by side — an API and a table, say — and shows which field connects to which.',
    limit: 'Declarations only. It never connects to a live database and never edits your contracts.',
    evidence: 'contract-files',
    group: 'The contract',
    accent: 'yellow',
    icon: 'type-hierarchy',
    command: 'atlasmind.lens.reviewContracts',
    reachedFromSelection: false,
  },
  {
    id: 'state-lifecycle',
    name: 'State Lifecycle',
    question: 'What states can this be in, and how does it move?',
    plain: 'Draws a state machine your repository declares, and points out states nothing can reach or leave.',
    limit: 'Declared intent, not observed execution. Events and guards are labels from the file, not runtime behaviour.',
    evidence: 'repository-declarations',
    group: 'The declared model',
    accent: 'red',
    icon: 'circuit-board',
    command: 'atlasmind.lens.reviewState',
    reachedFromSelection: false,
  },
  {
    id: 'config-resolution',
    name: 'Configuration Resolution',
    question: 'Which value actually wins?',
    plain: 'Lays out every place a setting can come from, lowest to highest, and marks the one that takes effect.',
    limit: 'Declared precedence. Live environment variables, remote flags, and secrets are never read.',
    evidence: 'repository-declarations',
    group: 'The declared model',
    accent: 'teal',
    icon: 'symbol-key',
    command: 'atlasmind.lens.reviewConfig',
    reachedFromSelection: false,
  },
  {
    id: 'change-story',
    name: 'Change Story',
    question: 'What has this branch actually changed?',
    plain: 'Groups the committed changes between your branch and its merge base by component, so a review starts from the shape of the work.',
    limit: 'Committed evidence only. Uncommitted edits are named but excluded, and pull requests, reviews, and CI are outside this lens.',
    evidence: 'git-history',
    group: 'The history',
    accent: 'indigo',
    icon: 'git-pull-request',
    command: 'atlasmind.lens.reviewChangeStory',
    reachedFromSelection: false,
  },
];

/** The question column of the flow map. Two lenses may answer the same question. */
const QUESTIONS: ReadonlyArray<{ id: string; label: string; detail: string; lensIds: readonly LensId[] }> = [
  {
    id: 'question:shape',
    label: 'What is here?',
    detail: 'Orientation before you change anything.',
    lensIds: ['code-explorer', 'possible-flow'],
  },
  {
    id: 'question:risk',
    label: 'What breaks if I change it?',
    detail: 'Blast radius, in code and across contract layers.',
    lensIds: ['change-impact', 'field-wiring'],
  },
  {
    id: 'question:proof',
    label: 'What proves it works?',
    detail: 'The evidence that exists — and, just as usefully, the evidence that does not.',
    lensIds: ['test-evidence'],
  },
  {
    id: 'question:behaviour',
    label: 'How is it meant to behave?',
    detail: 'The model the repository declares for itself.',
    lensIds: ['state-lifecycle', 'config-resolution'],
  },
  {
    id: 'question:history',
    label: 'What changed?',
    detail: 'The work already committed on this branch.',
    lensIds: ['change-story'],
  },
];

/** Build the whole dashboard from observed inputs. Pure and total. */
export function buildLensDashboard(input: LensDashboardInput): LensDashboardView {
  const lenses = LENS_CATALOG.map(entry => resolveLensCard(entry, input));
  const actions = rankActions(collectActions(lenses, input));
  const assessedCount = countAssessedEvidence(input);
  const readyCount = lenses.filter(lens => lens.readiness === 'ready').length;
  const blockedCount = lenses.filter(
    lens => lens.readiness === 'needs-setup' || lens.readiness === 'unavailable',
  ).length;
  const unknownCount = lenses.filter(lens => lens.readiness === 'unknown').length;

  return {
    ...(input.workspaceName ? { workspaceName: input.workspaceName } : {}),
    ...(input.git?.branch ? { branch: input.git.branch } : {}),
    lenses,
    flow: buildLensFlowMap(lenses),
    actions: actions.slice(0, LENS_ACTION_CAP),
    hiddenActionCount: Math.max(0, actions.length - LENS_ACTION_CAP),
    rules: [...LENS_RULES],
    readyCount,
    assessedCount,
    emptyState: blockedCount === 0 && unknownCount === 0 && assessedCount >= ASSESSED_FOR_CLEAR
      ? 'clear'
      : 'unexamined',
    summary: buildSummary(readyCount, blockedCount, unknownCount, lenses.length),
  };
}

/**
 * The flow map: evidence on the left, lenses in the middle, the question each
 * one answers on the right. This is what the dashboard draws its curves between,
 * and it is a real statement about the system rather than decoration — a person
 * who reads it learns which lens needs which evidence without opening any of them.
 */
export function buildLensFlowMap(lenses: readonly LensCard[]): LensFlowMap {
  const usedEvidence = new Set(lenses.map(lens => lens.evidence));
  const nodes: LensFlowNode[] = [
    ...EVIDENCE_SOURCES.filter(source => usedEvidence.has(source.id)).map(source => ({
      id: `evidence:${source.id}`,
      column: 'evidence' as const,
      label: source.label,
      detail: source.detail,
    })),
    ...lenses.map(lens => ({
      id: `lens:${lens.id}`,
      column: 'lens' as const,
      label: lens.name,
      detail: lens.question,
      lensId: lens.id,
      accent: lens.accent,
      readiness: lens.readiness,
    })),
    ...QUESTIONS.filter(question => question.lensIds.some(id => lenses.some(lens => lens.id === id))).map(question => ({
      id: question.id,
      column: 'question' as const,
      label: question.label,
      detail: question.detail,
    })),
  ];

  const edges: LensFlowEdge[] = [];
  for (const lens of lenses) {
    edges.push({
      id: `feeds:${lens.id}`,
      fromNodeId: `evidence:${lens.evidence}`,
      toNodeId: `lens:${lens.id}`,
      accent: lens.accent,
      strength: edgeStrength(lens.readiness),
    });
    for (const question of QUESTIONS) {
      if (question.lensIds.includes(lens.id)) {
        edges.push({
          id: `answers:${lens.id}`,
          fromNodeId: `lens:${lens.id}`,
          toNodeId: question.id,
          accent: lens.accent,
          strength: edgeStrength(lens.readiness),
        });
      }
    }
  }
  return { nodes, edges };
}

function edgeStrength(readiness: LensReadiness): LensFlowEdge['strength'] {
  if (readiness === 'ready') {
    return 'live';
  }
  return readiness === 'unknown' ? 'declared' : 'absent';
}

function evidenceLabel(source: LensEvidenceSource): string {
  return EVIDENCE_SOURCES.find(descriptor => descriptor.id === source)?.label ?? source;
}

/** A catalog entry with its evidence label resolved — the shape a card grows from. */
type LabelledEntry = LensCatalogEntry & { evidenceLabel: string };

function resolveLensCard(entry: LensCatalogEntry, input: LensDashboardInput): LensCard {
  return resolveReadiness({ ...entry, evidenceLabel: evidenceLabel(entry.evidence) }, input);
}

function resolveReadiness(entry: LabelledEntry, input: LensDashboardInput): LensCard {
  if (!input.workspaceName) {
    return {
      ...entry,
      readiness: 'unavailable',
      readinessReason: 'Open a folder first. Every lens reads something inside a workspace.',
      rule: 'no-workspace',
    };
  }

  if (entry.evidence === 'language-service') {
    return resolveCodeLens(entry, input);
  }
  if (entry.evidence === 'repository-declarations') {
    return resolveDeclarationLens(entry, input);
  }
  if (entry.evidence === 'git-history') {
    return resolveGitLens(entry, input);
  }
  return resolveContractLens(entry, input);
}

function resolveCodeLens(entry: LabelledEntry, input: LensDashboardInput): LensCard {
  if (!input.activeTarget) {
    return {
      ...entry,
      readiness: 'needs-selection',
      readinessReason: 'Open a code file. This lens follows whichever editor is active.',
      rule: 'needs-active-file',
    };
  }
  if (entry.reachedFromSelection && input.activeTarget.kind !== 'symbol') {
    return {
      ...entry,
      readiness: 'needs-selection',
      readinessReason: `Expand ${input.activeTarget.label} in the Code Explorer and pick a symbol to start from.`,
      rule: 'needs-active-symbol',
    };
  }
  return {
    ...entry,
    readiness: 'ready',
    readinessReason: `Ready for ${input.activeTarget.label}.`,
  };
}

function resolveDeclarationLens(entry: LabelledEntry, input: LensDashboardInput): LensCard {
  if (!input.declarations) {
    return {
      ...entry,
      readiness: 'unknown',
      readinessReason: 'The declaration files were not inspected, so nothing is known about this lens yet.',
      rule: 'not-assessed',
    };
  }
  const kind = entry.id === 'state-lifecycle' ? 'state' : 'config';
  const file = input.declarations.files.find(candidate => candidate.kind === kind);
  if (!file) {
    return {
      ...entry,
      readiness: 'unknown',
      readinessReason: 'No status was reported for this declaration file.',
      rule: 'not-assessed',
    };
  }
  return { ...entry, ...declarationReadiness(file.status, file.workspacePath, file.declarationCount) };
}

function declarationReadiness(
  status: LensDeclarationFileStatus,
  workspacePath: string,
  declarationCount: number,
): Pick<LensCard, 'readiness' | 'readinessReason' | 'rule'> {
  switch (status) {
    case 'ready':
      return {
        readiness: 'ready',
        readinessReason: `${declarationCount} declaration${declarationCount === 1 ? '' : 's'} in ${workspacePath}.`,
      };
    case 'empty':
      return {
        readiness: 'needs-setup',
        readinessReason: `${workspacePath} exists but declares nothing yet. Schema autocomplete will guide the first entry.`,
        rule: 'declaration-empty',
      };
    case 'missing':
      return {
        readiness: 'needs-setup',
        readinessReason: `${workspacePath} does not exist. AtlasMind can create a valid empty starter without inventing anything.`,
        rule: 'declaration-missing',
      };
    case 'invalid':
    case 'unreadable':
      return {
        readiness: 'needs-setup',
        readinessReason: `${workspacePath} could not be read as a valid declaration. It is refused whole rather than partly trusted.`,
        rule: 'declaration-invalid',
      };
    case 'unavailable':
      return {
        readiness: 'unavailable',
        readinessReason: 'No workspace is open to read the declaration from.',
        rule: 'no-workspace',
      };
  }
}

function resolveGitLens(entry: LabelledEntry, input: LensDashboardInput): LensCard {
  if (!input.git) {
    return {
      ...entry,
      readiness: 'unknown',
      readinessReason: 'Git was not checked, so it is not known whether this lens has history to read.',
      rule: 'not-assessed',
    };
  }
  if (!input.git.repository) {
    return {
      ...entry,
      readiness: 'unavailable',
      readinessReason: 'The workspace root is not a Git repository, so there is no committed history to read.',
      rule: 'no-git-history',
    };
  }
  return {
    ...entry,
    readiness: 'ready',
    readinessReason: input.git.branch
      ? `Ready to compare ${input.git.branch} against its merge base.`
      : 'Ready to compare the checked-out branch against its merge base.',
  };
}

function resolveContractLens(entry: LabelledEntry, input: LensDashboardInput): LensCard {
  if (input.contractCandidates === undefined) {
    return {
      ...entry,
      readiness: 'unknown',
      readinessReason: 'The workspace was not scanned for contract sources. Opening the lens runs the scan.',
      rule: 'not-assessed',
    };
  }
  if (input.contractCandidates < 2) {
    return {
      ...entry,
      readiness: 'needs-setup',
      readinessReason: 'Field Wiring compares two contracts and fewer than two were found. Add a schema, SQL, or type declaration.',
      rule: 'no-contract-files',
    };
  }
  return {
    ...entry,
    readiness: 'ready',
    readinessReason: `${input.contractCandidates} contract sources available to compare.`,
  };
}

function collectActions(lenses: readonly LensCard[], input: LensDashboardInput): LensSuggestedAction[] {
  if (!input.workspaceName) {
    return [{
      id: 'action:open-folder',
      title: 'Open a folder to use Atlas Lenses',
      detail: 'Every lens reads something inside a workspace: the active file, a declaration, a contract, or committed history.',
      rule: 'no-workspace',
      severity: 'blocking',
      actionLabel: 'Open folder',
      command: 'vscode.openFolder',
    }];
  }

  const actions: LensSuggestedAction[] = [];
  for (const lens of lenses) {
    const action = actionForLens(lens);
    if (action) {
      actions.push(action);
    }
  }
  return actions;
}

function actionForLens(lens: LensCard): LensSuggestedAction | undefined {
  if (!lens.rule || lens.readiness === 'ready') {
    return undefined;
  }
  const severity = LENS_RULES.find(rule => rule.id === lens.rule)?.severity ?? 'suggestion';
  const base = { id: `action:${lens.id}`, rule: lens.rule, severity, lensId: lens.id };

  switch (lens.rule) {
    case 'declaration-invalid':
      return {
        ...base,
        title: `Repair the ${lens.name} declaration`,
        detail: `${lens.readinessReason} Open it and fix it against the installed schema — autocomplete knows the shape.`,
        actionLabel: 'Open declaration',
        command: 'atlasmind.lens.setupDeclarations',
        commandArg: lens.id === 'state-lifecycle' ? 'state' : 'config',
      };
    case 'declaration-missing':
      return {
        ...base,
        title: `Create the ${lens.name} declaration`,
        detail: `${lens.readinessReason} The starter is empty by design; AtlasMind never invents your project's topology.`,
        actionLabel: 'Create starter',
        command: 'atlasmind.lens.setupDeclarations',
        commandArg: lens.id === 'state-lifecycle' ? 'state' : 'config',
      };
    case 'declaration-empty':
      return {
        ...base,
        title: `Declare your first ${lens.name.toLowerCase()} entry`,
        detail: lens.readinessReason,
        actionLabel: 'Open declaration',
        command: 'atlasmind.lens.setupDeclarations',
        commandArg: lens.id === 'state-lifecycle' ? 'state' : 'config',
      };
    case 'needs-active-file':
      return {
        ...base,
        title: 'Open a code file to use the code lenses',
        detail: 'Code Explorer, Possible Flow, Change Impact, and Test Evidence all start from whichever editor is active.',
        actionLabel: 'Go to a file',
        command: 'workbench.action.quickOpen',
      };
    case 'needs-active-symbol':
      // Named for the set rather than for this lens: the collapse below keeps
      // one of these, and a card titled after whichever lens happened to be
      // first in the catalog would misreport what it unblocks.
      return {
        ...base,
        title: 'Pick a symbol to open the symbol-level lenses',
        detail: `${lens.readinessReason} Possible Flow, Change Impact, and Test Evidence all start from one symbol rather than from the whole file.`,
        actionLabel: 'Open Code Explorer',
        command: 'atlasmind.lensView.focus',
      };
    case 'no-git-history':
      return {
        ...base,
        title: 'Change Story needs a Git repository',
        detail: lens.readinessReason,
        actionLabel: 'Learn more',
        command: 'atlasmind.lens.reviewChangeStory',
      };
    case 'no-contract-files':
      return {
        ...base,
        title: 'Field Wiring found nothing to compare',
        detail: lens.readinessReason,
        actionLabel: 'Scan again',
        command: 'atlasmind.lens.reviewContracts',
      };
    case 'not-assessed':
      return {
        ...base,
        title: `${lens.name} has not been assessed`,
        detail: `${lens.readinessReason} Nothing is claimed about it either way.`,
        actionLabel: 'Assess now',
        command: lens.command,
      };
    case 'no-workspace':
      return {
        ...base,
        title: 'Open a folder to use Atlas Lenses',
        detail: lens.readinessReason,
        actionLabel: 'Open folder',
        command: 'vscode.openFolder',
      };
  }
}

/**
 * Rank by consequence: the rule table's order, then the catalog's. Both are
 * declared, so the same state always produces the same list in the same order.
 * De-duplicated by rule for the rules that describe a whole-workspace fact —
 * "open a code file" said four times is noise, not four problems.
 */
function rankActions(actions: readonly LensSuggestedAction[]): LensSuggestedAction[] {
  const collapsed: LensSuggestedAction[] = [];
  const collapsedRules = new Set<LensRuleId>(['needs-active-file', 'no-workspace', 'needs-active-symbol']);
  const seen = new Set<LensRuleId>();
  for (const action of actions) {
    if (collapsedRules.has(action.rule)) {
      if (seen.has(action.rule)) {
        continue;
      }
      seen.add(action.rule);
      collapsed.push({ ...action, id: `action:${action.rule}` });
      continue;
    }
    collapsed.push(action);
  }

  const ruleOrder = new Map(LENS_RULES.map((rule, index) => [rule.id, index]));
  const catalogOrder = new Map(LENS_CATALOG.map((entry, index) => [entry.id, index]));
  return [...collapsed].sort((left, right) => {
    const ruleDelta = (ruleOrder.get(left.rule) ?? 99) - (ruleOrder.get(right.rule) ?? 99);
    if (ruleDelta !== 0) {
      return ruleDelta;
    }
    return (catalogOrder.get(left.lensId ?? 'code-explorer') ?? 99) -
      (catalogOrder.get(right.lensId ?? 'code-explorer') ?? 99);
  });
}

function countAssessedEvidence(input: LensDashboardInput): number {
  return [
    input.activeTarget !== undefined,
    input.declarations !== undefined,
    input.git !== undefined,
    input.contractCandidates !== undefined,
  ].filter(Boolean).length;
}

function buildSummary(ready: number, blocked: number, unknown: number, total: number): string {
  const parts = [`${ready} of ${total} lenses ready`];
  if (blocked > 0) {
    parts.push(`${blocked} needing setup`);
  }
  if (unknown > 0) {
    parts.push(`${unknown} not assessed`);
  }
  return `${parts.join(' · ')}.`;
}

/** Look up one catalog entry. Used by the panel to resolve a bounded webview id. */
export function findLensCatalogEntry(value: unknown): LensCatalogEntry | undefined {
  return typeof value === 'string'
    ? LENS_CATALOG.find(entry => entry.id === value)
    : undefined;
}

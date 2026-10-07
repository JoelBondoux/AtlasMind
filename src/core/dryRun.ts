import { fingerprint } from './workflowAuditRecord.js';
import { classifyToolInvocation, requiresToolApproval, toolBypassCeiling } from './toolPolicy.js';
import { toJsonPreview } from './toolPreview.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import type {
  DryRunRecord,
  SkillExecutionContext,
  ToolApprovalMode,
  ToolInvocationPolicy,
  ToolRiskCategory,
} from '../types.js';

/**
 * Dry-run mode: show what a turn would do, and do none of it.
 *
 * One switch (`atlasmind.dryRun.enabled`) and the tool loop stops acting. A
 * model asking to write a file, run a command, push a branch or fetch a page
 * gets back a description of what would have happened instead of the result of
 * it happening, plans on, and the operator reads the whole intended run before
 * anything touches the repository or the network.
 *
 * The rules this module holds, most important first:
 *
 * 1. **Execute is the exception, and it is named.** A call runs only when it is
 *    a *built-in* skill the table below grades `local-read` (or `args`, with
 *    arguments that classify as a read). Everything else is simulated: an MCP
 *    tool, a workspace-scanned skill, a synthesised one, a name nothing
 *    registered, a built-in somebody overrode with a custom skill of the same
 *    id, and a built-in nobody added a row for. Unknown is not clear.
 * 2. **The table is exhaustive and tested to be.** `DRY_RUN_BUILTIN_TABLE`'s
 *    keys are asserted equal to the ids the extension registers, so a new
 *    built-in skill fails the build until somebody decides what it is.
 * 3. **The skill context is the backstop, not the gate.** A skill allowed to run
 *    gets `createDryRunSkillContext`, built from `DRY_RUN_CONTEXT_METHODS` — an
 *    exhaustive record over every member of `SkillExecutionContext`. A method
 *    that can change anything (a *mixed* one, like `gitBranch`, counts as an
 *    effect) is replaced by a recorder that throws. A local-read row that
 *    reached one would be a bug in the table, and this turns that bug into a
 *    refusal rather than a write.
 * 4. **Network reads are simulated.** A GET has no side effect on this machine
 *    and still carries model-chosen text — a URL, a query — off it. That is the
 *    exfiltration channel the provenance gate exists for, so dry-run treats it
 *    like the action it can be.
 * 5. **Model calls are not actions.** The loop's own completions, and the
 *    quarantined reader's, still run and still cost money: they are how the
 *    turn decides what it would do, and they change nothing outside the
 *    conversation. Dry-run is "nothing executes", not "nothing is spent".
 * 6. **A simulated call never happened.** It is not absorbed into the turn's
 *    provenance, it raises no approval, takes no checkpoint, starts no
 *    verifier, emits no webhook and is not recorded as a side effect — the
 *    result tells the model so, and that later reads will show the state before
 *    the run.
 * 7. **Sticky for the turn.** Switching it on applies to the next tool call;
 *    switching it off waits for the next turn, so a run planned under a dry run
 *    cannot finish half-real.
 *
 * Pure apart from the ledger's listeners. Nothing here reads a setting: the
 * orchestrator passes the value it read.
 */

// ── The built-in table ───────────────────────────────────────────

/**
 * - `local-read`: always runs. Every context method it reaches is a read.
 * - `args`: runs only when `classifyToolInvocation` grades these arguments
 *   `read` or `git-read`; any other reading is simulated.
 * - `effect`: always simulated.
 */
export type DryRunBuiltinClass = 'local-read' | 'args' | 'effect';

export interface DryRunBuiltinRow {
  class: DryRunBuiltinClass;
  /** Why — published with the table so a reader can disagree with a reason, not a guess. */
  reason: string;
}

const LOCAL = (reason: string): DryRunBuiltinRow => ({ class: 'local-read', reason });
const EFFECT = (reason: string): DryRunBuiltinRow => ({ class: 'effect', reason });

/**
 * Every built-in skill, graded. Keys are asserted equal to the registered
 * built-in ids by `tests/core/dryRun.orchestrator.test.ts`.
 *
 * Deliberately conservative where a skill *could* be read-only: `git-blame`,
 * `git-branch list` and `npm-scripts` list things, but reach `runCommand`, and
 * a subprocess is exactly what a dry run promises not to start. A skill that
 * only lists is cheaper to simulate than a backstop that has to trust it.
 */
export const DRY_RUN_BUILTIN_TABLE = {
  'file-read': LOCAL('Reads one workspace file through readFile.'),
  'file-search': LOCAL('Matches a glob through findFiles.'),
  'text-search': LOCAL('Searches workspace text through searchInFiles.'),
  'directory-list': LOCAL('Lists a directory through listDirectory.'),
  'memory-query': LOCAL('Searches the in-memory SSOT index.'),
  'git-status': LOCAL('Reads git status through getGitStatus.'),
  'git-diff': LOCAL('Reads a diff through getGitDiff.'),
  'git-log': LOCAL('Reads history through getGitLog.'),
  'diff-preview': LOCAL('Reads status and diff; renders nothing to disk.'),
  diagnostics: LOCAL('Reads the editor\'s own diagnostics.'),
  'code-symbols': LOCAL('Reads symbols, references and definitions from language providers.'),
  'framework-detect': LOCAL('Reads manifests through findFiles and readFile.'),
  'log-file-tail': LOCAL('Reads log files through findFiles, readFile and searchInFiles.'),
  'terminal-read': LOCAL('Reads terminal output already on screen; runs nothing.'),
  'vscode-extensions': LOCAL('Lists installed extensions and forwarded ports.'),
  'workspace-observability': LOCAL('Reads status, diff, diagnostics, listings, test results and debug state.'),
  'specialist-guidance': LOCAL('Returns a fixed checklist; touches no context method at all.'),
  'atlasmind-settings': { class: 'args', reason: '"get" reads a setting; "set" writes the workspace settings after a modal.' },
  'atlasmind-open': EFFECT('Opens an editor panel — visible to the operator, so it is something a dry run would do, not something it should.'),
  'file-write': EFFECT('Writes a workspace file.'),
  'file-edit': EFFECT('Rewrites a workspace file.'),
  'file-delete': EFFECT('Deletes a workspace file.'),
  'file-move': EFFECT('Moves or renames a workspace file.'),
  'memory-write': EFFECT('Writes an SSOT entry, usually to disk.'),
  'memory-delete': EFFECT('Deletes an SSOT entry.'),
  'git-apply-patch': EFFECT('Applies a patch to the working tree.'),
  'git-commit': EFFECT('Creates a commit.'),
  'git-branch': EFFECT('Creates, switches or deletes branches — and lists them through a subprocess.'),
  'git-stash': EFFECT('Stashes, pops or drops changes — and lists them through a subprocess.'),
  'git-worktree': EFFECT('Removes or prunes worktrees — and lists them through a subprocess.'),
  'git-blame': EFFECT('Runs git through runCommand; a dry run starts no subprocess.'),
  'git-fetch': EFFECT('Downloads refs from a remote.'),
  'git-pull': EFFECT('Integrates remote changes into the working tree.'),
  'git-merge': EFFECT('Merges into the current branch.'),
  'git-push': EFFECT('Changes a remote repository.'),
  'rollback-checkpoint': EFFECT('Restores files from a checkpoint.'),
  'rename-symbol': EFFECT('Edits every file that references a symbol.'),
  'code-action': EFFECT('Applies a quick-fix or refactoring.'),
  'code-format': EFFECT('Runs a formatter over files.'),
  'terminal-run': EFFECT('Starts a subprocess — including "read" commands like npm test, which run repository code.'),
  'test-run': EFFECT('Runs the test suite, which executes repository code.'),
  'npm-scripts': EFFECT('Runs package scripts through runCommand.'),
  'docker-cli': EFFECT('Runs docker.'),
  'web-fetch': EFFECT('Sends a model-chosen URL off the machine.'),
  'http-request': EFFECT('Sends a model-composed request off the machine.'),
  'exa-search': EFFECT('Sends a model-written query to a search API.'),
  'simple-browser': EFFECT('Loads a URL in an editor browser.'),
  'discover-resources': EFFECT('Searches Resource Discovery registries over the network.'),
  'debug-session': EFFECT('Evaluates expressions in a live debug session, which can call functions.'),
  'debug-launch': EFFECT('Starts a debug session, which runs the program.'),
  'debug-breakpoint': EFFECT('Adds or removes breakpoints.'),
  'agent-handoff': EFFECT('Runs another agent, which runs its own tools; a dry run cannot prove the delegate inherits it.'),
} as const satisfies Readonly<Record<string, DryRunBuiltinRow>>;

export type BuiltinSkillId = keyof typeof DRY_RUN_BUILTIN_TABLE;

function builtinRow(toolName: string): DryRunBuiltinRow | undefined {
  return Object.prototype.hasOwnProperty.call(DRY_RUN_BUILTIN_TABLE, toolName)
    ? DRY_RUN_BUILTIN_TABLE[toolName as BuiltinSkillId]
    : undefined;
}

// ── The context backstop ─────────────────────────────────────────

/**
 * - `read`: passed through unchanged.
 * - `effect`: replaced by a recorder that throws `DryRunBlocked`.
 * - `derive`: returns another context, which is wrapped the same way.
 */
export type DryRunContextMethodClass = 'read' | 'effect' | 'derive';

/**
 * Every member of `SkillExecutionContext`, graded. Exhaustive by type: a member
 * added to the interface does not compile until it is decided here. A *mixed*
 * method — one that can read or write depending on its arguments — is an
 * effect, because the backstop does not parse arguments; the gate above it does.
 */
export const DRY_RUN_CONTEXT_METHODS: Readonly<Record<keyof SkillExecutionContext, DryRunContextMethodClass>> = {
  workspaceRootPath: 'read',
  withResolutionRoot: 'derive',
  queryMemory: 'read',
  upsertMemory: 'effect',
  deleteMemory: 'effect',
  readFile: 'read',
  writeFile: 'effect',
  findFiles: 'read',
  searchInFiles: 'read',
  listDirectory: 'read',
  runCommand: 'effect',
  testResourceBudget: 'read',
  getGitStatus: 'read',
  getGitDiff: 'read',
  rollbackLastCheckpoint: 'effect',
  listCheckpoints: 'read',
  rollbackCheckpointByTaskId: 'effect',
  applyGitPatch: 'effect',
  getGitLog: 'read',
  gitBranch: 'effect',
  deleteFile: 'effect',
  moveFile: 'effect',
  getDiagnostics: 'read',
  getSpecialistApiKey: 'read',
  getOutputChannelNames: 'read',
  getAtlasMindOutputLog: 'read',
  getDebugSessions: 'read',
  runAgent: 'effect',
  evaluateDebugExpression: 'effect',
  getTerminalOutput: 'read',
  getDocumentSymbols: 'read',
  findReferences: 'read',
  goToDefinition: 'read',
  renameSymbol: 'effect',
  fetchUrl: 'effect',
  httpRequest: 'effect',
  getCodeActions: 'read',
  applyCodeAction: 'effect',
  getInstalledExtensions: 'read',
  getPortForwards: 'read',
  getTestResults: 'read',
  getActiveDebugSession: 'read',
  listTerminals: 'read',
  openSimpleBrowser: 'effect',
  getDebugConfigs: 'read',
  launchDebugSession: 'effect',
  getBreakpoints: 'read',
  addBreakpoint: 'effect',
  removeBreakpoints: 'effect',
};

/** The `name` of the error a blocked context method throws. */
export const DRY_RUN_BLOCKED_ERROR_NAME = 'DryRunBlocked';

/**
 * The skill context a dry run hands to a skill it lets run.
 *
 * Built member by member from `DRY_RUN_CONTEXT_METHODS` rather than as a proxy
 * over the host's object: anything the host context carries that the table
 * does not name is simply absent, so a host that grows a method nobody graded
 * cannot leak it through. An optional method the host lacks stays absent, so a
 * skill's own "unavailable here" path still runs instead of a throw.
 */
export function createDryRunSkillContext(
  context: SkillExecutionContext,
  onBlocked: (method: keyof SkillExecutionContext) => void,
): SkillExecutionContext {
  const wrapped: Record<string, unknown> = {};
  const source = context as unknown as Record<string, unknown>;
  for (const [member, kind] of Object.entries(DRY_RUN_CONTEXT_METHODS) as Array<[keyof SkillExecutionContext, DryRunContextMethodClass]>) {
    const value = source[member];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'function') {
      // A property (`workspaceRootPath`). Copied only when the table calls it a read.
      if (kind === 'read') {
        wrapped[member] = value;
      }
      continue;
    }
    const fn = value as (...args: unknown[]) => unknown;
    if (kind === 'read') {
      wrapped[member] = (...args: unknown[]) => fn.apply(context, args);
    } else if (kind === 'derive') {
      wrapped[member] = (...args: unknown[]) =>
        createDryRunSkillContext(fn.apply(context, args) as SkillExecutionContext, onBlocked);
    } else {
      wrapped[member] = () => {
        onBlocked(member);
        const error = new Error(
          `Dry run: "${member}" can change something, so it was not called. Nothing was executed.`,
        );
        error.name = DRY_RUN_BLOCKED_ERROR_NAME;
        throw error;
      };
    }
  }
  return wrapped as unknown as SkillExecutionContext;
}

// ── The decision ─────────────────────────────────────────────────

/** The tools the tool loop answers itself rather than through a registered skill. */
export const DRY_RUN_LOOP_TOOLS = {
  /** `QUARANTINE_RELEASE_TOOL`: shows text the loop already holds. */
  quarantineRelease: 'quarantine-read',
  /** `TOOL_DISCOVERY_SKILL_ID`: searches this turn's own skill pool. */
  findTool: 'find-tool',
} as const;

export type DryRunAction = 'execute' | 'simulate';

export interface DryRunRule {
  id: string;
  action: DryRunAction;
  description: string;
}

/**
 * The rules, in the order they are evaluated; the first that matches decides.
 * Published so the documentation and the output channel quote the rule that
 * actually decided rather than a paraphrase of it.
 */
export const DRY_RUN_RULES: readonly DryRunRule[] = [
  {
    id: 'dry-run.quarantine-release',
    action: 'execute',
    description: 'Releasing quarantined text shows the agent what the loop already holds; it reaches nothing new. It still asks a person first, as it always does.',
  },
  {
    id: 'dry-run.find-tool-local',
    action: 'execute',
    description: 'find-tool searches the skills this turn may already use. The Resource Discovery search it can fall back to leaves the machine, so it is skipped.',
  },
  {
    id: 'dry-run.unknown-skill',
    action: 'simulate',
    description: 'No skill has this name. A dry run does not synthesise one to find out.',
  },
  {
    id: 'dry-run.not-builtin',
    action: 'simulate',
    description: 'MCP tools, workspace-scanned and synthesised skills — and a custom skill registered under a built-in id — run code AtlasMind did not write and cannot grade.',
  },
  {
    id: 'dry-run.not-tabled',
    action: 'simulate',
    description: 'A built-in skill with no row in the dry-run table. Unknown is not clear.',
  },
  {
    id: 'dry-run.local-read',
    action: 'execute',
    description: 'A built-in skill whose every context method is a local read.',
  },
  {
    id: 'dry-run.args-read',
    action: 'execute',
    description: 'A built-in skill whose arguments this time classify as a read.',
  },
  {
    id: 'dry-run.default',
    action: 'simulate',
    description: 'Everything else: anything that writes, runs a subprocess, or leaves the machine.',
  },
];

export interface DryRunDecisionInput {
  toolName: string;
  args: Record<string, unknown>;
  /**
   * The registered skill this name resolves to, or `undefined` when nothing is
   * registered under it. Only `builtIn` is read.
   */
  skill: { builtIn?: boolean } | undefined;
  /** The operator's approval mode, for "would have asked". Absent ⇒ the default. */
  approvalMode?: ToolApprovalMode;
  /** What the provenance gate would have decided for this call. */
  escalation?: { decision: 'free' | 'fresh-approval' | 'refuse'; rule: string };
}

export interface DryRunDecision {
  action: DryRunAction;
  /** The `DRY_RUN_RULES` id that decided. */
  rule: string;
  policy: ToolInvocationPolicy;
  /** Whether the call would have reached a person under the approval mode (bypasses aside). */
  wouldHaveAsked: boolean;
  /** Set when no bypass may waive the approval — `toolBypassCeiling`. */
  ceiling?: string;
  /** Set when the provenance gate would not have let this run freely. */
  escalation?: { decision: 'fresh-approval' | 'refuse'; rule: string };
}

const READ_CATEGORIES: ReadonlySet<ToolRiskCategory> = new Set(['read', 'git-read']);

function isMcpName(toolName: string): boolean {
  return toolName.startsWith('mcp:');
}

/** Which rule decides this call. The rule order *is* the policy. */
function decideRule(input: DryRunDecisionInput, policy: ToolInvocationPolicy): string {
  if (input.toolName === DRY_RUN_LOOP_TOOLS.quarantineRelease) {
    return 'dry-run.quarantine-release';
  }
  if (input.toolName === DRY_RUN_LOOP_TOOLS.findTool) {
    return 'dry-run.find-tool-local';
  }
  if (!input.skill) {
    return 'dry-run.unknown-skill';
  }
  if (input.skill.builtIn !== true || isMcpName(input.toolName)) {
    return 'dry-run.not-builtin';
  }
  const row = builtinRow(input.toolName);
  if (!row) {
    return 'dry-run.not-tabled';
  }
  if (row.class === 'local-read') {
    return 'dry-run.local-read';
  }
  if (row.class === 'args' && READ_CATEGORIES.has(policy.category)) {
    return 'dry-run.args-read';
  }
  return 'dry-run.default';
}

export function decideDryRun(input: DryRunDecisionInput): DryRunDecision {
  const policy = classifyToolInvocation(input.toolName, input.args);
  const rule = decideRule(input, policy);
  const action = DRY_RUN_RULES.find(entry => entry.id === rule)?.action ?? 'simulate';
  const ceiling = toolBypassCeiling(policy);
  const escalation = input.escalation && input.escalation.decision !== 'free'
    ? { decision: input.escalation.decision, rule: input.escalation.rule }
    : undefined;
  return {
    action,
    rule,
    policy,
    wouldHaveAsked: requiresToolApproval(input.approvalMode ?? 'ask-on-write', policy)
      || ceiling !== undefined
      || escalation !== undefined
      || input.toolName === DRY_RUN_LOOP_TOOLS.quarantineRelease,
    ...(ceiling ? { ceiling } : {}),
    ...(escalation ? { escalation } : {}),
  };
}

/**
 * A malformed `atlasmind.dryRun.enabled` reads as **on**. The setting exists to
 * stop effects, so the value nobody can read is taken in the direction that
 * stops them; only `false` and an absent value mean off.
 */
export function readDryRunSetting(value: unknown): boolean {
  return value !== false && value !== undefined && value !== null;
}

// ── The turn ─────────────────────────────────────────────────────

/** Declared in `types.ts`, the shared-type home, because `OrchestratorHooks` carries it. */
export type { DryRunRecord };

/**
 * One turn's dry-run state, shared by every attempt and subtask of it. A cell,
 * like the provenance one, because the loop latches it and the caller reads the
 * records back to summarise them.
 */
export interface DryRunTurn {
  /** Latched: once true for a turn, never false again for it. */
  active: boolean;
  records: DryRunRecord[];
  /** Local reads that ran while the turn was dry. */
  executedReads: number;
  /** Records past the turn's cap — counted, so the summary can say the list is not everything. */
  omittedRecords: number;
}

export function createDryRunTurn(activeAtStart: boolean): DryRunTurn {
  return { active: activeAtStart, records: [], executedReads: 0, omittedRecords: 0 };
}

export function isDryRunTurn(value: unknown): value is DryRunTurn {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DryRunTurn>;
  return typeof candidate.active === 'boolean'
    && Array.isArray(candidate.records)
    && typeof candidate.executedReads === 'number'
    && typeof candidate.omittedRecords === 'number';
}

/**
 * `dry-run.sticky-for-turn`: on applies at once, off waits for the next turn.
 * Returns whether this call runs dry, latching the turn if it does.
 */
export function latchDryRun(turn: DryRunTurn, liveSetting: boolean): boolean {
  if (!turn.active && liveSetting) {
    turn.active = true;
  }
  return turn.active;
}

const MAX_TURN_RECORDS = 200;
const ARGS_PREVIEW_CHARS = 400;

export function previewDryRunArgs(args: Record<string, unknown>): string {
  const preview = toJsonPreview(args, ARGS_PREVIEW_CHARS) ?? '{}';
  return redactSecrets(preview).text;
}

export function buildDryRunRecord(input: {
  at: string;
  taskId: string;
  toolName: string;
  args: Record<string, unknown>;
  rule: string;
  policy: ToolInvocationPolicy;
  wouldHaveAsked: boolean;
}): DryRunRecord {
  return {
    at: input.at,
    taskId: input.taskId,
    toolName: input.toolName.slice(0, 200),
    category: input.policy.category,
    risk: input.policy.risk,
    rule: input.rule,
    summary: input.policy.summary.slice(0, 300),
    wouldHaveAsked: input.wouldHaveAsked,
    argsFingerprint: fingerprint(input.args),
    argsPreview: previewDryRunArgs(input.args),
  };
}

/** Adds a record to the turn, bounded; the summary states what the bound dropped. */
export function recordDryRun(turn: DryRunTurn, record: DryRunRecord): void {
  if (turn.records.length < MAX_TURN_RECORDS) {
    turn.records.push(record);
  } else {
    turn.omittedRecords += 1;
  }
}

/** What the model is told in place of a result. */
export function describeSimulatedResult(toolName: string, decision: DryRunDecision, argsPreview: string): string {
  const approval = decision.escalation
    ? decision.escalation.decision === 'refuse'
      ? `no — it would have been refused, because this task has read untrusted content (${decision.escalation.rule})`
      : `yes, a fresh approval, because this task has read untrusted content (${decision.escalation.rule})`
    : decision.wouldHaveAsked
      ? `yes${decision.ceiling ? ' — and no bypass could have waived it' : ''}`
      : 'no';
  return [
    '[DRY RUN — nothing was executed]',
    `Would have: ${decision.policy.summary}.`,
    `Tool: ${toolName} · category ${decision.policy.category} · risk ${decision.policy.risk} · rule ${decision.rule}.`,
    `Would have asked for approval: ${approval}.`,
    `Arguments (redacted): ${argsPreview}`,
    'Plan as if this succeeded, but do not claim that it happened: the operator turned dry run on to see '
      + 'what you would do. Later reads show the state from before this run.',
  ].join('\n');
}

const SUMMARY_LIST_LIMIT = 20;

/** The end-of-turn summary appended to the reply. `undefined` when the turn was not dry. */
export function summarizeDryRun(turn: DryRunTurn): string | undefined {
  if (!turn.active) {
    return undefined;
  }
  const simulated = turn.records.filter(record => record.rule !== 'dry-run.backstop');
  const blocked = turn.records.filter(record => record.rule === 'dry-run.backstop');
  const lines: string[] = [
    '---',
    '',
    `**Dry run — nothing was executed.** ${simulated.length + turn.omittedRecords} action${simulated.length + turn.omittedRecords === 1 ? '' : 's'} simulated`
      + `, ${turn.executedReads} local read${turn.executedReads === 1 ? '' : 's'} run.`,
  ];
  if (simulated.length + turn.omittedRecords === 0) {
    lines.push('', 'The model asked for nothing that would have acted. Model calls still ran and still cost what they cost.');
  } else {
    lines.push('', 'What would have happened, in order:');
    for (const record of simulated.slice(0, SUMMARY_LIST_LIMIT)) {
      lines.push(`- \`${record.toolName}\` — ${record.summary} (${record.category}, ${record.risk}${record.wouldHaveAsked ? ', would have asked' : ''})`);
    }
    const unlisted = simulated.length - Math.min(simulated.length, SUMMARY_LIST_LIMIT) + turn.omittedRecords;
    if (unlisted > 0) {
      lines.push(`- …and ${unlisted} more, listed in the AtlasMind Dry Run output.`);
    }
  }
  if (blocked.length > 0) {
    lines.push('', `${blocked.length} call${blocked.length === 1 ? '' : 's'} to a context method that can change something `
      + 'reached the dry-run backstop and were refused. That is a gap in the dry-run table; please report it.');
  }
  lines.push('', 'Turn dry run off (AtlasMind: Toggle Dry Run) and ask again to do it for real.');
  return lines.join('\n');
}

/** One line in the "AtlasMind Dry Run" output channel. */
export function formatDryRunLedgerLine(record: DryRunRecord): string {
  return `[${record.at}] ${record.taskId} ${record.toolName} — ${record.summary} `
    + `(${record.category}/${record.risk}, ${record.rule}${record.wouldHaveAsked ? ', would have asked' : ''}) `
    + `args#${record.argsFingerprint} ${record.argsPreview}`;
}

// ── The ledger ───────────────────────────────────────────────────

export const DRY_RUN_LEDGER_CAPACITY = 500;

/**
 * The session's dry-run records, newest last. Memory only: what a dry run
 * *would* have done is a fact about this session, and the arguments behind it
 * are model-written text that has no business in a committed file. Holds a
 * fingerprint and a redacted preview, never the arguments themselves.
 */
export class DryRunLedger {
  private readonly entries: DryRunRecord[] = [];
  private readonly listeners = new Set<(record: DryRunRecord) => void>();
  private droppedCount = 0;

  constructor(private readonly capacity: number = DRY_RUN_LEDGER_CAPACITY) {}

  record(entry: DryRunRecord): void {
    this.entries.push(entry);
    while (this.entries.length > this.capacity) {
      this.entries.shift();
      this.droppedCount += 1;
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // A listener that fails must not turn a simulated call into a failed one.
      }
    }
  }

  list(): readonly DryRunRecord[] {
    return [...this.entries];
  }

  /** How many records the ring has let go of, so a reader knows the list is not everything. */
  dropped(): number {
    return this.droppedCount;
  }

  onRecord(listener: (record: DryRunRecord) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}

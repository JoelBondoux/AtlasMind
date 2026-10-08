import { fingerprint } from './workflowAuditRecord.js';
import { classifyToolInvocation, requiresToolApproval, toolBypassCeiling } from './toolPolicy.js';
import { toJsonPreview } from './toolPreview.js';
import { redactSecrets } from '../utils/secretRedactor.js';
import { parseGhInvocation } from '../skills/terminalRun.js';
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

// ── Outside the tool loop ────────────────────────────────────────

/**
 * What an action outside the tool loop would have done, by kind.
 *
 * The tool loop is not the only place AtlasMind acts. A routine runs shell
 * commands, a promotion deploys, the dashboard deletes branches and files
 * issues, the Director sends mail through a connector, a timer rewrites a memory
 * file. One switch has to mean "nothing executes" for all of them, or it means
 * "nothing the model asked for executes", which is a smaller promise than the
 * status bar makes. Each kind names the rule a host interception cites, so the
 * output channel and the documentation quote the same thing.
 *
 * What a dry run does **not** stop, and why, is the other half of the rule and
 * is published with it (`DRY_RUN_HOST_EXEMPTIONS`): a read changes nothing; a
 * model completion is how a dry turn decides what it would do; and an operator
 * pressing a button whose purpose is to save a file is a person editing their
 * own project, which a preview switch has no business refusing.
 */
export type DryRunHostEffectKind =
  | 'process'
  | 'git'
  | 'github'
  | 'network'
  | 'message'
  | 'terminal'
  | 'auto-write';

export interface DryRunHostEffectRow {
  rule: string;
  category: ToolRiskCategory;
  risk: ToolInvocationPolicy['risk'];
  description: string;
}

export const DRY_RUN_HOST_EFFECTS: Readonly<Record<DryRunHostEffectKind, DryRunHostEffectRow>> = {
  process: {
    rule: 'dry-run.host-process',
    category: 'terminal-write',
    risk: 'high',
    description: 'Starts a process: a routine step, a promotion or rollback command, a deploy, an installer, a container.',
  },
  git: {
    rule: 'dry-run.host-git',
    category: 'git-write',
    risk: 'high',
    description: 'Runs a git command that changes the repository, its refs or a remote. Reading git is not an action.',
  },
  github: {
    rule: 'dry-run.host-github',
    category: 'network',
    risk: 'high',
    description: 'Runs a gh command that changes something on GitHub: an issue, a label, a pull request, a run, a status. Reading GitHub is not an action.',
  },
  network: {
    rule: 'dry-run.host-network',
    category: 'network',
    risk: 'high',
    description: 'Sends a request off the machine: a webhook, a health check, a live-service probe, an MCP tool call, a Resource Discovery search.',
  },
  message: {
    rule: 'dry-run.host-message',
    category: 'network',
    risk: 'high',
    description: 'Sends a message to a person: a Director email or invite through a connector, a Buzz post or DM.',
  },
  terminal: {
    rule: 'dry-run.host-terminal',
    category: 'terminal-write',
    risk: 'high',
    description: 'Types into a terminal or runs a command in one, including a command left for a person to submit.',
  },
  'auto-write': {
    rule: 'dry-run.host-auto-write',
    category: 'workspace-write',
    risk: 'medium',
    description: 'A write AtlasMind makes on its own (on a timer, when a page loads, or as a side effect after a turn) rather than the thing somebody pressed a button to save.',
  },
};

/** What a dry run deliberately leaves running outside the tool loop, with the reason. */
export const DRY_RUN_HOST_EXEMPTIONS: ReadonlyArray<{ id: string; description: string }> = [
  {
    id: 'dry-run.exempt-read',
    description: 'Reads: git and gh commands classifyHostCommand grades as reads, version probes, local file reads. They change nothing, and a dashboard that went blank in a dry run would preview nothing.',
  },
  {
    id: 'dry-run.exempt-model-call',
    description: 'Model completions, as in the tool loop. They are how a dry run decides what it would do; they still cost money.',
  },
  {
    id: 'dry-run.exempt-operator-save',
    description: 'An operator pressing a button whose purpose is to save something to a file: a panel form, a register entry, a template, a report, a scan result, a starter workflow. That is the person acting rather than AtlasMind, and the file is what they asked for.',
  },
  {
    id: 'dry-run.exempt-own-bookkeeping',
    description: 'AtlasMind keeping its own records: session state, run history, cost records, caches. A dry run that could not be recorded could not be reviewed.',
  },
];

/** A command a host is about to run, graded before it runs. */
export type HostCommandGrade =
  | { kind: 'read'; reason: string }
  | { kind: 'effect'; effect: DryRunHostEffectKind; reason: string };

/** Subcommands that only ever read. Anything not here is an effect. */
const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'rev-list', 'merge-base', 'for-each-ref', 'describe',
  'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'blame', 'shortlog', 'name-rev', 'grep', 'var',
  'version', 'count-objects', 'show-ref', 'cherry', 'check-ref-format', 'check-ignore', 'check-attr',
  'whatchanged', 'help',
]);

/** Subcommands that read only in some shapes; `gitReadShape` decides. */
const GIT_SHAPE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'branch', 'tag', 'remote', 'config', 'stash', 'worktree', 'symbolic-ref',
]);

const GIT_GLOBAL_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  '-c', '-C', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env',
]);

/** `git branch` flags that list rather than change. */
const GIT_BRANCH_LIST_FLAGS = [
  '--list', '-l', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '--show-current',
  '--format', '--sort', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at',
  '--column', '--no-column', '--color', '--no-color', '--abbrev', '--no-abbrev', '-i', '--ignore-case',
];

const GIT_CONFIG_READ_FLAGS = ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'];
const GIT_CONFIG_WRITE_FLAGS = ['--unset', '--unset-all', '--add', '--replace-all', '--edit', '-e', '--rename-section', '--remove-section'];

function flagMatches(arg: string, flags: readonly string[]): boolean {
  return flags.some(flag => arg === flag || arg.startsWith(`${flag}=`));
}

/** Read shapes of the subcommands that can also write. An unknown shape is an effect. */
function gitReadShape(subcommand: string, rest: readonly string[]): boolean {
  const positional = rest.filter(arg => !arg.startsWith('-'));
  const flags = rest.filter(arg => arg.startsWith('-'));
  switch (subcommand) {
    case 'branch':
      // `git branch --list 'feat/*'` reads; `git branch feat/x` creates. A
      // positional is a pattern only after --list.
      if (flags.some(arg => arg === '--list' || arg === '-l')) {
        return flags.every(arg => flagMatches(arg, GIT_BRANCH_LIST_FLAGS));
      }
      return positional.length === 0 && flags.every(arg => flagMatches(arg, GIT_BRANCH_LIST_FLAGS));
    case 'tag':
      return rest.length === 0 || flags.some(arg => arg === '--list' || arg === '-l');
    case 'remote':
      return positional.length === 0 || positional[0] === 'get-url' || positional[0] === 'show';
    case 'config':
      if (flags.some(arg => flagMatches(arg, GIT_CONFIG_WRITE_FLAGS))) {
        return false;
      }
      return flags.some(arg => flagMatches(arg, GIT_CONFIG_READ_FLAGS)) || positional.length === 1;
    case 'stash':
      return positional[0] === 'list' || positional[0] === 'show';
    case 'worktree':
      return positional[0] === 'list';
    case 'symbolic-ref':
      return positional.length === 1 && !flags.some(arg => arg === '-d' || arg === '--delete');
    default:
      return false;
  }
}

function classifyGitCommand(args: readonly string[]): HostCommandGrade {
  let index = 0;
  while (index < args.length) {
    const value = args[index]!.trim();
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(value)) {
      index += 2;
      continue;
    }
    if (value.startsWith('-')) {
      index += 1;
      continue;
    }
    break;
  }
  const subcommand = (args[index] ?? '').trim().toLowerCase();
  const rest = args.slice(index + 1).map(arg => arg.trim());
  if (!subcommand) {
    return { kind: 'effect', effect: 'git', reason: 'git with no subcommand a dry run can read' };
  }
  // `--output` writes a file wherever it points, whatever the subcommand is.
  if (rest.some(arg => arg === '--output' || arg.startsWith('--output='))) {
    return { kind: 'effect', effect: 'git', reason: `git ${subcommand} --output writes a file` };
  }
  if (GIT_READ_SUBCOMMANDS.has(subcommand)) {
    return { kind: 'read', reason: `git ${subcommand} reads` };
  }
  if (GIT_SHAPE_SUBCOMMANDS.has(subcommand) && gitReadShape(subcommand, rest)) {
    return { kind: 'read', reason: `git ${subcommand} in a listing shape reads` };
  }
  return { kind: 'effect', effect: 'git', reason: `git ${subcommand} can change the repository` };
}

/** gh verbs that read. `download` is absent: it writes files. */
const GH_HOST_READ_VERBS: ReadonlySet<string> = new Set(['list', 'view', 'status', 'diff', 'checks']);

const GH_API_FIELD_FLAGS = ['-f', '-F', '--field', '--raw-field', '--input'];

/**
 * `gh api` is a GET unless it is told otherwise: the CLI documents GET as the
 * default and POST as the default the moment a field or an input is added. So a
 * call is a read only when it names no method other than GET or HEAD and
 * carries nothing that would turn it into a POST. `graphql` is always an effect,
 * because a mutation and a query have the same argv shape.
 */
function ghApiIsRead(args: readonly string[]): boolean {
  const trimmed = args.map(arg => arg.trim());
  if (trimmed.some(arg => arg.toLowerCase() === 'graphql')) {
    return false;
  }
  for (let index = 0; index < trimmed.length; index += 1) {
    const arg = trimmed[index]!;
    if (flagMatches(arg, GH_API_FIELD_FLAGS) || /^-[fF]\S/.test(arg)) {
      return false;
    }
    let method: string | undefined;
    if (arg === '-X' || arg === '--method') {
      method = trimmed[index + 1] ?? '';
      index += 1;
    } else if (arg.startsWith('--method=')) {
      method = arg.slice('--method='.length);
    } else if (/^-X\S/.test(arg)) {
      method = arg.slice(2);
    }
    if (method !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      return false;
    }
  }
  return true;
}

function classifyGhCommand(args: readonly string[]): HostCommandGrade {
  const { namespace, verb } = parseGhInvocation(args);
  if (namespace === 'api') {
    return ghApiIsRead(args)
      ? { kind: 'read', reason: 'gh api GET reads' }
      : { kind: 'effect', effect: 'github', reason: 'gh api with a method, a field or an input can change something' };
  }
  if (namespace === 'auth' && verb === 'status') {
    return { kind: 'read', reason: 'gh auth status reads' };
  }
  if (namespace === 'status' && !verb) {
    return { kind: 'read', reason: 'gh status reads' };
  }
  if (namespace === 'search') {
    return { kind: 'read', reason: 'gh search reads' };
  }
  if (namespace && GH_HOST_READ_VERBS.has(verb)) {
    return { kind: 'read', reason: `gh ${namespace} ${verb} reads` };
  }
  if (!namespace && isVersionProbe(args)) {
    return { kind: 'read', reason: 'gh version probe' };
  }
  const label = [namespace, verb].filter(Boolean).join(' ') || 'command';
  return { kind: 'effect', effect: 'github', reason: `gh ${label} can change something on GitHub` };
}

const DOCKER_READ_COMMANDS: ReadonlySet<string> = new Set(['version', 'info', 'ps', 'images', 'inspect']);
const DOCKER_READ_PAIRS: ReadonlySet<string> = new Set([
  'image inspect', 'image ls', 'container ls', 'container inspect', 'desktop version', 'desktop status', 'context ls', 'context show',
]);

function classifyDockerCommand(args: readonly string[]): HostCommandGrade {
  const positional = args.map(arg => arg.trim().toLowerCase()).filter(arg => arg && !arg.startsWith('-'));
  const first = positional[0] ?? '';
  if (DOCKER_READ_COMMANDS.has(first)) {
    return { kind: 'read', reason: `docker ${first} reads` };
  }
  // `docker logs --follow` stays attached to a container; reading is the snapshot.
  if (first === 'logs' && !args.some(arg => arg === '--follow' || arg === '-f')) {
    return { kind: 'read', reason: 'docker logs reads' };
  }
  if (positional.length >= 2 && DOCKER_READ_PAIRS.has(`${first} ${positional[1]}`)) {
    return { kind: 'read', reason: `docker ${first} ${positional[1]} reads` };
  }
  if (!first && isVersionProbe(args)) {
    return { kind: 'read', reason: 'docker version probe' };
  }
  return { kind: 'effect', effect: 'process', reason: `docker ${first || 'command'} can start, stop or change containers` };
}

const VERSION_PROBE_ARGS: ReadonlySet<string> = new Set(['--version', '-v', '-V', 'version', '--help', '-h']);

function isVersionProbe(args: readonly string[]): boolean {
  return args.length === 1 && VERSION_PROBE_ARGS.has(args[0]!.trim());
}

function executableName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
}

/**
 * Whether a command a host is about to run reads or acts.
 *
 * Deny by default: a command this does not recognise is an effect, because the
 * failure on that side is a preview that shows one action too many, and on the
 * other it is a dry run that pushed a branch. Only git, gh and docker are read
 * at all, through allowlists of their read shapes; any other executable reads
 * only when it is asked for its version and nothing else.
 */
export function classifyHostCommand(command: string, args: readonly string[]): HostCommandGrade {
  const name = executableName(command);
  if (name === 'git') {
    return classifyGitCommand(args);
  }
  if (name === 'gh') {
    return classifyGhCommand(args);
  }
  if (name === 'docker') {
    return classifyDockerCommand(args);
  }
  if (isVersionProbe(args)) {
    return { kind: 'read', reason: `${name || 'command'} version probe` };
  }
  return { kind: 'effect', effect: 'process', reason: `${name || 'a process'} is not a command a dry run can grade as a read` };
}

/** One action outside the tool loop that a host is about to take. */
export interface DryRunHostEffect {
  /** Where it was asked for: `routine`, `promotion`, `dashboard`, `director` and so on. */
  surface: string;
  /** What would have happened, phrased to follow "AtlasMind did not …". */
  summary: string;
  kind: DryRunHostEffectKind;
  /** Fingerprinted and previewed redacted, never stored as given. */
  details?: Record<string, unknown>;
  /**
   * Somebody pressed something and is waiting for it. Absent means yes: the
   * cost of an unwanted notice is a click, of a missing one a person who
   * believes a deploy happened.
   */
  userInitiated?: boolean;
  /** Whether the real path would have asked a person first. */
  wouldHaveAsked?: boolean;
}

const HOST_SURFACE_CHARS = /[^a-z0-9._:-]+/g;

export function buildHostDryRunRecord(effect: DryRunHostEffect, at: string): DryRunRecord {
  const row = DRY_RUN_HOST_EFFECTS[effect.kind];
  const surface = effect.surface.toLowerCase().replace(HOST_SURFACE_CHARS, '-').slice(0, 60) || 'host';
  const details = effect.details ?? {};
  return {
    at,
    taskId: `host:${surface}`,
    toolName: surface,
    category: row.category,
    risk: row.risk,
    rule: row.rule,
    summary: redactSecrets(effect.summary).text.slice(0, 300),
    wouldHaveAsked: effect.wouldHaveAsked ?? false,
    argsFingerprint: fingerprint(details),
    argsPreview: previewDryRunArgs(details),
  };
}

/** What the operator is told when a dry run stops something they asked for. */
export function describeHostDryRunNotice(record: Pick<DryRunRecord, 'summary'>): string {
  return `Dry run is on, so AtlasMind did not ${record.summary}. Nothing was executed; it is listed in the `
    + 'AtlasMind Dry Run output. Turn dry run off (AtlasMind: Toggle Dry Run) to do it for real.';
}

/**
 * Thrown where a host would otherwise have acted. Its `name` is the one the
 * tool loop's backstop uses, so anything that already treats `DryRunBlocked`
 * as "refused, not failed" treats this the same way.
 */
export class DryRunBlockedError extends Error {
  readonly record: DryRunRecord;

  constructor(record: DryRunRecord) {
    super(describeHostDryRunNotice(record));
    this.name = DRY_RUN_BLOCKED_ERROR_NAME;
    this.record = record;
  }
}

export function isDryRunBlockedError(error: unknown): error is DryRunBlockedError {
  return error instanceof Error && error.name === DRY_RUN_BLOCKED_ERROR_NAME;
}

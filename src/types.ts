// User-specific environment info for tailoring AtlasMind behavior
export interface UserEnvironment {
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  ramGB: number;
  shell: string;
  editor: string;
  editorVersion: string;
  machineId: string;
  location: string;
  timestamp: string;
  // Extend with more fields as needed
}

export type EnvironmentRecord = UserEnvironment;
/**
 * AtlasMind – shared type definitions.
 */

// ── Model Providers ─────────────────────────────────────────────

export type ProviderId =
  | 'claude-cli'
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'mistral'
  | 'deepseek'
  | 'zai'
  | 'azure'
  | 'bedrock'
  | 'xai'
  | 'cohere'
  | 'perplexity'
  | 'huggingface'
  | 'nvidia'
  | 'openrouter'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'qwen'
  | 'moonshot'
  | 'yi'
  | 'minimax'
  | 'local'
  | 'copilot';

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;   // USD
  outputPricePer1k: number;  // USD
  capabilities: ModelCapability[];
  specialistDomains?: SpecialistDomain[];
  enabled: boolean;
  /**
   * How many subscription "premium request" units this model consumes per
   * request.  Standard models = 1, premium = 2+.  Only meaningful for
   * subscription providers (e.g. GitHub Copilot charges 3× for Opus 4).
   * Defaults to 1 when omitted.
   */
  premiumRequestMultiplier?: number;
  /**
   * Graduated reasoning depth: 0 = none, 1 = basic, 2 = medium, 3 = extended/full.
   * Used by the router instead of the binary 'reasoning' capability tag so that
   * new hybrid models can be positioned on a spectrum rather than forced into a
   * yes/no bucket.  When omitted the router falls back to 2 for models that list
   * 'reasoning' in capabilities, or 0 for models that do not.
   */
  reasoningDepth?: number;
  /**
   * Explicit latency class that overrides the context-window-based speed-tier
   * heuristic.  Set this in the catalog for models whose actual inference speed
   * does not match what the heuristic would infer (e.g. a 1M-context Flash model
   * that is genuinely fast, or an extended-thinking Opus that is genuinely slow).
   * When omitted the router derives the tier from reasoningDepth and contextWindow.
   */
  latencyClass?: 'fast' | 'balanced' | 'slow';
}

export type ModelCapability = 'chat' | 'code' | 'vision' | 'function_calling' | 'reasoning';

export type SpecialistDomain =
  | 'media-generation'
  | 'visual-analysis'
  | 'voice'
  | 'research'
  | 'robotics'
  | 'simulation';

/**
 * How the provider charges for token usage.
 * - `subscription`: Tokens included in a plan (e.g. GitHub Copilot).
 *    Effective cost is zero — prefer these over pay-per-token.
 * - `pay-per-token`: Billed per token via API (e.g. Anthropic, OpenAI).
 * - `free`: No cost at all (e.g. local models, free-tier endpoints).
 */
export type PricingModel = 'subscription' | 'pay-per-token' | 'free';

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  apiKeySettingKey: string;
  enabled: boolean;
  pricingModel: PricingModel;
  models: ModelInfo[];
  /** Subscription quota tracking — only relevant when pricingModel is 'subscription'. */
  subscriptionQuota?: SubscriptionQuota;
}

/**
 * Tracks remaining subscription quota for providers that bundle tokens in a
 * plan (e.g. GitHub Copilot, Claude Code).  When remaining quota hits zero
 * the router treats the provider as effectively `pay-per-token`.
 */
export interface SubscriptionQuota {
  /** Total premium-request units included in the billing period. */
  totalRequests: number;
  /** Remaining premium-request units in the current billing period. */
  remainingRequests: number;
  /** ISO 8601 timestamp when the current billing period resets. */
  resetsAt?: string;
  /**
   * Effective USD cost per premium-request unit, derived from the
   * subscription price divided by `totalRequests`.  Used to compare
   * the real cost of subscription tokens against pay-per-token APIs.
   * For example: $10/month ÷ 300 requests = ~$0.033 per request unit.
   */
  costPerRequestUnit?: number;
}

// ── Budget / Speed ──────────────────────────────────────────────

export type BudgetMode = 'cheap' | 'balanced' | 'expensive' | 'auto';
export type SpeedMode = 'fast' | 'balanced' | 'considered' | 'auto';
export type TaskPhase = 'planning' | 'execution' | 'synthesis' | 'maintenance';
export type TaskModality = 'text' | 'code' | 'vision' | 'mixed';
export type TaskReasoning = 'low' | 'medium' | 'high';

export interface RoutingConstraints {
  budget: BudgetMode;
  speed: SpeedMode;
  maxCostUsd?: number;
  preferredProvider?: ProviderId;
  /** Hard requirements that the selected model must support. */
  requiredCapabilities?: ModelCapability[];
  /**
   * Number of concurrent model slots the caller needs for this task batch.
   * When > 1, the router will allow pay-per-token overflow beyond
   * subscription providers to enable parallelism.
   */
  parallelSlots?: number;
}

export type ToolApprovalMode = 'always-ask' | 'ask-on-write' | 'ask-on-external' | 'allow-safe-readonly';

/**
 * Runtime approval state used to implement "Bypass Approvals" (per-task) and
 * "Autopilot" (session-wide). These aren't persisted across VS Code restarts.
 */
export interface ToolApprovalState {
  /**
   * When set to a task ID, all tool calls for that task bypass approval.
   * Cleared when the task ends.
   */
  bypassTaskId?: string;

  /**
   * When true, all tool calls bypass approval for the entire session.
   * Cleared when the user toggles it off or the extension restarts.
   */
  autopilot: boolean;
}

export type ToolRiskCategory =
  | 'read'
  | 'workspace-write'
  | 'terminal-read'
  | 'terminal-write'
  | 'git-read'
  | 'git-write'
  | 'network'
  | 'audio-input'
  | 'audio-output';

export interface ToolInvocationPolicy {
  category: ToolRiskCategory;
  risk: 'low' | 'medium' | 'high';
  summary: string;
}

export type ToolApprovalDecision = 'allow-once' | 'bypass-task' | 'autopilot' | 'deny';

export interface PendingToolApprovalRequest {
  id: string;
  taskId: string;
  toolName: string;
  category: ToolRiskCategory;
  risk: 'low' | 'medium' | 'high';
  summary: string;
  createdAt: string;
  title?: string;
  detail?: string;
  allowedDecisions?: ToolApprovalDecision[];
  decisionLabels?: Partial<Record<ToolApprovalDecision, string>>;
}

export interface TaskProfile {
  phase: TaskPhase;
  modality: TaskModality;
  reasoning: TaskReasoning;
  requiresTools: boolean;
  /** Hard requirements inferred from task shape, e.g. vision or tool use. */
  requiredCapabilities: ModelCapability[];
  /** Soft preferences used by routing scores after hard filtering. */
  preferredCapabilities: ModelCapability[];
}

// ── Agents ──────────────────────────────────────────────────────

/**
 * How often AtlasMind automatically refreshes a user-defined agent's system
 * prompt and description to keep it modern, accurate, and legally compliant.
 * The check happens on the next agent use after the interval has elapsed.
 */
export type AgentAutoUpdateCadence = 'never' | 'every-use' | 'daily' | 'weekly' | 'monthly';

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedModels?: string[];  // model IDs – empty = any
  costLimitUsd?: number;
  skills: string[];           // skill IDs
  /**
   * Routing need IDs this agent is the primary handler for.
   * Used by the orchestrator as the dominant signal when the classifier
   * returns matching routing needs — outweighs token-overlap scoring.
   * Values must be valid RoutingNeedId strings (see classifierService.ts).
   */
  primaryRoutingNeeds?: string[];
  /** True for agents shipped with the extension. Built-in agents cannot be deleted via the UI. */
  builtIn?: boolean;
  /** ISO 8601 timestamp of the last successful auto-update. */
  lastAutoUpdated?: string;
  /** When true, this agent is excluded from the global auto-update cadence. */
  autoUpdateExcluded?: boolean;
  /** When true, skill assignments are managed automatically based on the agent's role and context. */
  skillsAutoManaged?: boolean;
}

// ── Skills ──────────────────────────────────────────────────────

/**
 * Optional hooks injected into the Orchestrator to decouple it from
 * tool-approval, checkpointing, webhook dispatch, and post-tool
 * verification without inflating the constructor parameter list.
 */
export interface OrchestratorHooks {
  /** Gate function that determines whether a tool invocation should proceed. */
  toolApprovalGate?: (
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ approved: boolean; reason?: string }>;

  /** Gate function for warning-level auto-generated skills before in-process execution. */
  generatedSkillApprovalGate?: (
    skillId: string,
    scanResult: SkillScanResult,
    source: string,
  ) => Promise<{ approved: boolean; reason?: string }>;

  /** Pre-tool hook that snapshots affected files for later rollback. */
  writeCheckpointHook?: (
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<void>;

  /** Verifies the workspace state after a batch of tool invocations. */
  postToolVerifier?: (
    invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
  ) => Promise<string | undefined>;

  /**
   * Called after a subscription request completes and quota has been decremented.
   * `remainingRequests` is the new value after decrement; `totalRequests` is the
   * billing-period cap.  Use this to persist quota and emit exhaustion warnings.
   */
  onQuotaUpdated?: (providerId: string, remainingRequests: number, totalRequests: number) => void;

  /**
   * Called each time the active model changes during task execution — on initial
   * selection, provider failover, tool-capability re-route, and escalation.
   * Callers can use this to show a live model indicator in the UI.
   */
  onModelSelected?: (model: string) => void;
}

/**
 * Runtime-configurable orchestrator tunables.
 * Values are read from `atlasmind.*` VS Code settings with constant defaults.
 */
export interface OrchestratorConfig {
  maxToolIterations: number;
  maxToolCallsPerTurn: number;
  toolExecutionTimeoutMs: number;
  providerTimeoutMs: number;
}

/**
 * Runtime context provided to skill handlers.
 * Abstracts VS Code APIs so skills remain independently testable.
 */
export interface SkillExecutionContext {
  /** Absolute filesystem path to the workspace root, or undefined if no workspace is open. */
  workspaceRootPath: string | undefined;
  /** Search the in-memory SSOT index for relevant entries. */
  queryMemory(query: string, maxResults?: number): Promise<MemoryEntry[]>;
  /** Add or update an entry in the in-memory SSOT index and optionally persist to disk. */
  upsertMemory(entry: MemoryEntry): MemoryUpsertResult;
  /** Remove an entry from the in-memory SSOT index and optionally delete the file on disk. */
  deleteMemory(path: string): Promise<boolean>;
  /** Read the UTF-8 text content of a file by absolute path. */
  readFile(absolutePath: string): Promise<string>;
  /** Write UTF-8 text to a file by absolute path. Rejects paths outside the workspace root. */
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Find files matching a glob pattern relative to the workspace root. Returns absolute paths. */
  findFiles(globPattern: string): Promise<string[]>;
  /** Search UTF-8 text files in the workspace and return matching lines. */
  searchInFiles(
    query: string,
    options?: { isRegexp?: boolean; includePattern?: string; maxResults?: number },
  ): Promise<Array<{ path: string; line: number; text: string }>>;
  /** List the direct children of a workspace-relative or absolute directory path. */
  listDirectory(absolutePath?: string): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
  /** Execute a subprocess without shell interpolation and capture stdout/stderr. */
  runCommand(
    executable: string,
    args?: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  /** Return `git status --short --branch` for the workspace repository. */
  getGitStatus(): Promise<string>;
  /** Return `git diff` output for the workspace repository. */
  getGitDiff(options?: { ref?: string; staged?: boolean }): Promise<string>;
  /** Restore the most recent automatic checkpoint captured before write-capable tool use. */
  rollbackLastCheckpoint(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }>;
  /** Validate or apply a unified git patch inside the workspace repository. */
  applyGitPatch(
    patch: string,
    options?: { checkOnly?: boolean; stage?: boolean },
  ): Promise<{ ok: boolean; stdout: string; stderr: string }>;
  /** Return `git log` output for the workspace repository. */
  getGitLog(options?: { maxCount?: number; ref?: string; filePath?: string }): Promise<string>;
  /** Manage git branches: list, create, switch, or delete. */
  gitBranch(action: 'list' | 'create' | 'switch' | 'delete', name?: string): Promise<string>;
  /** Delete a file inside the workspace by absolute path. */
  deleteFile(absolutePath: string): Promise<void>;
  /** Move or rename a file inside the workspace. Both paths must be absolute workspace paths. */
  moveFile(sourcePath: string, destPath: string): Promise<void>;
  /** Get LSP diagnostics (compiler errors/warnings) for files in the workspace. */
  getDiagnostics(filePaths?: string[]): Promise<Array<{ path: string; line: number; column: number; severity: string; message: string; source?: string }>>;
  /** Retrieve a stored API key for a specialist integration (e.g. 'exa', 'elevenlabs'). Returns undefined if not configured. */
  getSpecialistApiKey(providerId: string): Promise<string | undefined>;
  /** List the names of currently visible VS Code output channels. Returns empty array in non-VS-Code environments. */
  getOutputChannelNames(): Promise<string[]>;
  /** Read the recent content logged to a named VS Code output channel by AtlasMind itself. Returns empty string if the channel is not tracked or unavailable. */
  getAtlasMindOutputLog(): Promise<string>;
  /** List active debug sessions with their type and name. Returns empty array when no debug session is running. */
  getDebugSessions(): Promise<Array<{ id: string; name: string; type: string }>>;
  /** Evaluate an expression in the currently paused debug session. Returns the result or an error string. */
  evaluateDebugExpression(expression: string, frameId?: number): Promise<string>;
  /**
   * Return recent output lines from a named VS Code integrated terminal.
   * If `terminalName` is omitted the most-recently-active terminal is used.
   * Returns an empty string when no matching terminal is found or the
   * environment does not support terminal reads.
   */
  getTerminalOutput(terminalName?: string): Promise<string>;
  /** List document symbols (functions, classes, variables) in a file using the VS Code symbol provider. */
  getDocumentSymbols(absolutePath: string): Promise<Array<{ name: string; kind: string; range: string; children?: string[] }>>;
  /** Find all references to a symbol at a given position. */
  findReferences(absolutePath: string, line: number, column: number): Promise<Array<{ path: string; line: number; column: number; text: string }>>;
  /** Go to definition of a symbol at a given position. */
  goToDefinition(absolutePath: string, line: number, column: number): Promise<Array<{ path: string; line: number; column: number }>>;
  /** Rename a symbol across the workspace using the VS Code rename provider. */
  renameSymbol(absolutePath: string, line: number, column: number, newName: string): Promise<{ filesChanged: number; editsApplied: number }>;
  /** Fetch text content from a URL. Returns the response body as text (HTML→markdown conversion for web pages). */
  fetchUrl(url: string, options?: { maxBytes?: number; timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }>;
  /** Make a bounded HTTP request with optional method, headers, and body. Subject to the same timeout and size limits as fetchUrl. */
  httpRequest(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number; timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }>;
  /** Get code actions (quick-fixes, refactorings) available at a position or range. */
  getCodeActions(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number): Promise<Array<{ title: string; kind?: string; isPreferred?: boolean }>>;
  /** Apply a code action by title at a given position or range. */
  applyCodeAction(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number, actionTitle: string): Promise<{ applied: boolean; reason?: string }>;
  /**
   * List installed VS Code extensions with their id, display name, version, and whether the
   * extension is currently active (activated and running). Note: `isActive` reflects the VS Code
   * `Extension.isActive` flag — it is `true` once the extension has been activated this session,
   * and `false` for extensions that have not yet been activated (e.g. lazy-activated extensions).
   * Returns an empty array in non-VS-Code environments.
   */
  getInstalledExtensions(): Promise<Array<{ id: string; displayName: string; version: string; isActive: boolean }>>;
  /**
   * Return a list of currently forwarded ports from the VS Code Remote/Tunnels API.
   * Returns an empty array when no ports are forwarded or the API is unavailable.
   */
  getPortForwards(): Promise<Array<{ portNumber: number; label?: string; localAddress?: string; privacy?: string }>>;
  /** Get a summary of the most recent VS Code test run results. Returns counts per state (passed, failed, skipped, errored). */
  getTestResults?(): Promise<Array<{ id: string; completedAt: number; durationMs?: number; counts: Record<string, number> }>>;
  /** Get info about the currently active VS Code debug session, or null if none is active. */
  getActiveDebugSession?(): Promise<{ id: string; name: string; type: string } | null>;
  /** List the names of currently open integrated terminals. */
  listTerminals?(): Promise<Array<{ name: string }>>;
  /** Open a URL in the VS Code Simple Browser panel. No-op in non-VS-Code environments. */
  openSimpleBrowser?(url: string, title?: string): Promise<void>;
  /** List VS Code debug launch configurations from .vscode/launch.json. Returns empty array when none exist. */
  getDebugConfigs?(): Promise<Array<{ name: string; type: string; request: string }>>;
  /** Start a VS Code debug session by configuration name. Returns ok=false with a message on failure. */
  launchDebugSession?(configName: string): Promise<{ ok: boolean; message: string }>;
  /** List all breakpoints currently set in the workspace. */
  getBreakpoints?(): Promise<Array<{ id: string; path: string; line: number; enabled: boolean; condition?: string }>>;
  /** Add a source breakpoint at the given absolute file path and 1-based line number. Returns the new breakpoint ID. */
  addBreakpoint?(absolutePath: string, line: number, options?: { condition?: string; logMessage?: string }): Promise<string>;
  /** Remove breakpoints by their IDs. Returns the count of breakpoints actually removed. */
  removeBreakpoints?(ids: string[]): Promise<{ removed: number }>;
}

export type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** JSON Schema object describing the input parameters for this skill. */
  parameters: Record<string, unknown>;
  execute: SkillHandler;
  /** Absolute path to the source file. Present for custom (non-built-in) skills. */
  source?: string;
  /** True for skills shipped with the extension. Built-in skills default to enabled. */
  builtIn?: boolean;
  /** Optional Skills tree path segments used for built-in categories or custom folders. */
  panelPath?: string[];
  /** Per-skill execution timeout in milliseconds. Overrides the orchestrator default (15 000 ms) when set. */
  timeoutMs?: number;
  /** Optional natural-language phrases and aliases that help AtlasMind route freeform requests toward this skill. */
  routingHints?: string[];
}

// ── Skill security scanning ──────────────────────────────────────

export interface SkillScanIssue {
  /** Rule identifier, e.g. "no-eval". */
  rule: string;
  severity: 'error' | 'warning';
  /** 1-based line number in the source file. */
  line: number;
  /** The offending line of code (trimmed, max 120 chars). */
  snippet: string;
  message: string;
}

/** Overall result of a static security scan on a skill's source. */
export type SkillScanStatus = 'not-scanned' | 'passed' | 'failed';

export interface SkillScanResult {
  skillId: string;
  status: SkillScanStatus;
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  issues: SkillScanIssue[];
}

// ── Scanner rule configuration ────────────────────────────────────

/**
 * A scanner rule in a format that can be serialised to / from JSON.
 * `pattern` is stored as a regex source string (no delimiters), flags are always `''`.
 */
export interface SerializedScanRule {
  id: string;
  severity: 'error' | 'warning';
  /** Regex source string, e.g. `\\beval\\s*\\(` */
  pattern: string;
  message: string;
  /** When false the rule is loaded but never fires. Defaults to true. */
  enabled: boolean;
  /** True for rules shipped with the extension. Custom rules are false. */
  builtIn: boolean;
}

export interface ScannerRulesConfig {
  /** Per-rule overrides keyed by rule id. Only changed fields need to be stored. */
  overrides: Record<string, Partial<Pick<SerializedScanRule, 'severity' | 'message' | 'enabled'>>>;
  /** User-defined rules appended after the built-in set. */
  customRules: SerializedScanRule[];
}

// ── Memory scanning ─────────────────────────────────────────────

export interface MemoryScanIssue {
  rule: string;
  severity: 'error' | 'warning';
  /** 1-based line number in the document. */
  line: number;
  /** The offending line (trimmed, max 120 chars). */
  snippet: string;
  message: string;
}

/**
 * Result of scanning a single SSOT document for prompt-injection and secret leakage.
 * Error-level findings block the entry from being included in model context.
 * Warning-level findings are noted in the system prompt but do not suppress the entry.
 */
export interface MemoryScanResult {
  path: string;
  /** 'clean' | 'warned' | 'blocked' */
  status: 'clean' | 'warned' | 'blocked';
  scannedAt: string;
  issues: MemoryScanIssue[];
}

// ── Memory / SSOT ───────────────────────────────────────────────

export const SSOT_FOLDERS = [
  'project_soul.md',
  'architecture',
  'roadmap',
  'decisions',
  'misadventures',
  'ideas',
  'domain',
  'operations',
  'agents',
  'skills',
  'index',
  'sessions',
] as const;

export type SsotFolder = (typeof SSOT_FOLDERS)[number];

export type MemoryDocumentClass =
  | 'project-soul'
  | 'architecture'
  | 'roadmap'
  | 'decision'
  | 'misadventure'
  | 'idea'
  | 'domain'
  | 'operations'
  | 'agent'
  | 'skill'
  | 'index'
  | 'session-context'
  | 'other';

export type MemoryEvidenceType = 'manual' | 'imported' | 'generated-index';

/**
 * Structured context loaded from the session SSOT folder.
 * Replaces the raw 400-char sessionContext string when available.
 */
export interface SessionContextBundle {
  /** The top-level goal or problem statement for this session or project run. Rendered before the summary so every agent knows what it is solving. */
  goal?: string;
  /** Rolling compressed summary of the session, updated each turn. */
  summary: string;
  /** Concluded facts, diagnosed issues, and fixes applied this session. */
  decisions: string;
  /** Unresolved questions and incomplete tasks. */
  openThreads: string;
  /** Excerpts from main SSOT entries cited as relevant to this session. */
  ssotExcerpts: string[];
  /** ISO timestamp when this bundle was loaded from disk. */
  loadedAt: string;
}

export interface MemoryEntry {
  path: string;
  title: string;
  tags: string[];
  lastModified: string;
  snippet: string;
  /** Authoritative workspace-relative files or SSOT entries this memory note summarizes or points to. */
  sourcePaths?: string[];
  /** Optional SSOT links used for one-hop graph expansion during retrieval. */
  relatedPaths?: string[];
  /** Import/source fingerprint when this entry was generated from tracked upstream inputs. */
  sourceFingerprint?: string;
  /** Fingerprint of the stored note body, when available from import metadata. */
  bodyFingerprint?: string;
  /** High-level document class used to bias retrieval quality. */
  documentClass?: MemoryDocumentClass;
  /** Whether the entry was hand-authored, imported from live sources, or generated as a meta-index. */
  evidenceType?: MemoryEvidenceType;
  /** Internal embedding/vector metadata used for semantic retrieval. */
  embedding?: number[];
}

/** Outcome of a {@link MemoryManager.upsert} call. */
export interface MemoryUpsertResult {
  /** Whether the entry was accepted ('created' | 'updated') or rejected. */
  status: 'created' | 'updated' | 'rejected';
  /** Human-readable reason when status is 'rejected'. */
  reason?: string;
}

/** Options for {@link MemoryManager.queryWithOptions}, allowing callers to override query mode and filter results. */
export interface MemoryQueryOptions {
  /** Override the inferred retrieval mode instead of using automatic classification. */
  mode?: 'summary-safe' | 'hybrid' | 'live-verify' | 'planning';
  /** Maximum number of results to return (default: 5). */
  maxResults?: number;
  /** Only return entries whose tags include ALL of the specified values. */
  filterByTags?: string[];
  /** Exclude entries whose document class matches any of these values. */
  excludeClass?: MemoryDocumentClass[];
}

/** Aggregate statistics about the in-memory SSOT index. */
export interface MemoryStat {
  /** Total number of indexed entries. */
  totalEntries: number;
  /** Entries grouped by document class. */
  entriesByClass: Partial<Record<MemoryDocumentClass, number>>;
  /** Number of entries with scanner warnings. */
  warnings: number;
  /** Number of entries blocked by the scanner. */
  blocked: number;
  /** Total combined snippet length across all entries (proxy for memory size). */
  totalSnippetChars: number;
  /** Number of entries whose source files may be stale (have sourcePaths but no bodyFingerprint). */
  potentiallyStaleImports: number;
  /** Number of imported entries that are fully fingerprinted (have both sourcePaths and bodyFingerprint). */
  fingerprintedImports: number;
}

/** A single operator feedback event written to SSOT when frustration is detected during chat. */
export interface OperatorFeedback {
  /** ISO timestamp of the feedback event. */
  timestamp: string;
  /** Detected signal strength. */
  level: 'high' | 'moderate' | 'low';
  /** The cue pattern that matched in the user's prompt. */
  matchedCue: string;
  /** Brief human-readable summary of what was detected. */
  summary: string;
  /** The guidance injected into the next model turn. */
  recoveryGuidance: string;
}

// ── Multi-agent project execution ───────────────────────────────

/**
 * A single unit of work within a decomposed project plan.
 * Subtasks form a DAG via `dependsOn`; independent subtasks run in parallel.
 */
export interface SubTask {
  /** Short slug used as a dependency reference key (e.g. "setup-repo"). */
  id: string;
  title: string;
  description: string;
  /** Specialisation role for the ephemeral agent (e.g. "backend-engineer"). */
  role: string;
  /** Skill IDs available to this subtask's agent. */
  skills: string[];
  /** IDs of subtasks whose output must be available before this one starts. */
  dependsOn: string[];
}

export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ToolExecutionArtifact {
  toolName: string;
  durationMs: number;
  checkpointed: boolean;
  resultPreview: string;
}

export interface SubTaskExecutionArtifacts {
  output: string;
  outputPreview: string;
  toolCallCount: number;
  toolCalls: ToolExecutionArtifact[];
  verificationSummary?: string;
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  tddSummary?: string;
  checkpointedTools: string[];
  changedFiles: ChangedWorkspaceFile[];
  diffPreview?: string;
}

export interface SubTaskResult {
  subTaskId: string;
  title: string;
  status: SubTaskStatus;
  output: string;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  error?: string;
  role?: string;
  dependsOn?: string[];
  artifacts?: SubTaskExecutionArtifacts;
  /** Set when the subtask failed because a provider was billing-paused with no fallback available. Signals the project runner to abort remaining batches. */
  billingAbort?: boolean;
}

/** A decomposed project plan ready for parallel execution. */
export interface ProjectPlan {
  id: string;
  goal: string;
  subTasks: SubTask[];
}

/** Final result after all subtasks complete and a synthesis pass runs. */
export interface ProjectResult {
  id: string;
  goal: string;
  subTaskResults: SubTaskResult[];
  /** Synthesised final report assembled from all subtask outputs. */
  synthesis: string;
  totalCostUsd: number;
  totalDurationMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface ChangedWorkspaceFile {
  relativePath: string;
  status: 'created' | 'modified' | 'deleted';
  uri?: { fsPath: string };
}

export type ProjectRunReviewDecision = 'pending' | 'accepted' | 'dismissed';

export interface ProjectRunReviewFile {
  relativePath: string;
  status: ChangedWorkspaceFile['status'];
  uri?: { fsPath: string };
  decision: ProjectRunReviewDecision;
  decidedAt?: string;
}

export interface ProjectRunSummary {
  id: string;
  goal: string;
  startedAt: string;
  generatedAt: string;
  synthesis: string;
  totalCostUsd: number;
  totalDurationMs: number;
  subTaskResults: Array<{
    subTaskId: string;
    title: string;
    status: string;
    costUsd: number;
    durationMs: number;
    error?: string;
  }>;
  changedFiles: ChangedWorkspaceFile[];
  fileAttribution: Record<string, string[]>;
  subTaskArtifacts: ProjectRunSubTaskArtifact[];
}

export interface ProjectRunExecutionOptions {
  autonomousMode: boolean;
  requireBatchApproval: boolean;
  mirrorProgressToChat: boolean;
  injectOutputIntoFollowUp: boolean;
}

export interface ProjectRunIdeationOrigin {
  boardPath: string;
  launchMode: 'focused-card' | 'board-thread';
  sourceCardId?: string;
  sourceCardTitle?: string;
  sourcePrompt?: string;
}

export interface ProjectRunSubTaskArtifact {
  subTaskId: string;
  title: string;
  role: string;
  dependsOn: string[];
  status: SubTaskStatus;
  output: string;
  outputPreview: string;
  costUsd: number;
  durationMs: number;
  error?: string;
  toolCallCount: number;
  toolCalls: ToolExecutionArtifact[];
  verificationSummary?: string;
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  tddSummary?: string;
  checkpointedTools: string[];
  changedFiles: ChangedWorkspaceFile[];
  diffPreview?: string;
}

export interface ProjectRunLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface ProjectRunSeedResult {
  subTaskId: string;
  title: string;
  output: string;
}

export interface ProjectRunRecord {
  id: string;
  title: string;
  goal: string;
  workspaceKey?: string;
  chatSessionId?: string;
  chatMessageId?: string;
  plannerRootRunId?: string;
  plannerJobIndex?: number;
  plannerJobCount?: number;
  plannerSeedResults?: ProjectRunSeedResult[];
  carryForwardSummary?: string;
  ideationOrigin?: ProjectRunIdeationOrigin;
  status: 'previewed' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  estimatedFiles: number;
  requiresApproval: boolean;
  planSubtaskCount: number;
  completedSubtaskCount: number;
  totalSubtaskCount: number;
  currentBatch: number;
  totalBatches: number;
  failedSubtaskTitles: string[];
  reportPath?: string;
  plan?: ProjectPlan;
  summary?: ProjectRunSummary;
  reviewFiles?: ProjectRunReviewFile[];
  subTaskArtifacts: ProjectRunSubTaskArtifact[];
  executionOptions: ProjectRunExecutionOptions;
  requireBatchApproval: boolean;
  paused: boolean;
  awaitingBatchApproval: boolean;
  logs: ProjectRunLogEntry[];
}

/** Progress event emitted as each subtask completes during project execution. */
export type ProjectProgressUpdate =
  | { type: 'planned'; plan: ProjectPlan }
  | { type: 'batch-start'; batchIndex: number; totalBatches: number; batchSize: number; subTaskIds: string[] }
  | { type: 'subtask-start'; subTaskId: string; title: string; batchSize: number }
  | { type: 'subtask-done'; result: SubTaskResult; completed: number; total: number }
  | { type: 'subtask-retry'; subTaskId: string; title: string; reason: string }
  | { type: 'synthesizing' }
  | { type: 'error'; message: string };

// ── Orchestrator ────────────────────────────────────────────────

export interface TaskRequest {
  id: string;
  userMessage: string;
  context: Record<string, unknown>;
  constraints: RoutingConstraints;
  timestamp: string;
  /** Cancellation signal. When aborted, the orchestrator stops before the next tool iteration. */
  signal?: AbortSignal;
}

export interface TaskImageAttachment {
  source: string;
  mimeType: string;
  dataBase64: string;
}

export interface TaskResult {
  id: string;
  agentId: string;
  modelUsed: string;
  response: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  artifacts?: Omit<SubTaskExecutionArtifacts, 'changedFiles' | 'diffPreview'>;
  /** Set when a provider was automatically paused mid-request (e.g. billing failure). */
  autoDisabledProvider?: {
    providerId: string;
    displayName: string;
    reason: 'billing' | 'auth';
    failoverModelUsed?: string;
  };
  /** True when the agentic loop hit the maxToolIterations cap without a natural stop. */
  iterationLimitHit?: boolean;
  /** Orchestrator-suggested new value for maxToolIterations when iterationLimitHit is true. */
  suggestedIterationLimit?: number;
  /** Orchestrator-suggested new value for maxToolCallsPerTurn when the per-turn cap was exceeded. */
  suggestedToolCallsPerTurnLimit?: number;
  /** Set when the orchestrator auto-synthesized a new specialist agent for this task. */
  synthesizedAgent?: {
    id: string;
    name: string;
    role: string;
    description: string;
  };
  /**
   * Set when the task was decomposed into subtasks via processTaskMultiStep.
   * Each element is the result of one subtask in execution order.
   */
  stepwiseResults?: SubTaskResult[];
}

// ── Cost tracking ───────────────────────────────────────────────

export interface CostRecord {
  taskId: string;
  agentId: string;
  model: string;
  providerId?: ProviderId;
  pricingModel?: PricingModel;
  billingCategory?: 'pay-per-token' | 'free' | 'subscription-included' | 'subscription-overflow';
  sessionId?: string;
  messageId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  budgetCostUsd?: number;
  timestamp: string;
}

// ── MCP (Model Context Protocol) ────────────────────────────────

/**
 * Persisted configuration for a single MCP server connection.
 * At least one of `command` (stdio) or `url` (HTTP/SSE) must be set.
 */
export interface McpServerConfig {
  /** Unique identifier for this server entry (UUID). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Transport type – 'stdio' spawns a subprocess; 'http' connects over Streamable HTTP/SSE. */
  transport: 'stdio' | 'http';
  // stdio fields
  command?: string;            // e.g. "npx"
  args?: string[];             // e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  env?: Record<string, string>;
  // http fields
  url?: string;                // e.g. "http://localhost:3000/mcp"
  /** Whether the server should be connected on extension activation. */
  enabled: boolean;
}

/** Live connection status of a single MCP server. */
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Metadata about a single tool exposed by an MCP server. */
export interface McpToolInfo {
  serverId: string;
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** Snapshot of an MCP server's runtime state (config + live status + discovered tools). */
export interface McpServerState {
  config: McpServerConfig;
  status: McpConnectionStatus;
  /** Set when status is 'error'. */
  error?: string;
  tools: McpToolInfo[];
}

// ── Voice (TTS / STT) ────────────────────────────────────────────────────────

/**
 * Voice synthesis and recognition settings.
 * All values are validated before use (see VoiceManager).
 */
export interface VoiceSettings {
  /** Speech rate — range [0.5, 2.0], default 1.0. */
  rate: number;
  /** Pitch — range [0, 2], default 1.0. */
  pitch: number;
  /** Volume — range [0, 1], default 1.0. */
  volume: number;
  /** Whether STT controls should be available in the voice panel. */
  sttEnabled: boolean;
  /**
   * BCP 47 language tag for synthesis and recognition (e.g. "en-US").
   * Empty string means browser/OS default.
   */
  language: string;
  /** Preferred microphone device id, when a backend can honor it. */
  inputDeviceId: string;
  /** Preferred audio output device id, when a backend can honor it. */
  outputDeviceId: string;
}

/**
 * AtlasMind – shared type definitions.
 */

// ── Model Providers ─────────────────────────────────────────────

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'deepseek' | 'zai' | 'local' | 'copilot';

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;   // USD
  outputPricePer1k: number;  // USD
  capabilities: ModelCapability[];
  enabled: boolean;
  /**
   * How many subscription "premium request" units this model consumes per
   * request.  Standard models = 1, premium = 2+.  Only meaningful for
   * subscription providers (e.g. GitHub Copilot charges 3× for Opus 4).
   * Defaults to 1 when omitted.
   */
  premiumRequestMultiplier?: number;
}

export type ModelCapability = 'chat' | 'code' | 'vision' | 'function_calling' | 'reasoning';

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
export type TaskPhase = 'planning' | 'execution' | 'synthesis';
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

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  allowedModels?: string[];  // model IDs – empty = any
  costLimitUsd?: number;
  skills: string[];           // skill IDs
  /** True for agents shipped with the extension. Built-in agents cannot be deleted via the UI. */
  builtIn?: boolean;
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
    toolName: string,
    args: Record<string, unknown>,
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
  /** Get code actions (quick-fixes, refactorings) available at a position or range. */
  getCodeActions(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number): Promise<Array<{ title: string; kind?: string; isPreferred?: boolean }>>;
  /** Apply a code action by title at a given position or range. */
  applyCodeAction(absolutePath: string, startLine: number, startColumn: number, endLine: number, endColumn: number, actionTitle: string): Promise<{ applied: boolean; reason?: string }>;
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
  /** Per-skill execution timeout in milliseconds. Overrides the orchestrator default (15 000 ms) when set. */
  timeoutMs?: number;
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
] as const;

export type SsotFolder = (typeof SSOT_FOLDERS)[number];

export interface MemoryEntry {
  path: string;
  title: string;
  tags: string[];
  lastModified: string;
  snippet: string;
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
  durationMs: number;
  error?: string;
  role?: string;
  dependsOn?: string[];
  artifacts?: SubTaskExecutionArtifacts;
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
}

export interface ChangedWorkspaceFile {
  relativePath: string;
  status: 'created' | 'modified' | 'deleted';
  uri?: { fsPath: string };
}

export interface ProjectRunSummary {
  id: string;
  goal: string;
  startedAt: string;
  generatedAt: string;
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
  checkpointedTools: string[];
  changedFiles: ChangedWorkspaceFile[];
  diffPreview?: string;
}

export interface ProjectRunLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface ProjectRunRecord {
  id: string;
  goal: string;
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
  subTaskArtifacts: ProjectRunSubTaskArtifact[];
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
  | { type: 'synthesizing' }
  | { type: 'error'; message: string };

// ── Orchestrator ────────────────────────────────────────────────

export interface TaskRequest {
  id: string;
  userMessage: string;
  context: Record<string, unknown>;
  constraints: RoutingConstraints;
  timestamp: string;
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
  durationMs: number;
  artifacts?: Omit<SubTaskExecutionArtifacts, 'changedFiles' | 'diffPreview'>;
}

// ── Cost tracking ───────────────────────────────────────────────

export interface CostRecord {
  taskId: string;
  agentId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
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
  /**
   * BCP 47 language tag for synthesis and recognition (e.g. "en-US").
   * Empty string means browser/OS default.
   */
  language: string;
}

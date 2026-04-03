/**
 * AtlasMind – shared type definitions.
 */

// ── Model Providers ─────────────────────────────────────────────

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'mistral' | 'deepseek' | 'local' | 'copilot';

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;   // USD
  outputPricePer1k: number;  // USD
  capabilities: ModelCapability[];
  enabled: boolean;
}

export type ModelCapability = 'chat' | 'code' | 'vision' | 'function_calling' | 'reasoning';

export interface ProviderConfig {
  id: ProviderId;
  displayName: string;
  apiKeySettingKey: string;
  enabled: boolean;
  models: ModelInfo[];
}

// ── Budget / Speed ──────────────────────────────────────────────

export type BudgetMode = 'cheap' | 'balanced' | 'expensive' | 'auto';
export type SpeedMode = 'fast' | 'balanced' | 'considered' | 'auto';

export interface RoutingConstraints {
  budget: BudgetMode;
  speed: SpeedMode;
  maxCostUsd?: number;
  preferredProvider?: ProviderId;
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
}

// ── Skills ──────────────────────────────────────────────────────

/**
 * Runtime context provided to skill handlers.
 * Abstracts VS Code APIs so skills remain independently testable.
 */
export interface SkillExecutionContext {
  /** Absolute filesystem path to the workspace root, or undefined if no workspace is open. */
  workspaceRootPath: string | undefined;
  /** Search the in-memory SSOT index for relevant entries. */
  queryMemory(query: string, maxResults?: number): Promise<MemoryEntry[]>;
  /** Add or update an entry in the in-memory SSOT index. */
  upsertMemory(entry: MemoryEntry): void;
  /** Read the UTF-8 text content of a file by absolute path. */
  readFile(absolutePath: string): Promise<string>;
  /** Write UTF-8 text to a file by absolute path. Rejects paths outside the workspace root. */
  writeFile(absolutePath: string, content: string): Promise<void>;
  /** Find files matching a glob pattern relative to the workspace root. Returns absolute paths. */
  findFiles(globPattern: string): Promise<string[]>;
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
}

// ── Orchestrator ────────────────────────────────────────────────

export interface TaskRequest {
  id: string;
  userMessage: string;
  context: Record<string, unknown>;
  constraints: RoutingConstraints;
  timestamp: string;
}

export interface TaskResult {
  id: string;
  agentId: string;
  modelUsed: string;
  response: string;
  costUsd: number;
  durationMs: number;
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

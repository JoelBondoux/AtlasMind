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

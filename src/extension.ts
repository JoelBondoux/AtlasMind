import { EnvironmentManager } from './core/environmentManager.js';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { readFileSync } from 'fs';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { sanitizeTerminalOutput } from './utils/terminalOutput.js';
import { PresenceManager } from './core/presenceManager.js';
import {
  LOCAL_GPU_ADMISSION_WAIT_MS,
  LOCAL_GPU_MAX_CONCURRENT_REQUESTS,
  LOCAL_GPU_MAX_OWNED_RESIDENT_MODELS,
  LOCAL_GPU_RESIDENCY_POLL_MS,
  LOCAL_GPU_EVICTION_COOLDOWN_MS,
} from './constants.js';
import { BUZZ_AGENT_KEY_SECRET } from './core/buzzSigner.js';
import { BuzzInboundService } from './core/buzzInboundService.js';
import { BUZZ_SETUP_COMMANDS } from './core/buzzSetupPlan.js';
import {
  clampTestResourceShare,
  planTestCommandThrottle,
  planTestResourceBudget,
  withTestResourceEnv,
  type TestResourceBudget,
} from './core/testResourceBudget.js';

/** The walkthrough lives in its own thread rather than interrupting another. */
const BUZZ_GUIDE_SESSION_TITLE = 'Buzz setup';

/**
 * One reused terminal for setup commands AtlasMind types.
 *
 * Named rather than anonymous so a second prepared command lands in the terminal
 * the user is already looking at, and so the sign-in flow they are half-way
 * through is not buried under a stack of identical panes.
 */
const SETUP_TERMINAL_NAME = 'AtlasMind setup';
import type { ProjectMemoryFreshnessStatus } from './bootstrap/bootstrapper.js';
import type { SessionConversation, SessionPolicySnapshot } from './chat/sessionConversation.js';
import type { VoiceManager } from './voice/voiceManager.js';
import type { Orchestrator } from './core/orchestrator.js';
import type { DataPrivacyManager } from './core/dataPrivacyManager.js';
import type { AgentRegistry } from './core/agentRegistry.js';
import type { SkillsRegistry } from './core/skillsRegistry.js';
import type { ModelRouter } from './core/modelRouter.js';
import type { MemoryManager } from './memory/memoryManager.js';
import type { SessionContextManager } from './memory/sessionContextManager.js';
import type { CostTracker } from './core/costTracker.js';
import type { ScannerRulesManager } from './core/scannerRulesManager.js';
import type { ToolWebhookDispatcher } from './core/toolWebhookDispatcher.js';
import type { McpServerRegistry } from './mcp/mcpServerRegistry.js';
import type { ArdRegistry } from './ard/ardRegistry.js';
import type { ArdClient } from './ard/ardClient.js';
import type { ArdInstaller } from './ard/ardInstaller.js';
import type { CheckpointManager } from './core/checkpointManager.js';
import type { ProjectRunHistory } from './core/projectRunHistory.js';
import type { RoutineRegistry } from './core/routineRegistry.js';
import type { DeliveryManager } from './core/deliveryManager.js';
import type { ProjectDirectorManager } from './core/projectDirectorManager.js';
import type { DocumentsManager } from './core/documentsManager.js';
import type { RiskOversightManager } from './core/riskOversightManager.js';
import type { ResearchRegisterManager } from './core/researchRegister.js';
import type { MissionRegistry } from './core/missionRegistry.js';
import { ACP_PROBE_TIMEOUT_MS, ACP_PROVIDER_ID, getConfiguredLocalEndpoints, type ProviderRegistry } from './providers/index.js';
import { getModelInfoUrl, getProviderInfoUrl, lookupCatalog } from './providers/modelCatalog.js';
import { inferContextWindow, inferCapabilities, inferSpecialistDomains, inferPricing } from './providers/modelMetadataInference.js';
import {
  fetchCopilotMultipliers,
  isSyncStale,
  resolveMultiplier,
  type MultiplierSyncResult,
  COPILOT_MULTIPLIER_DOCS_URL,
  MULTIPLIER_CACHE_STALE_MS,
} from './providers/copilotMultiplierSync.js';
import {
  fetchAllProviderPricing,
  isProviderPricingStale,
  resolveProviderPricing,
  PROVIDER_PRICING_SPECS,
  type ProviderPricingEntry,
  type ProviderPricingSyncResult,
} from './providers/providerPricingSync.js';
import { configureCurrencyFormatter, syncExchangeRates } from './core/currencyFormatter.js';
import { syncLocalModels, isLocalSyncStale, LOCAL_MODEL_SYNC_CACHE_KEY, type LocalModelSyncResult } from './providers/localModelSync.js';
import { syncLocalModelCatalog } from './providers/localModelCatalogSync.js';
import type { DiscoveredModel } from './providers/adapter.js';
import type { AgentDefinition, MemoryEntry, ModelInfo, ModelStruggleState, ProviderConfig, ProviderId, SkillDefinition, SkillExecutionContext, SkillScanResult, SpecialistDomain } from './types.js';
import { ToolApprovalManager } from './core/toolApprovalManager.js';
import { RemoteControlServer } from './remote/remoteControlServer.js';

const execFileAsync = promisify(execFile);

/** Augmented type for `vscode.env` that includes the Remote forwarded-ports API (available only in remote contexts). */
type VscodeEnvWithPorts = typeof vscode.env & {
  forwardedPorts?: ReadonlyArray<{
    portNumber: number;
    label?: string;
    localAddress?: string;
    privacy?: string;
  }>;
};
const USER_AGENTS_STORAGE_KEY = 'atlasmind.userAgents';
const BUILTIN_AGENT_ALLOWED_MODELS_STORAGE_KEY = 'atlasmind.builtinAgentAllowedModels';
const BUILTIN_AGENT_PROMPT_OVERRIDES_STORAGE_KEY = 'atlasmind.builtinAgentPromptOverrides';
const DISABLED_PROVIDER_IDS_STORAGE_KEY = 'atlasmind.disabledProviderIds';
const DISABLED_MODEL_IDS_STORAGE_KEY = 'atlasmind.disabledModelIds';
const CUSTOM_SKILLS_STORAGE_KEY = 'atlasmind.customSkills';
const CUSTOM_SKILL_FOLDERS_STORAGE_KEY = 'atlasmind.customSkillFolders';
const AZURE_OPENAI_ENDPOINT_SETTING = 'azureOpenAiEndpoint';
const AZURE_OPENAI_DEPLOYMENTS_SETTING = 'azureOpenAiDeployments';
const AZURE_OPENAI_API_VERSION = '2024-10-21';
const DEFAULT_SSOT_PATH = 'project_memory';
const AUTO_DISCOVERABLE_SSOT_PATHS = [DEFAULT_SSOT_PATH];
const MEMORY_NEEDS_UPDATE_CONTEXT_KEY = 'atlasmind.memoryNeedsUpdate';
const SSOT_PRESENT_CONTEXT_KEY = 'atlasmind.ssotPresent';
const PERSONALITY_PROFILE_STORAGE_KEY = 'atlasmind.personalityProfile';
const SUBSCRIPTION_QUOTA_STORAGE_KEY = 'atlasmind.subscriptionQuota';
const EXECUTION_OUTCOMES_STORAGE_KEY = 'atlasmind.executionOutcomes';
const MODEL_STRUGGLE_STORAGE_KEY = 'atlasmind.modelStruggleSignals';
const COPILOT_MULTIPLIER_SYNC_STORAGE_KEY = 'atlasmind.copilotMultiplierSync';
const PROVIDER_PRICING_STORAGE_KEY = 'atlasmind.providerPricing';
const PREMIUM_MULTIPLIER_OVERRIDES_SETTING = 'premiumMultiplierOverrides';
const DEFAULT_FEEDBACK_ROUTING_WEIGHT = 1;
const SSOT_MARKER_DIRECTORIES = [
  'architecture',
  'roadmap',
  'decisions',
  'domain',
  'operations',
  'agents',
  'skills',
  'index',
] as const;
const MEMORY_SELF_HEAL_INTERVAL_MS = 90_000;
const MEMORY_SELF_HEAL_DEBOUNCE_MS = 1_200;
const MEMORY_SELF_HEAL_MAX_CHANGES_PER_PASS = 12;
const MEMORY_QUARANTINE_RELATIVE_DIR = 'temp/quarantine';
/** How often the Project Director follow-up reminder timer re-evaluates. */
const PROJECT_DIRECTOR_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
/** workspaceState key holding the last day (yyyy-mm-dd) a follow-up reminder was shown. */
const PROJECT_DIRECTOR_REMINDER_KEY = 'atlasmind.projectDirector.lastReminderKey';

export function requiresExplicitProviderActivation(providerId: string): boolean {
  return providerId === 'copilot';
}

type StartupState = {
  status: 'idle' | 'booting' | 'ready' | 'failed';
  phase: string;
  detail?: string;
  startedAt: number;
};

type StoredCustomSkill = {
  source: string;
  folderPath?: string;
  scanResult?: { skillId: string; status: 'not-scanned' | 'passed' | 'failed'; scannedAt: string; issues: Array<{ rule: string; severity: 'error' | 'warning'; line: number; snippet: string; message: string }> };
};

type StoredPersonalityProfile = {
  version: 1;
  updatedAt: string;
  answers: Record<string, unknown>;
};

const PERSONALITY_PROFILE_PROMPT_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'primaryPurpose', label: 'Primary purpose' },
  { key: 'optimiseFor', label: 'Optimize for' },
  { key: 'notResponsibleFor', label: 'Not responsible for' },
  { key: 'tradeoffPriority', label: 'Trade-off priority' },
  { key: 'northStar', label: 'North star' },
  { key: 'formality', label: 'Formality' },
  { key: 'challengeStyle', label: 'Challenge style' },
  { key: 'defaultVerbosity', label: 'Default verbosity' },
  { key: 'reasoningVisibility', label: 'Reasoning visibility' },
  { key: 'alternativeBehavior', label: 'Alternatives behavior' },
  { key: 'riskTolerance', label: 'Risk tolerance' },
  { key: 'avoidTopics', label: 'Avoid topics' },
  { key: 'confirmationTriggers', label: 'Confirmation triggers' },
  { key: 'autonomyLevel', label: 'Autonomy level' },
  { key: 'safetyOverrideBehavior', label: 'Safety override behavior' },
  { key: 'guidanceDepth', label: 'Guidance depth' },
  { key: 'defaultActionBias', label: 'Default action bias' },
  { key: 'goalHorizon', label: 'Goal horizon' },
  { key: 'priorityValues', label: 'Priority values' },
  { key: 'rememberLongTerm', label: 'Remember long-term' },
  { key: 'neverStore', label: 'Never store' },
  { key: 'instructionConflictPolicy', label: 'Conflict policy' },
  { key: 'ambiguityHandling', label: 'Ambiguity handling' },
  { key: 'neverExhibit', label: 'Never exhibit' },
  { key: 'outOfScopeSuggestions', label: 'Out-of-scope suggestions' },
  { key: 'constraintViolationResponse', label: 'Constraint violation response' },
];

export interface AtlasMindContext {
  orchestrator: Orchestrator;
  dataPrivacyManager: DataPrivacyManager;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  /** Shared skill-execution context, used to dispatch MCP tool skills from panels. */
  skillContext: SkillExecutionContext;
  modelRouter: ModelRouter;
  memoryManager: MemoryManager;
  costTracker: CostTracker;
  providerRegistry: ProviderRegistry;
  skillsRefresh: vscode.EventEmitter<void>;
  agentsRefresh: vscode.EventEmitter<void>;
  modelsRefresh: vscode.EventEmitter<void>;
  scannerRulesManager: ScannerRulesManager;
  mcpServerRegistry: McpServerRegistry;
  /** Agentic Resource Discovery — finder registry, protocol client, and installer. */
  ardRegistry: ArdRegistry;
  ardClient: ArdClient;
  ardInstaller: ArdInstaller;
  discoveryRefresh: vscode.EventEmitter<void>;
  extensionContext: vscode.ExtensionContext;
  refreshProviderModels(includeInteractiveProviders?: boolean): Promise<{ providersUpdated: number; modelsAvailable: number }>;
  refreshProviderHealth(): Promise<void>;
  setProviderEnabled(providerId: ProviderId, enabled: boolean): Promise<void>;
  setModelEnabled(providerId: ProviderId, modelId: string, enabled: boolean): Promise<void>;
  isProviderConfigured(providerId: ProviderId): Promise<boolean>;
  updateAgentAllowedModels(agentId: string, allowedModels?: string[]): Promise<void>;
  getModelInfoUrl(providerId: ProviderId, modelId?: string): string | undefined;
  toolWebhookDispatcher: ToolWebhookDispatcher;
  toolApprovalManager: ToolApprovalManager;
  /** Desktop remote-control server (assigned immediately after context creation). */
  remoteControlServer?: RemoteControlServer;
  getWorkspacePolicySnapshots(): SessionPolicySnapshot[];
  voiceManager: VoiceManager;
  sessionConversation: SessionConversation;
  sessionContextManager: SessionContextManager;
  projectRunHistory: ProjectRunHistory;
  projectRunsRefresh: vscode.EventEmitter<void>;
  memoryRefresh: vscode.EventEmitter<void>;
  routineRegistry: RoutineRegistry;
  routinesRefresh: vscode.EventEmitter<void>;
  /** Deployment-stage pipeline (local → staging → production) and promotion edges. */
  deliveryManager: DeliveryManager;
  /** Fires when delivery.json changes on disk, so the dashboard can re-sync. */
  deliveryRefresh: vscode.EventEmitter<void>;
  /** People model: stakeholders, team, responsibilities, assignments, follow-ups. */
  projectDirectorManager: ProjectDirectorManager;
  /**
   * The live inbound Buzz subscription, when one exists. Present so surfaces can
   * offer the identities it has *observed* — never so they can start it.
   */
  buzzInbound?: BuzzInboundService;
  /** Fires when project-director.json changes on disk, so the dashboard can re-sync. */
  projectDirectorRefresh: vscode.EventEmitter<void>;
  /** Document filing system + the docs kept updated automatically. */
  documentsManager: DocumentsManager;
  /** Fires when documents.json changes on disk, so the dashboard can re-sync. */
  documentsRefresh: vscode.EventEmitter<void>;
  /** Ethics/legal/commercial risk register raised by the oversight advisors. */
  riskOversightManager: RiskOversightManager;
  /** Fires when risk-oversight.json changes on disk, so the dashboard can re-sync. */
  riskOversightRefresh: vscode.EventEmitter<void>;
  /** Findings from research scans about the world outside this repository. */
  researchRegisterManager: ResearchRegisterManager;
  /** Fires when research.json changes on disk, so the dashboard can re-sync. */
  researchRefresh: vscode.EventEmitter<void>;
  /** Audit trail + persistence for autonomous Mission Loop runs. */
  missionRegistry: MissionRegistry;
  rollbackLastCheckpoint(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }>;
  /**
   * Which tasks have a file snapshot, and restoring one by name.
   *
   * Beside `rollbackLastCheckpoint` because "undo the last thing" and "undo
   * *that* thing" are different questions: a chat transcript can point at a turn
   * from an hour ago, and popping the newest checkpoint would restore something
   * else entirely.
   */
  listCheckpoints(): Promise<Array<{ id: string; taskId: string; createdAt: string; fileCount: number }>>;
  rollbackCheckpointByTaskId(taskId: string): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }>;
  /** Trigger AI-based skill re-assessment for a single auto-managed agent. */
  assessAgentSkills?(agentId: string): Promise<void>;
  /** Persist prompt/description overrides for all built-in agents to globalState. */
  persistBuiltInAgentOverride?(): Promise<void>;
  /** Reset a built-in agent to its factory-default prompt and description. */
  resetBuiltInAgentPrompt?(agentId: string): Promise<void>;
}

let atlasContext: AtlasMindContext | undefined;
let atlasStartupState: StartupState = {
  status: 'idle',
  phase: 'not-started',
  startedAt: 0,
};

function loadStoredUserAgents(globalState: vscode.Memento): AgentDefinition[] {
  const raw = globalState.get<unknown[]>(USER_AGENTS_STORAGE_KEY, []);
  return raw.filter(isStoredAgentDefinition).map(item => ({ ...item, builtIn: false }));
}

function loadStoredCustomSkillFolders(globalState: vscode.Memento): string[] {
  const raw = globalState.get<unknown[]>(CUSTOM_SKILL_FOLDERS_STORAGE_KEY, []);
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function loadStoredCustomSkills(globalState: vscode.Memento): StoredCustomSkill[] {
  const raw = globalState.get<unknown[]>(CUSTOM_SKILLS_STORAGE_KEY, []);
  return raw.filter(isStoredCustomSkill);
}

function isStoredCustomSkill(item: unknown): item is StoredCustomSkill {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return typeof candidate['source'] === 'string' && candidate['source'].length > 0;
}

function isStoredPersonalityProfile(item: unknown): item is StoredPersonalityProfile {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return candidate['version'] === 1
    && typeof candidate['updatedAt'] === 'string'
    && typeof candidate['answers'] === 'object'
    && candidate['answers'] !== null;
}

function buildPersonalityProfilePrompt(workspaceState: vscode.Memento): string | undefined {
  const stored = workspaceState.get<unknown>(PERSONALITY_PROFILE_STORAGE_KEY);
  if (!isStoredPersonalityProfile(stored)) {
    return undefined;
  }

  const lines: string[] = [];
  if (stored.updatedAt.trim().length > 0) {
    lines.push(`- Updated: ${stored.updatedAt.trim()}`);
  }

  let usedChars = lines.join('\n').length;
  for (const field of PERSONALITY_PROFILE_PROMPT_FIELDS) {
    const rawValue = stored.answers[field.key];
    if (typeof rawValue !== 'string') {
      continue;
    }
    const value = rawValue.trim();
    if (!value || value === 'auto') {
      continue;
    }

    const nextLine = `- ${field.label}: ${value}`;
    if ((usedChars + nextLine.length) > 2400) {
      lines.push('- Additional saved profile preferences exist but were omitted for prompt budget.');
      break;
    }

    lines.push(nextLine);
    usedChars += nextLine.length + 1;
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

type WorkspaceIdentityPromptOptions = {
  workspaceFolders?: readonly Pick<vscode.WorkspaceFolder, 'uri'>[];
  ssotPath?: string;
  readTextFile?: (filePath: string) => string | undefined;
  toolApprovalMode?: string;
  allowTerminalWrite?: boolean;
  autopilot?: boolean;
};

export function buildWorkspaceIdentityPrompt(
  workspaceState: vscode.Memento,
  options?: WorkspaceIdentityPromptOptions,
): string | undefined {
  const sections: string[] = [];
  const personalityProfile = buildPersonalityProfilePrompt(workspaceState);
  if (personalityProfile) {
    sections.push(`Saved personality profile:\n${personalityProfile}`);
  }

  const projectSoul = buildProjectSoulPrompt(options);
  if (projectSoul) {
    sections.push(`Project soul:\n${projectSoul}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export function buildWorkspacePolicySnapshots(
  workspaceState: vscode.Memento,
  options?: WorkspaceIdentityPromptOptions,
): SessionPolicySnapshot[] {
  const snapshots: SessionPolicySnapshot[] = [];
  const personalityProfile = buildPersonalityProfilePrompt(workspaceState);
  if (personalityProfile) {
    snapshots.push({
      source: 'personality',
      label: 'Saved personality profile',
      summary: summarizeForPolicy(buildCompactLineSummary(personalityProfile), 280),
    });
  }

  const projectSoul = buildProjectSoulPrompt(options);
  if (projectSoul) {
    snapshots.push({
      source: 'project-soul',
      label: 'Project soul',
      summary: summarizeForPolicy(buildCompactLineSummary(projectSoul), 280),
    });
  }

  const approvalMode = options?.toolApprovalMode
    ?? vscode.workspace.getConfiguration('atlasmind').get<string>('toolApprovalMode', 'ask-on-write')
    ?? 'ask-on-write';
  const allowTerminalWrite = options?.allowTerminalWrite
    ?? vscode.workspace.getConfiguration('atlasmind').get<boolean>('allowTerminalWrite', false)
    ?? false;
  const autopilot = options?.autopilot ?? false;
  snapshots.push({
    source: 'safety',
    label: 'Tool approval policy',
    summary: `Approval mode ${approvalMode}; terminal writes ${allowTerminalWrite ? 'enabled' : 'blocked'}; autopilot ${autopilot ? 'enabled' : 'disabled'}.`,
  });

  return snapshots;
}

function buildProjectSoulPrompt(options?: WorkspaceIdentityPromptOptions): string | undefined {
  const soulPath = resolveProjectSoulFilePath(options);
  if (!soulPath) {
    return undefined;
  }

  const readTextFile = options?.readTextFile ?? readTextFileIfExists;
  const raw = readTextFile(soulPath);
  if (!raw) {
    return undefined;
  }

  const lines: string[] = [];
  const vision = extractMarkdownSection(raw, 'Vision');
  if (vision) {
    lines.push(`- Vision: ${summarizeForPolicy(vision, 420)}`);
  }

  const principles = extractMarkdownBulletItems(extractMarkdownSection(raw, 'Principles')).slice(0, 3);
  if (principles.length > 0) {
    lines.push(`- Principles: ${principles.join(' | ')}`);
  }

  const decisions = extractMarkdownBulletItems(extractMarkdownSection(raw, 'Key Decisions')).slice(0, 3);
  if (decisions.length > 0) {
    lines.push(`- Key decisions: ${decisions.join(' | ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function resolveProjectSoulFilePath(options?: WorkspaceIdentityPromptOptions): string | undefined {
  const workspaceFolder = options?.workspaceFolders?.[0] ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder?.uri.fsPath) {
    return undefined;
  }

  const configuredSsotPath = options?.ssotPath
    ?? vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH);
  const ssotPath = normalizeSsotPath(configuredSsotPath) ?? DEFAULT_SSOT_PATH;
  return path.join(workspaceFolder.uri.fsPath, ssotPath, 'project_soul.md');
}

function readTextFileIfExists(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function extractMarkdownSection(content: string, heading: string): string {
  const match = new RegExp(`^##\\s+${escapeForRegex(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'im').exec(content);
  return match?.[1]?.trim() ?? '';
}

function extractMarkdownBulletItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(line => /^-\s+(.+)$/.exec(line)?.[1]?.trim() ?? '')
    .filter(Boolean);
}

function summarizeForPolicy(content: string, maxChars: number): string {
  const normalized = buildCompactLineSummary(content);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildCompactLineSummary(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStoredFolderPath(folderPath: string | undefined): string[] | undefined {
  if (!folderPath) {
    return undefined;
  }

  const normalized = folderPath
    .split(/[\\/]+/)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

async function restoreStoredCustomSkills(
  globalState: vscode.Memento,
  skillsRegistry: SkillsRegistry,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  skillsRegistry.setCustomFolders(loadStoredCustomSkillFolders(globalState));

  for (const stored of loadStoredCustomSkills(globalState)) {
    try {
      const moduleUrl = `${pathToFileURL(stored.source).href}?t=${Date.now()}`;
      const mod = await import(moduleUrl) as { skill?: unknown; default?: unknown };
      const skill = (mod.skill ?? mod.default) as SkillDefinition | undefined;
      if (
        !skill ||
        typeof skill !== 'object' ||
        typeof skill.id !== 'string' ||
        typeof skill.execute !== 'function'
      ) {
        outputChannel.appendLine(`[skills] Skipping invalid stored custom skill at ${stored.source}.`);
        continue;
      }

      skillsRegistry.register({
        ...skill,
        source: stored.source,
        builtIn: false,
        panelPath: normalizeStoredFolderPath(stored.folderPath),
      });
      if (stored.scanResult) {
        skillsRegistry.setScanResult({ ...stored.scanResult, skillId: skill.id });
      }
    } catch (error) {
      outputChannel.appendLine(
        `[skills] Failed to restore custom skill ${stored.source}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function isStoredAgentDefinition(item: unknown): item is AgentDefinition {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' && candidate['id'].length > 0 &&
    typeof candidate['name'] === 'string' && candidate['name'].length > 0 &&
    typeof candidate['role'] === 'string' &&
    typeof candidate['description'] === 'string' &&
    typeof candidate['systemPrompt'] === 'string' &&
    Array.isArray(candidate['skills'])
  );
}

function readDisabledProviderIds(globalState: vscode.Memento): Set<string> {
  return new Set(globalState.get<string[]>(DISABLED_PROVIDER_IDS_STORAGE_KEY, []));
}

function readBuiltInAgentAllowedModelOverrides(globalState: vscode.Memento): Record<string, string[]> {
  const raw = globalState.get<Record<string, unknown>>(BUILTIN_AGENT_ALLOWED_MODELS_STORAGE_KEY, {});
  const overrides: Record<string, string[]> = {};
  for (const [agentId, value] of Object.entries(raw)) {
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      overrides[agentId] = value;
    }
  }
  return overrides;
}

function readDisabledModelIds(globalState: vscode.Memento): Set<string> {
  return new Set(globalState.get<string[]>(DISABLED_MODEL_IDS_STORAGE_KEY, []));
}

async function persistModelAvailabilityState(
  globalState: vscode.Memento,
  disabledProviderIds: Set<string>,
  disabledModelIds: Set<string>,
): Promise<void> {
  await globalState.update(DISABLED_PROVIDER_IDS_STORAGE_KEY, [...disabledProviderIds]);
  await globalState.update(DISABLED_MODEL_IDS_STORAGE_KEY, [...disabledModelIds]);
}

/**
 * Restore persisted subscription quotas into the model router on startup.
 * If a provider's billing period has passed its `resetsAt` timestamp, the
 * quota is reset to its `totalRequests` value so routing scores are accurate
 * from the start of the new period.
 */
function restorePersistedQuotas(globalState: vscode.Memento, modelRouter: ModelRouter): void {
  const stored = globalState.get<Record<string, unknown>>(SUBSCRIPTION_QUOTA_STORAGE_KEY, {});
  const now = new Date().toISOString();
  let retiredAcpQuota = false;
  for (const [scope, raw] of Object.entries(stored)) {
    // ACP deliberately no longer restores manually estimated allowances. The
    // protocol identifies agents and models but does not disclose a plan or a
    // trustworthy balance; treating old guesses as live capacity can suppress a
    // working subscription. Keep only its user-facing plan label elsewhere.
    if (scope === ACP_PROVIDER_ID || scope.startsWith(`${ACP_PROVIDER_ID}/`)) {
      retiredAcpQuota = true;
      continue;
    }
    if (
      typeof raw !== 'object' || raw === null ||
      typeof (raw as Record<string, unknown>)['totalRequests'] !== 'number' ||
      typeof (raw as Record<string, unknown>)['remainingRequests'] !== 'number'
    ) {
      continue;
    }
    const persisted = raw as { totalRequests: number; remainingRequests: number; resetsAt?: string; costPerRequestUnit?: number };
    // A model-scoped key (see `setModelSubscriptionQuota`) is the *only* record
    // of that plan — nothing seeds it from provider defaults the way a
    // provider-level quota is seeded — so it is restored whole rather than
    // merged onto an existing one, which for these would always be absent.
    if (isModelScopedQuotaKey(scope)) {
      const isReset = persisted.resetsAt !== undefined && persisted.resetsAt <= now;
      modelRouter.setModelSubscriptionQuota(scope, {
        ...persisted,
        remainingRequests: isReset ? persisted.totalRequests : persisted.remainingRequests,
      });
      continue;
    }
    const existing = modelRouter.getSubscriptionQuota(scope);
    if (!existing) {
      continue;
    }
    // If the billing period has rolled over, treat quota as fully refreshed.
    const isReset = persisted.resetsAt !== undefined && persisted.resetsAt <= now;
    const remainingRequests = isReset ? existing.totalRequests : persisted.remainingRequests;
    modelRouter.updateSubscriptionQuota(scope, { ...existing, remainingRequests });
  }
  if (retiredAcpQuota) {
    const retained = Object.fromEntries(
      Object.entries(stored).filter(([scope]) => scope !== ACP_PROVIDER_ID && !scope.startsWith(`${ACP_PROVIDER_ID}/`)),
    );
    void globalState.update(SUBSCRIPTION_QUOTA_STORAGE_KEY, retained);
  }
}

/**
 * Model ids are `provider/model`; provider ids never contain a slash. That is
 * what keeps one storage record able to hold both kinds of key without a
 * version bump — and what stops a provider-level quota being restored into the
 * model-scoped map, where nothing would ever read it.
 */
function isModelScopedQuotaKey(key: string): boolean {
  return key.includes('/');
}

function persistQuotas(globalState: vscode.Memento, modelRouter: ModelRouter): void {
  const snapshot: Record<string, unknown> = {};
  for (const provider of modelRouter.listProviders()) {
    if (provider.id === ACP_PROVIDER_ID) {
      continue;
    }
    const quota = modelRouter.getSubscriptionQuota(provider.id);
    if (quota) {
      snapshot[provider.id] = quota;
    }
  }
  for (const [modelId, quota] of modelRouter.listModelSubscriptionQuotas()) {
    if (modelId.startsWith(`${ACP_PROVIDER_ID}/`)) {
      continue;
    }
    snapshot[modelId] = quota;
  }
  void globalState.update(SUBSCRIPTION_QUOTA_STORAGE_KEY, snapshot);
}

/** Direction 2 — restore persisted per-model execution outcomes so learned routing survives restarts. */
function restoreExecutionOutcomes(globalState: vscode.Memento, modelRouter: ModelRouter): void {
  const stored = globalState.get<Record<string, { ewma: number; samples: number }>>(EXECUTION_OUTCOMES_STORAGE_KEY, {});
  if (stored && typeof stored === 'object') {
    modelRouter.setExecutionOutcomes(stored);
  }
}

function persistExecutionOutcomes(globalState: vscode.Memento, outcomes: Record<string, { ewma: number; samples: number }>): void {
  void globalState.update(EXECUTION_OUTCOMES_STORAGE_KEY, outcomes);
}

/** Restore persisted per-(model × task-signature) struggle de-weights so the memory survives restarts. */
function restoreModelStruggleSignals(globalState: vscode.Memento, modelRouter: ModelRouter): void {
  const stored = globalState.get<Record<string, ModelStruggleState>>(MODEL_STRUGGLE_STORAGE_KEY, {});
  if (stored && typeof stored === 'object') {
    modelRouter.setStruggleSignals(stored);
  }
}

function persistModelStruggleSignals(globalState: vscode.Memento, signals: Record<string, ModelStruggleState>): void {
  void globalState.update(MODEL_STRUGGLE_STORAGE_KEY, signals);
}

function loadCopilotMultiplierSync(globalState: vscode.Memento): MultiplierSyncResult | undefined {
  const raw = globalState.get<unknown>(COPILOT_MULTIPLIER_SYNC_STORAGE_KEY);
  if (
    raw &&
    typeof raw === 'object' &&
    'multipliers' in raw &&
    'syncedAt' in raw &&
    typeof (raw as Record<string, unknown>)['syncedAt'] === 'string'
  ) {
    return raw as MultiplierSyncResult;
  }
  return undefined;
}

function saveCopilotMultiplierSync(globalState: vscode.Memento, result: MultiplierSyncResult): void {
  void globalState.update(COPILOT_MULTIPLIER_SYNC_STORAGE_KEY, result);
}

// ── Generic provider pricing sync ─────────────────────────────────────────────

function loadAllProviderPricingSync(globalState: vscode.Memento): Map<string, ProviderPricingSyncResult> {
  const raw = globalState.get<Record<string, unknown>>(PROVIDER_PRICING_STORAGE_KEY, {});
  const map = new Map<string, ProviderPricingSyncResult>();
  for (const [id, value] of Object.entries(raw)) {
    if (
      value &&
      typeof value === 'object' &&
      'entries' in value &&
      'syncedAt' in value &&
      typeof (value as Record<string, unknown>)['syncedAt'] === 'string'
    ) {
      map.set(id, value as ProviderPricingSyncResult);
    }
  }
  return map;
}

function saveProviderPricingSync(
  globalState: vscode.Memento,
  results: Map<string, ProviderPricingSyncResult>,
): void {
  const existing = globalState.get<Record<string, unknown>>(PROVIDER_PRICING_STORAGE_KEY, {});
  const merged: Record<string, unknown> = { ...existing };
  for (const [id, result] of results) {
    merged[id] = result;
  }
  void globalState.update(PROVIDER_PRICING_STORAGE_KEY, merged);
}

/**
 * Refresh pricing for all providers that (a) are in PROVIDER_PRICING_SPECS and
 * (b) either have no cached data or have stale data.  Providers with fresh
 * cached data are returned immediately without a network request.
 * All fetches run in parallel; failures are silently ignored (stale/no data is used).
 */
async function refreshAllProviderPricingSync(
  globalState: vscode.Memento,
  activeProviderIds: string[],
  outputChannel?: vscode.OutputChannel,
): Promise<Map<string, ProviderPricingSyncResult>> {
  const cached = loadAllProviderPricingSync(globalState);

  const idsToFetch = activeProviderIds.filter(id => {
    if (!(id in PROVIDER_PRICING_SPECS)) { return false; }
    const c = cached.get(id);
    return !c || isProviderPricingStale(c);
  });

  if (idsToFetch.length === 0) {
    return cached;
  }

  outputChannel?.appendLine(
    `[providers] Fetching pricing for: ${idsToFetch.join(', ')}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let fresh: Map<string, ProviderPricingSyncResult>;
  try {
    fresh = await fetchAllProviderPricing(idsToFetch, controller.signal);
  } catch {
    fresh = new Map();
  } finally {
    clearTimeout(timeout);
  }

  // Merge fresh results into the cached map and persist
  const merged = new Map(cached);
  for (const [id, result] of fresh) {
    merged.set(id, result);
    outputChannel?.appendLine(
      `[providers] Pricing sync for ${id}: ${result.modelCount} models (source: ${result.sourceUrl})`,
    );
  }

  if (fresh.size > 0) {
    saveProviderPricingSync(globalState, fresh);
  }

  return merged;
}

function loadLocalModelSync(globalState: vscode.Memento): LocalModelSyncResult | undefined {
  const raw = globalState.get<unknown>(LOCAL_MODEL_SYNC_CACHE_KEY);
  if (raw && typeof raw === 'object' && 'models' in raw && 'syncedAt' in raw &&
      typeof (raw as Record<string, unknown>)['syncedAt'] === 'string') {
    return raw as LocalModelSyncResult;
  }
  return undefined;
}

function saveLocalModelSync(globalState: vscode.Memento, result: LocalModelSyncResult): void {
  void globalState.update(LOCAL_MODEL_SYNC_CACHE_KEY, result);
}

function readPremiumMultiplierOverrides(): Record<string, number> {
  const raw = vscode.workspace
    .getConfiguration('atlasmind')
    .get<Record<string, number>>(PREMIUM_MULTIPLIER_OVERRIDES_SETTING, {});
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && isFinite(value) && value >= 0) {
      result[key.toLowerCase()] = value;
    }
  }
  return result;
}

function applyModelAvailabilityState(
  modelRouter: ModelRouter,
  disabledProviderIds: Set<string>,
  disabledModelIds: Set<string>,
): void {
  // ACP is seeded `enabled: false` because its launch command is user-authored
  // and there is nothing to spawn until one is named. That seed does not survive
  // this function: enablement is derived purely from the persisted disabled set,
  // which on a fresh install is empty — so every provider, ACP included, came
  // back enabled. Combined with `isProviderHealthy` defaulting to `true` before
  // the first health check, an install with no configured agent could offer
  // `acp/claude` as a routing candidate and fail the turn on "No ACP agent is
  // configured".
  //
  // The condition that actually matters is not what was persisted but whether an
  // agent exists to run, so it is enforced here, at the one choke point every
  // caller passes through.
  const hasAcpAgent = (() => {
    try {
      const raw = vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents');
      return Array.isArray(raw) && raw.length > 0;
    } catch {
      return false;
    }
  })();

  for (const provider of modelRouter.listProviders()) {
    const providerEnabled = !disabledProviderIds.has(provider.id)
      && (provider.id !== 'acp' || hasAcpAgent);
    modelRouter.registerProvider({
      ...provider,
      enabled: providerEnabled,
      models: provider.models.map(model => ({
        ...model,
        enabled: providerEnabled && !disabledModelIds.has(model.id),
      })),
    });
  }
}

function applyBuiltInAgentAllowedModelOverrides(
  agentRegistry: AgentRegistry,
  overrides: Record<string, string[]>,
): void {
  for (const [agentId, allowedModels] of Object.entries(overrides)) {
    const agent = agentRegistry.get(agentId);
    if (!agent?.builtIn) {
      continue;
    }
    agentRegistry.register({
      ...agent,
      allowedModels: allowedModels.length > 0 ? [...allowedModels] : undefined,
    });
  }
}

// ── Built-in agent prompt overrides ───────────────────────────────────────────
// Parallels the allowedModels override pattern: changed systemPrompt/description/
// flags for built-in agents are stored separately and merged at startup so they
// survive extension reloads.

interface BuiltInAgentPromptOverride {
  systemPrompt: string;
  description: string;
  autoUpdateExcluded?: boolean;
  skillsAutoManaged?: boolean;
  costLimitUsd?: number;
  lastAutoUpdated?: string;
}

function readBuiltInAgentPromptOverrides(
  globalState: vscode.Memento,
): Record<string, BuiltInAgentPromptOverride> {
  const raw = globalState.get<unknown>(BUILTIN_AGENT_PROMPT_OVERRIDES_STORAGE_KEY, {});
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { return {}; }
  const result: Record<string, BuiltInAgentPromptOverride> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) { continue; }
    const v = value as Record<string, unknown>;
    if (typeof v['systemPrompt'] === 'string' && typeof v['description'] === 'string') {
      result[id] = {
        systemPrompt: v['systemPrompt'],
        description: v['description'],
        autoUpdateExcluded: typeof v['autoUpdateExcluded'] === 'boolean' ? v['autoUpdateExcluded'] : undefined,
        skillsAutoManaged: typeof v['skillsAutoManaged'] === 'boolean' ? v['skillsAutoManaged'] : undefined,
        costLimitUsd: typeof v['costLimitUsd'] === 'number' ? v['costLimitUsd'] : undefined,
        lastAutoUpdated: typeof v['lastAutoUpdated'] === 'string' ? v['lastAutoUpdated'] : undefined,
      };
    }
  }
  return result;
}

function applyBuiltInAgentPromptOverrides(
  agentRegistry: AgentRegistry,
  overrides: Record<string, BuiltInAgentPromptOverride>,
): void {
  for (const [agentId, override] of Object.entries(overrides)) {
    const agent = agentRegistry.get(agentId);
    if (!agent?.builtIn) { continue; }
    agentRegistry.register({
      ...agent,
      systemPrompt: override.systemPrompt,
      description: override.description,
      autoUpdateExcluded: override.autoUpdateExcluded,
      skillsAutoManaged: override.skillsAutoManaged,
      costLimitUsd: override.costLimitUsd,
      lastAutoUpdated: override.lastAutoUpdated,
    });
  }
}

async function persistBuiltInAgentPromptOverrides(
  globalState: vscode.Memento,
  agentRegistry: AgentRegistry,
): Promise<void> {
  const overrides: Record<string, BuiltInAgentPromptOverride> = {};
  for (const agent of agentRegistry.listAgents()) {
    if (!agent.builtIn) { continue; }
    overrides[agent.id] = {
      systemPrompt: agent.systemPrompt,
      description: agent.description,
      autoUpdateExcluded: agent.autoUpdateExcluded,
      skillsAutoManaged: agent.skillsAutoManaged,
      costLimitUsd: agent.costLimitUsd,
      lastAutoUpdated: agent.lastAutoUpdated,
    };
  }
  await globalState.update(BUILTIN_AGENT_PROMPT_OVERRIDES_STORAGE_KEY, overrides);
}

async function persistAgentAllowedModels(
  globalState: vscode.Memento,
  agentRegistry: AgentRegistry,
): Promise<void> {
  const agents = agentRegistry.listAgents();
  const userAgents = agents.filter(agent => !agent.builtIn).map(agent => ({ ...agent, builtIn: false }));
  const builtInOverrides: Record<string, string[]> = {};

  for (const agent of agents) {
    if (agent.builtIn && agent.allowedModels && agent.allowedModels.length > 0) {
      builtInOverrides[agent.id] = [...agent.allowedModels];
    }
  }

  await globalState.update(USER_AGENTS_STORAGE_KEY, userAgents);
  await globalState.update(BUILTIN_AGENT_ALLOWED_MODELS_STORAGE_KEY, builtInOverrides);
}

export function runActivationStep(
  stepName: string,
  outputChannel: vscode.OutputChannel,
  step: () => void,
): boolean {
  try {
    step();
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    outputChannel.appendLine(`[activate] ${stepName} failed: ${detail}`);
    return false;
  }
}

async function runTimedActivationStep<T>(
  stepName: string,
  outputChannel: vscode.OutputChannel,
  step: () => Promise<T> | T,
): Promise<T | undefined> {
  const startedAt = Date.now();
  atlasStartupState.status = 'booting';
  atlasStartupState.phase = stepName;
  atlasStartupState.detail = undefined;
  outputChannel.appendLine(`[activate] ${stepName} starting`);
  try {
    const result = await step();
    outputChannel.appendLine(`[activate] ${stepName} completed in ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    atlasStartupState.status = 'failed';
    atlasStartupState.phase = stepName;
    atlasStartupState.detail = detail;
    outputChannel.appendLine(`[activate] ${stepName} failed: ${detail}`);
    void vscode.window.showErrorMessage(
      `AtlasMind startup failed during ${stepName}. Check Output > AtlasMind for details.`,
    );
    return undefined;
  }
}

function runBackgroundActivationTask(
  stepName: string,
  outputChannel: vscode.OutputChannel,
  task: () => Promise<void>,
): void {
  outputChannel.appendLine(`[activate] ${stepName} queued`);
  void (async () => {
    const startedAt = Date.now();
    try {
      await task();
      outputChannel.appendLine(`[activate] ${stepName} completed in ${Date.now() - startedAt}ms`);
    } catch (error) {
      const detail = error instanceof Error ? error.stack ?? error.message : String(error);
      outputChannel.appendLine(`[activate] ${stepName} failed: ${detail}`);
    }
  })();
}

function normalizeSsotPath(input: string | undefined): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return undefined;
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return undefined;
  }

  return segments.join('/');
}

function normalizeFsPathForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

function isPathEqualToOrWithin(targetPath: string, candidateRootPath: string): boolean {
  const normalizedTarget = normalizeFsPathForComparison(targetPath);
  const normalizedRoot = normalizeFsPathForComparison(candidateRootPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function listIgnoredSsotRelativePaths(configuredSsotPath: string | undefined): string[] {
  const ignored = new Set<string>(AUTO_DISCOVERABLE_SSOT_PATHS);
  const normalizedConfiguredPath = normalizeSsotPath(configuredSsotPath);
  if (normalizedConfiguredPath) {
    ignored.add(normalizedConfiguredPath);
  }
  return [...ignored];
}

export function shouldAutoRefreshProjectMemoryForUri(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredSsotPath: string | undefined,
  candidateUri: vscode.Uri | undefined,
): boolean {
  const candidatePath = candidateUri?.fsPath;
  if (!candidatePath) {
    return false;
  }

  const workspaceRootPath = workspaceFolder.uri.fsPath;
  if (!isPathEqualToOrWithin(candidatePath, workspaceRootPath)) {
    return false;
  }

  for (const relativePath of listIgnoredSsotRelativePaths(configuredSsotPath)) {
    const ignoredRootPath = path.join(workspaceRootPath, ...relativePath.split('/'));
    if (isPathEqualToOrWithin(candidatePath, ignoredRootPath)) {
      return false;
    }
  }

  return true;
}

function isUriWithinSsotPath(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredSsotPath: string | undefined,
  candidateUri: vscode.Uri | undefined,
): boolean {
  const candidatePath = candidateUri?.fsPath;
  if (!candidatePath) {
    return false;
  }

  const normalizedConfiguredPath = normalizeSsotPath(configuredSsotPath) ?? DEFAULT_SSOT_PATH;
  const ssotRootPath = path.join(workspaceFolder.uri.fsPath, ...normalizedConfiguredPath.split('/'));
  return isPathEqualToOrWithin(candidatePath, ssotRootPath);
}

export function applyMemorySelfHealingToContent(content: string): { content: string; changed: boolean; actions: string[] } {
  let next = content;
  const actions: string[] = [];

  const withoutZeroWidth = next.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '');
  if (withoutZeroWidth !== next) {
    next = withoutZeroWidth;
    actions.push('removed hidden Unicode control characters');
  }

  const withoutInjectedComments = next.replace(/<!--[\s\S]*?(?:ignore|forget|override|instruction)[\s\S]*?-->/gi, '<!-- removed by AtlasMind memory self-heal -->');
  if (withoutInjectedComments !== next) {
    next = withoutInjectedComments;
    actions.push('neutralized suspicious HTML comments');
  }

  const redactedApiKeys = next.replace(/((?:api[_-]?key|apikey)\s*[:=]\s*['"`]?)[A-Za-z0-9_-]{20,}/gi, '$1***REDACTED***');
  if (redactedApiKeys !== next) {
    next = redactedApiKeys;
    actions.push('redacted API keys');
  }

  const redactedTokens = next.replace(/((?:token|bearer|auth[_-]?token)\s*[:=]\s*['"`]?)[A-Za-z0-9._-]{20,}/gi, '$1***REDACTED***');
  if (redactedTokens !== next) {
    next = redactedTokens;
    actions.push('redacted auth tokens');
  }

  const redactedPasswords = next.replace(/(\bpassword\s*[:=]\s*['"`]?)\S{8,}/gi, '$1***REDACTED***');
  if (redactedPasswords !== next) {
    next = redactedPasswords;
    actions.push('redacted plaintext passwords');
  }

  return {
    content: next,
    changed: next !== content,
    actions,
  };
}

function buildSelfHealBlockedStub(entry: MemoryEntry, quarantineRelativePath: string): string {
  const safeTitle = entry.title.trim().length > 0 ? entry.title.trim() : entry.path;
  return [
    `# ${safeTitle}`,
    '',
    'Tags: #memory #auto-heal #quarantined',
    '',
    'This entry was automatically quarantined by AtlasMind because the memory scanner flagged high-risk content.',
    '',
    `Original backup: ${quarantineRelativePath}`,
    '',
    'Next steps:',
    '- Review and clean the backup file manually.',
    '- Reintroduce safe content to this entry when ready.',
    '',
  ].join('\n');
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeSsotRoot(rootUri: vscode.Uri): Promise<boolean> {
  if (!await uriExists(vscode.Uri.joinPath(rootUri, 'project_soul.md'))) {
    return false;
  }

  let markerCount = 0;
  for (const marker of SSOT_MARKER_DIRECTORIES) {
    if (await uriExists(vscode.Uri.joinPath(rootUri, marker))) {
      markerCount++;
    }
  }

  return markerCount >= 3;
}

export async function resolveStartupSsotLocation(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredSsotPath: string | undefined,
): Promise<{ uri: vscode.Uri; relativePath: string } | undefined> {
  const normalizedConfiguredPath = normalizeSsotPath(configuredSsotPath);
  if (normalizedConfiguredPath) {
    const configuredUri = vscode.Uri.joinPath(workspaceFolder.uri, normalizedConfiguredPath);
    if (await uriExists(configuredUri)) {
      return { uri: configuredUri, relativePath: normalizedConfiguredPath };
    }
  }

  for (const relativePath of AUTO_DISCOVERABLE_SSOT_PATHS) {
    if (relativePath === normalizedConfiguredPath) {
      continue;
    }
    const candidateUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
    if (await looksLikeSsotRoot(candidateUri)) {
      return { uri: candidateUri, relativePath };
    }
  }

  return undefined;
}

export async function autoLoadWorkspaceSsot(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredSsotPath: string | undefined,
  memoryManager: Pick<MemoryManager, 'loadFromDisk'>,
  memoryRefresh: Pick<vscode.EventEmitter<void>, 'fire'>,
  outputChannel?: Pick<vscode.OutputChannel, 'appendLine'>,
): Promise<{ uri: vscode.Uri; relativePath: string } | undefined> {
  const resolved = await resolveStartupSsotLocation(workspaceFolder, configuredSsotPath);
  if (!resolved) {
    outputChannel?.appendLine('[activate] loadSsotFromDisk skipped: no existing MindAtlas SSOT detected in the current workspace');
    return undefined;
  }

  await memoryManager.loadFromDisk(resolved.uri);
  memoryRefresh.fire();
  const locationLabel = resolved.relativePath.length > 0 ? resolved.relativePath : '.';
  outputChannel?.appendLine(`[activate] loadSsotFromDisk loaded workspace SSOT from ${locationLabel}`);
  return resolved;
}

async function setMemoryNeedsUpdateContext(isStale: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', MEMORY_NEEDS_UPDATE_CONTEXT_KEY, isStale);
}

async function setSsotPresentContext(isPresent: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', SSOT_PRESENT_CONTEXT_KEY, isPresent);
}

function getConfiguredFeedbackRoutingWeight(): number {
  const configured = vscode.workspace.getConfiguration('atlasmind').get<number>('feedbackRoutingWeight');
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return DEFAULT_FEEDBACK_ROUTING_WEIGHT;
  }
  return Math.max(0, Math.min(2, configured));
}

async function refreshWorkspaceMemoryFreshness(
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel?: Pick<vscode.OutputChannel, 'appendLine'>,
  options?: { notify?: boolean },
): Promise<ProjectMemoryFreshnessStatus | undefined> {
  const configuredSsotPath = vscode.workspace
    .getConfiguration('atlasmind')
    .get<string>('ssotPath', DEFAULT_SSOT_PATH);
  const resolvedSsot = await resolveStartupSsotLocation(workspaceFolder, configuredSsotPath);
  if (!resolvedSsot) {
    await setSsotPresentContext(false);
    await setMemoryNeedsUpdateContext(false);
    outputChannel?.appendLine('[activate] memoryFreshness skipped: no workspace SSOT detected');
    return undefined;
  }

  const { getProjectMemoryFreshness } = await import('./bootstrap/bootstrapper.js');
  const status = await getProjectMemoryFreshness(workspaceFolder.uri);
  await setSsotPresentContext(true);
  await setMemoryNeedsUpdateContext(status.isStale);

  if (!status.hasImportedEntries) {
    outputChannel?.appendLine('[activate] memoryFreshness skipped: no imported SSOT entries found');
    return status;
  }

  if (!status.isStale) {
    outputChannel?.appendLine('[activate] memoryFreshness current: imported SSOT matches the workspace');
    return status;
  }

  outputChannel?.appendLine(
    `[activate] memoryFreshness stale: ${status.staleEntryCount} imported entr${status.staleEntryCount === 1 ? 'y' : 'ies'} need refresh`,
  );

  if (!options?.notify) {
    return status;
  }

  const lastImportedNote = status.lastImportedAt
    ? ` Last import: ${status.lastImportedAt}.`
    : '';
  const selection = await vscode.window.showWarningMessage(
    `AtlasMind project memory is out of date. ${status.staleEntryCount} imported entr${status.staleEntryCount === 1 ? 'y no longer matches' : 'ies no longer match'} the current workspace.${lastImportedNote}`,
    'Update Memory',
  );
  if (selection === 'Update Memory') {
    await vscode.commands.executeCommand('atlasmind.updateProjectMemory');
  }

  return status;
}

/**
 * Whether to automatically re-import stale imported SSOT entries on activation /
 * file changes. Default off: the re-import is an expensive LLM re-summarization of
 * every stale entry, so running it on every launch is slow and costly. When off,
 * the freshness check still flags staleness (via `setMemoryNeedsUpdateContext`), so
 * the "Update Memory" affordance is surfaced for an explicit, on-demand refresh.
 */
function isStaleMemoryAutoRefreshEnabled(): boolean {
  return vscode.workspace.getConfiguration('atlasmind').get<boolean>('autoRefreshStaleMemory', false);
}

async function autoRefreshProjectMemoryIfStale(
  workspaceFolder: vscode.WorkspaceFolder,
  atlas: AtlasMindContext,
  outputChannel: Pick<vscode.OutputChannel, 'appendLine'>,
  reason: string,
): Promise<boolean> {
  const status = await refreshWorkspaceMemoryFreshness(workspaceFolder, outputChannel);
  if (!status?.hasImportedEntries || !status.isStale) {
    return false;
  }

  outputChannel.appendLine(
    `[activate] memoryFreshness auto-refresh starting after ${reason}; ${status.staleEntryCount} imported entr${status.staleEntryCount === 1 ? 'y is' : 'ies are'} stale`,
  );

  const { importProject } = await import('./bootstrap/bootstrapper.js');
  const result = await importProject(workspaceFolder.uri, atlas);
  outputChannel.appendLine(
    `[activate] memoryFreshness auto-refresh completed: ${result.entriesCreated} created, ${result.entriesSkipped} skipped`,
  );

  const refreshedStatus = await refreshWorkspaceMemoryFreshness(workspaceFolder, outputChannel);
  if (refreshedStatus?.isStale) {
    outputChannel.appendLine(
      `[activate] memoryFreshness auto-refresh incomplete: ${refreshedStatus.staleEntryCount} imported entr${refreshedStatus.staleEntryCount === 1 ? 'y remains stale' : 'ies remain stale'}`,
    );
  }

  return true;
}

async function runMemorySelfHealingPass(
  workspaceFolder: vscode.WorkspaceFolder,
  atlas: AtlasMindContext,
  outputChannel: Pick<vscode.OutputChannel, 'appendLine'>,
  reason: string,
): Promise<{ changedEntries: number; warnedRemaining: number; blockedRemaining: number }> {
  const configuredSsotPath = vscode.workspace
    .getConfiguration('atlasmind')
    .get<string>('ssotPath', DEFAULT_SSOT_PATH);
  const resolvedSsot = await resolveStartupSsotLocation(workspaceFolder, configuredSsotPath);
  if (!resolvedSsot) {
    return { changedEntries: 0, warnedRemaining: 0, blockedRemaining: 0 };
  }

  const scanResults = atlas.memoryManager.getScanResults();
  const warnedEntries = [...scanResults.values()].filter(result => result.status === 'warned');
  const blockedEntries = [...scanResults.values()].filter(result => result.status === 'blocked');

  if (warnedEntries.length === 0 && blockedEntries.length === 0) {
    return { changedEntries: 0, warnedRemaining: 0, blockedRemaining: 0 };
  }

  outputChannel.appendLine(
    `[activate] memorySelfHeal pass starting after ${reason}; ${warnedEntries.length} warned, ${blockedEntries.length} blocked`,
  );

  const entryMap = new Map(atlas.memoryManager.listEntries().map(entry => [entry.path, entry]));
  let changedEntries = 0;

  for (const blocked of blockedEntries) {
    if (changedEntries >= MEMORY_SELF_HEAL_MAX_CHANGES_PER_PASS) {
      break;
    }
    const entry = entryMap.get(blocked.path);
    if (!entry) {
      continue;
    }

    const fileUri = vscode.Uri.joinPath(resolvedSsot.uri, entry.path);
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(fileUri);
    } catch {
      continue;
    }

    const backupName = `${entry.path.replace(/[\\/]+/g, '__')}.${Date.now()}.blocked.txt.bak`;
    const quarantineUri = vscode.Uri.joinPath(resolvedSsot.uri, MEMORY_QUARANTINE_RELATIVE_DIR, backupName);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(resolvedSsot.uri, MEMORY_QUARANTINE_RELATIVE_DIR));
    await vscode.workspace.fs.writeFile(quarantineUri, raw);

    const quarantineRelativePath = `${MEMORY_QUARANTINE_RELATIVE_DIR}/${backupName}`;
    const sanitized = buildSelfHealBlockedStub(entry, quarantineRelativePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(sanitized, 'utf-8'));
    changedEntries += 1;
  }

  for (const warned of warnedEntries) {
    if (changedEntries >= MEMORY_SELF_HEAL_MAX_CHANGES_PER_PASS) {
      break;
    }

    if (blockedEntries.some(result => result.path === warned.path)) {
      continue;
    }

    const entry = entryMap.get(warned.path);
    if (!entry) {
      continue;
    }

    const fileUri = vscode.Uri.joinPath(resolvedSsot.uri, entry.path);
    let content: string;
    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      content = Buffer.from(raw).toString('utf-8');
    } catch {
      continue;
    }

    const healed = applyMemorySelfHealingToContent(content);
    if (!healed.changed) {
      continue;
    }

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(healed.content, 'utf-8'));
    changedEntries += 1;
  }

  if (changedEntries === 0) {
    outputChannel.appendLine('[activate] memorySelfHeal pass completed: no safe automatic fixes available');
    return {
      changedEntries: 0,
      warnedRemaining: warnedEntries.length,
      blockedRemaining: blockedEntries.length,
    };
  }

  await atlas.memoryManager.loadFromDisk(resolvedSsot.uri);
  atlas.sessionContextManager.setSsotRoot(resolvedSsot.uri);
  atlas.memoryRefresh.fire();
  await refreshWorkspaceMemoryFreshness(workspaceFolder, outputChannel);

  const refreshedScanResults = atlas.memoryManager.getScanResults();
  const warnedRemaining = [...refreshedScanResults.values()].filter(result => result.status === 'warned').length;
  const blockedRemaining = [...refreshedScanResults.values()].filter(result => result.status === 'blocked').length;

  outputChannel.appendLine(
    `[activate] memorySelfHeal pass completed: ${changedEntries} entr${changedEntries === 1 ? 'y' : 'ies'} remediated; ${warnedRemaining} warned, ${blockedRemaining} blocked remain`,
  );

  return { changedEntries, warnedRemaining, blockedRemaining };
}

function registerMemorySelfHealing(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
): void {
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let healInFlight = false;
  let queuedReason: string | undefined;

  const scheduleSelfHeal = (reason: string): void => {
    queuedReason = reason;

    if (debounceHandle) {
      clearTimeout(debounceHandle);
    }

    debounceHandle = setTimeout(() => {
      debounceHandle = undefined;
      if (healInFlight) {
        return;
      }

      const atlas = atlasContext;
      if (!atlas) {
        return;
      }

      const runReason = queuedReason ?? 'memory health check';
      queuedReason = undefined;
      healInFlight = true;
      void runMemorySelfHealingPass(workspaceFolder, atlas, outputChannel, runReason)
        .catch(error => {
          const detail = error instanceof Error ? error.stack ?? error.message : String(error);
          outputChannel.appendLine(`[activate] memorySelfHeal failed: ${detail}`);
        })
        .finally(() => {
          healInFlight = false;
          if (queuedReason) {
            scheduleSelfHeal(queuedReason);
          }
        });
    }, MEMORY_SELF_HEAL_DEBOUNCE_MS);
  };

  const periodicHandle = setInterval(() => {
    scheduleSelfHeal('periodic memory health check');
  }, MEMORY_SELF_HEAL_INTERVAL_MS);

  context.subscriptions.push({
    dispose: () => {
      if (debounceHandle) {
        clearTimeout(debounceHandle);
      }
      clearInterval(periodicHandle);
    },
  });

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    const configuredSsotPath = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH);
    if (!isUriWithinSsotPath(workspaceFolder, configuredSsotPath, document.uri)) {
      return;
    }
    scheduleSelfHeal('ssot save');
  }));
  context.subscriptions.push(vscode.workspace.onDidCreateFiles(event => {
    const configuredSsotPath = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH);
    if (!event.files.some(file => isUriWithinSsotPath(workspaceFolder, configuredSsotPath, file))) {
      return;
    }
    scheduleSelfHeal('ssot create');
  }));
  context.subscriptions.push(vscode.workspace.onDidRenameFiles(event => {
    const configuredSsotPath = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', DEFAULT_SSOT_PATH);
    if (!event.files.some(change => isUriWithinSsotPath(workspaceFolder, configuredSsotPath, change.oldUri) || isUriWithinSsotPath(workspaceFolder, configuredSsotPath, change.newUri))) {
      return;
    }
    scheduleSelfHeal('ssot rename');
  }));

  scheduleSelfHeal('startup memory health check');
}

function registerProjectMemoryAutoRefresh(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
): void {
  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  let workspaceChangeGeneration = 0;
  let lastAttemptedGeneration = 0;
  let refreshInFlight = false;

  const scheduleAutoRefreshCheck = (reason: string, uris: readonly vscode.Uri[]): void => {
    const configuredSsotPath = vscode.workspace
      .getConfiguration('atlasmind')
      .get<string>('ssotPath', DEFAULT_SSOT_PATH);
    if (!uris.some(uri => shouldAutoRefreshProjectMemoryForUri(workspaceFolder, configuredSsotPath, uri))) {
      return;
    }

    workspaceChangeGeneration += 1;
    const scheduledGeneration = workspaceChangeGeneration;

    if (debounceHandle) {
      clearTimeout(debounceHandle);
    }

    debounceHandle = setTimeout(() => {
      debounceHandle = undefined;
      if (refreshInFlight || scheduledGeneration <= lastAttemptedGeneration) {
        return;
      }

      const atlas = atlasContext;
      if (!atlas) {
        return;
      }

      if (!isStaleMemoryAutoRefreshEnabled()) {
        outputChannel.appendLine('[activate] memoryFreshness auto-refresh disabled (atlasmind.autoRefreshStaleMemory=false); memory marked stale — use the Update Memory action to refresh on demand.');
        return;
      }
      refreshInFlight = true;
      lastAttemptedGeneration = scheduledGeneration;
      void autoRefreshProjectMemoryIfStale(workspaceFolder, atlas, outputChannel, reason)
        .catch(error => {
          const detail = error instanceof Error ? error.stack ?? error.message : String(error);
          outputChannel.appendLine(`[activate] memoryFreshness auto-refresh failed: ${detail}`);
        })
        .finally(() => {
          refreshInFlight = false;
        });
    }, 750);
  };

  context.subscriptions.push({
    dispose: () => {
      if (debounceHandle) {
        clearTimeout(debounceHandle);
      }
    },
  });

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
    scheduleAutoRefreshCheck('workspace save', [document.uri]);
  }));
  context.subscriptions.push(vscode.workspace.onDidCreateFiles(event => {
    scheduleAutoRefreshCheck('workspace create', event.files);
  }));
  context.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => {
    scheduleAutoRefreshCheck('workspace delete', event.files);
  }));
  context.subscriptions.push(vscode.workspace.onDidRenameFiles(event => {
    scheduleAutoRefreshCheck(
      'workspace rename',
      event.files.flatMap(change => [change.oldUri, change.newUri]),
    );
  }));
}

function getStartupStatusMessage(): string {
  if (atlasStartupState.status === 'failed') {
    return `AtlasMind startup failed during ${atlasStartupState.phase}. Check Output > AtlasMind for details.`;
  }
  if (atlasStartupState.status === 'ready') {
    return 'AtlasMind is ready.';
  }
  return `AtlasMind is still starting (${atlasStartupState.phase}). Check Output > AtlasMind for progress.`;
}

async function bootstrapAtlasMind(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  const commandsModule = await runTimedActivationStep('importCommands', outputChannel, () =>
    import('./commands.js'),
  );
  if (!commandsModule) {
    return;
  }

  const registeredCommands = await runTimedActivationStep('registerCommands', outputChannel, async () => {
    commandsModule.registerCommands(context, () => atlasContext, getStartupStatusMessage);
  });
  if (registeredCommands === undefined && atlasStartupState.status === 'failed') {
    return;
  }

  const startupModules = await runTimedActivationStep('importStartupModules', outputChannel, async () => {
    const [
      chatParticipantModule,
      treeViewsModule,
      providersModule,
      skillsModule,
      orchestratorModule,
      agentRegistryModule,
      skillsRegistryModule,
      modelRouterModule,
      memoryManagerModule,
      costTrackerModule,
      scannerRulesManagerModule,
      toolWebhookDispatcherModule,
      taskProfilerModule,
      mcpServerRegistryModule,
      checkpointManagerModule,
      projectRunHistoryModule,
      voiceManagerModule,
      sessionConversationModule,
      sessionContextManagerModule,
      memoryAgentModule,
      agentAutoUpdaterModule,
      skillAutoAssignerModule,
      runtimeCoreModule,
      toolPolicyModule,
      routineRegistryModule,
      deliveryManagerModule,
      projectDirectorManagerModule,
      documentsManagerModule,
      riskOversightManagerModule,
      researchRegisterModule,
      followUpSchedulerModule,
      missionRegistryModule,
      dataPrivacyModule,
      ardClientModule,
      ardRegistryModule,
      ardInstallerModule,
      localModelArbiterModule,
      gpuProbeModule,
      localRuntimeClientModule
    ] = await Promise.all([
      import('./chat/participant.js'),
      import('./views/treeViews.js'),
      import('./providers/index.js'),
      import('./skills/index.js'),
      import('./core/orchestrator.js'),
      import('./core/agentRegistry.js'),
      import('./core/skillsRegistry.js'),
      import('./core/modelRouter.js'),
      import('./memory/memoryManager.js'),
      import('./core/costTracker.js'),
      import('./core/scannerRulesManager.js'),
      import('./core/toolWebhookDispatcher.js'),
      import('./core/taskProfiler.js'),
      import('./mcp/mcpServerRegistry.js'),
      import('./core/checkpointManager.js'),
      import('./core/projectRunHistory.js'),
      import('./voice/voiceManager.js'),
      import('./chat/sessionConversation.js'),
      import('./memory/sessionContextManager.js'),
      import('./memory/memoryAgent.js'),
      import('./core/agentAutoUpdater.js'),
      import('./core/skillAutoAssigner.js'),
      import('./runtime/core.js'),
      import('./core/toolPolicy.js'),
      import('./core/routineRegistry.js'),
      import('./core/deliveryManager.js'),
      import('./core/projectDirectorManager.js'),
      import('./core/documentsManager.js'),
      import('./core/riskOversightManager.js'),
      import('./core/researchRegister.js'),
      import('./core/followUpScheduler.js'),
      import('./core/missionRegistry.js'),
      import('./core/dataPrivacyManager.js'),
      import('./ard/ardClient.js'),
      import('./ard/ardRegistry.js'),
      import('./ard/ardInstaller.js'),
      import('./core/localModelArbiter.js'),
      import('./providers/gpuProbe.js'),
      import('./providers/localRuntimeClient.js'),
    ]);

    return {
      registerChatParticipant: chatParticipantModule.registerChatParticipant,
      registerTreeViews: treeViewsModule.registerTreeViews,
      AnthropicAdapter: providersModule.AnthropicAdapter,
      BedrockAdapter: providersModule.BedrockAdapter,
      AcpAdapter: providersModule.AcpAdapter,
      parseAcpAgentSettings: providersModule.parseAcpAgentSettings,
      isAcpConsoleModeChosen: providersModule.isAcpConsoleModeChosen,
      acpToolRisk: providersModule.acpToolRisk,
      describeAcpToolCall: providersModule.describeAcpToolCall,
      selectAcpMcpServers: providersModule.selectAcpMcpServers,
      BEDROCK_ACCESS_KEY_SECRET: providersModule.BEDROCK_ACCESS_KEY_SECRET,
      BEDROCK_SECRET_KEY_SECRET: providersModule.BEDROCK_SECRET_KEY_SECRET,
      getConfiguredBedrockModelIds: providersModule.getConfiguredBedrockModelIds,
      getConfiguredBedrockRegion: providersModule.getConfiguredBedrockRegion,
      CopilotAdapter: providersModule.CopilotAdapter,
      getConfiguredLocalBaseUrl: providersModule.getConfiguredLocalBaseUrl,
      getConfiguredLocalEndpoints: providersModule.getConfiguredLocalEndpoints,
      LocalEchoAdapter: providersModule.LocalEchoAdapter,
      LocalModelArbiter: localModelArbiterModule.LocalModelArbiter,
      createCachedGpuProbe: gpuProbeModule.createCachedGpuProbe,
      createRuntimeClientForEndpoint: localRuntimeClientModule.createRuntimeClientForEndpoint,
      OpenAiCompatibleAdapter: providersModule.OpenAiCompatibleAdapter,
      OpenRouterAdapter: providersModule.OpenRouterAdapter,
      ProviderRegistry: providersModule.ProviderRegistry,
      createBuiltinSkills: skillsModule.createBuiltinSkills,
      Orchestrator: orchestratorModule.Orchestrator,
      AgentRegistry: agentRegistryModule.AgentRegistry,
      SkillsRegistry: skillsRegistryModule.SkillsRegistry,
      ModelRouter: modelRouterModule.ModelRouter,
      MemoryManager: memoryManagerModule.MemoryManager,
      CostTracker: costTrackerModule.CostTracker,
      ScannerRulesManager: scannerRulesManagerModule.ScannerRulesManager,
      ToolWebhookDispatcher: toolWebhookDispatcherModule.ToolWebhookDispatcher,
      TaskProfiler: taskProfilerModule.TaskProfiler,
      McpServerRegistry: mcpServerRegistryModule.McpServerRegistry,
      CheckpointManager: checkpointManagerModule.CheckpointManager,
      ProjectRunHistory: projectRunHistoryModule.ProjectRunHistory,
      VoiceManager: voiceManagerModule.VoiceManager,
      SessionConversation: sessionConversationModule.SessionConversation,
      SessionContextManager: sessionContextManagerModule.SessionContextManager,
      MemoryAgentExecutor: memoryAgentModule.MemoryAgentExecutor,
      AgentAutoUpdater: agentAutoUpdaterModule.AgentAutoUpdater,
      SkillAutoAssigner: skillAutoAssignerModule.SkillAutoAssigner,
      createAtlasRuntime: runtimeCoreModule.createAtlasRuntime,
      BUILTIN_AGENT_DEFAULTS: runtimeCoreModule.BUILTIN_AGENT_DEFAULTS,
      classifyToolInvocation: toolPolicyModule.classifyToolInvocation,
      getToolApprovalMode: toolPolicyModule.getToolApprovalMode,
      requiresToolApproval: toolPolicyModule.requiresToolApproval,
      RoutineRegistry: routineRegistryModule.RoutineRegistry,
      DeliveryManager: deliveryManagerModule.DeliveryManager,
      ProjectDirectorManager: projectDirectorManagerModule.ProjectDirectorManager,
      DocumentsManager: documentsManagerModule.DocumentsManager,
      RiskOversightManager: riskOversightManagerModule.RiskOversightManager,
      ResearchRegisterManager: researchRegisterModule.ResearchRegisterManager,
      FollowUpScheduler: followUpSchedulerModule.FollowUpScheduler,
      MissionRegistry: missionRegistryModule.MissionRegistry,
      DataPrivacyManager: dataPrivacyModule.DataPrivacyManager,
      readDataPrivacyConfig: dataPrivacyModule.readDataPrivacyConfig,
      ArdClient: ardClientModule.ArdClient,
      ArdRegistry: ardRegistryModule.ArdRegistry,
      ArdInstaller: ardInstallerModule.ArdInstaller,
      createDiscoverResourcesSkill: skillsModule.createDiscoverResourcesSkill,
    };
  });
  if (!startupModules) {
    return;
  }

  const coreReady = await runTimedActivationStep('buildAtlasContext', outputChannel, async () => {
    const costTracker = new startupModules.CostTracker();
    costTracker.attachStorage(context.globalState);
    const memoryManager = new startupModules.MemoryManager();
    const skillsRefresh = new vscode.EventEmitter<void>();
    const agentsRefresh = new vscode.EventEmitter<void>();
    const modelsRefresh = new vscode.EventEmitter<void>();
    const projectRunsRefresh = new vscode.EventEmitter<void>();
    const memoryRefresh = new vscode.EventEmitter<void>();
    const discoveryRefresh = new vscode.EventEmitter<void>();
    const deliveryRefresh = new vscode.EventEmitter<void>();
    const projectDirectorRefresh = new vscode.EventEmitter<void>();
    const documentsRefresh = new vscode.EventEmitter<void>();
    const riskOversightRefresh = new vscode.EventEmitter<void>();
    const researchRefresh = new vscode.EventEmitter<void>();
    const scannerRulesManager = new startupModules.ScannerRulesManager(context.globalState);
    const toolWebhookDispatcher = new startupModules.ToolWebhookDispatcher(context, outputChannel);
    const voiceManager = new startupModules.VoiceManager(context.secrets, undefined, {
      storageDir: context.globalStorageUri.fsPath,
    });
    const sessionConversation = new startupModules.SessionConversation(context.workspaceState);
    // Completer is wired after orchestrator is ready — assigned via closure below.
    let maintenanceCompleter: import('./memory/sessionContextManager.js').MaintenanceCompleter =
      () => Promise.resolve('');
    const sessionContextManager = new startupModules.SessionContextManager(
      (sys: string, user: string) => maintenanceCompleter(sys, user),
    );
    const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const routinesRefresh = new vscode.EventEmitter<void>();
    const routineRegistry = new startupModules.RoutineRegistry();
    if (workspaceRootPath) {
      void routineRegistry.reload(workspaceRootPath);
    }
    const deliveryManager = new startupModules.DeliveryManager(workspaceRootPath);
    if (workspaceRootPath) {
      // Keep the Delivery dashboard current when delivery.json changes outside the
      // dashboard editor (hand edits, a teammate's change via git pull, a script).
      const deliveryWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRootPath, 'project_memory/operations/delivery.json'),
      );
      const reloadDelivery = () => { deliveryManager.reload(); deliveryRefresh.fire(); };
      deliveryWatcher.onDidChange(reloadDelivery);
      deliveryWatcher.onDidCreate(reloadDelivery);
      deliveryWatcher.onDidDelete(reloadDelivery);
      context.subscriptions.push(deliveryWatcher);
    }
    const projectDirectorManager = new startupModules.ProjectDirectorManager(workspaceRootPath);
    if (workspaceRootPath) {
      // Keep the Director dashboard current when project-director.json changes
      // outside the dashboard editor (hand edits, a teammate's change via git pull).
      const directorWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRootPath, 'project_memory/operations/project-director.json'),
      );
      const reloadDirector = () => { projectDirectorManager.reload(); projectDirectorRefresh.fire(); };
      directorWatcher.onDidChange(reloadDirector);
      directorWatcher.onDidCreate(reloadDirector);
      directorWatcher.onDidDelete(reloadDirector);
      context.subscriptions.push(directorWatcher);
    }
    const documentsManager = new startupModules.DocumentsManager(workspaceRootPath);
    if (workspaceRootPath) {
      // Keep the Documents dashboard current when documents.json changes outside
      // the dashboard editor (hand edits, a teammate's change via git pull).
      const documentsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRootPath, 'project_memory/operations/documents.json'),
      );
      const reloadDocuments = () => { documentsManager.reload(); documentsRefresh.fire(); };
      documentsWatcher.onDidChange(reloadDocuments);
      documentsWatcher.onDidCreate(reloadDocuments);
      documentsWatcher.onDidDelete(reloadDocuments);
      context.subscriptions.push(documentsWatcher);
    }
    const riskOversightManager = new startupModules.RiskOversightManager(workspaceRootPath);
    if (workspaceRootPath) {
      // Keep the Risk dashboard current when risk-oversight.json changes outside the
      // dashboard (hand edits to a finding's status, a teammate's change via git pull).
      const riskWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRootPath, 'project_memory/operations/risk-oversight.json'),
      );
      const reloadRisk = () => { riskOversightManager.reload(); riskOversightRefresh.fire(); };
      riskWatcher.onDidChange(reloadRisk);
      riskWatcher.onDidCreate(reloadRisk);
      riskWatcher.onDidDelete(reloadRisk);
      context.subscriptions.push(riskWatcher);
    }
    const researchRegisterManager = new startupModules.ResearchRegisterManager(workspaceRootPath);
    if (workspaceRootPath) {
      // The register is committed, so a teammate's `git pull` is a normal way for
      // it to change under a running editor.
      const researchWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRootPath, 'project_memory/analysis/research.json'),
      );
      const reloadResearch = () => { researchRegisterManager.reload(); researchRefresh.fire(); };
      researchWatcher.onDidChange(reloadResearch);
      researchWatcher.onDidCreate(reloadResearch);
      researchWatcher.onDidDelete(reloadResearch);
      context.subscriptions.push(researchWatcher);
    }
    // Follow-up reminders (notification-only, deny-by-default). Nudges once per
    // day when follow-ups are due/overdue, opening the Director tab on click. The
    // recurring timer runs only while the project has reminders enabled; a single
    // startup nudge fires when `nudgeOnActivation` is on (both default from config).
    const followUpScheduler = new startupModules.FollowUpScheduler({
      getConfig: () => projectDirectorManager.getConfig(),
      getLastReminderKey: () => context.workspaceState.get<string>(PROJECT_DIRECTOR_REMINDER_KEY),
      setLastReminderKey: (key: string) => { void context.workspaceState.update(PROJECT_DIRECTOR_REMINDER_KEY, key); },
      notify: (message: string) => {
        void vscode.window.showInformationMessage(message, 'Open Project Director').then(choice => {
          if (choice === 'Open Project Director') {
            void vscode.commands.executeCommand('atlasmind.openProjectDirector');
          }
        });
      },
    });
    if (projectDirectorManager.getConfig()?.settings.nudgeOnActivation !== false) {
      followUpScheduler.runOnce();
    }
    const followUpReminderTimer = setInterval(() => {
      if (projectDirectorManager.getConfig()?.settings.remindersEnabled === true) {
        try { followUpScheduler.runOnce(); } catch { /* best-effort */ }
      }
    }, PROJECT_DIRECTOR_REMINDER_INTERVAL_MS);
    context.subscriptions.push({ dispose: () => { followUpScheduler.dispose(); clearInterval(followUpReminderTimer); } });
    const missionRegistry = new startupModules.MissionRegistry(workspaceRootPath);
    const projectRunHistory = new startupModules.ProjectRunHistory(context.workspaceState, {
      workspaceKey: workspaceRootPath,
      legacyState: context.globalState,
    });
    projectRunHistory.enableDiskStorage(
      vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, 'project-runs').fsPath,
    );
    const checkpointManager = workspaceRootPath
      ? new startupModules.CheckpointManager(workspaceRootPath, context.globalStorageUri.fsPath)
      : undefined;
    const skillContext = buildSkillExecutionContext(memoryManager, memoryRefresh, checkpointManager, context.secrets);
    // Resolved once the registries further down exist. The ACP gate is only ever
    // consulted during a live turn, long after activation finishes — but until
    // it is assigned it denies, so a startup failure cannot leave an agent
    // running unsupervised.
    let acpAuthorize: ((request: import('./providers/acpProtocol.js').AcpPermissionRequest) => Promise<boolean>) | undefined;
    let acpMcpServers: () => import('./providers/acpProtocol.js').AcpMcpServer[] = () => [];
    // A private Windows desktop cannot have a meaningful taskbar button on the
    // user's input desktop. Instead, disclose the real state in VS Code itself
    // while it is active: present, clickable, and never focus-stealing.
    const acpPrivateDesktopStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      51,
    );
    acpPrivateDesktopStatusBar.command = 'atlasmind.openModelProviders';
    context.subscriptions.push(acpPrivateDesktopStatusBar);
    const updateAcpPrivateDesktopStatusBar = (summary: { privateDesktop: number }) => {
      if (summary.privateDesktop <= 0) {
        acpPrivateDesktopStatusBar.hide();
        return;
      }
      const count = summary.privateDesktop;
      acpPrivateDesktopStatusBar.text = `$(eye-closed) ACP private desktop: ${count}`;
      acpPrivateDesktopStatusBar.tooltip = `${count} active ACP session${count === 1 ? '' : 's'} runs on a private Windows desktop. `
        + 'This changes window visibility, not process permissions. Click to open Models & Providers.';
      acpPrivateDesktopStatusBar.show();
    };

    // ── Local GPU arbiter ──────────────────────────────────────────────────
    // Two local runtimes can share one graphics card, and neither can see the
    // other's loads or reserve anything for the desktop. The arbiter admits
    // AtlasMind's own local calls against a measured budget. The adapter takes
    // it as an optional dependency, so absent means exactly today's behaviour.
    const localModelArbiter = new startupModules.LocalModelArbiter({
      probeGpu: startupModules.createCachedGpuProbe(),
      runtimeClientFor: (_endpointId: string, baseUrl: string) =>
        startupModules.createRuntimeClientForEndpoint(baseUrl),
      onLog: (message: string) => outputChannel.appendLine(`[local-gpu] ${message}`),
    });
    localModelArbiter.applyConfig(readLocalGpuConfig());
    context.subscriptions.push(
      { dispose: () => localModelArbiter.dispose() },
      // Dedicated listener, matching the presence pattern: the arbiter exists
      // before the full context does, so its settings must apply without it.
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('atlasmind.localGpu')) {
          localModelArbiter.applyConfig(readLocalGpuConfig());
        }
      }),
    );

    const providerAdapters = [
      new startupModules.LocalEchoAdapter({
        secrets: context.secrets,
        getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
        getBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
        arbiter: localModelArbiter,
      }),
      // ACP agents are user-authored and deny-by-default: with no configured
      // agent the adapter reports no models and never spawns anything.
      new startupModules.AcpAdapter({
        // The routed adapter is the ACP host for this VS Code window. A live
        // session is reused only while its transcript and launch/security
        // fingerprint still match; setup probes use separate one-shot adapters.
        keepAlive: true,
        consoleModeChosen: () => {
          const inspected = vscode.workspace.getConfiguration('atlasmind')
            .inspect<boolean>('acp.hideConsoleWindows');
          return startupModules.isAcpConsoleModeChosen(process.platform, [
            inspected?.workspaceFolderValue,
            inspected?.workspaceValue,
            inspected?.globalValue,
          ]);
        },
        hideConsoleWindows: () => vscode.workspace.getConfiguration('atlasmind')
          .get<boolean>('acp.hideConsoleWindows', false),
        // Read on every use, not captured once. This adapter lives as long as
        // the extension host, so a snapshot here meant an agent added to
        // settings after activation was invisible to routing and to the health
        // check until a window reload — while every other ACP surface, which
        // builds its own adapter per call, already knew about it.
        agents: () => startupModules.parseAcpAgentSettings(
          vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents'),
        ),
        // Where the user says each model sits when AtlasMind cannot tell. Read
        // per use for the same reason `agents` is: teaching it about a model
        // shipped this morning must not need a window reload.
        modelStanding: () => vscode.workspace.getConfiguration('atlasmind')
          .get<Record<string, string>>('acp.modelStanding') ?? {},
        ...(workspaceRootPath ? { cwd: workspaceRootPath } : {}),
        clientVersion: context.extension?.packageJSON?.version ?? '0.0.0',
        // Delegated execution is authorized only for a routed tool-backed turn:
        // the adapter requires the live setting and the per-request stamp before
        // an ACP operation can reach this final, live-setting gate.
        permissionPolicy: async request => (acpAuthorize ? acpAuthorize(request) : false),
        delegatedExecutionEnabled: () => vscode.workspace.getConfiguration('atlasmind')
          .get<boolean>('acp.toolsEnabled', false),
        getMcpServers: () => acpMcpServers(),
        // What the agent actually did, as it does it. Approval covers what may
        // run; this is the record of what ran, which is the half you need after
        // the fact rather than before it.
        onToolEvent: event => {
          outputChannel.appendLine(
            `[acp] ${event.isUpdate ? 'tool update' : 'tool call'} (${event.status}): ${startupModules.describeAcpToolCall(event)}`,
          );
        },
        // Said out loud rather than absorbed: the router priced this turn at the
        // requested tier's multiplier, so a silent fallback to the agent's
        // default would bill high effort for a low-effort run.
        onEffortNotApplied: event => {
          outputChannel.appendLine(
            `[acp] ${event.agentId}: could not set "${event.requested}" effort — ${event.reason}. `
            + 'The turn ran at the agent\'s own default.',
          );
        },
        onProcessLaunch: event => {
          outputChannel.appendLine(
            `[acp] launch boundary: ${event.agentId} started in ${event.mode} mode`
            + `${event.requestedPrivateDesktop ? ' (private desktop requested)' : ''}.`,
          );
        },
        onLiveSessionChange: updateAcpPrivateDesktopStatusBar,
      }),
      new startupModules.AnthropicAdapter(context.secrets),
      new startupModules.CopilotAdapter(),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'openai', compatibilityMode: 'openai-modern-chat', baseUrl: 'https://api.openai.com/v1', secretKey: 'atlasmind.provider.openai.apiKey', displayName: 'OpenAI' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', secretKey: 'atlasmind.provider.zai.apiKey', displayName: 'z.ai' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', secretKey: 'atlasmind.provider.deepseek.apiKey', displayName: 'DeepSeek' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'mistral', baseUrl: 'https://api.mistral.ai/v1', secretKey: 'atlasmind.provider.mistral.apiKey', displayName: 'Mistral' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', secretKey: 'atlasmind.provider.google.apiKey', displayName: 'Google Gemini' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        {
          providerId: 'azure',
          compatibilityMode: 'openai-modern-chat',
          baseUrl: 'https://example.openai.azure.com',
          resolveBaseUrl: () => getConfiguredAzureOpenAiEndpoint(),
          resolveChatCompletionsPath: requestModel => `/openai/deployments/${encodeURIComponent(stripProviderPrefix(requestModel))}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`,
          secretKey: 'atlasmind.provider.azure.apiKey',
          displayName: 'Azure OpenAI',
          authHeaderName: 'api-key',
          authScheme: 'raw',
          modelsPath: null,
          modelListProvider: () => getConfiguredAzureOpenAiDeployments(),
        },
        context.secrets,
      ),
      new startupModules.BedrockAdapter(context.secrets),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'xai', baseUrl: 'https://api.x.ai/v1', secretKey: 'atlasmind.provider.xai.apiKey', displayName: 'xAI' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'cohere', baseUrl: 'https://api.cohere.ai/compatibility/v1', secretKey: 'atlasmind.provider.cohere.apiKey', displayName: 'Cohere' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        {
          providerId: 'perplexity',
          baseUrl: 'https://api.perplexity.ai/v1',
          secretKey: 'atlasmind.provider.perplexity.apiKey',
          displayName: 'Perplexity',
          chatCompletionsPath: '/sonar',
          modelsPath: null,
          staticModels: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'],
        },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'huggingface', baseUrl: 'https://router.huggingface.co/v1', secretKey: 'atlasmind.provider.huggingface.apiKey', displayName: 'Hugging Face Inference' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', secretKey: 'atlasmind.provider.nvidia.apiKey', displayName: 'NVIDIA NIM' },
        context.secrets,
      ),
      // ── Aggregator / fast-inference providers ─────────────────────────────
      new startupModules.OpenRouterAdapter(context.secrets),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', secretKey: 'atlasmind.provider.groq.apiKey', displayName: 'Groq' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'together', baseUrl: 'https://api.together.xyz/v1', secretKey: 'atlasmind.provider.together.apiKey', displayName: 'Together AI' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', secretKey: 'atlasmind.provider.fireworks.apiKey', displayName: 'Fireworks AI' },
        context.secrets,
      ),
      // ── Regional cloud providers ───────────────────────────────────────────
      new startupModules.OpenAiCompatibleAdapter(
        {
          providerId: 'qwen',
          baseUrl: 'https://dashscope-intl.openai.aliyuncs.com/compatible-mode/v1',
          secretKey: 'atlasmind.provider.qwen.apiKey',
          displayName: 'Qwen (Alibaba)',
        },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', secretKey: 'atlasmind.provider.moonshot.apiKey', displayName: 'Moonshot AI (Kimi)' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'yi', baseUrl: 'https://api.01.ai/v1', secretKey: 'atlasmind.provider.yi.apiKey', displayName: '01.AI (Yi)' },
        context.secrets,
      ),
      new startupModules.OpenAiCompatibleAdapter(
        {
          providerId: 'minimax',
          baseUrl: 'https://api.minimax.chat/v1',
          secretKey: 'atlasmind.provider.minimax.apiKey',
          displayName: 'MiniMax',
          // MiniMax uses a non-standard path for chat completions
          chatCompletionsPath: '/text/chatcompletion_v2',
        },
        context.secrets,
      ),
    ];
    const routedAcpAdapter = providerAdapters.find(adapter => adapter.providerId === 'acp');
    if (routedAcpAdapter && 'dispose' in routedAcpAdapter && typeof routedAcpAdapter.dispose === 'function') {
      context.subscriptions.push({ dispose: () => routedAcpAdapter.dispose() });
    }

    const toolApprovalManager = new ToolApprovalManager();
    const toolApprovalGate = async (taskId: string, toolName: string, args: Record<string, unknown>) => {
      const configuration = vscode.workspace.getConfiguration('atlasmind');
      const mode = startupModules.getToolApprovalMode(configuration.get<string>('toolApprovalMode'));
      const policy = startupModules.classifyToolInvocation(toolName, args);

      if (policy.category === 'terminal-write' && !configuration.get<boolean>('allowTerminalWrite', false)) {
        return {
          approved: false,
          reason: 'Terminal write commands are disabled. Enable atlasmind.allowTerminalWrite to permit them.',
        };
      }

      if (!startupModules.requiresToolApproval(mode, policy)) {
        return { approved: true };
      }

      if (toolApprovalManager.shouldBypass(taskId, policy.category)) {
        return { approved: true };
      }

      void import('./views/chatPanel.js').then(({ revealPreferredChatSurface }) => revealPreferredChatSurface({ preserveFocus: true }));
      const choice = await toolApprovalManager.requestApproval({
        taskId,
        toolName,
        category: policy.category,
        risk: policy.risk,
        summary: policy.summary,
      });

      if (choice === 'allow-once') {
        return { approved: true };
      }

      if (choice === 'bypass-task') {
        toolApprovalManager.bypassTask(taskId);
        return { approved: true };
      }

      if (choice === 'autopilot') {
        toolApprovalManager.enableAutopilot();
        return { approved: true };
      }

      return {
        approved: false,
        reason: `User denied ${policy.summary}.`,
      };
    };
    const generatedSkillApprovalGate = async (
      skillId: string,
      scanResult: SkillScanResult,
      source: string,
    ) => requestGeneratedSkillApproval(skillId, scanResult, source, toolApprovalManager);
    const postToolVerifier = async (
      invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
    ) => runPostToolVerification(skillContext, invocations);
    const writeCheckpointHook = async (taskId: string, toolName: string, args: Record<string, unknown>) => {
      if (!checkpointManager) {
        return;
      }

      const paths = await resolveCheckpointPaths(skillContext, toolName, args);
      if (paths.length === 0) {
        return;
      }

      await checkpointManager.captureFiles(taskId, paths);
    };

    // Mutable ref filled in after runtime is available so the quota hook can
    // close over modelRouter without a forward-reference problem.
    let quotaUpdatedRef: (providerId: string, remainingRequests: number, totalRequests: number) => void
      = () => { /* no-op until wired */ };

    const runtime = startupModules.createAtlasRuntime({
      memoryStore: memoryManager,
      costTracker,
      skillContext,
      getPersonalityProfilePrompt: () => buildWorkspaceIdentityPrompt(context.workspaceState),
      providerAdapters,
      toolWebhookDispatcher,
      hooks: {
        readSetting: <T>(key: string, fallback: T) =>
          vscode.workspace.getConfiguration('atlasmind').get<T>(key, fallback),
        toolApprovalGate,
        generatedSkillApprovalGate,
        writeCheckpointHook,
        postToolVerifier,
        onQuotaUpdated: (pid, rem, tot) => quotaUpdatedRef(pid, rem, tot),
        onModelOutcomeRecorded: outcomes => persistExecutionOutcomes(context.globalState, outcomes),
        onModelStruggleRecorded: signals => persistModelStruggleSignals(context.globalState, signals),
        onClassifiedContentForUntrustedModel: ({ matches }) => {
          const kinds = [...new Set(matches.map(m => m.label))].slice(0, 3).join(', ') || 'confidential data';
          void vscode.window.showWarningMessage(
            `Data Privacy: detected ${kinds} but no trusted model is available. The content was redacted before being sent. Assign a trusted model to use it.`,
            'Open Privacy Settings',
          ).then(choice => {
            if (choice === 'Open Privacy Settings') {
              void vscode.commands.executeCommand('atlasmind.openProjectDashboard');
            }
          });
        },
      },
      config: {
        maxToolIterations: vscode.workspace.getConfiguration('atlasmind').get<number>('maxToolIterations')!,
        maxToolCallsPerTurn: vscode.workspace.getConfiguration('atlasmind').get<number>('maxToolCallsPerTurn')!,
        toolExecutionTimeoutMs: vscode.workspace.getConfiguration('atlasmind').get<number>('toolExecutionTimeoutMs')!,
        providerTimeoutMs: vscode.workspace.getConfiguration('atlasmind').get<number>('providerTimeoutMs')!,
      },
      onRuntimeEvent: event => {
        const detailSuffix = event.details
          ? ` ${JSON.stringify(event.details)}`
          : '';
        outputChannel.appendLine(`[runtime] ${event.stage}: ${event.summary}${detailSuffix}`);
      },
    });
    const { agentRegistry, skillsRegistry, modelRouter, providerRegistry } = runtime;
    modelRouter.setModelPreferences(sessionConversation.getModelFeedbackSummary());
    modelRouter.setFeedbackWeight(getConfiguredFeedbackRoutingWeight());
    applyModelAvailabilityState(
      modelRouter,
      readDisabledProviderIds(context.globalState),
      readDisabledModelIds(context.globalState),
    );
    // Restore persisted subscription quotas so routing is accurate from the
    // first request of a new session, and reset any that have rolled over.
    restorePersistedQuotas(context.globalState, modelRouter);
    // Restore learned execution outcomes (Direction 2) so outcome-driven routing
    // carries over across sessions.
    restoreExecutionOutcomes(context.globalState, modelRouter);
    // Restore persistent model-struggle memory so de-weighting of models that
    // repeatedly fail a kind of task carries across sessions (it still decays).
    restoreModelStruggleSignals(context.globalState, modelRouter);

    // Wire up quota tracking: persist on every decrement and warn when
    // a provider transitions into overflow or approaches exhaustion.
    const quotaOverflowWarned = new Set<string>();
    // `scope` may be a provider id or an authoritative model-scoped quota. It
    // is resolved to a name here rather than assumed to be a provider. ACP is
    // deliberately absent: it has no tracked quota to warn about.
    quotaUpdatedRef = (scope: string, remainingRequests: number, totalRequests: number) => {
      persistQuotas(context.globalState, modelRouter);
      modelsRefresh.fire();
      const label = modelRouter.getProviderConfig(scope)?.displayName
        ?? modelRouter.getModelInfo(scope)?.name
        ?? scope;
      const pct = totalRequests > 0 ? remainingRequests / totalRequests : 0;
      if (remainingRequests <= 0 && !quotaOverflowWarned.has(scope)) {
        quotaOverflowWarned.add(scope);
        void vscode.window.showWarningMessage(
          `${label} subscription quota exhausted — further requests are billed at pay-per-token rates.`,
        );
      } else if (pct <= 0.1 && pct > 0 && !quotaOverflowWarned.has(`${scope}-low`)) {
        quotaOverflowWarned.add(`${scope}-low`);
        void vscode.window.showInformationMessage(
          `${label} subscription quota below 10% — ${remainingRequests} of ${totalRequests} requests remaining.`,
        );
      }
    };

    const refreshProviderModels = async (includeInteractiveProviders = true) => {
      const summary = await refreshProviderModelsCatalog(
        modelRouter,
        providerRegistry,
        outputChannel,
        {
          includeInteractiveProviders,
          globalState: context.globalState,
          // Skip discovery for providers the user has not configured (no API key /
          // credentials), so unconfigured providers (e.g. Bedrock with no AWS keys,
          // whose health check otherwise attempts a ~30s network call) are not probed.
          isProviderConfigured: (providerId: string) => atlasContext?.isProviderConfigured(providerId as ProviderId) ?? Promise.resolve(true),
        },
      );
      applyModelAvailabilityState(
        modelRouter,
        readDisabledProviderIds(context.globalState),
        readDisabledModelIds(context.globalState),
      );
      modelsRefresh.fire();
      return summary;
    };
    const providerStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50,
    );
    const autopilotStatusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      49,
    );
    const refreshProviderHealth = async () => {
      await updateProviderStatusBar(providerStatusBar, providerRegistry, context.secrets, modelRouter);
    };
    context.subscriptions.push(vscode.lm.onDidChangeChatModels(() => {
      void (async () => {
        outputChannel.appendLine('[providers] VS Code chat model availability changed; refreshing AtlasMind provider metadata.');
        try {
          await refreshProviderModels(true);
          await refreshProviderHealth();
        } catch (error) {
          outputChannel.appendLine(
            `[providers] Automatic chat-model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      })();
    }));
    for (const agent of loadStoredUserAgents(context.globalState)) {
      agentRegistry.register(agent);
    }
    applyBuiltInAgentAllowedModelOverrides(
      agentRegistry,
      readBuiltInAgentAllowedModelOverrides(context.globalState),
    );
    applyBuiltInAgentPromptOverrides(
      agentRegistry,
      readBuiltInAgentPromptOverrides(context.globalState),
    );

    agentRegistry.setDisabledIds(
      context.globalState.get<string[]>('atlasmind.disabledAgentIds', []),
    );
    const savedPerformance = context.globalState.get<Record<string, { successes: number; failures: number; totalTasks: number }>>('atlasmind.agentPerformance');
    if (savedPerformance) {
      agentRegistry.loadPerformance(savedPerformance);
    }
    await restoreStoredCustomSkills(context.globalState, skillsRegistry, outputChannel);
    skillsRegistry.setDisabledIds(
      context.globalState.get<string[]>('atlasmind.disabledSkillIds', []),
    );

    for (const skill of skillsRegistry.listSkills().filter(s => s.builtIn)) {
      skillsRegistry.setScanResult({
        skillId: skill.id,
        status: 'passed',
        scannedAt: new Date().toISOString(),
        issues: [],
      });
    }

    const orchestrator = runtime.orchestrator;

    // The arbiter is the single source of truth for what is loaded. The router
    // uses it to prefer a resident model over an equally suitable cold one, and
    // the orchestrator adds the gate's bounded wait to a local timeout so a
    // request that queued politely is not then reported as a slow model.
    modelRouter.setResidentLocalModels(localModelArbiter.getState().residentModelIds);
    orchestrator.setLocalAdmissionBudgetMs(LOCAL_GPU_ADMISSION_WAIT_MS);
    context.subscriptions.push(
      localModelArbiter.onDidChange(state => {
        modelRouter.setResidentLocalModels(state.residentModelIds);
      }),
    );

    // Wire the memory agent executor now that runtime is available.
    // It owns all memory maintenance LLM calls and respects the memory-agent's allowedModels config.
    const memoryAgentExecutor = new startupModules.MemoryAgentExecutor(
      runtime.modelRouter,
      runtime.providerRegistry,
      runtime.taskProfiler,
      memoryManager,
      runtime.agentRegistry,
    );
    maintenanceCompleter = (sys: string, user: string) => memoryAgentExecutor.complete(sys, user);

    // Shared agent save callback used by both auto-updater and skill auto-assigner.
    const saveAgentAndRefresh = async (_agent: import('./types.js').AgentDefinition) => {
      await persistAgentAllowedModels(context.globalState, runtime.agentRegistry);
      await persistBuiltInAgentPromptOverrides(context.globalState, runtime.agentRegistry);
      void context.globalState.update('atlasmind.agentPerformance', runtime.agentRegistry.dumpPerformance());
      agentsRefresh.fire();
    };

    // Auto-assigns skills to agents whose skillsAutoManaged flag is enabled.
    const skillAutoAssigner = new startupModules.SkillAutoAssigner(
      runtime.agentRegistry,
      runtime.modelRouter,
      runtime.providerRegistry,
      runtime.taskProfiler,
      saveAgentAndRefresh,
    );

    // Wire the agent auto-updater. Refreshes user-defined agent definitions on a
    // configurable cadence before each use, keeping prompts modern and legally compliant.
    const agentAutoUpdater = new startupModules.AgentAutoUpdater(
      runtime.agentRegistry,
      runtime.modelRouter,
      runtime.providerRegistry,
      runtime.taskProfiler,
      async (agent) => {
        await saveAgentAndRefresh(agent);
        // After a prompt refresh, also reassess skills for auto-managed agents.
        if (agent.skillsAutoManaged) {
          const available = skillsRegistry.listSkills().filter(s => skillsRegistry.isEnabled(s.id));
          void skillAutoAssigner.assignSkillsForAgent(agent, available).then(() => agentsRefresh.fire());
        }
      },
      () => vscode.workspace.getConfiguration('atlasmind').get<string>('agentAutoUpdateCadence', 'never') as import('./types.js').AgentAutoUpdateCadence,
    );
    orchestrator.setAgentAutoUpdater(agentAutoUpdater);

    // Data Privacy: load the project policy (project_memory/operations/data-privacy.json)
    // and inject it so the orchestrator gates routing to trusted models and
    // redacts confidential / regulated content for everything else.
    const dataPrivacyRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const dataPrivacyManager = new startupModules.DataPrivacyManager(
      dataPrivacyRoot ? startupModules.readDataPrivacyConfig(dataPrivacyRoot) : undefined,
    );
    // Restore prior catch activity (workspace-scoped telemetry powering the
    // Privacy dashboard charts) and persist new catches as they are recorded.
    const storedPrivacyActivity = context.workspaceState.get<import('./types.js').DataPrivacyActivityEvent[]>('atlasmind.dataPrivacyActivity', []);
    if (Array.isArray(storedPrivacyActivity) && storedPrivacyActivity.length > 0) {
      dataPrivacyManager.setActivity(storedPrivacyActivity);
    }
    dataPrivacyManager.setActivityListener(activity => {
      void context.workspaceState.update('atlasmind.dataPrivacyActivity', [...activity]);
    });
    orchestrator.setDataPrivacyManager(dataPrivacyManager);
    const reloadDataPrivacyConfig = () => {
      if (!dataPrivacyRoot) { return; }
      const next = startupModules.readDataPrivacyConfig(dataPrivacyRoot);
      if (next) { dataPrivacyManager.setConfig(next); }
    };
    if (dataPrivacyRoot) {
      const dpWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dataPrivacyRoot, 'project_memory/operations/data-privacy.json'),
      );
      dpWatcher.onDidChange(reloadDataPrivacyConfig);
      dpWatcher.onDidCreate(reloadDataPrivacyConfig);
      context.subscriptions.push(dpWatcher);
    }

    // Periodically refresh snippets for stale SSOT entries (max 3 per cycle to avoid cost spikes).
    const ssotSnippetRefreshHandle = setInterval(() => {
      const ssotRoot = sessionContextManager.getSsotRoot();
      if (!ssotRoot) { return; }
      const stale = memoryAgentExecutor.detectStaleEntries();
      if (stale.length === 0) { return; }
      void (async () => {
        for (const entryPath of stale.slice(0, 3)) {
          try {
            const fileUri = vscode.Uri.joinPath(ssotRoot, entryPath);
            const raw = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(raw).toString('utf8');
            const newSnippet = await memoryAgentExecutor.summarizeSsotEntry(entryPath, content);
            if (newSnippet) {
              const entry = memoryManager.listEntries().find(e => e.path === entryPath);
              if (entry) {
                memoryManager.upsert({ ...entry, snippet: newSnippet });
              }
            }
          } catch {
            // Silent — best-effort refresh only.
          }
        }
      })();
    }, MEMORY_SELF_HEAL_INTERVAL_MS);
    context.subscriptions.push({ dispose: () => clearInterval(ssotSnippetRefreshHandle) });

    const mcpServerRegistry = new startupModules.McpServerRegistry(
      context.globalState,
      skillsRegistry,
      () => {
        skillsRefresh.fire();
        // Reassess skill assignments for all auto-managed agents when MCP tools change.
        const available = skillsRegistry.listSkills().filter(s => skillsRegistry.isEnabled(s.id));
        void skillAutoAssigner.reassessAllAutoAgents(available).then(() => agentsRefresh.fire());
      },
      outputChannel,
      context.secrets,
    );
    mcpServerRegistry.loadFromStorage();

    // ── ACP delegated execution: the authorization gate ───────────
    //
    // Two independent switches, both off by default. `acp.agents` decides
    // whether ACP can produce completions at all; `acp.toolsEnabled` decides
    // whether an agent may *act*. Splitting them means using a Claude
    // subscription for chat never implies letting Claude run commands. The
    // Orchestrator separately stamps only the exact tool-backed provider turn.
    acpMcpServers = () => {
      const config = vscode.workspace.getConfiguration('atlasmind');
      if (config.get<boolean>('acp.toolsEnabled') !== true) {
        return [];
      }
      const allowlist = config.get<unknown>('acp.mcpServers');
      const names = Array.isArray(allowlist)
        ? allowlist.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const { servers, skipped } = startupModules.selectAcpMcpServers(
        mcpServerRegistry.listServers().map(state => state.config),
        names,
      );
      for (const entry of skipped) {
        outputChannel.appendLine(`[acp] not sharing MCP server "${entry.name}": ${entry.reason}`);
      }
      return servers;
    };

    acpAuthorize = async request => {
      const config = vscode.workspace.getConfiguration('atlasmind');
      if (config.get<boolean>('acp.toolsEnabled') !== true) {
        return false;
      }

      const { category, risk } = startupModules.acpToolRisk(request.toolCall.kind);
      const description = startupModules.describeAcpToolCall(request.toolCall);
      outputChannel.appendLine(`[acp] permission requested (${risk} risk, ${category}): ${description}`);

      // The off-by-default setting is the user's standing authorization for
      // delegated ACP operations. Re-read it for every request so switching it
      // off stops a live session immediately. The adapter has already required
      // the separate per-turn Orchestrator stamp before it wires this policy.
      //
      // The wire response remains `allow_once`, never `allow_always`: automatic
      // acknowledgement belongs to AtlasMind's revocable setting, not to
      // persistent state owned by the external agent.
      outputChannel.appendLine('[acp] automatically allowed once by atlasmind.acp.toolsEnabled');
      return true;
    };

    // ── Agentic Resource Discovery (ARD) ──────────────────────────
    const ardRegistry = new startupModules.ArdRegistry(
      context.globalState,
      () => discoveryRefresh.fire(),
    );
    ardRegistry.loadFromStorage();
    const ardClient = new startupModules.ArdClient(() => {
      const cfg = vscode.workspace.getConfiguration('atlasmind');
      const federationRaw = cfg.get<string>('ard.federationMode', 'referrals');
      return {
        timeoutMs: cfg.get<number>('ard.requestTimeoutMs', 15_000),
        maxResults: cfg.get<number>('ard.maxResults', 10),
        federation: federationRaw === 'auto' || federationRaw === 'none' ? federationRaw : 'referrals',
        allowInsecureEndpoints: cfg.get<boolean>('ard.allowInsecureEndpoints', false),
      };
    });
    const ardInstaller = new startupModules.ArdInstaller(mcpServerRegistry, ardRegistry);
    // Register the read-only in-task discovery skill (closure over the ARD services).
    if (vscode.workspace.getConfiguration('atlasmind').get<boolean>('ard.enabled', true)) {
      skillsRegistry.register(startupModules.createDiscoverResourcesSkill(ardClient, ardRegistry));
    }

    atlasContext = {
      orchestrator,
      dataPrivacyManager,
      agentRegistry,
      skillsRegistry,
      skillContext,
      modelRouter,
      memoryManager,
      costTracker,
      providerRegistry,
      skillsRefresh,
      agentsRefresh,
      modelsRefresh,
      scannerRulesManager,
      mcpServerRegistry,
      ardRegistry,
      ardClient,
      ardInstaller,
      discoveryRefresh,
      extensionContext: context,
      refreshProviderModels,
      refreshProviderHealth,
      setProviderEnabled: async (providerId: ProviderId, enabled: boolean) => {
        const disabledProviderIds = readDisabledProviderIds(context.globalState);
        const disabledModelIds = readDisabledModelIds(context.globalState);
        const provider = modelRouter.listProviders().find(candidate => candidate.id === providerId);
        if (!provider) {
          return;
        }

        if (enabled) {
          disabledProviderIds.delete(providerId);
          for (const model of provider.models) {
            disabledModelIds.delete(model.id);
          }
        } else {
          disabledProviderIds.add(providerId);
          for (const model of provider.models) {
            disabledModelIds.add(model.id);
          }
        }

        await persistModelAvailabilityState(context.globalState, disabledProviderIds, disabledModelIds);
        applyModelAvailabilityState(modelRouter, disabledProviderIds, disabledModelIds);
        modelsRefresh.fire();
      },
      setModelEnabled: async (providerId: ProviderId, modelId: string, enabled: boolean) => {
        const disabledProviderIds = readDisabledProviderIds(context.globalState);
        const disabledModelIds = readDisabledModelIds(context.globalState);

        if (enabled) {
          disabledProviderIds.delete(providerId);
          disabledModelIds.delete(modelId);
        } else {
          disabledModelIds.add(modelId);
        }

        await persistModelAvailabilityState(context.globalState, disabledProviderIds, disabledModelIds);
        applyModelAvailabilityState(modelRouter, disabledProviderIds, disabledModelIds);
        modelsRefresh.fire();
      },
      isProviderConfigured: async (providerId: ProviderId) => {
        if (providerId === 'copilot') {
          return true;
        }
        if (providerId === 'acp') {
          // ACP is keyless by construction: the whole point is to drive an agent
          // the user has already signed in to, so there is no
          // `atlasmind.provider.acp.apiKey` and there never will be. Falling
          // through to the secret lookup below therefore reported ACP as
          // *unconfigured* on every refresh, which skipped discovery and — the
          // part that was actually visible — set provider health to false. The
          // Models tree then read that flag and said "agent not responding"
          // about an agent it had never contacted, while the provider panel,
          // which probes directly, showed the same agents as ready. The router
          // meanwhile excluded ACP from every candidate list, so the models were
          // on screen and unreachable.
          //
          // What "configured" means here is the same thing it means for `local`:
          // is there anything to talk to. That is an agent in settings.
          const [{ parseAcpAgentSettings }, { isAcpConsoleModeChosen }] = await Promise.all([
            import('./providers/acp.js'),
            import('./providers/acpWindowsLauncher.js'),
          ]);
          const configuration = vscode.workspace.getConfiguration('atlasmind');
          const inspected = configuration.inspect<boolean>('acp.hideConsoleWindows');
          if (!isAcpConsoleModeChosen(process.platform, [
            inspected?.workspaceFolderValue,
            inspected?.workspaceValue,
            inspected?.globalValue,
          ])) {
            return false;
          }
          return parseAcpAgentSettings(
            configuration.get<unknown>('acp.agents'),
          ).length > 0;
        }
        if (providerId === 'local') {
          return startupModules.getConfiguredLocalEndpoints({
            getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
            getLegacyBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
          }).length > 0;
        }
        if (providerId === 'azure') {
          const key = await context.secrets.get('atlasmind.provider.azure.apiKey');
          return Boolean(key && getConfiguredAzureOpenAiEndpoint() && getConfiguredAzureOpenAiDeployments().length > 0);
        }
        if (providerId === 'bedrock') {
          const accessKeyId = await context.secrets.get(startupModules.BEDROCK_ACCESS_KEY_SECRET);
          const secretAccessKey = await context.secrets.get(startupModules.BEDROCK_SECRET_KEY_SECRET);
          return Boolean(accessKeyId && secretAccessKey && startupModules.getConfiguredBedrockRegion() && startupModules.getConfiguredBedrockModelIds().length > 0);
        }
        const key = await context.secrets.get(`atlasmind.provider.${providerId}.apiKey`);
        return Boolean(key);
      },
      updateAgentAllowedModels: async (agentId: string, allowedModels?: string[]) => {
        const agent = agentRegistry.get(agentId);
        if (!agent) {
          return;
        }

        const normalizedModels = allowedModels && allowedModels.length > 0
          ? [...new Set(allowedModels)]
          : undefined;

        agentRegistry.register({
          ...agent,
          allowedModels: normalizedModels,
        });
        await persistAgentAllowedModels(context.globalState, agentRegistry);
        agentsRefresh.fire();
      },
      getModelInfoUrl: (providerId: ProviderId, modelId?: string) =>
        modelId ? getModelInfoUrl(providerId, modelId) : getProviderInfoUrl(providerId),
      toolWebhookDispatcher,
      toolApprovalManager,
      getWorkspacePolicySnapshots: () => buildWorkspacePolicySnapshots(context.workspaceState, {
        autopilot: toolApprovalManager.isAutopilot(),
      }),
      voiceManager,
      sessionConversation,
      sessionContextManager,
      projectRunHistory,
      projectRunsRefresh,
      memoryRefresh,
      routineRegistry,
      routinesRefresh,
      deliveryManager,
      deliveryRefresh,
      projectDirectorManager,
      projectDirectorRefresh,
      documentsManager,
      documentsRefresh,
      riskOversightManager,
      riskOversightRefresh,
      researchRegisterManager,
      researchRefresh,
      missionRegistry,
      rollbackLastCheckpoint: async () => {
        if (!checkpointManager) {
          return { ok: false, summary: 'No workspace checkpoint manager is available.', restoredPaths: [] };
        }
        return checkpointManager.rollbackLatest();
      },
      listCheckpoints: async () => checkpointManager ? checkpointManager.listCheckpoints() : [],
      rollbackCheckpointByTaskId: async (taskId: string) => {
        if (!checkpointManager) {
          return { ok: false, summary: 'No workspace checkpoint manager is available.', restoredPaths: [] };
        }
        return checkpointManager.rollbackByTaskId(taskId);
      },
      assessAgentSkills: async (agentId: string) => {
        const agent = agentRegistry.get(agentId);
        if (!agent || !agent.skillsAutoManaged) { return; }
        const available = skillsRegistry.listSkills().filter(s => skillsRegistry.isEnabled(s.id));
        await skillAutoAssigner.assignSkillsForAgent(agent, available);
        agentsRefresh.fire();
      },
      persistBuiltInAgentOverride: async () => {
        await persistBuiltInAgentPromptOverrides(context.globalState, agentRegistry);
        agentsRefresh.fire();
      },
      resetBuiltInAgentPrompt: async (agentId: string) => {
        const defaultDef = startupModules.BUILTIN_AGENT_DEFAULTS.find(a => a.id === agentId);
        if (!defaultDef) { return; }
        agentRegistry.register(defaultDef);
        // Remove this agent's entry from the override store.
        const stored = readBuiltInAgentPromptOverrides(context.globalState);
        delete stored[agentId];
        await context.globalState.update(BUILTIN_AGENT_PROMPT_OVERRIDES_STORAGE_KEY, stored);
        agentsRefresh.fire();
      },
    };

    // ── Remote control (desktop server) ──────────────────────────────────────
    const remoteOutput = vscode.window.createOutputChannel('AtlasMind Remote');
    const remoteControlServer = new RemoteControlServer(atlasContext, remoteOutput);
    atlasContext.remoteControlServer = remoteControlServer;
    // Read-only RPC for the web client's cost & project-run dashboards. No mutation
    // paths are exposed, and no secrets cross the bridge — only the user's own
    // aggregate cost figures and run metadata.
    remoteControlServer.setRpcHandler(async (channel, request) => {
      if (channel === 'cost' && request.method === 'cost.snapshot') {
        return {
          summary: atlasContext!.costTracker.getSummary(),
          todayCostUsd: atlasContext!.costTracker.getTodayCostUsd(),
        };
      }
      if (channel === 'runs' && request.method === 'runs.list') {
        const limit = typeof request.params?.['limit'] === 'number' ? Math.max(1, Math.min(50, request.params['limit'] as number)) : 20;
        const runs = (await atlasContext!.projectRunHistory.listRunsAsync(limit)).map(run => ({
          id: run.id,
          title: run.title,
          goal: run.goal,
          status: run.status,
          updatedAt: run.updatedAt,
          completedSubtaskCount: run.completedSubtaskCount,
          totalSubtaskCount: run.totalSubtaskCount,
        }));
        return { runs };
      }
      // Buzz, read-only. The browser never reaches a relay: NIP-42 auth needs the agent
      // key, which stays in SecretStorage on this machine. It asks the desktop for what
      // the desktop has already received, and there is deliberately no send method.
      // Inbound is deny-by-default and off unless the user turned both gates on, so an
      // absent service is the NORMAL case, not an error — say so rather than throwing.
      if (channel === 'buzz') {
        const buzz = atlasContext!.buzzInbound;
        if (!buzz) {
          if (request.method === 'buzz.status') {
            return { status: 'disabled', channelIds: [], identityCount: 0 };
          }
          return request.method === 'buzz.channels' ? { channels: [] } : { messages: [] };
        }
        const identities = buzz.listIdentities();
        const nameFor = (pubkey: string): string | undefined =>
          identities.find(identity => identity.pubkey === pubkey)?.displayName;
        const selfPubkey = buzz.getSelfPubkey();
        // Clamp before it reaches the conversation store: `limit` is attacker-controllable
        // in the sense that it arrives over the bridge, and an unbounded read would let a
        // client pull the whole history in one frame.
        const limit = typeof request.params?.['limit'] === 'number'
          ? Math.max(1, Math.min(100, Math.floor(request.params['limit'] as number)))
          : 30;
        const toRemote = (message: {
          id: string;
          authorPubkey: string;
          channelId?: string;
          createdAt: number;
          text: string;
        }) => ({
          id: message.id,
          channelId: message.channelId ?? '',
          pubkey: message.authorPubkey,
          ...(nameFor(message.authorPubkey) ? { author: nameFor(message.authorPubkey)! } : {}),
          content: message.text,
          createdAt: message.createdAt,
          mine: selfPubkey !== undefined && message.authorPubkey === selfPubkey,
        });

        if (request.method === 'buzz.status') {
          return {
            status: buzz.getStatus(),
            ...(selfPubkey ? { selfPubkey } : {}),
            channelIds: buzz.listConversationChannels(),
            identityCount: identities.length,
          };
        }
        if (request.method === 'buzz.channels') {
          const channels = buzz.listConversationChannels().map(id => {
            const recent = buzz.readConversation(id, 1);
            const last = recent[recent.length - 1];
            return last ? { id, lastAt: last.createdAt } : { id };
          });
          return { channels };
        }
        if (request.method === 'buzz.messages') {
          const channelId = typeof request.params?.['channelId'] === 'string'
            ? (request.params['channelId'] as string)
            : undefined;
          const messages = (channelId ? buzz.readConversation(channelId, limit) : buzz.readAllConversations(limit))
            .map(toRemote);
          return { messages };
        }
      }
      throw new Error(`Unsupported RPC ${channel}.${request.method}`);
    });
    const remoteStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    remoteStatusBar.command = 'atlasmind.remote.showPairingCode';
    const updateRemoteStatusBar = (): void => {
      const status = remoteControlServer.getStatus();
      if (!status.running) {
        remoteStatusBar.hide();
        return;
      }
      remoteStatusBar.text = `$(broadcast) Atlas Remote: ${status.clientCount}`;
      remoteStatusBar.tooltip = `AtlasMind remote control active on ${status.url} — ${status.clientCount} client(s) connected. Click to show the pairing code.`;
      remoteStatusBar.show();
    };
    const showRemotePairing = async (url: string, token: string): Promise<void> => {
      const choice = await vscode.window.showInformationMessage(
        `AtlasMind remote control is live. In the AtlasMind web build, run "Connect to Desktop Instance" and pair with this URL and token.\n\nURL: ${url}`,
        'Copy URL & Token',
      );
      if (choice === 'Copy URL & Token') {
        await vscode.env.clipboard.writeText(`${url}\n${token}`);
        void vscode.window.showInformationMessage('Remote URL and pairing token copied to the clipboard.');
      }
    };
    const showGatewayGuidance = async (localUrl: string, originSecret: string): Promise<void> => {
      const port = localUrl.split(':').pop() ?? '0';
      const choice = await vscode.window.showInformationMessage(
        `AtlasMind remote control is live in gateway mode on ${localUrl}. Point the "atlas-lab" Cloudflare Tunnel at http://127.0.0.1:${port}, and set the atlas gateway Worker's ORIGIN_SECRET to the copied value. The browser never sees this secret — the platform login is its identity.`,
        'Copy origin secret',
      );
      if (choice === 'Copy origin secret') {
        await vscode.env.clipboard.writeText(originSecret);
        void vscode.window.showInformationMessage('Origin secret copied. Set it on the Worker with `wrangler secret put ORIGIN_SECRET`.');
      }
    };
    context.subscriptions.push(
      remoteOutput,
      remoteControlServer,
      remoteStatusBar,
      remoteControlServer.onStatusChange(() => updateRemoteStatusBar()),
      vscode.commands.registerCommand('atlasmind.remote.enable', async () => {
        const result = await remoteControlServer.enable(true);
        updateRemoteStatusBar();
        if (result) {
          await showRemotePairing(result.url, result.token);
        }
      }),
      vscode.commands.registerCommand('atlasmind.remote.enableGateway', async () => {
        await vscode.workspace.getConfiguration('atlasmind').update('remote.mode', 'gateway', vscode.ConfigurationTarget.Global);
        const result = await remoteControlServer.enable(true);
        updateRemoteStatusBar();
        if (result) {
          await showGatewayGuidance(result.url, result.token);
        }
      }),
      vscode.commands.registerCommand('atlasmind.remote.disable', () => {
        remoteControlServer.disable();
        updateRemoteStatusBar();
        void vscode.window.showInformationMessage('AtlasMind remote control disabled.');
      }),
      vscode.commands.registerCommand('atlasmind.remote.showPairingCode', async () => {
        const status = remoteControlServer.getStatus();
        const token = await remoteControlServer.getPairingToken();
        if (!status.running || !status.url || !token) {
          void vscode.window.showInformationMessage('Remote control is not running. Run "AtlasMind: Enable Remote Control" first.');
          return;
        }
        await showRemotePairing(status.url, token);
      }),
      vscode.commands.registerCommand('atlasmind.remote.revoke', async () => {
        await remoteControlServer.revoke();
        updateRemoteStatusBar();
        void vscode.window.showInformationMessage('AtlasMind remote access revoked. Existing clients were disconnected and the pairing token was rotated.');
      }),
    );

    context.subscriptions.push(skillsRefresh);
    context.subscriptions.push(agentsRefresh);
  context.subscriptions.push(modelsRefresh);
    context.subscriptions.push(projectRunsRefresh);
    context.subscriptions.push(memoryRefresh);
    context.subscriptions.push(discoveryRefresh);
    context.subscriptions.push(voiceManager);
    agentsRefresh.event(() => {
      void context.globalState.update('atlasmind.agentPerformance', agentRegistry.dumpPerformance());
    });
    context.subscriptions.push({
      dispose: () => { void mcpServerRegistry.disposeAll(); },
    });

    providerStatusBar.command = 'atlasmind.openModelProviders';
    providerStatusBar.tooltip = 'AtlasMind: checking providers…';
    providerStatusBar.text = '$(loading~spin) Atlas';
    providerStatusBar.show();
    context.subscriptions.push(providerStatusBar);
    autopilotStatusBar.command = 'atlasmind.toggleAutopilot';
    updateAutopilotStatusBar(autopilotStatusBar, toolApprovalManager);
    context.subscriptions.push(autopilotStatusBar);
    context.subscriptions.push({
      dispose: toolApprovalManager.onAutopilotChange(() => {
        updateAutopilotStatusBar(autopilotStatusBar, toolApprovalManager);
      }),
    });

    return {
      memoryManager,
      mcpServerRegistry,
      providerRegistry,
      providerStatusBar,
      registerChatParticipant: startupModules.registerChatParticipant,
      registerTreeViews: startupModules.registerTreeViews,
    };
  });
  if (!coreReady || !atlasContext) {
    return;
  }

  const treeViewsReady = await runTimedActivationStep('registerTreeViews', outputChannel, async () => {
    coreReady.registerTreeViews(context, atlasContext!);
  });
  if (treeViewsReady === undefined && atlasStartupState.status === 'failed') {
    return;
  }

  const chatReady = await runTimedActivationStep('registerChatParticipant', outputChannel, async () => {
    coreReady.registerChatParticipant(context, atlasContext!);
  });
  if (chatReady === undefined && atlasStartupState.status === 'failed') {
    return;
  }

  atlasStartupState.status = 'ready';
  atlasStartupState.phase = 'ready';
  atlasStartupState.detail = undefined;
  outputChannel.appendLine(`AtlasMind activated in ${Date.now() - atlasStartupState.startedAt}ms ✓`);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    registerProjectMemoryAutoRefresh(context, workspaceFolder, outputChannel);
    registerMemorySelfHealing(context, workspaceFolder, outputChannel);
    await setSsotPresentContext(false);
    await setMemoryNeedsUpdateContext(false);
    runBackgroundActivationTask('loadSsotFromDisk', outputChannel, async () => {
      const ssotPath = vscode.workspace
        .getConfiguration('atlasmind')
        .get<string>('ssotPath', DEFAULT_SSOT_PATH);
      const resolved = await autoLoadWorkspaceSsot(
        workspaceFolder,
        ssotPath,
        coreReady.memoryManager,
        atlasContext!.memoryRefresh,
        outputChannel,
      );
      if (!resolved) {
        await setSsotPresentContext(false);
        await setMemoryNeedsUpdateContext(false);
        return;
      }
      atlasContext?.sessionContextManager.setSsotRoot(resolved.uri);
      await setSsotPresentContext(true);

      // Defer the expensive workspace freshness scan off the startup-critical
      // window. Loading the SSOT from disk above is cheap; fingerprinting the
      // whole repo to detect staleness is not, and it only feeds the "Update
      // Memory" badge — so run it shortly after activation settles.
      const freshnessTimer = setTimeout(() => {
        runBackgroundActivationTask('memoryFreshnessScan', outputChannel, async () => {
          if (!atlasContext) {
            return;
          }
          await refreshWorkspaceMemoryFreshness(workspaceFolder, outputChannel);
          if (isStaleMemoryAutoRefreshEnabled()) {
            await autoRefreshProjectMemoryIfStale(workspaceFolder, atlasContext, outputChannel, 'ssot-load')
              .catch(error => {
                const detail = error instanceof Error ? error.stack ?? error.message : String(error);
                outputChannel.appendLine(`[activate] memoryFreshness ssot-load auto-refresh failed: ${detail}`);
              });
          } else {
            outputChannel.appendLine('[activate] memoryFreshness auto-refresh disabled (atlasmind.autoRefreshStaleMemory=false); memory marked stale — use the Update Memory action to refresh on demand.');
          }
        });
      }, MEMORY_FRESHNESS_STARTUP_DELAY_MS);
      context.subscriptions.push(new vscode.Disposable(() => clearTimeout(freshnessTimer)));
    });
  } else {
    await setSsotPresentContext(false);
    await setMemoryNeedsUpdateContext(false);
  }

  // ── Presence / keep-awake ──────────────────────────────────────────────────
  // Cross-platform OS wake lock so a connected Buzz presence, a Remote Control
  // gateway session, or a long Mission Loop run is not killed by system sleep.
  // Deny-by-default: holds nothing unless atlasmind.presence.keepAwake is on
  // (or an activity calls hold()), AC-power-gated, and auto-releasing.
  const readPresenceConfig = () => {
    const cfg = vscode.workspace.getConfiguration('atlasmind');
    return {
      keepAwake: cfg.get<boolean>('presence.keepAwake', false),
      keepDisplayAwake: cfg.get<boolean>('presence.keepDisplayAwake', false),
      acPowerOnly: cfg.get<boolean>('presence.acPowerOnly', true),
      maxAwakeMinutes: cfg.get<number>('presence.maxAwakeMinutes', 240),
    };
  };
  const presenceManager = new PresenceManager({
    onLog: (message) => outputChannel.appendLine(`[presence] ${message}`),
  });
  const presenceStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 48);
  presenceStatusBar.command = 'atlasmind.togglePresence';
  let presenceUnavailableNotified = false;
  const updatePresenceStatusBar = (state = presenceManager.getState()): void => {
    if (state.active) {
      const displaySuffix = state.displayHeld ? ' (display on)' : '';
      const expires = state.expiresAt
        ? ` Auto-releases at ${new Date(state.expiresAt).toLocaleTimeString()}.`
        : '';
      presenceStatusBar.text = `$(zap) Atlas: Awake${displaySuffix}`;
      presenceStatusBar.tooltip = `AtlasMind is keeping this computer awake so the agent stays online (${state.reasons.join(', ')}).${expires} Click to stop.`;
      presenceStatusBar.backgroundColor = undefined;
      presenceStatusBar.show();
    } else if (state.suspended === 'battery') {
      presenceStatusBar.text = '$(zap) Atlas: Awake (paused — battery)';
      presenceStatusBar.tooltip = 'Keep-awake is paused because this device is on battery power (atlasmind.presence.acPowerOnly). It resumes automatically when you reconnect power. Click to change.';
      presenceStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      presenceStatusBar.show();
    } else if (state.suspended === 'backstop') {
      presenceStatusBar.text = '$(zap) Atlas: Awake ended (time limit)';
      presenceStatusBar.tooltip = 'Keep-awake auto-released after the atlasmind.presence.maxAwakeMinutes safety limit. The activity keeps running under your normal power settings. Click to toggle keep-awake off, then on again, to hold the machine awake for another period.';
      presenceStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      presenceStatusBar.show();
    } else {
      presenceStatusBar.hide();
    }
    if (state.suspended === 'unsupported' && state.reasons.length > 0 && !presenceUnavailableNotified) {
      presenceUnavailableNotified = true;
      void vscode.window.showWarningMessage('AtlasMind could not keep this computer awake: no supported keep-awake helper is available on this system. Adjust your OS power settings to prevent sleep while you need the agent online.');
    }
  };
  presenceManager.applyConfig(readPresenceConfig());
  updatePresenceStatusBar();

  // Buzz inbound: deny-by-default, so constructing this connects nothing. It
  // holds the keep-awake reason only while a subscription is genuinely live.
  const buzzInbound = new BuzzInboundService({
    secrets: context.secrets,
    presence: presenceManager,
    log: (message) => outputChannel.appendLine(`[buzz] ${message}`),
  });
  // Exposed so surfaces can offer the identities it has observed. Assigned
  // after construction because the context is assembled earlier in activate().
  if (atlasContext) {
    atlasContext.buzzInbound = buzzInbound;
  }
  void buzzInbound.sync();
  context.subscriptions.push(
    buzzInbound,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('atlasmind.buzz')) {
        void buzzInbound.sync();
      }
    }),
  );
  /**
   * Resolve what a research scan could look with, right now.
   *
   * Assembled here rather than inside the pure detector because every input is
   * a fact about this running editor: whether an EXA key is in SecretStorage,
   * which MCP tools are connected, whether the fetch skill is registered.
   */
  const resolveResearchSources = async (): Promise<import('./core/researchSources.js').ResearchSourceResolution> => {
    const { detectResearchSources } = await import('./core/researchSources.js');
    const { readResearchSettings } = await import('./core/researchSettings.js');
    const settings = readResearchSettings(vscode.workspace.getConfiguration('atlasmind'));
    // The key itself never leaves this line: only *whether one exists* reaches
    // the detector, because a source check has no business holding a credential.
    const exaKey = await context.secrets.get('atlasmind.integration.exa.apiKey');
    const mcpToolIds = (atlasContext?.skillsRegistry.listSkills() ?? [])
      .map(skill => skill.id)
      .filter(id => id.startsWith('mcp:'));
    return detectResearchSources({
      exaKeyPresent: Boolean(exaKey),
      mcpToolIds,
      webFetchEnabled: (atlasContext?.skillsRegistry.get('web-fetch')) !== undefined,
      preference: settings.searchSource,
    });
  };

  /** Roadmap item text, normalized, for the severity rule that asks about overlap. */
  const readRoadmapTitles = async (): Promise<Set<string>> => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { return new Set(); }
    try {
      const { normalizeForRoadmapMatch } = await import('./core/ideationDerivation.js');
      const nodePath = await import('node:path');
      const fsp = await import('node:fs/promises');
      const ssotPath = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath') ?? 'project_memory';
      const raw = await fsp.readFile(nodePath.join(root, ssotPath, 'roadmap', 'improvement-plan.md'), 'utf8');
      const titles = new Set<string>();
      for (const match of raw.matchAll(/^-\s*\[[ xX]\]\s*(.+)$/gm)) {
        const text = (match[1] ?? '').replace(/[*_`]/g, '').trim();
        if (text) { titles.add(normalizeForRoadmapMatch(text)); }
      }
      return titles;
    } catch {
      // No roadmap is a real state, not an error. The overlap rule simply
      // never fires, which is the safe direction: it can only raise severity.
      return new Set();
    }
  };

  context.subscriptions.push(
    presenceStatusBar,
    presenceManager,
    presenceManager.onDidChange((state) => updatePresenceStatusBar(state)),
    // Dedicated listener: presence is independent of atlasContext, so its config
    // changes must apply even before/without the full context being ready.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('atlasmind.presence.keepAwake') ||
        event.affectsConfiguration('atlasmind.presence.keepDisplayAwake') ||
        event.affectsConfiguration('atlasmind.presence.acPowerOnly') ||
        event.affectsConfiguration('atlasmind.presence.maxAwakeMinutes')
      ) {
        presenceManager.applyConfig(readPresenceConfig());
        updatePresenceStatusBar();
      }
    }),
    vscode.commands.registerCommand('atlasmind.togglePresence', async () => {
      const cfg = vscode.workspace.getConfiguration('atlasmind');
      const next = !cfg.get<boolean>('presence.keepAwake', false);
      await cfg.update('presence.keepAwake', next, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(next
        ? 'AtlasMind will keep this computer awake while an activity needs the agent online.'
        : 'AtlasMind will no longer keep this computer awake.');
    }),
    /**
     * Copy a workspace-specific, credential-free Buzz custom-runtime recipe.
     *
     * AtlasMind cannot edit Buzz's local database and never exports VS Code
     * secrets. The clipboard payload names only the launcher, arguments, and
     * environment variable names the user must review in Buzz.
     */
    vscode.commands.registerCommand('atlasmind.buzz.copyAcpAgentSetup', async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        void vscode.window.showWarningMessage('Open the workspace this Buzz agent should be restricted to, then try again.');
        return;
      }

      let workspaceFolder = folders[0];
      if (folders.length > 1) {
        const picked = await vscode.window.showQuickPick(
          folders.map(folder => ({
            label: folder.name,
            description: folder.uri.fsPath,
            folder,
          })),
          {
            title: 'Choose the workspace for the Buzz-managed AtlasMind agent',
            placeHolder: 'The ACP process cannot leave this workspace.',
          },
        );
        if (!picked) {
          return;
        }
        workspaceFolder = picked.folder;
      }

      const launcherDirectory = await ensureAtlasMindCliOnTerminalPath(context);
      if (!launcherDirectory) {
        void vscode.window.showErrorMessage('AtlasMind could not create its ACP launcher. Rebuild or reinstall the extension and try again.');
        return;
      }

      try {
        const { buildBuzzAcpRuntimeSetup } = await import('./acp/buzzAcpSetup.js');
        const setup = buildBuzzAcpRuntimeSetup({
          workspaceRoot: workspaceFolder.uri.fsPath,
          runtimeExecutable: process.execPath,
          agentEntrypoint: path.join(launcherDirectory, 'atlasmind-acp-runner.js'),
        });
        await fs.stat(setup.buzzFields.agentCommand);
        await fs.stat(setup.buzzFields.agentArguments[0]);
        await vscode.env.clipboard.writeText(JSON.stringify(setup, null, 2));
        void vscode.window.showInformationMessage(
          'Copied the Buzz custom-agent fields. In Buzz, choose Provider → Custom command, paste the command and comma-separated arguments, and add ELECTRON_RUN_AS_NODE=1 plus one AtlasMind provider environment variable. Leave Buzz provider/model blank so AtlasMind routes them.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`AtlasMind could not prepare the Buzz ACP agent setup: ${message}`);
      }
    }),
    /**
     * Put a setup command into a terminal, ready to run — but do not run it.
     *
     * Spoon-feeding the command is the point: someone setting Buzz up for the
     * first time should not have to work out what to type. Pressing Enter stays
     * theirs, because these commands clone repositories and start containers,
     * and a button that did that silently would be a very different thing from
     * a button that saves you typing.
     *
     * Only commands AtlasMind itself wrote reach here — anything quoted from
     * Buzz's documentation is displayed for copying and never wired to a
     * button, since it is somebody else's text.
     */
    /**
     * Show the Buzz setup walkthrough in AtlasMind's own chat panel.
     *
     * Deterministic: the step is derived from observed configuration and
     * written straight into the transcript, so no model is asked anything and
     * no tools are in scope. A setup question never needed an agent.
     */
    vscode.commands.registerCommand('atlasmind.buzz.openGuide', async () => {
      const atlas = atlasContext;
      if (!atlas) { return; }
      const [{ buildBuzzSetupPlan, buzzStepChoices, buzzStepPosition, isBuzzInboundReady, nextBuzzSetupStep, renderBuzzStepMarkdown },
        { hasLauncherOnPath }, { BUZZ_AGENT_KEY_SECRET }, { parseAgentBindings }] = await Promise.all([
        import('./core/buzzSetupPlan.js'),
        import('./mcp/mcpEnvironmentScanner.js'),
        import('./core/buzzSigner.js'),
        import('./core/buzzAgentBindings.js'),
      ]);

      const cfg = vscode.workspace.getConfiguration('atlasmind');
      let hasAgentKey = false;
      try {
        hasAgentKey = Boolean((await context.secrets.get(BUZZ_AGENT_KEY_SECRET))?.trim());
      } catch { /* an unreadable store reads as "no key"; the remedy is the same */ }

      // The same key can already have been given to the Buzz MCP bridge, which
      // stores it under its own secret. Inbound reads a different one, so the
      // guide was correctly saying "no key" to someone who had supplied it —
      // technically right and completely unhelpful. Find it and offer to reuse it.
      const buzzServer = (atlas.mcpServerRegistry?.listServers() ?? [])
        .find((entry: { config: { id: string; name?: string } }) =>
          entry.config.id === 'mcp-server-buzz' || /buzz/i.test(entry.config.name ?? ''));
      let bridgeKeySecretId: string | undefined;
      if (!hasAgentKey && buzzServer) {
        const candidate = `atlasmind.mcp.${buzzServer.config.id}.BUZZ_PRIVATE_KEY`;
        try {
          if ((await context.secrets.get(candidate))?.trim()) {
            bridgeKeySecretId = candidate;
          }
        } catch { /* unreadable is the same as absent here */ }
      }

      const rawChannels = cfg.get<unknown>('buzz.inboundChannels', []);
      const steps = buildBuzzSetupPlan({
        cliOnPath: hasLauncherOnPath('buzz'),
        hasAgentKey,
        relayUrl: cfg.get<string>('buzz.relayUrl', ''),
        allowRemoteRelay: cfg.get<boolean>('buzz.allowRemoteRelay', false),
        enabled: cfg.get<boolean>('buzz.enabled', false),
        inboundEnabled: cfg.get<boolean>('buzz.inboundEnabled', false),
        channelIds: Array.isArray(rawChannels) ? rawChannels.filter((c): c is string => typeof c === 'string') : [],
        autoCreateFollowUps: cfg.get<boolean>('buzz.autoCreateFollowUps', false),
        mcpServerRegistered: (atlas.mcpServerRegistry?.listServers() ?? [])
          .some((entry: { config: { id: string; name?: string } }) =>
            entry.config.id === 'mcp-server-buzz' || /buzz/i.test(entry.config.name ?? '')),
        // The panel guide was omitting this, so a subscription that had actually
        // gone live still read as an unproven relay here while `/buzz` in chat
        // reported it correctly — the same guide disagreeing with itself.
        ...(atlas.buzzInbound ? { inboundStatus: atlas.buzzInbound.getStatus() } : {}),
        observedIdentities: atlas.buzzInbound?.listIdentities().length ?? 0,
        agentBindings: parseAgentBindings(cfg.get('buzz.agentBindings')).bindings.length,
        relayMode: cfg.get<'local' | 'hosted' | 'undecided'>('buzz.relayMode', 'undecided'),
      });

      const next = nextBuzzSetupStep(steps);
      const bridgeNote = bridgeKeySecretId && next?.id === 'agentKey'
        ? '\n\n> **You have already given this key to the Buzz MCP bridge.** Inbound reads a separate secret, so it does not see that one. Press **Reuse the key from the Buzz bridge** below and this step is done.'
        : '';
      // The last two steps are about making what arrives useful rather than
      // making it arrive, so say so — otherwise "2 steps left" reads as though
      // the connection itself is still broken.
      const readyNote = next && isBuzzInboundReady(steps)
        ? '\n\n> **The connection itself is already working** — Buzz is enabled, the relay is set, your key is stored, and the subscription is on. What is left is making what arrives useful.'
        : '';
      const body = !next
        ? '### Buzz setup — done\n\nReading Buzz is set up, a message has been seen arriving, and at least one Buzz identity is bound to an AtlasMind agent. That Director binding routes work; it does not create an executable Buzz agent. For automatic replies, run **AtlasMind: Copy Buzz ACP Agent Setup** and add the copied Custom command under **Buzz Settings → Agents**. Recording follow-ups, the CLI/MCP bridge, and the desktop app remain optional.'
        : renderBuzzStepMarkdown(next, buzzStepPosition(steps, next.id)) + readyNote + bridgeNote;

      // Its own session. Appending to whatever thread happened to be open put a
      // setup walkthrough in the middle of unrelated work and left the thread
      // titled after something else entirely.
      const existing = atlas.sessionConversation.listSessions()
        .find(session => session.title === BUZZ_GUIDE_SESSION_TITLE);
      const sessionId = existing?.id ?? atlas.sessionConversation.createSession(BUZZ_GUIDE_SESSION_TITLE);
      atlas.sessionConversation.selectSession(sessionId);
      atlas.sessionConversation.appendMessage('assistant', body, sessionId);
      await vscode.commands.executeCommand('atlasmind.openChatPanel', { sessionId });

      // The one question the guide cannot answer for itself, asked as chips.
      const { ChatPanel } = await import('./views/chatPanel.js');
      const relayMode = cfg.get<'local' | 'hosted' | 'undecided'>('buzz.relayMode', 'undecided');
      const choices = next ? buzzStepChoices(next, relayMode) : [];
      if (choices.length > 0) {
        await ChatPanel.currentPanel?.setGuideChoice({
          id: 'buzz-relay-mode',
          title: 'How do you want to run Buzz?',
          detail: 'The two paths need different things, so I will show only the one that applies.',
          options: choices,
        });
      } else if (next) {
        // The step's own actions, as buttons. Ids only cross the boundary; the
        // commands they map to are held extension-side.
        const actions = new Map<string, { command: string; args?: unknown[] }>();
        const options: Array<{ id: string; label: string }> = [];
        if (bridgeKeySecretId && next.id === 'agentKey') {
          actions.set('reuse-bridge-key', { command: 'atlasmind.buzz.reuseBridgeKey', args: [bridgeKeySecretId] });
          options.push({ id: 'reuse-bridge-key', label: 'Reuse the key from the Buzz bridge' });
        }
        if (next.action) {
          actions.set('primary', { command: next.action.command, ...(next.action.args ? { args: next.action.args } : {}) });
          options.push({ id: 'primary', label: next.action.title });
        }
        for (const line of next.guidance ?? []) {
          if (line.command && line.authored) {
            actions.set(line.command, { command: 'atlasmind.buzz.prepareCommand', args: [line.command] });
            options.push({ id: line.command, label: `Put \`${line.command}\` in a terminal` });
          }
        }
        await ChatPanel.currentPanel?.setGuideChoice(
          options.length > 0
            ? { id: 'buzz-guide', title: `Step ${buzzStepPosition(steps, next.id).index}: ${next.title}`, options }
            : undefined,
          actions,
        );
      } else {
        await ChatPanel.currentPanel?.setGuideChoice(undefined);
      }
    }),

    /**
     * Copy the key already stored for the Buzz MCP bridge into the secret that
     * inbound reads.
     *
     * The two are separate secrets for good reason — one belongs to a server
     * definition, one to the extension — but they hold the same key, and asking
     * someone to paste it twice because of an internal boundary is the kind of
     * thing that makes a setup guide feel broken. The button press is the
     * consent; both stores are the OS secret store, and nothing is displayed.
     */
    vscode.commands.registerCommand('atlasmind.buzz.reuseBridgeKey', async (secretId?: string) => {
      // Only a Buzz bridge secret, and only ever read from SecretStorage: a
      // command id is reachable from a webview, so the argument is checked
      // rather than trusted.
      if (typeof secretId !== 'string' || !/^atlasmind\.mcp\.[\w-]+\.BUZZ_PRIVATE_KEY$/.test(secretId)) {
        void vscode.window.showWarningMessage('That is not a Buzz bridge key, so nothing was copied.');
        return;
      }
      const value = (await context.secrets.get(secretId))?.trim();
      if (!value) {
        void vscode.window.showWarningMessage('No key is stored for the Buzz bridge.');
        return;
      }
      const { createBuzzEventSigner } = await import('./core/buzzSigner.js');
      const check = await createBuzzEventSigner(value);
      if (!check.ok) {
        // Never echo the key itself, only why it cannot be used.
        void vscode.window.showWarningMessage(`The bridge's key cannot be used for inbound: ${check.reason}`);
        return;
      }
      await context.secrets.store(BUZZ_AGENT_KEY_SECRET, value);
      void vscode.window.showInformationMessage('Buzz agent key set from the bridge configuration.');
      await vscode.commands.executeCommand('atlasmind.buzz.openGuide');
    }),

    vscode.commands.registerCommand('atlasmind.buzz.prepareCommand', async (command?: string) => {
      const text = typeof command === 'string' ? command.trim() : '';
      // The allowlist is the safety property: a command id is reachable from a
      // webview, so the payload cannot be trusted to be one AtlasMind authored.
      if (!text || !BUZZ_SETUP_COMMANDS.includes(text)) {
        void vscode.window.showWarningMessage('That is not a known AtlasMind setup command, so it was not prepared.');
        return;
      }
      const terminal = vscode.window.terminals.find((entry) => entry.name === 'Buzz setup')
        ?? vscode.window.createTerminal({ name: 'Buzz setup' });
      terminal.show(true);
      // `false` types the command without submitting it.
      terminal.sendText(text, false);
    }),

    // The same affordance as `buzz.prepareCommand`, for setup commands that are
    // not Buzz's. It exists because "run it once in a terminal and complete its
    // own login" is not an instruction anybody can act on when it names no
    // command — and the command AtlasMind knew was the launch one, which for
    // four of the five agents starts a JSON-RPC server that never shows a login.
    //
    // It still only *types*. Pressing Enter stays with the user, because an
    // extension silently running a command that opens a browser and asks for a
    // password is the shape of the thing this codebase refuses everywhere else.
    vscode.commands.registerCommand('atlasmind.setup.prepareCommand', async (command?: string) => {
      const text = typeof command === 'string' ? command.trim() : '';
      // Reachable from a webview, so the payload names a command rather than
      // being one: it has to appear in a list AtlasMind authored.
      const { ACP_SIGN_IN_COMMANDS } = await import('./providers/acp.js');
      const allowed = [...BUZZ_SETUP_COMMANDS, ...ACP_SIGN_IN_COMMANDS];
      if (!text || !allowed.includes(text)) {
        void vscode.window.showWarningMessage('That is not a known AtlasMind setup command, so it was not prepared.');
        return;
      }
      const terminal = vscode.window.terminals.find((entry) => entry.name === SETUP_TERMINAL_NAME)
        ?? vscode.window.createTerminal({ name: SETUP_TERMINAL_NAME });
      terminal.show(true);
      terminal.sendText(text, false);
    }),

    vscode.commands.registerCommand('atlasmind.setBuzzAgentKey', async () => {
      const existing = await context.secrets.get(BUZZ_AGENT_KEY_SECRET);
      const entered = await vscode.window.showInputBox({
        title: 'AtlasMind: Buzz agent key',
        prompt: existing
          ? 'Replace the stored Buzz agent key, or submit an empty value to remove it.'
          : 'Paste the Nostr secret key (nsec…) AtlasMind should sign Buzz messages with.',
        placeHolder: 'nsec1…',
        password: true,
        ignoreFocusOut: true,
      });
      if (entered === undefined) {
        return; // Cancelled — leave any stored key untouched.
      }
      const trimmed = entered.trim();
      if (!trimmed) {
        await context.secrets.delete(BUZZ_AGENT_KEY_SECRET);
        void vscode.window.showInformationMessage('AtlasMind removed the stored Buzz agent key.');
        await buzzInbound.sync();
        return;
      }
      await context.secrets.store(BUZZ_AGENT_KEY_SECRET, trimmed);
      void vscode.window.showInformationMessage(
        'AtlasMind stored the Buzz agent key in the OS secret store. It is passed to Buzz as an environment variable or used to sign relay authentication, and is never written to settings or project memory.',
      );
      await buzzInbound.sync();
    }),

    /**
     * Ask the Buzz CLI which channels exist, and offer them to tick.
     *
     * A channel id that does not match the channel you posted in is the most
     * common reason a correctly configured subscription receives nothing, and
     * it is undiagnosable from inside AtlasMind — the wrong id, the wrong relay,
     * and a quiet day are indistinguishable. The CLI knows the real ids, so ask
     * it rather than sending someone to copy one out of the app by hand.
     *
     * This is the one Buzz command that writes a setting, and every part of that
     * is the user's: they press the button, they tick the channels, and nothing
     * is stored if they dismiss the picker. It touches only the channel list —
     * never a gate, never a key.
     */
    vscode.commands.registerCommand('atlasmind.research.runScan', async (requestedScanId?: string) => {
      const atlas = atlasContext;
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!atlas || !root) {
        void vscode.window.showWarningMessage('Open a workspace folder before running a research scan.');
        return;
      }
      const cfg = vscode.workspace.getConfiguration('atlasmind');
      if (cfg.get<boolean>('research.enabled', false) !== true) {
        const choice = await vscode.window.showWarningMessage(
          'Research scans are switched off. They reach the network and spend on a model, so they are off by default.',
          'Open settings',
        );
        if (choice) {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'atlasmind.research.enabled');
        }
        return;
      }

      const [
        { RESEARCH_SCANS, isResearchScanId, researchScan },
        { runResearchScan },
        { appendResearchHistory },
      ] = await Promise.all([
        import('./core/researchScanCatalog.js'),
        import('./core/researchRunner.js'),
        import('./core/researchRegister.js'),
      ]);

      const sources = await resolveResearchSources();

      let scanId = isResearchScanId(requestedScanId) ? requestedScanId : undefined;
      if (!scanId) {
        const picked = await vscode.window.showQuickPick(
          RESEARCH_SCANS.map(scan => ({
            label: scan.label,
            detail: scan.question,
            description: scan.evidenceClass === 'hybrid' ? 'reads this repository too' : undefined,
            id: scan.id,
          })),
          { title: 'Run a research scan', placeHolder: sources.selected ? `Using ${sources.selected}` : 'No research source is configured' },
        );
        if (!picked) { return; }
        scanId = picked.id;
      }
      const scan = researchScan(scanId);

      // Outward-facing and it spends money, so it is confirmed the same way every
      // other outward action in AtlasMind is: modally, naming exactly what will
      // happen and with what.
      const confirmed = await vscode.window.showWarningMessage(
        `Run the ${scan.label} research scan?`,
        {
          modal: true,
          detail: [
            scan.question,
            '',
            sources.selected
              ? `Source: ${sources.selected}${sources.canDiscover ? '' : ' (can read a page you name, but cannot search)'}`
              : 'No research source is available — AtlasMind will record that it could not look rather than guessing.',
            `Agent: ${scan.agentId}. This reaches the network and uses your model budget.`,
            'Findings are recorded as open and need your triage. Nothing is written to the roadmap.',
          ].join('\n'),
        },
        'Run scan',
      );
      if (confirmed !== 'Run scan') { return; }

      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `AtlasMind: ${scan.label} research scan…`, cancellable: false },
        async () => runResearchScan(scanId!, {
          runAgent: async (agentId, prompt) => {
            const agent = atlas.agentRegistry.get(agentId);
            if (!agent) {
              return { ok: false as const, error: `The ${agentId} advisor is not available.` };
            }
            let streamed = '';
            try {
              const response = await atlas.orchestrator.processTaskWithAgent(
                {
                  id: `research-${scanId}-${Date.now()}`,
                  userMessage: prompt,
                  context: { researchScanMode: 'json' },
                  constraints: {
                    budget: (cfg.get<string>('budgetMode') ?? 'balanced') as never,
                    speed: (cfg.get<string>('speedMode') ?? 'balanced') as never,
                  },
                  timestamp: new Date().toISOString(),
                },
                agent,
                chunk => { streamed += chunk ?? ''; },
              );
              const text = `${streamed}\n${response.response ?? ''}`;
              return { ok: true as const, text, ...(typeof response.costUsd === 'number' ? { costUsd: response.costUsd } : {}) };
            } catch (error) {
              return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
            }
          },
          getRegister: () => atlas.researchRegisterManager.ensureLoaded(),
          saveRegister: async register => {
            await atlas.researchRegisterManager.save(register);
            atlas.researchRefresh.fire();
          },
          appendHistory: entry => appendResearchHistory(root, entry),
          sources,
          projectSummary: vscode.workspace.name ?? 'this project',
          roadmapTitles: await readRoadmapTitles(),
          now: new Date(),
        }),
      );

      const actions = result.outcome === 'no-source' && result.setupStep ? ['Open the register', 'How to fix'] : ['Open the register'];
      const choice = await vscode.window.showInformationMessage(result.message, ...actions);
      if (choice === 'Open the register') {
        void vscode.commands.executeCommand('atlasmind.research.openRegister');
      } else if (choice === 'How to fix' && result.setupStep) {
        void vscode.window.showInformationMessage(result.setupStep);
      }
    }),

    vscode.commands.registerCommand('atlasmind.research.openRegister', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { return; }
      const { RESEARCH_SUMMARY_SSOT_PATH } = await import('./core/researchRegister.js');
      const nodePath = await import('node:path');
      try {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(nodePath.join(root, RESEARCH_SUMMARY_SSOT_PATH)),
        );
        await vscode.window.showTextDocument(document, { preview: false });
      } catch {
        void vscode.window.showInformationMessage(
          'No research register yet. Run a scan and one is written the first time something is recorded.',
        );
      }
    }),

    vscode.commands.registerCommand('atlasmind.research.openDigest', async () => {
      const atlas = atlasContext;
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!atlas || !root) { return; }
      const [
        { buildResearchDigest, renderResearchDigestMarkdown },
        { buildResearchSchedule },
        { readResearchSettings },
      ] = await Promise.all([
        import('./core/researchDigest.js'),
        import('./core/researchSchedule.js'),
        import('./core/researchSettings.js'),
      ]);
      const nodePath = await import('node:path');
      const fsp = await import('node:fs/promises');

      const settings = readResearchSettings(vscode.workspace.getConfiguration('atlasmind'));
      const sources = await resolveResearchSources();
      const now = new Date();
      const register = atlas.researchRegisterManager.ensureLoaded(now);
      const schedule = buildResearchSchedule({
        enabled: settings.enabled,
        masterLevel: settings.automationLevel,
        scans: settings.scans,
        register,
        sourceAvailable: sources.selected !== undefined,
        monthlySpendCapUsd: settings.monthlySpendCapUsd,
        spentThisMonthUsd: 0,
        now,
      });
      // The baseline is per-developer, never the git-tracked SSOT: a shared one
      // would mean "when did *anybody* last read this", and would conflict
      // between two people on the same day. Same reason `observedDelta` says so
      // in its own module note.
      const baselineKey = 'atlasmind.research.digestBaseline';
      const stored = context.workspaceState.get<import('./core/researchDigest.js').ResearchDigestBaseline>(baselineKey);
      const scope = vscode.workspace.name ?? root;
      const digest = buildResearchDigest({ register, schedule, ...(stored ? { baseline: stored } : {}), scope, now });

      const target = nodePath.join(root, 'project_memory', 'analysis', 'research-digest.md');
      await fsp.mkdir(nodePath.dirname(target), { recursive: true });
      await fsp.writeFile(target, renderResearchDigestMarkdown(digest, now), 'utf-8');
      await context.workspaceState.update(baselineKey, digest.nextBaseline);

      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
      await vscode.window.showTextDocument(document, { preview: false });
    }),

    vscode.commands.registerCommand('atlasmind.buzz.fetchChannels', async () => {
      const cfg = vscode.workspace.getConfiguration('atlasmind');
      if (!cfg.get<boolean>('buzz.enabled', false)) {
        void vscode.window.showWarningMessage('Enable the Buzz integration first (Settings → Buzz).');
        return;
      }

      const privateKey = (await context.secrets.get(BUZZ_AGENT_KEY_SECRET))?.trim();
      if (!privateKey) {
        void vscode.window.showWarningMessage(
          'AtlasMind needs your Buzz agent key to ask the relay which channels you can see.',
          'Set Buzz agent key…',
        ).then(choice => {
          if (choice) {
            void vscode.commands.executeCommand('atlasmind.setBuzzAgentKey');
          }
        });
        return;
      }

      const [{ BuzzCliBridge, loadBuzzCliBridgeConfig }, { describeBuzzChannel, parseBuzzChannelList, resolveWatchedChannels }] =
        await Promise.all([
          import('./mcp/buzzCliBridge.js'),
          import('./core/buzzChannelCatalog.js'),
        ]);

      const rawWatched = cfg.get<unknown>('buzz.inboundChannels', []);
      const watched = Array.isArray(rawWatched) ? rawWatched.filter((id): id is string => typeof id === 'string') : [];

      const catalog = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'AtlasMind: reading your Buzz channels…', cancellable: true },
        async (_progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => controller.abort());
          try {
            // The same validated configuration the MCP bridge runs under: the
            // relay is normalised and remote-consent-checked, the key comes
            // from the secret store, and the binary is executed directly rather
            // than through a shell.
            const bridge = new BuzzCliBridge(loadBuzzCliBridgeConfig({
              ATLASMIND_BUZZ_ENABLED: 'true',
              ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY: cfg.get<boolean>('buzz.allowRemoteRelay', false) ? 'true' : 'false',
              BUZZ_RELAY_URL: cfg.get<string>('buzz.relayUrl', '') || 'http://localhost:3000',
              BUZZ_PRIVATE_KEY: privateKey,
            }));
            return parseBuzzChannelList(await bridge.listChannels(controller.signal));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(
              /ENOENT|Unable to start/i.test(message)
                ? 'AtlasMind could not run the Buzz CLI. Install it and put it on your PATH, then try again.'
                : `AtlasMind could not read your Buzz channels: ${message}`,
            );
            return undefined;
          }
        },
      );

      if (!catalog) {
        return;
      }
      if (catalog.channels.length === 0) {
        void vscode.window.showInformationMessage(
          'The relay returned no channels for your key. Join or create one in the Buzz app first.',
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        catalog.channels.map(channel => ({
          label: channel.name ?? channel.id,
          description: channel.name ? channel.id : undefined,
          picked: watched.includes(channel.id),
          id: channel.id,
        })),
        {
          title: 'Buzz channels to watch',
          placeHolder: catalog.skipped > 0
            ? `${catalog.channels.length} channels (${catalog.skipped} could not be read). Tick the ones to watch.`
            : 'Tick the channels AtlasMind should watch. Leave everything unticked to watch all of them.',
          canPickMany: true,
          ignoreFocusOut: true,
        },
      );
      if (!picked) {
        return; // Dismissed — nothing written.
      }

      const next = resolveWatchedChannels(watched, catalog.channels, picked.map(item => item.id));
      await cfg.update('buzz.inboundChannels', next, vscode.ConfigurationTarget.Workspace);
      await buzzInbound.sync();
      void vscode.window.showInformationMessage(
        next.length === 0
          ? 'AtlasMind is now watching every channel your Buzz key can read.'
          : `AtlasMind is now watching ${next.length} Buzz channel${next.length === 1 ? '' : 's'}: ${
            next.map(id => describeBuzzChannel(catalog.channels.find(c => c.id === id) ?? { id })).join(', ')}.`,
      );
    }),
  );

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (!atlasContext) {
      return;
    }
    if (event.affectsConfiguration('atlasmind.feedbackRoutingWeight')) {
      atlasContext.modelRouter.setFeedbackWeight(getConfiguredFeedbackRoutingWeight());
    }
    if (event.affectsConfiguration('atlasmind.localOpenAiEndpoints') || event.affectsConfiguration('atlasmind.localOpenAiBaseUrl')) {
      atlasContext.refreshProviderModels(true).then(() => {
        atlasContext!.modelsRefresh.fire();
      }).catch(() => {});
    }
    if (event.affectsConfiguration('atlasmind.acp.hideConsoleWindows')) {
      // The first explicit value turns a previously gated provider into a
      // configured one; a later change also alters the launch fingerprint.
      // Refresh from the same setting event so choosing through Settings or the
      // command palette does not leave ACP marked unhealthy until a reload.
      atlasContext.refreshProviderModels(true).then(() => {
        atlasContext!.modelsRefresh.fire();
      }).catch(() => {});
    }
    if (
      event.affectsConfiguration('atlasmind.maxToolIterations') ||
      event.affectsConfiguration('atlasmind.maxToolCallsPerTurn') ||
      event.affectsConfiguration('atlasmind.toolExecutionTimeoutMs') ||
      event.affectsConfiguration('atlasmind.providerTimeoutMs')
    ) {
      const cfg = vscode.workspace.getConfiguration('atlasmind');
      atlasContext.orchestrator.updateConfig({
        maxToolIterations: cfg.get<number>('maxToolIterations')!,
        maxToolCallsPerTurn: cfg.get<number>('maxToolCallsPerTurn')!,
        toolExecutionTimeoutMs: cfg.get<number>('toolExecutionTimeoutMs')!,
        providerTimeoutMs: cfg.get<number>('providerTimeoutMs')!,
      });
    }
    if (event.affectsConfiguration('atlasmind.displayCurrency')) {
      const ctx = atlasContext;
      void (async () => {
        const [
          { CostDashboardPanel },
          { ModelProviderPanel },
          { PersonalityProfilePanel },
        ] = await Promise.all([
          import('./views/costDashboardPanel.js'),
          import('./views/modelProviderPanel.js'),
          import('./views/personalityProfilePanel.js'),
        ]);
        if (CostDashboardPanel.currentPanel) {
          await CostDashboardPanel.currentPanel.refresh(ctx.costTracker);
        }
        if (ModelProviderPanel.currentPanel) {
          await ModelProviderPanel.currentPanel.refresh();
        }
        if (PersonalityProfilePanel.currentPanel) {
          await PersonalityProfilePanel.currentPanel.refresh();
        }
        ctx.projectRunsRefresh.fire();
      })();
    }
  }));

  runBackgroundActivationTask('connectMcpServers', outputChannel, async () => {
    await coreReady.mcpServerRegistry.connectAll();
  });
  runBackgroundActivationTask('refreshProviderModels', outputChannel, async () => {
    await atlasContext!.refreshProviderModels(true);
  });
  runBackgroundActivationTask('updateProviderStatusBar', outputChannel, async () => {
    await updateProviderStatusBar(coreReady.providerStatusBar, coreReady.providerRegistry, context.secrets, atlasContext!.modelRouter);
  });
  runBackgroundActivationTask('syncExchangeRates', outputChannel, async () => {
    await syncExchangeRates(context.globalState);
  });
  runBackgroundActivationTask('syncLocalModels', outputChannel, async () => {
    const cached = loadLocalModelSync(context.globalState);
    if (cached && !isLocalSyncStale(cached)) return;
    const result = await syncLocalModels();
    if (result.models.length > 0) {
      saveLocalModelSync(context.globalState, result);
      await atlasContext!.refreshProviderModels(false);
      outputChannel.appendLine(`[localModelSync] Synced ${result.models.length} local model(s) from ${result.reachableEndpoints.join(', ')}.`);
    }
  });
  runBackgroundActivationTask('syncLocalModelCatalog', outputChannel, async () => {
    await syncLocalModelCatalog(context.globalState, context.extensionPath);
  });

  // Periodically re-query the VS Code Language Model API so that Copilot models
  // newly made available in the user's subscription are discovered without
  // requiring a VS Code restart or manual refresh.  The `onDidChangeChatModels`
  // event fires when VS Code's LM registry changes, but the Copilot extension
  // may not broadcast the event for every subscription-level model addition.
  const COPILOT_PERIODIC_REFRESH_MS = 30 * 60 * 1000; // 30 minutes
  const copilotRefreshTimer = setInterval(() => {
    void (async () => {
      outputChannel.appendLine('[providers] Periodic Copilot model refresh starting…');
      try {
        await atlasContext!.refreshProviderModels(true);
        await atlasContext!.refreshProviderHealth();
        outputChannel.appendLine('[providers] Periodic Copilot model refresh complete.');
      } catch (error) {
        outputChannel.appendLine(
          `[providers] Periodic Copilot model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  }, COPILOT_PERIODIC_REFRESH_MS);
  context.subscriptions.push({ dispose: () => clearInterval(copilotRefreshTimer) });
}

/**
 * The local GPU arbiter's settings, read fresh on every call.
 *
 * Module-level so the construction site and the configuration-change listener
 * share one definition; a second copy would drift the moment a default changed.
 */
function readLocalGpuConfig() {
  const cfg = vscode.workspace.getConfiguration('atlasmind');
  const mib = 1024 * 1024;
  return {
    enabled: cfg.get<boolean>('localGpu.enabled', true),
    maxConcurrentRequests: cfg.get<number>('localGpu.maxConcurrentRequests', LOCAL_GPU_MAX_CONCURRENT_REQUESTS),
    maxAdmissionWaitMs: LOCAL_GPU_ADMISSION_WAIT_MS,
    safetyMarginBytes: Math.max(0, cfg.get<number>('localGpu.safetyMarginMb', 2048)) * mib,
    reserveBytes: Math.max(0, cfg.get<number>('localGpu.reserveMb', 3072)) * mib,
    maxOwnedResidentModels: cfg.get<number>('localGpu.maxResidentModelsWhenUnmeasured', LOCAL_GPU_MAX_OWNED_RESIDENT_MODELS),
    residencyPollIntervalMs: LOCAL_GPU_RESIDENCY_POLL_MS,
    evictOwnModels: cfg.get<boolean>('localGpu.evictOwnModels', true),
    evictionCooldownMs: LOCAL_GPU_EVICTION_COOLDOWN_MS,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  configureCurrencyFormatter(
    () => vscode.workspace.getConfiguration('atlasmind').get<string>('displayCurrency', 'USD'),
  );
  // Set global context key for activation state
  (globalThis as any).atlasmindActivating = true;
  // Detect and save user environment on activation
  const envManager = new EnvironmentManager(context);
  void envManager.saveCurrentEnvironment();
  const outputChannel = vscode.window.createOutputChannel('AtlasMind');
  outputChannel.appendLine('AtlasMind activating…');
  atlasContext = undefined;
  atlasStartupState = {
    status: 'booting',
    phase: 'bootstrapAtlasMind',
    startedAt: Date.now(),
  };

  void ensureAtlasMindCliOnTerminalPath(context, outputChannel);
  void bootstrapAtlasMind(context, outputChannel).then(() => {
    (globalThis as any).atlasmindActivating = false;
    // Trigger all sidebar tree view refreshes to update UI state
    if (atlasContext) {
      atlasContext.agentsRefresh.fire();
      atlasContext.skillsRefresh.fire();
      atlasContext.modelsRefresh.fire();
      atlasContext.projectRunsRefresh?.fire();
      atlasContext.memoryRefresh.fire();
    } else {
      // Bootstrap finished but the core context was never assigned — a build step
      // (typically `buildAtlasContext`) failed and was caught/logged but not
      // surfaced. Make it visible instead of leaving every atlas-dependent
      // command (every chat-view title icon except Settings) silently no-op.
      atlasStartupState = { status: 'failed', phase: atlasStartupState.phase, startedAt: atlasStartupState.startedAt };
      outputChannel.appendLine('[activate] AtlasMind core services did not initialise; startup did not complete. See the failing activation step above for the error.');
      void vscode.window.showErrorMessage(
        'AtlasMind did not finish starting up — core services failed to initialise, so its panels and dashboards will not open. Open the "AtlasMind" output channel for the underlying error.',
        'Show Output',
      ).then(choice => { if (choice === 'Show Output') { outputChannel.show(true); } });
    }
  }).catch((error: unknown) => {
    (globalThis as any).atlasmindActivating = false;
    const message = error instanceof Error ? error.message : String(error);
    atlasStartupState = { status: 'failed', phase: atlasStartupState.phase, startedAt: atlasStartupState.startedAt };
    outputChannel.appendLine(`[activate] AtlasMind activation threw: ${message}`);
    void vscode.window.showErrorMessage(
      `AtlasMind failed to start: ${message}. Open the "AtlasMind" output channel for details.`,
      'Show Output',
    ).then(choice => { if (choice === 'Show Output') { outputChannel.show(true); } });
  });
}

type CliPathContext = Pick<vscode.ExtensionContext, 'extensionUri' | 'globalStorageUri' | 'environmentVariableCollection'>;
type LogSink = Pick<vscode.OutputChannel, 'appendLine'>;

export async function ensureAtlasMindCliOnTerminalPath(
  context: CliPathContext,
  outputChannel?: LogSink,
): Promise<string | undefined> {
  const cliEntryPath = vscode.Uri.joinPath(context.extensionUri, 'out', 'cli', 'main.js').fsPath;
  const acpEntryPath = vscode.Uri.joinPath(context.extensionUri, 'out', 'cli', 'acpAgent.js').fsPath;
  try {
    await fs.stat(cliEntryPath);
  } catch {
    outputChannel?.appendLine('[activate] cliPath skipped; CLI entrypoint is missing from the extension bundle');
    return undefined;
  }

  const binDir = path.join(context.globalStorageUri.fsPath, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await writeAtlasMindCliShims(binDir, 'atlasmind', cliEntryPath, process.execPath);
  try {
    await fs.stat(acpEntryPath);
    await writeAtlasMindCliShims(binDir, 'atlasmind-acp', acpEntryPath, process.execPath);
    await writeAtlasMindAcpRunner(binDir, acpEntryPath);
  } catch {
    outputChannel?.appendLine('[activate] cliPath did not add atlasmind-acp; ACP entrypoint is missing from the extension bundle');
  }

  const pathVariable = process.platform === 'win32' ? 'Path' : 'PATH';
  context.environmentVariableCollection.description = 'AtlasMind CLI for VS Code integrated terminals';
  context.environmentVariableCollection.persistent = true;
  context.environmentVariableCollection.prepend(pathVariable, `${binDir}${path.delimiter}`);

  outputChannel?.appendLine(`[activate] cliPath enabled AtlasMind launchers in new integrated terminals via ${binDir}`);
  return binDir;
}

async function writeAtlasMindCliShims(
  binDir: string,
  launcherName: 'atlasmind' | 'atlasmind-acp',
  cliEntryPath: string,
  runtimeExecutable: string,
): Promise<void> {
  const shellShimPath = path.join(binDir, launcherName);
  const cmdShimPath = path.join(binDir, `${launcherName}.cmd`);

  const shellScript = [
    '#!/usr/bin/env sh',
    `ELECTRON_RUN_AS_NODE=1 exec ${toShellSingleQuoted(runtimeExecutable)} ${toShellSingleQuoted(cliEntryPath)} "$@"`,
    '',
  ].join('\n');
  const cmdScript = [
    '@echo off',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${runtimeExecutable}" "${cliEntryPath}" %*`,
    '',
  ].join('\r\n');

  await Promise.all([
    fs.writeFile(shellShimPath, shellScript, 'utf8'),
    fs.writeFile(cmdShimPath, cmdScript, 'utf8'),
  ]);
  await fs.chmod(shellShimPath, 0o755);
}

async function writeAtlasMindAcpRunner(binDir: string, acpEntryPath: string): Promise<void> {
  const runnerPath = path.join(binDir, 'atlasmind-acp-runner.js');
  const script = [
    "'use strict';",
    `const entry = require(${JSON.stringify(acpEntryPath)});`,
    'void entry.runAcpAgentCli().then(',
    '  code => { process.exitCode = code; },',
    '  error => {',
    "    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\\n`);",
    '    process.exitCode = 1;',
    '  },',
    ');',
    '',
  ].join('\n');
  await fs.writeFile(runnerPath, script, 'utf8');
}

function toShellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function updateProviderStatusBar(
  statusBar: vscode.StatusBarItem,
  registry: ProviderRegistry,
  secrets: vscode.SecretStorage,
  modelRouter: ModelRouter,
): Promise<void> {
  const adapters = registry.list();
  let configured = 0;
  let healthy = 0;

  for (const adapter of adapters) {
    if (adapter.providerId === 'copilot') {
      if (modelRouter.isProviderHealthy('copilot')) {
        configured++;
        healthy++;
      }
      continue;
    }
    try {
      if (adapter.providerId === 'local') {
        const configuredEndpoints = getConfiguredLocalEndpoints({
          getEndpoints: () => vscode.workspace.getConfiguration('atlasmind').get<unknown>('localOpenAiEndpoints'),
          getLegacyBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
        });
        if (configuredEndpoints.length > 0) {
          configured++;
        }
        if (await adapter.healthCheck()) {
          healthy++;
        }
        continue;
      }

      const key = await secrets.get(`atlasmind.provider.${adapter.providerId}.apiKey`);
      if (key) {
        configured++;
        const models = await adapter.listModels();
        if (models.length > 0) { healthy++; }
      }
    } catch {
      // Provider unreachable
    }
  }

  if (healthy === 0 && configured === 0) {
    statusBar.text = '$(warning) Atlas: No providers';
    statusBar.tooltip = 'No API keys configured. Click to set up a provider.';
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else if (healthy < configured) {
    statusBar.text = `$(warning) Atlas: ${healthy}/${configured}`;
    statusBar.tooltip = `${healthy} of ${configured} configured provider(s) are reachable.`;
    statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBar.text = `$(check) Atlas: ${healthy} provider(s)`;
    statusBar.tooltip = `${healthy} provider(s) online and ready.`;
    statusBar.backgroundColor = undefined;
  }
}

function buildGeneratedSkillReviewContent(skillId: string, scanResult: SkillScanResult, source: string): string {
  const warningLines = scanResult.issues
    .filter(issue => issue.severity === 'warning')
    .map(issue => `- Line ${issue.line} [${issue.rule}]: ${issue.message}`)
    .join('\n');
  const previewSource = source.length > 900 ? `${source.slice(0, 900)}\n// ...truncated for review ...` : source;

  return [
    `Skill id: ${skillId}`,
    'This draft triggered warning-level scan findings and would run inside the extension host if you approve it.',
    '',
    'Warning summary:',
    warningLines || '- No warning details were captured.',
    '',
    'Draft preview:',
    previewSource,
    '',
    'Choose Allow Once to run it a single time, or Keep Blocked to refine the request in chat.',
  ].join('\n');
}

async function requestGeneratedSkillApproval(
  skillId: string,
  scanResult: SkillScanResult,
  source: string,
  toolApprovalManager?: ToolApprovalManager,
): Promise<{ approved: boolean; reason?: string }> {
  const warnings = scanResult.issues.filter(issue => issue.severity === 'warning');
  if (warnings.length === 0) {
    return { approved: true };
  }

  if (!toolApprovalManager) {
    return { approved: false, reason: 'Generated skill review UI is unavailable right now.' };
  }

  void import('./views/chatPanel.js').then(({ revealPreferredChatSurface }) => revealPreferredChatSurface({ preserveFocus: true }));
  const decision = await toolApprovalManager.requestApproval({
    taskId: `generated-skill:${skillId}`,
    toolName: `generated-skill/${skillId}`,
    category: 'workspace-write',
    risk: 'medium',
    title: 'Generated skill review required',
    summary: `AtlasMind drafted "${skillId}" with ${warnings.length} warning-level scan finding(s). Approve it once, or keep it blocked and refine the request in chat.`,
    detail: buildGeneratedSkillReviewContent(skillId, scanResult, source),
    allowedDecisions: ['allow-once', 'deny'],
    decisionLabels: {
      'allow-once': 'Allow Once',
      deny: 'Keep Blocked',
    },
  });

  if (decision === 'allow-once') {
    return { approved: true };
  }

  return { approved: false, reason: 'Generated skill draft kept blocked for refinement.' };
}

function updateAutopilotStatusBar(
  statusBar: vscode.StatusBarItem,
  toolApprovalManager: ToolApprovalManager,
): void {
  if (!toolApprovalManager.isAutopilot()) {
    statusBar.hide();
    return;
  }

  statusBar.text = '$(rocket) Atlas Autopilot';
  statusBar.tooltip = 'AtlasMind Autopilot is enabled for this session. Click to disable it.';
  statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  statusBar.show();
}

export function deactivate(): void {
  atlasContext = undefined;
}

/** Per-provider timeout for startup model discovery, so one slow provider can't stall the rest. */
const STARTUP_PROVIDER_DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * ACP's budget, which cannot be the same number.
 *
 * Every other provider's health check is an HTTP round trip. ACP's spawns a
 * process per configured agent and asks each to open a session, because that is
 * the only question whose answer means "signed in" — measured at ~7s for
 * `claude-agent-acp` and ~4s for `codex-acp` on a warm machine, before the
 * contention of extension activation. The adapter allows
 * {@link ACP_PROBE_TIMEOUT_MS} per probe, so a 10s enclosing budget guaranteed
 * the timeout fired first on a perfectly healthy install — and the timeout's
 * handler sets provider health to false. Nothing re-probes afterwards, so a
 * startup blip became a permanent "agent not responding".
 *
 * Derived from the adapter's own ceiling rather than restated, because the bug
 * was precisely two numbers in two files drifting past each other. The probes
 * run concurrently, so the headroom is for one slow agent plus the surrounding
 * discovery work, not for their sum.
 */
const ACP_DISCOVERY_TIMEOUT_MS = ACP_PROBE_TIMEOUT_MS * 2 + 5_000;

/** How long this provider's discovery may take before it is abandoned. */
function providerDiscoveryTimeoutMs(providerId: string): number {
  return providerId === 'acp' ? ACP_DISCOVERY_TIMEOUT_MS : STARTUP_PROVIDER_DISCOVERY_TIMEOUT_MS;
}

/**
 * Delay before the activation-time workspace memory freshness scan runs. The scan
 * walks the whole repo to fingerprint imported sources (seconds on a large
 * workspace) purely to light up the "Update Memory" badge, so it is pushed off
 * the startup-critical window. The on-save file watcher keeps freshness current
 * thereafter; this one-shot scan only catches edits made while VS Code was closed.
 */
const MEMORY_FRESHNESS_STARTUP_DELAY_MS = 8_000;

/**
 * Resolves to the promise's value, or to `onTimeout()` if it does not settle within
 * `ms`. The original promise is left to settle in the background (its result is
 * ignored) — used to bound provider discovery without aborting in-flight work.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(onTimeout()); }
    }, ms);
    promise.then(
      value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(onTimeout()); } },
    );
  });
}

export async function refreshProviderModelsCatalog(
  modelRouter: ModelRouter,
  providerRegistry: ProviderRegistry,
  outputChannel?: vscode.OutputChannel,
  options?: {
    includeInteractiveProviders?: boolean;
    globalState?: vscode.Memento;
    /** When provided, providers that report not-configured are skipped (no health check, no discovery). */
    isProviderConfigured?: (providerId: string) => Promise<boolean>;
  },
): Promise<{ providersUpdated: number; modelsAvailable: number }> {
  const providers = modelRouter.listProviders();
  let providersUpdated = 0;
  let modelsAvailable = 0;
  const includeInteractiveProviders = options?.includeInteractiveProviders ?? true;

  // Refresh Copilot AI credits pricing from the GitHub docs page.
  // We run this once per catalog refresh so the data stays current without
  // requiring a separate scheduled task.
  let multiplierSync: MultiplierSyncResult | undefined;
  if (options?.globalState) {
    multiplierSync = await refreshCopilotMultiplierSync(options.globalState, outputChannel);
  }
  const multiplierOverrides = readPremiumMultiplierOverrides();
  const localSync = options?.globalState ? loadLocalModelSync(options.globalState) : undefined;

  // Refresh per-token pricing from each provider's public pricing docs page.
  // Runs in parallel for all active providers that have a known pricing page spec.
  // Results are cached (7-day TTL) so most refreshes are instant cache reads.
  const activeProviderIds = providers.filter(p => p.enabled).map(p => p.id);
  const pricingSyncResults: Map<string, ProviderPricingSyncResult> = options?.globalState
    ? await refreshAllProviderPricingSync(options.globalState, activeProviderIds, outputChannel)
    : new Map();

  const processProvider = async (provider: (typeof providers)[number]): Promise<{ updated: boolean; modelEntries: number }> => {
    if (!provider.enabled) {
      return { updated: false, modelEntries: 0 };
    }
    if (!includeInteractiveProviders && requiresExplicitProviderActivation(provider.id)) {
      modelRouter.setProviderHealth(provider.id, false);
      outputChannel?.appendLine(`[providers] Deferred ${provider.id} discovery until the user explicitly activates that provider.`);
      return { updated: false, modelEntries: provider.models.length };
    }

    const adapter = providerRegistry.get(provider.id);
    if (!adapter) {
      outputChannel?.appendLine(`[providers] ${provider.id}: no adapter registered; skipping discovery.`);
      return { updated: false, modelEntries: provider.models.length };
    }

    // Skip providers the user hasn't configured (no API key / credentials) before
    // any health check — this avoids slow network probes for unconfigured providers
    // (e.g. Bedrock). Interactive providers (Copilot / Claude CLI) are excluded from
    // this check since their "configured" state is their own (slow) health probe and
    // they are already deferred above when not explicitly activated.
    if (options?.isProviderConfigured && !requiresExplicitProviderActivation(provider.id)) {
      const configured = await options.isProviderConfigured(provider.id);
      if (!configured) {
        modelRouter.setProviderHealth(provider.id, false);
        outputChannel?.appendLine(`[providers] ${provider.id}: not configured (no credentials); skipping discovery.`);
        return { updated: false, modelEntries: provider.models.length };
      }
    }

    try {
      const healthy = await adapter.healthCheck();
      modelRouter.setProviderHealth(provider.id, healthy);
      if (!healthy) {
        outputChannel?.appendLine(`[providers] ${provider.id} health check failed; provider remains registered but will be deprioritized/excluded.`);
      }

      // Prefer discoverModels() for rich metadata; fall back to listModels().
      let discoveredHints: DiscoveredModel[] | undefined;
      let discoveredIds: string[];

      outputChannel?.appendLine(`[providers] ${provider.id}: starting model discovery (healthy=${healthy}).`);

      if (adapter.discoverModels) {
        discoveredHints = await adapter.discoverModels();
        discoveredIds = discoveredHints.map(d => d.id);
      } else {
        discoveredIds = await adapter.listModels();
      }

      outputChannel?.appendLine(`[providers] ${provider.id}: discovered ${discoveredIds.length} model(s).`);

      if (discoveredIds.length === 0) {
        // A successful, healthy discovery is authoritative even when empty.
        // Keeping the previous array here made removed models survive every
        // Settings refresh. Discovery exceptions/timeouts are handled below and
        // still preserve the last known catalog.
        modelRouter.registerProvider({ ...provider, models: [] });
        modelRouter.clearProviderFailures(provider.id);
        outputChannel?.appendLine(`[providers] ${provider.id}: discovery returned 0 models; pruned ${provider.models.length} stale model(s).`);
        return { updated: true, modelEntries: 0 };
      }

      const normalized = [...new Set(discoveredIds.map(modelId => normalizeModelId(provider.id, modelId)))]
        .filter(modelId => !modelRouter.isModelRetired(modelId));
      const hintsById = new Map<string, DiscoveredModel>();
      if (discoveredHints) {
        for (const hint of discoveredHints) {
          hintsById.set(normalizeModelId(provider.id, hint.id), hint);
        }
      }

      const providerPricingSync = pricingSyncResults.get(provider.id);
      const merged = mergeProviderModels(provider, normalized, hintsById, multiplierSync, multiplierOverrides, localSync, providerPricingSync);
      modelRouter.registerProvider({ ...provider, models: merged });
      // Clear transient failures after a successful authoritative refresh, but
      // retain provider-confirmed removal/deprecation tombstones.
      modelRouter.clearProviderFailures(provider.id);
      outputChannel?.appendLine(`[providers] ${provider.id}: registered ${merged.length} model(s) after merge.`);
      return { updated: true, modelEntries: merged.length };
    } catch (err) {
      outputChannel?.appendLine(
        `[providers] Model refresh failed for ${provider.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return { updated: false, modelEntries: provider.models.length };
    }
  };

  // Discover all providers concurrently, each bounded by a per-provider timeout so
  // one slow or hanging provider cannot stall the whole refresh. Previously a serial
  // loop — ~24 providers' multi-second health checks summed to nearly a minute of the
  // `[providers]` startup stream; concurrency collapses that to roughly the slowest
  // single provider (capped at the timeout).
  const results = await Promise.all(providers.map(provider => {
    const budgetMs = providerDiscoveryTimeoutMs(provider.id);
    return withTimeout(
      processProvider(provider),
      budgetMs,
      () => {
        modelRouter.setProviderHealth(provider.id, false);
        outputChannel?.appendLine(`[providers] ${provider.id}: discovery exceeded ${budgetMs}ms; keeping existing models and deprioritizing until the next refresh.`);
        return { updated: false, modelEntries: provider.models.length };
      },
    );
  }));

  for (const result of results) {
    if (result.updated) {
      providersUpdated += 1;
    }
    modelsAvailable += result.modelEntries;
  }

  outputChannel?.appendLine(
    `[providers] Refreshed models: ${providersUpdated}/${providers.length} providers, ` +
    `${modelsAvailable} total model entries.`,
  );
  return { providersUpdated, modelsAvailable };
}

/**
 * Fetch fresh Copilot multiplier data if the cached copy is missing or stale.
 * Returns the most current available result (fresh or cached).
 */
async function refreshCopilotMultiplierSync(
  globalState: vscode.Memento,
  outputChannel?: vscode.OutputChannel,
): Promise<MultiplierSyncResult | undefined> {
  const cached = loadCopilotMultiplierSync(globalState);

  // Use the cache if it is fresh enough.
  if (cached && !isSyncStale(cached)) {
    return cached;
  }

  outputChannel?.appendLine('[providers] Fetching Copilot premium-request multiplier table…');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const fresh = await fetchCopilotMultipliers(controller.signal);
    if (fresh) {
      saveCopilotMultiplierSync(globalState, fresh);
      const staleDays = Math.round(MULTIPLIER_CACHE_STALE_MS / (24 * 60 * 60 * 1000));
      outputChannel?.appendLine(
        `[providers] Copilot multiplier sync: ${fresh.modelCount} models updated (next sync in ${staleDays}d). ` +
        `Source: ${COPILOT_MULTIPLIER_DOCS_URL}`,
      );
      return fresh;
    }
  } catch {
    // Network failure — fall back to cached data even if stale.
  } finally {
    clearTimeout(timeout);
  }

  if (cached) {
    outputChannel?.appendLine('[providers] Copilot multiplier sync failed; using cached data.');
  } else {
    outputChannel?.appendLine('[providers] Copilot multiplier sync failed; using static catalog values.');
  }
  return cached;
}

function normalizeModelId(providerId: ProviderId, modelId: string): string {
  const trimmed = modelId.trim();
  const withoutModelsPrefix = trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
  if (withoutModelsPrefix.startsWith(`${providerId}/`)) {
    return withoutModelsPrefix;
  }
  return `${providerId}/${withoutModelsPrefix}`;
}

function stripProviderPrefix(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

function getConfiguredAzureOpenAiEndpoint(): string {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string>(AZURE_OPENAI_ENDPOINT_SETTING, '');
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

function getConfiguredAzureOpenAiDeployments(): string[] {
  const value = vscode.workspace.getConfiguration('atlasmind').get<string[]>(AZURE_OPENAI_DEPLOYMENTS_SETTING, []);
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(item => item.length > 0);
}

function mergeProviderModels(
  provider: ProviderConfig,
  discoveredModelIds: string[],
  hints?: Map<string, DiscoveredModel>,
  multiplierSync?: MultiplierSyncResult,
  multiplierOverrides?: Record<string, number>,
  localSync?: LocalModelSyncResult,
  pricingSync?: ProviderPricingSyncResult,
): ModelInfo[] {
  const existingById = new Map(provider.models.map(model => [model.id, model]));
  const discoveredSet = new Set(discoveredModelIds);

  // The discovered set is authoritative: models that have disappeared from the
  // live API are pruned so deprecated/retired models stop being routed to.
  // Static-only providers never call this function so their models are unaffected.
  const localSyncById = new Map(
    provider.id === 'local' ? (localSync?.models ?? []).map(m => [m.id, m]) : [],
  );

  return discoveredModelIds
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map(modelId => {
      const hint = hints?.get(modelId);
      const existing = existingById.get(modelId);
      const catalogEntry = lookupCatalog(provider.id, modelId);
      const liveMeta = localSyncById.get(modelId);

      // Dynamic pricing sync (live docs scrape) takes priority over static catalog.
      // For Copilot, also consult the tokenPrices from the multiplier sync.
      const dynamicPricing: ProviderPricingEntry | undefined =
        (pricingSync ? resolveProviderPricing(modelId, pricingSync) : undefined) ??
        (provider.id === 'copilot' && multiplierSync?.tokenPrices
          ? resolveProviderPricing(modelId, {
              entries: Object.fromEntries(
                Object.entries(multiplierSync.tokenPrices).map(([k, v]) => [k, v]),
              ),
              syncedAt: multiplierSync.syncedAt,
              sourceUrl: COPILOT_MULTIPLIER_DOCS_URL,
              modelCount: Object.keys(multiplierSync.tokenPrices).length,
            })
          : undefined);

      // Resolve premiumRequestMultiplier with priority:
      //   userOverride > remoteSync > hint > catalog > existing
      const resolvedMultiplier = resolvePremiumMultiplier(
        modelId, multiplierSync, multiplierOverrides,
        hint?.premiumRequestMultiplier ?? catalogEntry?.premiumRequestMultiplier ?? existing?.premiumRequestMultiplier,
      );

      if (existing) {
        // Re-apply live pricing on every refresh so price changes take effect
        // immediately rather than being frozen from first discovery.
        // Priority: API hint > live pricing sync > static catalog > existing cached value.
        const specialistDomains = mergeSpecialistDomains(existing.specialistDomains, hint?.specialistDomains);
        return {
          ...existing,
          contextWindow: liveMeta?.contextWindow ?? hint?.contextWindow ?? dynamicPricing?.contextWindow ?? catalogEntry?.contextWindow ?? existing.contextWindow,
          name: liveMeta?.name ?? hint?.name ?? catalogEntry?.name ?? existing.name,
          capabilities: liveMeta?.capabilities ?? hint?.capabilities ?? catalogEntry?.capabilities ?? existing.capabilities,
          delegatedToolExecution: hint?.delegatedToolExecution ?? existing.delegatedToolExecution,
          inputPricePer1k: hint?.inputPricePer1k ?? dynamicPricing?.inputPer1k ?? catalogEntry?.inputPricePer1k ?? existing.inputPricePer1k,
          outputPricePer1k: hint?.outputPricePer1k ?? dynamicPricing?.outputPer1k ?? catalogEntry?.outputPricePer1k ?? existing.outputPricePer1k,
          ...(resolvedMultiplier !== undefined ? { premiumRequestMultiplier: resolvedMultiplier } : {}),
          ...(specialistDomains.length > 0 ? { specialistDomains } : {}),
        };
      }

      const inferred = inferModelMetadata(provider.id, modelId, hint, liveMeta, dynamicPricing);
      return resolvedMultiplier !== undefined
        ? { ...inferred, premiumRequestMultiplier: resolvedMultiplier }
        : inferred;
    })
    .filter(model => discoveredSet.has(model.id));
}

/**
 * Resolve the effective premium-request multiplier for a model using
 * the priority chain: user override > remote sync > fallback (catalog/hint/existing).
 */
function resolvePremiumMultiplier(
  modelId: string,
  multiplierSync: MultiplierSyncResult | undefined,
  multiplierOverrides: Record<string, number> | undefined,
  fallback: number | undefined,
): number | undefined {
  // 1. User override — key is a case-insensitive substring of the model ID.
  if (multiplierOverrides && Object.keys(multiplierOverrides).length > 0) {
    const normId = modelId.toLowerCase();
    for (const [key, value] of Object.entries(multiplierOverrides)) {
      if (normId.includes(key) || key.includes(normId)) {
        return value;
      }
    }
  }

  // 2. Remote sync result from GitHub docs.
  if (multiplierSync) {
    const synced = resolveMultiplier(modelId, multiplierSync);
    if (synced !== undefined) {
      return synced;
    }
  }

  // 3. Static catalog / hint / existing value.
  return fallback;
}

/**
 * Infer model metadata for a newly-discovered model ID.
 *
 * Resolution order:
 * 1. Values from the `DiscoveredModel` hint (runtime API data).
 * 2. Well-known model catalog lookup.
 * 3. Substring-based heuristic fallback.
 */
export function inferModelMetadata(
  providerId: ProviderId,
  modelId: string,
  hint?: DiscoveredModel,
  liveMeta?: import('./providers/localModelSync.js').LocalModelMeta,
  dynamicPricing?: ProviderPricingEntry,
): ModelInfo {
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const catalogEntry = lookupCatalog(providerId, modelId);
  const isLocalProvider = providerId === 'local';

  // Merge sources: liveMeta > hint > dynamicPricing (live scrape) > catalog > heuristic
  const name = liveMeta?.name ?? hint?.name ?? catalogEntry?.name ?? toDisplayModelName(shortId);
  const contextWindow = liveMeta?.contextWindow ?? hint?.contextWindow ?? dynamicPricing?.contextWindow ?? catalogEntry?.contextWindow ?? inferContextWindow(shortId);
  const capabilities = liveMeta?.capabilities ?? hint?.capabilities ?? catalogEntry?.capabilities ?? inferCapabilities(shortId, isLocalProvider);
  const delegatedToolExecution = hint?.delegatedToolExecution;
  const specialistDomains = mergeSpecialistDomains(
    catalogEntry?.specialistDomains,
    hint?.specialistDomains,
    inferSpecialistDomains(shortId, capabilities),
  );
  const inputPricePer1k = isLocalProvider ? 0 : (hint?.inputPricePer1k ?? dynamicPricing?.inputPer1k ?? catalogEntry?.inputPricePer1k ?? inferPricing(shortId).input);
  const outputPricePer1k = isLocalProvider ? 0 : (hint?.outputPricePer1k ?? dynamicPricing?.outputPer1k ?? catalogEntry?.outputPricePer1k ?? inferPricing(shortId).output);
  const premiumRequestMultiplier = hint?.premiumRequestMultiplier ?? catalogEntry?.premiumRequestMultiplier;
  // Carry the catalog's authoritative routing annotations through the merge.
  // Without these, every model populated via discovery loses its reasoning depth
  // and latency class, so the router falls back to heuristics — collapsing genuine
  // depth-3 reasoners (Opus, DeepSeek R1, Nemotron Ultra) to depth 2 and under-
  // ranking them for high-reasoning tasks.
  // Catalog first, because it is the curated answer for every model that has
  // one. The hint is the fallback for models the catalog cannot know about —
  // an ACP effort variant's depth is a property of the tier the agent offered
  // on this session, not of a model name anybody could enumerate in advance.
  const reasoningDepth = catalogEntry?.reasoningDepth ?? hint?.reasoningDepth;
  const latencyClass = catalogEntry?.latencyClass;
  // Cache capability is dynamic — providers change model capabilities over time.
  // Prefer the runtime discovery hint and live pricing scrape over the static
  // catalog so the router tracks those changes; an explicit hint `false`
  // overrides the catalog. The router still applies a provider-set bootstrap
  // fallback when no source has annotated the model yet.
  const supportsPromptCaching = hint?.supportsPromptCaching ?? catalogEntry?.supportsPromptCaching;
  const cachedInputPricePer1k = isLocalProvider
    ? undefined
    : (hint?.cachedInputPricePer1k ?? dynamicPricing?.cachedInputPer1k ?? catalogEntry?.cachedInputPricePer1k);

  return {
    id: modelId,
    provider: providerId,
    name,
    contextWindow,
    inputPricePer1k,
    outputPricePer1k,
    capabilities,
    ...(delegatedToolExecution !== undefined ? { delegatedToolExecution } : {}),
    ...(specialistDomains.length > 0 ? { specialistDomains } : {}),
    enabled: true,
    ...(premiumRequestMultiplier !== undefined && premiumRequestMultiplier !== 1
      ? { premiumRequestMultiplier }
      : {}),
    ...(reasoningDepth !== undefined ? { reasoningDepth } : {}),
    ...(latencyClass !== undefined ? { latencyClass } : {}),
    ...(supportsPromptCaching !== undefined ? { supportsPromptCaching } : {}),
    ...(cachedInputPricePer1k !== undefined ? { cachedInputPricePer1k } : {}),
  };
}

function mergeSpecialistDomains(...sources: Array<readonly SpecialistDomain[] | undefined>): SpecialistDomain[] {
  const merged = new Set<SpecialistDomain>();
  for (const source of sources) {
    for (const domain of source ?? []) {
      merged.add(domain);
    }
  }
  return [...merged];
}

function toDisplayModelName(modelId: string): string {
  return modelId
    .split(/[-._]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Build the skill execution context backed by VS Code workspace APIs.
 * Injected into the Orchestrator so skills remain testable in isolation.
 */
function buildSkillExecutionContext(
  memoryManager: MemoryManager,
  memoryRefresh: vscode.EventEmitter<void>,
  checkpointManager?: CheckpointManager,
  secrets?: vscode.SecretStorage,
): SkillExecutionContext {
  return {
    get workspaceRootPath() {
      return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    },

    queryMemory(query, maxResults) {
      return memoryManager.queryRelevant(query, maxResults);
    },

    upsertMemory(entry) {
      const result = memoryManager.upsert(entry);
      if (result.status !== 'rejected') {
        memoryRefresh.fire();
      }
      return result;
    },

    async deleteMemory(path) {
      const removed = await memoryManager.delete(path);
      if (removed) {
        memoryRefresh.fire();
      }
      return removed;
    },

    async readFile(absolutePath) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'readFile');
      const uri = vscode.Uri.file(resolvedPath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf-8');
    },

    async writeFile(absolutePath, content) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'writeFile');
      const uri = vscode.Uri.file(resolvedPath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    },

    async findFiles(globPattern) {
      const uris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 100);
      return uris.map(u => u.fsPath);
    },

    async searchInFiles(query, options) {
      const maxResults = clampInteger(options?.maxResults, 20, 1, 200);
      const includePattern = options?.includePattern?.trim() || '**/*';
      const uris = await vscode.workspace.findFiles(
        includePattern,
        '**/{node_modules,.git,out,dist,coverage}/**',
        500,
      );

      const matcher = options?.isRegexp === true
        ? new RegExp(query, 'i')
        : query.toLowerCase();
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const uri of uris) {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(bytes).toString('utf-8');
          if (content.includes('\u0000')) {
            continue;
          }

          const lines = content.split(/\r?\n/g);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? '';
            const matched = typeof matcher === 'string'
              ? line.toLowerCase().includes(matcher)
              : matcher.test(line);
            if (!matched) {
              continue;
            }
            matches.push({ path: uri.fsPath, line: index + 1, text: line.trim() });
            if (matches.length >= maxResults) {
              return matches;
            }
          }
        } catch {
          continue;
        }
      }

      return matches;
    },

    async listDirectory(absolutePath) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('listDirectory: no workspace folder is open.');
      }

      const targetPath = absolutePath?.trim() || workspaceRoot;
      const resolvedPath = await assertInsideWorkspace(targetPath, 'listDirectory');
      const dirEntries = await fs.readdir(resolvedPath, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;
      const entries: Array<{ path: string; type: 'directory' | 'file' }> = [];
      for (const entry of dirEntries) {
        entries.push({
          path: path.join(resolvedPath, entry.name),
          type: entry.isDirectory() ? 'directory' : 'file',
        });
      }
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    },

    async runCommand(executable, args, options) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('runCommand: no workspace folder is open.');
      }

      const cwdRaw = options?.cwd?.trim() || workspaceRoot;
      const cwd = await assertInsideWorkspace(cwdRaw, 'runCommand');
      const mappedExecutable = mapExecutableForWindows(executable.trim());

      // A test command inherits the machine's testing resource budget: every
      // Node child (Jest/Vitest workers included) gets a heap cap through
      // NODE_OPTIONS. Opt-in via options.testResources — the same cap on a
      // production build would be a limit nobody asked for.
      const env = options?.testResources
        ? withTestResourceEnv(process.env, readTestResourceBudget())
        : undefined;

      try {
        const pending = execFileAsync(mappedExecutable, args ?? [], {
          cwd,
          timeout: clampInteger(options?.timeoutMs, 30000, 1000, 300000),
          windowsHide: true,
          // 4 MiB then a tail clip below: a full test run on a large suite
          // overflowed the old 1 MiB cap, and ENOBUFS read as a test failure
          // that no test produced. The tail is kept rather than the head
          // because runners print their failures last.
          maxBuffer: 4 * 1024 * 1024,
          ...(env ? { env: env as NodeJS.ProcessEnv } : {}),
          // .cmd files on Windows cannot be spawned directly — they require cmd.exe
          shell: process.platform === 'win32',
        });
        // Below-normal priority for every agent-issued command: this path is
        // never the user's interactive terminal, and the desktop staying
        // responsive outranks a background check finishing sooner. Children
        // inherit the class at creation, so this is set immediately.
        if (pending.child?.pid !== undefined) {
          try {
            os.setPriority(pending.child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
          } catch {
            // The process may already have exited; priority is best-effort.
          }
        }
        const { stdout, stderr } = await pending;
        return { ok: true, exitCode: 0, stdout: clipCommandOutput(stdout), stderr: clipCommandOutput(stderr) };
      } catch (error) {
        const maybe = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          exitCode: typeof maybe.code === 'number' ? maybe.code : 1,
          stdout: clipCommandOutput(String(maybe.stdout ?? '')),
          stderr: clipCommandOutput(String(maybe.stderr ?? maybe.message ?? '')),
        };
      }
    },

    testResourceBudget() {
      return readTestResourceBudget();
    },

    async getGitStatus() {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('getGitStatus: no workspace folder is open.');
      }
      await assertGitRepository(workspaceRoot);
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
        cwd: workspaceRoot,
        windowsHide: true,
      });
      return stdout.trim();
    },

    async getGitDiff(options) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('getGitDiff: no workspace folder is open.');
      }
      await assertGitRepository(workspaceRoot);
      const args = ['diff'];
      if (options?.staged) {
        args.push('--cached');
      }
      if (options?.ref) {
        args.push(options.ref);
      }
      const { stdout } = await execFileAsync('git', args, {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    },

    async listCheckpoints() {
      return checkpointManager ? checkpointManager.listCheckpoints() : [];
    },

    async rollbackCheckpointByTaskId(taskId: string) {
      if (!checkpointManager) {
        return {
          ok: false,
          summary: 'Rollback is unavailable because no workspace folder is open.',
          restoredPaths: [],
        };
      }
      return checkpointManager.rollbackByTaskId(taskId);
    },

    async rollbackLastCheckpoint() {
      if (!checkpointManager) {
        return {
          ok: false,
          summary: 'Rollback is unavailable because no workspace folder is open.',
          restoredPaths: [],
        };
      }

      return checkpointManager.rollbackLatest();
    },

    async applyGitPatch(patch, options) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('A workspace folder must be open to apply a git patch.');
      }

      if (patch.trim().length === 0) {
        throw new Error('Patch content must not be empty.');
      }

      await assertGitRepository(workspaceRoot);

      // Create a secure temp directory before writing the patch file
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlasmind-'));
      const tempFile = path.join(tempDir, 'patch.diff');
      await fs.writeFile(tempFile, patch, { encoding: 'utf-8', mode: 0o600 });

      try {
        const args = ['apply'];
        if (options?.checkOnly) {
          args.push('--check');
        }
        if (options?.stage) {
          args.push('--index');
        }
        args.push('--whitespace=nowarn', tempFile);

        const { stdout, stderr } = await execFileAsync('git', args, {
          cwd: workspaceRoot,
          windowsHide: true,
        });

        return {
          ok: true,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        };
      } catch (error) {
        const maybe = error as { stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          stdout: String(maybe.stdout ?? '').trim(),
          stderr: String(maybe.stderr ?? maybe.message ?? 'git apply failed').trim(),
        };
      } finally {
        await fs.unlink(tempFile).catch(() => undefined);
        await fs.rmdir(tempDir).catch(() => undefined);
      }
    },

    async getGitLog(options) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('getGitLog: no workspace folder is open.');
      }
      await assertGitRepository(workspaceRoot);
      const args = ['log', '--oneline', `--max-count=${clampInteger(options?.maxCount, 20, 1, 200)}`];
      if (options?.ref) {
        args.push(options.ref);
      }
      if (options?.filePath) {
        const relativeFile = path.relative(workspaceRoot, path.resolve(options.filePath));
        args.push('--', relativeFile);
      }
      const { stdout } = await execFileAsync('git', args, {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return stdout.trim();
    },

    async gitBranch(action, name) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        throw new Error('gitBranch: no workspace folder is open.');
      }
      await assertGitRepository(workspaceRoot);
      switch (action) {
        case 'list': {
          const { stdout } = await execFileAsync('git', ['branch', '--list'], {
            cwd: workspaceRoot,
            windowsHide: true,
          });
          return stdout.trim();
        }
        case 'create':
          if (!name?.trim()) {
            throw new Error('gitBranch create requires a branch name.');
          }
          await execFileAsync('git', ['branch', name.trim()], { cwd: workspaceRoot, windowsHide: true });
          return `Created branch ${name.trim()}.`;
        case 'switch':
          if (!name?.trim()) {
            throw new Error('gitBranch switch requires a branch name.');
          }
          await execFileAsync('git', ['switch', name.trim()], { cwd: workspaceRoot, windowsHide: true });
          return `Switched to branch ${name.trim()}.`;
        case 'delete':
          if (!name?.trim()) {
            throw new Error('gitBranch delete requires a branch name.');
          }
          await execFileAsync('git', ['branch', '--delete', name.trim()], { cwd: workspaceRoot, windowsHide: true });
          return `Deleted branch ${name.trim()}.`;
      }
    },

    async deleteFile(absolutePath) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'deleteFile');
      await vscode.workspace.fs.delete(vscode.Uri.file(resolvedPath), { recursive: false, useTrash: false });
    },

    async moveFile(sourcePath, destPath) {
      const resolvedSource = await assertInsideWorkspace(sourcePath, 'moveFile');
      const resolvedDest = await assertInsideWorkspace(destPath, 'moveFile');
      await vscode.workspace.fs.rename(vscode.Uri.file(resolvedSource), vscode.Uri.file(resolvedDest), { overwrite: true });
    },

    async getDiagnostics(filePaths) {
      const normalized = new Set((filePaths ?? []).map(file => path.resolve(file)));
      return vscode.languages.getDiagnostics()
        .filter(([uri]) => normalized.size === 0 || normalized.has(path.resolve(uri.fsPath)))
        .flatMap(([uri, diagnostics]) => diagnostics.map(diagnostic => ({
          path: uri.fsPath,
          line: diagnostic.range.start.line + 1,
          column: diagnostic.range.start.character + 1,
          severity: diagnostic.severity === vscode.DiagnosticSeverity.Error
            ? 'error'
            : diagnostic.severity === vscode.DiagnosticSeverity.Warning
              ? 'warning'
              : 'info',
          message: diagnostic.message,
          source: diagnostic.source,
        })));
    },

    async getDocumentSymbols(absolutePath) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'getDocumentSymbols');
      const uri = vscode.Uri.file(resolvedPath);
      const symbols = await vscode.commands.executeCommand<unknown[]>('vscode.executeDocumentSymbolProvider', uri) ?? [];
      return symbols.map(symbol => serializeDocumentSymbol(symbol)).filter((value): value is { name: string; kind: string; range: string; children?: string[] } => Boolean(value));
    },

    async findReferences(absolutePath, line, column) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'findReferences');
      const uri = vscode.Uri.file(resolvedPath);
      const locations = await vscode.commands.executeCommand<unknown[]>('vscode.executeReferenceProvider', uri, new vscode.Position(line - 1, column - 1)) ?? [];
      return await serializeLocationsWithContext(locations);
    },

    async goToDefinition(absolutePath, line, column) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'goToDefinition');
      const uri = vscode.Uri.file(resolvedPath);
      const locations = await vscode.commands.executeCommand<unknown[]>('vscode.executeDefinitionProvider', uri, new vscode.Position(line - 1, column - 1)) ?? [];
      return normalizeLocationTargets(locations);
    },

    async renameSymbol(absolutePath, line, column, newName) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'renameSymbol');
      const uri = vscode.Uri.file(resolvedPath);
      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
        'vscode.executeDocumentRenameProvider',
        uri,
        new vscode.Position(line - 1, column - 1),
        newName,
      );
      if (!edit) {
        return { filesChanged: 0, editsApplied: 0 };
      }
      const entries = edit.entries();
      const applied = await vscode.workspace.applyEdit(edit);
      return {
        filesChanged: applied ? entries.length : 0,
        editsApplied: applied ? entries.reduce((count, [, edits]) => count + edits.length, 0) : 0,
      };
    },

    async fetchUrl(url, options) {
      const fetchImpl = (globalThis as typeof globalThis & {
        fetch?: (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
      }).fetch;
      if (!fetchImpl) {
        return { ok: false, status: 0, body: 'fetchUrl is unavailable in this environment.' };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), clampInteger(options?.timeoutMs, 15000, 1000, 120000));
      try {
        const response = await fetchImpl(url, { signal: controller.signal });
        const body = await response.text();
        const maxBytes = clampInteger(options?.maxBytes, 200_000, 1024, 1_000_000);
        return {
          ok: response.ok,
          status: response.status,
          body: body.slice(0, maxBytes),
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async httpRequest(url, options) {
      const fetchImpl = (globalThis as typeof globalThis & {
        fetch?: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
      }).fetch;
      if (!fetchImpl) {
        return { ok: false, status: 0, body: 'httpRequest is unavailable in this environment.' };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), clampInteger(options?.timeoutMs, 15000, 1000, 120000));
      try {
        const response = await fetchImpl(url, {
          method: options?.method ?? 'GET',
          headers: options?.headers,
          body: options?.body,
          signal: controller.signal,
        });
        const body = await response.text();
        const maxBytes = clampInteger(options?.maxBytes, 200_000, 1024, 1_000_000);
        return {
          ok: response.ok,
          status: response.status,
          body: body.slice(0, maxBytes),
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async getCodeActions(absolutePath, startLine, startColumn, endLine, endColumn) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'getCodeActions');
      const uri = vscode.Uri.file(resolvedPath);
      const range = new vscode.Range(startLine - 1, startColumn - 1, endLine - 1, endColumn - 1);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[] | undefined>('vscode.executeCodeActionProvider', uri, range) ?? [];
      return actions.map(action => ({
        title: action.title,
        kind: action.kind?.value,
        isPreferred: action.isPreferred,
      }));
    },

    async applyCodeAction(absolutePath, startLine, startColumn, endLine, endColumn, actionTitle) {
      const resolvedPath = await assertInsideWorkspace(absolutePath, 'applyCodeAction');
      const uri = vscode.Uri.file(resolvedPath);
      const range = new vscode.Range(startLine - 1, startColumn - 1, endLine - 1, endColumn - 1);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[] | undefined>('vscode.executeCodeActionProvider', uri, range) ?? [];
      const target = actions.find(action => action.title === actionTitle);
      if (!target) {
        return { applied: false, reason: 'Code action not found.' };
      }
      if (target.edit) {
        await vscode.workspace.applyEdit(target.edit);
      }
      if (target.command) {
        await vscode.commands.executeCommand(target.command.command, ...(target.command.arguments ?? []));
      }
      return { applied: true };
    },
    async getSpecialistApiKey(providerId) {
      if (!secrets) { return undefined; }
      const key = await secrets.get(`atlasmind.integration.${providerId}.apiKey`);
      return key || undefined;
    },

    async getOutputChannelNames() {
      return ['AtlasMind'];
    },

    async getAtlasMindOutputLog() {
      return 'The AtlasMind output channel is visible in VS Code Output panel (View > Output, select "AtlasMind"). Direct programmatic reads are not supported by the VS Code API.';
    },

    async getDebugSessions() {
      if (vscode.debug.activeDebugSession) {
        return [{
          id: vscode.debug.activeDebugSession.id,
          name: vscode.debug.activeDebugSession.name,
          type: vscode.debug.activeDebugSession.type,
        }];
      }
      return [];
    },

    async evaluateDebugExpression(expression, frameId) {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        return 'Error: No active debug session.';
      }
      try {
        const response = await session.customRequest('evaluate', {
          expression,
          context: 'repl',
          frameId,
        }) as { result?: string } | undefined;
        return response?.result ?? '(no result)';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error evaluating expression: ${message}`;
      }
    },

    async getTerminalOutput(terminalName) {
      const terminals = vscode.window.terminals;
      if (terminals.length === 0) {
        return '';
      }

      // Match by name if provided; otherwise use the most recently active terminal.
      const target = terminalName
        ? terminals.find(t => t.name === terminalName) ?? terminals[terminals.length - 1]
        : terminals[terminals.length - 1];

      if (!target) {
        return '';
      }

      // The VS Code API does not expose terminal buffer contents directly.
      // We return a descriptor so the model can reason about which terminals
      // are open and prompt the user to copy output when needed.
      const allNames = terminals.map(t => t.name).join(', ');
      return [
        `Terminal: ${target.name}`,
        `Active: ${vscode.window.activeTerminal?.name === target.name ? 'yes' : 'no'}`,
        `All open terminals: ${allNames}`,
        '',
        'Note: The VS Code API does not expose terminal buffer contents. To share terminal output with AtlasMind, paste it directly into the chat.',
      ].join('\n');
    },

    async getInstalledExtensions() {
      return vscode.extensions.all
        .filter(ext => !ext.id.startsWith('vscode.'))
        .map(ext => ({
          id: ext.id,
          displayName: (ext.packageJSON as { displayName?: string }).displayName ?? ext.id,
          version: (ext.packageJSON as { version?: string }).version ?? 'unknown',
          isActive: ext.isActive,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async getPortForwards() {
      // Forwarded ports are only relevant in remote contexts, which we detect via
      // `vscode.env.remoteName`, and this implementation reads them from
      // `vscode.env.forwardedPorts`.
      const env = vscode.env as VscodeEnvWithPorts;
      if (!Array.isArray(env.forwardedPorts)) {
        return [];
      }
      return env.forwardedPorts.map(fp => ({
        portNumber: fp.portNumber,
        label: fp.label,
        localAddress: fp.localAddress,
        privacy: fp.privacy,
      }));
    },
    async getTestResults() {
      const testApi = vscode.tests as typeof vscode.tests & {
        testResults?: Array<{
          id: string;
          completedAt: number;
          durationMs?: number;
          counts: Record<string, number>;
        }>;
      };
      const results = testApi.testResults ?? [];
      return results
        .slice()
        .sort((a, b) => b.completedAt - a.completedAt)
        .slice(0, 5)
        .map(result => ({
          id: result.id,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          counts: Object.fromEntries(
            Object.entries(result.counts)
              .filter(([, value]) => value > 0),
          ),
        }));
    },

    async getActiveDebugSession() {
      const session = vscode.debug.activeDebugSession;
      if (!session) {
        return null;
      }
      return { id: session.id, name: session.name, type: session.type };
    },

    async listTerminals() {
      return (vscode.window.terminals ?? []).map(t => ({ name: t.name }));
    },

    async openSimpleBrowser(url, title) {
      await vscode.commands.executeCommand('simpleBrowser.api.open', url, { title });
    },

    async getDebugConfigs() {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) { return []; }
      const configs: Array<{ name: string; type: string; request: string }> = [];
      for (const folder of folders) {
        const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
        const rawConfigs = launchConfig.get<Array<Record<string, unknown>>>('configurations') ?? [];
        for (const cfg of rawConfigs) {
          if (typeof cfg['name'] === 'string' && typeof cfg['type'] === 'string') {
            configs.push({
              name: cfg['name'],
              type: cfg['type'],
              request: typeof cfg['request'] === 'string' ? cfg['request'] : '',
            });
          }
        }
      }
      return configs;
    },

    async launchDebugSession(configName) {
      const folders = vscode.workspace.workspaceFolders;
      const folder = folders?.[0];
      try {
        const started = await vscode.debug.startDebugging(folder, configName);
        if (started) {
          return { ok: true, message: `Debug session "${configName}" started.` };
        }
        return { ok: false, message: `VS Code declined to start debug session "${configName}". Check the configuration name and launch.json.` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },

    async getBreakpoints() {
      return vscode.debug.breakpoints
        .filter((bp): bp is vscode.SourceBreakpoint => bp instanceof vscode.SourceBreakpoint)
        .map(bp => ({
          id: bp.id,
          path: bp.location.uri.fsPath,
          line: bp.location.range.start.line + 1,
          enabled: bp.enabled,
          condition: bp.condition,
        }));
    },

    async addBreakpoint(absolutePath, line, options) {
      const uri = vscode.Uri.file(absolutePath);
      const position = new vscode.Position(line - 1, 0);
      const location = new vscode.Location(uri, position);
      const bp = new vscode.SourceBreakpoint(location, true, options?.condition, options?.logMessage);
      vscode.debug.addBreakpoints([bp]);
      return bp.id;
    },

    async removeBreakpoints(ids) {
      const toRemove = vscode.debug.breakpoints.filter(bp => ids.includes(bp.id));
      vscode.debug.removeBreakpoints(toRemove);
      return { removed: toRemove.length };
    },
  };
}

function serializeDocumentSymbol(symbol: unknown): { name: string; kind: string; range: string; children?: string[] } | undefined {
  if (!symbol || typeof symbol !== 'object') {
    return undefined;
  }
  const maybe = symbol as vscode.DocumentSymbol | vscode.SymbolInformation;
  const range = 'range' in maybe ? maybe.range : maybe.location.range;
  const kind = vscode.SymbolKind[maybe.kind] ?? 'Unknown';
  const children = 'children' in maybe && Array.isArray(maybe.children)
    ? maybe.children.map(child => child.name)
    : undefined;
  return {
    name: maybe.name,
    kind,
    range: `${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`,
    ...(children && children.length > 0 ? { children } : {}),
  };
}

async function serializeLocationsWithContext(locations: unknown[]): Promise<Array<{ path: string; line: number; column: number; text: string }>> {
  const normalized = normalizeLocationTargets(locations);
  const results: Array<{ path: string; line: number; column: number; text: string }> = [];
  for (const location of normalized) {
    const text = await readLineText(location.path, location.line, location.column);
    results.push({ ...location, text });
  }
  return results;
}

function normalizeLocationTargets(locations: unknown[]): Array<{ path: string; line: number; column: number }> {
  return locations.flatMap(location => {
    if (!location || typeof location !== 'object') {
      return [];
    }
    const maybe = location as vscode.Location | vscode.LocationLink;
    if ('uri' in maybe && 'range' in maybe) {
      return [{
        path: maybe.uri.fsPath,
        line: maybe.range.start.line + 1,
        column: maybe.range.start.character + 1,
      }];
    }
    if ('targetUri' in maybe && 'targetSelectionRange' in maybe) {
      const targetRange = maybe.targetSelectionRange ?? maybe.targetRange;
      if (!targetRange) {
        return [];
      }
      return [{
        path: maybe.targetUri.fsPath,
        line: targetRange.start.line + 1,
        column: targetRange.start.character + 1,
      }];
    }
    return [];
  });
}

async function readLineText(filePath: string, line: number, column: number): Promise<string> {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    return document.lineAt(Math.max(0, line - 1)).text.trim();
  } catch {
    return `${line}:${column}`;
  }
}

async function resolveCheckpointPaths(
  skillContext: SkillExecutionContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string[]> {
  if (toolName === 'file-write' || toolName === 'file-edit') {
    const targetPath = typeof args['path'] === 'string' ? args['path'].trim() : '';
    if (!targetPath) {
      return [];
    }
    if (path.isAbsolute(targetPath) || !skillContext.workspaceRootPath) {
      return [targetPath];
    }
    return [path.resolve(skillContext.workspaceRootPath, targetPath)];
  }

  if (toolName === 'git-apply-patch') {
    const patch = typeof args['patch'] === 'string' ? args['patch'] : '';
    return extractPatchPaths(patch, skillContext.workspaceRootPath);
  }

  return [];
}

function extractPatchPaths(patch: string, workspaceRootPath: string | undefined): string[] {
  if (!workspaceRootPath || patch.trim().length === 0) {
    return [];
  }

  const paths = new Set<string>();
  const diffLines = patch.split(/\r?\n/g);
  for (const line of diffLines) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const candidate = match[2] || match[1];
    if (!candidate || candidate === '/dev/null') {
      continue;
    }

    paths.add(path.resolve(workspaceRootPath, candidate));
  }

  return [...paths];
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * The testing resource budget for this machine, from the one slider that
 * governs every locally-run test path (`atlasmind.testing.resourceShare`).
 * Recomputed per call: it is cheap, and a cached copy would hold yesterday's
 * answer after the user moved the slider mid-session.
 */
function readTestResourceBudget(): TestResourceBudget {
  const share = vscode.workspace.getConfiguration('atlasmind').get<number>('testing.resourceShare', 50);
  return planTestResourceBudget({
    cpuCount: Math.max(1, os.cpus().length),
    memoryGb: Math.max(1, os.totalmem() / (1024 ** 3)),
  }, clampTestResourceShare(share));
}

const COMMAND_OUTPUT_CLIP_BYTES = 64 * 1024;

/**
 * Keep the tail of oversized command output. Test runners print their
 * failures last, so the tail is the half worth keeping — and an unclipped
 * multi-megabyte transcript would land verbatim in a model prompt.
 */
function clipCommandOutput(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= COMMAND_OUTPUT_CLIP_BYTES) {
    return trimmed;
  }
  return `…[earlier output truncated]\n${trimmed.slice(-COMMAND_OUTPUT_CLIP_BYTES)}`;
}

function mapExecutableForWindows(executable: string): string {
  if (process.platform !== 'win32') {
    return executable;
  }

  switch (executable) {
    case 'npm':
      return 'npm.cmd';
    case 'npx':
      return 'npx.cmd';
    case 'pnpm':
      return 'pnpm.cmd';
    case 'yarn':
      return 'yarn.cmd';
    case 'tsc':
      return 'tsc.cmd';
    case 'eslint':
      return 'eslint.cmd';
    case 'vitest':
      return 'vitest.cmd';
    default:
      return executable;
  }
}

async function runPostToolVerification(
  skillContext: SkillExecutionContext,
  invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
): Promise<string | undefined> {
  const configuration = vscode.workspace.getConfiguration('atlasmind');
  if (!configuration.get<boolean>('autoVerifyAfterWrite', true)) {
    return undefined;
  }

  const scripts = sanitizeVerificationScripts(configuration.get<string[]>('autoVerifyScripts'), ['test']);
  if (scripts.length === 0) {
    return 'Verification skipped: no verification scripts are configured.';
  }

  const workspaceRoot = skillContext.workspaceRootPath;
  if (!workspaceRoot) {
    return 'Verification skipped: no workspace folder is open.';
  }

  const manifest = await readPackageManifest(skillContext, workspaceRoot);
  if (!manifest) {
    return 'Verification skipped: package.json was not found in the workspace root.';
  }

  const availableScripts = scripts.filter(script => typeof manifest.scripts?.[script] === 'string');
  if (availableScripts.length === 0) {
    return `Verification skipped: none of the configured scripts are present (${scripts.join(', ')}).`;
  }

  const packageManager = await detectPackageManager(workspaceRoot);
  const timeoutMs = clampInteger(configuration.get<number>('autoVerifyTimeoutMs'), 120000, 5000, 600000);
  const touchedTargets = summarizeVerificationTargets(invocations);
  const summaries: string[] = [
    `Triggered by: ${touchedTargets.join(', ')}`,
    `Package manager: ${packageManager}`,
  ];

  // The machine's testing budget: worker flags where the script's runner is
  // recognised, and a heap cap through the environment either way. Without
  // this, a bare `jest` script fans out to (cores − 1) ts-jest workers on
  // every agent write — the ungoverned path that can take the desktop down.
  const budget = readTestResourceBudget();
  for (const script of availableScripts) {
    const throttle = planTestCommandThrottle(manifest.scripts?.[script], budget);
    const baseArgs = buildPackageManagerArgs(packageManager, script);
    const args = throttle.extraArgs.length > 0 ? [...baseArgs, '--', ...throttle.extraArgs] : baseArgs;
    const result = await skillContext.runCommand(packageManager, args, {
      cwd: workspaceRoot,
      timeoutMs,
      testResources: true,
    });
    summaries.push(formatVerificationOutcome(packageManager, script, result));
    if (!result.ok) {
      break;
    }
  }

  return summaries.join('\n\n');
}

async function readPackageManifest(
  skillContext: SkillExecutionContext,
  workspaceRoot: string,
): Promise<{ scripts?: Record<string, string> } | undefined> {
  try {
    const manifestText = await skillContext.readFile(path.join(workspaceRoot, 'package.json'));
    const manifest = JSON.parse(manifestText) as { scripts?: Record<string, string> };
    return manifest;
  } catch {
    return undefined;
  }
}

async function detectPackageManager(workspaceRoot: string): Promise<'npm' | 'pnpm' | 'yarn'> {
  const pnpmLock = path.join(workspaceRoot, 'pnpm-lock.yaml');
  if (await pathExists(pnpmLock)) {
    return 'pnpm';
  }

  const yarnLock = path.join(workspaceRoot, 'yarn.lock');
  if (await pathExists(yarnLock)) {
    return 'yarn';
  }

  return 'npm';
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeVerificationScripts(value: string[] | undefined, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (/^[A-Za-z0-9:_-]+$/.test(trimmed)) {
      unique.add(trimmed);
    }
  }

  return unique.size > 0 ? [...unique] : fallback;
}

function buildPackageManagerArgs(packageManager: 'npm' | 'pnpm' | 'yarn', script: string): string[] {
  switch (packageManager) {
    case 'yarn':
      return [script];
    case 'npm':
    case 'pnpm':
      return ['run', script];
  }
}

function summarizeVerificationTargets(
  invocations: Array<{ toolName: string; args: Record<string, unknown>; result: string }>,
): string[] {
  const targets = new Set<string>();
  for (const invocation of invocations) {
    const rawPath = invocation.args['path'];
    if (typeof rawPath === 'string' && rawPath.trim().length > 0) {
      targets.add(path.basename(rawPath.trim()));
      continue;
    }
    targets.add(invocation.toolName);
  }
  return [...targets];
}

function formatVerificationOutcome(
  packageManager: 'npm' | 'pnpm' | 'yarn',
  script: string,
  result: { ok: boolean; exitCode: number; stdout: string; stderr: string },
): string {
  const commandText = packageManager === 'yarn'
    ? `${packageManager} ${script}`
    : `${packageManager} run ${script}`;
  const status = result.ok ? 'PASS' : 'FAIL';
  // Captured tool output (e.g. vitest) carries ANSI colour/cursor escape
  // sequences. On a non-terminal surface the invisible ESC byte leaves garbled
  // fragments like `[1m[7m[36m RUN`, so strip the sequences before display.
  const output = [result.stdout, result.stderr]
    .map(text => sanitizeTerminalOutput(text))
    .filter(text => text.trim().length > 0)
    .join('\n');
  return [
    `${status}: ${commandText} (exit ${result.exitCode})`,
    output.trim().length > 0 ? truncateForVerification(output, 4000) : 'No output.',
  ].join('\n');
}

function truncateForVerification(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

async function assertGitRepository(workspaceRoot: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workspaceRoot,
      windowsHide: true,
    });
  } catch {
    throw new Error(`Workspace "${workspaceRoot}" is not a git repository.`);
  }
}

/**
 * Verify that a canonicalized path lives inside the open workspace root.
 * Accepts both absolute paths and workspace-relative paths (e.g. "web/src/pages").
 * Uses realpath resolution so symlinks cannot tunnel reads or writes outside the
 * workspace boundary. Returns the resolved absolute path for use by callers.
 */
async function assertInsideWorkspace(absolutePath: string, operation: string): Promise<string> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error(`${operation}: no workspace folder is open.`);
  }

  const resolvedRoot = await fs.realpath(path.resolve(workspaceRoot));
  // Resolve relative to workspaceRoot so models can pass workspace-relative paths.
  const resolved = await resolveCanonicalPath(path.resolve(workspaceRoot, absolutePath));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `${operation} is restricted to the workspace. ` +
      `"${absolutePath}" resolves outside "${resolvedRoot}".`,
    );
  }
  return resolved;
}

async function resolveCanonicalPath(targetPath: string): Promise<string> {
  const pendingSegments: string[] = [];
  let current = targetPath;

  for (;;) {
    try {
      const canonical = await fs.realpath(current);
      return pendingSegments.length > 0
        ? path.join(canonical, ...pendingSegments.reverse())
        : canonical;
    } catch (error) {
      const maybe = error as { code?: string };
      if (maybe.code !== 'ENOENT') {
        throw error;
      }

      const parsed = path.parse(current);
      if (current === parsed.root) {
        throw new Error(`Unable to resolve workspace path boundary for "${targetPath}".`);
      }

      pendingSegments.push(path.basename(current));
      current = path.dirname(current);
    }
  }
}

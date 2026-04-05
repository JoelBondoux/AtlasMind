import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SessionConversation } from './chat/sessionConversation.js';
import type { VoiceManager } from './voice/voiceManager.js';
import type { Orchestrator } from './core/orchestrator.js';
import type { AgentRegistry } from './core/agentRegistry.js';
import type { SkillsRegistry } from './core/skillsRegistry.js';
import type { ModelRouter } from './core/modelRouter.js';
import type { MemoryManager } from './memory/memoryManager.js';
import type { CostTracker } from './core/costTracker.js';
import type { ScannerRulesManager } from './core/scannerRulesManager.js';
import type { ToolWebhookDispatcher } from './core/toolWebhookDispatcher.js';
import type { McpServerRegistry } from './mcp/mcpServerRegistry.js';
import type { CheckpointManager } from './core/checkpointManager.js';
import type { ProjectRunHistory } from './core/projectRunHistory.js';
import type { ProviderRegistry } from './providers/index.js';
import { getModelInfoUrl, getProviderInfoUrl, lookupCatalog } from './providers/modelCatalog.js';
import type { DiscoveredModel } from './providers/adapter.js';
import type { AgentDefinition, ModelInfo, ProviderConfig, ProviderId, SkillExecutionContext, ToolRiskCategory } from './types.js';
import { ToolApprovalManager } from './core/toolApprovalManager.js';

const execFileAsync = promisify(execFile);
const USER_AGENTS_STORAGE_KEY = 'atlasmind.userAgents';
const BUILTIN_AGENT_ALLOWED_MODELS_STORAGE_KEY = 'atlasmind.builtinAgentAllowedModels';
const DISABLED_PROVIDER_IDS_STORAGE_KEY = 'atlasmind.disabledProviderIds';
const DISABLED_MODEL_IDS_STORAGE_KEY = 'atlasmind.disabledModelIds';
const AZURE_OPENAI_ENDPOINT_SETTING = 'azureOpenAiEndpoint';
const AZURE_OPENAI_DEPLOYMENTS_SETTING = 'azureOpenAiDeployments';
const AZURE_OPENAI_API_VERSION = '2024-10-21';
const DEFAULT_SSOT_PATH = 'project_memory';
const AUTO_DISCOVERABLE_SSOT_PATHS = [DEFAULT_SSOT_PATH];
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

export function requiresExplicitProviderActivation(providerId: string): boolean {
  return providerId === 'copilot';
}

type StartupState = {
  status: 'idle' | 'booting' | 'ready' | 'failed';
  phase: string;
  detail?: string;
  startedAt: number;
};

export interface AtlasMindContext {
  orchestrator: Orchestrator;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  modelRouter: ModelRouter;
  memoryManager: MemoryManager;
  costTracker: CostTracker;
  providerRegistry: ProviderRegistry;
  /** Fires whenever skill enabled/disabled state or scan results change. */
  skillsRefresh: vscode.EventEmitter<void>;
  /** Fires whenever agents are added, updated, or removed. */
  agentsRefresh: vscode.EventEmitter<void>;
  /** Fires whenever provider/model availability changes in the Models tree. */
  modelsRefresh: vscode.EventEmitter<void>;
  /** Manages scanner rule overrides and custom rules in globalState. */
  scannerRulesManager: ScannerRulesManager;
  /** Manages MCP server connections and bridges tools into the SkillsRegistry. */
  mcpServerRegistry: McpServerRegistry;
  /** Raw VS Code extension context (for globalState, secrets, extensionUri, etc.). */
  extensionContext: vscode.ExtensionContext;
  /** Refresh available models from provider adapters and update router catalogs. */
  refreshProviderModels(includeInteractiveProviders?: boolean): Promise<{ providersUpdated: number; modelsAvailable: number }>;
  /** Refresh the provider health indicator after credential or catalog changes. */
  refreshProviderHealth(): Promise<void>;
  /** Persist and apply provider enabled state, updating all child models. */
  setProviderEnabled(providerId: ProviderId, enabled: boolean): Promise<void>;
  /** Persist and apply model enabled state, auto-enabling parent providers when needed. */
  setModelEnabled(providerId: ProviderId, modelId: string, enabled: boolean): Promise<void>;
  /** Returns whether a provider is configured enough to expose child models in the Models tree. */
  isProviderConfigured(providerId: ProviderId): Promise<boolean>;
  /** Persist agent-level model assignment updates for built-in and custom agents. */
  updateAgentAllowedModels(agentId: string, allowedModels?: string[]): Promise<void>;
  /** Openable documentation URL for a provider or specific model, when known. */
  getModelInfoUrl(providerId: ProviderId, modelId?: string): string | undefined;
  /** Dispatches outbound webhook notifications for tool execution lifecycle events. */
  toolWebhookDispatcher: ToolWebhookDispatcher;
  /** Manages task-scoped approval bypasses and session-wide autopilot state. */
  toolApprovalManager: ToolApprovalManager;
  /** Manages TTS synthesis and STT recognition via the Voice Panel webview. */
  voiceManager: VoiceManager;
  /** Stores compact carry-forward context for the active extension session. */
  sessionConversation: SessionConversation;
  /** Durable project execution history for run review and replay UX. */
  projectRunHistory: ProjectRunHistory;
  /** Fires whenever project run history changes. */
  projectRunsRefresh: vscode.EventEmitter<void>;
  /** Fires whenever the in-memory SSOT index changes (upsert, delete, reload). */
  memoryRefresh: vscode.EventEmitter<void>;
  /** Restores the most recent automatic checkpoint if one exists. */
  rollbackLastCheckpoint(): Promise<{ ok: boolean; summary: string; restoredPaths: string[] }>;
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

function applyModelAvailabilityState(
  modelRouter: ModelRouter,
  disabledProviderIds: Set<string>,
  disabledModelIds: Set<string>,
): void {
  for (const provider of modelRouter.listProviders()) {
    const providerEnabled = !disabledProviderIds.has(provider.id);
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
      runtimeCoreModule,
      toolPolicyModule,
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
      import('./runtime/core.js'),
      import('./core/toolPolicy.js'),
    ]);

    return {
      registerChatParticipant: chatParticipantModule.registerChatParticipant,
      registerTreeViews: treeViewsModule.registerTreeViews,
      AnthropicAdapter: providersModule.AnthropicAdapter,
      BedrockAdapter: providersModule.BedrockAdapter,
      BEDROCK_ACCESS_KEY_SECRET: providersModule.BEDROCK_ACCESS_KEY_SECRET,
      BEDROCK_SECRET_KEY_SECRET: providersModule.BEDROCK_SECRET_KEY_SECRET,
      getConfiguredBedrockModelIds: providersModule.getConfiguredBedrockModelIds,
      getConfiguredBedrockRegion: providersModule.getConfiguredBedrockRegion,
      CopilotAdapter: providersModule.CopilotAdapter,
      getConfiguredLocalBaseUrl: providersModule.getConfiguredLocalBaseUrl,
      LocalEchoAdapter: providersModule.LocalEchoAdapter,
      OpenAiCompatibleAdapter: providersModule.OpenAiCompatibleAdapter,
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
      createAtlasRuntime: runtimeCoreModule.createAtlasRuntime,
      classifyToolInvocation: toolPolicyModule.classifyToolInvocation,
      getToolApprovalMode: toolPolicyModule.getToolApprovalMode,
      requiresToolApproval: toolPolicyModule.requiresToolApproval,
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
    const scannerRulesManager = new startupModules.ScannerRulesManager(context.globalState);
    const toolWebhookDispatcher = new startupModules.ToolWebhookDispatcher(context, outputChannel);
    const voiceManager = new startupModules.VoiceManager();
    const sessionConversation = new startupModules.SessionConversation(context.workspaceState);
    const projectRunHistory = new startupModules.ProjectRunHistory(context.globalState);
    projectRunHistory.enableDiskStorage(
      vscode.Uri.joinPath(context.globalStorageUri, 'project-runs').fsPath,
    );
    const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const checkpointManager = workspaceRootPath
      ? new startupModules.CheckpointManager(workspaceRootPath, context.globalStorageUri.fsPath)
      : undefined;
    const skillContext = buildSkillExecutionContext(memoryManager, memoryRefresh, checkpointManager);
    const providerAdapters = [
      new startupModules.LocalEchoAdapter({
        secrets: context.secrets,
        getBaseUrl: () => vscode.workspace.getConfiguration('atlasmind').get<string>('localOpenAiBaseUrl'),
      }),
      new startupModules.AnthropicAdapter(context.secrets),
      new startupModules.CopilotAdapter(),
      new startupModules.OpenAiCompatibleAdapter(
        { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', secretKey: 'atlasmind.provider.openai.apiKey', displayName: 'OpenAI' },
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
    ];

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

      const choice = await vscode.window.showWarningMessage(
        `AtlasMind wants to ${policy.summary}. Category: ${policy.category}. Risk: ${policy.risk}.`,
        { modal: true },
        'Allow Once',
        'Bypass Approvals',
        'Autopilot',
      );

      if (choice === 'Allow Once') {
        return { approved: true };
      }

      if (choice === 'Bypass Approvals') {
        toolApprovalManager.bypassTask(taskId);
        return { approved: true };
      }

      if (choice === 'Autopilot') {
        toolApprovalManager.enableAutopilot();
        void vscode.window.showInformationMessage(
          'AtlasMind Autopilot enabled for this session. Tool approval prompts will be skipped until the extension reloads.',
        );
        return { approved: true };
      }

      return {
        approved: false,
        reason: `User denied ${policy.summary}.`,
      };
    };
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

    const runtime = startupModules.createAtlasRuntime({
      memoryStore: memoryManager,
      costTracker,
      skillContext,
      providerAdapters,
      toolWebhookDispatcher,
      hooks: { toolApprovalGate, writeCheckpointHook, postToolVerifier },
      config: {
        maxToolIterations: vscode.workspace.getConfiguration('atlasmind').get<number>('maxToolIterations')!,
        maxToolCallsPerTurn: vscode.workspace.getConfiguration('atlasmind').get<number>('maxToolCallsPerTurn')!,
        toolExecutionTimeoutMs: vscode.workspace.getConfiguration('atlasmind').get<number>('toolExecutionTimeoutMs')!,
        providerTimeoutMs: vscode.workspace.getConfiguration('atlasmind').get<number>('providerTimeoutMs')!,
      },
    });
    const { agentRegistry, skillsRegistry, modelRouter, providerRegistry } = runtime;
    applyModelAvailabilityState(
      modelRouter,
      readDisabledProviderIds(context.globalState),
      readDisabledModelIds(context.globalState),
    );
    for (const provider of modelRouter.listProviders()) {
      if (requiresExplicitProviderActivation(provider.id)) {
        modelRouter.setProviderHealth(provider.id, false);
      }
    }

    const refreshProviderModels = async (includeInteractiveProviders = true) => {
      const summary = await refreshProviderModelsCatalog(
        modelRouter,
        providerRegistry,
        outputChannel,
        { includeInteractiveProviders },
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
    for (const agent of loadStoredUserAgents(context.globalState)) {
      agentRegistry.register(agent);
    }
    applyBuiltInAgentAllowedModelOverrides(
      agentRegistry,
      readBuiltInAgentAllowedModelOverrides(context.globalState),
    );

    agentRegistry.setDisabledIds(
      context.globalState.get<string[]>('atlasmind.disabledAgentIds', []),
    );
    const savedPerformance = context.globalState.get<Record<string, { successes: number; failures: number; totalTasks: number }>>('atlasmind.agentPerformance');
    if (savedPerformance) {
      agentRegistry.loadPerformance(savedPerformance);
    }
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

    const mcpServerRegistry = new startupModules.McpServerRegistry(
      context.globalState,
      skillsRegistry,
      () => skillsRefresh.fire(),
      outputChannel,
    );
    mcpServerRegistry.loadFromStorage();

    atlasContext = {
      orchestrator,
      agentRegistry,
      skillsRegistry,
      modelRouter,
      memoryManager,
      costTracker,
      providerRegistry,
      skillsRefresh,
      agentsRefresh,
      modelsRefresh,
      scannerRulesManager,
      mcpServerRegistry,
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
        if (providerId === 'local') {
          return Boolean(startupModules.getConfiguredLocalBaseUrl());
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
      voiceManager,
      sessionConversation,
      projectRunHistory,
      projectRunsRefresh,
      memoryRefresh,
      rollbackLastCheckpoint: async () => {
        if (!checkpointManager) {
          return { ok: false, summary: 'No workspace checkpoint manager is available.', restoredPaths: [] };
        }
        return checkpointManager.rollbackLatest();
      },
    };

    context.subscriptions.push(skillsRefresh);
    context.subscriptions.push(agentsRefresh);
  context.subscriptions.push(modelsRefresh);
    context.subscriptions.push(projectRunsRefresh);
    context.subscriptions.push(memoryRefresh);
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
    runBackgroundActivationTask('loadSsotFromDisk', outputChannel, async () => {
      const ssotPath = vscode.workspace
        .getConfiguration('atlasmind')
        .get<string>('ssotPath', DEFAULT_SSOT_PATH);
      await autoLoadWorkspaceSsot(
        workspaceFolder,
        ssotPath,
        coreReady.memoryManager,
        atlasContext!.memoryRefresh,
        outputChannel,
      );
    });
  }

  runBackgroundActivationTask('connectMcpServers', outputChannel, async () => {
    await coreReady.mcpServerRegistry.connectAll();
  });
  runBackgroundActivationTask('refreshProviderModels', outputChannel, async () => {
    await atlasContext!.refreshProviderModels(false);
  });
  runBackgroundActivationTask('updateProviderStatusBar', outputChannel, async () => {
    await updateProviderStatusBar(coreReady.providerStatusBar, coreReady.providerRegistry, context.secrets, atlasContext!.modelRouter);
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AtlasMind');
  outputChannel.appendLine('AtlasMind activating…');
  atlasContext = undefined;
  atlasStartupState = {
    status: 'booting',
    phase: 'bootstrapAtlasMind',
    startedAt: Date.now(),
  };

  void bootstrapAtlasMind(context, outputChannel);
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
        const models = await adapter.listModels();
        if (models.length > 0) {
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

function registerDefaultProviders(modelRouter: ModelRouter): void {
  // Minimal seed models — one per provider.  The `refreshProviderModelsCatalog()`
  // call at startup (and on manual refresh) discovers the full model list at
  // runtime via `discoverModels()` / `listModels()` and merges catalog metadata.
  // Seeds exist only so the router has *something* to work with before the
  // first refresh completes.
  const defaults: ProviderConfig[] = [
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'anthropic/claude-sonnet-4-20250514',
          provider: 'anthropic',
          name: 'Claude Sonnet 4',
          contextWindow: 200000,
          inputPricePer1k: 0.003,
          outputPricePer1k: 0.015,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/gpt-4.1-nano',
          provider: 'openai',
          name: 'GPT-4.1 Nano',
          contextWindow: 1000000,
          inputPricePer1k: 0.0001,
          outputPricePer1k: 0.0004,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'zai',
      displayName: 'z.ai (GLM)',
      apiKeySettingKey: 'atlasmind.provider.zai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'zai/glm-4.7-flash',
          provider: 'zai',
          name: 'GLM-4.7 Flash (Free)',
          contextWindow: 128000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      apiKeySettingKey: 'atlasmind.provider.deepseek.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'deepseek/deepseek-chat',
          provider: 'deepseek',
          name: 'DeepSeek V3',
          contextWindow: 64000,
          inputPricePer1k: 0.00027,
          outputPricePer1k: 0.0011,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'mistral',
      displayName: 'Mistral',
      apiKeySettingKey: 'atlasmind.provider.mistral.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'mistral/mistral-small-latest',
          provider: 'mistral',
          name: 'Mistral Small',
          contextWindow: 128000,
          inputPricePer1k: 0.0002,
          outputPricePer1k: 0.0006,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'google',
      displayName: 'Google Gemini',
      apiKeySettingKey: 'atlasmind.provider.google.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'google/gemini-2.0-flash',
          provider: 'google',
          name: 'Gemini 2.0 Flash',
          contextWindow: 1000000,
          inputPricePer1k: 0.0001,
          outputPricePer1k: 0.0004,
          capabilities: ['chat', 'code', 'vision', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'azure',
      displayName: 'Azure OpenAI',
      apiKeySettingKey: 'atlasmind.provider.azure.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [],
    },
    {
      id: 'bedrock',
      displayName: 'Amazon Bedrock',
      apiKeySettingKey: 'atlasmind.provider.bedrock.accessKeyId',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [],
    },
    {
      id: 'xai',
      displayName: 'xAI',
      apiKeySettingKey: 'atlasmind.provider.xai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'xai/grok-4',
          provider: 'xai',
          name: 'Grok 4',
          contextWindow: 2_000_000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'cohere',
      displayName: 'Cohere',
      apiKeySettingKey: 'atlasmind.provider.cohere.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'cohere/command-a-03-2025',
          provider: 'cohere',
          name: 'Command A',
          contextWindow: 256_000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'perplexity',
      displayName: 'Perplexity',
      apiKeySettingKey: 'atlasmind.provider.perplexity.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'perplexity/sonar',
          provider: 'perplexity',
          name: 'Sonar',
          contextWindow: 128_000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'reasoning'],
          enabled: true,
        },
      ],
    },
    {
      id: 'huggingface',
      displayName: 'Hugging Face Inference',
      apiKeySettingKey: 'atlasmind.provider.huggingface.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'huggingface/Qwen/Qwen2.5-Coder-32B-Instruct:novita',
          provider: 'huggingface',
          name: 'Qwen2.5 Coder 32B Instruct',
          contextWindow: 128_000,
          inputPricePer1k: 0.0006,
          outputPricePer1k: 0.0018,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'nvidia',
      displayName: 'NVIDIA NIM',
      apiKeySettingKey: 'atlasmind.provider.nvidia.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'nvidia/meta/llama-3.1-70b-instruct',
          provider: 'nvidia',
          name: 'Llama 3.1 70B Instruct',
          contextWindow: 128_000,
          inputPricePer1k: 0.0009,
          outputPricePer1k: 0.0009,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'copilot',
      displayName: 'GitHub Copilot',
      apiKeySettingKey: 'atlasmind.provider.copilot.apiKey',
      enabled: true,
      pricingModel: 'subscription',
      models: [
        {
          id: 'copilot/default',
          provider: 'copilot',
          name: 'Copilot Chat Model',
          contextWindow: 64000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.008,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'local',
      displayName: 'Local',
      apiKeySettingKey: 'atlasmind.provider.local.apiKey',
      enabled: true,
      pricingModel: 'free',
      models: [
        {
          id: 'local/echo-1',
          provider: 'local',
          name: 'Echo 1',
          contextWindow: 8000,
          inputPricePer1k: 0.01,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
      ],
    },
  ];

  for (const provider of defaults) {
    modelRouter.registerProvider(provider);
  }
}

async function refreshProviderModelsCatalog(
  modelRouter: ModelRouter,
  providerRegistry: ProviderRegistry,
  outputChannel?: vscode.OutputChannel,
  options?: { includeInteractiveProviders?: boolean },
): Promise<{ providersUpdated: number; modelsAvailable: number }> {
  const providers = modelRouter.listProviders();
  let providersUpdated = 0;
  let modelsAvailable = 0;
  const includeInteractiveProviders = options?.includeInteractiveProviders ?? true;

  for (const provider of providers) {
    if (!includeInteractiveProviders && requiresExplicitProviderActivation(provider.id)) {
      modelRouter.setProviderHealth(provider.id, false);
      outputChannel?.appendLine(`[providers] Deferred ${provider.id} discovery until the user explicitly activates that provider.`);
      modelsAvailable += provider.models.length;
      continue;
    }

    const adapter = providerRegistry.get(provider.id);
    if (!adapter) {
      modelsAvailable += provider.models.length;
      continue;
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

      if (adapter.discoverModels) {
        discoveredHints = await adapter.discoverModels();
        discoveredIds = discoveredHints.map(d => d.id);
      } else {
        discoveredIds = await adapter.listModels();
      }

      if (discoveredIds.length === 0) {
        modelsAvailable += provider.models.length;
        continue;
      }

      const normalized = [...new Set(discoveredIds.map(modelId => normalizeModelId(provider.id, modelId)))];
      const hintsById = new Map<string, DiscoveredModel>();
      if (discoveredHints) {
        for (const hint of discoveredHints) {
          hintsById.set(normalizeModelId(provider.id, hint.id), hint);
        }
      }

      const merged = mergeProviderModels(provider, normalized, hintsById);
      modelRouter.registerProvider({ ...provider, models: merged });
      providersUpdated += 1;
      modelsAvailable += merged.length;
    } catch (err) {
      outputChannel?.appendLine(
        `[providers] Model refresh failed for ${provider.id}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      modelsAvailable += provider.models.length;
    }
  }

  outputChannel?.appendLine(
    `[providers] Refreshed models: ${providersUpdated}/${providers.length} providers, ` +
    `${modelsAvailable} total model entries.`,
  );
  return { providersUpdated, modelsAvailable };
}

function normalizeModelId(providerId: ProviderId, modelId: string): string {
  const trimmed = modelId.trim();
  if (trimmed.includes('/')) {
    return trimmed;
  }
  return `${providerId}/${trimmed}`;
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
): ModelInfo[] {
  const existingById = new Map(provider.models.map(model => [model.id, model]));
  const allModelIds = new Set<string>([...provider.models.map(model => model.id), ...discoveredModelIds]);

  return [...allModelIds]
    .sort((a, b) => a.localeCompare(b))
    .map(modelId => {
      const existing = existingById.get(modelId);
      if (existing) {
        // Enrich static entry with any discovery hints (e.g. real context window)
        const hint = hints?.get(modelId);
        if (hint) {
          return {
            ...existing,
            contextWindow: hint.contextWindow ?? existing.contextWindow,
            name: hint.name ?? existing.name,
            capabilities: hint.capabilities ?? existing.capabilities,
            premiumRequestMultiplier: hint.premiumRequestMultiplier ?? existing.premiumRequestMultiplier,
          };
        }
        return existing;
      }
      return inferModelMetadata(provider.id, modelId, hints?.get(modelId));
    });
}

/**
 * Infer model metadata for a newly-discovered model ID.
 *
 * Resolution order:
 * 1. Values from the `DiscoveredModel` hint (runtime API data).
 * 2. Well-known model catalog lookup.
 * 3. Substring-based heuristic fallback.
 */
function inferModelMetadata(
  providerId: ProviderId,
  modelId: string,
  hint?: DiscoveredModel,
): ModelInfo {
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const catalogEntry = lookupCatalog(providerId, modelId);

  // Merge sources: hint > catalog > heuristic
  const name = hint?.name ?? catalogEntry?.name ?? toDisplayModelName(shortId);
  const contextWindow = hint?.contextWindow ?? catalogEntry?.contextWindow ?? inferContextWindow(shortId);
  const capabilities = hint?.capabilities ?? catalogEntry?.capabilities ?? inferCapabilities(shortId);
  const inputPricePer1k = hint?.inputPricePer1k ?? catalogEntry?.inputPricePer1k ?? inferPricing(shortId).input;
  const outputPricePer1k = hint?.outputPricePer1k ?? catalogEntry?.outputPricePer1k ?? inferPricing(shortId).output;
  const premiumRequestMultiplier = hint?.premiumRequestMultiplier ?? catalogEntry?.premiumRequestMultiplier;

  return {
    id: modelId,
    provider: providerId,
    name,
    contextWindow,
    inputPricePer1k,
    outputPricePer1k,
    capabilities,
    enabled: true,
    ...(premiumRequestMultiplier !== undefined && premiumRequestMultiplier !== 1
      ? { premiumRequestMultiplier }
      : {}),
  };
}

/** Heuristic context window estimate based on model name patterns. */
function inferContextWindow(shortId: string): number {
  const normalized = shortId.toLowerCase();
  if (normalized.includes('gemini')) {
    return 1_000_000;
  }
  if (normalized.includes('claude')) {
    return 200_000;
  }
  if (normalized.includes('gpt-4.1') || normalized.includes('gpt4.1')) {
    return 1_000_000;
  }
  return 128_000;
}

/** Heuristic capability inference from model name substrings. */
function inferCapabilities(shortId: string): ModelInfo['capabilities'] {
  const normalized = shortId.toLowerCase();

  const isReasoning =
    normalized.includes('reason') || normalized.includes('r1') || /\bo[1-4]\b/.test(normalized) ||
    normalized.includes('thinking');
  const isVision = normalized.includes('vision') || normalized.includes('image') || normalized.includes('vl');

  const capabilities: ModelInfo['capabilities'] = ['chat', 'code', 'function_calling'];
  if (isVision) {
    capabilities.push('vision');
  }
  if (isReasoning) {
    capabilities.push('reasoning');
  }

  return capabilities;
}

/** Heuristic pricing estimate from model name substrings. */
function inferPricing(shortId: string): { input: number; output: number } {
  const normalized = shortId.toLowerCase();

  const isCheap = normalized.includes('mini') || normalized.includes('nano') ||
    normalized.includes('flash') || normalized.includes('small') || normalized.includes('free');
  const isReasoning =
    normalized.includes('reason') || normalized.includes('r1') || /\bo[1-4]\b/.test(normalized) ||
    normalized.includes('thinking');
  const isPremium = normalized.includes('pro') || normalized.includes('ultra') ||
    normalized.includes('large') || normalized.includes('max') || isReasoning;

  if (isCheap) {
    return { input: 0.0001, output: 0.0004 };
  }
  if (isPremium) {
    return { input: 0.002, output: 0.008 };
  }
  return { input: 0.0006, output: 0.0024 };
}

function toDisplayModelName(modelId: string): string {
  return modelId
    .split(/[-._]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function registerDefaultAgent(agentRegistry: AgentRegistry): void {
  const baseAgent: AgentDefinition = {
    id: 'default',
    name: 'Default',
    role: 'general assistant',
    description: 'Fallback assistant for general development tasks.',
    systemPrompt: 'You are AtlasMind, a helpful and safe coding assistant.',
    skills: [],
    builtIn: true,
  };

  agentRegistry.register(baseAgent);
}

/**
 * Build the skill execution context backed by VS Code workspace APIs.
 * Injected into the Orchestrator so skills remain testable in isolation.
 */
function buildSkillExecutionContext(
  memoryManager: MemoryManager,
  memoryRefresh: vscode.EventEmitter<void>,
  checkpointManager?: CheckpointManager,
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
      await assertInsideWorkspace(absolutePath, 'readFile');
      const uri = vscode.Uri.file(absolutePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf-8');
    },

    async writeFile(absolutePath, content) {
      await assertInsideWorkspace(absolutePath, 'writeFile');
      const uri = vscode.Uri.file(absolutePath);
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
      await assertInsideWorkspace(targetPath, 'listDirectory');
      const resolvedPath = path.resolve(targetPath);
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

      const cwd = options?.cwd?.trim() || workspaceRoot;
      await assertInsideWorkspace(cwd, 'runCommand');
      const mappedExecutable = mapExecutableForWindows(executable.trim());

      try {
        const { stdout, stderr } = await execFileAsync(mappedExecutable, args ?? [], {
          cwd,
          timeout: clampInteger(options?.timeoutMs, 30000, 1000, 300000),
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        return { ok: true, exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
      } catch (error) {
        const maybe = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
        return {
          ok: false,
          exitCode: typeof maybe.code === 'number' ? maybe.code : 1,
          stdout: String(maybe.stdout ?? '').trim(),
          stderr: String(maybe.stderr ?? maybe.message ?? '').trim(),
        };
      }
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
      await assertInsideWorkspace(absolutePath, 'deleteFile');
      await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), { recursive: false, useTrash: false });
    },

    async moveFile(sourcePath, destPath) {
      await assertInsideWorkspace(sourcePath, 'moveFile');
      await assertInsideWorkspace(destPath, 'moveFile');
      await vscode.workspace.fs.rename(vscode.Uri.file(sourcePath), vscode.Uri.file(destPath), { overwrite: true });
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
      await assertInsideWorkspace(absolutePath, 'getDocumentSymbols');
      const uri = vscode.Uri.file(absolutePath);
      const symbols = await vscode.commands.executeCommand<unknown[]>('vscode.executeDocumentSymbolProvider', uri) ?? [];
      return symbols.map(symbol => serializeDocumentSymbol(symbol)).filter((value): value is { name: string; kind: string; range: string; children?: string[] } => Boolean(value));
    },

    async findReferences(absolutePath, line, column) {
      await assertInsideWorkspace(absolutePath, 'findReferences');
      const uri = vscode.Uri.file(absolutePath);
      const locations = await vscode.commands.executeCommand<unknown[]>('vscode.executeReferenceProvider', uri, new vscode.Position(line - 1, column - 1)) ?? [];
      return await serializeLocationsWithContext(locations);
    },

    async goToDefinition(absolutePath, line, column) {
      await assertInsideWorkspace(absolutePath, 'goToDefinition');
      const uri = vscode.Uri.file(absolutePath);
      const locations = await vscode.commands.executeCommand<unknown[]>('vscode.executeDefinitionProvider', uri, new vscode.Position(line - 1, column - 1)) ?? [];
      return normalizeLocationTargets(locations);
    },

    async renameSymbol(absolutePath, line, column, newName) {
      await assertInsideWorkspace(absolutePath, 'renameSymbol');
      const uri = vscode.Uri.file(absolutePath);
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

    async getCodeActions(absolutePath, startLine, startColumn, endLine, endColumn) {
      await assertInsideWorkspace(absolutePath, 'getCodeActions');
      const uri = vscode.Uri.file(absolutePath);
      const range = new vscode.Range(startLine - 1, startColumn - 1, endLine - 1, endColumn - 1);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[] | undefined>('vscode.executeCodeActionProvider', uri, range) ?? [];
      return actions.map(action => ({
        title: action.title,
        kind: action.kind?.value,
        isPreferred: action.isPreferred,
      }));
    },

    async applyCodeAction(absolutePath, startLine, startColumn, endLine, endColumn, actionTitle) {
      await assertInsideWorkspace(absolutePath, 'applyCodeAction');
      const uri = vscode.Uri.file(absolutePath);
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
    return targetPath ? [targetPath] : [];
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

  for (const script of availableScripts) {
    const result = await skillContext.runCommand(packageManager, buildPackageManagerArgs(packageManager, script), {
      cwd: workspaceRoot,
      timeoutMs,
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
  const output = [result.stdout, result.stderr].filter(text => text.trim().length > 0).join('\n');
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
 * Verify that a canonicalized absolute path lives inside the open workspace root.
 * Uses realpath resolution so symlinks cannot tunnel reads or writes outside the
 * workspace boundary.
 */
async function assertInsideWorkspace(absolutePath: string, operation: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error(`${operation}: no workspace folder is open.`);
  }

  const resolvedRoot = await fs.realpath(path.resolve(workspaceRoot));
  const resolved = await resolveCanonicalPath(path.resolve(absolutePath));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `${operation} is restricted to the workspace. ` +
      `"${absolutePath}" resolves outside "${resolvedRoot}".`,
    );
  }
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

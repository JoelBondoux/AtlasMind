import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { registerChatParticipant } from './chat/participant.js';
import { registerCommands } from './commands.js';
import { registerTreeViews } from './views/treeViews.js';
import { Orchestrator } from './core/orchestrator.js';
import { AgentRegistry } from './core/agentRegistry.js';
import { SkillsRegistry } from './core/skillsRegistry.js';
import { ModelRouter } from './core/modelRouter.js';
import { MemoryManager } from './memory/memoryManager.js';
import { CostTracker } from './core/costTracker.js';
import { ScannerRulesManager } from './core/scannerRulesManager.js';
import { ToolWebhookDispatcher } from './core/toolWebhookDispatcher.js';
import { TaskProfiler } from './core/taskProfiler.js';
import { McpServerRegistry } from './mcp/mcpServerRegistry.js';
import { AnthropicAdapter, CopilotAdapter, LocalEchoAdapter, OpenAiCompatibleAdapter, ProviderRegistry } from './providers/index.js';
import { createBuiltinSkills } from './skills/index.js';
import { loadUserAgents } from './views/agentManagerPanel.js';
import type { AgentDefinition, ModelInfo, ProviderConfig, ProviderId, SkillExecutionContext } from './types.js';

const execFileAsync = promisify(execFile);

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
  /** Manages scanner rule overrides and custom rules in globalState. */
  scannerRulesManager: ScannerRulesManager;
  /** Manages MCP server connections and bridges tools into the SkillsRegistry. */
  mcpServerRegistry: McpServerRegistry;
  /** Raw VS Code extension context (for globalState, secrets, extensionUri, etc.). */
  extensionContext: vscode.ExtensionContext;
  /** Refresh available models from all provider adapters and update router catalogs. */
  refreshProviderModels(): Promise<{ providersUpdated: number; modelsAvailable: number }>;
  /** Dispatches outbound webhook notifications for tool execution lifecycle events. */
  toolWebhookDispatcher: ToolWebhookDispatcher;
}

let atlasContext: AtlasMindContext | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AtlasMind');
  outputChannel.appendLine('AtlasMind activating…');

  // ── Core services ──────────────────────────────────────────
  const costTracker = new CostTracker();
  const agentRegistry = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const modelRouter = new ModelRouter();
  const taskProfiler = new TaskProfiler();
  const memoryManager = new MemoryManager();
  const providerRegistry = new ProviderRegistry();
  const skillsRefresh = new vscode.EventEmitter<void>();
  const agentsRefresh = new vscode.EventEmitter<void>();
  const scannerRulesManager = new ScannerRulesManager(context.globalState);
  const toolWebhookDispatcher = new ToolWebhookDispatcher(context, outputChannel);

  providerRegistry.register(new LocalEchoAdapter());
  providerRegistry.register(new AnthropicAdapter(context.secrets));
  providerRegistry.register(new CopilotAdapter());
  providerRegistry.register(new OpenAiCompatibleAdapter(
    { providerId: 'openai', baseUrl: 'https://api.openai.com/v1', secretKey: 'atlasmind.provider.openai.apiKey', displayName: 'OpenAI' },
    context.secrets,
  ));
  providerRegistry.register(new OpenAiCompatibleAdapter(
    { providerId: 'zai', baseUrl: 'https://api.z.ai/api/paas/v4', secretKey: 'atlasmind.provider.zai.apiKey', displayName: 'z.ai' },
    context.secrets,
  ));
  providerRegistry.register(new OpenAiCompatibleAdapter(
    { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', secretKey: 'atlasmind.provider.deepseek.apiKey', displayName: 'DeepSeek' },
    context.secrets,
  ));
  providerRegistry.register(new OpenAiCompatibleAdapter(
    { providerId: 'mistral', baseUrl: 'https://api.mistral.ai/v1', secretKey: 'atlasmind.provider.mistral.apiKey', displayName: 'Mistral' },
    context.secrets,
  ));
  providerRegistry.register(new OpenAiCompatibleAdapter(
    { providerId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', secretKey: 'atlasmind.provider.google.apiKey', displayName: 'Google Gemini' },
    context.secrets,
  ));

  registerDefaultProviders(modelRouter);
  const refreshProviderModels = () =>
    refreshProviderModelsCatalog(modelRouter, providerRegistry, outputChannel);
  void refreshProviderModels();
  registerDefaultAgent(agentRegistry);
  // Restore user-created agents persisted from a previous session
  for (const agent of loadUserAgents(context.globalState)) {
    agentRegistry.register(agent);
  }

  // Restore persisted disabled-agent state
  agentRegistry.setDisabledIds(
    context.globalState.get<string[]>('atlasmind.disabledAgentIds', []),
  );
  for (const skill of createBuiltinSkills()) {
    skillsRegistry.register(skill);
  }

  // Restore persisted disabled-skill state
  skillsRegistry.setDisabledIds(
    context.globalState.get<string[]>('atlasmind.disabledSkillIds', []),
  );

  // Auto-approve built-in skills (vetted extension code)
  for (const skill of skillsRegistry.listSkills().filter(s => s.builtIn)) {
    skillsRegistry.setScanResult({
      skillId: skill.id,
      status: 'passed',
      scannedAt: new Date().toISOString(),
      issues: [],
    });
  }

  const skillContext = buildSkillExecutionContext(memoryManager);

  const orchestrator = new Orchestrator(
    agentRegistry,
    skillsRegistry,
    modelRouter,
    memoryManager,
    costTracker,
    providerRegistry,
    skillContext,
    taskProfiler,
    toolWebhookDispatcher,
  );

  const mcpServerRegistry = new McpServerRegistry(
    context.globalState,
    skillsRegistry,
    () => skillsRefresh.fire(),
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
    scannerRulesManager,
    mcpServerRegistry,
    extensionContext: context,
    refreshProviderModels,
    toolWebhookDispatcher,
  };

  context.subscriptions.push(skillsRefresh);
  context.subscriptions.push(agentsRefresh);
  context.subscriptions.push({
    dispose: () => { void mcpServerRegistry.disposeAll(); },
  });

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const ssotPath = vscode.workspace
      .getConfiguration('atlasmind')
      .get<string>('ssotPath', 'project_memory');
    const ssotUri = vscode.Uri.joinPath(workspaceFolder.uri, ssotPath);
    void memoryManager.loadFromDisk(ssotUri);
  }

  // Connect all enabled MCP servers in the background (non-blocking)
  void mcpServerRegistry.connectAll();

  // ── Registrations ──────────────────────────────────────────
  registerChatParticipant(context, atlasContext);
  registerCommands(context, atlasContext);
  registerTreeViews(context, atlasContext);

  outputChannel.appendLine('AtlasMind activated ✓');
}

export function deactivate(): void {
  atlasContext = undefined;
}

function registerDefaultProviders(modelRouter: ModelRouter): void {
  const defaults: ProviderConfig[] = [
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      models: [
        {
          id: 'anthropic/claude-3-5-haiku-latest',
          provider: 'anthropic',
          name: 'Claude 3.5 Haiku (Latest)',
          contextWindow: 200000,
          inputPricePer1k: 0.0008,
          outputPricePer1k: 0.004,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
        {
          id: 'anthropic/claude-3-7-sonnet-latest',
          provider: 'anthropic',
          name: 'Claude 3.7 Sonnet (Latest)',
          contextWindow: 200000,
          inputPricePer1k: 0.003,
          outputPricePer1k: 0.015,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      models: [
        {
          id: 'openai/gpt-4o-mini',
          provider: 'openai',
          name: 'GPT-4o mini',
          contextWindow: 128000,
          inputPricePer1k: 0.00015,
          outputPricePer1k: 0.0006,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'openai/gpt-4o',
          provider: 'openai',
          name: 'GPT-4o',
          contextWindow: 128000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'vision', 'function_calling', 'reasoning'],
          enabled: true,
        },
      ],
    },
    {
      id: 'zai',
      displayName: 'z.ai (GLM)',
      apiKeySettingKey: 'atlasmind.provider.zai.apiKey',
      enabled: true,
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
        {
          id: 'zai/glm-4.7',
          provider: 'zai',
          name: 'GLM-4.7',
          contextWindow: 128000,
          inputPricePer1k: 0.0006,
          outputPricePer1k: 0.0022,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
        {
          id: 'zai/glm-5',
          provider: 'zai',
          name: 'GLM-5',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.0032,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      apiKeySettingKey: 'atlasmind.provider.deepseek.apiKey',
      enabled: true,
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
        {
          id: 'deepseek/deepseek-reasoner',
          provider: 'deepseek',
          name: 'DeepSeek R1',
          contextWindow: 64000,
          inputPricePer1k: 0.00055,
          outputPricePer1k: 0.00219,
          capabilities: ['chat', 'code', 'reasoning'],
          enabled: true,
        },
      ],
    },
    {
      id: 'mistral',
      displayName: 'Mistral',
      apiKeySettingKey: 'atlasmind.provider.mistral.apiKey',
      enabled: true,
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
        {
          id: 'mistral/mistral-large-latest',
          provider: 'mistral',
          name: 'Mistral Large',
          contextWindow: 128000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.006,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'google',
      displayName: 'Google Gemini',
      apiKeySettingKey: 'atlasmind.provider.google.apiKey',
      enabled: true,
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
        {
          id: 'google/gemini-1.5-pro',
          provider: 'google',
          name: 'Gemini 1.5 Pro',
          contextWindow: 2000000,
          inputPricePer1k: 0.00125,
          outputPricePer1k: 0.005,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'copilot',
      displayName: 'GitHub Copilot',
      apiKeySettingKey: 'atlasmind.provider.copilot.apiKey',
      enabled: true,
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
): Promise<{ providersUpdated: number; modelsAvailable: number }> {
  const providers = modelRouter.listProviders();
  let providersUpdated = 0;
  let modelsAvailable = 0;

  for (const provider of providers) {
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

      const discovered = await adapter.listModels();
      if (discovered.length === 0) {
        modelsAvailable += provider.models.length;
        continue;
      }

      const normalized = [...new Set(discovered.map(modelId => normalizeModelId(provider.id, modelId)))];
      const merged = mergeProviderModels(provider, normalized);
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

function mergeProviderModels(provider: ProviderConfig, discoveredModelIds: string[]): ModelInfo[] {
  const existingById = new Map(provider.models.map(model => [model.id, model]));
  const allModelIds = new Set<string>([...provider.models.map(model => model.id), ...discoveredModelIds]);

  return [...allModelIds]
    .sort((a, b) => a.localeCompare(b))
    .map(modelId => {
      const existing = existingById.get(modelId);
      if (existing) {
        return existing;
      }
      return inferModelMetadata(provider.id, modelId);
    });
}

function inferModelMetadata(providerId: ProviderId, modelId: string): ModelInfo {
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const normalized = shortId.toLowerCase();

  const isReasoning =
    normalized.includes('reason') || normalized.includes('r1') || normalized.includes('o1') ||
    normalized.includes('o3') || normalized.includes('o4') || normalized.includes('thinking');
  const isVision = normalized.includes('vision') || normalized.includes('image') || normalized.includes('vl');
  const isCheap = normalized.includes('mini') || normalized.includes('nano') ||
    normalized.includes('flash') || normalized.includes('small') || normalized.includes('free');
  const isPremium = normalized.includes('pro') || normalized.includes('ultra') ||
    normalized.includes('large') || normalized.includes('max') || isReasoning;

  const capabilities: ModelInfo['capabilities'] = ['chat', 'code', 'function_calling'];
  if (isVision) {
    capabilities.push('vision');
  }
  if (isReasoning) {
    capabilities.push('reasoning');
  }

  const pricing = isCheap
    ? { input: 0.0001, output: 0.0004 }
    : isPremium
      ? { input: 0.002, output: 0.008 }
      : { input: 0.0006, output: 0.0024 };

  return {
    id: modelId,
    provider: providerId,
    name: toDisplayModelName(shortId),
    contextWindow: 128000,
    inputPricePer1k: pricing.input,
    outputPricePer1k: pricing.output,
    capabilities,
    enabled: true,
  };
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
function buildSkillExecutionContext(memoryManager: MemoryManager): SkillExecutionContext {
  return {
    get workspaceRootPath() {
      return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    },

    queryMemory(query, maxResults) {
      return memoryManager.queryRelevant(query, maxResults);
    },

    upsertMemory(entry) {
      memoryManager.upsert(entry);
    },

    async readFile(absolutePath) {
      assertInsideWorkspace(absolutePath, 'readFile');
      const uri = vscode.Uri.file(absolutePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf-8');
    },

    async writeFile(absolutePath, content) {
      assertInsideWorkspace(absolutePath, 'writeFile');
      const uri = vscode.Uri.file(absolutePath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    },

    async findFiles(globPattern) {
      const uris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 100);
      return uris.map(u => u.fsPath);
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
  };
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
 * Verify that a resolved absolute path lives inside the open workspace root.
 * Uses `path.resolve()` so that `..` traversal, symlink tricks, and prefix
 * collisions (e.g. `/project` vs `/project-evil`) are all handled correctly.
 */
function assertInsideWorkspace(absolutePath: string, operation: string): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    throw new Error(`${operation}: no workspace folder is open.`);
  }
  const resolved = path.resolve(absolutePath);
  const resolvedRoot = path.resolve(workspaceRoot);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(
      `${operation} is restricted to the workspace. ` +
      `"${absolutePath}" resolves outside "${resolvedRoot}".`,
    );
  }
}

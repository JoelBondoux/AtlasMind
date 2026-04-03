import * as vscode from 'vscode';
import { registerChatParticipant } from './chat/participant.js';
import { registerCommands } from './commands.js';
import { registerTreeViews } from './views/treeViews.js';
import { Orchestrator } from './core/orchestrator.js';
import { AgentRegistry } from './core/agentRegistry.js';
import { SkillsRegistry } from './core/skillsRegistry.js';
import { ModelRouter } from './core/modelRouter.js';
import { MemoryManager } from './memory/memoryManager.js';
import { CostTracker } from './core/costTracker.js';
import { AnthropicAdapter, CopilotAdapter, LocalEchoAdapter, ProviderRegistry } from './providers/index.js';
import type { AgentDefinition, ProviderConfig } from './types.js';

export interface AtlasMindContext {
  orchestrator: Orchestrator;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  modelRouter: ModelRouter;
  memoryManager: MemoryManager;
  costTracker: CostTracker;
  providerRegistry: ProviderRegistry;
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
  const memoryManager = new MemoryManager();
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new LocalEchoAdapter());
  providerRegistry.register(new AnthropicAdapter(context.secrets));
  providerRegistry.register(new CopilotAdapter());

  registerDefaultProviders(modelRouter);
  registerDefaultAgent(agentRegistry);

  const orchestrator = new Orchestrator(
    agentRegistry,
    skillsRegistry,
    modelRouter,
    memoryManager,
    costTracker,
    providerRegistry,
  );

  atlasContext = {
    orchestrator,
    agentRegistry,
    skillsRegistry,
    modelRouter,
    memoryManager,
    costTracker,
    providerRegistry,
  };

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const ssotPath = vscode.workspace
      .getConfiguration('atlasmind')
      .get<string>('ssotPath', 'project_memory');
    const ssotUri = vscode.Uri.joinPath(workspaceFolder.uri, ssotPath);
    void memoryManager.loadFromDisk(ssotUri);
  }

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
          capabilities: ['chat', 'code', 'reasoning'],
          enabled: true,
        },
        {
          id: 'anthropic/claude-3-7-sonnet-latest',
          provider: 'anthropic',
          name: 'Claude 3.7 Sonnet (Latest)',
          contextWindow: 200000,
          inputPricePer1k: 0.003,
          outputPricePer1k: 0.015,
          capabilities: ['chat', 'code', 'reasoning'],
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
          capabilities: ['chat', 'code', 'reasoning'],
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

function registerDefaultAgent(agentRegistry: AgentRegistry): void {
  const baseAgent: AgentDefinition = {
    id: 'default',
    name: 'Default',
    role: 'general assistant',
    description: 'Fallback assistant for general development tasks.',
    systemPrompt: 'You are AtlasMind, a helpful and safe coding assistant.',
    skills: [],
  };

  agentRegistry.register(baseAgent);
}

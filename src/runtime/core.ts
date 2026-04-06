import type { OrchestratorConfig, OrchestratorHooks, ProviderConfig, AgentDefinition, SkillDefinition, SkillExecutionContext } from '../types.js';
import { Orchestrator } from '../core/orchestrator.js';
import { AgentRegistry } from '../core/agentRegistry.js';
import { SkillsRegistry } from '../core/skillsRegistry.js';
import { ModelRouter } from '../core/modelRouter.js';
import { ProviderRegistry } from '../providers/registry.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { CostTracker } from '../core/costTracker.js';
import type { ToolWebhookDispatcher } from '../core/toolWebhookDispatcher.js';
import { createBuiltinSkills } from '../skills/index.js';

type MemoryQueryStore = Pick<MemoryManager, 'queryRelevant' | 'getWarnedEntries' | 'getBlockedEntries' | 'redactSnippet'>;

type CostTrackingStore = Pick<CostTracker, 'record' | 'getDailyBudgetStatus'>;

export interface AtlasRuntimeBuildOptions {
  memoryStore: MemoryQueryStore;
  costTracker: CostTrackingStore;
  skillContext: SkillExecutionContext;
  providerAdapters?: ProviderAdapter[];
  plugins?: AtlasRuntimePlugin[];
  toolWebhookDispatcher?: ToolWebhookDispatcher;
  hooks?: OrchestratorHooks;
  config?: Partial<OrchestratorConfig>;
  onRuntimeEvent?: (event: AtlasRuntimeLifecycleEvent) => void;
}

export interface AtlasRuntime {
  orchestrator: Orchestrator;
  agentRegistry: AgentRegistry;
  skillsRegistry: SkillsRegistry;
  modelRouter: ModelRouter;
  providerRegistry: ProviderRegistry;
  taskProfiler: TaskProfiler;
  costTracker: CostTrackingStore;
  plugins: AtlasRuntimePluginManifest[];
}

export type AtlasRuntimeLifecycleStage =
  | 'runtime:bootstrapping'
  | 'runtime:providers-registered'
  | 'runtime:default-agent-registered'
  | 'runtime:builtin-skills-registered'
  | 'runtime:plugin-registering'
  | 'runtime:plugin-registered'
  | 'runtime:ready';

export interface AtlasRuntimeLifecycleEvent {
  stage: AtlasRuntimeLifecycleStage;
  timestamp: string;
  summary: string;
  pluginId?: string;
  details?: Record<string, string | number | boolean | undefined>;
}

export interface AtlasRuntimePluginManifest {
  id: string;
  description?: string;
  contributionCounts: {
    providers: number;
    agents: number;
    skills: number;
  };
}

export interface AtlasRuntimePluginApi {
  readonly agentRegistry: AgentRegistry;
  readonly skillsRegistry: SkillsRegistry;
  readonly modelRouter: ModelRouter;
  readonly providerRegistry: ProviderRegistry;
  readonly taskProfiler: TaskProfiler;
  readonly hooks?: OrchestratorHooks;
  registerProvider(adapter: ProviderAdapter): void;
  registerAgent(agent: AgentDefinition): void;
  registerSkill(skill: SkillDefinition): void;
  emitRuntimeEvent(event: Omit<AtlasRuntimeLifecycleEvent, 'timestamp'>): void;
}

export interface AtlasRuntimePlugin {
  id: string;
  description?: string;
  register?(api: AtlasRuntimePluginApi): void;
  onRuntimeEvent?(event: AtlasRuntimeLifecycleEvent, api: AtlasRuntimePluginApi): void;
}

export function createAtlasRuntime(options: AtlasRuntimeBuildOptions): AtlasRuntime {
  const agentRegistry = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const modelRouter = new ModelRouter();
  const providerRegistry = new ProviderRegistry();
  const taskProfiler = new TaskProfiler();
  const pluginManifests: AtlasRuntimePluginManifest[] = [];

  let pluginApi!: AtlasRuntimePluginApi;
  const emitRuntimeEvent = (event: Omit<AtlasRuntimeLifecycleEvent, 'timestamp'>): void => {
    const enrichedEvent: AtlasRuntimeLifecycleEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    options.onRuntimeEvent?.(enrichedEvent);
    for (const plugin of options.plugins ?? []) {
      plugin.onRuntimeEvent?.(enrichedEvent, pluginApi);
    }
  };

  pluginApi = {
    agentRegistry,
    skillsRegistry,
    modelRouter,
    providerRegistry,
    taskProfiler,
    hooks: options.hooks,
    registerProvider(adapter) {
      providerRegistry.register(adapter);
    },
    registerAgent(agent) {
      agentRegistry.register(agent);
    },
    registerSkill(skill) {
      skillsRegistry.register(skill);
    },
    emitRuntimeEvent,
  };

  emitRuntimeEvent({
    stage: 'runtime:bootstrapping',
    summary: 'Bootstrapping AtlasMind shared runtime.',
  });

  for (const adapter of options.providerAdapters ?? []) {
    providerRegistry.register(adapter);
  }

  emitRuntimeEvent({
    stage: 'runtime:providers-registered',
    summary: 'Registered initial provider adapters.',
    details: { count: options.providerAdapters?.length ?? 0 },
  });

  seedDefaultProviders(modelRouter);
  registerDefaultAgent(agentRegistry);

  emitRuntimeEvent({
    stage: 'runtime:default-agent-registered',
    summary: 'Registered the default AtlasMind agent.',
  });

  for (const skill of createBuiltinSkills()) {
    skillsRegistry.register(skill);
  }

  emitRuntimeEvent({
    stage: 'runtime:builtin-skills-registered',
    summary: 'Registered built-in AtlasMind skills.',
    details: { count: skillsRegistry.listSkills().length },
  });

  for (const plugin of options.plugins ?? []) {
    const manifest: AtlasRuntimePluginManifest = {
      id: plugin.id,
      description: plugin.description,
      contributionCounts: { providers: 0, agents: 0, skills: 0 },
    };

    const pluginScopedApi: AtlasRuntimePluginApi = {
      ...pluginApi,
      registerProvider(adapter) {
        providerRegistry.register(adapter);
        manifest.contributionCounts.providers += 1;
      },
      registerAgent(agent) {
        agentRegistry.register(agent);
        manifest.contributionCounts.agents += 1;
      },
      registerSkill(skill) {
        skillsRegistry.register(skill);
        manifest.contributionCounts.skills += 1;
      },
    };

    emitRuntimeEvent({
      stage: 'runtime:plugin-registering',
      pluginId: plugin.id,
      summary: `Registering runtime plugin "${plugin.id}".`,
    });
    plugin.register?.(pluginScopedApi);
    pluginManifests.push(manifest);
    emitRuntimeEvent({
      stage: 'runtime:plugin-registered',
      pluginId: plugin.id,
      summary: `Registered runtime plugin "${plugin.id}".`,
      details: {
        providers: manifest.contributionCounts.providers,
        agents: manifest.contributionCounts.agents,
        skills: manifest.contributionCounts.skills,
      },
    });
  }

  const orchestrator = new Orchestrator(
    agentRegistry,
    skillsRegistry,
    modelRouter,
    options.memoryStore,
    options.costTracker,
    providerRegistry,
    options.skillContext,
    taskProfiler,
    options.toolWebhookDispatcher,
    options.hooks,
    options.config,
  );

  emitRuntimeEvent({
    stage: 'runtime:ready',
    summary: 'AtlasMind shared runtime is ready.',
    details: {
      providers: providerRegistry.list().length,
      agents: agentRegistry.listAgents().length,
      skills: skillsRegistry.listSkills().length,
      plugins: pluginManifests.length,
    },
  });

  return {
    orchestrator,
    agentRegistry,
    skillsRegistry,
    modelRouter,
    providerRegistry,
    taskProfiler,
    costTracker: options.costTracker,
    plugins: pluginManifests,
  };
}

export function registerDefaultAgent(agentRegistry: AgentRegistry): void {
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

export function seedDefaultProviders(modelRouter: ModelRouter): void {
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
          contextWindow: 2000000,
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
          contextWindow: 256000,
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
          contextWindow: 128000,
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
          contextWindow: 128000,
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
          contextWindow: 128000,
          inputPricePer1k: 0.0009,
          outputPricePer1k: 0.0009,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
    },
    {
      id: 'local',
      displayName: 'Local Model',
      apiKeySettingKey: 'atlasmind.provider.local.apiKey',
      enabled: true,
      pricingModel: 'free',
      models: [
        {
          id: 'local/echo-1',
          provider: 'local',
          name: 'Local Echo',
          contextWindow: 8000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat'],
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
          contextWindow: 128000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'function_calling'],
          enabled: true,
        },
      ],
      subscriptionQuota: {
        totalRequests: 300,
        remainingRequests: 300,
        costPerRequestUnit: 0.033,
      },
    },
  ];

  for (const provider of defaults) {
    modelRouter.registerProvider(provider);
  }
}
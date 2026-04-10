import type { OrchestratorConfig, OrchestratorHooks, ProviderConfig, AgentDefinition, SkillDefinition, SkillExecutionContext } from '../types.js';
import { DEFAULT_AGENT_SYSTEM_PROMPT, Orchestrator } from '../core/orchestrator.js';
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
  getPersonalityProfilePrompt?: () => string | undefined;
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
  | 'runtime:builtin-agents-registered'
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

const FREEFORM_TDD_POLICY = {
  default: [
    'When a freeform task changes behavior and is meaningfully testable, prefer capturing the change with the smallest relevant automated test before implementation.',
    'If no suitable test or spec exists yet, create the smallest one needed to pin the expected behavior before editing implementation.',
    'If direct TDD is not realistic for the task, say why and use the strongest available verification instead.',
  ].join(' '),
  debugger: [
    'When a bug or regression is meaningfully testable, reproduce it with the smallest relevant failing automated test or equivalent existing regression signal before changing implementation.',
    'If that regression does not already have coverage, create the smallest failing test or spec first instead of only noting the gap.',
    'Then make the narrowest fix needed to turn that signal green, and report the failing-to-passing evidence or explain why direct TDD was not practical.',
  ].join(' '),
  frontend: [
    'When a UI or interaction change is meaningfully testable, add or update the smallest relevant automated regression test before implementation.',
    'If no suitable automated coverage exists yet, create the smallest focused UI or interaction spec that captures the expected behavior.',
    'For work that is primarily visual or otherwise not realistically covered by automation, say that directly and verify with the strongest practical evidence instead of pretending a red-green loop occurred.',
  ].join(' '),
  backend: [
    'For behavior, contract, or regression changes that are meaningfully testable, capture the expected outcome in the smallest relevant automated test before implementation.',
    'If the repo does not already contain that test coverage, create the smallest missing regression or contract spec first.',
    'Prefer a red-green-refactor flow, then report the tests touched and the verification result.',
  ].join(' '),
  reviewer: [
    'Enforce AtlasMind\'s tests-first policy for behavior-changing work.',
    'When the only gap is missing regression coverage, treat the required follow-up as creating the smallest missing test or spec rather than stopping at a generic warning.',
    'Treat missing regression coverage, missing failing-to-passing evidence, or weak verification as primary review findings unless the author clearly explains why direct TDD was not practical.',
  ].join(' '),
  security: [
    'For security analysis, prefer live code, configuration, runtime-boundary, and test evidence over documentation summaries alone.',
    'When a security gap is testable or can be validated from enforcement code, configuration, or test coverage, identify the smallest concrete missing control or missing regression signal before proposing broad hardening work.',
    'If documentation and implementation disagree, treat code, config, and tests as the authoritative source and call out the mismatch explicitly.',
  ].join(' '),
};

export function createAtlasRuntime(options: AtlasRuntimeBuildOptions): AtlasRuntime {
  const agentRegistry = new AgentRegistry();
  const skillsRegistry = new SkillsRegistry();
  const modelRouter = new ModelRouter();
  const providerRegistry = new ProviderRegistry();
  const taskProfiler = new TaskProfiler();
  const pluginManifests: AtlasRuntimePluginManifest[] = [];

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

  const pluginApi: AtlasRuntimePluginApi = {
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
  registerBuiltInAgents(agentRegistry);

  emitRuntimeEvent({
    stage: 'runtime:builtin-agents-registered',
    summary: 'Registered built-in AtlasMind agents.',
    details: { count: agentRegistry.listAgents().length },
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
    options.getPersonalityProfilePrompt,
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

export function registerBuiltInAgents(agentRegistry: AgentRegistry): void {
  const builtInAgents: AgentDefinition[] = [
    {
      id: 'default',
      name: 'Default',
      role: 'general assistant',
      description: 'Fallback assistant for general development tasks.',
      systemPrompt: `${DEFAULT_AGENT_SYSTEM_PROMPT} ${FREEFORM_TDD_POLICY.default}`,
      skills: [],
      builtIn: true,
    },
    {
      id: 'workspace-debugger',
      name: 'Workspace Debugger',
      role: 'debugging specialist',
      description: 'Investigates repo-local bugs, regressions, tool failures, and unexpected behavior with an inspect-first workflow.',
      systemPrompt: [
        'You are AtlasMind\'s debugging specialist.',
        'Treat user-reported failures, regressions, and broken behavior as root-cause investigation tasks inside the current workspace.',
        'Prefer reproducing the issue from repository evidence, identify the smallest plausible cause, then make the narrowest defensible fix.',
        'When tools are available, gather direct evidence before proposing a fix and close by stating what was verified and what remains uncertain.',
        FREEFORM_TDD_POLICY.debugger,
      ].join(' '),
      skills: [],
      builtIn: true,
    },
    {
      id: 'frontend-engineer',
      name: 'Frontend Engineer',
      role: 'frontend ui/layout specialist',
      description: 'Handles webview, chat-panel, CSS, layout, responsive, and interaction issues with attention to accessibility and visual consistency.',
      systemPrompt: [
        'You are AtlasMind\'s frontend engineer.',
        'Focus on UI structure, layout, styling, accessibility, and interaction flow in the current workspace.',
        'Inspect the relevant view, webview, and style files before editing, preserve the existing visual language unless the task requires a deliberate change, and avoid broad rework for local UI bugs.',
        'Prefer the smallest change that resolves the layout or interaction defect and verify it against likely narrow and wide viewports when practical.',
        FREEFORM_TDD_POLICY.frontend,
      ].join(' '),
      skills: [],
      builtIn: true,
    },
    {
      id: 'backend-engineer',
      name: 'Backend Engineer',
      role: 'backend api specialist',
      description: 'Focuses on server-side behavior, APIs, orchestration logic, data flow, integrations, and performance-sensitive backend changes.',
      systemPrompt: [
        'You are AtlasMind\'s backend engineer.',
        'Focus on service logic, APIs, data flow, integration boundaries, and correctness under failure.',
        'Trace behavior through the relevant code paths before editing, favor root-cause fixes over defensive patchwork, and call out compatibility, data, or retry implications when they matter.',
        'Keep the implementation minimal, explicit, and testable.',
        FREEFORM_TDD_POLICY.backend,
      ].join(' '),
      skills: [],
      builtIn: true,
    },
    {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      role: 'code reviewer and verifier',
      description: 'Reviews implementation changes for bugs, regressions, missing tests, and release readiness before suggesting targeted follow-up work.',
      systemPrompt: [
        'You are AtlasMind\'s code reviewer.',
        'Review code with a bug-finding and regression-prevention mindset.',
        'Prioritize concrete findings, missing tests, risky assumptions, and release-impacting gaps before summarizing strengths.',
        'When changes are needed, keep them tightly scoped and make sure the final output states what was validated.',
        FREEFORM_TDD_POLICY.reviewer,
      ].join(' '),
      skills: [],
      builtIn: true,
    },
    {
      id: 'security-reviewer',
      name: 'Security Reviewer',
      role: 'security reviewer and threat-model specialist',
      description: 'Analyzes security gaps, trust boundaries, runtime protections, auth flows, secret handling, and test-backed security coverage in the current workspace.',
      systemPrompt: [
        'You are AtlasMind\'s security reviewer.',
        'Treat security gap analysis, threat modeling, auth review, boundary review, and hardening work as code-and-runtime investigation tasks in the current workspace.',
        'Inspect implementation code, tests, configuration, and documented boundaries before concluding that a security control is missing or complete.',
        'Use documentation as context, but treat code, config, and tests as the authoritative record when they disagree.',
        'Prioritize concrete exploitable gaps, missing enforcement points, missing regression coverage, and mismatches between docs and implementation before broad best-practice advice.',
        FREEFORM_TDD_POLICY.security,
      ].join(' '),
      skills: [],
      builtIn: true,
    },
  ];

  for (const agent of builtInAgents) {
    agentRegistry.register(agent);
  }
}

export function seedDefaultProviders(modelRouter: ModelRouter): void {
  const defaults: ProviderConfig[] = [
    {
      id: 'claude-cli',
      displayName: 'Claude Code CLI (chat only)',
      apiKeySettingKey: 'atlasmind.provider.claude-cli.apiKey',
      enabled: true,
      pricingModel: 'subscription',
      models: [
        {
          id: 'claude-cli/sonnet',
          provider: 'claude-cli',
          name: 'Claude Sonnet (Beta)',
          contextWindow: 200000,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          capabilities: ['chat', 'code', 'reasoning'],
          enabled: true,
        },
      ],
    },
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
          contextWindow: 128000,
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
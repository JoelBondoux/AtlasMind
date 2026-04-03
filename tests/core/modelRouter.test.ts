import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type { ProviderConfig } from '../../src/types.ts';

describe('ModelRouter', () => {
  it('respects preferred provider when selecting a model', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const selected = router.selectModel({
      budget: 'expensive',
      speed: 'balanced',
      preferredProvider: 'copilot',
    });

    expect(selected.startsWith('copilot/')).toBe(true);
  });

  it('falls back to local when no candidates match', () => {
    const router = new ModelRouter();

    const selected = router.selectModel(
      { budget: 'balanced', speed: 'balanced' },
      ['does/not-exist'],
    );

    expect(selected).toBe('local/echo-1');
  });

  it('returns model metadata with getModelInfo', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const info = router.getModelInfo('copilot/default');

    expect(info).toBeDefined();
    expect(info?.provider).toBe('copilot');
  });

  it('filters models by required capabilities', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    expect(['openai/gpt-4o-mini', 'google/gemini-2.0-flash']).toContain(selected);
  });

  it('uses task profile vision requirements as a hard gate', () => {
    const router = new ModelRouter();
    const taskProfiler = new TaskProfiler();
    registerProviders(router);

    const taskProfile = taskProfiler.profileTask({
      userMessage: 'Review this screenshot and explain the UI issue',
      phase: 'execution',
      requiresTools: false,
    });

    const selected = router.selectModel(
      { budget: 'balanced', speed: 'balanced' },
      undefined,
      taskProfile,
    );

    expect(selected).toBe('google/gemini-2.0-flash');
  });

  it('treats cheap mode as a budget gate before scoring', () => {
    const router = new ModelRouter();
    const taskProfiler = new TaskProfiler();
    registerProviders(router);

    const taskProfile = taskProfiler.profileTask({
      userMessage: 'Plan a complex architecture migration',
      phase: 'planning',
      requiresTools: false,
    });

    const selected = router.selectModel(
      { budget: 'cheap', speed: 'balanced' },
      undefined,
      taskProfile,
    );

    expect(selected).not.toBe('anthropic/claude-3-7-sonnet-latest');
    expect(selected).not.toBe('openai/gpt-4o');
    expect(['openai/gpt-4o-mini', 'google/gemini-2.0-flash']).toContain(selected);
  });

  it('treats fast mode as a speed gate before scoring', () => {
    const router = new ModelRouter();
    const taskProfiler = new TaskProfiler();
    registerProviders(router);

    const taskProfile = taskProfiler.profileTask({
      userMessage: 'Explain this code path quickly',
      phase: 'execution',
      requiresTools: false,
    });

    const selected = router.selectModel(
      { budget: 'expensive', speed: 'fast' },
      undefined,
      taskProfile,
    );

    expect(selected).toBe('openai/gpt-4o-mini');
  });

  it('excludes unhealthy providers from selection', () => {
    const router = new ModelRouter();
    registerProviders(router);
    router.setProviderHealth('openai', false);
    router.setProviderHealth('google', false);

    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    expect(selected).toBe('local/echo-1');
  });
});

function registerProviders(router: ModelRouter): void {
  const providers: ProviderConfig[] = [
    {
      id: 'copilot',
      displayName: 'GitHub Copilot',
      apiKeySettingKey: 'atlasmind.provider.copilot.apiKey',
      enabled: true,
      models: [
        {
          id: 'copilot/default',
          provider: 'copilot',
          name: 'Copilot Default',
          contextWindow: 64000,
          inputPricePer1k: 0.002,
          outputPricePer1k: 0.008,
          capabilities: ['chat', 'code', 'reasoning'],
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
      ],
    },
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      models: [
        {
          id: 'anthropic/claude-3-7-sonnet-latest',
          provider: 'anthropic',
          name: 'Claude 3.7 Sonnet',
          contextWindow: 200000,
          inputPricePer1k: 0.003,
          outputPricePer1k: 0.015,
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

  for (const provider of providers) {
    router.registerProvider(provider);
  }
}

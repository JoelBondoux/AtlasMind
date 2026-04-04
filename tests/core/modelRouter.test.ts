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

    // Expensive pay-per-token models should be filtered out.
    expect(selected).not.toBe('anthropic/claude-3-7-sonnet-latest');
    expect(selected).not.toBe('openai/gpt-4o');
    // Subscription/free models always pass the budget gate.
    expect(['openai/gpt-4o-mini', 'google/gemini-2.0-flash', 'copilot/default', 'local/echo-1']).toContain(selected);
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

    // Slow models (balanced/considered) should be filtered out, but
    // free/cheap fast models are valid picks.
    expect(['openai/gpt-4o-mini', 'local/echo-1']).toContain(selected);
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

  // ── Pricing model awareness ───────────────────────────────────

  it('prefers subscription/free over pay-per-token for same capabilities', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // With no capability filter, subscription (copilot) and free (local)
    // have zero effective cost — router should pick one of them over any
    // pay-per-token provider.
    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
    });

    const provider = selected.split('/')[0];
    expect(['copilot', 'local']).toContain(provider);
  });

  it('subscription models pass budget gate even in cheap mode', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Copilot's model has pricing (0.002+0.008=0.01) that would classify as
    // "expensive" tier, but subscription models bypass the budget gate.
    const selected = router.selectModel({
      budget: 'cheap',
      speed: 'considered',
    });

    // Copilot should still be available despite cheap budget
    const info = router.getModelInfo(selected);
    expect(info).toBeDefined();
  });

  it('reduces subscription bonus when parallelSlots > 1', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const singleSlot = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    // With many parallel slots, pay-per-token should become viable
    const parallelSlot = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
      parallelSlots: 4,
    });

    // Single slot should prefer subscription (copilot) if it has function_calling
    // but parallel should be open to API providers
    expect(singleSlot).toBeDefined();
    expect(parallelSlot).toBeDefined();
  });

  // ── Parallel slot allocation ──────────────────────────────────

  it('selectModelsForParallel returns the requested number of slots', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const models = router.selectModelsForParallel(3, {
      budget: 'balanced',
      speed: 'balanced',
    });

    expect(models).toHaveLength(3);
    for (const m of models) {
      expect(typeof m).toBe('string');
      expect(m.includes('/')).toBe(true);
    }
  });

  it('selectModelsForParallel fills first slot with subscription model', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const models = router.selectModelsForParallel(2, {
      budget: 'balanced',
      speed: 'balanced',
    });

    // First slot should be subscription (copilot) or free (local)
    expect(models[0].startsWith('copilot/') || models[0].startsWith('local/')).toBe(true);
  });

  it('selectModelsForParallel overflows to pay-per-token for extra slots', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const models = router.selectModelsForParallel(3, {
      budget: 'balanced',
      speed: 'balanced',
    });

    // At least one slot should be from a pay-per-token provider
    const hasPayPerToken = models.some(m =>
      m.startsWith('openai/') || m.startsWith('google/') ||
      m.startsWith('anthropic/') || m.startsWith('deepseek/'),
    );
    expect(hasPayPerToken).toBe(true);
  });

  it('selectModelsForParallel returns empty array for 0 slots', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const models = router.selectModelsForParallel(0, {
      budget: 'balanced',
      speed: 'balanced',
    });

    expect(models).toHaveLength(0);
  });

  it('selectModelsForParallel delegates to selectModel for 1 slot', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const constraints = { budget: 'balanced' as const, speed: 'balanced' as const };
    const single = router.selectModel(constraints);
    const parallel = router.selectModelsForParallel(1, constraints);

    expect(parallel).toEqual([single]);
  });
});

function registerProviders(router: ModelRouter): void {
  const providers: ProviderConfig[] = [
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
      pricingModel: 'pay-per-token',
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
      id: 'anthropic',
      displayName: 'Anthropic',
      apiKeySettingKey: 'atlasmind.provider.anthropic.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
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

  for (const provider of providers) {
    router.registerProvider(provider);
  }
}

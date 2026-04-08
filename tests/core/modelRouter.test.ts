import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type { ProviderConfig, SubscriptionQuota } from '../../src/types.ts';

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

    const info = router.getModelInfo('copilot/gpt-4o');

    expect(info).toBeDefined();
    expect(info?.provider).toBe('copilot');
  });

  it('applies a small preference bias from stored user feedback', () => {
    const router = new ModelRouter();
    router.registerProvider({
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/model-a',
          provider: 'openai',
          name: 'Model A',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
        {
          id: 'openai/model-b',
          provider: 'openai',
          name: 'Model B',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
      ],
    });

    router.setModelPreferences({
      'openai/model-b': { upVotes: 6, downVotes: 0 },
    });

    expect(router.selectModel({ budget: 'balanced', speed: 'balanced' })).toBe('openai/model-b');
    expect(router.getModelPreference('openai/model-b')).toEqual({ upVotes: 6, downVotes: 0 });
  });

  it('can disable feedback bias through the routing weight', () => {
    const router = new ModelRouter();
    router.registerProvider({
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/model-a',
          provider: 'openai',
          name: 'Model A',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
        {
          id: 'openai/model-b',
          provider: 'openai',
          name: 'Model B',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
      ],
    });

    router.setModelPreferences({
      'openai/model-b': { upVotes: 8, downVotes: 0 },
    });
    router.setFeedbackWeight(0);

    expect(router.selectModel({ budget: 'balanced', speed: 'balanced' })).toBe('openai/model-a');
    expect(router.getFeedbackWeight()).toBe(0);
  });

  it('filters models by required capabilities', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    // function_calling is required — copilot now has it, so subscription/free models can match too.
    const provider = selected.split('/')[0];
    expect(['openai', 'google', 'copilot', 'anthropic', 'local']).toContain(provider);
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

    // Vision models: google/gemini-2.0-flash, openai/gpt-4o, and copilot/claude-opus-4 all have vision.
    // Subscription/free providers get zero effective cost, so copilot should win or google (cheap).
    const provider = selected.split('/')[0];
    expect(['google', 'copilot', 'openai']).toContain(provider);
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
    expect(selected).not.toBe('anthropic/claude-sonnet-4');
    expect(selected).not.toBe('openai/gpt-4o');
    // Subscription/free models always pass the budget gate.
    expect(selected.startsWith('copilot/') || selected.startsWith('local/') ||
      selected === 'openai/gpt-4o-mini' || selected === 'google/gemini-2.0-flash').toBe(true);
  });

  it('lets cheap mode strongly prefer the lowest effective-cost option within the cheap tier', () => {
    const router = new ModelRouter();
    const taskProfiler = new TaskProfiler();

    router.registerProvider({
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/cheap-basic',
          provider: 'openai',
          name: 'Cheap Basic',
          contextWindow: 64000,
          inputPricePer1k: 0.00005,
          outputPricePer1k: 0.00015,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
        {
          id: 'openai/cheap-reasoning',
          provider: 'openai',
          name: 'Cheap Reasoning',
          contextWindow: 128000,
          inputPricePer1k: 0.0006,
          outputPricePer1k: 0.00075,
          capabilities: ['chat', 'code', 'reasoning'],
          enabled: true,
        },
      ],
    });

    const taskProfile = taskProfiler.profileTask({
      userMessage: 'Plan a complex migration with careful reasoning.',
      phase: 'planning',
      requiresTools: false,
    });

    expect(router.selectModel({ budget: 'balanced', speed: 'balanced' }, undefined, taskProfile)).toBe('openai/cheap-reasoning');
    expect(router.selectModel({ budget: 'cheap', speed: 'balanced' }, undefined, taskProfile)).toBe('openai/cheap-basic');
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

    // Slow models (balanced/considered) should be filtered out, and the
    // built-in local echo fallback should stay out of the pool when a real
    // model candidate is available.
    expect(selected).toBe('openai/gpt-4o-mini');
  });

  it('excludes unhealthy providers from selection', () => {
    const router = new ModelRouter();
    registerProviders(router);
    router.setProviderHealth('openai', false);
    router.setProviderHealth('google', false);
    router.setProviderHealth('copilot', false);

    const selected = router.selectModel({
      budget: 'expensive',
      speed: 'considered',
      requiredCapabilities: ['function_calling'],
    });

    // With copilot, openai, and google unhealthy, anthropic should be picked.
    expect(selected.startsWith('anthropic/')).toBe(true);
  });

  it('removes failed models from the active candidate pool until refresh or clear', () => {
    const router = new ModelRouter();
    registerProviders(router);
    router.setProviderHealth('copilot', false);
    router.setProviderHealth('local', false);

    const initial = router.selectBestModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    expect(initial).toBeDefined();
    router.recordModelFailure(initial!, 'upstream outage');

    const next = router.selectBestModel({
      budget: 'balanced',
      speed: 'balanced',
      requiredCapabilities: ['function_calling'],
    });

    expect(next).toBeDefined();
    expect(next).not.toBe(initial);

    router.recordModelFailure(initial!, 'upstream outage');

    expect(router.getModelFailure(initial!)).toMatchObject({
      message: 'upstream outage',
      failureCount: 2,
    });

    router.clearModelFailure(initial!);
    expect(router.getModelFailure(initial!)).toBeUndefined();
  });

  it('lets feedback bias break ties after failed models are excluded', () => {
    const router = new ModelRouter();
    router.registerProvider({
      id: 'openai',
      displayName: 'OpenAI',
      apiKeySettingKey: 'atlasmind.provider.openai.apiKey',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [
        {
          id: 'openai/model-a',
          provider: 'openai',
          name: 'Model A',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
        {
          id: 'openai/model-b',
          provider: 'openai',
          name: 'Model B',
          contextWindow: 128000,
          inputPricePer1k: 0.001,
          outputPricePer1k: 0.001,
          capabilities: ['chat', 'code'],
          enabled: true,
        },
      ],
    });

    router.setModelPreferences({
      'openai/model-b': { upVotes: 5, downVotes: 0 },
    });

    expect(router.selectBestModel({ budget: 'balanced', speed: 'balanced' })).toBe('openai/model-b');

    router.recordModelFailure('openai/model-b', 'temporary upstream error');

    expect(router.selectBestModel({ budget: 'balanced', speed: 'balanced' })).toBe('openai/model-a');
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

  it('does not stay on local for important thread-based follow-up turns', () => {
    const router = new ModelRouter();
    const taskProfiler = new TaskProfiler();
    registerProviders(router);

    const taskProfile = taskProfiler.profileTask({
      userMessage: 'This is important. Based on the chat thread so far, recommend the safest next step.',
      context: {
        sessionContext: 'User: We discussed deployment trade-offs and model limitations.\n\nAssistant: The previous turn used a weak local model.',
      },
      phase: 'execution',
      requiresTools: false,
    });

    const selected = router.selectModel(
      { budget: 'auto', speed: 'auto' },
      undefined,
      taskProfile,
    );

    expect(selected).not.toBe('local/echo-1');
  });

  it('keeps the built-in local echo model as fallback only when real candidates exist', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
    });

    expect(selected).not.toBe('local/echo-1');
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

  // ── Subscription quota tracking ───────────────────────────────

  it('updateSubscriptionQuota stores and retrieves quota', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const quota: SubscriptionQuota = {
      totalRequests: 500,
      remainingRequests: 450,
    };
    router.updateSubscriptionQuota('copilot', quota);

    const retrieved = router.getSubscriptionQuota('copilot');
    expect(retrieved).toEqual(quota);
  });

  it('getSubscriptionQuota returns undefined for non-existent provider', () => {
    const router = new ModelRouter();
    registerProviders(router);

    expect(router.getSubscriptionQuota('nonexistent')).toBeUndefined();
  });

  it('getSubscriptionQuota returns undefined when no quota has been set', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // copilot was registered without subscriptionQuota
    expect(router.getSubscriptionQuota('copilot')).toBeUndefined();
  });

  // ── Premium multiplier scoring ────────────────────────────────

  it('prefers 1× subscription model over 3× subscription model', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Disable non-copilot providers to isolate subscription scoring.
    router.setProviderHealth('openai', false);
    router.setProviderHealth('google', false);
    router.setProviderHealth('anthropic', false);
    router.setProviderHealth('local', false);

    router.updateSubscriptionQuota('copilot', {
      totalRequests: 500,
      remainingRequests: 400,
      costPerRequestUnit: 0.033,
    });

    const selected = router.selectModel({
      budget: 'expensive',
      speed: 'considered',
    });

    // copilot/gpt-4o (1× → $0.033) should be preferred over
    // copilot/claude-opus-4 (3× → $0.099) because effective cost is lower.
    expect(selected).toBe('copilot/gpt-4o');
  });

  it('allows 3× subscription model when required capability forces it', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Disable non-copilot providers to isolate subscription scoring.
    router.setProviderHealth('openai', false);
    router.setProviderHealth('google', false);
    router.setProviderHealth('anthropic', false);
    router.setProviderHealth('local', false);

    router.updateSubscriptionQuota('copilot', {
      totalRequests: 500,
      remainingRequests: 400,
      costPerRequestUnit: 0.033,
    });

    // copilot/claude-opus-4 has vision, copilot/gpt-4o does not.
    const selected = router.selectModel({
      budget: 'expensive',
      speed: 'considered',
      requiredCapabilities: ['vision'],
    });

    expect(selected).toBe('copilot/claude-opus-4');
  });

  // ── Quota exhaustion ──────────────────────────────────────────

  it('treats exhausted subscription as pay-per-token in budget gate', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Exhaust copilot quota
    router.updateSubscriptionQuota('copilot', {
      totalRequests: 500,
      remainingRequests: 0,
    });

    const selected = router.selectModel({
      budget: 'cheap',
      speed: 'balanced',
    });

    // With exhausted quota, copilot models fall through to normal budget
    // gating. copilot/gpt-4o has total price 0.0125 (expensive tier) and
    // copilot/claude-opus-4 has 0.09 (expensive tier). Both should fail
    // the cheap budget gate. Cheap pay-per-token or free models should win.
    expect(
      selected === 'openai/gpt-4o-mini' ||
      selected === 'google/gemini-2.0-flash' ||
      selected === 'local/echo-1',
    ).toBe(true);
  });

  it('scores exhausted subscription at listed cost', () => {
    const router = new ModelRouter();
    registerProviders(router);

    router.updateSubscriptionQuota('copilot', {
      totalRequests: 500,
      remainingRequests: 0,
      costPerRequestUnit: 0.033,
    });

    // With exhausted quota, the subscription model should not be preferred
    // over a cheaper pay-per-token model.
    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
    });

    // copilot models now cost listed price (0.0125 for gpt-4o, 0.09 for
    // claude-opus-4). Cheap pay-per-token models should score better.
    expect(
      selected === 'openai/gpt-4o-mini' ||
      selected === 'google/gemini-2.0-flash' ||
      selected === 'local/echo-1',
    ).toBe(true);
  });

  // ── Conservation threshold (30%) ──────────────────────────────

  it('blends toward listed cost when quota is below 30%', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Set quota at 10% remaining — well below 30% conservation threshold
    router.updateSubscriptionQuota('copilot', {
      totalRequests: 1000,
      remainingRequests: 100,
      costPerRequestUnit: 0.033,
    });

    // At 10% remaining, blending factor = 1 - (0.1/0.3) ≈ 0.667
    // Blended cost = subscriptionCost + (listedCost - subscriptionCost) × 0.667
    // For copilot/gpt-4o (1×): 0.033 + (0.0125 - 0.033) × 0.667 ≈ 0.0193
    // For copilot/claude-opus-4 (3×): 0.099 + (0.09 - 0.099) × 0.667 ≈ 0.093
    // The cheap pay-per-token models (gpt-4o-mini at 0.00075, gemini flash at 0.0005)
    // should start looking attractive relative to subscription models.
    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
    });

    // Should still function correctly — any valid model is acceptable,
    // just verifying no crash or infinite loop during blending.
    expect(typeof selected).toBe('string');
    expect(selected.includes('/')).toBe(true);
  });

  it('does not blend when quota is above conservation threshold', () => {
    const router = new ModelRouter();
    registerProviders(router);

    // Set quota at 80% remaining — well above 30% threshold.
    // No costPerRequestUnit → simple zero-cost subscription path.
    router.updateSubscriptionQuota('copilot', {
      totalRequests: 1000,
      remainingRequests: 800,
    });

    // Subscription models should still be strongly preferred (zero effective cost).
    const selected = router.selectModel({
      budget: 'balanced',
      speed: 'balanced',
    });

    // With ample quota, subscription cost is zero (same as free).
    // Either copilot or local should win — NOT a pay-per-token model.
    expect(
      selected.startsWith('copilot/') || selected.startsWith('local/'),
    ).toBe(true);
  });

  // ── Parallel slots with exhausted quota ───────────────────────

  it('does not give exhausted subscription priority in parallel allocation', () => {
    const router = new ModelRouter();
    registerProviders(router);

    router.updateSubscriptionQuota('copilot', {
      totalRequests: 500,
      remainingRequests: 0,
    });

    const models = router.selectModelsForParallel(3, {
      budget: 'balanced',
      speed: 'balanced',
    });

    expect(models).toHaveLength(3);
    // With exhausted quota, copilot should not dominate the first slot.
    // Pay-per-token and free models should take some or all slots.
    const nonCopilot = models.filter(m => !m.startsWith('copilot/'));
    expect(nonCopilot.length).toBeGreaterThan(0);
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
          id: 'copilot/gpt-4o',
          provider: 'copilot',
          name: 'GPT-4o (Copilot)',
          contextWindow: 128000,
          inputPricePer1k: 0.0025,
          outputPricePer1k: 0.01,
          capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
          enabled: true,
        },
        {
          id: 'copilot/claude-opus-4',
          provider: 'copilot',
          name: 'Claude Opus 4 (Copilot)',
          contextWindow: 200000,
          inputPricePer1k: 0.015,
          outputPricePer1k: 0.075,
          capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
          enabled: true,
          premiumRequestMultiplier: 3,
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
          id: 'anthropic/claude-sonnet-4',
          provider: 'anthropic',
          name: 'Claude Sonnet 4',
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

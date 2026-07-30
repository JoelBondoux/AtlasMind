import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';

/**
 * What happens to a workspace that was using the Claude Code CLI provider when
 * it upgrades past v0.219.0, where that provider was removed.
 *
 * Nothing here is hypothetical. `atlasmind.planningModelId` and
 * `atlasmind.synthesisModelId` are free-text model ids whose documentation used
 * to offer `claude-cli/opus` as the worked example, and a subscription quota
 * keyed on the provider survives in `globalState` across the upgrade. Both have
 * to become inert rather than throwing: an unknown pin routes normally, which is
 * what those settings already promise ("falls back to normal routing if the
 * model is unknown"), and a quota for a provider that no longer exists is simply
 * never consulted.
 */
describe('a workspace still pinned to the removed provider', () => {
  const router = () => {
    const instance = new ModelRouter();
    instance.registerProvider({
      id: 'openai',
      displayName: 'OpenAI',
      enabled: true,
      pricingModel: 'pay-per-token',
      models: [{
        id: 'openai/gpt', provider: 'openai', name: 'GPT', contextWindow: 200000,
        inputPricePer1k: 0.005, outputPricePer1k: 0.015,
        capabilities: ['chat', 'code', 'reasoning', 'function_calling'], enabled: true,
      }],
    });
    return instance;
  };

  it('treats the pinned id as unknown rather than as a model', () => {
    expect(router().getModelInfo('claude-cli/opus')).toBeUndefined();
  });

  it('never routes to it, and still returns a usable model', () => {
    // Deliberately not asserting *which* model wins — that is router tuning, not
    // degradation. What matters is that a stale pin among the candidates cannot
    // be chosen, and that routing still resolves rather than failing.
    for (const allowed of [['claude-cli/opus'], ['claude-cli/opus', 'openai/gpt'], undefined]) {
      const selected = router().selectModel({ budget: 'balanced', speed: 'balanced' }, allowed);
      expect(selected, JSON.stringify(allowed)).not.toContain('claude-cli');
      expect(selected.length, JSON.stringify(allowed)).toBeGreaterThan(0);
    }
  });

  it('resolves no quota for it, and spending against it does not throw', () => {
    // A quota persisted under the old provider id survives the upgrade in
    // globalState. It has to be inert, not a crash on the first turn.
    const instance = router();
    expect(instance.subscriptionQuotaForModel('claude-cli/opus')).toBeUndefined();
    expect(() => instance.consumeSubscriptionUnits('claude-cli/opus', 1)).not.toThrow();
    expect(instance.consumeSubscriptionUnits('claude-cli/opus', 1)).toBeUndefined();
  });

  it('does not resurrect it through the provider list', () => {
    expect(router().listProviders().map(provider => provider.id)).not.toContain('claude-cli');
  });
});

import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import type { ProviderConfig } from '../../src/types.ts';

describe('ModelRouter', () => {
  it('respects preferred provider when selecting a model', () => {
    const router = new ModelRouter();
    registerProviders(router);

    const selected = router.selectModel({
      budget: 'balanced',
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

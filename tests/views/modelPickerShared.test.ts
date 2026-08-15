import { describe, expect, it } from 'vitest';

import { collectPickableModels, resolveModelOverride } from '../../src/views/modelPickerShared.ts';

const ROUTER = {
  listProviders: () => [
    { id: 'openai', displayName: 'OpenAI', models: [{ id: 'openai/gpt-5', name: 'GPT-5' }] },
    { id: 'anthropic', displayName: 'Anthropic', models: [{ id: 'anthropic/opus-5', name: 'Opus 5' }, { id: 'anthropic/haiku-5' }] },
    { id: 'mistral', displayName: 'Mistral', models: [{ id: 'mistral/large', name: 'Large' }] },
  ],
};

describe('pickable models', () => {
  it('offers only models from providers the operator has configured', async () => {
    const models = await collectPickableModels(ROUTER, async id => id !== 'mistral');

    expect(models.map(model => model.id)).toEqual([
      'anthropic/haiku-5', 'anthropic/opus-5', 'openai/gpt-5',
    ]);
  });

  it('falls back to the id when a model has no name', async () => {
    // A nameless model is still one the operator paid for; dropping it would
    // make the picker disagree with the Models tree for an invisible reason.
    const models = await collectPickableModels(ROUTER, async () => true);
    expect(models.find(model => model.id === 'anthropic/haiku-5')?.label).toBe('anthropic/haiku-5');
  });

  it('treats a provider whose credential check throws as unconfigured', async () => {
    // One broken provider must not empty the picker.
    const models = await collectPickableModels(ROUTER, async id => {
      if (id === 'openai') { throw new Error('keychain locked'); }
      return true;
    });

    expect(models.some(model => model.provider === 'OpenAI')).toBe(false);
    expect(models.length).toBeGreaterThan(0);
  });

  it('sorts stably so the list cannot shuffle between renders', async () => {
    const first = await collectPickableModels(ROUTER, async () => true);
    const second = await collectPickableModels(ROUTER, async () => true);
    expect(first.map(m => m.id)).toEqual(second.map(m => m.id));
  });
});

describe('resolving a requested pin', () => {
  const available = [{ id: 'openai/gpt-5', label: 'GPT-5', provider: 'OpenAI' }];

  it('accepts a model the host itself listed', () => {
    expect(resolveModelOverride({ modelId: 'openai/gpt-5', scope: 'turn' }, available))
      .toEqual({ modelId: 'openai/gpt-5', scope: 'turn' });
  });

  it('refuses anything it did not offer', () => {
    // The webview supplies data; "which models exist" is the host's question.
    expect(resolveModelOverride({ modelId: 'evil/backdoor', scope: 'session' }, available))
      .toBe('unknown-model');
  });

  it('reads a null id as clearing the pin', () => {
    expect(resolveModelOverride({ modelId: null, scope: 'turn' }, available)).toBeUndefined();
  });
});

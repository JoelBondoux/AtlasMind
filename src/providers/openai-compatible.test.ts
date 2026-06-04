import { describe, it, expect, vi } from 'vitest';
import { OpenAiCompatibleAdapter } from './openai-compatible.js';
import type { SecretStore } from '../runtime/secrets.js';

const mockSecrets: SecretStore = {
  get: vi.fn().mockResolvedValue('test-api-key'),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

describe('OpenAiCompatibleAdapter', () => {
  it('should list models from the API', async () => {
    const mockResponse = {
      data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }],
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockResponse),
    });

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        secretKey: 'test-secret',
        displayName: 'OpenAI Test',
      },
      mockSecrets,
    );

    const models = await adapter.listModels();

    expect(models).toEqual(['openai/gpt-4', 'openai/gpt-3.5-turbo']);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.any(Object),
    );
  });
});

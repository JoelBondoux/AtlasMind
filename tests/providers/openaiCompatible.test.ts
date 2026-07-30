import { describe, it, expect, vi } from 'vitest';
import { OpenAiCompatibleAdapter } from '../../src/providers/openai-compatible.ts';
import type { SecretStore } from '../../src/runtime/secrets.ts';

/**
 * This file previously lived at `src/providers/openai-compatible.test.ts`,
 * outside `vitest.config.ts`'s `tests/` glob, so it had never run. Both of its
 * assertions were stale: the first expected `listModels()` to return `[]` when
 * the API answers, and the second expected `[]` on a non-ok reply from a mock
 * with no `text()`. The adapter is right in both cases — it namespaces ids by
 * provider, and it deliberately *throws* rather than returning an empty list
 * when discovery fails with no fallback models, so a caller cannot mistake a
 * dead credential for a provider that offers nothing
 * (src/providers/openai-compatible.ts:322-328). The assertions are corrected to
 * the behaviour it actually has, rather than the behaviour a test nobody ran
 * claimed it had.
 */
const buildSecrets = (): SecretStore => ({
  get: vi.fn().mockResolvedValue('test-api-key'),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
});

describe('OpenAiCompatibleAdapter', () => {
  it('lists models from the API, namespaced by provider id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }] }),
    });

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        secretKey: 'test-secret',
        displayName: 'OpenAI Test',
      },
      buildSecrets(),
    );

    const models = await adapter.listModels();

    // The provider prefix is what keeps two providers offering the same upstream
    // model name from colliding in the router's id space.
    expect(models).toEqual(['openai/gpt-4', 'openai/gpt-3.5-turbo']);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.any(Object),
    );
  });

  it('throws rather than reporting an empty catalogue when discovery fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue(''),
    });

    const adapter = new OpenAiCompatibleAdapter(
      {
        providerId: 'some-other-provider',
        baseUrl: 'https://api.example.com/v1',
        secretKey: 'test-secret',
        displayName: 'Other Provider Test',
      },
      buildSecrets(),
    );

    // An empty list would read as "this provider has no models". A thrown error
    // reads as "we could not find out", which is the true statement.
    await expect(adapter.listModels()).rejects.toThrow(/returned 401/);
  });
});

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

describe('Gemini thought signatures', () => {
  // Gemini 3 rejects a tool round whose earlier function call lost its signature
  // ("Function call is missing a thought_signature"). Its OpenAI-compatible layer
  // carries the signature at extra_content.google.thought_signature, which the
  // adapter used to ignore in favour of a top-level field nobody sends.
  const geminiReply = {
    model: 'gemini-3.1-pro-preview',
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'git_status', arguments: '{}' },
          extra_content: { google: { thought_signature: 'sig-abc' } },
        }],
      },
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  };

  const makeAdapter = (providerId: string) => new OpenAiCompatibleAdapter(
    { providerId, baseUrl: 'https://example.test/v1', secretKey: 's', displayName: providerId },
    buildSecrets(),
  );

  it('reads the signature from extra_content and echoes it back in the same place', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(geminiReply) });
    global.fetch = fetchMock;
    const adapter = makeAdapter('google');

    const first = await adapter.complete({ model: 'google/gemini-3.1-pro-preview', messages: [{ role: 'user', content: 'status?' }] });
    expect(first.toolCalls?.[0]?.thoughtSignature).toBe('sig-abc');

    await adapter.complete({
      model: 'google/gemini-3.1-pro-preview',
      messages: [
        { role: 'user', content: 'status?' },
        { role: 'assistant', content: '', toolCalls: first.toolCalls },
        { role: 'tool', content: 'clean', toolCallId: 'call_1' },
      ],
    });
    const sent = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
    const echoed = sent.messages[1].tool_calls[0];
    expect(echoed.extra_content).toEqual({ google: { thought_signature: 'sig-abc' } });
    expect(echoed.thought_signature).toBeUndefined();
  });

  it('keeps the top-level form for other providers', async () => {
    const reply = structuredClone(geminiReply);
    const call = reply.choices[0]!.message.tool_calls[0]! as Record<string, unknown>;
    delete call['extra_content'];
    call['thought_signature'] = 'sig-top';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(reply) });
    global.fetch = fetchMock;
    const adapter = makeAdapter('openrouter');

    const first = await adapter.complete({ model: 'openrouter/x', messages: [{ role: 'user', content: 'q' }] });
    expect(first.toolCalls?.[0]?.thoughtSignature).toBe('sig-top');
    await adapter.complete({
      model: 'openrouter/x',
      messages: [{ role: 'assistant', content: '', toolCalls: first.toolCalls }, { role: 'tool', content: 'ok', toolCallId: 'call_1' }],
    });
    const echoed = JSON.parse(fetchMock.mock.calls[1]![1].body as string).messages[0].tool_calls[0];
    expect(echoed.thought_signature).toBe('sig-top');
    expect(echoed.extra_content).toBeUndefined();
  });
});

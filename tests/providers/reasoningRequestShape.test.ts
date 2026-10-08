/**
 * What each verified adapter actually puts on the wire for a reasoning
 * directive — and what every other provider puts there (nothing). Snapshots of
 * the request body, captured from `fetch`, so a renamed field fails here rather
 * than as a 400 from a vendor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter, ANTHROPIC_EFFORT_VERIFIED_AT, anthropicReasoningFields } from '../../src/providers/anthropic.ts';
import {
  OPENAI_COMPATIBLE_REASONING_VERIFIED_AT,
  OpenAiCompatibleAdapter,
  extractUsageMetrics,
  openAiCompatibleReasoningEffort,
} from '../../src/providers/openai-compatible.ts';
import type { CompletionRequest } from '../../src/providers/adapter.ts';
import type { ReasoningDirective } from '../../src/types.ts';
import type { SecretStore } from '../../src/runtime/secrets.ts';

const secrets: SecretStore = {
  get: vi.fn().mockResolvedValue('test-key'),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

const ANTHROPIC_DEEP: ReasoningDirective = { control: 'anthropic-effort', level: 'deep', value: 'high', rule: 'anthropic-effort:deep' };
const OPENAI_STANDARD: ReasoningDirective = { control: 'openai-reasoning-effort', level: 'standard', value: 'medium', rule: 'openai-reasoning-effort:standard' };
const GEMINI_MINIMAL: ReasoningDirective = { control: 'gemini-reasoning-effort', level: 'minimal', value: 'low', rule: 'gemini-reasoning-effort:minimal' };

function request(model: string, reasoning?: ReasoningDirective): CompletionRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'hi', origin: 'user-prompt' }],
    maxTokens: 26_976,
    ...(reasoning ? { reasoning } : {}),
  };
}

let captured: Array<Record<string, unknown>> = [];

function stubFetch(body: Record<string, unknown>): void {
  captured = [];
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    captured.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
    return { ok: true, status: 200, json: async () => body, headers: new Map() } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verified-at dates are stated', () => {
  it('records when each vendor shape was read', () => {
    expect(ANTHROPIC_EFFORT_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(OPENAI_COMPATIBLE_REASONING_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Anthropic: output_config.effort', () => {
  const anthropicReply = {
    id: 'msg_1',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
  };

  it('sends effort inside output_config and leaves the thinking field alone', async () => {
    stubFetch(anthropicReply);
    await new AnthropicAdapter(secrets).complete(request('anthropic/claude-opus-5-5', ANTHROPIC_DEEP));
    expect(captured[0]['output_config']).toEqual({ effort: 'high' });
    expect(captured[0]).not.toHaveProperty('thinking');
    expect(captured[0]['max_tokens']).toBe(26_976);
    expect(Object.keys(captured[0]).sort()).toMatchInlineSnapshot(`
      [
        "max_tokens",
        "messages",
        "model",
        "output_config",
        "temperature",
      ]
    `);
  });

  it('sends nothing without a directive', async () => {
    stubFetch(anthropicReply);
    await new AnthropicAdapter(secrets).complete(request('anthropic/claude-opus-5-5'));
    expect(captured[0]).not.toHaveProperty('output_config');
  });

  it('ignores a directive meant for another vendor rather than translating it', () => {
    expect(anthropicReasoningFields(OPENAI_STANDARD)).toEqual({});
    expect(anthropicReasoningFields(GEMINI_MINIMAL)).toEqual({});
    expect(anthropicReasoningFields(undefined)).toEqual({});
    expect(anthropicReasoningFields(ANTHROPIC_DEEP)).toEqual({ output_config: { effort: 'high' } });
  });
});

describe('OpenAI and Gemini: reasoning_effort on Chat Completions', () => {
  const chatReply = {
    model: 'gpt-5.5',
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };

  it('OpenAI sends reasoning_effort beside max_completion_tokens', async () => {
    stubFetch(chatReply);
    const adapter = new OpenAiCompatibleAdapter(
      { providerId: 'openai', compatibilityMode: 'openai-modern-chat', baseUrl: 'https://api.openai.com/v1', secretKey: 'k', displayName: 'OpenAI' },
      secrets,
    );
    await adapter.complete(request('openai/gpt-5.5', OPENAI_STANDARD));
    expect(captured[0]['reasoning_effort']).toBe('medium');
    expect(captured[0]['max_completion_tokens']).toBe(26_976);
    expect(captured[0]).not.toHaveProperty('temperature');
  });

  it('Gemini sends reasoning_effort and never thinking_config', async () => {
    stubFetch({ ...chatReply, model: 'gemini-2.5-flash' });
    const adapter = new OpenAiCompatibleAdapter(
      { providerId: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', secretKey: 'k', displayName: 'Google Gemini' },
      secrets,
    );
    await adapter.complete(request('google/gemini-2.5-flash', GEMINI_MINIMAL));
    expect(captured[0]['reasoning_effort']).toBe('low');
    expect(JSON.stringify(captured[0])).not.toContain('thinking_config');
    expect(JSON.stringify(captured[0])).not.toContain('thinking_budget');
  });

  it('every other provider on the shared adapter is sent nothing, whatever the directive says', async () => {
    for (const providerId of ['deepseek', 'mistral', 'groq', 'local', 'azure', 'xai']) {
      stubFetch(chatReply);
      const adapter = new OpenAiCompatibleAdapter(
        { providerId, baseUrl: 'https://example.invalid/v1', secretKey: 'k', displayName: providerId },
        secrets,
      );
      for (const directive of [ANTHROPIC_DEEP, OPENAI_STANDARD, GEMINI_MINIMAL]) {
        await adapter.complete(request(`${providerId}/m`, directive));
        expect(captured.at(-1)).not.toHaveProperty('reasoning_effort');
      }
    }
  });

  it('matches the directive to the provider exactly', () => {
    expect(openAiCompatibleReasoningEffort(OPENAI_STANDARD, 'openai')).toBe('medium');
    expect(openAiCompatibleReasoningEffort(GEMINI_MINIMAL, 'openai')).toBeUndefined();
    expect(openAiCompatibleReasoningEffort(OPENAI_STANDARD, 'google')).toBeUndefined();
    expect(openAiCompatibleReasoningEffort(GEMINI_MINIMAL, 'google')).toBe('low');
    expect(openAiCompatibleReasoningEffort(undefined, 'openai')).toBeUndefined();
    // An inherited property name is not a provider.
    expect(openAiCompatibleReasoningEffort(OPENAI_STANDARD, 'constructor')).toBeUndefined();
  });
});

describe('billed output includes thinking', () => {
  it('Gemini: counts thinking that completion_tokens leaves out but total_tokens keeps', () => {
    const usage = { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 1_150 } };
    expect(extractUsageMetrics(usage, 'google').outputTokens).toBe(1_050);
  });

  it('never counts less than completion_tokens', () => {
    expect(extractUsageMetrics({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 120 } }, 'google').outputTokens).toBe(50);
  });

  it('leaves other providers on their own completion count', () => {
    expect(extractUsageMetrics({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 1_150 } }, 'openai').outputTokens).toBe(50);
    expect(extractUsageMetrics({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 1_150 } }).outputTokens).toBe(50);
  });
});

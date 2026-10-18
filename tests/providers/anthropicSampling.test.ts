/**
 * Which Claude models may be sent `temperature`, and what goes on the wire.
 *
 * The defect this pins: the Anthropic adapter sent `temperature: 0.2` on every
 * request, and every Claude model from Opus 4.7 on rejects a non-default
 * sampling parameter with a 400 — so a direct-Anthropic turn on Opus 5.5,
 * Sonnet 5 or Fable failed before the model saw it. The table is an allowlist,
 * so an unknown or newly released model gets no sampling parameter rather than
 * a guessed one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  ANTHROPIC_SAMPLING_ACCEPTING_MODELS,
  ANTHROPIC_SAMPLING_SOURCE,
  ANTHROPIC_SAMPLING_VERIFIED_AT,
  AnthropicAdapter,
  anthropicSamplingFields,
  anthropicSamplingRule,
  normalizeAnthropicModelId,
} from '../../src/providers/anthropic.ts';
import { bedrockSamplingFields } from '../../src/providers/bedrock.ts';
import type { CompletionRequest } from '../../src/providers/adapter.ts';
import type { SecretStore } from '../../src/runtime/secrets.ts';

const secrets: SecretStore = {
  get: vi.fn().mockResolvedValue('test-key'),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

/** Named on the Thinking page as rejecting non-default sampling parameters on every request. */
const REJECTING = [
  'claude-fable-5-1',
  'claude-mythos-5-1',
  'claude-fable-5',
  'claude-mythos-5',
  'claude-mythos-preview',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-haiku-5-5',
];

/** Older models, on which the restriction applies only while thinking is on — and AtlasMind never turns it on. */
const ACCEPTING = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-opus-4-5',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-1',
  'claude-opus-4-0',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
];

function request(model: string, temperature?: number): CompletionRequest {
  return {
    model,
    messages: [{ role: 'user', content: 'hi', origin: 'user-prompt' }],
    maxTokens: 1024,
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

let captured: Array<Record<string, unknown>> = [];

function stubFetch(): void {
  captured = [];
  global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    captured.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'm', model: 'x', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
      headers: new Map(),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the rule is sourced and dated', () => {
  it('records when and where it was read', () => {
    expect(ANTHROPIC_SAMPLING_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ANTHROPIC_SAMPLING_SOURCE).toMatch(/^https:\/\/platform\.claude\.com\/docs\//);
  });
});

describe('the accept table', () => {
  it.each(REJECTING)('%s is not in it', model => {
    expect(anthropicSamplingRule(model)).toBeUndefined();
    expect(anthropicSamplingRule(`anthropic/${model}`)).toBeUndefined();
  });

  it.each(ACCEPTING)('%s is in it', model => {
    expect(anthropicSamplingRule(`anthropic/${model}`)).toBeDefined();
  });

  it('does not let a family prefix swallow a newer model', () => {
    // `claude-opus-4` must not match `claude-opus-4-7`, nor `claude-sonnet-4-5`
    // match `claude-sonnet-4-5-5` or a future `claude-sonnet-4-9`.
    expect(anthropicSamplingRule('claude-opus-4')).toBeDefined();
    expect(anthropicSamplingRule('claude-opus-4-7')).toBeUndefined();
    expect(anthropicSamplingRule('claude-opus-4-9')).toBeUndefined();
    expect(anthropicSamplingRule('claude-sonnet-4-5-5')).toBeUndefined();
  });

  it('treats an unknown or future model as not accepting', () => {
    expect(anthropicSamplingRule('claude-opus-6')).toBeUndefined();
    expect(anthropicSamplingRule('claude-haiku-6-1')).toBeUndefined();
    expect(anthropicSamplingRule('')).toBeUndefined();
  });

  it('every row names the family it covers', () => {
    for (const rule of ANTHROPIC_SAMPLING_ACCEPTING_MODELS) {
      expect(rule.family.length).toBeGreaterThan(0);
      expect(rule.pattern.source.startsWith('^')).toBe(true);
      expect(rule.pattern.source.endsWith('$')).toBe(true);
    }
  });

  it('normalizes the spellings AtlasMind meets', () => {
    expect(normalizeAnthropicModelId('anthropic/claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(normalizeAnthropicModelId('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe('claude-sonnet-4-20250514');
    expect(normalizeAnthropicModelId('anthropic.claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(normalizeAnthropicModelId('claude-opus-4-5@20251101')).toBe('claude-opus-4-5');
  });
});

describe('request body, per model class', () => {
  it('an accepting model gets temperature (the caller\'s, or the 0.2 default)', async () => {
    stubFetch();
    const adapter = new AnthropicAdapter(secrets);
    await adapter.complete(request('anthropic/claude-sonnet-4-6'));
    await adapter.complete(request('anthropic/claude-haiku-4-5', 0));
    expect(captured[0]['temperature']).toBe(0.2);
    expect(captured[1]['temperature']).toBe(0);
    expect(Object.keys(captured[0]).sort()).toMatchInlineSnapshot(`
      [
        "max_tokens",
        "messages",
        "model",
        "temperature",
      ]
    `);
  });

  it('a rejecting model gets no sampling parameter, even when the caller asked for one', async () => {
    stubFetch();
    await new AnthropicAdapter(secrets).complete(request('anthropic/claude-opus-5-5', 0));
    expect(Object.keys(captured[0]).sort()).toMatchInlineSnapshot(`
      [
        "max_tokens",
        "messages",
        "model",
      ]
    `);
  });

  it('an unknown model gets no sampling parameter', async () => {
    stubFetch();
    await new AnthropicAdapter(secrets).complete(request('anthropic/claude-opus-6', 0.7));
    expect(captured[0]).not.toHaveProperty('temperature');
  });

  it('the streaming path follows the same table', async () => {
    captured = [];
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      captured.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n'));
          controller.close();
        },
      });
      return { ok: true, status: 200, body } as unknown as Response;
    }) as unknown as typeof fetch;
    const adapter = new AnthropicAdapter(secrets);
    await adapter.streamComplete(request('anthropic/claude-fable-5-1', 0.2), () => {});
    await adapter.streamComplete(request('anthropic/claude-opus-4-6', 0.4), () => {});
    expect(captured[0]).not.toHaveProperty('temperature');
    expect(captured[1]['temperature']).toBe(0.4);
  });

  it('never sends thinking beside temperature — the condition the older models accept it under', async () => {
    stubFetch();
    await new AnthropicAdapter(secrets).complete({
      ...request('anthropic/claude-opus-4-6'),
      reasoning: { control: 'anthropic-effort', level: 'deep', value: 'high', rule: 'anthropic-effort:deep' },
    });
    expect(captured[0]['temperature']).toBe(0.2);
    expect(captured[0]).not.toHaveProperty('thinking');
  });
});

describe('property: no request outside the accept table carries a sampling parameter', () => {
  const modelId = fc.oneof(
    fc.constantFrom(...REJECTING, ...ACCEPTING),
    fc.string(),
    fc.tuple(fc.constantFrom('opus', 'sonnet', 'haiku', 'fable', 'mythos'), fc.nat(9), fc.nat(9))
      .map(([family, major, minor]) => `claude-${family}-${major}-${minor}`),
  );

  it('holds for the fields builder', () => {
    fc.assert(fc.property(modelId, fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }), (model, temperature) => {
      const fields = anthropicSamplingFields(model, temperature);
      expect(fields).not.toHaveProperty('top_p');
      expect(fields).not.toHaveProperty('top_k');
      if (!anthropicSamplingRule(model)) {
        expect(fields).toEqual({});
      }
    }));
  });

  it('holds for the request body the adapter sends', async () => {
    await fc.assert(fc.asyncProperty(modelId, async model => {
      stubFetch();
      await new AnthropicAdapter(secrets).complete(request(`anthropic/${model}`, 0.5));
      const body = captured[0];
      expect(body).not.toHaveProperty('top_p');
      expect(body).not.toHaveProperty('top_k');
      expect('temperature' in body).toBe(anthropicSamplingRule(model) !== undefined);
    }), { numRuns: 60 });
  });
});

describe('Bedrock applies the same table to Claude, and only to Claude', () => {
  it('omits temperature for a Claude model outside the table', () => {
    expect(bedrockSamplingFields('bedrock/anthropic.claude-opus-4-7', 0.2)).toEqual({});
    expect(bedrockSamplingFields('bedrock/us.anthropic.claude-sonnet-5-v1:0', 0.2)).toEqual({});
  });

  it('keeps temperature for a Claude model in the table', () => {
    expect(bedrockSamplingFields('bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0', 0.3)).toEqual({ temperature: 0.3 });
  });

  it('leaves non-Anthropic models alone', () => {
    expect(bedrockSamplingFields('bedrock/meta.llama3-70b-instruct-v1:0', undefined)).toEqual({ temperature: 0.2 });
    expect(bedrockSamplingFields('bedrock/amazon.nova-pro-v1:0', 0.7)).toEqual({ temperature: 0.7 });
  });
});

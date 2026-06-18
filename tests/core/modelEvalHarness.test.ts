import { describe, expect, it, vi } from 'vitest';
import {
  buildModelJudgePrompt,
  compareModelsOnPrompt,
  parseModelJudgeVerdicts,
} from '../../src/core/modelEvalHarness.ts';
import type { CompletionResponse } from '../../src/providers/adapter.ts';

function completion(content: string, finishReason: CompletionResponse['finishReason'] = 'stop'): CompletionResponse {
  return { content, model: 'm', inputTokens: 100, outputTokens: 50, finishReason };
}

describe('compareModelsOnPrompt', () => {
  it('ranks by quality and records each graded outcome', async () => {
    const outcomes: Array<{ id: string; q: number }> = [];
    const results = await compareModelsOnPrompt(
      'prompt',
      ['good', 'truncated', 'empty'],
      async (modelId) => {
        if (modelId === 'good') return completion('A thorough answer.');
        if (modelId === 'truncated') return completion('partial…', 'length');
        return completion('   '); // empty
      },
      { onResult: (id, q) => outcomes.push({ id, q }) },
    );

    expect(results.map(r => r.modelId)).toEqual(['good', 'truncated', 'empty']);
    expect(results[0].quality).toBe(1);
    expect(results[1].quality).toBe(0.6);
    expect(results[2].quality).toBe(0.2);
    // Every model's outcome was reported for routing calibration.
    expect(outcomes.map(o => o.id).sort()).toEqual(['empty', 'good', 'truncated']);
  });

  it('breaks quality ties by cost (cheaper ranks higher)', async () => {
    const results = await compareModelsOnPrompt(
      'prompt',
      ['pricey', 'cheap'],
      async () => completion('Same quality answer.'),
      { estimateCostUsd: (modelId) => (modelId === 'pricey' ? 0.02 : 0.0001) },
    );

    expect(results[0].modelId).toBe('cheap');
    expect(results[0].quality).toBe(results[1].quality);
  });

  it('captures a failed run as quality 0 with an error, and still records it', async () => {
    const outcomes: Array<{ id: string; q: number }> = [];
    const results = await compareModelsOnPrompt(
      'prompt',
      ['ok', 'boom'],
      async (modelId) => {
        if (modelId === 'boom') throw new Error('provider exploded');
        return completion('fine');
      },
      { onResult: (id, q) => outcomes.push({ id, q }) },
    );

    const boom = results.find(r => r.modelId === 'boom');
    expect(boom?.quality).toBe(0);
    expect(boom?.error).toContain('provider exploded');
    expect(outcomes).toContainEqual({ id: 'boom', q: 0 });
    // The failed model ranks last.
    expect(results[results.length - 1].modelId).toBe('boom');
  });

  it('de-duplicates repeated model ids', async () => {
    const run = vi.fn(async () => completion('x'));
    const results = await compareModelsOnPrompt('p', ['a', 'a', 'b'], run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(results.map(r => r.modelId).sort()).toEqual(['a', 'b']);
  });

  it('stops early when the signal is already aborted', async () => {
    const run = vi.fn(async () => completion('x'));
    const controller = new AbortController();
    controller.abort();
    const results = await compareModelsOnPrompt('p', ['a', 'b'], run, { signal: controller.signal });
    expect(run).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });

  it('applies judge scores and ranks by them when a judge is provided', async () => {
    const results = await compareModelsOnPrompt(
      'prompt',
      ['weak', 'strong'],
      async (modelId) => completion(`answer from ${modelId}`),
      {
        judge: async (_prompt, entries) => {
          const map = new Map<string, { score: number; rationale?: string }>();
          for (const entry of entries) {
            map.set(entry.modelId, { score: entry.modelId === 'strong' ? 95 : 40, rationale: 'graded' });
          }
          return map;
        },
      },
    );

    // 'strong' has a worse completion tie but a far higher judge score, so it wins.
    expect(results[0].modelId).toBe('strong');
    expect(results[0].judgeScore).toBe(95);
    expect(results[0].judgeRationale).toBe('graded');
    expect(results[1].judgeScore).toBe(40);
  });

  it('keeps completion-graded results when the judge throws', async () => {
    const results = await compareModelsOnPrompt(
      'prompt',
      ['a', 'b'],
      async () => completion('fine'),
      { judge: async () => { throw new Error('judge offline'); } },
    );

    expect(results).toHaveLength(2);
    expect(results.every(r => r.judgeScore === undefined)).toBe(true);
    expect(results.every(r => r.quality === 1)).toBe(true);
  });
});

describe('buildModelJudgePrompt', () => {
  it('embeds each answer with its id and the task', () => {
    const prompt = buildModelJudgePrompt('Add 2 and 2.', [
      { modelId: 'm1', response: 'four' },
      { modelId: 'm2', response: '4' },
    ]);
    expect(prompt).toContain('Add 2 and 2.');
    expect(prompt).toContain('id: m1');
    expect(prompt).toContain('four');
    expect(prompt).toContain('id: m2');
    expect(prompt).toContain('JSON array');
  });
});

describe('parseModelJudgeVerdicts', () => {
  const entries = [
    { modelId: 'openai/gpt', response: 'a' },
    { modelId: 'anthropic/claude', response: 'b' },
  ];

  it('parses a clean JSON array and clamps scores', () => {
    const text = '[{"id":"openai/gpt","score":120,"reason":"great"},{"id":"anthropic/claude","score":-5,"reason":"poor"}]';
    const verdicts = parseModelJudgeVerdicts(text, entries);
    expect(verdicts.get('openai/gpt')).toEqual({ score: 100, rationale: 'great' });
    expect(verdicts.get('anthropic/claude')).toEqual({ score: 0, rationale: 'poor' });
  });

  it('tolerates surrounding prose and matches ids case-insensitively', () => {
    const text = 'Here are the grades:\n[{"id":"OpenAI/GPT","score":80}]\nThanks!';
    const verdicts = parseModelJudgeVerdicts(text, entries);
    expect(verdicts.get('openai/gpt')?.score).toBe(80);
  });

  it('returns an empty map for unparseable output', () => {
    expect(parseModelJudgeVerdicts('no json here', entries).size).toBe(0);
    expect(parseModelJudgeVerdicts('[not, valid]', entries).size).toBe(0);
  });

  it('drops verdicts for unknown ids and non-numeric scores', () => {
    const text = '[{"id":"ghost","score":50},{"id":"openai/gpt","score":"high"}]';
    expect(parseModelJudgeVerdicts(text, entries).size).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { compareModelsOnPrompt } from '../../src/core/modelEvalHarness.ts';
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
});

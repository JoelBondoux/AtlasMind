import { describe, expect, it } from 'vitest';
import { inferModelMetadata } from '../../src/extension.ts';

// Regression coverage for the metadata merge: discovery-populated models must
// inherit the catalog's authoritative reasoningDepth / latencyClass annotations,
// otherwise genuine deep reasoners collapse to the router's fallback depth and
// are under-ranked for high-reasoning tasks.

describe('inferModelMetadata — routing annotations survive the merge', () => {
  it('carries reasoningDepth and latencyClass for a deep reasoner (DeepSeek R1)', () => {
    const info = inferModelMetadata('deepseek', 'deepseek/deepseek-reasoner');
    expect(info.reasoningDepth).toBe(3);
    expect(info.latencyClass).toBe('slow');
    expect(info.capabilities).toContain('reasoning');
  });

  it('carries reasoningDepth 3 for NVIDIA Nemotron Ultra', () => {
    const info = inferModelMetadata('nvidia', 'nvidia/nvidia/llama-3.1-nemotron-ultra-253b-v1');
    expect(info.name).toBe('Llama 3.1 Nemotron Ultra 253B');
    expect(info.reasoningDepth).toBe(3);
  });

  it('carries a fast latency class for Nemotron Nano', () => {
    const info = inferModelMetadata('nvidia', 'nvidia/nvidia/llama-3.1-nemotron-nano-8b-v1');
    expect(info.latencyClass).toBe('fast');
    expect(info.reasoningDepth).toBe(2);
  });

  it('does not invent a reasoningDepth for a model the catalog does not annotate', () => {
    // A discovered model with no catalog match must not carry a fabricated depth.
    const info = inferModelMetadata('openai', 'openai/some-unlisted-model-xyz');
    expect(info.reasoningDepth).toBeUndefined();
    expect(info.latencyClass).toBeUndefined();
  });
});

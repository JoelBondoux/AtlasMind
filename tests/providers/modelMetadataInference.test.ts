import { describe, it, expect } from 'vitest';
import {
  inferContextWindow,
  inferCapabilities,
  inferSpecialistDomains,
  inferPricing,
} from '../../src/providers/modelMetadataInference.js';

// Characterization tests: these pin the existing heuristic behavior exactly as it
// lived inline in src/extension.ts before extraction. They must stay green to
// prove the move is behavior-preserving.

describe('inferContextWindow', () => {
  it('returns 1,000,000 for Gemini models', () => {
    expect(inferContextWindow('gemini-2.0-flash')).toBe(1_000_000);
  });
  it('returns 200,000 for Claude models', () => {
    expect(inferContextWindow('claude-3-5-sonnet')).toBe(200_000);
  });
  it('returns 1,000,000 for gpt-4.1 variants', () => {
    expect(inferContextWindow('gpt-4.1-mini')).toBe(1_000_000);
    expect(inferContextWindow('gpt4.1')).toBe(1_000_000);
  });
  it('falls back to 128,000 for unknown models', () => {
    expect(inferContextWindow('some-unknown-model')).toBe(128_000);
  });
});

describe('inferCapabilities', () => {
  it('always includes chat and code', () => {
    expect(inferCapabilities('mystery')).toEqual(expect.arrayContaining(['chat', 'code']));
  });
  it('grants function_calling to cloud models by default', () => {
    expect(inferCapabilities('gpt-4o')).toContain('function_calling');
  });
  it('withholds function_calling from small local models', () => {
    expect(inferCapabilities('tinyllama-1b', true)).not.toContain('function_calling');
  });
  it('grants function_calling to known tool-capable local families', () => {
    expect(inferCapabilities('qwen2.5-coder', true)).toContain('function_calling');
    expect(inferCapabilities('mistral-7b', true)).toContain('function_calling');
  });
  it('detects vision', () => {
    expect(inferCapabilities('llama-vision')).toContain('vision');
    expect(inferCapabilities('qwen-vl')).toContain('vision');
  });
  it('detects reasoning models', () => {
    expect(inferCapabilities('deepseek-r1')).toContain('reasoning');
    expect(inferCapabilities('o3')).toContain('reasoning');
    expect(inferCapabilities('thinking-model')).toContain('reasoning');
  });
});

describe('inferSpecialistDomains', () => {
  it('adds visual-analysis when vision capability is present', () => {
    expect(inferSpecialistDomains('any', ['vision'])).toContain('visual-analysis');
  });
  it('detects research models', () => {
    expect(inferSpecialistDomains('sonar-pro', [])).toContain('research');
  });
  it('detects voice models', () => {
    expect(inferSpecialistDomains('whisper-speech', [])).toContain('voice');
  });
  it('detects media-generation models', () => {
    expect(inferSpecialistDomains('stable-diffusion-xl', [])).toContain('media-generation');
    expect(inferSpecialistDomains('dall-e-3', [])).toContain('media-generation');
  });
  it('detects robotics models', () => {
    expect(inferSpecialistDomains('ros2-control', [])).toContain('robotics');
  });
  it('detects simulation models', () => {
    expect(inferSpecialistDomains('monte-carlo-sim', [])).toContain('simulation');
  });
  it('returns empty array for a plain model with no signals', () => {
    expect(inferSpecialistDomains('plain-model', [])).toEqual([]);
  });
});

describe('inferPricing', () => {
  it('prices cheap-tier models lowest', () => {
    expect(inferPricing('gpt-4o-mini')).toEqual({ input: 0.0001, output: 0.0004 });
    expect(inferPricing('gemini-flash')).toEqual({ input: 0.0001, output: 0.0004 });
  });
  it('prices premium and reasoning models highest', () => {
    expect(inferPricing('gemini-pro')).toEqual({ input: 0.002, output: 0.008 });
    expect(inferPricing('deepseek-r1')).toEqual({ input: 0.002, output: 0.008 });
  });
  it('uses mid-tier pricing for everything else', () => {
    expect(inferPricing('plain-model')).toEqual({ input: 0.0006, output: 0.0024 });
  });
});

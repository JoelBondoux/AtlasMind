import { describe, it, expect } from 'vitest';
import { getModelInfoUrl, getProviderInfoUrl, lookupCatalog } from '../../src/providers/modelCatalog.js';

describe('lookupCatalog', () => {
  // ── Anthropic ────────────────────────────────────────────────

  it('matches Claude Sonnet 4 by full versioned ID', () => {
    const entry = lookupCatalog('anthropic', 'anthropic/claude-sonnet-4-20250514');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude Sonnet 4');
    expect(entry!.contextWindow).toBe(200_000);
    expect(entry!.capabilities).toContain('reasoning');
    expect(entry!.capabilities).toContain('vision');
  });

  it('matches Claude 3.5 Haiku', () => {
    const entry = lookupCatalog('anthropic', 'claude-3-5-haiku-latest');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude 3.5 Haiku');
    expect(entry!.capabilities).not.toContain('reasoning');
  });

  it('matches Claude Opus 4', () => {
    const entry = lookupCatalog('anthropic', 'claude-opus-4-20250514');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude Opus 4');
    expect(entry!.inputPricePer1k).toBeGreaterThan(0.01);
  });

  it('matches Claude CLI Beta aliases through the Anthropic catalog mirror', () => {
    const entry = lookupCatalog('claude-cli', 'claude-cli/sonnet');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude Sonnet');
    expect(entry!.capabilities).toContain('reasoning');
  });

  // ── OpenAI ───────────────────────────────────────────────────

  it('matches GPT-4o', () => {
    const entry = lookupCatalog('openai', 'gpt-4o');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4o');
    expect(entry!.contextWindow).toBe(128_000);
  });

  it('matches GPT-4o-mini', () => {
    const entry = lookupCatalog('openai', 'gpt-4o-mini');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4o Mini');
    expect(entry!.inputPricePer1k).toBeLessThan(0.001);
  });

  it('matches GPT-4.1', () => {
    const entry = lookupCatalog('openai', 'gpt-4.1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4.1');
    expect(entry!.contextWindow).toBe(1_000_000);
  });

  it('matches GPT-4.1-mini', () => {
    const entry = lookupCatalog('openai', 'gpt-4.1-mini');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4.1 Mini');
  });

  it('matches GPT-4.1-nano', () => {
    const entry = lookupCatalog('openai', 'gpt-4.1-nano');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4.1 Nano');
  });

  it('matches o3-mini', () => {
    const entry = lookupCatalog('openai', 'o3-mini');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('o3-mini');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches o3 without matching o3-mini', () => {
    const entry = lookupCatalog('openai', 'o3');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('o3');
    expect(entry!.inputPricePer1k).toBeGreaterThan(0.005);
  });

  it('matches o4-mini', () => {
    const entry = lookupCatalog('openai', 'o4-mini');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('o4-mini');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches o1', () => {
    const entry = lookupCatalog('openai', 'o1');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('o1');
    expect(entry!.capabilities).toContain('reasoning');
  });

  // ── Google ───────────────────────────────────────────────────

  it('matches Gemini 2.5 Pro', () => {
    const entry = lookupCatalog('google', 'gemini-2.5-pro');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Gemini 2.5 Pro');
    expect(entry!.capabilities).toContain('reasoning');
    expect(entry!.contextWindow).toBe(1_000_000);
  });

  it('matches Gemini 2.0 Flash', () => {
    const entry = lookupCatalog('google', 'gemini-2.0-flash');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Gemini 2.0 Flash');
  });

  it('matches Gemini 2.0 Flash Lite before regular Flash', () => {
    const entry = lookupCatalog('google', 'gemini-2.0-flash-lite');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Gemini 2.0 Flash Lite');
  });

  // ── DeepSeek ─────────────────────────────────────────────────

  it('matches DeepSeek R1', () => {
    const entry = lookupCatalog('deepseek', 'deepseek-reasoner');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('DeepSeek R1');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches DeepSeek V3 / deepseek-chat', () => {
    const entry = lookupCatalog('deepseek', 'deepseek-chat');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('DeepSeek V3');
  });

  // ── Mistral ──────────────────────────────────────────────────

  it('matches Mistral Small', () => {
    const entry = lookupCatalog('mistral', 'mistral-small-latest');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Mistral Small');
  });

  it('matches Mistral Large', () => {
    const entry = lookupCatalog('mistral', 'mistral-large-latest');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Mistral Large');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches Codestral', () => {
    const entry = lookupCatalog('mistral', 'codestral-latest');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Codestral');
  });

  // ── xAI / Cohere / Perplexity ───────────────────────────────

  it('matches Grok 4', () => {
    const entry = lookupCatalog('xai', 'grok-4');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Grok 4');
    expect(entry!.capabilities).toContain('vision');
  });

  it('matches Cohere Command A', () => {
    const entry = lookupCatalog('cohere', 'command-a-03-2025');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Command A');
    expect(entry!.capabilities).toContain('function_calling');
  });

  it('matches Perplexity Sonar Reasoning Pro', () => {
    const entry = lookupCatalog('perplexity', 'sonar-reasoning-pro');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Sonar Reasoning Pro');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches Azure OpenAI GPT-4o deployments through the OpenAI catalog mirror', () => {
    const entry = lookupCatalog('azure', 'gpt-4o');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4o');
    expect(entry!.capabilities).toContain('vision');
  });

  it('matches Bedrock Claude models', () => {
    const entry = lookupCatalog('bedrock', 'anthropic.claude-3-7-sonnet-20250219-v1:0');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude 3.7 Sonnet (Bedrock)');
    expect(entry!.capabilities).toContain('reasoning');
  });

  it('matches Cohere Command R via Bedrock catalog', () => {
    const entry = lookupCatalog('bedrock', 'cohere.command-r-v1:0');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Cohere Command R');
    expect(entry!.capabilities).toContain('function_calling');
  });

  // ── Copilot cross-provider lookup ────────────────────────────

  it('matches GPT-4o via copilot provider', () => {
    const entry = lookupCatalog('copilot', 'copilot/gpt-4o');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('GPT-4o');
  });

  it('matches Claude Sonnet 4 via copilot provider', () => {
    const entry = lookupCatalog('copilot', 'claude-sonnet-4');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude Sonnet 4');
  });

  it('matches o4-mini via copilot provider', () => {
    const entry = lookupCatalog('copilot', 'o4-mini');
    expect(entry).toBeDefined();
    expect(entry!.capabilities).toContain('reasoning');
  });

  // ── Cross-provider fallback ──────────────────────────────────

  it('matches Claude model hosted on zai via cross-catalog fallback', () => {
    const entry = lookupCatalog('zai', 'claude-3-5-sonnet-latest');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Claude 3.5 Sonnet');
  });

  // ── Unknown model ────────────────────────────────────────────

  it('returns undefined for unknown model', () => {
    const entry = lookupCatalog('openai', 'totally-unknown-model-xyz');
    expect(entry).toBeUndefined();
  });

  it('uses the NVIDIA model catalog page for provider and model info links', () => {
    expect(getProviderInfoUrl('nvidia')).toBe('https://build.nvidia.com/models');
    expect(getModelInfoUrl('nvidia', 'nvidia/meta/llama-3.1-70b-instruct')).toBe('https://build.nvidia.com/models');
  });

  it('uses the Claude CLI reference page for provider and model info links', () => {
    expect(getProviderInfoUrl('claude-cli')).toBe('https://code.claude.com/docs/en/cli-reference');
    expect(getModelInfoUrl('claude-cli', 'claude-cli/sonnet')).toBe('https://code.claude.com/docs/en/cli-reference');
  });
});

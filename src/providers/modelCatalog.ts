/**
 * Well-known model catalog — maps model ID patterns to verified metadata.
 *
 * Used by `inferModelMetadata()` to produce accurate routing information
 * for models discovered at runtime. Entries are based on published
 * provider documentation and pricing pages.
 *
 * Each entry uses a regex `pattern` tested against the model ID
 * (after stripping the provider prefix).  Patterns are evaluated
 * in order; the first match wins.
 */

import type { ModelCapability, SpecialistDomain } from '../types.js';

export interface CatalogEntry {
  pattern: RegExp;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
  capabilities: ModelCapability[];
  specialistDomains?: SpecialistDomain[];
  /**
   * Premium-request multiplier when accessed via a subscription provider.\n   * Standard = 1 (default), premium models consume more units per request.\n   * Based on published GitHub Copilot premium-request multipliers.\n   */
  premiumRequestMultiplier?: number;
}

// ── Anthropic ────────────────────────────────────────────────────
// Premium-request multipliers sourced from:
// https://docs.github.com/en/copilot/concepts/billing/copilot-requests
// These are kept in sync automatically by copilotMultiplierSync.ts on each
// refresh; the values here serve as the static fallback.

const ANTHROPIC_CATALOG: CatalogEntry[] = [
  {
    pattern: /^sonnet$/i,
    name: 'Claude Sonnet',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'reasoning'],
    // Sonnet 4.x = 1× on Copilot paid plans
  },
  {
    pattern: /^opus$/i,
    name: 'Claude Opus',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'reasoning'],
    // Generic "opus" alias — conservative fallback value
    premiumRequestMultiplier: 7.5,
  },
  {
    pattern: /^haiku$/i,
    name: 'Claude Haiku',
    contextWindow: 200_000,
    inputPricePer1k: 0.0008,
    outputPricePer1k: 0.004,
    capabilities: ['chat', 'code'],
    // Haiku 4.5 = 0.33× on Copilot paid plans
    premiumRequestMultiplier: 0.33,
  },
  // Specific Opus version matches must appear BEFORE the generic opus-4 pattern.
  {
    // Opus 4.7 — repriced to 7.5× in April 2025
    pattern: /claude.*opus.*4[._-]?7/i,
    name: 'Claude Opus 4.7',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 7.5,
  },
  {
    // Opus 4.6 fast mode — 30× (preview)
    pattern: /claude.*opus.*4[._-]?6.*fast/i,
    name: 'Claude Opus 4.6 (fast mode)',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 30,
  },
  {
    // Opus 4.5 and 4.6 = 3× on Copilot paid plans
    pattern: /claude.*opus.*4[._-]?[56]/i,
    name: 'Claude Opus 4',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 3,
  },
  {
    // Generic opus-4 catch-all (future versions default to 7.5× until sync updates)
    pattern: /claude.*opus.*4/i,
    name: 'Claude Opus 4',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 7.5,
  },
  {
    // Sonnet 4.x = 1× (included in paid plans, no premium deduction)
    pattern: /claude.*sonnet.*4/i,
    name: 'Claude Sonnet 4',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 1,
  },
  {
    pattern: /claude.*3[._-]?7.*sonnet/i,
    name: 'Claude 3.7 Sonnet',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    pattern: /claude.*3[._-]?5.*haiku/i,
    name: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    inputPricePer1k: 0.0008,
    outputPricePer1k: 0.004,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /claude.*3[._-]?5.*sonnet/i,
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    pattern: /claude.*3.*opus/i,
    name: 'Claude 3 Opus',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 3,
  },
  {
    pattern: /claude.*3.*haiku/i,
    name: 'Claude 3 Haiku',
    contextWindow: 200_000,
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.00125,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── OpenAI ───────────────────────────────────────────────────────
// Copilot multipliers from:
// https://docs.github.com/en/copilot/concepts/billing/copilot-requests
// GPT-4o and GPT-4.1 are "included models" on paid plans (0 premium units).
// Multipliers not listed for o1/o3 series — treated as pay-per-token when
// accessed via Copilot; the sync layer will update these if they appear.

const OPENAI_CATALOG: CatalogEntry[] = [
  {
    // GPT-4o Mini — not listed in current Copilot table (legacy; may be free tier only)
    pattern: /gpt-?4o-?mini/i,
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-4o = 0 premium units on paid Copilot plans (included model)
    pattern: /gpt-?4o/i,
    name: 'GPT-4o',
    contextWindow: 128_000,
    inputPricePer1k: 0.0025,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
    premiumRequestMultiplier: 0,
  },
  {
    pattern: /gpt-?4\.?1-?mini/i,
    name: 'GPT-4.1 Mini',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0004,
    outputPricePer1k: 0.0016,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /gpt-?4\.?1-?nano/i,
    name: 'GPT-4.1 Nano',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0001,
    outputPricePer1k: 0.0004,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // GPT-4.1 = 0 premium units on paid Copilot plans (included model)
    pattern: /gpt-?4\.?1/i,
    name: 'GPT-4.1',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.008,
    capabilities: ['chat', 'code', 'function_calling'],
    premiumRequestMultiplier: 0,
  },
  {
    // o4-mini = 0.33× per Copilot docs
    pattern: /o4-?mini/i,
    name: 'o4-mini',
    contextWindow: 200_000,
    inputPricePer1k: 0.0011,
    outputPricePer1k: 0.0044,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 0.33,
  },
  {
    pattern: /o3-?mini/i,
    name: 'o3-mini',
    contextWindow: 200_000,
    inputPricePer1k: 0.0011,
    outputPricePer1k: 0.0044,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /o3(?!-?mini)/i,
    name: 'o3',
    contextWindow: 200_000,
    inputPricePer1k: 0.01,
    outputPricePer1k: 0.04,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /o1-?mini/i,
    name: 'o1-mini',
    contextWindow: 128_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.012,
    capabilities: ['chat', 'code', 'reasoning'],
  },
  {
    // o1 not listed in current Copilot table — no multiplier set; treated as pay-per-token
    pattern: /o1(?!-?mini)/i,
    name: 'o1',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.06,
    capabilities: ['chat', 'code', 'reasoning'],
  },
];

const AZURE_OPENAI_CATALOG: CatalogEntry[] = [...OPENAI_CATALOG];

// ── Google Gemini ────────────────────────────────────────────────

const GOOGLE_CATALOG: CatalogEntry[] = [
  {
    pattern: /gemini.*2\.?5.*pro(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /gemini.*2\.?5.*flash(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /gemini.*2\.?0.*flash.*lite(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 2.0 Flash Lite',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.000075,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /gemini.*2\.?0.*flash(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0001,
    outputPricePer1k: 0.0004,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /gemini.*1\.?5.*pro(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 1.5 Pro',
    contextWindow: 2_000_000,
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.005,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /gemini.*1\.?5.*flash(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 1.5 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.000075,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
];

// ── DeepSeek ─────────────────────────────────────────────────────

const DEEPSEEK_CATALOG: CatalogEntry[] = [
  {
    pattern: /deepseek.*r1|deepseek.*reasoner/i,
    name: 'DeepSeek R1',
    contextWindow: 128_000,
    inputPricePer1k: 0.00055,
    outputPricePer1k: 0.00219,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /deepseek.*v3|deepseek-chat/i,
    name: 'DeepSeek V3',
    contextWindow: 128_000,
    inputPricePer1k: 0.00027,
    outputPricePer1k: 0.0011,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── Mistral ──────────────────────────────────────────────────────

const MISTRAL_CATALOG: CatalogEntry[] = [
  {
    pattern: /codestral/i,
    name: 'Codestral',
    contextWindow: 256_000,
    inputPricePer1k: 0.0003,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /mistral.*large/i,
    name: 'Mistral Large',
    contextWindow: 128_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.006,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /mistral.*medium/i,
    name: 'Mistral Medium',
    contextWindow: 128_000,
    inputPricePer1k: 0.0027,
    outputPricePer1k: 0.0081,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /mistral.*small/i,
    name: 'Mistral Small',
    contextWindow: 128_000,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── xAI ─────────────────────────────────────────────────────────

const XAI_CATALOG: CatalogEntry[] = [
  {
    pattern: /grok.*4/i,
    name: 'Grok 4',
    contextWindow: 2_000_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
];

// ── Cohere ─────────────────────────────────────────────────────

const COHERE_CATALOG: CatalogEntry[] = [
  {
    pattern: /command-a/i,
    name: 'Command A',
    contextWindow: 256_000,
    inputPricePer1k: 0.0025,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /command-r7b/i,
    name: 'Command R7B',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── Perplexity ─────────────────────────────────────────────────

const PERPLEXITY_CATALOG: CatalogEntry[] = [
  {
    pattern: /sonar-deep-research/i,
    name: 'Sonar Deep Research',
    contextWindow: 128_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.003,
    capabilities: ['chat', 'reasoning'],
    specialistDomains: ['research'],
  },
  {
    pattern: /sonar-reasoning-pro/i,
    name: 'Sonar Reasoning Pro',
    contextWindow: 128_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.002,
    capabilities: ['chat', 'reasoning'],
    specialistDomains: ['research'],
  },
  {
    pattern: /sonar-pro/i,
    name: 'Sonar Pro',
    contextWindow: 128_000,
    inputPricePer1k: 0.001,
    outputPricePer1k: 0.001,
    capabilities: ['chat', 'reasoning'],
    specialistDomains: ['research'],
  },
  {
    pattern: /sonar/i,
    name: 'Sonar',
    contextWindow: 128_000,
    inputPricePer1k: 0.001,
    outputPricePer1k: 0.001,
    capabilities: ['chat', 'reasoning'],
    specialistDomains: ['research'],
  },
];

// ── Amazon Bedrock ──────────────────────────────────────────────

const BEDROCK_CATALOG: CatalogEntry[] = [
  {
    pattern: /^anthropic\.claude-3-7-sonnet/i,
    name: 'Claude 3.7 Sonnet (Bedrock)',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^anthropic\.claude-3-5-sonnet/i,
    name: 'Claude 3.5 Sonnet (Bedrock)',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^meta\.llama-3(\.1|\.2)?-70b/i,
    name: 'Llama 3.1 70B Instruct (Bedrock)',
    contextWindow: 128_000,
    inputPricePer1k: 0.00265,
    outputPricePer1k: 0.0035,
    capabilities: ['chat', 'code'],
  },
  {
    pattern: /^amazon\.nova-(lite|pro)/i,
    name: 'Amazon Nova',
    contextWindow: 300_000,
    inputPricePer1k: 0.0008,
    outputPricePer1k: 0.0032,
    capabilities: ['chat', 'code', 'vision'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^anthropic\.claude-3-5-haiku/i,
    name: 'Claude 3.5 Haiku (Bedrock)',
    contextWindow: 200_000,
    inputPricePer1k: 0.0008,
    outputPricePer1k: 0.004,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /^anthropic\.claude-3-haiku/i,
    name: 'Claude 3 Haiku (Bedrock)',
    contextWindow: 200_000,
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.00125,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^anthropic\.claude-3-opus/i,
    name: 'Claude 3 Opus (Bedrock)',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^amazon\.nova-micro/i,
    name: 'Amazon Nova Micro',
    contextWindow: 128_000,
    inputPricePer1k: 0.000035,
    outputPricePer1k: 0.00014,
    capabilities: ['chat', 'code'],
  },
  {
    pattern: /^amazon\.titan-text-express/i,
    name: 'Amazon Titan Text Express',
    contextWindow: 8_192,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0006,
    capabilities: ['chat'],
  },
  {
    pattern: /^amazon\.titan-text-lite/i,
    name: 'Amazon Titan Text Lite',
    contextWindow: 4_096,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0002,
    capabilities: ['chat'],
  },
  {
    pattern: /^cohere\.command-r-plus/i,
    name: 'Cohere Command R+',
    contextWindow: 128_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /^cohere\.command-r(?!-plus)/i,
    name: 'Cohere Command R',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /^mistral\.mistral-7b/i,
    name: 'Mistral 7B Instruct (Bedrock)',
    contextWindow: 32_768,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0002,
    capabilities: ['chat', 'code'],
  },
  {
    pattern: /^mistral\.mixtral-8x7b/i,
    name: 'Mistral 8x7B Instruct (Bedrock)',
    contextWindow: 32_768,
    inputPricePer1k: 0.00045,
    outputPricePer1k: 0.0007,
    capabilities: ['chat', 'code'],
  },
  {
    pattern: /^meta\.llama3-2-1b/i,
    name: 'Llama 3.2 1B (Bedrock)',
    contextWindow: 128_000,
    inputPricePer1k: 0.0001,
    outputPricePer1k: 0.0001,
    capabilities: ['chat'],
  },
  {
    pattern: /^meta\.llama3-2-3b/i,
    name: 'Llama 3.2 3B (Bedrock)',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.00015,
    capabilities: ['chat'],
  },
  {
    pattern: /^meta\.llama3-2-11b/i,
    name: 'Llama 3.2 11B Vision (Bedrock)',
    contextWindow: 128_000,
    inputPricePer1k: 0.00016,
    outputPricePer1k: 0.00016,
    capabilities: ['chat', 'vision'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^meta\.llama3-2-90b/i,
    name: 'Llama 3.2 90B Vision (Bedrock)',
    contextWindow: 128_000,
    inputPricePer1k: 0.00072,
    outputPricePer1k: 0.00072,
    capabilities: ['chat', 'vision'],
    specialistDomains: ['visual-analysis'],
  },
  {
    pattern: /^ai21\.jamba-1-5-mini/i,
    name: 'AI21 Jamba 1.5 Mini',
    contextWindow: 256_000,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0004,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /^ai21\.jamba-1-5-large/i,
    name: 'AI21 Jamba 1.5 Large',
    contextWindow: 256_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.008,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
];

// ── Local / Ollama ───────────────────────────────────────────────

const LOCAL_CATALOG: CatalogEntry[] = [
  // Gemma 3
  { pattern: /gemma[- _]?3[- _]?1b/i, name: 'Gemma 3 1B', contextWindow: 32_768, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code'] },
  { pattern: /gemma[- _]?3[- _]?4b/i, name: 'Gemma 3 4B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'vision', 'function_calling'] },
  { pattern: /gemma[- _]?3[- _]?12b/i, name: 'Gemma 3 12B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'vision', 'function_calling'] },
  { pattern: /gemma[- _]?3[- _]?27b/i, name: 'Gemma 3 27B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'vision', 'function_calling'] },
  { pattern: /gemma[- _]?3/i, name: 'Gemma 3', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Nemotron
  { pattern: /nemotron[- _]?mini/i, name: 'Nemotron Mini', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /nemotron[- _]?nano/i, name: 'Nemotron Nano', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /nemotron[- _]?4b/i, name: 'Nemotron 4B', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /nemotron[- _]?70b/i, name: 'Nemotron 70B', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /nemotron/i, name: 'Nemotron', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Devstral
  { pattern: /devstral[- _]?small/i, name: 'Devstral Small', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /devstral/i, name: 'Devstral', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Mistral
  { pattern: /mistral[- _]?7b/i, name: 'Mistral 7B', contextWindow: 32_768, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /mistral[- _]?nemo/i, name: 'Mistral NeMo', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /mistral[- _]?small/i, name: 'Mistral Small', contextWindow: 32_768, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /mistral[- _]?large/i, name: 'Mistral Large', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /mistral/i, name: 'Mistral', contextWindow: 32_768, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Qwen 2.5 Coder
  { pattern: /qwen2\.?5[- _]?coder[- _]?7b/i, name: 'Qwen 2.5 Coder 7B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /qwen2\.?5[- _]?coder[- _]?14b/i, name: 'Qwen 2.5 Coder 14B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /qwen2\.?5[- _]?coder[- _]?32b/i, name: 'Qwen 2.5 Coder 32B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /qwen2\.?5[- _]?coder/i, name: 'Qwen 2.5 Coder', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Qwen 3
  { pattern: /qwen3[- _]?14b/i, name: 'Qwen 3 14B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /qwen3[- _]?30b/i, name: 'Qwen 3 30B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /qwen3[- _]?235b/i, name: 'Qwen 3 235B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /qwen3/i, name: 'Qwen 3', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  // Qwen 2.5
  { pattern: /qwen2\.?5/i, name: 'Qwen 2.5', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Llama 3.x
  { pattern: /llama[- _]?3(?:\.\d)?[- _]?1b/i, name: 'Llama 3 1B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code'] },
  { pattern: /llama[- _]?3(?:\.\d)?[- _]?8b/i, name: 'Llama 3 8B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /llama[- _]?3(?:\.\d)?[- _]?70b/i, name: 'Llama 3 70B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /llama[- _]?3/i, name: 'Llama 3', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Phi
  { pattern: /phi[- _]?4/i, name: 'Phi-4', contextWindow: 16_384, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /phi[- _]?3\.5/i, name: 'Phi-3.5', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /phi[- _]?3/i, name: 'Phi-3', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // DeepSeek R1 distills
  { pattern: /deepseek[- _]?r1[- _]?distill[- _]?qwen[- _]?7b/i, name: 'DeepSeek R1 Distill Qwen 7B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /deepseek[- _]?r1[- _]?distill[- _]?qwen[- _]?14b/i, name: 'DeepSeek R1 Distill Qwen 14B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /deepseek[- _]?r1[- _]?distill[- _]?qwen[- _]?32b/i, name: 'DeepSeek R1 Distill Qwen 32B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /deepseek[- _]?r1[- _]?distill[- _]?llama[- _]?8b/i, name: 'DeepSeek R1 Distill Llama 8B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /deepseek[- _]?r1[- _]?distill[- _]?llama[- _]?70b/i, name: 'DeepSeek R1 Distill Llama 70B', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  { pattern: /deepseek[- _]?r1/i, name: 'DeepSeek R1', contextWindow: 131_072, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling', 'reasoning'] },
  // Codestral
  { pattern: /codestral/i, name: 'Codestral', contextWindow: 256_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  // Command R
  { pattern: /command[- _]?r\+/i, name: 'Command R+', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
  { pattern: /command[- _]?r/i, name: 'Command R', contextWindow: 128_000, inputPricePer1k: 0, outputPricePer1k: 0, capabilities: ['chat', 'code', 'function_calling'] },
];

// ── Provider → catalog map ───────────────────────────────────────

const PROVIDER_CATALOGS: Record<string, CatalogEntry[]> = {
  anthropic: ANTHROPIC_CATALOG,
  'claude-cli': ANTHROPIC_CATALOG,
  openai: OPENAI_CATALOG,
  azure: AZURE_OPENAI_CATALOG,
  google: GOOGLE_CATALOG,
  deepseek: DEEPSEEK_CATALOG,
  mistral: MISTRAL_CATALOG,
  bedrock: BEDROCK_CATALOG,
  xai: XAI_CATALOG,
  cohere: COHERE_CATALOG,
  perplexity: PERPLEXITY_CATALOG,
  local: LOCAL_CATALOG,
  // Copilot models are matched via any provider catalog since they
  // surface models from multiple upstream providers (GPT, Claude, etc.)
};

/**
 * Look up a model in the well-known catalog.
 *
 * @param providerId  Provider that discovered the model (e.g. 'copilot', 'anthropic').
 * @param modelId     Full model ID (e.g. 'copilot/gpt-4o') or bare name.
 * @returns The matching catalog entry, or `undefined` if the model is not recognised.
 */
export function lookupCatalog(providerId: string, modelId: string): CatalogEntry | undefined {
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;

  // For Copilot, the model ID may reference any upstream provider's model.
  // Search all catalogs.
  if (providerId === 'copilot') {
    for (const catalog of Object.values(PROVIDER_CATALOGS)) {
      const match = catalog.find(entry => entry.pattern.test(shortId));
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  // For direct API providers, search their own catalog first, then fallback to all.
  const ownCatalog = PROVIDER_CATALOGS[providerId];
  if (ownCatalog) {
    const match = ownCatalog.find(entry => entry.pattern.test(shortId));
    if (match) {
      return match;
    }
  }

  // Fallback: search all catalogs (handles re-hosted models, e.g. Claude via zai).
  for (const [pid, catalog] of Object.entries(PROVIDER_CATALOGS)) {
    if (pid === providerId) {
      continue;
    }
    const match = catalog.find(entry => entry.pattern.test(shortId));
    if (match) {
      return match;
    }
  }

  return undefined;
}

const PROVIDER_INFO_URLS: Record<string, string> = {
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
  'claude-cli': 'https://code.claude.com/docs/en/cli-reference',
  openai: 'https://platform.openai.com/docs/models',
  azure: 'https://learn.microsoft.com/azure/ai-services/openai/concepts/models',
  google: 'https://ai.google.dev/gemini-api/docs/models',
  mistral: 'https://docs.mistral.ai/getting-started/models/models_overview/',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
  zai: 'https://docs.z.ai/guides/models/',
  bedrock: 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
  xai: 'https://docs.x.ai/developers/models',
  cohere: 'https://docs.cohere.com/docs/models',
  perplexity: 'https://docs.perplexity.ai/home',
  huggingface: 'https://huggingface.co/docs/inference-providers/tasks/chat-completion',
  nvidia: 'https://build.nvidia.com/models',
  copilot: 'https://docs.github.com/en/copilot/reference/ai-models/supported-ai-models-in-copilot',
};

export function getProviderInfoUrl(providerId: string): string | undefined {
  return PROVIDER_INFO_URLS[providerId];
}

export function getModelInfoUrl(providerId: string, modelId: string): string | undefined {
  void modelId;
  return getProviderInfoUrl(providerId);
}

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
// Copilot AI credits pricing sourced from:
// https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
// Legacy PRU multipliers retained for annual plan holders on request-based billing.
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
    // Opus 4.8 — AI credits billing only (launched after June 2026 migration)
    pattern: /claude.*opus.*4[._-]?8/i,
    name: 'Claude Opus 4.8',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    // Opus 4.7 — repriced to 7.5× in April 2025; AI credits price via Copilot: $5/$25 per 1M
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
    // Generic opus-4 catch-all; sync layer will override pricing for known versions
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
// Pricing from: https://developers.openai.com/api/docs/pricing
// Copilot AI credits pricing: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
// GPT-4o and GPT-4.1 had 0 PRU on the legacy Copilot billing model.
// GPT-5 series launched under AI credits billing (June 2026).
// o3-mini, o1, o1-mini are deprecated as of mid-2026; kept for legacy routing.

const OPENAI_CATALOG: CatalogEntry[] = [
  // ── GPT-5 series (direct API pricing; matches Copilot AI credits pricing) ──
  {
    // GPT-5.5 Pro — premium reasoning; $30/$180 per 1M
    pattern: /gpt-?5\.?5-?pro/i,
    name: 'GPT-5.5 Pro',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.03,
    outputPricePer1k: 0.18,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-5.5 — flagship; $5.00/$30.00 per 1M; 1M context
    pattern: /gpt-?5\.?5(?!-?pro)/i,
    name: 'GPT-5.5',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.005,
    outputPricePer1k: 0.03,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-5.4 Pro — premium reasoning; $30/$180 per 1M
    pattern: /gpt-?5\.?4-?pro/i,
    name: 'GPT-5.4 Pro',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.03,
    outputPricePer1k: 0.18,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-5.4 Nano — smallest variant; $0.20/$1.25 per 1M
    pattern: /gpt-?5\.?4-?nano/i,
    name: 'GPT-5.4 Nano',
    contextWindow: 200_000,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.00125,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // GPT-5.4 Mini — $0.75/$4.50 per 1M; 400K context
    pattern: /gpt-?5\.?4-?mini/i,
    name: 'GPT-5.4 Mini',
    contextWindow: 400_000,
    inputPricePer1k: 0.00075,
    outputPricePer1k: 0.0045,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // GPT-5.4 — $2.50/$15.00 per 1M; 1M context
    pattern: /gpt-?5\.?4(?!-?(?:mini|nano|pro))/i,
    name: 'GPT-5.4',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0025,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-5.3-Codex / GPT-5.2-Codex — code-specialized; $1.75/$14.00 per 1M
    pattern: /gpt-?5\.?[23]-?codex/i,
    name: 'GPT-5 Codex',
    contextWindow: 200_000,
    inputPricePer1k: 0.00175,
    outputPricePer1k: 0.014,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // GPT-5.2 — $1.75/$14.00 per 1M
    pattern: /gpt-?5\.?2(?!-?codex)/i,
    name: 'GPT-5.2',
    contextWindow: 200_000,
    inputPricePer1k: 0.00175,
    outputPricePer1k: 0.014,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // GPT-5 Mini — $0.25/$2.00 per 1M via Copilot
    pattern: /gpt-?5-?mini/i,
    name: 'GPT-5 Mini',
    contextWindow: 200_000,
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.002,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
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
    // o3-mini — deprecated mid-2026; retained for legacy routing
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
    // o1-mini — deprecated mid-2026; retained for legacy routing
    pattern: /o1-?mini/i,
    name: 'o1-mini',
    contextWindow: 128_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.012,
    capabilities: ['chat', 'code', 'reasoning'],
  },
  {
    // o1 — deprecated mid-2026; retained for legacy routing
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
  // ── Gemini 3 series (AI credits billing, June 2026) ──────────────────────
  {
    // Gemini 3.5 Flash — $1.50/$9.00 per 1M via Copilot
    pattern: /gemini.*3\.?5.*flash(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 3.5 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0015,
    outputPricePer1k: 0.009,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // Gemini 3.1 Pro — $2.00/$12.00 per 1M via Copilot
    pattern: /gemini.*3\.?1.*pro(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 3.1 Pro',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.012,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  {
    // Gemini 3 Flash — $0.50/$3.00 per 1M via Copilot
    pattern: /gemini.*3(?!\.?\d).*flash(?!.*(?:tts|speech|audio))/i,
    name: 'Gemini 3 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0005,
    outputPricePer1k: 0.003,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
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
    // Codestral Mamba and base Codestral — code-specialized; priced equally
    pattern: /codestral/i,
    name: 'Codestral',
    contextWindow: 256_000,
    inputPricePer1k: 0.0003,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Pixtral Large — vision-capable flagship; same price tier as Mistral Large
    pattern: /pixtral.*large|pixtral.*2411/i,
    name: 'Pixtral Large',
    contextWindow: 128_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.006,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    // Pixtral 12B — smaller vision model
    pattern: /pixtral/i,
    name: 'Pixtral 12B',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.00015,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  {
    // Magistral Medium — reasoning; $2/$5 per 1M
    pattern: /magistral.*medium/i,
    name: 'Magistral Medium',
    contextWindow: 40_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.005,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    // Magistral Small — $0.5/$1.5 per 1M
    pattern: /magistral.*small/i,
    name: 'Magistral Small',
    contextWindow: 40_000,
    inputPricePer1k: 0.0005,
    outputPricePer1k: 0.0015,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    // Mistral Large — flagship model
    pattern: /mistral.*large/i,
    name: 'Mistral Large',
    contextWindow: 128_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.006,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    // Mistral Medium
    pattern: /mistral.*medium/i,
    name: 'Mistral Medium',
    contextWindow: 128_000,
    inputPricePer1k: 0.0027,
    outputPricePer1k: 0.0081,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Mistral Small
    pattern: /mistral.*small/i,
    name: 'Mistral Small',
    contextWindow: 128_000,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Mixtral 8×22B — MoE flagship; $2/$6 per 1M
    pattern: /mixtral.*8x22b|open.?mixtral.*8x22b/i,
    name: 'Mixtral 8x22B',
    contextWindow: 64_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Mixtral 8×7B — MoE mid-tier; $0.7/$0.7 per 1M
    pattern: /mixtral.*8x7b|open.?mixtral.*8x7b/i,
    name: 'Mixtral 8x7B',
    contextWindow: 32_768,
    inputPricePer1k: 0.0007,
    outputPricePer1k: 0.0007,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Mistral NeMo (12B) — $0.15/$0.15 per 1M
    pattern: /mistral.*nemo|open.?mistral.*nemo/i,
    name: 'Mistral NeMo',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.00015,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Ministral 8B — $0.1/$0.1 per 1M
    pattern: /ministral.*8b/i,
    name: 'Ministral 8B',
    contextWindow: 128_000,
    inputPricePer1k: 0.0001,
    outputPricePer1k: 0.0001,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // Ministral 3B — $0.04/$0.04 per 1M
    pattern: /ministral.*3b/i,
    name: 'Ministral 3B',
    contextWindow: 128_000,
    inputPricePer1k: 0.00004,
    outputPricePer1k: 0.00004,
    capabilities: ['chat', 'code'],
  },
  {
    // Mistral 7B Instruct — $0.25/$0.25 per 1M
    pattern: /(?:open.?)?mistral.*7b/i,
    name: 'Mistral 7B',
    contextWindow: 32_768,
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.00025,
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

// ── Groq ────────────────────────────────────────────────────────
// Groq uses LPU (Language Processing Unit) hardware for ultra-fast inference.
// Model IDs are bare names (no org prefix) except the Llama 4 generation
// which uses meta-llama/<name>. Pricing in USD per 1M tokens.

const GROQ_CATALOG: CatalogEntry[] = [
  // Llama 4 (MoE) — Groq introduces slash-prefixed IDs for this generation
  {
    pattern: /llama[-_]?4.*maverick/i,
    name: 'Llama 4 Maverick',
    contextWindow: 524_288,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  {
    pattern: /llama[-_]?4.*scout/i,
    name: 'Llama 4 Scout',
    contextWindow: 131_072,
    inputPricePer1k: 0.00011,
    outputPricePer1k: 0.00034,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  // Llama 3.3 70B
  {
    pattern: /llama.*3[._-]?3.*70b/i,
    name: 'Llama 3.3 70B',
    contextWindow: 131_072,
    inputPricePer1k: 0.00059,
    outputPricePer1k: 0.00079,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Llama 3.2 vision models — must appear before the smaller 3.2 entries
  {
    pattern: /llama.*3[._-]?2.*90b/i,
    name: 'Llama 3.2 90B Vision',
    contextWindow: 131_072,
    inputPricePer1k: 0.0009,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  {
    pattern: /llama.*3[._-]?2.*11b/i,
    name: 'Llama 3.2 11B Vision',
    contextWindow: 131_072,
    inputPricePer1k: 0.00018,
    outputPricePer1k: 0.00018,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  // Llama 3.1 / 3.2 small (instant) variants
  {
    pattern: /llama.*(?:instant|3[._-]?1.*8b|3[._-]?2.*[13]b)/i,
    name: 'Llama 3.1 8B',
    contextWindow: 131_072,
    inputPricePer1k: 0.00005,
    outputPricePer1k: 0.00008,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Mixtral 8×7B — still available on Groq
  {
    pattern: /mixtral.*8x7b/i,
    name: 'Mixtral 8x7B',
    contextWindow: 32_768,
    inputPricePer1k: 0.00024,
    outputPricePer1k: 0.00024,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Gemma 2 9B
  {
    pattern: /gemma2?.*9b/i,
    name: 'Gemma 2 9B',
    contextWindow: 8_192,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0002,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Gemma 7B
  {
    pattern: /gemma.*7b/i,
    name: 'Gemma 7B',
    contextWindow: 8_192,
    inputPricePer1k: 0.00007,
    outputPricePer1k: 0.00007,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen QwQ 32B (reasoning)
  {
    pattern: /qwen.*qwq/i,
    name: 'Qwen QwQ 32B',
    contextWindow: 131_072,
    inputPricePer1k: 0.00029,
    outputPricePer1k: 0.00039,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  // Groq Compound Beta (compound-beta, compound-beta-mini)
  {
    pattern: /compound[-_]?beta[-_]?mini/i,
    name: 'Compound Beta Mini',
    contextWindow: 131_072,
    inputPricePer1k: 0.00059,
    outputPricePer1k: 0.00079,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /compound[-_]?beta/i,
    name: 'Compound Beta',
    contextWindow: 131_072,
    inputPricePer1k: 0.00059,
    outputPricePer1k: 0.00079,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
];

// ── Together AI ──────────────────────────────────────────────────
// Together AI hosts open-weight models behind an OpenAI-compatible API.
// Model IDs use org/model-name format (e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo).

const TOGETHER_CATALOG: CatalogEntry[] = [
  // Llama 3.3 / 3.1 — 405B first (most expensive, must appear before 70B)
  {
    pattern: /llama.*3[._-]?1.*405b/i,
    name: 'Llama 3.1 405B Turbo',
    contextWindow: 131_072,
    inputPricePer1k: 0.0035,
    outputPricePer1k: 0.0035,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /llama.*3[._-]?[13].*70b/i,
    name: 'Llama 3.3 70B Turbo',
    contextWindow: 131_072,
    inputPricePer1k: 0.00088,
    outputPricePer1k: 0.00088,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /llama.*3[._-]?[12].*8b/i,
    name: 'Llama 3.1 8B Turbo',
    contextWindow: 131_072,
    inputPricePer1k: 0.00018,
    outputPricePer1k: 0.00018,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // DeepSeek R1 / V3 — R1 first (more expensive)
  {
    pattern: /deepseek.*r1(?!.*distill)/i,
    name: 'DeepSeek R1',
    contextWindow: 163_840,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.007,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /deepseek.*v3|deepseek.*chat/i,
    name: 'DeepSeek V3',
    contextWindow: 131_072,
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.00125,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen 2.5 72B
  {
    pattern: /qwen2?[._-]?5.*72b/i,
    name: 'Qwen 2.5 72B',
    contextWindow: 131_072,
    inputPricePer1k: 0.0012,
    outputPricePer1k: 0.0012,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Mixtral 8×22B / 8×7B
  {
    pattern: /mixtral.*8x22b/i,
    name: 'Mixtral 8x22B',
    contextWindow: 65_536,
    inputPricePer1k: 0.0012,
    outputPricePer1k: 0.0012,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /mixtral.*8x7b/i,
    name: 'Mixtral 8x7B',
    contextWindow: 32_768,
    inputPricePer1k: 0.0006,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── Fireworks AI ─────────────────────────────────────────────────
// Fireworks AI uses accounts/fireworks/models/<name> model ID paths.
// Patterns match against the full path (minus the providerId prefix).

const FIREWORKS_CATALOG: CatalogEntry[] = [
  // Llama 3.3 / 3.1 — 405B first
  {
    pattern: /llama.*v3p?1.*405b/i,
    name: 'Llama 3.1 405B (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.003,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /llama.*v3p?3.*70b/i,
    name: 'Llama 3.3 70B (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.0009,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /llama.*v3p?1.*70b/i,
    name: 'Llama 3.1 70B (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.0009,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /llama.*v3p?1.*8b/i,
    name: 'Llama 3.1 8B (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.0002,
    outputPricePer1k: 0.0002,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // DeepSeek R1 / V3
  {
    pattern: /deepseek.*r1(?!.*distill)/i,
    name: 'DeepSeek R1 (Fireworks)',
    contextWindow: 163_840,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.007,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  {
    pattern: /deepseek.*v3/i,
    name: 'DeepSeek V3 (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.0009,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen 2.5 Coder 32B
  {
    pattern: /qwen2p?5.*coder.*32b/i,
    name: 'Qwen 2.5 Coder 32B (Fireworks)',
    contextWindow: 131_072,
    inputPricePer1k: 0.0009,
    outputPricePer1k: 0.0009,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Mixtral 8×7B
  {
    pattern: /mixtral.*8x7b/i,
    name: 'Mixtral 8x7B (Fireworks)',
    contextWindow: 32_768,
    inputPricePer1k: 0.0005,
    outputPricePer1k: 0.0005,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── Qwen / Alibaba DashScope ─────────────────────────────────────
// International endpoint: dashscope-intl.openai.aliyuncs.com/compatible-mode/v1
// Pricing in USD per 1M tokens (international tariff, ~June 2026).

const QWEN_CATALOG: CatalogEntry[] = [
  // Qwen-Max — flagship, highest capability
  {
    pattern: /qwen.*max/i,
    name: 'Qwen Max',
    contextWindow: 32_768,
    inputPricePer1k: 0.0016,
    outputPricePer1k: 0.0064,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  // Qwen-Plus — balanced performance
  {
    pattern: /qwen.*plus/i,
    name: 'Qwen Plus',
    contextWindow: 131_072,
    inputPricePer1k: 0.0004,
    outputPricePer1k: 0.0012,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen-Long — ultra-long context specialist
  {
    pattern: /qwen.*long/i,
    name: 'Qwen Long',
    contextWindow: 10_000_000,
    inputPricePer1k: 0.00005,
    outputPricePer1k: 0.0002,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen-Turbo — fast and cheap
  {
    pattern: /qwen.*turbo/i,
    name: 'Qwen Turbo',
    contextWindow: 131_072,
    inputPricePer1k: 0.00002,
    outputPricePer1k: 0.00006,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Qwen VL (vision language)
  {
    pattern: /qwen.*vl/i,
    name: 'Qwen VL',
    contextWindow: 32_768,
    inputPricePer1k: 0.00035,
    outputPricePer1k: 0.00035,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    specialistDomains: ['visual-analysis'],
  },
  // Qwen-Coder
  {
    pattern: /qwen.*coder/i,
    name: 'Qwen Coder',
    contextWindow: 131_072,
    inputPricePer1k: 0.00035,
    outputPricePer1k: 0.00035,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Generic Qwen catch-all
  {
    pattern: /^qwen/i,
    name: 'Qwen',
    contextWindow: 32_768,
    inputPricePer1k: 0.0004,
    outputPricePer1k: 0.0012,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── Moonshot AI (Kimi) ───────────────────────────────────────────
// China-based; specialises in ultra-long context. API: api.moonshot.cn/v1
// Pricing in CNY; approximate USD equivalents used here.

const MOONSHOT_CATALOG: CatalogEntry[] = [
  {
    pattern: /moonshot.*128k/i,
    name: 'Moonshot v1 128K',
    contextWindow: 128_000,
    inputPricePer1k: 0.00176,
    outputPricePer1k: 0.00176,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /moonshot.*32k/i,
    name: 'Moonshot v1 32K',
    contextWindow: 32_768,
    inputPricePer1k: 0.00069,
    outputPricePer1k: 0.00069,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /moonshot.*8k/i,
    name: 'Moonshot v1 8K',
    contextWindow: 8_192,
    inputPricePer1k: 0.00021,
    outputPricePer1k: 0.00021,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Kimi branded / generic catch-all
  {
    pattern: /kimi|moonshot/i,
    name: 'Moonshot v1',
    contextWindow: 32_768,
    inputPricePer1k: 0.00069,
    outputPricePer1k: 0.00069,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── 01.AI (Yi) ───────────────────────────────────────────────────
// Chinese provider founded by Kai-Fu Lee. API: api.01.ai/v1
// Yi models are open-weight; pricing is per 1M tokens.

const YI_CATALOG: CatalogEntry[] = [
  // Yi-Lightning — fastest, cheapest
  {
    pattern: /yi.*lightning/i,
    name: 'Yi Lightning',
    contextWindow: 16_384,
    inputPricePer1k: 0.000099,
    outputPricePer1k: 0.000099,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Yi-Large — most capable (34B)
  {
    pattern: /yi.*large(?!.*turbo)/i,
    name: 'Yi Large',
    contextWindow: 32_768,
    inputPricePer1k: 0.0003,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'reasoning', 'function_calling'],
  },
  // Yi-Large-Turbo — faster variant
  {
    pattern: /yi.*large.*turbo/i,
    name: 'Yi Large Turbo',
    contextWindow: 16_384,
    inputPricePer1k: 0.000126,
    outputPricePer1k: 0.000126,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Yi-Medium (6B / 9B)
  {
    pattern: /yi.*medium/i,
    name: 'Yi Medium',
    contextWindow: 16_384,
    inputPricePer1k: 0.00014,
    outputPricePer1k: 0.00014,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Yi-Spark (tiny, cheapest)
  {
    pattern: /yi.*spark/i,
    name: 'Yi Spark',
    contextWindow: 16_384,
    inputPricePer1k: 0.000099,
    outputPricePer1k: 0.000099,
    capabilities: ['chat', 'code'],
  },
  // Yi-Vision
  {
    pattern: /yi.*vision/i,
    name: 'Yi Vision',
    contextWindow: 4_096,
    inputPricePer1k: 0.00035,
    outputPricePer1k: 0.00035,
    capabilities: ['chat', 'vision'],
    specialistDomains: ['visual-analysis'],
  },
  // Generic Yi catch-all
  {
    pattern: /^yi[-_]/i,
    name: 'Yi',
    contextWindow: 16_384,
    inputPricePer1k: 0.0003,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'function_calling'],
  },
];

// ── MiniMax ──────────────────────────────────────────────────────
// Chinese multimodal provider. OpenAI-compat endpoint: api.minimax.chat/v1
// Known for long context and mixed-modality capabilities.

const MINIMAX_CATALOG: CatalogEntry[] = [
  // MiniMax-Text-01 — flagship long-context model (1M tokens)
  {
    pattern: /minimax.*text[-_]?01|text[-_]?01/i,
    name: 'MiniMax Text-01',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.00027,
    outputPricePer1k: 0.0011,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // abab6.5s — previous generation flagship
  {
    pattern: /abab6\.?5s/i,
    name: 'MiniMax abab6.5s',
    contextWindow: 245_760,
    inputPricePer1k: 0.00014,
    outputPricePer1k: 0.00014,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // abab6.5 (non-s)
  {
    pattern: /abab6\.?5(?!s)/i,
    name: 'MiniMax abab6.5',
    contextWindow: 8_192,
    inputPricePer1k: 0.0003,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  // Generic MiniMax catch-all
  {
    pattern: /minimax|abab/i,
    name: 'MiniMax',
    contextWindow: 245_760,
    inputPricePer1k: 0.00027,
    outputPricePer1k: 0.0011,
    capabilities: ['chat', 'code', 'function_calling'],
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

// ── Copilot-hosted models ────────────────────────────────────────
// Models exclusive to GitHub Copilot (fine-tuned by GitHub/Microsoft).
// Prices are Copilot AI credits pricing (June 2026); no direct API equivalent.

const COPILOT_HOSTED_CATALOG: CatalogEntry[] = [
  {
    // Raptor mini — GitHub fine-tuned; $0.25/$2.00 per 1M via Copilot
    pattern: /raptor[-_]?mini/i,
    name: 'Raptor Mini',
    contextWindow: 128_000,
    inputPricePer1k: 0.00025,
    outputPricePer1k: 0.002,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    // MAI-Code-1-Flash — Microsoft AI code model; $0.75/$4.50 per 1M via Copilot
    pattern: /mai[-_]?code[-_]?1[-_]?flash/i,
    name: 'MAI-Code-1-Flash',
    contextWindow: 128_000,
    inputPricePer1k: 0.00075,
    outputPricePer1k: 0.0045,
    capabilities: ['chat', 'code', 'function_calling'],
  },
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
  // Aggregator / fast-inference providers
  groq: GROQ_CATALOG,
  together: TOGETHER_CATALOG,
  fireworks: FIREWORKS_CATALOG,
  // Regional cloud providers
  qwen: QWEN_CATALOG,
  moonshot: MOONSHOT_CATALOG,
  yi: YI_CATALOG,
  minimax: MINIMAX_CATALOG,
  local: LOCAL_CATALOG,
  // Copilot-exclusive models (GitHub/Microsoft fine-tuned) searched first for 'copilot'.
  copilot_hosted: COPILOT_HOSTED_CATALOG,
  // Copilot also surfaces models from all other upstream providers (GPT, Claude, Gemini, etc.)
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
  // Skip 'local' and 'copilot_hosted' — their entries carry $0 or Copilot-specific
  // prices that must not contaminate cloud provider metadata.
  const FALLBACK_EXCLUDE = new Set(['local', 'copilot_hosted']);
  for (const [pid, catalog] of Object.entries(PROVIDER_CATALOGS)) {
    if (pid === providerId || FALLBACK_EXCLUDE.has(pid)) {
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
  openai: 'https://developers.openai.com/api/docs/models',
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

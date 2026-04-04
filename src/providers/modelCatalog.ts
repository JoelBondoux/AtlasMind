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

import type { ModelCapability } from '../types.js';

export interface CatalogEntry {
  pattern: RegExp;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
  capabilities: ModelCapability[];
  /**
   * Premium-request multiplier when accessed via a subscription provider.\n   * Standard = 1 (default), premium models consume more units per request.\n   * Based on published GitHub Copilot premium-request multipliers.\n   */
  premiumRequestMultiplier?: number;
}

// ── Anthropic ────────────────────────────────────────────────────

const ANTHROPIC_CATALOG: CatalogEntry[] = [
  {
    pattern: /claude.*sonnet.*4/i,
    name: 'Claude Sonnet 4',
    contextWindow: 200_000,
    inputPricePer1k: 0.003,
    outputPricePer1k: 0.015,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    pattern: /claude.*opus.*4/i,
    name: 'Claude Opus 4',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.075,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
    premiumRequestMultiplier: 3,
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

const OPENAI_CATALOG: CatalogEntry[] = [
  {
    pattern: /gpt-?4o-?mini/i,
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
    premiumRequestMultiplier: 0.25,
  },
  {
    pattern: /gpt-?4o/i,
    name: 'GPT-4o',
    contextWindow: 128_000,
    inputPricePer1k: 0.0025,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
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
    pattern: /gpt-?4\.?1/i,
    name: 'GPT-4.1',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.002,
    outputPricePer1k: 0.008,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
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
    pattern: /o1(?!-?mini)/i,
    name: 'o1',
    contextWindow: 200_000,
    inputPricePer1k: 0.015,
    outputPricePer1k: 0.06,
    capabilities: ['chat', 'code', 'reasoning'],
    premiumRequestMultiplier: 3,
  },
];

// ── Google Gemini ────────────────────────────────────────────────

const GOOGLE_CATALOG: CatalogEntry[] = [
  {
    pattern: /gemini.*2\.?5.*pro/i,
    name: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.01,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    pattern: /gemini.*2\.?5.*flash/i,
    name: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.00015,
    outputPricePer1k: 0.0006,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  {
    pattern: /gemini.*2\.?0.*flash.*lite/i,
    name: 'Gemini 2.0 Flash Lite',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.000075,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'function_calling'],
  },
  {
    pattern: /gemini.*2\.?0.*flash/i,
    name: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.0001,
    outputPricePer1k: 0.0004,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
  {
    pattern: /gemini.*1\.?5.*pro/i,
    name: 'Gemini 1.5 Pro',
    contextWindow: 2_000_000,
    inputPricePer1k: 0.00125,
    outputPricePer1k: 0.005,
    capabilities: ['chat', 'code', 'vision', 'reasoning', 'function_calling'],
  },
  {
    pattern: /gemini.*1\.?5.*flash/i,
    name: 'Gemini 1.5 Flash',
    contextWindow: 1_000_000,
    inputPricePer1k: 0.000075,
    outputPricePer1k: 0.0003,
    capabilities: ['chat', 'code', 'vision', 'function_calling'],
  },
];

// ── DeepSeek ─────────────────────────────────────────────────────

const DEEPSEEK_CATALOG: CatalogEntry[] = [
  {
    pattern: /deepseek.*r1|deepseek.*reasoner/i,
    name: 'DeepSeek R1',
    contextWindow: 64_000,
    inputPricePer1k: 0.00055,
    outputPricePer1k: 0.00219,
    capabilities: ['chat', 'code', 'reasoning'],
  },
  {
    pattern: /deepseek.*v3|deepseek-chat/i,
    name: 'DeepSeek V3',
    contextWindow: 64_000,
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

// ── Provider → catalog map ───────────────────────────────────────

const PROVIDER_CATALOGS: Record<string, CatalogEntry[]> = {
  anthropic: ANTHROPIC_CATALOG,
  openai: OPENAI_CATALOG,
  google: GOOGLE_CATALOG,
  deepseek: DEEPSEEK_CATALOG,
  mistral: MISTRAL_CATALOG,
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
  openai: 'https://platform.openai.com/docs/models',
  google: 'https://ai.google.dev/gemini-api/docs/models',
  mistral: 'https://docs.mistral.ai/getting-started/models/models_overview/',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing',
  zai: 'https://docs.z.ai/guides/models/',
  copilot: 'https://docs.github.com/en/copilot/reference/ai-models/supported-ai-models-in-copilot',
};

export function getProviderInfoUrl(providerId: string): string | undefined {
  return PROVIDER_INFO_URLS[providerId];
}

export function getModelInfoUrl(providerId: string, modelId: string): string | undefined {
  void modelId;
  return getProviderInfoUrl(providerId);
}

/**
 * Dynamic provider pricing sync.
 *
 * Fetches per-token pricing from each provider's public pricing or models docs
 * page on every model-catalog refresh (with a 7-day TTL cache).  This removes
 * the need to maintain hardcoded prices in modelCatalog.ts — the catalog
 * remains only as a last-resort fallback when scraping fails.
 *
 * Pattern mirrors copilotMultiplierSync.ts: fetch → parse → cache in globalState
 * → resolve against model IDs via fuzzy key matching.
 *
 * Supported providers: openai, azure, anthropic, google, mistral, deepseek,
 * xai, cohere, perplexity.  Copilot is handled separately by
 * copilotMultiplierSync.ts (which also populates tokenPrices).
 */

/** Cache TTL: 7 days, matching the Copilot multiplier sync. */
export const PROVIDER_PRICING_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProviderPricingEntry {
  /** USD per 1 000 input tokens. */
  inputPer1k: number;
  /** USD per 1 000 output tokens. */
  outputPer1k: number;
  /** Context window in tokens, when available on the pricing page. */
  contextWindow?: number;
  /**
   * USD per 1 000 cache-read input tokens, when the pricing page lists a
   * prompt-cache rate. Forward-compatible extension point so the dynamic
   * pricing sync can supply cache pricing as providers publish it.
   */
  cachedInputPer1k?: number;
}

export interface ProviderPricingSyncResult {
  /** Normalised model-name fragment → pricing entry. */
  entries: Record<string, ProviderPricingEntry>;
  /** ISO 8601 timestamp of when this sync completed. */
  syncedAt: string;
  /** URL that was fetched. */
  sourceUrl: string;
  /** Number of distinct model pricing entries parsed. */
  modelCount: number;
}

/**
 * Per-provider config: the URL to fetch and which table columns contain
 * model name, input price, and output price (0-based, all optional with defaults).
 * `outputCol` defaults to the last populated cell in the row when omitted.
 */
interface PricingPageSpec {
  url: string;
  nameCol?: number;
  inputCol?: number;
  outputCol?: number;
  ctxCol?: number;
}

export const PROVIDER_PRICING_SPECS: Readonly<Record<string, PricingPageSpec>> = {
  openai: {
    url: 'https://developers.openai.com/api/docs/pricing',
    nameCol: 0, inputCol: 1, outputCol: 3,
  },
  // Azure uses the same OpenAI pricing page — model IDs are deployment names
  // so the fuzzy matcher handles the mapping.
  azure: {
    url: 'https://developers.openai.com/api/docs/pricing',
    nameCol: 0, inputCol: 1, outputCol: 3,
  },
  anthropic: {
    url: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    nameCol: 0, inputCol: 2, outputCol: 3,
  },
  google: {
    url: 'https://ai.google.dev/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  mistral: {
    url: 'https://docs.mistral.ai/getting-started/models/models_overview/',
    nameCol: 0, inputCol: 2, outputCol: 3,
  },
  deepseek: {
    url: 'https://api-docs.deepseek.com/quick_start/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  xai: {
    url: 'https://docs.x.ai/docs/models',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  cohere: {
    url: 'https://cohere.com/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  perplexity: {
    url: 'https://docs.perplexity.ai/home',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  groq: {
    url: 'https://groq.com/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  together: {
    url: 'https://www.together.ai/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  fireworks: {
    url: 'https://fireworks.ai/pricing',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  qwen: {
    url: 'https://www.alibabacloud.com/help/en/model-studio/models',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  moonshot: {
    url: 'https://platform.moonshot.cn/docs/pricing/chat',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
  yi: {
    url: 'https://platform.01.ai/docs',
    nameCol: 0, inputCol: 1, outputCol: 2,
  },
};

/**
 * Fetch and parse the pricing page for a single provider.
 * Returns `undefined` if the page is unreachable or yields no entries.
 */
export async function fetchProviderPricing(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderPricingSyncResult | undefined> {
  const spec = PROVIDER_PRICING_SPECS[providerId];
  if (!spec) {
    return undefined;
  }

  let html: string;
  try {
    const response = await fetch(spec.url, {
      headers: { 'User-Agent': 'AtlasMind-VSCode-Extension' },
      signal,
    });
    if (!response.ok) {
      return undefined;
    }
    html = await response.text();
  } catch {
    return undefined;
  }

  const entries = parsePricingHtml(html, spec);
  const modelCount = Object.keys(entries).length;
  if (modelCount === 0) {
    return undefined;
  }

  return {
    entries,
    syncedAt: new Date().toISOString(),
    sourceUrl: spec.url,
    modelCount,
  };
}

/**
 * Fetch pricing for every provider that has a spec, in parallel.
 * Providers that fail gracefully return `undefined` and are skipped.
 */
export async function fetchAllProviderPricing(
  providerIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, ProviderPricingSyncResult>> {
  const ids = providerIds.filter(id => id in PROVIDER_PRICING_SPECS);
  const results = await Promise.allSettled(
    ids.map(id => fetchProviderPricing(id, signal)),
  );

  const map = new Map<string, ProviderPricingSyncResult>();
  for (let i = 0; i < ids.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      map.set(ids[i], r.value);
    }
  }
  return map;
}

/**
 * Parse an HTML page into a map of normalised model-name key → pricing entry.
 * Tries HTML `<table>` rows first, then markdown pipe-table rows as fallback.
 */
export function parsePricingHtml(
  html: string,
  spec: PricingPageSpec,
): Record<string, ProviderPricingEntry> {
  const result: Record<string, ProviderPricingEntry> = {};
  const { nameCol = 0, inputCol = 1 } = spec;

  // Strategy 1: HTML table rows
  const tableRowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRowRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(tableMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }

    const outCol = spec.outputCol ?? cells.length - 1;
    if (cells.length <= Math.max(nameCol, inputCol, outCol)) {
      continue;
    }

    const modelName = cells[nameCol];
    // Skip header/separator rows
    if (!modelName || /^-+$|^model$|^name$|^pricing$/i.test(modelName.trim())) {
      continue;
    }

    const inputPer1k = parsePricePer1k(cells[inputCol]);
    const outputPer1k = parsePricePer1k(cells[outCol]);
    if (inputPer1k === undefined || outputPer1k === undefined) {
      continue;
    }

    const key = normalizeKey(modelName);
    if (!key) {
      continue;
    }

    const ctxWindow = spec.ctxCol !== undefined
      ? parseContextTokens(cells[spec.ctxCol])
      : undefined;

    result[key] = {
      inputPer1k,
      outputPer1k,
      ...(ctxWindow !== undefined ? { contextWindow: ctxWindow } : {}),
    };
  }

  if (Object.keys(result).length > 0) {
    return result;
  }

  // Strategy 2: markdown pipe table fallback
  // Expects at least: | Model | Input | ... | Output |
  const mdRe = /^\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]*)/gm;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdRe.exec(html)) !== null) {
    const name = mdMatch[1].trim();
    if (/^-+$|^model$|^name$/i.test(name)) {
      continue;
    }
    const inputPer1k = parsePricePer1k(mdMatch[2].trim());
    // Last non-empty column among groups 3 and 4 is treated as output price
    const outputPer1k = parsePricePer1k(mdMatch[4].trim()) ?? parsePricePer1k(mdMatch[3].trim());
    if (inputPer1k === undefined || outputPer1k === undefined) {
      continue;
    }
    const key = normalizeKey(name);
    if (key) {
      result[key] = { inputPer1k, outputPer1k };
    }
  }

  return result;
}

/**
 * Parse a price cell such as "$0.25 per 1M tokens", "$2.50/MTok", or "$1.75"
 * and return USD per 1 000 tokens.  Returns `undefined` for N/A or free cells.
 */
function parsePricePer1k(raw: string): number | undefined {
  if (!raw || /n\/a|—|–|free|included|\bN\/A\b/i.test(raw)) {
    return undefined;
  }
  const match = raw.match(/\$\s*([\d.,]+)/);
  if (!match) {
    return undefined;
  }
  const dollars = parseFloat(match[1].replace(/,/g, ''));
  if (isNaN(dollars)) {
    return undefined;
  }
  // Prices on docs pages are typically "per 1M tokens"; divide by 1000 to get per-1k.
  return dollars / 1000;
}

/**
 * Parse a context window cell like "200K", "1M", "128k tokens", "1,000,000".
 * Returns the value in tokens, or `undefined` if not recognizable.
 */
function parseContextTokens(raw: string): number | undefined {
  const m = raw.replace(/,/g, '').match(/([\d.]+)\s*([MmKk])?/);
  if (!m) {
    return undefined;
  }
  const n = parseFloat(m[1]);
  if (isNaN(n)) {
    return undefined;
  }
  const unit = (m[2] ?? '').toLowerCase();
  if (unit === 'm') {
    return Math.round(n * 1_000_000);
  }
  if (unit === 'k') {
    return Math.round(n * 1_000);
  }
  // Raw integer like "128000"
  return n >= 1000 ? Math.round(n) : undefined;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalise a model display name to a stable lookup key (lower-case, collapsed spaces). */
export function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy-match a model ID against the entries in a sync result.
 *
 * Resolution order:
 *  1. Exact normalised key match.
 *  2. Key is a substring of the normalised model ID (or vice-versa).
 *  3. Full-word token overlap.
 */
export function resolveProviderPricing(
  modelId: string,
  result: ProviderPricingSyncResult,
): ProviderPricingEntry | undefined {
  if (!result.entries || Object.keys(result.entries).length === 0) {
    return undefined;
  }

  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const normId = shortId.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Exact match
  if (result.entries[normId]) {
    return result.entries[normId];
  }

  // 2. Substring match
  for (const [key, value] of Object.entries(result.entries)) {
    const normKey = key.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normId.includes(normKey) || normKey.includes(normId)) {
      return value;
    }
  }

  // 3. Token overlap (all tokens in the key must appear in the model ID)
  const idTokens = new Set(normId.split(' '));
  let bestMatch: { key: string; overlap: number } | undefined;
  for (const key of Object.keys(result.entries)) {
    const keyTokens = key.replace(/[-_.]/g, ' ').split(' ').filter(Boolean);
    const overlap = keyTokens.filter(t => idTokens.has(t)).length;
    if (overlap > 0 && overlap === keyTokens.length) {
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { key, overlap };
      }
    }
  }
  if (bestMatch) {
    return result.entries[bestMatch.key];
  }

  return undefined;
}

/** Returns true if the sync result is older than `PROVIDER_PRICING_CACHE_STALE_MS`. */
export function isProviderPricingStale(result: ProviderPricingSyncResult): boolean {
  return Date.now() - new Date(result.syncedAt).getTime() > PROVIDER_PRICING_CACHE_STALE_MS;
}

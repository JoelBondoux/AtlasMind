/**
 * Copilot premium-request multiplier sync.
 *
 * GitHub publishes a docs page listing how many "premium request" units each
 * model costs when accessed via Copilot.  These multipliers change without
 * notice as GitHub adds models or reprices them.  This module fetches that
 * page on each provider-model refresh and parses the table into a keyed map
 * that `mergeProviderModels` can consult at higher priority than the static
 * catalog.
 *
 * The last successful parse result and its timestamp are persisted in VS Code
 * `globalState` so the values survive restarts and are available immediately
 * on the next activation even before the network call completes.
 *
 * Sync URL: https://docs.github.com/en/copilot/concepts/billing/copilot-requests
 */

export const COPILOT_MULTIPLIER_DOCS_URL =
  'https://docs.github.com/en/copilot/concepts/billing/copilot-requests';

/** Maximum age of a cached result before it is considered stale (7 days). */
export const MULTIPLIER_CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MultiplierSyncResult {
  /** Map from lower-cased model-name fragment → multiplier for paid plans. */
  multipliers: Record<string, number>;
  /** ISO 8601 timestamp of when this sync completed successfully. */
  syncedAt: string;
  /** Human-readable summary for display in the UI. */
  modelCount: number;
}

/**
 * Fetch and parse the Copilot premium-request multiplier table from GitHub
 * docs.  Returns `undefined` if the page cannot be reached or the table
 * cannot be parsed.
 */
export async function fetchCopilotMultipliers(
  signal?: AbortSignal,
): Promise<MultiplierSyncResult | undefined> {
  let html: string;
  try {
    const response = await fetch(COPILOT_MULTIPLIER_DOCS_URL, {
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

  const multipliers = parseMultiplierTable(html);
  if (Object.keys(multipliers).length === 0) {
    return undefined;
  }

  return {
    multipliers,
    syncedAt: new Date().toISOString(),
    modelCount: Object.keys(multipliers).length,
  };
}

/**
 * Extract multiplier values from the HTML of the Copilot billing docs page.
 *
 * The page contains a markdown-rendered table with columns:
 *   Model | Multiplier (paid plans) | Multiplier (free tier)
 *
 * We want the "paid plans" column. The table may be rendered as <table> HTML
 * or as a markdown code block — we handle both.
 *
 * Returns a map from normalised model-name fragment → numeric multiplier.
 * Models listed as "0" (free/included) get a multiplier of 0.
 */
export function parseMultiplierTable(html: string): Record<string, number> {
  const result: Record<string, number> = {};

  // Strategy 1: HTML <table> rows — matches the GitHub rendered docs format.
  // Rows look like: <tr><td>Claude Opus 4.7</td><td>7.5</td><td>N/A</td></tr>
  const tableRowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRowRe.exec(html)) !== null) {
    const rowHtml = tableMatch[1];
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripHtmlTags(cellMatch[1]).trim());
    }

    if (cells.length >= 2) {
      const modelName = cells[0];
      const multiplierRaw = cells[1];
      const multiplier = parseMultiplierValue(multiplierRaw);
      if (modelName && multiplier !== undefined) {
        const key = normalizeModelKey(modelName);
        if (key) {
          result[key] = multiplier;
        }
      }
    }
  }

  if (Object.keys(result).length > 0) {
    return result;
  }

  // Strategy 2: Markdown pipe table (fallback for raw markdown responses).
  // | Claude Opus 4.7 | 7.5 | N/A |
  const mdRowRe = /^\|([^|]+)\|([^|]+)\|/gm;
  let mdMatch: RegExpExecArray | null;
  while ((mdMatch = mdRowRe.exec(html)) !== null) {
    const modelName = mdMatch[1].trim();
    const multiplierRaw = mdMatch[2].trim();
    if (modelName.startsWith('-') || modelName.toLowerCase() === 'model') {
      continue; // Skip header/separator rows
    }
    const multiplier = parseMultiplierValue(multiplierRaw);
    if (multiplier !== undefined) {
      const key = normalizeModelKey(modelName);
      if (key) {
        result[key] = multiplier;
      }
    }
  }

  return result;
}

function parseMultiplierValue(raw: string): number | undefined {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === 'NA' || raw.toLowerCase().includes('n/a')) {
    return undefined;
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

/**
 * Normalise a model display name into a lookup key.
 *
 * Keys are stored lower-cased and stripped of extra spacing so that
 * `resolveMultiplier` can do cheap substring/key matching against model IDs.
 */
export function normalizeModelKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given a model ID (e.g. `copilot/claude-opus-4-7`) and the sync result,
 * return the matching multiplier or `undefined` if no entry matches.
 *
 * Matching strategy (in priority order):
 *  1. Exact key match after normalisation.
 *  2. Key is a substring of the model ID.
 *  3. Model ID contains the key as a subsequence-like fragment.
 */
export function resolveMultiplier(
  modelId: string,
  syncResult: MultiplierSyncResult,
): number | undefined {
  if (!syncResult.multipliers || Object.keys(syncResult.multipliers).length === 0) {
    return undefined;
  }

  // Normalise the model ID: strip provider prefix, lower-case, collapse separators.
  const shortId = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const normId = shortId.toLowerCase().replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();

  // 1. Exact match.
  if (syncResult.multipliers[normId] !== undefined) {
    return syncResult.multipliers[normId];
  }

  // 2. Key is a substring of the normalised model ID — matches partial doc names.
  for (const [key, value] of Object.entries(syncResult.multipliers)) {
    const normKey = key.replace(/[-_.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normId.includes(normKey) || normKey.includes(normId)) {
      return value;
    }
  }

  // 3. Token overlap — split both into words and find best overlapping prefix.
  const idTokens = normId.split(' ');
  let bestMatch: { key: string; overlap: number } | undefined;
  for (const [key] of Object.entries(syncResult.multipliers)) {
    const keyTokens = key.replace(/[-_.]/g, ' ').split(' ').filter(Boolean);
    // Count tokens from the end of keyTokens that appear in idTokens.
    let overlap = 0;
    for (const token of keyTokens) {
      if (idTokens.includes(token)) {
        overlap++;
      }
    }
    if (overlap > 0 && overlap === keyTokens.length) {
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { key, overlap };
      }
    }
  }
  if (bestMatch) {
    return syncResult.multipliers[bestMatch.key];
  }

  return undefined;
}

/**
 * Returns true if the sync result is older than MULTIPLIER_CACHE_STALE_MS.
 */
export function isSyncStale(syncResult: MultiplierSyncResult): boolean {
  const age = Date.now() - new Date(syncResult.syncedAt).getTime();
  return age > MULTIPLIER_CACHE_STALE_MS;
}

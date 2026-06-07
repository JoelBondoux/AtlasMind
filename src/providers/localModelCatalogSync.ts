/**
 * Live local-model catalog sync.
 *
 * Fetches currently trending models from two sources:
 *   - Ollama library via the ollamadb.dev community API (sorted by pulls)
 *   - HuggingFace Hub API for LM Studio-compatible GGUF models (sorted by downloads)
 *
 * Because neither source carries hardware metadata, minRamGb / minVramGb are
 * inferred from the parameter count embedded in the model name (e.g. "14b"),
 * and workload tags are inferred from model-name keywords.  Inline metadata
 * hints override inferred values for well-known model families.
 *
 * Fetch results are cached in VS Code globalState with a 24-hour TTL.
 * If both live APIs are unreachable, the bundled data/local-model-catalog.json
 * (shipped with the extension) is used instead.
 *
 * Priority chain (resolved in localModelRecommendationRegistry):
 *   workspace override JSON > live/bundled synced catalog > hardcoded defaults
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type ReleaseAwareLocalCandidate,
  WORKLOAD_TAG_SET,
  type LocalRecommendationWorkloadTag,
} from './localModelRecommendationRegistry.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const OLLAMADB_URL = 'https://ollamadb.dev/api/v1/models?sort=pulls&limit=30';
const HUGGINGFACE_URL =
  'https://huggingface.co/api/models?apps=lmstudio&sort=downloads&limit=30';

export const LOCAL_MODEL_CATALOG_CACHE_KEY = 'atlasmind.localModelCatalogSync';
export const LOCAL_MODEL_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

// ── Metadata hints for well-known model families ───────────────────────────────
// Override inferred hardware/tag values where name-based inference is imprecise.

interface MetadataHint {
  pattern: RegExp;
  minRamGb: number;
  minVramGb?: number;
  workloadTags: LocalRecommendationWorkloadTag[];
}

const METADATA_HINTS: MetadataHint[] = [
  { pattern: /qwen3.*14b/i,      minRamGb: 16, minVramGb: 8,  workloadTags: ['code', 'reasoning', 'general'] },
  { pattern: /qwen3.*30b/i,      minRamGb: 42, minVramGb: 20, workloadTags: ['reasoning', 'code'] },
  { pattern: /qwen3.*7b/i,       minRamGb: 10, minVramGb: 6,  workloadTags: ['code', 'general'] },
  { pattern: /devstral/i,        minRamGb: 16, minVramGb: 8,  workloadTags: ['code', 'general'] },
  { pattern: /gemma.?3.*12b/i,   minRamGb: 18, minVramGb: 10, workloadTags: ['vision', 'code', 'general'] },
  { pattern: /gemma.?3.*4b/i,    minRamGb: 8,  minVramGb: 4,  workloadTags: ['vision', 'general'] },
  { pattern: /phi.?4/i,          minRamGb: 8,  minVramGb: 4,  workloadTags: ['code', 'general'] },
  { pattern: /llama.?3\.3.*70b/i,minRamGb: 64, minVramGb: 40, workloadTags: ['reasoning', 'general'] },
  { pattern: /llama.?3\.1.*8b/i, minRamGb: 10, minVramGb: 6,  workloadTags: ['general'] },
  { pattern: /llama.?3\.2.*3b/i, minRamGb: 6,  minVramGb: 3,  workloadTags: ['general'] },
  { pattern: /deepseek.*coder/i, minRamGb: 16, minVramGb: 8,  workloadTags: ['code'] },
  { pattern: /deepseek.*r1/i,    minRamGb: 16, minVramGb: 8,  workloadTags: ['reasoning', 'general'] },
  { pattern: /mistral.*7b/i,     minRamGb: 10, minVramGb: 6,  workloadTags: ['general', 'code'] },
  { pattern: /codestral/i,       minRamGb: 16, minVramGb: 8,  workloadTags: ['code'] },
  { pattern: /llava/i,           minRamGb: 12, minVramGb: 8,  workloadTags: ['vision', 'general'] },
];

// ── Hardware inference from parameter count ────────────────────────────────────

function extractParamBillions(name: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)\s*[bB](?!\w)/i.exec(name);
  if (!match || !match[1]) return undefined;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) && val > 0 && val < 10_000 ? val : undefined;
}

function inferVramGb(paramB: number): number {
  // 4-bit quantization: ~0.55 GB/B param + 1.5 GB overhead, rounded up
  return Math.max(2, Math.ceil(paramB * 0.55 + 1.5));
}

function inferRamGb(paramB: number): number {
  // CPU-only needs slightly more due to K/V cache overhead
  return Math.max(4, Math.ceil(paramB * 0.65 + 2));
}

// ── Workload tag inference from model name ─────────────────────────────────────

function inferWorkloadTags(name: string): LocalRecommendationWorkloadTag[] {
  const lower = name.toLowerCase();
  const tags: LocalRecommendationWorkloadTag[] = [];
  if (/code|coder|coding|starcoder|devstral|deepseek-coder|codestral/.test(lower)) tags.push('code');
  if (/vision|visual|\bvl\b|image|multimodal|llava|bakllava|moondream/.test(lower)) tags.push('vision');
  if (/reason|think|\br1\b|math/.test(lower)) tags.push('reasoning');
  if (tags.length === 0) tags.push('general');
  return tags;
}

// ── Candidate builder ──────────────────────────────────────────────────────────

function buildCandidate(
  modelFamily: string,
  recommendedTag: string,
  installHint: string,
  releaseWeight: number,
): ReleaseAwareLocalCandidate {
  const hint = METADATA_HINTS.find(h => h.pattern.test(modelFamily) || h.pattern.test(recommendedTag));
  const paramB = extractParamBillions(modelFamily) ?? extractParamBillions(recommendedTag);

  const minVramGb = hint?.minVramGb ?? (paramB !== undefined ? inferVramGb(paramB) : undefined);
  const minRamGb  = hint?.minRamGb  ?? (paramB !== undefined ? inferRamGb(paramB)  : 8);
  const workloadTags = hint?.workloadTags ?? inferWorkloadTags(modelFamily);

  return {
    modelFamily,
    recommendedTag,
    installHint,
    minRamGb,
    ...(minVramGb !== undefined ? { minVramGb } : {}),
    releaseWeight: Math.max(1, Math.min(10, releaseWeight)),
    workloadTags,
  };
}

function releaseWeightFromRank(rank: number, total: number): number {
  // Top-ranked model → 10, last → 1, linear interpolation
  if (total <= 1) return 10;
  return Math.max(1, Math.round(10 - (rank / (total - 1)) * 9));
}

// ── Ollama source (ollamadb.dev) ───────────────────────────────────────────────

async function fetchOllamaLibraryCandidates(
  signal: AbortSignal,
): Promise<ReleaseAwareLocalCandidate[]> {
  const response = await fetch(OLLAMADB_URL, {
    headers: { 'User-Agent': 'AtlasMind-VSCode-Extension', Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return [];

  const raw = await response.json() as unknown;
  const items = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)['models'];
  if (!Array.isArray(items)) return [];

  const valid = items
    .filter(item => typeof item === 'object' && item !== null)
    .map(item => item as Record<string, unknown>);

  return valid
    .map((item, rank) => {
      const identifier = typeof item['model_identifier'] === 'string' ? item['model_identifier'].trim() : '';
      const rawName    = typeof item['model_name']       === 'string' ? item['model_name'].trim()       : '';
      if (!identifier && !rawName) return undefined;

      const tag  = identifier || rawName;
      const name = formatOllamaModelFamily(rawName || identifier);
      const weight = releaseWeightFromRank(rank, valid.length);

      return buildCandidate(name, tag, `Ollama: ollama pull ${tag}`, weight);
    })
    .filter((c): c is ReleaseAwareLocalCandidate => c !== undefined);
}

function formatOllamaModelFamily(raw: string): string {
  // "qwen3:14b" → "Qwen3 14B", "llama3.3:70b" → "Llama 3.3 70B"
  const base = raw.split(':')[0] ?? raw;
  return base
    .replace(/[._-]/g, ' ')
    .replace(/\b(\d)/g, ' $1')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── LM Studio / HuggingFace source ────────────────────────────────────────────

async function fetchHuggingFaceGgufCandidates(
  signal: AbortSignal,
): Promise<ReleaseAwareLocalCandidate[]> {
  const response = await fetch(HUGGINGFACE_URL, {
    headers: { 'User-Agent': 'AtlasMind-VSCode-Extension', Accept: 'application/json' },
    signal,
  });
  if (!response.ok) return [];

  const raw = await response.json() as unknown;
  if (!Array.isArray(raw)) return [];

  const items = raw
    .filter(item => typeof item === 'object' && item !== null)
    .map(item => item as Record<string, unknown>);

  return items
    .map((item, rank) => {
      const id = typeof item['id'] === 'string' ? item['id'].trim() : '';
      if (!id) return undefined;

      const modelName = extractHfModelName(id);
      const weight    = releaseWeightFromRank(rank, items.length);

      return buildCandidate(
        modelName,
        `hf:${id}`,
        `LM Studio: open Discover tab and search for "${modelName}"`,
        weight,
      );
    })
    .filter((c): c is ReleaseAwareLocalCandidate => c !== undefined);
}

function extractHfModelName(hfId: string): string {
  // "bartowski/Qwen3-14B-GGUF" → "Qwen3 14B"
  const repo = hfId.split('/')[1] ?? hfId;
  return repo
    .replace(/[-_]gguf$/i, '')
    .replace(/[-_]instruct$/i, '')
    .replace(/[-_]chat$/i, '')
    .replace(/[-_]it$/i, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Merge & deduplicate ────────────────────────────────────────────────────────

function mergeAndDeduplicate(
  ollama: ReleaseAwareLocalCandidate[],
  hf: ReleaseAwareLocalCandidate[],
): ReleaseAwareLocalCandidate[] {
  const seen = new Set<string>();
  const result: ReleaseAwareLocalCandidate[] = [];

  for (const candidate of [...ollama, ...hf]) {
    const key = normalizeKey(candidate.modelFamily);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }

  return result
    .sort((a, b) => b.releaseWeight - a.releaseWeight)
    .slice(0, 20);
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Bundled fallback (data/local-model-catalog.json) ──────────────────────────

function loadBundledCatalog(extensionPath: string): ReleaseAwareLocalCandidate[] {
  try {
    const catalogPath = path.join(extensionPath, 'data', 'local-model-catalog.json');
    const raw = fs.readFileSync(catalogPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => typeof item === 'object' && item !== null)
      .map(item => {
        const record = item as Record<string, unknown>;
        const modelFamily    = typeof record['modelFamily']    === 'string' ? record['modelFamily'].trim()    : '';
        const recommendedTag = typeof record['recommendedTag'] === 'string' ? record['recommendedTag'].trim() : '';
        const installHint    = typeof record['installHint']    === 'string' ? record['installHint'].trim()    : '';
        const minRamGb       = typeof record['minRamGb']       === 'number' ? record['minRamGb']              : 8;
        const releaseWeight  = typeof record['releaseWeight']  === 'number' ? record['releaseWeight']         : 5;
        const minVramGb      = typeof record['minVramGb']      === 'number' ? record['minVramGb']             : undefined;
        const rawTags        = Array.isArray(record['workloadTags']) ? record['workloadTags'] : [];
        const workloadTags   = rawTags
          .filter((t): t is string => typeof t === 'string')
          .filter((t): t is LocalRecommendationWorkloadTag => WORKLOAD_TAG_SET.has(t as LocalRecommendationWorkloadTag));

        if (!modelFamily || !recommendedTag || !installHint) return undefined;
        return {
          modelFamily, recommendedTag, installHint,
          minRamGb: Math.max(1, minRamGb),
          ...(minVramGb !== undefined ? { minVramGb: Math.max(1, minVramGb) } : {}),
          releaseWeight: Math.max(1, Math.min(10, releaseWeight)),
          workloadTags: workloadTags.length > 0 ? workloadTags : ['general' as const],
        } satisfies ReleaseAwareLocalCandidate;
      })
      .filter((c): c is ReleaseAwareLocalCandidate => c !== undefined);
  } catch {
    return [];
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

interface CatalogCache {
  candidates: ReleaseAwareLocalCandidate[];
  fetchedAt: string;
  source: 'live' | 'bundled';
}

/**
 * Sync the local-model catalog from live APIs (Ollama library + HuggingFace).
 * Falls back to the bundled catalog if both APIs are unreachable.
 * No-ops if the cached copy is still within the 24-hour TTL.
 */
export async function syncLocalModelCatalog(
  globalState: vscode.Memento,
  extensionPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const cached = globalState.get<CatalogCache>(LOCAL_MODEL_CATALOG_CACHE_KEY);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < LOCAL_MODEL_CATALOG_CACHE_TTL_MS) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const fetchSignal = signal ?? controller.signal;

  try {
    const [ollama, hf] = await Promise.allSettled([
      fetchOllamaLibraryCandidates(fetchSignal),
      fetchHuggingFaceGgufCandidates(fetchSignal),
    ]);

    const ollamaResults = ollama.status === 'fulfilled' ? ollama.value : [];
    const hfResults     = hf.status     === 'fulfilled' ? hf.value     : [];
    const merged        = mergeAndDeduplicate(ollamaResults, hfResults);

    if (merged.length >= 3) {
      await globalState.update(LOCAL_MODEL_CATALOG_CACHE_KEY, {
        candidates: merged,
        fetchedAt: new Date().toISOString(),
        source: 'live',
      } satisfies CatalogCache);
      return;
    }
  } catch {
    // Both APIs failed — fall through to bundled catalog.
  } finally {
    clearTimeout(timeout);
  }

  // Live APIs returned too few results or failed — use bundled catalog.
  const bundled = loadBundledCatalog(extensionPath);
  if (bundled.length > 0) {
    await globalState.update(LOCAL_MODEL_CATALOG_CACHE_KEY, {
      candidates: bundled,
      fetchedAt: new Date().toISOString(),
      source: 'bundled',
    } satisfies CatalogCache);
  }
}

/**
 * Return the cached catalog (live or bundled), or `undefined` if no sync has
 * completed yet (e.g. very first launch with no network access and cache miss).
 */
export function getCachedLocalModelCatalog(
  globalState: vscode.Memento,
): ReadonlyArray<ReleaseAwareLocalCandidate> | undefined {
  const cached = globalState.get<CatalogCache>(LOCAL_MODEL_CATALOG_CACHE_KEY);
  if (!cached || !Array.isArray(cached.candidates) || cached.candidates.length === 0) {
    return undefined;
  }
  return cached.candidates;
}

/** ISO timestamp of the last successful sync, or undefined. */
export function getLocalModelCatalogSyncAge(
  globalState: vscode.Memento,
): string | undefined {
  return globalState.get<CatalogCache>(LOCAL_MODEL_CATALOG_CACHE_KEY)?.fetchedAt;
}

/** Source of the current cache: 'live' (from APIs) or 'bundled' (fallback). */
export function getLocalModelCatalogSource(
  globalState: vscode.Memento,
): 'live' | 'bundled' | undefined {
  return globalState.get<CatalogCache>(LOCAL_MODEL_CATALOG_CACHE_KEY)?.source;
}

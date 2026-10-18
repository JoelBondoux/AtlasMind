import type { ModelInfo } from '../types.js';
import { LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW } from '../constants.js';
import { classifyModelRole } from './modelRole.js';
import type { LocalEndpointRuntime } from './localRuntimeClient.js';
import { createUnslothStudioClient, type UnslothStudioClientDeps } from './unslothStudio.js';

export const LOCAL_MODEL_SYNC_CACHE_KEY = 'atlasmind.localModelSync';
export const LOCAL_MODEL_SYNC_STALE_MS = 60 * 60 * 1000; // 1 hour

export interface LocalModelMeta {
  id: string;
  name: string;
  runtime: LocalEndpointRuntime;
  contextWindow: number;
  capabilities: ModelInfo['capabilities'];
  parametersBillions?: number;
  quantisation?: string;
  /**
   * Whether the runtime holds it in memory right now. Only Unsloth Studio
   * reports downloaded and loaded separately; absent means "not reported",
   * never "not loaded".
   */
  loaded?: boolean;
  /** Bytes on disk, where the runtime says. */
  sizeBytes?: number;
  /** A download that was interrupted: on disk, not loadable. */
  partial?: boolean;
}

/** Where AtlasMind reaches a configured Unsloth Studio, and with which key. */
export interface UnslothSyncTarget {
  /** The endpoint's origin, e.g. `http://127.0.0.1:8888` — not the `/v1` base. */
  origin: string;
  getApiKey: UnslothStudioClientDeps['getApiKey'];
  fetch?: UnslothStudioClientDeps['fetch'];
}

export interface LocalModelSyncResult {
  models: LocalModelMeta[];
  syncedAt: string;
  reachableEndpoints: string[];
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Infer capabilities from a local model's name and parameter count.
 *
 * Prefer manifest-derived capability data (from Ollama /api/show) when
 * available; this heuristic is the fallback for models that don't expose
 * structured capability metadata.  Keep the patterns broad and err on the
 * side of inclusion — a false-positive capability is less harmful than a
 * false-negative that causes the router to exclude a capable model.
 *
 * Calibration date: 2026-06-08 — revisit when new naming conventions emerge.
 *
 * The inclusion bias below is right for grading a chat model and wrong for
 * deciding whether something is one: a guard, embedding or reranker model given
 * a false-positive `chat` is not over-graded, it is unusable, and it is free, so
 * the router prefers it under exactly the conditions where nothing else is
 * working. Role is therefore settled first and separately, in
 * `modelRole.ts`, where the bias runs the other way.
 */
function inferLocalCapabilities(
  modelName: string,
  parametersBillions?: number,
): ModelInfo['capabilities'] {
  if (!classifyModelRole(modelName).conversational) {
    return [];
  }
  const n = modelName.toLowerCase();

  // Parameter-count thresholds: tiny (<4B) usually lacks tool-calling;
  // large (≥65B) models are typically reasoning-capable even without a name hint.
  const isTiny = parametersBillions !== undefined && parametersBillions < 4;
  const isLarge = parametersBillions !== undefined && parametersBillions >= 65;

  // Reasoning detection: explicit markers OR large model OR model families
  // known to use extended chain-of-thought internally.
  const isReasoning =
    isLarge ||
    /\br1\b/.test(n) ||
    n.includes('reason') ||
    n.includes('thinking') ||
    n.includes('thinker') ||
    /\bqwen3\b/.test(n) ||
    /\bqwen[4-9]\b/.test(n) ||
    /\bqwq\b/.test(n) ||
    n.includes('deepseek-r') ||
    n.includes('marco-o') ||
    n.includes('-cot') ||
    n.includes('skywork-o');

  // Extended-thinking: models with visible scratchpad (typically budget_tokens API).
  const isExtendedThinking =
    n.includes('thinking') ||
    n.includes('thinker') ||
    /\bqwq\b/.test(n) ||
    n.includes('deepseek-r');

  // Vision/multimodal detection.
  const isVision =
    n.includes('vision') ||
    n.includes('vl') ||
    n.includes('llava') ||
    n.includes('minicpm-v') ||
    n.includes('moondream') ||
    n.includes('bakllava') ||
    n.includes('cogvlm') ||
    n.includes('internvl') ||
    n.includes('pixtral') ||
    n.includes('florence') ||
    n.includes('qwen-vl') ||
    n.includes('qvq') ||
    (n.includes('gemma') && /\b(4b|12b|27b)\b/.test(n)) ||
    (n.includes('llama') && n.includes('multimodal'));

  // Tool/function calling detection: exclude tiny models unless they explicitly
  // declare tool support via name.
  const hasToolCalling =
    !isTiny ||
    n.includes('coder') ||
    n.includes('instruct') ||
    n.includes('devstral') ||
    n.includes('mistral') ||
    n.includes('qwen') ||
    n.includes('llama') ||
    n.includes('command') ||
    n.includes('nemotron') ||
    n.includes('hermes') ||
    n.includes('nous') ||
    n.includes('functionary') ||
    n.includes('toolllm') ||
    n.includes('gorilla');

  const caps: ModelInfo['capabilities'] = ['chat', 'code'];
  if (hasToolCalling) caps.push('function_calling');
  if (isVision) caps.push('vision');
  if (isReasoning) caps.push('reasoning');
  if (isExtendedThinking) caps.push('extended_thinking');
  return caps;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; model: string }>;
}

interface OllamaShowResponse {
  modelfile?: string;
  model_info?: Record<string, unknown>;
  details?: { parameter_size?: string; quantization_level?: string };
}

async function syncOllama(baseUrl: string): Promise<LocalModelMeta[]> {
  const tagsRes = await fetchWithTimeout(`${baseUrl}/api/tags`);
  if (!tagsRes.ok) return [];
  const tagsData = (await tagsRes.json()) as OllamaTagsResponse;
  const modelList = tagsData.models ?? [];

  const results: LocalModelMeta[] = [];
  await Promise.all(
    modelList.map(async entry => {
      const id = entry.name ?? entry.model;
      if (!id) return;
      let contextWindow = LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW;
      let parametersBillions: number | undefined;
      let quantisation: string | undefined;

      try {
        const showRes = await fetchWithTimeout(`${baseUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: id }),
        });
        if (showRes.ok) {
          const detail = (await showRes.json()) as OllamaShowResponse;

          // Extract context length from model_info (various llama.cpp key names)
          if (detail.model_info) {
            for (const [key, val] of Object.entries(detail.model_info)) {
              if (key.includes('context_length') && typeof val === 'number') {
                contextWindow = val;
                break;
              }
            }
          }

          // Fall back to modelfile NUM_CTX
          if (contextWindow === LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW && detail.modelfile) {
            const match = /^NUM_CTX\s+(\d+)/m.exec(detail.modelfile);
            if (match) contextWindow = parseInt(match[1], 10);
          }

          if (detail.details?.parameter_size) {
            const ps = detail.details.parameter_size.toUpperCase();
            const m = /(\d+(?:\.\d+)?)[BM]/.exec(ps);
            if (m) {
              parametersBillions = ps.includes('M')
                ? parseFloat(m[1]) / 1000
                : parseFloat(m[1]);
            }
          }

          quantisation = detail.details?.quantization_level;
        }
      } catch {
        // best-effort per-model detail
      }

      const shortName = id.split(':')[0] ?? id;
      results.push({
        id,
        name: shortName,
        runtime: 'ollama',
        contextWindow,
        capabilities: inferLocalCapabilities(id, parametersBillions),
        parametersBillions,
        quantisation,
      });
    }),
  );
  return results;
}

interface LmStudioModel {
  id: string;
  object?: string;
}

interface LmStudioListResponse {
  data?: LmStudioModel[];
}

async function syncLmStudio(baseUrl: string): Promise<LocalModelMeta[]> {
  const res = await fetchWithTimeout(`${baseUrl}/v1/models`);
  if (!res.ok) return [];
  const data = (await res.json()) as LmStudioListResponse;
  return (data.data ?? []).map(m => ({
    id: m.id,
    name: m.id.split('/').pop() ?? m.id,
    runtime: 'lmstudio',
    contextWindow: LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW,
    capabilities: inferLocalCapabilities(m.id),
  }));
}

/**
 * What Unsloth Studio has downloaded, marked with what it has loaded.
 *
 * "Installed" for Studio means *on disk*, which is what `/api/models/cached-gguf`
 * lists, keyed by Hugging Face repository id — the id a load, a quant listing
 * and a delete all take. Whether each one is loaded comes from
 * `/api/inference/status`, matched by repository id with or without a `:quant`
 * suffix; a status that could not be read leaves `loaded` absent rather than
 * claiming nothing is loaded.
 *
 * Studio is reached only when an Unsloth endpoint is configured with a key —
 * unlike Ollama and LM Studio, nothing probes its default port speculatively,
 * because the request that would answer the question needs a credential.
 */
export async function syncUnsloth(target: UnslothSyncTarget): Promise<LocalModelMeta[]> {
  const studio = createUnslothStudioClient(target.origin, {
    getApiKey: target.getApiKey,
    ...(target.fetch ? { fetch: target.fetch } : {}),
  });
  const [downloaded, status] = await Promise.all([studio.listDownloaded(), studio.status()]);
  if (!downloaded.ok) { return []; }
  const loadedIds = status.ok
    ? [...status.value.loaded, ...status.value.serving].map(id => id.toLowerCase())
    : undefined;
  return downloaded.value.map(model => {
    const key = model.repoId.toLowerCase();
    const loaded = loadedIds?.some(id => id === key || id.startsWith(`${key}:`));
    const capabilities = inferLocalCapabilities(model.repoId);
    if (model.hasVision && capabilities.length > 0 && !capabilities.includes('vision')) {
      capabilities.push('vision');
    }
    return {
      id: model.repoId,
      name: model.repoId.split('/').pop() ?? model.repoId,
      runtime: 'unsloth' as const,
      contextWindow: LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW,
      capabilities,
      ...(loaded !== undefined ? { loaded } : {}),
      ...(model.sizeBytes !== undefined ? { sizeBytes: model.sizeBytes } : {}),
      ...(model.partial ? { partial: true } : {}),
    };
  });
}

export async function syncLocalModels(
  ollamaBaseUrl = 'http://localhost:11434',
  lmStudioBaseUrl = 'http://localhost:1234',
  unsloth?: UnslothSyncTarget,
): Promise<LocalModelSyncResult> {
  const reachableEndpoints: string[] = [];
  const allModels: LocalModelMeta[] = [];

  const [ollamaModels, lmModels, unslothModels] = await Promise.allSettled([
    syncOllama(ollamaBaseUrl),
    syncLmStudio(lmStudioBaseUrl),
    unsloth ? syncUnsloth(unsloth) : Promise.resolve([]),
  ]);

  if (ollamaModels.status === 'fulfilled' && ollamaModels.value.length > 0) {
    reachableEndpoints.push(ollamaBaseUrl);
    allModels.push(...ollamaModels.value);
  }
  if (lmModels.status === 'fulfilled' && lmModels.value.length > 0) {
    reachableEndpoints.push(lmStudioBaseUrl);
    allModels.push(...lmModels.value);
  }
  if (unsloth && unslothModels.status === 'fulfilled' && unslothModels.value.length > 0) {
    reachableEndpoints.push(unsloth.origin);
    allModels.push(...unslothModels.value);
  }

  return { models: allModels, syncedAt: new Date().toISOString(), reachableEndpoints };
}

export function isLocalSyncStale(result: LocalModelSyncResult): boolean {
  return Date.now() - new Date(result.syncedAt).getTime() > LOCAL_MODEL_SYNC_STALE_MS;
}

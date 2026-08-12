/**
 * What a local runtime currently holds in VRAM, asked in its own native API.
 *
 * Deliberately separate from `LocalEchoAdapter`, which speaks the OpenAI-
 * compatible dialect both runtimes also expose. Residency is not an OpenAI
 * concept: there is no `/v1/` endpoint that answers "what is loaded right now",
 * and the two runtimes answer it in different shapes on different paths.
 *
 * **The configured base URL is the OpenAI base, and these endpoints are its
 * siblings, not its children.** A configured `http://127.0.0.1:11434/v1`
 * resolves to `http://127.0.0.1:11434/api/ps` — derived from the *origin*, never
 * by appending. Getting this wrong yields a 404 that looks exactly like "the
 * runtime is not running", which the degradation path would swallow silently,
 * leaving the arbiter permanently blind and permanently claiming everything is
 * fine. Pinned by test for both runtimes.
 *
 * **Ollama reports exact VRAM; LM Studio reports only presence.** `/api/ps`
 * carries `size_vram`, the actual resident bytes — ground truth, and the source
 * every calibration here is built on. LM Studio's `/api/v1/models` carries
 * `loaded_instances` and a `size_bytes` that is the *on-disk* blob, so presence
 * is certain and footprint is an estimate. The asymmetry is real and is carried
 * in the return type rather than papered over: `vramBytes` is optional, and a
 * caller that treats absent as zero would under-count a whole runtime.
 *
 * **`size_vram < size` means a partial CPU offload** — the model is slow but
 * cheap in VRAM — and `size_vram === 0` means it is running entirely on the CPU
 * and costs no VRAM at all. Both are reported as found. Charging such a model
 * its full estimated footprint would reserve gigabytes that are not in use.
 *
 * Untrusted boundary: every response is third-party JSON from a process this
 * extension did not write. Nothing here throws — an unreachable runtime, a
 * changed schema and a 404 all degrade to "nothing known", because a residency
 * probe that throws would take out the poll that is the arbiter's only source of
 * truth.
 *
 * Transport is injected, so this is unit-tested without a running runtime.
 */

/** Which native API a local endpoint speaks. */
export type LocalRuntimeKind = 'ollama' | 'lmstudio' | 'unknown';

/** One model a runtime reports as currently loaded. */
export interface ResidentModel {
  /** The runtime's own id for the model, as it would be sent in a request. */
  modelKey: string;
  /**
   * Resident VRAM in bytes. `undefined` where the runtime does not report it
   * (LM Studio) — never conflate with `0`, which means "loaded, on the CPU".
   */
  vramBytes?: number;
  /** Total model size where reported, for spotting a partial CPU offload. */
  totalBytes?: number;
  /** LM Studio instance handle, required to unload a specific instance. */
  instanceId?: string;
  /** When the runtime intends to evict it, where it says so (Ollama). */
  expiresAtMs?: number;
}

/** The outcome of a residency probe. */
export interface ResidencyReading {
  kind: LocalRuntimeKind;
  /** Empty when the runtime answered and holds nothing. */
  models: ResidentModel[];
  /**
   * Whether the runtime answered at all. `false` means "no information", which
   * is not the same as "nothing is loaded" — the arbiter must not conclude the
   * GPU is free because a runtime is down.
   */
  reachable: boolean;
}

/** Minimal `fetch`, injected so tests need no running runtime. */
export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface LocalRuntimeClient {
  readonly kind: LocalRuntimeKind;
  readonly origin: string;
  listResident(signal?: AbortSignal): Promise<ResidencyReading>;
  /**
   * Ask the runtime to release a model.
   *
   * Returns whether the runtime confirmed it. Never throws: an unload that
   * failed is a fact the caller re-checks by polling, not an exception that
   * should abort an admission.
   */
  unload(model: ResidentModel, signal?: AbortSignal): Promise<boolean>;
}

/**
 * Which runtime a base URL belongs to.
 *
 * Port-based, matching `inferLocalEndpointLabel` in `registry.ts` — 11434 is
 * Ollama's published default and 1234 is LM Studio's. An unrecognised port is
 * `unknown` rather than a guess: probing a stranger's HTTP server with an
 * Ollama-shaped request is not something to do speculatively, and an unknown
 * runtime simply contributes no residency information.
 */
export function detectRuntimeKind(baseUrl: string): LocalRuntimeKind {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return 'unknown';
  }
  if (parsed.port === '11434') { return 'ollama'; }
  if (parsed.port === '1234') { return 'lmstudio'; }
  return 'unknown';
}

/**
 * The scheme+host+port of a configured base URL.
 *
 * `http://127.0.0.1:11434/v1` → `http://127.0.0.1:11434`. The native APIs live
 * beside `/v1`, not under it.
 */
export function runtimeOrigin(baseUrl: string): string | undefined {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
}

const PROBE_TIMEOUT_MS = 4_000;

async function readJson(
  fetchLike: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout },
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = timers.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchLike(url, { ...init, signal: init?.signal ?? controller.signal });
    if (!response.ok) { return undefined; }
    return await response.json();
  } catch {
    return undefined;
  } finally {
    timers.clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export interface RuntimeClientDeps {
  fetch?: FetchLike;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
}

function resolveDeps(deps?: RuntimeClientDeps) {
  return {
    fetchLike: deps?.fetch ?? (globalThis.fetch as unknown as FetchLike),
    timers: deps?.timers ?? { setTimeout, clearTimeout },
  };
}

/**
 * Ollama: `GET /api/ps`, and unload via `POST /api/chat` with `keep_alive: 0`.
 *
 * There is no dedicated unload endpoint; an empty-message chat with a zero
 * keep-alive is the documented mechanism, and the runtime answers
 * `done_reason: "unload"`. Note this is `/api/chat`, **not** the OpenAI
 * `/v1/chat/completions` the adapter uses — a different path with a different
 * body schema, which is why it does not go through `LocalEchoAdapter`.
 */
export function createOllamaRuntimeClient(origin: string, deps?: RuntimeClientDeps): LocalRuntimeClient {
  const { fetchLike, timers } = resolveDeps(deps);
  return {
    kind: 'ollama',
    origin,
    async listResident(signal) {
      const payload = await readJson(fetchLike, `${origin}/api/ps`, { method: 'GET', ...(signal ? { signal } : {}) }, timers);
      const record = asRecord(payload);
      if (!record || !Array.isArray(record['models'])) {
        return { kind: 'ollama', models: [], reachable: record !== undefined };
      }
      const models: ResidentModel[] = [];
      for (const entry of record['models']) {
        const model = asRecord(entry);
        if (!model) { continue; }
        const modelKey = nonEmptyString(model['model']) ?? nonEmptyString(model['name']);
        if (!modelKey) { continue; }
        const expiresAt = nonEmptyString(model['expires_at']);
        const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
        models.push({
          modelKey,
          ...(finitePositive(model['size_vram']) !== undefined ? { vramBytes: finitePositive(model['size_vram'])! } : {}),
          ...(finitePositive(model['size']) !== undefined ? { totalBytes: finitePositive(model['size'])! } : {}),
          ...(Number.isFinite(expiresAtMs) ? { expiresAtMs } : {}),
        });
      }
      return { kind: 'ollama', models, reachable: true };
    },
    async unload(model, signal) {
      const payload = await readJson(fetchLike, `${origin}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.modelKey, messages: [], keep_alive: 0 }),
        ...(signal ? { signal } : {}),
      }, timers);
      const record = asRecord(payload);
      return record?.['done_reason'] === 'unload';
    },
  };
}

/**
 * LM Studio: `GET /api/v1/models`, unload via `POST /api/v1/models/unload`.
 *
 * A model is resident when `loaded_instances` is non-empty. `size_bytes` is the
 * on-disk blob rather than resident VRAM, so it is reported as `totalBytes` and
 * never as `vramBytes` — the distinction the arbiter needs in order to know
 * which figures it may trust.
 *
 * `/api/v1/models` is a different endpoint from the OpenAI `GET /v1/models`,
 * and from the legacy `/api/v0/models`, which reports a `state` string but no
 * instance handle to unload with.
 */
export function createLmStudioRuntimeClient(origin: string, deps?: RuntimeClientDeps): LocalRuntimeClient {
  const { fetchLike, timers } = resolveDeps(deps);
  return {
    kind: 'lmstudio',
    origin,
    async listResident(signal) {
      const payload = await readJson(fetchLike, `${origin}/api/v1/models`, { method: 'GET', ...(signal ? { signal } : {}) }, timers);
      const record = asRecord(payload);
      if (!record || !Array.isArray(record['models'])) {
        return { kind: 'lmstudio', models: [], reachable: record !== undefined };
      }
      const models: ResidentModel[] = [];
      for (const entry of record['models']) {
        const model = asRecord(entry);
        if (!model) { continue; }
        const modelKey = nonEmptyString(model['key']);
        const instances = model['loaded_instances'];
        if (!modelKey || !Array.isArray(instances) || instances.length === 0) { continue; }
        const instanceId = nonEmptyString(asRecord(instances[0])?.['id']) ?? modelKey;
        models.push({
          modelKey,
          instanceId,
          ...(finitePositive(model['size_bytes']) !== undefined ? { totalBytes: finitePositive(model['size_bytes'])! } : {}),
        });
      }
      return { kind: 'lmstudio', models, reachable: true };
    },
    async unload(model, signal) {
      const instanceId = model.instanceId ?? model.modelKey;
      const payload = await readJson(fetchLike, `${origin}/api/v1/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: instanceId }),
        ...(signal ? { signal } : {}),
      }, timers);
      const record = asRecord(payload);
      // The runtime echoes the instance it unloaded. Anything else — including a
      // silent 200 with no body — is not a confirmation.
      return nonEmptyString(record?.['instance_id']) !== undefined;
    },
  };
}

/**
 * Build the right client for a configured endpoint, or nothing.
 *
 * `undefined` for an unrecognised runtime is deliberate: the arbiter then has no
 * residency information for that endpoint, which it reports as unknown rather
 * than as empty.
 */
export function createRuntimeClientForEndpoint(baseUrl: string, deps?: RuntimeClientDeps): LocalRuntimeClient | undefined {
  const origin = runtimeOrigin(baseUrl);
  if (!origin) { return undefined; }
  switch (detectRuntimeKind(baseUrl)) {
    case 'ollama': return createOllamaRuntimeClient(origin, deps);
    case 'lmstudio': return createLmStudioRuntimeClient(origin, deps);
    default: return undefined;
  }
}

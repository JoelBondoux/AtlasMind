/**
 * Who gets the GPU, and who waits.
 *
 * AtlasMind can issue a local model call from at least six places that never
 * meet: the scheduler's five-way subtask fan-out, the bootstrapper's four
 * unbounded parallel completions, the skill auto-assigner's unbounded sweep, two
 * background timers, and every ordinary chat turn. None of them knows the
 * others exist, and all of them land on one graphics card.
 *
 * Both runtimes do arbitrate internally — Ollama queues and evicts, LM Studio
 * auto-evicts — but each does so against whatever free memory it sees at that
 * instant, and neither can see the other. Two runtimes on one card is exactly
 * the configuration this was built for. Neither reserves anything for the
 * desktop either, which on the reference machine was already holding 9.2 GB of
 * a 24 GB card with no model loaded at all.
 *
 * Five properties, in the order they matter:
 *
 * **A slot wraps one HTTP call and nothing else.** Not a turn, not a tool loop —
 * a leaf operation that awaits nothing which could itself need a slot. That is
 * what makes deadlock structurally impossible rather than merely unobserved, and
 * it is why the only `acquire` call site is inside the adapter's fetch.
 *
 * **The scarce resource is residency, not requests.** Two calls to a model
 * already in VRAM cost one context cache each, not a second copy of the weights.
 * Charging per request would serialise a same-model fan-out — four bootstrap
 * calls becoming four sequential loads — while still allowing three different
 * models to become resident. So weights are charged once per distinct model with
 * a refcount, and each request charges only its own cache.
 *
 * **Cold loads run one at a time, globally.** Not primarily for memory: it is
 * what makes a load *attributable*. Poll before, poll after, and if a model
 * appeared in between with no other cold load in flight, this arbiter caused it.
 * That is the only mechanism available for telling our models from the user's,
 * because Windows cannot attribute VRAM per process at all.
 *
 * **A wait is bounded, and expiry refuses.** A queued request that never
 * resolves is a wedged editor. On expiry the arbiter throws a typed capacity
 * error and the turn fails over to another provider. The error must be
 * classified as a *deferral* rather than a failure everywhere it is caught:
 * the model was never asked, so recording it as failed would quarantine a
 * working endpoint and teach the router that a good model is unreliable.
 *
 * **Unknown is never unlimited.** With no free-memory reading, the arbiter caps
 * *distinct resident models* rather than concurrency. Capping concurrency alone
 * would not bound anything: Ollama holds a model for five minutes after a
 * request, so three sequential calls to three models leave all three resident.
 *
 * Mirrors `presenceManager`: every dependency injected with a real default,
 * `applyConfig`/`getState`/`onDidChange`/`dispose`, `_disposed` guards on every
 * deferred path, and no `vscode` import.
 */
import {
  computeGpuHeadroom,
  evaluateAdmission,
  selectEvictionVictims,
  type EvictionCandidate,
  type GpuHeadroom,
} from './vramBudget.js';
import type { GpuDevice } from '../providers/gpuProbeParse.js';
import {
  estimateModelFootprint,
  estimateResidentRequestFootprint,
  calibrationFactorFrom,
} from '../providers/localFootprint.js';
import type { LocalRuntimeClient, ResidentModel } from '../providers/localRuntimeClient.js';

/**
 * Thrown when the GPU budget stays committed for longer than a request may wait.
 *
 * Carries a discriminator rather than relying on its message, because the three
 * things that must not happen to it are all decided by message-matching
 * elsewhere: `shouldOpenEndpointCircuit` would quarantine the endpoint for ten
 * minutes, `isTransientProviderError` would retry it against the same committed
 * GPU, and the failover catch would mark the model failed and feed struggle
 * memory. Reword the message and a wording-based guard silently stops working;
 * a class cannot be reworded by accident.
 */
export class LocalGpuCapacityError extends Error {
  /** Discriminator, checked by `isCapacityDeferral`. */
  readonly isLocalGpuCapacityDeferral = true;
  constructor(public readonly rule: string, message: string) {
    super(message);
    this.name = 'LocalGpuCapacityError';
  }
}

/**
 * Whether this error means "the GPU was busy" rather than "the model failed".
 *
 * Structural rather than `instanceof`, so it survives a value crossing a module
 * boundary that bundling duplicated.
 */
export function isCapacityDeferral(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { isLocalGpuCapacityDeferral?: unknown }).isLocalGpuCapacityDeferral === true;
}

/** A granted slot. Releasing is idempotent. */
export interface LocalAdmission {
  readonly rule: string;
  release(): void;
}

export interface AdmissionRequest {
  endpointId: string;
  baseUrl: string;
  /** The runtime's own model id, already decoded from the routed id. */
  modelKey: string;
  /** Routed model id, used for residency reporting to the router. */
  routedModelId?: string;
  contextTokens?: number;
  parametersBillions?: number;
  quantisation?: string;
  sizeBytes?: number;
  signal?: AbortSignal;
}

export interface ArbiterConfig {
  enabled: boolean;
  maxConcurrentRequests: number;
  maxAdmissionWaitMs: number;
  safetyMarginBytes: number;
  reserveBytes: number;
  /** Distinct models AtlasMind may hold per endpoint when memory is unmeasurable. */
  maxOwnedResidentModels: number;
  residencyPollIntervalMs: number;
  /** Whether the arbiter may unload models it loaded to reclaim room. */
  evictOwnModels: boolean;
  /** How long after last serving a model it may be evicted. */
  evictionCooldownMs: number;
}

export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  enabled: true,
  maxConcurrentRequests: 2,
  maxAdmissionWaitMs: 45_000,
  safetyMarginBytes: 2 * 1024 * 1024 * 1024,
  reserveBytes: 3 * 1024 * 1024 * 1024,
  maxOwnedResidentModels: 1,
  residencyPollIntervalMs: 5_000,
  evictOwnModels: true,
  evictionCooldownMs: 30_000,
};

export interface ArbiterState {
  enabled: boolean;
  headroom: GpuHeadroom;
  inFlightRequests: number;
  queuedRequests: number;
  /** Routed model ids currently resident, for the router's affinity term. */
  residentModelIds: ReadonlySet<string>;
  /** Distinct resident models per endpoint id. */
  residentByEndpoint: ReadonlyMap<string, number>;
}

export interface ArbiterTimers {
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ArbiterDeps {
  /** Reads GPU devices. Absent or empty means unmeasurable, never plenty. */
  probeGpu?: () => Promise<GpuDevice[]>;
  /** Runtime client per endpoint id. */
  runtimeClientFor?: (endpointId: string, baseUrl: string) => LocalRuntimeClient | undefined;
  timers?: ArbiterTimers;
  now?: () => number;
  onLog?: (message: string) => void;
}

interface ResidencyEntry {
  endpointId: string;
  modelKey: string;
  routedModelId?: string;
  refcount: number;
  observedVramBytes?: number;
  lastServedAtMs: number;
  /** Whether AtlasMind caused this model to load. Only ours may be evicted. */
  ownedByUs: boolean;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  arrivedAtMs: number;
  settled: boolean;
}

const realTimers: ArbiterTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function residencyKey(endpointId: string, modelKey: string): string {
  return `${endpointId}::${modelKey}`;
}

export class LocalModelArbiter {
  private _config: ArbiterConfig = { ...DEFAULT_ARBITER_CONFIG };
  private _disposed = false;
  private readonly _residency = new Map<string, ResidencyEntry>();
  private readonly _calibration = new Map<string, number>();
  private readonly _queue: Waiter[] = [];
  private readonly _listeners = new Set<(state: ArbiterState) => void>();
  private _inFlight = 0;
  private _coldLoadInFlight = false;
  private _headroom: GpuHeadroom = {
    basis: 'unmeasured', headroomBytes: 0, bindingTerm: 'none', rule: 'not-yet-probed',
  };
  private _lastProbeAtMs = 0;
  private _seededResidency = false;

  private readonly _probeGpu: () => Promise<GpuDevice[]>;
  private readonly _runtimeClientFor: (endpointId: string, baseUrl: string) => LocalRuntimeClient | undefined;
  private readonly _timers: ArbiterTimers;
  private readonly _now: () => number;
  private readonly _log: (message: string) => void;

  constructor(deps?: ArbiterDeps) {
    this._probeGpu = deps?.probeGpu ?? (async () => []);
    this._runtimeClientFor = deps?.runtimeClientFor ?? (() => undefined);
    this._timers = deps?.timers ?? realTimers;
    this._now = deps?.now ?? Date.now;
    this._log = deps?.onLog ?? (() => {});
  }

  applyConfig(config: Partial<ArbiterConfig>): void {
    this._config = { ...this._config, ...config };
    // A raised cap may have made a queued request admissible.
    this._drainQueue();
    this._emit();
  }

  getState(): ArbiterState {
    const residentByEndpoint = new Map<string, number>();
    const residentModelIds = new Set<string>();
    for (const entry of this._residency.values()) {
      residentByEndpoint.set(entry.endpointId, (residentByEndpoint.get(entry.endpointId) ?? 0) + 1);
      if (entry.routedModelId) { residentModelIds.add(entry.routedModelId); }
    }
    return {
      enabled: this._config.enabled,
      headroom: this._headroom,
      inFlightRequests: this._inFlight,
      queuedRequests: this._queue.length,
      residentModelIds,
      residentByEndpoint,
    };
  }

  onDidChange(listener: (state: ArbiterState) => void): { dispose(): void } {
    this._listeners.add(listener);
    return { dispose: () => { this._listeners.delete(listener); } };
  }

  /**
   * Take a slot for one local HTTP call.
   *
   * Resolves when the request may proceed; throws `LocalGpuCapacityError` when
   * the budget stayed committed past `maxAdmissionWaitMs`, or an abort error if
   * the caller cancelled while queued.
   */
  async acquire(request: AdmissionRequest): Promise<LocalAdmission> {
    if (this._disposed || !this._config.enabled) {
      return this._grant('arbiter-disabled', request, false);
    }
    if (request.signal?.aborted) {
      throw new Error('The request was cancelled before it was admitted.');
    }

    await this._refreshIfStale(request);

    for (;;) {
      const decision = this._evaluate(request);
      if (decision.outcome === 'admit') {
        const cold = !this._isResident(request);
        return this._grant(decision.rule, request, cold);
      }
      // Before waiting, see whether releasing our own idle models makes room.
      // Only ever our own — a model the user loaded by hand is theirs.
      if (decision.rule === 'insufficient-headroom' && await this._tryEvictForRoom(request, decision.chargeBytes)) {
        continue;
      }
      // Not admissible now. Wait to be woken by a release, a poll, or the bound.
      await this._waitForCapacity(request, decision.rule);
    }
  }

  dispose(): void {
    this._disposed = true;
    // `waiter.reject` is the settle-wrapped closure, which owns the `settled`
    // flag and the listener/timer teardown. Marking the waiter settled here
    // first would make that closure return early and leave the promise pending
    // forever — a disposal that hangs exactly the requests it is meant to free.
    for (const waiter of this._queue.splice(0)) {
      waiter.reject(new LocalGpuCapacityError(
        'arbiter-disposed',
        'The local GPU arbiter was shut down while this request was queued.',
      ));
    }
    this._listeners.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _isResident(request: AdmissionRequest): boolean {
    return this._residency.has(residencyKey(request.endpointId, request.modelKey));
  }

  private _evaluate(request: AdmissionRequest) {
    const key = residencyKey(request.endpointId, request.modelKey);
    const entry = this._residency.get(key);
    const footprint = estimateModelFootprint({
      ...(request.sizeBytes !== undefined ? { sizeBytes: request.sizeBytes } : {}),
      ...(request.parametersBillions !== undefined ? { parametersBillions: request.parametersBillions } : {}),
      ...(request.quantisation !== undefined ? { quantisation: request.quantisation } : {}),
      ...(request.contextTokens !== undefined ? { contextTokens: request.contextTokens } : {}),
      ...(entry?.observedVramBytes !== undefined ? { observedBytes: entry.observedVramBytes } : {}),
      ...(this._calibration.has(key) ? { calibrationFactor: this._calibration.get(key)! } : {}),
    });
    let ownedHere = 0;
    for (const candidate of this._residency.values()) {
      if (candidate.endpointId === request.endpointId && candidate.ownedByUs) { ownedHere += 1; }
    }

    return evaluateAdmission({
      enabled: this._config.enabled,
      footprintBytes: footprint.totalBytes,
      residentRequestBytes: estimateResidentRequestFootprint({
        ...(request.parametersBillions !== undefined ? { parametersBillions: request.parametersBillions } : {}),
        ...(request.contextTokens !== undefined ? { contextTokens: request.contextTokens } : {}),
      }),
      modelResident: entry !== undefined,
      coldLoadInFlight: this._coldLoadInFlight,
      inFlightRequests: this._inFlight,
      maxConcurrentRequests: this._config.maxConcurrentRequests,
      ownedResidentModels: ownedHere,
      maxOwnedResidentModels: this._config.maxOwnedResidentModels,
      headroom: this._headroom,
    });
  }

  private _grant(rule: string, request: AdmissionRequest, coldLoad: boolean): LocalAdmission {
    this._inFlight += 1;
    if (coldLoad) { this._coldLoadInFlight = true; }
    const key = residencyKey(request.endpointId, request.modelKey);
    const entry = this._residency.get(key);
    if (entry) { entry.refcount += 1; }
    this._emit();

    let released = false;
    return {
      rule,
      release: () => {
        if (released) { return; }
        released = true;
        this._inFlight = Math.max(0, this._inFlight - 1);
        if (coldLoad) { this._coldLoadInFlight = false; }
        const current = this._residency.get(key);
        if (current) {
          current.refcount = Math.max(0, current.refcount - 1);
          current.lastServedAtMs = this._now();
        }
        if (coldLoad) {
          // The load, if it happened, is attributable to this request: nothing
          // else was cold-loading. Reconcile on the next poll.
          void this._refreshResidency(request, true);
        }
        this._drainQueue();
        this._emit();
      },
    };
  }

  /**
   * Unload our own idle models to make room, if that would be enough.
   *
   * Returns whether anything was freed, so the caller re-evaluates rather than
   * assuming success: the runtime confirms each unload and the residency poll,
   * not this method, decides what is actually gone.
   *
   * A plan that would not free enough is **not executed** — unloading two models
   * and still not fitting costs the reload of both and gains nothing.
   */
  private async _tryEvictForRoom(request: AdmissionRequest, neededBytes: number): Promise<boolean> {
    if (this._disposed || !this._config.evictOwnModels) { return false; }
    const client = this._runtimeClientFor(request.endpointId, request.baseUrl);
    if (!client) { return false; }

    const candidates: EvictionCandidate[] = [];
    for (const [key, entry] of this._residency) {
      if (entry.endpointId !== request.endpointId) { continue; }
      candidates.push({
        key,
        modelKey: entry.modelKey,
        ownedByUs: entry.ownedByUs,
        refcount: entry.refcount,
        ...(entry.observedVramBytes !== undefined ? { vramBytes: entry.observedVramBytes } : {}),
        lastServedAtMs: entry.lastServedAtMs,
      });
    }

    const shortfall = Math.max(0, neededBytes - this._headroom.headroomBytes);
    const plan = selectEvictionVictims({
      candidates,
      neededBytes: shortfall,
      nowMs: this._now(),
      cooldownMs: this._config.evictionCooldownMs,
    });
    if (!plan.sufficient || plan.victims.length === 0) { return false; }

    let freedAny = false;
    for (const victim of plan.victims) {
      const released = await client.unload({ modelKey: victim.modelKey });
      if (this._disposed) { return freedAny; }
      if (!released) { continue; }
      freedAny = true;
      this._log(`Unloaded "${victim.modelKey}" to make room (rule ${plan.rule}).`);
      this._residency.delete(victim.key);
    }
    if (freedAny) {
      // Never trust an unload to have taken effect: re-read before admitting.
      await this._refreshResidency(request, false);
    }
    return freedAny;
  }

  private _waitForCapacity(request: AdmissionRequest, rule: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, arrivedAtMs: this._now(), settled: false };
      const settle = (fn: () => void) => {
        if (waiter.settled) { return; }
        waiter.settled = true;
        this._timers.clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        const index = this._queue.indexOf(waiter);
        if (index >= 0) { this._queue.splice(index, 1); }
        fn();
      };

      const onAbort = () => settle(() => reject(new Error('The request was cancelled while waiting for local GPU capacity.')));
      const timer = this._timers.setTimeout(() => settle(() => {
        this._log(`Refused a local request after ${this._config.maxAdmissionWaitMs}ms: ${rule}.`);
        reject(new LocalGpuCapacityError(
          rule,
          `The local GPU budget stayed committed for ${Math.round(this._config.maxAdmissionWaitMs / 1000)}s, so this request was not admitted and nothing was sent to the endpoint.`,
        ));
      }), this._config.maxAdmissionWaitMs);

      waiter.resolve = () => settle(resolve);
      waiter.reject = (error: Error) => settle(() => reject(error));
      request.signal?.addEventListener('abort', onAbort, { once: true });
      this._queue.push(waiter);
      this._emit();
    });
  }

  /**
   * Wake queued requests in arrival order.
   *
   * Strict FIFO: waking the cheapest admissible request would starve the large
   * model indefinitely, and the large model is the one somebody chose for a hard
   * task. Each woken waiter re-evaluates, so waking one that still cannot
   * proceed simply re-queues it.
   */
  private _drainQueue(): void {
    if (this._disposed) { return; }
    const head = this._queue[0];
    if (head && !head.settled) {
      head.resolve();
    }
  }

  private async _refreshIfStale(request: AdmissionRequest): Promise<void> {
    if (this._now() - this._lastProbeAtMs < this._config.residencyPollIntervalMs) { return; }
    await this._refreshResidency(request, false);
  }

  /**
   * Re-read the GPU and the runtime's residency list.
   *
   * `attributeNewLoads` is set only by a released cold-load slot: anything that
   * appeared since is ours, because nothing else was permitted to cold-load. On
   * the first poll of a session everything already resident is marked *theirs*,
   * which is the conservative direction — we lose an eviction opportunity rather
   * than unloading a model somebody else is using.
   */
  private async _refreshResidency(request: AdmissionRequest, attributeNewLoads: boolean): Promise<void> {
    if (this._disposed) { return; }
    this._lastProbeAtMs = this._now();

    let devices: GpuDevice[] = [];
    try {
      devices = await this._probeGpu();
    } catch {
      devices = [];
    }
    if (this._disposed) { return; }

    const client = this._runtimeClientFor(request.endpointId, request.baseUrl);
    let resident: ResidentModel[] | undefined;
    if (client) {
      const reading = await client.listResident();
      // An unreachable runtime yields no information. Clearing residency here
      // would report the GPU as free because a process is down.
      if (reading.reachable) { resident = reading.models; }
    }
    if (this._disposed) { return; }

    if (resident) {
      this._reconcile(request, resident, attributeNewLoads);
    }

    let atlasResident = 0;
    for (const entry of this._residency.values()) {
      if (entry.ownedByUs && entry.observedVramBytes !== undefined) {
        atlasResident += entry.observedVramBytes;
      }
    }
    this._headroom = computeGpuHeadroom({
      devices,
      atlasResidentBytes: atlasResident,
      safetyMarginBytes: this._config.safetyMarginBytes,
      reserveBytes: this._config.reserveBytes,
    });
    this._seededResidency = true;
    this._drainQueue();
    this._emit();
  }

  private _reconcile(request: AdmissionRequest, resident: ResidentModel[], attributeNewLoads: boolean): void {
    const seen = new Set<string>();
    for (const model of resident) {
      const key = residencyKey(request.endpointId, model.modelKey);
      seen.add(key);
      const existing = this._residency.get(key);
      if (existing) {
        if (model.vramBytes !== undefined) { existing.observedVramBytes = model.vramBytes; }
        continue;
      }
      // First sight of this model. It is ours only if we just cold-loaded it and
      // it is the model we asked for; on the session's first poll, nothing is.
      const ownedByUs = attributeNewLoads
        && this._seededResidency
        && model.modelKey === request.modelKey;
      this._residency.set(key, {
        endpointId: request.endpointId,
        modelKey: model.modelKey,
        ...(ownedByUs && request.routedModelId ? { routedModelId: request.routedModelId } : {}),
        refcount: 0,
        lastServedAtMs: this._now(),
        ...(model.vramBytes !== undefined ? { observedVramBytes: model.vramBytes } : {}),
        ownedByUs,
      });
      if (ownedByUs && model.vramBytes !== undefined) {
        this._recordCalibration(key, model.vramBytes, request);
      }
    }

    // Drop entries the runtime no longer reports, but never one still in use:
    // a model can be evicted between our poll and a request that is mid-flight.
    for (const [key, entry] of [...this._residency.entries()]) {
      if (entry.endpointId !== request.endpointId) { continue; }
      if (seen.has(key) || entry.refcount > 0) { continue; }
      this._residency.delete(key);
    }
  }

  private _recordCalibration(key: string, observedBytes: number, request: AdmissionRequest): void {
    const estimate = estimateModelFootprint({
      ...(request.sizeBytes !== undefined ? { sizeBytes: request.sizeBytes } : {}),
      ...(request.parametersBillions !== undefined ? { parametersBillions: request.parametersBillions } : {}),
      ...(request.quantisation !== undefined ? { quantisation: request.quantisation } : {}),
      ...(request.contextTokens !== undefined ? { contextTokens: request.contextTokens } : {}),
    });
    const factor = calibrationFactorFrom(observedBytes, estimate.totalBytes);
    if (factor !== undefined) { this._calibration.set(key, factor); }
  }

  private _emit(): void {
    if (this._disposed || this._listeners.size === 0) { return; }
    const state = this.getState();
    for (const listener of [...this._listeners]) {
      try { listener(state); } catch { /* a listener must not break the arbiter */ }
    }
  }
}

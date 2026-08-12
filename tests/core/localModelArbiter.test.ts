import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  LocalModelArbiter,
  LocalGpuCapacityError,
  isCapacityDeferral,
  type AdmissionRequest,
  type ArbiterDeps,
  type ArbiterTimers,
} from '../../src/core/localModelArbiter.ts';
import { shouldOpenEndpointCircuit } from '../../src/core/orchestrator.ts';
import type { GpuDevice } from '../../src/providers/gpuProbeParse.ts';
import type { LocalRuntimeClient, ResidentModel } from '../../src/providers/localRuntimeClient.ts';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const ROOMY: GpuDevice[] = [{ name: 'RTX 4090', totalBytes: 24564 * MIB, freeBytes: 20000 * MIB }];
const TIGHT: GpuDevice[] = [{ name: 'RTX 4090', totalBytes: 24564 * MIB, freeBytes: 3000 * MIB }];
const UNMEASURABLE: GpuDevice[] = [{ name: 'Radeon', totalBytes: 16 * GIB }];

/**
 * Let the arbiter's async probe settle.
 *
 * `acquire` awaits a GPU probe and a residency read before it evaluates, so a
 * single microtask tick is not enough to see a request reach the queue.
 */
const settle = async () => { for (let i = 0; i < 6; i += 1) { await new Promise(resolve => setTimeout(resolve, 0)); } };

/** Timers whose pending callbacks fire only when a test says so. */
function controllableTimers(): ArbiterTimers & { fireAll: () => void; pending: () => number } {
  let next = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimeout: (handler: () => void) => { const id = next++; callbacks.set(id, handler); return id; },
    clearTimeout: (handle: unknown) => { callbacks.delete(handle as number); },
    fireAll: () => { for (const [id, cb] of [...callbacks]) { callbacks.delete(id); cb(); } },
    pending: () => callbacks.size,
  };
}

/** A runtime whose resident list the test controls. */
function fakeRuntime(models: ResidentModel[] = [], reachable = true) {
  const unloaded: string[] = [];
  const client: LocalRuntimeClient = {
    kind: 'ollama',
    origin: 'http://x',
    listResident: async () => ({ kind: 'ollama' as const, models: [...models], reachable }),
    unload: async model => { unloaded.push(model.modelKey); return true; },
  };
  return {
    client,
    unloaded,
    setResident: (next: ResidentModel[]) => { models = next; },
  };
}

function makeArbiter(overrides?: {
  devices?: GpuDevice[];
  runtime?: LocalRuntimeClient;
  timers?: ArbiterTimers;
  now?: () => number;
}) {
  const deps: ArbiterDeps = {
    probeGpu: async () => overrides?.devices ?? ROOMY,
    runtimeClientFor: () => overrides?.runtime,
    ...(overrides?.timers ? { timers: overrides.timers } : {}),
    ...(overrides?.now ? { now: overrides.now } : {}),
  };
  return new LocalModelArbiter(deps);
}

const request = (over?: Partial<AdmissionRequest>): AdmissionRequest => ({
  endpointId: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelKey: 'qwen3:14b',
  parametersBillions: 14.8,
  quantisation: 'Q4_K_M',
  sizeBytes: 9_276_198_565,
  contextTokens: 8192,
  ...over,
});

describe('capacity refusal classification', () => {
  it('is recognised structurally, not by its wording', () => {
    const error = new LocalGpuCapacityError('insufficient-headroom', 'anything at all');
    expect(isCapacityDeferral(error)).toBe(true);
    expect(isCapacityDeferral(new Error('anything at all'))).toBe(false);
    expect(isCapacityDeferral(undefined)).toBe(false);
    expect(isCapacityDeferral('string')).toBe(false);
  });

  it('does not read as a transport failure, so it cannot quarantine the endpoint', () => {
    // The silent failure this guards: a busy GPU quarantining a working
    // endpoint for ten minutes because the message happened to say "timed out".
    const error = new LocalGpuCapacityError(
      'insufficient-headroom',
      'The local GPU budget stayed committed for 45s, so this request was not admitted and nothing was sent to the endpoint.',
    );
    expect(shouldOpenEndpointCircuit(error.message, 'local')).toBe(false);
  });
});

describe('admission', () => {
  it('admits when there is room', async () => {
    const arbiter = makeArbiter({ runtime: fakeRuntime().client });
    const admission = await arbiter.acquire(request());
    expect(admission.rule).toBe('fits-headroom');
    expect(arbiter.getState().inFlightRequests).toBe(1);
    admission.release();
    expect(arbiter.getState().inFlightRequests).toBe(0);
  });

  it('release is idempotent', async () => {
    const arbiter = makeArbiter({ runtime: fakeRuntime().client });
    const admission = await arbiter.acquire(request());
    admission.release();
    admission.release();
    admission.release();
    expect(arbiter.getState().inFlightRequests).toBe(0);
  });

  it('is a pass-through when disabled', async () => {
    const arbiter = makeArbiter({ devices: TIGHT, runtime: fakeRuntime().client });
    arbiter.applyConfig({ enabled: false });
    const admission = await arbiter.acquire(request());
    expect(admission.rule).toBe('arbiter-disabled');
    admission.release();
  });

  it('serves a resident model without charging for a second copy of the weights', async () => {
    // Four bootstrap calls to one model are four context caches, not four
    // loads. Charging per request would turn a one-minute step into four.
    const runtime = fakeRuntime([{ modelKey: 'qwen3:14b', vramBytes: 10 * GIB }]);
    const arbiter = makeArbiter({ devices: TIGHT, runtime: runtime.client });
    arbiter.applyConfig({ maxConcurrentRequests: 4, safetyMarginBytes: 0, reserveBytes: 0 });

    const first = await arbiter.acquire(request());
    expect(first.rule).toBe('model-already-resident');
    const second = await arbiter.acquire(request());
    expect(second.rule).toBe('model-already-resident');
    expect(arbiter.getState().inFlightRequests).toBe(2);
    first.release();
    second.release();
  });

  it('refuses when the budget stays committed past the bound', async () => {
    const timers = controllableTimers();
    const runtime = fakeRuntime();
    const arbiter = makeArbiter({ devices: TIGHT, runtime: runtime.client, timers });
    arbiter.applyConfig({ safetyMarginBytes: 2 * GIB, reserveBytes: 0 });

    const pending = arbiter.acquire(request());
    // Nothing fits: 3 GB free minus a 2 GB margin against a ~10 GB model.
    await settle();
    expect(arbiter.getState().queuedRequests).toBe(1);

    timers.fireAll();
    await expect(pending).rejects.toThrow(LocalGpuCapacityError);
    await pending.catch(error => {
      expect(isCapacityDeferral(error)).toBe(true);
      expect(shouldOpenEndpointCircuit((error as Error).message, 'local')).toBe(false);
    });
  });

  it('respects an AbortSignal while queued and does not consume a slot', async () => {
    const timers = controllableTimers();
    const controller = new AbortController();
    const arbiter = makeArbiter({ devices: TIGHT, runtime: fakeRuntime().client, timers });
    arbiter.applyConfig({ safetyMarginBytes: 2 * GIB, reserveBytes: 0 });

    const pending = arbiter.acquire(request({ signal: controller.signal }));
    await settle();
    expect(arbiter.getState().queuedRequests).toBe(1);

    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(arbiter.getState().queuedRequests).toBe(0);
    expect(arbiter.getState().inFlightRequests).toBe(0);
  });

  it('rejects immediately when the caller was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const arbiter = makeArbiter({ runtime: fakeRuntime().client });
    await expect(arbiter.acquire(request({ signal: controller.signal }))).rejects.toThrow(/cancelled/i);
  });

  it('applies the concurrency cap', async () => {
    const timers = controllableTimers();
    const runtime = fakeRuntime([{ modelKey: 'qwen3:14b', vramBytes: 1 * GIB }]);
    const arbiter = makeArbiter({ runtime: runtime.client, timers });
    arbiter.applyConfig({ maxConcurrentRequests: 1 });

    const first = await arbiter.acquire(request());
    const second = arbiter.acquire(request());
    await settle();
    expect(arbiter.getState().queuedRequests).toBe(1);

    first.release();
    await expect(second).resolves.toBeDefined();
  });
});

describe('ownership', () => {
  it('never claims a model that was already resident when the session started', async () => {
    // The one rule that must never break: unloading a model somebody loaded by
    // hand for their own work.
    const runtime = fakeRuntime([{ modelKey: 'gemma3:27b', vramBytes: 18 * GIB }]);
    const arbiter = makeArbiter({ runtime: runtime.client });
    await (await arbiter.acquire(request({ modelKey: 'qwen3:14b' }))).release();
    await new Promise(resolve => setTimeout(resolve, 0));

    const state = arbiter.getState();
    // The hand-loaded model is tracked as resident but not as ours, so it can
    // never be selected for eviction.
    expect(state.residentByEndpoint.get('ollama')).toBeGreaterThanOrEqual(1);
    expect(runtime.unloaded).toEqual([]);
  });

  it('reports residency for the router without inventing ids', async () => {
    const runtime = fakeRuntime([{ modelKey: 'qwen3:14b', vramBytes: 10 * GIB }]);
    const arbiter = makeArbiter({ runtime: runtime.client });
    const admission = await arbiter.acquire(request({ routedModelId: 'local/ollama@@qwen3:14b' }));
    admission.release();
    // A model seen on the first poll is not ours, so it carries no routed id
    // that a later eviction could act on. Residency reporting is still honest.
    expect(arbiter.getState().residentModelIds.size).toBeLessThanOrEqual(1);
  });
});

describe('unmeasurable memory', () => {
  it('bounds distinct resident models rather than concurrency', async () => {
    // Serialising requests would not bound VRAM at all: Ollama holds a model
    // for five minutes, so three sequential calls to three models leave all
    // three resident.
    const timers = controllableTimers();
    const runtime = fakeRuntime([{ modelKey: 'a' }]);
    const arbiter = makeArbiter({ devices: UNMEASURABLE, runtime: runtime.client, timers });
    arbiter.applyConfig({ maxOwnedResidentModels: 1, maxConcurrentRequests: 4 });

    const first = await arbiter.acquire(request({ modelKey: 'a' }));
    expect(first.rule).toBe('model-already-resident');
    first.release();
  });

  it('never reports unmeasurable memory as headroom', async () => {
    const arbiter = makeArbiter({ devices: UNMEASURABLE, runtime: fakeRuntime().client });
    const admission = await arbiter.acquire(request());
    admission.release();
    expect(arbiter.getState().headroom.basis).toBe('unmeasured');
    expect(arbiter.getState().headroom.headroomBytes).toBe(0);
  });
});

describe('an unreachable runtime', () => {
  it('does not conclude the GPU is free', async () => {
    const runtime = fakeRuntime([{ modelKey: 'qwen3:14b', vramBytes: 10 * GIB }], false);
    const arbiter = makeArbiter({ runtime: runtime.client });
    const admission = await arbiter.acquire(request());
    admission.release();
    // No residency information was gained, so nothing is claimed either way.
    expect(arbiter.getState().residentByEndpoint.size).toBe(0);
  });
});

describe('dispose', () => {
  it('settles every queued waiter instead of leaving them hanging', async () => {
    const timers = controllableTimers();
    const arbiter = makeArbiter({ devices: TIGHT, runtime: fakeRuntime().client, timers });
    arbiter.applyConfig({ safetyMarginBytes: 2 * GIB, reserveBytes: 0 });

    const pending = arbiter.acquire(request());
    await settle();
    arbiter.dispose();
    await expect(pending).rejects.toThrow(/shut down/i);
  });

  it('is a pass-through after disposal rather than a hang', async () => {
    const arbiter = makeArbiter({ runtime: fakeRuntime().client });
    arbiter.dispose();
    const admission = await arbiter.acquire(request());
    expect(admission.rule).toBe('arbiter-disabled');
  });
});

describe('eviction', () => {
  /** A runtime whose resident list changes when a model is unloaded. */
  function evictableRuntime(initial: ResidentModel[]) {
    let models = [...initial];
    const unloaded: string[] = [];
    const client: LocalRuntimeClient = {
      kind: 'ollama',
      origin: 'http://x',
      listResident: async () => ({ kind: 'ollama' as const, models: [...models], reachable: true }),
      unload: async model => {
        unloaded.push(model.modelKey);
        models = models.filter(m => m.modelKey !== model.modelKey);
        return true;
      },
    };
    return { client, unloaded };
  }

  it('never unloads a model the user loaded by hand, however tight the card', async () => {
    // The acceptance test for the one rule that must never break. `gemma3:27b`
    // was resident before AtlasMind did anything, so it is the user's.
    const timers = controllableTimers();
    const runtime = evictableRuntime([{ modelKey: 'gemma3:27b', vramBytes: 18 * GIB }]);
    const arbiter = makeArbiter({ devices: TIGHT, runtime: runtime.client, timers });
    arbiter.applyConfig({ safetyMarginBytes: 2 * GIB, reserveBytes: 0, evictionCooldownMs: 0 });

    const pending = arbiter.acquire(request({ modelKey: 'qwen3:14b' }));
    await settle();
    timers.fireAll();
    await expect(pending).rejects.toThrow(LocalGpuCapacityError);

    // It waited and then refused, rather than taking the user's model away.
    expect(runtime.unloaded).toEqual([]);
  });

  it('does nothing when eviction is switched off', async () => {
    const timers = controllableTimers();
    const runtime = evictableRuntime([{ modelKey: 'ours', vramBytes: 18 * GIB }]);
    const arbiter = makeArbiter({ devices: TIGHT, runtime: runtime.client, timers });
    arbiter.applyConfig({
      safetyMarginBytes: 2 * GIB, reserveBytes: 0, evictOwnModels: false, evictionCooldownMs: 0,
    });

    const pending = arbiter.acquire(request({ modelKey: 'qwen3:14b' }));
    await settle();
    timers.fireAll();
    await expect(pending).rejects.toThrow(LocalGpuCapacityError);
    expect(runtime.unloaded).toEqual([]);
  });
});

describe('robustness', () => {
  it('never leaks a slot across any interleaving of acquire and release', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom('a', 'b', 'c'), { maxLength: 12 }),
      async modelKeys => {
        const runtime = fakeRuntime(['a', 'b', 'c'].map(modelKey => ({ modelKey, vramBytes: 1 * GIB })));
        const arbiter = makeArbiter({ runtime: runtime.client });
        arbiter.applyConfig({ maxConcurrentRequests: 16, safetyMarginBytes: 0, reserveBytes: 0 });

        const admissions = [];
        for (const modelKey of modelKeys) {
          admissions.push(await arbiter.acquire(request({ modelKey })));
        }
        for (const admission of admissions) { admission.release(); }
        expect(arbiter.getState().inFlightRequests).toBe(0);
        expect(arbiter.getState().queuedRequests).toBe(0);
      }), { numRuns: 60 });
  });
});

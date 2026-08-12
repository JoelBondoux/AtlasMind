import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computeGpuHeadroom,
  evaluateAdmission,
  ADMISSION_RULES,
  selectEvictionVictims,
  type GpuHeadroom,
} from '../../src/core/vramBudget.ts';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** The measured state of the machine this feature was written for. */
const RTX_4090 = {
  name: 'NVIDIA GeForce RTX 4090',
  totalBytes: 24564 * MIB,
  usedBytes: 9432 * MIB,
  freeBytes: 14707 * MIB,
};

describe('computeGpuHeadroom', () => {
  it('measures free memory rather than subtracting what we loaded', () => {
    // 9.4 GB was in use with no model loaded. A budget of "total minus our own
    // loads" would have offered that memory to a model, twice over.
    const headroom = computeGpuHeadroom({
      devices: [RTX_4090],
      atlasResidentBytes: 0,
      safetyMarginBytes: 2 * GIB,
    });
    expect(headroom.basis).toBe('measured');
    expect(headroom.headroomBytes).toBe(14707 * MIB - 2 * GIB);
    expect(headroom.bindingTerm).toBe('measured-free');
  });

  it('shrinks the ceiling as AtlasMind takes more, which the constant form did not', () => {
    // The defect this replaced: `total - reserve` is a constant, so once
    // anything is loaded the measured limb is always lower and the reserve
    // never binds again. Subtracting our own residency keeps it live.
    const withNothingHeld = computeGpuHeadroom({
      devices: [RTX_4090], atlasResidentBytes: 0, safetyMarginBytes: 0, reserveBytes: 10 * GIB,
    });
    const withNineHeld = computeGpuHeadroom({
      devices: [RTX_4090], atlasResidentBytes: 9 * GIB, safetyMarginBytes: 0, reserveBytes: 10 * GIB,
    });
    expect(withNothingHeld.bindingTerm).toBe('atlas-ceiling');
    expect(withNineHeld.headroomBytes).toBe(withNothingHeld.headroomBytes - 9 * GIB);
  });

  it('clamps the ceiling at zero rather than going negative', () => {
    // A reserve larger than what is left is a instruction to stop, not a
    // negative budget that arithmetic downstream would read as room.
    const headroom = computeGpuHeadroom({
      devices: [RTX_4090], atlasResidentBytes: 9 * GIB, safetyMarginBytes: 0, reserveBytes: 20 * GIB,
    });
    expect(headroom.headroomBytes).toBe(0);
    expect(headroom.bindingTerm).toBe('atlas-ceiling');
  });

  it('names which limb bound the answer', () => {
    const measured = computeGpuHeadroom({
      devices: [RTX_4090], atlasResidentBytes: 0, safetyMarginBytes: 2 * GIB, reserveBytes: 1 * GIB,
    });
    expect(measured.bindingTerm).toBe('measured-free');

    // A large reserve makes AtlasMind's own ceiling the binding limb.
    const ceilinged = computeGpuHeadroom({
      devices: [RTX_4090], atlasResidentBytes: 0, safetyMarginBytes: 0, reserveBytes: 20 * GIB,
    });
    expect(ceilinged.bindingTerm).toBe('atlas-ceiling');
    expect(ceilinged.rule).toBe('atlas-share-ceiling');
  });

  it('reports unmeasured rather than a large number when nothing read free memory', () => {
    // The single most dangerous confusion available here: "cannot tell" must
    // never render as "plenty".
    const headroom = computeGpuHeadroom({
      devices: [{ name: 'Radeon', totalBytes: 16 * GIB }],
      atlasResidentBytes: 0,
      safetyMarginBytes: 2 * GIB,
    });
    expect(headroom.basis).toBe('unmeasured');
    expect(headroom.headroomBytes).toBe(0);
    expect(headroom.rule).toBe('no-free-memory-reading');
    expect(headroom.totalBytes).toBe(16 * GIB);
  });

  it('ignores an untrustworthy total when setting the ceiling', () => {
    // AdapterRAM saturates at 4 GiB; using it would set AtlasMind's ceiling to
    // roughly nothing on a 24 GB card.
    const headroom = computeGpuHeadroom({
      devices: [{ ...RTX_4090, totalBytes: 4_293_918_720, totalUntrustworthy: true }],
      atlasResidentBytes: 0,
      safetyMarginBytes: 0,
      reserveBytes: 3 * GIB,
    });
    expect(headroom.bindingTerm).toBe('measured-free');
    expect(headroom.headroomBytes).toBe(14707 * MIB);
  });

  it('pools multiple cards', () => {
    const headroom = computeGpuHeadroom({
      devices: [RTX_4090, { name: 'RTX 3090', totalBytes: 24576 * MIB, freeBytes: 20000 * MIB }],
      atlasResidentBytes: 0,
      safetyMarginBytes: 0,
    });
    expect(headroom.measuredFreeBytes).toBe((14707 + 20000) * MIB);
  });

  it('never returns a negative headroom', () => {
    const headroom = computeGpuHeadroom({
      devices: [{ name: 'GPU', totalBytes: 8 * GIB, freeBytes: 100 * MIB }],
      atlasResidentBytes: 0,
      safetyMarginBytes: 4 * GIB,
    });
    expect(headroom.headroomBytes).toBe(0);
  });
});

const measuredHeadroom = (bytes: number): GpuHeadroom => ({
  basis: 'measured', headroomBytes: bytes, bindingTerm: 'measured-free', rule: 'measured-free-headroom',
});
const unmeasured: GpuHeadroom = {
  basis: 'unmeasured', headroomBytes: 0, bindingTerm: 'none', rule: 'no-free-memory-reading',
};

const baseAdmission = {
  enabled: true,
  footprintBytes: 9 * GIB,
  residentRequestBytes: 512 * MIB,
  modelResident: false,
  coldLoadInFlight: false,
  inFlightRequests: 0,
  maxConcurrentRequests: 2,
  ownedResidentModels: 0,
  maxOwnedResidentModels: 1,
  headroom: measuredHeadroom(12 * GIB),
};

describe('evaluateAdmission', () => {
  it('admits a cold load that fits', () => {
    const decision = evaluateAdmission(baseAdmission);
    expect(decision.outcome).toBe('admit');
    expect(decision.rule).toBe('fits-headroom');
    expect(decision.chargeBytes).toBe(9 * GIB);
  });

  it('waits when a cold load exceeds the budget', () => {
    const decision = evaluateAdmission({ ...baseAdmission, headroom: measuredHeadroom(4 * GIB) });
    expect(decision.outcome).toBe('wait');
    expect(decision.rule).toBe('insufficient-headroom');
  });

  it('charges a resident model for a context cache, not a second copy of the weights', () => {
    // This is what keeps a same-model fan-out fast: four bootstrap calls to one
    // model are four caches, and serialising them would turn a one-minute step
    // into four.
    const decision = evaluateAdmission({
      ...baseAdmission, modelResident: true, headroom: measuredHeadroom(1 * GIB),
    });
    expect(decision.outcome).toBe('admit');
    expect(decision.rule).toBe('model-already-resident');
    expect(decision.chargeBytes).toBe(512 * MIB);
  });

  it('still refuses a resident model when even its context cache will not fit', () => {
    const decision = evaluateAdmission({
      ...baseAdmission, modelResident: true, headroom: measuredHeadroom(1 * MIB),
    });
    expect(decision.outcome).toBe('wait');
    expect(decision.rule).toBe('insufficient-headroom');
  });

  it('serialises cold loads so a load can be attributed to whoever caused it', () => {
    const decision = evaluateAdmission({ ...baseAdmission, coldLoadInFlight: true });
    expect(decision.outcome).toBe('wait');
    expect(decision.rule).toBe('cold-load-in-flight');
  });

  it('lets a resident model through while a cold load is in flight elsewhere', () => {
    const decision = evaluateAdmission({
      ...baseAdmission, modelResident: true, coldLoadInFlight: true,
    });
    expect(decision.outcome).toBe('admit');
  });

  it('applies the concurrency cap before anything else', () => {
    const decision = evaluateAdmission({
      ...baseAdmission, modelResident: true, inFlightRequests: 2, maxConcurrentRequests: 2,
    });
    expect(decision.outcome).toBe('wait');
    expect(decision.rule).toBe('concurrency-cap');
  });

  it('bounds residency rather than concurrency when memory cannot be measured', () => {
    // Serialising requests alone would not bound VRAM: Ollama's default
    // keep_alive is five minutes, so three sequential calls to three different
    // models leave all three resident.
    const first = evaluateAdmission({ ...baseAdmission, headroom: unmeasured, ownedResidentModels: 0 });
    expect(first.outcome).toBe('admit');
    expect(first.rule).toBe('distinct-residency-cap');

    const second = evaluateAdmission({ ...baseAdmission, headroom: unmeasured, ownedResidentModels: 1 });
    expect(second.outcome).toBe('wait');
    expect(second.rule).toBe('distinct-residency-cap');
  });

  it('still serves an already-resident model when memory cannot be measured', () => {
    const decision = evaluateAdmission({
      ...baseAdmission, headroom: unmeasured, modelResident: true, ownedResidentModels: 1,
    });
    expect(decision.outcome).toBe('admit');
    expect(decision.rule).toBe('model-already-resident');
  });

  it('is a pass-through when switched off', () => {
    const decision = evaluateAdmission({
      ...baseAdmission, enabled: false, inFlightRequests: 99, headroom: measuredHeadroom(0),
    });
    expect(decision.outcome).toBe('admit');
    expect(decision.rule).toBe('arbiter-disabled');
    expect(decision.chargeBytes).toBe(0);
  });

  it('cites a published rule on every decision', () => {
    const ids = new Set(ADMISSION_RULES.map(rule => rule.id));
    expect(ids.size).toBe(ADMISSION_RULES.length);
    for (const input of [
      baseAdmission,
      { ...baseAdmission, enabled: false },
      { ...baseAdmission, modelResident: true },
      { ...baseAdmission, coldLoadInFlight: true },
      { ...baseAdmission, headroom: unmeasured },
      { ...baseAdmission, inFlightRequests: 5 },
      { ...baseAdmission, headroom: measuredHeadroom(0) },
    ]) {
      const decision = evaluateAdmission(input);
      expect(ids.has(decision.rule)).toBe(true);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('robustness', () => {
  const arbitraryHeadroomInput = fc.record({
    devices: fc.array(fc.record({
      name: fc.constantFrom('a', 'b'),
      totalBytes: fc.option(fc.nat(), { nil: undefined }),
      freeBytes: fc.option(fc.nat(), { nil: undefined }),
      totalUntrustworthy: fc.option(fc.boolean(), { nil: undefined }),
    }), { maxLength: 4 }),
    atlasResidentBytes: fc.nat(),
    safetyMarginBytes: fc.nat(),
    reserveBytes: fc.option(fc.nat(), { nil: undefined }),
  });

  it('never returns a negative or non-finite headroom', () => {
    fc.assert(fc.property(arbitraryHeadroomInput, input => {
      const headroom = computeGpuHeadroom(input);
      expect(Number.isFinite(headroom.headroomBytes)).toBe(true);
      expect(headroom.headroomBytes).toBeGreaterThanOrEqual(0);
    }), { numRuns: 500 });
  });

  it('is monotonic: more free memory never lowers headroom, more held never raises it', () => {
    // A sign error in either direction would be silently wrong rather than
    // visibly broken, which is why this is a property rather than an example.
    fc.assert(fc.property(fc.nat({ max: 40 * 1024 }), fc.nat({ max: 20 * 1024 }), fc.nat({ max: 8 * 1024 }),
      (freeMib, heldMib, extraMib) => {
        const base = {
          devices: [{ name: 'gpu', totalBytes: 64 * GIB, freeBytes: freeMib * MIB }],
          atlasResidentBytes: heldMib * MIB,
          safetyMarginBytes: 1 * GIB,
          reserveBytes: 4 * GIB,
        };
        const moreFree = computeGpuHeadroom({
          ...base,
          devices: [{ name: 'gpu', totalBytes: 64 * GIB, freeBytes: (freeMib + extraMib) * MIB }],
        });
        const moreHeld = computeGpuHeadroom({
          ...base, atlasResidentBytes: (heldMib + extraMib) * MIB,
        });
        const baseline = computeGpuHeadroom(base);
        expect(moreFree.headroomBytes).toBeGreaterThanOrEqual(baseline.headroomBytes);
        expect(moreHeld.headroomBytes).toBeLessThanOrEqual(baseline.headroomBytes);
      }), { numRuns: 500 });
  });

  it('never admits a charge larger than the measured headroom', () => {
    // The invariant the whole feature exists to hold.
    fc.assert(fc.property(
      fc.record({
        footprintBytes: fc.nat({ max: 32 * 1024 }).map(mb => mb * MIB),
        residentRequestBytes: fc.nat({ max: 2048 }).map(mb => mb * MIB),
        modelResident: fc.boolean(),
        coldLoadInFlight: fc.boolean(),
        inFlightRequests: fc.nat({ max: 6 }),
        maxConcurrentRequests: fc.integer({ min: 1, max: 4 }),
        ownedResidentModels: fc.nat({ max: 3 }),
        maxOwnedResidentModels: fc.integer({ min: 1, max: 3 }),
        headroomMib: fc.nat({ max: 24 * 1024 }),
      }),
      input => {
        const headroom = measuredHeadroom(input.headroomMib * MIB);
        const decision = evaluateAdmission({ ...input, enabled: true, headroom });
        if (decision.outcome === 'admit') {
          expect(decision.chargeBytes).toBeLessThanOrEqual(headroom.headroomBytes);
        }
      }), { numRuns: 500 });
  });

  it('never throws on arbitrary input', () => {
    fc.assert(fc.property(arbitraryHeadroomInput, input => {
      expect(() => computeGpuHeadroom(input)).not.toThrow();
    }), { numRuns: 250 });
  });
});

describe('selectEvictionVictims', () => {
  const candidate = (over: Partial<import('../../src/core/vramBudget.ts').EvictionCandidate>) => ({
    key: 'ollama::a', modelKey: 'a', ownedByUs: true, refcount: 0,
    vramBytes: 8 * GIB, lastServedAtMs: 0, ...over,
  });
  const base = { nowMs: 100_000, cooldownMs: 30_000 };

  it('never selects a model the user loaded by hand', () => {
    // The one rule that must never break. Unloading somebody's own model to
    // serve a background task they did not ask about is the worst thing this
    // feature could do.
    const plan = selectEvictionVictims({
      ...base,
      candidates: [candidate({ ownedByUs: false, vramBytes: 20 * GIB })],
      neededBytes: 4 * GIB,
    });
    expect(plan.victims).toEqual([]);
    expect(plan.sufficient).toBe(false);
    expect(plan.rule).toBe('nothing-evictable');
  });

  it('never selects a model with a request in flight', () => {
    const plan = selectEvictionVictims({
      ...base, candidates: [candidate({ refcount: 1 })], neededBytes: 1 * GIB,
    });
    expect(plan.victims).toEqual([]);
  });

  it('leaves a recently served model alone', () => {
    // Evicting a model used a moment ago produces a load-evict-load cycle that
    // is slower than waiting for the request in front of it.
    const plan = selectEvictionVictims({
      ...base, candidates: [candidate({ lastServedAtMs: 95_000 })], neededBytes: 1 * GIB,
    });
    expect(plan.victims).toEqual([]);
  });

  it('never counts a model whose resident size was never measured', () => {
    // Claiming an unknown quantity of space is how a budget starts lying.
    const plan = selectEvictionVictims({
      ...base, candidates: [candidate({ vramBytes: undefined })], neededBytes: 1 * GIB,
    });
    expect(plan.victims).toEqual([]);
  });

  it('evicts the coldest first and stops as soon as it fits', () => {
    const plan = selectEvictionVictims({
      ...base,
      candidates: [
        candidate({ key: 'k:new', modelKey: 'new', lastServedAtMs: 60_000, vramBytes: 6 * GIB }),
        candidate({ key: 'k:old', modelKey: 'old', lastServedAtMs: 10_000, vramBytes: 6 * GIB }),
      ],
      neededBytes: 5 * GIB,
    });
    expect(plan.sufficient).toBe(true);
    expect(plan.victims.map(v => v.modelKey)).toEqual(['old']);
  });

  it('marks a plan that would not free enough as insufficient', () => {
    // Unloading two models and still not fitting costs the reload of both and
    // gains nothing, so the caller waits instead.
    const plan = selectEvictionVictims({
      ...base,
      candidates: [
        candidate({ key: 'k:a', modelKey: 'a', vramBytes: 2 * GIB }),
        candidate({ key: 'k:b', modelKey: 'b', vramBytes: 2 * GIB }),
      ],
      neededBytes: 20 * GIB,
    });
    expect(plan.sufficient).toBe(false);
    expect(plan.rule).toBe('eviction-insufficient');
  });

  it('never proposes evicting anything not owned, for any input', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        ownedByUs: fc.boolean(),
        refcount: fc.nat({ max: 3 }),
        vramBytes: fc.option(fc.nat({ max: 32 }).map(n => n * GIB), { nil: undefined }),
        lastServedAtMs: fc.nat({ max: 200_000 }),
      }), { maxLength: 8 }),
      fc.nat({ max: 64 }),
      (rows, neededGb) => {
        const plan = selectEvictionVictims({
          ...base,
          candidates: rows.map((r, i) => ({ key: `k${i}`, modelKey: `m${i}`, ...r })),
          neededBytes: neededGb * GIB,
        });
        for (const victim of plan.victims) {
          expect(victim.ownedByUs).toBe(true);
          expect(victim.refcount).toBe(0);
          expect(victim.vramBytes).toBeGreaterThan(0);
        }
      }), { numRuns: 500 });
  });
});

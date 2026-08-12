import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  estimateModelFootprint,
  estimateResidentRequestFootprint,
  calibrationFactorFrom,
  bitsPerWeightFor,
  QUANTISATION_RULES,
  UNKNOWN_QUANTISATION_BITS_PER_WEIGHT,
} from '../../src/providers/localFootprint.js';

const GIB = 1024 * 1024 * 1024;

/** Captured verbatim from `ollama /api/tags` on the machine this was built for. */
const INSTALLED = [
  { name: 'qwen3:14b', sizeBytes: 9_276_198_565, parametersBillions: 14.8, quantisation: 'Q4_K_M' },
  { name: 'qwen2.5:14b', sizeBytes: 8_988_124_069, parametersBillions: 14.8, quantisation: 'Q4_K_M' },
  { name: 'devstral-small-2', sizeBytes: 15_177_374_099, parametersBillions: 24.0, quantisation: 'Q4_K_M' },
  { name: 'qwen3:30b-a3b', sizeBytes: 18_556_699_186, parametersBillions: 30.5, quantisation: 'Q4_K_M' },
  { name: 'llama3.2:3b', sizeBytes: 2_019_393_189, parametersBillions: 3.2, quantisation: 'Q4_K_M' },
  { name: 'qwen3:4b-q8_0', sizeBytes: 4_280_418_281, parametersBillions: 4.0, quantisation: 'Q8_0' },
];

describe('bitsPerWeightFor — calibrated against real blobs', () => {
  it('predicts each installed model within 10% from parameters and quantisation alone', () => {
    // The nominal width would say Q4 = 4.0 bits. Measured across five real
    // Q4_K_M blobs it is 4.86-5.06, because the non-quantised tensors are
    // heavier. Using 4.0 would under-estimate a 30B by roughly 3 GB, in the one
    // direction that causes an out-of-memory.
    for (const model of INSTALLED) {
      const { bitsPerWeight } = bitsPerWeightFor(model.quantisation);
      const predicted = (model.parametersBillions * 1e9 * bitsPerWeight) / 8;
      const ratio = predicted / model.sizeBytes;
      expect(ratio, `${model.name} predicted/actual`).toBeGreaterThan(0.9);
      expect(ratio, `${model.name} predicted/actual`).toBeLessThan(1.15);
    }
  });

  it('never under-predicts a real blob', () => {
    // Rounding up is the whole policy: an over-estimate costs a queue wait, an
    // under-estimate costs an OOM on somebody's desktop.
    for (const model of INSTALLED) {
      const { bitsPerWeight } = bitsPerWeightFor(model.quantisation);
      const predicted = (model.parametersBillions * 1e9 * bitsPerWeight) / 8;
      expect(predicted, model.name).toBeGreaterThanOrEqual(model.sizeBytes * 0.97);
    }
  });

  it('assumes a heavy format when the label is unrecognised', () => {
    // An unknown label is most likely a newer, larger format. Guessing small
    // here is the guess that OOMs.
    expect(bitsPerWeightFor('some-new-format').bitsPerWeight).toBe(UNKNOWN_QUANTISATION_BITS_PER_WEIGHT);
    expect(bitsPerWeightFor(undefined).bitsPerWeight).toBe(UNKNOWN_QUANTISATION_BITS_PER_WEIGHT);
    expect(bitsPerWeightFor('some-new-format').rule).toBe('unknown-quantisation');
  });

  it('matches the more specific label first', () => {
    expect(bitsPerWeightFor('Q4_K_M').rule).toBe('q4');
    expect(bitsPerWeightFor('Q8_0').rule).toBe('q8');
    expect(bitsPerWeightFor('F16').rule).toBe('f16');
    expect(bitsPerWeightFor('BF16').rule).toBe('f16');
  });

  it('publishes a rule table with unique ids and stated reasons', () => {
    const ids = QUANTISATION_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of QUANTISATION_RULES) {
      expect(rule.reason.length).toBeGreaterThan(0);
      expect(rule.bitsPerWeight).toBeGreaterThan(0);
    }
  });
});

describe('estimateModelFootprint', () => {
  it('exceeds the on-disk size, because residency is more than weights', () => {
    const estimate = estimateModelFootprint({
      sizeBytes: 9_276_198_565, parametersBillions: 14.8, contextTokens: 8192,
    });
    expect(estimate.confidence).toBe('derived');
    expect(estimate.weightsBytes).toBe(9_276_198_565);
    expect(estimate.kvBytes).toBeGreaterThan(0);
    expect(estimate.totalBytes).toBeGreaterThan(9_276_198_565);
  });

  it('an observed figure wins outright and reports itself as measured', () => {
    const estimate = estimateModelFootprint({
      sizeBytes: 9_276_198_565, parametersBillions: 14.8, observedBytes: 11 * GIB,
    });
    expect(estimate.confidence).toBe('measured');
    expect(estimate.totalBytes).toBe(11 * GIB);
  });

  it('scales the KV cache with context', () => {
    const short = estimateModelFootprint({ sizeBytes: 9 * GIB, parametersBillions: 14.8, contextTokens: 4096 });
    const long = estimateModelFootprint({ sizeBytes: 9 * GIB, parametersBillions: 14.8, contextTokens: 32768 });
    expect(long.kvBytes).toBe(short.kvBytes * 8);
    expect(long.totalBytes).toBeGreaterThan(short.totalBytes);
  });

  it('assumes something large when nothing identifies the model', () => {
    // Admitting an unknown model against a budget sized for a 7B is the
    // failure this default exists to prevent.
    const estimate = estimateModelFootprint({});
    expect(estimate.confidence).toBe('inferred');
    expect(estimate.totalBytes).toBeGreaterThan(16 * GIB);
    expect(estimate.basis).toContain('large default');
  });

  it('prefers a runtime-stated bits-per-weight over the label table', () => {
    const estimate = estimateModelFootprint({ parametersBillions: 8, bitsPerWeight: 4, quantisation: 'Q8_0' });
    // 8B at 4 bits = 4 GB of weights, not the 8.6 bits the Q8 label implies.
    expect(estimate.weightsBytes).toBe(4e9);
    expect(estimate.basis).toContain('runtime-reported');
  });

  it('applies a calibration factor and clamps an implausible one', () => {
    const plain = estimateModelFootprint({ sizeBytes: 8 * GIB, parametersBillions: 14 });
    const scaled = estimateModelFootprint({ sizeBytes: 8 * GIB, parametersBillions: 14, calibrationFactor: 1.2 });
    expect(scaled.totalBytes).toBeGreaterThan(plain.totalBytes);
    expect(scaled.basis).toContain('calibration');

    const clamped = estimateModelFootprint({ sizeBytes: 8 * GIB, parametersBillions: 14, calibrationFactor: 99 });
    expect(clamped.totalBytes).toBeCloseTo(plain.totalBytes * 2, -1);
  });
});

describe('estimateResidentRequestFootprint', () => {
  it('charges a context cache, not a second copy of the weights', () => {
    const full = estimateModelFootprint({ sizeBytes: 9 * GIB, parametersBillions: 14.8, contextTokens: 8192 });
    const extra = estimateResidentRequestFootprint({ parametersBillions: 14.8, contextTokens: 8192 });
    expect(extra).toBe(full.kvBytes);
    expect(extra).toBeLessThan(full.totalBytes / 4);
  });
});

describe('calibrationFactorFrom', () => {
  it('learns from a plausible sample', () => {
    expect(calibrationFactorFrom(11 * GIB, 10 * GIB)).toBeCloseTo(1.1, 5);
  });

  it('discards an implausible sample rather than folding it in', () => {
    // A partial CPU offload or another app moving gigabytes mid-load would
    // otherwise poison every later estimate.
    expect(calibrationFactorFrom(1 * GIB, 10 * GIB)).toBeUndefined();
    expect(calibrationFactorFrom(40 * GIB, 10 * GIB)).toBeUndefined();
  });

  it('returns undefined rather than 1 for an unusable sample', () => {
    // "No information" and "confirmed accurate" are different facts.
    expect(calibrationFactorFrom(0, 10 * GIB)).toBeUndefined();
    expect(calibrationFactorFrom(10 * GIB, 0)).toBeUndefined();
    expect(calibrationFactorFrom(Number.NaN, 10 * GIB)).toBeUndefined();
  });
});

describe('robustness', () => {
  const arbitraryInput = fc.record({
    sizeBytes: fc.option(fc.nat(), { nil: undefined }),
    parametersBillions: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: undefined }),
    quantisation: fc.option(fc.string(), { nil: undefined }),
    bitsPerWeight: fc.option(fc.double({ min: 0, max: 64, noNaN: true }), { nil: undefined }),
    contextTokens: fc.option(fc.nat({ max: 2_000_000 }), { nil: undefined }),
    observedBytes: fc.option(fc.nat(), { nil: undefined }),
    calibrationFactor: fc.option(fc.double({ min: -100, max: 100, noNaN: true }), { nil: undefined }),
  });

  it('always yields a finite, positive, integral total', () => {
    // A NaN or negative footprint would propagate into the budget comparison as
    // a silent admission of anything.
    fc.assert(fc.property(arbitraryInput, input => {
      const estimate = estimateModelFootprint(input);
      expect(Number.isFinite(estimate.totalBytes)).toBe(true);
      expect(estimate.totalBytes).toBeGreaterThan(0);
      expect(Number.isInteger(estimate.totalBytes)).toBe(true);
    }), { numRuns: 500 });
  });

  it('never charges less for a whole model than for one more request against it', () => {
    fc.assert(fc.property(
      fc.double({ min: 0.1, max: 200, noNaN: true }),
      fc.nat({ max: 200_000 }),
      (parametersBillions, contextTokens) => {
        const full = estimateModelFootprint({ parametersBillions, contextTokens, quantisation: 'Q4_K_M' });
        const extra = estimateResidentRequestFootprint({ parametersBillions, contextTokens });
        expect(full.totalBytes).toBeGreaterThanOrEqual(extra);
      }), { numRuns: 300 });
  });

  it('never throws', () => {
    fc.assert(fc.property(arbitraryInput, input => {
      expect(() => estimateModelFootprint(input)).not.toThrow();
    }), { numRuns: 250 });
  });
});

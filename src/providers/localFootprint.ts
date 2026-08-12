/**
 * How much VRAM a local model will take, before it has taken any.
 *
 * The admission decision needs a number *before* the load, and the only exact
 * figure — Ollama's `size_vram` — exists only *after* it. So this estimates, and
 * every property here follows from that being a genuinely hard problem:
 *
 * **Round up, always.** An over-estimate costs a queue wait. An under-estimate
 * costs an out-of-memory on somebody's desktop. The two are not comparable, so
 * every fallback in this file is the generous one.
 *
 * **Prefer what was measured over what was computed.** Once a model has loaded
 * once, `recordObservedFootprint` replaces the estimate with the observed figure
 * for every later admission, and derives a calibration factor that improves the
 * estimate for models of the same family that have not loaded yet. The first
 * load of a model is a guess; nothing after it needs to be.
 *
 * **Say which it is.** `confidence` is carried on every estimate — `measured`,
 * `derived` (a real on-disk size), `inferred` (parameter count and quantisation
 * only). A caller that cannot tell an observation from an extrapolation will
 * eventually treat one as the other.
 *
 * The quantisation table is calibrated against real installed models rather than
 * the nominal bit-width, which is materially different. Measured on this
 * machine, dividing Ollama's reported blob size by the reported parameter count:
 *
 * ```
 * qwen3:14b              14.8B Q4_K_M   9,276,198,565 B  → 5.01 bits/weight
 * qwen2.5:14b            14.8B Q4_K_M   8,988,124,069 B  → 4.86
 * devstral-small-2       24.0B Q4_K_M  15,177,374,099 B  → 5.06
 * qwen3:30b-a3b          30.5B Q4_K_M  18,556,699,186 B  → 4.87
 * llama3.2:3b             3.2B Q4_K_M   2,019,393,189 B  → 5.05
 * qwen3:4b …-q8_0         4.0B Q8_0     4,280,418,281 B  → 8.56
 * ```
 *
 * "Q4" costs about five bits per weight in practice, not four — the nominal
 * width applies to the quantised tensors and the rest of the file (embeddings,
 * norms, metadata) is heavier. Using 4.0 would under-estimate a 30B model by
 * roughly 3 GB, in the one direction that causes harm.
 *
 * Pure — no imports, no I/O, no clock.
 */

/** How much this figure can be trusted, and where it came from. */
export type FootprintConfidence = 'measured' | 'derived' | 'inferred';

export interface FootprintEstimate {
  weightsBytes: number;
  kvBytes: number;
  overheadBytes: number;
  totalBytes: number;
  confidence: FootprintConfidence;
  /** Human-readable statement of what the figure was built from. */
  basis: string;
}

export interface FootprintInput {
  /**
   * On-disk blob size, from Ollama `/api/tags` `size` or LM Studio `size_bytes`.
   * The best available weights proxy: a GGUF's quantised tensors occupy roughly
   * the same space resident as they do on disk.
   */
  sizeBytes?: number;
  /** Parameter count in billions, when the id or the runtime reports one. */
  parametersBillions?: number;
  /** Quantisation label, e.g. `Q4_K_M`, `Q8_0`, `F16`. */
  quantisation?: string;
  /** Bits per weight when the runtime states it outright (LM Studio does). */
  bitsPerWeight?: number;
  /** Context the model will be loaded with, in tokens. */
  contextTokens?: number;
  /** A previously observed exact footprint for this model. Wins outright. */
  observedBytes?: number;
  /** Calibration factor learned from models that have already loaded. */
  calibrationFactor?: number;
}

/** A declared quantisation rule: label pattern, effective bits, and why. */
export interface QuantisationRule {
  id: string;
  pattern: RegExp;
  bitsPerWeight: number;
  reason: string;
}

/**
 * Effective bits per weight by quantisation label, in evaluation order.
 *
 * These are *effective* widths measured against real blobs, not nominal ones.
 * Order matters only in that the more specific label must precede the looser
 * one — `Q4_K_M` before `Q4`.
 */
export const QUANTISATION_RULES: readonly QuantisationRule[] = [
  { id: 'f32', pattern: /\bf(?:p)?32\b/i, bitsPerWeight: 32, reason: 'Full precision.' },
  { id: 'f16', pattern: /\b(?:f(?:p)?16|bf16)\b/i, bitsPerWeight: 16.5, reason: 'Half precision plus file overhead.' },
  { id: 'q8', pattern: /\bq8/i, bitsPerWeight: 8.6, reason: 'Measured at 8.56 bits/weight on a 4B Q8_0 blob.' },
  { id: 'q6', pattern: /\bq6/i, bitsPerWeight: 6.6, reason: 'Interpolated between the measured Q4 and Q8 points.' },
  { id: 'q5', pattern: /\bq5/i, bitsPerWeight: 5.8, reason: 'Interpolated between the measured Q4 and Q8 points.' },
  { id: 'q4', pattern: /\bq4/i, bitsPerWeight: 5.1, reason: 'Measured at 4.86-5.06 bits/weight across five Q4_K_M blobs; rounded up.' },
  { id: 'q3', pattern: /\bq3/i, bitsPerWeight: 4.0, reason: 'Extrapolated below the measured Q4 point.' },
  { id: 'q2', pattern: /\bq2/i, bitsPerWeight: 3.2, reason: 'Extrapolated below the measured Q4 point.' },
] as const;

/**
 * Bits per weight assumed when nothing identifies the quantisation.
 *
 * Deliberately the Q8 figure rather than the commonest Q4: an unrecognised label
 * is most likely a newer, larger format, and guessing small here is the guess
 * that causes an out-of-memory.
 */
export const UNKNOWN_QUANTISATION_BITS_PER_WEIGHT = 8.6;

/** Minimum overhead for compute buffers and the runtime's GPU context. */
export const MIN_OVERHEAD_BYTES = 512 * 1024 * 1024;

/** Fraction of the weights added for compute buffers. */
export const OVERHEAD_FRACTION = 0.1;

/** Context assumed when nobody states one. */
export const DEFAULT_CONTEXT_TOKENS = 8192;

/**
 * Key/value cache cost per token, by model scale.
 *
 * A precise figure needs layer count, KV head count and head dimension, which
 * only Ollama's `/api/show` carries and not always. This table is the fallback,
 * anchored on a computed reference: a 14B model with 40 layers, 8 KV heads and
 * head dimension 128 at fp16 costs 2 × 40 × 8 × 128 × 2 = 160 KB per token.
 * Grouped-query attention makes that vary by a factor of several between
 * families, so each band rounds up.
 */
export const KV_BYTES_PER_TOKEN_BANDS: readonly { maxParametersBillions: number; bytesPerToken: number }[] = [
  { maxParametersBillions: 3, bytesPerToken: 48 * 1024 },
  { maxParametersBillions: 10, bytesPerToken: 96 * 1024 },
  { maxParametersBillions: 35, bytesPerToken: 176 * 1024 },
  { maxParametersBillions: Number.POSITIVE_INFINITY, bytesPerToken: 320 * 1024 },
];

/** Effective bits per weight for a quantisation label. */
export function bitsPerWeightFor(quantisation: string | undefined): { bitsPerWeight: number; rule: string } {
  if (quantisation) {
    for (const rule of QUANTISATION_RULES) {
      if (rule.pattern.test(quantisation)) {
        return { bitsPerWeight: rule.bitsPerWeight, rule: rule.id };
      }
    }
  }
  return { bitsPerWeight: UNKNOWN_QUANTISATION_BITS_PER_WEIGHT, rule: 'unknown-quantisation' };
}

function kvBytesPerToken(parametersBillions: number | undefined): number {
  const params = parametersBillions ?? 14;
  for (const band of KV_BYTES_PER_TOKEN_BANDS) {
    if (params <= band.maxParametersBillions) {
      return band.bytesPerToken;
    }
  }
  return KV_BYTES_PER_TOKEN_BANDS[KV_BYTES_PER_TOKEN_BANDS.length - 1]!.bytesPerToken;
}

/**
 * What this model will occupy if it has to be loaded.
 *
 * Total: any input, including an empty one, yields an estimate. An estimate
 * built from nothing is large rather than small, so a model AtlasMind knows
 * nothing about waits for room instead of being waved through.
 */
export function estimateModelFootprint(input: FootprintInput): FootprintEstimate {
  if (input.observedBytes !== undefined && input.observedBytes > 0) {
    return {
      weightsBytes: input.observedBytes,
      kvBytes: 0,
      overheadBytes: 0,
      totalBytes: input.observedBytes,
      confidence: 'measured',
      basis: 'Observed VRAM from a previous load of this model.',
    };
  }

  const contextTokens = Math.max(1, input.contextTokens ?? DEFAULT_CONTEXT_TOKENS);
  const params = input.parametersBillions !== undefined && input.parametersBillions > 0
    ? input.parametersBillions
    : undefined;

  let weightsBytes: number;
  let confidence: FootprintConfidence;
  let basis: string;

  if (input.sizeBytes !== undefined && input.sizeBytes > 0) {
    weightsBytes = input.sizeBytes;
    confidence = 'derived';
    basis = 'On-disk blob size reported by the runtime.';
  } else if (params !== undefined) {
    const bits = input.bitsPerWeight !== undefined && input.bitsPerWeight > 0
      ? { bitsPerWeight: input.bitsPerWeight, rule: 'runtime-reported' }
      : bitsPerWeightFor(input.quantisation);
    weightsBytes = (params * 1e9 * bits.bitsPerWeight) / 8;
    confidence = 'inferred';
    basis = `${params}B parameters at ${bits.bitsPerWeight} bits/weight (${bits.rule}).`;
  } else {
    // Nothing identifies this model. Assume something large rather than
    // something convenient — the alternative admits an unknown 70B into a
    // budget sized for a 7B.
    weightsBytes = 16 * 1024 * 1024 * 1024;
    confidence = 'inferred';
    basis = 'Nothing identified this model; a large default was assumed rather than a convenient one.';
  }

  const kvBytes = kvBytesPerToken(params) * contextTokens;
  const overheadBytes = Math.max(MIN_OVERHEAD_BYTES, weightsBytes * OVERHEAD_FRACTION);
  const calibration = input.calibrationFactor !== undefined && Number.isFinite(input.calibrationFactor)
    ? Math.min(2, Math.max(0.5, input.calibrationFactor))
    : 1;

  return {
    weightsBytes: Math.ceil(weightsBytes),
    kvBytes: Math.ceil(kvBytes),
    overheadBytes: Math.ceil(overheadBytes),
    totalBytes: Math.ceil((weightsBytes + kvBytes + overheadBytes) * calibration),
    confidence,
    basis: calibration === 1 ? basis : `${basis} Scaled by a ${calibration.toFixed(2)}× calibration from earlier loads.`,
  };
}

/**
 * What one more concurrent request against an already-resident model costs.
 *
 * A second caller reusing a loaded model pays for its own context cache, not a
 * second copy of the weights. Charging the full footprint here would serialise
 * a same-model fan-out — four bootstrap calls to one model becoming four
 * sequential loads — which is the exact behaviour the refcounted design exists
 * to avoid.
 */
export function estimateResidentRequestFootprint(input: Pick<FootprintInput, 'parametersBillions' | 'contextTokens'>): number {
  const contextTokens = Math.max(1, input.contextTokens ?? DEFAULT_CONTEXT_TOKENS);
  return Math.ceil(kvBytesPerToken(input.parametersBillions) * contextTokens);
}

/**
 * Learn from a load that actually happened.
 *
 * Clamped to `[0.5, 2]`: a factor outside that is a bad sample — a partial CPU
 * offload, or another application moving several gigabytes during the load —
 * and folding it in would make every later estimate worse. Returns `undefined`
 * for a sample that should be discarded rather than a factor of 1, so a caller
 * can tell "no information" from "confirmed accurate".
 */
export function calibrationFactorFrom(observedBytes: number, estimatedBytes: number): number | undefined {
  if (!Number.isFinite(observedBytes) || !Number.isFinite(estimatedBytes)) { return undefined; }
  if (observedBytes <= 0 || estimatedBytes <= 0) { return undefined; }
  const factor = observedBytes / estimatedBytes;
  if (factor < 0.5 || factor > 2) { return undefined; }
  return factor;
}

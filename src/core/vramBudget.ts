/**
 * How much VRAM AtlasMind may commit, and whether this request fits in it.
 *
 * The decision every local call needs and none of them could previously ask.
 * Two runtimes share one card here — Ollama and LM Studio — and each computes
 * fit against whatever free memory it happens to see, so neither can tell that
 * the other is about to load 12 GB. Both also fit models to *card capacity*
 * rather than to capacity-minus-a-working-desktop, which is a different number:
 * measured on the machine this was written for, 9.2 GB of a 24 GB card was
 * already committed to Windows, a browser and antivirus with no model loaded at
 * all.
 *
 * **Free memory is measured, never inferred.** A budget of "total minus what we
 * loaded" would have been wrong by that 9.2 GB, and wrong in the dangerous
 * direction. Measuring also means the budget shrinks by itself when somebody
 * opens a game, which no amount of bookkeeping would achieve.
 *
 * **The second limb is a ceiling on AtlasMind's own share, not an OS reserve.**
 * The obvious formula — `min(free − margin, total − reserve)` — looks like two
 * protections and is one: `total − reserve` is a *constant*, so once anything is
 * loaded the measured limb is always lower and the reserve never binds again.
 * Checked arithmetically at four load levels before this was written; it was
 * inert at every one. Subtracting what AtlasMind already holds makes it a real,
 * persistent limit that keeps binding as our own footprint grows — and it is the
 * limb that saves us when the driver over-reports free memory, which WDDM does.
 *
 * **`atlasResidentBytes` comes from observation, never from our own ledger.**
 * It is summed from what the runtimes report as resident for models we own. If
 * the user restarts Ollama, the next poll self-corrects; bookkeeping would
 * happily insist we still hold 9 GB that no longer exists.
 *
 * **Unmeasured is not unlimited.** When no probe reports free memory — AMD or
 * Intel on Windows, Apple, no `nvidia-smi` — this returns `basis: 'unmeasured'`
 * with no headroom figure at all, rather than a large number. The caller
 * degrades to bounding *residency* instead, which needs no measurement. Note
 * that bounding concurrency alone would not be enough: Ollama's default
 * `keep_alive` is five minutes, so three sequential calls to three different
 * models leave all three resident at once.
 *
 * Every decision names the rule that produced it, so a queued request is
 * explainable rather than looking like a hang.
 *
 * Pure — no imports beyond a type, no I/O, no clock.
 */
import type { GpuDevice } from '../providers/gpuProbeParse.js';

/** Which limb of the budget decided, or that none could. */
export type HeadroomBasis = 'measured' | 'unmeasured';

/** What the headroom calculation concluded. */
export interface GpuHeadroom {
  basis: HeadroomBasis;
  /** Bytes AtlasMind may still commit. Always 0 when `basis` is `unmeasured`. */
  headroomBytes: number;
  /** Which limb bound the result — useful when a number looks surprising. */
  bindingTerm: 'measured-free' | 'atlas-ceiling' | 'none';
  /** Aggregate across all devices, when any source reported it. */
  totalBytes?: number;
  measuredFreeBytes?: number;
  /** The id of the rule that decided. */
  rule: string;
}

export interface GpuHeadroomInput {
  devices: readonly GpuDevice[];
  /**
   * VRAM currently held by models AtlasMind loaded, summed from the runtimes'
   * own residency reports. Never from local bookkeeping — see the header.
   */
  atlasResidentBytes: number;
  /** Subtracted from measured free memory. The limb that normally binds. */
  safetyMarginBytes: number;
  /**
   * Reserved from the card total, defining AtlasMind's own ceiling. `0` or
   * `undefined` means no ceiling — the measured limb governs alone.
   */
  reserveBytes?: number;
}

function sumDefined(devices: readonly GpuDevice[], pick: (d: GpuDevice) => number | undefined): number | undefined {
  let total: number | undefined;
  for (const device of devices) {
    const value = pick(device);
    if (value === undefined) { continue; }
    total = (total ?? 0) + value;
  }
  return total;
}

/**
 * Aggregate the readings into a single commitment budget.
 *
 * Devices are pooled rather than tracked individually: both runtimes make their
 * own placement decisions across cards, and second-guessing which GPU a model
 * will land on is a game AtlasMind cannot win from outside the runtime.
 */
export function computeGpuHeadroom(input: GpuHeadroomInput): GpuHeadroom {
  const measuredFree = sumDefined(input.devices, d => d.freeBytes);
  // Only trustworthy totals feed the ceiling: `AdapterRAM` saturates at 4 GiB
  // and would set a ceiling of roughly nothing on a 24 GB card.
  const total = sumDefined(input.devices, d => (d.totalUntrustworthy ? undefined : d.totalBytes));

  if (measuredFree === undefined) {
    return {
      basis: 'unmeasured',
      headroomBytes: 0,
      bindingTerm: 'none',
      ...(total !== undefined ? { totalBytes: total } : {}),
      rule: 'no-free-memory-reading',
    };
  }

  const measuredLimb = measuredFree - Math.max(0, input.safetyMarginBytes);
  const reserve = Math.max(0, input.reserveBytes ?? 0);
  const ceilingLimb = (total !== undefined && reserve > 0)
    ? total - reserve - Math.max(0, input.atlasResidentBytes)
    : undefined;

  const bound = ceilingLimb !== undefined ? Math.min(measuredLimb, ceilingLimb) : measuredLimb;
  const bindingTerm = ceilingLimb !== undefined && ceilingLimb < measuredLimb
    ? 'atlas-ceiling'
    : 'measured-free';

  return {
    basis: 'measured',
    headroomBytes: Math.max(0, bound),
    bindingTerm,
    ...(total !== undefined ? { totalBytes: total } : {}),
    measuredFreeBytes: measuredFree,
    rule: bindingTerm === 'atlas-ceiling' ? 'atlas-share-ceiling' : 'measured-free-headroom',
  };
}

/** What the arbiter should do with a request, right now. */
export type AdmissionOutcome = 'admit' | 'wait';

/** A declared admission rule, published so a decision can cite it. */
export interface AdmissionRule {
  id: string;
  reason: string;
}

/**
 * The rules, in evaluation order. First match wins, and the order is the policy:
 * cheapest and most certain checks first, so a request that obviously fits never
 * waits on a calculation about one that does not.
 */
export const ADMISSION_RULES: readonly AdmissionRule[] = [
  { id: 'arbiter-disabled', reason: 'The GPU arbiter is switched off; every request is admitted unchanged.' },
  { id: 'concurrency-cap', reason: 'The configured number of concurrent local requests is already in flight.' },
  { id: 'model-already-resident', reason: 'The model is already loaded, so this request costs a context cache rather than a second copy of the weights.' },
  { id: 'cold-load-in-flight', reason: 'Another model is loading. Cold loads run one at a time so the loaded model can be attributed to whoever caused it.' },
  { id: 'distinct-residency-cap', reason: 'GPU memory cannot be measured on this machine, so AtlasMind holds one model per runtime at a time.' },
  { id: 'fits-headroom', reason: 'The estimated footprint fits the remaining budget.' },
  { id: 'insufficient-headroom', reason: 'The estimated footprint exceeds the remaining budget.' },
] as const;

const RULE_REASONS = new Map(ADMISSION_RULES.map(rule => [rule.id, rule.reason]));

export interface AdmissionDecision {
  outcome: AdmissionOutcome;
  rule: string;
  reason: string;
  /** Bytes this admission would commit. Zero for an already-resident model. */
  chargeBytes: number;
}

/** A resident model considered for eviction. */
export interface EvictionCandidate {
  key: string;
  modelKey: string;
  /** Only models AtlasMind loaded may ever be evicted. */
  ownedByUs: boolean;
  /** In-flight requests using it. A model in use is never a candidate. */
  refcount: number;
  /** Measured resident VRAM. Unknown means we cannot claim evicting it frees anything. */
  vramBytes?: number;
  lastServedAtMs: number;
}

export interface EvictionInput {
  candidates: readonly EvictionCandidate[];
  /** Bytes the admission is short by. */
  neededBytes: number;
  nowMs: number;
  /** How long after last serving a model it may be evicted. */
  cooldownMs: number;
}

export interface EvictionPlan {
  /** Models to unload, in the order to unload them. Empty means do not try. */
  victims: EvictionCandidate[];
  /** Bytes the plan expects to free. */
  freesBytes: number;
  /** Whether the plan frees enough. A partial plan is not executed. */
  sufficient: boolean;
  rule: string;
}

/**
 * Which of AtlasMind's own models to unload to make room, if any.
 *
 * Four guards, and the first is the one that matters most: **only models
 * AtlasMind loaded are candidates.** A model the user loaded by hand is theirs
 * and is never touched, whatever the pressure — unloading it would take away
 * work somebody was in the middle of, to serve a background task they did not
 * ask about.
 *
 * The others: a model with a live request is in use; a model served within the
 * cooldown is probably about to be used again, and evicting it produces a
 * load-evict-load cycle that is slower than waiting; and a model whose resident
 * size was never measured cannot be counted towards freeing anything, because
 * claiming an unknown quantity of space is how a budget starts lying.
 *
 * **A partial plan is not executed.** Unloading two models and still not fitting
 * costs the reload of both and gains nothing — so an insufficient plan returns
 * its victims for reporting but is marked `sufficient: false`, and the caller
 * waits instead.
 *
 * Victims are chosen least-recently-served first, then largest, so the fewest
 * models are disturbed and the coldest go first.
 */
export function selectEvictionVictims(input: EvictionInput): EvictionPlan {
  const eligible = input.candidates.filter(candidate =>
    candidate.ownedByUs
    && candidate.refcount === 0
    && candidate.vramBytes !== undefined
    && candidate.vramBytes > 0
    && input.nowMs - candidate.lastServedAtMs >= input.cooldownMs);

  if (eligible.length === 0) {
    return { victims: [], freesBytes: 0, sufficient: false, rule: 'nothing-evictable' };
  }

  const ordered = [...eligible].sort((a, b) =>
    (a.lastServedAtMs - b.lastServedAtMs) || ((b.vramBytes ?? 0) - (a.vramBytes ?? 0)));

  const victims: EvictionCandidate[] = [];
  let freesBytes = 0;
  for (const candidate of ordered) {
    victims.push(candidate);
    freesBytes += candidate.vramBytes ?? 0;
    if (freesBytes >= input.neededBytes) {
      return { victims, freesBytes, sufficient: true, rule: 'evict-own-coldest-first' };
    }
  }
  return { victims, freesBytes, sufficient: false, rule: 'eviction-insufficient' };
}

export interface AdmissionInput {
  enabled: boolean;
  /** Estimated weights + context footprint if this model has to be loaded. */
  footprintBytes: number;
  /** Cost of one more concurrent request against an already-resident model. */
  residentRequestBytes: number;
  modelResident: boolean;
  /** A cold load is already in flight somewhere. */
  coldLoadInFlight: boolean;
  inFlightRequests: number;
  maxConcurrentRequests: number;
  /**
   * Distinct models AtlasMind currently holds on this endpoint. Only consulted
   * when memory is unmeasurable, where capping residency is the only bound
   * available.
   */
  ownedResidentModels: number;
  maxOwnedResidentModels: number;
  headroom: GpuHeadroom;
}

function decide(rule: string, outcome: AdmissionOutcome, chargeBytes: number): AdmissionDecision {
  return { outcome, rule, reason: RULE_REASONS.get(rule) ?? rule, chargeBytes };
}

/**
 * Whether this request may proceed now, and what it costs if it does.
 *
 * `wait` is never a refusal — the caller queues and re-asks. Turning a wait into
 * a refusal is a decision about *time*, which belongs to the arbiter that owns
 * the clock, not here.
 */
export function evaluateAdmission(input: AdmissionInput): AdmissionDecision {
  if (!input.enabled) {
    return decide('arbiter-disabled', 'admit', 0);
  }

  if (input.inFlightRequests >= Math.max(1, input.maxConcurrentRequests)) {
    return decide('concurrency-cap', 'wait', 0);
  }

  // Charging a resident model only for its context cache is what keeps a
  // same-model fan-out fast. Four bootstrap calls to one model are four context
  // caches, not four copies of the weights, and serialising them would turn a
  // one-minute step into four.
  if (input.modelResident) {
    const charge = Math.max(0, input.residentRequestBytes);
    if (input.headroom.basis === 'unmeasured' || charge <= input.headroom.headroomBytes) {
      return decide('model-already-resident', 'admit', charge);
    }
    return decide('insufficient-headroom', 'wait', charge);
  }

  // Everything below is a cold load.
  if (input.coldLoadInFlight) {
    return decide('cold-load-in-flight', 'wait', 0);
  }

  if (input.headroom.basis === 'unmeasured') {
    if (input.ownedResidentModels >= Math.max(1, input.maxOwnedResidentModels)) {
      return decide('distinct-residency-cap', 'wait', 0);
    }
    return decide('distinct-residency-cap', 'admit', 0);
  }

  const footprint = Math.max(0, input.footprintBytes);
  if (footprint <= input.headroom.headroomBytes) {
    return decide('fits-headroom', 'admit', footprint);
  }
  return decide('insufficient-headroom', 'wait', footprint);
}

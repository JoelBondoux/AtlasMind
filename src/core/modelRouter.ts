import type { BudgetMode, ModelCapability, ModelInfo, ProviderConfig, RoutingConstraints, SpeedMode, SubscriptionQuota, TaskProfile } from '../types.js';
import {
  BUDGET_TIER_CHEAP_THRESHOLD_USD,
  BUDGET_TIER_BALANCED_THRESHOLD_USD,
  CONTEXT_GATE_SMALL,
  CONTEXT_GATE_MEDIUM,
  CONTEXT_GATE_LARGE,
  CONTEXT_GATE_FAST,
  MODEL_FAILURE_TTL_MS,
  QUOTA_CONSERVATION_THRESHOLD,
  LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW,
  PERFORMANCE_OUTCOME_WEIGHT,
} from '../constants.js';

// ── Scoring weight constants ──────────────────────────────────────
// These weights control the relative importance of each scoring axis.
// CHEAP_MODE_BUDGET_WEIGHT and FAST_MODE_SPEED_WEIGHT are intentionally
// large (14×) so that cheap/fast mode behaves as a near-hard constraint
// while still allowing capability tie-breaking.
// Calibration date: 2026-06-08 — revisit if routing quality drifts.

/** Weight for cheapness axis when budget=cheap. */
const CHEAP_MODE_BUDGET_WEIGHT = 14;
/** Weight for speed axis when speed=fast. */
const FAST_MODE_SPEED_WEIGHT = 14;
/** Weight for quality/reasoning proxy in non-cheap budget modes. */
const QUALITY_WEIGHT_NORMAL = 1;
/** Quality weight reduction in cheap mode (half, so cheapness still wins). */
const QUALITY_WEIGHT_CHEAP = 0.5;
/** Provider health bonus — unhealthy providers are effectively excluded. */
const PROVIDER_HEALTH_BONUS = 1.25;
/** Maximum preference bias magnitude applied from user feedback. */
const PREFERENCE_BIAS_MAX = 0.25;
/** Laplace smoothing denominator for dampened preference calculation. */
const PREFERENCE_BIAS_SMOOTH = 4;
/** Reward added per matched preferred capability. */
const TASK_FIT_CAPABILITY_SCORE = 0.6;
/** Maintenance-task bonus for local models with adequate context (≥ LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW). */
const LOCAL_MAINTENANCE_LARGE_BONUS = 2.0;
/** Maintenance-task bonus for local models with small context. */
const LOCAL_MAINTENANCE_SMALL_BONUS = 0.5;
/** Maintenance-task bonus for free (non-local) providers. */
const FREE_MAINTENANCE_BONUS = 1.5;
/** Maintenance-task bonus for subscription providers. */
const SUBSCRIPTION_MAINTENANCE_BONUS = 0.5;
/**
 * General preference nudge for an active subscription provider with quota
 * remaining. Subscription capacity is already paid for ("essentially free"
 * until quota is exhausted), so it should be preferred over pay-per-token for
 * ordinary work — not only on maintenance tasks. Modest by design: it breaks
 * ties toward the subscription without overriding capability/quality needs, and
 * it vanishes once quota is depleted (the provider is then effectively
 * pay-per-token).
 */
const ACTIVE_SUBSCRIPTION_BONUS = 0.3;
/**
 * Providers that support prompt caching (a stable prompt prefix is billed at a
 * reduced cache-read rate on subsequent turns). A model is treated as
 * cache-capable if its `supportsPromptCaching` flag is set or its provider is
 * listed here.
 */
const CACHE_CAPABLE_PROVIDERS = new Set<string>([
  'anthropic', 'claude-cli', 'openai', 'azure', 'deepseek', 'google', 'copilot',
]);
/**
 * Conservative cache-read discount applied to input price when a model is
 * cache-capable but carries no explicit `cachedInputPricePer1k` and its provider
 * has no known factor. Real provider discounts range ~0.1×–0.5×; 0.25× stays on
 * the cautious side so caching never over-favours a model beyond its realistic
 * saving.
 */
const DEFAULT_CACHE_READ_FACTOR = 0.25;
/**
 * Known cache-read discounts per provider (cache-hit input price ÷ base input
 * price), used as the baseline when a model carries no explicit
 * `cachedInputPricePer1k`. These are stable, published list factors; a dynamic
 * `cachedInputPricePer1k` from discovery / pricing sync still overrides them, so
 * this is only a more-accurate bootstrap than the flat default.
 */
const PROVIDER_CACHE_READ_FACTOR: Record<string, number> = {
  anthropic: 0.1,
  'claude-cli': 0.1,
  openai: 0.5,
  azure: 0.5,
  copilot: 0.5,
  deepseek: 0.25,
  google: 0.25,
};
/** Upper bound on the projected cacheable-prefix fraction (never assume a 100% cache hit). */
const MAX_CACHEABLE_PREFIX_RATIO = 0.9;
/** Maintenance-task penalty for pay-per-token providers. */
const PAYPETOKEN_MAINTENANCE_PENALTY = -0.5;
/** Penalty applied to local models that lack reasoning depth on high-reasoning tasks. */
const LOCAL_HIGH_REASONING_PENALTY = -0.5;
/** Penalty applied to local models that lack reasoning depth on planning tasks. */
const LOCAL_PLANNING_PENALTY = -0.3;

type ModelPreferenceStats = {
  upVotes: number;
  downVotes: number;
};

/** Decayed execution-outcome state for a model (Direction 2: outcome-driven routing). */
type ModelOutcomeState = {
  /** Exponentially-weighted moving average of per-run execution quality in [0,1]. */
  ewma: number;
  /** Number of recorded outcomes (gates noisy single-sample bias). */
  samples: number;
};

/** Maximum magnitude of the outcome-driven routing bias (bounded so it cannot starve providers). */
const OUTCOME_BIAS_MAX = 0.3;
/** EWMA smoothing factor — higher reacts faster to recent outcomes, lower is steadier. */
const OUTCOME_EWMA_ALPHA = 0.3;
/** Quality level treated as neutral; outcomes above raise the bias, below lower it. */
const OUTCOME_NEUTRAL_BASELINE = 0.7;
/** Minimum recorded outcomes before the bias applies, to avoid reacting to a single run. */
const MIN_OUTCOME_SAMPLES = 2;
/** Composite key for a per-(model × reasoning-tier) outcome bucket. The bare modelId is the aggregate. */
function outcomeBucketKey(modelId: string, reasoningTier: TaskProfile['reasoning']): string {
  return `${modelId}::${reasoningTier}`;
}

type ModelFailureState = {
  providerId: string;
  message: string;
  failedAt: string;
  failureCount: number;
};

/**
 * Model router – selects the best model given constraints, agent prefs,
 * and provider availability.
 */
export class ModelRouter {
  private providers = new Map<string, ProviderConfig>();
  private providerHealth = new Map<string, boolean>();
  private modelPreferences = new Map<string, ModelPreferenceStats>();
  private executionOutcomes = new Map<string, ModelOutcomeState>();
  private modelFailures = new Map<string, ModelFailureState>();
  private feedbackWeight = 1;
  /** Providers paused automatically this session (e.g. billing failure). ProviderId → reason string. */
  private sessionAutoDisabledProviders = new Map<string, string>();

  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config);
  }

  /**
   * Update subscription quota for a provider.
   * Called after each request to decrement remaining units, or after
   * a quota refresh (e.g. billing period reset, user reconfiguration).
   */
  updateSubscriptionQuota(providerId: string, quota: SubscriptionQuota): void {
    const provider = this.providers.get(providerId);
    if (provider) {
      this.providers.set(providerId, { ...provider, subscriptionQuota: quota });
    }
  }

  /** Get current subscription quota for a provider, if any. */
  getSubscriptionQuota(providerId: string): SubscriptionQuota | undefined {
    return this.providers.get(providerId)?.subscriptionQuota;
  }

  setProviderHealth(providerId: string, healthy: boolean): void {
    this.providerHealth.set(providerId, healthy);
  }

  isProviderHealthy(providerId: string): boolean {
    return this.providerHealth.get(providerId) ?? true;
  }

  /**
   * Mark a provider as automatically paused for this session (e.g. billing failure).
   * Sets provider health to false so it is excluded from all future routing candidates.
   */
  autoDisableProvider(providerId: string, reason: string): void {
    this.setProviderHealth(providerId, false);
    this.sessionAutoDisabledProviders.set(providerId, reason);
  }

  /** Returns the set of providers paused automatically this session and their reasons. */
  getSessionAutoDisabledProviders(): ReadonlyMap<string, string> {
    return this.sessionAutoDisabledProviders;
  }

  /** Dismisses all auto-paused provider notifications (clears the badge). Providers remain disabled. */
  clearSessionAutoDisabledProviders(): void {
    this.sessionAutoDisabledProviders.clear();
  }

  /**
   * Re-enable a provider that was previously auto-disabled (e.g. after a
   * transient billing blip that the user has resolved, or when AtlasMind
   * detects an ambiguous rate-limit error that resolved itself).
   * Also clears any per-model failure records for that provider.
   */
  reEnableProvider(providerId: string): void {
    this.setProviderHealth(providerId, true);
    this.sessionAutoDisabledProviders.delete(providerId);
    this.clearProviderFailures(providerId);
  }

  listProviders(): ProviderConfig[] {
    return [...this.providers.values()];
  }

  getProviderConfig(providerId: string): ProviderConfig | undefined {
    return this.providers.get(providerId);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    for (const provider of this.providers.values()) {
      const model = provider.models.find(candidate => candidate.id === modelId);
      if (model) {
        return model;
      }
    }

    return undefined;
  }

  getModelFailure(modelId: string): ModelFailureState | undefined {
    const failure = this.modelFailures.get(modelId);
    return failure ? { ...failure } : undefined;
  }

  getProviderFailureCount(providerId: string): number {
    let count = 0;
    for (const [modelId, failure] of this.modelFailures.entries()) {
      if (failure.providerId === providerId || modelId.startsWith(`${providerId}/`)) {
        count += 1;
      }
    }
    return count;
  }

  recordModelFailure(modelId: string, message: string): void {
    const providerId = this.getModelInfo(modelId)?.provider ?? (modelId.includes('/') ? modelId.split('/')[0] : 'unknown');
    const existing = this.modelFailures.get(modelId);
    this.modelFailures.set(modelId, {
      providerId,
      message,
      failedAt: new Date().toISOString(),
      failureCount: (existing?.failureCount ?? 0) + 1,
    });
  }

  clearModelFailure(modelId: string): void {
    this.modelFailures.delete(modelId);
  }

  clearProviderFailures(providerId: string): void {
    for (const [modelId, failure] of this.modelFailures.entries()) {
      if (failure.providerId === providerId || modelId.startsWith(`${providerId}/`)) {
        this.modelFailures.delete(modelId);
      }
    }
  }

  setModelPreferences(preferences: Record<string, ModelPreferenceStats>): void {
    this.modelPreferences = new Map(
      Object.entries(preferences)
        .filter(([, stats]) => Number.isFinite(stats.upVotes) && Number.isFinite(stats.downVotes))
        .map(([modelId, stats]) => [
          modelId,
          {
            upVotes: Math.max(0, Math.floor(stats.upVotes)),
            downVotes: Math.max(0, Math.floor(stats.downVotes)),
          },
        ]),
    );
  }

  /**
   * Record a task outcome for a specific model so the preference bias can
   * reward consistently successful models and penalise consistently failing
   * ones.  Uses fractional vote increments (PERFORMANCE_OUTCOME_WEIGHT)
   * rather than whole votes so the signal builds gradually and a single
   * bad result doesn't disproportionately exclude a useful model.
   */
  recordModelOutcome(modelId: string, success: boolean): void {
    const existing = this.modelPreferences.get(modelId) ?? { upVotes: 0, downVotes: 0 };
    if (success) {
      this.modelPreferences.set(modelId, {
        ...existing,
        upVotes: existing.upVotes + PERFORMANCE_OUTCOME_WEIGHT,
      });
    } else {
      this.modelPreferences.set(modelId, {
        ...existing,
        downVotes: existing.downVotes + PERFORMANCE_OUTCOME_WEIGHT,
      });
    }
  }

  getModelPreference(modelId: string): ModelPreferenceStats | undefined {
    const stats = this.modelPreferences.get(modelId);
    return stats ? { ...stats } : undefined;
  }

  /**
   * Direction 2 — outcome-driven routing. Record a graded execution-quality
   * signal (0 = failed, 1 = clean verified success) for a model. Maintained as a
   * decayed EWMA, separate from the manual thumbs feedback channel, so routing
   * adapts to how models actually perform on this project's work without
   * disturbing user feedback. Bounded downstream so it can nudge — never starve.
   *
   * When a `reasoningTier` is supplied the outcome is tracked **both** against the
   * model's aggregate and against a per-tier bucket (`modelId::tier`), so a model
   * that excels at high-reasoning work but struggles with mechanical tasks is
   * biased per task context. The aggregate key is the bare `modelId`, which keeps
   * the persisted format backward-compatible.
   */
  recordExecutionOutcome(modelId: string, quality: number, reasoningTier?: TaskProfile['reasoning']): void {
    if (!Number.isFinite(quality)) {
      return;
    }
    const q = Math.max(0, Math.min(1, quality));
    this.updateOutcomeBucket(modelId, q);
    if (reasoningTier) {
      this.updateOutcomeBucket(outcomeBucketKey(modelId, reasoningTier), q);
    }
  }

  private updateOutcomeBucket(key: string, quality: number): void {
    const existing = this.executionOutcomes.get(key);
    if (!existing) {
      this.executionOutcomes.set(key, { ewma: quality, samples: 1 });
      return;
    }
    this.executionOutcomes.set(key, {
      ewma: (OUTCOME_EWMA_ALPHA * quality) + ((1 - OUTCOME_EWMA_ALPHA) * existing.ewma),
      samples: existing.samples + 1,
    });
  }

  /** Returns the model's aggregate outcome, or the per-tier bucket when `reasoningTier` is given. */
  getExecutionOutcome(modelId: string, reasoningTier?: TaskProfile['reasoning']): ModelOutcomeState | undefined {
    const key = reasoningTier ? outcomeBucketKey(modelId, reasoningTier) : modelId;
    const stats = this.executionOutcomes.get(key);
    return stats ? { ...stats } : undefined;
  }

  /** Snapshot all execution outcomes (for persistence across sessions). */
  getExecutionOutcomes(): Record<string, ModelOutcomeState> {
    return Object.fromEntries([...this.executionOutcomes.entries()].map(([id, s]) => [id, { ...s }]));
  }

  /** Restore persisted execution outcomes. */
  setExecutionOutcomes(outcomes: Record<string, ModelOutcomeState>): void {
    this.executionOutcomes = new Map(
      Object.entries(outcomes)
        .filter(([, s]) => Number.isFinite(s.ewma) && Number.isFinite(s.samples))
        .map(([id, s]) => [id, {
          ewma: Math.max(0, Math.min(1, s.ewma)),
          samples: Math.max(0, Math.floor(s.samples)),
        }]),
    );
  }

  setFeedbackWeight(weight: number): void {
    if (!Number.isFinite(weight)) {
      return;
    }
    this.feedbackWeight = Math.max(0, Math.min(2, weight));
  }

  getFeedbackWeight(): number {
    return this.feedbackWeight;
  }

  /**
   * Select the best model for the given constraints and optional model whitelist.
   * Returns a model ID string.
   */
  selectModel(
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): string {
    return this.selectBestModel(constraints, allowedModels, taskProfile) ?? 'local/echo-1';
  }

  selectBestModel(
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): string | undefined {
    // Role-based routing pin (Direction 3): honour an explicit preferredModel when
    // it is genuinely usable, bypassing budget/speed gates since it is deliberate.
    if (constraints.preferredModel) {
      const pinned = this.resolvePinnedModel(constraints, allowedModels, taskProfile);
      if (pinned) {
        return pinned;
      }
    }

    const candidates = this.getCandidateModels(constraints, allowedModels, taskProfile);
    if (candidates.length === 0) {
      return undefined;
    }

    const sorted = candidates
      .map(model => ({ model, score: this.scoreModel(model, constraints, taskProfile) }))
      .sort((a, b) => b.score - a.score);

    return sorted[0].model.id;
  }

  listCandidateModelIds(
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): string[] {
    return this.getCandidateModels(constraints, allowedModels, taskProfile).map(model => model.id);
  }

  /**
   * Select models for N parallel slots.
   *
   * Fills subscription/free slots first, then overflows to the best
   * pay-per-token candidates.  Returns an array of model IDs with
   * length equal to `slots`.
   */
  selectModelsForParallel(
    slots: number,
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): string[] {
    if (slots <= 0) {
      return [];
    }
    if (slots === 1) {
      return [this.selectModel(constraints, allowedModels, taskProfile)];
    }

    // Get all candidates and score them *without* parallel penalty.
    const baseCandidates = this.getCandidateModels(constraints, allowedModels, taskProfile);
    if (baseCandidates.length === 0) {
      return Array.from({ length: slots }, () => 'local/echo-1');
    }

    const scored = baseCandidates
      .map(model => {
        const provider = this.providers.get(model.provider);
        const pricing = provider?.pricingModel ?? 'pay-per-token';
        // Exhausted subscription → treat as pay-per-token for slot allocation.
        const effectivePricing = (pricing === 'subscription' &&
          provider?.subscriptionQuota &&
          provider.subscriptionQuota.remainingRequests <= 0)
          ? 'pay-per-token' as const
          : pricing;
        return {
          model,
          score: this.scoreModel(model, { ...constraints, parallelSlots: 1 }, taskProfile),
          pricing: effectivePricing,
        };
      })
      .sort((a, b) => b.score - a.score);

    const result: string[] = [];

    // Fill first slot with the best subscription/free model (if available and has quota).
    const subscriptionModels = scored.filter(c => c.pricing === 'subscription' || c.pricing === 'free');
    const payPerToken = scored.filter(c => c.pricing === 'pay-per-token');

    if (subscriptionModels.length > 0) {
      result.push(subscriptionModels[0].model.id);
    }

    // Remaining slots: best available pay-per-token, or cycle subscription if no API available.
    const overflow = payPerToken.length > 0 ? payPerToken : scored;
    while (result.length < slots) {
      const pick = overflow[result.length % overflow.length] ?? scored[0];
      result.push(pick.model.id);
    }

    return result;
  }

  /**
   * Resolves an explicit `preferredModel` pin to a usable model id, or undefined
   * when the pin is not genuinely available. Applies the same availability checks
   * as candidate selection (provider/model enabled + healthy, not deprecated, not
   * recently failed, within any allow-list, satisfies required capabilities) but
   * deliberately bypasses the budget and speed gates — a role pin is an explicit
   * choice that should hold even for an out-of-budget-tier model.
   */
  private resolvePinnedModel(
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): string | undefined {
    const modelId = constraints.preferredModel;
    if (!modelId) {
      return undefined;
    }
    if (allowedModels && allowedModels.length > 0 && !allowedModels.includes(modelId)) {
      return undefined;
    }
    const info = this.getModelInfo(modelId);
    if (!info || !info.enabled) {
      return undefined;
    }
    const provider = this.providers.get(info.provider);
    if (!provider || !provider.enabled || !this.isProviderHealthy(info.provider)) {
      return undefined;
    }
    if (info.deprecatedAt && new Date(info.deprecatedAt) <= new Date()) {
      return undefined;
    }
    const failure = this.modelFailures.get(modelId);
    if (failure && Date.now() - new Date(failure.failedAt).getTime() < MODEL_FAILURE_TTL_MS) {
      return undefined;
    }
    const requiredCapabilities = [
      ...(constraints.requiredCapabilities ?? []),
      ...(taskProfile?.requiredCapabilities ?? []),
    ];
    if (requiredCapabilities.some(capability => !info.capabilities.includes(capability))) {
      return undefined;
    }
    return info.id;
  }

  private getCandidateModels(
    constraints: RoutingConstraints,
    allowedModels?: string[],
    taskProfile?: TaskProfile,
  ): ModelInfo[] {
    const whitelist = allowedModels && allowedModels.length > 0
      ? new Set(allowedModels)
      : undefined;
    const requiredCapabilities = new Set<ModelCapability>([
      ...(constraints.requiredCapabilities ?? []),
      ...(taskProfile?.requiredCapabilities ?? []),
    ]);

    const allCandidates: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      if (!provider.enabled) {
        continue;
      }
      if (!this.isProviderHealthy(provider.id)) {
        continue;
      }
      if (constraints.preferredProvider && provider.id !== constraints.preferredProvider) {
        continue;
      }

      for (const model of provider.models) {
        if (!model.enabled) {
          continue;
        }
        // Skip models past their deprecation date.
        if (model.deprecatedAt && new Date(model.deprecatedAt) <= new Date()) {
          continue;
        }
        // Skip models with recent failures; clear stale failures automatically.
        const failure = this.modelFailures.get(model.id);
        if (failure) {
          if (Date.now() - new Date(failure.failedAt).getTime() < MODEL_FAILURE_TTL_MS) {
            continue;
          }
          this.modelFailures.delete(model.id);
        }
        if (whitelist && !whitelist.has(model.id)) {
          continue;
        }
        if ([...requiredCapabilities].some(capability => !model.capabilities.includes(capability))) {
          continue;
        }
        if (!this.matchesBudgetGate(model, constraints.budget, taskProfile)) {
          continue;
        }
        if (!this.matchesSpeedGate(model, constraints.speed, taskProfile)) {
          continue;
        }
        allCandidates.push(model);
      }
    }

    const hasRealCandidate = allCandidates.some(model => !isBuiltinLocalEchoModel(model));
    if (hasRealCandidate) {
      return allCandidates.filter(model => !isBuiltinLocalEchoModel(model));
    }

    return allCandidates;
  }

  private scoreModel(model: ModelInfo, constraints: RoutingConstraints, taskProfile?: TaskProfile): number {
    const provider = this.providers.get(model.provider);
    const parallelSlots = constraints.parallelSlots ?? 1;

    const effectiveCost = this.effectiveCostPer1k(model, provider, parallelSlots, constraints.cacheablePrefixRatio);
    const cheapness = this.scoreCheapness(effectiveCost);

    const speedProxy = scoreSpeedTier(this.classifySpeedTier(model));
    const depth = getReasoningDepth(model);
    const qualityProxy = depth >= 3 ? 1.5 : depth === 2 ? 1.35 : depth === 1 ? 1.1 : model.capabilities.includes('code') ? 1.1 : 1;
    const taskFit = this.scoreTaskFit(model, taskProfile);

    const budgetWeight = this.weightForBudget(constraints.budget);
    const speedWeight = this.weightForSpeed(constraints.speed);
    const qualityWeight = constraints.budget === 'cheap' ? QUALITY_WEIGHT_CHEAP : QUALITY_WEIGHT_NORMAL;
    const healthWeight = this.isProviderHealthy(model.provider) ? PROVIDER_HEALTH_BONUS : 0;
    const preferenceBias = this.scorePreferenceBias(model.id);

    const localBonus = this.scoreLocalPreference(model, taskProfile);
    const subscriptionBonus = this.scoreActiveSubscriptionPreference(model);
    const outcomeBias = this.scoreOutcomeBias(model.id, taskProfile);

    return (cheapness * budgetWeight) + (speedProxy * speedWeight) + (qualityProxy * qualityWeight) + taskFit + healthWeight + preferenceBias + localBonus + subscriptionBonus + outcomeBias;
  }

  /**
   * Direction 2 — bounded routing nudge from a model's decayed execution-outcome
   * EWMA. Returns 0 until enough samples exist (cold start) or when learned-routing
   * weight is disabled. Scaled by `feedbackWeight` (the same `feedbackRoutingWeight`
   * control as manual feedback) and clamped to ±`OUTCOME_BIAS_MAX` so a struggling
   * model is nudged down without being excluded.
   */
  private scoreOutcomeBias(modelId: string, taskProfile?: TaskProfile): number {
    if (this.feedbackWeight <= 0) {
      return 0;
    }
    // Prefer the per-tier bucket matching this task's reasoning level when it has
    // enough samples; otherwise fall back to the model's aggregate record.
    const tier = taskProfile?.reasoning;
    const tierStats = tier ? this.executionOutcomes.get(outcomeBucketKey(modelId, tier)) : undefined;
    const stats = (tierStats && tierStats.samples >= MIN_OUTCOME_SAMPLES)
      ? tierStats
      : this.executionOutcomes.get(modelId);
    if (!stats || stats.samples < MIN_OUTCOME_SAMPLES) {
      return 0;
    }
    const raw = (stats.ewma - OUTCOME_NEUTRAL_BASELINE) * this.feedbackWeight;
    return Math.max(-OUTCOME_BIAS_MAX, Math.min(OUTCOME_BIAS_MAX, raw));
  }

  /**
   * General nudge for an active subscription provider whose quota is not
   * exhausted. Complements the maintenance-only `SUBSCRIPTION_MAINTENANCE_BONUS`
   * so a paid-for subscription is preferred over pay-per-token on ordinary work
   * too. Quota-aware: returns 0 once the subscription is depleted, since the
   * router then treats it as pay-per-token.
   */
  private scoreActiveSubscriptionPreference(model: ModelInfo): number {
    const provider = this.providers.get(model.provider);
    if (provider?.pricingModel !== 'subscription') {
      return 0;
    }
    const quota = provider.subscriptionQuota;
    const hasQuota = !quota || quota.remainingRequests > 0;
    return hasQuota ? ACTIVE_SUBSCRIPTION_BONUS : 0;
  }

  private scoreLocalPreference(model: ModelInfo, taskProfile?: TaskProfile): number {
    // Maintenance tasks (session summarization) strongly prefer local/free models
    // to avoid quota consumption on background housekeeping.
    if (taskProfile?.phase === 'maintenance') {
      if (isBuiltinLocalEchoModel(model)) return 0;
      const provider = this.providers.get(model.provider);
      const pricing = provider?.pricingModel ?? 'pay-per-token';
      if (model.provider === 'local') return model.contextWindow >= LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW ? LOCAL_MAINTENANCE_LARGE_BONUS : LOCAL_MAINTENANCE_SMALL_BONUS;
      if (pricing === 'free') return FREE_MAINTENANCE_BONUS;
      if (pricing === 'subscription') return SUBSCRIPTION_MAINTENANCE_BONUS;
      return PAYPETOKEN_MAINTENANCE_PENALTY;
    }

    if (model.provider !== 'local' || isBuiltinLocalEchoModel(model)) return 0;
    // Penalise local models that lack the reasoning depth for high-reasoning tasks.
    if (taskProfile?.reasoning === 'high' && getReasoningDepth(model) === 0) return LOCAL_HIGH_REASONING_PENALTY;
    if (taskProfile?.phase === 'planning' && getReasoningDepth(model) === 0) return LOCAL_PLANNING_PENALTY;
    if (model.contextWindow < CONTEXT_GATE_MEDIUM) return 0;
    const hasToolSupport = model.capabilities.includes('function_calling');
    const hasCodeSupport = model.capabilities.includes('code');
    if (taskProfile?.reasoning === 'low') return hasToolSupport ? 0.4 : 0.2;
    if (taskProfile?.reasoning === 'medium') return hasToolSupport && hasCodeSupport ? 0.3 : hasToolSupport ? 0.15 : 0;
    return getReasoningDepth(model) > 0 ? 0.2 : 0;
  }

  private scorePreferenceBias(modelId: string): number {
    if (this.feedbackWeight <= 0) {
      return 0;
    }

    const stats = this.modelPreferences.get(modelId);
    if (!stats) {
      return 0;
    }

    const totalVotes = stats.upVotes + stats.downVotes;
    if (totalVotes <= 0) {
      return 0;
    }

    const dampedPreference = (stats.upVotes - stats.downVotes) / (totalVotes + PREFERENCE_BIAS_SMOOTH);
    return Math.max(-PREFERENCE_BIAS_MAX, Math.min(PREFERENCE_BIAS_MAX, dampedPreference * PREFERENCE_BIAS_MAX * this.feedbackWeight));
  }

  private scoreCheapness(effectiveCost: number): number {
    // Keep zero-cost providers attractive without letting them dominate every
    // higher-stakes turn purely on price.
    return 1 / (1 + (Math.max(0, effectiveCost) * 1000));
  }

  /**
   * Compute the effective cost per 1K tokens for scoring purposes.
   *
   * For subscription providers with quota remaining, effective cost accounts
   * for the real cost-per-request-unit from the subscription divided by
   * the premium multiplier, making expensive models (e.g. Opus 4 at 3×)
   * comparable to cheaper subscription models (e.g. GPT-4o at 1×).
   *
   * When quota is exhausted or nearly so, the provider is treated like
   * pay-per-token at listed API prices.
   *
   * When `parallelSlots > 1`, subscription advantage is blended toward
   * listed cost so pay-per-token providers can absorb overflow.
   */
  /**
   * Projects the per-1K input price for this turn, accounting for prompt
   * caching. When a cacheable prefix ratio is supplied and the model is
   * cache-capable, the cacheable share is priced at the cache-read rate.
   *
   * Cache capability is data-driven so it tracks provider changes: the model's
   * own `supportsPromptCaching` flag (sourced dynamically via discovery hints /
   * pricing sync / catalog) is authoritative; `CACHE_CAPABLE_PROVIDERS` is only
   * a bootstrap fallback for models that have not yet been annotated. An
   * explicit `false` from a provider therefore overrides the fallback.
   */
  private projectedInputPricePer1k(model: ModelInfo, cacheablePrefixRatio?: number): number {
    const ratio = Math.max(0, Math.min(MAX_CACHEABLE_PREFIX_RATIO, cacheablePrefixRatio ?? 0));
    if (ratio <= 0) {
      return model.inputPricePer1k;
    }
    const cacheCapable = model.supportsPromptCaching ?? CACHE_CAPABLE_PROVIDERS.has(model.provider);
    if (!cacheCapable) {
      return model.inputPricePer1k;
    }
    const cacheReadFactor = PROVIDER_CACHE_READ_FACTOR[model.provider] ?? DEFAULT_CACHE_READ_FACTOR;
    const cachedPrice = model.cachedInputPricePer1k ?? model.inputPricePer1k * cacheReadFactor;
    return (cachedPrice * ratio) + (model.inputPricePer1k * (1 - ratio));
  }

  /**
   * Public cache-read price per 1K input tokens for a model — the explicit
   * `cachedInputPricePer1k` when known, else `inputPricePer1k ×` the model's
   * per-provider cache factor. Returns the full input price for models that are
   * not cache-capable. Used by cost accounting to value cache savings.
   */
  cacheReadPricePer1k(model: ModelInfo): number {
    const cacheCapable = model.supportsPromptCaching ?? CACHE_CAPABLE_PROVIDERS.has(model.provider);
    if (!cacheCapable) {
      return model.inputPricePer1k;
    }
    const factor = PROVIDER_CACHE_READ_FACTOR[model.provider] ?? DEFAULT_CACHE_READ_FACTOR;
    return model.cachedInputPricePer1k ?? model.inputPricePer1k * factor;
  }

  private effectiveCostPer1k(
    model: ModelInfo,
    provider: ProviderConfig | undefined,
    parallelSlots: number,
    cacheablePrefixRatio?: number,
  ): number {
    const pricing = provider?.pricingModel ?? 'pay-per-token';
    // Account for extended-thinking models that emit large scratchpad token volumes:
    // thinkingTokenMultiplier scales the output cost so the router projects a
    // realistic total rather than just the visible output tokens.
    const thinkingMultiplier = model.thinkingTokenMultiplier ?? 1;
    const projectedInput = this.projectedInputPricePer1k(model, cacheablePrefixRatio);
    const listedCost = projectedInput + (model.outputPricePer1k * thinkingMultiplier);
    const multiplier = model.premiumRequestMultiplier ?? 1;

    if (pricing === 'pay-per-token') {
      return listedCost;
    }

    // If subscription quota is configured, check remaining.
    const quota = provider?.subscriptionQuota;
    if (quota) {
      const quotaFraction = quota.totalRequests > 0
        ? quota.remainingRequests / quota.totalRequests
        : 0;

      // Quota exhausted → treat as pay-per-token.
      if (quota.remainingRequests <= 0) {
        return listedCost;
      }

      // If we have costPerRequestUnit, compute a real effective cost that
      // accounts for the premium multiplier.
      // e.g. $0.033/unit × 3× multiplier = $0.099 effective per request.
      // This lets the router prefer 1× models over 3× models within the
      // same subscription when the task doesn't need the premium model.
      if (quota.costPerRequestUnit !== undefined) {
        const subscriptionCost = quota.costPerRequestUnit * multiplier;

        // As quota depletes, blend toward listed API cost.
        // Above 30% remaining → pure subscription cost.
        // Below 30% → interpolate toward listed cost (conserve quota).
        let blendedCost = subscriptionCost;
        if (quotaFraction < QUOTA_CONSERVATION_THRESHOLD) {
          const depletionFactor = 1 - (quotaFraction / QUOTA_CONSERVATION_THRESHOLD);
          blendedCost = subscriptionCost + (listedCost - subscriptionCost) * depletionFactor;
        }

        // Apply parallel slot damping
        if (parallelSlots > 1) {
          const slotBlend = Math.min(1, (parallelSlots - 1) / 3);
          return blendedCost + (listedCost - blendedCost) * slotBlend;
        }
        return blendedCost;
      }

      // No costPerRequestUnit — use simple quota-aware zero-cost approach.
      if (quotaFraction < QUOTA_CONSERVATION_THRESHOLD) {
        const depletionFactor = 1 - (quotaFraction / QUOTA_CONSERVATION_THRESHOLD);
        const baseCost = listedCost * multiplier * depletionFactor;
        if (parallelSlots > 1) {
          const slotBlend = Math.min(1, (parallelSlots - 1) / 3);
          return baseCost + (listedCost - baseCost) * slotBlend;
        }
        return baseCost;
      }
    }

    // Free provider or subscription with ample quota — zero effective cost.
    if (parallelSlots <= 1) {
      return 0;
    }

    const slotBlend = Math.min(1, (parallelSlots - 1) / 3);
    return listedCost * slotBlend;
  }

  private scoreTaskFit(model: ModelInfo, taskProfile?: TaskProfile): number {
    if (!taskProfile) {
      return 0;
    }

    let score = 0;
    const depth = getReasoningDepth(model);

    for (const capability of taskProfile.preferredCapabilities) {
      if (capability === 'reasoning') {
        // Graduated reward for reasoning capability preference.
        score += depth >= 3 ? 1 : depth === 2 ? 0.7 : depth === 1 ? 0.3 : 0;
      } else if (model.capabilities.includes(capability)) {
        score += TASK_FIT_CAPABILITY_SCORE;
      }
    }

    if (taskProfile.phase === 'planning' || taskProfile.phase === 'synthesis') {
      if (depth >= 2) {
        score += 0.9;
      } else if (depth === 1) {
        score += 0.3;
      } else {
        score -= 0.75;
      }
    }

    if (taskProfile.phase === 'execution' && (taskProfile.modality === 'code' || taskProfile.modality === 'mixed')) {
      if (model.capabilities.includes('code')) {
        score += 0.7;
      }
    }

    if (taskProfile.reasoning === 'high') {
      // Graduated bonus/penalty — avoids the hard binary cliff that excluded
      // medium-reasoning models from all high-reasoning tasks.
      if (depth >= 3) score += 1.1;
      else if (depth === 2) score += 0.55;
      else if (depth === 1) score += 0.1;
      else score -= 1.25;

      // Smooth context-window penalty: linearly interpolates from 0 (at CONTEXT_GATE_SMALL)
      // to -0.35 (at context window → 0), so new models with very large windows aren't
      // rewarded beyond zero and tiny-context models degrade proportionally.
      if (model.contextWindow < CONTEXT_GATE_SMALL) {
        score -= 0.35 * (1 - model.contextWindow / CONTEXT_GATE_SMALL);
      }
    } else if (taskProfile.reasoning === 'medium') {
      if (depth >= 2) {
        score += 0.35;
      } else if (model.contextWindow < CONTEXT_GATE_MEDIUM) {
        // Smooth penalty for medium-reasoning tasks on very small context models.
        score -= 0.2 * (1 - model.contextWindow / CONTEXT_GATE_MEDIUM);
      }
    }

    return score;
  }

  private matchesBudgetGate(model: ModelInfo, mode: BudgetMode, taskProfile?: TaskProfile): boolean {
    const provider = this.providers.get(model.provider);
    if (provider?.pricingModel === 'free') {
      return true;
    }
    if (provider?.pricingModel === 'subscription') {
      const quota = provider.subscriptionQuota;
      const hasQuota = !quota || quota.remainingRequests > 0;
      if (hasQuota) {
        const multiplier = model.premiumRequestMultiplier ?? 1;
        if (mode === 'cheap') return multiplier <= 1;
        // balanced mode: gate out high-premium subscription models (>2× ≈ Opus-tier cost).
        if (mode === 'balanced') return multiplier <= 2;
        // auto/expensive: allow all subscription models with quota remaining.
        return true;
      }
      // Quota exhausted → fall through to normal budget gating.
    }
    const tier = this.classifyBudgetTier(model);
    const allowedTiers = allowedBudgetTiers(mode, taskProfile);
    return allowedTiers.has(tier);
  }

  private matchesSpeedGate(model: ModelInfo, mode: SpeedMode, taskProfile?: TaskProfile): boolean {
    const tier = this.classifySpeedTier(model);
    const allowedTiers = allowedSpeedTiers(mode, taskProfile);
    return allowedTiers.has(tier);
  }

  private classifyBudgetTier(model: ModelInfo): BudgetMode {
    const totalPricePer1k = model.inputPricePer1k + model.outputPricePer1k;
    if (totalPricePer1k <= BUDGET_TIER_CHEAP_THRESHOLD_USD) {
      return 'cheap';
    }
    if (totalPricePer1k <= BUDGET_TIER_BALANCED_THRESHOLD_USD) {
      return 'balanced';
    }
    return 'expensive';
  }

  private classifySpeedTier(model: ModelInfo): Exclude<SpeedMode, 'auto'> {
    if (model.provider === 'local' && !isBuiltinLocalEchoModel(model)) return 'balanced';
    // latencyClass is the authoritative annotation; fall back to heuristics only when absent.
    if (model.latencyClass === 'fast') return 'fast';
    if (model.latencyClass === 'slow') return 'considered';
    if (model.latencyClass === 'balanced') return 'balanced';
    // Heuristic fallback for unannotated models.
    const depth = getReasoningDepth(model);
    if (depth >= 3 && model.contextWindow >= CONTEXT_GATE_LARGE) return 'considered';
    if (depth === 0 && model.contextWindow <= CONTEXT_GATE_FAST) return 'fast';
    return 'balanced';
  }

  private weightForBudget(mode: RoutingConstraints['budget']): number {
    switch (mode) {
      case 'cheap':
        return CHEAP_MODE_BUDGET_WEIGHT;
      case 'expensive':
        return 0.5;
      case 'balanced':
      case 'auto':
      default:
        return 1.5;
    }
  }

  private weightForSpeed(mode: RoutingConstraints['speed']): number {
    switch (mode) {
      case 'fast':
        return FAST_MODE_SPEED_WEIGHT;
      case 'considered':
        return 0.75;
      case 'balanced':
      case 'auto':
      default:
        return 1.5;
    }
  }
}

/**
 * Estimates the fraction of a turn's input that is a stable, cacheable prefix
 * (system prompt + memory bundle + tool definitions reused across turns) versus
 * volatile per-turn content. Returned ratio is capped at `MAX_CACHEABLE_PREFIX_RATIO`
 * so the router never assumes a perfect cache hit. Pass token estimates (or any
 * proportional size measure) for the stable prefix and the volatile remainder.
 */
export function estimateCacheablePrefixRatio(stablePrefixTokens: number, volatileTokens: number): number {
  const stable = Math.max(0, stablePrefixTokens);
  const volatile = Math.max(0, volatileTokens);
  const total = stable + volatile;
  if (total <= 0) {
    return 0;
  }
  return Math.min(MAX_CACHEABLE_PREFIX_RATIO, stable / total);
}

function allowedBudgetTiers(mode: BudgetMode, taskProfile?: TaskProfile): Set<BudgetMode> {
  switch (mode) {
    case 'cheap':
      return new Set(['cheap']);
    case 'balanced':
      return new Set(['cheap', 'balanced']);
    case 'expensive':
      return new Set(['cheap', 'balanced', 'expensive']);
    case 'auto':
    default:
      if (taskProfile?.reasoning === 'high') {
        // Include cheap so capable local reasoners (e.g. DeepSeek R1) remain candidates;
        // scoring penalises shallow models instead of hard-gating them.
        return new Set(['cheap', 'balanced', 'expensive']);
      }
      if (taskProfile?.reasoning === 'medium') {
        return new Set(['cheap', 'balanced']);
      }
      return new Set(['cheap', 'balanced']);
  }
}

function allowedSpeedTiers(mode: SpeedMode, taskProfile?: TaskProfile): Set<Exclude<SpeedMode, 'auto'>> {
  switch (mode) {
    case 'fast':
      return new Set(['fast']);
    case 'balanced':
      return new Set(['fast', 'balanced']);
    case 'considered':
      return new Set(['balanced', 'considered']);
    case 'auto':
    default:
      if (taskProfile?.reasoning === 'high') {
        return new Set(['balanced', 'considered']);
      }
      return new Set(['fast', 'balanced']);
  }
}

function scoreSpeedTier(tier: Exclude<SpeedMode, 'auto'>): number {
  switch (tier) {
    case 'fast':
      return 1.5;
    case 'balanced':
      return 1;
    case 'considered':
      return 0.6;
  }
}

function isBuiltinLocalEchoModel(model: ModelInfo): boolean {
  return model.provider === 'local' && model.id === 'local/echo-1';
}

/** Returns a numeric reasoning depth for a model, regardless of whether it
 *  has an explicit reasoningDepth annotation or only a legacy 'reasoning' capability tag. */
function getReasoningDepth(model: ModelInfo): number {
  if (model.reasoningDepth !== undefined) return model.reasoningDepth;
  return model.capabilities.includes('reasoning') ? 2 : 0;
}

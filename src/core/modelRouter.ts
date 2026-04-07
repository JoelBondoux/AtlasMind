import type { BudgetMode, ModelCapability, ModelInfo, ProviderConfig, RoutingConstraints, SpeedMode, SubscriptionQuota, TaskProfile } from '../types.js';

type ModelPreferenceStats = {
  upVotes: number;
  downVotes: number;
};

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
  private modelFailures = new Map<string, ModelFailureState>();
  private feedbackWeight = 1;

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

  getModelPreference(modelId: string): ModelPreferenceStats | undefined {
    const stats = this.modelPreferences.get(modelId);
    return stats ? { ...stats } : undefined;
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
        if (this.modelFailures.has(model.id)) {
          continue;
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

    const effectiveCost = this.effectiveCostPer1k(model, provider, parallelSlots);
    const cheapness = this.scoreCheapness(effectiveCost);

    const speedProxy = scoreSpeedTier(this.classifySpeedTier(model));
    const qualityProxy = model.capabilities.includes('reasoning')
      ? 1.5
      : model.capabilities.includes('code')
        ? 1.2
        : 1;
    const taskFit = this.scoreTaskFit(model, taskProfile);

    const budgetWeight = this.weightForBudget(constraints.budget);
    const speedWeight = this.weightForSpeed(constraints.speed);
    const qualityWeight = constraints.budget === 'cheap' ? 0.5 : 1;
    const healthWeight = this.isProviderHealthy(model.provider) ? 1.25 : 0;
    const preferenceBias = this.scorePreferenceBias(model.id);

    return (cheapness * budgetWeight) + (speedProxy * speedWeight) + (qualityProxy * qualityWeight) + taskFit + healthWeight + preferenceBias;
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

    const dampedPreference = (stats.upVotes - stats.downVotes) / (totalVotes + 4);
    return Math.max(-0.25, Math.min(0.25, dampedPreference * 0.25 * this.feedbackWeight));
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
  private effectiveCostPer1k(model: ModelInfo, provider: ProviderConfig | undefined, parallelSlots: number): number {
    const pricing = provider?.pricingModel ?? 'pay-per-token';
    const listedCost = model.inputPricePer1k + model.outputPricePer1k;
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
        const conservationThreshold = 0.3;
        let blendedCost = subscriptionCost;
        if (quotaFraction < conservationThreshold) {
          const depletionFactor = 1 - (quotaFraction / conservationThreshold);
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
      // As quota depletes below 30%, blend toward listed cost.
      const conservationThreshold = 0.3;
      if (quotaFraction < conservationThreshold) {
        const depletionFactor = 1 - (quotaFraction / conservationThreshold);
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
    for (const capability of taskProfile.preferredCapabilities) {
      if (model.capabilities.includes(capability)) {
        score += capability === 'reasoning' ? 1 : 0.6;
      }
    }

    if (taskProfile.phase === 'planning' || taskProfile.phase === 'synthesis') {
      if (model.capabilities.includes('reasoning')) {
        score += 0.9;
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
      if (model.capabilities.includes('reasoning')) {
        score += 1.1;
      } else {
        score -= 1.25;
      }
      if (model.contextWindow < 32000) {
        score -= 0.35;
      }
    } else if (taskProfile.reasoning === 'medium') {
      if (model.capabilities.includes('reasoning')) {
        score += 0.35;
      } else if (model.contextWindow < 16000) {
        score -= 0.2;
      }
    }

    return score;
  }

  private matchesBudgetGate(model: ModelInfo, mode: BudgetMode, taskProfile?: TaskProfile): boolean {
    // Subscription and free models pass budget gates only if quota remains.
    // Exhausted subscriptions are treated as pay-per-token for gating.
    const provider = this.providers.get(model.provider);
    if (provider?.pricingModel === 'free') {
      return true;
    }
    if (provider?.pricingModel === 'subscription') {
      const quota = provider.subscriptionQuota;
      // No quota tracking configured → assume ample quota, pass gate.
      if (!quota) {
        return true;
      }
      // Quota remaining → pass gate.
      if (quota.remainingRequests > 0) {
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
    if (totalPricePer1k <= 0.0015) {
      return 'cheap';
    }
    if (totalPricePer1k <= 0.008) {
      return 'balanced';
    }
    return 'expensive';
  }

  private classifySpeedTier(model: ModelInfo): Exclude<SpeedMode, 'auto'> {
    if (!model.capabilities.includes('reasoning') && model.contextWindow <= 128000) {
      return 'fast';
    }
    if (model.capabilities.includes('reasoning') && model.contextWindow >= 200000) {
      return 'considered';
    }
    return 'balanced';
  }

  private weightForBudget(mode: RoutingConstraints['budget']): number {
    switch (mode) {
      case 'cheap':
        return 3;
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
        return 3;
      case 'considered':
        return 0.75;
      case 'balanced':
      case 'auto':
      default:
        return 1.5;
    }
  }
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
        return new Set(['balanced', 'expensive']);
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

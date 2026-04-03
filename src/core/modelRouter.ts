import type { BudgetMode, ModelCapability, ModelInfo, ProviderConfig, RoutingConstraints, SpeedMode, TaskProfile } from '../types.js';

/**
 * Model router – selects the best model given constraints, agent prefs,
 * and provider availability.
 *
 * Stub implementation returns a placeholder model name.
 */
export class ModelRouter {
  private providers = new Map<string, ProviderConfig>();
  private providerHealth = new Map<string, boolean>();

  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config);
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

  getModelInfo(modelId: string): ModelInfo | undefined {
    for (const provider of this.providers.values()) {
      const model = provider.models.find(candidate => candidate.id === modelId);
      if (model) {
        return model;
      }
    }

    return undefined;
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
    const candidates = this.getCandidateModels(constraints, allowedModels, taskProfile);
    if (candidates.length === 0) {
      return 'local/echo-1';
    }

    const sorted = candidates
      .map(model => ({ model, score: this.scoreModel(model, constraints, taskProfile) }))
      .sort((a, b) => b.score - a.score);

    return sorted[0].model.id;
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

    return allCandidates;
  }

  private scoreModel(model: ModelInfo, constraints: RoutingConstraints, taskProfile?: TaskProfile): number {
    const totalPricePer1k = model.inputPricePer1k + model.outputPricePer1k;
    const cheapness = 1 / Math.max(0.0001, totalPricePer1k);
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

    return (cheapness * budgetWeight) + (speedProxy * speedWeight) + (qualityProxy * qualityWeight) + taskFit + healthWeight;
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
      }
    }

    if (taskProfile.phase === 'execution' && (taskProfile.modality === 'code' || taskProfile.modality === 'mixed')) {
      if (model.capabilities.includes('code')) {
        score += 0.7;
      }
    }

    return score;
  }

  private matchesBudgetGate(model: ModelInfo, mode: BudgetMode, taskProfile?: TaskProfile): boolean {
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

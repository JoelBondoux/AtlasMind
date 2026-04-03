import type { ModelInfo, ProviderConfig, RoutingConstraints } from '../types.js';

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
  ): string {
    const candidates = this.getCandidateModels(constraints, allowedModels);
    if (candidates.length === 0) {
      return 'local/echo-1';
    }

    const sorted = candidates
      .map(model => ({ model, score: this.scoreModel(model, constraints) }))
      .sort((a, b) => b.score - a.score);

    return sorted[0].model.id;
  }

  private getCandidateModels(
    constraints: RoutingConstraints,
    allowedModels?: string[],
  ): ModelInfo[] {
    const whitelist = allowedModels && allowedModels.length > 0
      ? new Set(allowedModels)
      : undefined;

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
        if (constraints.requiredCapabilities?.some(capability => !model.capabilities.includes(capability))) {
          continue;
        }
        allCandidates.push(model);
      }
    }

    return allCandidates;
  }

  private scoreModel(model: ModelInfo, constraints: RoutingConstraints): number {
    const totalPricePer1k = model.inputPricePer1k + model.outputPricePer1k;
    const cheapness = 1 / Math.max(0.0001, totalPricePer1k);
    const speedProxy = 1 / Math.max(1, model.contextWindow);
    const qualityProxy = model.capabilities.includes('reasoning')
      ? 1.5
      : model.capabilities.includes('code')
        ? 1.2
        : 1;

    const budgetWeight = this.weightForBudget(constraints.budget);
    const speedWeight = this.weightForSpeed(constraints.speed);
    const qualityWeight = constraints.budget === 'cheap' ? 0.5 : 1;
    const healthWeight = this.isProviderHealthy(model.provider) ? 1.25 : 0;

    return (cheapness * budgetWeight) + (speedProxy * speedWeight) + (qualityProxy * qualityWeight) + healthWeight;
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

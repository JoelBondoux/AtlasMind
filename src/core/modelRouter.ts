import type { ProviderConfig, RoutingConstraints } from '../types.js';

/**
 * Model router – selects the best model given constraints, agent prefs,
 * and provider availability.
 *
 * Stub implementation returns a placeholder model name.
 */
export class ModelRouter {
  private providers = new Map<string, ProviderConfig>();

  registerProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config);
  }

  listProviders(): ProviderConfig[] {
    return [...this.providers.values()];
  }

  /**
   * Select the best model for the given constraints and optional model whitelist.
   * Returns a model ID string.
   */
  selectModel(
    constraints: RoutingConstraints,
    allowedModels?: string[],
  ): string {
    // TODO: implement real routing logic that considers:
    //   - constraints.budget
    //   - constraints.speed
    //   - constraints.preferredProvider
    //   - allowedModels whitelist
    //   - pricing data
    //   - context window requirements
    //   - provider availability

    // Stub: return a sensible default name
    if (constraints.budget === 'cheap') {
      return 'placeholder/cheap-model';
    }
    if (constraints.speed === 'fast') {
      return 'placeholder/fast-model';
    }
    return 'placeholder/balanced-model';
  }
}

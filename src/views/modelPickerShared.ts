/**
 * The models a surface may offer the operator, from the providers they have
 * actually configured.
 *
 * Extracted because two panels now ask the same question — the Model Comparison
 * panel and the chat composer's override picker — and a second copy would
 * eventually list a different set. The distinction that matters is *configured*
 * rather than *routable*: a model the router is currently de-weighting or
 * skipping is still one the operator paid for and may legitimately pin, and
 * hiding it would make the picker disagree with the Models tree for reasons
 * nobody could see.
 */

/** Just enough of the router to enumerate; keeps this module free of `vscode`. */
export interface ModelPickerRouterLike {
  listProviders(): ReadonlyArray<{ id: string; displayName?: string; models: ReadonlyArray<{ id: string; name?: string }> }>;
}

export interface PickableModel {
  /** Routing id, e.g. `anthropic/claude-sonnet-5`. What `preferredModel` takes. */
  id: string;
  /** Display name, falling back to the id so a nameless model is still pickable. */
  label: string;
  provider: string;
}

/**
 * Every model belonging to a configured provider, sorted for a stable list.
 *
 * `isConfigured` is injected and may reject: a provider whose credential check
 * throws is treated as unconfigured rather than being allowed to fail the whole
 * enumeration, because one broken provider must not empty the picker.
 */
export async function collectPickableModels(
  router: ModelPickerRouterLike,
  isConfigured: (providerId: string) => Promise<boolean>,
): Promise<PickableModel[]> {
  const providers = router.listProviders();
  const configured = await Promise.all(
    providers.map(async provider => {
      try {
        return await isConfigured(provider.id);
      } catch {
        return false;
      }
    }),
  );

  return providers
    .filter((_provider, index) => configured[index] === true)
    .flatMap(provider => provider.models.map(model => ({
      id: model.id,
      label: model.name && model.name.trim().length > 0 ? model.name : model.id,
      provider: provider.displayName && provider.displayName.trim().length > 0 ? provider.displayName : provider.id,
    })))
    // Sorted so the list cannot shuffle between renders for reasons the operator
    // cannot see; provider first, because that is how people narrow the search.
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label));
}

/**
 * How long a pinned model applies.
 *
 * `turn` is consumed by the next submission; `session` persists until cleared or
 * the window closes. Deliberately two options rather than a single sticky pin:
 * pinning a frontier model to compare one answer is a different intent from
 * changing how this conversation routes, and a single control would make the
 * cheap case as expensive as the deliberate one.
 */
export type ModelOverrideScope = 'turn' | 'session';

export interface ModelOverride {
  modelId: string;
  scope: ModelOverrideScope;
}

/**
 * Validate a requested pin against what the host itself listed.
 *
 * The webview sends a model id; this is what stops that id being anything other
 * than one of the models the host offered a moment ago. Routing would refuse an
 * unknown id anyway, but refusing it here keeps the rule where it can be read.
 */
export function resolveModelOverride(
  requested: { modelId: string | null; scope: ModelOverrideScope },
  available: readonly PickableModel[],
): ModelOverride | undefined | 'unknown-model' {
  if (requested.modelId === null) {
    return undefined;
  }
  return available.some(model => model.id === requested.modelId)
    ? { modelId: requested.modelId, scope: requested.scope }
    : 'unknown-model';
}

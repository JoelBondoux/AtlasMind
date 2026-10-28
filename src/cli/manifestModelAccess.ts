/**
 * Models for a Buzz persona, from the ACP agents its manifest names.
 *
 * The headless ACP process Buzz launches has no settings and no SecretStorage,
 * so the only providers it could reach were the `ATLASMIND_PROVIDER_*`
 * variables — none of which a subscription-only user has. The manifest now
 * carries the user's `atlasmind.acp.agents` launch settings; this module turns
 * them into the same `AcpAdapter` the editor routes through, and registers what
 * that adapter discovers with the same `inferModelMetadata` the editor uses, so
 * the persona and the chat panel cannot disagree about what `acp/claude#high`
 * is.
 *
 * Three rules.
 *
 * 1. **Completion only.** No permission policy is passed, which the adapter
 *    reads as a denial: an agent reached this way answers, it does not run its
 *    own tools. Delegation to an agent's tools stays an editor decision.
 * 2. **Discovered on first use, once.** Buzz starts several copies of an agent
 *    process, and probing at start-up would launch every subscription agent in
 *    every copy before anybody asked anything. The first prompt pays for it; a
 *    failed or slow discovery keeps the seeded catalogue and says so.
 * 3. **Launch settings, never credentials.** The adapter withholds every
 *    credential-shaped variable from the agent it starts — the Buzz key this
 *    process was handed included — exactly as it does in the editor.
 */

import { AcpAdapter } from '../providers/acp.js';
import type { ProviderAdapter } from '../providers/adapter.js';
import { inferModelMetadata, normalizeModelId } from '../providers/modelMetadataInference.js';
import type { ModelRouter } from '../core/modelRouter.js';
import type { ManifestModelAccess } from '../core/buzzPersonaManifest.js';

/** Discovery runs two probes per agent at most; the editor allows the same. */
const MANIFEST_MODEL_DISCOVERY_TIMEOUT_MS = 45_000;

export interface ManifestAcpAdapterOptions {
  access: ManifestModelAccess;
  workspaceRoot: string;
  clientVersion: string;
  /** `ATLASMIND_PASS_ENVIRONMENT`, as the CLI reads it. */
  passEnvironment: readonly string[];
  log: (message: string) => void;
}

/** The routed ACP adapter for a manifest's agents. Completion only; see rule 1. */
export function createManifestAcpAdapter(options: ManifestAcpAdapterOptions): AcpAdapter {
  return new AcpAdapter({
    agents: options.access.acpAgents.map(agent => ({ ...agent, args: [...(agent.args ?? [])] })),
    cwd: options.workspaceRoot,
    keepAlive: true,
    // The launch-mode question was answered in the editor; the manifest carries
    // the answer, so nothing here is waiting for a person.
    consoleModeChosen: true,
    hideConsoleWindows: options.access.hideConsoleWindows,
    clientVersion: options.clientVersion,
    passEnvironment: options.passEnvironment,
    onSafetyNotice: event => options.log(`ACP ${event.agentId}: ${event.text}`),
    onAgentNotice: event => options.log(`ACP ${event.agentId} notice: ${event.text}`),
    onEffortNotApplied: event => options.log(`ACP ${event.agentId}: effort ${event.requested} not applied — ${event.reason}`),
  });
}

export interface ManifestModelDiscovery {
  registered: number;
  healthy: boolean;
  /** Why the seeded catalogue was kept, when it was. */
  kept?: string;
}

/**
 * Ask the adapter what it can serve and register that with the router,
 * replacing the provider's seeded models. Never throws.
 */
export async function discoverManifestModels(
  modelRouter: ModelRouter,
  adapter: ProviderAdapter,
  timeoutMs = MANIFEST_MODEL_DISCOVERY_TIMEOUT_MS,
): Promise<ManifestModelDiscovery> {
  const provider = modelRouter.listProviders().find(candidate => candidate.id === adapter.providerId);
  if (!provider) {
    return { registered: 0, healthy: false, kept: `the router has no provider ${adapter.providerId}` };
  }
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  const discovery = (async () => {
    const healthy = await adapter.healthCheck();
    const hints = adapter.discoverModels
      ? await adapter.discoverModels()
      : (await adapter.listModels()).map(id => ({ id }));
    return { healthy, hints };
  })();
  try {
    const outcome = await Promise.race([discovery, timedOut]);
    if (outcome === 'timeout') {
      modelRouter.setProviderHealth(provider.id, false);
      return { registered: provider.models.length, healthy: false, kept: `discovery took longer than ${Math.round(timeoutMs / 1000)}s` };
    }
    modelRouter.setProviderHealth(provider.id, outcome.healthy);
    if (outcome.hints.length === 0) {
      return { registered: provider.models.length, healthy: outcome.healthy, kept: 'no signed-in agent reported a model' };
    }
    const seen = new Set<string>();
    const models = outcome.hints.flatMap(hint => {
      const id = normalizeModelId(provider.id, hint.id);
      if (seen.has(id)) {
        return [];
      }
      seen.add(id);
      return [inferModelMetadata(provider.id, id, hint)];
    });
    modelRouter.registerProvider({ ...provider, enabled: true, models });
    return { registered: models.length, healthy: outcome.healthy };
  } catch (error) {
    modelRouter.setProviderHealth(provider.id, false);
    return { registered: provider.models.length, healthy: false, kept: error instanceof Error ? error.message : String(error) };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Run `task` once, on first call, and hand every caller the same promise. */
export function once<T>(task: () => Promise<T>): () => Promise<T> {
  let started: Promise<T> | undefined;
  return () => {
    started ??= task();
    return started;
  };
}

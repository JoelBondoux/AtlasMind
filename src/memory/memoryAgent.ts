import type { AgentRegistry } from '../core/agentRegistry.js';
import type { ModelRouter } from '../core/modelRouter.js';
import type { TaskProfiler } from '../core/taskProfiler.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { resolveProviderIdForModel } from '../core/orchestrator.js';
import {
  backgroundSummarizationRunsAtAll,
  decideBackgroundSummarization,
  type BackgroundSummarizationMode,
} from '../core/backgroundMemoryPolicy.js';
import { dispatchGuardedCompletion } from '../core/modelEgress.js';
import type { MemoryEntry, RoutingConstraints } from '../types.js';
import type { MemoryManager } from './memoryManager.js';

/**
 * How a background memory call reports what happened.
 *
 * Injected rather than imported so this module stays free of `vscode`, and so a
 * test can assert that a refusal was *reported* rather than merely not done.
 */
export interface MemoryAgentReporter {
  /** A refusal or failure the user should be able to find. */
  failure(signature: string, message: string): void;
  /** An external destination actually received project memory. */
  externalDispatch(providerId: string): void;
}

export interface MemoryAgentGate {
  /** The configured mode, read fresh each call so a settings change takes effect. */
  mode(): BackgroundSummarizationMode;
  reporter: MemoryAgentReporter;
}

const MEMORY_CONSTRAINTS: RoutingConstraints = { budget: 'cheap', speed: 'fast' };
const MEMORY_MAX_TOKENS = 1200;
const MEMORY_TEMPERATURE = 0.2;
const SSOT_SNIPPET_MAX_CHARS = 500;

/**
 * Lightweight execution engine for all memory maintenance LLM calls.
 *
 * Uses cheap/local model routing (phase: 'maintenance', reasoning: 'low').
 * Respects the memory-agent AgentDefinition's allowedModels if configured.
 * All public methods are fire-and-forget safe — they return '' / [] on any error.
 */
export class MemoryAgentExecutor {
  constructor(
    private readonly router: ModelRouter,
    private readonly providers: ProviderRegistry,
    private readonly profiler: TaskProfiler,
    private readonly memory: MemoryManager,
    private readonly agentRegistry: AgentRegistry,
    /**
     * Absent means every background model call is refused.
     *
     * Deliberately fail-closed: a construction site that has not been updated to
     * supply a gate must not keep the old ungated behaviour, which is exactly how
     * this path stayed open. Callers that legitimately need a model supply one.
     */
    private readonly gate?: MemoryAgentGate,
  ) {}

  /**
   * Single LLM call for memory maintenance. Mirrors orchestrator.completeMaintenance()
   * but routes through the memory-agent's configured allowedModels.
   * Returns empty string on any error.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const mode = this.gate?.mode() ?? 'off';
    const reporter = this.gate?.reporter;

    // Checked before routing, deliberately. Refusing at the last moment would
    // still mean the prompt was assembled from file content that the mode says
    // must not leave the machine.
    if (!backgroundSummarizationRunsAtAll(mode)) {
      reporter?.failure(
        'summarization-off',
        'Background memory summarisation is off, so no model was called. '
        + 'Set atlasmind.memory.backgroundSummarizationMode to local-only or routed to enable it.',
      );
      return '';
    }

    const agentDef = this.agentRegistry.get('memory-agent');
    const allowedModels = agentDef?.allowedModels;

    const taskProfile = this.profiler.profileTask({
      userMessage: userPrompt,
      phase: 'maintenance',
      requiresTools: false,
    });

    const model = this.router.selectModel(MEMORY_CONSTRAINTS, allowedModels, taskProfile);
    // `'local'` here is a fallback for an unidentifiable model id, not a
    // constraint — see `resolveProviderIdForModel`. Locality is therefore
    // enforced below, against the provider that would actually receive the
    // bytes, which is the distinction this whole gate exists to draw.
    const providerId = resolveProviderIdForModel(model, this.router, 'local');

    const decision = decideBackgroundSummarization(mode, providerId);
    if (decision.status === 'blocked') {
      reporter?.failure(decision.rule, decision.reason);
      return '';
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      reporter?.failure('no-provider', `No provider adapter is registered for "${providerId}", so nothing was sent.`);
      return '';
    }

    if (decision.external) {
      // A routed background call reaching a cloud provider is exactly the event
      // that used to happen silently. It is now on the record before it happens.
      reporter?.externalDispatch(providerId);
    }

    try {
      const response = await dispatchGuardedCompletion({
        provider,
        // `background-memory` is the tightest text origin: this content is
        // repository memory gathered with no operator in the loop, so it is
        // redacted and held to the smallest size limit.
        origins: ['system-prompt', 'background-memory'],
        external: decision.external,
        request: {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          maxTokens: MEMORY_MAX_TOKENS,
          temperature: MEMORY_TEMPERATURE,
        },
        onAudit: line => reporter?.failure('egress-audit', line),
      });
      return response.content;
    } catch (error) {
      reporter?.failure(
        'provider-error',
        `Background memory summarisation failed at provider "${providerId}": `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
  }

  /**
   * Generate or refresh a concise snippet for a stale SSOT entry.
   * Returns empty string on any error.
   */
  async summarizeSsotEntry(entryPath: string, content: string): Promise<string> {
    const systemPrompt = [
      'You generate a concise snippet for an SSOT knowledge base entry.',
      `Maximum ${SSOT_SNIPPET_MAX_CHARS} characters.`,
      'Capture the core fact, decision, or reference the document contains.',
      'Write in plain prose. No preamble, no "This document...", no timestamps.',
    ].join('\n');

    const userPrompt = [
      `Entry path: ${entryPath}`,
      '',
      '--- CONTENT ---',
      content.slice(0, 4000),
      '--- END CONTENT ---',
    ].join('\n');

    const result = await this.complete(systemPrompt, userPrompt);
    return result.slice(0, SSOT_SNIPPET_MAX_CHARS);
  }

  /**
   * Return paths of SSOT entries that have source files tracked but no body fingerprint.
   * These are candidates for snippet refresh. Pure CPU — no LLM call.
   */
  detectStaleEntries(): string[] {
    return this.memory
      .listEntries()
      .filter(
        (entry: MemoryEntry) =>
          (entry.sourcePaths?.length ?? 0) > 0 && !entry.bodyFingerprint,
      )
      .map((entry: MemoryEntry) => entry.path);
  }
}

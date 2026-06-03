import type { AgentRegistry } from '../core/agentRegistry.js';
import type { ModelRouter } from '../core/modelRouter.js';
import type { TaskProfiler } from '../core/taskProfiler.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { resolveProviderIdForModel } from '../core/orchestrator.js';
import type { MemoryEntry, RoutingConstraints } from '../types.js';
import type { MemoryManager } from './memoryManager.js';

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
  ) {}

  /**
   * Single LLM call for memory maintenance. Mirrors orchestrator.completeMaintenance()
   * but routes through the memory-agent's configured allowedModels.
   * Returns empty string on any error.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const agentDef = this.agentRegistry.get('memory-agent');
    const allowedModels = agentDef?.allowedModels;

    const taskProfile = this.profiler.profileTask({
      userMessage: userPrompt,
      phase: 'maintenance',
      requiresTools: false,
    });

    const model = this.router.selectModel(MEMORY_CONSTRAINTS, allowedModels, taskProfile);
    const providerId = resolveProviderIdForModel(model, this.router, 'local');
    const provider = this.providers.get(providerId);
    if (!provider) {
      return '';
    }

    try {
      const response = await provider.complete({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        maxTokens: MEMORY_MAX_TOKENS,
        temperature: MEMORY_TEMPERATURE,
      });
      return response.content;
    } catch {
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

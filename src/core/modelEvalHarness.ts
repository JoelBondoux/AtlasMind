import type { CompletionResponse } from '../providers/adapter.js';
import { gradeExecutionQuality } from './executionQuality.js';

/**
 * Direction 2 follow-up — scored-replay / model-eval harness.
 *
 * Runs a single prompt across a set of candidate models, scores each output's
 * quality, computes cost + latency, and returns a ranked comparison. Lets a user
 * benchmark models on their own task and — via `onResult` — feed the graded
 * outcomes back into the router's outcome-driven channel to calibrate routing.
 *
 * Pure and host-independent: the model call is injected as `run`, so the core is
 * unit-testable without any provider, and the same function backs the
 * `atlasmind.compareModels` command in the extension.
 */

export interface ModelEvalResult {
  modelId: string;
  /** Graded output quality in [0,1] (0 when the run errored). */
  quality: number;
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Truncated preview of the model's output. */
  contentPreview: string;
  /** Set when the run threw; quality is 0 in that case. */
  error?: string;
}

export interface ModelEvalOptions {
  /** Estimate USD cost for a result. Defaults to 0 (e.g. for free/local models). */
  estimateCostUsd?: (modelId: string, inputTokens: number, outputTokens: number) => number;
  /** Receives each graded result so the caller can record it for routing calibration. */
  onResult?: (modelId: string, quality: number) => void;
  /** Max characters of output retained in `contentPreview`. */
  previewChars?: number;
  signal?: AbortSignal;
  /** Monotonic clock injection for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

const DEFAULT_PREVIEW_CHARS = 400;

/**
 * Composite ranking score: quality dominates, cost breaks ties (cheaper wins).
 * Bounded so a near-free model with slightly lower quality can still rank below a
 * clearly better one.
 */
function rankScore(result: ModelEvalResult): number {
  return result.quality - Math.min(0.15, result.costUsd * 10);
}

export async function compareModelsOnPrompt(
  prompt: string,
  modelIds: string[],
  run: (modelId: string, prompt: string, signal?: AbortSignal) => Promise<CompletionResponse>,
  options: ModelEvalOptions = {},
): Promise<ModelEvalResult[]> {
  const previewChars = options.previewChars ?? DEFAULT_PREVIEW_CHARS;
  const now = options.now ?? (() => Date.now());
  const estimateCost = options.estimateCostUsd ?? (() => 0);
  const seen = new Set<string>();
  const results: ModelEvalResult[] = [];

  // Sequential, not parallel: bounds concurrent spend and respects provider rate
  // limits during an explicit, user-triggered benchmark.
  for (const modelId of modelIds) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    if (options.signal?.aborted) {
      break;
    }

    const startedAt = now();
    try {
      const completion = await run(modelId, prompt, options.signal);
      const latencyMs = Math.max(0, now() - startedAt);
      const quality = gradeExecutionQuality(completion);
      const inputTokens = completion.inputTokens ?? 0;
      const outputTokens = completion.outputTokens ?? 0;
      const costUsd = Math.max(0, estimateCost(modelId, inputTokens, outputTokens));
      options.onResult?.(modelId, quality);
      results.push({
        modelId,
        quality,
        costUsd,
        latencyMs,
        inputTokens,
        outputTokens,
        contentPreview: completion.content.slice(0, previewChars),
      });
    } catch (err) {
      const latencyMs = Math.max(0, now() - startedAt);
      options.onResult?.(modelId, 0);
      results.push({
        modelId,
        quality: 0,
        costUsd: 0,
        latencyMs,
        inputTokens: 0,
        outputTokens: 0,
        contentPreview: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results.sort((a, b) => rankScore(b) - rankScore(a));
}

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
  /**
   * Completion-integrity grade in [0,1] (0 when the run errored). This measures
   * whether the response came back cleanly — not how good the answer is. It is
   * intentionally coarse (error 0 / empty 0.2 / truncated 0.6 / clean 1.0) and is
   * what feeds the router's outcome-driven channel. For an answer-quality score,
   * see `judgeScore`.
   */
  quality: number;
  /** Optional answer-quality score in [0,100] from an LLM judge, when grading was enabled. */
  judgeScore?: number;
  /** Short rationale from the judge for `judgeScore`. */
  judgeRationale?: string;
  costUsd: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Truncated preview of the model's output. */
  contentPreview: string;
  /** Set when the run threw; quality is 0 in that case. */
  error?: string;
}

/** One model's answer handed to the judge for grading. */
export interface ModelEvalJudgeEntry {
  modelId: string;
  response: string;
}

/** A judge's verdict for a single model. */
export interface ModelEvalJudgeVerdict {
  score: number;
  rationale?: string;
}

export interface ModelEvalOptions {
  /** Estimate USD cost for a result. Defaults to 0 (e.g. for free/local models). */
  estimateCostUsd?: (modelId: string, inputTokens: number, outputTokens: number) => number;
  /** Receives each graded result so the caller can record it for routing calibration. */
  onResult?: (modelId: string, quality: number) => void;
  /** Max characters of output retained in `contentPreview`. */
  previewChars?: number;
  /**
   * Optional answer-quality judge. Called once after all models respond, with the
   * non-errored answers; returns a per-model score in [0,100]. Injected so the
   * harness stays pure/testable and the judge model is the caller's choice.
   */
  judge?: (
    prompt: string,
    entries: ModelEvalJudgeEntry[],
    signal?: AbortSignal,
  ) => Promise<Map<string, ModelEvalJudgeVerdict>>;
  signal?: AbortSignal;
  /** Monotonic clock injection for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

const DEFAULT_PREVIEW_CHARS = 400;

/**
 * Composite ranking score: quality dominates, cost breaks ties (cheaper wins).
 * When an answer-quality judge score is present it drives the ranking (it is far
 * more discriminating than the coarse completion grade); otherwise the
 * completion grade is used. Bounded so a near-free model with slightly lower
 * quality can still rank below a clearly better one.
 */
function rankScore(result: ModelEvalResult): number {
  const base = typeof result.judgeScore === 'number' ? result.judgeScore / 100 : result.quality;
  return base - Math.min(0.15, result.costUsd * 10);
}

/**
 * Builds the prompt for an LLM judge that scores each model's answer to the same
 * task on a 0–100 scale. Pure so it can be unit-tested and reused by any caller.
 */
export function buildModelJudgePrompt(prompt: string, entries: ModelEvalJudgeEntry[]): string {
  const answers = entries
    .map((entry, index) => `### Answer ${index + 1} — id: ${entry.modelId}\n${entry.response}`)
    .join('\n\n');
  return [
    'You are an impartial evaluator grading AI answers to the same task.',
    'Score each answer from 0 to 100 for correctness, completeness, and usefulness (100 = best).',
    'Respond with ONLY a JSON array — no prose, no code fences — of objects:',
    '[{"id": "<the exact id given>", "score": <0-100>, "reason": "<under 20 words>"}]',
    '',
    `TASK:\n${prompt}`,
    '',
    `ANSWERS:\n${answers}`,
  ].join('\n');
}

/**
 * Parses an LLM judge's reply into per-model verdicts. Defensive: tolerates
 * surrounding prose/fences, matches ids case-insensitively, clamps scores to
 * [0,100], and silently drops anything it can't map back to a known model.
 */
export function parseModelJudgeVerdicts(
  text: string,
  entries: ModelEvalJudgeEntry[],
): Map<string, ModelEvalJudgeVerdict> {
  const verdicts = new Map<string, ModelEvalJudgeVerdict>();
  const ids = entries.map(entry => entry.modelId);
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    return verdicts;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return verdicts;
  }
  if (!Array.isArray(parsed)) {
    return verdicts;
  }
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as { id?: unknown; score?: unknown; reason?: unknown };
    const rawId = typeof record.id === 'string' ? record.id : '';
    const score = Number(record.score);
    if (!Number.isFinite(score)) {
      continue;
    }
    const matched = ids.find(id => id === rawId) ?? ids.find(id => id.toLowerCase() === rawId.toLowerCase());
    if (!matched || verdicts.has(matched)) {
      continue;
    }
    verdicts.set(matched, {
      score: Math.max(0, Math.min(100, score)),
      rationale: typeof record.reason === 'string' ? record.reason : undefined,
    });
  }
  return verdicts;
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

  // Optional answer-quality grading: one judge call over the clean answers.
  if (options.judge && !options.signal?.aborted) {
    const entries = results
      .filter(result => !result.error && result.contentPreview.length > 0)
      .map(result => ({ modelId: result.modelId, response: result.contentPreview }));
    if (entries.length > 0) {
      try {
        const verdicts = await options.judge(prompt, entries, options.signal);
        for (const result of results) {
          const verdict = verdicts.get(result.modelId);
          if (verdict && Number.isFinite(verdict.score)) {
            result.judgeScore = Math.max(0, Math.min(100, verdict.score));
            result.judgeRationale = verdict.rationale;
          }
        }
      } catch {
        // Judging is best-effort: keep the completion-graded results on failure.
      }
    }
  }

  return results.sort((a, b) => rankScore(b) - rankScore(a));
}

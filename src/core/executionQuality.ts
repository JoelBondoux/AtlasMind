import type { CompletionResponse } from '../providers/adapter.js';

/**
 * Grades a completed turn's execution quality in [0,1]. A hard error scores 0,
 * an empty response scores low, a truncated (length-capped) response scores
 * moderate, and a clean response with content scores full. Derived purely from
 * the completion so it needs no extra signals.
 *
 * Shared by the orchestrator's outcome-driven routing and the model-eval harness.
 */
export function gradeExecutionQuality(completion: CompletionResponse): number {
  if (completion.finishReason === 'error') {
    return 0;
  }
  if (completion.content.trim().length === 0) {
    return 0.2;
  }
  if (completion.finishReason === 'length') {
    return 0.6;
  }
  return 1;
}

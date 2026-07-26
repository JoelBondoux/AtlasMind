import type { CompletionResponse } from '../providers/adapter.js';

export interface ExecutionQualityEvidence {
  /** Whether the task called for workspace-backed action or investigation. */
  expectedToolUse?: boolean;
  toolCallCount?: number;
  failedToolCallCount?: number;
  verificationSummary?: string;
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
  /** Set when the final answer still matches an agent completion gate. */
  incompleteDelivery?: boolean;
}

/**
 * Grades a completed turn's execution quality in [0,1]. A hard error scores 0,
 * an empty response scores low, a truncated (length-capped) response scores
 * moderate. When execution evidence is supplied, successful tool use, failed
 * tool calls, verification, TDD status, and incomplete-delivery signals make
 * clean responses meaningfully distinguishable instead of all scoring 1.0.
 *
 * Shared by the orchestrator's outcome-driven routing and the model-eval harness.
 * The model-eval harness intentionally omits evidence and retains its coarse
 * completion-integrity grade; its optional judge provides answer-quality scoring.
 */
export function gradeExecutionQuality(
  completion: CompletionResponse,
  evidence?: ExecutionQualityEvidence,
): number {
  if (completion.finishReason === 'error') {
    return 0;
  }
  if (completion.content.trim().length === 0) {
    return 0.2;
  }
  if (completion.finishReason === 'length') {
    return 0.6;
  }
  if (!evidence) {
    return 1;
  }

  let score = 0.8;
  const toolCallCount = Math.max(0, evidence.toolCallCount ?? 0);
  const failedToolCallCount = Math.min(
    toolCallCount,
    Math.max(0, evidence.failedToolCallCount ?? 0),
  );

  if (evidence.incompleteDelivery) {
    score = Math.min(score, 0.45);
  }
  if (evidence.expectedToolUse && toolCallCount === 0) {
    score = Math.min(score, 0.55);
  }

  if (toolCallCount > 0) {
    if (failedToolCallCount === 0) {
      score += 0.1;
    } else {
      score -= 0.5 * (failedToolCallCount / toolCallCount);
    }
  }

  const verification = classifyVerification(evidence.verificationSummary);
  if (verification === 'passed') {
    score += 0.1;
  } else if (verification === 'failed') {
    score = Math.min(score, 0.3);
  }

  if (evidence.tddStatus === 'verified') {
    score += 0.05;
  } else if (evidence.tddStatus === 'missing') {
    score = Math.min(score, 0.55);
  } else if (evidence.tddStatus === 'blocked') {
    score = Math.min(score, 0.3);
  }

  return Math.round(clamp01(score) * 100) / 100;
}

function classifyVerification(summary?: string): 'passed' | 'failed' | 'unknown' {
  if (!summary?.trim()) {
    return 'unknown';
  }
  if (/\bFAIL:|\bexit\s+(?:code\s+)?[1-9]\d*\b|\b[1-9]\d* failed\b|✗/i.test(summary)) {
    return 'failed';
  }
  if (/\bPASS:|\btests?\s+passed\b|\b0 failed\b|✓/i.test(summary)) {
    return 'passed';
  }
  return 'unknown';
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

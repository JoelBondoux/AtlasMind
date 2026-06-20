/**
 * GoalEvaluator — judges whether a mission's goal has been achieved after an
 * iteration, and what should happen next.
 *
 * The model is prompted to return a strict JSON verdict. Like the Planner, the
 * response is treated as UNTRUSTED: it is parsed and every field validated
 * individually before it is allowed to drive the {@link MissionRunner}'s control
 * flow. A malformed or low-confidence verdict can never falsely declare success
 * — the safe fallback is `stalled` with zero confidence, which keeps the loop
 * honest (it will not stop on "goal-achieved" unless the evaluator is both valid
 * and confident).
 *
 * Verification weighting: a goal is only `achieved` when the iteration produced
 * passing verification evidence where behaviour changed. This is enforced twice
 * — once in the prompt, and once defensively in code (an `achieved` verdict is
 * downgraded to `progressing` when the iteration changed files but its TDD/
 * verification status is missing or blocked).
 */

import type { ChangedWorkspaceFile, GoalVerdict, GoalVerdictKind } from '../types.js';

/** One-shot completion function injected by the runner (e.g. Orchestrator.summarizeText). */
export type CompleteFn = (systemPrompt: string, userPrompt: string) => Promise<string>;

export interface GoalEvaluationInput {
  goal: string;
  successCriteria?: string[];
  iterationIndex: number;
  maxIterations: number;
  /** Synthesized report from the iteration just executed. */
  latestSynthesis: string;
  /** Compact carry-forward summary of everything done in prior iterations. */
  accumulatedSummary?: string;
  changedFiles: ChangedWorkspaceFile[];
  /** Aggregated verification text from the iteration's subtasks, if any. */
  verificationSummary?: string;
  /** Worst-case TDD status across the iteration's subtasks. */
  tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable';
}

const MAX_REMAINING_ITEMS = 12;
const MAX_FIELD_CHARS = 1_200;

/** Safe default verdict — never lets a bad evaluator response stop the loop on success. */
function fallbackVerdict(rationale: string): GoalVerdict {
  return { verdict: 'stalled', confidence: 0, remaining: [], nextFocus: '', rationale };
}

export class GoalEvaluator {
  constructor(private readonly complete: CompleteFn) {}

  async evaluate(input: GoalEvaluationInput): Promise<GoalVerdict> {
    let raw: string;
    try {
      raw = await this.complete(buildEvaluatorSystemPrompt(), buildEvaluatorUserPrompt(input));
    } catch (err) {
      return fallbackVerdict(`Evaluator call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const parsed = parseGoalVerdict(raw);
    if (!parsed) {
      return fallbackVerdict('Evaluator returned no parseable verdict; treating as stalled.');
    }
    return applyVerificationGuard(parsed, input);
  }
}

// ── Prompt construction ──────────────────────────────────────────

function buildEvaluatorSystemPrompt(): string {
  return [
    'You are a strict, evidence-based progress evaluator for an autonomous development loop.',
    'You are given a goal and a report of what the latest iteration accomplished. Judge how close the goal is to being satisfied.',
    'Return ONLY valid JSON (no markdown fences, no prose) matching this exact schema:',
    '{',
    '  "verdict": "achieved" | "progressing" | "stalled" | "blocked",',
    '  "confidence": 0.0,',
    '  "remaining": ["concrete outstanding work items"],',
    '  "nextFocus": "the single most valuable thing to do next",',
    '  "rationale": "one or two sentences citing the evidence"',
    '}',
    'Rules:',
    '- "achieved" means the goal is fully satisfied AND, where behaviour changed, there is passing verification evidence (tests/build). Code written without passing verification is "progressing", never "achieved".',
    '- "progressing" means real, measurable forward movement was made this iteration.',
    '- "stalled" means little or no measurable progress was made (e.g. repeated failures, no useful change).',
    '- "blocked" means external input or a decision is required that the loop cannot resolve itself (e.g. missing credentials, ambiguous requirement, a protected deployment step).',
    '- confidence is your calibrated certainty in the verdict, from 0.0 to 1.0. Be conservative about declaring "achieved".',
    '- Base the verdict only on the evidence provided. Do not invent progress that is not described.',
    '- Respond with JSON only — nothing else.',
  ].join('\n');
}

function buildEvaluatorUserPrompt(input: GoalEvaluationInput): string {
  const lines: string[] = [];
  lines.push(`Goal: ${input.goal}`);
  if (input.successCriteria && input.successCriteria.length > 0) {
    lines.push('', 'Success criteria (definition of done):');
    for (const c of input.successCriteria) {
      lines.push(`- ${c}`);
    }
  }
  lines.push('', `Iteration ${input.iterationIndex} of at most ${input.maxIterations}.`);
  if (input.accumulatedSummary && input.accumulatedSummary.trim()) {
    lines.push('', 'Work completed in prior iterations:', input.accumulatedSummary.trim().slice(0, 2_000));
  }
  lines.push('', 'This iteration produced:', (input.latestSynthesis || '(no synthesis produced)').trim().slice(0, 3_000));

  const changed = input.changedFiles ?? [];
  lines.push('', `Files changed this iteration: ${changed.length}`);
  if (changed.length > 0) {
    for (const f of changed.slice(0, 25)) {
      lines.push(`- ${f.status}: ${f.relativePath}`);
    }
  }

  lines.push('', `Verification status this iteration: ${input.tddStatus ?? 'unknown'}`);
  if (input.verificationSummary && input.verificationSummary.trim()) {
    lines.push('Verification details:', input.verificationSummary.trim().slice(0, 1_500));
  }

  lines.push('', 'Return the JSON verdict now.');
  return lines.join('\n');
}

// ── Untrusted-output parsing & validation ────────────────────────

/**
 * Parse and validate an evaluator response. Returns `undefined` when the
 * response is not a well-formed verdict so the caller can apply a safe fallback.
 * Mirrors the defensive parsing discipline in planner.ts.
 */
export function parseGoalVerdict(raw: string): GoalVerdict | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch ? fenceMatch[1] : raw;
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!objMatch) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(objMatch[0]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const c = parsed as Record<string, unknown>;

  const verdict = toVerdictKind(c['verdict']);
  if (!verdict) {
    return undefined;
  }
  const confidence = toConfidence(c['confidence']);
  const remaining = toStringList(c['remaining']).slice(0, MAX_REMAINING_ITEMS);
  const nextFocus = toBoundedString(c['nextFocus']);
  const rationale = toBoundedString(c['rationale']);

  return { verdict, confidence, remaining, nextFocus, rationale };
}

/**
 * Defensive downgrade: never accept an `achieved` verdict when the iteration
 * changed files but its verification is missing or blocked. This protects the
 * loop from an over-eager evaluator declaring victory on unverified code.
 */
export function applyVerificationGuard(verdict: GoalVerdict, input: GoalEvaluationInput): GoalVerdict {
  if (verdict.verdict !== 'achieved') {
    return verdict;
  }
  const changed = (input.changedFiles ?? []).length > 0;
  const unverified = input.tddStatus === 'blocked' || input.tddStatus === 'missing';
  if (changed && unverified) {
    return {
      ...verdict,
      verdict: 'progressing',
      confidence: Math.min(verdict.confidence, 0.5),
      rationale: `${verdict.rationale} [Downgraded: code changed but verification is ${input.tddStatus}.]`.trim(),
    };
  }
  return verdict;
}

function toVerdictKind(v: unknown): GoalVerdictKind | undefined {
  return v === 'achieved' || v === 'progressing' || v === 'stalled' || v === 'blocked' ? v : undefined;
}

function toConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

function toStringList(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.filter((x): x is string => typeof x === 'string').map(s => s.slice(0, MAX_FIELD_CHARS));
}

function toBoundedString(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, MAX_FIELD_CHARS) : '';
}

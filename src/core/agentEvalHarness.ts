/**
 * Golden tasks for an agent, and the regression check that stops a rewrite
 * quietly making it worse.
 *
 * `agentAutoUpdater` asks a model to rewrite an agent's system prompt on a
 * cadence — daily, weekly or monthly — and registers the result. That is a
 * prompt edit, deployed automatically, with **no equivalent of a failing
 * build**, which is precisely the failure this project's own Prompt Regression
 * protocol describes: *a wording change that fixes one case and breaks nine is
 * invisible without a replay set.* The auto-update cadence is the risk; this is
 * the replay set.
 *
 * `modelEvalHarness` answers a different question — which *model* is best for
 * one prompt — and scores by completion quality. This asks whether a given
 * agent definition still does the things somebody pinned, which is not a score
 * at all.
 *
 * Seven rules.
 *
 * **A case is graded by a declared check wherever possible, and every result
 * says which graded it.** A model judging a model is the weakest link in any
 * eval, so the checks that can be decided by looking at the text are — did it
 * mention the thing, did it avoid the thing, did it refuse — and a judge is
 * available for what genuinely cannot be. "It did the thing" and "a judge liked
 * it" are different findings, and a suite that conflated them would report the
 * strength of the weaker one.
 *
 * **No baseline is a first run, not a pass.** The rule `observedDelta` states,
 * and it matters more here: reporting "no regressions" on the very first run is
 * a confident zero delivered at exactly the moment somebody is deciding whether
 * to trust the harness.
 *
 * **An errored case is not a failed case.** A provider outage is not a quality
 * regression, and counting one as the other would make every bad afternoon look
 * like a broken prompt — after which nobody believes the gate. Errored cases are
 * excluded from the verdict and reported separately.
 *
 * **A regression is a case that passed and now fails — never a score that
 * moved.** Scores wobble between runs on identical input; pass-to-fail is a
 * fact. Score movement is worth showing and is not a verdict.
 *
 * **An unrun case is not a passing case.** Coverage travels with the verdict, so
 * "eight of twelve ran" can never read as twelve.
 *
 * **A case carries the reason it exists.** A golden case nobody can justify is
 * deleted in six months by somebody tidying up, taking with it the regression it
 * was quietly catching.
 *
 * **Nothing here edits an agent.** It returns a verdict; holding an update is
 * the caller's act, and an update that could not be verified is recorded as
 * *unverified* rather than as passed.
 *
 * Pure and `vscode`-free; the model call is injected.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AGENT_EVAL_CASES_PATH = 'project_memory/agents/eval-cases.json';
export const AGENT_EVAL_BASELINE_PATH = 'project_memory/agents/eval-baseline.json';

/**
 * How a case is decided.
 *
 * The first four are decided by reading the text and are the ones to prefer.
 * `judge` exists because some things genuinely cannot be checked that way — "is
 * this explanation actually clear?" — and it is marked on every result it
 * touches so nobody mistakes its confidence for the others'.
 */
export type EvalCheckKind =
  | 'must-contain'
  | 'must-not-contain'
  | 'must-match'
  | 'must-refuse'
  | 'judge';

export interface EvalCheck {
  kind: EvalCheckKind;
  /** The literal, the pattern, or the question put to a judge. */
  value: string;
  /** What this check is for, shown when it fails. */
  describes: string;
}

export interface GoldenCase {
  id: string;
  agentId: string;
  prompt: string;
  checks: EvalCheck[];
  /**
   * Why this case exists.
   *
   * Required, not optional. A pinned case with no stated reason is deleted by
   * the next person tidying the file, and the regression it was catching goes
   * with it.
   */
  rationale: string;
  createdAt: string;
}

export type CaseOutcome = 'pass' | 'fail' | 'errored' | 'not-run';

export interface CaseResult {
  caseId: string;
  outcome: CaseOutcome;
  /** Which checks failed, named, so a failure is actionable rather than a score. */
  failedChecks: string[];
  /** True when any check that decided this was a judge's. Never hidden. */
  judged: boolean;
  /** Why it errored. Distinguishes an outage from a bad answer. */
  errorReason?: string;
}

export interface EvalRun {
  agentId: string;
  ranAt: string;
  /**
   * A fingerprint of the definition this ran against.
   *
   * Without it a baseline says "this agent passed" rather than "this *version*
   * of this agent passed", and a rewrite would inherit the previous version's
   * results — the exact thing the harness exists to prevent.
   */
  definitionFingerprint: string;
  results: CaseResult[];
}

export interface EvalBaseline {
  version: 1;
  runs: EvalRun[];
  updatedAt?: string;
}

// ── Grading ──────────────────────────────────────────────────────

/**
 * Refusal markers, for `must-refuse`.
 *
 * Deliberately a short list of phrasings a refusal actually uses rather than an
 * attempt at natural-language understanding: a case asserting a refusal is
 * usually asserting that a *safety* instruction survived a rewrite, and a check
 * that is wrong in the permissive direction there is worse than no check.
 */
const REFUSAL_MARKERS: readonly string[] = [
  'cannot', 'can\'t', 'will not', 'won\'t', 'unable to',
  'not able to', 'refuse', 'should not', 'must not', 'not appropriate',
];

/** Whether one non-judge check passes. Pure text inspection. */
export function checkPasses(check: EvalCheck, output: string): boolean {
  const haystack = output.toLowerCase();
  switch (check.kind) {
    case 'must-contain':
      return haystack.includes(check.value.toLowerCase());
    case 'must-not-contain':
      return !haystack.includes(check.value.toLowerCase());
    case 'must-match':
      try {
        return new RegExp(check.value, 'i').test(output);
      } catch {
        // A pattern that will not compile fails the check rather than throwing
        // or passing: a broken case is a case that needs attention, and passing
        // it would hide whatever it was pinning.
        return false;
      }
    case 'must-refuse':
      return REFUSAL_MARKERS.some(marker => haystack.includes(marker));
    default:
      return false;
  }
}

/** The checks a model has to decide. Separated so a caller can skip them. */
export function judgeChecks(golden: GoldenCase): EvalCheck[] {
  return golden.checks.filter(check => check.kind === 'judge');
}

/** Everything decidable by reading the text. */
export function deterministicChecks(golden: GoldenCase): EvalCheck[] {
  return golden.checks.filter(check => check.kind !== 'judge');
}

export interface CaseRunOutcome {
  output?: string;
  /** Set when the call failed. An outage, not an answer. */
  error?: string;
  /** Verdicts for this case's judge checks, where a judge was consulted. */
  judgeVerdicts?: ReadonlyArray<{ value: string; passed: boolean }>;
}

/**
 * Grade one case against one run.
 *
 * An error short-circuits to `errored` before any check is looked at: an empty
 * output would fail every `must-contain` and produce a case that looks broken
 * when the provider was simply down.
 *
 * A judge check with no verdict is a **failure to grade**, not a pass. Treating
 * an absent verdict as satisfied would let a suite go green by not asking.
 */
export function gradeCase(golden: GoldenCase, outcome: CaseRunOutcome): CaseResult {
  if (outcome.error !== undefined || outcome.output === undefined) {
    return {
      caseId: golden.id,
      outcome: 'errored',
      failedChecks: [],
      judged: false,
      errorReason: outcome.error ?? 'The agent produced no output.',
    };
  }

  const failed: string[] = [];
  for (const check of deterministicChecks(golden)) {
    if (!checkPasses(check, outcome.output)) {
      failed.push(check.describes);
    }
  }

  const judges = judgeChecks(golden);
  let judged = false;
  for (const check of judges) {
    judged = true;
    const verdict = outcome.judgeVerdicts?.find(entry => entry.value === check.value);
    if (verdict === undefined || !verdict.passed) {
      failed.push(verdict === undefined
        ? `${check.describes} (no judge verdict — not graded, so not passed)`
        : check.describes);
    }
  }

  return {
    caseId: golden.id,
    outcome: failed.length === 0 ? 'pass' : 'fail',
    failedChecks: failed,
    judged,
  };
}

// ── Comparing against the baseline ───────────────────────────────

export interface RegressionVerdict {
  agentId: string;
  /**
   * Cases that passed in the baseline and fail now. The only thing called a
   * regression.
   */
  regressions: CaseResult[];
  /** Cases that failed and now pass. Reported, because it is usually the point. */
  fixes: string[];
  /** Errored this run. Excluded from the verdict entirely. */
  errored: string[];
  /** Declared for this agent and not run. Never counted as passing. */
  notRun: string[];
  /** True when there was no baseline. A first run, not a pass. */
  firstRun: boolean;
  ran: number;
  declared: number;
  /** One sentence no surface can restate more optimistically. */
  summary: string;
}

/**
 * Compare a run with the baseline.
 *
 * Only `pass → fail` counts. A case that errored this run is set aside rather
 * than counted against the change, because the alternative is a gate that
 * blocks every rewrite during a provider outage and is switched off by the end
 * of the week.
 */
export function compareWithBaseline(
  agentId: string,
  run: EvalRun,
  declaredCases: readonly GoldenCase[],
  baseline: EvalBaseline | undefined,
): RegressionVerdict {
  const declaredForAgent = declaredCases.filter(entry => entry.agentId === agentId);
  const previous = baseline?.runs.find(entry => entry.agentId === agentId);
  const previousByCase = new Map((previous?.results ?? []).map(result => [result.caseId, result]));
  const currentByCase = new Map(run.results.map(result => [result.caseId, result]));

  const regressions: CaseResult[] = [];
  const fixes: string[] = [];
  const errored: string[] = [];
  const notRun: string[] = [];

  for (const golden of declaredForAgent) {
    const current = currentByCase.get(golden.id);
    if (current === undefined) {
      notRun.push(golden.id);
      continue;
    }
    if (current.outcome === 'errored') {
      errored.push(golden.id);
      continue;
    }
    const before = previousByCase.get(golden.id);
    if (before?.outcome === 'pass' && current.outcome === 'fail') {
      regressions.push(current);
    } else if (before?.outcome === 'fail' && current.outcome === 'pass') {
      fixes.push(golden.id);
    }
  }

  const ran = run.results.filter(result => result.outcome !== 'not-run').length;
  const firstRun = previous === undefined;

  return {
    agentId,
    regressions,
    fixes,
    errored,
    notRun,
    firstRun,
    ran,
    declared: declaredForAgent.length,
    summary: describeVerdict({
      firstRun,
      regressions: regressions.length,
      fixes: fixes.length,
      errored: errored.length,
      notRun: notRun.length,
      ran,
      declared: declaredForAgent.length,
    }),
  };
}

function describeVerdict(input: {
  firstRun: boolean;
  regressions: number;
  fixes: number;
  errored: number;
  notRun: number;
  ran: number;
  declared: number;
}): string {
  const coverage = `${input.ran} of ${input.declared} case${input.declared === 1 ? '' : 's'} ran`;
  const aside = [
    input.errored > 0 ? `${input.errored} errored and ${input.errored === 1 ? 'was' : 'were'} set aside` : '',
    input.notRun > 0 ? `${input.notRun} did not run` : '',
  ].filter(Boolean).join(', ');
  const tail = aside ? ` (${aside})` : '';

  if (input.firstRun) {
    // Not "no regressions". There is nothing to have regressed from, and saying
    // otherwise at the exact moment somebody decides whether to trust this
    // would be the worst possible first impression.
    return `First run — this becomes the baseline. ${coverage}${tail}. Nothing to compare against yet.`;
  }
  if (input.regressions > 0) {
    return `${input.regressions} case${input.regressions === 1 ? '' : 's'} passed before and ${input.regressions === 1 ? 'fails' : 'fail'} now. ${coverage}${tail}.`;
  }
  const fixed = input.fixes > 0 ? ` ${input.fixes} previously failing case${input.fixes === 1 ? '' : 's'} now ${input.fixes === 1 ? 'passes' : 'pass'}.` : '';
  return `No regressions. ${coverage}${tail}.${fixed}`;
}

// ── The gate ─────────────────────────────────────────────────────

export type UpdateHoldReason =
  | 'regressions'
  | 'not-verified'
  | 'no-cases';

export interface UpdateHoldDecision {
  hold: boolean;
  reason?: UpdateHoldReason;
  /** What a person reads. Never a bare code. */
  detail: string;
}

/**
 * Whether an automatic rewrite should be held back.
 *
 * The one place the harness meets the risk it was built for. Three answers, and
 * the middle one is the interesting one: an update that **could not be
 * verified** is held rather than allowed, because the cadence is unattended and
 * "we did not check" resolving to "ship it" is how an unattended rewrite becomes
 * an unattended regression.
 *
 * An agent with **no declared cases** is not held — that would freeze every
 * agent nobody has written cases for, which is all of them on day one, and a
 * gate that blocks everything is a gate somebody turns off.
 */
export function shouldHoldAgentUpdate(
  verdict: RegressionVerdict | undefined,
  declaredCaseCount: number,
): UpdateHoldDecision {
  if (declaredCaseCount === 0) {
    return {
      hold: false,
      reason: 'no-cases',
      detail: 'No golden cases are declared for this agent, so the rewrite was not checked against anything. Nothing is holding it back — and nothing verified it either.',
    };
  }
  if (verdict === undefined) {
    return {
      hold: true,
      reason: 'not-verified',
      detail: 'This agent has golden cases and the rewrite could not be checked against them. Held: the cadence is unattended, and an unverified rewrite is not a passed one.',
    };
  }
  if (verdict.regressions.length > 0) {
    const names = verdict.regressions.map(result => result.caseId).join(', ');
    return {
      hold: true,
      reason: 'regressions',
      detail: `Held: ${verdict.regressions.length} case${verdict.regressions.length === 1 ? '' : 's'} passed before this rewrite and fail after it (${names}).`,
    };
  }
  return { hold: false, detail: verdict.summary };
}

// ── Persistence ──────────────────────────────────────────────────

const MAX_CASES = 500;
const MAX_FIELD = 400;
const MAX_PROMPT = 8000;
const CHECK_KINDS: readonly EvalCheckKind[] = [
  'must-contain', 'must-not-contain', 'must-match', 'must-refuse', 'judge',
];
const OUTCOMES: readonly CaseOutcome[] = ['pass', 'fail', 'errored', 'not-run'];

function clampField(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max)
    : '';
}

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = clampField(value, 40).toLowerCase() as T;
  return allowed.includes(raw) ? raw : fallback;
}

/** A stable fingerprint of the definition a run was made against. */
export function definitionFingerprint(systemPrompt: string, description: string): string {
  let hash = 0x811c9dc5;
  const text = `${systemPrompt} ${description}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function sanitizeGoldenCases(input: unknown): GoldenCase[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const now = new Date().toISOString();
  const taken = new Set<string>();
  const cases: GoldenCase[] = [];
  for (const entry of input.slice(0, MAX_CASES)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const agentId = clampField(raw['agentId'], 120);
    const prompt = clampField(raw['prompt'], MAX_PROMPT);
    const rationale = clampField(raw['rationale'], MAX_FIELD);
    // A case with no prompt cannot run, and one with no rationale gets deleted
    // by the next person tidying the file. Both are refusals rather than
    // defaults, because a silently defaulted case is one nobody wrote.
    if (!agentId || !prompt || !rationale) {
      continue;
    }
    const checks: EvalCheck[] = Array.isArray(raw['checks'])
      ? raw['checks'].flatMap(item => {
        if (typeof item !== 'object' || item === null) {
          return [];
        }
        const check = item as Record<string, unknown>;
        const value = clampField(check['value'], MAX_FIELD);
        const describes = clampField(check['describes'], MAX_FIELD);
        if (!value || !describes) {
          return [];
        }
        return [{ kind: coerce(check['kind'], CHECK_KINDS, 'must-contain'), value, describes }];
      })
      : [];
    // A case with no checks passes trivially, which is worse than no case: it
    // adds a green tick that means nothing.
    if (checks.length === 0) {
      continue;
    }
    let id = clampField(raw['id'], 120).replace(/[^A-Za-z0-9._~:@+-]/g, '');
    if (!id || taken.has(id)) {
      id = `${agentId}-${cases.length + 1}`;
    }
    taken.add(id);
    cases.push({
      id,
      agentId,
      prompt,
      checks,
      rationale,
      createdAt: clampField(raw['createdAt'], 40) || now,
    });
  }
  return cases;
}

export function sanitizeEvalBaseline(input: unknown): EvalBaseline {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { version: 1, runs: [] };
  }
  const raw = input as Record<string, unknown>;
  const runs: EvalRun[] = Array.isArray(raw['runs'])
    ? raw['runs'].flatMap(entry => {
      if (typeof entry !== 'object' || entry === null) {
        return [];
      }
      const run = entry as Record<string, unknown>;
      const agentId = clampField(run['agentId'], 120);
      if (!agentId) {
        return [];
      }
      const results: CaseResult[] = Array.isArray(run['results'])
        ? run['results'].flatMap(item => {
          if (typeof item !== 'object' || item === null) {
            return [];
          }
          const result = item as Record<string, unknown>;
          const caseId = clampField(result['caseId'], 120);
          if (!caseId) {
            return [];
          }
          const errorReason = clampField(result['errorReason'], MAX_FIELD);
          return [{
            caseId,
            // An unrecognised stored outcome reads as `not-run`, never as
            // `pass`: a baseline full of invented passes would report a
            // regression on everything the moment it was compared.
            outcome: coerce(result['outcome'], OUTCOMES, 'not-run'),
            failedChecks: Array.isArray(result['failedChecks'])
              ? result['failedChecks'].map(value => clampField(value, MAX_FIELD)).filter(Boolean)
              : [],
            judged: result['judged'] === true,
            ...(errorReason ? { errorReason } : {}),
          }];
        })
        : [];
      return [{
        agentId,
        ranAt: clampField(run['ranAt'], 40) || new Date(0).toISOString(),
        definitionFingerprint: clampField(run['definitionFingerprint'], 32),
        results,
      }];
    })
    : [];
  return { version: 1, runs };
}

export function readGoldenCases(workspaceRoot: string): GoldenCase[] {
  try {
    return sanitizeGoldenCases(
      JSON.parse(readFileSync(path.join(workspaceRoot, AGENT_EVAL_CASES_PATH), 'utf8')),
    );
  } catch {
    return [];
  }
}

export function readEvalBaseline(workspaceRoot: string): EvalBaseline | undefined {
  try {
    return sanitizeEvalBaseline(
      JSON.parse(readFileSync(path.join(workspaceRoot, AGENT_EVAL_BASELINE_PATH), 'utf8')),
    );
  } catch {
    // Absent means never run, which is a first run rather than an empty
    // baseline — `compareWithBaseline` needs those kept apart.
    return undefined;
  }
}

/**
 * Record a run as the new baseline for its agent.
 *
 * Replaces that agent's previous run rather than appending: the baseline is
 * "what it did last time", and a growing history would make the comparison
 * ambiguous about which run it was against.
 */
export async function writeEvalBaseline(
  workspaceRoot: string,
  baseline: EvalBaseline,
  run: EvalRun,
): Promise<EvalBaseline> {
  const next: EvalBaseline = {
    version: 1,
    runs: [...baseline.runs.filter(entry => entry.agentId !== run.agentId), run],
    updatedAt: run.ranAt,
  };
  const file = path.join(workspaceRoot, AGENT_EVAL_BASELINE_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  return next;
}

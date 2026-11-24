/**
 * Whether an open pull request can merge, judged against the checks its base
 * branch *requires* rather than the checks that happen to have run.
 *
 * GitHub's rollup lists the checks that were posted. A required check nobody
 * has posted is not in it, so a pull request blocked on `AtlasMind/local-ci` —
 * a status only AtlasMind on somebody's computer ever posts — read as "2 checks
 * green" on the Pull Requests page while GitHub refused the merge with
 * `Required status check "AtlasMind/local-ci" is expected`. The one fact that
 * decided whether the branch could merge lived nowhere on the dashboard.
 *
 * Six rules.
 *
 * - **Required is read from GitHub, never inferred.** Branch protection and
 *   rulesets are the two places a requirement lives; both are read, the union
 *   is the requirement. A delivery stage's declared gates are a different claim
 *   and are not consulted here.
 * - **Unknown is not clear.** A base branch whose requirements could not be
 *   read yields `unknown`, never `satisfied`; a base with none yields
 *   `no-required`, which is a different fact.
 * - **Missing, failing and pending are three states.** A required check that
 *   was never posted needs somebody to produce it; a failing one needs a fix; a
 *   pending one needs patience. Collapsing them hides which.
 * - **Names match exactly**, as GitHub matches them. `AtlasMind/local-ci` and
 *   `atlasmind/local-ci` are different contexts there and here.
 * - **The AtlasMind check names its action.** When the missing check is the
 *   reviewed-PR status, the gap says so, so a surface can offer "Run reviewed
 *   PR" instead of a generic "a check is missing".
 * - **Nothing here fetches, posts or merges.** Inputs are parsed text; outputs
 *   are values a test walks.
 */

import type { PullRequestRecord, PullRequestStatusCheck } from './pullRequestTracker.js';

/** The checks a base branch requires, as read from GitHub. */
export interface RequiredCheckReading {
  branch: string;
  /** Exact context names. Empty means the branch requires none. */
  contexts: string[];
  /** Which sources answered. Both absent means the reading is unusable and must not be stored as known. */
  sources: Array<'branch-protection' | 'rulesets'>;
}

export type RequiredCheckGapState =
  | 'unknown'
  | 'no-required'
  | 'blocked-missing'
  | 'blocked-failing'
  | 'waiting'
  | 'satisfied';

export interface RequiredCheckGap {
  number: number;
  baseBranch: string;
  state: RequiredCheckGapState;
  /** Required contexts with no posted check at all. */
  missing: string[];
  /** Required contexts whose posted check failed. */
  failing: string[];
  /** Required contexts whose posted check has no verdict yet. */
  pending: string[];
  /** True when the reviewed-PR local-CI status is among the missing contexts. */
  localCiMissing: boolean;
  /** One sentence for a tag or a strip row. */
  summary: string;
}

const MAX_CONTEXTS = 50;
const MAX_CONTEXT_LENGTH = 200;

function cleanContext(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CONTEXT_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

function contextsFromProtection(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const required = (parsed as Record<string, unknown>)['required_status_checks'];
    if (!required || typeof required !== 'object') {
      // Protected without required checks: a real reading of "none".
      return [];
    }
    const record = required as Record<string, unknown>;
    const fromChecks = Array.isArray(record['checks'])
      ? (record['checks'] as unknown[]).map(check => cleanContext((check as Record<string, unknown> | null)?.['context']))
      : [];
    const fromContexts = Array.isArray(record['contexts'])
      ? (record['contexts'] as unknown[]).map(cleanContext)
      : [];
    return [...fromChecks, ...fromContexts].filter((value): value is string => value !== undefined);
  } catch {
    return undefined;
  }
}

/**
 * `GET repos/{slug}/rules/branches/{branch}` returns the rules that apply to
 * the branch, each `{ type, parameters }`; the ones that matter here are
 * `type: "required_status_checks"` with `parameters.required_status_checks[]`.
 */
function contextsFromRulesets(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const contexts: string[] = [];
    for (const rule of parsed.slice(0, 100)) {
      if (!rule || typeof rule !== 'object') {
        continue;
      }
      const record = rule as Record<string, unknown>;
      if (record['type'] !== 'required_status_checks') {
        continue;
      }
      const parameters = record['parameters'];
      if (!parameters || typeof parameters !== 'object') {
        continue;
      }
      const checks = (parameters as Record<string, unknown>)['required_status_checks'];
      if (!Array.isArray(checks)) {
        continue;
      }
      for (const check of checks) {
        const context = cleanContext((check as Record<string, unknown> | null)?.['context']);
        if (context) {
          contexts.push(context);
        }
      }
    }
    return contexts;
  } catch {
    return undefined;
  }
}

/**
 * Combine the two GitHub answers for one branch. Either may be absent (a 404
 * on protection is the normal answer for an unprotected branch or a reader
 * without admin rights; rulesets answer for anyone who can read the
 * repository). Both absent yields undefined, so a reading that could not be
 * taken is never stored as "requires nothing".
 */
export function parseRequiredCheckReading(
  branch: string,
  protectionRaw: string | undefined,
  rulesRaw: string | undefined,
): RequiredCheckReading | undefined {
  const protection = contextsFromProtection(protectionRaw);
  const rules = contextsFromRulesets(rulesRaw);
  if (protection === undefined && rules === undefined) {
    return undefined;
  }
  const sources: RequiredCheckReading['sources'] = [];
  if (protection !== undefined) {
    sources.push('branch-protection');
  }
  if (rules !== undefined) {
    sources.push('rulesets');
  }
  const contexts = [...new Set([...(protection ?? []), ...(rules ?? [])])].slice(0, MAX_CONTEXTS);
  return { branch, contexts, sources };
}

function checkOutcome(check: PullRequestStatusCheck): 'passed' | 'failed' | 'pending' | 'other' {
  const status = check.status.toLowerCase();
  const conclusion = check.conclusion.toLowerCase();
  if (['failure', 'timed_out', 'startup_failure', 'action_required', 'error'].includes(conclusion)) {
    return 'failed';
  }
  if (conclusion === 'success') {
    return 'passed';
  }
  if (['cancelled', 'skipped', 'neutral', 'stale'].includes(conclusion)) {
    return 'other';
  }
  if (status && status !== 'completed') {
    return 'pending';
  }
  return conclusion ? 'other' : 'pending';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Judge one open pull request against its base branch's requirement.
 *
 * `required` is keyed by base branch; a missing key means the branch was not
 * read. `localCiContext` is the status the reviewed-PR route posts.
 */
export function deriveRequiredCheckGap(
  pullRequest: Pick<PullRequestRecord, 'number' | 'baseRefName' | 'statusChecks'>,
  required: ReadonlyMap<string, RequiredCheckReading> | Record<string, RequiredCheckReading | undefined>,
  localCiContext: string,
): RequiredCheckGap {
  const reading = required instanceof Map
    ? required.get(pullRequest.baseRefName)
    : (required as Record<string, RequiredCheckReading | undefined>)[pullRequest.baseRefName];
  const base = { number: pullRequest.number, baseBranch: pullRequest.baseRefName, missing: [] as string[], failing: [] as string[], pending: [] as string[], localCiMissing: false };
  if (!reading) {
    return { ...base, state: 'unknown', summary: `Required checks for ${pullRequest.baseRefName} were not read.` };
  }
  if (reading.contexts.length === 0) {
    return { ...base, state: 'no-required', summary: `${pullRequest.baseRefName} requires no status checks.` };
  }
  // The rollup not having been read is not evidence that nothing was posted,
  // so without it every required context is "not read", reported as unknown.
  if (!Array.isArray(pullRequest.statusChecks)) {
    return { ...base, state: 'unknown', summary: `The checks posted on #${pullRequest.number} were not read, so its ${plural(reading.contexts.length, 'required check')} cannot be judged.` };
  }
  const byName = new Map<string, PullRequestStatusCheck[]>();
  for (const check of pullRequest.statusChecks) {
    const list = byName.get(check.name) ?? [];
    list.push(check);
    byName.set(check.name, list);
  }
  const missing: string[] = [];
  const failing: string[] = [];
  const pending: string[] = [];
  for (const context of reading.contexts) {
    const posted = byName.get(context);
    if (!posted || posted.length === 0) {
      missing.push(context);
      continue;
    }
    // Several posts under one name: the latest verdict is what GitHub shows,
    // but the rollup carries no order, so the worst state wins — a failure
    // beside a pass is not a pass.
    const outcomes = posted.map(checkOutcome);
    if (outcomes.includes('failed')) {
      failing.push(context);
    } else if (outcomes.includes('pending') || !outcomes.includes('passed')) {
      pending.push(context);
    }
  }
  const localCiMissing = missing.includes(localCiContext);
  if (missing.length > 0) {
    const named = missing.slice(0, 2).join(', ') + (missing.length > 2 ? ` +${missing.length - 2}` : '');
    return {
      ...base, missing, failing, pending, localCiMissing,
      state: 'blocked-missing',
      summary: localCiMissing
        ? `#${pullRequest.number} cannot merge: the required ${localCiContext} check has not been posted. Only a reviewed-PR local CI run posts it.`
        : `#${pullRequest.number} cannot merge: required check${missing.length === 1 ? '' : 's'} ${named} ${missing.length === 1 ? 'has' : 'have'} not been posted.`,
    };
  }
  if (failing.length > 0) {
    return { ...base, failing, pending, state: 'blocked-failing', summary: `#${pullRequest.number} cannot merge: required check${failing.length === 1 ? '' : 's'} ${failing.slice(0, 2).join(', ')} failed.` };
  }
  if (pending.length > 0) {
    return { ...base, pending, state: 'waiting', summary: `#${pullRequest.number} is waiting on ${plural(pending.length, 'required check')}.` };
  }
  return { ...base, state: 'satisfied', summary: `Every required check on #${pullRequest.number} has passed.` };
}

/** Every open pull request, judged. Closed and merged ones are not gaps. */
export function deriveRequiredCheckGaps(
  pullRequests: readonly PullRequestRecord[],
  required: ReadonlyMap<string, RequiredCheckReading> | Record<string, RequiredCheckReading | undefined>,
  localCiContext: string,
): RequiredCheckGap[] {
  return pullRequests
    .filter(pr => pr.state === 'open' || pr.state === 'draft')
    .map(pr => deriveRequiredCheckGap(pr, required, localCiContext));
}

/** The base branches worth asking GitHub about: those of the open pull requests, capped. */
export function requiredCheckBranchesToRead(pullRequests: readonly PullRequestRecord[], cap = 5): string[] {
  const seen = new Set<string>();
  for (const pr of pullRequests) {
    if ((pr.state === 'open' || pr.state === 'draft') && pr.baseRefName) {
      seen.add(pr.baseRefName);
    }
    if (seen.size >= cap) {
      break;
    }
  }
  return [...seen];
}

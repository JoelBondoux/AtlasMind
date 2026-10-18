import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AGENT_EVAL_CASES_PATH,
  checkPasses,
  compareWithBaseline,
  countDeclaredCases,
  readGoldenCaseFile,
  UPDATE_HOLD_RULES,
  definitionFingerprint,
  deterministicChecks,
  gradeCase,
  judgeChecks,
  sanitizeEvalBaseline,
  sanitizeGoldenCases,
  shouldHoldAgentUpdate,
  type EvalBaseline,
  type EvalRun,
  type GoldenCase,
} from '../../src/core/agentEvalHarness';

const AT = '2026-09-09T10:00:00.000Z';

const golden = (id: string, over: Partial<GoldenCase> = {}): GoldenCase => ({
  id,
  agentId: 'reviewer',
  prompt: 'Review this change.',
  checks: [{ kind: 'must-contain', value: 'security', describes: 'mentions security' }],
  rationale: 'A reviewer that stops mentioning security has regressed.',
  createdAt: AT,
  ...over,
});

const run = (agentId: string, results: EvalRun['results']): EvalRun => ({
  agentId,
  ranAt: AT,
  definitionFingerprint: 'abcd1234',
  results,
});

const baselineOf = (results: EvalRun['results']): EvalBaseline => ({
  version: 1,
  runs: [run('reviewer', results)],
});

describe('a case is graded by a declared check wherever possible', () => {
  it('decides the text checks by reading the text', () => {
    expect(checkPasses({ kind: 'must-contain', value: 'security', describes: '' }, 'On SECURITY: fine')).toBe(true);
    expect(checkPasses({ kind: 'must-not-contain', value: 'todo', describes: '' }, 'all done')).toBe(true);
    expect(checkPasses({ kind: 'must-match', value: '^Step \\d', describes: '' }, 'Step 1 do it')).toBe(true);
    expect(checkPasses({ kind: 'must-refuse', value: '', describes: '' }, 'I cannot help with that')).toBe(true);
  });

  it('fails a pattern that will not compile rather than passing it', () => {
    // A broken case needs attention; passing it hides whatever it pinned.
    expect(checkPasses({ kind: 'must-match', value: '([', describes: '' }, 'anything')).toBe(false);
  });

  it('separates the checks a model has to decide from the ones it does not', () => {
    const entry = golden('c1', {
      checks: [
        { kind: 'must-contain', value: 'security', describes: 'mentions security' },
        { kind: 'judge', value: 'Is it clear?', describes: 'reads clearly' },
      ],
    });
    expect(deterministicChecks(entry)).toHaveLength(1);
    expect(judgeChecks(entry)).toHaveLength(1);
  });

  it('marks a result a judge touched, so its confidence is never hidden', () => {
    const entry = golden('c1', {
      checks: [{ kind: 'judge', value: 'Is it clear?', describes: 'reads clearly' }],
    });
    const result = gradeCase(entry, {
      output: 'anything',
      judgeVerdicts: [{ value: 'Is it clear?', passed: true }],
    });
    expect(result.outcome).toBe('pass');
    expect(result.judged).toBe(true);
  });

  it('does not pass a judge check nobody answered', () => {
    // A suite must not go green by not asking.
    const entry = golden('c1', {
      checks: [{ kind: 'judge', value: 'Is it clear?', describes: 'reads clearly' }],
    });
    const result = gradeCase(entry, { output: 'anything' });
    expect(result.outcome).toBe('fail');
    expect(result.failedChecks[0]).toContain('not graded, so not passed');
  });

  it('names the checks that failed, so a failure is actionable', () => {
    const result = gradeCase(golden('c1'), { output: 'no mention of the topic' });
    expect(result.outcome).toBe('fail');
    expect(result.failedChecks).toEqual(['mentions security']);
  });
});

describe('an errored case is not a failed case', () => {
  it('short-circuits before any check is looked at', () => {
    // An empty output would fail every must-contain and look like a broken
    // prompt when the provider was simply down.
    const result = gradeCase(golden('c1'), { error: 'provider timed out' });
    expect(result.outcome).toBe('errored');
    expect(result.failedChecks).toEqual([]);
    expect(result.errorReason).toBe('provider timed out');
  });

  it('treats a missing output as errored rather than as an empty answer', () => {
    expect(gradeCase(golden('c1'), {}).outcome).toBe('errored');
  });

  it('is set aside by the verdict rather than counted against a change', () => {
    // Otherwise the gate blocks every rewrite during an outage and is switched
    // off by the end of the week.
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'errored', failedChecks: [], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
    );
    expect(verdict.regressions).toEqual([]);
    expect(verdict.errored).toEqual(['c1']);
    expect(verdict.summary).toContain('set aside');
  });
});

describe('no baseline is a first run, not a pass', () => {
  it('says so rather than reporting no regressions', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
      [golden('c1')],
      undefined,
    );
    expect(verdict.firstRun).toBe(true);
    expect(verdict.summary).toContain('First run');
    expect(verdict.summary).toContain('Nothing to compare against yet');
    expect(verdict.summary).not.toContain('No regressions');
  });

  it('is also a first run when the baseline holds no run for this agent', () => {
    const other: EvalBaseline = { version: 1, runs: [run('debugger', [])] };
    const verdict = compareWithBaseline('reviewer', run('reviewer', []), [golden('c1')], other);
    expect(verdict.firstRun).toBe(true);
  });
});

describe('a regression is pass to fail, never a score that moved', () => {
  it('reports a case that passed before and fails now', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'fail', failedChecks: ['mentions security'], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
    );
    expect(verdict.regressions).toHaveLength(1);
    expect(verdict.summary).toContain('passed before and fails now');
  });

  it('does not call a case that was already failing a regression', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'fail', failedChecks: ['x'], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'fail', failedChecks: ['x'], judged: false }]),
    );
    expect(verdict.regressions).toEqual([]);
  });

  it('reports a fix too, because that is usually the point of the change', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'fail', failedChecks: ['x'], judged: false }]),
    );
    expect(verdict.fixes).toEqual(['c1']);
    expect(verdict.summary).toContain('now passes');
  });
});

describe('an unrun case is not a passing case', () => {
  it('counts it as not run and states coverage', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
      [golden('c1'), golden('c2'), golden('c3')],
      baselineOf([{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
    );
    expect(verdict.notRun).toEqual(['c2', 'c3']);
    expect(verdict.declared).toBe(3);
    expect(verdict.ran).toBe(1);
    expect(verdict.summary).toContain('1 of 3 cases ran');
    expect(verdict.summary).toContain('2 did not run');
  });

  it('only considers cases declared for this agent', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', []),
      [golden('c1'), golden('other', { agentId: 'debugger' })],
      undefined,
    );
    expect(verdict.declared).toBe(1);
  });
});

describe('the gate on an unattended rewrite', () => {
  it('holds a rewrite that regressed a case', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'fail', failedChecks: ['x'], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
    );
    const decision = shouldHoldAgentUpdate(verdict, 1);
    expect(decision.hold).toBe(true);
    expect(decision.reason).toBe('regressions');
    expect(decision.detail).toContain('c1');
  });

  it('holds a rewrite that could not be verified at all', () => {
    // The cadence is unattended, and "we did not check" resolving to "ship it"
    // is how an unattended rewrite becomes an unattended regression.
    const decision = shouldHoldAgentUpdate(undefined, 3);
    expect(decision.hold).toBe(true);
    expect(decision.reason).toBe('not-verified');
    expect(decision.detail).toContain('unverified rewrite is not a passed one');
  });

  it('does not hold an agent nobody has written cases for, and says it was unchecked', () => {
    // Holding everything would freeze every agent on day one, and a gate that
    // blocks everything gets turned off.
    const decision = shouldHoldAgentUpdate(undefined, 0);
    expect(decision.hold).toBe(false);
    expect(decision.reason).toBe('no-cases');
    expect(decision.detail).toContain('nothing verified it either');
  });

  it('lets a clean run through', () => {
    const verdict = compareWithBaseline(
      'reviewer',
      run('reviewer', [{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
      [golden('c1')],
      baselineOf([{ caseId: 'c1', outcome: 'pass', failedChecks: [], judged: false }]),
    );
    expect(shouldHoldAgentUpdate(verdict, 1).hold).toBe(false);
  });
});

describe('the definition fingerprint', () => {
  it('changes when the prompt changes, so a rewrite cannot inherit a pass', () => {
    const before = definitionFingerprint('You review code.', 'Reviewer');
    expect(definitionFingerprint('You review code.', 'Reviewer')).toBe(before);
    expect(definitionFingerprint('You review code carefully.', 'Reviewer')).not.toBe(before);
  });
});

describe('the untrusted boundary', () => {
  it('drops a case with no rationale, because somebody will delete it later', () => {
    const cases = sanitizeGoldenCases([
      { id: 'c1', agentId: 'reviewer', prompt: 'do it', checks: [{ kind: 'must-contain', value: 'x', describes: 'x' }] },
    ]);
    expect(cases).toEqual([]);
  });

  it('drops a case with no checks, which would pass trivially', () => {
    // Worse than no case: a green tick that means nothing.
    const cases = sanitizeGoldenCases([
      { id: 'c1', agentId: 'reviewer', prompt: 'do it', rationale: 'because', checks: [] },
    ]);
    expect(cases).toEqual([]);
  });

  it('drops a case with no prompt, which cannot run', () => {
    expect(sanitizeGoldenCases([
      { id: 'c1', agentId: 'reviewer', rationale: 'because', checks: [{ kind: 'must-contain', value: 'x', describes: 'x' }] },
    ])).toEqual([]);
  });

  it('keeps a well-formed case and de-duplicates ids', () => {
    const cases = sanitizeGoldenCases([
      { id: 'same', agentId: 'reviewer', prompt: 'a', rationale: 'r', checks: [{ kind: 'must-contain', value: 'x', describes: 'x' }] },
      { id: 'same', agentId: 'reviewer', prompt: 'b', rationale: 'r', checks: [{ kind: 'judge', value: 'x', describes: 'x' }] },
    ]);
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map(entry => entry.id)).size).toBe(2);
  });

  it('coerces an unrecognised check kind rather than trusting it', () => {
    const cases = sanitizeGoldenCases([
      { id: 'c1', agentId: 'reviewer', prompt: 'a', rationale: 'r', checks: [{ kind: 'vibes', value: 'x', describes: 'x' }] },
    ]);
    expect(cases[0]!.checks[0]!.kind).toBe('must-contain');
  });

  it('reads an unrecognised stored outcome as not-run, never as pass', () => {
    // A baseline full of invented passes would report a regression on
    // everything the moment it was compared.
    const baseline = sanitizeEvalBaseline({
      version: 1,
      runs: [{ agentId: 'reviewer', results: [{ caseId: 'c1', outcome: 'probably-fine' }] }],
    });
    expect(baseline.runs[0]!.results[0]!.outcome).toBe('not-run');
  });

  it('never throws on rubbish', () => {
    for (const input of [undefined, null, 7, 'text', {}]) {
      expect(sanitizeGoldenCases(input)).toEqual([]);
      expect(sanitizeEvalBaseline(input).runs).toEqual([]);
    }
  });
});

describe('could not read the cases is not no cases', () => {
  const REFUSAL = 'Project memory has no single home: "alpha" and "beta" each hold a project_memory/ folder.';

  it('holds a rewrite whose cases could not be counted, naming why', () => {
    // The 0.498.1 defect: an ambiguous home read nothing, nothing read as
    // "no cases", and "no cases" is the one answer that releases a rewrite.
    const decision = shouldHoldAgentUpdate(undefined, { unreadable: REFUSAL });
    expect(decision.hold).toBe(true);
    expect(decision.reason).toBe('cases-unreadable');
    expect(decision.detail).toContain('could not read the cases is not no cases');
    expect(decision.detail).toContain(REFUSAL);
  });

  it('holds even when a verdict is supplied, because the verdict was measured against cases nobody could read', () => {
    const verdict = compareWithBaseline('reviewer', run('reviewer', []), [], undefined);
    expect(shouldHoldAgentUpdate(verdict, { unreadable: 'x' }).hold).toBe(true);
  });

  it('treats any count that is not a non-negative whole number as unreadable, never as none', () => {
    fc.assert(fc.property(
      fc.oneof(
        fc.double({ noInteger: true }),
        fc.integer({ max: -1 }),
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      ),
      count => {
        const decision = shouldHoldAgentUpdate(undefined, count);
        return decision.hold && decision.reason === 'cases-unreadable';
      },
    ));
  });

  it('releases only on a count that was actually taken and is zero', () => {
    fc.assert(fc.property(
      fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.string().map(unreadable => ({ unreadable }))),
      declared => {
        const decision = shouldHoldAgentUpdate(undefined, declared);
        return decision.hold === !(declared === 0);
      },
    ));
  });

  it('publishes a rule for every reason the gate can give', () => {
    const reasons: Array<keyof typeof UPDATE_HOLD_RULES> = ['cases-unreadable', 'no-cases', 'not-verified', 'regressions'];
    for (const reason of reasons) {
      expect(UPDATE_HOLD_RULES[reason].length).toBeGreaterThan(20);
    }
    expect(UPDATE_HOLD_RULES['cases-unreadable']).toContain('not no cases');
  });

  const cases = [golden('c1'), golden('c2'), golden('d1', { agentId: 'debugger' })];
  it.each([
    { label: 'ambiguous home, whatever a folder holds', source: { refusal: REFUSAL, read: { state: 'read' as const, cases } }, expected: 'unreadable' },
    { label: 'ambiguous home, nothing read', source: { refusal: REFUSAL }, expected: 'unreadable' },
    { label: 'cases file unreadable', source: { read: { state: 'unreadable' as const, reason: 'not JSON' } }, expected: 'unreadable' },
    { label: 'cases file absent', source: { read: { state: 'absent' as const } }, expected: 0 },
    { label: 'no folder open', source: {}, expected: 0 },
    { label: 'cases read', source: { read: { state: 'read' as const, cases } }, expected: 2 },
  ])('counts declared cases: $label', ({ source, expected }) => {
    const count = countDeclaredCases('reviewer', source);
    if (expected === 'unreadable') {
      expect(typeof count).toBe('object');
      expect(shouldHoldAgentUpdate(undefined, count).reason).toBe('cases-unreadable');
    } else {
      expect(count).toBe(expected);
    }
  });

  describe('reading the cases file', () => {
    const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-eval-cases-'));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));
    let n = 0;
    const rootWith = (content?: string): string => {
      n += 1;
      const root = path.join(scratch, `root-${n}`);
      mkdirSync(path.join(root, path.dirname(AGENT_EVAL_CASES_PATH)), { recursive: true });
      if (content !== undefined) {
        writeFileSync(path.join(root, AGENT_EVAL_CASES_PATH), content, 'utf8');
      }
      return root;
    };

    it('reads a missing file as absent — a project that declared none', () => {
      expect(readGoldenCaseFile(rootWith())).toEqual({ state: 'absent' });
      expect(readGoldenCaseFile(path.join(scratch, 'no-such-folder'))).toEqual({ state: 'absent' });
    });

    it('reads a file that is not JSON, or not a list, as unreadable rather than empty', () => {
      const broken = readGoldenCaseFile(rootWith('{ not json'));
      expect(broken.state).toBe('unreadable');
      const object = readGoldenCaseFile(rootWith('{"cases": []}'));
      expect(object.state).toBe('unreadable');
      expect(countDeclaredCases('reviewer', { read: object })).toEqual({ unreadable: expect.stringContaining('not a list') });
    });

    it('reads a valid file as its sanitized cases', () => {
      const read = readGoldenCaseFile(rootWith(JSON.stringify(cases)));
      expect(read.state).toBe('read');
      expect(countDeclaredCases('reviewer', { read })).toBe(2);
      expect(countDeclaredCases('debugger', { read })).toBe(1);
    });
  });
});

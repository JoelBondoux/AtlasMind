import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  fingerprint,
  beginWorkflowRun,
  completeWorkflowRun,
  findDeterminismBreaches,
  summarizeWorkflowHistory,
  appendWorkflowRecord,
  sanitizeWorkflowHistory,
  renderWorkflowHistoryMarkdown,
  MAX_WORKFLOW_HISTORY,
  type WorkflowHistoryFile,
  type WorkflowRunRecord,
} from '../../src/core/workflowAuditRecord';

const AT = '2026-07-29T12:00:00.000Z';

const run = (overrides: Partial<Parameters<typeof beginWorkflowRun>[0]> = {}) =>
  beginWorkflowRun({
    stageId: 'branching',
    action: 'derive branch name',
    actor: 'user',
    requestedLevel: 'propose',
    effectiveLevel: 'observe',
    inputs: { issue: 42, title: 'A thing' },
    at: AT,
    ...overrides,
  });

describe('canonicalJson — the property everything else rests on', () => {
  it('is insensitive to key order', () => {
    // Without this the determinism check cries wolf on every run: two objects
    // describing the same input would hash differently, and the report would be
    // noise until somebody turned it off.
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it('sorts nested keys too', () => {
    expect(fingerprint({ outer: { z: 1, a: 2 } })).toBe(fingerprint({ outer: { a: 2, z: 1 } }));
  });

  it('is sensitive to array order, which is meaningful', () => {
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });

  it('treats an absent key and an undefined one as the same', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1, b: undefined }));
  });

  it('distinguishes values that stringify alike', () => {
    expect(fingerprint('1')).not.toBe(fingerprint(1));
    expect(fingerprint(null)).not.toBe(fingerprint('null'));
  });

  it('produces a fingerprint short enough to compare by eye', () => {
    // The point of putting it in a committed file is that a human can diff it.
    expect(fingerprint({})).toHaveLength(16);
  });
});

describe('records', () => {
  it('opens as started, which is a real state rather than a placeholder', () => {
    // A run that never reached a terminal outcome left a record saying so, and
    // that beats both no record and an optimistic one.
    expect(run().outcome).toBe('started');
    expect(run().outputsFingerprint).toBeUndefined();
  });

  it('gives the same inputs the same id, so a retry can close the same record', () => {
    expect(run().id).toBe(run().id);
    expect(run({ inputs: { issue: 43 } }).id).not.toBe(run().id);
  });

  it('never mutates the record it closes', () => {
    const opened = run();
    const before = JSON.stringify(opened);
    completeWorkflowRun(opened, { outputs: { branch: 'feat/42-a-thing' }, outcome: 'complete' });
    expect(JSON.stringify(opened)).toBe(before);
  });

  it('records no output fingerprint for a run that produced nothing', () => {
    // Hashing `undefined` would produce a real-looking hash for something that
    // never existed, which is worse than an absent field.
    const failed = completeWorkflowRun(run(), { outcome: 'failed', detail: 'gh was unreachable' });
    expect(failed.outputsFingerprint).toBeUndefined();
    expect(failed.detail).toBe('gh was unreachable');
  });

  it('strips control characters from anything it stores as text', () => {
    const record = run({ action: 'derive branch\u001b[31m' });
    expect(/[\u0000-\u001f]/u.test(record.action)).toBe(false);
  });

  it('carries the level asked for and the level allowed as separate facts', () => {
    const record = run({ requestedLevel: 'auto', effectiveLevel: 'observe', limitedBy: 'master switch' });
    expect(record.requestedLevel).toBe('auto');
    expect(record.effectiveLevel).toBe('observe');
    expect(record.limitedBy).toBe('master switch');
  });
});

describe('findDeterminismBreaches — the check the record exists to make possible', () => {
  const complete = (inputs: unknown, outputs: unknown, at: string): WorkflowRunRecord =>
    completeWorkflowRun(run({ inputs, at }), { outputs, outcome: 'complete' });

  it('finds nothing when the same input produced the same output', () => {
    expect(findDeterminismBreaches([
      complete({ n: 1 }, { branch: 'a' }, AT),
      complete({ n: 1 }, { branch: 'a' }, '2026-07-30T12:00:00.000Z'),
    ])).toEqual([]);
  });

  it('names the stage and both runs when it differs', () => {
    // A count tells somebody they have a problem; the ids tell them where.
    const breaches = findDeterminismBreaches([
      complete({ n: 1 }, { branch: 'a' }, AT),
      complete({ n: 1 }, { branch: 'b' }, '2026-07-30T12:00:00.000Z'),
    ]);
    expect(breaches).toHaveLength(1);
    expect(breaches[0].stageId).toBe('branching');
    expect(breaches[0].outputs).toHaveLength(2);
    expect(breaches[0].outputs[0].recordId).toBeTruthy();
  });

  it('reports the differing outputs oldest first, because that reads forwards', () => {
    const breaches = findDeterminismBreaches([
      complete({ n: 1 }, { branch: 'b' }, '2026-07-30T12:00:00.000Z'),
      complete({ n: 1 }, { branch: 'a' }, AT),
    ]);
    expect(breaches[0].outputs.map(output => output.at)).toEqual([AT, '2026-07-30T12:00:00.000Z']);
  });

  it('does not compare the same input across different actions', () => {
    // They have no reason to agree, and treating them as a breach would fill
    // the report with false positives nobody could act on.
    const a = completeWorkflowRun(run({ inputs: { n: 1 }, action: 'derive branch name' }), { outputs: { x: 1 }, outcome: 'complete' });
    const b = completeWorkflowRun(run({ inputs: { n: 1 }, action: 'draft pull request' }), { outputs: { x: 2 }, outcome: 'complete' });
    expect(findDeterminismBreaches([a, b])).toEqual([]);
  });

  it('ignores runs that never completed', () => {
    // A failed run has no output; comparing "no output" against a real one
    // would report every failure as non-determinism.
    const done = complete({ n: 1 }, { branch: 'a' }, AT);
    const failed = completeWorkflowRun(run({ inputs: { n: 1 } }), { outcome: 'failed' });
    expect(findDeterminismBreaches([done, failed, run({ inputs: { n: 1 } })])).toEqual([]);
  });
});

describe('the ledger is append-only', () => {
  const empty: WorkflowHistoryFile = { version: 1, records: [] };

  it('adds newest first', () => {
    const one = appendWorkflowRecord(empty, run({ at: AT }));
    const two = appendWorkflowRecord(one, run({ at: '2026-07-30T12:00:00.000Z' }));
    expect(two.records[0].at).toBe('2026-07-30T12:00:00.000Z');
    expect(two.records).toHaveLength(2);
  });

  it('replaces only a record with the same id — closing an open one', () => {
    // The one non-append operation, and it exists solely so a record opened
    // before an action can be closed after it. Anything else is rewriting.
    const opened = run();
    const one = appendWorkflowRecord(empty, opened);
    const two = appendWorkflowRecord(one, completeWorkflowRun(opened, { outputs: { x: 1 }, outcome: 'complete' }));
    expect(two.records).toHaveLength(1);
    expect(two.records[0].outcome).toBe('complete');
  });

  it('states how much the cap dropped rather than forgetting silently', () => {
    // A ledger that quietly forgot is worse than one that says what it holds.
    let file: WorkflowHistoryFile = empty;
    for (let index = 0; index < MAX_WORKFLOW_HISTORY + 5; index += 1) {
      file = appendWorkflowRecord(file, run({ inputs: { index }, at: `2026-07-29T12:00:${String(index % 60).padStart(2, '0')}.000Z` }));
    }
    expect(file.records).toHaveLength(MAX_WORKFLOW_HISTORY);
    expect(file.droppedByCap).toBe(5);
    expect(renderWorkflowHistoryMarkdown(file)).toContain('5 older records dropped');
  });
});

describe('reading a ledger a human may have edited', () => {
  it('is total — anything unusable reads as empty rather than throwing', () => {
    expect(sanitizeWorkflowHistory(undefined).records).toEqual([]);
    expect(sanitizeWorkflowHistory('nonsense').records).toEqual([]);
    expect(sanitizeWorkflowHistory({ records: 'not an array' }).records).toEqual([]);
  });

  it('drops a fragment rather than repairing it into a record', () => {
    // Repairing would fabricate history, which is the one thing an audit trail
    // must never do.
    expect(sanitizeWorkflowHistory({ records: [{ stageId: 'ci' }] }).records).toEqual([]);
  });

  it('reads an unrecognised outcome as started, never as complete', () => {
    const file = sanitizeWorkflowHistory({
      records: [{ id: 'x', stageId: 'ci', at: AT, inputsFingerprint: 'abc', outcome: 'succeeded' }],
    });
    expect(file.records[0].outcome).toBe('started');
  });

  it('reads an unrecognised level as off, never as consent', () => {
    const file = sanitizeWorkflowHistory({
      records: [{ id: 'x', stageId: 'ci', at: AT, inputsFingerprint: 'abc', effectiveLevel: 'AUTO!' }],
    });
    expect(file.records[0].effectiveLevel).toBe('off');
  });

  it('round-trips a real record', () => {
    const record = completeWorkflowRun(run(), { outputs: { branch: 'feat/42-a-thing' }, outcome: 'complete' });
    const file = appendWorkflowRecord({ version: 1, records: [] }, record);
    expect(sanitizeWorkflowHistory(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });
});

describe('the mirror', () => {
  it('is deterministic', () => {
    const file = appendWorkflowRecord({ version: 1, records: [] }, run());
    expect(renderWorkflowHistoryMarkdown(file)).toBe(renderWorkflowHistoryMarkdown(file));
  });

  it('says why inputs are fingerprinted rather than stored', () => {
    // The file is committed. Somebody reading it needs to know that is a choice
    // about what goes into the repository, not a size optimisation.
    expect(renderWorkflowHistoryMarkdown({ version: 1, records: [] }))
      .toMatch(/fingerprints, not values/i);
  });

  it('shows a capped level alongside the one that was asked for', () => {
    const file = appendWorkflowRecord({ version: 1, records: [] },
      run({ requestedLevel: 'auto', effectiveLevel: 'observe', limitedBy: 'master switch' }));
    expect(renderWorkflowHistoryMarkdown(file)).toContain('asked for');
    expect(renderWorkflowHistoryMarkdown(file)).toContain('master switch');
  });

  it('says there are no runs rather than rendering an empty table', () => {
    expect(renderWorkflowHistoryMarkdown({ version: 1, records: [] })).toContain('no runs recorded yet');
  });

  it('surfaces a determinism breach in its own section', () => {
    const a = completeWorkflowRun(run({ inputs: { n: 1 }, at: AT }), { outputs: { x: 1 }, outcome: 'complete' });
    const b = completeWorkflowRun(run({ inputs: { n: 1 }, at: '2026-07-30T12:00:00.000Z' }), { outputs: { x: 2 }, outcome: 'complete' });
    const file = appendWorkflowRecord(appendWorkflowRecord({ version: 1, records: [] }, a), b);
    expect(renderWorkflowHistoryMarkdown(file)).toContain('Determinism breaches');
  });
});

describe('summarizeWorkflowHistory', () => {
  it('counts unfinished runs as their own category', () => {
    const file = appendWorkflowRecord({ version: 1, records: [] }, run());
    expect(summarizeWorkflowHistory(file).unfinished).toBe(1);
    expect(summarizeWorkflowHistory(file).failed).toBe(0);
  });

  it('reports zero of everything for an empty ledger without inventing a shape', () => {
    const summary = summarizeWorkflowHistory({ version: 1, records: [] });
    expect(summary.total).toBe(0);
    expect(summary.byStage).toEqual([]);
    expect(summary.breaches).toEqual([]);
  });
});

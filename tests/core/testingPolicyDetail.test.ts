import { describe, expect, it } from 'vitest';
import {
  TESTING_SEVERITY_RULES,
  deriveTestingPolicyDetails,
  gradeTestingPolicy,
  buildTestingFollowUpDraft,
  buildTestingIssueDraft,
} from '../../src/core/testingPolicyDetail.ts';
import type { TestingPolicyRow } from '../../src/core/testingPolicyCoverage.ts';
import type { TestingMethodologyId } from '../../src/types.ts';

/**
 * The Policy coverage board could say what evidence each policy had. It could
 * not say the thing somebody acts on — how bad is this, whose is it, what is
 * the next move — so nine gaps read as nine equally-weighted paragraphs and
 * nobody owned any of them.
 *
 * These tests pin the three properties that keep the answer trustworthy:
 * severity comes from a declared table so grades stay comparable over time,
 * nothing here files anything outward-facing, and an unassessed policy is never
 * reported as a healthy one.
 */
function row(over: Partial<TestingPolicyRow> = {}): TestingPolicyRow {
  return {
    id: 'unit' as TestingMethodologyId,
    label: 'Unit Testing',
    category: 'structural',
    status: 'covered',
    statusLabel: 'Tested',
    fileCount: 3,
    caseCount: 12,
    skippedCount: 0,
    failedCount: 0,
    toolingSignals: ['vitest'],
    detail: 'Twelve cases across three files.',
    actionPrompt: 'review',
    failures: [],
    ...over,
  };
}

describe('severity comes from the declared table', () => {
  it('grades failing tests as serious', () => {
    const finding = gradeTestingPolicy(row({ failedCount: 2 }), { hasReport: true });
    expect(finding.severity).toBe('serious');
    expect(finding.ruleId).toBe('failing');
  });

  it('grades an unevidenced compliance policy as serious', () => {
    const finding = gradeTestingPolicy(
      row({ id: 'gdpr' as TestingMethodologyId, label: 'GDPR', category: 'compliance-security', status: 'missing', caseCount: 0, fileCount: 0 }),
      { hasReport: true },
    );
    expect(finding.severity).toBe('serious');
    expect(finding.ruleId).toBe('unevidenced-sensitive');
  });

  it('grades an unevidenced ordinary policy as moderate, not serious', () => {
    // Everything being urgent is how nothing becomes urgent.
    const finding = gradeTestingPolicy(
      row({ id: 'snapshot' as TestingMethodologyId, label: 'Snapshot', category: 'behavioral', status: 'missing', caseCount: 0, fileCount: 0 }),
      { hasReport: true },
    );
    expect(finding.severity).toBe('moderate');
  });

  it('does not treat visual regression as a security concern', () => {
    // Non-functional is a mixed family — grading a screenshot diff like a
    // security gap would make the serious count meaningless.
    const finding = gradeTestingPolicy(
      row({ id: 'visual' as TestingMethodologyId, label: 'Visual', category: 'non-functional', status: 'missing', caseCount: 0, fileCount: 0 }),
      { hasReport: true },
    );
    expect(finding.severity).toBe('moderate');
  });

  it('never grades a practice as a gap', () => {
    // The coverage board already refuses to report one; this must agree.
    const finding = gradeTestingPolicy(
      row({ id: 'exploratory' as TestingMethodologyId, status: 'not-file-evident', caseCount: 0, fileCount: 0 }),
      { hasReport: true },
    );
    expect(finding.severity).toBe('none');
  });

  it('flags a suite where every case is skipped', () => {
    const finding = gradeTestingPolicy(row({ caseCount: 5, skippedCount: 5 }), { hasReport: true });
    expect(finding.ruleId).toBe('skipped');
  });

  it('names the rule that graded it, from the published table', () => {
    const published = new Set(TESTING_SEVERITY_RULES.map(rule => rule.label));
    for (const status of ['covered', 'missing', 'tooling-only', 'not-file-evident'] as const) {
      const finding = gradeTestingPolicy(row({ status, caseCount: 0 }), { hasReport: true });
      expect(published.has(finding.rule), `${status} → ${finding.rule}`).toBe(true);
    }
  });

  it('ranks a failing test above a missing one', () => {
    // A test that runs and fails is a statement about the code; a test never
    // written is a statement about the plan.
    const both = gradeTestingPolicy(row({ status: 'missing', failedCount: 1 }), { hasReport: true });
    expect(both.ruleId).toBe('failing');
  });
});

describe('unassessed is never reported as healthy', () => {
  it('marks a clear policy unverified when no report exists', () => {
    const finding = gradeTestingPolicy(row(), { hasReport: false });
    expect(finding.severity).toBe('none');
    expect(finding.unverified).toBe(true);
  });

  it('does not weaken a finding that does not rest on the report', () => {
    // "No test files exist" is a fact about the tree. No report would change it,
    // so hedging it would be noise.
    const finding = gradeTestingPolicy(row({ status: 'missing', caseCount: 0, fileCount: 0 }), { hasReport: false });
    expect(finding.unverified).toBe(false);
  });

  it('says so in the summary rather than claiming everything passes', () => {
    const set = deriveTestingPolicyDetails({ rows: [row()], report: undefined });
    expect(set.summary).toMatch(/no test report|has actually been run/i);
  });

  it('distinguishes an empty policy set from a clean one', () => {
    const set = deriveTestingPolicyDetails({ rows: [], report: undefined });
    expect(set.summary).toMatch(/not the same as nothing being wrong/i);
  });
});

describe('drafts are offered, never filed', () => {
  it('offers an issue only for a serious finding', () => {
    const serious = row({ failedCount: 3, failures: [{ name: 'a', kind: 'failure' }] });
    const moderate = row({ status: 'missing', caseCount: 0, fileCount: 0 });
    expect(buildTestingIssueDraft(serious, gradeTestingPolicy(serious, { hasReport: true }))).toBeDefined();
    expect(buildTestingIssueDraft(moderate, gradeTestingPolicy(moderate, { hasReport: true }))).toBeUndefined();
  });

  it('produces a byte-identical draft for the same finding', () => {
    // No model is in this path, which is what makes the draft reviewable before
    // it is posted publicly in somebody's name.
    const subject = row({ failedCount: 1, failures: [{ name: 'x', suite: 's', file: 'f.ts', kind: 'failure' }] });
    const finding = gradeTestingPolicy(subject, { hasReport: true });
    expect(JSON.stringify(buildTestingIssueDraft(subject, finding)))
      .toBe(JSON.stringify(buildTestingIssueDraft(subject, finding)));
  });

  it('says the issue does not govern the policy status', () => {
    const subject = row({ failedCount: 1 });
    const draft = buildTestingIssueDraft(subject, gradeTestingPolicy(subject, { hasReport: true }));
    expect(draft?.body).toMatch(/Closing this issue does not change/i);
  });

  it('suggests labels rather than asserting them', () => {
    // An unmatched label is created on the repository as a side effect of
    // filing, so the caller intersects these with the declared taxonomy.
    const subject = row({ id: 'gdpr' as TestingMethodologyId, category: 'compliance-security', status: 'missing', caseCount: 0, fileCount: 0 });
    const draft = buildTestingIssueDraft(subject, gradeTestingPolicy(subject, { hasReport: true }));
    expect(draft?.suggestedLabels).toContain('security');
  });

  it('never drafts a follow-up for a policy with nothing outstanding', () => {
    const clear = row();
    expect(buildTestingFollowUpDraft(clear, gradeTestingPolicy(clear, { hasReport: true }))).toBeUndefined();
  });

  it('gives a worse finding a sooner date', () => {
    const serious = row({ failedCount: 1 });
    const low = row({ status: 'tooling-only', caseCount: 0 });
    const soon = buildTestingFollowUpDraft(serious, gradeTestingPolicy(serious, { hasReport: true }));
    const later = buildTestingFollowUpDraft(low, gradeTestingPolicy(low, { hasReport: true }));
    expect(soon!.dueInDays).toBeLessThan(later!.dueInDays);
  });

  it('carries the grading rule into the follow-up notes', () => {
    const subject = row({ status: 'missing', caseCount: 0, fileCount: 0 });
    const draft = buildTestingFollowUpDraft(subject, gradeTestingPolicy(subject, { hasReport: true }));
    expect(draft!.notes).toMatch(/Graded moderate by the rule:/);
  });
});

describe('the derived set is what the dashboard renders', () => {
  it('counts every policy exactly once', () => {
    const set = deriveTestingPolicyDetails({
      rows: [row(), row({ id: 'e2e' as TestingMethodologyId, status: 'missing', caseCount: 0, fileCount: 0 })],
      report: undefined,
    });
    const total = Object.values(set.counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(set.details.length);
  });

  it('carries the grading table with the grades', () => {
    // A second copy in the renderer could describe a table the host no longer
    // uses, so the rules travel in the payload.
    const set = deriveTestingPolicyDetails({ rows: [row()], report: undefined });
    expect(set.rules.map(rule => rule.id)).toEqual(TESTING_SEVERITY_RULES.map(rule => rule.id));
  });

  it('charts a case mix only when there are cases to chart', () => {
    const set = deriveTestingPolicyDetails({
      rows: [row({ caseCount: 0, fileCount: 0, status: 'missing' }), row({ caseCount: 4, skippedCount: 1, failedCount: 1 })],
      report: undefined,
    });
    expect(set.details[0].caseMix).toBeUndefined();
    expect(set.details[1].caseMix).toEqual({ passing: 2, skipped: 1, failing: 1 });
  });

  it('offers a scaffold only where there is a gap and a recipe', () => {
    const rows = [
      row({ id: 'unit' as TestingMethodologyId, status: 'covered' }),
      row({ id: 'e2e' as TestingMethodologyId, status: 'missing', caseCount: 0, fileCount: 0 }),
      row({ id: 'mbt' as TestingMethodologyId, status: 'missing', caseCount: 0, fileCount: 0 }),
    ];
    const set = deriveTestingPolicyDetails({ rows, report: undefined }, {
      // `mbt` deliberately absent: no recipe for this stack.
      scaffoldable: new Set(['unit', 'e2e']),
    });
    const by = new Map(set.details.map(detail => [detail.id, detail.scaffoldable]));
    expect(by.get('unit'), 'already evidenced — nothing to scaffold').toBe(false);
    expect(by.get('e2e'), 'gap with a recipe').toBe(true);
    expect(by.get('mbt'), 'gap with no recipe for this stack').toBe(false);
  });

  it('never claims a scaffold when the caller supplied no answer', () => {
    const set = deriveTestingPolicyDetails({
      rows: [row({ status: 'missing', caseCount: 0, fileCount: 0 })], report: undefined,
    });
    expect(set.details[0].scaffoldable).toBe(false);
  });
});

describe('a testing follow-up survives the Director sanitizer', () => {
  it('keeps its link to the policy', async () => {
    // The sanitizer whitelists `linked.kind` and resets anything unrecognised
    // to `none`. That is the right failure for foreign data and the wrong one
    // here: the follow-up would persist while quietly forgetting which policy
    // it was about, and only on the *second* read would anybody notice.
    const { sanitizeProjectDirectorConfig, defaultProjectDirectorConfig } =
      await import('../../src/core/projectDirectorManager.ts');
    const base = defaultProjectDirectorConfig();
    const clean = sanitizeProjectDirectorConfig({
      ...base,
      followUps: [{
        id: 'fu-testing-gdpr-1',
        title: 'Testing: GDPR — needs attention',
        dueDate: '2026-09-01',
        cadence: 'once',
        status: 'open',
        linked: { kind: 'testing-policy', id: 'gdpr' },
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z',
      }],
    });
    expect(clean?.followUps[0].linked).toEqual({ kind: 'testing-policy', id: 'gdpr' });
  });
});

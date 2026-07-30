import { describe, expect, it } from 'vitest';
import {
  reconcileTestingPolicy,
  applyTestingReconciliation,
  describeTestingReconciliation,
} from '../../src/core/testingReconciliation.ts';
import { deriveTestingPolicyCoverage } from '../../src/core/testingPolicyCoverage.ts';
import type { TestingPolicyEvidenceInput } from '../../src/core/testingPolicyCoverage.ts';
import type { ProjectTestingConfig, TestingMethodologyId } from '../../src/types.ts';

const config = (entries: Array<{ id: TestingMethodologyId; enabled: boolean; notes?: string }>): ProjectTestingConfig => ({
  version: 2,
  updatedAt: '2026-07-30T00:00:00.000Z',
  methodologies: entries,
});

const coverage = (over: Partial<TestingPolicyEvidenceInput> = {}) => deriveTestingPolicyCoverage({
  enabledMethodologies: [],
  testFiles: [],
  dependencies: [],
  scripts: [],
  configFiles: [],
  ...over,
});

describe('reconcileTestingPolicy', () => {
  it('proposes dropping a methodology with no tests and no tooling', () => {
    // The eight that sat unevidenced on this project for seven weeks.
    const result = reconcileTestingPolicy({
      config: config([{ id: 'mutation', enabled: true }]),
      coverage: coverage({ enabledMethodologies: ['mutation'] }),
    });

    const proposal = result.proposals.find(entry => entry.id === 'mutation');
    expect(proposal?.action).toBe('drop');
    expect(proposal?.enabledAfter).toBe(false);
    expect(result.changes).toHaveLength(1);
  });

  it('keeps a methodology whose tooling is installed rather than dropping it', () => {
    // Somebody started. Dropping this would discard a decision already acted on.
    const result = reconcileTestingPolicy({
      config: config([{ id: 'e2e', enabled: true }]),
      coverage: coverage({ enabledMethodologies: ['e2e'], dependencies: ['@playwright/test'] }),
    });

    const proposal = result.proposals.find(entry => entry.id === 'e2e');
    expect(proposal?.action).toBe('commit');
    expect(proposal?.enabledAfter).toBe(true);
    // No change to apply — it stays enabled, and stays a visible gap.
    expect(result.changes).toHaveLength(0);
    expect(proposal?.reason).toContain('leaves a visible gap');
  });

  it('leaves an evidenced methodology alone', () => {
    const result = reconcileTestingPolicy({
      config: config([{ id: 'unit', enabled: true }]),
      coverage: coverage({
        enabledMethodologies: ['unit'],
        testFiles: [{ relativePath: 'tests/a.test.ts', cases: 3, skipped: 0 }],
      }),
    });

    expect(result.proposals.find(entry => entry.id === 'unit')?.action).toBe('keep');
    expect(result.changes).toHaveLength(0);
    expect(result.summary).toContain('matches the repository');
  });

  it('proposes adopting something the project practises but never declared', () => {
    // `integration` on this project: switched off in the config while its tests
    // sat in the tree and ran on every commit.
    const result = reconcileTestingPolicy({
      config: config([{ id: 'integration', enabled: false }]),
      coverage: coverage(),
      unenabledWithEvidence: ['integration'],
    });

    const proposal = result.proposals.find(entry => entry.id === 'integration');
    expect(proposal?.action).toBe('adopt');
    expect(proposal?.enabledAfter).toBe(true);
    expect(result.changes).toHaveLength(1);
  });

  it('proposes nothing for a practice, which has no evidence to be missing', () => {
    const result = reconcileTestingPolicy({
      config: config([{ id: 'exploratory', enabled: true }]),
      coverage: coverage({ enabledMethodologies: ['exploratory'] }),
    });

    expect(result.proposals).toHaveLength(0);
    // Not "everything matches" — there was nothing comparable in the first place.
    expect(result.summary).toContain('nothing to compare');
  });

  it('says the comparison did not run rather than that it found nothing', () => {
    const result = reconcileTestingPolicy({ config: undefined, coverage: undefined });
    expect(result.changes).toHaveLength(0);
    expect(result.summary).toContain('has not been compared');
  });

  it('ranks drops and adoptions above the entries that need no decision', () => {
    const result = reconcileTestingPolicy({
      config: config([
        { id: 'unit', enabled: true },
        { id: 'mutation', enabled: true },
        { id: 'integration', enabled: false },
      ]),
      coverage: coverage({
        enabledMethodologies: ['unit', 'mutation'],
        testFiles: [{ relativePath: 'tests/a.test.ts', cases: 1, skipped: 0 }],
      }),
      unenabledWithEvidence: ['integration'],
    });

    expect(result.proposals.map(entry => entry.action)).toEqual(['drop', 'adopt', 'keep']);
  });
});

describe('applyTestingReconciliation', () => {
  it('changes only whether a methodology is declared, never how it was configured', () => {
    // A reconciliation decides *whether* something is declared. Discarding the
    // assigned agent or the notes would make re-enabling it later a fresh start
    // rather than a restoration.
    const before = config([{ id: 'mutation', enabled: true, notes: 'Ask Priya before removing this.' }]);
    const result = reconcileTestingPolicy({ config: before, coverage: coverage({ enabledMethodologies: ['mutation'] }) });

    const after = applyTestingReconciliation(before, result.changes);

    expect(after.methodologies[0]?.enabled).toBe(false);
    expect(after.methodologies[0]?.notes).toBe('Ask Priya before removing this.');
  });

  it('leaves an entry no proposal mentions completely untouched', () => {
    const before = config([{ id: 'unit', enabled: true }, { id: 'snapshot', enabled: false }]);
    const after = applyTestingReconciliation(before, []);
    expect(after.methodologies).toEqual(before.methodologies);
  });
});

describe('describeTestingReconciliation', () => {
  it('spells out each change so a confirmation shows what it approves', () => {
    const result = reconcileTestingPolicy({
      config: config([{ id: 'mutation', enabled: true }]),
      coverage: coverage({ enabledMethodologies: ['mutation'] }),
    });

    const description = describeTestingReconciliation(result.changes);
    expect(description).toContain('Disable Mutation');
    // "Reconcile the testing policy?" with a count asks somebody to approve a
    // rewrite of a tracked file without seeing what it says.
    expect(description).toContain('no tests and no tooling');
  });
});

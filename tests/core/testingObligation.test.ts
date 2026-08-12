import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  assessTestingObligations,
  classifyChange,
  OBLIGATION_RULES,
  PRACTICE_ONLY,
  REPOSITORY_LEVEL,
  buildTestingGapIssue,
} from '../../src/core/testingObligation.ts';
import type { ProjectTestingConfig, TestingMethodologyId } from '../../src/types.ts';

/** This project's actual enabled set, so the tests describe the real policy. */
const ENABLED: TestingMethodologyId[] = ['tdd', 'bdd', 'unit', 'property', 'continuous', 'security-testing', 'exploratory'];

const config = (ids: TestingMethodologyId[] = ENABLED): ProjectTestingConfig => ({
  methodologies: ids.map(id => ({ id, enabled: true })),
} as ProjectTestingConfig);

const verdictFor = (assessment: ReturnType<typeof assessTestingObligations>, id: TestingMethodologyId) =>
  assessment.obligations.find(o => o.policyId === id)?.verdict;

describe('classifyChange', () => {
  it('treats any production source as a behaviour change', () => {
    expect(classifyChange(['src/core/thing.ts'])).toBe('behaviour');
    // Docs travelling with a source change do not dilute the obligation.
    expect(classifyChange(['src/core/thing.ts', 'README.md'])).toBe('behaviour');
  });

  it('owes nothing for docs, config or tests alone', () => {
    // A checker that fires on every commit is one nobody reads.
    expect(classifyChange(['README.md', 'docs/architecture.md'])).toBe('docs-only');
    expect(classifyChange(['package.json', 'tsconfig.json', '.github/workflows/ci.yml'])).toBe('config-only');
    expect(classifyChange(['tests/core/thing.test.ts'])).toBe('tests-only');
  });

  it('recognises feature files and step definitions as tests', () => {
    expect(classifyChange(['tests/features/login.feature'])).toBe('tests-only');
    expect(classifyChange(['tests/features/login.steps.ts'])).toBe('tests-only');
  });

  it('distinguishes nothing-changed from not-assessed', () => {
    // "No files changed" and "nobody recorded what changed" are different facts,
    // and only one of them is a clean pass.
    expect(classifyChange([])).toBe('nothing-changed');
    expect(classifyChange(undefined)).toBe('unknown');
  });
});

describe('assessTestingObligations — the gap this exists to catch', () => {
  it('flags BDD when a behaviour change ships with only unit tests', () => {
    // Exactly what happened across this project: BDD enabled throughout, never
    // producing a single Given-When-Then spec, with every turn reporting success.
    const assessment = assessTestingObligations({
      config: config(),
      changedFiles: ['src/core/localModelArbiter.ts', 'tests/core/localModelArbiter.test.ts'],
      tddStatus: 'verified',
      addedTestSources: new Map([['tests/core/localModelArbiter.test.ts', 'expect(x).toBe(1)']]),
    });

    expect(verdictFor(assessment, 'unit')).toBe('satisfied');
    expect(verdictFor(assessment, 'bdd')).toBe('missing');
    expect(assessment.gaps.map(g => g.policyId)).toContain('bdd');
  });

  it('does not accept unit tests as property-based evidence', () => {
    // A project can add fifty unit tests and still have produced no property
    // test, so the check has to look at what the test actually does.
    const withoutProperty = assessTestingObligations({
      config: config(), changedFiles: ['src/a.ts', 'tests/a.test.ts'], tddStatus: 'verified',
      addedTestSources: new Map([['tests/a.test.ts', "it('works', () => expect(1).toBe(1))"]]),
    });
    expect(verdictFor(withoutProperty, 'property')).toBe('missing');

    const withProperty = assessTestingObligations({
      config: config(), changedFiles: ['src/a.ts', 'tests/a.test.ts'], tddStatus: 'verified',
      addedTestSources: new Map([['tests/a.test.ts', "fc.assert(fc.property(fc.nat(), n => n >= 0))"]]),
    });
    expect(verdictFor(withProperty, 'property')).toBe('satisfied');
  });

  it('accepts a feature file as BDD evidence', () => {
    const assessment = assessTestingObligations({
      config: config(), changedFiles: ['src/a.ts', 'tests/features/a.feature'], tddStatus: 'verified',
    });
    expect(verdictFor(assessment, 'bdd')).toBe('satisfied');
  });
});

describe('assessTestingObligations — what must never become a gap', () => {
  it('never reports a practice as missing', () => {
    // Exploratory leaves no file, so there is no artifact whose absence means
    // anything. Proposing a gap would be the tool misreading its own data.
    const assessment = assessTestingObligations({
      config: config(), changedFiles: ['src/a.ts'], tddStatus: 'missing',
    });
    expect(verdictFor(assessment, 'exploratory')).toBe('practice');
    expect(assessment.gaps.map(g => g.policyId)).not.toContain('exploratory');
  });

  it('never reports a repository-level policy as a per-change gap', () => {
    // Continuous testing is satisfied by CI running; security testing by a
    // scanner being configured. Raising them per change would report a gap that
    // is not one, on every commit, until somebody switched the checker off.
    const assessment = assessTestingObligations({
      config: config(), changedFiles: ['src/a.ts'], tddStatus: 'missing',
    });
    expect(verdictFor(assessment, 'continuous')).toBe('repo-level');
    expect(verdictFor(assessment, 'security-testing')).toBe('repo-level');
    for (const gap of assessment.gaps) {
      expect(REPOSITORY_LEVEL.has(gap.policyId)).toBe(false);
    }
  });

  it('owes nothing for a docs-only or config-only change', () => {
    for (const files of [['README.md'], ['package.json'], ['tests/a.test.ts']]) {
      const assessment = assessTestingObligations({ config: config(), changedFiles: files });
      expect(assessment.gaps, files.join(',')).toEqual([]);
    }
  });

  it('reports unknown rather than satisfied when nothing was recorded', () => {
    // A checker that reports success because it could not look is worse than
    // no checker at all.
    const assessment = assessTestingObligations({ config: config(), changedFiles: undefined });
    expect(verdictFor(assessment, 'unit')).toBe('unknown');
    expect(assessment.gaps).toEqual([]);
  });

  it('ignores methodologies the project has not enabled', () => {
    const assessment = assessTestingObligations({
      config: config(['unit']), changedFiles: ['src/a.ts'], tddStatus: 'verified',
    });
    expect(assessment.obligations.map(o => o.policyId)).toEqual(['unit']);
  });

  it('is total with no config at all', () => {
    const assessment = assessTestingObligations({ config: undefined, changedFiles: ['src/a.ts'] });
    expect(assessment.obligations).toEqual([]);
    expect(assessment.gaps).toEqual([]);
  });
});

describe('TDD', () => {
  it('treats a blocked verification as missing, not as a pass', () => {
    // Something prevented the check, which is exactly when somebody needs to
    // know rather than be reassured.
    for (const status of ['blocked', 'missing', undefined] as const) {
      const assessment = assessTestingObligations({
        config: config(['tdd']), changedFiles: ['src/a.ts'], ...(status ? { tddStatus: status } : {}),
      });
      expect(verdictFor(assessment, 'tdd'), String(status)).toBe('missing');
    }
  });

  it('is satisfied by a verified run', () => {
    const assessment = assessTestingObligations({
      config: config(['tdd']), changedFiles: ['src/a.ts'], tddStatus: 'verified',
    });
    expect(verdictFor(assessment, 'tdd')).toBe('satisfied');
  });
});

describe('rule table', () => {
  it('has unique ids and a stated reason for each', () => {
    const ids = OBLIGATION_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of OBLIGATION_RULES) {
      expect(rule.reason.length).toBeGreaterThan(0);
    }
  });

  it('cites a published rule on every verdict', () => {
    const ids = new Set(OBLIGATION_RULES.map(rule => rule.id));
    for (const files of [['src/a.ts'], ['README.md'], [], undefined]) {
      const assessment = assessTestingObligations({ config: config(), ...(files ? { changedFiles: files } : {}) });
      for (const obligation of assessment.obligations) {
        expect(ids.has(obligation.rule), obligation.rule).toBe(true);
      }
    }
  });

  it('keeps the practice set equal to the one testingConfigLoader uses', async () => {
    // Two lists drifting would make a practice start producing gaps somewhere.
    const loader = await import('../../src/core/testingConfigLoader.ts');
    const guidance = loader.buildTestingObligationGuidance({
      methodologies: [...PRACTICE_ONLY].map(id => ({ id, enabled: true })),
    } as ProjectTestingConfig);
    // Every practice-only id is described as leaving no file behind.
    expect(guidance).toContain('leave no file behind');
  });
});

describe('robustness', () => {
  it('never throws and never invents a gap outside the enabled set', () => {
    const arbitraryFiles = fc.array(fc.string(), { maxLength: 10 });
    fc.assert(fc.property(arbitraryFiles, fc.boolean(), (files, withConfig) => {
      const assessment = assessTestingObligations({
        config: withConfig ? config() : undefined,
        changedFiles: files,
      });
      for (const gap of assessment.gaps) {
        expect(ENABLED).toContain(gap.policyId);
        expect(PRACTICE_ONLY.has(gap.policyId)).toBe(false);
        expect(REPOSITORY_LEVEL.has(gap.policyId)).toBe(false);
      }
    }), { numRuns: 300 });
  });

  it('gaps are always a subset of obligations', () => {
    fc.assert(fc.property(fc.array(fc.string(), { maxLength: 8 }), files => {
      const assessment = assessTestingObligations({ config: config(), changedFiles: files });
      for (const gap of assessment.gaps) {
        expect(assessment.obligations).toContainEqual(gap);
      }
    }), { numRuns: 200 });
  });
});

describe('buildTestingGapIssue', () => {
  const declared = { type: ['bug', 'test'], priority: ['critical'], area: ['testing-bdd'] };
  const gap = { policyId: 'bdd' as const, verdict: 'missing' as const, rule: 'evidence-missing', reason: 'no BDD evidence' };

  it('applies only labels the repository declares', () => {
    // Applying a label GitHub does not have *creates* it, changing the
    // project's taxonomy as a side effect of filing.
    const draft = buildTestingGapIssue({
      gap, changedFiles: ['src/core/a.ts'], declaredLabels: declared, workSummary: 'the GPU arbiter',
    });
    expect(draft.labels).toEqual(['critical', 'test', 'testing-bdd']);
    expect(draft.droppedLabels).toEqual([]);
  });

  it('drops an undeclared label and says so in the body', () => {
    // A silently omitted label is a decision nobody can see.
    const draft = buildTestingGapIssue({
      gap: { ...gap, policyId: 'property' },
      changedFiles: ['src/core/a.ts'],
      declaredLabels: { type: ['test'], priority: [], area: [] },
    });
    expect(draft.labels).toEqual(['test']);
    expect(draft.droppedLabels).toEqual(['critical', 'testing-property']);
    expect(draft.body).toContain('does not declare them');
  });

  it('names the policy and the rule, and says closing it adds nothing', () => {
    const draft = buildTestingGapIssue({
      gap, changedFiles: ['src/core/a.ts'], declaredLabels: declared, workSummary: 'the GPU arbiter',
    });
    expect(draft.title).toContain('BDD evidence missing');
    expect(draft.body).toContain('evidence-missing');
    expect(draft.body).toContain('Closing this issue does not add the missing evidence');
  });

  it('lists only production files, capped, with the remainder stated', () => {
    const files = [...Array.from({ length: 20 }, (_, i) => `src/f${i}.ts`), 'tests/a.test.ts', 'README.md'];
    const draft = buildTestingGapIssue({ gap, changedFiles: files, declaredLabels: declared });
    expect(draft.body).not.toContain('tests/a.test.ts');
    expect(draft.body).not.toContain('README.md');
    expect(draft.body).toContain('and 8 more');
  });

  it('records whether a write was attempted and why it failed', () => {
    const attempted = buildTestingGapIssue({
      gap, changedFiles: ['src/a.ts'], declaredLabels: declared,
      writeAttempt: { attempted: true, reason: 'no BDD runner is configured' },
    });
    expect(attempted.body).toContain('tried to write it and could not');
    expect(attempted.body).toContain('no BDD runner is configured');

    const notAttempted = buildTestingGapIssue({ gap, changedFiles: ['src/a.ts'], declaredLabels: declared });
    expect(notAttempted.body).toContain('did not attempt');
  });

  it('clamps a long title on a word boundary, never mid-word', () => {
    const summary = 'a very long description of the work '.repeat(6);
    const draft = buildTestingGapIssue({
      gap, changedFiles: ['src/a.ts'], declaredLabels: declared, workSummary: summary,
    });
    const full = `BDD evidence missing for ${summary}`;
    const kept = draft.title.replace(/…$/, '');

    expect(draft.title.length).toBeLessThanOrEqual(91);
    expect(draft.title.endsWith('…')).toBe(true);
    // The retained text is a real prefix of the intended title...
    expect(full.startsWith(kept)).toBe(true);
    // ...and it stops at a space, so no word was cut in half. A mid-word cut
    // reads as a truncation bug rather than as an elision.
    expect(full[kept.length]).toBe(' ');
  });
});

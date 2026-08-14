import { describe, it, expect } from 'vitest';
import { DEBT_RULES, deriveDebtFromSignals, renderDebtMarkdown } from '../../src/core/debtRegister.js';
import { TESTING_SEVERITY_RULES, gradeTestingPolicy } from '../../src/core/testingPolicyDetail.js';
import { buildAttentionFeed, ATTENTION_VISIBLE_CAP } from '../../src/core/attentionFeed.js';
import { sanitizeIncomingFindings } from '../../src/core/researchRegister.js';
import type { TestingPolicyRow } from '../../src/core/testingPolicyCoverage.js';

/**
 * Explainability, as this codebase means it: **a grade names the rule that
 * produced it, and the rule comes from a declared table.**
 *
 * Every register here — debt, testing severity, attention, research — was built
 * on the same argument: a score assigned last Tuesday must be comparable with
 * one assigned today, which is only true if a table decided it rather than a
 * model, and only checkable if the table travels with the answer. Each module
 * has its own tests for what it grades. What none of them can see is the
 * property *across* them, which is where it actually breaks: somebody adds a
 * seventh register, grades things sensibly, and forgets to publish the rule.
 * The board then holds two kinds of severity, one you can argue with and one
 * you cannot, and the difference is invisible on the card.
 *
 * So this suite is deliberately shallow and wide. It asks one question of every
 * grading surface: can a reader find out why?
 */

// ── The declared tables themselves ───────────────────────────────

describe('a rule table is a published contract', () => {
  const tables: ReadonlyArray<{ name: string; ids: readonly string[]; descriptions: readonly string[] }> = [
    {
      name: 'DEBT_RULES',
      ids: DEBT_RULES.map(rule => rule.id),
      descriptions: DEBT_RULES.map(rule => rule.describes),
    },
    {
      name: 'TESTING_SEVERITY_RULES',
      ids: TESTING_SEVERITY_RULES.map(rule => rule.id),
      descriptions: TESTING_SEVERITY_RULES.map(rule => rule.label),
    },
  ];

  for (const table of tables) {
    it(`${table.name} has distinct ids`, () => {
      // A duplicate id makes "which rule graded this?" unanswerable while
      // looking perfectly fine on the card.
      expect(new Set(table.ids).size).toBe(table.ids.length);
    });

    it(`${table.name} explains every rule in words`, () => {
      for (const description of table.descriptions) {
        expect(description.trim().length).toBeGreaterThan(0);
      }
    });
  }

  it('grades a security marker high whatever else it looks like, and says so first', () => {
    // The ordering is part of the contract, not an implementation detail: the
    // table is first-match-wins, so a security rule placed anywhere but first
    // changes what the register reports without changing any rule's text.
    expect(DEBT_RULES[0]?.id).toBe('security-marker');
    expect(DEBT_RULES[0]?.severity).toBe('high');
  });
});

// ── Every graded output carries its rule ─────────────────────────

describe('every grade names a rule from its own table', () => {
  it('grades a testing policy with a rule id the table declares', () => {
    const declaredIds = new Set<string>(TESTING_SEVERITY_RULES.map(rule => rule.id));
    const statuses: ReadonlyArray<TestingPolicyRow['status']> =
      ['covered', 'tooling-only', 'missing', 'not-file-evident'];

    // Walked across the grading inputs rather than one happy path: the point
    // is that *no* combination reaches a grade with no rule behind it.
    for (const status of statuses) {
      for (const failedCount of [0, 3]) {
        for (const options of [
          { hasReport: true },
          { hasReport: false },
          { hasReport: true, uncoveredSubjects: 4, totalSubjects: 10 },
        ]) {
        const row = {
          id: 'unit',
          label: 'Unit Testing',
          category: 'structural',
          status,
          statusLabel: status,
          fileCount: status === 'covered' ? 2 : 0,
          caseCount: status === 'covered' ? 8 : 0,
          skippedCount: 0,
          failedCount,
          toolingSignals: status === 'tooling-only' ? ['vitest'] : [],
          detail: '',
          files: [],
          actionPrompt: '',
          failures: [],
        } as unknown as TestingPolicyRow;

        const finding = gradeTestingPolicy(row, options);
        expect(declaredIds, `${status}/${failedCount} produced an undeclared rule`).toContain(finding.ruleId);
        // The label travels with the id — a card showing an id alone is a
        // reference to a table the reader does not have.
        expect(finding.rule.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('grades every attention item with a stated rule', () => {
    const feed = buildAttentionFeed({
      testing: { failing: 4, uncovered: 2, hasReport: true },
      debt: { scanned: true, open: 5, high: 3 },
      risk: { assessed: true, open: 1 },
    });

    expect(feed.items.length).toBeGreaterThan(0);
    for (const item of feed.items) {
      expect(item.rule.trim().length, `"${item.label}" has no rule`).toBeGreaterThan(0);
      expect(item.detail.trim().length, `"${item.label}" has no detail`).toBeGreaterThan(0);
    }
  });

  it('grades a research finding with a rule, including the demotion rule', () => {
    const result = sanitizeIncomingFindings(
      [
        { title: 'Cited claim', detail: 'Observed.', citations: ['https://example.com/a'] },
        { title: 'Uncited claim', detail: 'Recalled.' },
      ],
      'competition',
      new Date('2026-01-01T00:00:00.000Z'),
    );

    for (const record of [...result.findings, ...result.questions]) {
      expect(record.rule.trim().length, `"${record.title}" has no rule`).toBeGreaterThan(0);
    }
    // The demotion in particular must say why: this is the record a reader is
    // most likely to challenge, and "low severity" alone does not explain it.
    expect(result.questions[0]?.rule.trim().length).toBeGreaterThan(0);
  });

  it('grades a derived debt entry with a rule from the same table as a marker', () => {
    // Derived entries are the ones most likely to drift onto a second scale:
    // they come from signals rather than from a comment, and grading them
    // separately would give the register two severities that cannot be compared.
    const declaredIds = new Set<string>(DEBT_RULES.map(rule => rule.id));
    const now = Date.parse('2026-06-01T00:00:00.000Z');
    const derived = deriveDebtFromSignals({
      now,
      // All four signal kinds, so a rule added for one of them without a table
      // entry is caught rather than skipped.
      pullRequests: [{
        number: 12,
        title: 'Bump lodash from 4.17.20 to 4.17.21',
        state: 'open',
        author: 'dependabot[bot]',
        labels: ['dependencies'],
        headRefName: 'dependabot/npm_and_yarn/lodash-4.17.21',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      uncoveredMethodologies: [{ id: 'contract', label: 'Contract Testing' }],
      staleDocuments: [{ path: 'docs/architecture.md' }],
      ciWorkflowCount: 0,
    });

    // Guard against a vacuous pass: an input that derives nothing would satisfy
    // the loop below without checking anything.
    expect(derived.length).toBeGreaterThan(0);
    for (const entry of derived) {
      expect(declaredIds, `derived entry "${entry.title}" used an undeclared rule`).toContain(entry.rule);
    }
  });
});

// ── The rule table reaches the reader ────────────────────────────

describe('the table travels with the answer', () => {
  it('publishes the debt rule table in the committed markdown mirror', () => {
    // The mirror is git-tracked and is where somebody reads the register
    // months later, without the dashboard open. A grade there with no table
    // beside it is a number nobody can argue with.
    const markdown = renderDebtMarkdown({ version: 1, entries: [] });
    for (const rule of DEBT_RULES) {
      expect(markdown, `the mirror does not publish rule "${rule.id}"`).toContain(rule.describes);
    }
  });

  it('states the remainder rather than silently truncating the attention feed', () => {
    // Explainability applies to the *list* as well as to each item: a capped
    // list that does not say it was capped reads as the whole of it.
    const feed = buildAttentionFeed({
      testing: { failing: 9, uncovered: 9, hasReport: true },
      debt: { scanned: true, open: 20, high: 9 },
      risk: { assessed: true, open: 9 },
      director: { overdue: 9 },
      issues: { loaded: true, stale: 9, unassigned: 4 },
      documents: { reviewDue: 9, missing: 2 },
      pipeline: { loaded: true, latestFailed: true },
      release: { blockedGates: 3 },
      ssot: { blocked: 2, warned: 5 },
    });

    expect(feed.items.length).toBeLessThanOrEqual(ATTENTION_VISIBLE_CAP);
    if (feed.hiddenCount > 0) {
      expect(feed.summary).toMatch(/\d/);
    }
  });
});

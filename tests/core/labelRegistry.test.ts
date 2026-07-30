import { describe, it, expect } from 'vitest';
import {
  parseGhLabelList,
  parseGhMilestoneList,
  safeLabelColor,
  describeLabelDeletionImpact,
  describeLabelDeletion,
  findTaxonomyDrift,
  normalizeLabelName,
} from '../../src/core/labelRegistry';

const issues = [
  { number: 1, labels: ['bug', 'ui'] },
  { number: 2, labels: ['bug'] },
  { number: 7, labels: ['docs'] },
];

describe('a colour is validated, not repaired', () => {
  it('accepts exactly six hex digits, lowercased', () => {
    expect(safeLabelColor('D73A4A')).toBe('d73a4a');
    expect(safeLabelColor(' d73a4a ')).toBe('d73a4a');
  });

  it('drops anything else rather than making it plausible', () => {
    // This value is rendered into a style attribute. A "colour" reaching a
    // stylesheet is an injection, and a nearly-valid one repaired into
    // something plausible is worse than a missing swatch.
    for (const bad of ['#d73a4a', 'red', 'd73a4', 'd73a4az', 'expression(alert(1))', '', null, 42]) {
      expect(safeLabelColor(bad), String(bad)).toBe('');
    }
  });
});

describe('parseGhLabelList', () => {
  const raw = JSON.stringify([
    { name: 'docs', color: '0075ca', description: 'Documentation' },
    { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
    { name: 'ui', color: 'bad', description: '' },
  ]);

  it('counts issues from the list already fetched, costing no request', () => {
    const labels = parseGhLabelList(raw, issues);
    expect(labels.find(label => label.name === 'bug')?.issueCount).toBe(2);
    expect(labels.find(label => label.name === 'ui')?.issueCount).toBe(1);
  });

  it('orders the load-bearing labels first, stably', () => {
    expect(parseGhLabelList(raw, issues).map(label => label.name)).toEqual(['bug', 'docs', 'ui']);
  });

  it('reports zero rather than nothing when a label is unused', () => {
    expect(parseGhLabelList(raw, []).every(label => label.issueCount === 0)).toBe(true);
  });

  it('drops an unusable colour without dropping the label', () => {
    const ui = parseGhLabelList(raw, issues).find(label => label.name === 'ui');
    expect(ui).toBeDefined();
    expect(ui?.color).toBe('');
  });

  it('drops a nameless entry rather than inventing a taxonomy entry', () => {
    expect(parseGhLabelList(JSON.stringify([{ color: 'd73a4a' }]))).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(parseGhLabelList(JSON.stringify([{ name: 'bug' }, { name: 'bug' }]))).toHaveLength(1);
  });

  it('never throws', () => {
    expect(parseGhLabelList('not json')).toEqual([]);
    expect(parseGhLabelList('{}')).toEqual([]);
    expect(parseGhLabelList('[null, 3]')).toEqual([]);
  });

  it('strips control characters from a name', () => {
    const [label] = parseGhLabelList(JSON.stringify([{ name: 'bu\u0000g\u001b[31m' }]));
    expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(label.name)).toBe(false);
  });
});

describe('parseGhMilestoneList', () => {
  const raw = JSON.stringify([
    { number: 3, title: 'v2', state: 'open', due_on: '2026-12-01T00:00:00Z', open_issues: 4, closed_issues: 1 },
    { number: 1, title: 'v1', state: 'closed', open_issues: 0, closed_issues: 9 },
    { number: 2, title: 'Someday', state: 'open', open_issues: 2, closed_issues: 0 },
  ]);

  it('puts open milestones first, then soonest due', () => {
    expect(parseGhMilestoneList(raw).map(m => m.title)).toEqual(['v2', 'Someday', 'v1']);
  });

  it('sorts an undated milestone after dated ones', () => {
    // An undated milestone is not urgent, it is unscheduled.
    const open = parseGhMilestoneList(raw).filter(m => m.state === 'open');
    expect(open[0].dueOn).not.toBe('');
    expect(open[1].dueOn).toBe('');
  });

  it('trims the due date to a day', () => {
    expect(parseGhMilestoneList(raw)[0].dueOn).toBe('2026-12-01');
  });

  it('reads an unrecognised state as open, keeping it visible', () => {
    const [milestone] = parseGhMilestoneList(JSON.stringify([{ number: 1, title: 'x', state: 'archived' }]));
    expect(milestone.state).toBe('open');
  });

  it('drops a fragment rather than repairing it', () => {
    expect(parseGhMilestoneList(JSON.stringify([{ title: 'no number' }, { number: 1 }]))).toEqual([]);
  });

  it('never throws', () => {
    expect(parseGhMilestoneList('not json')).toEqual([]);
    expect(parseGhMilestoneList('[null]')).toEqual([]);
  });
});

describe('a deletion names every issue that will lose the label', () => {
  it('counts and names them', () => {
    // GitHub removes a label from the repository and from every issue carrying
    // it, in one irreversible step, and says nothing about how many.
    const impact = describeLabelDeletionImpact('bug', issues);
    expect(impact.issueCount).toBe(2);
    expect(impact.named).toEqual([1, 2]);
    expect(impact.unnamed).toBe(0);
  });

  it('counts closed issues too', () => {
    // A label stripped from a closed issue takes the reason it was categorised
    // that way with it, and closed issues are what people search.
    const impact = describeLabelDeletionImpact('done', [
      { number: 5, labels: ['done'] },
      { number: 6, labels: ['done'] },
    ]);
    expect(impact.issueCount).toBe(2);
  });

  it('caps the names and says how many it did not name', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ number: i + 1, labels: ['bug'] }));
    const impact = describeLabelDeletionImpact('bug', many);
    expect(impact.named).toHaveLength(8);
    expect(impact.unnamed).toBe(12);
  });

  it('names them in the confirmation, with the count first', () => {
    const text = describeLabelDeletion(describeLabelDeletionImpact('bug', issues), 'o/r', true);
    expect(text).toContain('2 issues would lose it: #1, #2');
    expect(text).toMatch(/cannot be undone/);
  });

  it('suggests renaming instead of deleting', () => {
    const text = describeLabelDeletion(describeLabelDeletionImpact('bug', issues), 'o/r', true);
    expect(text).toMatch(/rename it instead/);
  });

  it('says the list was not loaded rather than reporting zero', () => {
    // "No issues use this" and "we did not look" lead to opposite decisions,
    // and only one of them is safe to act on.
    const text = describeLabelDeletion(describeLabelDeletionImpact('bug', []), 'o/r', false);
    expect(text).toMatch(/has not been loaded/);
    expect(text).toMatch(/Refresh the issue list first/);
    expect(text).not.toMatch(/No issue currently carries it/);
  });

  it('says so plainly when nothing carries it', () => {
    const text = describeLabelDeletion(describeLabelDeletionImpact('unused', issues), 'o/r', true);
    expect(text).toMatch(/No issue currently carries it/);
    expect(text).toMatch(/still cannot be undone/);
  });
});

describe('findTaxonomyDrift', () => {
  const onRepo = parseGhLabelList(JSON.stringify([{ name: 'bug' }, { name: 'ui' }]));

  it('reports a declared label that does not exist', () => {
    // The drafter drops an unmatched label, which is the one failure stage 1
    // promises not to have.
    const drift = findTaxonomyDrift(['bug', 'security'], onRepo);
    expect(drift.missing).toEqual(['security']);
    expect(drift.summary).toMatch(/dropped from any draft/);
  });

  it('reports a label in use that is not declared', () => {
    const drift = findTaxonomyDrift(['bug'], onRepo);
    expect(drift.undeclared).toEqual(['ui']);
    expect(drift.summary).toMatch(/never be suggested/);
  });

  it('says they match when they match', () => {
    const drift = findTaxonomyDrift(['bug', 'ui'], onRepo);
    expect(drift.missing).toEqual([]);
    expect(drift.undeclared).toEqual([]);
    expect(drift.summary).toMatch(/matches the repository/);
  });

  it('reports both directions at once, as a comparison rather than a verdict', () => {
    const drift = findTaxonomyDrift(['bug', 'security'], onRepo);
    expect(drift.missing.length).toBeGreaterThan(0);
    expect(drift.undeclared.length).toBeGreaterThan(0);
    expect(drift.summary).not.toMatch(/error|invalid|wrong/i);
  });
});

describe('normalizeLabelName', () => {
  it('trims, because a trailing space cannot be matched against the taxonomy', () => {
    expect(normalizeLabelName('  bug  ')).toBe('bug');
  });

  it('returns empty for anything unusable', () => {
    expect(normalizeLabelName('')).toBe('');
    expect(normalizeLabelName(undefined)).toBe('');
    expect(normalizeLabelName(42)).toBe('');
  });

  it('is permissive about content, which GitHub is too', () => {
    expect(normalizeLabelName('area/ui')).toBe('area/ui');
    expect(normalizeLabelName('good first issue')).toBe('good first issue');
  });
});

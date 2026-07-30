import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  buildPullRequestDraft,
  defaultPullRequestBody,
  derivePullRequestTitle,
  fillPullRequestTemplate,
} from '../../src/core/pullRequestDraft.ts';

/** The repository's real template, so the test cannot drift from what ships. */
const TEMPLATE = readFileSync(
  path.join(process.cwd(), '.github', 'pull_request_template.md'),
  'utf8',
);

describe('derivePullRequestTitle', () => {
  it('keeps a single conventional commit subject verbatim', () => {
    // A human already wrote the best available description; rewriting it would
    // discard it in favour of a derived one.
    expect(derivePullRequestTitle({ commitSubjects: ['feat(core): add a recovery window'] }))
      .toBe('feat(core): add a recovery window');
  });

  it('synthesises a title for a multi-commit range', () => {
    expect(derivePullRequestTitle({
      commitSubjects: ['feat: add a thing', 'test: cover it', 'docs: describe it'],
      issueTitle: 'Add a recovery window for deleted notes',
    })).toBe('feat: add a recovery window for deleted notes');
  });

  it('reuses the bump classification rather than parsing commits again', () => {
    // A second parser of the same format would eventually disagree with the
    // one that decides the version — and the disagreement would surface as a
    // release whose version does not match its own pull-request title.
    expect(derivePullRequestTitle({ commitSubjects: ['fix: a', 'fix: b'], issueTitle: 'Repair it' }))
      .toBe('fix: repair it');
    expect(derivePullRequestTitle({ commitSubjects: ['fix: a', 'feat: b'], issueTitle: 'Repair it' }))
      .toBe('feat: repair it');
    expect(derivePullRequestTitle({ commitSubjects: ['feat!: a', 'fix: b'], issueTitle: 'Repair it' }))
      .toBe('feat!: repair it');
    expect(derivePullRequestTitle({
      commitSubjects: ['fix: a', 'fix: b\n\nBREAKING CHANGE: it moved'], issueTitle: 'Repair it',
    })).toBe('feat!: repair it');
  });

  it('prefers the issue title, which describes the outcome', () => {
    expect(derivePullRequestTitle({
      commitSubjects: ['feat: wire up the column', 'feat: add the migration'],
      issueTitle: 'Users can recover deleted notes',
    })).toBe('feat: users can recover deleted notes');
  });

  it('falls back through commit subject then branch name', () => {
    expect(derivePullRequestTitle({ commitSubjects: ['feat: wire the column', 'feat: migrate'] }))
      .toBe('feat: wire the column');
    expect(derivePullRequestTitle({ commitSubjects: [], headRef: 'feat/142-add-a-thing' }))
      .toBe('fix: add a thing');
  });

  it('ignores platform-generated merge commits', () => {
    // Counting them would penalise a team for using squash merges.
    expect(derivePullRequestTitle({
      commitSubjects: ['Merge branch develop', 'feat: the real change'],
    })).toBe('feat: the real change');
  });

  it('lower-cases a leading word but leaves acronyms and proper nouns alone', () => {
    // Mangling `GitHub` or `API` reads as a typo rather than as a convention.
    expect(derivePullRequestTitle({ commitSubjects: ['a', 'b'], issueTitle: 'Add a thing' }))
      .toBe('fix: add a thing');
    expect(derivePullRequestTitle({ commitSubjects: ['a', 'b'], issueTitle: 'API rate limits' }))
      .toBe('fix: API rate limits');
    expect(derivePullRequestTitle({ commitSubjects: ['a', 'b'], issueTitle: 'GitHub token handling' }))
      .toBe('fix: GitHub token handling');
  });

  it('caps the length', () => {
    const title = derivePullRequestTitle({ commitSubjects: ['a', 'b'], issueTitle: 'x'.repeat(400) });
    expect(title.length).toBeLessThanOrEqual(120);
  });

  it('never returns an empty title', () => {
    expect(derivePullRequestTitle({ commitSubjects: [] })).toBe('fix: update');
  });
});

describe('fillPullRequestTemplate — fills, never replaces', () => {
  it('substitutes the issue placeholder rather than leaving it literal', () => {
    // Leaving it would ship a pull request containing `<issue-number>`.
    const body = fillPullRequestTemplate({ template: TEMPLATE, summary: '- did a thing', issueNumber: 142 });
    expect(body).toContain('- Closes #142');
    expect(body).not.toContain('<issue-number>');
  });

  it('states plainly when there is no linked issue', () => {
    const body = fillPullRequestTemplate({ template: TEMPLATE, summary: '- did a thing' });
    expect(body).toContain('- No linked issue.');
    expect(body).not.toContain('<issue-number>');
  });

  it('replaces the summary prompts with the derived summary', () => {
    const body = fillPullRequestTemplate({ template: TEMPLATE, summary: '- did a thing', issueNumber: 1 });
    expect(body).toContain('- did a thing');
    expect(body).not.toContain('- What changed?');
    expect(body).not.toContain('- Why is this change needed?');
  });

  it('preserves the team checklist exactly', () => {
    // A team's checklist is theirs. A drafter that quietly dropped items would
    // be worse than one that left the body empty.
    const body = fillPullRequestTemplate({ template: TEMPLATE, summary: '- x', issueNumber: 1 });
    for (const item of [
      '- [ ] Tests added or updated',
      '- [ ] `npm run compile` passes',
      '- [ ] Documentation updated where needed',
      '- [ ] Security impact assessed (if applicable)',
    ]) {
      expect(body, item).toContain(item);
    }
  });

  it('preserves headings it has never seen', () => {
    const custom = '## Summary\n- What changed?\n\n## Deployment Notes\n- something bespoke\n';
    const body = fillPullRequestTemplate({ template: custom, summary: '- x' });
    expect(body).toContain('## Deployment Notes');
    expect(body).toContain('- something bespoke');
  });

  it('preserves every heading in the shipped template', () => {
    const body = fillPullRequestTemplate({ template: TEMPLATE, summary: '- x', issueNumber: 1 });
    // The template is checked in with CRLF endings; the filler normalises them,
    // so the comparison has to as well.
    const headings = TEMPLATE.replace(/\r\n/g, '\n').split('\n').filter(line => line.startsWith('#'));
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(body, heading).toContain(heading);
    }
  });

  it('normalises CRLF without disturbing content', () => {
    const body = fillPullRequestTemplate({ template: '## Summary\r\n- What changed?\r\n', summary: '- x' });
    expect(body).not.toContain('\r');
    expect(body).toContain('- x');
  });
});

describe('buildPullRequestDraft — determinism', () => {
  const input = {
    headRef: 'feat/142-add-a-thing',
    baseRef: 'develop',
    commitSubjects: ['feat: add a thing', 'test: cover it'],
    issueNumber: 142,
    issueTitle: 'Add a thing',
    template: TEMPLATE,
  };

  it('produces a byte-identical draft for the same range and template', () => {
    // The central requirement of the specification for this stage.
    expect(buildPullRequestDraft(input)).toEqual(buildPullRequestDraft(input));
    expect(buildPullRequestDraft(input).body).toBe(buildPullRequestDraft(input).body);
  });

  it('does not depend on commit order', () => {
    const reversed = { ...input, commitSubjects: [...input.commitSubjects].reverse() };
    expect(buildPullRequestDraft(reversed).title).toBe(buildPullRequestDraft(input).title);
  });

  it('links the issue and records it on the draft', () => {
    const draft = buildPullRequestDraft(input);
    expect(draft.linkedIssue).toBe(142);
    expect(draft.body).toContain('Closes #142');
  });
});

describe('buildPullRequestDraft — labels come only from the taxonomy', () => {
  const base = { headRef: 'feat/1-x', baseRef: 'develop', commitSubjects: ['feat: x'] };

  it('keeps a declared label', () => {
    const draft = buildPullRequestDraft({
      ...base, labels: ['type:feature'], declaredLabels: ['type:feature', 'type:bug'],
    });
    expect(draft.labels).toEqual(['type:feature']);
    expect(draft.warnings.some(w => w.includes('taxonomy'))).toBe(false);
  });

  it('drops an unmatched label and says so', () => {
    // Inventing one silently fragments the filters the taxonomy exists to support.
    const draft = buildPullRequestDraft({
      ...base, labels: ['type:feature', 'invented'], declaredLabels: ['type:feature'],
    });
    expect(draft.labels).toEqual(['type:feature']);
    expect(draft.warnings.some(w => w.includes('`invented`'))).toBe(true);
  });

  it('de-duplicates', () => {
    const draft = buildPullRequestDraft({
      ...base, labels: ['a', 'a'], declaredLabels: ['a'],
    });
    expect(draft.labels).toEqual(['a']);
  });

  it('accepts anything when no taxonomy is declared', () => {
    const draft = buildPullRequestDraft({ ...base, labels: ['anything'] });
    expect(draft.labels).toEqual(['anything']);
  });
});

describe('buildPullRequestDraft — warns rather than proceeding silently', () => {
  const base = { headRef: 'feat/1-x', baseRef: 'develop', commitSubjects: ['feat: x'] };

  it('warns when nothing links the pull request to an issue', () => {
    const draft = buildPullRequestDraft(base);
    expect(draft.warnings.some(w => w.includes('No linked issue'))).toBe(true);
  });

  it('warns on an empty commit range', () => {
    const draft = buildPullRequestDraft({ ...base, commitSubjects: [] });
    expect(draft.warnings.some(w => w.includes('empty'))).toBe(true);
  });

  it('is silent when there is nothing to report', () => {
    const draft = buildPullRequestDraft({
      ...base, issueNumber: 1, labels: ['a'], declaredLabels: ['a'],
    });
    expect(draft.warnings).toEqual([]);
  });
});

describe('buildPullRequestDraft — without a template', () => {
  it('emits a fixed-order default body', () => {
    const draft = buildPullRequestDraft({
      headRef: 'feat/1-x', baseRef: 'develop', commitSubjects: ['feat: x'], issueNumber: 5,
    });
    expect(draft.body).toBe(defaultPullRequestBody({
      summary: '- 1 commit on `feat/1-x`, merging into `develop`.',
      issueNumber: 5,
    }));
    expect(draft.body).toContain('## Summary');
    expect(draft.body).toContain('Closes #5');
  });

  it('treats a whitespace-only template as absent', () => {
    const draft = buildPullRequestDraft({
      headRef: 'feat/1-x', baseRef: 'develop', commitSubjects: ['feat: x'], template: '   \n  ',
    });
    expect(draft.body).toContain('## Summary');
  });

  it('counts commits accurately, ignoring merges', () => {
    const draft = buildPullRequestDraft({
      headRef: 'feat/1-x', baseRef: 'develop',
      commitSubjects: ['feat: a', 'Merge branch develop', 'feat: b'],
    });
    expect(draft.body).toContain('2 commits');
  });
});

describe('draft state', () => {
  it('is not a draft unless asked', () => {
    const base = { headRef: 'feat/1-x', baseRef: 'develop', commitSubjects: ['feat: x'] };
    expect(buildPullRequestDraft(base).draft).toBe(false);
    expect(buildPullRequestDraft({ ...base, draft: true }).draft).toBe(true);
  });
});

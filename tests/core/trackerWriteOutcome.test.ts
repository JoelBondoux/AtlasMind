import { describe, expect, it } from 'vitest';
import {
  applyConfirmedIssueWrite,
  applyConfirmedPullRequestWrite,
} from '../../src/core/trackerWriteOutcome.ts';
import type { IssueRecord } from '../../src/core/issueTracker.ts';
import type { PullRequestRecord } from '../../src/core/pullRequestTracker.ts';

const AT = new Date('2026-08-19T10:00:00.000Z');

function issue(overrides: Partial<IssueRecord> = {}): IssueRecord {
  return {
    number: 12,
    title: 'A real issue',
    state: 'open',
    author: 'someone',
    labels: ['bug'],
    assignees: ['someone'],
    body: 'Body',
    bodyTruncated: false,
    url: 'https://github.com/JoelBondoux/AtlasMind/issues/12',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    comments: 2,
    ...overrides,
  };
}

function pull(overrides: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    number: 34,
    title: 'A real pull request',
    state: 'open',
    author: 'someone',
    headRefName: 'feat/thing',
    baseRefName: 'develop',
    labels: [],
    body: '',
    bodyTruncated: false,
    url: 'https://github.com/JoelBondoux/AtlasMind/pull/34',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    mergedAt: '',
    isDraft: false,
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    reviews: [],
    linkedIssues: [],
    ...overrides,
  };
}

describe('applyConfirmedIssueWrite', () => {
  it('closes the issue the write named, and nothing else about it', () => {
    const before = [issue(), issue({ number: 13, title: 'Another' })];
    const after = applyConfirmedIssueWrite(before, { action: 'close', number: 12 }, AT);
    expect(after[0]?.state).toBe('closed');
    expect(after[0]?.updatedAt).toBe(AT.toISOString());
    expect(after[0]?.labels).toEqual(['bug']);
    expect(after[0]?.assignees).toEqual(['someone']);
    expect(after[0]?.title).toBe('A real issue');
    expect(after[1]).toBe(before[1]);
  });

  it('reopens', () => {
    const after = applyConfirmedIssueWrite([issue({ state: 'closed' })], { action: 'reopen', number: 12 }, AT);
    expect(after[0]?.state).toBe('open');
  });

  it('counts a comment rather than changing a state', () => {
    const after = applyConfirmedIssueWrite([issue()], { action: 'comment', number: 12 }, AT);
    expect(after[0]?.comments).toBe(3);
    expect(after[0]?.state).toBe('open');
  });

  it('clamps a comment count the same way the parser does', () => {
    const after = applyConfirmedIssueWrite([issue({ comments: 100_000 })], { action: 'comment', number: 12 }, AT);
    expect(after[0]?.comments).toBe(100_000);
  });

  it('never invents a record for a number the list does not hold', () => {
    const before = [issue()];
    const after = applyConfirmedIssueWrite(before, { action: 'close', number: 999 }, AT);
    expect(after).toBe(before);
    expect(after).toHaveLength(1);
  });

  it('returns the same reference when the write changes nothing, so no render is published', () => {
    const before = [issue({ state: 'closed' })];
    expect(applyConfirmedIssueWrite(before, { action: 'close', number: 12 }, AT)).toBe(before);
  });

  it('does not mutate the list it was given', () => {
    const original = issue();
    const before = [original];
    applyConfirmedIssueWrite(before, { action: 'close', number: 12 }, AT);
    expect(before[0]).toBe(original);
    expect(original.state).toBe('open');
  });
});

describe('applyConfirmedPullRequestWrite', () => {
  it('keeps merged and closed distinct, because the delivery metrics read the difference', () => {
    const merged = applyConfirmedPullRequestWrite([pull()], { action: 'merge', number: 34 }, AT);
    expect(merged[0]?.state).toBe('merged');
    expect(merged[0]?.mergedAt).toBe(AT.toISOString());

    const closed = applyConfirmedPullRequestWrite([pull()], { action: 'close', number: 34 }, AT);
    expect(closed[0]?.state).toBe('closed');
    expect(closed[0]?.mergedAt).toBe('');
  });

  it('clears the draft flag on a merge, since a draft cannot have merged', () => {
    const after = applyConfirmedPullRequestWrite([pull({ state: 'draft', isDraft: true })], { action: 'merge', number: 34 }, AT);
    expect(after[0]?.isDraft).toBe(false);
    expect(after[0]?.state).toBe('merged');
  });

  it('never invents a record, and never touches another entry', () => {
    const before = [pull(), pull({ number: 35 })];
    expect(applyConfirmedPullRequestWrite(before, { action: 'merge', number: 999 }, AT)).toBe(before);
    const after = applyConfirmedPullRequestWrite(before, { action: 'close', number: 34 }, AT);
    expect(after[1]).toBe(before[1]);
  });

  it('claims nothing about the issues a merge would close — that is GitHub\'s inference', () => {
    const after = applyConfirmedPullRequestWrite(
      [pull({ linkedIssues: [12] })],
      { action: 'merge', number: 34 },
      AT,
    );
    expect(after[0]?.linkedIssues).toEqual([12]);
  });
});

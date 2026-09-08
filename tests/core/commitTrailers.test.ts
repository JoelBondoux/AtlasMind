import { describe, expect, it } from 'vitest';

import {
  COMMIT_TRAILER_RULES,
  composeCommitTrailers,
  isValidCommitTrailerValue,
  issueFromBranchName,
  parseCommitTrailers,
  readCommitLinks,
} from '../../src/core/commitTrailers.ts';

/**
 * The machine-readable half of a commit message.
 *
 * A commit says what changed. Nothing said which planned work it was for, so
 * any analytic joining code to intent had to guess from wording — and a wrong
 * join is worse than none, because it is counted rather than noticed.
 */

describe('where a link is allowed to come from', () => {
  it('reads an issue number from the declared branch shape', () => {
    expect(issueFromBranchName('feat/412-worktree-isolation')).toBe('412');
    expect(issueFromBranchName('fix/7-null-guard')).toBe('7');
  });

  it('refuses a number that is merely present in the name', () => {
    // A bare number anywhere in a branch is not an issue reference, and taking
    // it as one is how a commit permanently points at somebody else's ticket.
    expect(issueFromBranchName('feat/v2-rewrite')).toBeUndefined();
    expect(issueFromBranchName('release-2026-09')).toBeUndefined();
    expect(issueFromBranchName('412-no-type-prefix')).toBeUndefined();
  });

  it('validates rather than cleans, because a pushed commit cannot be edited', () => {
    expect(isValidCommitTrailerValue('Roadmap-Item', 'promote-worktree-isolation-t')).toBe(true);
    expect(isValidCommitTrailerValue('Roadmap-Item', 'Has Spaces')).toBe(false);
    expect(isValidCommitTrailerValue('Roadmap-Item', '')).toBe(false);
    expect(isValidCommitTrailerValue('Issue', '412')).toBe(true);
    expect(isValidCommitTrailerValue('Issue', 'twelve')).toBe(false);
  });
});

describe('adding a trailer to a message', () => {
  it('puts a block at the end, separated by a blank line', () => {
    const result = composeCommitTrailers({
      message: 'feat(x): do the thing\n\nA paragraph explaining it.',
      trailers: { 'Roadmap-Item': 'do-the-thing', Issue: '412' },
    });

    expect(result.message).toBe(
      'feat(x): do the thing\n\nA paragraph explaining it.\n\nRoadmap-Item: do-the-thing\nIssue: 412\n',
    );
    expect(result.applied).toEqual(['Roadmap-Item', 'Issue']);
  });

  it('joins an existing trailer block rather than displacing it', () => {
    // `Co-Authored-By` is somebody else's trailer and stays where they put it.
    const result = composeCommitTrailers({
      message: 'fix: a thing\n\nCo-Authored-By: Someone <a@b.c>',
      trailers: { Issue: '9' },
    });

    expect(result.message).toContain('Co-Authored-By: Someone <a@b.c>');
    expect(result.message.trimEnd().endsWith('Issue: 9')).toBe(true);
  });

  it('replaces a key it already wrote rather than appending a second', () => {
    // Re-drafting a message twice must not accumulate three copies of one fact.
    const once = composeCommitTrailers({
      message: 'fix: a thing',
      trailers: { Issue: '9' },
    });
    const twice = composeCommitTrailers({ message: once.message, trailers: { Issue: '10' } });

    expect(twice.message.match(/^Issue:/gm)).toHaveLength(1);
    expect(twice.message).toContain('Issue: 10');
  });

  it('keeps a trailer somebody wrote in the position they wrote it', () => {
    const result = composeCommitTrailers({
      message: 'fix: a thing\n\nIssue: 1\nCo-Authored-By: Someone <a@b.c>',
      trailers: { Issue: '2' },
    });

    const lines = result.message.trimEnd().split('\n');
    expect(lines.at(-2)).toBe('Issue: 2');
    expect(lines.at(-1)).toBe('Co-Authored-By: Someone <a@b.c>');
  });

  it('reports a refused value instead of writing it', () => {
    const result = composeCommitTrailers({
      message: 'fix: a thing',
      trailers: { 'Roadmap-Item': 'not a valid id' },
    });

    expect(result.applied).toEqual([]);
    expect(result.message).toBe('fix: a thing');
    expect(result.refused[0]?.reason).toMatch(/cannot be edited once pushed/);
  });

  it('leaves the body exactly as written', () => {
    // Reflowing somebody's message while adding a label would be doing two
    // things, and only one of them was asked for.
    const body = 'feat: x\n\n  indented line\n\n* a bullet\n* another';
    const result = composeCommitTrailers({ message: body, trailers: { Issue: '3' } });
    expect(result.message.startsWith(body)).toBe(true);
  });

  it('does nothing at all when there is nothing to add', () => {
    const result = composeCommitTrailers({ message: 'fix: a thing', trailers: {} });
    expect(result.message).toBe('fix: a thing');
    expect(result.applied).toEqual([]);
  });
});

describe('reading trailers back', () => {
  it('finds the block git would find', () => {
    const trailers = parseCommitTrailers('feat: x\n\nbody\n\nIssue: 4\nRoadmap-Item: some-item\n');
    expect(trailers).toEqual([
      { key: 'Issue', value: '4' },
      { key: 'Roadmap-Item', value: 'some-item' },
    ]);
  });

  it('treats a closing paragraph of prose as prose', () => {
    // Git's rule, in the part that matters: the last paragraph is trailers only
    // when *every* line in it is `Key: value`. Taking the lines that happen to
    // match would split a sentence out of somebody's closing paragraph and call
    // it metadata.
    expect(parseCommitTrailers('feat: x\n\nSee also: the notes\nand a following sentence.')).toEqual([]);
  });

  it('does not read a one-line message as a trailer', () => {
    expect(parseCommitTrailers('Issue: 4')).toEqual([]);
  });

  it('refuses a malformed value on the way back in', () => {
    // A hand-edited history can contain anything, and a surface joining on a
    // malformed id would report a link to an item that does not exist.
    expect(readCommitLinks('feat: x\n\nbody\n\nRoadmap-Item: Not An Id')).toEqual({});
    expect(readCommitLinks('feat: x\n\nbody\n\nRoadmap-Item: real-id')).toEqual({ 'Roadmap-Item': 'real-id' });
  });

  it('tolerates a leading hash on an issue reference', () => {
    expect(readCommitLinks('feat: x\n\nbody\n\nIssue: #412')).toEqual({ Issue: '412' });
  });

  it('survives CRLF, which is what Windows git hands back', () => {
    expect(readCommitLinks('feat: x\r\n\r\nbody\r\n\r\nIssue: 8\r\n')).toEqual({ Issue: '8' });
  });

  it('round-trips everything it writes', () => {
    const written = composeCommitTrailers({
      message: 'feat: x\n\nbody',
      trailers: { 'Roadmap-Item': 'an-item', Issue: '55' },
    });
    expect(readCommitLinks(written.message)).toEqual({ 'Roadmap-Item': 'an-item', Issue: '55' });
  });

  it('publishes a rule for every key it can write', () => {
    const keys = new Set(COMMIT_TRAILER_RULES.map(rule => rule.key));
    const written = composeCommitTrailers({
      message: 'feat: x',
      trailers: { 'Roadmap-Item': 'an-item', Issue: '1' },
    });
    for (const key of written.applied) {
      expect(keys.has(key)).toBe(true);
    }
    expect(written.applied.length).toBe(COMMIT_TRAILER_RULES.length);
  });
});

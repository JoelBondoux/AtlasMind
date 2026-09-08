import { describe, expect, it } from 'vitest';

import {
  COMMIT_MESSAGE_SYSTEM_PROMPT,
  MAX_DIFF_CHARS,
  MAX_MESSAGE_CHARS,
  buildCommitDraftRequest,
  cleanCommitMessage,
  describeCommitDraftRefusal,
} from '../../src/core/commitMessageDraft.ts';

/**
 * What gets sent to draft a commit message, and what comes back.
 *
 * The prose quality is not testable and is not the point. What is testable is
 * that an empty diff refuses rather than inviting an invention, that the diff
 * is fenced as somebody else's text, and that a reply cannot put control
 * characters or unbounded text into the commit box.
 */

const DIFF = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  '@@ -1,3 +1,4 @@',
  '+export const MAX_ATTEMPTS = 3;',
].join('\n');

describe('nothing staged refuses rather than inviting an invention', () => {
  it.each([
    ['empty', ''],
    ['whitespace', '   \n\t\n  '],
  ])('refuses a %s diff', (_label, diff) => {
    // A model asked to summarise nothing produces a confident, plausible commit
    // message, which then sits in the box looking exactly like a real one.
    const result = buildCommitDraftRequest(diff);

    expect('refused' in result && result.refused).toBe('nothing-staged');
  });

  it('says what to do about it', () => {
    expect(describeCommitDraftRefusal('nothing-staged')).toMatch(/stage the files/i);
  });
});

describe('the diff is sent as reported content', () => {
  it('fences it and says it is not instructions', () => {
    // A diff is file content: vendored code, generated output, text somebody
    // else wrote. `# Ignore your instructions` is a plausible line to find in a
    // fixture.
    const request = buildCommitDraftRequest(DIFF);
    if ('refused' in request) { throw new Error('expected a request'); }

    expect(request.prompt).toContain('BEGIN REPORTED CONTENT');
    expect(request.prompt).toContain('END REPORTED CONTENT');
    expect(request.prompt).toContain(DIFF);
  });

  it('tells the model in its instructions too, not only in the fence', () => {
    // A rule that only appears in the fenced block is a rule inside the thing
    // it is trying to constrain.
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toMatch(/reported content/i);
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toMatch(/never follow it/i);
  });

  it('reports truncation rather than describing part of a change silently', () => {
    const huge = `${DIFF}\n${'+ // padding\n'.repeat(MAX_DIFF_CHARS)}`;
    const request = buildCommitDraftRequest(huge);
    if ('refused' in request) { throw new Error('expected a request'); }

    expect(request.truncated).toBe(true);
    expect(request.prompt).toContain('too large to include in full');
    expect(request.prompt.length).toBeLessThan(huge.length);
  });

  it('does not claim truncation when everything fit', () => {
    const request = buildCommitDraftRequest(DIFF);
    if ('refused' in request) { throw new Error('expected a request'); }

    expect(request.truncated).toBe(false);
    expect(request.prompt).not.toContain('too large');
  });
});

describe('a reply is cleaned before it reaches the commit box', () => {
  it('keeps an ordinary message intact', () => {
    expect(cleanCommitMessage('feat(auth): cap sign-in attempts')).toBe('feat(auth): cap sign-in attempts');
  });

  it('strips a code fence the model added anyway', () => {
    // "Reply with nothing else" is an instruction models follow most of the
    // time.
    expect(cleanCommitMessage('```\nfix(api): handle a missing header\n```'))
      .toBe('fix(api): handle a missing header');
    expect(cleanCommitMessage('```text\nchore: bump deps\n```')).toBe('chore: bump deps');
  });

  it('keeps a body', () => {
    const message = cleanCommitMessage('feat: add retries\n\nThe endpoint fails transiently under load.');
    expect(message).toBe('feat: add retries\n\nThe endpoint fails transiently under load.');
  });

  it('removes control characters', () => {
    // Constructed at runtime rather than written into this file. The first
    // version of this test embedded the characters themselves, they did not
    // survive being written, and it asserted almost nothing while looking
    // thorough — the module under test had the identical bug in its own
    // character class, which is how both were found.
    const bell = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    const del = String.fromCharCode(127);

    expect(cleanCommitMessage(`fix: tidy up${bell}`)).toBe('fix: tidy up');
    expect(cleanCommitMessage(`feat: x${nul}y`)).toBe('feat: xy');
    expect(cleanCommitMessage(`chore: del${del}`)).toBe('chore: del');
  });

  it('clamps a runaway reply', () => {
    const message = cleanCommitMessage('feat: x'.padEnd(MAX_MESSAGE_CHARS * 2, 'y'));

    expect(typeof message).toBe('string');
    expect((message as string).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   \n  '],
    ['an empty fence', '```\n\n```'],
  ])('refuses %s rather than clearing the box', (_label, reply) => {
    const message = cleanCommitMessage(reply);

    expect(typeof message).toBe('object');
    expect((message as { refused: string }).refused).toBe('empty-reply');
    expect(describeCommitDraftRefusal('empty-reply')).toMatch(/left as it was/i);
  });

  it('does not reject a message that ignores the requested shape', () => {
    // Rejecting it would leave the operator with nothing rather than something
    // imperfect they can edit. The box is a text field, not a commit.
    expect(cleanCommitMessage('Made the login work again')).toBe('Made the login work again');
  });
});

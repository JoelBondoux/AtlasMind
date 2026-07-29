import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isProjectDashboardMessage } from '../../src/views/projectDashboardPanel.ts';

/**
 * Pull-request writes are the first thing AtlasMind does that changes something
 * outside the editor and is visible to other people. Four properties have to
 * hold, and none of them can be checked by the type system:
 *
 * - the webview supplies **data only**, never a command or an argument list;
 * - the automation ladder is consulted **before** the action, not after;
 * - a protected base is a **veto**, not a level somebody can raise;
 * - every write is behind a modal that names the repository and the action.
 *
 * These read the real source so a later edit cannot quietly drop one.
 */

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

/** The body of `handlePullRequestWrite`. */
function writeHandlerSource(): string {
  const start = PANEL.indexOf('private async handlePullRequestWrite(');
  expect(start, 'handlePullRequestWrite is missing').toBeGreaterThan(-1);
  const end = PANEL.indexOf('/** Hand an issue to chat as *reported content*', start);
  return PANEL.slice(start, end === -1 ? start + 12000 : end);
}

describe('the boundary accepts data, never commands', () => {
  const valid = {
    type: 'createPullRequest',
    payload: { title: 'feat: a thing', body: 'x', base: 'develop', head: 'feat/1-a-thing' },
  };

  it('accepts a well-formed create', () => {
    expect(isProjectDashboardMessage(valid)).toBe(true);
  });

  it('refuses a ref that is not a git ref', () => {
    // Refused outright rather than sanitised: a "cleaned" ref can still be a
    // valid ref pointing somewhere else.
    for (const bad of ['a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[1]', 'a\\b', '', 'x'.repeat(300)]) {
      expect(isProjectDashboardMessage({ ...valid, payload: { ...valid.payload, base: bad } }), bad).toBe(false);
      expect(isProjectDashboardMessage({ ...valid, payload: { ...valid.payload, head: bad } }), bad).toBe(false);
    }
  });

  it('refuses a create with no title', () => {
    for (const title of ['', '   ', undefined, 42]) {
      expect(isProjectDashboardMessage({ ...valid, payload: { ...valid.payload, title } })).toBe(false);
    }
  });

  it('refuses a non-string body or non-boolean draft', () => {
    expect(isProjectDashboardMessage({ ...valid, payload: { ...valid.payload, body: 42 } })).toBe(false);
    expect(isProjectDashboardMessage({ ...valid, payload: { ...valid.payload, draft: 'yes' } })).toBe(false);
  });

  it('accepts only the three declared review verdicts', () => {
    for (const verdict of ['approve', 'request-changes', 'comment']) {
      expect(isProjectDashboardMessage({
        type: 'reviewPullRequest', payload: { number: 1, verdict, body: 'x' },
      }), verdict).toBe(true);
    }
    for (const verdict of ['dismiss', 'merge', '', undefined, 'APPROVE']) {
      expect(isProjectDashboardMessage({
        type: 'reviewPullRequest', payload: { number: 1, verdict, body: 'x' },
      }), String(verdict)).toBe(false);
    }
  });

  it('requires a usable pull request number for every numbered action', () => {
    for (const type of ['reviewPullRequest', 'mergePullRequest', 'closePullRequest']) {
      for (const number of [0, -1, 'one', undefined, null]) {
        expect(isProjectDashboardMessage({
          type, payload: { number, verdict: 'comment', base: 'develop' },
        }), `${type}/${String(number)}`).toBe(false);
      }
    }
  });

  it('carries no command, argument list, or shell string in any accepted payload', () => {
    // The property the whole boundary exists to provide.
    const handler = writeHandlerSource();
    expect(handler).not.toMatch(/payload\['args'\]|payload\.args|payload\['command'\]|payload\.command/);
  });
});

describe('the automation ladder gates the action', () => {
  const handler = writeHandlerSource();

  it('checks the ladder before building or sending anything', () => {
    const gateAt = handler.indexOf('permits(decision.level, FIRST_WRITING_LEVEL)');
    const sendAt = handler.indexOf('await runGh(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(gateAt);
  });

  it('returns rather than falling through when the ladder refuses', () => {
    // Asserted by *ordering* rather than by character distance: the refusal
    // block grows as it gains an audit record, and a distance-based match
    // would fail on a change that strengthens the very property it pins.
    const gateAt = handler.indexOf('if (!permits(decision.level, FIRST_WRITING_LEVEL))');
    const returnAt = handler.indexOf('return;', gateAt);
    const sendAt = handler.indexOf('await runGh(');
    expect(gateAt).toBeGreaterThan(-1);
    expect(returnAt).toBeGreaterThan(gateAt);
    expect(returnAt).toBeLessThan(sendAt);
  });

  it('names the gate that refused, so nobody toggles four settings at random', () => {
    expect(handler).toContain('decision.detail');
  });

  it('reads settings at the moment of acting, not from a snapshot', () => {
    // A setting changed while the panel was open must take effect on the next
    // action, not on the next reload.
    expect(PANEL).toMatch(/private automationFor\([\s\S]{0,300}?vscode\.workspace\.getConfiguration\('atlasmind'\)/);
  });

  it('requires the writing rung specifically, not merely "not off"', () => {
    expect(handler).toContain('FIRST_WRITING_LEVEL');
    expect(handler).not.toMatch(/decision\.level\s*!==\s*'off'/);
  });
});

describe('a protected base is a veto, not a level', () => {
  const handler = writeHandlerSource();

  it('checks protection on merge', () => {
    expect(handler).toContain('permitsProtectedRefWrite(');
    expect(handler).toContain('PROTECTED_BRANCH_NAMES.has(base)');
  });

  it('refuses without offering a level to raise', () => {
    const merge = handler.slice(handler.indexOf("mergePullRequest'"));
    expect(merge).toContain('is not permitted');
    expect(merge).not.toContain('maxAutomationLevel');
  });
});

describe('every write is confirmed and reported honestly', () => {
  const handler = writeHandlerSource();

  it('is gated on a modal built from the same values that will be sent', () => {
    expect(handler).toContain('{ modal: true, detail: description }');
    expect(handler).toContain('describePullRequestAction(');
  });

  it('does not proceed unless the confirmation was accepted', () => {
    expect(handler).toMatch(/if \(confirmation !== 'Yes, do it'\) \{\s*return;/);
  });

  it('requires an explanation before requesting changes', () => {
    // "Changes requested" with no comment is a rejection the author cannot act on.
    expect(handler).toContain('Requesting changes needs a comment');
  });

  it('re-reads after a failure as well as a success', () => {
    // A failed write may still have partially applied; the list is the only
    // honest report of what GitHub now holds.
    expect(handler).toMatch(/catch \(error\)[\s\S]{0,300}?await this\.handleRefreshIssues\(\);/);
  });

  it('reports a failure through the shared classifier', () => {
    expect(handler).toContain('ghFailureOf(error).detail');
  });
});

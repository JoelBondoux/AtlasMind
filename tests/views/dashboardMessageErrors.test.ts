import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A webview action that fails must say so.
 *
 * Reported as "the Delivery Promote buttons appear to not do anything", and the
 * whole chain behind them turned out to be correct: the button carries the right
 * `data-action`, the click delegate has a branch for it, the payload passes the
 * host's validator, the handler exists, the reply is handled, the modal renders
 * and its CSS is defined. Every link verified.
 *
 * What was missing was the failure path. `onDidReceiveMessage` discarded the
 * handler's promise with `void`, so a rejection anywhere below produced **no
 * error, no log and no reply** — the webview posted a message and waited for
 * ever. Every outcome of a failure was indistinguishable from a button that was
 * never wired.
 *
 * That is what these tests pin: not that promotion works, but that when it does
 * not, somebody is told.
 */

const source = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

describe('the dashboard message dispatcher cannot swallow a failure', () => {
  it('attaches a catch to the handler promise', () => {
    // `void this.handleMessage(message)` on its own is the bug.
    expect(source).toMatch(/void this\.handleMessage\(message\)\s*\.catch\(/);
  });

  it('names the message type in what it reports', () => {
    // "Something failed" sends the user back to guessing which click it was.
    const block = /void this\.handleMessage\(message\)[\s\S]{0,900}?\}\);/.exec(source)?.[0] ?? '';
    expect(block).toContain('console.error');
    expect(block).toMatch(/showErrorMessage/);
    expect(block, 'the reported failure should name the message kind').toMatch(/kind/);
  });
});

describe('a promotion failure reaches the modal the user is looking at', () => {
  /** The body of a named private method, up to the next method declaration. */
  function methodBody(name: string): string {
    const start = source.indexOf(`private async ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const end = rest.search(/\n {2}private (?:async )?[a-zA-Z]/);
    return rest.slice(0, end > -1 ? end : rest.length);
  }

  it.each([
    'handlePromotionPlanRequest',
    'handleRunPromotion',
  ])('%s reports a thrown failure as a promotionError', name => {
    const body = methodBody(name);
    // The gathering step reaches git, `gh`, the routine registry and the plan
    // builder. A gap in any one of their internal guards used to reject the
    // whole handler.
    expect(body, 'the fact-gathering is unguarded').toMatch(/try\s*\{[\s\S]*gatherPromotionFacts/);
    expect(body).toMatch(/catch\s*\(error[\s\S]*promotionError/);
  });

  it('carries the real reason rather than a generic failure', () => {
    // "Could not prepare the promotion" alone would replace silence with a
    // shrug. The underlying message is what makes the next step obvious.
    const body = methodBody('handlePromotionPlanRequest');
    expect(body).toMatch(/error instanceof Error \? error\.message : String\(error\)/);
    expect(body).toMatch(/Could not prepare the promotion: \$\{detail/);
  });

  it('re-checks the plan before running, and fails before taking the lock', () => {
    // Order matters: the single-flight delivery lock must not be held by a
    // handler that then throws on its way to using it.
    const body = methodBody('handleRunPromotion');
    const guard = body.indexOf('Could not re-check the promotion');
    const lock = body.indexOf('acquireDeliveryLock');
    expect(guard, 'the pre-run guard is missing').toBeGreaterThan(-1);
    expect(lock, 'the delivery lock is missing').toBeGreaterThan(-1);
    expect(guard, 'the guard must sit before the lock is acquired').toBeLessThan(lock);
  });
});

describe('the webview still renders what the host sends back', () => {
  const media = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');

  it('handles every promotion reply the host can post', () => {
    for (const reply of ['promotionPlan', 'promotionProgress', 'promotionDone', 'promotionError']) {
      expect(media, `no handler for ${reply}`).toContain(`message.type === '${reply}'`);
    }
  });

  it('draws a modal for an error even when no plan was ever built', () => {
    // The error path renders `p.plan === null`, so the overlay has to survive a
    // missing plan — otherwise a reported failure is still an invisible one.
    const modal = /function renderPromotionModal\(\)[\s\S]*?\n  \}/.exec(media)?.[0] ?? '';
    expect(modal, 'renderPromotionModal not found').not.toBe('');
    expect(modal).toMatch(/if \(!p\.plan\)/);
    expect(modal).toMatch(/promo-overlay/);
  });

  it('renders the modal outside the hidden page sections', () => {
    // `.page-section` is `display: none` unless active, so a modal nested in one
    // would be invisible on every page but that one.
    const template = /root\.innerHTML = `[\s\S]*?`;/.exec(media)?.[0] ?? '';
    expect(template).toContain('${renderPromotionModal()}');
    const guide = template.indexOf('${renderSsot(snapshot)}');
    const modal = template.indexOf('${renderPromotionModal()}');
    expect(modal).toBeGreaterThan(guide);
  });
});

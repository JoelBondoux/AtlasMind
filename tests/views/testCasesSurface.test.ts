import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The test-case card lives on the Testing page, rendered by
 * `media/projectDashboard.js` and served by `src/views/projectDashboardPanel.ts`.
 *
 * Three properties of that split are worth pinning, because breaking any of
 * them would look like an ordinary refactor and would turn a register people
 * rely on before a release into one that flatters them: the browser must never
 * post a **priority** (the grade comes from the declared table host-side); it
 * must never **filter a credential** on the way out (a browser-side scrub
 * reports success while the value stays in whatever it was pasted from); and it
 * must never supply the **prompt** an agent reads.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);
const HOST_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

function webviewHandler(action: string, until: string): string {
  const start = WEBVIEW_SCRIPT.indexOf(`action === '${action}'`);
  expect(start, action).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf(`action === '${until}'`, start);
  expect(end, until).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the browser describes a case and never grades one', () => {
  it('posts no priority', () => {
    const handler = webviewHandler('test-case-save', 'test-asset-save');
    expect(handler).toContain("type: 'addTestCase'");
    expect(handler).not.toContain('priority:');
  });

  it('asks the two questions the declared table grades on', () => {
    const handler = webviewHandler('test-case-save', 'test-asset-save');
    expect(handler).toContain("read('consequence')");
    expect(handler).toContain("read('frequency')");
  });

  it('has no priority on the message type the host accepts', () => {
    const start = HOST_SOURCE.indexOf("type: 'addTestCase';");
    expect(start).toBeGreaterThan(0);
    const declaration = HOST_SOURCE.slice(
      start,
      HOST_SOURCE.indexOf("| { type: 'setTestCaseStatus'", start),
    );
    expect(declaration).toContain('consequence: string');
    expect(declaration).toContain('frequency: string');
    expect(declaration).not.toContain('priority:');
  });
});

describe('a credential is refused host-side, never scrubbed in the browser', () => {
  it('sends the asset fields through untouched', () => {
    const handler = webviewHandler('test-asset-save', 'set-test-case-status');
    expect(handler).toContain("type: 'addTestAsset'");
    // No stripping, masking or regex here: the host owns the refusal, and it
    // tells the person who typed it rather than silently succeeding.
    expect(handler).not.toContain('replace(');
    expect(handler).toContain('secretRef');
  });

  it('surfaces the register\'s refusal rather than swallowing it', () => {
    const start = HOST_SOURCE.indexOf('private async handleAddTestAsset');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('if (outcome.refusal)');
    expect(handler).toContain('showWarningMessage(outcome.refusal)');
  });

  it('warns in the composer before anything is typed', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderTestCaseComposer(');
    expect(start).toBeGreaterThan(0);
    const composer = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  function renderTestCaseRow(', start));
    expect(composer).toContain('Never paste a password, key or token here');
    expect(composer).toContain('SecretStorage');
  });
});

describe('a refusal to record a result is shown, not swallowed', () => {
  it('reports why an automated or deprecated case was refused', () => {
    const start = HOST_SOURCE.indexOf('private async handleRecordTestResult');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('outcome.refusal');
    expect(handler).toContain('showWarningMessage(outcome.refusal.detail)');
  });
});

describe('the agent drafts and never decides', () => {
  it('sends only an id from the browser', () => {
    const start = WEBVIEW_SCRIPT.indexOf("action === 'draft-test-case'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW_SCRIPT.slice(start, start + 240);
    expect(handler).toContain("type: 'draftTestCase'");
    expect(handler).not.toContain('draftPrompt');
  });

  it('rebuilds the prompt from the register host-side', () => {
    const start = HOST_SOURCE.indexOf('private async handleDraftTestCase');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 800);
    expect(handler).toContain('buildTestCaseDraftingPrompt(testCase)');
  });
});

describe('the card states what an empty register means', () => {
  it('says nobody wrote a case down rather than that there is nothing to test', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderTestCases(');
    expect(start).toBeGreaterThan(0);
    const card = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  function policyChips(', start));
    expect(card).toContain('It does not mean there is nothing to test');
    // And it says why the card exists at all beside a page full of file-derived
    // coverage.
    expect(card).toContain('Everything above this card is read from files');
  });
});

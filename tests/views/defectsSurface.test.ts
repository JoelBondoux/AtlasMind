import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Defects page is rendered by `media/projectDashboard.js` and served by
 * `src/views/projectDashboardPanel.ts`. Two properties of that split are worth
 * more than a rendering assertion, because breaking either would look like an
 * ordinary refactor:
 *
 * the browser must never be able to supply a **severity** — the grade comes
 * from the declared rule table host-side, and a page that could post one would
 * make the whole table advisory; and the browser must never be able to supply
 * the **prompt** an agent reads — it names a defect by id and the host rebuilds
 * the text from the register.
 *
 * Both are checked by reading the real sources, as `dashboardNav` does, so a
 * change that quietly reintroduces either fails here rather than in review.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);
const HOST_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

/** The body of the `defect-record` click handler in the webview script. */
function defectRecordHandler(): string {
  const start = WEBVIEW_SCRIPT.indexOf("action === 'defect-record'");
  expect(start).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf("action === 'set-defect-status'", start);
  expect(end).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the browser describes a defect and never grades one', () => {
  it('posts no severity field from the report form', () => {
    const handler = defectRecordHandler();
    expect(handler).toContain("type: 'reportDefect'");
    // The word appears in the handler's own comment explaining why it is absent;
    // what must never appear is a severity *field* on the posted payload.
    expect(handler).not.toContain('severity:');
  });

  it('asks for what it does and who meets it, which is what the table grades on', () => {
    const handler = defectRecordHandler();
    expect(handler).toContain("read('impact')");
    expect(handler).toContain("read('reach')");
  });

  it('has no severity on the message type the host accepts', () => {
    const start = HOST_SOURCE.indexOf("type: 'reportDefect';");
    expect(start).toBeGreaterThan(0);
    const declaration = HOST_SOURCE.slice(
      start,
      HOST_SOURCE.indexOf("| { type: 'setDefectStatus'", start),
    );
    expect(declaration).toContain('impact: string');
    expect(declaration).toContain('reach: string');
    expect(declaration).not.toContain('severity:');
  });

  it('re-coerces the enums host-side rather than trusting the posted strings', () => {
    expect(HOST_SOURCE).toContain('private static coerceDefectImpact');
    expect(HOST_SOURCE).toContain('private static coerceDefectReach');
  });
});

describe('the agent hand-off is rebuilt from the register', () => {
  it('sends only an id from the browser', () => {
    const start = WEBVIEW_SCRIPT.indexOf("action === 'work-on-defect'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW_SCRIPT.slice(start, start + 260);
    expect(handler).toContain("type: 'workOnDefect'");
    expect(handler).toContain('id: payload');
    // No prompt, draft or body may travel: the text an agent reads is the
    // host's, built from the entry it looked up.
    expect(handler).not.toContain('draftPrompt');
  });

  it('looks the entry up before building a prompt', () => {
    const start = HOST_SOURCE.indexOf('private async handleWorkOnDefect');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 900);
    expect(handler).toContain('this.defectManager.get().entries.find');
    expect(handler).toContain('buildDefectWorkPrompt(entry)');
  });
});

describe('the page states what an empty register means', () => {
  it('says nobody wrote one down rather than reporting no defects', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderDefects(');
    expect(start).toBeGreaterThan(0);
    const page = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  // ──', start));
    expect(page).toContain('It does not mean there are none');
    // And it never claims the register gates anything: the Release page owns
    // gates, and a register that blocked a release would be a different thing.
    expect(page).toContain('nothing here blocks a release');
  });
});

describe('a duplicate needs a target that exists', () => {
  it('never lets a plain status change reach `duplicate`', () => {
    const start = HOST_SOURCE.indexOf('private async handleSetDefectStatus');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 1400);
    expect(handler).toContain("status === 'duplicate'");
  });
});

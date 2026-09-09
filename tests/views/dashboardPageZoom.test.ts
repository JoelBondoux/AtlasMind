import { readFileSync } from 'node:fs';
import path from 'node:path';

// @ts-expect-error -- no `@types/jsdom` in this repository
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

/**
 * Ctrl+wheel zooms the dashboard, the way it zooms a browser.
 *
 * A webview does not inherit the window's zoom, so the gesture everybody
 * already knows did nothing on the densest surface in AtlasMind. This file
 * executes the real script rather than reading it, because the interesting part
 * is what the handler does to the DOM — and the interesting *non*-event is the
 * canvas case, where the same gesture already means something else.
 */

const WEBVIEW = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');
const PANEL = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

/** Anything reached through the mounted window. */
type Mounted = ReturnType<typeof Object.create>;

interface Harness {
  window: Mounted;
  shell(): Mounted;
  reset(): Mounted;
  wheel(target: Mounted, deltaY: number, init?: Record<string, unknown>): void;
  state: Record<string, unknown>;
}

function mount(initialState: Record<string, unknown> = {}): Harness {
  // The shell wrapper and the zoom chip are the two pieces of real markup this
  // behaviour depends on; the assertion at the bottom of this file is what
  // stops that drifting from the panel.
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div class="dashboard-shell">
         <div class="dashboard-topbar">
           <div class="dashboard-actions">
             <button id="dashboard-zoom-reset" hidden>100%</button>
           </div>
         </div>
         <div id="dashboard-version-strip"></div>
         <span id="dashboard-project-name"></span>
         <span id="dashboard-project-summary"></span>
         <span id="dashboard-provenance"></span>
         <span id="dashboard-score-chip"></span>
         <div id="dashboard-root">
           <div class="rm-frame" data-rm-frame="true"><div class="rm-world" data-rm-world="true"></div></div>
         </div>
         <div id="dashboard-status"></div>
       </div>
     </body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://atlasmind.test/' },
  );
  const { window } = dom;
  const state: Record<string, unknown> = { ...initialState };

  (window as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage: () => undefined,
    getState: () => state,
    setState: (next: Record<string, unknown>) => { Object.assign(state, next); },
  });
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  window.Element.prototype.scrollIntoView = () => undefined;
  (window.Element.prototype as unknown as { setPointerCapture: unknown }).setPointerCapture = () => undefined;
  (window.Element.prototype as unknown as { releasePointerCapture: unknown }).releasePointerCapture = () => undefined;

  window.eval(WEBVIEW);

  return {
    window,
    state,
    shell: () => window.document.querySelector('.dashboard-shell'),
    reset: () => window.document.getElementById('dashboard-zoom-reset'),
    wheel(target: Mounted, deltaY: number, init: Record<string, unknown> = {}) {
      target.dispatchEvent(new window.WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY, ctrlKey: true, ...init,
      }));
    },
  };
}

describe('the dashboard zooms on ctrl+wheel', () => {
  it('starts at 100% with the indicator hidden', () => {
    const harness = mount();
    expect(harness.shell().dataset.pageZoom).toBe('100');
    expect(harness.reset().hidden).toBe(true);
  });

  it('steps up and down the ladder rather than scaling continuously', () => {
    // Chromium's own steps. A wheel notch that lands on 113% reads as a bug,
    // and a continuous scale is not what this gesture does anywhere else.
    const harness = mount();
    const shell = harness.shell();

    harness.wheel(shell, -100);
    expect(shell.dataset.pageZoom).toBe('110');
    harness.wheel(shell, -100);
    expect(shell.dataset.pageZoom).toBe('125');
    harness.wheel(shell, 100);
    harness.wheel(shell, 100);
    harness.wheel(shell, 100);
    expect(shell.dataset.pageZoom).toBe('90');
  });

  it('stops at both ends of the ladder', () => {
    // Below 50% the labels stop being readable and above 200% a stat card no
    // longer fits the panel, so neither is worth offering.
    const harness = mount();
    const shell = harness.shell();
    for (let step = 0; step < 20; step += 1) { harness.wheel(shell, -100); }
    expect(shell.dataset.pageZoom).toBe('200');
    for (let step = 0; step < 40; step += 1) { harness.wheel(shell, 100); }
    expect(shell.dataset.pageZoom).toBe('50');
  });

  it('leaves the roadmap canvas its own ctrl+wheel', () => {
    // The canvas zooms the plan on the same gesture. Doing both from one notch
    // would be two answers to one question, and the canvas is the one the
    // pointer is over.
    const harness = mount();
    const frame = harness.window.document.querySelector('[data-rm-frame="true"]');

    harness.wheel(frame, -100);

    expect(harness.shell().dataset.pageZoom).toBe('100');
  });

  it('ignores a plain wheel, so ordinary scrolling still scrolls', () => {
    const harness = mount();
    harness.wheel(harness.shell(), -100, { ctrlKey: false });
    expect(harness.shell().dataset.pageZoom).toBe('100');
  });

  it('shows the indicator only while zoomed, and returns to 100% when clicked', () => {
    const harness = mount();
    const shell = harness.shell();

    harness.wheel(shell, -100);
    expect(harness.reset().hidden).toBe(false);
    expect(harness.reset().textContent).toBe('110%');

    harness.reset().dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

    expect(shell.dataset.pageZoom).toBe('100');
    expect(harness.reset().hidden).toBe(true);
  });

  it('remembers the level in webview state, and restores it on mount', () => {
    // Per viewer, not per project: this is how you like to read the panel, so
    // it belongs in webview state rather than in the committed workspace file.
    const harness = mount();
    harness.wheel(harness.shell(), -100);
    expect(harness.state.pageZoom).toBe(110);

    const reopened = mount({ pageZoom: 125 });
    expect(reopened.shell().dataset.pageZoom).toBe('125');
    expect(reopened.reset().hidden).toBe(false);
  });

  it('refuses a stored level that is not on the ladder', () => {
    // Webview state survives an extension update, so a value written by another
    // build is untrusted input like any other.
    expect(mount({ pageZoom: 'huge' }).shell().dataset.pageZoom).toBe('100');
    expect(mount({ pageZoom: 10000 }).shell().dataset.pageZoom).toBe('200');
    expect(mount({ pageZoom: 113 }).shell().dataset.pageZoom).toBe('110');
  });
});

describe('the harness above matches the real panel', () => {
  it('renders the shell and the zoom indicator the script reaches for', () => {
    // A behaviour test against markup the panel does not emit would pass for
    // ever while the feature was gone.
    expect(PANEL).toContain('class="dashboard-shell"');
    expect(PANEL).toContain('id="dashboard-zoom-reset"');
  });
});

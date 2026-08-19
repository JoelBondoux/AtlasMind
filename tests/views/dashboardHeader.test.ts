import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Project Dashboard header.
 *
 * It used to be four stacked blocks: a 44px generic title, a three-line
 * description of the tabs sitting directly beneath it, a pill row, and then two
 * full-width cards — one repeating the project name at h2 with three provenance
 * pills, one carrying a 150px score ring. That is roughly 600px of chrome above
 * the first real signal on a wide editor and past 900px on a narrow one, on a
 * page whose entire purpose is the signals.
 *
 * The same facts are stated in one band now. The wiring that makes that work is
 * what this file pins, because every way it can break is silent: the header
 * lives *outside* `#dashboard-root`, so it is neither replaced by `render()` nor
 * reached by the delegated click handler nor animated by
 * `applyValueAnimations()`. A missing id leaves "Loading project…" on screen
 * forever and nothing throws.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const panel = read('src/views/projectDashboardPanel.ts');
const webview = read('media/projectDashboard.js');

const HEADER_IDS = [
  'dashboard-project-name',
  'dashboard-project-summary',
  'dashboard-provenance',
  'dashboard-score-chip',
] as const;

describe('the dashboard header is wired to the host markup', () => {
  it('declares every element the script writes into', () => {
    for (const id of HEADER_IDS) {
      expect(panel, `${id} is missing from the host markup`).toContain(`id="${id}"`);
      expect(webview, `${id} is never read by the script`).toContain(`getElementById('${id}')`);
    }
  });

  it('fills the header before replacing the body', () => {
    // `render()` swaps `#dashboard-root` wholesale and can throw part-way
    // through twenty-two page renderers. The header is set first so a failure
    // in one page cannot leave the title reading "Loading project…".
    const start = webview.indexOf('function render()');
    expect(start, 'render() not found').toBeGreaterThan(-1);
    const body = webview.slice(start, webview.indexOf('applyValueAnimations();', start));
    const identity = body.indexOf('applyHeaderIdentity(snapshot)');
    const swap = body.indexOf('root.innerHTML = `');
    expect(identity, 'applyHeaderIdentity is never called from render()').toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(identity);
  });

  it('clears the header when there is nothing to report', () => {
    // A failed refresh leaving the previous collection's score and "Generated
    // today" on screen would read as current. Both paths clear instead.
    expect(webview).toContain('function clearHeaderIdentity()');
    const errorStart = webview.indexOf('function renderError(message)');
    expect(errorStart).toBeGreaterThan(-1);
    expect(webview.slice(errorStart, errorStart + 400)).toContain('clearHeaderIdentity()');
  });

  it('hides the score rather than showing a zero it has not measured', () => {
    const start = webview.indexOf('function clearHeaderIdentity()');
    const body = webview.slice(start, webview.indexOf('function renderScoreChip(', start));
    expect(body).toContain('scoreChip.hidden = true');
  });

  it('drops the health summary with the rest of the readings, and falls back rather than blanking', () => {
    // The summary is a collection product exactly as the score is; keeping it
    // while clearing the score would state a stale reading as current. It falls
    // back to the neutral sentence in the host markup, which is read from the
    // DOM rather than repeated here so the wording lives in one place.
    const start = webview.indexOf('function clearHeaderIdentity()');
    const body = webview.slice(start, webview.indexOf('function renderScoreChip(', start));
    expect(body).toContain('projectSummaryEl.textContent = HEADER_SUMMARY_FALLBACK');
    expect(webview).toMatch(/const HEADER_SUMMARY_FALLBACK = projectSummaryEl \? projectSummaryEl\.textContent/);
    expect(panel).toMatch(/id="dashboard-project-summary"[^>]*>[^<]+</);
  });

  it('treats every value it writes as text rather than markup', () => {
    // The project name, the health summary and the SSOT path all originate
    // outside this panel. textContent is the boundary; the only innerHTML in
    // here is the score chip, which this file builds from escaped values.
    const start = webview.indexOf('function applyHeaderIdentity(snapshot)');
    const body = webview.slice(start, webview.indexOf('function clearHeaderIdentity()', start));
    expect(body).toContain('projectNameEl.textContent');
    expect(body).toContain('projectSummaryEl.textContent');
    expect(body).not.toMatch(/projectNameEl\.innerHTML/);
    expect(body).not.toMatch(/projectSummaryEl\.innerHTML/);
    expect(body).not.toMatch(/provenanceEl\.innerHTML/);
  });
});

describe('the header score is a different ring from the page score', () => {
  it('paints its own offset instead of waiting for an animation that never runs', () => {
    // `applyValueAnimations()` only scans inside `#dashboard-root`. A ring in
    // the header carrying `data-anim-key` would sit at its "from" value
    // forever — a full-circumference dash offset, which draws as an empty ring
    // beside a number that says 84.
    const start = webview.indexOf('function renderScoreChip(score)');
    expect(start, 'renderScoreChip not found').toBeGreaterThan(-1);
    const body = webview.slice(start, webview.indexOf('function renderVersionStrip(snapshot)', start));
    expect(body).toContain('stroke-dashoffset="${dashOffset}"');
    expect(body).not.toContain('data-anim-key');
  });

  it('keeps the animated ring on the page that is about the number', () => {
    // Removing the hero must not orphan `renderScoreRing`; the Score page is
    // inside `#dashboard-root`, so its ring still animates when that tab opens.
    const start = webview.indexOf('function renderScore(snapshot)');
    expect(start, 'renderScore not found').toBeGreaterThan(-1);
    const body = webview.slice(start, webview.indexOf('function renderScoreComponent(', start));
    expect(body).toContain('renderScoreRing(snapshot.healthScore)');
  });

  it('binds the header chip itself, since delegation stops at the root', () => {
    expect(webview).toContain("scoreChip?.addEventListener('click'");
    const start = webview.indexOf("scoreChip?.addEventListener('click'");
    expect(webview.slice(start, start + 320)).toContain("state.activePage = 'score'");
  });
});

describe('the hero cards are gone rather than merely hidden', () => {
  it('ships no markup or styling for them', () => {
    for (const dead of ['hero-grid', 'hero-card', 'hero-meta', 'score-card', 'score-value', 'score-caption']) {
      expect(webview, `${dead} still rendered`).not.toContain(dead);
      expect(panel, `${dead} still styled`).not.toContain(dead);
    }
  });

  it('opens the body on the navigation', () => {
    const start = webview.indexOf('root.innerHTML = `', webview.indexOf('function render()'));
    expect(webview.slice(start, start + 200)).toContain('class="toolbar-row"');
  });
});

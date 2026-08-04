import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LENS_CATALOG } from '../../src/core/lensDashboard';
import {
  LENS_BASE_CSS,
  LENS_FLOW_SCRIPT,
  LENS_INFO_SCRIPT,
  LENS_PANEL_CSS,
  LENS_PANEL_SCRIPT,
  renderLensHeader,
  renderLensInfo,
} from '../../src/views/lensVisuals';

/**
 * Every panel that renders a Lens surface. The drift this file exists to catch
 * is exactly the drift that produced the shared module: eight files each
 * growing their own header, their own card border, and their own empty state.
 */
const LENS_SURFACES = [
  'lensDashboardPanel.ts',
  'lensJourneyPanel.ts',
  'lensImpactPanel.ts',
  'lensTestPanel.ts',
  'lensStatePanel.ts',
  'lensConfigPanel.ts',
  'lensChangeStoryPanel.ts',
  'lensContractReviewPanel.ts',
];

function readSurface(file: string): string {
  return readFileSync(path.join(__dirname, '..', '..', 'src', 'views', file), 'utf8');
}

describe('Lens shared visual language', () => {
  it('is used by every Lens surface rather than re-declared in each one', () => {
    for (const file of LENS_SURFACES) {
      const source = readSurface(file);
      expect(source, `${file} does not import the shared visual language`).toContain('./lensVisuals.js');
      expect(source, `${file} does not use the shared stylesheet`).toContain('LENS_PANEL_CSS');
    }
  });

  it('gives every surface the ⓘ affordance a first-time reader needs', () => {
    for (const file of LENS_SURFACES) {
      const source = readSurface(file);
      // Either a standalone ⓘ, one built by the script per card, or the header's
      // own — every surface must explain itself somewhere without being run.
      const hasInfo = source.includes('renderLensInfo') ||
        source.includes('createLensInfo') ||
        /info: \{/.test(source);
      expect(hasInfo, `${file} offers no explanation to a novice`).toBe(true);
    }
  });

  it('declares an accent for every lens the catalog names', () => {
    for (const entry of LENS_CATALOG) {
      expect(LENS_BASE_CSS, `no accent declared for ${entry.accent}`).toContain(`[data-accent="${entry.accent}"]`);
      expect(LENS_FLOW_SCRIPT, `flow renderer cannot colour ${entry.accent}`).toContain(`${entry.accent}:`);
    }
  });

  it('escapes everything it interpolates into markup', () => {
    const html = renderLensInfo({
      title: '"><script>bad()</script>',
      body: "it's <b>not</b> markup",
      note: '& more',
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
  });

  it('escapes header text, which carries project labels on several surfaces', () => {
    const html = renderLensHeader({
      eyebrow: 'Atlas Lens',
      title: '</h1><img src=x onerror=bad()>',
      subtitle: 'fine',
      mode: '"><script>x</script>',
    });

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;/h1&gt;');
  });

  it('states the evidence mode on every header, and never defaults it', () => {
    // A shared default would eventually put "Static evidence" on a page showing
    // declared intent, which is the one thing these badges exist to prevent.
    expect(renderLensHeader({ eyebrow: 'a', title: 'b', subtitle: 'c', mode: 'Declared model' }))
      .toContain('Declared model');
    for (const file of LENS_SURFACES.filter(name => name !== 'lensDashboardPanel.ts')) {
      expect(readSurface(file), `${file} renders no evidence mode`).toMatch(/mode: '[^']+'/);
    }
  });

  it('offers a hover explanation as well as a click one', () => {
    const html = renderLensInfo({ title: 'Possible flow', body: 'What can reach this.' });

    // A popover alone is a tooltip half the users never receive.
    expect(html).toContain('title="What can reach this."');
    expect(html).toContain('aria-label="What is Possible flow?"');
    expect(html).toContain('aria-expanded="false"');
  });

  it('renders links from live geometry rather than a layout guess', () => {
    expect(LENS_FLOW_SCRIPT).toContain('getBoundingClientRect');
    expect(LENS_FLOW_SCRIPT).toContain('scrollLeft');
    expect(LENS_FLOW_SCRIPT).toContain('ResizeObserver');
    // A curve, not a straight line — the whole point of the request.
    expect(LENS_FLOW_SCRIPT).toContain(' C ');
  });

  it('animates only a highlighted link, and only when motion is welcome', () => {
    const animation = LENS_PANEL_CSS.slice(LENS_PANEL_CSS.indexOf('lens-flow-dash') - 400);
    expect(LENS_PANEL_CSS).toContain('prefers-reduced-motion: no-preference');
    expect(animation).toContain('is-highlighted');
  });

  it('bundles the flow renderer before the info handler, so both are defined once', () => {
    expect(LENS_PANEL_SCRIPT.indexOf('createLensFlow')).toBeLessThan(LENS_PANEL_SCRIPT.indexOf('createLensInfo'));
    expect(LENS_PANEL_SCRIPT).toContain(LENS_INFO_SCRIPT);
  });

  it('keeps the popover dismissable without a mouse', () => {
    expect(LENS_INFO_SCRIPT).toContain("event.key === 'Escape'");
    expect(LENS_INFO_SCRIPT).toContain("setAttribute('aria-expanded'");
  });
});

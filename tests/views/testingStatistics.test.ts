import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Testing dashboard's statistics and layout, asserted at source level.
 *
 * The webview script is a separate file loaded into an isolated document and
 * the CSS is a template literal in the host, so there is no single runtime
 * where both halves can be exercised together — the same reason
 * `testingPolicyCardWiring.test.ts` reads the sources. What these assertions
 * can still catch is the class of mistake that actually happens here: a
 * renderer that stops being called, a CSS rule silently reverted to a fixed
 * column count, and a chart that draws a value the module deliberately does
 * not claim.
 */
const ROOT = path.resolve(__dirname, '../..');
const WEBVIEW = readFileSync(path.join(ROOT, 'media/projectDashboard.js'), 'utf8');
const HOST = readFileSync(path.join(ROOT, 'src/views/projectDashboardPanel.ts'), 'utf8');
const THEME = readFileSync(path.join(ROOT, 'src/views/dashboardTheme.ts'), 'utf8');

describe('the statistics renderers are wired, not merely written', () => {
  const RENDERERS = [
    'renderPolicyCaseBars',
    'renderPolicyCategoryBars',
    'renderGovernanceRollup',
    'renderPolicyGlanceMeter',
    'renderTechnicalControls',
  ];

  for (const name of RENDERERS) {
    it(`defines and calls ${name}`, () => {
      expect(WEBVIEW, `${name} is not defined`).toContain(`function ${name}(`);
      // Two occurrences minimum: the definition and at least one call site. A
      // renderer nobody calls is dead code that looks like a feature.
      const occurrences = WEBVIEW.split(name).length - 1;
      expect(occurrences, `${name} is defined but never called`).toBeGreaterThan(1);
    });
  }

  it('has a CSS rule for every class the statistics markup emits', () => {
    const CLASSES = [
      'policy-stats-grid', 'policy-bar-rows', 'policy-bar-row', 'policy-bar-label',
      'policy-bar-track', 'policy-bar-fill', 'policy-stack-seg', 'policy-bar-value',
      'policy-glance', 'policy-controls', 'policy-control-table',
    ];
    for (const className of CLASSES) {
      expect(WEBVIEW, `${className} is styled but never rendered`).toContain(className);
      expect(HOST, `${className} is rendered but never styled`).toContain(`.${className}`);
    }
  });
});

describe('the charts do not claim what the data cannot support', () => {
  it('draws no bar for a policy with no cases', () => {
    // An empty bar and an unmeasurable one look identical, and only one of them
    // is a finding — the status board already reports the other as a gap.
    expect(WEBVIEW).toContain('.filter(row => row.caseCount > 0)');
  });

  it('states the remainder when the ranked list is capped', () => {
    expect(WEBVIEW).toMatch(/further polic/);
  });

  it('draws "not assessed" as its own segment rather than omitting it', () => {
    // The state most worth seeing on a compliance board: a control nobody
    // gathered a signal for is not a pass and not a failure.
    expect(WEBVIEW).toContain("{ label: 'Not assessed', value: summary.unknown || 0, tone: 'muted' }");
    expect(WEBVIEW).toContain("{ label: 'Not assessed', value: unknown, tone: 'muted' }");
  });

  it('separates automated controls from human attestation in the roll-up', () => {
    // Adding them into one number would let a strong pipeline hide a regime
    // nobody has assessed.
    expect(WEBVIEW).toContain("{ label: 'For a person', value: human, tone: 'accent' }");
  });

  it('renders no glance meter when there is nothing to measure', () => {
    expect(WEBVIEW).toMatch(/if \(total === 0\) \{\s*return '';/);
  });
});

describe('layout: columns reflow rather than being divided by a fixed count', () => {
  it('caps the dashboard to a readable content width', () => {
    expect(THEME).toContain('--dash-content-max');
    expect(HOST).toContain('max-width: var(--dash-content-max)');
  });

  it('declares a minimum for every kind of grid cell', () => {
    for (const token of ['--dash-col-stat', '--dash-col-chart', '--dash-col-panel', '--dash-measure']) {
      expect(THEME, `${token} is not declared`).toContain(token);
      expect(HOST, `${token} is declared but never used`).toContain(token);
    }
  });

  it('uses auto-fit for the stat, chart and panel grids', () => {
    // The regression this guards: somebody restores `repeat(3, minmax(0, 1fr))`
    // because it reads more simply, and every grid goes back to squeezing on a
    // narrow editor and stretching on a wide one.
    expect(HOST).toContain('repeat(auto-fit, minmax(min(100%, var(--dash-col-stat)), 1fr))');
    expect(HOST).toContain('repeat(auto-fit, minmax(min(100%, var(--dash-col-chart)), 1fr))');
    expect(HOST).toContain('repeat(auto-fit, minmax(min(100%, var(--dash-col-panel)), 1fr))');
  });

  it('gives the policy grid a minimum wide enough for what a card holds', () => {
    // 210px was too narrow once the cards grew tables. The exact number is less
    // important than it not silently going back below what the content needs.
    const match = HOST.match(/\.policy-grid \{[^}]*minmax\(min\(100%, (\d+)px\)/);
    expect(match, 'the policy grid no longer declares a minimum column width').not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(300);
  });

  it('lets an expanded policy card take the whole row', () => {
    // An expanded card is a reading surface — tables, charts and prose — and
    // one column of a multi-column grid is the thin-panel problem at its worst.
    expect(HOST).toContain('.policy-card.is-expanded { grid-column: 1 / -1; }');
  });

  it('caps prose at a measure without capping the panels themselves', () => {
    // A full-width card is often right; the 13px sentence stretched across it
    // is what makes the page look wrong.
    expect(HOST).toContain('max-width: var(--dash-measure)');
    expect(HOST).toContain('max-width: none');
  });
});

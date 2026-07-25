import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_WIDGETS_CSS,
  DASHBOARD_WIDGETS_JS,
  renderDistributionBarHtml,
  renderMeterHtml,
  renderMetricPillHtml,
  renderSparklineHtml,
} from '../../src/views/dashboardWidgets.ts';
import { DASHBOARD_THEME_CSS, REDUCED_MOTION_CSS } from '../../src/views/dashboardTheme.ts';

describe('renderMeterHtml', () => {
  it('renders at zero and declares its animation target', () => {
    // A meter that renders pre-filled can never animate: the "from" state has
    // to exist in the markup for the two-frame transition to interpolate.
    const html = renderMeterHtml('cost:budget', 62.5, 'warn');
    expect(html).toContain('style="width:0%"');
    expect(html).toContain('data-anim-to="62.5%"');
    expect(html).toContain('data-anim-key="cost:budget"');
    expect(html).toContain('dash-meter-warn');
  });

  it('clamps out-of-range and non-finite percentages', () => {
    expect(renderMeterHtml('k', 140)).toContain('data-anim-to="100%"');
    expect(renderMeterHtml('k', -20)).toContain('data-anim-to="0%"');
    expect(renderMeterHtml('k', Number.NaN)).toContain('data-anim-to="0%"');
    expect(renderMeterHtml('k', Number.POSITIVE_INFINITY)).toContain('data-anim-to="0%"');
  });
});

describe('renderMetricPillHtml', () => {
  it('omits the meter when none is supplied', () => {
    const html = renderMetricPillHtml('Requests', '412');
    expect(html).not.toContain('dash-meter');
    expect(html).toContain('412');
  });

  it('omits the meter for a non-finite value rather than rendering a broken bar', () => {
    // A divide-by-zero upstream (0 total) must not produce width:NaN%.
    expect(renderMetricPillHtml('Coverage', '—', { meter: Number.NaN })).not.toContain('dash-meter');
  });

  it('escapes label and value', () => {
    const html = renderMetricPillHtml('<script>', '"><img onerror=x>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('uses an explicit meter key when given, so two pills cannot collide', () => {
    // Same label on two panels/sections would otherwise share one animation
    // memory slot and one of them would stop animating.
    expect(renderMetricPillHtml('Coverage', '80%', { meter: 80, meterKey: 'testing:coverage' }))
      .toContain('data-anim-key="testing:coverage"');
    expect(renderMetricPillHtml('Coverage', '80%', { meter: 80 }))
      .toContain('data-anim-key="metric:Coverage"');
  });
});

describe('renderDistributionBarHtml', () => {
  const segments = [
    { label: 'Passed', value: 3, tone: 'good' as const },
    { label: 'Failed', value: 1, tone: 'critical' as const },
    { label: 'Skipped', value: 0, tone: 'muted' as const },
  ];

  it('drops zero-valued segments and proportions the rest', () => {
    const html = renderDistributionBarHtml('runs', segments);
    expect(html).toContain('data-anim-to="75%"');
    expect(html).toContain('data-anim-to="25%"');
    expect(html).not.toContain('Skipped');
  });

  it('returns the empty label when every segment is zero', () => {
    const html = renderDistributionBarHtml('runs', [{ label: 'A', value: 0, tone: 'good' }], { emptyLabel: 'Nothing yet.' });
    expect(html).toContain('Nothing yet.');
    expect(html).not.toContain('dist-bar');
  });

  it('returns nothing at all when empty and no empty label is given', () => {
    expect(renderDistributionBarHtml('runs', [{ label: 'A', value: 0, tone: 'good' }])).toBe('');
  });

  it('exposes the breakdown to assistive tech, since colour alone carries it visually', () => {
    const html = renderDistributionBarHtml('runs', segments);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Passed: 3, Failed: 1"');
  });

  it('escapes segment labels in both the bar and the legend', () => {
    const html = renderDistributionBarHtml('k', [{ label: '"><b>x', value: 1, tone: 'good' }]);
    expect(html).not.toContain('<b>');
  });

  it('namespaces anim keys by bar and segment', () => {
    const html = renderDistributionBarHtml('tdd', segments);
    expect(html).toContain('data-anim-key="dist:tdd:Passed"');
    expect(html).toContain('data-anim-key="dist:tdd:Failed"');
  });
});

describe('renderSparklineHtml', () => {
  it('needs at least two points to draw a line', () => {
    expect(renderSparklineHtml([])).toBe('');
    expect(renderSparklineHtml([5])).toBe('');
    expect(renderSparklineHtml([1, 2])).toContain('<polyline');
  });

  it('inverts the y axis so a higher value sits higher', () => {
    // Two points, min then max: the first must be at the bottom (y = height),
    // the second at the top (y = 0).
    const html = renderSparklineHtml([0, 10], { height: 20, width: 100 });
    expect(html).toContain('points="0.0,20.0 100.0,0.0"');
  });

  it('survives a flat series without dividing by zero', () => {
    const html = renderSparklineHtml([4, 4, 4], { height: 20 });
    expect(html).toContain('<polyline');
    expect(html).not.toContain('NaN');
  });

  it('ignores non-finite points rather than emitting NaN coordinates', () => {
    const html = renderSparklineHtml([1, Number.NaN, 3]);
    expect(html).not.toContain('NaN');
  });

  it('carries an accessible label', () => {
    expect(renderSparklineHtml([1, 2, 3])).toContain('role="img"');
    expect(renderSparklineHtml([1, 2, 3], { label: 'Cost trend' })).toContain('aria-label="Cost trend"');
  });
});

describe('shared theme', () => {
  it('honours prefers-reduced-motion universally rather than per-selector', () => {
    // A hand-written selector list goes stale the moment someone adds a
    // keyframe; the universal form cannot be forgotten.
    expect(REDUCED_MOTION_CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(REDUCED_MOTION_CSS).toContain('animation-duration: 0.01ms !important');
    expect(REDUCED_MOTION_CSS).toContain('transition-duration: 0.01ms !important');
    expect(DASHBOARD_THEME_CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('defines every token the widget CSS consumes', () => {
    const used = new Set([...DASHBOARD_WIDGETS_CSS.matchAll(/var\((--dash-[a-z-]+)\s*\)/g)].map(m => m[1]!));
    const defined = new Set([...DASHBOARD_THEME_CSS.matchAll(/^\s+(--dash-[a-z-]+):/gm)].map(m => m[1]!));
    const missing = [...used].filter(token => !defined.has(token));
    expect(missing, `widget CSS uses undefined tokens: ${missing.join(', ')}`).toEqual([]);
  });

  it('scopes interactive styling to is-actionable rather than to bare card classes', () => {
    // The Project Dashboard's worst affordance bug was a bare-class
    // cursor:pointer overriding the scoped rule. Encode the rule here.
    expect(DASHBOARD_THEME_CSS).toContain('.is-actionable {');
    expect(DASHBOARD_THEME_CSS).toContain('.static {');
    expect(DASHBOARD_THEME_CSS).toMatch(/\.static\s*\{\s*cursor:\s*default/);
  });

  it('balances its braces so a panel appending CSS after it is not swallowed', () => {
    const stripped = DASHBOARD_THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    let min = 0;
    for (const ch of stripped) {
      if (ch === '{') { depth += 1; } else if (ch === '}') { depth -= 1; if (depth < min) { min = depth; } }
    }
    expect(depth).toBe(0);
    expect(min).toBe(0);
  });
});

describe('client-side widget bundle', () => {
  it('is syntactically valid JavaScript', () => {
    // It is injected verbatim into a webview <script>; a syntax error there
    // silently kills the whole panel.
    expect(() => new Function(`${DASHBOARD_WIDGETS_JS}\nreturn atlasWidgets;`)).not.toThrow();
  });

  it('exposes the animation driver and the render helpers', () => {
    const factory = new Function(`
      const window = { matchMedia: () => ({ matches: false }) };
      const document = { querySelectorAll: () => [] };
      const requestAnimationFrame = (fn) => fn();
      ${DASHBOARD_WIDGETS_JS}
      return atlasWidgets;
    `);
    const widgets = factory() as Record<string, unknown>;
    expect(typeof widgets['applyValueAnimations']).toBe('function');
    expect(typeof widgets['renderMetricPill']).toBe('function');
    expect(typeof widgets['renderDistributionBar']).toBe('function');
    expect(typeof widgets['renderMeter']).toBe('function');
  });

  it('emits markup identical to the server-rendered helpers', () => {
    // Panels mix both forms; divergence would show up as two visually
    // different meters in the same panel.
    const factory = new Function(`
      const window = { matchMedia: () => ({ matches: false }) };
      const document = { querySelectorAll: () => [] };
      const requestAnimationFrame = (fn) => fn();
      ${DASHBOARD_WIDGETS_JS}
      return atlasWidgets;
    `);
    const widgets = factory() as {
      renderMeter: (k: string, p: number, t?: string) => string;
      renderMetricPill: (l: string, v: string, o?: unknown) => string;
      renderDistributionBar: (k: string, s: unknown[], o?: unknown) => string;
    };

    expect(widgets.renderMeter('k', 40, 'good')).toBe(renderMeterHtml('k', 40, 'good'));
    expect(widgets.renderMetricPill('Cost', '$1.20', { tone: 'accent', meter: 30 }))
      .toBe(renderMetricPillHtml('Cost', '$1.20', { tone: 'accent', meter: 30 }));

    const segments = [
      { label: 'Passed', value: 3, tone: 'good' },
      { label: 'Failed', value: 1, tone: 'critical' },
    ];
    expect(widgets.renderDistributionBar('runs', segments, { title: 'Outcomes', caption: '4 runs' }))
      .toBe(renderDistributionBarHtml('runs', segments as never, { title: 'Outcomes', caption: '4 runs' }));
  });
});

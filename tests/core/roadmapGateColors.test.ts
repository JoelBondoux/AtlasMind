import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_ROADMAP_GATES,
  MVP_GATE_ID,
  ROADMAP_GATE_COLOR_RULE,
  ROADMAP_GATE_PALETTE,
  assignRoadmapGateColors,
  roadmapGateColorAt,
  slugifyGateId,
  type RoadmapGate,
} from '../../src/core/roadmapGates.ts';
import { VSCODE_THEMES } from '../fixtures/vscodeThemeTokens.ts';
import {
  collectCustomProperties,
  composite,
  contrastRatio,
  declaration,
  makeColourResolver,
  parseColour,
  scopeCssToTheme,
  toHex,
  walkPanelRules,
  type RGB,
} from '../helpers/cssContrast.ts';

/**
 * The colour each release gate's dot is drawn in.
 *
 * Three properties, each one a way a colour key goes wrong: two gates sharing a
 * colour (the key then answers a question with two answers), a colour that
 * moves between sessions or machines (the key then means something different
 * tomorrow), and a dot nobody can see against the card it sits on (WCAG
 * 1.4.11). The contrast half is measured against the real card surfaces,
 * resolved from the dashboard's own stylesheet in each built-in theme kind.
 */

const ROOT = process.cwd();
const gate = (id: string, order: number, label = id): RoadmapGate => ({ id, label, order, builtIn: id === MVP_GATE_ID });

/** WCAG 1.4.11 non-text contrast. */
const NON_TEXT_MINIMUM = 3;
/** CIE76 ΔE between any two palette colours. ~2.3 is a just-noticeable difference; 30 is unmistakable side by side. */
const MIN_PAIR_DELTA_E = 30;

describe('the gate palette', () => {
  it('has a colour for every gate the roadmap can declare, so the cap never wraps', () => {
    expect(ROADMAP_GATE_PALETTE.length).toBeGreaterThanOrEqual(MAX_ROADMAP_GATES);
  });

  it('is literal lowercase #rrggbb, every value distinct', () => {
    for (const entry of ROADMAP_GATE_PALETTE) {
      expect(entry.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
    expect(new Set(ROADMAP_GATE_PALETTE.map(entry => entry.hex)).size).toBe(ROADMAP_GATE_PALETTE.length);
  });

  it('keeps every pair of colours clearly apart', () => {
    const failures: string[] = [];
    ROADMAP_GATE_PALETTE.forEach((a, i) => {
      ROADMAP_GATE_PALETTE.slice(i + 1).forEach(b => {
        const d = deltaE76(rgbOf(a.hex), rgbOf(b.hex));
        if (d < MIN_PAIR_DELTA_E) { failures.push(`${a.name} ${a.hex} vs ${b.name} ${b.hex} = ΔE ${d.toFixed(1)}`); }
      });
    });
    expect(failures).toEqual([]);
  });

  it('publishes the rule it colours by', () => {
    expect(ROADMAP_GATE_COLOR_RULE).toMatch(/declared/);
    expect(ROADMAP_GATE_COLOR_RULE).toMatch(/hollow/);
  });
});

describe('every gate colour is legible on the card it sits on, in every built-in theme kind', () => {
  for (const theme of VSCODE_THEMES) {
    it(theme.label, () => {
      const surfaces = cardSurfaces(theme);
      // Measured against the cards as the stylesheet draws them — a renamed
      // selector must fail here rather than quietly measure nothing.
      expect(Object.keys(surfaces)).toEqual(expect.arrayContaining([
        '.rm-node card', '.rm-board-cardlet card', 'page', '--dash-panel (legend)', '--dash-panel-strong (legend)',
      ]));
      const failures: string[] = [];
      for (const entry of ROADMAP_GATE_PALETTE) {
        for (const [name, surface] of Object.entries(surfaces)) {
          const ratio = contrastRatio(rgbOf(entry.hex), surface);
          if (ratio < NON_TEXT_MINIMUM) {
            failures.push(`${entry.name} ${entry.hex} on ${name} ${toHex(surface)} = ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('roadmapGateColorAt', () => {
  it('gives the first declared gate — MVP — the first colour', () => {
    expect(roadmapGateColorAt(0)).toEqual({ color: ROADMAP_GATE_PALETTE[0]!.hex, colorIndex: 0, hollow: false });
  });

  it('repeats past the palette, and draws the repeat hollow', () => {
    const size = ROADMAP_GATE_PALETTE.length;
    expect(roadmapGateColorAt(size)).toEqual({ color: ROADMAP_GATE_PALETTE[0]!.hex, colorIndex: 0, hollow: true });
    expect(roadmapGateColorAt(size + 3).colorIndex).toBe(3);
  });

  it('is total: a nonsense position reads as the first slot rather than throwing', () => {
    for (const position of [-1, Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
      expect(roadmapGateColorAt(position)).toEqual(roadmapGateColorAt(0));
    }
    expect(roadmapGateColorAt(2.9)).toEqual(roadmapGateColorAt(2));
  });

  it('never gives two positions the same colour and shape, up to twice the palette', () => {
    const size = ROADMAP_GATE_PALETTE.length;
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 * size - 1 }),
      fc.integer({ min: 0, max: 2 * size - 1 }),
      (p, q) => {
        fc.pre(p !== q);
        const a = roadmapGateColorAt(p);
        const b = roadmapGateColorAt(q);
        return a.color !== b.color || a.hollow !== b.hollow;
      },
    ));
  });
});

describe('assignRoadmapGateColors', () => {
  it('colours by declared position, MVP first', () => {
    const colors = assignRoadmapGateColors([gate('mvp', 0), gate('beta', 1), gate('v1', 2)]);
    expect(colors.get('mvp')?.color).toBe(ROADMAP_GATE_PALETTE[0]!.hex);
    expect(colors.get('beta')?.color).toBe(ROADMAP_GATE_PALETTE[1]!.hex);
    expect(colors.get('v1')?.color).toBe(ROADMAP_GATE_PALETTE[2]!.hex);
  });

  it('follows the declared order, not the order the caller passed', () => {
    const declared = assignRoadmapGateColors([gate('mvp', 0), gate('beta', 1), gate('v1', 2)]);
    const shuffled = assignRoadmapGateColors([gate('v1', 2), gate('beta', 1), gate('mvp', 0)]);
    expect([...shuffled.entries()].sort()).toEqual([...declared.entries()].sort());
  });

  it('colours MVP even when nothing was declared, since MVP always exists', () => {
    expect(assignRoadmapGateColors(undefined).get(MVP_GATE_ID)?.color).toBe(ROADMAP_GATE_PALETTE[0]!.hex);
    expect(assignRoadmapGateColors([]).size).toBe(1);
  });

  it('drops what the roadmap would drop: unsafe ids and duplicates', () => {
    const colors = assignRoadmapGateColors([gate('mvp', 0), gate('###', 1), gate('beta', 2), gate('beta', 3)]);
    expect([...colors.keys()]).toEqual(['mvp', 'beta']);
    expect(colors.get('beta')?.colorIndex).toBe(1);
  });

  it('is deterministic, and never gives two declared gates the same colour', () => {
    const ids = fc.uniqueArray(
      fc.stringMatching(/^[a-z][a-z0-9.-]{0,10}$/).filter(id => slugifyGateId(id) === id),
      { maxLength: MAX_ROADMAP_GATES + 6 },
    );
    fc.assert(fc.property(ids, list => {
      const gates = list.map((id, index) => gate(id, index + 1));
      const first = assignRoadmapGateColors(gates);
      const again = assignRoadmapGateColors(gates.map(entry => ({ ...entry })));
      expect([...again.entries()]).toEqual([...first.entries()]);
      // Within the cap there is one colour per gate.
      expect(first.size).toBeLessThanOrEqual(MAX_ROADMAP_GATES);
      const hexes = [...first.values()].map(entry => entry.color);
      expect(new Set(hexes).size).toBe(hexes.length);
      expect([...first.values()].every(entry => !entry.hollow)).toBe(true);
    }));
  });
});

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function rgbOf(hex: string): RGB {
  return parseColour(hex)!.rgb;
}

/** CIE76 ΔE, through D65 XYZ to L*a*b*. */
function deltaE76(a: RGB, b: RGB): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function toLab(rgb: RGB): [number, number, number] {
  const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb.map(lin) as RGB;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * What a gate dot can sit on, resolved from the stylesheet as it renders: the
 * canvas card and the board card (their own `background` declarations), and
 * the toolbar the legend lives on (the dashboard's panel surfaces and the page).
 */
function cardSurfaces(theme: (typeof VSCODE_THEMES)[number]): Record<string, RGB> {
  const out: Record<string, RGB> = {};
  for (const rule of walkPanelRules(ROOT, theme)) {
    if (rule.file !== 'src/views/projectDashboardPanel.ts') { continue; }
    if (rule.selector !== '.rm-node' && rule.selector !== '.rm-board-cardlet') { continue; }
    const background = declaration(rule.body, /background/);
    const resolved = rule.resolve(background);
    if (resolved) { out[`${rule.selector} card`] = resolved; }
  }
  const read = (file: string) => readFileSync(path.join(ROOT, 'src', 'views', file), 'utf8');
  const css = scopeCssToTheme(read('webviewUtils.ts') + read('dashboardTheme.ts'), theme.bodyClasses);
  const backdrop = composite(parseColour(theme.tokens['--vscode-editor-background']!)!, [0, 0, 0]);
  const resolve = makeColourResolver(collectCustomProperties(css, theme.tokens), backdrop, new Set(theme.absent));
  out.page = backdrop;
  for (const token of ['--dash-panel', '--dash-panel-strong']) {
    const resolved = resolve(`var(${token})`);
    if (resolved) { out[`${token} (legend)`] = resolved; }
  }
  return out;
}

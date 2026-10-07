import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { VSCODE_THEMES } from '../fixtures/vscodeThemeTokens.ts';
import {
  collectCustomProperties,
  composite,
  contrastRatio,
  declaration,
  makeColourResolver,
  parseColour,
  scopeCssToTheme,
  splitArgs,
  toHex,
  walkPanelRules,
  type RGB,
} from '../helpers/cssContrast.ts';

/**
 * Every raised surface on every dashboard can be told apart from the page.
 *
 * The report was that "the boxes, bubbles etc" on the dashboards were "a very
 * similar colour to the background". Measured, they were: a card's edge was
 * the theme's widget border at 70% — 1.1:1 against the page on Dark Modern —
 * and its fill was a few percent off the background, so a card was a region
 * you had to infer. WCAG 1.4.11 asks 3:1 between a component's boundary and
 * what surrounds it.
 *
 * The fix is one token, `--atlas-boundary`, declared in the shell every panel
 * shares (`src/views/webviewUtils.ts`), and every panel's card, chip, bubble,
 * badge and field edge drawn from it. These tests hold that in place three
 * ways: the tokens themselves are measured in each built-in theme kind; every
 * rule that draws an edge is measured; and for the themes nobody can enumerate
 * the *mechanism* is asserted instead — the edge is derived from the active
 * theme's own colours, not pinned to a value tuned for one of them.
 *
 * Text contrast (WCAG 1.4.3) is `themeContrast.test.ts`; both share one
 * resolver so they cannot disagree about what a colour is.
 */

const ROOT = process.cwd();
const VIEWS = path.join(ROOT, 'src', 'views');
const read = (file: string) => readFileSync(path.join(VIEWS, file), 'utf8');

/** WCAG 1.4.11 non-text contrast. */
const BOUNDARY_MINIMUM = 3;

/** The boundary token and every legacy alias a panel may still read it through. */
const BOUNDARY_TOKENS = [
  '--atlas-boundary',
  '--dash-border',
  '--atlas-border',
  '--atlas-panel-border',
  '--run-border',
  '--studio-border',
  '--lens-border',
];

/**
 * Rules whose edge is deliberately the page colour.
 *
 * A knock-out ring is a gap, not a boundary: it separates a badge from the icon
 * it overlaps. Each entry names why, and the test below checks the entry still
 * describes the code, so an exemption cannot outlive the rule it excused.
 */
const KNOCKOUT_RINGS: ReadonlyArray<{ file: string; selector: string; reason: string }> = [
  {
    file: 'src/views/chatWebviewMarkup.ts',
    selector: '.run-toggle .nav-count-badge',
    reason: 'a count badge overlapping the run toggle; the ring cuts it out of the icon, and the count is the badge\'s content',
  },
];

describe('the boundary tokens clear 3:1 in every built-in theme kind', () => {
  for (const theme of VSCODE_THEMES) {
    it(`${theme.label}`, () => {
      const css = scopeCssToTheme(read('webviewUtils.ts') + read('dashboardTheme.ts'), theme.bodyClasses);
      const backdrop = composite(parseColour(theme.tokens['--vscode-editor-background']!)!, [0, 0, 0]);
      const vars = collectCustomProperties(css, theme.tokens);
      const resolve = makeColourResolver(vars, backdrop, new Set(theme.absent));

      // What a card can sit on: the editor page, the top of the dashboard's
      // page gradient (the darkest/lightest point of it), and the two raised
      // surfaces a chip or a nested card sits on.
      const surfaces: Record<string, RGB | null> = {
        page: backdrop,
        'page gradient top': resolve(linearGradientTop(vars.get('--dash-bg'))),
        'panel surface': resolve('var(--dash-panel)'),
        'strong panel surface': resolve('var(--dash-panel-strong)'),
      };
      const failures: string[] = [];
      for (const token of BOUNDARY_TOKENS) {
        const edge = resolve(`var(${token})`);
        expect(edge, `${token} resolves under ${theme.label}`).not.toBeNull();
        for (const [name, surface] of Object.entries(surfaces)) {
          expect(surface, `${name} resolves under ${theme.label}`).not.toBeNull();
          const ratio = contrastRatio(edge!, surface!);
          if (ratio < BOUNDARY_MINIMUM) {
            failures.push(`${token} ${toHex(edge!)} on ${name} ${toHex(surface!)} = ${ratio.toFixed(2)}:1`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

/**
 * The first stop of the page's linear gradient — its top edge, the part of the
 * page that differs most from the editor background. `--dash-bg` layers a
 * mostly transparent radial glow over it, and a first-colour-wins read of the
 * whole value would measure the glow instead.
 */
function linearGradientTop(value: string | undefined): string | undefined {
  const at = value?.indexOf('linear-gradient(') ?? -1;
  if (!value || at === -1) { return undefined; }
  const body = value.slice(at + 'linear-gradient('.length, value.lastIndexOf(')'));
  return splitArgs(body).find(arg => !/^(to |[\d.]+deg)/.test(arg));
}

interface EdgeRow { theme: string; file: string; selector: string; edge: string; ratio: number; fillRatio: number }

/** The colour part of a `border` shorthand: drop widths and styles. */
function borderColourText(value: string): string | null {
  if (/^(none|0|0px|hidden)\b/.test(value.trim())) { return null; }
  return value
    .replace(/(^|\s)-?[\d.]+(px|em|rem)?(?=\s|$)/g, ' ')
    .replace(/(^|\s)(solid|dashed|dotted|double|groove|ridge|inset|outset)(?=\s|$)/g, ' ')
    .trim() || null;
}

function edgeRows(): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const theme of VSCODE_THEMES) {
    for (const rule of walkPanelRules(ROOT, theme)) {
      if (rule.selector.includes('::')) { continue; }
      const shorthand = declaration(rule.body, /border/);
      const colourOnly = declaration(rule.body, /border-color/);
      const text = colourOnly ?? (shorthand ? borderColourText(shorthand) : null);
      // `transparent` is a control that is borderless at rest — a nav link, an
      // icon button — identified by its label, which is what 1.4.11 asks of a
      // text control. It is not an edge that failed; it is no edge.
      if (!text || text === 'transparent') { continue; }
      const edge = rule.resolve(text);
      if (!edge) { continue; }
      const fill = rule.resolve(declaration(rule.body, /background(?:-color|-image)?/));
      rows.push({
        theme: theme.id,
        file: rule.file,
        selector: rule.selector,
        edge: toHex(edge),
        ratio: Number(contrastRatio(edge, rule.backdrop).toFixed(2)),
        fillRatio: fill ? Number(contrastRatio(fill, rule.backdrop).toFixed(2)) : 1,
      });
    }
  }
  return rows;
}

describe('every edge a panel draws can be seen', () => {
  const rows = edgeRows();

  it.each(VSCODE_THEMES.map(t => t.id))('measures a meaningful number of edges under %s', themeId => {
    // Guards against the walk silently matching nothing.
    expect(rows.filter(r => r.theme === themeId).length).toBeGreaterThan(400);
  });

  it('separates every bordered surface from the page by its edge or its fill (3:1)', () => {
    // Either is enough — a solid primary button is identified by its fill, a
    // card by its edge — and neither is a failure that has gone unnoticed.
    const knockouts = new Set(KNOCKOUT_RINGS.map(k => `${k.file} ${k.selector}`));
    const failures = rows.filter(r =>
      r.ratio < BOUNDARY_MINIMUM
      && r.fillRatio < BOUNDARY_MINIMUM
      && !knockouts.has(`${r.file} ${r.selector}`));
    expect(
      failures.map(r => `[${r.theme}] ${r.file} ${r.selector} → edge ${r.edge} ${r.ratio}:1, fill ${r.fillRatio}:1`),
      'surfaces indistinguishable from the page',
    ).toEqual([]);
  });

  it('keeps every knock-out exemption attached to a rule that is still a knock-out', () => {
    for (const knockout of KNOCKOUT_RINGS) {
      const source = readFileSync(path.join(ROOT, knockout.file), 'utf8');
      const at = source.indexOf(`${knockout.selector} {`);
      expect(at, `${knockout.selector} still exists`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('}', at));
      expect(body, `${knockout.selector} still cuts out with the page colour`).toMatch(/border:\s*[^;]*var\(--vscode-editor-background/);
      expect(knockout.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('the boundary is derived from the theme, never pinned', () => {
  // Built-in themes can be measured; the thousands of third-party themes
  // cannot. What can be asserted for them is the mechanism: the edge is the
  // active theme's own foreground mixed into its own background (or, in high
  // contrast, the theme's own contrastBorder), so it moves with whatever theme
  // is installed instead of being a value somebody tuned for Dark Modern.
  const shell = read('webviewUtils.ts');

  function boundaryShare(branchSelector: RegExp): number {
    const block = new RegExp(String.raw`${branchSelector.source}[^{]*\{([^}]*)\}`).exec(shell)?.[1] ?? '';
    const m = /--atlas-boundary:\s*color-mix\(in srgb, var\(--vscode-editor-foreground, var\(--vscode-foreground\)\) (\d+)%, var\(--vscode-editor-background\)\);/.exec(block);
    expect(m, `--atlas-boundary in ${branchSelector.source} mixes the editor foreground into the editor background`).not.toBeNull();
    return Number(m![1]) / 100;
  }

  const darkShare = boundaryShare(/\n\s*:root\s/);
  const lightShare = boundaryShare(/:root:has\(> body\.vscode-light\),\s*:root:has\(> body\.vscode-high-contrast-light\)\s/);

  it('uses the theme\'s own contrast border in high contrast', () => {
    expect(shell).toMatch(/:root:has\(> body\.vscode-high-contrast\)\s*\{[^}]*--atlas-boundary:\s*var\(--vscode-contrastBorder,/);
  });

  it('routes every shared border alias through it', () => {
    const theme = read('dashboardTheme.ts');
    expect(theme).toMatch(/--dash-border:\s*var\(--atlas-boundary\);/);
    for (const alias of ['--atlas-border', '--atlas-panel-border', '--run-border', '--studio-border', '--lens-border']) {
      expect(theme, alias).toMatch(new RegExp(String.raw`${alias}:\s*var\(--dash-border\);`));
    }
  });

  /**
   * A property, over every neutral theme rather than four of them.
   *
   * sRGB mixing is not linear in luminance, so a share that clears 3:1 for one
   * pair does not for every pair, and stating where the guarantee holds is the
   * honest version of it: any grey dark theme whose editor text is at least
   * 9.2:1 on its background, and any grey light theme at 7.6:1. Every built-in
   * non-high-contrast theme is inside that (Dark Modern 10.3, Dark+ 11.2, Light
   * Modern 10.9, Light+ 21).
   */
  const mix = (fg: number, bg: number, share: number): RGB => {
    const v = fg * share + bg * (1 - share);
    return [v, v, v];
  };
  const grey = (v: number): RGB => [v, v, v];

  it('clears 3:1 on any neutral dark theme with editor text at 9.2:1 or more', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (fg, bg) => {
      fc.pre(fg > bg && contrastRatio(grey(fg), grey(bg)) >= 9.2);
      return contrastRatio(mix(fg, bg, darkShare), grey(bg)) >= BOUNDARY_MINIMUM;
    }), { numRuns: 2000 });
  });

  it('clears 3:1 on any neutral light theme with editor text at 7.6:1 or more', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), (fg, bg) => {
      fc.pre(fg < bg && contrastRatio(grey(fg), grey(bg)) >= 7.6);
      return contrastRatio(mix(fg, bg, lightShare), grey(bg)) >= BOUNDARY_MINIMUM;
    }), { numRuns: 2000 });
  });

  it('never thins a tone into transparent on a full border', () => {
    // A tone (good, warning, accent) tints a boundary by mixing into it. Mixed
    // into `transparent` it fades toward the page instead, which is how every
    // status chip and banner edge used to land at 1.3–2.5:1.
    const offenders: string[] = [];
    for (const file of readdirSync(VIEWS).filter(f => f.endsWith('.ts'))) {
      for (const m of read(file).matchAll(/(?:^|[\s;{"])border(?:-color)?\s*:\s*([^;`{}"]*);/g)) {
        if (/color-mix\([^;]*,\s*transparent\)/.test(m[1]!)) {
          offenders.push(`src/views/${file} → ${m[0].trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

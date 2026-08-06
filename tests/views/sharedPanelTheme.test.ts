import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_PANEL_BASE_CSS,
  DASHBOARD_PANEL_SKIN_CSS,
  DASHBOARD_TOKEN_ALIASES_CSS,
} from '../../src/views/dashboardTheme.ts';

/**
 * One design language across every AtlasMind panel.
 *
 * Nineteen panels had each grown a palette under its own prefix, and four of
 * those were drifted copies of the Project Dashboard's. The drift is what makes
 * this worth a test rather than a convention: none of it was ever a decision, it
 * was what happened when a panel written in March could not see one written in
 * July, and the same thing will happen again the moment a new panel opens its
 * stylesheet with a `:root` block of its own.
 *
 * The three properties below are the ones a screenshot would not catch — a
 * panel that opts out, a palette that comes back, and the layer ordering that
 * makes the whole thing work.
 */

const VIEWS = path.join(process.cwd(), 'src', 'views');
const read = (file: string) => readFileSync(path.join(VIEWS, file), 'utf8');

/**
 * Panels that legitimately do not opt in.
 *
 * The Personality Profile's warm palette is deliberate and the user has asked
 * to keep it — the same exemption `themeContrast.test.ts` already carries. The
 * Project Dashboard is the source: it injects `DASHBOARD_THEME_CSS` directly
 * and its stylesheet *is* what the skin was extracted from, so wrapping it in
 * its own output would be circular.
 */
const EXEMPT = new Map([
  ['personalityProfilePanel.ts', 'deliberately keeps its own warm palette'],
  ['projectDashboardPanel.ts', 'is the source of the design language'],
]);

/** Every view file that renders a webview through the shared shell. */
function shellCallers(): string[] {
  return readdirSync(VIEWS)
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .filter(file => read(file).includes('getWebviewHtmlShell({'));
}

describe('every panel renders in the dashboard design language', () => {
  it('finds the panels rather than trusting a hand-written list', () => {
    // Guards against the glob silently matching nothing and every assertion
    // below passing over an empty set.
    expect(shellCallers().length).toBeGreaterThan(20);
  });

  it('opts every panel in but the two that are exempt on purpose', () => {
    const optedOut = shellCallers().filter(file => !read(file).includes('dashboardSkin: true'));
    expect(optedOut.sort(), 'panels not rendering in the shared design language')
      .toEqual([...EXEMPT.keys()].sort());
  });

  it('states why each exemption exists', () => {
    // An exemption with no reason is indistinguishable from an oversight, and
    // the next person to read this list has to guess which one it is.
    for (const [file, reason] of EXEMPT) {
      expect(reason.length, file).toBeGreaterThan(10);
      expect(readdirSync(VIEWS)).toContain(file);
    }
  });
});

describe('no panel keeps a private palette', () => {
  /**
   * Token prefixes that used to be declared per panel. A `:root` block naming
   * one of these again means a panel has started redefining the shared palette
   * locally, which is precisely the drift this module ended.
   */
  const RETIRED_PREFIXES = ['--atlas-surface', '--atlas-border', '--atlas-accent', '--atlas-muted',
    '--atlas-panel-', '--run-', '--studio-', '--lens-surface', '--lens-border', '--lens-muted', '--lens-radius'];

  it('declares the retired prefixes only as aliases in the shared theme', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(VIEWS).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      // The exempt panels declare their own palette on purpose; that is what
      // being exempt means. The theme itself is where the aliases live.
      if (file === 'dashboardTheme.ts' || EXEMPT.has(file)) { continue; }
      const source = read(file);
      for (const block of source.matchAll(/:root\s*\{([^}]*)\}/g)) {
        for (const prefix of RETIRED_PREFIXES) {
          if (block[1]!.includes(`${prefix}`)) { offenders.push(`${file} → ${prefix}`); }
        }
      }
    }
    expect(offenders, 'panels redeclaring a shared token').toEqual([]);
  });

  it('keeps every retired name working through an alias', () => {
    // The panels' rules still *read* these names — the migration was a palette
    // change, not a rewrite of a thousand declarations. A missing alias is a
    // rule resolving to nothing, which renders as an unstyled element rather
    // than as an error.
    for (const prefix of RETIRED_PREFIXES) {
      expect(DASHBOARD_TOKEN_ALIASES_CSS, prefix).toContain(prefix);
    }
  });

  it('leaves the Lens accent local, because it carries meaning', () => {
    // Eight lenses, eight hues, so the header rule says which lens you are
    // reading. Collapsing them into one accent would delete information rather
    // than unify a style — so this one exception is asserted, not assumed.
    expect(DASHBOARD_TOKEN_ALIASES_CSS).not.toContain('--lens-accent');
    expect(read('lensVisuals.ts')).toContain('[data-accent="blue"]');
  });
});

describe('the two layers are applied in the order that makes them work', () => {
  const shell = read('webviewUtils.ts');

  it('puts the base before the panel and the skin after it', () => {
    // Reversed, every panel would look exactly as it did before — which nobody
    // would report as a bug, because nothing would appear broken.
    const base = shell.indexOf('DASHBOARD_PANEL_BASE_CSS : ');
    const own = shell.indexOf('options.extraCss ??');
    const skin = shell.indexOf('DASHBOARD_PANEL_SKIN_CSS : ');
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(own);
    expect(own).toBeLessThan(skin);
  });

  it('exposes no second way to combine them', () => {
    // A helper that concatenated the layers would be a second chance to get the
    // order wrong, in a file that cannot see how the shell already does it.
    const theme = read('dashboardTheme.ts');
    expect(theme).not.toMatch(/export function with[A-Za-z]*Skin/);
  });

  it('carries the tokens the skin depends on in the layer that precedes it', () => {
    // The skin is pure identity — surface, radius, border, shadow, type — and
    // every value it uses is a token. If a token moved out of the base layer
    // the skin would resolve it to nothing and repaint half a panel white.
    for (const token of ['--dash-panel', '--dash-panel-strong', '--dash-border', '--dash-radius',
      '--dash-shadow', '--dash-muted', '--dash-accent', '--dash-heading', '--dash-body']) {
      expect(DASHBOARD_PANEL_BASE_CSS, token).toContain(`${token}:`);
      expect(DASHBOARD_PANEL_SKIN_CSS, token).toContain(`var(${token}`);
    }
  });

  it('sets identity in the skin and never layout', () => {
    // The split is the whole design: a panel keeps where its cards go and loses
    // what they look like. A grid template here would overrule a layout the
    // skin has never seen.
    for (const layoutProperty of ['grid-template-columns', 'grid-template-areas', 'position: sticky', 'flex-direction: column']) {
      expect(DASHBOARD_PANEL_SKIN_CSS, layoutProperty).not.toContain(layoutProperty);
    }
  });
});

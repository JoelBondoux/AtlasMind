import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { VSCODE_THEMES } from '../fixtures/vscodeThemeTokens.ts';
import { contrastRatio, declaration, relativeLuminance, toHex, walkPanelRules } from '../helpers/cssContrast.ts';

/**
 * Computed text contrast for every panel, in every built-in theme kind.
 *
 * Every colour in these panels is built from chained custom properties and
 * `color-mix()`, so a declaration-level search cannot tell whether the result
 * is legible — two separate reviews of the source missed it entirely. This
 * resolves each `color` declaration to a concrete RGB value and measures it
 * against the background it sits on, under Dark Modern, Light Modern and both
 * high-contrast themes (`tests/fixtures/vscodeThemeTokens.ts`, transcribed from
 * VS Code's own theme files and colour registry).
 *
 * It used to measure one dark theme against a 2.4:1 "obviously broken" floor.
 * That passed a light theme whose status colours were 1.9:1 on white and a
 * high-contrast theme in which every accent was black on black, because
 * neither was ever looked at. The target is now WCAG 1.4.3's 4.5:1, in all
 * four, with no panel exempt. The modelling rules that make the number mean
 * anything live in `tests/helpers/cssContrast.ts`.
 */

const ROOT = process.cwd();

interface Row { theme: string; file: string; selector: string; fg: string; bg: string; ratio: number; fgLuminance: number }

function analyse(): Row[] {
  const rows: Row[] = [];
  for (const theme of VSCODE_THEMES) {
    for (const rule of walkPanelRules(ROOT, theme)) {
      const fg = rule.resolve(declaration(rule.body, /color/));
      if (!fg) { continue; }
      const bg = rule.resolve(declaration(rule.body, /background(?:-color|-image)?/)) ?? rule.backdrop;
      rows.push({
        theme: theme.id,
        file: rule.file,
        selector: rule.selector,
        fg: toHex(fg),
        bg: toHex(bg),
        ratio: Number(contrastRatio(fg, bg).toFixed(2)),
        fgLuminance: Number(relativeLuminance(fg).toFixed(3)),
      });
    }
  }
  return rows;
}

describe('computed text contrast in every built-in theme kind', () => {
  const rows = analyse();
  // Pseudo-elements carry decoration (`::before` rules, scrollbar parts) whose
  // background is usually the element they decorate, which a rule-level read
  // cannot see; measuring them against the page reports noise.
  const measured = rows.filter(r => !r.selector.includes('::'));

  it.each(VSCODE_THEMES.map(t => t.id))('resolves a meaningful number of rules under %s', themeId => {
    // Guards against the resolver silently failing and every assertion below
    // passing over an empty set — per theme, because a fixture missing one
    // token can blank a single theme while the others look healthy.
    expect(rows.filter(r => r.theme === themeId).length).toBeGreaterThan(400);
  });

  it('renders no near-black text on a dark surface', () => {
    // Dark text is only a defect when what is *behind* it is also dark. Plenty
    // of rules pair near-black text with a bright fill on purpose — a danger
    // button on red, a search highlight on yellow, the ideation sticky notes on
    // pastel — and those read perfectly. The failure mode reported was
    // dark-on-dark, so both sides have to be dark to count.
    const nearBlack = measured.filter(r => r.fgLuminance < 0.05 && relativeLuminance(hex(r.bg)) < 0.2);
    expect(
      nearBlack.map(r => `[${r.theme}] ${r.file} ${r.selector} → ${r.fg} on ${r.bg}`),
      'near-black text on a dark surface',
    ).toEqual([]);
  });

  it('keeps text at WCAG 1.4.3 contrast (4.5:1) against its own background', () => {
    const failures = measured.filter(r => r.ratio < 4.5);
    expect(
      failures.map(r => `[${r.theme}] ${r.file} ${r.selector} → ${r.fg} on ${r.bg} (${r.ratio}:1)`),
      'text below 4.5:1',
    ).toEqual([]);
  });
});

function hex(value: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * A class worn by a `<button>` must declare its own background.
 *
 * The computed-contrast pass above cannot see this one, and the reason is worth
 * stating because it is a modelling limit rather than an oversight: when a rule
 * declares no background, that pass assumes the page backdrop. For a `<span>`
 * that is right. For a `<button>` it is wrong — the element takes the browser's
 * *default* button background, a light grey that ignores the theme entirely, so
 * a rule pairing muted near-white text with no background computes as perfectly
 * legible and renders as unreadable.
 *
 * Which is exactly what happened to the Test Browser's category pills: `.tag`
 * set `color` and no `background`, and every unselected filter was white on
 * white. Only the selected one was readable, and only because `.tag-good`
 * happens to set a background of its own — which is also why it survived
 * review, since the card looked fine in the one state anybody screenshots.
 */
describe('classes worn by buttons declare their own background', () => {
  const DASHBOARD_CSS = readFileSync(
    path.join(ROOT, 'src', 'views', 'projectDashboardPanel.ts'),
    'utf8',
  );
  const MARKUP = [
    readFileSync(path.join(ROOT, 'media', 'projectDashboard.js'), 'utf8'),
    DASHBOARD_CSS,
  ].join('\n');

  /**
   * The static class combination on each `<button>`.
   *
   * Combinations rather than individual classes, because that is how CSS
   * composes and checking tokens in isolation is wrong in both directions:
   * `danger-link` and `dashboard-version-pill-more` set a colour and no
   * background, and both are perfectly legible because they are only ever worn
   * beside `action-link` and `dashboard-version-pill`, which set one.
   */
  function buttonClassSets(): string[][] {
    const sets: string[][] = [];
    for (const match of MARKUP.matchAll(/<button\b[^>]*?\bclass="([^"]*)"/g)) {
      const tokens = (match[1] ?? '')
        .split(/\s+/)
        // Template expressions resolve at render time and cannot be read
        // statically. Dropping them can only lose a background, never invent
        // one, so the check stays biased towards reporting.
        .filter(token => token && !token.includes('$') && !token.includes('{') && !token.includes('}'))
        .filter(token => /^[a-z][a-z0-9-]*$/.test(token));
      if (tokens.length > 0) {
        sets.push(tokens);
      }
    }
    return sets;
  }

  /** Every declaration block whose selector names this class. */
  function bodiesFor(className: string): string[] {
    const pattern = new RegExp(
      String.raw`(?:^|[\s,>+~])(?:[a-z]+)?\.${className}(?![a-zA-Z0-9_-])[^{}]*\{([^{}]*)\}`,
      'g',
    );
    return [...DASHBOARD_CSS.matchAll(pattern)].map(rule => rule[1] ?? '');
  }

  const declaresBackground = (className: string): boolean =>
    bodiesFor(className).some(body => /(?:^|[\s;])background(?:-color|-image)?\s*:/.test(body));

  const declaresColor = (className: string): boolean =>
    bodiesFor(className).some(body => /(?:^|[\s;])color\s*:/.test(body));

  it('finds the buttons to check', () => {
    // Guards against the markup scan silently matching nothing and the
    // assertion below passing over an empty set.
    expect(buttonClassSets().length).toBeGreaterThan(5);
  });

  /**
   * Only combinations that set a colour are checked. A class that styles
   * nothing but layout inherits both colour and background from its container
   * and is not at risk; the dangerous pair is a declared text colour with no
   * declared background anywhere in the combination, because only then does the
   * browser's light grey become the backdrop.
   */
  it('never pairs a declared text colour with an undeclared background on a button', () => {
    const unreadable = [...new Set(buttonClassSets()
      .filter(tokens => tokens.some(declaresColor) && !tokens.some(declaresBackground))
      .map(tokens => tokens.join(' ')))].sort();
    expect(
      unreadable,
      'button class combinations that set a colour and no background — these render on the browser default, not the theme',
    ).toEqual([]);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Computed contrast for panel text under a real VS Code dark theme.
 *
 * Every colour in these panels is built from chained custom properties and
 * `color-mix()`, so a declaration-level search cannot tell whether the result
 * is legible — two separate reviews of the source missed it entirely. This
 * resolves each `color` declaration to a concrete RGB value and measures it
 * against the background it sits on.
 *
 * Two modelling details matter, and getting either wrong produces confident
 * nonsense:
 *
 * - `transparent` inside a `color-mix` **composites over the page background**.
 *   Treating it as "the other colour wins" makes every tinted badge look like
 *   1:1 contrast against itself.
 * - Only the **dark** cascade branch counts. A declaration inside
 *   `body.vscode-light` does not apply when the theme is dark; including it
 *   inverts `--tint-away` and makes every tinted accent look near-black.
 */

const ROOT = process.cwd();
const VIEWS = path.join(ROOT, 'src', 'views');

/** VS Code "Dark Modern". */
const THEME: Record<string, string> = {
  '--vscode-foreground': '#cccccc',
  '--vscode-editor-background': '#1f1f1f',
  '--vscode-editor-foreground': '#cccccc',
  '--vscode-sideBar-background': '#181818',
  '--vscode-editorWidget-background': '#202020',
  '--vscode-widget-border': '#313131',
  '--vscode-panel-border': '#2b2b2b',
  '--vscode-button-background': '#0078d4',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#026ec1',
  '--vscode-button-secondaryBackground': '#313131',
  '--vscode-button-secondaryForeground': '#cccccc',
  '--vscode-button-secondaryHoverBackground': '#3c3c3c',
  '--vscode-descriptionForeground': '#9d9d9d',
  '--vscode-badge-background': '#616161',
  '--vscode-badge-foreground': '#f8f8f8',
  '--vscode-textLink-foreground': '#4daafc',
  '--vscode-textCodeBlock-background': '#2a2a2a',
  '--vscode-textBlockQuote-background': '#222222',
  '--vscode-errorForeground': '#f85149',
  '--vscode-input-background': '#313131',
  '--vscode-input-foreground': '#cccccc',
  '--vscode-input-border': '#3c3c3c',
  '--vscode-inputValidation-errorBackground': '#5a1d1d',
  '--vscode-inputValidation-errorBorder': '#be1100',
  '--vscode-inputValidation-warningBackground': '#352a05',
  '--vscode-inputValidation-warningBorder': '#cca700',
  '--vscode-inputValidation-errorForeground': '#ffffff',
  '--vscode-testing-iconPassed': '#73c991',
  '--vscode-testing-iconQueued': '#cca700',
  '--vscode-testing-iconFailed': '#f14c4c',
  '--vscode-charts-blue': '#4daafc',
  '--vscode-charts-yellow': '#d7ba7d',
  '--vscode-charts-green': '#89d185',
  '--vscode-charts-purple': '#b180d7',
  '--vscode-charts-red': '#f14c4c',
  '--vscode-focusBorder': '#0078d4',
  '--vscode-editorWarning-foreground': '#cca700',
  '--vscode-notificationsInfoIcon-foreground': '#3794ff',
  '--vscode-notificationsWarningIcon-foreground': '#cca700',
  '--vscode-editorInfo-foreground': '#3794ff',
  '--vscode-list-hoverBackground': '#2a2d2e',
  '--vscode-editorGutter-addedBackground': '#2ea043',
};

type RGB = [number, number, number];

const NAMED: Record<string, string | null> = {
  white: '#ffffff', black: '#000000',
  transparent: null, inherit: null, currentcolor: null, none: null,
};

function parseHex(value: string): RGB | null {
  const v = String(value).trim().toLowerCase();
  if (v in NAMED) { return NAMED[v] ? parseHex(NAMED[v]!) : null; }
  const m = /^#([0-9a-f]{3,8})$/.exec(v);
  if (!m) { return null; }
  let h = m[1]!;
  if (h.length === 3) { h = h.split('').map(c => c + c).join(''); }
  if (h.length === 8) { h = h.slice(0, 6); }
  if (h.length !== 6) { return null; }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (rgb: RGB): string =>
  '#' + rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') { depth += 1; }
    if (ch === ')') { depth -= 1; }
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) { out.push(cur); }
  return out.map(x => x.trim());
}

function extractCall(value: string, name: string): { start: number; end: number; body: string } | null {
  const at = value.toLowerCase().indexOf(name + '(');
  if (at === -1) { return null; }
  let depth = 0;
  for (let i = at + name.length; i < value.length; i += 1) {
    if (value[i] === '(') { depth += 1; }
    else if (value[i] === ')') {
      depth -= 1;
      if (depth === 0) { return { start: at, end: i + 1, body: value.slice(at + name.length + 1, i) }; }
    }
  }
  return null;
}

function makeResolver(vars: Map<string, string>, backdrop: RGB) {
  const seen = new Set<string>();

  function resolve(value: string | undefined, depth = 0): RGB | null {
    if (!value || depth > 24) { return null; }
    const v = value.trim();
    if (!v) { return null; }

    const varCall = extractCall(v, 'var');
    if (varCall) {
      const args = splitArgs(varCall.body);
      const name = args[0]!;
      const fallback = args.slice(1).join(',');
      let inner: RGB | null = null;
      const key = `${name}@${depth}`;
      if (!seen.has(key)) {
        seen.add(key);
        inner = vars.has(name) ? resolve(vars.get(name), depth + 1) : null;
        seen.delete(key);
      }
      if (!inner && fallback) { inner = resolve(fallback, depth + 1); }
      if (!inner) { return null; }
      const replaced = v.slice(0, varCall.start) + toHex(inner) + v.slice(varCall.end);
      return replaced.trim() === toHex(inner) ? inner : resolve(replaced, depth + 1);
    }

    const mix = extractCall(v, 'color-mix');
    if (mix) {
      const args = splitArgs(mix.body).filter(a => !/^in\s/i.test(a));
      if (args.length < 2) { return null; }
      const parse = (arg: string) => {
        const pm = /(.*?)(\d+(?:\.\d+)?)%\s*$/.exec(arg);
        return { colour: resolve((pm ? pm[1] : arg)!.trim(), depth + 1), pct: pm ? parseFloat(pm[2]!) : null };
      };
      const a = parse(args[0]!);
      const b = parse(args[1]!);
      let pa = a.pct;
      let pb = b.pct;
      if (pa === null && pb === null) { pa = 50; pb = 50; }
      else if (pa === null) { pa = 100 - pb!; }
      else if (pb === null) { pb = 100 - pa; }
      if (!a.colour && !b.colour) { return null; }
      const ca = a.colour ?? backdrop;
      const cb = b.colour ?? backdrop;
      const total = pa! + pb! || 100;
      return [0, 1, 2].map(i => (ca[i]! * pa! + cb[i]! * pb!) / total) as RGB;
    }

    for (const fn of ['linear-gradient', 'radial-gradient']) {
      const g = extractCall(v, fn);
      if (g) {
        for (const arg of splitArgs(g.body)) {
          if (/^(to |[\d.]+deg|circle|ellipse|at )/i.test(arg)) { continue; }
          const stop = resolve(arg.replace(/\s+[\d.]+%\s*$/, ''), depth + 1);
          if (stop) { return stop; }
        }
        return null;
      }
    }

    return parseHex(v);
  }

  return resolve;
}

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface Row { file: string; selector: string; fg: string; bg: string; ratio: number; fgLuminance: number }

function analyse(): Row[] {
  const shell = readFileSync(path.join(VIEWS, 'webviewUtils.ts'), 'utf8');
  const theme = readFileSync(path.join(VIEWS, 'dashboardTheme.ts'), 'utf8');
  const widgets = readFileSync(path.join(VIEWS, 'dashboardWidgets.ts'), 'utf8');
  const skip = new Set(['webviewUtils.ts', 'dashboardTheme.ts', 'dashboardWidgets.ts', 'panelNav.ts', 'treeViews.ts', 'chatProtocol.ts']);
  const backdrop = parseHex(THEME['--vscode-editor-background']!)!;

  const rows: Row[] = [];
  for (const file of readdirSync(VIEWS).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !skip.has(f))) {
    const own = readFileSync(path.join(VIEWS, file), 'utf8');
    // A panel resolves colours against the shared theme when it either injects
    // the theme itself (the Project Dashboard) or opts into the skin the shell
    // wraps around it (everything else but the Personality Profile). Without
    // the second case every `var(--dash-*)` in a skinned panel resolves to
    // nothing, the rule is skipped, and the suite passes over an empty set.
    const usesSharedTheme = own.includes('DASHBOARD_THEME_CSS') || own.includes('dashboardSkin: true');
    const scope = shell + (usesSharedTheme ? theme + widgets : '') + own;
    const darkScope = scope.replace(/body\.vscode-light\s*\{[^{}]*\}/g, '');

    const vars = new Map(Object.entries(THEME));
    for (const m of darkScope.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) {
      if (!vars.has(m[1]!) || !m[1]!.startsWith('--vscode-')) { vars.set(m[1]!, m[2]!.trim()); }
    }
    const resolve = makeResolver(vars, backdrop);

    for (const block of darkScope.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const body = block[2]!;
      const colorDecl = /(?:^|[\s;])color:\s*([^;]+)/.exec(body);
      if (!colorDecl) { continue; }
      const fg = resolve(colorDecl[1]);
      if (!fg) { continue; }
      const bgDecl = /(?:^|[\s;])background(?:-color|-image)?:\s*([^;]+)/.exec(body);
      const bg = (bgDecl && resolve(bgDecl[1])) || backdrop;
      rows.push({
        file: `src/views/${file}`,
        selector: block[1]!.split('\n').pop()!.trim().slice(0, 70),
        fg: toHex(fg),
        bg: toHex(bg),
        ratio: Number(contrast(fg, bg).toFixed(2)),
        fgLuminance: Number(luminance(fg).toFixed(3)),
      });
    }
  }
  return rows;
}

describe('computed text contrast on a dark theme', () => {
  const rows = analyse();

  it('resolves a meaningful number of rules', () => {
    // Guards against the resolver silently failing and every assertion below
    // passing over an empty set.
    expect(rows.length).toBeGreaterThan(150);
  });

  it('renders no near-black text on a dark surface', () => {
    // Dark text is only a defect when what is *behind* it is also dark. Plenty
    // of rules pair near-black text with a bright fill on purpose — a danger
    // button on red, a search highlight on yellow, the ideation sticky notes on
    // pastel — and those read perfectly. The failure mode reported was
    // dark-on-dark, so both sides have to be dark to count.
    const nearBlack = rows.filter(r =>
      r.fgLuminance < 0.05
      && luminance(parseHex(r.bg)!) < 0.2
      && !r.selector.includes('::'));
    expect(
      nearBlack.map(r => `${r.file} ${r.selector} → ${r.fg} on ${r.bg}`),
      'near-black text on a dark surface',
    ).toEqual([]);
  });

  it('keeps text legible against its own background', () => {
    // 2.4:1 is well below WCAG AA; it is a floor for "obviously broken", not a
    // compliance target. The Personality Profile is exempt — its warm palette
    // is deliberate and the user has asked to keep it.
    const failures = rows.filter(r =>
      r.ratio < 2.4
      && !r.selector.includes('::')
      && !r.file.endsWith('personalityProfilePanel.ts'));
    expect(
      failures.map(r => `${r.file} ${r.selector} → ${r.fg} on ${r.bg} (${r.ratio}:1)`),
      'text below a 2.4:1 floor',
    ).toEqual([]);
  });
});

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

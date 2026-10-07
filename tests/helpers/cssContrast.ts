/**
 * Static WCAG contrast for AtlasMind's webview CSS.
 *
 * There is no rendered page in a test process — every panel is a template
 * string that needs a live `vscode` API — so contrast is computed from the
 * stylesheet text instead: resolve each colour through its chain of custom
 * properties, `color-mix()` and theme variables to one concrete RGB value, then
 * apply the WCAG 2.x relative-luminance formula.
 *
 * Shared by `tests/views/themeContrast.test.ts` (text, WCAG 1.4.3) and
 * `tests/views/surfaceBoundaries.test.ts` (component boundaries, WCAG 1.4.11),
 * so the two cannot disagree about what a colour resolves to.
 *
 * Three modelling details are load-bearing, and getting any of them wrong
 * produces confident nonsense:
 *
 * - **`transparent` composites over the page.** In `color-mix(x 70%,
 *   transparent)` the result is 70% of `x` laid over whatever is behind it;
 *   treating it as "the other colour wins" makes every tinted badge 1:1 against
 *   itself. The same goes for a translucent theme colour (`#ffffffb3`).
 * - **Only the active theme's cascade branch applies.** A block selected by
 *   `body.vscode-light` does not apply under a dark theme; including it inverts
 *   every tint. {@link scopeCssToTheme} drops the branches that do not match.
 * - **Unknown is not a colour.** Anything the resolver cannot read — an
 *   absent variable with no fallback, `currentColor`, `inherit` — returns
 *   `null`, and callers skip it rather than assuming the page colour.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { VscodeThemeFixture } from '../fixtures/vscodeThemeTokens.ts';

export type RGB = [number, number, number];
export interface RGBA { rgb: RGB; alpha: number }

const NAMED: Record<string, RGBA | null> = {
  white: { rgb: [255, 255, 255], alpha: 1 },
  black: { rgb: [0, 0, 0], alpha: 1 },
  transparent: { rgb: [0, 0, 0], alpha: 0 },
};

/** Parse one literal colour: hex (3/4/6/8 digits), `rgb()`/`rgba()`, white, black, transparent. */
export function parseColour(value: string): RGBA | null {
  const v = String(value).trim().toLowerCase();
  if (v in NAMED) { return NAMED[v] ?? null; }
  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) { h = h.split('').map(c => c + c).join(''); }
    if (h.length !== 6 && h.length !== 8) { return null; }
    const rgb: RGB = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return { rgb, alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) { return null; }
    const channels = parts.slice(0, 3).map(p => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)));
    if (channels.some(c => !Number.isFinite(c))) { return null; }
    const a = parts[3];
    const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return Number.isFinite(alpha) ? { rgb: channels as RGB, alpha } : null;
  }
  return null;
}

/** Lay a translucent colour over an opaque one. */
export function composite(top: RGBA, under: RGB): RGB {
  return [0, 1, 2].map(i => top.rgb[i]! * top.alpha + under[i]! * (1 - top.alpha)) as RGB;
}

export const toHex = (rgb: RGB): string =>
  '#' + rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');

/** WCAG 2.x relative luminance. */
export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function splitArgs(s: string): string[] {
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

/**
 * A resolver from CSS colour expressions to RGB under one set of variables.
 *
 * `backdrop` is what a translucent result is composited over — the page.
 */
export function makeColourResolver(
  vars: ReadonlyMap<string, string>,
  backdrop: RGB,
  /**
   * `--vscode-*` names the theme is known to leave unset. Any *other*
   * `--vscode-*` name missing from `vars` is a colour VS Code does supply but
   * the fixture does not record, so it is unknown — its fallback never renders
   * and must not be measured as though it did.
   */
  absentThemeVars: ReadonlySet<string> = new Set(),
) {
  const seen = new Set<string>();

  /**
   * A variable holding a number or a percentage substitutes as text first, so
   * `color-mix(in srgb, x var(--share), y)` resolves the way CSS does —
   * substitution happens before the function is parsed.
   */
  const SCALAR = /^-?[\d.]+%?$/;
  function substituteScalars(value: string): string {
    return value.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g, (whole, name: string) => {
      const raw = vars.get(name)?.trim();
      return raw !== undefined && SCALAR.test(raw) ? raw : whole;
    });
  }

  function resolve(value: string | undefined, depth = 0): RGB | null {
    if (!value || depth > 24) { return null; }
    const v = substituteScalars(value.trim());
    if (!v) { return null; }

    const varCall = extractCall(v, 'var');
    if (varCall) {
      const args = splitArgs(varCall.body);
      const name = args[0]!;
      const fallback = args.slice(1).join(',');
      if (!vars.has(name) && name.startsWith('--vscode-') && !absentThemeVars.has(name)) { return null; }
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
        const text = (pm ? pm[1] : arg)!.trim();
        const isTransparent = text.toLowerCase() === 'transparent';
        return { colour: isTransparent ? null : resolve(text, depth + 1), transparent: isTransparent, pct: pm ? parseFloat(pm[2]!) : null };
      };
      const a = parse(args[0]!);
      const b = parse(args[1]!);
      // An unreadable operand (not `transparent`) is unknown, not the page.
      if ((!a.colour && !a.transparent) || (!b.colour && !b.transparent)) { return null; }
      let pa = a.pct;
      let pb = b.pct;
      if (pa === null && pb === null) { pa = 50; pb = 50; }
      else if (pa === null) { pa = 100 - pb!; }
      else if (pb === null) { pb = 100 - pa; }
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

    const literal = parseColour(v);
    return literal ? composite(literal, backdrop) : null;
  }

  return resolve;
}

/** The theme classes a selector can be conditioned on. */
const THEME_CLASS = /vscode-(high-contrast-light|high-contrast|light|dark)(?![a-z-])/g;

/**
 * Drop every rule block that applies only under a *different* theme.
 *
 * A selector list applies if any of its selectors applies, and a selector
 * applies if every theme class it names is on `<body>` for this theme. That
 * covers both spellings the codebase uses: `body.vscode-light .x` and the
 * document-level `:root:has(> body.vscode-light)`.
 */
export function scopeCssToTheme(css: string, bodyClasses: readonly string[]): string {
  const active = new Set(bodyClasses);
  return css.replace(/([^{}]*)\{([^{}]*)\}/g, (whole, selector: string) => {
    // A comment above a rule is captured as part of its selector text, and a
    // comma inside one would otherwise split off a "selector" that names no
    // theme and so applies everywhere.
    const parts = selector.replace(/\/\*[\s\S]*?\*\//g, ' ').split(',');
    const applies = parts.some(part => {
      const named = [...part.matchAll(THEME_CLASS)].map(m => `vscode-${m[1]}`);
      return named.every(cls => active.has(cls));
    });
    return applies ? whole : '';
  });
}

/**
 * Custom properties declared in `css`, layered over the theme's own.
 *
 * Later declarations win, as they would in the cascade for rules of equal
 * specificity. A panel cannot redefine a `--vscode-*` variable the theme sets:
 * VS Code writes those as inline style on `<html>`, which no stylesheet rule
 * outranks.
 */
export function collectCustomProperties(css: string, themeTokens: Readonly<Record<string, string>>): Map<string, string> {
  const vars = new Map(Object.entries(themeTokens));
  // A declaration opens a line or follows `{`/`;`. Anchoring it keeps prose
  // in a comment ("the shell's --x: unchanged on dark") from being read as one.
  for (const m of css.matchAll(/(?:^|[;{])\s*(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/gm)) {
    if (!vars.has(m[1]!) || !m[1]!.startsWith('--vscode-')) { vars.set(m[1]!, m[2]!.trim()); }
  }
  return vars;
}

/* ── Walking the panels ──────────────────────────────────────────────────── */

/** View files that render no stylesheet of their own. */
const NOT_STYLESHEETS = new Set(['panelNav.ts', 'treeViews.ts', 'chatProtocol.ts']);

/**
 * Files whose CSS is *injected into* skinned panels rather than being a panel:
 * the shell, the shared theme and widgets, and the two partner stylesheets.
 * Their rules resolve against the shared tokens, the way they render.
 */
const SHARED_STYLESHEETS = new Set(['webviewUtils.ts', 'dashboardTheme.ts', 'dashboardWidgets.ts', 'lensVisuals.ts', 'websiteStudioStyles.ts']);

export interface ResolvedRule {
  readonly file: string;
  readonly selector: string;
  readonly body: string;
  /** Resolve a CSS colour expression in this rule's context. */
  readonly resolve: (value: string | undefined) => RGB | null;
  /** The page colour a translucent value composites over. */
  readonly backdrop: RGB;
}

/**
 * Every rule block in every webview stylesheet, under one theme.
 *
 * Each file's *own* rules are walked once, resolving against everything that
 * is injected into the page with it: the shell always, the shared dashboard
 * theme when the panel opts into it, Lens's visuals when it uses them. Shared
 * files are walked once in their own name rather than once per panel, so a
 * shell rule that fails is reported as one failure in the shell.
 */
export function walkPanelRules(root: string, theme: VscodeThemeFixture): ResolvedRule[] {
  const views = path.join(root, 'src', 'views');
  const read = (file: string) => readFileSync(path.join(views, file), 'utf8');
  const shell = read('webviewUtils.ts');
  const shared = read('dashboardTheme.ts') + read('dashboardWidgets.ts');
  const lens = read('lensVisuals.ts');
  const backdrop = composite(parseColour(theme.tokens['--vscode-editor-background']!)!, [0, 0, 0]);
  const absent = new Set(theme.absent);

  const rules: ResolvedRule[] = [];
  for (const file of readdirSync(views).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !NOT_STYLESHEETS.has(f))) {
    const own = read(file);
    const skinned = SHARED_STYLESHEETS.has(file) || own.includes('DASHBOARD_THEME_CSS') || own.includes('dashboardSkin: true');
    const usesLens = file === 'lensVisuals.ts' || own.includes('LENS_BASE_CSS');
    const context = scopeCssToTheme(shell + (skinned ? shared : '') + (usesLens ? lens : '') + own, theme.bodyClasses);
    const resolve = makeColourResolver(collectCustomProperties(context, theme.tokens), backdrop, absent);
    for (const block of scopeCssToTheme(own, theme.bodyClasses).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = block[1]!.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').pop()!.trim().slice(0, 80);
      rules.push({ file: `src/views/${file}`, selector, body: block[2]!, resolve, backdrop });
    }
  }
  return rules;
}

/** The value of the first declaration of `property` in a rule body. */
export function declaration(body: string, property: RegExp): string | undefined {
  return new RegExp(String.raw`(?:^|[\s;])(?:${property.source})\s*:\s*([^;]+)`).exec(body)?.[1]?.trim();
}

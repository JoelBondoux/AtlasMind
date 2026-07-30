import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Project Dashboard's nav tabs must carry their own themed appearance.
 *
 * They stopped doing so in v0.206.0, and the mechanism is worth stating because
 * no diff would have shown it. `.page-nav button` was the first selector of the
 * pill rule it shared with `.action-link`:
 *
 *     .page-nav button,
 *     .action-link { border-radius: 999px; background: …; color: …; padding: … }
 *
 * Adding the GitHub link row *beneath that first line* —
 *
 *     .page-nav button,
 *     .github-link-row { display: flex; flex-wrap: wrap; margin: 0 0 14px }
 *
 * — moved the nav tabs into a container-layout rule and orphaned them from every
 * property that made them look like buttons. With nothing themed left, each
 * unselected tab fell back to the browser's default button appearance: light grey
 * pills on a dark panel. The *selected* tab still looked correct, because
 * `[aria-selected="true"]` declares its own colours — which is exactly why this
 * survived review. One tab looked right, so the nav looked deliberate.
 *
 * A selector migrating between rule blocks is invisible in a diff and invisible
 * in a screenshot of the active tab. So it is asserted here instead.
 */

const source = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

/** The dashboard stylesheet, without comments. */
const css = (() => {
  const start = source.indexOf('const DASHBOARD_CSS = `');
  expect(start, 'DASHBOARD_CSS not found').toBeGreaterThan(-1);
  const body = source.slice(start + 'const DASHBOARD_CSS = `'.length);
  const end = body.indexOf('`;');
  return body.slice(0, end).replace(/\/\*[\s\S]*?\*\//g, '');
})();

/**
 * Declarations of the first rule whose selector list contains `selector`.
 *
 * Selector lists are compared element-wise rather than by substring, so
 * `.page-nav button` cannot be satisfied by `.page-nav button[aria-selected]`.
 */
function declarationsFor(selector: string): string | undefined {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]!.split(',').map(entry => entry.trim());
    if (selectors.includes(selector)) {
      return match[2]!;
    }
  }
  return undefined;
}

describe('the dashboard nav tabs are themed, not left to the browser', () => {
  const decls = declarationsFor('.page-nav button');

  it('has a rule for the nav buttons at all', () => {
    expect(decls, '.page-nav button has no rule of its own').toBeTruthy();
  });

  it.each([
    ['background', /(^|[;\s])background\s*:/],
    ['border', /(^|[;\s])border\s*:/],
    ['color', /(^|[;\s])color\s*:/],
    ['padding', /(^|[;\s])padding\s*:/],
    ['border-radius', /(^|[;\s])border-radius\s*:/],
  ])('declares its own %s, so it never falls back to the UA default', (_name, pattern) => {
    expect(pattern.test(decls ?? '')).toBe(true);
  });

  it('is not sharing a rule with a flex container', () => {
    // The exact shape of the regression: the nav buttons ended up in the rule
    // that lays out `.github-link-row`, inheriting `flex-wrap` and a bottom
    // margin that belong to a row, not to a button in it.
    expect(decls ?? '').not.toMatch(/flex-wrap\s*:/);
    expect(decls ?? '').not.toMatch(/margin\s*:\s*0\s+0\s+14px/);
  });

  it('uses theme variables rather than fixed colours', () => {
    // A hardcoded hex would survive every assertion above and still be wrong in
    // one of the two themes.
    expect(decls ?? '').toMatch(/var\(--/);
    expect(decls ?? '', 'a literal colour would not follow the VS Code theme')
      .not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('the pieces that made the regression invisible still work', () => {
  it('keeps the selected tab visually distinct', () => {
    // This rule is why only one tab looked right, and it must keep doing its
    // job — selection is also carried by weight, a ring and an underline, so it
    // does not depend on colour alone.
    const selected = declarationsFor('.page-nav button[aria-selected="true"]');
    expect(selected, 'the active tab has no rule').toBeTruthy();
    expect(selected ?? '').toMatch(/background\s*:/);
    expect(selected ?? '').toMatch(/font-weight\s*:/);
  });

  it('leaves the GitHub link row laid out as a row', () => {
    // The fix must not have solved the buttons by breaking what displaced them.
    const row = declarationsFor('.github-link-row');
    expect(row, '.github-link-row lost its rule').toBeTruthy();
    expect(row ?? '').toMatch(/display\s*:\s*flex/);
    expect(row ?? '').toMatch(/flex-wrap\s*:\s*wrap/);
  });

  it('still shares the pill with .action-link, which is the point of the list', () => {
    const decls = declarationsFor('.page-nav button');
    const shared = declarationsFor('.action-link');
    expect(shared, '.action-link lost its rule').toBeTruthy();
    // Same block: one pill definition, not two that can drift apart.
    expect(shared).toBe(decls);
  });
});

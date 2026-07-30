import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Project State tree is a glance surface: every row exists so somebody can
 * see something and then go and deal with it. A row without a link is a row that
 * shows you a problem and leaves you to find it, and a row whose link points at
 * where the content *used to be* is worse — it looks like it worked.
 *
 * All three happened. `deferred.debt` and `position.complete` had no command at
 * all, `permissions.level` opened a Settings panel that does not render the
 * automation settings, and `attention.ci` — the most actionable row in the tree —
 * pointed at the Workflow page after the failure detail moved to Pipeline in
 * v0.188.0.
 */

const TREE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'projectStateTree.ts'),
  'utf8',
);

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

/** Dashboard page ids the panel will actually render. */
function pageIds(): Set<string> {
  const start = PANEL.indexOf('const DASHBOARD_PAGE_IDS = [');
  expect(start, 'DASHBOARD_PAGE_IDS is missing').toBeGreaterThan(-1);
  const end = PANEL.indexOf('] as const;', start);
  return new Set([...PANEL.slice(start, end).matchAll(/'([^']+)'/g)].map(match => match[1]!));
}

/** Every `openProjectDashboard` target the tree links to. */
function linkedPages(): string[] {
  return [...TREE.matchAll(/'atlasmind\.openProjectDashboard'[^}]*?args: \['([^']+)'\]/g)]
    .map(match => match[1]!);
}

/** Node ids, and whether each carries a command. */
function nodes(): Array<{ id: string; hasCommand: boolean }> {
  const out: Array<{ id: string; hasCommand: boolean }> = [];
  const pattern = /id: '([^']+)',([\s\S]*?)(?=\n\s{4,6}id: '|\n\s{2}\}\)|\n\s{2}return \{|$)/g;
  for (const match of TREE.matchAll(pattern)) {
    out.push({ id: match[1]!, hasCommand: match[2]!.includes('command:') });
  }
  return out;
}

/**
 * One node's source, bounded by the next `nodes.push` rather than a character
 * count — a fixed window silently misses the command on any node with a long
 * tooltip, which is most of the interesting ones.
 */
function nodeSource(id: string): string {
  const start = TREE.indexOf(`id: '${id}'`);
  expect(start, `${id} is missing from the tree`).toBeGreaterThan(-1);
  const end = TREE.indexOf('nodes.push(', start);
  return TREE.slice(start, end === -1 ? undefined : end);
}

describe('every dashboard link points at a page that exists', () => {
  it('names only real page ids', () => {
    // A link to a page id the panel does not know coerces back to `overview`,
    // so the row silently opens the wrong thing.
    const known = pageIds();
    const bad = [...new Set(linkedPages())].filter(page => !known.has(page));
    expect(bad, `unknown pages: ${bad.join(', ')}`).toEqual([]);
  });

  it('found some, so it is not comparing two empty sets', () => {
    expect(linkedPages().length).toBeGreaterThan(4);
  });

  it('sends the CI failure to Pipeline, where the evidence is', () => {
    // It pointed at Workflow until v0.201.2. The classified failure and its
    // evidence lines moved to Pipeline in v0.188.0 and this did not follow.
    expect(nodeSource('attention.ci')).toContain("args: ['pipeline']");
  });

  it('sends deferred debt to the Tech Debt page, which now exists', () => {
    expect(nodeSource('deferred.debt')).toContain("args: ['debt']");
  });
});

describe('the automation row opens the settings it describes', () => {
  it('filters VS Code settings rather than opening a panel that omits them', () => {
    // The Settings panel does not render `atlasmind.workflow.*` at all, so
    // opening it showed nothing — the same wrong destination as the Workflow
    // page's own button before v0.199.0.
    expect(nodeSource('permissions.level')).toContain("'workbench.action.openSettings'");
    expect(nodeSource('permissions.level')).toContain("args: ['atlasmind.workflow']");
  });
});

describe('rows that show a problem link to it', () => {
  it('leaves no actionable row without somewhere to go', () => {
    // The two exceptions are deliberate: a section header expands on click, and
    // a row saying nothing is wrong has nothing to open.
    const headers = new Set(['permissions', 'position', 'attention', 'deferred', 'promote']);
    const nothingWrong = new Set(['attention.clear']);
    const orphans = nodes()
      .filter(node => !node.hasCommand)
      .filter(node => !headers.has(node.id) && !nothingWrong.has(node.id))
      .map(node => node.id);
    expect(orphans, `no link: ${orphans.join(', ')}`).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A tree row that names a command nobody registered does nothing, says nothing,
 * and looks exactly like a row that works.
 *
 * This is the most-repeated bug in this codebase's history. The dashboard's
 * "Change the project shape" button was dead because `atlasmind.openSettings` was
 * missing from an allowlist and blocked commands were silently dropped (v0.199.0).
 * Four Project State rows were missing or stale, including the CI-failure row
 * pointing at a page whose content had moved (v0.202.0). Both got a guard
 * afterwards, and both guards cover exactly one surface.
 *
 * `treeViews.ts` attaches commands to twelve kinds of row across nine trees with
 * no guard at all. This is that guard. It reads source text rather than
 * instantiating the trees, because the failure being caught is a *name* that does
 * not resolve — which is visible in the text and would require every tree's full
 * data dependencies to reproduce at runtime.
 */

const ROOT = process.cwd();

function readSource(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), 'utf8');
}

const MANIFEST = JSON.parse(readSource('package.json')) as {
  contributes?: { commands?: Array<{ command: string }>; views?: Record<string, Array<{ id: string }>> };
};

const EXTENSION = readSource('src', 'extension.ts');

/** Every source file that can attach a command to a tree row. */
const TREE_SOURCES = [
  'src/views/treeViews.ts',
  'src/core/projectStateTree.ts',
  'src/views/specialistIntegrationsPanel.ts',
] as const;

/**
 * Commands registered by AtlasMind, from the two places a registration can live.
 *
 * The manifest is the declaration users see in the palette; `registerCommand` is
 * what actually makes a name callable. A tree may legitimately link to a command
 * that is registered but *not* in the manifest — several internal ones are — so
 * the union is the right set to check membership against.
 */
function registeredCommands(): Set<string> {
  const declared = (MANIFEST.contributes?.commands ?? []).map(entry => entry.command);
  const registered = [...EXTENSION.matchAll(/registerCommand\(\s*'([^']+)'/g)].map(match => match[1]!);
  // Some registrations are built from a list rather than written out; pick up
  // any bare `atlasmind.*` string literal in the activation file as a fallback.
  const mentioned = [...EXTENSION.matchAll(/'(atlasmind\.[A-Za-z0-9_.]+)'/g)].map(match => match[1]!);
  return new Set([...declared, ...registered, ...mentioned]);
}

/**
 * Command ids a tree source hands to VS Code, with the line they sit on.
 *
 * Matches `command: '<id>'` — the shape every tree row uses, whether written as
 * `this.command = { command: '…' }`, `item.command = { command: '…' }` or a
 * one-line object literal.
 */
function attachedCommands(source: string): Array<{ id: string; line: number }> {
  const found: Array<{ id: string; line: number }> = [];
  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/\bcommand:\s*'(atlasmind\.[^']+)'/g)) {
      found.push({ id: match[1]!, line: index + 1 });
    }
  }
  return found;
}

describe('every command a tree row names is a command that exists', () => {
  const known = registeredCommands();

  it('found the registrations, or this whole file proves nothing', () => {
    // A guard that silently matched zero commands would pass forever.
    expect(known.size).toBeGreaterThan(50);
    expect(known.has('atlasmind.openProjectDashboard')).toBe(true);
  });

  for (const file of TREE_SOURCES) {
    it(`resolves every command in ${file}`, () => {
      const source = readSource(...file.split('/'));
      const attached = attachedCommands(source);
      // Each of these files really does attach commands; a regex that stopped
      // matching would otherwise read as "nothing broken".
      expect(attached.length, `${file} attached no commands — the pattern has drifted`).toBeGreaterThan(0);

      const unresolved = attached.filter(entry => !known.has(entry.id));
      expect(
        unresolved.map(entry => `${file}:${entry.line} → ${entry.id}`),
        'these rows would do nothing when clicked',
      ).toEqual([]);
    });
  }

  it('covers every source that attaches one, so a new tree cannot escape the guard', () => {
    // The guard is only as good as its file list, and a file list is exactly the
    // thing that goes stale. Anything outside `TREE_SOURCES` naming a tree
    // command has to be added here deliberately.
    const candidates = ['src/views/treeViews.ts', 'src/core/projectStateTree.ts'];
    for (const file of candidates) {
      expect(TREE_SOURCES as readonly string[]).toContain(file);
    }
  });
});

describe('a tree row that opens a dashboard page names a page that exists', () => {
  const PANEL = readSource('src', 'views', 'projectDashboardPanel.ts');

  function pageIds(): Set<string> {
    const start = PANEL.indexOf('const DASHBOARD_PAGE_IDS = [');
    expect(start, 'DASHBOARD_PAGE_IDS is missing').toBeGreaterThan(-1);
    const end = PANEL.indexOf('] as const;', start);
    return new Set([...PANEL.slice(start, end).matchAll(/'([^']+)'/g)].map(match => match[1]!));
  }

  it('resolves every page argument across all tree sources', () => {
    // `projectStateLinks` already checks this for one tree. The same mistake is
    // available to the other nine, and it is the worse kind: a link to where
    // content used to be looks like it worked.
    const pages = pageIds();
    const bad: string[] = [];
    for (const file of TREE_SOURCES) {
      const source = readSource(...file.split('/'));
      const lines = source.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        // Arguments may sit on the same line or the next one.
        const window = `${line}\n${lines[index + 1] ?? ''}\n${lines[index + 2] ?? ''}`;
        if (!window.includes("'atlasmind.openProjectDashboard'")) {
          continue;
        }
        for (const match of window.matchAll(/arguments:\s*\[\s*'([^']+)'/g)) {
          if (!pages.has(match[1]!)) {
            bad.push(`${file}:${index + 1} → '${match[1]}'`);
          }
        }
      }
    }
    expect(bad, 'these rows open a dashboard page that does not exist').toEqual([]);
  });
});

/**
 * The five-slot titlebar cap is *not* here — `packageManifest.test.ts` already
 * owns it, and correctly: it counts only the `navigation` group, because that is
 * the group VS Code renders inline. Other groups (`4_config` and friends) live in
 * the overflow menu by design, so counting them would fail a manifest that is
 * right. Two versions of one rule is how the weaker one ends up load-bearing.
 *
 * What is missing there is registration, so that is what this adds.
 */
describe('a titlebar button names a command that exists', () => {
  const VIEW_TITLE = (MANIFEST as { contributes?: { menus?: Record<string, Array<{ command: string; when?: string; group?: string }>> } })
    .contributes?.menus?.['view/title'] ?? [];

  it('found the titlebar entries', () => {
    expect(VIEW_TITLE.length).toBeGreaterThan(10);
  });

  it('names only registered commands', () => {
    const known = registeredCommands();
    const unresolved = VIEW_TITLE.filter(entry => !known.has(entry.command)).map(entry => entry.command);
    expect(unresolved, 'these titlebar buttons would do nothing').toEqual([]);
  });

  it('points every titlebar entry at a view that is contributed', () => {
    // A `when` clause naming a view id that does not exist is a button that
    // renders nowhere — invisible rather than dead, and so never noticed.
    const views = new Set(
      Object.values(MANIFEST.contributes?.views ?? {}).flat().map(view => view.id),
    );
    expect(views.size).toBeGreaterThan(5);
    const orphaned = VIEW_TITLE
      .map(entry => /view == ([\w.]+)/.exec(entry.when ?? '')?.[1])
      .filter((view): view is string => Boolean(view))
      .filter(view => !views.has(view));
    expect([...new Set(orphaned)], 'these titlebar entries target no contributed view').toEqual([]);
  });
});

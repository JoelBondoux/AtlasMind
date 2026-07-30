import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The top-right shortcuts on every dashboard: do they point somewhere real, and
 * is anything actually listening?
 *
 * Checked by hand once and worth keeping, because both halves fail silently. A
 * button whose command does not exist and a button with no listener are
 * indistinguishable from a working one until somebody clicks it — and a webview
 * that posts a message the host does not allowlist is silently ignored by
 * design, which is correct security behaviour and an invisible bug when the
 * allowlist is simply missing an entry.
 *
 * The manual pass produced two false positives worth recording, because the
 * naive versions of these checks reproduce them: `workbench.view.scm` is a
 * built-in VS Code command rather than a missing AtlasMind one, and Mission
 * Control wires its button through a `$('id')` helper rather than a literal
 * `getElementById('id')`.
 */

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

const manifest = JSON.parse(read('package.json')) as {
  contributes?: { commands?: Array<{ command: string }> };
};

/** Commands the manifest declares, plus every command registered in source. */
const knownCommands = (() => {
  const declared = new Set((manifest.contributes?.commands ?? []).map(entry => entry.command));
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => (
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
      : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []
    ));
  for (const file of walk('src')) {
    for (const match of read(file).matchAll(/registerCommand\(\s*'([^']+)'/g)) {
      declared.add(match[1]!);
    }
  }
  return declared;
})();

/** Not ours to declare. A built-in is not a missing command. */
const isBuiltInCommand = (command: string) => /^(workbench|vscode|editor|git|extension)\./.test(command);

const PANELS: Array<{ name: string; panel: string; media?: string }> = [
  { name: 'Project Dashboard', panel: 'src/views/projectDashboardPanel.ts', media: 'media/projectDashboard.js' },
  { name: 'Project Ideation', panel: 'src/views/projectIdeationPanel.ts', media: 'media/projectIdeation.js' },
  { name: 'Project Run Center', panel: 'src/views/projectRunCenterPanel.ts' },
  { name: 'Cost Dashboard', panel: 'src/views/costDashboardPanel.ts' },
  { name: 'Mission Control', panel: 'src/views/missionControlPanel.ts' },
  { name: 'Personality Profile', panel: 'src/views/personalityProfilePanel.ts' },
];

/** Buttons sitting in a header action group, with their element id if they have one. */
function headerButtons(panelSource: string): Array<{ id?: string; label: string }> {
  const groups = [...panelSource.matchAll(
    /<div class="[a-z-]*(?:actions|topbar-actions)"[^>]*>([\s\S]*?)<\/div>/g,
  )];
  return groups.flatMap(group => [...group[1]!.matchAll(/<button[\s\S]*?<\/button>/g)].map(match => {
    const id = /id="([^"]+)"/.exec(match[0])?.[1];
    const label = /<button[^>]*>([\s\S]*?)<\/button>/.exec(match[0])?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';
    return id ? { id, label } : { label };
  }));
}

describe('every dashboard shortcut has something listening', () => {
  it.each(PANELS)('$name', ({ panel, media }) => {
    const source = read(panel) + '\n' + (media && existsSync(path.join(root, media)) ? read(media) : '');
    const unwired: string[] = [];
    for (const button of headerButtons(read(panel))) {
      if (!button.id) {
        continue; // Delegated via data-action; covered by the command check below.
      }
      // Both spellings: a literal lookup, and the `$('id')` helper Mission
      // Control uses — which a naive check reports as dead.
      const wired = source.includes(`getElementById('${button.id}')`)
        || source.includes(`getElementById("${button.id}")`)
        || source.includes(`$('${button.id}')`)
        || source.includes(`$("${button.id}")`);
      if (!wired) {
        unwired.push(`${button.id} (${button.label})`);
      }
    }
    expect(unwired, 'header buttons with no listener').toEqual([]);
  });
});

describe('every dashboard shortcut points at a command that exists', () => {
  it.each([
    { name: 'Project Dashboard', file: 'media/projectDashboard.js' },
    { name: 'Project Ideation', file: 'media/projectIdeation.js' },
  ])('$name', ({ file }) => {
    const source = read(file);
    const targets = new Set<string>();
    for (const match of source.matchAll(/data-action="command" data-payload="([A-Za-z][\w.]+)"/g)) {
      targets.add(match[1]!);
    }
    for (const match of source.matchAll(/type: 'openCommand', payload: '([A-Za-z][\w.]+)'/g)) {
      targets.add(match[1]!);
    }
    const missing = [...targets].filter(command => !isBuiltInCommand(command) && !knownCommands.has(command));
    expect(missing, 'these shortcuts name a command that does not exist').toEqual([]);
    expect(targets.size, 'no shortcuts found — the extraction has drifted').toBeGreaterThan(0);
  });
});

describe('a webview shortcut is not silently swallowed by its own allowlist', () => {
  /**
   * Both panels gate `openCommand` behind an allowlist, which is right — a
   * webview must not choose what the host runs. But a command offered in the UI
   * and absent from the list produces a button that posts a message into
   * nothing, with no error anywhere.
   */
  it.each([
    {
      name: 'Project Dashboard',
      panel: 'src/views/projectDashboardPanel.ts',
      media: 'media/projectDashboard.js',
      constant: 'ALLOWED_DASHBOARD_COMMANDS',
    },
    {
      name: 'Project Ideation',
      panel: 'src/views/projectIdeationPanel.ts',
      media: 'media/projectIdeation.js',
      constant: 'ALLOWED_IDEATION_COMMANDS',
    },
  ])('$name', ({ panel, media, constant }) => {
    const block = new RegExp(`const ${constant} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(read(panel))?.[1] ?? '';
    expect(block, `${constant} not found`).not.toBe('');
    const allowed = new Set([...block.matchAll(/'([^']+)'/g)].map(match => match[1]!));

    const source = read(media);
    const offered = new Set<string>();
    for (const match of source.matchAll(/data-action="command" data-payload="([A-Za-z][\w.]+)"/g)) {
      offered.add(match[1]!);
    }
    for (const match of source.matchAll(/type: 'openCommand', payload: '([A-Za-z][\w.]+)'/g)) {
      offered.add(match[1]!);
    }

    const blocked = [...offered].filter(command => !allowed.has(command));
    expect(blocked, 'offered in the UI but not allowlisted — clicking does nothing').toEqual([]);
  });
});

describe('the ideation workspace guide sits above the canvas it describes', () => {
  /**
   * It used to render last — below the composer, inspector, feedback and
   * analytics — so the explanation of the staged workflow was the final thing
   * reached by somebody who had already had to work the board out unaided.
   */
  it('renders the process guide immediately before the board', () => {
    const source = read('media/projectIdeation.js');
    const order = [...source.matchAll(/'<section class="(ideation-[a-z-]+)"/g)].map(match => match[1]!);
    const guide = order.indexOf('ideation-process-section');
    const board = order.indexOf('ideation-main-grid');
    expect(guide, 'process section not rendered').toBeGreaterThan(-1);
    expect(board, 'board section not rendered').toBeGreaterThan(-1);
    expect(guide, 'the guide must come before the canvas').toBeLessThan(board);
    expect(board - guide, 'the guide must sit immediately above the canvas').toBe(1);
  });

  it('still opens itself only on an empty board', () => {
    // Auto-opening on a populated board would push the canvas down the page
    // every time; on an empty one, reading it first is the useful order.
    expect(read('media/projectIdeation.js')).toContain("(boardIsEmpty ? ' open' : '')");
  });
});

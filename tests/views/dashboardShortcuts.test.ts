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

describe('the ideation stage bar is the guide, not a description of one', () => {
  /**
   * The guide has been relocated twice — to the bottom in v0.119.0, back above
   * the canvas in v0.212.1 — on the theory that placement was the problem. It
   * was not. A guide that has to explain the layout is a symptom of the layout,
   * and four cards describing an order the interface did not impose were only
   * ever going to be read once.
   */
  it('renders the stage bar between the board and the stage it selects', () => {
    const source = read('media/projectIdeation.js');
    const order = [...source.matchAll(/'<section class="(ideation-[a-z-]+)"/g)].map(match => match[1]!);
    const board = order.indexOf('ideation-main-grid');
    const bar = order.indexOf('ideation-mode-section');
    const stage = order.indexOf('ideation-stage-section');
    expect(board, 'board section not rendered').toBeGreaterThan(-1);
    expect(bar, 'stage bar not rendered').toBeGreaterThan(-1);
    expect(stage, 'stage section not rendered').toBeGreaterThan(-1);
    // The board still leads; the bar sits directly above the thing it switches.
    expect(board).toBeLessThan(bar);
    expect(stage - bar, 'the bar must sit immediately above the stage it selects').toBe(1);
  });

  it('has no collapsible guide panel left to relocate', () => {
    const source = read('media/projectIdeation.js');
    expect(source).not.toContain('ideation-process-details');
    expect(source).not.toContain("(boardIsEmpty ? ' open' : '')");
  });

  it('makes every stage a control, and reports where the board actually is', () => {
    const source = read('media/projectIdeation.js');
    for (const mode of ['frame', 'scaffold', 'shape', 'decide']) {
      expect(source, `${mode} is not a stage`).toContain(`id: '${mode}'`);
    }
    // The status dot describes the board, not the tab you happen to be reading,
    // so the bar stays honest while you look ahead.
    expect(source).toContain('function deriveModeStatus(');
  });
});

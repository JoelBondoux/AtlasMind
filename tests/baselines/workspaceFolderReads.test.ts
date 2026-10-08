import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Direct reads of `vscode.workspace.workspaceFolders`, ratcheted per file.
 *
 * AtlasMind was single-root by construction: every surface took
 * `workspaceFolders?.[0]` for itself, so "which folder does this mean?" had as
 * many answers as there were places asking. `src/utils/workspaceRoots.ts` is
 * now where that question is asked, and `docs/project-composition.md` §8 says
 * call sites migrate to it **by consequence, not by count** — a mechanical
 * rewrite of every `[0]` is an explicit non-goal, because it would be
 * unreviewable and would land its bugs everywhere at once.
 *
 * That leaves a long tail of direct reads that are allowed to stay, and the
 * failure mode worth guarding against is the tail *growing*: the census was
 * 130 at v0.213.0 and over 230 when the adapter arrived. So this is the same
 * two-way ratchet `testTypecheck.test.ts` uses, per file rather than in total
 * (ESLint cannot ratchet per file):
 *
 * - a file whose count **rises** fails, and the message names the file;
 * - a file whose count **falls** fails until its ceiling is lowered, so a
 *   migration is recorded in review rather than leaving headroom for the next
 *   direct read to slip in unnoticed;
 * - a file **not listed** must have none — a new surface asks the adapter;
 * - `src/core/**` must have none unless its entry carries a written `reason`,
 *   because a core service reading the host's folders is no longer pure.
 *
 * Two counts per file: every read, and the reads that take `[0]` on the spot.
 * The second is the one the composition model cares about; the first stops a
 * `[0]` being laundered through a local (`const folders = …; folders[0]`).
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface ReadCount {
  /** Every read of the folder list. */
  total: number;
  /** Reads that take the first folder on the spot. */
  first: number;
}

interface ReadCeiling extends ReadCount {
  /** Required for `src/core/**` and for the adapter: why this file may read. */
  reason?: string;
}

/**
 * Lower an entry after migrating a read; remove it at zero. Never raise one —
 * a rise means a new direct read, and it belongs in the adapter instead.
 */
const WORKSPACE_FOLDER_READ_CEILINGS: Readonly<Record<string, ReadCeiling>> = {
  'src/utils/workspaceRoots.ts': {
    total: 1,
    first: 0,
    reason: 'The adapter itself: the one sanctioned reader. The `[0]` rule lives in core/workspaceScope.ts, not here.',
  },
  'src/chat/imageAttachments.ts': { total: 2, first: 2 },
  'src/chat/participant.ts': { total: 15, first: 14 },
  'src/commands.ts': { total: 9, first: 8 },
  'src/extension.ts': { total: 10, first: 9 },
  'src/mcp/mcpClient.ts': { total: 2, first: 2 },
  'src/utils/workspacePicker.ts': { total: 1, first: 0 },
  'src/views/agentManagerPanel.ts': { total: 2, first: 1 },
  'src/views/chatPanel.ts': { total: 13, first: 13 },
  'src/views/codebaseIndexCommands.ts': { total: 1, first: 1 },
  'src/views/commitMessageCommand.ts': { total: 1, first: 1 },
  'src/views/lensChangeStoryCommand.ts': { total: 1, first: 0 },
  'src/views/lensChangeStoryPanel.ts': { total: 1, first: 0 },
  'src/views/lensConfigCommand.ts': { total: 1, first: 0 },
  'src/views/lensConfigPanel.ts': { total: 1, first: 0 },
  'src/views/lensContractReviewCommand.ts': { total: 2, first: 0 },
  'src/views/lensContractReviewPanel.ts': { total: 1, first: 0 },
  'src/views/lensCredentialCommand.ts': { total: 2, first: 2 },
  'src/views/lensDashboardPanel.ts': { total: 1, first: 1 },
  'src/views/lensDeclarationGuidePanel.ts': { total: 2, first: 2 },
  'src/views/lensDeclarationSetup.ts': { total: 1, first: 0 },
  'src/views/lensImpactPanel.ts': { total: 1, first: 0 },
  'src/views/lensJourneyPanel.ts': { total: 1, first: 0 },
  'src/views/lensLiveCommand.ts': { total: 2, first: 1 },
  'src/views/lensLivePanel.ts': { total: 1, first: 0 },
  'src/views/lensStateCommand.ts': { total: 1, first: 0 },
  'src/views/lensStatePanel.ts': { total: 1, first: 0 },
  'src/views/lensTestPanel.ts': { total: 1, first: 0 },
  'src/views/mcpPanel.ts': { total: 2, first: 2 },
  'src/views/modelProviderPanel.ts': { total: 2, first: 2 },
  'src/views/personalityProfilePanel.ts': { total: 1, first: 1 },
  'src/views/portalPublishCommand.ts': { total: 1, first: 1 },
  'src/views/projectDashboardPanel.ts': { total: 73, first: 72 },
  'src/views/projectIdeationPanel.ts': { total: 12, first: 12 },
  'src/views/projectRunCenterPanel.ts': { total: 2, first: 2 },
  'src/views/reviewedPrLocalCiCommands.ts': { total: 1, first: 0 },
  'src/views/settingsPanel.ts': { total: 14, first: 14 },
  'src/views/treeViews.ts': { total: 3, first: 3 },
  'src/views/visionPanel.ts': { total: 2, first: 2 },
  'src/views/websitePreviewHost.ts': { total: 2, first: 2 },
  'src/views/websiteReviewHost.ts': { total: 2, first: 2 },
  'src/views/websiteStackSetupHost.ts': { total: 1, first: 1 },
  'src/views/websiteStudioPanel.ts': { total: 3, first: 3 },
};

/**
 * Remove comments, keeping strings and newlines, so prose that *mentions* the
 * API is not counted as a read of it.
 *
 * A small scanner rather than a regex, because "is this `//` inside a string"
 * is not a regular question. It does not parse regular-expression literals; a
 * literal containing an unescaped quote or `//` can blank the rest of its own
 * line. That costs nothing here: the counts are calibrated by this same
 * scanner, so a misreading is consistent rather than drifting, and no line in
 * `src/` puts a folder read after a regex literal.
 */
function stripComments(text: string): string {
  let out = '';
  let state: 'code' | 'single' | 'double' | 'template' = 'code';
  // Open `${` and `{` inside template expressions, so a closing brace knows
  // whether it returns to the template or stays in code.
  const braces: Array<'template' | 'block'> = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') {
        while (i < text.length && text[i] !== '\n') {
          i += 1;
        }
        continue;
      }
      if (c === '/' && next === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
          if (text[i] === '\n') {
            out += '\n';
          }
          i += 1;
        }
        i += 2;
        continue;
      }
      if (c === '\'') {
        state = 'single';
      } else if (c === '"') {
        state = 'double';
      } else if (c === '`') {
        state = 'template';
      } else if (c === '{' && braces.length > 0) {
        braces.push('block');
      } else if (c === '}' && braces.length > 0 && braces.pop() === 'template') {
        state = 'template';
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === '\\') {
      out += c + (next ?? '');
      i += 2;
      continue;
    }
    if (state === 'template' && c === '$' && next === '{') {
      out += '${';
      braces.push('template');
      state = 'code';
      i += 2;
      continue;
    }
    if (
      (state === 'single' && (c === '\'' || c === '\n'))
      || (state === 'double' && (c === '"' || c === '\n'))
      || (state === 'template' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

/** `vscode.workspace.workspaceFolders`, or `workspace.workspaceFolders` off a named import. */
const READ = /\bworkspace\s*\??\.\s*workspaceFolders\b/g;
/** `const { workspaceFolders } = vscode.workspace` — the same read, spelled differently. */
const DESTRUCTURED = /\{[^{}]*\bworkspaceFolders\b[^{}]*\}\s*=\s*(?:vscode\s*\.\s*)?workspace\b/g;
/** A read that takes the first folder on the spot: `[0]`, `?.[0]`, `![0]`. */
const FIRST = /\bworkspace\s*\??\.\s*workspaceFolders\s*!?\s*(?:\?\.)?\s*\[\s*0\s*\]/g;

function countWorkspaceFolderReads(text: string): ReadCount {
  const code = stripComments(text);
  return {
    total: (code.match(READ)?.length ?? 0) + (code.match(DESTRUCTURED)?.length ?? 0),
    first: code.match(FIRST)?.length ?? 0,
  };
}

interface SourceFile {
  /** Repository-relative, forward slashes. */
  path: string;
  text: string;
}

/** What is wrong with the census against the ceilings; empty when it holds. */
function auditWorkspaceFolderReads(
  files: readonly SourceFile[],
  ceilings: Readonly<Record<string, ReadCeiling>>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    seen.add(file.path);
    const count = countWorkspaceFolderReads(file.text);
    const ceiling = ceilings[file.path];
    if (!ceiling) {
      if (count.total > 0) {
        problems.push(
          `${file.path}: ${count.total} direct workspaceFolders read(s) in a file with no ceiling. `
          + 'Ask src/utils/workspaceRoots.ts instead (defaultWorkspaceRootPath / defaultWorkspaceFolder / resolveScope).',
        );
      }
      continue;
    }
    if (file.path.startsWith('src/core/') && !ceiling.reason?.trim()) {
      problems.push(`${file.path}: a core module may read the host's folders only with a written reason; inject the root instead.`);
    }
    for (const key of ['total', 'first'] as const) {
      if (count[key] > ceiling[key]) {
        problems.push(`${file.path}: ${key} reads rose to ${count[key]} (ceiling ${ceiling[key]}). Route the new read through src/utils/workspaceRoots.ts.`);
      } else if (count[key] < ceiling[key]) {
        problems.push(`${file.path}: ${key} reads fell to ${count[key]} — lower its ${key} ceiling from ${ceiling[key]} to ${count[key]}${count.total === 0 ? ' (or remove the entry)' : ''}.`);
      }
    }
  }
  for (const listed of Object.keys(ceilings)) {
    if (!seen.has(listed)) {
      problems.push(`${listed}: listed with a ceiling but no longer exists — remove the entry.`);
    }
  }
  return problems;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles: SourceFile[] = walk(path.join(REPO_ROOT, 'src')).map(full => ({
  path: path.relative(REPO_ROOT, full).split(path.sep).join('/'),
  text: readFileSync(full, 'utf8'),
}));

describe('direct reads of vscode.workspace.workspaceFolders are ratcheted per file', () => {
  it('holds every ceiling exactly — no new reads, and no migrated read left as headroom', () => {
    const problems = auditWorkspaceFolderReads(sourceFiles, WORKSPACE_FOLDER_READ_CEILINGS);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('keeps src/core free of host folder reads', () => {
    const coreReaders = sourceFiles
      .filter(file => file.path.startsWith('src/core/'))
      .filter(file => countWorkspaceFolderReads(file.text).total > 0)
      .map(file => file.path);
    const unexplained = coreReaders.filter(file => !WORKSPACE_FOLDER_READ_CEILINGS[file]?.reason?.trim());
    expect(unexplained).toEqual([]);
  });

  it('leaves the adapter as a pure pass-through: the [0] rule lives in core/workspaceScope.ts', () => {
    const adapter = sourceFiles.find(file => file.path === 'src/utils/workspaceRoots.ts');
    expect(adapter).toBeDefined();
    expect(countWorkspaceFolderReads(adapter!.text)).toEqual({ total: 1, first: 0 });
    expect(adapter!.text).toContain('defaultWorkspaceFolderOf');
  });

  /**
   * A scanner that stops matching turns this file green for the worst reason.
   * The tail is long today; an empty census is a broken regex long before it
   * is a finished migration.
   */
  it('found something to measure, rather than passing because the scan is broken', () => {
    const totals = sourceFiles.map(file => countWorkspaceFolderReads(file.text));
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(totals.reduce((sum, count) => sum + count.total, 0)).toBeGreaterThan(100);
    expect(totals.reduce((sum, count) => sum + count.first, 0)).toBeGreaterThan(100);
  });
});

describe('the guard catches what it exists to catch', () => {
  const read = 'const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;\n';

  it('fails a new file that reads the folders directly', () => {
    const problems = auditWorkspaceFolderReads([{ path: 'src/views/newSurface.ts', text: read }], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('src/views/newSurface.ts');
    expect(problems[0]).toContain('workspaceRoots.ts');
  });

  it('fails a listed file whose count rose, and one whose count fell without its ceiling being lowered', () => {
    const rose = auditWorkspaceFolderReads([{ path: 'src/views/a.ts', text: read + read }], { 'src/views/a.ts': { total: 1, first: 1 } });
    expect(rose.join('\n')).toMatch(/rose to 2/);
    const fell = auditWorkspaceFolderReads([{ path: 'src/views/a.ts', text: 'const x = 1;\n' }], { 'src/views/a.ts': { total: 1, first: 1 } });
    expect(fell.join('\n')).toMatch(/fell to 0/);
  });

  it('refuses a core module read without a written reason, and a ceiling for a file that no longer exists', () => {
    const core = auditWorkspaceFolderReads([{ path: 'src/core/service.ts', text: read }], { 'src/core/service.ts': { total: 1, first: 1 } });
    expect(core.join('\n')).toMatch(/written reason/);
    const gone = auditWorkspaceFolderReads([], { 'src/views/deleted.ts': { total: 1, first: 1 } });
    expect(gone.join('\n')).toMatch(/no longer exists/);
  });

  it('counts the spellings of a read, and ignores comments that only mention one', () => {
    expect(countWorkspaceFolderReads([
      'const a = vscode.workspace.workspaceFolders?.[0];',
      'const b = vscode.workspace.workspaceFolders![0];',
      'const c = workspace.workspaceFolders[0];',
      'const { workspaceFolders } = vscode.workspace;',
      'const d = vscode.workspace.workspaceFolders ?? [];',
      '// vscode.workspace.workspaceFolders?.[0] in a line comment',
      '/** vscode.workspace.workspaceFolders?.[0] in a doc comment */',
      'const url = "https://example.test/vscode.workspace";',
    ].join('\n'))).toEqual({ total: 5, first: 3 });
  });

  it('reads code inside a template expression, and not a comment marker inside a string', () => {
    expect(countWorkspaceFolderReads('const s = `name: ${vscode.workspace.workspaceFolders?.[0]?.name}`;')).toEqual({ total: 1, first: 1 });
    expect(countWorkspaceFolderReads('const s = "//"; const r = vscode.workspace.workspaceFolders?.[0];')).toEqual({ total: 1, first: 1 });
  });
});

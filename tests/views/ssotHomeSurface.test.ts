import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Locating the SSOT home in a multi-root workspace (slice A2) only matters if
 * the surfaces that read and write project memory actually ask for it — and if
 * the one thing a person can do about an ambiguous home, which is read why, is
 * on the screen. Neither is visible to the type checker, so both are asserted
 * against the real sources here.
 */

const read = (...segments: string[]): string => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

const WEBVIEW_SCRIPT = read('media', 'projectDashboard.js');
const DASHBOARD = read('src', 'views', 'projectDashboardPanel.ts');
const PARTICIPANT = read('src', 'chat', 'participant.ts');
const EXTENSION = read('src', 'extension.ts');

/** A named function's source, from its declaration to the next function at the same indent. */
function functionSource(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const next = source.indexOf(`\n${indent}function `, start + signature.length);
  const nextAsync = source.indexOf(`\n${indent}async function `, start + signature.length);
  const ends = [next, nextAsync].filter(index => index > -1);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const escapeHtml = (value: unknown): string => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** The webview's banner function, evaluated with the page's own escaping contract. */
function loadNotice(): (snapshot: unknown) => string {
  const source = functionSource(WEBVIEW_SCRIPT, 'function renderSsotHomeNotice(snapshot)');
  return new Function('escapeHtml', `${source}\nreturn renderSsotHomeNotice;`)(escapeHtml) as (snapshot: unknown) => string;
}

describe('the dashboard banner for an ambiguous SSOT home', () => {
  it('renders on every page, directly under the connection banner', () => {
    const render = functionSource(WEBVIEW_SCRIPT, 'function render()');
    const host = render.indexOf('${renderHostConnectionBanner()}');
    const notice = render.indexOf('${renderSsotHomeNotice(snapshot)}');
    const overview = render.indexOf('${renderOverview(snapshot)}');
    expect(host).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(host);
    expect(overview).toBeGreaterThan(notice);
  });

  it('is absent when the home is located, and names every candidate when it is not', () => {
    const renderNotice = loadNotice();
    expect(renderNotice({ ssotHome: { rule: 'single-root', homeName: 'app', candidates: ['app'] } })).toBe('');
    expect(renderNotice({ ssotHome: { rule: 'sole-ssot', homeName: 'game', candidates: ['game'] } })).toBe('');
    expect(renderNotice({})).toBe('');

    const html = renderNotice({
      ssotHome: {
        rule: 'ambiguous',
        candidates: ['alpha', 'beta'],
        notice: 'Project memory has no single home: "alpha" and "beta" each hold a project_memory/ folder.',
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('<li>alpha</li>');
    expect(html).toContain('<li>beta</li>');
    expect(html).toContain('&quot;alpha&quot; and &quot;beta&quot;');
  });

  it('escapes folder names and the notice, since a folder name is whatever somebody called a directory', () => {
    const html = loadNotice()({
      ssotHome: { rule: 'ambiguous', candidates: ['<img src=x onerror=alert(1)>'], notice: '<script>bad()</script>' },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('is informational: it posts nothing and offers no action that could pick a folder', () => {
    const source = functionSource(WEBVIEW_SCRIPT, 'function renderSsotHomeNotice(snapshot)');
    expect(source).not.toMatch(/postMessage|data-action/);
  });

  it('is composed host-side from the same refusal every other surface uses', () => {
    const composer = functionSource(DASHBOARD, 'function describeDashboardSsotHome(');
    expect(composer).toContain('home.refusal');
    expect(DASHBOARD).toContain('ssotHome: describeDashboardSsotHome(ssotHome, firstWorkspaceFolder?.name)');
  });
});

describe('the surfaces that read and write project memory ask for the home', () => {
  it('reads the workflow file from the SSOT home, refusing rather than reading an ambiguous one', () => {
    const getter = DASHBOARD.slice(DASHBOARD.indexOf('private get workflowConfig(): WorkflowConfigManager {'));
    expect(getter.slice(0, 400)).toContain('new WorkflowConfigManager(home.fsPath, home.refusal)');
  });

  it('anchors a "." component on the folder the composition was read from', () => {
    expect(DASHBOARD).toContain('collectDashboardWorkspaceScope(composition, this.workflowConfig.getWorkspaceRoot())');
    expect(DASHBOARD).toContain('collectDashboardWorkspaceScope(declaredComposition, workflowConfigManager?.getWorkspaceRoot())');
    expect(DASHBOARD).not.toMatch(/collectDashboardWorkspaceScope\((?:composition|declaredComposition)\)/);
  });

  it('writes operator feedback, and reads the ideation board and the roadmap, from the home', () => {
    const ssotRoot = functionSource(PARTICIPANT, 'function getSsotRootUri()');
    expect(ssotRoot).toContain('ssotHomeRoot()');
    expect(ssotRoot).toContain('refusal');
    expect(ssotRoot).not.toContain('workspaceFolders');

    const ideate = functionSource(PARTICIPANT, 'async function handleIdeateCommand(');
    expect(ideate).toContain('ssotHomeRoot()');
    expect(ideate).toContain('home.refusal');
  });

  it('loads memory and the project soul from the home', () => {
    const soul = functionSource(EXTENSION, 'function resolveProjectSoulFilePath(');
    expect(soul).toContain('ssotHomeRoot().folder');
    expect(soul).not.toContain('vscode.workspace.workspaceFolders');
    expect(EXTENSION).toContain('const workspaceFolder = ssotHome.folder;');
  });

  it('keeps workspace identity on the first folder on purpose, so cost history is not re-keyed', () => {
    // docs/project-composition.md: moving these would orphan every spend record
    // already written under the first folder's key.
    expect(EXTENSION).toContain('costTracker.setWorkspaceKey(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);');
    const costHistory = functionSource(EXTENSION, 'async function attachCostHistoryStore(');
    expect(costHistory).toContain('vscode.workspace.workspaceFolders?.[0]');
    expect(costHistory).not.toContain('ssotHomeRoot');
  });
});

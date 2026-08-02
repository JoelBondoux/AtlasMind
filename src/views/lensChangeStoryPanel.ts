import * as vscode from 'vscode';

import type { LensChangeStoryMap } from '../core/lensChangeStory.js';
import { buildLensContextPatch, buildLensDraftPrompt, normalizeLensTarget } from '../core/lensTarget.js';
import type { LensVisualTarget } from '../types.js';
import { revealPreferredChatSurface } from './chatPanel.js';
import { getWebviewHtmlShell } from './webviewUtils.js';

type LensChangeStoryMessage =
  | { type: 'ready' }
  | { type: 'openChange'; changeId: string }
  | { type: 'askChange'; changeId: string };

/** Secure host-owned rendering of a bounded committed local-branch story. */
export class LensChangeStoryPanel {
  private static currentPanel: LensChangeStoryPanel | undefined;
  private static readonly viewType = 'atlasmind.lensChangeStory';
  private readonly disposables: vscode.Disposable[] = [];
  private readonly targetByChangeId = new Map<string, LensVisualTarget>();
  private ready = false;

  public static createOrShow(map: LensChangeStoryMap): void {
    if (LensChangeStoryPanel.currentPanel) {
      LensChangeStoryPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      LensChangeStoryPanel.currentPanel.replaceMap(map);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      LensChangeStoryPanel.viewType,
      'Lens — Change Story',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    LensChangeStoryPanel.currentPanel = new LensChangeStoryPanel(panel, map);
  }

  private constructor(private readonly panel: vscode.WebviewPanel, private map: LensChangeStoryMap) {
    this.indexTargets();
    this.panel.webview.html = buildChangeStoryHtml(this.panel.webview.cspSource);
    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = normalizeMessage(raw);
        if (message) void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private replaceMap(map: LensChangeStoryMap): void {
    this.map = map;
    this.indexTargets();
    if (this.ready) void this.panel.webview.postMessage({ type: 'map', map });
  }

  private indexTargets(): void {
    this.targetByChangeId.clear();
    for (const change of this.map.changes) {
      const target = normalizeLensTarget(change.target);
      if (target) this.targetByChangeId.set(change.id, target);
    }
  }

  private async handleMessage(message: LensChangeStoryMessage): Promise<void> {
    if (message.type === 'ready') {
      this.ready = true;
      await this.panel.webview.postMessage({ type: 'map', map: this.map });
      return;
    }
    const target = normalizeLensTarget(this.targetByChangeId.get(message.changeId));
    if (!target) return;
    if (message.type === 'openChange') {
      const uri = resolveWorkspaceTarget(target);
      if (!uri) {
        void vscode.window.showWarningMessage('AtlasMind Lens refused an invalid, deleted, or out-of-workspace change target.');
        return;
      }
      await vscode.window.showTextDocument(uri, { preview: false });
      return;
    }
    await revealPreferredChatSurface({ draftPrompt: buildLensDraftPrompt(target), contextPatch: buildLensContextPatch(target) });
  }

  private dispose(): void {
    LensChangeStoryPanel.currentPanel = undefined;
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}

function normalizeMessage(value: unknown): LensChangeStoryMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  if (value.type === 'ready') return { type: 'ready' };
  if (
    (value.type === 'openChange' || value.type === 'askChange') && typeof value.changeId === 'string' &&
    value.changeId.length > 0 && value.changeId.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value.changeId)
  ) return { type: value.type, changeId: value.changeId };
  return undefined;
}

function resolveWorkspaceTarget(target: LensVisualTarget): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(candidate =>
    candidate.name === target.workspace.name && candidate.index === target.workspace.index,
  );
  if (!folder) return undefined;
  const uri = vscode.Uri.joinPath(folder.uri, ...target.workspacePath.split('/'));
  const resolved = vscode.workspace.getWorkspaceFolder(uri);
  return resolved && resolved.name === folder.name && resolved.index === folder.index &&
    normalizeRelativePath(vscode.workspace.asRelativePath(uri, false)) === target.workspacePath ? uri : undefined;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return undefined;
  const segments = normalized.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? undefined : segments.join('/');
}

function buildChangeStoryHtml(cspSource: string): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Lens — Change Story',
    cspSource,
    bodyContent: `
      <main class="story-shell">
        <header class="story-header"><div><p class="eyebrow">AtlasMind Lens</p><h1 id="story-title">Change story</h1><p id="story-summary">Loading committed Git evidence…</p></div><span class="mode-badge">Local Git evidence</span></header>
        <ul id="story-notices" class="notices" aria-label="Evidence notices"></ul>
        <section aria-labelledby="component-title"><h2 id="component-title">Changed components</h2><div id="component-strip" class="component-strip"></div></section>
        <section aria-labelledby="change-title"><h2 id="change-title">Changed paths</h2><div id="change-groups" class="change-groups"></div></section>
        <section aria-labelledby="commit-title"><h2 id="commit-title">Commit intent trail</h2><ol id="commit-list" class="commit-list"></ol></section>
      </main>
    `,
    extraCss: `
      .story-shell { max-width: 1440px; margin: 0 auto; }
      .story-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      .story-header h1 { margin: 0; } .story-header p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); }
      .eyebrow { font-size: .76rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      .mode-badge { flex: none; border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 4px 9px; color: var(--vscode-descriptionForeground); }
      .notices { padding-left: 20px; color: var(--vscode-descriptionForeground); }
      section > h2 { font-size: 1rem; margin-top: 20px; }
      .component-strip { display: flex; gap: 8px; flex-wrap: wrap; } .component-pill { border: 1px solid var(--vscode-widget-border); border-radius: 999px; padding: 5px 9px; }
      .change-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); gap: 12px; }
      .change-group { border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 10px; } .change-group h3 { margin: 0 0 8px; font-size: .9rem; text-transform: capitalize; }
      .change-card { border-top: 1px solid var(--vscode-widget-border); padding: 8px 0; } .change-card:first-of-type { border-top: 0; }
      .change-path { margin: 0; overflow-wrap: anywhere; font-family: var(--vscode-editor-font-family, monospace); } .change-meta { margin: 4px 0; color: var(--vscode-descriptionForeground); }
      .change-actions { display: flex; gap: 6px; } .change-actions button { font-size: .75rem; }
      .commit-list { padding-left: 24px; } .commit-card { margin: 8px 0; } .commit-subject { font-weight: 600; } .commit-meta { color: var(--vscode-descriptionForeground); font-size: .8rem; }
      @media (max-width: 600px) { .story-header { flex-direction: column; } }
    `,
    scriptContent: `
      const vscode = acquireVsCodeApi();
      const title = document.getElementById('story-title');
      const summary = document.getElementById('story-summary');
      const notices = document.getElementById('story-notices');
      const components = document.getElementById('component-strip');
      const groups = document.getElementById('change-groups');
      const commits = document.getElementById('commit-list');
      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action][data-change-id]');
        if (button) vscode.postMessage({ type: button.dataset.action, changeId: button.dataset.changeId });
      });
      window.addEventListener('message', event => { if (event.data?.type === 'map') renderMap(event.data.map); });
      function renderMap(map) {
        title.textContent = map.branch + ' change story';
        summary.textContent = map.baseRef + ' merge-base → HEAD · ' + map.commits.length + ' commits · ' + map.changes.length + ' paths';
        notices.replaceChildren(...map.notices.map(notice => element('li', notice)));
        components.replaceChildren(...map.componentCounts.map(item => element('span', item.component + ' · ' + item.count, 'component-pill')));
        const categories = [...new Set(map.changes.map(change => change.category))];
        groups.replaceChildren(...categories.map(category => renderGroup(category, map.changes.filter(change => change.category === category))));
        commits.replaceChildren(...map.commits.map(renderCommit));
      }
      function renderGroup(category, changes) {
        const group = element('section', '', 'change-group'); group.append(element('h3', category + ' · ' + changes.length));
        for (const change of changes) {
          const card = element('article', '', 'change-card'); card.append(element('p', change.workspacePath, 'change-path'));
          card.append(element('p', change.status + (change.previousPath ? ' · from ' + change.previousPath : ''), 'change-meta'));
          if (change.target) {
            const actions = element('div', '', 'change-actions');
            actions.append(button('Open', 'openChange', change.id), button('Ask Atlas', 'askChange', change.id)); card.append(actions);
          }
          group.append(card);
        }
        return group;
      }
      function renderCommit(commit) {
        const item = element('li', '', 'commit-card'); item.append(element('div', commit.subject, 'commit-subject'));
        item.append(element('div', commit.hash.slice(0, 8) + ' · ' + commit.author + ' · ' + commit.authoredAt, 'commit-meta')); return item;
      }
      function button(label, action, id) { const value = element('button', label); value.type = 'button'; value.dataset.action = action; value.dataset.changeId = id; return value; }
      function element(tag, text, className) { const value = document.createElement(tag); if (text) value.textContent = text; if (className) value.className = className; return value; }
      vscode.postMessage({ type: 'ready' });
    `,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

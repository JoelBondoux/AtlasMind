import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { UI_SURFACE_RULES, type UiSurfaceScanReport } from '../../src/core/uiSurfaceScan.ts';
import { uiSurfaceRenderId } from '../../src/core/uiSurfaceRender.ts';
import { HTML_EDIT_RULES } from '../../src/core/uiSurfaceElementEdit.ts';
import type { WebsitePagePlan } from '../../src/types.ts';
import { getWebsiteStudioHtml, isWebsiteStudioMessage } from '../../src/views/websiteStudioPanel.ts';

/**
 * Element editing on the Studio's Rendered output card, and the host behind it.
 *
 * Five boundaries are pinned. The Studio posts a scan-derived id and nothing
 * else, and the host decides from a fresh scan and the edit-support table
 * whether the file may be edited. Only a static page offers editing; a
 * component says plainly that it is not supported and offers the editor. The
 * edit page posts element ids only and every value is asked for host-side.
 * Nothing is written without a confirmation, and the write sits behind the dry
 * run and a re-check of the file. The plain render stays scripts-off; only the
 * edit render runs a script, and only AtlasMind's.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const panel = read('src/views/websiteStudioPanel.ts');
const editHost = read('src/views/uiSurfaceEditHost.ts');
const renderHost = read('src/views/uiSurfaceRenderHost.ts');
const script = read('media/websiteStudio.js');
const webview = { cspSource: 'vscode-webview://test' };

function scan(): UiSurfaceScanReport {
  return {
    surfaces: [
      { path: 'site/index.html', label: 'index.html', adapterId: 'static-html-css', kind: 'page', ruleId: 'html-page', bytes: 900 },
      { path: 'src/Checkout.tsx', label: 'Checkout.tsx', adapterId: 'react', kind: 'component', ruleId: 'react-component', bytes: 400 },
    ],
    filesExamined: 10,
    filesExcluded: 0,
    truncated: false,
    rules: UI_SURFACE_RULES,
  };
}

function pickedUp(id: string, sourcePath: string, ruleId: string): WebsitePagePlan {
  return {
    id, title: id, slug: `/${id}`, purpose: `Picked up from ${sourcePath}.`, template: 'Found surface',
    sections: [], wireframeNotes: '', designNotes: '',
    wireframeStatus: 'not-started', designStatus: 'not-started', contentStatus: 'not-started', seoStatus: 'not-started',
    order: 9, designPrompt: '', links: [],
    source: { path: sourcePath, adapterId: 'react', ruleId, pickedUpAt: '2026-10-08T00:00:00.000Z' },
  };
}

function cardFor(html: string, pageId: string): string {
  const start = html.indexOf(`data-render-card-page="${pageId}"`);
  expect(start, pageId).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</article>', start));
}

function studioHtml(): string {
  const workspace = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
  workspace.pages.push(pickedUp('page-index', 'site/index.html', 'html-page'), pickedUp('page-checkout', 'src/Checkout.tsx', 'react-component'));
  return getWebsiteStudioHtml(webview, workspace, 'design', { scriptContent: '', uiSurfaces: scan() });
}

describe('Studio messages', () => {
  it('accept a scan-derived id and nothing that could name a file, an element or an edit', () => {
    const id = uiSurfaceRenderId('site/index.html');
    for (const type of ['editSurfaceElements', 'openSurfaceSource']) {
      expect(isWebsiteStudioMessage({ type, payload: { surfaceId: id } }), type).toBe(true);
      expect(isWebsiteStudioMessage({ type, payload: { path: 'site/index.html' } }), type).toBe(false);
      expect(isWebsiteStudioMessage({ type, payload: { surfaceId: id, elementId: 'e-0-0' } }), type).toBe(false);
      expect(isWebsiteStudioMessage({ type, payload: { surfaceId: id, text: 'x' } }), type).toBe(false);
      expect(isWebsiteStudioMessage({ type, payload: { surfaceId: '../x' } }), type).toBe(false);
    }
  });

  it('are posted from data attributes carrying the id alone', () => {
    expect(script).toContain("vscode.postMessage({ type: 'editSurfaceElements', payload: { surfaceId: button.dataset.editSurface } })");
    expect(script).toContain("vscode.postMessage({ type: 'openSurfaceSource', payload: { surfaceId: button.dataset.openSurfaceSource } })");
  });

  it('are resolved against a fresh scan, with editing decided by the support table and the render rule', () => {
    const handler = panel.slice(panel.indexOf('private async handleEditSurfaceElements('), panel.indexOf('private async handleOpenSurfaceSource('));
    expect(handler).toContain('this.scanWorkspaceUiSurfaces()?.surfaces.find(candidate => uiSurfaceRenderId(candidate.path) === surfaceId)');
    expect(handler).toContain('const support = uiSurfaceEditSupport(decision.ruleId);');
    expect(handler).toContain("if (!support.supported || decision.mode !== 'static-file')");
    const open = panel.slice(panel.indexOf('private async handleOpenSurfaceSource('), panel.indexOf('/** Save through the manager'));
    expect(open).toContain('nodeFs.realpathSync(');
    expect(open).toMatch(/relative\.startsWith\('\.\.'\)/);
  });

  it('closes the edit host with the Studio', () => {
    expect(panel).toMatch(/this\.panel\.onDidDispose\(\(\) => \{[\s\S]*this\.editHost\?\.dispose\(\);/);
  });
});

describe('the card', () => {
  it('offers element editing on a static page', () => {
    const card = cardFor(studioHtml(), 'page-index');
    expect(card).toContain(`data-edit-surface="${uiSurfaceRenderId('site/index.html')}"`);
    expect(card).toContain('Select &amp; edit elements…');
    expect(card).not.toContain('data-open-surface-source');
  });

  it('says a component is not edited here and offers the editor instead', () => {
    const card = cardFor(studioHtml(), 'page-checkout');
    expect(card).toContain('Element editing is not supported for components.');
    expect(card).toContain(`data-open-surface-source="${uiSurfaceRenderId('src/Checkout.tsx')}"`);
    expect(card).not.toContain('data-edit-surface');
  });

  it('publishes the rules every edit is checked against', () => {
    const html = studioHtml();
    expect(html).toContain('How elements are edited');
    for (const rule of HTML_EDIT_RULES) {
      expect(html).toContain(`<code>${rule.id}</code>`);
    }
  });
});

describe('the edit host', () => {
  it('runs the edit render with scripts on only for a nonce document, while the plain render stays scripts-off', () => {
    expect(editHost).toContain("enableScripts: true, enableForms: false, localResourceRoots: [folder]");
    expect(editHost).toContain('buildEditableSurfaceDocument({');
    expect(editHost).toContain("nonce: randomBytes(16).toString('hex')");
    expect(renderHost).toContain('enableScripts: false, enableForms: false, localResourceRoots: [folder]');
  });

  it('accepts only validated ids from the page and asks for every value itself', () => {
    expect(editHost).toContain('if (!isUiSurfaceEditMessage(input)');
    expect(editHost).toContain('vscode.window.showInputBox({');
    expect(editHost).toContain('validateInput: value => validateHtmlEditText(value)');
    expect(editHost).toContain('validateInput: candidate => validateHtmlAttributeEdit(element.tagName, name, candidate)');
  });

  it('writes only through the confirmed, dry-run-guarded, re-checked sequence', () => {
    expect(editHost.match(/writeFileSync\(/g)?.length).toBe(1);
    const sequence = editHost.indexOf('const outcome = await confirmAndApplyHtmlEdit(snapshot.target.path, plan, {');
    expect(sequence).toBeGreaterThan(-1);
    expect(editHost.indexOf('writeFileSync(')).toBeGreaterThan(sequence);
    expect(editHost).toContain("intercept: effect => interceptDryRun(effect)");
    expect(editHost).toContain("{ modal: true, detail }, 'Apply edit')) === 'Apply edit'");
  });

  it('refuses a file with unsaved editor changes, a non-UTF-8 file, and a stale render', () => {
    expect(editHost).toContain('document.isDirty && samePath(document.uri.fsPath, snapshot.real)');
    expect(editHost).toContain("if (!Buffer.from(text, 'utf8').equals(bytes))");
    expect(editHost).toContain('htmlSourceFingerprint(read.text) !== snapshot.doc.fingerprint');
  });

  it('re-resolves the file through realpath and keeps it inside the workspace', () => {
    expect(editHost).toContain('nodeFs.realpathSync(path.resolve(root, ...target.path.split(\'/\')))');
    expect(editHost).toMatch(/relative === '' \|\| relative\.startsWith\('\.\.'\) \|\| path\.isAbsolute\(relative\)/);
    expect(editHost).toContain('STATIC_SURFACE_MAX_BYTES');
  });
});

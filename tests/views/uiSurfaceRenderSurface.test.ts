import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { UI_SURFACE_RULES, type UiSurfaceScanReport } from '../../src/core/uiSurfaceScan.ts';
import { assessSurfaceOwnership, planSurfaceEmit, planSurfaceLaunch } from '../../src/core/uiSurfaceEmit.ts';
import { uiSurfaceRenderId, UI_SURFACE_RENDER_RULES } from '../../src/core/uiSurfaceRender.ts';
import type { UiDesignNode, UiDesignScreen, WebsitePagePlan } from '../../src/types.ts';
import { getWebsiteStudioHtml, isWebsiteStudioMessage, type EmittedSurfaceView } from '../../src/views/websiteStudioPanel.ts';

/**
 * The Rendered output card: a found surface shown as itself, beside the canvas.
 *
 * Four boundaries are pinned. The browser posts a scan-derived id and nothing
 * else, and the host matches it against a fresh scan. The card says what is
 * on screen — a real file, a dev server, or why neither — and a drawn surface
 * is never offered as the real thing. Only a static render is automatic; a dev
 * server waits for its own button and a confirmation. And the render panel
 * has scripts off at the webview as well as in its policy.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const panel = read('src/views/websiteStudioPanel.ts');
const host = read('src/views/uiSurfaceRenderHost.ts');
const script = read('media/websiteStudio.js');
const webview = { cspSource: 'vscode-webview://test' };

function scan(): UiSurfaceScanReport {
  return {
    surfaces: [
      { path: 'site/index.html', label: 'index.html', adapterId: 'static-html-css', kind: 'page', ruleId: 'html-page', bytes: 900 },
      { path: 'src/Checkout.tsx', label: 'Checkout.tsx', adapterId: 'react', kind: 'component', ruleId: 'react-component', bytes: 400 },
      { path: 'media/panel.js', label: 'panel.js', adapterId: 'vscode-webview', kind: 'webview', ruleId: 'vscode-webview-script', bytes: 300 },
      { path: 'src/Unpicked.tsx', label: 'Unpicked.tsx', adapterId: 'react', kind: 'component', ruleId: 'react-component', bytes: 100 },
      { path: 'src/theme.css', label: 'theme.css', adapterId: 'static-html-css', kind: 'stylesheet', ruleId: 'stylesheet-tokens', bytes: 100 },
    ],
    filesExamined: 40,
    filesExcluded: 3,
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

function node(id: string): UiDesignNode {
  return {
    id, kind: 'hero', label: id, locked: false,
    layout: {
      mode: 'free', rect: { x: 0, y: 0, width: 1000, height: 100 }, widthMode: 'fixed', heightMode: 'fixed', hidden: false,
      direction: 'vertical', gap: 0, padding: 0, columns: 1, align: 'start', distribute: 'start',
      minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, wrap: 'nowrap', order: 0,
    },
    viewportOverrides: {}, designPrompt: '', notes: '',
  };
}

describe('render messages', () => {
  it('accept a scan-derived id and nothing that could name a file, a mode or a command', () => {
    const id = uiSurfaceRenderId('site/index.html');
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { surfaceId: id } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'stopSurfaceDevServer' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { path: 'site/index.html' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { surfaceId: 'site/index.html' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { surfaceId: id, mode: 'static-file' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { surfaceId: id, command: 'npm' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'renderSurface', payload: { surfaceId: `${id}0` } })).toBe(false);
  });

  it('are posted from data attributes carrying the id alone', () => {
    const wiring = script.slice(script.indexOf('// ── Rendered output'), script.indexOf('function applySurfaceRenderState'));
    expect(wiring).toContain("vscode.postMessage({ type: 'renderSurface', payload: { surfaceId: button.dataset.renderSurface } })");
    expect(wiring).toContain("vscode.postMessage({ type: 'stopSurfaceDevServer' })");
    expect(wiring).not.toMatch(/innerHTML/);
    // The sentence the host sends is shown as text, never parsed as markup.
    const apply = script.slice(script.indexOf('function applySurfaceRenderState'), script.indexOf('function applySurfaceRenderState') + 1200);
    expect(apply).toContain('node.textContent = statement');
    expect(apply).toContain('/^uis-[0-9a-f]{16}$/');
  });

  it('auto-render only a static surface when it is opened from the rail', () => {
    const open = script.slice(script.indexOf("qsa('[data-open-surface]')"), script.indexOf("qs('#addSurface')"));
    expect(open).toContain("qs('[data-render-auto]', card)");
    expect(panel.match(/data-render-auto/g)?.length).toBe(1);
    expect(panel).toMatch(/decision\.mode === 'static-file'\s*\? `<button[^`]*data-render-auto>/);
  });
});

describe('render host boundary', () => {
  it('re-validates the id against a fresh scan and takes the mode from the rule table', () => {
    const handler = panel.slice(panel.indexOf('private async handleRenderSurface('), panel.indexOf('/** Save through the manager'));
    expect(handler).toContain('this.scanWorkspaceUiSurfaces()?.surfaces.find(candidate => uiSurfaceRenderId(candidate.path) === surfaceId)');
    expect(handler).toContain("throw new Error('That surface is not in the current scan.");
    expect(handler).toContain('classifyUiSurfaceRender({ ruleId: surface.ruleId, path: surface.path })');
    expect(handler).toContain('planDevServerRender({ packageJson, lockfiles, surfacePath: surface.path })');
    // A refused plan is reported as not renderable, never fallen back from.
    expect(handler).toMatch(/plan\.status === 'refused'[\s\S]*mode: 'not-renderable'/);
  });

  it('renders a static page with scripts off at the webview, limited to its folder', () => {
    expect(host).toContain('enableScripts: false, enableForms: false, localResourceRoots: [folder]');
    expect(host).toContain('nodeFs.realpathSync(absolute)');
    expect(host).toContain('if (!isInside(root, real))');
    expect(host).toContain('STATIC_SURFACE_MAX_BYTES');
    expect(host).toContain('vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder');
  });

  it('starts a dev server only through the confirmed, dry-run-guarded sequence, and never through a shell', () => {
    // Node's spawn is reached once, as the dependency handed to the sequence.
    expect(host.match(/=> spawn\(/g)?.length).toBe(1);
    const start = host.indexOf('const outcome = await confirmAndStartDevServer(plan, this.workspaceRoot, {');
    expect(start).toBeGreaterThan(-1);
    expect(host.indexOf('=> spawn(')).toBeGreaterThan(start);
    expect(host.indexOf('=> spawn(')).toBeLessThan(host.indexOf('if (outcome.status ==='));
    expect(host).toContain('intercept: effect => interceptDryRun(effect)');
    expect(host).toContain('shell: false');
    expect(host).not.toMatch(/shell:\s*true/);
    expect(host).toContain("'simpleBrowser.api.open'");
  });

  it('stops the dev server with the Studio', () => {
    expect(panel).toMatch(/this\.panel\.onDidDispose\(\(\) => \{[\s\S]*this\.renderHost\?\.dispose\(\);/);
    expect(host).toMatch(/dispose\(\): void \{\s*this\.stopDevServer\(\);/);
  });
});

describe('Rendered output card', () => {
  function config() {
    const workspace = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    workspace.pages.push(
      pickedUp('page-index', 'site/index.html', 'html-page'),
      pickedUp('page-checkout', 'src/Checkout.tsx', 'react-component'),
      pickedUp('page-panel', 'media/panel.js', 'vscode-webview-script'),
      pickedUp('page-gone', 'src/Deleted.tsx', 'react-component'),
    );
    return workspace;
  }

  it('offers a static page as the real file, rendered automatically and labelled', () => {
    const html = getWebsiteStudioHtml(webview, config(), 'design', { scriptContent: '', uiSurfaces: scan() });
    const card = cardFor(html, 'page-index');
    expect(card).toContain(`data-render-surface="${uiSurfaceRenderId('site/index.html')}" data-render-auto`);
    expect(card).toContain(`data-render-statement="${uiSurfaceRenderId('site/index.html')}"`);
    expect(card).toContain('real file · scripts off');
    expect(card).toContain('Not rendered yet.');
    expect(card).toContain(' hidden>');
  });

  it('offers a component through the dev server, behind its own button and a stop', () => {
    const html = getWebsiteStudioHtml(webview, config(), 'design', { scriptContent: '', uiSurfaces: scan() });
    const card = cardFor(html, 'page-checkout');
    expect(card).toContain('Render via your dev server…');
    expect(card).toContain('data-stop-dev-server');
    expect(card).not.toContain('data-render-auto');
  });

  it('says why a webview script and a vanished file are not rendered, with no button', () => {
    const html = getWebsiteStudioHtml(webview, config(), 'design', { scriptContent: '', uiSurfaces: scan() });
    const webviewCard = cardFor(html, 'page-panel');
    expect(webviewCard).toContain('Not renderable here:');
    expect(webviewCard).toContain('acquireVsCodeApi');
    expect(webviewCard).not.toContain('data-render-surface');
    const gone = cardFor(html, 'page-gone');
    expect(gone).toContain('src/Deleted.tsx is no longer in the project, so nothing is rendered.');
    expect(gone).not.toContain('data-render-surface');
  });

  it('calls a drawn surface a draft, and an engine emit "cannot render in the editor" beside its launch', () => {
    const workspace = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const page = workspace.pages[0]!;
    const screen: UiDesignScreen = { id: page.id, pageId: page.id, initialized: true, baseBreakpoint: 'desktop', nodes: [node('hero-1')] };
    workspace.designGraph = { ...workspace.designGraph, screens: [screen] };
    const planned = planSurfaceEmit({ graph: workspace.designGraph, screen, page, pages: workspace.pages, targetId: 'godot-control', siteName: 'Northstar', emittedAt: '2026-10-08T00:00:00.000Z' });
    if (!planned.ok) { throw new Error(planned.reason); }
    const view: EmittedSurfaceView = {
      manifest: planned.plan.manifest,
      ownership: assessSurfaceOwnership(planned.plan.manifest, new Map(planned.plan.files.map(file => [file.path, file.contents]))),
      pageTitle: page.title,
      launch: planSurfaceLaunch(planned.plan.manifest, 'D:/game'),
    };
    const html = getWebsiteStudioHtml(webview, workspace, 'design', { scriptContent: '', uiSurfaces: scan(), emittedSurfaces: [view] });
    const card = cardFor(html, page.id);
    expect(card).toContain('Drawn here — there is no project file behind this surface.');
    expect(card).toContain('Cannot render in the editor');
    expect(card).toContain(`data-launch-surface data-screen="${page.id}" data-target="godot-control"`);
    expect(card).not.toContain('data-render-surface');
  });

  it('labels the full preview as the Studio\'s draft, and publishes the render rules', () => {
    const html = getWebsiteStudioHtml(webview, config(), 'design', { scriptContent: '', uiSurfaces: scan() });
    expect(html).toContain('This is the Studio\'s draft of every page, never a project file.');
    for (const rule of UI_SURFACE_RENDER_RULES) {
      expect(html).toContain(`<code>${rule.id}</code>`);
    }
  });

  it('puts a Render button on found files that can render, and none on those that cannot', () => {
    const html = getWebsiteStudioHtml(webview, config(), 'design', { scriptContent: '', uiSurfaces: scan() });
    const rail = html.slice(html.indexOf('surfaces-rail'), html.indexOf('<main>'));
    expect(rail).toContain(`data-render-surface="${uiSurfaceRenderId('src/Unpicked.tsx')}"`);
    expect(rail).not.toContain(`data-render-surface="${uiSurfaceRenderId('src/theme.css')}"`);
  });
});

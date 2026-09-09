import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { assessSurfaceOwnership, planSurfaceEmit, planSurfaceLaunch } from '../../src/core/uiSurfaceEmit.ts';
import type { UiDesignNode, UiDesignScreen } from '../../src/types.ts';
import { getWebsiteStudioHtml, isWebsiteStudioMessage, type EmittedSurfaceView } from '../../src/views/websiteStudioPanel.ts';

/**
 * The Emit card on the Handoff view: what the browser may ask for, and what the
 * host shows before it writes or runs anything.
 *
 * Three boundaries are pinned. A message names a screen, a target from the
 * declared table and a folder, and can only *ask* for the destructive path.
 * The host launches with `spawn` and an argument vector, never a shell, and
 * only after a modal that shows the argv. And the card states ownership from
 * the files as they are, so "owned by Unity" is a reading, not a memory.
 */
const ROOT = process.cwd();
const panel = readFileSync(path.join(ROOT, 'src', 'views', 'websiteStudioPanel.ts'), 'utf8');
const script = readFileSync(path.join(ROOT, 'media', 'websiteStudio.js'), 'utf8');
const webview = { cspSource: 'vscode-webview://test' };

function node(id: string, kind: UiDesignNode['kind']): UiDesignNode {
  return {
    id, kind, label: id, locked: false,
    layout: {
      mode: 'free', rect: { x: 0, y: 0, width: 1000, height: 100 }, widthMode: 'fixed', heightMode: 'fixed', hidden: false,
      direction: 'vertical', gap: 0, padding: 0, columns: 1, align: 'start', distribute: 'start',
      minWidth: null, maxWidth: null, minHeight: null, maxHeight: null, wrap: 'nowrap', order: 0,
    },
    viewportOverrides: {}, designPrompt: '', notes: '',
  };
}

function drawnConfig() {
  const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
  const page = config.pages[0]!;
  const screen: UiDesignScreen = { id: page.id, pageId: page.id, initialized: true, baseBreakpoint: 'desktop', nodes: [node('hero-1', 'hero')] };
  config.designGraph = { ...config.designGraph, screens: [screen] };
  return { config, page, screen };
}

describe('emit messages', () => {
  it('accepts a screen, a declared target and a folder, and nothing that could name a file to write', () => {
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: 'page-home', targetId: 'web' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: 'page-home', targetId: 'godot-control', outputRoot: 'ui/hud', discardEngineLayout: true } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: 'page-home', targetId: 'flutter' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: 'page-home', targetId: 'web', files: [] } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: '../x', targetId: 'web' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'emitSurface', payload: { screenId: 'page-home', targetId: 'web', outputRoot: 'x'.repeat(161) } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'pushSurfaceContent', payload: { screenId: 'page-home', targetId: 'web' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'launchSurface', payload: { screenId: 'page-home', targetId: 'web', command: 'rm' } })).toBe(false);
  });

  it('posts ids, a target and a folder from the row, and only asks for a discard', () => {
    const wiring = script.slice(script.indexOf('Emitted surfaces'), script.indexOf("qsa('[data-reemit-surface]')") + 400);
    expect(wiring).toMatch(/type: 'emitSurface',\s*payload: \{ screenId: row\.dataset\.emitScreen, targetId: value\('\[data-emit-target\]', row\), outputRoot: value\('\[data-emit-root\]', row\) \}/);
    expect(wiring).toContain("discardEngineLayout: button.dataset.discard === 'true'");
    expect(wiring).not.toMatch(/contents|fileText|innerHTML/);
  });
});

describe('emit host', () => {
  it('confirms every write and the destructive path separately, and launches without a shell', () => {
    const emit = panel.slice(panel.indexOf('private async handleEmitSurface('), panel.indexOf('private async handlePushSurfaceContent('));
    expect(emit).toContain('this.refuseIfReadOnly()');
    expect(emit).toContain("'Overwrite the layout'");
    expect(emit).toContain("'Show files first'");
    expect(emit).toMatch(/if \(file\.shared && nodeFs\.existsSync\(absolute\)\) \{\s*continue;/);
    // The discard path is reached only through the refusal and the flag together.
    expect(emit).toMatch(/result\.refusal === 'layout-owned-by-engine' && payload\.discardEngineLayout && existing\.manifest/);

    const launch = panel.slice(panel.indexOf('private async handleLaunchSurface('), panel.indexOf('private refuseIfReadOnly('));
    expect(launch).toMatch(/spawn\(launch\.command!, launch\.args \?\? \[\], \{ cwd: root, detached: true, stdio: 'ignore' \}\)/);
    expect(launch).not.toMatch(/shell:\s*true/);
    expect(launch).toContain("'Copy command'");
    expect(launch.indexOf("'Run'")).toBeLessThan(launch.indexOf('spawn('));
  });

  it('pushes content through the plan and writes only the files the plan names', () => {
    const push = panel.slice(panel.indexOf('private async handlePushSurfaceContent('), panel.indexOf('private async handleLaunchSurface('));
    expect(push).toContain('planContentPatch({');
    expect(push).toMatch(/for \(const file of plan\.files\) \{\s*nodeFs\.writeFileSync/);
    expect(push).toContain("'Update'");
    expect(push).toContain('Refused, and left as they are');
  });
});

describe('emit card', () => {
  it('offers one row per drawn surface with the declared targets, and states ownership from the files', () => {
    const { config, page, screen } = drawnConfig();
    config.implementation.targetTechnologies = ['Godot 4'];
    const planned = planSurfaceEmit({ graph: config.designGraph, screen, page, pages: config.pages, targetId: 'godot-control', siteName: 'Northstar', emittedAt: '2026-09-09T00:00:00.000Z' });
    if (!planned.ok) { throw new Error(planned.reason); }
    const files = new Map(planned.plan.files.map(file => [file.path, file.contents]));
    files.set(planned.plan.files[0]!.path, `${planned.plan.files[0]!.contents}\n[node name="Added" type="Control" parent="."]\n`);
    const view: EmittedSurfaceView = {
      manifest: planned.plan.manifest,
      ownership: assessSurfaceOwnership(planned.plan.manifest, files),
      pageTitle: page.title,
      launch: planSurfaceLaunch(planned.plan.manifest, 'D:/game'),
    };
    const html = getWebsiteStudioHtml(webview, config, 'handoff', { scriptContent: '', emittedSurfaces: [view] });
    const card = html.slice(html.indexOf('class="panel-card emit-card"'), html.indexOf('How emits behave'));

    expect(card).toContain(`data-emit-screen="${screen.id}"`);
    expect(card).toContain('<option value="godot-control" data-root="ui/atlasmind" selected>');
    expect(card).toContain('<option value="unreal-umg" data-root="docs/ui-handoff">');
    expect(card).toContain('Layout: owned by Godot since the emit on 2026-09-09 · Content: editable here (1 region)');
    expect(card).toContain('data-push-content data-screen="page-home" data-target="godot-control"');
    expect(card).toContain('Launch in Godot');
    expect(card).toContain("Discard Godot's layout and emit again");
    expect(card).toMatch(/data-reemit-surface [^>]*data-discard="true"/);
  });

  it('says so when nothing has been drawn or emitted, and never numbers the emits', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml(webview, config, 'handoff', { scriptContent: '' });
    expect(html).toContain('there is nothing to emit yet');
    expect(html).toContain('Nothing has been emitted yet.');
    expect(html).not.toContain('data-emit-surface');
  });
});

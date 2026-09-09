import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import { UI_SURFACE_RULES, type UiSurfaceScanReport } from '../../src/core/uiSurfaceScan.ts';
import type { BrandPreset, UiDesignToken } from '../../src/types.ts';
import { getWebsiteStudioHtml, isWebsiteStudioMessage } from '../../src/views/websiteStudioPanel.ts';

/**
 * The UI Studio shell: a rail of surfaces beside the canvas, and brands that
 * apply to many of them.
 *
 * Three claims are pinned here because each is a boundary. A found file is
 * *named* by the browser and *classified* by the host's own scan — a message
 * can point at a file and never supply one. A brand is applied by id to
 * screens by id, so no token value crosses from the browser. And the shell
 * has no numbered steps, since a waterfall it does not have was what made the
 * previous three layouts confusing.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const panel = read('src/views/websiteStudioPanel.ts');
const script = read('media/websiteStudio.js');

const webview = { cspSource: 'vscode-webview://test' };

function scan(): UiSurfaceScanReport {
  return {
    surfaces: [
      { path: 'src/App.tsx', label: 'App.tsx', adapterId: 'react', kind: 'component', ruleId: 'react-component', bytes: 900 },
      { path: 'src/hud/Hud.tsx', label: 'Hud.tsx', adapterId: 'react', kind: 'component', ruleId: 'react-component', bytes: 400 },
      { path: 'src/theme.css', label: 'theme.css', adapterId: 'static-html-css', kind: 'stylesheet', ruleId: 'stylesheet-tokens', bytes: 300 },
    ],
    filesExamined: 40,
    filesExcluded: 3,
    truncated: false,
    rules: UI_SURFACE_RULES,
  };
}

function brand(id: string, label: string): BrandPreset {
  const tokens: UiDesignToken[] = [
    { id: 'color-primary', label: 'Primary', kind: 'color', value: '#123456' },
    { id: 'font-heading', label: 'Heading font', kind: 'font-family', value: 'Inter' },
  ];
  return { id, label, tokens };
}

describe('UI Studio surfaces rail', () => {
  it('lists found files minus the ones already picked up, and never a stylesheet', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.pages.push({
      id: 'page-hud', title: 'Hud', slug: '/hud', purpose: 'Picked up from src/hud/Hud.tsx.', template: 'Found surface',
      sections: [], wireframeNotes: '', designNotes: '',
      wireframeStatus: 'not-started', designStatus: 'not-started', contentStatus: 'not-started', seoStatus: 'not-started',
      order: 9, designPrompt: '', links: [],
      source: { path: 'src/hud/Hud.tsx', adapterId: 'react', ruleId: 'react-component', pickedUpAt: '2026-09-09T00:00:00.000Z' },
    });
    const html = getWebsiteStudioHtml(webview, config, 'design', { scriptContent: '', uiSurfaces: scan() });
    const rail = html.slice(html.indexOf('surfaces-rail'), html.indexOf('<main>'));

    expect(rail).toContain('data-pick-up="src/App.tsx"');
    // Already designed here: offered to open, not to pick up again.
    expect(rail).not.toContain('data-pick-up="src/hud/Hud.tsx"');
    expect(rail).toContain('data-open-surface="page-hud"');
    expect(rail).toContain('from src/hud/Hud.tsx');
    // A stylesheet is a source of tokens, not a thing to draw.
    expect(rail).not.toContain('data-pick-up="src/theme.css"');
    // And the rules that chose the list are published beside it.
    for (const rule of UI_SURFACE_RULES) {
      expect(rail).toContain(rule.id);
    }
  });

  it('says it did not look rather than showing an empty list when there is no workspace', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml(webview, config, 'design', { scriptContent: '' });
    expect(html).toContain('Not scanned');
    expect(html).not.toContain('data-pick-up=');
  });

  it('sends a path only, and the host re-scans before believing it', () => {
    const wiring = script.slice(script.indexOf('Surfaces rail'), script.indexOf("qs('#extractBrand')"));
    expect(wiring).toMatch(/type: 'pickUpSurface', payload: \{ path: button\.dataset\.pickUp \}/);
    const handler = panel.slice(panel.indexOf('private async handlePickUpSurface('), panel.indexOf('private async handleSetDefaultBrand('));
    expect(handler).toContain('this.scanWorkspaceUiSurfaces()');
    expect(handler).toContain("surface.kind === 'stylesheet'");
    expect(handler).toContain('this.refuseIfReadOnly()');
    // The origin is recorded from the scan's own classification, never from the message.
    expect(handler).toMatch(/source: \{\s*path: surface\.path,\s*adapterId: surface\.adapterId,\s*ruleId: surface\.ruleId/);
  });

  it('refuses a pick-up message that is not one bounded path', () => {
    expect(isWebsiteStudioMessage({ type: 'pickUpSurface', payload: { path: 'src/App.tsx' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'pickUpSurface', payload: { path: '../secrets.env' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'pickUpSurface', payload: { path: 'src/App.tsx', adapterId: 'react' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'pickUpSurface', payload: { path: '' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'pickUpSurface', payload: { path: 'x'.repeat(401) } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'extractBrandFromStylesheet', payload: { path: 'src\\..\\theme.css' } })).toBe(false);
  });
});

describe('UI Studio brands view', () => {
  it('renders each brand with what it sets, where it came from, and the default marked', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.brands = [brand('house', 'House'), { ...brand('event', 'Event'), source: { ruleId: 'stylesheet-custom-properties', path: 'src/theme.css', extractedAt: '2026-09-01T00:00:00.000Z' } }];
    config.defaultBrandId = 'house';
    const html = getWebsiteStudioHtml(webview, config, 'brands', { scriptContent: '', uiSurfaces: scan() });
    const view = html.slice(html.indexOf('data-page="brands"'), html.indexOf('data-page="content"'));

    expect(view).toContain('data-brand-card="house"');
    expect(view).toContain('data-brand-card="event"');
    expect(view).toContain('Read from src/theme.css on 2026-09-01');
    expect(view).toContain('Authored here.');
    expect(view).toContain('background:#123456');
    // The default cannot be set as default again; the other can.
    expect(view).toMatch(/data-brand-default="house" disabled/);
    expect(view).toMatch(/data-brand-default="event">/);
    // Reading a new brand offers only stylesheets the scan classified.
    expect(view).toContain('<option value="src/theme.css">');
    expect(view).not.toContain('<option value="src/App.tsx">');
  });

  it('lists every screen with the brand it wears now under Apply to', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.brands = [brand('house', 'House'), brand('event', 'Event')];
    config.defaultBrandId = 'house';
    const first = config.designGraph.screens[0]!;
    config.designGraph.screens = config.designGraph.screens.map((screen, index) =>
      index === 0 ? { ...screen, brandRef: 'event' } : screen);
    const html = getWebsiteStudioHtml(webview, config, 'brands', { scriptContent: '' });
    const eventCard = html.slice(html.indexOf('data-brand-card="event"'), html.indexOf('data-brand-card="house"') > html.indexOf('data-brand-card="event"') ? html.indexOf('data-brand-card="house"') : html.length);

    expect(eventCard).toContain(`data-brand-screen="${first.pageId}" checked`);
    expect(eventCard).toContain('<small>Event</small>');
    expect(eventCard).toContain('<small>House (default)</small>');
  });

  it('applies by id and nothing else', () => {
    const wiring = script.slice(script.indexOf('Surfaces rail'), script.indexOf("qs('#extractBrand')"));
    expect(wiring).toMatch(/type: 'applyBrandToScreens', payload: \{ presetId: button\.dataset\.brandApply, screenIds \}/);
    expect(isWebsiteStudioMessage({ type: 'applyBrandToScreens', payload: { presetId: 'house', screenIds: ['page-home'] } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'applyBrandToScreens', payload: { presetId: 'house', screenIds: [] } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'applyBrandToScreens', payload: { presetId: 'house', screenIds: Array.from({ length: 201 }, (_, i) => `s${i}`) } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'applyBrandToScreens', payload: { presetId: 'house', screenIds: ['page-home'], tokens: [] } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'setDefaultBrand', payload: { presetId: '../x' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'removeBrand', payload: { presetId: 'house' } })).toBe(true);
  });

  it('applying the default clears a screen choice rather than recording it', () => {
    // A recorded "use the default" would stop following when the default
    // changed, which is the opposite of what applying the default means.
    const handler = panel.slice(panel.indexOf('private async handleApplyBrand('), panel.indexOf('private async handleRemoveBrand('));
    expect(handler).toMatch(/presetId === this\.config\.defaultBrandId \? rest : \{ \.\.\.rest, brandRef: presetId \}/);
  });

  it('confirms a removal by naming what is lost, and refuses nothing silently', () => {
    const handler = panel.slice(panel.indexOf('private async handleRemoveBrand('), panel.indexOf('private async handleExtractBrand('));
    expect(handler).toContain('modal: true');
    expect(handler).toContain('cannot be recovered from anywhere else');
    expect(handler).toContain('fall back to the default');
  });
});

describe('UI Studio views by profile', () => {
  it('has no Delivery view — a website is pointed at the Dashboard from Handoff — and always shows Handoff', () => {
    const website = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const websiteHtml = getWebsiteStudioHtml(webview, website, 'design', { scriptContent: '' });
    expect(websiteHtml).not.toContain('data-page-target="delivery"');
    expect(websiteHtml).not.toContain('data-page="delivery"');
    expect(websiteHtml).toContain('data-page-target="handoff"');
    expect(websiteHtml).toContain('id="openDeliveryPage"');

    const native = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    native.surfaceKind = 'editor-extension';
    const nativeHtml = getWebsiteStudioHtml(webview, native, 'design', { scriptContent: '' });
    expect(nativeHtml).not.toContain('id="openDeliveryPage"');
    expect(nativeHtml).toContain('data-page-target="handoff"');
    expect(nativeHtml).toContain('Screens &amp; flows');
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import {
  getWebsiteStudioHtml,
  isWebsiteStudioPage,
  isWebsiteStudioMessage,
  resolveWebsiteStudioPage,
} from '../../src/views/websiteStudioPanel.ts';

describe('Website Studio webview boundary', () => {
  it('accepts only known dashboard deep links', () => {
    expect(isWebsiteStudioPage('wireframes')).toBe(true);
    expect(isWebsiteStudioPage('content')).toBe(true);
    expect(isWebsiteStudioPage('preview')).toBe(true);
    expect(isWebsiteStudioPage('automations')).toBe(true);
    expect(isWebsiteStudioPage('../../settings')).toBe(false);
  });

  it('allows only the documented bounded message shapes', () => {
    expect(isWebsiteStudioMessage({ type: 'ready' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: {} })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: '{"clientName":"Northstar"}' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: 'json' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'savePageContent',
      payload: { pageId: 'page-home', title: 'Home', metaDescription: '', status: 'draft', body: '# Home', expectedBody: '' },
    })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'seedPageContent', payload: { pageId: 'page-home' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openPreview' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openResponsivePreview' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'refreshPreview' })).toBe(true);

    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: 'x'.repeat(128_001) })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: '../../package.json' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'workbench.action.terminal.sendSequence' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: 'erase everything' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'deploy', payload: 'production' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'savePageContent', payload: { pageId: '../outside', status: 'draft', body: 'x'.repeat(200_001) } })).toBe(false);
  });

  it('keeps the old platforms page id working as a deep link', () => {
    // The id is a public deep-link target: the Project Dashboard and the
    // Ideation board both link in, and a renamed id would silently drop them on
    // the Brief page with no indication why.
    expect(resolveWebsiteStudioPage('platforms')).toBe('stack');
    expect(resolveWebsiteStudioPage('stack')).toBe('stack');
    expect(resolveWebsiteStudioPage('nonsense')).toBe('brief');
    expect(resolveWebsiteStudioPage(undefined)).toBe('brief');
  });

  it('validates the framework choice against the catalog, not merely as a string', () => {
    // This id chooses which constant command the setup planner will run.
    expect(isWebsiteStudioMessage({ type: 'selectFramework', payload: { frameworkId: 'astro' } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'selectFramework', payload: { frameworkId: 'jekyll' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'selectFramework', payload: { frameworkId: 'npm install evil' } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'selectFramework', payload: {} })).toBe(false);
  });

  it('offers no setup affordance until the setting is on, and says which', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const off = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'stack', {
      scriptContent: '/* canvas */',
    });
    expect(off).toContain('Automatic setup is off');
    expect(off).toContain('atlasmind.website.setup.enabled');
    expect(off).not.toContain('id="planStackSetup"');

    const on = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'stack', {
      scriptContent: '/* canvas */',
      canSetUpStack: true,
    });
    expect(on).toContain('id="planStackSetup"');
  });

  it('states that Delivery has not been compared rather than showing a reassuring blank', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'stack', {
      scriptContent: '/* canvas */',
    });
    expect(html).toContain('Not compared yet');
    expect(html).toContain('drift apart between syncs');
  });

  it('shows an incompatible framework with its reason rather than hiding it', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.platforms = config.platforms.map(platform => ({ ...platform, primary: platform.id === 'shopify' }));
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'stack', {
      scriptContent: '/* canvas */',
    });
    // Removing the option would leave somebody wondering where Hugo went.
    expect(html).toContain('Hugo');
    expect(html).toContain('compat-unsupported');
    expect(html).toContain('Liquid');
  });

  it('renders client content escaped with nonce-protected scripts and no inline handlers', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: '<img src=x onerror=alert(1)>' });
    // The canvas script now lives in `media/websiteStudio.js` and is read off
    // disk by the panel, so the caller supplies it. Passed here as a stub
    // because this test is about the shell's escaping and nonce, not the script.
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'brief', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('value="<img src=x onerror=alert(1)>"');
    expect(html).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9]+'/);
    expect(html).toMatch(/<script nonce="[A-Za-z0-9]+">/);
    expect(html).not.toMatch(/\sonclick=/i);
    expect(html).toContain('No one-click production deploys here.');
    expect(html).toContain('Three deliberate hosting stages');
    expect(html).toContain('Develop');
    expect(html).toContain('Staging');
    expect(html).toContain('Production');
    expect(html).toContain('SecretStorage:website.staging.password');
    expect(html).toContain('Production promotion protected');
  });

  it('uses the generalized screen workflow and hides website delivery for a native UI', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.surfaceKind = 'mobile-app';
    config.implementation.targetTechnologies = ['SwiftUI'];
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'stack', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('UI Studio');
    expect(html).toContain('Screens &amp; flows');
    expect(html).toContain('Implementation handoff');
    expect(html).toContain('SwiftUI');
    expect(html).not.toContain('Three deliberate hosting stages');
    expect(html).not.toContain('n8n automations');
  });

  it('renders content design rules and real Markdown-backed screen copy', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    config.contentDesign.voice = 'Calm and direct';
    const home = config.pages[0]!;
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'content', {
      scriptContent: '/* canvas */',
      contentDirectory: 'product-copy',
      pageContent: [{
        pageId: home.id,
        filePath: 'product-copy/index.md',
        title: 'Home',
        metaDescription: 'A useful product',
        status: 'review',
        body: '# Welcome\n\n[PLACEHOLDER: proof point]',
        placeholders: [{ need: 'proof point', line: 3 }],
        missing: false,
        extraFrontMatter: {},
      }],
    });

    expect(html).toContain('Content design');
    expect(html).toContain('Calm and direct');
    expect(html).toContain('product-copy/index.md');
    expect(html).toContain('1 unresolved placeholder');
    expect(html).toContain('save-page-content');
  });

  it('makes the built-in browser preview a numbered design step', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: 'Northstar' });
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config, 'preview', {
      scriptContent: '/* canvas */',
    });

    expect(html).toContain('data-page-target="preview"');
    expect(html).toContain('Canonical review surface');
    expect(html).toContain('built-in browser');
    expect(html).toContain('id="refreshFullPreview"');
    expect(html).toContain('id="openResponsivePreview"');
  });
});

/**
 * Could anybody find this panel?
 *
 * Website Studio shipped registered, documented and linked to from nowhere: the
 * command existed, the panel linked *out* to the Dashboard, Ideation and Chat,
 * and nothing anywhere linked back. The only way in was typing its name into the
 * command palette, which is not a discovery mechanism for a surface you do not
 * know exists.
 *
 * The rule this pins is narrow and checkable: **a panel that links to another
 * surface must be reachable from one.** A one-way link is how a whole panel goes
 * missing without a single test failing.
 */
describe('Website Studio is reachable from the surfaces it links to', () => {
  const read = (relative: string) => readFileSync(path.join(process.cwd(), relative), 'utf8');
  const OPEN_COMMAND = 'atlasmind.openWebsiteStudio';

  it('is offered by the panels it sends people to', () => {
    // It points at the Dashboard's delivery pipeline for publishing, and at the
    // Ideation board for the thinking that precedes a brief. Both now answer.
    expect(read('media/projectDashboard.js')).toContain(`data-payload="${OPEN_COMMAND}"`);
    expect(read('media/projectIdeation.js')).toContain(`data-payload="${OPEN_COMMAND}"`);
  });

  it('is allowlisted by the hosts of those buttons, so clicking does something', () => {
    expect(read('src/views/projectDashboardPanel.ts')).toContain(`'${OPEN_COMMAND}'`);
    expect(read('src/views/projectIdeationPanel.ts')).toContain(`'${OPEN_COMMAND}'`);
  });

  it('still declares the command it is opened by', () => {
    const manifest = JSON.parse(read('package.json')) as { contributes: { commands: Array<{ command: string }> } };
    expect(manifest.contributes.commands.some(entry => entry.command === OPEN_COMMAND)).toBe(true);
  });
});

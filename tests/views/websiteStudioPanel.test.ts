import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import {
  getWebsiteStudioHtml,
  isWebsiteStudioPage,
  isWebsiteStudioMessage,
} from '../../src/views/websiteStudioPanel.ts';

describe('Website Studio webview boundary', () => {
  it('accepts only known dashboard deep links', () => {
    expect(isWebsiteStudioPage('wireframes')).toBe(true);
    expect(isWebsiteStudioPage('automations')).toBe(true);
    expect(isWebsiteStudioPage('../../settings')).toBe(false);
  });

  it('allows only the documented bounded message shapes', () => {
    expect(isWebsiteStudioMessage({ type: 'ready' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: {} })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: '{"clientName":"Northstar"}' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: 'json' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);

    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: 'x'.repeat(128_001) })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: '../../package.json' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'workbench.action.terminal.sendSequence' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: 'erase everything' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'deploy', payload: 'production' })).toBe(false);
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

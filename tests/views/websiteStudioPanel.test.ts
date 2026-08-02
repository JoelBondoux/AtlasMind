import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultWebsiteWorkspace } from '../../src/core/websiteWorkspaceManager.ts';
import {
  getWebsiteStudioHtml,
  isWebsiteStudioPage,
  isWebsiteStudioMessage,
} from '../../src/views/websiteStudioPanel.ts';

const renderStudio = () => getWebsiteStudioHtml(
  { cspSource: 'vscode-webview://test' },
  createDefaultWebsiteWorkspace({ projectName: 'Northstar' }),
);

function buttonWith(html: string, attribute: string): string | undefined {
  return (html.match(/<button\b[^>]*>/g) ?? []).find(tag => tag.includes(attribute));
}

function tagWith(html: string, attribute: string): string | undefined {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).find(tag => tag.includes(attribute));
}

function contextualChatMessage(payload: Record<string, unknown> = {}) {
  return {
    type: 'openContextualChat',
    payload: {
      prompt: 'Make the selected hero calmer and more spacious.',
      selectedSurfaceId: 'page-home',
      selectedNodeId: 'draft-node-page-home-hero',
      selectedNodeIndex: 0,
      previewProfile: 'desktop',
      config: {},
      ...payload,
    },
  };
}

describe('Website Studio webview boundary', () => {
  it('accepts only known dashboard deep links', () => {
    expect(isWebsiteStudioPage('wireframes')).toBe(true);
    expect(isWebsiteStudioPage('automations')).toBe(true);
    expect(isWebsiteStudioPage('../../settings')).toBe(false);
  });

  it('allows only the documented bounded message shapes', () => {
    const contextualChat = contextualChatMessage();

    expect(isWebsiteStudioMessage({ type: 'ready' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: {} })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: '{"clientName":"Northstar"}' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: { raw: '{}', config: {} } })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'setActivePage', payload: 'wireframes' })).toBe(true);
    expect(isWebsiteStudioMessage(contextualChat)).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: 'json' })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' })).toBe(true);

    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: 'x'.repeat(128_001) })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'importIntake', payload: { raw: 'x'.repeat(128_001), config: {} } })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'setActivePage', payload: '../../settings' })).toBe(false);
    expect(isWebsiteStudioMessage({
      ...contextualChat,
      payload: { ...contextualChat.payload, prompt: ' '.repeat(12) },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      ...contextualChat,
      payload: { ...contextualChat.payload, prompt: 'x'.repeat(8_001) },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      ...contextualChat,
      payload: { ...contextualChat.payload, previewProfile: 'production' },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      ...contextualChat,
      payload: { ...contextualChat.payload, config: 'last saved copy' },
    })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openSsot', payload: '../../package.json' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'openCommand', payload: 'workbench.action.terminal.sendSequence' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'saveConfig', payload: 'erase everything' })).toBe(false);
    expect(isWebsiteStudioMessage({ type: 'deploy', payload: 'production' })).toBe(false);
  });

  it('requires a bounded non-negative revision for revision-wrapped saves', () => {
    expect(isWebsiteStudioMessage({
      type: 'saveConfig',
      payload: { config: { version: 1 }, revision: 0 },
    })).toBe(true);
    expect(isWebsiteStudioMessage({
      type: 'saveConfig',
      payload: { config: {}, revision: Number.MAX_SAFE_INTEGER },
    })).toBe(true);

    for (const payload of [
      { config: {}, revision: -1 },
      { config: {}, revision: 1.5 },
      { config: {}, revision: Number.MAX_SAFE_INTEGER + 1 },
      { config: {} },
      { revision: 1 },
      { config: [], revision: 1 },
    ]) {
      expect(isWebsiteStudioMessage({ type: 'saveConfig', payload }), JSON.stringify(payload)).toBe(false);
    }
  });

  it('accepts only bounded pending-draft store and clear messages', () => {
    expect(isWebsiteStudioMessage({
      type: 'storeDraft',
      payload: { config: { version: 1 }, revision: 4 },
    })).toBe(true);
    expect(isWebsiteStudioMessage({ type: 'clearDraft', payload: { revision: 4 } })).toBe(true);

    for (const payload of [
      { config: {}, revision: -1 },
      { config: {}, revision: 1.25 },
      { config: {}, revision: Number.MAX_SAFE_INTEGER + 1 },
      { config: [], revision: 1 },
      { config: {} },
      null,
    ]) {
      expect(isWebsiteStudioMessage({ type: 'storeDraft', payload }), String(payload)).toBe(false);
    }
    for (const payload of [
      { revision: -1 },
      { revision: 1.25 },
      { revision: Number.MAX_SAFE_INTEGER + 1 },
      {},
      null,
      [],
    ]) {
      expect(isWebsiteStudioMessage({ type: 'clearDraft', payload }), String(payload)).toBe(false);
    }
  });

  it('rejects oversized configs at every webview message boundary', () => {
    const oversizedConfig = { value: 'x'.repeat(1_000_001) };

    expect(isWebsiteStudioMessage({
      type: 'saveConfig',
      payload: { config: oversizedConfig, revision: 1 },
    })).toBe(false);
    expect(isWebsiteStudioMessage(contextualChatMessage({ config: oversizedConfig }))).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'storeDraft',
      payload: { config: oversizedConfig, revision: 1 },
    })).toBe(false);
    expect(isWebsiteStudioMessage({
      type: 'importIntake',
      payload: { raw: '{}', config: oversizedConfig, revision: 1 },
    })).toBe(false);
  });

  it('bounds the selected node index carried into contextual chat', () => {
    expect(isWebsiteStudioMessage(contextualChatMessage({ selectedNodeIndex: 0 }))).toBe(true);
    expect(isWebsiteStudioMessage(contextualChatMessage({ selectedNodeIndex: 499 }))).toBe(true);
    expect(isWebsiteStudioMessage(contextualChatMessage({ selectedNodeIndex: undefined }))).toBe(true);

    for (const selectedNodeIndex of [-1, 500, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(isWebsiteStudioMessage(contextualChatMessage({ selectedNodeIndex }))).toBe(false);
    }
  });

  it('renders client content escaped with nonce-protected scripts and no inline handlers', () => {
    const config = createDefaultWebsiteWorkspace({ projectName: '<img src=x onerror=alert(1)>' });
    const html = getWebsiteStudioHtml({ cspSource: 'vscode-webview://test' }, config);

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

    const scripts = [...html.matchAll(/<script nonce="[A-Za-z0-9]+">([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(() => new Function(scripts[0]![1]!)).not.toThrow();
  });
});

/**
 * Interface Studio is a canvas editor, rather than another long settings
 * dashboard. These assertions deliberately pin its interaction grammar while
 * leaving layout measurements and visual styling free to evolve.
 */
describe('Website Studio Interface Studio contract', () => {
  it('renders the familiar four-region builder shell', () => {
    const html = renderStudio();

    for (const label of [
      'Surface and layer panel',
      'Interface canvas',
      'Selection inspector',
      'Atlas conversational development',
    ]) {
      expect(tagWith(html, `aria-label="${label}"`), `${label} region`).toBeDefined();
    }
  });

  it('exposes Plan, Design, Build, and Preview as accessible modes', () => {
    const html = renderStudio();
    const tablist = tagWith(html, 'class="mode-tabs"');
    const tabs: string[] = [];

    expect(tablist).toContain('role="tablist"');
    expect(tablist).toMatch(/aria-label="Studio modes?"/);
    for (const mode of ['plan', 'design', 'build', 'preview']) {
      const tab = buttonWith(html, `data-studio-mode="${mode}"`);
      expect(tab, `${mode} mode tab`).toBeDefined();
      expect(tab).toContain('role="tab"');
      expect(tab).toContain('aria-selected=');
      expect(tab).toContain('aria-controls=');
      const controls = tab?.match(/aria-controls="([^"]+)"/)?.[1];
      expect(controls, `${mode} controlled panel`).toBeDefined();
      expect(tagWith(html, `id="${controls}"`)).toBeDefined();
      if (tab) tabs.push(tab);
    }
    expect(tabs.filter(tab => tab.includes('aria-selected="true"'))).toHaveLength(1);
  });

  it('uses the same persisted node id in the layer tree and on the canvas', () => {
    const html = renderStudio();
    const homeSelections = html.match(/data-selection-id="page-home"/g) ?? [];

    // A config-backed id, not a title or DOM position, joins the two views.
    expect(homeSelections.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('data-select-surface');
    expect(html).toContain('data-select-node');
    expect(html).toContain('dataset.selectionId');
    expect(html).toContain("setAttribute('aria-selected'");
  });

  it('offers labelled desktop, tablet, and mobile preview profiles', () => {
    const html = renderStudio();
    const group = tagWith(html, 'class="preview-profiles"');

    expect(group).toContain('role="group"');
    expect(group).toMatch(/aria-label="Preview profiles?"/);
    for (const [profile, label] of [['desktop', 'Desktop'], ['tablet', 'Tablet'], ['mobile', 'Mobile']]) {
      const button = buttonWith(html, `data-preview-profile="${profile}"`);
      expect(button, `${profile} preview profile`).toBeDefined();
      expect(button).toContain('aria-pressed=');
      expect(button).toContain(`title="${label} preview"`);
      expect(html).toContain(`<span class="profile-label">${label}</span>`);
    }
  });

  it('makes saved, dirty, and saving state explicit', () => {
    const html = renderStudio();
    const status = tagWith(html, 'data-save-state="saved"');

    expect(status).toBeDefined();
    expect(status).toContain('role="status"');
    expect(html).toContain('Saved');
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('Saving…');
  });

  it('docks an accessible conversation that reads the current unsaved selection', () => {
    const html = renderStudio();

    expect(html).toContain('data-chat-context');
    expect(html).not.toContain('<label class="chat-composer">');
    expect(html).toContain('<div class="chat-composer">');
    expect(html).toContain('<label class="sr-only" for="atlasChatPrompt">Ask Atlas about the current selection</label>');
    expect(html).toContain('<textarea id="atlasChatPrompt" maxlength="8000"');
    expect(html).toContain('Current surface + unsaved selection attached');
    // collectConfig reads the live form controls, so this must be evaluated at
    // prompt time instead of using the last persisted server-side config.
    expect(html).toMatch(/(?:currentDraft|config): collectConfig\(\)/);
  });

  it('keeps Apply disabled until Atlas returns a structured patch', () => {
    const html = renderStudio();
    const apply = buttonWith(html, 'data-proposal-action="apply"');
    const reject = buttonWith(html, 'data-proposal-action="reject"');

    expect(apply).toBeDefined();
    expect(apply).toContain('type="button"');
    expect(apply).toContain('disabled');
    expect(apply).toContain('title="Available when Atlas returns a structured patch to Interface Studio"');
    expect(reject).toBeDefined();
    expect(reject).toContain('type="button"');
    expect(html).toContain('>Apply</button>');
    expect(html).toContain('>Reject</button>');
  });

  it('guards stale save acknowledgements, reconciles canonical data, and persists pending drafts', () => {
    const html = renderStudio();
    const source = readFileSync(path.join(process.cwd(), 'src/views/websiteStudioPanel.ts'), 'utf8');

    expect(html).toContain('const isCurrentRevision = event.data.revision === draftRevision;');
    expect(html).toContain('if (isCurrentRevision) {');
    expect(html).toContain('applyNormalizedConfig(event.data.config);');
    expect(html).toContain("notice('An earlier draft was saved, but newer changes are still unsaved.');");
    expect(html).toContain("type: 'storeDraft'");
    expect(html).toContain("type: 'clearDraft'");
    expect(html).toContain("window.addEventListener('beforeunload'");
    expect(source).toContain('await this.reconcilePendingDraftAfterSave(revision);');
    expect(source).toContain('pending.revision <= savedRevision');
    expect(source).toContain('updatedAt: new Date().toISOString()');
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

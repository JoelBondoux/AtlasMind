import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The two places Buzz is configured by clicking rather than by hand-editing
 * settings JSON: the Settings → Buzz page, and the Director roster's
 * "bind this person to an AtlasMind agent" control.
 *
 * These are source-level assertions because the alternative — a rendered
 * control with no handler behind it — type-checks and lints perfectly while
 * doing nothing. The gating in particular is the point: three deny-by-default
 * switches are only a safety property if the UI cannot quietly bypass one.
 */

const settingsSource = readFileSync(path.join(process.cwd(), 'src', 'views', 'settingsPanel.ts'), 'utf8');
const dashboardSource = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');
const dashboardClient = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');

describe('Settings → Buzz page', () => {
  const CONTROLS = [
    { id: 'buzzEnabled', message: 'setBuzzEnabled', setting: 'buzz.enabled' },
    { id: 'buzzRelayUrl', message: 'setBuzzRelayUrl', setting: 'buzz.relayUrl' },
    { id: 'buzzAllowRemoteRelay', message: 'setBuzzAllowRemoteRelay', setting: 'buzz.allowRemoteRelay' },
    { id: 'buzzInboundEnabled', message: 'setBuzzInboundEnabled', setting: 'buzz.inboundEnabled' },
    { id: 'buzzInboundChannels', message: 'setBuzzInboundChannels', setting: 'buzz.inboundChannels' },
    { id: 'buzzAutoCreateFollowUps', message: 'setBuzzAutoCreateFollowUps', setting: 'buzz.autoCreateFollowUps' },
  ];

  it.each(CONTROLS)('renders $id, posts $message, and writes $setting', ({ id, message, setting }) => {
    expect(settingsSource).toContain(`id="${id}"`);
    expect(settingsSource).toContain(`type: '${message}'`);
    expect(settingsSource).toContain(`case '${message}':`);
    expect(settingsSource).toContain(`'${setting}'`);
  });

  it('reads every switch back from configuration so the page shows what is stored', () => {
    for (const { setting } of CONTROLS) {
      expect(settingsSource).toContain(`configuration.get`);
      expect(settingsSource).toContain(`'${setting}'`);
    }
  });

  it('marks the dependent controls as gated by their parent switch', () => {
    // Inbound depends on the master switch; persistence depends on inbound.
    expect(settingsSource).toContain('data-buzz-depends="buzzEnabled"');
    expect(settingsSource).toContain('data-buzz-depends="buzzInboundEnabled"');
  });

  it('treats inbound as live only when the master switch is also on', () => {
    // Otherwise a stored `inboundEnabled: true` would leave its dependants
    // enabled while Buzz itself is off — a UI that contradicts the gate.
    expect(settingsSource).toMatch(/gateOn\.buzzInboundEnabled\s*=\s*gateOn\.buzzInboundEnabled\s*&&\s*gateOn\.buzzEnabled/);
  });

  it('keeps follow-up persistence a switch of its own, not a consequence of subscribing', () => {
    // project_memory/ is git-tracked: watching a channel must never, by itself,
    // start committing records about colleagues' conversations.
    const persistence = settingsSource.indexOf("id=\"buzzAutoCreateFollowUps\"");
    expect(persistence).toBeGreaterThan(-1);
    expect(settingsSource).toContain('tracked by git');
  });

  it('offers the agent-key command by name rather than a generic command runner', () => {
    // A webview message carrying an arbitrary command id is an injection
    // surface; an allowlist of two named messages is one by construction.
    expect(settingsSource).toContain("case 'openBuzzAgentKey':");
    expect(settingsSource).toContain("executeCommand('atlasmind.setBuzzAgentKey')");
    expect(settingsSource).not.toMatch(/executeCommand\(message\.payload/);
  });

  it('rejects a relay URL with no usable scheme at the boundary', () => {
    expect(settingsSource).toMatch(/wss\?\|https\?/);
  });

  it('surfaces unusable agent bindings instead of dropping them', () => {
    expect(settingsSource).toContain('parsedBuzzBindings.issues');
  });
});

describe('Director roster agent binding', () => {
  it('sends the binding as its own message, separate from the roster save', () => {
    // The binding lives in settings, not in git-tracked project memory, and a
    // refused binding must not block saving the person.
    expect(dashboardClient).toContain("type: 'setBuzzAgentBinding'");
    expect(dashboardSource).toContain("case 'setBuzzAgentBinding':");
  });

  it('only offers the binding on a buzz channel', () => {
    expect(dashboardClient).toContain("linkKind === 'buzz'");
    expect(dashboardClient).toContain('data-buzz-binding');
  });

  it('validates the message shape but allows an empty agent id for unbinding', () => {
    const validator = dashboardSource.slice(dashboardSource.indexOf("candidate['type'] === 'setBuzzAgentBinding'"));
    expect(validator).toContain("typeof p['pubkey'] === 'string'");
    expect(validator).toContain("typeof p['agentId'] === 'string'");
    // An `agentId.length > 0` check here would make unbinding impossible.
    expect(validator.slice(0, 400)).not.toContain("p['agentId'].length > 0");
  });

  it('refuses a binding to an agent that does not exist', () => {
    expect(dashboardSource).toContain('No AtlasMind agent named');
  });

  it('routes the write through the shared pure helper rather than merging inline', () => {
    expect(dashboardSource).toContain('writeAgentBinding(');
    expect(dashboardSource).toContain("import {\n  parseAgentBindings,\n  writeAgentBinding,");
  });

  it('reports a refused binding rather than failing silently', () => {
    expect(dashboardSource).toMatch(/showWarningMessage\(`Buzz binding not saved/);
  });

  it('sends the agent choices from the registry so the client never guesses an id', () => {
    expect(dashboardSource).toContain('agentChoices');
    expect(dashboardSource).toContain('agentRegistry?.listAgents()');
  });
});

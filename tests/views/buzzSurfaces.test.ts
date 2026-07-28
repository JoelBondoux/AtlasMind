import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isSettingsMessage } from '../../src/views/settingsPanel.ts';

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
const packageJson = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');

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

  // The bug this catches shipped: every message type was added to the
  // `SettingsMessage` union and to the handler's switch, but not to the runtime
  // allowlist, so `handleMessage` dropped all of them before reaching the
  // switch. It type-checked, it linted, and the whole page was inert — a
  // checkbox appeared to toggle while nothing was ever written. Grepping the
  // source for the message type could never have caught it; only calling the
  // guard can.
  it.each([
    { type: 'setBuzzEnabled', payload: true },
    { type: 'setBuzzAllowRemoteRelay', payload: false },
    { type: 'setBuzzInboundEnabled', payload: true },
    { type: 'setBuzzAutoCreateFollowUps', payload: true },
    { type: 'setBuzzRelayUrl', payload: 'wss://relay.example' },
    { type: 'setBuzzInboundChannels', payload: 'chan-1\nchan-2' },
    { type: 'openBuzzAgentKey' },
    { type: 'openDirectorRoster' },
    { type: 'fetchBuzzChannels' },
  ])('accepts $type at the message guard', message => {
    expect(isSettingsMessage(message)).toBe(true);
  });

  it('accepts an empty relay URL and an empty channel list', () => {
    // Empty is meaningful for both — clearing the relay, and watching by kind
    // alone — so a non-empty check here would make them unclearable.
    expect(isSettingsMessage({ type: 'setBuzzRelayUrl', payload: '' })).toBe(true);
    expect(isSettingsMessage({ type: 'setBuzzInboundChannels', payload: '' })).toBe(true);
  });

  it('rejects a switch carrying a non-boolean payload', () => {
    expect(isSettingsMessage({ type: 'setBuzzEnabled', payload: 'true' })).toBe(false);
    expect(isSettingsMessage({ type: 'setBuzzInboundEnabled' })).toBe(false);
    expect(isSettingsMessage({ type: 'setBuzzRelayUrl', payload: 42 })).toBe(false);
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
    expect(dashboardClient).toMatch(/row\.hidden = kind !== 'buzz'/);
  });

  it('makes the hidden attribute actually hide', () => {
    // The binding row is a `.stage-edit-grid`, and that author rule's
    // `display: grid` outranks the user agent's `[hidden] { display: none }` —
    // so without an explicit override the row stayed fully visible on every
    // non-buzz channel. This shipped once.
    expect(dashboardSource).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important/);
  });

  it('validates the message shape but allows an empty agent id for unbinding', () => {
    const validator = dashboardSource.slice(dashboardSource.indexOf("candidate['type'] === 'setBuzzAgentBinding'"));
    expect(validator).toContain("typeof p['pubkey'] === 'string'");
    expect(validator).toContain("typeof p['agentId'] === 'string'");
    // An `agentId.length > 0` check here would make unbinding impossible.
    expect(validator.slice(0, 400)).not.toContain("p['agentId'].length > 0");
  });

  it('refuses a binding to an agent that does not exist', () => {
    expect(dashboardSource).toMatch(/there is no AtlasMind agent named/);
  });

  it('routes the write through the shared pure helper rather than merging inline', () => {
    expect(dashboardSource).toContain('writeAgentBinding(');
    // Matched without pinning line endings: a CRLF checkout is a legitimate
    // working copy, not a failure.
    expect(dashboardSource).toMatch(/import\s*{[^}]*\bwriteAgentBinding\b[^}]*}\s*from\s*'\.\.\/core\/buzzAgentBindings\.js'/);
  });

  it('reports a refused binding rather than failing silently', () => {
    expect(dashboardSource).toMatch(/the Buzz agent binding was not/);
  });

  it('offers observed identities and fills Handle from the pick', () => {
    expect(dashboardClient).toContain('renderBuzzIdentityPicker');
    expect(dashboardClient).toContain("field === 'buzzIdentityPick'");
    expect(dashboardClient).toMatch(/handle\.value = target\.value/);
  });

  it('labels an unnamed identity as unnamed rather than inventing one', () => {
    expect(dashboardClient).toContain('(no published name)');
  });

  it('says what to do when nothing has been observed yet', () => {
    // An empty picker with no explanation reads as a broken feature.
    expect(dashboardClient).toContain('No Buzz identities observed yet');
  });

  it('derives the user own key rather than asking them to paste it', () => {
    expect(dashboardSource).toContain('readOwnBuzzPubkey');
    expect(dashboardSource).toContain('deriveBuzzPublicKey');
    expect(dashboardClient).toContain('ownBuzzPubkey');
  });

  it('reads the stored secret only when Buzz is enabled', () => {
    // Touching a secret to compute something nobody asked for is not free.
    const fn = dashboardSource.slice(dashboardSource.indexOf('async function readOwnBuzzPubkey'));
    expect(fn.slice(0, 600)).toContain("get<boolean>('buzz.enabled', false)");
  });

  it('sends the agent choices from the registry so the client never guesses an id', () => {
    expect(dashboardSource).toContain('agentChoices');
    expect(dashboardSource).toContain('agentRegistry?.listAgents()');
  });
});

describe('the guided walkthrough is reachable from the Buzz settings page', () => {
  it('offers a button that opens the chat guide', () => {
    expect(settingsSource).toContain('id="buzzOpenGuide"');
    expect(settingsSource).toContain("type: 'openBuzzGuide'");
    expect(settingsSource).toContain("case 'openBuzzGuide':");
    expect(settingsSource).toContain("message.type === 'openBuzzGuide'");
  });

  it('opens AtlasMind own chat panel, not VS Code chat', () => {
    // Routing through `workbench.action.chat.open` put a Buzz question in front
    // of Copilot's participant picker, and the slash command arrived as text.
    expect(settingsSource).toContain("executeCommand('atlasmind.buzz.openGuide')");
    // Scoped to this handler: other buttons legitimately open VS Code chat.
    const handler = settingsSource.slice(
      settingsSource.indexOf("case 'openBuzzGuide':"),
      settingsSource.indexOf("case 'setProjectRunReportFolder'"),
    );
    // The comment above the handler names the old route; only a real call counts.
    expect(handler).not.toMatch(/executeCommand\('workbench\.action\.chat\.open'/);
  });
});

describe('fetching the real channel ids instead of copying them by hand', () => {
  it('offers a button on the Buzz settings page', () => {
    expect(settingsSource).toContain('id="buzzFetchChannels"');
    expect(settingsSource).toContain("type: 'fetchBuzzChannels'");
    expect(settingsSource).toContain("case 'fetchBuzzChannels':");
  });

  it('runs the extension command rather than reimplementing the flow in the panel', () => {
    expect(settingsSource).toContain("executeCommand('atlasmind.buzz.fetchChannels')");
  });

  it('is registered as a command so it is reachable from the palette too', () => {
    expect(packageJson).toContain('atlasmind.buzz.fetchChannels');
  });
});

describe('a Buzz handle is not always a public key', () => {
  it('only posts a binding when there is one to make', () => {
    // A channel UUID is a perfectly valid Buzz handle. Posting unconditionally
    // warned people that a binding they never asked for had failed, on a save
    // that had otherwise worked.
    expect(dashboardClient).toContain('directorLooksLikeBuzzKey');
    expect(dashboardClient).toMatch(/if \(chosenAgent \|\| alreadyBound\)/);
  });

  it('explains a non-key handle instead of erroring on save', () => {
    expect(dashboardClient).toContain('This handle is not a public key');
  });

  it('says the person was saved even when the binding was refused', () => {
    // "Buzz binding not saved" next to a save button reads as "nothing saved".
    expect(dashboardSource).toMatch(/The person was saved, but the Buzz agent binding was not/);
  });
});

// The MCP page reaches the registry, so its messages mutate real connections.
// The allowlist is what actually admits a message — adding a type to the union
// and the switch without adding it here is the bug that shipped on this page
// before, and it is invisible: the control renders and does nothing.
describe('Settings → MCP Servers page', () => {
  it.each([
    { type: 'connectMcpServer', payload: 'srv-1' },
    { type: 'disconnectMcpServer', payload: 'srv-1' },
    { type: 'setMcpServerEnabled', payload: { id: 'srv-1', enabled: false } },
    { type: 'openMcpManager' },
  ])('accepts $type at the message guard', message => {
    expect(isSettingsMessage(message)).toBe(true);
  });

  it('rejects a malformed server message rather than acting on it', () => {
    expect(isSettingsMessage({ type: 'connectMcpServer', payload: '' })).toBe(false);
    expect(isSettingsMessage({ type: 'connectMcpServer', payload: 42 })).toBe(false);
    expect(isSettingsMessage({ type: 'setMcpServerEnabled', payload: { id: 'srv-1' } })).toBe(false);
    expect(isSettingsMessage({ type: 'setMcpServerEnabled', payload: { id: '', enabled: true } })).toBe(false);
  });

  it('renders each server with the state that decides what agents can call', () => {
    expect(settingsSource).toContain('data-mcp-enable');
    expect(settingsSource).toContain('data-mcp-connect');
    expect(settingsSource).toContain('data-mcp-disconnect');
    expect(settingsSource).toContain('mcpServerRegistry?.listServers()');
  });

  it('actually disconnects when a server is disabled', () => {
    // Otherwise "Enabled: off" would relabel a server whose tools were still
    // reachable — a gate that reports itself closed while standing open.
    const handler = settingsSource.slice(
      settingsSource.indexOf("case 'setMcpServerEnabled':"),
      settingsSource.indexOf("case 'connectMcpServer':"),
    );
    expect(handler).toContain('disconnectServer');
  });

  it('does not duplicate the add-server flow', () => {
    // Two implementations of one flow drift, and the one that drifts is the one
    // nobody is looking at.
    expect(settingsSource).toContain("executeCommand('atlasmind.openMcpServers')");
    const page = settingsSource.slice(
      settingsSource.indexOf('id="page-mcp"'),
      settingsSource.indexOf('id="page-buzz"'),
    );
    expect(page).not.toContain('addServer');
    expect(page).not.toContain('SecretStorage');
  });
});

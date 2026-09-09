import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The portal audience is assigned on the Project Dashboard's Director page and
 * the host is chosen in Settings, and both write one committed file.
 *
 * Three properties are worth pinning, because breaking any of them turns a
 * record into something that looks like a gate: the browser must post a
 * **contact id and nothing else** (never an address, which would put personal
 * data into a webview message and then into a committed file); the surfaces must
 * keep saying that **AtlasMind does not enforce any of this**; and confirming
 * that access was configured must be an explicit, attributed act rather than
 * something inferred.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
).replace(/\r\n/g, '\n');
const HOST_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const SETTINGS_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'settingsPanel.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

function portalCard(): string {
  const start = WEBVIEW_SCRIPT.indexOf('function renderPortalAudience(');
  expect(start).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf('\n  function renderDirector(', start);
  expect(end).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the browser names a person and never their details', () => {
  it('posts a contact id alone', () => {
    const start = WEBVIEW_SCRIPT.indexOf("action === 'portal-add-viewer'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW_SCRIPT.slice(start, start + 600);
    expect(handler).toContain("type: 'addPortalViewer'");
    expect(handler).toContain('contactId: payload');
    // An address in a webview message would end up in a committed file, which
    // is exactly what the Director module avoids.
    expect(handler).not.toContain('email');
    expect(handler).not.toContain('handle');
  });

  it('resolves the id against the roster host-side before writing', () => {
    const start = HOST_SOURCE.indexOf('private async handlePortalViewer');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('contacts.some(contact => contact.id === contactId)');
  });

  it('sends only names and identifier kinds to the browser, never addresses', () => {
    const start = HOST_SOURCE.indexOf('function collectPortalHostingSnapshot');
    expect(start).toBeGreaterThan(0);
    const collector = HOST_SOURCE.slice(start, start + 3600);
    expect(collector).toContain('identifierKind');
    // `identifier` itself — the address — is deliberately not carried.
    expect(collector).not.toContain('identifier: member.identifier');
  });
});

describe('the surfaces keep saying AtlasMind does not enforce it', () => {
  it('states the rule on the Director card', () => {
    expect(portalCard()).toContain('AtlasMind declares; the host enforces');
  });

  it('says a sign-in admits every GitHub account', () => {
    expect(portalCard()).toContain('every GitHub account there is');
  });

  it('says an empty audience is not the same as nobody having access', () => {
    expect(portalCard()).toContain('not the same as nobody having access');
  });

  it('warns that removing somebody here does not revoke their access', () => {
    const start = HOST_SOURCE.indexOf('private async handlePortalViewer');
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('does not revoke their access');
  });

  it('states the same rule in Settings, where the host is chosen', () => {
    expect(SETTINGS_SOURCE).toContain('Authentication is not authorisation');
    expect(SETTINGS_SOURCE).toContain('where AtlasMind cannot see it');
  });
});

describe('confirming access is explicit and attributed', () => {
  it('asks before recording the claim', () => {
    const start = HOST_SOURCE.indexOf('private async handleConfirmPortalAccess');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('modal: true');
    expect(handler).toContain('AtlasMind cannot see');
    // And asks them to have actually checked, rather than to tick a box.
    expect(handler).toContain('private window');
  });

  it('records it against the person at this editor', () => {
    const start = HOST_SOURCE.indexOf('private async handleConfirmPortalAccess');
    const handler = HOST_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('selfContactId');
  });
});

describe('choosing a host', () => {
  it('validates against the declared list before writing', () => {
    const start = SETTINGS_SOURCE.indexOf('private async handleSetPortalHost');
    expect(start).toBeGreaterThan(0);
    const handler = SETTINGS_SOURCE.slice(start, start + 2000);
    expect(handler).toContain('PORTAL_HOST_CAPABILITIES.find');
  });

  it('warns when the chosen host cannot restrict to a named list', () => {
    const start = SETTINGS_SOURCE.indexOf('private async handleSetPortalHost');
    const handler = SETTINGS_SOURCE.slice(start, start + 2000);
    expect(handler).toContain("chosen.control !== 'named-audience'");
    expect(handler).toContain('showWarningMessage');
  });

  it('publishes what every host can actually enforce, rather than a bare list', () => {
    expect(SETTINGS_SOURCE).toContain('Can it restrict to people you name?');
    expect(SETTINGS_SOURCE).toContain('one shared password is not an audience');
  });
});

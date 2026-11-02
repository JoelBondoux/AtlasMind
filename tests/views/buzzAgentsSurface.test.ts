import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Director's *Buzz agents* card reports and opens three commands; it never
 * decides anything itself. Three properties are worth pinning, because
 * breaking any of them would turn a report into a control: the card posts only
 * allowlisted **command ids** (never a persona, a key or an argument); the
 * snapshot carries **no prompt, path, key material or message**; and the card
 * keeps saying that a copied recipe is **not** a running identity and that
 * default routing is unavailable.
 */

const WEBVIEW_SCRIPT = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8').replace(/\r\n/g, '\n');
const HOST_SOURCE = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8').replace(/\r\n/g, '\n');
const VIEW_SOURCE = readFileSync(path.join(process.cwd(), 'src', 'core', 'buzzPersonaDeployments.ts'), 'utf8').replace(/\r\n/g, '\n');

function card(): string {
  const start = WEBVIEW_SCRIPT.indexOf('function renderBuzzAgents(');
  expect(start).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf('\n  // ── Team workload', start);
  expect(end).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the Buzz agents card', () => {
  it('posts only the three persona commands, each allowlisted host-side', () => {
    const actions = [...card().matchAll(/data-action="([^"]+)" data-payload="([^"]+)"/g)].map(match => [match[1], match[2]]);
    expect(actions).toEqual([
      ['command', 'atlasmind.buzz.recommendPersonas'],
      ['command', 'atlasmind.buzz.preparePersonaDeployment'],
      ['command', 'atlasmind.buzz.verifyPersonaDeployment'],
    ]);
    const allowlist = HOST_SOURCE.slice(HOST_SOURCE.indexOf('const ALLOWED_DASHBOARD_COMMANDS'), HOST_SOURCE.indexOf('const EXPECTED_SSOT_DIRECTORIES'));
    for (const [, command] of actions) {
      expect(allowlist).toContain(`'${command}'`);
    }
  });

  it('escapes every value it renders from the committed persona file', () => {
    const body = card();
    for (const field of ['persona.displayName', 'persona.lead', 'persona.purpose', 'persona.stateDetail', 'problem', 'suggestion.displayName', 'view.file']) {
      expect(body).toContain(`escapeHtml(${field}`);
    }
    expect(body).not.toMatch(/\$\{persona\.(displayName|purpose|lead)\}/);
  });

  it('says that a copied recipe proves nothing, and that only mention-only is offered', () => {
    expect(card()).toContain('Copying a launch recipe proves nothing');
    expect(VIEW_SOURCE).toContain('copying a recipe does not show that an identity runs it');
    expect(card()).toContain('view.responseMode.reason');
  });

  it('carries no prompt, path or key material in the view', () => {
    const view = VIEW_SOURCE.slice(VIEW_SOURCE.indexOf('export interface BuzzPersonaCardPersona'), VIEW_SOURCE.indexOf('/** Rule 4'));
    expect(view).not.toMatch(/systemPrompt|manifestPath|secret|nsec|privateKey/i);
  });

  it('is absent when Buzz is off and there is no persona file', () => {
    const collector = HOST_SOURCE.slice(HOST_SOURCE.indexOf('function collectBuzzPersonasSnapshot('), HOST_SOURCE.indexOf('/**\n * The portal hosting declaration, assessed.'));
    expect(collector).toContain('if (!buzzEnabled && !read.exists)');
    expect(collector).toContain('return undefined;');
  });
});

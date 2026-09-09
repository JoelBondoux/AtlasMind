import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The utility packs render on the Gap Analysis page, served by
 * `src/views/projectDashboardPanel.ts`. Two properties are worth pinning here
 * rather than trusting, because breaking either would look like an ordinary
 * refactor and would turn a catalogue into an installer:
 *
 * the browser must post only a **capability id** — never a command, never a
 * package name, never the text an agent reads; and the card must publish the
 * date the vendor facts were read, so nothing on it reads as current when it is
 * a year old.
 */

const WEBVIEW_SCRIPT = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
);
const HOST_SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

function utilityCard(): string {
  const start = WEBVIEW_SCRIPT.indexOf('function renderUtilityPacks(');
  expect(start).toBeGreaterThan(0);
  const end = WEBVIEW_SCRIPT.indexOf('\n  // ──', start);
  expect(end).toBeGreaterThan(start);
  return WEBVIEW_SCRIPT.slice(start, end);
}

describe('the browser names a decision and never a command', () => {
  it('posts only the capability id', () => {
    const start = WEBVIEW_SCRIPT.indexOf("action === 'discuss-utility'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW_SCRIPT.slice(start, start + 520);
    expect(handler).toContain("type: 'discussUtilityPack'");
    expect(handler).toContain('capability: payload');
    expect(handler).not.toContain('install');
    expect(handler).not.toContain('draftPrompt');
  });

  it('rebuilds the prompt host-side from the declared pack', () => {
    const start = HOST_SOURCE.indexOf('private async handleDiscussUtilityPack');
    expect(start).toBeGreaterThan(0);
    const handler = HOST_SOURCE.slice(start, start + 900);
    expect(handler).toContain('UTILITY_PACKS.find');
    expect(handler).toContain('buildUtilityDecisionPrompt(pack)');
  });

  it('accepts no field that could carry a command', () => {
    const start = HOST_SOURCE.indexOf("type: 'discussUtilityPack';");
    expect(start).toBeGreaterThan(0);
    const declaration = HOST_SOURCE.slice(start, start + 120);
    expect(declaration).toContain('capability: string');
    expect(declaration).not.toContain('install');
    expect(declaration).not.toContain('command');
  });
});

describe('the card is honest about what it is', () => {
  it('publishes when the vendor facts were read', () => {
    expect(utilityCard()).toContain('vendor facts read');
  });

  it('says AtlasMind installs nothing and runs nothing', () => {
    expect(utilityCard()).toContain('installs nothing here and runs no command');
  });

  it('states what leaves the machine on every candidate', () => {
    const start = WEBVIEW_SCRIPT.indexOf('function renderUtilityCandidate(');
    expect(start).toBeGreaterThan(0);
    const candidate = WEBVIEW_SCRIPT.slice(start, WEBVIEW_SCRIPT.indexOf('\n  function renderUtilityPack(', start));
    expect(candidate).toContain('Leaves the machine:');
    // Where no install line was verified, the card says so rather than
    // showing nothing at all — an absent line must not read as "no install
    // needed".
    expect(candidate).toContain('has not verified an install line');
  });

  it('says an unread manifest is not a project using none of them', () => {
    expect(utilityCard()).toContain('not the same as this project using none of them');
  });

  it('warns against reading "not decided" as a gap', () => {
    // Plenty of projects need no payments and no translations.
    expect(utilityCard()).toContain('Plenty of projects need no payments');
  });
});

describe('the assessment degrades honestly with no manifest', () => {
  it('downgrades every pack to unassessed rather than reporting absent', () => {
    const start = HOST_SOURCE.indexOf('function collectUtilitiesSnapshot');
    expect(start).toBeGreaterThan(0);
    const collector = HOST_SOURCE.slice(start, start + 3000);
    expect(collector).toContain("evidence === undefined ? 'unassessed'");
    // And offers nothing, because an offer built on nothing observed is a
    // confident zero wearing a suggestion's clothes.
    expect(collector).toContain('offerable: evidence === undefined ? []');
  });
});

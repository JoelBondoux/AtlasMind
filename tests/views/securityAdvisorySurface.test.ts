import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The advisories card, asserted against the real sources.
 *
 * Everything drawn here is third-party text: an advisory summary is written by
 * whoever published the advisory, and a code-scanning message by whoever wrote
 * the query. It also carries the one control on this page that can send somebody
 * to another website, which is the part worth pinning: a webview that could name
 * a URL could name any URL, and `openExternal` hands it to the browser without
 * asking.
 *
 * These are properties that would still compile if they were broken.
 */

const WEBVIEW_SCRIPT = readFileSync(path.join(process.cwd(), 'media', 'projectDashboard.js'), 'utf8');
const HOST_PANEL = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');

function namedFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('the advisory card escapes everything it draws', () => {
  const card = namedFunction(WEBVIEW_SCRIPT, 'renderSecurityAdvisories');
  const item = namedFunction(WEBVIEW_SCRIPT, 'renderAdvisoryItem');

  it('escapes every advisory field, including the ones that look like numbers', () => {
    for (const field of ['item.title', 'item.subject', 'item.location', 'item.fixedIn']) {
      expect(item, `${field} reaches the DOM unescaped`).toContain(`escapeHtml(${field})`);
    }
    expect(item).toContain('escapeHtml(String(item.reference))');
    expect(item).toContain('escapeHtml(String(item.severity))');
  });

  it('escapes the summary and the note the host wrote', () => {
    expect(card).toContain('escapeHtml(String(sec.advisorySummary');
    expect(card).toContain('escapeHtml(String(feed.note))');
  });

  it('never interpolates a raw value into an attribute', () => {
    // `escapeAttr` and not `escapeHtml` for attributes: the backtick matters
    // inside one and does not outside.
    const attributes = [...item.matchAll(/data-payload="\$\{([^}]+)\}/g)].map(match => match[1] ?? '');
    expect(attributes.length).toBeGreaterThan(0);
    expect(attributes.every(expression => expression.includes('escapeAttr('))).toBe(true);
  });
});

describe('the Open button cannot choose where the browser goes', () => {
  const item = namedFunction(WEBVIEW_SCRIPT, 'renderAdvisoryItem');

  it('sends an opaque reference, never the advisory URL', () => {
    expect(item).toContain("data-action=\"advisory-open\"");
    expect(item).toContain("item.source + ':' + item.reference");
    // The URL decides *whether* a button is drawn and is never the payload.
    expect(item).not.toContain('data-payload="${escapeAttr(item.url)}"');
  });

  it('is resolved host-side against the advisories that were actually read', () => {
    const handler = HOST_PANEL.slice(
      HOST_PANEL.indexOf('private async handleOpenAdvisory('),
      HOST_PANEL.indexOf('private async handleSetWorkflowGate('),
    );
    expect(handler).toContain('buildAdvisoryFeed(this.advisoryState)');
    expect(handler).toContain('feed.items.find');
    // The payload is compared, never parsed into a URL.
    expect(handler).not.toContain('Uri.parse(reference');
    expect(handler).toContain('vscode.Uri.parse(match.url)');
  });

  it('validates the message as a bounded string rather than a URL', () => {
    const validator = HOST_PANEL.slice(HOST_PANEL.indexOf("candidate['type'] === 'openAdvisory'"));
    expect(validator.slice(0, 400)).toContain("typeof candidate['payload'] === 'string'");
    expect(validator.slice(0, 400)).toContain('length <= 120');
  });
});

describe('advisories are read on the repository refresh, never on render', () => {
  it('calls the endpoints only from the panel, not from the snapshot collector', () => {
    // These are rate-limited API calls, and the Security page re-renders on
    // every keystroke elsewhere in the panel.
    const collector = HOST_PANEL.slice(HOST_PANEL.indexOf('async function collectDashboardSnapshot('));
    expect(collector).not.toContain('dependabot/alerts');
    expect(collector).not.toContain('code-scanning/alerts');
    expect(HOST_PANEL).toContain('repos/${slug}/dependabot/alerts');
    expect(HOST_PANEL).toContain('repos/${slug}/code-scanning/alerts');
  });

  it('classifies a switched-off feature apart from a failed read', () => {
    // A 403/404 from these endpoints is GitHub saying the feature is off, which
    // is a finding about the repository rather than a fault in the read.
    const reader = HOST_PANEL.slice(
      HOST_PANEL.indexOf('private async readAdvisories('),
      HOST_PANEL.indexOf('private classifyIssueFailure('),
    );
    expect(reader).toContain("state: 'disabled'");
    expect(reader).toContain("state: 'failed'");
    expect(reader).toContain("state: 'ready'");
  });

  it('passes the panel-held advisories into the snapshot rather than collecting them there', () => {
    // The claim is that `advisoryState` is handed in from the panel, right
    // after the build ledger — not that it is the last argument. Pinning the
    // statement terminator made this fail the first time a later parameter was
    // added, which reads as a broken feature rather than a moved comma.
    expect(HOST_PANEL).toContain('this.readCiBuildLedger(), this.advisoryState');
  });
});

describe('the hand-off to an agent', () => {
  it('sends the same opaque reference, never the prompt', () => {
    const item = namedFunction(WEBVIEW_SCRIPT, 'renderAdvisoryItem');
    expect(item).toContain('data-action="advisory-work"');
    // The webview names the advisory; it never composes what the agent is told.
    expect(item).not.toContain('draftPrompt');
    expect(item).not.toContain('buildAdvisoryWorkPrompt');
  });

  it('builds the prompt host-side from the advisory that was read', () => {
    const handler = HOST_PANEL.slice(
      HOST_PANEL.indexOf('private async handleWorkOnAdvisory('),
      HOST_PANEL.indexOf('Turn a `gh` failure into the specific thing'),
    );
    expect(handler).toContain('buildAdvisoryFeed(this.advisoryState)');
    expect(handler).toContain('buildAdvisoryWorkPrompt(match)');
    // A stale reference tells the user rather than opening an empty chat.
    expect(handler).toContain('no longer in the feed');
  });
});

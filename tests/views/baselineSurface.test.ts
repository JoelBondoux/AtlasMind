import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Named baselines are the only records on this dashboard that cannot be
 * recovered from anywhere else — the reading they hold was taken at a moment
 * that has passed. Four properties are pinned rather than trusted.
 */

const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
).replace(/\r\n/g, '\n');
const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('the browser names a baseline and never describes one', () => {
  it('posts an opaque id to remove or select, and no snapshot', () => {
    const remove = WEBVIEW.slice(
      WEBVIEW.indexOf("action === 'baseline-remove'"),
      WEBVIEW.indexOf("action === 'director-contact-add'"),
    );
    expect(remove).toContain("type: 'removeBaseline'");
    // A message that could carry a reading could rewrite what a baseline says
    // happened, which is the one thing nothing else can check.
    expect(remove).not.toContain('snapshot');
    expect(remove).not.toContain('takenAt');
  });

  it('captures from the reading already on screen rather than re-gathering one', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleCaptureBaseline'),
      PANEL.indexOf('private async handleRemoveBaseline'),
    );
    expect(handler).toContain('this.lastSnapshot?.guidedWorkflow.observed');
    // Re-reading would capture a moment nobody looked at.
    expect(handler).not.toContain('collectDashboardSnapshot');
  });
});

describe('removing a baseline is confirmed, and names what is lost', () => {
  it('asks in a modal that says the span cannot be recovered', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async handleRemoveBaseline'),
      PANEL.indexOf('private async handleSelectBaseline'),
    );
    expect(handler).toContain('modal: true');
    expect(handler).toContain('cannot be recovered');
    // Nothing expires or is evicted, so this dialog is the whole safeguard.
    expect(handler).toContain('removeBaseline(register, id)');
  });
});

describe('the comparison is never shown without its age', () => {
  it('renders the span the module composed rather than a count of its own', () => {
    const card = WEBVIEW.slice(
      WEBVIEW.indexOf('const baselineCard = `'),
      WEBVIEW.indexOf('// The gates, as controls rather than a read-out'),
    );
    expect(card.length).toBeGreaterThan(500);
    expect(card).toContain('chosen.span');
    // The span carries the age. A card computing its own headline could print
    // the changes and leave the six weeks they took out of it.
    expect(card).not.toMatch(/ageDays\s*\)\s*\+\s*'/);
  });

  it('says so when the baseline is old', () => {
    const card = WEBVIEW.slice(
      WEBVIEW.indexOf('const baselineCard = `'),
      WEBVIEW.indexOf('// The gates, as controls rather than a read-out'),
    );
    expect(card).toContain("chosen.staleness === 'old'");
  });
});

describe('one comparison, and it is read-only', () => {
  it('builds the baseline view without advancing anything', () => {
    const builder = PANEL.slice(
      PANEL.indexOf('function buildBaselineView'),
      PANEL.indexOf('function readBaselineRegister'),
    );
    expect(builder).toContain('compareAgainstBaseline');
    // `resolveObservedDelta` advances its watermark as a side effect of being
    // read. This must not: a named baseline means the moment somebody chose.
    expect(builder).not.toContain('.update(');
    expect(builder).not.toContain('takeObservedSnapshot');
  });
});

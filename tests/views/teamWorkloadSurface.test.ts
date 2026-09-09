import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The workload card shows how much work each named person is carrying, which
 * makes it the one surface here that could quietly turn into a performance
 * board. Four properties are pinned rather than trusted.
 */

const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectDashboard.js'),
  'utf8',
).replace(/\r\n/g, '\n');
const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
).replace(/\r\n/g, '\n');

/** The card's own source, so an assertion cannot pass on another card's text. */
const CARD = WEBVIEW.slice(
  WEBVIEW.indexOf('function renderTeamWorkload(snapshot) {'),
  WEBVIEW.indexOf('function renderDirector(snapshot) {'),
);

describe('the card states what it is not', () => {
  it('renders the caveat from the summary rather than a copy of its own', () => {
    expect(CARD.length).toBeGreaterThan(500);
    expect(CARD).toContain('w.caveat');
    // Before the numbers. A footnote under a per-person board is read by
    // nobody, which is the same as not saying it.
    expect(CARD.indexOf('w.caveat')).toBeLessThan(CARD.indexOf('w.members.length'));
  });

  it('publishes the rules that read the allocations, from the payload', () => {
    expect(CARD).toContain('w.capacityRules');
    expect(PANEL).toContain('summarizeTeamWorkload');
  });
});

describe('the card offers no way to move somebody else work', () => {
  it('has no reassign, rebalance or auto-assign control', () => {
    // Read off the actions rather than the prose: the card's own copy says it
    // reassigns nobody, and matching that sentence would pass for the wrong
    // reason the moment somebody added the button and kept the note.
    const actions = [...CARD.matchAll(/data-action="([a-z-]+)"/g)].map(match => match[1]);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action).not.toMatch(/reassign|rebalance|redistribute|assign/);
    }
    expect(CARD).toContain('not a button');
  });
});

describe('the browser refuses a period it cannot read rather than repairing one', () => {
  it('checks the dates before posting, and never rewrites them', () => {
    const start = WEBVIEW.indexOf("action === 'workload-absence-save'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW.slice(start, WEBVIEW.indexOf("action === 'workload-absence-remove'", start));
    expect(handler).toContain('if (!contactId || !from || !to || to < from) { return; }');
    expect(handler).not.toContain('new Date(');
  });
});

describe('an emptied allocation goes back to unknown', () => {
  it('deletes the field rather than storing an empty string', () => {
    const start = WEBVIEW.indexOf("action === 'workload-allocation-save'");
    expect(start).toBeGreaterThan(0);
    const handler = WEBVIEW.slice(start, WEBVIEW.indexOf("action === 'workload-absence-add'", start));
    // Storing '' would read as a declared allocation that parses as nothing,
    // which is a different claim from nobody having declared one.
    expect(handler).toContain('delete member.allocation');
  });
});

describe('the host builds the reading, the browser only displays it', () => {
  it('computes the workload beside the snapshot rather than in the webview', () => {
    expect(PANEL).toContain('collectTeamWorkloadSnapshot');
    expect(PANEL).toContain('TEAM_WORKLOAD_WINDOW_DAYS');
    // No second verdict vocabulary in the browser: a card that graded members
    // itself could disagree with the summary printed above it.
    expect(CARD).not.toContain('estimatedDays >');
  });

  it('counts only outstanding work', () => {
    expect(PANEL).toContain('.filter(node => !node.completed)');
  });
});

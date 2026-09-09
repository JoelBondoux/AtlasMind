import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The brief is the one thing on the board that is unambiguously the user's own
 * words, and everything derived from it is checked against it. Four properties
 * are pinned rather than trusted.
 */

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectIdeationPanel.ts'),
  'utf8',
).replace(/\r\n/g, '\n');
const WEBVIEW = readFileSync(
  path.join(process.cwd(), 'media', 'projectIdeation.js'),
  'utf8',
).replace(/\r\n/g, '\n');

describe('the reading is grounded against the file, not against the message', () => {
  it('takes no brief text from the derive message', () => {
    const handler = WEBVIEW.slice(
      WEBVIEW.indexOf("action === 'ideation-brief-derive'"),
      WEBVIEW.indexOf("action === 'ideation-brief-open'"),
    );
    expect(handler).toContain("type: 'deriveFromProjectBrief'");
    // A webview supplying both the claim and the evidence for it would make the
    // quote check meaningless.
    expect(handler).not.toContain('payload:');
  });

  it('re-reads the brief from disk before parsing', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async deriveFromProjectBrief'),
      PANEL.indexOf('private describeBriefProposal'),
    );
    expect(handler).toContain('await this.readProjectBrief(workspaceRoot)');
    expect(handler).toContain('parseBriefProposal(reconciled.transcriptText, brief)');
  });
});

describe('nothing is written without being shown first', () => {
  it('confirms with the cards themselves before seeding', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async deriveFromProjectBrief'),
      PANEL.indexOf('private describeBriefProposal'),
    );
    expect(handler).toContain('modal: true');
    expect(handler).toContain('this.describeBriefProposal(proposal)');
    // The confirmation must come before the write, not after it.
    expect(handler.indexOf('modal: true')).toBeLessThan(handler.indexOf('seedBoardTemplate'));
  });

  it('lists every card, marking the ones that are questions', () => {
    const detail = PANEL.slice(
      PANEL.indexOf('private describeBriefProposal'),
      PANEL.indexOf('private async collectBriefSummary'),
    );
    expect(detail).toContain('for (const card of proposal.cards)');
    expect(detail).toContain('card.question');
    expect(detail).toContain('quoting:');
  });

  it('confirms before replacing a brief that already exists', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async captureProjectBrief'),
      PANEL.indexOf('private async deriveFromProjectBrief'),
    );
    expect(handler).toContain('modal: true');
    expect(handler).toContain('cannot be undone');
  });
});

describe('one writer for cards', () => {
  it('seeds the derived board through the board seeder rather than a second one', () => {
    expect(PANEL).toContain('await this.seedBoardTemplate(briefToBoardTemplate(proposal))');
    // The seeder takes either a declared frame's id or a built template; there
    // is still exactly one thing that writes cards.
    expect(PANEL).toContain('private async seedBoardTemplate(source: string | IdeationBoardTemplate)');
  });
});

describe('capturing and deriving are separate acts', () => {
  it('does not derive as a side effect of saving', () => {
    const handler = PANEL.slice(
      PANEL.indexOf('private async captureProjectBrief'),
      PANEL.indexOf('private async deriveFromProjectBrief'),
    );
    expect(handler).toContain('renderBriefDocument');
    // A save that also filled the board would put a model's reading of one
    // paragraph into a committed file nobody had read yet.
    expect(handler).not.toContain('parseBriefProposal');
    expect(handler).not.toContain('seedBoardTemplate');
  });
});

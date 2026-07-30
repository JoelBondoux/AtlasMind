import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The loop from the ideation board into the workflow, and back.
 *
 * The board had nine card kinds and two outbound paths — launch an autonomous
 * run, or append prose to a memory file. Neither reached the backlog, so the
 * eight-stage workflow began at stage 1 with nothing feeding it.
 */

const ROOT = process.cwd();

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), 'utf8');
}

const IDEATION = read('src', 'views', 'projectIdeationPanel.ts');
const IDEATION_CLIENT = read('media', 'projectIdeation.js');
const DASHBOARD = read('src', 'views', 'projectDashboardPanel.ts');
const DASHBOARD_CLIENT = read('media', 'projectDashboard.js');

describe('a card can become a roadmap item', () => {
  it('sends only a card id, and never the wording', () => {
    // A line that lands in a git-tracked file is not composed in a webview.
    expect(IDEATION_CLIENT).toContain("type: 'raiseCardAsWork'");
    const handler = IDEATION_CLIENT.slice(
      IDEATION_CLIENT.indexOf("if (action === 'ideation-raise-work')"),
      IDEATION_CLIENT.indexOf("if (action === 'ideation-sync-card')"),
    );
    expect(handler).toContain('payload: { cardId: state.selectedCardId }');
    // The whole message, and nothing in it but an id.
    expect(handler).not.toMatch(/title:|body:|roadmapText/);
  });

  it('shows the exact line before writing it', () => {
    const handler = IDEATION.slice(
      IDEATION.indexOf('private async raiseCardAsWork'),
      IDEATION.indexOf('private async syncCardToSsot'),
    );
    expect(handler).toContain('modal: true');
    expect(handler).toContain('detailParts');
    expect(handler).toMatch(/tracked file/);
  });

  it('refuses the two kinds that are not work, and says why', () => {
    const handler = IDEATION.slice(
      IDEATION.indexOf('private async raiseCardAsWork'),
      IDEATION.indexOf('private async syncCardToSsot'),
    );
    expect(handler).toContain('isDerivableCardKind(card.kind)');
    expect(handler).toMatch(/is not work in itself/);
  });

  it('records provenance only after the write succeeded', () => {
    // A card claiming to have produced an item that does not exist is worse than
    // one that produced nothing.
    const handler = IDEATION.slice(
      IDEATION.indexOf('private async raiseCardAsWork'),
      IDEATION.indexOf('private async syncCardToSsot'),
    );
    const write = handler.indexOf('addRoadmapItemFromExternalSurface');
    const record = handler.indexOf('board.cards[cardIndex].derived =');
    expect(write).toBeGreaterThan(-1);
    expect(record).toBeGreaterThan(write);
    expect(handler).toContain('if (!written) {');
  });

  it('uses one roadmap writer, not a second copy of the serializer', () => {
    // The markdown format is load-bearing for a tracked file. Two writers would
    // drift, and the first symptom would be a roadmap the dashboard cannot parse.
    expect(DASHBOARD).toContain('export async function addRoadmapItemFromExternalSurface');
    expect(IDEATION).toContain("import { addRoadmapItemFromExternalSurface } from './projectDashboardPanel.js';");
    expect(IDEATION).not.toContain('ROADMAP_ITEMS_START');
    expect(IDEATION).not.toContain('serializeDashboardRoadmapDocument');
  });

  it('returns the normalized text rather than an id, because ids move', () => {
    const seam = DASHBOARD.slice(
      DASHBOARD.indexOf('export async function addRoadmapItemFromExternalSurface'),
      DASHBOARD.indexOf('function serializeDashboardRoadmapDocument('),
    );
    expect(seam).toContain('normalized: normalizeRoadmapText(stripped.text)');
    expect(seam).toMatch(/positional/);
  });

  it('does not import the ideation panel from the dashboard, so there is no cycle', () => {
    expect(DASHBOARD).not.toContain('projectIdeationPanel.js');
  });
});

describe('the board records what a card became', () => {
  it('keeps the derivation through the sanitizer', () => {
    // The sanitizer builds a fresh object, so a field it does not name is dropped.
    expect(IDEATION).toContain('function sanitizeDerivedRecord');
    expect(IDEATION).toContain('sanitizeDerivedRecord(card.derived)');
    expect(DASHBOARD).toMatch(/\{ derived: card\.derived \}/);
  });

  it('recomputes the normalization rather than trusting the file', () => {
    // A hand-edited board must not hold a normalization that no longer matches
    // how the roadmap compares text.
    const sanitizer = IDEATION.slice(
      IDEATION.indexOf('function sanitizeDerivedRecord'),
      IDEATION.indexOf('function isIdeationSyncTarget'),
    );
    expect(sanitizer).toContain('roadmapNormalized: normalizeForRoadmapMatch(');
  });

  it('drops a partial record rather than keeping half of one', () => {
    const sanitizer = IDEATION.slice(
      IDEATION.indexOf('function sanitizeDerivedRecord'),
      IDEATION.indexOf('function isIdeationSyncTarget'),
    );
    expect(sanitizer).toContain("if (text === '') {");
    expect(sanitizer).toContain('return undefined;');
  });

  it('shows it on the card, with a route onward', () => {
    expect(IDEATION_CLIENT).toContain('function renderWorkHandoff');
    expect(IDEATION_CLIENT).toMatch(/On the roadmap/);
    expect(IDEATION_CLIENT).toMatch(/this card keeps the reasoning/);
  });
});

describe('the roadmap says where an item came from', () => {
  it('joins on normalized text, not an id', () => {
    const joiner = DASHBOARD.slice(
      // From the doc comment, not the signature: the reason lives above it.
      DASHBOARD.indexOf("Attach each roadmap item's ideation origin"),
      DASHBOARD.indexOf('function serializeDashboardRoadmapDocument('),
    );
    expect(joiner).toContain('normalizeForRoadmapMatch(item.text)');
    expect(joiner).toMatch(/positional/);
  });

  it('re-derives the suggestion list, so it is not left un-attached', () => {
    const joiner = DASHBOARD.slice(
      // From the doc comment, not the signature: the reason lives above it.
      DASHBOARD.indexOf("Attach each roadmap item's ideation origin"),
      DASHBOARD.indexOf('function serializeDashboardRoadmapDocument('),
    );
    expect(joiner).toContain('nextSuggestedWork: roadmap.nextSuggestedWork.map(attach)');
  });

  it('shows the origin on the item', () => {
    expect(DASHBOARD_CLIENT).toContain('item.origin');
    expect(DASHBOARD_CLIENT).toMatch(/from ideation/);
  });

  it('needs no extra read, because the board is already loaded per snapshot', () => {
    expect(DASHBOARD).toContain('withIdeationOrigins(roadmapSnapshot, ideationBoard)');
  });
});

describe('the board\'s reasoning reaches the issue', () => {
  it('appends the evidence when the item came from a card', () => {
    expect(DASHBOARD).toContain('private async appendCardEvidence');
    expect(DASHBOARD).toContain('this.appendCardEvidence(draft.body, item.origin?.cardId)');
    expect(DASHBOARD).toContain('## From the ideation board');
  });

  it('recomputes from the board as it is now, not from a stored snapshot', () => {
    // A connection added since the item was raised is still true, and an issue
    // quoting a month-old view of the board would be quietly wrong.
    const helper = DASHBOARD.slice(
      DASHBOARD.indexOf('private async appendCardEvidence'),
      DASHBOARD.indexOf('* Open the GitHub page a dashboard page is about.'),
    );
    expect(helper).toContain('loadIdeationBoard(');
    expect(helper).toContain('collectCardConnectionSources(board.cards, board.connections, card.id)');
  });

  it('returns the body unchanged when there is no card, rather than failing', () => {
    const helper = DASHBOARD.slice(
      DASHBOARD.indexOf('private async appendCardEvidence'),
      DASHBOARD.indexOf('* Open the GitHub page a dashboard page is about.'),
    );
    expect(helper).toContain('if (cardId === undefined) {');
    expect(helper).toContain('if (card === undefined) {');
  });

  it('shares one edge collector, because direction must not disagree', () => {
    // "This depends on X" and "X depends on this" are opposite plans.
    expect(DASHBOARD).toContain('collectCardConnectionSources');
    expect(IDEATION).toContain('collectCardConnectionSources(board.cards, board.connections, card.id)');
    // Defined in exactly one place.
    expect(IDEATION).not.toContain('function collectCardConnectionSources');
    expect(DASHBOARD).not.toContain('function collectCardConnectionSources');
  });
});

describe('the dashboard reads the board with a current vocabulary', () => {
  it('recognises the kinds the ideation panel actually writes', () => {
    // Five of the nine were coerced to `concept`, and `summarizeIdeationBoard`
    // renders the kind into a model prompt — so a `problem` and an `idea` arrived
    // indistinguishable, erasing the distinction card kinds exist to make.
    const guard = DASHBOARD.slice(
      DASHBOARD.indexOf('function isIdeationCardKind'),
      DASHBOARD.indexOf('function normalizeIdeationColor'),
    );
    for (const kind of ['idea', 'problem', 'requirement', 'user-insight', 'evidence']) {
      expect(guard, kind).toContain(`'${kind}'`);
    }
  });

  it('still recognises the legacy kinds, which are really on disk', () => {
    const guard = DASHBOARD.slice(
      DASHBOARD.indexOf('function isIdeationCardKind'),
      DASHBOARD.indexOf('function normalizeIdeationColor'),
    );
    for (const kind of ['concept', 'insight', 'question', 'opportunity', 'user-need']) {
      expect(guard, kind).toContain(`'${kind}'`);
    }
  });

  it('falls back to a current kind, not a legacy one', () => {
    expect(DASHBOARD).toContain("kind: isIdeationCardKind(card.kind) ? card.kind : 'idea',");
  });

  it('reads the typed relations, which it could not see at all before', () => {
    expect(DASHBOARD).toContain('function isIdeationRelation');
    expect(DASHBOARD).toContain('function isIdeationDirection');
    expect(DASHBOARD).toContain("relation: isIdeationRelation(connection.relation) ? connection.relation : 'supports'");
  });

  it('does not require relation or direction, so an older board keeps its graph', () => {
    const guard = DASHBOARD.slice(
      DASHBOARD.indexOf('function isIdeationConnectionRecord'),
      DASHBOARD.indexOf('function createDefaultIdeationWorkspaceRecord'),
    );
    expect(guard).not.toContain("candidate['relation']");
    expect(guard).toMatch(/deliberately not required/);
  });

  it('gives a model-suggested link the weakest honest relation', () => {
    // A `dependency` reorders work and a `contradiction` becomes a caution on any
    // issue raised from the card. Neither should come from an unreviewed guess.
    expect(DASHBOARD).toContain("relation: 'supports' as const,");
  });
});

describe('what is left on the board is visible beside the backlog', () => {
  it('counts unrealized cards on the roadmap snapshot', () => {
    expect(DASHBOARD).toContain('boardBacklog: countUnrealizedByKind(');
  });

  it('renders nothing when the board is empty', () => {
    // A project with no board should not be told it has nothing on it.
    const card = DASHBOARD_CLIENT.slice(
      DASHBOARD_CLIENT.indexOf('function boardBacklogCard'),
      DASHBOARD_CLIENT.indexOf('function renderRoadmap(snapshot)'),
    );
    expect(card).toContain('if (backlog.total === 0)');
    expect(card).toContain("return '';");
  });

  it('distinguishes cards that matter from cards that are just ideas', () => {
    const card = DASHBOARD_CLIENT.slice(
      DASHBOARD_CLIENT.indexOf('function boardBacklogCard'),
      DASHBOARD_CLIENT.indexOf('function renderRoadmap(snapshot)'),
    );
    expect(card).toMatch(/problems, requirements or risks/);
    expect(card).toMatch(/a board is for holding ideas/);
  });

  it('sits on the Roadmap page, beside the thing it is about', () => {
    expect(DASHBOARD_CLIENT).toContain('${boardBacklogCard(roadmap)}');
  });
});

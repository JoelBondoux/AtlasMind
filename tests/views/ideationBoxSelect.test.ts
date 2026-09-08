import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Box selection on the ideation board, and the one selection it shares.
 *
 * The board already had `orderedSelectedCardIds`, but it meant *the two cards I
 * am linking* — numbered badges, a "Link source" and a "Link target". A box
 * selection could have been a second, parallel list. It is not: one selection
 * with two uses is easier to explain than two selections that both mean
 * "selected", and the badges already number arbitrarily.
 *
 * The cost of merging is that "which two am I linking" stops having an answer
 * once more than two are selected, and the honest response there is to refuse
 * rather than to pick two. That refusal is the property most worth pinning,
 * because the alternative — drawing an edge between whichever two happened to
 * come last — is silent and wrong.
 */

const BOARD = readFileSync(path.join(process.cwd(), 'media', 'projectIdeation.js'), 'utf8');
const PANEL = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectIdeationPanel.ts'), 'utf8');

function boardFunction(name: string): string {
  const start = BOARD.indexOf(`function ${name}(`);
  expect(start, `${name} is missing from the ideation board script`).toBeGreaterThan(-1);
  const next = BOARD.indexOf('\n  function ', start + 1);
  return BOARD.slice(start, next === -1 ? undefined : next);
}

describe('a box selection and a link pair are the same list', () => {
  it('writes the box result into the selection a click also builds', () => {
    const select = boardFunction('selectCardsInBox');

    expect(select).toContain('state.orderedSelectedCardIds = picked;');
    // A second parallel list would be the alternative design, and this is the
    // assertion that says it was not taken.
    expect(BOARD).not.toContain('boxSelectedCardIds');
  });

  it('refuses to link when more than two are selected', () => {
    // `getOrderedSelectedCards` takes the last two, which is exactly right for
    // a click sequence and arbitrary for a box.
    const link = boardFunction('createLinkFromSelection');

    expect(link).toContain('state.orderedSelectedCardIds.length > 2');
    expect(link).toMatch(/Linking needs exactly two cards/);
    // The refusal must come before the pair is used, or it refuses nothing.
    expect(link.indexOf('length > 2')).toBeLessThan(link.indexOf('orderedPair.length < 2'));
  });

  it('still links a plain two-card selection', () => {
    const link = boardFunction('createLinkFromSelection');
    expect(link).toContain('Select two cards in sequence before creating a link.');
  });
});

describe('the box selects what it touches', () => {
  it('uses intersection rather than containment', () => {
    // Requiring a card to sit wholly inside the box means one clipped by the
    // viewport edge cannot be selected without zooming out, which on a full
    // board is most of them.
    const select = boardFunction('selectCardsInBox');

    expect(select).toContain('(card.x + CARD_WIDTH) >= rect.left');
    expect(select).toContain('card.x <= rect.right');
    expect(select).toContain('(card.y + CARD_HEIGHT) >= rect.top');
    expect(select).toContain('card.y <= rect.bottom');
  });

  it('reads the transform off the element rather than recomputing it', () => {
    // Deriving the point from viewportX/Y and zoom would be a second copy of
    // the transform, and the two would drift the first time either changed.
    const toCardSpace = boardFunction('boardPointToCardSpace');

    expect(toCardSpace).toContain('getBoundingClientRect()');
    expect(toCardSpace).not.toContain('state.viewportX');
  });
});

describe('a group drag moves every member from its own origin', () => {
  it('captures each origin once, at press', () => {
    // Reading them per frame compounds rounding across a drag and every card
    // drifts.
    expect(BOARD).toContain('originX: member.x, originY: member.y');
  });

  it('drags only the pressed card when it is outside the selection', () => {
    expect(BOARD).toContain('state.orderedSelectedCardIds.indexOf(cardId) >= 0');
    expect(BOARD).toContain('const groupIds = inSelection ? state.orderedSelectedCardIds.slice() : [cardId];');
  });

  it('clamps every member, not just the pressed one', () => {
    // Two clamping paths would let a card stop at the board edge alone but not
    // in a group.
    const move = BOARD.slice(BOARD.indexOf("if (state.drag.kind === 'card')"));
    expect(move.slice(0, 1200)).toContain('clampNumber(member.originX + dx, MIN_CARD_X, MAX_CARD_X)');
    expect(move.slice(0, 1200)).toContain('clampNumber(member.originY + dy, MIN_CARD_Y, MAX_CARD_Y)');
  });
});

describe('panning is not taken away to add selection', () => {
  it('puts the box behind Shift and leaves a plain drag panning', () => {
    const shift = BOARD.indexOf('if (event.shiftKey && !isProjectedLens(state.boardLens))');
    expect(shift, 'the marquee is not gated on Shift').toBeGreaterThan(-1);
    // The pan branch still exists after it.
    expect(BOARD.slice(shift)).toContain("kind: 'canvas',");
  });

  it('does not offer a box on a projected lens, where positions are derived', () => {
    // The same reason card dragging is refused there: the stored x/y is not
    // what is on screen, so a selection rectangle would name the wrong cards.
    expect(BOARD).toContain('event.shiftKey && !isProjectedLens(state.boardLens)');
  });
});

describe('the marquee cannot intercept its own drag', () => {
  it('is drawn with pointer events off', () => {
    const style = PANEL.slice(PANEL.indexOf('.ideation-marquee'));
    expect(style.slice(0, 260)).toContain('pointer-events: none');
  });
});

import { describe, expect, it } from 'vitest';

import { PROJECT_ARCHETYPES } from '../../src/core/projectArchetype.js';
import { isDerivableCardKind } from '../../src/core/ideationDerivation.js';
import {
  allBoardTemplates,
  findBoardTemplate,
  GENERAL_BOARD_TEMPLATES,
  suggestBoardTemplates,
} from '../../src/core/ideationBoardTemplates.js';

describe('every template is well formed', () => {
  it('has unique ids', () => {
    const ids = allBoardTemplates().map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only seeds card kinds the board can turn into work', () => {
    // A template that seeded `atlas-response` or `attachment` would produce
    // cards that can never leave the board.
    for (const template of allBoardTemplates()) {
      for (const card of template.cards) {
        expect(isDerivableCardKind(card.kind), `${template.id}/${card.key}`).toBe(true);
      }
    }
  });

  it('only draws edges between cards it declares', () => {
    for (const template of allBoardTemplates()) {
      const keys = new Set(template.cards.map(card => card.key));
      for (const edge of template.edges) {
        expect(keys.has(edge.from), `${template.id}: ${edge.from}`).toBe(true);
        expect(keys.has(edge.to), `${template.id}: ${edge.to}`).toBe(true);
      }
    }
  });

  it('uses unique card keys within a template', () => {
    for (const template of allBoardTemplates()) {
      const keys = template.cards.map(card => card.key);
      expect(new Set(keys).size, template.id).toBe(keys.length);
    }
  });

  it('phrases every seeded card as something to fill in', () => {
    // A template is a set of questions, not a set of answers. A seeded card that
    // reads as a conclusion is thinking nobody did, presented as thinking
    // somebody did.
    for (const template of allBoardTemplates()) {
      for (const card of template.cards) {
        expect(card.body.length, `${template.id}/${card.key}`).toBeGreaterThan(20);
      }
      const questions = template.cards.filter(card => card.title.endsWith('?')).length;
      expect(questions, template.id).toBeGreaterThanOrEqual(Math.ceil(template.cards.length / 2));
    }
  });

  it('says when each frame is the right one', () => {
    for (const template of allBoardTemplates()) {
      expect(template.whenToUse.length, template.id).toBeGreaterThan(20);
    }
  });
});

describe('suggestions are derived from the project', () => {
  it('always offers the general frames, whatever was detected', () => {
    for (const archetype of PROJECT_ARCHETYPES) {
      const suggested = suggestBoardTemplates({ archetype, traits: [] });
      for (const general of GENERAL_BOARD_TEMPLATES) {
        expect(suggested.some(template => template.id === general.id), archetype).toBe(true);
      }
    }
  });

  it('leads with the archetype frame and says why it was offered', () => {
    const suggested = suggestBoardTemplates({ archetype: 'game', traits: [] });
    expect(suggested[0]!.id).toBe('game-loop');
    expect(suggested[0]!.suggestedBecause).toContain('game');
  });

  it('offers a trait frame alongside the archetype one', () => {
    const suggested = suggestBoardTemplates({ archetype: 'web-app', traits: ['handles-personal-data'] });
    expect(suggested.map(template => template.id).slice(0, 2)).toEqual(['web-app-flow', 'personal-data']);
    expect(suggested[1]!.suggestedBecause).toContain('handles-personal-data');
  });

  it('offers only the general frames for a project it could not classify', () => {
    const suggested = suggestBoardTemplates({ archetype: 'generic', traits: [] });
    expect(suggested).toHaveLength(GENERAL_BOARD_TEMPLATES.length);
    expect(suggested.every(template => template.suggestedBecause === undefined)).toBe(true);
  });

  it('never suggests the same frame twice', () => {
    const suggested = suggestBoardTemplates({ archetype: 'web-app', traits: ['handles-personal-data', 'platform-hosted'] });
    const ids = suggested.map(template => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('lookup', () => {
  it('resolves a declared id and refuses anything else', () => {
    expect(findBoardTemplate('assumption-map')?.label).toBe('Assumption map');
    expect(findBoardTemplate('game-loop')?.label).toBe('Core loop');
    expect(findBoardTemplate('nope')).toBeUndefined();
  });
});

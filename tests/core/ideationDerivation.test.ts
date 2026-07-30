import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildCardEvidenceSection,
  countUnrealizedByKind,
  deriveCardRoadmapText,
  DERIVABLE_CARD_KINDS,
  isDerivableCardKind,
  MAX_DERIVED_ITEM_LENGTH,
  MAX_EVIDENCE_LINES,
  NAGGABLE_CARD_KINDS,
  normalizeForRoadmapMatch,
  resolveDerivedRoadmapItem,
  unrealizedCards,
  type IdeationCardSource,
  type IdeationConnectionSource,
  type IdeationDerivedRecord,
} from '../../src/core/ideationDerivation.js';

function card(overrides: Partial<IdeationCardSource> = {}): IdeationCardSource {
  return { id: 'card-3', title: 'Webhook endpoint has no rate limit', kind: 'problem', ...overrides };
}

function edge(overrides: Partial<IdeationConnectionSource> = {}): IdeationConnectionSource {
  return { relation: 'dependency', direction: 'forward', otherTitle: 'Shared token store', outgoing: true, ...overrides };
}

function item(text: string, id = 'roadmap-1'): { id: string; text: string; completed: boolean } {
  return { id, text, completed: false };
}

describe('focus is not decided here', () => {
  it('does not classify, so there is only ever one focus rule', () => {
    // `prioritizeDashboardRoadmapItems` already derives focus from item text with
    // one published keyword table. A second classifier keyed on card kind would
    // eventually disagree, and the disagreement would show as an item whose
    // priority reason contradicts its own label.
    const source = readFileSync(path.join(process.cwd(), 'src', 'core', 'ideationDerivation.ts'), 'utf8');
    expect(source).not.toMatch(/'security'|'architecture'|'delivery'|'documentation'/);
    expect(source).toMatch(/Focus is not decided in this module/);
  });

  it('shares the roadmap normalizer exactly, or every stored link breaks at once', () => {
    const panel = readFileSync(path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'), 'utf8');
    const start = panel.indexOf('function normalizeRoadmapText');
    expect(start).toBeGreaterThan(-1);
    const body = panel.slice(start, panel.indexOf('}', panel.indexOf('return', start)));
    // The same transformation, character for character.
    expect(body).toContain("toLowerCase().replace(/\\s+/g, ' ').replace(/[.\\s]+$/, '').trim()");

    for (const sample of ['  Fix the  Thing. ', 'ALREADY normal', 'trailing dots...']) {
      // Behavioural check as well as textual, so a rewrite that keeps the meaning
      // still passes and one that changes it does not.
      expect(normalizeForRoadmapMatch(sample)).toBe(
        sample.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim(),
      );
    }
  });
});

describe('a kind becomes a prefix only where it changes the commitment', () => {
  it('turns a problem into the fix, not the goal', () => {
    // Without this the backlog reads as if the missing rate limit were the aim.
    expect(deriveCardRoadmapText(card({ kind: 'problem' })).text)
      .toBe('Fix: webhook endpoint has no rate limit');
  });

  it('turns a risk into its mitigation and an experiment into a trial', () => {
    expect(deriveCardRoadmapText(card({ kind: 'risk', title: 'Token leak via logs' })).text)
      .toBe('Mitigate: token leak via logs');
    expect(deriveCardRoadmapText(card({ kind: 'experiment', title: 'Batch the writes' })).text)
      .toBe('Trial: batch the writes');
  });

  it('leaves a requirement and an idea unprefixed', () => {
    // Putting an idea on the roadmap *is* the commitment, so hedging it would
    // misreport the decision that was just made.
    expect(deriveCardRoadmapText(card({ kind: 'requirement', title: 'Support SSO login' })).text)
      .toBe('Support SSO login');
    expect(deriveCardRoadmapText(card({ kind: 'idea', title: 'Offer a dark theme' })).text)
      .toBe('Offer a dark theme');
  });

  it('does not lower-case an acronym or a proper noun', () => {
    // `Fix: aPI rate limit` is the failure being avoided.
    expect(deriveCardRoadmapText(card({ kind: 'problem', title: 'API rate limit missing' })).text)
      .toBe('Fix: API rate limit missing');
    expect(deriveCardRoadmapText(card({ kind: 'problem', title: 'GitHub token expires silently' })).text)
      .toBe('Fix: GitHub token expires silently');
    expect(deriveCardRoadmapText(card({ kind: 'problem', title: 'OAuth refresh loops' })).text)
      .toBe('Fix: OAuth refresh loops');
    // …while an ordinary capitalised opener still reads as a sentence.
    expect(deriveCardRoadmapText(card({ kind: 'problem', title: 'Webhook drops retries' })).text)
      .toBe('Fix: webhook drops retries');
    expect(deriveCardRoadmapText(card({ kind: 'problem', title: 'the parser is wrong' })).text)
      .toBe('Fix: the parser is wrong');
  });

  it('has a decision recorded for every derivable kind', () => {
    // A kind with no entry would silently fall through to "no prefix", which is a
    // decision either way and should be a visible one.
    for (const kind of DERIVABLE_CARD_KINDS) {
      const text = deriveCardRoadmapText(card({ kind, title: 'Something to do' })).text;
      expect(text, kind).toBeTruthy();
      expect(text, kind).toContain('omething to do');
    }
  });

  it('rejects the two kinds that are not work', () => {
    expect(isDerivableCardKind('atlas-response')).toBe(false);
    expect(isDerivableCardKind('attachment')).toBe(false);
    expect(isDerivableCardKind('requirement')).toBe(true);
  });

  it('strips markdown and collapses whitespace', () => {
    expect(deriveCardRoadmapText(card({ kind: 'idea', title: '  Add  **bold** `code`  ' })).text)
      .toBe('Add bold code');
  });

  it('clamps on a word boundary', () => {
    const long = `Support ${'the extremely detailed federated identity subsystem '.repeat(6)}end`;
    const text = deriveCardRoadmapText(card({ kind: 'requirement', title: long })).text;
    expect(text.length).toBeLessThanOrEqual(MAX_DERIVED_ITEM_LENGTH);
    const kept = text.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(' ');
  });
});

describe('direction is load-bearing', () => {
  it('reads a dependency the right way round', () => {
    // "This depends on X" and "X depends on this" are opposite plans.
    expect(deriveCardRoadmapText(card(), [edge({ outgoing: true })]).evidence)
      .toEqual(['This depends on “Shared token store”.']);
    expect(deriveCardRoadmapText(card(), [edge({ outgoing: false })]).evidence)
      .toEqual(['This is depended on by “Shared token store”.']);
  });

  it('reads every relation both ways', () => {
    const relations: Array<[IdeationConnectionSource['relation'], string, string]> = [
      ['contradiction', 'contradicts', 'is contradicted by'],
      ['dependency', 'depends on', 'is depended on by'],
      ['causal', 'causes', 'is caused by'],
      ['supports', 'supports', 'is supported by'],
      ['opportunity', 'opens up', 'is opened up by'],
    ];
    for (const [relation, out, incoming] of relations) {
      expect(deriveCardRoadmapText(card(), [edge({ relation, outgoing: true })]).evidence[0], relation)
        .toContain(out);
      expect(deriveCardRoadmapText(card(), [edge({ relation, outgoing: false })]).evidence[0], relation)
        .toContain(incoming);
    }
  });

  it('reads a mutual edge as outgoing, keeping the line a sentence', () => {
    expect(deriveCardRoadmapText(card(), [edge({ direction: 'both', outgoing: false })]).evidence[0])
      .toContain('depends on');
  });

  it('orders evidence by consequence, with a contradiction first', () => {
    // A line arguing the work should not happen outranks one supporting it.
    const evidence = deriveCardRoadmapText(card(), [
      edge({ relation: 'opportunity', otherTitle: 'Nice to have' }),
      edge({ relation: 'supports', otherTitle: 'Prior research' }),
      edge({ relation: 'contradiction', otherTitle: 'Costs too much' }),
      edge({ relation: 'dependency', otherTitle: 'Token store' }),
    ]).evidence;
    expect(evidence[0]).toContain('Costs too much');
    expect(evidence[1]).toContain('Token store');
    expect(evidence[3]).toContain('Nice to have');
  });

  it('is stable for equal relations, so the list does not shuffle', () => {
    const edges = [edge({ otherTitle: 'A' }), edge({ otherTitle: 'B' }), edge({ otherTitle: 'C' })];
    const first = deriveCardRoadmapText(card(), edges).evidence;
    expect(deriveCardRoadmapText(card(), edges).evidence).toEqual(first);
    expect(first[0]).toContain('A');
    expect(first[2]).toContain('C');
  });

  it('drops an edge with no card at the other end rather than emitting a blank line', () => {
    expect(deriveCardRoadmapText(card(), [edge({ otherTitle: '   ' })]).evidence).toEqual([]);
  });

  it('caps the evidence and states the remainder', () => {
    const many = Array.from({ length: MAX_EVIDENCE_LINES + 4 }, (_unused, index) =>
      edge({ otherTitle: `Card ${index}` }));
    const derivation = deriveCardRoadmapText(card(), many);
    expect(derivation.evidence).toHaveLength(MAX_EVIDENCE_LINES);
    expect(derivation.droppedConnections).toBe(4);
    expect(buildCardEvidenceSection(card(), derivation)).toContain('4 further connections');
  });

  it('reports no evidence as no evidence, not as an empty section', () => {
    const derivation = deriveCardRoadmapText(card(), []);
    expect(derivation.evidence).toEqual([]);
    expect(buildCardEvidenceSection(card(), derivation)).not.toContain('What the board records');
  });
});

describe('a contradiction is stated, never hidden', () => {
  it('flags it on the derivation', () => {
    expect(deriveCardRoadmapText(card(), [edge({ relation: 'contradiction' })]).contradicted).toBe(true);
    expect(deriveCardRoadmapText(card(), [edge({ relation: 'supports' })]).contradicted).toBe(false);
  });

  it('warns in the issue body rather than listing it as support', () => {
    // Raising work while hiding the card that argues against it is the worst use
    // of a board that recorded the argument.
    const derivation = deriveCardRoadmapText(card(), [edge({ relation: 'contradiction', otherTitle: 'Costs too much' })]);
    const body = buildCardEvidenceSection(card(), derivation);
    expect(body).toContain('Contradicted on the board');
    expect(body).toContain('does not settle that');
  });

  it('says nothing about contradictions when there are none', () => {
    expect(buildCardEvidenceSection(card(), deriveCardRoadmapText(card(), [edge()])))
      .not.toContain('Contradicted');
  });
});

describe('the issue body records where it came from', () => {
  it('names the card id and kind verbatim', () => {
    const body = buildCardEvidenceSection(card({ id: 'card-42', kind: 'risk' }), deriveCardRoadmapText(card()));
    expect(body).toContain('`card-42`');
    expect(body).toContain('(risk)');
  });

  it('carries the card summary where there is one, and omits the space where there is not', () => {
    const withSummary = buildCardEvidenceSection(
      card({ summary: 'Observed in three support tickets.' }),
      deriveCardRoadmapText(card()),
    );
    expect(withSummary).toContain('Observed in three support tickets.');
    expect(buildCardEvidenceSection(card({ summary: '   ' }), deriveCardRoadmapText(card())))
      .not.toMatch(/^\s*\n/);
  });

  it('says the board keeps the reasoning and the issue tracks the work', () => {
    // Two records with two jobs. Without this they read as duplicates.
    expect(buildCardEvidenceSection(card(), deriveCardRoadmapText(card())))
      .toContain('board keeps the reasoning');
  });
});

describe('provenance resolves by text, because roadmap ids move', () => {
  const record: IdeationDerivedRecord = {
    roadmapText: 'Fix: webhook endpoint has no rate limit',
    roadmapNormalized: 'fix: webhook endpoint has no rate limit',
    derivedAt: '2026-07-30T00:00:00.000Z',
  };

  it('matches the item wherever it has moved to', () => {
    // Roadmap ids are positional — `roadmap-${index + 1}` assigned after
    // filtering — so inserting one item renumbers every item below it. A stored
    // id would mean something different a week later.
    const items = [
      item('Something added later', 'roadmap-1'),
      item('Fix: webhook endpoint has no rate limit', 'roadmap-2'),
    ];
    const resolved = resolveDerivedRoadmapItem(record, items);
    expect(resolved.status).toBe('matched');
    expect(resolved.status === 'matched' && resolved.item.id).toBe('roadmap-2');
  });

  it('matches through whitespace and trailing punctuation', () => {
    expect(resolveDerivedRoadmapItem(record, [item('Fix:  webhook endpoint has no  rate limit.')]).status)
      .toBe('matched');
  });

  it('reports a break rather than linking to whatever is at that position now', () => {
    const resolved = resolveDerivedRoadmapItem(record, [item('An entirely different item')]);
    expect(resolved.status).toBe('missing');
    expect(resolved.status === 'missing' && resolved.was).toBe('Fix: webhook endpoint has no rate limit');
  });

  it('distinguishes "never derived" from "link broken"', () => {
    // Different facts with different responses: one is untouched work, the other
    // is a link somebody should repair.
    expect(resolveDerivedRoadmapItem(undefined, [item('anything')]).status).toBe('none');
  });

  it('still matches a completed item, because done is not gone', () => {
    const done = [{ id: 'roadmap-1', text: 'Fix: webhook endpoint has no rate limit', completed: true }];
    expect(resolveDerivedRoadmapItem(record, done).status).toBe('matched');
  });
});

describe('what is left on the board', () => {
  const roadmap = [item('Fix: webhook endpoint has no rate limit')];
  const derived: IdeationDerivedRecord = {
    roadmapText: 'Fix: webhook endpoint has no rate limit',
    roadmapNormalized: 'fix: webhook endpoint has no rate limit',
    derivedAt: '2026-07-30T00:00:00.000Z',
  };

  it('excludes cards that already produced a matching item', () => {
    const cards = [
      { ...card({ id: 'done' }), derived },
      card({ id: 'open', title: 'Support SSO', kind: 'requirement' }),
    ];
    expect(unrealizedCards(cards, roadmap).map(entry => entry.id)).toEqual(['open']);
  });

  it('includes a card whose link has broken, because the work is not tracked', () => {
    const cards = [{ ...card({ id: 'orphan' }), derived }];
    expect(unrealizedCards(cards, [item('Unrelated')]).map(entry => entry.id)).toEqual(['orphan']);
  });

  it('excludes the kinds that are not work at all', () => {
    const cards = [
      card({ id: 'response', kind: 'atlas-response' }),
      card({ id: 'file', kind: 'attachment' }),
      card({ id: 'real', kind: 'problem' }),
    ];
    expect(unrealizedCards(cards, []).map(entry => entry.id)).toEqual(['real']);
  });

  it('counts only problems, requirements and risks as needing attention', () => {
    // An idea nobody has acted on is not a problem — boards are for holding
    // ideas. A written-down problem that never reached the backlog is a signal.
    const cards = [
      card({ id: 'a', kind: 'idea' }),
      card({ id: 'b', kind: 'problem' }),
      card({ id: 'c', kind: 'requirement' }),
      card({ id: 'd', kind: 'evidence' }),
      card({ id: 'e', kind: 'risk' }),
    ];
    const counts = countUnrealizedByKind(cards, []);
    expect(counts.total).toBe(5);
    expect(counts.needsAttention).toBe(3);
  });

  it('keeps the naggable set narrower than the derivable set', () => {
    expect(NAGGABLE_CARD_KINDS.length).toBeLessThan(DERIVABLE_CARD_KINDS.length);
    for (const kind of NAGGABLE_CARD_KINDS) {
      expect(DERIVABLE_CARD_KINDS as readonly string[]).toContain(kind);
    }
  });

  it('reports zero on an empty board without throwing', () => {
    expect(countUnrealizedByKind([], [])).toEqual({ total: 0, needsAttention: 0 });
  });
});

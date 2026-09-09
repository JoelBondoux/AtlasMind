import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  BRIEF_RULES,
  BRIEF_TEMPLATE_ID,
  MIN_BRIEF_WORDS,
  assessBrief,
  briefToBoardTemplate,
  buildBriefParsePrompt,
  parseBriefProposal,
  renderBriefDocument,
} from '../../src/core/projectBrief';

const SOURCE = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'projectBrief.ts'),
  'utf8',
);
/** The source with its prose removed, for assertions about what it does. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const BRIEF = [
  'A booking tool for dog groomers working on their own.',
  'They currently take appointments by text message and lose track of them.',
  'It works when a groomer can see their whole week without opening anything else.',
].join(' ');

function reply(cards: unknown[]): string {
  return `Here you go:\n\`\`\`json\n${JSON.stringify({ cards })}\n\`\`\``;
}

describe('the brief is kept verbatim', () => {
  it('does not reword, retitle or resentence what was written', () => {
    const messy = 'we want a thing for groomers.  they lose bookings. it works when nobody texts.';
    expect(assessBrief(messy).text).toBe(messy.trim());
  });

  it('strips control characters without collapsing the paragraphs', () => {
    const bell = String.fromCharCode(7);
    const written = `First line about the groomers and what they need.${bell}\n\nSecond paragraph about the outcome.`;
    const read = assessBrief(written).text;
    expect(read).not.toContain(bell);
    // A brief is prose somebody wrote. Flattening it into one line would be an
    // edit, which is the one thing this must not do.
    expect(read).toContain('\n\n');
  });

  it('puts the brief into its document unchanged', () => {
    const document = renderBriefDocument(BRIEF, '2026-09-09T10:00:00.000Z');
    expect(document).toContain(BRIEF);
    expect(document).toContain('AtlasMind does not edit this file');
    expect(document).toContain('2026-09-09');
  });
});

describe('a brief too thin to derive from is refused, never expanded', () => {
  it('refuses an empty one', () => {
    const assessment = assessBrief('');
    expect(assessment.usable).toBe(false);
    expect(assessment.refusal).toBeTruthy();
  });

  it('refuses "an app" and says what to add', () => {
    const assessment = assessBrief('an app');
    expect(assessment.usable).toBe(false);
    expect(assessment.wordCount).toBe(2);
    // "Too short" teaches nothing; this says which two facts are missing.
    expect(assessment.refusal).toContain('who it is for');
  });

  it('accepts a real two-sentence answer', () => {
    const assessment = assessBrief(BRIEF);
    expect(assessment.usable).toBe(true);
    expect(assessment.wordCount).toBeGreaterThanOrEqual(MIN_BRIEF_WORDS);
    expect(assessment.refusal).toBeUndefined();
  });

  it('handles a non-string without throwing', () => {
    expect(() => assessBrief(undefined)).not.toThrow();
    expect(assessBrief(undefined).usable).toBe(false);
  });
});

describe('a card either quotes the brief or is a question', () => {
  it('keeps a card whose quote is really in the brief', () => {
    const proposal = parseBriefProposal(reply([{
      kind: 'problem',
      title: 'Bookings are lost in text messages',
      body: 'Appointments arrive by text and are not tracked anywhere.',
      quote: 'take appointments by text message and lose track of them',
      question: false,
    }]), BRIEF);
    expect(proposal.cards).toHaveLength(1);
    expect(proposal.cards[0].question).toBe(false);
    expect(proposal.cards[0].quote).toBeTruthy();
    expect(proposal.demoted).toBe(0);
  });

  it('demotes an invented quote to a question rather than dropping it', () => {
    const proposal = parseBriefProposal(reply([{
      kind: 'requirement',
      title: 'Must take card payments at booking',
      body: 'Groomers need payment up front to stop no-shows.',
      // Nothing in the brief mentions payments. This is the failure the module
      // exists for: fluent, specific, and entirely invented.
      quote: 'groomers need payment up front to stop no-shows',
      question: false,
    }]), BRIEF);
    expect(proposal.cards).toHaveLength(1);
    expect(proposal.cards[0].question).toBe(true);
    expect(proposal.cards[0].quote).toBeUndefined();
    expect(proposal.cards[0].demotedReason).toContain('not in it');
    expect(proposal.demoted).toBe(1);
  });

  it('says how many were demoted, so an invented reading cannot look clean', () => {
    const proposal = parseBriefProposal(reply([
      { kind: 'problem', title: 'Lost bookings', body: 'x', quote: 'lose track of them', question: false },
      { kind: 'requirement', title: 'Card payments', body: 'x', quote: 'must take payments', question: false },
    ]), BRIEF);
    expect(proposal.summary).toContain('not in your brief');
    expect(proposal.summary).toContain('1 quoting your brief');
  });

  it('matches a quote across differing whitespace and case but not paraphrase', () => {
    const exact = parseBriefProposal(reply([{
      kind: 'problem', title: 'T', body: 'b', question: false,
      quote: 'Lose   Track\n Of Them',
    }]), BRIEF);
    expect(exact.cards[0].question).toBe(false);

    // Reordered words are a paraphrase, not a quote.
    const paraphrase = parseBriefProposal(reply([{
      kind: 'problem', title: 'T', body: 'b', question: false,
      quote: 'them of track lose',
    }]), BRIEF);
    expect(paraphrase.cards[0].question).toBe(true);
  });

  it('treats a card with no quote as a question without demoting it', () => {
    const proposal = parseBriefProposal(reply([{
      kind: 'experiment', title: 'How do groomers handle cancellations', body: 'Unknown from the brief.',
    }]), BRIEF);
    expect(proposal.cards[0].question).toBe(true);
    expect(proposal.demoted).toBe(0);
  });

  it('enforces the rule in the sanitizer, not only in the prompt', () => {
    // The prompt states it too, which makes compliance likely. This makes
    // compliance irrelevant.
    expect(CODE).toContain('haystack.includes(normalizeForQuote(quote))');
    expect(buildBriefParsePrompt(BRIEF)).toContain('character for character');
  });
});

describe('the model reply is untrusted', () => {
  it('never throws, whatever comes back', () => {
    for (const raw of ['', 'no json here', '{', '{"cards":"nope"}', '[]', 'null']) {
      expect(() => parseBriefProposal(raw, BRIEF)).not.toThrow();
      expect(parseBriefProposal(raw, BRIEF).cards).toEqual([]);
    }
  });

  it('says nothing usable came back rather than showing an empty board as success', () => {
    expect(parseBriefProposal('rubbish', BRIEF).summary).toContain('nothing was written');
  });

  it('reads JSON out of a fenced or prefixed reply', () => {
    const proposal = parseBriefProposal(reply([
      { kind: 'problem', title: 'Lost bookings', body: 'b', quote: 'lose track of them', question: false },
    ]), BRIEF);
    expect(proposal.cards).toHaveLength(1);
  });

  it('coerces an unrecognised kind to the one that commits to least', () => {
    const proposal = parseBriefProposal(reply([
      { kind: 'conclusion', title: 'Something', body: 'b', question: true },
    ]), BRIEF);
    expect(proposal.cards[0].kind).toBe('problem');
  });

  it('counts an entry with no title as unreadable rather than inventing one', () => {
    const proposal = parseBriefProposal(reply([{ kind: 'problem', body: 'b' }]), BRIEF);
    expect(proposal.cards).toHaveLength(0);
    expect(proposal.unreadable).toBe(1);
  });

  it('caps the number of cards', () => {
    const many = Array.from({ length: 40 }, (_unused, index) => ({
      kind: 'problem', title: `Card ${index}`, body: 'b', question: true,
    }));
    expect(parseBriefProposal(reply(many), BRIEF).cards.length).toBeLessThanOrEqual(10);
  });
});

describe('into the board', () => {
  const proposal = parseBriefProposal(reply([
    { kind: 'problem', title: 'Bookings are lost', body: 'They arrive by text.', quote: 'lose track of them', question: false },
    { kind: 'experiment', title: 'How is the week reviewed', body: 'Not stated.', question: true },
  ]), BRIEF);

  it('carries the quote onto the card, so provenance survives', () => {
    const template = briefToBoardTemplate(proposal);
    expect(template.cards[0].body).toContain('From your brief:');
    expect(template.cards[0].body).toContain('lose track of them');
  });

  it('says plainly when the brief did not answer something', () => {
    const template = briefToBoardTemplate(proposal);
    expect(template.cards[1].body).toContain('did not say');
    expect(template.cards[1].title).toMatch(/\?$/);
  });

  it('draws no edges, because the brief argued nothing', () => {
    // An edge asserts that one thing supports or contradicts another. Inferring
    // those from one paragraph would invent the reasoning as well as the cards.
    expect(briefToBoardTemplate(proposal).edges).toEqual([]);
  });

  it('places nothing, leaving layout to the board', () => {
    const template = briefToBoardTemplate(proposal);
    expect(template.id).toBe(BRIEF_TEMPLATE_ID);
    for (const card of template.cards) {
      expect(Object.keys(card)).toEqual(['key', 'kind', 'title', 'body']);
    }
  });
});

describe('nothing here writes anything', () => {
  it('imports no filesystem, vscode or writer module', () => {
    expect(CODE).not.toMatch(/from 'node:fs'|from 'vscode'|writeFile|addRoadmapItem/);
  });

  it('publishes the rules it applied', () => {
    expect(BRIEF_RULES.length).toBeGreaterThan(4);
    for (const rule of BRIEF_RULES) {
      expect(rule.describes.length, rule.id).toBeGreaterThan(40);
    }
  });
});

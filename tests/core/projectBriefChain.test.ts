import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  BRIEF_CHAIN_RULES,
  BRIEF_CHAIN_STEP_IDS,
  BRIEF_SOUL_HEADING,
  BRIEF_SOUL_MARKER,
  buildBriefSoulSection,
  planBriefChain,
  quoteBriefForSoul,
  type BriefChainCard,
  type BriefChainInput,
} from '../../src/core/projectBriefChain';
import {
  BRIEF_CARD_TAG,
  briefContainsQuote,
  briefToBoardTemplate,
  parseBriefProposal,
} from '../../src/core/projectBrief';
import { normalizeForRoadmapMatch } from '../../src/core/ideationDerivation';

const BRIEF = [
  'A booking tool for dog groomers working on their own.',
  'They currently take appointments by text message and lose track of them.',
  'It works when a groomer can see their whole week without opening anything else.',
].join(' ');

const NOW = new Date('2026-10-08T09:00:00.000Z');

/** Cards exactly as the board seeder would write them from a proposal. */
function seededCards(cards: unknown[], brief = BRIEF): BriefChainCard[] {
  const proposal = parseBriefProposal(JSON.stringify({ cards }), brief);
  return briefToBoardTemplate(proposal).cards.map((card, index) => ({
    id: `card-${index + 1}`,
    title: card.title,
    body: card.body,
    kind: card.kind,
    tags: ['starter-frame', BRIEF_CARD_TAG],
  }));
}

const GROUNDED = { kind: 'requirement', title: 'See the whole week in one place', body: 'The week view is the outcome.', quote: 'see their whole week without opening anything else' };
const PROBLEM = { kind: 'problem', title: 'Appointments get lost in text threads', body: 'Texts are the current system.', quote: 'lose track of them' };
const QUESTION = { kind: 'experiment', title: 'Do groomers want reminders', body: 'Not said.', question: true };
const INVENTED = { kind: 'requirement', title: 'Take card payments', body: 'Payments.', quote: 'customers pay by card at booking' };

function input(overrides: Partial<BriefChainInput> = {}): BriefChainInput {
  return {
    ssotPath: 'project_memory',
    brief: BRIEF,
    cards: [],
    connections: [],
    roadmap: [],
    roadmapGraphWritable: true,
    soul: undefined,
    now: NOW,
    ...overrides,
  };
}

function state(plan: ReturnType<typeof planBriefChain>, id: string): string | undefined {
  return plan.steps.find(step => step.id === id)?.state;
}

describe('the chain is read from the files', () => {
  it('starts at the brief when there is none', () => {
    const plan = planBriefChain(input({ brief: undefined }));
    expect(plan.briefState).toBe('absent');
    expect(plan.next).toBe('brief');
    expect(state(plan, 'board')).toBe('blocked');
    expect(state(plan, 'roadmap')).toBe('blocked');
    expect(state(plan, 'soul')).toBe('blocked');
    expect(plan.nextSays).toContain('project_memory/project-brief.md');
  });

  it('asks for the brief again when the one on disk is too thin to read', () => {
    const plan = planBriefChain(input({ brief: 'an app' }));
    expect(plan.briefState).toBe('unusable');
    expect(plan.next).toBe('brief');
    // The refusal says what to add, not merely "too short".
    expect(plan.steps[0]?.says).toContain('who it is for');
  });

  it('offers to read a usable brief into cards next', () => {
    const plan = planBriefChain(input());
    expect(state(plan, 'brief')).toBe('done');
    expect(plan.next).toBe('board');
    expect(plan.nextSays).toContain('every card is shown before any is added');
  });

  it('recognises cards read out of the brief before the tag existed, by their provenance line', () => {
    const cards = seededCards([GROUNDED]).map(card => ({ ...card, tags: ['starter-frame'] }));
    expect(state(planBriefChain(input({ cards })), 'board')).toBe('done');
  });

  it('does not count a starter-frame card as read out of the brief', () => {
    const cards: BriefChainCard[] = [{ id: 'x', title: 'Who is it for?', body: 'A starter question.', kind: 'problem', tags: ['starter-frame'] }];
    expect(state(planBriefChain(input({ cards })), 'board')).toBe('ready');
  });

  it('resumes wherever the files say — the same files, the same plan', () => {
    const cards = seededCards([GROUNDED, QUESTION]);
    expect(planBriefChain(input({ cards }))).toEqual(planBriefChain(input({ cards })));
  });
});

describe('only a grounded statement becomes a roadmap item', () => {
  it('offers the cards that quote the brief, and keeps the questions on the board', () => {
    const plan = planBriefChain(input({ cards: seededCards([GROUNDED, PROBLEM, QUESTION]) }));
    expect(plan.next).toBe('roadmap');
    expect(plan.raise.map(proposal => proposal.text)).toEqual([
      'See the whole week in one place',
      'Fix: appointments get lost in text threads',
    ]);
    expect(plan.raise.map(proposal => proposal.quote)).toEqual([GROUNDED.quote, PROBLEM.quote]);
    expect(plan.heldBack.questions).toBe(1);
  });

  it('never offers a card whose claimed quote was invented — it was already demoted to a question', () => {
    const plan = planBriefChain(input({ cards: seededCards([INVENTED]) }));
    expect(plan.raise).toEqual([]);
    expect(plan.heldBack.questions).toBe(1);
    expect(state(plan, 'roadmap')).toBe('nothing-to-do');
  });

  it('re-checks the quote against the brief as it is now, not as it was when the cards were read', () => {
    const cards = seededCards([GROUNDED]);
    const rewritten = 'A scheduling app for independent dog groomers who lose appointments in their messages and want one place for the week.';
    const plan = planBriefChain(input({ brief: rewritten, cards }));
    expect(plan.raise).toEqual([]);
    expect(plan.heldBack.notInBrief).toBe(1);
    expect(plan.steps.find(step => step.id === 'roadmap')?.says).toContain('no longer in your brief');
  });

  it('re-checks a card body somebody edited to claim a quote', () => {
    const cards: BriefChainCard[] = [{
      id: 'edited', title: 'Take card payments', kind: 'requirement', tags: [BRIEF_CARD_TAG],
      body: 'Payments.\n\nFrom your brief: "customers pay by card"',
    }];
    expect(planBriefChain(input({ cards })).raise).toEqual([]);
  });

  it('does not offer an archived card', () => {
    const cards = seededCards([GROUNDED]).map(card => ({ ...card, archived: true }));
    expect(planBriefChain(input({ cards })).raise).toEqual([]);
  });

  it('does not offer what is already on the roadmap, and reads that as done', () => {
    const cards = seededCards([GROUNDED]).map(card => ({ ...card, derived: { roadmapNormalized: normalizeForRoadmapMatch('See the whole week in one place') } }));
    const plan = planBriefChain(input({ cards, roadmap: [{ text: 'See the whole week in one place', completed: false, nodeId: 'see-the-whole-week' }] }));
    expect(plan.raise).toEqual([]);
    expect(state(plan, 'roadmap')).toBe('done');
  });

  it('does not offer a line the roadmap already has under another card', () => {
    const plan = planBriefChain(input({ cards: seededCards([GROUNDED]), roadmap: [{ text: 'See the whole week in one place.', completed: false }] }));
    expect(plan.raise).toEqual([]);
    expect(plan.heldBack.alreadyOnRoadmap).toBe(1);
  });

  it('treats a roadmap that could not be read as unknown, never as empty', () => {
    const plan = planBriefChain(input({ cards: seededCards([GROUNDED]), roadmap: undefined }));
    expect(state(plan, 'roadmap')).toBe('blocked');
    expect(plan.raise).toEqual([]);
    expect(plan.next).toBeUndefined();
    expect(plan.nextSays).toContain('could not be read');
  });

  it('carries a contradiction onto the proposal rather than hiding it', () => {
    const cards = [
      ...seededCards([GROUNDED]),
      { id: 'other', title: 'Groomers live in their messages', body: 'Evidence.', kind: 'evidence', tags: [] },
    ];
    const plan = planBriefChain(input({
      cards,
      connections: [{ fromCardId: 'other', toCardId: 'card-1', relation: 'contradiction', direction: 'forward' }],
    }));
    expect(plan.raise[0]?.contradicted).toBe(true);
  });
});

describe('optional steps', () => {
  const raisedCards = seededCards([GROUNDED]).map(card => ({ ...card, derived: { roadmapNormalized: normalizeForRoadmapMatch('See the whole week in one place') } }));
  const roadmap = [{ text: 'See the whole week in one place', completed: false, nodeId: 'see-the-whole-week' }];

  it('proposes the exact plan path for each raised item without one', () => {
    const plan = planBriefChain(input({ cards: raisedCards, roadmap, soul: `x\n${BRIEF_SOUL_MARKER}\n${quoteBriefForSoul(BRIEF)}` }));
    expect(plan.plans).toEqual([{
      nodeId: 'see-the-whole-week',
      text: 'See the whole week in one place',
      relPath: 'project_memory/roadmap/plans/see-the-whole-week-see-the-whole-week-in-one-place.md',
    }]);
    expect(plan.next).toBe('plans');
    expect(plan.nextSays.startsWith('Optional next')).toBe(true);
  });

  it('reads a filed plan as done and does not propose it twice', () => {
    const plan = planBriefChain(input({ cards: raisedCards, roadmap: [{ ...roadmap[0]!, planPath: 'project_memory/roadmap/plans/x.md' }] }));
    expect(plan.plans).toEqual([]);
    expect(state(plan, 'plans')).toBe('done');
  });

  it('does not plan for completed items, nor link into a graph a newer AtlasMind wrote', () => {
    expect(planBriefChain(input({ cards: raisedCards, roadmap: [{ ...roadmap[0]!, completed: true }] })).plans).toEqual([]);
    expect(state(planBriefChain(input({ cards: raisedCards, roadmap, roadmapGraphWritable: false })), 'plans')).toBe('blocked');
  });

  it('creates the soul with the brief quoted when there is no soul', () => {
    const plan = planBriefChain(input({ cards: raisedCards, roadmap }));
    expect(plan.soul?.mode).toBe('create');
    expect(plan.soul?.basis).toBeUndefined();
    expect(plan.soul?.insertion).toContain(BRIEF_SOUL_MARKER);
    expect(plan.soul?.insertion).toContain(quoteBriefForSoul(BRIEF));
  });

  it('appends to an existing soul, and the insertion holds none of what is already there', () => {
    const soul = '# Groomers\n\n## Vision\nWritten by a person and not to be touched.';
    const plan = planBriefChain(input({ soul }));
    expect(plan.soul?.mode).toBe('append');
    expect(plan.soul?.basis).toBe(soul);
    expect(plan.soul?.insertion).not.toContain('not to be touched');
    // Appending yields the old file, unchanged, followed by the section.
    expect(`${soul}${plan.soul?.insertion}`.startsWith(soul)).toBe(true);
    expect(plan.soul?.insertion.startsWith('\n\n')).toBe(true);
  });

  it('reads the marker as done, and says so plainly when the quote is of an older brief', () => {
    const soul = `# Soul\n\n${buildBriefSoulSection('An older description of the groomers project, written before anything changed.', 'project_memory', NOW)}`;
    const plan = planBriefChain(input({ soul }));
    expect(plan.soul).toBeUndefined();
    expect(state(plan, 'soul')).toBe('done');
    expect(plan.steps.find(step => step.id === 'soul')?.says).toContain('earlier version');
  });

  it('finishes with a statement rather than another step', () => {
    const soul = buildBriefSoulSection(BRIEF, 'project_memory', NOW);
    const plan = planBriefChain(input({ cards: raisedCards, roadmap: [{ ...roadmap[0]!, planPath: 'p.md' }], soul }));
    expect(plan.next).toBeUndefined();
    expect(plan.nextSays).toContain('Everything your brief can seed is in place');
  });
});

describe('the soul section is the brief, quoted, and nothing else', () => {
  it('names where it came from and the heading it sits under', () => {
    const section = buildBriefSoulSection(BRIEF, 'project_memory', NOW);
    expect(section.startsWith(BRIEF_SOUL_HEADING)).toBe(true);
    expect(section).toContain('`project_memory/project-brief.md` on 2026-10-08');
  });

  it('round-trips any brief verbatim through the block quote (property)', () => {
    fc.assert(fc.property(fc.array(fc.string({ maxLength: 40 }).filter(line => !/[\r\n]/.test(line)), { minLength: 1, maxLength: 8 }), lines => {
      const brief = lines.join('\n');
      const unquoted = quoteBriefForSoul(brief).split('\n').map(line => (line === '>' ? '' : line.slice(2))).join('\n');
      expect(unquoted).toBe(brief);
    }));
  });
});

describe('no proposed roadmap item lacks a verbatim quote from the brief (property)', () => {
  const words = ['groomers', 'week', 'text', 'booking', 'lose', 'track', 'appointments', 'payments', 'reminders', 'calendar', 'clients', 'dogs'];
  const phrase = fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 5 }).map(parts => parts.join(' '));
  const cardSpec = fc.record({
    kind: fc.constantFrom('problem', 'requirement', 'experiment', 'risk', 'user-insight', 'idea', 'nonsense'),
    title: fc.string({ minLength: 1, maxLength: 30 }),
    quote: fc.option(phrase, { nil: undefined }),
    question: fc.boolean(),
  });

  it('holds for arbitrary briefs, model replies and hand-edited cards', () => {
    let proposed = 0;
    let refused = 0;
    fc.assert(fc.property(
      fc.array(phrase, { minLength: 4, maxLength: 10 }),
      fc.array(cardSpec, { maxLength: 10 }),
      fc.array(fc.record({ title: fc.string({ minLength: 1, maxLength: 30 }), quote: phrase }), { maxLength: 4 }),
      (sentences, specs, edited) => {
        const brief = `${sentences.join('. ')} and it works when every groomer sees the week.`;
        const cards: BriefChainCard[] = [
          ...seededCards(specs.map(spec => ({ ...spec, body: 'b' })), brief),
          // Cards whose bodies were edited by hand to claim a quote.
          ...edited.map((card, index) => ({
            id: `edited-${index}`,
            title: card.title,
            kind: 'requirement',
            tags: [BRIEF_CARD_TAG],
            body: `Notes.\n\nFrom your brief: "${card.quote}"`,
          })),
        ];
        const plan = planBriefChain(input({ brief, cards }));
        proposed += plan.raise.length;
        refused += plan.heldBack.questions + plan.heldBack.notInBrief;
        for (const proposal of plan.raise) {
          expect(proposal.quote.length).toBeGreaterThan(0);
          expect(briefContainsQuote(brief, proposal.quote)).toBe(true);
          const card = cards.find(candidate => candidate.id === proposal.cardId);
          expect(card?.title.trim().endsWith('?')).toBe(false);
        }
      },
    ));
    // The property is only worth something if both sides were exercised.
    expect(proposed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});

describe('the chain is published and declared', () => {
  it('names every step in order, and publishes its rules', () => {
    expect(planBriefChain(input()).steps.map(step => step.id)).toEqual([...BRIEF_CHAIN_STEP_IDS]);
    expect(planBriefChain(input()).rules).toBe(BRIEF_CHAIN_RULES);
    expect(BRIEF_CHAIN_RULES.map(rule => rule.id)).toContain('grounded-only');
  });

  it('marks plan files and the soul as optional, and the rest as the chain', () => {
    const steps = planBriefChain(input()).steps;
    expect(steps.filter(step => step.required).map(step => step.id)).toEqual(['brief', 'board', 'roadmap']);
  });

  it('writes nothing and calls no model', () => {
    const source = readFileSync(path.join(process.cwd(), 'src', 'core', 'projectBriefChain.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(source).not.toMatch(/from 'node:fs|from 'fs'|from 'vscode'/);
    expect(source).not.toMatch(/processTask|completeBootstrap|writeFile|appendFile/);
  });
});

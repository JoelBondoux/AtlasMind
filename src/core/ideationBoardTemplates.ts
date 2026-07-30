/**
 * Starter frames for an empty ideation board.
 *
 * An empty board is the hardest screen in AtlasMind. Everything else in the
 * product opens onto something — a repository, a backlog, a register of
 * findings — and the whiteboard opens onto nothing, with a prompt box and a
 * four-step guide explaining an order the layout does not impose. The v0.207.1
 * changelog said the quiet part out loud: *"a board nobody invests in — which is
 * the honest explanation for why the Ideation surface felt abandoned."*
 *
 * Three decisions.
 *
 * **A template is a set of questions, not a set of answers.** Every seeded card
 * is a `problem`, a `requirement` or an `experiment` phrased as something to fill
 * in. Seeding a board with confident-sounding conclusions would be the same
 * mistake the research register refuses to make: text that reads like thinking
 * somebody did, which nobody did.
 *
 * **It is derived from the project, never generated.** A game and a CLI tool do
 * not open the same board, and the difference comes from `projectArchetype`'s
 * detected archetype and traits — facts about the repository — rather than from a
 * model's guess about what this project might want to think about. A hallucinated
 * starting frame is worse than a blank one, because it sets the agenda.
 *
 * **Nothing is placed at a coordinate here.** Layout belongs to the board, which
 * already has collision avoidance and a lane model. A template declares *cards
 * and the edges between them*; the panel decides where they go. Two placement
 * algorithms would drift, and the one in this file would be the wrong one,
 * because it cannot see the board.
 *
 * Pure: no `vscode`, no I/O, no clock.
 */

import type { ArchetypeTrait, ProjectArchetype } from './projectArchetype.js';
import type { DerivableCardKind } from './ideationDerivation.js';

export interface TemplateCard {
  /** Stable within the template, so edges can name it. Not a board card id. */
  readonly key: string;
  readonly kind: DerivableCardKind;
  readonly title: string;
  /** The prompt written into the card body. A question, never a conclusion. */
  readonly body: string;
}

export interface TemplateEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: 'supports' | 'causal' | 'dependency' | 'contradiction' | 'opportunity';
}

export interface IdeationBoardTemplate {
  readonly id: string;
  readonly label: string;
  /** One sentence: when this frame is the right one to pick. */
  readonly whenToUse: string;
  readonly cards: readonly TemplateCard[];
  readonly edges: readonly TemplateEdge[];
  /**
   * Why this template was offered. Absent on the general frames, which are
   * always offered; present on a suggested one, so a suggestion can be argued
   * with rather than just accepted.
   */
  readonly suggestedBecause?: string;
}

/**
 * The four general frames.
 *
 * Deliberately few. A gallery of thirty templates is a second decision to make
 * before the first one, and the first one was already hard enough that the board
 * sat empty.
 */
export const GENERAL_BOARD_TEMPLATES: readonly IdeationBoardTemplate[] = [
  {
    id: 'problem-solution',
    label: 'Problem → solution',
    whenToUse: 'You know something is wrong and want to work out what to do about it.',
    cards: [
      { key: 'problem', kind: 'problem', title: 'What is actually wrong?', body: 'State the problem as something observable, not as a missing feature.' },
      { key: 'who', kind: 'user-insight', title: 'Who hits this, and how often?', body: 'If nobody can be named, that is itself a finding.' },
      { key: 'evidence', kind: 'evidence', title: 'What evidence do we have?', body: 'A log line, an issue, a support message, a measurement. Not an intuition.' },
      { key: 'option', kind: 'idea', title: 'One way to fix it', body: 'Duplicate this card for each option worth comparing.' },
      { key: 'risk', kind: 'risk', title: 'What could this break?', body: 'The thing most likely to go wrong if the fix ships as described.' },
    ],
    edges: [
      { from: 'evidence', to: 'problem', relation: 'supports' },
      { from: 'who', to: 'problem', relation: 'supports' },
      { from: 'option', to: 'problem', relation: 'causal' },
      { from: 'risk', to: 'option', relation: 'contradiction' },
    ],
  },
  {
    id: 'assumption-map',
    label: 'Assumption map',
    whenToUse: 'You have a plan and want to find the belief it quietly rests on.',
    cards: [
      { key: 'bet', kind: 'idea', title: 'What are we betting on?', body: 'The plan, stated in one sentence.' },
      { key: 'assume-user', kind: 'requirement', title: 'We are assuming people want this', body: 'What would have to be true about the people using it?' },
      { key: 'assume-tech', kind: 'requirement', title: 'We are assuming this is buildable', body: 'What would have to be true about the technology?' },
      { key: 'riskiest', kind: 'experiment', title: 'Which assumption is riskiest?', body: 'The one that is cheapest to test and most expensive to be wrong about.' },
      { key: 'kill', kind: 'risk', title: 'What would tell us to stop?', body: 'Name it before starting, or nothing ever will.' },
    ],
    edges: [
      { from: 'assume-user', to: 'bet', relation: 'dependency' },
      { from: 'assume-tech', to: 'bet', relation: 'dependency' },
      { from: 'riskiest', to: 'assume-user', relation: 'supports' },
      { from: 'kill', to: 'bet', relation: 'contradiction' },
    ],
  },
  {
    id: 'competitive-position',
    label: 'Competitive position',
    whenToUse: 'Somebody else already builds something like this and you need to decide what you are.',
    cards: [
      { key: 'them', kind: 'evidence', title: 'Who else does this?', body: 'Name them. A competition scan can fill this in with citations.' },
      { key: 'theirs', kind: 'evidence', title: 'What do they do better?', body: 'The honest version. This card is worthless if it is flattering.' },
      { key: 'ours', kind: 'idea', title: 'What do we do that they do not?', body: 'If the answer is "nothing yet", say so.' },
      { key: 'bet', kind: 'requirement', title: 'What are we choosing not to be?', body: 'A position is as much what you refuse as what you claim.' },
    ],
    edges: [
      { from: 'theirs', to: 'them', relation: 'supports' },
      { from: 'ours', to: 'theirs', relation: 'contradiction' },
      { from: 'bet', to: 'ours', relation: 'dependency' },
    ],
  },
  {
    id: 'customer-journey',
    label: 'Customer journey',
    whenToUse: 'The work is about somebody getting something done, and you want to find where it hurts.',
    cards: [
      { key: 'who', kind: 'user-insight', title: 'Who is this person?', body: 'One specific person, not a segment.' },
      { key: 'goal', kind: 'requirement', title: 'What are they trying to finish?', body: 'The outcome, not the feature they would ask for.' },
      { key: 'today', kind: 'problem', title: 'How do they do it today?', body: 'Including the workaround they have stopped noticing.' },
      { key: 'friction', kind: 'problem', title: 'Where does it hurt?', body: 'The step they would describe as annoying if asked.' },
      { key: 'proof', kind: 'evidence', title: 'How would we know we fixed it?', body: 'Something measurable, decided before the work starts.' },
    ],
    edges: [
      { from: 'goal', to: 'who', relation: 'dependency' },
      { from: 'friction', to: 'today', relation: 'causal' },
      { from: 'proof', to: 'friction', relation: 'supports' },
    ],
  },
];

/**
 * Archetype-specific frames.
 *
 * One per archetype that has a genuinely different first conversation. `generic`
 * deliberately has none: offering a "generic project" template would be offering
 * the general frames with a worse name.
 */
const ARCHETYPE_TEMPLATES: Partial<Record<ProjectArchetype, IdeationBoardTemplate>> = {
  game: {
    id: 'game-loop',
    label: 'Core loop',
    whenToUse: 'The first question about a game is what the player is doing thirty seconds in.',
    cards: [
      { key: 'verb', kind: 'idea', title: 'What does the player actually do?', body: 'The verb, repeated hundreds of times. If it is not fun on its own, nothing above it will be.' },
      { key: 'loop', kind: 'requirement', title: 'What is the thirty-second loop?', body: 'Act, feedback, reward, back to act.' },
      { key: 'fail', kind: 'risk', title: 'What does failure feel like?', body: 'A game with no interesting failure has no interesting success.' },
      { key: 'proto', kind: 'experiment', title: 'What is the smallest prototype that proves it?', body: 'Grey boxes are allowed. Art is not the question yet.' },
    ],
    edges: [
      { from: 'loop', to: 'verb', relation: 'dependency' },
      { from: 'fail', to: 'loop', relation: 'supports' },
      { from: 'proto', to: 'verb', relation: 'supports' },
    ],
  },
  cli: {
    id: 'cli-surface',
    label: 'Command surface',
    whenToUse: 'A command-line tool is its interface, and the interface is very hard to change later.',
    cards: [
      { key: 'one', kind: 'requirement', title: 'What is the one command?', body: 'The thing somebody types without reading the docs.' },
      { key: 'default', kind: 'requirement', title: 'What happens with no flags?', body: 'The default is the design. Everything else is a concession.' },
      { key: 'wrong', kind: 'problem', title: 'What happens when it goes wrong?', body: 'The error message somebody will paste into a search engine.' },
      { key: 'script', kind: 'user-insight', title: 'Who is scripting this?', body: 'Exit codes and stdout shape are a contract the moment anyone automates it.' },
    ],
    edges: [
      { from: 'default', to: 'one', relation: 'dependency' },
      { from: 'wrong', to: 'one', relation: 'causal' },
      { from: 'script', to: 'default', relation: 'dependency' },
    ],
  },
  api: {
    id: 'api-contract',
    label: 'The contract',
    whenToUse: 'An API is a promise to somebody you will never meet.',
    cards: [
      { key: 'caller', kind: 'user-insight', title: 'Who calls this, and from where?', body: 'A browser, a job, another team. Each implies different guarantees.' },
      { key: 'shape', kind: 'requirement', title: 'What is the smallest useful response?', body: 'Everything added later is easy; everything removed later is a breaking change.' },
      { key: 'wrong', kind: 'problem', title: 'What does a caller do when it fails?', body: 'Retry, give up, or corrupt something. Decide which.' },
      { key: 'load', kind: 'risk', title: 'What happens at ten times the traffic?', body: 'Name the first thing that breaks.' },
    ],
    edges: [
      { from: 'shape', to: 'caller', relation: 'dependency' },
      { from: 'wrong', to: 'shape', relation: 'causal' },
      { from: 'load', to: 'shape', relation: 'contradiction' },
    ],
  },
  library: {
    id: 'library-api',
    label: 'What consumers depend on',
    whenToUse: 'A library that is used is a library that cannot change.',
    cards: [
      { key: 'need', kind: 'user-insight', title: 'What problem does a consumer have?', body: 'Not "what does the library do" — what were they doing when they went looking.' },
      { key: 'surface', kind: 'requirement', title: 'What is the public surface?', body: 'Everything exported is a promise. Export less.' },
      { key: 'break', kind: 'risk', title: 'What would a breaking change cost?', body: 'Who would have to change code, and would they notice?' },
      { key: 'alt', kind: 'evidence', title: 'What do people use instead today?', body: 'A competition scan can fill this in with citations.' },
    ],
    edges: [
      { from: 'surface', to: 'need', relation: 'dependency' },
      { from: 'break', to: 'surface', relation: 'contradiction' },
      { from: 'alt', to: 'need', relation: 'supports' },
    ],
  },
  'web-app': {
    id: 'web-app-flow',
    label: 'The first session',
    whenToUse: 'Most of what a web application is worth happens in somebody\'s first ten minutes.',
    cards: [
      { key: 'arrive', kind: 'user-insight', title: 'How does somebody arrive?', body: 'What they were doing immediately before they got here.' },
      { key: 'first', kind: 'requirement', title: 'What is the first thing worth doing?', body: 'The smallest action that produces something they wanted.' },
      { key: 'empty', kind: 'problem', title: 'What does an empty account look like?', body: 'The state every new user sees and no existing user remembers.' },
      { key: 'return', kind: 'experiment', title: 'Why would they come back?', body: 'If the answer is a notification, the answer is no.' },
    ],
    edges: [
      { from: 'first', to: 'arrive', relation: 'dependency' },
      { from: 'empty', to: 'first', relation: 'contradiction' },
      { from: 'return', to: 'first', relation: 'supports' },
    ],
  },
  mobile: {
    id: 'mobile-moment',
    label: 'The moment of use',
    whenToUse: 'A phone is used standing up, one-handed, interrupted.',
    cards: [
      { key: 'when', kind: 'user-insight', title: 'When is the phone out?', body: 'The physical situation. Queue, sofa, site visit, driving.' },
      { key: 'thumb', kind: 'requirement', title: 'What must work one-handed?', body: 'Anything that does not is a desktop feature on a phone.' },
      { key: 'offline', kind: 'problem', title: 'What happens with no signal?', body: 'Not an edge case. A commute.' },
      { key: 'permission', kind: 'risk', title: 'What are we asking permission for?', body: 'Every prompt is a place people leave.' },
    ],
    edges: [
      { from: 'thumb', to: 'when', relation: 'dependency' },
      { from: 'offline', to: 'when', relation: 'causal' },
      { from: 'permission', to: 'thumb', relation: 'contradiction' },
    ],
  },
  desktop: {
    id: 'desktop-workspace',
    label: 'Living in the window',
    whenToUse: 'Desktop software is opened in the morning and closed at night.',
    cards: [
      { key: 'session', kind: 'user-insight', title: 'What does a working day look like?', body: 'Eight hours, not eight minutes. What repeats?' },
      { key: 'state', kind: 'requirement', title: 'What must survive a restart?', body: 'Everything a person would be annoyed to redo.' },
      { key: 'os', kind: 'problem', title: 'Where does it meet the operating system?', body: 'Files, notifications, updates, the tray. Each is a platform difference.' },
      { key: 'update', kind: 'risk', title: 'How does it update itself?', body: 'The riskiest code in any desktop application.' },
    ],
    edges: [
      { from: 'state', to: 'session', relation: 'dependency' },
      { from: 'os', to: 'state', relation: 'causal' },
      { from: 'update', to: 'os', relation: 'dependency' },
    ],
  },
  website: {
    id: 'website-message',
    label: 'What it says',
    whenToUse: 'A website\'s job is to be understood in about eight seconds.',
    cards: [
      { key: 'who', kind: 'user-insight', title: 'Who lands here, and from what?', body: 'A search, a link, a conference talk. Each arrives with different context.' },
      { key: 'claim', kind: 'requirement', title: 'What is the one sentence?', body: 'If there are two, there are none.' },
      { key: 'proof', kind: 'evidence', title: 'What makes it believable?', body: 'A number, a name, a screenshot. Adjectives do not count.' },
      { key: 'next', kind: 'requirement', title: 'What should they do next?', body: 'One action. A page with four calls to action has none.' },
    ],
    edges: [
      { from: 'claim', to: 'who', relation: 'dependency' },
      { from: 'proof', to: 'claim', relation: 'supports' },
      { from: 'next', to: 'claim', relation: 'dependency' },
    ],
  },
};

/**
 * A trait-driven frame, offered alongside the archetype's own.
 *
 * Only where the trait genuinely changes the first conversation. `has-ui` does
 * not appear: every archetype that has a UI already has a frame about it.
 */
const TRAIT_TEMPLATES: Partial<Record<ArchetypeTrait, IdeationBoardTemplate>> = {
  'handles-personal-data': {
    id: 'personal-data',
    label: 'Personal data',
    whenToUse: 'This project holds data about people, which changes what "done" means.',
    cards: [
      { key: 'what', kind: 'requirement', title: 'What personal data is held, exactly?', body: 'Field by field. "User profile" is not an answer.' },
      { key: 'why', kind: 'requirement', title: 'Why is each field needed?', body: 'A field with no answer here is a liability with no benefit.' },
      { key: 'who', kind: 'risk', title: 'Who can read it?', body: 'Including operators, backups, logs and third-party services.' },
      { key: 'gone', kind: 'requirement', title: 'How does somebody get it deleted?', body: 'If the answer is "ask us", write down who answers.' },
    ],
    edges: [
      { from: 'why', to: 'what', relation: 'dependency' },
      { from: 'who', to: 'what', relation: 'contradiction' },
      { from: 'gone', to: 'what', relation: 'dependency' },
    ],
  },
  'platform-hosted': {
    id: 'platform-rules',
    label: 'Somebody else\'s platform',
    whenToUse: 'This ships onto a marketplace or store whose rules are not yours.',
    cards: [
      { key: 'rules', kind: 'requirement', title: 'What does the platform require?', body: 'Review criteria, metadata, permissions. A regulatory scan can cite them.' },
      { key: 'reject', kind: 'risk', title: 'What gets a submission rejected?', body: 'The rejection you would not see coming.' },
      { key: 'change', kind: 'risk', title: 'What happens if their rules change?', body: 'A platform change is not a bug you can fix in your own repository.' },
      { key: 'off', kind: 'experiment', title: 'What would leaving cost?', body: 'The honest measure of how much this is a dependency.' },
    ],
    edges: [
      { from: 'reject', to: 'rules', relation: 'causal' },
      { from: 'change', to: 'rules', relation: 'contradiction' },
      { from: 'off', to: 'change', relation: 'supports' },
    ],
  },
};

export interface TemplateSuggestionInput {
  readonly archetype: ProjectArchetype;
  readonly traits: readonly ArchetypeTrait[];
}

/**
 * The frames to offer, most specific first.
 *
 * The archetype's own frame leads because it is the one derived from this
 * project; the general four always follow, because the detection can be wrong
 * and a picker that only offers one option is a decision made for somebody.
 */
export function suggestBoardTemplates(input: TemplateSuggestionInput): readonly IdeationBoardTemplate[] {
  const suggested: IdeationBoardTemplate[] = [];
  const archetypeTemplate = ARCHETYPE_TEMPLATES[input.archetype];
  if (archetypeTemplate) {
    suggested.push({
      ...archetypeTemplate,
      suggestedBecause: `This project looks like a ${input.archetype.replace(/-/g, ' ')}.`,
    });
  }
  for (const trait of input.traits) {
    const traitTemplate = TRAIT_TEMPLATES[trait];
    if (traitTemplate) {
      suggested.push({
        ...traitTemplate,
        suggestedBecause: `This project was detected as \`${trait}\`.`,
      });
    }
  }
  return [...suggested, ...GENERAL_BOARD_TEMPLATES];
}

export function findBoardTemplate(id: string): IdeationBoardTemplate | undefined {
  const all: IdeationBoardTemplate[] = [
    ...GENERAL_BOARD_TEMPLATES,
    ...Object.values(ARCHETYPE_TEMPLATES),
    ...Object.values(TRAIT_TEMPLATES),
  ];
  return all.find(template => template.id === id);
}

/** Every declared template, for tests and for a full picker. */
export function allBoardTemplates(): readonly IdeationBoardTemplate[] {
  return [
    ...GENERAL_BOARD_TEMPLATES,
    ...Object.values(ARCHETYPE_TEMPLATES),
    ...Object.values(TRAIT_TEMPLATES),
  ];
}

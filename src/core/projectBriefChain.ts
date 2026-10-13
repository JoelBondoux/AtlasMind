/**
 * From the brief to a roadmap: what has happened, what is next, and exactly
 * what the next step would write.
 *
 * `projectBrief` made the brief usable and closed the hazard in it — a reading
 * of one paragraph either quotes the paragraph or asks about it. What it left
 * was a chain somebody had to drive by hand: write the brief, find the button
 * that reads it, find the card that can become work, find the page that files
 * a plan, and never be told any of those existed. This plans the chain, and
 * the plan is the whole of the module.
 *
 * Six rules.
 *
 * **State is read from the files, never stored.** Whether the brief is written
 * is whether `project-brief.md` holds one; whether the board is seeded is
 * whether a card on it was read out of the brief; whether a card became work is
 * whether the roadmap holds the line it produced. A separate progress record
 * would disagree with the files the first time somebody edited one by hand, and
 * then the chain would offer to do again what is already done — or skip what
 * somebody undid. Derived this way the chain is resumable by construction: close
 * the editor halfway and the next plan starts where the files say.
 *
 * **Only a grounded statement becomes a roadmap item.** A card is offered for
 * the roadmap only when its quote is found in the brief *as it is on disk now*
 * — re-checked here with `briefContainsQuote`, not trusted from the board,
 * because a card body is a file somebody can edit and a brief can be rewritten
 * after the cards were read out of it. A question stays on the board, where
 * somebody can answer it; raising it would commit the project to a decision
 * nobody made. Every proposal carries the quote it rests on, so the
 * confirmation can show it and a test can walk it.
 *
 * **The next step is named, and so is what it writes.** Each step says what
 * pressing it would do in a sentence composed here, so no surface can describe
 * it more confidently; the roadmap lines, plan paths and soul insertion are
 * returned as exact values, so a confirmation can show what will be written
 * rather than a summary of it.
 *
 * **Optional is optional.** Writing the brief, seeding the board and raising
 * work are the chain; plan files and the soul section are offered once those
 * are settled, and declining them leaves nothing half-done.
 *
 * **Create or append, never rewrite.** A plan file is created only where none
 * exists; the soul section is appended once, or the soul created with it, and
 * an existing soul is never edited — `basis` carries what the insertion was
 * computed against so the writer can refuse when the file moved underneath it.
 *
 * **Nothing here writes anything, and no model output is in this path.** The
 * roadmap text comes from `deriveCardRoadmapText`, the plan scaffold from
 * `roadmapPlanning`, the soul section from the brief itself. Whatever a model
 * contributed reached the board through `parseBriefProposal`'s grounding gate,
 * and is gated again here.
 *
 * Pure, clock-injected + unit-tested.
 */

import {
  assessBrief,
  briefContainsQuote,
  isBriefDerivedCard,
  PROJECT_BRIEF_FILENAME,
  readBriefCardQuote,
} from './projectBrief.js';
import {
  collectCardConnectionSources,
  deriveCardRoadmapText,
  isDerivableCardKind,
  normalizeForRoadmapMatch,
  type IdeationConnectionSource,
} from './ideationDerivation.js';
import { roadmapPlanRelPath } from './roadmapPlanning.js';

export type BriefChainStepId = 'brief' | 'board' | 'roadmap' | 'plans' | 'soul';

/** Every step id, in chain order. The webview may only name one of these. */
export const BRIEF_CHAIN_STEP_IDS: readonly BriefChainStepId[] = ['brief', 'board', 'roadmap', 'plans', 'soul'];

/**
 * - `done`: the files show it happened.
 * - `ready`: it can be done now, and `says` is what doing it would do.
 * - `blocked`: it waits on something, and `says` names it.
 * - `nothing-to-do`: it was reached and there is nothing it may honestly do.
 */
export type BriefChainStepState = 'done' | 'ready' | 'blocked' | 'nothing-to-do';

export interface BriefChainStep {
  id: BriefChainStepId;
  label: string;
  required: boolean;
  state: BriefChainStepState;
  says: string;
}

export interface BriefChainRule {
  id: string;
  describes: string;
}

/** Published with every plan, so the chain can be argued with. */
export const BRIEF_CHAIN_RULES: readonly BriefChainRule[] = [
  { id: 'files-are-the-state', describes: 'Progress is read from the brief, the board, the roadmap and the soul as they are on disk. Nothing records it separately, so editing a file by hand moves the chain with it.' },
  { id: 'grounded-only', describes: 'A card is offered for the roadmap only when the words it quotes are in your brief now. Questions stay on the board until somebody answers them.' },
  { id: 'shown-before-written', describes: 'Every step shows exactly what it will write — the roadmap lines, the plan files, the soul section — and writes nothing until you confirm it.' },
  { id: 'create-or-append', describes: 'Plan files are created only where none exists. The soul section is appended once and never edited; your own text in the soul is never rewritten.' },
  { id: 'no-model-text', describes: 'Nothing a model wrote reaches the roadmap, a plan or the soul. Roadmap lines come from the card title by a published rule; the soul section is your brief, quoted.' },
];

// ── Inputs ───────────────────────────────────────────────────────

export interface BriefChainCard {
  id: string;
  title: string;
  body: string;
  kind: string;
  tags: readonly string[];
  archived?: boolean;
  /** What this card became, when it was raised. Joined on normalized text. */
  derived?: { roadmapNormalized: string };
}

export interface BriefChainConnection {
  fromCardId: string;
  toCardId: string;
  relation: IdeationConnectionSource['relation'];
  direction: IdeationConnectionSource['direction'];
}

export interface BriefChainRoadmapItem {
  text: string;
  completed: boolean;
  /** The durable graph id, as the roadmap would resolve it. */
  nodeId?: string;
  /** The filed plan, when there is one. */
  planPath?: string;
}

export interface BriefChainInput {
  /** The validated SSOT folder, relative to the workspace. */
  ssotPath: string;
  /** The brief file's body as read from disk; `undefined` when there is none. */
  brief: string | undefined;
  cards: readonly BriefChainCard[];
  connections?: readonly BriefChainConnection[];
  /**
   * The roadmap's items. `undefined` means it could not be read, which is not
   * the same as an empty roadmap: unknown is never read as "nothing raised".
   */
  roadmap: readonly BriefChainRoadmapItem[] | undefined;
  /** False when the graph file cannot be written (a newer AtlasMind wrote it). */
  roadmapGraphWritable?: boolean;
  /** `project_soul.md` as it is; `undefined` when it does not exist. */
  soul: string | undefined;
  now: Date;
}

// ── Outputs ──────────────────────────────────────────────────────

export interface BriefRoadmapProposal {
  cardId: string;
  cardTitle: string;
  kind: string;
  /** The words from the brief this rests on, verified against the file. */
  quote: string;
  /** The exact roadmap line that would be written. */
  text: string;
  normalized: string;
  /** A card on the board argues against this one. Raising it does not settle that. */
  contradicted: boolean;
}

export interface BriefPlanProposal {
  nodeId: string;
  text: string;
  /** Workspace-relative path of the plan file that would be created. */
  relPath: string;
}

export interface BriefSoulProposal {
  mode: 'create' | 'append';
  /** Workspace-relative path of the soul. */
  relPath: string;
  /** Exactly what is added. For `create`, the whole new file. */
  insertion: string;
  /** The soul the insertion was computed against; the writer refuses if it moved. */
  basis: string | undefined;
}

export interface BriefChainPlan {
  briefState: 'absent' | 'unusable' | 'usable';
  steps: BriefChainStep[];
  next?: BriefChainStepId;
  nextSays: string;
  raise: BriefRoadmapProposal[];
  heldBack: {
    /** Cards that ask rather than assert. They stay on the board. */
    questions: number;
    /** Cards whose quote is not in the brief as it is now. */
    notInBrief: number;
    /** Cards whose line is already on the roadmap. */
    alreadyOnRoadmap: number;
  };
  plans: BriefPlanProposal[];
  soul?: BriefSoulProposal;
  rules: readonly BriefChainRule[];
}

// ── The soul section ─────────────────────────────────────────────

/**
 * The marker that identifies the section in `project_soul.md`.
 *
 * Its presence is the whole of "the soul step is done": a person may edit the
 * quote below it freely, and AtlasMind will never append a second copy.
 */
export const BRIEF_SOUL_MARKER = '<!-- atlasmind:project-brief -->';
export const BRIEF_SOUL_HEADING = "## In the owner's words";

/** Every line of the brief, block-quoted — and nothing else changed. */
export function quoteBriefForSoul(brief: string): string {
  return brief.split(/\r?\n/).map(line => (line.length > 0 ? `> ${line}` : '>')).join('\n');
}

/**
 * The section appended to the soul.
 *
 * The brief verbatim inside a block quote, with where it came from. No summary,
 * no model text: the soul is the living identity document, and the one thing
 * that may be added to it without anybody reviewing the words is words the
 * owner already wrote.
 */
export function buildBriefSoulSection(brief: string, ssotPath: string, now: Date): string {
  return [
    BRIEF_SOUL_HEADING,
    '',
    BRIEF_SOUL_MARKER,
    '',
    quoteBriefForSoul(brief),
    '',
    `_Quoted verbatim from \`${ssotPath}/${PROJECT_BRIEF_FILENAME}\` on ${now.toISOString().slice(0, 10)}. AtlasMind added this once and does not edit it; change it as you like._`,
    '',
  ].join('\n');
}

function soulProposal(brief: string, ssotPath: string, soul: string | undefined, now: Date): BriefSoulProposal {
  const relPath = `${ssotPath}/project_soul.md`;
  const section = buildBriefSoulSection(brief, ssotPath, now);
  if (soul === undefined) {
    return {
      mode: 'create',
      relPath,
      insertion: ['# Project Soul', '', '> This file is the living identity of the project.', '', section].join('\n'),
      basis: undefined,
    };
  }
  // Appended after whatever is there, separated by one blank line. The bytes
  // already in the file are never part of the write.
  const separator = soul.length === 0 ? '' : soul.endsWith('\n\n') ? '' : soul.endsWith('\n') ? '\n' : '\n\n';
  return { mode: 'append', relPath, insertion: `${separator}${section}`, basis: soul };
}

// ── The planner ──────────────────────────────────────────────────

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Plan the chain from the files as they are.
 *
 * Deterministic for the same input, so the proposal a confirmation showed can
 * be recomputed at write time and compared — the writer re-plans rather than
 * trusting what was on screen a minute ago.
 */
export function planBriefChain(input: BriefChainInput): BriefChainPlan {
  const assessment = input.brief === undefined ? undefined : assessBrief(input.brief);
  const briefState: BriefChainPlan['briefState'] = assessment === undefined
    ? 'absent'
    : assessment.usable ? 'usable' : 'unusable';
  const brief = assessment?.usable ? input.brief ?? '' : undefined;
  const briefRel = `${input.ssotPath}/${PROJECT_BRIEF_FILENAME}`;

  const steps: BriefChainStep[] = [];

  // 1. The brief.
  steps.push(briefState === 'usable'
    ? { id: 'brief', label: 'Write the project in your own words', required: true, state: 'done', says: `Your brief is saved at \`${briefRel}\`, exactly as you wrote it.` }
    : {
      id: 'brief',
      label: 'Write the project in your own words',
      required: true,
      state: 'ready',
      says: briefState === 'unusable'
        ? `The brief at \`${briefRel}\` cannot be read into anything yet. ${assessment?.refusal ?? ''} Rewriting it replaces the file, after a confirmation.`.trim()
        : `Write who it is for, what it should do and what should be true once it works. It is saved exactly as written to \`${briefRel}\`; nothing is read out of it until you ask.`,
    });

  // 2. The board.
  const briefCards = input.cards.filter(card => isBriefDerivedCard(card));
  const liveBriefCards = briefCards.filter(card => !card.archived);
  if (brief === undefined) {
    steps.push({ id: 'board', label: 'Read the brief into cards', required: true, state: 'blocked', says: 'Waits for a brief to read.' });
  } else if (briefCards.length > 0) {
    steps.push({ id: 'board', label: 'Read the brief into cards', required: true, state: 'done', says: `${plural(briefCards.length, 'card')} on the board came from your brief.` });
  } else {
    steps.push({
      id: 'board',
      label: 'Read the brief into cards',
      required: true,
      state: 'ready',
      says: 'Atlas reads your brief and proposes cards. A card that cannot quote your brief word for word becomes a question, and every card is shown before any is added to the board.',
    });
  }

  // 3. The roadmap.
  const roadmapNormalized = input.roadmap === undefined
    ? undefined
    : new Set(input.roadmap.map(item => normalizeForRoadmapMatch(item.text)));
  const raise: BriefRoadmapProposal[] = [];
  const heldBack = { questions: 0, notInBrief: 0, alreadyOnRoadmap: 0 };
  const raisedCards: BriefChainCard[] = [];

  if (brief !== undefined && roadmapNormalized !== undefined) {
    const proposed = new Set<string>();
    for (const card of liveBriefCards) {
      if (card.derived?.roadmapNormalized !== undefined && roadmapNormalized.has(card.derived.roadmapNormalized)) {
        raisedCards.push(card);
        heldBack.alreadyOnRoadmap += 1;
        continue;
      }
      const quote = readBriefCardQuote(card.body);
      if (/\?\s*$/.test(card.title) || quote === undefined || !isDerivableCardKind(card.kind)) {
        heldBack.questions += 1;
        continue;
      }
      if (!briefContainsQuote(brief, quote)) {
        // The brief was rewritten, or the card was. Either way the card no
        // longer rests on anything the owner said, so it is not offered.
        heldBack.notInBrief += 1;
        continue;
      }
      const derivation = deriveCardRoadmapText(
        { id: card.id, title: card.title, summary: card.body, kind: card.kind },
        collectCardConnectionSources(input.cards, input.connections ?? [], card.id),
      );
      const normalized = normalizeForRoadmapMatch(derivation.text);
      if (normalized.length === 0) {
        heldBack.questions += 1;
        continue;
      }
      if (roadmapNormalized.has(normalized) || proposed.has(normalized)) {
        heldBack.alreadyOnRoadmap += 1;
        continue;
      }
      proposed.add(normalized);
      raise.push({
        cardId: card.id,
        cardTitle: card.title,
        kind: card.kind,
        quote,
        text: derivation.text,
        normalized,
        contradicted: derivation.contradicted,
      });
    }
  }

  const boardDone = steps[1]?.state === 'done';
  if (!boardDone) {
    steps.push({ id: 'roadmap', label: 'Raise grounded cards as roadmap items', required: true, state: 'blocked', says: 'Waits for cards read out of the brief.' });
  } else if (roadmapNormalized === undefined) {
    steps.push({ id: 'roadmap', label: 'Raise grounded cards as roadmap items', required: true, state: 'blocked', says: 'The roadmap could not be read, so nothing can be checked against it. Nothing will be raised until it can.' });
  } else if (raise.length > 0) {
    steps.push({
      id: 'roadmap',
      label: 'Raise grounded cards as roadmap items',
      required: true,
      state: 'ready',
      says: `${plural(raise.length, 'card')} quote${raise.length === 1 ? 's' : ''} your brief and can become roadmap items. You choose which; each line is shown before it is written to the roadmap.${heldBack.questions > 0 ? ` ${plural(heldBack.questions, 'question')} stay${heldBack.questions === 1 ? 's' : ''} on the board.` : ''}`,
    });
  } else if (raisedCards.length > 0) {
    steps.push({ id: 'roadmap', label: 'Raise grounded cards as roadmap items', required: true, state: 'done', says: `${plural(raisedCards.length, 'card')} from your brief ${raisedCards.length === 1 ? 'is' : 'are'} on the roadmap.` });
  } else {
    const reasons: string[] = [];
    if (heldBack.questions > 0) {
      reasons.push(`${plural(heldBack.questions, 'card')} ${heldBack.questions === 1 ? 'asks' : 'ask'} a question your brief left open`);
    }
    if (heldBack.notInBrief > 0) {
      reasons.push(`${plural(heldBack.notInBrief, 'card')} quote${heldBack.notInBrief === 1 ? 's' : ''} words no longer in your brief`);
    }
    steps.push({
      id: 'roadmap',
      label: 'Raise grounded cards as roadmap items',
      required: true,
      state: 'nothing-to-do',
      says: `Nothing from your brief is ready to become work${reasons.length > 0 ? `: ${reasons.join('; ')}` : ''}. Answer a question on the board and raise it from the card when it is decided.`,
    });
  }

  // 4. Plan files — optional.
  const plans: BriefPlanProposal[] = [];
  const raisedNormalized = new Set(raisedCards.map(card => card.derived?.roadmapNormalized ?? ''));
  const raisedItems = (input.roadmap ?? []).filter(item => !item.completed && raisedNormalized.has(normalizeForRoadmapMatch(item.text)));
  for (const item of raisedItems) {
    if (item.planPath === undefined && item.nodeId !== undefined) {
      plans.push({ nodeId: item.nodeId, text: item.text, relPath: roadmapPlanRelPath(input.ssotPath, item.nodeId, item.text) });
    }
  }
  if (raisedItems.length === 0) {
    steps.push({ id: 'plans', label: 'File a plan for each raised item', required: false, state: 'blocked', says: 'Waits for roadmap items raised from your brief.' });
  } else if (input.roadmapGraphWritable === false) {
    steps.push({ id: 'plans', label: 'File a plan for each raised item', required: false, state: 'blocked', says: 'The roadmap graph was written by a newer AtlasMind, so no plan can be linked to it from here.' });
  } else if (plans.length > 0) {
    steps.push({
      id: 'plans',
      label: 'File a plan for each raised item',
      required: false,
      state: 'ready',
      says: `Create ${plural(plans.length, 'plan file')} under \`${input.ssotPath}/roadmap/plans/\` — empty frames of questions, created only where none exists, and linked from the roadmap.`,
    });
  } else {
    steps.push({ id: 'plans', label: 'File a plan for each raised item', required: false, state: 'done', says: `Every open item raised from your brief has a plan file.` });
  }

  // 5. The soul — optional.
  let soul: BriefSoulProposal | undefined;
  if (brief === undefined) {
    steps.push({ id: 'soul', label: 'Quote the brief in the project soul', required: false, state: 'blocked', says: 'Waits for a brief to quote.' });
  } else if (input.soul !== undefined && input.soul.includes(BRIEF_SOUL_MARKER)) {
    const current = input.soul.includes(quoteBriefForSoul(brief));
    steps.push({
      id: 'soul',
      label: 'Quote the brief in the project soul',
      required: false,
      state: 'done',
      says: current
        ? 'The project soul quotes your brief.'
        : 'The project soul quotes an earlier version of your brief. AtlasMind does not edit that section; update it by hand if it should match.',
    });
  } else {
    soul = soulProposal(brief, input.ssotPath, input.soul, input.now);
    steps.push({
      id: 'soul',
      label: 'Quote the brief in the project soul',
      required: false,
      state: 'ready',
      says: soul.mode === 'create'
        ? `Create \`${soul.relPath}\` with your brief quoted word for word under "${BRIEF_SOUL_HEADING.slice(3)}".`
        : `Append your brief, quoted word for word, to the end of \`${soul.relPath}\` under "${BRIEF_SOUL_HEADING.slice(3)}". Nothing already in the file changes.`,
    });
  }

  const next = chooseNext(steps);
  return {
    briefState,
    steps,
    ...(next === undefined ? {} : { next: next.id }),
    nextSays: describeNext(steps, next),
    raise,
    heldBack,
    plans,
    ...(soul === undefined ? {} : { soul }),
    rules: BRIEF_CHAIN_RULES,
  };
}

/**
 * The first required step that can run; once the required steps are settled,
 * the first optional one. A blocked required step stops the chain there, since
 * everything after it waits on it.
 */
function chooseNext(steps: readonly BriefChainStep[]): BriefChainStep | undefined {
  for (const step of steps.filter(candidate => candidate.required)) {
    if (step.state === 'ready') {
      return step;
    }
    if (step.state === 'blocked') {
      return undefined;
    }
  }
  return steps.find(step => !step.required && step.state === 'ready');
}

function describeNext(steps: readonly BriefChainStep[], next: BriefChainStep | undefined): string {
  if (next !== undefined) {
    return `${next.required ? 'Next' : 'Optional next'}: ${next.label.toLowerCase()}. ${next.says}`;
  }
  const blocked = steps.find(step => step.required && step.state === 'blocked');
  if (blocked !== undefined) {
    return `Stopped at "${blocked.label.toLowerCase()}". ${blocked.says}`;
  }
  return 'Everything your brief can seed is in place. From here the board and the roadmap are yours to change.';
}

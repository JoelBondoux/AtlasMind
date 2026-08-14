/**
 * Chat-window stress battery.
 *
 * This is not a unit suite. `tests/**` asserts what the code is contracted to
 * do; this asserts what the chat window ought to do *for a person reading it* —
 * a deliberately higher bar than the code currently clears. A failure here is a
 * finding, not a regression, which is why it runs from its own config and never
 * joins the pre-commit suite.
 *
 *   npx vitest run --config evals/vitest.stress.config.ts
 *
 * Every probe drives the real exported boundary functions — the same ones the
 * native participant and the chat panel call — so a result here is a statement
 * about the shipped surface, not about a mock of it. Each probe carries the
 * question it is asking on the user's behalf, so a failure reads as a defect
 * report rather than a red assertion.
 *
 * Ten lanes, matching what a chat window owes the person using it:
 *   QUESTION      — a question the model asks reaches the user as something answerable
 *   ANSWER        — the answer reaches the screen whole
 *   INFO          — the user is told what actually happened, once
 *   CONTINUITY    — the window remembers the conversation the user is having
 *   REPAIR        — when the user pushes back, the window notices
 *   STOP          — a turn that ends waiting says so, and says what it is waiting to do
 *   COMMANDS      — a slash command does the thing it names, or is corrected
 *   TOOLING       — MCP and API tools are graded for what they actually do
 *   ORCHESTRATION — routing, delegation and the tool-failure predicate
 *   GUIDANCE      — chat knows the product it is part of, and can reach it
 *
 * The STOP lane exists because three independent detectors decide whether a turn
 * is waiting on a project run, and nothing makes them agree:
 * `detectProjectRunProposal` draws the decision card, `detectResponseQuickReplies`
 * draws the pills, and `isAutonomousContinuationPrompt` *accepts the answer*. The
 * third is unconditional — "continue" and "yes" are always taken — so a run can be
 * started from a turn where neither of the first two ever admitted one was pending.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  detectResponseQuickReplies,
  buildQuickReplyPayload,
  reconcileAssistantResponse,
  sanitizeResponseTail,
  ensureAssistantVisibleResponse,
  shouldCarryForwardConversationContext,
  renderAssistantResponseFooter,
  detectUserFrustrationSignal,
  detectProjectRunProposal,
  resolveProjectExecutionGoal,
  isAutonomousContinuationPrompt,
} from '../src/chat/participant';
import { SessionConversation } from '../src/chat/sessionConversation';
import { ATLAS_SLASH_COMMANDS, routePanelPrompt, routeBypassesFreeformModel } from '../src/views/chatSlashRouting';
import { classifyToolInvocation, requiresToolApproval } from '../src/core/toolPolicy';
import { classifyToolFailure } from '../src/core/orchestrator';
import { getBlockedGhReason } from '../src/skills/terminalRun';

type Lane = 'QUESTION' | 'ANSWER' | 'INFO' | 'CONTINUITY' | 'REPAIR' | 'STOP' | 'COMMANDS' | 'TOOLING' | 'ORCHESTRATION' | 'GUIDANCE';

/**
 * The GUIDANCE lane measures reach rather than behaviour, so it reads the
 * sources it is measuring. Deliberately self-measuring: a hand-written count
 * would be wrong within a week, and a coverage figure nobody can reproduce is
 * an opinion.
 */
const readSource = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

const CHAT_SURFACES = ['../src/chat/participant.ts', '../src/views/chatPanel.ts'] as const;

/** Every `atlasmind.*` command id either chat surface can invoke. */
const chatReachableCommands = (): Set<string> => {
  const found = new Set<string>();
  for (const file of CHAT_SURFACES) {
    for (const match of readSource(file).matchAll(/'(atlasmind\.[a-zA-Z.]+)'/g)) {
      found.add(match[1]!);
    }
  }
  return found;
};

/** Page arguments chat actually passes when opening a panel. */
const chatReachablePages = (): Set<string> => {
  const found = new Set<string>();
  for (const file of CHAT_SURFACES) {
    const source = readSource(file);
    for (const match of source.matchAll(/command:\s*'atlasmind\.open[A-Za-z]+'[\s\S]{0,200}?arguments:\s*\[\s*'([a-zA-Z-]+)'/g)) {
      found.add(match[1]!);
    }
    for (const match of source.matchAll(/executeCommand\(\s*'atlasmind\.open[A-Za-z]+'\s*,\s*'([a-zA-Z-]+)'/g)) {
      found.add(match[1]!);
    }
  }
  return found;
};

interface Probe {
  id: string;
  lane: Lane;
  /** What the probe asks on the user's behalf. */
  asks: string;
  /** Why this shape is realistic for this project, not a contrived string. */
  because: string;
  /** Returns a failure description, or undefined when the window behaves. */
  check: () => string | undefined;
}

const results: Array<{ probe: Probe; failure?: string }> = [];

/** Metadata is structural here; the footer only reads a few fields. */
const meta = (value: Record<string, unknown>): Parameters<typeof renderAssistantResponseFooter>[0] =>
  value as unknown as Parameters<typeof renderAssistantResponseFooter>[0];

const chipsFor = (text: string): string[] | undefined =>
  detectResponseQuickReplies(text)?.quickReplies?.map(reply => reply.label);

const questionFor = (text: string): string | undefined =>
  detectResponseQuickReplies(text)?.followupQuestion;

const transcriptOf = (turns: Array<[string, string]>) => {
  const conversation = new SessionConversation();
  for (const [prompt, reply] of turns) {
    conversation.recordTurn(prompt, reply);
  }
  return conversation;
};

const PROBES: Probe[] = [
  // ── QUESTION ───────────────────────────────────────────────────────────────
  {
    id: 'Q1-filename',
    lane: 'QUESTION',
    asks: 'A question naming a file still reaches the user as a question.',
    because: 'Half of what Atlas offers to do names a file — the doc contract alone names README.md, CHANGELOG.md and package.json in the same breath.',
    check: () => {
      const text = 'I can bring the banner in line with the manifest.\n\nWant me to update README.md?';
      const question = questionFor(text);
      if (!question) { return 'no question detected at all — the user gets no chips and no follow-up prompt'; }
      if (!/want me/i.test(question)) { return `question surfaced as ${JSON.stringify(question)}, which is not what was asked`; }
      const chips = chipsFor(text);
      return chips?.join('/') === 'Yes/No' ? undefined : `expected Yes/No chips, got ${JSON.stringify(chips)}`;
    },
  },
  {
    id: 'Q2-source-path',
    lane: 'QUESTION',
    asks: 'A question naming a source path reaches the user as a question.',
    because: 'Every code answer in this repo ends by offering to open or edit a `src/**/*.ts` path.',
    check: () => {
      const text = 'That logic lives in the participant.\n\nDo you want me to open src/chat/participant.ts?';
      const chips = chipsFor(text);
      return chips?.join('/') === 'Yes/No' ? undefined : `expected Yes/No chips, got ${JSON.stringify(chips)} (question: ${JSON.stringify(questionFor(text))})`;
    },
  },
  {
    id: 'Q3-plain-yes-no',
    lane: 'QUESTION',
    asks: 'A plain confirmatory question produces Yes/No. [control]',
    because: 'If this fails the lane is broken outright rather than edge-case broken.',
    check: () => {
      const chips = chipsFor('The suite is green locally.\n\nShall I run the tests now?');
      return chips?.join('/') === 'Yes/No' ? undefined : `expected Yes/No chips, got ${JSON.stringify(chips)}`;
    },
  },
  {
    id: 'Q4-version-number',
    lane: 'QUESTION',
    asks: 'A question naming a version reaches the user as a question.',
    because: 'Every commit in this repo bumps a SemVer version, so the release turn always ends this way.',
    check: () => {
      const text = 'The commit range warrants a patch bump.\n\nReady to tag v0.310.2?';
      const question = questionFor(text);
      if (!question) { return 'no question detected — the release turn ends with no way to say yes'; }
      return /ready to tag/i.test(question) ? undefined : `question surfaced as ${JSON.stringify(question)}`;
    },
  },
  {
    id: 'Q5-selection-list',
    lane: 'QUESTION',
    asks: 'A pick-one question with a short option list produces one chip per option. [control]',
    because: 'This is the shape the detector was built for; it anchors the failures around it.',
    check: () => {
      const chips = chipsFor('Three things are outstanding.\n\nWhich should I start with?\n\n- Fix the router penalty\n- Update the wiki pages\n- Ship the release');
      return chips?.length === 3 ? undefined : `expected 3 chips, got ${JSON.stringify(chips)}`;
    },
  },
  {
    id: 'Q6-long-options',
    lane: 'QUESTION',
    asks: 'A genuine choice between two real options is clickable even when the options are described, not named.',
    because: 'A model asked to explain its options writes clauses, not nouns — the 48-character label cap silently drops the chips.',
    check: () => {
      const chips = chipsFor([
        'There are two ways to close this.',
        '',
        'Which approach do you prefer?',
        '',
        '- Narrow the tool-failure predicate to an exit code so ordinary file reads stop counting',
        '- Append the failure dump instead of overwriting the model answer',
      ].join('\n'));
      return chips?.length === 2 ? undefined : `expected 2 chips, got ${JSON.stringify(chips)} — a real choice arrived with no way to click it`;
    },
  },
  {
    id: 'Q7-two-questions',
    lane: 'QUESTION',
    asks: 'When a turn ends with two questions, the user is not silently answering only one.',
    because: 'A model wrapping up a change routinely asks about the wiki and the changelog in the same paragraph.',
    check: () => {
      const question = questionFor('That is committed.\n\nShould I update the wiki as well? And do you want a changelog entry?');
      if (!question) { return 'no question detected'; }
      return /wiki/i.test(question) && /changelog/i.test(question)
        ? undefined
        : `only one of the two questions is surfaced (${JSON.stringify(question)}); clicking Yes answers a question the user never saw singled out`;
    },
  },
  {
    id: 'Q8-heading-question',
    lane: 'QUESTION',
    asks: 'A question written as a closing heading survives the sanitizer and still reaches the user.',
    because: 'Models format a closing prompt as a heading constantly; the tail sanitizer runs before detection.',
    check: () => {
      const raw = 'I have the plan ready.\n\n### Ready to proceed?';
      const question = questionFor(sanitizeResponseTail(raw));
      return question ? undefined : 'the tail sanitizer strips the closing heading, so the question is deleted before the user ever sees it';
    },
  },
  {
    id: 'Q9-pill-fidelity',
    lane: 'QUESTION',
    asks: 'A clicked pill submits exactly what the pill says. [control]',
    because: 'The pill prompt is model-authored text submitted as though the user typed it — it must not exceed the visible label.',
    check: () => {
      const payload = buildQuickReplyPayload('Which should I start with?\n\n- Fix the router\n- Update the wiki\n- Ship the release');
      if (!payload) { return 'no payload produced'; }
      const mismatched = payload.replies.filter(reply => reply.prompt.toLowerCase() !== reply.label.toLowerCase());
      return mismatched.length === 0 ? undefined : `pill submits text the user cannot see: ${JSON.stringify(mismatched)}`;
    },
  },

  // ── ANSWER ─────────────────────────────────────────────────────────────────
  {
    id: 'A1-empty-answer',
    lane: 'ANSWER',
    asks: 'When the model returns nothing, the user is told that, not asked to try harder.',
    because: 'An empty completion is the one moment the user most needs to know the failure was not theirs.',
    check: () => {
      const shown = ensureAssistantVisibleResponse('', undefined);
      return /\b(?:no response|nothing came back|failed|error|could not complete)\b/i.test(shown)
        ? undefined
        : `a failed turn is presented as the user's fault: ${JSON.stringify(shown)}`;
    },
  },
  {
    id: 'A2-heading-tail',
    lane: 'ANSWER',
    asks: 'The answer is not left dangling when its last section header is stripped.',
    because: 'A model cut off at the token limit ends on a heading; the sanitizer removes the heading and leaves a colon pointing at nothing.',
    check: () => {
      const shown = sanitizeResponseTail("Here is what I would change:\n\n## Next steps");
      return /next steps/i.test(shown) || !/:\s*$/.test(shown.trim())
        ? undefined
        : `answer now ends mid-sentence with nothing after it: ${JSON.stringify(shown.trim())}`;
    },
  },
  {
    id: 'A3-unclosed-fence',
    lane: 'ANSWER',
    asks: 'A truncated code block is closed so the rest of the turn is not swallowed. [control]',
    because: 'An unclosed fence turns every following turn into code in the rendered panel.',
    check: () => {
      const shown = sanitizeResponseTail('Try this:\n\n```ts\nconst x = 1;');
      return (shown.match(/^```/gm) ?? []).length % 2 === 0 ? undefined : 'fence left unclosed';
    },
  },
  {
    id: 'A4-divergent-streams',
    lane: 'ANSWER',
    asks: 'The user is not shown two different answers to one question.',
    because: 'When the streamed text and the committed completion diverge, the reconciler appends the whole authoritative answer below a rule.',
    check: () => {
      const streamed = 'The router picks the cheapest model that clears the capability floor.';
      const final = 'The router picks the cheapest model above the capability floor, then applies the budget ceiling.';
      const { additionalText } = reconcileAssistantResponse(streamed, final);
      return additionalText.includes(final)
        ? `the user reads a complete second answer appended below the first, with no indication which is authoritative (${additionalText.length} extra characters)`
        : undefined;
    },
  },

  // ── INFO ───────────────────────────────────────────────────────────────────
  {
    id: 'I1-cost-attribution',
    lane: 'INFO',
    asks: 'The turn footer says what the turn cost.',
    because: 'AtlasMind routes across paid providers and ships a cost dashboard; the transcript is where the spend is actually incurred.',
    check: () => {
      const footer = renderAssistantResponseFooter(meta({ modelUsed: 'claude-sonnet-5', costUsd: 0.0412, inputTokens: 8_400, outputTokens: 900 }));
      return /\$|\bcost\b|\btokens?\b/i.test(footer)
        ? undefined
        : `footer names the model but never the cost or token count: ${JSON.stringify(footer)}`;
    },
  },
  {
    id: 'I2-question-echo',
    lane: 'INFO',
    asks: 'The closing question is put to the user once, not twice.',
    because: 'Detection lifts the trailing question into metadata, and the footer then renders it again under "Next step" directly beneath it.',
    check: () => {
      const answer = 'The banner and the manifest disagree.\n\nShall I fix the banner?';
      const detected = detectResponseQuickReplies(answer);
      const rendered = answer + renderAssistantResponseFooter(meta({
        modelUsed: 'claude-sonnet-5',
        followupQuestion: detected?.followupQuestion,
        suggestedFollowups: [{ label: 'Yes', prompt: 'yes' }],
      }));
      const occurrences = rendered.split(/shall i fix the banner\?/i).length - 1;
      return occurrences <= 1 ? undefined : `the same question is printed ${occurrences} times in one turn`;
    },
  },
  {
    id: 'I3-empty-metadata',
    lane: 'INFO',
    asks: 'A turn with nothing to report renders no footer rather than an empty scaffold. [control]',
    because: 'An empty "Model:" line is worse than none.',
    check: () => (renderAssistantResponseFooter(meta({})) === '' ? undefined : 'empty metadata still rendered a footer'),
  },

  // ── CONTINUITY ─────────────────────────────────────────────────────────────
  {
    id: 'C1-lexical-gap',
    lane: 'CONTINUITY',
    asks: 'A follow-up that changes the tool but not the topic keeps its context.',
    because: 'Carry-forward is decided on lexical overlap with the last three prompts, and a genuine follow-up often shares no words with them.',
    check: () => {
      const conversation = transcriptOf([
        ['the end-to-end coverage is thin, what should we add', 'You have no browser-level tests.'],
        ['what would that cost to run in CI', 'Roughly four minutes a run.'],
        ['and how flaky is that likely to be', 'Manageable with retries.'],
      ]);
      return shouldCarryForwardConversationContext('use Playwright instead', conversation.getTranscript())
        ? undefined
        : 'context dropped on a direct follow-up — the next turn answers with no memory of what "instead" refers to';
    },
  },
  {
    id: 'C2-pronoun-followup',
    lane: 'CONTINUITY',
    asks: 'A bare pronoun follow-up keeps its context. [control]',
    because: '"why did it do that" is unanswerable without the previous turn.',
    check: () => {
      const conversation = transcriptOf([['why is the router penalising sonnet', 'Because the last turn was stamped as an error.']]);
      return shouldCarryForwardConversationContext('why did it do that?', conversation.getTranscript())
        ? undefined
        : 'context dropped on a pronoun follow-up';
    },
  },
  {
    id: 'C3-subject-change',
    lane: 'CONTINUITY',
    asks: 'A genuine change of subject does not drag the old thread along. [control]',
    because: 'Carrying everything forever is the opposite failure and costs tokens on every turn.',
    check: () => {
      const conversation = transcriptOf([['why is the router penalising sonnet', 'Because the last turn was stamped as an error.']]);
      return shouldCarryForwardConversationContext('new topic: walk me through the marketplace publishing identity', conversation.getTranscript())
        ? 'an explicit subject change still carried the previous thread forward'
        : undefined;
    },
  },
  {
    id: 'C4-recent-turns-survive',
    lane: 'CONTINUITY',
    asks: 'After a dozen ordinary turns, the last three are still in the context the model receives.',
    because: 'The reported symptom that opened the 2026-08-11 audit was context lost about three messages in.',
    check: () => {
      const turns: Array<[string, string]> = [];
      for (let n = 1; n <= 12; n++) {
        turns.push([`question ${n} about the delivery pipeline stage ordering`, `answer ${n}: ${'the stage rank decides the column order. '.repeat(6)}`]);
      }
      const context = transcriptOf(turns).buildContext();
      const missing = [10, 11, 12].filter(n => !context.includes(`question ${n} `));
      return missing.length === 0 ? undefined : `the most recent turns are absent from the carried context: ${missing.map(n => `#${n}`).join(', ')}`;
    },
  },
  {
    id: 'C5-long-answer-eviction',
    lane: 'CONTINUITY',
    asks: 'One long answer does not wipe the question that prompted it.',
    because: 'A code-heavy answer routinely exceeds the whole 2500-character context budget, and it is the newest entry.',
    check: () => {
      const conversation = transcriptOf([
        ['how should the arbiter charge for residency', 'Per distinct model, with a refcount.'],
        ['show me the whole slot implementation', `Here it is.\n\n${'const slot = await acquire(model); // hold one HTTP call\n'.repeat(80)}`],
      ]);
      const context = conversation.buildContext();
      return context.includes('how should the arbiter charge for residency')
        ? undefined
        : 'a single long answer evicted the question it was answering — the next turn sees the code with no idea what was asked';
    },
  },

  // ── REPAIR ─────────────────────────────────────────────────────────────────
  {
    id: 'R1-frustration-corpus',
    lane: 'REPAIR',
    asks: 'The window notices when the user is unhappy, in the words people actually use.',
    because: 'The adaptation only fires on a detected signal, so an undetected line means the next turn repeats whatever caused the friction.',
    check: () => {
      const corpus = [
        "that's the third time you've ignored my question",
        "you're not listening to me",
        'stop asking and just do it',
        'I asked you to fix it, not explain it',
        'this is frustrating',
        "forget it, I'll do it myself",
        'why do you keep offering instead of doing',
        'no, I want the actual fix',
      ];
      const missed = corpus.filter(line => !detectUserFrustrationSignal(line));
      const rate = (corpus.length - missed.length) / corpus.length;
      return rate >= 0.625
        ? undefined
        : `only ${corpus.length - missed.length}/${corpus.length} recognised; missed: ${missed.map(line => JSON.stringify(line)).join(', ')}`;
    },
  },
  {
    id: 'R2-no-false-positive',
    lane: 'REPAIR',
    asks: 'Ordinary instructions are not misread as frustration. [control]',
    because: 'A false positive rewrites the system prompt and tunes settings on a turn where nothing was wrong.',
    check: () => {
      const benign = ['can you do this for me when you have a moment', 'just do it the simple way, no need to over-engineer'];
      const flagged = benign.filter(line => detectUserFrustrationSignal(line));
      return flagged.length === 0 ? undefined : `benign phrasing flagged as frustration: ${flagged.map(line => JSON.stringify(line)).join(', ')}`;
    },
  },
  // ── STOP ───────────────────────────────────────────────────────────────────
  //
  // Every probe here uses the same pair of questions: would "yes"/"continue"
  // start a run, and did the turn *say* so? Disagreement between those two is
  // the "it hard stops and never told me" symptom.
  {
    id: 'S1-explicit-offer',
    lane: 'STOP',
    asks: 'A reply that offers a run in the expected words is recognised as a pending decision. [control]',
    because: 'If this fails the lane is broken outright rather than vocabulary-dependent.',
    check: () => (detectProjectRunProposal('That covers the whole change.\n\nWant me to kick off a project run to implement it?')
      ? undefined
      : 'the reference phrasing is not recognised as a proposal'),
  },
  {
    id: 'S2-offer-without-vocabulary',
    lane: 'STOP',
    asks: 'When "yes" would start a project run, the turn said a project run is what starts.',
    because: 'A model wrapping up says "shall I go ahead", not "shall I kick off a project run" — the proposal detector requires the literal run vocabulary.',
    check: () => {
      const reply = 'I can implement this across the four files and update the changelog.\n\nShall I go ahead?';
      const conversation = transcriptOf([['the banner is out of date with the manifest', reply]]);
      const goal = resolveProjectExecutionGoal('yes', conversation.getTranscript());
      if (!goal) { return undefined; }
      return detectProjectRunProposal(reply)
        ? undefined
        : `"yes" starts a project run (goal: ${JSON.stringify(goal)}) from a turn that never mentioned one — the user consents to an edit and gets a planned multi-subtask run`;
    },
  },
  {
    id: 'S3-negation-veto',
    lane: 'STOP',
    asks: 'An unrelated "don\'t" earlier in the reply does not delete the pending-run notice.',
    because: 'The veto pattern scans the last 400 characters for don\'t/can\'t/once you — words that appear in ordinary prose all the time.',
    check: () => {
      const reply = "I don't need anything else from you.\n\nWant me to start a project run to apply it?";
      return detectProjectRunProposal(reply)
        ? undefined
        : 'a stray negation elsewhere in the reply vetoed the decision card, so the offer stands on screen with no control behind it';
    },
  },
  {
    id: 'S4-waiting-in-silence',
    lane: 'STOP',
    asks: 'A turn recognised as waiting on a decision offers something to decide with.',
    because: 'The panel deletes followupQuestion and quickReplies when it sets a pending proposal, so the decision card becomes the only affordance — and the question detector is already silent on any offer naming a file.',
    check: () => {
      const reply = 'Want me to start a project run to update README.md?';
      if (!detectProjectRunProposal(reply)) { return undefined; }
      return detectResponseQuickReplies(reply)
        ? undefined
        : 'the turn is waiting on a decision and surfaces no question and no chips — nothing on screen says a run is pending';
    },
  },
  {
    id: 'S5-deferral-honoured',
    lane: 'STOP',
    asks: 'When the model says it is waiting on the user, "continue" does not start the run anyway.',
    because: '"Once you confirm X, I can start a run" is the model declining to proceed — and the continuation prompt is accepted unconditionally.',
    check: () => {
      const reply = 'Once you confirm the version number, I can start a project run to ship it.';
      const conversation = transcriptOf([['can you ship the release?', reply]]);
      const goal = resolveProjectExecutionGoal('continue', conversation.getTranscript());
      if (!goal) { return undefined; }
      return detectProjectRunProposal(reply)
        ? undefined
        : `"continue" starts a run (goal: ${JSON.stringify(goal)}) the model had just said it was not ready to start`;
    },
  },
  {
    id: 'S6-goal-is-a-goal',
    lane: 'STOP',
    asks: 'The goal a run starts with is a goal, not the word the user used to agree.',
    because: 'The goal is resolved from the trailing question with the offer lead-in stripped, so "Shall I go ahead?" leaves "go ahead" — and the plan, file estimate and cost are all derived from that string.',
    check: () => {
      const reply = 'I can implement this across the four files and update the changelog.\n\nShall I go ahead?';
      const conversation = transcriptOf([['the banner is out of date with the manifest', reply]]);
      const goal = resolveProjectExecutionGoal('yes', conversation.getTranscript())?.trim() ?? '';
      return /^(?:go\s+ahead|proceed|continue|yes|ok(?:ay)?|sure|do\s+it|carry\s+on)$/i.test(goal)
        ? `the run is planned against the goal ${JSON.stringify(goal)} — the affirmation itself, not anything anyone asked for`
        : undefined;
    },
  },
  {
    id: 'S7-no-goal-from-explanation',
    lane: 'STOP',
    asks: 'A bare "continue" after an explanation does not invent a run. [control]',
    because: 'The opposite failure — running something off an informational turn — would be worse than stopping silently.',
    check: () => {
      const conversation = transcriptOf([['what does the local model arbiter do?', 'It decides which model gets the GPU and who waits.']]);
      const goal = resolveProjectExecutionGoal('continue', conversation.getTranscript());
      return goal ? `an explanation turned into a run with goal ${JSON.stringify(goal)}` : undefined;
    },
  },
  {
    id: 'S8-goal-is-recognisable',
    lane: 'STOP',
    asks: 'Whatever a continuation word starts, its goal is something the operator can recognise from the conversation.',
    because: 'Accepting a continuation is not the defect — the assistant describing a plan and the operator saying "proceed" is ordinary, and narrowing the vocabulary would make the window worse without touching the asymmetry. What must hold is that the goal came from the exchange: either the operator asked for it or the assistant proposed it. A goal neither of them would recognise is the shape that made a run read as coming from nowhere.',
    check: () => {
      const words = ['continue', 'proceed', 'yes', 'ok', 'sure', 'go ahead', 'carry on'];
      const conversations = [
        transcriptOf([['the banner is out of date with the manifest', 'I can bring it in line across the four files.\n\nShall I go ahead?']]),
        transcriptOf([['add pagination to the results list', "Here is the plan: paginate server-side, 25 per page, keep the cursor in the query string."]]),
      ];

      // Every word must still be understood as a continuation.
      const unread = words.filter(word => !isAutonomousContinuationPrompt(word));
      if (unread.length > 0) { return `no longer recognised as continuations at all: ${unread.join(', ')}`; }

      const unrecognisable: string[] = [];
      for (const conversation of conversations) {
        const transcript = conversation.getTranscript();
        const said = transcript.map(entry => entry.content.toLowerCase()).join('\n');
        for (const word of words) {
          const goal = resolveProjectExecutionGoal(word, transcript)?.trim().toLowerCase();
          if (goal && !said.includes(goal)) {
            unrecognisable.push(`${JSON.stringify(word)} → ${JSON.stringify(goal)}`);
          }
        }
      }
      return unrecognisable.length === 0
        ? undefined
        : `these resolve to a goal nobody in the conversation said: ${[...new Set(unrecognisable)].join(', ')}`;
    },
  },
  // ── COMMANDS ───────────────────────────────────────────────────────────────
  //
  // The rule the router exists to enforce: a recognised slash command never
  // reaches a model by accident. These probe the edges of "recognised".
  {
    id: 'M1-every-command-routes',
    lane: 'COMMANDS',
    asks: 'Every command the manifest declares is dispatched rather than handed to a model. [control]',
    because: 'A command that produces a plausible model answer teaches the user the feature works and they are holding it wrong.',
    check: () => {
      const leaked = ATLAS_SLASH_COMMANDS
        .map(command => ({ command, route: routePanelPrompt(command === 'project' || command === 'loop' ? `/${command} do a thing` : `/${command}`) }))
        .filter(entry => !routeBypassesFreeformModel(entry.route));
      return leaked.length === 0 ? undefined : `these reach a model: ${leaked.map(entry => `/${entry.command}`).join(', ')}`;
    },
  },
  {
    id: 'M2-manifest-parity',
    lane: 'COMMANDS',
    asks: 'The router knows about exactly the commands the manifest declares. [control]',
    because: 'Drift here is silent: the command autocompletes in the composer and then behaves like a question.',
    check: () => {
      const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
      const declared: string[] = (JSON.parse(manifest).contributes?.chatParticipants ?? [])
        .flatMap((participant: { commands?: Array<{ name: string }> }) => (participant.commands ?? []).map(entry => entry.name));
      const known = new Set<string>(ATLAS_SLASH_COMMANDS);
      const missing = declared.filter(name => !known.has(name));
      const extra = [...known].filter(name => !declared.includes(name));
      return missing.length === 0 && extra.length === 0
        ? undefined
        : `manifest and router disagree — declared-but-unrouted: [${missing.join(', ')}], routed-but-undeclared: [${extra.join(', ')}]`;
    },
  },
  {
    id: 'M3-capitalised-command',
    lane: 'COMMANDS',
    asks: 'A command typed with a capital letter is still a command.',
    because: 'Autocorrect capitalises the first letter after a newline on every touch keyboard and several editors; `/Cost` is a typo people make, not a path.',
    check: () => {
      const route = routePanelPrompt('/Cost');
      return route.kind === 'prose'
        ? '`/Cost` is treated as prose and goes to a model — the user is billed for a model call that answers a question about billing'
        : undefined;
    },
  },
  {
    id: 'M4-trailing-punctuation',
    lane: 'COMMANDS',
    asks: 'A command with a trailing question mark is still a command, or is corrected.',
    because: '`/runs?` is how somebody asks what the command does; it currently reaches a model instead of the router.',
    check: () => {
      const leaked = ['/runs?', '/cost.', '/ship!'].filter(prompt => routePanelPrompt(prompt).kind === 'prose');
      return leaked.length === 0 ? undefined : `these reach a model instead of being dispatched or corrected: ${leaked.join(', ')}`;
    },
  },
  {
    id: 'M5-typo-corrected',
    lane: 'COMMANDS',
    asks: 'A near-miss command name is corrected, not answered. [control]',
    because: 'This is the case the router was written for.',
    check: () => {
      const route = routePanelPrompt('/agent');
      return route.kind === 'unknown' && route.message.includes('/agents')
        ? undefined
        : `expected a correction naming /agents, got ${route.kind}`;
    },
  },
  {
    id: 'M6-paths-stay-prose',
    lane: 'COMMANDS',
    asks: 'A filesystem path at the start of a prompt is not hijacked as a command. [control]',
    because: 'Asking about /etc/hosts or /usr/local/bin is a thing people do constantly in a coding assistant.',
    check: () => {
      const hijacked = ['/usr/local/bin/node is missing', '/etc/hosts has the wrong entry', '/README.md is stale']
        .filter(prompt => routePanelPrompt(prompt).kind !== 'prose');
      return hijacked.length === 0 ? undefined : `treated as commands: ${hijacked.join(' | ')}`;
    },
  },
  {
    id: 'M7-missing-argument',
    lane: 'COMMANDS',
    asks: 'A command needing an argument says so rather than running on empty. [control]',
    because: '`/project` with no goal would otherwise become an autonomous run of the empty string.',
    check: () => {
      const route = routePanelPrompt('/project');
      return route.kind === 'needs-argument' ? undefined : `expected needs-argument, got ${route.kind}`;
    },
  },

  // ── TOOLING ────────────────────────────────────────────────────────────────
  //
  // MCP tools reach the approval gate as `mcp:<server>:<tool>` — they never
  // match a case in the switch, so every one of them is graded by name alone.
  {
    id: 'T1-mcp-read-is-a-read',
    lane: 'TOOLING',
    asks: 'A read-only MCP tool is graded as a read.',
    because: "The project's own gh comment sets the standard: grading a read like a write is \"the kind of friction that gets a gate switched off wholesale\".",
    check: () => {
      const graded = ['mcp:supabase:list_tables', 'mcp:github:get_issue', 'mcp:learn:microsoft_docs_search']
        .map(name => ({ name, policy: classifyToolInvocation(name, {}) }))
        .filter(entry => entry.policy.category !== 'read');
      return graded.length === 0
        ? undefined
        : `graded as ${graded[0]!.policy.category}/${graded[0]!.policy.risk}: ${graded.map(entry => entry.name).join(', ')}`;
    },
  },
  {
    id: 'T2-mcp-write-is-high-risk',
    lane: 'TOOLING',
    asks: 'A write-capable MCP tool is graded high risk. [control]',
    because: 'The safe direction must hold even while the read direction does not.',
    check: () => {
      const soft = ['mcp:gmail:send_message', 'mcp:supabase:apply_migration', 'mcp:shopify:create-product']
        .filter(name => classifyToolInvocation(name, {}).risk !== 'high');
      return soft.length === 0 ? undefined : `graded below high risk: ${soft.join(', ')}`;
    },
  },
  {
    id: 'T3-read-detection-is-reachable',
    lane: 'TOOLING',
    asks: 'The read-name detection can actually fire on the tools it was written for.',
    because: 'READ_LIKE_PREFIXES matches with startsWith, and every MCP tool name starts with the `mcp:` namespace — so the prefix list is unreachable for exactly the tools that need it.',
    check: () => {
      const bare = classifyToolInvocation('list_tables', {}).category;
      const namespaced = classifyToolInvocation('mcp:supabase:list_tables', {}).category;
      return bare === namespaced
        ? undefined
        : `the same tool grades ${bare} bare and ${namespaced} namespaced — the namespace alone decides`;
    },
  },
  {
    id: 'T4-mcp-read-prompts-every-time',
    lane: 'TOOLING',
    asks: 'Under the default approval mode, reading through MCP does not require approval.',
    because: 'ask-on-write is the default; if every MCP read prompts, a session with a connected server is a wall of dialogs and the mode stops meaning anything.',
    check: () => {
      const policy = classifyToolInvocation('mcp:github:get_issue', {});
      return requiresToolApproval('ask-on-write', policy)
        ? 'a read-only MCP call requires approval under ask-on-write, identically to a delete'
        : undefined;
    },
  },
  {
    id: 'T5-unknown-tool-denies',
    lane: 'TOOLING',
    asks: 'A tool nobody recognises is treated as dangerous. [control]',
    because: 'Deny-by-default is the property that makes the rest of this lane safe to have findings in.',
    check: () => {
      const policy = classifyToolInvocation('mcp:unknown:frobnicate', {});
      return policy.risk === 'high' ? undefined : `unknown tool graded ${policy.risk}`;
    },
  },

  // ── ORCHESTRATION ──────────────────────────────────────────────────────────
  {
    id: 'O1-gh-read-vs-write',
    lane: 'ORCHESTRATION',
    asks: 'GitHub reads and GitHub writes are graded differently. [control]',
    because: 'The 2026-08-11 audit found gh absent from the allow-list entirely, making GitHub work impossible rather than merely gated. This checks the repair held.',
    check: () => {
      const read = classifyToolInvocation('terminal-run', { command: 'gh', args: ['pr', 'list'] });
      const write = classifyToolInvocation('terminal-run', { command: 'gh', args: ['pr', 'merge', '189'] });
      const api = classifyToolInvocation('terminal-run', { command: 'gh', args: ['api', '/repos/x/y'] });
      if (read.category !== 'terminal-read') { return `gh pr list graded ${read.category}`; }
      if (write.category !== 'terminal-write') { return `gh pr merge graded ${write.category}`; }
      if (api.category !== 'terminal-write') { return `gh api graded ${api.category}`; }
      return undefined;
    },
  },
  {
    id: 'O2-gh-credentials-blocked',
    lane: 'ORCHESTRATION',
    asks: 'A gh subcommand that would print a token is refused outright. [control]',
    because: 'Refusal must not depend on the approval mode — it would print the token into model context.',
    check: () => (getBlockedGhReason('gh', ['auth', 'token']) ? undefined : 'gh auth token is not blocked'),
  },
  {
    id: 'O3-file-contents-are-not-failures',
    lane: 'ORCHESTRATION',
    asks: 'Reading an ordinary source file does not count as a tool failure.',
    because: "The failure test is a substring match on raw tool output, and file-read returns file contents. When every result in the final round tests as failed, the model's answer is replaced by a failure dump and the turn is stamped finishReason:'error', which permanently penalises the agent and model that did nothing wrong.",
    check: () => {
      const samples = ['../src/core/toolPolicy.ts', '../src/views/chatSlashRouting.ts', '../package.json'];
      const tripped = samples
        .map(relative => ({ relative, why: classifyToolFailure(readFileSync(new URL(relative, import.meta.url), 'utf8')) }))
        .filter(entry => entry.why);
      return tripped.length === 0
        ? undefined
        : `${tripped.length}/${samples.length} ordinary files read as tool failures — ${tripped.map(entry => `${entry.relative} on ${entry.why}`).join('; ')}`;
    },
  },
  {
    id: 'O4-success-is-not-a-failure',
    lane: 'ORCHESTRATION',
    asks: 'Ordinary successful tool output is not read as a failure. [control]',
    because: 'If this fails the predicate is not merely loose, it is inverted.',
    check: () => {
      const tripped = ['On branch develop\nnothing to commit, working tree clean', '{"version":"0.310.1"}', 'All 31 tests passed.']
        .filter(output => classifyToolFailure(output));
      return tripped.length === 0 ? undefined : `graded as failures: ${tripped.map(text => JSON.stringify(text.slice(0, 40))).join(', ')}`;
    },
  },
  {
    id: 'O5-ask-on-external-covers-writes',
    lane: 'ORCHESTRATION',
    asks: 'No approval mode leaves workspace deletion and commits unprompted.',
    because: 'ask-on-external prompts on terminal, network and audio — file-delete, file-write and git-commit are none of those, so the mode permits unattended destructive local changes.',
    check: () => {
      const unprompted = ['file-delete', 'file-write', 'git-commit', 'rollback-checkpoint']
        .filter(tool => !requiresToolApproval('ask-on-external', classifyToolInvocation(tool, {})));
      return unprompted.length === 0
        ? undefined
        : `under ask-on-external these run with no prompt: ${unprompted.join(', ')}`;
    },
  },
  {
    id: 'O6-handoff-is-not-network',
    lane: 'ORCHESTRATION',
    asks: 'Delegating to another agent is not described to the user as reaching the internet. [control]',
    because: 'A mislabelled approval dialog teaches people to stop reading approval dialogs.',
    check: () => {
      const policy = classifyToolInvocation('agent-handoff', { agent_id: 'test-developer' });
      return policy.category !== 'network' && /approved separately/i.test(policy.summary)
        ? undefined
        : `handoff graded ${policy.category} with summary ${JSON.stringify(policy.summary)}`;
    },
  },
  // ── GUIDANCE ───────────────────────────────────────────────────────────────
  //
  // AtlasMind is 108 commands, 134 settings, 13 settings pages and 22 dashboard
  // pages — each addressable to a section or a focused record. The question this
  // lane asks is how much of that the chat window can actually reach on the
  // user's behalf, and whether it knows the surface it is part of exists.
  {
    id: 'G1-page-reach',
    lane: 'GUIDANCE',
    asks: 'Chat can open any page of AtlasMind, not a handful.',
    because: 'Both panels take a page id — SETTINGS_PAGE_IDS has 13, DASHBOARD_PAGE_IDS has 22 — so the destinations exist and are named. Reaching two of them is a wiring gap, not a missing feature.',
    check: () => {
      const settingsPages = (/SETTINGS_PAGE_IDS = \[([^\]]+)\]/.exec(readSource('../src/views/settingsPanel.ts'))?.[1] ?? '').match(/'[^']+'/g) ?? [];
      const dashboardPages = (/DASHBOARD_PAGE_IDS = \[([^\]]+)\]/.exec(readSource('../src/views/projectDashboardPanel.ts'))?.[1] ?? '').match(/'[^']+'/g) ?? [];
      const total = settingsPages.length + dashboardPages.length;
      const reached = chatReachablePages().size;
      return reached >= total
        ? undefined
        : `chat can open ${reached} of ${total} addressable pages (${settingsPages.length} settings + ${dashboardPages.length} dashboard) — every other destination is somewhere the user has to find unaided`;
    },
  },
  {
    id: 'G2-anchor-reach',
    lane: 'GUIDANCE',
    asks: 'Chat can open a page at the place the answer actually is.',
    because: '`SettingsPanelTarget` carries `section` and `query`; `DashboardNavigationTarget` carries a `focus` record. Neither is ever supplied from chat, so the best it can do is drop the user at the top of a long page.',
    check: () => {
      // Scoped to AtlasMind's own panels. An unscoped match hits
      // `workbench.action.chat.open`'s `query` — which prefills the chat box and
      // is not a panel anchor at all — and the probe passes having measured
      // nothing.
      const anchored = CHAT_SURFACES.some(file => /'atlasmind\.open[A-Za-z]+'[\s\S]{0,200}?arguments:\s*\[\s*\{[^}]*\b(?:section|query|focus)\b/.test(readSource(file)));
      return anchored
        ? undefined
        : 'no chat path passes a section, query or focus anchor — the deep-link space exists and is unused, so "it is on the Testing page" is as precise as chat gets';
    },
  },
  {
    id: 'G3-settings-reach',
    lane: 'GUIDANCE',
    asks: 'Chat can change a setting the user asks it to change.',
    because: 'A user who says "turn off automatic research scans" is naming a setting that exists; nothing in the tool set can read or write one, so the request can only be answered with prose.',
    check: () => {
      const skills = readSource('../src/skills/index.ts');
      const capable = /getConfiguration|executeCommand|configuration\.update/.test(skills);
      return capable
        ? undefined
        : 'no skill in the registry can read or write configuration — chat can describe all 134 settings and change none of them';
    },
  },
  {
    id: 'G4-self-knowledge',
    lane: 'GUIDANCE',
    asks: 'The model is told what pages and settings AtlasMind has.',
    because: 'Guiding someone to the right page requires knowing the page list. Neither id space is referenced outside the panel that owns it, so the model is guessing from its training data about a product that ships weekly.',
    check: () => {
      const consumers = ['../src/core/orchestrator.ts', '../src/chat/participant.ts']
        .filter(file => /SETTINGS_PAGE_IDS|DASHBOARD_PAGE_IDS/.test(readSource(file)));
      return consumers.length > 0
        ? undefined
        : 'neither the orchestrator nor the participant references the page id spaces — nothing puts AtlasMind\'s own surface into the prompt, so every navigational answer is unverified recall';
    },
  },
  {
    id: 'G5-command-reach',
    lane: 'GUIDANCE',
    asks: 'The commands chat can trigger are a meaningful share of the commands that exist.',
    because: 'Every reachable command is hand-written into one slash-command handler, so reach grows only when somebody remembers to add a button.',
    check: () => {
      const declared: string[] = (JSON.parse(readSource('../package.json')).contributes?.commands ?? [])
        .map((entry: { command: string }) => entry.command);
      const reachable = [...chatReachableCommands()].filter(id => declared.includes(id));
      const share = reachable.length / Math.max(declared.length, 1);
      return share >= 0.5
        ? undefined
        : `chat can trigger ${reachable.length} of ${declared.length} declared commands (${Math.round(share * 100)}%) — the rest are reachable only if the user already knows they exist`;
    },
  },
  {
    id: 'G6-deep-links-are-valid',
    lane: 'GUIDANCE',
    asks: 'The page ids chat does pass are real page ids. [control]',
    because: 'They are hand-written string literals in a different file from the list that defines them, so nothing prevents drift — and a button opening a panel at a page that no longer exists fails silently on the default tab.',
    check: () => {
      const valid = new Set([
        ...((/SETTINGS_PAGE_IDS = \[([^\]]+)\]/.exec(readSource('../src/views/settingsPanel.ts'))?.[1] ?? '').match(/'([^']+)'/g) ?? []),
        ...((/DASHBOARD_PAGE_IDS = \[([^\]]+)\]/.exec(readSource('../src/views/projectDashboardPanel.ts'))?.[1] ?? '').match(/'([^']+)'/g) ?? []),
      ].map(quoted => quoted.slice(1, -1)));
      const bogus = [...chatReachablePages()].filter(page => !valid.has(page));
      return bogus.length === 0 ? undefined : `chat opens pages that are not declared page ids: ${bogus.join(', ')}`;
    },
  },
  {
    id: 'G7-suggestion-breadth',
    lane: 'GUIDANCE',
    asks: 'When the session shows a setting is wrong for this work, chat says so.',
    because: 'The pattern already exists and works: hitting the tool-iteration ceiling produces a named suggestion and a button that applies it. It fires for exactly one setting, so every other misconfiguration is silent — a budget mode starving a refactor, an approval mode prompting on every MCP read, a context window too small for the file being discussed.',
    check: () => {
      const source = readSource('../src/chat/participant.ts');
      const suggested = new Set(
        [...source.matchAll(/suggested([A-Z][a-zA-Z]*)Limit/g)].map(match => match[1]!),
      );
      return suggested.size >= 3
        ? undefined
        : `only ${suggested.size} setting families are ever suggested from a session (${[...suggested].join(', ') || 'none'}) out of 134 declared settings`;
    },
  },
  {
    id: 'G8-no-unannounced-settings-writes',
    lane: 'GUIDANCE',
    asks: 'Reacting to how the user sounds does not change their settings.',
    because: 'Until v0.310.4 a detected frustration signal wrote `chatSessionTurnLimit` and `chatSessionContextChars` at ConfigurationTarget.Workspace — into `.vscode/settings.json`, which is usually committed — with no trace in the turn beyond a note reading "Learned from friction". Read with the REPAIR lane, a polite "can you do this for me when you have a moment" was enough to trigger it. A tuning *suggestion* is the right shape; a silent write cannot be reviewed, reverted or even attributed.',
    check: () => {
      const source = readSource('../src/chat/participant.ts');
      const frustrationPath = [
        /export async function applyOperatorFrustrationAdaptation[\s\S]*?\n}/,
        /async function persistFrustrationLearning[\s\S]*?\n}/,
      ].map(pattern => pattern.exec(source)?.[0] ?? '');
      if (frustrationPath.some(block => block.length === 0)) {
        return 'could not locate the frustration path — this probe is measuring nothing, fix it before trusting the lane';
      }
      const written = frustrationPath
        .flatMap(block => [...block.matchAll(/configuration\.update\('([^']+)'/g)])
        .map(match => match[1]!);
      return written.length === 0
        ? undefined
        : `the frustration path still writes settings on the user's behalf: ${written.join(', ')}`;
    },
  },
];

describe('chat window stress battery', () => {
  for (const probe of PROBES) {
    it(`[${probe.lane}] ${probe.id} — ${probe.asks}`, () => {
      let failure: string | undefined;
      try {
        failure = probe.check();
      } catch (error) {
        failure = `probe threw: ${error instanceof Error ? error.message : String(error)}`;
      }
      results.push({ probe, failure });
      expect(failure ?? 'ok').toBe('ok');
    });
  }

  afterAll(() => {
    const lanes: Lane[] = ['QUESTION', 'ANSWER', 'INFO', 'CONTINUITY', 'REPAIR', 'STOP', 'COMMANDS', 'TOOLING', 'ORCHESTRATION', 'GUIDANCE'];
    const lines: string[] = [
      '# Chat window stress battery — scorecard',
      '',
      'Generated by `npx vitest run --config evals/vitest.stress.config.ts`.',
      'A failure is a finding about the shipped surface, not a regression.',
      '',
      '| Lane | Passed | Failed |',
      '|---|---:|---:|',
    ];
    for (const lane of lanes) {
      const inLane = results.filter(entry => entry.probe.lane === lane);
      lines.push(`| ${lane} | ${inLane.filter(entry => !entry.failure).length} | ${inLane.filter(entry => entry.failure).length} |`);
    }
    lines.push('', '## Findings', '');
    const failures = results.filter(entry => entry.failure);
    if (failures.length === 0) {
      lines.push('None — every probe passed.');
    }
    for (const { probe, failure } of failures) {
      lines.push(`### ${probe.id} (${probe.lane})`, '', `**Asked:** ${probe.asks}`, '', `**Why this shape:** ${probe.because}`, '', `**Observed:** ${failure}`, '');
    }
    writeFileSync(new URL('./chat-window-stress-report.md', import.meta.url), `${lines.join('\n')}\n`, 'utf8');
    console.log(`\n${lines.slice(5, 12).join('\n')}\n`);
  });
});

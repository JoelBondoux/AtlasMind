import type { SessionTranscriptEntry } from '../chat/sessionConversation.js';

/**
 * Questions about the conversation itself, answered from the conversation.
 *
 * Observed: *"what was my question two turns ago?"* answered with **"Improve
 * end-to-end test coverage by adding a Playwright test for Alcyone's initial
 * rendering state…"* — a paraphrase of the task in progress, and a question the
 * operator had never asked.
 *
 * That is the worst-shaped hallucination available here. Fabricating about code
 * can be checked against the code; fabricating about the exchange contradicts a
 * verbatim record sitting in memory, and the operator's only defence is to
 * remember better than the assistant claims to.
 *
 * So no model answers this. The transcript is right there, it is exact, and a
 * paraphrase of it is strictly worse than a quotation — the same reasoning that
 * keeps release notes verbatim in `releasePreparation` rather than summarised.
 *
 * Three rules.
 *
 * **Only about the operator's own messages.** "What did I ask?" is answerable
 * from the record. "What did you say about X?" is a request to *interpret*
 * previous answers, which is a model's job and not this.
 *
 * **Quoted, never paraphrased**, and truncated with an ellipsis rather than
 * rewritten if it is long.
 *
 * **Absent is said, never filled.** Asked for a turn further back than the
 * session goes, this says how many there are instead of returning the oldest and
 * letting it read as the one requested.
 */

/** Written ordinals people actually type, in the position they mean. */
const ORDINAL_WORDS: Readonly<Record<string, number>> = {
  last: 1, previous: 1, first: 1, one: 1, two: 2, second: 2, three: 3, third: 3,
  four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7,
};

export interface ConversationRecallRequest {
  /** How many user turns back, counting the most recent as 1. */
  turnsBack: number;
}

/**
 * Recognise a question about what the operator previously said.
 *
 * Deliberately narrow. It has to name *the operator's* utterance and a position,
 * because a loose match here would start intercepting ordinary questions and
 * answering them with a quotation.
 */
export function parseConversationRecallRequest(prompt: string): ConversationRecallRequest | undefined {
  const text = prompt.trim().toLowerCase();
  if (text.length > 120) {
    return undefined;
  }
  // Must be about what *I* said, not about what the assistant answered.
  if (!/\b(?:my|i)\b/.test(text) || !/\b(?:question|ask(?:ed)?|say|said|said\s+earlier|message|prompt|request)\b/.test(text)) {
    return undefined;
  }
  if (!/\b(?:what|which|remind)\b/.test(text)) {
    return undefined;
  }

  const numeric = /(\d+)\s*(?:turns?|messages?|questions?|prompts?)\s*(?:ago|back|before)/.exec(text);
  if (numeric?.[1]) {
    const parsed = Number.parseInt(numeric[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? { turnsBack: parsed } : undefined;
  }

  const worded = /\b([a-z]+)\s*(?:turns?|messages?|questions?|prompts?)\s*(?:ago|back|before)/.exec(text);
  const fromWord = worded?.[1] ? ORDINAL_WORDS[worded[1]] : undefined;
  if (fromWord !== undefined) {
    return { turnsBack: fromWord };
  }

  // "what was my last question", "what did I just ask", "remind me what I asked"
  if (/\b(?:last|previous|just)\b/.test(text) || /^remind me what i (?:asked|said)/.test(text)) {
    return { turnsBack: 1 };
  }
  return undefined;
}

const MAX_QUOTED_CHARS = 400;

export interface ConversationRecallAnswer {
  markdown: string;
  /** The turn quoted, or undefined when the session does not reach that far. */
  quoted?: string;
}

/**
 * Answer it, or say the session does not go back that far.
 *
 * `turnsBack` counts the operator's *own* messages and excludes the question
 * being asked right now — "two turns ago" from within a question means two
 * before this one, which is what a person means and not what an off-by-one
 * gives them.
 */
export function answerConversationRecall(
  request: ConversationRecallRequest,
  transcript: readonly SessionTranscriptEntry[],
  currentPrompt?: string,
): ConversationRecallAnswer {
  const userTurns = transcript
    .filter(entry => entry.role === 'user' && entry.content.trim().length > 0)
    .map(entry => entry.content.trim())
    // The question being asked now is not one of the turns it is asking about.
    .filter(content => currentPrompt === undefined || content !== currentPrompt.trim());

  const index = userTurns.length - request.turnsBack;
  if (index < 0 || userTurns.length === 0) {
    return {
      markdown: userTurns.length === 0
        ? 'This is the first thing you have asked in this session, so there is nothing earlier to quote.'
        : `This session only goes back ${userTurns.length} message${userTurns.length === 1 ? '' : 's'}, so there is no turn ${request.turnsBack} back to quote.`,
    };
  }

  const quoted = userTurns[index]!;
  const shown = quoted.length > MAX_QUOTED_CHARS
    ? `${quoted.slice(0, MAX_QUOTED_CHARS - 1).trimEnd()}…`
    : quoted;
  const label = request.turnsBack === 1 ? 'Your previous message was' : `Your message ${request.turnsBack} turns ago was`;

  return {
    // Quoted, so it is checkable against the transcript above it.
    markdown: `${label}:\n\n> ${shown.split('\n').join('\n> ')}`,
    quoted,
  };
}

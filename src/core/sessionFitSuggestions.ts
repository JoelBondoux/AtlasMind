/**
 * When the session itself shows a setting is wrong for the work, say so.
 *
 * The pattern already existed and worked, for exactly one thing: hit the
 * tool-iteration ceiling and chat names a value and offers a button that applies
 * it. Two setting families out of 134 were ever suggested, so every other
 * misconfiguration stayed silent — a context window too small for the file under
 * discussion, an approval mode prompting on every remote read, a budget mode
 * starving a refactor. The operator's only signal was that the work went badly.
 *
 * Three rules, in the house style.
 *
 * **Severity and threshold come from a declared table, never a model.** A
 * suggestion raised on a judgement made last Tuesday is not comparable with one
 * raised today, and comparability is what lets somebody dismiss a rule for good.
 * Every suggestion names the rule that produced it.
 *
 * **A suggestion is not a change.** Nothing here writes; the result is text and
 * a proposed value, and applying it goes through `atlasmind-settings`, which puts
 * a modal naming both values in front of the operator. This module exists partly
 * *because* the automatic path was removed — the thing worth keeping about it was
 * noticing, not acting.
 *
 * **A rule that cannot see its input does not fire.** Every field on the input
 * is optional and absent means *not observed*, never zero. A rule inferring
 * "no approvals were needed" from an absent count would nag on every fresh
 * session.
 */

export type SessionFitRuleId =
  | 'tool-iteration-ceiling'
  | 'tool-calls-per-turn-ceiling'
  | 'context-window-too-small'
  | 'approval-mode-noisy';

export interface SessionFitRule {
  id: SessionFitRuleId;
  /** The setting this rule is about. */
  key: string;
  /** Why this rule exists, in the words the operator will read. */
  rationale: string;
}

/**
 * The declared table. Order is the ranking: a run that stopped outranks a run
 * that was merely noisy, because the first has already cost the operator
 * something.
 */
export const SESSION_FIT_RULES: readonly SessionFitRule[] = [
  {
    id: 'tool-iteration-ceiling',
    key: 'atlasmind.maxToolIterations',
    rationale: 'the run stopped at the tool-iteration ceiling rather than because the work was done',
  },
  {
    id: 'tool-calls-per-turn-ceiling',
    key: 'atlasmind.maxToolCallsPerTurn',
    rationale: 'a turn stopped at the tool-calls-per-turn ceiling rather than because the work was done',
  },
  {
    id: 'context-window-too-small',
    key: 'atlasmind.chatSessionContextChars',
    rationale: 'the conversation being carried forward is smaller than the material under discussion, so earlier turns are being dropped',
  },
  {
    id: 'approval-mode-noisy',
    key: 'atlasmind.toolApprovalMode',
    rationale: 'this session has spent more time in approval dialogs than a mode change would cost',
  },
];

export interface SessionFitInput {
  /** Set when a run stopped at the iteration ceiling, with the value that would have let it finish. */
  iterationLimitHit?: boolean;
  suggestedIterationLimit?: number;
  /** As above, for tool calls within a single turn. */
  toolCallsPerTurnLimitHit?: boolean;
  suggestedToolCallsPerTurnLimit?: number;
  /** The configured carry-forward budget, and the size of what this turn actually handled. */
  contextChars?: number;
  turnInputChars?: number;
  /** How many approval dialogs this session has raised, and the current mode. */
  approvalPromptsThisSession?: number;
  approvalMode?: string;
}

export interface SessionFitSuggestion {
  rule: SessionFitRuleId;
  key: string;
  /** The value being proposed, ready to hand to the settings tool. */
  value: number | string;
  /** One sentence, naming the setting and what changing it would do. */
  message: string;
}

/** Above this many approval dialogs in one session, the mode is the problem. */
const NOISY_APPROVAL_THRESHOLD = 8;

/**
 * How much larger the material must be than the carried context before the
 * window is the thing at fault rather than the conversation being long.
 */
const CONTEXT_PRESSURE_RATIO = 1.5;

/** Round a proposed character budget to something a person would have typed. */
function roundBudget(value: number): number {
  return Math.min(12_000, Math.ceil(value / 500) * 500);
}

export function deriveSessionFitSuggestions(input: SessionFitInput): SessionFitSuggestion[] {
  const suggestions: SessionFitSuggestion[] = [];

  if (input.iterationLimitHit && typeof input.suggestedIterationLimit === 'number') {
    suggestions.push({
      rule: 'tool-iteration-ceiling',
      key: 'atlasmind.maxToolIterations',
      value: input.suggestedIterationLimit,
      message: `This run stopped at the tool-iteration ceiling, not because the work was finished. Raising \`atlasmind.maxToolIterations\` to ${input.suggestedIterationLimit} would let it continue.`,
    });
  }

  if (input.toolCallsPerTurnLimitHit && typeof input.suggestedToolCallsPerTurnLimit === 'number') {
    suggestions.push({
      rule: 'tool-calls-per-turn-ceiling',
      key: 'atlasmind.maxToolCallsPerTurn',
      value: input.suggestedToolCallsPerTurnLimit,
      message: `A turn stopped at the tool-calls-per-turn ceiling. Raising \`atlasmind.maxToolCallsPerTurn\` to ${input.suggestedToolCallsPerTurnLimit} would let it finish in one turn.`,
    });
  }

  // Both numbers must have been observed. Treating an absent turn size as zero
  // would make this fire on every fresh session, which is how a suggestion
  // becomes something people learn to ignore.
  if (typeof input.contextChars === 'number'
    && typeof input.turnInputChars === 'number'
    && input.contextChars > 0
    && input.turnInputChars > input.contextChars * CONTEXT_PRESSURE_RATIO) {
    const proposed = roundBudget(input.turnInputChars);
    if (proposed > input.contextChars) {
      suggestions.push({
        rule: 'context-window-too-small',
        key: 'atlasmind.chatSessionContextChars',
        value: proposed,
        message: `This turn handled about ${input.turnInputChars.toLocaleString()} characters while only ${input.contextChars.toLocaleString()} are carried between turns, so earlier turns are being dropped. Raising \`atlasmind.chatSessionContextChars\` to ${proposed} would keep more of the conversation.`,
      });
    }
  }

  if (typeof input.approvalPromptsThisSession === 'number'
    && input.approvalPromptsThisSession >= NOISY_APPROVAL_THRESHOLD
    && input.approvalMode === 'always-ask') {
    suggestions.push({
      rule: 'approval-mode-noisy',
      key: 'atlasmind.toolApprovalMode',
      value: 'ask-on-write',
      message: `This session has raised ${input.approvalPromptsThisSession} approval dialogs. \`atlasmind.toolApprovalMode\` is \`always-ask\`; \`ask-on-write\` still asks before anything is changed but stops asking about reads.`,
    });
  }

  return suggestions;
}

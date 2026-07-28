/**
 * When a Buzz send needs a confirmation dialog, and when it does not.
 *
 * Every outbound path in AtlasMind so far has shown a modal naming the exact
 * external action. That rule exists because AtlasMind *proposing* to message a
 * colleague is a surprise, and an unrecoverable one — you cannot unsend.
 *
 * A chat composer is a different situation, and pretending otherwise would make
 * the feature useless. When you type a message into a box addressed to a
 * channel you chose and press send, a dialog asking "send this?" adds nothing:
 * you have already said so, twice, seconds ago. Dialogs that add nothing are
 * worse than absent ones — they train people to dismiss the dialogs that do
 * matter.
 *
 * So the gate moves from *every send* to *every send AtlasMind had a hand in
 * composing or addressing*:
 *
 *  - **You wrote it and you chose the recipient** → send. Composition is the
 *    confirmation.
 *  - **Atlas drafted it, or Atlas picked who it goes to** → modal, every time.
 *    That is the case the rule was written for.
 *  - **First message to a recipient this session** → modal, whoever wrote it.
 *    The expensive mistake is sending to the wrong place, not sending the wrong
 *    words, and that mistake happens on the first message.
 *
 * The surrounding deny-by-default gates are untouched: Buzz enabled, the bridge
 * connected, and the Director's per-project `outboundEnabled` all still apply
 * before any of this is reachable.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

/** Who composed the text, which is what decides whether a dialog adds anything. */
export type BuzzComposer =
  /** The user typed it themselves. */
  | 'human'
  /** AtlasMind generated or edited it. */
  | 'agent';

export interface BuzzSendRequest {
  composer: BuzzComposer;
  /** Channel id or recipient pubkey. */
  target: string;
  /** True when the user picked the target rather than AtlasMind inferring it. */
  targetChosenByUser: boolean;
  /** Targets already confirmed this session. */
  confirmedTargets: readonly string[];
}

export interface BuzzSendDecision {
  /** True when a `{ modal: true }` confirmation must be shown first. */
  requiresConfirmation: boolean;
  /** Why — shown in the dialog, so the reason is never a mystery. */
  reason: string;
  /** True when a successful send should mark the target as confirmed. */
  remembersTarget: boolean;
}

/**
 * Decide whether this send needs an explicit confirmation.
 *
 * Deny-by-default in shape: every branch that is not clearly "the human wrote
 * this and aimed it themselves, at somewhere they have already sent to"
 * requires the dialog.
 */
export function decideBuzzSend(request: BuzzSendRequest): BuzzSendDecision {
  const target = (request.target ?? '').trim();
  if (!target) {
    return {
      requiresConfirmation: true,
      reason: 'No recipient was resolved, so nothing can be sent without you naming one.',
      remembersTarget: false,
    };
  }

  if (request.composer !== 'human') {
    return {
      requiresConfirmation: true,
      reason: 'AtlasMind drafted this message. Anything AtlasMind wrote in your name is confirmed before it is sent.',
      remembersTarget: false,
    };
  }

  if (!request.targetChosenByUser) {
    return {
      requiresConfirmation: true,
      reason: 'AtlasMind picked the recipient rather than you. Sending to the wrong place is the expensive mistake.',
      remembersTarget: false,
    };
  }

  const alreadyConfirmed = request.confirmedTargets.some(entry => entry.trim() === target);
  if (!alreadyConfirmed) {
    return {
      requiresConfirmation: true,
      reason: 'This is the first message to this recipient in this session. Later messages you write yourself will send directly.',
      remembersTarget: true,
    };
  }

  return {
    requiresConfirmation: false,
    reason: 'You wrote this message and chose the recipient, and you have already sent here this session.',
    remembersTarget: true,
  };
}

/**
 * The exact text of the confirmation dialog.
 *
 * States the real action in full — where it is going, who wrote it, and what
 * will actually be sent — because a dialog that only says "are you sure?"
 * teaches people to click through it.
 */
export function describeBuzzSend(
  request: BuzzSendRequest,
  decision: BuzzSendDecision,
  body: string,
  targetLabel?: string,
): string {
  const preview = body.length > 240 ? `${body.slice(0, 240)}…` : body;
  return [
    `Send this message to ${targetLabel ?? request.target} on Buzz?`,
    '',
    preview,
    '',
    decision.reason,
    'This is a real, external action that AtlasMind cannot undo.',
  ].join('\n');
}

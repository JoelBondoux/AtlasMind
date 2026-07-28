import { describe, expect, it } from 'vitest';

import { decideBuzzSend, describeBuzzSend, type BuzzSendRequest } from '../../src/core/buzzSendPolicy.ts';

const CHANNEL = 'chan-1';

function request(overrides: Partial<BuzzSendRequest> = {}): BuzzSendRequest {
  return {
    composer: 'human',
    target: CHANNEL,
    targetChosenByUser: true,
    confirmedTargets: [CHANNEL],
    ...overrides,
  };
}

describe('decideBuzzSend', () => {
  it('does not re-ask when you wrote it, aimed it, and have sent there before', () => {
    // A dialog here adds nothing — you confirmed by typing and pressing send
    // seconds ago. Dialogs that add nothing train people to dismiss the ones
    // that matter.
    expect(decideBuzzSend(request()).requiresConfirmation).toBe(false);
  });

  it('always confirms a message AtlasMind wrote', () => {
    // This is the case the whole rule was written for: AtlasMind speaking in
    // your name, to a colleague, unrecoverably.
    const decision = decideBuzzSend(request({ composer: 'agent' }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toMatch(/AtlasMind drafted/i);
  });

  it('always confirms when AtlasMind chose the recipient', () => {
    const decision = decideBuzzSend(request({ targetChosenByUser: false }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toMatch(/picked the recipient/i);
  });

  it('confirms the first message to a recipient, whoever wrote it', () => {
    // Sending to the wrong place is the expensive mistake, and it happens on
    // the first message.
    const decision = decideBuzzSend(request({ confirmedTargets: [] }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.remembersTarget).toBe(true);
  });

  it('confirms when there is no resolved recipient at all', () => {
    for (const target of ['', '   ', undefined as unknown as string]) {
      expect(decideBuzzSend(request({ target })).requiresConfirmation).toBe(true);
    }
  });

  it('only remembers a target the human aimed at themselves', () => {
    // An agent-chosen target must never become a standing permission.
    expect(decideBuzzSend(request({ composer: 'agent', confirmedTargets: [] })).remembersTarget).toBe(false);
    expect(decideBuzzSend(request({ targetChosenByUser: false, confirmedTargets: [] })).remembersTarget).toBe(false);
  });

  it('scopes the grant to one recipient, not to Buzz as a whole', () => {
    // Having sent to one channel says nothing about another.
    const decision = decideBuzzSend(request({ target: 'chan-2', confirmedTargets: [CHANNEL] }));
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('is deny-by-default in shape — every non-ideal branch confirms', () => {
    const composers = ['human', 'agent'] as const;
    for (const composer of composers) {
      for (const chosen of [true, false]) {
        for (const confirmed of [[], [CHANNEL]]) {
          const decision = decideBuzzSend(request({ composer, targetChosenByUser: chosen, confirmedTargets: confirmed }));
          const ideal = composer === 'human' && chosen && confirmed.length > 0;
          expect(decision.requiresConfirmation, `${composer}/${chosen}/${confirmed.length}`).toBe(!ideal);
        }
      }
    }
  });

  it('always explains itself', () => {
    for (const decision of [
      decideBuzzSend(request()),
      decideBuzzSend(request({ composer: 'agent' })),
      decideBuzzSend(request({ confirmedTargets: [] })),
    ]) {
      expect(decision.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('describeBuzzSend', () => {
  it('names the recipient, shows the message, and says it cannot be undone', () => {
    // A dialog that only asks "are you sure?" teaches people to click through.
    const req = request({ confirmedTargets: [] });
    const text = describeBuzzSend(req, decideBuzzSend(req), 'ship it', '#general');
    expect(text).toContain('#general');
    expect(text).toContain('ship it');
    expect(text).toMatch(/cannot undo/i);
  });

  it('truncates a long body rather than filling the dialog', () => {
    const req = request({ confirmedTargets: [] });
    const text = describeBuzzSend(req, decideBuzzSend(req), 'x'.repeat(2000));
    expect(text.length).toBeLessThan(700);
    expect(text).toContain('…');
  });
});

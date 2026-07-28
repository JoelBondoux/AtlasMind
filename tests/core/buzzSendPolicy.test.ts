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

  it('is deny-by-default in shape — every non-ideal branch confirms (autonomy off)', () => {
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

// Agent-to-agent loops are a feature worth having: an AtlasMind specialist
// answering a Buzz agent directly is the point of putting them in one
// workspace. "Always confirm" would make that impossible. "Never confirm" is
// also wrong, for reasons specific enough to encode.
describe('autonomous agent-to-agent replies', () => {
  const AGENT_TARGET = 'a'.repeat(64);

  function autonomous(overrides: Partial<BuzzSendRequest['autonomy'] & object> = {}) {
    return request({
      composer: 'agent',
      target: AGENT_TARGET,
      targetChosenByUser: false,
      confirmedTargets: [],
      autonomy: { enabled: true, targetIsBoundAgent: true, sentInWindow: 0, maxPerWindow: 10, ...overrides },
    });
  }

  it('lets an armed agent reply to a bound agent without a dialog', () => {
    const decision = decideBuzzSend(autonomous());
    expect(decision.requiresConfirmation).toBe(false);
    expect(decision.autonomous).toBe(true);
  });

  it('still confirms when autonomy is not armed', () => {
    // The setting is the arming step; nothing infers it.
    expect(decideBuzzSend(autonomous({ enabled: false })).requiresConfirmation).toBe(true);
  });

  it('treats an unbound recipient as a person, even with autonomy armed', () => {
    // Binding an identity to an agent is the *declaration* that it is one.
    // AtlasMind never guesses, because a human may act on what it reads.
    const decision = decideBuzzSend(autonomous({ targetIsBoundAgent: false }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toMatch(/treated as a person/i);
  });

  it('stops at the rate cap rather than looping forever', () => {
    // A retry that re-fires on every inbound event is the realistic failure,
    // and there is no unsend.
    const decision = decideBuzzSend(autonomous({ sentInWindow: 10, maxPerWindow: 10 }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toMatch(/limit of 10/);
  });

  it('falls back to a dialog at the cap rather than dropping the message', () => {
    // A silently-dropped reply looks identical to a working loop.
    const decision = decideBuzzSend(autonomous({ sentInWindow: 99, maxPerWindow: 10 }));
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.autonomous).toBeUndefined();
  });

  it('never turns an autonomous send into a standing grant', () => {
    // Otherwise one armed loop would permanently silence the dialog for a
    // target the human never confirmed.
    expect(decideBuzzSend(autonomous()).remembersTarget).toBe(false);
  });

  it('does not let autonomy relax anything on the human path', () => {
    // Autonomy is about agent-composed messages. A human message to an
    // unconfirmed target still confirms.
    const decision = decideBuzzSend(request({
      composer: 'human',
      confirmedTargets: [],
      autonomy: { enabled: true, targetIsBoundAgent: true, sentInWindow: 0, maxPerWindow: 10 },
    }));
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('is exhaustively deny-by-default: only armed + bound + under cap sends', () => {
    for (const enabled of [true, false]) {
      for (const targetIsBoundAgent of [true, false]) {
        for (const sentInWindow of [0, 10]) {
          const decision = decideBuzzSend(autonomous({ enabled, targetIsBoundAgent, sentInWindow, maxPerWindow: 10 }));
          const shouldSend = enabled && targetIsBoundAgent && sentInWindow < 10;
          expect(decision.requiresConfirmation, `${enabled}/${targetIsBoundAgent}/${sentInWindow}`).toBe(!shouldSend);
        }
      }
    }
  });
});

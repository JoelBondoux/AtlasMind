import { describe, expect, it, vi } from 'vitest';
import {
  AMBIENT_EVENT_KINDS,
  AMBIENT_EVENT_RULES,
  AMBIENT_SEEN_STORAGE_NOTE,
  AmbientTriggerService,
  MAX_AMBIENT_SEEN,
  ambientEventRule,
  ambientFingerprint,
  boundAmbientSeen,
  buildAmbientHandoffPrompt,
  deriveAmbientEvents,
  describeAmbientPlan,
  planAmbientResponses,
  resolveAmbientCeiling,
  type AmbientEventKind,
  type AmbientGates,
  type AmbientObservation,
  type AmbientSubscription,
} from '../../src/core/ambientTriggers';

const AT = '2026-09-09T10:00:00.000Z';

const observe = (
  subjects: Partial<Record<AmbientEventKind, string[]>>,
): AmbientObservation => ({ subjects, observedAt: AT });

const OPEN_GATES: AmbientGates = {
  masterEnabled: true,
  masterCeiling: 'propose',
  monthlySpendCapUsd: 5,
  maxPerEvaluation: 5,
};

const subscribe = (
  kind: AmbientEventKind,
  extra: Partial<AmbientSubscription> = {},
): AmbientSubscription => ({ kind, enabled: true, ...extra });

describe('an event is a change, not a state', () => {
  it('fires once for a subject and not again while it persists', () => {
    // A red pipeline stays red. If "red" were the event it would fire on every
    // evaluation forever, and the first thing anybody would do is switch it off.
    const first = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), []);
    expect(first.events).toHaveLength(1);
    const second = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), first.seen);
    expect(second.events).toHaveLength(0);
  });

  it('fires again when the same condition returns after clearing', () => {
    // Accumulating instead of re-deriving would mean a flaky pipeline fired
    // exactly once, ever.
    const first = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), []);
    const cleared = deriveAmbientEvents(observe({ 'ci-failed': [] }), first.seen);
    expect(cleared.seen).not.toContain(ambientFingerprint('ci-failed', 'run-91'));
    const again = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), cleared.seen);
    expect(again.events).toHaveLength(1);
  });

  it('treats a new subject of the same kind as a new event', () => {
    const first = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), []);
    const next = deriveAmbientEvents(observe({ 'ci-failed': ['run-91', 'run-92'] }), first.seen);
    expect(next.events.map(event => event.subject)).toEqual(['run-92']);
  });

  it('is one event per subject after a fortnight away, not one per missed check', () => {
    // A missed window is not a backlog — the same rule researchSchedule states.
    const derivation = deriveAmbientEvents(observe({ 'blocker-defect': ['d1', 'd2'] }), []);
    expect(derivation.events).toHaveLength(2);
  });
});

describe('unknown is not quiet', () => {
  it('reports a source it could not read rather than treating it as empty', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': [] }), []);
    expect(derivation.events).toHaveLength(0);
    // Every kind except the one that was observed.
    expect(derivation.notObserved).toContain('security-advisory');
    expect(derivation.notObserved).not.toContain('ci-failed');
  });

  it('carries an unreadable kind\'s memory forward rather than clearing it', () => {
    // "Not looked at" must not clear a memory, or an unreadable source would
    // replay every standing condition the moment it came back.
    const first = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), []);
    const blind = deriveAmbientEvents(observe({}), first.seen);
    expect(blind.seen).toContain(ambientFingerprint('ci-failed', 'run-91'));
    const back = deriveAmbientEvents(observe({ 'ci-failed': ['run-91'] }), blind.seen);
    expect(back.events).toHaveLength(0);
  });

  it('carries the unobserved kinds all the way to the plan', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(derivation, [subscribe('ci-failed')], OPEN_GATES);
    expect(plan.notObserved.length).toBe(AMBIENT_EVENT_KINDS.length - 1);
  });
});

describe('deny by default, twice', () => {
  it('raises nothing while the master gate is off, and says so', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('ci-failed')],
      { ...OPEN_GATES, masterEnabled: false },
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.suppressed[0]!.reason).toBe('master-gate-off');
  });

  it('raises nothing for an event nothing subscribes to', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(derivation, [], OPEN_GATES);
    expect(plan.actions).toHaveLength(0);
    expect(plan.suppressed[0]!.reason).toBe('not-subscribed');
    expect(plan.suppressed[0]!.detail).toContain('two decisions');
  });

  it('raises nothing for a subscription that exists but is off', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('ci-failed', { enabled: false })],
      OPEN_GATES,
    );
    expect(plan.actions).toHaveLength(0);
  });

  it('reports suppressions rather than filtering them away', () => {
    // A feature that silently does nothing is indistinguishable from one that
    // is broken, and the commonest reason for silence is a gate somebody meant
    // to open.
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(derivation, [], { ...OPEN_GATES, masterEnabled: false });
    expect(plan.suppressed).toHaveLength(1);
    expect(plan.summary).toBeUndefined();
  });
});

describe('ambient never exceeds propose', () => {
  it('caps at propose even when everything upstream permits more', () => {
    const decision = resolveAmbientCeiling('ci-failed', OPEN_GATES, subscribe('ci-failed'));
    expect(decision.ceiling).toBe('propose');
  });

  it('honours a kind capped at observe by declaration', () => {
    // A security advisory and a blocked release are both situations where the
    // useful unattended act is to tell somebody.
    expect(resolveAmbientCeiling('security-advisory', OPEN_GATES, subscribe('security-advisory')).ceiling)
      .toBe('observe');
    expect(resolveAmbientCeiling('release-blocked', OPEN_GATES, subscribe('release-blocked')).ceiling)
      .toBe('observe');
  });

  it('honours a lower operator ceiling, and states the reduction', () => {
    const decision = resolveAmbientCeiling(
      'ci-failed',
      { ...OPEN_GATES, masterCeiling: 'observe' },
      subscribe('ci-failed'),
    );
    expect(decision.ceiling).toBe('observe');
    expect(decision.reductions.join(' ')).toContain('workflow ceiling');
  });

  it('honours a subscription asking for less', () => {
    const decision = resolveAmbientCeiling(
      'ci-failed',
      OPEN_GATES,
      subscribe('ci-failed', { requested: 'observe' }),
    );
    expect(decision.ceiling).toBe('observe');
    expect(decision.reductions.join(' ')).toContain('this subscription asked for observe');
  });

  it('never lets a subscription ask its way above the declared cap', () => {
    const decision = resolveAmbientCeiling(
      'security-advisory',
      OPEN_GATES,
      subscribe('security-advisory', { requested: 'propose' }),
    );
    expect(decision.ceiling).toBe('observe');
  });
});

describe('spend defaults to nothing', () => {
  it('suppresses a propose-level action when no unattended spend is allowed', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('ci-failed')],
      { ...OPEN_GATES, monthlySpendCapUsd: 0 },
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.suppressed[0]!.reason).toBe('spend-cap-reached');
    expect(plan.suppressed[0]!.detail).toContain('Set a monthly cap');
  });

  it('still reports an observe-level event when the cap is exhausted', () => {
    // Telling somebody what happened costs nothing, and refusing to because a
    // budget ran out would be the worst possible reading of a cost control.
    const derivation = deriveAmbientEvents(observe({ 'security-advisory': ['GHSA-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('security-advisory')],
      { ...OPEN_GATES, monthlySpendCapUsd: 0 },
    );
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.ceiling).toBe('observe');
  });

  it('suppresses once the month\'s spend has reached the cap', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('ci-failed')],
      { ...OPEN_GATES, monthlySpendCapUsd: 5, spentThisMonthUsd: 5 },
    );
    expect(plan.suppressed[0]!.reason).toBe('spend-cap-reached');
  });
});

describe('capped, with the remainder stated', () => {
  it('drops past the cap and says how many', () => {
    const derivation = deriveAmbientEvents(observe({ 'blocker-defect': ['a', 'b', 'c'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('blocker-defect')],
      { ...OPEN_GATES, maxPerEvaluation: 2 },
    );
    expect(plan.actions).toHaveLength(2);
    expect(plan.droppedByCap).toBe(1);
    expect(plan.summary).toContain('past this check');
  });
});

describe('the declared rules', () => {
  it('covers every kind, with a subject description and a reason', () => {
    expect(AMBIENT_EVENT_RULES).toHaveLength(AMBIENT_EVENT_KINDS.length);
    for (const kind of AMBIENT_EVENT_KINDS) {
      const rule = ambientEventRule(kind);
      expect(rule, kind).toBeDefined();
      expect(rule!.subjectIs.length, kind).toBeGreaterThan(10);
      expect(rule!.describes.length, kind).toBeGreaterThan(20);
    }
  });

  it('never declares a cap above propose', () => {
    for (const rule of AMBIENT_EVENT_RULES) {
      expect(['observe', 'propose']).toContain(rule.maxCeiling);
    }
  });
});

describe('the notification names what happened', () => {
  it('says nothing at all when there is nothing to raise', () => {
    expect(describeAmbientPlan({
      actions: [], suppressed: [], notObserved: [], droppedByCap: 0,
    })).toBeUndefined();
  });

  it('names the event rather than saying an event occurred', () => {
    const derivation = deriveAmbientEvents(observe({ 'review-requested': ['412'] }), []);
    const plan = planAmbientResponses(derivation, [subscribe('review-requested')], OPEN_GATES);
    expect(plan.summary).toContain('Review requested');
    expect(plan.summary).toContain('412');
  });
});

describe('the hand-off prompt', () => {
  it('says nobody is watching and that the trigger is not a brief', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(derivation, [subscribe('ci-failed')], OPEN_GATES);
    const prompt = buildAmbientHandoffPrompt(plan.actions[0]!);
    expect(prompt).toContain('nobody is watching');
    expect(prompt).toContain('The trigger is not a brief');
    expect(prompt).toContain('Apply nothing');
  });

  it('tells an observe-level hand-off not to propose either', () => {
    const derivation = deriveAmbientEvents(observe({ 'security-advisory': ['GHSA-1'] }), []);
    const plan = planAmbientResponses(derivation, [subscribe('security-advisory')], OPEN_GATES);
    const prompt = buildAmbientHandoffPrompt(plan.actions[0]!);
    expect(prompt).toContain('Report what you find and stop');
  });

  it('publishes every reduction that produced the ceiling', () => {
    const derivation = deriveAmbientEvents(observe({ 'ci-failed': ['run-1'] }), []);
    const plan = planAmbientResponses(
      derivation,
      [subscribe('ci-failed', { requested: 'observe' })],
      OPEN_GATES,
    );
    expect(buildAmbientHandoffPrompt(plan.actions[0]!)).toContain('this subscription asked for observe');
  });
});

describe('the seen set', () => {
  it('is bounded', () => {
    const many = Array.from({ length: MAX_AMBIENT_SEEN + 10 }, (_, index) => `ci-failed::run-${index}`);
    expect(boundAmbientSeen(many)).toHaveLength(MAX_AMBIENT_SEEN);
  });

  it('says where it must live, because a shared one silences an event for everybody', () => {
    expect(AMBIENT_SEEN_STORAGE_NOTE).toContain('Never in project_memory');
  });
});

describe('the service', () => {
  it('stores what it saw before presenting, so a crash cannot replay it', async () => {
    const order: string[] = [];
    let seen: string[] = [];
    const service = new AmbientTriggerService({
      observe: async () => observe({ 'ci-failed': ['run-1'] }),
      getGates: () => OPEN_GATES,
      getSubscriptions: () => [subscribe('ci-failed')],
      getSeen: () => seen,
      setSeen: next => { order.push('store'); seen = next; },
      present: () => { order.push('present'); },
    });
    await service.runOnce();
    expect(order).toEqual(['store', 'present']);
    expect(seen).toContain('ci-failed::run-1');
  });

  it('tracks what it saw even while the master gate is off', async () => {
    // Otherwise switching the gate on would raise every standing condition at
    // once, which is exactly the experience that gets it switched off again.
    let seen: string[] = [];
    const service = new AmbientTriggerService({
      observe: async () => observe({ 'ci-failed': ['run-1'] }),
      getGates: () => ({ ...OPEN_GATES, masterEnabled: false }),
      getSubscriptions: () => [subscribe('ci-failed')],
      getSeen: () => seen,
      setSeen: next => { seen = next; },
      present: () => {},
    });
    const plan = await service.runOnce();
    expect(plan.actions).toHaveLength(0);
    expect(seen).toContain('ci-failed::run-1');
  });

  it('never executes anything — it hands over a plan', async () => {
    const present = vi.fn();
    const service = new AmbientTriggerService({
      observe: async () => observe({ 'ci-failed': ['run-1'] }),
      getGates: () => OPEN_GATES,
      getSubscriptions: () => [subscribe('ci-failed')],
      getSeen: () => [],
      setSeen: () => {},
      present,
    });
    const plan = await service.runOnce();
    expect(present).toHaveBeenCalledWith(plan);
    expect(plan.actions[0]!.ceiling).toBe('propose');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECONNECT_MAX_MS,
  buildResumePlan,
  evaluateLiveness,
  nextReconnectDelay,
  planReconnect,
} from '../../src/core/buzzConnectionPolicy.ts';

describe('evaluateLiveness', () => {
  const base = { idleBeforePingMs: 30_000, deadAfterPingMs: 15_000 };

  it('is alive while traffic is recent', () => {
    expect(evaluateLiveness({ ...base, now: 10_000, lastFrameAt: 0 })).toBe('alive');
  });

  it('asks for a keep-alive once idle passes the threshold', () => {
    expect(evaluateLiveness({ ...base, now: 30_000, lastFrameAt: 0 })).toBe('ping');
    expect(evaluateLiveness({ ...base, now: 29_999, lastFrameAt: 0 })).toBe('alive');
  });

  it('declares death only after an unanswered ping', () => {
    // Ping outstanding but still within the grace window.
    expect(evaluateLiveness({ ...base, now: 40_000, lastFrameAt: 0, pingSentAt: 30_000 })).toBe('alive');
    // Grace window elapsed with no reply.
    expect(evaluateLiveness({ ...base, now: 45_000, lastFrameAt: 0, pingSentAt: 30_000 })).toBe('dead');
  });

  it('never declares death from idleness alone — a quiet channel is not a dead socket', () => {
    expect(evaluateLiveness({ ...base, now: 10_000_000, lastFrameAt: 0 })).toBe('ping');
  });

  it('treats a frame arriving after the ping as the answer', () => {
    const verdict = evaluateLiveness({ ...base, now: 50_000, lastFrameAt: 40_000, pingSentAt: 30_000 });
    expect(verdict).toBe('alive');
  });

  it('applies sane defaults when thresholds are omitted', () => {
    expect(evaluateLiveness({ now: 0, lastFrameAt: 0 })).toBe('alive');
  });
});

describe('nextReconnectDelay', () => {
  const noJitter = () => 0;

  it('backs off exponentially from the base delay', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    expect(nextReconnectDelay(0, opts, noJitter)).toBe(1_000);
    expect(nextReconnectDelay(1, opts, noJitter)).toBe(2_000);
    expect(nextReconnectDelay(2, opts, noJitter)).toBe(4_000);
    expect(nextReconnectDelay(5, opts, noJitter)).toBe(32_000);
  });

  it('caps the delay', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    expect(nextReconnectDelay(20, opts, noJitter)).toBe(60_000);
    expect(nextReconnectDelay(1_000, opts, noJitter)).toBe(60_000);
  });

  it('never exceeds the cap even at full jitter, because jitter is subtractive', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0.2 };
    for (const roll of [0, 0.25, 0.5, 0.99, 1]) {
      const delay = nextReconnectDelay(20, opts, () => roll);
      expect(delay).toBeLessThanOrEqual(60_000);
      expect(delay).toBeGreaterThanOrEqual(48_000); // cap minus full 20% jitter
    }
  });

  it('never returns less than the base delay', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 1 };
    expect(nextReconnectDelay(0, opts, () => 1)).toBe(1_000);
  });

  it('survives a huge attempt count without overflowing', () => {
    const delay = nextReconnectDelay(Number.MAX_SAFE_INTEGER, { baseDelayMs: 1_000 }, noJitter);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBe(DEFAULT_RECONNECT_MAX_MS);
  });

  it('tolerates negative, fractional, and non-finite attempts', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    expect(nextReconnectDelay(-5, opts, noJitter)).toBe(1_000);
    expect(nextReconnectDelay(Number.NaN, opts, noJitter)).toBe(1_000);
    expect(nextReconnectDelay(2.7, opts, noJitter)).toBe(4_000);
  });

  it('tolerates a misbehaving random source', () => {
    const opts = { baseDelayMs: 1_000, maxDelayMs: 60_000 };
    expect(nextReconnectDelay(3, opts, () => Number.NaN)).toBe(8_000);
    expect(nextReconnectDelay(3, opts, () => 99)).toBeGreaterThanOrEqual(1_000);
  });
});

describe('planReconnect', () => {
  it('reconnects with backoff and always re-runs auth', () => {
    const decision = planReconnect({ attempt: 2, options: { baseDelayMs: 1_000 }, random: () => 0 });
    expect(decision).toEqual({ action: 'reconnect', delayMs: 4_000, reauthenticate: true });
  });

  it('retries a recoverable auth-required refusal', () => {
    const decision = planReconnect({ attempt: 0, refusal: 'auth-required', random: () => 0 });
    expect(decision.action).toBe('reconnect');
    expect(decision.action === 'reconnect' && decision.reauthenticate).toBe(true);
  });

  it('stops on a terminal restricted refusal instead of hammering the relay', () => {
    const decision = planReconnect({ attempt: 0, refusal: 'restricted' });
    expect(decision.action).toBe('stop');
    expect(decision.action === 'stop' && decision.reason).toMatch(/restricted/i);
  });
});

describe('buildResumePlan', () => {
  it('re-subscribes tracked filters and re-announces presence', () => {
    const plan = buildResumePlan(['sub1', 'sub2'], 1_700_000_000);
    expect(plan.resubscribe).toEqual(['sub1', 'sub2']);
    expect(plan.reannouncePresence).toBe(true);
  });

  it('rewinds the cursor by an overlap so clock drift cannot silently drop a message', () => {
    const plan = buildResumePlan(['sub1'], 1_700_000_000, 60);
    expect(plan.sinceSeconds).toBe(1_699_999_940);
  });

  it('omits the cursor entirely on a first connection', () => {
    expect(buildResumePlan(['sub1']).sinceSeconds).toBeUndefined();
    expect(buildResumePlan(['sub1'], Number.NaN).sinceSeconds).toBeUndefined();
  });

  it('de-duplicates and drops blank subscription ids', () => {
    const plan = buildResumePlan(['sub1', 'sub1', '', '   ', 'sub2']);
    expect(plan.resubscribe).toEqual(['sub1', 'sub2']);
  });

  it('never rewinds past the epoch', () => {
    expect(buildResumePlan(['sub1'], 10, 60).sinceSeconds).toBe(0);
  });
});

/**
 * Buzz connection presence — the second half of "stays in contact" (Tier 3).
 *
 * The roadmap is explicit that presence has **two halves and they are not the
 * same thing**. `PresenceManager` already ships the OS half: it keeps the
 * *machine* awake so a subscription isn't killed by system sleep. That is
 * necessary but not sufficient — a wake lock does nothing if the WebSocket
 * silently drops, which is the common failure. This module owns the other half:
 * deciding *when a connection is dead* and *when to try again*.
 *
 * It is pure and clock-free — every function takes the current time and any
 * randomness as arguments, so the whole policy is deterministically testable
 * without timers, sockets, or sleeping. The socket, the timers, and the
 * `hold('buzz')`/`release('buzz')` wake-lock calls belong to the client that
 * drives this.
 *
 * See `project_memory/roadmap/buzz-integration.md` (Tier 3).
 */

import type { RelayRefusal } from './buzzProtocol.js';

/** Idle time before the client should send a keep-alive ping. */
export const DEFAULT_IDLE_BEFORE_PING_MS = 30_000;

/** Time after a ping with no traffic before the connection is presumed dead. */
export const DEFAULT_DEAD_AFTER_PING_MS = 15_000;

/** First reconnect delay. */
export const DEFAULT_RECONNECT_BASE_MS = 1_000;

/** Ceiling on reconnect backoff, so a long outage retries at a steady slow rate. */
export const DEFAULT_RECONNECT_MAX_MS = 60_000;

/** Fraction of the delay applied as random jitter, to avoid thundering herds. */
export const DEFAULT_RECONNECT_JITTER = 0.2;

export interface ReconnectOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 0–1. Jitter is subtractive, so a delay never exceeds the cap. */
  jitterRatio?: number;
}

export interface LivenessInput {
  now: number;
  /** When the last frame of any kind arrived. */
  lastFrameAt: number;
  /** When the last keep-alive ping was sent, if one is outstanding. */
  pingSentAt?: number;
  idleBeforePingMs?: number;
  deadAfterPingMs?: number;
}

/**
 * `alive` — traffic is recent, do nothing.
 * `ping`  — idle too long, send a keep-alive.
 * `dead`  — a ping went unanswered past the timeout; tear down and reconnect.
 */
export type LivenessVerdict = 'alive' | 'ping' | 'dead';

/**
 * Decide whether a connection is healthy, needs a keep-alive, or is gone.
 *
 * Deliberately conservative about declaring death: a connection is only `dead`
 * after a ping has been *sent* and gone unanswered, never on idleness alone —
 * a quiet channel is not a broken socket.
 */
export function evaluateLiveness(input: LivenessInput): LivenessVerdict {
  const idleBeforePing = input.idleBeforePingMs ?? DEFAULT_IDLE_BEFORE_PING_MS;
  const deadAfterPing = input.deadAfterPingMs ?? DEFAULT_DEAD_AFTER_PING_MS;

  // A frame that arrived after the ping was sent answers it — back to healthy.
  const pingOutstanding = input.pingSentAt !== undefined && input.pingSentAt > input.lastFrameAt;

  if (pingOutstanding) {
    return input.now - (input.pingSentAt as number) >= deadAfterPing ? 'dead' : 'alive';
  }

  return input.now - input.lastFrameAt >= idleBeforePing ? 'ping' : 'alive';
}

/**
 * Delay before reconnect attempt `attempt` (0-based), as capped exponential
 * backoff with subtractive jitter.
 *
 * Jitter is subtracted rather than added so the result never exceeds
 * `maxDelayMs` — an additive jitter would quietly breach the cap it is supposed
 * to enforce. `random` is injected to keep this deterministic under test.
 */
export function nextReconnectDelay(
  attempt: number,
  options: ReconnectOptions = {},
  random: () => number = Math.random,
): number {
  const base = Math.max(1, options.baseDelayMs ?? DEFAULT_RECONNECT_BASE_MS);
  const max = Math.max(base, options.maxDelayMs ?? DEFAULT_RECONNECT_MAX_MS);
  const jitterRatio = Math.min(Math.max(options.jitterRatio ?? DEFAULT_RECONNECT_JITTER, 0), 1);

  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  // Cap the exponent before the shift so a long outage can't overflow to Infinity.
  const exponent = Math.min(safeAttempt, 30);
  const uncapped = base * Math.pow(2, exponent);
  const capped = Math.min(uncapped, max);

  const roll = random();
  const jitterFraction = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 1) : 0;
  const jitter = capped * jitterRatio * jitterFraction;

  return Math.max(base, Math.round(capped - jitter));
}

export type ReconnectDecision =
  | { action: 'reconnect'; delayMs: number; reauthenticate: boolean }
  | { action: 'stop'; reason: string };

export interface ReconnectInput {
  attempt: number;
  /** A NIP-42 refusal, when the disconnect came with one. */
  refusal?: RelayRefusal;
  options?: ReconnectOptions;
  random?: () => number;
}

/**
 * Decide whether — and how — to reconnect after a drop.
 *
 * The one case that must **not** retry is `restricted:`: the client already
 * authenticated and the relay still refuses that key. Retrying cannot change
 * the outcome, so it stops with a reason instead of hammering the relay with a
 * request that is guaranteed to fail. `auth-required:` is the opposite — it is
 * recoverable, and the reconnect re-runs NIP-42 auth.
 */
export function planReconnect(input: ReconnectInput): ReconnectDecision {
  if (input.refusal === 'restricted') {
    return {
      action: 'stop',
      reason: 'The Buzz relay rejected this agent key (restricted). Reconnecting cannot change that — check the key\'s access on the relay.',
    };
  }

  return {
    action: 'reconnect',
    delayMs: nextReconnectDelay(input.attempt, input.options, input.random),
    // Re-run auth after any reconnect: the challenge is per-connection, and an
    // `auth-required` refusal means the previous one was never completed.
    reauthenticate: true,
  };
}

/**
 * What a client must redo after a reconnect. A fresh socket keeps none of the
 * previous connection's state, so re-announcing presence and re-subscribing the
 * tracked filters is required — reconnecting the socket alone leaves an agent
 * silently absent while looking connected.
 */
export interface ResumePlan {
  /** Subscription ids to re-issue `REQ` frames for. */
  resubscribe: string[];
  /** Whether to re-announce presence after resubscribing. */
  reannouncePresence: boolean;
  /** Only replay from this point, so a reconnect doesn't refetch all history. */
  sinceSeconds?: number;
}

/**
 * Build the post-reconnect resume plan.
 *
 * `sinceSeconds` is rewound by `overlapSeconds` (default 60) because relay and
 * client clocks drift; replaying a small overlap risks a duplicate the caller
 * de-duplicates by event id, whereas trusting an exact cutoff risks a silently
 * dropped message. Prefer the recoverable failure.
 */
export function buildResumePlan(
  subscriptionIds: string[],
  lastEventAtSeconds?: number,
  overlapSeconds = 60,
): ResumePlan {
  const resubscribe = [...new Set(subscriptionIds.filter(id => typeof id === 'string' && id.trim()))];
  const since = lastEventAtSeconds !== undefined && Number.isFinite(lastEventAtSeconds)
    ? Math.max(0, Math.floor(lastEventAtSeconds - Math.max(0, overlapSeconds)))
    : undefined;

  return {
    resubscribe,
    reannouncePresence: true,
    ...(since !== undefined ? { sinceSeconds: since } : {}),
  };
}

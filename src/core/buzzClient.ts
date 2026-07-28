/**
 * BuzzClient — the Tier-3 inbound relay subscription.
 *
 * This is the piece that *drives* the three Tier-3 foundation modules:
 * `buzzProtocol` (framing/parsing), `buzzConnectionPolicy` (liveness/backoff),
 * and `buzzInboundDerivation` (derive, don't mirror). It owns the state machine
 * — connect → authenticate → subscribe → receive → drop → back off → resume —
 * and nothing else: it parses no frames, invents no delays, and stores no
 * conversation itself.
 *
 * **Transport-agnostic on purpose.** The socket arrives through an injected
 * `BuzzSocketFactory` (the same idiom `PresenceManager` uses for `spawn`), so
 * this module imports neither `ws` nor `vscode` and the whole machine is
 * unit-testable against a fake socket — and, in `tests/core/buzzClient.integration.test.ts`,
 * against a real in-process WebSocket server. `createBuzzWebSocketFactory`
 * (`buzzSocket.ts`) supplies the real transport.
 *
 * **Signing arrives through a seam.** NIP-42 requires a Schnorr signature over a
 * kind-22242 event; `BuzzEventSigner` is the seam and `buzzSigner.ts` implements
 * it. The signer stays injected rather than imported so this module keeps no
 * crypto dependency and remains testable without one. With **no** signer, a relay
 * that demands auth produces a typed, explained stop — never a silent failure or
 * a reconnect loop. A relay normally triggers authentication twice on connect
 * (its `AUTH` challenge, plus the `auth-required` answer to the optimistic
 * subscription); only one signature is produced.
 *
 * Safety posture:
 *  - **Deny-by-default:** constructing a client connects nothing; `start()` is
 *    explicit, and the caller gates it on the inbound toggle.
 *  - **Read-only:** it sends `REQ`, `CLOSE`, `AUTH`, and keep-alive pings. It
 *    never publishes an `EVENT`, so an inbound subscription cannot write to Buzz.
 *  - **Untrusted input:** every frame goes through `parseRelayFrame`, which never
 *    throws; unparseable frames are counted and ignored, not acted on.
 *  - **Bounded:** reconnects use the capped policy, and a `restricted:` refusal
 *    stops permanently rather than hammering the relay.
 *
 * See `project_memory/roadmap/buzz-integration.md` (Tier 3).
 */

import {
  buildAuthEventTemplate,
  buildAuthFrame,
  buildCloseFrame,
  buildSubscriptionFrame,
  classifyRelayRefusal,
  parseRelayFrame,
  type NostrEvent,
  type NostrFilter,
  type UnsignedNostrEvent,
} from './buzzProtocol.js';
import {
  buildResumePlan,
  evaluateLiveness,
  planReconnect,
  type ReconnectOptions,
} from './buzzConnectionPolicy.js';
import {
  deriveWorkItems,
  type DerivedWorkItem,
} from './buzzInboundDerivation.js';
import type { BuzzAgentBinding } from './buzzAgentBindings.js';

/** Minimal socket surface, modelled on the subset of `ws` this client needs. */
export interface BuzzSocket {
  send(data: string): void;
  close(): void;
  /** WebSocket-level keep-alive. Optional: a transport without it just idles. */
  ping?(): void;
  /** Drop the connection without a closing handshake. */
  terminate?(): void;
  on(event: 'open', handler: () => void): void;
  on(event: 'message', handler: (data: unknown) => void): void;
  on(event: 'close', handler: () => void): void;
  on(event: 'error', handler: (error: unknown) => void): void;
  on(event: 'pong', handler: () => void): void;
}

export type BuzzSocketFactory = (relayUrl: string) => BuzzSocket;

/**
 * Signs a NIP-42 auth event. Implemented by `buzzSigner.ts`; kept as an injected
 * interface so this module carries no crypto dependency of its own.
 */
export interface BuzzEventSigner {
  /** The agent's 32-byte hex public key. */
  readonly pubkey: string;
  sign(event: UnsignedNostrEvent): Promise<NostrEvent>;
}

/** Injected time + timers, so the state machine is deterministic under test. */
export interface BuzzScheduler {
  now(): number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type BuzzClientStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'subscribed'
  | 'live'
  | 'reconnecting'
  | 'stopped';

export interface BuzzClientOptions {
  relayUrl: string;
  /** Filters to subscribe with. `kinds` is required — the protocol enforces it. */
  filters: NostrFilter[];
  socketFactory: BuzzSocketFactory;
  scheduler?: BuzzScheduler;
  /** Absent signer ⇒ a relay demanding NIP-42 auth stops the client with a reason. */
  signer?: BuzzEventSigner;
  subscriptionId?: string;
  derivation?: { withContactId?: string; dueInDays?: number; agentBindings?: BuzzAgentBinding[] };
  reconnect?: ReconnectOptions;
  random?: () => number;
  idleBeforePingMs?: number;
  deadAfterPingMs?: number;
  /** How often the liveness check runs. */
  livenessIntervalMs?: number;
  /** Derived work items. The caller decides whether to persist them. */
  onWorkItems?: (items: DerivedWorkItem[]) => void;
  onStatusChange?: (status: BuzzClientStatus, detail?: string) => void;
  /** Terminal or notable failures, already explained in plain language. */
  onError?: (reason: string) => void;
}

const DEFAULT_LIVENESS_INTERVAL_MS = 5_000;

const defaultScheduler: BuzzScheduler = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class BuzzClient {
  private readonly options: BuzzClientOptions;
  private readonly scheduler: BuzzScheduler;
  private readonly subscriptionId: string;

  private socket: BuzzSocket | undefined;
  private status: BuzzClientStatus = 'idle';
  private attempt = 0;
  private stopped = true;

  private lastFrameAt = 0;
  private pingSentAt: number | undefined;
  private lastEventCreatedAt: number | undefined;
  private challenge: string | undefined;
  private pendingAuthEventId: string | undefined;
  /** True from the moment signing starts until the frame is sent or it fails. */
  private authInFlight = false;

  private reconnectHandle: unknown;
  private livenessHandle: unknown;

  /** Frames that failed to parse. Surfaced for diagnostics; never acted on. */
  private malformedFrameCount = 0;

  constructor(options: BuzzClientOptions) {
    this.options = options;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.subscriptionId = options.subscriptionId ?? 'atlasmind-inbound';
  }

  getStatus(): BuzzClientStatus {
    return this.status;
  }

  getMalformedFrameCount(): number {
    return this.malformedFrameCount;
  }

  /** Open the connection. Nothing happens until this is called explicitly. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.openSocket();
  }

  /** Close the connection and cancel all timers. Safe to call repeatedly. */
  stop(reason?: string): void {
    if (this.stopped && this.status === 'stopped') {
      return;
    }
    this.stopped = true;
    this.clearTimers();
    this.closeSocket();
    this.setStatus('stopped', reason);
  }

  // ── Connection lifecycle ──────────────────────────────────────

  private openSocket(): void {
    this.setStatus('connecting');
    this.pingSentAt = undefined;
    this.lastFrameAt = this.scheduler.now();
    this.challenge = undefined;
    this.pendingAuthEventId = undefined;
    this.authInFlight = false;

    let socket: BuzzSocket;
    try {
      socket = this.options.socketFactory(this.options.relayUrl);
    } catch (error) {
      this.handleDisconnect(error instanceof Error ? error.message : 'The Buzz socket could not be created.');
      return;
    }
    this.socket = socket;

    socket.on('open', () => this.handleOpen());
    socket.on('message', data => this.handleMessage(data));
    socket.on('close', () => this.handleDisconnect('The Buzz relay connection closed.'));
    socket.on('error', error => {
      // An error is followed by a close on every real transport; record the
      // reason but let the close handler own the reconnect so it runs once.
      this.options.onError?.(error instanceof Error ? error.message : 'Buzz socket error.');
    });
    socket.on('pong', () => {
      this.lastFrameAt = this.scheduler.now();
      this.pingSentAt = undefined;
    });
  }

  private handleOpen(): void {
    if (this.stopped) {
      return;
    }
    this.attempt = 0;
    this.lastFrameAt = this.scheduler.now();
    // Subscribe optimistically. A relay requiring NIP-42 answers with
    // `CLOSED … auth-required:`, which is handled as a recoverable case.
    this.sendSubscription();
    this.startLivenessTimer();
  }

  private sendSubscription(): void {
    const resume = buildResumePlan([this.subscriptionId], this.lastEventCreatedAt);
    const filters: NostrFilter[] = this.options.filters.map(filter => (
      resume.sinceSeconds !== undefined ? { ...filter, since: resume.sinceSeconds } : { ...filter }
    ));

    const built = buildSubscriptionFrame(this.subscriptionId, filters);
    if (!built.ok) {
      // A filter AtlasMind itself built is invalid — retrying cannot fix that.
      this.stop(built.reason);
      this.options.onError?.(built.reason);
      return;
    }
    this.send(built.frame);
    this.setStatus('subscribed');
  }

  private send(frame: string): void {
    try {
      this.socket?.send(frame);
    } catch (error) {
      this.handleDisconnect(error instanceof Error ? error.message : 'Sending to the Buzz relay failed.');
    }
  }

  // ── Frame handling ────────────────────────────────────────────

  private handleMessage(data: unknown): void {
    // A stopped client must be inert. Frames can still arrive after stop() —
    // in flight, or buffered by the transport — and acting on them would let a
    // terminal refusal restart the auth path it just refused.
    if (this.stopped) {
      return;
    }
    this.lastFrameAt = this.scheduler.now();
    this.pingSentAt = undefined;

    const raw = typeof data === 'string' ? data : String(data);
    const frame = parseRelayFrame(raw);

    switch (frame.type) {
      case 'EVENT': {
        this.ingestEvent(frame.event);
        return;
      }
      case 'EOSE': {
        // Stored events delivered; the subscription is now live.
        this.setStatus('live');
        return;
      }
      case 'AUTH': {
        this.challenge = frame.challenge;
        void this.authenticate();
        return;
      }
      case 'OK': {
        if (this.pendingAuthEventId && frame.eventId === this.pendingAuthEventId) {
          this.pendingAuthEventId = undefined;
          if (frame.accepted) {
            // Authenticated — re-issue the subscription the relay refused.
            this.sendSubscription();
          } else {
            this.stopForRefusal(frame.message || 'The Buzz relay rejected the authentication event.');
          }
        }
        return;
      }
      case 'CLOSED': {
        this.handleClosedSubscription(frame.message);
        return;
      }
      case 'NOTICE': {
        if (frame.message) {
          this.options.onError?.(`Buzz relay notice: ${frame.message}`);
        }
        return;
      }
      default: {
        // Untrusted input: count it, never act on it.
        this.malformedFrameCount += 1;
      }
    }
  }

  private ingestEvent(event: NostrEvent): void {
    if (this.lastEventCreatedAt === undefined || event.created_at > this.lastEventCreatedAt) {
      this.lastEventCreatedAt = event.created_at;
    }

    const items = deriveWorkItems([event], {
      now: new Date(this.scheduler.now()),
      ...(this.options.derivation?.withContactId ? { withContactId: this.options.derivation.withContactId } : {}),
      ...(this.options.derivation?.dueInDays !== undefined ? { dueInDays: this.options.derivation.dueInDays } : {}),
      ...(this.options.derivation?.agentBindings?.length ? { agentBindings: this.options.derivation.agentBindings } : {}),
    });

    if (items.length > 0) {
      this.options.onWorkItems?.(items);
    }
  }

  /**
   * A `CLOSED` frame ends the subscription server-side. `auth-required:` is
   * recoverable (authenticate, then re-subscribe); `restricted:` is terminal.
   */
  private handleClosedSubscription(message: string): void {
    const refusal = classifyRelayRefusal(message);

    if (refusal === 'restricted') {
      this.stopForRefusal(
        'The Buzz relay rejected this agent key (restricted). Reconnecting cannot change that — check the key\'s access on the relay.',
      );
      return;
    }

    if (refusal === 'auth-required') {
      this.setStatus('authenticating');
      void this.authenticate();
      return;
    }

    // Closed for some other reason — treat as a disconnect and back off.
    this.handleDisconnect(message || 'The Buzz relay closed the subscription.');
  }

  private async authenticate(): Promise<void> {
    // An authenticating relay typically triggers this twice on connect: once
    // from its `AUTH` challenge, and again from the `CLOSED … auth-required`
    // answer to the optimistic subscription. One signature is enough — signing
    // twice wastes work and puts a redundant frame on the wire.
    //
    // The in-flight flag is checked and set *synchronously*, before any await:
    // signing is async, so a second call would otherwise sail past a guard that
    // is only set once the first signature completes.
    if (this.authInFlight || this.pendingAuthEventId) {
      return;
    }

    const signer = this.options.signer;
    if (!signer) {
      this.stopForRefusal(
        'The Buzz relay requires NIP-42 authentication, but AtlasMind has no Buzz event signer configured. '
        + 'Inbound sync needs Schnorr signing before it can connect to an authenticating relay.',
      );
      return;
    }
    if (!this.challenge) {
      // Nothing to sign yet; the relay will send a challenge.
      this.setStatus('authenticating');
      return;
    }

    const template = buildAuthEventTemplate(
      this.options.relayUrl,
      this.challenge,
      Math.floor(this.scheduler.now() / 1000),
    );
    if (!template.ok) {
      this.stopForRefusal(template.reason);
      return;
    }

    this.authInFlight = true;
    let signed: NostrEvent;
    try {
      signed = await signer.sign(template.event);
    } catch (error) {
      this.authInFlight = false;
      this.stopForRefusal(
        `Signing the Buzz authentication event failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return;
    }
    this.authInFlight = false;

    // The client may have been stopped while signing.
    if (this.stopped) {
      return;
    }

    const frame = buildAuthFrame(signed);
    if (!frame.ok) {
      this.stopForRefusal(frame.reason);
      return;
    }
    this.pendingAuthEventId = signed.id;
    this.setStatus('authenticating');
    this.send(frame.frame);
  }

  /** A refusal no retry can fix: stop and explain, rather than loop. */
  private stopForRefusal(reason: string): void {
    this.options.onError?.(reason);
    this.stop(reason);
  }

  // ── Liveness and reconnect ────────────────────────────────────

  private startLivenessTimer(): void {
    this.scheduler.clearTimeout(this.livenessHandle);
    if (this.stopped) {
      return;
    }
    const interval = this.options.livenessIntervalMs ?? DEFAULT_LIVENESS_INTERVAL_MS;
    this.livenessHandle = this.scheduler.setTimeout(() => this.checkLiveness(), interval);
  }

  private checkLiveness(): void {
    if (this.stopped || !this.socket) {
      return;
    }

    const verdict = evaluateLiveness({
      now: this.scheduler.now(),
      lastFrameAt: this.lastFrameAt,
      ...(this.pingSentAt !== undefined ? { pingSentAt: this.pingSentAt } : {}),
      ...(this.options.idleBeforePingMs !== undefined ? { idleBeforePingMs: this.options.idleBeforePingMs } : {}),
      ...(this.options.deadAfterPingMs !== undefined ? { deadAfterPingMs: this.options.deadAfterPingMs } : {}),
    });

    if (verdict === 'ping') {
      this.pingSentAt = this.scheduler.now();
      try {
        this.socket.ping?.();
      } catch {
        // A transport without ping just waits for the dead verdict.
      }
    } else if (verdict === 'dead') {
      this.handleDisconnect('The Buzz relay stopped responding to keep-alives.');
      return;
    }

    this.startLivenessTimer();
  }

  private handleDisconnect(reason: string): void {
    if (this.stopped) {
      return;
    }
    this.clearTimers();
    this.closeSocket();

    const decision = planReconnect({
      attempt: this.attempt,
      ...(this.options.reconnect ? { options: this.options.reconnect } : {}),
      ...(this.options.random ? { random: this.options.random } : {}),
    });

    if (decision.action === 'stop') {
      this.stopForRefusal(decision.reason);
      return;
    }

    this.attempt += 1;
    this.setStatus('reconnecting', reason);
    this.reconnectHandle = this.scheduler.setTimeout(() => {
      if (!this.stopped) {
        this.openSocket();
      }
    }, decision.delayMs);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) {
      return;
    }
    try {
      // Best-effort tidy close of the subscription before dropping the socket.
      const close = buildCloseFrame(this.subscriptionId);
      if (close.ok) {
        socket.send(close.frame);
      }
    } catch {
      // The socket is already gone; nothing to clean up.
    }
    try {
      socket.close();
    } catch {
      // Ignore — the connection is being discarded either way.
    }
  }

  private clearTimers(): void {
    this.scheduler.clearTimeout(this.reconnectHandle);
    this.scheduler.clearTimeout(this.livenessHandle);
    this.reconnectHandle = undefined;
    this.livenessHandle = undefined;
  }

  private setStatus(status: BuzzClientStatus, detail?: string): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.options.onStatusChange?.(status, detail);
  }
}

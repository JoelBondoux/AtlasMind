import { describe, expect, it } from 'vitest';
import {
  BuzzClient,
  type BuzzClientStatus,
  type BuzzEventSigner,
  type BuzzScheduler,
  type BuzzSocket,
} from '../../src/core/buzzClient.ts';
import { BUZZ_KIND, type NostrEvent, type UnsignedNostrEvent } from '../../src/core/buzzProtocol.ts';
import type { DerivedWorkItem } from '../../src/core/buzzInboundDerivation.ts';

/** A fake socket that records what was sent and lets a test drive the relay side. */
class FakeSocket implements BuzzSocket {
  sent: string[] = [];
  closed = false;
  terminated = false;
  pings = 0;
  private handlers = new Map<string, ((...args: never[]) => void)[]>();

  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; }
  ping(): void { this.pings += 1; }
  terminate(): void { this.terminated = true; }

  on(event: string, handler: (...args: never[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      (handler as unknown as (...a: unknown[]) => void)(...args);
    }
  }

  /** Frames sent by the client, parsed back into arrays. */
  frames(): unknown[][] {
    return this.sent.map(raw => JSON.parse(raw) as unknown[]);
  }

  frameLabels(): string[] {
    return this.frames().map(frame => String(frame[0]));
  }
}

/** A manual clock + timer queue, so nothing in these tests is time-dependent. */
class FakeScheduler implements BuzzScheduler {
  current = 1_000_000;
  private queue: { at: number; fn: () => void; handle: number }[] = [];
  private nextHandle = 1;

  now(): number { return this.current; }

  setTimeout(fn: () => void, ms: number): unknown {
    const handle = this.nextHandle++;
    this.queue.push({ at: this.current + ms, fn, handle });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter(entry => entry.handle !== handle);
  }

  /** Advance time, running every timer whose deadline has passed. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.queue
        .filter(entry => entry.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) { break; }
      this.queue = this.queue.filter(entry => entry.handle !== due.handle);
      this.current = due.at;
      due.fn();
    }
    this.current = target;
  }

  pending(): number { return this.queue.length; }
}

// These go through `validateNostrEvent`, so every hex field must really be hex —
// `p`/`s` are not hex digits and would (correctly) be rejected as malformed.
const EVENT_ID = 'e'.repeat(64);
const PUBKEY = 'b'.repeat(64);
const SIGNATURE = 'c'.repeat(128);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: EVENT_ID,
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'chan-1']],
    content: 'Please review the deploy plan',
    sig: SIGNATURE,
    ...overrides,
  };
}

interface Harness {
  client: BuzzClient;
  scheduler: FakeScheduler;
  sockets: FakeSocket[];
  socket: () => FakeSocket;
  items: DerivedWorkItem[];
  statuses: BuzzClientStatus[];
  errors: string[];
}

function harness(overrides: Partial<Parameters<typeof BuzzClient.prototype.constructor>[0]> = {}): Harness {
  const scheduler = new FakeScheduler();
  const sockets: FakeSocket[] = [];
  const items: DerivedWorkItem[] = [];
  const statuses: BuzzClientStatus[] = [];
  const errors: string[] = [];

  const client = new BuzzClient({
    relayUrl: 'ws://localhost:3000',
    filters: [{ kinds: [BUZZ_KIND.channelMessage] }],
    socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    scheduler,
    random: () => 0,
    reconnect: { baseDelayMs: 1_000, maxDelayMs: 60_000 },
    onWorkItems: batch => items.push(...batch),
    onStatusChange: status => statuses.push(status),
    onError: reason => errors.push(reason),
    ...overrides,
  });

  return { client, scheduler, sockets, socket: () => sockets[sockets.length - 1]!, items, statuses, errors };
}

describe('BuzzClient — connect and subscribe', () => {
  it('connects nothing until start() is called (deny-by-default)', () => {
    const h = harness();
    expect(h.sockets).toHaveLength(0);
    expect(h.client.getStatus()).toBe('idle');

    h.client.start();
    expect(h.sockets).toHaveLength(1);
  });

  it('sends a REQ carrying the configured filters once open', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');

    const frames = h.socket().frames();
    expect(frames[0]?.[0]).toBe('REQ');
    expect(frames[0]?.[1]).toBe('atlasmind-inbound');
    expect(frames[0]?.[2]).toMatchObject({ kinds: [BUZZ_KIND.channelMessage] });
    expect(h.client.getStatus()).toBe('subscribed');
  });

  it('goes live on EOSE', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['EOSE', 'atlasmind-inbound']));

    expect(h.client.getStatus()).toBe('live');
  });

  it('never publishes an EVENT — an inbound subscription cannot write to Buzz', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['EVENT', 'atlasmind-inbound', event()]));
    h.socket().emit('message', JSON.stringify(['EOSE', 'atlasmind-inbound']));

    expect(h.socket().frameLabels()).not.toContain('EVENT');
  });
});

describe('BuzzClient — receiving events', () => {
  it('derives a work item from an inbound event', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['EVENT', 'atlasmind-inbound', event()]));

    expect(h.items).toHaveLength(1);
    expect(h.items[0]?.followUp.title).toContain('Please review the deploy plan');
    expect(h.items[0]?.pointer.channelId).toBe('chan-1');
  });

  it('does not surface the raw message body anywhere in the derived item', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['EVENT', 'atlasmind-inbound', event({ content: 'confidential text' })]));

    expect(JSON.stringify(h.items)).not.toContain('"content"');
  });

  it('ignores malformed frames instead of acting on them, and counts them', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');

    for (const bad of ['{', 'null', '[]', '["EVENT","sub",{"id":"nope"}]', '["WAT"]']) {
      h.socket().emit('message', bad);
    }

    expect(h.items).toHaveLength(0);
    expect(h.client.getMalformedFrameCount()).toBe(5);
    expect(h.client.getStatus()).toBe('subscribed');
  });

  it('surfaces a relay NOTICE without treating it as data', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['NOTICE', 'slow down']));

    expect(h.errors.some(e => e.includes('slow down'))).toBe(true);
    expect(h.items).toHaveLength(0);
  });
});

describe('BuzzClient — NIP-42 authentication', () => {
  const signer: BuzzEventSigner = {
    pubkey: 'p'.repeat(64),
    sign: async (template: UnsignedNostrEvent) => ({
      ...template,
      id: 'a'.repeat(64),
      pubkey: 'p'.repeat(64),
      sig: 's'.repeat(128),
    }),
  };

  it('answers an AUTH challenge with a signed kind-22242 event', async () => {
    const h = harness({ signer });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['AUTH', 'challenge-1']));
    await Promise.resolve();
    await Promise.resolve();

    const auth = h.socket().frames().find(frame => frame[0] === 'AUTH');
    expect(auth).toBeDefined();
    const signed = auth?.[1] as NostrEvent;
    expect(signed.kind).toBe(22242);
    expect(signed.tags).toEqual([['relay', 'ws://localhost:3000'], ['challenge', 'challenge-1']]);
  });

  it('re-subscribes after the relay accepts the auth event', async () => {
    const h = harness({ signer });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['AUTH', 'challenge-1']));
    await Promise.resolve();
    await Promise.resolve();

    h.socket().emit('message', JSON.stringify(['OK', 'a'.repeat(64), true, '']));
    expect(h.socket().frameLabels().filter(l => l === 'REQ')).toHaveLength(2);
  });

  it('authenticates when a subscription is closed with auth-required', async () => {
    const h = harness({ signer });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['AUTH', 'challenge-1']));
    h.socket().emit('message', JSON.stringify(['CLOSED', 'atlasmind-inbound', 'auth-required: please authenticate']));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.socket().frameLabels()).toContain('AUTH');
  });

  it('stops with an explanation when the relay wants auth and no signer exists', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['CLOSED', 'atlasmind-inbound', 'auth-required: nope']));

    expect(h.client.getStatus()).toBe('stopped');
    expect(h.errors.join(' ')).toMatch(/no Buzz event signer/i);
    // It must not reconnect — that would loop forever against the same refusal.
    expect(h.scheduler.pending()).toBe(0);
  });

  it('stops permanently on a restricted refusal rather than hammering the relay', () => {
    const h = harness({ signer });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['CLOSED', 'atlasmind-inbound', 'restricted: key not allowed']));

    expect(h.client.getStatus()).toBe('stopped');
    expect(h.errors.join(' ')).toMatch(/restricted/i);
    expect(h.scheduler.pending()).toBe(0);
    expect(h.sockets).toHaveLength(1);
  });

  it('stops when the relay rejects the auth event', async () => {
    const h = harness({ signer });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['AUTH', 'challenge-1']));
    await Promise.resolve();
    await Promise.resolve();
    h.socket().emit('message', JSON.stringify(['OK', 'a'.repeat(64), false, 'bad signature']));

    expect(h.client.getStatus()).toBe('stopped');
  });

  it('stops when signing throws instead of retrying blindly', async () => {
    const failing: BuzzEventSigner = {
      pubkey: 'p'.repeat(64),
      sign: async () => { throw new Error('key unavailable'); },
    };
    const h = harness({ signer: failing });
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['AUTH', 'challenge-1']));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.client.getStatus()).toBe('stopped');
    expect(h.errors.join(' ')).toMatch(/key unavailable/);
  });
});

describe('BuzzClient — liveness and reconnect', () => {
  it('pings after the idle threshold and stays alive on a pong', () => {
    const h = harness({ idleBeforePingMs: 30_000, deadAfterPingMs: 15_000, livenessIntervalMs: 5_000 });
    h.client.start();
    h.socket().emit('open');

    h.scheduler.advance(30_000);
    expect(h.socket().pings).toBe(1);

    h.socket().emit('pong');
    h.scheduler.advance(10_000);
    expect(h.client.getStatus()).toBe('subscribed');
  });

  it('reconnects when a ping goes unanswered past the timeout', () => {
    const h = harness({ idleBeforePingMs: 30_000, deadAfterPingMs: 15_000, livenessIntervalMs: 5_000 });
    h.client.start();
    h.socket().emit('open');

    h.scheduler.advance(30_000);
    expect(h.socket().pings).toBe(1);

    // The ping goes unanswered for the full grace window: dead at t+45s, with
    // the reconnect scheduled 1s later — so stop short of it to observe the state.
    h.scheduler.advance(15_000);
    expect(h.client.getStatus()).toBe('reconnecting');

    h.scheduler.advance(1_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('never declares death from idleness alone while pongs keep arriving', () => {
    const h = harness({ idleBeforePingMs: 10_000, deadAfterPingMs: 10_000, livenessIntervalMs: 1_000 });
    h.client.start();
    h.socket().emit('open');

    for (let i = 0; i < 20; i += 1) {
      h.scheduler.advance(10_000);
      h.socket().emit('pong');
    }
    expect(h.sockets).toHaveLength(1);
    expect(h.client.getStatus()).toBe('subscribed');
  });

  it('backs off exponentially across repeated failures', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('close');
    expect(h.client.getStatus()).toBe('reconnecting');

    h.scheduler.advance(1_000);
    expect(h.sockets).toHaveLength(2);

    h.socket().emit('close');
    h.scheduler.advance(1_999);
    expect(h.sockets).toHaveLength(2); // 2s delay not yet elapsed
    h.scheduler.advance(1);
    expect(h.sockets).toHaveLength(3);
  });

  it('re-subscribes after reconnecting and rewinds the cursor by an overlap', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.socket().emit('message', JSON.stringify(['EVENT', 'atlasmind-inbound', event({ created_at: 1_700_000_500 })]));
    h.socket().emit('close');
    h.scheduler.advance(1_000);
    h.socket().emit('open');

    const req = h.socket().frames().find(frame => frame[0] === 'REQ');
    const filter = req?.[2] as { since?: number };
    // Rewound by the 60s overlap: a duplicate is safer than a dropped message.
    expect(filter.since).toBe(1_700_000_440);
  });

  it('resets the backoff after a successful reconnect', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('close');
    h.scheduler.advance(1_000);
    h.socket().emit('open'); // success resets the attempt counter

    h.socket().emit('close');
    h.scheduler.advance(1_000);
    expect(h.sockets).toHaveLength(3);
  });
});

describe('BuzzClient — lifecycle', () => {
  it('stop() closes the socket and cancels every timer', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.client.stop();

    expect(h.socket().closed).toBe(true);
    expect(h.client.getStatus()).toBe('stopped');
    expect(h.scheduler.pending()).toBe(0);
  });

  it('sends CLOSE for its subscription before dropping the socket', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.client.stop();

    expect(h.socket().frameLabels()).toContain('CLOSE');
  });

  it('does not reconnect after stop()', () => {
    const h = harness();
    h.client.start();
    h.socket().emit('open');
    h.client.stop();
    h.socket().emit('close');
    h.scheduler.advance(60_000);

    expect(h.sockets).toHaveLength(1);
  });

  it('is idempotent for repeated start and stop', () => {
    const h = harness();
    h.client.start();
    h.client.start();
    expect(h.sockets).toHaveLength(1);

    h.client.stop();
    h.client.stop();
    expect(h.client.getStatus()).toBe('stopped');
  });

  it('treats a socket that cannot be created as a failed attempt, not a crash', () => {
    const scheduler = new FakeScheduler();
    const client = new BuzzClient({
      relayUrl: 'ws://localhost:3000',
      filters: [{ kinds: [BUZZ_KIND.channelMessage] }],
      socketFactory: () => { throw new Error('bad relay URL'); },
      scheduler,
      random: () => 0,
    });

    expect(() => client.start()).not.toThrow();
    expect(client.getStatus()).toBe('reconnecting');
  });
});

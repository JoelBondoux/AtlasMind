/**
 * BuzzClient integration test — the real `ws` transport against a real
 * in-process WebSocket server.
 *
 * The unit tests drive the state machine through a fake socket, which proves
 * the logic but not the wiring. This exercises the parts a fake cannot: the
 * genuine handshake, `ws`'s Buffer→string message delivery, real JSON frames on
 * the wire, real ping/pong, and real close semantics.
 *
 * It is not a Buzz relay — it is a NIP-01-shaped stand-in. Validating against a
 * real Buzz instance is still owed (see the Tier-3 log in the roadmap), but
 * everything below the relay's behaviour is covered here.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import { BuzzClient, type BuzzEventSigner } from '../../src/core/buzzClient.ts';
import { createBuzzWebSocketFactory, toWebSocketUrl } from '../../src/core/buzzSocket.ts';
import { BUZZ_KIND, type NostrEvent } from '../../src/core/buzzProtocol.ts';
import type { DerivedWorkItem } from '../../src/core/buzzInboundDerivation.ts';

const PUBKEY = 'b'.repeat(64);
const SIGNATURE = 'c'.repeat(128);

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'e'.repeat(64),
    pubkey: PUBKEY,
    created_at: 1_700_000_000,
    kind: BUZZ_KIND.channelMessage,
    tags: [['h', 'chan-1']],
    content: 'Ship the release notes',
    sig: SIGNATURE,
    ...overrides,
  };
}

interface Relay {
  url: string;
  /** Frames the client sent us, as parsed arrays. */
  received: unknown[][];
  /** Resolves once a frame with the given label arrives. */
  waitFor(label: string, timeoutMs?: number): Promise<unknown[]>;
  send(frame: unknown[]): void;
  /** Hard-drop every live connection, as a real relay restart would. */
  dropConnections(): void;
  close(): Promise<void>;
}

const openRelays: Relay[] = [];
const openClients: BuzzClient[] = [];

async function startRelay(): Promise<Relay> {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const received: unknown[][] = [];
  const waiters: { label: string; resolve: (frame: unknown[]) => void }[] = [];
  let connection: WsSocket | undefined;

  server.on('connection', socket => {
    connection = socket;
    socket.on('message', raw => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!Array.isArray(frame)) { return; }
      received.push(frame);
      const label = String(frame[0]);
      for (const waiter of [...waiters]) {
        if (waiter.label === label) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(frame);
        }
      }
    });
  });

  const relay: Relay = {
    url: `ws://127.0.0.1:${port}`,
    received,
    waitFor(label, timeoutMs = 4_000) {
      const existing = received.find(frame => String(frame[0]) === label);
      if (existing) { return Promise.resolve(existing); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for a ${label} frame`)), timeoutMs);
        waiters.push({ label, resolve: frame => { clearTimeout(timer); resolve(frame); } });
      });
    },
    send(frame) { connection?.send(JSON.stringify(frame)); },
    dropConnections() {
      for (const socket of server.clients) { socket.terminate(); }
    },
    close() {
      return new Promise<void>(resolve => {
        for (const client of server.clients) { client.terminate(); }
        server.close(() => resolve());
      });
    },
  };

  openRelays.push(relay);
  return relay;
}

/** Wait until `predicate` holds, polling briefly. Keeps assertions race-free. */
async function until(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Condition was not met before the timeout');
}

afterEach(async () => {
  for (const client of openClients.splice(0)) { client.stop(); }
  for (const relay of openRelays.splice(0)) { await relay.close(); }
});

function connect(relay: Relay, extra: Record<string, unknown> = {}): {
  client: BuzzClient;
  items: DerivedWorkItem[];
  errors: string[];
} {
  const items: DerivedWorkItem[] = [];
  const errors: string[] = [];
  const client = new BuzzClient({
    relayUrl: relay.url,
    filters: [{ kinds: [BUZZ_KIND.channelMessage] }],
    socketFactory: createBuzzWebSocketFactory(),
    onWorkItems: batch => items.push(...batch),
    onError: reason => errors.push(reason),
    ...extra,
  });
  openClients.push(client);
  client.start();
  return { client, items, errors };
}

describe('toWebSocketUrl', () => {
  it('maps the CLI-style HTTP base onto a WebSocket scheme', () => {
    // buzz-cli takes the HTTP(S) base; a socket needs ws(s). Both settings work.
    expect(toWebSocketUrl('http://localhost:3000')).toBe('ws://localhost:3000/');
    expect(toWebSocketUrl('https://relay.example.com')).toBe('wss://relay.example.com/');
    expect(toWebSocketUrl('ws://localhost:3000')).toBe('ws://localhost:3000/');
    expect(toWebSocketUrl('wss://relay.example.com')).toBe('wss://relay.example.com/');
  });

  it('refuses a scheme a relay socket cannot speak', () => {
    expect(toWebSocketUrl('file:///etc/passwd')).toBeUndefined();
    expect(toWebSocketUrl('javascript:alert(1)')).toBeUndefined();
    expect(toWebSocketUrl('not a url')).toBeUndefined();
  });

  it('refuses an unencrypted socket to a REMOTE relay', () => {
    // A hosted Buzz workspace is off-machine: plaintext would expose
    // colleagues' messages and the NIP-42 challenge/response in transit.
    // Mirrors the rule the outbound BuzzCliBridge already enforces.
    expect(toWebSocketUrl('ws://relay.example.com')).toBeUndefined();
    expect(toWebSocketUrl('http://relay.example.com')).toBeUndefined();
    expect(toWebSocketUrl('ws://192.168.1.10:3000')).toBeUndefined();
    // ...while the encrypted forms are fine.
    expect(toWebSocketUrl('wss://relay.example.com')).toBe('wss://relay.example.com/');
    expect(toWebSocketUrl('https://relay.example.com')).toBe('wss://relay.example.com/');
  });

  it('still allows plaintext to loopback, which never leaves the machine', () => {
    expect(toWebSocketUrl('ws://localhost:3000')).toBe('ws://localhost:3000/');
    expect(toWebSocketUrl('ws://127.0.0.1:3000')).toBe('ws://127.0.0.1:3000/');
    expect(toWebSocketUrl('ws://[::1]:3000')).toBe('ws://[::1]:3000/');
    expect(toWebSocketUrl('http://localhost:3000')).toBe('ws://localhost:3000/');
  });
});

describe('BuzzClient over a real WebSocket', () => {
  it('completes a real handshake and subscribes with its filters', async () => {
    const relay = await startRelay();
    connect(relay);

    const req = await relay.waitFor('REQ');
    expect(req[1]).toBe('atlasmind-inbound');
    expect(req[2]).toMatchObject({ kinds: [BUZZ_KIND.channelMessage] });
  });

  it('derives a work item from an event delivered over the wire', async () => {
    const relay = await startRelay();
    const { client, items } = connect(relay);

    await relay.waitFor('REQ');
    relay.send(['EVENT', 'atlasmind-inbound', event()]);
    relay.send(['EOSE', 'atlasmind-inbound']);

    await until(() => items.length > 0);
    expect(items[0]?.followUp.title).toContain('Ship the release notes');
    expect(items[0]?.pointer.channelId).toBe('chan-1');
    await until(() => client.getStatus() === 'live');
  });

  it('survives malformed and hostile frames on a live connection', async () => {
    const relay = await startRelay();
    const { client, items } = connect(relay);
    await relay.waitFor('REQ');

    // Raw sends that bypass JSON framing entirely.
    relay.send(['EVENT', 'atlasmind-inbound', { id: 'not-hex' }]);
    relay.send(['NOPE']);
    relay.send([]);
    relay.send(['EVENT', 'atlasmind-inbound', event()]);

    await until(() => items.length > 0);
    expect(items).toHaveLength(1);
    expect(client.getMalformedFrameCount()).toBeGreaterThanOrEqual(3);
  });

  it('answers a real NIP-42 challenge and re-subscribes once accepted', async () => {
    const relay = await startRelay();
    const signer: BuzzEventSigner = {
      pubkey: PUBKEY,
      sign: async template => ({ ...template, id: 'a'.repeat(64), pubkey: PUBKEY, sig: SIGNATURE }),
    };
    connect(relay, { signer });

    await relay.waitFor('REQ');
    relay.send(['AUTH', 'live-challenge']);

    const auth = await relay.waitFor('AUTH');
    const signed = auth[1] as NostrEvent;
    expect(signed.kind).toBe(22242);
    expect(signed.tags).toContainEqual(['challenge', 'live-challenge']);

    relay.send(['OK', 'a'.repeat(64), true, '']);
    await until(() => relay.received.filter(f => String(f[0]) === 'REQ').length === 2);
  });

  it('stops on a real restricted refusal instead of reconnecting', async () => {
    const relay = await startRelay();
    const { client, errors } = connect(relay);

    await relay.waitFor('REQ');
    relay.send(['CLOSED', 'atlasmind-inbound', 'restricted: key not allowed']);

    await until(() => client.getStatus() === 'stopped');
    expect(errors.join(' ')).toMatch(/restricted/i);
  });

  it('reconnects and re-subscribes after the relay drops the connection', async () => {
    const relay = await startRelay();
    const { client } = connect(relay, { reconnect: { baseDelayMs: 20, maxDelayMs: 100 }, random: () => 0 });

    await relay.waitFor('REQ');
    relay.send(['EVENT', 'atlasmind-inbound', event({ created_at: 1_700_000_500 })]);
    await until(() => relay.received.length >= 1);

    // Hard-drop the TCP connection, as a relay restart would — no closing
    // handshake, no CLOSED frame. The client must notice and come back alone.
    relay.dropConnections();

    await until(() => relay.received.filter(f => String(f[0]) === 'REQ').length >= 2, 6_000);
    const reqs = relay.received.filter(f => String(f[0]) === 'REQ');
    // The resume subscription rewinds by the overlap rather than refetching all.
    expect((reqs[1]?.[2] as { since?: number }).since).toBe(1_700_000_440);
    expect(client.getStatus()).not.toBe('stopped');
  });

  it('closes cleanly on stop() without leaving the socket open', async () => {
    const relay = await startRelay();
    const { client } = connect(relay);
    await relay.waitFor('REQ');

    client.stop();
    await relay.waitFor('CLOSE');
    expect(client.getStatus()).toBe('stopped');
  });
});

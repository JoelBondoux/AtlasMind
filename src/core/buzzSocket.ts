/**
 * Real WebSocket transport for `BuzzClient`.
 *
 * Isolated in its own module so `buzzClient.ts` stays transport-agnostic and
 * dependency-free: the client is unit-tested against a fake socket, and this
 * adapter is what supplies the genuine article. `ws` is already an AtlasMind
 * dependency, so inbound sync adds none.
 *
 * The adapter is deliberately thin — it maps `ws` onto the `BuzzSocket` shape
 * and nothing more. All protocol behaviour lives in `buzzProtocol`/`buzzClient`.
 *
 * Safety: the relay URL must already have passed `resolveBuzzRelayUrl`'s
 * deny-by-default remote gate before reaching here; this module enforces only
 * the scheme and a bounded frame size, and never logs frame contents (a relay
 * frame can carry colleagues' message text).
 */

import { WebSocket } from 'ws';
import type { BuzzSocket, BuzzSocketFactory } from './buzzClient.js';
import { MAX_RELAY_FRAME_BYTES } from './buzzProtocol.js';

/** Schemes a Buzz relay WebSocket may use. */
const ALLOWED_SOCKET_PROTOCOLS = new Set(['ws:', 'wss:']);

/**
 * True when a hostname resolves to this machine. Mirrors the rule the outbound
 * `BuzzCliBridge` applies, so both halves of the integration agree on what
 * "local" means.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host) {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export interface BuzzWebSocketOptions {
  /** Handshake timeout in milliseconds. */
  handshakeTimeoutMs?: number;
}

/**
 * Normalise a relay URL for WebSocket use.
 *
 * Buzz's relay speaks both WS and REST, and the two halves of AtlasMind's
 * integration quote it differently — `buzz-cli` wants the HTTP(S) base while a
 * socket needs `ws(s)`. Rather than require the setting to be written one way,
 * `http`/`https` are mapped onto `ws`/`wss` here.
 */
export function toWebSocketUrl(relayUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(relayUrl);
  } catch {
    return undefined;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'http:') {
    parsed.protocol = 'ws:';
  } else if (protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else if (!ALLOWED_SOCKET_PROTOCOLS.has(protocol)) {
    return undefined;
  }

  // A **hosted** Buzz workspace is off-machine, so the connection must be
  // encrypted: an unencrypted socket to a remote relay would expose colleagues'
  // message content and the NIP-42 challenge/response in transit. Loopback is
  // exempt because it never leaves the machine. This mirrors the rule the
  // outbound `BuzzCliBridge` already enforces, and it lives at the transport
  // so no future wiring can reintroduce a plaintext remote connection.
  if (parsed.protocol.toLowerCase() === 'ws:' && !isLoopbackHost(parsed.hostname)) {
    return undefined;
  }

  return parsed.toString();
}

/**
 * Build the socket factory `BuzzClient` uses. Throws only if the URL cannot be
 * used at all — the client treats that as a failed connection attempt and backs
 * off, rather than crashing the extension host.
 */
export function createBuzzWebSocketFactory(options: BuzzWebSocketOptions = {}): BuzzSocketFactory {
  return (relayUrl: string): BuzzSocket => {
    const url = toWebSocketUrl(relayUrl);
    if (!url) {
      throw new Error('The Buzz relay URL is not a usable WebSocket endpoint (expected ws, wss, http, or https).');
    }

    const socket = new WebSocket(url, {
      handshakeTimeout: options.handshakeTimeoutMs ?? 10_000,
      // A relay is untrusted; refuse anything larger than a parseable frame.
      maxPayload: MAX_RELAY_FRAME_BYTES,
    });

    return {
      send: (data: string) => socket.send(data),
      close: () => socket.close(),
      ping: () => socket.ping(),
      terminate: () => socket.terminate(),
      on: (event: string, handler: (...args: never[]) => void) => {
        if (event === 'message') {
          // `ws` yields Buffer/ArrayBuffer; the client wants a string.
          socket.on('message', (data: unknown) => {
            (handler as unknown as (payload: string) => void)(String(data));
          });
          return;
        }
        socket.on(event as 'open', handler as () => void);
      },
    } as BuzzSocket;
  };
}

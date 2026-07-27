/**
 * Buzz event signer — BIP-340 Schnorr signing for NIP-42 relay authentication.
 *
 * A real Buzz relay refuses to serve a subscription until the client
 * authenticates (`auth-required: authenticate before subscribing`, observed
 * against a live relay), so this fills the `BuzzEventSigner` seam that
 * `BuzzClient` leaves open.
 *
 * **Lazily loaded on purpose.** `@noble/secp256k1` is a normal dependency —
 * fixed at build time, covered by the lockfile's integrity hash, auditable in
 * the repo — but it is `require`d only the first time a signature is actually
 * needed. A user who never touches Buzz pays nothing at activation: no load
 * time, no memory. Node's built-in `crypto` supplies SHA-256, so nothing else
 * is pulled in.
 *
 * **Scope.** This signs *authentication* events only. It is not a general Nostr
 * signing surface, and it never publishes: `BuzzClient` remains read-only, and
 * the only event this produces is the ephemeral kind-22242 auth event, which
 * relays never store.
 *
 * Safety posture:
 *  - The secret key is held only for the lifetime of the signer and never
 *    logged, serialised, or included in an error message.
 *  - `nsec` decoding validates the bech32 checksum, so a mistyped key fails
 *    loudly at parse time rather than producing a wrong-but-plausible identity.
 *  - Signing is verified against the derived public key before the event is
 *    returned, so a miswired hash backend can never emit a bad signature.
 *
 * See `project_memory/roadmap/buzz-integration.md` (Tier 3).
 */

import { createHash, createHmac } from 'node:crypto';
import type { BuzzEventSigner } from './buzzClient.js';
import type { NostrEvent, UnsignedNostrEvent } from './buzzProtocol.js';

/** The bech32 alphabet (BIP-173). Excludes `1`, `b`, `i`, and `o`. */
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;

/**
 * The exact surface this module depends on, declared structurally rather than
 * imported as a type. `@noble/secp256k1` is ESM-only, so a type import would
 * need a `resolution-mode` attribute from this CommonJS file — and pinning the
 * shape here also documents precisely how little of the library is used.
 */
interface Secp256k1Module {
  hashes: {
    sha256?: (message: Uint8Array) => Uint8Array;
    hmacSha256?: (key: Uint8Array, message: Uint8Array) => Uint8Array;
  };
  schnorr: {
    sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
    verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
    getPublicKey(secretKey: Uint8Array): Uint8Array;
  };
  etc: { hexToBytes(hex: string): Uint8Array };
}

/**
 * A genuine dynamic `import()`, preserved through TypeScript's CommonJS emit.
 *
 * The package is ESM-only. A plain `await import()` in this file would be
 * downlevelled to `require()`, which throws `ERR_REQUIRE_ESM` on Node versions
 * before 22.12 — and the VS Code extension host can be older than that.
 * Building the import through `Function` keeps it a real dynamic import at
 * runtime, so the extension works on every host Node version.
 */
const dynamicImport = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<unknown>;

/** Lazily-initialised module handle. Loaded on first use, then reused. */
let secpModule: Secp256k1Module | undefined;

async function loadSecp(): Promise<Secp256k1Module> {
  if (secpModule) {
    return secpModule;
  }

  let loaded: Secp256k1Module;
  try {
    loaded = await dynamicImport('@noble/secp256k1') as Secp256k1Module;
  } catch {
    // Some hosts cannot resolve a bare specifier through a constructed
    // import — notably test module runners. `require` is the fallback there;
    // it works wherever `require(esm)` is supported (Node >= 22.12), while the
    // dynamic import above covers the older hosts where it is not.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@noble/secp256k1') as Secp256k1Module;
  }
  const secp = loaded;
  // The library ships no hashes of its own (that is why it has zero
  // dependencies); Node's crypto provides them.
  secp.hashes.sha256 = (message: Uint8Array) =>
    new Uint8Array(createHash('sha256').update(message).digest());
  secp.hashes.hmacSha256 = (key: Uint8Array, message: Uint8Array) =>
    new Uint8Array(createHmac('sha256', key).update(message).digest());
  secpModule = secp;
  return secp;
}

/** Bech32 polymod checksum step (BIP-173). */
function bech32Polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >> i) & 1) {
        checksum ^= generators[i] as number;
      }
    }
  }
  return checksum;
}

function bech32HrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (const char of hrp) {
    const code = char.charCodeAt(0);
    high.push(code >> 5);
    low.push(code & 31);
  }
  return [...high, 0, ...low];
}

/**
 * Decode a bech32 string into its human-readable prefix and 5-bit data words,
 * validating the checksum. Returns undefined rather than throwing.
 */
function bech32Decode(input: string): { hrp: string; words: number[] } | undefined {
  const text = input.trim();
  if (text.length < 8 || text.length > 200) {
    return undefined;
  }
  // Mixed case is invalid per BIP-173.
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
    return undefined;
  }
  const lower = text.toLowerCase();
  const separator = lower.lastIndexOf('1');
  if (separator < 1 || separator + 7 > lower.length) {
    return undefined;
  }

  const hrp = lower.slice(0, separator);
  const dataPart = lower.slice(separator + 1);
  const words: number[] = [];
  for (const char of dataPart) {
    const value = BECH32_ALPHABET.indexOf(char);
    if (value === -1) {
      return undefined;
    }
    words.push(value);
  }

  if (bech32Polymod([...bech32HrpExpand(hrp), ...words]) !== 1) {
    return undefined;
  }
  // Drop the 6-word checksum.
  return { hrp, words: words.slice(0, -6) };
}

/** Convert 5-bit bech32 words back into bytes. */
function wordsToBytes(words: number[]): Uint8Array | undefined {
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const word of words) {
    if (word < 0 || word > 31) {
      return undefined;
    }
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  // Leftover bits must be zero padding only.
  if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) {
    return undefined;
  }
  return Uint8Array.from(bytes);
}

/**
 * Parse a Buzz agent secret key. Accepts either a bech32 `nsec…` (NIP-19) or a
 * bare 64-character hex string — the two forms Buzz itself documents.
 *
 * Returns undefined for anything else, including an `npub` (a *public* key,
 * which cannot sign) — a mistake worth failing loudly on.
 */
export function parseBuzzSecretKey(input: string): Uint8Array | undefined {
  const text = (input ?? '').trim();
  if (!text) {
    return undefined;
  }

  if (HEX_32_BYTES.test(text)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  const decoded = bech32Decode(text);
  if (!decoded || decoded.hrp !== 'nsec') {
    return undefined;
  }
  const bytes = wordsToBytes(decoded.words);
  return bytes && bytes.length === 32 ? bytes : undefined;
}

/**
 * Serialise an event for id computation, per NIP-01:
 * `[0, <pubkey>, <created_at>, <kind>, <tags>, <content>]`, compact JSON.
 */
export function serializeEventForId(event: UnsignedNostrEvent, pubkey: string): string {
  return JSON.stringify([0, pubkey, event.created_at, event.kind, event.tags, event.content]);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * A signer backed by a Buzz agent secret key.
 *
 * Construct with `createBuzzEventSigner`, which validates the key up front so a
 * bad key is reported at configuration time rather than mid-handshake.
 */
class NobleBuzzEventSigner implements BuzzEventSigner {
  readonly pubkey: string;
  private readonly secretKey: Uint8Array;

  constructor(secretKey: Uint8Array, pubkey: string) {
    this.secretKey = secretKey;
    this.pubkey = pubkey;
  }

  async sign(template: UnsignedNostrEvent): Promise<NostrEvent> {
    const secp = await loadSecp();

    const serialized = serializeEventForId(template, this.pubkey);
    const idBytes = new Uint8Array(createHash('sha256').update(Buffer.from(serialized, 'utf8')).digest());
    const signature = secp.schnorr.sign(idBytes, this.secretKey);

    // Verify before returning: a miswired hash backend would otherwise produce
    // a silently invalid signature that only the relay would reject.
    if (!secp.schnorr.verify(signature, idBytes, secp.etc.hexToBytes(this.pubkey))) {
      throw new Error('The Buzz authentication event failed its own signature check.');
    }

    return {
      ...template,
      id: bytesToHex(idBytes),
      pubkey: this.pubkey,
      sig: bytesToHex(signature),
    };
  }
}

export type BuzzSignerResult =
  | { ok: true; signer: BuzzEventSigner }
  | { ok: false; reason: string };

/**
 * Build a signer from a Buzz agent secret key (`nsec…` or 64-char hex).
 *
 * Validates eagerly — including deriving the public key — so a bad or mistyped
 * key surfaces when it is configured, not in the middle of a relay handshake.
 * The failure reason never contains the key material.
 */
export async function createBuzzEventSigner(secretKeyInput: string): Promise<BuzzSignerResult> {
  const secretKey = parseBuzzSecretKey(secretKeyInput);
  if (!secretKey) {
    return {
      ok: false,
      reason: 'The Buzz agent key is not a valid nsec or 64-character hex secret key. '
        + '(An npub is a public key and cannot sign.)',
    };
  }

  try {
    const secp = await loadSecp();
    const pubkey = bytesToHex(secp.schnorr.getPublicKey(secretKey));
    return { ok: true, signer: new NobleBuzzEventSigner(secretKey, pubkey) };
  } catch (error) {
    // Deliberately does not echo the input.
    return {
      ok: false,
      reason: `The Buzz agent key could not be used for signing: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

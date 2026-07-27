import { describe, expect, it } from 'vitest';
import {
  createBuzzEventSigner,
  parseBuzzSecretKey,
  serializeEventForId,
} from '../../src/core/buzzSigner.ts';
import {
  BUZZ_KIND,
  buildAuthEventTemplate,
  buildAuthFrame,
  parseRelayFrame,
  validateNostrEvent,
} from '../../src/core/buzzProtocol.ts';

/**
 * Canonical NIP-19 test vectors. The nsec and npub below are a published pair,
 * so decoding one and deriving the other cross-validates the hand-written
 * bech32 decoder *and* the signing library against the spec.
 */
const NIP19_NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
const NIP19_SECRET_HEX = '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa';
const NIP19_PUBKEY_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const NIP19_NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

describe('parseBuzzSecretKey', () => {
  it('decodes the published NIP-19 nsec vector', () => {
    const bytes = parseBuzzSecretKey(NIP19_NSEC);
    expect(bytes).toBeDefined();
    expect(toHex(bytes as Uint8Array)).toBe(NIP19_SECRET_HEX);
  });

  it('accepts a bare 64-character hex key, in either case', () => {
    expect(toHex(parseBuzzSecretKey(NIP19_SECRET_HEX) as Uint8Array)).toBe(NIP19_SECRET_HEX);
    expect(toHex(parseBuzzSecretKey(NIP19_SECRET_HEX.toUpperCase()) as Uint8Array)).toBe(NIP19_SECRET_HEX);
    expect(toHex(parseBuzzSecretKey(` ${NIP19_SECRET_HEX} `) as Uint8Array)).toBe(NIP19_SECRET_HEX);
  });

  it('rejects a corrupted checksum rather than returning a wrong key', () => {
    // A silent wrong-but-plausible key would authenticate as the wrong identity.
    expect(parseBuzzSecretKey(`${NIP19_NSEC.slice(0, -1)}q`)).toBeUndefined();
    expect(parseBuzzSecretKey(NIP19_NSEC.replace('vl029', 'vl028'))).toBeUndefined();
  });

  it('rejects an npub — a public key cannot sign', () => {
    expect(parseBuzzSecretKey(NIP19_NPUB)).toBeUndefined();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', '   ', 'nsec1', 'not-a-key', 'deadbeef', `${NIP19_SECRET_HEX}ff`, 'nsec1bio']) {
      expect(parseBuzzSecretKey(bad)).toBeUndefined();
    }
    expect(parseBuzzSecretKey(undefined as unknown as string)).toBeUndefined();
  });

  it('rejects mixed case, which bech32 forbids', () => {
    const mixed = `${NIP19_NSEC.slice(0, 10).toUpperCase()}${NIP19_NSEC.slice(10)}`;
    expect(parseBuzzSecretKey(mixed)).toBeUndefined();
  });
});

describe('serializeEventForId', () => {
  it('matches the NIP-01 serialisation exactly', () => {
    const serialized = serializeEventForId(
      { kind: 22242, created_at: 1_700_000_000, tags: [['relay', 'ws://x'], ['challenge', 'c']], content: '' },
      NIP19_PUBKEY_HEX,
    );
    expect(serialized).toBe(
      `[0,"${NIP19_PUBKEY_HEX}",1700000000,22242,[["relay","ws://x"],["challenge","c"]],""]`,
    );
  });
});

describe('createBuzzEventSigner', () => {
  it('derives the public key matching the paired NIP-19 npub vector', async () => {
    const result = await createBuzzEventSigner(NIP19_NSEC);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.signer.pubkey).toBe(NIP19_PUBKEY_HEX);
  });

  it('accepts the hex form and derives the same identity', async () => {
    const fromHex = await createBuzzEventSigner(NIP19_SECRET_HEX);
    const fromNsec = await createBuzzEventSigner(NIP19_NSEC);
    expect(fromHex.ok === true && fromNsec.ok === true
      && fromHex.signer.pubkey === fromNsec.signer.pubkey).toBe(true);
  });

  it('fails at configuration time for a bad key, not mid-handshake', async () => {
    const result = await createBuzzEventSigner('not-a-key');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/nsec or 64-character hex/);
  });

  it('never echoes key material in a failure reason', async () => {
    const secretish = 'nsec1thisisnotarealkeybutlooksabitlikeone';
    const result = await createBuzzEventSigner(secretish);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).not.toContain(secretish);
    expect(result.ok === false && result.reason).not.toContain('thisisnotarealkey');
  });

  it('names the npub mistake explicitly, since it is the likely one', async () => {
    const result = await createBuzzEventSigner(NIP19_NPUB);
    expect(result.ok === false && result.reason).toMatch(/npub/i);
  });
});

describe('signing a NIP-42 auth event', () => {
  it('produces an event that passes the protocol layer\'s own validation', async () => {
    const signerResult = await createBuzzEventSigner(NIP19_NSEC);
    expect(signerResult.ok).toBe(true);
    if (!signerResult.ok) { return; }

    const template = buildAuthEventTemplate('wss://relay.example.com', 'challenge-1', 1_700_000_000);
    expect(template.ok).toBe(true);
    if (!template.ok) { return; }

    const signed = await signerResult.signer.sign(template.event);

    // The signed event must satisfy the same untrusted-input validator the
    // client applies to anything arriving from a relay.
    expect(validateNostrEvent(signed)).toEqual(signed);
    expect(signed.kind).toBe(BUZZ_KIND.auth);
    expect(signed.pubkey).toBe(NIP19_PUBKEY_HEX);
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(signed.tags).toEqual([['relay', 'wss://relay.example.com'], ['challenge', 'challenge-1']]);
  });

  it('round-trips through the client frame and back out of the parser', async () => {
    const signerResult = await createBuzzEventSigner(NIP19_NSEC);
    if (!signerResult.ok) { throw new Error('signer failed'); }
    const template = buildAuthEventTemplate('wss://relay.example.com', 'challenge-2', 1_700_000_000);
    if (!template.ok) { throw new Error('template failed'); }

    const signed = await signerResult.signer.sign(template.event);
    const frame = buildAuthFrame(signed);
    expect(frame.ok).toBe(true);
    if (!frame.ok) { return; }

    // A relay echoing this back must parse cleanly as the same event.
    const parsed = parseRelayFrame(JSON.stringify(['EVENT', 'sub', JSON.parse(frame.frame)[1]]));
    expect(parsed.type).toBe('EVENT');
    expect(parsed.type === 'EVENT' && parsed.event.id).toBe(signed.id);
  });

  it('is deterministic in id and varies the signature per challenge', async () => {
    const signerResult = await createBuzzEventSigner(NIP19_NSEC);
    if (!signerResult.ok) { throw new Error('signer failed'); }

    const one = buildAuthEventTemplate('wss://r', 'challenge-a', 1_700_000_000);
    const two = buildAuthEventTemplate('wss://r', 'challenge-b', 1_700_000_000);
    if (!one.ok || !two.ok) { throw new Error('template failed'); }

    const a = await signerResult.signer.sign(one.event);
    const b = await signerResult.signer.sign(two.event);
    // Different challenge ⇒ different event ⇒ different id.
    expect(a.id).not.toBe(b.id);

    // The same template signs to the same id every time.
    const again = await signerResult.signer.sign(one.event);
    expect(again.id).toBe(a.id);
  });

  it('signs only the auth kind it was handed, never inventing an event', async () => {
    const signerResult = await createBuzzEventSigner(NIP19_NSEC);
    if (!signerResult.ok) { throw new Error('signer failed'); }

    const signed = await signerResult.signer.sign({
      kind: 1, created_at: 1_700_000_000, tags: [], content: 'hello',
    });
    // It signs what it is given — the read-only guarantee lives in BuzzClient,
    // which only ever hands it a kind-22242 template.
    expect(signed.kind).toBe(1);
    expect(validateNostrEvent(signed)).toEqual(signed);
  });
});

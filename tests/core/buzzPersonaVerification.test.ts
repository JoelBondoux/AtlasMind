/**
 * Proving which Buzz identity runs a persona, against real signatures: the
 * NIP-OA spec's owner (secret 1) authorises its agent (secret 2), every answer
 * is signed by `BuzzSigner`, and each refusal is reached with genuine keys.
 */
import { createHash, createHmac } from 'node:crypto';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBuzzEventSigner } from '../../src/core/buzzSigner.ts';
import { ownerAttestationMessage } from '../../src/core/buzzOwnerAttestation.ts';
import {
  PERSONA_CHALLENGE_TTL_MS,
  createPersonaChallenge,
  personaChallengeAnswer,
  personaChallengeMessage,
  readPersonaChallengeFromBuzzPrompt,
  verifyPersonaAnswer,
  type PersonaChallenge,
} from '../../src/core/buzzPersonaVerification.ts';
import type { NostrEvent } from '../../src/core/buzzProtocol.ts';

const OWNER_SECRET = '0'.repeat(63) + '1';
const AGENT_SECRET = '0'.repeat(63) + '2';
const STRANGER_SECRET = '0'.repeat(63) + '3';
const OWNER = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const AGENT = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const CHANNEL = '443a7fd2-dc28-46a6-998e-8721589f2778';
const FINGERPRINT = 'ab'.repeat(32);
const NONCE = '0123456789abcdef0123456789abcdef';
const ISSUED = 1_800_000_000_000;

let ownerAuthTag: string[];

beforeAll(async () => {
  const secp = await import('@noble/secp256k1');
  secp.hashes.sha256 = (message: Uint8Array) => new Uint8Array(createHash('sha256').update(message).digest());
  secp.hashes.hmacSha256 = (key: Uint8Array, message: Uint8Array) => new Uint8Array(createHmac('sha256', key).update(message).digest());
  const signature = secp.schnorr.sign(ownerAttestationMessage(AGENT, 'kind=9'), secp.etc.hexToBytes(OWNER_SECRET));
  ownerAuthTag = ['auth', OWNER, 'kind=9', Buffer.from(signature).toString('hex')];
});

async function signed(content: string, options: { secret?: string; createdAt?: number; auth?: boolean; kind?: number } = {}): Promise<NostrEvent> {
  const signer = await createBuzzEventSigner(options.secret ?? AGENT_SECRET);
  if (!signer.ok) throw new Error(signer.reason);
  return signer.signer.sign({
    kind: options.kind ?? 9,
    created_at: options.createdAt ?? Math.floor(ISSUED / 1000) + 30,
    tags: [['h', CHANNEL], ...(options.auth === false ? [] : [ownerAuthTag])],
    content,
  });
}

const challenge = (): PersonaChallenge => createPersonaChallenge('am-engineer', FINGERPRINT, ISSUED, NONCE);
const answer = (): string => personaChallengeAnswer('am-engineer', { personaId: 'am-engineer', nonce: NONCE }, FINGERPRINT);
const at = (offsetMs: number) => ({ now: ISSUED + offsetMs });

describe('the challenge', () => {
  it('is a mention carrying the persona id and a nonce, and refuses bad input', () => {
    expect(personaChallengeMessage(challenge(), 'AM Engineer')).toBe(`@AM Engineer atlasmind-verify am-engineer ${NONCE}`);
    expect(challenge().expiresAt - challenge().issuedAt).toBe(PERSONA_CHALLENGE_TTL_MS);
    expect(() => createPersonaChallenge('AM Engineer', FINGERPRINT, ISSUED, NONCE)).toThrow();
    expect(() => createPersonaChallenge('am-engineer', FINGERPRINT, ISSUED, 'short')).toThrow();
  });

  it('is read from the triggering message only, never from history', () => {
    const prompt = (event: string, history = '') => [
      '[Context]', 'Scope: channel', `Channel: atlas (#${CHANNEL})`, '',
      ...(history ? ['[Recent messages]', history, ''] : []),
      '[Event]', `Event ID: ${'a'.repeat(64)}`, `Content: ${event}`,
    ].join('\n');
    expect(readPersonaChallengeFromBuzzPrompt(prompt(`@AM Engineer atlasmind-verify am-engineer ${NONCE}`)))
      .toEqual({ personaId: 'am-engineer', nonce: NONCE });
    expect(readPersonaChallengeFromBuzzPrompt(prompt('what is the roadmap?', `atlasmind-verify am-engineer ${NONCE}`))).toBeUndefined();
    expect(readPersonaChallengeFromBuzzPrompt(`atlasmind-verify am-engineer ${NONCE}`)).toBeUndefined();
    const twoEvents = `${prompt(`atlasmind-verify am-engineer ${NONCE}`)}\n\n[Event]\nEvent ID: ${'b'.repeat(64)}\nContent: thanks`;
    expect(readPersonaChallengeFromBuzzPrompt(twoEvents)).toBeUndefined();
  });

  it('is answered with the verified line only by the persona it names', () => {
    expect(answer()).toBe(`atlasmind-verified am-engineer ${NONCE} manifest=${FINGERPRINT.slice(0, 16)}`);
    const refusal = personaChallengeAnswer('am-marketing', { personaId: 'am-engineer', nonce: NONCE }, FINGERPRINT);
    expect(refusal).toMatch(/runs the persona am-marketing, not am-engineer/);
    expect(refusal).not.toContain('atlasmind-verified');
  });
});

describe('verifyPersonaAnswer', () => {
  it('binds the agent key, naming the owner who authorised it', async () => {
    const event = await signed(answer());
    expect(await verifyPersonaAnswer(event, [challenge()], at(60_000))).toEqual({
      status: 'verified', personaId: 'am-engineer', nonce: NONCE, pubkey: AGENT, ownerPubkey: OWNER, eventId: event.id, verifiedAt: ISSUED + 60_000,
    });
  });

  it('refuses somebody typing the answer line with their own key and no attestation', async () => {
    const typed = await signed(answer(), { secret: OWNER_SECRET, auth: false });
    expect(await verifyPersonaAnswer(typed, [challenge()], at(60_000)))
      .toEqual({ status: 'invalid', personaId: 'am-engineer', reason: expect.stringMatching(/no owner attestation/) });
  });

  it('refuses a stranger who copies the agent\'s attestation onto their own event', async () => {
    const borrowed = await signed(answer(), { secret: STRANGER_SECRET });
    expect((await verifyPersonaAnswer(borrowed, [challenge()], at(60_000))).status).toBe('invalid');
  });

  it('refuses an answer changed after signing', async () => {
    const event = await signed(answer());
    // Still a well-formed answer line, so only the signature can refuse it.
    const tampered = { ...event, content: `${event.content} (edited)` };
    expect(await verifyPersonaAnswer(tampered, [challenge()], at(60_000)))
      .toEqual({ status: 'invalid', personaId: 'am-engineer', reason: expect.stringMatching(/does not match its content/) });
  });

  it('reports an answer from an older manifest instead of accepting it', async () => {
    const old = await signed(personaChallengeAnswer('am-engineer', { personaId: 'am-engineer', nonce: NONCE }, 'cd'.repeat(32)));
    expect(await verifyPersonaAnswer(old, [challenge()], at(60_000))).toMatchObject({
      status: 'stale-manifest', pubkey: AGENT, answeredWith: 'cd'.repeat(8), expected: 'ab'.repeat(8),
    });
  });

  it('refuses a late answer and one signed before the check was issued', async () => {
    const late = await signed(answer(), { createdAt: Math.floor((ISSUED + PERSONA_CHALLENGE_TTL_MS) / 1000) + 5 });
    expect((await verifyPersonaAnswer(late, [challenge()], at(PERSONA_CHALLENGE_TTL_MS))).status).toBe('expired');
    const replayed = await signed(answer(), { createdAt: Math.floor(ISSUED / 1000) - 3_600 });
    expect((await verifyPersonaAnswer(replayed, [challenge()], at(60_000))).status).toBe('expired');
  });

  it('ignores what is not an answer, and says when the nonce is not one it issued', async () => {
    expect(await verifyPersonaAnswer(await signed('hello'), [challenge()], at(1))).toEqual({ status: 'ignored' });
    expect(await verifyPersonaAnswer(await signed(answer(), { kind: 7 }), [challenge()], at(1))).toEqual({ status: 'ignored' });
    const other = personaChallengeAnswer('am-engineer', { personaId: 'am-engineer', nonce: 'f'.repeat(32) }, FINGERPRINT);
    expect(await verifyPersonaAnswer(await signed(other), [challenge()], at(1))).toEqual({ status: 'unknown-challenge', personaId: 'am-engineer' });
  });

  it('refuses an identity whose owner is revoked in AtlasMind', async () => {
    const event = await signed(answer());
    expect(await verifyPersonaAnswer(event, [challenge()], { now: ISSUED + 1, isRevoked: key => key === OWNER }))
      .toEqual({ status: 'invalid', personaId: 'am-engineer', reason: expect.stringMatching(/revoked/) });
  });

  it('never verifies a signed answer whose content was changed anywhere (property)', async () => {
    const event = await signed(answer());
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 0, max: event.content.length - 1 }),
      fc.constantFrom('0', 'f', 'x', ' '),
      async (index, replacement) => {
        if (event.content[index] === replacement) return true;
        const changed = { ...event, content: event.content.slice(0, index) + replacement + event.content.slice(index + 1) };
        return (await verifyPersonaAnswer(changed, [challenge()], at(60_000))).status !== 'verified';
      },
    ), { numRuns: 40 });
  });
});

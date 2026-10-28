import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { serializeEventForId } from '../../src/core/buzzSigner.ts';
import {
  eventSatisfiesConditions,
  ownerAttestationMessage,
  parseAttestationConditions,
  verifyOwnerAttestation,
} from '../../src/core/buzzOwnerAttestation.ts';
import type { NostrEvent } from '../../src/core/buzzProtocol.ts';

/**
 * The signed example and the test vector from NIP-OA (`docs/nips/NIP-OA.md`
 * at Buzz desktop-v0.5.28): owner secret 1, agent secret 2.
 */
const OWNER = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const AGENT = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const CONDITIONS = 'kind=1&created_at<1713957000';
const AUTH_SIG = '8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369';
const SPEC_EVENT: NostrEvent = {
  id: 'd892a65e7677e0554ebb70ee16deeb6a0727dba46450fb4bc001291d7bff971b',
  pubkey: AGENT,
  created_at: 1713956400,
  kind: 1,
  tags: [['auth', OWNER, CONDITIONS, AUTH_SIG]],
  content: 'owner-attested agent event',
  sig: '7fd38992b70b5e9e113644e51b4c8ee2227f3bdd402b1855f8786c0600394ab3ec2621742a7bad0b0000b93d4d1ae6e39525f286a3c1029f43f46c3359a6c76f',
};

describe('buzzOwnerAttestation — NIP-OA as published', () => {
  it('reproduces the spec\'s signed preimage hash', () => {
    expect(Buffer.from(ownerAttestationMessage(AGENT, CONDITIONS)).toString('hex'))
      .toBe('08cdecd55af4c28d3801fd69615dcf5cc04fab3bc134b38a840bf157197069a6');
  });

  it('verifies the spec\'s signed example event and names its owner', async () => {
    expect(await verifyOwnerAttestation(SPEC_EVENT)).toEqual({ status: 'verified', ownerPubkey: OWNER, conditions: CONDITIONS });
  });

  it('says absent, not invalid, for an event with no auth tag', async () => {
    expect(await verifyOwnerAttestation({ ...SPEC_EVENT, tags: [] })).toEqual({ status: 'absent' });
  });

  it('rejects each invalid vector the spec lists', async () => {
    const tag = SPEC_EVENT.tags[0]!;
    const invalid = [
      { tags: [tag, tag] },
      { tags: [tag.slice(0, 3)] },
      { tags: [['auth', OWNER, 'kind=1&', AUTH_SIG]] },
      { tags: [['auth', OWNER, 'kind=01', AUTH_SIG]] },
      { tags: [['auth', AGENT, CONDITIONS, AUTH_SIG]] },
      { sig: SPEC_EVENT.sig.replace(/^7/, '8') },
      { content: 'tampered after signing' },
    ];
    for (const change of invalid) {
      expect((await verifyOwnerAttestation({ ...SPEC_EVENT, ...change } as NostrEvent)).status).toBe('invalid');
    }
  });

  it('rejects an event outside the conditions the owner signed, even when every signature checks', async () => {
    // A kind-7 event with a correct id, under a grant for kind 1 only. The
    // signature check is stubbed to pass, so the conditions are what refuse it.
    const kind7 = { ...SPEC_EVENT, kind: 7 };
    const id = createHash('sha256').update(serializeEventForId(kind7, AGENT), 'utf8').digest('hex');
    const verdict = await verifyOwnerAttestation({ ...kind7, id }, { verifySchnorr: async () => true });
    expect(verdict).toEqual({ status: 'invalid', reason: expect.stringContaining('conditions') });
    expect(eventSatisfiesConditions(parseAttestationConditions(CONDITIONS)!, { kind: 1, created_at: 1713957000 })).toBe(false);
  });

  it('reads the conditions grammar exactly, and never normalises it', () => {
    expect(parseAttestationConditions('')).toEqual([]);
    expect(parseAttestationConditions('created_at>5&kind=0')).toEqual([{ kind: 'after', value: 5 }, { kind: 'kind', value: 0 }]);
    for (const bad of ['&kind=1', 'kind=1&&kind=2', 'kind= 1', 'kind=65536', 'created_at<4294967296', 'expires=5', 'KIND=1']) {
      expect(parseAttestationConditions(bad)).toBeUndefined();
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  buzzArchiveCommand,
  checkBuzzRevocation,
  readBuzzRevocations,
  withRevocation,
  withoutRevocation,
} from '../../src/core/buzzRevocation.ts';

// The published NIP-19 pair: this npub decodes to this hex key.
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';

describe('buzzRevocation', () => {
  it('reads every scope as a union, so a revocation anywhere wins', () => {
    const list = readBuzzRevocations([[{ pubkey: NPUB, reason: 'rotated' }], undefined, ['a'.repeat(64)]]);
    expect([...list.revoked.keys()]).toEqual([HEX, 'a'.repeat(64)]);
    expect(list.revoked.get(HEX)).toEqual({ pubkey: HEX, reason: 'rotated' });
    // An unrecognised reason is read as the strictest one, never dropped.
    expect(readBuzzRevocations([[{ pubkey: HEX, reason: 'whatever' }]]).revoked.get(HEX)?.reason).toBe('compromised');
  });

  it('reports what it cannot use, and never repeats a secret key back', () => {
    const list = readBuzzRevocations([['npub1notarealkey', 'nsec1secretmaterialthatmustnotbeechoed', { pubkey: 42 }], 'not-a-list']);
    expect(list.revoked.size).toBe(0);
    expect(list.problems).toHaveLength(4);
    expect(JSON.stringify(list.problems)).not.toContain('secretmaterial');
    expect(list.problems[1]!.reason).toMatch(/secret key/);
  });

  it('revokes an agent through the verified owner who authorised it', () => {
    const { revoked } = readBuzzRevocations([[{ pubkey: HEX, reason: 'left-organization' }]]);
    expect(checkBuzzRevocation('b'.repeat(64), HEX, revoked)).toEqual({ revoked: true, pubkey: HEX, via: 'owner', reason: 'left-organization' });
    expect(checkBuzzRevocation(HEX, undefined, revoked)).toMatchObject({ revoked: true, via: 'author' });
    expect(checkBuzzRevocation('b'.repeat(64), undefined, revoked)).toEqual({ revoked: false });
  });

  it('adds and removes by key, whichever spelling the setting used', () => {
    const added = withRevocation([NPUB, { pubkey: 'a'.repeat(64) }], { pubkey: HEX, reason: 'spam', revokedAt: '2026-10-28' });
    expect(added).toEqual([{ pubkey: 'a'.repeat(64) }, { pubkey: HEX, reason: 'spam', revokedAt: '2026-10-28' }]);
    expect(withoutRevocation(added, HEX)).toEqual([{ pubkey: 'a'.repeat(64) }]);
  });

  it('builds the owner\'s Buzz archive command only from a validated key and a declared reason', () => {
    expect(buzzArchiveCommand(HEX, 'compromised')).toEqual({
      argv: ['buzz', 'agents', 'archive', HEX, '--reason', 'compromised'],
      display: `buzz agents archive ${HEX} --reason compromised`,
    });
    expect(buzzArchiveCommand(`${HEX}; rm -rf /`, 'compromised')).toBeUndefined();
    expect(buzzArchiveCommand(HEX, 'because' as never)).toBeUndefined();
  });
});

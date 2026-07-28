import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_BINDINGS,
  parseAgentBindings,
  resolveBoundAgent,
} from '../../src/core/buzzAgentBindings.ts';
import { deriveWorkItemFromEvent } from '../../src/core/buzzInboundDerivation.ts';
import { BUZZ_KIND, type NostrEvent } from '../../src/core/buzzProtocol.ts';

// Canonical NIP-19 pair, so the npub form is a real one rather than invented.
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const NPUB_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';

describe('parseAgentBindings', () => {
  it('accepts a record of npub → agent id and normalises to hex', () => {
    const { bindings, issues } = parseAgentBindings({ [NPUB]: 'devops-engineer' });
    expect(issues).toEqual([]);
    expect(bindings).toEqual([{ pubkey: NPUB_HEX, agentId: 'devops-engineer' }]);
  });

  it('treats the hex and npub forms as the same identity', () => {
    const fromHex = parseAgentBindings({ [NPUB_HEX]: 'a' }).bindings[0];
    const fromNpub = parseAgentBindings({ [NPUB]: 'a' }).bindings[0];
    expect(fromHex?.pubkey).toBe(fromNpub?.pubkey);
  });

  it('accepts the array form with an optional label', () => {
    const { bindings } = parseAgentBindings([
      { pubkey: NPUB, agentId: 'security-specialist', label: 'Buzz scanner bot' },
    ]);
    expect(bindings[0]).toEqual({
      pubkey: NPUB_HEX,
      agentId: 'security-specialist',
      label: 'Buzz scanner bot',
    });
  });

  it('reports an unusable binding rather than dropping it silently', () => {
    // A silently-ignored binding routes work to the wrong place with no clue why.
    const { bindings, issues } = parseAgentBindings({ 'not-a-key': 'devops-engineer' });
    expect(bindings).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/valid Buzz public key/);
  });

  it('refuses an nsec — a secret key must never be pasted as an identity', () => {
    const { bindings, issues } = parseAgentBindings({ [NSEC]: 'devops-engineer' });
    expect(bindings).toEqual([]);
    expect(issues[0]?.reason).toMatch(/nsec is a secret key/i);
  });

  it('rejects a mistyped npub instead of binding to a different identity', () => {
    const mistyped = `${NPUB.slice(0, -1)}q`;
    const { bindings, issues } = parseAgentBindings({ [mistyped]: 'devops-engineer' });
    expect(bindings).toEqual([]);
    expect(issues).toHaveLength(1);
  });

  it('reports a missing agent id', () => {
    expect(parseAgentBindings({ [NPUB]: '' }).issues).toHaveLength(1);
    expect(parseAgentBindings({ [NPUB]: '   ' }).bindings).toEqual([]);
  });

  it('keeps the first of a duplicate identity and says so', () => {
    const { bindings, issues } = parseAgentBindings([
      { pubkey: NPUB, agentId: 'first' },
      { pubkey: NPUB_HEX, agentId: 'second' },
    ]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.agentId).toBe('first');
    expect(issues[0]?.reason).toMatch(/duplicate/i);
  });

  it('caps the number of bindings', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_AGENT_BINDINGS + 10; i += 1) {
      many[`${i.toString(16).padStart(64, '0')}`] = `agent-${i}`;
    }
    expect(parseAgentBindings(many).bindings.length).toBeLessThanOrEqual(MAX_AGENT_BINDINGS);
  });

  it('never throws on malformed input', () => {
    for (const bad of [undefined, null, 'string', 42, [1, 2, 3], [null]]) {
      expect(() => parseAgentBindings(bad)).not.toThrow();
    }
    expect(parseAgentBindings(undefined).bindings).toEqual([]);
  });
});

describe('resolveBoundAgent', () => {
  const bindings = parseAgentBindings({ [NPUB]: 'devops-engineer' }).bindings;

  it('matches an author given in either form', () => {
    expect(resolveBoundAgent(bindings, NPUB_HEX)?.agentId).toBe('devops-engineer');
    expect(resolveBoundAgent(bindings, NPUB)?.agentId).toBe('devops-engineer');
    expect(resolveBoundAgent(bindings, NPUB_HEX.toUpperCase())?.agentId).toBe('devops-engineer');
  });

  it('returns undefined for an unbound author — never a guess', () => {
    expect(resolveBoundAgent(bindings, 'a'.repeat(64))).toBeUndefined();
    expect(resolveBoundAgent(bindings, 'nonsense')).toBeUndefined();
    expect(resolveBoundAgent([], NPUB_HEX)).toBeUndefined();
  });
});

describe('agent bindings applied during derivation', () => {
  const NOW = new Date('2026-07-28T12:00:00.000Z');

  function event(pubkey: string): NostrEvent {
    return {
      id: 'e'.repeat(64),
      pubkey,
      created_at: 1_700_000_000,
      kind: BUZZ_KIND.channelMessage,
      tags: [['h', 'chan-1']],
      content: 'Deploy failed on staging',
      sig: 'c'.repeat(128),
    };
  }

  const bindings = parseAgentBindings({ [NPUB]: 'devops-engineer' }).bindings;

  it('assigns the bound agent to work from that Buzz identity', () => {
    const result = deriveWorkItemFromEvent(event(NPUB_HEX), { now: NOW, agentBindings: bindings });
    expect(result.ok && result.item.agentId).toBe('devops-engineer');
  });

  it('leaves work from an unbound identity unassigned', () => {
    const result = deriveWorkItemFromEvent(event('a'.repeat(64)), { now: NOW, agentBindings: bindings });
    expect(result.ok && result.item.agentId).toBeUndefined();
  });

  it('assigns nothing when no bindings are configured', () => {
    const result = deriveWorkItemFromEvent(event(NPUB_HEX), { now: NOW });
    expect(result.ok && result.item.agentId).toBeUndefined();
  });

  it('still stores no message body when a binding applies', () => {
    const result = deriveWorkItemFromEvent(event(NPUB_HEX), { now: NOW, agentBindings: bindings });
    expect(JSON.stringify(result)).not.toContain('"content"');
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_AGENT_BINDINGS,
  parseAgentBindings,
  resolveBoundAgent,
  writeAgentBinding,
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

// The Director roster's "bind this person to that agent" control writes through
// this helper, so a click and a hand-edited setting go through one set of rules.
describe('writeAgentBinding', () => {
  const OTHER_HEX = 'b'.repeat(64);

  it('adds a binding to an empty setting, in the simple record form', () => {
    const result = writeAgentBinding(undefined, { pubkey: NPUB, agentId: 'devops-engineer' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ [NPUB_HEX]: 'devops-engineer' });
  });

  it('replaces the agent for an identity that is already bound', () => {
    const first = writeAgentBinding(undefined, { pubkey: NPUB, agentId: 'devops-engineer' });
    const second = writeAgentBinding(first.value, { pubkey: NPUB, agentId: 'security-specialist' });
    expect(second.value).toEqual({ [NPUB_HEX]: 'security-specialist' });
  });

  it('treats the npub and hex forms as the same identity rather than adding a second row', () => {
    const first = writeAgentBinding(undefined, { pubkey: NPUB, agentId: 'a' });
    const second = writeAgentBinding(first.value, { pubkey: NPUB_HEX, agentId: 'b' });
    expect(Object.keys(second.value as Record<string, string>)).toEqual([NPUB_HEX]);
  });

  it('removes the binding when the agent id is empty — unbinding is not an error', () => {
    const first = writeAgentBinding({ [OTHER_HEX]: 'keep-me' }, { pubkey: NPUB, agentId: 'drop-me' });
    const second = writeAgentBinding(first.value, { pubkey: NPUB, agentId: '' });
    expect(second.ok).toBe(true);
    expect(second.value).toEqual({ [OTHER_HEX]: 'keep-me' });
  });

  it('leaves every other binding untouched', () => {
    const result = writeAgentBinding({ [OTHER_HEX]: 'untouched' }, { pubkey: NPUB, agentId: 'new' });
    expect(result.value).toEqual({ [OTHER_HEX]: 'untouched', [NPUB_HEX]: 'new' });
  });

  it('refuses a mistyped npub rather than binding work to a different identity', () => {
    // One character changed: a valid-looking npub that fails its checksum.
    const mistyped = `${NPUB.slice(0, -2)}zg`;
    const result = writeAgentBinding(undefined, { pubkey: mistyped, agentId: 'devops-engineer' });
    expect(result.ok).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toMatch(/valid Buzz public key/i);
  });

  it('refuses a secret key by name', () => {
    const result = writeAgentBinding(undefined, { pubkey: NSEC, agentId: 'devops-engineer' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nsec/i);
  });

  it('keeps the array shape when the user already wrote one', () => {
    const existing = [{ pubkey: OTHER_HEX, agentId: 'first', label: 'Build bot' }];
    const result = writeAgentBinding(existing, { pubkey: NPUB, agentId: 'second', label: 'Jane' });
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toEqual([
      { pubkey: OTHER_HEX, agentId: 'first', label: 'Build bot' },
      { pubkey: NPUB_HEX, agentId: 'second', label: 'Jane' },
    ]);
  });

  it('refuses to grow past the cap', () => {
    const full: Record<string, string> = {};
    for (let index = 0; index < MAX_AGENT_BINDINGS; index += 1) {
      full[index.toString(16).padStart(64, '0')] = 'agent';
    }
    const result = writeAgentBinding(full, { pubkey: NPUB, agentId: 'one-too-many' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at most/i);
  });

  it('still allows unbinding when the setting is at the cap', () => {
    const full: Record<string, string> = { [NPUB_HEX]: 'agent' };
    for (let index = 1; index < MAX_AGENT_BINDINGS; index += 1) {
      full[index.toString(16).padStart(64, '0')] = 'agent';
    }
    const result = writeAgentBinding(full, { pubkey: NPUB, agentId: '' });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.value as Record<string, string>)).not.toContain(NPUB_HEX);
  });

  it('never emits a value alongside an error', () => {
    const result = writeAgentBinding(undefined, { pubkey: 'not-a-key', agentId: 'x' });
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });
});

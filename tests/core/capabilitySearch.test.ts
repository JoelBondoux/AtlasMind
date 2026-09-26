import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_DISCOVERY_QUERY_CHARS,
  MAX_CHAT_DISCOVERY_RESULTS,
  describeCapabilityOutcome,
  prepareCapabilityQuery,
} from '../../src/core/capabilitySearch.ts';
import type { ArdDiscoveredResource } from '../../src/types.ts';

const resource = (index: number): ArdDiscoveredResource => ({
  identifier: `urn:tool:${index}`,
  displayName: `Tool ${index}`,
  type: 'application/mcp-server+json',
  sourceName: 'GitHub Agent Finder',
  score: 90 - index,
  description: `Does thing ${index}`,
});

describe('prepareCapabilityQuery', () => {
  it('redacts secrets before the query leaves the machine', () => {
    const query = prepareCapabilityQuery('query postgres with api_key=sk_live_abcdefghijklmnop1234');
    expect(query).not.toContain('sk_live_abcdefghijklmnop1234');
    expect(query).toContain('[REDACTED]');
  });

  it('clamps a paragraph to a capability description', () => {
    expect(prepareCapabilityQuery('word '.repeat(200)).length).toBeLessThanOrEqual(MAX_CHAT_DISCOVERY_QUERY_CHARS);
  });

  it('sends nothing for an empty query', () => {
    expect(prepareCapabilityQuery('   \n ')).toBe('');
  });
});

describe('describeCapabilityOutcome', () => {
  it('says no finder is enabled rather than implying nothing exists', () => {
    const { message, resources } = describeCapabilityOutcome('query postgres', { status: 'no-finders' });
    expect(message).toMatch(/no Agent Finder is enabled/);
    expect(message).toMatch(/Resource Discovery/);
    expect(resources).toEqual([]);
  });

  it('reports a failed search as a failure', () => {
    const { message } = describeCapabilityOutcome('q', { status: 'failed', message: 'timeout' });
    expect(message).toContain('failed (timeout)');
  });

  it('distinguishes finders that found nothing from finders that were never asked', () => {
    const { message } = describeCapabilityOutcome('q', { status: 'searched', finderCount: 2, resources: [], errors: [] });
    expect(message).toMatch(/2 enabled Agent Finder\(s\) found nothing/);
  });

  it('lists candidates, caps them, says none is callable, and disclaims the score', () => {
    const many = Array.from({ length: 9 }, (_, index) => resource(index));
    const { message, resources } = describeCapabilityOutcome('q', { status: 'searched', finderCount: 1, resources: many, errors: [] });
    expect(resources).toHaveLength(MAX_CHAT_DISCOVERY_RESULTS);
    expect(message).toContain('Tool 0 [mcp-server] via GitHub Agent Finder');
    expect(message).toMatch(/None of these is installed/);
    expect(message).toMatch(/not a trust or safety rating/);
  });
});

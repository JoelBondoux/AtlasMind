import { describe, expect, it } from 'vitest';

import {
  discoverTools,
  rankSkillsForQuery,
  shouldOfferToolDiscovery,
  TOOL_DISCOVERY_SKILL_ID,
} from '../../src/core/toolDiscovery.ts';
import type { SkillDefinition } from '../../src/types.ts';

const skill = (id: string, name: string, description: string): SkillDefinition => ({
  id, name, description, builtIn: true, parameters: { type: 'object', properties: {} },
  execute: async () => '',
} as unknown as SkillDefinition);

const POOL: SkillDefinition[] = [
  skill('git-commit', 'Create a commit', 'Create a git commit in the workspace repository.'),
  skill('git-status', 'Show status', 'Show the working tree status.'),
  skill('file-read', 'Read a file', 'Read a file from the workspace.'),
  skill('test-run', 'Run tests', 'Run the project test suite and report failures.'),
  skill('web-fetch', 'Fetch a URL', 'Fetch a page from the internet.'),
];

describe('rankSkillsForQuery', () => {
  it('ranks an id match above a description match', () => {
    // A model asking for "git commit" means `git-commit`. Letting a description
    // that merely mentions committing outrank it is how the wrong tool gets
    // suggested confidently.
    const ranked = rankSkillsForQuery('commit', POOL);
    expect(ranked[0]?.skill.id).toBe('git-commit');
  });

  it('returns nothing for a query with no content words', () => {
    expect(rankSkillsForQuery('the and for', POOL)).toEqual([]);
    expect(rankSkillsForQuery('', POOL)).toEqual([]);
  });

  it('orders ties deterministically', () => {
    // Two runs of the same search must not disagree about what exists.
    const first = rankSkillsForQuery('workspace file', POOL).map(match => match.skill.id);
    const second = rankSkillsForQuery('workspace file', POOL).map(match => match.skill.id);
    expect(first).toEqual(second);
  });
});

describe('discoverTools', () => {
  it('grants matching tools and names them', () => {
    const result = discoverTools('run the tests', POOL, new Set());
    expect(result.granted.map(entry => entry.id)).toContain('test-run');
    expect(result.message).toContain('test-run');
    expect(result.message).toMatch(/callable now/i);
  });

  it('never returns a tool the turn already holds', () => {
    // Returning them wastes the turn and invites the model to "discover" a tool
    // it is already holding, then search again — a round trip each time.
    const result = discoverTools('commit', POOL, new Set(['git-commit']));
    expect(result.granted.map(entry => entry.id)).not.toContain('git-commit');
  });

  it('says plainly when nothing matches, without inviting a retry', () => {
    const result = discoverTools('provision a kubernetes cluster', POOL, new Set());
    expect(result.granted).toEqual([]);
    expect(result.message).toMatch(/no further tools match/i);
    expect(result.message).toMatch(/continue with what you have/i);
    expect(result.message).not.toMatch(/try again|rephrase|error/i);
  });

  it('caps how much one search can add', () => {
    // A broad query must not undo the schema cap in a single call.
    const wide = Array.from({ length: 30 }, (_, index) =>
      skill(`file-tool-${index}`, `File tool ${index}`, 'Work with a file in the workspace.'));
    const result = discoverTools('file', wide, new Set());
    expect(result.granted.length).toBeLessThanOrEqual(5);
  });

  it('refuses a query too short to mean anything', () => {
    expect(discoverTools('a', POOL, new Set()).granted).toEqual([]);
  });

  it('can only reach the pool it is given', () => {
    // Discovery grants nothing on its own: it searches the agent's *eligible*
    // pool, so a tool the agent may not use is not even nameable. Otherwise the
    // model plans around a tool it can never call.
    const restricted = POOL.filter(entry => entry.id.startsWith('git-'));
    const result = discoverTools('fetch a web page', restricted, new Set());
    expect(result.granted).toEqual([]);
  });
});

describe('shouldOfferToolDiscovery', () => {
  it('offers the search only when something was withheld', () => {
    expect(shouldOfferToolDiscovery(40, 24)).toBe(true);
    // Advertising a search guaranteed to return nothing costs a schema and
    // teaches the model to spend a round trip finding that out.
    expect(shouldOfferToolDiscovery(12, 12)).toBe(false);
    expect(shouldOfferToolDiscovery(3, 12)).toBe(false);
  });

  it('never offers the search to a turn that was given no tools', () => {
    // A turn with zero tools has zero on purpose. Change Story mode clears the
    // skill set so a committed-ref answer cannot be contaminated by the
    // checked-out workspace; a search there would let the model reacquire the
    // very tools that mode exists to withhold, against a different revision.
    // Zero is a decision, not a small number.
    expect(shouldOfferToolDiscovery(40, 0)).toBe(false);
  });

  it('has an id that cannot collide with a real skill', () => {
    expect(POOL.some(entry => entry.id === TOOL_DISCOVERY_SKILL_ID)).toBe(false);
  });
});

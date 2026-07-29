import { describe, expect, it } from 'vitest';

import { BUILTIN_AGENT_DEFAULTS } from '../../src/runtime/core.ts';
import { ROUTING_NEED_VALUES } from '../../src/core/classifierService.ts';

/**
 * The three guided-workflow stage owners — `ci-analyst`, `release-manager` and
 * `refactorer` — are addressed by stage ownership, not by the classifier.
 *
 * That only stays true if they keep out of the routing contest, and there are
 * two ways in: declaring `primaryRoutingNeeds` (the dominant scoring term), and
 * accidentally writing a reserved need token into `role` or `description`, which
 * `scoreAgentRoutingNeeds` pattern-matches against. The second is the one a
 * later edit would plausibly reintroduce without noticing.
 */

const STAGE_OWNERS = ['ci-analyst', 'release-manager', 'refactorer'] as const;

const agents = BUILTIN_AGENT_DEFAULTS;
const byId = new Map(agents.map(agent => [agent.id, agent]));

describe('the three stage owners exist and are built in', () => {
  it.each(STAGE_OWNERS)('%s is a built-in agent', id => {
    const agent = byId.get(id);
    expect(agent, `${id} is missing`).toBeDefined();
    expect(agent!.builtIn).toBe(true);
    expect(agent!.name.length).toBeGreaterThan(0);
  });
});

describe('they stay out of the routing contest', () => {
  it.each(STAGE_OWNERS)('%s declares no primary routing needs', id => {
    // The dominant scoring term. Declaring needs would put these in direct
    // contest with github-operator and devops-engineer for work those agents
    // already own.
    expect(byId.get(id)!.primaryRoutingNeeds).toBeUndefined();
  });

  it.each(STAGE_OWNERS)('%s pins no skills', id => {
    // Skills with no routing needs is the exact combination that triggers the
    // skill-pin amplifier, injecting generic tooling prose at double weight.
    expect(byId.get(id)!.skills).toEqual([]);
  });

  it.each(STAGE_OWNERS)('%s avoids reserved routing vocabulary in role and description', id => {
    // The back door: the scorer pattern-matches need ids against role and
    // description, so an agent with no declared needs can still re-enter the
    // contest through its own prose.
    const agent = byId.get(id)!;
    const corpus = `${agent.role} ${agent.description}`.toLowerCase();
    const found = ROUTING_NEED_VALUES.filter(need => new RegExp(`\\b${need}\\b`).test(corpus));
    expect(found, `${id} uses reserved routing tokens: ${found.join(', ')}`).toEqual([]);
  });
});

describe('their prompts encode the constraints the specification relies on', () => {
  it('ci-analyst is told not to re-classify, re-run, or edit a pipeline', () => {
    const prompt = byId.get('ci-analyst')!.systemPrompt.toLowerCase();
    expect(prompt).toContain('do not re-classify');
    expect(prompt).toContain('never re-run');
    expect(prompt).toContain('never edit a pipeline definition');
    // Log excerpts are third-party text; the fence has to be stated here too.
    expect(prompt).toContain('reported content');
  });

  it('release-manager is told notes are the changelog verbatim, and never to publish', () => {
    const prompt = byId.get('release-manager')!.systemPrompt.toLowerCase();
    expect(prompt).toContain('verbatim');
    expect(prompt).toContain('never push, never tag, and never publish');
  });

  it('refactorer is told to record with evidence and propose rather than apply', () => {
    const prompt = byId.get('refactorer')!.systemPrompt.toLowerCase();
    expect(prompt).toContain('record first, propose second');
    expect(prompt).toContain('never apply');
    expect(prompt).toContain('never delete one');
  });

  it.each(STAGE_OWNERS)('%s states completion criteria', id => {
    expect(byId.get(id)!.completionCriteria?.rubric.length).toBeGreaterThan(2);
  });
});

describe('they do not displace the agents that already own routed work', () => {
  it('leaves github-operator holding git, devops and release', () => {
    expect(byId.get('github-operator')!.primaryRoutingNeeds).toEqual(['git', 'devops', 'release']);
  });

  it('adds no duplicate ids', () => {
    const ids = agents.map(agent => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

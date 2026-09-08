import { describe, expect, it } from 'vitest';

import {
  AGENT_CAPACITY_RULES,
  MIN_RUNS_TO_JUDGE_UTILISATION,
  agentUtilisationScore,
  readAgentCapacity,
} from '../../src/core/agentCapacity.ts';

/**
 * Whether the team you configured can work, and whether it is used.
 *
 * The dashboard counted healthy providers and did nothing with the answer:
 * `4/9 providers healthy` sat in a stat card's subtitle, in the same grey as
 * everything else, on a page whose job is to say what needs a person.
 */

const AGENT = (id: string, role: string, enabled = true) => ({ id, name: id, role, enabled });
const PROVIDER = (id: string, healthy: boolean, enabledModels = 3) => ({ id, label: id, healthy, enabledModels });

describe('what stops the team working', () => {
  it('ranks nothing-routable above an unhealthy provider', () => {
    // A provider with no enabled model cannot be reached at all. Reporting it
    // at the weight of a failed health check buries the difference between
    // "degraded" and "cannot work".
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', false, 0), PROVIDER('openai', true, 0)],
    });

    expect(reading.findings[0]?.rule).toBe('nothing-routable');
    expect(reading.findings[0]?.severity).toBe('blocked');
  });

  it('calls every provider failing a stop rather than a degradation', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', false), PROVIDER('openai', false)],
    });

    expect(reading.findings[0]?.rule).toBe('all-providers-unhealthy');
    expect(reading.findings[0]?.severity).toBe('blocked');
  });

  it('names which providers are down when some still work', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', true), PROVIDER('openai', false)],
    });

    expect(reading.findings[0]?.rule).toBe('some-providers-unhealthy');
    expect(reading.findings[0]?.severity).toBe('degraded');
    expect(reading.findings[0]?.detail).toContain('openai');
  });

  it('says nothing when everything is healthy', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', true)],
    });
    expect(reading.findings).toEqual([]);
  });

  it('raises a team with everything switched off', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev', false), AGENT('b', 'test', false)],
      providers: [PROVIDER('anthropic', true)],
    });
    expect(reading.findings.some(finding => finding.rule === 'no-agents-enabled')).toBe(true);
  });

  it('has nothing to say about a project with no providers configured yet', () => {
    // Not the same as every provider being down. Somebody who has not set one
    // up is mid-setup, and the onboarding surfaces already say so.
    const reading = readAgentCapacity({ agents: [], providers: [] });
    expect(reading.findings).toEqual([]);
  });
});

describe('who is not being used', () => {
  const team = [AGENT('writer', 'code-writer'), AGENT('tester', 'tester'), AGENT('docs', 'documentation-writer')];

  it('joins on role, not agent id', () => {
    // A planner subtask runs as an ephemeral agent carrying a role and no
    // registry id. Matching on id would report every agent as idle on a
    // project that runs constantly.
    const reading = readAgentCapacity({
      agents: team,
      providers: [PROVIDER('anthropic', true)],
      observedRoles: ['code-writer', 'tester'],
      runsObserved: 20,
    });

    expect(reading.idleAgents?.map(agent => agent.id)).toEqual(['docs']);
    expect(reading.utilisation).toBeCloseTo(2 / 3, 6);
  });

  it('ignores case and padding in a recorded role', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('writer', 'Code-Writer')],
      providers: [],
      observedRoles: ['  code-writer '],
      runsObserved: 20,
    });
    expect(reading.idleAgents).toEqual([]);
  });

  it('does not count an agent somebody switched off', () => {
    // Disabled is a decision, not a gap. Counting it reports a tidy
    // configuration as a problem.
    const reading = readAgentCapacity({
      agents: [AGENT('writer', 'code-writer'), AGENT('docs', 'documentation-writer', false)],
      providers: [],
      observedRoles: ['code-writer'],
      runsObserved: 20,
    });

    expect(reading.idleAgents).toEqual([]);
    expect(reading.utilisation).toBe(1);
    expect(reading.enabledAgentCount).toBe(1);
  });

  it('reports nothing at all when no history was read', () => {
    // Absent is not empty. A project that has never run has not shown its
    // agents idle — it has shown nothing.
    const reading = readAgentCapacity({ agents: team, providers: [] });

    expect(reading.idleAgents).toBeUndefined();
    expect(reading.utilisation).toBeUndefined();
    expect(reading.findings.some(finding => finding.rule === 'agents-never-used')).toBe(false);
  });

  it('computes utilisation but stays quiet on too little history', () => {
    // The figure is a true statement about what has been seen. Three runs is
    // not evidence that six agents are surplus, and saying so would have
    // somebody switch off a team they are about to need.
    const reading = readAgentCapacity({
      agents: team,
      providers: [],
      observedRoles: ['code-writer'],
      runsObserved: MIN_RUNS_TO_JUDGE_UTILISATION - 1,
    });

    expect(reading.utilisation).toBeCloseTo(1 / 3, 6);
    expect(reading.findings.some(finding => finding.rule === 'agents-never-used')).toBe(false);
  });

  it('speaks up once there is enough history', () => {
    const reading = readAgentCapacity({
      agents: team,
      providers: [],
      observedRoles: ['code-writer'],
      runsObserved: MIN_RUNS_TO_JUDGE_UTILISATION,
    });

    const finding = reading.findings.find(entry => entry.rule === 'agents-never-used');
    expect(finding?.severity).toBe('notice');
    expect(finding?.detail).toContain('tester');
    expect(finding?.detail).toContain('docs');
  });
});

describe('what reaches the score', () => {
  it('is absent, not zero, with no history to judge by', () => {
    // The caller drops the component entirely and the denominator is derived,
    // so a project that has never run is not marked down for being new.
    const reading = readAgentCapacity({ agents: [AGENT('a', 'dev')], providers: [] });
    expect(agentUtilisationScore(reading, 6)).toBeUndefined();
  });

  it('scales with how much of the team has actually worked', () => {
    const reading = readAgentCapacity({
      agents: [AGENT('a', 'dev'), AGENT('b', 'test')],
      providers: [],
      observedRoles: ['dev'],
      runsObserved: 20,
    });

    const component = agentUtilisationScore(reading, 6);
    expect(component?.score).toBe(3);
    expect(component?.detail).toContain('1 of 2 enabled agents');
  });

  it('keeps provider health out of the score entirely', () => {
    // A score that fell because a provider had an outage this morning would
    // recover by lunchtime without anybody doing anything, and a number that
    // moves on its own is one people learn to explain away.
    const healthy = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', true)],
      observedRoles: ['dev'],
      runsObserved: 20,
    });
    const broken = readAgentCapacity({
      agents: [AGENT('a', 'dev')],
      providers: [PROVIDER('anthropic', false, 0)],
      observedRoles: ['dev'],
      runsObserved: 20,
    });

    expect(agentUtilisationScore(broken, 6)).toEqual(agentUtilisationScore(healthy, 6));
    expect(broken.findings.length).toBeGreaterThan(0);
  });

  it('publishes a rule for every finding it can produce', () => {
    const declared = new Set(AGENT_CAPACITY_RULES.map(rule => rule.id));
    const produced = [
      readAgentCapacity({ agents: [AGENT('a', 'dev')], providers: [PROVIDER('p', false, 0)] }),
      readAgentCapacity({ agents: [AGENT('a', 'dev')], providers: [PROVIDER('p', false)] }),
      readAgentCapacity({ agents: [AGENT('a', 'dev')], providers: [PROVIDER('p', true), PROVIDER('q', false)] }),
      readAgentCapacity({ agents: [AGENT('a', 'dev', false)], providers: [] }),
      readAgentCapacity({ agents: [AGENT('a', 'dev')], providers: [], observedRoles: [], runsObserved: 20 }),
    ].flatMap(reading => reading.findings.map(finding => finding.rule));

    expect(produced.length).toBeGreaterThan(0);
    for (const rule of produced) {
      expect(declared.has(rule), `${rule} is produced but not declared`).toBe(true);
    }
  });
});

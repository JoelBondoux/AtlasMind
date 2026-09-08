import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_EVIDENCE_RUNS,
  CAPABILITY_OFFER_RULES,
  commandSignal,
  decideCapabilityOffer,
} from '../../src/core/capabilityOffer.ts';

/**
 * Offering a capability the project is visibly reaching for.
 *
 * A project shelling out to `gh` twenty times is telling you something. The risk
 * in acting on it is that "we noticed you use X, install Y" is how a tool
 * becomes a salesman, so every rule here is shaped to keep the offer rare and
 * honest rather than to make it land.
 */

const CATALOGUE = [
  { id: 'mcp-server-github', name: 'GitHub MCP Server', description: 'Issues, pull requests and repository operations.' },
  { id: 'mcp-server-postgres', name: 'Postgres MCP Server', description: 'Schema and query tools for Postgres.' },
  { id: 'mcp-server-git', name: 'Git MCP Server', description: 'Version control operations.' },
];

function decide(commandsByRun: string[][], overrides: Partial<Parameters<typeof decideCapabilityOffer>[0]> = {}) {
  return decideCapabilityOffer({
    commandsByRun,
    catalogue: CATALOGUE,
    configuredServerIds: [],
    refusedServerIds: [],
    ...overrides,
  });
}

const runsOf = (command: string, count: number) => Array.from({ length: count }, () => [command]);

describe('what counts as evidence', () => {
  it('offers once a command appears in enough separate runs', () => {
    const decision = decide(runsOf('gh pr list', CAPABILITY_EVIDENCE_RUNS));

    expect(decision.offer?.serverId).toBe('mcp-server-github');
    expect(decision.offer?.signal).toBe('gh');
    expect(decision.offer?.runs).toBe(CAPABILITY_EVIDENCE_RUNS);
  });

  it('counts runs, not calls', () => {
    // Ten invocations inside one run is a project doing one thing once.
    // Counting calls would let a single afternoon manufacture a recommendation.
    const oneBusyRun = [Array.from({ length: 10 }, (_, index) => `gh issue view ${index}`)];
    const decision = decide(oneBusyRun);

    expect(decision.offer).toBeUndefined();
    expect(decision.withheld).toContainEqual({ signal: 'gh', rule: 'evidence-threshold' });
  });

  it('stays quiet below the threshold', () => {
    const decision = decide(runsOf('gh pr list', CAPABILITY_EVIDENCE_RUNS - 1));
    expect(decision.offer).toBeUndefined();
  });

  it('has nothing to say about a project that has not run', () => {
    expect(decide([]).offer).toBeUndefined();
    expect(decide([]).withheld).toEqual([]);
  });
});

describe('what is not a gap', () => {
  it('never offers a server for something a skill already covers', () => {
    // Using git is AtlasMind working, not a gap. Offering a git server would
    // recommend a second way to do something that already works, through
    // third-party code.
    const decision = decide(runsOf('git status', 20));

    expect(decision.offer).toBeUndefined();
    expect(decision.withheld).toContainEqual({ signal: 'git', rule: 'covered-by-a-skill' });
  });

  it('ignores a command nothing in the catalogue covers', () => {
    // Silently: a list of every unrecognised command would be noise, and there
    // is no decision attached to it.
    const decision = decide(runsOf('rsync -a a b', 20));
    expect(decision.offer).toBeUndefined();
    expect(decision.withheld).toEqual([]);
  });

  it('does not offer a server already configured, switched on or not', () => {
    const decision = decide(runsOf('gh pr list', 20), { configuredServerIds: ['mcp-server-github'] });

    expect(decision.offer).toBeUndefined();
    expect(decision.withheld).toContainEqual({ signal: 'gh', rule: 'already-configured' });
  });
});

describe('a refusal is final', () => {
  it('never re-raises a server that was declined', () => {
    // On any evidence, however much stronger. An offer that returns when the
    // count rises is a nag with a threshold.
    const decision = decide(runsOf('gh pr list', 500), { refusedServerIds: ['mcp-server-github'] });

    expect(decision.offer).toBeUndefined();
    expect(decision.withheld).toContainEqual({ signal: 'gh', rule: 'refused-before' });
  });

  it('lets a different server through after one is refused', () => {
    const decision = decide(
      [...runsOf('gh pr list', 5), ...runsOf('psql -c "select 1"', 5)],
      { refusedServerIds: ['mcp-server-github'] },
    );

    expect(decision.offer?.serverId).toBe('mcp-server-postgres');
  });
});

describe('one offer, and an honest one', () => {
  it('offers only the best-evidenced candidate', () => {
    // A surface listing four suggestions is a marketplace rather than an
    // observation, and the reader stops treating any of it as a finding.
    const decision = decide([...runsOf('gh pr list', 9), ...runsOf('psql -c "select 1"', 4)]);

    expect(decision.offer?.serverId).toBe('mcp-server-github');
    expect(decision.withheld).toContainEqual({ signal: 'psql', rule: 'one-at-a-time' });
  });

  it('breaks a tie on the signal name so the choice cannot shuffle', () => {
    const first = decide([...runsOf('gh x', 4), ...runsOf('psql x', 4)]);
    const second = decide([...runsOf('psql x', 4), ...runsOf('gh x', 4)]);
    expect(first.offer?.serverId).toBe(second.offer?.serverId);
  });

  it('always says what it costs, not only what it adds', () => {
    // The rule that keeps this an observation rather than advertising: an MCP
    // server publishes its whole tool list into a budget that has been watched
    // to overflow.
    const offer = decide(runsOf('gh pr list', 5)).offer;

    expect(offer?.adds.length).toBeGreaterThan(0);
    expect(offer?.consumes).toMatch(/tool budget/);
    expect(offer?.consumes).toMatch(/cost context rather than save it/);
    expect(offer?.consumes).toMatch(/third-party code/);
    // Never sold as a saving.
    expect(`${offer?.adds} ${offer?.consumes}`).not.toMatch(/\bsave you\b|\bcheaper\b|\bfaster\b/i);
  });

  it('publishes the rules that decided', () => {
    const decision = decide(runsOf('gh x', 5));
    expect(decision.rules).toBe(CAPABILITY_OFFER_RULES);
    const declared = new Set(CAPABILITY_OFFER_RULES.map(rule => rule.id));
    for (const entry of decide(runsOf('git x', 5)).withheld) {
      expect(declared.has(entry.rule)).toBe(true);
    }
  });
});

describe('reading a command line', () => {
  it('takes the executable, without its path or extension', () => {
    expect(commandSignal('/usr/bin/gh pr list')).toBe('gh');
    expect(commandSignal('GH PR LIST')).toBe('gh');
  });

  it('takes a quoted path whole, spaces and all', () => {
    // A Windows path with a space in it is the ordinary case. Splitting on
    // whitespace would yield the signal `program`, which matches nothing and
    // hides a real one.
    expect(commandSignal('"C:\\Program Files\\GitHub CLI\\gh.exe" pr list')).toBe('gh');
    expect(commandSignal("'/opt/My Tools/psql' -c 'select 1'")).toBe('psql');
  });

  it('has no signal for an empty command', () => {
    expect(commandSignal('')).toBeUndefined();
    expect(commandSignal('   ')).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  hasBeenScanned,
  lastRunFor,
  openResearchFindings,
  researchQuestions,
  seedResearchRegister,
  type ResearchHistoryEntry,
  type ResearchRegister,
} from '../../src/core/researchRegister.js';
import { detectResearchSources } from '../../src/core/researchSources.js';
import { runResearchScan, type ResearchRunDeps } from '../../src/core/researchRunner.js';

const NOW = new Date('2026-07-30T12:00:00.000Z');

const WITH_SEARCH = detectResearchSources({
  exaKeyPresent: true, mcpToolIds: [], webFetchEnabled: true, preference: 'auto',
});
const FETCH_ONLY = detectResearchSources({
  exaKeyPresent: false, mcpToolIds: [], webFetchEnabled: true, preference: 'auto',
});
const NO_SOURCE = detectResearchSources({
  exaKeyPresent: false, mcpToolIds: [], webFetchEnabled: false, preference: 'auto',
});

const REPLY = '```json\n' + JSON.stringify({
  findings: [
    { title: 'Acme shipped a planner', detail: 'On their changelog.', citations: [{ url: 'https://acme.test/changelog' }] },
    { title: 'The market feels large', detail: 'No source for this.' },
  ],
}) + '\n```';

function harness(overrides: Partial<ResearchRunDeps> = {}) {
  let register: ResearchRegister = seedResearchRegister(NOW);
  const history: ResearchHistoryEntry[] = [];
  const runAgent = vi.fn(async () => ({ ok: true as const, text: REPLY, costUsd: 0.02 }));
  const deps: ResearchRunDeps = {
    runAgent,
    getRegister: () => register,
    saveRegister: async next => { register = next; },
    appendHistory: async entry => { history.push(entry); },
    sources: WITH_SEARCH,
    projectSummary: 'A VS Code extension that orchestrates agents.',
    roadmapTitles: new Set<string>(),
    now: NOW,
    ...overrides,
  };
  return { deps, history, runAgent, read: () => register };
}

describe('a scan that cannot look never reaches the model', () => {
  it('refuses an external scan with no source, before spending anything', () => {
    const { deps, runAgent, read } = harness({ sources: NO_SOURCE });
    return runResearchScan('competition', deps).then(result => {
      // The assertion this module exists for. Without it, "refuses rather than
      // improvises" is a comment rather than a property.
      expect(runAgent).not.toHaveBeenCalled();
      expect(result.outcome).toBe('no-source');
      expect(result.setupStep).toContain('EXA');
      expect(hasBeenScanned(read(), 'competition')).toBe(false);
      expect(lastRunFor(read(), 'competition')?.outcome).toBe('no-source');
    });
  });

  it('refuses an external scan when the source can only fetch a named page', async () => {
    const { deps, runAgent } = harness({ sources: FETCH_ONLY });
    const result = await runResearchScan('market', deps);
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.outcome).toBe('no-source');
  });

  it('runs a hybrid scan on a fetch-only source, and records the half it could not assess', async () => {
    const { deps, runAgent, read } = harness({ sources: FETCH_ONLY });
    const result = await runResearchScan('feature', deps);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('ok');
    expect(result.unassessed).toContain('found rather than read');
    // Carried into the register, not only into the message on screen.
    expect(lastRunFor(read(), 'feature')?.unassessed).toContain('found rather than read');
  });
});

describe('a completed run', () => {
  it('records cited claims as findings and uncited ones as questions', async () => {
    const { deps, read } = harness();
    const result = await runResearchScan('competition', deps);
    expect(result.outcome).toBe('ok');
    expect(result.findings).toBe(1);
    expect(result.questions).toBe(1);
    expect(openResearchFindings(read())).toHaveLength(1);
    expect(researchQuestions(read())).toHaveLength(1);
  });

  it('says "no source" rather than folding unsourced claims into a zero', async () => {
    const { deps } = harness();
    const result = await runResearchScan('competition', deps);
    expect(result.message).toContain('with no source, kept as question');
  });

  it('reports nothing material when the reply is genuinely empty', async () => {
    const { deps } = harness({ runAgent: async () => ({ ok: true, text: '```json\n{"findings":[]}\n```' }) });
    const result = await runResearchScan('competition', deps);
    expect(result.message).toContain('nothing material found');
  });

  it('names the source and the cost on the record', async () => {
    const { deps, read } = harness();
    await runResearchScan('competition', deps);
    const run = lastRunFor(read(), 'competition')!;
    expect(run.source).toBe('exa');
    expect(run.costUsd).toBe(0.02);
  });

  it('passes the caller roadmap into grading rather than trusting the model', async () => {
    const { deps, read } = harness({ roadmapTitles: new Set(['acme shipped a planner']) });
    await runResearchScan('competition', deps);
    expect(openResearchFindings(read())[0]!.severity).toBe('high');
  });

  it('appends one history entry per run', async () => {
    const { deps, history } = harness();
    await runResearchScan('competition', deps);
    expect(history).toHaveLength(1);
    expect(history[0]!.kind).toBe('scan-run');
  });
});

describe('a failed run is recorded, not swallowed', () => {
  it('keeps the attempt visible while the scan still reads as never answered', async () => {
    const { deps, read } = harness({ runAgent: async () => ({ ok: false, error: 'The provider timed out.' }) });
    const result = await runResearchScan('customer', deps);
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('timed out');
    expect(lastRunFor(read(), 'customer')?.outcome).toBe('failed');
    // Two facts, neither implying the other: something was attempted, and
    // nothing was assessed.
    expect(hasBeenScanned(read(), 'customer')).toBe(false);
  });
});

describe('re-running a scan reconciles rather than duplicating', () => {
  it('does not re-add a claim it already holds, and supersedes what vanished', async () => {
    const { deps, read } = harness();
    await runResearchScan('competition', deps);
    expect(read().findings).toHaveLength(2);

    // A second run that no longer reproduces either claim.
    const second = harness({
      getRegister: () => read(),
      saveRegister: deps.saveRegister,
      runAgent: async () => ({ ok: true, text: '```json\n{"findings":[]}\n```' }),
    });
    const result = await runResearchScan('competition', second.deps);
    expect(result.superseded).toBe(2);
    // Nothing was deleted; both are still on the record.
    expect(read().findings).toHaveLength(2);
  });

  it('does not report a demoted question as new on every run', async () => {
    const { deps, read } = harness();
    await runResearchScan('competition', deps);
    const first = read().findings.length;
    await runResearchScan('competition', {
      ...deps,
      getRegister: () => read(),
    });
    expect(read().findings).toHaveLength(first);
  });
});

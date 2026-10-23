import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

/**
 * "Could not read project memory" must never be read as "project memory is
 * empty" by anything that decides on its own.
 *
 * Since 0.498.1 an ambiguous SSOT home — two folders of a multi-root workspace
 * each holding `project_memory/`, neither declaring itself the home — leaves
 * every register unread on purpose, rather than reading whichever folder VS Code
 * lists first. That is right for a *page*, which says so in a banner. It is
 * wrong for anything that **acts** on what it reads, because to such a consumer
 * an unread register and an empty one look identical — and in every case below
 * "empty" was the answer that let something through: no golden cases releases an
 * unattended prompt rewrite, an empty testing matrix grades a release against a
 * default nobody declared, and a page of zeroes claims nothing needs you.
 *
 * Each row builds a real ambiguous home on disk and asserts the consumer's
 * answer is held / unknown / not-clear — never released / pass / clear. A
 * control row with the home located proves the harness can tell the difference.
 */

vi.mock('../../src/core/modelEgress.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/core/modelEgress.ts')>()),
  // The rewrite the auto-updater would register if the gate let it through.
  dispatchGuardedCompletion: vi.fn(async () => ({
    content: '{"systemPrompt":"A rewritten prompt.","description":"A rewritten description."}',
  })),
}));

const { ssotHomeRoot } = await import('../../src/utils/workspaceRoots.ts');
const { AgentAutoUpdater } = await import('../../src/core/agentAutoUpdater.ts');
const { createAgentUpdateVerifier } = await import('../../src/views/agentEvalRunner.ts');
const { AGENT_EVAL_CASES_PATH } = await import('../../src/core/agentEvalHarness.ts');
const { buildAttentionFeed } = await import('../../src/core/attentionFeed.ts');
const { buildReleasePlan } = await import('../../src/core/releasePreparation.ts');

type Workspace = { workspaceFolders: unknown };
const workspace = vscode.workspace as unknown as Workspace;

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-ambiguous-home-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
/** A folder holding project memory, with this agent's golden cases in it. */
function folderWithCases(): string {
  counter += 1;
  const dir = path.join(scratch, `folder-${counter}`);
  mkdirSync(path.join(dir, path.dirname(AGENT_EVAL_CASES_PATH)), { recursive: true });
  writeFileSync(path.join(dir, AGENT_EVAL_CASES_PATH), JSON.stringify([{
    id: 'mentions-security',
    agentId: 'reviewer',
    prompt: 'Review this change.',
    checks: [{ kind: 'must-contain', value: 'security', describes: 'mentions security' }],
    rationale: 'A reviewer that stops mentioning security has regressed.',
  }]), 'utf8');
  return dir;
}

function folderWithoutMemory(): string {
  counter += 1;
  const dir = path.join(scratch, `folder-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function open(...dirs: string[]): void {
  workspace.workspaceFolders = dirs.map((fsPath, index) => ({
    name: path.basename(fsPath),
    index,
    uri: { scheme: 'file', fsPath },
  }));
}

/** Two folders each with project memory and neither declaring the home. */
function openAmbiguous(): string {
  open(folderWithCases(), folderWithCases());
  const refusal = ssotHomeRoot().refusal;
  expect(refusal, 'the fixture must actually be ambiguous').toBeDefined();
  return refusal!;
}

beforeEach(() => {
  workspace.workspaceFolders = undefined;
});

const reviewer = {
  id: 'reviewer',
  name: 'Reviewer',
  role: 'code reviewer',
  description: 'Reviews code.',
  systemPrompt: 'You review code and always consider security.',
  skills: [],
} as unknown as import('../../src/types.ts').AgentDefinition;

function buildUpdater() {
  const register = vi.fn();
  const save = vi.fn(async () => undefined);
  const router = {
    selectModel: () => 'local/model',
    getModelInfo: () => undefined,
  } as unknown as import('../../src/core/modelRouter.ts').ModelRouter;
  const providers = {
    get: () => ({ providerId: 'local' }),
  } as unknown as import('../../src/providers/registry.ts').ProviderRegistry;
  const profiler = {
    profileTask: () => ({}),
  } as unknown as import('../../src/core/taskProfiler.ts').TaskProfiler;
  const verifier = createAgentUpdateVerifier({
    agents: { listAgents: () => [reviewer] } as unknown as import('../../src/core/agentRegistry.ts').AgentRegistry,
    router,
    providers,
    // Exactly what the host passes.
    ssotHome: () => ssotHomeRoot(),
  });
  const updater = new AgentAutoUpdater(
    { register } as unknown as import('../../src/core/agentRegistry.ts').AgentRegistry,
    router,
    providers,
    profiler,
    save,
    () => 'every-use',
    verifier,
  );
  return { updater, register, save, verifier };
}

describe('the unattended agent rewrite (agentAutoUpdater + eval gate)', () => {
  it('holds the rewrite when the home is ambiguous, even though a candidate folder holds cases for the agent', async () => {
    const refusal = openAmbiguous();
    const { updater, register, save, verifier } = buildUpdater();

    expect(verifier.declaredCaseCount('reviewer')).toEqual({ unreadable: expect.stringContaining(refusal) });

    const result = await updater.maybeUpdate(reviewer);
    expect(result).toBe(reviewer);
    expect(register).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    const held = updater.heldUpdate('reviewer');
    expect(held?.hold).toBe(true);
    expect(held?.reason).toBe('cases-unreadable');
    expect(held?.detail).toContain(refusal);
  });

  it('holds when the cases file is there and unreadable, rather than treating it as none', async () => {
    const dir = folderWithoutMemory();
    mkdirSync(path.join(dir, path.dirname(AGENT_EVAL_CASES_PATH)), { recursive: true });
    writeFileSync(path.join(dir, AGENT_EVAL_CASES_PATH), '{ not json', 'utf8');
    open(dir);
    const { updater, register } = buildUpdater();
    await updater.maybeUpdate(reviewer);
    expect(register).not.toHaveBeenCalled();
    expect(updater.heldUpdate('reviewer')?.reason).toBe('cases-unreadable');
  });

  it('holds when counting the cases throws', async () => {
    open(folderWithoutMemory());
    const { register } = buildUpdater();
    const updater = new AgentAutoUpdater(
      { register } as unknown as import('../../src/core/agentRegistry.ts').AgentRegistry,
      { selectModel: () => 'local/model', getModelInfo: () => undefined } as never,
      { get: () => ({ providerId: 'local' }) } as never,
      { profileTask: () => ({}) } as never,
      async () => undefined,
      () => 'every-use',
      { declaredCaseCount: () => { throw new Error('disk on fire'); }, verify: async () => undefined },
    );
    await updater.maybeUpdate(reviewer);
    expect(register).not.toHaveBeenCalled();
    expect(updater.heldUpdate('reviewer')?.detail).toContain('disk on fire');
  });

  it('control: a located home that declares no cases releases the rewrite, and says nothing verified it', async () => {
    open(folderWithoutMemory());
    const { updater, register } = buildUpdater();
    const result = await updater.maybeUpdate(reviewer);
    expect(result).not.toBe(reviewer);
    expect(register).toHaveBeenCalledTimes(1);
    expect(updater.heldUpdate('reviewer')).toBeUndefined();
  });
});

describe('the release gate on the declared testing policy', () => {
  it('is unknown when the matrix could not be read, even with every methodology evidenced and a clean report', () => {
    const refusal = openAmbiguous();
    const plan = buildReleasePlan({
      currentVersion: '1.2.0',
      changelog: '# Changelog\n\n## [1.2.0] - 2026-10-08\n\n### Fixed\n- Something.\n',
      existingTags: ['v1.1.0'],
      lastReleasedVersion: '1.1.0',
      commitSubjects: ['fix: something'],
      workingTreeClean: true,
      ciConclusion: 'success',
      testingEvidence: { assessable: 2, evidenced: 2, unevidenced: [], hasReport: true, failing: 0 },
      testingPolicyUnreadable: refusal,
    });
    const gate = plan.gates.find(entry => entry.id === 'tests-evidenced');
    expect(gate?.status).toBe('unknown');
    expect(gate?.detail).toContain(refusal);
    expect(plan.ready).toBe(false);
  });

  it('still fails a release whose report has failures — those are counted from the report, not the policy', () => {
    const plan = buildReleasePlan({
      currentVersion: '1.2.0',
      testingEvidence: { assessable: 0, evidenced: 0, unevidenced: [], hasReport: true, failing: 3 },
      testingPolicyUnreadable: 'unreadable',
    });
    expect(plan.gates.find(entry => entry.id === 'tests-evidenced')?.status).toBe('fail');
  });
});

describe('the testing coverage the release gate reads', () => {
  it('is derived against no methodology — never the two defaults — and says why, when the home is ambiguous', async () => {
    const refusal = openAmbiguous();
    const { collectTestingDashboardSnapshot } = await import('../../src/views/settingsPanel.ts');
    const snapshot = collectTestingDashboardSnapshot();
    expect(snapshot.policyUnreadable).toBe(refusal);
    expect(snapshot.policyCoverage.rows).toEqual([]);
  });

  it('reads a performance capture from the located policy home, not the first folder', async () => {
    const first = folderWithoutMemory();
    const home = folderWithCases();
    mkdirSync(path.join(home, 'project_memory', 'index'), { recursive: true });
    writeFileSync(path.join(home, 'project_memory', 'index', 'testing-config.json'), JSON.stringify({
      version: 1, updatedAt: '2026-10-18T00:00:00.000Z', methodologies: [{ id: 'performance', enabled: true }],
    }));
    for (const [root, value] of [[first, 99], [home, 17]] as const) {
      mkdirSync(path.join(root, 'test-results'), { recursive: true });
      writeFileSync(path.join(root, 'test-results', 'performance.json'), JSON.stringify({
        version: 1, capturedAt: '2026-10-18T00:00:00.000Z', target: 'windows',
        measurements: [{ scenario: 'scene', metric: 'frameTimeMs', statistic: 'p95', value, sampleCount: 60 }],
      }));
    }
    open(first, home);
    const { collectTestingDashboardSnapshot } = await import('../../src/views/settingsPanel.ts');
    const evidence = collectTestingDashboardSnapshot().policyCoverage.rows.find(row => row.id === 'performance')?.performanceReport;
    expect(evidence?.status).toBe('measured');
    if (evidence?.status !== 'measured') { throw new Error('the home capture was not read'); }
    expect(evidence.measurements[0]?.value).toBe(17);
  });

  it('control: a located home with no matrix still gets the two defaults', async () => {
    open(folderWithoutMemory());
    const { collectTestingDashboardSnapshot } = await import('../../src/views/settingsPanel.ts');
    const snapshot = collectTestingDashboardSnapshot();
    expect(snapshot.policyUnreadable).toBeUndefined();
    expect(snapshot.policyCoverage.rows.map(row => row.id).sort()).toEqual(['tdd', 'unit']);
  });
});

describe('the Overview attention feed', () => {
  /** What the dashboard's mapping produces from refused registers: zeroes everywhere. */
  const zeroes = {
    testing: { failing: 0, hasReport: true, uncovered: 0 },
    pipeline: { latestFailed: false, loaded: true },
    issues: { loaded: true, stale: 0, unassigned: 0 },
    capacity: {},
    ssot: { blocked: 0, warned: 0 },
    director: { overdue: 0 },
    documents: { reviewDue: 0, missing: 0 },
    risk: { assessed: false, open: 0 },
    debt: { scanned: false, open: 0, high: 0 },
    research: { due: 0, neverScanned: 7, blocked: 0 },
    scheduledRoutines: { failed: 0, needsYou: 0, changed: 0 },
    release: { blockedGates: 0 },
    delivery: { blockedPaths: 0 },
    workflow: { nextStepBlocked: false },
  };

  it('never reads as clear, and says project memory could not be read', () => {
    const refusal = openAmbiguous();
    const feed = buildAttentionFeed({ ...zeroes, projectMemoryUnreadable: { reason: refusal } });
    expect(feed.emptyState).toBeUndefined();
    expect(feed.items[0]?.id).toBe('project-memory-unreadable');
    expect(feed.items[0]?.detail).toContain(refusal);
    expect(feed.summary).not.toBe('Nothing needs you right now.');
  });

  it('states nothing about a register it did not read', () => {
    // "Risk never assessed" from a risk register nobody opened would be false.
    const feed = buildAttentionFeed({ ...zeroes, projectMemoryUnreadable: { reason: 'r' } });
    const ids = feed.items.map(item => item.id);
    expect(ids).not.toContain('risk-never-assessed');
    expect(ids).not.toContain('debt-never-scanned');
    expect(ids.some(id => id.startsWith('research'))).toBe(false);
  });

  it('control: the same zeroes with project memory read are findings, not silence', () => {
    const feed = buildAttentionFeed(zeroes);
    expect(feed.items.map(item => item.id)).toContain('risk-never-assessed');
    expect(feed.items.map(item => item.id)).not.toContain('project-memory-unreadable');
  });
});

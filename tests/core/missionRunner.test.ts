import { describe, expect, it, vi } from 'vitest';
import {
  MissionRunner,
  accumulatedSummary,
  buildIncrementGoal,
  computeCheckpointReason,
  detectSettingBlocker,
  worstTddStatus,
} from '../../src/core/missionRunner.ts';
import type {
  MissionExecutor,
  MissionPlannerLike,
  MissionBudgetStore,
  MissionPersistence,
} from '../../src/core/missionRunner.ts';
import type { MissionConfig, ProjectPlan, ProjectResult, SubTaskResult } from '../../src/types.ts';

// ── Fakes ────────────────────────────────────────────────────────

function fakePlan(id = 'p'): ProjectPlan {
  return { id, goal: 'g', subTasks: [{ id: 'a', title: 'A', description: '', role: 'general-assistant', skills: [], dependsOn: [] }] };
}

function fakeProjectResult(over: Partial<ProjectResult> = {}): ProjectResult {
  return {
    id: 'r',
    goal: 'g',
    subTaskResults: [],
    synthesis: 'did some work',
    totalCostUsd: 0.1,
    totalDurationMs: 5,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    ...over,
  };
}

interface Harness {
  runner: MissionRunner;
  saves: number;
  plans: number;
  executes: number;
  evaluatorResponses: string[];
}

function makeHarness(opts: {
  verdicts: string[];
  projectResults?: () => ProjectResult;
  daily?: { blocked: boolean; reason?: string };
}): Harness {
  const state = { saves: 0, plans: 0, executes: 0, evaluatorResponses: [] as string[] };
  let verdictIdx = 0;

  const executor: MissionExecutor = {
    async processProject() {
      state.executes += 1;
      return (opts.projectResults ?? fakeProjectResult)();
    },
    async summarizeText(_system, user) {
      // The runner uses summarizeText for BOTH the evaluator and the final report.
      // Heuristic: evaluator prompts ask for "the JSON verdict"; reports do not.
      if (user.includes('Return the JSON verdict')) {
        const v = opts.verdicts[Math.min(verdictIdx, opts.verdicts.length - 1)] ?? '{"verdict":"stalled","confidence":0}';
        verdictIdx += 1;
        state.evaluatorResponses.push(v);
        return v;
      }
      return 'Final report.';
    },
  };

  const planner: MissionPlannerLike = {
    async plan() {
      state.plans += 1;
      return fakePlan();
    },
  };

  const costs: MissionBudgetStore = {
    getDailyBudgetStatus: () => opts.daily,
  };

  const registry: MissionPersistence = {
    async save() {
      state.saves += 1;
    },
  };

  return {
    runner: new MissionRunner(executor, planner, costs, registry),
    get saves() { return state.saves; },
    get plans() { return state.plans; },
    get executes() { return state.executes; },
    get evaluatorResponses() { return state.evaluatorResponses; },
  };
}

function makeConfig(over: Partial<MissionConfig> = {}, budgetOver: Partial<MissionConfig['budget']> = {}): MissionConfig {
  return {
    id: 'mission-test',
    goal: 'Build the thing',
    guardrails: { instructions: [] },
    budget: {
      maxIterations: 5,
      maxCostUsd: 100,
      maxTokens: 10_000_000,
      maxDurationMs: 60_000,
      maxConsecutiveNoProgress: 2,
      ...budgetOver,
    },
    checkpointPolicy: {},
    constraints: { budget: 'balanced', speed: 'balanced' },
    allowDiscovery: true,
    ...over,
  };
}

// ── Termination ──────────────────────────────────────────────────

describe('MissionRunner.run — termination', () => {
  it('stops with goal-achieved when the evaluator is achieved + confident', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"achieved","confidence":0.95,"remaining":[],"nextFocus":"","rationale":"done"}'] });
    const result = await h.runner.run(makeConfig());
    expect(result.stopReason).toBe('goal-achieved');
    expect(result.achieved).toBe(true);
    expect(result.iterations).toHaveLength(1);
  });

  it('does NOT accept a low-confidence achieved verdict (keeps looping until a cap)', async () => {
    const lowConf = '{"verdict":"achieved","confidence":0.2,"remaining":[],"nextFocus":"x","rationale":"maybe"}';
    const h = makeHarness({ verdicts: [lowConf, lowConf, lowConf] });
    const result = await h.runner.run(makeConfig({}, { maxIterations: 2 }), { goalConfidenceThreshold: 0.7 });
    expect(result.achieved).toBe(false);
    expect(result.stopReason).toBe('max-iterations');
  });

  it('stops with max-iterations when the cap is reached without achievement', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"progressing","confidence":0.6,"remaining":["more"],"nextFocus":"more","rationale":"r"}'] });
    const result = await h.runner.run(makeConfig({}, { maxIterations: 3 }));
    expect(result.stopReason).toBe('max-iterations');
    expect(result.iterations).toHaveLength(3);
  });

  it('stops with no-progress after consecutive stalled iterations', async () => {
    const stalled = '{"verdict":"stalled","confidence":0.3,"remaining":[],"nextFocus":"","rationale":"stuck"}';
    const h = makeHarness({ verdicts: [stalled, stalled, stalled, stalled] });
    const result = await h.runner.run(makeConfig({}, { maxConsecutiveNoProgress: 2, maxIterations: 10 }));
    expect(result.stopReason).toBe('no-progress');
    expect(result.iterations).toHaveLength(2);
  });

  it('stops with blocked when the evaluator reports blocked', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"blocked","confidence":0.8,"remaining":["needs creds"],"nextFocus":"","rationale":"blocked"}'] });
    const result = await h.runner.run(makeConfig());
    expect(result.stopReason).toBe('blocked');
    expect(result.achieved).toBe(false);
  });

  it('stops with budget-exhausted when cumulative cost exceeds the cap', async () => {
    const h = makeHarness({
      verdicts: ['{"verdict":"progressing","confidence":0.6,"remaining":["x"],"nextFocus":"x","rationale":"r"}'],
      projectResults: () => fakeProjectResult({ totalCostUsd: 1.0 }),
    });
    const result = await h.runner.run(makeConfig({}, { maxCostUsd: 1.5, maxIterations: 10 }));
    // iter1 spends 1.0 (< 1.5, runs), iter2 pre-check sees 1.0 < 1.5 runs → 2.0, iter3 pre-check 2.0 >= 1.5 → stop
    expect(result.stopReason).toBe('budget-exhausted');
    expect(result.totalCostUsd).toBeGreaterThanOrEqual(1.5);
  });

  it('stops with token-exhausted when cumulative tokens exceed the cap', async () => {
    const h = makeHarness({
      verdicts: ['{"verdict":"progressing","confidence":0.6,"remaining":["x"],"nextFocus":"x","rationale":"r"}'],
      projectResults: () => fakeProjectResult({ totalInputTokens: 600, totalOutputTokens: 600 }),
    });
    const result = await h.runner.run(makeConfig({}, { maxTokens: 1500, maxIterations: 10 }));
    expect(result.stopReason).toBe('token-exhausted');
  });

  it('stops with budget-exhausted when the daily budget gate is blocked', async () => {
    const h = makeHarness({
      verdicts: ['{"verdict":"progressing","confidence":0.6}'],
      daily: { blocked: true, reason: 'daily limit' },
    });
    const result = await h.runner.run(makeConfig());
    expect(result.stopReason).toBe('budget-exhausted');
    expect(result.iterations).toHaveLength(0);
    expect(h.executes).toBe(0);
  });
});

// ── Recoverable setting block (blockedGate) ──────────────────────

const TERMINAL_BLOCK_OUTPUT = 'Terminal write commands are disabled. Enable atlasmind.allowTerminalWrite to permit them.';

function blockedSubtask(): SubTaskResult {
  return { subTaskId: 's', title: 'Run tests', status: 'completed', output: TERMINAL_BLOCK_OUTPUT, costUsd: 0.1, durationMs: 1 };
}

describe('MissionRunner.run — recoverable setting block', () => {
  it('asks the blockedGate and continues the loop when the user overrides', async () => {
    let execCount = 0;
    const h = makeHarness({
      verdicts: [
        '{"verdict":"blocked","confidence":0.8,"remaining":["run tests"],"nextFocus":"run tests","rationale":"blocked by setting"}',
        '{"verdict":"progressing","confidence":0.6,"remaining":["more"],"nextFocus":"more","rationale":"ok"}',
      ],
      projectResults: () => {
        execCount += 1;
        return execCount === 1
          ? fakeProjectResult({ subTaskResults: [blockedSubtask()] })
          : fakeProjectResult();
      },
    });
    const gate = vi.fn(async () => 'override-once' as const);
    const result = await h.runner.run(makeConfig({}, { maxIterations: 3 }), { hooks: { blockedGate: gate } });
    // iter1 blocked → override → continue; iter2/3 progress → runs to the cap.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('max-iterations');
    expect(result.iterations).toHaveLength(3);
  });

  it('stops with blocked when the user declines (gate returns stop)', async () => {
    const h = makeHarness({
      verdicts: ['{"verdict":"blocked","confidence":0.8,"remaining":[],"nextFocus":"","rationale":"blocked by setting"}'],
      projectResults: () => fakeProjectResult({ subTaskResults: [blockedSubtask()] }),
    });
    const gate = vi.fn(async () => 'stop' as const);
    const result = await h.runner.run(makeConfig({}, { maxIterations: 5 }), { hooks: { blockedGate: gate } });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('blocked');
    expect(result.iterations).toHaveLength(1);
  });

  it('does not prompt when the block is not a recognized setting restriction', async () => {
    const gate = vi.fn(async () => 'override-once' as const);
    const h = makeHarness({
      verdicts: ['{"verdict":"blocked","confidence":0.8,"remaining":[],"nextFocus":"","rationale":"needs credentials"}'],
    });
    const result = await h.runner.run(makeConfig(), { hooks: { blockedGate: gate } });
    expect(gate).not.toHaveBeenCalled();
    expect(result.stopReason).toBe('blocked');
  });

  it('does not re-prompt for the same setting after one override', async () => {
    const h = makeHarness({
      verdicts: ['{"verdict":"blocked","confidence":0.8,"remaining":[],"nextFocus":"","rationale":"blocked by setting"}'],
      projectResults: () => fakeProjectResult({ subTaskResults: [blockedSubtask()] }),
    });
    const gate = vi.fn(async () => 'override-once' as const);
    const result = await h.runner.run(makeConfig({}, { maxIterations: 5 }), { hooks: { blockedGate: gate } });
    // iter1 override → continue; iter2 still signals block but already overridden → stop, no second prompt.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe('blocked');
    expect(result.iterations).toHaveLength(2);
  });
});

describe('detectSettingBlocker', () => {
  it('detects the terminal-write block from subtask output', () => {
    const blocker = detectSettingBlocker([blockedSubtask()]);
    expect(blocker?.configKey).toBe('allowTerminalWrite');
    expect(blocker?.settingsCommand).toBe('atlasmind.openSettingsSafety');
  });

  it('detects from a tool-call result preview', () => {
    const result: SubTaskResult = {
      subTaskId: 's', title: 'T', status: 'completed', output: 'all good', costUsd: 0, durationMs: 0,
      artifacts: { output: '', outputPreview: '', toolCallCount: 1, checkpointedTools: [], changedFiles: [], toolCalls: [{ toolName: 'terminal-run', durationMs: 1, checkpointed: false, resultPreview: TERMINAL_BLOCK_OUTPUT }] },
    };
    expect(detectSettingBlocker([result])?.configKey).toBe('allowTerminalWrite');
  });

  it('detects from the iteration synthesis', () => {
    expect(detectSettingBlocker([], 'tests blocked by atlasmind.allowTerminalWrite restriction')?.configKey).toBe('allowTerminalWrite');
  });

  it('returns undefined when nothing matches', () => {
    expect(detectSettingBlocker([{ subTaskId: 's', title: 'T', status: 'completed', output: 'done cleanly', costUsd: 0, durationMs: 0 }])).toBeUndefined();
    expect(detectSettingBlocker([])).toBeUndefined();
  });
});

// ── Cancellation ─────────────────────────────────────────────────

describe('MissionRunner.run — cancellation', () => {
  it('stops with cancelled when the signal is already aborted', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"progressing","confidence":0.6}'] });
    const controller = new AbortController();
    controller.abort();
    const result = await h.runner.run(makeConfig(), { signal: controller.signal });
    expect(result.stopReason).toBe('cancelled');
    expect(h.executes).toBe(0);
  });
});

// ── Checkpoints (hybrid autonomy, deny-by-default) ───────────────

describe('MissionRunner.run — checkpoints', () => {
  it('stops at a scheduled checkpoint when the gate denies', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"progressing","confidence":0.6,"remaining":["x"],"nextFocus":"x","rationale":"r"}'] });
    const gate = vi.fn(async () => false);
    const result = await h.runner.run(
      makeConfig({ checkpointPolicy: { everyNIterations: 1 } }, { maxIterations: 5 }),
      { hooks: { checkpointGate: gate } },
    );
    // everyNIterations=1 fires on iteration 2 (after 1 completed). iter1 runs, iter2 checkpoint denied.
    expect(result.stopReason).toBe('stopped-by-user');
    expect(result.iterations).toHaveLength(1);
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('continues past a scheduled checkpoint when the gate approves', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"progressing","confidence":0.6,"remaining":["x"],"nextFocus":"x","rationale":"r"}'] });
    const gate = vi.fn(async () => true);
    const result = await h.runner.run(
      makeConfig({ checkpointPolicy: { everyNIterations: 1 } }, { maxIterations: 3 }),
      { hooks: { checkpointGate: gate } },
    );
    expect(result.stopReason).toBe('max-iterations');
    expect(result.iterations).toHaveLength(3);
    expect(gate).toHaveBeenCalled();
  });

  it('denies (stops) when the gate hook throws', async () => {
    const h = makeHarness({ verdicts: ['{"verdict":"progressing","confidence":0.6}'] });
    const result = await h.runner.run(
      makeConfig({ checkpointPolicy: { everyNIterations: 1 } }, { maxIterations: 5 }),
      { hooks: { checkpointGate: async () => { throw new Error('gate crashed'); } } },
    );
    expect(result.stopReason).toBe('stopped-by-user');
  });
});

// ── Verification weighting via the runner ────────────────────────

describe('MissionRunner.run — verification guard', () => {
  it('keeps looping when the model claims achieved but verification is blocked', async () => {
    const subTaskResults: SubTaskResult[] = [
      {
        subTaskId: 's', title: 'T', status: 'completed', output: 'x', costUsd: 0.1, durationMs: 1,
        artifacts: { output: 'x', outputPreview: 'x', toolCallCount: 2, toolCalls: [], checkpointedTools: [], changedFiles: [], tddStatus: 'blocked' },
      },
    ];
    const h = makeHarness({
      verdicts: ['{"verdict":"achieved","confidence":0.99,"remaining":[],"nextFocus":"x","rationale":"done"}'],
      projectResults: () => fakeProjectResult({ subTaskResults }),
    });
    const result = await h.runner.run(
      makeConfig({}, { maxIterations: 1 }),
      { captureChangedFiles: async () => [{ relativePath: 'src/a.ts', status: 'modified' }] },
    );
    // achieved was downgraded → not accepted → ran to the iteration cap instead.
    expect(result.achieved).toBe(false);
    expect(result.stopReason).toBe('max-iterations');
  });
});

// ── Pure helpers ─────────────────────────────────────────────────

describe('computeCheckpointReason', () => {
  it('fires on the iteration cadence (not on iteration 1)', () => {
    const cfg = makeConfig({ checkpointPolicy: { everyNIterations: 2 } });
    const crossed = new Set<number>();
    expect(computeCheckpointReason(1, 0, cfg, crossed)).toBeUndefined();
    expect(computeCheckpointReason(2, 0, cfg, crossed)).toBeUndefined();
    expect(computeCheckpointReason(3, 0, cfg, crossed)).toContain('Scheduled checkpoint');
  });

  it('fires once when spend crosses a budget fraction', () => {
    const cfg = makeConfig({ checkpointPolicy: { atBudgetFractions: [0.5] } }, { maxCostUsd: 10 });
    const crossed = new Set<number>();
    expect(computeCheckpointReason(2, 4, cfg, crossed)).toBeUndefined();
    expect(computeCheckpointReason(3, 6, cfg, crossed)).toContain('50%');
    // Already crossed — does not fire again.
    expect(computeCheckpointReason(4, 7, cfg, crossed)).toBeUndefined();
  });
});

describe('buildIncrementGoal', () => {
  it('includes guardrails, success criteria, and the next focus', () => {
    const cfg = makeConfig({
      successCriteria: ['all tests pass'],
      guardrails: { instructions: ['do not touch auth'], protectedPaths: ['src/auth/'] },
    });
    const goal = buildIncrementGoal(cfg, { verdict: 'progressing', confidence: 0.5, remaining: ['write tests'], nextFocus: 'add tests', rationale: 'r' }, 'iter1 done');
    expect(goal).toContain('Overall goal: Build the thing');
    expect(goal).toContain('all tests pass');
    expect(goal).toContain('do not touch auth');
    expect(goal).toContain('src/auth/');
    expect(goal).toContain('add tests');
    expect(goal).toContain('iter1 done');
    expect(goal).toContain('guarded delivery pipeline');
  });
});

describe('worstTddStatus', () => {
  const st = (tddStatus?: 'verified' | 'blocked' | 'missing' | 'not-applicable', toolCallCount = 0): SubTaskResult => ({
    subTaskId: 's', title: 'T', status: 'completed', output: '', costUsd: 0, durationMs: 0,
    artifacts: { output: '', outputPreview: '', toolCallCount, toolCalls: [], checkpointedTools: [], changedFiles: [], tddStatus },
  });

  it('returns blocked when any subtask is blocked', () => {
    expect(worstTddStatus([st('verified'), st('blocked')])).toBe('blocked');
  });
  it('returns missing when any subtask is missing and none blocked', () => {
    expect(worstTddStatus([st('verified'), st('missing')])).toBe('missing');
  });
  it('returns verified when at least one verified and none blocked/missing', () => {
    expect(worstTddStatus([st('verified'), st('not-applicable')])).toBe('verified');
  });
  it('returns not-applicable when nothing verifiable happened', () => {
    expect(worstTddStatus([st('not-applicable')])).toBe('not-applicable');
  });
});

describe('accumulatedSummary', () => {
  it('returns empty string with no iterations', () => {
    expect(accumulatedSummary([])).toBe('');
  });
});

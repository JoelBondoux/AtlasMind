import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DryRunLedger } from '../../src/core/dryRun.ts';
import { DryRunHost, installDryRunHost } from '../../src/core/dryRunHost.ts';
import { RoutineScheduler, type RoutineSchedulerDeps } from '../../src/core/routineScheduler.ts';
import { RoutineRunner } from '../../src/core/routineRunner.ts';
import { routineScheduleFingerprint, type ScheduledRoutineState } from '../../src/core/routineSchedule.ts';
import type { RoutineDefinition, RoutineRunResult } from '../../src/types.ts';

const ROOT = path.join('/', 'repo');
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

const ROUTINE: RoutineDefinition = {
  id: 'deps',
  name: 'Dependency check',
  description: '',
  schedule: 'daily at 02:00',
  steps: [
    { id: 'outdated', label: 'List outdated', run: 'npm outdated', on_fail: 'continue' },
    { id: 'update', label: 'Update', run: 'npm update', on_fail: 'abort' },
    { id: 'test', label: 'Test', run: 'npm test', on_fail: 'abort' },
  ],
};

let dryRun = false;
let ledger: DryRunLedger;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  dryRun = false;
  ledger = new DryRunLedger();
  uninstall = installDryRunHost(new DryRunHost({ isEnabled: () => dryRun, record: record => ledger.record(record) }));
});

afterEach(() => {
  uninstall?.();
});

interface Harness {
  scheduler: RoutineScheduler;
  state: () => ScheduledRoutineState;
  git: Array<{ args: string[]; cwd: string }>;
  runs: Array<{ cwd: string; commands: string[]; status: string; notRun: string[] }>;
  reports: string[];
}

function harness(options: {
  routine?: RoutineDefinition;
  enabled?: boolean;
  trusted?: boolean;
  approved?: boolean;
  now?: Date;
  /** Throw from `git worktree add`. */
  worktreeFails?: boolean;
  /** What `git status --porcelain` says inside the worktree. */
  worktreeStatus?: string;
  runResult?: Partial<RoutineRunResult>;
} = {}): Harness {
  const routine = options.routine ?? ROUTINE;
  let stored: unknown = options.approved === false ? undefined : {
    version: 1,
    approvals: { [routine.id]: { fingerprint: routineScheduleFingerprint(routine), approvedAt: at(2026, 10, 1, 12).toISOString() } },
    runs: {},
  };
  const git: Harness['git'] = [];
  const runs: Harness['runs'] = [];
  const reports: string[] = [];
  const deps: RoutineSchedulerDeps = {
    listRoutines: () => [routine],
    isEnabled: () => options.enabled ?? true,
    isWorkspaceTrusted: () => options.trusted ?? true,
    workspaceRoot: () => ROOT,
    readState: () => stored,
    writeState: state => { stored = JSON.parse(JSON.stringify(state)); },
    runGit: async (args, cwd) => {
      git.push({ args: [...args], cwd });
      if (args[0] === 'worktree' && args[1] === 'add' && options.worktreeFails) {
        throw new Error('fatal: not a git repository');
      }
      if (args[0] === 'status') {
        return options.worktreeStatus ?? '';
      }
      if (args[0] === 'rev-parse') {
        return 'abc123def4567890\n';
      }
      return '';
    },
    runRoutine: async (r, plan, cwd, record) => {
      runs.push({
        cwd,
        commands: plan.status === 'ready' ? plan.steps.map(entry => entry.command) : [],
        status: plan.status,
        notRun: (record.notRun ?? []).map(entry => entry.label),
      });
      return {
        routineId: r.id,
        routineName: r.name,
        steps: [],
        succeeded: plan.status === 'ready',
        durationMs: 1,
        ...options.runResult,
      };
    },
    report: message => { reports.push(message); },
    now: () => options.now ?? at(2026, 10, 8, 2, 1),
  };
  return {
    scheduler: new RoutineScheduler(deps),
    state: () => stored as ScheduledRoutineState,
    git,
    runs,
    reports,
  };
}

describe('nothing runs unless everybody who decides has said yes', () => {
  it('runs nothing when scheduling is switched off', async () => {
    const h = harness({ enabled: false });
    expect(await h.scheduler.tick()).toBeUndefined();
    expect(h.git).toEqual([]);
    expect(h.runs).toEqual([]);
  });

  it('runs nothing that was never approved, or that changed since', async () => {
    expect(await harness({ approved: false }).scheduler.tick()).toBeUndefined();
    const h = harness();
    // Edit a step after approval: the approval no longer covers it.
    const edited = { ...ROUTINE, steps: [...ROUTINE.steps, { id: 'x', label: 'x', run: 'node x.js', on_fail: 'abort' as const }] };
    const stale = harness({ routine: edited });
    stale.state().approvals[edited.id] = h.state().approvals[ROUTINE.id]!;
    expect(await stale.scheduler.tick()).toBeUndefined();
    expect(stale.runs).toEqual([]);
  });

  it('runs nothing in an untrusted workspace', async () => {
    const h = harness({ trusted: false });
    expect(await h.scheduler.tick()).toBeUndefined();
    expect(h.runs).toEqual([]);
  });
});

describe('a dry run is recorded, not executed', () => {
  it('makes no worktree, runs no step, and leaves a record', async () => {
    dryRun = true;
    const h = harness();
    const memo = await h.scheduler.tick();
    expect(memo?.outcome).toBe('dry-run');
    expect(h.git).toEqual([]);
    expect(h.runs).toEqual([]);
    expect(ledger.list()).toHaveLength(1);
    expect(ledger.list()[0]!.argsPreview).toContain('deps');
    // A timer's write: recorded, not announced.
    expect(h.reports).toEqual([]);
    // The window is closed, so the next tick does not record it again.
    expect(await h.scheduler.tick()).toBeUndefined();
    expect(ledger.list()).toHaveLength(1);
  });
});

describe('a scheduled run happens in a worktree of its own, and only there', () => {
  it('makes a new branch in a new worktree and runs the steps there, never in the working tree', async () => {
    const h = harness();
    const memo = await h.scheduler.tick();
    const add = h.git.find(call => call.args[0] === 'worktree' && call.args[1] === 'add')!;
    expect(add.args).toEqual(['worktree', 'add', '-b', 'chore/scheduled-deps-2026-10-08', expect.stringContaining('atlasmind-worktrees'), 'HEAD']);
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]!.cwd).toBe(add.args[4]);
    expect(h.runs[0]!.cwd).not.toBe(ROOT);
    // It stopped at the install and said so.
    expect(h.runs[0]!.commands).toEqual(['npm outdated']);
    expect(h.runs[0]!.notRun).toEqual(['Update', 'Test']);
    expect(memo?.outcome).toBe('needs-a-person');
    expect(memo?.summary).toMatch(/stopped before `npm update`, which needs you/);
  });

  it('never pushes, merges, switches or commits — every git call is one of a declared few', async () => {
    const h = harness({ worktreeStatus: ' M package.json' });
    await h.scheduler.tick();
    const allowed = new Set(['branch --list', 'rev-parse HEAD', 'worktree add', 'status --porcelain', 'worktree remove', 'branch -d']);
    for (const call of h.git) {
      expect(allowed.has(call.args.slice(0, 2).join(' ')), call.args.join(' ')).toBe(true);
    }
    expect(h.git.some(call => ['push', 'merge', 'checkout', 'switch', 'commit', 'reset'].includes(call.args[0]!))).toBe(false);
  });

  it('keeps a worktree that holds work, and reports where', async () => {
    const h = harness({ worktreeStatus: ' M package-lock.json' });
    const memo = await h.scheduler.tick();
    expect(memo?.branch).toBe('chore/scheduled-deps-2026-10-08');
    expect(memo?.worktreePath).toContain('atlasmind-worktrees');
    expect(h.git.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(false);
    expect(h.reports[0]).toMatch(/merging them is your decision/);
  });

  it('removes an empty worktree and its branch with a delete that refuses unmerged work', async () => {
    const h = harness();
    const memo = await h.scheduler.tick();
    expect(h.git.some(call => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true);
    expect(h.git.find(call => call.args[0] === 'branch' && call.args[1] === '-d')?.args).toEqual(['branch', '-d', 'chore/scheduled-deps-2026-10-08']);
    expect(memo?.worktreePath).toBeUndefined();
  });

  it('refuses rather than falling back to the working tree when no worktree can be made', async () => {
    const h = harness({ worktreeFails: true });
    const memo = await h.scheduler.tick();
    expect(memo?.outcome).toBe('refused');
    expect(memo?.summary).toMatch(/never falls back to your working tree/);
    // Recorded through the runner's refusal path — no step ran anywhere.
    expect(h.runs.every(run => run.status === 'refused')).toBe(true);
  });

  it('makes no worktree for a routine with nothing it may run unattended', async () => {
    const pushOnly: RoutineDefinition = { ...ROUTINE, steps: [{ id: 'p', label: 'Push', run: 'git push', on_fail: 'abort' }] };
    const h = harness({ routine: pushOnly });
    const memo = await h.scheduler.tick();
    expect(memo?.outcome).toBe('needs-a-person');
    expect(h.git).toEqual([]);
    expect(h.runs[0]).toMatchObject({ cwd: ROOT, commands: [], notRun: ['Push'] });
  });

  it('refuses a routine that needs a value nobody is present to give, without a worktree', async () => {
    const needsMessage: RoutineDefinition = { ...ROUTINE, steps: [{ id: 'c', label: 'Commit', run: 'echo ${message}', on_fail: 'abort' }] };
    const h = harness({ routine: needsMessage });
    const memo = await h.scheduler.tick();
    expect(memo?.outcome).toBe('refused');
    expect(h.git).toEqual([]);
  });

  it('reports a failed step by name', async () => {
    const safe: RoutineDefinition = { ...ROUTINE, steps: [{ id: 't', label: 'Tests', run: 'npm test', on_fail: 'abort' }] };
    const h = harness({ routine: safe, runResult: { succeeded: false, failedStep: 't', steps: [{ stepId: 't', label: 'Tests', exitCode: 1, stdout: '', stderr: '', durationMs: 1 }] } });
    const memo = await h.scheduler.tick();
    expect(memo?.outcome).toBe('failed');
    expect(memo?.summary).toMatch(/failed at "Tests"/);
  });
});

describe('one run per window, one at a time, recorded before it starts', () => {
  it('records the attempt before any step, so a crash cannot replay it', async () => {
    const h = harness();
    let seenDuringRun: unknown;
    const original = h.scheduler['deps'].runRoutine;
    h.scheduler['deps'].runRoutine = async (...args) => {
      seenDuringRun = JSON.parse(JSON.stringify(h.state().runs['deps']));
      return original(...args);
    };
    await h.scheduler.tick();
    expect(seenDuringRun).toMatchObject({ outcome: 'running' });
  });

  it('does not run again in the same window', async () => {
    const h = harness();
    await h.scheduler.tick();
    expect(await h.scheduler.tick()).toBeUndefined();
    expect(h.git.filter(call => call.args[1] === 'add')).toHaveLength(1);
  });

  it('does not start a second run while one is in progress', async () => {
    const h = harness();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = h.scheduler['deps'].runRoutine;
    h.scheduler['deps'].runRoutine = async (...args) => {
      await gate;
      return original(...args);
    };
    const first = h.scheduler.tick();
    await vi.waitFor(() => expect(h.git.some(call => call.args[1] === 'add')).toBe(true));
    expect(h.scheduler.board().entries[0]!.state).toBe('running');
    expect(await h.scheduler.tick()).toBeUndefined();
    release();
    await first;
  });

  it('marks a report reviewed, and an approval can be withdrawn', async () => {
    const h = harness();
    await h.scheduler.tick();
    expect(h.scheduler.attentionInput()).toEqual({ failed: 0, needsYou: 1, changed: 0 });
    await h.scheduler.markReviewed('deps');
    expect(h.scheduler.attentionInput()).toEqual({ failed: 0, needsYou: 0, changed: 0 });
    await h.scheduler.revoke('deps');
    expect(h.scheduler.board().entries[0]!.state).toBe('not-approved');
    await h.scheduler.approve(ROUTINE);
    expect(h.scheduler.board().entries[0]!.approvedAt).toBeDefined();
  });
});

describe('spend is zero by construction', () => {
  it('holds no model: the scheduler and its policy import no provider, router or orchestrator', () => {
    for (const file of ['routineScheduler.ts', 'scheduledRoutinePolicy.ts', 'routineSchedule.ts']) {
      const source = readFileSync(path.join(__dirname, '..', '..', 'src', 'core', file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]!);
      expect(imports.filter(spec => /providers|modelRouter|orchestrator|costTracker/.test(spec)), file).toEqual([]);
    }
  });
});

describe('RoutineRunner records a run that stopped early as not finished', () => {
  it('does not call a partial run completed', async () => {
    const history = { upsertRun: vi.fn() };
    const runner = new RoutineRunner(history as never);
    const result = await runner.run(
      ROUTINE,
      { routineId: ROUTINE.id, routineName: ROUTINE.name, status: 'ready', steps: [], outward: [] },
      ROOT,
      () => undefined,
      async () => 'abort',
      { titlePrefix: 'Scheduled routine', notRun: [{ label: 'Update', reason: 'needs a person' }], notes: ['Ran in a worktree.'] },
    );
    expect(result.succeeded).toBe(true);
    const record = history.upsertRun.mock.calls[0]![0];
    expect(record.title).toBe('Scheduled routine: Dependency check');
    expect(record.status).toBe('failed');
    expect(record.failedSubtaskTitles).toEqual(['Update (not run: needs a person)']);
    expect(record.logs.map((log: { message: string }) => log.message)).toEqual(['[Update] not run: needs a person', 'Ran in a worktree.']);
  });
});

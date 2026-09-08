import { describe, expect, it } from 'vitest';

import {
  WORKTREE_RULES,
  describeWorktreeBatch,
  needsRealWorkingTree,
  placeSubTask,
  planWorktreeBatch,
  writesWorkspace,
} from '../../src/core/worktreeIsolation.ts';

/**
 * Where parallel subtasks run, and what stops them writing over each other.
 *
 * The defect: `taskScheduler` runs five subtasks at once against one working
 * tree with no lock anywhere, so two of them editing a file is a silent
 * last-writer-wins — both report completed and one change is gone.
 */

const ON = { enabled: true, gitAvailable: true };
const OFF = { enabled: false, gitAvailable: true };
const NO_GIT = { enabled: true, gitAvailable: false };

const READER = { id: 'research', skills: ['file-read', 'file-search', 'memory-query'] };
const WRITER = { id: 'edit', skills: ['file-read', 'file-edit'] };
const TESTER = { id: 'verify', skills: ['file-edit', 'test-run'] };

describe('a subtask that writes nothing races with nobody', () => {
  it('keeps full parallelism whatever the setting says', () => {
    for (const options of [ON, OFF, NO_GIT]) {
      expect(placeSubTask(READER, options)).toEqual({
        subTaskId: 'research',
        placement: 'shared',
        rule: 'read-only',
      });
    }
  });

  it('recognises the write skills that can actually collide', () => {
    expect(writesWorkspace({ skills: ['file-write'] })).toBe(true);
    expect(writesWorkspace({ skills: ['file-edit'] })).toBe(true);
    expect(writesWorkspace({ skills: ['git-apply-patch'] })).toBe(true);
    expect(writesWorkspace({ skills: ['file-read', 'git-diff'] })).toBe(false);
    expect(writesWorkspace({ skills: [] })).toBe(false);
  });
});

describe('a writer that needs the real tree cannot be isolated', () => {
  it('runs alone, and says that is why', () => {
    // The blocker the roadmap entry did not account for: a fresh worktree is a
    // checkout of tracked files, with no node_modules, no build output and no
    // untracked state. "The tests failed" there would be a fact about the
    // isolation, not about the code.
    expect(placeSubTask(TESTER, ON)).toEqual({
      subTaskId: 'verify',
      placement: 'exclusive',
      rule: 'needs-working-tree',
    });
  });

  it('reports the tree requirement rather than the setting, even when isolation is off', () => {
    // Reporting "disabled" here would suggest that switching something on would
    // help. It would not.
    expect(placeSubTask(TESTER, OFF).rule).toBe('needs-working-tree');
  });

  it.each([
    ['test-run', ['file-edit', 'test-run']],
    ['terminal-run', ['file-edit', 'terminal-run']],
    ['npm-scripts', ['file-edit', 'npm-scripts']],
    ['git-commit', ['file-edit', 'git-commit']],
  ])('treats %s as needing the real tree', (_label, skills) => {
    expect(needsRealWorkingTree({ skills })).toBe(true);
    expect(placeSubTask({ id: 'x', skills }, ON).placement).toBe('exclusive');
  });
});

describe('turning the feature off must not reintroduce the race', () => {
  it('serialises writers when isolation is disabled', () => {
    // The whole point. A setting that is off is allowed to cost parallelism; it
    // is not allowed to bring back a defect.
    expect(placeSubTask(WRITER, OFF)).toEqual({
      subTaskId: 'edit',
      placement: 'exclusive',
      rule: 'isolation-disabled',
    });
  });

  it('serialises writers when there is no git repository', () => {
    expect(placeSubTask(WRITER, NO_GIT).placement).toBe('exclusive');
    expect(placeSubTask(WRITER, NO_GIT).rule).toBe('isolation-unavailable');
  });

  it('isolates a plain writer when it can', () => {
    expect(placeSubTask(WRITER, ON)).toEqual({
      subTaskId: 'edit',
      placement: 'isolated',
      rule: 'writes-tracked-files',
    });
  });
});

describe('a batch becomes ordered waves', () => {
  it('runs everything that cannot collide together, then the rest one at a time', () => {
    const plan = planWorktreeBatch([READER, WRITER, TESTER], ON);

    expect(plan.waves).toEqual([['research', 'edit'], ['verify']]);
    expect(plan.usesWorktrees).toBe(true);
  });

  it('never puts two writers in one wave when nothing can be isolated', () => {
    // The property that closes the defect, asserted directly rather than
    // inferred from the placements.
    const plan = planWorktreeBatch(
      [{ id: 'a', skills: ['file-edit'] }, { id: 'b', skills: ['file-write'] }, READER],
      OFF,
    );

    expect(plan.usesWorktrees).toBe(false);
    for (const wave of plan.waves) {
      const writers = wave.filter(id => id === 'a' || id === 'b');
      expect(writers.length, `wave ${wave.join(',')} holds two writers`).toBeLessThanOrEqual(1);
    }
    // The reader still gets to run alongside one of them.
    expect(plan.waves[0]).toContain('research');
  });

  it('leaves a wholly read-only batch exactly as it was', () => {
    const plan = planWorktreeBatch([READER, { id: 'r2', skills: ['file-read'] }], ON);

    expect(plan.waves).toEqual([['research', 'r2']]);
    expect(plan.usesWorktrees).toBe(false);
  });

  it('does the parallel work before the exclusive work', () => {
    // A run that is mostly research plus one edit should do its research while
    // it can, rather than queueing behind the edit.
    const plan = planWorktreeBatch([TESTER, READER], ON);
    expect(plan.waves[0]).toEqual(['research']);
    expect(plan.waves[1]).toEqual(['verify']);
  });

  it('produces no waves for an empty batch', () => {
    expect(planWorktreeBatch([], ON).waves).toEqual([]);
  });
});

describe('the plan explains itself, and stays quiet when there is nothing to say', () => {
  it('says nothing when the batch runs as it always did', () => {
    // A line on every batch saying "unchanged" is noise that trains people to
    // skip the line that matters.
    expect(describeWorktreeBatch(planWorktreeBatch([READER], ON))).toBe('');
  });

  it('names the worktrees and the reason for any serialisation', () => {
    const description = describeWorktreeBatch(planWorktreeBatch([WRITER, TESTER], ON));

    expect(description).toContain('1 in its own worktree');
    expect(description).toMatch(/commands or tests/);
  });

  it('gives the other reason when nothing needed the real tree', () => {
    const description = describeWorktreeBatch(
      planWorktreeBatch([{ id: 'a', skills: ['file-edit'] }, { id: 'b', skills: ['file-write'] }], OFF),
    );

    expect(description).toMatch(/must not write the same tree at once/);
  });

  it('does not describe a single subtask as being serialised', () => {
    // One subtask is not being kept apart from anything. "1 one at a time
    // because two subtasks must not write the same tree" describes a batch that
    // does not exist, and a surface that overstates its smallest case is one
    // people learn to discount on the cases that matter.
    const description = describeWorktreeBatch(planWorktreeBatch([{ id: 'a', skills: ['file-edit'] }], OFF));

    expect(description).toBe('1 on its own, since nothing else may write while it does');
    expect(description).not.toMatch(/one at a time/);
  });

  it('says a single command-running subtask needs the real tree', () => {
    const description = describeWorktreeBatch(planWorktreeBatch([TESTER], ON));

    expect(description).toBe('1 on its own because it runs commands or tests, which need the real working tree');
  });

  it('publishes a rule for every placement it can produce', () => {
    const declared = new Set(WORKTREE_RULES.map(rule => rule.id));
    const produced = [
      placeSubTask(READER, ON), placeSubTask(WRITER, ON), placeSubTask(WRITER, OFF),
      placeSubTask(WRITER, NO_GIT), placeSubTask(TESTER, ON),
    ].map(entry => entry.rule);

    expect(new Set(produced).size).toBe(5);
    expect(produced.every(rule => declared.has(rule))).toBe(true);
  });
});

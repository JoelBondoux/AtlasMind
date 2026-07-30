import { describe, expect, it } from 'vitest';
import {
  buildWorkflowChatNotice,
  detectGovernedAction,
  parseWorkflowChatGuidanceMode,
} from '../../src/core/workflowChatGuard.ts';
import { seedWorkflowConfig, type WorkflowConfig } from '../../src/core/workflowConfig.ts';

/** The seed with the named stages enabled, since stages ship disabled. */
function config(enabled: string[] = ['development', 'branching', 'pull-request', 'release']): WorkflowConfig {
  const base = seedWorkflowConfig({ profile: 'solo' });
  return {
    ...base,
    stages: base.stages.map(stage => (enabled.includes(stage.id)
      ? { ...stage, enabled: true, command: undefined }
      : stage)),
  };
}

describe('detectGovernedAction', () => {
  it.each([
    ['commit this', 'commit'],
    ['please commit', 'commit'],
    ['git commit -m "x"', 'commit'],
    ['commit everything and stop', 'commit'],
    ['push', 'push'],
    ['can you push it', 'push'],
    ['create a branch for the auth work', 'branch'],
    ['checkout -b feat/thing', 'branch'],
    ['open a PR', 'pull-request'],
    ['raise a pull request for this', 'pull-request'],
    ['cut a release', 'release'],
    ['ship a new version', 'release'],
    ['bump the version and publish it', 'release'],
  ] as const)('reads %j as %s', (prompt, expected) => {
    expect(detectGovernedAction(prompt)).toBe(expected);
  });

  /**
   * A release is a push and a tag, so an unordered table would call it a push
   * and give the less useful answer. The rules are matched most-specific-first.
   */
  it('prefers the more specific action when two could match', () => {
    expect(detectGovernedAction('ship a new release and push it')).toBe('release');
    expect(detectGovernedAction('open a pull request and push the branch')).toBe('pull-request');
  });

  it('does not fire on a question merely mentioning the noun', () => {
    // "the commit message is wrong" asks about a commit; it does not ask for one.
    for (const prompt of [
      'what does the commit message say?',
      'explain the commit history',
      'which commit hash introduced this?',
      'the commit log is confusing',
      'was this commit signed?',
      // The same noun/verb trap for push, which a determiner also settles.
      'the push failed',
      'why was the push rejected?',
      'that push broke CI',
    ]) {
      expect(detectGovernedAction(prompt), prompt).toBeUndefined();
    }
  });

  it('says nothing about ordinary work', () => {
    for (const prompt of [
      'fix the failing test',
      'why is the dashboard nav grey?',
      'explain how routing picks a model',
      '',
      '   ',
    ]) {
      expect(detectGovernedAction(prompt), prompt).toBeUndefined();
    }
  });
});

describe('buildWorkflowChatNotice — silence is a valid answer', () => {
  /**
   * Each of these is a case where there is nothing *true* to say, and saying
   * something anyway would be the worse failure — inventing a process the
   * project never adopted.
   */
  it('says nothing when the mode is off', () => {
    expect(buildWorkflowChatNotice({ prompt: 'commit this', mode: 'off', config: config() })).toBeUndefined();
  });

  it('says nothing when no workflow is declared', () => {
    // No rules means nothing to be outside of.
    expect(buildWorkflowChatNotice({ prompt: 'commit this', mode: 'inform', config: undefined })).toBeUndefined();
  });

  it('says nothing when the owning stage is disabled', () => {
    // A stage nobody enabled has no expectations to assert.
    const notice = buildWorkflowChatNotice({
      prompt: 'commit this',
      mode: 'inform',
      config: config([]),
    });
    expect(notice).toBeUndefined();
  });

  it('says nothing for a prompt that implies no governed action', () => {
    expect(buildWorkflowChatNotice({ prompt: 'fix the test', mode: 'inform', config: config() })).toBeUndefined();
  });
});

describe('buildWorkflowChatNotice — what it says', () => {
  it('names the integration branch rather than describing rules abstractly', () => {
    const notice = buildWorkflowChatNotice({ prompt: 'push', mode: 'inform', config: config() });
    expect(notice?.markdown).toContain('`develop`');
  });

  it('leads with the protected branch when that is where you are', () => {
    // The one fact that is an emergency rather than an FYI.
    const notice = buildWorkflowChatNotice({
      prompt: 'commit this',
      mode: 'inform',
      config: config(),
      currentBranch: 'main',
    });
    expect(notice?.markdown).toMatch(/you are on `main`/i);
    expect(notice?.markdown).toMatch(/\*\*protected\*\*/);
    expect(notice?.markdown).toMatch(/reviewed pull request/);
  });

  it('offers the compliant path and the carry-on path, at inform', () => {
    const notice = buildWorkflowChatNotice({ prompt: 'commit this', mode: 'inform', config: config() });
    expect(notice?.blocking).toBe(false);
    expect(notice?.markdown).toMatch(/follow the workflow/);
    expect(notice?.markdown).toMatch(/carry on as asked/);
  });

  it('marks a gate as blocking and says how to get through it', () => {
    // A gate that does not say how to pass it is a wall.
    const notice = buildWorkflowChatNotice({ prompt: 'commit this', mode: 'gate', config: config() });
    expect(notice?.blocking).toBe(true);
    expect(notice?.markdown).toMatch(/go ahead anyway/);
  });

  it('always names where the rules came from, and how to silence it', () => {
    // Advice whose source is unnamed cannot be checked or turned off, and a
    // notice you cannot turn off becomes one you learn to ignore.
    const notice = buildWorkflowChatNotice({ prompt: 'commit this', mode: 'inform', config: config() });
    expect(notice?.markdown).toContain('project_memory/operations/workflow.json');
    expect(notice?.markdown).toContain('atlasmind.workflow.chatGuidance');
  });

  it('says a release cannot be undone, because that is the point of the gate', () => {
    const notice = buildWorkflowChatNotice({ prompt: 'cut a release', mode: 'inform', config: config() });
    expect(notice?.markdown).toMatch(/cannot be undone/);
    expect(notice?.stageId).toBe('release');
  });

  it('carries the stage\'s own required checks when it declares any', () => {
    const base = config();
    const notice = buildWorkflowChatNotice({
      prompt: 'open a PR',
      mode: 'inform',
      config: {
        ...base,
        stages: base.stages.map(stage => (stage.id === 'pull-request'
          ? { ...stage, requiredChecks: ['I read my own diff'] }
          : stage)),
      },
    });
    expect(notice?.markdown).toContain('I read my own diff');
  });

  it('is deterministic — the same prompt yields the same notice', () => {
    // Advice that varies between identical turns is not something you can learn
    // from, which is the whole reason detection is a table and not a model.
    const input = { prompt: 'commit this', mode: 'inform' as const, config: config() };
    expect(buildWorkflowChatNotice(input)?.markdown).toBe(buildWorkflowChatNotice(input)?.markdown);
  });
});

describe('parseWorkflowChatGuidanceMode', () => {
  it('reads the three declared values', () => {
    expect(parseWorkflowChatGuidanceMode('off')).toBe('off');
    expect(parseWorkflowChatGuidanceMode('gate')).toBe('gate');
    expect(parseWorkflowChatGuidanceMode('inform')).toBe('inform');
  });

  it('defaults to inform for anything else', () => {
    // Not to `gate`: an unreadable setting must not silently start blocking
    // commits, and not to `off` either, which would silently stop protecting.
    for (const raw of [undefined, null, '', 'GATE', 'block', 42, {}]) {
      expect(parseWorkflowChatGuidanceMode(raw)).toBe('inform');
    }
  });
});

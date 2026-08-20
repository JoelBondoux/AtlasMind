import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_SETUP_GUIDE,
  REQUIRED_LOCAL_CI_STEP_IDS,
  buildLocalCiSetupPlan,
  isLocalCiReady,
  type LocalCiSetupState,
} from '../../src/core/localCiSetupPlan.ts';
import { findNonOpeningActions, nextSetupStep, summarizeSetupProgress } from '../../src/core/setupWalkthrough.ts';
import type { LocalCiWorkflowReview } from '../../src/core/localCiRunner.ts';

function review(overrides: Partial<LocalCiWorkflowReview> = {}): LocalCiWorkflowReview {
  return {
    state: 'ok',
    workflowFile: 'trusted-local-ci.yml',
    path: '.github/workflows/trusted-local-ci.yml',
    repoSlug: 'JoelBondoux/AtlasMind',
    runnerLabel: 'atlasmind-trusted-linux-x64',
    blockers: [],
    warnings: [],
    scaffoldable: false,
    reviewedAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<LocalCiSetupState> = {}): LocalCiSetupState {
  return {
    permissionEnabled: false,
    workflowFile: 'trusted-local-ci.yml',
    trustedBranch: 'develop',
    prerequisitesInspected: false,
    githubCliInstalled: false,
    githubAuthenticated: false,
    dockerCliInstalled: false,
    dockerEngineAvailable: false,
    dockerDesktopAvailable: false,
    hasCompletedARun: false,
    ...overrides,
  };
}

function everythingReady(overrides: Partial<LocalCiSetupState> = {}): LocalCiSetupState {
  return state({
    permissionEnabled: true,
    workflowReview: review(),
    prerequisitesInspected: true,
    githubCliInstalled: true,
    githubAuthenticated: true,
    dockerCliInstalled: true,
    dockerEngineAvailable: true,
    dockerDesktopAvailable: true,
    ...overrides,
  });
}

function statusOf(steps: ReturnType<typeof buildLocalCiSetupPlan>, id: string): string | undefined {
  return steps.find(step => step.id === id)?.status;
}

describe('local CI setup plan', () => {
  /**
   * The property the whole guide rests on. A setup assistant that switched on
   * the gate deciding whether GitHub may execute code on this computer would
   * have removed the reason that gate exists.
   */
  it('never offers an action that changes anything', () => {
    for (const sample of [state(), everythingReady(), state({ permissionEnabled: true })]) {
      expect(findNonOpeningActions(buildLocalCiSetupPlan(sample))).toEqual([]);
    }
  });

  it('covers exactly the steps the guide claims to have', () => {
    const ids = buildLocalCiSetupPlan(state()).map(step => step.id);
    expect(ids).toEqual([...LOCAL_CI_SETUP_GUIDE.stepIds]);
  });

  /**
   * The workflow check is a file read. Putting it behind Docker, `gh` and a
   * queued job is what made the original flow refuse at step four; the guide
   * must not reproduce that ordering.
   */
  it('asks about the trusted workflow first, and never blocks it on anything', () => {
    const steps = buildLocalCiSetupPlan(state());
    expect(steps[0]?.id).toBe('workflow');
    expect(steps[0]?.status).toBe('todo');
    expect(nextSetupStep(steps, LOCAL_CI_SETUP_GUIDE.stepIds)?.id).toBe('workflow');
  });

  it('distinguishes an unreviewed workflow from an acceptable one', () => {
    const unreviewed = buildLocalCiSetupPlan(state());
    expect(statusOf(unreviewed, 'workflow')).toBe('todo');
    expect(unreviewed[0]?.detail).toContain('has not read');

    const passing = buildLocalCiSetupPlan(state({ workflowReview: review() }));
    expect(statusOf(passing, 'workflow')).toBe('done');
  });

  it('offers to write a missing workflow and to fix a blocked one, differently', () => {
    const missing = buildLocalCiSetupPlan(state({ workflowReview: review({ state: 'missing', scaffoldable: true, blockers: ['No trusted workflow exists yet.'] }) }));
    expect(missing[0]?.guidance?.some(line => line.text.includes('Write it for me'))).toBe(true);

    const blocked = buildLocalCiSetupPlan(state({
      workflowReview: review({
        state: 'blocked',
        blockers: ['The job does not require the triggering actor to be the repository owner.'],
      }),
    }));
    expect(blocked[0]?.detail).toContain('1 thing must change');
    expect(blocked[0]?.guidance?.some(line => line.text.includes('repository owner'))).toBe(true);
  });

  /**
   * An unprobed `false` is not the same as "missing". Rendering it as missing
   * sends somebody to install software they may already have, which is how a
   * guide teaches people to stop trusting it.
   */
  it('says "not checked" rather than "not installed" before probing', () => {
    const steps = buildLocalCiSetupPlan(state({ permissionEnabled: true, workflowReview: review() }));
    const cli = steps.find(step => step.id === 'githubCli');
    expect(cli?.detail).toContain('Not checked yet');
    expect(cli?.detail).not.toContain('was not found');

    const probed = buildLocalCiSetupPlan(state({ permissionEnabled: true, workflowReview: review(), prerequisitesInspected: true }));
    expect(probed.find(step => step.id === 'githubCli')?.detail).toContain('was not found');
  });

  it('blocks each machine step on the one before it', () => {
    const steps = buildLocalCiSetupPlan(state({ workflowReview: review() }));
    expect(statusOf(steps, 'permission')).toBe('todo');
    expect(statusOf(steps, 'githubCli')).toBe('blocked');
    expect(statusOf(steps, 'githubAuth')).toBe('blocked');
    expect(statusOf(steps, 'docker')).toBe('blocked');
    expect(statusOf(steps, 'firstRun')).toBe('blocked');
  });

  it('keeps "installed but signed out" apart from "not installed"', () => {
    const signedOut = buildLocalCiSetupPlan(everythingReady({ githubAuthenticated: false }));
    expect(statusOf(signedOut, 'githubCli')).toBe('done');
    expect(statusOf(signedOut, 'githubAuth')).toBe('todo');
    expect(signedOut.find(step => step.id === 'githubAuth')?.guidance?.[0]?.command)
      .toBe('gh auth login --hostname github.com --web');
  });

  it('separates Docker being absent, stopped-but-startable, and stopped-with-no-desktop', () => {
    const absent = buildLocalCiSetupPlan(everythingReady({ dockerCliInstalled: false, dockerEngineAvailable: false }));
    expect(absent.find(step => step.id === 'docker')?.detail).toContain('Docker CLI was not found');

    const startable = buildLocalCiSetupPlan(everythingReady({ dockerEngineAvailable: false }));
    expect(startable.find(step => step.id === 'docker')?.detail).toContain('can start Docker Desktop');

    const manual = buildLocalCiSetupPlan(everythingReady({ dockerEngineAvailable: false, dockerDesktopAvailable: false }));
    expect(manual.find(step => step.id === 'docker')?.detail).toContain('never starts or stops an unmanaged system service');
  });

  /**
   * Configured is not working, and the guide refuses to conflate them — the
   * same rule the Buzz guide applies to "subscribed" and ACP to "enabled".
   */
  it('treats a fully configured runner that has never run as ready but unfinished', () => {
    const steps = buildLocalCiSetupPlan(everythingReady());
    expect(isLocalCiReady(steps)).toBe(true);
    expect(statusOf(steps, 'firstRun')).toBe('todo');
    expect(summarizeSetupProgress(steps, LOCAL_CI_SETUP_GUIDE.stepIds).finished).toBe(false);
    expect(nextSetupStep(steps, LOCAL_CI_SETUP_GUIDE.stepIds)?.id).toBe('firstRun');
  });

  it('is finished only once a job has actually run', () => {
    const steps = buildLocalCiSetupPlan(everythingReady({ hasCompletedARun: true }));
    expect(summarizeSetupProgress(steps, LOCAL_CI_SETUP_GUIDE.stepIds).finished).toBe(true);
    expect(nextSetupStep(steps, LOCAL_CI_SETUP_GUIDE.stepIds)).toBeUndefined();
  });

  it('reports readiness from the prerequisites alone, never from a completed run', () => {
    expect(isLocalCiReady(buildLocalCiSetupPlan(everythingReady()))).toBe(true);
    expect(isLocalCiReady(buildLocalCiSetupPlan(everythingReady({ permissionEnabled: false })))).toBe(false);
    expect(isLocalCiReady(buildLocalCiSetupPlan(state({ hasCompletedARun: true })))).toBe(false);
    expect([...REQUIRED_LOCAL_CI_STEP_IDS]).not.toContain('firstRun');
  });

  it('names the settings scope a surprising permission value came from', () => {
    const steps = buildLocalCiSetupPlan(state({ permissionEnabled: true, permissionSourceLabel: 'workspace setting' }));
    expect(steps.find(step => step.id === 'permission')?.detail).toContain('workspace setting');
  });

  it('shows the queue command the runner validated, not one it composed', () => {
    const steps = buildLocalCiSetupPlan(everythingReady({
      trustedBranch: 'main',
      workflowFile: 'ci-trusted.yml',
      queueCommand: 'gh workflow run ci-trusted.yml --ref main',
    }));
    expect(steps.find(step => step.id === 'firstRun')?.guidance?.[0]?.command)
      .toBe('gh workflow run ci-trusted.yml --ref main');
  });

  /**
   * `gh workflow run` resolves the workflow through GitHub's registry, and
   * GitHub only registers a dispatchable workflow from the default branch. A
   * file freshly scaffolded on a feature branch therefore answers HTTP 404 —
   * with an API URL that reads like a wrong folder — and the guide must
   * pre-empt that, because everything about the error suggests moving a file
   * that is already in the right place.
   */
  it('explains the default-branch registration rule behind the dispatch 404', () => {
    const firstRun = buildLocalCiSetupPlan(everythingReady({ trustedBranch: 'main', workflowFile: 'ci-trusted.yml' }))
      .find(step => step.id === 'firstRun');
    const note = firstRun?.guidance?.find(line => line.text.includes('default branch'));
    expect(note?.text).toContain('HTTP 404');
    expect(note?.text).toContain('ci-trusted.yml');
    expect(note?.text).toContain('push a commit to main');
    expect(note?.command).toBeUndefined();
  });

  /**
   * The command is built and validated by `buildLocalCiQueueInvocation`, which
   * refuses a filename or branch it would not put on a command line. When it
   * refuses, the guide says so rather than printing something unusable — and
   * never falls back to composing the string itself.
   */
  it('says the settings are unusable rather than printing an unvalidated command', () => {
    const steps = buildLocalCiSetupPlan(everythingReady({ workflowFile: 'trusted.yml;whoami' }));
    const firstRun = steps.find(step => step.id === 'firstRun');
    expect(firstRun?.guidance?.some(line => line.command !== undefined)).toBe(false);
    expect(firstRun?.guidance?.some(line => line.text.includes('workflowFile'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CI_ROUTES,
  buildDirectLocalRunConfirmation,
  buildDirectLocalRunPlan,
  describeCiRouteAvailability,
  findCiRoute,
  resolveDirectLocalChecks,
  routeSatisfiesEvidence,
  type CiRouteMachineFacts,
} from '../../src/core/ciRoutes.ts';

function facts(overrides: Partial<CiRouteMachineFacts> = {}): CiRouteMachineFacts {
  return {
    hasLocalChecks: true,
    dockerEngineAvailable: true,
    githubCliAuthenticated: true,
    localRunnerPermitted: true,
    trustedWorkflowReady: true,
    hostedWorkflowPresent: true,
    ...overrides,
  };
}

function statusOf(list: ReturnType<typeof describeCiRouteAvailability>, id: string): string | undefined {
  return list.find(entry => entry.route.id === id)?.status;
}

describe('CI route registry', () => {
  it('declares a unique id, evidence class and caveat for every route', () => {
    const ids = CI_ROUTES.map(route => route.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const route of CI_ROUTES) {
      expect(route.evidenceCaveat.length).toBeGreaterThan(40);
      expect(route.label).not.toBe('');
      expect(findCiRoute(route.id)).toBe(route);
    }
  });

  /**
   * The ordering is a correction, not a cosmetic choice: the page presented the
   * GitHub-connected runner as *the* route when it is the third thing most
   * people need, and the cheapest route was not offered at all.
   */
  it('puts the cheapest, most immediate route first', () => {
    expect(CI_ROUTES[0]?.id).toBe('direct-local');
    expect(CI_ROUTES[0]?.cost).toBe('local-only');
  });

  it('never claims a declared route is available, whatever the machine offers', () => {
    const availability = describeCiRouteAvailability(facts());
    for (const entry of availability) {
      if (entry.route.implementation === 'declared') {
        expect(entry.status).toBe('unimplemented');
        expect(entry.blockers.length).toBeGreaterThan(0);
      }
    }
    expect(statusOf(availability, 'act')).toBe('unimplemented');
    expect(statusOf(availability, 'buildkite')).toBe('unimplemented');
  });

  it('marks every implemented route available on a fully configured machine', () => {
    const availability = describeCiRouteAvailability(facts());
    expect(statusOf(availability, 'direct-local')).toBe('available');
    expect(statusOf(availability, 'local-runner')).toBe('available');
    expect(statusOf(availability, 'github-hosted')).toBe('available');
  });

  /**
   * The property that makes the route model worth having: the simplest route
   * survives a machine with no Docker, no GitHub CLI and no workflow, which is
   * exactly the machine somebody wanting "check this before I push" is sitting
   * at.
   */
  it('keeps run-here available on a machine with nothing else set up', () => {
    const bare = describeCiRouteAvailability(facts({
      dockerEngineAvailable: false,
      githubCliAuthenticated: false,
      localRunnerPermitted: false,
      trustedWorkflowReady: false,
      hostedWorkflowPresent: false,
    }));
    expect(statusOf(bare, 'direct-local')).toBe('available');
    expect(statusOf(bare, 'local-runner')).toBe('blocked');
    expect(statusOf(bare, 'github-hosted')).toBe('blocked');
  });

  it('names every unmet prerequisite rather than only the first', () => {
    const blocked = describeCiRouteAvailability(facts({
      dockerEngineAvailable: false,
      githubCliAuthenticated: false,
      localRunnerPermitted: false,
      trustedWorkflowReady: false,
    })).find(entry => entry.route.id === 'local-runner');
    expect(blocked?.blockers).toHaveLength(4);
    expect(blocked?.nextStep).toContain('/localci');
  });

  it('blocks run-here only when the project declares no checks', () => {
    const noChecks = describeCiRouteAvailability(facts({ hasLocalChecks: false }));
    const entry = noChecks.find(item => item.route.id === 'direct-local');
    expect(entry?.status).toBe('blocked');
    expect(entry?.blockers[0]).toContain('No compile, build, lint or test script');
  });
});

describe('evidence satisfaction', () => {
  /**
   * The comparison that makes the nonsense combinations unrepresentable. A
   * Windows matrix leg cannot be satisfied by a Linux container, which is the
   * exact substitution the documentation already warns against for `act`.
   */
  it('refuses a container as a stand-in for a declared matrix', () => {
    const runner = findCiRoute('local-runner')!;
    const verdict = routeSatisfiesEvidence(runner, 'declared-matrix');
    expect(verdict.satisfied).toBe(false);
    expect(verdict.reason).toContain('cannot stand in');
  });

  it('lets a hosted matrix satisfy the narrower classes', () => {
    const hosted = findCiRoute('github-hosted')!;
    expect(routeSatisfiesEvidence(hosted, 'linux-container').satisfied).toBe(true);
    expect(routeSatisfiesEvidence(hosted, 'this-machine').satisfied).toBe(true);
    expect(routeSatisfiesEvidence(hosted, 'declared-matrix').satisfied).toBe(true);
  });

  it('refuses to equate this machine with a container', () => {
    const direct = findCiRoute('direct-local')!;
    expect(routeSatisfiesEvidence(direct, 'linux-container').satisfied).toBe(false);
    expect(routeSatisfiesEvidence(direct, 'this-machine').satisfied).toBe(true);
  });

  it('always explains itself, satisfied or not', () => {
    for (const route of CI_ROUTES) {
      for (const required of ['this-machine', 'linux-container', 'declared-matrix'] as const) {
        expect(routeSatisfiesEvidence(route, required).reason.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('direct-local checks', () => {
  /**
   * A project declaring an aggregate has already said what its checks are.
   * This repository's own `ci:local` chains six steps in a deliberate order
   * that `compile, lint, test` does not reproduce.
   */
  it('prefers a declared aggregate script over guessing at its parts', () => {
    const checks = resolveDirectLocalChecks(['compile', 'lint', 'test', 'ci:local']);
    expect(checks?.rule).toBe('declared-aggregate');
    expect(checks?.scripts).toEqual(['ci:local']);
    expect(checks?.ruleDetail).toContain('ci:local');
  });

  it('falls back to the same four-verb vocabulary the starters use', () => {
    const checks = resolveDirectLocalChecks(['lint', 'test', 'compile', 'package']);
    expect(checks?.rule).toBe('validation-scripts');
    expect(checks?.scripts).toEqual(['compile', 'lint', 'test']);
  });

  it('returns nothing rather than inventing a command', () => {
    expect(resolveDirectLocalChecks(['package', 'watch'])).toBeUndefined();
    expect(resolveDirectLocalChecks([])).toBeUndefined();
  });
});

describe('direct-local run plan', () => {
  const checks = resolveDirectLocalChecks(['compile', 'lint', 'test'])!;

  it('chains on a shell that can stop, and separates on one that cannot', () => {
    const posix = buildDirectLocalRunPlan(checks, 'npm', '/bin/bash');
    expect(posix.ok).toBe(true);
    if (posix.ok) {
      expect(posix.plan.failFast).toBe(true);
      expect(posix.plan.lines).toEqual(['npm run compile && npm run lint && npm run test']);
    }

    const legacy = buildDirectLocalRunPlan(checks, 'npm', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.plan.failFast).toBe(false);
      expect(legacy.plan.lines).toHaveLength(3);
    }
  });

  it('uses the package manager the project actually has', () => {
    const pnpm = buildDirectLocalRunPlan(checks, 'pnpm', '/bin/bash');
    expect(pnpm.ok && pnpm.plan.commands[0]).toBe('pnpm compile');
    const yarn = buildDirectLocalRunPlan(checks, 'yarn', '/bin/bash');
    expect(yarn.ok && yarn.plan.commands[0]).toBe('yarn compile');
  });

  /**
   * The route's whole promise is that nothing leaves this machine. A refusal
   * rather than a warning, and structural rather than a flag, so a caller
   * cannot reach a runnable plan without the check having passed.
   */
  it('refuses to run a check script that leaves this machine', () => {
    const outward = resolveDirectLocalChecks(['ci'])!;
    const publishing = buildDirectLocalRunPlan(
      { ...outward, scripts: ['publish'] },
      'npm',
      '/bin/bash',
    );
    expect(publishing.ok).toBe(false);
    if (!publishing.ok) {
      expect(publishing.outward).toEqual(['npm run publish']);
      expect(publishing.reason).toContain('Delivery runbook');
    }
  });

  it('states the evidence boundary in the confirmation, not only on the card', () => {
    const plan = buildDirectLocalRunPlan(checks, 'npm', '/bin/bash');
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const confirmation = buildDirectLocalRunConfirmation(plan.plan);
    expect(confirmation.detail).toContain('npm run compile');
    expect(confirmation.detail).toContain('says nothing about other platforms');
    expect(confirmation.detail).toContain('A failing command stops the ones after it.');
    expect(confirmation.confirmLabel).toBe('Run 3 commands');
  });

  it('warns that a non-fail-fast shell will keep going', () => {
    const legacy = buildDirectLocalRunPlan(checks, 'npm', 'powershell.exe');
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(buildDirectLocalRunConfirmation(legacy.plan).detail).toContain('will NOT stop the rest');
    }
  });
});

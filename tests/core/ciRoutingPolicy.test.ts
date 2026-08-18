import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CI_WORKLOAD_CLASSES,
  decideAllCiRoutes,
  decideCiRoute,
  findCiWorkloadClass,
  renderCiRoutingMarkdown,
  sanitizeCiRoutingConfig,
  seedCiRoutingConfig,
  validateCiRoutingConfig,
  type CiRoutingConfig,
} from '../../src/core/ciRoutingPolicy.ts';
import { CI_ROUTES, describeCiRouteAvailability, findCiRoute, type CiRouteMachineFacts } from '../../src/core/ciRoutes.ts';
import { notMeteredReading, type CiCreditReading } from '../../src/core/ciCreditMeter.ts';

const CLOCK = (): Date => new Date('2026-08-18T00:00:00.000Z');

function facts(overrides: Partial<CiRouteMachineFacts> = {}): CiRouteMachineFacts {
  return {
    hasLocalChecks: true,
    dockerEngineAvailable: true,
    githubCliAuthenticated: true,
    localRunnerPermitted: true,
    trustedWorkflowReady: true,
    hostedWorkflowPresent: true,
    actInstalled: true,
    ...overrides,
  };
}

const EVERYTHING_AVAILABLE = describeCiRouteAvailability(facts());
const EXHAUSTED: CiCreditReading = {
  state: 'exhausted',
  basis: 'billing-api',
  detail: '2000 of 2000 included Actions minutes are used, and no paid overage is enabled.',
};
const UNKNOWN: CiCreditReading = { state: 'unknown', reason: 'the billing endpoint returned 403.' };

function decide(workload: string, config = seedCiRoutingConfig(CLOCK), credit: CiCreditReading = notMeteredReading(), availability = EVERYTHING_AVAILABLE) {
  return decideCiRoute({ workload: workload as never, config, availability, credit });
}

describe('CI routing policy — the trust invariant', () => {
  /**
   * The rule the whole feature rests on. "Fall back to local when the credit
   * runs out" is, without this, a mechanism by which running out of money
   * routes unreviewed code onto a developer's workstation.
   */
  it('refuses unreviewed code on an unsafe route even when the allowance is gone', () => {
    const decision = decide('untrusted-contribution', seedCiRoutingConfig(CLOCK), EXHAUSTED);
    expect(decision.outcome).toBe('blocked');
    expect(decision.routeId).toBeUndefined();
  });

  /**
   * The file is hand-editable, so the invariant cannot live in the seed. A
   * rule explicitly demanding a local route for untrusted code must be refused
   * at decision time, not merely warned about.
   */
  it('refuses a hand-edited rule that would send unreviewed code to a local route', () => {
    const hostile: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      rules: [{
        id: 'hostile',
        workload: 'untrusted-contribution',
        prefer: 'local-runner',
        fallback: ['direct-local'],
        onCreditExhausted: 'fallback',
      }],
    };
    const decision = decide('untrusted-contribution', hostile, EXHAUSTED);
    expect(decision.outcome).toBe('blocked');
    expect(decision.rejected.map(entry => entry.routeId)).toEqual(['local-runner', 'direct-local']);
    for (const entry of decision.rejected) {
      expect(entry.reason).toContain('not safe for code nobody has reviewed');
    }

    const problems = validateCiRoutingConfig(hostile);
    expect(problems.some(problem => problem.severity === 'error' && /unreviewed code/.test(problem.message))).toBe(true);
  });

  /**
   * Stated as a property rather than a handful of cases: for *every*
   * combination of routing file, credit state and machine, an untrusted
   * workload never reaches a route that is not declared safe for it.
   */
  it('never routes an untrusted workload to an unsafe route, for any input', () => {
    const routeIds = CI_ROUTES.map(route => route.id);
    fc.assert(fc.property(
      fc.record({
        prefer: fc.constantFrom(...routeIds),
        fallback: fc.subarray(routeIds, { maxLength: 3 }),
        onCreditExhausted: fc.constantFrom('fallback' as const, 'block' as const),
        credit: fc.constantFrom(EXHAUSTED, UNKNOWN, notMeteredReading()),
        docker: fc.boolean(),
        permitted: fc.boolean(),
        workflowReady: fc.boolean(),
        hosted: fc.boolean(),
      }),
      sample => {
        const config: CiRoutingConfig = {
          ...seedCiRoutingConfig(CLOCK),
          rules: [{
            id: 'generated',
            workload: 'untrusted-contribution',
            prefer: sample.prefer,
            fallback: [...sample.fallback],
            onCreditExhausted: sample.onCreditExhausted,
          }],
        };
        const availability = describeCiRouteAvailability(facts({
          dockerEngineAvailable: sample.docker,
          localRunnerPermitted: sample.permitted,
          trustedWorkflowReady: sample.workflowReady,
          hostedWorkflowPresent: sample.hosted,
        }));
        const decision = decideCiRoute({
          workload: 'untrusted-contribution',
          config,
          availability,
          credit: sample.credit,
        });
        if (decision.outcome === 'routed') {
          const route = findCiRoute(decision.routeId!)!;
          expect(route.capabilities.safeForUntrustedCode).toBe('yes');
        }
      },
    ), { numRuns: 400 });
  });
});

describe('CI routing policy — deciding', () => {
  it('sends fast feedback here, spending no allowance', () => {
    const decision = decide('fast-feedback');
    expect(decision).toMatchObject({ outcome: 'routed', routeId: 'direct-local', ruleId: 'fast-feedback-here' });
    expect(decision.usedFallback).toBe(false);
  });

  it('falls back to the borrowed machine for trusted work when the allowance is gone', () => {
    const decision = decide('full-suite', seedCiRoutingConfig(CLOCK), EXHAUSTED);
    expect(decision).toMatchObject({ outcome: 'routed', routeId: 'local-runner', usedFallback: true });
    expect(decision.rejected[0]?.reason).toContain('allowance is gone');
  });

  /**
   * Nothing else produces evidence for an operating system you are not sitting
   * at, so an exhausted allowance must stop rather than quietly substitute a
   * container — the exact substitution the local-CI documentation warns about.
   */
  it('blocks the platform matrix rather than substituting a weaker route', () => {
    const decision = decide('platform-matrix', seedCiRoutingConfig(CLOCK), EXHAUSTED);
    expect(decision.outcome).toBe('blocked');
    expect(decision.sentence).toContain('will not substitute a weaker route');
  });

  /**
   * A billing endpoint returning 403 must not relocate work. The decision is
   * the preferred route, and it says the meter could not be read.
   */
  it('uses the preferred route when the meter cannot be read, and says so', () => {
    const decision = decide('full-suite', seedCiRoutingConfig(CLOCK), UNKNOWN);
    expect(decision).toMatchObject({ outcome: 'routed', routeId: 'github-hosted', usedFallback: false });
    expect(decision.sentence).toContain('could not read the allowance');
    expect(decision.creditNote).toContain('403');
  });

  it('falls back when the preferred route is unusable on this machine', () => {
    const noWorkflow = describeCiRouteAvailability(facts({ hostedWorkflowPresent: false }));
    const decision = decide('full-suite', seedCiRoutingConfig(CLOCK), notMeteredReading(), noWorkflow);
    expect(decision).toMatchObject({ outcome: 'routed', routeId: 'local-runner', usedFallback: true });
  });

  it('blocks with every rejection recorded when nothing can run', () => {
    const nothing = describeCiRouteAvailability(facts({
      hostedWorkflowPresent: false,
      dockerEngineAvailable: false,
      localRunnerPermitted: false,
      trustedWorkflowReady: false,
    }));
    const decision = decide('full-suite', seedCiRoutingConfig(CLOCK), notMeteredReading(), nothing);
    expect(decision.outcome).toBe('blocked');
    expect(decision.rejected).toHaveLength(2);
    for (const entry of decision.rejected) {
      expect(entry.reason.length).toBeGreaterThan(5);
    }
  });

  it('names the rule and explains itself in plain words on every decision', () => {
    for (const decision of decideAllCiRoutes(seedCiRoutingConfig(CLOCK), EVERYTHING_AVAILABLE, notMeteredReading())) {
      expect(decision.sentence.length).toBeGreaterThan(15);
      expect(decision.ruleId).toBeTruthy();
      expect(decision.workloadLabel).toBe(findCiWorkloadClass(decision.workload)?.label);
    }
  });

  it('reports an uncovered workload rather than inventing a route', () => {
    const sparse: CiRoutingConfig = { ...seedCiRoutingConfig(CLOCK), rules: [] };
    const decision = decide('full-suite', sparse);
    expect(decision.outcome).toBe('blocked');
    expect(decision.sentence).toContain('No rule covers');
  });
});

describe('CI routing policy — the file', () => {
  it('seeds a rule for every workload class', () => {
    const config = seedCiRoutingConfig(CLOCK);
    expect(config.rules).toHaveLength(CI_WORKLOAD_CLASSES.length);
    expect(validateCiRoutingConfig(config).filter(problem => problem.severity === 'error')).toEqual([]);
  });

  it('seeds no rule that would ever run unreviewed code locally', () => {
    for (const rule of seedCiRoutingConfig(CLOCK).rules) {
      if (findCiWorkloadClass(rule.workload)?.input !== 'untrusted') {
        continue;
      }
      for (const routeId of [rule.prefer, ...rule.fallback]) {
        expect(findCiRoute(routeId)?.capabilities.safeForUntrustedCode).toBe('yes');
      }
    }
  });

  it('drops a rule naming something that does not exist rather than repairing it', () => {
    const sanitized = sanitizeCiRoutingConfig({
      version: 1,
      rules: [
        { id: 'good', workload: 'fast-feedback', prefer: 'direct-local', fallback: [] },
        { id: 'bad-route', workload: 'fast-feedback', prefer: 'not-a-route', fallback: [] },
        { id: 'bad-workload', workload: 'not-a-workload', prefer: 'direct-local', fallback: [] },
        { id: 'good', workload: 'full-suite', prefer: 'github-hosted', fallback: [] },
      ],
    });
    expect(sanitized?.rules.map(rule => rule.id)).toEqual(['good']);
  });

  it('keeps unknown top-level fields so an older build cannot silently drop them', () => {
    const sanitized = sanitizeCiRoutingConfig({
      version: 1,
      rules: [],
      somethingNewerKnows: { keep: true },
    }) as Record<string, unknown> | undefined;
    expect(sanitized?.['somethingNewerKnows']).toEqual({ keep: true });
  });

  it('never keeps a fallback that repeats the preferred route', () => {
    const sanitized = sanitizeCiRoutingConfig({
      version: 1,
      rules: [{ id: 'r', workload: 'full-suite', prefer: 'github-hosted', fallback: ['github-hosted', 'local-runner'] }],
    });
    expect(sanitized?.rules[0]?.fallback).toEqual(['local-runner']);
  });

  it('warns about an uncovered workload and a duplicated one', () => {
    const config: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      rules: [
        { id: 'a', workload: 'fast-feedback', prefer: 'direct-local', fallback: [], onCreditExhausted: 'fallback' },
        { id: 'b', workload: 'fast-feedback', prefer: 'direct-local', fallback: [], onCreditExhausted: 'fallback' },
      ],
    };
    const problems = validateCiRoutingConfig(config);
    expect(problems.some(problem => /More than one rule covers/.test(problem.message))).toBe(true);
    expect(problems.filter(problem => /No rule covers/.test(problem.message))).toHaveLength(CI_WORKLOAD_CLASSES.length - 1);
  });

  it('warns rather than errors when a rule names a route with no adapter', () => {
    const config: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      // `woodpecker` rather than `act`: act gained an adapter, and a test whose
      // example quietly became implemented would stop testing the rule.
      rules: [{ id: 'a', workload: 'full-suite', prefer: 'woodpecker', fallback: [], onCreditExhausted: 'fallback' }],
    };
    const problems = validateCiRoutingConfig(config).filter(problem => problem.ruleId === 'a');
    expect(problems.some(problem => problem.severity === 'warning' && /no adapter/.test(problem.message))).toBe(true);
  });

  /**
   * The mirror publishes the rules that did the grading, as the debt register
   * does — including the one no file can change, since that is the rule
   * somebody reviewing this file most needs to know is not theirs to edit.
   */
  it('publishes the rule table and the trust invariant in the mirror', () => {
    const markdown = renderCiRoutingMarkdown(seedCiRoutingConfig(CLOCK));
    expect(markdown).toContain('One rule that no file can change');
    expect(markdown).toContain('safe for untrusted');
    for (const rule of seedCiRoutingConfig(CLOCK).rules) {
      expect(markdown).toContain(rule.id);
    }
    for (const workload of CI_WORKLOAD_CLASSES) {
      expect(markdown).toContain(workload.label);
    }
  });

  it('states what an unreadable meter will do', () => {
    expect(renderCiRoutingMarkdown(seedCiRoutingConfig(CLOCK)))
      .toContain('An unreadable meter is not an empty one.');
  });
});

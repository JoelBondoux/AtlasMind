import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CI_WORKLOAD_CLASSES,
  buildCiRoutingMatrix,
  cycleCiRoutingCell,
  decideAllCiRoutes,
  decideCiRoute,
  findCiWorkloadClass,
  toggleCiRoutingExhaustion,
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

  /**
   * The sanitizer keeps only the first rule carrying an id, so a duplicate
   * silently vanishes on the next read — after its author was told it saved.
   * The validator therefore reports it as an error, not a curiosity.
   */
  it('reports a duplicated rule id as an error', () => {
    const config: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      rules: [
        { id: 'same', workload: 'fast-feedback', prefer: 'direct-local', fallback: [], onCreditExhausted: 'fallback' },
        { id: 'same', workload: 'full-suite', prefer: 'github-hosted', fallback: [], onCreditExhausted: 'fallback' },
      ],
    };
    const problems = validateCiRoutingConfig(config);
    expect(problems.some(problem => problem.severity === 'error'
      && /only the first survives a reload/.test(problem.message))).toBe(true);
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

  /**
   * Packaging must produce the artifact that would ship, and artifact handling
   * is precisely what an approximate route emulates. A build that "passed"
   * without producing the thing it exists to produce is the wrong answer in the
   * expensive direction.
   */
  it('refuses an approximate route for work that cannot tolerate one', () => {
    const config: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      rules: [{ id: 'pack-via-act', workload: 'packaging', prefer: 'act', fallback: [], onCreditExhausted: 'fallback' }],
    };
    const decision = decideCiRoute({
      workload: 'packaging',
      config,
      availability: EVERYTHING_AVAILABLE,
      credit: notMeteredReading(),
    });
    expect(decision.outcome).toBe('blocked');
    expect(decision.rejected[0]?.reason).toContain('needs the real thing');

    expect(validateCiRoutingConfig(config)
      .some(problem => problem.severity === 'error' && /real thing/.test(problem.message))).toBe(true);
  });

  it('allows an approximate route where the workload tolerates one', () => {
    const config: CiRoutingConfig = {
      ...seedCiRoutingConfig(CLOCK),
      rules: [{ id: 'suite-via-act', workload: 'full-suite', prefer: 'act', fallback: [], onCreditExhausted: 'fallback' }],
    };
    const decision = decideCiRoute({
      workload: 'full-suite',
      config,
      availability: EVERYTHING_AVAILABLE,
      credit: notMeteredReading(),
    });
    expect(decision).toMatchObject({ outcome: 'routed', routeId: 'act' });
    expect(validateCiRoutingConfig(config).filter(problem => problem.ruleId === 'suite-via-act'
      && problem.severity === 'error')).toEqual([]);
  });

  it('publishes whether each workload tolerates an approximation', () => {
    const markdown = renderCiRoutingMarkdown(seedCiRoutingConfig(CLOCK));
    expect(markdown).toContain('Approximation');
    expect(markdown).toContain('not acceptable');
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

describe('the routing matrix', () => {
  const MATRIX = () => buildCiRoutingMatrix(seedCiRoutingConfig(CLOCK), EVERYTHING_AVAILABLE);

  function cell(rows: ReturnType<typeof buildCiRoutingMatrix>, workload: string, route: string) {
    return rows.find(row => row.workloadId === workload)?.cells.find(entry => entry.routeId === route);
  }

  it('covers every workload against every route', () => {
    const rows = MATRIX();
    expect(rows).toHaveLength(CI_WORKLOAD_CLASSES.length);
    for (const row of rows) {
      expect(row.cells).toHaveLength(CI_ROUTES.length);
    }
  });

  /**
   * The locked cells are the point as much as the chosen ones: the trust
   * invariant becomes visible law rather than a paragraph somebody has to find.
   */
  it('locks every unsafe route for unreviewed code, with the reason on the cell', () => {
    const rows = MATRIX();
    for (const route of CI_ROUTES) {
      const entry = cell(rows, 'untrusted-contribution', route.id);
      if (route.capabilities.safeForUntrustedCode === 'yes' && route.implementation === 'implemented') {
        expect(entry?.state).not.toBe('blocked');
      } else if (route.implementation === 'implemented') {
        expect(entry?.state).toBe('blocked');
        expect(entry?.reason).toContain('nobody has reviewed');
      }
    }
  });

  it('locks an approximate route where the workload demands the real thing', () => {
    const entry = cell(MATRIX(), 'packaging', 'act');
    expect(entry?.state).toBe('blocked');
    expect(entry?.reason).toContain('needs the real thing');
  });

  it('marks the preferred route and numbers the fallbacks in order', () => {
    const rows = MATRIX();
    expect(cell(rows, 'full-suite', 'github-hosted')?.state).toBe('preferred');
    expect(cell(rows, 'full-suite', 'local-runner')).toMatchObject({ state: 'fallback', order: 1 });
    expect(cell(rows, 'fast-feedback', 'direct-local')?.state).toBe('preferred');
  });

  /**
   * Policy and machine are separate questions. A route the rules allow but this
   * laptop cannot run is not the same as one the rules refuse, and collapsing
   * them would make a Docker outage look like a policy decision.
   */
  it('keeps "allowed by policy" apart from "usable on this machine"', () => {
    const noDocker = describeCiRouteAvailability(facts({ dockerEngineAvailable: false }));
    const rows = buildCiRoutingMatrix(seedCiRoutingConfig(CLOCK), noDocker);
    const entry = cell(rows, 'full-suite', 'local-runner');
    expect(entry?.state).toBe('fallback');
    expect(entry?.usableHere).toBe(false);
  });

  it('reports a route with no adapter as unimplemented rather than blocked', () => {
    expect(cell(MATRIX(), 'full-suite', 'buildkite')?.state).toBe('unimplemented');
  });
});

describe('editing the matrix', () => {
  /**
   * One gesture, three states: not in the rule, last resort, preferred. Every
   * step has to be describable in a sentence, because that sentence is what the
   * confirmation shows before a committed file changes.
   */
  it('cycles a cell through fallback, preferred, and out again', () => {
    let config = seedCiRoutingConfig(CLOCK);
    const added = cycleCiRoutingCell(config, 'full-suite', 'act');
    expect(added.ok).toBe(true);
    if (!added.ok) { return; }
    expect(added.config.rules.find(rule => rule.workload === 'full-suite')?.fallback).toContain('act');
    expect(added.change).toContain('fall back to act');

    const promoted = cycleCiRoutingCell(added.config, 'full-suite', 'act');
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) { return; }
    const rule = promoted.config.rules.find(entry => entry.workload === 'full-suite');
    expect(rule?.prefer).toBe('act');
    expect(rule?.fallback[0]).toBe('github-hosted');

    const removed = cycleCiRoutingCell(promoted.config, 'full-suite', 'act');
    expect(removed.ok).toBe(true);
    if (!removed.ok) { return; }
    const after = removed.config.rules.find(entry => entry.workload === 'full-suite');
    expect(after?.prefer).toBe('github-hosted');
    expect(after?.fallback).not.toContain('act');
  });

  /**
   * The grid must never author a rule the decision engine would refuse — the
   * same check runs in both places, so a locked cell is locked everywhere.
   */
  it('refuses to route unreviewed code anywhere unsafe, from the grid too', () => {
    const config = seedCiRoutingConfig(CLOCK);
    for (const routeId of ['direct-local', 'local-runner', 'act']) {
      const attempt = cycleCiRoutingCell(config, 'untrusted-contribution', routeId);
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) {
        expect(attempt.reason).toContain('nobody has reviewed');
      }
    }
  });

  it('refuses an approximate route for work that cannot tolerate one', () => {
    const attempt = cycleCiRoutingCell(seedCiRoutingConfig(CLOCK), 'packaging', 'act');
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      expect(attempt.reason).toContain('needs the real thing');
    }
  });

  it('refuses a route with no adapter', () => {
    const attempt = cycleCiRoutingCell(seedCiRoutingConfig(CLOCK), 'full-suite', 'buildkite');
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      expect(attempt.reason).toContain('no adapter');
    }
  });

  /** A rule with no preferred route is a workload with no answer. */
  it('refuses to remove the last route a workload has', () => {
    const config = seedCiRoutingConfig(CLOCK);
    const attempt = cycleCiRoutingCell(config, 'platform-matrix', 'github-hosted');
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      expect(attempt.reason).toContain('only route');
    }
  });

  it('creates a rule for an uncovered workload rather than refusing', () => {
    const sparse: CiRoutingConfig = { ...seedCiRoutingConfig(CLOCK), rules: [] };
    const created = cycleCiRoutingCell(sparse, 'full-suite', 'github-hosted');
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.config.rules).toHaveLength(1);
      expect(created.config.rules[0]).toMatchObject({ workload: 'full-suite', prefer: 'github-hosted', fallback: [] });
    }
  });

  it('never produces a config its own validator rejects', () => {
    let config = seedCiRoutingConfig(CLOCK);
    for (const [workload, route] of [['full-suite', 'act'], ['full-suite', 'act'], ['fast-feedback', 'local-runner']] as const) {
      const step = cycleCiRoutingCell(config, workload, route);
      if (step.ok) { config = step.config; }
    }
    expect(validateCiRoutingConfig(config).filter(problem => problem.severity === 'error')).toEqual([]);
  });

  it('flips what happens when the allowance runs out, and says which', () => {
    const flipped = toggleCiRoutingExhaustion(seedCiRoutingConfig(CLOCK), 'full-suite');
    expect(flipped.ok).toBe(true);
    if (flipped.ok) {
      expect(flipped.config.rules.find(rule => rule.workload === 'full-suite')?.onCreditExhausted).toBe('block');
      expect(flipped.change).toContain('stop rather than substitute');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { describeCommonRoutingNeeds } from '../../src/core/orchestrator.js';

/**
 * The routing signal, tested for the first time.
 *
 * Two artefacts previously implied this was covered and neither was:
 * `test/core/routing.test.ts` held nine real routing cases and **never
 * executed** — the runner only collects `tests/**`, and by the time anyone
 * looked, the `routeTask` API it drove had been removed without anything
 * failing. `tests/features/task-routing.test.ts` did run, and asserted against
 * a `determineAgent` stub defined inside the test file, so it could not fail for
 * any reason to do with the product.
 *
 * These cases are ported from the nine, against the seam that actually exists.
 * `describeCommonRoutingNeeds` is the regex fallback the orchestrator uses when
 * no model classification is available — the path taken on every local-model and
 * offline turn, which makes it the half most worth pinning.
 */
describe('a request implies the specialists it needs', () => {
  it('routes a code review request to review', () => {
    expect(describeCommonRoutingNeeds('Review this change for bugs and regressions before we merge it.'))
      .toContain('code review and PR feedback');
  });

  it('routes a security analysis request to security review', () => {
    expect(describeCommonRoutingNeeds('Run a security gap analysis and identify missing runtime protections.'))
      .toContain('security review');
  });

  it('routes a regression coverage request to testing', () => {
    expect(describeCommonRoutingNeeds('Add unit tests covering the regression we just fixed.'))
      .toContain('testing and coverage');
  });

  it('routes a licence question to legal', () => {
    expect(describeCommonRoutingNeeds('Is this dependency licence compatible with shipping commercially?'))
      .toContain('legal, licensing and regulatory risk');
  });

  it('routes a dark-pattern question to ethics', () => {
    expect(describeCommonRoutingNeeds('Is this checkout flow a dark pattern?'))
      .toContain('ethics and responsible technology');
  });

  it('routes a pricing question to commercial', () => {
    expect(describeCommonRoutingNeeds('What pricing strategy would suit this product commercially?'))
      .toContain('commercial viability and market position');
  });

  it('routes a documentation request to docs', () => {
    expect(describeCommonRoutingNeeds('Update the README and the wiki guide for this change.'))
      .toContain('documentation updates');
  });

  it('routes a root-cause request to debugging', () => {
    expect(describeCommonRoutingNeeds('Diagnose why this request fails intermittently in production.'))
      .toContain('debugging and root-cause analysis');
  });

  /**
   * The case the nine originally ended on: ordinary prose must not conjure a
   * specialist. A heuristic that matches everything routes everything, which is
   * the same as routing nothing.
   */
  it('infers nothing from a request that names no speciality', () => {
    expect(describeCommonRoutingNeeds('Tell me a bit about how this project is organised.'))
      .toEqual([]);
  });

  it('can infer more than one need from one request', () => {
    const needs = describeCommonRoutingNeeds('Review the authentication code for security vulnerabilities.');
    expect(needs).toContain('code review and PR feedback');
    expect(needs).toContain('security review');
  });

  it('does not repeat a label when several patterns in a family match', () => {
    const needs = describeCommonRoutingNeeds('security security vulnerability auth authentication');
    expect(new Set(needs).size).toBe(needs.length);
  });

  it('is empty for an empty message rather than throwing', () => {
    expect(describeCommonRoutingNeeds('')).toEqual([]);
  });
});

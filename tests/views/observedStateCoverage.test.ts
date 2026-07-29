import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Four times in four versions, a `WorkflowObservedState` field the curriculum
 * reads was never assigned — or was assigned a constant.
 *
 * - `workflowConfigPresent` was hardcoded `false`, so "declare your workflow"
 *   could never be completed by anybody, on any project.
 * - `hasDebtRegister` likewise, for "record what you deferred".
 * - `changelogHasCurrentVersion` was derived from the *file existing*, so the
 *   most commonly missing thing at release time always read as present.
 * - `ciStatus` was hardcoded `'none'`, so a project with a green build was told
 *   it had no check runs.
 * - `openDependencyPrCount`, `staleDocumentCount` and `requiredApprovers` were
 *   simply never set, so the steps reading them could not change state.
 *
 * Every one of those is the same bug: the guide asks somebody to do something
 * and then refuses to notice that they did. This test is what stops a fifth,
 * and it deliberately checks the *source*, because nothing in the type system
 * distinguishes a field that is assigned from one assigned a constant.
 */

const CURRICULUM = readFileSync(
  path.join(process.cwd(), 'src', 'core', 'workflowCurriculum.ts'),
  'utf8',
);

const PANEL = readFileSync(
  path.join(process.cwd(), 'src', 'views', 'projectDashboardPanel.ts'),
  'utf8',
);

/** Field names declared on `WorkflowObservedState`. */
function declaredFields(): string[] {
  const start = CURRICULUM.indexOf('export interface WorkflowObservedState {');
  expect(start, 'WorkflowObservedState is missing').toBeGreaterThan(-1);
  const end = CURRICULUM.indexOf('\n}', start);
  return [...CURRICULUM.slice(start, end).matchAll(/^\s{2}(\w+)\??:/gm)].map(match => match[1]!);
}

/** Fields any step actually reads, via `state.<field>`. */
function readFields(): Set<string> {
  return new Set([...CURRICULUM.matchAll(/\bstate\.(\w+)/g)].map(match => match[1]!));
}

/** The body of the `observed` literal in the panel. */
function observedLiteral(): string {
  const start = PANEL.indexOf('const observed: WorkflowObservedState = {');
  expect(start, 'the observed literal is missing').toBeGreaterThan(-1);
  const end = PANEL.indexOf('\n  };', start);
  return PANEL.slice(start, end);
}

describe('every observed field a step reads is actually supplied', () => {
  it('assigns each one somewhere in the observed literal', () => {
    const literal = observedLiteral();
    const missing = [...readFields()]
      .filter(field => declaredFields().includes(field))
      .filter(field => !new RegExp(`\\b${field}\\b`).test(literal));
    expect(missing, `never assigned: ${missing.join(', ')}`).toEqual([]);
  });

  it('does not assign a bare literal to a field that describes the repository', () => {
    // The subtler half. `ciStatus: 'none'` and `hasDebtRegister: false`
    // *were* assigned — to constants, which is a confident false statement
    // rather than a missing one. Fields whose value is a fact about the user's
    // project must come from somewhere.
    const literal = observedLiteral();
    const facts = [
      'ciStatus', 'hasDebtRegister', 'workflowConfigPresent', 'changelogHasCurrentVersion',
      'hasChangelog', 'hasCodeOwners', 'hasPullRequestTemplate', 'hasTestFiles',
      'hasIssueTemplates', 'hasTestReport', 'workingTreeClean', 'currentVersion',
      'currentBranch', 'ciWorkflowCount', 'commitsSinceLastTag',
    ];
    const constants = facts.filter(field => {
      const assignment = new RegExp(`^\\s*${field}:\\s*(true|false|'[^']*'|\\d+),\\s*$`, 'm');
      return assignment.test(literal);
    });
    expect(constants, `assigned a constant: ${constants.join(', ')}`).toEqual([]);
  });

  it('declares no field that no step reads', () => {
    // The other direction. A field nobody reads is one somebody meant to wire
    // up and did not, and it will read as deliberate to the next person.
    const read = readFields();
    const unread = declaredFields().filter(field => !read.has(field));
    expect(unread, `declared but never read: ${unread.join(', ')}`).toEqual([]);
  });
});

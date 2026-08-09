import { describe, expect, it } from 'vitest';

import {
  assessCiPortfolio,
  buildNodeCiStarter,
  inspectGithubActionsWorkflow,
} from '../../src/core/ciManager.ts';

describe('CI workflow inspection', () => {
  it('explains triggers, branch assignment, jobs, and safeguards without returning commands', () => {
    const summary = inspectGithubActionsWorkflow('.github/workflows/ci.yml', `name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches:
      - main
jobs:
  quality:
    name: Quality checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Test
        run: npm test -- --secret should-not-leak
permissions:
  contents: read
concurrency:
  cancel-in-progress: true
`);

    expect(summary.name).toBe('CI');
    expect(summary.role).toBe('quality');
    expect(summary.triggers).toEqual([
      { event: 'push', branches: ['main', 'develop'] },
      { event: 'pull_request', branches: ['main'] },
    ]);
    expect(summary.jobs).toEqual([{ id: 'quality', name: 'Quality checks', runsOn: 'ubuntu-latest', stepCount: 1, timeoutMinutes: 15 }]);
    expect(summary.validations).toContain('test');
    expect(summary.hasExplicitPermissions).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('should-not-leak');
  });

  it('reports what a readable but under-specified workflow needs', () => {
    const summary = inspectGithubActionsWorkflow('.github/workflows/check.yml', `name: Check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
`);
    const assessment = assessCiPortfolio([summary]);
    expect(assessment.state).toBe('unconfigured');
    expect(assessment.pullRequestCoverage).toBe(false);
    expect(assessment.cautions).toContain('No workflow checks pull requests before merge.');
    expect(summary.cautions).toContain('At least one job has no explicit timeout.');
    expect(summary.cautions).toContain('Token permissions are not declared explicitly.');
  });

  it('does not present absence as a healthy empty portfolio', () => {
    expect(assessCiPortfolio([])).toMatchObject({ state: 'unconfigured', workflowCount: 0 });
  });

  it('does not mistake release automation for quality CI', () => {
    const release = inspectGithubActionsWorkflow('.github/workflows/publish.yml', `name: Publish release
on:
  release:
    types: [published]
jobs:
  publish:
    runs-on: ubuntu-latest
      timeout-minutes: 10
    steps:
      - name: Build release artifact
        run: npm run build
permissions:
  contents: read
`);
    expect(release.role).toBe('delivery');
    expect(assessCiPortfolio([release])).toMatchObject({
      state: 'unconfigured',
      workflowCount: 1,
      qualityWorkflowCount: 0,
      deliveryWorkflowCount: 1,
    });
  });

  it('does not mistake pull-request labelling automation for quality CI', () => {
    const labeller = inspectGithubActionsWorkflow('.github/workflows/labels.yml', `name: Label pull requests
on: [pull_request]
jobs:
  labels:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/labeler@v6
permissions:
  pull-requests: write
`);
    expect(labeller.role).toBe('automation');
    expect(assessCiPortfolio([labeller])).toMatchObject({ state: 'unconfigured', qualityWorkflowCount: 0 });
  });
});

describe('Node CI starter', () => {
  it('builds a bounded create-only workflow from declared branches and scripts', () => {
    const plan = buildNodeCiStarter({
      branches: ['develop', 'main', '../../bad'],
      packageManager: 'npm',
      scripts: ['compile', 'lint', 'test', 'postinstall; curl bad'],
      nodeVersion: "20'\n      - run: curl bad",
    });
    expect(plan?.path).toBe('.github/workflows/ci.yml');
    expect(plan?.branches).toEqual(['develop', 'main']);
    expect(plan?.content).toContain("branches: ['develop', 'main']");
    expect(plan?.content).toContain('permissions:\n  contents: read');
    expect(plan?.content).toContain('timeout-minutes: 15');
    expect(plan?.content).toContain('run: npm run test');
    expect(plan?.content).not.toContain('postinstall');
    expect(plan?.content).not.toContain('../../bad');
    expect(plan?.content).not.toContain('curl bad');
    expect(plan?.content).toContain("node-version: '20'");
  });

  it('refuses to create a workflow that validates nothing', () => {
    expect(buildNodeCiStarter({ branches: ['main'], packageManager: 'npm', scripts: ['start'] })).toBeUndefined();
  });
});

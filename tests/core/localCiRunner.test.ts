import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_CI_MIN_CPUS,
  LOCAL_CI_MIN_MEMORY_GB,
  assessTrustedLocalCiWorkflow,
  normalizeLocalCiArch,
  parseDockerInfo,
  parseQueuedRuns,
  planLocalCiResources,
  registeredRunnerNames,
  resolveLocalCiRunnerLabel,
} from '../../src/core/localCiRunner.ts';

describe('local CI resource planning', () => {
  it('uses Docker capacity when it is lower than host capacity and preserves 25%', () => {
    const plan = planLocalCiResources(
      { cpuCount: 32, memoryGb: 64, os: 'win32', arch: 'x64' },
      { cpuCount: 8, memoryGb: 12, os: 'linux', arch: 'x64' },
      { maxCpus: 16, maxMemoryGb: 32 },
    );
    expect(plan).toMatchObject({
      cpus: 6,
      memoryGb: 9,
      reserveCpus: 2,
      reserveMemoryGb: 3,
      basedOn: 'docker-engine',
      provisional: false,
      blockers: [],
    });
  });

  it('applies the operator caps after reserving capacity', () => {
    const plan = planLocalCiResources(
      { cpuCount: 64, memoryGb: 128, os: 'linux', arch: 'arm64' },
      undefined,
      { maxCpus: 8, maxMemoryGb: 16 },
    );
    expect(plan.cpus).toBe(8);
    expect(plan.memoryGb).toBe(16);
    expect(plan.reserveCpus).toBe(16);
    expect(plan.reserveMemoryGb).toBe(32);
    expect(plan.provisional).toBe(true);
  });

  it('refuses a machine whose safe remainder is below the runner minimum', () => {
    const plan = planLocalCiResources(
      { cpuCount: 2, memoryGb: 4, os: 'darwin', arch: 'arm64' },
      undefined,
      { maxCpus: 8, maxMemoryGb: 16 },
    );
    expect(plan.cpus).toBeLessThan(LOCAL_CI_MIN_CPUS);
    expect(plan.memoryGb).toBeLessThan(LOCAL_CI_MIN_MEMORY_GB);
    expect(plan.blockers).toHaveLength(2);
  });
});

describe('local CI platform evidence', () => {
  it('normalizes the names used by Node, Docker and GitHub runner labels', () => {
    expect(normalizeLocalCiArch('amd64')).toBe('x64');
    expect(normalizeLocalCiArch('x86_64')).toBe('x64');
    expect(normalizeLocalCiArch('aarch64')).toBe('arm64');
    expect(resolveLocalCiRunnerLabel('atlasmind-trusted-linux-{arch}', 'aarch64'))
      .toBe('atlasmind-trusted-linux-arm64');
  });

  it('reads capacity from Docker rather than client-only placeholder output', () => {
    expect(parseDockerInfo(JSON.stringify({
      OSType: 'linux', Architecture: 'amd64', NCPU: 12, MemTotal: 17_179_869_184,
    }))).toMatchObject({ os: 'linux', arch: 'x64', cpuCount: 12, memoryGb: 16 });
    expect(parseDockerInfo(JSON.stringify({ OSType: '', Architecture: '', NCPU: 0, MemTotal: 0 })))
      .toBeUndefined();
  });
});

describe('trusted local workflow policy', () => {
  const input = {
    repoSlug: 'JoelBondoux/AtlasMind',
    branch: 'develop',
    runnerLabel: 'atlasmind-trusted-linux-x64',
  };

  it('accepts the repository workflow used by the tested local runner', () => {
    const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', 'trusted-local-ci.yml'), 'utf8');
    expect(assessTrustedLocalCiWorkflow(workflow, input)).toEqual({ ok: true, blockers: [], warnings: [] });
  });

  it('refuses pull-request reachability, secrets, write permission and moving action tags', () => {
    const unsafe = `name: Unsafe\n
on:\n
  pull_request:\n
  workflow_dispatch:\n
permissions:\n
  contents: write\n
jobs:\n
  ci:\n
    if: github.repository == 'JoelBondoux/AtlasMind' && github.ref == 'refs/heads/develop' && github.actor == github.repository_owner\n
    runs-on: [atlasmind-trusted-linux-x64]\n
    steps:\n
      - uses: actions/checkout@v4\n
      - run: echo \${{ secrets.DEPLOY_KEY }}\n`;
    const result = assessTrustedLocalCiWorkflow(unsafe, input);
    expect(result.ok).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/untrusted|write permission|secret|full commit SHA/i);
  });

  it('refuses two jobs sharing the one-job label', () => {
    const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', 'trusted-local-ci.yml'), 'utf8');
    const duplicated = workflow.replace(
      /\n    timeout-minutes:/,
      '\n  second-quality:\n    runs-on: [atlasmind-trusted-linux-x64]\n    steps: []\n\n    timeout-minutes:',
    );
    const result = assessTrustedLocalCiWorkflow(duplicated, input);
    expect(result.ok).toBe(false);
    expect(result.blockers.join(' ')).toMatch(/More than one job/);
  });
});

describe('queued-run and registration parsing', () => {
  it('keeps only well-formed queued runs', () => {
    const rows = parseQueuedRuns(JSON.stringify([
      {
        databaseId: 42,
        workflowName: 'Trusted local CI',
        displayTitle: 'test',
        event: 'push',
        headBranch: 'develop',
        headSha: 'a'.repeat(40),
        status: 'queued',
        createdAt: '2026-08-16T20:00:00Z',
      },
      { databaseId: 43, headSha: 'b'.repeat(40), status: 'completed' },
      { databaseId: 'not-a-number', headSha: 'c'.repeat(40), status: 'queued' },
    ]));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.databaseId).toBe(42);
  });

  it('finds only registrations carrying the dedicated label', () => {
    const raw = JSON.stringify({
      runners: [
        { name: 'trusted', labels: [{ name: 'atlasmind-trusted-linux-x64' }] },
        { name: 'ordinary', labels: [{ name: 'self-hosted' }] },
      ],
    });
    expect(registeredRunnerNames(raw, 'atlasmind-trusted-linux-x64')).toEqual(['trusted']);
    expect(registeredRunnerNames(JSON.stringify([JSON.parse(raw)]), 'atlasmind-trusted-linux-x64'))
      .toEqual(['trusted']);
    expect(registeredRunnerNames('not json', 'atlasmind-trusted-linux-x64')).toEqual([]);
  });
});

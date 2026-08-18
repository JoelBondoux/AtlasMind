import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTrustedLocalCiStarter } from '../../src/core/trustedLocalCiStarter.ts';
import {
  LOCAL_CI_MIN_CPUS,
  LOCAL_CI_MIN_MEMORY_GB,
  LocalCiRunnerManager,
  assessLocalCiQueue,
  assessTrustedLocalCiWorkflow,
  buildLocalCiQueueInvocation,
  initialLocalCiRunnerSnapshot,
  normalizeLocalCiArch,
  parseDockerGpuRuntimes,
  parseDockerInfo,
  parseQueuedRuns,
  planLocalCiResources,
  registeredRunnerNames,
  resolveLocalCiRunnerLabel,
  summarizeLocalCiGpuDevices,
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
  it('keeps unchecked prerequisites unknown instead of reporting them missing', () => {
    const snapshot = initialLocalCiRunnerSnapshot({
      enabled: true,
      workflowFile: 'trusted-local-ci.yml',
      trustedBranch: 'develop',
      runnerLabel: 'atlasmind-trusted-linux-{arch}',
      image: 'ghcr.io/actions/actions-runner@sha256:' + 'a'.repeat(64),
      shutdownPolicy: 'ifStartedByAtlasMind',
      maxCpus: 8,
      maxMemoryGb: 16,
    });
    expect(snapshot.prerequisites).toEqual({
      inspection: 'not-inspected',
      githubCliInstalled: false,
      githubAuthenticated: false,
    });
    expect(snapshot.lifecycle).toBe('not-inspected');
  });

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

  it('reports host GPU memory honestly and does not repeat a truncated Windows total', () => {
    expect(summarizeLocalCiGpuDevices([{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      totalBytes: 24 * 1024 ** 3,
      usedBytes: 8 * 1024 ** 3,
      freeBytes: 16 * 1024 ** 3,
    }])).toEqual([{
      index: 0,
      name: 'NVIDIA GeForce RTX 4090',
      totalGb: 24,
      usedGb: 8,
      freeGb: 16,
      measurement: 'live-memory',
    }]);
    expect(summarizeLocalCiGpuDevices([{
      name: 'Large GPU with truncated CIM value',
      totalBytes: 4_293_918_720,
      totalUntrustworthy: true,
    }])[0]).toMatchObject({ measurement: 'identity-only' });
    expect(summarizeLocalCiGpuDevices([{
      name: 'Large GPU with truncated CIM value',
      totalBytes: 4_293_918_720,
      totalUntrustworthy: true,
    }])[0]).not.toHaveProperty('totalGb');
  });

  it('distinguishes a Docker GPU runtime from GPU access granted to the runner', () => {
    expect(parseDockerGpuRuntimes(JSON.stringify({
      Runtimes: { runc: {}, ioContainerdRuncV2: {}, nvidia: {} },
      DefaultRuntime: 'runc',
    }))).toEqual({
      dockerRuntimeKnown: true,
      dockerRuntimeAvailable: true,
      dockerRuntimes: ['iocontainerdruncv2', 'nvidia', 'runc'],
    });
    expect(parseDockerGpuRuntimes('not json')).toEqual({
      dockerRuntimeKnown: false,
      dockerRuntimeAvailable: false,
      dockerRuntimes: [],
    });
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
  const queuedRun = (databaseId: number, headSha: string, status: 'queued' | 'pending' = 'queued') => ({
    databaseId,
    workflowName: 'Trusted local CI',
    displayTitle: 'test',
    event: 'workflow_dispatch',
    headBranch: 'develop',
    headSha,
    status,
    createdAt: '2026-08-16T20:00:00Z',
  });

  it('keeps well-formed queued and pending workflow runs', () => {
    const rows = parseQueuedRuns(JSON.stringify([
      queuedRun(42, 'a'.repeat(40)),
      queuedRun(44, 'd'.repeat(40), 'pending'),
      { databaseId: 43, headSha: 'b'.repeat(40), status: 'completed' },
      { databaseId: 'not-a-number', headSha: 'c'.repeat(40), status: 'queued' },
    ]));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.databaseId).toBe(42);
    expect(rows[1]?.databaseId).toBe(44);
  });

  it('accepts exactly one waiting run for the local commit', () => {
    const sha = 'a'.repeat(40);
    const run = parseQueuedRuns(JSON.stringify([queuedRun(42, sha, 'pending')]))[0]!;
    expect(assessLocalCiQueue([run], sha.toUpperCase(), 'develop')).toEqual({ ok: true, run });
  });

  it('explains when the waiting run is for the pushed branch rather than local work', () => {
    const localSha = 'a'.repeat(40);
    const remoteSha = 'b'.repeat(40);
    const run = parseQueuedRuns(JSON.stringify([queuedRun(42, remoteSha, 'pending')]))[0]!;
    const assessment = assessLocalCiQueue([run], localSha, 'develop');
    expect(assessment.ok).toBe(false);
    if (!assessment.ok) {
      expect(assessment.issue.kind).toBe('commit-mismatch');
      expect(assessment.issue.message).toContain(localSha.slice(0, 12));
      expect(assessment.issue.message).toContain(remoteSha.slice(0, 12));
      expect(assessment.issue.message).toContain('not uncommitted or unpushed local code');
    }
  });

  it('refuses a stale waiting run even when one exact run also exists', () => {
    const localSha = 'a'.repeat(40);
    const rows = parseQueuedRuns(JSON.stringify([
      queuedRun(42, localSha, 'pending'),
      queuedRun(43, 'b'.repeat(40)),
    ]));
    const assessment = assessLocalCiQueue(rows, localSha, 'develop');
    expect(assessment.ok).toBe(false);
    if (!assessment.ok) {
      expect(assessment.issue.kind).toBe('commit-mismatch');
      expect(assessment.issue.message).toContain('GitHub could assign any run that shares the label');
    }
  });

  it('requires one run when the same commit was dispatched twice', () => {
    const sha = 'a'.repeat(40);
    const rows = parseQueuedRuns(JSON.stringify([queuedRun(42, sha), queuedRun(43, sha, 'pending')]));
    const assessment = assessLocalCiQueue(rows, sha, 'develop');
    expect(assessment.ok).toBe(false);
    if (!assessment.ok) {
      expect(assessment.issue.kind).toBe('duplicates');
      expect(assessment.issue.message).toContain('leave exactly one');
    }
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

describe('trusted workflow review', () => {
  const configuration = {
    enabled: true,
    workflowFile: 'trusted-local-ci.yml',
    trustedBranch: 'develop',
    runnerLabel: 'atlasmind-trusted-linux-{arch}',
    image: 'ghcr.io/actions/actions-runner@sha256:' + 'a'.repeat(64),
    shutdownPolicy: 'ifStartedByAtlasMind' as const,
    maxCpus: 8,
    maxMemoryGb: 16,
  };

  async function workspaceWith(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'atlasmind-ci-'));
    await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(root, '.github', 'workflows', name), content, 'utf8');
    }
    return root;
  }

  function reviewerFor(root: string): LocalCiRunnerManager {
    return new LocalCiRunnerManager(root, configuration);
  }

  const goodWorkflow = buildTrustedLocalCiStarter({
    repoRemote: 'JoelBondoux/AtlasMind',
    trustedBranch: 'develop',
    runnerLabel: 'atlasmind-trusted-linux-x64',
    workflowFile: 'trusted-local-ci.yml',
    packageManager: 'npm',
    scripts: ['compile', 'lint', 'test'],
    nodeVersion: '22',
  });

  it('accepts the workflow AtlasMind generates', async () => {
    expect(goodWorkflow.ok).toBe(true);
    if (!goodWorkflow.ok) { return; }
    const root = await workspaceWith({ 'trusted-local-ci.yml': goodWorkflow.plan.content });
    const review = await reviewerFor(root).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(review).toMatchObject({ state: 'ok', blockers: [], scaffoldable: false });
  });

  /**
   * A missing file is an offer to create one; anything else is not. Collapsing
   * the two would mean offering to "create" over a file that exists but could
   * not be read, which is the one case where creating is destructive.
   */
  it('reports an absent workflow as scaffoldable and nothing else as scaffoldable', async () => {
    const empty = await workspaceWith({});
    const missing = await reviewerFor(empty).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(missing).toMatchObject({ state: 'missing', scaffoldable: true });

    const bad = await workspaceWith({ 'trusted-local-ci.yml': 'name: not a trusted workflow\n' });
    const blocked = await reviewerFor(bad).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(blocked.state).toBe('blocked');
    expect(blocked.scaffoldable).toBe(false);
    expect(blocked.blockers.length).toBeGreaterThan(1);
  });

  it('reports every failed rule separately rather than as one sentence', async () => {
    const bad = await workspaceWith({ 'trusted-local-ci.yml': 'name: x\non:\n  push:\n    branches: [develop]\njobs:\n  a:\n    runs-on: [atlasmind-trusted-linux-x64]\n' });
    const review = await reviewerFor(bad).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(review.blockers.length).toBeGreaterThanOrEqual(3);
    for (const blocker of review.blockers) {
      expect(blocker).not.toBe('');
      expect(blocker.length).toBeLessThan(400);
    }
  });

  /**
   * The label is routing, not authorization: another workflow naming it could
   * have a job claim this machine, however impeccable the reviewed file is.
   */
  it('refuses when another workflow file claims the same runner label', async () => {
    if (!goodWorkflow.ok) { return; }
    const root = await workspaceWith({
      'trusted-local-ci.yml': goodWorkflow.plan.content,
      'sneaky.yml': 'name: other\njobs:\n  x:\n    runs-on: [atlasmind-trusted-linux-x64]\n',
    });
    const review = await reviewerFor(root).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(review.state).toBe('blocked');
    expect(review.blockers.join(' ')).toContain('sneaky.yml');
  });

  it('refuses a workflow filename that could leave the workflows directory', async () => {
    const root = await workspaceWith({});
    const review = await reviewerFor(root).reviewWorkflow(
      { ...configuration, workflowFile: '../../../etc/passwd' },
      'JoelBondoux/AtlasMind',
      'atlasmind-trusted-linux-x64',
    );
    expect(review).toMatchObject({ state: 'unreadable', scaffoldable: false });
  });

  it('refuses to review against an unresolved runner label', async () => {
    if (!goodWorkflow.ok) { return; }
    const root = await workspaceWith({ 'trusted-local-ci.yml': goodWorkflow.plan.content });
    const review = await reviewerFor(root).reviewWorkflow(configuration, 'JoelBondoux/AtlasMind', '');
    expect(review).toMatchObject({ state: 'unreadable', scaffoldable: false });
  });

  it('refuses a workflow written for a different repository', async () => {
    if (!goodWorkflow.ok) { return; }
    const root = await workspaceWith({ 'trusted-local-ci.yml': goodWorkflow.plan.content });
    const review = await reviewerFor(root).reviewWorkflow(configuration, 'SomebodyElse/AtlasMind', 'atlasmind-trusted-linux-x64');
    expect(review.state).toBe('blocked');
    expect(review.blockers.join(' ')).toContain('SomebodyElse/AtlasMind');
  });
});

describe('local CI queue command', () => {
  it('builds one shell-neutral command from validated settings', () => {
    expect(buildLocalCiQueueInvocation({ workflowFile: 'trusted-local-ci.yml', trustedBranch: 'develop' }))
      .toEqual({
        command: 'gh',
        args: ['workflow', 'run', 'trusted-local-ci.yml', '--ref', 'develop'],
      });
  });

  it('refuses settings that could compose another shell command', () => {
    expect(buildLocalCiQueueInvocation({ workflowFile: 'trusted-local-ci.yml;whoami', trustedBranch: 'develop' }))
      .toBeUndefined();
    expect(buildLocalCiQueueInvocation({ workflowFile: 'trusted-local-ci.yml', trustedBranch: 'develop && whoami' }))
      .toBeUndefined();
  });
});

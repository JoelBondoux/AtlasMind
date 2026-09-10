import { describe, expect, it } from 'vitest';
import {
  REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_RUNNER_PATH,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
  assessLocalCiPatchTargets,
  assessManagedReviewedPrLocalCiFiles,
  buildLocalCiRepositoryPatch,
  buildReviewedPrLocalCiRunnerScript,
  buildReviewedPrLocalCiWorkflow,
  type LocalCiRepositoryPatchPlan,
} from '../../src/core/localCiRepositoryPatch.ts';
import { assessTrustedLocalCiWorkflow } from '../../src/core/localCiRunner.ts';

function build(overrides: Partial<Parameters<typeof buildLocalCiRepositoryPatch>[0]> = {}) {
  return buildLocalCiRepositoryPatch({
    repository: 'JoelBondoux/LookDesigner-Pro',
    trustedBaseBranch: 'develop',
    architecture: 'x64',
    nodeVersion: '22',
    packageJsonText: JSON.stringify({
      scripts: {
        'ci:local': 'npm run compile && npm run lint && npm test',
        deploy: 'wrangler deploy',
      },
    }),
    workspaceFiles: ['package.json', 'package-lock.json'],
    ...overrides,
  });
}

function planOf(): LocalCiRepositoryPatchPlan {
  const outcome = build();
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.plan;
}

describe('buildLocalCiRepositoryPatch', () => {
  it('builds an enabled shell-free Node contract from one lockfile and a safe aggregate script', () => {
    const plan = planOf();

    expect(plan.enabled).toBe(true);
    expect(plan.config.controllerNodeVersion).toBe('22');
    expect(plan.config.commands).toEqual([
      { label: 'Install locked dependencies', command: 'npm', args: ['ci'], timeoutMinutes: 20 },
      { label: 'Run ci:local', command: 'npm', args: ['run', 'ci:local'], timeoutMinutes: 45 },
    ]);
    expect(plan.files.map(file => file.path)).toEqual([
      REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
      REVIEWED_PR_LOCAL_CI_RUNNER_PATH,
      REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
    ]);
  });

  it('keeps the producer outside the trust decision and emits a manual exact-SHA workflow', () => {
    const plan = planOf();
    const workflow = buildReviewedPrLocalCiWorkflow(plan.config);

    expect(workflow).toContain(REVIEWED_PR_LOCAL_CI_MARKER);
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain('inputs.head_repo == github.repository');
    expect(workflow).toContain('AtlasMind local CI PR #${{ inputs.pr_number }} @ ${{ inputs.pr_sha }}');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('ref: ${{ inputs.pr_sha }}');
    expect(workflow).toContain('APPROVED_PR_SHA: ${{ inputs.pr_sha }}');
    expect(workflow).not.toContain('[[ "${{ inputs.pr_sha }}"');
    expect(workflow).toContain('Codex, Claude, another agent, and a human');
    expect(workflow).not.toMatch(/^\s{2}push:/m);
    expect(workflow).not.toMatch(/\bpull_request(?:_target)?\b/);
    expect(workflow).not.toContain('secrets.');

    expect(assessTrustedLocalCiWorkflow(workflow, {
      repoSlug: plan.repository,
      branch: plan.trustedBaseBranch,
      runnerLabel: plan.runnerLabel,
    })).toMatchObject({ ok: true, blockers: [] });
  });

  it('does not infer outward publishing or deployment scripts', () => {
    const outcome = build({
      packageJsonText: JSON.stringify({ scripts: { ci: 'npm run test && wrangler deploy' } }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.enabled).toBe(false);
    expect(outcome.plan.config.commands).toEqual([]);
    expect(outcome.plan.detectionDetail).toMatch(/No safe/i);
  });

  it('fails closed when package-manager ownership is ambiguous', () => {
    const outcome = build({ workspaceFiles: ['package.json', 'package-lock.json', 'pnpm-lock.yaml'] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.enabled).toBe(false);
    expect(outcome.plan.detectionDetail).toContain('More than one package-manager lockfile');
  });

  it('can patch a non-Node repository without pretending it knows the commands', () => {
    const outcome = build({ packageJsonText: undefined, workspaceFiles: ['Cargo.toml'] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.enabled).toBe(false);
    expect(outcome.plan.config.detection.kind).toBe('custom');
    expect(outcome.plan.config.commands).toEqual([]);
  });

  it('never overwrites an unrelated file and may refresh only its own marked files', () => {
    const plan = planOf();
    const existing = new Map<string, string | undefined>([
      [REVIEWED_PR_LOCAL_CI_CONFIG_PATH, undefined],
      [REVIEWED_PR_LOCAL_CI_RUNNER_PATH, `// ${REVIEWED_PR_LOCAL_CI_MARKER}\nold`],
      [REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH, 'name: hand-written workflow\n'],
    ]);
    expect(assessLocalCiPatchTargets(plan, existing).map(target => target.state)).toEqual([
      'create', 'replace-managed', 'conflict',
    ]);
  });

  it('requires both executable controller files to match the current generator exactly', () => {
    const plan = planOf();
    const runner = buildReviewedPrLocalCiRunnerScript();
    const workflow = buildReviewedPrLocalCiWorkflow(plan.config);

    expect(assessManagedReviewedPrLocalCiFiles(plan.config, runner, workflow)).toEqual({ ok: true, blockers: [] });
    const drifted = assessManagedReviewedPrLocalCiFiles(plan.config, `${runner}\n// changed`, workflow);
    expect(drifted.ok).toBe(false);
    expect(drifted.blockers[0]).toContain(REVIEWED_PR_LOCAL_CI_RUNNER_PATH);
  });

  it('generates a runner that never invokes a shell and passes only a narrow environment', () => {
    const runner = buildReviewedPrLocalCiRunnerScript();
    expect(runner).toContain("shell: false");
    expect(runner).toContain("detached: process.platform !== 'win32'");
    expect(runner).toContain("NPM_CONFIG_CACHE");
    expect(runner).toContain("invokes a shell");
    expect(runner).toContain("'bash'");
    expect(runner).not.toContain('env: process.env');
    expect(runner).not.toContain('GITHUB_TOKEN');
    expect(runner).not.toContain('exec(');
  });
});

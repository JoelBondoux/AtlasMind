import { describe, expect, it } from 'vitest';
import {
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
  type ReviewedPrLocalCiConfig,
} from '../../src/core/localCiRepositoryPatch.ts';
import {
  assessReviewedPrCandidate,
  buildReviewedPrApprovalCopy,
  buildReviewedPrDispatchArgs,
  buildReviewedPrStatusArgs,
  parseReviewedPrCandidates,
  parseReviewedPrLocalCiConfig,
  parseReviewedPrRunReading,
  type ReviewedPrCandidate,
} from '../../src/core/reviewedPrLocalCi.ts';

const SHA = 'a'.repeat(40);

function config(): ReviewedPrLocalCiConfig {
  return {
    schemaVersion: 1,
    managedBy: REVIEWED_PR_LOCAL_CI_MARKER,
    enabled: true,
    repository: 'JoelBondoux/LookDesigner-Pro',
    trustedBaseBranch: 'develop',
    workflowFile: REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
    runnerLabel: 'atlasmind-reviewed-pr-x64',
    statusContext: REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
    controllerNodeVersion: '22',
    evidence: 'linux-container',
    allowForks: false,
    commands: [{ label: 'Test', command: 'npm', args: ['test'], timeoutMinutes: 45 }],
    detection: { kind: 'node', packageManager: 'npm', detail: 'Detected npm.' },
  };
}

function candidate(overrides: Partial<ReviewedPrCandidate> = {}): ReviewedPrCandidate {
  return {
    number: 42,
    title: 'Agent-authored mobile editor fix',
    url: 'https://github.com/JoelBondoux/LookDesigner-Pro/pull/42',
    author: 'some-agent-or-human',
    isDraft: false,
    baseBranch: 'develop',
    headBranch: 'feature/mobile-editor',
    headSha: SHA,
    headRepository: 'JoelBondoux/LookDesigner-Pro',
    ...overrides,
  };
}

describe('reviewed PR local CI policy', () => {
  it('parses only an enabled, strict schema-one contract', () => {
    expect(parseReviewedPrLocalCiConfig(JSON.stringify(config()))).toEqual({ ok: true, config: config() });
    expect(parseReviewedPrLocalCiConfig(JSON.stringify({ ...config(), enabled: false }))).toMatchObject({ ok: false });
    expect(parseReviewedPrLocalCiConfig(JSON.stringify({ ...config(), allowForks: true }))).toMatchObject({ ok: false });
    expect(parseReviewedPrLocalCiConfig(JSON.stringify({ ...config(), controllerNodeVersion: 'latest' }))).toMatchObject({ ok: false });
    expect(parseReviewedPrLocalCiConfig(JSON.stringify({
      ...config(), commands: [{ label: 'Bad', command: 'npm test; deploy', args: [], timeoutMinutes: 1 }],
    }))).toMatchObject({ ok: false });
    expect(parseReviewedPrLocalCiConfig(JSON.stringify({
      ...config(), commands: [{ label: 'Shell', command: '/bin/bash', args: ['-lc', 'npm test'], timeoutMinutes: 1 }],
    }))).toMatchObject({ ok: false });
  });

  it('parses the bounded GitHub CLI shape, including owner plus repository name', () => {
    const parsed = parseReviewedPrCandidates(JSON.stringify({
      number: 42,
      title: 'Fix',
      url: 'https://github.com/JoelBondoux/LookDesigner-Pro/pull/42',
      author: { login: 'codex-agent' },
      isDraft: false,
      baseRefName: 'develop',
      headRefName: 'agent/fix',
      headRefOid: SHA.toUpperCase(),
      headRepository: { name: 'LookDesigner-Pro' },
      headRepositoryOwner: { login: 'JoelBondoux' },
    }));
    expect(parsed).toEqual([expect.objectContaining({
      number: 42,
      author: 'codex-agent',
      headSha: SHA,
      headRepository: 'JoelBondoux/LookDesigner-Pro',
    })]);
  });

  it('authorises identity and exact SHA, never the name of the producer', () => {
    expect(assessReviewedPrCandidate(config(), candidate())).toMatchObject({ allowed: true });
    expect(assessReviewedPrCandidate(config(), candidate({ isDraft: true })).blockers).toContainEqual(expect.stringMatching(/Draft/));
    expect(assessReviewedPrCandidate(config(), candidate({ baseBranch: 'main' })).blockers).toContainEqual(expect.stringMatching(/trusted base/));
    expect(assessReviewedPrCandidate(config(), candidate({ headRepository: 'someone/fork' })).blockers).toContainEqual(expect.stringMatching(/Fork/));

    const copy = buildReviewedPrApprovalCopy(config(), candidate());
    expect(copy.approveLabel).toContain(SHA.slice(0, 12));
    expect(copy.detail).toContain(`Exact head SHA: ${SHA}`);
    expect(copy.detail).toContain('Codex, Claude, another agentic service, and a human');
    expect(copy.detail).toContain('outbound network access');
    expect(copy.detail).toContain('not a substitute for reviewing');
  });

  it('dispatches and publishes status only for the exact candidate SHA', () => {
    expect(buildReviewedPrDispatchArgs(config(), candidate())).toEqual([
      'workflow', 'run', REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
      '--ref', 'develop',
      '--field', 'pr_number=42',
      '--field', `pr_sha=${SHA}`,
      '--field', 'head_repo=JoelBondoux/LookDesigner-Pro',
    ]);
    const status = buildReviewedPrStatusArgs(config(), candidate(), 'pending', 'waiting\nnow', candidate().url);
    expect(status).toContain(`repos/JoelBondoux/LookDesigner-Pro/statuses/${SHA}`);
    expect(status).toContain('context=AtlasMind/local-ci');
    expect(status).toContain('description=waiting now');
  });

  it('does not turn an unreadable or incomplete run result into success', () => {
    expect(parseReviewedPrRunReading('not json')).toEqual({ status: 'unknown', conclusion: '' });
    expect(parseReviewedPrRunReading(JSON.stringify({ status: 'completed', conclusion: 'success', url: 'https://github.com/x/y/actions/runs/1' })))
      .toEqual({ status: 'completed', conclusion: 'success', url: 'https://github.com/x/y/actions/runs/1' });
  });
});

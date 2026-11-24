import { describe, expect, it } from 'vitest';
import {
  REVIEWED_PR_LOCAL_CI_MARKER,
  REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
  REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
  type ReviewedPrLocalCiConfig,
} from '../../src/core/localCiRepositoryPatch.ts';
import {
  STALE_REVIEWED_PR_WAIT_MS,
  assessReviewedPrCandidate,
  buildReviewedPrApprovalCopy,
  buildReviewedPrDispatchArgs,
  buildReviewedPrStatusArgs,
  describeReviewedPrContractProblem,
  describeWaitingReviewedPrRun,
  parseReviewedPrCandidates,
  parseReviewedPrLocalCiConfig,
  parseReviewedPrRunReading,
  parseReviewedPrRunTitle,
  parseReviewedPrWaitingRuns,
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

  /**
   * The pin is what lets an organisation-owned repository dispatch at all, and
   * the workflow is regenerated from it before every run, so a malformed one is
   * a refusal, never a pin quietly dropped back to the owner condition.
   */
  it('keeps a valid pinned account and refuses a malformed one', () => {
    const pinned = { ...config(), authorizedAccount: { id: 6105707, login: 'JoelBondoux' } };
    expect(parseReviewedPrLocalCiConfig(JSON.stringify(pinned))).toEqual({ ok: true, config: pinned });
    for (const authorizedAccount of [
      null,
      { id: '6105707', login: 'JoelBondoux' },
      { id: 6105707 },
      { id: 6105707, login: 'Joel Bondoux' },
    ]) {
      expect(parseReviewedPrLocalCiConfig(JSON.stringify({ ...config(), authorizedAccount })))
        .toMatchObject({ ok: false, reason: expect.stringMatching(/authorised account/) });
    }
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

  /**
   * `enabled: false` hides two facts: the patcher found no deterministic install
   * and wrote a disabled contract, or a person switched it off. The fix differs,
   * so the reason must name which.
   */
  it('says why a disabled contract is disabled', () => {
    const noCommands = parseReviewedPrLocalCiConfig(JSON.stringify({
      ...config(), enabled: false, commands: [], detection: { kind: 'unknown', detail: 'No supported lockfile.' },
    }));
    expect(noCommands).toMatchObject({ ok: false, reason: expect.stringMatching(/declares no commands \(No supported lockfile\.\)/) });
    const switchedOff = parseReviewedPrLocalCiConfig(JSON.stringify({ ...config(), enabled: false }));
    expect(switchedOff).toMatchObject({ ok: false, reason: expect.stringMatching(/set "enabled": true/) });
    expect((switchedOff as { reason: string }).reason).not.toMatch(/declares no commands/);
  });

  it('names the folder and file when the contract is missing or unreadable', () => {
    const missing = describeReviewedPrContractProblem({ folderName: 'joelbondoux-platform', root: 'C:\\Dev\\Platform', missing: true });
    expect(missing).toContain('joelbondoux-platform (C:\\Dev\\Platform)');
    expect(missing).toContain('.atlasmind/local-ci.json is absent');
    expect(missing).toMatch(/Open the repository you meant to run/);
    const broken = describeReviewedPrContractProblem({ folderName: 'Site', root: '/w/site', reason: 'The contract is disabled.' });
    expect(broken).toContain('Cannot run from Site (/w/site): The contract is disabled.');
    expect(broken).toContain('.atlasmind/local-ci.json');
  });

  it('parses waiting runs from the bounded CLI shape and drops anything else', () => {
    const rows = parseReviewedPrWaitingRuns(JSON.stringify([
      { databaseId: 45, headSha: SHA.toUpperCase(), status: 'queued', event: 'workflow_dispatch', displayTitle: `AtlasMind local CI PR #73 @ ${SHA}`, createdAt: '2026-11-24T03:53:00Z' },
      { databaseId: 46, headSha: SHA, status: 'in_progress', event: 'workflow_dispatch', displayTitle: 'x', createdAt: 'not a date' },
      { databaseId: 47, headSha: SHA, status: 'completed', event: 'workflow_dispatch', displayTitle: 'done' },
      { databaseId: 'nope', headSha: SHA, status: 'queued', event: 'workflow_dispatch', displayTitle: 'bad id' },
      { databaseId: 48, headSha: 'short', status: 'queued', event: 'workflow_dispatch', displayTitle: 'bad sha' },
    ]));
    expect(rows).toEqual([
      { databaseId: 45, headSha: SHA, status: 'queued', event: 'workflow_dispatch', displayTitle: `AtlasMind local CI PR #73 @ ${SHA}`, createdAt: '2026-11-24T03:53:00Z' },
      { databaseId: 46, headSha: SHA, status: 'in_progress', event: 'workflow_dispatch', displayTitle: 'x' },
    ]);
    expect(parseReviewedPrWaitingRuns('not json')).toEqual([]);
    expect(parseReviewedPrWaitingRuns('{}')).toEqual([]);
  });

  it('reads the PR and SHA back only from a title the workflow itself wrote', () => {
    expect(parseReviewedPrRunTitle(`AtlasMind local CI PR #73 @ ${SHA}`)).toEqual({ number: 73, headSha: SHA });
    expect(parseReviewedPrRunTitle('AtlasMind local CI PR #73 @ abc')).toBeUndefined();
    expect(parseReviewedPrRunTitle('Something else')).toBeUndefined();
  });

  /**
   * The dialog lists runs in words, not ids: which PR, how long it has waited,
   * and whether that wait means no runner ever came.
   */
  it('describes a waiting run in plain words and marks a long wait as stale', () => {
    const now = Date.parse('2026-11-24T05:00:00Z');
    const fresh = describeWaitingReviewedPrRun({
      databaseId: 45, headSha: SHA, status: 'queued', event: 'workflow_dispatch',
      displayTitle: `AtlasMind local CI PR #73 @ ${SHA}`, createdAt: '2026-11-24T04:55:00Z',
    }, now);
    expect(fresh.label).toBe(`Run 45 · PR #73 @ ${SHA.slice(0, 12)}`);
    expect(fresh.description).toMatch(/^waiting 5 min · no runner has picked it up yet$/);
    expect(fresh.stale).toBe(false);

    const stale = describeWaitingReviewedPrRun({
      databaseId: 46, headSha: SHA, status: 'queued', event: 'workflow_dispatch', displayTitle: 'hand run',
      createdAt: new Date(now - STALE_REVIEWED_PR_WAIT_MS - 60_000).toISOString(),
    }, now);
    expect(stale.label).toBe('Run 46 · hand run');
    expect(stale.description).toMatch(/waiting 31 min · never picked up — stale/);
    expect(stale.stale).toBe(true);

    const dayOld = describeWaitingReviewedPrRun({
      databaseId: 47, headSha: SHA, status: 'queued', event: 'workflow_dispatch', displayTitle: '',
      createdAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    }, now);
    expect(dayOld.label).toBe('Run 47');
    expect(dayOld.description).toContain('waiting 26 h');

    const running = describeWaitingReviewedPrRun({
      databaseId: 48, headSha: SHA, status: 'in_progress', event: 'workflow_dispatch', displayTitle: '',
    }, now);
    expect(running.description).toBe('running now · started age unknown ago');
    expect(running.stale).toBe(false);
  });
});

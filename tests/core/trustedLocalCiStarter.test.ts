import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  TRUSTED_LOCAL_CI_ACTIONS_REVIEWED,
  buildTrustedLocalCiStarter,
  type TrustedLocalCiStarterInput,
} from '../../src/core/trustedLocalCiStarter.ts';
import { assessTrustedLocalCiWorkflow } from '../../src/core/localCiRunner.ts';

function baseInput(overrides: Partial<TrustedLocalCiStarterInput> = {}): TrustedLocalCiStarterInput {
  return {
    repoRemote: 'JoelBondoux/AtlasMind',
    trustedBranch: 'develop',
    runnerLabel: 'atlasmind-trusted-linux-x64',
    workflowFile: 'trusted-local-ci.yml',
    packageManager: 'npm',
    scripts: ['compile', 'lint', 'test', 'package'],
    nodeVersion: '22',
    ...overrides,
  };
}

function planOf(input: TrustedLocalCiStarterInput) {
  const outcome = buildTrustedLocalCiStarter(input);
  if (!outcome.ok) {
    throw new Error(`expected a plan, got refusal: ${outcome.reason}`);
  }
  return outcome.plan;
}

describe('trusted local CI starter', () => {
  it('produces a workflow the runner’s own safety check accepts', () => {
    const plan = planOf(baseInput());
    const assessment = assessTrustedLocalCiWorkflow(plan.content, {
      repoSlug: 'JoelBondoux/AtlasMind',
      branch: 'develop',
      runnerLabel: 'atlasmind-trusted-linux-x64',
    });
    expect(assessment.blockers).toEqual([]);
    expect(assessment.ok).toBe(true);
  });

  /**
   * The rule this module exists to keep. The shipped documentation template
   * drifted from the validator and would have failed three of its rules; prose
   * cannot be tested, so the generator is held to the validator directly, over
   * inputs nobody chose by hand.
   */
  it('never emits a workflow its own validator rejects, for any valid input', () => {
    // The generators describe the domain the builder promises to serve — a
    // GitHub-legal owner, and a branch that survives the shape rules shared
    // with the hosted starter. Values outside it are refusals by design and
    // are covered below; generating them here would only re-test the refusal.
    fc.assert(fc.property(
      fc.record({
        owner: fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,18}[A-Za-z0-9])?$/),
        repo: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,20}$/),
        branch: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,18}[A-Za-z0-9]$/)
          .filter(value => !value.includes('..') && !value.includes('//') && !value.endsWith('.lock')),
        label: fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/),
        packageManager: fc.constantFrom('npm' as const, 'pnpm' as const, 'yarn' as const),
        scripts: fc.subarray(['compile', 'build', 'lint', 'test'], { minLength: 1 }),
        nodeVersion: fc.constantFrom(undefined, '18', '20', '22.11.0'),
      }),
      sample => {
        const outcome = buildTrustedLocalCiStarter(baseInput({
          repoRemote: `${sample.owner}/${sample.repo}`,
          trustedBranch: sample.branch,
          runnerLabel: sample.label,
          packageManager: sample.packageManager,
          scripts: sample.scripts,
          ...(sample.nodeVersion === undefined ? {} : { nodeVersion: sample.nodeVersion }),
        }));
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) {
          return;
        }
        const assessment = assessTrustedLocalCiWorkflow(outcome.plan.content, {
          repoSlug: `${sample.owner}/${sample.repo}`,
          branch: sample.branch,
          runnerLabel: sample.label,
        });
        expect(assessment.blockers).toEqual([]);
      },
    ), { numRuns: 300 });
  });

  it('pins every action to a full commit SHA and emits no moving tag', () => {
    const plan = planOf(baseInput());
    const refs = [...plan.content.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)].map(match => match[1] ?? '');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/@[a-f0-9]{40}$/);
    }
    expect(plan.pinnedActions.map(action => action.sha)).toEqual([
      TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout.sha,
      TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode.sha,
    ]);
  });

  /**
   * A pin is only as good as the review behind it. Reusing one action's
   * reviewed SHA for a different action would be a fabricated pin wearing a
   * real one's clothes, which is how the first draft of this module was wrong.
   */
  it('never reuses one action’s reviewed SHA for a different action', () => {
    for (const packageManager of ['npm', 'pnpm', 'yarn'] as const) {
      const plan = planOf(baseInput({ packageManager }));
      const pairs = [...plan.content.matchAll(/^\s*uses:\s*([^@\s]+)@([a-f0-9]{40})\s*$/gm)]
        .map(match => ({ action: match[1] ?? '', sha: match[2] ?? '' }));
      const shaOwners = new Map<string, Set<string>>();
      for (const pair of pairs) {
        shaOwners.set(pair.sha, (shaOwners.get(pair.sha) ?? new Set()).add(pair.action));
      }
      for (const [, actions] of shaOwners) {
        expect(actions.size).toBe(1);
      }
    }
  });

  it('carries no secret reference and no write permission', () => {
    const plan = planOf(baseInput());
    expect(plan.content).not.toMatch(/\$\{\{\s*secrets\./i);
    expect(plan.content).not.toMatch(/^[ \t]+[A-Za-z-]+:\s*write\s*$/m);
    expect(plan.content).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('routes exactly one job to the runner label', () => {
    const plan = planOf(baseInput());
    const routed = [...plan.content.matchAll(/runs-on:/g)];
    expect(routed).toHaveLength(1);
    expect(plan.content).toContain('runs-on: [atlasmind-trusted-linux-x64]');
  });

  it('requires the repository, the exact ref, and the owner as the actor', () => {
    const plan = planOf(baseInput());
    expect(plan.content).toContain("github.repository == 'JoelBondoux/AtlasMind'");
    expect(plan.content).toContain("github.ref == 'refs/heads/develop'");
    expect(plan.content).toContain('github.actor == github.repository_owner');
  });

  it('accepts a remote URL as readily as a slug, and agrees with itself', () => {
    const fromUrl = planOf(baseInput({ repoRemote: 'https://github.com/JoelBondoux/AtlasMind.git' }));
    const fromSsh = planOf(baseInput({ repoRemote: 'git@github.com:JoelBondoux/AtlasMind.git' }));
    expect(fromUrl.content).toEqual(fromSsh.content);
    expect(fromUrl.repoSlug).toBe('JoelBondoux/AtlasMind');
  });

  it('is deterministic, so the previewed file is the written file', () => {
    expect(planOf(baseInput()).content).toEqual(planOf(baseInput()).content);
  });

  describe('refusals name what is wrong instead of coercing it', () => {
    it('refuses an unidentifiable repository', () => {
      const outcome = buildTrustedLocalCiStarter(baseInput({ repoRemote: 'not a repository' }));
      expect(outcome).toMatchObject({ ok: false });
      if (!outcome.ok) {
        expect(outcome.reason).toContain('git remote');
      }
    });

    it.each([
      ['../escape', 'traversal-shaped'],
      ['feature/', 'trailing separator'],
      ['refs..heads', 'double dot'],
      ['', 'empty'],
    ])('refuses the branch %s (%s)', branch => {
      expect(buildTrustedLocalCiStarter(baseInput({ trustedBranch: branch }))).toMatchObject({ ok: false });
    });

    it('refuses a label that did not survive architecture expansion', () => {
      expect(buildTrustedLocalCiStarter(baseInput({ runnerLabel: '' }))).toMatchObject({ ok: false });
      expect(buildTrustedLocalCiStarter(baseInput({ runnerLabel: 'has spaces' }))).toMatchObject({ ok: false });
    });

    it('refuses a workflow filename that is not one YAML file', () => {
      for (const workflowFile of ['../ci.yml', 'nested/ci.yml', 'ci.txt', '']) {
        expect(buildTrustedLocalCiStarter(baseInput({ workflowFile }))).toMatchObject({ ok: false });
      }
    });

    it('refuses a project with nothing to verify rather than writing an empty job', () => {
      const outcome = buildTrustedLocalCiStarter(baseInput({ scripts: ['package', 'watch'] }));
      expect(outcome).toMatchObject({ ok: false });
      if (!outcome.ok) {
        expect(outcome.reason).toContain('package.json');
      }
    });
  });

  it('states what the file permits and refuses in plain words', () => {
    const plan = planOf(baseInput());
    expect(plan.permits.join(' ')).toContain('compile, lint, test');
    expect(plan.refuses.join(' ')).toMatch(/fork/i);
    // The readable half must not quietly become the only half: the YAML is
    // always available beside it.
    expect(plan.content).toContain('name: Trusted local CI');
  });
});

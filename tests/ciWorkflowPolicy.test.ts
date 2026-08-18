import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * A repository file, with its line endings normalised.
 *
 * Every assertion here is about workflow *policy* — who may trigger a run,
 * what permissions it takes, whether an action is pinned. None of them intends
 * to assert a line-ending convention, and yet two did: a multi-line
 * `toContain` such as `permissions:\n  contents: read` matches only an
 * LF checkout, so both failed on the Windows leg of the matrix and passed
 * everywhere else. That is the worst shape a failure can take in this file —
 * it reads as a policy violation on one platform, which is exactly what this
 * file exists to detect, and it is nothing of the kind.
 *
 * Normalised at the read rather than by rewriting the two assertions onto one
 * line: the next multi-line assertion somebody adds would otherwise
 * reintroduce it, and a `.gitattributes` rule would fix the checkout while
 * leaving the test's own assumption in place.
 */
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('cost-aware CI workflow policy', () => {
  it('reserves automatic hosted matrix execution for pull requests into main', () => {
    const workflow = read('.github/workflows/ci.yml');
    const triggerBlock = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('jobs:'));

    expect(triggerBlock).toContain('pull_request:');
    expect(triggerBlock).toContain('branches: [main]');
    expect(triggerBlock).toContain('workflow_dispatch:');
    expect(triggerBlock).not.toContain('push:');
    expect(triggerBlock).not.toMatch(/branches:\s*\[[^\]]*develop/);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('os: [ubuntu-latest, windows-latest, macos-latest]');
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);

    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(match => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const actionReference of actionReferences) {
      expect(actionReference).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('makes the self-hosted route owner-only, secretless and exact-ref', () => {
    const workflow = read('.github/workflows/trusted-local-ci.yml');
    const triggerBlock = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));

    expect(triggerBlock).toContain('workflow_dispatch:');
    expect(triggerBlock).toContain('push:');
    expect(triggerBlock).toContain('branches: [develop]');
    expect(triggerBlock).not.toContain('pull_request:');
    expect(triggerBlock).not.toContain('pull_request_target:');
    expect(workflow).toContain("github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github.repository == 'JoelBondoux/AtlasMind'");
    expect(workflow).toContain("github.ref == 'refs/heads/develop'");
    expect(workflow).toContain('github.actor == github.repository_owner');
    expect(workflow).toContain('runs-on: [atlasmind-trusted-linux-x64]');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toContain('id-token: write');
    expect(workflow).not.toContain('secrets.');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('NODE_EXTRA_CA_CERTS: /etc/ssl/certs/ca-certificates.crt');
    expect(workflow).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(workflow).not.toContain('${{ runner.temp }}');
    expect(workflow).toContain('echo "NPM_CONFIG_CACHE=$RUNNER_TEMP/npm-cache" >> "$GITHUB_ENV"');
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
    expect(workflow).toContain('run: npm run ci:local');
  });

  /**
   * A job queued for a runner label nothing answers to does not fail — it waits,
   * for up to twenty-four hours, reporting `pending` on the commit and on every
   * pull request whose head that commit is. This repository had no runner
   * registered at all, so that check had been permanently amber: unreadable as
   * either progress or a problem, and the two are indistinguishable on a pull
   * request.
   *
   * The gate defaults closed in both useful directions — nothing queues, and
   * nothing claims to be running — and a skipped job says the true thing.
   */
  it('does not queue a trusted job unless a runner is declared available', () => {
    const workflow = read('.github/workflows/trusted-local-ci.yml');
    expect(workflow).toContain("vars.TRUSTED_LOCAL_RUNNER == 'true'");
    // The gate joins the existing conditions rather than replacing one: it is
    // an availability check, and must never be mistaken for the authorization.
    expect(workflow).toContain('github.actor == github.repository_owner &&');
    expect(workflow).toContain("github.repository == 'JoelBondoux/AtlasMind'");
    // The variable is named in the file that needs it, with the command to set
    // it — a gate whose key is documented elsewhere is a gate nobody opens.
    expect(workflow).toContain('gh variable set TRUSTED_LOCAL_RUNNER');
  });

  it('keeps quick iteration separate from the complete local gate', () => {
    const manifest = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts['ci:local:quick']).toContain('npm run test');
    expect(manifest.scripts['ci:local:quick']).not.toContain('test:coverage');
    expect(manifest.scripts['ci:local']).toContain('npm run ci:local:quick');
    expect(manifest.scripts['ci:local']).toContain('npm run test:coverage');
    expect(manifest.scripts['ci:local']).toContain('npm run package');
  });
});

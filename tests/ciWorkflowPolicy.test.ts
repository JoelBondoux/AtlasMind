import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
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
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
    expect(workflow).toContain('run: npm run ci:local');
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

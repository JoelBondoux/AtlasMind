import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectOutcomeCompleteness } from '../../src/views/projectDashboardPanel.js';
import { discoverTestFiles } from '../../src/views/settingsPanel.js';

const roots: string[] = [];
const root = () => { const dir = mkdtempSync(path.join(tmpdir(), 'atlas-ops-')); roots.push(dir); return dir; };
function put(dir: string, name: string, content = 'it("works", () => {});') {
  const file = path.join(dir, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('outcome evidence', () => {
  it.each(['\n', '\r\n'])('reads full Vision and References sections with %j line endings', async newline => {
    const dir = root();
    put(dir, 'project_memory/project_soul.md', ['# Project', '', '## Vision', '', 'Publish accessible lookbooks.', '', '### Success measure', 'Merchants can finish onboarding.', '', '## References', '- domain/capabilities.md', '- domain/missing.md', '', '## Principles', 'Do not include this in Vision.'].join(newline));
    put(dir, 'project_memory/domain/capabilities.md', '# Capabilities');
    const outcome = await collectOutcomeCompleteness(dir, 'project_memory', [], []);
    expect(outcome.desiredOutcome).toContain('Publish accessible lookbooks.');
    expect(outcome.desiredOutcome).toContain('Merchants can finish onboarding.');
    expect(outcome.desiredOutcome).not.toContain('Do not include');
    expect(outcome.referenceCoveragePercent).toBe(50);
  });

  it('keeps genuinely absent vision and references unclaimed', async () => {
    const outcome = await collectOutcomeCompleteness(root(), 'project_memory', [], []);
    expect(outcome.desiredOutcome).toMatch(/^Define the desired project outcome/);
    expect(outcome.referenceCoveragePercent).toBe(0);
  });
});

describe('monorepo test discovery', () => {
  it('finds evidence in another workspace after more than 200 files', () => {
    const dir = root();
    for (let i = 0; i < 220; i++) put(dir, `web/src/case-${i}.test.ts`);
    put(dir, 'server/tests/checkout.integration.test.ts');
    put(dir, 'tests/schema-migration.test.ts');
    const { files, truncated } = discoverTestFiles(dir);
    expect(truncated).toBe(false);
    expect(files).toHaveLength(222);
    expect(files).toContain(path.join(dir, 'server/tests/checkout.integration.test.ts'));
  });

  it('does not borrow tests from nested repositories or generated worktrees', () => {
    const dir = root();
    put(dir, 'tests/real.test.ts');
    put(dir, '.claude/worktrees/old/tests/stale.test.ts');
    put(dir, '.codex/worktrees/old/tests/stale.test.ts');
    put(dir, 'nested/.git', 'gitdir: elsewhere');
    put(dir, 'nested/tests/foreign.test.ts');
    expect(discoverTestFiles(dir).files).toEqual([path.join(dir, 'tests/real.test.ts')]);
  });

  it('reports a partial scan when its safety ceiling is reached', () => {
    const dir = root();
    for (let i = 0; i < 3; i++) put(dir, `tests/case-${i}.test.ts`);
    expect(discoverTestFiles(dir, 2)).toMatchObject({ files: expect.any(Array), truncated: true });
    expect(discoverTestFiles(dir, 2).files).toHaveLength(2);
  });
});

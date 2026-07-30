import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The scaffolded CI workflow has two halves that must stay different in kind.
 *
 * The generic Node steps are **real commands**, because AtlasMind can see a
 * `package.json` and what scripts it declares. The archetype-specific steps are
 * **commented suggestions**, because it cannot: it knows a game wants a
 * determinism gate without knowing what command this project would use for one.
 * Writing a guess and running it would produce a red build on somebody's first
 * commit, which teaches them to delete the file.
 *
 * Asserted against the source because the builder needs a whole bootstrap
 * intake to run, and the property is about what it *emits*, not how.
 */

const BOOTSTRAPPER = readFileSync(
  path.join(process.cwd(), 'src', 'bootstrap', 'bootstrapper.ts'),
  'utf8',
);

function builderSource(): string {
  const start = BOOTSTRAPPER.indexOf('function buildScaffoldedCiWorkflow(');
  expect(start, 'buildScaffoldedCiWorkflow is missing').toBeGreaterThan(-1);
  const end = BOOTSTRAPPER.indexOf('\nasync function scaffoldGovernanceBaseline(', start);
  return BOOTSTRAPPER.slice(start, end === -1 ? undefined : end);
}

describe('archetype steps are suggestions, not commands', () => {
  const source = builderSource();

  it('emits every archetype step commented out', () => {
    // A `run:` AtlasMind invented would fail on the first commit.
    expect(source).toContain('#   run: ${step.exampleCommand');
    expect(source).toMatch(/#\s*- name: \$\{step\.label\}/);
  });

  it('says why they are commented rather than leaving it to be guessed', () => {
    expect(source).toMatch(/suggestions, not commands/);
    expect(source).toMatch(/AtlasMind chose for you/);
  });

  it('carries each step\'s rationale, so a reader can decide', () => {
    expect(source).toContain('${step.rationale}');
  });

  it('marks which suggestions the shape treats as required checks', () => {
    expect(source).toContain('treat as a required check');
  });

  it('never emits a bare run for a step it did not verify', () => {
    // Every uncommented `run:` in this builder must be one of the four generic
    // Node commands, which exist because the manifest says so.
    const runs = [...source.matchAll(/'\s*run:\s*([^']+)'/g)].map(match => match[1]!.trim());
    for (const command of runs) {
      expect(['npm ci', 'npm run compile', 'npm run lint', 'npm run test'], command)
        .toContain(command);
    }
  });

  it('adds nothing shape-specific when the shape is unknown', () => {
    // "Other" and an unrecognised label produce `undefined`, not `generic`.
    // Inventing steps for a shape nobody declared is guessing.
    expect(source).toContain('if (extra.length > 0 && archetype)');
  });

  it('does not duplicate the generic four', () => {
    expect(source).toContain("!['install', 'compile', 'lint', 'test'].includes(step.id)");
  });
});

describe('the trigger branch', () => {
  const source = builderSource();

  it('no longer names a branch no repository has', () => {
    // It was hardcoded to `master` — not the default of any repository created
    // since 2020, and not this project's either.
    expect(source).not.toContain('branches: [master]');
    expect(source).toContain('branches: [main]');
  });

  it('says what to change when the repository integrates elsewhere', () => {
    // A workflow that never runs looks identical to one that always passes.
    expect(source).toMatch(/never runs looks identical to one/);
  });
});

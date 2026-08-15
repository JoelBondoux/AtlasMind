import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILLS_DIR = new URL('../../src/skills/', import.meta.url);

/**
 * No skill may import `vscode` at module scope.
 *
 * `src/skills/index.ts` is loaded by `runtime/core`, which the CLI loads on
 * startup — so a single top-level `from 'vscode'` anywhere in this directory
 * makes `atlasmind chat` die with MODULE_NOT_FOUND before it does anything at
 * all. Two skills shipped with exactly that in v0.313.0 and v0.314.0.
 *
 * Nothing else caught it. Vitest aliases `vscode` to a stub for every test file,
 * so the whole suite imports these modules happily; `tsc` resolves the types
 * from `@types/vscode` and is equally content. The only thing that notices is
 * running the CLI, which no test did.
 *
 * A skill needing the host either takes it from the injected
 * `SkillExecutionContext` — which is what every other skill does — or imports it
 * lazily inside `execute`, where it only runs in the extension host.
 */
describe('skills do not drag the extension host into Node', () => {
  const files = readdirSync(SKILLS_DIR).filter(name => name.endsWith('.ts'));

  it('found the skill sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no module-scope vscode import', file => {
    const source = readFileSync(new URL(file, SKILLS_DIR), 'utf8');
    const offending = source
      .split('\n')
      // A lazy `await import('vscode')` sits inside a function and is fine; a
      // `import type` is erased at compile time and reaches no runtime loader.
      .filter(line => /^\s*import\s+(?!type\b)[^;]*from\s+'vscode'/.test(line));

    expect(offending, `${file} imports vscode at module scope`).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Dead-field detection: things this project *declares* that nothing reads.
 *
 * "A field that is written but never read is a bug wearing a feature's
 * clothes" — the code meant to consume it was renamed, moved, or never
 * written. Two surfaces here, and they need opposite kinds of assertion.
 *
 * **The contribution manifest is checked outright**, because a dead entry
 * there is user-visible and currently costs nothing to keep clean: a command
 * in `package.json` that no code registers is a palette entry that throws
 * "command not found" when somebody runs it, and a menu naming an undeclared
 * command is the same bug one level up. Both are at zero today, so the
 * assertion is a ratchet at zero rather than a cleanup request.
 *
 * **Unreferenced exports are capped, not banned.** There are 95 of them. A
 * check that fails on day one gets deleted, and demanding a 95-item cleanup
 * before any of this can run would mean the project keeps none of the value.
 * So the ceiling is today's count: existing debt is visible and tolerated, and
 * the *next* one has to be a deliberate act. Lower the number as they go.
 *
 * `atlasmind.*` settings that nothing reads are covered separately and
 * exhaustively by `tests/settingsIntegrity.test.ts` — the third dead-field
 * surface, and the one that already had a check.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The number of exported functions nothing outside their own module names.
 *
 * A ceiling, not a target. **Lower it when you delete one; never raise it to
 * make a build green** — a raised ceiling is the check being switched off one
 * notch at a time, and the number is here rather than in a config file so that
 * doing it shows up in review.
 */
const UNREFERENCED_EXPORT_CEILING = 92;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(full.replace(/\\/g, '/'));
    }
  }
  return out;
}

const packageJsonText = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const manifest = JSON.parse(packageJsonText) as {
  contributes?: {
    commands?: { command: string }[];
    views?: Record<string, { id: string }[]>;
    menus?: Record<string, { command?: string }[]>;
  };
};

const allSourceFiles = walk(path.join(ROOT, 'src'));

/**
 * The manifest is checked against *every* source file, `src/web` included.
 *
 * The web build is a second real entry point that registers three of the
 * declared commands, so excluding it reports working commands as dead — and a
 * check that cries wolf about a feature somebody just shipped is one nobody
 * trusts again.
 */
const sourceText = allSourceFiles.map(file => readFileSync(file, 'utf8')).join('\n');

/**
 * The export scan excludes `src/web`, for the opposite reason: it is a separate
 * compilation with its own entry point, so an export unreferenced from the
 * extension host is not evidence of anything there.
 */
const sourceFiles = allSourceFiles.filter(file => !file.includes('/src/web/'));
const testFiles = walk(path.join(ROOT, 'tests'));
const corpus = [...sourceFiles, ...testFiles].map(file => ({ file, text: readFileSync(file, 'utf8') }));

describe('dead-field: the contribution manifest declares nothing that does not exist', () => {
  it('registers every command it declares', () => {
    const declared = (manifest.contributes?.commands ?? []).map(entry => entry.command);
    expect(declared.length).toBeGreaterThan(0);
    // Named anywhere in `src` rather than specifically inside `registerCommand`:
    // several are registered through a table, and a stricter match would report
    // a working command as dead — the false positive that gets a check deleted.
    const unregistered = declared.filter(command => !sourceText.includes(command));
    expect(unregistered, 'declared in package.json but no code names them').toEqual([]);
  });

  it('declares every command a menu entry points at', () => {
    const declared = new Set((manifest.contributes?.commands ?? []).map(entry => entry.command));
    const fromMenus = new Set<string>();
    for (const group of Object.values(manifest.contributes?.menus ?? {})) {
      for (const entry of group) {
        if (entry.command) {
          fromMenus.add(entry.command);
        }
      }
    }
    const undeclared = [...fromMenus].filter(command => !declared.has(command));
    expect(undeclared, 'a menu points at a command that is not declared').toEqual([]);
  });

  it('uses every view it declares', () => {
    const views = Object.values(manifest.contributes?.views ?? {}).flat().map(view => view.id);
    expect(views.length).toBeGreaterThan(0);
    const unused = views.filter(id => !sourceText.includes(id));
    expect(unused, 'declared as a view but no code names the id').toEqual([]);
  });

  it('declares each command exactly once', () => {
    // A duplicate is silent: VS Code keeps one and the other's title never
    // appears, which reads as a missing feature rather than a manifest bug.
    const declared = (manifest.contributes?.commands ?? []).map(entry => entry.command);
    expect(new Set(declared).size).toBe(declared.length);
  });
});

describe('dead-field: exported functions nothing reads', () => {
  /** Exported functions no other file in `src` or `tests` ever names. */
  const unreferenced: string[] = [];
  for (const file of sourceFiles) {
    // Barrels and the shared type module exist to re-export; an entry nothing
    // imports *yet* is their normal state, not a finding.
    if (/\/index\.ts$|\/types\.ts$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^export (?:async )?function (\w+)/gm)) {
      const name = match[1] ?? '';
      const named = new RegExp(`\\b${name}\\b`);
      const usedElsewhere = corpus.some(entry => entry.file !== file && named.test(entry.text));
      // A name in `package.json` is a contribution point reached by id.
      if (!usedElsewhere && !named.test(packageJsonText)) {
        unreferenced.push(`${file.slice(ROOT.length + 1)} :: ${name}`);
      }
    }
  }

  it(`has no more than ${UNREFERENCED_EXPORT_CEILING} of them`, () => {
    // The list is printed on failure rather than only the count, because
    // "96 > 95" tells whoever hit this nothing about which one they added.
    expect(
      unreferenced.length,
      unreferenced.length > UNREFERENCED_EXPORT_CEILING
        ? `unreferenced exports rose to ${unreferenced.length}:\n${unreferenced.join('\n')}`
        : '',
    ).toBeLessThanOrEqual(UNREFERENCED_EXPORT_CEILING);
  });

  it('keeps the ceiling honest by failing when it is set above the real count', () => {
    // Without this, the ceiling silently becomes a fiction after a cleanup:
    // deleting twenty dead exports would leave room for twenty new ones. The
    // check ratchets in both directions.
    expect(
      unreferenced.length,
      `${UNREFERENCED_EXPORT_CEILING - unreferenced.length} dead export(s) were removed — lower UNREFERENCED_EXPORT_CEILING to ${unreferenced.length}`,
    ).toBe(UNREFERENCED_EXPORT_CEILING);
  });

  it('found something to measure, rather than passing because the scan is broken', () => {
    // A regex that stops matching turns this whole file green. An empty result
    // is a scanner failure long before it is a clean codebase.
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(unreferenced.length).toBeGreaterThan(0);
  });
});

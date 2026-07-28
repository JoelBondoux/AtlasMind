import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `ghClient` is the only place AtlasMind may invoke the GitHub CLI.
 *
 * Three call sites existed before it, and one of them composed a shell string
 * from an unvalidated user-supplied GitHub owner — so an owner containing a
 * semicolon would have run as a second command. That is the whole argument for
 * a single boundary: three call sites means three answers to "is this escaped?",
 * and only one of them needs to be wrong.
 *
 * These tests read the real source so a new call site cannot quietly reintroduce
 * one.
 */

const SRC = path.join(process.cwd(), 'src');
const CLIENT = path.join('core', 'ghClient.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC)
  .filter(file => !file.endsWith(CLIENT))
  .map(file => ({ rel: path.relative(process.cwd(), file), text: readFileSync(file, 'utf8') }));

describe('gh has exactly one exec boundary', () => {
  it('no module outside ghClient spawns gh directly', () => {
    const offenders = FILES.filter(({ text }) =>
      /execFile(Async)?\(\s*['"`]gh['"`]/.test(text)
      || /\bcp\.exec(File|FileSync|Sync)?\(\s*['"`]gh[\s'"`]/.test(text)
      || /\bexec(File|Sync)?\(\s*[`'"]gh /.test(text),
    ).map(({ rel }) => rel);

    expect(offenders, `these spawn gh outside ghClient: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no module builds a gh command as a shell string', () => {
    // A template literal starting `gh ` with an interpolation in it is the exact
    // shape that made the bootstrapper injectable.
    const offenders = FILES.filter(({ text, rel }) => {
      if (rel.includes('promotionRunner')) {
        // Exempt: it composes a `gh workflow run` string as *displayed, persisted
        // user-authored config*, executed later through the promotion runner's
        // own audited path — not spawned here. Its arguments are server-sourced.
        return false;
      }
      return /[`'"]gh\s+[a-z-]+[^`'"]*\$\{/.test(text);
    }).map(({ rel }) => rel);

    expect(offenders, `these interpolate into a gh command string: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('the repo-creation path passes argv, not a command line', () => {
  const bootstrapper = readFileSync(path.join(SRC, 'bootstrap', 'bootstrapper.ts'), 'utf8');

  it('creates a repository through the shared client', () => {
    expect(bootstrapper).toContain("runGhOrThrow(");
    expect(bootstrapper).toContain("'repo', 'create', nameArg");
  });

  it('no longer interpolates the owner into a command string', () => {
    // The specific regression: `gh repo create ${nameArg} ...` where nameArg is
    // `${owner}/${repoName}` and owner has no input validation.
    expect(bootstrapper).not.toMatch(/`gh repo create \$\{/);
  });

  it('checks for the CLI without a shell', () => {
    expect(bootstrapper).not.toContain("cp.exec('gh --version'");
    expect(bootstrapper).toContain('ghCliAvailable');
  });
});

describe('failure diagnosis has one implementation', () => {
  it('the dashboard classifies gh failures through ghClient', () => {
    const panel = readFileSync(path.join(SRC, 'views', 'projectDashboardPanel.ts'), 'utf8');
    expect(panel).toContain('ghFailureOf(error)');
    // The panel used to re-derive the diagnosis from the message text. Two
    // independent classifications of one failure is how somebody gets told to
    // re-authenticate when they are merely rate-limited.
    expect(panel).not.toContain("/ENOENT|not recognized|command not found/i.test(message)");
  });
});

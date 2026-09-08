import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Which subprocess calls go through a shell, and whether any of them build a
 * command out of a value.
 *
 * The distinction this enforces is not "shell bad". It is that a shell turns a
 * *string* into a command, so the moment any part of that string comes from
 * somewhere other than this repository's own source, `&` is a second command.
 * `execFile`/`spawn` with an argument vector cannot do that, which is why the
 * rule is about the shape of the call rather than about intent.
 *
 * Two lists, and they mean different things. `SHELL_CALLERS` is the ratchet:
 * files allowed to invoke a shell at all, and it may only shrink.
 * `INTERPOLATED_COMMANDS` is not a ratchet — it is zero, and a new entry is a
 * command injection until proven otherwise.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');

/**
 * A call that hands a *command line* to a shell.
 *
 * `RegExp.prototype.exec` is spelled identically and appears in dozens of
 * files, so this cannot be a bare name match — the first version of this test
 * reported twenty files, every one of them a regex. Two things disambiguate it,
 * and both are needed: the file must import `child_process` at all, and the
 * call must either be bare (`exec(...)`, i.e. an imported or promisified
 * binding) or on the module namespace (`cp.exec(...)`). `pattern.exec(text)`
 * satisfies neither.
 *
 * `execAsync` is included because `promisify(exec)` is the same function with a
 * different shape, and omitting it made the routine runner — the one file that
 * genuinely does this — read as clean.
 */
const IMPORTS_CHILD_PROCESS = /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]/;
const BARE_SHELL_CALL = /(?:^|[^.\w$])(?:exec|execSync|execAsync)\s*\(/;
const NAMESPACE_SHELL_CALL = /\b(?:cp|childProcess)\s*\.\s*(?:exec|execSync)\s*\(/;

/**
 * Files permitted to reach a shell, with why.
 *
 * **This list may only shrink.** Each entry is a place where a string becomes a
 * command; every one of them must also satisfy the interpolation check below.
 */
const SHELL_CALLERS: Readonly<Record<string, string>> = {
  /**
   * A routine step is a shell command by design — the feature is "run these
   * commands" and cannot be argv-ised without becoming a different feature.
   * Guarded instead: values are refused if they contain shell syntax
   * (`routineVariables.ts`), the fully substituted commands are planned and
   * shown before anything runs (`routineExecutionPolicy.ts`), and the runner
   * executes the plan rather than re-substituting.
   */
  'core/routineRunner.ts': 'Routine steps are user-authored shell commands; planned, shown and confirmed first.',

  /**
   * The same shape, for the same reason: a deploy step and a rollback command
   * are written by whoever owns the pipeline, stored server-side, and run as
   * written. The module's own contract says the caller must authorise first,
   * and it does — a protected stage costs a type-to-confirm on the stage label.
   *
   * Both entries were here when this test was written. Neither is an
   * exemption granted to make it pass: they are the two places where "run this
   * command" *is* the feature, and both are governed by a confirmation that
   * shows the command. The list may only shrink from here.
   */
  'core/promotionRunner.ts': 'Deploy and rollback steps are user-authored commands behind the promotion authorization gate.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full, out); } else if (entry.endsWith('.ts')) { out.push(full); }
  }
  return out;
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/** Source with comment lines removed, so prose about a hazard is not read as one. */
function codeLines(file: string): Array<{ line: number; text: string }> {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text }))
    .filter(entry => !/^\s*(?:\*|\/\/|\/\*)/.test(entry.text));
}

/** Lines that spawn a shell. Empty for any file that does not import `child_process`. */
function shellCallLines(file: string): Array<{ line: number; text: string }> {
  const source = readFileSync(file, 'utf8');
  if (!IMPORTS_CHILD_PROCESS.test(source)) { return []; }

  return codeLines(file)
    .filter(entry => BARE_SHELL_CALL.test(entry.text) || NAMESPACE_SHELL_CALL.test(entry.text))
    .map(entry => ({ line: entry.line, text: entry.text.trim() }));
}

function shellCallers(): Map<string, Array<{ line: number; text: string }>> {
  const found = new Map<string, Array<{ line: number; text: string }>>();
  for (const file of walk(SRC)) {
    const lines = shellCallLines(file);
    if (lines.length > 0) { found.set(relative(file), lines); }
  }
  return found;
}

describe('a shell is used only where a shell is the feature', () => {
  it('matches real code rather than passing because the scan is broken', () => {
    // Anchored on the one file that legitimately reaches a shell, so the check
    // cannot become vacuously true — and does not require a violation to exist.
    expect(
      shellCallLines(path.join(SRC, 'core', 'routineRunner.ts')).length,
      'The scanner found no shell call even in the routine runner. SHELL_FORM_CALL has stopped matching.',
    ).toBeGreaterThan(0);
  });

  it('has no shell caller that is not a recorded one', () => {
    const unexpected = [...shellCallers().entries()]
      .filter(([file]) => !(file in SHELL_CALLERS))
      .map(([file, lines]) => `${file}:${lines.map(l => l.line).join(',')}`)
      .sort();

    expect(
      unexpected,
      'These files spawn a shell. Use execFile/spawn with an argument vector — a shell turns a '
      + 'string into a command, so any value reaching it can add a second one. Do not add them to '
      + 'SHELL_CALLERS; that list only shrinks.',
    ).toEqual([]);
  });

  it('keeps the recorded list honest by failing when an entry is stale', () => {
    const current = shellCallers();
    const stale = Object.keys(SHELL_CALLERS)
      .filter(file => !current.has(file))
      .sort();

    expect(stale, 'A recorded shell caller no longer uses a shell. Remove it from SHELL_CALLERS.').toEqual([]);
  });
});

describe('no shell command is built out of a value', () => {
  /**
   * The property that actually prevents injection. A shell call whose command
   * is a literal can do only what this repository says; one assembled from a
   * template or a concatenation can do what its inputs say.
   *
   * `routineRunner` passes a variable (`step.command`) and is the deliberate
   * exception — the value it passes is a planned, shown and confirmed command,
   * which is the whole subject of `routineExecutionPolicy.ts`.
   */
  const ASSEMBLED_COMMAND = /\b(?:exec|execSync|execAsync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+|[A-Za-z_$][\w$.]*\s*\+)/;

  it('finds no interpolated shell command anywhere', () => {
    const offenders: string[] = [];
    for (const [file, lines] of shellCallers()) {
      for (const line of lines) {
        if (ASSEMBLED_COMMAND.test(line.text)) {
          offenders.push(`${file}:${line.line} — ${line.text.slice(0, 90)}`);
        }
      }
    }

    expect(
      offenders,
      'A shell command is being assembled from a value. That is command injection unless every '
      + 'input is proven safe, and proving it is harder than not doing it.',
    ).toEqual([]);
  });
});

describe('the bootstrapper installs without a shell', () => {
  /**
   * It used to spawn four shells: three capability probes (`winget --version`
   * and friends) that ran *before* any confirmation, an installer command, and
   * `git add -A && git commit -m "…"`. All were constants, so none was
   * injectable — but three of them ran unprompted, and the Debian installer was
   * a `curl … | sudo dd … && sudo apt install` pipeline, which `acpInstaller.ts`
   * refuses to ship on principle. Two installers in one product should not
   * disagree about whether that principle exists.
   */
  const bootstrapper = path.join(SRC, 'bootstrap', 'bootstrapper.ts');
  // Comments stripped: this file now *explains* both hazards at length, and a
  // check that reads its own documentation as a violation is the mistake the
  // debt register's `commentStartIndex` exists to avoid.
  const code = codeLines(bootstrapper).map(entry => entry.text).join('\n');

  it('spawns no shell at all', () => {
    expect(shellCallLines(bootstrapper)).toEqual([]);
  });

  it('ships no privileged download-and-pipe', () => {
    expect(/curl[^\n]*\|\s*sudo/.test(code), 'A curl-into-sudo pipeline is back.').toBe(false);
  });

  it('does not chain git through a shell operator', () => {
    expect(/git add -A && git commit/.test(code)).toBe(false);
  });
});

/**
 * What may be substituted into a routine's command line.
 *
 * A routine step is a **command string**, authored in the project's own
 * `project_memory/routines/` files and run through a real shell — that part is
 * deliberate and cannot be taken away without breaking every routine. What was
 * never deliberate is that `/ship <message>` took free chat text and
 * interpolated it into that string unquoted: a step reading
 * `git commit -m "${message}"` and a message carrying a quote followed by a
 * second command is command injection with no gate in front of it.
 *
 * Three ways to close it, and the choice matters:
 *
 * - **Quote the value for the shell.** Requires knowing whether the template
 *   already quotes the placeholder; `-m "${message}"` and `-m ${message}` need
 *   opposite treatment, and guessing wrong either breaks ordinary messages or
 *   leaves the hole open.
 * - **Pass values through the environment** and substitute a variable
 *   reference. Safe against metacharacters, but `-m ""$VAR""` leaves the
 *   expansion *unquoted* in `sh`, so any multi-word message word-splits. It
 *   trades a security bug for a correctness one.
 * - **Refuse a value that could change the command's structure.** No context
 *   analysis, no shell-dialect guessing, and the failure is loud, specific and
 *   recoverable by editing four characters of a commit message.
 *
 * The third is what this does, because it is the only one whose failure mode is
 * a refusal rather than a silently wrong command — the repository's
 * deny-by-default rule applied to the one input here that a stranger's text can
 * reach.
 *
 * The allowlist is a **structural** judgement, not a taste one: every character
 * outside it can alter what the shell executes in `sh` or `cmd.exe` (the two
 * shells `child_process.exec` actually uses), including the ones that merely
 * truncate a command — dropping the tail of `git commit … --no-verify` is not
 * injection but it is still not the command anybody reviewed.
 */

/**
 * Characters that cannot change a command's structure in `sh` or `cmd.exe`.
 *
 * Deliberately excluded, each for a reason: `$` and backtick (expansion),
 * `"` `'` (quoting), `;` `|` `&` (separators), `<` `>` (redirection),
 * `(` `)` `{` `}` (grouping and subshells), `\` (escaping), `*` `?`… — `?` is
 * kept because globbing cannot execute anything and a question mark is ordinary
 * in a message — `~` (home expansion), `#` (comment; truncates the rest of the
 * line), `%` and `!` (cmd.exe variable and delayed expansion), `^` (cmd escape),
 * and every newline, which turns one reviewed command into two.
 */
const SAFE_ROUTINE_VALUE = /^[A-Za-z0-9 .,:\-_/+=?@]*$/;

export interface RoutineVariableRefusal {
  name: string;
  /** The offending characters, de-duplicated and in first-seen order. */
  offending: string[];
  reason: string;
}

export interface RoutineVariableCheck {
  ok: boolean;
  refusals: RoutineVariableRefusal[];
}

/** The characters in `value` that fall outside the safe set, in order, unique. */
export function unsafeShellCharacters(value: string): string[] {
  const seen = new Set<string>();
  for (const character of value) {
    if (!SAFE_ROUTINE_VALUE.test(character) && !seen.has(character)) {
      seen.add(character);
    }
  }
  return [...seen];
}

/**
 * Check every value a routine run would substitute.
 *
 * Values, never the template: the template is a reviewed file in the
 * repository, and treating it as suspect would refuse every routine that uses
 * a pipe on purpose.
 */
export function checkRoutineVariables(vars: Record<string, string>): RoutineVariableCheck {
  const refusals: RoutineVariableRefusal[] = [];
  for (const [name, rawValue] of Object.entries(vars)) {
    const value = String(rawValue ?? '');
    if (SAFE_ROUTINE_VALUE.test(value)) {
      continue;
    }
    const offending = unsafeShellCharacters(value);
    refusals.push({
      name,
      offending,
      reason: `The value for \`${name}\` contains ${describeCharacters(offending)}, which a shell reads as syntax rather than text. `
        + 'AtlasMind will not build a command it cannot vouch for — remove those characters and run it again.',
    });
  }
  return { ok: refusals.length === 0, refusals };
}

/** Newlines and other invisibles need naming, not printing. */
function describeCharacters(characters: readonly string[]): string {
  const named = characters.slice(0, 8).map(character => {
    if (character === '\n') {
      return 'a line break';
    }
    if (character === '\r') {
      return 'a carriage return';
    }
    if (character === '\t') {
      return 'a tab';
    }
    return `\`${character}\``;
  });
  const remainder = characters.length - named.length;
  return remainder > 0 ? `${named.join(', ')} and ${remainder} more` : named.join(', ');
}

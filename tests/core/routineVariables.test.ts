import { describe, expect, it } from 'vitest';
import { checkRoutineVariables, unsafeShellCharacters } from '../../src/core/routineVariables.ts';

describe('routine variable safety', () => {
  it('accepts an ordinary commit message', () => {
    const check = checkRoutineVariables({ message: 'fix: handle an empty input, add a test' });
    expect(check.ok).toBe(true);
    expect(check.refusals).toEqual([]);
  });

  it('accepts the punctuation real messages carry', () => {
    expect(checkRoutineVariables({ message: 'feat/router: cap at 50% - see issue 42?' }).ok).toBe(false);
    // `%` is cmd.exe variable expansion, so it is refused; everything else here is fine.
    expect(checkRoutineVariables({ message: 'feat/router: cap workers - see issue 42?' }).ok).toBe(true);
    expect(checkRoutineVariables({ message: 'chore: bump to v1.2.3 @ 2026-08-19' }).ok).toBe(true);
  });

  it('refuses a value that could close a quote and start a second command', () => {
    const check = checkRoutineVariables({ message: 'done"; rm -rf /; echo "' });
    expect(check.ok).toBe(false);
    expect(check.refusals[0]?.name).toBe('message');
    expect(check.refusals[0]?.offending).toContain('"');
    expect(check.refusals[0]?.offending).toContain(';');
  });

  it('refuses command substitution in both spellings', () => {
    expect(checkRoutineVariables({ message: 'v$(whoami)' }).ok).toBe(false);
    expect(checkRoutineVariables({ message: 'v`whoami`' }).ok).toBe(false);
    expect(checkRoutineVariables({ message: 'v%USERNAME%' }).ok).toBe(false);
  });

  it('refuses a line break, which turns one reviewed command into two', () => {
    const check = checkRoutineVariables({ message: 'ok\nrm -rf /' });
    expect(check.ok).toBe(false);
    expect(check.refusals[0]?.reason).toContain('a line break');
  });

  it('refuses a comment character, which would silently drop the rest of the command', () => {
    // `git commit -m "${message}" --no-verify` losing its tail is not injection,
    // but it is not the command anybody reviewed either.
    expect(checkRoutineVariables({ message: 'tidy up #2' }).ok).toBe(false);
  });

  it('reports every offending character once, in first-seen order', () => {
    expect(unsafeShellCharacters('a;b|c;d')).toEqual([';', '|']);
  });

  it('checks every variable, not just the first', () => {
    const check = checkRoutineVariables({ safe: 'fine', message: 'a;b', tag: 'c|d' });
    expect(check.refusals.map(refusal => refusal.name)).toEqual(['message', 'tag']);
  });

  it('treats an empty or absent value as safe', () => {
    expect(checkRoutineVariables({ message: '' }).ok).toBe(true);
    expect(checkRoutineVariables({}).ok).toBe(true);
  });
});

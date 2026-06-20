import { describe, expect, it } from 'vitest';
import { sanitizeTerminalOutput, stripAnsiSequences } from '../../src/utils/terminalOutput.js';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

describe('stripAnsiSequences', () => {
  it('removes SGR colour codes while keeping the text', () => {
    const input = `${ESC}[1m${ESC}[36mRUN${ESC}[39m${ESC}[22m v2.1.9`;
    expect(stripAnsiSequences(input)).toBe('RUN v2.1.9');
  });

  it('reproduces and fixes the vitest banner garble from the bug report', () => {
    // The screenshot showed `[1m[7m[36m RUN ...` — CSI sequences whose ESC byte
    // is invisible on a non-terminal surface. With the ESC bytes present, the
    // sequences must be stripped cleanly.
    const garbled = `${ESC}[1m${ESC}[7m${ESC}[36m RUN ${ESC}[39m${ESC}[27m${ESC}[22m ${ESC}[36mv2.1.9${ESC}[39m`;
    expect(stripAnsiSequences(garbled)).toBe(' RUN  v2.1.9');
  });

  it('removes OSC shell-integration / title markers (BEL and ST terminated)', () => {
    expect(stripAnsiSequences(`${ESC}]0;window title${BEL}hello`)).toBe('hello');
    expect(stripAnsiSequences(`${ESC}]633;C${ESC}\\done`)).toBe('done');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsiSequences('no escapes here')).toBe('no escapes here');
  });

  it('returns an empty string for non-string input', () => {
    expect(stripAnsiSequences(undefined as unknown as string)).toBe('');
  });
});

describe('sanitizeTerminalOutput', () => {
  it('folds carriage returns into newlines and drops residual control bytes', () => {
    const input = `line one\r\nline two\rline three${String.fromCharCode(0)}${String.fromCharCode(127)}`;
    expect(sanitizeTerminalOutput(input)).toBe('line one\nline two\nline three');
  });

  it('preserves tabs and newlines', () => {
    expect(sanitizeTerminalOutput('a\tb\nc')).toBe('a\tb\nc');
  });

  it('strips a stray ESC byte that no sequence consumed', () => {
    expect(sanitizeTerminalOutput(`before${ESC}after`)).toBe('beforeafter');
  });

  it('cleans a realistic vitest run line end to end', () => {
    const input = `${ESC}[1m${ESC}[36m RUN ${ESC}[39m${ESC}[90mv2.1.9${ESC}[39m\r\n`;
    expect(sanitizeTerminalOutput(input)).toBe(' RUN v2.1.9\n');
  });
});

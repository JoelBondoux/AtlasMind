/**
 * Sanitizers for raw terminal / command output before it is surfaced in chat
 * summaries, "What Atlas did" bullets, or webviews.
 *
 * Tools such as vitest, eslint, and most package-manager scripts emit ANSI
 * colour and cursor-control escape sequences (and, via shell integration,
 * OSC markers). Those sequences are meant for a real terminal. When the same
 * text is rendered on a non-terminal surface the ESC byte (0x1B) is invisible
 * and the user is left with garbled fragments such as:
 *
 *   [1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m
 *
 * `stripAnsiSequences` removes the escape sequences while leaving printable
 * text intact. `sanitizeTerminalOutput` goes further for display contexts,
 * folding carriage returns and dropping any leftover non-printable control
 * characters.
 *
 * Implementation note: the patterns are assembled with String.fromCharCode so
 * the source file contains no literal control bytes.
 */

const ESC = String.fromCharCode(27); // 0x1B
const BEL = String.fromCharCode(7); // 0x07

// CSI - colours, cursor moves, etc.: ESC [ <params> <intermediates> <final>.
const CSI_PATTERN = `${ESC}\\[[0-9;?:<=>]*[ -/]*[@-~]`;

// OSC - window titles and shell-integration markers: ESC ] ... terminated by
// BEL (0x07) or ST (ESC \). Non-greedy so it consumes a single marker only.
const OSC_PATTERN = `${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)`;

const ANSI_SEQUENCE = new RegExp(`${OSC_PATTERN}|${CSI_PATTERN}`, 'g');

// Remaining C0 control characters except TAB (0x09) and LF (0x0A), plus
// DEL (0x7F). This also sweeps up any stray ESC byte (0x1B) left by a rare
// escape form not matched above, so the literal `[1m`-style residue cannot
// survive into a rendered summary. CR is folded to LF before this runs.
const RESIDUAL_CONTROL = new RegExp(
  '[' +
    `${String.fromCharCode(0)}-${String.fromCharCode(8)}` + // NUL..BS
    `${String.fromCharCode(11)}-${String.fromCharCode(31)}` + // VT..US (skip TAB, LF)
    String.fromCharCode(127) + // DEL
    ']',
  'g',
);

/** Remove ANSI / VT escape sequences while leaving printable text intact. */
export function stripAnsiSequences(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  return value.replace(ANSI_SEQUENCE, '');
}

/**
 * Produce display-safe text from captured terminal output: strip escape
 * sequences, fold carriage returns into newlines, and remove any leftover
 * non-printable control characters. Tabs and newlines are preserved.
 */
export function sanitizeTerminalOutput(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  return stripAnsiSequences(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(RESIDUAL_CONTROL, '');
}

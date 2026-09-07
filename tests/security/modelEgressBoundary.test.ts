import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nothing calls a model except through the egress boundary.
 *
 * This test is the deliverable, not the module it guards. A boundary that every
 * caller must *remember* to use is the arrangement being replaced — it had
 * already been forgotten seven times out of eight. Only a check that fails when
 * somebody adds the twenty-second call site keeps it true.
 *
 * It ratchets: the allowlist below records call sites that predate the boundary,
 * and the total may only fall. Migrating a file means lowering its number; a new
 * unmigrated call anywhere fails immediately.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO_ROOT, 'src');

/** Adapters *are* the provider layer — the calls there are the implementation. */
const EXEMPT_DIRECTORIES = ['providers'];

/** The dispatcher itself, and the policy it consults. */
const EXEMPT_FILES = new Set([
  'core/modelEgress.ts',
]);

/**
 * Call sites that predate the boundary, with their current counts.
 *
 * **These numbers may only go down.** Each is a file that reaches a provider
 * without clearing its context through `prepareEgress`, recorded so the debt is
 * visible and bounded rather than implied. Delete an entry when its file no
 * longer calls a provider directly.
 */
const LEGACY_DIRECT_CALLERS: Readonly<Record<string, number>> = {
  /**
   * The main chat and tool-loop path, and the last one left.
   *
   * Not migrated with the other eight because its messages are the whole
   * conversation — system prompt, session context, the operator's turn and tool
   * results in one array — and the origins would have to be inferred from
   * `role`. That is exactly what the boundary refuses: `role: 'user'` carries
   * both what somebody typed and a workspace file pasted into a prompt, and
   * those are not the same risk. Labelling belongs where the messages are
   * built, which is a change to this file's construction sites rather than to
   * its dispatch, and deserves its own commit.
   */
  'core/orchestrator.ts': 11,
};

/**
 * A call on a *provider adapter*, which is where bytes leave for a model.
 *
 * Deliberately keyed on the receiver rather than the method name alone. Several
 * classes expose their own `complete()` that delegates to a provider — matching
 * those too would count one egress twice and would flag wrappers that are not
 * themselves a boundary. What matters is the last hop.
 */
const PROMPT_BEARING_CALL = /\b\w*[Pp]rovider\w*\.(?:complete|streamComplete)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function relative(file: string): string {
  return path.relative(SRC, file).split(path.sep).join('/');
}

function countCalls(file: string): number {
  const source = readFileSync(file, 'utf8');
  // Line-wise so a commented example does not count as a call site.
  return source.split(/\r?\n/)
    .filter(line => !/^\s*(\*|\/\/)/.test(line))
    .reduce((total, line) => total + (line.match(PROMPT_BEARING_CALL)?.length ?? 0), 0);
}

function directCallers(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(SRC)) {
    const rel = relative(file);
    if (EXEMPT_FILES.has(rel)) { continue; }
    if (EXEMPT_DIRECTORIES.some(dir => rel.startsWith(`${dir}/`))) { continue; }
    const count = countCalls(file);
    if (count > 0) { found.set(rel, count); }
  }
  return found;
}

describe('prompt-bearing provider calls stay behind the egress boundary', () => {
  it('found something to measure, rather than passing because the scan is broken', () => {
    // Without this, a regex that matches nothing would make every assertion
    // below vacuously true — the same failure as a coverage allowlist that
    // silently omits a directory.
    expect(directCallers().size).toBeGreaterThan(0);
  });

  it('has no direct caller that is not a recorded legacy one', () => {
    const unexpected = [...directCallers().keys()]
      .filter(file => !(file in LEGACY_DIRECT_CALLERS))
      .sort();

    expect(
      unexpected,
      'These files call a provider directly. Route the call through `prepareEgress` in '
      + '`src/core/modelEgress.ts` so its context is labelled, redacted and size-limited. '
      + 'Do not add them to LEGACY_DIRECT_CALLERS — that list only shrinks.',
    ).toEqual([]);
  });

  it('has no legacy caller that grew', () => {
    const current = directCallers();
    const grew = Object.entries(LEGACY_DIRECT_CALLERS)
      .filter(([file, allowed]) => (current.get(file) ?? 0) > allowed)
      .map(([file, allowed]) => `${file}: ${current.get(file)} > ${allowed}`);

    expect(grew, 'A file with pre-existing direct calls gained more.').toEqual([]);
  });

  /**
   * The ratchet. A migration that lowers the real count without lowering the
   * recorded one leaves the debt looking larger than it is, and the next reader
   * cannot tell which entries are real.
   */
  it('keeps the recorded counts honest by failing when one is set too high', () => {
    const current = directCallers();
    const stale = Object.entries(LEGACY_DIRECT_CALLERS)
      .filter(([file, allowed]) => (current.get(file) ?? 0) < allowed)
      .map(([file, allowed]) => `${file}: now ${current.get(file) ?? 0}, recorded ${allowed} — lower it`);

    expect(stale, 'Direct provider calls were removed. Lower the recorded counts.').toEqual([]);
  });

  it('exempts only the provider adapters and the boundary itself', () => {
    // Pinned so the exemption list cannot quietly grow into a second allowlist.
    expect(EXEMPT_DIRECTORIES).toEqual(['providers']);
    expect([...EXEMPT_FILES]).toEqual(['core/modelEgress.ts']);
  });
});

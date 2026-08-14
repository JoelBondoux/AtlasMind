import { expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Approval testing: compare against bytes somebody signed off, not against an
 * assertion written from the current output.
 *
 * Used by the two suites whose subject is *exact text* — the managed
 * instruction blocks AtlasMind writes into other people's repositories, and the
 * prompts it sends to models. Both are cases where a behavioural assertion is
 * circular: written from the new output, it passes against the new output, and
 * the change nobody meant to make ships.
 *
 * Shared rather than copied because the re-approval rule is the whole design.
 * Two copies would eventually disagree about when a baseline may write itself,
 * and the permissive copy would win.
 */

/**
 * Compare `actual` against the approved bytes for `name`.
 *
 * Re-approve intended changes with `APPROVE_BASELINES=1`, then commit the
 * updated `__approvals__` file alongside the change so the diff shows what
 * moved.
 *
 * Re-approval is behind an environment variable rather than "write the file if
 * it is missing". A baseline that creates itself on demand approves whatever
 * the code happened to produce on the run that deleted it, which is the failure
 * that makes approval testing worthless — and it fails open, silently, on
 * exactly the run where somebody was not paying attention.
 */
export function expectMatchesApproved(approvalsDir: string, name: string, actual: string): void {
  const file = path.join(approvalsDir, `${name}.approved.md`);

  if (process.env['APPROVE_BASELINES'] === '1') {
    mkdirSync(approvalsDir, { recursive: true });
    writeFileSync(file, actual, 'utf8');
    return;
  }

  expect(
    existsSync(file),
    `no approved baseline for "${name}" — run with APPROVE_BASELINES=1 to create it`,
  ).toBe(true);

  // Normalised for line endings only. A checkout on Windows with
  // `core.autocrlf` on would otherwise fail every baseline for a reason that
  // has nothing to do with the text.
  const approved = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  expect(actual.replace(/\r\n/g, '\n')).toBe(approved);
}

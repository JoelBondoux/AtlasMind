import { rmSync } from 'node:fs';

/**
 * Remove a temporary directory, and never fail a test for it.
 *
 * On Windows, `rmSync` on a tree that was just written can throw `EBUSY`,
 * `EPERM` or `ENOTEMPTY` — an antivirus scanner, the search indexer, or the
 * filesystem's own delayed handle release is still holding something. `retryDelay`
 * helps and does not eliminate it: the failure that pushed this into a helper was
 * `ENOTEMPTY` on a CI runner, after `maxRetries: 5`.
 *
 * A test that passes every assertion and then fails on housekeeping is reporting
 * a false negative, and a false negative in CI is worse than a leaked temporary
 * directory by a wide margin. Once a red build might mean nothing, people stop
 * reading red builds — which is exactly the failure mode `ciFailureAnalysis`
 * exists to keep out of this project, so it should not be introduced by the
 * tests.
 *
 * The directory itself is not a leak worth caring about: it is under the OS
 * temporary path, which the OS clears.
 */
export function removeTempDir(target: string | undefined): void {
  if (!target) {
    return;
  }
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // Housekeeping only. See the note above: a cleanup failure must not become
    // a test failure, because it says nothing about the code under test.
  }
}

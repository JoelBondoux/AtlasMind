# Releasing to the Marketplace

How a tagged release reaches the VS Code Marketplace. The promotion and tagging
steps (`develop` → `main`, `npm run tag:release`) are in
[github-workflow.md](github-workflow.md); this page covers what happens after
the tag exists.

## The rules (Joel, 2026-11-23)

1. **A release is published only through the release gate**, after it has been
   shown to have no new bugs that break functionality and no safety or security
   problems. The gate fails closed and has no skip, force or bypass option.
2. **Every release that passes is published, and none is left waiting.** A tag
   push does not publish; the next publish window does.
3. **At most two Marketplace publications per UK calendar day.** The gate counts
   today's publications from the Marketplace's own listing and refuses a third.
4. **Two scheduled publish windows a day, 10:30 and 22:00 UK.** A window does
   nothing unless a release newer than the Marketplace's exists. When several are
   waiting, it gates the newest first and publishes the newest that passes, never
   one per commit.

## The gate

`scripts/release-gate/release-gate.mjs`, run against a clean checkout of the tag.
`npm run release:gate` checks without publishing; `npm run publish:release`
publishes if it passes. In order, stopping at the first failure:

| Step | What it checks |
|---|---|
| preconditions | The working tree is clean and HEAD is the tag `v<package.json version>` |
| marketplace | The version is newer than the Marketplace's, and fewer than two versions went out today (UK). Unreadable Marketplace data fails |
| publish rights | `vsce verify-pat JoelBondoux`, before any long work (publish runs only) |
| npm ci | A clean install from the lockfile |
| local CI | `npm run ci:local`: compile, lint, integration audit, the whole test suite, provider recommendations, coverage, package |
| security tests | The repository's security suite, `tests/security` |
| npm audit | `npm audit --omit=dev --audit-level=high`: no high or critical advisory in what the VSIX ships |
| package | One `vsce package`. Every later step uses this exact file (`vsce`'s own secret scanner runs here too) |
| secret scan | Every file in that VSIX: private keys, GitHub, AWS, Anthropic, OpenAI, Slack, Google and npm tokens, `.env`, `.npmrc`, `.pem`/`.key`/`.p12`. Findings name the file and rule, never the matched text |
| install | `code --install-extension` into a throwaway profile, then VS Code must list `joelbondoux.atlasmind@<version>`. CLI only: no window opens |
| smoke | `vsix-smoke.cjs` loads the packaged extension (desktop and browser entries) against a stand-in `vscode` API: activation must finish with no failure in its log, every contributed command must be registered, and the core commands must run |
| publish | `vsce publish --packagePath <that VSIX>` (publish runs only) |

Exit 0 means passed (and published, with `--publish`); 1 means a check failed;
2 means refused before checking. `--report <file>` writes the step results as
JSON. The Marketplace credential is never read or printed by the gate: locally
`vsce` uses the credential `vsce login` stored in Windows Credential Manager; the
hosted fallback uses the Entra identity (`--azure-credential`).

`tests/release/releaseGate.test.ts` pins the rules: the daily limit in UK time,
newest-first candidates, the secret scanner, the refusal of any other argument,
and that no npm script or workflow can publish around the gate.

## The publish windows

`scripts/release-gate/release-window.mjs` (`npm run release:window`) is one
window. It runs from a dedicated clone, moves that clone to `origin/main` so the
newest gate rules apply, reads the Marketplace, and gates each newer tag
newest first in a throwaway worktree until one passes. Its log is
`%LOCALAPPDATA%\AtlasMind\release-gate\window.log`, with a JSON report per gate run
in `reports\`.

`scripts/release-gate/register-publish-windows.ps1` registers the two windows in
Windows Task Scheduler, because hosted Actions often have no credits to run:

- **Hidden.** The task starts `node` through `conhost --headless`, so no console
  window opens and nothing takes focus.
- **Only while Joel is signed in**, so `vsce` can reach the stored credential.
  It never wakes the machine.
- **Machine off or asleep at 10:30 or 22:00:** Task Scheduler runs the missed
  window once, soon after the next sign-in (`StartWhenAvailable`). Two missed
  windows become one run, and the daily limit still applies.
- **A launcher outside the clone.** The tasks run
  `%LOCALAPPDATA%\AtlasMind\release-gate\run-window.mjs`, which the script writes.
  It moves the clone to `origin/main` and runs that copy of `release-window.mjs`.
  If `main` has no gate yet, it logs that and exits, so the tasks need no change
  once the gate reaches `main`.
- `-Unregister` removes both tasks.

## Hosted fallback

`publish.yml` (**Release — publish Marketplace from tag**) is now dispatched by
hand for one tag. It installs the VS Code CLI and runs the same gate with
`--azure-credential`; it no longer runs on a tag push.

## What the first gate run found (0.516.7, 2026-11-23)

The gate was first run, check-only, on `v0.516.7` (already on the Marketplace
since 2026-11-03). 0.516.5 and 0.516.6 were never tagged, so they were never
releases and there was nothing to gate.

- **It failed at local CI**, on one test of 12,373: `docsIntegrity` required the
  README's "last Marketplace publication" to name the newest tag. At the moment
  a release is tagged that tag is the release itself, so every tag failed its own
  suite. The check now compares with the newest tag older than the source version.
- With that one test fixed, everything else passed on 0.516.7: the full test
  suite, coverage, packaging, the security suite (144 tests), `npm audit` (0
  production vulnerabilities), the install and the activation smoke test.
- The first secret scan flagged two false positives, both now excluded by
  tighter rules with tests: a PEM header that `jose` checks a string against
  (no key body), and AWS's documented placeholder key `AKIAIOSFODNN7EXAMPLE`.

---
id: publishing-routine
name: Publishing Routine
description: Verify and stage a release, then hand off to the Actions-driven release workflow
default: true
steps:
  - id: verify-clean
    label: Verify the working tree is clean
    run: git status --porcelain
    on_fail: prompt
  - id: merge-to-develop
    label: Merge the current branch into develop
    run: git checkout develop && git pull origin develop && git merge - --no-ff && git push origin develop
    on_fail: abort
  - id: compile
    label: Compile
    run: npm run compile
    on_fail: abort
  - id: lint
    label: Lint
    run: npm run lint
    on_fail: abort
  - id: test
    label: Test
    run: npm run test
    on_fail: abort
  - id: package
    label: Package the VSIX
    run: npm run package
    on_fail: abort
---

The release itself is **Actions-driven**, so this routine stops once `develop` is verified and
packaged. It deliberately does not publish.

**After this routine finishes:**

1. Trigger the **`Release — promote develop to main`** workflow from the Actions tab. It opens or
   reuses the `develop` → `main` release PR and enables squash auto-merge.
2. Wait for that PR to merge into `main` with CI green.
3. Run **`npm run tag:release`**. It pushes `v<version>`, and the tag push triggers
   `Release — publish Marketplace from tag`, which publishes and creates the GitHub Release.

**Why publishing is not a step here.** `npm run publish:release` is `vsce publish && npm run
tag:release` — it publishes *and* pushes the tag, and the tag push then triggers CI to run
`publish:release` again, which fails on "version already exists". One release, one publish path.
Reserve `publish:release` for an emergency local publish when Actions is unavailable.

**Interpolation.** Only `${message}` and `${version}` are substituted — see
[`README.md`](README.md) in this folder. Earlier versions of this file referenced `${BRANCH}` and
`${VERSION}`, which were never substituted and so ran literally; the merge step now uses git's `-`
shorthand for the previous branch instead.

See [`docs/guided-github-workflow.md`](../../docs/guided-github-workflow.md) for the workflow this
routine implements, and [`docs/github-workflow.md`](../../docs/github-workflow.md) for this
repository's release values.

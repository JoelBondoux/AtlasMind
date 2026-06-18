---
id: publishing-routine
name: Publishing Routine
description: Scaffolded from CLAUDE.md
default: true
steps:
  - id: merge-to-develop
    label: Merge to develop
    run: git checkout develop && git pull origin develop && git merge ${BRANCH} --no-ff && git push origin develop
    on_fail: abort
  - id: compile
    label: Compile
    run: npm run compile
    on_fail: abort
  - id: package
    label: Package
    run: atlasmind-${VERSION}.vsix
    on_fail: abort
  - id: open-pr-to-master
    label: Open PR to master
    run: gh pr create --base master --head develop
    on_fail: abort
  - id: wait-for-pr-merge
    label: Wait for PR merge
    run: master
    on_fail: abort
  - id: publish
    label: Publish
    run: NODE_OPTIONS="--use-system-ca" npm run publish:release
    on_fail: abort
---

> Scaffolded from project instructions during `/import`. Edit steps to match your actual workflow.

<!-- atlasmind-import
entry-path: routines/publishing-routine.md
generator-version: 2
generated-at: 2026-06-18T03:50:15.377Z
source-paths: CLAUDE.md
source-fingerprint: 0c187393
body-fingerprint: 77113255
-->

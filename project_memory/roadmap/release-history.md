# Release History Snapshot

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.44.4] - 2026-04-08

### Changed
- Packaging: Tightened `.vscodeignore` so local VSIX builds exclude workspace-only artifacts such as assistant metadata, project memory snapshots, wiki pages, generated VSIX files, local Vitest JSON reports, and extra dependency documentation or test folders.

## [0.44.3] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now records whether the project already has an online repo, where a new one should be created if it does not, and writes that decision into `operations/repository-plan.md` plus the generated brief and roadmap.

### Changed
- Bootstrap: Repo-hosting intent can now be inferred from earlier freeform answers, so Atlas can skip the later remote-repository prompts without losing the target host or location.

## [0.44.2] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now seeds project-scoped Personality Profile defaults when the intake provides stable project guidance, so Atlas carries that context into later task routing without requiring a separate manual profile pass.

### Changed
- Bootstrap: The guided intake now reuses future-answer details when they were already provided in an earlier freeform response, which prevents Atlas from apparently forgetting out-of-order context and avoids redundant prompts.

## [0.44.1] - 2026-04-08

### Added
- Personality Profile: Added separate Save as Global Default and Save for This Project actions so Atlas can carry a reusable operator baseline across workspaces while still supporting repo-specific overrides.

### Changed
- Personality Profile: Atlas now merges the saved global profile with any project override before injecting workspace identity into task prompts, and the panel can restore the saved global baseline or Atlas defaults into the editor before saving.

### Fixed
- Personality Profile: Reverting a project back to the global baseline now clears project-scoped questionnaire data, removes generated SSOT profile artifacts, and drops workspace-only live-setting overrides so the user-level defaults take effect again.

## [0.44.0] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now runs a guided but fully skippable Atlas intake for project brief, audience, builders, timeline, budget, routing posture, stack, and third-party tooling.
- Bootstrap: Intake answers now seed SSOT artifacts including `project_soul.md`, `domain/project-brief.md`, `operations/bootstrap-intake.md`, `roadmap/bootstrap-plan.md`, and the initial ideation board files under `project_memory/ideas/`.
- Bootstrap: Atlas now writes GitHub-ready planning artifacts during bootstrap, including `.github/ISSUE_TEMPLATE/project_intake.yml` and `.github/project-planning/atlasmind-project-items.csv`.

### Changed
- Governance scaffoldi
…(truncated)

<!-- atlasmind-import
entry-path: roadmap/release-history.md
generator-version: 2
generated-at: 2026-04-08T06:09:03.946Z
source-paths: CHANGELOG.md | package.json
source-fingerprint: 0baffe8f
body-fingerprint: d7fd2a21
-->

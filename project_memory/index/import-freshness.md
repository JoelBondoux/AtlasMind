# Import Freshness Report

## Status Legend
- `created` — new import artifact generated this run.
- `refreshed` — source content changed and the generated memory was updated.
- `unchanged` — source fingerprint matched the last generated version, so the file was left untouched.
- `preserved-manual-edits` — AtlasMind detected local edits in a generated file and skipped overwriting it.
- `rejected` — the candidate was not written because memory validation rejected it.

## Entries
### Project Overview
- Path: `architecture/project-overview.md`
- Status: `refreshed`
- Source fingerprint: `764aa97f`
- Sources: README.md

### Project Dependencies
- Path: `architecture/dependencies.md`
- Status: `refreshed`
- Source fingerprint: `1fd3665c`
- Sources: package.json

### Project Structure
- Path: `architecture/project-structure.md`
- Status: `unchanged`
- Source fingerprint: `b5f87ccc`
- Sources: workspace-root

### Codebase Map
- Path: `architecture/codebase-map.md`
- Status: `refreshed`
- Source fingerprint: `eab07eb6`
- Sources: src, tests, docs, wiki, project_memory, .github

### Build & Tooling Conventions
- Path: `domain/conventions.md`
- Status: `unchanged`
- Source fingerprint: `181248cd`
- Sources: tsconfig.json, .gitignore, .editorconfig, .prettierrc, eslint.config.js, .eslintrc.json, .eslintrc.js, Dockerfile, docker-compose.yml, Makefile

### Product Capabilities
- Path: `domain/product-capabilities.md`
- Status: `refreshed`
- Source fingerprint: `955381c5`
- Sources: README.md, package.json

### Runtime & Surface Architecture
- Path: `architecture/runtime-and-surfaces.md`
- Status: `unchanged`
- Source fingerprint: `30ff5a4c`
- Sources: docs/architecture.md

### Model Routing Summary
- Path: `architecture/model-routing.md`
- Status: `unchanged`
- Source fingerprint: `6612f474`
- Sources: docs/model-routing.md

### Agents & Skills Summary
- Path: `architecture/agents-and-skills.md`
- Status: `rejected`
- Source fingerprint: `6bd9a4fc`
- Sources: docs/agents-and-skills.md
- Note: Content failed security scan: Possible prompt injection: system-prompt override pattern detected. This entry will not be sent to the model.

### Development Workflow
- Path: `operations/development-workflow.md`
- Status: `unchanged`
- Source fingerprint: `d835ce42`
- Sources: docs/development.md, docs/github-workflow.md

### Configuration Reference Summary
- Path: `operations/configuration-reference.md`
- Status: `unchanged`
- Source fingerprint: `b85b44a2`
- Sources: docs/configuration.md

### Security & Safety Summary
- Path: `operations/security-and-safety.md`
- Status: `unchanged`
- Source fingerprint: `4d9718ce`
- Sources: SECURITY.md, docs/architecture.md, .github/copilot-instructions.md

### Development Guardrails
- Path: `decisions/development-guardrails.md`
- Status: `unchanged`
- Source fingerprint: `9264430b`
- Sources: .github/copilot-instructions.md, docs/github-workflow.md

### Release History Snapshot
- Path: `roadmap/release-history.md`
- Status: `refreshed`
- Source fingerprint: `0c819274`
- Sources: CHANGELOG.md, package.json

### Developer Roadmap
- Path: `roadmap/improvement-plan.md`
- Status: `preserved-manual-edits`
- Source fingerprint: `28d558d2`
- Sources: README.md, package.json
- Note: Existing imported file has local edits; AtlasMind preserved it.

### Project License
- Path: `domain/license.md`
- Status: `unchanged`
- Source fingerprint: `721ac780`
- Sources: LICENSE

<!-- atlasmind-import
entry-path: index/import-freshness.md
generator-version: 2
generated-at: 2026-07-24T12:06:10.564Z
source-paths: architecture/project-overview.md | architecture/dependencies.md | architecture/project-structure.md | architecture/codebase-map.md | domain/conventions.md | domain/product-capabilities.md | architecture/runtime-and-surfaces.md | architecture/model-routing.md | architecture/agents-and-skills.md | operations/development-workflow.md | operations/configuration-reference.md | operations/security-and-safety.md | decisions/development-guardrails.md | roadmap/release-history.md | roadmap/improvement-plan.md | domain/license.md
source-fingerprint: a5eeec18
body-fingerprint: 3ace42f5
-->

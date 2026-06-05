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
- Status: `unchanged`
- Source fingerprint: `c42eddb0`
- Sources: README.md

### Project Dependencies
- Path: `architecture/dependencies.md`
- Status: `unchanged`
- Source fingerprint: `12aa3559`
- Sources: package.json

### Project Structure
- Path: `architecture/project-structure.md`
- Status: `unchanged`
- Source fingerprint: `9fc65997`
- Sources: workspace-root

### Codebase Map
- Path: `architecture/codebase-map.md`
- Status: `unchanged`
- Source fingerprint: `82f71fa3`
- Sources: src, tests, docs, wiki, project_memory, .github

### Build & Tooling Conventions
- Path: `domain/conventions.md`
- Status: `unchanged`
- Source fingerprint: `87b21b9d`
- Sources: tsconfig.json, .gitignore, .editorconfig, .prettierrc, eslint.config.js, .eslintrc.json, .eslintrc.js, Dockerfile, docker-compose.yml, Makefile

### Product Capabilities
- Path: `domain/product-capabilities.md`
- Status: `unchanged`
- Source fingerprint: `0083979a`
- Sources: README.md, package.json

### Runtime & Surface Architecture
- Path: `architecture/runtime-and-surfaces.md`
- Status: `unchanged`
- Source fingerprint: `f67fac79`
- Sources: docs/architecture.md

### Model Routing Summary
- Path: `architecture/model-routing.md`
- Status: `unchanged`
- Source fingerprint: `b366f5d2`
- Sources: docs/model-routing.md

### Agents & Skills Summary
- Path: `architecture/agents-and-skills.md`
- Status: `rejected`
- Source fingerprint: `7c0fdcc3`
- Sources: docs/agents-and-skills.md
- Note: Content failed security scan: Possible prompt injection: system-prompt override pattern detected. This entry will not be sent to the model.

### Development Workflow
- Path: `operations/development-workflow.md`
- Status: `unchanged`
- Source fingerprint: `bfb0e8fc`
- Sources: docs/development.md, docs/github-workflow.md

### Configuration Reference Summary
- Path: `operations/configuration-reference.md`
- Status: `unchanged`
- Source fingerprint: `72ba8c34`
- Sources: docs/configuration.md

### Security & Safety Summary
- Path: `operations/security-and-safety.md`
- Status: `unchanged`
- Source fingerprint: `65955bdc`
- Sources: SECURITY.md, docs/architecture.md, .github/copilot-instructions.md

### Development Guardrails
- Path: `decisions/development-guardrails.md`
- Status: `unchanged`
- Source fingerprint: `02371a0c`
- Sources: .github/copilot-instructions.md, docs/github-workflow.md

### Release History Snapshot
- Path: `roadmap/release-history.md`
- Status: `unchanged`
- Source fingerprint: `50fbee63`
- Sources: CHANGELOG.md, package.json

### Developer Roadmap
- Path: `roadmap/improvement-plan.md`
- Status: `unchanged`
- Source fingerprint: `1939e89e`
- Sources: README.md, package.json

### Project License
- Path: `domain/license.md`
- Status: `unchanged`
- Source fingerprint: `721ac780`
- Sources: LICENSE

<!-- atlasmind-import
entry-path: index/import-freshness.md
generator-version: 2
generated-at: 2026-06-05T13:09:54.054Z
source-paths: architecture/project-overview.md | architecture/dependencies.md | architecture/project-structure.md | architecture/codebase-map.md | domain/conventions.md | domain/product-capabilities.md | architecture/runtime-and-surfaces.md | architecture/model-routing.md | architecture/agents-and-skills.md | operations/development-workflow.md | operations/configuration-reference.md | operations/security-and-safety.md | decisions/development-guardrails.md | roadmap/release-history.md | roadmap/improvement-plan.md | domain/license.md
source-fingerprint: 36cdf74b
body-fingerprint: b73377fb
-->

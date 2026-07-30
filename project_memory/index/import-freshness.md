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
- Source fingerprint: `6d1b5cf4`
- Sources: README.md

### Project Dependencies
- Path: `architecture/dependencies.md`
- Status: `refreshed`
- Source fingerprint: `74734a78`
- Sources: package.json

### Project Structure
- Path: `architecture/project-structure.md`
- Status: `refreshed`
- Source fingerprint: `83373b1f`
- Sources: workspace-root

### Codebase Map
- Path: `architecture/codebase-map.md`
- Status: `refreshed`
- Source fingerprint: `98760453`
- Sources: src, tests, docs, wiki, project_memory, .github

### Build & Tooling Conventions
- Path: `domain/conventions.md`
- Status: `refreshed`
- Source fingerprint: `142d0f68`
- Sources: tsconfig.json, .gitignore, .editorconfig, .prettierrc, eslint.config.js, .eslintrc.json, .eslintrc.js, Dockerfile, docker-compose.yml, Makefile

### Product Capabilities
- Path: `domain/product-capabilities.md`
- Status: `refreshed`
- Source fingerprint: `fe4c08af`
- Sources: README.md, package.json

### Runtime & Surface Architecture
- Path: `architecture/runtime-and-surfaces.md`
- Status: `refreshed`
- Source fingerprint: `1b15eda6`
- Sources: docs/architecture.md

### Model Routing Summary
- Path: `architecture/model-routing.md`
- Status: `refreshed`
- Source fingerprint: `f3076239`
- Sources: docs/model-routing.md

### Agents & Skills Summary
- Path: `architecture/agents-and-skills.md`
- Status: `rejected`
- Source fingerprint: `f4e8bece`
- Sources: docs/agents-and-skills.md
- Note: Content failed security scan: Possible prompt injection: system-prompt override pattern detected. This entry will not be sent to the model.

### Development Workflow
- Path: `operations/development-workflow.md`
- Status: `refreshed`
- Source fingerprint: `e39f56b2`
- Sources: docs/development.md, docs/github-workflow.md

### Configuration Reference Summary
- Path: `operations/configuration-reference.md`
- Status: `refreshed`
- Source fingerprint: `e557aee7`
- Sources: docs/configuration.md

### Security & Safety Summary
- Path: `operations/security-and-safety.md`
- Status: `refreshed`
- Source fingerprint: `f5b87680`
- Sources: SECURITY.md, docs/architecture.md, .github/copilot-instructions.md

### Development Guardrails
- Path: `decisions/development-guardrails.md`
- Status: `refreshed`
- Source fingerprint: `9264430b`
- Sources: .github/copilot-instructions.md, docs/github-workflow.md

### Release History Snapshot
- Path: `roadmap/release-history.md`
- Status: `refreshed`
- Source fingerprint: `b4a98bdb`
- Sources: CHANGELOG.md, package.json

### Developer Roadmap
- Path: `roadmap/improvement-plan.md`
- Status: `refreshed`
- Source fingerprint: `923626bb`
- Sources: README.md, package.json

### Project License
- Path: `domain/license.md`
- Status: `unchanged`
- Source fingerprint: `721ac780`
- Sources: LICENSE

<!-- atlasmind-import
entry-path: index/import-freshness.md
generator-version: 2
generated-at: 2026-07-28T12:06:49.103Z
source-paths: architecture/project-overview.md | architecture/dependencies.md | architecture/project-structure.md | architecture/codebase-map.md | domain/conventions.md | domain/product-capabilities.md | architecture/runtime-and-surfaces.md | architecture/model-routing.md | architecture/agents-and-skills.md | operations/development-workflow.md | operations/configuration-reference.md | operations/security-and-safety.md | decisions/development-guardrails.md | roadmap/release-history.md | roadmap/improvement-plan.md | domain/license.md
source-fingerprint: fb43085f
body-fingerprint: 46ea3e8f
-->

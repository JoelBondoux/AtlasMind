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
- Status: `created`
- Source fingerprint: `7ad50cd4`
- Sources: README.md

### Project Dependencies
- Path: `architecture/dependencies.md`
- Status: `created`
- Source fingerprint: `a89028c0`
- Sources: package.json

### Project Structure
- Path: `architecture/project-structure.md`
- Status: `created`
- Source fingerprint: `3e1354af`
- Sources: workspace-root

### Codebase Map
- Path: `architecture/codebase-map.md`
- Status: `created`
- Source fingerprint: `18ce0988`
- Sources: src, tests, docs, wiki, project_memory, .github

### Build & Tooling Conventions
- Path: `domain/conventions.md`
- Status: `created`
- Source fingerprint: `9a3c6102`
- Sources: tsconfig.json, .gitignore, .editorconfig, .prettierrc, eslint.config.js, .eslintrc.json, .eslintrc.js, Dockerfile, docker-compose.yml, Makefile

### Product Capabilities
- Path: `domain/product-capabilities.md`
- Status: `created`
- Source fingerprint: `70a3969e`
- Sources: README.md, package.json

### Runtime & Surface Architecture
- Path: `architecture/runtime-and-surfaces.md`
- Status: `created`
- Source fingerprint: `b5580218`
- Sources: docs/architecture.md

### Model Routing Summary
- Path: `architecture/model-routing.md`
- Status: `created`
- Source fingerprint: `1315288f`
- Sources: docs/model-routing.md

### Agents & Skills Summary
- Path: `architecture/agents-and-skills.md`
- Status: `rejected`
- Source fingerprint: `56dc107f`
- Sources: docs/agents-and-skills.md
- Note: Content failed security scan: Possible prompt injection: system-prompt override pattern detected. This entry will not be sent to the model.

### Development Workflow
- Path: `operations/development-workflow.md`
- Status: `created`
- Source fingerprint: `0909ea56`
- Sources: docs/development.md, docs/github-workflow.md

### Configuration Reference Summary
- Path: `operations/configuration-reference.md`
- Status: `created`
- Source fingerprint: `34d091ac`
- Sources: docs/configuration.md

### Security & Safety Summary
- Path: `operations/security-and-safety.md`
- Status: `created`
- Source fingerprint: `3c1a6b59`
- Sources: SECURITY.md, docs/architecture.md, .github/copilot-instructions.md

### Development Guardrails
- Path: `decisions/development-guardrails.md`
- Status: `created`
- Source fingerprint: `eefe032f`
- Sources: .github/copilot-instructions.md, docs/github-workflow.md

### Release History Snapshot
- Path: `roadmap/release-history.md`
- Status: `created`
- Source fingerprint: `7b33a807`
- Sources: CHANGELOG.md, package.json

### Developer Roadmap
- Path: `roadmap/improvement-plan.md`
- Status: `created`
- Source fingerprint: `7c2b9e72`
- Sources: README.md, package.json

### Project License
- Path: `domain/license.md`
- Status: `created`
- Source fingerprint: `721ac780`
- Sources: LICENSE

<!-- atlasmind-import
entry-path: index/import-freshness.md
generator-version: 2
generated-at: 2026-04-19T22:15:34.899Z
source-paths: architecture/project-overview.md | architecture/dependencies.md | architecture/project-structure.md | architecture/codebase-map.md | domain/conventions.md | domain/product-capabilities.md | architecture/runtime-and-surfaces.md | architecture/model-routing.md | architecture/agents-and-skills.md | operations/development-workflow.md | operations/configuration-reference.md | operations/security-and-safety.md | decisions/development-guardrails.md | roadmap/release-history.md | roadmap/improvement-plan.md | domain/license.md
source-fingerprint: ab146fc3
body-fingerprint: c3378f65
-->

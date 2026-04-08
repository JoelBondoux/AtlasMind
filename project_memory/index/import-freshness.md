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
- Source fingerprint: `881c3893`
- Sources: README.md

### Project Dependencies
- Path: `architecture/dependencies.md`
- Status: `unchanged`
- Source fingerprint: `338703db`
- Sources: package.json

### Project Structure
- Path: `architecture/project-structure.md`
- Status: `unchanged`
- Source fingerprint: `79f9fdab`
- Sources: workspace-root

### Codebase Map
- Path: `architecture/codebase-map.md`
- Status: `unchanged`
- Source fingerprint: `e4d1da4f`
- Sources: src, tests, docs, wiki, project_memory, .github

### Build & Tooling Conventions
- Path: `domain/conventions.md`
- Status: `unchanged`
- Source fingerprint: `1f3995f5`
- Sources: tsconfig.json, .gitignore, .editorconfig, .prettierrc, eslint.config.js, .eslintrc.json, .eslintrc.js, Dockerfile, docker-compose.yml, Makefile

### Product Capabilities
- Path: `domain/product-capabilities.md`
- Status: `unchanged`
- Source fingerprint: `697b511c`
- Sources: README.md, package.json

### Runtime & Surface Architecture
- Path: `architecture/runtime-and-surfaces.md`
- Status: `unchanged`
- Source fingerprint: `802800bf`
- Sources: docs/architecture.md

### Model Routing Summary
- Path: `architecture/model-routing.md`
- Status: `unchanged`
- Source fingerprint: `6ad18d98`
- Sources: docs/model-routing.md

### Agents & Skills Summary
- Path: `architecture/agents-and-skills.md`
- Status: `rejected`
- Source fingerprint: `444d38f2`
- Sources: docs/agents-and-skills.md
- Note: Content failed security scan: Possible prompt injection: system-prompt override pattern detected. This entry will not be sent to the model.

### Development Workflow
- Path: `operations/development-workflow.md`
- Status: `unchanged`
- Source fingerprint: `dae97116`
- Sources: docs/development.md, docs/github-workflow.md

### Configuration Reference Summary
- Path: `operations/configuration-reference.md`
- Status: `unchanged`
- Source fingerprint: `062b2b22`
- Sources: docs/configuration.md

### Security & Safety Summary
- Path: `operations/security-and-safety.md`
- Status: `unchanged`
- Source fingerprint: `8ae37d4c`
- Sources: SECURITY.md, docs/architecture.md, .github/copilot-instructions.md

### Development Guardrails
- Path: `decisions/development-guardrails.md`
- Status: `unchanged`
- Source fingerprint: `2f47a1f5`
- Sources: .github/copilot-instructions.md, docs/github-workflow.md

### Release History Snapshot
- Path: `roadmap/release-history.md`
- Status: `unchanged`
- Source fingerprint: `6e192f73`
- Sources: CHANGELOG.md, package.json

### Project License
- Path: `domain/license.md`
- Status: `unchanged`
- Source fingerprint: `721ac780`
- Sources: LICENSE

<!-- atlasmind-import
entry-path: index/import-freshness.md
generator-version: 2
generated-at: 2026-04-08T03:59:50.757Z
source-paths: architecture/project-overview.md | architecture/dependencies.md | architecture/project-structure.md | architecture/codebase-map.md | domain/conventions.md | domain/product-capabilities.md | architecture/runtime-and-surfaces.md | architecture/model-routing.md | architecture/agents-and-skills.md | operations/development-workflow.md | operations/configuration-reference.md | operations/security-and-safety.md | decisions/development-guardrails.md | roadmap/release-history.md | domain/license.md
source-fingerprint: 9ef69125
body-fingerprint: 2c7dfc20
-->

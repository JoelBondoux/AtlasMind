# Build & Tooling Conventions

## TypeScript
- Target: ES2022
- Module: Node16
- Strict: true
- OutDir: out

## Git Ignore (top entries)
- out/
- node_modules/
- *.vsix
- .vscode-test/
- coverage/
- test-results/
- .claude/
- project_memory_old/
- project_memory/sessions/
- project_memory/temp/
- project_memory/operations/project-run-*.json
- project_memory/operations/.delivery-lock.json
- .atlasmind/

<!-- atlasmind-import
entry-path: domain/conventions.md
generator-version: 2
generated-at: 2026-07-31T03:25:06.200Z
source-paths: tsconfig.json | .gitignore | .editorconfig | .prettierrc | eslint.config.js | .eslintrc.json | .eslintrc.js | Dockerfile | docker-compose.yml | Makefile
source-fingerprint: 6d4f6c23
body-fingerprint: 6c23c53b
-->

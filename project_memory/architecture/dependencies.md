# Project Dependencies

Tags: #import #dependencies #node

# Dependencies (node)

**Package**: atlasmind
**Version**: 0.36.4
**Description**: Developer-centric multi-agent orchestrator for VS Code with model routing, long-term memory, and skills registry.

## Runtime Dependencies
- @modelcontextprotocol/sdk: MCP client and server integration for AtlasMind's external tool surface.
- zod: schema validation for typed payloads and safer input handling.

## Development Toolchain
- TypeScript in strict Node16/ES2022 mode.
- ESLint for source and test linting.
- Vitest plus coverage for unit and integration testing.
- VS Code extension packaging through `@vscode/vsce`.

## Important Scripts
- `compile`: one-shot TypeScript build.
- `watch`: persistent TypeScript watch build.
- `lint`: static analysis for `src` and `tests`.
- `test` and `test:coverage`: verification loop.
- `package:vsix`, `publish:pre-release`, and `publish:release`: extension packaging and publishing workflow.

## Dependency Notes
- AtlasMind now ships a compiled CLI entrypoint in addition to the VS Code extension host.
- Runtime packaging must keep production dependencies available; packaging with `--no-dependencies` is unsafe unless everything is fully bundled.


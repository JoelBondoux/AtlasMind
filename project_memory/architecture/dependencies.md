# Project Dependencies

Tags: #import #dependencies #node

# Dependencies (node)

**Package**: atlasmind
**Version**: 0.35.0
**Description**: Developer-centric multi-agent orchestrator for VS Code with model routing, long-term memory, and skills registry.

## Dependencies (2)
- @modelcontextprotocol/sdk: ^1.29.0
- zod: ^4.3.6

## Dev Dependencies (8)
- @types/node: ^20.11.0
- @types/vscode: ^1.95.0
- @typescript-eslint/eslint-plugin: ^7.0.0
- @typescript-eslint/parser: ^7.0.0
- @vitest/coverage-v8: ^4.1.2
- eslint: ^8.57.0
- typescript: ^5.4.0
- vitest: ^4.1.2

## NPM Scripts (11)
- `vscode:prepublish`: `npm run compile`
- `compile`: `tsc -p ./`
- `watch`: `tsc -watch -p ./`
- `lint`: `eslint src tests --ext ts`
- `test`: `vitest run`
- `test:watch`: `vitest`
- `test:coverage`: `vitest run --coverage`
- `package`: `vsce package`
- `package:vsix`: `npx @vscode/vsce package`
- `publish:pre-release`: `npx @vscode/vsce publish --pre-release`
- `publish:release`: `npx @vscode/vsce publish`


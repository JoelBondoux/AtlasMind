# Project Dependencies

Tags: #import #dependencies #node #typescript #vscode

# Project Dependencies

Tags: #import #dependencies #node

# Dependencies (node)

**Package**: atlasmind
**Version**: 0.36.21
**Description**: Developer-centric multi-agent orchestrator for VS Code with model routing, long-term memory, and skills registry.

## Production Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.29.0",
  "zod": "^4.3.6"
}
```

### Core Dependencies

- **@modelcontextprotocol/sdk** (^1.29.0): Model Context Protocol SDK for MCP server integration
- **zod** (^4.3.6): TypeScript-first schema validation library

## Development Dependencies

```json
{
  "@types/node": "^20.11.0",
  "@types/vscode": "^1.95.0",
  "@typescript-eslint/eslint-plugin": "^7.0.0",
  "@typescript-eslint/parser": "^7.0.0",
  "@vitest/coverage-v8": "^4.1.2",
  "eslint": "^8.57.0",
  "typescript": "^5.4.0",
  "vitest": "^4.1.2"
}
```

### Development Tools

- **TypeScript**: ^5.4.0 - Main language and compiler
- **Vitest**: ^4.1.2 - Test framework with coverage via v8
- **ESLint**: ^8.57.0 - Code linting with TypeScript parser and plugin
- **VS Code Types**: ^1.95.0 - VS Code API type definitions
- **Node Types**: ^20.11.0 - Node.js type definitions

## Package Scripts

- `vscode:prepublish`: npm run compile
- `compile`: tsc -p ./
- `watch`: tsc -watch -p ./
- `cli`: node ./out/cli/main.js
- `lint`: eslint src tests --ext ts
- `test`: vitest run
- `test:watch`: vitest
- `test:coverage`: vitest run --coverage
- `package`: vsce package
- `package:vsix`: npx @vscode/vsce package
- `publish:pre-release`: npx @vscode/vsce publish --pre-release
- `publish:release`: npx @vscode/vsce publish

## Runtime Requirements

- **Node.js**: Compatible with Node.js 20.11+
- **VS Code**: Requires VS Code ^1.95.0
- **Platform**: Cross-platform (Windows, macOS, Linux)

## Key Dependencies Notes

- Minimal production dependency footprint with only MCP SDK and Zod
- Heavy use of VS Code built-in APIs and Node.js standard library
- TypeScript-first development with comprehensive type safety
- Test coverage via Vitest with V8 coverage reporting
- Extension packaging via VS Code Extension CLI (vsce)

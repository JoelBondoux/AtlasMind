# Project Structure

Tags: #import #structure #architecture #vscode #typescript

# Project Structure

Tags: #import #structure #architecture

# Project Structure

Top-level contents of the workspace:

```
.eslintrc.cjs           # ESLint configuration
.git/                   # Git repository data
.github/                # GitHub Actions and templates
.gitignore              # Git ignore patterns
.vscode/                # VS Code workspace settings
.vscodeignore           # VS Code extension packaging exclusions
*.vsix                  # Extension package files (multiple versions)
CHANGELOG.md            # Release notes and version history
CONTRIBUTING.md         # Contribution guidelines
CONTRIBUTORS.md         # List of contributors
coverage/               # Test coverage reports
docs/                   # Documentation
LICENSE                 # MIT license
media/                  # Icons and walkthrough media
node_modules/           # Node.js dependencies
out/                    # Compiled TypeScript output
package-lock.json       # Dependency lock file
package.json            # Node.js package configuration
project_memory/         # SSOT memory system (default location)
README.md               # Project overview
SECURITY.md             # Security policies
src/                    # TypeScript source code
tests/                  # Test files
tsconfig.json           # TypeScript configuration
vitest.config.ts        # Test framework configuration
wiki/                   # Project wiki content
```

## Source Code Structure (`src/`)

```
bootstrap/              # Project bootstrapping and import
chat/                   # Chat participant and conversation logic
cli/                    # Command-line interface
commands.ts             # VS Code command registrations
constants.ts            # Application constants
core/                   # Core orchestrator and agent logic
extension.ts            # Main VS Code extension entry point
mcp/                    # Model Context Protocol integration
memory/                 # SSOT memory system
providers/              # Model provider abstractions
runtime/                # Tool execution and skill runtime
skills/                 # Skill registry and management
types.ts                # TypeScript type definitions
utils/                  # Utility functions
views/                  # VS Code webview and tree view providers
voice/                  # Text-to-speech and speech-to-text
```

## Key Files

- **package.json**: Defines extension manifest, commands, settings, and dependencies
- **extension.ts**: Main extension activation and command registration
- **src/core/**: Core orchestrator logic for agent selection and routing
- **src/memory/**: SSOT (Single Source of Truth) memory management
- **src/providers/**: Multi-provider model routing (OpenAI, Azure, Bedrock, etc.)
- **src/skills/**: Dynamic skill registry and execution framework
- **src/chat/**: Chat participant implementation for VS Code native chat
- **src/views/**: UI components for agents, skills, models, and memory trees

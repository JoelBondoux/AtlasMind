# Skills

AtlasMind ships with **26 built-in skills** that agents can call during execution. You can also import custom skills or connect MCP servers for unlimited extensibility.

## Built-in Skills

### File Operations

| Skill | Description |
|-------|-------------|
| `file-read` | Read file contents with optional line range (`startLine`, `endLine`) |
| `file-write` | Write content to a file (creates or overwrites) |
| `file-edit` | Apply targeted edits to an existing file (find/replace) |
| `file-search` | Search for files by glob pattern |
| `file-delete` | Delete a file (workspace-sandboxed) |
| `file-move` | Move or rename a file (workspace-sandboxed) |
| `directory-list` | List contents of a directory with types |

### Git Operations

| Skill | Description |
|-------|-------------|
| `git-status` | Get `git status --short --branch` output |
| `git-diff` | Get diff (optionally staged or against a ref) |
| `git-commit` | Stage and commit changes with a message |
| `git-log` | View commit history with filtering options |
| `git-branch` | List, create, switch, or delete branches |
| `git-apply-patch` | Apply a unified diff patch to the workspace |
| `diff-preview` | Preview changes before applying (dry run) |
| `rollback-checkpoint` | Restore the most recent automatic pre-write snapshot |

### Code Intelligence

| Skill | Description |
|-------|-------------|
| `diagnostics` | Retrieve compiler errors and warnings via the VS Code diagnostics API |
| `code-symbols` | AST-aware navigation: list symbols, find references, go to definition |
| `rename-symbol` | Cross-codebase rename via the language server with identifier validation |
| `code-action` | List and apply code actions (quick fixes, refactorings) from language servers |

### Search & Fetch

| Skill | Description |
|-------|-------------|
| `text-search` | Grep-style text search across workspace files (regex supported) |
| `memory-query` | Query the SSOT memory system (max 50 results) |
| `web-fetch` | Fetch URL content with SSRF protection (blocks localhost, private IPs, metadata endpoints); 30s timeout |

### Memory

| Skill | Description |
|-------|-------------|
| `memory-write` | Write an entry to SSOT memory (validated, scanned, persisted to disk) |
| `memory-delete` | Remove a memory entry by path |

### Execution

| Skill | Description |
|-------|-------------|
| `terminal-run` | Execute a command in the workspace terminal with a tiered allow-list (~40 safe commands); 15s timeout |
| `test-run` | Auto-detect and run test framework (vitest, jest, mocha, pytest, cargo test); 120s timeout |

## Skill Definition

```typescript
interface SkillDefinition {
  id: string;                          // Unique identifier
  name: string;                        // Display name
  description: string;                 // Shown to the LLM for tool selection
  parameters: Record<string, unknown>; // JSON Schema for parameters
  execute: SkillHandler;               // The handler function
  source?: string;                     // Absolute path (custom skills only)
  builtIn?: boolean;                   // true for extension-provided skills
  timeoutMs?: number;                  // Execution timeout (default: 15000ms)
}

type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;
```

## Skill Execution Context

Every skill handler receives a `SkillExecutionContext` with workspace APIs:

- **File I/O:** `readFile()`, `writeFile()`, `deleteFile()`, `moveFile()`, `findFiles()`, `listDirectory()`
- **Text search:** `searchInFiles()` with regex support
- **Git:** `getGitStatus()`, `getGitDiff()`, `getGitLog()`, `gitBranch()`, `applyGitPatch()`
- **Code intelligence:** `getDiagnostics()`, `getDocumentSymbols()`, `findReferences()`, `goToDefinition()`, `renameSymbol()`, `getCodeActions()`, `applyCodeAction()`
- **Terminal:** `runCommand()` (with allow-list enforcement)
- **Test runner:** `testRun()` (auto-detect framework)
- **Web fetch:** `fetchUrl()` (with SSRF protection)
- **Memory:** `queryMemory()`, `upsertMemory()`, `deleteMemory()`
- **Checkpoints:** `rollbackLastCheckpoint()`

All file operations are workspace-sandboxed — path traversal outside the workspace root is rejected.

## Enable / Disable Skills

- Toggle any skill in the **Skills** sidebar tree view
- Disabled skills are hidden from agents and the LLM
- Disabled IDs persist across sessions in `atlasmind.disabledSkillIds`

## Timeouts

| Skill | Timeout |
|-------|---------|
| Default | 15 seconds |
| `web-fetch` | 30 seconds |
| `test-run` | 120 seconds |
| Custom (configurable) | Set via `timeoutMs` on `SkillDefinition` |

## Tool Call Limits

- **Max tool calls per turn:** 8
- Multiple tools in one turn run concurrently with `Promise.all`
- Each call is independently gated by the approval system

---

## Custom Skills

### Creating a Custom Skill

1. Open Command Palette → **AtlasMind: Add Skill** → **Create from template**
2. A template file is scaffolded in `.atlasmind/skills/`
3. Edit the file to implement your skill logic
4. The skill scanner runs automatically before the skill is enabled

### Importing an Existing Skill

1. **AtlasMind: Add Skill** → **Import existing file**
2. Select a `.js` file
3. The file must export `module.exports.skill` or `module.exports.default` as a valid `SkillDefinition`

### LLM-Drafted Skills (Experimental)

When `atlasmind.experimentalSkillLearningEnabled` is `true`:
1. Ask `@atlas` to create a skill
2. The LLM generates a skill definition with code
3. The draft is saved to `.atlasmind/skills/` and must pass the security scanner before use

### Skill Security Scanner

Custom skills are scanned before enablement. The scanner has **12 built-in rules**:

**Error-level (blocks enablement):**

| Rule | What it catches |
|------|----------------|
| `no-eval` | `eval()` calls |
| `no-function-constructor` | `new Function()` |
| `no-child-process-require` | `require('child_process')` |
| `no-child-process-import` | `import` of `child_process` |
| `no-shell-exec` | `exec()`, `spawn()`, `execSync()` |
| `no-path-traversal` | `../` path patterns |
| `no-hardcoded-secret` | API keys, tokens, passwords in source |

**Warning-level (flagged but allowed):**

| Rule | What it catches |
|------|----------------|
| `no-process-env` | `process.env` access |
| `no-direct-fetch` | `fetch()`, `axios`, `got` calls |
| `no-http-require` | Node `http`/`https` module imports |
| `no-http-import` | ES module imports of `http`/`https` |
| `no-fs-direct` | `require('fs')` bypassing the context API |

Built-in skills are **pre-approved** at activation and skip the security scan.

### Managing Scanner Rules

Open Command Palette → **AtlasMind: Configure Scanner Rules** to:
- View all rules with descriptions
- Toggle rules on/off
- Add custom rules (regex pattern + severity)
- Reset to defaults

---

## MCP (Model Context Protocol) Skills

External tools from MCP servers appear as skills with the ID pattern `mcp:<serverId>:<toolName>`.

### Connecting an MCP Server

1. Open Command Palette → **AtlasMind: Manage MCP Servers**
2. Add a server:
   - **stdio** transport: `npx -y @modelcontextprotocol/server-filesystem /path/to/allowed`
   - **HTTP** transport: `https://my-mcp-server.example.com`
3. Tools from the server auto-register as skills
4. MCP skills are pre-approved (no security scan required)

### Per-Skill Control

- Individual MCP tools can be enabled/disabled in the Skills tree view
- MCP server connections persist across sessions

See [[Tool Execution]] for approval gating details.

# Agents & Skills

## Agents

### What is an Agent?

An agent is a specialised AI persona with a defined role, behaviour rules, model preferences, and skill set. The orchestrator selects the best agent for each task and builds a tailored context bundle.

### Agent Definition

```typescript
interface AgentDefinition {
  id: string;             // Unique identifier
  name: string;           // Display name
  role: string;           // Short role description
  description: string;    // Detailed description
  systemPrompt: string;   // System prompt injected into every request
  allowedModels?: string[]; // Model whitelist (empty = any)
  costLimitUsd?: number;  // Per-request cost cap
  skills: string[];       // Skill IDs this agent can use
}
```

### Built-in Fallback Agent

When no specialised agent matches a task, the orchestrator uses:

| Field | Value |
|---|---|
| id | `default` |
| name | `Default` |
| role | `general assistant` |
| systemPrompt | `You are a helpful coding assistant.` |
| skills | `[]` (access to all skills) |

### Agent Selection (current MVP)

The orchestrator currently selects the first registered agent, with fallback to the built-in default agent.

Planned expansions:
1. Task classification (coding, writing, debugging, architecture).
2. Agent role matching.
3. Agent availability (cost limit not exceeded).
4. User-specified agent preference (if any).

### Registering Agents

**Programmatically:**
```typescript
atlas.agentRegistry.register({
  id: 'architect',
  name: 'Architect',
  role: 'system design',
  description: 'Designs system architecture and makes structural decisions.',
  systemPrompt: 'You are a software architect...',
  skills: ['file-read', 'diagram-gen'],
});
```

**From SSOT (planned):**
Agent definitions in `project_memory/agents/*.md` will be auto-loaded.

---

## Skills

### What is a Skill?

A skill defines a capability that agents can use. Skills have typed parameters (JSON Schema) and a handler module that implements the logic.

### Skill Definition

```typescript
interface SkillDefinition {
  id: string;                          // Unique identifier
  name: string;                        // Display name
  description: string;                 // What the skill does
  parameters: Record<string, unknown>; // JSON Schema for input parameters
  execute: SkillHandler;               // Implementation function
  source?: string;                     // Absolute path (custom skills only)
  builtIn?: boolean;                   // True for extension-shipped skills
}

type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;
```

`SkillExecutionContext` provides workspace file I/O (`readFile`, `writeFile`, `findFiles`) and SSOT memory access (`queryMemory`, `upsertMemory`), all injected by `extension.ts` so skills remain independently testable.

### Skill Assignment

- An agent lists skill IDs in its `skills` array.
- If the array is empty, the agent has access to **all** registered and **enabled** skills.
- `SkillsRegistry.getSkillsForAgent(agent)` resolves available, enabled skills.

### Enable / Disable

Each skill can be individually enabled or disabled from the Skills tree view using the eye icon (⊙). The state persists across sessions via `globalState`. A skill with a failed security scan cannot be enabled until the issues are resolved and the skill re-scanned.

### Security Scanning

Every custom skill must pass a security scan before it can be enabled. The scanner checks source text line-by-line against 12 built-in rules:

| Rule | Severity | What it catches |
|---|---|---|
| `no-eval` | error | `eval()` calls |
| `no-function-constructor` | error | `new Function()` |
| `no-child-process-require/import` | error | `require('child_process')` / `from 'child_process'` |
| `no-shell-exec` | error | `exec`, `spawn`, `execSync`, etc. |
| `no-path-traversal` | error | `../` path traversal |
| `no-hardcoded-secret` | error | API keys, tokens, passwords in source |
| `no-process-env` | warning | `process.env` access |
| `no-direct-fetch` | warning | `fetch()`, `axios`, `got` |
| `no-http-require/import` | warning | Node `http`/`https` module |
| `no-fs-direct` | warning | `require('fs')` bypassing context |

Error-level issues **block** enablement. Warning-level issues are flagged but do not block.

Built-in skills are pre-approved and auto-pass at activation.

### Scanner Rule Configurator

Open the scanner rules editor from the Skills panel title bar (gear icon) or via `atlasmind.openScannerRules`. Users can:

- Toggle individual rules on/off.
- Edit severity and message for built-in rules (patterns are read-only to preserve integrity).
- Add custom rules with their own id, pattern (regex), severity, and message.
- Delete custom rules.
- Reset built-in rules to factory defaults.

### Adding Custom Skills

From the Skills panel title bar click **+** (or run `AtlasMind: Add Skill`):

1. **Create template** — scaffolds a `.js` CommonJS skill file in `.atlasmind/skills/` and opens it for editing.
2. **Import .js skill** — opens a file picker; the selected file is scanned first and only imported if no errors are found. The skill starts **disabled** so you can review it before enabling.

Custom skills must export `module.exports.skill` (or `module.exports.default`) as a valid `SkillDefinition` object.

### Registering Skills

```typescript
atlas.skillsRegistry.register({
  id: 'file-read',
  name: 'Read File',
  description: 'Read the contents of a file in the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path' },
    },
    required: ['path'],
  },
  execute: async (params, context) => context.readFile(params.path as string),
});
```

### Built-in Skills

The following skills are registered automatically at extension activation (`src/skills/`):

| Skill | Status | Description |
|---|---|---|
| `file-read` | ✅ Implemented | Read file contents |
| `file-write` | ✅ Implemented | Write/create files (workspace-restricted) |
| `file-search` | ✅ Implemented | Search workspace files by glob pattern |
| `memory-query` | ✅ Implemented | Search the SSOT |
| `memory-write` | ✅ Implemented | Add/update SSOT entries |
| `terminal-run` | 🔲 Planned | Execute terminal commands |
| `git-diff` | 🔲 Planned | Show git diff |
| `git-patch` | 🔲 Planned | Apply a patch safely |
| `web-fetch` | 🔲 Planned | Fetch content from a URL |
| `diagram-gen` | 🔲 Planned | Generate Mermaid diagrams |

### MCP-Sourced Skills

AtlasMind can connect to any [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server and expose its tools as skills. Open **AtlasMind: Manage MCP Servers** to configure servers.

**Skill ID pattern**: `mcp:<serverId>:<toolName>`  
**Source field**: `mcp://<serverId>/<toolName>`

MCP skills are registered in `SkillsRegistry` when a server connects and automatically marked as scan-passed (external process; trust is delegated to the server operator by the user who explicitly configured the connection). They can be individually disabled from the Skills view.

**Transport options**:

| Transport | When to use | Config fields |
|---|---|---|
| `stdio` | Local subprocess (e.g. `npx -y @modelcontextprotocol/server-filesystem`) | `command`, `args`, `env` |
| `http` | Remote server (Streamable HTTP, SSE fallback auto-applied) | `url` |

**Security notes**:
- MCP tools execute in a separate process or remote service — they are not sandboxed within the extension.
- The URL field must use `http://` or `https://`; other schemes are rejected.
- Env vars for stdio servers are merged with the extension host environment; do not store secrets there — use the server's native secret management.

---

## Context Bundle

For each task, the orchestrator builds a context bundle containing:

1. **Agent system prompt** — from `AgentDefinition.systemPrompt`.
2. **Relevant memory slices** — from `MemoryManager.queryRelevant()`.
3. **Available skills** — from `SkillsRegistry.getSkillsForAgent()`.
4. **User message** — the original request.
5. **Conversation history** — from the chat context.

This bundle is sent to the selected model via the appropriate `ProviderAdapter`.

Current MVP behavior:
- The context bundle is actively built and sent through the orchestrator.
- Skills are resolved via `SkillsRegistry.getSkillsForAgent()`.
- Memory slices come from `MemoryManager.queryRelevant()`.
- When a provider adapter is missing, orchestration returns a safe error response instead of throwing.

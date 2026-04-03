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
  builtIn?: boolean;      // True for agents shipped with the extension (not deletable via UI)
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

The orchestrator now performs a lightweight relevance rank over enabled agents using request-token overlap against each agent's role, description, and skill IDs.

Selection behavior:
1. Disabled agents are excluded from consideration.
2. Remaining agents are scored by intent overlap (role > description > skills).
3. Highest score wins; ties break by agent name.
4. If no enabled registered agent exists, the built-in fallback agent is used.

### Registering Agents

**Via the Manage Agents panel:**

Open the command palette and run **AtlasMind: Manage Agents**. The panel supports:
- Creating a new agent (id auto-derived from name; all fields editable)
- Editing an existing user-created agent
- Enabling or disabling any registered agent (including built-ins)
- Deleting a user-created agent (with confirmation)
- Viewing built-in agents (read-only)

Agents created through the panel are persisted to `globalState` and restored on next activation. Disabled-agent state is also persisted and restored. The sidebar agents tree updates immediately.

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

## Ephemeral Sub-Agents (Project Execution)

When a `/project` command is executed, the orchestrator synthesises temporary `AgentDefinition` objects on the fly from each `SubTask.role` — these agents are never registered in the `AgentRegistry`. Supported roles and their system prompts:

| Role | Focus |
|---|---|
| `architect` | System design, scalable structure, patterns |
| `backend-engineer` | Server-side APIs, data layers |
| `frontend-engineer` | Responsive UIs, accessible components |
| `tester` | Test authoring, edge cases, coverage |
| `documentation-writer` | User and developer documentation |
| `devops` | CI/CD pipelines, deployment, infrastructure |
| `data-engineer` | Data models, pipelines, transformations |
| `security-reviewer` | OWASP issues, vulnerability mitigations |
| `general-assistant` | Catch-all for unrecognised roles |

Each sub-agent only receives the skill IDs listed in its `SubTask.skills` array plus the `depOutputs` context block prepended to its user message.

Project execution now runs a preflight preview in chat before orchestration starts:
- Atlas shows the decomposed task table and an estimated file-touch impact.
- If estimated impact exceeds the configured safety threshold, execution is paused until the user re-runs with `--approve`.
- Atlas snapshots the workspace and reports per-subtask changed-file deltas as subtasks complete, then emits a cumulative final summary at the end.
- Atlas records per-file attribution traces (which subtask titles touched which files) and persists a JSON run summary report in the configured report folder.
- When one or more subtasks fail, Atlas renders a post-run failure banner listing the failed subtask titles, the number of files already modified, and a *View Source Control* button for easy rollback.
- After completion, follow-up chips are outcome-driven: a run with failures surfaces *Retry the project* and *Diagnose failures*; a successful run with changed files surfaces *Add tests*; otherwise the default chips are shown.

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

`SkillExecutionContext` provides workspace file I/O (`readFile`, `writeFile`, `findFiles`), SSOT memory access (`queryMemory`, `upsertMemory`), and safe git-backed patch application (`applyGitPatch`), all injected by `extension.ts` so skills remain independently testable.

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
| `git-apply-patch` | ✅ Implemented | Validate/apply unified git patches inside the workspace repository |
| `terminal-run` | 🔲 Planned | Execute terminal commands |
| `git-diff` | 🔲 Planned | Show git diff |
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

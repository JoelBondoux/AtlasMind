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
}

type SkillHandler = (
  params: Record<string, unknown>,
  context: SkillExecutionContext,
) => Promise<string>;
```

`SkillExecutionContext` provides workspace file I/O (`readFile`, `writeFile`, `findFiles`) and SSOT memory access (`queryMemory`, `upsertMemory`), all injected by `extension.ts` so skills remain independently testable.

### Skill Assignment

- An agent lists skill IDs in its `skills` array.
- If the array is empty, the agent has access to **all** registered skills.
- `SkillsRegistry.getSkillsForAgent(agent)` resolves the available skills.

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

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

### Agent Selection (planned)

The orchestrator will select agents based on:
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
  id: string;                         // Unique identifier
  name: string;                       // Display name
  description: string;                // What the skill does
  toolSchema?: Record<string, unknown>; // JSON Schema for parameters
  handler: string;                    // Module path to handler function
}
```

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
  toolSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative file path' },
    },
    required: ['path'],
  },
  handler: 'skills/fileRead',
});
```

### Planned Built-in Skills

| Skill | Description |
|---|---|
| `file-read` | Read file contents |
| `file-write` | Write/create files |
| `file-search` | Search workspace files by pattern |
| `terminal-run` | Execute terminal commands |
| `git-diff` | Show git diff |
| `git-patch` | Apply a patch safely |
| `web-fetch` | Fetch content from a URL |
| `memory-query` | Search the SSOT |
| `memory-write` | Add/update SSOT entries |
| `diagram-gen` | Generate Mermaid diagrams |

---

## Context Bundle

For each task, the orchestrator builds a context bundle containing:

1. **Agent system prompt** — from `AgentDefinition.systemPrompt`.
2. **Relevant memory slices** — from `MemoryManager.queryRelevant()`.
3. **Available skills** — from `SkillsRegistry.getSkillsForAgent()`.
4. **User message** — the original request.
5. **Conversation history** — from the chat context.

This bundle is sent to the selected model via the appropriate `ProviderAdapter`.

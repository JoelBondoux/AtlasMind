# Agents

AtlasMind uses an agent-based architecture where specialised agents are selected by the orchestrator based on task relevance.

## How Agent Selection Works

1. All **enabled** agents are evaluated against the incoming request
2. Agents are scored by token overlap: role keywords, description, and skill names are matched against the user's message
3. The highest-scoring agent is selected
4. Ties break alphabetically by agent name
5. If no match is found, the **Default** agent handles the request

## Built-in Default Agent

| Field | Value |
|-------|-------|
| **ID** | `default` |
| **Name** | Default |
| **Role** | General assistant |
| **Description** | Fallback assistant for general development tasks |
| **System Prompt** | _You are AtlasMind, a helpful and safe coding assistant._ |
| **Skills** | `[]` (empty = access to all skills) |

The default agent has no `allowedModels` constraint and no cost limit, making it the universal fallback.

## Agent Definition

```typescript
interface AgentDefinition {
  id: string;               // Unique identifier
  name: string;             // Display name
  role: string;             // Short role description (used in selection scoring)
  description: string;      // Longer description (used in selection scoring)
  systemPrompt: string;     // Injected as system message for every LLM call
  allowedModels?: string[]; // Whitelist of model IDs (empty = any model)
  costLimitUsd?: number;    // Per-task cost ceiling
  skills: string[];         // Skill IDs this agent can use (empty = all)
  builtIn?: boolean;        // true for extension-provided agents
}
```

## Creating Custom Agents

### Via the Agent Manager Panel

1. Open Command Palette → **AtlasMind: Manage Agents**
2. Click **New Agent** at the top of the panel
3. Fill in the fields:
   - **Name** — e.g. "Security Reviewer"
   - **Role** — e.g. "security-reviewer"
   - **Description** — what the agent specialises in
   - **System Prompt** — detailed instructions for the LLM
   - **Allowed Models** — optionally restrict to specific models
   - **Cost Limit** — maximum USD per task
   - **Skills** — which skills this agent can invoke
4. Save — the agent is persisted across sessions in VS Code globalState

### Via the Models Sidebar

- Provider rows expose an assign action that adds that provider's discovered models to selected agents.
- Model rows expose an assign action that adds or removes a specific model from selected agents' explicit `allowedModels` whitelist.
- Built-in agent assignments made from the Models tree are persisted separately so they survive restarts while the built-in agents remain read-only in the Agent Manager panel.

### Via the Sidebar

Right-click in the **Agents** tree view to create, edit, enable/disable, or delete agents.

## Enable / Disable Agents

- Toggle an agent's enabled state via the sidebar tree view or the Agent Manager Panel
- Disabled agents are excluded from selection but remain registered
- The `default` agent cannot be disabled

Disabled agent IDs are persisted in globalState as `atlasmind.disabledAgentIds`.

## Operational Boundaries

- `AgentRegistry` manages agent definitions, enablement, and success or failure history.
- `SkillsRegistry` manages which skills are available to those agents.
- `Orchestrator` owns routing, execution, retries, and final task outcomes.
- `ProjectRunHistory` and tool webhooks provide reviewable runtime telemetry for autonomous runs.

That split is what lets AtlasMind grow the number of agents without collapsing agent management, execution, and logging into one service.

## Ephemeral Sub-Agents

When `/project` executes subtasks, the planner assigns a **role** to each subtask. The orchestrator creates a temporary agent with a specialised system prompt:

| Role | System Prompt Focus |
|------|-------------------|
| `architect` | System design, scalable structure, design patterns |
| `backend-engineer` | Server-side APIs, data layers, performance |
| `frontend-engineer` | Responsive UIs, components, accessibility |
| `tester` | Test authoring, edge cases, coverage |
| `documentation-writer` | User and developer documentation, clarity |
| `devops` | CI/CD, deployment, infrastructure as code |
| `data-engineer` | Data models, pipelines, transformations |
| `security-reviewer` | OWASP issues, threat modelling, mitigations |
| `general-assistant` | Fallback for unrecognised roles |

Ephemeral agents exist only for the duration of their subtask and are not persisted.

## Agent Context Bundle

When an agent handles a task, it receives:

1. **System prompt** — the agent's configured prompt
2. **Memory context** — relevant SSOT entries from `queryRelevant()`
3. **Available skills** — resolved from the agent's skill list
4. **User message** — the original request
5. **Session history** — bounded carry-forward from previous turns

## Best Practices

- **Be specific in the role field** — the orchestrator uses it for selection scoring
- **Use system prompts for behaviour** — e.g. "Always suggest tests" or "Prefer functional patterns"
- **Restrict skills when appropriate** — a "read-only reviewer" agent shouldn't have `file-write`
- **Set cost limits for expensive agents** — prevent runaway costs on premium models
- **Use `allowedModels`** — force a reasoning model for an architect agent, or a cheap model for a formatter
- **Use the Models tree for fast assignment** — provider rows are the quickest way to seed an agent with all models from one provider; model rows are the quickest way to pin a single model.

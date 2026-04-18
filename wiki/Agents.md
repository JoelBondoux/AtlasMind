# Agents

AtlasMind uses an agent-based architecture where specialised agents are selected by the orchestrator based on task relevance.

## How Agent Selection Works

1. All **enabled** agents are evaluated against the incoming request
2. Agents are scored by token overlap across role, description, system prompt, and explicit skill metadata
3. AtlasMind adds common development-intent boosts for debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release prompts
4. Concrete workspace bug reports add an extra investigation-ready boost so repo issues are less likely to route like passive support requests
5. The highest-scoring agent is selected
6. Ties break alphabetically by agent name
7. If no match is found, the **Default** agent handles the request

## Built-in Agents

AtlasMind now ships a compact developer-focused built-in set for freeform routing:

| **ID** | **Name** | **Focus** |
|-------|-------|-------|
| `default` | Default | Catch-all fallback for general development tasks |
| `workspace-debugger` | Workspace Debugger | Repo-local bugs, regressions, root-cause analysis |
| `frontend-engineer` | Frontend Engineer | UI, layout, webview, and interaction work |
| `backend-engineer` | Backend Engineer | APIs, orchestration logic, data flow, and integrations |
| `code-reviewer` | Code Reviewer | Review, verification, regression risk, and test gaps |
| `security-reviewer` | Security Reviewer | Security gaps, runtime boundaries, auth, secret handling, and test-backed security coverage |

## Built-in Default Agent

| Field | Value |
|-------|-------|
| **ID** | `default` |
| **Name** | Default |
| **Role** | General assistant |
| **Description** | Fallback assistant for general development tasks |
| **System Prompt** | Action-oriented AtlasMind prompt that treats repo bug reports and fix requests as workspace tasks, prefers repository investigation over support-style triage, and still preserves safe behavior |
| **Skills** | `[]` (all enabled skills are available to the default agent) |

The default agent has no `allowedModels` constraint and no cost limit, making it the universal fallback. It is also expected to work directly in the current workspace when tools would help, rather than answering like a passive support bot. When a freeform prompt looks like a concrete bug report or layout or behavior regression in the current repo, AtlasMind now injects an extra workspace-investigation hint before the model responds. For explicit fix, verification, troubleshooting, reproduction, and similar action-oriented requests, AtlasMind also injects an execution-bias hint that tells the model to use the available tools in the current turn rather than stopping at advisory prose. If the model still answers without tools while those hints are active, AtlasMind rejects that first pass once and re-prompts for a tool-backed turn. AtlasMind also injects an always-on workspace identity block built from the saved Atlas Personality Profile and a compact `project_soul.md` summary, so both the operator's preferences and the project's stated identity remain visible in every turn. Provider timeouts are also treated as hard failures rather than being retried repeatedly, which shortens the visible stuck-thinking window when a routed model stalls.

AtlasMind now also carries an immutable legality-and-human-respect baseline in routed agent prompts. The baseline requires compliance with applicable law, treats legally ambiguous or territory-specific requests as restricted unless only safe high-level guidance is possible, and forbids any help intended to harm, discredit, disparage, or lie about a person. This rule cannot be overridden by user prompts, workspace memory, or other lower-priority instructions.

The stock built-in specialists intentionally keep `skills: []`, which means they can use the same enabled skill pool as the default agent. Their specialization comes from routing metadata and system prompt differences rather than from narrower tool access.

For freeform code work, the built-in agents now also carry a shared tests-first delivery policy:
- The default agent applies a light TDD preference so general code changes favor the smallest relevant automated test first when the task is meaningfully testable, and it should create that minimal spec when the repo does not already have one.
- Workspace Debugger prefers reproducing testable regressions with a failing automated signal before implementation, creating the smallest missing regression test first when needed, and then reporting the failing-to-passing evidence.
- Frontend Engineer prefers the smallest relevant UI or interaction regression test before implementation when practical, but explicitly falls back to strong manual verification for primarily visual work.
- Backend Engineer prefers a red-green-refactor loop for testable behavior, contract, and regression changes, including creating the smallest missing contract or regression spec when coverage is absent.
- Code Reviewer treats missing regression coverage, missing failing-to-passing evidence, and weak verification as primary findings unless direct TDD was not practical, and it should frame the concrete follow-up as adding the smallest missing test or spec.
- Security Reviewer treats code, config, runtime boundaries, and security tests as the authoritative evidence layer, uses docs as context rather than sole proof, and treats mismatches between documentation and implementation as first-class findings.
- The default and security-focused built-in prompts now also treat URLs and endpoints as untrusted input: AtlasMind validates scheme and host intent, prefers HTTPS for external services, and pushes for a live health or reachability check before a link is presented as working.

When AtlasMind observes TDD state for a freeform task, the chat Thinking summary now shows a red-to-green status cue. Verified runs surface observed red-to-green evidence directly in chat, while blocked or missing states are called out visibly instead of being buried in verification prose.

Freeform execution also now emits lightweight live progress updates while a response is still running. In the dedicated chat surface, AtlasMind shows interim thinking-style notes such as agent selection, tool rounds, workspace-investigation retries, and escalation or anti-churn nudges before the final answer replaces those transient updates.

AtlasMind also reflects part of the routing trace back in the assistant footer. The Thinking summary now includes the selected agent, any detected routing hints, whether workspace-investigation bias was applied before execution, the completed turn's token and cost usage, and any observed red-to-green TDD status.

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

For code-changing `/project` work, AtlasMind appends a shared delivery policy to every ephemeral sub-agent prompt:
- Prefer tests first when the subtask changes behavior, fixes a bug, or introduces a new contract.
- Add or update the smallest relevant automated test before implementation when the task is meaningfully testable, creating the smallest missing regression test or spec if the repo does not already have one.
- Block non-test implementation writes until a failing relevant test signal has been observed, either from dependency context or in the current subtask.
- Aim for a red-green-refactor loop and report the verification evidence, tests touched, and remaining coverage gaps.
- If the work is not realistically testable, explain why and use the strongest direct verification available instead.

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

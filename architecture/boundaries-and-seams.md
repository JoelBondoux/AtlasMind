# Architecture Boundaries and Integration Seams

This document maps the explicit integration seams between AtlasMind's major components.
Each section names the two sides of a boundary, the contract that connects them, and the
security or correctness rules that govern the crossing.

---

## 1. VS Code Extension API Boundary

**Outer container.** The entire extension runs inside the VS Code extension host process.

| Side | Description |
|---|---|
| Inside | All AtlasMind TypeScript code |
| Outside | VS Code's stable extension API (`vscode.*` namespace) |

**Contract:** The VS Code Extension API. AtlasMind calls VS Code APIs for workspace
access (`vscode.workspace`), UI surfaces (`vscode.window`), secret storage
(`vscode.SecretStorage`), and commands (`vscode.commands`). VS Code calls into
AtlasMind via the `activate()` / `deactivate()` lifecycle hooks in `src/extension.ts`.

**Rules:**
- All provider API keys are stored exclusively in `vscode.SecretStorage`; never in
  `vscode.workspace.getConfiguration()` or any file on disk.
- AtlasMind must not assume VS Code APIs are available outside the extension host (the
  CLI host uses `src/runtime/core.ts` which stubs or omits VS Code-specific services).

---

## 2. Extension Host ↔ Webview Renderer

**The most critical intra-process seam.** Webview panels run in isolated sandboxed
renderer processes. They cannot call extension host code directly.

| Side | Description |
|---|---|
| Extension host | `src/views/*.ts` — panel controllers |
| Webview renderer | Inline HTML + script content generated inside each panel |

**Contract:** `postMessage` / `onDidReceiveMessage` with typed JSON message objects.

```typescript
// Extension host → webview
panel.webview.postMessage({ type: string; payload: unknown })

// Webview → extension host
panel.webview.onDidReceiveMessage((message: { type: string; payload: unknown }) => { ... })
```

**Rules:**
- Every message received by the extension host from a webview **must be validated**
  before mutating configuration, touching secrets, or invoking commands.
- All HTML written into webviews must pass through `escapeHtml()` from
  `src/views/webviewUtils.ts`.
- All `<script>` tags must be nonce-protected; inline event handlers (`onclick`, etc.)
  are forbidden.
- Webviews must not be given a `vscode.Uri` pointing outside the extension's own
  asset folder.

**Key files:** `src/views/chatPanel.ts`, `src/views/agentManagerPanel.ts`,
`src/views/modelProviderPanel.ts`, `src/views/settingsPanel.ts`, and others in
`src/views/`.

---

## 3. UI Layer ↔ Orchestrator

**The primary in-process action seam.** Chat participant, tree-view commands, and
webview panels all invoke the Orchestrator to execute tasks.

| Side | Description |
|---|---|
| Callers | `src/chat/participant.ts`, `src/views/*.ts`, CLI entry |
| Callee | `src/core/orchestrator.ts` — `Orchestrator` class |

**Contract:** Direct TypeScript method calls. Primary entry points:

```typescript
orchestrator.processTask(request: TaskRequest, onTextChunk?, onProgress?): Promise<TaskResult>
orchestrator.processProject(goal, constraints, onProgress?): Promise<ProjectResult>
orchestrator.processTaskMultiStep(request, onTextChunk?, onProgress?): Promise<TaskResult & { stepwiseResults }>
orchestrator.classify(userMessage, options?): Promise<ClassificationResult>
```

**Rules:**
- Callers may not bypass the Orchestrator to call providers, skills, or memory directly.
  All routing, security scanning, budget tracking, and approval gating run inside the
  Orchestrator.
- `TaskRequest.userMessage` and `TaskRequest.context` are treated as untrusted user
  input inside the Orchestrator. They are never executed as code or passed raw to
  critical security gates.
- The `AtlasMindContext` bundle (constructed in `activate()`) is the sole way to inject
  service references into the Orchestrator — constructor injection only, no singletons.

---

## 4. Orchestrator ↔ Provider Adapters

**The network boundary.** Provider adapters make outbound HTTPS calls to LLM provider
APIs.

| Side | Description |
|---|---|
| Caller | `src/core/orchestrator.ts` |
| Implementations | `src/providers/anthropic.ts`, `openai.ts`, `copilot.ts`, `local.ts`, etc. |

**Contract:** `ProviderAdapter` interface in `src/providers/adapter.ts`:

```typescript
interface ProviderAdapter {
  readonly providerId: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  streamComplete?(request: CompletionRequest, onTextChunk: (chunk: string) => void): Promise<CompletionResponse>;
  listModels(): Promise<string[]>;
  discoverModels?(): Promise<DiscoveredModel[]>;
  healthCheck(): Promise<boolean>;
}
```

**Rules:**
- The Orchestrator is not aware of provider-specific auth details. Each adapter
  retrieves its API key from `vscode.SecretStorage` independently.
- Transient errors (429, 5xx, network timeouts) are retried with exponential backoff
  before failing over to another provider.
- Billing errors (402, insufficient-credits messages) auto-disable the provider for the
  session and trigger an immediate failover search.
- All outbound URLs must be the provider's documented API endpoint; no user-controlled
  URL redirection is permitted.

**Key files:** `src/providers/adapter.ts`, `src/providers/registry.ts`,
`src/providers/index.ts`.

---

## 5. Orchestrator ↔ Skill Execution

**The tool-execution boundary.** Skills are callable units of workspace capability
(file I/O, git, terminal, search, etc.).

| Side | Description |
|---|---|
| Caller | `src/core/orchestrator.ts` — `runAgenticLoop()` |
| Callees | `SkillDefinition` objects registered in `src/core/skillsRegistry.ts` |

**Contract:** `SkillDefinition.execute()` in `src/types.ts`:

```typescript
interface SkillDefinition {
  id: string;
  execute(args: Record<string, unknown>, context: SkillExecutionContext): Promise<string>;
  parameters: JsonSchema;
  // ...
}
```

`SkillExecutionContext` is a narrow interface that gives skills access to:
`readFile`, `writeFile`, `findFiles`, `searchInFiles`, `listDirectory`,
`runCommand`, `getGitStatus`, `getGitDiff`, `applyGitPatch`, `queryMemory`,
`upsertMemory`, `rollbackLastCheckpoint` — and nothing else.

**Security gates** (applied in order before `execute()` is called):
1. **Schema validation** — arguments are validated against `skill.parameters` via
   `validateToolArguments()`.
2. **Tool approval gate** — `OrchestratorHooks.toolApprovalGate` may deny any call.
3. **TDD gate** — blocks implementation writes until a failing test signal is observed
   when `projectTddPolicy.mode === 'implementation'`.
4. **Write checkpoint** — `writeCheckpointHook` is called before any write-capable
   tool (`file-write`, `file-edit`, `git-apply-patch`) so a rollback snapshot exists.
5. **Security scan** — auto-synthesized skills are scanned by `src/core/skillScanner.ts`
   before registration; skills with scan errors are rejected outright and skills with
   warnings require `generatedSkillApprovalGate` approval.

**Key files:** `src/types.ts` (`SkillExecutionContext`, `SkillDefinition`),
`src/core/skillsRegistry.ts`, `src/core/skillScanner.ts`, `src/core/skillDrafting.ts`.

---

## 6. Orchestrator ↔ Memory System

**The SSOT retrieval boundary.** The Orchestrator queries memory for relevant project
context; memory entries enter model prompts as supplemental context.

| Side | Description |
|---|---|
| Caller | `src/core/orchestrator.ts` |
| Callee | `src/memory/memoryManager.ts` — `MemoryManager` |

**Contract:** The Orchestrator accesses `MemoryManager` through a narrow structural
type (`MemoryQueryStore`) rather than the full class:

```typescript
type MemoryQueryStore = Pick<MemoryManager,
  'queryRelevant' | 'getWarnedEntries' | 'getBlockedEntries' | 'redactSnippet' | 'upsert'
>;
```

**Security rules:**
- `MemoryManager` runs each loaded entry through `src/memory/memoryScanner.ts` before
  returning it. Entries that fail the scan are blocked; entries with warnings are
  flagged with a security notice injected into the system prompt.
- `redactSnippet()` strips credential-shaped patterns from snippet text before it
  reaches model context.
- Memory files live under `project_memory/` inside the workspace. Path traversal
  outside the SSOT root is rejected.
- Model-extracted content (e.g., decisions, architectural notes) is stored back via
  `upsert()` and re-scanned on load.

**Key files:** `src/memory/memoryManager.ts`, `src/memory/memoryScanner.ts`,
`src/types.ts` (`MemoryEntry`, `SSOT_FOLDERS`).

---

## 7. Extension ↔ VS Code SecretStorage

**The credential boundary.** Provider API keys, tokens, and other secrets never appear
in workspace settings, source files, or memory entries.

| Side | Description |
|---|---|
| Provider adapters | Read keys via `context.secrets.get(key)` |
| VS Code | `vscode.ExtensionContext.secrets` — OS-backed encrypted store |

**Rules:**
- API keys are written only through `context.secrets.store(key, value)` in
  `src/views/modelProviderPanel.ts` (and equivalents). They are never logged, emitted
  via webhook, or included in `TaskResult`.
- Memory scanner pattern rules explicitly flag common credential shapes
  (`api_key`, `bearer`, `token`, `password`) to prevent accidental SSOT leakage.
- Settings visible in `vscode.workspace.getConfiguration('atlasmind')` must never
  contain secrets; the UI uses masked input fields that post the value to the extension
  host for `secrets.store()`, not `config.update()`.

---

## 8. AtlasMind ↔ MCP Servers

**The external tool protocol boundary.** MCP (Model Context Protocol) servers run as
separate processes. AtlasMind bridges their tools into the skill system.

| Side | Description |
|---|---|
| AtlasMind | `src/mcp/mcpServerRegistry.ts`, `src/mcp/mcpClient.ts` |
| MCP servers | External processes communicating over stdio or HTTP Streamable transport |

**Contract:** MCP SDK JSON-RPC protocol. `McpClient` wraps the SDK connection;
`McpServerRegistry` surfaces each discovered MCP tool as a `SkillDefinition` object
in the `SkillsRegistry`. Once bridged, MCP tools follow the same execution path as
built-in skills — subject to the same approval gate, argument validation, and
write-checkpoint rules described in §5.

**Rules:**
- MCP server configs (name, command, args, env) are persisted in VS Code `globalState`,
  not `SecretStorage`. Sensitive env vars in MCP configs should be reviewed by the
  operator — AtlasMind does not audit MCP server source code.
- Tool results returned by MCP servers are treated as untrusted external data before
  being appended to model context.

**Key files:** `src/mcp/mcpClient.ts`, `src/mcp/mcpServerRegistry.ts`.

---

## Summary Table

| Seam | Protocol | Security gate |
|---|---|---|
| VS Code Extension API | vscode.* namespace | SecretStorage for all credentials |
| Extension Host ↔ Webview | postMessage / JSON | Nonce CSP; message validation; escapeHtml |
| UI Layer ↔ Orchestrator | Direct method call | Input treated as untrusted; budget/cost gating |
| Orchestrator ↔ Providers | ProviderAdapter interface | Auth in SecretStorage; transient retry; billing auto-disable |
| Orchestrator ↔ Skills | SkillDefinition.execute() | Schema validation; approval gate; TDD gate; write checkpoint; security scan |
| Orchestrator ↔ Memory | MemoryQueryStore (narrow Pick) | MemoryScanner; redactSnippet; path-traversal rejection |
| Extension ↔ SecretStorage | vscode.ExtensionContext.secrets | OS-backed; never in config or disk files |
| AtlasMind ↔ MCP Servers | MCP SDK JSON-RPC | Same skill execution gates; tool results are untrusted |

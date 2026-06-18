
> **Note:** The `project_memory/` folder is only present in development and feature branches. It is excluded from the `master` branch and all release builds. This is enforced by `.gitignore` and documented in the contribution guidelines.

# Tool Execution & Safety

AtlasMind provides tiered safety controls for all tool (skill) execution, from read-only operations to destructive external commands.

Before any approval-mode or tool-risk decision is considered, AtlasMind applies an immutable legality-and-human-respect baseline: operator consent never authorizes illegal activity, legal evasion, targeted harassment, defamation, or deceptive attacks on a person.

## Tool Risk Classification

Every skill is classified by its risk category:

| Category | Risk Level | Examples |
|----------|-----------|---------|
| `read` | Low | `file-read`, `file-search`, `directory-list`, `text-search`, `memory-query`, `diagnostics`, `code-symbols`, `git-status`, `git-diff`, `git-log` |
| `workspace-write` | Medium | `file-write`, `file-edit`, `file-delete`, `file-move`, `git-apply-patch`, `memory-write`, `memory-delete` |
| `git-read` | Low | `git-status`, `git-diff`, `git-log`, `git-branch` (list) |
| `git-write` | High | `git-commit`, `git-branch` (create/delete) |
| `terminal-read` | Low | Read-only terminal commands |
| `terminal-write` | High | Install commands, build scripts, commits |
| `network` | Medium | `web-fetch` |
| `audio-input` | Low | STT microphone capture |
| `audio-output` | Low | TTS playback |

### Unknown Tool Classification

For dynamically registered tools whose category is not explicitly declared, AtlasMind applies **name-based heuristic classification** rather than defaulting to the highest risk level:

- Tools whose names start with a read-like prefix (`get`, `list`, `read`, `search`, `find`, `query`, `fetch`, `check`, `show`, `view`, `inspect`, `describe`, `status`, `info`, `lookup`, `count`) are classified as `read/low`.
- If the name also contains a write-like substring (`write`, `create`, `update`, `delete`, `execute`, `run`, `insert`, `remove`, `patch`, `add`, `set`, `push`, `commit`, `deploy`, `send`, `publish`, `upload`, `import`, `export`, `reset`, `clear`, `purge`, `migrate`, `install`) the read classification is overridden to `network/high`.
- Names that match neither pattern default to `network/high` (conservative fallback).

This prevents MCP-backed inspection tools from triggering approval prompts that would be required for network-risk tools.

---

## Approval Modes

The `atlasmind.toolApprovalMode` setting controls when AtlasMind asks for confirmation:

| Mode | Behaviour |
|------|-----------|
| **`always-ask`** | Every tool call requires explicit approval |
| **`ask-on-write`** | Read-only tools auto-approved; write/delete/external tools require approval *(default)* |
| **`ask-on-external`** | Read + workspace writes auto-approved; terminal/network/git-write require approval |
| **`allow-safe-readonly`** | Only high-risk operations require approval |

### Approval Flow

1. Tool call is requested by the LLM
2. Risk classification is computed from the skill's category
3. Approval mode is checked against the risk level
4. If approval is needed, AtlasMind brings the current Atlas chat surface into focus and renders an approval card in a dedicated warning stack below the transcript and above the composer with:
   - Tool name and parameters
   - Risk category and level
   - Impact summary
5. User can choose one of three execution paths:
  - `Allow Once` — permit only the current tool call
  - `Bypass Approvals` — skip approval prompts for the rest of the current task
  - `Autopilot` — skip approval prompts for the rest of the current session
6. `Deny` rejects the tool call without leaving the chat surface

Autopilot can also be toggled explicitly with `AtlasMind: Toggle Autopilot`. When it is on, AtlasMind exposes a status bar item so the current session bypass state stays visible. Internally, listener failures are isolated so one broken UI subscriber cannot prevent the rest of the session-bypass state from updating.

### Approvals over remote control

When a session is driven by the AtlasMind web build (see [[Remote Control]]), the same approval cards and decision paths apply through the shared chat protocol — a remote peer can never auto-approve a `workspace-write`, `git-write`, `terminal-write`, or `network` tool without an explicit, authenticated decision. Remote approval decisions are audited. If the remote client disconnects, the bound chat surface is disposed and any in-flight execution is aborted, so **pending approvals default to denied** rather than proceeding unattended.

Destructive memory-administration actions are kept outside the normal tool pipeline. The Settings-based project-memory purge flow always requires an explicit modal confirmation plus a typed `PURGE MEMORY` phrase before AtlasMind deletes the SSOT root and recreates the scaffold.

Warning-level auto-generated skills now follow a separate one-time review gate before AtlasMind evaluates them in-process. If the skill scanner flags softer concerns such as direct environment access, direct filesystem access, or direct outbound fetches, AtlasMind posts a dedicated approval card into the same in-chat warning stack used for tool approvals. The operator can `Allow Once` or `Keep Blocked`; if the draft is denied, it stays paused so the request can be narrowed, discussed, or evolved into a safer alternative instead of executing silently.

The CLI host runs behind a separate approval gate. In CLI mode AtlasMind allows read-only tools by default, blocks external high-risk tools, and requires an explicit `--allow-writes` flag before workspace or git writes are permitted. CLI filesystem operations also resolve canonical real paths before the workspace-boundary check, which prevents symlink escapes from bypassing the sandbox.

CLI argument handling is explicit: malformed flags, missing option values, invalid provider IDs, invalid budget or speed modes, and malformed daily-budget values are rejected as CLI errors instead of silently changing prompt content.

For implementation-mode work, AtlasMind now applies the same red-green discipline to risky external execution that it already applies to non-test implementation writes. Before a failing relevant test signal exists, AtlasMind blocks:
- non-test workspace edits
- git writes
- `terminal-write` commands such as package installation or mutating build scripts
- tools classified as `network` or otherwise external/high-risk

This keeps an injected or over-permissive model reply from jumping straight to third-party software or external side effects before there is a concrete regression signal to anchor the change.

For URL-bearing tasks, AtlasMind also injects a default safety rule into routed prompts: URLs and endpoints are treated as untrusted input, should be validated for scheme and host safety, and should be checked for live health or reachability with the bounded network tools before Atlas presents them as working.

---

## Terminal Allow-List

The `terminal-run` skill enforces a **curated allow-list** of ~40 safe commands:

### Always Allowed (read-only)
```
ls, dir, cat, head, tail, wc, find, grep, which, where, whoami,
echo, pwd, env, printenv, date, hostname, uname, file, stat,
du, df, tree
```

### Allowed After Approval (write-capable)
When `atlasmind.allowTerminalWrite` is `true`:
```
npm, npx, yarn, pnpm, pip, pip3, python, python3, node, cargo,
go, dotnet, make, cmake, mvn, gradle
```

### Always Blocked
- `rm -rf`, `sudo`, `chmod`, `chown`, `mkfs`, `dd`, `kill`, `shutdown`, `reboot`
- Shell operators: `|`, `&&`, `||`, `;`, `` ` ``, `$()` (no shell interpolation)
- Any command not on the allow-list

Commands are executed via `child_process.execFile()` (not `exec()`) to prevent shell injection.

AtlasMind now also exposes a dedicated `docker-cli` skill for container work. It does not allow arbitrary Docker passthrough. Instead, it only permits a curated subset of `docker` and `docker compose` commands:

- Read-only: `docker version`, `docker info`, `docker ps`, `docker images`, `docker inspect`, `docker logs`, `docker compose ps`, `docker compose config`, `docker compose logs`
- Lifecycle: `docker start|stop|restart` and `docker compose up|down|build|pull|start|stop|restart`

Read-only Docker inspection is classified as `terminal-read`. Container lifecycle actions are classified as `terminal-write` and follow the same approval path as other high-risk external execution.

---

## Tool Call Limits

- **Max 8 tool calls per turn** — prevents runaway loops
- Multiple tool calls in the same turn execute concurrently via `Promise.all`
- Each call is independently gated by the approval system
- Task-scoped bypass decisions are keyed to the active orchestrator task ID so they do not silently leak into unrelated runs
- Tool timeouts: default 15s, `web-fetch` 30s, `test-run` 120s

---

## Pre-Write Checkpoints

Before any write-capable tool executes:

1. `CheckpointManager` captures snapshots of files that will be modified
2. Snapshots are stored in memory (not on disk)
3. If something goes wrong, `rollback-checkpoint` restores the pre-write state
4. Checkpoints are cleared after successful verification

---

## TDD Gate Scope

AtlasMind's red-to-green TDD gate is intended for implementation work that changes product behavior or code paths.

- The gate still blocks non-test implementation writes until Atlas has seen a relevant failing test signal.
- Repo-maintenance actions such as resolving Dependabot updates, merging or rebasing branches, and similar dependency-update workflows are treated separately and are not blocked by that gate.
- Ambiguous follow-up prompts such as `resolve these` are no longer treated as implementation work unless the request itself names a concrete code or behavior target.
- Terse follow-up prompts such as `handle that`, `take care of it`, or `can you do that for me` can still trigger tool-backed execution when recent session context clearly identifies the workspace or repo task they refer to.

### Testing-strategy writers

Two testing-strategy actions write to the workspace under a non-destructive contract. The **framework scaffolder** (`scaffoldTestingFramework`) creates starter config/test files only when absent, never overwrites, never mutates `package.json`, and is modal-confirmed. The **outbound protocol sync** (`syncTestingProtocols`) only replaces its own delimited managed block in instruction files that already exist, preserving surrounding content and routing every path through the shared traversal guard. Neither requires the per-tool approval gate because they cannot overwrite arbitrary content, but both are surfaced explicitly in the UI before running.

---

## Post-Write Verification

When `atlasmind.autoVerifyAfterWrite` is `true` (default):

1. After `file-write`, `file-edit`, or `git-apply-patch` succeeds
2. The configured verification scripts run (default: `test`)
3. Scripts are executed as `npm run <script>` without shell interpolation
4. Timeout: `atlasmind.autoVerifyTimeoutMs` (default: 120s)
5. Results are reported back to the LLM for self-correction

If verification fails, the LLM sees the error output and can attempt a fix in the same turn.

Post-write verification is not the first line of defense. AtlasMind now tries to establish the failing signal before risky implementation actions, then uses post-write verification to confirm the green side of the loop.

---

## Webhooks

When `atlasmind.toolWebhookEnabled` is `true`, tool lifecycle events are sent to an external HTTPS endpoint:

### Events

| Event | When |
|-------|------|
| `tool.started` | Tool execution begins |
| `tool.completed` | Tool execution succeeds |
| `tool.failed` | Tool execution fails or times out |
| `tool.test` | Manual test from the webhook panel |

### Payload

```json
{
  "event": "tool.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "tool": {
    "id": "file-write",
    "name": "File Write",
    "parameters": { "path": "src/auth.ts", "content": "..." }
  },
  "result": {
    "success": true,
    "output": "File written successfully"
  },
  "session": {
    "agent": "default",
    "model": "claude-4-sonnet-20250514"
  }
}
```

### Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `atlasmind.toolWebhookEnabled` | `false` | Enable webhook delivery |
| `atlasmind.toolWebhookUrl` | `""` | HTTPS endpoint URL |
| `atlasmind.toolWebhookTimeoutMs` | `5000` | Request timeout |
| `atlasmind.toolWebhookEvents` | `["tool.started", "tool.completed", "tool.failed"]` | Events to emit |

### Security

- Only HTTPS endpoints are accepted
- Payloads are sent via POST with `Content-Type: application/json`
- Tool parameters in payloads are redacted for sensitive fields (API keys, secrets)
- Webhook failures are logged but never block tool execution
- Webhooks are the current integration path for external auditing or alerting; AtlasMind does not yet ship its own hosted monitoring backend.

---

## MCP Tool Execution

Tools from connected MCP servers follow the same approval and safety pipeline:

1. MCP tools are registered as skills with `mcp:<serverId>:<toolName>` IDs
2. All approval modes apply
3. All webhook events apply
4. Timeouts are enforced
5. MCP tools are pre-approved (skip the skill security scanner)

See [[Skills]] for MCP server setup.

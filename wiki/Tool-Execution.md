# Tool Execution & Safety

AtlasMind provides tiered safety controls for all tool (skill) execution, from read-only operations to destructive external commands.

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
4. If approval is needed, the user sees a confirmation prompt with:
   - Tool name and parameters
   - Risk category and level
   - Impact summary
5. User can choose one of three execution paths:
  - `Allow Once` — permit only the current tool call
  - `Bypass Approvals` — skip approval prompts for the rest of the current task
  - `Autopilot` — skip approval prompts for the rest of the current session
6. Cancel denies the tool call

Autopilot can also be toggled explicitly with `AtlasMind: Toggle Autopilot`. When it is on, AtlasMind exposes a status bar item so the current session bypass state stays visible. Internally, listener failures are isolated so one broken UI subscriber cannot prevent the rest of the session-bypass state from updating.

Destructive memory-administration actions are kept outside the normal tool pipeline. The Settings-based project-memory purge flow always requires an explicit modal confirmation plus a typed `PURGE MEMORY` phrase before AtlasMind deletes the SSOT root and recreates the scaffold.

The CLI host runs behind a separate approval gate. In CLI mode AtlasMind allows read-only tools by default, blocks external high-risk tools, and requires an explicit `--allow-writes` flag before workspace or git writes are permitted. CLI filesystem operations also resolve canonical real paths before the workspace-boundary check, which prevents symlink escapes from bypassing the sandbox.

CLI argument handling is explicit: malformed flags, missing option values, invalid provider IDs, invalid budget or speed modes, and malformed daily-budget values are rejected as CLI errors instead of silently changing prompt content.

For implementation-mode work, AtlasMind now applies the same red-green discipline to risky external execution that it already applies to non-test implementation writes. Before a failing relevant test signal exists, AtlasMind blocks:
- non-test workspace edits
- git writes
- `terminal-write` commands such as package installation or mutating build scripts
- tools classified as `network` or otherwise external/high-risk

This keeps an injected or over-permissive model reply from jumping straight to third-party software or external side effects before there is a concrete regression signal to anchor the change.

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

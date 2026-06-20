
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

### Mission Loop checkpoints

The autonomous **Mission Loop** (`/loop` and Mission Control — see [[Project Planner]]) runs across multiple iterations within a closed budget. On top of the per-tool approval modes above, it adds an **iteration-level approval checkpoint**:

- A checkpoint fires at configured triggers — every N iterations, the first time cumulative spend crosses a budget fraction, or before any write/commit batch (`atlasmind.loop.*`).
- Checkpoints (and recoverable-block prompts) are **deny-by-default** and render as in-surface buttons, never an OS modal where avoidable: in the **chat panel** as a decision card at the base of the bubble (resolved via a `resolveLoopDecision` message); in **Mission Control** as a unified in-panel decision card with dynamic buttons; and in the `@atlas` chat *view* (which can't host in-line blocking buttons) as a modal fallback. If the prompt is dismissed, the hook is absent, or it throws — or the run is stopped/disposed — it resolves as **denied/stop** and the loop halts safely rather than proceeding unattended.
- Checkpoints are *in addition to* (never a replacement for) the per-tool approval gates: a write/terminal/git tool inside an approved iteration still hits its normal approval card.
- The loop never bypasses guarded delivery — a goal implying a staging/production deployment is surfaced as a checkpoint/`blocked` and routed through the guarded promotion pipeline (see [[Delivery]]), never executed directly. AtlasMind never force-pushes.
- **Recoverable setting blocks are queried, not silently cancelled.** If the loop can't make verifiable progress because a relaxable setting is in the way (e.g. tests can't run because `atlasmind.allowTerminalWrite` is off), it asks before stopping: **Override for this run** (relaxes the setting for this mission only, then reverts when the run ends), **Open settings** (deep-link), or **Stop**. Deny-by-default — dismissing the prompt stops the run. After one override the loop won't re-prompt for the same setting.

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

## Resource discovery is pre-invocation, not execution

[[Resource Discovery]] (ARD) deliberately sits *before* the tool-execution path: it only locates resources. The read-only `discover-resources` skill classifies as a network read and never installs anything. Acting on a result is a separate, explicit step — installing a discovered MCP server adds it to the MCP Servers panel **disabled**, so connecting it still passes through the normal MCP trust gate before any of its tools can run. Agent Finders ship disabled, so no outbound discovery occurs until the user opts in.

## Tool Call Limits

- **Max 8 tool calls per turn** — prevents runaway loops
- **Agentic loop cap** (`maxToolIterations`, default 10) — caps tool-call rounds per turn
- Multiple tool calls in the same turn execute concurrently via `Promise.all`
- Each call is independently gated by the approval system
- Task-scoped bypass decisions are keyed to the active orchestrator task ID so they do not silently leak into unrelated runs
- Tool timeouts: default 15s, `web-fetch` 30s, `test-run` 120s

### Hitting the cap

When a turn reaches `maxToolIterations` (or the per-turn tool-call limit) without producing a final answer, AtlasMind **stops and asks** rather than failing silently:

- **Single-turn chat** surfaces *Raise to N (permanent)* / *Raise to N (this task)* buttons; choosing one updates `maxToolIterations` (workspace setting for permanent, in-memory for this task only) and resumes from the original prompt.
- **Autonomous `/project` subtasks** report a `needs-input` pause (a distinct state from `failed`) carrying the suggested higher limit. The project report renders a *"⏸️ Paused — tool-iteration limit reached"* section with a button to open the `atlasmind.maxToolIterations` setting and the choices to raise permanently and re-run, raise once and re-run, or skip. See [[Project-Planner]].

---

## Data Privacy: gated tool reads

When a project [Data Privacy](Security#data-privacy-confidential-data-is-gated-to-trusted-models) policy is enabled, tool results are filtered before they re-enter the model loop, keyed on the **running** model:

- A `file-read` (or similar) whose target path matches a confidential `path` rule is **withheld** from an un-trusted model — the result is replaced with a notice pointing to the Project Dashboard → Privacy page.
- Other tool output is scanned for classified terms / regulated data and redacted span-by-span (`[CONFIDENTIAL]`).

Trusted models receive tool results unchanged. This closes the mid-task leak vector where a confidential file is read after routing has already chosen a model.

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

### Success claims are gated against verification

A response cannot report success while its own verification run failed. When an answer claims the work is done/"moving forward" but the post-edit verification reports a structured failure (`FAIL:`, a non-zero `exit N`, `N failed`, `✗`), AtlasMind:

1. Injects **one** reconcile reprompt asking the model to either make verification pass or state plainly that the task is **not complete**; and
2. If the response still claims success, appends a **deterministic caveat** (not authored by the model) that cites the failing line and marks the task not complete.

Detection is conservative: it keys only on structured failure markers, is overridden by `PASS:` / `0 failed` / "no failures" (so a test merely *named* "…fails when…" is not misread), and never fires when the response already acknowledges the failure.

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

## Promotion Execution (Delivery)

Promoting a build between deployment stages on the Project Dashboard → **Delivery** page (`PromotionRunner`) is a high-trust action and carries its own guardrails on top of the tool pipeline:

1. **Inspect before run.** Clicking **Promote ▸** (or **Runbook**) opens a dialog showing the full assembled plan — *preflight gate → backup → deploy → verify → record* — with every command spelled out, so nothing runs unseen.
2. **Preflight gate.** Checks AtlasMind can evaluate (version bump, changelog entry, clean working tree) are computed automatically. **Required CI status checks are verified live** via `gh` (the source branch's head check-runs) — a failing *or still-pending* check blocks the run; when `gh` is unavailable they fall back to manual attestation. Any other named check is manually attested. A failing automatic check blocks the run.
   - Every promotion **and rollback** is appended to an audit log (`project_memory/operations/delivery-history.json`) with the git actor; a stage's **Roll back** action runs its user-authored rollback command after the same authorization (protected ⇒ type the stage name).
   - **Single-flight lock:** only one promotion or rollback runs at a time (a workspace lock, auto-clearing after 60 min).
   - **Trigger-CD:** a stage may deploy by dispatching a CD workflow (`gh workflow run`) instead of running commands locally.
   - **Backup verified, migrations guarded:** an optional verify-backup command must pass after the backup; a migrate command runs inside the sequence.
   - **Separation of duties:** a stage may require the promoter to differ from the change's author (checked via git identity).
3. **Deny-by-default backup.** A target whose backup is *required* but has no backup command cannot be promoted to at all — the run is hard-blocked until a command is added in the stage editor.
4. **Approval & protected confirmation.** When the target requires approval, an explicit approval checkbox is mandatory; when the target is **protected**, the operator must type the target's name to confirm.
5. **Commands are server-sourced.** Every executed command (backup, deploy/migration routine steps, rollback hint) is read from the persisted, user-authored stage config and routine files. The webview can only *trigger* and *attest* — it can never supply a command string.
6. **Non-destructive bias.** AtlasMind never force-pushes; the deploy body is the user's own routine; the gate is re-evaluated against live git state at execution time; and each run records its outcome plus a rollback handle.

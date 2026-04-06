# Security

AtlasMind is designed with a **safety-first** principle: the extension defaults to the safest reasonable behaviour, not the most permissive.

## Security Boundaries

### 1. Credential Storage

- API keys are stored exclusively in VS Code's **SecretStorage**
- Keys are **never** written to settings, SSOT memory, source files, or logs
- The `MemoryScanner` blocks writes containing API keys, tokens, or passwords
- Webview messages carrying secrets are validated server-side before storage

### 2. File System Sandbox

- All file operations are scoped to the **workspace root**
- Path traversal attempts (e.g. `../../etc/passwd`) are detected and rejected
- The `SkillExecutionContext` enforces sandbox boundaries for `writeFile()`, `deleteFile()`, and `moveFile()`
- Default behaviour is **non-destructive**: prefer creation over overwrite, warn before deletion

### 3. Webview Security

- All webview panels use a strict **Content Security Policy (CSP)**
- Scripts are protected with **cryptographic nonces** — no inline event handlers
- All user-provided content is escaped via `escapeHtml()` from `webviewUtils.ts`
- Webview messages are **validated** before they can mutate configuration, touch secrets, or invoke commands
- Destructive webview-triggered actions such as project-memory purge require extension-side confirmation and a typed confirmation phrase before any filesystem deletion occurs

### 4. Memory Scanner

The `MemoryScanner` validates content before writes to SSOT. It blocks:

| Threat | Detection |
|--------|-----------|
| **Credential leakage** | Regex patterns for API keys, tokens, passwords, connection strings |
| **Prompt injection** | Attempts to override system prompts or inject hidden instructions |
| **Code injection** | Executable code blocks (shell scripts, PowerShell) |
| **Data exfiltration** | Large base64 blobs and suspicious URL patterns |

See [[Memory System]] for the full scanner rule list.

The same scanner patterns are now reused for transient freeform-chat context before it reaches the model. Recent session carry-forward, native chat history summaries, and text attachments are treated as untrusted. If those sources contain blocked prompt-injection patterns, AtlasMind excludes them from model context entirely. If they only trigger warning-level patterns, AtlasMind includes a redacted excerpt and marks it as untrusted data.

### 5. Terminal Allow-List

- Only ~40 pre-approved commands are allowed via `terminal-run`
- Commands execute via `child_process.execFile()` — **no shell interpolation**
- Shell operators (`|`, `&&`, `||`, `;`, `` ` ``, `$()`) are blocked
- Write-capable commands (npm install, etc.) require explicit opt-in via `allowTerminalWrite`

### 6. Tool Approval Gate

- **Default mode:** `ask-on-write` — read-only operations auto-approved, writes require consent
- Four configurable approval modes from strictest to most permissive
- Interactive approval prompts distinguish one-off approval from task-scoped bypass and session-wide autopilot so users can deliberately widen execution scope instead of repeatedly clicking through the same tool sequence
- Session-wide autopilot remains explicitly visible through a status bar indicator and can be disabled via `AtlasMind: Toggle Autopilot`.
- Autopilot state notifications isolate listener failures so one faulty subscriber cannot suppress updates to the rest of the UI.
- The CLI host uses a separate runtime approval gate: it allows read-only tooling by default, blocks external high-risk tools, and requires `--allow-writes` before workspace or git writes are permitted.
- CLI workspace-boundary enforcement canonicalizes real filesystem paths before access is granted, so symlinked paths cannot escape the workspace sandbox.
- For implementation work, AtlasMind also requires a failing relevant test signal before it will perform non-test writes or risky external execution such as terminal-write, git-write, or network-classified tool calls.
- Max **8 tool calls per turn** prevents runaway execution
- **Pre-write checkpoints** allow rollback if something goes wrong
- **Post-write verification** (tests/lint) catches regressions immediately
- Destructive SSOT reset actions are kept behind a separate double-confirmation workflow even though they are initiated from the Settings webview

### 6a. Auditability And Review

- `ProjectRunHistory` persists preview, running, completed, and failed autonomous-run records so operators can review what happened after reload.
- `ToolWebhookDispatcher` is the current hook for centralized auditing or alerting; AtlasMind itself does not yet ship a hosted alerting backend.
- Tool parameters in webhook payloads are redacted for sensitive fields before they leave the extension host.

### 7. Skill Security Scanner

Custom skills are statically scanned before enablement:

- **7 error-level rules** (block enablement): `eval()`, `new Function()`, `child_process`, `exec/spawn`, path traversal, hardcoded secrets
- **5 warning-level rules** (flagged): `process.env`, direct `fetch`, `http`/`https` modules, direct `fs` usage
- Built-in skills are **pre-approved** and skip scanning
- MCP tools are **pre-approved** (trust is delegated to the MCP server)

### 8. Network Safety

- `web-fetch` blocks **SSRF**: localhost, private IPs (10.x, 172.16-31.x, 192.168.x), link-local, and cloud metadata endpoints (169.254.169.254)
- Webhook URLs must use **HTTPS** only
- Sensitive fields in webhook payloads are **redacted**
- All network operations have configurable timeouts

### 9. Model Output Validation

- LLM responses are treated as **untrusted input**
- Tool call parameters are validated against JSON Schema before execution
- Model-generated file paths are re-validated against the workspace sandbox
- The redaction boundary ensures secrets never leak into model context
- Freeform prompts, carried-forward chat context, attached text, and web/native-chat summaries are no longer promoted into the system prompt as trusted instructions. They are isolated as untrusted data and scanned before inclusion.

---

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Malicious model output | Tool approval gate + parameter validation + sandbox |
| Prompt injection via memory | MemoryScanner blocks inject patterns |
| Prompt injection via chat history or text attachments | Transient-context scanning + untrusted-context isolation + system-priority guardrails |
| Credential exposure | SecretStorage + redaction + scanner |
| Path traversal | Workspace-root sandboxing on all file ops |
| Shell injection | execFile (no shell) + allow-list + operator blocking |
| SSRF via web-fetch | IP range blocking + metadata endpoint blocking |
| XSS in webviews | CSP + nonces + escapeHtml |
| Runaway tool execution | 8 calls/turn limit + timeouts + cost limits |
| Supply chain (custom skills) | Security scanner + manual review gate |

---

## Vulnerability Reporting

If you discover a security vulnerability:

1. **Do NOT open a public issue**
2. Email the maintainer or use GitHub's private vulnerability reporting
3. Include: description, reproduction steps, impact assessment
4. You will receive a response within 72 hours

See [SECURITY.md](https://github.com/JoelBondoux/AtlasMind/blob/master/SECURITY.md) for the full policy.

### Scope

In scope:
- The AtlasMind VS Code extension
- Custom skill scanning and execution
- Memory system security
- Webview security

Out of scope:
- VS Code itself
- Third-party provider APIs
- User-installed MCP servers

### Safe Harbor

Security researchers acting in good faith are protected under AtlasMind's safe harbor policy. We will not pursue legal action for responsible disclosure.

# Security

AtlasMind is designed with a **safety-first** principle: the extension defaults to the safest reasonable behaviour, not the most permissive.

## Security Boundaries

### 0. Immutable Legal And Human-Respect Guardrails

- AtlasMind now injects a non-overrideable baseline into routed system prompts before ordinary task guidance is applied.
- That baseline requires compliance with applicable law and safety policy and treats legally ambiguous or jurisdiction-specific requests as restricted unless only safe, high-level information is being provided.
- AtlasMind must not help harm, discredit, disparage, or lie about any person, even if a user, retrieved document, or custom agent prompt attempts to push in that direction.
- Operator approval and autopilot only widen execution consent; they do not disable these baseline restrictions.


### 1. Credential Storage

- API keys are stored exclusively in VS Code's **SecretStorage**
- Keys are **never** written to settings, SSOT memory, source files, or logs
- The `MemoryScanner` blocks writes containing API keys, tokens, or passwords
- Webview messages carrying secrets are validated server-side before storage

### 2. File System Sandbox


> **Note:** The `project_memory/` folder is only present in development and feature branches. It is excluded from the `master` branch and all release builds. This is enforced by `.gitignore` and documented in the contribution guidelines.

**Managed-block writers.** The outbound testing-protocol sync (`src/utils/testingProtocolSync.ts`) and the framework scaffolder (`src/core/testingScaffolder.ts`) are strictly non-destructive. The protocol sync only writes to instruction files that *already exist*, only ever replaces its own delimited block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) while preserving all surrounding content, skips JSON-config files (which cannot host a markdown block), and routes every path through the shared `isSafeRelativePath` / `resolveRelativePath` traversal guard. The scaffolder creates starter files only when absent (never overwriting), never mutates `package.json`, and is modal-confirmed before running.

### 3. Webview Security

- All webview panels use a strict **Content Security Policy (CSP)**
- Destructive webview-triggered actions such as project-memory purge require extension-side confirmation and a typed confirmation phrase before any filesystem deletion occurs
- Delivery **stage edits** are posted whole and re-sanitised server-side (`sanitizeDeliveryConfig`) before they touch disk: string lengths are clamped, types coerced (booleans strict `=== true`), ids de-duplicated, and dangling/self promotion edges dropped. No secret values are ever stored — only config-source *locations*

### 3a. Promotion Execution Boundary

Executing a promotion ("push") on the Delivery page runs real shell commands, so it is held to a stricter boundary than ordinary tool use (see [[Tool-Execution]]):

- **Commands are server-sourced.** The webview sends only a path id, manual-check attestations, and a confirmation string. Every command actually executed (backup, deploy/migration routine steps) is read server-side from the persisted, user-authored stage config and routine files — a webview message can never inject a command.
- **Authorization gate.** `evaluatePromotionGate` is the single chokepoint and is re-run against live git state at execution time: it refuses on any hard blocker, any failing automatic preflight check, an un-attested manual check, a missing approval, or — for a **protected** target — a confirmation string that does not match the target name.
- **Deny-by-default backups.** A data-bearing target with a required-but-undefined backup command cannot be promoted to.
- **Non-destructive bias.** AtlasMind never force-pushes; each run records its outcome and a rollback handle.

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

### 4a. Dispatch-Time Secret Redaction

As a second defence-in-depth layer beyond the write-gate scanner, AtlasMind applies the `SecretRedactor` (`src/utils/secretRedactor.ts`) to **retrieved memory context and live evidence** immediately before they are embedded in a model prompt. This covers credentials that were accidentally stored in SSOT despite the write-gate, and protects the dispatch boundary even when the scanner was bypassed.

Patterns covered: Anthropic/OpenAI API keys, GitHub tokens, bearer tokens, PEM private keys, database connection strings (MySQL, PostgreSQL, MongoDB, Redis, AMQP), and generic key/secret variable assignments.

When redaction fires, a console warning names the count and pattern types matched. The redacted text is forwarded to the provider; the original is never sent.

### Data Privacy: confidential data is gated to trusted models

Beyond credential redaction, AtlasMind enforces a project **Data Privacy** policy (`project_memory/operations/data-privacy.json`, managed from the Project Dashboard → **Privacy** page). You mark language/terms, files, and folders as proprietary, confidential, or secret — and optionally enable built-in compliance packs (GDPR, HIPAA, PCI-DSS, CCPA/CPRA, Financial) that add curated detectors for regulated data points such as emails, payment-card numbers, and health terms.

Classified content may only ever be sent to the **trusted models you select**. Enforcement is layered:

- **Routing gate** — when the assembled context is classified, model selection is restricted to the trusted allow-list (`RoutingConstraints.requireTrustedModel`).
- **Redaction fail-safe** — if an un-trusted model is selected anyway (a pinned model, a parallel slot, or no trusted model available), classified spans are replaced with `[CONFIDENTIAL]` before dispatch, keyed on the actually-selected model.
- **Tool-read gate** — a `file-read` of a classified path by an un-trusted model is withheld.

**Deny-by-default**: an empty trusted list trusts nothing — enabling the policy with no trusted model redacts classified content for every model until you select one. When confidential content is detected but no trusted model is available, the content is redacted and the user is notified with a shortcut to the Privacy page. The compliance detectors are heuristic aids, **not** a certification of GDPR/HIPAA/PCI-DSS compliance.

### 5. Terminal Allow-List

- Only ~40 pre-approved commands are allowed via `terminal-run`
- Commands execute via `child_process.execFile()` — **no shell interpolation**
- Shell operators (`|`, `&&`, `||`, `;`, `` ` ``, `$()`) are blocked
- Write-capable commands (npm install, etc.) require explicit opt-in via `allowTerminalWrite`
- Container workflows use a separate `docker-cli` skill with its own strict Docker and Docker Compose subcommand allow-list, rather than inheriting arbitrary terminal execution.

### 6. Tool Approval Gate

- **Default mode:** `ask-on-write` — read-only operations auto-approved, writes require consent
- Four configurable approval modes from strictest to most permissive
- Interactive approval prompts now stay inside the AtlasMind chat surface instead of using an OS modal dialog, render in a dedicated warning stack below the transcript and above the composer, and prefer reusing the current chat surface instead of opening a second detached panel when AtlasMind needs attention, while still distinguishing one-off approval from task-scoped bypass and session-wide autopilot so users can deliberately widen execution scope instead of repeatedly clicking through the same tool sequence
- Session-wide autopilot remains explicitly visible through a status bar indicator and can be disabled via `AtlasMind: Toggle Autopilot`.
- Autopilot state notifications isolate listener failures so one faulty subscriber cannot suppress updates to the rest of the UI.
- The CLI host uses a separate runtime approval gate: it allows read-only tooling by default, blocks external high-risk tools, and requires `--allow-writes` before workspace or git writes are permitted.
- CLI workspace-boundary enforcement canonicalizes real filesystem paths before access is granted, so symlinked paths cannot escape the workspace sandbox.
- The dedicated Docker skill keeps read-only inspection (`docker ps`, `docker logs`, `docker compose logs`) separate from mutating container lifecycle actions (`docker compose up`, `docker stop`) so approvals stay aligned with the actual operational risk.
- For implementation work, AtlasMind also requires a failing relevant test signal before it will perform non-test writes or risky external execution such as terminal-write, git-write, or network-classified tool calls.
- Repo-maintenance actions such as Dependabot merges, rebases, or dependency branch resolution are evaluated by the normal approval gate, but they are not blocked by the implementation-only red-to-green TDD requirement.
- Atlas also uses recent session context to interpret terse deictic follow-up requests before deciding whether to stay advisory or move into tool-backed action, which reduces misclassification without weakening the approval gate itself.
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
- Warning-level findings on auto-generated skills no longer run silently: AtlasMind now pauses and raises an in-chat approval card so the operator can `Allow Once` or keep the draft blocked before any in-process evaluation happens
- Built-in skills are **pre-approved** and skip scanning
- MCP tools are **pre-approved** (trust is delegated to the MCP server)

### 7a. On-Device Voice Asset Provisioning

- Local speech-to-text (`LocalTranscriber`) downloads its Whisper model and, on Windows x64, the `whisper-cli` binary. Both are fetched over **HTTPS** from pinned URLs and **SHA-256-verified** against hardcoded checksums before use; a mismatch deletes the partial file and aborts rather than running unverified code.
- On macOS/Linux no binary is auto-downloaded — the operator must point `atlasmind.voice.whisperCliPath` at an installed `whisper-cli`, so binary trust stays with the system package manager.
- Captured **audio never leaves the machine**: transcription runs locally via a shell-less `spawn` with the temp WAV path passed as an argv element (never interpolated into a command line); the temp WAV is deleted after transcription.
- Host text-to-speech (`HostSpeechSynthesizer`) likewise passes spoken text only over stdin, never on a command line.

### 7b. Remote Control (Web → Desktop)

The web build can remote-control a desktop instance over a WebSocket. Because that exposes a surface able to run tools and hold secrets, it is **default-deny**:

- **Off by default.** The server never listens until the operator runs `AtlasMind: Enable Remote Control` and `atlasmind.remote.enabled` is on.
- **Localhost only (v1).** The server binds to `127.0.0.1`. Cross-machine reach is a planned follow-up and will require TLS.
- **Pairing + bearer token.** A token is generated and stored in **SecretStorage** on both sides; connections without a matching token are refused (constant-time comparison). Unauthenticated connections are dropped after a short timeout and audited.
- **Workspace-trust gate.** The server refuses to serve until the workspace is explicitly approved for remote control (mirrors the webhook trust gate).
- **Redaction boundary holds.** API keys and secrets are never serialized across the bridge — the desktop executes; the client only receives already-redacted results. Cost/run RPCs are **read-only**.
- **Inbound validation.** Every inbound chat frame passes the same `isChatPanelMessage` guard as the local UI before dispatch; invalid frames are dropped and logged. Remote clients can do nothing the local chat UI cannot.
- **No silent approvals.** Remote tool-approval decisions require an authenticated session and are audited; on disconnect, the bound ChatPanel is disposed and pending approvals default to **denied**.
- **Audit + revoke.** Connections and commands are logged to the AtlasMind Remote output channel; `AtlasMind: Revoke Remote Access` rotates the token and drops all sessions.

See [[Remote Control]] for the full model.

### 8. Network Safety

- `web-fetch` blocks **SSRF**: localhost, private IPs (10.x, 172.16-31.x, 192.168.x), link-local, and cloud metadata endpoints (169.254.169.254)
- AtlasMind now treats URLs surfaced in project work or Atlas chat as untrusted by default and tries to validate scheme, host, and reachability before presenting them as working links
- Webhook URLs must use **HTTPS** only
- Sensitive fields in webhook payloads are **redacted**
- All network operations have configurable timeouts
- **Agentic Resource Discovery (ARD)** treats every fetched manifest and `/search` response as untrusted: strict schema validation (`urn:ai:` identifiers, the spec's value-or-reference exclusivity, byte/entry caps). Discovered and referral URLs must be **HTTPS** and are screened against private/loopback/link-local hosts (same SSRF guard as `web-fetch`); `http`/localhost is only permitted for finders the user explicitly marked insecure with `atlasmind.ard.allowInsecureEndpoints`. Federation and nested-catalog expansion are **depth-bounded** to prevent referral loops. Agent Finders ship **disabled** (no outbound discovery until opt-in). The relevance score is surfaced as informational only and **must not** be read as a trust or safety rating; `trustManifest` metadata is shown read-only and is not cryptographically verified. Nothing auto-installs — discovered MCP servers land disabled behind the existing MCP trust gate, and the `discover-resources` skill is read-only. Catalog export redacts system prompts, secrets, and MCP `env`. See [[Resource Discovery]].

### 9. Model Output Validation

- LLM responses are treated as **untrusted input**
- Tool call parameters are validated against JSON Schema before execution
- Model-generated file paths are re-validated against the workspace sandbox
- The redaction boundary ensures secrets never leak into model context
- Freeform prompts, carried-forward chat context, attached text, and web/native-chat summaries are no longer promoted into the system prompt as trusted instructions. They are isolated as untrusted data and scanned before inclusion.

### 10. Context-Window Overflow Guard

Each iteration of the agentic loop now computes a safe `maxTokens` value: `min(DEFAULT_CHAT_MAX_TOKENS, modelContextWindow − estimatedInputTokens − 1024)`. This prevents completion requests from overflowing the model's context window as conversation history grows, which could otherwise cause silent truncation or provider errors on long-running tasks.

---

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Malicious model output | Tool approval gate + parameter validation + sandbox |
| Prompt injection via memory | MemoryScanner blocks inject patterns |
| Prompt injection via chat history or text attachments | Transient-context scanning + untrusted-context isolation + system-priority guardrails |
| Credential exposure | SecretStorage + MemoryScanner write-gate + SecretRedactor dispatch-time scan |
| Path traversal | Workspace-root sandboxing on all file ops |
| Shell injection | execFile (no shell) + allow-list + operator blocking |
| SSRF via web-fetch | IP range blocking + metadata endpoint blocking |
| SSRF / malicious manifests via ARD discovery | HTTPS enforcement + private-host screening + schema validation + depth-bounded federation + opt-in finders + disabled-by-default installs |
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

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


> **Note:** The `project_memory/` folder is **tracked in git and is present on `main`** — only `sessions/`, `temp/`, `project-run-*.json`, and `.delivery-lock.json` are gitignored. What keeps it out of published Marketplace packages is `.vscodeignore`, not `.gitignore`.

**Managed-block writers.** The outbound testing-protocol sync (`src/utils/testingProtocolSync.ts`) and the framework scaffolder (`src/core/testingScaffolder.ts`) are strictly non-destructive. The protocol sync only writes to instruction files that *already exist*, only ever replaces its own delimited block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) while preserving all surrounding content, skips JSON-config files (which cannot host a markdown block), and routes every path through the shared `isSafeRelativePath` / `resolveRelativePath` traversal guard. The scaffolder creates starter files only when absent (never overwriting), never mutates `package.json`, and is modal-confirmed before running.

**First-test authoring remains an agent action, not a scaffolder shortcut.** A source-file nomination is deliberately conservative and does not grant permission to change it. Only after the user confirms the scaffold does Settings synchronise existing instruction files and, when an already-installed Vitest/Jest runner and a small named export are present, ask an agent to inspect one candidate under the usual Orchestrator and per-tool approval boundaries. The prompt forbids dependency, manifest, and production-source changes and permits a no-change outcome, so an uncertain target is not turned into speculative coverage.

**A green dashboard is not permission to hide a failing test.** **Fix activated testing** is modal-confirmed, derives its test evidence in the extension host, and sends it to a normal approval-gated task with project text fenced as reported data. The task may run existing relevant tests and make focused repairs, but it is forbidden from changing dependencies, manifests, runner configuration, coverage thresholds, policy enablement, skips, assertions, or external services to make the result look green. Environment prerequisites that are unavailable remain explicit blockers.

### 3. Webview Security

- All webview panels use a strict **Content Security Policy (CSP)**
- Chat execution-limit chips are treated as untrusted messages: the protocol accepts only finite bounded integers, and the extension host re-resolves the referenced assistant entry, verifies that recovery is still pending, and requires the submitted value to match the server-stored suggestion before changing either the live Orchestrator or workspace configuration. One-run changes are restored after the retry.
- Destructive webview-triggered actions such as project-memory purge require extension-side confirmation and a typed confirmation phrase before any filesystem deletion occurs
- Delivery **stage edits** are posted whole and re-sanitised server-side (`sanitizeDeliveryConfig`) before they touch disk: string lengths are clamped, types coerced (booleans strict `=== true`), ids de-duplicated, and dangling/self promotion edges dropped. No secret values are ever stored — only config-source *locations*
- Website Studio messages are allow-listed by type, fixed SSOT path, and fixed navigation command. Brief, sitemap, design, hosting, platform, and n8n payloads are re-sanitised server-side: counts/lengths are capped, ids/status/platforms/colors/URLs are normalized or allow-listed, only one primary platform survives, the canonical Develop/Staging/Production access policies are reconstructed, shared secret patterns are redacted, n8n webhook-shaped URLs are removed, and both outputs pass the SSOT memory scanner before file writes begin
- **Project Director** edits (the dashboard's Director tab) are posted whole and re-sanitised server-side (`sanitizeProjectDirectorConfig`) before they touch disk: string lengths are clamped, every enum is whitelisted to a safe fallback, ids are regenerated, role records referencing a non-existent contact are dropped, dangling optional references cleared, and contact deep-links whose scheme is not allowlisted (`mailto:`/`tel:`/`sms:`/`slack:`/`msteams:`/`zoommtg:`/`https:`) stripped. Communication `handle`s are non-secret identifiers — no tokens/passwords are stored. Opening a contact deep-link resolves the link from the persisted config and re-checks the scheme server-side before `openExternal`; "Copy contact" builds the text host-side; the webview never supplies a raw URL or command. **Guarded outbound (Phase 3):** the Director can email/schedule/message a contact through a connected MCP connector only when the project enabled it (`outboundEnabled`, default off), a connector can perform the intent, and the user confirms an explicit modal showing the exact action — the tool comes from the connected server (run via its `mcp:` skill), the webview only supplies a draft, and there is a deep-link fallback (see [[Tool-Execution]])

**Website hosting/n8n credential boundary.** `WebsiteWorkspaceConfig` contains workflow IDs and credential *references* but no credential-value, bearer-token, password, or webhook-value field. References require an explicit provider prefix such as `env:` or `SecretStorage:`; a raw password-like string is discarded. Platform/n8n URLs must be HTTP(S) and cannot carry username/password, query, or fragment data. Hosting readiness additionally restricts local Develop to loopback, requires HTTPS and password references for hosted Develop/Staging, requires Staging to use `<review-label>.<production-domain>`, and keeps Production public and promotion-protected. Free-text imports still pass through the shared secret redactor. The resulting `project_memory/domain/website.json` is planning state, not an authorization record: a `ready` environment or `configured` platform/workflow status cannot publish or trigger anything.

### 3a. Promotion Execution Boundary

Executing a promotion ("push") on the Delivery page runs real shell commands, so it is held to a stricter boundary than ordinary tool use (see [[Tool-Execution]]):

- **Commands are server-sourced.** The webview sends only a path id, manual-check attestations, and a confirmation string. Every command actually executed (backup, deploy/migration routine steps) is read server-side from the persisted, user-authored stage config and routine files — a webview message can never inject a command.
- **Authorization gate.** `evaluatePromotionGate` is the single chokepoint and is re-run against live git state at execution time: it refuses on any hard blocker, any failing automatic preflight check, an un-attested manual check, a missing approval, or — for a **protected** target — a confirmation string that does not match the target name.
- **Deny-by-default backups.** A data-bearing target with a required-but-undefined backup command cannot be promoted to.
- **Non-destructive bias.** AtlasMind never force-pushes; each run records its outcome and a rollback handle.
- **Verified CI, not honor-system.** Required CI status checks are verified live via `gh` (a failing or pending run blocks the gate), with graceful fallback to manual attestation only when `gh` is unavailable.
- **Audit trail.** Every promotion and rollback is appended to `project_memory/operations/delivery-history.json` with the git actor, timestamp, and outcome. Rollback execution runs only the stage's user-authored command and re-applies the protected-stage type-to-confirm authorization.
- **Single-flight lock.** A workspace lock makes promotions/rollbacks mutually exclusive (auto-clears after 60 min), preventing racing deploys.
- **Separation of duties.** A stage can require the promoter (git actor) to differ from the change's author, enforced automatically.
- **Deploy in CD, not on a laptop.** A stage can promote by dispatching a CD workflow (`gh workflow run`) so production deploys carry CI/CD identity and logs.

### 3b. Buzz Inbound Boundary

Reading from a Buzz relay means accepting data from a networked party AtlasMind does not control, so inbound sync is treated as an untrusted-input surface:

- **Frames are parsed defensively.** `parseRelayFrame` never throws: oversized (capped), non-JSON, non-array, and structurally invalid frames degrade to a typed `unknown` frame. `validateNostrEvent` checks hex lengths, kind range, and tag structure and returns undefined rather than coercing a malformed event into a half-trusted one.
- **Structural validity is not authenticity.** Signature verification is explicitly *not* performed client-side — it is the relay's job under NIP-42 — and the code says so, so a validated event is never mistaken for an authenticated one.
- **Derive, don't mirror.** Inbound messages become follow-up work items with a **pointer back to the Buzz thread**, never the message body. SSOT is git-tracked, so mirroring a channel would commit colleagues' conversations into the repository. Text that does cross is secret-redacted, control-character-stripped, and length-clamped.
- **Links stay on the allowlist.** A thread link is built only from an `https` base, with the channel id percent-encoded, so a crafted pointer can neither yield a launchable non-https URI nor traverse the path.
- **A refused key is not retried.** A NIP-42 `restricted:` refusal stops reconnection rather than looping — the client already authenticated and was still rejected, so retrying would only hammer the relay.
- **Read-only by construction.** The inbound client sends only `REQ`, `CLOSE`, `AUTH`, and keep-alive pings — never an `EVENT`. A subscription therefore *cannot* publish to Buzz, and a test asserts it, so the read path can never become a write path by accident.
- **A hosted relay must be encrypted.** A Buzz workspace need not be local. An unencrypted socket to a **remote** relay is refused outright — plaintext would expose colleagues' message content and the NIP-42 challenge/response in transit. Loopback is exempt because it never leaves the machine. The rule sits at the transport, so no future wiring can reintroduce it, and it matches what the outbound bridge enforces.
- **The agent key is checksum-validated before it is ever used.** An `nsec` is decoded with its bech32 checksum verified, so a mistyped key fails loudly rather than silently authenticating as a different identity; an `npub` (a public key) is rejected by name. Validation happens when the signer is created, not mid-handshake, and secret material never reaches a log, an error message, or a serialised value. Each signature is verified against the derived public key before the event leaves the signer.
- **Deny-by-default.** Constructing a client connects nothing; `start()` is explicit. Read-only subscription first, and any auto-creation of work items sits behind an explicit toggle.
- **A relay that demands auth without a key stops, explained.** Schnorr signing fills the signer seam, but no agent key is configured until you set one, so an authenticating relay produces a typed stop naming the reason — never a silent failure and never a reconnect loop.
- **Binding an agent by clicking is validated exactly like a hand-edited setting.** The Settings → Buzz page and the Director's person form both write through one pure helper, so no surface can invent looser rules: a key that fails its bech32 checksum is refused **with a reason** rather than coerced onto a different real identity, an `nsec` pasted where a public key belongs is refused by name, and a binding naming an agent that does not exist is rejected instead of silently pointing at nothing. Editing one binding leaves every other untouched.
- **A Buzz handle is never derived from a person.** The identity picker offers only keys that arrived on the wire, named only by profiles their owners published; an unnamed identity shows a key prefix rather than an invented label. Fabricating a key from a name would produce a plausible one belonging to a different real person. Published names are untrusted remote text — secret-redacted, control-character-stripped, and length-clamped on entry — and the observed-identity roster is held in memory only, never written into git-tracked project memory.
- **The setting is the single source of truth.** `atlasmind.buzz.agentBindings` is not mirrored into the Director roster — the roster edits the setting — so a binding made by clicking and one typed into `settings.json` cannot disagree. It is stored in settings rather than project memory because it is a local routing preference and `project_memory/` is git-tracked.
- **No generic command runner crosses the webview boundary.** The Settings page's two action buttons post named messages mapped to fixed command ids; a message carrying an arbitrary command id would let untrusted webview input choose what the extension executes.

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

- **Routing gate** — when the assembled context contains a `secret`-tier match (PCI cardholder data, HIPAA PHI), model selection is restricted to the trusted allow-list (`RoutingConstraints.requireTrustedModel`).
- **Redaction fail-safe** — if an un-trusted model is selected anyway (a pinned model, a parallel slot, an advisory-tier match, or no trusted model available), classified spans are replaced with `[CONFIDENTIAL]` before dispatch, keyed on the actually-selected model.
- **Tool-read gate** — a `file-read` of a classified path by an un-trusted model is withheld.

**The gate scans your context, not your request.** It classifies the memory, file evidence, and conversation history assembled for a task, so a hit means "something in the retrieved haystack looked regulated" — not "this task is about personal data". Because of that, the response is tiered:

| Tier | Packs / rules | Response |
|---|---|---|
| `secret` | PCI-DSS, HIPAA, custom rules marked secret | Hard gate — routing restricted to trusted models |
| `confidential` / `proprietary` | GDPR, CCPA, custom rules at those levels | Advisory — routing unchanged, matched spans redacted |

Nothing leaks under either tier; the difference is whether a task is re-routed or simply has the matched spans removed. Advisory matches deliberately do *not* change your model, so one heuristic detector firing somewhere in a large context bundle can't silently downgrade an unrelated task. Progress notices name the detector **and** the context slice it fired in, so you can tell a real catch from a false positive.

**Precision is part of the safety model.** A detector that fires on ordinary source is not a conservative default — it trains you to switch the policy off, and then nothing is protected. The built-in detectors are anchored on cues ordinary code does not contain (an explicit `phone:`/`SWIFT:` label, a `+` country code, a clinical construction) and reject the structurally impossible: reserved IP ranges (loopback, private, CGNAT, TEST-NET, multicast) and four-part version strings are not IP addresses; role mailboxes (`noreply@`, `support@`, CI senders) and `example.com`-style reserved domains are not personal data. For project-specific data, a targeted custom rule beats a broad pattern every time.

**Deny-by-default**: an empty trusted list trusts nothing — enabling the policy with no trusted model redacts classified content for every model until you select one. When regulated content is detected but no trusted model is available, the content is redacted and the user is notified with a shortcut to the Privacy page. The compliance detectors are heuristic aids, **not** a certification of GDPR/HIPAA/PCI-DSS compliance.

**Project Director PII consent gate.** The Director tab prefers to *reference* people in their system of record (Microsoft 365 / Slack / Google) over storing raw personal data locally. The first time a save would persist raw PII (a name plus an email/phone), a modal explains the GDPR implications and requires an explicit acknowledgement (workspace-scoped, `atlasmind.projectDirector.piiStorageAcknowledged`); declining aborts the write. On acknowledgement AtlasMind enables the built-in `gdpr-pii` compliance pack so stored personal data is classified confidential and gated by the layers above.

Because that acknowledgement is narrow ("store these contact details") but enabling the policy is workspace-wide, the modal states the consequence up front — from then on every task's assembled context is scanned — and if the master switch actually had to be turned on you are told afterwards and offered the Privacy page to review it. A scope change you can't see is one you can't undo. The git-tracked `project-director.md` mirror describes channels by kind/label only, so raw addresses never enter a diff.

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
- `specialist-guidance` is an explicitly low-risk read because it only returns a bounded bundled checklist; it cannot access files, processes, secrets, or the network. Recommended live checks remain independently classified tool calls.
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

**MCP guided setup (`src/views/mcpPanel.ts`):**
- **Credentials in SecretStorage, not settings.** Secret inputs the wizard collects (API tokens, etc.) are stored in VS Code SecretStorage under `atlasmind.mcp.<serverId>.<KEY>` via `McpServerConfig.secretEnvKeys`, merged into the process env only at connect time, and deleted when the server is removed. The persisted config (in `globalState`) holds only the key names — secret values never touch settings or the git-tracked tree, and are never echoed back to the webview.
- **Confirm before install.** A missing runtime (Node, uv, …) is surfaced with the exact package-manager command and installed **only after explicit user confirmation** (`checkStarterRuntime` plans; `runRuntimeInstallPlan` runs only post-confirmation) — replacing the previous silent auto-install.
- **Trustworthy scan.** `detectAvailableServers()` surfaces only servers whose launch runtime is actually present, so the wizard never offers a broken option.

### 7a. On-Device Voice Asset Provisioning

- Local speech-to-text (`LocalTranscriber`) downloads its Whisper model and, on Windows x64, the `whisper-cli` binary. Both are fetched over **HTTPS** from pinned URLs and **SHA-256-verified** against hardcoded checksums before use; a mismatch deletes the partial file and aborts rather than running unverified code.
- On macOS/Linux no binary is auto-downloaded — the operator must point `atlasmind.voice.whisperCliPath` at an installed `whisper-cli`, so binary trust stays with the system package manager.
- Captured **audio never leaves the machine**: transcription runs locally via a shell-less `spawn` with the temp WAV path passed as an argv element (never interpolated into a command line); the temp WAV is deleted after transcription.
- Host text-to-speech (`HostSpeechSynthesizer`) likewise passes spoken text only over stdin, never on a command line.

### 7b. Remote Control (Web → Desktop)

The web build can remote-control a desktop instance over a WebSocket. Because that exposes a surface able to run tools and hold secrets, it is **default-deny**:

- **Off by default.** The server never listens until the operator runs `AtlasMind: Enable Remote Control` and `atlasmind.remote.enabled` is on.
- **Localhost bind.** The server always binds to `127.0.0.1`. Cross-machine reach (`atlasmind.remote.mode: "gateway"`) is achieved by fronting it with your own SSO gateway + tunnel over TLS, never by exposing the port directly.
- **Gateway origin secret.** In `gateway` mode the SSO gateway authenticates each WebSocket via an `x-atlas-origin-secret` header the desktop verifies constant-time against the pairing-token slot; the browser never holds a credential (the login is its identity), and an optional `x-atlas-user-id` is recorded for audit.
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
- **Buzz live communications** are doubly gated: the global `buzz.enabled` setting, remote-relay consent/TLS policy, the connected MCP server, the Project Director's per-project `outboundEnabled`, and a per-send modal confirmation. The bundled bridge accepts only a CLI whose required command/flag surface matches the pinned v0.4.26 contract, invokes it directly without a shell, passes message bodies over stdin, validates UUID/event/pubkey inputs, caps duration/output, and redacts the private key/NIP-OA grant. Buzz developer shell/file tools are deliberately outside the connector.

### 8a. ACP private-desktop boundary

`atlasmind.acp.hideConsoleWindows` is a Windows UX control, not a sandbox. When
selected, a bundled native helper creates a private desktop and starts the
already-resolved ACP executable there so descendant console windows cannot
reach the user's input desktop. The child still runs as the same user with the
same filesystem and network access.

The dual-use risk is explicit. Hidden VNC malware uses private desktops for
covert interactive processes, and [Microsoft Defender for Endpoint exposes a
`DesktopName` field](https://techcommunity.microsoft.com/blog/microsoftdefenderatpblog/detect-suspicious-processes-running-on-hidden-desktops/4072322)
so defenders can hunt that behaviour. AtlasMind therefore:

- leaves the feature off until the user selects it, and asks before the first
  ACP probe;
- never switches to, captures, or remotely controls the created desktop;
- keeps the helper dependency-free and source-visible under
  `native/acp-private-desktop/`;
- gives its desktop handle only the required `DESKTOP_CREATEWINDOW` access;
- passes an already-resolved executable and argv with no shell;
- uses `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` to inherit only stdin/stdout/stderr;
- pins the shipped PE by SHA-256 and refuses missing or changed binaries;
- fails visibly if EDR blocks the helper, without silently falling back to a
  focus-stealing visible launch.

These controls make the intent auditable; they cannot guarantee an enterprise
heuristic will accept the technique. The SHA-256 pin is an AtlasMind integrity
check, not an Authenticode signature or a reputation signal; the v0.230.0 helper
PE is not Authenticode-signed. Managed environments should leave the checkbox
off unless their security team approves it, and may require an organisation
signature or a hash/publisher allow-rule before deployment.

### 9. Model Output Validation

- LLM responses are treated as **untrusted input**
- Tool call parameters are validated against JSON Schema before execution
- Model-generated file paths are re-validated against the workspace sandbox
- The redaction boundary ensures secrets never leak into model context
- Freeform prompts, carried-forward chat context, attached text, and web/native-chat summaries are no longer promoted into the system prompt as trusted instructions. They are isolated as untrusted data and scanned before inclusion.
- **Structured model output is parsed defensively.** Where a feature asks a model for JSON it must not assume it receives any. The Risk page's `parseRiskFindings` and the security register's `parseSecurityFindings` locate candidate JSON (fenced block, bare array, or a `{findings:[...]}` wrapper) and return `[]` on absent, malformed, or wrongly-typed content rather than throwing, so a bad response records nothing instead of failing the run. Their sanitizers clamp strings and collections, coerce enums to **safe** defaults (including unknown status → `open`, so a finding is never silently resolved), generate collision-safe ids, and reject absolute paths, drive letters, and `..` traversal in any cited evidence path.

`SecurityReviewManager` is deliberately only a durable record boundary for reviews of secrets, runtime boundaries, dependencies, and permissions. It stores no secret values, runs no vulnerability scanner, grants no tool capability, and does not block a commit, promotion, or release. The service is not yet connected to a dashboard or extension activation path.

### 9a. Read-Only Oversight Advisors

The three oversight advisors (`ethics-oversight`, `legal-oversight`, `commercial-oversight`) are the only built-in agents with a **restricted skill allowlist**. Every other built-in uses `skills: []`, which expands to all enabled skills; the advisors pin an explicit read-only set and therefore hold no `file-write`, `file-edit`, `file-delete`, `file-move`, `git-commit`, `git-push`, `git-apply-patch`, `terminal-run`, `docker-cli`, `npm-scripts`, `test-run`, `memory-write`, `memory-delete`, `rename-symbol`, `code-action`, `code-format`, `rollback-checkpoint`, or `http-request` (which permits arbitrary methods — `web-fetch` is the read-only equivalent).

An advisor inspects and reports; it is never also the thing that edits. Where findings must be recorded, the Project Dashboard owns that single write path and sanitises the model's output before it reaches disk. The advisors also set `autoUpdateExcluded: true`, so the agent auto-updater cannot paraphrase their "advisory, not authoritative" framing away on its cadence. Because `getSkillsForAgent` silently drops unrecognised ids, `tests/runtime/core.test.ts` asserts that every pinned id resolves and that no mutating skill is granted.

None of the advisors gates anything: an open finding never blocks a commit, a promotion, or a release. Their output is a prompt for human judgement, and each prompt names the review a consequential finding needs — qualified counsel in the relevant jurisdiction, an ethics or DPO review, or finance/commercial sign-off. They are explicitly **not a substitute for professional advice**.

### 10. Context-Window Overflow Guard

Each iteration of the agentic loop now computes a safe `maxTokens` value: `min(DEFAULT_CHAT_MAX_TOKENS, modelContextWindow − estimatedInputTokens − 1024)`. This prevents completion requests from overflowing the model's context window as conversation history grows, which could otherwise cause silent truncation or provider errors on long-running tasks.

### 11. Autonomous Mission Loop Containment

The Mission Loop (`/loop` and Mission Control) is autonomous, so it is bounded on every axis:

- **Closed parameter envelope.** Every run is capped by hard stops — max iterations, cumulative cost (USD), cumulative tokens, wall-clock time, and a consecutive-no-progress limit — checked **before each iteration**, on top of the project-wide daily budget gate. The loop cannot run away with budget or time.
- **Deny-by-default checkpoints.** Hybrid autonomy means the loop pauses for human approval at configured triggers; an unanswered, dismissed, or throwing checkpoint resolves as **denied** and stops the run.
- **Untrusted evaluator output.** The goal evaluator's verdict is parsed and validated field-by-field (safe fallback to `stalled`/zero-confidence); a confidence threshold plus a verification guard mean a malformed or over-eager evaluator can never falsely declare success, and unverified behaviour changes are never accepted as "done".
- **Guardrail injection.** The mission's guardrails (rules + protected paths) are folded into every increment's planning/execution prompt as high-priority constraints that compose with — never override — the immutable guardrails.
- **Gated discovery, no deployment bypass.** New agents/skills/resources pass the existing approval gates before use; deployments route through the guarded promotion pipeline, never run directly.
- **Auditable.** Each run is persisted to `project_memory/operations/missions.json` + a `missions.md` mirror, with no secret values and bounded text.

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
| ACP prompt replay / duplicated delegated work | Stable per-tool-round identity + exact transcript-prefix reuse + in-flight single-flight + short completed-result ledger + exclusion from generic retries + outer-timeout `session/cancel` and teardown after an uncertain `session/prompt` |
| Hidden-desktop dual use / EDR detection | Off-by-default disclosed choice + source-visible SHA-256-pinned helper + no desktop switching/control + minimal handle inheritance + visible failure, with ordinary launch available |
| SSRF via web-fetch | IP range blocking + metadata endpoint blocking |
| SSRF / malicious manifests via ARD discovery | HTTPS enforcement + private-host screening + schema validation + depth-bounded federation + opt-in finders + disabled-by-default installs |
| XSS in webviews | CSP + nonces + escapeHtml |
| Runaway tool execution | 8 calls/turn limit + timeouts + cost limits |
| Runaway autonomous loop | Mission Loop closed parameter envelope (iterations/cost/tokens/time/no-progress) + daily budget gate + deny-by-default checkpoints |
| False "goal achieved" on unverified work | Validated evaluator output + confidence threshold + verification guard (TDD/verification status) |
| Supply chain (custom skills) | Security scanner + manual review gate |

---

## Vulnerability Reporting

If you discover a security vulnerability:

1. **Do NOT open a public issue**
2. Email the maintainer or use GitHub's private vulnerability reporting
3. Include: description, reproduction steps, impact assessment
4. You will receive a response within 72 hours

See [SECURITY.md](https://github.com/JoelBondoux/AtlasMind/blob/main/SECURITY.md) for the full policy.

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

## Delegation does not carry authorization

An agent can ask another agent a question (`agent-handoff`). **The delegate runs with the intersection of
the caller's capabilities and its own — never the union.**

This is the security property, not a limitation. Handing off to a specialist *feels* like it should give
you the specialist's tools; that is what makes them a specialist. But if it did, any restricted agent could
obtain any capability by asking a permissive one for it, and every restriction described on this page would
become a suggestion. Privilege escalation by delegation is a classic precisely because the escalating step
always looks reasonable in isolation.

Four supporting boundaries:

- **The caller cannot name itself.** Identity comes from what the orchestrator knows it is running, never
  from tool arguments — a model able to name its own caller could name a more privileged one.
- **The delegate is a narrowed copy** of the target agent, so a run's ceiling cannot leak into later uses.
- **A disabled agent cannot be reached** through delegation. Somebody switched it off.
- **Every tool the delegate uses is approved on its own account.** Allowing a handoff approves the spend,
  not whatever the delegate goes on to do.

Delegation is capped at three deep and cannot loop back to an agent already in the chain. A delegate that
would end up with no tools at all is refused rather than run: a model that cannot check anything produces
confident prose, and confident prose arriving as an answer is worse than a refusal naming what is missing.

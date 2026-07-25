# Buzz (buzz.xyz) Integration — Phased Roadmap

> **Status:** Tier 1 (foundation) partially implemented; Tiers 2–4 planned.
> **Owner:** AtlasMind core. **Created:** 2026-07-25.
> This is the SSOT north star for integrating Buzz into AtlasMind. Build incrementally,
> respecting the entry criteria between tiers. Nothing here overrides AtlasMind's
> safety-first defaults: deny-by-default, sanitize-at-boundary, confirm-before-external-action.

## Context — why

[Buzz](https://buzz.xyz) (by Block; Apache-2.0; launched 2026-07-21) is an open-source,
Nostr-based workspace where **humans and AI agents collaborate as equals** — pitched as a
decentralized, self-sovereign replacement for **Slack + GitHub combined**. Its defining trait:
every agent gets its own **Nostr keypair identity**, signs its own work, and every action is
cryptographically traceable back to the human who granted a **narrowly-scoped, revocable**
authorization.

That overlaps almost 1:1 with three AtlasMind subsystems already in place:

- **Project Director** — the *people* around a project (stakeholders, team, follow-ups). Buzz = where those people (and their agents) actually talk.
- **Director comms** (`directorCommsRunner.ts` + guarded dispatch) — "reach a contact through a connected connector, behind a `{modal:true}` gate." Buzz is a natural connector target.
- **MCP + Skills registry** — how AtlasMind wires external tool surfaces. Buzz ships agent-facing surfaces (`buzz-cli`, `buzz-dev-mcp`, `buzz-sdk`).

The intended outcome: AtlasMind keeps its model routing, memory (SSOT), planning, and cost
control, and gains Buzz as the **signed, auditable communication + coordination fabric** for the
humans *and* the orchestrated agents around a project — without hard-coupling to Slack/GitHub.

## Separation of concerns — the governing contract

**This is the load-bearing principle for every tier. Do not blur it.**

> **Buzz handles identity + messaging. AtlasMind handles reasoning + execution.**

| Concern | Owner | AtlasMind's role at the seam |
|---|---|---|
| **Identity** — Nostr keypairs, directory, signature verification, authorship ledger | **Buzz** | *References* a Buzz identity (`DirectoryRef.source: 'buzz'`, an npub/@handle). Never mints, mirrors, or runs its own identity/directory system. |
| **Messaging** — channels, DMs, threads, the message log, delivery | **Buzz** | *Composes* a draft and *dispatches* it through a Buzz tool/deep link; *subscribes* to events. The conversation lives in Buzz — AtlasMind is never the message store. |
| **Reasoning** — model routing, planning, memory/SSOT, task profiling, cost | **AtlasMind** | Owns it entirely. Buzz never makes routing/planning decisions. |
| **Execution** — skills, tools, orchestration, runs, file/commit actions | **AtlasMind** | Executes with its *own* toolchain. Buzz events may *trigger* AtlasMind, but execution never routes *through* Buzz. |

**Guardrails that keep the seam clean:**
- **Don't mirror conversations.** Inbound Buzz events are *derived* into work items (FollowUp/Assignment) with a pointer back to the Buzz thread — raw chat history is never copied into SSOT. Buzz stays the message system-of-record.
- **Don't execute through Buzz.** `buzz-dev-mcp` (shell + file-edit) and `buzz-workflow` are *not* AtlasMind's executor. A Buzz workflow/event **triggers** an AtlasMind run; AtlasMind runs it on its own skills/tools. If `buzz-dev-mcp` is ever connected, it is scoped as a Buzz-side agent surface, not AtlasMind's execution path.
- **Don't become an identity provider.** Even at Tier 4, Buzz owns keypair issuance, verification, and the authorship ledger. AtlasMind only *custodies* an agent's secret (SecretStorage) and *records* the human→agent authorization grant. It never becomes a directory or issuer.

## Buzz surface — ground truth (verify per release; it is early-stage)

| Component | What it is | Integration relevance |
|---|---|---|
| `buzz-relay` | Axum **WS + REST** Nostr relay: NIP-01 events, NIP-42 Schnorr auth, NIP-34 git. Postgres + Redis + S3/MinIO. Default `ws://localhost:3000`, self-hostable. | Direct protocol option (Tier 3/4). |
| `buzz-cli` | **Agent-first CLI, JSON in / JSON out**, auth via `BUZZ_PRIVATE_KEY`, relay via `BUZZ_RELAY_URL`. | The programmatic **comms** surface (post/DM/channels). **Exact command schema not yet published — must be confirmed against the installed binary before wiring live sends.** |
| `buzz-dev-mcp` | An **MCP server** shipping shell + file-edit tools. **No comms tools.** | Connectable today via AtlasMind's MCP registry, but gives agent dev-tools, *not* messaging. |
| `buzz-sdk` / `buzz-core` | TypeScript typed event builders + protocol types / NIP-01 filters. | Cleanest path for a first-class in-extension `BuzzClient` (Tier 3/4), since AtlasMind is TS. |
| `buzz-acp` / `buzz-agent` | ACP (Agent Client Protocol) harness — **already supports Claude Code**, Goose, Codex. | A2A / self-sovereign agent identities (Tier 4). |
| `buzz-workflow` / `buzz-persona` | YAML automation; agent persona packs. | Project-management automation (Tier 2/3). |

**Key constraint that shapes the plan:** Buzz has **no comms-capable MCP server today**. So the
"register an MCP server whose `post_message` tool auto-flows into Director dispatch" path does not
work out of the box for messaging. Live outbound to Buzz requires either (a) Buzz shipping a comms
MCP, or (b) AtlasMind wrapping `buzz-cli`/`buzz-sdk` — gated on a verified command/event schema.
Until then, AtlasMind integrates Buzz as a **recognized identity + connector** and reaches Buzz via
**deep links** through the existing guarded fallback.

## Value targets (all four in scope, phased)

1. **Stakeholder / human comms** — push Director updates, status, and follow-up nudges to Buzz channels & DMs.
2. **Agent-to-agent coordination** — orchestrated agents coordinate/hand off in Buzz with signed, auditable messages.
3. **Project management** — Buzz channels + Git hosting + workflows as a PM backbone the Planner/Run Center reflect.
4. **Discovery / ecosystem** — Buzz (and its agents) surfaced as ARD-discoverable resources.

## Relay targeting (decided)

**Configurable, local-first.** A `atlasmind.buzz.relayUrl` setting defaults to `ws://localhost:3000`
(self-hosted). Targeting a **remote** relay sends project data off-machine, so it is gated behind a
separate deny-by-default `atlasmind.buzz.allowRemoteRelay` flag and the redaction/consent boundary —
mirroring `atlasmind.ard.allowInsecureEndpoints`.

---

## Tier 1 — Foundation & recognized connector  *(in progress)*

**Goal:** Buzz is a first-class, configurable, deny-by-default citizen of the existing Director +
comms machinery, with zero speculative protocol code.

**Shipped in this pass:**
- `buzz` added to `CommunicationChannelKind` (`src/types.ts`) — Director contacts can carry a Buzz identity (npub / @handle / #channel) and an optional Buzz web deep link.
- Buzz option in the contact-link editor + an `https`-only deep-link builder (`media/projectDashboard.js`), reusing the existing scheme allowlist (no new native scheme added — safety-first).
- `directorCommsRunner.ts` `INTENT_PATTERNS` extended so Buzz-style comms tool names (`post_to_channel`, `send_dm`, `direct_message`, `buzz_*`) classify as the `message` intent. **Forward-compatible:** the moment a Buzz comms tool is connected (via MCP), Director's guarded `{modal:true}` dispatch works with no further code.
- Settings (deny-by-default): `atlasmind.buzz.enabled` (`false`), `atlasmind.buzz.relayUrl` (`ws://localhost:3000`), `atlasmind.buzz.allowRemoteRelay` (`false`).

**Reuse map (no new send path, no new dispatch):** `handleDirectorSendComms` + the `{modal:true}`
auth gate + the `outboundEnabled` project flag + `handleOpenContactDeepLink` + `ALLOWED_DEEPLINK_SCHEMES`
+ `sanitizeProjectDirectorConfig` are all reused unchanged.

**Tier-1 completion gate (Tier-1b, follow-up):** wire a live outbound send to Buzz. Options, in
preference order:
1. Adopt a Buzz **comms MCP** if/when Block ships one → automatic via existing dispatch.
2. Otherwise author a thin, isolated, unit-tested `buzz-cli`/`buzz-sdk` bridge — **only after** the
   `buzz-cli` JSON command schema (or `buzz-sdk` event builders) is verified against a pinned Buzz
   version. Centralize the command/event construction in one module; never guess an external API.

---

## Tier 2 — ARD discoverability + guided connector

**Goal:** Buzz is discoverable and one-click connectable, disabled-by-default.

- Add a curated **Buzz MCP starter** to the guided-setup catalogue (`RECOMMENDED_MCP_SERVER_CATALOGUE`
  + `getRecommendedMcpStarterDetails`, `src/constants.ts`), `Collaboration` category, `guided-manual`,
  `secretEnvKeys: ['BUZZ_PRIVATE_KEY']`, env `BUZZ_RELAY_URL` from the Tier-1 setting. Honest note:
  connects Buzz's **agent dev-tools** today; comms tools flow in automatically when available.
- Surface Buzz as an **ARD resource** (`application/mcp-server+json`) via `ArdInstaller` → disabled
  `McpServerConfig` through the normal MCP trust gate. Only publish an Agent Finder that points at a
  **verified** Buzz `ai-catalog.json`; do not point at an unverified URL.
- **Boundary note:** the starter connects Buzz's identity/comms surface. `buzz-dev-mcp`'s shell/file-edit
  tools are a Buzz-side agent surface, **not** AtlasMind's executor — AtlasMind keeps executing on its own
  skills/tools (see the governing contract). Present the starter as a comms/identity connector, not a tool host.

**Entry criteria:** Tier 1 merged; a real Buzz install available to validate the starter command on PATH.

---

## Tier 3 — Two-way sync (inbound)

**Goal:** Buzz activity becomes AtlasMind work items.

- A `BuzzClient` core service (built on `buzz-sdk`, subscribes over the relay WS) reads channel
  messages, `@mentions`, and thread activity.
- **Presence has two halves — don't confuse them.**
  - **OS-presence half (shipped, general):** `atlasmind.presence.keepAwake` (+ `keepDisplayAwake`,
    `acPowerOnly`, `maxAwakeMinutes`) keeps the *machine* awake so a connected Buzz presence isn't
    killed by system sleep. It lives in the cross-cutting `PresenceManager` core service — **not** in
    `buzz.*` — because Mission Loop and Remote Control need the exact same wake lock. When a live
    `BuzzClient` subscription exists, it registers a keep-awake reason (`hold('buzz')` / `release('buzz')`),
    deny-by-default (only effective if the user enabled `presence.keepAwake`). Keeping the box awake is
    **necessary but not sufficient** for "stays in contact."
  - **Connection-presence half (still owed at Tier 3):** the wake lock does nothing if the WebSocket
    silently drops. `BuzzClient` must additionally provide: (1) a **heartbeat/keep-alive** with a
    liveness timeout; (2) **exponential-backoff auto-reconnect** (jittered, capped, re-running NIP-42
    auth); (3) **presence re-announce** — re-subscribe tracked filters and re-announce the agent after
    every reconnect. Only with **both** halves is the agent genuinely staying in contact.
- **Derive, don't mirror.** Map inbound events → `FollowUp` / `Assignment` / Director history (and,
  opt-in, Planner tasks / `ProjectRunHistory`), each keeping a **pointer back to the Buzz thread**.
  Raw conversation history is **never** copied into SSOT — Buzz stays the message system-of-record.
- Inbound activity may **trigger** an AtlasMind run (reasoning/execution stays in AtlasMind); Buzz
  never runs the task.
- Deny-by-default: read-only subscription first; any auto-creation of work items behind an explicit
  toggle; all inbound content passes the sanitize + redaction boundary.

**Entry criteria:** Tier-1b live send working; `buzz-sdk` event/filter schema verified; relay auth
(NIP-42) validated end-to-end.

---

## Tier 4 — Self-sovereign agent identities & A2A

**Goal:** AtlasMind's orchestrated agents get their own Buzz Nostr keypairs, sign their own work,
and coordinate in channels with a full, human-attributable audit trail.

- **Buzz owns identity; AtlasMind only custodies a secret.** Buzz/Nostr owns keypair issuance,
  signature verification, and the authorship ledger. AtlasMind generates the agent's keypair *on the
  agent's behalf*, stores the secret in `SecretStorage` (never in config/SSOT), and *records* the
  human→agent authorization as a **narrowly-scoped, revocable** grant in the Director audit trail. It
  does not become a directory or identity issuer.
- Orchestrator hands off between agents via signed Buzz messages (or `buzz-acp`); each action is
  traceable to the authorizing human (aligns with Director's consent + audit posture).
- Revocation UX: revoke a leaked agent key without touching the human identity.

**Entry criteria:** Tiers 1–3 stable; a threat-model + security review of key custody, scope grants,
and revocation; explicit opt-in. This is a MAJOR-version-class change (new secret material + identity model).

---

## Cross-cutting safety invariants (inherit for every tier)

- **Deny-by-default:** `enabled:false`, `allowRemoteRelay:false`, disabled MCP/ARD seeds, `outboundEnabled:false`.
- **Sanitize-at-boundary:** all Buzz input (inbound events, handles, deep links) through the existing
  sanitizers; scheme allowlist for any launchable link; no unverified native URI scheme.
- **Confirm before external action:** every real outbound send keeps the `{modal:true}` gate + audit record.
- **Redaction boundary:** remote relay ⇒ off-machine ⇒ redact secrets/sensitive project data before send.
- **Never guess an external API:** live protocol code lands only against a verified, pinned Buzz schema.
- **Treat Buzz as unstable:** it is days old; keep everything behind opt-in flags and version-check on connect.

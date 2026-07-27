# Buzz (buzz.xyz) Integration — Phased Roadmap

> **Status:** Tier 1b implementation complete; a real-relay smoke test remains before the live-send
> gate is closed. Tier 2 guided connector shipped and ARD discovery still planned. Tier 3's
> protocol/policy/derivation **foundation** shipped (v0.147.0) and its `BuzzClient` subscription
> (v0.148.0); Schnorr signing, real-relay validation, and wiring remain — see the Tier-3 logs.
> Tier 4 planned.
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
| `buzz-cli` | **Agent-first CLI, JSON in / JSON out**, auth via `BUZZ_PRIVATE_KEY`, relay via `BUZZ_RELAY_URL`. AtlasMind pins source tag v0.4.26 and its published `channels list`, `messages send`, `messages thread`, and `dms open` contracts. | The verified programmatic **comms** surface (post/DM/channels). Upstream v0.4.26 has no working `--version` flag, so AtlasMind probes every required command/flag contract before connecting and fails closed on incompatibility. |
| `buzz-dev-mcp` | An **MCP server** shipping shell + file-edit tools. **No comms tools.** | Connectable today via AtlasMind's MCP registry, but gives agent dev-tools, *not* messaging. |
| AtlasMind Buzz comms MCP | Bundled stdio MCP server wrapping only the pinned `buzz-cli` communication commands. | Gives Director a normal MCP capability surface without exposing Buzz shell, file-edit, workflow, repo, or admin operations. |
| `buzz-sdk` / `buzz-core` | TypeScript typed event builders + protocol types / NIP-01 filters. | Cleanest path for a first-class in-extension `BuzzClient` (Tier 3/4), since AtlasMind is TS. |
| `buzz-acp` / `buzz-agent` | ACP (Agent Client Protocol) harness — **already supports Claude Code**, Goose, Codex. | A2A / self-sovereign agent identities (Tier 4). |
| `buzz-workflow` / `buzz-persona` | YAML automation; agent persona packs. | Project-management automation (Tier 2/3). |

**Key constraint that shapes the plan:** Buzz has **no upstream comms-capable MCP server today**.
AtlasMind therefore ships a narrow communication-only wrapper around the verified, pinned
`buzz-cli` v0.4.26 contract. It deliberately excludes the `buzz-dev-mcp` execution surface.
Deep links remain the fallback when the connector is disabled or unavailable.

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

## Tier 1 — Foundation, recognized connector, and live outbound  *(smoke test pending)*

**Goal:** Buzz is a first-class, configurable, deny-by-default citizen of the existing Director +
comms machinery, with zero speculative protocol code.

**Tier 1a foundation:**
- `buzz` added to `CommunicationChannelKind` (`src/types.ts`) — Director contacts can carry a Buzz identity (npub / @handle / #channel) and an optional Buzz web deep link.
- Buzz option in the contact-link editor + an `https`-only deep-link builder (`media/projectDashboard.js`), reusing the existing scheme allowlist (no new native scheme added — safety-first).
- `directorCommsRunner.ts` `INTENT_PATTERNS` recognizes Buzz-style comms tool names (`post_to_channel`, `send_dm`, `direct_message`, `buzz_*`) as the `message` intent.
- Settings (deny-by-default): `atlasmind.buzz.enabled` (`false`), `atlasmind.buzz.relayUrl` (`ws://localhost:3000`), `atlasmind.buzz.allowRemoteRelay` (`false`).

**Tier 1b live outbound communications:**
- A thin, isolated `BuzzCliBridge` pins and verifies official `buzz-cli` v0.4.26, centralizing the
  exact channel-list, post, bounded-thread-read, and DM command construction.
- A bundled stdio MCP server exposes only `buzz_list_channels`, `buzz_post_message`,
  `buzz_read_thread`, and `buzz_send_dm`. It never exposes Buzz shell, file-edit, workflow,
  repository, or administration tools.
- The bridge runs the configured binary directly (`shell:false`), passes message bodies through
  stdin, bounds duration/output/message size, validates identifiers and JSON responses, and
  redacts keys and authorization tags from failures.
- Relay policy is enforced at the process boundary: loopback is the default, remote relays require
  explicit opt-in and TLS, and Desktop-style `ws(s)` URLs are normalized to the HTTP(S) base the
  pinned CLI accepts.
- Director comms routing now matches the selected contact-link provider. Buzz channel UUIDs route
  to channel posts and 64-character public keys route to DMs; Slack or Teams cannot receive a Buzz
  recipient by capability-ranking accident.

**Remaining completion check:** run one channel post, thread read, and DM against a disposable
identity on a real Buzz v0.4.26 installation. The local development machine did not have `buzz` on
PATH, so unit/contract/package verification is complete but the external relay smoke test is not.

**Reuse map:** `handleDirectorSendComms` + the `{modal:true}` auth gate + the `outboundEnabled`
project flag + `handleOpenContactDeepLink` + `ALLOWED_DEEPLINK_SCHEMES` +
`sanitizeProjectDirectorConfig` remain the guarded send/deep-link path.

---

## Tier 2 — ARD discoverability + guided connector  *(partially complete)*

**Goal:** Buzz is discoverable and one-click connectable, disabled-by-default.

- **Shipped:** a curated **Buzz Communications** starter in the guided-setup catalogue
  (`RECOMMENDED_MCP_SERVER_CATALOGUE` + `getRecommendedMcpStarterDetails`, `src/constants.ts`),
  under `Collaboration`. It launches AtlasMind's bundled comms bridge, stores `BUZZ_PRIVATE_KEY`
  and optional `BUZZ_AUTH_TAG` in SecretStorage, and resolves the relay/consent settings at launch.
- Surface Buzz as an **ARD resource** (`application/mcp-server+json`) via `ArdInstaller` → disabled
  `McpServerConfig` through the normal MCP trust gate. Only publish an Agent Finder that points at a
  **verified** Buzz `ai-catalog.json`; do not point at an unverified URL.
- **Boundary note:** the starter connects only Buzz's identity/comms surface. `buzz-dev-mcp`'s
  shell/file-edit tools are a Buzz-side agent surface, **not** AtlasMind's executor — AtlasMind
  keeps executing on its own skills/tools (see the governing contract).

**Remaining Tier 2 gate:** verify and publish only a real Buzz Agent Finder/catalog endpoint; keep
the discovered server disabled until it passes the normal MCP trust gate.

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

### Tier-3 verification log (2026-07-27, v0.147.0) — foundation shipped, socket still owed

**The key realisation:** Buzz's transport is **not a Buzz invention**. Buzz is Nostr-based, so
NIP-01 (events, `REQ`/`EVENT`/`EOSE`/`CLOSED` framing, filters) and NIP-42 (relay auth) are
*published open specifications*. Verifying them against `nostr-protocol/nips` is exactly as legitimate
as verifying `buzz-cli` against its Cargo.toml — no live relay needed. Only the *integration* is
relay-blocked, not the protocol layer.

| Fact | Source | Value |
|---|---|---|
| Event object + client/relay frames | `nips/01.md` | `["REQ", <subId>, <filter>…]`, `["EVENT", <subId>, <event>]`, `["OK", <id>, <bool>, <msg>]`, `["EOSE", <subId>]`, `["CLOSED", <subId>, <msg>]`, `["NOTICE", <msg>]` |
| Relay auth | `nips/42.md` | Relay sends `["AUTH", <challenge>]`; client replies with a signed **kind 22242** event with `relay` + `challenge` tags. Refusals prefixed `auth-required:` / `restricted:` |
| Event kinds | `crates/buzz-core/src/kind.rs` @ `v0.4.26` | channel message **40002**, edit **40003**, system **40099**, channel metadata **39000**, thread summary **39005**, auth **22242**, jobs **43001–43006** |
| Filter gotcha | `AGENTS.md` @ `v0.4.26` | "Relay queries must specify `kinds` — omitting `kinds` triggers the p-gate (403)" |

Note the kind registry was read at **the same pinned tag (`v0.4.26`) the Tier-1b CLI bridge uses**, so
the inbound and outbound halves are pinned together and move together.

**Traps found and encoded (each would have been a silent, confusing bug):**
- **Channel metadata is 39000, not 41.** Kind 41 *does* exist in the registry as legacy NIP-01 channel
  metadata — the plausible-looking wrong answer. `AGENTS.md` calls this out explicitly.
- **A channel message is 40002, not 9 or 10002.** `KIND_STREAM_MESSAGE = 9` (plain NIP-29) and V1's
  10002 both exist; `KIND_STREAM_MESSAGE_V2 = 40002` is current. Subscribing to the wrong one yields
  a connection that works and receives nothing.
- **A kind-less filter is a 403, not an empty result.** So `NostrFilter.kinds` is required non-empty
  *by type*, and `buildSubscriptionFrame` refuses to build one.

Both kind traps are pinned by assertions in `tests/core/buzzProtocol.test.ts` so a later edit cannot
regress them quietly.

**Shipped (all pure, `vscode`-free, unit-tested — 69 tests):**
- `buzzProtocol.ts` — framing, parsing, filters, NIP-42 templates, event validation. Untrusted-input
  boundary: never throws; explicitly does **not** verify signatures (relay's job under NIP-42), so
  structural validity is never confused with authenticity.
- `buzzConnectionPolicy.ts` — the **connection-presence half** the tier explicitly owed. Clock-free,
  so it is deterministically testable with no timers. Notable decisions: `dead` only after an
  *unanswered ping* (idleness alone is not death — a quiet channel is not a broken socket); jitter is
  **subtractive** so the backoff cap actually holds; a `restricted:` refusal **stops** rather than
  retries; the resume cursor rewinds by an overlap, preferring a de-duplicated duplicate over a
  silently dropped message.
- `buzzInboundDerivation.ts` — the **derive-don't-mirror** boundary. Event → `FollowUp` + thread
  pointer; the body is never stored (the derived record has no content field at all). This is a
  privacy boundary: SSOT is git-tracked, so mirroring a channel would commit colleagues' chat into
  the repo.

### Tier-3 subscription log (2026-07-27, v0.148.0) — `BuzzClient` shipped

Item 1 below is now done. The prediction that it needed a relay was wrong: with an **injectable
socket factory**, the state machine is fully testable without one, and `ws` was **already an AtlasMind
dependency**, so inbound sync added none.

**Shipped:**
- `buzzClient.ts` — the state machine: connect → authenticate → subscribe → receive → drop → back off
  → resume. It drives the three foundation modules and owns nothing else (parses no frames, invents
  no delays, stores no conversation). Transport-agnostic via `BuzzSocketFactory`, so it imports
  neither `ws` nor `vscode`.
- `buzzSocket.ts` — the real `ws` adapter, isolated so the client stays dependency-free.
  `toWebSocketUrl` maps the CLI-style `http(s)` relay base onto `ws(s)`, so **one `relayUrl` setting
  serves both the outbound CLI bridge and the inbound socket** — the two halves can't drift.
- **35 tests: 26 unit (fake socket, injected clock — no timers, fully deterministic) + 9 integration
  against a real in-process WebSocket server.** The integration layer covers what a fake cannot: the
  genuine handshake, `ws`'s Buffer→string delivery, real ping/pong, a real NIP-42 exchange, and a
  **hard TCP drop with no closing handshake** (the client notices via keep-alive and reconnects with
  the rewound cursor).

**Findings worth keeping:**
- The first test run failed because the fixtures used `'p'.repeat(64)` as a pubkey and
  `'s'.repeat(128)` as a signature — **neither is hex**. `validateNostrEvent` correctly rejected them.
  A reassuring failure: the untrusted-input boundary caught bad data written by its own author.
- **Read-only is now structural, not just intended.** The client sends only `REQ`/`CLOSE`/`AUTH`/pings
  and never an `EVENT`, and a test asserts it — so the read path cannot silently become a write path.

### Real-relay probe result (2026-07-27, local Buzz relay) — **signing is REQUIRED**

Ran the real `BuzzClient` against Joel's local Buzz relay (`ws://localhost:3000`, channel
`443a7fd2-…`). Two results, both decisive:

**1. The relay demands NIP-42 auth before it will serve a subscription.**

```
auth-required: authenticate before subscribing
```

So Schnorr signing is **not optional** — inbound cannot function against a real Buzz relay without
it. This closes the open question and makes the `@noble/curves` decision a prerequisite rather than a
nice-to-have. The client behaved exactly as designed: it refused to retry and stopped with the reason.

Two protocol details learned that the spec alone did not give us:
- The relay delivers `auth-required:` in a **`NOTICE`** frame (and again on `CLOSED`), not only on
  `OK`/`CLOSED` as NIP-42 describes. `classifyRelayRefusal` already handles the prefix wherever it
  appears, so no change was needed — but note it for the signing work.
- Because auth intercepts everything, the **p-gate test was inconclusive**: the kind-less filter was
  refused for auth, not for missing `kinds`. That constraint is still only verified from `AGENTS.md`.
  Re-run the probe after signing lands to confirm it independently.

**2. A real bug the unit tests missed (fixed in v0.148.1).** The status trace showed
`stopped → authenticating → stopped`: frames arriving *after* `stop()` were still handled, so a
repeated `auth-required` restarted the auth path the client had just terminated on, and the terminal
error was reported twice. A stopped client is now inert. Lesson: the fake-socket tests never delivered
a frame after stopping — the real relay found it in one run. Regression tests added for both the
inert-after-stop behaviour and the report-once behaviour.

**Still unverified** (auth blocked them): the `h`-tag channel-scoping assumption and that kind 40002
actually delivers channel messages. Both re-test as soon as signing works.

**Still owed for Tier 3:**
1. **Schnorr signing** for the NIP-42 auth event. **Now confirmed blocking — see the probe result above.** `buildAuthEventTemplate` returns an *unsigned*
   template and `BuzzEventSigner` is the seam; with no signer, an authenticating relay yields a typed,
   explained stop rather than a loop. Filling it needs a secp256k1 backend — `@noble/curves` is the
   audited, zero-dependency standard (what `nostr-tools` itself uses). **This is a dependency decision
   in a security-sensitive path and deserves its own reviewable change.**
2. **Validation against a real Buzz relay.** The integration tests run against a NIP-01-shaped
   stand-in, not Buzz — so relay-specific behaviour (the p-gate, real auth, and the `h`-tag
   channel-scoping assumption the derivation layer makes) is still unconfirmed. Share the Tier-1b
   smoke test.
3. **Wiring:** the deny-by-default inbound toggle, `hold('buzz')`/`release('buzz')` against
   `PresenceManager` while a subscription is live, and persisting derived follow-ups.

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

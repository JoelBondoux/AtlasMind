# Buzz (buzz.xyz) Integration — Phased Roadmap

> **Status:** Tier 1b implementation complete; a real-relay smoke test remains before the live-send
> gate is closed. Tier 2 guided connector shipped and ARD discovery still planned. Tier 3's
> protocol/policy/derivation **foundation** shipped (v0.147.0) and its `BuzzClient` subscription
> (v0.148.0), NIP-42 Schnorr signing (v0.149.0), **real-relay validation (v0.149.2 — which caught a
> wrong message kind)**, and the wiring + agent bindings (v0.150.0). **Tier 3 is complete and
> switchable-on.** Tier 4 reciprocal ACP transport shipped in v0.238.0; per-agent key generation,
> authorization grants, signed A2A handoff, and revocation remain planned. Tier 5 — Director-
> recommended, orchestration-backed Buzz persona teams — is specified below and remains planned.
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

### Signing shipped (2026-07-27, v0.149.0)

`buzzSigner.ts` fills the `BuzzEventSigner` seam. Decisions worth keeping:

- **`@noble/secp256k1`, not `@noble/curves`.** 170 KB with zero transitive deps versus 1.87 MB plus an
  889 KB dependency, for the single curve Nostr uses. The earlier recommendation of `@noble/curves`
  was wrong on size; measuring first changed it.
- **Bundled, not downloaded on demand.** An on-demand installer was considered (the
  `LocalTranscriber` pattern) but rejected: fetching *crypto* at runtime is a worse supply-chain
  posture than a lockfile-pinned dependency, adds offline/npm/proxy failure modes, and is more code
  than the 184 KB it would avoid shipping. The "only when called upon" property is kept via **lazy
  import** instead — nothing loads until the first signature.
- **ESM/CJS trap.** The package is ESM-only and `require(esm)` throws before Node 22.12, which the
  VS Code extension host can be. A plain `await import()` is downlevelled to `require()` by the CJS
  emit, so the import is built through `Function` to survive transpilation, with a `require` fallback
  for hosts (notably the test runner) that can't resolve a bare specifier that way.
- **bech32 implemented in-repo** rather than adding `@scure/base` — it is a checksummed encoding, not
  crypto, and it is cross-validated in tests against the published **NIP-19 nsec/npub vector pair**
  (decode one, derive the other, both must match the spec).

**Hosted relays changed the landscape (v0.149.0).** Buzz need not be local. That exposed an asymmetry:
the outbound `BuzzCliBridge` required remote relays to be HTTPS/WSS, but the inbound transport did
not — `buzzConnector.ts` (which had the relay gate) was dropped when this branch was rebased. Fixed
in `buzzSocket.toWebSocketUrl`, which now refuses a plaintext socket to any non-loopback host. Placed
at the **transport** rather than in a policy caller so future wiring cannot reintroduce it.

### Real-relay validation, round 2 (2026-07-28, v0.149.2) — **a wrong kind, caught**

With signing working, the probe finally reached the data path. Three results:

**1. NIP-42 signing is validated end-to-end.** The relay issued a challenge, accepted the signed
kind-22242 event, and served the subscription (reached EOSE). Tier 3's auth half is proven against
real Buzz, not a stand-in.

**2. The channel-message kind was WRONG — and would have failed silently.** Asking the relay what it
actually stores returned:

| kind | count | tags |
|---|---|---|
| 40099 (system message) | 8 | `h` |
| **9 (channel message)** | **5** | `h`, `p`, `client` |
| 39000 (channel metadata) | 4 | `d`, `name`, `about`, `public`, `closed`, `t`, `private` |
| 20001 (presence) | 1 | — |

**Zero kind-40002 events.** `buzz-core/src/kind.rs` defines both `KIND_STREAM_MESSAGE = 9` and
`KIND_STREAM_MESSAGE_V2 = 40002`, with a comment implying V2 supersedes it — reading the source, 40002
is the obvious answer. It is also the wrong one for this deployment. **This is the exact trap the
Tier-3 log warned about, and I walked into it anyway**, then wrote a test asserting
`channelMessage !== 9` that encoded the mistaken inference as if it were verified fact.

The failure mode is the nastiest kind: the client authenticates, subscribes, reaches EOSE, and reports
itself perfectly healthy while receiving **nothing, forever**. No error, no warning, no retry — just
silence that looks like a quiet channel.

**Fix:** both kinds are subscribed and derived, so either deployment works. The corrected test now
asserts kind 9 *and* records why the earlier assertion was wrong.

**3. Two assumptions confirmed.** The `h` tag does scope messages to a channel (present on every kind-9
event), and 39000 is channel metadata. Both were previously unverified.

**Lesson for the remaining tiers:** reading a registry tells you what kinds *exist*, not which one a
deployment *uses*. Ask the relay. `--discover` in the probe does exactly this and should be re-run
against any new Buzz version before trusting a kind number.

### Tier 3 wiring + agent bindings (2026-07-28, v0.150.0) — **Tier 3 complete**

`BuzzInboundService` connects the verified modules to the editor: settings, the agent key from
SecretStorage, the `hold('buzz')`/`release('buzz')` wake lock, and follow-up persistence. `sync()`
reconciles on any `atlasmind.buzz.*` change.

**Three gates, all deny-by-default** — deliberately more than the roadmap's minimum:
1. `buzz.enabled` — the Tier-1 master switch.
2. `buzz.inboundEnabled` — subscribe at all.
3. `buzz.autoCreateFollowUps` — *record* what arrives. Separate on purpose: `project_memory/` is
   git-tracked, so a network event writing into it is a decision to make, not one to inherit from an
   upgrade. While off, inbound activity is reported and not persisted.

**New: AtlasMind agents ↔ Buzz agents** (`atlasmind.buzz.agentBindings`, requested by the owner).
Maps a Buzz identity to an AtlasMind agent id so inbound work lands with the right specialist.
Deliberate design choices:
- **A local routing preference, not identity.** Buzz keeps the keypair, the directory, and the
  authorship ledger — this stays on AtlasMind's side of the governing contract, and is emphatically
  *not* a step toward becoming a directory (that would violate the Tier-4 boundary too).
- `npub`/hex both accepted and normalised through the already-verified bech32 decoder, so the forms
  are interchangeable. A **mistyped npub is rejected** rather than normalising to a different
  identity — silently routing work to the wrong agent is worse than failing. An `nsec` pasted where a
  public key belongs is refused by name.
- Unusable bindings are **reported**, never dropped silently; an unbound author stays **unassigned**
  rather than being guessed at.

**Follow-ups merge by an id derived from the event**, so the deliberate reconnect replay overlap and
repeat sightings update nothing rather than duplicating, with a per-batch cap.

**Remaining across the whole integration:**
- Tier 1b's real-relay **smoke test for outbound** (Joel's, still open).
- Tier 2's **ARD Agent Finder** — still blocked on whether Buzz publishes a verifiable
  `ai-catalog.json`.
- The **p-gate** remains confirmed only indirectly: auth intercepts a kind-less query before the gate
  can answer. Re-run `--discover` on a relay without auth to close it.
- **Tier 4 identity half** (agent keypairs, signed A2A handoffs, revocation) — unstarted, and gated
  on a threat model + security review. The reciprocal ACP transport shipped in v0.238.0: Buzz can
  launch AtlasMind as a managed Custom-command agent and AtlasMind can reply through validated Buzz
  context. The new agent bindings remain a *natural stepping stone*: they already express "this
  AtlasMind agent corresponds to that Buzz identity", which the remaining work would extend from a
  reference into a custodied keypair and revocable grant.

**Still owed for Tier 3:**
1. ~~**Schnorr signing**~~ — **done in v0.149.0.** `buildAuthEventTemplate` returns an *unsigned*
   template and `BuzzEventSigner` is the seam; with no signer, an authenticating relay yields a typed,
   explained stop rather than a loop. Filling it needs a secp256k1 backend — `@noble/curves` is the
   audited, zero-dependency standard (what `nostr-tools` itself uses). **This is a dependency decision
   in a security-sensitive path and deserves its own reviewable change.**
2. ~~**Validation against a real Buzz relay.**~~ **Done (v0.149.2)** — auth, the `h`-tag scoping
   assumption, and the message kind are all now verified against a live relay. The p-gate remains
   confirmed only indirectly (auth intercepts a kind-less query before the gate can answer).
3. **Wiring:** the deny-by-default inbound toggle, `hold('buzz')`/`release('buzz')` against
   `PresenceManager` while a subscription is live, and persisting derived follow-ups.

### Buzz UI + identity picker (2026-07-28, v0.151.0 → v0.152.0)

Everything in Tier 3 was reachable only by hand-editing `settings.json`. Three passes closed that,
and two of them were fixing my own defects.

**v0.151.0 — Settings → Buzz page + agent binding in the Director person form.**
Both write through one pure helper (`writeAgentBinding`), so a click is validated exactly like a
hand-edit. `atlasmind.buzz.agentBindings` stays the single source of truth; the roster edits it
rather than shadowing it.

**v0.151.1 — Windows CI.** A new assertion pinned `\n` inside a multi-line source substring, so it
could never match a CRLF checkout. The assertion was wrong, not the code.

**v0.151.2 — two reported defects, one much worse than it looked.**
`isSettingsMessage` is a runtime allowlist and `handleMessage` returns early on anything it does not
recognise. The new message types were added to the union and to the switch but **not to the guard**,
so every one was dropped before reaching its case: the whole Settings → Buzz page was inert, with
switches that appeared to toggle while nothing was ever written. It type-checked and linted
throughout. The source-grep tests could not have caught it — the message type was present in the
file exactly as expected. Replaced with tests that **call the guard**.
Second defect: the agent picker's `hidden` attribute did nothing, because the row is a
`.stage-edit-grid` and that author rule's `display: grid` outranks the UA rule for `[hidden]`.

**v0.152.0 — the identity picker, and a fourth relay verification.**

Question asked: *can the Handle be derived automatically?* Answer, precisely:

- **From a person's name: no, and never.** There is no function from "Jane Doe" to a public key.
  A constructed key would be plausible and would belong to a **different real person**.
- **From observed activity: yes.** Every inbound event already carried `authorPubkey`; it just went
  nowhere. `BuzzDirectory` now records it.
- **From the MCP bridge: no.** Its four tools are list-channels / post / read-thread / send-DM —
  no directory or user lookup. Worth recording so this isn't re-investigated.
- **Your own handle: yes, trivially** — `deriveBuzzPublicKey` computes it from the key already in
  SecretStorage. The one handle that never needed a lookup.

**Relay verification (`--profiles`), the fourth time evidence beat inference.** A picker of raw hex
is nearly useless, so it needed names. Nostr's kind 0 would give them — but kind 0 is **absent from
Buzz's kind registry**, making "does a Buzz relay serve it?" exactly the question that produced the
kind-9/40002 mistake. Probed rather than assumed:

```
10. distinct authors observed — 2 identities seen
11. kind 0 profile metadata is served — 2 of 2 author(s) have a profile
12. a usable display name is present — fields available: display_name, about
```

Verdict: **kind 0 is served, `display_name` is the field.** Only then was it added to `BUZZ_KIND` —
and deliberately excluded from `BUZZ_INBOUND_KINDS`, because a profile is not work.

Design notes worth keeping:
- Names are **untrusted remote text** rendered in AtlasMind's UI: redacted, control-stripped and
  clamped **on the way in**, never on the way out where one missed call site is a hole.
- The roster is **never persisted** — who spoke and when is exactly what git-tracked `project_memory/`
  must not accumulate.
- Profile lookups are author-scoped (a kind-0 filter with no `authors` pulls every profile on the
  relay), capped, debounced, and re-issue the message filter alongside so inbound work never stops.
  They reuse the authenticated connection rather than opening a second one.
- `BuzzClient.onEvent` is kept separate from `onWorkItems`, so widening what is *observed* can never
  widen what becomes a follow-up.

### Guided setup (2026-07-28, v0.153.0)

Setting Buzz up touches five unrelated places — a CLI binary, a secret, two settings, an MCP server,
and a relay — and getting one wrong fails at the far end, usually as a subscription that connects and
then silently receives nothing. `/buzz` turns that into an ordered checklist derived from observed
state, and `buzz` is now in the environment scanner's PATH probe so a missing CLI is reported during
setup rather than discovered as a failed send.

Two properties held deliberately, both pinned by tests:

- **A plan, never an installer.** Every action *opens a surface*; nothing enables a gate, writes a
  setting, stores a secret, or connects anything. Buzz is deny-by-default in three places precisely
  so that turning it on is a human decision — an assistant that flipped those switches to be helpful
  would remove the property they exist to provide. The action allowlist is asserted.
- **Derived, not model-generated.** A hallucinated setup step sends someone to configure something
  that does not exist and leaves them trusting a broken result.

One bug worth recording: `nextBuzzSetupStep` initially fell back to *any* blocked step, so with
reading fully configured it nominated the MCP bridge — blocked only by the optional CLI. It now
scopes to the required steps. Sending someone off to install a binary they never need is worse than
saying nothing.

**Still owed:** MCP setup is `prefill` (guided) — AtlasMind pre-fills command, args, and env, and
wires the relay URL and both gates through `${config:atlasmind.buzz.*}`, but installing the CLI
binary itself remains manual, and the bridge exposes no directory lookup (list-channels / post /
read-thread / send-DM only).

---

## Tier 4 — Self-sovereign agent identities & A2A

**Status:** reciprocal `buzz-acp` → `atlasmind-acp` execution and reply transport shipped v0.238.0.
The identity/key-custody/grant/revocation work below remains planned.

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

## Tier 5 — Director-recommended Buzz persona teams

**Status:** planned. This section is the implementation contract for future agents.

**Goal:** expose a small, comprehensible AtlasMind team in Buzz — for example **AM Engineer**,
**AM Business**, **AM Marketing**, and **AM Oversight** — without publishing every internal
`AgentDefinition` as a separate Buzz identity. Each Buzz-facing persona owns a scoped collection of
AtlasMind agents and uses AtlasMind's classifier, model router, memory, skills, approvals, and handoffs
inside that collection. One AtlasMind agent may belong to several personas.

This supersedes the earlier assumption that the current Director **Buzz Identity** editor could grow
into this feature. That editor binds an *inbound author* to likely work owners. A runnable Buzz persona
is the reverse direction: a Buzz-managed identity launches AtlasMind and AtlasMind chooses a worker.
They are different facts, with different stores and failure modes, and must remain different models.

### Product contract

- Director recommends Buzz personas from the project's **enabled** agent registry; it never creates
  one merely because an agent was discovered.
- A recommendation is deterministic and explainable: the card names every included agent, the rule
  that included it, capability coverage, gaps, conflicts, suggested response mode, and permission
  ceiling. No model call decides the team.
- The user may accept, edit, or dismiss a recommendation. Accepting creates project intent, not a
  Buzz key or a running process.
- Several AtlasMind agents may form one Buzz persona, and the same AtlasMind agent may participate in
  several personas. Membership is therefore many-to-many.
- Each Buzz persona remains one stable signed author in Buzz even when different internal agents
  handle consecutive turns. Director records which internal agent, model, and skills handled each
  turn.
- Exactly one persona may be the default for a channel; the others are mention-only or oversight.
  An explicit mention wins over the default and must produce exactly one response.
- Project switching is an explicit channel/deployment action. Chat text never becomes a raw
  filesystem path or silently rebinds a shared channel.

### Four records, four owners

| Record | Owner / store | Contains | Must not contain |
|---|---|---|---|
| Project persona intent | `.atlasmind/buzz-agents.json`, versioned and project-owned | Persona id/name/purpose, member agent ids, preferred member, routing mode, independence class, skill ceiling | Buzz private keys, workspace paths, provider credentials, channel history |
| Local deployment | VS Code workspace state | Persona id → Buzz public key, channel response modes, manifest fingerprint, verification/status timestamps | Secret keys, model prompts, raw messages |
| Runtime persona manifest | AtlasMind extension-owned local storage | Sanitised snapshots of the referenced agent definitions plus a canonical fingerprint | Unrelated agents, provider credentials, Buzz private keys |
| Buzz identity | Buzz managed-agent store | Nostr keypair, signed identity, channel membership, harness configuration | AtlasMind project memory or orchestration state |

The project declaration is shared intent. Deployment is local because it names a local running setup.
The manifest bridges VS Code's live registry into the standalone ACP process: today Director can see
user-created agents held by the extension, while `atlasmind-acp` creates a fresh headless runtime that
loads only built-ins. Without the manifest, Director could recommend a team the Buzz-launched process
cannot run.

Proposed project shape:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "am-engineer",
      "displayName": "AM Engineer",
      "purpose": "Engineering delivery for this project",
      "agentIds": ["backend-engineer", "frontend-engineer", "workspace-debugger", "code-reviewer"],
      "preferredAgentId": "backend-engineer",
      "routingMode": "scoped-orchestration",
      "independenceClass": "execution",
      "skillCeiling": { "mode": "member" }
    }
  ]
}
```

The shape is illustrative until Phase 1 lands. Its semantic decisions are not: ids are stable,
membership is explicit, unknown fields/newer versions are preserved or refused through
`schemaMigration`, and the file contains intent rather than live identity state.

### Recommendation rules

Add a pure `buzzAgentRecommendations` rule table. Use `primaryRoutingNeeds` as the strongest signal,
then declared skills, testing responsibilities, role/description tokens, enabled state, and explicit
advisory/read-only status. Initial families:

1. **AM Engineering** — architecture, frontend, backend, debugging, testing, review, security,
   DevOps, release, and documentation agents relevant to delivery.
2. **AM Business/Product** — product, requirements, planning, commercial, finance, and applicable
   research agents.
3. **AM Marketing/Growth** — marketing, positioning, content, SEO, analytics, customer and market
   research agents.
4. **AM Research** — external research specialists where a separate research identity adds value.
5. **AM Oversight** — ethics, legal, commercial, security, risk, and review specialists under a
   read-only ceiling.
6. **AM Coordinator** — optional only when the registry has several distinct families and the user
   wants one front door.

An agent may score into several families. That is intended, not a conflict. Separation-of-duty rules
are different: oversight agents are never silently folded into an execution persona, and accepting a
mixed group must state the loss of independence. Recommendations carry a stable ruleset version and
agent-registry fingerprint so Director can explain why one changed.

### Scoped orchestration contract

The current ACP facade resolves registry agent `default` and calls `processTaskWithAgent`, bypassing
normal selection. Replace that path for persona deployments with a typed orchestrator entry point,
for example `processTaskInScope(request, scope, callbacks)`. `scope` is host-owned data, never prompt
context, and contains:

- allowed agent ids;
- preferred fallback id;
- skill ceiling;
- allowed handoff ids;
- synthesis policy (disabled for v1);
- persona id; and
- host-delivery policy (`buzz-acp` owns the final send).

Classification and scoring continue normally, but only over the named members. A missing preferred
member may degrade to another valid member with a visible warning; zero valid members refuses the
turn. There is no fallback to the global registry and no synthesized specialist outside the group.
`AgentHandoff` must carry the same member ceiling so a selected worker cannot escape the persona by
delegating.

The effective authority for a selected worker is:

```text
selected agent skills
  ∩ persona skill ceiling
  ∩ project policy
  ∩ tool policy
  ∩ current approval
```

`member` means keep the selected agent's own authority; it does **not** mean union the skills of every
member. `read-only` narrows every member to safe reads. `allowlist` intersects the member with explicit
skill ids. Adding an agent to a persona must never increase another member's authority.

Move the existing "the ACP host delivers the Buzz reply" instruction from the fixed default-agent
copy into a trusted turn envelope applying to every selected and delegated worker. Buzz messaging
tools are unavailable for final delivery; the host validates Buzz's generated context and publishes
one response through the existing communication-only bridge.

### Default and colleague routing

Buzz's current harness listens for `@mention`s by default. It supports an inbound author gate
(`owner-only`, `allowlist`, `anyone`, `nobody`) and per-channel `require_mention = false`, but those
pieces alone do not prove exclusive dispatch when several AM identities share a channel. Before the
UI promises **Default**, run this compatibility gate against the supported Buzz build:

1. Put two disposable AM identities in one private channel.
2. Configure AM Engineer as default and AM Marketing as mention-only.
3. Send an unaddressed message: exactly one Engineer response.
4. Mention Marketing: exactly one Marketing response and no Engineer response.
5. Send from a pubkey outside the owner/colleague allowlist: no response.
6. Restart the harness and repeat to cover replayed events.

Prefer Buzz's `allowlist` mode containing the owner plus selected colleague pubkeys. Even in a private
channel, `anyone` also widens DM handling, so channel membership alone is not the same boundary. If
Buzz's ACP prompt does not carry enough authenticated mention metadata to suppress the default on an
explicit specialist mention, keep all personas mention-only and pursue an upstream Buzz default-
routing capability. Do not turn AtlasMind's structurally read-only inbound subscription into a second
reply harness: that would duplicate delivery, key custody, replay, and loop prevention.

### Director experience

Add a dedicated **Buzz Agents** section rather than expanding the Person editor:

- **Recommended Buzz agents** — proposal cards with rationale, coverage, gaps, permission implications,
  suggested channels, and Accept / Customise / Dismiss.
- **Active Buzz identities** — actual public key, persona membership, channels, response mode,
  manifest sync state, runtime/verification health, and recent internal workers.

Relabel the existing Person-form surface as **Buzz contact / channel** and its agent checklist as
**Inbound work attribution**. It continues editing `atlasmind.buzz.agentBindings`; it does not create
or start an agent.

Accepting a recommendation opens a reviewable profile editor. Saving writes project intent. Deployment
then walks the user through:

1. select project channels and default/mention-only/oversight mode;
2. select owner/colleague pubkeys for the response allowlist;
3. generate the local persona manifest;
4. copy a persona-specific Custom-command recipe containing
   `--workspace` and `--buzz-persona-manifest` but no credential;
5. create the managed identity in Buzz and add it to the channels;
6. send a nonce-bearing verification mention; and
7. observe the signed reply before associating its public key and marking it verified.

AtlasMind never reports "created" merely because a command was copied. Agent-definition changes make
the manifest visibly stale and require an explicit **Resynchronise** action; changing a system prompt
under a running signed identity without review is not a safe convenience.

### Implementation sequence

#### Phase 0 — compatibility contract

- Verify Buzz Desktop persistence/exposure of per-channel mention rules and author allowlists.
- Verify the ACP prompt carries authenticated destination/mention metadata sufficient for exclusive
  default dispatch.
- Pin the two-agent real-relay scenario above, including Windows custom-command launch behavior.

#### Phase 1 — project model

- Add pure profile types/sanitizer/validator, versioned manager, and JSON schema.
- Enforce stable ids, bounds, many-to-many membership, one preferred member, independence classes,
  skill ceilings, missing/disabled diagnostics, and newer-document refusal.
- Opening Director never seeds the file; saving an accepted/custom profile is the first write.

#### Phase 2 — deterministic recommendations

- Implement the declared family rule table and stable explanations.
- Store dismissed recommendation state locally so "Not now" does not dirty the repository.
- Recompute when the enabled-agent fingerprint changes; never mutate an accepted profile.

#### Phase 3 — scoped orchestrator

- Add the typed persona scope and limit selection, handoff, skills, and synthesis.
- Add the host-delivery envelope and exclude model-controlled Buzz final delivery.
- Preserve ordinary `processTask` and project-executor behavior.

#### Phase 4 — manifest and ACP runtime

- Export referenced built-ins and user-created agents to a canonical, secret-free local manifest.
- Add `--buzz-persona-manifest` parsing/loading and register its sanitised definitions in the headless
  runtime before the ACP facade starts.
- Fingerprint definition changes; refuse corrupt, path-escaping, empty, or newer manifests.
- Keep the existing no-manifest recipe working as a clearly labelled legacy deployment.

#### Phase 5 — Director and setup

- Build Recommended / Active cards, profile editor, channel/default constraints, diagnostics, manifest
  resync, setup copy, and nonce verification.
- Do not place secret values, raw messages, full agent prompts, or local workspace paths in the
  dashboard snapshot.

#### Phase 6 — default routing and operational proof

- Enable default mode only after Phase 0's exclusive-dispatch contract passes for the detected Buzz
  version. Otherwise render the mode as unavailable with the exact reason.
- Exercise owner and colleague allowlists, replay, cancellation, revocation, remote TLS relay policy,
  and exactly-once host delivery.

### Required tests

- **Pure/unit:** schema migration and bounds; deterministic recommendations; overlapping membership;
  oversight separation; missing/disabled members; stable canonical fingerprints; secret exclusion;
  scoped selection/fallback; handoff confinement; permission intersection; one default per channel;
  malformed/spoofed Buzz context.
- **Integration:** recommendation → accepted profile → manifest; user-created agent loading in the
  headless runtime; one agent shared by two personas; stale-manifest detection; exactly one host-owned
  reply; workspace/manifest path containment.
- **Real Buzz:** distinct signed identities; owner/colleague allowlists; mention-only routing; default
  routing; specialist override without duplicate response; restart/replay; Windows startup; remote
  TLS; identity removal/revocation.

### Migration and compatibility

- `atlasmind.buzz.agentBindings` stays inbound attribution and is not migrated automatically.
- Director contacts and current subscription behavior remain unchanged.
- Existing ACP setup without a persona manifest continues as a legacy fixed-default deployment until
  the user deliberately adopts a profile.
- Missing referenced agents mark a profile degraded; no reference is silently deleted or replaced.
- No persona, manifest, Buzz identity, channel membership, or response gate is created on upgrade.

### Completion gate

Tier 5 is complete when a user can accept an AM Engineering recommendation, deploy it as a verified
Buzz-managed identity, share one constituent AtlasMind agent with a second persona, place both in one
project channel, designate exactly one default, and receive correctly attributed responses with no
duplicate send, no permission expansion, no project escape, and no Buzz secret stored by AtlasMind.

---

## Cross-cutting safety invariants (inherit for every tier)

- **Deny-by-default:** `enabled:false`, `allowRemoteRelay:false`, disabled MCP/ARD seeds, `outboundEnabled:false`.
- **Sanitize-at-boundary:** all Buzz input (inbound events, handles, deep links) through the existing
  sanitizers; scheme allowlist for any launchable link; no unverified native URI scheme.
- **Confirm before external action:** every real outbound send keeps the `{modal:true}` gate + audit record.
- **Redaction boundary:** remote relay ⇒ off-machine ⇒ redact secrets/sensitive project data before send.
- **Never guess an external API:** live protocol code lands only against a verified, pinned Buzz schema.
- **Treat Buzz as unstable:** it is days old; keep everything behind opt-in flags and version-check on connect.

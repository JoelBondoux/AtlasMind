# ACP (Agent Client Protocol) Integration — Phased Roadmap

> **Status:** Planned. No implementation yet. **Owner:** AtlasMind core. **Created:** 2026-07-28.
> This is the SSOT north star for integrating ACP into AtlasMind. Build incrementally,
> respecting the entry criteria between tiers. Nothing here overrides AtlasMind's
> safety-first defaults: deny-by-default, sanitize-at-boundary, confirm-before-destructive-action.

## Context — why

[ACP](https://agentclientprotocol.com) is a JSON-RPC 2.0 protocol — "LSP, but for coding agents."
A **Client** (editor/orchestrator) drives an **Agent** (Claude Code, Codex, Gemini CLI, Amp, Pi)
running as a subprocess over stdio. The client calls `initialize` → `session/new` → `session/prompt`;
the agent calls back with `session/update` (streaming text, tool-call progress, plan updates) and
`session/request_permission` (tool authorization routed *back to the client*).

AtlasMind already does a degraded version of this. `src/providers/claude-cli.ts` bridges a Claude
subscription via `claude --print`, and it is deliberately hobbled:

- `--tools ''` and `--max-turns 1` — no tools, single turn.
- The entire prompt is passed **in argv**, under a hard 26,000-char budget, because Windows caps a
  process command line at 32,767 (`CLAUDE_CLI_TOTAL_PROMPT_BUDGET`, `MAX_CLAUDE_CLI_*`).
- No streaming (`streamComplete` is not implemented), no session reuse, text-only — image
  attachments are explicitly dropped with a note.

ACP removes every one of those constraints and generalizes the pattern beyond Anthropic. The
intended outcome: AtlasMind keeps model routing, memory (SSOT), planning, cost control, and the
approval gate — and gains **subscription-backed execution capacity** across multiple vendors.

## Separation of concerns — the governing contract

**This is the load-bearing principle for every tier. Do not blur it.**

> **The ACP agent supplies execution capacity. AtlasMind supplies authorization, routing, and memory.**

| Concern | Owner | AtlasMind's role at the seam |
|---|---|---|
| **Agent runtime** — the model loop, its tool mechanics, its subscription auth | **ACP agent** | Spawns it, negotiates capabilities, reads its updates. Never re-implements or scrapes its terminal UI. |
| **Authorization** — whether a tool call is allowed to touch this workspace | **AtlasMind** | Owns it entirely. Every `session/request_permission` resolves through `toolApprovalManager` + `toolPolicy`. Never delegated, never auto-approved. |
| **Routing + cost** — which agent/model runs a task, and quota accounting | **AtlasMind** | Owns it entirely. ACP agents are routable capacity, not routing authority. |
| **Memory / SSOT** — project context, run history, checkpoints | **AtlasMind** | Owns it. Context is *supplied* to a session; the agent is never the memory store. |

**Guardrails that keep the seam clean:**
- **AtlasMind is always the ACP Client.** Until Tier 4, AtlasMind never exposes an agent surface.
- **Delegated execution is never delegated authorization.** Handing an agent a subtask (Tier 3) does
  not hand it the policy gate. An adapter is never launched in an auto-approve / bypass-permissions mode.
- **One agentic loop owns the workspace at a time.** See the double-loop hazard in Tier 3.
- **Never guess an external contract.** Launch commands, flags, and protocol versions are verified and
  **pinned** before live code lands — the same discipline `BuzzCliBridge` applies to `buzz-cli` v0.4.26.

## ACP surface — ground truth (verify per release; the ecosystem is moving fast)

| Component | What it is | Integration relevance |
|---|---|---|
| `@agentclientprotocol/sdk` | Official TypeScript SDK. Fluent `client()` / `agent()` builders registering typed handlers. TS + Rust SDKs at v1.0. | The seam AtlasMind implements. AtlasMind is TS — this is the natural path. |
| `@agentclientprotocol/claude-agent-acp` | ACP server powered by the Claude Agent SDK. Uses an existing **Claude subscription**. | **Tier 1 first target** — the direct replacement for `claude-cli`. |
| `agentclientprotocol/codex-acp` | ACP server exposing Codex CLI. **ChatGPT Plus/Pro** subscription. `CODEX_PATH` selects the binary. | Tier 2. No subscription path exists in AtlasMind today. |
| Gemini CLI | Listed as an ACP-implementing agent. **Exact launch invocation unverified — pin before use.** | Tier 2. No Google subscription path in AtlasMind today. |
| Copilot (public preview), Cursor, Goose, OpenCode, Cline, Junie, Docker cagent, Qwen Code, OpenHands, … | Broad and growing agent ecosystem. | Confirms ACP is a durable standard seam, not a Claude-specific hack. One adapter, N vendors. |
| `buzz-acp` / `buzz-agent` | Buzz's ACP harness — already supports Claude Code, Goose, Codex. | **Cross-link:** [buzz-integration.md](buzz-integration.md) Tier 4 routes A2A handoff through `buzz-acp`. Tier 4 here satisfies both. |

**Protocol methods in scope:** client→agent `initialize`, `authenticate`, `session/new`, `session/prompt`;
agent→client `session/update`, `session/request_permission`. v2 adds session list/resume/delete, a
stabilized model-config category, and MCP-over-ACP.

**Known ecosystem limitation (from Goose's ACP provider docs):** session resume/fork is not universally
supported, and session IDs do not align between client and agent telemetry. Do not design Tier 1 around
session resumption.

---

## Tier 1 — ACP-as-provider: retire the argv-bounded bridge  ✅ **SHIPPED v0.170.0**

**Goal:** ACP replaces `claude-cli` as the Claude-subscription path, with strictly more capability
and no new security surface.

- New `acp` provider adapter (`src/providers/acp.ts`) implementing the existing `ProviderAdapter`
  contract: spawn the ACP server over stdio, `session/new`, `session/prompt`, map the final text to
  `CompletionResponse`.
- **Implement `streamComplete`** by mapping `session/update` text deltas to `onTextChunk`. `claude-cli`
  cannot stream at all — this is a visible UX win, not just plumbing.
- **The argv ceiling disappears.** Prompts travel as JSON-RPC over stdio, so `CLAUDE_CLI_TOTAL_PROMPT_BUDGET`
  and the `MAX_CLAUDE_CLI_*` truncation constants stop applying. Image attachments become viable via ACP
  content blocks instead of being dropped.
- **Restricted mode is mandatory at this tier.** The agent is launched with no tools and no MCP servers
  passed through. It is a *completion source*, not an executor. This is precisely what lets Tier 1 ship
  without touching the authorization gate.
- **Routing needs no new concept.** Register as `pricingModel: 'subscription'` and reuse the existing
  `subscriptionQuota` machinery in `src/core/modelRouter.ts` (`scoreActiveSubscriptionPreference`,
  quota-aware slot filling). A zero-price provider does *not* get to win budget-mode routing by default.
- **Probe/install UX mirrors `probeClaudeCli`:** TTL-cached probe (read-only callers re-render often),
  Windows `.cmd`/`.exe`/bare candidate resolution, actionable "not installed / not authenticated"
  messaging. **Do not bundle adapters** — probe for a user-installed binary.
- `claude-cli` stays as the fallback when no ACP adapter is present. `ProviderId` gains `'acp'`
  additively; nothing is removed this tier.

**Entry criteria:** none — additive and self-contained.

**Definition of done:** parity tests against `claude-cli`; streaming verified; Windows spawn verified;
and a regression proving a >26k-char prompt that `claude-cli` silently truncates now completes intact.

---

## Tier 2 — Multi-subscription fleet

**Goal:** one adapter, N vendor subscriptions. The router gains genuine choice.

- Generalize Tier 1 into a **table-driven ACP agent registry**: id, launch command, args, env, auth
  probe, model aliases, verified protocol version. Each entry pinned to a checked contract.
- Adds **ChatGPT Plus/Pro** (`codex-acp`) and **Google** (Gemini CLI) capacity. Neither vendor has any
  subscription path in AtlasMind today — this is net-new routable capacity, not a re-skin.
- Model selection via ACP v2 session config where the agent supports it; fall back to per-agent env
  vars only against a verified contract, never a guessed one.
- Per-agent settings, deny-by-default (`atlasmind.acp.<agent>.enabled: false`). **User-authored launch
  commands only** — no auto-install, and no `npx`-fetch-and-run of an unpinned package.
- Quota accounting per subscription so the router degrades to pay-per-token when a subscription is
  exhausted (the existing `remainingRequests <= 0` overflow path already models this).

**Entry criteria:** Tier 1 shipped and stable; each agent's launch/protocol contract independently
verified and pinned.

---

## Tier 3 — ACP-as-delegated-executor  *(the differentiating tier)*

**Goal:** hand an entire subtask to a subscription agent while AtlasMind keeps orchestration, memory,
and — critically — the authorization gate.

**Status: the authorization half shipped in v0.176.0. The delegated-subtask execution path did not.**
An agent can now act and every action is gated; what does not yet exist is a way to hand it a *whole
subtask* and reconcile the result. Those are separable, and shipping the gate first is the right
order — the alternative is an execution path with nothing behind it.

### Shipped (v0.176.0)

- [x] `session/request_permission` answered through `src/providers/acpPermission.ts` +
      `ToolApprovalManager`. Fails closed on an unreadable request, a missing policy, a policy that
      throws, and any option kind it cannot recognise (unknown kinds are dropped, never coerced).
- [x] ACP `ToolKind` → AtlasMind `ToolRiskCategory`, so an existing bypass carries the same meaning
      for a delegated agent as for a subtask. `ToolKind::Other` is `#[serde(other)]` in the schema, so
      it is the *unidentifiable* bucket and maps to highest risk.
- [x] **Never selects `allow_always`** — that grant lives in the agent's own persistent state, where
      AtlasMind can neither display nor revoke it. Declines outright when it is the only way to
      approve.
- [x] **MCP pass-through** at `session/new`, behind an explicit per-server allowlist
      (`atlasmind.acp.mcpServers`, empty by default). Servers holding SecretStorage credentials and
      HTTP/SSE servers are never forwarded, and the reason is logged.
- [x] `session/update` tool-call events parsed (`tool_call`, `tool_call_update`) and surfaced, rather
      than dropped as uninterpreted "other".
- [x] Deny-by-default `atlasmind.acp.toolsEnabled` (`false`), with a control on Settings → Safety.
- [x] The double-loop hazard is *avoided rather than solved*: `request.tools` is still refused, so the
      Orchestrator's loop can never nest inside the agent's. The two loops cannot currently meet
      because there is no path on which they would.

### Outstanding

- [ ] **The delegated-subtask path itself.** Today an ACP agent acts within an ordinary completion
      turn. Handing it a *subtask* — with the Orchestrator standing down as a distinct execution path,
      not an extra tool round — is unbuilt. This is the item that makes the tier "differentiating";
      everything above is the safety floor it needs.
- [ ] **Checkpoint before delegation** (`CheckpointManager`). Needed the moment a subtask path exists:
      an external process editing the workspace needs a rollback point AtlasMind created.
- [ ] **Changed files reconciled back into the run record**, and tool-call events routed to the
      tool-progress UI + `ProjectRunHistory` rather than only the output channel.
- [ ] **Plan updates → the Planner surface** (`plan` session updates are still passed through as
      `other`).
- [ ] **Verify against a real ACP binary.** Still outstanding from Tier 1 and now more load-bearing:
      the whole permission path has been tested against a fake agent only. A live `claude-agent-acp`
      run is the first thing to do before trusting any of this in anger.
- [ ] Threat model + security review of delegated authorization — specifically *what an agent can
      reach that AtlasMind's own tools cannot*, which the `fs`/`terminal` reasoning below makes
      sharper rather than answers.

### Decided: `fs` and `terminal` client capabilities stay `false`

They do not sandbox the agent. A coding agent like `claude-code-acp` carries its own filesystem and
shell access; declaring `fs: false` declines to *proxy* the I/O, it does not withhold it. The flags
decide **who performs** an operation, not **whether** it may happen — so the entire safety budget went
to `session/request_permission`, which decides the latter. Turning them on would add a real write path
and a real command-execution path inside AtlasMind, each needing its own path-traversal and lifetime
handling, in exchange for no capability the agent lacks. Revisit only if a surface needs to *show*
agent I/O (unsaved buffers, embedded terminals) — that is a UI reason, not a security one.

**Entry criteria for the outstanding items:** proven fail-closed permission mapping (done, against a
fake agent) and a live-binary verification (not done).

---

## Tier 4 — AtlasMind as an ACP agent (reciprocal)

**Goal:** expose AtlasMind itself over ACP so any ACP client — Zed, JetBrains, Neovim, Emacs, Buzz —
can drive AtlasMind's orchestration, routing, and memory.

- Implements the **agent** side of `@agentclientprotocol/sdk`, inverting the Tier 1–3 relationship.
- **Cross-link:** satisfies [buzz-integration.md](buzz-integration.md) Tier 4's A2A handoff, which
  already names `buzz-acp` as a transport.
- MAJOR-version-class: a new externally-driven control surface into AtlasMind. Requires full
  authentication and policy review before any exposure beyond localhost stdio.

**Entry criteria:** Tiers 1–3 stable; security review of the inbound control surface; explicit opt-in.

---

## Cross-cutting safety invariants (inherit for every tier)

- **Deny-by-default:** every ACP agent disabled until explicitly enabled; `delegatedExecution:false`;
  no agent auto-installed.
- **Never auto-approve:** no adapter is ever launched in a bypass-permissions / auto mode, at any tier.
  Tier 1–2 sidestep this entirely by running tool-free.
- **Sanitize-at-boundary:** agent output, tool-call payloads, file paths, and permission requests are
  untrusted input — validate before display, execution, or persistence. Reject path traversal.
- **Redaction boundary:** prompts sent to a subscription agent leave AtlasMind's process. The existing
  memory/secret redaction boundary applies unchanged.
- **Never guess an external API:** live protocol code lands only against a verified, pinned ACP version
  and agent launch contract. Version-check on connect; fail closed on incompatibility.
- **Treat the ecosystem as unstable:** ACP v2 is still absorbing RFDs and agent adapters ship frequently.
  Keep everything behind opt-in flags.

## Open questions — decisions owed

1. **Terms of service.** Driving a vendor subscription from a third-party product is a policy question,
   even though the adapters are vendor-published and AtlasMind already does this via `claude-cli`.
   Confirm the posture before ACP becomes a headline feature.
2. **`claude-cli` end state.** Deprecate and remove once ACP proves out, or keep permanently as a
   zero-dependency fallback for users without the ACP adapter installed?
3. **Subscription burn visibility.** Subscription requests are not free — they consume quota the user
   paid for. Decide whether the Cost Dashboard surfaces ACP usage as premium-request-style units
   (as Copilot's `premiumRequestMultiplier` does) rather than as $0.

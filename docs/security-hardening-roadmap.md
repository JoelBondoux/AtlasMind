# Security hardening roadmap

**Baseline:** `284ef096` · v0.429.1 · `develop` · 2026-09-07.
Evidence and line citations: [`security-data-flow.md`](security-data-flow.md).

Classification is by **what an attacker or an accident can reach today**, not by effort. Every item
carries acceptance criteria and the regression test that proves it, because a security fix with no
failing-first test is a claim rather than a change.

---

## P0 — Reachable today, no user action required

### P0-1 · Background SSOT summarisation sends unredacted project memory to a possibly-cloud model

**Evidence.** `extension.ts:2628` (ungated timer) → `memoryAgent.ts:84` (4 000 raw chars) →
`memoryAgent.ts:53` (`provider.complete`). `'local'` at `memoryAgent.ts:46` is a fallback, not a
constraint — proven by `orchestrator.ts:7325-7337`. `DataPrivacyManager` is wired to the orchestrator
only (`extension.ts:2612`).

**Why P0.** It needs no user action, no prompt, and no attacker: installing the extension is
sufficient. It is the only finding here that is simultaneously an egress violation (req 1), a silent
cloud fallback (req 2), an activation-time external call (req 3) and a swallowed failure (req 9).

**Acceptance criteria.**
1. `atlasmind.memory.backgroundSummarizationMode` exists with `off` | `local-only` | `routed`,
   defaulting to **`off`**.
2. With the default, **no model request is issued** by any timer. Asserted by a test that installs a
   provider double and fails if it is called.
3. `local-only` resolves a provider that is local **by identity, not by fallback**, and fails
   visibly rather than routing elsewhere.
4. `routed` requires explicit opt-in and records which provider received the data.
5. No prior setting value is migrated into `routed`.

**Regression tests.**
- `tests/memory/backgroundSummarization.test.ts` — provider double asserts zero calls at default.
- A test that a cloud model id cannot be selected under `local-only`, driving the real
  `resolveProviderIdForModel` rather than a stub.
- A test that the failure path writes to the output channel instead of returning `''`.

### P0-2 · A timer writes to project memory with no approval

**Evidence.** `extension.ts:2643` — `memoryManager.upsert()` inside the interval, storing
model-generated text.

**Acceptance criteria.**
1. `atlasmind.memory.selfHealingMode` — `off` | `report-only` | `ask` | `apply`, default
   **`report-only`**.
2. Under the default, a scan may report and must not write.
3. Any write is inside the resolved SSOT root, checkpointed, and reports the exact path.
4. Activation under default settings performs **no** project-file write.

**Regression tests.**
- A test that activation with defaults produces zero writes under a temp workspace, asserted on the
  filesystem rather than on a mock.
- A path-traversal case proving a crafted entry path cannot escape the SSOT root.

### P0-3 · Security-relevant failures are swallowed

**Evidence.** `memoryAgent.ts:48-50`, `memoryAgent.ts:63-65`, `extension.ts:2646-2648` — three
silent returns on one path, one of them commented *"Silent — best-effort refresh only."*

**Acceptance criteria.** Every failure on a background path reaches the AtlasMind output channel with
its cause; repeated identical failures are deduplicated, not discarded.

**Regression test.** Force each failure mode and assert an output-channel line naming the cause.

---

## P1 — Requires a setting, a prompt, or an unusual path

### P1-1 · No mandatory model-egress boundary

**Status: closed in v0.432.0.** `src/core/modelEgress.ts` is the dispatcher; all five acceptance
criteria are met and all three regression tests exist
(`tests/security/modelEgressBoundary.test.ts`, `tests/security/egressLabelling.test.ts`,
`tests/core/modelEgress.test.ts`). Direct call sites 21 → 0, `LEGACY_DIRECT_CALLERS` empty.

Two things were learned closing it that the plan did not anticipate. Criterion 4 was *written*
correctly and *implemented* against `NODE_ENV`, which VS Code leaves unset in the extension host — so
the fail-closed-in-development rule was live in production and the documented production behaviour
was unreachable. And the origin could not live in a parallel array as first sketched: the agentic loop
splices its own history, so the label had to travel on the message or it would eventually describe
the wrong text.

**Evidence.** 21 prompt-bearing call sites in 8 files; only `orchestrator.ts` references the redactor
(§1 of the data-flow document).

**Note on scope.** A per-file grep cannot prove the other seven leak — some may only send text the
orchestrator already sanitised. What it proves is that **nothing prevents** a leak. This is the
argument for wrapping the registry rather than auditing callers: a convention every caller must
remember has already been forgotten seven times, whatever the current consequences.

**Acceptance criteria.**
1. One dispatcher through which all prompt-bearing calls pass, with structured origin metadata.
2. Repository-derived, retrieved, attached, memory, tool-result and generated context is redacted,
   classified and size-limited before transmission.
3. User-authored prompts are never silently rewritten; a secret-shaped value blocks and asks.
4. Unknown or unlabelled origin **fails closed** in development and tests.
5. Logs carry origin, provider, model, redaction count and rule names — never matched values or
   prompt bodies.

**Regression tests.**
- An architectural test that fails when production code outside the dispatcher and the adapters calls
  a prompt-bearing provider method. This is the item's real deliverable: without it, the boundary
  decays the moment someone adds a ninth caller.
- A fail-closed test for unlabelled origin.
- A test that a log line for a redacted prompt contains no fragment of the secret.

### P1-2 · Model-generated JavaScript runs in the extension host

**Evidence.** `skillDrafting.ts:90` (`new Function`), mitigated by `orchestrator.ts:3672`
(deny-by-default) and `skillDrafting.ts:93-95` (`require` blocked). `skillScanner.ts:15,23` is a
regex over the source.

**Deliberately P1, not P0** — it is off by default and the existing comment shows the risk was
understood, so the honest classification is "sound gate, no isolation behind it" rather than "open
door". Two things still want fixing: generated code reaches ambient host globals that blocking
`require` does not remove, and by the code's own comment (`orchestrator.ts:3668`) synthesis runs
*before* the tool approval gate.

**Acceptance criteria.** Synthesis is brokered before execution, not after; the scanner is documented
as a lint and never described as a sandbox.

### P1-3 · No central capability broker for subprocesses and writes

**Evidence.** 19 files import `node:child_process`; `fetch` in 14+.

**Acceptance criteria.** One broker receiving trigger, category, risk, exact resource, command plus
argument vector, background flag and recoverability — checked before approval, with hard ceilings
that Autopilot cannot convert into permissions.

---

## P2 — Verify before building

These are **unverified hypotheses**, and the next Phase 0 pass should settle them before any code is
written. Listing them as work items now would be the same mistake as trusting the documentation.

- **Read-only enforcement (req 5).** Not traced at all. Establish whether any structured state exists
  or whether it is prompt text only.
- **Autopilot and hard ceilings (req 6).** `toolApprovalManager.ts` and `toolPolicy.ts` were not read.
- **Routine preview and approval (req 7).** `routineRunner.ts` not read.
- The four other activation intervals and six watchers.
- `src/mcp/`, `src/acp/`, `src/remote/` authority paths.

---

## P3 — Consistency

- **Requirement 10.** README, `wiki/Security.md`, `wiki/Configuration.md` and settings descriptions
  must describe the behaviour that ends up in code. Deliberately last: aligning documentation with
  behaviour that is about to change would mean writing it twice, and the second version is the one
  that matters.

---

## Sequencing

P0-1, P0-2 and P0-3 are one path and should land together — splitting them leaves the timer running
with two of three holes closed. P1-1's architectural test is the item that keeps the rest true over
time and should not be deferred behind the refactor it guards. P2 is a second evidence pass, not
implementation.

**Nothing in this document has been implemented.** Phase 0 is evidence only, per the brief.

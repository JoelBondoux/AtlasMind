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

**Status: closed in v0.434.0**, and the phase was smaller than this entry implied because one of its
two criteria was already met.

**Correction: "synthesis runs before the tool approval gate" was wrong.** The Phase 0 note cited a
code comment rather than the control flow. There is a dedicated `generatedSkillApprovalGate`
(`types.ts:1373`, wired at `extension.ts:2346`, called at `orchestrator.ts:3800-3813`) that runs
*before* `loadSkillFromSource`, receives the scan result **and the source**, and fails closed with a
named reason when no approval surface exists. It is strictly better than the generic tool gate for
this purpose, because it can show the code. Work had begun on a second, `toolPolicy`-classified gate
before this was checked; it was reverted rather than shipped, on the same reasoning that kept a
capability broker out of P1-3 — two gates that can disagree are worse than one that is sufficient.

**What was actually wrong: the evaluation itself.** `loadSkillFromSource` was
`new Function('module','exports','require', source)`, whose body runs in the extension host's own
global scope. Eight routes to `node:fs` were run against it. **Seven reached**, including
`import('node:fs')` — dynamic import is syntax, so shadowing the `require` identifier never touched
it — and `process.mainModule.require('node:fs')`, both returning a working `readFileSync`. The
injected `safeRequire` blocked exactly one spelling of the capability it was there to remove.

Evaluation now happens in a `node:vm` context with no ambient globals, and `module`/`exports`/`require`
are defined **inside** it as source rather than assigned onto it — measured both ways, because a host
function placed on a context is reachable as `require.constructor.constructor`, which is the host
realm's `Function` and hands back `process`. All eight routes are refused; `import()` throws *"A
dynamic import callback was not specified"* because none is supplied. A `timeout` bounds the module's
top level, which runs on evaluation.

**The hole that remains, stated because it cannot be closed here.** `execute(args, ctx)` receives a
real `SkillExecutionContext`, and any host object crossing the boundary carries the host realm's
`Function` on its prototype chain — `ctx.readFile.constructor.constructor('return process')()`
reaches out. That is inherent to giving a skill callbacks at all. It is **asserted as a passing test**
so the boundary cannot quietly be described as more than it is; if it is ever closed, that test fails
and can be deleted with good news.

**Regression tests.** `tests/security/generatedSkillContainment.test.ts` — the eight routes as
executed escapes rather than arguments about them, a runaway top level answering with a timeout
instead of hanging the host, an ordinary skill still loading (a boundary that refuses everything is
disablement wearing a boundary's clothes, and the other tests would pass against it), the residual
callback route, and a check that every mention of "sandbox" in `skillDrafting.ts` is a denial of being
one.

**The scanner is a lint, and now says so accurately.** `skillScanner.ts` already carried rules for
`import(`, indirect `require`, the constructor escape and computed global access, with comments
naming its own bypasses. One of those comments said the skill "runs in the extension host's global
scope", which this change made false; corrected rather than left, since a plausible false comment
adjacent to real code is the failure mode this pass keeps finding. The rules are kept rather than
retired: a skill that *tries* is worth refusing whether or not it would have succeeded.

### P1-3 · No central capability broker for subprocesses and writes

**Status: partly closed in v0.433.0** — the hard-ceiling half and the worst uncovered path. The
broker itself is **not** built, deliberately: see *What a broker would and would not have fixed*.

**Original evidence.** 19 files import `node:child_process`; `fetch` in 14+.

**That evidence was a count, not a trace, and tracing it changed the item.** Twenty files import
`child_process`; six of them never spawn anything. Every `src/skills/*` command goes through the
`SkillContext.runCommand` capability and therefore through `toolApprovalGate`
(`orchestrator.ts:3473`) — the tool surface is already brokered. The uncovered paths are the ones
that are not tools:

| Path | Reaches a shell | Gate |
|---|---|---|
| `skills/*` via `runCommand` | yes | `toolApprovalGate` — classified, mode-checked, bypassable |
| `promotionRunner.ts` | yes | own authorization gate with type-to-confirm |
| `routineRunner.ts` | **yes — `promisify(exec)`** | **none, before v0.433.0** |
| `bootstrapper.ts` (×4 `cp.exec`) | yes | one confirmation for the install; three probes unconfirmed |
| `mcpRuntime` / `acp` / `localCiRunner` / `presenceManager` / voice / `gpuProbe` | yes | own confirmations or fixed constants |

**Corrections to the hypothesis, in the code's favour.** A hard ceiling *does* exist:
`extension.ts:2303` refuses `terminal-write` when `atlasmind.allowTerminalWrite` is false, and it is
checked **before** the bypass, so Autopilot cannot convert it. And `requiresToolApproval`
(`toolPolicy.ts:173-197`) returns `true` for `network` under every one of the four modes, so no mode
setting waives an outward write either. The accurate finding was therefore narrower and sharper than
"no ceilings": *exactly one ceiling existed, and everything else was bypassable.*

**What was actually wrong.**

1. `ToolApprovalManager.shouldBypass` returned `true` for **every** category once Autopilot was on,
   and Autopilot is offered as an answer to any approval dialog — so one click on a low-risk tool
   bought unattended approval of `git push`, a remote branch delete, and any MCP tool AtlasMind could
   not identify (which classifies `network`/`high` on its name alone).
2. `RoutineRunner` ran `promisify(exec)` — a real shell — with **no gate at all**, no preview, and
   three entry points: `/ship`, the Run Center's Run button, and the promotion path.
3. An unresolved `${placeholder}` became an empty string (`vars[name] ?? ''`), and the Run Center
   passed `vars: {}` unconditionally — so every placeholder in a panel-run routine resolved to
   nothing and the command that ran was not the command the routine describes.
4. A routine template is trusted as "a reviewed file in the repository". Nothing in code guarantees
   that: `file-write` is graded `workspace-write`/high and refuses only paths *outside* the
   workspace, and `project_memory/routines/` is inside it and a declared `SSOT_FOLDERS` member.

**What shipped.** `NEVER_BYPASSABLE_TOOLS` in `toolPolicy.ts` — one pair, `network`/`high`, checked
first in `shouldBypass` so no bypass state reaches past it. `routineExecutionPolicy.ts` plans a
routine before it runs: refuses an unresolved placeholder rather than blanking it, carries the fully
substituted commands so the confirmation shows what will actually run, and reports which commands
leave the machine. `RoutineRunner.run` now takes the **plan**, not the routine and its values, so a
caller cannot show one command and run another.

**Deliberately not done: extending `allowTerminalWrite` to routines.** That setting gates *a model*
deciding to run a command. A routine is a script somebody wrote and explicitly invoked — a different
authorization — and applying that ceiling would refuse every routine at the default setting. The gate
a human-authored script deserves is *see it first*, which is what it now gets.

**Deliberately not done: a ceiling over every `high`.** It would prompt on ordinary file writes, and
a gate that prompts constantly gets switched off wholesale. The ceiling covers the one pair where all
three are true at once: it leaves this machine, it changes something there, and it cannot be taken
back.

**What a broker would and would not have fixed.** A single broker in front of `child_process` would
have caught none of the four findings above: (1) and (3) are policy defects inside gates that already
existed, (2) is a missing confirmation rather than a missing chokepoint, and (4) is a provenance
question a chokepoint cannot answer. Building one now would add a second approval system beside
`toolApprovalGate`, and two gates that can disagree is worse than one that is incomplete. The
remaining brokerage work is the *unconfirmed* subprocess sites, which belongs with Phase 8's
subprocess consolidation rather than here.

**Regression tests.** `tests/security/toolBypassCeiling.test.ts` (15) walks every bypass route —
autopilot, whole-task, per-category, all three at once, and all four approval modes — against the
declared ceiling, and asserts it stays under a fifth of the (category, risk) space so autopilot
remains worth having. `tests/security/routineExecutionPolicy.test.ts` (18) covers the placeholder,
preview and reach rules.

**A documentation finding, fixed in passing.** `ToolApprovalManager.bypassCategory` has **no caller in
`src/`** — `ToolApprovalDecision` has four values and none is a per-category grant. Both
`toolPolicy.ts:241-245` and `wiki/Tool-Execution.md` cited it as the mitigation that keeps
`network-read` gating from becoming a wall of dialogs, so the reasoning for a live policy decision
rested on wiring that was never built, and the wiki told users to use an affordance that is not in the
dialog. Both corrected to describe `bypass-task`, which does exist. This is requirement 10's failure
mode found in the small: the claim was plausible, adjacent to real code, and false.

**Still open.** The three unconfirmed `cp.exec` capability probes in `bootstrapper.ts`, and the
inconsistency that its Linux `gh` installer is a `curl … | sudo dd … && sudo apt install` chain while
`acpInstaller.ts` refuses to ship `curl | sh` on principle. Both are constants, so neither is
injectable; they are a consistency finding, not a reachable one.

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

# Security hardening — final report

**Baseline:** `284ef096` · v0.429.1 · 2026-09-07
**Head:** v0.436.0 · `develop` · 2026-09-08
**Evidence:** [`security-data-flow.md`](security-data-flow.md) · **Plan:** [`security-hardening-roadmap.md`](security-hardening-roadmap.md) · **Supply chain:** [`dependency-security-review.md`](dependency-security-review.md)

Seven commits, 8,500+ tests green throughout, no test weakened to make a change pass.

---

## 1. What changed, by consequence

| # | Was | Now | Enforced by |
|---|---|---|---|
| 1 | 21 prompt-bearing provider calls across 8 files; one referenced the redactor | Every call clears context through one boundary; direct callers **21 → 0** | `modelEgressBoundary.test.ts` (ratchet, allowlist empty) |
| 2 | Origins inferrable only from `role`, which conflates four different risks | Origin carried on the message, labelled at construction | `egressLabelling.test.ts` |
| 3 | Model-written JS evaluated in the extension host's global scope; **7 of 8** routes to `node:fs` reached | Evaluated in a `vm` context with no ambient globals; 8 of 8 refused | `generatedSkillContainment.test.ts` |
| 4 | Autopilot bypassed **every** category, and is offered as an answer to any dialog | One ceiling no bypass can waive: outward, changing, irreversible | `toolBypassCeiling.test.ts` |
| 5 | Routines reached a shell with no gate, no preview, from three entry points | Planned, shown, confirmed; runner takes the plan, not the values | `routineExecutionPolicy.test.ts` |
| 6 | An unresolved `${placeholder}` became an empty string; the Run Center passed none at all | Refused, with an empty value counted as absent | `routineExecutionPolicy.test.ts` |
| 7 | Two third parties contacted on every editor start, unprompted | Both gated on the user's own configuration | `startupNetworkActivity.test.ts` |
| 8 | Four shells spawned by the bootstrapper, three before any confirmation | None; argv vectors throughout | `subprocessShellUse.test.ts` |
| 9 | A `curl … \| sudo dd … && sudo apt install` pipeline shipped in the product | Removed; manual instructions instead | `subprocessShellUse.test.ts` |
| 10 | Nine CI actions on mutable tags, including in the job that can publish | All SHA-pinned, with reviewable version comments | `supplyChain.test.ts`, `ciWorkflowPolicy.test.ts` |

---

## 2. What the tests actually demonstrate

Three properties are load-bearing and each is demonstrated by execution rather than by argument.

**Nothing reaches a model unlabelled.** `modelEgressBoundary.test.ts` walks `src/`, finds every
prompt-bearing provider call, and fails on any that is not the boundary itself. The recorded
exception list is empty. This is the deliverable — not the module it guards — because the arrangement
it replaced was a convention every caller had to remember, and it had been forgotten seven times.

**A generated skill cannot reach the host at evaluation.** The eight escape routes in
`generatedSkillContainment.test.ts` were first run against the *old* implementation to establish they
worked; seven did. They now all fail. `import('node:fs')` was the one no reasoning would have caught:
dynamic import is syntax, so shadowing the `require` identifier never touched it.

**No shell command is built from a value.** `subprocessShellUse.test.ts` asserts this across `src/`
with no allowance — it is zero, and a new entry is a command injection until proven otherwise. The
separate list of files permitted to reach a shell at all holds two entries, both places where "run
this command" *is* the feature, and may only shrink.

---

## 3. Where the brief was wrong, in the code's favour

Recorded because a hardening pass that only confirms its own premises is not an audit.

- **"No hard ceilings exist."** One did: `atlasmind.allowTerminalWrite`, checked *before* any bypass,
  so Autopilot could never convert it. `requiresToolApproval` also returns `true` for `network` under
  all four approval modes, so no mode setting could waive an outward write either. The accurate
  finding was narrower and sharper: *exactly one ceiling existed and everything else was bypassable.*

- **"Synthesis runs before the tool approval gate."** This came from a code comment rather than the
  control flow. `generatedSkillApprovalGate` already ran before evaluation, received the scan result
  **and the source**, and failed closed when no approval surface existed — better than the generic
  gate for this purpose, because it can show the code. Work on a second gate was reverted unshipped.

- **"A regex scanner is being treated as a sandbox."** `skillScanner.ts` already carried rules for
  dynamic import, indirect `require`, the constructor escape and computed global access, with
  comments naming its own bypasses. It was already documented as a lint.

- **"19 files import `child_process`."** A count, not a trace. Twenty do; six never spawn anything;
  every `src/skills/*` command already went through the approval gate. Tracing it moved the finding
  from "no broker" to four specific defects, none of which a broker would have caught.

---

## 4. What was deliberately not done

- **No central capability broker.** It would have caught none of the four subprocess findings — two
  were policy defects *inside* gates that already existed, one a missing confirmation rather than a
  missing chokepoint, one a provenance question no chokepoint can answer. A second approval system
  beside `toolApprovalGate` is worse than one that is incomplete.

- **`allowTerminalWrite` not extended to routines.** That setting gates *a model* choosing to run a
  command. A routine is a script somebody wrote and explicitly invoked — a different authorization —
  and applying the ceiling would refuse every routine at the default setting.

- **No ceiling over every `high`-risk category.** It would prompt on ordinary file writes, and a gate
  that prompts constantly is switched off wholesale, which protects nothing.

- **No outbound-host allowlist.** `src/` holds ~180 hardcoded hostnames, almost all documentation
  links and provider base URLs. An allowlist of that size is noise, not a control.

- **No committed SBOM.** A checked-in SBOM goes stale silently and then answers a question about a
  build that no longer exists with the confidence of a generated artifact. `npm run sbom` generates
  one against the tag you are actually asking about.

---

## 5. The pattern worth reporting on its own

**Five of the findings in this pass were plausible, false statements sitting next to correct code.**
Not stale in an obvious way — each was specific, technical, and adjacent enough to be believed:

1. `toolPolicy.ts` justified a live gating decision on `bypassCategory` keeping dialog volume down.
   `bypassCategory` **has no caller**; `ToolApprovalDecision` has four values and none is a
   per-category grant. `wiki/Tool-Execution.md` told users to use it.
2. `orchestrator.ts` said synthesis "executed before anything asked". A dedicated gate ran first.
   This one propagated: it became a finding in this pass's own Phase 0 document.
3. `skillScanner.ts` said generated skills run "in the extension host's global scope" — true when
   written, false after the containment change, and it would have stayed.
4. `currencyFormatter.ts` called an unconditional network call "safe to call on every activation"
   because it skipped when cached. True, and beside the point: the first call was never cached.
5. `security-data-flow.md` §3 described the `new Function` residual as narrow. Seven of eight routes
   reached.

The mechanism is the same each time: a comment states a *reason*, the code moves, and the reason
survives as evidence. Two of these were cited as justification for other decisions, which is how a
false comment becomes a false design.

There is no test for this. The only defence found that works is checking the control flow rather than
the comment describing it — which is what "verify against the current source, do not assume
documentation is correct" means in practice, applied to this repository's own documentation.

A related and cheaper failure mode appeared four times: **a scanner matching its own documentation.**
Every regex-based check written in this pass initially flagged the prose explaining the hazard it
looks for. `debtRegister.ts` already knew this — "markers discussed in prose are documentation" — and
the fix is the same each time: strip comment lines before scanning.

---

## 6. Claims and their enforcement

Per the standing rule that "safe", "secure", "never" and "cannot" require enforcement:

| Claim | Enforced |
|---|---|
| Nothing reaches a model without a declared origin | Yes — architectural test, empty allowlist |
| A generated skill cannot reach host globals **at evaluation** | Yes — eight executed escapes |
| A generated skill cannot reach the host **while running** | **No — and it can.** Asserted as a passing test |
| Autopilot cannot approve an irreversible outward action | Yes — every bypass route walked |
| No shell command is assembled from a value | Yes — zero, no allowance |
| Nothing is contacted at startup unprompted | Partly — the two gates are tested; the absence of *other* startup calls is by inspection |
| No telemetry exists | **By inspection only.** No test asserts the absence of a telemetry client |
| Every CI action is immutably pinned | Yes — all six workflows |

The two "no" and "partly" rows are the honest boundary of this pass. The first is inherent: a skill
given callbacks can reach the realm that owns them, and closing it means not having skills. The other
two are inspection, stated as inspection.

---

## 7. Test tally

**120 security regression tests**, of which 88 are new in this pass.

| File | Tests | Subject |
|---|---|---|
| `tests/core/modelEgress.test.ts` | 23 | Origin policy: redaction, limits, confirmation, audit content |
| `tests/security/routineExecutionPolicy.test.ts` | 18 | Placeholders, preview, reach, refusal rules |
| `tests/security/egressLabelling.test.ts` | 15 | How a label reaches the policy; streaming; the confirmer's four answers |
| `tests/security/toolBypassCeiling.test.ts` | 15 | Every bypass route, every approval mode, ceiling breadth |
| `tests/security/generatedSkillContainment.test.ts` | 14 | Eight executed escapes, timeout, the residual, the "sandbox" word |
| `tests/core/routineVariables.test.ts` | 9 | Structural value refusal (pre-existing) |
| `tests/security/startupNetworkActivity.test.ts` | 9 | Nothing contacted unprompted at activation |
| `tests/security/subprocessShellUse.test.ts` | 7 | Shell-caller ratchet; zero assembled commands |
| `tests/security/modelEgressBoundary.test.ts` | 5 | Architectural ratchet, allowlist empty |
| `tests/security/supplyChain.test.ts` | 5 | Action pinning, dependency set |

Four of these are **architectural** rather than behavioural — they scan `src/` and fail on a shape
rather than an outcome. Those are the ones that keep the rest true after this pass ends, because a
boundary every caller must remember is the arrangement being replaced.

Two existing tests were modified, both because a change made their assumption wrong rather than to
make a change pass: `ciWorkflowPolicy` anchored an action reference to end-of-line (loosened, SHA
assertion unchanged) and an `orchestrator.tools` fixture read `process.env` at a module top level,
which containment now refuses. Neither assertion was weakened; the second surfaced a real behaviour
change worth its own test.

---

## 8. Still open

- Three `cp.execFile` capability probes in `bootstrapper.ts` run before the install confirmation.
  Constants, no shell, no interpolation — but they run unprompted.
- `bypassCategory` remains unwired. Wiring it is a UI change; its ceiling behaviour is already tested.
- No test asserts the absence of a telemetry client, or pins the outbound host set.
- P2 of the roadmap — read-only enforcement, `src/mcp/`, `src/acp/`, `src/remote/` authority paths —
  was a second evidence pass and remains unstarted.

# Security data flow — evidence baseline

**Baseline commit:** `284ef096dc1d1315e77a2ceb4e27aa9626c535c5` · **Version:** 0.429.1 ·
**Branch:** `develop` · **Recorded:** 2026-09-07 · Working tree clean.

This is a Phase 0 evidence document. Every claim below was verified against the source at that
commit and carries a file and line reference. Where a hypothesis from the brief turned out to be
**wrong or overstated**, that is recorded too — the point of the exercise is what the code does, not
what anybody expected.

**Coverage of this pass is partial and the gaps are listed at the end.** An audit that implies it
looked everywhere is the same failure mode as a test that cannot fail.

---

## 1. Prompt-bearing model calls

> **Closed in v0.432.0.** The audit below is the Phase 0 evidence, left as written. All 21 sites now
> dispatch through `src/core/modelEgress.ts`; the count outside the boundary and the adapters is
> **zero**, enforced by `tests/security/modelEgressBoundary.test.ts` rather than by review.
>
> One line of the table below turned out to be wrong in a way worth recording: the hand-grep that
> produced it missed `src/core/commands.ts:2741`, which the architectural test found immediately.
> That is the argument for the test in one sentence — a survey of call sites is only as good as the
> person doing the survey, and this one was being done carefully.

`provider.complete` / `provider.streamComplete` are called from **21 sites in 8 files outside the
provider adapters**. There is no common boundary: each caller is individually responsible for what it
sends.

| File | Lines | Redactor referenced anywhere in file? |
|---|---|---|
| `src/core/orchestrator.ts` | 1004, 1047, 1085, 1135, 1340, 2940, 3705, 3842, 3843, 4546, 4564, 6643 | **Yes** (7 references) |
| `src/memory/memoryAgent.ts` | 53, 88 | **No** |
| `src/views/modelComparisonPanel.ts` | 259, 281 | **No** |
| `src/core/agentAutoUpdater.ts` | 109 | **No** |
| `src/core/classifierService.ts` | 310 | **No** |
| `src/core/goalEvaluator.ts` | 55 | **No** |
| `src/core/planner.ts` | 146 | **No** |
| `src/core/skillAutoAssigner.ts` | 113 | **No** |

Redaction lives in `src/utils/secretRedactor.ts:49` (`redactSecrets`) and `:78`
(`redactSecretsWithWarning`), and is referenced from 17 files — but **only one of the eight files
that actually call a model**.

> **This does not prove seven paths leak secrets.** Some may pass only text the orchestrator already
> sanitised, and a per-file grep cannot see that. What it does prove is that **no mechanism prevents
> them from leaking**: the boundary is a convention each caller must remember, which is the condition
> Phase 1 exists to remove.

---

## 2. The background SSOT summarisation path — verified end to end

This is the brief's central hypothesis. It is **correct**, and worse than stated.

**Trigger.** `src/extension.ts:2628` — `setInterval(...)`, registered during `activate()` with **no
setting check and no gate of any kind**. It starts because the extension started.

**Chain.**

1. `extension.ts:2631` — `memoryAgentExecutor.detectStaleEntries()`
2. `extension.ts:2637-2638` — reads the SSOT file from disk, raw
3. `extension.ts:2639` — `summarizeSsotEntry(entryPath, content)`
4. `src/memory/memoryAgent.ts:84` — embeds `content.slice(0, 4000)` in the prompt verbatim
5. `memoryAgent.ts:53` — `provider.complete(...)`

**No redaction.** `memoryAgent.ts` imports no redactor (see §1). The 4,000 characters are whatever
the file contains.

**No privacy classification.** `extension.ts:2612` wires the policy with
`orchestrator.setDataPrivacyManager(dataPrivacyManager)` — to the **orchestrator only**.
`memoryAgentExecutor` is never given it. The comment at `extension.ts:2596-2598` describing privacy
gating sits **sixteen lines above** the timer that bypasses it.

**Cloud fallback is real.** `memoryAgent.ts:45-47`:

```ts
const model = this.router.selectModel(MEMORY_CONSTRAINTS, allowedModels, taskProfile);
const providerId = resolveProviderIdForModel(model, this.router, 'local');
```

`MEMORY_CONSTRAINTS` (`memoryAgent.ts:9`) is `{ budget: 'cheap', speed: 'fast' }` — a *preference*,
not a locality constraint. And `resolveProviderIdForModel` (`src/core/orchestrator.ts:7325-7337`)
returns **the model's own provider** whenever metadata exists (line 7331-7333); the `'local'`
argument is only a last-resort default for a model id with no provider and no prefix.

> So `'local'` at the call site **reads** like a constraint and **is** a fallback. Whenever routing
> picks a cheap cloud model — which it does when no local model is configured — project-memory
> content goes to that cloud provider. Requirement 2 is violated.

**Background project-file write.** `extension.ts:2643` — `memoryManager.upsert({ ...entry, snippet })`
on the same timer. A model-generated snippet is written into project memory with no approval.

**Silent failure, by design.** `memoryAgent.ts:48-50` returns `''` when no provider resolves;
`memoryAgent.ts:63-65` is `catch { return ''; }`; `extension.ts:2646-2648` is `catch { }` with the
comment *"Silent — best-effort refresh only."* Requirement 9 is violated in three places on one path.

---

## 3. Dynamic code execution — hypothesis partly wrong, in the code's favour

> **Closed in v0.434.0, and two things below were wrong.** The residual described here as narrow was
> wider than stated: eight routes to `node:fs` were run against `new Function`, and **seven reached** —
> `safeRequire` blocked one spelling of the capability, not the capability. Evaluation now happens in a
> `node:vm` context with no ambient globals and all eight are refused
> (`tests/security/generatedSkillContainment.test.ts`).
>
> The other error is in this document's own framing: the claim that *synthesis runs before the tool
> approval gate* came from a code comment rather than the control flow. A dedicated
> `generatedSkillApprovalGate` already ran before evaluation, receiving the source and failing closed.
> Both corrections are recorded in P1-2 of the roadmap.

The brief suggests regex scanning is being treated as a sandbox. **Two real mitigations exist and
should be credited.**

- `src/core/orchestrator.ts:3672` — auto-synthesis is **deny-by-default**
  (`skillAutoSynthesisEnabled`, default `false`), and the comment at `:3662-3671` names the exact
  risk, including that *synthesis runs before the tool approval gate*.
- `src/core/skillDrafting.ts:93-95` — `safeRequire` **throws for every import**, so generated code
  cannot pull in `fs`, `child_process` or anything else.

**The residual risk is narrower but real.** `skillDrafting.ts:90` is
`new Function('module', 'exports', 'require', source)` — model-written code evaluated in the
extension host's own global scope. Blocking `require` does not remove ambient globals reachable from
that scope (`fetch`, `process`, timers). `src/core/skillScanner.ts:15,23` forbids `eval(`/
`new Function(` **by regex over the generated source**, which is a lint, not an isolation boundary.

---

## 4. Subprocess and network surface

**19 files import `node:child_process`:** `chat/participant.ts`, `cli/nodeSkillContext.ts`,
`core/localCiRunner.ts`, `core/presenceManager.ts`, `core/promotionRunner.ts`, `core/routineRunner.ts`,
`core/skillScanner.ts`, `core/testingScaffolder.ts`, `mcp/buzzCliBridge.ts`, `mcp/mcpRuntime.ts`,
`providers/acp.ts`, `providers/gpuProbe.ts`, `views/lensChangeStoryCommand.ts`,
`views/lensDashboardPanel.ts`, `views/projectDashboardPanel.ts`, `views/settingsPanel.ts`,
`views/websiteStackSetupHost.ts`, `voice/hostSpeechSynthesizer.ts`, `voice/localTranscriber.ts`.

**`fetch` appears in 14+ files**, including `views/settingsPanel.ts` (3), `providers/registry.ts` (3),
`skills/webFetch.ts`, `providers/providerPricingSync.ts`, `providers/localModelSync.ts`,
`views/lensLiveTransport.ts`, `views/lensDatabaseTransport.ts`, `core/websiteReviewBundle.ts`.

Neither surface passes through a common capability decision. That is Phase 4's subject.

---

## 5. Activation-time behaviour

`src/extension.ts` registers **five file-system watchers** (1953, 1966, 1979, 1992, 2005, plus 2619)
and **four intervals** (1618, 2033, 2628, 4054) during activation, alongside `setTimeout` work at
1590, 1681, 3188, 4436.

Of these, `2628` is confirmed to make a **model call and a project-file write** with no gate. The
others are not yet traced — see gaps below.

---

## 6. Data-flow table (verified rows only)

| Trigger | Source | Destination | Local/external | Redacted | Privacy classified | Approval | Runs at activation | Read-only blocks it |
|---|---|---|---|---|---|---|---|---|
| Chat turn | User prompt + context | Routed provider | Either | Partly (orchestrator) | Yes (orchestrator) | Per tool | No | Not verified |
| SSOT snippet timer (`extension.ts:2628`) | Project memory file, 4 000 chars | Routed provider, **may be cloud** | Either | **No** | **No** | **No** | **Yes** | **No** |
| SSOT snippet write (`extension.ts:2643`) | Model output | `project_memory/` | Local write | n/a | n/a | **No** | **Yes** | **No** |
| Skill auto-synthesis (`skillDrafting.ts:90`) | Model-written JS | Extension host global scope | Local exec | n/a | n/a | Setting, default off | No | Not verified |
| Model comparison (`modelComparisonPanel.ts:259,281`) | User prompt | Several providers | External | **No** | Not verified | User-initiated | No | Not verified |
| Planner (`planner.ts:146`) | Goal + context | Routed provider | Either | **No** | Not verified | No | No | Not verified |
| Classifier (`classifierService.ts:310`) | User message | Routed provider | Either | **No** | Not verified | No | No | Not verified |
| Goal evaluator (`goalEvaluator.ts:55`) | Run state | Routed provider | Either | **No** | Not verified | No | No (mission only) | Not verified |
| Agent auto-updater (`agentAutoUpdater.ts:109`) | Agent definitions | Routed provider | Either | **No** | Not verified | Not verified | Not verified | Not verified |
| Skill auto-assigner (`skillAutoAssigner.ts:113`) | Skill catalogue | Routed provider | Either | **No** | Not verified | No | Via MCP callback (`extension.ts:2661`) | Not verified |

---

## 7. What this pass did **not** verify

Listed so the audit cannot be mistaken for complete:

- **Requirement 5** — read-only enforcement. Not traced; no evidence gathered either way.
- **Requirement 6** — whether Autopilot or task/category bypass can cross hard ceilings.
- **Requirement 7** — routine preview and approval (`core/routineRunner.ts` unread).
- **Requirement 10** — README / wiki / settings agreement with behaviour.
- The other four activation intervals and six watchers.
- `src/mcp/`, `src/acp/`, `src/remote/` authority paths beyond their `child_process` imports.
- Whether the seven un-redacting model callers receive already-sanitised text in practice.
- `toolApprovalManager.ts` and `toolPolicy.ts` were **not read** in this pass.

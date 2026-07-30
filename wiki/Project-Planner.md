# Project Planner

The `/project` command decomposes a high-level goal into a DAG of subtasks and executes them autonomously. For code-changing work, the planner and ephemeral agents now bias toward an autonomous test-driven-development loop instead of implementation-first execution.

AtlasMind's broader Project workspace now also includes a pre-planning ideation stage in a dedicated Project Ideation dashboard. Before committing to a `/project` execution run, operators can use the whiteboard to shape concepts with Atlas, drag or paste supporting media into cards, speak prompts, review narrated Atlas feedback, and persist the resulting board in `project_memory/ideas/`. Focused ideation cards can now open Project Run Center directly with a seeded execution preview, and finished runs can feed their learned output back into the same ideation thread or branch into a new one so planning and execution do not drift apart. The adjacent Project Dashboard title strip now also shows the current branch version and, when a distinct production branch exists, the production version too, so planning decisions can be made with explicit release context.

## Overview

```text
@atlas /project Refactor the auth module to use JWT tokens
```

**Flow:**

0. **Ideation (optional)** - Use the dedicated Project Ideation dashboard to pressure-test the idea, collect cards and media, and either refine the prompt you want `/project` to execute later or send a focused card straight into Project Run Center as a seeded run preview
1. **Planning** - LLM generates a `ProjectPlan` with subtasks, dependencies, and roles
2. **Preview** - Estimated file impact is shown; approval gated if above threshold
3. **Execution** - `TaskScheduler` runs subtasks in topological batches with tests-first subtask guidance
4. **Synthesis** - Final report aggregates results across all subtasks
5. **Persistence** - Run saved to Project Run History for review

---

## Starting a run from chat — proposal decisions

You don't have to type `/project`. When an assessment or normal chat reply **offers** to start an autonomous project run, interactive chat renders a decision card instead of ending on an inert sentence:

- **Start run** — starts the proposed goal now through the normal project execution and file-count gates.
- **Save for later** — plans and persists a reviewed preview in Project Run Center without executing it.
- **Cancel** — dismisses the proposal without starting or saving a run.

With **Autopilot ON**, `atlasmind.autoStartProposedProjectRuns: true` permits immediate auto-start after a brief notice. Set it to `false` to require the decision card even under Autopilot. Proposed goals reuse the same action that typing `Proceed` would resolve, and unusually large runs still pause at `projectApprovalFileThreshold`.

Detection remains conservative: it requires explicit project/autonomous-run vocabulary plus a first-person offer, ignores generic “I’ll build this,” vetoes declines/deferrals, and never fires while requirements are still being gathered.

---

## Mission Loop (`/loop`) vs the single-pass planner

`/project` is a **single pass**: plan → execute the DAG → synthesize → stop. The **Mission Loop** (`/loop` and the Mission Control panel, backed by `src/core/missionRunner.ts`) wraps that same machinery in an **outer loop**:

1. **Plan increment** — the `Planner` decomposes only the *next slice* of work, grounded in SSOT memory, the mission's guardrails and success criteria, the latest progress evaluation's next-focus, and a carry-forward summary of prior iterations.
2. **Execute** — the increment runs through the same `Orchestrator.processProject` path (with the planned increment as a `planOverride`), so the `TaskScheduler`, ephemeral agents, tests-first guidance, and the Testing Methodology Matrix all apply unchanged.
3. **Evaluate** — a validated **`GoalEvaluator`** verdict (`achieved` / `progressing` / `stalled` / `blocked`) decides whether to continue. A goal is only `achieved` when behaviour-changing work has passing verification.
4. **Repeat** — until the goal is met (verified + confident) or the **closed parameter envelope** (cost / iterations / tokens / wall-clock / no-progress) confines progress.

The loop runs autonomously but pauses at **deny-by-default approval checkpoints** (every N iterations, a budget-fraction crossing, or before write batches). Discovery is prefer-existing and gated; deployments route through the guarded [[Delivery|delivery pipeline]], never run directly. Every run is persisted to `project_memory/operations/missions.json` (+ `missions.md` mirror) for audit. Configure defaults under `atlasmind.loop.*` (see [[Configuration]]).

## Planning Phase

The `Planner` sends the goal + workspace context to the LLM, which returns a `ProjectPlan`. Planning is intentionally reasoning-only: the selected planning provider may be a no-tool reasoning brain, such as an agent reached over ACP. Before execution, AtlasMind validates the returned skill IDs against the enabled registry. Any non-synthesis repository subtask left without valid skills receives the smallest evidence set (`file-read`, `file-search`, `workspace-observability`), forcing execution to route to a model that supports function calling. A dependency-only synthesis step can remain tool-free because it combines prior outputs rather than inspecting the workspace.

AtlasMind now also treats `project_memory/roadmap/improvement-plan.md` as a weighted developer backlog during planning and “what next?” guidance. The manual order of items matters, but it is not absolute: critical, security, architectural, and delivery-risk signals can still override a lower-risk item that simply happens to be near the top.

### An ideation card can be raised as a roadmap item

The ideation board holds nine card kinds — `idea`, `problem`, `experiment`, `user-insight`, `risk`, `requirement`, `evidence`, plus Atlas replies and attachments. Until v0.208.0 it had two outbound paths: launch an autonomous run, or append prose to a memory file. Neither reached the backlog, so the eight-stage workflow began at *Planning & Issue Intake* with nothing feeding it and a card called `requirement` could not become a requirement.

Each card's inspector now carries **Add to roadmap**. The wording is derived, not generated: a `problem` becomes `Fix: …` and a `risk` becomes `Mitigate: …`, because the work is the fix rather than the problem. A `requirement` or an `idea` gets no prefix — putting an idea on the roadmap *is* the commitment, and hedging it would misreport the decision just made. You see the exact line in a dialog before anything is written, because the roadmap is a tracked file.

**The card's connections travel with it.** When that roadmap item is later raised as a GitHub issue, the issue body carries what the work depends on, what supports it, and what contradicts it — the one thing an ideation board knows that no hand-typed issue body contains. Direction matters and is preserved: “this depends on X” and “X depends on this” are opposite plans. A **contradiction is stated as a caution**, never listed among the supporting points.

**Provenance runs both ways.** The card shows the roadmap item it produced; the Roadmap page marks items that came from ideation. Both directions join on the item's *text* rather than its id, because roadmap ids are positional and renumber whenever an item is inserted above them — so an item that moved is still found, and an item that was renamed is reported as no longer linked rather than shown against whatever now occupies its place.

The Roadmap page also counts what is **still on the board**, separating the cards that matter: an idea nobody has acted on is not a problem, but a written-down problem, requirement or risk that never reached the backlog is.

### A roadmap item can be raised as a GitHub issue

Each open item on the Project Dashboard's **Roadmap** page carries **Raise as issue**. The roadmap held the work structured, prioritised and gate-tagged; issues could only be created by hand-typing a title, a body and a comma-separated label list. Anybody planning here and tracking on GitHub retyped every item.

**The draft is derived, not generated.** No model is in this path, so the same item produces a byte-identical issue every time — which is what makes it reviewable: the rule that chose a label is visible, and the next item's output is predictable. A generated issue title would be a claim nobody checked, posted publicly in your name.

**It drafts; it does not file.** The text lands in the issue composer for you to read and edit, and posting goes through the same modal confirmation as every other issue write. Completed items are not offered at all, and asking for one anyway confirms first.

**Labels come only from the declared taxonomy**, because an invented label is *created* on the repository as a side effect of filing. The repository's own spelling wins, and a label intent that matches nothing is stated in the issue body rather than dropped quietly. A gate becomes a label only where the repository already uses that word.

The body's provenance section names the roadmap file and the item id verbatim, and says plainly that closing the issue does not tick the item off and ticking it off does not close the issue — an issue that does not record where it came from becomes a duplicate the first time somebody reads the roadmap again.

### Roadmap replies ask before they plan

When a roadmap-context prompt reaches chat, AtlasMind reads the SSOT roadmap files live and responds in one of two ways depending on intent:

- **Plan / build requests** ("plan the fastest safe route to MVP", "build the roadmap to MVP") want an actual plan, not a status dump. If unanswered project basics block that, the reply is a focused **"Plan your MVP"** ask that lists *only* those gaps (`Project type`, `Target audience`, `Timeline`, `Tech stack`, …) as direct questions — no backlog dump. With no gaps left, AtlasMind defers to real planning (the model) instead of returning a summary.
- **Status / progress requests** ("what are the outstanding roadmap items?", "roadmap progress") still get a deterministic **Roadmap Status** summary: the `X/Y` progress count, the answerable questions, and the outstanding list rendered in a collapsed disclosure so it never dominates the view.

Both shapes share the same answering model:

- **Answer everything in one message.** A single **Answer all** chip beneath the reply pre-fills the composer with a fill-in-the-blank block covering every gap (cursor positioned on the first field). Finish the lines and send — chips pre-fill rather than auto-submit, so you stay in control of the wording. AtlasMind records the answers and, for a plan request, proceeds to order the backlog.
- **Counts only real work.** Shipped `release-history.md` notes, already-resolved metadata (e.g. `Tech stack: C#`), and scaffold/legend prose are excluded from the tally. In `improvement-plan.md`, only checklist lines inside the managed `<!-- atlasmind:roadmap-items:start/end -->` block are treated as outstanding; the Project Context and Prioritisation Notes sections are not.

### Road to MVP — and to every release after it

The Roadmap page of the Project Dashboard opens with a **Road to …** section that turns the backlog into a guided path to a shippable release:

- **Release gates.** MVP is the built-in first gate; **+ New gate** declares your own (a public beta, `v1.0`, `v2`), up to 12. A gate selector above the card switches which release the path, progress, and route describe, and each chip carries that gate's completed/total count. Gates are declared in their own managed block in `improvement-plan.md` (`<!-- atlasmind:roadmap-gates:start/end -->`) as readable markdown, so they diff and review like everything else in SSOT. Removing a gate removes its tag from every item and **never deletes backlog work**; the MVP gate cannot be removed at all.
- **Per-item membership.** Each backlog item shows one toggle per declared gate, so an item can belong to the MVP *and* the beta. Membership is stored non-destructively as `#<gate>` tags appended inside the existing managed items block; the tags are metadata, never appear in the displayed item text, and round-trip cleanly through every save. Only *declared* gates are read as tags, so an item reading "fix the #2 case" keeps its wording instead of inventing a gate.
- **Visual guide.** A progress bar plus a numbered **milestone track** (each node rendered done / active-next / pending) show how far along the road to the selected gate the project is, alongside on-path / completed / remaining counts and a percent readout.
- **AI-assisted route.** A deterministic **best route** orders the remaining objectives for the selected gate — front-loading foundational, security, and architectural work — and explains the reasoning for each step, with a highlighted **Next step** callout. The **Plan the … route with Atlas** button hands a focused, dependency-aware prompt to a live Atlas chat session (the same handoff pattern used by Gap Analysis), so no model calls are added to ordinary dashboard refreshes.
- **Heuristic help stays MVP-only.** When nothing is tagged for MVP, the dashboard falls back to **suggested foundations** (security, architecture, and other foundational items) so the section is useful immediately, each offering **Add to MVP**. A user-created gate gets no such guess: which items belong in someone's "v2" is a release decision, not something to infer.

```typescript
interface ProjectPlan {
  goal: string;
  subtasks: SubTask[];
}

interface SubTask {
  id: string;
  title: string;
  description: string;
  role: string;           // e.g. "architect", "tester", "backend-engineer"
  skills: string[];       // required skill IDs
  dependencies: string[]; // IDs of subtasks that must complete first
}
```

### Constraints

- **Maximum 20 subtasks** per plan
- **Cycle detection** via Kahn's algorithm - cyclic edges are removed
- Each subtask gets a **role** that maps to an ephemeral agent (see [[Agents]])
- For behavior changes, the planner prefers test-authoring or regression-capture subtasks ahead of implementation subtasks so execution can follow a red-green-refactor flow.
- Planned subtasks can now use the testing and observability skills needed to establish or inspect the red signal autonomously.

### Dynamic Skill Catalog

The planner builds its skill catalog **at plan time from the live `SkillsRegistry`**, so every enabled skill — built-in, user-registered, or MCP-connected — is automatically available to subtask agents without any manual additions to the planner prompt.

This includes the full git suite (`git-commit`, `git-push`, `git-branch`, `git-log`, `git-status`, `git-diff`, `git-blame`, `git-apply-patch`) as well as any MCP tools that are connected at the time the plan is made. A static fallback list is used when the registry is unavailable (e.g., offline planning or testing).

The planner is also guided by explicit rules to prefer dedicated skills over `terminal-run` wherever one exists — for example, `git-push` rather than `terminal-run git push`, and `git-commit` (which passes the message as a typed parameter with no shell quoting) rather than `terminal-run git commit -m "..."` which was historically a source of pathspec errors.

---

## Preview & Approval

Before execution, AtlasMind estimates the impact:

```text
estimatedFiles = subtaskCount * projectEstimatedFilesPerSubtask
```

If `estimatedFiles >= projectApprovalFileThreshold` (default: 12), the user must approve before execution proceeds.

The preview shows:

- Total subtask count
- Estimated files touched
- The tests-first execution policy for behavior-changing work
- The fact that AtlasMind will block non-test implementation writes until a failing relevant test signal has been observed
- Dependency graph (visual DAG)
- Per-subtask: title, role, skills, dependencies

---

## Execution Phase

### TaskScheduler

The `TaskScheduler` takes the dependency DAG and:

1. Performs **topological sort** (Kahn's algorithm) to determine execution order
2. Groups independent subtasks into **parallel batches**
3. Executes each batch with up to **5 concurrent** subtasks
4. Each subtask runs through the orchestrator with an ephemeral agent

### Subtask outcomes

Each subtask resolves to one of: `completed`, `failed`, or **`needs-input`**. The last is a *pause*, not a failure: it means the subtask hit an agentic execution cap before producing a final answer. Rather than silently recording the cap message as successful output, chat asks whether to **use the suggested limit for this run**, **save it permanently**, or **keep the partial result**. These are immediate chips, not inert transcript text. A one-run choice restores the previous live limit after the retry; only the permanent choice writes `atlasmind.maxToolIterations` or `atlasmind.maxToolCallsPerTurn`. The run stays `paused` until that decision, and Project Run Center retains the suggested value.

A subtask is only marked `completed` when it actually delivered. A response that ends on an unrecovered tool error, that announces an action without following through ("Let's inspect…"), that says required workspace tools are disabled/unavailable, or that signals incomplete/unverified work is classified as `failed` (after one recovery retry), so dependents are skipped and the run reports honest completed/failed counts rather than a false "N/N completed". When a tool-backed runtime emits that refusal during execution, AtlasMind first hands the subtask to another tool-capable model instead of accepting the reasoning-only response.

### Ephemeral Agents

Each subtask spawns a temporary agent with a role-specific system prompt:

| Role | Focus |
| --- | --- |
| `architect` | System design, patterns, scalability |
| `backend-engineer` | APIs, data layers, performance |
| `frontend-engineer` | UI components, accessibility |
| `tester` | Test authoring, coverage, edge cases |
| `documentation-writer` | Docs, clarity, completeness |
| `devops` | CI/CD, infrastructure, deployment |
| `data-engineer` | Data models, pipelines |
| `security-reviewer` | OWASP, threats, mitigations |
| `general-assistant` | Fallback |

For code-changing subtasks, each ephemeral agent is also instructed to:

- locate the closest relevant tests and verification commands first
- add or update the smallest automated test before implementation when the task is testable
- establish a failing relevant test signal before non-test implementation writes are allowed
- aim for a red-green-refactor loop and report the test and verification evidence it observed
- explain why direct TDD is not applicable when the work is documentation-only, infrastructure-only, or otherwise not realistically testable

### Model Selection for Parallel Execution

The model router's `selectModelsForParallel()` allocates models across concurrent slots:

- Subscription/free models fill the first slot
- Pay-per-token models absorb overflow
- Cost is balanced across the batch

### Checkpoints

Before each write operation during execution:

- `CheckpointManager` captures file snapshots
- If a subtask fails, files can be rolled back to the pre-subtask state

---

## Synthesis Phase

After all subtasks complete, the orchestrator:

1. Collects results from each subtask
2. Sends them to the LLM for a unified synthesis report that also calls out test evidence and verification outcomes when present
3. Reports total cost, files changed, and any failures
4. Surfaces up to `projectChangedFileReferenceLimit` (default: 5) clickable file references
5. Persists per-subtask TDD compliance status so the Project Run Center can show which subtasks were verified, blocked, or not applicable

---

## Run History

Completed runs are saved to the Project Run History:

- **Location:** `project_memory/operations/` (configurable via `projectRunReportFolder`)
- **Format:** JSON with a short subject `title`, the full goal, plan, results, timing, and cost breakdown
- **Access:** `/runs` command or **AtlasMind: Open Project Run Center**

When a run is launched from Project Ideation, its run record also stores the originating board and card metadata. That lets the Run Center show where the run came from and, once the run finishes, send the learned output back into the originating ideation thread or start a fresh ideation thread from the run's results.

Run history is workspace-scoped. Previews, live run state, and completed run metadata are stored under the active workspace so a run created in one repository is not shown or resumed inside another repository.

When AtlasMind first encounters older global run-history entries that predate workspace scoping, it adopts those legacy runs into the active workspace so existing history remains visible after upgrade instead of disappearing.

The Run Center webview shows:

- Run status (completed, failed, partial)
- Short subject title, full goal, and timestamp
- Subtask breakdown with per-task status
- Total cost and token usage
- Options to discuss the draft in chat, inspect details, feed learned output back into ideation, or delete non-running history entries without deleting workspace files

Preview guidance in the Run Center is review-oriented rather than blocking: the estimated file count is advisory, not a hard cap, and the approval threshold is there to suggest extra review or batch checkpoints when scope expands. When batch approval is off, the UI hides the manual approve action instead of presenting an irrelevant control.

When AtlasMind creates a preview or persists a completed autonomous run, it derives a concise 1-3 word subject title from the goal and stores that title with the run record. Legacy run-history entries that predate the `title` field are upgraded on read so existing history keeps a usable label after extension upgrade.

When a reviewed draft is still very large, the Run Center can now stage it into planner jobs automatically. Atlas executes the first dependency-safe job, stores the completed outputs as seed context, and queues the remaining subtasks as the next previewed draft so the operator can keep working through a large project in multiple deliberate stages instead of one oversized run. Follow-up drafts keep the prior-stage seed outputs, so later planner jobs still receive the dependency context they need from earlier stages.

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `atlasmind.projectApprovalFileThreshold` | `12` | Estimated changed-file count that triggers approval |
| `atlasmind.projectEstimatedFilesPerSubtask` | `2` | Heuristic multiplier for file impact estimation |
| `atlasmind.projectChangedFileReferenceLimit` | `5` | Max clickable file references in the summary |
| `atlasmind.projectRunReportFolder` | `project_memory/operations` | Where run reports are saved |
| `atlasmind.toolApprovalMode` | `ask-on-write` | Controls approval gating during execution |

---

## Tips

- **Start small** - test with a focused goal before running large refactors
- **Review the preview** - check the dependency graph makes sense before approving
- **Use `/runs`** - review past runs to learn what works and refine your prompts
- **Memory helps** - the more SSOT context you have, the better the planner understands your codebase

---

## Roadmap Additions

The near-term roadmap for AtlasMind's project and chat workflows also includes:

- **Workspace observability** so AtlasMind can proactively inspect Problems, test results, and recent terminal command output before answering or taking action.
- **Debug-session integration** so AtlasMind can inspect active sessions, stack traces, variables, and Debug Console context when troubleshooting.
- **Safe output and terminal readers** so AtlasMind can reason over what VS Code is already showing the user instead of relying only on newly executed commands.
- **Multimodal ideation extraction** so screenshots, transcripts, audio, and short videos can become structured evidence or user-insight cards instead of staying as raw attachments.
- **Validation generation** so selected idea, risk, and requirement cards can produce experiment briefs, smoke tests, landing-page tests, concierge tests, and prototype scripts directly from the whiteboard.
- **Project-memory sync targets** so high-signal ideation cards can be promoted into durable SSOT artifacts under domains such as `domain`, `operations`, `agents`, or future knowledge-graph exports.
- **Cross-project pattern reuse** so ideation can pull recurring risks, experiments, and prior solution motifs from other AtlasMind project-memory stores when shaping a new execution candidate.
- **Meta-thinking overlays** so the whiteboard can expose bias checks, evidence heatmaps, stale-card detection, and confidence-versus-risk lenses before a `/project` run starts.
- **Scheduled revisits and collaboration** so AtlasMind can re-open unresolved ideation threads later and eventually support richer multi-operator facilitation workflows.


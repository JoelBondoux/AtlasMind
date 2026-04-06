# Project Planner

The `/project` command decomposes a high-level goal into a DAG of subtasks and executes them autonomously. For code-changing work, the planner and ephemeral agents now bias toward an autonomous test-driven-development loop instead of implementation-first execution.

## Overview

```
@atlas /project Refactor the auth module to use JWT tokens
```

**Flow:**
1. **Planning** — LLM generates a `ProjectPlan` with subtasks, dependencies, and roles
2. **Preview** — Estimated file impact is shown; approval gated if above threshold
3. **Execution** — `TaskScheduler` runs subtasks in topological batches with tests-first subtask guidance
4. **Synthesis** — Final report aggregates results across all subtasks
5. **Persistence** — Run saved to Project Run History for review

---

## Planning Phase

The `Planner` sends the goal + workspace context to the LLM, which returns a `ProjectPlan`:

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
- **Cycle detection** via Kahn's algorithm — cyclic edges are removed
- Each subtask gets a **role** that maps to an ephemeral agent (see [[Agents]])
- For behavior changes, the planner prefers test-authoring or regression-capture subtasks ahead of implementation subtasks so execution can follow a red-green-refactor flow.
- Planned subtasks can now use the testing and observability skills needed to establish or inspect the red signal autonomously.

---

## Preview & Approval

Before execution, AtlasMind estimates the impact:

```
estimatedFiles = subtaskCount × projectEstimatedFilesPerSubtask
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

### Ephemeral Agents

Each subtask spawns a temporary agent with a role-specific system prompt:

| Role | Focus |
|------|-------|
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
- **Format:** JSON with goal, plan, results, timing, and cost breakdown
- **Access:** `/runs` command or **AtlasMind: Open Project Run Center**

The Run Center webview shows:
- Run status (completed, failed, partial)
- Goal and timestamp
- Subtask breakdown with per-task status
- Total cost and token usage
- Options to re-run or inspect details

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `atlasmind.projectApprovalFileThreshold` | `12` | Estimated changed-file count that triggers approval |
| `atlasmind.projectEstimatedFilesPerSubtask` | `2` | Heuristic multiplier for file impact estimation |
| `atlasmind.projectChangedFileReferenceLimit` | `5` | Max clickable file references in the summary |
| `atlasmind.projectRunReportFolder` | `project_memory/operations` | Where run reports are saved |
| `atlasmind.toolApprovalMode` | `ask-on-write` | Controls approval gating during execution |

---

## Tips

- **Start small** — test with a focused goal before running large refactors
- **Review the preview** — check the dependency graph makes sense before approving
- **Use `/runs`** — review past runs to learn what works and refine your prompts
- **Memory helps** — the more SSOT context you have, the better the planner understands your codebase

---

## Roadmap Additions

The near-term roadmap for AtlasMind's project and chat workflows also includes:

- **Workspace observability** so AtlasMind can proactively inspect Problems, test results, and recent terminal command output before answering or taking action.
- **Debug-session integration** so AtlasMind can inspect active sessions, stack traces, variables, and Debug Console context when troubleshooting.
- **Safe output and terminal readers** so AtlasMind can reason over what VS Code is already showing the user instead of relying only on newly executed commands.

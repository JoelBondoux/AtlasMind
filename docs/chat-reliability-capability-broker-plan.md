# Chat reliability and capability broker plan

**Status:** approved for incremental delivery

**Owner:** AtlasMind

**Approved:** 2026-08-22

**First implementation milestone:** revisioned session context and safe approval state

**Delivery status:** item 1, transcript revision and context invalidation, is implemented in source
v0.382.4. Maintenance coalescing and raw-turn durability remain the next item.

## Problem

AtlasMind already has broad developer tooling, deterministic task-scoped selection, and a `find-tool`
escape hatch that can add a withheld schema during the agent loop. The chat process still has correctness
and transparency gaps that prevent it from making a reliability claim alongside Copilot, Claude, and
Codex: transcript mutations can leave a stale rolling summary behind; overlapping maintenance can drop a
completed turn; the structured session bundle does not participate in every tool-selection decision; and
the operator cannot see an authoritative receipt of the context and capabilities used for a turn.

The product needs one shared turn-assembly boundary and a hybrid capability broker: AtlasMind should
preload a small deterministic set of likely tools, let the agent request an eligible capability it still
needs, and require explicit one-turn elevation before an installed but unassigned external capability can
enter the turn.

## Goals

- Never dispatch a turn with context derived from a deleted or superseded transcript revision.
- Preserve every completed raw turn even when model-based context maintenance overlaps or fails.
- Give at least 95% of benchmark development tasks every required tool on the initial model call.
- Let at least 99% of benchmark tasks recover with no more than one capability-discovery round.
- Reduce median tool-schema tokens by at least 30% relative to the current selector.
- Keep capability discovery, loading, elevation, and invocation behind the existing authorization ceiling.
- Give the operator a privacy-safe, authoritative context-and-tools receipt for every turn.
- Make the dedicated Chat panel and native `@atlas` participant use the same turn-assembly contract.

## Non-goals

- Sending every installed schema on every request.
- Letting a model install, enable, authenticate, or trust a capability automatically.
- Using a model as the authorization or safety classifier.
- Persisting one-turn elevation into an agent definition or workspace policy.
- Learning opaque capability-ranking weights in the first version; initial selection remains deterministic.
- Persisting raw prompts, context bodies, secrets, or tool arguments in the turn receipt.

## Architecture decision

AtlasMind will use a **hybrid two-pass capability broker**:

```text
Turn inputs
    |
    v
Shared Turn Context Assembler
    |
    v
Ranked capability plan
    |
    v
Model router selects a model and context window
    |
    v
Broker materializes the best schemas within that model's token budget
    |
    v
Model call
    |
    +-- find-tool --> add an eligible tool within the remaining budget
    |
    `-- elevation --> ask before adding an installed but unassigned capability
```

This is an evolution of the current seams. `selectTaskScopedSkills` already performs the first heuristic
pass, `find-tool` already searches the eligible pool, and the tool loop already appends discovered schemas
for its next iteration. The new design makes the shared context, budget, health, authorization, and receipt
explicit rather than adding a parallel tool system.

## Workstream 1 — context and safety stabilization

This is the release-blocking foundation.

- Every transcript mutation increments a session revision.
- A derived session bundle records the transcript revision it summarizes and its freshness state.
- Clear, delete, edit, regenerate, session deletion, and New Chat synchronously invalidate the prior bundle.
- The raw completed turn is appended before any model-based maintenance begins.
- Per-session maintenance coalesces to the latest snapshot and reruns when a newer revision arrived while
  the current pass was active.
- A derived summary is reported as derived context, never as conversation ground truth.
- A non-cancellation failure retains the streamed partial response and appends an error/retry footer.
- Approval automation is scoped explicitly and never resolves pending requests merely because a mode was
  toggled.

### Acceptance gates

- No prompt dispatches with `bundle.sourceRevision !== transcript.revision`.
- Two rapidly completed turns both appear in raw history and maintained context.
- New Chat sends no context from the cleared conversation.
- Edit and regenerate cannot race a stale context rebuild.
- Enabling an automation mode resolves no existing approval request.
- Stream-then-fail preserves all text already received.

## Workstream 2 — shared turn context assembler

Add one core `ChatTurnAssembler` used by the dedicated panel, native participant, project execution, and
capability selection. It produces an ephemeral `TurnContextEnvelope` containing:

- session and transcript revision;
- context sources with trust and provenance classification;
- redaction, truncation, and freshness state;
- a bounded host-derived intent synopsis;
- active editor, selection, attachment, Problems, terminal, Git, and project-memory context;
- model candidates and context-budget information;
- the capability eligibility ceiling; and
- capabilities explicitly pinned or excluded by the operator.

Only a privacy-safe receipt is stored in transcript metadata. The raw context remains ephemeral.

## Workstream 3 — capability broker v2

Introduce a `CapabilityBroker` and a descriptor that separates capability metadata from the full JSON
schema:

```ts
interface CapabilityDescriptor {
  id: string;
  kind: 'tool' | 'instruction' | 'workflow';
  category: string;
  summary: string;
  routingHints: string[];
  source: 'builtin' | 'custom' | 'mcp';
  eligibility: 'eligible' | 'elevatable' | 'forbidden';
  availability: 'ready' | 'disconnected' | 'disabled' | 'failed-scan' | 'unauthenticated';
  estimatedSchemaTokens: number;
  potentialRisk: ToolRiskCategory;
}
```

The broker operates in two passes:

1. **Plan:** rank capability ids using explicit names, requested operations, operation bundles, structured
   session continuation, project stack, agent affinity, routing hints, health, risk, and schema cost.
2. **Materialize:** once routing chooses a model, include the highest-value full schemas that fit that
   model's tool-definition budget.

Selection remains deterministic. Explicit user pins win; a tool denied by the agent policy or turn
envelope never enters a candidate pool. The fixed count ceiling remains as a second guard, but an adaptive
token ceiling becomes the primary limit. Repeated discovery calls share one cumulative budget.

Dynamic additions must update the authoritative turn capability state, current execution record, agent
handoff ceiling, prompt budget, and final receipt. A completion-only turn explicitly disables discovery;
an ordinary actionable turn whose heuristic selected nothing retains the discovery escape hatch.

## Workstream 4 — deferred discovery and one-turn elevation

The stable prompt carries only a compact catalogue:

```text
Workspace | Code intelligence | Execution | Git | Research | Memory
External integrations: 7 installed, 5 ready
Use find-tool when the tools provided cannot complete the task.
```

For an already eligible capability, `find-tool` may add the strongest bounded matches immediately. For an
enabled, scan-passed and healthy custom or MCP capability outside the current agent ceiling:

1. the host searches the installed registry locally;
2. the model receives a bounded candidate description;
3. the model requests a specific capability and states why;
4. AtlasMind presents a separate elevation approval;
5. approval loads only that capability for the current turn; and
6. invocation still passes through normal tool policy and approval.

Elevation is deny-by-default and never changes the persisted agent or workspace configuration.

## Workstream 5 — context and capability receipt

Extend transcript metadata with a privacy-safe receipt that records:

- context revision and freshness;
- included, truncated, redacted, stale, or excluded source labels;
- initial, discovered, elevated, unavailable, and denied capabilities;
- the host-derived reason each initial tool was selected;
- schema-token usage and remaining budget;
- model and agent;
- approval, retry and failover events;
- executed tool ids, cost, and changed-file count.

The context meter must use this same envelope and the selected model. The panel exposes the data through
one keyboard-operable **Context & tools** disclosure beneath the response.

## Workstream 6 — competitive chat controls

After the correctness boundary is in place:

- add a unified context picker for files, folders, symbols, selection, Problems, terminal output, Git
  changes, browser context, and recent chats;
- add an explicit tool picker with turn and session pinning;
- separate interaction intent (`Ask`, `Plan`, `Act`, `Loop`) from permission mode (`Manual`, `Safe Auto`,
  dangerous bypass behind explicit confirmation);
- add an integrated changed-files review;
- repair model-picker and media-dialog keyboard/focus behavior;
- move low-frequency transcript utilities out of the primary composer row; and
- preserve equivalent behavior and receipts in both chat surfaces.

## Test programme

Deterministic fixtures cover explanation, investigation, editing, testing, debugging, Git, delivery,
browser, Docker and MCP tasks; terse continuations; explicit no-write/no-command constraints; unavailable
integrations; repeated discovery; elevation denial; provider failure; restart; and hostile content inside
files, web results, and tool output.

Release gates are:

- full compile and `npm run test:ci`;
- the automated chat stress battery;
- the live twelve-lane battery in both chat surfaces;
- keyboard-only and screen-reader checks;
- provider-failure and MCP-disconnect chaos cases; and
- no passing test run that repeatedly logs caught infrastructure errors.

## Success measures

| Measure | Target |
|---|---:|
| Required initial capability recall | at least 95% |
| Completion with at most one discovery round | at least 99% |
| Median tool-schema token reduction | at least 30% |
| Discovery use on ordinary turns | below 15% |
| Authorization or elevation escapes | 0 |
| Stale-context dispatches | 0 |
| Lost completed turns | 0 |
| Keyboard-operable Chat controls | 100% |
| Live battery | no zero in safety/context lanes; at least 90% overall |

## Delivery order

Each item is an independently revertible, versioned commit with its matching documentation:

1. transcript revision and context invalidation;
2. maintenance coalescing and raw-turn durability;
3. partial-response preservation;
4. approval-mode correction;
5. shared turn assembler;
6. capability broker v2 and adaptive budgets;
7. deferred elevation;
8. receipt and authoritative context meter;
9. context/tool picker and interaction modes; and
10. accessibility and live-evaluation hardening.

Bug fixes use patch releases. New services and user-facing capabilities use minor releases. The context
visualizer, multi-file diff review, eval harness, prompt-injection defence, and LLM observability roadmap
items are dependencies or consumers of this plan rather than competing implementations.

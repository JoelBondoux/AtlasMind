# Chat reliability and capability broker plan

**Status:** approved for incremental delivery

**Approved:** 22 August 2026

**Delivery status:** transcript revision and synchronous context invalidation shipped in source v0.382.4;
maintenance coalescing and raw-turn durability are next.

AtlasMind will make its two chat surfaces share one revisioned context and capability-selection boundary.
The full engineering plan is maintained in
[`docs/chat-reliability-capability-broker-plan.md`](../docs/chat-reliability-capability-broker-plan.md).

## Decision

AtlasMind will use a hybrid capability broker:

1. The host derives a bounded intent synopsis from the prompt and trusted session state.
2. A deterministic heuristic ranks the tools and skills most likely to be needed.
3. The model router chooses a model and context window.
4. Only the highest-value full schemas that fit that model's tool budget are sent initially.
5. `find-tool` lets the agent request another capability from its existing eligibility ceiling.
6. An installed but unassigned custom or MCP capability requires explicit one-turn elevation before its
   schema is added.
7. Loading a schema never approves its execution; normal tool policy still applies.

## Reliability foundation

The capability work follows four release-blocking chat fixes:

- transcript and rolling context revisions must agree before dispatch;
- clearing, deleting, editing, regenerating, or starting a New Chat must invalidate stale derived context;
- overlapping maintenance must coalesce instead of dropping a completed turn; and
- failures must preserve streamed partial output while approval automation remains scoped and explicit.

## What operators will see

- A context picker covering files, folders, symbols, selections, Problems, terminal output, Git changes,
  browser context, and recent chats.
- A tool picker with turn- and session-scoped pins.
- Separate Ask, Plan, Act, and Loop interaction modes.
- A keyboard-operable **Context & tools** receipt beneath every response showing what was included,
  truncated, redacted, selected, discovered, elevated, unavailable, denied, approved, and executed.
- An authoritative context meter derived from the prompt actually sent to the selected model.

The receipt stores labels, ids, counts, token estimates, status, and fingerprints. It does not persist raw
prompts, source bodies, secrets, or tool arguments.

## Success gates

- Zero stale-context dispatches or lost completed turns.
- At least 95% initial required-capability recall and 99% completion with no more than one discovery round.
- At least 30% lower median tool-schema token use than the current selector.
- Zero authorization or elevation escapes.
- Every Chat control usable from the keyboard.
- No zero score in a live safety/context battery lane and at least 90% overall.

Implementation is split into independently revertible commits: context revision, maintenance durability,
partial-response preservation, approval correction, shared turn assembly, Capability Broker v2, elevation,
receipts, composer controls, and accessibility/evaluation hardening.

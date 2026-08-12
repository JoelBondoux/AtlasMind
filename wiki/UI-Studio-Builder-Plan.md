# UI Studio Builder Plan

UI Studio is becoming a complete visual design and content tool for websites and any repository UI. The
full preview in VS Code's built-in browser is the primary place to judge structure, real content, and style
together; it is a deterministic view of the saved design, not another editable source of truth.

The full engineering/product contract lives in
[`docs/ui-studio-builder-plan.md`](https://github.com/JoelBondoux/AtlasMind/blob/develop/docs/ui-studio-builder-plan.md).
This page summarizes the delivery promise.

## Principles

- One authoritative design graph feeds the canvas, outline, preview, generated guide, and handoff.
- Every edit is structured, validated, revision-checked, undoable, and auditable.
- Responsive values inherit until an explicit viewport override replaces them.
- Components use definitions and instances; content, assets, data, and UI states are first-class.
- Source mappings are explicit and report divergence. AtlasMind does not claim arbitrary code is
  losslessly round-trippable.
- Models may propose the same closed edit commands as direct manipulation; ordinary editing never requires
  a model.
- Accessibility, responsiveness, content, and performance remain pass, fail, or visibly unassessed.

## Delivery phases

| Phase | Outcome |
|---|---|
| 0. Contract | Product plan, architecture decisions, and three reference projects |
| 1. Foundation | v6 graph, safe command reducer, history, live preview transport, selection sync |
| 2. Layout | Competitive responsive stack/grid/free/overlay layout and direct manipulation |
| 3. System | Tokens, reusable components, variants, properties, slots, and interaction states |
| 4. Content | Structured content, assets, data bindings, and empty/loading/error/success design |
| 5. Repository | Framework adapters, source mappings, divergence, and reviewable proposed diffs |
| 6. Quality | Accessibility, responsive, content, and performance gates |
| 7. Agency | Revision-linked approval, comparison, and element-scoped review |
| 8. Ecosystem | Imports, libraries, plugins, and exports with explicit loss reports |

## First milestone

Phase 1 is complete through v0.278.0. The v6 graph, lossless v5 migration, closed edit commands, monotonic
undo/redo, frozen live runtime, revision-checked two-way selection, and reducer-backed canvas gestures now
run through committed scenarios for a marketing site, data-rich web application, and non-web UI. Those
fixtures assert migration/save/reopen integrity, the shared edit/history/selection contract, deterministic
real-content full preview, and a target-independent graph. Phase 2 begins with responsive inheritance and
competitive layout controls.

Phase 2 started in v0.279.0 with a deterministic desktop → tablet → mobile resolver that reports the source
of every computed layout property. Revisioned set/clear commands now manage viewport geometry and visibility;
clearing an override restores inheritance, and the same behaviour runs across all three reference projects.
In v0.280.0 the deterministic full preview began projecting that inherited layout at tablet/mobile browser
widths with static media rules. v0.281.0 adds host-resolved Studio breakpoint controls and a provenance-aware
inspector that applies or independently resets geometry and visibility. v0.282.0 adds direct breakpoint
drag, resize, and keyboard nudge without granting responsive gestures authority over structure. v0.283.0
adds atomic multi-selection, six-axis alignment, two-axis distribution, and group nudge at every breakpoint.
v0.284.0 makes stack/grid/overlay real deterministic container layouts with direction, gap, padding, columns,
alignment, distribution, fill/hug sizing, responsive inheritance, and one canvas/preview projection. v0.285.0
adds nullable min/max width/height constraints to that projection with responsive inheritance and provenance.
Wrapping/ordering, duplicate, lock, group drag, and diagnostics remain to complete the phase.

Container layout is deliberately a projection over retained child rectangles. Free mode and undo therefore
restore what somebody drew; hug uses that stored intrinsic box until the content phase adds measurement.
Constraints follow the same rule: they bound the displayed size while retaining the drawn/intrinsic rectangle.

The architecture choices are recorded in `project_memory/decisions/` so later implementation cannot
silently change who owns the design, what the browser may send, or what migration is allowed to invent.

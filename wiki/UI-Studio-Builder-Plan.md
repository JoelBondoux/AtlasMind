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
v0.286.0 adds stack wrapping and bounded responsive sibling order without changing stored array order.
v0.287.0 adds one-revision subtree duplication with remapped identities and reducer-enforced node locking.
v0.288.0 adds one-revision group pointer drag at base and responsive breakpoints. v0.289.0 completes Phase 2
with deterministic overflow, parent-clipping, overlap, and 44px touch-target diagnostics at every breakpoint.

Container layout is deliberately a projection over retained child rectangles. Free mode and undo therefore
restore what somebody drew; hug uses that stored intrinsic box until the content phase adds measurement.
Constraints follow the same rule: they bound the displayed size while retaining the drawn/intrinsic rectangle.
Wrapping and order also remain projected: reset/free/undo recover the exact underlying graph arrangement.
Duplication validates the complete subtree before it writes and offsets explicit responsive rectangles with
base geometry. Lock is a graph fact, not disabled-browser styling: only Unlock may mutate a locked node.
Group drag preserves relative spacing, clamps the complete bounds, excludes selected nodes from snapping,
and never changes hierarchy.
Diagnostics consume the same resolved screen as Studio and Full Preview. Ancestor and overlay overlap are
intentional exclusions; touch sizing converts through the responsive lab's actual fixed viewport widths.

Phase 3 started in v0.290.0 with format v7 and typed target-independent token definitions for colour,
typography, spacing, radius, shadow, motion, and breakpoints. The host bounds every value and permits an
alias only when its same-kind path reaches a direct definition without a cycle. The v6 → v7 migration adds
an empty collection rather than inventing a design system. Component definitions/instances, variants,
slots, properties, and interaction states followed in format v8.

v0.291.0 makes those definitions editable in UI System through exact revisioned add/set/delete commands and
the existing undo/redo history. Reserved semantic ids drive colour, fonts, spacing, radius, and breakpoint
behaviour in both the Studio canvas and Full Preview; every resolved definition is also available to the
preview adapter under a uniquely encoded custom property.

v0.292.0 completes Phase 3 with reusable component definitions, explicit canvas instances, typed properties,
variants, bounded slots, and closed interaction/system states. Defaults, variant values, and instance
overrides resolve deterministically with provenance; definition and instance editors remain separate and all
mutations use the same exact revision/history boundary. Studio, Full Preview, and the Markdown mirror consume
the same resolved facts. The v7 → v8 migration adds no inferred component.

Phase 4 starts in v0.293.0 with format-v9 node-owned empty/loading/error/success presentations. Each has
bounded title/body/action copy and visible placeholder/draft/reviewed/approved maturity; one authored state may
be selected for Studio and Full Preview review. Long-form screen Markdown remains authoritative, the migration
invents no copy, and placeholder-marked copy cannot claim approval.

v0.294.0 adds format-v10 bounded sample-data collections with typed fields and deliberate review fixtures.
Nodes explicitly map title, body, and action slots to one sample; Studio, Full Preview, and the Markdown mirror
consume the same values without a production connector. Missing collections, samples, fields, values, and
empty/loading/error/success designs are reported at the owning node.

v0.295.0 completes Phase 4 with format-v11 validated asset metadata and stable node assignments. Workspace
paths cannot escape the project; HTTPS references cannot carry credentials, queries, or fragments. Dimensions,
crop/focal intent, alt/decorative intent, and maturity project into Studio, Full Preview, and the Markdown
mirror. Missing ids and alt text are owning-node errors, and Full Preview remains no-network. Phase 5
repository mappings and divergence detection are next.

v0.298.0 starts Phase 5 with format-v12 revisioned mappings from components, tokens, and nodes to contained
workspace files through a closed adapter catalog. Exact host commands create, replace, delete, and verify;
verification stores target/source hashes only and reports in-sync, design-only, code-only, conflict,
unassessed, or unsupported. Source import, capability/loss reports, and approval-gated proposed diffs remain
later Phase 5 slices.

The architecture choices are recorded in `project_memory/decisions/` so later implementation cannot
silently change who owns the design, what the browser may send, or what migration is allowed to invent.

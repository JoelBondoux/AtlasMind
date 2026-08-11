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

The v6 graph, lossless v5 migration, closed edit commands, monotonic undo/redo, and frozen revision-only
built-in-browser runtime are now implemented through v0.275.0. Next are two-way selection and routing basic
canvas edits through the command layer. The milestone exits
only after a marketing site, data-rich web application, and non-web UI all pass the same migration, editing,
history, selection, and preview scenarios.

The architecture choices are recorded in `project_memory/decisions/` so later implementation cannot
silently change who owns the design, what the browser may send, or what migration is allowed to invent.

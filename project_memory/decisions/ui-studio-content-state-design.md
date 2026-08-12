# UI Studio v9 separates interface-state copy from long-form Markdown

**Decided:** 2026-08-12.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`, Phase 4 / P1.3.

## Context

Page Markdown is already authoritative for long-form copy, but a node cannot yet say what somebody sees when
its data is empty, loading, failed, or completed. Reusing a component's visual state is insufficient: `error`
may change appearance, while a state presentation owns the explanation and recovery action. Storing these
facts in format v8 would let an older v8 build accept and erase them.

## Decision

Format v9 adds optional node-owned presentations for `empty`, `loading`, `error`, and `success`, plus one
explicit preview state. Each presentation contains bounded title, body, and action-label fields and a visible
content maturity: `placeholder`, `draft`, `reviewed`, or `approved`. A presentation containing an unresolved
`[PLACEHOLDER: …]` marker cannot remain approved.

These small interface messages complement, never replace, the screen's Markdown file. They live on the graph
node because validation, recovery, empty-state, and success copy belong to the interface element that renders
them. Changing the preview state is a design-review choice, not runtime data binding. Sample-data bindings and
asset metadata will get their own authority in later Phase 4 slices.

Every mutation remains an exact revision-checked graph command. Full Preview renders the selected state
deterministically and labels maturity; it never invents missing state copy.

## Consequences

- The v8 → v9 migration changes only the format number and invents no state presentation.
- Component interaction state and node content state remain separate facts.
- An absent presentation stays visibly absent rather than becoming plausible fallback prose.
- Later data bindings may select among these declared states but may not author their copy implicitly.

## Action items

- [x] Add bounded state-presentation types, sanitation, exact commands, and history. Shipped in v0.293.0.
- [x] Add canvas editing and deterministic Full Preview projection. Shipped in v0.293.0.
- [ ] Add owning-node missing-state diagnostics with the data-binding slice.
- [ ] Add structured collections, sample-data bindings, and asset metadata in subsequent Phase 4 slices.

# UI Studio v10 keeps design samples separate from production data

**Decided:** 2026-08-12.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`, Phase 4 / P1.3.

## Context

Designing only a successful static screen hides the states where real interfaces fail: no records, a slow
response, an error, or a field absent from one record. UI Studio needs realistic data while it is still a
design tool, but importing a production response into the git-tracked design graph would mix personal data,
credentials, unstable API shape, and review fixtures in one authority.

## Decision

Format v10 adds bounded **sample-data collections** to the authoritative graph. A collection declares a closed
field schema (`text`, `number`, `boolean`, HTTPS `url`, or ISO date) and deliberate preview-only records. It may
hold no more than 20 fields and 50 records; the graph may hold no more than 50 collections. Values are bounded,
contain no executable template language, and are described in the UI as fixtures rather than live data.

A node binds explicitly to one collection, one sample record, and one or more semantic slots: title, body, or
action. The binding never authors empty/loading/error/success copy. It only projects declared sample values
into the default preview. Collection edits and node bindings use the same exact, revision-checked, undoable
command boundary as layout, tokens, components, and content states.

Safe editor actions cannot break a binding: deleting a used collection or removing a referenced field/sample
is refused. Hand-edited or future-format files may still contain stale references, so sanitation retains a
well-shaped binding and an owning-node diagnostic reports the missing collection, record, field, or value.
Every bound node also reports any absent empty/loading/error/success presentation. Unknown is visible; it is
never silently treated as a complete content design.

## Consequences

- The v9 → v10 migration adds an empty collection authority and invents no schema, record, value, or binding.
- Full Preview uses only the selected fixture and contains no network request or live-data connector.
- Long-form Markdown remains authoritative for page copy; sample bindings are structured interface content.
- Asset metadata and production/repository data adapters remain separate later slices with their own trust
  boundaries.

## Action items

- [x] Add bounded collections, sample records, exact collection commands, and migration. Shipped in v0.294.0.
- [x] Add explicit node bindings, deterministic preview projection, and owning-node diagnostics. Shipped in v0.294.0.
- [ ] Add asset metadata, focal/crop intent, alt-text checks, and validated references.
- [ ] Add repository/runtime data adapters without importing production records into the design graph.

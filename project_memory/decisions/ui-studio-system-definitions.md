# UI Studio v7 owns typed system definitions inside the design graph

**Decided:** 2026-08-12.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`, Phase 3 / P1.2.

## Context

Responsive layout is complete, but shared visual decisions still live as flat website-era fields and notes.
Tokens, reusable component definitions, instances, variants, and states need stable identities, deterministic
propagation, and the same revision boundary as nodes. Adding those facts to format v6 would be unsafe: an older
v6 build would regard the document as current, sanitize away fields it does not know, and save over them.

## Decision

Format v7 adds target-independent system definitions to `UiDesignGraph`, beginning with typed tokens. Tokens
have stable ids, labels, a closed kind, and either one validated value or a same-kind alias. Colour, typography,
spacing, radius, shadow, motion, and breakpoint values are structured data rather than CSS strings. Alias
resolution is pure, deterministic, and refuses missing targets, kind mismatches, and cycles.

Definitions live inside `website.json`'s authoritative graph initially. This preserves one revision and one
reviewable design document. A separately versioned shared library remains possible after local definition and
instance semantics are proven; adopting it now would create cross-file transactions before there is a valid
consumer model.

Component definitions and instances will join this v7 graph incrementally. A node will name a definition and
bounded instance overrides explicitly. Definition edits and instance edits will remain separate commands and
separate UI actions; neither will be inferred from which object happened to be selected.

## Options considered

- **Versioned definitions inside the graph — accepted.** One revision, deterministic propagation, no
  cross-file partial writes, and a safe older-build refusal through format v7.
- **Add optional fields to v6 — rejected.** Older v6 builds would accept and erase them on save.
- **Separate component-library file now — deferred.** It enables sharing later but introduces identity,
  revision, and transaction boundaries before local semantics exist.
- **Store CSS custom properties and component markup — rejected.** Arbitrary CSS/markup is executable
  presentation syntax, excludes native targets, and turns the design graph into an injection boundary.

## Consequences

- The 6 → 7 migration adds empty definitions only; it invents no tokens or components.
- Token kinds and values require declared bounds and renderer adapters rather than raw style interpolation.
- Import/export formats map into this model with provenance later; no external format becomes authoritative.
- A token/component library can be extracted only with an explicit multi-document revision design.

## Action items

- [x] Add v7 token types, sanitation, alias resolution, migration, and adversarial tests. Shipped in v0.290.0.
- [x] Add closed token edit commands and UI System definition editing. Shipped in v0.291.0.
- [x] Apply resolved tokens through the shared Studio/Full Preview projection. Shipped in v0.291.0.
- [ ] Add component definitions, instances, variants, slots, and states on the same authority boundary.

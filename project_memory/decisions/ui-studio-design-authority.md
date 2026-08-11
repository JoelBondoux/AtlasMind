# UI Studio has one design authority; source mappings record the boundary

**Decided:** 2026-08-11.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`.

## Context

UI Studio now has a canvas, a deterministic full preview, generated guides, content files, and a real
repository. If each is editable as an independent representation, the product cannot answer which version
is the design. Treating arbitrary application source as a losslessly editable canvas document would also
make a promise no general UI tool can keep.

## Decision

The versioned UI design graph is authoritative for Studio-authored design intent. The canvas, outline,
responsive lab, built-in-browser preview, generated guide, and legacy page wireframe are projections of
that graph.

Repository source remains authoritative for the running product. A source mapping explicitly connects a
graph component or node to a repository component, prop, slot, token, and source fingerprint. When both
sides change, AtlasMind reports divergence; it does not silently choose or claim a lossless round trip.

Model output can propose the same closed edit commands available to direct manipulation. It cannot replace
the graph, write an arbitrary graph fragment, or gain source-write authority through the design surface.

## Options considered

- **Graph is authoritative — accepted.** Provides stable IDs, revisions, deterministic projections, and a
  target-independent visual specification.
- **Generated HTML is authoritative — rejected.** It excludes native targets and makes presentation markup
  carry design semantics it cannot express reliably.
- **Repository source is always authoritative — rejected as the Studio model.** It makes framework parsing
  the prerequisite for every design feature and cannot promise lossless interpretation across targets.
- **Canvas and source are peers with automatic last-write-wins — rejected.** Time is not intent; the newer
  edit may be the less informed one, and silent reconciliation loses work.

## Tradeoffs and consequences

- The durable workspace temporarily stores the graph and legacy wireframe projection together while readers
  migrate. This duplication is acceptable only with one declared winner and round-trip tests.
- Source adapters can be honest and incremental. Unsupported constructs remain source-only and visible.
- Applying a generated code change remains a repository mutation subject to AtlasMind's normal approval,
  security, and verification rules.
- A visual approval names a graph revision. It does not assert that diverged source implements that revision.

## Action items

- Add the v6 graph and derive the compatibility wireframes from it.
- Introduce source mappings only after node/component identities are stable.
- Surface design-only, code-only, and conflicting divergence as separate states.


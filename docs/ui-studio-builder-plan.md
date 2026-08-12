# UI Studio — class-leading visual builder plan

**Status:** approved for incremental delivery  
**Owner:** AtlasMind  
**Approved:** 2026-08-11  
**First implementation milestone:** design graph, structured edits, revision history, and live preview protocol

**Progress through v0.292.0:** Phases 1, 2, and 3 are complete. Format v8 combines typed tokens with reusable
component definitions, explicit canvas instances, typed properties, variants, bounded slots, closed states,
and provenance-preserving default → variant → instance resolution. Definition and instance editors use
separate exact commands on the same revision/history boundary. The frozen v6 → v7 and v7 → v8 migrations
invent no design decisions. The contract, screen/node graph, closed edit
reducer/history, frozen live preview transport, revision-checked two-way selection, reducer-backed canvas
gestures, and executable validation across all three reference projects pass. Phase 2 delivered
deterministic base → tablet → mobile inheritance, per-property provenance, revisioned override reset,
responsive projection in both the Studio canvas and full built-in-browser preview, and direct breakpoint
drag/resize/nudge that cannot change shared structure. Multi-selection alignment, distribution, and group
nudge run as one validated revision and undo step. Stack/grid/overlay container modes now deterministically
project direction, gap, padding, columns, alignment, distribution, and fill/hug sizing in both canvas and
full preview, with responsive inheritance and computed-container provenance. Optional min/max width and
height now constrain every layout/size mode without replacing retained geometry. Stack wrapping and bounded
responsive sibling order extend the same shared projection without rewriting hierarchy or node-array order.

## Problem

UI Studio can already describe a general interface, draw page structure, design content, preserve exact
Markdown copy, generate an HTML visual guide, and open a full preview in VS Code's built-in browser. It
does not yet provide the continuous direct-manipulation loop expected of a leading visual builder. The
canvas, preview, generated artefact, and repository implementation can still become separate versions of
the same design, and the current page wireframe cannot express responsive inheritance, reusable component
instances, variants, states, data, or a reversible edit history.

The product must serve two related jobs:

1. Build and maintain web experiences with the fidelity of a strong site builder.
2. Act as a visual design guide for any repository UI, including native mobile, desktop, embedded, and
   editor-extension interfaces whose final implementation is not HTML.

The built-in browser preview is the primary review surface for structure, content, and style. It is a
deterministic projection of the saved design, not a second source of truth.

## Goals

- Make one versioned design graph authoritative for screens, nodes, responsive layout, tokens,
  components, content references, states, and implementation mappings.
- Keep design, content, and style visible together in a full built-in-browser preview.
- Make every editor action structured, validated, reversible, revision-checked, and auditable.
- Support responsive inheritance and intentional breakpoint overrides rather than disconnected drawings.
- Treat components, variants, interaction states, real content, assets, and data as first-class design
  material.
- Connect design nodes to real repository components without claiming arbitrary source code is losslessly
  round-trippable.
- Provide measurable accessibility, responsive, content, and performance checks before work is called
  ready.
- Preserve current Website Studio projects without losing a page, element, parent, label, prompt, note,
  or geometry value.

## Non-goals

- Replacing Figma as a general illustration or vector-authoring application.
- Inventing a proprietary runtime that must ship with the user's product.
- Letting preview JavaScript write arbitrary workspace data, paths, commands, or source fragments.
- Pretending every framework or native UI can be imported and exported without semantic loss.
- Making model availability a requirement for normal layout, content, token, or component edits.
- Operating an AtlasMind-hosted collaboration or client-review service.

## Product principles

1. **One graph, many projections.** Canvas, outline, preview, generated guide, and handoff all read the
   same graph. Preview output is disposable.
2. **Deterministic editing.** A model may propose an edit command, but the same validated command goes
   through the same reducer as a pointer or form edit.
3. **Revision before mutation.** Commands name the revision they read. A stale edit is refused, never
   silently applied to a different document.
4. **Responsive inheritance.** Base values flow down to smaller viewports until a deliberate override
   replaces them.
5. **Definitions and instances.** Reusable components are edited at the definition or instance level
   explicitly; instance overrides cannot quietly rewrite every use.
6. **Content is design.** Real copy, empty/loading/error/success states, assets, and data bindings are
   visible alongside layout and style.
7. **Mappings are explicit.** A graph node can map to a source component and report divergence. It does
   not grant the browser authority to rewrite source.
8. **Unknown is not a pass.** An unrun accessibility, responsive, content, or performance check remains
   visibly unassessed.

## Users and core stories

### Agency designer/developer

- As an agency designer, I can edit layout, tokens, content, variants, and responsive behaviour while
  seeing the whole interface at a realistic viewport.
- As a developer, I can map a visual component to an existing source component and see whether the
  implementation has diverged from the approved design.
- As a reviewer, I can identify exactly which revision and node a comment or approval concerns.

### Product developer

- As a developer building a native or framework UI, I can use the Studio as a visual specification even
  when the output is SwiftUI, Compose, React Native, VS Code webview code, or another non-HTML target.
- As a maintainer, I can undo or redo an edit without losing later history or accidentally accepting a
  stale browser event.

### Content designer

- As a content designer, I can review real copy in context, design system states and recovery language,
  and distinguish approved content from explicit placeholders.

## Requirements

### P0 — trustworthy visual editing foundation

#### P0.1 Versioned design graph

The workspace stores a v7 graph with stable screen and node IDs, parent relationships, base geometry,
viewport overrides, content/style/component references, typed tokens, and a monotonic revision.

Acceptance criteria:

- Opening a v5 workspace produces a v7 graph without changing any existing page or element fact or
  inventing a token.
- Saving and reopening preserves IDs, hierarchy, labels, prompts, notes, breakpoint, and geometry.
- Duplicate, unknown, cyclic, oversized, and out-of-bounds input is sanitized deterministically.
- Newer-format documents are refused and never overwritten.

#### P0.2 Closed edit-command protocol

All graph mutations are named commands handled by a pure reducer. Initial commands cover label and design
intent, movement, resizing, reparenting, visibility, undo, and redo.

Acceptance criteria:

- Every command includes an expected revision and bounded node identifiers/values.
- A stale revision, missing node, invalid parent, cycle, or invalid geometry produces a typed refusal and
  no mutation.
- Successful edits increment the revision exactly once.
- Undo and redo also increment revision monotonically; they never rewind it.
- Session history is bounded and deterministic.

#### P0.3 Live full preview protocol

The built-in browser renders a tokenized loopback URL. The host sends revisioned design updates over a
bounded live channel; the frozen preview runtime reports selection and viewport events only.

Acceptance criteria:

- A saved design opens as a complete, navigable, responsive preview in VS Code's built-in browser.
- A Studio selection highlights the matching preview node, and a preview click selects the matching
  Studio node.
- Browser messages contain only allow-listed event names, IDs, revisions, and bounded viewport values.
- A stale event cannot edit or select against a newer incompatible revision.
- Generated/exported output remains script-free unless an explicitly selected, separately reviewed
  feature requires a frozen script.

#### P0.4 Three reference projects

The foundation is exercised against a marketing website, a data-rich web application, and a non-web UI.
The committed fixtures live in `tests/fixtures/uiStudioReferenceProjects.ts`; their shared scenarios live in
`tests/core/uiStudioReferenceProjects.test.ts`.

Acceptance criteria:

- Each project can be represented without target-specific fields contaminating the shared graph.
- Migration, edit, undo/redo, selection, and full preview scenarios are recorded as repeatable tests or
  fixtures.

### P1 — competitive design capability

#### P1.1 Responsive layout engine

Progress: v0.279.0 delivered the pure inheritance/provenance resolver and exact set/clear commands for
viewport geometry and visibility. v0.280.0 projects those results into the deterministic full preview at
tablet/mobile widths. v0.281.0 adds host-resolved breakpoint controls, computed-property provenance, and
independent geometry/visibility apply/reset in the Studio inspector. The three reference projects exercise
inheritance, reset, and preview. v0.282.0 routes breakpoint drag, resize, and keyboard nudge through the same
exact geometry-override command while leaving structure base-only. v0.283.0 adds atomic multi-selection,
six-axis alignment, two-axis distribution, and group nudge. v0.284.0 turns stack/grid/overlay and fill/hug
into a shared deterministic canvas/preview engine with explicit container settings. v0.285.0 adds inherited,
nullable min/max width/height constraints with per-property provenance and non-destructive projection.
v0.286.0 adds deterministic stack wrapping and responsive sibling ordering. v0.287.0 adds atomic subtree
duplication and reducer-enforced node locking. v0.288.0 adds atomic pointer drag for multi-selections at base
and responsive breakpoints. v0.289.0 completes Phase 2 with deterministic overflow, parent-clipping, overlap,
and minimum-touch-target diagnostics at all three breakpoints.

Implementation note: v0.284.0 deliberately makes container layout a non-destructive projection. Stored child
rectangles remain the free-layout fallback, so switching or resetting a parent cannot lose the arrangement
somebody drew. Hug currently retains that stored intrinsic rectangle; content-derived measurement belongs
with Phase 4 content/assets/data rather than being guessed from placeholder markup.

Implementation note: v0.285.0 applies constraints in that same projection. `null` means no bound; width is
bounded to 1–1000 and height to 1–4000 canvas units. Closed edits refuse an inverted pair. Removing a bound
therefore reveals the retained rectangle instead of trying to reconstruct a size the constraint overwrote.

Implementation note: v0.286.0 sorts direct container children by bounded `order`, then the existing geometry/
id tie-breakers. A wrapping stack packs fixed/hug items until the next cannot fit; fill claims a line. Neither
operation mutates the node array, hierarchy, or stored rectangles.

Implementation note: v0.287.0 treats duplication as one structural command, never a sequence of browser-side
adds. Its complete old→new identity map is validated before remapping descendants and offsetting base plus
explicit responsive rectangles. Lock is authoring state enforced by the same reducer; an operation that would
edit, move, copy, delete, or implicitly reparent a locked node refuses atomically.

Implementation note: v0.288.0 computes the complete selected bounds before a group move, preserves every
relative offset, and excludes the selected identities from snap targets. Pointer-up emits one `set-node-frames`
command. Group drag deliberately does not reparent; changing several hierarchy edges from one drop would make
the gesture ambiguous and broaden the existing single-node structural operation.

Implementation note: v0.289.0 derives diagnostics from `resolveUiScreenLayout`, so the canvas, Full Preview,
and checks cannot disagree about placement. Ancestor overlap and overlay siblings are intentional exclusions.
The 44px touch rule converts through the responsive lab's 1280/834/390 widths; it is not compared directly
with the 1000-unit design grid.

- Stack, grid, free, and overlay layout modes.
- Fixed, fill, and hug sizing.
- Min/max constraints, gaps, padding, alignment, distribution, wrapping, ordering, and visibility.
- Base → tablet → mobile inheritance with per-property reset and override inspection.
- Drag, resize, reorder, nest, multi-select, align, distribute, duplicate, lock, and hide.

Acceptance criteria:

- A single node can explain the source of every computed property.
- Removing an override restores the inherited value.
- Responsive lab surfaces overflow, overlap, clipped content, and minimum touch-target failures.

#### P1.2 Tokens, components, variants, and states

Progress: complete in v0.292.0. v0.290.0 established the typed token authority and frozen format migration. It bounds colour,
font family/size/weight, line-height, spacing, radius, shadow, motion, and breakpoint values; same-kind
aliases resolve to one direct source with an auditable chain. v0.291.0 adds exact add/set/delete commands,
an accessible UI System editor, Markdown review rows, and a shared adapter that applies reserved semantic
ids in the Studio canvas and Full Preview while exposing all resolved tokens as collision-free custom
properties. v0.292.0 adds reusable definitions/instances, typed properties, variants, capacity/kind-constrained
slots, closed interaction/system states, separate visual editors, deterministic propagation, and shared
Studio/Full Preview projection.

- Typed colour, type, spacing, radius, shadow, motion, and breakpoint tokens with aliases.
- Component definitions and instances, slots, properties, variants, and bounded instance overrides.
- Hover, focus, active, disabled, loading, empty, error, success, and validation states.

Acceptance criteria:

- Updating a token or component definition updates every non-overridden consumer deterministically.
- The UI distinguishes definition edits from instance overrides before applying them.
- Broken aliases, recursive component references, and invalid state combinations are refused.

#### P1.3 Content, assets, and data

- Structured content fields and collections complement the existing Markdown source.
- Asset metadata records source, dimensions, crop/focal intent, and alt text without embedding secrets.
- Nodes can bind to bounded sample data and declare empty/loading/error/success presentations.
- Placeholder, draft, reviewed, and approved content remain visibly distinct.

Acceptance criteria:

- Preview never presents invented copy as approved content.
- Missing alt text, broken bindings, absent states, and overflow are reported at the owning node.
- Assets use workspace-relative validated references or approved HTTPS sources.

#### P1.4 Repository mappings and divergence

- Framework adapters map graph components to repository components, props, slots, tokens, and source roots.
- Import is adapter-based and reports unsupported or lossy constructs.
- Generation produces proposed diffs with provenance; it never silently overwrites hand-written code.

Acceptance criteria:

- Every mapping names its adapter, source location, graph revision, and last verified source fingerprint.
- Divergence reports design-only, code-only, and conflicting changes separately.
- Applying a generated source change uses the normal tool approval and verification boundary.

### P2 — quality, collaboration, and ecosystem

- Per-node and per-screen accessibility diagnostics, keyboard path review, contrast checks, and heading/
  landmark validation.
- Performance budgets for image weight, CSS/JS size, and measurable preview/runtime signals.
- Revision-linked approvals and existing element-scoped client review.
- Optional Figma/design-token import, Builder-style framework adapters, reusable libraries, plugins, and
  exports.
- Branch-aware design comparison and merge assistance after graph semantics are stable.

Acceptance criteria:

- Unassessed checks remain visible and block only when the project's declared policy says they block.
- Imported artefacts retain provenance and a loss report.
- Collaboration features do not require AtlasMind to host customer design or review data.

## Architecture

```text
website.json v7 + content/ + assets + source mappings
                    |
            bounded sanitization
                    |
        authoritative UI design graph
                    |
      edit reducer + revision journal
          /                    \
 Studio canvas/outline     deterministic renderer
                                  |
                   tokenized loopback preview server
                                  |
                      VS Code built-in browser
                                  |
                 bounded selection/viewport events
```

The compatibility filename remains `project_memory/domain/website.json` through 1.0. The product name and
schema semantics are generalized; changing the durable path would create needless migration and tooling
risk. The graph is authoritative when present. Legacy page wireframes remain a compatibility projection
until every current reader has moved to the graph.

Detailed decisions live in:

- `project_memory/decisions/ui-studio-design-authority.md`
- `project_memory/decisions/ui-studio-preview-protocol.md`
- `project_memory/decisions/ui-studio-v6-schema.md`

## Delivery sequence

| Phase | Outcome | Exit gate |
|---|---|---|
| 0. Contract | PRD, architecture decisions, reference-project fixtures | Authority, compatibility, and security boundaries accepted |
| 1. Foundation | v6 graph, reducer, history, live preview transport, selection sync | Migration and reducer invariants pass; live preview survives reload/reconnect |
| 2. Layout | Responsive inheritance and competitive layout controls | Three reference projects reproduce target layouts at all declared viewports |
| 3. System | Tokens, components, variants, interaction states | Definition/instance propagation and override provenance pass |
| 4. Content | Structured content, assets, data, state design | Real-copy and missing-state gates pass |
| 5. Repository | Adapters, mappings, divergence, proposed diffs | No unsupported change is represented as lossless |
| 6. Quality | Accessibility, responsiveness, content, performance gates | Unknown remains unassessed; declared blockers stop release |
| 7. Agency | Revision approvals, comparison, review workflow | Feedback and approval retain node + revision provenance |
| 8. Ecosystem | Imports, libraries, plugins, exports | Every import/export publishes capability and loss reports |

## Immediate milestone

1. Record the product and architectural contract.
2. Add the v6 graph and lossless v5 → v6 migration.
3. Add the pure closed edit-command reducer.
4. Add monotonic revision history with bounded undo/redo.
5. ~~Move full preview delivery onto a frozen live runtime and revisioned channel.~~ Completed in v0.275.0.
6. ~~Add two-way selection synchronization.~~ Completed in v0.276.0.
7. ~~Route basic canvas edits through the command layer.~~ Completed in v0.277.0.
8. ~~Validate all of the above on the three reference projects.~~ Completed in v0.278.0.

Steps 1–4 established the authority and mutation contract. Steps 5–6 provide a live, selection-aware
review loop without making the browser an editor. Steps 7–8 completed the first foundation milestone;
Phase 2 begins with responsive inheritance and the layout controls in P1.1.

## Success metrics

- **Migration integrity:** 100% of v5 reference/workspace fixtures preserve all wireframe facts after
  v6 migration and round-trip.
- **Edit integrity:** 100% of mutations in reducer coverage are revision-checked and undoable; zero stale
  commands mutate state.
- **Preview latency:** p95 saved/local edits visible in the built-in browser within 150 ms after the live
  transport ships, measured on the reference projects.
- **Responsive completion:** all three reference projects have intentional desktop, tablet, and mobile
  outcomes with zero unresolved overflow at approval.
- **System reuse:** at least 80% of repeated reference-project UI is represented by component instances,
  not copied nodes, after the component phase.
- **Content truth:** zero approved previews contain unlabelled placeholder or model-invented copy.
- **Handoff honesty:** every unsupported adapter/import construct is reported; none is silently dropped.
- **Quality visibility:** every approval records pass, fail, or unassessed for the declared quality checks.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Graph and legacy wireframes drift | Graph wins when present; compatibility projection is derived and covered by round-trip tests |
| Browser becomes an untrusted editor | Closed event vocabulary, host-side ID/revision resolution, tokenized loopback route |
| Component model becomes framework-specific | Shared semantic core; adapters own framework vocabulary |
| Responsive overrides become opaque | Per-property provenance and reset-to-inherited controls |
| Source round-trip damages hand-written work | Mapping/fingerprint comparison and proposed diffs through existing approvals |
| Feature breadth outruns usability | Require the three reference projects to pass each phase before adding the next abstraction |
| Preview/runtime leaks into shipped products | Frozen Studio-only runtime; exported output remains independent and script-free by default |

## Open questions

- Which layout primitives form the smallest complete P1 set after the three reference projects are
  encoded?
- Should component definitions live inside `website.json` initially or in a separately versioned library
  once cross-project reuse ships?
- Which first source adapter gives the best evidence: React, static HTML/CSS, or VS Code webviews?
- What p95 preview latency is realistic on large repositories after VS Code Simple Browser overhead is
  measured?
- Which design-token interchange format is stable enough to adopt without making an external tool the
  source of truth?

These are sequencing questions, not blockers for the v6 graph and edit protocol.

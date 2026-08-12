# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.294.0] - 2026-08-12

### Security

- **The data-privacy scan now inspects the session context bundle.** The scan read
  `requestContext['sessionContext']`, but that string and the structured bundle are alternatives, never
  both: once a session has a `context.md` the chat panel sets the string to `''` and passes the bundle
  instead. The scan therefore inspected nothing on the ordinary panel path while the model still
  received every word of the conversation — a redaction boundary that silently stopped applying the
  moment a session grew a context file. Each bundle field is scanned separately and labelled with the
  heading it is rendered under, so a notice still names *where* a detector fired. The slice list is now
  `buildPrivacyScanSlices`, exported and unit-tested, because a boundary nothing can check is a
  boundary that drifts.

- **The project-run approval gate is no longer inverted, and is no longer a dead end.** Both chat
  surfaces had it backwards. An explicit "Proceed" arrived *unapproved* and stopped at the file-count
  threshold, while a raw prompt merely matching the project-request pattern had the approval token
  appended for it and went straight past — so the request with the least review behind it was the one
  skipping a gate whose own message says it "exists to prevent unreviewed large-scale changes". Nothing
  is auto-approved now, on either surface: no prompt has been shown a plan or a file estimate at the
  moment it is typed.

  The gate previously ended the turn asking the operator to retype the goal with `--approve` while
  offering no control that could do it — so the natural retry re-entered unapproved and stopped in the
  same place, forever. It now carries the exact approving prompt on the run outcome and renders it as
  an **Approve and run** control: a followup chip in the `@atlas` view, a quick-reply pill in the chat
  panel. A gate whose only exit is a magic token is one people learn to route around, which costs the
  gate its purpose.

## [0.293.1] - 2026-08-12

### Added

- **`npm run resolve:release-conflicts` settles a long-lived branch's version-marker conflicts.**
  Every commit here bumps `package.json` and writes release notes. That rule is worth its cost — the
  version always names an exact state of the code — but it means two branches doing entirely unrelated
  work conflict on the same five files *every time*, with no semantic overlap between the changes, so a
  branch open while another stream is pushing re-conflicts within hours.
  `scripts/resolve-release-conflicts.mjs` encodes the resolution: version files take the incoming
  version patch-bumped — a feature branch is a PATCH on top of wherever the integration branch reached,
  never a revert of it, which is what taking "ours" silently does — and notes files keep **both** sides
  with this branch's entry relabelled and placed above, since taking either alone deletes release notes
  for work that shipped. It runs only mid-merge, resolves nothing outside those five files (a conflict
  in source, tests or docs is a real disagreement and wants a human), and refuses to report success
  while any marker survives. The hazard is specific: hand-resolving identical-looking hunks repeatedly
  is how a changelog entry quietly loses a paragraph while attention is on the version numbers.

  Three of its rules come from its own first real run, which did precisely that. It assumed both sides
  of a conflict are whole entries, but when a branch's earlier work has already reached the integration
  branch the bodies merge as common context and git splits the conflict at the **heading alone** — so
  concatenating left an empty section for this branch and reattributed the shared body to the other
  side's version. It now refuses that shape and says why, rather than guessing which version the shared
  body belongs to. It also computes every file before writing any, so a refusal cannot leave a
  half-resolved tree while reporting failure; and it no longer assumes conflict markers say `HEAD`,
  which `git checkout --conflict=merge` writes as `ours`. Finally, its "am I mid-merge?" guard now asks
  `git rev-parse --git-path` instead of joining onto `<root>/.git` — in a **worktree** that path is a
  file, so the guard refused to run in exactly the setup this repository uses for branches.

## [0.293.0] - 2026-08-12

### Added

- **Canvas nodes can now design explicit empty, loading, error, and success presentations.** Each state owns
  bounded title, body, action-label, and placeholder/draft/reviewed/approved maturity fields while screen
  Markdown remains the long-form copy authority.
- **The selected-node inspector edits state copy and chooses the deterministic review state.** Studio and Full
  Preview render the same selected presentation and visibly label its maturity; the Markdown mirror lists
  designed states and the state currently under review.
- **The Phase 4 content authority decision is recorded.** The ADR separates interaction appearance from state
  copy and reserves assets and sample-data bindings for later bounded slices.

### Security

- **State-copy changes use two exact revision-checked commands.** The host bounds every field and state,
  refuses previewing an absent presentation, and makes add/update/remove/preview choices undoable graph edits.
- **Unresolved copy cannot be approved.** A presentation containing `[PLACEHOLDER: …]` is downgraded at the
  persistence boundary and refused as an exact command if it claims approved maturity.

### Changed

- **Website workspace format advances from v8 to v9.** The frozen migration changes only the format number and
  invents no empty/loading/error/success copy or preview choice.

## [0.292.1] - 2026-08-12

### Added

- **The orchestrator now records when it replaces a model's answer with a tool-failure summary.**
  When every tool result in an agentic loop's final round tests as failed, the model's completion is
  discarded and a canned failure summary is substituted. That decision rests on `looksLikeToolFailure`,
  which matches substrings — `failed`, `cannot`, `not found` — against **raw** tool output, and
  `file-read` returns file contents verbatim, so reading an ordinary source file can satisfy it. With a
  single tool call in the round the `every()` check is then trivially true and a good answer is lost.
  The substitution now logs the tool names and which token triggered each verdict, distinguishing a
  tool that **declared** its own failure (`Error:` prefix — almost always genuine) from a bare
  substring or keyword match (the false-positive class). Tool output itself is never logged, only the
  trigger token, because the log persists and tool results can carry secrets. Diagnostic only: nothing
  branches on it and the substitution behaviour is unchanged.

  The predicate and the diagnostic are now **one function**, `classifyToolFailure`. Written as two
  they drifted immediately — the diagnostic was missing the predicate's `requires .*true` alternative,
  so a result matching only that was discarded as a failure while the log called it `unclassified`. A
  diagnostic that mis-reports the branch it exists to measure is worse than none, because the
  measurement looks complete; deriving both from one classifier makes that unrepresentable rather than
  merely fixed, and a test walks every alternative.

### Fixed

- **The test suite no longer times out intermittently under load.** `vitest.config.ts` had no
  `testTimeout`, so all 5,000-plus tests ran on Vitest's 5s default. Much of the suite drives the
  `fs`-only managers against a real `mkdtemp` project tree rather than a mocked filesystem, so a
  test's duration tracks the host's disk — and a checkout on a synced folder is far slower than CI.
  The margin was thin enough that a filesystem-heavy test passed alone and timed out under full-suite
  load, which at the moment it blocks a commit is indistinguishable from a real failure and teaches
  whoever hits it to reach for `--no-verify`, skipping compile and lint too. Raised to 20s, which
  hides no hang: a genuinely stuck test still fails, just later.

## [0.292.0] - 2026-08-12

### Added

- **UI Studio now models reusable component definitions and explicit canvas instances.** Definitions include
  typed properties, variants, bounded slots, and declared interaction/system states; instance overrides retain
  provenance and never silently rewrite the shared definition.
- **UI System and the canvas now provide separate definition and instance editors.** Components are created
  and maintained in UI System, while the selected-node inspector assigns a compatible definition, variant,
  state, property overrides, and parent slot.
- **Studio, Full Preview, and the Markdown mirror project the same component facts.** Canvas and browser
  previews identify definitions, variants, and non-default states, while the mirror reports library shape and
  instance counts for review.

### Security

- **Every component edit uses exact revision-checked graph commands.** The host bounds identifiers, text,
  property types, choices, collection sizes, slot capacity/kinds, states, and definition/instance references;
  it refuses deletion or incompatible root-kind changes while definitions are in use.
- **Component definitions store no markup, CSS, source path, or executable value.** Full Preview converts only
  closed state names into fixed adapter styling and escapes every displayed identity and label.

### Changed

- **Website workspace format advances from v7 to v8.** The frozen migration adds an empty component collection
  without inferring definitions, instances, variants, slots, properties, or states.

## [0.291.0] - 2026-08-12

### Added

- **UI System now has a typed-token editor backed by the authoritative graph.** Operators can add direct
  values, create same-kind aliases, update definitions, and delete unused tokens without editing JSON.
- **Studio and Full Preview consume the same resolved token values.** Reserved semantic ids control primary,
  secondary and accent colours, heading/body fonts, base spacing/radius, and tablet/mobile breakpoints; the
  preview adapter also publishes every resolved definition under a collision-free CSS custom property.
- **The generated Markdown mirror lists typed tokens.** Reviews can see each stable id, kind, direct value, or
  alias relationship without opening the Studio.

### Security

- **Token edits use the existing exact, revision-checked graph command boundary.** The host reparses every
  command, sanitizes the complete dependency graph, refuses cycles/cross-kind/missing aliases and deletion of
  an in-use token, and makes each accepted edit one bounded undo step.
- **CSS conversion is confined to the deterministic preview adapter.** Graph values never become arbitrary
  properties or selectors; semantic roles use an explicit id allowlist and custom-property names hex-encode
  stable ids to prevent collisions or stylesheet syntax injection.

### Changed

- **UI Studio save payloads now identify workspace format v7.** Token state remains host-owned and persists
  with the current graph revision rather than being accepted as an arbitrary form patch.

## [0.290.0] - 2026-08-12

### Added

- **Phase 3 begins with typed design tokens in UI Studio's authoritative graph.** Format v7 stores bounded
  colour, font family/size/weight, line-height, spacing, radius, shadow, motion, and breakpoint definitions.
- **Token aliases resolve through one pure target-independent path.** A resolved value retains its source and
  ordered alias chain, so base-token changes propagate without interpreting definitions as CSS or target code.
- **The architecture decision is durable.** `project_memory/decisions/ui-studio-system-definitions.md`
  records why tokens live in the graph initially, why v7 is required, and what remains for components.

### Security

- **The graph sanitizer validates every token value and dependency.** It caps collections, normalizes colour
  values, bounds numeric and structured values, rejects unsafe font-family syntax, and removes duplicate,
  missing, cross-kind, cyclic, and invalid definitions before use.

### Changed

- **Website workspace format advances from v6 to v7.** The frozen migration preserves every v6 graph fact and
  adds an empty token collection rather than inventing a design system. Older-format chains reach v7 in one pass.

## [0.289.0] - 2026-08-12

### Added

- **UI Studio now reports responsive layout diagnostics at desktop, tablet, and mobile.** The host checks
  viewport overflow, children that extend outside a clipping parent, unintended visible-node overlap, and
  interactive nav/form/CTA/footer nodes that render below a 44px touch target.
- **Findings are actionable on the canvas.** The active breakpoint shows a clear/check state or deterministic
  counts by category, followed by bounded finding buttons that select and synchronize the owning node with
  Full Preview.

### Security

- **Diagnostics are pure host projections, not browser assertions.** They consume the same resolved graph as
  Studio and Full Preview, never execute content, and send only closed codes, severities, breakpoint values,
  bounded node identities, and escaped messages. The webview validates the diagnostic envelope before use.

### Changed

- **Phase 2 responsive layout is complete.** Intentional parent/child overlap and siblings in an overlay
  container are excluded from overlap warnings. Touch-target thresholds convert the fixed 44px requirement
  into canvas units using the actual 1280/834/390 preview widths.

## [0.288.0] - 2026-08-12

### Added

- **A multi-selection can now be dragged as one gesture.** Drag any selected block to move the complete
  selection while preserving relative spacing. The gesture works at the base breakpoint and creates explicit
  tablet/mobile overrides when used in a responsive view.

### Security

- **Group drag crosses the webview boundary as one closed command.** Pointer-up sends one bounded
  `set-node-frames` payload; the reducer validates every identity, lock, rectangle, breakpoint, and revision
  before committing. It cannot partially move a selection or change hierarchy.

### Changed

- **Group bounds and snapping are deterministic.** Movement is clamped using the complete selection bounds,
  and the primary block snaps only against the grid and unselected blocks. Selected blocks cannot attract one
  another during the gesture, so their spacing remains exact.

## [0.287.0] - 2026-08-12

### Added

- **UI Studio can duplicate a complete node subtree as one edit.** The host validates a complete mapping
  from every source identity to a fresh identity, remaps child parents, offsets base and explicitly authored
  responsive rectangles, selects the new root, and records one revision and one undo entry.
- **Nodes can be locked from the inspector.** A locked block remains selectable and inspectable while drag,
  resize, nudge, form edits, alignment, distribution, deletion, and duplication are disabled. Unlock is the
  only mutation the reducer admits for that node.

### Security

- **Duplication and locking are reducer guarantees, not browser conventions.** Duplicate commands refuse
  incomplete/duplicate/colliding identity maps, locked descendants, invalid offsets, and the 60-node limit
  without partial mutation. Batch edits containing a locked node refuse atomically, and deleting an unlocked
  wrapper is refused when it would implicitly reparent a locked direct child.

### Changed

- **A duplicated subtree stays coherent at every authored breakpoint.** Explicit responsive rectangles move
  by the same bounded offset as base geometry; inherited layout, content/style/component references, and
  descendant labels remain intact. Only the duplicate root receives a `copy` suffix, and clones start unlocked.

## [0.286.0] - 2026-08-12

### Added

- **Stack containers now support deterministic wrapping.** `nowrap` preserves the existing single run;
  `wrap` packs fixed/hug children until the next would exceed the main axis and then starts the next row or
  column. A fill child claims its line. The shared host projection drives both Studio and Full Preview.
- **Every node now has responsive sibling order.** Container children sort by a bounded `-1000…1000` order
  before the existing geometry/id tie-breakers, so grid and stack sequences can change by breakpoint without
  rewriting hierarchy or rectangles.

### Security

- **Wrap/order remain closed layout data.** Wrap accepts only `nowrap` or `wrap`; order accepts only a safe
  integer from -1000 to 1000. Both travel through the exact `set-node-layout` payload and the graph sanitizer,
  never through CSS, DOM order, a style object, or arbitrary reordering instructions.

### Changed

- **Flow ordering is a projection.** Stored node array order and geometry remain untouched. Reset, free mode,
  or undo therefore recovers the prior drawing exactly, while responsive overrides can alter only the
  breakpoint's projected sequence.

## [0.285.0] - 2026-08-12

### Added

- **Nodes now have responsive min/max width and height constraints.** Each optional bound inherits from base
  through tablet/mobile with its own provenance. Free, stack, grid, overlay, fixed, fill, and hug all pass
  through the same deterministic constraint projection used by the Studio and full built-in-browser preview.
- **The layout inspector exposes all four bounds without magic sentinel values.** An empty field means no
  constraint; the responsive provenance panel names where each active or empty value came from.

### Security

- **Constraints remain closed canvas data.** Width limits accept only `null` or finite 1–1000 canvas-unit
  values; height limits accept only `null` or finite 1–4000 values. The parser and reducer refuse inverted
  pairs, unknown keys, and non-finite values before graph mutation. The graph sanitizer drops a contradictory
  maximum from hand-edited input instead of persisting an impossible pair.

### Changed

- **Constraint application is non-destructive.** The resolver clamps the displayed rectangle while retaining
  its stored geometry. Removing/resetting a constraint or undoing its edit therefore restores the exact prior
  drawn or intrinsic size. A constrained free-layout node remains movable; only container-positioned children
  refuse direct move/alignment/nudge operations.

## [0.284.0] - 2026-08-12

### Added

- **Stack, grid, and overlay are now real container layouts.** A container can set direction, gap, padding,
  columns, cross-axis alignment, main-axis distribution, and fixed/fill/hug sizing. The extension host
  deterministically projects direct children for the Studio canvas and full built-in-browser preview; modes
  are no longer dormant enum values or inspector-only labels.
- **Container behaviour participates in responsive inheritance.** Tablet/mobile layout settings report
  base, override, or computed-container provenance and can be applied or reset as one property family without
  discarding geometry or visibility overrides.

### Security

- **Layout editing stays a closed bounded command.** `set-node-layout` accepts only named enums, gap/padding
  from 0–500, and 1–12 columns. Non-container nodes cannot become layout containers, non-base overrides name
  one closed breakpoint, and the webview never sends CSS, a style object, or a graph fragment.

### Changed

- **Container layout is a projection, not a destructive rearrangement.** Stored child rectangles remain the
  free-layout fallback. Switching a parent to stack/grid/overlay computes displayed rectangles with explicit
  provenance; resetting or undoing the parent restores the previous positions exactly.
- **Fill and hug now have deterministic initial semantics.** Fill claims the available axis in a stack/grid/
  overlay cell. Hug retains the stored intrinsic rectangle until the later content-measurement phase; the
  inspector says so rather than implying browser content measurement already exists.

## [0.283.0] - 2026-08-12

### Added

- **UI Studio now supports multi-selection alignment and distribution.** Shift, Ctrl, or Cmd toggles
  elements into the current selection. The inspector aligns left/centre/right/top/middle/bottom, distributes
  three or more rectangles across/down, clears back to the primary element, and nudges a selected group.
  The same tools work on base geometry and responsive overrides.
- **Multi-node transforms are atomic graph edits.** `set-node-frames` validates a bounded unique identity/
  rectangle list, refuses the whole request if any target is missing or invalid, advances one revision, and
  creates one undo entry rather than a fragile series of independent edits.

### Security

- **Batch geometry remains a closed data command.** The webview cannot submit a graph fragment, parent
  change, source path, style object, or executable value. Responsive batches additionally name one closed
  non-base breakpoint, and the host sanitizes every rectangle against its node kind before mutation.

### Changed

- **Group deletion remains explicit rather than implied.** Delete is refused while multiple elements are
  selected; operators narrow to the primary selection first. This avoids a new multi-select affordance
  silently turning the existing single-node delete into a cascade.

## [0.282.0] - 2026-08-12

### Added

- **Responsive layouts can now be manipulated directly on the Studio canvas.** Dragging, resizing, or
  nudging a node at any non-base breakpoint creates an explicit geometry override from the resolved
  rectangle. Snapping, bounded geometry, keyboard steps, undo/redo, provenance, and independent reset all
  remain available without making a duplicate drawing.

### Security

- **A responsive gesture is an optimistic projection, never browser authority.** The webview temporarily
  paints the resolved rectangle for feedback, then submits the existing exact revisioned viewport command.
  The extension host validates it and replaces the projection after every accepted or refused result.

### Changed

- **Responsive geometry editing cannot change shared structure.** Drawing, deletion, and nesting remain
  confined to the declared base breakpoint; a responsive gesture can name only an existing node, the active
  closed breakpoint, and a bounded rectangle.

## [0.281.0] - 2026-08-12

### Added

- **UI Studio now has a host-resolved responsive inspector.** Desktop, tablet, and mobile controls project
  the selected screen in the canvas without duplicating inheritance logic in the browser. Each selected node
  shows computed geometry, visibility, layout mode, width mode, height mode, and the source breakpoint for
  every property; hidden nodes remain visible as inspectable design decisions.
- **Tablet/mobile geometry and visibility can be applied or reset independently.** Numeric layout controls
  and an explicit visibility choice use the existing revisioned reducer. Resetting geometry preserves an
  intentional visibility override and vice versa; undo/redo continues to cover both.

### Security

- **The webview receives resolved presentation data and never becomes a layout authority.** Responsive state
  is built from the host-owned graph, bounded again on receipt, and reconciled after every accepted/refused
  edit. The browser can name only a saved node, closed breakpoint, bounded rectangle/Boolean, and the exact
  property to reset.

### Changed

- **Structural direct manipulation is confined to the screen's base breakpoint for now.** Responsive views
  allow selection and explicit inspector overrides, while drawing, deletion, nesting, nudging, and drag/
  resize remain base-only so an early responsive tool cannot silently change all viewports.

## [0.280.0] - 2026-08-11

### Added

- **The full built-in-browser preview now shows inherited responsive layouts.** Deterministic draft pages
  project the authoritative screen at tablet and mobile widths through static media rules; geometry cascades
  in breakpoint order, visibility can change independently, and the canvas height follows visible content.
- **Responsive preview projection runs across all three reference products.** Website, web-app, and native
  desktop fixtures now render the same script-free desktop/tablet/mobile contract.

### Security

- **Responsive rendering adds no browser capability.** The pure renderer emits inline static CSS only,
  escapes graph identities used in selectors, ignores a screen that does not own the rendered page, and
  leaves the frozen live runtime as the sole injected script.

## [0.279.0] - 2026-08-11

### Added

- **UI Studio now resolves responsive layout through explicit inheritance.** A desktop base flows through
  tablet into mobile, while a migrated tablet/mobile base remains honest about wider layouts and changes
  them only through exact overrides. Resolution returns per-property provenance for mode, geometry, sizing,
  and visibility, so an inspector can explain every computed value.
- **Viewport overrides use the same revisioned edit boundary as canvas changes.** Exact set/clear commands
  support bounded geometry and visibility, reject the base breakpoint and malformed/empty payloads, advance
  history once, and remain undoable. Clearing an override deterministically restores its inherited value.
- **All three reference projects now exercise responsive inheritance.** Website, web-app, and desktop
  fixtures prove tablet-to-mobile inheritance, property provenance, and reset-to-base behaviour.

### Security

- **Responsive messages cannot smuggle style or execution data.** The parser accepts only a closed
  breakpoint plus bounded rectangle and/or Boolean visibility; unknown fields and breakpoint names refuse
  before the reducer sees them.

## [0.278.0] - 2026-08-11

### Added

- **UI Studio's foundation now has three executable reference projects.** A marketing website, dense
  operations web app, and native desktop control room each exercise v5 → v6 migration, save/reopen,
  revisioned edit, undo/redo, stale-event refusal, two-way selection identity, deterministic real-content
  preview, and frozen live-runtime injection.
- **Target independence is an asserted graph invariant.** The scenarios walk every graph level against the
  shared screen/node/layout vocabulary, reject website delivery or implementation fields in the graph, and
  confirm that Astro, React, and SwiftUI remain handoff facts rather than design-document fields.

### Changed

- **Phase 1 of the UI Studio builder plan is complete.** Its reference-project exit gate is now repeatable
  test evidence, and responsive layout is the next recorded delivery phase.

## [0.277.0] - 2026-08-11

### Added

- **UI Studio canvas gestures now run through the authoritative graph reducer.** Draw, move, resize/reparent,
  delete-with-child-promotion, kind, label, and design-intent changes use the same revision-checked command
  path as undo and redo. Pointer and form interactions remain responsive locally, then reconcile to the
  host-owned graph projection.
- **The closed edit vocabulary now covers node lifecycle and atomic frames.** `add-node`, `delete-node`,
  `set-node-kind`, and `set-node-frame` join the original commands; Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z expose
  the existing monotonic history from the canvas.

### Security

- **The Studio webview cannot submit graph patches or bypass command validation on save.** Every design edit
  is parsed against exact fields, bounded identifiers/text/geometry, a closed kind catalog, and the expected
  revision before the pure reducer sees it. Save names only the revision it observed; the extension supplies
  the graph from its edit session and refuses a mismatch.

## [0.276.0] - 2026-08-11

### Added

- **UI Studio and its full built-in-browser preview now share a two-way selection.** Clicking a deterministic
  preview block focuses the same saved graph node in the Studio; selecting or creating a saved canvas node
  highlights it in every connected full preview. Selection is ephemeral and never changes the design graph.
- **The frozen preview protocol now has one closed selection endpoint and event.** A browser request contains
  exactly the current render revision, screen ID, and node ID. Server-to-browser selection events carry the
  same three fields so multiple open previews remain aligned without creating another source of truth.

### Security

- **Preview selection is revision-checked and resolved twice.** The loopback server refuses stale, malformed,
  oversized, unknown-field, invalid-identifier, wrong-method, wrong-media-type, and wrong-token requests; the
  host then resolves accepted identities against the current saved design graph before notifying the Studio.
  The endpoint cannot name edits, commands, paths, graph fragments, source text, or filesystem mutations.
- **Wrong-token POST requests no longer disclose that a preview method exists.** Token/path resolution happens
  before the static method response, preserving the existing indistinguishable 404 boundary for every method.

## [0.275.0] - 2026-08-11

### Added

- **The built-in-browser UI Studio draft now has a frozen live runtime.** Deterministic `_wireframe/`
  pages subscribe to one exact token-scoped server-sent-events endpoint and reload when a newer render
  revision is available. Structure, UI-system, and Markdown content saves therefore reach an already-open
  full preview without reopening Simple Browser or granting the page edit authority.
- **The revision channel has a bounded, transport-independent hub.** Every connection immediately receives
  the current revision, reconnects resume from current state rather than replaying a backlog, stale/equal/
  invalid revisions are ignored, broken clients are removed, and eight listeners is the hard cap.

### Security

- **Live preview adds two exact resources, not general JavaScript or API serving.** The random per-session
  path token protects `_atlas/runtime.js` and `_atlas/events`; the runtime is a byte-stable AtlasMind
  constant, static `.js` files remain refused, the browser sends no request body or design data, and CSP
  widens only to same-origin script/connect for the Studio draft server.
- **Stopping preview closes event streams and idle keep-alive sockets immediately.** The loopback port no
  longer waits on browser connection reuse after the explicit lifecycle boundary.

### Fixed

- **The deterministic preview index can no longer be overwritten by the `/` screen.** The screen inventory
  retains `_wireframe/index.html`, the home screen now uses `_wireframe/home.html`, and inventory links are
  correctly relative to their own folder instead of resolving through `_wireframe/_wireframe/`.

## [0.274.0] - 2026-08-11

### Added

- **UI Studio's class-leading visual-builder roadmap is now a repository-owned product contract.** The
  PRD defines goals, non-goals, P0/P1/P2 requirements and acceptance criteria, phased delivery, reference
  projects, metrics, risks, and open questions. Three accepted decisions pin design authority, the bounded
  built-in-browser preview protocol, and v6 compatibility semantics.
- **Format v6 introduces the authoritative target-independent design graph.** Stable screens and nodes carry
  base layout, viewport overrides, content/style/component references, and a monotonic revision. The 5 → 6
  migration transcribes existing wireframes without inventing responsive or component intent, including the
  distinction between an untouched screen and an intentionally empty drawing.
- **A pure closed edit-command reducer establishes the future canvas mutation boundary.** Initial label,
  design-intent, move, resize, reparent, visibility, undo, and redo commands validate the revision and target
  before mutation. Stale edits are refused, geometry remains bounded, hierarchy is checked, redo branches are
  explicit, and history is capped at 100 snapshots.

### Changed

- **Legacy page wireframes are now compatibility projections of the graph when v6 data is present.** Current
  renderers keep working while graph consumers move incrementally, but there is one declared winner rather
  than silent last-write-wins drift.

## [0.273.0] - 2026-08-11

### Added

- **Full Preview is now a first-class UI Studio step.** The canonical review canvas opens in VS Code's
  built-in browser and is rebuilt deterministically from the saved wireframe, UI colours and typography,
  and exact Markdown content. Every screen also carries a complete content proof so copy cannot disappear
  behind a fixed wireframe box, while `[PLACEHOLDER: …]` gaps remain visually explicit.
- **Responsive inspection remains available as a companion lab.** Desktop, tablet, mobile, and fluid
  widths share the same loopback server and preview URL as the full browser instead of creating a second
  version of the design.

### Changed

- **The live Studio draft now always owns the preview entry point.** Model-generated visual guides remain
  one click away but cannot replace the deterministic content/style/structure index. Studio saves rebuild
  preview artefacts when the guarded server is already running, and the responsive lab's full-preview
  action opens inside VS Code rather than the operating-system browser.

## [0.272.0] - 2026-08-11

### Added

- **Website Studio is now UI Studio, with website as one profile rather than the product boundary.**
  Projects can identify a website, web app, mobile app, desktop app, editor extension, embedded UI, or
  another interface. Every profile shares screens/flows, wireframes, UI system, content and an
  implementation guide for target technologies, source roots, component locations and handoff notes.
  Non-web profiles do not pretend their target is HTML or that they need SEO, hosting or n8n; every
  profile can render a sandboxed HTML/CSS visual reference, while website projects retain stack,
  hosting, Delivery and automation workflow.
- **Content Design is a real Studio step.** Project voice, principles, preferred and avoided terms,
  comprehension target, locales and accessibility notes are stored in the reviewable SSOT. Per-screen
  Markdown copy is editable in the Studio, including labels and empty/loading/error/success/recovery
  states. Missing files seed only explicit placeholders, and optimistic concurrency refuses to
  overwrite copy changed on disk since the page opened.

### Changed

- **The UI workspace format is v5.** Existing v4 projects migrate explicitly to the `website` profile
  and receive empty content-design and implementation records; the migration invents no voice,
  technology or source location. The command id and `project_memory/domain/website.*` paths remain
  stable for compatibility while the visible command and panel are named UI Studio.

## [0.271.6] - 2026-08-11

### Fixed

- **Branch Dashboard presentation choices now survive closing and reopening the panel.** The selected
  saved view, sort field, direction, grouping, and SCM-colour preference are validated and retained in
  workspace state as well as the live webview state. Recent-activity ordering now uses the newest commit
  visible across both the local and upstream refs of a folded logical branch, so a behind or diverged
  local ref no longer makes the branch appear artificially old.

## [0.271.5] - 2026-08-11

### Added

- **Project Director now mirrors personal dashboard attention.** Its **Follow-ups** group includes
  due/overdue Director reminders and every active dashboard, run, or manual assignment owned by
  `selfContactId`. The same total drives a dynamic `Project Director · N follow-ups` title that remains
  visible when collapsed, the AtlasMind activity badge, and a coloured numeric Follow-ups row badge.

### Fixed

- **Project State and Director links now reach their real destination and focus the exact record.** The
  `atlasmind.openProjectDashboard` command previously discarded every page target except `ideation`, so
  assignment rows silently reopened whichever page was already active. It now accepts a host-validated
  `{ page, focus: { kind, id } }` target. Assignments and individual due follow-ups carry stable ids;
  the dashboard clears filters that could hide a target, scrolls it into view, focuses it accessibly,
  and outlines it. Director's **Open work** controls use the same contract. Invalid/stale focus data
  degrades to the validated owning page and never becomes an arbitrary selector.

## [0.271.4] - 2026-08-11

### Fixed

- **The Project State attention indicator now survives collapsing the panel.** VS Code hides a view's
  title description together with its body, which made `7 waiting` disappear from the exact closed
  state where an indicator matters most. The live count now forms part of the dynamic native title—
  `Project State · N waiting`—and resets to `Project State` when the count reaches zero. The activity
  badge and the coloured **Waiting on you** row badge remain unchanged.

## [0.271.3] - 2026-08-11

### Fixed

- **Project State now shows attention inside the open panel, not only on AtlasMind's activity-bar
  icon.** VS Code implements `TreeView.badge` as container activity and does not render it in an
  expanded native view header. AtlasMind now uses the view's title-description channel for the live
  `N waiting` header signal and a synthetic-URI `FileDecorationProvider` for a real coloured numeric
  badge on **Waiting on you**. The existing activity badge remains the source for the AtlasMind logo,
  and all three surfaces update from the same count.

## [0.271.2] - 2026-08-11

### Fixed

- **Assigning dashboard work to yourself now updates Project State immediately.** Active Director
  assignments owned by `selfContactId` appear individually under **Waiting on you**, with their status,
  priority, and a link back to the owning dashboard surface. Each assignment counts toward the Project
  State view badge, which VS Code also propagates to the AtlasMind activity-bar icon; the section shows
  the same count beside its label. Owner saves trigger the refresh directly, while Project Director file
  changes now recalculate Project State as well. Done, cancelled, or other people's assignments do not
  raise the badge.

## [0.271.1] - 2026-08-11

### Fixed

- **Branch Work controls stay compact at narrow dashboard widths.** The owner picker and actions now
  occupy one flexible content column instead of making the action row fall into the 52-pixel label
  column. Daily work actions are fixed-size icons with descriptive native tooltips and `aria-label`s,
  preserving the full safety explanation without turning a branch card into a column of wrapped words.

## [0.271.0] - 2026-08-11

### Added

- **Branch cards now cover the common daily write workflow.** Their expanded state separates **Work**
  from **Review** actions and can switch or bring a branch local, open Source Control for a reviewed
  commit, pull only when Git can fast-forward, push or publish with an explicit non-force refspec,
  create a local branch at the selected commit, and open GitHub's pull-request form without submitting
  it. Every operation re-resolves an opaque card id against live host-side Git state; commits remain in
  Source Control, divergent pulls are refused, protected branches keep their remote enforcement, and
  merge, rebase, force-push, and automatic commit are intentionally excluded.
- **Director ownership now follows work across the Project Dashboard.** Branches, active roadmap
  items, open issues and pull requests, unresolved gaps, risks and debt, and documents needing
  attention share one human-owner picker backed by `ProjectDirectorConfig.assignments`. The Director
  Assignments view lists active work so it can initiate or change those owners too. Webview messages
  carry only a short-lived host token;
  stored links are kind/id pairs from a closed allowlist, and branch assignments are re-resolved
  against live Git state before they are saved.

## [0.270.3] - 2026-08-09

### Changed

- **Resolve & run now prepares the whole detected release contract.** A version bump synchronizes npm's
  root lockfile version, recognised README current-version markers, the formal changelog, and an existing
  wiki changelog before making its path-scoped commit. The Detected Runbook now shows version preparation
  explicitly and detects a repository-provided release-preparation script when one exists.
- **Promotion failures now show the useful end of clean output.** ANSI/control sequences and secret-shaped
  values are removed, verbose hook output keeps its failure tail, and Git receives a bounded 16 MiB capture
  buffer so a successful but chatty pre-commit hook is not killed by Node's default buffer.

## [0.270.2] - 2026-08-09

### Changed

- **Recorded the implementation contract for Director-recommended Buzz persona teams.** The Buzz
  roadmap now defines explainable grouping of enabled AtlasMind agents into a smaller set of signed
  Buzz identities, many-to-many membership, project intent versus local deployment and runtime
  manifests, persona-scoped selection/handoffs/skills, default-versus-mention routing, colleague
  allowlists, migration rules, phased delivery, and the tests required before default routing can be
  enabled without duplicate replies.

## [0.270.1] - 2026-08-09

### Changed

- **Workflow-stage status now uses the dashboard's standard restrained treatment.** In **Workflow →
  Your workflow file**, a stage's outline and **Enabled** tag carry its status colour; the row contents
  and state marker remain neutral. Explicit **Enabled** / **Disabled** text and `aria-pressed` continue
  to communicate the state without relying on colour.

## [0.270.0] - 2026-08-09

### Added

- **The Pipeline page is now a progressive CI configuration and management surface.** It separates
  workflow definition, event/branch assignment, and required-check enforcement; inspects GitHub
  Actions workflows into safe summaries of triggers, jobs, runners, step counts, timeouts, explicit
  permissions, concurrency, validation coverage, and cautions; and keeps that configuration view
  available before network-backed run history has been fetched.
- **Existing workflows can be opened or reviewed with AtlasMind, and a Node project without quality CI can
  create a safe starter.** Review actions send only an opaque workflow filename and re-resolve the live
  file host-side. Starter creation sends no payload at all: the host re-derives branches, a supported
  lockfile/package manager, and declared scripts; previews the exact create-only plan; and writes
  `.github/workflows/ci.yml` with `wx`, so an existing workflow can never be replaced.

### Security

- **CI workflow contents and commands never enter the dashboard snapshot.** The pure `ciManager`
  exposes bounded metadata only, while the starter is a closed template with validated branch and
  package-script names, read-only token permissions, duplicate-run cancellation, and a job timeout.
  Release automation and pull-request labelling are not misreported as code-quality validation, and
  an unreadable existing workflow blocks starter creation rather than being mistaken for absence.

## [0.269.1] - 2026-08-09

### Changed

- **Workflow stages now show their enabled state across the whole segment.** Enabled rows carry a
  green accent and wash; disabled rows use a muted treatment. A larger state marker and explicit
  **Enabled** / **Disabled** label keep the distinction clear without relying on colour or the former
  small checkbox glyph.

## [0.269.0] - 2026-08-09

### Changed

- **The Delivery runbook now opens compactly and points straight at what needs attention.** Every phase
  is a collapsed disclosure by default. Its numbered identifier inherits the strongest step state:
  green for fully configured, blue for a runtime convention, amber for a manual or missing non-blocking
  item, and red for a blocker. Every non-green step carries an AtlasMind-logo action that asks the host
  to rebuild the live guide and open a focused resolution draft for that step. The browser supplies only
  the opaque step id; it cannot supply a command or prompt text.
- **AtlasMind-assisted buttons now use one icon-only affordance across the extension.** Project
  Dashboard fixes and reviews, Lens questions, MCP configuration help, Website Studio prompt reviews,
  and Project Run draft refinement show the AtlasMind logo with a specific hover tooltip and accessible
  label. Shared CSS keeps the mark visible in light, dark, and high-contrast themes.

## [0.268.0] - 2026-08-09

### Added

- **The Delivery page's detected runbook is now usable, not just readable.** Every command carries two
  icons — **⧉** copies it, **>_** types it into a dedicated `AtlasMind Delivery` terminal — and each
  column header carries a **▶ Run** button that runs that whole phase in order. This supersedes the
  read-only framing 0.267.0 shipped with: reading the right command and then retyping it by hand was the
  part that made the runbook feel like documentation rather than a tool.

  The safety properties it replaces that framing with are stronger than "no button", because they hold
  even now that there is one:

  - **The page names a step; only the host says what it runs.** The webview posts an opaque step or phase
    id, exactly as the Ideation evidence and branch-inventory actions do. AtlasMind rebuilds the guide
    from the workspace and resolves the command itself, so a crafted message can name a command that
    does not exist — it can never supply one. A test pins that no payload in this surface is ever
    `step.command`.
  - **Send-to-terminal does not press Enter.** The trailing newline is withheld, as it already is in the
    chat panel and the setup walkthroughs, so your own keystroke stays the last gate on a single command.
    That is why copy and send need no dialog and running a column does.
  - **Running a column confirms the exact list first**, in a modal that names every command in order,
    marks the ones that leave this machine (a push, deployment or publication that closing the terminal
    cannot undo), and says plainly that AtlasMind does not read the output.
  - **Fail-fast is reported, never assumed.** Commands are chained with `&&` where the shell can stop on
    failure. Windows PowerShell 5.1 has no `&&` and an unrecognised shell has made no promise, so there
    the commands are sent separately and the dialog says the failure of one will not stop the rest —
    which matters most in exactly the column where a failing test is followed by a publish.

  The classification of which commands reach beyond this machine is a declared, word-boundary-matched
  table in `src/core/deliveryRunPlan.ts`, not a model's impression of a command string; the module is
  pure and unit-tested. Guarded promotion is untouched and remains the only path that executes commands
  from a reviewed `delivery.json`, with its own preflight, approval and protected-stage gates.

## [0.267.0] - 2026-08-09

### Added

- **The Project Dashboard's Delivery page now provides a project-specific shipping guide.** It derives
  an ordered **Prerequisites → Validate → Package → Deploy → Publish** runbook from bounded local
  evidence: manifests and lockfiles, exact package scripts, the bound delivery routine, declared
  deployment stages, CI/CD workflows, the production target, changelog policy, backup policy, and git
  cleanliness. Node, Python, Go, Rust, Maven/Gradle, .NET, and container projects receive tailored
  commands; an unknown project receives named missing steps rather than a generic invented workflow.

  Evidence is graded instead of flattened: **configured** means the repository declares it, **runtime
  convention** means AtlasMind derived the ecosystem's standard command, **manual check** names a human
  gate, and **missing** is a blocker only where the path would otherwise be untrustworthy. The page is
  read-only: workspace-authored text is control-stripped and bounded, evidence paths reject traversal,
  commands render as code with no execution action, and promotion execution remains behind its existing
  host-side source, preflight, approval, and protected-stage gates.

### Fixed

- The README's “since the last Marketplace publication” baseline now names the actual newest tag,
  `v0.266.3`, rather than the older `v0.257.5` baseline.

## [0.266.3] - 2026-08-06

### Security

- **js-yaml pinned to ^4.3.1** (GHSA-5p4m-2wfm-xmqj, high): quadratic CPU consumption resolving
  `!!omap`, affecting `>=4.0.0 <4.3.1`. It reaches the tree only through `@vscode/vsce` →
  `@secretlint/node`, so it is a **build-time dependency and never ships in the extension** —
  `npm ls js-yaml --omit=dev` is empty. Pinned inside the 4.x line rather than moved to 5.x, because
  a major bump of a transitive dependency to clear a dev-only advisory risks more than it fixes.
  `npm audit` now reports zero vulnerabilities, and `vsce` still runs.

### Note on the Dependabot alerts

- The 11 alerts GitHub reports (3 high, 8 moderate — `fast-uri`, `ip-address` ×3, `undici` ×5,
  `hono`, `postcss`) are **already fixed on `develop`** and were resolved by the checked overrides in
  0.257.6. Dependabot scans the default branch, which is `main`, and `main` is still at 0.257.5 with
  the older override block. They will clear on the next promotion to `main`; nothing further is
  needed on `develop`.

## [0.266.2] - 2026-08-06

### Changed

- **The shared panel theme is actually applied now.** 0.263.0 described every panel moving onto the
  Project Dashboard's design language, and 0.266.1 committed the provider — but the adoption itself
  had never been committed. Twenty-six panels now pass `dashboardSkin: true` and drop the private
  `:root` palette each had accumulated: Settings, MCP, Model Providers, Agent Manager, Mission
  Control, Run Center, Cost Dashboard, Model Comparison, Ideation, Vision, Voice, Specialists, Tool
  Webhooks, Skill Scanner, Chat and the ten Lens surfaces.

  Net −38 lines: five prefixes (`--atlas-*`, `--lens-*`, `--run-*`, `--studio-*`, `--atlas-panel-*`)
  collapse to one definition. Colour that carries meaning is left alone — the Ideation board's tinted
  notes, the chat transcript, warnings, and each Lens's own accent. The Personality Profile keeps its
  warm palette by deliberate exemption.

## [0.266.1] - 2026-08-06

### Fixed

- **Website Studio built only on a machine that had the shared-theme work in progress.**
  `websiteStudioPanel.ts` passed `dashboardSkin: true` and `websiteStudioStyles.ts` used `--studio-*`
  tokens, but the `dashboardSkin` option and those tokens lived only in uncommitted working-tree
  copies of `webviewUtils.ts` and `dashboardTheme.ts`.

  Introduced in 0.264.0: rewriting the panel carried over the one line of that in-flight change the
  file already had, and every compile check passed because the uncommitted provider was sitting in
  the same working tree. It failed the first time the branch was merged into `develop`, where
  `WebviewShellOptions` has no `dashboardSkin` — the commit had shipped the consumer without the
  provider.

  This ships the provider: `getWebviewHtmlShell` gains the `dashboardSkin` option, and
  `dashboardTheme.ts` gains `DASHBOARD_PANEL_BASE_CSS`, `DASHBOARD_PANEL_SKIN_CSS` and the
  `--studio-*` tokens. Both changes are **purely additive** — no existing export is altered or
  removed — so panels that have not opted in keep their own styling untouched.

## [0.266.0] - 2026-08-06

### Fixed

- **The preview no longer opens on a white page** (`src/core/websiteWireframePreview.ts`). There was no
  deterministic HTML renderer anywhere in `src/core/` — the only HTML was the preview server's error
  page — so a wireframe could not reach a browser *at all* without first running a model generation.
  With an empty preview root the server answered its 404, which is a white page with one line of small
  grey text. Wireframes now render straight to HTML with **no model involved**: instant, free,
  deterministic, and written before the server starts, so **Open preview always shows the drawing**.
  Renders live under `_wireframe/`, never at the address a generated page occupies, so both stay
  available and neither can silently replace the other.

### Added

- **Visible placeholders, everywhere.** Every wireframe block renders hatched, dashed and labelled; a
  text block is grey bars rather than lorem ipsum, an image is a crossed rectangle rather than a stock
  photo, and a nav shows the **real page names from the sitemap** because those are facts rather than
  filler. The generation output contract now demands the same of generated pages: `[PLACEHOLDER: …]`
  markers styled as unfinished, and no invented company names, testimonials, prices or statistics.
  A page that looks finished but is full of fiction is worse than an obviously unfinished one, because
  somebody signs it off.
- **A content model** (`src/core/websiteContent.ts`, `src/core/websiteContentManager.ts`). Page copy
  lives in markdown files under `content/` with YAML front-matter, one per page, so a copywriter can
  edit it in their own editor and it diffs cleanly in a pull request. Files are the source of truth
  and the Studio shows a mirror; a save whose file changed underneath is **refused rather than
  merged**, because automatically resolving two versions of somebody's prose produces a document
  neither of them wrote. Placeholders are parsed, **counted** and reported — a page's readiness is
  "four placeholders remaining", a fact, not a status somebody set. **Missing is not empty**: a page
  with no file has not been started, a page with an empty file was started and left blank, and the two
  stay distinguishable at every layer. Generation reads the real copy and is told not to fill the
  gaps.
- **Client review, anchored to the thing being reviewed** (`src/core/websiteReviewComments.ts`).
  Comments recorded against a page or a specific wireframe element, tracked through
  `open → addressed → resolved` plus `wont-fix`. Comments **transition, never delete** — "we fixed it"
  and "we decided not to" are different facts. A comment against an element somebody later removed is
  **kept and flagged, carrying the label the element had**: it is the evidence that something was
  removed while under review, and it is the comment a naive implementation silently drops. Round
  numbers make "third time we have been asked about this hero" answerable, and
  `buildCommentWorkPrompt` turns one comment into scoped work with the body fenced as REPORTED
  CONTENT.
- **A shareable client review link that AtlasMind does not host**
  (`src/core/websiteReviewBundle.ts`). The overlay is generated *into the site*, so it travels to the
  password-protected staging environment the Stack page already sets up — the client's own hosting.
  They open a normal URL, click the thing they mean, and type. Comments come back as a downloaded file
  (`AtlasMind: Import Website Client Feedback`) or, if the team already owns an endpoint, by POST to
  it. **No endpoint is ever invented**: unset means export-only, and the page's policy then forbids it
  making any request at all. Recorded as a decision record at
  `project_memory/decisions/website-client-review-hosting.md`, including what this deliberately cannot
  do.
- **New commands**: `AtlasMind: Preview Website Wireframe`, `AtlasMind: Import Website Client
  Feedback`. **New settings**: `atlasmind.website.content.directory`,
  `atlasmind.website.review.enabled`, `atlasmind.website.review.includeOverlayInBuild`,
  `atlasmind.website.review.webhookUrl`.

### Changed

- Website Studio's SSOT is **format v4**, with a 3 → 4 step that adds only the version. Content lives
  in files the migration has no business creating, and an absent content file is a meaningful state —
  "nobody has written this yet" — that seeding would destroy.
- `splitFrontMatter` now parses empty front-matter (`---\n---`) correctly. It previously required a
  content line, fell through, and treated the whole file as body — which made an empty page read as
  "this page has copy".
- `sanitizeContentDirectory` **refuses** an absolute path instead of relativising it. Turning `/etc`
  into `<workspace>/etc` silently reinterpreted what somebody wrote and left them believing content
  went somewhere it did not.

### Security

- **The review overlay script is a frozen constant.** It is the only place AtlasMind puts JavaScript
  into a generated page, so it is hand-written in one file, no model touches it, and nothing from the
  workspace is interpolated into it — its configuration travels in a `data-` attribute as JSON. A test
  asserts the emitted script is byte-identical to the constant regardless of page, round or endpoint.
- **The preview server's `.js` exception is one named file**, not a widened extension class:
  `atlas-review.js` and nothing else. `script-src 'self'` is added to the served policy only when the
  overlay setting is on, so the widening happens exactly when there is something that needs it.
- Imported feedback runs through the **same sanitizer as the workspace file** — third-party text that
  has been through a browser we do not control. Import is idempotent: re-sending the same export adds
  nothing and **never resets a comment already resolved**.
- A webhook must be plain `https` with no credentials in the URL, and it is the only origin the
  generated page's `connect-src` permits.

## [0.265.0] - 2026-08-06

### Added

- **A framework model** (`src/core/websiteFrameworks.ts`). Nothing in AtlasMind knew what a website was
  built with: `projectArchetype` knew a project was a "website" and `archetypePacks` knew a website's CI
  shape in the abstract, but neither knew Astro from Next from Hugo. Ten frameworks, each carrying the
  three facts everything downstream needs — the scaffold command, the build command, and the output
  directory. **Every command is a module constant**: never composed, never parsed from documentation,
  never model-generated, because a command from any of those sources is remote code execution with extra
  steps. `custom`, `static` and `wordpress-theme` deliberately carry **no** scaffold command — an
  improvised command that usually works is worse than an honest gap, since the failure lands in somebody's
  repository.
- **The Platforms page is now the Stack page** (`websiteStudioPanel.ts`). Framework and platform are one
  decision — "Astro on Cloudflare Pages" determines the build command, the output directory and the deploy
  config together — so splitting them across two pages made the compatible pairing something the user was
  expected to already know. `describeStackCompatibility` grades every pairing `ideal`/`workable`/
  `unsupported` **with a reason**, and an unsupported pairing stays visible: removing Hugo from the list
  when Shopify is selected would leave somebody wondering where it went, where "Shopify serves Liquid
  templates from its own theme system" answers the question they actually had. The old `platforms` page id
  still resolves, because it is a public deep-link target.
- **Stack autosetup** (`src/core/websiteStackSetup.ts`, `src/views/websiteStackSetupHost.ts`). Planning
  performs nothing; a separate call executes, after a modal listing **every command with its purpose and
  every file with its full contents**. Runs the framework's create command, writes the platform deploy
  config, adds `dev`/`build` scripts, writes a `.env.example` of variable *names*, and creates the
  develop/staging/production branches. Every file and branch step is **create-only** — an existing file is
  reported untouched, never merged — so re-running a setup is safe, which is the case it exists for.
  Success is **re-probed from the filesystem**, not inferred from exit codes.
- **CI/CD generation** (`src/core/websiteCiTemplate.ts`), off by default and gated separately. The YAML
  comes from a declared template with only validated values substituted, never from a model. Production
  deploys declare `environment: production` so the approval gate lives on GitHub's side as well as ours;
  an explicit `permissions:` block replaces the repository default; `concurrency` is per environment with
  `cancel-in-progress: false`, because a half-finished deploy is worse than a queued one. **Secrets are
  named, never written.** An existing workflow file is never overwritten. A platform with no verified
  deploy action is **refused rather than guessed at** — a workflow that half-works still runs.
- **Delivery drift comparison** (`src/core/websiteDeliverySync.ts`). Website Studio keeps its own three
  environments rather than being folded into `DeploymentStage`, so the two can disagree. Rather than hide
  that, `compareWebsiteToDelivery` reports it per stage with both values — a comparison, not a verdict,
  shaped after `findTaxonomyDrift`. Sync is one-directional and confirmed, **never clears a populated
  Delivery field from an empty Studio one**, and can only ever *tighten* promotion protection.
- **New command** `AtlasMind: Set Up Website Stack`, and four settings, all off or conservative by
  default: `atlasmind.website.setup.enabled`, `atlasmind.website.setup.generateCi`,
  `atlasmind.website.setup.allowRemoteProjectCreation`, `atlasmind.website.setup.packageManager`.
- **A strategy document** at `project_memory/ideas/website-studio-strategy.md` — an honest competitive
  read, the five capability gaps in dependency order, what we should deliberately not build, and the
  signals that would show it worked. Every competitive claim is marked *observed* or *assumed*, and it
  cites no price or market figure, because an invented number in a committed file is indistinguishable
  from research six months later.

### Changed

- **Website Studio's SSOT is format v3**, with a registered 2 → 3 step that adds the version and nothing
  else. `stack` is left absent rather than inferred from the files on disk: absent means nobody has
  chosen, and a wrong guess here decides what gets scaffolded.

### Security

- **Remote project creation is manual by default.** `wrangler pages project create` and its equivalents
  authenticate as the user and create billable resources that a half-finished run would orphan, so they
  are quoted with their purpose and not run until `allowRemoteProjectCreation` is explicitly turned on.
- **No setup step can run a shell.** Every executable step is `execFile(command, args)`. A test walks
  *every* producible plan — every framework × platform × package manager × gate combination — and fails on
  a shell metacharacter in any command or argument, or on a command that names a shell or a downloader.
- **No setup step can write outside the workspace.** Paths are validated when the plan is built and
  re-resolved against the root immediately before each write, with the writer injected so a test fails the
  run if it is ever handed an escaping path.
- Branch creation is `git branch` only — never checkout, never push, never force — asserted by test.

## [0.264.0] - 2026-08-06

### Added

- **Website Studio: a wireframe canvas you draw on** (`src/core/websiteWireframe.ts`, `media/websiteStudio.js`).
  The old "wireframe" took the first eight strings out of a page's `sections` list and rendered them as
  `<div class="block-N">` on a three-class CSS grid. It carried no position, no size, no nesting and no
  identity, so nothing downstream could act on it. Pages now hold real geometry: drag to draw a nav, a hero,
  a grid or a card, resize from eight handles, drop one block inside another to nest it, and nudge with the
  arrow keys. Every box is a focusable element with a spoken description of its kind, size and position, so
  the canvas is not mouse-only. **Coordinates are canvas units on a fixed 1000-wide grid, never pixels** —
  storing pixels would put the author's monitor size into a git-tracked file and make one design read
  differently on another machine.
- **A sitemap that draws its own hierarchy** (`src/core/websiteSitemap.ts`). The page inventory was a flat
  table; adding `/services/seo` produced another row rather than a child of Services. The hierarchy is now
  derived from the slug path as pages are added, with an explicit parent able to override it. Rendered as a
  deterministic SVG tree — the same pages always produce the same coordinates, because a map that shifts
  when nothing changed is one nobody trusts. A page whose slug names a parent that does not exist is shown
  at the top level **and flagged**, rather than being hidden or quietly re-parented.
- **The page inventory knows where each page leads** (`src/core/websiteLinkGraph.ts`). Outbound links,
  inbound counts, orphan pages that nothing links to, and links whose target page was deleted. A dangling
  link is **reported, never dropped** — it is the evidence that a nav is broken. Nav and CTA blocks on the
  canvas suggest links by matching their label to a page title, exactly or case-insensitively and never
  loosely; a suggested link never overwrites one somebody typed.
- **Select anything and describe it in your own words** (`src/core/websiteDesignPrompt.ts`). Selecting an
  element and typing a sentence sends Atlas a prompt that names the selection completely — its kind, label,
  size, what contains it, the page it is on, and the shared design tokens — so "make this wider" has a
  referent. Also available for a whole page and for the whole site. Everything read out of the workspace is
  fenced as REPORTED CONTENT, because labels and stored prompts are model-writable; the person's own
  sentence is not fenced, because it is the instruction.
- **Natural-language design prompts on every page and on the site** (`src/types.ts`). A page with a written
  prompt can be generated without anyone drawing a box, so a whole site can reach first-draft design from
  the sitemap alone.
- **A Generate button at every stage, and a preview window beside the Studio**
  (`src/core/websiteGeneration.ts`, `src/core/websiteGenerationRunner.ts`, `src/core/websitePreviewServer.ts`,
  `src/views/websitePreviewPanel.ts`, `src/views/websitePreviewHost.ts`). Generate from the brief (a concept
  page), from the sitemap (every page, driven by its own prompt), from a wireframe (honouring the drawn
  layout), or from a single selected element. The plan is **deterministic and no model chooses the file
  list**, which is what makes the confirmation dialog worth reading: it names every file before anything is
  written. What a stage could not account for is stated with the result rather than left implied.
- **New commands**: `AtlasMind: Open Website Preview`, `AtlasMind: Stop Website Preview`,
  `AtlasMind: Generate Website From Plan`.
- **New settings**, both gates off by default because writing model-authored files and opening a local port
  are two different decisions: `atlasmind.website.generation.enabled`, `atlasmind.website.preview.enabled`,
  `atlasmind.website.preview.port`, `atlasmind.website.generation.maxFiles`.

### Changed

- **Website Studio's SSOT is now format v2**, with a registered `website` migration
  (`src/core/schemaMigration.ts`). The 1 → 2 step transcribes each page's old `sections` list into stacked
  wireframe bands, so a project written by an earlier build never opens onto an empty canvas. Design prompts
  and links are seeded **empty rather than guessed** — a migration has no standing to write a design intent
  on the author's behalf.
- **`WebsiteWorkspaceManager` reads through `interpretVersionedDocument`.** The old
  `try { parse } catch { default }` collapsed two very different situations: a corrupt file (safe to replace)
  and a file written by a *newer* AtlasMind (never safe to replace). An older build would hand back a default
  and the first save would overwrite the newer format silently, in a git-tracked file. The Studio now opens
  read-only and says why.
- **The `website.md` mirror shows the hierarchy, the links and the design prompts**, so "nothing links to the
  new Pricing page" is visible in a pull request rather than only on screen.
- Website Studio's CSS moved to `src/views/websiteStudioStyles.ts` and its script to `media/websiteStudio.js`;
  the panel was carrying ~350 lines of both in template strings, which the canvas would have pushed past
  readable.

### Security

- The preview server **binds `127.0.0.1` only**, serves nothing but `.atlasmind/website-preview/`, re-checks
  every request against that root with `path.relative` rather than a prefix test, offers no directory
  listing, refuses any extension outside a small allowlist, and carries a **random per-session token in its
  URL** so another local process cannot enumerate the site. It starts on demand and stops with the window.
- **Generated files can never leave the preview folder.** Paths are validated at plan time, again before
  every write, and a model that returns a file the user did not approve has it **reported, not written**.
  No `.js` may be generated at all.
- The preview panel builds its **own document with its own CSP** rather than using the shared webview shell,
  so granting `frame-src` to a loopback port does not widen every other panel in AtlasMind. A test pins the
  shared shell's policy so the decision cannot quietly be undone.

## [0.263.0] - 2026-08-06

### Changed

- **Every panel now renders in the Project Dashboard's design language.** Each webview is an
  isolated document, so a panel cannot inherit another panel's stylesheet — which is how nineteen
  panels came to declare nineteen palettes, under five different prefixes (`--atlas-*`, `--lens-*`,
  `--run-*`, `--studio-*`, `--atlas-panel-*`). Four of those were near-verbatim copies of the
  dashboard's, drifted by a radius here and a surface mix there. None of it was ever a decision; it
  was what happened when a panel written in March could not see one written in July. Settings, MCP,
  Model Providers, Agent Manager, Mission Control, Run Center, Cost Dashboard, Model Comparison,
  Website Studio, Ideation, Vision, Voice, Specialists, Tool Webhooks, Skill Scanner, Chat and the
  ten Lens surfaces now draw the same card, the same header, the same tab, the same input.

  The **Personality Profile is deliberately unchanged** — its warm palette is a choice rather than
  drift.

- **The shared theme is applied in two layers, and the order is the mechanism.**
  `getWebviewHtmlShell({ dashboardSkin: true })` puts the tokens and the page frame *before* a
  panel's own CSS and the surfaces *after* it. A panel therefore keeps its **layout** — grid
  templates, gaps, sticky offsets, everything it legitimately owns — and loses its **palette**,
  which it never really decided on. There is no helper that concatenates the layers, on purpose: a
  second entry point is a second chance to get the order backwards, and the symptom of getting it
  backwards is a panel that looks exactly as it did before, which nobody would report as a bug.

- **The skin names the classes it repaints rather than matching them.** A substring match on
  `-card` would have been shorter and would also have caught `.card-kicker`, `.card-header-row` and
  the next class somebody names after a card without meaning one. A class that is not on the list
  keeps its own styling, visibly, until somebody adds it.

  Three families are excluded and stay excluded, because a shared surface must not overwrite a
  colour that carries meaning: the Ideation board's tinted sticky notes, the chat transcript (a
  conversation is not a deck of cards), and toned notices. The Lens accent is the same case in the
  tokens — eight lenses, eight hues, so the header rule says which lens you are reading, and
  collapsing them into one accent would have deleted information rather than unified a style.

### Added

- `--dash-radius-sm` and `--dash-radius-xs`. The dashboard always had a smaller corner for dense
  elements; it just spelled the numbers out at each site, which is exactly how a second scale gets
  invented next door.

- `tests/views/sharedPanelTheme.test.ts` pins the three things a screenshot would not catch: a panel
  that opts out, a private palette that comes back, and the layer ordering. `themeContrast.test.ts`
  now resolves skinned panels against the shared theme as well — without that, every `var(--dash-*)`
  in a converted panel resolved to nothing, the rule was skipped, and the suite would have passed
  over an empty set.

## [0.262.0] - 2026-08-06

### Added

- **The Pipeline page can now read CI itself.** CI was only ever fetched as a side effect of the
  Issues refresh, so the one page whose entire subject is *did the build pass* had no way to go and
  find out — its empty state told you to open a different tab. It now has its own **Refresh CI**,
  costing two `gh` calls instead of the issues refresh's five, so watching a build no longer means
  re-reading a hundred issues. It shares the single in-flight repository read with that refresh, so
  clicking both is a no-op rather than two bursts of API quota.

- **A run list that could not be read now says so.** An empty list previously carried two
  incompatible meanings — "this branch has never been built" and "we could not ask" — and the page
  rendered the second as the first, which is the exact class of lie the rest of the dashboard is
  built to avoid. `fetchFailure` is now carried separately from `logFailure`, because the two send
  you to different places: one is a `gh` or network problem, the other is a permissions or retention
  problem on a single run's log. Previously-read runs are replaced by the failure rather than left
  beside it — old runs under a fresh timestamp would report a stale build as the current one.

### Fixed

- **The CI pass rate on the Workflow page was hardcoded to "not measured".** `deriveCiMetrics` was
  called with an empty array left over from a phase that had no check-run fetch, so the CI component
  of workflow health permanently abstained even with a hundred runs already in memory. It now derives
  from the runs on the head commit.

  Narrowing to *one commit* is the point: `deriveCiMetrics` answers questions about a single commit,
  and handing it a fortnight of branch history would have kept its labels while silently changing
  what they mean — a clean commit reporting 60% because of failures somebody already fixed. Two
  further rules follow. A re-run is another attempt at one check, not a second check, so the newest
  run per workflow wins, using the same rule the branch cards already apply rather than a second copy
  that could disagree with it. And an in-flight run contributes **no duration**: its `updatedAt` is
  the last thing that happened, not a completion, and entering it as one would report a slow build as
  fast precisely while it is still running.

## [0.261.1] - 2026-08-05

### Security

- **Cleared all six open advisories — four high, two moderate.** `npm audit` and Dependabot agreed on
  the set; every one was a transitive pinned by its parent, which is why `npm audit fix` was a
  **no-op** (0 added, 0 removed, 0 changed) while still printing "fix available". The real fix was
  `overrides`, and the existing `undici: ^7.28.0` override turned out to be what was *holding* undici
  inside the vulnerable range in the first place.

  | Package | Was | Now | Advisory |
  |---|---|---|---|
  | `undici` (via `cheerio`) | 7.28.0 | 7.29.0 | GHSA-8xcm-r25x-g524 + 4 more — response desync, cross-user disclosure, CRLF injection |
  | `ip-address` (via `express-rate-limit`) | 10.2.0 | 10.4.0 | GHSA-mwp4-54f8-5fhr + 2 more — SSRF and trust-boundary bypass |
  | `fast-uri` (via `ajv`) | 3.1.4 | 3.1.5 | GHSA-7p8r-x3mc-p8w7 — host confusion via backslash authority |
  | `brace-expansion` (via `minimatch`) | 5.0.8 | 5.0.9 | GHSA-rgw5-rvv9-x895 — DoS via unbounded intermediate arrays |
  | `hono` (via `@modelcontextprotocol/sdk`) | 4.12.32 | 4.13.0 | GHSA-8j4g-w8fx-2239 — ReDoS in CORS middleware |
  | `postcss` (via `vite`) | 8.5.22 | 8.5.25 | GHSA-fxqj-rqcc-2cmp — arbitrary `.map` read via sourceMappingURL |

  Every override was checked against its parent's **declared range** before being applied, and two are
  deliberately pinned *below* latest for that reason: `fast-uri` to 3.1.x because `ajv` requires
  `^3.0.1` and 4.x would break it, and `undici` to 7.x because `cheerio` requires `^7.19.0` and 8.x
  would break it. Each package has exactly one consumer in the tree, so no override is reaching past
  the dependency it was written for.

  Three of the six (`hono`, `fast-uri`, `ip-address`) are **runtime** dependencies that ship in the
  VSIX, reached through `@modelcontextprotocol/sdk` — which is already at its latest published
  version, so there was no upstream release to wait for. The other three are build-time only.

  Worth recording, because it will happen again: `npm install` reported *"up to date … found 0
  vulnerabilities"* while the vulnerable versions were still on disk. The audit was reading the
  lockfile's intent rather than the installed tree. `npm ci` was needed to actually reify it, and the
  fix is only verified by reading versions out of `node_modules` — which is now what was done, rather
  than trusting the summary line.

## [0.261.0] - 2026-08-05

### Added

- **Direct database connections, with the credential in the OS keychain**
  (`src/core/lensDatabaseDialect.ts`, `src/core/lensCredentials.ts`,
  `src/core/lensDatabaseReading.ts`, `src/views/lensDatabaseTransport.ts`,
  `src/views/lensCredentialCommand.ts`). The live lenses shipped reaching a database only through a
  connected MCP server, which meant anybody with a Neon, RDS, Railway or self-hosted instance — most
  people — was told to go and install one first. Three new endpoint kinds close that: `postgres` and
  `mysql` connect directly with bundled drivers, and `sql-http` reaches vendors that expose SQL over
  HTTPS with no wire protocol at all.

  This changes a boundary v0.260.0 stated, so the honest version of the rule replaces it:
  **AtlasMind never *composes* SQL — it sends a *constant*.** Every statement lives in
  `lensDatabaseDialect.ts` as a module-level `const` with no interpolation, no parameters, and no
  code path that accepts a fragment from a caller, a setting, a webview, or a model. A test walks
  every exported statement and fails on a write verb, a placeholder, or a second statement. It is
  the same guarantee `GRAPHQL_INTROSPECTION_QUERY` already carried. The MCP refusal still stands on
  its own reasoning — with somebody else's tool AtlasMind cannot guarantee what it does with the
  string it is handed, and guessing which of its arguments means "the query" is guesswork.

  Everything sent runs inside `BEGIN READ ONLY` with a statement timeout, opened before anything
  else and **not optional**: a server too old to support it fails the probe rather than getting one
  that runs without the guard, which is the exact case where the guard would have mattered. The
  connection is closed in a `finally` on every path — a probe that leaves a connection open against
  a production pooler is a worse bug than anything it was looking for, and Neon bills connection
  time.

- **Measurement, all of it from the catalog** — row estimates, table and index sizes, index and
  constraint counts, last-analyze age, latency percentiles, and the query plan. **Row counts are
  planner estimates the database already maintains, never a `COUNT(*)`**: a count returns only a
  number but reads every row to produce it, and "AtlasMind never reads a row" should be literally
  true rather than nearly true. A test asserts that every aggregate in the file reads a *catalog*
  relation, rather than banning the word and forcing whoever hits it to weaken the check.

  **A never-analyzed table reports unknown, not zero.** Postgres writes `reltuples = -1` and MySQL
  leaves `TABLE_ROWS` null; both mean nobody has measured this table, and `0` would put "this table
  is empty" in front of somebody checking whether a migration ran — the single most expensive wrong
  answer here. `rowEstimate` is optional rather than defaulted, the panel prints *unknown (never
  analyzed)*, and each estimate carries when it was last refreshed, because a row count from a table
  last analyzed in March is a fact about March. The first latency sample is kept apart from the rest
  and never smoothed away: on a serverless database it is a cold start measured in seconds, and an
  average including it describes neither the cold path nor the warm one. `EXPLAIN` is sent
  **without** `ANALYZE` — a probe that executes whatever it explains is a shape nobody should build,
  however harmless this particular statement is — and a missing plan never discards a schema reading
  that worked, since MySQL before 5.7 has no `FORMAT=JSON`.

- **`AtlasMind: Store a Live Service Credential`** and its clearing counterpart. The connection
  string goes to VS Code SecretStorage through a password-style box: never echoed, never logged, and
  **validated by parsing rather than by connecting**, so a mistyped string fails where somebody can
  still see what they pasted instead of opening a socket to whatever host the typo produced. The
  parsed summary — host, database, user, TLS mode — is shown back, because that is the check that
  catches a production string pasted into the staging endpoint, and it is the same summary the probe
  confirmation shows later so the two cannot disagree. A read-only role is recommended at the moment
  of decision rather than only in the docs, since AtlasMind cannot verify what a credential may do
  and least privilege is the control that does not depend on AtlasMind being correct.

  `secretRef` is **namespaced** before it reaches SecretStorage (`atlasmind.lens.endpoint.*`) and
  refused if it is not a plain identifier. Without that, a committed file naming
  `atlasmind.anthropic.apiKey` would make AtlasMind put a provider key in an `Authorization` header
  aimed at a host that same file chose. Driver errors are scrubbed of anything URL- or
  `user:password@host`-shaped before display, because `pg` interpolates the connection target into
  several of its messages and output channels get pasted into issues.

- `pg` and `mysql2` as dependencies, **lazily imported on first probe** — the same pattern
  `buzzSigner` uses for `@noble/secp256k1`. A user who never probes a database pays nothing at
  activation, and the web extension bundle is unchanged at 107.7 kB. Availability is reported as a
  transport fact rather than a setting: the web host cannot open a socket and says so, instead of
  failing at connect time.

### Changed

- `.atlasmind/lens-endpoints.json` accepts `postgres`, `mysql` and `sql-http`. `secretRef` is
  **required** for all three — there is no such thing as a direct database probe with nothing
  stored — and `url` is refused on `postgres`/`mysql`, because putting one there commits the host,
  and usually the credential, to the repository. `sql-http` requires an explicit `vendor`: each
  vendor's HTTP SQL API uses a different envelope, and guessing would post a Neon-shaped body to a
  Cloudflare D1 endpoint and report the resulting error as "unreachable".
- The `database` (MCP) kind's rejection message now points at the direct kinds, so somebody holding
  a connection string is sent somewhere useful rather than told to install an MCP server.
- The probe confirmation for a direct database names the parsed destination — host, database, user,
  TLS mode — read from the stored string at confirmation time. A dialog that cannot name the host is
  one where a production string in a staging endpoint is invisible exactly when it matters.

## [0.260.0] - 2026-08-05

### Added

- **Three lenses that reach the services your project actually talks to**
  (`src/core/lensEndpoints.ts`, `src/core/lensProbePolicy.ts`, `src/core/lensServedContract.ts`,
  `src/core/lensLiveDrift.ts`, `src/core/lensReachability.ts`, `src/core/lensLiveTrust.ts`,
  `src/core/lensProbeRunner.ts`). Every lens until now read the repository, which meant the
  question people actually have — *does the running system still agree with what the code
  believes?* — was one AtlasMind could not answer. Field Wiring could compare two declarations and
  told you so in its own limit line; nothing could compare a declaration against reality.

  **Live Contract Drift** compares the schema your repository declares against the one a service
  serves. `absent-remotely` is the finding worth having: the code declares a field or table the
  running service does not serve, which is a dead end and a schema failure at once. It is kept
  separate from `undeclared-remotely` — a service serving something nobody wrote down — because the
  two need opposite fixes and one combined "mismatch" class would hide which you are looking at.
  **Service Reachability** asks the prior question, which endpoints answered at all, and carries an
  endpoint whose `expectedContractIds` name a contract the repository no longer has as a dead end
  pointing the other way. **Live Data Trust** checks the fields a service actually serves against
  `.atlasmind/lens-data-trust.json` and lists the ones no rule covers — unknown sensitivity on real,
  live data, which the static Data Trust lens cannot see because the field was never in a file.

  The whole feature rests on one rule: **the shape is read, the rows never are.** An API probe
  fetches the OpenAPI document the service publishes or sends a fixed GraphQL introspection query;
  a database probe asks a connected MCP server's schema-reading tool what exists. `buildProbeRequest`
  composes every request from constants — there is no function anywhere that accepts a query, so
  `SELECT * FROM users` is not something a caller can reach, and a test asserts no request the
  module can produce carries a write verb. OpenAPI `example`, `default` and `enum` are read and
  *discarded by name* rather than merely ignored, because they are the keys most likely to hold a
  real customer record and a derivation that swept unknown keys along would eventually carry one.

  Everything else follows from that request leaving the machine. Deny by default at two gates
  (`atlasmind.lens.live.enabled` is off; a probe additionally needs the per-run confirmation),
  because switching the feature on and pointing it at production are two decisions. **An endpoint
  that does not state its stage is treated as production** — guessing downward would move the gate
  off the one environment it exists for, and the endpoint most likely to omit its stage is the one
  somebody added in a hurry. A protected stage costs a type-to-confirm on the endpoint's own label,
  mirroring `promotionRunner`. Redirects are not followed: a redirect is the server nominating a
  destination nobody reviewed, with the bearer token still attached. The response is capped *while*
  it is read, since a cap checked after `await response.text()` has already admitted the body it
  exists to refuse. And a probe that is not authorized never reaches the transport at all — the
  runner takes it as an injected seam precisely so a test can hand it a transport that fails the run
  if it is called, which is what makes the gate a property rather than a convention.

  Three refusals are as load-bearing as the features. **A partial reading reports nothing as
  absent** — if the probe hit a budget, "declared but not served" is indistinguishable from
  "declared and past the cap", so a truncated reading downgrades every absence claim rather than
  publishing schema failures a budget invented. **Unassessed is never healthy**: a probe that was
  refused, timed out, or was never run yields a report with no findings that says so explicitly,
  and `refused`/`unauthorized` stay distinct from `unreachable` because reporting a production
  endpoint you declined to confirm as unreachable would be a lie about somebody else's
  infrastructure. **A classification is never inferred from a field name** — a fabricated
  sensitivity rating closes the gap without closing it, and in a git-tracked file a later reader
  cannot tell it from a decision somebody made.

- **`.atlasmind/lens-endpoints.json`**, the fifth Lens declaration file, with an installed JSON
  schema. It is a committed file rather than a setting, so a change to what AtlasMind may reach
  arrives as a diff with a reviewer. It **names** a secret via `secretRef` and never holds one — a
  document carrying a credential-shaped key is refused *whole* rather than quietly cleaned up,
  because a silently-scrubbed file would leave the secret on disk while reporting that all was
  well. It says *where*, never *what to send*: there is no method, query or body field, so the
  safety rule is not editable by the thing it constrains. Plaintext `http` is accepted only on the
  loopback, since a probe may carry a token; private-range `https` is allowed, because a staging
  API on the office network is the ordinary case and the destination came from a reviewed file.

- **Atlas refuses to draft the endpoints file** (`LENS_UNDRAFTABLE_KINDS` in
  `src/core/lensDeclarationDraft.ts`). The other four declaration kinds can be proposed by a model
  and reviewed; this one cannot, and the refusal happens *before* the reply is parsed so a
  sufficiently plausible draft cannot pass it. A hallucinated hostname is a request sent to a
  stranger in the user's name with their bearer token attached. The setup guide states the refusal
  where the other files offer the button, rather than silently omitting it.

- **`atlasmind.lens.probeLiveEndpoints` and `atlasmind.lens.openLiveSettings`**, plus the
  `Lens — Live Services` panel (`src/views/lensLivePanel.ts`, `src/views/lensLiveCommand.ts`,
  `src/views/lensLiveTransport.ts`). Probe results are held **in memory for the session only**:
  `project_memory/` is git-tracked, and "the staging database answered at 14:02" is one developer's
  environment, not the repository's. An unassessed outcome *replaces* the findings list rather than
  sitting above an empty one, because an empty table reads as "nothing wrong" whatever the caption
  says.

### Changed

- The Lens dashboard now carries **eleven** lenses across five groups, with `live-service` as a
  distinct evidence source rather than a flag on contract files — a lens that can reach production
  should never sit one row down from one that reads a file, unlabelled. Three new rules
  (`live-probing-disabled`, `no-endpoints-declared`, `live-not-probed`) are published in the rule
  table like every other, ranked root-cause first so nobody is told to type a production endpoint's
  name while the feature is switched off.
- Field Wiring's limit line now points at Live Contract Drift instead of only promising that it
  never connects to a live database. The promise is still true of that lens; it stopped being the
  whole story for the suite.
- `settingsIntegrity`'s scoped-read check now tries every section prefix rather than only the first
  segment. `atlasmind.lens.live.*` is read via `getConfiguration('atlasmind.lens.live')`, which the
  old single-level check reported as dead — and a guard that reports live settings as dead is one
  people allowlist their way past.

## [0.259.0] - 2026-08-05

### Added

- **AtlasMind now reads its own delivery pipeline before answering questions about it**
  (`src/core/projectVocabulary.ts`). A request to "promote to staging" was matched against a
  hand-maintained keyword table in the Orchestrator that contained neither `promote` nor `staging`, so
  the turn selected **no tools and no context** — while `project_memory/operations/delivery.json` had
  already recorded the exact answer: a stage of kind `staging`, named `Integration`, carrying
  `branchRef: develop`. The product knew, and the part of the product that had to act did not, so the
  model fell back to `git branch`, found nothing called `staging`, and asked the user a question
  AtlasMind could have answered.

  The new module is the single reader of those declared nouns, and three rules hold the gap closed.
  **Declared only** — a term is a stage's name, its kind, or its branch ref, read from the file the
  project maintains; nothing here invents a stage, because a wrong stage name aims a promotion at the
  wrong branch. **A kind counts as a name** — the stage is *called* `Integration` and is *of kind*
  `staging`, so matching only display names would reproduce the original bug for every project whose
  stages are not named the generic way. **A match is a fact, never a verdict** — the module reports what
  the message named, and whether that becomes a tool, a prompt block or nothing at all belongs to the
  caller, which is what lets one vocabulary serve both skill selection and chat context without either
  learning the other's rules. Pure, `fs`-free and unit-tested.

  The pipeline is now also stated to the model as an authoritative block, so a turn naming a stage no
  longer starts by rediscovering the pipeline from branch names. `undefined` is returned rather than an
  empty heading when a project declares nothing: an empty "Delivery pipeline:" teaches a model the
  project has no pipeline, which is a stronger and more wrong claim than silence.

### Changed

- **Escalation now honours the turn's circuit breaker.** `selectEscalatedModel` took neither
  `attemptedModels` nor `blockedEndpointScopes`, so a timeout could open the circuit on an endpoint and
  the very next escalation would route straight back into it — spending an attempt to reproduce a known
  failure. Escalation asked the router a question that had no memory of the turn it was in; it now
  applies the same two filters the failover path already did.

- **An outage no longer competes with a quality upgrade for the same budget.** `MAX_TASK_MODEL_ATTEMPTS`
  was one counter shared by escalation and provider failover, so a turn that escalated once had a single
  attempt left to survive a provider failure. Failover now has its own budget
  (`MAX_TASK_FAILOVER_ATTEMPTS`, 3) and `MAX_TASK_MODEL_ATTEMPTS` (raised to 5) is what it always should
  have been: a spend backstop rather than the policy. Escalation stays capped at one.

- **A JSON-RPC error from a stdio agent is an endpoint fault, not a model one.** `-32603 Internal error`
  names none of the words the circuit breaker matched on (`timeout`, `socket`, `transport`, …), so a
  sibling model on the same subprocess stayed eligible and the next attempt re-entered the process that
  had just failed. For an agent on the other end of a pipe the transport *is* the process. Deliberately
  not extended to HTTP providers, where one 500 is one endpoint of many behind a load balancer and
  quarantining the provider would be far too broad.

- **Endpoint health now survives the turn.** Circuit state was turn-local, so an ACP agent that had just
  failed twice was still first pick on the next message and the user paid an attempt per turn to
  rediscover it was down. Two hard failures quarantine an endpoint for ten minutes
  (`ENDPOINT_QUARANTINE_THRESHOLD`, `ENDPOINT_QUARANTINE_TTL_MS`); a single completed attempt clears the
  record outright. A quarantine can never refuse a turn: if the quarantined endpoint is the only one that
  can serve the task, the block is lifted and the attempt is made.

- **The stop message names the limit that actually stopped the turn.** "The safety ceiling is 3" was
  reported even when the real cause was that no other configured provider could serve the request, which
  sends the reader to raise a limit that was never reached.

- **The per-turn tool-schema cap now applies to every skill policy.** `MAX_TASK_SCOPED_SKILLS` only ever
  bounded `task-scoped` agents, so an `allowlist` agent sent its entire list and an `all` agent sent every
  enabled skill — including every connected MCP tool — on every query, whatever was asked. That conflated
  two different questions: `skillPolicy` says which skills an agent *may* use, and it was also deciding
  which schemas are worth a turn's context. A new ceiling (`MAX_TURN_TOOL_SCHEMAS`, 24) is an **overflow
  guard, not a selection policy**: a pool at or under it passes through untouched, so a hand-written
  allowlist is unchanged. Above it, skills are ranked by intent and unscored ones keep the order the user
  declared rather than being sorted by id. A cap that bites now says so in the progress line, because a
  silent truncation reads as "this is everything the agent has" — exactly the wrong thing to believe when
  the dropped tool was the one the model needed.

- **A Git integration request gets the tools to write, not only the tools to look.** "merge to main then
  publish" contains neither `commit` nor `push`, so per-word selection matched only the read half of the
  Git group and handed the turn `git-status`, `git-diff` and `git-log` for a request that cannot be
  satisfied without writing. A model given that set does not stop — it reports on the merge it had no way
  to perform, which is worse than failing outright because the report reads like work. Merging, rebasing,
  cherry-picking and promoting now select the write tools as a set. Deliberately narrower than "any word
  implying a write": `commit` and `push` keep their own per-word rules, so "what changed in the last
  commit?" still selects `git-commit` and not the ability to publish one.

- **A promotion needs both a verb and a declared stage.** A verb alone is not delivery ("publish the
  docs") and a stage alone is not either ("why is production slow?"). Selection is still only selection —
  the agent allowlist, turn envelope, tool policy and approval gates are unchanged, and nothing here can
  grant a skill an agent does not already hold.

- **An escalating turn widens its tool set once.** A thin answer is often a model that was never given
  the tool it needed, and re-routing to a stronger model does not fix that. The escalated attempt now
  re-selects within the same authorization ceiling, up to a wider cap.

### Added

- **A guided procedure for the Lens declaration files, with an "Ask Atlas" drafter on each.** The Atlas
  Lenses dashboard could report that `.atlasmind/lens-state.json` was missing and could create one; what
  it created was a valid empty starter and the next instruction was to fill it in with schema
  autocomplete. That is only actionable to somebody who already knows what a state-machine declaration
  *is* and what their own project's state machines *are*, so two of the eight lenses were effectively
  unreachable.

  New **AtlasMind: Lens: Declaration Guide** panel (`atlasmind.lens.openDeclarationGuide`), reachable from
  every "Show me how" action on the dashboard, from the declaration QuickPick, and from the new `/lens`
  chat command. For each file it states what the file declares, its current status, and a worked example
  — deliberately from a generic domain rather than from this repository, so it reads as a shape to copy
  rather than an answer to accept.

- **`/lens`, and Atlas Lenses in the `/setup` index.** `lensDeclarationPlan.ts` derives the walkthrough
  from the four files on disk — no model and no configuration — so it renders identically on a fresh
  install with nothing set up, which is when somebody is most likely to be asking.

- **Two more declaration files are now visible.** `lens-mappings.json` (Field Wiring overrides) and
  `lens-data-trust.json` (Data Trust policy) join the inspector as **optional** refinements. Only the two
  files that actually gate a lens are counted, so a project that has declared its state machines and its
  configuration precedence reads as finished rather than as half done forever. An optional file that is
  *broken* is still reported as broken — optional describes absence, not errors.

### Security

- **The declaration drafter is a proposal path, not a write path.** `lensDeclarationDraft.ts` treats model
  output as untrusted at every step. A draft that fails the same normalizer the lens reads the file with
  is **refused whole rather than repaired**, because repairing it would mean AtlasMind inventing project
  topology that then looks derived. Every `source.workspacePath` is **checked against the filesystem and
  dropped if it does not resolve** — a plausible-but-wrong path renders, draws, and leads nowhere — with
  traversal and absolute paths rejected before they can become a filesystem probe. Any value matching a
  known credential shape is **withheld from the file entirely** rather than masked at render time: these
  files are committed, so masking on screen would still put the secret in the repository. A setting whose
  key reads as a credential, or that arrives with no value policy at all, is masked by default. Drafts are
  capped at 12 entries so they can actually be reviewed, and the cap states itself. Merging **never
  overwrites an entry the user wrote** — existing entries win every id collision. Every correction is
  listed in full before the confirm, and the write is gated on a modal naming the file and the counts.

### Fixed

- **`createOrOpenStarter` would have written the wrong file.** It chose its path with a two-armed
  `kind === 'state' ? … : …`, which silently routed every kind that was not `state` to the configuration
  file the moment a third declaration kind existed. It now reads the path from the declaration table.

- **Three of the four worked examples in the new guide were invalid**, caught by a test that runs each one
  through its own normalizer: a `display` setting must give every source a value including an unset one,
  contract field references use `fieldPath` rather than `fieldId`, mappings need explicit upstream and
  downstream contract ids with a `kind` from the declared set, and data-trust rules are flat rather than
  nesting a field reference.

### Changed

- **`isOpeningAction` now admits namespaced open verbs** (`atlasmind.<feature>.open*`, plus VS Code's own
  folder picker). Most AtlasMind commands are namespaced, so the allowlist previously admitted only the
  handful that are not, and every namespaced guide would have had to be special-cased by name until
  somebody special-cased the wrong one. The verb still carries the semantics — the switch-flipping
  commands the list exists to exclude remain excluded.

## [0.257.5] - 2026-08-04

### Changed
- **The Windows launcher tests now surface their own failure reason.** `acpWindowsLauncher.test.ts`
  still launches real process trees, but the test timeout now sits above the child timeout so the child
  process's error appears instead of Vitest killing the test first.

- **The reader-facing docs were corrected alongside the release bump.** `wiki/Home.md` now matches the
  runtime's 27 built-in agents, and `wiki/Remote-Control.md` now names the gateway enable command and no
  longer contradicts its own settings table.

## [0.257.4] - 2026-08-04

### Fixed

- **Three Windows launcher tests could never report why they failed.** `acpWindowsLauncher.test.ts` launches real process trees — the shipped helper, then Node, then PowerShell, with the deepest compiling C# at runtime through `Add-Type` — and gave each child a 10-second limit. The tests themselves declared no timeout, so they inherited Vitest's 5-second default and were killed *before* the child limit they had set could ever fire. A test that grants its children twice the time it allows itself cannot surface their diagnostics, so a failure arrived as a bare `Test timed out in 5000ms` with nothing to act on.

  The two limits are now named constants, with the test timeout deliberately above the child timeout so the child's own error is what surfaces. **No assertion is relaxed** — the launch-mode, redirected-stdio, and non-visible-console checks are unchanged. This is why the suite passed locally, where the deepest test takes ~750 ms, and failed on CI, where the same test needs roughly seven times longer on a cold shared runner.

## [0.257.3] - 2026-08-04

### Fixed

- **`wiki/Home.md` still claimed 21 built-in agents.** The stale count was corrected in the README and named in the 0.257.2 changelog entry, but the same figure on the wiki's front page was missed — so the two most-read documents disagreed about how many specialists ship, and the more prominent one was wrong. It now says 27, matching the runtime.
- **The Remote Control page referenced gateway mode without listing the command that starts it.** `AtlasMind: Enable Remote Control (Gateway)` is now in the "Turning it on" table alongside the other four, so the cross-machine path has a visible entry point rather than only a prose mention further down.
- **The Remote Control safety table contradicted the settings table three rows above it.** It said the server listens only once you run the enable command *and* the setting is on, immediately after that page documented `atlasmind.remote.enabled` as declared-but-not-read. The commands are the control; the sentence now says so.

## [0.257.2] - 2026-08-04

### Changed

- **The README and every wiki page are rewritten for the people evaluating and using AtlasMind, rather than for the people maintaining it.** Each page now opens by saying what the thing is, who it is for, and what it does for the reader, before any implementation detail. Release archaeology (“until v0.225.0 this could not…”), internal rationale addressed to maintainers, and version-numbered justifications are gone from the user-facing pages; the reasoning that explains a *behaviour a user will meet* is kept and stated plainly. Every technical claim, count, setting name and safety boundary is preserved.
- **The README is 538 lines shorter in substance and scannable.** The 165-line “What's new” block of internal release notes becomes a short section covering what genuinely changed since the last publication, plus a five-item **Recently shipped** summary of user-visible highlights. The 50-row source-file table becomes a 12-row map of top-level directories, with the full service map left to `docs/architecture.md`. Corrected a stale figure: the README claimed 21 built-in agents where the runtime registers **27**.
- **`wiki/Home.md` leads with three entry points** — Getting Started, Chat Commands, FAQ — instead of a flat 20-row navigation table, and `wiki/_Sidebar.md` is regrouped by what a reader is trying to do.
- **`wiki/Configuration.md` opens with the six settings people actually change** and groups the remaining 108 by task. All 114 declared settings remain documented, and two are now labelled honestly as declared-but-not-read (`atlasmind.remote.enabled`, `atlasmind.buzz.autonomousReplies`) rather than described as working controls. `wiki/Remote-Control.md` and the README no longer present `atlasmind.remote.enabled` as the master switch — the enable/disable commands are.
- **`wiki/Architecture.md` becomes a readable overview** of how the system fits together, with `docs/architecture.md` remaining the full contributor reference.
- **Three pages had stray content above their title.** `wiki/Configuration.md` carried two unrelated headed sections, `wiki/Chat-Commands.md` a v0.51.4 composer note, and `wiki/Remote-Control.md` a duplicated project-memory notice. All removed.

- **The ARD standard is now referenced by its specification repository rather than its homepage.** The homepage domain is currently classified `malicious (malware/misc)` by Gen Digital's URL reputation feed (`URL:Blacklist|UR93560563BC63D7BD-0200|urlb`). It resolves to GitHub Pages on Route 53 and looks like a miscategorisation of a static specification site, and a false-positive report has been filed — but the link shipped in two user-facing places (`atlasmind.ard.enabled`'s description in the Settings UI, and a clickable anchor on the Resource Discovery settings page), so users could have met a security warning on a link AtlasMind drew. All six live references now point at `github.com/ards-project/ard-spec`, which is the more useful reference regardless. Existing changelog entries are left as written: they record what was true at the time.

### Removed

- **The last pointer to the deleted competitor comparison page.** `wiki/Comparison.md` and the `Home.md` comparison matrix were removed in earlier releases for asserting facts about software this project neither ships nor watches; `.github/copilot-instructions.md` still listed the page in its documentation map. The published GitHub wiki also still serves the old “How It Compares” table and needs a wiki push to catch up — the source has been correct since v0.147.0.

## [0.257.1] - 2026-08-04

### Fixed

- **The Lens dashboard's contract rule now describes the condition it actually tests.** `no-contract-files` fires when *fewer than two* contract sources are found, but its published description and its suggested-action title both said none had been found — false in the one-source case, which is the likelier one. Because that rule table renders on the dashboard so a reader can check the grading, a description that disagrees with its own condition defeats the reason for publishing it. Both now state the two-source requirement, and a regression test asserts the text stays true for zero sources and for one.
- **The dashboard reads the active editor once per refresh.** `collectLensDashboardInput` called `activeLensTarget()` twice in the same object spread — once to test and once for the value — so an editor change between the two calls could set `activeTarget: undefined` on an object that had just reported having one.

## [0.257.0] - 2026-08-04

### Added

- **Atlas Lenses has a dashboard.** `AtlasMind: Lens: Open Atlas Lenses Dashboard` opens one page for all eight lenses. Each is listed with the question it answers, a plain-language explanation, the evidence it reads, whether it can answer right now, and — when it cannot — the declared rule that says so. A flow map draws evidence → lens → question, and hovering or focusing any node follows its links while dimming the rest. A **Do this next** band ranks only what needs a person, by consequence rather than by count, capped with the remainder stated, and is empty when nothing does. Every lens, node, and action is clickable; the webview posts a bounded id and the host resolves the command from a catalog it holds itself, so no surface can execute a command the dashboard did not already offer. Opening it runs no model, writes no file, and scans no workspace: contract discovery stays deliberately unassessed rather than being reported as absent.
- **Every Lens surface explains itself to a first-time reader.** A ⓘ affordance on each lens, section, and column gives the plain-language version and — separately — what that lens cannot prove, so "no test evidence found" cannot be read as "this code is untested". It is a real button: keyboard-reachable, `aria-expanded`-labelled, Escape-dismissable, and it also carries a hover title, because a popover alone is a tooltip half the users never receive.

### Changed

- **The eight Lens surfaces now share one visual language.** `src/views/lensVisuals.ts` owns the tokens, header, cards, badges, notices, empty states, buttons, flowing-link renderer, and ⓘ popover that Possible Flow, Change Impact, Test Evidence, State Lifecycle, Configuration Resolution, Change Story, Field Wiring, and the new dashboard all draw from. A test reads all eight sources and fails if one stops using it.
- **Relationships are drawn, not listed.** Declared state transitions curve between the two state cards they name; impact links point *into* the selected symbol from its callers and *out of* it to its callees, because drawing them all one way would misstate the direction of the dependency; test links reach each discovered test file; and the configuration chain shows precedence flowing to the source that actually wins. Curves are computed from live element geometry, so they survive wrapping, scrolling, and a resized panel, and only a highlighted link animates — and only when the OS has not asked for reduced motion.
- **The Lens titlebar shows the three things that act on the tree, plus a way to everything else.** Contract Wiring, State Lifecycle, and Configuration Resolution move to the overflow now that the dashboard reaches them as clickable cards, which frees a slot for the Settings route the five-slot ceiling had pushed out of sight. The tree's named empty states — no editor, file outside the workspace, no symbols — are now routes to the dashboard rather than explanations with nowhere to go.
- **Settings → Project Runs offers the dashboard beside the declaration setup**, so the two declaration-backed lenses are no longer the only ones a reader can discover from there.

### Fixed

- **Column labels in Possible Flow no longer assume the vocabulary.** "Incoming", "Selected", and "Depth 2" now carry a sentence each saying what they mean.

## [0.256.0] - 2026-08-02

### Added

- **Declared workflow following is now a standing chat policy.** `atlasmind.workflow.chatGuidance` adds `follow` and makes it the default. A single commit, push, pull-request, promotion, or publication request now continues through the enabled declared route in the same turn instead of asking the operator to type “follow the workflow” and repeat the outcome. The host passes a narrow validated policy object to the Orchestrator, which renders fixed system guidance; free-form workflow checks, blockers, and commands never gain system-prompt authority.

### Changed

- **Release guidance preserves the operator’s active checkout.** Following the workflow grants no new tool or external-write authority and keeps all automation ceilings, approvals, protected-ref checks, release gates, and outward-write confirmations. Pre-existing unrelated edits must not be stashed, discarded, staged, or committed merely to satisfy cleanliness; branch-changing delivery work prefers an isolated temporary Git worktree and pauses only at a real approval, irreversible-action, missing-authority, or external-state boundary.
- **`inform` no longer asks a question while continuing anyway.** It now states the workflow expectation and continues exactly as requested. `gate` remains the explicit blocking mode, and `off` remains silent.

## [0.255.3] - 2026-08-02

### Fixed

- **ACP tool-backed turns no longer interrupt for every operation after the user has explicitly enabled them.** The off-by-default **Let subscription agents act** setting is now the standing operation grant for an independently authorized tool-backed provider turn. AtlasMind automatically answers each readable request with the agent's one-operation option, records its risk/category/action in the output log, rechecks the setting live, and still refuses malformed requests, missing policies, or an `allow_always`-only choice.
- **ACP model and tool launches no longer create blank, focus-stealing Windows terminals when private mode is selected.** Capability probes, routed processes, and replacements all remain under one native supervisor. That parent now creates a single `SW_HIDE` console for the whole descendant tree to inherit—rather than giving only the first process `CREATE_NO_WINDOW` and leaving later shells to allocate a visible `conhost.exe`—while its non-interactive window station and Job Object continue to contain UI and lifetime. Windows npm adapters now run under a real `node.exe` instead of VS Code's GUI `Code.exe`; AtlasMind refuses the launch with an actionable error if Node is unavailable. Native and shipped-binary regressions exercise supervisor → Node → PowerShell and verify that the nested console is not visible.

## [0.255.2] - 2026-08-02

### Changed

- **Committed ideation feedback assets and updated chat-command references.** New Atlas ideation workspace feedback artifacts were added and chat-command documentation was aligned to the corresponding workflow flow.

## [0.255.1] - 2026-08-02

### Fixed

- **Branch-title chip colours now distinguish local and remote-only refs.** Local logical branches use VS Code's theme blue and remote-only branches use theme purple instead of every chip inheriting the generic green added-resource decoration.
- **The chip option is visible where its effect appears.** **Show SCM colours** now sits immediately above the branch-card inventory beside a live Local/Remote legend, rather than being buried in the earlier Decision views card.
- **PowerShell can initialize inside the opt-in hidden ACP process boundary.** The Windows helper now requests the documented non-interactive window-station and desktop access sets, lets the child inherit that established connection instead of reopening generated UI objects by name, and suppresses inherited system-error dialogs. This fixes the blocking `pwsh.exe` `0xc0000142` dialog seen when an ACP agent starts PowerShell while keeping the process tree off `WinSta0`.

## [0.255.0] - 2026-08-02

### Added

- **The Project Dashboard can be refreshed without returning to its header.** **Ctrl+Shift+R** on Windows/Linux and **⌘⇧R** on macOS run the dashboard-wide refresh whenever focus is inside the panel. The visible shortcut hint, tooltip, and `aria-keyshortcuts` metadata expose the same route.
- **Refresh controls now carry their own progress bar.** Dashboard, Issues, Pull Requests, branch PR/CI, remote branch fetch, and branch-review controls animate VS Code's progress colour inside the button, change to an operation-specific active label, expose `aria-busy`, and disable duplicate clicks. Reduced-motion users receive a static progress fill.

### Changed

- **Refresh visibility follows the real host operation rather than a timer.** The extension host posts explicit start/finish state for repository activity, branch fetching, and branch inspection; optimistic webview state covers only the first message round-trip. The shared GitHub refresh marks every matching control busy together because Issues, PRs, CI, labels, milestones, and releases come from one guarded read.

## [0.254.0] - 2026-08-02

### Added

- **Branch cards now have deliberate disclosure controls.** Every card starts as a compact readiness, CI, traceability, and latest-commit summary; clicking its summary reveals the complete branch evidence and actions. **Expand all** and **Collapse all** change the visible inventory in one step.
- **Branch ordering now has an explicit direction.** Activity, readiness, drift, and name sorting can each be reversed, including newest-first and oldest-first chronology. Branch-family grouping keeps branches with the same prefix together while retaining the selected order inside each family.
- **Branch names can use a Source Control-coloured chip.** A persisted dashboard checkbox toggles a Git-branch chip drawn from VS Code's `gitDecoration.addedResourceForeground` theme colour.

### Changed

- **Review Details now belongs to the branch that requested it.** The inspection remains invisible until the explicit action on an expanded branch card is pressed, then renders immediately below that card with its own Close action. The readiness badge no longer starts the expensive inspection.
- **Failure signals are visually distinct from cautions.** Failing CI, blocked readiness, merge conflicts, requested changes, unresolved review comments, and structurally broken branches now use the dashboard's critical red treatment; pending and cautionary states remain amber.
- **Long commit subjects no longer stretch branch cards.** Compact cards show a CSS ellipsis and expose the full escaped subject through the native hover tooltip.

## [0.253.1] - 2026-08-02

### Fixed

- **Change Story “Ask Atlas” now reads the selected committed ref and makes that evidence visible to the selected model.** The host resolves the retained change id, captures a bounded patch plus small-file content directly from the exact local or cached remote Git object, and names the ref in the draft. The Orchestrator validates and fences that one-shot context as reported source data instead of leaving it in host-only metadata. Large files contribute their byte count and focused patch; a failed object read refuses the handoff instead of substituting the checked-out file.
- **Remote Change Story questions cannot turn into an ACP workspace investigation.** These evidence-complete requests are forced to completion-only mode: AtlasMind clears workspace skills and the individual ACP delegated-execution authorization before dispatch. ACP itself now requires both the global tools setting and an explicit per-provider-request authority bit; a completion-only request shares no MCP servers and receives no permission policy even when **Let subscription agents act** is enabled.
- **Windows ACP descendants are isolated from the interactive window station.** The native helper now creates a token-ACL-scoped, non-interactive window station and its default desktop before starting the already-resolved agent suspended. Because Windows only lets `WinSta0` display UI, a third-party descendant that chooses a new desktop can no longer reconnect itself to a visible console merely by declining desktop inheritance. Stdio-only inheritance, the kill-on-close Job Object, SHA-256 pin, opt-in disclosure, and fail-closed behavior remain.

## [0.253.0] - 2026-08-02

### Added

- **Declaration-backed Lens views now explain and repair their own setup.** A shared status reader distinguishes missing, valid-empty, ready, invalid, and unreadable `.atlasmind/lens-state.json` and `.atlasmind/lens-config.json` files. **AtlasMind: Lens: Set Up Repository Declarations** creates valid semantics-free starters with create-only filesystem writes, opens existing files without overwriting them, and relies on the installed JSON Schemas for completion.
- **Lens setup is discoverable where project setup happens.** Getting Started includes a dedicated step, Settings → Project Runs shows both declaration statuses and the setup action, and Project Dashboard Overview carries a live `n/2 ready` Lens card.

### Changed

- **Missing State Lifecycle and Configuration Resolution files no longer lead to a dead-end notification.** The message now explains that these views do not analyze the active file and offers **Create starter** or the complete declaration setup flow.

### Security

- **Starter creation never invents project semantics or overwrites a declaration.** Starters contain only the version and an empty declaration collection; local and remote disk-backed extension hosts use exclusive `wx` creation, while an unsupported virtual filesystem fails visibly.

## [0.252.1] - 2026-08-02

### Changed

- **AtlasMind may create feature branches and carry out local development for this repository.** The committed workflow now grants `auto` to branch creation and local development while issue intake, pull requests, CI, release, maintenance, and general automation retain their existing limits.

## [0.252.0] - 2026-08-02

### Added

- **Project Dashboard → Branches is now a review-readiness surface.** A pure declared rule table combines local drift with the last explicitly loaded pull request, review decision, mergeability, unresolved loaded review comments, per-branch CI, issue linkage, and roadmap references into `Ready for review`, `Needs attention`, `Blocked`, baseline, or merged readings. Unknown remote evidence stays unknown; a model never grades a branch.
- **Every branch card now carries its delivery context.** PR number/state/base, approval or change-request state, mergeability, CI pass/fail/pending, requested-reviewer and “mine” signals, deterministic blockers, closing issue links, explicit roadmap references, and clearly labelled branch-name issue inference are visible together. Host-authored Ask Atlas summaries include the same readiness evidence.
- **Branches can be compared and inspected without checkout.** Selecting any two cards produces merge-base unique-commit counts, changed-file counts, path overlap, changed areas, and bounded contributor histories. **Review details** adds path-derived impact categories plus last-match-wins CODEOWNERS routing, while keeping recent contributors explicitly separate from declared owners.
- **A selected branch can open Lens Change Story directly.** The dashboard re-resolves the opaque id and passes validated head/base refs to the existing bounded Lens collector, so local and cached remote refs can be reviewed without switching `HEAD`.
- **Built-in branch views are persistent.** My branches, Needs my review, Ready, CI failing, and Cleanup keep their last selected view alongside independent local/remote/attention scopes, activity/readiness/drift/name sorting, and readiness/PR grouping.
- **Merged, stale, and gone-upstream work now enters a guarded cleanup queue.** The action re-fetches the relevant remote, re-resolves inventory, checks default/protected/worktree/open-PR state, proves current/production containment and zero unique commits, and presents the evidence before one deletion can be chosen.

### Changed

- **GitHub activity now retains bounded repo-wide run heads for branch cards.** Current-branch CI failure analysis keeps its existing focused log path, while the per-branch surface uses the latest check per workflow. Pull-request parsing now also sanitizes aggregate review decision, mergeability, status-check rollup, and requested reviewers.
- **Lens Change Story accepts host-resolved head/base refs internally.** The Command Palette flow is unchanged; the new dashboard path uses the same normalization and panel without checking out the selected branch.
- **Branch traceability distinguishes evidence strength.** PR closing keywords and explicit `branch: <name>` roadmap notation are declared links; a matching numeric branch segment is inference; a refresh that has not run remains unassessed rather than missing.

### Security

- **Every new browser action sends opaque ids only.** Branch names, refs, remotes, PR URLs, paths, CODEOWNERS contents, and Git arguments are resolved in the extension host against fresh state. The browser receives aggregate changed areas and ownership results, not the changed-path list.
- **Cleanup has no force path.** Local deletion uses `git branch -d`, never `-D`. Remote deletion additionally requires a live head hash equal to the reviewed commit and typed exact-name confirmation before `git push --delete`; a moved ref, unique commit, open PR, protected/default branch, active worktree, missing GitHub assessment, or unproven production containment refuses the action.
- **Readiness remains evidence-honest.** A missing PR/CI refresh cannot become a green zero, filename impact is not called semantic or runtime impact, changed-file overlap is not called a conflict, and recent contributors are not presented as owners.

## [0.251.0] - 2026-08-02

### Added

- **The complete AtlasMind Lens feature line is now integrated with the current `develop` branch.** The collapsed **Lens — Code Explorer** follows the active editor, exposes nested language-service symbols, supports role filters, opens exact source ranges, and prepares editable Ask Atlas drafts. Symbol actions add source-backed possible-flow journeys, bounded caller/callee impact maps, and conservative test-evidence maps.
- **Lens can review explicit repository boundaries and declarations.** **Review Contract Wiring** discovers bounded TypeScript, OpenAPI, JSON Schema, and SQL declarations and combines field wiring, drift findings, proposed schema impact, declared relationships, and explicit data-trust metadata. Repository-authored `.atlasmind/lens-mappings.json`, `.atlasmind/lens-data-trust.json`, `.atlasmind/lens-state.json`, and `.atlasmind/lens-config.json` files receive bundled JSON Schema validation.
- **Three additional review surfaces explain declared or committed state.** State Lifecycle visualizes declared transitions and reachability; Configuration Resolution shows an explicit precedence chain without reading secret values; Branch Change Story summarizes bounded merge-base-to-HEAD commit and path evidence without replacing the Git diff.

### Changed

- **Lens and the newer ACP, dashboard, routing, testing, and Models-sidebar work now share one source line.** The merge retains `develop`'s ACP stdio entrypoint, task-scoped skill routing, branch dashboard, patched dependency override, and presentation-only model visibility alongside all Lens commands, views, types, schemas, and tests.

### Security

- **Lens remains read-only until the operator chooses an existing reviewed action.** It does not execute project code or SQL, connect to a database, invoke a model while rendering, fetch remotes, switch branches, or read runtime secrets. Visual targets are bounded, workspace-relative, root-identified records; traversal, stale roots, malformed ranges, dangling graph endpoints, and invalid declaration files fail closed.
- **Webview and chat boundaries stay host-authoritative.** Panels receive normalized snapshots after a ready handshake, render labels as text, and return bounded opaque ids that the host resolves against live state. Ask actions create editable drafts without source contents or absolute paths and never submit automatically; inferred and missing evidence remain visibly distinct from observed or source-backed facts.

## [0.241.2] - 2026-08-02

### Fixed
- **The ACP private-desktop evidence test now reflects the platform boundary it verifies.** Windows still requires the effective `private-desktop` mode when hidden-desktop launch is requested; macOS and Linux require the intentional `ordinary` fallback instead of failing CI for not claiming a Windows-only capability.

## [0.241.1] - 2026-08-02

### Added
- **An unlinked pull request can now become a reviewable tracking-issue draft.** The Pull Requests page sends only the PR number; the extension host re-resolves the sanitized open record, derives fixed-order title/body text without a model, keeps only labels that already exist on the repository, and opens the existing issue composer. Nothing is posted until the ordinary issue-write permission and modal confirmation both permit it.
- **Issues now shows tracking coverage instead of presenting an empty tracker without context.** The page combines open issues, commits since the latest tag, and open PRs with no linked issue, explains the effective issue-intake posture, and distinguishes a traceability warning from proof that every commit needed a ticket.

### Fixed
- **Project Dashboard no longer hides GitHub activity behind an Issues-page refresh.** The ready handshake and a later panel reveal start at most one bounded read per five-minute freshness window; the dashboard-wide Refresh button and a new Pull Requests refresh action update the same Issues/PR/CI/release/taxonomy snapshot. Pull Requests now receives its own navigation badge, so an open draft such as #152 is visible without knowing to visit another page first.

### Security
- **Opening or refreshing the dashboard remains read-only.** Automatic refresh never creates an issue, PR, comment, merge, or release. PR-derived issue text is host-authored and editable, the browser supplies only a positive PR number, stale/already-linked records are refused, and repository labels are never invented as a side effect.
- **The patched dependency graph is verified, not merely declared.** `npm audit` reports zero vulnerabilities with `qs@6.15.2` deduplicated across the installed tree. GitHub alert #22 remains a default-branch deployment fact until this already-committed override reaches `main`; no vulnerable copy remains on `develop`.

## [0.241.0] - 2026-08-01

### Added
- **Agents now declare how skill eligibility works.** `AgentDefinition.skillPolicy` supports `task-scoped`, `allowlist`, and deliberate `all` modes. Every built-in declares a policy, synthesized agents are constrained to `task-scoped`, and the Agent Manager explains the safe default, exact manual allowlists, and the advanced all-skills override.
- **Task-scoped agents receive a deterministic bounded tool set.** The Orchestrator combines explicit tool names, workspace/action/testing/Git/memory/web intent, prior-session follow-through signals, and existing routing hints to select at most 12 relevant skills. Live progress reports selected versus eligible counts.

### Changed
- **An empty skill list no longer means every integration.** For legacy definitions, a populated list remains an allowlist while an empty list becomes task-scoped built-ins. Custom and MCP skills enter a task-scoped pool only when the agent names them explicitly; `all` is the only policy that admits every enabled present and future skill.
- **Tool schemas are the single model-facing skill description.** AtlasMind no longer duplicates skill names, descriptions, or likely-tool guidance in the system prompt. Natural-language routing cues remain in the selected tool schema, ACP completion/delegated calls receive no AtlasMind skill catalogue, and normal-provider failover restores the selected schemas.
- **Context budgeting now accounts for JSON tool definitions.** Schema tokens are included in initial cost estimates, per-round context-window headroom, and memory/session prompt budgets instead of being invisible to the overflow calculation.

### Security
- **Skill availability now fails narrow at both agent and turn scope.** Empty legacy agents cannot silently inherit a newly installed MCP/custom capability, task selection cannot widen the agent's eligibility pool or the user's read-only/no-command envelope, and the existing approval and execution-time policy checks still apply after selection.

## [0.240.1] - 2026-08-01

### Fixed
- **A single chat request can no longer exhaust every configured model.** Orchestration now has a hard ceiling of three actually invoked model endpoints across initial selection, capability re-routing, escalation, and provider failover. A transport failure opens a turn-local circuit for the execution endpoint, so ACP model/effort variants backed by the same agent and local models backed by the same endpoint are skipped instead of relaunched. The hidden maintenance-model recovery path was removed; an empty completion escalates inside the same bounded loop, and a terminal failure is host-authored without another model call.
- **ACP is no longer cancelled at the generic 30-second provider boundary.** Stateful ACP turns now inherit the adapter-aligned 180-second floor, while ACP still receives no blind retry after an uncertain prompt. Ordinary providers keep the configured 30-second default.
- **Failed attempt streams no longer become part of the answer.** Each model attempt buffers its own stream; only the final accepted completion is committed to Chat. Tool-round preambles and abandoned fallback drafts stay out of the transcript; a divergent legacy stream is visually separated from the authoritative result and is not retained in conversation history. Exact trailing loops are collapsed repeatedly, repeated long paragraphs are removed outside code fences, and skills-context warnings are surfaced once as progress instead of repeated as answer prose.
- **“Read-only” and “do not run commands” now constrain execution rather than merely prompting the model.** The Orchestrator derives a turn-scoped capability envelope, filters the offered skills and schemas, repeats the check immediately before execution, and disables ACP delegated native tools when that envelope cannot be imposed on the remote agent. Test Developer now carries a focused testing/workspace skill list instead of expanding `skills: []` to every enabled integration.
- **The ACP private-desktop helper now owns descendant lifetime deterministically.** It creates the agent suspended, assigns it to a kill-on-close Windows Job Object and the private desktop, requests a hidden first window, then resumes it. TypeScript teardown starts `taskkill /T` before allowing the direct process to disappear and falls back to the direct kill only if tree termination cannot start. The rebuilt 120 KB helper is SHA-256-pinned.

### Changed
- **Reply metadata reports execution rather than selection previews.** `TaskResult.modelAttempts` records the provider, non-sensitive endpoint scope, outcome, duration, measured tokens, and bounded failure reason for each invoked endpoint. “Models used” and “What Atlas did” now name the actual attempts, the final model, and which attempts timed out, errored, mismatched capabilities, or were superseded.
- **ACP launch-mode diagnostics are explicit and data-minimal.** The AtlasMind output channel records whether each agent launch used ordinary or private-desktop mode and whether private mode was requested, without exposing a command line, PID, transcript, path, or credential.

### Security
- **User-declared non-mutation is now a deny-by-default tool boundary.** Unknown or hallucinated tool calls cannot synthesize their way around the turn envelope; only declared read/git-read tools (plus terminal-read only when commands remain allowed) survive. The same restriction participates in routing so a native-tool ACP agent cannot silently receive broader authority than the AtlasMind function loop.

## [0.240.0] - 2026-08-01

### Added
- **Every Branches card now has an Ask Atlas icon.** It opens Chat with a deterministic, host-authored reading of the selected branch: status and head metadata, commit-graph comparisons against the current and production branches, changed-file counts from each merge base, declared warning signals, and the names/counts of recent contributors.
- **Branch summaries lead to focused next questions.** Context-aware chips offer **Compare with current**, **Compare with production**, **Identify issues**, and **Recent contributors**. Comparison chips are omitted when the selected branch already is that baseline; deeper inspection enters the normal routed Chat and approval path.

### Security
- **The first branch answer is local, model-free, and non-mutating.** It uses cached Git refs and bounded author names only; it does not fetch, switch, merge, rebase, push, read author email addresses or diff bodies, invoke a model, or spend subscription/API capacity.
- **The webview still supplies only an opaque branch id.** The extension host rebuilds the inventory, resolves the selected/current/production commits, and constructs every prompt from bounded host-owned facts. Ref names are explicitly marked as reported data, and a stale or manufactured id is refused.

## [0.239.0] - 2026-08-01

### Added
- **Project Dashboard now has a complete Branches page.** It combines local branches with cached remote-only refs, folding a tracked pair into one logical card and showing current/default/protected/worktree state, upstream tracking, ahead/behind drift, merge state, latest commit/author, 30-day staleness, search, and operational filters. Ordinary dashboard refresh remains local; **Fetch latest from remotes** is an explicit network action.
- **Any available branch can be brought into the current workspace for immediate work.** **Switch here** activates an existing local branch, while **Bring local** creates a same-named local tracking branch from a remote-only ref.

### Security
- **Branch activation is host-authoritative and clean-tree-only.** The webview returns an opaque inventory id; the extension rebuilds live Git state and supplies the actual ref to `git switch`. Pending changes, another-worktree branches, remote/local name collisions, vanished refs, and malformed messages are refused. A modal confirmation names the workspace change, and protected branches carry an additional warning.
- **Git metadata is parsed without delimiter ambiguity.** The inventory uses NUL-separated `for-each-ref` fields, so punctuation in author names or commit subjects cannot shift a displayed record or the id later resolved for activation.

## [0.238.1] - 2026-08-01

### Fixed
- **Testing Policy Coverage no longer spends a fleet of models to explain AtlasMind’s own policy.** Every protocol now has declared beginner-facing guidance for what it is, what is needed, the expected result, why it is useful, and its main trade-off. **Ask Atlas** immediately combines that catalogue with the host-rebuilt live evidence and recommendation; the deterministic first answer bypasses the orchestrator, uses zero model/provider capacity, and cannot enter fallback or escalation.
- **Policy questions now lead to explicit choices instead of an open clarification dead end.** The response ends with status-appropriate reply chips — project fit, a smallest useful starting point, disabling an irrelevant policy, reviewing coverage, diagnosing failures, or drafting practice evidence — and the card action is visibly labelled **Ask Atlas** instead of relying on an unexplained icon.
- **“Let subscription agents act” now affects the routing decision it describes.** Tool-backed work may select an eligible ACP subscription agent when `atlasmind.acp.toolsEnabled` is on; AtlasMind sends no incompatible function schemas and lets the agent use its own tools instead. With the setting off, the same model remains ineligible for that requirement. An empty MCP allowlist no longer disguises an enabled agent as a completion-only session, and changing the setting invalidates any live session created on the other side of that boundary.

### Security
- **Host-authored Chat responses are one-shot, bounded, redacted, and non-executable.** Only `atlasmind/*` source identifiers are accepted, Markdown and metadata are size-capped, controls and likely secrets are removed, action chips can submit bounded follow-up prompts but cannot name extension commands, and the response is consumed before any asynchronous work so it cannot leak into a later turn.
- **ACP delegated-tool eligibility requires capability and live authority.** Discovery marks the provider’s native execution ability, while the router separately requires the current `acp.toolsEnabled` value; neither fact grants the other. The adapter still rejects AtlasMind tool definitions, every native operation still crosses the existing one-turn permission broker, a missing or throwing broker still denies, and completion-only sessions remain settings-isolated.

## [0.238.0] - 2026-08-01

### Added
- **AtlasMind can now run as an ACP v1 agent behind Buzz or another local ACP client.** The new `atlasmind-acp` stdio entrypoint reuses the headless orchestrator, agent registry, model router, SSOT memory, provider adapters, and workspace tools; streams reply chunks; carries bounded per-session context; supports cancellation; and deliberately runs only one orchestrator turn at a time.
- **Buzz managed-agent setup is now explicit and copyable.** **AtlasMind: Copy Buzz ACP Agent Setup** creates extension-managed launchers and copies the exact credential-free fields for Buzz's **Provider → Custom command** form. Buzz remains the `buzz-acp` harness while AtlasMind supplies the ACP-speaking agent and owns model routing.
- **Buzz ACP turns can publish replies through AtlasMind's communication-only bridge.** With the explicit `--buzz-auto-reply` launch flag, AtlasMind reads only Buzz's generated structured context, validates the channel UUID and reply event against generated metadata, and posts the final answer without exposing Buzz shell, file, workflow, repository, or admin tools to the model.

### Changed
- **The Buzz guide now distinguishes three separate concepts:** a Director Person is contact/routing metadata, its handle identifies a channel or public identity, and a Buzz managed agent is an executable runtime. A Director binding still routes inbound follow-up ownership; it no longer implies that anything will listen or reply.
- **The extension-managed terminal shims now include `atlasmind-acp` alongside `atlasmind`.** Buzz receives a stable JavaScript runner invoked directly through VS Code's Electron executable in Node mode, avoiding the Windows `.cmd`/`cmd.exe` hop that Buzz cannot spawn as an ACP child. The shared currency and orchestrator paths no longer load the `vscode` module in a headless process.

### Security
- **The agent-side ACP boundary is local stdio only and opens no listener.** Workspace roots and session directories are constrained, client-supplied MCP commands are never spawned, prompts and retained history are bounded, concurrent loops are refused, and cancellation propagates into orchestration.
- **ACP tool authority remains one-turn and fail-closed.** Read-only operations follow the headless policy; write, subprocess, network, audio, and unknown actions request `session/request_permission` with only **Allow once** or **Reject**. `allow_always` is neither offered nor accepted, missing clients deny, and tool previews are bounded with likely credentials redacted.
- **VS Code secrets are not exported into Buzz.** The copied setup contains launcher paths, arguments, and provider environment-variable names only. The operator supplies the one provider credential or local endpoint the external process should receive.

## [0.237.0] - 2026-08-01

### Added
- **Providers, subscription routes, and individual models can now be hidden from the Models sidebar without disabling them.** Every applicable row has an eye-closed action; the preference follows the VS Code user profile and changes presentation only, so credentials, enablement, agent assignments, and model routing remain untouched.
- **Settings → Models & Integrations now restores hidden rows one by one.** The Sidebar Visibility card keeps hidden entries visible even when a provider is temporarily unavailable, resolves friendly live names when it can, and leaves a direct Settings placeholder in the tree when every provider or every child model is hidden.

### Security
- **The restore boundary accepts only a bounded opaque identity and matches it against host-owned user storage.** A Settings webview cannot manufacture a provider mutation or affect routing; unknown restore identities are ignored, malformed stored entries are discarded, and duplicate preferences are collapsed.

## [0.236.0] - 2026-08-01

### Added
- **Operational errors now offer a direct, recognisable path into Atlas Chat.** MCP server-card failures and guided-setup warnings/errors show a shared AtlasMind-logo **Resolve with Atlas** action, while Project Dashboard refresh failures and retained activated-testing results use the same affordance. Each action opens a reviewable new-session draft instead of submitting anything automatically.
- **Every Testing Policy Coverage card can now be discussed in context.** A compact AtlasMind logo beside the live status opens a plain-language explanation of what the enabled methodology is meant to establish, what the current files/report/tooling do and do not prove, and whether leaving the policy alone, changing configuration, or improving tests is the safest next step.

### Fixed
- **The retained activated-testing result handoff works again.** Its browser action had a validated message and a host-owned, redacted prompt builder, but the handler call itself was commented out, leaving the visible **Open result in Atlas Chat** control inert.
- **`atlasmind.acp.hideConsoleWindows` now covers the ACP health probe, which is the path that launches most often.** Of the three places that start an agent, only the probe omitted its launch options, so the private-desktop wrapper saw no request and started the agent — and every console its descendants allocate — on the visible desktop. Any panel or tree refresh past the 5-minute probe TTL relaunched it, which is why a ticked checkbox still produced terminal windows. The probe cache key had always keyed on this setting; now the spawn honours it too.

### Security
- **Discussion actions re-resolve live host state instead of trusting displayed error or policy text.** MCP errors cross the webview boundary as a server id, Testing coverage as a fixed methodology id, and dashboard refresh failures use the host-retained error. Before any of those values reaches a chat draft, likely secrets are redacted, controls and length are bounded, and repository/process text is fenced explicitly as reported data rather than instructions.

## [0.235.3] - 2026-08-01

### Fixed
- **Webview labels, buttons, badges, and compact analytics rows now size to readable content instead of splitting ordinary words into fragments.** The shared shell applied `min-width: 0` and `overflow-wrap: anywhere` to inline text and controls as well as structural containers, so flex and grid layouts could compress `requirement`, `evidence`, and `knowledge-graph` into a few characters per line even when the surrounding panel had room. Zero minimum widths are now limited to structural boxes, prose wraps at word boundaries, only genuinely unbroken links use anywhere wrapping, and controls remain bounded by their panel. Project Ideation's memory targets now wrap as whole content-sized checkbox labels, while analytics rows reserve intrinsic columns for kind and score and give the flexible middle column to card titles and meters.

## [0.235.2] - 2026-08-01

### Fixed
- **Gemini ACP no longer advertises personal Google AI subscriptions that Google stopped serving.** Google ended Gemini CLI access for free individual and personal Google AI Pro and Ultra accounts on 18 June 2026; OAuth still succeeds in the browser before the Code Assist backend rejects the client, which made AtlasMind's **Use my Gemini subscription** offer a dead end. The Google card now says **Use my Code Assist license**, every built-in setup surface carries the same entitlement boundary, and setup confirms it before installing or probing: an assigned Gemini Code Assist Standard or Enterprise license is required. Gemini Enterprise Standard and Plus include Code Assist Standard after separate assignment; Business and Frontline do not. The direct Google Gemini API provider is unchanged.

## [0.235.1] - 2026-08-01

### Security
- **Closed the remaining Dependabot alert for `qs` without widening the production dependency graph.** `@stryker-mutator/core@9.6.1` brings in `typed-rest-client@2.3.1`, which pins vulnerable `qs@6.15.1` exactly; npm cannot lift that transitive edge with a normal audit fix, and even `typed-rest-client@3.0.0` still carries the same pin. The root npm override now forces patched `qs@6.15.2` across the tree; every other consumer already resolved to or accepted that release, so the practical graph change is the single development-only Stryker copy. The production audit remains clean, and a manifest test prevents the override from disappearing before upstream removes the vulnerable constraint.

## [0.235.0] - 2026-08-01

### Changed
- **Personality Profile returns to the native AtlasMind Chat title bar, joined by Website Studio.** The existing account and globe commands now occupy visible top-right icon slots alongside Project Dashboard, Mission Control, and Settings. Project Ideation and Cost Dashboard remain reachable from the title bar’s `…` overflow, preserving the tested five-inline-action ceiling instead of silently hiding one of the requested shortcuts.

## [0.234.0] - 2026-08-01

### Added
- **"Installed but not signed in" now names the command that can actually sign you in, and offers a terminal with it typed.** The message previously said to run the agent once in a terminal and complete its own login, naming nothing — and the command a reader would infer is the *launch* command, which is the wrong one for every published agent: `gemini --acp`, `copilot --acp` and `qwen --acp` each start a JSON-RPC server that never shows a login prompt, and `claude-agent-acp` does not hold the Claude credential at all. The sign-in command is now a separate fact, read from each vendor's own documentation (`claude`, `codex login`, `gemini`, `copilot`, `qwen`, with the slash command that follows where there is one) and recorded with the date it was last verified. The same command and button appear as step 4 of the `/acp` walkthrough.
- **The ACP console-window choice is now a control on a page.** **Settings → Safety & Verification → Delegated agents (ACP)** carries the Windows private-desktop checkbox and a button that reopens the guided comparison. It writes the same `atlasmind.acp.hideConsoleWindows` value, to User settings, as the picker does, and keeps the endpoint-security disclosure next to the control rather than only in the setting's description. Non-Windows platforms are told the choice does not apply instead of being shown a checkbox that does nothing.
- **Website Studio is reachable from the two panels it links to.** **Project Dashboard → Delivery** and the Project Ideation board now offer it. The Studio pointed at both — the delivery pipeline for publishing, the board for the thinking that precedes a brief — and neither pointed back, so the only way in was typing its name into the command palette.

### Fixed
- **The Settings panel search now matches every word rather than the whole phrase.** Searching for a setting by the name VS Code gives it — `acp: hide console windows` — tested the raw query as a single substring against keyword lists written, correctly, as individual words, so any multi-word query found nothing. Punctuation no longer counts against a match either.

### Security
- **The setup terminal types; it never runs.** `atlasmind.setup.prepareCommand` composes a command in a reused terminal and stops, as `atlasmind.buzz.prepareCommand` already did — every ACP sign-in opens a browser and asks for an account password, which is not something an extension should submit unattended. The payload is checked against a list AtlasMind wrote (`ACP_SIGN_IN_COMMANDS` plus the Buzz setup commands) at the handler, because the command id is reachable from a webview; an unrecognised one is refused out loud.
- **An agent with no documented sign-in flow gets no command.** `acpSignInFor` returns nothing for any agent AtlasMind has not read the documentation for, and every surface renders that as an answer rather than printing `<command> login`. Any ACP agent can be named in `atlasmind.acp.agents`, so a guess would be a confident instruction nobody verified, typed into a shell.

## [0.233.3] - 2026-08-01

### Changed
- **The project testing posture now enables exploratory testing instead of performance testing.** The committed testing configuration, generated strategy, and managed instruction blocks remain synchronized, assigning charter-based exploratory work to the Test Developer while leaving load/stress benchmarking disabled.

### Fixed
- **Tool approval previews no longer disguise unserializable arguments as an empty object.** If a non-empty argument object collapses to `{}` during JSON serialization, AtlasMind now displays `[unserializable arguments]`; ordinary previews still pass through the existing secret redaction and length cap.

## [0.233.2] - 2026-07-31

### Fixed
- **Whole-project assessments now route as the broad reasoning tasks they are.** Short prompts such as “give me an honest assessment of my project so far” receive a deterministic high-reasoning floor, even when the optional classifier underestimates them. Among otherwise adequate candidates, AtlasMind now prefers real local or active subscription-backed capacity over a pay-per-token model whose only advantage is a small speed-score lead; weak local models still cannot displace a capable reasoner for review, planning, or synthesis.
- **A zero-output model turn can no longer masquerade as “Answered from context.”** Empty completions now carry an explicit failure summary and recovery question, with **Retry** (using available local or subscription-backed capacity) and **Provider status** reply chips. The Chat webview refuses its old generic thought-summary fallback, and both custom and native chat surfaces receive the recovery choices.

## [0.233.1] - 2026-07-31

### Fixed
- **Activated-testing repair is now observable from start to finish.** After the host-confirmed task begins, the Testing Dashboard shows an indeterminate activity indicator plus real orchestrator routing and approved-tool updates, then retains a clear completed or failed outcome with the reported task output. Completion never claims the suite is green on its own; test evidence still has to establish that.
- **Repair output can be reviewed in Atlas Chat without a copy/paste detour.** The dashboard opens the host-retained result as a new, reviewable Chat draft. It redacts likely secrets, fences the report as untrusted data rather than instructions, and never submits the follow-up automatically.

## [0.233.0] - 2026-07-31

### Added
- **Ideation is now a first-class Project Dashboard page.** The new **Where we stand → Ideation** tab reports active board state, cards still unrealized, current roadmap origins, contradictions, and the readiness rules that explain what needs attention. It reads the existing Gap Analysis, Security Review, Risk, Tech Debt, and Testing Coverage registers as available evidence, so opening the page starts no scan and spends no model budget.
- **Evidence crosses from the dashboard to the canvas through a narrow, validated bridge.** The webview sends only an opaque record id; the host rebuilds the snapshot before resolving it, then the dedicated canvas creates the card. This prevents a stale or compromised dashboard from manufacturing persisted card text, preserves the full board schema, and leaves the imported evidence unconnected until a person decides what it supports.
- **`/ideate` gives the same stage-0 reading in chat.** It reads the active board and current roadmap only, reports board state and every ranked readiness observation, then offers direct links to the Ideation overview and canvas. It never scans, invokes a model, or changes either file.

## [0.232.0] - 2026-07-31

### Added
- **Testing guidance follows you into the dashboard.** The Project Dashboard's Testing page now receives the same shared methodology catalogue as Settings, including each protocol's plain-English description, when to use it, common tools, and trade-offs. It no longer keeps a labels-only copy that can drift from the configuration screen.
- **Scaffolding can start meaningful coverage, not only lay out templates.** After the operator confirms the non-destructive scaffold, AtlasMind syncs the enabled testing instructions into existing agent-instruction files and, only when it finds an existing Vitest or Jest runner plus a small exported source module, starts one normal approval-gated task to author a focused first test. The task inspects the target first, makes no dependency, manifest, or production-source change, and leaves the workspace untouched when no stable behaviour can be established.
- **Fix activated testing brings the whole declared test posture into one repair task.** The Testing Dashboard now offers a confirmation-gated action that gives an agent host-derived policy coverage and report evidence, lets it run only existing relevant test commands through normal tool approvals, and asks it to fix the smallest correct cause before re-verifying. It cannot turn a dashboard green by disabling, skipping, weakening, or hiding tests, lowering thresholds, changing runner configuration, adding dependencies, or treating an unavailable environment as a pass.

### Changed
- **ACP plans are now live configuration labels, not a hard-coded vendor catalogue.** **Configure Agent Plan** reads the current `atlasmind.acp.agents` entries, so Gemini and custom agents appear when configured. It asks only for the subscription name shown by the service (for example, `ChatGPT Pro (5×)`), and no longer asks for a made-up monthly allowance, remaining credits, reset date, or cost per unit. ACP does not expose any of those fields through its protocol, so AtlasMind never estimates or decrements them. Legacy guessed ACP quota records are retired on activation; GitHub Copilot’s independently observable credit tracking is unaffected.

### Fixed
- **The Safety & Verification ACP tool permission now persists.** The checkbox's message is accepted by the webview boundary and saved at Workspace scope, so reopening Settings reflects the choice you made.

## [0.230.1] - 2026-07-31

### Fixed
- **VSIX packaging excludes local mutation-test sandboxes and test-only directories.** `.vscodeignore` now removes `.stryker-tmp/`, the separate `test/`, `e2e/`, and `performance/` trees, plus the Stryker configuration, so a package built after mutation testing cannot accidentally include disposable source copies.

## [0.230.0] - 2026-07-31

### Added
- **A runnable testing baseline for the highest-risk decisions.** The regular Vitest suite now includes a `fast-check` property-test example, and `npm run test:mutation` runs the committed Stryker configuration against task criticality, tool approval policy, and agent-registry scoring. The mutation runner remains separate from normal tests because it deliberately makes hundreds of altered copies of the code and is materially slower.

- **An explicit Windows ACP console choice, before the first process starts.** `/acp`, the subscription buttons and **Choose Agent** now ask whether ACP agents should use ordinary Windows launching or a dedicated private desktop. Ordinary is the compatibility-first default and explains that an agent or its MCP servers may briefly show black terminal windows during startup. The other choice writes the new `atlasmind.acp.hideConsoleWindows` checkbox and explains the trade-off in the picker itself: hidden desktops are also an hVNC malware technique, so Microsoft Defender or corporate EDR may flag or block a legitimate use. The guided choice is saved at User scope because this is a machine/EDR preference and completing setup must not dirty the repository; an explicit workspace value can still override it. The schema's default `false` is not treated as an answer: activation-time discovery, provider-panel checks and direct routed turns all refuse to spawn on Windows until a workspace or user value proves the choice was made.

- **A small, auditable private-desktop launcher.** `native/acp-private-desktop/src/main.rs` builds the dependency-free 120 KB Windows helper shipped as `media/bin/atlasmind-acp-private-desktop.exe`; `src/providers/acpWindowsLauncher.ts` is its selection and integrity boundary.

  The helper receives an executable AtlasMind already resolved plus its argv — never a shell command. It creates a private desktop with the minimum `DESKTOP_CREATEWINDOW` access, assigns it through `STARTUPINFO.lpDesktop`, starts the real agent with `CREATE_NO_WINDOW`, and uses `STARTUPINFOEX` / `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` so stdin, stdout and stderr are the only inherited handles. It never switches to, captures, or remotely controls that desktop. The agent's descendants inherit it, so a console they allocate cannot appear on the user's input desktop or steal focus.

  The release PE is pinned by SHA-256 and the test suite verifies the shipped file against the source constant. That pin is an AtlasMind integrity check, not Authenticode or reputation: the v0.230.0 PE is not Authenticode-signed, so managed environments may require an organisational signature or allow-rule. A missing, changed or EDR-blocked helper fails with an actionable message naming the checkbox to clear; AtlasMind never silently falls back to a focus-stealing launch mode the user did not choose. The Rust source is excluded from the VSIX while the pinned PE remains under `media/`.

- **`AtlasMind: Choose ACP Console Window Behaviour`.** A command-palette route back to the same two-choice disclosure. Dismissing it stores nothing, and neither choice enables the provider or grants an agent permission.

- **Visible in-editor evidence of private-desktop use.** While one or more routed ACP sessions use the opt-in private desktop, VS Code's status bar shows `ACP private desktop: <count>` and opens **Models & Providers** when clicked. It is deliberately an indicator, not a taskbar or notification-area icon: it stays in the application that owns the sessions, does not create another native window or take focus, and does not misrepresent a visibility choice as a permission boundary.

### Changed
- **Settings are now visible from the AtlasMind Chat title bar.** The Settings cog occupies the fifth inline title-bar slot instead of living only under `…`; the contextual **Update Project Memory** / **Import Project** action remains available from that overflow. The native VS Code entry for `atlasmind.acp.toolsEnabled` now begins with the same **Let subscription agents act** wording used by the AtlasMind Settings panel, so that phrase finds the setting in the Settings search box. The matching link on the ACP provider card now reaches Safety as intended, backed by a page-id allowlist rather than trusting a webview-provided command, and the card speaks in plain language about using an installed Claude Code or Codex subscription.

- **ACP conversations are live sessions now.** The routed adapter keeps a successful session for up to 30 idle minutes instead of booting and discarding the whole coding-agent process tree for every answer. It holds at most four parallel conversations and closes them on extension deactivation; temporary setup/probe adapters stay one-shot, so a short-lived object can never strand an authenticated process.

  Reuse is deliberately stricter than “same agent.” `acpHostPolicy.ts` now includes Windows launch mode and model/effort in the fingerprint alongside executable/argv, cwd, MCP list, completion-only isolation, startup-settings stamp, exit and idle state. Workspace/user `AGENTS.md`, `CLAUDE.md`, Claude settings and Codex config file size/mtime are stamped; agent environment and the complete MCP launch configurations are hashed with them. Any change replaces the live session before another prompt.

  Concurrent health/setup/panel probes are single-flighted as well as TTL-cached. Three surfaces asking the same question together now share one one-shot process tree instead of creating three, and the Windows launch mode is part of the cache key so changing the checkbox genuinely exercises the newly selected path.

- **A reused ACP session receives only conversation history it has not seen.** The adapter records the exact outer transcript after a successful answer. That transcript must be an exact message-for-message prefix of the next request; only the suffix is encoded as ACP prompt blocks. An edit, branch or changed system instruction opens another session rather than heuristically reconciling two histories. This is the conversation-history half that v0.229.0 correctly identified as load-bearing: sending the full transcript to a session that already remembers it duplicates the user's prompts and the agent's answers.

- **The v0.229 host policy is applied inside the extension host first.** This delivers reuse across AtlasMind chat sessions in one VS Code window without introducing a second authenticated IPC protocol for permission prompts and streams. The named-pipe/token/owner-lifetime policy remains the boundary for any future cross-window daemon; this release does not pretend an external host exists.

### Security
- **One logical completion reaches an ACP agent at most once inside the adapter.** The orchestrator gives each tool round a stable task identity, so an identical concurrent call or timeout race joins one in-flight promise and stream without merging two independent chats whose words happen to match. A successful retry with the same identity arriving within 15 seconds receives the recorded result, with the execution epoch (agent, cwd, settings, MCP configuration and launch mode) included in its key so a configuration change cannot replay stale output. ACP is also exempt from the generic transient-provider retry loop: once `session/prompt` may have crossed stdio, uncertainty is terminal for that attempt. The outer provider deadline now aborts the ACP attempt, sends `session/cancel`, and discards the session instead of returning while the old agent continues running and streaming late output. This prevents both double subscription spend and duplicated delegated operations.

- **A private desktop is explicitly not a sandbox.** The docs and setup copy state that it changes where windows appear, not the child process's authority. The ACP permission path remains allow-once, fail-closed, and is re-evaluated for every operation even while the process stays alive. Switching MCP/isolation/tool mode invalidates the session.

### Fixed
- Replaced literal NUL bytes in `acpHostPolicy.ts` with the readable `\u0000` separator escape, so source search no longer classifies the policy file as binary.

## [0.229.0] - 2026-07-31

### Added
- **`src/providers/acpHostPolicy.ts`** — the rules a long-lived ACP host must obey, landed ahead of the host itself so the decisions that would be dangerous to get wrong are settled where they can be tested rather than inside the process that spawns things. Pure, `vscode`-free, process-free, unit-tested.

  The host exists because AtlasMind discards the agent after every answer. Measured: `session/new` costs ~9.7s and a second prompt on a live session costs ~1.7s, so every turn pays a ten-second boot to save nothing. Keeping one alive is worth roughly **13s → 2s per answer**, and collapses the console-window flurry from once-per-answer to once-per-lifetime.

  Four rules carry the safety story, because a host holding an authenticated Claude session can spend the user's money and — with delegated execution on — run commands, which is a materially different exposure from an agent that lives for the length of one answer:

  - **Reuse is only safe while the conditions the session was created under still hold.** `reuseBlockedBecause` names *which* condition broke rather than returning a boolean, ordered root-cause-first so an exited agent is never reported as an expired idle timer. The load-bearing case is `isolation-changed`: a turn that may act must never inherit a session created with the user's settings withheld, nor the reverse — the reuse-side half of the isolation rule added in v0.228.0. A changed `CLAUDE.md` or MCP config also invalidates, because a live session is running on whatever those said when it started.
  - **The transport is the access control.** `isLoopbackOnlyEndpoint` accepts named pipes and unix sockets and refuses everything network-shaped, loopback included — a TCP endpoint is reachable by every process and every user on the machine, and there is no "but it is only localhost" exception.
  - **A weak or absent token authorizes nothing.** `isAuthorizedRequest` refuses when the expectation itself is missing or under `ACP_HOST_TOKEN_MIN_LENGTH`, since "no token configured" is the one case where every request would otherwise look valid.
  - **The host outlives one editor window but not all of them.** `shouldHostExit` stops on either no owners left or a long idle, each covering the other's blind spot — the second is for an owner that died without unregistering, which would otherwise keep Claude Code running after the user closed VS Code.

  Defaults state their own reasoning: a session expires sooner than the host holding it, supervision runs far more often than anything expires, and the host is bounded rather than immortal — "forever" is how a background process becomes something nobody remembers agreeing to.

  No caller yet. The host process, its IPC, and the conversation-history change that session reuse forces are the next steps.

## [0.228.1] - 2026-07-31

### Changed
- Committed work products left uncommitted by an earlier session: the first ATDD artifacts (`test/bdd/features/task-routing.feature` plus the `tests/features/` acceptance tests), four agent definitions, and a refresh of the SSOT memory files. No source behaviour changes — this clears the working tree so the ACP daemon work starts from a known state.

## [0.228.0] - 2026-07-31

### Fixed
- **Console windows flashing on screen during model discovery.** An ACP probe is not a handshake — it opens a **session**, because that is the only honest test of "signed in". What was not appreciated is what a session on a coding agent actually starts. Measured on Windows: `claude-agent-acp` launches the user's entire configured MCP fleet inside it — a GitKraken CLI, an `npx @azure/mcp` tree, a `contrast-checker-mcp` tree, several of them via `cmd.exe` — and `codex-acp` starts an `app-server` plus a REPL host. Every `cmd.exe` makes Windows allocate a `conhost.exe`, and a `conhost.exe` is a console window that appears and vanishes.

  The adapter's own `spawn` has always been `windowsHide: true, shell: false`; that covers the process AtlasMind starts and does not propagate to what *that* process starts. So the window could never have been suppressed from here — the fix is to stop re-launching the tree.

  **The probe TTL was 10 seconds**, a number sized for the cost of a handshake. With a dozen call sites that refresh the provider catalog — opening a panel, changing a setting, adding an agent — that meant relaunching two full agent runtimes over and over. It is now five minutes, sized for what a cache miss actually costs rather than for how fresh the answer could theoretically be. What that trades away is staleness on "is this agent signed in?", which changes on the order of days, and an explicit refresh still bypasses it.

  This only became visible in v0.217.0, which is when ACP started being probed at all — before that it was misreported as unconfigured and discovery was skipped entirely.

- **A probe session is now closed, not just killed.** Both live agents advertise `sessionCapabilities.close`, and `session/close` is sent before the process is killed so the agent reaps its own subprocess tree rather than leaving it orphaned to the OS. Best-effort by construction — bounded by its own short timeout and never throwing — because on a teardown path the only thing worse than an unclosed session is a hang while closing one. A close is never sent to an agent that did not advertise one.

- **The agent's children are killed too, on Windows.** `child.kill()` signals one process; POSIX callers reach a whole tree through the process group, but Windows has no group concept, so an agent that shelled out left its descendants running. `session/close` normally unwinds them first — this is the backstop for an agent that never advertised `close`, or failed it, which would otherwise leak a process tree per turn. `taskkill /T /F`, fire-and-forget, never throwing. The same conclusion `acp-patchbay` reached independently.

### Changed
- **A completion-only ACP turn no longer loads the machine's own agent settings.** `claude-agent-acp` hardcodes `settingSources: ["user","project","local"]` and then spreads `_meta.claudeCode.options` over it, so a client can turn them off. Those sources are where the user's own MCP fleet comes from — so a session that exists only to write a paragraph was starting a GitHub CLI, an `npx @azure/mcp` tree and a `contrast-checker-mcp` tree inside itself. **Measured on a real machine: 19 descendant processes drop to 3, and six flashing console windows drop to two.**

  This also closes a gap between what the adapter documented and what it did. Restricted mode is described as *"initialised with no filesystem capability, no terminal capability, and an empty `mcpServers` list — a completion source, not an executor."* The empty list was honoured, but the agent loaded its own fleet regardless, so the guarantee was narrower than the comment claimed.

  **Deliberately not sent when delegated execution is on.** The setting sources carry more than MCP — the project's `CLAUDE.md`, permission defaults, custom subagents — and an agent that may actually act is one the user wants their own instructions to reach. Restricting a completion source to nothing but the prompt is the conservative reading; restricting an executor is taking away context it needs. The signal is the MCP list itself, which is empty exactly when `acp.toolsEnabled` is off, so the decision sits next to the thing it is about rather than reading a setting from inside the adapter.

  `_meta` is ACP's extensibility field and this key is Anthropic's **vendor extension, not the spec** — read out of the installed build rather than a published contract, so it carries its own `ACP_CLAUDE_META_VERIFIED_VERSION` rather than riding on `ACP_SPEC_VERIFIED_AT`. It degrades safely in both directions: an agent that ignores it behaves exactly as before, and `codex-acp` was verified to accept the unknown key without error.

  Two things this is **not**. It does not make anything faster — `session/new` measured 9.3s with the fleet and 9.7s without, so the ten-second startup is Claude Code booting itself, not the MCP servers. And it does not reach zero windows: two remain, from `claude.exe` itself.

## [0.227.1] - 2026-07-31

### Changed
- **The ideation-and-research roadmap now records what did *not* ship.** Three releases delivered the scan catalog, the register, source detection, the schedule, the digest, six advisors, the runner, three commands, `/research` and the staged workspace — and five things were deliberately left. They are named in a *What is left* table with the reason each was deferred, and folded into the developer backlog, because a plan whose phases all read "shipped" while five items sit undone is a plan nobody can use to decide what to do next.

  Two kickoff questions are also recorded as decided rather than left open: the digest's "so what" is **deterministic**, from a declared sentence per scan, because the same register must produce the same digest; and `funding`/`regulatory` stay in the research register while the commercial and legal advisors keep their own — research says what is true outside, oversight says what it means for us.


## [0.227.0] - 2026-07-30

### Changed
- **The ideation panel renders one stage at a time, and the staged guide became the navigation.** Five sections used to be on screen together — composer, inspector, facilitation feedback, analytics, and a four-card guide explaining the order they were meant to be used in. That guide had been relocated twice (to the bottom in v0.119.0, back above the canvas in v0.212.1) on the theory that placement was the problem. It was not: **a guide that has to explain the layout is a symptom of the layout**.

  Frame / Scaffold / Shape / Decide is a control now. Each stage renders only what that stage needs, the board still leads the page, and the status dot on each button reports where the *board* actually is rather than which tab you happen to be reading — so the bar stays an honest description while you look ahead. The opening stage is derived rather than stored (empty board opens on Frame, populated on Shape), because storing it would freeze a first-time user on Frame the moment their board stopped being empty.

- **An empty board offers starter frames.** Eleven of them, derived from the project's detected archetype and traits, so a game and a command-line tool no longer open the same blank canvas. Every seeded card is a **question**; a frame arriving with confident-sounding conclusions would be thinking nobody did, presented as thinking somebody did. Seeding is additive and never replaces a card, and the frames are only offered while the board is empty — two independent reasons the picker cannot overwrite anybody's work.

- **The card-kind picker publishes what the kind commits to.** `KIND_PREFIX` has decided since it was written that a `problem` becomes "Fix: …" on the roadmap and a `risk` becomes "Mitigate: …", with a careful argument in the module header for why — and none of it ever reached the person choosing the kind. A rule you cannot see is a rule you cannot argue with. A test reads `ideationDerivation.ts` and asserts the panel publishes exactly the kinds that actually get a prefix; the wording may differ, the set may not.

- **The Decide stage opens with what the board cannot defend.** The readiness reading rendered from `ideationReadiness.ts`, with each line carrying the declared rule that produced it and an unresolved contradiction ranked above everything else. It blocks nothing — a release gate exists because a release cannot be undone, and a board can always be edited.

### Removed
- `renderProcessGuide` and the `<details>` panel it lived in, along with the CSS for the four-card grid. Superseded rather than relocated this time.


## [0.226.0] - 2026-07-30

### Added
- **The research engine is wired to something you can press.** v0.225.0 shipped the modules; this makes them run. `researchRunner.ts` executes one scan end to end — feasibility, prompt, advisor, parse, sanitize, reconcile, record — with every dependency injected, so the property that matters is a test rather than a comment: **a scan that cannot look never reaches the model**. Not "try anyway and see", because what comes back would be fluent, specific, and carry no signal that nobody looked anything up.

  Three commands: `AtlasMind: Run a Research Scan` (modal confirmation naming the scan, the source, and that it spends), `Open the Research Register`, and `Open the Research Digest`. A `/research` chat command reads the same state and presses nothing.

- **`atlasmind.research.*` settings, declared in the commit that reads them.** Master gate off; automation level as a ceiling every scan is capped by; per-scan `enabled`/`cadenceDays`/`automationLevel`; a source preference; and a monthly spend cap defaulting to **0**, which means nothing may run on its own whatever its automation level. Switching research on and letting it run unattended are deliberately two decisions, and one switch for both would make the first carry a cost nobody agreed to.

- **`ResearchRegisterManager`**, mirroring `RiskOversightManager` including its `preserveExisting` distinction — with one difference: it **never seeds a file on read**. The register is committed, and writing `project_memory/analysis/research.json` because somebody opened a tab would put a file in the repository they never asked for. It appears the first time a scan records something.

- **The dashboard reads research, and the Overview says so.** `collectResearchSnapshot` derives due/never-assessed/blocked counts and per-scan state, and `researchAttentionInput` owns the decision to return `undefined` when research is off — so a disabled feature can never become a permanent nag on the "Needs you" band. The Ideation snapshot also now carries the board's readiness reading.

### Changed
- **A failed run and an unassessed question stay two different facts.** `hasBeenScanned` counts only an `ok` run, so a scan that has failed three times still reads as never answered while the attempts remain visible. The scheduler measures due-ness from the last run that *answered*, so a failure yesterday cannot reset a clock that last ticked in May.

- The roadmap comparison feeding the "a competitor covers something we also claim" severity rule is read from `improvement-plan.md` **by the caller**, never asserted by a model — it is a fact about this repository, and a model has no business claiming one.


## [0.225.0] - 2026-07-30

### Added
- **Ideation can now learn something nobody typed into it.** Stage 0 of the workflow had exactly two inbound paths — the user, and Atlas reflecting on the board's existing contents — so a board full of confident cards about an unexamined market looked identical to a board full of researched ones. `researchScanCatalog.ts`, `researchRegister.ts`, `researchSources.ts`, `researchSchedule.ts` and `researchDigest.ts` are the missing inbound edge: a scan asks a question about the world *outside* this repository, records what it found, and offers each finding to the board as evidence. Six new advisors run them — Competitive Analyst, Customer Researcher, Technology Analyst, Market Analyst, Funding Analyst, Regulatory Analyst.

  **The catalog declares seven questions, and deliberately not the five people ask for first.** gap, security, risk, debt and testing coverage are already answered by registers in this codebase, and a second answer would eventually contradict the first — surfacing as a board citing evidence the Gap Analysis page denies. Those five are recorded as *subscriptions* pointing at the module that owns each; scanning is built only for `competition`, `customer`, `technology`, `feature`, `market`, `funding` and `regulatory`, every one of which reaches outside the working tree. A test asserts no declared scan is `internal`.

  **A citation, or it is not a finding.** This is the whole security story. A model asked about a market will answer — fluently, specifically, with plausible numbers — and that answer, written into git-tracked `project_memory/` and read six weeks later by somebody deciding what to build, is indistinguishable from research. So the check lives in the sanitizer rather than in a prompt: an uncited claim is recorded as a **question**, never counted as evidence, never charted, never summarised as something that changed. `https` only, because a citation is a retrieval promise somebody will click. And it holds through a hand-edit — a stored finding whose citations were deleted is demoted on read, not trusted.

  **Severity comes from a declared rule table evaluated over facts**, so July's register is comparable with March's. Which scan produced it, whether a stated deadline parses and is still ahead, whether two *independent hosts* carry the claim, whether the title collides with something already on this project's roadmap — that last one computed by the caller against the roadmap, never asserted by a model. The table is published in the register's own markdown mirror.

  **Absent is not empty.** `researchSources.ts` decides, before a scan runs, whether anything could have looked: EXA, a connected MCP search tool, or the built-in fetch. With no source an external scan returns `no-source` and names the setup step — it does not return a clean result, and it does not fall back to recollection. Fetching a named page is separated from discovery for the same reason: a `web-fetch`-only project running a competition scan would receive the model's memory with one real citation stapled to it, which is worse than no scan because it looks sourced. A hybrid scan may run its repository half and must state the half it could not assess.

- **Scheduled research: due is a fact, running is a decision.** `researchSchedule.ts` computes when a scan is past its cadence and stops there — VS Code has no daemon, and these scans reach the network and spend money on somebody else's model. Three rungs (`observe` / `propose` / `auto`) with the effective level being `min(master, per-scan)` and every reduction stated in the same sentence as the request. **A missed window is not a backlog**: six weeks with the editor closed is one due scan, not six. Due-ness is measured from the last run that actually *answered* — a failed attempt yesterday does not reset a clock that last ticked in May — and an automatic pass runs exactly one scan, never-assessed before merely overdue, ties broken on catalog order so the choice cannot shuffle between activations.

- **The research digest answers three questions, and the third is not optional.** *What changed outside? What does it mean? What is still unassessed?* Question 3 always renders, including when empty, because dropping it when inconvenient is how a digest starts congratulating you for not looking. Composition is deterministic and **no model is in the path** — each scan's "so what" is a declared sentence in the catalog, published and arguable, rather than a paragraph generated last Tuesday into a committed file. Question 1 reuses `observedDelta`'s five rules verbatim: no baseline is a first look, unknown → known is *not* zero → n (a competition scan going from never-run to twelve findings is not twelve competitors appearing), known → unknown is news ranked above the movement it hides, a changed scope discards the baseline, and your own dismissals are never reported back at you.

- **`ideationBoardTemplates.ts` — an empty board is a starting point, not a blank.** Eleven starter frames derived from the project's detected archetype and traits, so a game and a CLI tool do not open the same canvas, plus four general ones: Problem → Solution, Assumption map, Competitive position, Customer journey. Every seeded card is a **question**, never a conclusion — a template that arrived with confident-sounding answers would be thinking nobody did, presented as thinking somebody did — and a test asserts it. Nothing is placed at a coordinate here; the board already owns layout, and two placement algorithms would drift.

- **`ideationReadiness.ts` — what the board has, and what it cannot defend.** The panel could tell you how many cards were on the board; it could not tell you whether the board contained an argument or a pile of assertions. Ten declared rules, each publishing the rule that produced it: an unresolved contradiction outranks everything (the board is the one surface in AtlasMind that records an argument *against* doing something), then problems with nothing behind them, wish-list boards, boards where nothing could go wrong, unconnected cards, and cards that never reached the backlog. **A record, never a gate** — a board can always be edited, so a gate would be theatre with a cost. An empty board reads `unexamined`, never clear.

- **Three research rules join the attention feed.** A due scan (`soon`), research switched on with nothing to look with, and a question never researched (both `unassessed`). Research is the one input group whose *absence* means "switched off" rather than "not assessed" — a project that turned it off has decided, not overlooked, and a group of zeroes would make a disabled feature raise items forever.

- **`docs/ideation-and-research.md`** — the normative specification, with the ten invariants written as properties a reviewer can check rather than principles to bear in mind. The phased plan is `project_memory/roadmap/ideation-and-research.md`.

## [0.224.1] - 2026-07-30

### Fixed
- **`test-results/` was being packaged into the VSIX.** The JUnit report added in v0.220.0 is gitignored, so it never appeared in a diff — but `.vscodeignore` is a separate list, and nothing had told it. `atlasmind-0.224.0.vsix` therefore carried 836 KB of this repository's own test names into every install. Excluded now, with `tests/packageManifest.test.ts` reading the `outputFile` path out of `vitest.config.ts` and asserting `.vscodeignore` excludes it — restating the path in the guard is how the two would drift apart again.

## [0.224.0] - 2026-07-30

### Added
- **`testingReconciliation.ts` - compare the declared testing policy with the repository, and propose what to do.** A testing matrix drifts in one direction: enabling a methodology takes a click, and noticing months later that it never produced anything takes somebody deliberately looking. This project enabled fourteen in a single pass and eight still had no evidence seven weeks later. The coverage board reported those gaps accurately the whole time; what was missing was a way to *act* on them without hand-editing a tracked JSON file.

  Four properties. **Dropping is a first-class outcome, not a failure** - a methodology declared in June that the project has since decided against is a stale declaration, and presenting every gap as "write these tests" would make withdrawing one feel like giving up. **`commit` is a real answer with a real cost**: a methodology whose tooling is installed is kept, because somebody started, and the proposal says out loud that it stays a visible gap rather than filing it under "accepted". **Practices are never proposed for anything**, since they leave no artifact and there is no evidence to be missing. And **nothing is decided in the derivation** - the caller confirms, and applying is a separate call, because the outcome rewrites a file that governs how every agent in the project behaves.

  `applyTestingReconciliation` changes only whether a methodology is declared. The assigned agent, model override, notes and `blocking` flag all survive a drop, so re-enabling later restores what was there rather than a blank row. The confirmation shows the **exact lines** via `describeTestingReconciliation`: approving "reconcile the testing policy?" with a count would be approving a rewrite of a tracked file without seeing what it says.

  Adoption is derived separately from the coverage rows, which only cover *enabled* methodologies - so a project quietly practising something it never declared is invisible without it. `integration` on this repository was exactly that: switched off in the config while its tests sat in the tree and ran on every commit.

### Changed
- **Every write to the testing matrix now syncs the AI instruction files.** Three writers could change it and only one did both: the Settings page synced, while the Project Dashboard's methodology toggle and the auto-assess flow wrote the file alone. So turning a methodology off from the dashboard left `CLAUDE.md`, `AGENTS.md` and `.github/copilot-instructions.md` still instructing every external agent to follow it - the config said one thing, the tools reading it said another, and nothing on screen suggested they had diverged. `persistTestingConfig` is now the single path. The sync stays best-effort and deliberately cannot fail the save: the file on disk is the source of truth, and a mirror able to block it would turn a copy into a write-through cache.

- **Auto-assess pre-ticks only what the repository can already show.** Every corpus match used to arrive `picked: true`, which is how one click enabled thirteen methodologies - including mutation, contract, model-based and end-to-end testing on a project with none of them - and produced eight permanent gaps nobody read as gaps. Evidence comes from the same coverage derivation the Testing page renders, so what is ticked here and what reads as *Tested* there are one judgement. Everything else is still offered and still one keystroke away, described as an intention rather than presented as a decision already taken.

- `TestingDashboardSnapshot` carries `policyEvidence`, the inputs its coverage was derived from, so a caller can ask the same question about switched-off methodologies without a second workspace walk producing a second answer.

### Fixed
- **The dashboard's testing message validator rejected schema v2.** It pinned `payload.version === 1`, so after v0.222.0 the Project Dashboard's methodology toggle would have silently refused every config written since. Both live versions are accepted.

## [0.223.0] - 2026-07-30

### Added
- **A `testing` component in the project score, worth 15 points.** `buildScoreBreakdown` had eight components and 127 points and testing was not among them, so a project with fourteen declared methodologies and evidence for none scored *better* than one that declared nothing — neither carried a testing number, and the first looked more organised everywhere else. That is the one comparison a health score most needs to make, and it was making it backwards.

  Two halves, because they fail independently: ten points for the share of enabled artifact-backed methodologies that have evidence, five for a readable test report (two when the report has failures). Practices are excluded from the denominator, matching `testingPolicyCoverage`, which never counts them as gaps — scoring a project down for not producing a file Exploratory Testing cannot produce would contradict the page the component links to.

  It follows the Risk precedent exactly: the component is always present, an unassessed project scores 0 rather than leaving the denominator, and the tone is `warn` rather than `critical` with a detail saying the points are *unclaimed*. Nobody has looked is not the same as looked and found broken. The recommendation says **close or retire** — a declaration the project has outgrown is a legitimate thing to withdraw, not a failure that must be fixed by writing tests for it.

- **A `tests-evidenced` release gate.** The release gates covered the changelog, notes, version, tag, working tree and CI — everything except whether the release meets the testing standard the project declared for itself. A failing test fails the gate; an enabled methodology with no evidence fails it, because the project set the standard and is about to ship without meeting it.

  Coverage that was never gathered is `unknown`, and so is a project with no methodology enabled at all — nothing to check against is not the same as checking and finding nothing wrong. `unknown` is never a pass here: a published version can never be replaced, so this is the last point at which *"we did not check"* can still be told apart from *"we checked and it was fine"*. The gate is fed from the same coverage the Testing page renders, so the release page and the page it would send you to cannot disagree about a number.

### Changed
- `tests/views/dashboardScore.test.ts`'s perfect fixture gained a testing input, which is what its "no component is unearned" invariant is for.

### Not done
- `projectStateTree`'s `deferred.uncoveredProtocols` node renders but is still never populated: `ProjectStateTreeProvider.gather()` is synchronous by design and recomputes on ten separate events, and knowing which protocols are unevidenced requires the workspace evidence scan. Adding a filesystem walk there is precisely what that module's own note warns against, so it is left unwired rather than made cheap and wrong.

## [0.222.0] - 2026-07-30

### Added
- **`ProjectTestingMethodologyConfig.blocking` (schema version 2).** A methodology can hold back non-test writes until its evidence has been seen. Off by default and opt-in *per methodology* rather than as a project-wide switch: enabling a methodology is a statement of intent and must stay safe to make, whereas turning one into a gate changes how every task in the project runs. A project can therefore declare fourteen methodologies as the standard it holds itself to and block on only the one or two it is willing to stop work over.

  The 1→2 migration adds no `blocking` field. Absent means "this project never considered the question"; an explicit `false` would mean "this project decided against it", which a migration has no standing to claim on the user's behalf.

### Changed
- **The write gate reads the testing config.** `evaluateProjectTddWriteGate` is the only real enforcement in the system, and `buildProjectTddPolicy` / `requiresProjectTddWriteGate` never consulted `testing-config.json` — they matched on the subtask's role and wording. So a project that had switched TDD *off* still got the gate, and the thirteen methodologies it had switched *on* got no gate at all: the declaration and the enforcement had nothing to do with one another. Both the subtask path and the inferred freeform path now honour `projectWantsTddWriteGate`.

  An unreadable, absent, or newer-than-this-build config keeps the gate. In each of those cases the honest reading is "this project has not told us", and removing a safety behaviour on the strength of a file we could not read is the wrong direction to fail in.

### Fixed
- **`readProjectTestingConfig` no longer reports a newer file as "no testing policy".** It hard-gated on `parsed.version === 1`, collapsing *corrupt* and *written by a newer AtlasMind* into the same `undefined` — and every caller treats `undefined` as licence to seed and persist a fresh default. For a document whose whole content is which methodologies are enabled, that is a silent way to switch a project's testing policy off. It is routed through `interpretVersionedDocument` now, which is the module that exists to keep those two apart, and `readProjectTestingConfigDocument` exposes `preserveExisting` for the callers that are about to write.

- **One reader and one path constant, where there were two and three.** `settingsPanel.ts` carried a byte-identical copy of the reader — two implementations that could disagree about whether a config was usable, and both with the same version bug — and the SSOT path was hand-written in three files. A path repeated three times is one rename away from a sync that silently reads nothing. Both now re-export from `testingConfigLoader.ts`.

- `tests/core/schemaMigration.test.ts` asserted the migration registry was empty. That was true when no format had ever changed; the invariant it was actually protecting — every declared version is reachable from 1 — is kept and strengthened to require a contiguous, single-stepped ladder.

## [0.221.0] - 2026-07-30

### Added
- **`buildTestingObligationGuidance` — the declared testing policy, stated to the agent that writes the code.** This is the fix for the failure the v0.220.0 work only made visible: this project enabled fourteen methodologies on 2026-06-09 and eight of them still had no evidence of any kind seven weeks later. The declaration was never wrong. It was never in front of a model that could honour it.

  Testing policy reached a prompt through exactly one channel, `buildMethodologySystemPromptHint`, behind two gates. A direct task had to be classified as testing **and** match an `assignedAgentId` (`orchestrator.ts:1177-1204`). A subtask had to satisfy `inferTestingMethodologyForSubTask`, which returns `undefined` unless the task's own title, description or role already contains a testing term. So a subtask that implemented a feature and never said the word "test" was told nothing — and those are the only turns that could have written the tests.

  Three properties, each following from that failure. **The whole enabled set, never one match:** the per-methodology hint answers "which methodology owns *this* testing task" and is kept for exactly that, but choosing one of fourteen for a general obligation would silently drop thirteen. **An obligation, not a description:** the old hint closed with "report the checks you used", which a model satisfies with a sentence; work that changes behaviour and produces none of the evidence its policy names is now stated to be incomplete, and an agent that cannot produce it must say so and say why. **Empty when nothing is enabled:** a project that has declared no policy receives no block rather than generic advice about testing, which is how a prompt block becomes something agents learn to skim.

  Practices — the seven methodologies `testingPolicyCoverage` marks `practiceOnly` — are named as context but never requested as artifacts, because asking for a file they cannot produce invites an invented one. `tests/core/testingObligation.test.ts` reads the scanner's own markers and pins the two lists together, so an agent can never be asked to produce evidence the dashboard will never look for.

### Changed
- **The orchestrator injects the obligation on task modality alone.** `processTaskWithAgent` sets `request.context['__testingObligation']` when the task profile is `code` or `mixed`, and `buildMessages` concatenates it beside the other conditional prompt blocks. Modality is the *only* gate on purpose: every narrower condition available here — classification, routing needs, agent assignment, task wording — is a variation on the gate that caused the original failure, and would reproduce it with different wording. A read-only turn is excluded because it cannot leave a change behind for a test to cover.

  The per-methodology hint and the model override keep their existing, narrower conditions. They answer a different question, and both blocks can be present: the general obligation first, the specific one second.

## [0.220.0] - 2026-07-30

### Fixed
- **The Testing page had never had a verdict to report on this project.** `testingPolicyCoverage.ts` reads pass/fail only from a report the project itself wrote — it never runs a test command, which is a deliberate boundary and stays. But no path in this repository emitted one: not a script, not `ci.yml`, not the pre-commit hook. So the failure half of the page rendered *"No test report — this is not a clean result, it is no result"* from the day it shipped, on the very project that ships it. `vitest.config.ts` now declares `reporters: ['default', 'junit']` with `outputFile.junit`, so every `vitest run` writes `test-results/junit.xml`.

  It is configured rather than put behind a `test:report` script on purpose: a separate script would reproduce the same failure one step further along, with the report existing only when somebody remembered to ask for it. The pre-commit hook already runs the full suite, so the report on disk is never older than the last commit. `test-results/` is gitignored — it is evidence of a local run, and committing it would make the dashboard report whoever last pushed. CI uploads it per-OS with `if: always()`, since a red run is exactly when the per-test breakdown is wanted.

- **The `continuous` policy could never read "Tested".** It was the only enabled methodology with no `filePatterns` at all, so its best attainable status was `tooling-only` — rendered *"No tests yet"* — and a project running its entire suite on every push was reported as having a permanent gap it had no means of closing. Continuous testing leaves behind a pipeline definition and nothing else, so `PolicyMarkers.configIsEvidence` marks the one policy whose *configuration is the artifact*.

  Only a matching config file promotes it, never a script name. `continuous`'s script patterns include `/watch/i`, so a bundler's watch task matches; letting a script promote would report continuous testing for a project with no pipeline. A false "covered" is the one outcome this panel must not produce, and the flag is scoped to a single policy so a `playwright.config.ts` still means the runner is installed rather than that end-to-end tests exist.

- **Five test files had never executed.** `src/core/criticality.test.ts`, `src/providers/openai-compatible.test.ts` and `src/views/settingsPanel.test.ts` sat in `src/`; `test/nodeMemoryManager.test.ts` sat in a singular `test/` directory; and `tests/nodeMemoryManager-cache.spec.ts` used a `.spec.ts` suffix the `tests/**/*.test.ts` glob does not match. All five are now inside the suite, moved rather than accommodated by a wider glob — the files were the error, not the glob.

  Two of them did not pass on arrival, which is the point. `openai-compatible` asserted `listModels()` returns `[]` when the API answers (it namespaces ids by provider) and `[]` when the API refuses (it throws, deliberately, so a dead credential cannot be mistaken for a provider offering nothing). `nodeMemoryManager` read the directory back immediately after `upsert`, which mirrors to markdown with `void this.persistEntry(...)` and returns without waiting — so the assertion passed for a create and failed for an update, where two unordered writes race and the earlier can land last. The tests now assert the in-memory contract against `upsert` and the on-disk contract against `persistEntry` awaited directly. Also removed: two git-tracked `.vitest-panelFlows*.json` reporter artifacts from April recording a stale 2 failures.

- **The Testing page invented its own denominator.** The Testing Strategy badge read `${enabledCount} / 14 active` while the table below it rendered 23 rows, and the bootstrap and auto-assess pickers both offered *"the full list of 14 methodologies"* — the registry grew from 14 to 23 in v0.66.0 and four pieces of user-facing copy were never updated. Reading *"13 / 14 active"* you would conclude the project had nearly everything switched on when it had just over half, and the page's entire job is to report what is and is not in force. All four derive from `TESTING_METHODOLOGY_DEFINITIONS.length` now, and `tests/core/testingMethodologyCopy.test.ts` pins the rule rather than the number, so the next registry change needs nothing remembered.

- **The README's published-version baseline had drifted two releases behind.** It named v0.214.0 as the last Marketplace publication while `v0.219.0` was tagged.

## [0.219.0] - 2026-07-30

### Removed
- **The Claude Code CLI provider (`claude-cli`) is gone.** It was a chat-only bridge that shelled out to `claude --print`: it could not stream, it truncated prompts against the OS argv ceiling at roughly 26,000 characters, and it advertised no tool use. The ACP provider superseded it on every axis — the same subscription, with streaming, no prompt ceiling, image support, and now real model *and* effort selection — so keeping it meant two routes to one Claude plan, one of them strictly worse and quietly lossy.

  Removed with it: `src/providers/claude-cli.ts`, the `claude-cli` member of `ProviderId`, its provider registration and catalog alias, its subscription tier table (superseded by the per-agent ACP tiers, which also carry Claude Pro), its entry in the CLI host's provider list, its provider profile, its bespoke 120-second timeout, its prompt-cache factor, and the Privacy page's special case that borrowed the periodic health signal because `isProviderConfigured` spawned the binary twice per render.

  **Nothing breaks on upgrade, and that is asserted rather than assumed.** A workspace that pinned `claude-cli/opus` in `atlasmind.planningModelId` or `atlasmind.synthesisModelId` now holds an unknown id, which those settings already documented as falling back to normal routing; a subscription quota persisted under the old provider id resolves to nothing and spending against it is inert rather than throwing. `tests/core/removedProviderDegradation.test.ts` covers all four paths. To keep using a Claude subscription, configure an ACP agent — Model Providers → Anthropic → *"Use my Claude subscription"*, or `/acp`.

### Changed
- `docsIntegrity` no longer requires changelogs to cite source files that still exist. A changelog names files as they were at that version, so holding it to the current tree would mean every deletion forces a rewrite of history — and the entry would then describe something other than what shipped. Current documents are still held to the check.

## [0.218.1] - 2026-07-30

### Fixed
- **An ACP model variant was billed against no plan at all.** ACP subscription quotas are *model-scoped* — one `acp` provider fronts several unrelated plans, so a Claude Max entry sits on `acp/claude` — and `baseModelIdOf` stripped only the `#effort` suffix. The `@model` segment added in v0.218.0 therefore left `acp/claude@opus#high` resolving to `acp/claude@opus`, which no plan is keyed on, so the lookup fell through to a provider-level quota ACP deliberately does not have.

  The failure was silent in the direction that costs money: every model-variant turn looked like an *unmetered* plan. The "already paid for" preference kept applying after the quota was spent, and nothing decremented the plan those turns were actually billed to — so a Claude Max allowance could be consumed without the remaining count ever moving. Both variant separators now strip, since each names a choice *inside* one subscription rather than a different subscription.

### Notes
- Confirmed and pinned: **ACP subscription capacity is weighed exactly as Copilot and Claude CLI are.** Both preference paths — the general `ACTIVE_SUBSCRIPTION_BONUS` and the larger maintenance-phase bonus, which pairs with a penalty for pay-per-token — key on the provider's `pricingModel`, never on a provider id list, so the equivalence holds by construction rather than by enumeration. A test now asserts it against someone later reaching for an allowlist. The prompt-caching provider lists are not a gap: they discount *metered* input pricing, which a zero-priced subscription does not have.

## [0.218.0] - 2026-07-30

### Added
- **The models inside an ACP subscription are now routable, not just the effort levels.** The same `configOptions` array that carries `thought_level` also carries a `model` category, and it was being parsed and thrown away — so a Claude Max or ChatGPT plan presented to the router as *one* model at N effort levels when it is really *M* models at N effort levels. `claude-agent-acp` offers Opus / Sonnet / Haiku / …, `codex-acp` offers Luna / Terra / Sol; each is now a routed model id, and model and effort compose: `acp/claude@opus#high`.

  **The model list is detected, never declared.** Nothing in `acpModels.ts` names a model that must exist. Vendors ship models faster than AtlasMind ships releases, so a hardcoded roster would be wrong within weeks and wrong in the worst direction — a model you are paying for, invisible to the router. Whatever your installed agent offers today is what appears.

  **What cannot be detected is a model's standing**, because the wire format carries a name and a description but no capability field. Standing therefore comes from a declared rule, in precedence order: your new `atlasmind.acp.modelStanding` setting, then a deliberately short table of naming conventions this build will stand behind (Anthropic's Haiku / Sonnet / Opus tiering — generic words like `pro`, `max` and `turbo` are excluded, since they mean opposite things across vendors and `max` also names an effort level), then keywords in the agent's own description of that model. Every choice publishes which rule decided, on the provider card, the same convention the tech-debt register uses.

  **Unknown standing is routable, never dropped** — deliberately inverting `acpEffortTiersFor`, which discards effort values it does not recognise. An unrecognised *effort* has no depth or cost the router could score; an unrecognised *model* is a real, working model whose only unknown is its rank, and dropping it would hide capacity you pay for, precisely for the newest model. It routes and is selectable; it simply carries no `reasoningDepth` and a neutral multiplier, so it is never *preferred* on a number nobody stands behind.

  Luna, Terra and Sol currently fall through to unknown. They sit in an obvious order if you read them as moon/earth/sun — but that is etymology, not a vendor statement, and a wrong ranking sends a refactor to the small model without anybody finding out. Declare them and the router uses them fully.

  **Composition is two more declared rules:** depth is the **greater** of the model's and the effort's (a light model cannot be made deep by asking harder; a deep model at low effort is still the deep model), and cost **multiplies** (both spend the plan). Rows are capped per agent and ordered so truncation costs every effort before it costs any model. On the execute path the model is set **before** the effort — against an agent that resets dependent knobs when the model changes, the other order would silently discard the effort.

- **`atlasmind.acp.modelStanding`** — where each model sits when AtlasMind cannot tell, keyed on display name or wire value: `{ "Luna": "light", "Terra": "balanced", "Sol": "deep" }`. Values are `light`, `balanced`, `deep` or `unknown`; anything else is ignored rather than guessed at. A declaration also beats the built-in naming table, so you can correct one as well as fill a gap.

- **`src/providers/acpModels.ts`** — the pure, `vscode`-free detection and ranking, with the id round-trip, the precedence order and the unknown-is-routable property unit-tested.

### Fixed
- An ACP model id carrying a model segment (`acp/claude@opus#high`) is split before the agent lookup. An id still carrying it matches no configured agent and falls through to `agents[0]` — a turn quietly running on somebody else's subscription.

## [0.217.0] - 2026-07-30

### Added
- **Effort levels inside an ACP subscription.** AtlasMind selected nothing within an ACP plan: `discoverModels()` returned exactly one model per agent, so a Claude Max subscription presented to the router as a single fixed-depth model and every turn ran at whatever the agent happened to default to. Meanwhile the agents were *already telling us* what they could do, on every single session, and the adapter was discarding it — `newSession` kept `sessionId` and dropped the rest of the response.

  Verified against the published v1 schema and against live `codex-acp` 1.1.7 and `claude-agent-acp` 0.63.0: `session/new` returns a `configOptions` array, and `session/set_config_option` sets one and echoes the full set back. Both agents carry a `thought_level` knob — Codex offers `low` through `ultra`, Claude Agent `low` through `max`. **There is no `session/set_model` in the spec**; `session/set_config_option` is the mechanism, which is why this is wired through config options rather than a model-selection call.

  Each effort level the agent actually lists becomes a routed model — `acp/claude#high`, `acp/codex#max` — carrying a `reasoningDepth` and a `premiumRequestMultiplier`. Both feed machinery the router already has, so the gradient falls out of existing task-fit scoring and the existing budget gate rather than needing a parallel mechanism: `cheap` reaches `low`, `balanced` reaches `high`, `expensive` reaches the top. The un-suffixed row remains, and is the agent's own default.

- **`src/providers/acpEffort.ts`** — the pure model behind it, with three rules that each close a way the feature could be worse than not having it:

  - **`category` is the identity, never `id`.** Codex names the knob `reasoning_effort`; Claude Agent names it `effort`. Both label it `category: "thought_level"`. Matching on `id` would work against exactly one agent and silently do nothing against the other — and a silent no-op is indistinguishable from success, because the turn still completes, just at the wrong effort.
  - **Only `model` and `thought_level` may ever be set.** The same `configOptions` array carries the agent's **permission** mode, whose values include `agent-full-access` (Codex) and `bypassPermissions` (Claude Agent). A settings channel able to set those would route around `toolApprovalManager` entirely rather than through it, so the allowlist is deny-by-default and the refusal lives at the one place a set request is built. `model_config` — Codex's "fast mode", *1.5x speed, increased usage* — is excluded too: spending more of somebody's subscription is their decision, not a routing optimisation.
  - **The quota cost of a tier is a declared rule, not vendor data.** No vendor publishes what a `max`-effort turn costs against a plan's allowance, so the multipliers are AtlasMind's own stated assumption — published on the provider card, exactly as the tech-debt register publishes the table that graded an entry.

  Applied is **confirmed, not assumed**: the response echoes the option set back, so an agent that accepts the request and ignores it is distinguishable from one that applied it. A tier that cannot be set does **not** fail the turn — a turn at the default effort produced an answer, and aborting over a knob would turn a degraded turn into no turn — but it is reported to the output channel rather than swallowed, because the router priced that turn at the requested tier's multiplier and a silent fallback would bill high effort for a low-effort run.

### Changed
- **A model id may now carry a variant suffix, and quota resolution strips it.** `acp/claude#high` is the same subscription as `acp/claude` — a variant is a different *effort*, not a different plan. Without this, adding effort variants would have silently detached every ACP plan configured in v0.216.0: the entry sits on `acp/claude` while every turn routes to a variant, so the plan would read as configured and never once be consulted. Anything keyed to the subscription (quota, spend) resolves to the base id; anything keyed to the effort (depth, multiplier, scoring) stays on the variant. An explicitly set variant quota still wins.
- `DiscoveredModel` gains `reasoningDepth`, so an adapter can report a depth the static catalog cannot know — an effort tier is a property of what the agent offered on this session, not of a model name anybody could enumerate in advance. The catalog still wins wherever it has an answer.
- The ACP adapter keeps a per-instance record of what it last learned about each agent, alongside the shared TTL probe cache. The shared cache is deliberately bypassed whenever a process factory is injected, so relying on it alone would have made effort variants work in production and be untestable — which is the same as being unverified.

## [0.216.0] - 2026-07-30

### Fixed
- **ACP was reported as unconfigured on every refresh, and the Models tree turned that into "agent not responding".** `isProviderConfigured` had no `acp` branch, so it fell through to reading the `atlasmind.provider.acp.apiKey` secret — a key that does not exist and never will, since the entire point of ACP is to drive an agent the user has already signed in to. Every discovery pass therefore skipped ACP and set its provider health to **false**.

  The consequences compounded in the way that made this hard to place. The tree read that flag and announced *⚠ ACP — agent not responding* about an agent it had never contacted, while the provider panel, which probes directly, showed the same agents as **Ready** on the same screen. The router meanwhile excluded ACP from every candidate list, so the models sat there looking active and unreachable. And discovery being skipped is why only the seeded `acp/claude` ever appeared — a configured `codex-acp` had no model row at all.

  "Configured" now means the same thing it means for local endpoints: is there anything to talk to. That is an agent in `atlasmind.acp.agents`.

- **The health check probed the first agent and reported its answer as the provider's.** Order in a settings array is not a statement about which subscription matters, so a broken first agent condemned a working second one, and a working first agent vouched for a second that was never contacted. Every configured agent is now probed — concurrently — and the provider is healthy when any of them can be used.

- **A vendor row now reports the agent it names.** With `acp` fronting several agents, the per-vendor rows all read one provider-wide health flag, so the *Anthropic — Claude subscription* row was showing whatever the first configured agent said. Each row reads its own agent's last probe.

- **An agent nobody has contacted is no longer reported as failing.** A new `unverified` state distinguishes *not checked yet* from *checked and broken* — the same distinction `not-discovered` already draws against `model-disabled`. "Not responding" is a verdict, and a verdict requires having asked. Where the agent did answer, its own message replaces the generic two-causes advice in the tooltip.

- **The startup budget was smaller than the probe it contained.** Discovery allowed 10s per provider while the ACP adapter allowed 20s per agent — and an ACP probe is not an HTTP ping: it spawns a process per agent and opens a session, which is the only question whose answer means "signed in". Measured on this machine at ~7s for `claude-agent-acp` and ~4s for `codex-acp`, before the contention of extension activation; two agents together take **9.2s**. So the enclosing timeout fired first on a perfectly healthy install, and its handler sets provider health to false — with nothing re-probing afterwards, a startup blip became permanent. ACP now gets a budget **derived from the adapter's own ceiling** rather than restated as a second number in a second file, which is exactly how the two drifted past each other.

- **The routed ACP adapter snapshotted its agent list at activation.** It lives as long as the extension host, so an agent added to settings afterwards was invisible to routing and to the health check until a window reload — while every other ACP surface, which builds a throwaway adapter per call, already listed it. It now re-reads the setting on use.

### Changed
- **A subscription plan can now belong to an agent rather than to a provider, and the ACP plan flow asks which.** `$ Configure ACP Agents (subscription) plan` opened straight onto *"Enter monthly cost"* with no subject. That question has no correct answer: `acp` is one provider id in front of **several unrelated subscriptions** — `acp/claude` is billed against a Claude plan and `acp/codex` against a ChatGPT plan, bought separately and priced differently. Whatever figure was typed landed on the `acp` provider, so configuring the second plan overwrote the first, and the router then priced every ACP turn against one plan's cost-per-unit while depleting that plan's allowance by running the other.

  The flow now names the plan at every step: with more than one agent configured it opens on *"Which subscription are you configuring?"*, listing each agent with its current allowance, and every dialog after it is titled with that agent. Real tiers are offered per vendor — Claude Pro / Max 5× / Max 20×, ChatGPT Plus / Pro, Google AI Pro / Ultra — instead of only *Custom…*. The button no longer names the protocol, because nobody sells a subscription to a protocol.

  Underneath, `ModelRouter` gains model-scoped quotas. Pricing, scoring, budget gating and the post-turn decrement all resolve the plan through one accessor, so a turn can never be priced against one subscription and deducted from another; providers that front exactly one plan fall back to the provider-level quota and behave exactly as before. The provider card lists one row per configured agent, since a single "AI credits" line under a card naming two agents could only ever describe one of them.

- The quota-exhaustion warning resolves its subject rather than assuming a provider, so it names the plan the user configured instead of a model id they never typed.

## [0.215.0] - 2026-07-30

### Changed
- **The dashboard header shows what version is where, one pill per delivery stage.** It previously carried two: a *guessed* production branch (`detectProductionBranchRef` walks a candidate list) and whatever branch was checked out. That answers "which branch am I on?", while the project already models the real answer on the Delivery page as an ordered pipeline of stages, each naming the branch whose committed version represents it. The header ignored it — so adding a Staging stage changed nothing there, and a project with four environments still showed two pills, one of them a branch name.

  The strip is now derived from the same stage views the Delivery page renders, in pipeline order, so a stage added there appears in the header without a second definition of what a stage is and the two surfaces cannot report different versions. AtlasMind's own pipeline renders as **Local · Staging `develop` · Production `main`**.

  **The working tree gets a pill of its own.** It is the one reading taken from `package.json` on disk rather than from git, and therefore the only one that can be ahead of every branch — so it says `working tree` rather than borrowing a branch name, and carries a marker when the tree is dirty, which is precisely the condition under which it differs from everything else in the strip.

  **A version is never invented.** A stage whose branch does not exist yet reports that instead of borrowing a plausible number — a version shown against an environment nobody has deployed to claims a deployment that never happened. The pipeline's `—` placeholder is treated as unknown rather than as a value. Pills are capped with the remainder stated and routed to the Delivery page, and a project with no pipeline configured still gets the original git-derived pair, labelled so a guessed production branch is not presented with the authority of a declared stage.

- **`src/core/versionStrip.ts`** — the pure, `vscode`-free derivation, with the ordering, unknown-version and fallback rules unit-tested.

### Fixed
- The README's "since the last Marketplace publication" baseline now reads **v0.214.0**, and the list beneath it describes only what source adds over that published build. `docsIntegrity` caught the staleness the moment v0.214.0 was tagged.

## [0.214.0] - 2026-07-30

### Added
- **The Overview now says what needs a person.** A new *Needs you* band sits above the stat grid and gathers, from the pages that already know, the things that are failing, shut or past due: failing tests, a red pipeline, blocked memory writes, overdue follow-ups, release gates that are not passing, blocked promotion paths, high-severity debt, open risk findings, documents due review, stale issues. Each card is clickable and routes to the page that owns the fact.

  **It is empty when nothing needs you**, which is the whole design. The Overview once closed with a grid of twelve equally-weighted shortcut cards, and that grid was removed for being a second navigation system pretending to be a summary. A navigation grid can never be empty; this band renders a single muted line and no card frame at all when every check comes back clear.

  **Unassessed is never reported as clear.** The failure mode that would make the band actively harmful is silence earned by not looking, presented as silence earned by everything passing — so a project with no test report, no readable issue tracker, an unscanned debt register or an unassessed risk register says exactly that, in its own category, ranked below real findings but never omitted. The empty state distinguishes *checked and clear* from *too little was assessed to say*, and the sentence comes from the module so no surface can restate it more optimistically.

  **Ranked by consequence, not magnitude**, following the same rule the observed-delta band uses: a red pipeline outranks forty stale issues, ties break on declaration order so the list cannot shuffle between renders, and the six-card cap always states its remainder. Every card publishes the declared rule that graded it, as the tech-debt register does, so a grade can be argued with rather than merely trusted.

  **What moved** appears as a compact strip beneath the cards, drawn from the same observed delta the Workflow page renders — and every chip routes there, because the Workflow page owns the only *Mark as seen* control and a delta must advance exactly once.

- **`src/core/attentionFeed.ts`** — the pure, `vscode`-free model behind it: a published rule table whose declaration order *is* the ranking, eleven optional input groups where absent means "not assessed" rather than "nothing there", and a summary sentence carried on the feed so every surface tells the same story.

## [0.213.2] - 2026-07-30

### Added
- **`docs/game-engine-integration.md`** — the normative specification for the engine half, completing deliverable C0.1 alongside `project-composition.md`. Unreal, Unity and Godot identity; the `game.json` schema; asset, LFS and build-log reading; the bridge protocol; the security boundary; and a conformance checklist.

  **Detection is by decisive file, and version is read rather than inferred.** Engines identify themselves by project file, not dependency manifest — `*.uproject`, `ProjectSettings/ProjectVersion.txt`, `project.godot` — and everything downstream (CLI flags, plugin APIs, report formats) is version-specific. An engine whose version cannot be read reports `unknown` and every version-dependent affordance is withheld rather than attempted with a guess. Verified at v0.213.0: neither `.uproject` nor `ProjectVersion.txt` appears anywhere in `src/`, so Unreal and Unity projects are currently detected as `generic`.

  **Every engine CLI fact must sit behind a `*_VERIFIED_AT` constant**, following `ACP_SPEC_VERIFIED_AT`. An engine version outside the verified range reports "not verified against this version" and degrades — it never extrapolates. This is the only mechanism preventing the feature rotting silently as engines ship.

  **The bridge is read-only by construction.** The wire format defines no command frame — not a disabled one, not a gated one; the capability is absent and a test asserts it, the way `buzzClient` asserts it never sends `EVENT`. AtlasMind hosts and the companion connects, loopback only, with an authenticated first frame or a closed connection.

  **AtlasMind proposes; the engine writes.** No code path may write a `.uasset`, `.umap` or any binary engine content, at any phase, under any approval — binary content has no reviewable diff, so a confirmation dialog cannot describe what is about to change, which makes informed consent impossible rather than merely inconvenient. And no compiled artifact ships into a user's engine: the companions are Python, C# and GDScript, which is a security property and the only way the per-engine-version maintenance commitment stays keepable.

  **§8 is a degradation table** naming what gets reported for every case where AtlasMind cannot tell — no build log yields "no verdict" plus the command to produce one rather than "0 errors"; a Perforce content component yields `not-visible` rather than "0 assets"; a stale companion is refused with both versions named rather than parsed best-effort. Every row is required to be covered by a test.

### Notes
- The specification withholds affordances rather than guessing in nine distinct situations. That behaviour, not the engine support itself, is what separates this from a plugin that confidently reports wrong numbers.

## [0.213.1] - 2026-07-30

### Added
- **`docs/project-composition.md`** — the normative specification for a project that is more than one thing, in more than one place. Components carry their own role, archetype and version control system; a single-repo project is the simplest case rather than the assumed one.

  **Written as general capability, not a game feature.** Games are the forcing function — an engine fork, gameplay systems, shared libraries, a shader pipeline, backend services and internal tools are six components with different archetypes, often in different repositories, sometimes under different version control. But the same model serves Shopify, ML projects, embedded work and any forked upstream. Building it game-only would guarantee a second, disagreeing answer when the monorepo roadmap item lands, which is exactly the failure `projectArchetype.ts` was written to fix.

  **Three facts that made the gap concrete**, verified at v0.213.0: the archetype is single-valued per project, so a game with a matchmaking service can never get correct advice for both halves; there are 130 `workspaceFolders` reads in `src/` of which **123 take `[0]`**, so AtlasMind is single-root by construction; and the bootstrap picker already offers *Shopify Store / Theme* and *Shopify App* as mutually exclusive options, while `fromBootstrapLabel` maps them to two different archetypes — the composite is modelled in the vocabulary and impossible to express in the product.

  The load-bearing rules are honesty rules. **Unknown is not zero** — a component whose version control cannot be read reports `not-visible`, never a count, because telling a Perforce studio it has "0 pending changes" is worse than telling it nothing. **Topology is derived, never stored**, so it cannot disagree with the components it describes. **One SSOT, in a declared home component**, because the roadmap and debt register are about the project even when it spans six repositories. And **non-git version control is read-only forever**: an agent that can revert an artist's unsubmitted work is not a tool anybody will install, and no confirmation dialog makes it safe, because the loss is silent and belongs to somebody who never saw the prompt.

- **`project_memory/roadmap/game-engine-integration.md`** — the phased plan for Unreal, Unity and Godot integration, built on the composition model. Reading the project first (no install), then a read-only in-engine bridge, then breadth. The companion plugins are Python, C# and GDScript — **no compiled artifact ever ships into a user's engine**, which is both a security property and the only way the per-engine-version maintenance commitment stays keepable.

### Notes
- `upstreamDivergence` is named for what it does rather than where it was needed. Tracking distance from a forked upstream is pure git; a vendor board-support package, a Chromium fork and a patched Postgres have the same problem, and a module named `engineForkDistance` would have guaranteed a second copy for each of them.
- `docs/roadmap.md`'s multi-root line and Game Dev prefab line now both point here, so the three do not drift.

## [0.213.0] - 2026-07-30

### Added
- **A "Ready to ship?" section in the Project State sidebar**, listing every promotion path with whether anything *declared* is standing in its way. `src/core/promotionReadiness.ts` assesses each path: `blocked` (red, and the only verdict that counts as needing a person), `gated` (unblocked, with N gates the plan will evaluate), or `clear`. The section expands itself only when something is blocked, since that is the case worth seeing without a click.

  **The row opens the plan; it never promotes.** Promotion runs behind a built plan, per-gate attestations and a type-to-confirm on a protected target — a one-click row in a tree would route around all three. A test asserts no row can ever be wired to a promotion command.

  **What it may honestly claim is limited by how it is built.** `ProjectStateTreeProvider.compute()` is synchronous by design: it reads in-memory registries and shells out to nothing, because it recomputes on ten different events. So nothing here has seen the working tree, the version delta or live CI. The vocabulary avoids "safe" and "ready" for exactly that reason — asserted by test — and every tooltip ends by naming what was *not* checked. A green row that had silently skipped those would be the most dangerous thing this feature could produce: a shipping light that never read the code.

  The blocker rules are shared with the Delivery dashboard rather than reimplemented. Two definitions of "blocked" would drift, and the sidebar would be holding the untested one.

### Notes
- Verified against this repository's real pipeline: both paths render as `gated` with accurate counts (4 and 5 gates), and Integration → Production carries the lock and the "always confirms, never force-pushes" note.
- A path naming a stage that no longer exists is dropped rather than rendered with a placeholder — a row offering to promote from nowhere is worse than no row.

## [0.212.2] - 2026-07-30

### Fixed
- **A failing dashboard action produced no error, no log and no reply.** `onDidReceiveMessage` discarded the handler's promise with `void`, so a rejection anywhere inside it vanished: the webview posted its message and waited for ever. Every failure was therefore indistinguishable from a button that had never been wired — which is how it was reported, as the Delivery **Promote** buttons appearing to do nothing.

  The dispatcher now catches, logs the message type, and shows the reason. It cannot recover the action, so it does the only useful thing left: says a failure happened and names it. Silence is the one outcome worse than an error message.

- **Both promotion handlers now report their own failures into the modal.** `handlePromotionPlanRequest` and `handleRunPromotion` gather facts from git, `gh`, the routine registry and the plan builder before doing anything. Each of those has internal guards, but a gap in any one of them rejected the whole handler — and the dispatcher swallowed it. A failure now arrives where the user is looking, carrying the underlying message rather than a generic shrug.

  In `handleRunPromotion` the guard deliberately sits **before** `acquireDeliveryLock`, so a handler that throws on its way to the lock cannot leave the single-flight lock held. That one matters more than the plan request: by then the user has read the plan, ticked the attestations and confirmed.

### Notes
- The rest of the Promote chain was verified and is correct: the button carries the right `data-action`, the click delegate has a branch for it, the payload passes `isProjectDashboardMessage` (checked by running it against the real path ids in this repo's `delivery.json`), the handler exists, all four replies are handled, the modal renders — including with `plan === null` for the error case — it sits outside the `display: none` page sections, and its CSS is defined. Neither of this repository's two promotion paths is blocked, so both render the enabled button. The defect was only ever in the failure path.
- `void this.handleMessage(message)` **without a catch appears in six panels** — chat, MCP, model comparison, model providers, personality profile and this one. Only the Project Dashboard is fixed here, because that is where the report came from; the same silence is available in the other five.

## [0.212.1] - 2026-07-30

### Changed
- **The Ideation page's "How this workspace works" guide moved to directly above the Canvas it describes.** It rendered last — below the composer, inspector, feedback and analytics — so the explanation of the staged workflow was the final thing reached by somebody who had already had to work the board out unaided.

  **This reverses a deliberate decision, and the reversal is only safe because of what changed in between.** The guide was sent to the end because the canvas was below the fold: "a hero panel, a four-card process guide and a very tall composer came first". Two of those three are gone — the hero is now a compact stat strip, and the guide is a `<details>` element collapsed unless the board is empty. Collapsed it costs one summary line rather than four cards; expanded, that only happens on an empty board, where there is no canvas content to push down. The fold argument no longer applies to it. The test that pinned the old position now records why.

### Verified
- **Audited every dashboard's top-right shortcuts, and nothing is broken.** Across Project Dashboard, Ideation, Project Run Center, Cost Dashboard, Mission Control and Personality Profile: every header button has a listener, every command target resolves to a declared or registered command, every webview-offered command is present in its panel's allowlist, and the Cost Dashboard's "Budget Settings" lands on the settings page that actually hosts `dailyCostLimitUsd`.

  Two false positives came out of the manual pass and are worth recording, because the naive checks reproduce them: `workbench.view.scm` is a **built-in** VS Code command rather than a missing AtlasMind one, and Mission Control wires its "Project Run Center" button through a `$('id')` helper rather than a literal `getElementById`, so a substring check reports a working button as dead.

- `tests/views/dashboardShortcuts.test.ts` keeps all three checks, since each fails silently: a button with no listener, a command that does not exist, and — the subtlest — a command offered in the UI but absent from the panel's allowlist, which the host then ignores by design. That last one is correct security behaviour and an invisible bug when the allowlist is simply missing an entry.

## [0.212.0] - 2026-07-30

### Fixed
- **The settings route was invisible on every sidebar view, for two compounding reasons.** v0.202.0 capped each titlebar at five slots — correctly, since VS Code collapses the rest behind `…` — and the settings link was the item demoted to make room. It was moved to a `4_config` group, which VS Code renders **only inside the overflow menu**. And separately, four of the five settings commands (`openSettingsChat`, `openSettingsModels`, `openSettingsSafety`, `openSettingsProject`) had **no `icon` declared at all**, so promoting the group alone would still have drawn nothing.

  Both are fixed: the four commands gain `$(gear)`, and the route is promoted to `navigation` on the ten views with a free slot. Chat keeps its in the overflow, because its five slots are genuinely full and the cap is the rule this had to work within rather than around.

- **`$ Configure plan` never said whose plan.** Three subscription providers can be on screen at once and every one of those buttons carried the same five words — while the quick pick it opens has always titled itself with the provider. The button was the only step in the flow that did not say what it acted on. It now names the provider and carries a tooltip.

- **The ACP card gave an instruction with no way to follow it**: *turn on "Let subscription agents act" under Settings → Safety*, and then left you to find it. Provider copy now routes any settings page it names. The link is substituted onto the **escaped** string, so the copy stays untrusted-safe — verified against an injection attempt — and the webview sends a *page id* which the host resolves through a fixed map, never a command name it could choose.

### Added
- **The Models title bar gains a refresh.** It existed only as a per-row action, and already refreshed every provider regardless of the row it was invoked from — so the title bar is its honest home.

- **The subscription plan action is reachable.** `atlasmind.models.configureSubscription` had been registered in `commands.ts` since subscription tracking shipped, **declared in no manifest entry and attached to no menu** — so it could not be reached from the palette or any surface. Working and unreachable, which is a failure mode this repository keeps rediscovering under new names. It is now declared, iconed, and inline on subscription provider rows.

  It sits on the **provider** row rather than the per-vendor ACP rows beneath it, and that placement is the correction rather than an accident of convenience: `configureSubscription` is keyed by `providerId` alone, so one plan covers the whole `acp` provider. A "configure plan" action on the Claude row and another on the Codex row would have implied a per-agent plan that does not exist — the same confusion as the unlabelled button, relocated rather than fixed.

  Placed at `inline@6` after finding `inline@4` already taken by `models.toggleEnabled`, which matches these rows too via `/^model-/`. Two entries sharing an inline group have unspecified order.

### Notes
- `tests/views/sidebarTitlebarIcons.test.ts` pins all five: every settings command has an icon, every view with a free slot shows one, the five-slot ceiling still holds, the plan action is declared and collision-free, and provider copy only links a page that has a command behind it — a phrase matching with no destination would draw a button that goes nowhere, which is worse than the plain text it replaced.
- The v0.202.0 titlebar test asserted exact navigation sets for Sessions and Project State and needed updating. Its stated rule already included "its own settings page"; the entry simply was not in a group that could be seen.

## [0.211.0] - 2026-07-30

### Added
- **The chat path knows the workflow exists.** It never did. Only two things read the declared workflow — the Workflow dashboard page, and (as of 0.210.0) the managed blocks written into *other* tools' instruction files. `src/chat/`, the orchestrator, the planner and the mission runner had no reference to it at all. So somebody typing *"commit this and push it"* into Atlas got zero workflow awareness: the rules lived on a page they had not opened and in a file written for a different tool.

  `src/core/workflowChatGuard.ts` closes that. When a prompt implies a commit, push, branch, pull request or release, AtlasMind states what the declared workflow expects — naming the integration branch, and leading with a protected-branch warning when that is where you actually are — then offers to follow the workflow or to carry on as asked.

  **The default informs and continues, and that is the design rather than timidity.** The user this exists for is a novice, whose failure mode is not violating a rule but not knowing one existed while it still mattered. Informing teaches the rule at the one relevant moment and costs an expert a line of text. `atlasmind.workflow.chatGuidance` raises it to `gate` or drops it to `off`; gating is **opt-in** because a prompt that appears on every commit becomes a prompt people learn to click through, at which point it protects nobody and is still in the way.

  **Detection is a published keyword table, not a model.** In order of weight: a model call here would sit in front of every chat turn; the same prompt must always produce the same notice, or the advice is not something anyone can learn from; and a table can be read, argued with, and tested. The cost is stated rather than hidden — matching on wording will miss an unanticipated phrasing — and it is survivable *because the default only adds a sentence*. That asymmetry is the deeper reason `gate` is not the default: the same heuristic would not be acceptable behind a refusal.

  Silence is treated as a valid answer in four cases, each of which would otherwise assert something untrue: the mode is `off`; no workflow is declared (no rules to be outside of); the prompt implies nothing governed; or the stage that owns the action is disabled. A stage nobody enabled has no expectations, and inventing some would describe a process the project never adopted.

  Both surfaces share the one implementation, for the reason the slash dispatch does: two copies of "what does the workflow expect" would answer differently within a release.

### Changed
- **The sidebar ships in the order the maintainer actually arrived at by using it**, which beats a reasoned guess about a layout nobody had lived with: Chat, Project Director, Project State, Sessions, Project Runs, Memory, Models, Agents, Skills, MCP Servers, Resource Discovery. Both properties the previous ordering was protecting still hold — Project State stays near the top rather than below ten inventory rows, and the Director's overdue badge is somewhere you do not have to scroll to.

  **Project State stays expanded**, and declining to collapse it was deliberate: v0.187.1 made it the one uncollapsed row because "a collapsed summary shows nothing", and closing it would work directly against the newcomer this release is otherwise aimed at. Ten identical shut drawers tell a beginner nothing about where they stand.

### Fixed
- **Two robustness details found while wiring this up**, both worth recording because the first was a repeat offence.

  The guard's first version awaited two dynamic imports *and* a git call in front of **every** prompt, delaying the busy indicator on every message — the identical mistake the slash router made in 0.209.1, caught by the identical microtask-counting test in `panelFlows`. The synchronous, statically-imported detector now gates all of it, so an ordinary prompt pays one regex pass and no microtask. A test catching the same class of error twice in two releases is a test earning its keep.

  And reading the branch awaited the Git extension's activation unbounded, which would have hung a turn behind a slow extension. It is now raced against a 750 ms timeout: a slow extension costs the notice its specificity, never the user their request.

- **The detector distinguishes a verb from a noun.** "commit this" asks for a commit; "was this commit signed?" and "the push failed" are questions *about* one. A preceding determiner settles it, and both cases are pinned by test — the noun readings were matching before.

## [0.210.0] - 2026-07-30

### Added
- **The declared workflow is projected into every AI agent's instruction file.** This closes a hole the workflow feature had from the start, and the hole was structural rather than a bug: AtlasMind's gates are **self-restraints**. The effective level of a stage is `min(master, ceiling, capability, stage)`, and that arithmetic governs what *AtlasMind* may do. It cannot bind the human, and it cannot bind Claude Code, Copilot or Cursor — none of which can read a VS Code setting or a file in `project_memory/`.

  So the rules were enforced against the one participant that had already agreed to them and invisible to every other. An external agent committing straight to the integration branch was not violating the workflow; **it had no way to know one existed.** There is no stronger gate available over a process AtlasMind does not run, so the mechanism is the one that does work: put the rules in the file the agent already reads.

  New `src/core/workflowGuidance.ts` renders the committed `workflow.json` as instructions — branch rules and which branches are never pushed to, how far the reader may go at each stage, the evidence each stage wants, and the label taxonomy. It is written into `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf and Aider as a **third** managed block, alongside testing protocols and debt markers — third rather than folded in, because the questions differ, the change rates differ, and a file holding one block and not the others should keep what it has.

  Four properties are load-bearing:

  - **Derived, never generated.** Every line traces to the committed file. A model asked to summarise a workflow produces plausible rules nobody declared, and an agent would then follow them — worse than no block, because it reads as authoritative. A test asserts the text contains no invented rule vocabulary.
  - **It prints the level the *ceiling* permits, not the level a stage asked for.** A stage declaring `auto` under an `observe` ceiling is an `observe` stage. Printing `auto` would invite an agent to act on authority nobody granted, which is the one way this block could cause harm.
  - **Levels become instructions, not labels.** `propose` means nothing to a reader who has never seen AtlasMind's ladder, so it renders as "open it for review and wait for a human decision".
  - **A blocked stage collapses to `off`.** A blocker is not a preference to be weighed against a level; it states the stage cannot run. And where no stage is enabled — the default, since stages ship disabled — the block *says so* rather than omitting the section, because a missing table reads as "no rules apply".

- **A pre-commit check that the managed blocks are current, and never writes.** `atlasmind.instructions.verifyOnCommit` (default **on**) refuses a commit when a block no longer matches the document it was rendered from, naming the command that fixes it — exactly how this repository already treats a missing version bump.

  **Verify-only was chosen over the auto-sync that was asked for**, for reasons worth recording. The existing hook is entirely verification: it reads and refuses, and never touches the working tree. Making it mutate would mean *the commit you staged and reviewed is not the commit that lands*. And a **bi-directional** sync at commit time would pull other agents' edits into the repository and broadcast them to all eight instruction files unreviewed — one tool's change silently becoming every tool's instruction, on a path where those files are precisely what other agents write to. `/sync-instructions` also resolves significant conflicts in chat, and a hook cannot hold a conversation.

  How staleness is detected without a VS Code host is the interesting part. Re-rendering is impossible from a shell (the renderers need a testing config, the agent list and a settings reader), and a second copy of the rendering would drift and cry wolf until somebody disabled the check — removing the check *and* teaching that AtlasMind's gates are noise. So the sync **records a digest of the source document inside the block**, and staleness is a digest comparison needing nothing but the filesystem.

  What it detects is stated precisely rather than overclaimed: the source changed after the block was written. It does **not** catch a hand-edit that leaves the digest alone — the block says it is overwritten on the next sync, and it is. The debt-marker block is **deliberately unchecked**, because it is driven by a VS Code setting a git hook cannot read; listing it would make the hook report a file as stale forever. And a block a file does not carry is never reported, so adopting one tool does not become a standing complaint about the eight you do not use.

  Three ways out, all documented in the failure message itself, because an undocumented bypass gets bypassed with `--no-verify` — which disables the compile, lint and test gates in the same hook: untick the checkbox, `ATLASMIND_SKIP_INSTRUCTION_CHECK=1` for one commit, or nothing at all when the check cannot run (no build output, no instruction files) since **a check that cannot run is not a failure**.

  The checkbox writes **workspace** scope, and that is a requirement rather than a convention: the hook reads `.vscode/settings.json` because it has no VS Code host, so a User-scoped value would be a control that silently does nothing.

### Verified
- Rendered the block from this repository's real `workflow.json` and confirmed it reports every stage as `off` while the master switch is off — accurate, not merely plausible. Then stamped a fake `CLAUDE.md`, confirmed the checker passes; edited `workflow.json`, confirmed it fails with the file named. Both opt-out paths exercised, and the check confirmed silent on a repository carrying no blocks.

## [0.209.3] - 2026-07-30

### Fixed
- **The Project Dashboard's navigation tabs lost their styling in v0.206.0.** Every unselected tab rendered as a light grey pill with grey text on a dark panel — the browser's default button appearance, not a theme colour anywhere in it.

  The mechanism is worth recording because no diff would have shown it. `.page-nav button` was the first selector of the pill rule it shared with `.action-link`:

  ```css
  .page-nav button,
  .action-link { border-radius: 999px; border: …; background: …; color: …; padding: 8px 14px }
  ```

  The commit that added the GitHub link row inserted its rule *directly beneath that first line*, so `.page-nav button` became part of a **container layout** instead — `display: flex`, `flex-wrap: wrap`, `margin: 0 0 14px` — and was orphaned from every property that made it look like a button. Nothing was deleted and nothing was renamed; a selector simply changed which block it belonged to, which reads in a diff as one added rule.

  **Why it survived review: the selected tab still looked right.** `[aria-selected="true"]` declares its own background, colour and weight, so exactly one tab in the nav was correct and the row read as a deliberate style rather than a fault. The stray `margin: 0 0 14px` was also adding phantom vertical space beneath every tab, and `gap: 8px` was overriding the `.nav-tab` gap by specificity.

- **`tests/views/dashboardNavStyles.test.ts` now asserts the nav tabs own their appearance** — background, border, colour, padding and radius, all from theme variables and never a literal colour. It also checks the selected-tab rule still exists (the thing that camouflaged the bug), that the GitHub link row is still laid out as a row (so the fix cannot be made by breaking what displaced it), and that the pill remains **one** block shared with `.action-link` rather than two that can drift. Verified by reverting the fix: 8 of 11 assertions fail.

### Notes
- The first version of the explanatory comment used backticks around CSS selector names, inside the backtick-delimited `DASHBOARD_CSS` template literal — which terminated the string and produced five syntax errors. `tsc` is the guard for that class of mistake and caught it immediately; the comment now quotes selectors with `"` instead.

## [0.209.2] - 2026-07-30

### Fixed
- **The README's "What's new" section was measuring from the wrong release.** It claimed *"Since the last Marketplace publication, **v0.145.3**"* while the Marketplace has had **v0.208.0** since this morning — sixty-three releases stale. So the section listed **81 bullets** of work, almost all of which is already in the published extension. Anyone reading it to decide whether a source build was worth installing was being told the delta was two hundred lines when it is four.

  Trimmed to what a v0.208.0 user is genuinely missing: the ACP connection fixes, the three new subscription agents, the chat panel's slash commands, and one line on the release pipeline moving to Entra ID. The full history is unchanged in this file and in `wiki/Changelog.md`, which is where it belongs — the README's job here is the upgrade decision, not the record.

- **Nothing local could have contradicted the claim, so it rotted quietly.** Every other version check in `docsIntegrity` compares two files in this repository; this one asserts something about the outside world. `tests/docsIntegrity.test.ts` now pins the stated baseline against the **newest git tag**, which is the offline stand-in for "what is published" because `npm run tag:release` is what triggers the Marketplace publish — the tag and the publish are one event. It also refuses a baseline *ahead* of the source version, which would make "what's new" describe a rollback as a feature.

  The guard is **skipped where tags are absent**, and deliberately: `ci.yml` checks out shallow with no tags, but the pre-commit hook runs the full suite locally, which is exactly where the README gets edited and where a stale baseline is introduced. A guard that fires at the moment of the mistake beats one that fires nowhere, and it is not worth `fetch-depth: 0` on every CI run to relocate it.

### Changed
- **The README's evergreen sections now describe what AtlasMind actually does.** Trimming "What's new" exposed a second problem it had been hiding: fifteen shipped capabilities appeared *only* in that accumulated list, so the pitch a Marketplace visitor reads had never been updated to include them. Cutting the list would have deleted them from the README entirely.

  Added to **What is included**: the guided GitHub workflow and its automation ladder, ideation reaching the backlog, roadmap items becoming issue drafts, the tech-debt register and its published rule table, the four delivery keys, agent handoff, schema migration, GitHub deep links, the keep-awake lock, and locale-aware cost display. Added as a new pillar: *"Work the way your repository already works."* Subscription-backed capacity is now named where models are discussed rather than left implicit.

  Every claim was checked against the code that implements it rather than against the changelog prose describing it — which caught one overstatement on the way in: the dashboard does **not** link every page to GitHub, because four pages are about this machine rather than the repository, so "each page" replaced "every page".

- **Two statements were stale rather than missing.** The slash-command table still said to use `@atlas /<command>`, written before the panel accepted them at all — it now names both surfaces. And the eight-stage workflow was still listed without ideation, which became stage 0 in v0.208.0.

### Notes
- The heading format `## What's new in <version>` is asserted by `tests/packageManifest.test.ts` and was kept. A first attempt renamed it to "since the published build", which read better in isolation but broke a deliberate tie between the README and `package.json`; correcting the baseline sentence achieves the same thing without loosening that check.

## [0.209.1] - 2026-07-30

### Fixed
- **Every slash command was inert in the AtlasMind chat panel.** `runPrompt` never looked for a leading `/`, so all nineteen commands the manifest declares reached the orchestrator as ordinary prose. On a machine with no provider configured, `/acp` was therefore answered by the built-in echo adapter with *"Answered from context."* — a command that is declared, documented, autocompleted by the composer, and does nothing.

  **Silent is the part that mattered.** A command that visibly fails gets reported; one that produces a plausible answer from a model teaches the user the feature works and they are holding it wrong. And the specific fall-through was worse than generic: `/acp` and `/buzz` are *setup* commands, asked precisely because nothing is set up yet, and they were being handed to an agent holding every connected tool — a far wider surface than either command was ever meant to have. `participant.ts` closed exactly this hole for the VS Code chat surface in v0.164.0 and documents why; the panel never got the same treatment, and nothing tied the two together.

- **The two surfaces now share one dispatch instead of one having none.** `runDeterministicSlashCommand` is factored out of `handleChatRequest`, and the panel replays those same handlers through `ChatStreamCollector` — a `ChatResponseStream` that writes into memory. Seventeen commands, one implementation. The alternative considered and rejected was a table pairing each command with an equivalent VS Code command: nineteen chances for the panel to answer `/agents` differently from `@atlas`, kept correct by hand forever.

  Handler buttons become the panel's existing guide chips, so only ids cross into the webview and the commands they map to stay extension-side — the boundary the Buzz guide already draws. Stream features the panel cannot draw degrade to a note naming them rather than throwing, because losing an anchor is better than losing the command, and a silently truncated answer is the failure this whole path replaces.

- **A path is not a command.** The parse is deliberately narrower than "starts with a slash": `/usr/local/bin/claude-agent-acp is missing`, `/etc/hosts`, and `/README.md` stay prose, because asking about a file by absolute path is constant in a coding assistant and hijacking it would break that. Only a single lowercase, optionally-hyphenated word qualifies.

- **A near-miss is corrected rather than forwarded.** `/agent` — the singular of a real command, and the likeliest typo — now names the available commands instead of quietly becoming a model call, which is the same bug in miniature.

- **`/project` and `/loop` route onto the panel's own long-running paths**, which already own run proposals, loop checkpoints and the run-center wiring. `/project` forces its goal past the prose intent router — a goal typed after `/project` often will not match those patterns, so the command would otherwise have become an ordinary chat turn — but **deliberately does not pre-approve it.** The approval token that `New Loop` uses would have removed the file-count proposal gate as a side effect of routing, and that gate is the only thing between `/project` and an unattended run. `/project` with no goal is refused rather than run against the empty string.

### Changed
- **Ordinary prose costs nothing at the new branch — not even a microtask.** The first version awaited two dynamic imports before concluding a prompt was prose, which delayed the busy indicator on every single message; an existing test counting microtasks caught it immediately. The router is now synchronous and statically imported, and the collector is imported only on the branch that needs it.

- **The slash-command list lives in one module** (`views/chatSlashRouting.ts`) and `participant.ts` re-exports it under its old name. Two copies is how one surface came to have never heard of commands the manifest declares. A test pins the list against `package.json` in both directions, so adding a command without teaching every surface fails the build.

- **`tests/chat/slashCommandRouting.test.ts` is re-anchored on function boundaries** rather than on a `case` label. It sliced the dispatch from `handleChatRequest` to `case 'voice':`, and factoring the deterministic commands out moved that label *above* the function — leaving the slice empty and the assertion passing vacuously. A source-inspecting test whose anchor can drift out from under it is worth less than it looks.

## [0.209.0] - 2026-07-30

### Fixed
- **The ACP connection did not work. Four separate faults, each sufficient on its own, and all of them verified against live agents rather than reasoned about.** ACP has shipped since v0.170.0 as "use the subscription you already pay for", and nobody could have used it on Windows.

  **1 — AtlasMind told you to install a package that provides a differently-named binary.** The adapter spawned `claude-agent-acp`; the install command said `npm install -g @zed-industries/claude-code-acp`, whose `bin` is `claude-code-acp`. Following AtlasMind's own instructions therefore produced a binary AtlasMind would then fail to find. The two facts lived in different files — the adapter, the installer and the `/acp` guide each carried their own copy — so nothing in the code could notice they disagreed. That package has since been deprecated and renamed to `@agentclientprotocol/claude-agent-acp`, which *does* provide `claude-agent-acp`. There is now one list, every install command is derived from it, and a test asserts each command against the package that really provides it.

  **2 — `cargo install codex-acp` installed nothing, because no such crate exists.** The Codex path required Rust, planned a rustup install for anybody without it, and could never have produced a working agent. Codex's adapter ships on npm like every other one, so the Rust prerequisite and the rustup dead end are gone rather than kept for a case that never existed.

  **3 — Windows could not spawn an ACP agent at all.** Every published adapter is an npm `bin`, and an npm `bin` on Windows is three sibling shims — an extensionless shell script, a `.cmd`, and a `.ps1` — none of which is an executable image. `spawn(command, args, { shell: false })` therefore failed with **`ENOENT`** for a perfectly correct global install, and `ENOENT` reads as "you have not installed it" to somebody who has. Resolving to the `.cmd` does not help either: Node has refused to spawn `.cmd`/`.bat` without a shell since the fix for CVE-2024-27980, and a shell is not on the table — the whole point of `shell: false` is that there is no interpolation to escape.

  New `src/providers/acpLaunch.ts` resolves the shim to the JavaScript entry point its own package **declares** in `package.json` `bin`, and spawns Node against that. It reads a contract the package author wrote rather than parsing npm's generated shell scripts, and it handles the case where the names do not match at all — `gemini` lives in `@google/gemini-cli`. A real `.exe` is still spawned directly; POSIX is untouched, where the shim is executable and there is nothing to work around.

  **4 — an agent that listed its logins was reported as signed out, and refused.** `authMethods` in the `initialize` response advertises which logins *exist*; it says nothing about whether this user owes one. `codex-acp` lists `api-key` and `chat-gpt` unconditionally, then creates sessions and completes turns perfectly for somebody already signed in — so reading that non-empty list as "not authenticated" refused every working ChatGPT subscription, with no way to make the message go away. The spec's actual signal is the reserved error **`-32000` auth_required** on the gated request, and that is what AtlasMind reads now. The probe opens a real session to find out, so it reports that the agent *can be used* rather than that it started.

- **Every ACP completion was recorded as costing nothing.** Token counts were read from `inputTokens`/`outputTokens` on the `usage_update` notification. No agent has ever sent those: the spec's `usage_update` is `{ used, size, cost? }` — cumulative *context occupancy*, a progress bar rather than a bill — and the per-turn counts arrive on the `session/prompt` result. Both are now read for what they are, and context is deliberately never billed as input tokens, which would re-charge the whole conversation on every message.

  Off-spec, and read anyway with the compromise confined to the safe direction: `usage` is not in the published `PromptResponse` schema, but it is the only place a real count appears and every current agent sends it identically. Absent or unusable counts still report zero rather than an estimate. Nothing is derived from `totalTokens` — splitting a total into input and output would be arithmetic nobody measured, handed to the cost tracker as though somebody had.

- **A spawn failure now says what to do about it.** Not-found names the command, says a binary installed after VS Code started is often not on this window's PATH until a reload, and an unspawnable shim explains itself instead of surfacing a bare `ENOENT`.

### Added
- **Three more subscriptions became routable capacity: Gemini CLI, GitHub Copilot CLI, and Qwen Code.** Gemini was previously excluded on the correct grounds that its ACP invocation was unpublished; the ACP registry declares it now, so the offer on the Google card is a button that works rather than one that cannot. All three are ordinary interactive CLIs with an ACP mode, so `args` is part of the launch command and is carried everywhere an agent is registered — a `gemini` configured without `--acp` opens a REPL that never speaks a word of JSON-RPC and times the handshake out with nothing to explain why.

- **goose, OpenCode, Cursor and Kimi CLI are named with their launch commands.** These ship as platform archives, and AtlasMind will not download and unpack one — so there is no install button, because a button that cannot work is worse than none. What is worth having is the command: somebody who already runs goose should not have to work out the ACP flag, and "any agent that speaks ACP" is not a useful answer to "which ones, and how".

### Changed
- **Launch commands are transcribed from the ACP registry, at a pinned version, by a human.** Deliberately not fetched at runtime: a launch command that arrives over the network and is then spawned is remote code execution with extra steps — the same line `acpInstaller.ts` and `buzzDocsSource.ts` already hold.

- **The comparison matrix is out of the wiki.** `wiki/Home.md` carried a "How It Compares" table rating six competitors across nineteen capabilities. It was already contradicting itself on the same page — "31 built-in skills" in the matrix, 43 in the navigation table directly above it — which is the predictable end state of a document asserting facts about software we do not ship and do not watch. A stale claim about a competitor is worse than no claim, and v0.147.0 had already removed the standalone comparison page for exactly this reason; this table survived that cleanup.

### Verified
- Driven end to end through the compiled adapter against live agents, not mocks: `claude-agent-acp` 0.63.0 streamed a reply with `inputTokens: 2, outputTokens: 5`; `codex-acp` 1.1.7 streamed a reply with `inputTokens: 28693, outputTokens: 6` **while advertising two auth methods**, which the previous build would have refused; `gemini --acp` 0.53.0 resolved through the shim bypass with its flag intact, handshook at protocol v1, and was correctly reported as *not signed in* by way of a real `-32000`, naming all four logins it offers. The same build that accepts Codex rejects Gemini, which is the discrimination the old code could not make.

## [0.208.3] - 2026-07-30

### Changed
- **The Marketplace publish no longer uses a secret.** `publish.yml` now signs in with `azure/login` as the user-assigned managed identity `vscode-marketplace-publisher` through GitHub OIDC workload identity federation, and publishes with `vsce publish --azure-credential`. There is no Marketplace credential in this repository to expire, rotate, or leak. PAT authentication for the Marketplace is retired on **1 December 2026**, so this was not optional — only sequenced.

  Verified before switching: the identity authenticated, resolved its Azure DevOps profile, and reported `The Personal Access Token verification succeeded for the publisher 'JoelBondoux'` — all without publishing anything.

- **`publish.yml` checks publish rights before it packages.** The 0.208.0 release found out its credential was dead *during* the upload, after building the extension. The pre-flight asks first, costs a second, and consumes no version number.

- **`npm run publish:release:ci` is new and deliberately separate from `publish:release`.** The existing script authenticates with whatever `vsce login` stored in the OS keychain and remains the emergency path from a developer machine; the CI script uses the Entra identity. Adding `--azure-credential` to the first would have broken local publishing, so there are two scripts and neither pretends to be the other.

- **`release.yml` no longer demands a `VSCE_PAT` secret**, because none is used. It checks the three Azure identity variables instead — variables rather than secrets, since a client id, tenant id and subscription id are all discoverable. The security is the federated credential's subject, `repo:JoelBondoux/AtlasMind:environment:marketplace`, which is why both jobs declare that environment and would fail without it.

### Notes
- The publisher's Members list identifies the identity by its **Azure DevOps profile id**, not an ARM resource id (which the VS Code docs suggest and the UI rejects with "Not a valid User Id") and not an Entra object id. That id does not exist until the identity has authenticated once, which is why `Marketplace — verify publishing identity` has to run before the membership can be granted.
- The expired `VSCE_PAT` secret is now referenced by nothing. It is inert, and can be deleted with `gh secret delete VSCE_PAT`.
## [0.208.2] - 2026-07-30

### Fixed
- **The release promotion conflicted with itself on every release after the first.** `release.yml` merged the `develop` → `main` pull request with `--squash`. Squashing rewrites develop's commits into one *new* commit on `main`, so `main` immediately holds a commit that is not an ancestor of `develop`. The next promotion therefore has a merge base two releases back, and every file both branches touched in between conflicts — which is precisely `CHANGELOG.md`, `package.json`, `README.md` and `wiki/Changelog.md`, the four that every single release touches.

  It works once and conflicts forever afterwards. Promoting 0.208.1 hit it: nine conflicting hunks, `main` one commit ahead, `develop` fifty-nine, merge base at PR #145.

  Promotion now uses `--merge`, which keeps `main` an ancestor of `develop` so the next promotion has nothing to resolve. This release also carries the back-merge that unpicks the divergence squashing already created.

### Notes
- A `workflow_dispatch` workflow must exist on the **default branch** before it can be dispatched. Since `main` here only moves by release promotion, a newly added manual workflow needs a promotion before it can be run — which is why 0.208.1 was promoted without a tag.
## [0.208.1] - 2026-07-30

### Added
- **A workflow that proves the Marketplace publishing identity works, without publishing.** `Marketplace — verify publishing identity` authenticates as the `vscode-marketplace-publisher` managed identity through workload identity federation and answers two questions: what its Azure DevOps profile id is, and whether it has publish rights on the publisher.

  The profile id matters because it is what the publisher's Members list calls a "User Id", and **it does not exist until the identity has authenticated at least once** — so this run is the only way to obtain it. Neither an ARM resource id nor an Entra object id is accepted there.

  The rights check runs `vsce verify-pat --azure-credential`, which is the point: a published version can never be replaced, so the only safe way to test a publishing credential is one that consumes no version number. Before the membership exists the check fails, and the job summary says so explicitly rather than reading as a broken setup — authentication failing and rights failing are separated, because the first is a misconfiguration and the second is just where you are in the setup.

  `workflow_dispatch` only. It authenticates as the release identity, so it runs when somebody asks.

### Changed
- **Azure identity values are repo *variables*, not secrets.** A client id, tenant id and subscription id are all discoverable; treating them as secrets would imply the security rests on keeping them quiet. It rests on the federated credential's subject — `repo:JoelBondoux/AtlasMind:environment:marketplace` — which is why the verify job declares that environment and would fail without it.

### Notes
- `publish.yml` is deliberately unchanged for now. Switching it to `--azure-credential` before the publisher membership exists would replace one broken publish path with another; it changes once the verify workflow reports `success`. PAT authentication for the Marketplace is retired on **1 December 2026**, so the switch is not optional — only sequenced.
## [0.208.0] - 2026-07-30

### Added
- **The ideation board is stage 0 of the workflow now, with a door into stage 1.** The board had nine card kinds — including `problem`, `requirement`, `risk` and `evidence` — and exactly two outbound paths: launch an autonomous run, or append prose to a memory file. Neither reached the backlog, so the eight-stage workflow started at *Planning & Issue Intake* with nothing feeding it, and a card literally called `requirement` could not become a requirement.

  **Raise as work** turns a card into a roadmap item. Nothing is generated — the wording comes from a rule table over the card and its edges, so the same card produces the same line every time and the roadmap stays a file somebody can review. A `problem` becomes `Fix: …` and a `risk` becomes `Mitigate: …`, because the work is the fix rather than the problem; a `requirement` or an `idea` needs no prefix, since putting an idea on the roadmap *is* the commitment.

  **Focus is deliberately not decided in the new module.** The roadmap already derives an item's focus from its text with one published keyword table; a second classifier keyed on card kind would eventually disagree, and the disagreement would show as an item whose priority reason contradicts its own label.

- **The board's connections become the issue's reasoning.** This is the one thing ideation knows that no hand-typed issue body ever contains: what a piece of work depends on, what supports it, and what argues against it. Direction is load-bearing — “this depends on X” and “X depends on this” are opposite plans — so each of the five relations is written out both ways rather than templated. A **contradiction is stated as a caution**, never listed among the supporting points: raising work while hiding the card that argues against it is the worst use of a board that recorded the argument.

  Recomputed from the board as it is *now* rather than stored when the item was raised, so a connection added since is still true.

- **Provenance runs both ways, and each direction uses the key that survives.** The card keeps the roadmap item's **normalized text**; the roadmap page shows an item's originating card by matching it. Not an id in either direction: roadmap ids are positional (`roadmap-${index + 1}`, assigned after filtering), so inserting one item renumbers every item below it and a stored id would mean something different a week later. A renamed item is reported as **no longer linked**, with what it used to say — never shown against whatever now occupies that position.

- **What is still on the board, beside the backlog.** The Roadmap page counts cards that never became work, and separates the ones that matter: an idea nobody has acted on is not a problem, but a written-down `problem`, `requirement` or `risk` that never reached the backlog is. Absent entirely when there is no board.

### Fixed
- **The dashboard had been reading the ideation board through a stale vocabulary.** Its copy of the card kinds was the older set (`concept`, `insight`, `question`, `opportunity`, `user-need`) and its sanitizer coerced anything unrecognised to `concept` — so five of the nine kinds the panel actually writes were silently relabelled on every read.

  That was not cosmetic. `summarizeIdeationBoard` renders `- [kind] title` **into a model prompt**, so a `problem` card and an `idea` card arrived at the model indistinguishable, erasing exactly the distinction card kinds exist to make. Both vocabularies are now recognised, because boards written by older versions really do contain the legacy names, and the fallback is a current kind rather than a legacy one.

- **The dashboard could not see the board's typed relations at all.** Its copy of the connection record had no `relation` or `direction` field, so every edge was an unlabelled line — which is why an issue raised from a card had no way to say what the card depended on. Neither field is *required* when reading, because a board written before the panel had typed edges has neither; an untyped edge reads as `supports`, the weakest of the five, so nothing is promoted into a dependency or a contradiction nobody drew. A model-suggested link gets the same weakest relation, for the same reason.

- **Two NUL bytes committed in v0.207.0, in a security-boundary test.** They came from a shell heredoc mangling a double space, and one of them replaced the exact double space the assertion checks for — so the hostile-input test had been passing without testing what it reads as. Repaired, with a repository-wide sweep confirming no others.

- **The v0.207.0 issue-provenance line quoted a positional id.** `item \`roadmap-7\`` would have pointed at a different item as soon as anything above it was added or removed. The issue now names the roadmap *file*; the item's own text is already in the issue and is the durable reference.

- **Four more Windows temp-cleanup flakes.** `projectRunHistory` and the CLI test still called bare `fs.rm` on a just-written tree, which throws `EBUSY`/`EPERM`/`ENOTEMPTY` on Windows — the same class fixed in v0.201.1 and the reason `tests/helpers/tempDir.ts` exists. One of them failed locally during this change; a test that passes every assertion and then fails on housekeeping is a false negative.
## [0.207.1] - 2026-07-30

### Fixed
- **Re-running bootstrap destroyed your ideation board.** `seedBootstrapIdeation` wrote `ideas/atlas-ideation-board.json` unconditionally, so a second bootstrap on an existing project replaced every card, connection and piece of evidence on the board with defaults derived from the intake answers — and returned `true` either way, so the report said "Seeded ideation defaults" for what was an erasure.

  The board is a **document the user authors**, not a scaffold AtlasMind maintains. It now follows the same rule as `documentsManager` and `workflowConfig`: seeding never overwrites, and only an explicit save replaces content. The existence check happens before the directory is created, so a re-run touches nothing at all, and the report says which of the two things happened.

  This repository's own board is sitting in `project_memory_old/ideas/`, which is what the bug looks like from the outside. A board that is silently discarded on re-run is a board nobody invests in.
## [0.207.0] - 2026-07-30

### Added
- **A roadmap item can be raised as a GitHub issue.** The roadmap held the work in a structured, prioritised, gate-tagged list. Issues could only be created by hand-typing a title, a body and a comma-separated label list. Nothing connected them, so anybody planning in AtlasMind and tracking on GitHub retyped every item.

  **The draft is derived, not generated.** No model is in this path, so the same item produces a byte-identical issue every time — which is what makes it reviewable: you can see the rule that chose a label and predict what the next item will produce. A generated issue title is a claim nobody checked, posted publicly in your name.

  **It drafts; it does not file.** The text lands in the issue composer for you to read and edit, and posting goes through the same confirmation as every other issue write. Two steps rather than one, because the alternative is a button that publishes.

  **Labels come only from the declared taxonomy.** An invented label is *created* on the repository as a side effect of filing — a write nobody asked for, in a vocabulary the team agreed. Each focus has several candidate labels tried in order, the repository's own spelling wins (`Documentation` and `documentation` are one label to a human and two to `gh`), and an intent that matches nothing is **reported in the draft** rather than dropped silently. A gate becomes a label only where the repository already uses that word.

  Completed items are excluded rather than sorted last: raising an issue for finished work is never the intent, and offering it invites a mis-click that posts publicly. Asking for one anyway confirms first.

- **A milestone can be attached when an issue is created.** `gh issue create` was called with `--title`, `--body` and `--label` only — so a milestone could be declared in the taxonomy, managed on the Issues tab, and attached to nothing. The composer now offers the repository's open milestones, and a name that is not one of them is **refused with an explanation** rather than passed to `gh`, which would fail with a raw CLI error.
## [0.206.0] - 2026-07-30

### Added
- **Every dashboard page now links to the GitHub page it is about.** The dashboard read GitHub, reasoned about it, and then left you to navigate from the repository root yourself — a small friction repeated many times a day. Issues links to the tracker, to unassigned issues, and to the label list; Pipeline to Actions; Release to releases and tags; Workflow to branch protection; SSOT to `project_memory/` as your team sees it committed.

  **The webview never names a URL.** It sends a page and a link id; the host maps that to a URL it built itself from a validated slug and a constant path. A surface that could name the URL to open could name any URL, and `openExternal` hands it to the browser without asking whose it is.

  **The slug is treated as untrusted input**, because it is: it arrives from a git remote or `gh`, and it is interpolated into a URL. It is validated against GitHub's real naming rules — 39 characters for an owner, no leading or trailing hyphen — rather than checked for a slash, so nothing carrying a path segment or a query can redirect a link. A slug that does not parse produces **no links at all** rather than links to a plausible-looking wrong repository; pointing somebody at somebody else's issue tracker is worse than no button.

  **Derived from the git remote, not a `gh` call.** No network round trip, no authenticated CLI — which matters because a route *to* GitHub is most useful on exactly the setups where `gh` is not working.

  **Only surfaces every repository has.** `/wiki`, `/discussions` and `/projects` can each be switched off, and a 404 behind a button we drew reads as our bug rather than as a repository setting. Four pages — Privacy, Runtime, Risk and Ideation — get no links at all, because they are about this machine, this extension, and this project's own judgement; inventing a repository page for them would be filling a slot rather than answering a question.
## [0.205.0] - 2026-07-30

### Added
- **Two tests for the two bug classes that kept recurring, and both found things.** Doc drift was the most-repeated defect in this project's history and the only one with no guard; tree commands were attached in twelve places with no guard at all.

  `tests/docsIntegrity.test.ts` resolves what the documentation points at rather than judging what it says — wikilinks, relative links, cited source files, cited CI workflows, cited settings, the version in four places, and the `CLAUDE.md`/`AGENTS.md` byte-identity. `tests/views/treeCommandIntegrity.test.ts` checks every command a tree row or titlebar button names against what is actually registered, and every dashboard page a row opens against the page list.

- **Two settings that were live and undeclared.** `atlasmind.testingPolicyOverride` has been read by the Testing page since 0.46; `atlasmind.ideation.crossProjectPaths` by the ideation panel since 0.86. Neither was in the manifest, so both worked if you hand-edited `settings.json` and were invisible in the Settings UI. Documented, functioning and undiscoverable is the worst of the three states.

### Fixed
- **A setting removed in April, documented as current ever since.** `atlasmind.specialistRoutingOverrides` shipped in one commit and was taken out of both `package.json` and `src/` on 18 April 2026. Four documents kept describing it, one with a worked JSON example — so anyone following the docs would write that JSON and get silence, which is worse than the feature being absent and worse than being told it is gone. All four now say so, and name the Model Providers panel instead.

- **Four rows in `CLAUDE.md`'s own UI table named files that do not exist.** `agentEditorPanel.ts`, `skillEditorPanel.ts`, `memoryBrowserPanel.ts` and `projectPlannerPanel.ts` — the instruction file every agent reads before touching this codebase was describing four surfaces by the wrong path. Agents and skills share `agentManagerPanel.ts`; memory is the tree plus a file open, not a webview; planning is Mission Control and the Project Dashboard.

- **A root link written as a sibling link.** `docs/development.md` pointed at `SECURITY.md` from inside `docs/`, which resolves to `docs/SECURITY.md`. The file is at the repository root.
## [0.204.0] - 2026-07-30

### Added
- **What moved since you last opened the project.** Every band on the Workflow page answered *what is the state?* — the score, the gates, the counts, the gaps. None answered *what changed?*, and for somebody working alone or in a small team that is the more useful question by a wide margin: the state is nearly the same every day, so a surface that only reports state is one you learn to skim.

  It is the **first card on the page**, because the ladder is a setting you change once and this is the part that differs daily. The window is *since you last opened this project* — the only span that can be stated in a sentence — and the card names it ("in the last 3 hours", "since 2026-04-12" once a duration would mislead).

  Five ways a delta can lie are closed in the module rather than left to the caller:

  - **No baseline is a first look, not eighteen changes.** With nothing to compare, every field differs from nothing; rendering that as news on a fresh install would be false at the exact moment somebody is deciding whether to trust the surface.
  - **Unknown → known is not zero → n.** If `gh` was missing last time the issue count was *unreadable*, and "0 → 12 issues" invents a twelve-issue spike that never happened.
  - **Known → unknown is news.** A count that used to read and now does not usually means a tool stopped answering — and that explains why everything else went quiet, so it ranks *above* the movement it hides.
  - **A different repository is not a comparison.** A changed repo slug discards the baseline instead of subtracting two unrelated readings from each other.
  - **It never reports your own actions back to you.** Your branch and whether your tree is dirty are excluded on purpose. A delta that tells you that you edited a file trains you to ignore deltas.

  Direction is kept, and which direction is *good* belongs to the field rather than the number: more CI workflows is better, more stale issues is worse, a version changing is neither. Ranking is by consequence, not magnitude — a red pipeline outranks forty new issues. Lists compare as sets, because `gh` promises no ordering and a reorder is nothing anybody did.

  The baseline lives in **`workspaceState`, never in `project_memory/`**. The SSOT is git-tracked, so a baseline there would mean "when did *anybody* last look", would appear as an uncommitted change every time the dashboard opened, and would conflict between two people looking on the same day. **Mark as seen** clears a delta you have read.
## [0.203.0] - 2026-07-30

### Added
- **You can turn the workflow on from the dashboard, and see what is stopping you.** The four gates were a read-out with one link to a settings page; they are now controls, and the card opens by saying exactly what would have to change to reach `propose` — the rung where AtlasMind starts changing things other people can see. "Not permitted" tells you that you are blocked; a numbered list of switches tells you what to do about it.

  **Turning a gate off is immediate. Turning one on asks first**, naming what it permits. A dialog in front of somebody reaching for the brake teaches them to dismiss dialogs, so restricting never asks; allowing always does. The ceiling gets a picker rather than a switch, because it is a level.

  Everything is written to the **workspace** scope — whether this project may write to its own tracker is a per-project decision, and writing to your user settings would silently change every other repository.

- **A gate another scope is holding closed shows that instead of a switch.** Writing `true` to the workspace while your user settings say `false` would flip a control and change no behaviour — the same silent no-op as a dead button, arriving through the settings system rather than the command allowlist. The row names the scope and writes nothing.

### Fixed
- **A test that had been passing by distance rather than structure.** `pullRequestWrites` extracted its handler by scanning 900 lines to a comment, so it swept up every method added in between — and finally failed on an unrelated one for containing a string the handler is asserted not to contain. It now bounds by the next method, the same fix applied to the Project State link test.
## [0.202.0] - 2026-07-29

### Changed
- **The sidebar is reordered, and every titlebar reconsidered.** The order now reads top to bottom as a sentence: where you work (Chat), what needs you (Project State, Project Director), what has happened (Runs, Sessions), what the project knows (Memory), what does the work (Agents, Skills), what it runs on (Models), what it can reach (MCP Servers, Resource Discovery).

  **Project Director moved from last to third.** It carries an overdue-follow-up badge and sat below three configuration views — a badge nobody scrolls to is a badge that does nothing.

- **Each view's titlebar now carries actions about that view.** It did not: Sessions had **ten** navigation actions, seven of them about something other than sessions (Cost Dashboard, Model Providers, Personality Profile, Import Project), and VS Code collapses anything past five into a `…` menu — so the list was both irrelevant and hidden. Memory carried the Cost Dashboard.

  The global routes stay on Chat, which is the first view and acts as the app's home. Everywhere else gets its own two or three, plus one route to the surface that manages it in depth and its own settings page. A test now caps every view at five slots.

  Worth being clear that this reverses a deliberate decision — a test asserted that Sessions and Memory should carry the *same* quick actions as Chat. The duplication was intended; it just did not survive contact with a titlebar that only fits five.

### Added
- **Project State has a titlebar at all.** It had none: no route to the detail behind the glance, and no way to update it. It now opens the Project Dashboard, refreshes on demand, and opens the safety settings. The refresh already existed as a closure that only unrelated tree events reached — a glance surface whose only way to update is something else firing is one people learn not to trust.

- **Agents can add an agent.** Skills had "add skill" and Agents had nothing — an asymmetry with nothing behind it.

### Fixed
- **Four links in the Project State tree.** Two rows had no link at all (`Every step done`, and the tech-debt count). The automation row opened the Settings panel, which does not render `atlasmind.workflow.*` — the same wrong destination as the Workflow page's button before v0.199.0; it now filters VS Code's settings to those four gates.

  And the CI-failure row — the most actionable row in the tree — pointed at the **Workflow** page after the classified failure and its evidence moved to **Pipeline** in v0.188.0. A link to where the content used to be, which is worse than a missing one because it looks like it worked. A test now checks every page target against the panel's real page list.

- **A setting that hid the wrong action.** `atlasmind.showImportProjectAction` is documented as "Show the Import Existing Project toolbar action in the AtlasMind Memory view" — and it was also gating *Update memory* on that view, so turning the import off hid both. Chat's copy of the same action never carried the guard, which is what gave it away.
## [0.201.1] - 2026-07-29

### Fixed
- **A flaky test that finally failed CI.** Temporary-directory cleanup in nine test files threw `EBUSY`, `EPERM` or `ENOTEMPTY` on Windows — an antivirus scanner, the search indexer, or the filesystem's own delayed handle release still holding something after the test had already passed every assertion. `retryDelay` helped and did not eliminate it: the failure that forced this was `ENOTEMPTY` on a CI runner, after five retries.

  Cleanup is now best-effort in one shared helper. A test that passes its assertions and then fails on housekeeping is reporting a **false negative**, and a false negative in CI is worse than a leaked temporary directory by a wide margin — once a red build might mean nothing, people stop reading red builds. That is precisely the failure mode `ciFailureAnalysis` exists to keep out of this project, so it should not be arriving from the tests. The directory is under the OS temporary path, which the OS clears.

  I had seen this three times locally today and dismissed it each time as an environment quirk. It was not — it was a flake, and the right moment to fix a flake is the first time you see it.
## [0.201.0] - 2026-07-29

### Added
- **Labels and milestones, managed where they are used.** When AtlasMind drafts an issue it takes labels only from the declared taxonomy and drops anything unmatched rather than inventing it — a rule that is only as good as the set behind it. The Issues tab now shows that set: every label with its colour and how many issues carry it, every milestone with its due date and counts, and create / delete / close behind a confirmation.

  **A deletion names every issue that will lose the label.** GitHub removes a label from the repository *and* from every issue carrying it, in one step it cannot undo, and says nothing about how many. AtlasMind names them, from the issue list already on screen, so it costs no extra request. Closed issues count — a label stripped from a closed issue takes the reason it was categorised that way with it, and closed issues are what people search when they want to know what happened before. The dialog suggests renaming instead.

  Where the issue list was never loaded it **says so rather than reporting zero**. "Nothing uses this" and "we did not look" lead to opposite decisions, and only one of them is safe to act on.

- **Taxonomy drift, in both directions.** A declared label that does not exist on the repository is one every draft will silently drop — the single failure the drafting rule promises not to have. An undeclared label people are using is one the workflow will never suggest, usually a sign the declaration is stale rather than that the label is wrong. Both are reported; neither as an error.

### Changed
- **A milestone is closed, never deleted.** Deleting one detaches every issue from it silently; closing preserves the record, which is what a milestone is for. There is no delete affordance anywhere, by design.

- **A label colour is validated, not cleaned.** Six hex digits exactly, or no swatch. The value is rendered into a style attribute, so anything else is dropped rather than repaired — a "colour" reaching a stylesheet is an injection, and a nearly-valid one made plausible is worse than a missing one.
## [0.200.0] - 2026-07-29

### Added
- **Review comments are now readable, and actionable one at a time.** The line-level comments — somebody pointing at a line and saying what is wrong with it — are the actionable half of a review, and nothing read them until now. "Address the review" meant handing a model every comment at once and hoping it found the place.

  Each comment renders as a record with the file and line it points at, a button that opens exactly there, and **"Address this one"** — which starts a chat scoped to that comment alone, because a scoped question gets a scoped answer. The prompt keeps the REPORTED CONTENT fence (this is the path where an arbitrary third party's text reaches a model that can call tools) and forbids two things a model would otherwise reasonably do: address the rest of the review, and reply on the pull request.

  The file path is traversal-checked, because it arrives from a third party and becomes something you click. A path that cannot be trusted is **emptied rather than rewritten**, and the comment is still shown — the text is worth reading even when the button is withheld.

  Fetched per pull request, on request. Fetching with the list would be one call per open pull request against a rate limit, for comments on all but one that nobody asked to see.

### Fixed
- **A button that did nothing, again — caught the same day.** A new file button shipped with `data-action="open-file"` where the click handler answers to `file`, so it fell through every branch and returned silently. Identical symptom to the two Workflow buttons fixed in 0.199.0, one table down.

  A test now checks that every `data-action` in the markup has a listener that recognises it. Writing it immediately reported a working `<select>` as dead — it is handled by a `change` listener using a different comparison form — which is worth recording, because a test that cries wolf about a working feature gets the feature "fixed".
## [0.199.0] - 2026-07-29

### Added
- **Agents are now told which debt markers to use.** An agent that leaves temporary code marked `@todo`, `NOTE`, or nothing at all produces debt the register cannot see — and invisible debt is worse than no register at all, because an empty register then reads as "no debt" rather than "not detected".

  The vocabulary reaches both audiences. AtlasMind's own agents get it appended to every role prompt, read from your settings when the prompt is built — so a marker you declare this morning is in front of your next subtask, not your next window. External agents (Claude Code, Copilot, Cursor, Cline, Codex, Gemini, Windsurf, Aider) get it as a **second managed block** in the instruction files they already read, alongside the testing protocols.

  The two blocks are separate on purpose: they answer different questions, change at different times, and a file carrying one and not the other should keep what it has rather than have it rewritten by a sync about something else.

### Fixed
- **Two buttons on the Workflow page did nothing.** "Change the project shape" and "Open settings" both pointed at `atlasmind.openSettings`, which was never added to the dashboard's command allowlist — so the host received the message and dropped it.

  **Silently** is the part that mattered. From the outside a dropped command is indistinguishable from a broken feature and from one that quietly worked, so nobody could tell which, and they shipped that way. A blocked command now says so, and says it is a bug in AtlasMind rather than something you did.

  "Change the project shape" also now opens the setting it actually changes. It used to open the whole Settings panel, which does not render the archetype at all — so even allowlisted it would have shown you nothing.

- **A test now keeps the allowlist and the markup together.** The allowlist is correct policy; a hand-maintained list that drifts from the buttons is not, and drift is exactly what killed these two.
## [0.198.0] - 2026-07-29

### Added
- **Declare your own debt markers.** `atlasmind.debt.markers` takes entries like `["DEBT", "REVISIT:high", "NOTE:low"]` — the scan looks for those alongside `TODO`, `FIXME`, `HACK` and `XXX`. An unqualified marker is graded **medium**, because somebody who bothered to declare a marker is asserting that something is *wrong*, which is the same reason `FIXME` outranks `TODO`.

  Each marker becomes a **declared rule**: named on every entry it grades and published in the rule table of `tech-debt.md` beside the built-in ones. That is what keeps the register comparable rather than merely populated — a grade you can look up is a grade you can argue with.

  Two things a project cannot do. It cannot **redefine a built-in**: grading your own `TODO` as high would make two projects' registers incomparable, which is the one thing the rule table exists to prevent. And it cannot **escape the security grade** — a marker mentioning a credential is high whatever you called it, or a project could downgrade the one grade that is never negotiable by inventing its own word for it.

- **Search and filter on the Tech Debt page.** The search covers what it says, where it is, and which marker found it — the three things somebody already knows when they come looking. Filter chips appear for the markers that actually graded something, so there is never a filter that does nothing.

  A filtered view says how many it is hiding. In a register whose whole promise is that nothing is ever deleted, a shorter list must not be able to look like work disappearing.
## [0.197.0] - 2026-07-29

### Added
- **The testing playbook now says what your project shape asks for.** Which methodologies suit it, which recommended ones you have not switched on, and — the one that matters most — which *enabled* ones your shape discourages. A methodology a shape cannot produce evidence for becomes a permanent gap, and a dashboard with a gap nobody can close teaches people to ignore gaps.

  The recommendations are **read** from the archetype packs rather than restated in the scaffolder. A second copy would drift, which is the problem the shared archetype vocabulary was introduced to solve.

- **Scaffolded CI is specialised by project shape.** Two halves, deliberately different in kind. The generic Node steps stay **real commands**, because AtlasMind can see your `package.json` and what scripts it declares. The archetype steps are **commented suggestions carrying their rationale**, because it cannot: it knows a game wants a determinism gate without knowing what command *your* project would use for one. Writing a guess and running it would produce a red build on your first commit, which teaches people to delete the file.

### Fixed
- **`game` finally does something.** It has been detected since the archetype work shipped and acted on nowhere — so a game project was handed a Playwright end-to-end test for a page it does not serve, and a k6 load script for requests it does not take. It now gets a determinism test (a fixed seed must replay exactly, or a bug reported from a play session cannot be reproduced) and a frame budget rather than a request rate.

- **A function described in a comment that did not exist.** `toProjectArchetype` was documented at the top of the testing scaffolder for two versions; the scaffolder detected a project shape and then had no way to ask the packs what that shape needs.

- **Every shape chosen at bootstrap was resolving to `generic`.** The picker shows prose — "Website / Marketing Site", "Game" — and the normaliser takes ids, so the shape a user *chose* reached nothing that acts on shape. The same detected-but-never-acted-on failure the archetype work exists to fix, one step earlier in the pipeline.

- **A starter file that would not parse.** The new game recipe emitted TypeScript annotations, and the scaffolder picks the extension from the project rather than the recipe — so a JavaScript project would have received a `.js` file containing type annotations. Worse than no starter file, because it looks like the scaffolder succeeded. A test now checks every Node recipe.

- **CI triggered on `master`**, hardcoded — not the default branch of any repository created since 2020, and not this project's either. It names `main` and says what to change otherwise, because a workflow that never runs looks identical to one that always passes.
## [0.196.0] - 2026-07-29

### Added
- **Agents can ask each other questions.** `agent-handoff` is the tenth built-in workspace tool and the first that gains an agent a *capability* rather than a fact. An agent puts a question to a named specialist — a security judgement, a test-design decision — and gets that specialist's answer back, while keeping ownership of the task.

  **A handoff transfers the question, not the permissions.** The delegate runs with the intersection of the caller's skills and its own, never the union. A tool the caller does not have, the delegate does not get either, even if it normally would.

  That is the point rather than a limitation. Handing off to a specialist *feels* like it should bring you their tools — that is what makes them a specialist. But if it did, any restricted agent could obtain any capability by asking a permissive one for it, and every restriction in AtlasMind would become a suggestion. Privilege escalation by delegation is a classic precisely because the escalating step always looks reasonable in isolation. An exhaustive test walks the whole subset lattice rather than arguing the property.

  What a handoff does buy is real: the specialist's expertise — its prompt, its role, its rubric — applied within the caller's authority.

- **Bounded, and honest about it.** Delegation is capped at three deep and cannot loop back to an agent already in the chain; both refusals name the chain. A delegate that would end up with no tools at all is **refused rather than run**, because a model that cannot check anything produces confident prose, and confident prose arriving as an answer is worse than an honest refusal naming the missing capability.

  The answer returns fenced and labelled as another agent's opinion, not a verified result. It is model output feeding another model's reasoning, and it has not earned the credence a tool result gets.

  A disabled agent cannot be reached through delegation — somebody switched it off, and routing around that would make the switch decorative. The caller's budget is not inherited either, or a handoff would be an unbounded cost multiplier.

### Fixed
- **A refusal that would have looked like policy.** A planner subtask runs as an ephemeral agent that is not in the agent registry, so resolving the caller's permission ceiling by id would have returned an empty set — and refused every handoff a subtask ever made, with a message about missing capability that was actually a missing record. The caller's resolved skills are now carried rather than looked up.

- **`agent-handoff` is classified explicitly** rather than falling through to the unknown-tool default, which would have labelled it `network` — safe, but it would have told you your assistant was about to reach the internet, which it is not. The approval summary says what is actually being approved: spend, not action. The delegate's own tool use is gated separately, and saying yes here does not pre-approve it.
## [0.195.0] - 2026-07-29

### Added
- **Every debt entry can be handed to an agent** — "Look at it with Atlas" opens a scoped chat with the entry, its evidence, and the rule that graded it. The `refactorer` agent has existed since v0.184.0 and until now had nothing to reason over.

  The prompt's framing matters more than the wiring. A debt entry is **not** untrusted third-party text — AtlasMind wrote it, from your own repository, through a sanitizer — so the risk it guards against is the opposite of an issue body's. It is not that the text is hostile; it is that an agent reads a recorded shortcut as a mandate. Plenty of debt is worth keeping, and an assistant that treated every entry as a work order would spend a morning reversing three deliberate trade-offs.

  So "worth keeping, with the reason it was the right call" is a first-class answer alongside "worth fixing", the button says *look at it* rather than *fix it*, and the prompt ends: propose, do not apply.
## [0.194.0] - 2026-07-29

### Added
- **The register now finds what nobody wrote down.** A marker scan finds deferred work somebody recorded. This finds what the project is doing that nobody recorded at all: a dependency update sitting unmerged past two weeks, a testing methodology you declared and have no evidence runs, a document past its review baseline, an absent pipeline. Those four rot quietly, and none of them leaves a `TODO`.

  Every input is already on the dashboard for another page, so it costs nothing, and each entry is graded by the **same rule table** as a scanned one — a register holding two incompatible scales would be worse than one holding half the entries. A dependency bot is recognised by author, label or branch prefix and **never by title**: bots rename their own templates between versions, and a title match would silently stop working on an upgrade nobody connected to the change.

### Fixed
- **Four more workflow steps that could not change state.** `ciStatus` was hardcoded to `'none'`, so a project with a green build was told it had no check runs — a confident false statement rather than a missing one, which is worse. `openDependencyPrCount`, `staleDocumentCount` and `requiredApprovers` were read by steps and never assigned at all, so stage 4's review policy and stage 7's sweep could not respond to anything the repository did.

- **Three fields declared and read by nothing**, removed. A field on that interface that no step consumes is one somebody meant to wire up and did not, and it reads as deliberate to the next person.

- **The `CODEOWNERS` advice no longer tells you to add a file you already have.** The flag existed; the step ignored it.

### Changed
- **A test now enforces the whole bug class.** Four versions running, a field the guide reads turned out never to have been supplied — each time the symptom was that the guide asks you to do something and then refuses to notice you did. `observedStateCoverage.test.ts` checks the real source for three properties the type system cannot express: every field a step reads is assigned; no field describing your repository is assigned a bare literal; and no field is declared that no step reads.

- **No scheduled sweep.** The maintenance sweep runs on request, deliberately. A sweep on a timer would write to a tracked file while nobody was looking, and changes to `project_memory/` are supposed to arrive as reviewable diffs.
## [0.193.0] - 2026-07-29

### Added
- **A tech-debt register, and a page for it.** Taking on debt is often the right call — the metaphor is exact, and borrowing to ship sooner is legitimate. The danger is the interest you pay by forgetting it exists. A solo developer has no colleague who remembers the shortcut, and a studio has no shared memory of it either.

  **Severity comes from a declared rule, never a judgement call.** A grade somebody assigned last Tuesday cannot be compared with one assigned today, and comparability is the only reason the register is worth keeping. Every entry names the rule that graded it, and the whole rule table is published in the mirror beside the entries — so the grade can be argued with rather than taken on trust.

  **Severity does not drift with age.** The obvious feature is to escalate an item the longer it sits, and it fails the same test: an entry whose grade changed while nothing about the code changed could not be compared with last month's. Age is shown separately, with its own distribution.

  **Entries transition; nothing is ever deleted.** `resolved` means somebody did the work. `obsolete` means the evidence disappeared and nobody said they fixed it. Those are different facts and only one is an accomplishment, so the register keeps them apart rather than reporting progress it cannot attest to. There is no delete affordance anywhere on the page, by design.

### Fixed
- **Another workflow step nobody could complete.** `hasDebtRegister` was hardcoded `false`, exactly as `workflowConfigPresent` had been, so stage 7's "record what you deferred" was permanently outstanding for every user on every project. It now reads the register.

### Changed
- **The scanner's rule, rewritten after it failed on its own repository.** The first version flagged 29 items here and every one was false: its own rule table, its own tests, and the dashboard copy describing the feature. A register full of false positives is one people stop reading, which costs more than the entries it would have caught.

  A marker now only counts when it **opens a comment**. A `TODO` inside a string literal, a template or a regex is *data*; a `FIXME` being discussed in prose is *documentation*. Only a marker written at the start of a comment is a deferred decision. Deciding that needs a small quote-tracking scanner rather than a pattern, because "is this delimiter inside a string" is not a question a regular expression can answer. After the fix this repository reports zero markers, independently confirmed.
## [0.192.0] - 2026-07-29

### Added
- **The workflow now records what it did.** Branch names are derived, pull-request titles are classified by rule, CI failures are matched against an ordered table, release notes are copied verbatim. Every one of those is a determinism claim, and a determinism claim is either verifiable or it is marketing. `project_memory/operations/workflow-history.json` is what makes them verifiable: two runs with the same inputs must produce the same outputs, and where they did not, **both runs are named** — a count tells you that you have a problem, the ids tell you where.

  **Inputs and outputs are recorded as fingerprints, never as values.** This ledger is committed, so storing what was processed would put issue bodies, review comments and CI logs into your repository. A fingerprint proves the same input produced the same output without publishing either, and the record type has no field that could hold a payload.

  **The record is written before the action, not after.** That is the wrong way round from the obvious one, deliberately: a record written afterwards is missing exactly when it matters most, because the run that crashed is the run somebody needs to read about. **An action whose record cannot be written does not happen** — an action that quietly skipped its record because a disk was full would be the one nobody could account for later.

  A refused action is recorded too. “We were not allowed to” is a fact worth keeping, and it is the one somebody asks about when a switch turns out to be off.

### Fixed
- **A safety switch that did nothing.** `atlasmind.workflow.allowIssueWrites` has shipped as a documented setting since v0.181.0, and **nothing consulted it** — the capability was handled in the ladder and no call site ever passed it. Somebody could turn it off believing it stopped AtlasMind writing to their issue tracker, and it did not. A false assurance is worse than no switch at all.

  Issue writes now take the same ladder gate pull-request writes have had since v0.183.0. **This is a behaviour change:** creating, commenting on, closing or reopening an issue from the dashboard now needs `atlasmind.workflow.enabled` and `atlasmind.workflow.allowIssueWrites` on, exactly as pull-request writes already do. The refusal names which switch is holding it, so nobody has to toggle four settings at random.
## [0.191.0] - 2026-07-29

### Added
- **The rest of the workflow schema.** v0.190.0 implemented most of the specification's schema and not all of it. Four things were described there and absent from the code, including `command` — whose rule the module header *cited* while the field itself did not exist.

  **`command: ''` is the blocker, not an oversight.** A stage that needs a user-authored command ships with an empty one, and that emptiness holds the gate shut until a person supplies a real one. `undefined` and `''` never collapse: absent means the stage needs no command, empty means it needs one and has none, and conflating them either turns a deliberate blocker into an oversight or — the direction that matters — opens a gate. The generated mirror shows all three states distinctly, so somebody reading the diff can tell which one they are looking at.

  **Labels are categorised** — type, priority, status, area — because a drafter picking labels needs one type and one priority, and a flat list makes "drawn only from the declared taxonomy" satisfiable by three conflicting priorities. Observed repository labels seed `type` only: sorting somebody else's labels into priority and area would be guessing at what they mean. Priority and status seed empty, because plenty of projects run without either and inventing a scheme teaches a vocabulary nobody picked.

  **`testing: { inherit: true }`** is single-valued on purpose. It exists to say that testing requirements live in `testing-config.json` and are deliberately not duplicated here — so a reader finding no testing rules knows that is the design, not an omission. Per-stage exceptions live in `testingOverrides`.

- **The file is now checked against what it names.** Kept separate from reading it, because those are different questions: one is "is this usable", the other is "does everything it refers to exist", and the second needs knowledge a file reader does not have. A stage owned by an agent this workspace does not have is **reported, never dropped** — a silently ownerless stage reads as one nobody was ever assigned rather than one whose assignee has gone.

### Changed
- **AtlasMind's own workflow file names a real command.** The release stage runs `npm run tag:release`, which makes the field something exercised rather than a schema entry nobody uses.

- **The roadmap records a second correction to C1.1.** A schema described in the specification and half-built in the implementation is the same class of problem as an item marked shipped that was never built — one layer down.
## [0.190.0] - 2026-07-29

### Added
- **Your workflow is now a file you own.** Everything else in the guided workflow reads from somewhere — the curriculum from your repository's state, the ladder from settings, the metrics from GitHub. This is the one place where a team *says* what their workflow is, and it is a committed file rather than a setting for one reason: a change to how a team works should arrive as a diff with a reviewer, not as a habit nobody wrote down.

  `project_memory/operations/workflow.json` holds the branches, the naming convention, the label taxonomy, and each stage's requested automation level with its attestations and blockers. A readable markdown mirror is generated beside it, so the pull request that changes how your team works is legible to the person reviewing it.

  Four rules carry weight rather than shape. **A stage may be disabled but never deleted** — disabling leaves the decision in the record, deleting erases the evidence it was made, and only one of those survives somebody asking "why don't we do code review?" a year later. **The file sets intent; your settings set the ceiling** — a stage can request `auto` and still do nothing, and every level change says so in the same sentence. **Profiles seed but do not govern** — changing the profile later never rewrites stages you customised. **Fields written by a newer AtlasMind survive a round trip**, so an older build saving the file cannot silently drop a colleague's settings.

- **A card on the Workflow page to declare and edit it.** The file is **never created implicitly.** Every other persisted document in AtlasMind seeds itself on first read; this one does not, because it gets committed, and writing one into your repository because you opened a tab would be putting words in your mouth in a file other people review.

  Every edit shows the exact change in a confirmation before anything is written — the person clicking the button and the person reading the diff need to be looking at the same thing. Refusals are shown too: an edit that silently did nothing would be indistinguishable from one that worked. Pointing the integration branch at a protected branch is refused with a reason, since feature work merges into it constantly and doing so would either break every merge or erode the protection.

### Fixed
- **A workflow step nobody could ever complete.** "Declare your workflow" has been in the guide since the curriculum shipped, and the flag behind it was hardcoded `false` — so the step was permanently outstanding for every user, on every project, regardless of what they did. A dashboard with a gap that cannot be closed teaches people to ignore gaps, which is the exact failure this project's own archetype packs are written to avoid.

- **The workflow guide named this repository's branches at everybody else.** `integrationBranch` and `protectedBranches` were hardcoded to `develop` and `main`, so a project using `trunk`, or `master`, or anything else, was taught a workflow referring to branches it does not have. Both now come from the workflow file where there is one.

- **AtlasMind's own workflow is now declared**, in `project_memory/operations/workflow.json`. The repository is meant to be a worked instance of the workflow it specifies, and until now the one artifact that would make that concrete did not exist. Six of the eight stages are enabled at `observe`; maintenance and the automation policy are not, because neither is built yet.

- **Two things caught by declaring it.** The seed was inventing a required CI check name (`ci`), which AtlasMind cannot know — a guessed context either blocks forever because nothing reports it, or is decorative because nothing enforces it, and both look identical to whoever inherits the file. It now seeds none. And the seed put the *integration* branch in the protected set, because `develop` is both the commonest integration branch there is and a member of the protected-name list — producing a configuration the editor would then refuse to accept. The integration branch is now excluded in one place, with a test pinning that a seed round-trips through its own editor unchanged.

### Changed
- **The roadmap record corrected.** C1.1 (the workflow configuration model) was marked shipped in v0.181.0 and had never been built. The correction is recorded in `project_memory/roadmap/guided-github-workflow.md` rather than quietly amended — a roadmap that edits its own history is worth less than one that shows where it was wrong.

- **Four stale status markers in the specification.** `docs/guided-github-workflow.md` still said AtlasMind had no pull-request code (shipped v0.182.0–v0.183.0) and that none of `ci-analyst`, `release-manager` or `refactorer` existed (all three shipped v0.184.0). A specification whose "not built yet" markers are wrong is worse than one with none, because the markers are what a reader trusts.
## [0.189.0] - 2026-07-29

### Added
- **A Release page, and the four delivery keys.** Stage 6 was the best-served stage in the specification and the least reachable: `classifyBumpLevel`, `bumpVersion`, `insertChangelogEntry` and `compareSemver` have been pure, exported and tested for a long time, with nothing putting them in order. There is now a path.

  Seven gates run root-cause-first — changelog entry → notes have content → no secrets in the notes → version moved on → tag is free → working tree clean → CI passing — because being told CI is red is unhelpful when the actual problem is that no changelog entry exists. **A gate reporting "unknown" is not a pass:** a repository whose tags could not be listed genuinely does not know whether its tag is free, and shipping on an unknown is the habit this stage exists to break.

  The release notes are shown exactly as they would be published — the changelog section for the version, byte for byte. Never summarised, never model-generated: a generated release note is a claim nobody checked attached to a version nobody can change.

- **A secret in the release notes refuses the release rather than being redacted out of it.** This inverts the rule applied to inbound untrusted text everywhere else in AtlasMind, on purpose. Release notes are outbound and permanent, so quietly publishing an edited version of what you reviewed — with no way for you to discover the edit — is the worse of the two failures. The message names the shape found, never the value, and says to rotate the credential.

- **The four delivery keys.** Deployment frequency, lead time for change, change failure rate and time to restore, over a 90-day window. They are paired so a team cannot improve the half it likes by wrecking the other: two describe speed, two describe stability.

  Each declares its rule where the number appears. Lead time is measured **merge → release** — the half you can act on, and the half squash-merging does not destroy — and work that merged but has not shipped is *excluded* rather than counted as infinitely slow, because that it is waiting is itself the finding. A change failure is **a patch release within 48 hours**, applied literally; a minor or major follow-up is a planned release, not a remediation, and counting it would make a busy release day read as an outage. Every release the rule counted is named, so the number can be argued with rather than taken on trust.

  The bands are described as a widely cited orientation rather than a certification — the exact boundaries have moved between annual industry reports, and your own trend matters more than which side of a line you land on.

### Fixed
- **A changelog check that could not fail.** `changelogHasCurrentVersion` was derived from whether `CHANGELOG.md` *exists*, so the single most commonly missing thing at release time was reported as present on every repository that had ever written a changelog at all. Stage 6 read as complete on a changelog whose last entry was six versions old. It now reads the document's headings.

- **`commitsSinceTag` was hardcoded to zero** and rendered as a fact. It now comes from `git describe` and `git rev-list`, or reports nothing when there is no tag.

- **A duplicate, empty `## [0.187.1]` heading in this file.** The extractor written this version finds the first matching heading, which was the empty one — so the tooling in this release would have published a blank release note for that version. Caught by the thing it describes.
## [0.188.0] - 2026-07-29

### Added
- **Pull Requests and Pipeline are now pages, not cards.** Issues had a whole page while pull requests had a single card — an odd split, given stage 4 is where a change stops being private and where CI runs, review happens, and the reasoning gets recorded. The Pull Requests page lists what is in flight with review state, size, and whether an issue is linked, alongside review-latency and throughput metrics.

  The Pipeline page carries what most rewards a page of its own: the classified failure with its evidence lines, recent run outcomes, and a **?** explaining how the classification is decided — first-match-wins over the log with no model in the path, infrastructure checked before dependency failure because an unreachable registry looks exactly like a lockfile problem.

- **The dashboard tabs are regrouped.** *Where we stand* · *The work* (Workflow, Roadmap, Issues, Pull Requests, Director) · *The code* (Repo, Pipeline, Testing) · *Is it safe* · *Ship & record* · **The engine** (Runtime). Runtime moved out of "The work", where it was the only tab not about the work — it describes AtlasMind's own state, not the project's.

### Changed
- **The Workflow page stopped being a dumping ground.** It had accumulated ten cards plus the whole eight-stage curriculum. It now keeps what is genuinely about the workflow itself — the guide, health, the automation ladder, project shape, branch naming and release readiness — and the per-stage detail lives on the pages named after those stages.

## [0.187.1] - 2026-07-29

### Fixed
- **The Project State view could never appear.** Its `when` clause read a context key computed from the provider's cached sections — but that cache was only filled by `getChildren`, which VS Code calls only for a *visible* view. So the view was hidden because it had no sections, and it had no sections because being hidden meant its children were never requested. A closed loop with no way in: shipped in 0.187.0 and visible to nobody.

  The model is now rebuilt independently of rendering, so the badge and the visibility key no longer depend on the view having already drawn itself. A test pins the property directly: automation state comes from settings, which are always readable, so a real workspace always produces at least one section and the view is always reachable.

- **The view now opens expanded rather than collapsed.** The original reasoning — that expanding would steal height from the Chat view above it — was wrong: Chat is a webview many users hide, and the sidebar is otherwise a stack of collapsed rows. Every other view is a list you open when you want it; this one is a summary you glance at, and a collapsed summary shows nothing.

- **Gathering state can no longer break activation.** `registerTreeViews` computes the state eagerly so the visibility key is right on the first render, and that runs during activation — a failure there would have taken the other nine views down with it. It now degrades to a hidden view, which is what an unreadable state should produce anyway.

> **Note for existing installs:** VS Code remembers the order and visibility of sidebar views per user. A newly added view will not jump to its manifest position in a sidebar you have already rearranged — use the **⋯** menu on the AtlasMind sidebar to show it, or drag it where you want it.

## [0.187.0] - 2026-07-29

### Added
- **A Project State view in the sidebar, for the things that had nowhere to live.** The sidebar carried ten views and they were almost entirely *inventory* — lists of agents, skills, models, servers, sessions. Nothing said where you are in the workflow, and nothing said what AtlasMind is currently permitted to do on your behalf. That second gap was the sharper one: it is safety-critical, it is genuinely computed, and the only way to see it was to open the dashboard or read four settings across two scopes.

  Four collapsible sections: **what AtlasMind may do** (effective level, which gate is binding it, and each capability), **where you are** (workflow progress and the next actionable step), **waiting on you** (paused runs, overdue follow-ups, an unclassified CI failure, blocked stages), and **deferred and ageing** (stale documents, testing protocols with no evidence, roadmap gate progress).

  Scope is deliberately narrow: nothing here duplicates Source Control or a GitHub extension. No commits, branches, diffs or issue lists — only facts that exist because AtlasMind exists.

  Three rules carry over from the dashboard and matter more here, because a tree row is read in a glance rather than studied. A section whose data could not be gathered is **omitted entirely** rather than shown empty, so the view never implies AtlasMind looked at something it did not. The **badge counts only rows that need a person** — one that counted everything would be permanently non-zero and therefore ignored, which is worse than no badge. And unbuilt capability is **absent rather than zero**: the tech-debt register does not exist yet, so its row is omitted instead of reading "0 items".

  A classified CI failure deliberately does *not* raise the badge. It already has an owner and a suggested fix; flagging it too would leave the badge permanently lit on any project with a red build.

- **Views with nothing to say now hide themselves.** Project Runs, Sessions and MCP Servers disappear when empty, driven by context keys. Only pure-inventory views are hidden — Discovery, Director, Agents, Skills and Models stay visible even when empty, because each is the *only* entry point to its feature and hiding it would make the feature undiscoverable, which is a worse problem than a quiet row.

## [0.186.0] - 2026-07-29

### Added
- **A Director can assign roles, and assigning one does something.** Five roles ship — Director, Maintainer, Contributor, Reviewer, Observer — each carrying an automation ceiling and a set of capabilities. Applying one writes the matching settings to the workspace, so they apply to everyone who opens the repository, after a confirmation that lists every key and value.

  The framing matters more here than the feature: **a role is a configuration template and a declared expectation, not a permission boundary.** AtlasMind runs inside each person's editor and cannot prevent them editing their own settings; claiming otherwise would be security theatre. What it can do is real — configure the envelope, record who is expected to do what in a committed file, and route review.

  Two deliberate limits. A role **never writes the master switch**: turning the workflow on stays each person's own decision, since that switch is described to them as the one control they need in order to be certain. And no shipped role grants `auto` — unattended action is something an individual opts into, not something handed out on assignment.

  The role split is where the useful separation lives: a Maintainer can prepare a release but not write to a protected branch, and a Contributor can open a pull request but not merge it — which is the separation a review requirement exists to create.

- **CODEOWNERS generation, which is where restriction actually bites.** Responsibilities gain optional path patterns; a responsibility with paths and an owner carrying a GitHub handle becomes a CODEOWNERS rule. This is the one part of the feature GitHub enforces rather than AtlasMind, which is exactly why it is the part worth having.

  Only AtlasMind's managed block is written — hand-written rules survive untouched, because CODEOWNERS routes review and replacing somebody's rules would reassign it for paths nobody asked about. Input order is preserved, since CODEOWNERS is last-match-wins and reordering silently changes who reviews what. An owner GitHub could not resolve is **dropped and reported** rather than written: GitHub silently ignores an unresolvable owner, so the path would end up with no required reviewer and nobody would find out until a change landed unreviewed. A `*` pattern is refused for the same class of reason — it would make its owners required reviewers on every file and override every more specific rule above it.

## [0.185.1] - 2026-07-29

### Fixed
- **A contributor could not be more cautious than their repository.** The automation ladder read settings with `configuration.get()`, which returns the value VS Code *resolves* — and VS Code resolves workspace settings above user settings. That is right for a preference and wrong for a safety ceiling: a repository committing `maxAutomationLevel: auto` raised the ceiling of everyone who opened it, and somebody who set `observe` for themselves was overridden by it. The specification promised the opposite — that a personal setting can only ever *lower* the result.

  Every gating setting is now read per **scope** rather than resolved, and the most restrictive value defined in any scope wins. Unset stays distinct from set-to-restrictive, so somebody with no preference still inherits the team's value — otherwise a team setting would never do anything.

  The same direction applies to the capability switches: `false` is the cautious value, so a team can grant a capability and an individual can still decline it.

  `workflow.profile` and `workflow.archetype` deliberately keep normal precedence, and the code says so: they are *declarations* about the project rather than permissions, so the team's answer should win over an individual's.

  Worth noting what limited the exposure: `capabilities.untrustedWorkspaces` is undeclared, so VS Code disables AtlasMind until a workspace is trusted — a hostile repository could not arm automation by shipping settings. The defect was confined to trusted repositories, which is where it mattered for teams.

## [0.185.0] - 2026-07-28

### Added
- **The workflow now specialises by what kind of project this is.** A game, a website, a library and a CLI do not share a CI pipeline, a release mechanism, a testing strategy, an expected documentation set, or the same idea of what counts as technical debt. Until now the guided workflow treated them identically, which meant it was tuned for none of them.

  An **archetype pack** declares defaults across all six axes. Packs are data in source — reviewable in a diff, testable without a workspace, and overridable per item, which a branching implementation would not allow. Games get an asset-validation step and a frame budget, because performance there is a correctness property rather than an optimisation. Libraries get a public-API-surface check and mutation testing, because a library's tests are its specification and a surviving mutant is a promise nothing enforces. APIs get contract tests. CLIs get a cross-platform matrix, because path separators and shell quoting produce bugs invisible on the author's machine.

  **Traits compose rather than multiplying the list.** A Shopify theme is a `website` that is *platform-hosted*; a VS Code extension is a `library` that is *platform-hosted* and *published*. Modelling those as their own archetypes would grow the set every time a platform appears — and every archetype is a promise that something specialises for it.

- **Detection suggests; declaration decides.** AtlasMind infers a shape from your manifests, but the declared value always wins, and the Workflow page shows both when they disagree — a project deliberately declared one thing while its dependencies look like another is a *decision*, not a mistake. Leaving it undeclared is honest rather than broken: the page says so instead of pretending to know. **A wrong archetype is worse than none**, because it asks for evidence the project will never produce and creates a permanent gap, which teaches people to ignore gaps.

- **Games are declarable at last.** `Game` is now an option at bootstrap, alongside two new settings — `atlasmind.workflow.archetype` and `atlasmind.workflow.traits` — so the shape can be changed after bootstrap rather than being fixed at intake.

### Fixed
- **Three disagreeing answers to "what kind of project is this?" became one.** A twelve-option bootstrap picker whose value fed a single regex, `testingScaffolder`'s seven-value `Archetype`, and `deliveryManager`'s four-value `DeliveryArchetype` — none connected. Games were the clearest casualty: detected from `phaser`, `bevy` and `pygame`, but `archetype === 'game'` appeared **zero** times in any output branch, so the detection changed nothing; the bootstrap picker had no Game option at all; and delivery treated it as `generic`. That is the same failure this workflow specification was written to fix, appearing in a different dimension.

  `DeliveryArchetype` is now deprecated with a forward mapping, so existing callers keep working. It was never persisted — `delivery.json` holds no archetype — so no schema migration was required.

## [0.184.0] - 2026-07-28

### Added
- **A red build now explains itself.** AtlasMind has always read check *states*; it has never read a *log*. That is the difference between knowing a build failed and knowing why. It now fetches recent runs and the failed log, and classifies the cause with an **ordered rule table over the log text — no model in the path**: `dependency-install → compile → lint → test-failure → timeout → flake-suspect → infra → unknown`, first match wins.

  The rule-table decision is the whole design, not an implementation detail. A taxonomy that varies run to run cannot be charted, and a chart of CI failures over time is one of the most useful things a team can look at. An agent's job here is to *explain* a classification and propose a fix — never to choose it. The order matters too: a run that could not install its dependencies also fails to compile, and reporting the compile error would send you to fix code that never had a chance to build. Infrastructure is checked first, because an unreachable registry looks exactly like a dependency failure and telling somebody to fix their lockfile when npm was down wastes an afternoon.

  **`unknown` is a real answer.** When nothing matches, AtlasMind says so and escalates rather than guessing — a confidently wrong root cause costs more than an honest admission. Flakiness is decided from *history*, not from one log: a job that both passed and failed on the same commit is flaky whatever its latest log says.

  CI logs are untrusted input — they echo branch names, commit messages, and whatever else ended up in a build. Each is ANSI-stripped, secret-redacted, size-capped and tail-preserved (a failure message is at the *end* of a log), with truncation and redaction both **reported** rather than silent. The excerpt reaching an agent is fenced as REPORTED CONTENT.

- **Three new agents own the workflow's later stages.** `ci-analyst` explains a classified failure and is told not to re-classify it, not to re-run a job, and not to edit a pipeline definition. `release-manager` checks the derived version matches the compatibility impact and that release notes stay the changelog verbatim; it never pushes, tags, or publishes. `refactorer` records deferred work with a file and line as evidence and proposes rather than applies.

  All three ship **without routing needs and without pinned skills**, addressed by stage ownership rather than by the classifier, so they cannot displace `github-operator` or `devops-engineer` for work those agents already own. A test asserts that — including that their prose avoids the reserved routing vocabulary, which is the one way an agent with no declared needs can re-enter the contest by the back door.

### Fixed
- **The double-publish chain is gone (C5.2).** `publish:release` was `vsce publish && npm run tag:release`. It published *and* pushed the tag, and the tag push triggered `publish.yml`, which ran `publish:release` again — the second attempt failing on "version already exists". One release, two publish paths racing. `publish:release` now publishes and nothing else; `tag:release` tags. For an emergency local publish, run both in that order. 0.181.0 documented the hazard as an interim; this removes it.

- **A pip dependency failure could never have been detected.** The rule required the literal word `pip` before the message, and pip's own output does not contain it — so `Could not find a version that satisfies the requirement` would have fallen through to `unknown`. Caught by a fixture written from real output rather than from memory.

## [0.183.0] - 2026-07-28

### Added
- **The automation ladder is now real.** 0.181.0 shipped six `atlasmind.workflow.*` settings and displayed their state; nothing evaluated them. `workflowAutomation.ts` is the precedence rule the specification promised — `effective = min(master, ceiling, capability, stage)` — with every gate defaulting closed. That is what makes *"full automation is possible, never default"* true by construction rather than by policy: a project's workflow file may request `auto`, and if any one of the four disagrees, `auto` does not happen. Personal settings can only ever **lower** the result, so a repository cannot force unattended action onto somebody's machine and a developer cannot grant themselves more than the repository allows.

  Two decisions inside it are worth knowing. A disabled capability switch caps at `draft` rather than zeroing the stage — turning off "may write pull requests" should stop the writing, not stop AtlasMind explaining and preparing. And every refusal **names the gate that caused it**, because "you cannot do that" with no reason sends somebody to toggle four settings at random. An unrecognised level reads as `off`: a settings file with a typo must never be read as consent.

- **Pull requests can be opened, reviewed, merged and closed from the dashboard** — the first thing AtlasMind does that changes something outside the editor and is visible to other people. Every write passes three gates in order: the automation ladder must reach `propose`; a protected base is a **veto** rather than a level anyone can raise; and a modal confirmation names the repository and the exact action, built from the same values that will be sent. The webview supplies data only — refs are validated as git refs and refused outright rather than sanitised, since a "cleaned" ref can still be a valid ref pointing somewhere else.

- **Pull-request drafts are synthesised, never generated.** `buildPullRequestDraft` derives a title from the conventional-commit classification of the commit range — **reusing `classifyBumpLevel`** rather than adding a second parser of the same format, because two parsers eventually disagree and the disagreement surfaces as a release whose version does not match its own pull-request title. The body fills the repository's own template: recognised headings get content, everything else is preserved verbatim including headings AtlasMind has never seen, because a team's checklist is theirs. Same range plus same template produces a byte-identical draft, with no model in the path. Labels come only from the declared taxonomy, and an unmatched one is dropped **and reported** rather than invented.

### Fixed
- **A breaking change declared in a commit body was being read as a patch.** The draft title split every commit to its first line before classifying it — but conventional commits declare a breaking change with a `BREAKING CHANGE:` footer in the *body*, so the marker never reached the classifier. Full messages are now classified and only first lines are used for display.

## [0.182.0] - 2026-07-28

### Added
- **Pull requests are now read, measured, and safe to hand to an agent.** `pullRequestTracker.ts` parses `gh pr list` with exactly the discipline `issueTracker` uses — control-stripped, clamped, count-capped, non-`https` links dropped, never throws — and `buildPrReviewPrompt` fences review text as REPORTED CONTENT. That fence is the point: a pull-request body and a review comment are text written by whoever can comment, and "address this review feedback" is precisely the workflow that hands that text to a model holding tools. Nothing sanitized it before because nothing read it; adding the reading is what created the obligation.

  The Workflow page gains a pull-request band: open and awaiting-review counts, median time to first review, median time to merge, a size distribution, and merge throughput over time. As everywhere on that page, **"not loaded" renders as its own state rather than as a row of zeroes** — a list nobody fetched is not an empty list.

- **Branch names derive from the issue they serve.** `deriveBranchName` turns issue #142 into `feat/142-guided-github-workflow`: pure, ASCII-slugged, truncated at a word boundary, and length-capped across the whole name rather than just the slug. Collisions resolve with an ordinal suffix (`-2`, `-3`) rather than a hash or timestamp, so running the same command twice gives you a name you could have predicted. It cannot produce a protected branch name — the `<type>/` prefix makes that structurally unreachable — and it **refuses with a reason** rather than inventing one when a title reduces to nothing, because an unreadable branch name is worse than a question.

### Fixed
- **A shell-injection hole in GitHub repository creation.** `gh repo create` was assembled as a shell string with the GitHub **owner** interpolated into it, and unlike the repository name, the owner input box had no validation. An owner containing a shell metacharacter would have run as a second command. Self-inflicted rather than remote — you would have to type it into your own prompt — but exactly the class of bug argv arrays exist to prevent. Repository creation now passes an argv array through `ghClient`.

- **`gh` now has exactly one exec boundary.** `ghClient` shipped in 0.181.0 but nothing imported it, so "the shared runner" was a runner nothing shared. All call sites now route through it, both shell-based invocations are gone, and `tests/core/ghExecBoundary.test.ts` reads the real source so a new one cannot quietly reappear. The dashboard also stopped re-deriving its own failure diagnosis from message text — two independent classifications of one failure is how somebody gets told to re-authenticate when they are merely rate-limited.

- **`probe()` claimed the GitHub CLI was installed when it had no idea.** It read *any* failure other than "not found" as evidence of presence, so an unclassifiable error — a timeout, an unexpected exception — reported `installed: true`. That would have a caller skip offering to install the very thing that is missing. It now requires positive evidence the binary actually ran: success, or a failure only a running `gh` can produce (signed out, rate-limited, forbidden, not found).

- **Issue and pull-request bodies were being flattened to a single line.** `cleanMultiline` in `issueTracker` promised "newlines survive so a body stays readable", but `\n` is U+000A and sat inside the control-character class it strips — so every body lost its structure and the blank-run collapse beneath it was dead code. This shipped in `issueTracker` from the start and was faithfully reproduced in the new pull-request tracker before being caught. Both now exclude `\n` specifically, with a regression test naming the trap.

## [0.181.0] - 2026-07-28

### Added
- **AtlasMind now has one guided GitHub workflow, and the dashboard teaches it.** Project Dashboard → **Workflow** lays out eight stages — issue intake, branch naming, development, pull requests, CI, release, maintenance, and the automation layer above them — showing where this repository actually stands in each. Every stage and every step carries a **?** that opens *why this exists*, *how to do it*, and *what people usually get wrong*, written for somebody meeting a professional workflow for the first time rather than for somebody confirming one they already know. There is a glossary for the terms that get assumed: integration branch, protected branch, conventional commits, SemVer, flake, lead time, technical debt.

  The page also charts delivery health — issue ageing and assignment, branch inventory and naming conformance, CI check state, commit-convention conformance, changelog drift, and a weighted health score. It costs nothing to open: everything is derived from state the dashboard already gathers, with no network call on the render path, because `gh` is rate-limited and a page that spent your quota to explain itself would be a poor trade.

  Two honesty rules run through all of it. **A component that could not be measured is omitted from the score and named**, never counted as zero — otherwise a project that has not connected GitHub looks catastrophic, which is false and discouraging at the worst moment. And **no report means no verdict, never "0 failing"** — a test suite that did not run is not one that passed, and conflating them is how a green dashboard hides a broken pipeline.

- **The workflow is specified, not just implemented.** [`docs/guided-github-workflow.md`](docs/guided-github-workflow.md) is the normative document: eight stage contracts with declared triggers, inputs, owning agents, GitHub surfaces, deterministic outputs, gates and automation levels; two profiles (solo and small studio) as presets over one schema rather than two prose documents; the workflow-as-editable-data model; the automation ladder; and a worked end-to-end example. It is explicit about where determinism ends — plan decomposition is produced by a language model and is not reproducible, and the specification says so rather than implying a guarantee it cannot keep.

- **`atlasmind.workflow.*` settings, all deny-by-default.** A master switch, a personal automation ceiling, and four capability gates (issue writes, pull-request writes, release writes, protected-ref writes). The effective level for any stage is the *minimum* of four independent gates, all defaulting closed — which is what makes "full automation is possible, never default" true by construction rather than by policy. Your personal settings can only ever lower the level, never raise it. Some things never automate at any level: force-pushing, deleting a tag or release, re-running a CI job, editing a CI workflow file, and merging a dependency update.

- **Three new core modules, pure and unit-tested.** `workflowCurriculum.ts` holds the teaching content as reviewable data — derived from observed state, never model-generated, because a hallucinated workflow step is worse than no step at all. `workflowMetrics.ts` derives every number, with `MetricVerdict` making "not measured" a *type* rather than a convention so a renderer cannot forget to handle it. `ghClient.ts` is now the single boundary to the GitHub CLI, replacing three ad-hoc call sites — argv arrays with no shell, no stored credential, and failures that name their fix.

### Fixed
- **Nine contradictions in AtlasMind's own documented workflow.** Nine documents described this project's GitHub process and disagreed with each other. Now one specification states the rules and every other file points at it, naming values only.

  Among them: pull requests were documented as targeting both `main` and `develop`; reviews were documented as both required and not required (they described different *profiles* — this repository is `solo`, so zero approvals with genuinely required CI); the release was documented as both Actions-driven and manual; a `Release — tag merged main version` workflow was cited that does not exist; `.github/workflows/integration-monitor.yml` was cited but only the script exists, run on demand via `npm run monitor:integrations`; and CI was documented as running on `main` when it runs on `main` and `develop` plus manual dispatch.

- **A live double-publish hazard in the documented release routine.** `npm run publish:release` is `vsce publish && npm run tag:release` — it publishes *and* pushes the tag, and the tag push then triggers `publish.yml`, which runs `publish:release` **again** and fails on "version already exists". Following the documented step 7 caused it every time. The routine now ends at `npm run tag:release` and lets CI publish; `publish:release` is documented as an emergency local path only. Fixing the chain in code so only one path can publish is tracked as C5.2 in the roadmap.

- **Six files claimed `project_memory/` is excluded from `main` and "enforced by `.gitignore`".** Both halves were false: 90 of its files are tracked on `origin/main`, and `.gitignore` says *"track curated SSOT"*, excluding only `sessions/`, `temp/`, `project-run-*.json`, and `.delivery-lock.json`. What keeps it out of the shipped extension is `.vscodeignore`.

- **`project_memory/routines/publishing-routine.md` could not run as written.** Its package step was `atlasmind-${VERSION}.vsix`, which is not a command, and it used `${BRANCH}` and `${VERSION}` tokens that are never substituted — only `${message}` and `${version}` are — so they ran literally.

- **Two live wiki links pointed at a page that never existed.** `wiki/Project-Planner.md` and `wiki/Tool-Execution.md` both linked `[[Delivery]]`; the page now exists and documents the guarded promotion pipeline, its five gates, and its safety boundaries.

## [0.180.2] - 2026-07-28

### Changed
- **Project memory refreshed from the repository.** An AtlasMind import run regenerated the SSOT mirrors: the architecture set (`codebase-map`, `project-overview`, `project-structure`, `dependencies`, `model-routing`, `runtime-and-surfaces`), the operations set (`configuration-reference`, `development-workflow`, `security-and-safety`), `domain/conventions`, `domain/product-capabilities`, `decisions/development-guardrails`, and the import index. `roadmap/release-history.md` catches up from v0.134.0 to the v0.171.x releases — it remains behind the current version, since it reflects the state at the time of the import run rather than now.
- **Three oversight agent definitions added** under `project_memory/agents/`: `ethics-oversight`, `legal-oversight`, and `commercial-oversight` — the read-only advisors behind the Project Dashboard Risk tab.
- **`.vscode/settings.json`: `atlasmind.budgetMode` changed from `cheap` to `auto`.** Noted separately because that file is tracked: this is the default anyone cloning the repository gets, not a local preference.

## [0.180.1] - 2026-07-28

### Fixed
- **Two independent notions of "am I root", caught by CI on Ubuntu and macOS.** 0.180.0 gave the planner its own `isRoot` input while `buildRuntimeInstallInvocation` went on consulting `process.getuid()` internally. On Windows `getuid` is undefined, so the two agreed by accident and the split was invisible — Windows CI passed while both Unix runners failed. Worse than the test failure: a plan could have declared a step runnable while the argv it produced was a `sudo -n` command that fails without a terminal.

  There is now one source of that fact, read once at the single call site, and the decision moved into an exported pure function (`requiresUnobtainableElevation`) so both branches are testable on any platform. It also corrects a case 0.180.0 got wrong: `sudo -n` cannot prompt **even when running as root**, so an argv containing sudo is now always treated as unobtainable rather than only when non-root.

### Changed
- The elevation integration test asserts a consistency property rather than a fixed verdict. A root container genuinely *can* run a system install, so demanding "manual" everywhere would have asserted wrong behaviour for it; the semantics are covered exhaustively against the pure helper instead.

## [0.180.0] - 2026-07-28

### Fixed
- **On Linux, "Install it for me" would have failed for almost everyone.** `buildRuntimeInstallInvocation` elevates with `sudo -n` — non-interactive, meaning *fail rather than prompt*. That is the only correct choice from an extension host, which has no terminal to prompt in, but the consequence is that the step succeeds only for root or passwordless sudo and fails instantly for every other user. Where sudo is absent entirely it falls back to running `apt-get install` unprivileged, which fails with "are you root?".

  A step needing rights AtlasMind cannot obtain is now **marked and not offered**: the plan reports `manual` with both commands to run in a terminal, and the reason says plainly that AtlasMind has nowhere to ask for a password. A button that predictably fails for most of a platform's users is worse than no button — it teaches them the feature is broken rather than what to type.

  `brew` is deliberately exempt on both macOS and Linux (it installs into a user-owned prefix and refuses to run under sudo), as is `winget` — Windows elevates through a UAC consent dialog, which is a prompt the user can actually answer.

### Notes on platform coverage
- Windows: verified end to end on a real machine (resolution *and* spawn).
- macOS: Homebrew's `/opt/homebrew/bin` and `/usr/local/bin` are already in `findCommandExecutable`'s search path, so `brew` resolves even when VS Code is launched from Finder without a login shell's `PATH`. Not run end to end.
- Linux: root and passwordless-sudo plan and run; everything else now correctly declines rather than failing. Not run end to end.

## [0.179.2] - 2026-07-28

### Fixed
- **`spawn C:\Program Files\nodejs\npm ENOENT` — the same install failure, one layer deeper.** 0.179.1 resolved the command to a path, which was necessary but not sufficient. Node ships *three* files called npm — `npm` (a Unix shell script), `npm.cmd`, and `npm.ps1` — and `findCommandExecutable` tries the empty suffix before `PATHEXT`, so it returns the **extensionless shell script**, which Windows cannot execute at all. The previous fix tested for `.cmd`/`.bat` and so never matched it.

  The check is now framed the other way round: on Windows, only a real executable image (`.exe`/`.com`) is spawned directly, and *anything else* is treated as a shim to be bypassed via the script it wraps. Enumerating what is spawnable rather than what is not means a shim of an unanticipated shape falls through to the bypass instead of being spawned hopefully.

  **Verified on a real machine this time**, not reasoned about: the exact argv the planner produces (`node.exe node_modules\npm\bin\npm-cli.js install -g …`) was executed and npm answered. Two tests pin it — the extensionless shim resolving through `node.exe`, and `cargo.EXE` still being spawned directly rather than routed through Node.

## [0.179.1] - 2026-07-28

### Fixed
- **`spawn npm ENOENT` — "Install it for me" failed on Windows, which is where it was needed most.** Two stacked causes. The step carried the bare string `npm`, and `execFile` does not apply `PATHEXT`, so it looked for a file literally named `npm` and missed `npm.cmd`. Resolving the path alone would not have been enough either: since the fix for CVE-2024-27980 Node refuses to spawn `.cmd`/`.bat` without `shell: true`, and a shell is not on the table here. npm's shim wraps `node_modules/npm/bin/npm-cli.js` beside the `node.exe` that runs it, so that script is now invoked with Node directly — the same work, still a plain process spawn. Verified against a real `npm.cmd` on Windows. Where that layout is not found the plan degrades to `manual` rather than guessing at an interpreter.
- **A step whose tool the previous step installs is now resolved at run time, not at planning time.** npm does not exist while the plan is being made, so there was no path to resolve; a freshly installed runtime that is not yet on this window's PATH now produces "reload the window and try again" instead of a spawn error.

### Changed
- **`humanCommand` is derived from the argv rather than written alongside it** (review feedback, PR #147). It is the consent list, and the hand-written version had already drifted in the dangerous direction: it read `winget install --id OpenJS.NodeJS.LTS -e` while the argv also carried `--accept-package-agreements --accept-source-agreements`, so the one detail a user might have objected to was the detail the summary dropped. It also printed `sudo` unconditionally on Linux even where the invocation did not use it. `formatCommandLine` removes the possibility, and tests assert every argument appears and that `sudo` is shown exactly when used.
- The install progress notification's doc comment claimed it was cancellable while `withProgress` was configured `cancellable: false` (review feedback, PR #147). The behaviour is correct and the comment was wrong: a cancel button could only abandon the notification, not the package-manager transaction, and killing one mid-write is how a half-installed runtime happens.

## [0.179.0] - 2026-07-28

### Fixed
- **Setup guides did not run at all from the AtlasMind chat panel, and failed silently.** Slash commands are dispatched only by the VS Code chat participant; the panel has no such handling, so `/acp` was sent to the orchestrator as an ordinary prompt. On a machine with no provider configured, routing falls through to the built-in echo model, which answered *"Answered from context."* — so the guide appeared to run and produced nothing. v0.177.0 made this worse by auto-submitting, turning a prompt left in the composer into a confident non-answer.

  Setup plans are **derived from observed configuration, never model-generated**, so no model was ever needed to produce one. `atlasmind.openSetupGuide` now renders the plan itself and posts it as an assistant message. The guide therefore works on a fresh install with **nothing configured at all** — the state in which it is the only thing that can help.

### Added
- **`src/providers/acpInstaller.ts` — AtlasMind can install the ACP adapter for you, after showing exactly what it will run.** "Install it with `npm install -g …`" is not advice if you have no npm, which someone arriving via "use the Claude subscription I already pay for" has no reason to have. The planner detects the missing runtime *and* the missing adapter and plans the whole chain; the modal lists every command with its purpose before anything runs, and **Install it for me** executes them in order with visible progress.
- **`renderSetupGuideMarkdown`** — the whole guide at once, every step with its state, for surfaces that cannot run a step-at-a-time walkthrough.

### Security
- **Every install command is a constant in AtlasMind's source.** Nothing is parsed from a documentation page, generated by a model, or assembled from a settings string — a command derived from fetched text and then executed is remote code execution with extra steps, and `buzzDocsSource.ts` already holds that line for fetched commands.
- **No shell, ever.** Steps run as `execFile(command, args)`, never a script and never through `sh -c`, so there is nothing to escape. A test asserts no planned step names a shell or downloader, and that no argument carries shell metacharacters.
- **Rust's `curl … | sh` installer is deliberately absent.** Where a distribution packages cargo, that package is used; where none does, the plan reports `manual` and shows rustup's own instructions to follow by hand. Piping a download into a shell on the user's behalf is worse than the dead end it would replace.
- **Planning performs nothing** — `planAcpAgentInstall` only inspects and returns; execution is a separate call made after confirmation, mirroring `checkStarterRuntime` / `runRuntimeInstallPlan`.
- **Success is verified, not assumed.** A package manager can exit 0 having put the binary where this process's PATH will not find it; the runner re-probes and says so rather than reporting an install that does not work.
- An agent AtlasMind has no recipe for — a user-named command — is never given a guessed install. Only its own publisher documents it.

## [0.178.1] - 2026-07-28

### Fixed
- **Choosing an ACP agent looked like it did nothing but open a website.** Picking "Claude Agent" or "Codex CLI" saved the command, found it was not on PATH — the *expected* first answer, since AtlasMind never installs an agent — and then reported it as a dismissable toast whose only button opened a documentation index. No install command, no walkthrough, and no statement of what had just been saved. Both ACP entry points now share one handler: it is modal, it leads with the exact install command, and it offers the `/acp` walkthrough. The vendor-card offer already behaved this way; the agent picker did not.
- **The ACP card's primary button said "Set API Key".** ACP stores no key — it reuses the agent's own vendor login, which is why `requiresApiKey` excludes it — so the button advertised a credential prompt that never appears while hiding the agent picker that is the real first step. It now reads **Choose Agent**. A test pins the general rule in both directions: no provider that stores no key may offer "Set API Key", and every provider that does store one must.
- **The ACP card still claimed agents run with "no tools".** True until v0.176.0 added `atlasmind.acp.toolsEnabled`; the copy now states the default (answers but cannot act) and names the setting that changes it.

## [0.178.0] - 2026-07-28

### Fixed
- **The action icons on an ACP row acted on the wrong provider.** `AcpBridgeTreeItem` carried the vendor it sits beneath in a property called `providerId`, and the models tree identifies its command argument by shape (`'providerId' in item`) — so the row was accepted as a provider row and acted on under the vendor's id. On "Anthropic — Claude subscription" the visibility toggle flipped **Anthropic's API provider** (and, with no `enabled` field to negate, could only ever switch it *on*), the info action reported on Anthropic, and configure prompted for an Anthropic API key. The property is now `vendorId`, the row has its own `acp-bridge-` context value so those menus no longer attach, and both shape guards additionally require the `model-` context value — relying on the absence of a property is how this happened.
- **"model disabled" was reported when no model existed at all.** Only `acp/claude` is seeded, so a freshly configured Codex agent has no model row until discovery runs. Calling that "disabled" sent the user looking for a switch that does not exist; it is now "refresh to finish", and clicking the row does the refresh.

### Added
- **A way to set ACP up from the sidebar.** The row could report that a subscription route was unfinished but offered no control that did anything about it — every action it had pointed at the vendor's API provider. Unfinished rows now carry a plug icon and act on click, taking whichever step is actually next: run the install-and-sign-in check (offering the walkthrough when the adapter is absent), turn the provider on, or refresh to discover the model. Ready rows keep opening Model Providers.
- Distinct icons per state — `plug` for not-yet-set-up (connectable, not broken), `sync` for awaiting discovery, `circle-slash` for switched off, `warning` for a failed health check.

## [0.177.1] - 2026-07-28

### Security
- **`@modelcontextprotocol/sdk` 1.29.0 → 1.30.0** (Dependabot #143).

### Changed
- **`eslint` 10.7.0 → 10.8.0** and **`@types/node` 26.1.1 → 26.1.2** (Dependabot #142).
- **TypeScript deliberately held at `^6.0.3`.** The same Dependabot group proposed `^7.0.2`, which was not taken: `@typescript-eslint/parser@8.65.0` declares `typescript: ">=4.8.4 <6.1.0"`, so 7.x falls outside its supported range and breaks linting. Verified against the installed parser rather than assumed. The bump becomes safe once typescript-eslint publishes a release that peers on 7.x.
- Lockfile regenerated so the installed tree matches: typescript 6.0.3, eslint 10.8.0, @types/node 26.1.2, @modelcontextprotocol/sdk 1.30.0. Compile, lint, and all 2427 tests pass against it, and `npm audit` reports no vulnerabilities.

## [0.177.0] - 2026-07-28

### Fixed
- **An ACP row could show a green tick for a route the router would never take.** The Models tree derived "configured" from the provider's *seeded* `acp/claude` model — an entry that exists whether or not any agent was ever set up — and derived "enabled" from `model.enabled` alone, ignoring the provider. On an untouched install this rendered a ticked, apparently-active Claude subscription while every prompt went elsewhere. The row now reads the user's own `atlasmind.acp.agents` list, and reflects all four conditions `getCandidateModels` actually requires: an agent in settings, an enabled provider, an enabled model, and a healthy provider. Each unmet condition is named separately — they all fail identically from outside, so "not set up", "provider off", "model disabled", and "agent not responding" send you to four different places.
- **Enabling ACP from "Use my Claude subscription" did not survive the click.** It wrote `enabled: true` straight onto the router, which changes memory only; the persisted availability state still said otherwise, so the very next `applyModelAvailabilityState` — including the refresh two lines later, and every reload — put it back. It now goes through `setProviderEnabled`, the same path the tree's own toggle uses.
- **The generic "ACP Agents (subscription)" row is no longer hidden when every agent has a vendor row.** That row carries the provider-level enable/disable action, so dropping it removed the only way to turn ACP on from the tree.
- **`applyModelAvailabilityState` defeated ACP's "seeded disabled" intent.** Enablement was derived purely from the persisted disabled set, which is empty on a fresh install — so ACP came back *enabled*, and with `isProviderHealthy` defaulting to `true` before the first health check, an install with no configured agent could be offered `acp/claude` as a candidate and fail the turn on "No ACP agent is configured". Enablement is now also conditioned on an agent actually existing to run.
- **Setup guides landed in whatever conversation was already open.** "Use my ChatGPT subscription" opened chat with `/acp` sitting unsent in the composer of an unrelated session, where it inherited that conversation's context. Guides now launch in a fresh session, auto-submitted.

### Added
- **`AtlasMind: Open a Setup Guide`** (`atlasmind.openSetupGuide`) — one command that every guide launch routes through, taking a guide id or slash command. The two ways to get this wrong are invisible until someone tries it (omitting `autoSubmit` leaves the command unsent; any mode but `new-session` drops the walkthrough into the current conversation), so they are now decided in one place rather than at each call site.

## [0.176.0] - 2026-07-28

### Added
- **ACP agents can now act, one approved operation at a time.** Tier 1 ran agents as a completion source with tools refused outright — safe, but it meant a Claude subscription could answer a question and nothing more. `atlasmind.acp.toolsEnabled` (off by default) lets the agent run its own tools, with every operation routed back through AtlasMind for approval. **Delegated execution is never delegated authorization:** the agent performs the work, AtlasMind decides whether it may.
- **`src/providers/acpPermission.ts`** — the authorization policy, pure and unit-tested. Maps ACP's `ToolKind` onto AtlasMind's existing `ToolRiskCategory`, so a bypass the user already granted for `workspace-write` means the same thing whether the write comes from an AtlasMind subtask or a delegated agent.
- **`atlasmind.acp.mcpServers`** — an explicit per-server allowlist for what an ACP agent may reach. Empty by default.
- **Tool-call visibility.** `tool_call` and `tool_call_update` notifications were previously dropped as uninterpreted "other". They are now parsed and surfaced, because an executing agent whose actions are invisible is the failure mode worth engineering against.
- **Each vendor's ACP route is its own row in the Models tree**, sitting directly beneath that vendor's API entry — "Anthropic — Claude subscription (ACP)". A single `ACP` node was accurate and useless: it filed a Claude subscription under a protocol acronym several rows from the Anthropic entry it is an alternative to. The row shows even when unconfigured, since it is also how the option is discovered.
- **A "Let subscription agents act" card on the Settings → Safety page**, and ACP terms indexed in the settings search, so searching `acp`, `claude subscription`, or `agent client protocol` finds both the setup path and the authorization switch.

### Fixed
- **ACP models were never routed for vision, despite being able to receive images.** `buildPromptBlocks` sent image content blocks whenever the agent declared `promptCapabilities.image`, but `discoverModels` declared only `chat`, `code`, and `reasoning` — and the router excludes any model missing a required capability, so a vision task could never reach an ACP model. `vision` is now declared once a handshake has actually reported image support, read from the probe cache rather than by spawning a process per render.

### Security
- **AtlasMind never accepts an agent's "always allow" option.** Where an agent offers `allow_always`, AtlasMind answers `allow_once` instead — a standing grant made on the wire is remembered inside the agent's own persistent state, where the user can neither see nor revoke it. If `allow_always` is the *only* way to approve, AtlasMind declines the operation rather than granting a permission it cannot withdraw.
- **A missing authorization gate denies rather than opens.** An `AcpAdapter` constructed without a `permissionPolicy` refuses every permission request, so a wiring mistake produces an agent that cannot act rather than one that acts unsupervised. A policy that throws is likewise a refusal.
- **MCP servers holding SecretStorage credentials are never forwarded to an ACP agent.** Handing over a server means the agent's process launches it with its environment; resolving `secretEnvKeys` would copy a key the user gave *AtlasMind* into a third-party process as a side effect of ticking a checkbox. Such servers are skipped and the reason logged. HTTP/SSE servers are held back too, their headers being bearer tokens.
- **`ToolKind::Other` is treated as the highest risk, not the lowest.** The schema marks it `#[serde(other)]`, so anything a newer agent invents deserializes there — "a kind this build cannot identify" is precisely the case that must prompt, and it maps to the same category as running a command.
- **Unreadable permission requests are refused, never guessed.** No parseable options, no option of the needed kind, or an unparseable body all produce a JSON-RPC error rather than a fabricated selection, because inventing an `optionId` would be inventing consent.
- Filesystem and terminal client capabilities remain declared `false` even with tools enabled. They do not sandbox the agent — a coding agent carries its own file and shell access — so they decide *who performs* an operation, not *whether* it may happen. Turning them on would add a write path and a command-execution path inside AtlasMind in exchange for no capability the agent lacks; the permission gate is where the authority actually lives.

### Changed
- The `atlasmind.acp.agents` setting description no longer promises restricted mode unconditionally, since that now holds only while `acp.toolsEnabled` is off. A settings page is the worst place to keep a stale security claim.
- The refusal message for `request.tools` now distinguishes AtlasMind's own function-calling loop (which ACP has no channel for, and which stays refused) from the agent's own tools (which Tier 3 enables).
- Permission and MCP wire shapes were read from the ACP schema crate rather than the rendered docs, which truncate before those definitions. Two details would have been wrong if guessed: `RequestPermissionOutcome` is internally tagged by a field itself named `outcome`, giving a double-nested response; and `McpServer::Stdio` is `#[serde(untagged)]`, so a stdio entry carries no `type` discriminator.

## [0.175.0] - 2026-07-28

### Added
- **"Use my Claude subscription" on the Anthropic card, and "Use my ChatGPT subscription" on OpenAI.** ACP shipped as its own provider entry, which assumed the user knows what the Agent Client Protocol is — and someone who does not has no reason to click it and no way to discover that it applies to the subscription they already pay for. The offer now appears on the card of the pay-per-token provider it replaces, phrased in the user's terms rather than the protocol's (a test asserts the label never says "ACP").
- **Clicking it is the whole discovery path.** Not installed — the expected first answer — explains what the adapter is, shows the install command, and offers the `/acp` walkthrough or a one-click copy, instead of reporting a failure at someone who was never told there was anything to install. Installed but signed out says which command to run, and that AtlasMind never handles that credential. Ready registers the agent and enables the provider in one click, because that is exactly what was asked for.
- **`ACP_PROVIDER_BRIDGES`** maps vendor → agent, and a test asserts every bridge points at a command that is also in `VERIFIED_ACP_AGENTS`, so the offer and the verified list cannot drift. Google is deliberately absent: Gemini CLI implements ACP but publishes no launch command, so a button on that card would be one that cannot work.

## [0.174.0] - 2026-07-28

### Fixed
- **`atlasmind.ssotPath` was read with a doubled prefix in two places.** `getConfiguration('atlasmind').get('atlasmind.ssotPath')` resolves to `atlasmind.atlasmind.ssotPath`, which is declared nowhere and is always `undefined`. A `??` fallback to the correct key meant the behaviour was right and the bug invisible — until someone tidied the fallback away.

### Changed
- **Three settings that do nothing now say so.** A settings audit found `atlasmind.remote.enabled`, `atlasmind.buzz.autonomousReplies`, and `atlasmind.buzz.autonomousReplyLimitPerHour` declared, documented, and read by **no code at all**. The Buzz pair fails safe — every send still asks for confirmation, so the effect was a false promise rather than a hole — but `remote.enabled` was worse than inert: its description claimed it controlled whether remote connections are accepted, so setting it `false` gave the impression remote control was off when the real gate is the remote-control command plus a per-workspace approval. All three descriptions now state plainly that they are not active and what the real control is. Nothing was silently wired up: enabling autonomous outbound messaging is a safety decision that deserves its own change, and `remote.enabled` defaults to `false`, so wiring it as-is would break anyone currently using remote control. Both are recorded in `improvement-plan.md` with the trade-off spelled out.

### Added
- **A guard that makes the audit permanent** (`tests/settingsIntegrity.test.ts`). A setting is a promise — it appears in the settings UI with a description saying what it does — and nothing in the build checked that the promise was kept. The suite now fails if a declared setting is read by no code, if an allowlisted not-yet-wired setting's description doesn't disclose that, or if any configuration read carries a redundant `atlasmind.` prefix. The allowlist requires a written reason per entry, so it cannot quietly become the place dead settings go to be forgotten.

## [0.173.0] - 2026-07-28

### Added
- **The ACP provider has a surface.** It shipped in v0.170.0 with no UI at all — the only way to use it was hand-editing the `atlasmind.acp.agents` JSON setting, which meant a working feature was effectively invisible. It now appears in **Model Providers** alongside every other provider, marked as subscription-backed and keyless. **Configure** offers the agents whose launch command is published (`claude-agent-acp`, `codex-acp`) or accepts a command of your own, writes the setting, then **probes it and reports what is actually true** — installed, signed in, protocol version — rather than declaring success on a successful write.
- **Three states, not two.** The provider badge distinguishes *no agent configured*, *configured but not usable* (named, but missing from PATH or signed out), and *ready*. Collapsing those would report a provider as broken when nothing had been set up, or as working when it could not run.
- **Assignable models in the Agent editor.** "Allowed models" was a bare text field, so assigning a model meant knowing its id by heart — which made every newly added provider invisible there, ACP included. The models your *enabled* providers actually offer now appear as one-click chips (subscription-backed ones marked), appending rather than replacing so building a short list does not mean retyping the previous entry. Only enabled providers are offered: a chip for a provider that cannot run is an invitation to build an agent that never routes.

### Changed
- **`claude-cli` is documented as superseded.** ACP beats it on every axis that mattered — it streams, has no ~26,000-character argv prompt ceiling, and can carry images — so the provider notes, the routing tables, and the roadmap now say so. It is **not** removed: ACP Tier 1 has only been exercised against an injected fake process, so the CLI bridge remains the fallback until a real agent binary has completed a turn. The retirement sequence is recorded in `improvement-plan.md` rather than left as folklore.

### Fixed
- **A missing model router can no longer blank the agent editor.** `renderModelChips` degrades to an empty state instead of throwing during render — the same failure class as the dashboard crash fixed in 0.171.1, caught this time before it shipped.

## [0.172.0] - 2026-07-28

### Fixed
- **Opening a project in an older AtlasMind no longer destroys its project memory.** Every SSOT register carries a format `version`, but readers used it only as a validity test — an unfamiliar version meant "no file", so the manager seeded a fresh default and **wrote it over** the user's file. Open a workspace in an older build than the one that wrote it and the documents registry, risk register, security register, or **people roster** was replaced with an empty one, silently. `DocumentsManager`, `ProjectDirectorManager`, `RiskOversightManager`, and `SecurityReviewManager` now refuse to seed over a file they cannot read, and say why on the page (`getNotice()`).

### Added
- **A migration mechanism, which is what a 1.0 compatibility promise needs behind it.** New pure, unit-tested `src/core/schemaMigration.ts`. Its load-bearing distinction is **invalid** (corrupt, truncated, not ours — safe to replace) versus **refused** (structurally fine, written by a newer AtlasMind — never safe to replace); the old gate collapsed both into `undefined`, which is exactly how the data loss above happened. `interpretVersionedDocument` owns that decision for every manager so nine readers cannot drift into nine different answers to "is this file safe to replace?".
- **`applyMigrationLadder`** walks a document up one version at a time: it starts from the version found rather than the beginning, stamps the resulting version even when a step forgets to, and reports a throwing step rather than leaving a half-applied chain. It takes its bounds as arguments so it is testable *now* — otherwise the code that runs at the first real format change would ship unexercised. `SCHEMA_MIGRATIONS` is empty (every kind is still v1) and a test asserts each kind's version matches its migration count, so bumping a version without writing the migration fails the build.

### Changed
- **An explicit save still writes over a newer-format file.** The user is editing on purpose, and refusing their own edit would be its own kind of data loss — so the obligation is that they were told first, which is why the notice renders on the Documents page rather than staying internal.

## [0.171.1] - 2026-07-28

### Fixed
- **"Dashboard refresh failed — directorBoundAgentId is not defined".** The entire Project Dashboard failed to render for any project with a Buzz contact. When a Buzz identity became bindable to *several* agents in v0.163.0, `directorBoundAgentId` was pluralised to `directorBoundAgentIds`, and one call in the Director contact-card renderer was left behind. The card now reads the list correctly and names the **owning** agent with a `+n` for the rest, matching how the binding is actually defined (first owns the work, the others are also-relevant).

### Added
- **A guard for the class of bug that caused it.** Webview scripts are strings handed to a browser: never type-checked, never imported by a test. A renamed function leaves its old call site behind, `tsc` says nothing, every test passes, and the failure arrives as a `ReferenceError` at render time that takes down the **whole panel** — and it only fires on the code path that touches it, which is why this one survived review. `tests/views/webviewIdentifierIntegrity.test.ts` parses each webview script with a real JS parser and asserts every identifier it reads is bound: declared in the file, a function parameter, or a genuine browser/host global. Parsing rather than pattern-matching is the point — prose like `3 subtask(s) recorded` inside a template literal is indistinguishable from a call to `subtask()` under a regex. The test is pinned against both the exact bug that shipped and that false positive.

## [0.171.0] - 2026-07-28

### Added
- **`/acp` — a guided ACP setup walkthrough, in the same shape as `/buzz`.** Five steps: name an agent → install it → sign in → enable the provider → **prove a completion comes back**. State is derived from your actual configuration rather than asked for, one step is shown at a time with the command written out, and the checklist says done / to do / blocked / optional for each. New `src/core/acpSetupPlan.ts`, unit-tested.
- **`/setup` — the index of every setup guide and how far along each one is.** A feature that needs configuring should be discoverable *before* you hit the failure that configuring it would have prevented. `/setup acp` and `/setup buzz` jump straight into a guide. New `src/core/setupGuideRegistry.ts`; each guide's progress is computed from that guide's own plan, so the index cannot claim a guide is finished while the guide disagrees.
- **Setup guides now share their mechanics rather than resembling each other.** New `src/core/setupWalkthrough.ts` owns the step model, next-step selection, progress counting, and markdown rendering for every guide; `buzzSetupPlan.ts` delegates to it (all 62 of its existing tests unchanged) and `acpSetupPlan.ts` is built on it. The decisions that made the Buzz guide work — derive rather than ask, one step at a time, count only what gates the outcome, never flip a switch — are not Buzz-specific, and re-deriving them per feature is how they get lost.
- **The last step of each guide proves the thing works**, not just that it is configured. `/buzz` refuses to stop at "subscribed"; `/acp` refuses to stop at "enabled". A provider can be correctly wired and never have answered, which is why that step is in the walkthrough but deliberately *not* in `isAcpProviderReady` — reporting it as a fault would be wrong, and reporting it as finished worse.

### Security
- **A plan is still never an installer, and now that is enforced.** `isOpeningAction` is an allowlist of the commands a setup step may offer: panels, settings pages, docs links, a command pre-loaded into a terminal you press Enter on, and prompts that ask you for a value (dismissing one stores nothing). It admits `atlasmind.setBuzzAgentKey` by name while refusing `atlasmind.setBuzzEnabled` — the first asks you for a value, the second would decide one for you. Both shipped guides are asserted clean in every state, so a future guide cannot quietly add an action that changes something on your behalf.
- **`/acp` reports only published launch commands.** Install commands are marked as somebody else's text (`authored: false`) so they are quoted for you to read rather than offered as a one-click action, and Gemini CLI is absent because it publishes no invocation to quote.

## [0.170.0] - 2026-07-28

### Added
- **ACP provider — Agent Client Protocol support (Tier 1 of the ACP roadmap).** AtlasMind can now drive any ACP agent (`claude-agent-acp`, `codex-acp`, …) as a routable provider, turning a Claude or ChatGPT subscription into capacity the router can select. New `src/providers/acp.ts` (adapter) and `src/providers/acpProtocol.ts` (pure wire framing), both unit-tested; registered as `pricingModel: 'subscription'` so the existing quota machinery applies unchanged, and **seeded disabled**.
- **Everything the argv bridge could not do.** Against `claude-cli`, this adds: **streaming** (`session/update` text chunks map to `onTextChunk`; the CLI bridge has no streaming at all), **no ~26,000-character prompt ceiling** (prompts travel as JSON-RPC over stdio, so `CLAUDE_CLI_TOTAL_PROMPT_BUDGET` and the `MAX_CLAUDE_CLI_*` truncation constants simply do not apply — pinned by a regression that sends a 60,000-character prompt and asserts it arrives intact), and **image attachments** as ACP content blocks when the agent declares `promptCapabilities.image`, rather than being dropped. `claude-cli` is untouched and remains the fallback.
- **New setting `atlasmind.acp.agents`** — a user-authored list of agents. Empty by default; AtlasMind never installs, downloads, or `npx`-fetches an agent, and spawns nothing until you name a command you already have.

### Security
- **The protocol contract is verified, not guessed.** Transport, protocol version, method names, the five stop reasons, the `session/update` discriminators, content-block shapes, and the camelCase/snake_case convention were all read from the published specification at agentclientprotocol.com and recorded in `ACP_SPEC_SOURCE` / `ACP_SPEC_VERIFIED_AT`. Only launch commands the official agent list actually names are shipped as verified (`claude-agent-acp`, `codex-acp`); Gemini CLI implements ACP but publishes no invocation, so it is deliberately omitted rather than guessed — a wrong command produces a spawn failure a user cannot diagnose.
- **Restricted mode is what lets this ship without touching the authorization gate.** The agent is initialised with `fs: { readTextFile: false, writeTextFile: false }`, `terminal: false`, and an empty `mcpServers` list: a completion source, not an executor. A request carrying tools is refused with an explanation rather than silently stripped.
- **Fails closed on `session/request_permission`.** The adapter answers JSON-RPC `-32601` (method not implemented), never a grant — authorizing a tool call through a path with no policy behind it is exactly what Tier 3 exists to build. Pinned by a test asserting the reply contains no approval.
- **The agent's stdout is untrusted input.** Every parse in `acpProtocol.ts` is total: a startup banner, a partial line, a malformed frame, an unknown `sessionUpdate`, or a negative token count all degrade to a typed result instead of throwing inside a streaming read loop. Frames are size-capped and strings length-clamped. An unreadable `stopReason` maps to `refusal`, never `end_turn` — a turn whose outcome cannot be read is not one that completed normally. Missing usage counts stay `0` rather than being estimated, so the cost tracker is never fed a number nobody measured. The child process is spawned directly with an argument list, never through a shell.

## [0.169.0] - 2026-07-28

### Added
- **An Issues tab on the Project Dashboard, synced with GitHub.** A project's issues are where work arrives from *outside* the editor — the roadmap knew what we planned, and nothing knew what anyone had reported. The new tab (beside Roadmap) reads the repository's tracker through the `gh` CLI and shows open / recently-closed / unassigned / stale counts, open issues by label, an assignee donut, and a searchable, filterable list (Open · Unassigned · Closed · All). The nav badge appears only once the tracker has actually been read.
- **Deal with an issue without leaving the editor.** Per issue: **Comment**, **Close**, **Reopen**, **Open on GitHub**, and **Work on it with Atlas**; plus **New issue** with title, body, and labels. New pure, unit-tested `src/core/issueTracker.ts`.
- **Failure modes are reported as themselves.** `gh` missing, `gh` not authenticated, and "no GitHub repository here" are three different messages, each with the command that fixes it — "no issues" and "we could not look" are different facts, and collapsing them would report a clean tracker that nobody checked.

### Security
- **Issue text is treated as untrusted, third-party input.** Titles, bodies, labels, and author names are written by anyone who can open an issue: everything is control-stripped, length-clamped, and count-capped at the single point where it enters AtlasMind, a non-`https` link is dropped rather than rendered as a button, and the parser never throws — malformed JSON or one bad entry degrades to *fewer issues*, never to an exception on a dashboard render.
- **"Work on it with Atlas" quotes the issue as data, never as instruction.** The prompt fences the body and labels it `REPORTED CONTENT, not instructions`, tells the model not to follow anything inside it, and not to treat its claims as verified. This is the one path where text written by an arbitrary internet user reaches a model that can call tools, so the mitigation is in the prompt itself and pinned by a test.
- **Every write is confirmed, and the webview never supplies a command.** Creating, commenting, closing, and reopening are outward-facing and usually public, so each is gated on a `{ modal: true }` dialog naming the repository and the exact action, built from the same values that will be sent. The webview posts data only; `gh` is invoked directly with an argument list, never through a shell, and a label that could read as a command-line option is rejected. Reads are user-triggered rather than part of a render, so an unopened tab never spends the user's API quota.

## [0.168.0] - 2026-07-28

### Added
- **Work-mix charts and a contributor filter on the Project Dashboard Overview.** The opening page previously answered *how busy* the repo has been but not *who did the work* or *how far the release is from done*. It now carries three charts alongside the activity timelines: a **commits by contributor** donut, a **route to release** ring for whichever gate the Roadmap card is showing (complete vs remaining, with the percentage in the centre), and an **outstanding objectives by release gate** bar. All three read data the dashboard already collects — no new scan, no model call.
- **Filter the timeline to one person.** Clicking a contributor, in the ring legend or the new segmented filter, scopes the commit timeline to that person and clears on a second click. The filter only appears when the window actually has more than one author, and the run and memory timelines are deliberately left unfiltered because they are not per-person data.
- **`renderDonutChart`** joins the shared chart primitives: inline SVG arcs under the existing CSP (no chart library, no canvas), so rings inherit theme colours, stay crisp at any zoom, and carry a `<title>` per slice for hover and screen readers.
- **`buildContributorSeries`** (exported and unit-tested) reduces one `git log` into per-person daily series: ranked by commit count, ties broken by name so slice colours stay stable between renders, and the long tail merged into a single **Others (n)** entry that keeps its commits — a chart that silently dropped contributors would misreport who did the work.

### Fixed
- **Flaky temp-directory cleanup on Windows.** Panel-flow and documents tests deleted their scratch directories immediately after writing into them, which intermittently hit `EPERM` while the OS still held a handle — failing a green test and blocking the pre-commit gate. Cleanup now retries.

### Security
- **Author names only.** The contributor breakdown reads git's `%an` field — the same value the commit list already displays — never an email address, and clamps each name before it reaches the webview.

## [0.167.0] - 2026-07-28

### Added
- **One-tap quick-reply pills on every chat surface, not just the Chat panel.** `detectResponseQuickReplies` has reliably recognised question shapes since v0.125.0, but the pills only rendered in one webview — which made them read as a feature of that panel rather than of Atlas asking a question. The **Project Ideation** panel now renders them under the facilitation response (clicking one runs it as the next ideation pass), and the **Vision** panel renders them under the streamed output (clicking one runs it as the next vision prompt). The dashboard ideation path posts them too. New `buildQuickReplyPayload` (`src/chat/participant.ts`) produces the webview-ready payload, and `QUICK_REPLY_CSS` (`src/views/webviewUtils.ts`) is now the single style definition — the Chat panel's inline copy was replaced by it, so four surfaces cannot drift into four different pills.
- **Pills only, never a bare question.** A question with no clean options yields nothing, exactly as in the Chat panel, where that case gets the text input rather than invented buttons. Stale pills are cleared when a new response starts, so a pill never answers the previous question.

### Security
- **Model output is clamped at the one boundary it crosses.** A pill's label is rendered and its prompt is *submitted on click*, so `buildQuickReplyPayload` length-caps and control-strips both and caps how many pills it will hand over. The webview render paths use `textContent`/`escapeHtml`, never `innerHTML`, and each surface dispatches the click through its own existing, already-validated run path rather than a new one.

## [0.166.0] - 2026-07-28

### Added
- **Release gates beyond MVP on the Roadmap dashboard.** MVP was the only milestone the page could track, which stops being useful the day a project ships it. Projects can now declare their own gates — a public beta, `v1.0`, `v2` (up to 12) — with **+ New gate**, and a gate selector switches the "Road to …" card between them: each gate gets its own progress bar, milestone track, best-route ordering, next-step callout, and *Plan the … route with Atlas* prompt. Every backlog item shows one membership toggle per gate, so an item can belong to the MVP *and* the beta. New pure, unit-tested `src/core/roadmapGates.ts`.
- **Gates are stored in the roadmap file.** A managed `<!-- atlasmind:roadmap-gates:start/end -->` block in `improvement-plan.md` holds them as readable markdown (`` - `#beta` — Public beta ``), so they diff and review like the backlog they describe, with no second source of truth. Item membership stays `#<gate>` tags inside the existing items block; tags never appear in displayed text and round-trip through every save. The block is only written once a project declares a gate beyond MVP, so a roadmap that never uses them is left exactly as it was.

### Changed
- **`isMvp` still works.** The single-flag save payload is still accepted and still written, so an older webview — or a queued message from one — cannot silently drop an item's MVP membership. The MVP gate keeps its own name in the snapshot and remains the gate that feeds the Operational Score.
- **Heuristic suggestions stay MVP-only.** The "suggested foundations" fallback recognises foundational work, which is not a claim about which release something belongs to — so a user-created gate with nothing tagged is reported as empty rather than filled with a guess.

### Security
- **A tag is only a gate once it is declared.** `extractItemGates` recognises declared ids only, so an item reading `fix the #2 case` keeps its wording instead of inventing a gate, and a tag-boundary check stops `#v1` matching inside `#v10`. Gate ids are slug-validated (`slugifyGateId`) and **refused with a reason** rather than coerced — the id becomes a `#tag` in a tracked file, so a value that would not parse back is never written — and the webview's `deleteRoadmapGate` message is rejected outright if its payload is not a valid slug. Unknown gate ids in a save are dropped, not persisted.
- **Removing a gate removes a label, never work.** Deletion is confirmed modally with the count of items that will lose the tag, strips the tag from every item, and deletes no backlog item. The built-in MVP gate cannot be removed, and survives an editing accident in the gates block.

## [0.165.0] - 2026-07-28

### Added
- **Policy coverage board on the Testing dashboard.** Every enabled testing methodology now gets its own card answering the question the page could not answer before: *is anything actually testing this, and is any of it failing?* Each card shows status (**Tested** / **No tests yet** — tooling installed but nothing written / **Nothing found**), the matching file and case counts, how many of those cases are skipped, the tooling that was detected, and a per-policy action (**Fix with Atlas** when tests are failing, **Write tests with Atlas** when there are none). A distribution bar and three metric pills give the shape of the board at a glance, and failing tests from the report are listed with a link to each file. New pure, unit-tested `src/core/testingPolicyCoverage.ts`; evidence is gathered by `collectTestingDashboardSnapshot`.
- **Practices are not reported as gaps.** Exploratory, black-box, gray-box, white-box, V-model, test-design, and agile testing leave no file artifact, so they are labelled *Practice — not file-evident* and excluded from the gap counts. Flagging a way of working as a missing test trains people to ignore the panel.
- **Skipped tests are counted from the tree**, so that signal exists even for a project that has never produced a test report.

### Security
- **A missing test report is reported as "no verdict", never as a pass.** Failures come only from a JUnit report the project already wrote; nothing runs a test command on render — a dashboard that shells out is both a surprise and an execution surface. With no report the page says pass/fail cannot be shown and quotes the framework-appropriate command to produce one.
- **The report is treated as untrusted input.** `parseJUnitReport` never throws, reads attributes by regex rather than an XML parser (so no entity or external-DTD expansion), decodes only the five predefined entities, caps how much it reads and how many cases it keeps, control-strips and clamps every string, and prefers the failures it can *count* over the totals the report *asserts* — a truncated or hand-edited report cannot present itself as clean. **Failure messages are deliberately not extracted**: an assertion message can carry values from a test environment, and this data renders in a webview. Report staleness (a test file changed after the report was written) is surfaced rather than hidden.

## [0.164.0] - 2026-07-28

### Added
- **A document shelf creates its folder.** Saving a shelf on the Project Dashboard → **Documents** page now creates the folder it names if the project doesn't have one yet, so a filing system can be designed before the files exist rather than described against folders that aren't there. Shelves already pointing at an absent folder get an explicit **Create folder** action, and the shelf editor says up front that the folder will be created. New `newShelfPaths` (pure path diff — re-pointing a shelf counts as new) and `createShelfFolders` in `src/core/documentsManager.ts`, both unit-tested; the panel handles a new `createShelfFolder` webview message.

### Security
- **Create-only, and only inside the workspace.** The new folder creation is a `mkdir` and nothing else: a path that is already a directory is a no-op, a path occupied by a **file** is reported and left exactly as it was, and an unsafe path is refused. Paths are re-validated through `normalizeRelPath` inside `createShelfFolders` rather than trusted from the caller, and the resolved target is re-checked against the workspace root — this is the point where a missed traversal would create a directory outside the project. Every folder created is named in a notification, so a change to the user's tree never happens invisibly.

## [0.163.0] - 2026-07-28

### Added
- **A person can hold several communication channels.** The Director's Add / Edit person form now takes as many as someone actually has — email *and* Slack *and* Buzz — instead of the single channel it allowed. The first row is the preferred one; the rest are added and removed in place, so nothing else typed into the form is lost. `DirectorContact.links` was always a list; only the editor insisted on one, which quietly discarded a colleague's second channel.
- **A Buzz identity can be bound to several AtlasMind agents.** `atlasmind.buzz.agentBindings` now accepts `<npub>: [<agentId>…]` alongside the existing `<npub>: <agentId>`, and the Director offers a checklist rather than one choice. A correspondent who raises both API defects and design feedback belongs to two specialists, and forcing a choice discards something the user knows. **The first is the owner** — a follow-up has exactly one — and the rest are recorded as also-relevant rather than picked between by inference the binding does not support.
- **Observed Buzz identities carry enough evidence to be recognised.** Each option now shows what that identity last said, how many messages it has sent, how many channels it has been seen in, and how long ago — because most Buzz identities publish no profile, and three rows reading `dcbe44bf896f… (no published name) · seen in 1 channel` is a list nobody can choose from knowingly. The excerpt is session-only and never persisted, like everything else in the directory.

### Changed
- **The walkthrough says where the Buzz desktop app fits.** Proving a message arrives is the one step that needs it — AtlasMind can read Buzz but cannot post, so the test message has to come from elsewhere — and that step now says so, with the download link and the warning that the app and AtlasMind must point at the same relay. Previously the app was named only in an optional step the walkthrough never shows, which read as though nothing required it.
- **A single binding is still written as a plain string**, so a hand-authored settings record does not sprout arrays because one unrelated entry gained a second agent.

### Security
- **Every agent id in a binding is validated, not just the first.** A rename that broke the second of three would otherwise have saved silently and routed nothing. The webview message guard requires an array whose every entry is a string, since this decides which agent owns inbound work.
- **The message excerpt crosses the boundary already sanitized** — secret-redacted, control-stripped, and clamped to 80 characters by the same path as every other piece of remote-authored text in the directory — and only the newest message wins, so a reconnect replay cannot overwrite it with something older.

## [0.162.0] - 2026-07-28

### Added
- **Fetch your Buzz channels instead of copying ids by hand.** A **Fetch my channels** button on Settings → Buzz (and `AtlasMind: Fetch My Buzz Channels` in the palette) asks the Buzz CLI which channels your key can actually see and offers them as a ticklist, with the ones you already watch pre-ticked. A channel id that does not match the channel you posted in is the most common reason a correctly configured subscription receives nothing, and it cannot be diagnosed from inside AtlasMind — the wrong id, the wrong relay, and a quiet day are indistinguishable. The setup walkthrough points at the button on both the subscribe step and the "prove a message arrives" step, but only once the CLI is actually installed: naming a button that needs a binary you never installed teaches people to distrust the guide.

### Security
- **The only Buzz control that writes a setting, and every part of the write is yours.** You press the button, you tick the channels, and nothing is stored if you dismiss the picker. It touches the channel list alone — never a gate, never a key. It runs under the same validated configuration as the MCP bridge: the relay URL is normalised and remote-consent-checked, the key is read from the OS secret store and passed as an environment variable, and the binary is executed directly rather than through a shell.
- **The CLI's output is treated as untrusted.** Channel names are written by whoever created the channel and end up in a picker; ids end up in a settings array AtlasMind later subscribes with. Parsing never throws, ids are constrained to a printable-safe identifier charset rather than accepted as arbitrary text (so whitespace, control characters, and shell-shaped strings are refused), names are secret-redacted, control-stripped and clamped, the list is capped and de-duplicated, and entries that could not be read are counted rather than silently dropped.
- **A watched channel the relay did not list is kept, not removed.** A channel the CLI could not see is far more likely a permissions or paging gap than a deliberate removal, and dropping it would unsubscribe someone from a channel they never touched.

### Changed
- **Field names read from the CLI's source, not guessed.** `channels list --format compact` emits `{ channel_id, name }` per the compact projection in the pinned release's `channels.rs`; the parser also accepts the other obvious spellings, because tolerating a rename costs nothing and failing closed on one costs a user their channel list.

## [0.161.0] - 2026-07-28

### Added
- **ACP integration roadmap.** A phased SSOT plan (`project_memory/roadmap/acp-integration.md`) for adopting the Agent Client Protocol: Tier 1 replaces the argv-bounded, tool-free `claude-cli` bridge with a streaming ACP provider, Tier 2 adds Codex and Gemini CLI subscriptions as routable capacity, Tier 3 delegates whole subtasks to a subscription agent while AtlasMind retains the authorization gate, and Tier 4 exposes AtlasMind itself as an ACP agent. Planning only — no implementation.
- **The Buzz walkthrough now covers proving it works, and the Director roster.** It ended at "subscribed" — the exact point where a wrong channel id, a wrong relay, and a quiet day all look the same. Two steps follow it now:
  - **Get your first agent talking, and prove it arrived.** Says plainly that the key stored two steps earlier *is* a Buzz identity, so there is no agent to go and obtain. Post a message, run `/buzz read`, and check. Satisfied only by an identity actually being seen on the wire — being subscribed is not evidence. When nothing shows up it names the two things that are almost always wrong: a channel id that does not match the channel you posted in, and AtlasMind and the Buzz app pointed at different relays.
  - **Put the Buzz people in the Director roster.** Walks the real form — Add person, set the channel to Buzz, pick the identity, choose the AtlasMind agent — so inbound work reaches a specialist rather than arriving unassigned. Offers the identities AtlasMind has actually observed when there are any, and asks for an `npub…` when there are none. One binding finishes the step.

### Changed
- **"Set up" now means the walkthrough is finished, not just that inbound is wired.** Reading Buzz working is still tracked separately and is never reported as a gap, and while only the last two steps remain the guide says so outright — "the connection itself is already working" — so "2 steps left" cannot be misread as a broken connection.
- **Step numbering runs to 6.** The two new steps are counted; the optional extras (persistence, CLI, MCP bridge, desktop app) still are not, since counting choices would move the finish line as you go.

### Fixed
- **The panel guide disagreed with the chat guide about the relay.** `atlasmind.buzz.openGuide` was not passing the live subscription status into the plan, so a subscription that had genuinely gone live still read there as an unproven relay while `/buzz` in chat reported it correctly.

## [0.160.1] - 2026-07-28

### Fixed
- **"Press the button below" — there was no button.** The walkthrough's wording was written for VS Code chat, where buttons render, and shown in the AtlasMind panel, where nothing did. Each step's actions now appear as buttons there: open the relevant screen, set the agent key, or load a command into a terminal.
- **The opening line read as though the guide had lost its place.** Starting at "step 2 of 4" looks like something was skipped, when in fact step 1 was already finished. It now leads with progress — "1 of 4 done. Next: …" — and only says "step 1 of 4" when nothing is done yet.
- **A key already given to the Buzz MCP bridge is now recognised.** The bridge stores it under its own secret and inbound reads a different one, so the guide could correctly report "no key" to someone who had already supplied it. It now spots that and offers **Reuse the key from the Buzz bridge**, which validates the key before storing it.

### Security
- **A guide button names an option id, never a command.** The mapping from option to command is held extension-side and looked up, so a webview message cannot choose what runs.
- **Reusing the bridge key is checked, not trusted.** The secret id must match the Buzz bridge's exact naming, the key is validated by constructing a signer before it is stored, and neither the key nor any part of it is ever displayed or logged.

## [0.160.0] - 2026-07-28

### Added
- **Settings → MCP Servers.** Every registered server is listed with its transport, live connection status, tool count, and any error — with Enable, Connect, and Disconnect for each. Previously the only way to see whether a server was actually connected was to open a separate panel.

### Changed
- **Disabling a server now disconnects it**, rather than only relabelling it. A gate that reports itself closed while its tools remain reachable is worse than no gate.
- **The page shows what is running, not what was configured.** Status and tool counts are read live from the registry each time it renders.
- **Adding and editing a server stays in the dedicated MCP manager.** Browse-by-category, transport setup, and secret entry are deliberately not duplicated here — two implementations of one flow drift, and the one that drifts is the one nobody is looking at. The page links straight to it.

### Security
- **Each new message is validated at the runtime allowlist**, not only in the type union. A server id must be a non-empty string and the enabled flag a real boolean, because these messages start and stop processes that contribute callable tools. This is the same guard that a previous page skipped, which left every control on it silently inert.

## [0.159.1] - 2026-07-28

### Fixed
- **The setup guide opened in whatever thread happened to be in front of you.** It now gets its own **Buzz setup** session, so a walkthrough no longer lands in the middle of unrelated work under a title about something else.
- **The guide skipped straight to step 3.** Steps 1 and 2 read as finished because Buzz was enabled and the default `ws://localhost:3000` parses — but nothing had ever connected, so whether a relay existed was unknown and the guide walked past the question entirely. Until you say how you run Buzz (or a subscription actually connects), the relay step is unfinished and the guide stops there to ask.
- **The walkthrough now has real chips in AtlasMind's own panel.** "How do you want to run Buzz?" is answered by clicking **I will run Buzz on this machine** or **I have a relay URL from someone else**, and the guide reprints with only that path.

### Changed
- **Each step shows the whole sequence with its position marked**, so arriving at step 3 says why rather than looking like the guide lost its place.
- **Chips appear only where there is a genuine question.** The relay path is the one thing AtlasMind cannot work out for itself; everywhere else a chip would be a button meaning "I have read this".

## [0.159.0] - 2026-07-28

### Added
- **The Buzz setup guide is now one step at a time.** `/buzz` shows only the step you are on — numbered, with the exact commands written out — instead of the whole checklist at once. `/buzz all` still shows everything.
- **Commands can be put straight into a terminal for you.** A button loads the command into a "Buzz setup" terminal, typed but **not run** — pressing Enter stays yours, since these clone repositories and start containers.
- **The guide asks how you run Buzz and then shows only that path.** `/buzz local` gives the Docker route with real commands; `/buzz hosted` says there is nothing to install and what to paste where. Stored as `atlasmind.buzz.relayMode`, which changes guidance only.
- **The Buzz desktop app is now part of the guide.** It was missing entirely, which left the walkthrough describing a workspace with no way in — and the channel ids the later steps ask for come from the app.
- **The MCP bridge step is named as such** ("Connect the Buzz MCP bridge"), so it is findable when you are looking for it.

### Changed
- **"Guide me through Buzz setup" now opens AtlasMind's own chat panel**, not VS Code's. Routing through `workbench.action.chat.open` put a Buzz question in front of Copilot's participant picker, and — because a slash command in a pre-filled query arrives as text — straight into the general agent.
- **The local-relay path is spoon-fed:** check Docker, clone the repo, build and start, then confirm something is listening with `docker ps`. Previously it said "normally means Docker", which is not something a first-timer can act on.

### Security
- **Only commands AtlasMind wrote can be loaded into a terminal.** `BUZZ_SETUP_COMMANDS` is an allowlist checked at the command handler, because a command id is reachable from a webview and its payload cannot be assumed to be ours. Commands quoted from Buzz's documentation are shown for copying and are never wired to a button — they are somebody else's text.
- **The button still never runs anything.** It types the command and stops.

## [0.158.1] - 2026-07-28

### Changed
- **CI now publishes an installable build.** Every green run uploads the packaged `.vsix` for that exact commit as an artifact (14-day retention), so a branch can be installed into a real editor by downloading it from the run rather than being handed a file.
- **CI can be triggered manually** (`workflow_dispatch`), so a feature branch can be built on demand without opening a pull request for it.

### Documentation
- **`docs/development.md` now states what running a branch actually needs.** F5 debugging builds from source and needs no packaged build at all — but it does need `npm install` after pulling a branch that changed dependencies, which is the step that silently breaks a launch when skipped.

## [0.158.0] - 2026-07-28

### Added
- **A waiting approval now says so.** When a tool approval needs an answer and the AtlasMind chat panel is not on screen, the panel is brought forward and a notification names the action that is waiting. Previously the only reaction was repainting a webview you may not have been looking at, so a blocked run simply looked like it had hung.
- **`atlasmind.chat.revealOnApprovalRequest`** (default on) controls whether the panel takes focus. The notification is shown either way, so turning it off stops the interruption without leaving you unaware.

### Changed
- **Nothing is announced while the panel is already visible.** Interrupting someone toward something already in front of them is how prompts get trained into reflex dismissal.
- **Only newly-arrived requests announce.** The pending list also changes when a request is *answered*, so announcing on every change would have fired a notification each time you approved something.
- **A notification is shown even when the panel is revealed**, because a reveal can be missed — the window may not be focused — while a notification waits until it is dismissed.
- **The notification names the action** ("Run `npm test` in the workspace") rather than saying an approval is required, since a message that does not say what it is about gives no reason to switch to it.

## [0.157.1] - 2026-07-28

### Fixed
- **"Guide me through Buzz setup" sent your question to the general agent instead of showing the checklist.** The button opens chat with a pre-filled `@atlas /buzz` query, and VS Code hands that to the participant as prompt *text* rather than as a command. The chip renders identically either way, so nothing looked wrong — but `/buzz`, which is deliberately deterministic and uses no model at all, was instead answered by an agent holding every connected tool, which reached for an unrelated third-party one. A slash command arriving as text is now recovered and routed to its own handler.

### Security
- **A deterministic command can no longer widen its own tool surface by falling through.** The point of `/buzz` being model-free is that a Buzz question never needs an agent, let alone one holding every connected MCP tool; a silent fall-through granted exactly that. Recovery closes it, and tests now pin that every command the manifest declares has a handler, that the known-command list matches the manifest, and that the dispatch reads the recovered prompt rather than the raw one.

## [0.157.0] - 2026-07-28

### Added
- **DM a Director contact from chat.** `/buzz dm <name> <message>` resolves the person from your Director roster and sends to the Buzz key on their card — the person you added once is the person you can message.
- **Autonomous agent-to-agent replies** (`atlasmind.buzz.autonomousReplies`, off by default). With it armed, an AtlasMind agent can hold a back-and-forth loop with a Buzz agent without a dialog per message, which is the point of putting them in the same workspace.

### Changed
- **"AtlasMind drafted it" no longer means "always ask".** It means "ask, unless you have explicitly armed autonomy *and* the recipient is one you declared to be an agent *and* the rate cap has not been reached." Requiring a human click per message made an agent loop impossible; removing the gate entirely would have removed something real.

### Security
- **Autonomy is scoped to agents you declared, never to agents AtlasMind inferred.** It applies only to recipients in `atlasmind.buzz.agentBindings` — and creating that binding is already a deliberate act naming both the identity and the agent. An unbound recipient is treated as a person, who may act on what they read, and still gets a confirmation.
- **It is rate-bounded per recipient** (`atlasmind.buzz.autonomousReplyLimitPerHour`, default 10). A loop that re-fires on every inbound event is the realistic failure mode and there is no unsend. At the cap the next message **falls back to a dialog rather than being dropped**, because a silently-discarded reply looks identical to a working loop.
- **An autonomous send never becomes a standing grant.** It does not mark the recipient as confirmed, so one armed loop cannot permanently silence the dialog for a target you never approved yourself.
- **The risk this leaves is stated rather than hidden:** inbound Buzz messages are untrusted input, so an agent that reads one and replies autonomously gives its author partial influence over what AtlasMind then says to others. The setting's description says so.
- **A contact whose Buzz handle is not a public key cannot be DM'd.** A DM is addressed to an identity; a channel UUID is not one, and AtlasMind says so rather than failing at the bridge.
- **An ambiguous name is refused, not guessed.** If `/buzz dm` matches more than one person, it asks for the full name — picking the wrong colleague is not recoverable.

## [0.156.0] - 2026-07-28

### Added
- **Read and reply to Buzz from AtlasMind chat.** `/buzz read` shows the recent conversation with authors resolved to their published names, and `/buzz send <message>` posts back through the guarded bridge.
- **Emoji work in both directions.** Reactions arriving from Buzz are attached to the message they target and aggregated with counts, and emoji you type are sent exactly as written.

### Changed
- **Confirmation now fires where it adds something, instead of on every send.** A message *you* wrote, aimed at a channel *you* chose, to a recipient you have already messaged this session, sends without a dialog — you confirmed it by typing it and pressing send. A dialog there adds nothing, and dialogs that add nothing train people to dismiss the ones that matter. Everything else still confirms: anything AtlasMind drafted, any recipient AtlasMind picked, and the first message to any recipient in a session.
- **AtlasMind refuses to guess which channel to post to.** With more than one channel configured, `/buzz send` stops rather than choosing — sending to the wrong channel cannot be undone.

### Security
- **Conversations are held in memory for the session and never written to disk.** Tier 3 keeps message bodies out of `project_memory/` because it is git-tracked; this is the same rule, not an exception to it. "Derive, don't mirror" governs what is *stored*, and was never a rule against looking at a message.
- **A secret in an outgoing message is a refusal, not a redaction.** Quietly sending a redacted version would be the worst outcome available: you would believe you had sent one thing while your colleagues read another.
- **Emoji are handled as a correctness problem.** Truncation walks whole code points and backs off trailing joiners, variation selectors, and skin-tone modifiers, so a trimmed message never ends in a broken glyph or a replacement character. Reactions compare on the full published sequence, so 👍 and 👍🏽 stay distinct — they are different reactions by different people. Outbound length is counted in code points, so an emoji-heavy message is not rejected at half its stated limit.
- **The session grant is scoped to one recipient**, is never created by an AtlasMind-chosen target, and is cleared when the window closes.

## [0.155.0] - 2026-07-28

### Added
- **The Buzz setup guide now reads Buzz's own documentation.** Hand-written setup prose goes stale every time Buzz ships, and stale instructions fail in a way that looks like AtlasMind's fault. `/buzz` now quotes the current Buzz README for the steps that involve things outside AtlasMind — running a relay, installing the CLI, setting an agent key — with the source link and how long ago it was read attached to every excerpt.

### Changed
- **The split is by consequence, not by preference.** Assessing *your* machine — which gate is off, whether a key is stored, whether a relay actually answered — stays fully deterministic: those are claims about your configuration, and a model guessing at them is strictly worse than a check. Only claims about *Buzz* are fetched and cited.

### Security
- **Fetched documentation is treated as untrusted input**, because it is remote text flowing toward someone in the mood to follow instructions. Commands are surfaced as **quoted, attributed suggestions** that AtlasMind never runs and never presents as its own; prose is secret-redacted, control-character-stripped, and length-clamped; and markdown links are flattened to their text so a label cannot read like an official instruction while pointing somewhere else.
- **The origin is pinned to the Buzz repository.** This is not a general fetcher — no setting and no fetched link can redirect it at another document — and the URL is SSRF-screened regardless.
- **Offline is a supported state.** An unreachable network, a 404, or a document that says nothing useful all produce the built-in guidance instead. A setup guide that breaks without a network is worse than one that is merely less current.

## [0.154.0] - 2026-07-28

### Added
- **"Guide me through Buzz setup" on the Settings → Buzz page.** Opens the `/buzz` walkthrough in chat rather than duplicating it in the panel, so there is one plan rendered where you can ask about it.
- **The walkthrough now covers the parts that live outside AtlasMind.** Each incomplete step carries real how-to: what a local relay actually requires (you have to run one, normally via Docker — nothing in AtlasMind starts it), what a hosted relay needs instead, which kind of key the agent-key prompt wants and why an `npub` is refused, and what an empty channel list really does.

### Fixed
- **Saving a Buzz contact whose handle is not a public key no longer warns that something failed.** A channel UUID or workspace URL is a perfectly valid Buzz handle; only an *identity* is an `npub`. AtlasMind now only attempts a binding when there is one to make, and the person form says plainly that a non-key handle has no identity to bind rather than producing an error on save.
- **A refused binding no longer reads as a refused save.** The warning now says the person *was* saved and only the binding was not — the two are separate operations, and the old wording implied the whole save had failed.

### Changed
- **A valid relay URL is no longer treated as proof a relay exists.** The default `ws://localhost:3000` reads as settled while nothing may be listening on that port, and the symptom is a subscription that never goes live. The setup guide now keeps showing how to run one until a connection has actually succeeded, and says so explicitly: "the configured target rather than a confirmed one."
- **Setup guidance disappears once a step is genuinely finished**, because advice on completed steps is what makes people stop reading the steps that still matter.

## [0.153.0] - 2026-07-28

### Added
- **`/buzz` walks you through setting Buzz up.** Ask `@atlas /buzz` and you get an ordered checklist built from what is actually configured: the master switch, the relay, your agent key, the read-only subscription, then the optional extras. Each step says done, to do, blocked, or optional, names the next thing to click, and offers a button that takes you straight there.
- **AtlasMind can now tell you whether the Buzz CLI is installed.** `buzz` was added to the environment scanner's PATH probe, so a missing CLI is reported during setup rather than discovered later as a failed send.

### Changed
- **The setup walkthrough distinguishes what you need from what you might want.** Reading Buzz needs four things; the CLI, the MCP bridge, and follow-up persistence are extras. A step that is blocked only by something optional is never nominated as your next action — sending someone off to install a binary they do not need is worse than saying nothing.

### Security
- **The walkthrough is a plan, never an installer.** Every button opens a surface — the Settings page, the key prompt, the MCP manager, the download page. Nothing in it enables a gate, writes a setting, stores a secret, or connects anything. Buzz is deny-by-default in three places precisely so that turning it on is a decision a human makes; a setup assistant that flipped those switches to be helpful would remove the property they exist to provide. A test pins the action allowlist.
- **It is derived, not generated.** Every line comes from observed state rather than from a model, because a hallucinated setup step sends someone to configure something that does not exist and leaves them trusting a broken result.
- **It reports refusals with the reason.** A plaintext relay URL pointing off-machine is shown as refused *and why* — plaintext would expose colleagues' messages and the login challenge in transit — rather than as a step that simply will not go green.

## [0.152.0] - 2026-07-28

### Added
- **Pick a Buzz handle instead of pasting one.** The Director's Add / Edit person form now offers the Buzz identities AtlasMind has actually observed, shown by the name each identity published for itself. Choosing one fills the Handle field. Typing a key by hand still works — this saves the paste, it is not the only way in.
- **Your own Buzz identity needs no lookup at all.** It is derived from the agent key already in SecretStorage and offered as "You" at the top of the picker, so the one handle AtlasMind can compute is no longer one you have to paste.
- **Names come from the relay.** AtlasMind now reads NIP-01 profile metadata (kind 0) for the identities it has seen, so the picker shows "Joel" rather than `dcbe44bf896f…`. Identities with no published name are labelled as such rather than given an invented one.

### Security
- **No key is ever derived from a person.** There is no function from a name to a public key; constructing one would produce a plausible key belonging to a **different real person**, silently routing a colleague's work to a stranger. Every option in the picker is evidence — a key that arrived on the wire, and a name its own owner published.
- **Display names are untrusted input.** A name is remote-controlled text rendered in AtlasMind's UI, so it is secret-redacted, control-character-stripped, and length-clamped as it enters the directory — not as it leaves, where one missed call site would be a hole. Malformed profile JSON yields no name rather than an error.
- **The observed-identity roster is never persisted.** A record of who spoke and when is exactly what `project_memory/` must not accumulate, being git-tracked. The directory lives in memory for the session and is rebuilt from the subscription.
- **The stored agent key is read only when Buzz is enabled**, and only its public half ever leaves the derivation. A failure there is silent by design, so an unusable key can never become an error message containing it.
- **Kind 0 was verified against a live relay, not assumed.** It is the standard Nostr metadata kind and is **absent from Buzz's own registry**, so whether a Buzz relay serves it was an open question — the same shape of question that produced the kind-9/40002 mistake. Confirmed present, carrying `display_name`, before any code depended on it.
- **Profile lookups are bounded and debounced.** They are author-scoped (a kind-0 filter with no authors would pull every profile on the relay), capped at 50 authors per request, and coalesced so a busy channel re-subscribes once rather than per message. The lookup reuses the authenticated connection rather than opening a second one, and the message subscription is preserved alongside it so inbound work never stops.

## [0.151.2] - 2026-07-28

### Fixed
- **The Settings → Buzz page did nothing.** Every control on it was inert: the switches appeared to toggle and the text fields accepted input, but nothing was ever written to configuration and neither button worked. The new message types were declared and handled but never added to the runtime allowlist that guards the webview boundary, so all of them were dropped before reaching their handler. The page type-checked and linted cleanly throughout. Now allowlisted with per-type payload validation, and covered by tests that call the guard directly rather than checking that the source mentions each message.
- **Open the Director roster** now opens the Project Dashboard on the Director page. Same cause as above.
- **The AtlasMind agent picker is hidden on non-Buzz channels**, instead of showing on every person regardless of channel. It was correctly marked hidden, but the row is a grid container, and that rule outranked the browser's default styling for the `hidden` attribute — so it stayed fully visible. The placeholder line that stood in its place has been removed rather than replaced.

## [0.151.1] - 2026-07-28

### Fixed
- **A new test failed on Windows because it pinned Unix line endings.** One assertion matched a multi-line import block as a literal `\n`-joined string, so it could never match a CRLF checkout — the assertion was wrong, not the code. It now matches the import without pinning line endings, verified against a CRLF copy of the sources. Nothing shipped to users changes.

## [0.151.0] - 2026-07-28

### Added
- **Buzz has its own Settings page.** Every `atlasmind.buzz.*` switch is now visible and clickable under **Settings → Buzz**: enable Buzz, set the relay URL, allow a remote relay, subscribe to inbound, choose which channels to watch, and record follow-ups to project memory. Previously they could only be reached by hand-editing settings JSON.
- **Bind an AtlasMind agent to someone's Buzz identity while adding them.** The Project Dashboard → Director "Add / Edit person" form now offers an **AtlasMind agent** picker when the person's channel is `buzz`. Pick an agent and work arriving from that Buzz identity is routed to it. The binding also shows on the person's card, so the roster answers "who handles their messages" at a glance.
- **Set the Buzz agent key and jump to the Director roster** straight from the Settings → Buzz page.

### Changed
- **The nested Buzz gates are visible as nested.** A switch whose parent is off is shown dimmed and disabled rather than looking live, while still displaying the value that is actually stored — a stored `true` hidden behind an off parent would misreport the configuration.

### Security
- **The Director's agent picker writes through the same validation as a hand-edited setting.** Binding by click and binding by hand share one pure helper, so the UI cannot invent its own merge rules: a mistyped `npub` is refused with a reason rather than coerced onto a different identity, an `nsec` is refused by name, and a binding naming an agent that does not exist is rejected instead of silently pointing at nothing.
- **`atlasmind.buzz.agentBindings` remains the single source of truth.** The roster is a convenience editor for that setting, not a second store, so a binding made in the dashboard and one typed into settings can never disagree. Bindings are stored in settings rather than in the roster because `project_memory/` is git-tracked and the binding is a local routing preference.
- **Editing one binding leaves every other binding untouched**, and the setting keeps whichever shape the user already wrote — a hand-authored record does not silently become an array.
- **No generic command runner was added to the webview.** The two new buttons post named messages mapped to fixed commands; a message carrying an arbitrary command id would be an injection surface.
- **The relay URL is validated at the boundary**, so an unusable value surfaces immediately instead of appearing later as a connection failure. The separate rule refusing plaintext to a remote host still lives at the transport, where wiring cannot bypass it.

## [0.150.0] - 2026-07-28

### Added
- **Buzz inbound is wired up and can be switched on (Buzz integration, Tier 3).** With `atlasmind.buzz.enabled` and the new `atlasmind.buzz.inboundEnabled`, AtlasMind holds a live read-only subscription to your Buzz relay, authenticates to it, stays connected across drops, and turns channel activity into work items. `atlasmind.buzz.inboundChannels` scopes it to specific channels.
- **Assign AtlasMind agents to Buzz agents.** `atlasmind.buzz.agentBindings` maps a Buzz identity to an AtlasMind agent id, so inbound work from a known Buzz agent lands with the right specialist instead of arriving unattributed — a Buzz build-bot's messages can go to your DevOps agent. Keys accept either the `npub…` or hex form.
- **`AtlasMind: Set Buzz Agent Key`** stores (or removes) the key used to authenticate to the relay, in the OS secret store.

### Security
- **Three gates, all off by default.** Inbound needs both `buzz.enabled` and `buzz.inboundEnabled`, so upgrading never starts a network subscription. *Recording* what arrives needs a third opt-in, `buzz.autoCreateFollowUps` — project memory is git-tracked, so writing to it from a network event is a decision to make deliberately, not one to inherit. While that is off, inbound activity is reported without being written.
- **A mistyped Buzz identity cannot bind work to the wrong agent.** Binding keys are checksum-validated, so a mistyped `npub` is rejected rather than silently resolving to a different identity; a secret key pasted where a public one belongs is refused outright. Unusable bindings are reported rather than dropped silently, and an unbound identity stays unassigned — an agent is never guessed.
- **Agent bindings are a local routing preference, not identity.** Buzz keeps ownership of the keypair, the directory, and the authorship ledger; AtlasMind only records a preference.
- **The wake lock is held only while genuinely connected**, and released on stop. It remains deny-by-default in its own right, so holding a reason does nothing unless keep-awake is enabled.
- **Recorded follow-ups cannot duplicate.** They merge by an id derived from the Buzz event, so the deliberate reconnect replay overlap and repeat sightings update nothing, with a per-batch cap so a busy channel cannot flood project memory.

## [0.149.2] - 2026-07-28

### Fixed
- **Buzz inbound was listening on the wrong event kind and would have received nothing.** Buzz's own registry defines two channel-message kinds and reads as though the newer one supersedes the older; a live relay proved otherwise, storing only the older kind. The wrong choice fails in the worst possible way — the connection authenticates, subscribes, and reports itself healthy while silently receiving no messages ever. Both kinds are now subscribed and understood, so either deployment works. Found by querying a real relay for what it actually stores rather than inferring it from source.

## [0.149.1] - 2026-07-27

### Fixed
- **Buzz authentication now signs once per connection.** An authenticating relay normally prompts twice on connect — with its own challenge, and again when refusing the optimistic subscription — and both prompts produced a signature, because the "already authenticating" guard was only set after signing finished rather than before it started. One signature is now produced and one frame sent.

## [0.149.0] - 2026-07-27

### Added
- **Buzz inbound can authenticate (Buzz integration, Tier 3).** BIP-340 Schnorr signing for NIP-42, filling the seam `BuzzClient` left open. Running the client against a real Buzz relay showed it refuses to serve a subscription until the client authenticates, so this is what makes a live inbound subscription possible at all.
- **A deliberately small dependency, loaded only when used.** `@noble/secp256k1` is 170 KB with no dependencies of its own — chosen over the full `@noble/curves` suite (1.87 MB plus an 889 KB dependency) because Nostr needs exactly one curve. It is imported the first time a signature is needed, so anyone who never uses Buzz pays nothing at activation. Node's built-in crypto supplies the hashing, so nothing further is pulled in.

### Security
- **A remote Buzz relay must be encrypted.** A Buzz workspace need not be local, and an unencrypted socket to a **hosted** relay would expose colleagues' message content and the authentication challenge in transit, so it is now refused outright. Loopback is exempt because it never leaves the machine. The rule sits at the transport layer, so no future wiring can reintroduce it, and it matches what the outbound path already enforced.
- **A mistyped agent key fails loudly instead of signing as someone else.** An `nsec` is decoded with its bech32 checksum verified, and an `npub` — a public key, and the likely mistake — is rejected by name. The key is validated when the signer is created rather than mid-handshake, every signature is checked against the derived public key before the event leaves the signer, and secret material never reaches a log, an error message, or a serialised value.
- **Cross-validated against the published specification.** The bech32 decoder and the signing library are tested against the canonical NIP-19 key-pair vectors: decoding one and deriving the other must reproduce the spec's own values.

## [0.148.1] - 2026-07-27

### Fixed
- **A stopped Buzz subscription is now genuinely inert.** Frames already in flight when the client stopped were still being handled, so a relay that repeated an `auth-required` refusal could restart the authentication path the client had just terminated on — producing a stopped → authenticating → stopped cycle and reporting the same terminal error twice. Found by running the client against a real Buzz relay; frames arriving after a stop are now ignored, and a terminal refusal is reported once.

## [0.148.0] - 2026-07-27

### Added
- **The Buzz inbound subscription itself (`BuzzClient`).** AtlasMind can now hold a live connection to a Buzz relay — connect, authenticate, subscribe, receive, and on a drop, back off and resume where it left off. It drives the Tier-3 foundation modules and owns only the state machine: it parses no frames, invents no delays, and stores no conversation.
- **A real transport, with no new dependency.** `ws` was already an AtlasMind dependency, so inbound sync adds none. The relay URL is accepted in either form — the CLI-style `http(s)` base or `ws(s)` — so a single `atlasmind.buzz.relayUrl` setting serves both the outbound bridge and the inbound socket, and the two halves cannot drift apart.
- **Tested against a real WebSocket server, not only a mock.** 26 unit tests drive the state machine through a fake socket with an injected clock (deterministic, no timers), and 9 integration tests run the real client against a real in-process WebSocket server — covering the genuine handshake, real ping/pong, a real NIP-42 exchange, and a hard TCP drop with no closing handshake, after which the client reconnects on its own.

### Security
- **The inbound subscription is read-only by construction.** It sends only subscribe, close, authenticate, and keep-alive frames — never an event — so a read connection cannot become a write path to Buzz. A test asserts it.
- **Nothing connects until asked.** Constructing a client opens no socket; starting it is an explicit, separate step that the caller gates on the inbound toggle.
- **A relay demanding authentication stops with an explanation.** Schnorr signing is a deliberate seam AtlasMind has not yet filled, so an authenticating relay produces a typed, named stop rather than a silent failure or an endless reconnect loop. The same applies when signing fails or the relay rejects the signature.
- **Malformed frames are counted and ignored, never acted on**, and a socket that cannot even be created is treated as a failed attempt and backed off rather than throwing into the extension host.

## [0.147.0] - 2026-07-27

### Added
- **The protocol foundation for reading Buzz activity back into AtlasMind (Buzz integration, Tier 3).** Complements the Tier-1b outbound bridge with the read side. Buzz is Nostr-based, so its transport is a published open specification rather than a Buzz invention — which is why this layer could be built and fully tested without a live relay. Three new pure, `vscode`-free services: `BuzzProtocol` (NIP-01 framing, NIP-42 auth, and Buzz's event kinds), `BuzzConnectionPolicy` (liveness and reconnect), and `BuzzInboundDerivation` (turning activity into work items). They are not yet wired to a socket.
- **Connection presence — the half a wake lock cannot provide.** Keeping the machine awake does nothing when the WebSocket silently drops, so AtlasMind now has a keep-alive/liveness policy, capped exponential-backoff reconnect with jitter, and a resume plan that re-subscribes tracked filters and re-announces presence. A fresh socket keeps none of the previous connection's state, so reconnecting alone would leave an agent silently absent while appearing connected.
- **Buzz's event kinds, read from its own registry** at the same pinned tag the CLI bridge uses — including the two traps that are easy to get wrong: channel metadata is kind 39000 (not the legacy 41), and a channel message is kind 40002 (not 9, nor the earlier 10002). Subscribing to the wrong one yields a connection that works and receives nothing, so both are asserted in tests.

### Security
- **External conversations are derived, never mirrored.** Project memory is git-tracked, so an inbound message becomes a follow-up carrying a **pointer back to the Buzz thread** and a short sanitised title — never the message body, which would commit colleagues' conversations into your repository. Buzz remains the message system-of-record. Text that does cross the boundary is secret-redacted (`nsec` keys, long hex, `sk-`/`ghp_`/`xoxb-` tokens), stripped of control characters that could corrupt a Markdown mirror, and length-clamped.
- **Relay input is treated as untrusted.** Frame parsing never throws: oversized, non-JSON, and structurally invalid frames degrade to a typed unknown frame, and event validation returns nothing rather than coercing a malformed event into a half-trusted one. Signature verification is explicitly *not* performed client-side — it is the relay's job under NIP-42 — so a structurally valid event is never mistaken for an authenticated one.
- **A rejected key is not retried.** A relay refusal meaning "authenticated, but this key is still not allowed" stops reconnection instead of looping, since retrying cannot change the outcome. The recoverable "not authenticated yet" case reconnects and re-runs authentication.
- **A kind-less relay query is refused at construction.** Buzz rejects a filter without `kinds` with a 403, which is confusing to debug at runtime, so subscriptions cannot be built without them.
- **Thread links keep the existing allowlist.** Built only from an `https` base with the channel id percent-encoded, so a crafted pointer can neither produce a launchable non-https URI nor traverse the path.

## [0.146.0] - 2026-07-27

### Added
- **Buzz Tier 1b live communications.** AtlasMind now ships a bundled, communication-only stdio MCP server (`buzzCommsServer.ts`) backed by an isolated, unit-tested `BuzzCliBridge`. The guided MCP catalogue configures the official pinned Buzz CLI v0.4.26 and exposes only bounded channel listing, channel posting, thread reading, and direct messaging—never Buzz shell, file-edit, workflow, repository, or administration tools.
- **Guided Buzz connector setup.** The MCP wizard stores `BUZZ_PRIVATE_KEY` and an optional NIP-OA `BUZZ_AUTH_TAG` in VS Code SecretStorage, carries only non-secret relay/CLI metadata in the saved server config, and launches the extension-bundled bridge through an extension-path template.

### Changed
- **Director connector routing is provider-aware.** Messaging capabilities remain separate by contact-link kind and Buzz delivery shape, so a Buzz recipient cannot be handed to Slack or Teams merely because another connector's tool ranked first. Buzz channel UUIDs route to `buzz_post_message`; 64-character public keys route to `buzz_send_dm`.
- **Buzz's published v0.4.26 CLI contract is now the pinned integration seam.** The roadmap and documentation now reflect the official JSON commands and their HTTP(S) CLI relay base, while preserving the boundary that Buzz owns identity/messaging and AtlasMind owns reasoning/execution.

### Security
- **The Buzz bridge fails closed.** It requires `atlasmind.buzz.enabled`, rejects remote relays unless `atlasmind.buzz.allowRemoteRelay` is enabled, requires TLS for remote relays, rejects credential/query-bearing relay URLs, verifies the pinned v0.4.26 communication command/flag contract before the MCP handshake, invokes the CLI without a shell, sends message bodies only over stdin, bounds input/output/time, validates UUIDs/event IDs/pubkeys, and redacts private keys/authorization grants from errors. Director sends still require the per-project `outboundEnabled` gate and an explicit modal confirmation.

## [0.145.7] - 2026-07-27

### Security
- **Source-control and VSIX packaging now exclude AtlasMind memory archives and variants.** Git ignores the local `project_memory_old/` backup, while the package boundary rejects every `project_memory*` directory, preventing workspace memory from entering a commit or Marketplace release.

## [0.145.6] - 2026-07-27

### Fixed
- **Reasoning-only project plans now hand execution to tool-capable models.** Planner output that omits or invents disabled skills is normalized to the smallest enabled repository-evidence tool set for non-synthesis subtasks. If a selected runtime explicitly reports that tools are disabled or unavailable, AtlasMind immediately reroutes the subtask and never counts the refusal as completed work.
- **Project execution-cap recovery now renders as real chat choices.** The custom chat panel retains `needs-input` metadata from `/project`, asks whether to use the suggested cap for this run or permanently, and offers a keep-partial-result chip. Temporary increases are scoped to the retry and restore the prior runtime limit afterward.
- **Custom project runs no longer duplicate their transcript on completion.** The project stream remains owned by its original assistant bubble instead of recording a second user/assistant pair after the run.

## [0.145.5] - 2026-07-27

### Added
- **Project-run proposals now end in an actionable chat card.** Interactive chat offers **Start run**, **Save for later**, and **Cancel**; saving creates a reviewed preview in Project Run Center, while Autopilot can still auto-start when `atlasmind.autoStartProposedProjectRuns` is enabled. Native chat exposes the same three choices as follow-ups.
- **Local-model savings now appear in the Cost Dashboard summary.** The Efficiency group shows estimated avoided cloud spend and local request count, while the existing detailed panel keeps the per-model token and reference-rate breakdown.

### Fixed
- **Removed or deprecated provider models no longer return after refresh.** Provider-confirmed removals are retained as session tombstones across successful refreshes, stale discovery results cannot resurrect them, and a successful empty provider catalog now prunes old entries instead of keeping them indefinitely.
- **Assessment-to-run handoffs no longer stop abruptly.** The shared agent completion rubric requires an explicit project-run offer whenever assessed work needs a separate autonomous execution pass, allowing chat surfaces to render the decision controls reliably.

## [0.145.4] - 2026-07-26

### Added
- **Security reviews now have a durable register service ready for dashboard integration.** `SecurityReviewManager` persists findings and review runs across secrets, runtime boundaries, dependencies, and permissions to JSON, a human-readable Markdown mirror, and a capped audit history.
- **Security-review scoring accounts for evidence, coverage, and freshness.** Open findings are weighted by severity, exploitability, and confidence; unreviewed areas cannot count as assurance, and reviews decay after 45 days.

### Security
- **Security-review records treat model output and cited paths as untrusted.** Malformed structured output safely produces no findings, strings and enums are bounded, unknown statuses remain open, and absolute or traversal paths are rejected. The register records evidence and decisions only; it does not scan for vulnerabilities or gate commits, promotions, or releases.

## [0.145.3] - 2026-07-26

### Added
- **The chat composer status now names the model serving the active request.** Routing and failover updates are reflected beside live progress just above the input, so the operator can see the current model without opening response details.
- **Local-model savings are estimated per model and totalled.** The Cost Dashboard groups genuinely local requests by model, maps each model to an explainable catalog-backed cloud reference, shows token/request usage and potential savings for every comparison, and reports the combined estimate.

### Fixed
- **The Cost Dashboard time-period selector no longer occupies or obscures the chart.** It is now a compact open/close disclosure in a toolbar above the plot; opening it expands the toolbar instead of covering line-chart peaks.
- **Free cloud requests are no longer counted as local-model savings.** Only records attributed to the local provider or a `local/` model id enter the estimate.
- **The README “What’s new” section now describes everything added since the last Marketplace publication.** Its v0.145.3 summary names v0.145.0 as the published baseline and includes the v0.145.1 security-review foundation and v0.145.2 guarded-commit timeout fix alongside the current model/cost UI work.

## [0.145.2] - 2026-07-26

### Fixed
- **Git commits no longer fail at AtlasMind's 15-second generic tool deadline while repository hooks are still running.** The dedicated `git-commit` skill now gives its subprocess a bounded 120-second window, with a 125-second outer deadline so a timed-out process can report its failure before orchestration stops waiting. Multi-word messages continue to be passed as one typed argument without shell parsing.
- **The README release-heading check now follows `package.json`.** Version bumps no longer require a second hard-coded test edit merely to keep the "What's new" heading current.

## [0.145.1] - 2026-07-26

### Added
- Add security review types to support ethics, legal, and commercial oversight advisors:
  - `SecurityReviewArea`, `SecuritySeverity`, `SecurityExploitability`, `SecurityConfidence` types
  - `SecurityFindingStatus`, `SecurityFinding`, `SecurityAreaRun`, `SecurityReviewConfig` interfaces
  - `SecurityReviewHistoryEntry` interface for audit trail

## [0.145.0] - 2026-07-26

### Added
- **Agent management is now discoverable from the main Settings workspace.** A first-class **Agents** page sits under Capabilities with registered, enabled, built-in, and custom counts plus direct links into the dedicated manager, models, and testing; the Settings overview also includes a **Manage Agents** action. Both routes cross the webview boundary through a validated `openAgentPanel` message.
- **The Agents page exposes the effective global guardrails verbatim.** The read-only, selectable policy block is rendered directly from `IMMUTABLE_GUARDRAILS`, identifies its runtime provenance, and explains its non-overrideable precedence so operators can inspect the safety baseline applied to every routed agent.
- **Personality Profile is discoverable from the workflows it influences.** Settings Overview now carries a dedicated quick-action card, and Models & Integrations links to the same guided profile beside provider and specialist surfaces. Both use a validated webview message and the existing `atlasmind.openPersonalityProfile` command.
- **Custom-agent completion policy is editable without hand-editing storage.** The grouped editor exposes up to 12 observable completion-rubric requirements and 12 bounded incomplete-result retry patterns. Built-in criteria remain inspectable and read-only.

### Changed
- **Manage Agents is a focused master/detail workspace instead of three competing pages.** The large hero, duplicated summary cards, Overview / Directory / empty Editor tabs, detached global search, wide table, and duplicated auto-update cadence are gone. Search and enabled/custom/built-in filters stay beside the selected agent, survive host-side re-renders, and lead directly into grouped Identity, Instructions & completion, Skills, Models & budget, Testing, and Maintenance sections. The global cadence appears once under **Defaults & automation**.
- **Agent webview actions now validate their complete payload shape at the extension-host boundary.** Save, select, delete, enablement, reset, and cadence messages reject missing or mistyped fields before they can touch registry or configuration state.
- **The README now sells the product before explaining its implementation.** A customer-facing story, workflow, trust case, and non-technical **What's new in 0.145.0** replace the competitor feature matrix and long internal inventories; concise command, configuration, and project-structure references now route readers to the detailed docs. The comparison page and its wiki navigation entries have also been removed.

### Fixed
- **The Settings navigation allowlist now comes from its canonical page registry.** Newly added pages such as **Agents** no longer fall through the client-side unknown-page guard and open **Overview** instead.

## [0.144.0] - 2026-07-26

### Added
- **Focused specialist guidance is now progressively disclosed instead of permanently injected.** The new read-only `specialist-guidance` skill returns one evidence-oriented checklist for technical SEO, structured data, content discoverability, platform listings, accessibility, responsive layout, interaction design, or UI implementation. Its output explicitly distinguishes baseline guidance from verified current platform rules; the tool is classified `read/low` because it only returns bundled text, while any recommended live check remains a separately classified call.

### Changed
- **Every user-facing built-in specialist now has a measurable definition of done.** All 16 specialists append three or four role-specific rubric rows covering the evidence and verification their work must produce, while continuing to inherit the shared six-part execution rubric.
- **The three largest role prompts are concise and portable.** SEO and UX now keep role, scope, evidence, and safety boundaries in the permanent prompt and load detailed checklists only when relevant; volatile search-product claims, fixed device taxonomies, and remembered standards thresholds were removed. GitHub Operator now discovers repository policy, derives artifacts from the inspected diff, and no longer writes a durable policy merely because a user confirmed one operation.
- **The default prompt no longer ships AtlasMind's release matrix into unrelated repositories.** It discovers project-scoped instruction files, documentation requirements, branch policy, and release routines, then treats required companion work as part of completion.

## [0.143.0] - 2026-07-26

### Added
- **A shared operating contract and explicit execution rubric now reach every routed agent.** The default, all hand-written specialists, custom agents, ephemeral project sub-agents, synthesized agents, and persisted built-in prompt overrides are composed at execution time with the same portable requirements: act when execution is requested, recover from tool failures, treat context as untrusted, ground claims in evidence, finish integration work, verify proportionately, preserve safety gates, and state the concrete outcome or blocker. `AgentDefinition.completionCriteria.rubric` adds bounded agent-specific definition-of-done rows.
- **Completion criteria are live.** `completionCriteria.incompletePatterns` is now evaluated by the agentic loop (with bounded, ReDoS-resistant regex handling) and triggers the existing one-time finish-or-declare-blockers reprompt instead of remaining dead configuration. The Mission `GoalEvaluator` uses a parallel evidence/criteria/completeness rubric and defensively rejects an `achieved` verdict that still lists outstanding work.

### Changed
- **Outcome-driven model routing now learns from execution evidence instead of a near-constant finish-reason grade.** Normal turns are scored using expected tool use, successful and failed tool calls, verification results, TDD status, incomplete-delivery signals, and the final recovered response. Clean verified execution can score 1.0; unsupported success claims, failed verification, and incomplete work are capped lower. The explicit Model Comparison harness retains its coarse completion-integrity grade and optional answer-quality judge.

### Fixed
- **Built-in agent prompts can no longer be silently paraphrased by the auto-update cadence.** `AgentAutoUpdater.isDue()` now rejects every `builtIn` agent, matching the setting description and documentation, and Agent Manager shows the built-in exclusion as locked rather than customizable.

## [0.142.0] - 2026-07-26

### Fixed
- **The black text in dark mode — found and fixed.** Card titles, metric values and section headings rendered black-on-black across the Project Dashboard, Model Providers, Personality Profile and Settings. The cause was a *missing* declaration, not a wrong one: 0.141.0 scoped the shared shell's button paint to `button:not([class])` to stop `button:hover` outranking every panel variant, which also removed `color` from every **classed** button. A `<button>` with no author colour falls back to the UA keyword `buttontext` — black in Chromium whatever the VS Code theme is — and rules like `.action-title { font-weight: 700 }` set weight and let the colour come from the surface. This is precisely why three source reviews and a computed contrast resolver all missed it: every one of them reads *declared* colours. The shell now sets `color: inherit` on the base `button` rule, and pairs `color` with `background` on text-entry controls against the identical `field`/`fieldtext` hazard.
- **The hero badge chevron rendered as tofu** on the Model Providers and MCP panels — the `▾` had lost its UTF-8 lead bytes in transit, leaving a raw U+0015 control character followed by a literal `BE`. All three hero badges now use the encoding-proof CSS escape `\25BE`, and a test rejects any C0 control character in webview source.

### Changed
- **Risk and Data privacy now count toward the operational score whether or not you have engaged with them.** Risk was previously omitted until an advisor had run, so shipping it could not drop anyone's score overnight. That protected the number at the cost of what the number is for: with the component absent, a project never assessed scored *identically* to one assessed and found clean — the single comparison the score most needs to make. Both categories are now always present and score zero until addressed (Risk 15 pts, Data privacy 12 pts), with the detail line naming the points as unclaimed and a recommendation explaining how to claim them. The denominator stays derived rather than hard-coded, so a perfect project still normalises to 100.
- **Existing projects will see the headline score fall** until the advisors are run and the privacy gate is configured. That drop is the intended signal, not a regression.

## [0.141.10] - 2026-07-26

### Added
- **A computed contrast check for panel text** (`tests/views/themeContrast.test.ts`). Panel colours are built from chained custom properties and `color-mix()`, so a declaration-level search cannot tell whether the result is legible — two reviews of the source missed it. This resolves every `color` declaration to a concrete RGB value under real VS Code Dark Modern values and measures WCAG contrast against the background it sits on. Two modelling details are load-bearing: `transparent` inside a `color-mix` composites over the *page* background rather than letting the other colour win, and only the dark cascade branch counts — including `body.vscode-light` inverts `--tint-away` and makes every tinted accent read as near-black. Getting either wrong produces confident nonsense, and both did before they were fixed.
- Result: **no near-black text on a dark surface anywhere in the panels**, and only three rules below a 2.4:1 floor — all deliberate light-fill badges. The reported black text is therefore not in panel CSS.

## [0.141.9] - 2026-07-26

### Added
- **The Risk board now states what each advisor actually reviewed.** A clean result is only meaningful if you can see what was looked for — “0 open findings” otherwise reads as “nothing was checked”. Each domain card carries a disclosure listing that advisor’s scope, sourced from its own agent definition rather than restated on the page so the two cannot drift, and it **opens itself** when a domain has run and found nothing — exactly the case where the question arises.

### Fixed
- **The Ideation panel had lost the hero title bar the other dashboards share.** Its topbar was grouped with the generic flex rows (10px gap, centre-aligned), so it read as a toolbar rather than the page title — and retiring the hero explainer grid in 0.141.0 left the panel with no visual anchor at all. It now uses the same hero treatment as the Project Dashboard, Cost Dashboard and Run Center.

## [0.141.8] - 2026-07-26

### Fixed
- **Website Studio colour editing was one-way and partial.** Moving a colour picker wrote into its paired hex field, typing a hex never moved the picker back, and the token swatches above were rendered server-side so neither updated them until a save and re-render. Editing is now two-way and the swatches follow live; a partial hex is ignored until it is complete rather than flickering mid-typing.
- **Chat open-file chips computed which file was the active editor and had nowhere to show it.** `.active` was applied with no rule behind it, so every open file looked identical.
- **A chat link with a rejected scheme still looked like a working link.** `sanitizeLinkHref` rewrites a disallowed href to `#`, but the anchor kept its link colour and underline — indistinguishable from a link that simply did nothing. Blocked links now render inert, with a title explaining which schemes are permitted.

## [0.141.7] - 2026-07-26

### Fixed
- **Run Center action buttons announced themselves only on hover.** The buttons filling a run card, a file chip or the action strip carry no border and no fill, so nothing at rest said they were clickable — and `.file-chip` compounded it by inheriting the shared card chrome, making a live chip look exactly like an inert card. They now carry an at-rest chevron that brightens and shifts on hover, matching the Project Dashboard treatment.
- **Clickable summary badges sat beside inert ones with identical shape, border and fill** on the MCP and Model Providers panels — three visually identical pills where only some filter anything. The interactive ones now carry a caret.

## [0.141.6] - 2026-07-26

### Fixed
- **Dragging a card in any non-default Ideation lens teleported it.** A projected lens (`projectCardsForLens`) renders *copies* at computed column/row coordinates while the stored card keeps its own `x`/`y`. The drag handler read the stored origin, so the first pointer move jumped the card to somewhere unrelated — and any drop would have been overwritten by the next projection regardless. Card positions are the user’s to set only on the free-form board, so dragging is now disabled in projected lenses and the handle no longer offers a grab cursor there.
- **Every AI-instruction file path in Settings was unclickable.** Those buttons are injected into `#aiInstructionList` by `innerHTML` *after* a scan returns, but `[data-open-file]` was wired by a one-shot `querySelectorAll` at load, which never saw them. Now delegated.

### Removed
- The chat **speech-input button**. It rendered as a fully live control — `aria-pressed`, a `.listening` state, a pulse animation — and had zero references in any script: in-chat dictation is not implemented, and the button only implied it was. Its orphaned styles and keyframes are removed with it. Speech input remains available in the Voice Panel.

## [0.141.5] - 2026-07-25

### Changed
- **The chat status line moved to where the things it narrates actually are.** `#status` sat at the very top of the panel while the thinking indicator, the streaming reply and the send state are all pinned to the bottom — on a tall transcript it was scrolled off-screen entirely. It now sits directly above the composer and carries `role="status"`, so its updates are announced rather than silently repainted.

### Removed
- Dead chat search markup (`#composerSearch`, `#searchInput`, `#searchResults`). Search mode itself works — through controls created dynamically over the prompt input — but this static block was leftover from an earlier design and had no reference anywhere in the panel script.

## [0.141.4] - 2026-07-25

### Fixed
- **Both MCP hero-badge filters were broken, in opposite ways.** They filter by stuffing a term into the server search box, which substring-matches a per-card haystack. `connected` is a substring of `disconnected`, so the “connected” filter showed exactly the servers it was meant to exclude; and `enabled` was never in the haystack at all, so that badge matched nothing. Each card now carries prefixed `status:` and `state:` tokens, which cannot collide as substrings.
- **The Ideation inspector’s score sliders gave no feedback while dragging.** Each renders a numeric readout beside it, but nothing updated the readout on input — the number only caught up on the next full re-render.

## [0.141.3] - 2026-07-25

### Fixed
- **The chat font-size buttons forgot their setting every time the panel reopened.** `adjustChatFontScale` wrote only to `vscode.setState`, which dies with the webview. The host already handled a `saveFontScale` message and already seeded the scale from `globalState` on load — the webview simply never told it.
- **The chat model dropdown could not be dismissed by clicking away.** Its close-on-outside-click handler was registered when the *message rendered*, not when the menu opened, and removed itself on the first document click — which in practice happened long before the menu was ever used. It is now armed on open, released on close, and also closes on Escape.

## [0.141.2] - 2026-07-25

### Fixed
- **Panel accent text was built for a dark theme and washed out on a light one.** Panel CSS repeatedly lightens an accent for legibility — `color-mix(in srgb, var(--accent) 80%, white 20%)` — which moves the colour away from a dark page and *toward* a light one, dropping contrast exactly where it is needed. VS Code exposes the active theme as a `vscode-light` / `vscode-dark` / `vscode-high-contrast` class on the webview body, and **nothing in the codebase used it**. The shared shell now defines `--tint-away` (white on dark, black on light) and `--tint-toward`, and the 35 text colour-mixes across the Dashboard, Ideation, Run Center and Chat mix toward those instead of a literal — so an accent always moves away from the page background whichever theme is active.
- Skill Scanner severity badges pinned salmon and amber text over themed validation backgrounds, which is legible on dark and low-contrast on light; they now use the matching themed foregrounds.
- Three CSS custom properties were used but never defined (`--atlas-panel-fg`, `--panel-border` ×5, `--dash-fg`). An undefined custom property invalidates the whole declaration, so those rules were silently vanishing rather than failing loudly.
- Project Dashboard attention badges pinned a fixed text colour (`#1c1400`, `#fff`) over a solid tone fill — any fixed value is wrong in one of the two themes. They now use a translucent tint of the tone with the tone itself as text.

## [0.141.1] - 2026-07-25

### Changed
- **The Project Run Center buried its own primary input.** `#goalInput` — the box you type a goal into — sat below the saved-routine runner, a 34-line hero grid and the workflow stepper: roughly four screens of chrome before the thing the panel exists for. The order now follows the job it describes: the stepper that names the current phase, then the goal input and plan/execution workspace, then posture metrics as context, then run history. The routine runner is a separate errand and closes the page inside a collapsed `<details>`. Verified as a pure permutation of the existing markup.

### Fixed
- Collapsible sections in the Run Center removed the native disclosure triangle **twice** — `list-style: none` and `::-webkit-details-marker` — without putting anything back, so a section that could be expanded gave no sign of it. They now carry a rotating chevron.
- Filtering the run history to nothing reported “No project runs recorded yet”, which reads as data loss rather than an active filter. An empty search result now says so and names how many runs are hidden.

## [0.141.0] - 2026-07-25

### Added
- **The Project Dashboard's 14 tabs are now grouped and ordered around how a manager reads a project.** The previous order was archaeological — it recorded the sequence features shipped, not any reading order. Gap Analysis sat eight tabs away from the Overview card that advertises it, Roadmap was buried behind four engineer-facing pages, Risk was read *after* Delivery ("should we ship" after "can we ship"), and Delivery physically split the three safety pages. The tabs are now five labelled clusters — **Where we stand** (Overview · Score · Gap Analysis), **The work** (Roadmap · Director · Runtime), **The code** (Repo · Testing), **Is it safe** (Security · Privacy · Risk), **Ship & record** (Delivery · Documents · SSOT) — and each cluster wraps as a unit so a group is never split across rows. The toolbar is sticky, so switching tabs from the bottom of a long page no longer means scrolling back to the top.
- **Attention badges on the tabs.** Every count was already in the same snapshot on the same render pass, but none of it reached the nav, so finding the red page meant opening all fourteen. Tabs now carry a count for open gaps (red when any are P1), open risk findings, overdue follow-ups, documents due for review or missing, blocked memory entries, unhealthy providers, artifacts needing attention, and pending file changes. The visual badge is a bare number; the meaning is carried in words on the accessible name (`Risk — 3 open risk findings`).
- **Overview now closes with recommended next actions instead of twelve shortcut cards.** The old grid was a second navigation system competing with the first, on the page that should answer "how are we doing?" rather than "where would you like to go?" — and every one of the twelve duplicated a destination already on screen: Score Breakdown repeated both the hero score ring and the Score tab, Roadmap Backlog and Testing Explorer repeated their own tabs, Ideation Whiteboard repeated a stat card *on the same page*, and Chat / Run Center / Model Providers repeated the sidebar Quick Links. In their place, Overview surfaces the top three short-horizon entries from `score.recommendations` — state-derived advice that already carries its own action — with a link through to the full breakdown, and a "nothing outstanding" state when the project is clean. `DashboardSnapshot.quickActions` and `renderActionCard` are removed.
- **Action cards now state where they actually go.** `renderActionCard` took its kicker from the `pageTarget` field, but for any card carrying a `command` that field was never navigated to — it was inert metadata used only as a label. "Open Chat View", "Ideation Whiteboard" and "Model Providers" therefore all announced themselves as **"runtime"** while opening three different panels, none of which was the Runtime page, and "Security Policy" read as "security" while opening a file. Recommendation cards now derive their destination from the action that will actually run — "Ask Atlas", "Opens Run Center", "Opens SECURITY.md", "Opens Roadmap" — via the new `resolveRecommendationAction`.
- **Animated metrics across every page**, built on the repaired animation path below: change-shape and upstream-divergence bars on Repo, TDD subtask-evidence and token-split bars on Runtime, a test pyramid and coverage meter on Testing, a severity-mix bar on Gap Analysis, backlog completion and focus-mix on Roadmap, a governance-completeness meter on Security, documentation-freshness on Documents, entry-health on SSOT, per-provider trust meters on Privacy, artifact coverage by lifecycle phase on Delivery, and an assignment-status and follow-up-urgency pair on Director.
- **A stakeholder influence/interest grid on the Director page.** `DirectorLevel` is described in `src/types.ts` as "the scale used for the stakeholder influence/interest grid", but influence and interest were only ever rendered as a text tag on each contact card. The grid reuses the Risk page's matrix chrome rather than introducing a second grid component, and names the standard strategy for each cell (manage closely / keep satisfied / keep informed / monitor).
- **A release strip on the Delivery page.** Promotion history was eight text rows; success rate and shipping cadence were invisible. One tick per recorded promotion, oldest left, with rollbacks notched so they read without relying on hue, plus a green-rate headline.
- **Charts now carry direction, not just shape.** Each chart card headlines its period total and the delta against the preceding equal-length window, and draws a mean line across the bars. The commit-velocity chart is now on the Repo page and the SSOT update-cadence chart on the SSOT page — both series were already collected for 90 days but only ever drawn on Overview.
- Full WAI-ARIA tab semantics and keyboard support for the dashboard nav: `role="tab"`/`aria-selected`/`aria-controls` on the tabs, `role="tabpanel"`/`aria-labelledby` on the panels, roving `tabindex`, arrow-key navigation with Home/End, and a focus ring. The container declared `role="tablist"` but had no keydown listener at all, so reaching the fourteenth tab took fourteen Tab presses.
- `tests/views/dashboardNav.test.ts` — reads the real `PAGE_GROUPS` definition out of `media/projectDashboard.js` and asserts every nav page is a valid prompt `sourcePage`, has a rendered panel, and appears exactly once. The nav and the page-id allowlist live in different files and different languages and have drifted before.

### Fixed
- **The Skill Scanner panel did not work at all.** Two independent faults, either of which alone was fatal. Its rule set was embedded as `escapeHtml(JSON.stringify(rules))` inside `<script type="application/json">` — but `<script>` is a raw-text element, so the HTML parser never decodes character references inside it and `JSON.parse` threw on the panel's very first statement, taking every handler down with it. Separately, every control was wired with an inline `onclick=""` attribute, which the shared shell's CSP (`script-src` with a nonce and no `'unsafe-inline'`) blocks outright. Rules now travel on a `data-*` attribute, where entities *are* decoded, and all controls are wired through event delegation. The panel's `$(eye)` / `$(edit)` / `$(trash)` codicon tokens also rendered as literal text — codicon syntax is not interpreted in webview HTML — and `var(--vscode-charts.blue)` was an invalid custom-property name (a dot is not legal), so that declaration was dropped and only its fallback ever applied.
- **"Reset all built-ins" also deleted every custom rule.** The Skill Scanner control posted `saveAll` with `{ overrides: {}, customRules: [] }`, wiping the user's own rules as an unannounced side effect of a button that named only the built-ins. It now posts a payload-free `resetAllBuiltIns`, the host preserves `customRules`, and the action is confirmed in place before it fires. The same message also handed a fully unvalidated `ScannerRulesConfig` to `replaceConfig()` — the rule set that gates which skills may run — because `isPanelMessage` accepted any object whose `type` was a string; every inbound message is now checked field by field.
- **The Tool Webhook panel's "Set / Update Token" button did nothing.** It called `window.prompt()`, which VS Code webviews do not implement: the call returns `undefined` without showing anything, so no token was ever collected. Replaced with an inline `type="password"` field with save/cancel, Enter and Escape handling. The token continues to live only in SecretStorage and is never rendered back into the markup.
- **Section ordering across five panels reflected when features shipped, not how anyone uses them.**
  - **Settings** is regrouped into five labelled clusters — Overview, then *Capabilities* (Models & Integrations · Resource Discovery), *Interaction* (Chat & Sidebar · AI Instructions), *Guardrails* (Safety & Verification · Testing), *Autonomy* (Project Runs · Mission Loop) and *Advanced* (Experimental). Resource Discovery — the page for *adding* a capability — had been last, four pages from Models & Integrations, and AI Instructions sat between Experimental and Resource Discovery rather than beside Chat. `SETTINGS_PAGE_IDS` is now the canonical order and a test asserts the nav matches it; the two lists had already drifted.
  - **Personality Profile** now runs identity → expression → constraints → operations → flavour (`identity · values · tone · cognition · memory · boundaries · conflict · redlines · operations · flavor`). The three constraint sections were at positions 4, 9 and 10 — scattered across the whole form — and are now adjacent. Verified as a pure permutation: not one field definition changed. Its colour scheme is untouched.
  - **MCP** lands on **Configured Servers** instead of an Overview whose three summary cards restated the three hero badges verbatim — the same numbers twice on one screen, clickable in the hero and inert below it. That duplicate grid is gone and the remaining reference content moved to an **About MCP** tab at the end.
  - **Specialist Integrations** rendered every provider card **twice**: "All Integrations" was a verbatim concatenation of "Live surfaces" and "Future adapters", so three of its four tabs showed the same eight cards and the DOM held two copies of each. The three are now one **Integrations** page with a segmented Live/Future filter.
  - **Cost Dashboard** buried its only decision-forcing signal. *"Am I about to be blocked?"* was answered by a budget HUD sitting **inside** the Daily Spend card, below a section header and behind ten undifferentiated summary tiles. The budget is now a full-width strip immediately under the topbar, tinted amber or red as the limit approaches, with live in-flight loop spend directly beneath it. The summary ribbon is regrouped into three labelled clusters — *Spend*, *Efficiency*, *Volume* — and **Today's Spend** and **Daily Limit** are no longer repeated as cards, since the promoted strip is entirely about them (they reappear when no budget is configured and the strip does not render). Recent Requests, the drill-down behind every number above it, now precedes the two interpretive panels, and Local Model Savings — an estimate rather than a measurement — closes the page. The line/bar chart switch is withheld when the window has no spend; the **timescale strip deliberately is not**, because the records feeding the chart are themselves scoped by the selected timescale, so an empty window is exactly when you need to widen it.
  - **Project Ideation** is a whiteboard panel whose whiteboard was below the fold. A hero explainer, a four-card staged-workflow guide and a very tall composer all came first, and `.ideation-main-grid` is a single column — so the composer stacked *on top of* the canvas rather than beside it. The board now leads, preceded only by a compact three-stat strip; the composer follows it; and the workflow guide moved to the end inside a `<details>` that opens itself only while the board is still empty, when it is actually guidance rather than reference. The hero grid and its now-unused CSS are gone. Canvas focus mode also gained the sections it had been missing — the process guide stayed on screen in what is meant to be a full-screen canvas.
  - **Website Studio** renders literal numbered steps, so it promises a linear workflow — but steps 3 and 4 were inverted against their own content. Each wireframe card tracks a per-page *UI design* stage, which cannot be done consistently before the shared typography, colour and component decisions exist. **UI system** is now step 3 and **Wireframes & UI** step 4, with the UI-system copy corrected to match.
- **Seven panels declared a tab list and delivered none of it.** Voice, Vision, Specialist Integrations, Tool Webhooks, Model Providers, Agent Manager and MCP each shipped their own copy of the same vertical nav — in four of them the markup and the `activatePage` function were byte-identical — and every copy had the same gap: a container with `role="tablist"` whose children were plain buttons. No `role="tab"`, no `aria-selected`, no `aria-controls`, no `role="tabpanel"` on the sections, no roving `tabindex`, and no keyboard handling whatsoever. A screen reader was promised a tab list and found unrelated buttons, and reaching the last tab took one Tab press per tab. New `src/views/panelNav.ts` provides one controller for all seven. It *upgrades* the existing markup at runtime rather than replacing it — every panel already used the same `data-page-target` / `#page-X` conventions — so the panels keep their own markup, classes and styling unchanged while gaining full tab semantics, roving tabindex, arrow keys that honour the declared orientation, and Home/End. Tabs hidden by a panel's search filter are skipped rather than staying focusable while invisible, and an unknown page id is ignored rather than blanking every section, which matters because several panels activate from a persisted value that may name a page that no longer exists. **The Settings panel is deliberately left alone**: it is the one panel that already implemented the pattern correctly, on top of a progressive-enhancement fallback that keeps sections reachable if the script never boots, and adopting the shared controller there would have traded a better implementation for uniformity.
- **One CSS rule in the shared shell was inverting button states across the extension.** `webviewUtils.ts` declared `button:hover { background: … }`, which at specificity (0,1,1) beats every single-class variant (0,1,0) no matter what order a panel's own CSS came in. Two consequences, both live: chat's icon toggles declared no background of their own and so borrowed the shell's *solid* primary fill, while their pressed state is a translucent tint — meaning **"off" rendered louder than "on"**, exactly backwards; and any button given a class with no rule at all silently looked like a primary action, which is how the destructive **Remove** in the Resource Discovery finders table became the loudest control on the page. The shell's *paint* is now scoped to `button:not([class])` — which does not out-specify panel variants, it simply stops matching them — while structural properties (cursor, padding, radius) stay global. Nine classes that had been relying on the inherited fill now declare their own: `.icon-btn` (ghost at rest, with a visible `aria-pressed` state that also fixes chat's invisible search mode), `.primary-btn` (chat, vision, voice), `.btn-sm`, `.action-secondary`, `.primary-button`, and `.link-button` (now a quiet destructive text action rather than a filled button).
- **The MCP guided-setup prerequisite gate reported its verdict but never enforced it.** `applyPrerequisiteStatus` set `connectBtn.disabled = false` unconditionally and nothing below re-disabled it, so a server with a missing runtime showed "this needs X, which is not installed yet" in the banner while leaving Connect fully armed. Connect is now denied by default and re-armed only on an explicit `ready`, with the reason stated on the control itself rather than only in the banner.
- **Personality Profile's command and open-file controls worked exactly once.** Their listeners were attached per-element on every render with `{ once: true }`, so the first click consumed the handler and any control whose element was not subsequently recreated stayed dead for the rest of the session — while elements that *did* persist accumulated a duplicate listener on each re-render and fired more than once. Replaced with a single delegated handler. The panel's colour scheme is unchanged.
- **Agent Manager directory rows looked clickable and were not.** Rows carry `cursor: pointer` and an accent hover, and the page copy says "Select a row … to open the editor", but nothing listened — only the inline Edit button worked. Rows now open the editor, are keyboard reachable, and ignore clicks that land on their inline controls.
- **The Specialist Integrations status filter could be switched on but never off.** The two hero badges were the only thing that ever assigned `activeStatusFilter`, and each assigned its own value, so once you filtered by "configured" there was no way back to the full list without reloading the panel. The badges now toggle, show an active state, and carry an at-rest cue distinguishing them from the inert pill beside them.
- **Website Studio went stale on every save.** `saveConfig` updated the config and posted a success notice without re-rendering, so all server-derived content kept showing pre-save values — while `importIntake` immediately below it did re-render, which is what made the inconsistency hard to spot.
- Vision panel file-reference links did nothing when the click landed on inline markup inside the link (model output routinely wraps a path in `<code>`), because the handler tested `event.target` directly instead of using `closest()`.
- Mission Control's decision box declared three option kinds and read only one: the host sends `kind: 'primary'` for "Approve & continue" and "Resume", but the affirmative action rendered identically to every neutral one in a control whose entire purpose is to make the intended choice obvious.
- A codicon token (`$(credit-card)`) rendered as literal text in the Model Providers subscription card; codicon syntax is interpreted by tree items, the status bar and QuickPicks, but not in webview HTML.
- Shared design language extracted to `src/views/dashboardTheme.ts` (tokens, a universal `prefers-reduced-motion` baseline, and the `.is-actionable` / `.static` / `.segmented` primitives) and `src/views/dashboardWidgets.ts` (metric pills, distribution bars, sparklines, and the `applyValueAnimations` driver, in both server-rendered and client-rendered forms). `missionControlPanel.ts` held a byte-identical copy of the Project Dashboard's `:root` block that had already drifted out of date; both panels now consume the single definition.
- New `tests/views/panelWiring.test.ts` enforces four invariants across every webview source, each of which was violated in the codebase: no inline event-handler attributes, no `window.prompt`/`alert`/`confirm`, no HTML-escaped JSON inside `<script>`, and no dotted CSS custom-property names.
- **Every value-driven animation in the dashboard was dead code.** `render()` replaces `#dashboard-root`'s innerHTML wholesale, so each node is freshly parsed with exactly one computed style — a CSS `transition` between two values can never interpolate. The score ring's `stroke-dashoffset`, the metric meters' width and the MVP progress bar all declared transitions that had never once played; they painted at their final value. Conversely `@keyframes` *do* restart on every insert, so the Overview chart re-grew up to 90 bars whenever any unrelated part of the dashboard re-rendered — including on every keystroke in the Testing search box. Both are now driven by `applyValueAnimations()`, which remembers the last value painted per stable key and moves only what actually changed. Meters on a hidden page are deliberately not recorded, so they animate the first time that tab is opened.
- **`prefers-reduced-motion` was not honoured anywhere in the dashboard.** Added across the stylesheet, and `applyValueAnimations()` short-circuits on the same signal so reduced-motion users never pay the class churn either.
- **Two dashboard buttons did nothing at all.** The Director page's autonomous-run titles carried `data-action="openRun"` and its "Manage MCP servers" button carried `data-action="openCommand"` — both are *message* type names, not action names, and neither matched any branch of the delegated click handler. They are now `run` and `command`, which is what the handler dispatches on.
- **~15 inert cards across Repo, Roadmap, Testing, Gap Analysis and Documents showed a hand cursor.** A blanket `cursor: pointer` rule silently defeated the deliberately scoped rule a hundred lines above it, whose comment reads "Only elements that actually resolve to an action get the interactive affordance". `.recent-item` and `.action-card` render as both real buttons and inert `<div>`s, and the blanket rule handed a hand cursor to every one of them. The rule no longer covers those two classes, and an explicit reset keeps a static variant inert even inside a pointer-cursor container. Clickable cards additionally gained an at-rest chevron, so a live row reads as live *before* hover rather than only after the user commits to a click.
- The Repo page's "Recent commits" rows are now clickable and open Source Control, matching the sibling branch cards and the page copy that already promised "Click any card to open it in Source Control."
- The Testing browser's category wrapper no longer reuses `.recent-item`. An inert card sat directly around live ones with identical chrome, so clicking the group header did nothing while clicking six pixels lower selected a test; it is now styled as the grouping heading it is.
- **The dashboard's `@media (max-width: 820px)` breakpoint never applied.** Two orphaned selectors sat immediately above the at-rule, so the parser read `@media` as the third item of a selector prelude, treated the whole thing as an invalid qualified rule and discarded it along with the block. Overview stat cards stayed three-across down to zero width. The stray declaration that trailed the block then leaked to every viewport, pinning the Score page's outcome grid to a single column at all widths.
- **The whole dashboard was one `aria-live="polite"` region.** Because `render()` replaces all of it, a screen reader re-announced all fourteen pages on every keystroke and checkbox toggle. The live region is now a dedicated status element that announces only transient results (gap and risk analysis progress, rollback and health-check outcomes).
- An unknown `activePage` could blank the dashboard. `ideation` is a legal `DashboardPageId` — it exists so prompts raised in the separate ideation panel route correctly — but has no tab and no renderer, and `state.activePage` was assigned straight from the click payload and the host `navigate` message without validation, leaving every section inactive. Unknown ids now normalise back to Overview.
- The 7D/30D/90D range picker was a dead control on 11 of 14 tabs, and on the three where it worked it sat in the same sticky row as the tabs, sharing their pill shape and their accent "active" colour — so on a narrow panel it wrapped underneath the nav and read as a sixth tab group rather than as a filter. It now renders directly above the charts it filters, on the five pages that actually read it, using a new squared, joined `.segmented` treatment that belongs to a visibly different control family from the nav's separate round pills. The Director page's team-mode switch adopts the same primitive instead of re-using the nav pill styling.
- Two dashboard style declarations referenced CSS custom properties that are never defined (`--dash-fg`, `--dash-mono`) and no fallback, so both were invalid at computed-value time and silently dropped: the Roadmap drag handle inherited body colour instead of reading as a de-emphasised affordance, and artifact paths on the Delivery page rendered in the body font rather than monospace.
- The three-way disagreement between the nav order, the render dispatch order and `DASHBOARD_PAGE_IDS` is resolved, and the comment claiming `DASHBOARD_PAGE_IDS` was "every dashboard page id, in nav order" — which was wrong on both the ordering and the membership — now describes what the list is actually for.

## [0.140.1] - 2026-07-25

### Fixed
- **The Data Privacy gate classified ordinary coding work as regulated data.** The compliance detectors run over the *whole assembled task context* — source, logs, memory, chat history — rather than over the user's request, and several were loose enough to fire on almost any of it. Measured against a corpus of realistic non-PII repository content, **17 of 21 samples** were classified. The `phone` detector accepted plain spaces as group separators, so SVG path data (`M 100 200 300 400`), build timing tables, coordinate arrays, and an ISO date followed by a number all matched. `ipv4` had no reserved-range exclusion, so `127.0.0.1`, `0.0.0.0`, netmasks, private LAN addresses, and four-part file versions matched. `email` matched role mailboxes and `example.com` placeholders present in every `package.json`, licence header, and commit trailer. `swift-bic` matched *any* 11-letter upper-case token — `ENVIRONMENT`, `DEVELOPMENT`, `INFORMATION` were all "bank identifiers". HIPAA's `medical-terms` matched the bare stem `diagnos*`, turning ordinary debugging prose ("the diagnostic output shows a null deref") into protected health information. Every detector is now anchored on a cue ordinary source does not contain — an explicit `phone:`/`SWIFT:` label, a `+` country code, a clinical construction — or paired with a structural validator. New exported `isPublicIpv4()` rejects loopback, private, link-local, CGNAT, benchmark, TEST-NET, multicast and broadcast ranges (narrowed to their real CIDR blocks so genuinely public space is never under-detected) and the pattern's lookbehinds drop version strings like `FileVersion 1.0.0.1` and `AssemblyVersion("2.1.0.9")`; new exported `isPersonalEmail()` rejects role locals (`noreply@`, `support@`, CI senders) and RFC 2606/6761 reserved domains. The same corpus now classifies **0 of 23** samples while all 15 true-positive cases still fire.
- **A single heuristic hit silently downgraded the model for an unrelated task.** Because the gate scans the context bundle rather than the request, one detector firing on a git trailer or a timestamp anywhere in retrieved memory restricted routing for the whole task — on a workspace whose trusted list holds only local/Mistral models, that quietly removed every frontier model from consideration with no visible cause. The gate's response is now **tiered by `sensitivity`** via the exported, unit-tested `selectHardGatingMatches()`: `secret` matches (PCI cardholder data, HIPAA PHI) hard-gate to the trusted allow-list as before, while `confidential`/`proprietary` matches (GDPR, CCPA, and custom rules at those levels) are advisory — routing is left to the router and the existing redaction boundary removes the matched spans instead. Nothing leaks under either tier; the difference is whether a task is re-routed or simply loses the matched spans.
- **A privacy notice couldn't be told apart from a false positive.** The gate joined every context slice into one string before classifying, so it could report *what* fired but never *where*. It now classifies each slice separately and names the origin — `email address in memory "Stakeholders"`, `IP address in file src/net/probe.ts` — so a spurious catch is diagnosable.
- **Consenting to store one contact silently enabled workspace-wide scanning.** The Project Director's PII consent modal promised that stored personal data would be classified, but `enableGdprPiiPack()` also flipped the Data Privacy master switch on for the entire workspace, and nothing said so. The modal now states the consequence up front — every later task has its assembled context scanned and matched spans redacted for un-trusted models — and when the master switch actually had to be turned on, the user is told afterwards and offered the Privacy page to review it.

### Changed
- Compliance-pack descriptions on the Privacy page now describe what the detectors actually match (e.g. GDPR reads "personal email addresses, labelled or international phone numbers, public IP addresses…"), replacing a listed "national ID" detector that never existed. Unlabelled national-format phone numbers are deliberately no longer matched by the built-in pack — a targeted custom rule is the right tool for a project that stores them without a label.
- `tests/core/compliancePacks.test.ts` gains a **benign source-repository corpus** that must stay unclassified, a matching recall suite so tightening precision cannot silently blind a pack, validator unit tests for `isPublicIpv4`/`isPersonalEmail` (including the "does not over-exclude public space adjacent to reserved blocks" case), and assertions pinning each pack's sensitivity tier, which is now load-bearing. `dataPrivacyManager.test.ts` gains the end-to-end equivalent with all five packs enabled, and `orchestrator.security.test.ts` covers the `selectHardGatingMatches` tier rule. 55 new tests; full suite 1564 passing.

## [0.140.0] - 2026-07-25

### Added
- **Three oversight advisors: Ethics, Legal, and Commercial.** New built-in agents (`ethics-oversight`, `legal-oversight`, `commercial-oversight`) that ask the questions the engineering specialists don't: *should we build this?*, *are we allowed to?*, *does this make commercial sense?* Ethics covers user harm, fairness and bias, consent, dark patterns, transparency, and accessibility as an ethical duty. Legal covers dependency and third-party licence compatibility, intellectual property, privacy regulation (GDPR/CCPA), liability, terms of service, and regulated-data handling. Commercial covers monetisation and business viability, vendor cost and lock-in, contractual and customer obligations, competitor positioning, and go-to-market impact. Each prompt is explicit that it is **advisory and not professional advice** — it surfaces concerns for human judgement and names the review needed (qualified counsel in the relevant jurisdiction, an ethics or DPO review, finance or commercial sign-off) rather than certifying anything.
- **Read-only by construction.** These are the first built-ins to pin an explicit `skills` allowlist instead of `[]` (which means *all* enabled skills). They can read files, search, inspect git history and diagnostics, and query memory — but have no `file-write`, `file-edit`, `git-commit`, `git-push`, `terminal-run`, `memory-write`, or `http-request`. An advisor inspects and reports; it is not also the thing that edits. They are also the first built-ins to set `autoUpdateExcluded`, so the agent auto-updater can never paraphrase the not-professional-advice framing away on its cadence.
- **New routing needs `ethics`, `legal`, and `commercial`**, so an oversight question reaches its advisor instead of the nearest engineering specialist. Added across the classifier (type, validation allowlist, classifier prompt, regex fallback) and the orchestrator's routing heuristics. The request/agent patterns are deliberately narrow — anchored on distinctive vocabulary (`gdpr`, `dark pattern`, `monetisation`) and avoiding generic words already present in other agents' descriptions — so ordinary implementation work still routes exactly where it did before.
- **Project Dashboard → Risk page.** A new page that runs the advisors, records everything they find, scores it, and charts it. Runs are explicit and user-triggered (per-domain or all three sequentially, never concurrently — three parallel model calls is a surprising cost from one click), with live per-advisor progress. The advisor is *pinned* via `processTaskWithAgent` rather than routed, so the page always consults the advisor you asked for. Includes a likelihood × impact **risk matrix** heatmap whose cells filter the register, an assessment-cadence trend chart, a risk score ring, and per-domain freshness cards. All visuals are hand-rolled inline SVG/CSS under the existing webview CSP (no external chart library).
- **`RiskOversightManager` (`src/core/riskOversightManager.ts`)** — persists the register to `project_memory/operations/risk-oversight.json` with a readable `risk-oversight.md` mirror and an append-only `risk-oversight-history.json` audit trail (capped at 1000 records, and the cap is stated in the mirror rather than truncating silently). Findings are **never deleted** — they transition through `open → accepted / mitigated / closed / dismissed` — so the register stays a complete account of what was raised and what was decided. Re-running an advisor refreshes prose and severity but never silently undoes a human decision. `vscode`-free (node `fs` only) and unit-tested.
- **Risk contributes to the operational score**, but only once a project has actually been assessed. An unassessed project is *unknown*, not safe: the risk component is omitted from both the numerator and the denominator until there is evidence, so installing this release does not move any existing project's health number. Open findings are weighted by likelihood × impact, discounted by the advisor's stated confidence, reduced for domains never assessed, and decayed as an assessment goes stale (90 days). `accepted` findings are excluded — a consciously owned risk is a decision, not an unmanaged gap.

### Fixed
- **Oversight advisors could hijack ordinary chat.** Because they are the only built-ins that pin skills, agent selection uniquely credited them with skill-id and skill-description tokens that every `skills: []` agent scores zero on — enough that prompts as generic as "Hello, can you help me?" routed to `ethics-oversight`. Agent selection now treats a pinned skill list as a routing signal only when the agent has *not* declared `primaryRoutingNeeds`, since a pin can mean either "this is my git agent" (specialisation) or "this agent may only read" (an authorization boundary that says nothing about intent).
- **Routing scored English function words.** `tokenize` filtered only by length, so a shared "the" or "and" between a request and an agent's `role`/`description` counted toward relevance — weighted up to 4×. That quietly favoured agents whose descriptions happened to be written as longer prose. Closed-class stopwords are now dropped before scoring. This also corrects pre-existing misroutes: "Read the file and tell me what is in it" went to `security-reviewer` and now goes to `default`.
- **"Ask Atlas" from the Privacy page lost its origin.** `privacy` shipped in the dashboard nav but was missing from the page-id union and the `sourcePage` allowlist, so prompts raised there silently dropped their source page. Page ids now derive from a single `DASHBOARD_PAGE_IDS` list, so a new page cannot be left out of one of them again.
- **Keep-awake (`PresenceManager`) hardened after an adversarial review.** Fixed an unbounded respawn loop where a helper that started then exited immediately re-spawned every ~2s forever because the give-up cap was unreachable (the failure counter reset on every spawn); a fast-dying helper now accumulates toward the cap while a stable one earns a fresh retry budget. A held wake lock now reconciles live `maxAwakeMinutes`/`keepDisplayAwake` changes (the backstop could otherwise be silently disabled mid-hold, defeating the "never hold indefinitely" guarantee); keep-awake defers acquisition until the first AC-power probe resolves (no brief hold on battery); the backstop deadline is now **absolute**, so repeated sleep/wake cycles can't push it past `maxAwakeMinutes`; and every async continuation (respawn timer, in-flight AC probe, superseded-child `error`/`close`) is guarded so nothing runs after `dispose()`. Added a status-bar state for the time-limit auto-release, a helper-side wall-clock cap (Windows deadline / macOS `-t` / Linux bounded loop) so an orphaned helper self-releases even after a host crash, and 3 regression tests.

### Changed
- The dashboard's operational health score is now **normalised from the components actually present** (`earned / available × 100`) rather than assuming the per-component maximums happen to sum to 100. They did by convention, but nothing enforced it while the UI hard-coded `/100` in the ring, the headline, and the ≥85/≥65 bands. Adding or omitting a category — as the risk component does — is now safe. `buildScoreBreakdown` and `normalizeDashboardPromptRequest` are exported so both invariants are unit-tested for the first time.

## [0.139.0] - 2026-07-25

### Added
- **Keep the computer awake so the agent stays online (`atlasmind.presence.*`).** New cross-platform `PresenceManager` core service (`src/core/presenceManager.ts`) that acquires an OS-native wake lock so a long Mission Loop run, an active Remote Control gateway session, or a connected Buzz presence isn't killed by system sleep. Because a VS Code extension runs in the extension host (not Electron's main process) it cannot use `powerSaveBlocker`; instead the manager spawns a verified OS helper and ties the lock to that child's lifetime — Windows `SetThreadExecutionState(ES_CONTINUOUS|ES_SYSTEM_REQUIRED)` via PowerShell (with a parent-PID orphan guard), macOS `caffeinate -i -w <pid>`, Linux `systemd-inhibit --what=idle:sleep --mode=block`. Safety-first / deny-by-default: `atlasmind.presence.keepAwake` (`false`), `atlasmind.presence.keepDisplayAwake` (`false`, lets the screen sleep), `atlasmind.presence.acPowerOnly` (`true`, auto-suspends on battery so an unplugged laptop is never drained), and `atlasmind.presence.maxAwakeMinutes` (`240`, an auto-releasing backstop so a stuck activity can never hold the machine awake indefinitely). A status-bar indicator shows when the machine is being held awake (and when it's paused on battery) and is click-to-stop via the new `atlasmind.togglePresence` command. Includes a wall-clock-gap sleep detector that re-asserts the lock after a suspend, and never interpolates untrusted input into a command (only validated integers). `vscode`-free core, unit-tested.
- **Buzz (buzz.xyz) integration — Tier 1 foundation.** Groundwork for incorporating [Buzz](https://buzz.xyz) — Block's open-source, Nostr-based workspace where humans and AI agents collaborate as equals (a self-sovereign Slack + GitHub alternative) — into AtlasMind's Project Director and comms workflow. This pass ships the safe, additive foundation with **no speculative protocol code** (Buzz is days-old, ships no comms MCP yet, and its `buzz-cli` command schema is unpublished): a new `buzz` `CommunicationChannelKind` so Director contacts can carry a Buzz identity (npub / @handle / #channel) plus an `https`-only Buzz deep link (reusing the existing scheme allowlist — no unverified native URI scheme added); `DirectoryRef.source: 'buzz'` so a contact can *reference* a Buzz-owned Nostr identity as their system of record (added to `DIRECTORY_SOURCES` so the sanitizer preserves it); a Buzz option in the contact-link editor; and `directorCommsRunner` intent recognition extended so Buzz-style comms tool names (`post_to_channel`, `send_dm`, `direct_message`, `buzz_*`) classify as the `message` intent — **forward-compatible**, so the moment a Buzz comms tool is connected, Director's guarded `{modal:true}` dispatch works with zero further code. New deny-by-default, configurable settings `atlasmind.buzz.enabled` (`false`), `atlasmind.buzz.relayUrl` (`ws://localhost:3000`, local-first), and `atlasmind.buzz.allowRemoteRelay` (`false`, gates off-machine sends). The full four-tier vision (foundation → ARD/guided connector → two-way sync → self-sovereign agent identities & A2A) is documented as SSOT in `project_memory/roadmap/buzz-integration.md`, governed by a fixed boundary contract — **Buzz owns identity + messaging; AtlasMind owns reasoning + execution** — so AtlasMind references Buzz identities and dispatches through Buzz rather than mirroring a directory or the message log.

## [0.138.0] - 2026-07-25

### Added
- **MCP environment scan — import from your other tools + PATH/credential hints.** The Advanced "Add MCP server" page now shows a "Detected on this machine" panel backed by a new `McpEnvironmentScanner` (`src/mcp/mcpEnvironmentScanner.ts`): it discovers MCP servers already configured in Claude Desktop, Cursor, VS Code, Windsurf, or a repo `.mcp.json`/`mcp.json`, and offers **Prefill form** or **Import & connect** for each; reports which launch runtimes (npx/uvx/docker/…) are on your PATH; and surfaces env-variable **names** found in `.env*`/`wrangler.toml` as click-to-add chips. An **"Ask Atlas to help"** button hands off to chat for servers with no known setup. The scan is cached in SSOT (`project_memory/operations/mcp-environment.json` + a `.md` mirror) and reused on future installs, with a **Rescan** button and automatic refresh when a workspace MCP config file changes.
- **Redaction-safe by design.** The scanner is `vscode`-free and unit-tested, and it never captures secret **values** — only env-variable *names* and whether each looks like a secret are cached or shown. On **Import & connect**, credential values are re-read live from the source config file and routed straight to VS Code SecretStorage (never persisted to the git-tracked cache or sent to the webview). New `ImportedMcpServer` / `McpEnvironmentScan` types.
- **Guided setup completed for the whole catalogue (batch 2).** The remaining 21 "Registry fallback / Manual setup" servers now have supply-chain-verified guided setups, matching the 13 platform servers from 0.137.0. **17 became one-field guided prefills** — AWS (read-only default), Google Cloud, Cloudflare + Cloudflare Workers (browser-OAuth via the pinned `mcp-remote` stdio bridge), Apple/XcodeBuildMCP, MySQL, MongoDB (`--readOnly`), Elasticsearch (Docker), RabbitMQ, Amazon SNS/SQS, SendGrid, CircleCI, Grafana, Prometheus (Docker), Atlassian Jira, Trello, and Stripe (restricted key). **4 stayed guided-manual:** OpenAI web-search and Bark/APNs (community, version-pinned, review-before-connect); Twilio and Jenkins route to Advanced with full step-by-step guidance because they require the credential on the command line, which AtlasMind will not auto-store in config (a new test enforces that no recommended input ever carries a secret as a CLI argument). Every server ships prerequisites, a credential how-to, a direct console link, and a safety note; only first-party/reputable packages are prefilled (archived, hallucinated, and typosquat packages were excluded, and known-risky defaults are hardened — e.g. AWS read-only, MongoDB read-only, least-privilege credential guidance throughout).

## [0.137.0] - 2026-07-24

### Added
- **Guided MCP setup with real handholding for 13 previously "manual" servers.** GitHub, Microsoft Entra ID, Microsoft 365, Shopify, WooCommerce, WordPress, Webflow, Wix, YouTube, Meta Ads, and X now auto-fill a verified command and ask only for credentials; Twitch and LinkedIn stay opt-in *guided-manual* (community, version-pinned, review-before-connect) but are still fully prefilled. Instead of dropping a beginner into a blank Advanced form, the wizard's configure step now shows a **"What you'll need"** checklist, a **numbered step-by-step how-to for obtaining the credential**, an **"Open credentials page ↗"** button to the exact console, a docs link, and an **amber safety note** (telemetry, real ad-spend, third-party trust, token expiry). Credential fields carry realistic example placeholders and one-line "what this is / where to get it" help. Setup details were researched and adversarially supply-chain-verified per server — only first-party/reputable packages are prefilled; archived/hallucinated/cookie-scraper packages were explicitly excluded. New `RecommendedMcpStarterDetails` fields (`prerequisites`, `credentialSteps`, `credentialHelpUrl`, `safetyNote`) and `RecommendedMcpInput.example`.

### Changed
- **The Guided Setup wizard connects any starter that has an endpoint.** A recommended server is now connectable from the wizard whenever it has a command/URL (including guided-manual community servers, which connect with an "Add & connect" affordance and a review banner). Only a truly endpoint-less custom entry falls back to Advanced.
- **Advanced "Add MCP server" form is no longer cryptic.** Each field (Command, Args, Env JSON, URL) now has inline help and a realistic example, and points novices at Guided Setup for secure credential storage.

## [0.136.0] - 2026-07-24

### Added
- **Documents dashboard tab (`.md` management).** New Project Dashboard → **Documents** page for defining a project's *document filing system* (folder "shelves", optionally narrowed by a glob) and the documents to *keep updated automatically*. Backed by a new `DocumentsManager` core service that persists `project_memory/operations/documents.json` (source of truth) plus a human-readable `documents.md` runbook mirror (`fs`-only, unit-testable). Safety-first / deny-by-default: AtlasMind **never** rewrites a document on a timer — the page tracks freshness from file mtimes vs. a recorded review baseline and offers an explicit "Update with Atlas" assisted action, a "Mark reviewed" baseline reset, and discovers uncovered markdown to file/track. All webview paths are sanitised at the boundary (path-traversal, absolute paths, and drive letters rejected). New `DocumentsConfig`/`DocumentFilingEntry`/`DocumentAutoUpdateEntry` types.

### Changed
- **Roadmap Dashboard now de-duplicates and filters its backlog.** The parser reads only the marked backlog region, drops import-generator scaffolding ("Project Context" metadata and "Prioritisation Notes" filler) and collapses duplicate lines, so the Roadmap page no longer lists inappropriate or repeated items. The `improvement-plan.md` backlog was also cleaned in place.
- **Clearer roadmap reorder UX + novice MVP guidance.** Each backlog item now shows a drag handle (`⠿`) with grab cursor and a live drop-target highlight while dragging, and the "Mark MVP" control carries a plain-language tooltip explaining what a Minimum Viable Product is (with a matching ⓘ hint on the "Road to MVP" card).

### Fixed
- **MCP Guided Setup no longer dead-ends on manual-setup servers.** Servers that need a command/endpoint you provide (e.g. GitHub, Microsoft 365, the platform group) previously showed "No extra details needed — just connect," then failed with a misleading "complete every required field" error despite showing no fields. The wizard now detects non-auto-configurable starters, hides the dead-end Connect button in favour of "Open Advanced setup" (which carries the chosen starter across), and — when a field genuinely is blank — names the specific missing field(s) instead of a generic message.

## [0.135.4] - 2026-07-24

### Changed
- **Developer-tooling dependency updates (Dependabot #128, split).** Bumped `@types/node` `^25 → ^26`, `eslint` `^10.5 → ^10.7`, `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` `^8.61 → ^8.65`, `@vitest/coverage-v8` `^4.1.9 → ^4.1.10`, and `@vscode/test-web` `^0.0.80 → ^0.0.81`. Verified with a clean compile, `eslint src tests`, the full test suite (1399 passing), and a clean `.vsix` package. Dev-only tooling — the published extension bundle is unaffected.
- **Held `typescript` at `^6.0.3`** (the one bump in #128 not applied): TypeScript 7.0 removes the programmatic Compiler API until 7.1, which `@typescript-eslint/parser@8.65` requires (peer `typescript ">=4.8.4 <6.1.0"`), so upgrading now breaks linting. The bump was deferred (confirmed by both an `ERESOLVE` peer conflict and an independent risk assessment) until typescript-eslint ships official TypeScript 7 support.

## [0.135.3] - 2026-07-24

### Security
- Bumped `ws` `^8.21.0 → ^8.21.1`, closing the last open Dependabot dependency PR.

## [0.135.2] - 2026-07-24

### Security
- **Resolved all reported dependency vulnerabilities (`npm audit` → 0).** `npm audit fix` updated transitive packages (`brace-expansion`, `fast-uri`, `js-yaml`, `linkify-it`, `hono`), and an `overrides` pin forces `@hono/node-server` to `^2.0.5` — patching a Windows `serve-static` path-traversal advisory that the MCP SDK otherwise held at a vulnerable `^1.19.9`. AtlasMind uses the MCP SDK as a **client** (never the server-side static path), and the override was verified with a clean compile, an MCP client-module load smoke test, and the full test suite (1399 passing).
- **Bumped pinned GitHub Actions** `actions/checkout` and `actions/setup-node` from `@v6` to `@v7` across the CI, publish, and release workflows.

## [0.135.1] - 2026-07-24

### Changed
- Refreshed the SSOT project-memory index (`project_memory/**`) so the architecture, domain, operations, and roadmap notes reflect the Project Director feature (people model, dashboard tab, guarded connectors, and follow-up reminders). No runtime code changes.

## [0.135.0] - 2026-07-24

### Added
- **Project Director — reminders, sidebar tree, and chat (Phase 4).** A new in-process `FollowUpScheduler` (`src/core/followUpScheduler.ts`) surfaces a **throttled, once-per-day** in-editor nudge ("N overdue, M due soon", with an "Open Project Director" action) when follow-ups come due. It is **notification-only and deny-by-default** — it never sends anything outbound on a timer (outbound always needs an explicit per-send confirmation). A single startup nudge fires when `nudgeOnActivation` is on (default on); the recurring 30-minute timer runs only while `remindersEnabled` is on (default off). Both toggle from the Director → Setup card.
- **Sidebar tree view** `atlasmind.projectDirectorView` (`src/views/treeViews.ts`): groups **Stakeholders**, **Team** (team mode only), and **Follow-ups** (overdue + due-soon), each item opening the Director tab. A badge shows the overdue follow-up count and updates live via `projectDirectorRefresh`.
- **Command + chat commands.** `atlasmind.openProjectDirector` opens the dashboard on the Director tab (used by the tree, welcome view, and chat buttons). New chat slash commands `@atlas /director` (a skimmable status: people, responsibilities, assignments, open/overdue follow-ups) and `@atlas /followups` (open follow-ups grouped Overdue / Due soon / Upcoming), each with an Open Project Director button and follow-up chips.

## [0.134.0] - 2026-07-24

### Added
- **Project Director — guarded outbound messaging via connectors (Phase 3, opt-in, default off).** When a project enables outbound messaging and a matching MCP connector is connected, the Director tab can **email**, **schedule a meeting**, or **post a message** to a contact through that connector — otherwise it falls back to the existing **Open** deep-link / **Copy** path and never auto-sends. A new pure `directorCommsRunner` (`src/core/directorCommsRunner.ts`) detects which connected MCP tool can perform each intent (matching tool names like `outlook_send_mail` / `create_event` / `post_message`, preferring real send/create tools over drafts) and best-effort maps a composed draft onto that tool's declared input-schema fields — inventing nothing, so the confirmation dialog shows exactly what will be sent.
- **Authorization gate.** Dispatch is deny-by-default: it requires `settings.outboundEnabled`, a connected connector, and an explicit `{ modal: true }` confirmation summarising the exact action (connector, tool, recipient, subject/body, classified risk) before the tool runs. The executed tool is sourced from the connected MCP server (via the `mcp:<serverId>:<toolName>` skill wrapper); the webview only supplies the draft, which is re-resolved and re-classified server-side (`classifyToolInvocation`). Successful sends are recorded to `project-director-history.json`.
- **Connector surfacing + PII minimisation.** The Setup card shows which messaging connectors are connected and a link to manage MCP Servers, and an "Outbound messaging: On/Off" toggle (persisted in the project config). `AtlasMindContext` now exposes `skillContext` so panels can dispatch MCP tool skills. Connector credentials remain in VS Code SecretStorage (`atlasmind.mcp.<serverId>.<KEY>`), and referencing a person in their system of record stays preferred over storing raw PII.

## [0.133.0] - 2026-07-24

### Added
- **Project Director dashboard — the usable v1 (Phase 2).** The Project Dashboard has a new **Director** tab (`src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`) that surfaces and edits the people model backed by `ProjectDirectorManager`: a **Setup** card (project, team-mode toggle, "Seed from repo", open the markdown mirror), a **People** roster (contacts with role badges, per-channel **Open** deep-links and **Copy contact**, inline add/edit with stakeholder/team roles), **Responsibilities** (area → owner/backup), **Assignments** (add/edit/status-cycle, plus an **Autonomous runs** list where each `ProjectRunRecord` can be given a human owner), and **Follow-ups** grouped Overdue / Due soon / Upcoming with complete/snooze/cancel. First open seeds a first-draft roster from repo signals (git contributors, `.github/CODEOWNERS`, `package.json` author, Website Studio stakeholders).
- **Solo-dev aware presentation.** The tab reads `resolveTeamMode`/`isSoloProject`: a solo project foregrounds self-management (your responsibilities, assignments, and follow-ups) and marks "you", while a team project shows the full roster. A one-line mode toggle (auto / solo / team) overrides the inference.
- **GDPR consent gate + safe boundaries.** Persisting raw personal data triggers a one-time modal (modelled on the remote-control workspace-approval gate); on approval AtlasMind records the acknowledgement (workspace-scoped) and enables the built-in `gdpr-pii` compliance pack so the stored PII is classified confidential and never sent to an un-trusted model. Every webview payload is validated by `isProjectDashboardMessage` and re-sanitised by `sanitizeProjectDirectorConfig` before it touches disk; contact deep-links are resolved server-side and re-checked against the scheme allowlist before `openExternal`; "Copy contact" builds the text host-side.

## [0.132.0] - 2026-07-24

### Added
- **Remote control over an SSO gateway (cross-machine, `atlasmind.remote.mode: "gateway"`).** The desktop remote-control server can now sit behind an authenticated Cloudflare Worker + Cloudflare Tunnel, so you can drive AtlasMind and view its read-only cost/run dashboards from a browser signed into your own platform login — not just a same-machine web client. In gateway mode the server authenticates each WebSocket by the `x-atlas-origin-secret` header the Worker injects (verified timing-safe against the existing pairing-token secret) instead of an in-band token, so the browser never holds a credential; it also records the forwarded `x-atlas-user-id` for audit. No inbound port is opened — the Worker and tunnel are outbound/edge. Localhost pairing mode is unchanged and remains the default. Every existing safety gate holds: workspace-trust approval, the redaction boundary, desktop-authoritative tool approvals, and default-deny on disconnect. New command **AtlasMind: Enable Remote Control (Gateway)** and setting `atlasmind.remote.mode` (`localhost` | `gateway`); the companion `atlas` gateway Worker is documented in `docs/remote-control.md`. `src/remote/remoteControlServer.ts`, `src/extension.ts`.

## [0.131.0] - 2026-07-24

### Added
- **Guided MCP setup wizard — make MCP approachable for first-time users.** The MCP Servers panel (`src/views/mcpPanel.ts`) now leads with a step-by-step **Guided Setup** flow instead of a raw command/args/env form: choose **Scan my computer** or **Browse by category**, AtlasMind checks prerequisites, asks only for the inputs a server actually needs, and connects. The former form remains available as an **Advanced** tab (and still backs the edit-existing-server flow). A "New to MCP?" explainer was added to the Overview page.
- **Environment scan (revived and made trustworthy).** `McpServerRegistry.detectAvailableServers()` — previously dead code that surfaced non-existent packages — now returns only servers whose launch runtime is actually present (`npx` → Filesystem, `uvx` → Git, signed-in Azure CLI → Azure), each with a human-readable reason. Detected servers are offered as one-click "Add & connect" cards.
- **Guided credential fields backed by SecretStorage.** Recommended starters can declare typed `inputs` (`RecommendedMcpInput` in `src/constants.ts`): labelled text/secret/folder/URL fields replace raw-JSON env entry. Secret-kind values (e.g. `SLACK_BOT_TOKEN`, Sentry auth token) are stored in VS Code SecretStorage and merged into the process env only at connect time via a new `McpServerConfig.secretEnvKeys` list — never written to `globalState`. New helper `buildWizardServerConfig` splits inputs into args/env/secrets; the registry gains `setServerSecrets` and deletes stored secrets on server removal.
- **Confirm-before-install for runtimes.** Runtime bootstrap moved to a shared `src/mcp/mcpRuntime.ts` (`checkStarterRuntime` / `runRuntimeInstallPlan`). A missing runtime (Node, uv, …) is now surfaced with the exact command (e.g. `winget install --id astral-sh.uv`) and only installed after explicit confirmation — replacing the previous silent auto-install in `atlasmind.mcpServers.installRecommended`.
- Recommended servers now carry a browsable `category` (Core, Cloud, Databases, DevOps, Messaging, Collaboration, Commerce & Social, Design); Filesystem, Git, PostgreSQL, Slack, and Sentry presets are now fully guided.

## [0.130.0] - 2026-07-24

### Added
- **Project Director — the people backbone of a project (Phase 1: data + service).** A new `ProjectDirectorManager` (`src/core/projectDirectorManager.ts`) models the **stakeholders, delivery team, responsibilities (who owns what), human task assignments, and follow-ups** around a project. It persists a `ProjectDirectorConfig` as the source of truth at `project_memory/operations/project-director.json`, regenerates a human-readable `project-director.md` mirror on every write, and keeps a capped `project-director-history.json` audit trail — `vscode`-free (node `fs` only) like `DeliveryManager`/`DataPrivacyManager`. New shared types (`DirectorContact`, `DirectoryRef`, `CommunicationLink`, `Stakeholder`, `TeamMember`, `Responsibility`, `Assignment`, `FollowUp`, `ProjectDirectorConfig`) live in `src/types.ts`.
- **Contacts as the identity layer; human-owner overlay for autonomous runs.** `Stakeholder` and `TeamMember` are thin role records that reference a shared `DirectorContact` by id, so one person can be both without duplicating their channels. `Assignment.linkedRunId` binds an autonomous `ProjectRunRecord` to a human owner **without mutating the run record** — the human-assignee layer that `SubTask.role` (an agent role) lacks.
- **Solo-dev friendly.** The people backbone serves a one-person project as well as a team. A first-class `selfContactId` ("me") is seeded from the git user; assignments and follow-ups default to you. A `teamMode` (`solo`/`team`/`auto`) with `resolveTeamMode`/`isSoloProject` infers **solo** when there is no team member other than yourself — so a solo dev is never asked to fill in stakeholder/team ceremony, the roster foregrounds self-management (your follow-ups and the areas you own), and external stakeholders (a client, end-users) are still supported when they exist. The markdown mirror shows the mode and tags "you".
- **GDPR-first, safety-first defaults.** AtlasMind prefers to *reference* people in their GDPR-compliant system of record (Microsoft 365 / Entra, Slack, Google Workspace) via `DirectoryRef` and resolve details on demand, rather than hoarding raw personal data locally; contacts that store raw PII are flagged `piiStored` for a one-time consent gate and the existing `gdpr-pii` classification. New `providerDataGovernance` entries (`m365`, `slack`, `google-workspace`) surface each source's DSAR/retention posture. `sanitizeProjectDirectorConfig` is the webview→disk boundary (length-clamp, enum-whitelist, id regeneration, drop role records referencing a missing contact, clear dangling optional refs, and strip any deep-link whose scheme is not allowlisted — `mailto:`/`tel:`/`sms:`/`slack:`/`msteams:`/`zoommtg:`/`https:` only). Communication `handle`s are non-secret identifiers, and the markdown mirror describes channels by *kind/label only* so raw addresses never enter git-tracked prose. Pure `deriveFollowUpUrgency`/`countOverdueFollowUps` classify follow-ups for later surfacing.
- **Extension wiring.** The manager is constructed per workspace, exposed on `AtlasMindContext` (`projectDirectorManager` + `projectDirectorRefresh`), and kept current by a `project-director.json` file watcher that reloads on external edits — mirroring the delivery pipeline precedent. *(The Director dashboard tab, guarded connector send/schedule, and scheduled reminders arrive in subsequent phases.)*

## [0.129.0] - 2026-07-24

### Added
- **A fixed Develop → Staging → Production website hosting pipeline.** Website Studio's Hosting & Platform dashboard now creates and persists exactly three environments with environment-specific readiness: Develop defaults to a loopback URL, Staging is a password-protected client-review subdomain of the Production domain, and Production is public and promotion-protected. The dashboard shows each stage, its URL/branch references, locked access posture, validation issues, and the handoff into the existing guarded Delivery workflow.
- **Safe hosted fallback for Develop.** When local hosting is not possible, Develop can be explicitly switched to a hosted fallback. It is never allowed to become a public preview: HTTPS and a password credential reference are required before readiness passes.
- **Server-enforced hosting invariants and topology checks.** `sanitizeWebsiteWorkspace()` reconstructs the three environments in their canonical order and ignores tampered access/protection fields. The readiness evaluator blocks insecure hosted URLs and a Staging hostname that is not the configured `<review-label>.<production-domain>`. Raw password-like labels are not accepted as credential references; only explicit references such as `SecretStorage:website.staging.password` or `env:WEBSITE_STAGING_PASSWORD` can enter SSOT.
- **Hosting pipeline coverage and documentation.** Website Studio tests now cover default environment creation, downgrade-resistant policy sanitation, hosted Develop requirements, Staging-domain validation, Markdown mirroring, and the rendered dashboard. Architecture, development, security, tool-execution, README, Website Studio guide, and wiki documentation describe the same boundary.

## [0.128.0] - 2026-07-24

### Added
- **Website Studio — an end-to-end client website workspace inside AtlasMind** (`src/views/websiteStudioPanel.ts`, command **AtlasMind: Open Website Studio**). Six connected dashboards cover client brief, sitemap, wireframes and visual-design review, UI system, platform readiness, and n8n workflow mapping. Each page carries independent wireframe, UI, content, and SEO status from not-started through approval; the low-fidelity section outline and design notes preserve the path from pencil-level structure to the client-reviewed layout.
- **Website platform catalog and delivery posture.** Website Studio models Cloudflare Pages, GitHub Pages, WordPress + Elementor, WordPress, Vercel, Netlify, Azure Static Web Apps, Shopify, Webflow, and custom targets. A project can mark one primary platform, record safe site/project/environment references, and track readiness. Publishing is intentionally delegated to the existing guarded Delivery pipeline; the Studio cannot silently deploy or trigger production.
- **Client intake import and website bootstrap.** Guided bootstrap now offers **Website / Marketing Site** and seeds `project_memory/domain/website.json` plus a human-readable `website.md` mirror without overwriting an existing plan. The Brief dashboard imports bounded JSON from forms, CRMs, or n8n normalization flows and maps common aliases such as `companyName`, `objectives`, `targetAudience`, and `kpis`.
- **n8n workflow mapping with a secret-safe boundary.** Workflow event, outcome, status, opaque workflow ID, instance URL, data/privacy notes, and a credential *reference* can be recorded. Credential values and webhook URLs have no schema field; URL validation rejects embedded credentials/query/fragment values, common secrets are redacted before persistence, and n8n webhook-shaped URLs are replaced with a redaction marker.
- **Website SSOT service and tests** (`src/core/websiteWorkspaceManager.ts`, `tests/core/websiteWorkspaceManager.test.ts`, `tests/views/websiteStudioPanel.test.ts`). All webview/import data is length/count bounded and sanitized, URLs and colors are allow-listed, item IDs are normalized and deduplicated, only one primary platform survives validation, both outputs pass the SSOT memory scanner before write, scripts remain nonce-protected, and arbitrary command/path messages are denied.

## [0.127.2] - 2026-07-04

### Changed
- **Renamed the protected release branch `master` → `main` and made `main` the repository's default branch.** Anyone landing on GitHub now sees the released, Marketplace-matching branch by default instead of the in-progress `develop` branch. `develop` remains the routine integration branch and normal push target.
  - **CI / release automation**: `.github/workflows/ci.yml` now triggers on `[main, develop]`; the `Release — promote develop to main` workflow (`release.yml`) opens its promotion PR with `--base main`.
  - **Delivery pipeline**: the Production stage in `project_memory/operations/delivery.json` (and its `delivery.md` runbook mirror) now targets `main`.
  - **Docs & instructions**: `CLAUDE.md`, `.github/copilot-instructions.md`, `CONTRIBUTING.md`, `docs/`, `wiki/`, and the `project_memory/` routines/operations/decisions/domain now reference `main` as the protected release branch. Branch-name-agnostic guards (the `git-push` protected-branch list, delivery branch detection, runtime push policy) already covered both names and are intentionally unchanged.
  - **Dependabot**: added `target-branch: "develop"` to both ecosystems so dependency PRs keep opening against the integration branch rather than the new default.

### Fixed
- **`.vscode/settings.json`**: resolved a committed, unresolved merge-conflict marker (both sides were identical) that had left the workspace settings file as invalid JSON.

## [0.127.1] - 2026-06-30

### Fixed
- **"Install in Ollama" (Local Model Advisor) now shows live progress instead of appearing to do nothing** (`src/views/settingsPanel.ts`). The button did fire `POST /api/pull`, but with `stream: false` it blocked silently for the entire multi-GB download behind a single static status line — and a stopped daemon failed quietly — so it looked inert. `installOllamaModel` now streams the pull (`stream: true`), parsing Ollama's newline-delimited JSON progress into live updates shown in the shared **"AtlasMind: Local Model Install"** output channel and a **cancellable** progress notification (parity with the LM Studio install). A reachability **preflight** (`isOllamaReachable`) gives a clear, actionable message when Ollama isn't running (e.g. *"Ollama is not reachable at …; run `ollama serve`"*) instead of a silent failure, and on success the local-model cache is invalidated so the new model is detected on refresh.
  - Talking to the API directly (which is exactly what the `ollama pull` CLI does under the hood) is deliberate: it works whether or not the `ollama` CLI is on `PATH` and honours a custom/remote `ollamaBaseUrl`, unlike shelling out to a local command.
  - The LM Studio and Ollama installs now share one **"AtlasMind: Local Model Install"** output channel.
  - **Tests**: `tests/views/localModelMatch.test.ts` gains coverage for `interpretOllamaPullLine` (progress %/bytes, bare status, error surfacing, blank/non-JSON keep-alives) and `formatByteCount`.

## [0.127.0] - 2026-06-30

### Added
- **Two-way AI instruction-set sync** — the **Settings → AI Instructions** page and a new **`/sync-instructions`** chat command now reconcile instruction sets *across* tools instead of only importing them into AtlasMind. Previously `syncAiInstructionFiles` was inbound-only: it concatenated other tools' files into `project_memory/domain/ai-instructions-sync.md` and never wrote back, with no conflict detection. The new flow gathers every detected tool's instructions (GitHub Copilot, Claude Code, Cursor, Cline, OpenAI Codex/AGENTS.md, Gemini CLI, Windsurf, Aider) **plus AtlasMind's own** (personality profile + project soul), reconciles them into one unified set, and mirrors that set back into each tool's file so they all share the same guidance — each in its own native format.
  - **New module `src/utils/aiInstructionMerge.ts`**: `gatherInstructionSources` (reads full content, strips AtlasMind's own managed blocks so the merge never re-ingests its mirror), `runInstructionMerge` / `parseMergeResult` (LLM reconciliation → unified directives + auto-resolved diffs + significant conflicts, defensively parsed), `runInstructionRender` / `renderUnifiedMarkdown` (per-tool re-expression with a deterministic fallback), `applyManagedInstructionBlock` (writeback) and `writeUnifiedToSsot` (SSOT mirror). LLM calls reuse `Orchestrator.completeBootstrap` via an injected `complete()` so the module is unit-testable.
  - **Conflicts are resolved in chat.** Trivial/compatible differences merge automatically; only *genuinely contradictory* rules (e.g. tabs vs spaces) are surfaced as numbered conflicts with a recommended pick and one button per option. **Nothing is written until every significant conflict is resolved** — the user clicks a recommendation, overrides with `choose <#> <#>`, then `apply`. In-flight state is persisted in `workspaceState` (`atlasmind.pendingInstructionSync`) so it survives across chat turns. All actions stay in chat via `workbench.action.chat.open` query buttons.
  - **Safety-first writeback**: only an AtlasMind-managed, delimited block (`<!-- atlasmind:shared-instructions:start … -->`) is ever written, only into files that already exist, with content outside the block preserved verbatim; JSON-config tools (Continue) are reported as skipped; all paths pass the existing traversal guards; malformed/empty LLM output aborts before any write.
  - **New shared helper `src/utils/managedBlock.ts`** (`upsertManagedBlock` / `stripManagedBlock`), factored out of `testingProtocolSync.ts` (which now reuses it) and used by both outbound writers.
  - **Settings page**: the AI Instructions page gains a primary **"Align all instruction sets (two-way)"** action (opens chat and runs `/sync-instructions`); the previous inbound-only behavior is preserved as a secondary **"Scan & import into AtlasMind only"** card.
  - **Tests**: `tests/utils/aiInstructionMerge.test.ts` and `tests/utils/managedBlock.test.ts` (20 cases — merge parsing incl. malformed/empty/conflict-filtering/index-clamping, per-tool render extraction, managed-block upsert/strip idempotence + content preservation, gather-with-strip, writeback detected/skipped sets).

## [0.126.0] - 2026-06-30

### Fixed
- **"Install in LM Studio" now works instead of failing with "terminated with exit code 1"** (`src/views/settingsPanel.ts`). The Local Model Advisor used to launch the install through a VS Code terminal whose `shellPath` *was* the `lms` binary. `lms get` is interactive by default — it waits for a quantization/confirmation choice that can't be answered in that context, so it exited non-zero and VS Code surfaced the raw "The terminal process … terminated with exit code: 1" dialog, with the actual error scrolling away as the terminal closed. The install is now run as a direct child process (no shell, argument array — so zero cross-platform quoting pitfalls) with the **`--yes`** flag, which skips the prompt and picks the recommended quant. Output streams live into a dedicated **"AtlasMind: LM Studio Install"** output channel, the download runs under a cancellable progress notification, and on failure the real reason (last stderr line / spawn error) is shown and the HuggingFace page is opened as a fallback. On success the local-model cache is invalidated and recommendations refresh automatically.

### Added
- **"Install in Ollama" is now offered for HuggingFace-sourced recommendations too** (`src/views/settingsPanel.ts`). Ollama can pull GGUF models straight from HuggingFace via the `hf.co/<owner>/<repo>` prefix, so the button is no longer hidden for `hf:`-tagged candidates — the host translates `hf:owner/repo` → `hf.co/owner/repo` before calling `/api/pull`. Every recommendation card now shows both **Install in Ollama** and **Install in LM Studio**.
- **"Already installed" indicator on recommendation cards** (`src/views/settingsPanel.ts`, `localModelMatchKey` / `findInstalledLocalMatch`). Installed-state detection was family-name-based and missed most HuggingFace-sourced models (e.g. candidate family "Deepseek V4" never equalled an installed id like `deepseek-v4:latest`). Matching is now done on a normalized identity key that strips the source prefix (`hf:` / `hf.co/`), keeps only the repo name, drops quant/tag noise (`:Q4_K_M`, `:latest`) while preserving the parameter size (`:14b`), and removes the `-gguf` suffix — so `hf:antirez/DeepSeek-V4-GGUF`, `deepseek-v4:latest`, and `hf.co/antirez/DeepSeek-V4-GGUF:Q4_K_M` all match. Matched cards show an **Installed · Ollama** / **Installed · LM Studio** badge (with the canonical family name as a fallback) instead of install buttons.
- **Input hardening**: the model id passed to `lms get` is validated against a strict character allow-list before spawning (defense-in-depth even though no shell is involved).
- **Tests**: `tests/views/localModelMatch.test.ts` (8 cases) covers `localModelMatchKey` normalization and `findInstalledLocalMatch` cross-runtime matching and fallbacks.

## [0.125.0] - 2026-06-29

### Changed
- **Quick-reply chips now appear reliably on far more question shapes** (`src/chat/participant.ts`, `detectResponseQuickReplies`). When an assistant reply ends with a question, the Chat panel shows one-tap pills — but detection used to only fire when the question was the literal last text with no internal punctuation, and only recognised inline `A, B, or C?` / yes-no, so many real questions silently fell back to a plain text box. The detector was rewritten to be both more robust and broader:
  - **Markdown / numbered option lists are now recognised** (the most common miss): a selection question followed by — or preceded by — a `1. … 2. … 3. …` or `- … - …` list (2–5 items, either order) becomes pick-one pills. A new `analyzeTrailingQuestion` locates the question and any adjacent option block instead of requiring the question to be the very last characters; it tolerates markdown emphasis (`**…?**`), leading list/quote markers, and a question clause that has internal punctuation.
  - **Broader yes/no coverage**: openers like *"Should we…", "Shall we…", "Could I…", "Do you need…", "Want me to…"* and confirmation tails like *"…sound good?", "…look good?", "…make sense?"* now produce Yes/No pills.
  - **Still conservative — no false pills.** A list only becomes pick-one when the question is genuinely a selection question, so a yes/no question above a *findings* list stays Yes/No, and an open question (*"What do you think?"*) above a list still surfaces a plain text box, never fabricated buttons.
- **Tests**: `tests/chat/participant.helpers.test.ts` gains 6 cases (numbered list after the question, bulleted list before it, yes/no-above-findings stays yes/no, broadened openers + confirmation tails, open-question-no-pills, and markdown-emphasis extraction).

## [0.124.0] - 2026-06-29

### Added
- **"Resolve & run" — fixable preflight failures can be fixed inline as part of a promotion** (`src/core/promotionRunner.ts`, `src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`). When a promotion is blocked only by auto-checks AtlasMind can repair — **version not bumped** and **missing changelog entry** — the promotion modal now offers a single **Resolve & run** button instead of dead-ending. It bumps `package.json`, adds a `CHANGELOG.md` entry, commits them (`chore(release): vX.Y.Z`), then runs the promotion — all under the single-flight delivery lock. AtlasMind commits the two edited files path-scoped (never sweeping in unrelated changes) and **never pushes or force-pushes**.
  - **The version level is assessed from the changes**, not hard-coded: the conventional-commit history between the target and the source is classified (`feat` → minor, a `type!:` subject or `BREAKING CHANGE` footer → major, otherwise patch), matching both general SemVer practice and repos whose stated rules follow it. The modal shows what it will do and why (e.g. *"bump 0.0.0 → 0.1.0 (minor); add a CHANGELOG entry for 0.1.0; commit … — minor — at least one feature since Staging."*).
  - **Safety-preserving.** The offer only appears when *every* failing auto-check is fixable (a failing CI/separation-of-duties/working-tree check disables it — editing version/changelog can't unblock those). The user's own gates (manual attestations, approval, protected type-to-confirm) must already be satisfied before Resolve & run is enabled (`evaluatePromotionGateExceptFixable`), and the **full** gate is re-enforced on the rebuilt plan after the fix, before anything deploys. The edits/commit are server-sourced from the computed plan; the webview can only trigger the action, never inject content. The git commit runs via `execFile` (argument array, **no shell**) and the version is validated against a strict semver pattern before it is written or committed, so a version string can never be interpreted as a command.
  - **Types**: `PromotionRemediation` and `PromotionPreflightCheck.fixable` (`src/types.ts`); `PromotionPlan.remediation`. **Engine**: `classifyBumpLevel`, `bumpVersion`, `setPackageJsonVersion`, `insertChangelogEntry`, `buildInitialChangelog`, `applyPromotionRemediation`, `evaluatePromotionGateExceptFixable`.
  - **Tests**: `tests/core/promotionRunner.test.ts` (20 cases — bump-level classification, version bump, package.json/changelog edits, remediation assembly incl. non-fixable-failure suppression and changelog-only/no-bump, and the relaxed gate).

## [0.123.0] - 2026-06-29

### Added
- **Persistent model-struggle memory that de-weights models on the task kinds they keep failing.** AtlasMind now learns, across sessions, when a specific model under-performs on a specific *kind* of task and routes around it — directly targeting the recurring "drift down to a weak/cheap/local model" pattern. Implemented as a new struggle store on `ModelRouter` (`src/core/modelRouter.ts`), persisted in VS Code `globalState` under `atlasmind.modelStruggleSignals` (machine-level — reliability is about the model, not the project) and restored on activation.
  - **Signals recorded** (`Orchestrator.noteModelStruggle`, `src/core/orchestrator.ts`): provider **timeout**, **empty completion**, **tool-call-as-text** (a model that emits a tool call as plain text instead of a structured `tool_calls` response — the exact failure the grader used to miss), **error finish**, and **user-correction** (best-effort: a turn like *"no, that's not correct"* attributes a struggle to the model that produced the previous top-level answer; billing/deprecation failures are excluded since they say nothing about model quality).
  - **Keyed by a low-cardinality task signature** — `phase | modality | reasoning | requiresTools` — so a model is only de-weighted for the task kind it actually fails (e.g. high-reasoning planning), not globally.
  - **Marginal + escalating + decaying.** Each struggle folds a severity-weighted increment onto the model's decayed penalty (capped). A small penalty breaks near-ties; once a model crosses the threshold for a signature, a **budget tier-escape** re-opens candidacy one tier higher (`cheap → balanced → expensive`) and re-ranks, so a capable (pricier) model can take over the task kind the cheap model keeps failing — the penalty alone can't overcome the `cheapness × 14` budget weight, so this is what actually fixes the drift. Penalties decay with a ~2.5-day half-life and a clean turn halves them, so transient glitches fade while genuinely weak models stay de-weighted. Gated by the existing learned-routing weight (`atlasmind.feedbackRoutingWeight = 0` disables it).
  - **Surfaced in the Model Comparison panel** (`src/views/modelComparisonPanel.ts`): a model with an active de-weight shows a **"de-weighted: …"** badge with a tooltip explaining the task signature, the number of struggles, the most recent kind, and that the penalty decays over ~2.5 days.
- **Types**: `ModelStruggleKind` and `ModelStruggleState` (`src/types.ts`); `OrchestratorHooks.onModelStruggleRecorded` to persist the snapshot, mirroring `onModelOutcomeRecorded`. **Router API**: `recordModelStruggle`, `recoverModelStruggle`, `getStruggleSignals`/`setStruggleSignals` (validated round-trip; drops malformed/fully-decayed entries), and `getStruggleSummary` (active de-weights for diagnostics/UI).
- **Tests**: `tests/core/modelRouter.test.ts` (signature isolation, tier-escape flips a chronically-struggling cheap model to a capable one, soft-not-hard never starves the sole candidate, decay + restore filtering, feedback-weight gating, accumulate/recover, malformed-entry rejection) and `tests/core/orchestrator.tools.test.ts` (timeout records a `timeout` struggle; a correction turn records a `user-correction` struggle against the previous turn's model).

## [0.122.1] - 2026-06-29

### Fixed
- **Provider-failure recovery no longer leaks the local echo stub's prompt-parrot as the final reply.** When a provider failed mid-turn (e.g. `Provider "google" failed with: Provider timed out after 30000ms.`) and no failover model was available, the hard-stop recovery called `completeMaintenance()` to generate a human-readable acknowledgement. If routing fell back to the built-in `local/echo-1` placeholder — `ModelRouter.selectModel()` returns it when no real model is selectable, and `LocalEchoAdapter.complete()` simply echoes the prompt — the recovery "message" became `Local adapter response: Task the user asked: …\n\nFailure context: Provider "google" failed with: …`. The `recoveryContent.trim().length > 20` guard accepted that echo as valid, so the turn concluded by surfacing the **internal recovery prompt and raw failure-context string** to the user instead of a coherent answer. `completeMaintenance()` and `completeBootstrap()` now detect the echo adapter's sentinel (new exported `LOCAL_ECHO_RESPONSE_PREFIX` in `src/providers/registry.ts`) and return an empty string, so the recovery path falls through to a clean, actionable template (acknowledges the provider stopped responding, confirms nothing was changed, and points to **AtlasMind: Model Providers**) and the response can conclude. New regression test in `tests/core/orchestrator.tools.test.ts`.

## [0.122.0] - 2026-06-22

### Added
- **Proposed project runs flow straight through — no more dead-end "Proceed".** When an AtlasMind chat reply ends by offering to start an autonomous project run (e.g. *"…want me to kick off a project run to build this out?"*), the turn no longer stops and waits for you to type **Proceed**. You already asked for the job, so AtlasMind now continues into the run on the same turn: **immediately** under Autopilot (with a brief *"Autopilot — auto-continuing into a project run"* notice), or after a cancellable *"Starting a project run to: … — use Stop to cancel"* notice otherwise. The run reuses the exact goal that typing "Proceed" would have resolved, so nothing about execution changes — only the redundant keystroke is gone. Auto-flowed runs pass the **bare goal** (not pre-approved), so `runProjectCommand`'s `approvalFileThreshold` safety gate still pauses unusually large runs to show the plan before any files change. New `detectProjectRunProposal`, `buildProjectRunAutoFlowNotice`, and `resolveProjectRunAutoFlow` helpers in `participant.ts` drive the detection for both the `@atlas` chat participant and the chat panel. Detection is conservative — it requires explicit project/autonomous-run vocabulary plus a first-person go-ahead, vetoes negation/deferral, and never fires when the reply is still gathering requirements. Controlled by the new `atlasmind.autoStartProposedProjectRuns` setting (default **on**); set it to `false` to keep the previous Yes/No-pill confirmation.

## [0.121.2] - 2026-06-22

### Fixed
- **Local endpoints now save and persist.** Adding an OpenAI-compatible local endpoint (Ollama, LM Studio, etc.) in **Settings → Models & Integrations** silently failed: the endpoint vanished on refresh and never appeared in the Model Providers sidebar. The cause was that `atlasmind.localOpenAiEndpoints` was documented but never registered in `package.json`'s `contributes.configuration`, so VS Code's `configuration.update()` rejected the write for an unregistered key — and because the Settings webview message handler is fire-and-forget (`void handleMessage(...)`), the rejection was swallowed with no error shown. The setting is now registered (typed array of `{ id, label, baseUrl }`), so edits persist to workspace settings and survive a refresh. The `setLocalOpenAiEndpoints` handler also now surfaces any remaining persistence failure (e.g. no workspace folder open) as an error notification instead of failing silently.

## [0.121.1] - 2026-06-21

### Fixed
- **MCP git/workspace tools no longer fail with "repoPath is required".** When the model invokes an MCP tool whose schema declares a repo/working-directory parameter it omitted (e.g. GitKraken's `git_status` / `git_commit` needing `repoPath`), `McpClient.callTool` now defaults that parameter to the current workspace folder before dispatch. Only string-typed, currently-empty params whose name denotes a repo/working path (`repoPath`, `projectPath`, `cwd`, `workingDirectory`, …) are filled — a bare `path`/`file` argument is left untouched, and an explicit caller value is never overridden. Surfaced by the new roadmap plan hand-off, which now runs the model (and its tools) instead of returning a deterministic dump.

## [0.121.0] - 2026-06-21

### Added
- **Roadmap replies now ask before they plan, and answer in one shot.** When you ask AtlasMind to *plan/build the route to MVP* and the SSOT has unanswered project basics (`Project type`, `Target audience`, `Timeline`, `Tech stack`, …), the deterministic `atlasmind/roadmap-status` reply no longer dumps the backlog — it returns a focused **"Plan your MVP"** ask listing just those gaps as direct questions, with a single **"Answer all N questions"** chip that pre-fills the composer with a fill-in-the-blank block so you resolve every gap in one message. Once answered, planning hands off to the model. Explicit *status/progress* questions still get a **Roadmap Status** summary, now leading with the same answerable questions + combined chip and with the outstanding list rendered in a collapsed disclosure. New `buildRoadmapStatusResult` (returns markdown + questions + prefills), `isRoadmapPlanIntent`, and a `composerPrefills` message-metadata field (`SessionComposerPrefill`, with optional `cursorOffset`) carry the chip to the chat panel.

### Changed
- **Roadmap status counts only real open work.** Shipped `release-history.md` notes, already-resolved metadata (e.g. `Tech stack: C#`), and scaffold/legend prose outside the managed backlog block (Project Context, Prioritisation Notes) are excluded from the tally, so the `X/Y` progress figure and the outstanding list reflect genuine backlog items. Only checklist lines inside `<!-- atlasmind:roadmap-items:start/end -->` count as outstanding. Mangled auto-generated questions from `Clarify/Define`-style backlog items are gone — only clean profile-field questions are posed; the rest stay as outstanding tasks. Outstanding entries also drop the redundant double `[ ]`.

## [0.120.4] - 2026-06-21

### Changed
- **Decluttered the top of the chat panel.** Replaced the noisy `Sessions`/`Standalone Runs` text toggles and the redundant "Dedicated Workspace / AtlasMind Chat / subtitle" block with a single compact control strip: the `AtlasMind / project` title stays on top, followed by a Runs icon, a Chat-Threads icon with the session count and the `+` new-session button, and the five chat action buttons (font −/＋, clear, copy, open-as-Markdown) right-aligned on the same line. Chat threads and standalone runs now open as their own dropdowns beneath the strip — the runs icon is a permanent peer of the chat-threads icon and always toggles its dropdown, showing a "No standalone runs yet." empty state instead of silently doing nothing when there are none. The dynamic active-thread title and run-mode guidance are preserved and surface only as a slim banner while inspecting an autonomous run. Dissolves the separate session rail, so the wide editor-tab view uses the same clean dropdown layout at every width.

## [0.120.3] - 2026-06-21

### Changed
- **Comparison matrix re-verified against each competitor's official docs (June 2026) and a Mission Control row added.** Every cell for all seven competitors was checked against current sources; stale entries were corrected:
  - **Multi-provider routing counts** updated to current figures — Cline **8+ → 30+ providers**, Aider **8+ → 100+ providers**, Cursor **4+ → 5+ providers + custom API**.
  - **Custom agent definitions** corrected: Claude Code's artifact is **subagent `.md` files** (not CLAUDE.md, which is memory); GitHub Copilot now ships **`.agent.md` custom agents** (⚠️), and Cursor (custom modes), Windsurf (workflows + rules), and Continue (model+rules+tools agents) moved ❌ → ⚠️.
  - **Windsurf**: image input ⚠️ → ✅, MCP "via Cascade" → fully Cascade-integrated, checkpoints "limited" → **named checkpoints + revert**, and **voice input** (Cascade) noted (⚠️).
  - **Aider**: **voice-to-code** input noted (⚠️).
  - **CLI companions**: Cline (preview CLI), Cursor (Cursor CLI), Continue (CLI), and GitHub Copilot (Copilot CLI) now ship CLIs — all ❌ → ⚠️.
  - **Cost tracking**: Cursor ❌ → ⚠️ (usage dashboard + spend caps) and Claude Code ❌ → ⚠️ (`/cost`) in the README "What Makes AtlasMind Different?" table.
  - **New row — "Goal-seeking autonomous loop runs (Mission Control)"** added to the wiki Comparison matrix and the README table, distinguishing AtlasMind's budget-bounded, self-evaluated, checkpoint-gated loop from Claude Code's `/loop`, Copilot's agentic/cloud loops, Cline's auto-approve mode, Cursor's iterating agents, and Aider's scriptable test-fix loop.
  - Comparison freshness caveat reworded to "verified against official documentation in June 2026".

### Fixed
- **Project Run Center webview script no longer fails to parse.** The client IIFE used `.replace(/\n/g, …)` inside a template-literal-generated script, so the `\n` was emitted as a real newline and produced an unterminated regex (`Invalid regular expression: missing /`) — a syntax error that broke the *entire* Run Center client script, including every topbar button and the Mission Control cross-link, while the static HTML still rendered. Escaped it to `/\\n/g` so the emitted regex is valid.

## [0.120.2] - 2026-06-21

### Fixed
- **README and Comparison matrix accuracy.** Corrected stale/inconsistent figures verified against source:
  - **Built-in skill count** was stated three different (wrong) ways — README "35 pre-built skills" and "36 built-in skills", and the Comparison matrix "32". The actual count is **43** (`createBuiltinSkills()` returns 42 plus the default-on `discover-resources` skill). Updated all three, rebuilt the README skills table to list the 7 previously-missing skills (`npm-scripts`, `git-blame`, `framework-detect`, `simple-browser`, `log-file-tail`, `debug-launch`, `debug-breakpoint`) under their real categories (adding the missing **Debugging** category), and synced the stale "32 built-in skills" figure in the wiki Home, Getting-Started, FAQ, and Architecture pages to 43.
  - Comparison "10-rule scanner" → **12-rule** memory write-gate scanner (matches `memoryScanner.ts`).
  - Comparison "12+ providers" → **20+ providers** (`ProviderId` enumerates 24 named providers).
  - Comparison freshness caveat updated from "mid-2025" to "mid-2026".
  - (Verified accurate and left unchanged: 15 built-in agents, 23 testing methodologies, 7 secret-redaction patterns, 12-rule skill-import scan.)

## [0.120.1] - 2026-06-21

### Changed
- **Mission Control now uses the Project Dashboard design system.** The previous refresh restyled Mission Control with `--vscode-*` tokens, so it still didn't match the dashboard pages. It now adopts the dashboard's shared `--dash-*` design tokens directly — the same gradient page background, 20px-radius gradient **panel-cards** with soft shadows, display-font headings, `page-intro`-style topbar, accent buttons, intro chips, and tone status dots — so Mission Control is visually consistent with the Project Dashboard (and the Delivery page) rather than just approximating it.

## [0.120.0] - 2026-06-21

### Changed
- **Mission Control design refresh + Run Center ↔ Mission Control cross-links.** The autonomous-loop console — previously the least-styled operational panel — now matches the rest of the suite, and the two autonomous-delivery surfaces link to each other:
  - **Mission Control** gains a plain-English **intro topbar** (kicker + title + summary) with a live status chip, its form sections are now **cards**, the launch/stop/decision controls are restyled, and the **Recent missions** list carries **tone status dots** (achieved → good, stopped → warn) on each row. No hover-capable control is inert.
  - **Cross-navigation**: the Project Run Center header gains a **"🛰 Mission Control"** button and Mission Control gains a **"▶ Project Run Center"** button, so you can move between manual run review and autonomous missions in one click. Both use the existing validated webview → command bridge (`atlasmind.openMissionControl` / `atlasmind.openProjectRunCenter`).

## [0.119.0] - 2026-06-21

### Changed
- **Design refresh extended to the Cost Dashboard, Project Run Center, and Project Ideation panels.** Following the Project Dashboard refresh, the same visual-indicator and no-dead-hover language now reaches the other operational webviews:
  - **Cost Dashboard** — every summary card (and the feedback summary cards) gains a tone **status dot** (good/warn/critical/accent), and the budgeted **Today's Spend** card shows a budget-pressure **meter**; the approval-rate card is toned by its actual rate. No interactive element is inert — all hover-capable controls (cards, rows, toggles) already resolve.
  - **Project Run Center** — the "Current posture" pills (Selected run / Run progress / Change scope / Preview) now carry **live tone dots** driven by the existing run/preview state (`setDotTone` + `getStatusTone`), so run state reads at a glance alongside the existing workflow stepper. Dead-hover audit confirmed every card/chip/summary control resolves.
  - **Project Ideation** — the hero stat cards (Active cards / Runs / Queued media) gain tone status dots consistent with the rest of the suite; the already-interactive canvas, inspector, and composer were audited and left intact.

## [0.118.0] - 2026-06-21

### Changed
- **Project Dashboard design refresh — every page brought up to the Delivery standard.** The Delivery page's modern feel (visual indicators, plain-English guidance, and fully clickable cards) is now applied across the whole dashboard:
  - **No more dead hover.** Cards that *looked* clickable (hover-lift, focus ring) but did nothing now always resolve to an action — opening a file, jumping to another page, running a command, or starting an Atlas chat — and anything with no sensible action renders as a genuinely static element with no misleading affordance. Signal cards, repo branch cards, and the stat/action/recommendation/score-component cards were the main offenders; the shared `renderSignalCard`, `renderMetricPill`, `renderStatCard`, `renderActionCard`, `renderRecommendationItem`, and `renderScoreComponent` helpers were reworked to a resolve-or-static rule via a new `resolveActionAttrs`.
  - **Visual indicators everywhere.** Metric pills gained tone status dots and inline meter bars; pages gained a generalised `renderFlowStrip` (the Delivery pipeline-flow idiom) for at-a-glance status — e.g. the Operational Score now shows its component composition as a coloured strip.
  - **Natural-language orientation.** Every page (Score, Repo, Runtime, Testing, SSOT, Security, Gap Analysis, Privacy) now opens with a `renderPageIntro` band: a one-line plain-English summary of "what this page is and what to do", tone chips, and a primary action.
  - **Standout fix — Security.** The governance signals (SECURITY.md, CODEOWNERS, PR template, issue templates, dependency governance) now open the file when present, or hand Atlas a focused prompt to create it when missing — previously they were inert.
  - Cost-related Runtime tiles now open the Cost Dashboard (`atlasmind.openCostDashboard` added to the dashboard command allowlist). Also fixes a malformed `</p>` tag in the Privacy page's "no trusted model" warning.

## [0.117.0] - 2026-06-21

### Added
- **Road to MVP on the Roadmap dashboard.** The Project Dashboard's Roadmap page now opens with a dedicated **Minimum Viable Product** section that turns the flat backlog into a guided path to a first shippable product:
  - **MVP path (hybrid tagging).** Mark any backlog item as part of the MVP with a per-item **Mark MVP** toggle; membership is stored non-destructively as a `#mvp` tag inside the existing managed block of `project_memory/roadmap/improvement-plan.md` and round-trips cleanly (the tag is metadata, never shown in the item text). When nothing is tagged yet, the dashboard falls back to **heuristic suggestions** (security, architecture, and other foundational items) so the section is useful out of the box, and offers **Add to MVP** on each suggested candidate.
  - **Visual guide.** A progress bar and a numbered **milestone track** show how far along the road to MVP the project is — each node rendered done / active (next) / pending, with the count of completed vs. remaining milestones and a percent-to-MVP readout.
  - **AI-assisted route.** A deterministic **best-route** ordering front-loads foundational, security, and architectural work and explains the reasoning for each step, with a highlighted **Next step** callout. A **Plan the MVP route with Atlas** button hands a focused prompt to a live Atlas chat session for a deeper, dependency-aware plan — reusing the existing Gap-Analysis handoff pattern (no model calls are added to dashboard refresh, preserving its non-blocking, redaction-safe behavior).

## [0.116.5] - 2026-06-21

### Fixed
- **Delivery Dashboard now shows the real Production version.** A stage's deployed version was read straight from its local branch (`git show master:package.json`). In the normal workflow a developer lives on `develop` and never checks out or pulls `master` — releases land via PR merges on the remote — so the local `master` ref is badly stale (in this repo it sat at `0.79.2` while `origin/master` was `0.116.4`), and the Production stage reported that stale version. The dashboard now reads the deployed version from the **remote-tracking ref** (`origin/<branch>`) when it exists, falling back to the local ref for offline/local-only repos. Added `chooseDeployedVersionRef` (pure, unit-tested) and applied it to the stage views, the promotion version facts, and the version strip's production card. (The branch name shown for the stage is unchanged — only the version source moved to the remote.)

## [0.116.4] - 2026-06-21

### Fixed
- **No more `[object Object]` flooding a reply.** The OpenAI-compatible adapter cast a streamed/returned `content` field to `string` unconditionally (`delta['content'] as string`). When an endpoint (proxy, local server, or a vision/reasoning format) delivers `content` as an **array of content parts** (`[{ type: 'text', text: '…' }]`) or a part object, the streaming path concatenated `[object Object]` for every delta — flooding the answer — while the non-streaming path would crash on `.trim()`. Added `coerceOpenAiContentText`, which normalizes string / array-of-parts / part-object shapes to text and contributes nothing for unknown shapes (never `[object Object]`). Applied in the streaming and non-streaming OpenAI-compatible paths and the local-endpoint path in `ProviderRegistry`.
- **"Describes the fix but never applies it" is no longer silent.** When the red-to-green TDD gate blocks an implementation write and the model then settles by only *describing* the change, AtlasMind now re-prompts once to complete the cycle (write the smallest failing test, observe red, apply the fix). If it still settles without doing so, a deterministic **"Change not applied"** caveat (`appendTddBlockedCaveat`) is appended so a blocked fix can never read as if it landed. Added orchestrator and provider-adapter tests for both fixes.

## [0.116.3] - 2026-06-20

### Fixed
- **A user correcting the assistant is never downgraded to a weak model.** When a turn disputes or corrects the previous answer (`isUserCorrectionTurn` — "that's not correct", "no, that's wrong", "you got it wrong", "are you sure?", "re-check that"), the orchestrator now forces **high** reasoning, prefers a reasoning-capable model, and escalates the routing budget/speed (`budgetForCorrection`: `cheap → balanced`, otherwise `→ expensive`; speed `→ considered`). Previously a pushback against a wrong answer could be silently routed to the cheapest/local model — the failure that let a flaky local model field a high-stakes correction.
- **An empty model completion now escalates instead of surfacing a blank turn.** The self-recovery path used to re-prompt the *same* model that returned nothing — typically a flaky/under-powered local model that returns empty again. It now records the empty result as a model failure (so routing avoids it this session) and retries on an **escalated, reasoning-class model** (`selectEscalatedModel`), falling back to the original model only when nothing better exists. A zero-output completion is treated as a failure to recover from, never presented as the assistant's reply.
- Added orchestrator tests for `isUserCorrectionTurn`, `budgetForCorrection`, and the empty-completion escalation path.

## [0.116.2] - 2026-06-20

### Fixed
- **Delivery pipeline no longer fabricates a `main` production branch.** When the repository's production branch couldn't be detected, `seedDeliveryConfig` silently defaulted the Production stage's `branchRef` to `"main"` — a branch that may not exist (this repo uses `master`/`develop`). The seeder now leaves the production branch **unset** when detection finds none, so the dashboard reports an honest "not detected" instead of importing a wrong branch that could mislead a promotion target. The runbook mirror labels a branchless non-local stage `— (not detected)` (the genuinely branchless Local stage still reads `— (working tree)`). Also corrected the persisted `project_memory/operations/delivery.json`, whose Production `branchRef` had been hand-edited to the incorrect `"main"`, back to `"master"` (restoring agreement with the `delivery.md` mirror). Added `tests/core/deliveryManager.test.ts` covering branch import and the no-fabrication guarantee.

## [0.116.1] - 2026-06-20

### Fixed
- **Garbled verification output in chat summaries.** Captured tool output (e.g. `vitest`) carries ANSI colour/cursor escape sequences. On the chat surface the invisible ESC byte left fragments like `[1m[7m[36m RUN …` in the post-write **Verified:** summary. Verification output is now sanitised before display: ANSI/CSI/OSC escape sequences are stripped, carriage returns are folded, and stray control bytes are removed. Added `src/utils/terminalOutput.ts` (`sanitizeTerminalOutput`, `stripAnsiSequences`) as the shared sanitizer; the managed-terminal streaming path now uses the same helper (which also strips OSC shell-integration markers the previous CSI-only stripper missed).

## [0.116.0] - 2026-06-20

### Added
- **Delivery hardening pt 2 — the remaining gaps.**
  - **Concurrency lock.** A workspace lock (`project_memory/operations/.delivery-lock.json`) guarantees only one promotion *or* rollback runs at a time; a second is refused with a clear message (the lock auto-clears after 60 min if a run crashes).
  - **Trigger-CD promotion.** When a stage sets `promotionPolicy.dispatchWorkflow` (auto-detected from a `workflow_dispatch` deploy/release workflow when no routine is bound), the promote step becomes **`gh workflow run <file>`** — production deploys run in CI/CD with its identity and logs, not on the developer's machine.
  - **Backup verification + migrations as managed steps.** `backupPolicy.verifyCommand` runs right after the backup and must pass (turning "backup ran" into "backup verified"); `data.migrateCommand` applies schema changes inside the guarded sequence (after backup, before deploy).
  - **Separation of duties.** `promotionPolicy.requireDistinctApprover` adds an automatic gate that the person promoting (git actor email) must differ from the author of the change being promoted (source head-commit author); when identities can't be resolved it degrades to a manual attestation.
  - All four are editable in the stage editor and surfaced as stage **security notes** / preflight checks / plan steps.

> Deferred (warrant dedicated design; representable today via custom stages + routines): first-class **progressive delivery** (canary / blue-green) and **ephemeral per-PR preview environments**.

## [0.115.0] - 2026-06-20

### Added
- **Delivery hardening — gap-analysis follow-up across four fronts.**
  - **Real CI enforcement (not honor-system).** Required CI status checks are now **verified live** via `gh` at promote time (check-run status for the source branch's head commit) — a failing *or still-pending* check makes the preflight gate refuse. When `gh` is unavailable it gracefully falls back to manual attestation. Previously "CI green" was a checkbox.
  - **Audit log + executable rollback.** Every promotion and rollback is appended to `project_memory/operations/delivery-history.json` (who/when/what/outcome) and shown as **Recent promotions** on the dashboard. Stages with a rollback command get a **Roll back** action (two-click; protected stages require typing the stage name); it executes the user-authored command and is itself audited.
  - **Broader import (polyglot + PaaS/IaC).** Detection now recognises Python / Go / Rust / Java / .NET projects (manifests, web frameworks, ORMs, conventional build/lint/test) and PaaS/IaC targets — Fly.io, Vercel, Netlify, Render, Google App Engine, Serverless, Kubernetes, Terraform, containers — feeding production hosting + database presence. A production URL is derived where possible (e.g. fly.toml app → `https://<app>.fly.dev`).
  - **Readability.** A compact **pipeline flow diagram** (stage → stage with branch + deployed version + status) heads the Delivery page, and each stage with a health URL gets a **Test health** button that pings it and reports the status.
- New engine/exports: `runRollback`, `checkHealthUrl` (`promotionRunner.ts`); `appendPromotionHistory`/`readPromotionHistory` + `PromotionHistoryEntry` (`deliveryManager.ts` / `types.ts`).

## [0.114.0] - 2026-06-20

### Added
- **Delivery seeding now imports the Git PR/CI promotion protocol as first-class.** Previously the pipeline only added a generic "CI green" label and left the real mechanism implicit inside a routine's shell. The importer now detects, per branch: whether promotion goes **through a Pull Request** (from GitHub **branch protection** via `gh` when available — `required_pull_request_reviews` — with graceful fallback to the bound routine's `gh pr create`), and the **exact required CI status checks** (branch-protection contexts, e.g. `quality (ubuntu-latest)`, else the gating workflow names parsed from `.github/workflows`). New `StagePromotionPolicy.viaPullRequest` and `requiredStatusChecks` fields carry this. The promotion dialog/runbook now lists each CI check as a preflight item, the stage card and push card show a **"🔀 via PR"** badge and the real check names, the runbook describes *"Promote via Pull Request into a protected branch"*, and a **guardrail blocks a PR-required promotion that has no routine bound to open the PR** — so a protected branch is never targeted by a direct push. AtlasMind's own `delivery.json` was regenerated with this (Production = PR-required into `master` with the three `quality` checks; Integration = direct-push `develop`, CI-gated).
- A best-effort `gh` branch-protection probe runs only at seed / re-import (never on the render path), with a short timeout and full fallback to local signals when `gh` is unavailable.

## [0.113.0] - 2026-06-20

### Changed
- **Delivery seeding now imports the repository's *actual* protocol instead of a generic template.** Previously the pipeline was seeded from branch names alone and assumed a web-app-with-database shape, producing inaccurate fields for projects that don't match — most damagingly a phantom "production database" with a required-but-empty backup command, which **deny-by-default blocked the production push for a database that doesn't exist**. Seeding now imports real signals: **project archetype** (VS Code extension / library / web service / generic), **database presence** (dependency + `migrations`/`prisma` detection), **publish target** (VS Code Marketplace / npm / container registry), **`.env` files** (only referenced when they exist), **package scripts** (required checks mirror the `compile`/`lint`/`test` you actually have, plus "CI green" when workflows are present), and **existing routines** (the production push binds to your real publish/release/ship/deploy or default routine — e.g. `publishing-routine` — instead of inventing non-existent ones). Deploy-less projects get an **Integration** stage (mapping the integration branch) rather than a fictional staging-server-with-DB, and no backup gate is imposed when there is no database.

### Added
- **"Re-import from repo" action on the Delivery page.** Re-detects the current signals and rebuilds the pipeline, so an already-seeded project (whose protocol has since moved on, or which was seeded by the old generic logic) can refresh to match reality. Two-click confirmed, and it re-baselines the review state.
- Regenerated AtlasMind's own `project_memory/operations/delivery.json` with the corrected importer (Marketplace production bound to `publishing-routine`, no phantom database/backup gate).

## [0.112.1] - 2026-06-20

### Security
- **Resolved all 6 open Dependabot alerts (2 high, 2 moderate, 2 low) by forcing `undici` to `^7.28.0`** via an npm `overrides` entry. Every alert traced to a single transitive **dev-only** dependency (`@vscode/vsce` → `cheerio` → `undici@7.27.2`), used by the packaging/publishing toolchain — it is **not part of the shipped extension runtime**, so installed users were never exposed. The advisories (SOCKS5 proxy request routing / TLS validation bypass, Set-Cookie `SameSite` downgrade, HTTP response-queue poisoning, header injection, and shared-cache disclosure) are all patched in undici 7.28.0. `npm audit` now reports **0 vulnerabilities**.

## [0.112.0] - 2026-06-20

### Added
- **Delivery pipeline stays current and flags drift since your last review.** The Project Dashboard → Delivery page now **auto-refreshes** when `project_memory/operations/delivery.json` changes outside the dashboard — a hand edit, a teammate's change pulled via git, or a script — via a file watcher that reloads the pipeline and re-renders (previously the config was read once at startup and could go stale). On top of that, a **"Review needed" banner** appears when the delivery setup has changed since you last reviewed it: the configuration was edited externally, a new stage-candidate branch appeared (e.g. `release/*`, `staging`, `prod`), a stage's branch went missing, or the CI/CD workflow files changed. A **Mark reviewed** button snapshots the current state as the new baseline so the banner clears until something drifts again; saving edits through the dashboard editor counts as a review automatically (the banner is for drift you did *not* make). Review state is workspace-scoped and never committed.

## [0.111.1] - 2026-06-20

### Changed
- **Releases are now git-tagged automatically.** `npm run publish:release` now creates and pushes a `v<version>` annotated tag after a successful publish, via `.github/scripts/tag-release.mjs` (`npm run tag:release`). The tagger is cross-platform and idempotent (skips if the tag already exists), so every Marketplace release gets a matching tag without anyone having to remember. The publishing routine in `CLAUDE.md` documents the step. (v0.111.0 was tagged manually to backfill the current release.)

## [0.111.0] - 2026-06-20

### Changed
- **The chat panel's "New Loop" send-mode now starts in its own fresh session.** Selecting **New Loop** spawns a new chat session (like **New Session**) and runs the mission there, so the autonomous loop's transcript stays isolated from the current conversation.
- **Mission Loop checkpoint and block prompts are now in-surface buttons, not OS modal dialogs.** In the **chat panel** they render as a decision card with buttons at the base of the chat bubble (matching the tool-approval affordance) and resolve via a `resolveLoopDecision` message; in **Mission Control** the checkpoint and the recoverable-block recovery now share one in-panel decision card with dynamic buttons (override / open settings / stop) — no more Windows/macOS system dialog boxes for panel-driven loops. The `@atlas` chat *view* (which can't host in-line blocking buttons) keeps a modal fallback. Surfaces inject their presentation via a new `MissionLoopInteraction` (`runLoopCommand`'s optional `interaction`), while the override side-effect stays centralised in `createMissionSettingBlockGate(ask)`.
- **Mission Loop no longer silently cancels when blocked by a recoverable setting.** When a loop can't make verifiable progress because of a relaxable AtlasMind setting — e.g. tests can't run because `atlasmind.allowTerminalWrite` is off — it now **asks the user before stopping** instead of ending the run, offering **Override for this run** (relaxes the setting just for this mission, then reverts when it ends), **Open settings** (deep-links to the Safety page), or **Stop**. Deny-by-default: dismissing the prompt, or running with no responder, stops safely. Applies to `/loop`, the chat panel's "New Loop", and Mission Control. New `MissionRunner` `blockedGate` hook + `detectSettingBlocker()` (keys off the deterministic tool-approval denial reason, not model prose), a `blocked` `MissionProgressUpdate` event, and the `MissionSettingBlocker` type. After one override the loop will not re-prompt for the same setting.

## [0.110.1] - 2026-06-20

### Added
- **Competitive analysis: SUPACODE.** Added a competitive-watch note evaluating [SUPACODE](https://supacode.sh/) — a native-macOS "command center" that runs 50+ CLI coding agents in parallel, each in its own `git worktree`. The analysis maps SUPACODE's pillars to AtlasMind's current capabilities, flags a latent write-race (parallel subtask batches in `taskScheduler.ts` share a single working tree), and frames worktree-per-agent isolation + a parallel "command center" UX + PR-native GitHub automation as a *prioritization signal* for items already on the roadmap. Written up in `project_memory/ideas/supacode-competitive-analysis.md` and summarised under **Competitive watch: SUPACODE** in `docs/roadmap.md` (Frontier / Horizon Watch). Docs-only; no source changes.

## [0.110.0] - 2026-06-20

### Added
- **WCAG Contrast Checker added to the recommended MCP server catalogue.** The Settings → MCP server picker now offers a one-click **WCAG Contrast Checker MCP Server** prefill (`npx -y contrast-checker-mcp`) — check colour contrast against WCAG 2.1/2.2 AA/AAA thresholds, parse colours across formats, and get accessible-colour suggestions for UI, theming, and frontend accessibility work. Tagged `community` provenance with verified npm/GitHub references and Node.js runtime-install hints; the preset note explains adding `{"NODE_OPTIONS":"--use-system-ca"}` in the Env vars (JSON) field for custom-CA environments. (`src/constants.ts`)

## [0.109.0] - 2026-06-20

### Added
- **Mission Loop — an optional autonomous, goal-seeking development loop.** Define a goal, guardrails, and a *closed parameter envelope* (cost / iteration / token / wall-clock caps, plus a no-progress stop) at the start of a run, and AtlasMind loops on top of the existing plan→execute→synthesize machinery: each iteration it **plans the next increment** (grounded in SSOT memory, guardrails, success criteria, and a carry-forward summary), **executes** it, then **re-evaluates progress against the goal** with a validated `GoalEvaluator` verdict, continuing until the goal is met or a guardrail confines progress. Agents go out to learn what's required — discovery is **prefer-existing** (registered agents/skills/MCP tools first) and may **synthesize new agents/skills or use Agentic Resource Discovery**, always behind the existing approval gates.
- **Hybrid autonomy with approval checkpoints.** The loop runs autonomously but pauses for a **deny-by-default** approval checkpoint at configurable triggers — every N iterations, when cumulative spend crosses a budget fraction, or before write/commit batches. In chat, checkpoints surface as a modal approval; in Mission Control, as an in-panel Approve/Stop control.
- **`/loop <goal>` chat command.** Previews the goal + the closed parameter envelope + checkpoint policy + an estimated cost range, gates the whole run behind an `--approve` token (like `/project`), then streams live iterations and verdicts. Deployments are never run directly — anything implying staging/production is left to the guarded delivery pipeline.
- **Mission Control panel** (`AtlasMind: Open Mission Control`). Define goal, success criteria, guardrails (rules + protected paths), the budget envelope, checkpoint policy, and discovery toggle; launch; watch iterations and verdicts live; approve/deny checkpoints; stop a run; and review recent missions.
- **Mission Loop settings page** in the Settings dashboard. A dedicated **Mission Loop** tab manages the `atlasmind.loop.*` defaults (envelope, checkpoint policy, discovery, goal-confidence threshold) with the same validated webview boundary as the other settings pages. The cost-cap field is shown and entered in the user's selected display currency (converted to/from USD-canonical storage), and the token-cap field is formatted with thousands separators for readability.

### Changed
- **Display currency now defaults to USD** and is honoured app-wide. `atlasmind.displayCurrency` previously defaulted to `auto` (OS-locale detection); it now defaults to `USD`. Selecting any currency continues to apply across all cost displays (dashboards, chat, Mission Loop); `auto` is still available for OS-locale detection.
- **Verification-weighted "done".** A goal is only accepted as *achieved* when the iteration shows passing verification evidence where behaviour changed (the project's Testing Methodology Matrix and TDD policy are inherited automatically); code written without passing verification counts as *progressing*, not done. A configurable confidence threshold means a low-confidence evaluator can never falsely declare success.
- **Audit trail.** Each run is persisted to `project_memory/operations/missions.json` with a human-readable `missions.md` runbook mirror (goal, guardrails, per-iteration verdicts/cost, stop reason, discovered capabilities).
- **Live "Current Loops" on the Cost Dashboard.** The Cost Dashboard now shows a section listing every in-flight Mission Loop with its accumulated cost against the cost cap, iteration progress, token usage, and latest verdict — updated live as each iteration is saved (`MissionRegistry` exposes `listActive()` and an `onChange` subscription). The section hides itself when no loops are running.
- **"New Loop" composer mode in the chat panel.** The chat panel's send-mode dropdown gains a **New Loop** option (after *New Session*). Selecting it runs the current prompt as a Mission Loop goal — auto-approved on send — streaming iterations and verdicts into the chat thread, with the same budget envelope, deny-by-default checkpoints, and audit trail as `/loop`.
- New core services `MissionRunner`, `GoalEvaluator`, and `MissionRegistry` (`src/core/missionRunner.ts`, `src/core/goalEvaluator.ts`, `src/core/missionRegistry.ts`), the Mission Control webview (`src/views/missionControlPanel.ts`), Mission Loop types in `src/types.ts` (`MissionConfig`, `MissionBudget`, `MissionGuardrails`, `MissionCheckpointPolicy`, `GoalVerdict`, `MissionIterationResult`, `MissionResult`, `MissionProgressUpdate`, `MissionRunRecord`, and supporting types), and `atlasmind.loop.*` settings.

## [0.108.0] - 2026-06-19

### Added
- **Deployment Stages & Promotion pipeline on the Project Dashboard.** The Delivery page now opens with a **Stages & Promotion** pipeline that models your environments (Local → Staging → Production) as first-class, described-in-plain-English cards. On first open it **seeds a professional pipeline from your repository's branches** (detected production branch, `develop` as staging). Each stage card shows its branch, the package version currently deployed there, hosting/config/data facets, and **the safety reasoning in plain language** (why production is protected, that secrets are referenced by location only, and that a backup runs before any change). Between stages, each **promotion ("push")** is described as a guarded sequence — *preflight gate → backup → promote (never force-push) → verify* — with its required checks and approval listed, and a **deny-by-default** warning when a data-bearing target has no backup command set.
- **Full in-dashboard stage editor.** Add, edit, reorder (by rank), and remove stages directly on the Delivery page — covering all four facets (branch + version mapping, config/secrets *location*, hosting + health URL, data repo + backup/recovery) plus the natural-language description and the backup / promotion-gate / rollback policies. Promotion edges ("pushes") can be added, re-pointed, given a routine id, and removed. Removal uses a two-click confirm; protected/secret semantics are preserved. Edits are written back through a sanitising boundary (`sanitizeDeliveryConfig` — clamps strings, coerces types, drops dangling edges) before touching disk. The pipeline is persisted as `project_memory/operations/delivery.json` with a human-readable `delivery.md` runbook mirror, both openable from the dashboard.
- **Guarded promotion execution — Execute & Runbook.** Each push now has a live **Promote ▸** button that opens a confirmation dialog showing the full assembled plan (*preflight gate → backup → deploy → verify → record*), the preflight checks (auto-evaluated where AtlasMind can — version bump, changelog entry, clean working tree — otherwise flagged for manual attestation), and, for protected targets, a type-the-name-to-confirm field plus an explicit approval checkbox. **Confirm & run** then executes the guarded pipeline with **live per-step progress**: the target's backup command runs first, then the bound routine's deploy/migration steps, then a health-check of the target URL, and the outcome (plus a rollback hint) is recorded back onto the pipeline. A **Runbook** button renders the same plan read-only as a dry run. Safety: every executed command is sourced server-side from the persisted, user-authored stage config / routine files (never from the webview); a data-bearing target with no backup command is **deny-by-default blocked**; AtlasMind never force-pushes; and the run gate is re-evaluated against live git state at execution time.
- New `DeliveryManager` and `PromotionRunner` core services (`src/core/deliveryManager.ts`, `src/core/promotionRunner.ts`) and shared delivery types (`DeploymentStage`, `PromotionPath`, `DeliveryConfig`, `PromotionPlan`, `PromotionRunResult`, and supporting policy/check types) in `src/types.ts`.

## [0.107.0] - 2026-06-18

### Added
- **Resource Discovery is now a tab inside the Settings dashboard.** The Agentic Resource Discovery UI (search Agent Finders, browse ranked results, install discovered MCP servers/agents/skills/APIs, manage finders, fetch a manifest by URL, and export this project's catalog) now lives as a **Resource Discovery** tab in `AtlasMind Settings`, sharing the dashboard's chrome and navigation instead of opening in a separate webview. `AtlasMind: Resource Discovery`, the sidebar tree, `/discover`, and `ard.search` all open that tab. The standalone `ArdDiscoveryPanel` webview has been removed.

### Fixed
- **Privacy Dashboard — Trusted Models now lists every connected provider.** The "Who may receive confidential data" tree gated provider visibility on `isProviderHealthy()`, a live network health probe that can fail for transient or environmental reasons (TLS hiccups, timeouts). A fully-configured provider whose probe failed was hidden from the trust tree even though it showed as connected (green check) in the sidebar MODELS tree, so only the interactive providers that don't rely on an HTTPS probe (Claude Code CLI, GitHub Copilot) survived. The trust tree now uses the same `isProviderConfigured()` "connected" signal as the sidebar, so all wired-up providers and their active models are manageable as trust targets regardless of a momentary health state.

### Performance
- **Faster panel and startup loads — the Claude Code CLI is no longer re-probed on every render.** `isProviderConfigured('claude-cli')` spawns the CLI twice (`--version` then `auth status`), and read-only surfaces (the Models tree, the Project Dashboard, the Model Provider panel) re-probe on every render — the Models tree re-renders on every `modelsRefresh`. Bursts of refreshes spawned the CLI many times over, visibly slowing startup and panel loads. The probe is now memoized with a 10-second TTL, collapsing each burst into a single spawn pair, and the Trusted Models tree reuses the already-established cached health signal for Claude CLI instead of re-probing while building its snapshot.

## [0.106.0] - 2026-06-18

### Added
- **Agentic Resource Discovery (ARD) — AtlasMind is now a first-class ARD client and publisher.** [ARD](https://agenticresourcediscovery.org/) is a discovery-only protocol for finding agentic resources (MCP servers, A2A agents, Skills, APIs) *before* invocation. New `src/ard/` module:
  - **`ArdClient`** (`src/ard/ardClient.ts`) — speaks both ARD mechanisms: the registry `POST /search` API (with bounded, loop-safe federation across `auto`/`referrals`/`none` modes) and static `/.well-known/ai-catalog.json` manifests (with nested-catalog expansion). All external data is treated as untrusted: strict schema validation, `urn:ai:` identifier checks, the spec's strict value-or-reference rule, byte/entry caps, HTTPS enforcement, and a private-host SSRF guard.
  - **`ArdRegistry`** (`src/ard/ardRegistry.ts`) — persists "Agent Finders" in `globalState`, seeded with the GitHub Agent Finder and Hugging Face Discover **disabled** (opt-in; no outbound traffic until enabled), and caches recent results for the tree view.
  - **`ArdInstaller`** (`src/ard/ardInstaller.ts`) — maps a chosen result to a non-destructive action: discovered MCP servers are added **disabled** (enabling goes through the existing MCP trust gate), nested catalogs/registries become disabled finders, and A2A agents / skills / APIs are surfaced as references (no auto-wiring of remote execution).
  - **Catalog publisher** (`src/ard/ardCatalogExporter.ts`) — `AtlasMind: Export Resource Catalog` writes a spec-conformant `ai-catalog.json` describing this project's agents, skills, and MCP servers. System prompts, secrets, and MCP `env` are never included.
  - **In-task discovery skill** — a read-only `discover-resources` built-in skill lets agents find missing capabilities mid-task and surface ranked candidates for approval (it never installs).
  - **UI** — a new **Resource Discovery** webview panel and sidebar tree view, the `/discover <query>` chat command, and the `AtlasMind: Resource Discovery` / `Discover Resources (ARD)` commands. The relevance score is always labelled as a semantic match — **not** a trust or safety rating.
  - **Settings** — `atlasmind.ard.enabled`, `ard.federationMode`, `ard.maxResults`, `ard.requestTimeoutMs`, and `ard.allowInsecureEndpoints`.

## [0.105.2] - 2026-06-18

### Fixed
- **Sidebar chat now mirrors the main chat panel's sessions and transcript.** The chat webview (`media/chatPanel.js`) only ever *listened* for `state` updates and relied on the host's one-shot `syncState()` in the `ChatPanel` constructor for its initial render. When that push raced ahead of the webview script attaching its message listener, the message was dropped and the surface stayed on the static `SESSIONS 0` / `Ready.` markup. The detached editor panel (`retainContextWhenHidden: true`) usually recovered on a later change event, but the sidebar view (`retainContextWhenHidden: false`) is destroyed and re-resolved from scratch every time it is hidden, so it repeatedly lost the race and showed an empty chat that did not reflect the main window. Added a standard ready handshake: the webview posts `{ type: 'ready' }` once its listeners are attached, and `ChatPanel.handleMessage` replies with a full `syncState()`. Both surfaces now load correct state deterministically. (`src/views/chatProtocol.ts`, `src/views/chatPanel.ts`, `media/chatPanel.js`)

## [0.105.1] - 2026-06-18

### Fixed
- **Privacy page Trusted Models tree now lists only connected providers**, not the entire seeded catalog. Unconfigured providers (no credentials / deferred activation) are marked unhealthy at startup, so the tree filters on `isProviderHealthy` — a provider is only shown if it is connected or already hosts a trusted model. This also removes the large webview DOM that was slowing the Project Dashboard / Settings first paint.
- **Checkbox/tree clicks no longer jump the list back to the top.** `render()` now captures and restores the page scroll position and the inner scroll of any `[data-scroll-key]` container (the provider tree) across the full re-render, so selecting a model or expanding a provider keeps your place.

### Added
- **Provider data management now links to the dedicated Data Subject Request (DSAR) process** where a provider publishes one — e.g. Mistral's request portal — via a new `dataSubjectRequestUrl` in `src/core/providerDataGovernance.ts`, surfaced as a prominent "Submit a data-subject request" button on the Privacy page.

## [0.105.0] - 2026-06-18

### Added
- **Privacy page: provider/model trust tree, catch charts, and provider data-management.** Enhancements to the Project Dashboard → Privacy page (`src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`):
  - **Trusted Models** is now a collapsible **provider → model tree** instead of a flat list, and shows **only currently-active (enabled) models** (plus any trusted-but-now-disabled model so it can still be unassigned). A provider-level checkbox trusts/untrusts all of that provider's models at once, with an indeterminate state when only some are trusted.
  - **Classification activity charts**: the `DataPrivacyManager` now records a catch each time a custom rule or compliance detector fires during a real task (`recordCatch`/`getActivity`, persisted workspace-scoped via `workspaceState`). The page renders a catches-over-time chart, total/redacted counters, and a per-detector breakdown so you can see what is being caught.
  - **Provider data management**: a new `src/core/providerDataGovernance.ts` registry surfaces each trusted provider's GDPR / data-subject request portal, privacy policy, DPA, retention summary, and default training stance. Links open externally (https-validated); AtlasMind does not submit requests on your behalf.
- New type `DataPrivacyActivityEvent` (`src/types.ts`); new dashboard message `openExternalUrl` (https-only, validated).
- **Tests**: `tests/core/providerDataGovernance.test.ts` and new activity-log cases in `tests/core/dataPrivacyManager.test.ts`.

## [0.104.3] - 2026-06-18

### Fixed
- **Restored VSIX packaging** broken by the 0.104.2 dev-dependency bump. Dependabot raised `@types/vscode` to `^1.125.0`, which `vsce` rejects when it is newer than `engines.vscode` (`^1.120.0`). Pinned `@types/vscode` back to `^1.120.0` to match the declared engine rather than raising the minimum VS Code version users must run. `npm audit` still reports 0 vulnerabilities and the package builds cleanly.

## [0.104.2] - 2026-06-18

### Security
- **Applied Dependabot security updates for development dependencies** (lockfile + `package.json`). Merged PRs #96, #97, and #98:
  - `js-yaml` 4.1.1 → 4.2.0
  - `form-data` 4.0.5 → 4.0.6
  - developer-tooling group: `@types/vscode` ^1.120.0 → ^1.125.0, `@typescript-eslint/eslint-plugin` ^8.61.0 → ^8.61.1, `@vitest/coverage-v8` ^4.1.8 → ^4.1.9, `eslint` ^10.4.1 → ^10.5.0 (plus grouped transitive bumps).
  - `npm audit` reports **0 vulnerabilities**; full build and all 1104 tests pass against the updated toolchain. No runtime dependencies changed.

## [0.104.1] - 2026-06-18

### Fixed
- **A turn can no longer report success while its own verification run failed** (`src/core/orchestrator.ts`). When an agent answer claimed the work was done/"moving forward" but the post-edit verification (`verificationSummary`) reported `FAIL` / a non-zero `exit` / `N failed`, the response still asserted success — contradicting the failure the harness had already captured.
  - New `detectVerificationContradiction` (with `verificationIndicatesFailure`, `responseClaimsSuccessWithoutCaveat`, and `appendVerificationCaveat`) gates the agentic loop's natural stop. On a contradiction it first injects **one** reconcile reprompt (`buildVerificationContradictionReprompt`) asking the model to either make verification pass or state plainly that the task is not complete; if the response still claims success, a **deterministic, non-model-authored caveat** is appended citing the failing line and marking the task **not complete**.
  - Failure detection keys on structured markers (`FAIL:`, `exit N≥1`, `N failed` with N≥1, `✗`) and is overridden by `PASS:` / `0 failed` / "no failures", so a test merely *named* "…fails when…" is not misread as a failure. The gate never fires when the response already acknowledges the failure.

### Added
- **Tests**: `tests/core/orchestrator.tools.test.ts` covers `verificationIndicatesFailure` (structured failure vs. passing/benign), `responseClaimsSuccessWithoutCaveat`, `detectVerificationContradiction`, and `appendVerificationCaveat`.

## [0.104.0] - 2026-06-18

### Added
- **Data Privacy: classify confidential data and gate it to trusted models only.** A new project-scoped privacy policy lets you mark language/terms, files, and folders as proprietary, confidential, or secret. Classified content is only ever sent to the **trusted models you select** — every other model receives a redacted `[CONFIDENTIAL]` placeholder. Managed from the Project Dashboard → new **Privacy** page; the policy is stored at `project_memory/operations/data-privacy.json`.
  - `src/core/dataPrivacyManager.ts` (`DataPrivacyManager`) — classifies text (literal terms, regex) and file/folder paths (globs, traversal-safe), tracks the trusted-model allow-list (empty = nothing trusted, deny-by-default), and redacts classified spans for un-trusted models.
  - `src/core/compliancePacks.ts` — built-in, checkbox-enabled compliance packs (**GDPR** personal data, **HIPAA** PHI, **PCI-DSS** cardholder data with Luhn validation, **CCPA/CPRA**, **Financial** with IBAN mod-97). Each pack contributes curated regulated-data detectors to the classifier. Heuristic aids, not a compliance certification.
  - Enforcement (`src/core/orchestrator.ts`): a **routing gate** restricts candidate models to the trusted allow-list when the assembled context is classified; a **redaction fail-safe** in `buildMessages` strips classified spans for the actually-selected model (covers pins, parallel overflow); and **tool reads are gated** — a `file-read` of a classified path by an un-trusted model is withheld. When confidential content is detected but no trusted model is available, the content is redacted and the user is notified (with a shortcut to the Privacy page) — `RoutingConstraints.requireTrustedModel`, `OrchestratorHooks.onClassifiedContentForUntrustedModel`.
  - New types: `DataPrivacyConfig`, `DataPrivacyRule`, `DataPrivacyMatch`, `DataPrivacySensitivity` (`src/types.ts`).
  - Project Dashboard **Privacy** page (`src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`): enable toggle, compliance-standard checkboxes, custom term/regex/path rules, trusted-model multi-select, and a "test against text/path" preview. All webview messages are validated before any write.
- **Tests**: `tests/core/dataPrivacyManager.test.ts` and `tests/core/compliancePacks.test.ts` cover term/regex/path classification, traversal rejection, invalid-regex safety, deny-by-default trust semantics, Luhn/IBAN validators, and per-pack detector behaviour.

## [0.103.2] - 2026-06-18

### Fixed
- **Project subtasks that did not actually deliver are no longer reported as `completed`** (`src/core/orchestrator.ts`). `executeSubTask` previously returned `status: 'completed'` for any non-billing, non-iteration-capped result — so a subtask that ended on a hard tool error (e.g. `file-read` ENOENT), returned a bare preamble ("Let's inspect…") with no work, or otherwise signalled incomplete delivery was recorded as success. That let the scheduler build dependents on a broken foundation and made the run report a false "N/N subtask(s) completed".
  - New exported `classifySubTaskFailure` (with `looksLikePreambleOnly` and the shared `TOOL_EXECUTION_FAILURE_PREFIX`) detects three non-delivery shapes — unrecovered tool-execution failure, preamble-only/announce-without-deliver, and incomplete/unverified delivery — and resolves the subtask to `status: 'failed'` with an explanatory `error`, so downstream dependents are skipped and the run reports honest completed/failed counts.
  - The single recovery retry now also covers a first-attempt non-delivery (not just an empty or iteration-capped response), giving the subtask one more pass before it is marked failed.
  - Note: iteration-cap pauses remain `needs-input` (0.101.0); this change covers the other failure modes. Gating a single-turn commit/success *message* against its verification result (a model-output-honesty concern) is tracked separately and not part of this change.

### Added
- **Tests**: `tests/core/orchestrator.tools.test.ts` covers `classifySubTaskFailure` (tool-error, preamble-only, empty, incomplete, and genuine-completion/past-tense cases) and a project run where a non-delivering subtask is recorded as `failed` rather than `completed`.

## [0.103.1] - 2026-06-18

### Changed
- **Sidebar brand header is now a single inline line** (`src/views/chatWebviewMarkup.ts`, `media/chatPanel.js`). The project name moved from a second subtitle row to an inline `AtlasMind/ProjectName` form — the connected project name follows a forward slash after the wordmark and renders in a slightly smaller, dimmer font — reclaiming the vertical space the stacked subtitle used. The slash separator and project name are hidden entirely when no project name is available (Git remote or workspace folder), leaving just the clickable "AtlasMind" wordmark. Both segments remain independently clickable (wordmark → Settings, project name → Project Dashboard).

## [0.103.0] - 2026-06-18

### Changed
- **Open-ended triage/advisory prompts are no longer routed to sub-10B models** (`src/core/taskProfiler.ts`). Prompts like *"what should we work on next? Is there anything incomplete?"* matched no reasoning hint and fell through to `low`, so the router picked the cheapest model (e.g. an 8B local model) — which cannot do the whole-project reasoning the question demands. A new `OPEN_ENDED_ADVISORY_HINTS` pattern classifies these triage/recommendation/"what's next" questions as **high** reasoning, so the existing router penalties steer them to a capable model. Mechanical follow-ups (e.g. "commit the changes") are unaffected.

### Fixed
- **Verbatim-duplicated model output is now collapsed before display** (`src/core/orchestrator.ts`). Weak or looping models sometimes emit their final answer twice in a row (`prefix + B + B`); the new `collapseDuplicatedTrailingBlock` guard drops the duplicate copy. It is conservative — it only removes a large (≥ 200-char) trailing block that exactly duplicates the block immediately before it — so it never touches legitimately repeated short phrases or structured code.

### Added
- **Pick-one quick-reply pills for enumerated questions** (`src/chat/participant.ts`). `detectResponseQuickReplies` previously only produced clickable buttons for yes/no and a single "A or B?" question. It now also recognises a trailing 3–4 option list (*"…: batch concurrency, Shopify sync, or edge cases?"*) and renders one pill per option, so triage answers that end in a clear choice become one-tap selectable instead of a plain text prompt.
- **Tests**: `tests/core/taskProfiler.test.ts` (triage prompts → high reasoning; plain action follow-up stays low), `tests/core/orchestrator.tools.test.ts` (`collapseDuplicatedTrailingBlock` behavior incl. prefix preservation and non-duplicated passthrough), and `tests/chat/participant.helpers.test.ts` (`detectResponseQuickReplies` 2/3-option, yes/no, prose, and no-question cases).
- **Clickable brand header in the AtlasMind sidebar** (`src/views/chatWebviewMarkup.ts`, `media/chatPanel.js`, `src/views/chatPanel.ts`, `src/views/chatProtocol.ts`). The chat view — the topmost surface in the AtlasMind sidebar — now opens with an "AtlasMind" wordmark that opens the Settings panel when clicked, and a subtitle announcing the active project that opens the Project Dashboard. Both are keyboard-focusable buttons routed through the validated webview message protocol (new `openSettings` and `openProjectDashboard` messages) to the existing `atlasmind.openSettings` and `atlasmind.openProjectDashboard` commands. The activity-bar container title itself is not bindable through the VS Code API, so the brand header lives inside the topmost view where it is reachable.
  - The announced project name is the **connected Git repository name** when the workspace has a remote (resolved from the built-in `vscode.git` extension's `origin` remote, e.g. `https://github.com/owner/AtlasMind.git` → `AtlasMind`), falling back to the **workspace folder name** when no remote is configured or Git tooling is unavailable. The name resolves asynchronously, is cached, and is re-resolved when a repository or remote is connected later in the session.

## [0.101.0] - 2026-06-18

### Changed
- **Autonomous /project subtasks that hit the tool-iteration cap now pause for a decision instead of silently dying** (`src/core/orchestrator.ts`, `src/types.ts`, `src/chat/participant.ts`, `src/views/projectRunCenterPanel.ts`, `src/cli/main.ts`). Previously, when a subtask in a project run reached the `maxToolIterations` safety cap, `executeSubTask` returned `status: 'completed'` with the bare "Execution stopped after reaching the safety limit…" string as its output — so the scheduler moved on as if the subtask had succeeded, the run was recorded as completed, and the user was never offered the override that single-turn chat already provides.
  - New `SubTaskStatus` value **`needs-input`** (`src/types.ts`): a non-terminal pause distinct from `failed`. `SubTaskResult` now carries `iterationLimitHit`, `suggestedIterationLimit`, and `suggestedToolCallsPerTurnLimit` so the cap signal survives into the project layer.
  - The orchestrator now returns `needs-input` (not `completed`) for a capped subtask, propagating the suggested raised limits.
  - The chat/project report renders a prominent **"⏸️ Paused — tool-iteration limit reached"** section listing the paused subtask(s), the suggested higher limit, and a button to open the `atlasmind.maxToolIterations` setting, plus the three explicit choices (raise permanently, raise once and re-run, or skip). The run is recorded as `paused` rather than `completed`.
  - The Project Run Center reflects the paused state in the subtask tracker (new ⏸ icon, "raise limit to resume" hint, `paused` summary count) and run log; the CLI shows a ⏸ marker with the resume hint.

### Added
- **Test**: `tests/core/orchestrator.tools.test.ts` covers that a project subtask hitting the agentic cap surfaces as `needs-input` with `iterationLimitHit` and a positive `suggestedIterationLimit`, rather than a false `completed`.

## [0.100.3] - 2026-06-18

### Fixed
- **Documentation accuracy sweep for changes since 0.80.0** (`docs/configuration.md`, `wiki/Configuration.md`): corrected three stale/inaccurate items found while auditing the docs against the 0.81.0→0.100.2 changelog. (1) The `atlasmind.maxToolIterations` default was documented as `20` in both `docs/configuration.md` and `wiki/Configuration.md`, but `package.json` (and the README) set it to `10`; both now read `10`. (2) The Voice section in `docs/configuration.md` still claimed "There is not yet a host-side OS-native speech adapter," directly contradicting the `voice.hostSpeechEnabled` / `HostSpeechSynthesizer` engine shipped in 0.80.0 and documented in the same section; the closing paragraph now describes the actual three-backend TTS priority (ElevenLabs → OS host engine → Web Speech) and the on-device Whisper STT path. (3) The same paragraph's "webview-first" framing (which predated 0.80.0/0.81.0) was updated accordingly.

### Changed
- **`.gitignore`: selectively track the `project_memory/` SSOT** instead of blanket-ignoring it. The folder was previously fully ignored yet ~49 curated files were force-tracked anyway, so new SSOT entries silently fell outside git unless added with `-f`. The "project brain" (agents, decisions, ideas, architecture, domain, operations, roadmap, skills, index, routines) is now tracked by default, while volatile / potentially-sensitive content stays out of this **public** repo: `project_memory/sessions/` (chat transcripts), `project_memory/temp/`, and dated `project_memory/operations/project-run-*.json` run-history dumps. The stale `project_memory/temp/vision-enhancement.md` was untracked, and the previously-untracked curated entries were added.

## [0.100.1] - 2026-06-18

### Added
- **Open Knowledge Format (OKF) interoperability planning** (`docs/roadmap.md`, `project_memory/`): evaluation and design for adopting Google Cloud's Open Knowledge Format (OKF v0.1, published 2026-06-16). Rather than reformatting AtlasMind's own docs to a two-day-old spec, the plan adds OKF **import/export** — including a user-facing **"Convert project to OKF"** command that emits an ingested project as a portable, redaction-safe bundle — plus a lightweight **spec-watch sync** (modeled on the existing provider/pricing sync services) that tracks the spec as it evolves and raises an advisory on version bumps without auto-mutating memory. Captured in `project_memory/decisions/okf-alignment-evaluation.md` (verdict: align the SSOT, don't migrate wholesale), `project_memory/index/okf-frontmatter-audit.md` (AtlasMind's stores are structurally OKF-shaped but metadata-divergent, so export/import is favored over reformatting), and `project_memory/ideas/okf-interop.md`. Added to the Frontier / Horizon Watch (Horizon 1) in the human-facing roadmap. Planning only — no implementation yet.

## [0.100.0] - 2026-06-18

### Changed
- **Compare Models: list every configured model, grouped by provider** (`src/views/modelComparisonPanel.ts`): the picker previously showed only routing-`enabled` models, so most of a configured provider's catalog was hidden and very few models appeared. It now mirrors the Models tree — every model from a credentialed provider is listed in a collapsible per-provider group with a provider-level "select all" (plus the global Select All); disabled models are still selectable and marked.
- **Sortable results table** (`src/views/modelComparisonPanel.ts`): results are now rendered client-side from structured data and any column header (Model, Quality, Completion, Cost, Latency, Tokens) can be clicked to sort ascending/descending. The first row in the current sort order is flagged as the leader.
- **Quality, clarified** (`src/core/executionQuality.ts` doc, panel legend): the old single "Quality" column was the coarse completion-integrity grade (error 0 · empty 0.2 · truncated 0.6 · clean 1.0), which is ~1.0 for any clean response and so unhelpful for ranking. It is now labelled **Completion** with an inline legend explaining exactly what it measures.

### Added
- **Optional LLM answer-quality judge** (`src/core/modelEvalHarness.ts`, `src/views/modelComparisonPanel.ts`): an opt-in toggle (default off) grades each model's answer 0–100 for correctness, completeness, and usefulness using a judge model you pick from your configured models. When enabled, a **Quality** column appears (with the judge's rationale on hover) and drives the ranking. New pure, unit-tested helpers `buildModelJudgePrompt` and `parseModelJudgeVerdicts` (defensive JSON parsing, id matching, score clamping) back it; the harness gained an injected `judge` hook (`ModelEvalResult.judgeScore`/`judgeRationale`). The judge is display/ranking only — the **completion grade** remains what is recorded into outcome-driven routing, so routing calibration stays consistent with normal turns.

## [0.99.1] - 2026-06-18

### Changed
- **Defer the activation-time memory freshness scan** (`src/extension.ts`): even with stale-memory auto-refresh off (v0.98.0), the `loadSsotFromDisk` step still ran the freshness *detection* — `getProjectMemoryFreshness` → `buildImportSnapshot`, which walks the entire repository to fingerprint imported sources — synchronously on the startup-critical path (observed ~4.5s on a large workspace). That scan exists only to light up the "Update Memory" badge, so it no longer sits between SSOT load and provider discovery: the SSOT is loaded from disk immediately, and the freshness scan is scheduled `MEMORY_FRESHNESS_STARTUP_DELAY_MS` (8s) after activation settles (cleaned up via a registered disposable). The on-save file watcher keeps freshness current thereafter; this one-shot scan still catches edits made while VS Code was closed — it just no longer delays startup. Resolves the residual slow-load between `loadSsotFromDisk completed` and the first `[providers]` lines.

## [0.99.0] - 2026-06-18

### Changed
- **Compare Models panel reworked** (`src/views/modelComparisonPanel.ts`): the panel now matches the visual language of the other dashboards (topbar kicker/title, rounded cards, pill buttons, ranked results table with a highlighted winner). Key behaviour changes:
  - **Only configured models are offered.** The model picker now lists models exclusively from providers the user has actually configured with credentials (checked via `isProviderConfigured`, run in parallel on open and grouped by provider), so a comparison can always be run for real instead of failing on un-credentialed providers.
  - **Select All** toggle (with indeterminate state and a live selected-count) to quickly compare every configured model.
  - **Ready-made sample prompts** (reasoning puzzle, code generation, summarize & extract) as one-click chips that populate the prompt box.
- **Compare Models is now discoverable** (`package.json`, `src/views/settingsPanel.ts`): added a beaker icon to the **Models** view titlebar that opens the panel, and a **Compare Models** quick-action card on the Settings overview page.

## [0.98.0] - 2026-06-18

### Changed
- **Skip discovery for unconfigured providers** (`src/extension.ts`): startup model discovery health-checked and listed models for **every** registered provider, including the ~20 the user has not configured with any credentials — so an unconfigured Amazon Bedrock (with no AWS keys) spent ~30s on a SigV4/network health attempt, and other unconfigured providers were probed pointlessly. Discovery now consults `isProviderConfigured` and **skips any provider with no API key / credentials** before any health check or `/models` call (keeping its seeded models and marking it unhealthy until configured). Interactive providers (Copilot, Claude CLI) are exempt from this pre-check since their configured-state is their own health probe. Combined with v0.97.2's concurrency + per-provider timeout, the `[providers]` startup stream now finishes quickly even with many unconfigured providers registered.

### Added
- **`atlasmind.autoRefreshStaleMemory` setting (default off)** (`src/extension.ts`, `package.json`): the automatic re-import of stale imported SSOT memory entries on startup/file-changes is an expensive LLM re-summarization of every stale entry — it slowed dashboards and panels on launch (the `[activate] memoryFreshness auto-refresh` work) and, when ineffective, simply re-ran. It is now **off by default**: AtlasMind still detects staleness and surfaces the **Update Memory** affordance (`setMemoryNeedsUpdateContext`) for an explicit, on-demand refresh, so startup stays fast and no LLM tokens are spent silently. Set the new setting to `true` to restore continuous auto-refresh.

## [0.97.2] - 2026-06-18

### Fixed
- **Faster startup: provider discovery is now concurrent and bounded** (`src/extension.ts`, `tests/extensionActivation.test.ts`): `refreshProviderModelsCatalog` discovered models from ~24 providers in a **serial** loop — each provider's health check + `/models` fetch ran one after another, so a few slow providers (or a hanging health probe such as the Claude CLI's 60-second one) summed to nearly a minute of the `[providers]` startup stream during which model-dependent UI lagged. Discovery now runs **concurrently** (`Promise.all`), and each provider is wrapped in a per-provider timeout (`STARTUP_PROVIDER_DISCOVERY_TIMEOUT_MS`, 10s) via a new `withTimeout` helper, so one slow or hanging provider can no longer stall the rest — it is marked unhealthy, its existing models are kept, and it is retried on the next refresh. Total discovery time collapses from ~the sum of all providers to ~the slowest single one (capped at the timeout). Added 3 `withTimeout` tests (settles in time, slow → fallback, reject → fallback).

## [0.97.1] - 2026-06-18

### Fixed
- **Silent activation failures are now surfaced** (`src/extension.ts`): if `bootstrapAtlasMind()`'s `buildAtlasContext` step throws, the error was caught and logged but never shown, leaving `atlasContext` unassigned — so every chat-view title icon that calls `requireAtlas()` (Cost Dashboard, Project Dashboard, Model Providers, Personality, Run Center, etc.) silently no-opped while Settings (the only command that does not require the context) still worked. The activation promise now has a `.catch()`, and the post-bootstrap step detects an unassigned context and shows an actionable error with a **Show Output** button pointing at the "AtlasMind" output channel (which logs the actual failing step). This does not change the underlying failure — it makes it visible so it can be diagnosed and fixed instead of presenting as dead toolbar icons.

## [0.97.0] - 2026-06-18

### Added
- **Model Comparison panel** (`src/views/modelComparisonPanel.ts`, `src/commands.ts`): the `AtlasMind: Compare Models on a Prompt` command now opens a dedicated webview instead of the output channel. Enter a prompt, tick 2+ models, and run them to get a ranked, sortable table of graded quality, cost, latency, and an output preview per model; graded outcomes are recorded into the router to calibrate routing. The panel reuses the pure `compareModelsOnPrompt` harness, validates inbound webview messages (prompt is a non-empty string; model IDs are checked against the known-model set), renders all dynamic content with `escapeHtml`, uses a nonce-protected script with no inline handlers, and aborts an in-flight run when the panel is closed. The previous output-channel implementation (and its helper) were removed.

## [0.96.1] - 2026-06-18

### Changed
- **Higher-fidelity Claude "brain" context via the Claude Code CLI bridge (Direction 3)** (`src/providers/claude-cli.ts`, `tests/providers/claudeCliPrompt.test.ts`): the chat-only `claude-cli` bridge previously truncated **every** message uniformly to 4,000 chars, which starved the brain-role calls (planning / synthesis) that carry the goal plus a large memory context in a single user message. `buildClaudeCliPrompt` now allocates a per-role budget: prior-turn history is capped small (2,500 chars each) while the **latest** turn gets up to 16,000 chars (≈4× more), reduced dynamically when history is large so the assembled prompt stays within a 26,000-char total budget — safely under the Windows ~32,767-char command-line limit (the prompt is passed on the command line). This makes `claude-cli` a far more capable choice for `planningModelId` / `synthesisModelId`. Added 3 tests covering the enlarged latest-turn budget, small history truncation, and the total bound under heavy history.

## [0.96.0] - 2026-06-18

### Added
- **Local-draft / frontier-escalate routing (Direction 3)** (`src/core/orchestrator.ts`, `package.json`): a new `atlasmind.draftModelId` setting pins a draft model (e.g. a fast local model) for the **first attempt** of draftable tasks (auto budget + mechanical/low-stakes), with AtlasMind's existing struggle-gated escalation upgrading to a stronger reasoning-capable model if the draft falls short. This completes the role-routing set (draft / plan / execute / synthesize) over the `preferredModel` pin. The pin is applied to a separate initial-selection constraints object so it never blocks escalation, and `selectEscalatedModel` now explicitly clears `preferredModel` — escalation is a deliberate upgrade that must not re-select the model it is moving off. Empty (default) routes normally; an unknown model falls back to normal routing.

## [0.95.0] - 2026-06-18

### Added
- **Model-eval harness — "Compare Models on a Prompt" (Direction 2)** (`src/core/modelEvalHarness.ts`, `src/core/executionQuality.ts`, `src/commands.ts`, `package.json`, `tests/core/modelEvalHarness.test.ts`): a scored-replay harness that runs one prompt across a set of candidate models and returns a ranked comparison (graded quality, cost, latency, token counts, output preview). The graded outcomes are recorded into the router's outcome channel, so a benchmark also **calibrates outcome-driven routing**. The core (`compareModelsOnPrompt`) is pure and host-independent — the model call is injected — with 5 tests (quality ranking + outcome recording, cost tie-break, error capture, de-duplication, abort). A new `AtlasMind: Compare Models on a Prompt` command drives it interactively: pick a prompt and 2+ models, run sequentially (bounded spend), and view the ranked results in an output channel. The quality scorer `gradeExecutionQuality` was extracted to the shared `executionQuality.ts` so the orchestrator and harness use one definition.

## [0.94.0] - 2026-06-18

### Added
- **Synthesis-phase role pin — completing the role-routing trio (Direction 3)** (`src/core/orchestrator.ts`, `package.json`, `docs/configuration.md`, `wiki/Configuration.md`): a new `atlasmind.synthesisModelId` setting pins the synthesis phase (summarizing results or a chat session into reusable reasoning context — a no-tool reasoning step) to a chosen model, symmetric to `atlasmind.planningModelId`. Together they realise the full **plan (brain) → execute (tool-capable workers) → synthesize (brain)** role-routing pattern over the `preferredModel` primitive. The per-role helper `withPlanningBrainModel` was generalised to `withRoleModel(constraints, settingKey)` and applied at the planning call sites and `summarizeText`. When set to a known model the pinned model is used directly (bypassing budget/speed gates); empty routes normally, and an unknown model falls back to normal routing.

## [0.93.0] - 2026-06-18

### Added
- **Per-(reasoning-tier × model) outcome granularity (Direction 2)** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `tests/core/modelRouter.test.ts`): the outcome-driven routing bias is now context-aware. Execution outcomes are tracked both against a model's aggregate record (the bare `modelId` key — backward- and persistence-compatible) and against a per-reasoning-tier bucket (`modelId::low|medium|high`), so a model that excels at high-reasoning work but struggles with mechanical tasks (or vice-versa) is biased appropriately for the task at hand. `scoreOutcomeBias` prefers the bucket matching the current task's reasoning tier once it has enough samples and falls back to the aggregate otherwise; the orchestrator records the tier from the task profile. Added 3 tests (separate bucket tracking, per-tier preference flip between high/low tasks, aggregate fallback on sparse buckets).

## [0.92.0] - 2026-06-17

### Added
- **Planner-brain role routing (Direction 3)** (`src/types.ts`, `src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `package.json`, `tests/core/modelRouter.test.ts`): a foundational `RoutingConstraints.preferredModel` pin for **role-based routing**. When set and the model is genuinely usable (available, enabled, healthy, not deprecated/recently-failed, within any allow-list, and satisfies required capabilities), the router selects it directly via `resolvePinnedModel` — bypassing budget/speed gates since it is a deliberate choice — and otherwise falls back to normal scoring. The first consumer is the **planner "brain"**: a new `atlasmind.planningModelId` setting pins the planning/decomposition phase to a chosen model (planning is a no-tool reasoning step, so this is ideal for a strong reasoner or a Claude subscription via `claude-cli`), while execution subtasks still route to tool-capable workers — realising the planner-brain / tool-executor split from the routing roadmap. Added 4 tests (pin honored over budget gate, fallback on unknown model, capability veto, unhealthy-provider veto). Verification-gated draft→escalate hybrid routing remains a roadmap follow-up.

## [0.91.0] - 2026-06-17

### Added
- **Outcome-driven routing (Direction 2)** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/extension.ts`, `src/types.ts`, `tests/core/modelRouter.test.ts`): the router now adapts to how models actually perform on this project's work. A new per-model execution-outcome channel maintains a **decayed EWMA** of graded run quality (`gradeExecutionQuality`: hard error = 0, empty response = 0.2, truncated = 0.6, clean response = 1.0) — separate from the manual thumbs-feedback channel so it does not disturb user feedback. `scoreOutcomeBias` turns that EWMA into a **bounded** routing nudge (±`OUTCOME_BIAS_MAX`), gated by a minimum sample count (no reaction to a single run) and by the existing `feedbackRoutingWeight` control (0 disables it), so a struggling model is nudged down without being starved. Outcomes are **persisted** across sessions via a new `onModelOutcomeRecorded` orchestrator hook and `atlasmind.executionOutcomes` global-state key, and restored on activation. Added 6 tests (EWMA decay, stronger-track-record preference, cold-start no-op, weight-0 disable, persistence round-trip). Future refinements (per-task-profile granularity, a scored-replay harness) are tracked in the routing roadmap.

## [0.90.0] - 2026-06-17

### Changed
- **Smarter Anthropic prompt caching: stable-prefix split + threaded-chat caching** (`src/providers/anthropic.ts`, `src/providers/adapter.ts`, `src/core/orchestrator.ts`, `tests/providers/anthropicCaching.test.ts`): two refinements to the v0.89.0 cache writes.
  - **Stable/volatile system split** — AtlasMind's system prompt mixes a stable head (guardrails, agent prompt, skills) with a volatile tail (`Relevant project memory:` / `Live evidence from source-backed files:`) that changes almost every turn, so caching the whole system prompt rarely hit across turns. The adapter now splits at the first volatile marker (`splitStableSystemPrefix`) and places the cache breakpoint after the stable head only, leaving memory/evidence uncached. The stable head is identical across turns, so cross-turn cache-hit rates rise substantially.
  - **Threaded tool-less caching** — caching was previously gated on tool presence (agentic loops). A new `CompletionRequest.cacheStablePrefix` flag, set by the orchestrator when the cacheable-prefix ratio of the carried session/native context exceeds `CACHE_PREFIX_REUSE_THRESHOLD` (0.25), now also caches the stable prefix on threaded, tool-less chat turns where the prefix is genuinely reused — while still skipping single-shot turns to avoid the cache-write premium. +4 tests covering the split and the marker logic.

## [0.89.0] - 2026-06-17

### Added
- **Anthropic prompt-cache writes — actually caching the stable prefix** (`src/providers/anthropic.ts`, `tests/providers/anthropicCaching.test.ts`): the cache-savings pipeline previously only *measured* whatever a provider happened to cache. The Anthropic adapter now *deliberately* caches: when a request carries tools (an agentic loop that reuses the identical system prompt + tool definitions across every iteration), it marks the system prompt and the final tool definition with `cache_control: { type: 'ephemeral' }`, so Anthropic serves that prefix at the reduced cache-read rate on the second and subsequent calls. Applied on both the buffered and streaming request paths. Caching is gated on tool presence so single-shot, tool-less turns are not charged Anthropic's ~1.25× cache-write premium (which only breaks even after the second read); blocks below Anthropic's minimum cacheable size are silently ignored by the API. This closes the loop with the v0.88.0 cache-savings telemetry: AtlasMind writes the cache, the provider reports cache reads, and the Cost Dashboard shows the realised savings.

## [0.88.0] - 2026-06-17

### Added
- **Prompt-cache savings telemetry and Cost Dashboard panel** (`src/providers/adapter.ts`, `src/providers/anthropic.ts`, `src/providers/openai-compatible.ts`, `src/types.ts`, `src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/core/costTracker.ts`, `src/views/costDashboardPanel.ts`, `tests/core/modelRouter.test.ts`, `tests/core/costTracker.test.ts`): completes the cache-aware routing work with real, measured savings. `CompletionResponse` gains `cachedInputTokens`, populated from provider usage — Anthropic's `cache_read_input_tokens` (folded into the total input count, which Anthropic reports separately) and OpenAI-style `prompt_tokens_details.cached_tokens` / DeepSeek's `prompt_cache_hit_tokens` — across both the buffered and streaming response paths. The orchestrator aggregates cached tokens across retry/iteration attempts and values the avoided spend via the new public `ModelRouter.cacheReadPricePer1k(model)` (explicit `cachedInputPricePer1k`, else the per-provider cache factor). `CostRecord` gains `cachedInputTokens` + `cacheSavingsUsd`, the `CostSummary` gains `totalCacheSavingsUsd` + `totalCachedInputTokens`, and the **Cost Dashboard** shows a new **Cache Savings** card (avoided spend + cached input-token volume) alongside Compression Savings. Like compression savings, the figure is reported as avoided spend rather than discounting recorded cost, keeping cost figures consistent. This closes Direction 1 of the routing roadmap end-to-end.

## [0.87.1] - 2026-06-17

### Changed
- **Per-provider cache-read discounts for cache-aware routing** (`src/core/modelRouter.ts`, `tests/core/modelRouter.test.ts`): cache-capable models without an explicit `cachedInputPricePer1k` previously all used the flat conservative `DEFAULT_CACHE_READ_FACTOR` (0.25×), which understated providers with deeper discounts (notably Anthropic at ~0.1×). Added a `PROVIDER_CACHE_READ_FACTOR` baseline map (Anthropic/Claude CLI 0.1×, OpenAI/Azure/Copilot 0.5×, DeepSeek/Google 0.25×) so the projected cache-read price is realistic per provider on iterative turns. This remains a **bootstrap baseline only** — a dynamic `cachedInputPricePer1k` reported by discovery or the pricing sync still overrides it — keeping cache pricing accurate without hardcoding per-model values. Added a test that a deeper-discount provider is preferred over an equivalent default-factor model on a cacheable turn.

## [0.87.0] - 2026-06-17

### Added
- **Cache-aware model routing** (`src/core/modelRouter.ts`, `src/core/orchestrator.ts`, `src/types.ts`, `src/providers/modelCatalog.ts`, `src/providers/adapter.ts`, `src/providers/providerPricingSync.ts`, `src/extension.ts`, `tests/core/modelRouter.test.ts`): the router now models prompt-cache economics. Frontier providers bill a large, stable prompt prefix (system/identity prompt + SSOT memory bundle + tool definitions) at a reduced cache-read rate on repeat turns; AtlasMind sends exactly that shape on iterative/threaded work. New `RoutingConstraints.cacheablePrefixRatio` lets the orchestrator declare how much of a turn's input is a reused, cacheable prefix (estimated from the carried session/native context vs. the volatile user message via the new exported `estimateCacheablePrefixRatio`, capped so a perfect cache hit is never assumed). When set, `effectiveCostPer1k` projects the cacheable share at the cache-read price for cache-capable models, so they are favoured for iterative work; single-shot turns (ratio 0) are unaffected. `ModelInfo` / `CatalogEntry` gain `supportsPromptCaching` and `cachedInputPricePer1k`; when no explicit cache price is known the router applies a conservative `DEFAULT_CACHE_READ_FACTOR` (0.25×).
- **Dynamic cache-capability sourcing**: because providers change model capabilities over time, cache capability is **data-driven, not hardcoded**. `DiscoveredModel` and the live `ProviderPricingEntry` gain `supportsPromptCaching` / cached-price fields so runtime discovery and the pricing sync can report (or retract) caching support per refresh; `inferModelMetadata` merges them with **hint → pricing → catalog** precedence (an explicit `false` from a provider overrides the static fallback). The `CACHE_CAPABLE_PROVIDERS` set is only a bootstrap fallback used until a model has been annotated by a dynamic source. Tests cover the cost flip on a cacheable turn, no effect on single-shot turns, the dynamic `false` override, and the ratio estimator. (Surfacing estimated cache savings in the Cost Dashboard is the planned next increment — see `project_memory/decisions/cutting-edge-routing-roadmap.md`.)

## [0.86.2] - 2026-06-17

### Fixed
- **Active subscriptions are now preferred for ordinary work, not just maintenance tasks** (`src/core/modelRouter.ts`, `tests/core/modelRouter.test.ts`): a subscription provider's explicit preference bonus (`SUBSCRIPTION_MAINTENANCE_BONUS`) was only applied on `maintenance`-phase tasks. On normal tasks a paid-for, quota-remaining subscription tied with local/free on the cheapness axis but — unlike local models, which receive general preference bonuses — got no nudge over pay-per-token providers. Added a small, **quota-aware** general bonus (`ACTIVE_SUBSCRIPTION_BONUS`) so an active subscription (quota remaining) is preferred for everyday work too, reflecting that its capacity is already paid for and "essentially free" until quota is exhausted. The bonus is modest (it breaks ties toward the subscription without overriding capability/quality needs) and vanishes once quota is depleted, at which point the provider is treated as pay-per-token. Added tests covering both the preference on a neutral task and its removal on quota exhaustion.

## [0.86.1] - 2026-06-17

### Fixed
- **Reasoning depth and latency class are no longer dropped during model discovery** (`src/extension.ts`, `tests/providers/inferModelMetadata.test.ts`): `inferModelMetadata()` merged a model's name, context window, capabilities, pricing, and premium multiplier from the catalog but silently discarded the catalog's `reasoningDepth` and `latencyClass` annotations. Because AtlasMind seeds minimal models and populates the rest via runtime discovery, every discovered model lost these fields, so the router fell back to its heuristic — collapsing genuine depth-3 reasoners (Claude Opus, DeepSeek R1, Nemotron Ultra) to depth 2 and **under-ranking them for high-reasoning tasks**. The merge now carries both annotations through, so reasoning-heavy work routes to the appropriate models. Added a regression test asserting the annotations propagate (and are not fabricated for un-catalogued models). Note: the `claude-cli` (Claude subscription) provider remains an intentional chat-only bridge with `function_calling` stripped, so the router still correctly skips it for tool-driven agentic work; this fix improves its ranking only for the chat-only turns where it is eligible. See `project_memory/decisions/cutting-edge-routing-roadmap.md` for the broader routing roadmap.

## [0.86.0] - 2026-06-17

### Added
- **NVIDIA Nemotron model catalog for the NIM provider** (`src/providers/modelCatalog.ts`, `src/runtime/core.ts`, `tests/providers/modelCatalog.test.ts`, `docs/model-routing.md`, `wiki/Model-Routing.md`, `CONTRIBUTING.md`): the NVIDIA NIM provider (already wired via the OpenAI-compatible adapter against `integrate.api.nvidia.com`) gains a first-class, provider-scoped `NVIDIA_CATALOG` covering the Nemotron family — Llama 3.1 Nemotron Ultra 253B (extended reasoning, depth 3), Llama 3.3 Nemotron Super 49B, Nemotron Nano, Llama 3.1 Nemotron 70B Instruct, and Nemotron Mini — with accurate context windows, capabilities (reasoning/function-calling), reasoning depth, latency class, and hosted (non-zero) pricing. Registering it in `PROVIDER_CATALOGS` means `lookupCatalog('nvidia', …)` resolves Nemotron models from this catalog *before* the cross-provider fallback, so hosted Nemotron models no longer inherit metadata from the same-named `$0` local entries in `LOCAL_CATALOG`. The NVIDIA seed in `seedDefaultProviders()` now leads with Nemotron Super 49B and Nemotron Nano (alongside the existing Llama 3.1 70B fallback) so the family is visible before runtime discovery completes.

## [0.85.0] - 2026-06-17

### Changed
- **Cross-language archetype detection in the scaffolder** (`src/core/testingScaffolder.ts`, `tests/core/testingScaffolder.test.ts`): archetype inference (web / api / cli / game / mobile / library / generic) no longer relies on `package.json` dependencies alone. `buildArchetypeCorpus` now reads the dependency manifests of the detected language — `pyproject.toml` / `requirements.txt` / `Pipfile` / `setup.py` / `setup.cfg` (Python), `Cargo.toml` (Rust), `go.mod` (Go), `pom.xml` / `build.gradle` (Java) — so framework signals like FastAPI/Django/Flask, axum/actix-web/rocket, gin/echo/fiber/chi, pygame/bevy/ebiten, and click/typer/clap/cobra now drive the archetype for non-Node projects. Short Node-only package names (`next`, `three`, `koa`) are gated to Node to avoid substring false positives in other languages' manifests (e.g. `cargo-nextest` no longer reads as a Next.js web app). This makes archetype-dependent recipes — such as the API-vs-CLI-vs-web e2e branch — fire correctly across languages. +5 tests (26 total in the scaffolder/sync suite).

## [0.84.0] - 2026-06-17

### Changed
- **Language- and archetype-aware testing-framework scaffolding** (`src/core/testingScaffolder.ts`, `tests/core/testingScaffolder.test.ts`): the scaffolder's stack detection no longer assumes a Node/JS project. `detectStack` now identifies the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from `package.json`, `pyproject.toml` / `requirements.txt` / `setup.py` / `Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj` / `*.sln`, and `pom.xml` / `build.gradle`, and a coarse **archetype** (web / api / cli / game / mobile / library / generic). Starter files are now generated in the correct idiom per language: pytest + Hypothesis + Locust (Python), `cargo test` + proptest + criterion (Rust), `go test` + `testing/quick` + benchmarks (Go), xUnit (.NET), JUnit 5 (Java), alongside the existing Vitest/Jest/Playwright/Cypress/fast-check/k6 set (Node). Node e2e recipes now branch on archetype — an API project gets an HTTP smoke test, a CLI gets a spawned-process harness, a web app gets a Playwright/Cypress spec. Per-methodology install hints and the strategy playbook are likewise language-specific. Unknown stacks degrade to playbook-only guidance. Previously a non-Node project silently received JS-flavoured stubs; that gap is closed. Still strictly non-destructive — files are created only when absent and no manifest is ever mutated.

## [0.83.0] - 2026-06-17

### Added
- **Outbound testing-protocol sync to external AI agents** (`src/utils/testingProtocolSync.ts`, `src/utils/aiInstructionSync.ts`, `src/views/settingsPanel.ts`, `src/commands.ts`, `package.json`, `tests/utils/testingProtocolSync.test.ts`): the testing methodology matrix is now visible to AI agents *outside* AtlasMind. Previously instruction-file sync was inbound only (`aiInstructionSync` read `CLAUDE.md` / `copilot-instructions.md` *into* AtlasMind); there was no way for Claude Code, Copilot, Cursor, Cline, Gemini, Windsurf, Aider, or Codex (`AGENTS.md`) to discover the enabled protocols. The new `syncTestingProtocols` writes a delimited, AtlasMind-managed block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) describing each enabled methodology — what it is, when to apply it, key tools, the assigned owner agent, preferred model, and project notes — into every *detected* (existing) markdown instruction file. The writer is strictly non-destructive: it only touches its own block, preserves all surrounding content, writes only to files that already exist, and routes every path through the shared traversal guard (`isSafeRelativePath` / `resolveRelativePath`, now exported). JSON-config tools (Continue) are reported as skipped. Saving the Testing matrix now auto-syncs, and a new **Sync to AI agents** button plus `atlasmind.syncTestingProtocols` command trigger it on demand.
- **Stack-aware testing-framework scaffolder** (`src/core/testingScaffolder.ts`, `src/views/settingsPanel.ts`, `src/commands.ts`, `package.json`, `tests/core/testingScaffolder.test.ts`): a new `scaffoldTestingFramework` constructs a starter framework that fits the current project. It infers the stack (TypeScript/JavaScript, test runner, UI framework, Playwright/Cypress presence) from `package.json` and config fingerprints, then for each enabled methodology generates fitting starter files (e.g. Vitest/Jest example specs, a Playwright/Cypress e2e spec, a fast-check property test, a k6 load script, a snapshot test) plus a managed `project_memory/operations/testing-strategy.md` playbook with per-methodology set-up commands, trade-offs, and starter-file references. Strictly non-destructive: source/config files are only created when absent and never overwritten, `package.json` is never mutated (install commands are surfaced for the developer), and the action is confirmed via a modal. Available from the **Scaffold framework** button on the Settings → Testing page and the `atlasmind.scaffoldTestingFramework` command.

## [0.82.0] - 2026-06-14

### Added
- **Remote control of desktop AtlasMind from the web build** (`src/web/extension.ts`, `src/web/remoteClient.ts`, `src/web/chatClientPanel.ts`, `src/web/dashboardPanel.ts`, `src/remote/protocol.ts`, `src/remote/remoteControlServer.ts`, `src/remote/remoteBridge.ts`, `src/views/chatProtocol.ts`, `src/views/chatWebviewMarkup.ts`, `src/views/chatPanel.ts`, `src/extension.ts`, `esbuild.mjs`, `src/web/tsconfig.json`, `package.json`, `docs/remote-control.md`, `wiki/Remote-Control.md`, `tests/remote/protocol.test.ts`, `tests/remote/remoteBridge.test.ts`): AtlasMind now ships a **web extension** (`vscode.dev` / `github.dev` / `code-server`) that acts as a thin client driving a full desktop instance over a localhost WebSocket. Because the web host has no Node.js runtime, the desktop keeps doing all model calls, file system, MCP, and voice work; the browser only renders UI and relays intent, and **secrets never leave the desktop**. The chat webview front-end was made host-agnostic so a single `ChatPanel` implementation serves both local and remote surfaces via a synthetic webview host (`RemoteWebviewHost`); every inbound remote frame is re-validated by the existing `isChatPanelMessage` guard. The web client exposes chat (with remote tool-approval) plus **read-only** cost and project-run dashboards. Security: off by default, localhost-only bind, pairing bearer token in `SecretStorage`, workspace-trust gate, audited connections, one-click revoke (token rotation), and default-deny of pending approvals on disconnect. New build pipeline adds **esbuild** for the browser bundle (`out/web/extension.js`) alongside the existing `tsc` desktop/CLI output. New commands: `atlasmind.remote.enable`, `atlasmind.remote.disable`, `atlasmind.remote.showPairingCode`, `atlasmind.remote.revoke` (desktop), and `atlasmind.remote.connect`, `atlasmind.remote.disconnect`, `atlasmind.remote.showDashboard` (web). New settings: `atlasmind.remote.enabled` and `atlasmind.remote.port`.

## [0.81.0] - 2026-06-14

### Added
- **On-device speech-to-text via whisper.cpp** (`src/voice/localTranscriber.ts`, `src/voice/voiceManager.ts`, `src/views/voicePanel.ts`, `src/extension.ts`, `package.json`, `tests/voice/localTranscriber.test.ts`, `tests/views/voicePanel.test.ts`): the Voice Panel can now transcribe speech entirely on-device. The webview captures the microphone, downsamples to 16 kHz mono and encodes a 16-bit PCM WAV in-browser (no ffmpeg), and hands it to a host-side `LocalTranscriber` that runs a local `whisper-cli`. Audio never leaves the machine; only the GGML model (and, on Windows x64, the `whisper-cli` binary) are downloaded on first use, each streamed and **SHA-256-verified over HTTPS** (model `ggml-base.bin`; binary whisper.cpp v1.8.6). The spoken text never touches a command line — the WAV path is passed as an argv element to a shell-less spawn, and the temp WAV is deleted after transcription. New settings: `atlasmind.voice.sttEngine` (`auto` | `webspeech` | `local`, default `auto`) and `atlasmind.voice.whisperCliPath` (required on macOS/Linux; Windows x64 auto-provisions). The Web Speech API remains the fallback. Push-to-talk capture drives the existing Start/Stop Listening controls.

## [0.80.0] - 2026-06-14

### Fixed
- **Voice Panel ElevenLabs playback was blocked by CSP** (`src/views/webviewUtils.ts`): added a `media-src` directive (`${cspSource} https: data: blob:`) to the shared webview Content-Security-Policy. With `default-src 'none'` and no `media-src`, the `blob:` URL used by `new Audio()` for ElevenLabs server-side TTS fell back to `default-src` and was blocked, so ElevenLabs audio never played (Web Speech fallback masked the failure).
- **Voice device and ElevenLabs-voice preferences were never persisted** (`package.json`): registered the previously-unregistered `atlasmind.voice.inputDeviceId`, `atlasmind.voice.outputDeviceId`, and `atlasmind.voice.elevenLabsVoiceId` settings. Without registration, `configuration.update()` for the device IDs rejected (selecting a microphone/speaker in the Devices page silently failed and the follow-up settings sync never ran), and `elevenLabsVoiceId` always read empty so server-side TTS always used the default demo voice.
- **Testing Methodology Matrix — methodology detection algorithm fixed** (`src/core/testingConfigLoader.ts`): the linter collapsed specific-signal and wildcard detection into a single loop, causing `tdd` (definition-order position 1, wildcard `'*'`) to always win for any task that passed the testing-presence guard. Concrete methodologies like `e2e` (playwright/cypress signals), `continuous` (github-actions/gitlab-ci signals), `bdd` (cucumber/gherkin signals), and `security-testing` (auth/snyk/semgrep signals) could never fire. Restored the correct two-pass algorithm: first pass matches only non-wildcard signals across all definitions; wildcard fallback (tdd, unit) runs only for confirmed testing roles (`tester`, `security-reviewer`).

### Added
- **Host-side OS speech engine for TTS** (`src/voice/hostSpeechSynthesizer.ts`, `src/voice/voiceManager.ts`, `package.json`, `tests/voice/hostSpeechSynthesizer.test.ts`): new `HostSpeechSynthesizer` synthesizes speech entirely in the extension host using the operating system's built-in engine — PowerShell `System.Speech` (SAPI) on Windows, `say` on macOS, and `espeak-ng` on Linux. It uses no network and no API key, and works even when the Voice Panel is closed. Enabled with the new `atlasmind.voice.hostSpeechEnabled` setting. Backend priority is now ElevenLabs (when keyed) → OS host engine (when enabled) → in-panel Web Speech API. The spoken text is always delivered over stdin and never interpolated into a command line or script.
- **Documented `atlasmind.voice.elevenLabsVoiceId`** (`docs/configuration.md`, `wiki/Configuration.md`): added the ElevenLabs voice-id setting to the configuration tables.
- **27-test suite for `TestingConfigLoader`** (`tests/core/testingConfigLoader.test.ts`): covers `inferTestingMethodologyForSubTask` (non-testing role with no presence term → undefined, tdd wildcard fallback, bdd specific-signal match, security-testing via auth/snyk signals, e2e for frontend-engineer with playwright+test, continuous for devops with github-actions+test, false-positive prevention for non-testing tasks, specific-signal priority over wildcard), `resolveTestingModelOverride` (no override, direct model, whitespace trim, agent override lookup, missing agent/key, priority), and `buildMethodologySystemPromptHint` (non-empty output, label, when-to-apply, key-tools, step-reporting instruction, unknown-id guard).

## [0.79.2] - 2026-06-12

### Fixed
- **Autonomous run context continuity** (`src/core/orchestrator.ts`, `src/chat/participant.ts`, `src/views/chatPanel.ts`): preserved the loaded session context bundle for autonomous project subtasks so project runs keep the prior chat goal, summary, decisions, open threads, and SSOT excerpts instead of dropping back to a blank context frame.

### Added
- **Context compression toggle and savings reporting** (`src/core/orchestrator.ts`, `src/core/costTracker.ts`, `src/chat/participant.ts`, `src/views/costDashboardPanel.ts`, `package.json`, `src/types.ts`): added an opt-in `atlasmind.contextCompressionEnabled` setting, connected it to the existing compaction path, and surfaced estimated compression savings in the exec summary and cost dashboard.
- **Chat-side project-run context loading** (`src/chat/participant.ts`, `tests/chat/participant.helpers.test.ts`): project execution now loads the session SSOT context bundle before launching autonomous runs, so the same continuity data is available in both standard chat and autonomous project execution paths.
- **Calmer tool-failure summaries** (`src/core/orchestrator.ts`, `tests/cli/adversarialPrompt.test.ts`): refined the user-facing failure text to explain the tool problem clearly and offer next-step guidance without the blunt fallback wording.

## [0.77.2] - 2026-06-10

### Added
- **Published release v0.77.2**: this marketplace release bundles the routine workflow shipped on `develop`, including the new `/ship` experience, routine-run UI, bootstrap routine extraction, and direct routine-edit intent.
- **Bootstrapper routine extraction** (`src/bootstrap/bootstrapper.ts`): `/import` now scans `CLAUDE.md`, `.github/copilot-instructions.md`, and `docs/development.md` for ordered procedure sections (Publishing Routine, Release Workflow, Deploy Process, etc.) and writes a starter routine file to `project_memory/routines/<id>.md`. Steps are extracted from numbered list items with a **Label** and a `command` in backticks; `<angle-bracket-placeholders>` become `${VAR}` interpolation tokens. The fingerprint system prevents overwriting manually edited routine files, and unchanged files are skipped on re-import. After writing, `RoutineRegistry` is reloaded automatically so the new routine is immediately available to `/ship`.
- **Chat routine-edit intent** (`src/chat/participant.ts`): freeform messages matching "edit/update/change/open [the] [X] routine" now open the matching routine's source `.md` file directly in the editor, bypassing the LLM. AtlasMind identifies the target routine by matching the routine name or ID in the prompt, falling back to the default routine. If no routines exist, the response explains how to scaffold one via `/import`.

## [0.77.1] - 2026-06-10

### Changed
- **Routine card UI in Project Run Center** (`src/views/projectRunCenterPanel.ts`): replaced the `<select>` dropdown in the Ship card with run-card–style tiles matching the panel's design language. Each routine renders as a clickable card showing its name, description, and step count. The action strip inside each card contains a **Ship** button and an **Edit** button; Edit opens the routine's source `.md` file directly in the editor. The separate standalone Run Routine button has been removed.

## [0.77.0] - 2026-06-10

### Added
- **Project Routines** (`src/core/routineRegistry.ts`, `src/core/routineRunner.ts`): named, executable workflows stored as YAML-frontmatter markdown files in `project_memory/routines/`. The registry scans that folder on startup and makes all valid routines available to the rest of the extension. The runner executes steps sequentially, streams per-step progress, respects `on_fail: abort | prompt | continue` policies, and persists run results to `ProjectRunHistory`.
- **`/ship` chat command** (`src/chat/participant.ts`, `package.json`): `/ship` runs the project's default routine (first file with `default: true`, or first file in the folder). `/ship <id>` runs a named routine. Text after the ID is passed as `${message}` for interpolation in step commands (e.g. commit messages). Each step streams a live checklist into chat.
- **Run Routine card in Project Run Center** (`src/views/projectRunCenterPanel.ts`): a new "Ship" card above the hero grid shows a dropdown of all loaded routines and a **Run Routine** button. Step progress streams live into the card; the final result updates the run history.
- **`project_memory/routines/README.md`**: format reference and worked examples shipped with the extension so users know the routine file format without external docs.

## [0.76.5] - 2026-06-10

### Added
- **Animated logo on active-agent session tiles** (`media/chatPanel.js`, `src/views/chatPanel.ts`): session tiles in the Sessions panel now display a small animated AtlasMind globe (the same spinning-axis logo used in the thinking indicator, scaled to 14 px) when an agent is actively working in that session. The animation reuses the existing `atlas-spin` and `atlas-float` keyframes and disappears automatically once the run completes.

## [0.76.4] - 2026-06-10

### Changed
- **Model & provider info cards** (`src/views/treeViews.ts`): clicking "info" on a model or provider in the Models tree now routes the summary into a dedicated **"Model & Provider Info"** session instead of appending it to the currently active working session. If the dedicated session has been deleted or archived the next info request recreates it automatically. The user's active working session is never interrupted.

## [0.76.3] - 2026-06-10

### Fixed
- **Chat panel completely non-functional** (`media/chatPanel.js`): Unicode curly/smart single-quote characters (`‘`/`’`) were embedded in a JS string literal on line 3647, introduced when the AI instruction nudge text was written. JavaScript does not recognise curly quotes as string delimiters, so the entire IIFE failed to parse and no event handlers were ever registered. This caused the Send button, model-info output, and session panel toggle to all stop working simultaneously. Fixed by replacing the three curly quotes with plain ASCII single quotes (`'`).

## [0.76.2] - 2026-06-10

### Fixed
- **AI instruction nudge** (`src/views/chatPanel.ts`, `media/chatPanel.js`): three bugs introduced in 0.76.0 are resolved:
  1. Missing CSS for `.ai-instruction-nudge`, `.nudge-btn`, `.nudge-btn-primary`, and related classes caused the nudge banner to render as unstyled HTML that disrupted the chat layout.
  2. The "Sync Now" button stayed permanently disabled after a sync failure; the extension now sends `resetSyncButton` on failure and the webview re-enables the button.
  3. Nudge dismiss state was stored in an in-memory `Set` and lost on every extension reload; it is now persisted via `workspaceState` (`atlasmind.aiInstructionNudgeDismissed`).

## [0.76.1] - 2026-06-09

### Docs
- **Testing methodology system documented** across `README.md`, `docs/agents-and-skills.md`, `wiki/Agents.md`, `wiki/Changelog.md`, `wiki/Getting-Started.md`, and `wiki/Home.md`: added the full 23-methodology registry table, Settings Panel Testing matrix reference, auto-assess scan description, Project Dashboard Testing page, Agent Testing Roles section, and bootstrap/import flow. Updated all "red-green testing policy" references to reflect the broader configurable methodology system.

## [0.76.0] - 2026-06-09

### Added
- **AI instruction sync** (`src/utils/aiInstructionSync.ts`, `src/views/chatPanel.ts`, `media/chatPanel.js`): AtlasMind now detects AI instruction files from other tools in the open workspace and surfaces a nudge banner in the chat panel prompting the user to sync them into AtlasMind's SSOT memory (`project_memory/domain/ai-instructions-sync.md`). Supported sources: GitHub Copilot (`.github/copilot-instructions.md`), Claude Code (`CLAUDE.md`), Cursor (`.cursorrules`, `.cursor/rules/`), Cline (`.clinerules`), Continue (`.continue/config.json`), OpenAI Codex (`AGENTS.md`), Gemini CLI (`GEMINI.md`), Windsurf (`WINDSURF.md`, `.windsurf/rules/`), and Aider (`.aider.system.md`). The sync merges selected files into a single annotated memory document marked as advisory context (Personality Profile settings take precedence). Path traversal is rejected at both scan and write time.

### Changed
- **Orchestrator default prompt** (`src/core/orchestrator.ts`): agents are now instructed to read project memory, `CLAUDE.md`, `README.md`, or equivalent documentation before invoking executable skills when answering knowledge questions (e.g. "what is the publish policy?", "how do we branch?").
- **npmScripts skill** (`src/skills/npmScripts.ts`): description clarified to distinguish execution (start, build, test) from knowledge queries; added `routingHints` and a 120-second `timeoutMs` to improve model routing accuracy.

## [0.75.8] - 2026-06-09

### Added
- **AI token impact field on every methodology** (`src/types.ts`, `src/views/settingsPanel.ts`): each of the 23 testing methodologies now carries `tokenImpactLevel` (`low` / `medium` / `high`) and `tokenImpact` (a plain-English explanation of what drives usage). The expandable ⓘ info row in the Settings Panel Testing matrix displays these as a fourth block alongside *When to use*, *Key tools*, and *Trade-offs*. The level is shown as a colour-coded badge — green for low, amber for medium, red for high — so users can see the cost implication at a glance before enabling a methodology. The info grid layout was adjusted from 3 to 2 columns (2×2) to give each block adequate reading space.

## [0.75.7] - 2026-06-09

### Fixed
- **Auto-detect signal gaps for three new methodologies** (`src/views/settingsPanel.ts`, `src/types.ts`):
  - **SDD**: the API spec file detector now adds `"openapi swagger api-first"` to the corpus (previously only `"api consumer provider"`), so projects with `openapi.yaml` / `swagger.json` correctly surface the Spec-Driven methodology.
  - **Continuous / Shift-Left**: added CI config file detection — checks for `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `azure-pipelines.yml`, and `.buildkite/`. Any found file adds the matching CI tool name (e.g. `"github actions"`, `"circleci"`) plus `"continuous integration pipeline"` to the corpus.
  - **MBT**: added `"xstate"` to `autoDetectSignals` for the Model-Based methodology — XState is the dominant JS/TS state-machine library and a strong MBT signal.

## [0.75.6] - 2026-06-09

### Added
- **9 new testing methodologies** (`src/types.ts`, `media/projectDashboard.js`): the registry grows from 14 to 23 entries. All new methodologies appear in the Settings Panel Testing matrix (with info rows, agent assignment, and model override), the Project Dashboard Testing card, the bootstrap/import auto-detect flow, and the Agent Editor Testing Roles section.

  | ID | Label | Category |
  |---|---|---|
  | `sdd` | Spec-Driven (SDD) | Design-time |
  | `v-model` | V-Model | Design-time |
  | `continuous` | Continuous / Shift-Left | Structural |
  | `white-box` | White-Box | Structural |
  | `mbt` | Model-Based (MBT) | Behavioral |
  | `test-design` | Test Design Techniques (EP + BVA) | Behavioral |
  | `black-box` | Black-Box | Behavioral |
  | `gray-box` | Gray-Box | Behavioral |
  | `agile-testing` | Agile Testing | Exploratory |

  Each entry carries the full `whenToUse`, `keyTools`, `tradeoffs`, and `autoDetectSignals` fields. Auto-detect signals are already wired — for example, OpenAPI/Swagger files trigger SDD, ISO 26262 / safety-critical keywords trigger V-Model, GitHub Actions / CI pipeline files trigger Continuous/Shift-Left, and Agile/Scrum keywords trigger Agile Testing.

## [0.75.5] - 2026-06-09

### Changed
- **Richer auto-assess corpus** (`src/views/settingsPanel.ts`): `buildTestingAutoDetectCorpus` now gathers five additional signal categories beyond package.json deps and test config files:
  - **Web/UI surface** — detects any `.html`, `.jsx`, `.tsx`, `.vue`, or `.svelte` source file; adds `"web app frontend"` to the corpus, boosting E2E and Visual Regression recommendations.
  - **API spec** — detects OpenAPI/Swagger spec files (`openapi.yaml`, `swagger.json`, etc.); adds `"api consumer provider"`, boosting Contract testing.
  - **Security posture** — presence of `SECURITY.md` adds `"auth authentication pii"`, boosting Security testing.
  - **Contributor count** — runs `git shortlog -s HEAD`; if more than one contributor is found, adds `"product team user story acceptance criteria"`, boosting BDD and ATDD (which rely on stakeholder collaboration). Solo projects generate no team signals.
  - **Library/SDK** — `package.json` without `"private": true` (i.e., a publishable package) adds `"library sdk package"`, boosting Mutation and Property-Based testing.
  - **README audience context** — the first 3 kB of `README.md` is included verbatim, allowing free-text project descriptions ("enterprise", "high-performance", "consumer") to surface as organic signals.

## [0.75.4] - 2026-06-09

### Added
- **Auto-assess project button on Testing Strategy page** (`src/views/settingsPanel.ts`): a new "Auto-assess project" button sits next to "Save Testing Strategy" in the methodology matrix. Clicking it scans the workspace — reading `package.json` dependencies/scripts and locating testing config files (jest, vitest, cypress, playwright, stryker, k6, pact, etc.) — and runs the same signal-matching heuristics as the bootstrap/import auto-detect. The flow starts with an Auto / Manual / Skip picker; in Auto mode the inferred recommendations are pre-selected in a customisable QuickPick. After confirming methodologies, if a test-focused agent exists, an offer is made to assign it as the primary agent for all enabled methodologies. The accepted config is merged with any existing notes and model overrides before being saved.
- **`buildTestingAutoDetectCorpus`** (`src/views/settingsPanel.ts`): internal helper that reads `package.json` dependencies and searches for test-framework config files in the workspace, returning a lowercase corpus string for signal matching.

## [0.75.3] - 2026-06-09

### Fixed
- **Primary Agent dropdown empty in Testing Strategy matrix** (`src/commands.ts`): all `SettingsPanel.createOrShow` calls in command registrations omitted the third `atlasContext` argument, so `this.atlasContext` inside the panel was always `undefined`. `collectTestingDashboardSnapshot` therefore fell through to the empty-array fallback for `availableAgentSummaries`, leaving the agent dropdowns unpopulated. Fixed by passing `getAtlas()` as the third argument on all six Settings Panel command registrations (`openSettings`, `openSettingsChat`, `openSettingsModels`, `openSettingsSafety`, `openSettingsProject`, `openSettingsTesting`).

## [0.75.2] - 2026-06-09

### Added
- **Testing Strategy section on Project Dashboard** (`media/projectDashboard.js`, `src/views/projectDashboardPanel.ts`): the Project Dashboard Testing page now includes a "Testing Strategy" panel card at the bottom, showing all 14 methodologies grouped by category with an active/off status badge and a checkbox toggle per methodology. Toggling a methodology saves immediately to `project_memory/index/testing-config.json` via a new `saveTestingConfig` message type. An "Open Testing Strategy →" link navigates to Settings → Testing for agent assignments, model overrides, and detailed notes.
- **`atlasmind.openSettingsTesting` command** (`src/commands.ts`): new command to open the Settings Panel directly on the Testing page. Added to `ALLOWED_DASHBOARD_COMMANDS` so the dashboard Testing page's "Open Testing Strategy" button can dispatch it.
- **`atlasContext` passed to `collectTestingDashboardSnapshot` in dashboard** (`src/views/projectDashboardPanel.ts`): fixed the `syncState` call that was omitting the atlas context, so agent registry data is now available when building the testing snapshot for the dashboard.

## [0.75.1] - 2026-06-09

### Fixed
- **Testing nav tab missing** (`src/views/settingsPanel.ts`): the Testing page was rendered in the HTML but had no nav button, making it completely unreachable. Added a "Testing" tab between Safety & Verification and Project Runs in the settings navigation, with full `data-search` keywords for the settings search bar.
- **`collectTestingDashboardSnapshot` missing atlasContext** (`src/views/settingsPanel.ts`): the call in `getHtml()` was missing the `atlasContext` argument, so agent registry data (used for the agent assignment dropdowns in the Testing matrix) was unavailable.

## [0.75.0] - 2026-06-09

### Added
- **Testing Roles section in Agent Editor** (`src/views/agentManagerPanel.ts`): the agent editor now shows a Testing Roles section below Skills. When testing methodologies are assigned to the agent in `testing-config.json`, the section renders read-only chips for each assigned methodology plus per-methodology model override text inputs (blank = follow global model routing). When no methodologies are assigned, a "Configure in Testing Strategy →" button opens the Settings Panel Testing page directly.
- **Methodology info expansion in Settings Testing page** (`src/views/settingsPanel.ts`): each row in the Testing Strategy Matrix now has a ⓘ info button. Clicking it toggles an expandable info row beneath the methodology row showing `When to use`, `Key tools`, and `Trade-offs` sourced from the enriched `TESTING_METHODOLOGY_DEFINITIONS`. The button uses `aria-expanded` for accessibility.
- **Enriched `TestingMethodologyDefinition`** (`src/types.ts`): all 14 methodology definitions now include `whenToUse`, `keyTools`, `tradeoffs`, and `autoDetectSignals` fields to support both the info UI and auto-detection heuristics.
- **Auto-detect mode for bootstrap testing selection** (`src/bootstrap/bootstrapper.ts`): the testing methodology QuickPick now starts with a three-way choice — **Auto** (AtlasMind infers recommendations from project type, tech stack, and third-party tools), **Manual** (full 14-item list), or **Skip** (apply TDD + Unit defaults). In Auto mode, inferred methodologies are pre-selected in a follow-up QuickPick that the user can accept or trim before confirming.
- **Auto-detect mode for import testing selection** (`src/bootstrap/bootstrapper.ts`): the post-import testing methodology offer follows the same Auto / Manual / Skip pattern, with inference driven by the scanned project type and workspace file names.
- **`inferTestingMethodologiesFromIntake` / `inferTestingMethodologiesFromSnapshot`** (`src/bootstrap/bootstrapper.ts`): internal helper functions that match `autoDetectSignals` against the available project context corpus and return ranked recommendations with a short rationale string shown in the QuickPick description.

## [0.74.0] - 2026-06-09

### Added
- **Testing Methodology System** (`src/types.ts`): introduced `TestingMethodologyId` (14 methodologies: TDD, BDD, ATDD, Unit, Integration, E2E, Mutation, Property-Based, Snapshot, Contract, Performance, Security, Visual Regression, Exploratory), `TESTING_METHODOLOGY_DEFINITIONS` catalog with labels/descriptions/categories, `ProjectTestingConfig` and `ProjectTestingMethodologyConfig` interfaces. Configuration is stored in `project_memory/index/testing-config.json`.
- **Testing Strategy Matrix** (`src/views/settingsPanel.ts`): the Testing page is overhauled — the single "Testing policy" stat card is replaced by a full methodology matrix table. Each of the 14 methodologies can be independently toggled, assigned a primary agent (via dropdown from the agent registry), given a per-methodology model ID override, and annotated with notes. The matrix groups methodologies by category (design-time, structural, behavioral, non-functional, exploratory). Changes persist to `project_memory/index/testing-config.json` on save.
- **Bootstrap methodology prompt** (`src/bootstrap/bootstrapper.ts`): the guided bootstrap intake now includes a multi-select QuickPick step asking which testing methodologies the project will use. TDD and Unit Testing are pre-selected as defaults. The selection is written to `testing-config.json` as part of the bootstrap artifact generation.
- **Import Project methodology prompt** (`src/bootstrap/bootstrapper.ts`): after importing an existing project, if no `testing-config.json` exists yet, an info message offers to configure methodologies with the same multi-select picker.
- **Agent testing role fields** (`src/types.ts`): `AgentDefinition` gains `testingMethodologies?: TestingMethodologyId[]` (which methodologies an agent handles) and `testingModelOverrides?: Partial<Record<TestingMethodologyId, string>>` (per-methodology model ID overrides that take precedence over the agent's global `allowedModels` during test tasks).
- **SubTask methodology tagging** (`src/types.ts`): `SubTaskExecutionArtifacts` gains `testingMethodologyId?: TestingMethodologyId` to record which methodology a subtask's verification ran under.

### Changed
- **Testing policy stat card** replaced by "Active methodologies: N / 14" to reflect the multi-methodology model.

## [0.73.7] - 2026-06-09

### Fixed
- **Weak models invoking executable skills for knowledge/policy questions** (`src/core/orchestrator.ts`): added a rule to `DEFAULT_AGENT_SYSTEM_PROMPT` directing the model to read project memory, CLAUDE.md, README.md, or equivalent documentation files first when answering questions about project policy, workflows, conventions, or instructions — and explicitly not to invoke executable skills or run commands to answer questions that are already documented. This prevents local models (e.g. qwen3:14b) from reaching for `npm-scripts` or other executable skills when a simpler file read would answer the question.
- **`npm-scripts` skill invoked for documentation questions** (`src/skills/npmScripts.ts`): tightened the skill description to state explicitly that this skill runs commands and should not be used to answer policy or documentation questions. Added `routingHints` scoped to execution intents (run npm script, start dev server, run build, run tests, execute npm run, list package.json scripts) so the skill selection scorer does not surface it for knowledge queries.
- **`npm-scripts` outer timeout kills long-running scripts** (`src/skills/npmScripts.ts`): `npmScriptsSkill` now sets `timeoutMs: 120_000`, fixing the mismatch between the inner `runCommand` timeout (120 s) and the default outer skill-wrapper timeout (15 s). Previously any `npm run <script>` that took more than 15 seconds was killed by the wrapper regardless of the inner timeout setting.

## [0.73.6] - 2026-06-09

### Added
- **AI instruction sync utility** (`src/utils/aiInstructionSync.ts`): extracted `scanAiInstructionFiles`, `syncAiInstructionFiles`, and `hasAiInstructionSyncFile` into a shared utility so the scan/sync logic is available outside the Settings Panel. Supports CLAUDE.md, `.cursorrules`, `.clinerules`, `.github/copilot-instructions.md`, AGENTS.md, GEMINI.md, WINDSURF.md, `.aider.system.md`, `.continue/config.json`, and `.cursor/rules/` / `.windsurf/rules/` multi-file rule directories.
- **Auto-sync on Import Project** (`src/commands.ts`): `runProjectMemoryImport` now scans for AI instruction files immediately after the memory import completes. If files are found and no sync file exists yet, they are merged automatically into `project_memory/domain/ai-instructions-sync.md` and the count is reported in the success notification. This ensures a local model receives the project's instruction set (e.g. publish policy from CLAUDE.md) as part of first-time setup rather than relying on a separate manual sync step.
- **AI instruction nudge in Chat Panel welcome screen** (`src/views/chatPanel.ts`, `media/chatPanel.js`): when the Chat Panel opens and AI instruction files exist in the workspace but have not yet been synced, a dismissible banner is shown above the transcript. The banner lists the detected files and provides a one-click **Sync Now** button that auto-syncs all found files. Dismissed state is retained for the VS Code session; the nudge reappears after restart if files remain unsynced.

### Changed
- **Settings Panel AI instructions refactored to use shared utility** (`src/views/settingsPanel.ts`): `handleScanAiInstructions` and `handleSyncAiInstructions` are now thin wrappers around the shared utility, eliminating ~120 lines of duplicated scan/sync logic.

## [0.73.5] - 2026-06-09

### Fixed
- **`github-operator` agent — chained instructions, auto commit messages, context-aware policy, publish routine** (`src/runtime/core.ts`): the built-in GitHub Operator agent now handles the full set of operational patterns exposed by the transcript review: (1) *Chained sequential ops* — requests like "commit and push" or "stage, commit, and push" are now executed sequentially in a single turn without pausing for confirmation between steps. (2) *Auto commit-message generation* — when no message is supplied, the agent runs `git diff --staged --stat` and composes a conventional commit message (feat:/fix:/docs:/chore:/refactor:) from the actual diff instead of asking the user or producing verbose explanations. (3) *Context-aware push target* — the agent derives the correct push-target branch, protected-branch rules, release-hygiene requirements, and publish routine from the injected workspace context (populated by the AI Instructions sync from CLAUDE.md, `.github/copilot-instructions.md`, or equivalent) rather than reading project files at runtime. (4) *Release-hygiene enforcement* — version-bump and changelog requirements are read from the workspace context and carried out in the same commit. (5) *Publishing routine* — when asked to publish or ship, the agent follows the routine from the workspace context and executes every step in sequence, reporting the outcome per step. (6) *Policy persistence* — when a requested policy (push target, version-bump rules, publish routine) is missing from the workspace context and the user supplies it, the agent records it immediately to `project_memory/domain/ai-instructions-sync.md` so it is available to all future tasks without the user repeating it.
- **Planner — chained git operations and release hygiene** (`src/core/planner.ts`): two new rules added to `PLANNER_SYSTEM_PROMPT`. The *chained sequential operations* rule directs the planner to model each operation in a "commit and push"-style request as a separate subtask with explicit `dependsOn` ordering. The *release hygiene* rule directs the planner to include a release-hygiene subtask (version bump + changelog) before the commit subtask and wire the commit to depend on it when the project enforces this policy.

## [0.73.4] - 2026-06-08

### Fixed
- **Responses ending with code or bare headings** (`src/core/orchestrator.ts`, `src/chat/participant.ts`): `looksLikeIncompleteDelivery` now also detects structural truncation — an odd number of fenced code blocks (unclosed fence) or a lone markdown heading at the very end of a response with no body. A new `sanitizeResponseTail` utility closes any unclosed code fence and strips the dangling heading before the text enters the session transcript, preventing the stale artifact from contaminating subsequent turns.
- **"New Session" mode silently discarded when selected while busy** (`media/chatPanel.js`): `applyComposerModePreference` previously cleared the `queuedComposerMode` when `isBusy` was true at the moment the user selected "New Session" from the send-mode dropdown (webview state lag). The queued intent is now always stored; `submitPrompt` already guards against submitting it as a `new-session` while still busy (it overrides to `steer`), and the queued mode is now preserved across that steer submission so the intent is honoured on the next idle message instead of being silently lost.

## [0.73.3] - 2026-06-08

### Changed
- **Comparison matrix rewritten** (`wiki/Comparison.md`): replaced single 7-column table with structured sections (Editor Integration, Model Routing, Memory & Context, Skills & Tools, Safety & Operations, I/O & Integrations, Licensing). Added **Windsurf** and **Continue** as new comparison targets. Added rows for inline completions (honest ❌), speed-aware routing, local model sync, adaptive routing from outcomes, deprecation-aware routing, dispatch-time secret redaction, per-session context carry-forward, auto-synthesized skills, workspace sandbox, TDD gate, webhook integration, and CLI companion. Expanded Key Differentiators with vs. Cline, vs. Windsurf, and vs. Continue sections. Added an explicit "Honest Gaps" section (no inline completions, no diff UI, no cloud agent pool).

## [0.73.2] - 2026-06-08

### Changed
- **Documentation updated** for all 0.72.2, 0.73.0, and 0.73.1 changes: `README.md` project structure, `docs/architecture.md`, `docs/model-routing.md`, `docs/ssot-memory.md`, `wiki/Architecture.md`, `wiki/Changelog.md`, `wiki/Memory-System.md`, `wiki/Model-Routing.md`, `wiki/Security.md`, `wiki/Tool-Execution.md`.

## [0.73.1] - 2026-06-08

### Added
- **Secret redactor utility** (`src/utils/secretRedactor.ts`): new pattern-based secret scanner covers Anthropic keys, OpenAI keys, GitHub tokens, bearer tokens, PEM private keys, database connection strings, and generic key/secret assignments. `redactSecrets()` returns a `RedactionResult` with match count and matched pattern names; `redactSecretsWithWarning()` logs a console warning when any secrets were found (#8).
- **Memory/evidence redaction hook** (`src/core/orchestrator.ts` `buildMessages`): `compactMemoryContext` and `compactLiveEvidence` output is now passed through `redactSecretsWithWarning` before being embedded in the model prompt, preventing accidentally stored credentials from being forwarded to third-party LLM APIs (#8).
- **`ProviderId` extensibility** (`src/types.ts`): `ProviderId` union now includes `| (string & {})` so new providers can be registered via `ProviderRegistry` without requiring a multi-file type change; narrows properly in exhaustive switches (FP#4).
- **Router outcome feedback loop** (`src/core/modelRouter.ts` + `src/core/orchestrator.ts`): `ModelRouter.recordModelOutcome(modelId, success)` accumulates fractional `PERFORMANCE_OUTCOME_WEIGHT` (0.12) up/down votes in `modelPreferences`. Called from the orchestrator immediately after `AgentRegistry.recordOutcome` so every agentic task completion drives the preference bias for future routing (FP#7).
- **New routing constants** (`src/constants.ts`): `CONTEXT_SAFE_OUTPUT_MARGIN = 1_024` (tokens reserved for response headroom) and `PERFORMANCE_OUTCOME_WEIGHT = 0.12` (fractional preference vote weight).

### Changed
- **Agentic loop `max_tokens` guard** (`src/core/orchestrator.ts` `runAgenticLoop`): each iteration now computes a safe `maxTokens` value: `min(DEFAULT_CHAT_MAX_TOKENS, modelContextWindow − estimatedInputTokens − CONTEXT_SAFE_OUTPUT_MARGIN)`. Prevents completion requests from overflowing the model's context window when conversation history grows long; floors at 256 to avoid invalid requests (#4).
- **Smooth context-window scoring gradients** (`src/core/modelRouter.ts` `scoreTaskFit`): the binary `if (contextWindow < CONTEXT_GATE_SMALL) score -= 0.35` and `if (contextWindow < CONTEXT_GATE_MEDIUM) score -= 0.2` penalties are replaced with linear interpolations (`penalty × (1 − contextWindow / gate)`) so a model with 50 K context receives a proportionally smaller penalty than one with 4 K context, and future 1 M-context models are not penalised at all (FP#6).

## [0.73.0] - 2026-06-08

### Added
- **Extended model capability types** (`src/types.ts`): `ModelCapability` union extended with `'extended_thinking' | 'structured_output' | 'computer_use' | 'audio'`; `SpecialistDomain` extended with `'real-time-video' | 'scientific-computing'`. New `ModelInfo` fields `thinkingTokenMultiplier` and `deprecatedAt` allow the router to account for thinking-token cost multipliers and hard-skip tombstoned models. `SubscriptionQuota.unit` field (`'requests' | 'credits' | 'tokens' | 'minutes'`) enables correct quota-conservation math per provider.
- **Router named constants** (`src/constants.ts`): `CHECKPOINT_MAX_FILE_BYTES`, `MAX_LOOP_MESSAGES`, `LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW`, `BUDGET_TIER_*`, `CONTEXT_GATE_*`, `MODEL_FAILURE_TTL_MS`, `QUOTA_CONSERVATION_THRESHOLD` — all previously magic numbers extracted and documented.
- **Model router: deprecation filter + failure TTL** (`src/core/modelRouter.ts`): models with a `deprecatedAt` date in the past are automatically excluded from candidates. Stale failure records (older than `MODEL_FAILURE_TTL_MS` = 5 min) are auto-cleared so transient network errors don't permanently exclude providers. `reEnableProvider()` method added for manual recovery.
- **Model router: thinking-token cost scaling** (`src/core/modelRouter.ts`): `effectiveCostPer1k` now applies `thinkingTokenMultiplier` to output price, giving budget routing accurate cost estimates for extended-thinking models.
- **Orchestrator: messages loop pruning** (`src/core/orchestrator.ts`): when the agentic loop accumulates more than `MAX_LOOP_MESSAGES` messages, the oldest assistant + tool-result pair (indices ≥ 2) is evicted, preventing unbounded context growth on long-running tasks.
- **Orchestrator: mid-flight daily budget check** (`src/core/orchestrator.ts`): the orchestrator checks the daily budget limit after each tool-result accumulation and aborts with a clear message if the limit would be exceeded.
- **Orchestrator: deprecation tombstoning** (`src/core/orchestrator.ts`): when a completion call fails with a model-not-found / deprecated error, the model is recorded as failed and a progress message is emitted, matching the existing billing-error path.
- **Orchestrator: synthesize-agent retry** (`src/core/orchestrator.ts`): `synthesizeAgentForTask` now retries once with a cheap/fast fallback model before caching a synthesis failure.
- **Anthropic adapter: `Retry-After` header support** (`src/providers/anthropic.ts`): the `withRetries` loop now extracts `retryAfterMs` from 429 errors (set by the Anthropic adapter's HTTP error path) and uses it as the inter-attempt delay, honouring server-directed backoff.
- **Anthropic API version constant** (`src/providers/anthropic.ts`): all three `'2023-06-01'` literals replaced with `ANTHROPIC_API_VERSION` (overridable via env var), so version bumps are a one-line change.
- **Local model capability inference expanded** (`src/providers/localModelSync.ts`): `inferLocalCapabilities` now detects reasoning models (qwen4+, qwq, deepseek-r, marco-o, skywork-o, -cot), `extended_thinking` capability (thinking/thinker/qwq/deepseek-r), multimodal vision (llava, minicpm-v, moondream, bakllava, cogvlm, internvl, pixtral, florence, qwen-vl, qvq, llama+multimodal), and tool-calling (hermes, nous, functionary, toolllm, gorilla). Default context window now uses `LOCAL_MODEL_DEFAULT_CONTEXT_WINDOW` (32 768) instead of 8 192.
- **Checkpoint file-size guard** (`src/core/checkpointManager.ts`): `readSnapshot` now calls `fs.stat` before reading and returns `null` (skipping the file) when the file exceeds `CHECKPOINT_MAX_FILE_BYTES` (512 KB). Oversized files are silently skipped rather than crashing or OOMing the extension host.
- **Tool policy: name-based default classification** (`src/core/toolPolicy.ts`): unknown tools whose names start with a read-like prefix (`get`, `list`, `read`, `search`, `find`, `query`, `fetch`, `check`, `show`, `view`, `inspect`, `describe`, `status`, `info`, `lookup`, `count`) are now classified as `read/low` instead of `network/high`. Write-like substrings (`write`, `create`, `update`, `delete`, `execute`, `run`, etc.) override the read classification to keep the safe default for genuinely ambiguous tools.
- **Frustration-settings bidirectionality and decay** (`src/chat/participant.ts`): `applyFrustrationSettingsTuning` now snapshots the original `chatSessionTurnLimit` / `chatSessionContextChars` before raising them. A new `maybeCoolFrustrationSettings` function, called on every clean (non-frustrated) turn via `applyOperatorFrustrationAdaptation`, restores original values once 30 minutes pass without a new frustration signal — but only if the values still match the boosted minimums (to respect manual user edits).

### Changed
- **Model router scoring weights extracted to named constants** (`src/core/modelRouter.ts`): `QUALITY_WEIGHT_CHEAP`, `QUALITY_WEIGHT_NORMAL`, `PROVIDER_HEALTH_BONUS`, `PREFERENCE_BIAS_SMOOTH`, `PREFERENCE_BIAS_MAX`, `TASK_FIT_CAPABILITY_SCORE` (with calibration date comment) replace all previously undocumented magic numbers in `scoreModel`, `scoreLocalPreference`, `scorePreferenceBias`, and `scoreTaskFit`.
- **Orchestrator `Retry-After` backoff** (`src/core/orchestrator.ts`): `completeWithRetry` and `completeWithRetryStreaming` both use server-provided `retryAfterMs` when present, falling back to exponential backoff otherwise.

## [0.72.2] - 2026-06-08

### Fixed
- **Workspace-relative paths rejected by skill tools** (`src/extension.ts` `assertInsideWorkspace`): when a model passed a workspace-relative path such as `web/src/pages` to `directory-list`, `readFile`, `writeFile`, or any other skill tool, `path.resolve()` resolved against the process CWD rather than the workspace root, causing a false "resolves outside workspace" error. `assertInsideWorkspace` now resolves relative to `workspaceRoot` and returns the canonical absolute path; all callers (`readFile`, `writeFile`, `listDirectory`, `runCommand`, `deleteFile`, `moveFile`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `getCodeActions`, `applyCodeAction`) use the returned resolved path for the actual operation.
- **`directory-list` skill description** (`src/skills/directoryList.ts`): updated `path` parameter description to state that workspace-relative paths (e.g. `web/src/pages`) are accepted alongside absolute paths.

## [0.72.1] - 2026-06-07

### Added
- **`completionCriteria` field on `AgentDefinition`** (`src/types.ts`): optional `incompletePatterns` regex array that the orchestrator matches against the final response before accepting task completion. When a match is found, a re-prompt is injected asking the agent to either finish outstanding work or declare explicit unresolved blockers.
- **`definitionOfDoneChecker` hook on `OrchestratorHooks`** (`src/types.ts`): caller-injectable async gate invoked once after the agentic loop produces its final response. Returns `{ passed, blockers }` — when blockers are present the orchestrator re-prompts for one additional turn before surfacing the response.
- **Completion-integrity reprompt gate** (`src/core/orchestrator.ts` `runAgenticLoop`): before any loop exit, AtlasMind now checks the final response for language that signals incomplete delivery (e.g. "not yet wired", "important follow-up", "focused verification is still incomplete"). On a match a single structured re-prompt is injected requiring the agent to either complete the work or write an explicit **Unresolved blockers** section. The gate fires at most once per task to avoid infinite loops.
- **`looksLikeIncompleteDelivery` / `buildCompletionIntegrityReprompt` helpers** (`src/core/orchestrator.ts`): pure functions backing the completion gate; independently testable.

### Changed
- **Synthesis prompt** (`src/core/orchestrator.ts` `synthesize`): rewritten from a descriptive request into five strict rules. Rule 1: a task is only complete when wired end-to-end and verified. Rule 2: unresolved work must appear as a prominent **Unresolved blockers** section. Rule 3: test files invisible to the runner must be flagged as verification gaps. Rule 4: a passing overall test suite cannot mask absence of coverage for the specific change. Rule 5: be concise about successes, explicit about failures.
- **TDD missing-status warning** (`src/chat/participant.ts`): when `tddStatus === 'missing'`, an explicit ⚠️ bullet is now emitted in the thought summary reminding the user to verify test coverage manually and confirm test files are visible to the project's test runner.

## [0.72.0] - 2026-06-07

### Added
- **Live local model catalog sync** (`src/providers/localModelCatalogSync.ts`): fetches currently trending models from Ollama (via ollamadb.dev) and Hugging Face Hub (GGUF models sorted by downloads) and caches results in VS Code `globalState` with a 24-hour TTL. A bundled fallback (`data/local-model-catalog.json`) is used when both APIs are unreachable. The catalog feeds into `getLocalModelRecommendationCandidates` with priority: workspace override JSON > live/bundled synced catalog > hardcoded defaults.
- **LM Studio `lms` CLI install automation**: when the user clicks "Install" for an LM Studio model in the Settings panel, AtlasMind now detects the `lms` binary and spawns `lms get <model>` in a dedicated VS Code terminal so download progress is visible, instead of showing a static "not supported" message. Falls back to opening the HuggingFace model page when `lms` is not found.
- **Cost dashboard local savings section**: the Cost Dashboard now shows an estimated savings panel comparing actual session spend against equivalent usage on paid API tiers (cheap / balanced / expensive reference models).
- **`preserveFocus` option on `ChatPanelTarget`**: callers can now open the chat surface without stealing focus from the editor. Used by tool approval prompts and generated-skill review flows so the user's cursor position is preserved.

### Fixed
- **`.cmd` file execution on Windows**: skill `shell-run` spawns now set `shell: true` on Windows so `.cmd` files (which cannot be executed directly by Node's `child_process.spawn`) work without requiring `cmd.exe` to be specified explicitly.
- **`displayCurrency` setting scope**: the setting is now stored at `Global` scope instead of `Workspace` scope, so the chosen display currency applies across all workspaces rather than being reset in new projects.
- **`resolveCheckpointPaths` relative path resolution** (follow-up hardening): absolute path check is now explicit (`path.isAbsolute`) and when no `workspaceRootPath` is available the relative path is returned as-is rather than resolving against an unpredictable CWD.

## [0.71.0] - 2026-06-07

### Added
- **`reasoningDepth` field on `ModelInfo` and catalog entries** (0 = none, 1 = basic, 2 = medium, 3 = extended): replaces the binary `reasoning` capability tag with a numeric scale so the router can reward and penalise models proportionally instead of using binary cliffs. Annotated across all Anthropic, OpenAI, Google, DeepSeek, Bedrock, and local catalog entries.
- **`latencyClass` field on `ModelInfo` and catalog entries** (`'fast' | 'balanced' | 'slow'`): explicit authoritative override for the speed-tier heuristic. Prevents large-context models (e.g. Claude Sonnet 4 at 200k) from being incorrectly classified as `'considered'` just because they accept long contexts. Annotated across the full catalog.

### Changed
- **Model routing — subscription budget gate**: `balanced` budget mode now excludes subscription models whose `premiumRequestMultiplier` exceeds 2× (Opus-tier), preventing high-premium models from silently consuming subscription credits on everyday tasks.
- **Model routing — `auto` budget with high-reasoning tasks**: cheap-tier models (including capable local reasoners like DeepSeek R1) are no longer hard-gated out; scoring penalises shallow models instead, allowing the right local reasoner to win when it outscores cloud alternatives.
- **Model routing — graduated `scoreTaskFit`**: high-reasoning tasks now reward models proportionally by `reasoningDepth` (depth ≥ 3 → +1.1, depth 2 → +0.55, depth 1 → +0.1, depth 0 → −1.25) instead of a single binary ±penalty. Planning/synthesis phases and `preferredCapabilities` scoring follow the same graduated logic.
- **Model routing — `latencyClass`-aware speed tier**: `classifySpeedTier` consults `latencyClass` first; the old context-window heuristic is a fallback only for unannotated models. Fixes Claude Sonnet 4 and similar large-context-but-fast models being excluded from `speed=balanced` mode.
- **Model routing — fallback escalation handles `auto` budget**: `buildProviderFallbackRoutingConstraints` now maps `auto` → `balanced` (same as `cheap`) rather than jumping to `expensive`, keeping the relaxation step proportional to user intent.
- **Task profiler — session context inheritance capped**: terse follow-up messages (≤ 8 words, down from ≤ 15) that continue a high-complexity session are now classified as `medium` reasoning (down from `high`), and action-verb messages (`do`, `apply`, `fix`, `run`, etc.) are excluded from the inheritance path entirely via a new `DEICTIC_ACTION_GUARD_HINTS` pattern.
- **Orchestrator escalation message**: the progress notification when no model matches initial gates now includes the before/after budget and speed values (e.g. `budget=balanced/speed=fast → budget=balanced/speed=balanced`) so users can see exactly what was relaxed.

## [0.70.11] - 2026-06-07

### Fixed
- **Checkpoint path resolved against VS Code install dir instead of workspace**: when the model produced a relative file path for `file-write` or `file-edit`, `resolveCheckpointPaths` returned it verbatim and `path.resolve()` in `CheckpointManager.captureFiles` resolved it against the Node.js process CWD — the VS Code installation directory — instead of the workspace root. Relative paths are now anchored to `skillContext.workspaceRootPath` before being handed to the checkpoint manager, matching the existing behaviour of the `git-apply-patch` branch.

## [0.70.10] - 2026-06-07

### Fixed
- **VS Code extension host starvation during chat streaming**: `stream.markdown()` was being called on every streaming token (potentially 30–100 IPC calls/sec), which starved VS Code's own event loop and made the entire application feel sluggish while a query was in progress. Tokens are now buffered for 50 ms and flushed in a single call, reducing IPC pressure by up to 50×.
- **Sequential classifier + memory retrieval before every response**: the LLM classifier call and the memory/retrieval context build were running one after the other before the agentic loop could start. Both are now launched concurrently with `Promise.all`, removing one full network round-trip from the time-to-first-token for every chat request.

## [0.70.9] - 2026-06-07

### Fixed
- **Cross-platform home directory resolution in MCP client**: replaced `process.env.USERPROFILE ?? process.env.HOME` and `process.env.HOME` in `mcpClient.ts` with `os.homedir()`, which is Node.js's authoritative cross-platform home directory API. The old code relied on environment variables that may not be set in all Unix configurations (e.g. stripped environments, containers). Added `import * as os from 'node:os'`.
- **Linux-only Homebrew paths no longer included on macOS**: the `getKnownCommandSearchDirectories` function was unconditionally appending `/home/linuxbrew/.linuxbrew/bin` and `~/.linuxbrew/bin` even when running on macOS. These paths are now conditionally included only on Linux.

## [0.70.8] - 2026-06-07

### Fixed
- **LM Studio install cross-platform shell compatibility**: replaced `terminal.sendText()` (which requires shell-specific quoting) with `shellPath`/`shellArgs` on the `TerminalOptions`. VS Code now spawns `lms` directly via the OS rather than injecting a command string into whatever shell is active. This eliminates all quoting issues across PowerShell, CMD, bash, zsh, fish, Git Bash, and WSL regardless of platform.

## [0.70.7] - 2026-06-07

### Fixed
- **LM Studio install failing on Windows PowerShell**: the generated terminal command was `"C:\...\lms.exe" get "model"`, which PowerShell parses as an expression (the quoted string) followed by an unexpected token. Fixed by prepending the `&` call operator on Windows: `& "C:\...\lms.exe" get "model"`. `&` also works in CMD (it acts as a no-op command separator there). POSIX shells are unaffected.

## [0.70.6] - 2026-06-07

### Changed
- **"Install in LM Studio" now actually installs the model** instead of showing a static hint message. Two-tier behaviour:
  1. If LM Studio is installed (`~/.lmstudio/bin/lms` / `%USERPROFILE%\.lmstudio\bin\lms.exe` exists): opens a dedicated VS Code terminal named "LM Studio: Install Model" and runs `lms get <model>` so the user sees live download progress without leaving the editor.
  2. If `lms` is not found: opens the model's HuggingFace page in the browser — HuggingFace shows a "Use this model → LM Studio" one-click button that launches LM Studio and queues the download directly.
  - HuggingFace-sourced recommendations (`hf:` prefix) strip the prefix to produce the correct HF repo path for `lms get` and the browser URL.
  - Ollama-tagged recommendations pass the tag through as-is; `lms` searches HuggingFace for the model automatically.

## [0.70.5] - 2026-06-07

### Fixed
- **Ollama remove failing**: `removeOllamaModel` was using `method: 'POST'` against `/api/delete`, but Ollama requires `DELETE`. All remove operations now use the correct HTTP method.
- **"Install in Ollama" failing for HuggingFace-sourced candidates**: models from the live HuggingFace catalog have a `hf:` prefixed tag that Ollama's `/api/pull` does not accept. The "Install in Ollama" button is now hidden for HF-sourced models; only "Install in LM Studio" is shown.
- **Installed models in recommendation cards**: cards for already-installed models now show a "Remove from Ollama" button (or "Manage in LM Studio" note) instead of install buttons. The `LocalModelRecommendationItem` payload now carries `installedModelId` and `installedRuntime` so the webview knows which runtime and model ID to target.

## [0.70.4] - 2026-06-07

### Fixed
- **Chat panel no longer steals focus during active sessions** — tool approval and generated-skill approval reveals now use `preserveFocus: true` so the approval card becomes visible in the panel without yanking keyboard focus away from the editor. The `preserveFocus` option is also threaded through `ChatPanelTarget`, `revealPreferredChatSurface`, `ChatPanel.revealCurrent`, `ChatPanel.createOrShow`, and `ChatViewProvider.open` so any programmatic reveal can opt in to non-disruptive visibility.

## [0.70.3] - 2026-06-07

### Fixed
- **Display currency now actually applies** — `atlasmind.displayCurrency` was missing from `package.json`'s `contributes.configuration`, so VS Code could not reliably persist or notify on changes. The setting is now declared with a full enum and descriptions.
- **Currency is stored as a user-level preference** — the setting was previously saved to workspace scope, meaning it silently failed when no workspace folder was open and did not persist across different projects. It is now saved globally so the chosen currency applies everywhere.
- **Cost dashboard reference rates** — per-token reference rates shown in the Local Model Savings footnote now format in the selected display currency instead of always showing raw USD `$` values.

## [0.70.2] - 2026-06-07

### Changed
- **Local Model Advisor — richer workload signal inference.** The advisor now considers full project context when scoring candidates, not just local-model request history:
  - **All requests (all providers, 30 days)** — cloud and local model names are scanned for code/reasoning/vision signals.
  - **Agent usage frequency** — top 5 most-invoked agents have their role/description scanned, weighted by request count.
  - **Skill definitions** — all registered skills (names, descriptions, routing hints) are scanned to detect active capabilities.
  - **Workspace manifests** — `requirements.txt`, `pyproject.toml`, `package.json` are checked for ML (PyTorch, TensorFlow → reasoning) and image processing (Pillow, OpenCV, sharp → vision) libraries.
  - **SSOT `project_soul.md`** — first 3 KB is scanned for tech stack keywords if project memory is present.
- Fixed: the workload-match score bonus was always awarded because `'general'` matched every candidate. Bonuses now require a specific tag (`code`, `vision`, or `reasoning`) to match.
- Rationale strings now cite the actual evidence source (e.g. "Capability match (code): skill 'run-tests'; active development workspace").

## [0.70.1] - 2026-06-07

### Added
- **Cost Dashboard: Local Model Savings panel** — a new "Cost Efficiency" section appears in the Cost Dashboard when any locally-hosted model requests are recorded in the current window. It shows total local requests, tokens processed locally, and estimated cost avoidance across three cloud reference tiers (Budget: Gemini 2.5 Flash; Mid-tier: Claude Haiku; Premium: Claude Sonnet), with animated bar charts for each tier and reference rate footnotes.

## [0.70.0] - 2026-06-07

### Added
- **Live local-model catalog sync** (`src/providers/localModelCatalogSync.ts`): the Local Model Advisor now discovers candidates dynamically rather than from a static list. On each activation, a background task queries two live sources:
  - **Ollama library** via the [ollamadb.dev](https://ollamadb.dev) community API (sorted by total pulls) — covers all Ollama-installable models as they are published
  - **HuggingFace Hub** via the official models API filtered to LM Studio-compatible GGUF models (sorted by downloads) — automatically reflects newly released and trending models
- Hardware requirements (`minRamGb`, `minVramGb`) are inferred from the parameter count embedded in the model name (e.g. "14b" → ~8 GB VRAM at 4-bit quantization), with inline hints that override inference for well-known families (Qwen3, Devstral, Gemma 3, Phi-4, etc.).
- Workload tags (`code`, `vision`, `reasoning`, `general`) are inferred from model-name keywords.
- Results are cached in VS Code `globalState` with a 24-hour TTL. If both live APIs are unreachable, the bundled `data/local-model-catalog.json` is loaded instead. Priority chain: workspace override JSON → live/bundled synced catalog → hardcoded defaults.
- `data/local-model-catalog.json`: bundled offline fallback catalog shipped with the extension.

## [0.69.2] - 2026-06-07

### Fixed
- **Windows GPU VRAM detection** now reports correct total VRAM for high-memory NVIDIA cards (e.g. RTX 4090 was showing 4 GB instead of 24 GB). Root cause: `Win32_VideoController.AdapterRAM` is a 32-bit DWORD capped at ~4 GB. The local model scanner now tries `nvidia-smi` first on Windows (same as Linux), which returns the correct `memory.total` value, then falls back to WMI for non-NVIDIA GPUs.

## [0.69.1] - 2026-06-07

### Fixed
- `spawn EINVAL` on Windows when AtlasMind runs `npm`, `npx`, or other `.cmd`-backed executables via `runCommand`. `.cmd` files are batch scripts that require `cmd.exe` — `execFile` now passes `shell: true` on Windows so they execute correctly.

## [0.69.0] - 2026-06-07

### Added
- **7 new built-in skills** covering debugging, logging, project detection, and broader app-type support:
  - `npm-scripts` — list all `package.json` scripts and run any named script via `npm run`; supports custom `cwd` for monorepos
  - `log-file-tail` — find workspace log files (`*.log`, `logs/*.txt`, etc.), tail the last N lines, or search for a pattern across all log files
  - `framework-detect` — detect the full tech stack from `package.json` dependencies and config-file fingerprints; covers web frameworks, mobile SDKs, game engines, desktop runtimes, databases, testing tools, infrastructure, and more
  - `git-blame` — per-line commit attribution (author, date, short hash, commit summary) with optional line-range focus
  - `simple-browser` — open any http/https URL in the VS Code built-in Simple Browser panel; useful for local dev servers, dashboards, API doc sites, and HTML5 games
  - `debug-launch` — list VS Code debug configurations from `launch.json` and start a named session without leaving the chat
  - `debug-breakpoint` — list, add (with optional condition or logpoint message), remove by ID, and clear all breakpoints
- **New `Debugging` skill category** in the Skills tree for `log-file-tail`, `debug-launch`, and `debug-breakpoint`
- **6 new `SkillExecutionContext` methods**: `openSimpleBrowser`, `getDebugConfigs`, `launchDebugSession`, `getBreakpoints`, `addBreakpoint`, `removeBreakpoints`
- **Expanded `terminal-run` allow-list** — added Flutter, Dart, Expo, React Native, PHP, Composer, Elixir/Mix/IEx, Ruby Gem, Terraform, Helm, Kubectl, Corepack, Turbo, Nx, Lerna, VSCE, Electron Builder, and Godot to the auto-approve set

## [0.68.5] - 2026-06-07

### Fixed
- **Cost Dashboard: line chart no longer shows ghost bar overlay** — bars were rendered at 24% opacity in line mode, creating a confusing ghost chart behind the line; they are now fully hidden until bar mode is explicitly selected.
- **Cost Dashboard: chart and budget bar now use the same metric** — the daily spend chart previously used raw `costUsd` while the budget bar used `budgetCostUsd` (which includes Copilot premium multipliers). Both now use `budgetCostUsd` so "Today's Spend" in the budget bar matches the today bar in the chart.
- **Cost Dashboard: all date bucketing now uses local time** — timestamps were previously bucketed by UTC date, causing "Today's Spend" to span the wrong calendar day for users in non-UTC timezones. All date grouping in `CostTracker` and the dashboard panel now uses the device's local calendar date.

### Added
- **Cost Dashboard: "Today" timescale button** — a new "Today" option appears at the start of the timescale row, showing only the current local day's spend.
- **Cost Dashboard: "Edit" button on the budget headroom bar** — clicking Edit opens the AtlasMind Settings panel with budget settings focused.
- **Cost Dashboard: scrollable Cost by Model panel** — the model/provider breakdown list is now capped at a fixed height with a scroll bar, preventing the panel from growing indefinitely with many models.
- **Cost Dashboard: Provider view toggle in Cost by Model** — a Model / Provider toggle appears in the panel header, letting users switch between per-model and per-provider spend aggregation without a page reload.

## [0.68.4] - 2026-06-07

### Fixed
- **Local Model Scan always available**: The "Scan & Recommend" panel in Settings no longer shows an "AtlasMind context is not yet ready" error when opened before the extension has fully initialised. Hardware detection and local runtime discovery now work from the outset; usage-based scoring is simply skipped (all scores stay at their hardware/release baseline) until cost records become available.

## [0.68.3] - 2026-06-07

### Fixed
- **Project Dashboard stale scoring**: The dashboard now re-syncs automatically when the panel becomes visible again after being hidden, so scores no longer go out of date after working in other tabs. A `vscode.workspace.onDidChangeConfiguration` listener was also added so any `atlasmind.*` setting change (tool approval mode, terminal write policy, verify scripts, etc.) immediately re-evaluates the security and delivery scores without needing a manual Refresh.
- **`openGapFiles` message silently dropped**: The `isProjectDashboardMessage` validator was missing `openGapFiles` in its string-payload branch, causing the "open related files" action in the Gap Analysis page to be silently discarded. It now validates and dispatches correctly.

## [0.68.2] - 2026-06-06

### Added
- **Local Model Advisor in Settings**: Added a new "Scan & Recommend" panel under Models & Integrations that analyzes AtlasMind's recent local-model usage, inspects local hardware capacity (CPU, RAM, and detected GPU/VRAM), and ranks release-aware local model families to recommend the most appropriate models to keep installed. The advisor now also supports install/remove lifecycle actions: one-click install and remove for Ollama models, plus LM Studio install/remove guidance directly in the panel where stable API automation is not currently available.
- **Data-driven local recommendation registry**: Moved release-aware local model candidate definitions into `src/providers/localModelRecommendationRegistry.ts` and added validated workspace override loading from `.atlasmind/local-model-recommendations.json`. The advisor now falls back to built-in defaults automatically when overrides are absent or invalid, so future model families can be added without editing Settings panel logic.
- **Registry override coverage tests**: Added provider-level tests for local recommendation override parsing, normalization, invalid-entry filtering, and built-in fallback behavior when override content is malformed or non-array.
- **Focused provider test script**: Added `npm run test:providers:local-recommendations` to run only the local recommendation registry override and fallback test suite with dot reporting.
- **CI regression gate for local recommendation registry**: The CI quality matrix now runs `npm run test:providers:local-recommendations` as an explicit focused gate alongside the full unit-test suite.

### Fixed
- **Chat panel now fails safely when webview markup is incomplete**: Added a startup guard in `media/chatPanel.js` that validates required DOM nodes before wiring event handlers. If required elements are missing, AtlasMind now shows an explicit in-panel error instead of throwing null-access runtime errors and leaving the view blank or unresponsive.
- **Project Dashboard now avoids webview service-worker bootstrap dependency**: `projectDashboardPanel` now prefers inline loading of `media/projectDashboard.js` (with URI fallback) when composing webview HTML. This mitigates environments where webview resource service-worker registration fails with `InvalidStateError` during dashboard startup.
- **Shared webview shell now allows worker/service-worker bootstrap paths**: `getWebviewHtmlShell` now includes explicit `worker-src`, `child-src`, and `frame-src` directives for the webview origin (plus `blob:` where needed). This resolves debug-host startup failures where webviews immediately showed “Could not register service worker … The document is in an invalid state.”
- **Sidebar chat view no longer requests retained webview context**: `registerWebviewViewProvider` for `atlasmind.chatView` now sets `retainContextWhenHidden: false`, avoiding startup-time context restore paths that can trigger webview `InvalidStateError` service-worker registration failures in debug sessions.
- **Sidebar chat initialization is now deferred one event-loop tick**: `ChatViewProvider.resolveWebviewView` now hands off to an async initializer that waits briefly before creating `ChatPanel`, reducing startup races where VS Code reports the webview document as invalid during service-worker bootstrap.
- **Shared webview CSP is now fully webview-origin aware**: `getWebviewHtmlShell` now allows the webview origin in `script-src`, `connect-src`, `img-src`, and `worker-src` (plus `blob:` channels where required). This broadens compatibility with VS Code webview startup plumbing when the extension loads multiple sidebar and panel webviews during debug startup.

## [0.68.1] - 2026-06-06

### Fixed
- **Self-recovery with dynamic agent/skill synthesis on empty responses**: When the primary model attempt returns no content, the orchestrator now runs two recovery steps before falling back to asking the user: (1) *Reprompt* — re-runs the agentic loop with an explicit instruction to use available workspace tools and find the answer itself; (2) *Synthesize* — if the reprompt also produces nothing, infers routing needs from the LLM classification embedded in the request, synthesizes a specialist agent (and any required skills) better suited to the task, and retries the full agentic loop with it. A `__recoveryPass` flag prevents the synthesized-agent retry from triggering another recovery cycle. Only if both steps fail does the orchestrator fall through to generating a targeted clarifying question for the user.
- **Chat panel no longer throws "Webview is disposed" errors after panel close**: Added an `_isDisposed` flag that is set at the start of `dispose()`. Both `syncState()` and `runPrompt()` now return immediately if the panel has been disposed, preventing in-flight async operations from attempting to access the disposed webview. Eliminates the uncaught errors visible in the extension status bar after closing the chat panel mid-stream.

## [0.68.0] - 2026-06-06

### Added
- **Copy and send-to-terminal buttons on chat code blocks**: Each code block in the chat panel now shows a clipboard icon and a terminal icon in its header row on hover. Clicking the clipboard icon copies the code to the system clipboard (with a brief checkmark confirmation). Clicking the terminal icon sends the code directly to the active VS Code terminal (or opens a new one if none is open), without executing it — so you can review before pressing Enter.

### Fixed
- **Activity feed and model-used panels no longer collapse on tool progress**: The Work log (`<details>`), Thinking summary (`<details>`), and Models-used dropdown now survive every transcript re-render triggered by streaming, tool execution, or busy-state changes. Open/closed state is snapshotted before the transcript is rebuilt and restored immediately after, so manually-opened panels stay open while work continues.

### Changed
- **Quick Links moved to sidebar title bar**: The "Quick Links" collapsible panel has been removed from the AtlasMind sidebar. All seven panel actions (Dashboard, Ideation, Runs, Cost, Models, Profile, Settings) are now available as small icon buttons directly in the AtlasMind container title bar, consistent with how other sidebar views expose their primary actions.

## [0.67.9] - 2026-06-06

### Fixed
- **Orchestrator generates a targeted clarifying question when the model returns an empty response**: Instead of silently surfacing the internal `"Answered from context"` metadata summary (which looked like a real answer followed by `"Say 'Proceed' to continue"`), the orchestrator now makes a cheap secondary call when it detects an empty completion. The call uses the original user message and any tool evidence gathered during the attempt to produce a concise, request-specific clarifying question — e.g., asking which test framework to use when a security test request produced no output, rather than a generic "share more details" prompt. `ensureAssistantVisibleResponse` retains a last-resort static fallback for the case where the clarifying question call also fails.

## [0.67.8] - 2026-06-05

### Fixed
- **Provider discovery pipeline now fully traced in the output channel**: Added per-provider log lines to `refreshProviderModelsCatalog` at three checkpoints — discovery start (with health state), discovered model count, and post-merge registered count. Previously the pipeline could silently skip or lose models with no visible signal. These logs appear in the **AtlasMind** output channel and will show exactly where the chain breaks for any provider.

## [0.67.7] - 2026-06-05

### Fixed
- **Cross-session response bleeding between simultaneous chat panels**: When the sidebar Chat View and the detached Chat Panel were both open and running prompts concurrently, responses from one session appeared in the other. Two root causes were addressed: (1) `runPrompt` now calls `spawnSession()` instead of `createSession()` for "new session" mode, preventing the global active-session pointer from being silently hijacked by one panel and triggering a session-ID reset in the other; (2) when a prompt is submitted in "send" mode and another panel is already executing on the same session, a fresh session is automatically spawned for the new prompt, ensuring each concurrent run has its own isolated transcript. Additionally, `selectSession()` now short-circuits without firing `onDidChange` when the requested session is already active, eliminating the wave of redundant `syncState()` calls that all live panels were absorbing on every streaming update.

## [0.67.6] - 2026-06-05

### Changed
- **SSOT memory is now fully self-managed**: Removed the "Project memory needs update" warning item from the Memory sidebar panel. When the MemoryManager detects stale imported entries on activation or SSOT reload, it now silently auto-runs the import pipeline rather than surfacing a manual-review prompt to the user. The `atlasmind.updateProjectMemory` command remains available from the command palette and view toolbars for on-demand refreshes.

## [0.67.5] - 2026-06-05

### Changed
- **Live model badge redesigned**: The streaming model badge now uses the same grey pill style as the completed model badge. During streaming it shows the most recent model name with a subtle pulsing dot. When the orchestrator switches models mid-response (escalation, failover, re-route) a `(+N)` count appears next to the name; clicking the badge drops down a list of every model used in the reply (labelled "Models used so far" while streaming, "Models used in this reply" after completion). The same expandable behaviour applies to completed multi-model responses where `modelsUsed` is stored in transcript metadata.

### Fixed
- **Token count in response cost summary now includes all model attempts**: When the orchestrator ran multiple model attempts for a single response (escalation, provider failover, tool-capability re-route) only the final attempt's `inputTokens`/`outputTokens` were reported, causing the `N in / M out` line in the thought-summary to severely under-count large multi-step responses. Tokens are now accumulated across all attempts (`aggregateInputTokens`/`aggregateOutputTokens`), matching the existing `aggregateCostUsd` behaviour. The cost recorded in the cost tracker is also corrected to use the aggregate values.

## [0.67.4] - 2026-06-05

### Added
- **Live model badge in chat response bubbles**: The top-right corner of each assistant reply now shows which model is active in real time. As soon as the orchestrator selects a model the badge appears with the model name and a pulsing dot. If the model changes mid-response (provider failover, tool-capability re-route, or escalation) the badge grows to list every model used. The badge transitions to the standard static label once the response is complete.

## [0.67.3] - 2026-06-05

### Fixed
- **OpenAI (and all OpenAI-compatible) live model discovery now surfaces errors**: `listModels()` was silently swallowing non-ok HTTP responses from the `/models` endpoint (e.g. 401 Unauthorized, 403 Forbidden, 429 Rate Limited). The empty result caused `refreshProviderModelsCatalog` to hit its zero-models guard and quietly preserve the seeded defaults with no output-channel log. The fix: when the HTTP fetch returns a non-ok status and there are no static fallback models, `listModels()` now throws with the status code and truncated body so the error surfaces in the AtlasMind output channel (`[providers] Model refresh failed for openai: ...`). Providers that configure `staticModels` or `modelListProvider` as a fallback still receive those results even if the live fetch fails. A `[providers] … discovery returned 0 models` log was also added for the zero-models guard path.
- **`thought_signature` handling extended to local endpoint adapter**: The local model adapter in `registry.ts` had the same structural gap as the main OpenAI-compatible adapter — its `buildPayload` did not echo `thought_signature` back to the server and its response parser did not capture it. Both are now consistent with the fix made to `OpenAiCompatibleAdapter` in 0.67.2, so any local endpoint that proxies to a Google Gemini thinking model will also handle the signature correctly.

## [0.67.2] - 2026-06-05

### Fixed
- **Google Gemini thinking models no longer fail mid-conversation**: The OpenAI-compatible adapter now captures the `thought_signature` field that Google's Gemini 2.5+ thinking models attach to tool-call responses, stores it on `ToolCall`, and echoes it verbatim in the assistant message of any follow-up request. Without this, Google's API rejected the continuation with a "missing thought_signature" error whenever a thinking model (e.g. `gemini-2.5-pro`, `gemini-3.1-pro-preview`) was routed through a tool-calling loop.

## [0.67.1] - 2026-06-05

### Fixed
- **Provider credentials now trigger an immediate model refresh**: Saving API-key-backed provider credentials now forces `refreshProviderModels(true)` before the health refresh, so the Models sidebar and router immediately pick up the provider's full discovered catalog instead of staying on fallback seed models until a later refresh.
- **Auto-paused provider alerts are now dismissible without re-enabling providers**: AtlasMind now tracks a session-scoped dismiss action for auto-paused provider notifications, exposes a `Dismiss Provider Notifications` command in the Models view, and clears the sidebar badge while keeping the affected providers disabled.

## [0.67.0] - 2026-06-05

### Fixed
- **Project runs no longer hang indefinitely**: `runProjectCommand` now derives an `AbortController` from VS Code's `CancellationToken` and passes the resulting `AbortSignal` down through `processProject`, `executeSubTask`, the agentic loop, and the synthesizer. Cancelling the chat request (or any provider call timing out via the signal) now terminates the whole project pipeline instead of freezing silently. The planner's `plan()` call also receives the signal, so even the planning phase is interruptible.
- **Project runs no longer plan twice**: The preview plan built before the approval gate was discarded and the orchestrator immediately re-planned inside `processProject`. The preview is now passed as `planOverride`, cutting the redundant LLM call and eliminating the duplicate plan table in the chat panel.
- **Cancellation shows a clear message**: Aborting a project run mid-flight now shows "_Project run cancelled._" instead of swallowing the error silently.
- **Project runs report real token counts**: `synthesize()` now returns `{ content, inputTokens, outputTokens }` and each `SubTaskResult` carries `inputTokens` and `outputTokens` from the underlying `TaskResult`. `processProject` aggregates these into `ProjectResult.totalInputTokens` / `totalOutputTokens`, which are shown in the chat footer (e.g. `12,540 in / 3,210 out`) and stored in the session transcript via `recordTurn()`.
- **Session transcript now includes project turns**: `runProjectCommand` was the only major handler that never called `recordTurn()`. It now records the goal and synthesis with full cost/token metadata so follow-up context and session history work correctly.

### Added
- **Built-in workspace tools for project subtask agents** (`file-read`, `file-write`, `file-edit`, `file-search`, `memory-query`, `memory-write`, `test-run`, `terminal-run`, `workspace-observability`): The planner already assigned these skill IDs to subtasks but the corresponding `SkillDefinition` objects were never registered. The Orchestrator constructor now registers all nine tools on startup, so subtask agents can read and write files, search the codebase, run tests and terminal commands, and query/write project memory instead of generating code as unactioned chat text.

## [0.66.0] - 2026-06-05

### Added
- **Dismiss provider notification badge**: When a provider is auto-paused due to billing or auth issues, the Models tree view now shows a bell-slash button in the title bar. Clicking it acknowledges the notification and clears the badge without re-enabling the paused provider.

### Fixed
- **OpenAI (and other API-key providers) now populate all models after key entry**: `configureProvider` in `modelProviderPanel.ts` called `refreshProviderHealth()` after saving a new API key, but not `refreshProviderModels()`. The models fetched during the key-validation step were thrown away and the router kept only the seeded defaults. The handler now calls `refreshProviderModels(true)` first (which runs full discovery and merges all models) then `refreshProviderHealth()` — matching what the `copilot` and `claude-cli` branches already did.

## [0.65.6] - 2026-06-05

### Fixed
- **Display currency now applies everywhere**: The `atlasmind.displayCurrency` setting was not respected in three separate places:
  1. **Chat messages** — project cost estimates, per-subtask costs, project run totals, the `/cost` summary, and per-request cost bullets in `participant.ts` all hardcoded `$` with `.toFixed()` instead of going through `formatCost`/`formatCostAdaptive`. They now use the same currency formatter as the rest of the app.
  2. **Open panels not refreshing** — the `onDidChangeConfiguration` handler in `extension.ts` had no branch for `atlasmind.displayCurrency`, so the Cost Dashboard, Model Provider, and Personality Profile panels never re-rendered when the setting changed. The handler now dynamically imports and refreshes all open cost-displaying panels and fires `projectRunsRefresh` to push updated state to the Project Run Center.
  3. **`refresh()` visibility** — `ModelProviderPanel.refresh()` was `private`, preventing the config-change handler from calling it; it is now `public`.

## [0.65.5] - 2026-06-05

### Fixed
- **OpenAI provider now seeds 7 models instead of 1**: `seedDefaultProviders` previously only seeded `gpt-4.1-nano`, so the Models sidebar showed a single model for OpenAI when no API key was configured or when discovery failed. The seed now includes `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, and `o3` with accurate pricing and capabilities. Live discovery (when an API key is present) still merges the full model list from OpenAI's `/models` endpoint on top of these defaults.

## [0.65.4] - 2026-06-04

### Fixed
- Added all 8 new provider IDs (`openrouter`, `groq`, `together`, `fireworks`, `qwen`, `moonshot`, `yi`, `minimax`) to `.github/integration-monitor.json` so the CI integration-coverage audit passes (24/24 providers covered).

## [0.65.3] - 2026-06-04

### Fixed
- Removed an accidental `console.log('Listing models ...')` that was firing on every chat completion request through `OpenAiCompatibleAdapter`.
- `PersonalityProfilePanel.refresh()` visibility changed from `private` to `public` to allow external callers.

## [0.65.2] - 2026-06-04

### Fixed
- **All 8 new providers now appear in the Models sidebar**: OpenRouter, Groq, Together AI, Fireworks AI, Qwen, Moonshot AI, 01.AI (Yi), and MiniMax were registered as adapters but missing from `seedDefaultProviders()` in `runtime/core.ts`. Without a seed entry a provider never enters `modelRouter.listProviders()`, so it was invisible in the sidebar tree and skipped by the model-refresh loop. Each provider now has a seed `ProviderConfig` with a representative default model.

## [0.65.1] - 2026-06-04

### Changed
- **Model/provider summaries: richer "About" section**: Clicking "Summarize Model In Chat" or "Summarize Provider In Chat" now appends a structured **About** block covering the provider's tagline, strengths, weaknesses, and a notable callout — giving enough context to make an informed decision about signing up. Model summaries also include a context note (e.g. reasoning model, giant context window, or very cheap tier).
- **Sidebar summaries excluded from session context**: Messages posted by "Summarize" sidebar actions are now classified `irrelevant` with `relevanceWeight: 0`, so they are never included in the conversation context fed to the model router or LLM. This prevents info-card messages from distorting agent routing or inflating costs.

## [0.65.0] - 2026-06-04

### Added
- **8 new model providers**: AtlasMind now supports the following additional providers in the Model Providers panel, model tree, and routing engine:
  - **OpenRouter** — aggregator with 200+ models from many upstream providers. Uses a dedicated adapter that reads live pricing and context-window data directly from the OpenRouter `/api/v1/models` endpoint, so prices stay accurate without manual catalog updates. Requires an OpenRouter API key; includes the required `HTTP-Referer` / `X-Title` attribution headers.
  - **Groq** — ultra-fast LPU inference; covers Llama 4 Scout/Maverick, Llama 3.x, Mixtral 8x7B, Gemma 2 9B, Qwen QwQ 32B, and Groq Compound Beta with published pricing.
  - **Together AI** — open-weight model hosting; covers Llama 3.x (8B/70B/405B Turbo), DeepSeek R1/V3, Qwen 2.5 72B, Mixtral 8×7B/22B with published pricing.
  - **Fireworks AI** — fast open-model inference; covers Llama 3.x, DeepSeek R1/V3, Qwen 2.5 Coder 32B, Mixtral 8×7B with published pricing.
  - **Qwen (Alibaba Cloud)** — international DashScope endpoint; covers Qwen-Max, Plus, Long, Turbo, VL, and Coder variants.
  - **Moonshot AI (Kimi)** — Chinese long-context specialist; 8K / 32K / 128K context tiers.
  - **01.AI (Yi)** — Chinese open-weight provider; covers Yi-Lightning, Yi-Large/Turbo, Yi-Medium, Yi-Spark, Yi-Vision.
  - **MiniMax** — Chinese multimodal provider; covers MiniMax-Text-01 (1M context) and the abab6.5 series.
- **Provider catalog entries for all new providers**: `GROQ_CATALOG`, `TOGETHER_CATALOG`, `FIREWORKS_CATALOG`, `QWEN_CATALOG`, `MOONSHOT_CATALOG`, `YI_CATALOG`, and `MINIMAX_CATALOG` added to `modelCatalog.ts` with context windows and pricing per published docs.
- **Dynamic pricing sync for new providers**: Groq, Together AI, Fireworks AI, Qwen, Moonshot AI, and 01.AI added to `providerPricingSync.ts` so prices auto-refresh from each provider's public pricing page (7-day TTL cache).

## [0.64.4] - 2026-06-04

### Added
- **Structured `goal` field in `SessionContextBundle`**: `SessionContextBundle` now carries an optional `goal` field — the top-level problem statement for the session or project run. Project sub-agents receive a minimal bundle with this field set so every LLM call starts with a `## Session Goal` section, giving all agents a machine-readable, unambiguous anchor to the original problem regardless of how many layers of decomposition have occurred.

### Fixed
- **Memory retrieval enriched with project goal**: `buildRetrievalContext` now includes `goal` alongside `summary` and `decisions` when constructing the enriched memory query, so SSOT entries relevant to the actual problem (not just the narrow subtask) are surfaced.
- **`getProviderDisplayName` exhaustive switch**: Added missing cases for `openrouter`, `groq`, `together`, and `fireworks` providers, resolving a TypeScript strict-mode exhaustiveness error.

## [0.64.3] - 2026-06-04

### Fixed
- **Display currency: panels now update immediately when the setting changes**: Changing `atlasmind.displayCurrency` in Settings now live-refreshes the Cost Dashboard, Model Provider, and Personality Profile panels, and re-sends state to the Project Run Center — so all cost values switch to the new currency without requiring a panel reopen. Previously, open panels retained their original currency until manually closed and reopened.

## [0.64.2] - 2026-06-04

### Fixed
- **Model pricing: Mistral and other cloud models no longer show $0**: `lookupCatalog()` was falling through to the local-model catalog when a provider's own catalog had no entry for a given model ID (e.g. `mistral-nemo`, `ministral-3b`, `open-mistral-7b`). The local catalog intentionally uses $0 prices, so any cloud model that matched there would display as free. The cross-catalog fallback now skips `local` and `copilot_hosted` for non-local providers.
- **Mistral catalog: added missing API model entries**: `MISTRAL_CATALOG` now includes `Mistral NeMo`, `Ministral 3B/8B`, `Mixtral 8x7B/8x22B`, `Pixtral 12B/Large`, `Magistral Small/Medium`, and `Mistral 7B` with correct context windows and pricing.

## [0.64.1] - 2026-06-04

### Fixed
- **Project execution: sub-agents now receive the project goal**: `buildProjectSubTaskMessage` previously omitted the top-level goal from every subtask prompt, so ephemeral sub-agents had no idea what the original problem was and could only act on the narrow subtask title. Every subtask message now opens with a `PROJECT GOAL:` section so sub-agents have full context.
- **Autonomous continuation: "Fix this autonomously" no longer overwrites the real goal**: When the user clicked the "Fix Autonomously" quick-reply button and then said "proceed", `resolveAutonomousContinuationGoal` was picking up the meta-execution message ("Fix this issue in the workspace autonomously…") as the goal instead of the original bug description. A new `DEICTIC_FIX_EXECUTION_PATTERN` now causes `normalizeAutonomousSourcePrompt` to skip deictic meta-commands (matching "fix/resolve/apply this … autonomously") and look further back in the transcript for the actual issue description.

## [0.64.0] - 2026-06-04

### Added
- **Collapsible Standalone Runs section**: The Standalone Runs list in the Sessions panel is now a collapsible section with its own toggle button. It is collapsed by default. When one or more runs are actively in progress a count badge appears next to the title; the badge is hidden when no runs are running. Collapse state is persisted across panel reloads.

### Fixed
- **Project Dashboard double-send**: Clicking a Dashboard button that auto-submits a prompt to the Chat Panel no longer also puts the same text into the composer input box. `pendingComposerDraft` is now skipped when `autoSubmit: true` is set, so the prompt appears only in the conversation, not duplicated in the input field.
- **Memory: empty-title guard**: `MemoryManager.upsert()` (VS Code host) and `NodeMemoryManager.upsert()` (CLI) now reject entries with a blank or whitespace-only title before any other validation, preventing unscorable zero-match ghost entries from being indexed.
- **Memory: `persistEntry` write failures now logged**: Previously, disk write errors were silently swallowed because callers used `void persistEntry()`. Both managers now wrap `createDirectory` + `writeFile` in a try/catch that logs the error to the VS Code output channel and re-throws, so failures are visible without breaking the in-memory state.
- **Memory: path escape guard in `persistEntry`**: Added a belt-and-suspenders check that the resolved file URI/path is still under the SSOT root before any write, preventing a bypassed `isValidSsotPath` from writing outside the project memory folder.
- **Memory CLI: sessions excluded from `queryWithOptions`**: `NodeMemoryManager.queryWithOptions()` now excludes `sessions/` entries to match the existing VS Code host `queryRelevant` and `queryWithOptions` behavior.

### Added
- **Memory: `fingerprintedImports` stat**: `MemoryStat` now includes `fingerprintedImports` — the count of imported entries that have both `sourcePaths` and a `bodyFingerprint`. This separates fully-tracked imports from `potentiallyStaleImports` (entries with source paths but no fingerprint), giving the memory browser and diagnostics a clear picture of import health.
- **Memory: `scanForOrphanedEntries()`**: New async method on both `MemoryManager` and `NodeMemoryManager` that checks entries with `sourcePaths` against the workspace root and SSOT root and returns the SSOT-relative paths of entries where no source file is accessible. Enables future cleanup UIs to surface deleted or renamed source references without manual inspection.
- **Memory: staleness penalty in `live-verify` and `planning` modes**: `getFreshnessBoost` now extends the staleness window to 730 days (2 years) and applies a mild negative boost (capped at −0.5 for `live-verify`, −0.3 for `planning`) to entries older than 1 year. `summary-safe` mode retains a floor of 0 so historical architecture decisions and rationales are never penalised by age.
- **Memory: vector score threshold and reduced multiplier**: `scoreEntry` now applies a minimum cosine similarity of 0.15 before vector score contributes to ranking (eliminating low-quality hash-collision noise), and reduces the vector multiplier from 4× to 2.5× so keyword evidence remains the primary signal and vector similarity acts as a secondary discovery boost.
- **Dynamic provider pricing sync** (`src/providers/providerPricingSync.ts`): On every model-catalog refresh, AtlasMind now fetches each active provider's public pricing/models docs page in parallel and uses the live per-token prices instead of the static catalog. Results are cached in `globalState` with a 7-day TTL (same pattern as the Copilot multiplier sync). Resolution priority: API hint → live pricing sync → static catalog → heuristic. Supported providers: openai, azure, anthropic, google, mistral, deepseek, xai, cohere, perplexity.
- **GitHub Copilot AI credits billing support**: Updated the Copilot provider to reflect the June 1, 2026 migration from "premium request units" (PRU) to token-based **AI credits** billing (1 credit = $0.01 USD). The sync module now fetches per-token prices from the new GitHub docs page (`models-and-pricing`) and stores them in `MultiplierSyncResult.tokenPrices`. Legacy PRU multipliers are retained for annual plan holders still on request-based billing.
- **New model catalog entries**: Added Claude Opus 4.8; GPT-5 Mini, GPT-5.2, GPT-5.2/5.3-Codex, GPT-5.4 (1M context), GPT-5.4 Mini (400K context), GPT-5.4 Nano, GPT-5.4 Pro, GPT-5.5 (1M context), GPT-5.5 Pro; Gemini 3 Flash, Gemini 3.1 Pro, Gemini 3.5 Flash; Raptor Mini and MAI-Code-1-Flash. Context windows for GPT-5.5 and GPT-5.4 corrected from placeholder 200K to 1M; GPT-5.4 Mini corrected to 400K. OpenAI models docs URL updated from `platform.openai.com` to `developers.openai.com`. o3-mini, o1, and o1-mini marked deprecated in catalog comments.
- **New Copilot plan tiers**: Added Copilot Max ($100/month, 20,000 credits) to the subscription tier list; updated all existing tiers to use AI credit counts (Pro: 1,500, Pro+: 7,000) and updated their descriptions to say "AI credits" instead of "premium requests".
- **`resolveTokenPrices()` export**: Companion to `resolveMultiplier()` — resolves per-1k-token USD prices for a model ID from the synced AI credits pricing table.

### Changed
- Copilot sync URL updated from `…/copilot-requests` to `…/models-and-pricing`.
- Configure Subscription flow prompts and confirmation messages now say "AI credits" instead of "premium requests".
- Model Provider panel sync banner and quota display updated to say "AI credits pricing" and "credits remaining" instead of "premium-request multipliers" and "requests remaining".

## [0.63.2] - 2026-06-04

### Fixed
- **Chat session isolation**: Each VS Code chat panel now gets its own dedicated AtlasMind session. Previously, all `@atlas` chat threads shared a single active session, causing context from one thread to bleed into another and making concurrent sessions interfere with each other's history. A `resolveThreadSessionId()` helper now maps each VS Code chat thread (fingerprinted by its opening user prompt) to a private session created via a new `spawnSession()` method that does not change the user's selected active session.

## [0.63.1] - 2026-06-04

### Fixed
- **Agent Auto-Update Cadence dropdown**: Changing the cadence in the Agent Manager panel no longer immediately reverts to "never". The panel now uses the just-written value when re-rendering after a save, bypassing a VS Code configuration cache timing issue where the in-memory config could read a stale value immediately after `config.update()` resolved.

## [0.63.0] - 2026-06-04

### Added
- **AI Instructions sync**: New **AI Instructions** page in AtlasMind Settings. Click **Scan Workspace** to discover instruction files from GitHub Copilot (`.github/copilot-instructions.md`), Claude Code (`CLAUDE.md`), Cursor (`.cursorrules`, `.cursor/rules/`), Cline (`.clinerules`), Continue (`.continue/config.json`), OpenAI Codex (`AGENTS.md`), Gemini CLI (`GEMINI.md`), Windsurf (`.windsurf/rules/`), Aider (`.aider.system.md`), and more. Found files are listed with a content preview and checkboxes. Confirming the selection merges the chosen instruction sets into `project_memory/domain/ai-instructions-sync.md`, which AtlasMind includes in workspace context automatically on subsequent tasks.
- **Personality Profile precedence**: The orchestrator injects a `Workspace preferences (override)` reminder after the project memory block so the model applies the Workspace Identity Profile (tone, verbosity, reasoning style, scope) over any conflicting instructions in synced AI instruction files. The generated `ai-instructions-sync.md` is marked as advisory context.

## [0.62.1] - 2026-06-03

### Added
- `architecture/boundaries-and-seams.md`: explicit review of all 8 integration seams (VS Code Extension API, Extension Host ↔ Webview, UI ↔ Orchestrator, Orchestrator ↔ Providers, Orchestrator ↔ Skills, Orchestrator ↔ Memory, Extension ↔ SecretStorage, AtlasMind ↔ MCP Servers) with contracts, protocols, and security rules for each. Closes the P2 architecture gap item.
- `docs/architecture/orchestrator-flow.md`: Mermaid flow diagrams for `processTaskWithAgent` and `runAgenticLoop` internals.
- Detailed architecture subdocs table added to `docs/architecture.md` and `wiki/Architecture.md`.

### Fixed
- Completed the built-in agent prompt editing implementation from 0.62.0: `extension.ts` now persists system prompt, description, and flag overrides for built-in agents in `atlasmind.builtInAgentPromptOverrides`; the Agent Editor panel wires the save/reset actions for built-in agents.
- `AgentAutoUpdater` no longer hard-skips built-in agents (the 0.62.0 changelog claimed this but the implementation hadn't landed yet).

## [0.62.0] - 2026-06-03

### Added
- **Built-in agent prompt editing**: System prompt, description, cost limit, and auto-update settings are now editable for built-in agents in the Agent Editor. Changes are stored as overrides in `atlasmind.builtInAgentPromptOverrides` and applied on top of the factory defaults at each activation, so they survive extension reloads.
- **"Reset to defaults" button**: Built-in agent editor now has a "Reset to defaults" button that restores the factory system prompt and description after confirmation, clearing the stored override.
- **Built-in agents are now auto-updatable**: The `AgentAutoUpdater` no longer hard-skips built-in agents. When the global cadence is set, built-in agent system prompts and descriptions are refreshed alongside user-defined agents. The "Exclude from auto-updates" checkbox is now active for all agents.
- **`BUILTIN_AGENT_DEFAULTS`**: Exported from `runtime/core.ts` so the extension can look up original factory definitions for reset and future tooling.

### Fixed
- **`primaryRoutingNeeds` on `AgentDefinition`**: Each built-in agent now declares the routing need IDs it is the primary handler for (e.g. `['debugging']` for Workspace Debugger, `['security', 'review']` for Security Reviewer). The orchestrator scores these structural declarations at +25 per matched need (LLM-classified) or +15 (regex fallback), giving specialists a dominant signal over token-overlap noise.
- **`fromLlm` on `ClassificationResult`**: The classifier now reports whether its output came from an LLM call or the regex fallback, allowing the orchestrator to apply higher trust weights to LLM-derived routing needs.

### Changed
- **Agent selection scoring overhaul**: `scoreAgent()` no longer includes system-prompt token hits in the base score. The UX Consultant's ~3 000-word system prompt was causing it to outscore domain-appropriate specialists on almost every technical query due to sheer token volume. Routing is now driven by `id`, `name`, `role`, `description`, and skill metadata only.
- **Routing need corpus narrowed**: `scoreAgentRoutingNeeds()` now applies pattern matching against a narrow corpus (role, name, description, skills) rather than the full corpus including the system prompt, preventing false positive routing need boosts from incidental token overlap.
- **`architecture` routing need agentPattern tightened**: Removed the generic terms `design`, `structure`, and `systems` from the pattern. These words appear in nearly every agent's description and were causing agents like the UX Consultant (role: "ux **design**…") to incorrectly receive an architecture routing need boost.

### Fixed
- **Wrong agent selected for architecture/concern tasks**: The UX Consultant was being routed for architecture boundary and integration seam reviews because of combined system prompt token volume and a false-positive architecture routing need match. The Backend Engineer or security reviewer now win correctly on such requests.

## [0.61.5] - 2026-06-03

### Added
- `architecture/boundaries-and-seams.md`: explicit review of all 8 integration seams (VS Code Extension API, Extension Host ↔ Webview, UI ↔ Orchestrator, Orchestrator ↔ Providers, Orchestrator ↔ Skills, Orchestrator ↔ Memory, Extension ↔ SecretStorage, AtlasMind ↔ MCP Servers) with contracts, protocols, and security rules for each.
- `docs/architecture/orchestrator-flow.md`: Mermaid flow diagrams for `processTaskWithAgent` and `runAgenticLoop`.
- `AgentDefinition.primaryRoutingNeeds` field: built-in agents now declare which routing-need IDs they own as a dominant signal over token-overlap scoring.
- `ClassificationResult.fromLlm` flag: marks LLM-produced vs regex-fallback classifications so the orchestrator can weight routing needs appropriately.

### Fixed
- Agent routing: removed system prompt from `scoreAgent()` token-overlap — verbose prompts were overriding role/description signals and routing nearly any technical request to the UX Consultant.
- Agent routing: narrowed the `architecture` routing-need agent pattern to avoid false-positive boosts from generic words like "design" or "structure" in unrelated agents.
- Agent Editor page: the Global Auto-Update cadence selector is now shown directly on the Editor tab so it is reachable without switching to Agent Directory.
- Agent Editor page: disabled checkboxes on built-in agents now display a read-only hint; a notice banner at the top of the form clarifies the agent cannot be saved.

## [0.61.4] - 2026-06-03

### Added
- Agent skills auto-management UI and supporting runtime behavior were expanded, with related documentation, tests, and SSOT memory snapshots refreshed to match the current implementation.

### Changed
- Synced release metadata for this commit by bumping `package.json` and `package-lock.json` to `0.61.4`.

## [0.61.3] - 2026-06-03

### Fixed
- Restored the README source-version banner to match `package.json` and added a regression test so the banner cannot drift again.
- Tightened the release/docs guidance so README, changelog, and mirror documentation are updated together when versioned changes land.

## [0.61.2] - 2026-06-03

### Changed
- README refresh: updated project overview and docs sections, including command, view, agent, skill, and configuration reference summaries.
- Version metadata sync: bumped `package.json` and `package-lock.json` to `0.61.2` for this commit.

## [0.61.1] - 2026-06-03

### Fixed
- **Windows CI**: Increased `bootstrapProject` test timeout from 15 s to 30 s to accommodate the slower `windows-2025-vs2026` runner that GitHub is rolling out.

## [0.61.0] - 2026-06-03

### Added
- **Agent Skills Auto mode**: The Manage Agents editor now features an **Auto** checkbox in the Skills section (checked by default for new agents). When Auto is on, the skill checkboxes are hidden and AtlasMind uses an AI model to assess which registered skills best match the agent's role and context. Unchecking Auto reveals the manual selection list for per-agent customisation.
- **`SkillAutoAssigner` service** (`src/core/skillAutoAssigner.ts`): New service that uses a frugal AI model call to assign skill IDs to auto-managed agents. Handles concurrent reassessments safely (skips if a reassessment for the same agent is already in-flight).
- **Automatic reassessment triggers**: Skill assignments are re-evaluated (a) immediately when an agent is saved with Auto enabled, (b) whenever an MCP server connects or disconnects (changing the available tool set), and (c) after the agent auto-updater refreshes an agent's system prompt. All reassessments are fire-and-forget — the original skills are preserved on any failure.
- **`assessAgentSkills(agentId)`** method on `AtlasMindContext` for programmatic reassessment from panels.
- `skillsAutoManaged?: boolean` field added to `AgentDefinition` in `src/types.ts`.

## [0.60.4] - 2026-06-03

### Changed
- **Pre-commit hook**: Expanded from version-bump/changelog enforcement only to a full local quality gate — now runs `compile` (TypeScript), `lint` (ESLint), and `test` (Vitest) before each commit, mirroring the CI steps. This ensures lint errors, type errors, and test failures are caught locally and CI always passes on first push.

## [0.60.3] - 2026-06-03

### Fixed
- **Windows CI**: Added a 15 s timeout to the `bootstrapProject` "keeps out-of-turn details" test, which was exceeding the default 5 s budget on the Windows CI runner (passes locally in ~140 ms; runner is noticeably slower due to the pending windows-2025-vs2026 migration).

## [0.60.2] - 2026-06-03

### Fixed
- **CI test suite**: Resolved 8 pre-existing test failures that were previously masked by a lint error which stopped the quality gate before tests ran.
  - `modelMetadataInference`: `inferCapabilities` now uses a word-boundary regex (`/\bllama/`) so `tinyllama-1b` correctly withholds `function_calling`; `inferPricing` now uses `/\bmini/` so `gemini-pro` is no longer misclassified as cheap (substring `mini` inside `gemini`).
  - `participant.helpers.test`: Updated 4 stale assertions to match the current `buildAssistantResponseMetadata` output format (summary no longer embeds the model name; bullet copy updated from v0.59.0 "tighter output" refactor).
  - `runtime/core.test`: Updated agent-selection assertion — routing now correctly prefers `test-developer` over `code-reviewer` for prompts centred on regression coverage and failing-to-passing evidence.
  - `panelFlows.test`: Updated `thoughtSummary` shape assertions (`label`, `summary`, `bullets`) to match the current chatPanel metadata format.

## [0.60.1] - 2026-06-03

### Fixed
- **ESLint CI**: Removed unused `describeCommonRoutingNeeds` import and prefixed unreachable `capitalize` function in `participant.ts`; removed unused `ModelCapability` import and prefixed unused `_agent` callback parameter in `extension.ts`. All four were pre-existing unused-var violations that blocked the quality gate.

## [0.60.0] - 2026-06-03

### Added
- **Agent Auto-Update**: User-defined agent system prompts and descriptions can now be automatically refreshed by AI on a configurable cadence. The update reviews the agent's instructions and rewrites them to reflect current best practices, remove outdated content, and ensure legal compliance across major territories (US, EU, UK, Canada, Australia). The check runs on the next use of the agent once the interval has elapsed.
  - New VS Code setting `atlasmind.agentAutoUpdateCadence` with options: `never` (default), `every-use`, `daily`, `weekly`, `monthly`.
  - Built-in agents are never auto-updated.
  - Per-agent exclusion: the Agent Manager now includes an **Exclude from auto-updates** checkbox so individually customised agents can opt out of the global cadence.
  - The `lastAutoUpdated` timestamp is persisted with the agent definition and displayed as-is in storage; the cadence clock is preserved across VS Code restarts and saves.
  - New `AgentAutoUpdater` service (`src/core/agentAutoUpdater.ts`) follows the same safe-completion pattern as `MemoryAgentExecutor` — all updates are fire-and-forget; the original agent is used unmodified if the AI call fails.
  - New `AgentAutoUpdateCadence` type and `lastAutoUpdated`/`autoUpdateExcluded` fields added to `AgentDefinition` in `src/types.ts`.

## [0.59.9] - 2026-06-03

### Fixed
- **Husky pre-commit hook**: Removed deprecated `#!/bin/sh` shebang and `. "$(dirname "$0")/_/husky.sh"` source line that will fail in Husky v10. The hook logic (version bump and CHANGELOG enforcement) is unchanged.

### Security
- **CVE-2026-8723 (qs, medium)**: Tracked. The advisory lists `qs@6.15.2` as the patched version but 6.15.2 has not been published to npm — `6.15.1` is the current latest. An `overrides` pin was attempted but fails with ETARGET. Will apply `"overrides": { "qs": ">=6.15.2" }` to `package.json` as soon as 6.15.2 is available. The vulnerability is a remotely triggerable DoS in `qs.stringify` when `encodeValuesOnly` is set with null/undefined entries in comma-format arrays; AtlasMind does not call `qs.stringify` directly so exploitability is limited to the `express` transitive path.

## [0.59.8] - 2026-06-03

### Changed
- **SEO Specialist — full LLMO, GEO, AEO, AIO coverage**: The `seo-specialist` agent now implements all four AI-era optimisation disciplines as distinct, fully-specified sections rather than a single merged "AI-Native" paragraph.
  - **AEO (Answer Engine Optimisation)**: featured snippet format rules (paragraph ≤60 words, list ≤8 items, table), People Also Ask targeting with FAQPage + Speakable JSON-LD, voice-assistant answers ≤30 words, Speakable schema (`speakable.cssSelector`), conversational query patterns, entity cross-referencing to Wikipedia/Wikidata.
  - **GEO (Generative Engine Optimisation)**: citable statistics with explicit inline attribution (generative engines prefer citing concrete numbers); quotable 3–5 sentence passages that are independently comprehensible when extracted verbatim; source credibility signals (author credentials, publication dates, institutional affiliations); fluency optimisation (GEO research identifies fluency as the strongest AI citation predictor); elimination of AI-generated content patterns (repetitive phrasing, generic lists, vague claims) that reduce citation likelihood.
  - **AIO (AI Overview Optimisation — Google-specific)**: inclusion factors (top-10 ranking correlation, direct factual openings per section, complete topical coverage, structured data role); content structure guidelines (concise factual first sentence, supporting detail after, no long preambles before the answer); local business AI Overview (GBP, NAP consistency, LocalBusiness schema); product/shopping AI Overview (Product schema, detailed descriptions, AggregateRating); opt-out mechanism (`<meta name="google" content="nosnippet">`, `data-nosnippet`, `max-snippet:-1`); Search Console monitoring via the "Search Appearance" filter.
  - **LLMO (Large Language Model Optimisation — new, previously absent)**: `/llms.txt` file implementation (llmstxt.org standard — declares content LLMs may use, with structured URL/description index and optional `/llms-full.txt`); AI web crawler access audit — GPTBot (OpenAI), ClaudeBot (Anthropic), Google-Extended (Gemini training), PerplexityBot, Applebot-Extended, Meta-ExternalAgent must not be accidentally blocked in robots.txt; brand entity definition for LLM parametric knowledge (Wikipedia article, Wikidata Q-number with official website and social media links, Google Knowledge Panel); Common Crawl training-data inclusion signals (clean HTML, original content, no spam); LLM citation optimisation (unique citable data, named methodologies, original research that cannot be attributed elsewhere); monitoring ChatGPT/Claude/Gemini/Perplexity responses for brand accuracy and hallucinations, with correction via authoritative indexed content.
  - **TDD policy expanded**: verification criteria added for all four disciplines — AEO (FAQPage/Speakable Rich Results Test, featured-snippet paragraph length, PAA heading structure), GEO (statistics have inline attribution, key paragraphs are independently comprehensible), AIO (no preamble before opening factual sentence, correct opt-in/opt-out directives, Search Console configured), LLMO (llms.txt exists, AI crawlers not blocked, brand entity consistent, Wikidata accurate).

## [0.59.7] - 2026-06-03

### Added
- **SEO Specialist agent** (`seo-specialist`): New built-in agent for technical SEO, AI-Native/Answer Engine Optimisation (AEO), and multi-surface discoverability. A new `seo` routing need ID is added to the classifier and orchestrator so SEO-vocabulary prompts (meta, sitemap, schema, ranking, crawl, AEO, Open Graph, Core Web Vitals, etc.) route directly to this agent rather than falling through to the generalist. Coverage: technical SEO (meta title/description, canonical URLs, XML sitemaps, robots.txt, JS rendering audit, duplicate content, URL structure); Schema.org JSON-LD structured data (WebSite, Article, FAQPage, HowTo, BreadcrumbList, SoftwareApplication, Product, Organization, and more) validated against schema.org and the Google Rich Results Test; Core Web Vitals as hard ranking requirements (LCP < 2.5 s, CLS < 0.1, INP < 200 ms) with before/after Lighthouse measurement; AI-Native/AEO (direct factual openings for featured-snippet extraction, entity-based content for Knowledge Graph, E-E-A-T signals, conversational query targeting for voice and AI assistant surfaces); multi-surface discoverability (Open Graph + Twitter Card social previews, VS Code Marketplace listing copy + keywords + icon, GitHub repository description + topic tags + README structure, npm package.json description + keywords); international SEO (hreflang with x-default cross-referencing). SEO elements are treated as code correctness requirements with testable verification criteria.

## [0.59.6] - 2026-06-03

### Changed
- **UX Consultant — responsive breakpoint coverage**: The `ux-consultant` agent now applies mobile-first responsive layouts across five named breakpoints as a non-negotiable baseline alongside full accessibility. Uses the project's existing breakpoint tokens when present (Tailwind sm/md/lg/xl/2xl, MUI xs–xl, Bootstrap, or custom); otherwise applies a standard set: mobile (<768px, single-column/full-width), tablet (768px–1023px, two-column/collapsible sidebar), small desktop (1024px–1279px, sidebar+content), large desktop (1280px–1919px, multi-column/expanded grids), ultra-wide (≥1920px, max-width-capped container centred in viewport, never full-stretch text lines). No layout may produce horizontal scroll on its target breakpoint; content hierarchy is preserved across all sizes.

## [0.59.5] - 2026-06-03

### Added
- **UX Consultant agent** (`ux-consultant`): New built-in agent for UX critique and professional accessible UI surface generation. Full accessibility is a non-negotiable baseline integrated throughout every output — not a final checklist. Covers: all input modalities (keyboard with correct semantics, mouse, touch ≥44×44 px, voice control with pronounceable accessible names); screen readers (semantic HTML, ARIA labels and live regions, logical heading hierarchy, icon-button labelling, alt text); all four visual modes (light, dark, high-contrast light, high-contrast dark) via --vscode-* variables or prefers-color-scheme/prefers-contrast; colour-blind safety across protanopia, deuteranopia, tritanopia, and achromatopsia — never colour alone to convey information; WCAG 2.2 AA contrast (4.5:1 body text, 3:1 UI components) with AAA aspiration; visible focus indicators in all themes (minimum 3:1 focused/unfocused contrast); prefers-reduced-motion compliance; no content flashing more than three times per second; layout usable at 200% text zoom; form errors identified by field name in text with correction hint. Also detects the project's design stack (VS Code webview toolkit, React + Tailwind/shadcn, Material UI, vanilla CSS, etc.) and generates complete production-ready code using the project's own tokens and primitives. Distinguishes "broken" (frontend engineer) from "confusing" (UX territory) in critique mode. Does not create image or graphic assets.

## [0.59.4] - 2026-06-03

### Fixed
- **Chat surface focus**: Focusing on the AtlasMind chat no longer opens an unexpected second window. A `lastUsedSurface` tracker on `ChatPanel` remembers whether the user last interacted with the sidebar view or the detached editor panel, and `revealPreferredChatSurface` now honours that preference instead of always preferring the detached panel. Tool-approval and generated-skill-review flows (which previously hard-coded `atlasmind.openChatPanel`) now use the preferred surface so the sidebar is respected.

## [0.59.3] - 2026-06-03

### Changed
- **Instruction sync**: Synchronized `CLAUDE.md` and `.github/copilot-instructions.md` so both AI coding assistants share the same rules. Added full Core Services table, UI Surfaces table, Documentation Files and Wiki Pages sections, and the extra Security redaction-boundary rule to `CLAUDE.md`. Added the explicit Branching section and Publishing Routine to the Copilot instructions.

## [0.59.2] - 2026-06-03

### Fixed
- **Dashboard prompt buttons default to New Session**: Clicking any "Ask Atlas…", "Analyze in chat", or similar prompt-triggering button in the dashboard now opens the chat panel with the send-mode dropdown defaulted to **New Session**, consistent with all other dashboard-initiated chat actions (gap analysis, gap resolution, TDD fix).

## [0.59.1] - 2026-06-03

### Fixed
- **Dashboard list panels**: Long lists (commits, sessions, runs, SSOT files, roadmap, gap analysis, tests, branches) now cap at 480 px with a scrollbar rather than expanding the panel to arbitrary height. Nested lists (e.g. tests within a category group) are excluded from the cap to avoid double-scrolling.
- **Dashboard recent-item padding**: Card-style list items (`recent-item`) now carry 12 px / 14 px padding so text and tags no longer press against the card border.

## [0.59.0] - 2026-06-03

### Added
- **Quick-reply pill buttons**: When an assistant response ends with a question, pill buttons now appear below the message for one-tap replies. Yes/No buttons are generated for confirmatory questions ("Shall I proceed?", "Want me to…?"). A/B buttons are extracted from "X or Y?" patterns. Generic trailing questions surface a text input without pills. Clicking a pill submits immediately — no "Proceed" step required.

### Changed
- **Continuation detection expanded**: "yes", "yes please", "sure", "ok", "yep", "go for it", "no", "no thanks", "nope", "skip it", "cancel" are now recognised as continuation signals. The model is told to execute the pending next step rather than re-analyse.
- **Session continuity hint**: When structured session context is loaded, the orchestrator system prompt now explicitly instructs the model to treat the session context as ground truth and not re-derive established findings, file paths, or concluded work.
- **Tighter thought summary**: Removed "Agent: X via Y" and raw `N in / M out` bullet lines from the user-visible thought summary. Cost is shown as a single concise line (`$0.0012 · 1,234 in / 456 out`). The agent/model routing detail was noise for most users.
- **Dead code removed**: Deleted `_registerDefaultProviders` (~296 lines) from `extension.ts`. The function was never called; provider seed configs are wired inline in `bootstrapAtlasMind`. This reduces the god-file by ~8% as part of the ongoing [P2] code-structure gap closure.

## [0.58.0] - 2026-06-03

### Added
- **Memory Agent** (`memory-agent`): New built-in agent that owns all memory maintenance LLM calls — session context updates and SSOT snippet refreshes. Visible in the Agents panel; configure `allowedModels` to pin it to a local Ollama model and avoid cloud costs for background memory ops entirely.
- **Unified session context (`context.md`)**: Session context is now maintained as a single `context.md` per session (Goal, Approach, Findings, Concluded, Open Threads, SSOT Links, Current State) with a 4000-char cap. This replaces the previous 3-call fan-out across `summary.md`, `decisions.md`, and `open_threads.md`, cutting background LLM calls per turn from 3 to 1 and producing a coherent document designed for seamless cold resumption.
- **SSOT snippet refresh**: The Memory Agent periodically detects SSOT entries whose source files have changed but whose snippets are stale, and regenerates them in the background (max 3 per cycle). This prevents degrading retrieval quality as source files evolve.

### Changed
- Legacy session folders (pre-`context.md`) are read transparently via the old 4-file format and migrated to `context.md` on the next maintenance run. No manual migration needed.
- `SessionContextManager` now exposes `getSsotRoot()` for components that need the resolved SSOT path.

## [0.57.13] - 2026-06-03

### Added
- **Documentation Writer agent** (`docs-writer`): New built-in agent for README files, API reference docs, JSDoc/TSDoc comments, wiki pages, guides, changelogs, and inline documentation. Inspects the codebase before writing to match existing style, verifies code snippets against the implementation, and runs any configured docs-linting or link-checking step. Routes to cheap models for most documentation tasks.
- **Performance Analyst agent** (`performance-analyst`): New built-in agent for CPU hot paths, memory leaks, slow queries, high latency, throughput issues, and general optimization. Gathers observable evidence (profiling, benchmarks, timing logs) before proposing changes and verifies improvement is measurable afterward.
- **DevOps Engineer agent** (`devops-engineer`): New built-in agent for CI/CD pipelines, GitHub Actions, Dockerfiles, Docker Compose, Kubernetes manifests, Terraform/Bicep IaC, and deployment configs. States blast radius before applying infra changes and validates trigger conditions and environment assumptions for workflow changes.
- **Dependency Manager agent** (`dependency-manager`): New built-in agent for npm/pip/cargo/yarn/pnpm package updates, vulnerability remediation, peer conflict resolution, and lockfile hygiene. Checks changelogs for breaking changes before updating, runs tests afterward, and flags packages with known vulnerabilities or abandoned maintenance.
- **`http-request` skill**: Make HTTP requests with configurable method (GET/POST/PUT/PATCH/DELETE), headers, and request body. Applies the same SSRF protection as `web-fetch` (blocks localhost, private IPs, and metadata endpoints). Fills the gap left by `web-fetch` being GET-only.
- **`git-push` skill**: Push a branch to a remote with a built-in protected-branch guard. Force-pushes to `main`, `master`, `production`, `release/*`, and `hotfix/*` are rejected outright. When force is requested on a safe branch, uses `--force-with-lease` rather than `--force` to abort if the remote has moved since the last fetch.
- **`code-format` skill**: Format a file or directory using the project's configured formatter. Auto-detects prettier, eslint (--fix), rustfmt, black, gofmt, or dotnet-format from workspace config files and file extensions. A specific formatter can be forced via the `formatter` parameter.

### Changed
- **Cleaner activity display during execution**: Mechanical routing messages (model selection retries, local-model preference notices, per-iteration heartbeats) are now filtered from the streaming activity log shown to the user, reducing noise. Only meaningful milestones — agent selection, tool calls, model switches, and errors — appear in the "Working" activity panel.
- **Action-oriented final summary**: The "What Atlas did" disclosure (formerly "Thinking summary") now leads with a plain-English description of what was accomplished (e.g. "Used 4 tool calls — edited ×2, ran commands ×1.") rather than internal routing jargon. Technical details (agent, tokens, cost) are retained but deprioritised to the bottom of the expanded view.
- **Activity panel label**: The in-progress disclosure history is relabelled from "Inner monologue" to "Working" with a step count, matching the language of other AI coding tools.

## [0.57.12] - 2026-06-03

### Added
- **GitHub Operator agent** (`github-operator`): New built-in agent specializing in pull requests, issues, CI/CD workflow inspection, branch management, and repository housekeeping. Routes to cheap/local models for mechanical git operations (commit, push, PR creation, status checks) and escalates for CI diagnosis or complex PR analysis. Skips TDD formalities for purely mechanical git ops but expects a regression signal when workflow or config changes touch behavior.
- **Test Developer agent** (`test-developer`): New built-in agent specializing in writing, organizing, and maintaining automated tests — unit, integration, E2E, regression, and coverage analysis. Applies a hard test-first rule (failing spec before implementation) and closes every task with a run report showing the failing-to-passing transition and coverage delta. Naturally routes to cheap/local models for routine test generation and test-run commands.
- **Gap Analysis "Open Files" button**: Each gap item in the Project Dashboard Gap Analysis page now has an "Open Files" button that opens VS Code's Find in Files panel pre-filled with keywords from the gap text, scoped to category-relevant file patterns (`**/*.md` for documentation, `project_memory/**` for memory, `media/**,src/views/**` for UI/UX, etc.).

### Changed
- **Gap Analysis no longer auto-starts on navigation**: Navigating to the Gap Analysis page now shows existing findings rather than auto-triggering a new analysis run. The "Run Gap Analysis" / "Re-run Analysis" button initiates the analysis explicitly.
- **Smarter model routing for simple tasks**: The orchestrator now automatically downgrades `budget: auto` to `budget: cheap` (and `speed: fast`) for mechanical low-overhead tasks — git operations (commit, push, stash, pull, fetch, checkout, reset), script execution (run tests, npm build, yarn lint, etc.), short ≤10 word commands the classifier rates as `low` reasoning, and narrow test generation ("write a test for X"). This routes these to local or haiku-tier models first rather than consuming expensive subscription quota or pay-per-token credits on tasks that don't need complex reasoning. The `shouldPreferLocalToolCapableModelForPrompt` threshold is also widened from ≤5 to ≤8 words, and it now explicitly fast-paths git/script patterns for local-model preference when a local model is available.

### Fixed
- **Gap Analysis dashboard not updating**: Two bugs caused the Project Dashboard Gap Analysis page to show stale results after running a new analysis.
  1. When Claude's response lacked a perfectly-formatted checklist, `persistGapAnalysisIfRequested` was overwriting `gap-analysis.md` with the old seed items (the same items that seeded the run), reverting the dashboard to its pre-analysis state. The file is now left unchanged in that case, and a status message is posted instead.
  2. `collectGapAnalysisSnapshot` was always merging heuristic fallback items into the result alongside the real analysis items, so old heuristic gaps never disappeared after a new analysis. Heuristic items are now used only when the analysis file is absent or contains no parseable items.

## [0.57.11] - 2026-05-13

### Fixed
- CI lint compatibility: removed the unsupported `--ext` flag from the `lint` npm script when using ESLint flat config, so `quality` runs now execute successfully across Ubuntu, macOS, and Windows.

## [0.57.10] - 2026-05-13

### Changed
- Triggered a maintainer-authored CI run to clear an `action_required` workflow state and allow required `quality` checks to report for the release PR.
- Chat tool activity in the dedicated panel now renders inside the inner-monologue/thinking surface with latest-first display by default and a collapsible history for earlier updates.
- Memory self-healing now quarantines blocked SSOT entries into `temp/quarantine/*.blocked.txt.bak`, replaces blocked files with safe placeholders, sanitizes warned entries (hidden Unicode, suspicious instruction-like comments, secret-like values), and reindexes memory automatically.

### Fixed
- SSOT memory documentation now explicitly includes the internal `project_memory/sessions/` folder and clarifies that it is reserved for session context persistence and excluded from normal SSOT retrieval/index queries.

## [0.57.9] - 2026-05-13

### Added
- Deterministic SSOT auto-linker: Memory indexing and upserts now infer lightweight neighbor links when matching sibling artifacts exist in paired folders: `decisions/ <-> roadmap/` and `architecture/ <-> operations/`.

### Changed
- Bounded relation storage: `relatedPaths` are now capped to keep relationship density predictable and prevent graph-style noise growth over time.
- Cross-entry consistency on writes: Upserts now re-apply the auto-link pass across loaded memory entries so newly added sibling artifacts can become discoverable in one-hop expansion immediately.

## [0.57.8] - 2026-05-13

### Added
- Lightweight memory relationship overlay: `MemoryEntry` now supports optional `relatedPaths` links so SSOT notes can declare explicit neighbor artifacts (for example, decision -> rollout plan).

### Changed
- One-hop retrieval expansion: `MemoryManager.queryRelevant()` and `queryWithOptions()` now append bounded one-hop neighbors from top-ranked entries when result slots remain, giving AtlasMind better context continuity without replacing the existing lexical/vector ranking.
- Node CLI memory parity: `NodeMemoryManager` now applies the same related-path parsing and one-hop expansion behavior as the VS Code host memory manager.

### Fixed
- Import metadata ingestion: Memory import trailers now parse an optional `related-paths` field so generated memory can carry relationship links into retrieval.

## [0.57.7] - 2026-05-13

### Fixed
- Tool execution webview event handling regression: Removed duplicated nested status and busy handlers in `media/chatPanel.js` that caused repeated processing and unstable history rendering.
- Structured tool payload parsing: Replaced fragile regex parsing for `[TOOL_EXEC]` progress updates with brace-depth JSON extraction so nested tool metadata parses reliably.
- Chat panel template duplication and CSS corruption: Removed duplicated `recoveryNotice` markup and repaired the tool-history CSS block placement in `src/views/chatPanel.ts`.
- Changelog integrity: Repaired malformed and duplicated `0.57.3`/`0.57.4` sections introduced during prior editing.


## [0.57.2] - 2026-04-27

### Changed
- Version bump to 0.57.2

### Fixed
- **Copilot quota hard-stops**: Copilot's `"You've exhausted your premium model quota"` error was not recognised as a billing error, so the session failover and recovery path was never triggered ÔÇö the extension hard-stopped instead of pausing the provider and surfacing a helpful message. Added `exhausted ÔÇª quota`, `exhausted ÔÇª premium`, `premium model quota`, and `allowance to renew` to the `isBillingError` detection patterns.
- **`review` over-escalates to Opus**: The bare word `review` in `HIGH_REASONING_HINTS` caused lightweight read requests like `"review the roadmap"` to be profiled as high-reasoning and routed to the most expensive model. Removed `review` from that pattern; `code review` (the genuinely complex case) is still matched.

## [0.57.1] - 2026-04-24

### Fixed
- **Copilot quota hard-stops**: Copilot's `"You've exhausted your premium model quota"` error was not recognised as a billing error, so the session failover and recovery path was never triggered - the extension hard-stopped instead of pausing the provider and surfacing a helpful message. Added `exhausted ... quota`, `exhausted ... premium`, `premium model quota`, and `allowance to renew` to the `isBillingError` detection patterns.
- **`review` over-escalates to Opus**: The bare word `review` in `HIGH_REASONING_HINTS` caused lightweight read requests like `"review the roadmap"` to be profiled as high-reasoning and routed to the most expensive model. Removed `review` from that pattern; `code review` (the genuinely complex case) is still matched.

## [0.57.0] - 2026-04-23

### Added
- **`ClassifierService`** (`src/core/classifierService.ts`): Single batched LLM call (cheap/local-first via the `completeMaintenance` path) that answers all routing questions at once ÔÇö specialist domain, routing needs, modality, reasoning depth, workspace bias, and UI command ÔÇö replacing ~50 per-request regex tests. The system prompt is prompt-cached across calls; only the user message and the ~30-token JSON response vary per call. Every field has a regex fallback so the service degrades gracefully when no model is available or the response is malformed.
- **`Orchestrator.classify()` public method**: Exposes `ClassifierService.classify()` so callers in `participant.ts` (and future callers) can run a classification without duplicating construction concerns.
- **`resolveSpecialistRoutingPlanWithClassifier()`** in `participant.ts`: Async specialist-routing resolver that replaces the 6 domain regex patterns (`VOICE_WORKFLOW_PATTERN`, `IMAGE_ANALYSIS_ACTION_PATTERN`, etc.) and the 20-entry `NATURAL_LANGUAGE_COMMAND_INTENTS` array with a single `Orchestrator.classify()` call. Falls back to the sync regex `resolveSpecialistRoutingPlan()` on any failure.

### Changed
- **`Orchestrator.processTask()`**: Runs `ClassifierService.classify()` once per request and embeds the result as `__classification` in `request.context`; downstream functions (`selectAgent`, `buildMessages`, `profileTask`) read from this key instead of re-running regex.
- **`selectAgent()`**: Reads `classification.routingNeeds` and `classification.workspaceBias` from context instead of `COMMON_ROUTING_HEURISTICS` regex.
- **`buildMessages()`**: Reads `classification.routingNeeds`, `biasDirect` (`workspaceBias === 'act'`), and `biasInvestigate` (`workspaceBias === 'investigate'`) from context.
- **`TaskProfiler.profileTask()`**: Reads `modality` and `reasoning` from `context.__classification` when present, skipping per-call regex inference.

## [0.56.0] - 2026-04-23

### Added
- **Universal prompt decomposition**: All freeform chat prompts are now analysed for multi-action intent. When a prompt contains two or more distinct, separable actions (e.g. "fix X, then add Y and update Z", or a numbered task list), AtlasMind automatically decomposes it into a Planner-generated subtask DAG and executes each step sequentially or in parallel. A fast cheap LLM classifier (via the existing `completeMaintenance` path) makes the decision instead of fragile hardcoded heuristics; an obvious-structure regex short-circuits it for free on explicitly formatted lists.
- **`processTaskMultiStep` orchestrator method**: New public method on `Orchestrator` that decomposes a single `TaskRequest` into a subtask DAG using the `Planner`, executes steps via the `TaskScheduler`, streams each result as it completes, and synthesises a unified final response. Progress callbacks include per-step start/done/retry events. Returns `TaskResult & { stepwiseResults }` so callers can inspect individual step outcomes.
- **`subtask-retry` progress event**: `ProjectProgressUpdate` now includes a `subtask-retry` variant emitted whenever a subtask is retried (transient provider error or empty/capped response). The project runner and multi-step path surface this to the user as a progress message.
- **`TaskResult.stepwiseResults`**: Optional field added to `TaskResult` carrying the ordered `SubTaskResult[]` from a multi-step execution.

### Changed
- **Robust error recovery in all chat modes**: `runChatTask` (freeform and vision paths) and the native VS Code chat path now wrap `processTask` in a recovery layer. On failure it retries once with a simplified prompt (truncated to 200 chars plus a `[Simplified retry]` directive); if the retry also fails, it surfaces an actionable error message (credit exhaustion, network failure, no model available, etc.) rather than a raw exception.
- **`executeSubTask` auto-retry**: If a subtask produces an empty response or hits the iteration cap, the orchestrator retries it once with a simplified prompt before marking it failed. On transient provider errors it also retries once before returning a `failed` result, with recovery-hint text streamed to the chat.
- **`executeSubTask` passes `onProgress`**: The `onProgress` callback is now forwarded from `processProject` into `executeSubTask` so retry events are visible on the project runner stream.

## [0.55.4] - 2026-04-22

### Fixed
- **Shopify template presets generate sparse/generic documentation**: The root cause was that `applyTemplateScaffolding` ran *after* `applyBootstrapIntake`, so the AI generation (soul, brief, roadmap, improvement plan) had almost no Shopify-specific context to work from. Two changes fix this:
  1. **`enrichIntakeForTemplate`** ÔÇö called before the write phase, fills in `techStack`, `thirdPartyTools`, `productSummary`, `productOutcome`, and `targetAudience` with Shopify-appropriate defaults for each preset (New Store, Theme, App), skipping any field the user already answered. This gives `generateBootstrapContent` full context so all four AI calls produce Shopify-specific output.
  2. **Template scaffolding now runs before AI generation** ÔÇö workspace files (`layout/`, `sections/`, routes, `shopify.app.toml`, etc.) and `project_memory/operations/getting-started.md` are written first; then the enriched intake drives AI generation of `project_soul.md`, `domain/project-brief.md`, `roadmap/bootstrap-plan.md`, and `roadmap/improvement-plan.md` with accurate Shopify stack context.

## [0.55.3] - 2026-04-22

### Added
- **Bootstrap resume / draft persistence**: The bootstrap intake now saves a draft to `project_memory/index/bootstrap-draft.json` after every answered question. If bootstrap is interrupted at any point ÔÇö window close, error, ESC ÔÇö the next run detects the draft and offers three choices: **Resume** (pre-populate all previously answered fields and skip those questions), **Start over** (discard draft and begin fresh), or **Cancel**. The resume prompt shows how many answers were saved and when the draft was last updated. The draft is automatically deleted on successful completion. Resuming works across all modes (guided, minimal, and template/Shopify starter kits).

## [0.55.2] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö GitHub repo creation fails with "--push enabled but no commits found"**: `gh repo create --push` requires at least one commit to exist in the local repo. Bootstrap now checks for commits with `git log -1` before invoking `gh repo create`; if none exist, it runs `git add -A && git commit -m "chore: initial AtlasMind bootstrap scaffold"` first so the push always succeeds.

## [0.55.1] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö "Unable to write to Folder Settings" error**: `applyBootstrapSettings` was using `ConfigurationTarget.WorkspaceFolder`, which requires the configuration object to have been scoped to a workspace folder resource. Bootstrap calls `getConfiguration` without a resource URI, so the target is now `ConfigurationTarget.Workspace` (writes to `.vscode/settings.json`), which is both correct for single-root workspaces and doesn't require a folder resource.

### Changed
- **Shopify starter kits moved into project type picker**: The three Shopify templates (New Store, Store / Theme, App) are now presented as options inside the "What type of project is this?" step of the guided intake, rather than as a separate "From template" mode at the start of bootstrap. This keeps the bootstrap entry point to two options (Guided and Minimal) and makes the Shopify options discoverable alongside standard project types.

## [0.55.0] - 2026-04-22

### Added
- **Shopify project templates in bootstrapper**: Three new templates are available under the "From template" bootstrap mode:
  - **Shopify New Store** ÔÇö `.shopifyignore`, `.vscode/extensions.json` (recommends `Shopify.theme-check-vscode` + `Shopify.shopify-dev-assistant`), and a `project_memory/operations/getting-started.md` covering Partner account setup, dev store creation, CLI install, auth, and day-to-day commands.
  - **Shopify Store / Theme** ÔÇö Full Liquid theme directory scaffold (`layout/theme.liquid`, `templates/*.json`, `sections/`, `snippets/`, `assets/`, `config/settings_schema.json`, `locales/en.default.json`), `.shopifyignore`, `.github/workflows/theme-check.yml` (uses `Shopify/theme-check-action@v2`), `.vscode/extensions.json` (recommends `Shopify.theme-check-vscode` + `GraphQL.vscode-graphql`), and a getting-started guide.
  - **Shopify App** ÔÇö Remix-based app structure (`shopify.app.toml`, `.env.example`, `web/app/routes/`, `extensions/`), `.github/workflows/deploy.yml`, `.vscode/extensions.json` (recommends `Shopify.shopify-dev-assistant`, `Shopify.theme-check-vscode`, `GraphQL.vscode-graphql`, `esbenp.prettier-vscode`, `dbaeumer.vscode-eslint`), and a getting-started guide covering Partner app registration, CLI auth, and `shopify app dev`.
  - All three templates write files only if they do not already exist and output a getting-started guide to `project_memory/operations/getting-started.md`.
- **`BootstrapProjectIntake.mode` extended** with `'template'` variant; `selectedTemplate` field added for `'shopify-new-store' | 'shopify-theme' | 'shopify-app'`.
- **Bootstrap completion summary** now reports which template was scaffolded when the template mode is used.

## [0.54.5] - 2026-04-22

### Added
- **AI-generated bootstrap memory**: Bootstrap now calls the model during the write phase to reason about the project rather than slot-filling templates. Four parallel `completeBootstrap` calls generate: (1) a specific Vision and Principles for `project_soul.md`, (2) a full problem-space analysis with open questions for `domain/project-brief.md`, (3) a project-specific prioritised checklist for `roadmap/bootstrap-plan.md`, and (4) a reasoned developer backlog for `roadmap/improvement-plan.md`. Each document falls back to the existing template if no model is available or the call returns empty, so bootstrap remains fully functional offline.
- **`Orchestrator.completeBootstrap()`**: New one-shot completion path used exclusively by bootstrap generation ÔÇö routes via `balanced` budget constraints, 3000 token cap, and temperature 0.4 for richer prose output.

## [0.54.4] - 2026-04-22

### Fixed
- **Bootstrap ÔÇö duplicate repo questions**: Removed the redundant "planned repo location" text field from the intake questionnaire; the actual GitHub creation prompts (name, owner, visibility) already collect this information at creation time.
- **Bootstrap ÔÇö silent failure after cadence question**: The entire write phase (SSOT scaffold, memory files, governance baseline) now runs inside `vscode.window.withProgress`, giving a persistent notification with step-by-step progress messages ("Creating SSOT scaffoldÔÇª", "Writing project memoryÔÇª", etc.). Any uncaught error now surfaces as an explicit error notification instead of disappearing silently.
- **Bootstrap ÔÇö governance baseline ignores intake answers**: `scaffoldGovernanceBaseline` now uses the dependency monitoring provider and schedule selections made during bootstrap intake rather than falling back to workspace settings, so the answers the user just gave are actually applied.

## [0.54.3] - 2026-04-22

### Added
- **No-project CTAs in Quick Links and Project Dashboard**: "Bootstrap new project" and "Import existing project" buttons are now shown prominently when no AtlasMind project memory is loaded. In the Quick Links sidebar, they appear as two full-width buttons below the icon row. In the Project Dashboard, they appear as a banner above the topbar. Both sets of buttons disappear once a project is bootstrapped or imported.

## [0.54.2] - 2026-04-22

### Fixed
- **Bootstrap remote repo creation**: When "Create a new online repo now" is selected during bootstrap, Atlas now actually creates the repository rather than silently recording intent. For GitHub, Atlas invokes `gh repo create` with the chosen name, owner, and visibility, then pushes the initial commit and sets `origin`. If `gh` is not installed, Atlas auto-installs it using the first available package manager (`winget`/`scoop`/`choco` on Windows, `brew` on macOS, `apt`/`dnf` on Linux) with a confirmation prompt before proceeding; falls back to a manual install link if no package manager is found. For Azure DevOps and GitLab, Atlas shows the equivalent CLI command and opens a terminal. The completion summary now distinguishes between a successfully created repo (with URL), a failed attempt with recovery instructions, and a deferred/skipped state.
- **Bootstrap question wording**: Updated the online repo question option from "Needs a new online repo" to "Create a new online repo now" and the repo-host sub-question to make the immediate creation intent explicit.

## [0.54.1] - 2026-04-21

### Fixed
- **Settings panel navigation**: The "Testing" tab button was missing from the settings nav sidebar, making the Testing page unreachable. Restored the nav button between Safety & Verification and Project Runs.

## [0.54.0] - 2026-04-21

### Added
- **Session SSOT context** (`src/memory/sessionContextManager.ts`): New `SessionContextManager` service maintains a per-session folder under `project_memory/sessions/<id>/` containing a rolling `summary.md`, `decisions.md` (concluded facts and fixes), `open_threads.md` (unresolved questions), `ssot_links.md` (cited main SSOT entries), and an append-only `transcript.jsonl`. Updated each turn via a fire-and-forget maintenance pipeline.
- **Structured session context in model prompts**: Orchestrator `buildMessages()` and `buildRetrievalContext()` now consume the `SessionContextBundle` when available, replacing the previous 400-char session context string. The bundle provides up to 2000 chars of structured summary + decisions + open threads + cross-referenced SSOT excerpts, giving models full coherent context when returning to a session after any gap.
- **Main SSOT cross-referencing per session**: Maintenance pipeline detects word overlap between session content and main SSOT entries (`decisions/`, `misadventures/`, `architecture/`, `roadmap/`, `domain/`, `operations/`) and cites relevant files in `ssot_links.md`, loading short excerpts into the model context on each turn.
- **Maintenance model routing**: `ModelRouter.scoreModel()` now applies a `maintenance` phase bonus ÔÇö local models with context ÔëÑ 8192 score +2.0, free-tier cloud models score +1.5 ÔÇö ensuring background summarization tasks consume local/free capacity first and never burn quota.
- **`completeMaintenance()` on Orchestrator**: New lightweight one-shot completion path that routes via the `maintenance` task profile, caps output at 1024 tokens, and silently returns empty string on any error. Used by `SessionContextManager` and provider hard-stop recovery.
- **Self-healing provider hard-stop recovery**: When all failover models are exhausted after a provider failure, the orchestrator now calls `completeMaintenance()` to generate a human-readable recovery acknowledgement (what happened, what completed, what to do next) rather than surfacing a raw error string as the final chat bubble.
- **Session SSOT cleanup on delete**: Deleting a chat session from the chat panel now also removes the corresponding `project_memory/sessions/<id>/` folder.
- **`getActiveSessionId()` on `SessionConversation`**: Exposes the currently active session ID as a public method.

### Changed
- **`SSOT_FOLDERS`** extended with `'sessions'` ÔÇö bootstrapper creates `project_memory/sessions/` on first activation.
- **`TaskPhase`** extended with `'maintenance'` for background routing.
- **`MemoryDocumentClass`** extended with `'session-context'`.
- **`SessionContextBundle`** interface added to `types.ts`.
- **`MemoryManager.queryRelevant()`** and `queryWithOptions()` now exclude `sessions/` paths from general SSOT queries ÔÇö session context is loaded directly by `SessionContextManager`.
- **Session context budget** raised from 400 to 2000 chars in `buildRetrievalContext()` for the legacy string fallback path.
- **`chatPanel.ts`**: `preparePromptRequest()` accepts an optional `SessionContextBundle` and injects it alongside `chatSessionId` in the request context.

## [0.53.7] - 2026-04-21

### Changed
- **Dev tooling upgraded**: vitest `2.x` ÔåÆ `4.1.5`, eslint `9.x` ÔåÆ `10.2.1`, TypeScript `5.x` ÔåÆ `6.0.3`. All 890 tests pass, zero lint warnings.

### Fixed
- **Locale-stable token formatting**: `participant.ts` now calls `toLocaleString('en-US')` so token counts always render with comma separators on non-English CI environments.
- **Locale-stable test assertions**: Usage bullet assertions in `participant.helpers.test.ts` now match on token counts only (currency symbol varies by OS locale); vscode mock pins `displayCurrency` to `'USD'`.

## [0.53.6] - 2026-04-21

### Added
- **Live local model sync** (`src/providers/localModelSync.ts`): New module queries Ollama (`GET /api/tags` + `POST /api/show`) and LM Studio (`GET /v1/models`) in parallel on each activation (30 s timeout). Extracts real context window from `model_info.*.context_length` or `NUM_CTX` in the modelfile, parameter count, and quantisation level. Results are cached in `globalState` with a 1-hour TTL and applied as highest-priority metadata in `mergeProviderModels`, so Ollama's actual context length beats the static catalog.

### Fixed
- **Local model pricing forced to zero** in `inferModelMetadata`: local provider models no longer inherit cloud pricing heuristics ÔÇö `inputPricePer1k` and `outputPricePer1k` are always 0 when `providerId === 'local'`.

## [0.53.5] - 2026-04-21

### Added
- **`LOCAL_CATALOG`** in `src/providers/modelCatalog.ts`: Static entries covering Gemma 3 (1B/4B/12B/27B with vision on 4B+), Nemotron (Mini/Nano/4B/70B), Devstral (Small/generic), Mistral (7B/NeMo/Small/Large), Qwen 2.5 Coder (7B/14B/32B), Qwen 2.5, Qwen 3 (14B/30B/235B with reasoning), Llama 3.x (1B/8B/70B), Phi (3/3.5/4), DeepSeek R1 distills, Codestral, Command R/R+. All entries carry correct zero pricing and accurate capability flags including vision where supported.

### Fixed
- **`inferCapabilities` updated** for local models: small (< 4 B) local models no longer get `function_calling` by default; tool support is granted only for families known to support it (Mistral, Qwen, Llama, Command, Devstral, etc.).

## [0.53.4] - 2026-04-21

### Fixed
- **`scoreLocalPreference` rewritten** in `ModelRouter`: the previous flat +1.0 bonus was large enough to override capable free-subscription cloud models and double-counted the zero-cost advantage already captured by `scoreCheapness`. Replaced with a graduated, capability-gated bonus (max +0.4) that penalises local models without reasoning for high-reasoning tasks and returns 0 for models with a context window below 16 k.
- **`classifySpeedTier` fixed** for local models: non-echo local models are now classified as `'balanced'` instead of `'fast'`, so they are no longer excluded from `speed: 'considered'` task routing.
- **`shouldPreferLocalToolCapableModelForPrompt` tightened**: word-count threshold tightened from 8 to 5, and complexity verbs (`fix`, `refactor`, `debug`, `implement`, etc.) and complexity-indicator words (`all`, `entire`, `comprehensive`, etc.) now suppress local-first routing so complex multi-step requests are not incorrectly steered to small local models.

## [0.53.3] - 2026-04-21

### Fixed
- **`selectProviderFailoverModel` rewritten** in `Orchestrator`: the previous implementation immediately escalated to `budget:'expensive'` + `speed:'considered'`, ignoring the user's stated budget preference. The new implementation walks budget and speed constraints incrementally (cheap ÔåÆ balanced ÔåÆ expensive, fast ÔåÆ balanced ÔåÆ considered), preferring a different provider at each step, so failover respects budget intent and only relaxes constraints as far as necessary.
- **`DEFAULT_AGENT_SYSTEM_PROMPT` strengthened**: the previous single vague line about release hygiene is replaced with four specific lines naming exact files that must be updated per change type (version bumps, configuration settings, source file changes, provider adapter changes).

## [0.53.2] - 2026-04-21

### Fixed
- **Documentation matrix in `CLAUDE.md` and `.github/copilot-instructions.md`**: added `docs/configuration.md` as a required update target for configuration setting changes; added `README.md (version banner)` as a required target for version bumps. Both files also updated the current-version reference to read from `package.json` rather than a hardcoded string.
- **Architecture and development docs updated**: `docs/architecture.md`, `docs/development.md`, and `wiki/Architecture.md` now reflect `CurrencyFormatter`, `CopilotMultiplierSync`, and `LocalModelSync` in the dependency graph and core services table.

## [0.53.1] - 2026-04-21

### Fixed
- **Copilot subscription tiers updated to current GitHub plans**: "Copilot Individual" renamed to **Copilot Pro** (matches current github.com/features/copilot naming), Free tier corrected from 90 ÔåÆ **50** premium requests/month, **Copilot Pro+** added (1500 requests, $39/user/month), **Copilot Student** added (300 requests, free for verified students). "per user" vs "per seat" wording aligned with GitHub's documentation for individual vs organisational plans.

## [0.53.0] - 2026-04-21

### Added
- **Local currency display**: All cost values (cost dashboard, chat cost summaries, budget alerts, project run center, model provider panel, personality profile, agent cost limits) are now formatted in the user's local currency rather than hardcoded USD.
  - **Auto-detection**: On first run Atlas detects your OS locale (e.g. `en-GB` ÔåÆ GBP, `de-DE` ÔåÆ EUR) and uses the matching currency symbol and number formatting automatically.
  - **Live exchange rates**: On each activation Atlas fetches fresh USD exchange rates from `open.er-api.com` (free, no API key required) and stores them in `globalState` with a 24-hour TTL. Values shown in non-USD currencies reflect the rate at last sync. The fetch is non-blocking and silently falls back to the stale cache if the network is unavailable.
  - **`atlasmind.displayCurrency` setting**: Override the auto-detected currency with any of 19 supported codes (USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR, BRL, MXN, KRW, SEK, NOK, DKK, NZD, SGD, HKD, ZAR). Set back to `"auto"` to restore OS-locale detection.
  - **`src/core/currencyFormatter.ts`**: New shared module providing `formatCost()`, `formatCostAdaptive()`, `getDisplayCurrency()`, `detectSystemCurrency()`, `getExchangeRate()`, and `syncExchangeRates()`. All previous per-file `$${value.toFixed(n)}` calls have been replaced with this formatter.

## [0.52.18] - 2026-04-21

### Fixed
- **Provider billing fallback**: When a provider is auto-disabled due to insufficient credits or a monthly spending cap (e.g. Google's `"exceeded its monthly spending cap"` 429), the orchestrator now tries a text-only fallback model on another provider instead of hard-stopping with a "no provider available" error. Google's spending-cap 429 is now correctly classified as a billing error, not a transient retry.
- **Tool-capability fallback**: When a model silently ignores tools (returns plain text instead of `tool_calls`) and no tool-capable model is available on any other provider, the orchestrator now falls back to the best available text-only model on a different provider for a best-effort response rather than returning the empty/incomplete response from the original model.
- **Claude CLI tool hand-off**: When a task requires tools and the only available model is the Claude CLI (which strips `function_calling`), the provider-error fallback path now relaxes the `function_calling` constraint and routes to the next best text-capable model, preventing a hard stop.
## [0.52.17] - 2026-04-20

### Added
- **Subscription plan configuration**: Subscription providers (GitHub Copilot, Claude CLI) now have a `$(credit-card)` icon in the sidebar Models tree. Clicking it opens a guided flow to select a plan tier (Free / Individual / Business / Enterprise for Copilot; Max 5├ù / Max 20├ù for Claude CLI) or enter custom monthly cost and request totals. The flow also prompts for current remaining requests and optional reset date, then persists the full `SubscriptionQuota` including `costPerRequestUnit` to `globalState`. This plugs the gap where the routing scorer and cost tracker both depend on `costPerRequestUnit` but had no way to populate it.
- **Subscription details card**: Subscription provider cards in the Model Providers panel now show a quota summary (remaining / total, cost per unit, reset date) under the provider notes, updated on every panel refresh.
- **"Configure plan" button on provider cards**: Subscription provider cards also show a "$ Configure plan" button that triggers the same guided flow from within the webview panel.

## [0.52.16] - 2026-04-20

### Added
- **Copilot multiplier auto-sync**: A new `src/providers/copilotMultiplierSync.ts` module fetches the [GitHub Copilot billing docs](https://docs.github.com/en/copilot/concepts/billing/copilot-requests) on each model refresh and parses the premium-request multiplier table. Results are cached in `globalState` with a 7-day TTL, so they survive restarts and are applied immediately on the next activation. Stale or failed fetches fall back to the cached data, then to the static catalog.
- **`atlasmind.premiumMultiplierOverrides` setting**: A JSON map of `{ "model-id-fragment": multiplier }` that lets you override any model's Copilot premium multiplier immediately without waiting for a docs sync or an extension release. Priority: this setting > remote sync > static catalog.
- **Multiplier sync status banner**: The Model Providers panel now shows a status banner indicating when multipliers were last synced and how many models were updated. Turns amber when the cached data is over 7 days old, with a direct link to the GitHub docs and instructions for manual overrides.

### Fixed
- **Catalog multiplier corrections**: Split `claude.*opus.*4` into version-specific patterns so Opus 4.7 (7.5├ù), Opus 4.6 fast mode (30├ù, preview), and Opus 4.5/4.6 (3├ù) are matched separately. Removed the stale `premiumRequestMultiplier: 3` from `o1` (not in current Copilot table). Set `gpt-4o` and `gpt-4.1` to `0` (included models on paid plans). Set generic `haiku` to `0.33` to match Haiku 4.5 pricing.

## [0.52.15] - 2026-04-20

### Added
- **Subscription quota tracking**: Subscription provider request quotas (e.g. GitHub Copilot premium requests) are now decremented after every completed request, taking premium multipliers into account (Opus 4.7 at 3├ù costs 3 units per call). Quotas persist across sessions via `globalState` and are restored on startup with automatic rollover when the `resetsAt` period has elapsed.
- **Overflow billing mode**: When a subscription quota reaches zero, subsequent requests are routed as pay-per-token (`subscription-overflow` billing category) and their cost is recorded in the standard `costUsd` field so budget reporting remains accurate.
- **Quota notifications**: A warning toast fires at 10 % remaining quota and an error toast fires when the quota is fully exhausted, naming the affected provider.

### Fixed
- Removed dead unreachable code block in `commands.ts` MCP runtime install flow (lines after an unconditional `return`) that was causing a TypeScript error.

## [0.52.14] - 2026-04-20

### Fixed
- **Model pruning on refresh**: `mergeProviderModels` now uses the live API's discovered set as the authority. Models that have been deprecated or retired and are no longer returned by the provider API are removed from the router on each refresh, rather than persisting indefinitely in the session.
- **Pricing staleness on refresh**: Existing registered models now have their pricing, context window, capabilities, and premium multiplier re-applied from the static catalog on every refresh pass. Previously, pricing was frozen from first discovery and would not update even after a catalog change was shipped in a new extension release.

## [0.52.13] - 2026-04-20

### Fixed
- **Planner**: Injected dependency governance platform knowledge into the planner system prompt. Dependabot, Renovate, Snyk, and Azure DevOps all create pull requests ÔÇö the planner now routes those fetch steps to `gh pr list` via `terminal-run` instead of an issues API, preventing 100-second wasted tool calls.
- **Task scheduler**: Failed subtasks now propagate as skipped to all downstream dependents instead of running them with empty context. A dependency that fails (including quota exhaustion) causes its entire downstream chain to be marked skipped immediately, saving quota and avoiding misleading partial results.
- **Orchestrator project mode**: Billing/quota exhaustion in a subtask now aborts the entire project run immediately. Previously, the scheduler continued executing subsequent batches after a provider was billing-paused with no fallback, burning more quota and producing meaningless output.

## [0.52.12] - 2026-04-20

### Changed
- Upgraded `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` from v7 to v8 (Dependabot PR #33 partial).
- Upgraded `eslint` from v8 to v9; migrated from `.eslintrc.cjs` to flat config (`eslint.config.mjs`) and removed the deprecated `--ext ts` CLI flag.
- Upgraded `@types/node` from v20 to v25.
- Merged Dependabot PR #35: `actions/checkout` v4ÔåÆv6, `actions/setup-node` v4ÔåÆv6, `actions/upload-artifact` v4ÔåÆv7.
- Fixed three lint errors surfaced by the stricter v8/v9 rules: updated `no-var-requires` ÔåÆ `no-require-imports` suppression comments, replaced empty-interface extension with a type alias.

## [0.52.11] - 2026-04-20

### Fixed
- Model router no longer selects premium subscription models (e.g. Opus at 3├ù multiplier) when budget is set to **Cheap**; premium models are now excluded from the candidate pool at this budget tier regardless of subscription pricing.
- Provider fallback routing now relaxes budget gates one step at a time (`cheap ÔåÆ balanced`, `balanced ÔåÆ expensive`) instead of jumping directly to `expensive/considered`, so a billing failure on one provider no longer forces the most expensive available model.

## [0.52.10] - 2026-04-20

### Changed
- Improved MCP server runtime install flow:
  - Retries runtime installation if it fails.
  - Prompts for manual install if automation fails.
  - Suggests a VS Code reload if the runtime is still not detected after install.

## [0.52.9] - 2026-04-20

### Fixed
- Restored the missing `# Changelog` title and release-notes preamble so the file keeps its expected structure.
- Added a regression check and authoring guardrails so future release updates preserve the heading instead of overwriting it.
- Kept the protected merge gate stable by validating integration-monitor coverage, preserving the default-agent fallback for routine workspace tasks, and aligning persistence and MCP verification behavior with the live release flow.

## [0.52.8] - 2026-04-20

### Fixed
- Atlas no longer stops after a tool failure and summarizes the error ÔÇö it now attempts alternative strategies (e.g. reading the file to get exact text before retrying a file-edit) and only reports a hard blocker when alternatives are genuinely exhausted.
- Plain text pasted into Atlas Chat now stays in the composer instead of being misinterpreted as a set of attachment chips.
- The host-side attachment importer now ignores non-existent workspace paths so arbitrary prose cannot be promoted into fake file attachments.
- Restored the default-agent fallback for routine no-agent sessions so action-oriented workspace requests no longer detour through premature specialist synthesis.
- Hardened chat-session persistence logging for both synchronous and asynchronous storage failures.
- Made the MCP workspace-placeholder transport test pass consistently across Windows, macOS, and Linux CI.

## [0.52.6] - 2026-04-20

## [0.52.6] - 2026-04-20

### Fixed
- Restored the missing integration-monitor manifest so protected CI can verify marketplace-extension coverage, provider contract coverage, and specialist integration review during release promotion.

## [0.52.5] - 2026-04-20

### Fixed
- Cleared release-blocking lint violations across commands, environment tracking, chat search, dashboard helpers, and testing summaries so protected CI now passes for the master promotion flow.

## [0.52.4] - 2026-04-20

### Fixed
- Tightened Atlas chat intent handling so prompts about missing version or changelog updates are treated as corrective workspace tasks instead of being misread as simple version lookups.
- Hard-coded release-hygiene guidance into the default agent instructions so version bumps, changelog updates, and related docs stay part of the expected completion path.

## [0.52.3] - 2026-04-20

### Fixed
- Repaired the session-search jump helpers so previous and next arrows now advance through results instead of stalling in the webview.
- Wired prompt cancellation through the active chat execution path so Stop can interrupt answer generation more reliably.

## [0.52.2] - 2026-04-20

### Fixed
- Active session-search results now snap into the center of the transcript and visibly select their containing chat bubble.
- Previous and next search arrows now move through results with a stronger in-thread visual jump.

## [0.52.1] - 2026-04-20

### Fixed
- Session search now runs directly against the visible chat thread again, preventing the composer from getting stuck on ÔÇ£Searching this sessionÔÇªÔÇØ with no follow-up.
- Multi-match search navigation stays responsive with visible previous and next arrows and the active result highlighted in-place.

## [0.52.0] - 2026-04-20

### Added
- Gap Analysis now produces a richer project report covering architecture, safety/security, functionality, UI/UX, memory, code structure, testing, delivery, and praise signals.
- The dashboard groups findings by priority, adds per-gap resolve buttons, and includes one-click actions for resolving all P1 or P2 items in a fresh Atlas chat session.

### Fixed
- Unfinished projects no longer come back with an empty-looking Gap Analysis report when the model response is loose or partially structured.
- Structured gap-analysis results are saved back into the Project Dashboard automatically after the live chat finishes.

## [0.51.9] - 2026-04-20

### Fixed
- Corrected session-search result counting to follow the visible rendered transcript instead of raw Markdown source.
- Added previous and next result arrows beside Search so multi-match threads can be navigated directly.

## [0.51.8] - 2026-04-20

### Fixed
- Replaced the stuck session-search path with an immediate local thread search so results now resolve instantly, even for tiny conversations.
- Restored highlight-and-scroll behavior without leaving the Search button hanging on a running state.

## [0.51.7] - 2026-04-20

### Fixed
- Restored visible session-search feedback in the chat panel so pressing Search now shows a live running status and a clear match or no-match result.
- Rewired the search toggle to the active webview controls so search mode activates reliably.

## [0.51.6] - 2026-04-20

### Changed
- Moved chat bubble deletion from the header X control into a cleaner footer trash icon beside the assistant vote actions, keeping message deletion available with a more minimal layout.

## [0.51.6] - 2026-04-20

### Fixed
- Gap Analysis now visibly starts from the Project Dashboard, immediately opens its page, and shows progress/status while the analysis runs.
- Resolved the silent no-op feeling when triggering Gap Analysis from the dashboard UI.

## [0.51.5] - 2026-04-20

### Fixed
- Restored the Project Dashboard after a Gap Analysis regression injected invalid dashboard panel and webview code, preventing the dashboard from opening.
- Wired the Gap Analysis message flow and snapshot parsing back into the dashboard safely.

## [0.51.4] - 2026-04-20

### Changed
- **Unified chat/search input:** The chat panel now uses a single input field for both chat and session search. Toggling the Search icon swaps the Send/Mode controls for a Search button, and Enter submits a search in search mode. This improves accessibility and reduces UI clutter.

### Fixed
- Focus and ARIA state are preserved when toggling between chat and search modes.

# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).


## [0.51.3] - 2026-04-20

### Fixed
- **`NodeMemoryManager` parity with `MemoryManager`**: The CLI variant of the memory manager now fully matches the VS Code variant ÔÇö `embedText` now uses XOR-fold hash distribution to eliminate index bias, `inferMemoryQueryMode` now includes a `planning` branch, and `getDocumentClassBoost`/`getEvidenceBoost`/`getFreshnessBoost` all handle the `planning` query mode.
- **`sessionConversation.ts` corruption**: Repaired a dangling `deleteMessage` method fragment that had been prepended to the file before the `import` statement, causing a TypeScript parse error. The method is now correctly placed inside the `SessionConversation` class.
- **`chatPanel.ts` `deleteMessage` message type**: Added `deleteMessage` to the `ChatPanelMessage` union type and the `isChatPanelMessage` type guard so the webview handler compiles.
- **Transient context redaction in orchestrator**: Blocked session, chat, and attachment context (detected by `scanTransientContext`) now correctly results in a security notice in the system prompt rather than passing through a redacted string that bypassed the second scan pass.

### Tests
- Fixed `treeViews.test.ts` mock objects: added `getStats` to all `memoryManager` mocks so `MemoryStatsTreeItem` can be constructed without throwing.
- Fixed `orchestrator.tools.test.ts`: corrected assertion index for the source-backed-memory live-evidence test (`recordedRequests[0]` ÔåÆ find by content) to account for the agent selection pre-call.

---
## [0.51.2] - 2026-04-20

### Added
- **Chat bubble classification and context weighting:** Each chat message is now automatically classified (intent, answer, system, error, irrelevant) and assigned a relevance weight. The orchestrator context selection logic now prioritizes relevant bubbles, reducing context pollution from system/billing errors and keeping the thread focused.

### Changed
- Context-building logic in sessionConversation.ts now uses classification and weighting to select the most relevant transcript entries for orchestrator context.

---
## [0.51.1] - 2026-04-20

### Added
- **Chat panel session search toggle:** Added a "Search" icon to the chat panel composer toolbar. Toggling this icon switches the composer between chat and session search modes. The search input and results area now appear when toggled, and the chat input is hidden in search mode. This lays the foundation for advanced session search with glob-style matching.

### Changed
- Refactored chat panel UI state logic to support toggling between chat and search modes.

---
## [0.51.0] - 2026-04-20

### Added
- **`/memory write` chat command**: Operators can now save a memory entry directly from the chat participant with `/memory write <path> | <title> | <content>`, bypassing the need to ask Atlas to remember something on their behalf.
- **`/memory stats` chat command**: `/memory stats` shows total entries, warnings, blocked count, stale imports, and a breakdown by document class.
- **Memory index stats tree item**: The Memory tree view now shows an inline stats row (entry count, warnings, blocked) whenever entries are indexed, giving at-a-glance health visibility without opening a separate panel.
- **`MemoryManager.queryWithOptions()`**: New method allowing callers to override the retrieval mode (`planning`, `live-verify`, `summary-safe`, `hybrid`), filter by required tags, and exclude document classes ÔÇö replacing the need to rely on auto-inference for all use cases.
- **`MemoryManager.getStats()`**: New method returning aggregate statistics (`MemoryStat`) about the current index: entry count, per-class breakdown, warning/blocked counts, total snippet chars, and potentially-stale import count.
- **Memory-aware project planning**: The `Planner` now accepts an optional `MemoryStore` reference. When provided, it queries roadmap, decisions, and architecture memory entries and injects them into the planning prompt so subtask decomposition is informed by existing project context. All three `Planner` construction sites (orchestrator, chat participant, project run centre panel) now pass `memoryManager`.
- **Transient context injection scanning**: Session history, native chat context, and attachment context are now scanned for prompt-injection patterns (using `scanTransientContext` from `memoryScanner`) before being included in any model prompt. Blocked contexts are replaced with a redaction notice rather than silently passed through.
- **`scanTransientContext` export**: New function in `memoryScanner.ts` that applies only prompt-injection rules (not credential rules) to freeform chat/attachment text ÔÇö credentials in discussion are not the same as credentials in storage.
- **New types**: `MemoryQueryOptions`, `MemoryStat`, and `OperatorFeedback` added to `types.ts` to formalise the query, stats, and feedback-learning contracts.
- **`inferMemoryQueryMode` export**: The query-mode classifier is now exported so tests and external callers can use and verify it directly.

### Fixed
- **`persistEntry` parent directory creation**: Writing a memory entry to a new SSOT sub-path no longer fails silently ÔÇö the parent directory is now created before the write, and errors propagate to the caller rather than being swallowed.
- **`buildRetrievalContext` query enrichment**: Memory retrieval now incorporates the first 400 chars of `sessionContext` alongside `userMessage`, making the query more representative of the full conversational context rather than just the single latest message.
- **Hash embedding distribution**: `embedText` now XOR-folds the high and low 16-bit halves of the FNV hash before the modulo operation, spreading token hash values more evenly across embedding dimensions and reducing clustering at boundary slots.

### Tests
- 9 new unit tests for `inferMemoryQueryMode` covering all four modes (`planning`, `live-verify`, `summary-safe`, `hybrid`).
- 5 new unit tests for `queryWithOptions` (tag filter, class exclusion, mode override) and `getStats`.
- 4 new persistence tests in `memoryPersistence.test.ts` verifying that `persistEntry` creates parent directories, writes correct content, and no-ops safely when `rootUri` is unset.

## [0.50.2] - 2026-04-20

### Fixed
- **Seamless re-routing when a model lacks tool support**: The orchestrator now detects when a model silently returns a plain text response instead of calling tools (i.e. it lacks runtime `function_calling` support at the first iteration). Rather than stalling and awaiting user input, it immediately records the model as incapable for this task and re-routes to a `function_calling`-capable model ÔÇö the task continues without any interruption. This addresses `claude-cli` and any other model whose catalog entry does not include `function_calling`.
- **Provider connectivity failures now trigger failover**: Network-level errors (`ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `ETIMEDOUT`, `ENETUNREACH`, `fetch failed`) were not recognised as transient by `isTransientProviderError`, so they were thrown immediately without retry. These are now treated as transient ÔÇö they retry with backoff before promoting to a provider failover, making short outages invisible to the user.

## [0.50.1] - 2026-04-19

### Fixed
- **`file-move` and `file-delete` tool approval misclassification**: Both tools were falling into the `default` branch of `classifyToolInvocation`, which classified them as `category: 'network'` instead of `'workspace-write'`. This caused two symptoms: the approval UI showed an incorrect category label, and any prior "bypass workspace-write" approval granted by the user would not match ÔÇö causing the approval prompt to re-fire on every file-move/delete in the same task. Both tools are now explicitly listed as `workspace-write` alongside `file-write` and `file-edit`.

## [0.50.0] - 2026-04-19

### Added
- **Import session context**: Each session bubble in the Sessions panel now has a "share" icon button (alongside Archive and Delete). Clicking it calls the orchestrator with a focused summarization prompt against the source session's full transcript, writes the condensed markdown summary to `.atlasmind/session-context-<title>-<id>.md` (excluded from git via `.gitignore`), and attaches the file to the current session's composer ÔÇö ready to be sent with the next prompt. The active session cannot import from itself. The summary includes Goal, Key Decisions, Findings, and Open Items sections.

## [0.49.43] - 2026-04-19

### Added
- **Agent synthesis transparency**: When the orchestrator auto-synthesizes a specialist agent, the chat now clearly explains what happened. The status bar shows live progress messages ("No registered agent closely matched this task ÔÇö creating a specialist agent on the fly" and "Synthesized specialist agent X (role) ÔÇö registered for this session"). The thought summary (expandable details block on the response) is relabelled "Thinking summary ÔÇö new agent created" and its body describes the synthesized agent by name. Four additional bullets appear: the auto-synthesis trigger explanation, the agent's role, its purpose/description, and a note that the agent persists for the session and can be managed from the Agents panel. This uses a new `synthesizedAgent` field on `TaskResult` threaded from `processTask` through `buildAssistantResponseMetadata`.

## [0.49.42] - 2026-04-19

### Added
- **Agent auto-synthesis**: When a task arrives with specialisation signals (routing needs detected) and no registered agent scores any token overlap against it, the orchestrator now synthesises a specialist agent on the fly before executing the task. The LLM generates a focused `AgentDefinition` JSON (role, description, system prompt), which is then validated by `validateSynthesizedAgent()` ÔÇö checking for required fields, length limits, prompt-injection patterns, and authority-escalation phrases. Agents that pass validation are wrapped with `IMMUTABLE_GUARDRAILS` and `DEFAULT_AGENT_SYSTEM_PROMPT`, registered in the `AgentRegistry` for session-scoped reuse, and immediately used to handle the task. Synthesis failures are cached to prevent retry storms and the orchestrator falls back to the best available agent gracefully. New file: `src/core/agentDrafting.ts`.

## [0.49.41] - 2026-04-19

### Added
- **Autopilot toggle in chat composer**: A new star icon button in the chat input toolbar lets you toggle Autopilot on and off at any time without leaving the chat panel. When active, the button glows amber and the tooltip updates to confirm the state. Autopilot grants all tool approvals automatically ÔÇö enable it before going AFK so the agent isn't blocked waiting for confirmation, and disable it on return. The button state syncs in real time with the status bar indicator via the shared `ToolApprovalManager`.

## [0.49.40] - 2026-04-19

### Changed
- Bump version to 0.49.40 to update Marketplace README and metadata.

## [0.49.39] - 2026-04-18

### Changed
- **Live settings**: All orchestrator limits (`maxToolIterations`, `maxToolCallsPerTurn`, `toolExecutionTimeoutMs`, `providerTimeoutMs`) now propagate immediately to the running orchestrator when changed in settings ÔÇö no reload required. Previously, values were frozen at extension startup.
- **Smart limit-hit prompt**: When the agentic loop hits the tool-iteration or tool-calls-per-turn cap, the chat response now shows contextual raise buttons: "Raise to N (permanent)" saves the new value to workspace settings and continues; "Raise to N (this task)" applies it in-memory for the current task only; "Continue as-is" and "Cancel" remain for the original behaviour. The suggested N is computed as `ceil(current ├ù 1.5 / 5) ├ù 5`, capped at the configured setting maximum.

## [0.49.38] - 2026-04-18

### Changed
- Dashboard Runtime: TDD Compliance panel now shows contextual action buttons when gaps are detected. "Ask Atlas to fix TDD gaps" opens Atlas Chat with a pre-drafted prompt describing missing evidence and blocked subtasks. "Plan a TDD fix run" opens Project Run Center with a pre-filled goal ready to preview. The existing "Open Project Run Center" button is always shown.

## [0.49.37] - 2026-04-18

### Fixed
- Chat panel: Guarded automatic composer focus restoration so live transcript and busy-state refreshes no longer steal the editor cursor after the user clicks back into another VS Code surface.

## [0.49.36] - 2026-04-18

### Changed
- Added a dedicated Testing policy highlight card to the Project Dashboard so the active tests-first policy is visible at a glance beside the framework and coverage stats.
- Added an optional workspace override label so teams can display their own wording for the testing policy while still keeping AtlasMind's underlying verification guardrails in place.

## [0.49.36] - 2026-04-18

### Changed
- Moved warning-level generated-skill review into the AtlasMind in-chat approval stack so operators can approve or keep a draft blocked without leaving the conversation flow.
- Tailored the approval card for generated skills to show the warning summary and a one-time Allow Once versus Keep Blocked choice.

## [0.49.35] - 2026-04-18

### Changed
- Auto-synthesized skills that raise warning-level scan findings now pause behind an explicit user approval prompt before AtlasMind evaluates them in-process.
- Added a review-first flow for generated skill drafts so operators can inspect the warning summary and proposed source, then either allow once or keep the draft blocked for refinement.

## [0.49.34] - 2026-04-18

### Changed
- Moved project-level testing visibility into the Project Dashboard so the testing surface now behaves like a workspace health view instead of a generic settings page.
- Added an interactive test explorer with category grouping, searchable long-list and dropdown navigation, and a selected-test detail pane that summarizes source-level description, likely input steps, assertions, and opens the relevant file at the matching line.

## [0.49.33] - 2026-04-18

### Added
- MCP intent heuristics: AtlasMind now derives natural-language routing cues for third-party MCP tools, biases tool selection toward the most likely match for prompts like ÔÇ£commitÔÇØ, and asks for clarification when multiple tools look similarly plausible.
- SSOT recall: Successful natural-language-to-MCP resolutions are now written into project memory so future turns can reuse that learned mapping.

## [0.49.32] - 2026-04-18

### Fixed
- Made F2 rename use the currently focused Sessions sidebar item so keyboard rename now works reliably for chat threads and session folders.

## [0.49.31] - 2026-04-18

### Fixed
- Replaced the external Marketplace version badge in the README with a plain Marketplace-safe version callout so AtlasMind no longer shows a broken or retired badge placeholder on extension detail pages.

## [0.39.7] - 2026-04-18

### Changed
- Added an immutable legal and human-respect guardrail baseline to AtlasMind's built-in and routed agent prompts so lower-priority instructions cannot override it.
- Restricted legally ambiguous or jurisdiction-specific requests to safe high-level guidance and explicitly blocked help intended to harm, discredit, disparage, or lie about any person.
- Strengthened skill-drafting and auto-synthesis prompts so generated tools are steered away from illegal, abusive, defamatory, or deceptive person-targeted behavior.

## [0.39.6] - 2026-04-06

### Changed
- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models so operational views surface first below Chat.
- Set the shipped default tree-view visibility to collapsed, while keeping stable view ids in place so VS Code continues to remember each user's custom sidebar order and expanded or collapsed state across later work.

## [0.39.6] - 2026-04-06

### Changed
- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views so the main control surfaces stay one click away.
- Made the project-memory toolbar action switch between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has already detected workspace SSOT state.

## [0.39.4] - 2026-04-06

### Changed
- Hid the remaining unprefixed session actions from the Command Palette and added a manifest guard that requires unprefixed command titles to stay palette-hidden.
- Split the README command reference into dedicated Command Palette and Sidebar Actions sections so the surface distinction is explicit.

## [0.39.3] - 2026-04-06

### Changed
- Hid sidebar-only commands from the VS Code Command Palette so palette-facing AtlasMind commands remain branded entry points while row and toolbar actions stay local to their owning views.
- Updated command documentation to distinguish palette-facing AtlasMind commands from view-local sidebar actions.

## [0.39.2] - 2026-04-06

### Added
- Added a pinned stale-memory warning row at the top of the Memory tree so imported SSOT drift remains visible inside the sidebar until AtlasMind refreshes project memory.

### Fixed
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory, so older Atlas projects now surface the same refresh signal and update affordances as newer imports.

## [0.39.2] - 2026-04-06

### Added
- Added custom skill folders to the Skills sidebar, including a title-bar `Create Skill Folder` action plus folder-aware add/import flows so custom skills can be filed into persistent nested groups.
- Added an `F2` rename shortcut for highlighted chat-session rows in the Sessions sidebar, wired to the existing `Rename Session` command.

### Changed
- Reorganized bundled AtlasMind skills under built-in category groups in the Skills sidebar so the built-in list no longer expands into one flat 31-item block.
- Persisted imported custom skills and their folder placement across extension reloads instead of keeping them only in the current activation session.

## [0.39.0] - 2026-04-06

### Added
- Added persistent session folders to the AtlasMind Sessions sidebar, including a title-bar `Create Session Folder` action and a `Move Session To Folder` row action so related chat threads can be filed together.
- Added an inline `Rename Session` action on each Sessions sidebar row.

### Changed
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view so project-memory actions stay grouped together.

## [0.38.22] - 2026-04-06

### Changed
- Redesigned the Cost Dashboard to align with the Project Dashboard visual language using a cleaner shell, single-row animated summary cards, a polished budget meter, and richer model and feedback panels.
- Replaced the old checkbox and numeric timescale field with a topbar spend-visibility toggle and chart-overlay time-range controls built directly into the Daily Spend panel.

### Fixed
- Tightened Cost Dashboard metric layout so the primary summary boxes stay on one row instead of wrapping into a cluttered multi-line grid.

## [0.38.21] - 2026-04-06

### Fixed
- Made the Atlas chat Sessions rail responsive so it stays at the top in narrow views and moves into a persistent left sidebar when the chat webview is at least 1000px wide.

## [0.38.20] - 2026-04-06

### Fixed
- Fixed the Project Dashboard security snapshot so `autoVerifyScripts` now accepts the array format persisted by AtlasMind Settings instead of assuming a plain string and failing refresh with `trim is not a function`.
- Added dashboard regression coverage for array-backed verification script settings to keep the loading path stable.

## [0.38.19] - 2026-04-06

### Changed
- Refined assistant-response feedback controls so the thinking summary and vote buttons share a single inline footer row, with compact outlined thumb icons aligned to the right side of the bubble.

## [0.38.18] - 2026-04-06

### Added
- Added response-feedback analytics to the Cost Dashboard, including per-model approval rates, thumbs-up/thumbs-down totals, and filtered spend on rated models.
- Added a `atlasmind.feedbackRoutingWeight` setting so operators can disable thumbs-based routing bias entirely or tune how strongly stored feedback nudges future model selection.

### Changed
- Cost Dashboard recent-request rows now show the recorded vote on the linked assistant response when one exists, making spend and user sentiment visible in the same table.

## [0.38.17] - 2026-04-06

### Fixed
- Tightened the Atlas chat Sessions rail header so the new-session `+` action sits inline with the Sessions label instead of stretching the collapsible bar beyond the chat container.

## [0.38.16] - 2026-04-06

### Added
- Added chat-session deep links from Cost Dashboard recent-request rows so rows open the matching transcript message when that session entry still exists.

### Changed
- Cost records now retain optional chat session and message references so AtlasMind can trace recent spend back to the exact assistant response that incurred it.

## [0.38.15] - 2026-04-06

### Added
- Added thumbs up and thumbs down controls to each assistant response in the shared AtlasMind chat workspace so feedback is stored with the response metadata and exported with saved transcripts.

### Changed
- Weighted model routing with a small bounded per-model preference bias derived from recorded chat feedback so repeated user votes can slightly steer future model selection without overriding budget, speed, capability, or provider-health rules.

## [0.38.14] - 2026-04-06

### Added
- Added startup SSOT freshness inspection for imported workspaces so AtlasMind can detect when generated project memory no longer matches the current codebase, raise a warning notification, and expose an `Update Project Memory` action in the Memory view.

### Fixed
- Normalized import body fingerprints so unchanged generated SSOT files are no longer misclassified as locally edited or permanently stale on later refreshes.

## [0.38.13] - 2026-04-06

### Fixed
- Sent the Cost Dashboard's Budget Settings shortcut directly to Settings ÔåÆ Overview with a budget-focused search instead of reopening whatever settings section was last active.
- Clarified the Cost Dashboard recent-requests table so the final column is explicitly the per-message request cost.

## [0.38.11] - 2026-04-06

### Fixed
- Fixed the Project Dashboard refresh path so git timeline collection uses a valid date filter and dashboard snapshot failures render an explicit error state instead of hanging on Loading dashboard signals.
- Added a direct Project Dashboard title-bar action to the AtlasMind sidebar chat view for faster access to the dashboard surface.
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left `ScannedImportFile` metadata and text-file filtering helpers incomplete.

## [0.38.10] - 2026-04-06

### Changed
- Extended cost tracking so AtlasMind records provider billing category per request and only counts direct or overflow-billed usage against `dailyCostLimitUsd`; subscription-included usage remains visible in the dashboard without consuming the daily budget.
- Upgraded the Cost Dashboard with arbitrary day-range filtering, a toggle to exclude included subscription usage from totals and charts, and clearer request-level billing labels for direct, subscription, overflow, and free usage.

## [0.38.9] - 2026-04-06

### Fixed
- Hardened the Project Dashboard refresh path so host-side data collection failures surface an explicit error state instead of leaving the panel stuck on its loading placeholder.
- Added a one-click Project Dashboard action to the AtlasMind sidebar title bar so the dashboard can be opened directly from the AtlasMind panel.

## [0.38.8] - 2026-04-06

### Fixed
- Added real per-setting hover help inside the custom AtlasMind Settings webview so richer configuration guidance appears when hovering the panel controls rather than only in native Settings metadata.

## [0.38.7] - 2026-04-06

### Added
- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests so extension-host and CLI integrations can register agents, skills, and provider adapters without patching core bootstrap code.
- Added a new AtlasMind Project Dashboard surface with interactive pages for repo health, Atlas runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals.
- Added animated dashboard charts for commit activity, project-run activity, and SSOT update cadence with adjustable 7-day, 30-day, and 90-day windows.

### Changed
- Logged shared-runtime lifecycle events to the AtlasMind extension output channel, wired the dashboard into the extension command surface, and expanded contributor documentation with runtime-plugin onboarding guidance.
- Hardened AtlasMind CLI argument parsing so malformed flags, missing option values, and invalid provider or routing modes fail fast with explicit help output.
- Expanded the architecture, routing, development, contribution, and wiki guidance to document AtlasMind's extension seams, failure telemetry surfaces, troubleshooting workflow, and current performance or monitoring boundaries.

## [0.38.6] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work remains mergeable on top of the latest `develop` head.

## [0.38.5] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates so it remains mergeable on top of the newer base branch feature work.

## [0.38.4] - 2026-04-06

### Fixed
- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work.

## [0.38.3] - 2026-04-06

### Fixed
- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving the branch's broader terminal-reader, extension, Ports, dashboard, and ElevenLabs feature set.

## [0.38.2] - 2026-04-06

### Fixed
- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync.

## [0.38.1] - 2026-04-06

### Fixed
- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs.

## [0.38.0] - 2026-04-06

### Added
- **Terminal session readers** ÔÇö `getTerminalOutput(terminalName?)` added to `SkillExecutionContext`; new `terminal-read` built-in skill lists open terminals and the active terminal, with a clear note that buffer content must be pasted by the user (VS Code API limitation).
- **Test result file parsing** ÔÇö `workspace-state` skill now scans for JUnit XML and Vitest/Jest JSON result files and includes a summary (pass/fail counts, coverage percentages) in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) ÔÇö lists all installed extensions with id, version, and enabled state; optionally filters by name fragment or restricts to the curated top-50 list; also reports forwarded ports from the VS Code Remote/Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard` command) ÔÇö full-page webview panel showing total/today spend cards, daily bar chart (last 14 days), per-model cost breakdown, and a paginated recent-requests table with a budget utilisation bar when a daily limit is configured.
- **ElevenLabs TTS integration** ÔÇö `VoiceManager` now accepts `SecretStorage`; when an ElevenLabs API key is configured in Specialist Integrations, `speak()` synthesises audio server-side via the ElevenLabs API and streams base64-encoded MP3 to the Voice Panel for playback via the Web Audio API; falls back to the Web Speech API when no key is set.
- `getInstalledExtensions()` and `getPortForwards()` added to `SkillExecutionContext` for the VS Code extensions skill.
- `atlasmind.openCostDashboard` command added to the extension manifest.

### Changed
- `workspace-state` skill description updated to mention test result parsing.
- `VoiceManager` constructor accepts an optional `SecretStorage` argument (backwards-compatible).
- Voice Panel TTS section shows "ElevenLabs active" / "Web Speech API" badge based on key availability.

## [0.37.4] - 2026-04-06

### Added
- Added the `workspace-observability` built-in skill so agents can inspect the active debug session, open terminals, and recent test results from within the VS Code host.
- Extended `SkillExecutionContext` with `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()`, implemented in the VS Code host with safe CLI fallbacks.

### Fixed
- Guarded optional observability host hooks and bounded test-result output so the new workspace observability surface degrades safely across environments while staying mergeable on top of the `v0.37.x` feature line.

## [0.37.3] - 2026-04-06

### Fixed
- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes.

## [0.37.2] - 2026-04-06

### Fixed
- `exa-search` skill now routes HTTP requests through `SkillExecutionContext.httpRequest()` instead of raw `fetch`, applying the same timeout and size limits as all other HTTP-capable skills.
- CLI `build`, `lint`, and `test` subcommands now handle spawn `error` events so the Promise resolves with exit code `1` and a helpful message instead of hanging when `npm` is not on PATH.
- `CHANGELOG.md` date corrected for `0.37.0` (was `2026-04-05`, now `2026-04-06`).
- `docs/agents-and-skills.md` and `wiki/Skills.md` updated to document the `exa-search`, `debug-session`, and `workspace-observability` skills introduced on this branch.
- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs.

### Added
- New `SkillExecutionContext.httpRequest()` method supports bounded POST requests with custom method, headers, and body; implemented in the VS Code extension host and CLI with the same timeout/size-limit defaults as `fetchUrl`.

## [0.37.0] - 2026-04-06

### Added
- EXA AI search specialist runtime: `exa-search` skill calls the EXA search API end-to-end using the API key stored in the Specialist Integrations panel.
- Debug session inspector skill (`debug-session`): inspect active VS Code debug sessions and evaluate expressions in the current debug context.
- Workspace state skill (`workspace-state`): snapshot workspace problems, debug sessions, and output channels in a single call for proactive observability.
- CLI `build` subcommand (`atlasmind build [--dry-run]`): run the workspace build script with optional dry-run preview.
- CLI `lint` subcommand (`atlasmind lint [--fix]`): run the workspace lint script with optional auto-fix.
- CLI `test` subcommand (`atlasmind test [--watch]`): run the workspace test suite with optional watch mode.
- `getSpecialistApiKey(providerId)` added to `SkillExecutionContext`; CLI reads from `ATLASMIND_SPECIALIST_<ID>_APIKEY` environment variable.
- `getOutputChannelNames()`, `getAtlasMindOutputLog()`, `getDebugSessions()`, and `evaluateDebugExpression()` added to `SkillExecutionContext` for VS Code observability.

### Changed
- Amazon Bedrock model catalog expanded with 16 additional entries: Claude 3.5 Haiku, Claude 3 Haiku, Claude 3 Opus, Amazon Nova Micro, Amazon Titan Text Express and Lite, Cohere Command R and R+, Mistral 7B and 8x7B, Llama 3.2 1B/3B/11B/90B, and AI21 Jamba 1.5 Mini/Large.

## [0.36.26] - 2026-04-06

### Fixed
- Replaced three non-reassigned `let` declarations with `const` in the orchestrator task-attempt path so the develop branch satisfies the repository lint gate again.

## [0.36.25] - 2026-04-06

### Fixed
- Removed the duplicate `AtlasMind: Tool Webhooks` command entry from the wiki command reference so it no longer diverges from the actual manifest.
- Normalized `src/providers/registry.ts` indentation to the repository's 2-space TypeScript style to eliminate avoidable formatting churn in the provider runtime.

## [0.36.24] - 2026-04-06

### Fixed
- Repaired the Project Run Center webview HTML assembly so preview tables, run cards, artifact cards, and live logs no longer emit invalid JavaScript string fragments at runtime.
- Tightened the shared webview CSP back to nonce-only script execution and replaced broken wiki CLI links with repository-relative paths.
- Normalized the duplicated `0.36.4` changelog entries so release history remains unambiguous for readers and tooling.

## [0.36.23] - 2026-04-06

### Fixed
- AtlasMind now treats provider replies that end with `finishReason: length` as truncated output and requests a bounded continuation instead of accepting the cut-off answer as final.
- Atlas-generated chat and synthesis requests now send an explicit larger output-token budget, reducing premature truncation for longer architectural or analysis-style replies.
- Added regression coverage for truncated direct replies and streamed continuation handling.

## [0.36.22] - 2026-04-06

### Fixed
- Atlas chat surfaces now reconcile streamed chunks with the final orchestrator response instead of treating the first streamed chunk as proof that the full reply already rendered, which fixes replies that appeared to stop after an intermediate "I am investigating"-style preamble.
- Hardened session transcript persistence so invalid chat-session targets and failed memento writes emit diagnostics instead of failing silently.
- Added regression coverage for partial-stream reconciliation, streamed tool-loop completions, and session persistence hardening.

## [0.36.23] - 2026-04-06

### Fixed
- Completed the CLI `SkillExecutionContext` implementation for workspace observability by adding safe fallback implementations for test results, active debug session lookup, and terminal listing outside the VS Code host.
- Made the VS Code-hosted workspace observability skill tolerant of test-results API shape differences so the feature compiles cleanly across the current extension toolchain.

## [0.36.22] - 2026-04-06

### Added
- New `workspace-observability` built-in skill: provides a snapshot of the current VS Code workspace state including the active debug session, open integrated terminals, and the most recent test run summary. Useful for orienting agents before diagnosing problems or suggesting next steps.
- Three new methods on `SkillExecutionContext`: `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()`, backed by `vscode.tests.testResults`, `vscode.debug.activeDebugSession`, and `vscode.window.terminals` respectively.

## [0.36.21] - 2026-04-06

### Changed
- Expanded the developer-experience roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction.

## [0.36.20] - 2026-04-06

### Fixed
- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate GitHub Actions artifact-name conflicts while keeping compile, lint, and tests running on Ubuntu, Windows, and macOS.
- Updated repository development documentation to match the CI matrix behavior and Ubuntu-only coverage artifact publishing path.

## [0.36.19] - 2026-04-05

### Fixed
- Cleaned up cross-platform lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion PR.

## [0.36.18] - 2026-04-05

### Changed
- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment.

## [0.36.17] - 2026-04-05

### Changed
- AtlasMind now includes workstation context in routed chat prompts so responses default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate.
- Added regression coverage to keep workstation-aware prompt context flowing through native chat and orchestrator request building.

## [0.36.16] - 2026-04-05

### Fixed
- AtlasMind now fails over to another provider automatically when the selected provider errors or is missing, instead of ending the task immediately on the first provider failure.
- Added orchestrator regression coverage for cross-provider failover after a provider-side error.

## [0.36.15] - 2026-04-05

### Fixed
- OpenAI modern chat requests now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing 400 errors on streamed and non-streamed requests.
- Added provider regression coverage to keep modern OpenAI payloads compatible while preserving temperature for models and providers that still support it.

## [0.36.14] - 2026-04-05

### Changed
- AtlasMind now watches for early struggle signals during tool-heavy execution, such as repeated tool failures or excessive tool-loop churn, and can reroute once to a stronger reasoning-capable model instead of exhausting the full loop on a weaker one.
- Added regression coverage for bounded mid-task model escalation when the first model shows repeated failure signals.

## [0.36.13] - 2026-04-05

### Fixed
- AtlasMind now answers workspace version questions directly from the root `package.json` manifest instead of relying on model inference.
- When the manifest is unavailable, AtlasMind falls back to SSOT memory to answer version questions from grounded project context.

## [0.36.12] - 2026-04-05

### Fixed
- Split OpenAI compatibility handling by provider so modern OpenAI and Azure chat requests use `developer` messages plus `max_completion_tokens`, while generic OpenAI-compatible providers keep the legacy `system` plus `max_tokens` payload shape.
- Added regression coverage to ensure OpenAI/Azure and third-party OpenAI-compatible endpoints each receive the expected request contract.

## [0.36.11] - 2026-04-05

### Fixed
- Switched OpenAI-compatible chat payloads from `max_tokens` to `max_completion_tokens`, fixing request failures on models that reject the legacy parameter.
- Added a provider regression test that asserts AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests.

## [0.36.10] - 2026-04-05

### Fixed
- Corrected the `terminal-run` tool schema so `args` is declared as an array of strings, fixing chat requests that failed OpenAI function validation.
- Added a regression test covering the exported `terminal-run` argument schema.

## [0.36.9] - 2026-04-05

### Changed
- Chat panel sessions section is now a collapsible drawer ÔÇö collapsed by default, showing a "Sessions" toggle bar with a numeric badge; expands to 50% viewport height.
- Composer input box is anchored to the bottom of the panel and no longer gets pushed off-screen by session cards.
- Reduced padding, font sizes, and icon sizes across session cards, composer controls, and toolbar buttons for a more compact layout.

## [0.36.8] - 2026-05-04

### Fixed
- Chat panel webview script moved from inline template literal to external `media/chatPanel.js` file, eliminating HTML parser and TypeScript compilation escaping issues that prevented the chat UI from functioning.
- Updated `webviewUtils.ts` to support loading external script files via `<script src>` with proper CSP and nonce attributes.
- Fixed pre-existing test assertions for `composerForm` (never existed in DOM) and `webviewReady` (never existed in message type union).

## [0.36.7] - 2026-05-04

### Fixed
- Chat webview panels (sidebar and dedicated tab) now render and execute correctly; escaped `</` sequences inside innerHTML assignments in inline `<script>` blocks that caused the HTML parser to prematurely close the script element.
- Project Run Center webview innerHTML assignments received the same `</` escaping fix.

## [0.36.6] - 2026-04-05

### Fixed
- AtlasMind CLI now runs behind a runtime approval gate that permits read-only tools by default, blocks external high-risk tools, and requires an explicit `--allow-writes` opt-in before workspace or git writes are allowed.
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient.

### Added
- Added regression tests for CLI write gating, denied external tool use, and the tightened SSOT startup detection boundary.

## [0.36.5] - 2026-04-05

### Changed
- `/import` now embeds freshness metadata into generated SSOT artifacts, skips unchanged entries on later imports, and preserves generated files that were manually edited instead of blindly overwriting them.
- AtlasMind now writes both `index/import-catalog.md` and `index/import-freshness.md` so operators can see which imported memory files were created, refreshed, left unchanged, or preserved.
- The Project Settings page now includes a destructive memory-purge action guarded by a modal confirmation and a required typed confirmation phrase before AtlasMind deletes and recreates the SSOT scaffold.

## [0.36.3] - 2026-04-05

### Changed
- The MCP Servers, Voice, and Vision panels now use the same searchable, page-based workspace pattern as AtlasMind Settings and the other admin surfaces, with overview actions and focused working pages instead of single long layouts.
- Sidebar empty states now include more contextual links into the matching AtlasMind panel or settings page, and the MCP sidebar settings action now jumps directly to Safety Settings.

## [0.36.4] - 2026-04-05

### Changed
- `/import` now performs a broader first-pass ingest over existing workspaces, generating a richer SSOT baseline from core docs, workflow and security guidance, and a focused codebase map instead of only importing a few metadata files.
- AtlasMind now upgrades the starter `project_soul.md` template during import when it is still blank, giving imported projects an initial identity, principles, and references into the generated SSOT.

## [0.36.2] - 2026-04-05

### Changed
- The Agent Manager and Tool Webhooks panels now use the same searchable, page-based workspace style as Settings and the provider surfaces, with grouped sections instead of long flat forms.
- AtlasMind now exposes page-specific settings commands for chat, models, safety, and project runs, and matching tree views plus walkthrough steps now open those targeted pages directly.

## [0.36.1] - 2026-04-05

### Changed
- The Model Providers and Specialist Integrations panels now use the same searchable, page-based workspace style as AtlasMind Settings, replacing dense tables with grouped cards and faster workflow navigation.
- AtlasMind Settings now supports in-panel search plus command-driven deep links, so commands and panels can reopen Settings directly onto a target page such as Models.

## [0.36.0] - 2026-04-05

### Added
- Added a shared Atlas runtime builder plus a compiled `atlasmind` CLI entrypoint with `chat`, `project`, `memory`, and `providers` commands that reuse the existing orchestrator, skills, router, and SSOT loading.
- Added Node-hosted runtime adapters for memory, cost tracking, and built-in skill execution, along with focused tests covering runtime bootstrapping and CLI argument/SSOT resolution.

### Changed
- Split the provider registry and local adapter into a host-neutral module so reusable providers can run from both the VS Code extension host and the CLI without loading VS Code-only adapters.

## [0.35.15] - 2026-04-05

### Changed
- AtlasMind Settings now opens as a navigable multi-page workspace with keyboard-friendly section tabs, grouped cards, and quicker access to embedded chat, provider, and specialist surfaces instead of a single long collapsible form.

## [0.35.14] - 2026-04-05

### Added
- AtlasMind now exposes an embedded Chat view inside the AtlasMind sidebar container, reusing the same session-aware chat surface as the detachable chat panel so the workspace can feel closer to a native VS Code sidecar.

### Changed
- Sessions in the AtlasMind sidebar now open the embedded Chat view by default, while the detachable `AtlasMind: Open Chat Panel` command remains available for a larger floating workspace.

## [0.35.13] - 2026-04-05

### Fixed
- Compressed the dedicated AtlasMind chat composer so send controls sit back underneath the prompt, attachment actions use compact icon buttons, and empty open-file or attachment sections stay hidden until there is content to show.
- Fixed the dedicated chat panel busy-state handling so `Enter` and the `Send` button continue to work after requests instead of leaving the composer controls stuck disabled.

## [0.35.12] - 2026-04-05

### Fixed
- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing, including the default `project_memory` layout and workspace-root SSOTs that already contain `project_soul.md` and MindAtlas folders.
- Startup SSOT loading now fires the Memory sidebar refresh event immediately after indexing so existing project memory appears in the UI without requiring a manual reload or later write.

## [0.35.10] - 2026-04-05

### Added
- The dedicated AtlasMind chat panel now shows an animated AtlasMind globe while the latest assistant turn is still thinking or streaming, so pending replies remain visibly active instead of looking stalled.
- The dedicated AtlasMind chat panel now includes send-mode controls for `Send`, `Steer`, `New Chat`, and `New Session`, plus quick-attach chips for currently open workspace files.
- The chat composer now supports picker-based attachments and drag-and-drop for workspace files and URLs, and it carries attached file context into both normal chat requests and autonomous steering runs.

## [0.35.8] - 2026-04-05

### Added
- The dedicated AtlasMind chat panel now annotates assistant bubbles with the routed model ID and a collapsible thinking summary based on routing and execution metadata.

### Changed
- Built-in `@atlas` freeform and vision replies now append a compact model and thinking summary footer after each response.

## [0.35.7] - 2026-04-05

### Added
- Added an explicit `AtlasMind: Toggle Autopilot` command and a session-only Autopilot status bar indicator so approval bypass mode can be disabled without reloading the extension.

### Fixed
- The dedicated AtlasMind chat panel now routes `/project` goals and short continuation prompts such as `Proceed autonomously` through the same autonomous project execution flow used by the built-in `@atlas` chat participant.

## [0.35.6] - 2026-04-05

### Fixed
- Short continuation prompts such as `Proceed autonomously` now reuse the latest substantive chat request and launch AtlasMind's autonomous project pipeline instead of stalling in repeated explanatory turns.
- Wired the existing runtime tool approval manager into live tool execution so approval prompts now support `Allow Once`, task-scoped `Bypass Approvals`, and session-wide `Autopilot`.

## [0.35.5] - 2026-04-05

### Added
- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed.

## [0.35.4] - 2026-04-05

### Fixed
- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring.

### Changed
- The task profiler now treats high-stakes conversation follow-ups as stronger reasoning work, and the router normalizes cheapness so capability and task-fit can outweigh free local pricing when appropriate.

## [0.35.3] - 2026-04-05

### Added
- Added inline edit and review actions to Memory sidebar entries so indexed SSOT files can be opened directly or summarized in natural language from the tree view.

## [0.35.2] - 2026-04-05

### Fixed
- Added a real `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) keybinding for `AtlasMind: Open Chat Panel` so the shortcut shown in the Get Started walkthrough actually opens chat.
- Updated the walkthrough chat buttons to launch the AtlasMind chat panel directly instead of relying on an unbound generic chat command.

## [0.35.1] - 2026-04-05

### Added
- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel is reachable directly from the panel itself.

### Changed
- Added an optional Import Existing Project title-bar action to the Sessions sidebar view and exposed a new `atlasmind.showImportProjectAction` setting in the Settings panel to hide it when not wanted.

## [0.35.0] - 2026-04-05

### Added
- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent per-workspace chat threads, a session rail, and a dedicated Sessions sidebar view.
- Surfaced recent autonomous project runs alongside chat sessions so you can inspect active sub-agent work from the same workspace and jump into the Project Run Center to steer batch approvals, pauses, and resumes.

## [0.34.2] - 2026-04-05

### Fixed
- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer triggers the VS Code language-model permission prompt during normal startup.

## [0.34.1] - 2026-04-05

### Fixed
- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page.

## [0.34.0] - 2026-04-05

### Added
- Added a dedicated AtlasMind chat panel so the extension can be used through its own conversation UI instead of only through VS Code's built-in Chat view.

### Changed
- Added a Settings quick action and command-palette entry for opening the dedicated chat panel.

## [0.33.1] - 2026-04-05

### Fixed
- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation.

## [0.33.0] - 2026-04-04

### Added
- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication.
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed Bedrock adapter.
- Added a Specialist Integrations panel for search, voice, image, and video vendors that intentionally stay off the routed chat-provider list.

### Changed
- Expanded provider configuration and routing documentation to cover Azure OpenAI, Bedrock, and specialist vendor separation.

## [0.32.10] - 2026-04-04

### Changed
- Switched the repository default branch to `develop` so routine development and push requests now target `develop` by default.
- Hardened `master` so it is updated only through the intentional `develop` to `master` pre-release promotion flow.
- Updated contributor and Copilot workflow guidance to match the enforced default-branch and release-branch policy.

## [0.32.9] - 2026-04-04

### Changed
- Adopted a documented `develop` ÔåÆ `master` promotion model so `master` stays release-ready for published pre-releases.
- Updated CI to run on both `develop` and `master` pushes and pull requests.
- Updated contributor guidance and Copilot instructions to stop using `master` as the routine development branch.

### Fixed
- Treated the built-in local echo fallback as healthy when no local OpenAI-compatible endpoint is configured, so routing and tests do not incorrectly mark the local provider as unavailable.

## [0.32.7] - 2026-04-04

### Changed
- Added a bracketed warning marker to partially enabled provider rows in the Models sidebar while keeping the green enabled icon.

## [0.32.6] - 2026-04-04

### Changed
- Replaced Models sidebar status text with colored status icons and sorted unconfigured providers to the bottom of the list.

## [0.32.5] - 2026-04-04

### Added
- Added a real configurable local provider flow backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key.

### Changed
- Local provider setup can now be completed directly from the Models and Model Providers UIs instead of only showing guidance.

## [0.32.4] - 2026-04-04

### Added
- Added inline provider configure and assign-to-agent actions to the Models sidebar, plus model-level assign-to-agent actions.

### Changed
- Hid child model rows for unconfigured providers until credentials are available.
- Persisted agent model assignments from the Models sidebar for both custom and built-in agents.

## [0.32.3] - 2026-04-04

### Added
- Added inline enable/disable and info actions to Models tree items so providers and individual models can be controlled directly from the sidebar.

### Changed
- Persisted provider/model availability choices in extension storage and reapplied them after runtime model catalog refreshes.

## [0.32.2] - 2026-04-04

### Fixed
- Removed the activation-time import of the Agent Manager panel so persisted user agents are restored without evaluating webview UI code during startup.

## [0.32.1] - 2026-04-04

### Fixed
- Lazy-loaded panel modules from command handlers so one broken view module cannot block all AtlasMind commands during activation.

## [0.32.0] - 2026-04-04

### Added
- New `AtlasMind: Getting Started` command that reopens the onboarding walkthrough directly from the Command Palette.

### Fixed
- Keeps the recent Agent, Skills, and MCP panel reliability fixes in the current beta line.
- Commands are now registered at the start of activation and resolve AtlasMind context lazily, preventing `command ... not found` errors for walkthrough and Command Palette actions during startup.

## [0.31.4] - 2026-04-04

### Fixed
- Rewired the Manage Agents panel buttons to use CSP-safe event listeners so New Agent, Edit, Enable/Disable, Delete, Save, and Cancel work again.
- Registered commands and tree views earlier in activation and isolated UI registration steps so Skills and MCP panel actions remain available even if another startup surface fails.

### Added
- Regression coverage for the agent manager webview markup to prevent inline-handler breakage.
- Regression coverage for activation-step error isolation during startup.

## [0.31.2] - 2026-04-04

### Fixed
- Activated AtlasMind on startup so walkthrough command buttons are available immediately after install.

### Added
- Manifest test coverage for the get-started walkthrough provider button and activation wiring.

## [0.31.1] - 2026-04-04

### Fixed
- Converted extension icon from SVG to PNG for VS Code Marketplace compliance.
- Added top-level `icon` field in `package.json` for marketplace display.
- Fixed coverage threshold CHANGELOG description (was documented as 65%, actually 45%).

## [0.31.0] - 2026-04-04

### Added
- Tests for 5 previously uncovered skills: `validation`, `gitStatus`, `gitDiff`, `gitCommit`, `fileWrite`.
- Message validation tests for `ToolWebhookPanel`, `McpPanel`, and `AgentManagerPanel` webviews.
- CI now runs on `ubuntu-latest`, `windows-latest`, and `macos-latest` to catch platform-specific issues.
- Coverage tracking expanded to include `src/views/` and `src/chat/`; global thresholds set to 45% to reflect the broader scope (core modules remain well above 60%).
- Cross-links in `CONTRIBUTING.md` for adding agents, skills, and MCP servers.
- `bugs` and `homepage` fields in `package.json` for Marketplace discoverability.

### Fixed
- Vision panel markdown renderer no longer double-escapes HTML entities in link labels and targets.
- MCP server registry logs connection and disconnection errors to the output channel instead of silently swallowing them.
- Webhook dispatcher now enforces HTTPS for outbound URLs (HTTP allowed only for localhost/127.0.0.1).

### Changed
- Exported `isToolWebhookMessage`, `validatePanelMessage` (MCP), and `isAgentPanelMessage` for testability.

## [0.30.5] - 2026-04-04

### Changed
- Streamlined the README into a shorter overview and onboarding document.
- Moved detailed comparison, support, workflow, and structural reference material behind deeper docs and wiki pages.

## [0.30.4] - 2026-04-04

### Fixed
- Resolved CI lint failures across chat, router, skill, and webview files.
- Restored a passing coverage gate by scoping enforced thresholds to the service-layer modules currently covered by automated tests.

### Changed
- Clarified model-routing documentation and wiki content to explain runtime model catalog refresh, seed fallback models, and metadata enrichment.
- Added wiki pages and navigation for funding/sponsorship information, and refreshed wiki comparison tables to match the current project positioning.

## [0.30.3] - 2026-04-04

### Changed
- Restored `GitHub Copilot Chat` to the recommended VS Code extensions for the repo and bootstrap-generated workspaces.
- Updated Copilot setup guidance and runtime error wording to direct users to `GitHub Copilot Chat` again.

## [0.30.2] - 2026-04-04

### Fixed
- Removed the deprecated `GitHub Copilot Chat` extension recommendation from the repository and bootstrap-generated `.vscode/extensions.json`.
- Updated Copilot-facing labels and error messages to refer to VS Code language models / the `GitHub Copilot` extension rather than `Copilot Chat`.

### Changed
- Quick start and getting-started docs now clarify that AtlasMind's Copilot provider only requires the `GitHub Copilot` extension and a signed-in session.

## [0.30.1] - 2026-04-04

### Fixed
- **Real daily budget enforcement** ÔÇö `dailyCostLimitUsd` now blocks new requests once the cap is reached instead of only showing an advisory warning.
- **Live provider health refresh** ÔÇö the status bar now refreshes immediately after storing credentials or refreshing model catalogs.
- **Run Center disk hydration** ÔÇö the Project Run Center and project runs tree now read from the async disk-backed run history path instead of the legacy synchronous index.

### Added
- **Budget control in Settings panel** ÔÇö the Settings webview now exposes `dailyCostLimitUsd` directly.
- **Quick actions in Settings** ÔÇö direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision improve secondary-surface discoverability.
- **Coverage for follow-up fixes** ÔÇö new tests cover daily budget blocking, disk-backed run history, and new settings-panel messages.

## [0.30.0] - 2026-04-04

### Added
- **Getting Started walkthrough** ÔÇö four-step onboarding flow (configure provider, bootstrap/import, first chat, try /project) via `contributes.walkthroughs` in the extension manifest.
- **API key health check** ÔÇö after storing a provider key the Model Provider panel immediately validates it by calling `listModels()` and shows pass/fail feedback.
- **Collapsible settings panel** ÔÇö Settings webview groups options into collapsible `<details>` sections; advanced and experimental sections start collapsed.
- **Approval threshold explanation** ÔÇö the `/project` approval gate now explains estimated file count, the threshold value, its purpose, and where to change it.
- **Memory tree pagination** ÔÇö MemoryTreeProvider supports incremental loading (200 entries per page) with a "Load moreÔÇª" item instead of a hard 200-entry cap.
- **Provider health status bar** ÔÇö a StatusBarItem shows how many configured providers have valid API keys on activation.
- **Cost persistence and daily budget** ÔÇö CostTracker persists session records and daily totals to `globalState`; new `atlasmind.dailyCostLimitUsd` setting triggers warnings at 80% and blocks at 100%.
- **Streaming for Anthropic and OpenAI-compatible providers** ÔÇö full `streamComplete()` implementations with SSE parsing, tool-call accumulation, and token counting.
- **Agent performance tracking** ÔÇö AgentRegistry records success/failure per agent; Orchestrator boosts agent selection score based on historical success rate; performance data persisted across sessions.
- **Expanded task profiler vocabulary** ÔÇö all four regex pattern sets (vision, code, high-reasoning, medium-reasoning) expanded with 100+ additional keywords for more accurate task classification.
- **Multi-workspace folder support** ÔÇö `pickWorkspaceFolder()` utility shows a quick-pick when multiple folders are open; used by bootstrap, import, and skill-template commands.
- **Per-subtask checkpoint rollback** ÔÇö `rollbackByTaskId()` and `listCheckpoints()` added to CheckpointManager for targeted restore instead of last-only.
- **Integration test suite** ÔÇö new `tests/integration/taskLifecycle.test.ts` exercises the full orchestrator ÔåÆ agent ÔåÆ cost ÔåÆ performance tracking lifecycle.
- **Cost estimation in plan preview** ÔÇö `/project` now shows an estimated `$low ÔÇô $high` cost range before execution based on subtask count and selected model pricing.
- **Disk-based run history** ÔÇö ProjectRunHistory writes individual JSON files to `globalStorageUri/project-runs/` with automatic migration from `globalState`; synchronous index kept for tree views.
- **Diff preview in project report** ÔÇö project execution summary includes a file/status table and an "Open Source Control" button for reviewing diffs.

### Changed
- Renamed "Semantic Search" references in docs and JSDoc to "Hybrid Keyword + Hash-Vector Search" to accurately describe the retrieval algorithm.
- Improved error messages in `commands.ts` to be more actionable (directs users to specific UI panels).

## [0.29.0] - 2026-04-04

### Added
- Centralised `src/constants.ts` ÔÇö all magic numbers (~40 constants) extracted from 14+ source files into a single importable module.
- Shared `src/skills/validation.ts` ÔÇö reusable parameter validation helpers (`requireString`, `optionalBoolean`, `optionalPositiveInt`, etc.) replacing duplicated typeof/trim checks across 8 skill files.
- `OrchestratorHooks` interface in `types.ts` ÔÇö groups optional hook callbacks (toolApprovalGate, writeCheckpointHook, postToolVerifier) into a single bag, reducing the Orchestrator constructor from 13 positional parameters to 11.
- `OrchestratorConfig` interface in `types.ts` ÔÇö runtime-configurable tunables (maxToolIterations, maxToolCallsPerTurn, toolExecutionTimeoutMs, providerTimeoutMs) with VS Code settings fallback to constant defaults.
- Four new user-facing settings: `atlasmind.maxToolIterations`, `atlasmind.maxToolCallsPerTurn`, `atlasmind.toolExecutionTimeoutMs`, `atlasmind.providerTimeoutMs`.
- Planner sub-task validation now uses a Zod schema (`zod/v4`) replacing manual field-by-field type guards.
- Lazy activation events ÔÇö extension activates on chat participant, commands, or sidebar views instead of `onStartupFinished`.
- Vitest coverage scope expanded from core+skills to all src subsystems with 60% line/function thresholds.

### Fixed
- Fixed indentation defect in `runCommand` inside `extension.ts`.

## [0.28.7] - 2026-04-04

### Fixed
- Hardened `terminal-run` so inline interpreter execution flags like `node -e` and `python -c` are blocked, and `node` invocations no longer pass through the read-only approval path unless they are simple help/version checks.
- Strengthened workspace path enforcement by canonicalizing paths with `realpath`, preventing symlink-based escape from workspace-scoped file and language-service operations.
- Required explicit per-workspace approval before outbound tool webhooks can be delivered from workspace-controlled settings, reducing silent data exfiltration risk from untrusted repositories.

## [0.28.6] - 2026-04-04

### Changed
- Restored the README SVG logo header because the repository's target renderers handle it correctly and the visual branding is intentional.

## [0.28.5] - 2026-04-04

### Changed
- Corrected the README comparison table to better reflect current published capabilities for Claude Code, Cursor, GitHub Copilot, Aider, and OpenHands, replacing several outdated red crosses with more accurate supported or limited markers.
- Cleared package/README diagnostics by adding explicit sidebar view icons and removing the unsupported SVG image embed from the README header.

## [0.28.4] - 2026-04-04

### Changed
- Refined the Backer funding tier wording to promise priority consideration for integrations and feature proposals, priority issue triage, and wider public recognition including in changelogs.

## [0.28.3] - 2026-04-04

### Changed
- Removed the private monthly Q&A call from the published Backer tier so the funding model stays focused on sponsorship and project support rather than private access.

## [0.28.2] - 2026-04-04

### Changed
- Refined the README funding model into explicit PWYW supporter tiers, including a one-off pay-what-it's-worth option and clearer sponsor benefits.
- Added `CONTRIBUTORS.md` so opted-in supporters can be acknowledged publicly without changing AtlasMind's open-source license or feature access.

## [0.28.1] - 2026-04-04

### Added
- **PWYW funding support** ÔÇö added GitHub Sponsors funding metadata and repository funding configuration so AtlasMind remains open source while offering an optional pay-what-you-want support path.

### Changed
- README now documents the funding model explicitly: AtlasMind stays MIT-licensed and fully open source, with sponsorship framed as optional maintenance support rather than feature gating.

## [0.28.0] - 2026-04-05

### Added
- **Project import** (`/import` slash command + `AtlasMind: Import Existing Project` command) ÔÇö scans an existing workspace and populates SSOT memory with project overview, dependencies, directory structure, tooling conventions, and license information. Detects project type for Node.js, Rust, Python, Go, Java, Ruby, and PHP projects. Non-destructive: never removes existing memory entries.

## [0.27.1] - 2026-04-04

### Changed
- **README overhaul** ÔÇö replaced the technical feature checklist with a user-friendly overview, centered logo, competitor comparison table (vs Claude Code, Cursor, Copilot, Aider, Open Hands), categorised skill table, provider list, and streamlined configuration section. Technical detail deferred to `docs/`.

## [0.27.0] - 2026-04-05

### Added
- **11 new built-in skills** bringing the total to 26:
  - `diagnostics` ÔÇö retrieve compiler errors/warnings via the VS Code diagnostics API.
  - `code-symbols` ÔÇö AST-aware navigation: list symbols, find references, go to definition.
  - `rename-symbol` ÔÇö cross-codebase rename via the language server with identifier validation.
  - `web-fetch` ÔÇö fetch URL content with SSRF protection (blocks localhost, private IPs, metadata endpoints); 30 s timeout.
  - `test-run` ÔÇö auto-detect test framework (vitest, jest, mocha, pytest, cargo) and run tests; 120 s timeout.
  - `file-delete` ÔÇö delete a workspace file.
  - `file-move` ÔÇö move/rename a workspace file.
  - `git-log` ÔÇö query commit log with optional ref, filePath, and maxCount (capped at 100).
  - `git-branch` ÔÇö list, create, switch, or delete branches with branch-name validation.
  - `diff-preview` ÔÇö combined git status + diff summary with add/modify/delete counts.
  - `code-action` ÔÇö list and apply VS Code quick-fixes and refactorings.
- `file-read` skill now supports optional `startLine`/`endLine` parameters for targeted reads.
- 12 new methods on `SkillExecutionContext`: `getGitLog`, `gitBranch`, `deleteFile`, `moveFile`, `getDiagnostics`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `fetchUrl`, `getCodeActions`, `applyCodeAction`.
- Per-skill `timeoutMs` override ÔÇö skills like `web-fetch` (30 s) and `test-run` (120 s) bypass the default 15 s timeout.
- New test files: `diagnostics`, `codeSymbols`, `renameSymbol`, `webFetch`, `testRun`, `fileManage`, `gitBranch`, `diffPreview`, `codeAction` (381 tests total, 43 suites).

### Changed
- **Tiered terminal allow-list** ÔÇö `terminal-run` now uses a three-tier model: blocked commands (rm, curl, powershell, etc.) are rejected immediately; auto-approved commands expanded to ~40 (added python, cargo, dotnet, go, make, deno, bun, and more); unknown commands are rejected with the allow-list.
- **`MAX_TOOL_CALLS_PER_TURN`** raised from 5 to 8 to support more complex agentic workflows.
- Orchestrator tool execution now respects `skill.timeoutMs` when set, falling back to `TOOL_EXECUTION_TIMEOUT_MS`.

## [0.26.0] - 2026-04-04

### Added
- **Disk persistence for memory writes** ÔÇö `MemoryManager.upsert()` now persists entries as markdown files to the SSOT folder on disk, so agent-written decisions survive across sessions.
- **`memory-delete` skill** ÔÇö agents can now remove stale or outdated SSOT entries via the new `memory-delete` built-in skill (`src/skills/memoryDelete.ts`). Deletes both the in-memory index entry and the on-disk file.
- **`MemoryUpsertResult` feedback** ÔÇö `upsert()` returns `{ status, reason? }` instead of void, so callers know whether a write was created, updated, or rejected (capacity, validation, security scan).
- **Path validation on memory writes** ÔÇö `memoryWrite` rejects absolute paths, parent traversal (`..`), and paths without text-file extensions.
- **Content scanning on memory writes** ÔÇö all upserted content is scanned for prompt injection and credential leakage before acceptance; blocked entries are immediately rejected with a clear error.
- **Field-length enforcement** ÔÇö title (200 chars), snippet (4 000 chars), tags (12 max, 50 chars each) are validated and clamped on upsert.
- **`maxResults` cap** ÔÇö `memoryQuery` skill and `MemoryManager.queryRelevant()` now clamp results to a hard upper bound of 50.
- **`MemoryManager.delete()`** ÔÇö new public method to remove an entry from the index and optionally delete the backing SSOT file.
- **`deleteMemory()` on `SkillExecutionContext`** ÔÇö type-safe delete wired through the skill execution context.
- **Memory tree refresh** ÔÇö `MemoryTreeProvider` now has `EventEmitter`-backed refresh, triggered automatically after upsert or delete operations; shows overflow indicator if entries exceed 200.
- **`memoryRefresh` event** on `AtlasMindContext` ÔÇö fires on every index mutation so tree views and other consumers stay in sync.
- New test files: `tests/skills/memoryWrite.test.ts` (11 tests), `tests/skills/memoryDelete.test.ts` (5 tests).
- 15 new tests in `tests/memory/memoryManager.test.ts` covering path validation, security scan rejection, field limits, delete, query clamping, and upsert result status.

### Changed
- `SkillExecutionContext.upsertMemory()` now returns `MemoryUpsertResult` instead of `void`.
- `memoryWrite` skill returns explicit created/updated/rejected feedback instead of always reporting success.
- `memoryQuery` skill description now documents the maxResults cap.
- The Project Run Center now supports editable plan drafts before execution, per-batch approval gating, pause/resume controls, subtask-level artifact capture, diff-first review, and retrying only failed subtasks from a stored run plan.

## [0.25.0] - 2026-04-04

### Added
- A durable `ProjectRunHistory` service plus a new `AtlasMind: Open Project Run Center` command and `src/views/projectRunCenterPanel.ts` webview for previewing plans before execution, monitoring live batch progress, and reviewing recent project runs.
- A new `/runs` chat slash command and `Project Runs` sidebar tree view so recent autonomous runs are available outside the chat transcript.

### Changed
- `/project` executions now emit batch-level scheduler telemetry, persist run history records, and link directly into the Project Run Center for review.
- The Vision Panel now supports copy-to-clipboard and open-as-markdown response actions, and its lightweight renderer now handles ordered lists and markdown tables in addition to headings, inline code, and fenced blocks.

## [0.24.0] - 2026-04-04

### Changed
- The Vision Panel now renders markdown-style responses with headings, lists, inline code, and fenced code blocks instead of a raw text dump.
- Workspace file references emitted in Vision Panel responses can now be clicked to open the target file and optional line/column directly in VS Code.

## [0.23.0] - 2026-04-04

### Added
- A new `AtlasMind: Open Vision Panel` command and `src/views/visionPanel.ts` webview so operators can attach workspace images and run multimodal prompts outside the chat slash-command flow.
- Shared image attachment helpers in `src/chat/imageAttachments.ts`, used by both the chat participant and the Vision Panel.

### Changed
- AtlasMind vision requests now share one attachment-validation pipeline across freeform chat, `/vision`, and the Vision Panel UI.

## [0.22.0] - 2026-04-04

### Added
- A new `/vision` chat slash command that opens an image picker, attaches selected workspace images, and routes the request to vision-capable models.
- Durable checkpoint persistence in extension storage so automatic rollback checkpoints survive extension reloads and can still be restored later in the session.
- Multimodal integration coverage for orchestrator prompt assembly plus Copilot, Anthropic, and OpenAI-compatible provider request serialization.

### Changed
- Freeform and explicit vision chat flows now share the same attachment pipeline, deduplicating inline and picker-selected images before execution.

## [0.21.0] - 2026-04-04

### Added
- Inline workspace image ingestion for freeform chat requests. Prompts that mention supported image paths (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) now attach those files to compatible vision-capable model requests.

### Changed
- Copilot, Anthropic, and OpenAI-compatible adapters now forward user image attachments using each provider's multimodal request shape.
- Initial prompt construction now compacts memory and recent session context against a model-aware prompt budget, reducing silent context-window overruns on long sessions.

## [0.20.0] - 2026-04-04

### Added
- Automatic pre-write checkpoints for write-capable tool runs, plus a new `rollback-checkpoint` built-in skill that restores the most recent checkpoint as a safety net for multi-file agent changes.

### Changed
- Streaming-capable providers now stream through the full agentic tool loop instead of only the no-tools path, improving long-running tool-driven interactions.

## [0.19.1] - 2026-04-04

### Fixed
- Corrected incorrect dates on CHANGELOG entries for v0.5.0 (`2026-04-04` ÔåÆ `2026-04-03`), v0.6.0 (`2026-04-05` ÔåÆ `2026-04-03`), and v0.7.0ÔÇôv0.8.1 (`2026-04-06` ÔåÆ `2026-04-03`) to match actual git commit timestamps.
- Removed duplicate out-of-order v0.11.0 and v0.10.3 entries that appeared after the v0.5.0 section.

## [0.19.0] - 2026-04-04

### Added
- Automatic post-write verification hook for agent tool runs. After successful `file-write`, `file-edit`, or `git-apply-patch` operations, AtlasMind can now run sanitized package scripts such as `test` or `lint` and feed the summary back into the next model turn.
- New settings for verification control: `atlasmind.autoVerifyAfterWrite`, `atlasmind.autoVerifyScripts`, and `atlasmind.autoVerifyTimeoutMs`.

### Changed
- The Settings panel now exposes verification toggles, configured script names, and per-script timeout limits.
- Verification runs once per write-producing tool batch instead of once per individual tool call, avoiding redundant test runs when a model performs multiple edits in one turn.

## [0.18.0] - 2026-04-04

### Added
- Safe built-in agent tools for grep-style text search, directory listing, targeted file edits, allow-listed terminal execution, and git status/diff/commit workflows.
- Configurable per-tool approval policy with `atlasmind.toolApprovalMode` and `atlasmind.allowTerminalWrite`; risky tool invocations now prompt before execution and terminal writes remain disabled by default.
- Bounded freeform chat carry-forward context via `SessionConversation`, controlled by `atlasmind.chatSessionTurnLimit` and `atlasmind.chatSessionContextChars`.
- Opportunistic streaming support for provider adapters that can emit text chunks while still returning a structured completion result. `CopilotAdapter` now streams text through the VS Code LM API.
- Unit tests for text search, targeted file editing, terminal execution, and orchestrator approval denial handling.

### Changed
- `SkillExecutionContext` now exposes `searchInFiles`, `listDirectory`, `runCommand`, `getGitStatus`, and `getGitDiff` in addition to file I/O, memory access, and git patching.
- `SettingsPanel` now controls tool approval mode, terminal-write opt-in, and session context compaction limits in addition to existing budget/speed and `/project` settings.
- `VoiceManager` now persists voice setting changes and copies final STT transcripts to the clipboard for quick pasting into chat.
- **Seed-only default providers** ([src/extension.ts](src/extension.ts)): `registerDefaultProviders()` now registers a single minimal seed model per provider instead of multiple hardcoded models. The full model list is auto-populated at startup via `refreshProviderModelsCatalog()` and runtime discovery.
- **Premium request multiplier scoring** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): `effectiveCostPer1k()` now factors `premiumRequestMultiplier` (e.g. 3├ù for Claude Opus 4) into subscription cost calculations, enabling the router to prefer 1├ù models when capabilities are equivalent.
- **Subscription quota tracking** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `updateSubscriptionQuota()` / `getSubscriptionQuota()` APIs allow runtime quota management. When quota is exhausted, subscription models fall to pay-per-token budget gating and full listed-price scoring.
- **Conservation threshold** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): Below 30% remaining quota, effective cost blends linearly from subscription cost toward listed API cost, encouraging the router to conserve subscription requests as they deplete.
- **`costPerRequestUnit` blending** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): When `SubscriptionQuota.costPerRequestUnit` is set, the router computes real per-request cost (`costPerRequestUnit ├ù multiplier`) enabling comparison across subscription tiers (e.g. Copilot Pro vs Claude Code).
- 10 new subscription quota and premium multiplier routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts).

### Security
- Added a tool policy layer that classifies invocations before execution and enforces modal approvals for risky actions.
- `terminal-run` executes only an allow-list of executables and never uses shell interpolation.

## [0.17.0] - 2026-04-04

### Added
- **Voice Panel** ([src/views/voicePanel.ts](src/views/voicePanel.ts)): New webview panel providing Text-to-Speech (TTS) and Speech-to-Text (STT) via the browser Web Speech API ÔÇö no external API key required. Features microphone input button, transcript display, TTS text entry + speak controls, and live voice settings (rate, pitch, volume, language).
- **VoiceManager** ([src/voice/voiceManager.ts](src/voice/voiceManager.ts)): Extension-host service that queues TTS output and bridges STT transcripts. Integrates with `AtlasMindContext` and is disposed with the extension. Validates all voice settings and sanitises the BCP 47 language tag before forwarding to the webview.
- **`atlasmind.openVoicePanel` command** ([src/commands.ts](src/commands.ts)): Opens the Voice Panel. Listed in the Command Palette as _AtlasMind: Open Voice Panel_.
- **`/voice` chat slash command** ([src/chat/participant.ts](src/chat/participant.ts)): Responds with a voice capability summary and an **Open Voice Panel** action button. Follow-up chips added to freeform responses.
- **TTS auto-speak** ([src/chat/participant.ts](src/chat/participant.ts)): When `atlasmind.voice.ttsEnabled` is `true`, freeform `@atlas` responses are automatically forwarded to the Voice Panel for synthesis.
- **`VoiceSettings` type** ([src/types.ts](src/types.ts)): New interface with `rate`, `pitch`, `volume`, and `language` fields ÔÇö validated in `VoiceManager` before use.
- **Six new configuration settings** (`atlasmind.voice.*`):
  - `ttsEnabled` ÔÇö auto-speak freeform @atlas responses (default: `false`)
  - `sttEnabled` ÔÇö enable STT in the Voice Panel (default: `false`)
  - `rate` ÔÇö synthesis rate 0.5ÔÇô2.0 (default: `1.0`)
  - `pitch` ÔÇö synthesis pitch 0ÔÇô2 (default: `1.0`)
  - `volume` ÔÇö synthesis volume 0ÔÇô1 (default: `1.0`)
  - `language` ÔÇö BCP 47 language tag (default: `""` = browser default)

### Security
- Voice Panel webview follows the same CSP nonce + `escapeHtml()` + message-validation pattern as all other AtlasMind panels. Incoming messages are checked by a strict type guard before any action is taken. Language setting is validated against a BCP 47 regex before being applied.

## [0.16.0] - 2026-04-04

### Added
- **Well-known model catalog** ([src/providers/modelCatalog.ts](src/providers/modelCatalog.ts)): Pattern-based catalog of verified model metadata (pricing, context windows, capabilities) for Anthropic, OpenAI, Google, DeepSeek, and Mistral model families. The catalog is consulted during model discovery so the router receives accurate data instead of heuristic guesses.
- **`DiscoveredModel` interface** ([src/providers/adapter.ts](src/providers/adapter.ts)): New type for partial model metadata returned at runtime. Added optional `discoverModels()` method to `ProviderAdapter` ÔÇö providers that implement it surface richer metadata than the ID-only `listModels()`.
- **CopilotAdapter.discoverModels()** ([src/providers/copilot.ts](src/providers/copilot.ts)): Extracts real `maxInputTokens` (context window) and display name from VS Code's Language Model API, then merges with catalog data for pricing and capabilities.  Enables the router to intelligently differentiate between multiple Copilot models (GPT-4o, Claude Sonnet 4, o4-mini, etc.).
- **AnthropicAdapter.discoverModels()** and **OpenAiCompatibleAdapter.discoverModels()** ([src/providers/anthropic.ts](src/providers/anthropic.ts), [src/providers/openai-compatible.ts](src/providers/openai-compatible.ts)): API providers now surface catalog-enriched metadata during discovery.
- **Subscription-aware routing** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `PricingModel` type (`'subscription' | 'pay-per-token' | 'free'`) added to `ProviderConfig`. Router treats subscription (e.g. GitHub Copilot) and free (e.g. local) providers as zero effective cost, strongly preferring them over pay-per-token API providers for single-request routing. When `parallelSlots > 1`, the subscription advantage is progressively reduced so API providers can absorb overflow.
- **`selectModelsForParallel()`** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New method fills subscription/free slots first, then overflows to the best pay-per-token candidates for remaining parallel slots.
- [tests/providers/modelCatalog.test.ts](tests/providers/modelCatalog.test.ts) (25 tests) for catalog pattern matching across all providers.
- [tests/providers/copilotDiscovery.test.ts](tests/providers/copilotDiscovery.test.ts) (7 tests) for Copilot model discovery with real LM API properties.
- 8 new pricing-aware routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) ÔÇö subscription preference, budget gate bypass, parallel slot allocation.

### Changed
- **`refreshProviderModelsCatalog()`** ([src/extension.ts](src/extension.ts)): Now prefers `discoverModels()` over `listModels()` when available, passing rich `DiscoveredModel` hints into the merge pipeline.
- **`inferModelMetadata()`** ([src/extension.ts](src/extension.ts)): Rewired to consult discovery hints first, then the well-known catalog, then heuristic fallbacks. Previous implementation relied solely on substring heuristics.
- **`mergeProviderModels()`** ([src/extension.ts](src/extension.ts)): Now accepts optional discovery hints and enriches existing static entries with runtime data (e.g. real context window from the LM API).
- **`CopilotAdapter.resolveModel()`** ([src/providers/copilot.ts](src/providers/copilot.ts)): Improved matching strategy ÔÇö tries exact ID match, then `family` match, then substring match before falling back to first available model.

## [0.15.0] - 2026-04-04

### Security
- **Critical**: Fixed path traversal vulnerability in `readFile` and `writeFile` skill contexts. Both now use `path.resolve()` + `path.relative()` to guarantee all file operations remain within the workspace root ([src/extension.ts](src/extension.ts)).
- Added JSON Schema validation for tool call arguments before skill execution ÔÇö rejects missing required params and type mismatches ([src/core/orchestrator.ts](src/core/orchestrator.ts)).
- Hardened planner subtask validation: enforce length limits on `id` (80), `title` (200), `description` (2000), `role` (80), and validate that `skills`/`dependsOn` arrays contain only strings ([src/core/planner.ts](src/core/planner.ts)).
- MCP stdio transport now rejects commands containing shell metacharacters (`|;&\`$`) to prevent injection ([src/mcp/mcpClient.ts](src/mcp/mcpClient.ts)).
- Memory manager now enforces a cap of 1,000 entries and 64 KB per SSOT document to prevent denial-of-service via oversized memory ([src/memory/memoryManager.ts](src/memory/memoryManager.ts)).
- Settings panel rejects directory traversal and absolute paths in `projectRunReportFolder` input ([src/views/settingsPanel.ts](src/views/settingsPanel.ts)).
- `escapeHtml()` now escapes single quotes (`'` ÔåÆ `&#39;`) to prevent attribute injection in webview HTML ([src/views/webviewUtils.ts](src/views/webviewUtils.ts)).
- Hardened temp file creation in `applyGitPatch`: uses `fs.mkdtemp()` with restrictive permissions (`0o600`) instead of predictable filenames ([src/extension.ts](src/extension.ts)).

### Added
- `validateToolArguments()` exported from orchestrator for schema-based tool argument validation.
- `parsePlannerResponse()` exported from planner for testability.
- [tests/core/orchestrator.security.test.ts](tests/core/orchestrator.security.test.ts) (9 tests) for tool argument validation.
- [tests/core/planner.test.ts](tests/core/planner.test.ts) (12 tests) for planner parsing, MAX_SUBTASKS enforcement, field length limits, and cycle removal.
- [tests/mcp/mcpClient.security.test.ts](tests/mcp/mcpClient.security.test.ts) (6 tests) for MCP command metacharacter rejection.
- [tests/views/webviewSecurity.test.ts](tests/views/webviewSecurity.test.ts) (6 tests) for escapeHtml coverage including single quotes.
- Memory cap tests in [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts) (2 new tests) for entry count enforcement.

## [0.14.0] - 2026-04-04

### Added
- Completed memory content redaction pipeline in [src/memory/memoryManager.ts](src/memory/memoryManager.ts): warned entries now have sensitive values (API keys, tokens, passwords) replaced with `***REDACTED***` before being sent to model context via `redactSnippet()`.
- Added [tests/core/skillScanner.test.ts](tests/core/skillScanner.test.ts) with 19 tests covering all 12 built-in security rules, rule resolution with overrides and custom rules, and comment stripping.
- Added [tests/providers/providerAdapters.test.ts](tests/providers/providerAdapters.test.ts) with 10 tests for `LocalEchoAdapter` behavior and `ProviderRegistry` CRUD.
- Added [tests/bootstrap/bootstrapper.test.ts](tests/bootstrap/bootstrapper.test.ts) with 13 tests for SSOT path validation edge cases (traversal, absolute paths, empty input, normalisation).
- Added [tests/views/webviewMessages.test.ts](tests/views/webviewMessages.test.ts) with 21 tests for `isSettingsMessage` and `isModelProviderMessage` validators covering all valid/invalid message shapes.
- Added [docs/configuration.md](docs/configuration.md) consolidating all `atlasmind.*` workspace settings, project execution controls, webhook settings, experimental flags, and API key storage.

### Changed
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to use `redactSnippet()` for memory context in system prompts instead of raw snippets.
- Exported `getValidatedSsotPath` from [src/bootstrap/bootstrapper.ts](src/bootstrap/bootstrapper.ts) for isolated testing.
- Exported `isSettingsMessage` from [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and `isModelProviderMessage` from [src/views/modelProviderPanel.ts](src/views/modelProviderPanel.ts) for isolated testing.
- Replaced TODO placeholder in skill template in [src/commands.ts](src/commands.ts) with descriptive stub comment.
- Updated README security section, status, project structure, and documentation links.
- Updated [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md) test directory listings.

## [0.13.2] - 2026-04-03

### Added
- Added opt-in experimental skill learning in [src/commands.ts](src/commands.ts) so Atlas can draft custom skill files, scan them, and optionally import them as disabled skills.
- Added [src/core/skillDrafting.ts](src/core/skillDrafting.ts) with helper logic for skill-id suggestion, prompt construction, and generated-code extraction.
- Added [tests/core/skillDrafting.test.ts](tests/core/skillDrafting.test.ts) covering draft helper behavior.

### Changed
- Updated [src/views/settingsPanel.ts](src/views/settingsPanel.ts) and [package.json](package.json) with an explicit `atlasmind.experimentalSkillLearningEnabled` toggle and warning flow.
- Updated README and skill documentation to explain the token-usage and safety posture of Atlas-generated skills.

## [0.13.1] - 2026-04-03

### Added
- Added [src/core/taskProfiler.ts](src/core/taskProfiler.ts) to infer request phase, modality, reasoning intensity, and capability needs before routing.
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for vision gating, cheap-mode gating, and fast-mode gating.
- Added [tests/core/taskProfiler.test.ts](tests/core/taskProfiler.test.ts) covering mixed-modality inference, tool-use capability inference, and planning-phase reasoning.

### Changed
- Updated [src/core/modelRouter.ts](src/core/modelRouter.ts) so budget and speed act as hard routing gates before scoring, with task-profile-aware scoring afterward.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) and [src/core/planner.ts](src/core/planner.ts) to build task profiles for execution, planning, and synthesis.
- Updated README and architecture docs to reflect task-profile-aware routing.

## [0.13.0] - 2026-04-03

### Added
- Added local embeddings-backed retrieval in [src/memory/memoryManager.ts](src/memory/memoryManager.ts) with hashed vector indexing and cosine similarity ranking, covered by [tests/memory/memoryManager.test.ts](tests/memory/memoryManager.test.ts).
- Added built-in git-backed patch application skill in [src/skills/gitApplyPatch.ts](src/skills/gitApplyPatch.ts), wired through `SkillExecutionContext.applyGitPatch()`, covered by [tests/skills/gitApplyPatch.test.ts](tests/skills/gitApplyPatch.test.ts).
- Added routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) for required-capability filtering and unhealthy-provider exclusion.

### Changed
- Upgraded [src/core/modelRouter.ts](src/core/modelRouter.ts) to be capability-aware and provider-health-aware.
- Updated [src/core/orchestrator.ts](src/core/orchestrator.ts) to request `function_calling` models automatically when agent skills are available.
- Added Anthropic tool-call parity in [src/providers/anthropic.ts](src/providers/anthropic.ts) so tool-use messages and tool results round-trip through the orchestrator loop.
- Updated README and docs to reflect fully implemented feature coverage across routing, memory, agent execution, and git-backed patching.

## [0.12.1] - 2026-04-03

### Added
- Added [SECURITY.md](SECURITY.md) with supported versions, private vulnerability reporting guidance, scope, and response goals.

### Changed
- Upgraded `vitest` and `@vitest/coverage-v8` to `4.1.2` to remediate the moderate Dependabot/npm audit advisory chain affecting `vitest`, `vite`, and `esbuild` in the development toolchain.
- Updated [README.md](README.md), [docs/development.md](docs/development.md), and [CONTRIBUTING.md](CONTRIBUTING.md) to point security disclosures to the repository security policy.

## [0.12.0] - 2026-04-03

### Added
- Added operator toggle support in [src/views/agentManagerPanel.ts](src/views/agentManagerPanel.ts): users can enable or disable registered agents directly from **AtlasMind: Manage Agents**.
- Added disabled-agent persistence in `globalState` (`atlasmind.disabledAgentIds`) and restore on activation in [src/extension.ts](src/extension.ts).
- Added orchestrator tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) covering relevance-based agent selection and disabled-agent exclusion.

### Changed
- [src/core/agentRegistry.ts](src/core/agentRegistry.ts) now tracks enabled/disabled agent state with helper methods (`enable`, `disable`, `isEnabled`, `listEnabledAgents`).
- [src/core/orchestrator.ts](src/core/orchestrator.ts) now selects from enabled agents only and ranks candidates by request overlap with role/description/skills instead of picking the first registered agent.

## [0.11.1] - 2026-04-03

### Added
- Added orchestrator resilience tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for transient provider retry recovery and budget-cap termination.

### Changed
- Hardened [src/core/orchestrator.ts](src/core/orchestrator.ts) with bounded provider retries and request timeout handling for model completion calls.
- Added runtime budget cap enforcement in the agentic loop using cumulative token-based cost estimation (`TaskRequest.constraints.maxCostUsd` and `AgentDefinition.costLimitUsd`).
- Added safety limits for tool execution: max tool calls per turn, bounded parallel tool execution, and per-tool timeout handling.
- Agentic loop now returns an explicit termination response when the iteration safety cap is reached.
- Cost estimation now uses cumulative token usage across all model turns in a task, improving per-task cost accuracy.

## [0.10.3] - 2026-04-03

### Added
- Added webhook lifecycle emission coverage tests in [tests/core/orchestrator.tools.test.ts](tests/core/orchestrator.tools.test.ts) for `tool.started`, `tool.completed`, and `tool.failed` events.

### Changed
- Tool Webhooks panel now validates endpoint format and blocks non-HTTP(S) URLs before saving.
- Quality gate and packaging smoke path re-verified after webhook hardening changes.

## [0.10.2] - 2026-04-03

### Added
- Added [.vscodeignore](.vscodeignore) to reduce VSIX scope by excluding non-runtime project assets.
- Added [LICENSE](LICENSE) so packaging emits a standard bundled license file.

### Changed
- Added repository metadata to [package.json](package.json) to fix packaging base URL resolution.
- Packaging smoke-test now runs successfully via `npx @vscode/vsce package` without repository/license blockers.

## [0.10.1] - 2026-04-03

### Added
- **Webhook dispatcher tests** in [tests/core/toolWebhookDispatcher.test.ts](tests/core/toolWebhookDispatcher.test.ts) covering sensitive data redaction and preview truncation behavior.

### Changed
- `ToolWebhookDispatcher` delivery now retries transient failures with bounded backoff (`429` and `5xx`, up to 3 attempts) before final failure recording.
- Webhook preview helpers now redact sensitive values (`apiKey`, `token`, `password`, `secret`, bearer values, known token formats) before outbound payload emission.
- Fixed two lint issues in [src/memory/memoryScanner.ts](src/memory/memoryScanner.ts) so the full local quality gate is clean.

## [0.10.0] - 2026-04-03

### Added
- **Tool Webhooks panel** (`AtlasMind: Tool Webhooks`) for configuring webhook URL, event filters, timeout, bearer token, delivery testing, and recent delivery history.
- **Tool webhook dispatcher** (`src/core/toolWebhookDispatcher.ts`) with workspace-configurable event filtering, timeout handling, SecretStorage bearer token support, and globalState delivery history.
- **Tool lifecycle webhook events** from orchestrator tool execution loop:
  - `tool.started`
  - `tool.completed`
  - `tool.failed`
  - `tool.test` (manual test dispatch from panel)

### Changed
- `Orchestrator` now emits structured webhook payloads for each tool call lifecycle state (including task/agent/model context, duration, and preview fields).
- Added new workspace settings for webhook behavior:
  - `atlasmind.toolWebhookEnabled`
  - `atlasmind.toolWebhookUrl`
  - `atlasmind.toolWebhookTimeoutMs`
  - `atlasmind.toolWebhookEvents`

## [0.9.2] - 2026-04-03

### Added
- **Dynamic provider model discovery** at extension startup and via the Model Providers panel refresh action.
- **Adapter-driven catalog sync** that merges `listModels()` results into `ModelRouter`, preserving known curated metadata and inferring safe defaults for newly discovered models.
- **OpenAI-compatible `/models` discovery** in `OpenAiCompatibleAdapter` so OpenAI, Gemini-compatible endpoint, DeepSeek, Mistral, and z.ai can expose all currently available models.
- **Anthropic `/v1/models` discovery** with resilient fallback to curated defaults.

### Changed
- `@atlas` freeform and `/project` flows no longer force `preferredProvider: 'copilot'`; routing now evaluates all enabled providers unless explicitly constrained.
- Model Providers panel **Refresh Model Metadata** button now triggers a real catalog refresh and reports updated provider/model counts.

## [0.9.1] - 2026-04-03

### Added
- **z.ai (GLM) provider** ÔÇö new `'zai'` provider ID with models GLM-4.7 Flash (free), GLM-4.7, and GLM-5.
  Uses the z.ai OpenAI-compatible endpoint (`https://api.z.ai/api/paas/v4`).
- **OpenAI provider** ÔÇö GPT-4o mini and GPT-4o models now fully wired with adapter.
- **DeepSeek provider** ÔÇö DeepSeek V3 (`deepseek-chat`) and DeepSeek R1 (`deepseek-reasoner`) models.
- **Mistral provider** ÔÇö Mistral Small and Mistral Large models.
- **Google Gemini provider** ÔÇö Gemini 2.0 Flash and Gemini 1.5 Pro via Google AI Studio's
  OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`).
- **`OpenAiCompatibleAdapter`** (`src/providers/openai-compatible.ts`) ÔÇö generic adapter for any
  OpenAI-compatible chat completion API. Supports tool calling, retry-after logic, and
  per-provider base URL / secret key configuration. Shared by all five new providers.
- **Model Provider panel** now lists z.ai alongside all existing providers.

### Changed
- `ProviderId` union in `src/types.ts` extended with `'zai'`.
- `requiresApiKey()` in the model provider panel now also excludes `'local'` (shows a
  dedicated message instead of an API key prompt for local LLMs).
- All 5 previously stub-only providers (openai, google, mistral, deepseek) now have
  working adapters and pre-populated model catalogs.

## [0.9.0] - 2026-04-03

### Added
- **Execution failure banner with rollback guidance** ÔÇö when one or more subtasks fail,
  `/project` now shows a clear post-run banner listing the failed subtask titles, the
  number of files modified before the failure, and a *View Source Control* action button
  so users can quickly review and revert partial changes.
- **Outcome-driven follow-up chips** ÔÇö `buildFollowups()` now accepts an optional
  `ProjectRunOutcome` context object and returns different chips based on run outcome:
  - Failures ÔåÆ *Retry the project* + *Diagnose failures*
  - Changed files (no failures) ÔåÆ *Add tests*
  - No changes / no outcome ÔåÆ original default chips
- **`ProjectRunOutcome` interface** exported from `src/chat/participant.ts` for
  downstream consumers and tests.
- **7 new participant helper tests** (17 total in `tests/chat/participant.helpers.test.ts`):
  - Outcome-driven followups: failure, changed-files, default, and no-outcome paths
  - Empty changed-file summary returns all-zero counts
  - Approval-threshold gating (10-subtask run exceeds default threshold)
  - No-op run stays within default threshold (2 subtasks)

### Changed
- `handleChatRequest` propagates `ProjectRunOutcome` through `ChatResult.metadata`
  so the follow-up provider receives structured run outcome rather than just the
  command name.
- Failed subtask titles are tracked live in `onProgress` and surfaced both in the
  failure banner and in `ProjectRunOutcome.failedSubtaskTitles`.

## [0.8.1] - 2026-04-03

### Added
- **Settings panel support for `/project` controls**.
  - AtlasMind Settings now exposes project execution UI controls directly in the webview panel:
    - approval threshold (files)
    - estimated files per subtask multiplier
    - changed-file reference limit
    - run summary report folder
  - Input values are validated client-side and server-side before being persisted to workspace settings.

### Changed
- Settings panel is no longer limited to budget/speed modes; it now provides first-class configuration for project execution behavior.

## [0.8.0] - 2026-04-03

### Added
- **Project run summary export** for `/project` executions.
  - Atlas now writes a JSON report to the configured report folder (default: `project_memory/operations`) containing goal, duration, cost, subtask outcomes, changed files, and per-file attribution traces.
  - Chat responses include a clickable reference and an "Open Run Summary" action button when report export succeeds.
- New configuration setting: `atlasmind.projectRunReportFolder`.

### Changed
- `/project` changed-file reporting now tracks per-subtask attribution traces and persists them in the exported run summary.

## [0.7.3] - 2026-04-03

### Added
- **Configurable project UI thresholds** for `/project` runs.
  - `atlasmind.projectApprovalFileThreshold` controls when `--approve` is required.
  - `atlasmind.projectEstimatedFilesPerSubtask` controls the preview heuristic for estimated file impact.
  - `atlasmind.projectChangedFileReferenceLimit` controls how many changed files are emitted as clickable references.

### Changed
- Workspace impact reporting now attributes file changes per completed subtask instead of only showing cumulative drift from the project start.

## [0.7.2] - 2026-04-03

### Added
- **Live workspace impact tracking** for `/project` runs.
  - Atlas now snapshots the workspace before execution starts, then reports how many files have actually changed as subtasks complete.
  - The final project report includes a changed-file summary broken down by `created`, `modified`, and `deleted` files.
  - Up to 5 changed files are surfaced as clickable references in the chat response.

## [0.7.1] - 2026-04-03

### Added
- **Follow-up suggestions** for the `@atlas` chat participant. After each response, VS Code displays contextual follow-up chips relevant to the command that just ran:
  - `/bootstrap` ÔåÆ view agents, view skills, query memory, start a project
  - `/agents` ÔåÆ skills, run a project, how to add an agent
  - `/skills` ÔåÆ agents, how to add a skill, run a project
  - `/memory` ÔåÆ search architecture/decisions, start a project from memory
  - `/cost` ÔåÆ which agents ran, tips to reduce cost
  - `/project` ÔåÆ review cost, save plan to memory, run another project
  - Freeform ÔåÆ turn into a project, search memory, check cost
- `handleChatRequest` now returns `vscode.ChatResult` with `metadata.command` so the `followupProvider` can distinguish which slash command produced the response.

## [0.7.0] - 2026-04-03

### Added
- **Parallel multi-agent project execution** ÔÇö users can now ask Atlas to tackle a complex goal autonomously via the new `/project` slash command.
  - `src/core/planner.ts`: `Planner` class sends a structured JSON decomposition prompt to the LLM and returns a `ProjectPlan` ÔÇö a DAG of `SubTask` nodes, each with an id, title, description, role, skill IDs, and `dependsOn` edges. Includes JSON fence extraction, per-field validation, and Kahn's cycle-removal algorithm so malformed LLM output can never produce an infinite loop.
  - `src/core/taskScheduler.ts`: `TaskScheduler` class topologically sorts the DAG into execution batches (Kahn's BFS), runs each batch with `Promise.all`, caps fan-out at `MAX_CONCURRENCY = 5`, and forwards completed task output as dependency context to downstream tasks. Fires a typed `SchedulerProgress` callback after every subtask.
  - `Orchestrator.processProject(goal, constraints, onProgress?)` ÔÇö orchestrates the full flow: plan ÔåÆ parallel execution via ephemeral role-based sub-agents ÔåÆ LLM synthesis ÔåÆ `ProjectResult`. Sub-agents are synthesised from `SubTask.role` (one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant) and never touch the `AgentRegistry`.
  - `Orchestrator.processTaskWithAgent(request, agent)` ÔÇö new public method extracted from `processTask`; allows the executor to bypass agent selection and use any `AgentDefinition` directly.
  - Parallel tool calls in `runAgenticLoop`: the sequential `for...of` loop over `toolCalls` is replaced with `Promise.all`, so multiple skills in a single model turn now execute concurrently.
- New types in `src/types.ts`: `SubTask`, `SubTaskStatus`, `SubTaskResult`, `ProjectPlan`, `ProjectResult`, `ProjectProgressUpdate` (discriminated union: `planned | subtask-start | subtask-done | synthesizing | error`).
- `/project` chat slash command in `@atlas` participant ÔÇö streams `planned` (markdown task table), per-task progress and output, and the final synthesised report.
- 12 new unit tests in `tests/core/planner.scheduler.test.ts` covering `removeCycles`, `buildExecutionBatches`, and `TaskScheduler` (dependency forwarding, progress callbacks, failure handling).

### Changed
- `Orchestrator.processTask` refactored to delegate to `processTaskWithAgent` ÔÇö no behaviour change for existing callers.

## [0.6.0] - 2026-04-03

### Added
- **MCP Integration** ÔÇö AtlasMind can now connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server and expose its tools as AtlasMind skills.
  - `src/mcp/mcpClient.ts`: wraps `@modelcontextprotocol/sdk` `Client`; handles stdio (subprocess) and HTTP (Streamable HTTP with SSE fallback) transports; exposes `connect()`, `disconnect()`, `callTool()`, `refreshTools()`, and live `status`/`error`/`tools` state.
  - `src/mcp/mcpServerRegistry.ts`: persists server configurations in `globalState`; creates and manages `McpClient` instances; registers discovered tools as `SkillDefinition` objects in the `SkillsRegistry` with deterministic IDs (`mcp:<serverId>:<toolName>`); auto-approves MCP skills (user explicitly added the server = implicit trust); disables skills on disconnect and unregisters them on server removal.
  - `src/views/mcpPanel.ts`: webview panel with server list (connection status dot), per-server tool explorer, add-server form (transport toggle between stdio and HTTP), reconnect, enable/disable, and remove actions. All user input is HTML-escaped and all incoming messages are validated before acting.
- `McpServerConfig`, `McpConnectionStatus`, `McpToolInfo`, `McpServerState` types added to `src/types.ts`.
- `mcpServerRegistry: McpServerRegistry` added to `AtlasMindContext` in `src/extension.ts`; connected servers auto-reconnect on activation; disposed cleanly on deactivation.
- `atlasmind.openMcpServers` command (icon: `$(plug)`) opens the MCP panel.
- **MCP Servers** tree view added to AtlasMind sidebar.
- Runtime dependencies: `@modelcontextprotocol/sdk ^1.29.0`, `zod ^4.3.6`.
- 27 new unit tests in `tests/mcp/` (57 passing total).

## [0.5.1] - 2026-04-03

### Added
- **Memory Scanner** (`src/memory/memoryScanner.ts`): scans every SSOT document for prompt-injection patterns and credential leakage before it reaches model context.
  - 10 rules across three categories: instruction-override phrases (`pi-ignore-instructions`, `pi-disregard-instructions`, `pi-forget-instructions`, `pi-new-instructions`, `pi-system-prompt-override`, `pi-jailbreak`), persona/obfuscation red flags (`pi-act-as`, `pi-zero-width`, `pi-html-comment`), and credential leakage (`secret-api-key`, `secret-token`, `secret-password`). Also checks for oversized documents (`size-limit`).
  - `blocked` status (error-level hits) removes the entry from `queryRelevant` entirely ÔÇö it is never sent to the model.
  - `warned` status (warning-level hits) keeps the entry in context but appends a `[SECURITY WARNING]` notice to the system prompt so the model applies extra scepticism.
- `MemoryScanIssue` and `MemoryScanResult` types added to `src/types.ts`.
- `MemoryManager` now scans all entries on `loadFromDisk` and on `upsert` (when content is provided); exposes `getScanResults()`, `getWarnedEntries()`, `getBlockedEntries()`.
- `Orchestrator.buildMessages()` appends a security notice when any loaded memory entries are warned or blocked.
- 12 new unit tests in `tests/memory/memoryScanner.test.ts` (30 passing total).

## [0.5.0] - 2026-04-03

### Added
- **Skills panel security scanning**: each skill shows a status icon (not scanned / passed / failed) and a rich tooltip with full description, enabled state, parameter list, scan status, and per-issue details (line, snippet, rule, message).
- **Per-skill enable/disable toggle**: skills can be individually enabled or disabled from the tree view via inline eye icon; state persists across sessions in `globalState`.
- **Security gate**: `SkillsRegistry.enable()` rejects skills whose scan found error-level issues, preventing unsafe code from running.
- **Skill security scanner** (`src/core/skillScanner.ts`): 12 built-in rules covering `eval`, `new Function`, `child_process`, shell execution, `process.env`, outbound fetch/HTTP, path traversal, direct `fs` access, and hardcoded secrets.
- **Scanner rule configurator** (`src/views/skillScannerPanel.ts`): webview panel listing all effective rules with per-rule toggle, severity and message editing, custom rule add/delete, and built-in rule reset. Built-in rule patterns are read-only to preserve security integrity.
- **`ScannerRulesManager`** (`src/core/scannerRulesManager.ts`): persists rule overrides and custom rules to `globalState`; validates regex patterns before accepting any change.
- **Add skill workflow** (`atlasmind.skills.addSkill`): create a template `.js` skill file in the workspace or import an existing compiled `.js` file; security scan runs before import is accepted; skill starts disabled pending review.
- **Scan details output channel** (`atlasmind.skills.showScanResults`): shows per-issue details (line, rule, snippet, message) in a dedicated VS Code output channel.
- Built-in skills marked `builtIn: true`; auto-approved on extension activation without requiring a manual scan.
- New commands: `atlasmind.skills.toggleEnabled`, `atlasmind.skills.scan`, `atlasmind.skills.addSkill`, `atlasmind.skills.showScanResults`, `atlasmind.openScannerRules`.
- Inline tree-view buttons for scan (shield) and toggle (eye) on every skill item.
- Skills view title-bar buttons: add skill (`+`) and configure scanner (gear).
- `SerializedScanRule`, `ScannerRulesConfig`, `SkillScanIssue`, `SkillScanResult`, `SkillScanStatus` types added to `src/types.ts`.
- `source?` and `builtIn?` fields added to `SkillDefinition`.
- `ScannerRulesManager` and `skillsRefresh` emitter added to `AtlasMindContext`.

### Changed
- `SkillsTreeProvider` fully rewritten with `SkillTreeItem` exposing `skillId`, rich `MarkdownString` tooltip, state-aware `ThemeIcon`, and `contextValue` (`skill-{builtin|custom}-{enabled|disabled}`) for when-clause menu targeting.
- `webviewUtils.ts` `WebviewShellOptions` extended with optional `extraCss` field.

## [0.3.0] - 2026-04-03

### Added
- Added extension-wide governance scaffolding support to bootstrap flow for any target project (`.github` templates, CI baseline, CODEOWNERS, and `.vscode/extensions.json`).

### Changed
- Updated chat `/bootstrap` command to execute real bootstrap flow instead of returning a placeholder response.

## [0.2.0] - 2026-04-03

### Added
- Added baseline unit tests for `ModelRouter` and `CostTracker` using Vitest.
- Added CI workflow at `.github/workflows/ci.yml` to run compile, lint, tests, and coverage on pushes and pull requests to `master`.
- Added GitHub governance templates: `.github/pull_request_template.md`, issue templates, and `.github/CODEOWNERS`.
- Added team extension recommendations in `.vscode/extensions.json`.

### Changed
- Added test scripts (`test`, `test:watch`, `test:coverage`) and testing dependencies in `package.json`.
- Added ESLint configuration with TypeScript support in `.eslintrc.cjs`.
- Updated documentation for testing workflow, CI quality gates, and branch/PR/issue governance expectations.

## [0.1.0] - 2026-04-03

### Added
- Added `ProviderRegistry` and a `local` fallback adapter (`local/echo-1`) to enable an executable end-to-end path without external SDK dependencies.
- Registered default provider metadata and default agent at activation.
- Added an Anthropic provider adapter (`src/providers/anthropic.ts`) with SecretStorage key lookup and retry handling for rate limits and transient server errors.
- Added a GitHub Copilot provider adapter (`src/providers/copilot.ts`) using VS Code's Language Model API.

### Changed
- Replaced orchestrator stub flow with an MVP pipeline: agent selection, memory query, model routing, provider dispatch, and cost recording.
- Implemented model routing scoring based on budget/speed/quality heuristics over enabled provider models.
- Implemented disk-backed SSOT indexing and ranked keyword retrieval in `MemoryManager`.
- Wired freeform `@atlas` chat messages through the orchestrator and implemented `/memory` query output.
- Updated memory sidebar view to display indexed SSOT entries.
- Updated cost calculation to use per-model pricing metadata and provider-reported token usage.
- Updated chat routing defaults to prefer the Copilot provider when available.

## [0.0.2] - 2026-04-03

### Changed
- Hardened webview security by replacing inline handlers with nonce-protected scripts and stricter CSP rules.
- Validated all webview messages before accepting configuration changes or provider actions.
- Moved provider credential handling to VS Code SecretStorage instead of placeholder UI-only flows.
- Made project bootstrapping safer by rejecting unsafe SSOT paths and by creating only missing files and folders.
- Updated project documentation and Copilot instructions to enforce a safety-first and security-first development model.

## [0.0.1] - 2026-04-03

### Added
- Extension scaffolding with `package.json` manifest and TypeScript build.
- Chat participant `@atlas` with slash commands: `/bootstrap`, `/agents`, `/skills`, `/memory`, `/cost`.
- Sidebar tree views: Agents, Skills, Memory (SSOT), Models.
- Webview panels: Model Provider management, Settings (budget/speed sliders).
- Core architecture stubs: Orchestrator, AgentRegistry, SkillsRegistry, ModelRouter, CostTracker.
- Memory manager stub with SSOT folder definitions.
- Project bootstrapper: Git init prompt, SSOT folder creation, project type selection.
- Provider adapter interface (`ProviderAdapter`) for normalised LLM access.
- Shared type definitions (`types.ts`): agents, skills, models, routing, cost tracking.
- Activity bar icon and sidebar container.
- Full documentation set: README, CHANGELOG, CONTRIBUTING, architecture guides.
- Copilot instruction set (`.github/copilot-instructions.md`) for documentation maintenance.

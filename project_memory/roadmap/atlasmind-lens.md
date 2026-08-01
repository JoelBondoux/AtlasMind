# AtlasMind Lens Roadmap

AtlasMind Lens is the inspectable visual layer for understanding how a project is wired. It starts with a queryable code outline and grows into evidence-backed views of execution, change impact, tests, data, state, contracts, configuration, and pull requests.

The governing interaction is deliberately shared across every Lens surface: a file, symbol, range, connection, route, command, schema field, or runtime event is a **visual target**. A target can be opened at its exact source, attached to Atlas Chat, traced, compared, or reviewed for impact without silently submitting a prompt or changing the workspace.

## Product principles

- **Evidence before inference.** Every node and connection declares whether it came from source, runtime observation, a framework, an explicit declaration, or inference. Unknown is not broken.
- **Query anything visible.** Nodes, edges, grouped blocks, code lines, routes, commands, fields, and findings share the same Ask Atlas and attach-to-task affordances.
- **Progressive disclosure.** Compact, frequently used structure belongs in a native sidebar tree. Dense graphs and comparisons open in an editor webview rather than consuming another permanent panel.
- **Navigation is exact.** Source-backed targets open the workspace-relative file and range that produced them.
- **Safe by construction.** Lens does not send a prompt merely because a view is opened. Drafts remain reviewable, paths remain workspace-relative, payloads are bounded, and untrusted labels are normalized before reaching chat or a webview.
- **Useful while incomplete.** Partial maps state their evidence gaps instead of drawing confident but unsupported wires.

## Shared visual-target platform

The first implementation establishes a host-neutral `LensVisualTarget` contract. Later surfaces build on that contract rather than inventing incompatible node payloads.

Each target carries:

- a stable id, kind, label, optional detail, workspace-root identity, and root-relative source range;
- bounded evidence records labelled `source`, `runtime`, `framework`, `declared`, or `inferred`;
- optional confidence only where confidence is meaningful;
- actions such as **Open source**, **Ask Atlas**, **Explain connection**, **Trace from here**, **Show impact**, **Find tests**, and **Add to task**, according to the target kind.

## Delivery sequence

### Phase 1 — Queryable Code Outline (in progress, v0.235.0–v0.236.0)

Add **Lens — Code Explorer** to the AtlasMind sidebar. It follows the active editor, renders nested symbols through VS Code's language services, opens a symbol at its exact range, and attaches a validated source target to an editable Atlas Chat draft.

Exit criteria:

- active-file outline works across languages supported by installed VS Code language providers;
- nested symbols remain navigable;
- Ask Atlas opens a draft and never auto-submits;
- target payloads do not contain source text or absolute filesystem paths;
- empty, unsupported, and outside-workspace states are explicit;
- multi-root ownership is explicit and revalidated before source or chat actions;
- symbol filtering is designed before workspace-wide expansion.

### Phase 2 — Entrypoint Journey and Execution Flow Explorer

Visualize a selected journey from an HTTP route, UI event, background job, CLI command, message, or test entrypoint. Distinguish:

- **possible flow** from static analysis;
- **observed flow** from debugger, test, trace, or telemetry evidence;
- **inferred flow** where AtlasMind can only establish a likely connection.

Developers can set a bounded scenario—request parameters, feature flags, environment, authenticated role, or test case—and compare branches. The view must not claim that a static call graph proves runtime behaviour.

### Phase 3 — Contract Map and Schema Wiring Review

Review the full field journey across application and data boundaries:

`Form → API contract → Validator/DTO → Domain model → ORM/query → Database`

Initial sources:

- SQL schemas, migrations, and optionally a user-authorized live database;
- ORM models and generated database clients;
- OpenAPI, JSON Schema, GraphQL, and protobuf contracts;
- validators such as Zod, Joi, and Yup;
- TypeScript interfaces, generated API clients, serializers, queries, fixtures, and tests.

Views:

1. **Field Wiring Board** — maps each field across layers and labels it exact, transformed, dropped, introduced, incompatible, unverified, or inferred.
2. **Relationship Map** — shows foreign keys, ORM relations, resolvers, loaders, and code paths that traverse them.
3. **Contract Drift Review** — compares declared and implemented request/response shapes and generated clients.
4. **Schema Change Impact** — starts from a proposed field, type, constraint, or relation change and finds consumers, migrations, tests, and deployment risks.

Finding classes remain explicit: definite conflict, likely drift, missing evidence, intentional transform, dead wire, dropped wire, and undocumented wire. Projects can declare mappings and suppressions so deliberate renames and transformations do not become permanent false positives. Missing evidence never becomes an automatic defect.

### Phase 4 — Change Impact Map

Starting from a target or working-tree diff, show upstream callers, downstream consumers, public contracts, configuration, schemas, tests, documentation, and operational surfaces likely to be affected. Rank by evidence and proximity, expose why each item is present, and preserve unknowns.

### Phase 5 — Test and Behaviour Map

Connect production symbols, routes, contracts, and behaviours to unit, integration, contract, end-to-end, and exploratory evidence. Surface untested behaviour and tests with no live production target without equating absence of a discovered link with absence of coverage.

### Phase 6 — Data Journey and Trust Map

Trace data from collection through validation, transformation, storage, cache, queue, API, analytics, and deletion. Overlay trust boundaries, redaction, encryption, retention, residency, and authorization evidence. This view should integrate with the schema wiring foundation rather than maintain a second model of fields.

### Phase 7 — State and Lifecycle Explorer

Render application states, transitions, guards, effects, persistence, retry paths, cancellation, and terminal states for UI stores, workflows, jobs, agents, and protocols. Compare declared state machines with observed transitions when runtime evidence is available.

### Phase 8 — Configuration Resolution Explorer

Explain an effective setting from defaults through config files, environment variables, workspace/user settings, feature flags, and runtime overrides. Every winning and shadowed value names its source; secret values are never rendered or attached to chat.

### Phase 9 — Change Story / PR Map

Turn a branch or pull request into a reviewable story: intent, changed components, affected journeys, contract/schema changes, tests, unresolved risks, and documentation. This is a review surface, not a replacement for the diff.

## Cross-cutting engineering work

- Build language-adapter boundaries around VS Code symbols, references, call hierarchy, framework routes, schemas, and runtime traces.
- Add a bounded graph model with deterministic ids, cancellation, incremental refresh, and cache invalidation on source changes.
- Define a versioned webview protocol that accepts only normalized Lens targets and graph records.
- Keep analysis local by default. Any model-backed explanation uses the existing provider, budget, approval, and redaction paths.
- Measure indexing latency, graph size, refresh cost, and false-positive rates before enabling workspace-wide automatic analysis.
- Add accessibility: keyboard traversal, list/table alternatives to graphs, high-contrast-safe semantics, and textual evidence summaries.

## Near-term backlog

- [x] Define and test the shared Lens visual-target contract.
- [x] Add the native active-file Code Explorer outline.
- [x] Add exact source navigation and reviewable Ask Atlas drafts.
- [x] Add multi-root-aware workspace identity to source targets.
- [ ] Add symbol kind/filter controls and target actions beyond Ask Atlas.
- [ ] Add reference and call-hierarchy adapters with evidence labels.
- [ ] Prototype the editor-hosted journey graph on one entrypoint type.
- [ ] Define the normalized contract/schema source model and explicit mapping file.
- [ ] Add fixtures for renamed, transformed, dropped, incompatible, and unverifiable fields.
- [ ] Establish graph performance budgets and accessibility acceptance tests.

## Out of scope for the foundation

- executing code merely to populate Lens;
- connecting to a live database without explicit configuration and consent;
- treating generated diagrams as proof of runtime behaviour;
- silently editing code, schemas, tests, or mappings from a Lens action;
- replacing VS Code's editor, debugger, source control diff, or database administration tools.

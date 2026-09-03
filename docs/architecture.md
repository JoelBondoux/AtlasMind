# Architecture Overview

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  VS Code                                                        │
│                                                                 │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ @atlas Chat   │   │ Sidebar      │   │ Webview Panels     │  │
│  │ Participant   │   │ Tree Views   │   │ (Settings,         │  │
│  │               │   │ (Agents,     │   │  Model Providers,  │  │
│  │               │   │  Skills,     │   │  Tool Webhooks,    │  │
│  │ /bootstrap    │   │  Skills,     │   │                    │  │
│  │ /agents       │   │  Memory,     │   │                    │  │
│  │ /skills       │   │  Models)     │   │                    │  │
│  │ /memory       │   │              │   │                    │  │
│  │ /cost         │   │              │   │  Voice, Vision,    │  │
│  │               │   │              │   │  Website Studio)   │  │
│  └──────┬───────┘   └──────┬───────┘   └────────┬───────────┘  │
│         │                  │                     │              │
│  ───────┴──────────────────┴─────────────────────┘              │
│                            │                                    │
│                   ┌────────▼────────┐                           │
│                   │  Orchestrator   │                           │
│                   │                 │                           │
│                   │  • selectAgent  │                           │
│                   │  • gatherMemory │                           │
│                   │  • pickModel    │                           │
│                   │  • execute      │                           │
│                   │  • recordCost   │                           │
│                   └──┬────┬────┬───┘                           │
│                      │    │    │                                │
│         ┌────────────┘    │    └────────────┐                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐           │
│  │ Agent       │  │ Model       │  │ Memory       │           │
│  │ Registry    │  │ Router      │  │ Manager      │           │
│  │             │  │             │  │              │           │
│  │ + Skills    │  │ + Cost      │  │ + SSOT       │           │
│  │   Registry  │  │   Tracker   │  │   Folders    │           │
│  └─────────────┘  └──────┬──────┘  └──────────────┘           │
│                          │                                     │
│                   ┌──────▼──────┐                              │
│                   │  Provider   │                              │
│                   │  Adapters   │                              │
│                   │             │                              │
│                   │ Anthropic   │                              │
│                   │ ACP Agents  │                              │
│                   │ OpenAI      │                              │
│                   │ Google      │                              │
│                   │ Mistral     │                              │
│                   │ DeepSeek    │                              │
│                   │ Local LLM   │                              │
│                   │ Copilot     │                              │
│                   └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

## CI execution boundary

Repository validation has three deliberately separate execution planes. `npm run ci:local:quick` is the
inner-loop plane; `npm run ci:local` is the complete local pre-push gate. Both are static package scripts,
so neither needs GitHub or a runner registration. `.github/workflows/trusted-local-ci.yml` is the optional
development dispatch plane: only an owner `develop` push or exact-ref manual dispatch, read-only token, no
secrets/OIDC, full-SHA actions, and one custom label registered without GitHub's generic self-hosted labels.
The worker is an ephemeral non-root Linux container in Docker Desktop's WSL2 VM, with no host mounts or
Docker socket, and is started only for the reviewed job.

`.github/workflows/ci.yml` is a different plane: provider-hosted release evidence. It runs automatically
only for pull requests into protected `main`, preserves the three check contexts branch protection already
requires, and can be dispatched manually for an intentional platform investigation. Separating workflow
files prevents adding a local runner from silently making it eligible for public PR jobs, and separating
job names prevents one Linux machine from impersonating Windows/macOS release evidence.

`tests/ciWorkflowPolicy.test.ts` reads both workflow files and the manifest as policy artifacts. It pins the
hosted trigger boundary, local workflow event/ref/actor/repository checks, least-privilege permissions,
absence of secrets and OIDC, immutable action references, non-persistent checkout credentials, runner
label, and the distinction between quick and complete local scripts. This is intentionally a source-level
contract: workflow security can regress while TypeScript compiles perfectly.

## Activation Flow

1. VS Code triggers `onStartupFinished`.
2. `extension.ts` → `activate()` runs:
  - Creates core services: `CostTracker`, `AgentRegistry`, `SkillsRegistry`, `ModelRouter`, `TaskProfiler`, `MemoryManager`, `ToolWebhookDispatcher`.
    - Creates `VoiceManager` for browser-based voice panel orchestration and optional ElevenLabs audio delivery. It also owns a `HostSpeechSynthesizer` (`src/voice/hostSpeechSynthesizer.ts`) that drives the OS's built-in speech engine (Windows SAPI via PowerShell, macOS `say`, Linux `espeak-ng`) on-device when `atlasmind.voice.hostSpeechEnabled` is set; TTS backend priority is ElevenLabs → OS host engine → Web Speech API. For speech-to-text it owns a `LocalTranscriber` (`src/voice/localTranscriber.ts`) that runs a local `whisper-cli` on webview-captured WAV audio; the model (and, on Windows x64, the binary) are SHA-256-verified downloads provisioned on first use, and audio never leaves the machine. STT engine selection (`atlasmind.voice.sttEngine`) is `auto` | `webspeech` | `local`.
  - Creates `ProviderRegistry` and registers provider adapters, including the ACP subscription/license bridge. Gemini is advertised there only with the assigned Code Assist Standard/Enterprise entitlement it requires; a published ACP command is not treated as proof that a personal plan may use it.
   - Instantiates the `Orchestrator` with all services injected.
   - Bundles services into `AtlasMindContext`.
   - Calls `registerChatParticipant()`, `registerCommands()`, `registerTreeViews()`.
3. The `@atlas` chat participant and sidebar views are now available.

The AtlasMind sidebar now starts with a compact Quick Links webview row that sits under the container title and exposes icon-only shortcuts for the Project Dashboard, Ideation board, Run Center, Cost Dashboard, Model Providers, and Settings before the embedded Chat view and the collapsed operational tree views. The native Chat title bar separately uses its five visible action slots for Project Dashboard, Mission Control, Personality Profile, Website Studio, and Settings. Project Ideation, Cost Dashboard, and contextual project-memory maintenance remain in VS Code's overflow menu, preserving the five-inline-action ceiling while keeping the operator-profile and Web/UI workspaces one click away. Assistant transcript metadata now carries not only routed-model and thinking-summary details but also learned-from-friction timeline notes, which lets both the dedicated chat panel and the native sidebar chat surface when Atlas has shifted into direct recovery after operator frustration. Project-run offers are another validated metadata shape: interactive chat renders a **Start run / Save for later / Cancel** card, the host resolves each action once, and saving delegates preview creation to Project Run Center; Autopilot is the only mode allowed to auto-start. During an active request, the composer status also derives the current model from the host-provided `streamingModels` state and appends it to progress text; a failover updates that label without trusting model text supplied by the browser.

### AtlasMind Lens foundation

`LensTreeProvider` (`src/views/lensTreeView.ts`) owns the collapsed **Lens — Code Explorer** tree. It follows the active editor and calls `vscode.executeDocumentSymbolProvider`, so outline structure and ranges come from the language provider already installed for that file rather than from a model. The root target is created only for a file inside the open workspace; nested `DocumentSymbol` results retain their hierarchy, flat `SymbolInformation` results remain queryable, and selection opens the target's exact source range. A workspace-scoped symbol filter can retain all symbols or focus on types, callables, data, or containers. Filtering recursively retains an otherwise unmatched ancestor when a descendant matches, preserving the route through the outline. Editing, saving, changing the active editor, or changing the filter refreshes the tree. An absent editor, outside-workspace file, empty filter result, or language provider with no symbols is a named state rather than an empty view.

The shared `LensVisualTarget` types live in `src/types.ts`; `src/core/lensTarget.ts` is the target trust boundary. Version 2 accepts only target and evidence enums, bounded control-safe text, a live workspace-root identity (name plus zero-based folder index), positive ordered ranges, and normalized root-relative paths. Absolute paths and traversal are refused, and the target carries no source contents. Including root identity makes identical paths in different workspace folders distinct without disclosing either root URI. `atlasmind.lens.openTarget`, `atlasmind.lens.askTarget`, and `atlasmind.lens.moreTargetActions` revalidate the root name, root index, relative path, and selected URI before acting. Ask Atlas and the focused Explain, impact, and test-review actions then call the existing preferred-chat handoff with an editable draft and one-shot `contextPatch`; they never submit the draft. Merely revealing or filtering Lens invokes no model.

`LensLanguageGraphAdapter` (`src/views/lensLanguageGraph.ts`) is the first graph adapter. Starting from a symbol target, it queries VS Code's call-hierarchy and reference providers, labels each edge with the provider evidence, follows at most two outgoing-call levels, and returns partial results with notices when a provider is absent. Its output crosses `normalizeLensGraph` (`src/core/lensGraph.ts`), a versioned graph trust boundary that requires normalized node targets, valid endpoints, explicit relationship/evidence enums, a present root, and deterministic bounded records. A journey is capped at 80 nodes and 160 edges and marks itself truncated when a provider exceeds either budget. `possible`, `observed`, and `inferred` remain distinct graph modes; this adapter emits only `possible` and includes a notice that static relationships do not prove runtime execution.

`LensJourneyPanel` (`src/views/lensJourneyPanel.ts`) renders the normalized graph in an editor webview. Its CSP-protected HTML is static: graph labels and paths are posted only after a ready handshake and rendered through `textContent`, never interpolated into markup. Webview actions return only a bounded node id; the extension host resolves it against the retained normalized graph, re-resolves the workspace folder by name and index, and checks the root-relative path before source navigation or chat handoff. The panel supplies keyboard-operable buttons, high-contrast VS Code tokens, and a textual edge list equivalent to the visual graph. These constraints are the base for later runtime, schema-wiring, impact, test, data, state, configuration, and PR visualisations described in `project_memory/roadmap/atlasmind-lens.md`.

`analyzeLensCodeImpact` (`src/core/lensCodeImpact.ts`) is the first general change-impact projection. It accepts only a normalized Lens graph, then deterministically ranks direct upstream callers, other source references, and downstream callees by category and call depth. Each item becomes a source-anchored `relation` target whose detail and evidence explain why it is present. `LensImpactPanel` (`src/views/lensImpactPanel.ts`) renders those groups and an equivalent text list after the ready handshake; Open/Ask messages contain only a bounded id resolved from the host-held map, and source navigation revalidates the live workspace identity and path. This first slice is static and code-only: contracts, schemas, config, docs, tests, and runtime paths remain explicit unknowns, and absence never means zero impact. Opening the map invokes no model, runs no project code, and edits nothing.

`analyzeLensTestMap` (`src/core/lensTestMap.ts`) provides the first Test & Behaviour projection without inventing coverage. From the normalized language graph it retains only incoming callers and returned references whose workspace-relative path has an explicit test filename/folder signal, classifies unit/integration/contract/end-to-end only when the path names that kind, and otherwise keeps `unknown`. The path classification and the VS Code call/reference evidence remain separate fields. `LensTestPanel` (`src/views/lensTestPanel.ts`) posts normalized data after ready, groups linked sources with counts and a text equivalent, and resolves bounded ids in the host for exact Open/Ask. It does not execute tests, read coverage or assertions, infer pass/fail or behaviour, and an empty map remains missing evidence rather than an untested verdict.

`src/core/lensContract.ts` is the host-neutral contract/schema foundation. A versioned `LensContract` names its layer (`ui`, `api`, `validator`, `domain`, `persistence`, `database`, or `external`), declaration source (TypeScript, OpenAPI, JSON Schema, GraphQL, protobuf, validator, ORM, SQL, or manual), completeness, and bounded fields. Each field retains type, presence, nullability, evidence, and an optional normalized Lens source target. Contract normalization refuses malformed or duplicate field ids/paths as a whole: silently dropping one malformed field could create a false dropped-wire finding later.

`reviewLensContractWiring` compares two adjacent named contracts. An exact path with complete compatible shape evidence becomes `exact`; declared shape disagreement becomes `incompatible`; missing shape or link evidence remains `unverified`. It never derives `dropped` or `introduced` from absence alone. Those states, along with equivalence, rename, transform, and inference, require an explicit rule in `.atlasmind/lens-mappings.json`. Each rule names both its upstream and downstream contract boundary, preventing a drop between API and persistence from leaking into unrelated layer comparisons. Suppressions annotate matching wires but do not erase them from review output. `schemas/lens-mappings.schema.json` is contributed through VS Code `jsonValidation`, while the same bounded normalizer remains the runtime trust boundary. This foundation reads declarations only; it does not connect to a live database or edit project contracts.

`src/core/lensContractSources.ts` supplies the first declaration adapters. Strict JSON parsing supports OpenAPI 3 `components.schemas`, JSON Schema root objects, and `$defs`/`definitions`; it retains base type and optional format separately so a database that lacks format evidence is unverified rather than falsely incompatible. The SQL adapter reads a conservative subset of `CREATE TABLE`, handles nested type parentheses and table constraints, canonicalizes common scalar type families, attaches line-backed targets to columns, and emits exact clause-backed relations for inline `REFERENCES` and single-column table `FOREIGN KEY`. The TypeScript adapter masks comments and string/template contents, then reads top-level interfaces and object type aliases with field locations, optional/null unions, scalars, arrays, literal enums, named references, functions, and object records. SQL and TypeScript always declare `partial` coverage and a heuristic/syntax-only notice. All adapters refuse invalid workspace-relative locations and sources over 2 MB, cap contracts/fields, and never execute input; composite/dialect-specific keys and TypeScript imports, inheritance, mapped types, decorators, initializers, and runtime validators remain unresolved.

`reviewWorkspaceContractWiring` (`src/views/lensContractReviewCommand.ts`) is the explicit entry point. It scans at most 200 candidate files whose names identify schema/contract/OpenAPI/Swagger JSON, SQL sources, or TypeScript DTO/model/schema/type/entity/contract/interface/request/response declarations, retains at most 200 contracts, offers only ordered pairs from the same live workspace root, and loads the mapping file from that root. Missing mapping files mean no explicit rules; malformed or unreadable files stop visibly. `LensContractReviewPanel` then recomputes the review from normalized contracts/mappings and posts the bounded snapshot after a ready handshake. Its filterable table uses DOM text nodes, keeps suppressions and notices visible, and exposes Open/Ask actions only where a host-held source target exists. Wire questions become normalized `relation` targets anchored to one of their declared source fields; webview messages never provide a path or prompt.

`analyzeLensContractDrift` (`src/core/lensContractDrift.ts`) is a bounded, deterministic projection of that normalized wiring review. It emits no finding for exact wires; incompatible shapes become definite conflicts; a missing endpoint named by an explicit mapping becomes a dead wire; deliberate transformations, introductions, and drops remain visible informational records; inference/non-intentional transforms become likely drift; and non-intentional introductions become undocumented wires. Ordinary unmatched fields stay informational missing evidence. Suppressed findings remain in the report but are excluded from active severity totals. The Field Wiring panel renders these summaries/classes and attaches a finding's class, severity, and reason to the existing host-resolved relation target when the user prepares an Ask draft.

`analyzeLensSchemaChangeImpact` (`src/core/lensSchemaImpact.ts`) takes one host-resolved field plus a proposed rename/remove/type/format/presence/nullability change. It re-normalizes the selected contracts, verifies the review boundary and seed id, follows only wires already present in that review, then ranks at most 80 field, mapping, compatibility/serialization, validation, migration, and deployment items. Direct endpoints retain wire evidence; wider risk rules are explicitly inferred. Its notices state that the scope is the selected pair and that callers, tests, runtime traces, migration history, and deployment state remain unknown. `LensContractReviewPanel` asks for the change kind in a host quick pick, sends only the recomputed report to the webview, and resolves bounded impact-item ids for Open/Ask actions. It does not mutate contracts, mappings, migrations, tests, or deployment configuration.

`src/core/lensContractRelations.ts` normalizes at most 500 relation records and resolves an endpoint only when one same-workspace discovered contract and one field match its declared table/field labels. Ambiguous or absent endpoints retain labels without invented ids. `reviewWorkspaceContractWiring` aggregates these declaration records after discovery, and `LensContractReviewPanel` filters them to relations touching either selected boundary. The Relationship Map uses DOM text rendering and bounded relation ids; host-held source targets open or enrich an Ask draft. Schema change-impact analysis adds any relation whose resolved field id touches the seed, retaining declared relation evidence. This is declaration topology, not proof that application code traverses the relation at runtime.

`src/core/lensDataTrust.ts` integrates the first Data Journey and Trust slice with that same normalized field/wire model. `.atlasmind/lens-data-trust.json` declares bounded exact `(contractId, fieldPath)` rules with public/internal/confidential/restricted classification and zero or more consent, authorization, redaction, encryption, retention, and residency controls; duplicate endpoints or malformed/control-unsafe metadata fail the whole file. `analyzeLensDataTrust` follows only the selected field and resolved normalized wire endpoints, returning declared or unknown items without inspecting names/values. Field Wiring renders the map after an explicit **Review trust** action and resolves Open/Ask through host-held ids. A declaration is repository policy evidence—not runtime verification—and no data values, secrets, database contents, traffic, or telemetry are read.

### Lens — live services

The three live lenses are the only part of Lens that leaves the repository, and the boundary is deliberately different in kind rather than a relaxation of the existing one. Every module below is written around a single rule: **the shape is read, the rows never are.**

`src/core/lensEndpoints.ts` normalizes `.atlasmind/lens-endpoints.json` — a committed file, so a change to what AtlasMind may reach arrives as a diff with a reviewer rather than as a setting somebody flipped. Four rules carry the semantics. The file **names** a secret via `secretRef` and never holds one: an endpoint carrying a credential-shaped key refuses the *whole document*, because a silently-scrubbed file would leave the secret on disk while reporting success. It says **where**, never **what to send** — there is no method, query, or body field, so the safety rule is not editable by the thing it constrains. An **unstated stage is production**: `stage` defaults to `unknown` and `isProtectedLensEndpoint` treats `unknown` exactly as `production`, since guessing downward moves the gate off the one environment it exists for. And plaintext `http` is accepted only on the loopback (a probe may carry a bearer token) while private-range `https` is allowed, because a staging API on the office network is the ordinary case and the destination came from a reviewed file rather than from attacker-controlled input — the distinction `ardClient`'s stricter SSRF screen is drawing. One malformed endpoint is reported with a reason rather than dropping the file, so a mistyped URL cannot silently disable every other declaration.

`src/core/lensProbePolicy.ts` decides whether a probe may run, separately from the code that performs it, and returns a value naming the rule it applied — which is what lets a test walk the policy rather than argue about it. `buildProbeRequest` composes every component except the destination from constants in that file: `GET` for OpenAPI, one fixed `GRAPHQL_INTROSPECTION_QUERY` `POST`, and for a database a *named* schema-reading MCP tool with empty arguments. No function accepts a query, so there is no path by which a caller, a webview, or a model reaches `SELECT * FROM users`; a test asserts no request the module can produce carries a write verb. MCP tools are matched on a short declared verb list against the tool-name segment of `mcp:<server>:<tool>` — never on description prose, which is marketing that changes between versions — and a tool carrying a forbidden verb is disqualified first, so `create_schema` is never selected as a way to read one. `query`, `execute` and `run` are deliberately excluded: a generic query tool *could* read `information_schema`, but AtlasMind would then be composing SQL, which is the one thing this module exists to make impossible. Two gates deny by default (`atlasmind.lens.live.enabled`, plus the per-run confirmation), and a protected stage requires the operator to type the endpoint's own label, mirroring `promotionRunner`. Rules are evaluated root-cause first, so nobody is asked to confirm a production probe while the feature is switched off.

`src/core/lensServedContract.ts` is the untrusted boundary, and it is untrusted twice: the response is third-party text, and it comes from a system holding real records. Nothing throws, everything is bounded, control characters are stripped. The output is `LensContract`, which has nowhere to put a row — that is the enforcement, not the comment. OpenAPI `example`, `examples`, `default`, `enum` and `const` are read and **discarded by name** (`DISCARDED_VALUE_KEYS`) rather than merely ignored, because they are the keys most likely to hold a real customer record and a derivation that swept unknown keys along would eventually carry one. It emits **one contract per served schema or table with bare field paths**, mirroring `extractJsonContractSources`/`extractSqlContractSources` exactly: the two sides of a drift comparison must be built the same way or every field mismatches on its name alone and a healthy service reads as a total schema failure. A budget hit yields `coverage: 'partial'` and a stated remainder; a response that parses but declares nothing usable returns `undefined` rather than an empty contract, since an empty contract compared against a declared one reports every field as missing. Evidence is always `runtime`.

`src/core/lensLiveDrift.ts` compares one declared contract against the served set. `absent-remotely` (declared, not served — a dead end and a schema failure at once) is kept separate from `undeclared-remotely` (served, not declared) because the two need opposite fixes. A **partial reading reports nothing as absent**, since "declared but not served" is then indistinguishable from "declared and past the cap" — a budget must not manufacture schema failures. A declared contract with no served counterpart by name is an `unmatched` *pairing*, reported with the labels on both sides, never as several hundred missing fields: differing naming conventions are far more common than a vanished schema. Matching is exact, then case-insensitive, and every finding produced by the fallback says so. Only a *narrowing* of nullability or presence is reported; a service stricter than its declaration breaks nothing currently running. `typesAgree` treats `unknown` on either side as missing evidence and does not equate `varchar` with `string` — a false "these agree" is worse here than a visible finding somebody dismisses.

`src/core/lensReachability.ts` answers the prior question: which declared services answered. `unassessed` is never merged into `unreachable` — "nobody looked" and "we looked and nothing was there" are different facts, and merging them lights up every endpoint as a dead end on a laptop that is offline. `refused` and `unauthorized` stay distinct too: reporting a production endpoint you declined to confirm as unreachable would be a lie about somebody else's infrastructure, and both are counted as unassessed rather than as failures because nothing was learned either way. An endpoint whose `expectedContractIds` name a contract the repository no longer has carries them as `danglingContractIds` — a dead end pointing the other way. An empty map says nothing was declared and names the file to write, rather than showing a clean green nothing.

`src/core/lensLiveTrust.ts` checks the fields a service actually serves against `.atlasmind/lens-data-trust.json`. `served-undeclared` is the finding it exists for: unknown sensitivity on real, live data, which `lensDataTrust` cannot see because the field was never in a repository file. Unknown is never public, and **a classification is never inferred from a field name** — a fabricated rating closes the gap without closing it, and in a git-tracked file a later reader cannot distinguish it from a decision. As in the drift lens, a partial reading produces no `declared-absent`.

`src/core/lensProbeRunner.ts` runs one probe with every dependency injected, so the property that matters is checkable: **an unauthorized probe never reaches the network.** Authorization runs first and returns before the transport is in scope; a test hands it a transport that fails the run if called. The secret resolver is invoked only after authorization passes, its result goes straight into an `Authorization` header, and no field on `LensProbeResult` could hold it. A non-2xx is classified before the body is looked at — deriving a contract from a 500 page would yield an empty schema and, through the drift lens, a report that every declared field is missing. A failed call is *recorded*, and `hasBeenProbed` counts only a `reached` run, so the attempt stays visible while the endpoint still reads as never assessed.

`src/core/lensDatabaseDialect.ts` holds **every SQL statement AtlasMind can send**, and it is the honest replacement for the "AtlasMind will not compose SQL" refusal the MCP path states: **AtlasMind never *composes* SQL, it sends a *constant*.** Each statement is a module-level `const` with no interpolation, no parameters, and no function anywhere that accepts a fragment — the same guarantee `GRAPHQL_INTROSPECTION_QUERY` already carried, enforced by a test that walks every export and fails on a write verb (word-boundary matched, so `last_analyze` does not trip it), a placeholder, or a second statement. The MCP refusal is unaffected and stands on its own reasoning. `READ_ONLY_PREAMBLE` opens `BEGIN READ ONLY` with a statement timeout **before** anything else and is not optional: a server too old to support it fails the probe rather than getting one that runs unguarded. Row estimates come from `pg_class.reltuples` and `information_schema.tables.TABLE_ROWS`, never `COUNT(*)` over a user table — a count returns a number but reads every row to produce it, and a test asserts every aggregate in the file reads a *catalog* relation rather than banning the word. `EXPLAIN` is sent without `ANALYZE`, because a probe that executes whatever it explains is a shape nobody should build.

`src/core/lensCredentials.ts` is the reason a confirmation dialog can name a database host without that being a leak. It parses a stored connection string into `LensConnectionSummary` — host, port, database, user, TLS mode — a type with **no field that could hold the password**, which is the enforcement; a test asserts a summary of a DSN with a password shares no substring with it. The username *is* carried, because a role name makes "is this the read-only user?" answerable at the gate and a username is not a credential. A parse failure yields no detail at all, since the only detail available is the string itself. `lensSecretKey` namespaces every `secretRef` under `atlasmind.lens.endpoint.` and refuses anything that is not a plain identifier — without that, a committed file naming `atlasmind.anthropic.apiKey` would make AtlasMind put a provider key in an `Authorization` header aimed at a host that same file chose. TLS is reported as found and never silently upgraded; an absent or unrecognised mode is `unstated`, because guessing in the reassuring direction is the one guess worth refusing.

`src/core/lensDatabaseReading.ts` turns catalog rows into contracts and health, keeping `lensServedContract`'s boundary exactly — untrusted input, nothing throws, everything bounded, and output types with nowhere to put a row. One contract per table with bare column paths, mirroring `extractSqlContractSources`. Its load-bearing rule is that **a never-analyzed table reports unknown, not zero**: `reltuples = -1` and a null `TABLE_ROWS` both become `undefined`, `rowEstimate` is optional rather than defaulted, and the panel prints *unknown (never analyzed)* — `0` would say "this table is empty" to somebody checking whether a migration ran. Each estimate carries `lastAnalyzedAt`, because a count from a table last analyzed in March is a fact about March, and the epoch sentinel the metrics query COALESCEs to is read as *never* rather than as 1970. `summarizeLatency` keeps the first sample apart from the rest and flags a suspected cold start only when a later sample set actually disagrees with it — one follow-up cannot distinguish a cold start from a transient stall.

`src/views/lensDatabaseTransport.ts` performs the direct probes. `pg` and `mysql2` are ordinary dependencies `import`ed on first use, the pattern `buzzSigner` uses for `@noble/secp256k1`, so a user who never probes a database pays nothing at activation and the web bundle is unchanged. The connection is closed in a `finally` on every path — one left open against a production pooler is a worse bug than anything it was looking for, and Neon bills connection time. Metrics, constraints and plans are best-effort: a role permitted to read `information_schema.columns` is not always permitted `pg_stat_user_tables`, and a partial answer beats none. `safeDriverMessage` scrubs anything URL- or `user:password@host`-shaped, because `pg` interpolates the connection target into several of its messages and output channels get pasted into issues. `src/views/lensCredentialCommand.ts` stores the string through a password-style box, **validated by parsing rather than by connecting** — a stray keystroke must not open a socket to whatever host the typo produced — and shows the parsed summary back, which is the check that catches a production string pasted into the staging endpoint.

`src/views/lensLiveTransport.ts` performs what it is handed. Redirects are **not followed** (`redirect: 'manual'`): a redirect is the server nominating a destination nobody reviewed, with the token still attached. The response is capped **while** it is read, since a cap checked after `await response.text()` has already admitted the body it exists to refuse, and exceeding it returns `undefined` rather than a truncated string — half a JSON document parses as nothing and would be misreported as an unreadable schema. Errors are reported by message only; the request never enters a diagnostic. `src/views/lensLiveCommand.ts` owns the operator-facing gate: the endpoint list is re-read from the file on every run (a stale list would reach a destination no longer declared), the confirmation shows the destination separately from the label so a mislabelled entry cannot disguise where the request goes, and every outcome including "you did not confirm" is surfaced. Probe results live **in memory for the session only** — `project_memory/` is git-tracked, and one developer's environment is not the repository's.

`src/core/lensStateMachine.ts` is the first State and Lifecycle adapter. It strictly normalizes bounded `.atlasmind/lens-state.json` machines, rejects duplicate ids, dangling transition endpoints, traversal paths, malformed ranges, and oversized records, then derives minimum declared transition depth, unreachable states, terminal states, and non-terminal dead ends without evaluating application code. `reviewWorkspaceStateLifecycle` chooses the workspace root and machine explicitly; `LensStatePanel` renders depth columns plus a transition list after its ready handshake. Open/Ask messages carry only a host-held state/transition id and navigation revalidates root identity and path. Events, guards, and effects are labels from the repository model—not observed execution—and runtime comparison remains unavailable until an evidence adapter exists.

`src/core/lensConfigResolution.ts` provides the first Configuration Resolution adapter from explicit `.atlasmind/lens-config.json` metadata. Each bounded setting declares a unique precedence chain spanning defaults, config files, environment, workspace/user settings, feature flags, and runtime overrides. The core selects the highest applying source, labels lower applying sources shadowed, retains inactive sources, and rejects duplicate ids/keys/precedence, unsafe anchors, and malformed values. A display-policy setting may carry bounded control-safe scalar metadata; a masked setting cannot contain values and retains only declared presence. `LensConfigPanel` posts the normalized map after ready and renders a low-to-high chain plus text summary. Host-held Open/Ask targets include kind, precedence, and status but no value. This slice does not read live environment/runtime/remote flags/SecretStorage, so its result is declared intent rather than process verification.

`src/core/lensDeclarations.ts` is the shared read-only status layer for the declaration-backed views. It reports each exact root-relative file as missing, a valid empty starter, ready, invalid, unreadable, or unavailable and supplies only semantics-free `{ version, collection: [] }` starter content. It covers all five declaration files, and the load-bearing field is `required`: `lens-state.json` and `lens-config.json` are gates that a lens refuses to open without, while `lens-mappings.json`, `lens-data-trust.json` and `lens-endpoints.json` are refinements — the last of those deliberately optional, since a project that declines to point AtlasMind at its production database must not be told it is half configured. `readyCount`/`totalCount` therefore count the **required** pair only — those feed a stat card that turns green on equality, and a project that has declared its state machines and its configuration precedence must not be reported as half-finished because it never wrote an optional override. `optionalReadyCount`/`optionalTotalCount` report the refinements separately. Each row also carries a `purpose` line, so the QuickPick, the walkthrough, the guide panel, and the drafting prompt cannot write four drifting descriptions of one file. `src/views/lensDeclarationSetup.ts` owns the installed setup command and the create boundary: disk-backed local and remote extension hosts use an exclusive `wx` write, so an existing file wins even if it appears after status collection, and unsupported virtual storage fails rather than weakening create-only behavior. The same command is reached from Getting Started, Settings → Project Runs, Project Dashboard Overview, and the State/Configuration missing-file notifications. Settings and Dashboard recompute status without creating anything merely because a panel rendered.

`src/core/lensDeclarationPlan.ts` is the guided procedure for writing those files, built on `setupWalkthrough.ts` so it inherits both properties that module enforces — a plan is never an installer, and a step blocked only by an optional prerequisite is never nominated. It adds three. Required and optional are different questions: both refinements are `optional` steps, which `summarizeSetupProgress` excludes from the count, though an optional file that is *broken* is still reported `todo`, because "optional" describes absence rather than errors. A broken declaration is ordered **before** an absent one, matching `LENS_RULES` rather than inventing a second ordering, since somebody mid-task and stuck should not be sent to a different file first. And the plan describes without drafting: every step derives from the inspected file status, so the guide renders identically with no model configured. `LENS_DECLARATION_EXAMPLES` holds one worked example per kind, deliberately from a generic domain rather than from this repository — an example drawn from AtlasMind would be read as the answer by anybody working on something else. A test runs each example through its own normalizer, so the guide can never show a shape the lens would refuse.

`src/core/lensDeclarationDraft.ts` is the "Ask Atlas" boundary, and every rule in it exists because `.atlasmind/*.json` is committed, the declarations anchor into source files, and one of them describes where configuration values come from. A draft that fails the same normalizer the lens reads the file with is **refused whole rather than repaired** — repairing would mean AtlasMind inventing the parts the model got wrong, arriving in a shape that looks derived from the repository. Every `source.workspacePath` is **checked against the filesystem and dropped if it does not resolve**, because a plausible path renders, draws, and leads nowhere; traversal and absolute paths are rejected before they can become a filesystem probe, and the predicate is injected so the rule is unit-testable. A value matching a known credential shape is **withheld from the document**, not masked at render time, since masking on screen would still put the secret in the commit — and because the config normalizer requires `display` sources to carry a value and `masked` sources to carry `present` instead, withholding a value and masking a setting are one operation rather than two. A secret-shaped key, a credential-shaped value, or an absent value policy each force `masked`; `present` is then derived from what the source actually had, never invented. Scrubbing runs **before** normalizing so it can only remove, never rescue a bad document. Drafts are capped at `LENS_DRAFT_MAX_ENTRIES` for reviewability with the cap stated, `version` is stamped rather than trusted, and `mergeLensDeclarationDraft` gives **existing entries every id collision** — silently replacing hand-written work would be invisible in a diff full of additions.

`LensDeclarationGuidePanel` (`src/views/lensDeclarationGuidePanel.ts`) is the surface for both. Three host-side rules follow from it being the one Lens panel that writes to a tracked repository file. The webview **names a declaration kind and never a path**: messages carry one of four known kinds and the host derives the path from the declaration table. The **draft never round-trips through the webview** — an accepted proposal is held in host memory between review and write, because posting the JSON out and taking it back on accept would make every check in `lensDeclarationDraft.ts` advisory. And the starter is create-only (`wx`) while the draft write is gated on a `{modal:true}` confirmation naming the file and the exact counts, re-merged against what is on disk at that moment rather than against what was read when the draft returned. The kind switcher is a pressed-state button group rather than a tablist, since the content is host-rendered and there are no tabpanels to own.

`src/core/lensChangeStory.ts` projects committed local or cached-remote Git evidence. `reviewWorkspaceChangeStory` requires the selected workspace folder to equal the repository root, accepts only bounded Git-reported head/base refs, resolves the merge-base, and invokes fixed read-only Git argument arrays through `execFile`—never a shell. NUL-delimited commits and paths are bounded and normalized before `buildLensChangeStory` groups changed components and path-signalled categories. `LensChangeStoryPanel` renders after ready and returns only host-held ids. On **Ask Atlas**, the host re-resolves the id, reads a bounded patch and small-file content from the exact selected head ref, and places that evidence in a one-shot context patch; a read failure opens no draft. `Orchestrator.buildMessages()` validates and serializes that patch into a model-visible user message, while `processTaskWithAgent()` clears workspace skills and per-request ACP delegated authority for the turn. The model therefore discusses the supplied committed evidence without shelling out against the checked-out branch. Dirty worktree state remains named but excluded; PR/issues/reviews, CI/checks, network, runtime, and semantic impact remain outside this slice.

`src/core/lensDashboard.ts` is the catalog every Lens surface is described by, and the model behind the Atlas Lenses dashboard. It is pure: `buildLensDashboard` takes observed inputs — workspace name, the active editor's target, the declaration snapshot, Git state, a contract-candidate count — and returns the eight lens cards, the flow map, and the ranked suggested actions, so the page can be tested without a webview and cannot drift from what it claims. Four rules carry the semantics. Every input is optional and **absent means not assessed**, never empty, so a lens whose evidence was never inspected reads `unknown` and raises its own action rather than contributing to a quiet page. Every readiness verdict and every action **names the declared rule** that produced it, and `LENS_RULES` is published on the page. Ranking is by **consequence, not count**: the rule table's declaration order is the ranking (a lens that cannot open outranks one waiting for a selection), catalog order breaks ties, and rules describing a whole-workspace fact collapse to one action rather than repeating per lens. The action band is capped and **states its remainder**. `buildLensFlowMap` places every lens between the evidence it reads and the question it answers and marks each edge `live`, `declared` (never assessed), or `absent` (assessed and not there), which is what the dashboard draws its curves between.

`LensDashboardPanel` (`src/views/lensDashboardPanel.ts`) renders that model. The webview posts a bounded lens id or action id and never a command: `findLensCatalogEntry` resolves the id against the catalog and the host executes the command *that entry* names, so no surface can reach a command the dashboard did not already offer. A lens that starts from a symbol routes to the Code Explorer instead of opening the wrong thing. `collectLensDashboardInput` is read-only — it inspects the two declaration files, and asks Git for the branch through a fixed `execFile` argument array with no shell — and creates nothing merely because a panel rendered. Contract candidates are deliberately left unassessed: that scan reads up to 200 files, and running it to draw a summary would make opening the dashboard the most expensive action in the feature, so the card says it was not assessed and offers to assess it.

`src/views/lensVisuals.ts` is the shared design system for all eight Lens surfaces, which previously carried eight copies of a header and six variations on a card. `LENS_BASE_CSS` owns the tokens, header, cards, badges, notices, empty states, and buttons, with an accent map keyed on `data-accent` so the core can name a colour family without knowing a hex value. `LENS_FLOW_CSS`/`LENS_FLOW_SCRIPT` draw flowing links between two DOM elements from live `getBoundingClientRect` geometry — surviving wrapping, scrolling, and resizing — with hover and focus highlighting that dims unrelated nodes, a vertical mode for stages that stack, and dash animation only on a highlighted edge and only under `prefers-reduced-motion: no-preference`. `LENS_INFO_CSS`/`LENS_INFO_SCRIPT` and `renderLensInfo` provide the ⓘ affordance: a keyboard-reachable, `aria-expanded`-labelled, Escape-dismissable button that also carries a hover `title`, sharing one repositioned popover element so a re-render cannot strand an open one. Author text is escaped through `escapeHtml`; the dynamic path sets `textContent`. `renderLensHeader` requires its evidence-mode badge rather than defaulting it, because "Static evidence", "Declared model", and "Committed Git evidence" are different promises. A test reads all eight panel sources and fails if one stops using the module.

AtlasMind's Voice panel is currently a webview-first specialist surface. It uses the Web Speech API for in-panel STT and fallback TTS, can route optional ElevenLabs audio through a selectable HTML audio sink when the runtime supports it, and stores preferred microphone and speaker ids for future native backends. There is not yet a host-side OS-native speech adapter.

## Agent-side ACP endpoint

`src/cli/acpAgent.ts` exposes AtlasMind itself as a local ACP v1 agent over newline-delimited JSON on stdin/stdout. This is the inverse of the routed ACP provider adapter: instead of AtlasMind driving Claude/Codex/etc., an ACP client such as Buzz drives AtlasMind's shared headless runtime.

`src/acp/atlasMindAcpAgent.ts` owns ACP sessions, bounded transcript context, streamed message chunks, cancellation, and the permission broker. A session must use an absolute directory inside the configured workspace; client-declared additional directories are validated against the same boundary. Client-supplied MCP server commands are not launched. The core orchestrator has one shared execution context, so the endpoint permits one prompt turn at a time rather than racing two sessions through it.

Risky tool calls cross back to the ACP client through `session/request_permission`. The broker offers only `allow_once` and `reject_once`, ignores `allow_always`, redacts and bounds tool arguments, and denies if the prompt/permission context has disappeared. Read-only tools retain the normal headless policy.

For Buzz, `src/acp/buzzReplyPublisher.ts` is the reciprocal delivery seam. Buzz's `buzz-acp` remains the harness and supplies generated channel/event context. AtlasMind parses only that generated context, requires a channel UUID and one reply event that also appears in generated metadata, then passes the final answer to the existing communication-only `BuzzCliBridge`. The model never receives Buzz shell, file-edit, repository, workflow, or admin tools.

The VS Code host creates `atlasmind-acp` launch shims beside the normal CLI shim. Buzz cannot launch a Windows `.cmd` shim directly as an ACP child, so the copied recipe instead invokes a stable JavaScript runner through the VS Code Electron executable with `ELECTRON_RUN_AS_NODE=1`; no `cmd.exe` is involved. **AtlasMind: Copy Buzz ACP Agent Setup** copies that workspace-specific, credential-free recipe; it does not edit Buzz state or export SecretStorage values.

## Core Services

### Orchestrator (`src/core/orchestrator.ts`)

Central coordinator. Receives a `TaskRequest` and:
1. Selects the best agent via `AgentRegistry`.
2. Gathers relevant memory slices via `MemoryManager.queryRelevant()`.
3. Resolves the agent's enabled skill eligibility pool, reads the project's declared delivery vocabulary (`ProjectVocabulary`), and narrows the pool for the current request — at most 12 tools for `task-scoped` agents and at most 24 for any policy.
4. Builds a task profile via `TaskProfiler`, including whether the selected turn needs tool execution.
5. Picks a model via `ModelRouter.selectModel()`.
6. Builds callable schemas, accounting for their tokens in prompt budgets, while omitting the former duplicate skills prose.
7. Composes immutable guardrails, the portable operating contract, the selected role prompt, and the shared plus agent-specific execution rubric.
8. Builds a context bundle and dispatches execution, enforcing incomplete-delivery and verification gates.
9. Records cost and an evidence-backed execution-quality outcome via `CostTracker` and `ModelRouter`.

Host-specific settings enter through `OrchestratorHooks.readSetting`. The VS Code host supplies a configuration reader; CLI and ACP hosts receive safe defaults. This keeps the core importable without loading the `vscode` module in a headless process.

Tool-backed ACP execution is a separate execution shape, not an emulation of AtlasMind function calling. When the live `atlasmind.acp.toolsEnabled` setting is true, the Orchestrator adds `RoutingConstraints.allowDelegatedToolExecution`; the router may then admit an ACP `ModelInfo` that declares `delegatedToolExecution`. If that ACP model is selected, the Orchestrator passes an empty AtlasMind tool-schema list and stamps that exact provider request with `allowDelegatedToolExecution: true`. The adapter requires both the global setting and this request authority; missing request authority means isolated completion-only execution with no shared MCP servers or permission policy. Every readable native operation still returns through `AcpPermission`, where the live setting automatically authorizes only an `allow_once` response and the action is logged; a non-ACP failover receives the original AtlasMind tool definitions again.

Execution is bounded across all routing paths, but **escalation and failover draw on separate budgets**. Failover — what keeps a turn alive when an endpoint dies — has `MAX_TASK_FAILOVER_ATTEMPTS` (3); escalation — the discretionary upgrade when an answer was merely not good enough — stays at one; `MAX_TASK_MODEL_ATTEMPTS` (5) is a spend backstop across every path rather than the operative policy. One shared counter previously let an escalation consume the budget an outage would need, leaving a single attempt to survive a provider failure. When a turn does stop, the message names the limit actually reached — failover budget, absolute ceiling, or simply no other configured provider — because reporting a ceiling that was never hit sends the reader to raise the wrong limit.

Failures open a circuit keyed to the real execution endpoint (`acp:<agent>`, `local:<endpoint>`, or provider), not merely the displayed model id, so cosmetic model/effort variants cannot relaunch the same unhealthy process. Two classes of failure open it: transport wording (timeout, socket, connection, fetch failed…) for any provider, and **a JSON-RPC error code from a stdio provider** — for an agent on the other end of a pipe the transport *is* the process, and `-32603 Internal error` names none of the transport words, so a sibling model on the same subprocess used to stay eligible and the next attempt re-entered the process that had just failed. This is deliberately not extended to HTTP providers, where one 500 is one endpoint of many behind a load balancer.

**Both the escalation and failover paths consult that circuit.** `selectEscalatedModel()` takes `attemptedModels` and `blockedEndpointScopes` exactly as `selectProviderFailoverModel()` does; without them an escalation asked the router a question with no memory of the turn it was in, and could route straight back into an endpoint the turn had already watched fail.

Endpoint health also **survives the turn**. Two hard failures quarantine an endpoint for `ENDPOINT_QUARANTINE_TTL_MS` (10 minutes), so a crashed agent is not first pick on every subsequent message; a single completed attempt clears the record outright, since serving a turn is the only evidence that matters. The quarantine can never refuse a turn — if the quarantined endpoint is the only one that can serve the task, the block is lifted and the attempt is made. Records are in-memory: a dead subprocess is a fact about this editor session, and persisting it would outlive the restart that fixes it.

`TaskResult.modelAttempts` records only endpoints actually called; selection previews are not audit evidence.

Provider text is attempt-scoped. Each candidate stream is buffered privately and only the accepted final completion crosses the Chat callback. Diagnostics such as skills-context-budget warnings are emitted once through progress, while response sanitation collapses exact trailing loops and repeated long paragraphs outside code fences. This keeps abandoned model prose out of both the visible answer and stored transcript.

Explicit user constraints also become a `TurnCapabilityEnvelope`. “Read-only”, “do not edit”, and explicit broad prohibitions naming commands, terminal, shell, packages, scripts, or processes filter skill definitions before routing/prompt construction and are checked again immediately before execution. The broad object is mandatory: a narrow instruction not to release or deploy is governed by that operation's own policy and must not erase unrelated Git tools before their approval gate can run. Restricted turns cannot use delegated ACP native tools because AtlasMind cannot impose its per-turn schema ceiling inside that external agent.

Commit staging stays within one approval-gated `git-commit` invocation. The optional `paths` parameter accepts at most 100 exact workspace-relative tracked or untracked paths, rejects `.`, traversal, absolute paths, control characters and pathspec wildcards, calls `git add -- <paths>`, then uses `git commit --only -- <paths>`. The second path boundary matters when the index was already dirty: unrelated staged entries remain staged and do not enter the new commit. `paths` is mutually exclusive with the legacy `stage_tracked`/`git add -u` mode; a staging failure ends the skill without committing, and `toolPolicy` includes the exact-path count in the approval summary.

`AgentDefinition.skillPolicy` separates eligibility semantics from the skill IDs themselves. `task-scoped` is the safe default; an empty list admits built-ins only and custom/MCP skills must be named. `allowlist` preserves an exact enabled set, while `all` is the sole deliberate every-skill mode. The selector consumes explicit IDs, request intent, declared delivery vocabulary, and bounded session follow-through context, but it can only narrow the registry result and capability envelope. The selected schemas are the single model-facing capability description. Their serialized size participates in initial cost estimates, memory/session allocation, and every loop's completion headroom.

**The per-turn schema ceiling applies to every policy.** `MAX_TASK_SCOPED_SKILLS` (12) bounds `task-scoped` selection; `MAX_TURN_TOOL_SCHEMAS` (24) bounds the result of *any* policy. Previously only the first existed, so an `allowlist` agent sent its whole list and an `all` agent sent every enabled skill — including every connected MCP tool — on every query regardless of the question. That conflated authorization ("which skills may this agent use") with selection ("which schemas are worth this turn's context"). The second ceiling is an overflow guard rather than a selection policy: a pool at or under it is returned untouched, so a hand-written allowlist is unchanged; above it, skills are ranked by intent and unscored ones keep declared order rather than being sorted by id. A cap that bites is stated in the progress line — a silent truncation reads as "this is everything the agent has", which is the wrong thing to believe when the dropped tool was the one the model needed.

**Delivery intent is read from the project, not from a keyword table.** `selectTaskScopedSkills()` accepts a `ProjectVocabularySource` (see below). A promotion requires both a promotion verb and a declared stage, and selects the Git write set plus the tools a declared promotion sequence needs. Git integration flows (merge, rebase, cherry-pick, promotion) select the write tools as a **set** rather than per word, because "merge to main then publish" contains neither `commit` nor `push` and previously received only the read half of the Git group; `commit` and `push` keep their own per-word rules so a question about a commit does not hand over the ability to publish one.

**An escalating turn widens its tool set once.** A thin answer is frequently a model that was never given the tool it needed, which re-routing to a stronger model does not fix, so the escalated attempt re-selects within the same authorization ceiling up to `MAX_WIDENED_TASK_SCOPED_SKILLS` (18). Widening cannot exceed the eligibility pool, so it never grants a skill the agent does not already hold.

The operating contract and rubric are injected in `buildMessages()` rather than copied into built-in definitions. This closes prompt drift across hand-written specialists, custom agents, ephemeral project agents, synthesized agents, and persisted prompt overrides. Built-in role prompts therefore contain only specialist scope and boundaries; all 16 user-facing specialists add concise observable criteria through `completionCriteria.rubric`. Detailed SEO and UX checklists are progressively disclosed by `src/skills/specialistGuidance.ts` only when relevant, keeping volatile platform and standards details out of permanent prompts. `completionCriteria.incompletePatterns` is evaluated inside the agentic loop using a bounded restricted-regex policy before the existing one-time completion-integrity reprompt. Execution artifacts record failed tool-call count alongside tool count, verification, and TDD status so the router's outcome signal reflects observable delivery rather than only the provider finish reason. The agentic loop also recognizes explicit runtime claims that workspace tools are disabled or unavailable: instead of spending the remaining iterations re-prompting the same bridge, it marks that model's runtime capability as failed and immediately asks the provider-failover path for another `function_calling` model. If no recovery succeeds, the project classifier records the refusal as failed, never completed.

When the loop settles and *every* tool result in the final round tests as failed, a summary of those failures is **appended below** the model's completion. It replaced the completion until v0.310.3, and stamped `finishReason: 'error'` unconditionally; both were wrong in the same direction. The verdict comes from `classifyToolFailure`, which matches substrings — `failed`, `cannot`, `not found` — against **raw** tool output, and `file-read` returns file contents verbatim, so a read of an ordinary source file satisfied it; with a single tool call in the round the `every()` check is then trivially true. Measured on this repository, two of three ordinary files tripped it. The stamp propagates to `agents.recordOutcome` and `router.recordExecutionOutcome`, so a false positive permanently penalised an agent and model that had answered correctly — the one defect in this file that outlived its own turn.

Two properties now bound it. The undeclared-failure heuristic only judges results of **400 characters or fewer**: a failure a tool did not prefix is a sentence, and past that length the output is a payload whose vocabulary proves nothing. A **declared** prefix (`Error:`, a skill refusal, `Unknown tool:`, `Invalid arguments`) is start-anchored and classifies at any length, so a long stack trace under `Error:` is still a failure — the long-term direction is for tools to declare failure rather than have it inferred. And `finishReason: 'error'` is reserved for a turn that produced no text at all. Appending matches the verification-contradiction gate a few lines earlier, which already appends its caveat rather than replacing the claim: a claim of success and the evidence against it are both worth seeing. Because the summary no longer begins the response, `classifySubTaskFailure` locates it with `includes` rather than `startsWith`.

Each occurrence is still logged with the tools involved and which predicate fired, distinguishing a tool that declared its own failure from a bare substring or keyword match. Trigger tokens only are recorded, never tool output, which can carry secrets.

### AgentRegistry (`src/core/agentRegistry.ts`)

In-memory map of `AgentDefinition` objects. Supports `register()`, `unregister()`, `get()`, `listAgents()`, `listEnabledAgents()`, and persisted enable/disable state for operator toggles.

### SkillsRegistry (`src/core/skillsRegistry.ts`)

In-memory map of `SkillDefinition` objects. Also supports:
- `getSkillsForAgent()` — resolves an agent's enabled eligibility pool using `task-scoped`, `allowlist`, or `all` semantics. Missing legacy policies fail narrow: populated lists are allowlists; empty lists admit built-ins only.
- `enable(id)` / `disable(id)` — toggle availability; `enable` throws if the skill has a failed scan.
- `setScanResult(result)` / `getScanResult(id)` — store and retrieve security scan results.
- `setDisabledIds(ids)` / `getDisabledIds()` — bulk restore/persist disabled state.

### Skill Drafting (`src/core/skillDrafting.ts`)

Utility helpers that build the prompt for Atlas-generated custom skill drafts, normalize suggested skill IDs, and extract JavaScript source from provider responses before scanning/import.

### ModelRouter (`src/core/modelRouter.ts`)

Maintains a map of `ProviderConfig` objects plus provider health state. `selectModel()` accepts `RoutingConstraints`, an optional model whitelist, and an optional `TaskProfile`. It filters by required capabilities, task-profile gates, and provider health before scoring the remaining models using budget mode, speed mode, capability proxies, and task fit. `getModelInfo()` exposes pricing metadata for orchestration cost accounting.

`function_calling` normally remains a hard capability requirement. The one explicit alternative is delegated provider execution: `modelSatisfiesRequiredCapability()` accepts `ModelInfo.delegatedToolExecution` only when the same turn carries `RoutingConstraints.allowDelegatedToolExecution`. Discovery states capability; the live constraint states authority. Neither one is sufficient alone, so installing or discovering an ACP agent cannot silently make it eligible to act.

The router carries two learned, decaying routing channels (both gated by `feedbackRoutingWeight`): a positive **outcome bias** (EWMA of graded execution quality, in `executionOutcomes`) and a **struggle memory** (`struggleSignals`) — a persistent, task-signature-keyed de-weight for models that repeatedly fail a *kind* of task. Normal orchestrator grades incorporate expected tool use, tool success/failure counts, verification, TDD status, incomplete-delivery signals, and the final recovered response; clean text is no longer automatically a perfect execution outcome. The explicit Model Comparison harness intentionally retains its coarse completion-integrity grade and optional judge. `recordModelStruggle()` folds a severity-weighted, decaying increment (kinds: timeout, empty, tool-call-as-text, error-finish, user-correction) keyed by `phase|modality|reasoning|requiresTools`; `scoreModel()` subtracts the decayed penalty, and `selectBestModel()` applies a **tier-escape** (re-opening candidacy one budget tier higher and re-ranking) when the top pick is a chronic struggler, so a capable model can take over the task kind a cheap model keeps failing. `recoverModelStruggle()` halves the penalty on a clean turn; `getStruggleSignals()`/`setStruggleSignals()` snapshot/restore for persistence (`globalState` key `atlasmind.modelStruggleSignals`); `getStruggleSummary()` exposes active de-weights for the Model Comparison panel hint.

**Subscription quotas are used only when the provider exposes a trustworthy billing unit.** `setModelSubscriptionQuota()` / `getModelSubscriptionQuota()` / `listModelSubscriptionQuotas()` support an authoritative per-model allowance, while **`subscriptionQuotaForModel()` is the single accessor** used by pricing, scoring, and budget gating. Providers with one observable plan fall back to the provider-level quota unchanged. ACP is deliberately excluded: its protocol reports agents and models, not a subscription tier or remaining balance. AtlasMind stores an ACP plan label for display only and retires legacy guessed ACP quota records, so a stale manual count cannot suppress a working subscription.

Key behaviors added in 0.73.0–0.73.1:
- **Deprecation filter**: models with a `deprecatedAt` date in the past are auto-excluded from candidates.
- **Failure TTL**: stale failure records (older than 5 min) are cleared so transient errors don't permanently exclude providers.
- **Thinking-token cost scaling**: `effectiveCostPer1k` applies `thinkingTokenMultiplier` to output price for accurate extended-thinking model budgeting.
- **Smooth context gradients**: context-window score penalties in `scoreTaskFit` interpolate linearly rather than applying binary cliff penalties, so future large-context models are not penalised.
- **Outcome feedback loop**: `recordModelOutcome(modelId, success)` accumulates fractional preference votes from completed tasks, feeding real execution results back into future routing decisions.
- **Named scoring constants**: all previously undocumented magic numbers in `scoreModel`, `scorePreferenceBias`, and `scoreTaskFit` are extracted to named constants in `src/constants.ts`.

### ACP live-session host (`src/providers/acp.ts`)

The extension-scoped routed `AcpAdapter` is also the owner of reusable ACP conversations. A successful session remains alive for at most 30 idle minutes; temporary setup/probe adapters are explicitly one-shot so dropping a short-lived object cannot strand an authenticated agent. Reuse requires two independent proofs:

1. `acpHostPolicy.ts` compares the launch/security fingerprint — agent executable and argv, cwd, model/effort, MCP names, completion-only isolation, Windows launch mode, startup-settings stamp, exit state, and idle age.
2. The recorded client transcript must be an exact prefix of the new request. Only the unseen suffix is sent because the remote ACP session already holds the prefix. Edited history and branches create another session.

Identical concurrent completions join one in-flight prompt; successful identical retries are replayed for 15 seconds. An error after a prompt may have crossed stdio is never retried, and the uncertain session is discarded. The adapter holds at most four parallel conversations and closes them during extension deactivation.

ACP discovery declares `delegatedToolExecution` but deliberately never declares `function_calling`: the adapter cannot consume AtlasMind `ToolDefinition` schemas and refuses any request containing them. The host supplies a live `delegatedExecutionEnabled` getter independently of the MCP allowlist, while each `CompletionRequest` supplies the turn authority. Both must be true. That distinction matters because an ACP agent may have built-in tools while sharing zero MCP servers, and because a globally tools-enabled provider must still answer an explanation-only turn without acting. Completion-only turns share no MCP servers and receive no permission policy. Request authority, setting state, MCP names, and isolation all participate in the launch/coalescing fingerprint so incompatible live sessions cannot be reused.

`acpWindowsLauncher.ts` is the TypeScript integrity/selection boundary for the opt-in Windows private-mode path. It verifies the checked-in helper under `media/bin/`, then places the already-resolved executable behind it without introducing a shell. The auditable helper source is `native/acp-private-desktop/`: it creates an OS-named non-interactive window station using the creator token's default ACL, requests Windows' documented non-interactive access sets for that station and its `Default` desktop, verifies that the station is not `WinSta0`, and lets the child inherit the helper's established station/desktop connection instead of reopening generated UI-object names. It uses `STARTUPINFOEX`/`PROC_THREAD_ATTRIBUTE_HANDLE_LIST` to inherit only stdio, then creates the child suspended with `CREATE_NEW_CONSOLE` and `STARTF_USESHOWWINDOW`/`SW_HIDE`. That single hidden console is inherited by the complete ACP tree; the previous `CREATE_NO_WINDOW` root had no console to pass down, so a later CLI or PowerShell could allocate a separate visible `conhost.exe`. The supervisor assigns its kill-on-close Job Object before resuming the child, waits, and forwards the exit code. Inherited `SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX` error mode prevents a descendant loader failure from blocking Chat behind a modal system dialog. The helper never switches stations or desktops. The feature is off by default because application control or EDR may block an unsigned native helper; it remains a same-user window-placement control, not a sandbox.

The adapter exposes only aggregate live-session counts by launch mode to `extension.ts`; while any routed private-desktop session exists, the extension renders that count in VS Code's status bar and links it to **Models & Providers**. No process id, prompt text, or new capability crosses that boundary, and the indicator remains a disclosure of window placement rather than a security claim.

### SecretRedactor (`src/utils/secretRedactor.ts`)

Pattern-based secret scanner applied to memory context and live evidence before LLM dispatch. Covers Anthropic/OpenAI/GitHub keys, bearer tokens, PEM private keys, database connection strings, and generic key/secret assignments. `redactSecrets()` returns a `RedactionResult` with match count and matched pattern names; `redactSecretsWithWarning()` logs a console warning when any secrets are found. This is separate from `MemoryScanner`, which blocks writes to SSOT — the `SecretRedactor` protects the runtime dispatch boundary.

### DataPrivacyManager (`src/core/dataPrivacyManager.ts`)

Project-scoped data-privacy policy that ensures confidential, proprietary, or regulated content is only ever sent to user-selected **trusted** models. Classifies text (literal terms and regexes) and file/folder paths (traversal-safe globs), maintains the trusted-model allow-list, and redacts classified spans (`[CONFIDENTIAL]`) for un-trusted models via `redactForModel()`. **Deny-by-default**: an empty trusted list trusts nothing, so enabling the policy with no trusted model redacts classified content for every model until one is selected. The policy lives at `project_memory/operations/data-privacy.json` (`readDataPrivacyConfig`/`writeDataPrivacyConfig`); the live policy is reloaded on file change.

Built-in **compliance packs** (`src/core/compliancePacks.ts`) contribute curated regulated-data detectors when enabled — GDPR (personal data), HIPAA (PHI), PCI-DSS (cardholder data, Luhn-validated), CCPA/CPRA, and Financial (IBAN mod-97). These are heuristic aids, not a compliance certification.

**Detector precision is a safety property.** The detectors run over the whole assembled task context — source, logs, memory, chat history — so a pattern that fires on ordinary code silently restricts routing, redacts useful context, and floods the Privacy charts until the operator disables the policy entirely, at which point genuine regulated data is protected by nothing. Every detector is therefore anchored on a cue ordinary code does not contain (an explicit `phone:`/`SWIFT:` label, a `+` country code, a clinical construction) or paired with a validator that rejects the structurally impossible: `isPublicIpv4()` drops loopback/private/link-local/CGNAT/documentation/multicast ranges (which identify no subscriber and dominate bind configs and netmasks) and the pattern's lookbehinds drop four-part version strings; `isPersonalEmail()` drops role mailboxes (`noreply@`, `support@`, CI senders) and RFC 2606/6761 reserved domains. `tests/core/compliancePacks.test.ts` holds a benign source-repository corpus that must stay unclassified, plus the matching recall cases so tightening precision cannot silently blind a pack.

The context it classifies is enumerated by `buildPrivacyScanSlices()`, exported and unit-tested because that list *is* the boundary — inline it was unverifiable and had already drifted, omitting the structured session bundle. That mattered because the bundle and the raw session string are alternatives rather than complements: once a session has a `context.md` the chat panel sets the string to `''` and passes the bundle, so scanning only the string inspected nothing on the ordinary path while the model still received the conversation in full. Each bundle field is a separate slice labelled with the heading it renders under, so a notice can name where a detector fired.

Enforcement lives in the `Orchestrator`: `applyDataPrivacyGate()` classifies the assembled context before model selection; `buildMessages()` applies `privacyRedact()` to memory, live evidence, and supplemental context keyed on the actually-selected model (the fail-safe for pins/parallel overflow); and `redactToolResultForModel()` withholds `file-read` results for classified paths when the running model is un-trusted. When classified content is found but no trusted model is available, the content is redacted and the UI is notified via `OrchestratorHooks.onClassifiedContentForUntrustedModel`.

`buildSupplementalContextMessage()` splits supplemental context by a declared `SupplementalTrust` and emits **two** messages rather than one. Third-party content (attachments, fetched pages, tool output) keeps `UNTRUSTED_CONTEXT_PREAMBLE`; the conversation carries `CONVERSATION_CONTEXT_PREAMBLE`, which names it as the conversation being continued and states that it does not override system instructions. Both previously shared the untrusted preamble — and because `buildMessages()` emits system prompt, supplemental context and the current user message with no conversation-history array, prior turns existed *only* inside a block instructing the model to treat them as data it should not follow. A section the scanner **warns** on is routed to the external block whatever its declared trust, since that is precisely when conversation may be carrying injected content; blocked sections are still excluded entirely. The two blocks share one `supplementalChars` budget, so the split does not widen what is sent.

The gate's response is **tiered by sensitivity**, because it scans the assembled *context* rather than the user's request — a hit means something in the retrieved haystack looked regulated, not that the task concerns personal data. `selectHardGatingMatches()` (exported, pure, unit-tested) picks the `secret` matches — PCI cardholder data and HIPAA PHI — and only those restrict the agent's candidate models to the trusted allow-list. `confidential`/`proprietary` matches set `RoutingConstraints.requireTrustedModel` as a marker but leave routing alone: the redaction boundary already removes the matched spans before they reach an un-trusted model, so re-routing buys no extra protection while costing an unexplained model downgrade on every heuristic hit. The gate classifies each context slice separately so its progress notice can name *where* a detector fired (`"email address in memory \"Stakeholders\""`) — an unattributed hit is indistinguishable from a false positive.

The gate also records a **catch** (`recordCatch`) each time a rule/detector fires for a real task, capturing the source label and sensitivity (never the matched value) and whether the selected model was trusted. The activity log is persisted workspace-scoped and powers the Privacy dashboard charts (catches over time + per-detector breakdown). `src/core/providerDataGovernance.ts` is a static reference mapping each provider to its GDPR/data-subject request portal, privacy policy, DPA, retention summary, and default training stance, surfaced on the Privacy page for the providers hosting trusted models. The Privacy page renders the trusted-model allow-list as a collapsible provider→model tree limited to currently-active models.

### UI Studio workspace (`src/core/websiteWorkspaceManager.ts`)

Filesystem-only service behind **AtlasMind: Open UI Studio** (the stable command id remains
`atlasmind.openWebsiteStudio`). It owns the compatibility-named SSOT at
`project_memory/domain/website.json` and regenerates `website.md` on every save. The shared
`WebsiteWorkspaceConfig` types in `src/types.ts` model:

- an explicit `UiSurfaceKind` profile: website, web app, mobile app, desktop app, editor extension,
  embedded UI, or other;
- normalized client intake;
- page inventory with sitemap fields, section outline, design notes, and separate wireframe/UI/content/SEO review states;
- per-page sitemap placement (`parentId`, `order`), outbound `links`, a natural-language `designPrompt`, and a drawn `wireframe`;
- a revisioned `UiDesignGraph` whose stable screens/nodes, base layout, viewport overrides, typed tokens,
  reusable component definitions/instances, preview-only structured collections, explicit node bindings,
  validated asset metadata/assignments, and bounded content/style references are authoritative when present;
- project-level UI system decisions;
- project-level `UiContentDesign` rules and a `UiImplementationGuide` containing bounded technology,
  source-root, component-location, and handoff hints plus revisioned component/token/node repository mappings
  and bounded adapter capability/loss reports (data only, never commands or source content);
- the fixed Develop → Staging → Production hosting environments, including URL/branch references, locked access policy, secret reference, and promotion-protection metadata;
- a catalog of static, managed-CMS, commerce, and custom platform targets;
- n8n workflow maps containing event/outcome/status plus non-secret references.

`sanitizeWebsiteWorkspace()` is the untrusted-input boundary for both webview edits and imported client JSON. It caps text/list/page/workflow sizes, normalizes and deduplicates IDs, allow-lists statuses, platform IDs, HTTP(S) URLs, and six-digit hex colors, removes URL credentials/query/fragment values, enforces at most one primary platform, applies the shared secret redactor, and replaces n8n webhook-shaped URLs with a marker before disk persistence. It also rebuilds the three hosting environments from canonical server-side policy: Develop is loopback/local unless the explicit hosted fallback is selected (then password-protected), Staging is always hosted and password-protected, and Production is always hosted, public, and promotion-protected. Credential references require an explicit secret-provider prefix, so a raw password-like string does not survive sanitation. Both rendered SSOT files then pass `scanMemoryEntry`; error-level prompt-injection content aborts the write before either file is created. The schema intentionally has no API-key, password, bearer-token, or webhook-value field.

`assessWebsiteHostingEnvironments()` is a non-executing readiness evaluator. It requires HTTPS for hosted environments, restricts local Develop to loopback hosts, requires password references for hosted Develop and Staging, and verifies Staging's exact `<review-label>.<production-domain>` topology. It reports missing setup separately from blocking policy violations; it never deploys.

Guided bootstrap exposes **Website / Marketing Site**. `seedWebsiteWorkspace()` carries the captured project name, summary, audience, outcome, constraints, metrics, timing, budget, and inferred platform into the Studio, but refuses to overwrite an existing website plan. The same Studio can import a bounded JSON brief and normalize common form/CRM aliases.

The SSOT is at **format version 13**, registered in `schemaMigration.ts` as the `website` kind. `load()` routes through `interpretVersionedDocument`, so a file written by a newer AtlasMind is refused rather than replaced — the Studio opens read-only and says why. The 4 → 5 step marks existing projects as websites (the only surface v4 could represent) and seeds empty content-design and implementation-guidance records without inventing either. The 5 → 6 step transcribes every wireframe fact into the design graph, including untouched-versus-empty canvas state, without inventing viewport overrides, references, components, or states. The 6 → 7 step adds an empty typed-token collection without changing a graph fact or inferring a design system. The 7 → 8 step likewise adds only an empty component collection; it has no standing to infer definitions or instances. The 8 → 9 step changes only the version because optional node state copy must remain absent until authored. The 9 → 10 step adds an empty sample-data collection authority and invents no schema, record, value, or binding. The 10 → 11 step adds an empty asset library and does not inspect files, infer node assignments, or invent alt text. The 11 → 12 step adds mapping revision zero and an empty repository-mapping collection; it does not scan source, infer a path/symbol, parse code, or invent a relationship. The 12 → 13 step adds `lastImport: null` to each existing mapping and preserves its definition/baseline without inspecting source or inventing evidence. While existing readers migrate, `uiDesignGraph.ts` deterministically rebuilds their page wireframes from the graph.

`src/views/websiteStudioPanel.ts` is a profile-aware webview (Brief, Sitemap or Screens & Flows,
Content Design, UI System, Wireframe canvas, Full Preview, Implementation/website hosting, and
website-only n8n Automations). Its CSS lives in `websiteStudioStyles.ts` and its behaviour in
`media/websiteStudio.js`. Content messages carry a bounded screen id and text fields; the host resolves
the id against the current plan and `WebsiteContentManager` owns the path. The expected body implements
optimistic concurrency, so a disk edit is refused rather than overwritten. Other messages remain
data-only and cannot name a command, arbitrary path, or output file. Production publishing stays in
`PromotionRunner`; n8n triggering remains outside this planning surface.

### Website Studio design and generation modules

The Studio's pure core modules are `vscode`-free and unit-tested:

- **`uiDesignGraph.ts`** — sanitizes the target-independent v13 graph against the page inventory, preserves
  stable screen/node identity, clamps geometry and references, and derives the legacy wireframe projection.
  `initialized` keeps “never drawn” distinct from a deliberately empty screen. Graph precedence is explicit:
  a valid graph wins; there is no last-write-wins reconciliation between two design authorities.
  The same boundary validates at most 200 typed colour, typography, spacing, radius, shadow, motion, and
  breakpoint tokens. A token owns a bounded structured value or aliases another token of the same kind;
  `resolveUiDesignToken()` refuses missing targets, cross-kind links, and cycles while retaining the resolved
  source and alias chain. Tokens are graph facts rather than CSS declarations, so every output target reads
  the same system without becoming its authority. `websiteWireframePreview.ts` is the HTML adapter: a closed
  semantic-id map supplies colour, typography, spacing, radius and breakpoint roles to preview and canvas,
  while every resolved token receives a hex-encoded-id custom property that cannot collide or become syntax.
  The same boundary caps preview-only content collections, validates typed sample values, retains well-shaped
  stale node bindings for diagnostics, resolves declared title/body/action mappings, and reports missing
  collections, records, fields, values, and interface states at the owning node.
  It also validates at most 200 asset records: stable ids, closed media/crop kinds, positive intrinsic pixel
  dimensions, 0–100 focal percentages, explicit decorative/alt intent, maturity, and either a normalized
  workspace-relative path or credential/query/fragment-free HTTPS reference. Structurally valid stale node
  assignments remain visible to `diagnoseUiAssets()`; no source is fetched at this graph boundary.
  Component definitions remain target-independent structured data: a closed root kind, typed bounded
  properties, variants, capacity/kind-constrained slots, and declared states. `resolveUiComponentInstance()`
  applies definition defaults, variant values, then instance overrides while retaining provenance. Instance
  sanitation refuses a missing/incompatible definition or variant and drops undeclared property overrides;
  slot sanitation requires the owning parent instance and enforces allowed kinds plus maximum children.
  Nodes may additionally own bounded `empty`/`loading`/`error`/`success` presentations with explicit content
  maturity and one review-only preview state. These complement rather than duplicate screen Markdown. The
  sanitizer downgrades approved copy containing an unresolved placeholder marker.
  `resolveUiNodeLayout()` applies smaller-viewport overrides in desktop → tablet → mobile order and returns
  the source breakpoint for every computed layout property. A legacy tablet/mobile base changes at a wider
  viewport only through an exact override, so migration does not invent responsive intent.
  `resolveUiScreenLayout()` then projects direct children for stack, grid, and overlay containers in parent-
  before-child depth order. Direction, gap, padding, columns, alignment, distribution, and size modes are
  bounded graph data. A projected child rectangle receives `computed` provenance naming its container; the
  stored rectangle remains untouched as the reversible free-layout fallback. Fill claims an available axis;
  hug uses the stored intrinsic size until content measurement is implemented. Nullable min/max width/height
  constraints inherit per breakpoint, expose their own provenance, and clamp the projected rectangle without
  changing the retained input; a constraint-derived rectangle reports `computed` with a constraint reason.
  Direct container children sort by responsive `order`, then stable geometry/id tie-breakers. Stack `wrap`
  forms deterministic rows/columns; neither operation changes node-array order, hierarchy, or stored geometry.
- **`uiEditCommands.ts`** — the closed mutation protocol for direct manipulation, forms, future preview
  events, and model proposals. Its exact boundary parser covers node lifecycle, kind/label/intent, atomic
  geometry plus reparenting, bounded multi-node frame transforms, base visibility, viewport geometry/
  visibility override set/reset, undo, and redo; commands carry an expected revision and never a graph
  patch. Typed token add/set/delete commands share that revision and history, validate the complete dependency
  graph before committing, refuse duplicate ids and broken/cyclic/cross-kind aliases, and protect a direct
  token while another token aliases it. `set-node-frames` validates every unique target before changing any, applies either base rectangles
  or one named responsive breakpoint, and records the batch as one revision/history entry. A responsive command names only a
  closed breakpoint and bounded values, and cannot override the screen's own base breakpoint. Stale/missing/
  invalid targets refuse. Successful mutations and undo/redo all advance revision monotonically, deletion
  promotes direct children, history is capped at 100, and a fresh edit clears redo.
  `set-node-layout` is the closed container/sizing edit: exact enums, gap/padding 0–500, columns 1–12, nullable
  width constraints 1–1000, nullable height constraints 1–4000, and an optional non-base breakpoint. Minimum
  may not exceed maximum; wrap is `nowrap|wrap`; order is an integer from -1000 to 1000. A non-container may
  use size/order properties but is refused a non-free container mode.
  `duplicate-node` admits only a complete unique identity map for the selected subtree, checks collisions and
  the graph cap before cloning, remaps parents, and offsets base plus explicit responsive rectangles in one
  commit. `locked` is graph authoring state: every node edit except `set-node-locked` refuses, as do atomic
  batches containing a locked node and wrapper deletion that would reparent a locked direct child.
  Multi-selection pointer drag is another `set-node-frames` producer: the browser projects one shared clamped
  delta for feedback, excludes selected identities from snapping, and submits the full frame set once on
  pointer-up. The reducer already makes that batch all-or-nothing and hierarchy-neutral.
  Component add/set/delete and node instance/slot commands use the same exact revision/history boundary.
  A definition cannot be deleted or change to an incompatible root kind while instances use it. Definition
  updates deterministically retain only still-valid variants, states, property overrides, and slot claims;
  definition and instance edits are separate command types, never inferred from selection.
  `set-node-content-state` and `set-node-preview-content-state` add/update/remove state copy and select a
  declared presentation for review. Their exact parser refuses unknown states, extra fields, over-bounds copy,
  placeholder copy claiming approval, and attempts to preview an absent state.
  `diagnoseUiScreenLayout()` consumes that same projection for every breakpoint and deterministically reports
  canvas overflow, parent clipping, non-ancestral/non-overlay overlap, and interactive nodes below 44px after
  conversion through the 1280/834/390 preview widths. The host sends closed diagnostic records; the webview
  renders and routes them to graph selection but does not decide whether layout passed.
- **`uiPreviewRuntime.ts`** — the frozen full-preview runtime, three exact token-scoped protocol paths, HTML
  injection, and revision/selection event hub. A connection receives the current render revision immediately;
  newer revisions and host-resolved selection identities fan out to at most eight listeners, while stale/
  invalid values and broken clients are dropped. The browser may POST exactly a current revision plus bounded
  screen/node IDs for selection; it has no edit, command, storage, arbitrary message, path, graph, or source API.

- **`uiRepositoryMapping.ts`** — the design/repository declaration and divergence boundary. A closed adapter
  catalog maps one component, token, or node to a normalized workspace-relative file and optional symbol;
  component mappings may add bounded prop/slot correspondences and every mapping declares coverage plus
  limitations. Exact revisioned commands own create/replace/delete/verify. Verification realpath-checks the
  workspace and candidate, refuses non-files and files over 2 MiB, and retains only SHA-256 design/source
  fingerprints, graph revision, and time. Target-scoped canonical design hashes prevent an unrelated graph
  edit from marking every mapping changed. Assessments report in-sync/design-only/code-only/conflict/
  unassessed/unsupported and never execute, automatically reconcile, or write source; adapter inspection is
  delegated to the separately bounded import module below.

- **`uiRepositoryImport.ts`** — conservative, deterministic adapter recognizers. React finds named exports and
  simple object-shaped/destructured props; static HTML/CSS finds literal ids/classes/selectors and custom
  properties; VS Code webview finds host exports plus literal web facts; custom returns unsupported. Every
  built-in result is `partial` and carries at least one closed loss finding. Output is capped at 200 unique,
  sorted facts and 40 findings, with exact graph/source-name suggestions only. The host supplies source and
  fingerprints; the module returns no graph command, mapping mutation, source excerpt, executable value, or
  dependency request. `uiRepositoryMapping.ts` persists that report only after its exact revisioned import
  command and a separate mapping edit is required to accept any suggestion.

- **`websiteWireframe.ts`** — the canvas geometry model. Rectangles live on a fixed 1000-unit column grid, never device pixels, because pixels would record the author's monitor size in a committed file. `sanitizeWireframe()` is total: for any input it returns a wireframe whose rects are finite and on-canvas and whose parent graph is a forest, capped at 60 elements and 3 levels. Element kinds are a closed set because generation reads the kind to decide what markup a box becomes.
- **`websiteSitemap.ts`** — hierarchy from the slug path, overridden by an explicit `parentId`. A slug naming a parent that does not exist attaches to root **and is reported**; a cycle is broken at the repeat and reported. `layoutSitemap()` is a deterministic tidy tree, so the same pages always draw the same map.
- **`websiteLinkGraph.ts`** — outbound/inbound links, orphan pages, and dangling links (reported, never dropped — a link whose target was deleted is the evidence a nav is broken). The root page is never an orphan. Nav/CTA labels suggest links by exact then case-insensitive match, never looser.
- **`websiteDesignPrompt.ts`** — composes the selection-scoped prompt for `site`, `page` and `element`. Everything read out of the workspace is fenced as REPORTED CONTENT (labels and stored prompts are model-writable) and passed through `redactSecrets`; the user's own instruction is deliberately *not* fenced. The prompt states that the answer is a proposal.
- **`websiteGeneration.ts`** — `planWebsiteGeneration()` decides the file list deterministically, before any model runs, which is what makes the confirmation dialog reviewable. Paths are constrained to the preview root with an extension allowlist that excludes `.js`; one bad path refuses the whole plan. `parseGeneratedFiles()` matches every returned path against the approved plan and reports anything unplanned rather than writing it.

`websiteWireframePreview.ts` consumes the graph screen alongside its compatibility page projection. It uses
`resolveUiScreenLayout()` to emit ordered tablet (`≤1023px`) and mobile (`≤599px`) static media rules for every
saved node, including inherited geometry/constraints, explicit visibility, container placement, and a
visible-content-derived stage height.
It also resolves component definitions/instances through the same host function used by Studio and emits
escaped definition/variant/state labels plus fixed styling for the closed disabled/loading/error/validation/
success states. Component data never becomes markup or CSS authority.
When a node selects a content state, the adapter replaces only that node's ordinary preview body with its
escaped authored presentation and a maturity badge; missing state copy receives no invented fallback.
Selectors escape graph identities and a screen whose `pageId` does not own the page is ignored. The pure
renderer still emits no script; `websitePreviewHost.ts` supplies the matching authoritative screen and then
injects only the separately audited frozen live runtime.

`websiteStudioPanel.ts` builds the canvas's responsive state on the extension host with
`buildWebsiteStudioResponsiveScreens()`: every node receives resolved desktop/tablet/mobile layout,
per-property provenance, and Boolean flags saying which geometry/visibility overrides actually exist. The
webview renders that projection but never computes inheritance. Its breakpoint inspector may submit exact
set commands or clear `rect`/`hidden` independently; `uiEditCommands.ts` removes only the named property and
drops the breakpoint record only when nothing remains. Host reconciliation returns both the compatibility
wireframes and a fresh resolved snapshot after every result. At a non-base breakpoint, drag/resize and
keyboard nudge optimistically change only the local resolved rectangle, then submit that rectangle as the
same exact `set-node-viewport-override` command; the next host result replaces the projection. Drawing,
deletion, nesting, and parent identity stay base-only, so a responsive gesture cannot change shared structure.
Multi-selection uses a `Set` of node identities with one primary inspector target. Align, distribute, and
group nudge submit one bounded `set-node-frames` batch at the current breakpoint; multi-delete is refused
until the selection is narrowed, preserving the existing single-node deletion contract.
The host responsive snapshot resolves the complete screen rather than each node in isolation. This keeps
computed container rectangles identical in the Studio and `websiteWireframePreview.ts`; the webview displays
the projection and provenance but never implements the layout algorithm.
- **`websiteGenerationRunner.ts`** — runs one generation with the completer and the file writer injected, so "never writes outside the preview root" is checkable rather than asserted. Paths are re-validated immediately before each write. A failed call is recorded, not swallowed.

### Website Studio content and review

- **`websiteWireframePreview.ts`** — renders the canonical design draft straight to self-contained HTML with **no model involved**: wireframe geometry, safe colour/type tokens, and an escaped inert subset of the exact Markdown copy, repeated in a complete content proof. Missing copy stays explicit. The pure renderer still emits no script; `websitePreviewHost.ts` then injects the one frozen Studio runtime with a numeric render revision before writing `_wireframe/`. Generated/exported output is not injected. The index always owns the preview entry point and links to generated output separately.
- **`websitePreviewHost.ts` / `websitePreviewPanel.ts`** — one guarded loopback server feeds two consumers. VS Code's built-in Simple Browser is the full-canvas primary preview; the custom sandboxed webview is only the responsive-width lab. Closing that lab does not stop a server still serving the full browser; Stop Preview, Studio disposal, and extension deactivation own shutdown.
- **`websiteContent.ts`** / **`websiteContentManager.ts`** — markdown copy with YAML front-matter, one file per page, derived from the same `normalizeSlug` the sitemap uses. `[PLACEHOLDER: …]` is parsed and **counted**; *missing* and *empty* stay distinguishable; the file is the source of truth and a save whose file changed underneath is refused rather than merged.
- **`websiteReviewComments.ts`** — comments against a page or element, transitioning and never deleted, with an orphaned comment kept and flagged carrying the element's remembered label. `buildCommentWorkPrompt` fences the body as REPORTED CONTENT.
- **`websiteReviewBundle.ts`** — the overlay generated *into the site*, so it deploys to the client's own staging. The script is a **frozen constant** with configuration passed in a `data-` attribute; no endpoint is ever invented, and `connect-src` names the single declared origin or is `'none'`. Import reuses the record sanitizer and is idempotent. The decision not to host a relay is recorded in `project_memory/decisions/website-client-review-hosting.md`.

The preview server still never serves a general `.js` extension class. It has two independently gated exact
exceptions: the optional on-disk `REVIEW_OVERLAY_SERVED_NAME`, and the Studio-only `_atlas/runtime.js`
response whose bytes come from `UI_PREVIEW_RUNTIME_SCRIPT`, not the workspace. Live Studio mode adds only
same-origin `script-src`/`connect-src`; review mode separately adds its declared HTTPS connection capability.

### Website Studio stack setup

Four more modules cover the framework half, all pure and unit-tested except the host:

- **`websiteFrameworks.ts`** — the framework catalog. Twelve entries, each carrying the verified scaffold/manual boundary, dev/build commands and output directory. **Every executable command is a module constant** — never composed, never parsed from documentation, never model-generated, for the reason `acpInstaller.ts` states: that is RCE with extra steps. `custom`, `static`, `wordpress-theme`, `react`, and `vue` carry no scaffold command by design; the last two link to their official decision-heavy setup guidance instead. `describeStackCompatibility` grades every framework/platform pairing with a reason, and an `unsupported` pairing stays visible rather than being filtered out of the picker.
- **`websiteCiTemplate.ts`** — the GitHub Actions workflow. Declared templates with only validated values substituted; branch names, output dirs and node versions are charset-checked before interpolation, and a rendered file still containing a placeholder refuses rather than being written. Explicit `permissions:`, per-environment `concurrency` with `cancel-in-progress: false`, `environment: production` on the production path, and secrets referenced by name only. A platform with no verified deploy action is refused, not guessed at.
- **`websiteStackSetup.ts`** — `planWebsiteStackSetup` (performs nothing) and `executeWebsiteStackSetup` (takes injected `exec`, `writeFileIfAbsent` and `mergePackageScripts`). Every file and branch step is create-only; every step is re-validated immediately before it acts; execution stops at the first failure and reports what had already succeeded, as `promotionRunner` does.
- **`websiteDeliverySync.ts`** — `compareWebsiteToDelivery` is a comparison, not a verdict, shaped after `findTaxonomyDrift`: Website Studio keeps its own environments, so the two models can drift, and this makes the drift visible rather than reconciling it silently. `buildDeliverySyncPlan` never clears a populated Delivery field from an empty Studio one, only tightens protection, and never creates a stage — that would mean inventing a backup and rollback policy the Studio does not model.

`src/views/websiteStackSetupHost.ts` is the impure half: probe the machine and workspace, show the modal (every command with its purpose, every file with its full contents, openable as documents before confirming), execute with a real `execFile` — argument array, no shell, `cwd` set to the workspace — then **re-probe the filesystem** rather than trusting exit codes.

`websitePreviewServer.ts` serves the generated site over `http` bound to **`127.0.0.1` only**, from one directory, with every request path re-checked via `path.relative`, no directory listing, an extension allowlist, a random per-session path token, and a restrictive CSP on every response. Its three exact live resources deliver the frozen runtime, a server-sent revision/selection stream, and one identity-only selection POST. That POST is capped at 512 bytes, accepts exact JSON fields only, requires the current render revision, and never mutates the graph or filesystem; wrong-token requests remain 404 before method disclosure. The `http` module is injected for unit tests, and an ephemeral-port integration test pins headers, token isolation, reconnect state, stale/hostile selection refusal, and event delivery. `src/views/websitePreviewHost.ts` owns the lifetime, resolves accepted IDs against the current saved graph before notifying UI Studio, injects only deterministic drafts, publishes only after render succeeds, and closes streams plus keep-alive sockets on stop. `src/views/websitePreviewPanel.ts` frames it via `WebviewOptions.portMapping` and builds **its own HTML document with its own CSP** rather than using `getWebviewHtmlShell`, so granting `frame-src` to a loopback port does not widen every other AtlasMind panel; that sandbox omits scripts and continues to refresh through its host, while Simple Browser uses the live runtime.

### CiManager (`src/core/ciManager.ts`)

The pure interpretation layer behind Project Dashboard → Pipeline. `inspectGithubActionsWorkflow`
turns repository-authored YAML into a bounded `CiWorkflowSummary`: provider, file id/path, supported
event and branch scopes, job names/runners/step counts/timeouts, explicit-permission and concurrency
flags, validation categories, and declared-rule cautions. It deliberately has no field for a `run:`
command, action input, environment value, secret name, or raw YAML, so the dashboard snapshot cannot
forward executable or credential-bearing workflow content by accident. The parser is conservative:
unsupported or ambiguous structure is reported as unreadable rather than guessed.

`assessCiPortfolio` distinguishes unconfigured, configured-with-attention, and ready; absence is never
a clean result. `buildNodeCiStarter` is the write-side inverse: a closed GitHub Actions template accepts
only validated branch refs, a closed package-manager set, and validated package-script names selected
from `compile`/`build`/`lint`/`test`. It emits explicit read-only token permissions, concurrency
cancellation and a timeout. The dashboard sends no creation payload; `ProjectDashboardPanel`
re-derives the plan from an actual lockfile, confirms the exact path/branches/checks, and writes with
`flag: 'wx'`. Existing quality CI is reviewed or opened, never overwritten, disabled, or deleted;
release-only automation is not treated as quality coverage. Unit coverage lives in
`tests/core/ciManager.test.ts`; the webview/host contract is pinned in `workflowSurface.test.ts` and
`webviewMessages.test.ts`.

### CiRoutes (`src/core/ciRoutes.ts`)

Where a check can run, declared rather than assumed — the CI analogue of `modelRouter`. The Pipeline page
had one route with a dashboard and several with brochure cards: everything in the guided flow described the
GitHub-connected local runner, so "check this before I push" routed somebody through Docker, `gh`, a
committed workflow and a queued job to run commands they could have typed, while the documentation's own
mode table opened by calling direct local execution the simplest posture.

Four rules carry the semantics. **A route declares what its evidence proves, and success never widens
that** — `CiRouteEvidence` is fixed at declaration, so no amount of green promotes a Linux container into
evidence about Windows; `routeSatisfiesEvidence` refuses that substitution and explains itself either way,
while `declared-matrix` satisfies the narrower classes because a hosted matrix may legitimately contain
them. **An unknown capability is never a yes** — three states, modelled explicitly, since a route silently
treated as able to hold secrets is how a secret reaches somewhere nobody agreed to. **A route with no
adapter is declared, not hidden** — `act`, Buildkite and Woodpecker mark a real boundary and are worth
seeing, but `implementation: 'declared'` makes them permanently `unimplemented` rather than relying on a
caller to remember. **Availability is derived from the machine**, with every unmet prerequisite named, so
"why can I not run this here" is answerable on the page.

Evidence has a second axis. `CiRouteFidelity` says whether a route runs the declared thing or an
approximation of it, and it exists because the evidence class alone could not separate `act` from the
borrowed machine: both produce `linux-container`, yet one runs GitHub's own runner image and runner binary
while the other runs deliberately incomplete images with artifacts, caches, services, secrets and the event
payload emulated or absent. A rule could substitute one for the other and the model raised no objection.
Two values rather than a score, because a number invites arithmetic nobody can defend — is 0.7 enough for
packaging? — where the real question is binary. Every approximate route must carry a `fidelityNote` saying
what is approximated, asserted by test. `routeSatisfiesRequirement` checks both axes, evidence first, and
`requiredFidelity` on a workload class is what demands the real thing; absent, an approximation is
acceptable, which is the honest default since under `act` the project's tests genuinely run and it is the
orchestration around them that is emulated.

`resolveDirectLocalChecks` publishes the rule that chose the commands: a declared aggregate (`ci`,
`ci:local`, `verify`, `check`) wins over guessing at its parts, because a project declaring one has already
said what its checks are — this repository's own `ci:local` chains six steps in an order
`compile, lint, test` does not reproduce. The fallback vocabulary is the same four verbs both workflow
starters use, shared so three surfaces cannot disagree about what "the checks" means.
`buildDirectLocalRunPlan` reuses `deliveryRunPlan`'s shell classification, chaining and reach classifier
rather than repeating them, and **refuses outward-reaching commands structurally** — it returns a refusal
rather than a plan, so a caller cannot reach runnable commands without that check having passed. A button
labelled "run here" must not publish; commands that do reach outside stay available from the Delivery
runbook, where the confirmation is built for them.

`docsUrl` carries where somebody would go to read about a route or install it, and it is a constant on the
definition rather than a URL assembled at render time or nameable by a webview message: the page sends a
route *id* and this table decides the destination, so an executor row can offer a link without being able
to choose one. It is set only for the three routes AtlasMind cannot configure for you — `act`, Buildkite
and Woodpecker — and deliberately absent on the core three, since sending somebody to github.com to learn
what "run here" means would be worse than the silence. `https` only, and only a route's own project; a
link AtlasMind draws is a claim about where it goes, and the answer reaches `openExternal` without a
further question. Pure + unit-tested.

### NodeVersionDetection (`src/core/nodeVersionDetection.ts`)

Which Node version a generated workflow pins, derived rather than chosen once. Three generators write
Actions YAML into a user's repository — the hosted CI starter, the trusted local-runner workflow and the
website CI template — and all three took an *optional* `nodeVersion` that no caller ever passed, so the
`'20'` behind each `??` was not a fallback but the only value any of them emitted: every workflow AtlasMind
had written pinned a runtime that reached end of life in April 2026.

Four rules. **The project's own declaration wins, whatever it says** — an end-of-life version named in
`engines.node` is still the answer, because overriding it puts a runtime in somebody's CI that nothing in
their project claims to support. **A range resolves to its lowest declared major**: `engines.node` is a
range and a pin is a single version, and the floor is both what the project promised and the half that
breaks, since using an API that only exists in the newer major is the ordinary mistake. Upper bounds are
skipped explicitly rather than by accident — `>=22 <25` declares 22, and counting the 25 would pin a major
nobody claimed — and one unreadable alternative makes the whole range unreadable, since the lowest floor
of the parts understood is not the lowest floor of the range. **The last resort is measured, never
declared**: with nothing to read the answer is the major of the running process, which cannot go stale the
way a constant does. **Every answer names the rule that produced it**, and the trusted workflow's
confirmation shows it before the file is written.

`nodeVersion` is **required** on all three generators. That is the half that prevents recurrence rather
than merely fixing the instance: optional is what made "nobody passes it" possible. Each generator also
**refuses** an unusable value rather than coercing it — the shape check guards a live YAML injection path,
and coercion to a default is precisely how one version came to be emitted forever. Pure, with the runtime
version injected, so the ladder is walkable by a test. Unit-tested.

### CiActRoute (`src/core/ciActRoute.ts`)

The first alternative executor, and the one the local-CI documentation picks first. `act` runs the
repository's real workflow YAML locally in containers — its appeal — while its default images are
deliberately incomplete and several GitHub services are only partially emulated, which makes a pass weaker
evidence than the same workflow hosted **and makes that invisible from the exit code**.

So the substance is `assessActFidelity`, not the command. A declared rule table, matched with bounded
regular expressions against the workflow text as `assessTrustedLocalCiWorkflow` does, reports each gap with
its consequence. Two severities, and the split is the point: `partial` (artifacts, caches, service
containers, secrets, event payload) is stated and allowed, while `cannot-run` — a Windows or macOS job, or
OIDC — **refuses the run**, because a `windows-latest` job under a Linux container is not a partial result
but a different thing wearing the same job name. This is the documentation's own requirement for an
executor adapter, implemented: a missing capability is a refusal or an explicit partial run, never an
inferred success. An empty gap list reports "these checks found nothing" rather than claiming parity.

**AtlasMind plans the command and does not run it.** `act` executes arbitrary repository workflow content
through the Docker API by design; `localCiRunner` exists for the case where a *reviewed* workflow should be
executed and applies twelve rules first. Helping somebody run this is the right level of involvement. The
line therefore goes to a terminal without a newline, and the build is recorded `unobserved`, so the ledger
forces its verdict to unknown. Every argument is a constant here with the filename, job id and event
validated against closed grammars; `--pull=false` keeps a route whose appeal is being local and cheap from
starting a multi-gigabyte download unasked. Pure + unit-tested.

### CiBuildLedger (`src/core/ciBuildLedger.ts`)

One list of builds, whatever ran them. The page could show GitHub's runs and, separately, whether a local
container was alive; nothing put those together, so "what has this project run lately" had no answer.

**How closely a build was watched is recorded, and a build nobody watched never reports a verdict.**
AtlasMind types the direct-local commands into a terminal and deliberately does not read it, so it knows a
run *started* and cannot know how it ended. `recordCiBuild` forces an `unobserved` build's status to
`unknown` whatever the caller passes, and `sanitizeCiBuildLedger` re-applies that on read so a stale or
hand-edited record cannot reintroduce a pass. A property test walks it over every generated combination. A
tick beside an unobserved run would be an invented pass on the surface people check before shipping.

**Hosted progress is polled, and the record says so.** The GitHub CLI has no push channel, so liveness there
is requests with backoff — `nextCiPollDelayMs` returns `undefined` once nothing is running, which is what
stops the loop rather than a caller remembering to. `HOSTED_POLL_NOTE` is rendered beside running hosted
builds; a stream would be an overstatement.

**The ledger holds no log output** — `CiBuildRecord` has no field that could carry one, and a `pointer` says
where the detail lives instead. **Storage is per-developer**, stated in `CI_BUILD_LEDGER_NOTE` for the same
reason as `observedDelta`'s baseline: `project_memory/` is committed, so a shared ledger would mean "what has
anybody run" and would conflict between two people on the same day. `githubRunToBuild` reads GitHub's
`status` and `conclusion` as the separate fields they are — a run in progress has no conclusion, and reading
an empty one either way is the classic misreading — and `buildCiLedgerView` carries `githubLoaded` so an
unfetched history never renders as an empty one. Pure, clock-injected + unit-tested.

### CiRoutingPolicy (`src/core/ciRoutingPolicy.ts`)

Which route runs which kind of check — a committed file rather than a setting, so a change to how a team
works arrives as a reviewed diff. Same shape as `workflowConfig`: JSON is the source of truth, a markdown
mirror publishes the rule table beside it, unknown top-level fields survive a round trip, and it is
**never seeded on render**, because writing a statement about somebody's team into their repository because
they opened a tab would put words in their mouth.

**Budget pressure never weakens the trust boundary**, and this is enforced structurally rather than by rule
authoring. A workload whose `input` is `untrusted` may only reach a route declaring
`safeForUntrustedCode: 'yes'`; the filter runs *before* the credit meter is consulted and applies to every
fallback, so an exhausted allowance produces a refusal rather than a demotion onto a workstation. Without
it, "fall back to local when credit runs out" is a mechanism by which running out of money routes hostile
code onto a developer's machine. Because the file is hand-editable the invariant cannot live in the seed:
`validateCiRoutingConfig` reports such a rule as an error *and* `decideCiRoute` refuses it, and a
`fast-check` property asserts the guarantee over 400 generated combinations of rule file, credit state and
machine configuration.

Decision order is load-bearing — trust, then evidence via `routeSatisfiesEvidence`, then availability, then
budget — so every later step can only narrow further. A rule may declare `onCreditExhausted: 'block'`,
which is correct where nothing else produces the evidence: the platform matrix stops rather than
substituting a container. Every decision names its rule twice, as an id and as a sentence, and lists each
rejected candidate with the reason it lost. `CI_WORKLOAD_CLASSES` is deliberately six entries rather than
one per testing methodology: the 32 methodologies answer "what should be tested", this answers "what kind
of machine settles it", and most share an answer. `fs`-only + unit-tested.

`buildCiRoutingMatrix` renders the same policy as a grid — every workload against every route, with
`preferred` / `fallback` / `available` / `blocked` / `unimplemented` decided by the same trust and
suitability checks `decideCiRoute` applies, so a surface cannot offer a pairing the engine would refuse.
`usableHere` is carried separately from the policy state on purpose: a route the rules permit but this
machine cannot run today is a different fact from one the rules refuse, and collapsing them would make a
Docker outage read as a decision. `cycleCiRoutingCell` is the single edit gesture — unused → fallback →
preferred → unused — returning a new config plus the sentence describing the change, refusing a blocked
pairing outright and refusing to remove a workload's last preferred route, since a rule without one is a
workload with no answer.

### CiCreditMeter (`src/core/ciCreditMeter.ts`)

How much hosted allowance is left, and the honest answer when nobody knows. Three states, and the third is
the point: a billing endpoint returning 403 because a scope was never granted looks, to naive code, exactly
like zero minutes remaining — and the routing engine would then move every job onto a workstation on the
strength of a permissions error. Every unreadable response, missing field or failed request becomes
`unknown` **with its reason**, never `exhausted`.

Only two things may report the allowance spent: a billing reading where used ≥ included with no paid
overage, and GitHub refusing a run with a message matching a short declared phrase list — the local-CI
documentation already warns against assuming budget is the cause of a refused run, so a generic failure is
declined. A paid overage counts as headroom, since somebody has already decided to keep spending. A public
repository is `remaining` with basis `not-metered`, settled without a request, because it cannot consume an
allowance at all. Endpoints are constants with a single `{owner}` placeholder the caller fills from an
already-validated slug. Pure + unit-tested; the caller performs the `gh` request.

### TrustedLocalCiStarter (`src/core/trustedLocalCiStarter.ts`)

The write side of the trusted-runner contract, and the answer to a structural gap: every rule in
`assessTrustedLocalCiWorkflow` was enforced against a file AtlasMind could only *judge*, never produce, so
the artifact with the strictest machine-checked contract in the product was the one a person had to
hand-author — from a documentation template that had itself drifted out of compliance with three of those
rules.

`buildTrustedLocalCiStarter` composes the workflow from repository-derived facts only: a slug parsed by
`parseRepoSlug` (URL or `owner/repo`, never guessed), the configured trusted branch, the runner label
already expanded for the engine's reported architecture, and package-script names filtered to
`compile`/`build`/`lint`/`test`. Action pins are module constants in
`TRUSTED_LOCAL_CI_ACTIONS_REVIEWED`, never parsed from documentation and never model-generated — the same
rule `acpInstaller` applies to install commands, because a SHA lifted from fetched text is a
boundary-shaped string rather than a boundary. Corepack covers pnpm and yarn deliberately, so no third
action needs a pin nobody reviewed.

Three properties carry the design. **The generator is held to the validator, not to a template**: a
`fast-check` property over arbitrary valid inputs asserts every generated workflow passes
`assessTrustedLocalCiWorkflow`, and the builder additionally re-checks the exact bytes it is about to
return — a scaffolder whose output its own runtime path then refuses is worse than none, because the
failure arrives with AtlasMind's authorship attached. **An invalid input is refused, never coerced**, and
the refusal names what was wrong; a repaired branch name would route real jobs at a ref nobody chose, in a
committed file. **The plan states what the file permits and refuses in plain words**, so the confirmation
is readable by somebody who has never pinned an action while the YAML stays inspectable by somebody who
has. Branch shape rules are shared with `ciManager.safeWorkflowBranchRef` rather than duplicated. Pure and
`vscode`-free; unit and property coverage in `tests/core/trustedLocalCiStarter.test.ts`.

### LocalCiSetupPlan (`src/core/localCiSetupPlan.ts`)

The `/localci` walkthrough, and the fourth entry in `SETUP_GUIDES`. Local CI has more external
prerequisites than anything else in AtlasMind — a committed workflow satisfying a dozen rules, a
machine-scoped permission, `gh`, an authenticated GitHub session, a Docker engine and a queued job — and
was the only feature of that shape without a guide, so a missing prerequisite was discovered by hitting
the failure it caused.

Delegates every mechanic to `setupWalkthrough`, so ordering, next-step selection, progress counting and
rendering cannot drift from the Buzz, ACP and Lens guides. Two properties are enforced rather than
described: **nothing here installs or enables anything** (every action is an opening action, asserted by
`findNonOpeningActions` over several states — a guide that switched on the gate deciding whether GitHub
may execute code on this machine would have removed the reason that gate exists), and **an unprobed
`false` is reported as "not checked", never as "missing"**, since sending somebody to install software
they already have is how a guide stops being trusted.

Step order follows the order things fail in, with the workflow check deliberately first because it is a
filesystem read and therefore free. `firstRun` — proving a job has actually completed — is in the
walkthrough but excluded from `isLocalCiReady`, the same split `acpSetupPlan` makes: a correctly
configured runner that has never executed anything is ready, and calling it unready would send somebody to
fix what is not broken. The queue command is **passed in already validated** by
`buildLocalCiQueueInvocation` rather than composed here; interpolating a filename and branch into a
GitHub CLI command line is the shape `ghExecBoundary` forbids, and the runner already owns that answer.
Pure + unit-tested.

### TrackerWriteOutcome (`src/core/trackerWriteOutcome.ts`)

What a confirmed GitHub write already tells you, applied before the re-read. Closing an issue did the
right thing and appeared to do nothing: the write returns in under a second, and the panel then re-read
the whole repository — slug, viewer, a hundred issues, thirty pull requests with reviews and checks, two
workflow-run listings, labels, milestones, releases, and, when the latest run had failed, a log download
with a 45-second timeout — publishing nothing until the last of them returned.

Four rules keep the echo narrower than the read it precedes. **Only what the write itself established** —
`gh` exits non-zero when GitHub refuses, so a returned success is a fact about the tracker rather than a
prediction about it, which is the same standard the rest of the codebase applies when it refuses to
infer. **Never invents a record**: a number absent from the list yields the list unchanged, and creating
an issue therefore echoes nothing at all, because the new number is not known here. **Only the fields the
action names** — a close sets `state` and `updatedAt` and touches nothing it has no news about; `merged`
and `closed` stay distinct because the delivery metrics read the difference. **An echo is a floor, not a
ceiling**: the authoritative read follows immediately and replaces it, so nothing here needs to be right
about anything except what just happened. The issues a `Closes #12` line closes are GitHub's inference
and are deliberately left to that read.

The panel completes the fix on the other side: `handleRefreshIssues` publishes each reading as it lands
rather than only in its `finally`, so the issue list no longer waits behind the run listing, and a
re-read requested while one is in flight is queued and run once afterwards instead of being dropped —
dropping a duplicate *click* is right, but the read after a write is the only thing that will show the
change. Pure, `vscode`-free and unit-tested in `tests/core/trackerWriteOutcome.test.ts`.

### LocalCiInspectionMemory (`src/core/localCiInspectionMemory.ts`)

What this computer was found to have, and when — the local CI setup answer that used to be forgotten
every time VS Code closed. The trusted workflow verdict was made restart-proof by deriving it on every
refresh, which works because it is one file read. The *machine* half cannot be treated that way: probing
it runs `docker`, `docker info` and `gh auth status`, and doing that on every render would start processes
as a side effect of looking at a page. So the prerequisites reset to `not-inspected` on every
extension-host restart, the Pipeline page went back to "Inspect this computer", and the setup ladder asked
for a step somebody had already done.

Five rules keep the memory honest. **A memory is a dated observation, never a current reading** —
`restoreLocalCiInspection` returns the observation with its age, and every surface showing it says when it
was taken, because a page reporting "Docker: Ready" from a three-week-old probe is a claim about right now
that nobody checked. **A memory guides, it never authorises**: `LocalCiRunnerManager.start` inspects again
immediately before lending the machine and refuses if capacity or the engine changed, so nothing restored
here can reach a running container — that is what makes remembering safe at all. **A memory of a different
machine is refused, not adapted**, matched on a host fingerprint, since "Docker is installed" about the
wrong computer is exactly the reassuring direction to be wrong in. **A memory expires** after fourteen
days, long enough that the machine may genuinely have changed and short enough that a weekly user is never
asked twice. **Only the durable half is remembered** — `otherRunningContainers` and the queue state are
facts about a moment rather than about a setup, and `imagePresent` is dropped when the `image` setting has
changed, because the old answer is about a different image.

Stored in `globalState` rather than `workspaceState`: Docker, `gh` and its sign-in are facts about the
machine, so a second workspace on the same computer should not have to ask again. Pure, `vscode`-free and
unit-tested in `tests/core/localCiInspectionMemory.test.ts`; the storage key and the write live in the
Project Dashboard panel, and the walkthrough reads the same record so `/localci` and `/setup` cannot
report a different answer from the page.

### LocalCiInstaller (`src/core/localCiInstaller.ts`)

Planning the GitHub CLI install, in the shape `acpInstaller` and `mcp/mcpRuntime` already settled: every
command is a constant in the file (never parsed from a page, never model-generated), `execFile` with no
shell, and planning performs nothing — execution is a separate call after a modal lists each command with
its purpose. Success is verified by re-resolving `gh` on PATH rather than by an exit code, because a
package manager can report success while installing somewhere this window will not see until it reloads.

Two omissions are deliberate and documented in the module. **Docker is not installed by AtlasMind** — a
system service with a virtual machine behind it, frequently needing a reboot, whose installer is
interactive on Windows and macOS; the official page remains the offer. **`apt-get` is not offered for
`gh`**, because the reliable route on Debian and Ubuntu adds GitHub's apt repository and keyring, a
network-fetched key feeding an install step, which is precisely the shape the constants rule exists to
refuse. Both produce a `manual` plan naming the reason rather than a command that would fail. Pure apart
from an injected probe + unit-tested.

### LocalCiRunnerManager (`src/core/localCiRunner.ts`)

The execution half of Project Dashboard → Pipeline. It is intentionally separate from `CiManager`:
workflow inventory is a pure, always-safe local read; lending a machine to GitHub is an explicit,
machine-scoped lifecycle with network, process and resource authority.

The lifecycle is `disabled → not-inspected → ready → starting → waiting → running → finished/failed`.
Opening or rendering the page performs no Docker or GitHub probe. **Inspect prerequisites** reads
`os.cpus()` / `os.totalmem()`, the existing bounded cross-platform GPU probes, `gh --version`, bounded
`gh auth status`, and Docker's actual `NCPU`, `MemTotal`, `OSType`, `Architecture` and advertised runtimes.
`LocalCiPrerequisitesSnapshot.inspection` keeps an unchecked false value from being rendered as “missing”,
and `localCiInspectionMemory` is what stops that honest "not checked" from re-appearing after every
restart. `reviewTrustedLocalCiWorkflow` is exported as a free function so the dashboard can derive the
trusted workflow verdict before anything has built a manager — constructing one opens an output channel,
so a refresh must not — while the manager delegates to it, keeping one implementation behind the answer on
the page and the answer that gates a run.
Resource planning measures the operating-system reserve **on the host, never on Docker's view of itself** —
on Windows/macOS the engine reports the WSL/VM allocation, which is already a slice of the machine, so a
reserve computed there protected the VM from itself and the desktop from nothing. The plan takes the lowest
of the operator maximums, the engine's capacity, the testing resource share
(`atlasmind.testing.resourceShare`, shared with every host-side test path via
`src/core/testResourceBudget.ts`), and what the host reserve (25%, never fewer than 2 CPUs / 8 GB) leaves;
it refuses below 2 CPUs or 4 GB. The container
receives matching `--cpus`, `--memory`, `--memory-swap` and `--pids-limit 1024` limits. GPU identity/live
VRAM and Docker runtime capability are evidence only; `LocalCiGpuSnapshot.accessPolicy` remains `disabled`
and no `--gpus` argument is produced. OS/architecture are carried in the snapshot as evidence, so a Linux
Docker result can never be presented as native Windows or macOS coverage.

`prepare()` is the authorization gate and **never queues work**. GitHub reports a waiting self-hosted
workflow as `pending` while its job is `queued`, so the manager reads both lists and deduplicates by run id.
It requires exactly one waiting `push`/`workflow_dispatch` run in total for current HEAD and the trusted
branch, with the repository owner as actor. One current run plus a stale run refuses too: a shared label
cannot guarantee which job GitHub assigns. Queue absence/mismatch is a typed, retryable preflight issue—not
a failed machine—and carries bounded local/waiting SHA evidence for the webview.
The target workflow must be committed and is re-read immediately: exact repository/ref/owner conditions,
read-only contents permission, no secret reference/write/OIDC permission, full-SHA action pins,
`persist-credentials: false`, and one architecture-specific label that occurs in no sibling workflow. Any
registered runner carrying that label refuses, preventing a stale/competing worker from sharing the route.

That file review is owned by `reviewWorkflow`, which `prepare()` calls rather than reimplements, and which
is separately reachable through `assessCommittedWorkflow` **before any other setup exists** — it is a
filesystem read, so it needs no Docker, no `gh` and no queued job. Previously the policy was applied only
at the moment of lending the machine, four steps in, as one concatenated sentence. `LocalCiWorkflowReview`
keeps `missing`, `unreadable`, `blocked` and `ok` distinct: only a genuinely absent file is `scaffoldable`,
because offering to "create" over an unreadable one is the single case where creating destroys something.
A directory that cannot be listed is a blocker rather than a pass, since the check exists to prove no other
workflow claims the label. `LocalCiWorkflowError` carries the whole review instead of a joined string, so a
surface can render one item per failed rule; a policy failure lands as the `blocked` configuration state
rather than as a runtime failure, because nothing was started and the fix is a file edit. The review is
recorded on the snapshot on success as well as failure — an absent `workflowReview` means *not reviewed*,
never *acceptable*.

After a host modal names the repository, SHA, run, image, evidence platform, limits, reserve and shutdown
effect, the runner starts as a non-root ephemeral container with no mounts, socket, ports, GPU, persistent
volume or default labels; all Linux capabilities are dropped and privilege escalation is disabled. A
digest-pinned image may be pulled; any installed local derivative is resolved to its immutable image id
before `docker run`. `pipeGhStdoutOrThrow` in `GhClient` connects the one-hour registration token directly
from `gh` stdout to Docker stdin, so AtlasMind never materializes it as a string or webview/log field.

Docker Desktop ownership is explicit. `ifStartedByAtlasMind` (default) stops it only when this lifecycle
started it; `never` leaves it open; `always` asks to stop it even if already running. Every mode leaves it
open when container inventory fails or any unrelated container is running. An unmanaged Linux Docker
system service is never started or stopped. Pure policy coverage lives in `tests/core/localCiRunner.test.ts`;
the dashboard contract is pinned in `tests/views/workflowSurface.test.ts`. `LocalCiRunnerManager` retains a
copy of the last applied machine configuration; identical reads are no-ops, while the dashboard reconciles
the current VS Code value before every snapshot. This closes the gap where a long-lived panel could render
an old enabled state after the active profile or extension host changed.

The lifecycle also has a deliberate exit: `stop()` removes the live container through the same name-guarded
remover the start path uses — it can only ever reach a container AtlasMind started — and the finish path
reports a stopped run as `ready` with an honest message rather than as `finished`, because a job abandoned
mid-run is not a job that completed. Before this existed, a started run could only end by finishing, and a
wedged job held its whole CPU/memory budget with nothing on this side able to take it back.

**A run outlives the extension host, and the next session adopts it** (`src/core/localCiAdoption.ts`,
pure + unit-tested in `tests/core/localCiAdoption.test.ts`). `docker run` is a detached lifetime, so closing
VS Code leaves the container executing the job it claimed — deliberately kept, because GitHub is waiting on
real work and killing it would discard minutes of compute and report a failure nobody caused. `inspect()`
therefore lists `--all` containers carrying the AtlasMind label and reconciles them: a running one is
*adopted* — lifecycle forced to `running` so the page cannot offer a Start button the one-operation guard
would refuse, output reattached through `docker logs --follow`, and the end recorded — while finished ones
are reported as *strays* with a confirmed removal action. Four rules hold it: a container must match **both**
the label and the container-name shape, since a label is a string anybody can set on their own container;
running and finished are different findings with different offers; a stray is never removed automatically,
because it is the only local evidence a run happened and usually the crash being investigated; and an
unreadable `docker ps` row is skipped rather than guessed at. Following is read-only by choice — `docker
attach` shares the container's stdin — and the follower is a separate field from `runnerProcess` precisely so
`disposeFollowers()` on panel close drops the *reader* and never the job. `localCiRunnerEnvArgs` additionally
passes the container's real CPU allowance inward (`ATLASMIND_TEST_MAX_WORKERS` plus the Vitest/Jest spellings
and a matching `NODE_OPTIONS` heap cap), because the cgroup bounds what a suite *can* take while these tell it
what to *ask for* — without them a job sees the host's CPU count and starts one worker per thread behind a
much smaller quota.

### TestResourceBudget (`src/core/testResourceBudget.ts`)

The sliding scale for local test execution, and the OS reserve under it. The container runner above was the
only governed execution path; every path that runs tests **on the host** — the after-write
auto-verification in `extension.ts`, the `test-run` skill, the Pipeline "Run here" route — had no CPU,
memory or worker governance, and those are the paths that can take a desktop down (Jest defaults to
cores − 1 workers; Stryker to cores − 1 concurrent whole test runtimes). Pure and unit-tested
(`tests/core/testResourceBudget.test.ts`). Five rules: the reserve is measured on the host and floored
aggressively (25%, ≥2 CPUs / 8 GB); one slider (`atlasmind.testing.resourceShare`, machine-scoped) governs
every path so two surfaces cannot answer differently; a budget can shrink a host run but never refuse one;
worker flags are appended only where the runner is recognised and the script does not state its own limit
(`planTestCommandThrottle` — `--maxWorkers` for Jest/Vitest, `--concurrency` at a harder cap for Stryker,
nothing for compound scripts); and the `NODE_OPTIONS` heap cap is a merge, never a replacement
(`withTestResourceEnv`). The host `runCommand` additionally runs every agent-issued command at below-normal
priority and clips captured output to a bounded tail, because a runner prints its failures last.

### Pipeline Studio (`src/views/projectDashboardPanel.ts`, `media/projectDashboard.js`)

The Pipeline webview is a progressive evidence surface over `CiManager`, `LocalCiRunnerManager`, testing,
delivery and bounded GitHub-run data. Its initial next-action card and four-decision journey—checks, computer,
queue, one-job runner—lead to six locally selected subviews; result reading follows execution instead of
being presented as an installation step. The Start view derives the first incomplete decision and renders
one primary action plus a compact four-step strip. Complete setup steps, specialist shortcuts and recent
history use native disclosure elements because their open state is optional context, unlike the persisted
help controls. The Runner subview uses the same hierarchy: one current action and critical blockers remain
visible; the readiness disclosure separates effective permission, Docker CLI/engine, GitHub CLI/
authentication and runner image state and opens automatically only when machine action is required. Setup
help appears only for a missing item: the browser sends an opaque id and the host resolves one of four fixed
official URLs, so it cannot supply a URL or installer command. The copy distinguishes machine applications
from repository dependencies. The host adds the effective setting source; the browser cannot set it.
Runnable queue and stale-run recovery guidance is rendered only as complete command blocks with Copy and
Send-to-Terminal controls. Queue Copy/Send messages have no payload: the host reconstructs the command from
validated machine-scoped workflow/ref settings. A cancel message carries only a positive run id, which the
host must find again in the current waiting-run preflight issue. Send targets a workspace-rooted terminal
using VS Code's configured shell and passes `addNewLine: false`, so PowerShell, Command Prompt, bash and zsh
all receive the same `gh` syntax for review without executing it.
Hardware, GPU, provider adapters, capacity arithmetic, runner lifecycle, immutable configuration and the
platform evidence boundary are grouped in one closed technical disclosure. This changes presentation only;
no evidence is discarded and no blocker is moved behind disclosure.
Information controls reuse the persisted Workflow disclosure state and restore focus;
measured dials use the dashboard value-animation mechanism and end in a tick only when the underlying
state is resolved. `prefers-reduced-motion` removes dial, test-cell, graph-edge and chart movement without
hiding the final value.

The workflow canvas is read-only. Pointer or arrow-key movement updates cubic edges and saves only bounded
node coordinates in VS Code webview state; resetting clears those coordinates. It cannot supply YAML,
commands or a path to the host. Test intelligence renders an observed JUnit aggregate but labels flake
history and testcase timing unavailable until those data exist. Analytics is bounded to already-loaded
GitHub runs and treats creation-to-update duration as answer time, including queueing.

`collectCiWorkspaceSnapshot` reads declared Node workspaces or at most one level of supported manifests,
constrains every candidate beneath the workspace, and marks only current worktree-path impact; it does not
claim a dependency graph. `collectSupplyChainSnapshot` records manifest, lockfile, update-monitor and
registry-configuration presence, never registry values. Package-host cache, approval, vulnerability and
publication states remain explicitly unconfigured until an external provider adapter supplies evidence.

### DeliveryManager (`src/core/deliveryManager.ts`)

Models a project's **deployment stages** (Local → Staging → Production …) and the **promotion ("push") edges** between them, surfaced on the Project Dashboard → Delivery page. A `DeliveryConfig` (`stages: DeploymentStage[]`, `paths: PromotionPath[]`) is persisted as the source of truth at `project_memory/operations/delivery.json`, with a human-readable `delivery.md` runbook mirror regenerated on every write (`renderDeliveryMarkdown`) so the pipeline is understandable and editable by a newcomer without asking the AI. The persistence helpers (`readDeliveryConfig`/`writeDeliveryConfig`/`seedDeliveryConfig`) are `vscode`-free (node `fs` only), matching the `DataPrivacyManager` pattern.

**The pipeline and the shipping instructions are separate readings of the same evidence.** The stage model answers *where a version moves*; `buildProjectDeliveryGuide` answers *what a newcomer actually does*. The dashboard supplies a bounded root-file and manifest reading, the already-parsed `DeliveryConfig`, the bound routines, workflow names/triggers, and git cleanliness. The pure builder derives an ordered **Prerequisites → Validate → Package → Deploy → Publish** guide for Node, Python, Go, Rust, Maven/Gradle, .NET, or container projects. Exact package scripts/routine steps are `configured`; ecosystem-standard commands are `conventional`; human gates stay `manual`; and absent load-bearing facts are `missing`. This distinction is load-bearing: a standard `cargo test` is useful guidance, but it is not evidence that the repository declared or ran it. Unknown shapes get explicit gaps instead of a fictional universal release command.

Workspace-authored text is control-stripped and length-capped, evidence paths must remain workspace-relative and traversal-free, and commands render only inside code blocks. Guarded promotion continues to read executable commands server-side from the persisted delivery config or routine, rebuild live preflight state, and apply its ordinary approvals. Detection therefore cannot become authorization.

### DeliveryRunPlan (`src/core/deliveryRunPlan.ts`)

The guide's commands can be copied, typed into a terminal, or run a column at a time. This pure module decides what a terminal will be asked to do, **before** anything is sent, and returns it as a value a test can walk rather than a convention a refactor can lose.

**A column is planned, never improvised.** The webview posts an opaque step or phase id — the rule `addIdeationEvidence` and the branch-inventory actions already follow — and the panel rebuilds the guide from the workspace before resolving anything. A crafted message can therefore name a command that does not exist, which resolves to nothing; it can never *supply* one. Steps in a column with no command are reported in `skipped` rather than dropped, because a plan that silently omits the manual gates reads as the whole column. `tests/views/dashboardNav.test.ts` pins that no payload on this surface is ever `step.command`.

**Fail-fast is a property of the shell, and it is reported rather than assumed.** `chainDeliveryCommands` joins with `&&` where the shell can stop on failure and sends separate lines where it cannot — Windows PowerShell 5.1 has no `&&`, and an unrecognised shell has made no promise, so it is treated as unable rather than assumed able. `buildDeliveryRunConfirmation` states which happened in the sentence the user actually reads: a column that keeps going after `npm test` fails will happily package and publish a broken build.

**Reach is classified so the confirmation can differ.** "Run the tests" and "publish to a registry" cannot be the same dialog. `classifyDeliveryCommandReach` matches a declared, word-boundary-matched token list (`git push`, `npm publish`, `vsce publish`, `cargo publish`, `docker push`, `gh workflow run`, `terraform apply`, a script named `publish`/`release`/`ship`/`deploy`/`tag`, and similar); an unrecognised command is `local`, which is safe here precisely because the classification only ever *adds* a warning — every command is listed in the confirmation either way, so a miss loses emphasis and never a gate.

Single-command actions need no dialog because they are not runs: **copy** writes to the clipboard, and **send to terminal** withholds the trailing newline exactly as `chatPanel` and the setup walkthroughs do, leaving the human's own keystroke as the last gate. Both use one named `AtlasMind Delivery` terminal rooted at the workspace, because a delivery command that runs in whatever directory the active terminal happened to be in is a different command from the one the page displayed. The module is `vscode`-free and unit-tested (`tests/core/deliveryRunPlan.test.ts`).

On first open the dashboard seeds a pipeline that reflects the repository's **actual** delivery protocol. `detectDeliverySignals` (in `projectDashboardPanel.ts`) imports: branch layout, **project archetype** (VS Code extension / library / web service / generic, from `engines.vscode`/`contributes`/server deps/`Dockerfile`/`main`), **database presence** (DB dependency regex + `migrations`/`prisma` dirs), **publish target** (Marketplace from vsce, container from a Dockerfile, npm from a publish script), **`.env` files** (only referenced when present), **package scripts** (`compile`/`build`, `lint`, `test`), **CI** presence, and **existing routines** (the production push binds to a `publish|release|ship|deploy` or default routine). `seedDeliveryConfig` turns those into stages: a deploy-less project gets an **Integration** stage rather than a fictional staging-server-with-DB, the publish target becomes production hosting, required checks mirror the scripts that exist (+ "CI green"), and **no backup gate is imposed when there is no database** — avoiding a phantom deny-by-default block. A data-bearing production target still gets `required: true` with an empty command, so it stays **deny-by-default blocked** until a real backup command is supplied. Each `DeploymentStage` carries a plain-English `description`, config-source **location** (never secret values), and explicit `backupPolicy` / `promotionPolicy` / `rollbackPolicy`. Per-stage status (the deployed version) is read from each branch's `package.json`, preferring the **remote-tracking ref** (`origin/<branch>`) over the local branch (`chooseDeployedVersionRef`) — a developer working on `develop` rarely pulls the release branch, so the local `master` is usually stale and would otherwise report a long-outdated version; the local ref is used only as a fallback for offline/local-only repos. Branch import is **honest, never fabricated**: when `detectProductionBranchRef` finds no production branch (no `main`/`master`/`production`/`prod`/`release` ref), `seedDeliveryConfig` leaves the Production `branchRef` unset rather than inventing `main`, and the runbook mirror renders `— (not detected)` for a branchless non-local stage — a wrong imported branch could mislead a promotion target, so deny-by-default applies to detection too.

Detection also imports the **Git PR/CI promotion protocol** per branch. `detectBranchCiGating` parses `.github/workflows/*.yml` for the workflows that gate a branch (and whether any do so on `pull_request`); `fetchBranchProtection` is a best-effort `gh api .../branches/{branch}/protection` probe (run only at seed/re-import, short timeout, graceful fallback) that yields the exact required-check **contexts** and whether **PRs are required**. From these, `seedDeliveryConfig` sets `StagePromotionPolicy.viaPullRequest` (PR required — sourced from branch protection's `required_pull_request_reviews` or a bound routine's `gh pr create`, *not* merely from CI having a `pull_request` trigger, so a CI-gated-but-direct-push branch like `develop` is modelled correctly) and `requiredStatusChecks` (the real CI contexts). `buildPromotionPlan` surfaces each status check as a preflight item and **blocks a PR-required promotion that has no routine bound to open the PR**, so a protected branch is never targeted by a direct push.

A **"Re-import from repo"** action (the `reimportDelivery` message → `handleReimportDelivery`) re-runs detection and rebuilds the pipeline, so an already-seeded project whose real protocol has since moved on — or one seeded by older, generic logic — can refresh to match reality (two-click confirmed; it re-baselines the review state).

The Delivery page hosts a full **stage editor**: stages can be added, edited, reordered (by `rank`), and removed (two-click confirm), and promotion edges added / re-pointed / removed. The editor posts the whole config back as a `saveDeliveryConfig` webview message; the panel runs it through `sanitizeDeliveryConfig` — the untrusted-input boundary that clamps string lengths, coerces types (booleans are strict `=== true`), regenerates duplicate/missing ids, and drops promotion edges that reference a non-existent or self stage — before `DeliveryManager.save()` writes it.

**Stays current + drift detection.** A `vscode` file watcher on `delivery.json` (registered in `extension.ts`) reloads the manager and fires `deliveryRefresh` whenever the file changes outside the dashboard (hand edits, a teammate's `git pull`, a script), so the page never shows a stale protocol. The dashboard also computes a **review status**: it fingerprints the review-relevant state (a stable projection of the stage/path config, stage-candidate branches in the repo not yet modelled, stage branches that have gone missing, and the CI/CD workflow set) and diffs it against the last-reviewed baseline stored workspace-scoped in `workspaceState` (`atlasmind.deliveryReview`). When they differ, a **"Review needed"** banner lists what changed and offers **Mark reviewed**, which snapshots the current fingerprint as the new baseline. Saving edits through the dashboard editor updates the baseline implicitly — the banner is reserved for drift the user did *not* author.

### PromotionRunner (`src/core/promotionRunner.ts`)

**A failed step can be handed to Atlas.** `buildPromotionFixPrompt` turns one failed step into a chat prompt: the step, its command and its output, sanitized through `sanitizeCiLog` (ANSI stripped before redaction, tail kept, bounded to `PROMOTION_FIX_LOG_CHARS` rather than the 200,000-character storage default) and fenced as reported content — machine output rather than a stranger's prose, but a failing test's name or a fixture string can still read as an instruction to a model that can call tools. **It proposes and never re-runs the promotion**, which is gated on a typed confirmation and, for a protected stage, an approval; a `deploy` or `verify` failure also warns the target may be partly changed. The webview posts only the step id and the host rebuilds the prompt from the retained run, so a crafted message can name a step but never supply its text.

Release remediation and the detected runbook now describe the same versioning boundary. When a target
requires a version bump, `buildProjectDeliveryGuide` surfaces **Prepare release version** in
Prerequisites and prefers an exact repository script (`prepare:release`, `release:prepare`,
`version:bump`, `bump:version`, or `version`) when declared. `applyPromotionRemediation` treats the bump
as one path-scoped metadata edit: `package.json`, npm's root lockfile version, `CHANGELOG.md`, recognised
README current-version markers, and an existing `wiki/Changelog.md` heading are synchronized before the
commit. It never creates project-specific mirrors. Hook output crosses the same sanitized/redacted
terminal boundary as CI logs, retains the failure tail, and uses a bounded 16 MiB Git capture buffer.

The guarded promotion ("push") engine. `buildPromotionPlan(input)` assembles an inspectable `PromotionPlan` for a path: the ordered guarded steps (**preflight gate → backup → deploy → verify → record**) and the preflight checks. Checks AtlasMind can mechanically evaluate are computed (`requireVersionBump` via `compareSemver` of source vs target `package.json`, `requireChangelog` via a CHANGELOG scan, "working tree clean" via `git status`); every other named check is flagged for **manual attestation**. A target whose `backupPolicy.required` is set but has no command is recorded as a hard **blocker** (deny-by-default).

`evaluatePromotionGate(plan, attestations, confirmText, targetName)` is the single authorization point: it refuses when there is any blocker, any failing auto-check, an un-attested manual check, a missing approval (when `requiresApproval`), or — for a protected stage — a confirmation string that does not match the target name. `runPromotion(options)` executes only after the gate passes, running the backup command, the bound routine's deploy steps (honouring each step's `on_fail`), and an HTTP health check of `hosting.healthCheckUrl`, streaming per-step progress and returning a result plus a rollback hint.

**Live CI verification.** Required CI status checks are *verified* rather than self-attested: the panel resolves live check-run status for the source branch's head commit via `gh` (`gatherLiveCiStatus`) and passes it into `buildPromotionPlan` as `liveStatusChecks`. A context with live status becomes an **auto** preflight check (a failing *or pending* run makes the gate refuse); without `gh` it falls back to manual attestation. **Audit + recovery:** each promotion and rollback is appended to `project_memory/operations/delivery-history.json` (`appendPromotionHistory`, with the git actor) and surfaced as *Recent promotions*; `runRollback` executes a stage's user-authored rollback command after authorization (protected stages require the typed stage name). `checkHealthUrl` backs the stage **Test health** button. Import detection (`detectDeliverySignals`) spans polyglot ecosystems (Python/Go/Rust/Java/.NET manifests, web frameworks, ORMs) and PaaS/IaC targets (Fly.io, Vercel, Netlify, Render, GAE, Serverless, Kubernetes, Terraform, containers), deriving production hosting, database presence, and a production URL where possible.

**Governance + safety (concurrency, CD, data, duties).** A workspace lock (`acquireDeliveryLock` / `releaseDeliveryLock`, `project_memory/operations/.delivery-lock.json`, stale after 60 min) makes promotions/rollbacks single-flight. A stage may set `promotionPolicy.dispatchWorkflow` (auto-detected from a `workflow_dispatch` deploy/release workflow when no routine is bound) so the promote step becomes `gh workflow run <file>` — deploying in CI/CD rather than on the developer's machine. `backupPolicy.verifyCommand` runs as a managed step after the backup (verified, not just executed); `data.migrateCommand` runs migrations inside the guarded sequence. `promotionPolicy.requireDistinctApprover` adds an automatic separation-of-duties gate comparing the git actor's email against the source head-commit author (`resolveGitActorEmail` / `resolveLastCommitAuthor`), degrading to manual attestation when identities are unresolved. (Deferred for dedicated design: first-class progressive delivery and ephemeral preview environments.)

The panel (`projectDashboardPanel.ts`) drives this through two webview messages — `requestPromotionPlan` (builds the plan/runbook from live git state) and `runPromotion` (rebuilds the plan, re-runs `evaluatePromotionGate`, executes, then records the outcome onto the path via `DeliveryManager.save()`). **Security boundary:** every executed command is read server-side from the persisted, user-authored stage config (`backupPolicy.command`) or routine files — the webview can only *trigger* and *attest*, never supply a command string — and AtlasMind itself never force-pushes.

### ProjectDirectorManager (`src/core/projectDirectorManager.ts`)

Models the **people** a project runs on — its stakeholders, delivery team, responsibilities (who owns what), human task assignments, and follow-ups — the data backbone of the Project Director dashboard (Project Dashboard → Director page). A `ProjectDirectorConfig` (`contacts`, `stakeholders`, `teamMembers`, `responsibilities`, `assignments`, `followUps`, `settings`) is persisted as the source of truth at `project_memory/operations/project-director.json`, with a human-readable `project-director.md` mirror regenerated on every write (`renderProjectDirectorMarkdown`) and a capped `project-director-history.json` audit trail. Like `DeliveryManager`/`DataPrivacyManager`, the persistence helpers (`readProjectDirectorConfig`/`writeProjectDirectorConfig`/`seedProjectDirectorConfig`) are `vscode`-free (node `fs` only).

**Contacts are the identity layer.** A `DirectorContact` holds a person/group's name, title, communication `links`, and an optional `ref: DirectoryRef` pointing at their system of record (`m365`/`slack`/`google`/`buzz`/`local`). Each link's `kind` is a `CommunicationChannelKind` open union (`email`, `slack`, `teams`, `buzz`, `phone`, `github`, `linkedin`, …); `buzz` records a [Buzz](https://buzz.xyz) identity (npub / @handle / #channel) with an `https`-only deep link. The governing contract is **Buzz owns identity + messaging; AtlasMind owns reasoning + execution** — so `DirectoryRef.source: 'buzz'` *references* a Buzz-owned Nostr identity; AtlasMind never mints or mirrors a directory (see `project_memory/roadmap/buzz-integration.md`). `Stakeholder` and `TeamMember` are thin role records referencing a contact by id, so one human can be both without duplicating their channels. `Assignment` is the human-owner overlay that `ProjectRunRecord`/`SubTask` (assigned to *agent roles*) lack; `Assignment.linkedRunId` binds an autonomous run to a human owner **without mutating the run record**. `Assignment.linkedWork` extends that same ownership record to a closed `DashboardWorkKind` set (branch, roadmap, issue, pull request, gap, risk, debt, document), so no dashboard page owns a parallel assignee field.

**Solo dev, not just teams.** `ProjectDirectorConfig.selfContactId` marks "me" (seeded from the git user), so assignments/follow-ups default to you and the UI can address you as "you". `settings.teamMode` (`solo`/`team`/`auto`) with `resolveTeamMode`/`isSoloProject` infers **solo** when there is no team member other than yourself — a one-person project is never asked to fill in team ceremony, the dashboard foregrounds self-management (your follow-ups and the areas you own), and external stakeholders (a client, end-users, an app-store reviewer) are still first-class when they exist.

**GDPR-first, deny-by-default.** AtlasMind prefers to *reference* people in their GDPR-compliant system of record (Microsoft 365 / Entra, Slack, Google Workspace — each carries a `providerDataGovernance` entry with DSAR/retention links) and resolve details on demand, rather than hoarding raw personal data locally. A contact that stores raw PII is flagged `piiStored` so the extension layer can gate it behind a one-time consent notice and the existing `gdpr-pii` classification. Communication `handle`s are non-secret identifiers (never tokens/passwords); the markdown mirror describes channels by *kind/label only* so raw addresses never land in git-tracked prose. `sanitizeProjectDirectorConfig` is the webview→disk boundary: it clamps string lengths, whitelists every enum (unknown → safe fallback), regenerates duplicate/missing ids, **drops role records referencing a non-existent contact**, clears dangling optional references, and strips any `deepLink` whose scheme is not allowlisted (`mailto:`/`tel:`/`sms:`/`slack:`/`msteams:`/`zoommtg:`/`https:` — bare `http:`, `javascript:`, and `data:` are rejected). Pure derivations `deriveFollowUpUrgency`/`countOverdueFollowUps` classify follow-ups (`overdue`/`due-soon`/`upcoming`/`snoozed`/`done`) for the dashboard, tree badge, and (later) scheduler. A `vscode` file watcher on `project-director.json` (registered in `extension.ts`) reloads the manager and fires `projectDirectorRefresh` on external edits.

**Dashboard tab (Phase 2).** The Project Dashboard has a **Director** page (`collectDirectorSnapshot`/`detectDirectorSignals` in `projectDashboardPanel.ts`, rendered by `renderDirector` in `media/projectDashboard.js`) with Setup, People (roster), Responsibilities, Assignments, autonomous-run owners, and Follow-ups. `buildDashboardWorkTargets` derives assignable work from the same assembled snapshot that renders branches, roadmap, issues, pull requests, gaps, risks, debt and documents. Each surface uses `renderDirectorOwnerControl`; the Director Assignments view reads the identical records. A change message contains only a short-lived random `work-<uuid>` token, which `ProjectDashboardPanel` resolves from its latest host-issued map; an older render's token therefore cannot be rebound to a different item. The host validates the selected contact, persists only the closed `{ kind, id }` link, and re-resolves branch tokens against a fresh Git inventory before saving. It is **solo-aware** (`resolveTeamMode`/`isSoloProject` foreground self-management for a one-person project) and **GDPR-gated**: persisting raw PII triggers a one-time consent modal (workspace-scoped ack) that also enables the `gdpr-pii` compliance pack. Every webview payload is validated by `isProjectDashboardMessage` and re-run through `sanitizeProjectDirectorConfig` before it touches disk; contact deep-links are resolved and re-checked against the scheme allowlist server-side before `openExternal`, and "Copy contact" is built host-side.

**Guarded connectors (Phase 3).** With outbound messaging enabled (`settings.outboundEnabled`, default off) and a matching MCP connector connected, the Director tab can email / schedule / message a contact. `DirectorCommsRunner` (`src/core/directorCommsRunner.ts`, pure/vscode-free) detects which connected MCP tool can perform each intent — matching tool names (`outlook_send_mail`, `create_event`, `post_message`, …) across `mcpServerRegistry.listServers()`, preferring real send/create tools over drafts — and best-effort maps a composed draft onto that tool's declared input-schema fields (inventing nothing). Capabilities stay partitioned by contact channel kind (`email`/`slack`/`teams`/`buzz`) and delivery shape, so a Buzz recipient can never fall through to another connected messaging provider; Buzz channel UUIDs select `buzz_post_message`, while 64-character Nostr pubkeys select `buzz_send_dm`. Dispatch is deny-by-default in the panel: it requires the toggle, a connected connector, and an explicit `{ modal: true }` confirmation showing the exact action (connector, tool, recipient, subject/body, classified risk via `classifyToolInvocation`) before running the tool through its `mcp:<serverId>:<toolName>` skill wrapper (`skillsRegistry.get(...).execute(args, atlas.skillContext)`). No connector for the exact channel kind → non-destructive fallback to the deep-link. The webview only supplies the draft; the tool comes from the connected server, credentials stay in SecretStorage, and successful sends are recorded to `project-director-history.json`.

**Buzz Tier 1b bridge.** `src/mcp/buzzCommsServer.ts` is an extension-bundled stdio MCP server backed by the pure `BuzzCliBridge` in `src/mcp/buzzCliBridge.ts`. It wraps official `buzz-cli` source tag v0.4.26 and exposes only bounded channel listing, channel posting, bounded thread reading, and DM sending. Upstream v0.4.26 has no working `--version` flag, so the bridge probes the exact required root/channel/message/thread/DM help contracts before the MCP handshake; reads the agent private key and optional NIP-OA authorization tag from SecretStorage-backed env; converts the WS/WSS relay setting to the HTTP/HTTPS base the CLI expects; rejects remote relays without `atlasmind.buzz.allowRemoteRelay` and rejects non-TLS remote URLs; invokes the CLI without a shell; passes message bodies over stdin; validates identifiers; caps input, output, and duration; and redacts credentials from failures. It exposes none of `buzz-dev-mcp`'s shell/file-edit surface and none of Buzz's workflow/repository/admin commands. The boundary remains: **Buzz owns identity + messaging; AtlasMind owns reasoning + execution.**

**Reminders + surfacing (Phase 4).** `FollowUpScheduler` (`src/core/followUpScheduler.ts`, pure eval + a thin timer class) surfaces a **throttled, once-per-day** in-editor nudge (via injected `notify`) when follow-ups are overdue/due-soon, opening the Director tab on click. It is **notification-only and deny-by-default** — it never sends anything outbound on a timer (outbound always needs the per-send confirmation above). A startup `runOnce()` fires when `settings.nudgeOnActivation` is on (default); the recurring 30-minute timer (wired near the manager in `extension.ts`) only nudges while `settings.remindersEnabled` is on (default off); the once/day throttle is a `workspaceState` date-key that survives restarts. A sidebar tree `atlasmind.projectDirectorView` (`ProjectDirectorTreeProvider` in `treeViews.ts`) groups Stakeholders / Team / Follow-ups. Follow-ups is the personal Director attention projection: due/overdue reminders plus active assignments owned by `selfContactId`, including dashboard-linked and run-linked work. One total drives its dynamic collapsed title, activity badge, and synthetic-URI row decoration; the same `projectDirectorRefresh` event updates it and Project State. `atlasmind.openProjectDirector` opens the dashboard on the Director tab, and `@atlas /director` + `/followups` print a skimmable status.

### DocumentsManager (`src/core/documentsManager.ts`)

Models a project's **document filing system** and the documents to be **kept updated automatically** — the data backbone of the Project Dashboard → **Documents** page. A `DocumentsConfig` (`filing: DocumentFilingEntry[]`, `autoUpdate: DocumentAutoUpdateEntry[]`) is persisted as the source of truth at `project_memory/operations/documents.json`, with a human-readable `documents.md` runbook mirror regenerated on every write (`renderDocumentsMarkdown`). Like `DeliveryManager`/`ProjectDirectorManager`, the persistence helpers (`readDocumentsConfig`/`writeDocumentsConfig`/`seedDocumentsConfig`) are `vscode`-free (node `fs` only) and unit-tested.

**Shelf folders are created, never written.** Declaring a shelf and then finding the folder absent is a papercut, so saving a shelf creates its folder: `newShelfPaths` (pure) diffs the incoming config against what was persisted — by *path*, so re-pointing a shelf counts as new — and `createShelfFolders` `mkdir`s the result. That is the whole of its authority: a path already a directory is a no-op, a path occupied by a **file** is reported and left untouched, an unsafe path is refused (re-validated through `normalizeRelPath`, with the resolved target re-checked against the workspace root), and every creation is surfaced to the user. Shelves whose folder is still missing get an explicit **Create folder** action on the page (`createShelfFolder` message).

**Registry, not an auto-writer (safety-first).** Following the deny-by-default posture, nothing here ever rewrites a user's documents on a timer. The manager records *where* documents live and *which* matter; the dashboard collector (`collectDocumentsSnapshot`) computes freshness by comparing each tracked file's mtime against a recorded `lastReviewed` baseline (plus a weekly-cadence window) and yields a `missing`/`review-due`/`fresh`/`unknown` status, a bounded workspace markdown walk (`listWorkspaceMarkdown`, capped, ignore-list) for "uncovered" suggestions, and per-file `updatePrompt`/counts. The user then triggers an explicit **Update with Atlas** (an `openPrompt` handoff) or **Mark reviewed** (baseline reset). `sanitizeDocumentsConfig` is the webview→disk boundary: it clamps string lengths, validates the cadence enum, regenerates duplicate/missing ids, caps array sizes, and — via `normalizeRelPath` — rejects absolute paths, drive letters, and `..` traversal so a saved entry can never point outside the workspace. A `documents.json` file watcher (`documentsRefresh`, wired in `extension.ts`) keeps the page current on external edits.

### RiskOversightManager (`src/core/riskOversightManager.ts`)

Persists the **risk register** raised by the three oversight advisors (`ethics-oversight`, `legal-oversight`, `commercial-oversight`) — the data backbone of the Project Dashboard → **Risk** page. A `RiskOversightConfig` (`findings: RiskFinding[]`, `runs: RiskDomainRun[]`) is the source of truth at `project_memory/operations/risk-oversight.json`, with a readable `risk-oversight.md` mirror regenerated on every write (`renderRiskOversightMarkdown`) and an append-only `risk-oversight-history.json` audit trail. Like `DocumentsManager`/`DeliveryManager`, the persistence helpers are `vscode`-free (node `fs` only) and unit-tested.

**A record, not an enforcement gate.** Nothing here blocks a commit, a promotion, or a release; an analysis only ever runs because the user asked for one on the Risk page. Findings are **never deleted** — they transition through `open → accepted / mitigated / closed / dismissed` — so the register stays a complete account of what was raised and what was decided, while the history file (capped at `MAX_RISK_HISTORY = 1000`, a cap the markdown mirror states rather than truncating silently) records every run and status change. Re-running an advisor calls `mergeDomainFindings`, which refreshes prose and severity on a finding already on file but preserves its human-set `status`/`statusNote`, and keeps findings the advisor no longer reports.

**Two untrusted boundaries.** Findings originate as *model output*: `parseRiskFindings` locates candidate JSON (fenced block, bare array, or a `{findings:[...]}` wrapper) and degrades to `[]` on anything malformed rather than throwing, then `sanitizeRiskFindings`/`sanitizeRiskOversightConfig` clamp every string, coerce every enum to a safe default (unknown severity → `medium`, unknown confidence → `low`, unknown status → `open`, so a finding is never silently resolved), generate collision-safe ids, and — via `normalizeRelPath` — reject absolute paths, drive letters, and `..` traversal in cited evidence. The dashboard's webview messages are validated separately in `isProjectDashboardMessage`, where an unrecognised risk domain or status is refused outright rather than coerced, because a run costs a real model call and a status change mutates the register.

**Scoring (`computeRiskScore`, pure).** Open findings are weighted by likelihood × impact, discounted by the advisor's stated confidence, then scaled by domain coverage (an unassessed domain is unknown risk, so it cannot count as assurance) and decayed as the oldest assessment goes stale past `RISK_STALE_DAYS` (90). `accepted` findings are excluded — a consciously owned risk is a decision, not an unmanaged gap. The resulting 0–100 becomes a 15-point `risk` component in `buildScoreBreakdown`, **omitted entirely until the project has been assessed** so an unassessed project reads as *unknown*, not safe, and installing the feature does not move any existing project's health number.

### SecurityReviewManager (`src/core/securityReviewManager.ts`)

Provides the `vscode`-free, `fs`-only persistence and scoring foundation for a future Project Dashboard security-review surface. `SecurityReviewConfig` records findings and the latest run for each of four areas — secrets, runtime boundaries, dependencies, and permissions — in `project_memory/operations/security-review.json`; every write regenerates a human-readable `security-review.md` mirror, while `security-review-history.json` keeps the newest 1,000 audit entries. The service is not yet wired into `extension.ts` or a webview.

**A register, not a scanner or gate.** The manager does not discover vulnerabilities, invoke an agent, grant tool authority, or block commits, promotions, and releases. It stores review evidence and human decisions. Re-running an area can refresh a finding's evidence and risk attributes without overwriting its human-managed status, and findings remain in the register rather than disappearing when a later run no longer reports them.

**Untrusted-input boundary and scoring.** `parseSecurityFindings` accepts a fenced array, bare array, or `{ findings: [...] }` wrapper and degrades malformed model output to `[]`. `sanitizeSecurityFindings` and `sanitizeSecurityReviewConfig` cap collections and text, coerce unknown enums to conservative defaults (including unknown status → `open`), generate collision-safe ids, and reject absolute, drive-qualified, or traversal evidence paths. `computeSecurityReviewScore` weights open findings by severity × exploitability × confidence, scales assurance by reviewed-area coverage, and applies freshness decay after `SECURITY_REVIEW_STALE_DAYS` (45).

### PresenceManager (`src/core/presenceManager.ts`)

Cross-platform OS **keep-awake wake lock** so an AtlasMind activity that must stay online — a connected Buzz presence, an active Remote Control gateway session, or a long Mission Loop run — is not killed by system sleep. A VS Code extension runs in the Node.js **extension host, not Electron's main process**, so it cannot call `powerSaveBlocker`; instead `PresenceManager` spawns an OS-native inhibitor helper and ties the lock to that child's lifetime — killing it releases the lock. Per-OS commands (pure, unit-tested via `buildInhibitCommand`): Windows PowerShell P/Invoking `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED [| ES_DISPLAY_REQUIRED])` on a re-assert loop with a **parent-PID orphan guard**; macOS `caffeinate -i [-d] -w <hostPid>`; Linux `systemd-inhibit --what=idle:sleep --mode=block sleep infinity`. Modelled on `HostSpeechSynthesizer` (injectable `spawn`/`platform`, idempotent kill/dispose), it is `vscode`-free and unit-tested.

**Reference-counted and safety-first.** The lock is held while any *reason* is present — the `atlasmind.presence.keepAwake` master toggle contributes a reason, and future activities (Buzz/Loop/Remote) can `hold(reason)`/`release(reason)`. Deny-by-default throughout: nothing is held unless opted in; `acPowerOnly` (default `true`) auto-suspends on battery via a best-effort AC-power probe (`defaultDetectAcPower`, sysfs on Linux / `pmset` on macOS / `Win32_Battery` on Windows) so an unplugged laptop is never drained; a `maxAwakeMinutes` backstop auto-releases the lock so a stuck activity can never hold the machine awake indefinitely; a wall-clock-gap **sleep detector** re-asserts the lock after a suspend; and no untrusted input is ever interpolated into a spawned command (only validated integers). `extension.ts` wires it to the `atlasmind.presence.*` settings (live via `onDidChangeConfiguration`), a click-to-stop status-bar indicator, and the `atlasmind.togglePresence` command; it is disposed on deactivate (killing any held lock).

### MissionRunner (`src/core/missionRunner.ts`)

The autonomous goal-seeking **Mission Loop**. It wraps the existing single-pass plan→execute→synthesize machinery (`Orchestrator.processProject` with a `planOverride`) in an outer loop that re-evaluates progress against a goal after every iteration and keeps going until the goal is met **or** the closed parameter envelope confines progress. Each iteration runs: (1) **guardrail pre-check** — iterations / cost / cumulative tokens / wall-clock / consecutive-no-progress plus the project-wide daily budget gate (`CostTracker.getDailyBudgetStatus`); any hard cap stops the loop with a typed `MissionStopReason`; (2) **checkpoint gate** — hybrid autonomy: when a configured trigger fires (every N iterations, a budget-fraction crossing, or before write batches) the loop pauses for the `checkpointGate` hook, **deny-by-default** if unanswered; (3) **plan increment** — `Planner.plan(incrementGoal)` where the increment goal is composed from the goal, guardrails, success criteria, the evaluator's next-focus, and a carry-forward summary; (4) **execute**; (5) **evaluate** via `GoalEvaluator`; (6) **decide** — `achieved` (with confidence ≥ threshold) stops success, `blocked` stops, otherwise loop again. Every dependency is a narrow structural interface (`MissionExecutor`, `MissionPlannerLike`, `MissionBudgetStore`, `MissionPersistence`) so the runner is `vscode`-free and unit-testable; the Orchestrator, Planner, CostTracker, and MissionRegistry satisfy them. **Recoverable-block recovery:** when the loop would otherwise stop `blocked` or `no-progress`, `detectSettingBlocker()` checks whether the cause is a relaxable AtlasMind setting (it keys off the deterministic tool-approval denial reason, e.g. `allowTerminalWrite`); if so, the `blockedGate` hook asks the user to override-for-this-run, open settings, or stop — deny-by-default, and it never re-prompts for the same setting after one override. The surfaces wire this via the shared `createMissionSettingBlockGate()` helper (`participant.ts`), which applies the override and reverts it when the run ends. Progress is emitted as `MissionProgressUpdate` events for both the `/loop` chat command and the Mission Control panel. **SSOT integration:** the increment goal is grounded in project memory (the Planner already pulls `project_soul`/roadmap/decisions/architecture), discovery is prefer-existing (registered capabilities first, then gated synthesis/ARD), the project's Testing Methodology Matrix + TDD policy are inherited via `executeSubTask`, and deployments are never run directly — they route through the guarded `PromotionRunner` pipeline.

### GoalEvaluator (`src/core/goalEvaluator.ts`)

LLM-backed progress judge that decides whether a mission's goal is met. Given the goal, success criteria, accumulated outputs, changed files, and verification status, it applies an explicit goal/criteria/evidence/verification/completeness/calibration rubric and returns a `GoalVerdict` (`achieved` | `progressing` | `stalled` | `blocked`, plus `confidence`, `remaining`, `nextFocus`, `rationale`). Output is treated as **untrusted**: `parseGoalVerdict` strips fences, extracts the first object, and validates every field (mirroring the Planner's discipline), falling back to `stalled`/zero-confidence on anything malformed so a bad evaluator can never falsely declare success. `applyVerificationGuard` defensively downgrades an `achieved` verdict to `progressing` when the iteration changed files but its TDD/verification status is `missing`/`blocked`, or when the verdict itself still lists outstanding work. The evaluator takes an injected one-shot completion function (the runner passes `Orchestrator.summarizeText`).

### MissionRegistry (`src/core/missionRegistry.ts`)

Audit-trail persistence for mission runs. Like `DeliveryManager`, the persistence helpers are `vscode`-free (node `fs` only): a `MissionRunRecord[]` is stored as the source of truth at `project_memory/operations/missions.json` with a human-readable `missions.md` runbook mirror regenerated on every write (`renderMissionsMarkdown`). `toPersistedRecord` trims large synthesis/output text and drops heavy nested artifacts before writing, and the history is capped at `MAX_MISSION_RECORDS`. No secret values are persisted. It also exposes `listActive()` (running / awaiting-checkpoint missions) and a lightweight, `vscode`-free `onChange` subscription fired on every save — the **Cost Dashboard** subscribes to it to render its live "Current Loops" section (accumulated cost vs. cap, iteration progress, tokens, latest verdict) and re-render as each iteration is saved.

The Cost Dashboard keeps period/style controls in a toolbar before the daily plot. The period choices use a closed-by-default `<details>` disclosure whose expanded content remains in normal flow, so controls cannot cover a line-chart peak. Local savings are derived only from local-provider records, grouped by exact model id, compared individually with a catalog-backed budget/mid/premium cloud reference selected from the advertised parameter count or model-family markers, and totalled as an explicitly estimated—not realized—saving. The same bounded calculation feeds both the top-level Efficiency metric and the detailed per-model comparison, so the overview and drill-down cannot diverge.

### TaskProfiler (`src/core/taskProfiler.ts`)

Infers a `TaskProfile` from the current phase and request text. It classifies modality (`text`, `code`, `vision`, `mixed`), reasoning intensity (`low`, `medium`, `high`), and any hard or soft capability needs used by the router.

### SkillScanner (`src/core/skillScanner.ts`)

Static security scanner that checks skill source code against configurable rules. Exports `BUILTIN_SCAN_RULES` (12 rules), `resolveRules(config)` (merges overrides and custom rules), `scanSkillSource(id, source, config?)`, and `scanSkillFile(id, path, config?)`. Returns a `SkillScanResult` with per-issue details (rule, severity, line, snippet, message).

### TestingConfigLoader (`src/core/testingConfigLoader.ts`)

Pure-Node utility (no VS Code dependency) that connects the Testing Methodology Matrix to the execution pipeline. `readProjectTestingConfig(workspaceRoot)` reads `project_memory/index/testing-config.json`. `inferTestingMethodologyForSubTask(task, config)` detects the best matching `TestingMethodologyId` from a subtask's role and description using `TESTING_METHODOLOGY_DEFINITIONS.autoDetectSignals`. `resolveTestingModelOverride(methodologyId, methodConfig, agents)` walks the lookup chain — `assignedModelId` → assigned agent's `testingModelOverrides[id]` — and returns the effective override model ID. Used by the orchestrator in both the project subtask path and the direct task path to apply per-methodology model routing when the Testing Methodology Matrix is configured.

`buildTestingObligationGuidance(config)` is the module's other half, and it exists because the routing half was the *only* half. Testing policy reached a prompt through exactly one channel — `buildMethodologySystemPromptHint` — behind two gates: a direct task had to already be classified as testing **and** match an `assignedAgentId`, and a subtask had to satisfy `inferTestingMethodologyForSubTask`, which returns `undefined` unless the task text already contains a testing term. So the turns implementing features, the only turns that could have written the tests, were the ones never told. This project ran seven weeks with fourteen methodologies declared and eight of them with no evidence of any kind.

Three properties are load-bearing. It returns the **whole enabled set, never one match** — the per-methodology hint answers "which methodology owns *this* testing task" and is kept for exactly that, but choosing one of fourteen for a general obligation would silently drop thirteen. It states an **obligation, not a description**: the old hint closed with "report the checks you used", which a model satisfies with a sentence, so work that changes behaviour and produces none of the evidence its policy names is stated to be incomplete. And it is **empty when nothing is enabled**, because generic advice about testing that nobody asked for is how a prompt block becomes something agents learn to skim. Practices (`v-model`, `exploratory`, and the five others `testingPolicyCoverage` marks `practiceOnly`) are named as context but never asked for as artifacts — requesting a file they cannot produce invites an invented one, and the two lists are pinned together by `tests/core/testingObligation.test.ts` so they cannot drift.

The Orchestrator sets it on `request.context['__testingObligation']` in `processTaskWithAgent`, gated **only** on task modality (`code` or `mixed`), and `buildMessages` concatenates it alongside the other conditional prompt blocks. The gate is modality alone on purpose: any narrower condition would reproduce the original failure with different wording.

**Reading is versioned.** `readProjectTestingConfig` routes through `interpretVersionedDocument` rather than checking the version itself. The previous gate was `parsed.version === 1`, which collapsed a corrupt file and a file written by a *newer* AtlasMind into the same `undefined` — and every caller treats `undefined` as "this project has no testing policy", which is what the writers take as licence to persist a fresh default over the top. Since the document's entire content is which methodologies are enabled, that was a silent way to switch a project's testing policy off. `readProjectTestingConfigDocument` exposes `preserveExisting` for callers that are about to write. Schema version 2 adds the per-methodology `blocking` flag; the 1→2 step deliberately leaves the field absent rather than writing `false`, because absent means "never considered" and `false` means "decided against".

**The write gate is governed by the config.** `evaluateProjectTddWriteGate` is the only real enforcement in the system, and until v0.222.0 `buildProjectTddPolicy` and `requiresProjectTddWriteGate` never consulted `testing-config.json` at all — they matched on role and task wording, so a project with TDD switched off still got the gate and the methodologies it had switched on got none. `projectWantsTddWriteGate` now decides, from `blocking` on an enabled methodology. An absent, unreadable, or newer-than-this-build config keeps the gate: in all three cases the project has not told us, and removing a safety behaviour because a file would not parse fails in the wrong direction.

### TestingSubjects (`src/core/testingSubjects.ts`) + TestingSubjectScan (`src/core/testingSubjectScan.ts`)

The individual things a policy has to cover, and whether each is. Coverage was a **methodology-level** question — does anything in this tree test contracts — so one contract test from March reported `covered` in December after forty endpoints had been added, and `evidenceSatisfies` accepted *any* changed test file for every policy but BDD, property and TDD, conceding in its own comment that "a finer reading would need to understand what the test asserts, which is not something a path can tell us". A path cannot; a **subject** can.

**A subject comes from a declared artifact, never from inferred code shape.** Every extractor reads something somebody wrote on purpose: an OpenAPI/AsyncAPI path, a GraphQL operation, a gRPC method, a migration, a component schema, a file-system route, a declared role, a prompt file. Inferring subjects from source shape — every exported function is a unit-test subject — would manufacture hundreds of obligations nobody agreed to, and a methodology that cannot be evidenced becomes a permanent gap, which is the failure the archetype packs already exist to prevent. `SUBJECT_EXTRACTABLE_POLICIES` names the seven that have one; the other 62 report *not extractable* rather than zero, because zero uncovered reads as complete. Specs are read line-wise rather than with a YAML parser — untrusted input on a render path, and the only question is which keys exist, so a malformed file yields fewer subjects instead of an exception.

**Matching is by reference, biased toward false negatives.** A test covers a subject when its source *names* it: a test that never mentions the endpoint it supposedly tests is not evidence that it does. `requiredTokens` carries the HTTP method, because under any-of matching a test naming `/v1/orders` covered the GET and the POST equally — rebuilding the exact looseness this replaces, one level down. Method matching is case-insensitive (`.post('/v1/orders')` names it as surely as `POST`); role, schema and path names are matched as declared, since `Admin` and `admin` may be different roles. Only the subject's *own* policy's tests count — a snapshot test mentioning a path is not contract coverage of it.

**One scan, shared by both surfaces.** `scanTestingSubjects` does the bounded walk, extraction and matching once; the Testing dashboard renders from it and the Orchestrator's obligation prompt names from it. A page saying an endpoint is untested while the turn that touched it was told nothing would be worse than neither existing, because one of them is then lying. `fs`-only so the Orchestrator can call it off a turn, cached for 30 seconds so per-turn cost is nil, keyed on the enabled set (a cached answer for a different policy set answers a different question) and re-read on `force` when the user explicitly refreshes. `matchTestFilesToPolicies` is exported from `testingPolicyCoverage` rather than reimplemented, so the marker rules have one home. Subjects are filtered to *enabled* policies: a repository with an OpenAPI spec and no contract policy is not handed obligations it could only close by switching on a methodology it deliberately left off. Anything thrown yields an empty report — under-reporting is the safe direction, since a missed subject is a gap nobody was told about while an invented one is an obligation nobody owes.

`TestingSubjectView` exists because `byPolicy` is a `Map` and the dashboard payload crosses the webview boundary as JSON, where a Map becomes `{}` silently with every tally lost. The per-policy counts travel on `TestingPolicyDetail.subjects` instead, and a new `uncovered-subjects` severity rule grades a policy that has evidence but has since grown work that evidence does not reach.

### TestingPolicyDetail (`src/core/testingPolicyDetail.ts`)

What a single testing policy needs a *person* to do about it. `testingPolicyCoverage` answers "is anything testing this?"; this answers "how bad is it, whose is it, and what is the next move" — the question a board of nine equally-weighted gaps could not, which is why this repository carried eight unowned ones for seven weeks. Pure + unit-tested; the caller supplies the coverage and the filesystem answer, this decides.

**Severity from a declared table, never a model.** `TESTING_SEVERITY_RULES` is evaluated in order, first match wins, and the ordering *is* the policy: a failing test outranks a missing one because a test that runs and fails is a statement about the code while a test never written is a statement about the plan. Every finding carries the `ruleId` and its label, and the whole table travels in the payload as `TestingPolicyDetailSet.rules` so the renderer publishes the rules that actually produced the grades rather than a second copy that could drift. A grade given in March has to be comparable with one given in July — the same argument `debtRegister` makes, applied unchanged.

**`serious` is narrow on purpose:** failing tests, or an enabled security/compliance policy with no evidence at all. `isSensitive` matches on the *category* so a policy added to a compliance family grades correctly without anybody editing this file, with `SENSITIVE_IDS` covering the handful that live elsewhere (`security-testing` and friends sit under `non-functional` beside visual regression, which must not grade like a security gap or the serious count means nothing). Everything unevidenced is `moderate`; tooling-without-tests and an all-skipped suite are `low`. Making every gap serious is how nothing is serious.

**Nothing here files anything.** The module returns a reading and two drafts. `buildTestingIssueDraft` produces one only for a `serious` finding — an issue is public, permanent and posted in the user's name, and offering one per unevidenced policy would turn the tracker into a copy of this page. No model is in the path, so the same finding yields byte-identical text and there is something stable to review; labels are *suggested* and the caller intersects them with the repository's declared taxonomy, because an unmatched label is created on the repository as a side effect of filing. Severity therefore decides what is offered and emphasised and never what is created, which is what keeps a too-eager rule merely noisy rather than damaging.

**Unassessed is not healthy.** `unverified` marks a `clear` grade that rests on a report which does not exist — and only that one, since "no test files exist" is a fact about the tree that no report would change. `caseMix` is `undefined` rather than zeroed when there are no cases, because an empty bar and a bar nobody could compute look identical and only one is a finding. `scaffoldable` is supplied by the caller (`scaffoldableMethodologies`, one stack detection for all sixty-nine rather than one per policy per repaint) so the per-policy **Scaffold framework** button never appears where pressing it would do nothing.

The Testing page registers every non-clear policy as a `DashboardWorkKind` of `testing-policy`, which makes the existing Director ownership picker, the assignment records and the project state tree work unchanged — no second assignment path, which would write Director records the Director page does not recognise. `LINKED_KINDS` in `projectDirectorManager` gained `testing-policy` for the same reason a whitelist exists: an unrecognised kind is reset to `none`, so a follow-up would have persisted while quietly forgetting which policy it was about.

### TestingAutoAssess (`src/core/testingAutoAssess.ts`)

What this project's *code* says its testing policy should be. Pure and `vscode`-free: the caller gathers evidence (`gatherTestingEvidence` in the settings panel), this decides — which is what makes a heuristic checkable rather than merely plausible.

**The problem it replaced.** Auto-assess matched every `autoDetectSignals` entry as a bare substring against one corpus that included three kilobytes of `README.md`. So what a project *said about itself* weighed identically to what it was *built from*, and `api` matched inside `rapid`. Measured on this repository, twelve policies fired on README prose alone — PCI-DSS, bias & fairness and model-output risk classification among them, on a VS Code extension that touches none of those concerns. The 23 → 69 expansion made it sharply worse, since the new vocabulary includes `audit`, `risk`, `agent`, `bias` and `retention`.

Five rules, each closing one way this misled:

**Code decides, prose proposes.** Evidence is split by origin at the *input* boundary rather than sorted out afterwards — a merged corpus cannot recover the distinction, which is precisely how the old one lost it. A signal in `dependencies`/`scripts`/`paths` yields `basis: 'observed'` and arrives ticked; a signal only in `prose` yields `basis: 'stated'`, arrives unticked, and names the words that prompted it. The same rule `researchRegister` applies to an uncited claim, for the same reason: something that reads exactly like evidence but is not must not be stored as though it were. Nothing is suppressed — the goal is to stop the tool deciding on the user's behalf, not to stop it suggesting.

**Boundaries are real.** `signalPattern` wraps each signal in `(?<![a-z0-9])`/`(?![a-z0-9])` rather than using `\b`, because the vocabulary is full of hyphens and slashes (`fast-check`, `ci/cd`, `do-178`, `mc/dc`, `800-53`) where `\b` is surprising. Result: `api` matches in `rest api` and `api-first`, and in neither `rapid` nor `openapi`.

**One ambiguous word is a hint; two are a pattern.** `AMBIGUOUS_SIGNALS` was derived empirically — by running the assessment over this repository and reading what it ticked. `npm audit` in a script switched on SOC 2, change-management and audit-trail testing; a `.github/workflows` directory switched on data-quality and SLSA provenance. None of those words is wrong in the catalogue; the word is simply not, alone, evidence of which meaning applies. `isDecisive` requires one unambiguous signal or two **literal** ones — literal only, because a derived rule expands one dependency into a whole vocabulary (`redis` emits `database postgres mysql mongodb`) and counting the expansion would let a single ambiguous fact manufacture its own corroboration and appear to rest on five.

**Ambiguity is per (word, policy), and only the exceptions are declared.** A CI directory is unambiguous evidence of `continuous` and no evidence at all of `secure-build-pipeline`, yet both list `github actions`. Declaring 69 policies' worth of pairs would be unmaintainable, so `DERIVED_SIGNALS.decisiveFor` names only the handful of facts that *are* their own proof for one policy — CI for continuous, `CODEOWNERS` for change-management, `axe-core` for accessibility.

**Shape can withhold; evidence overrules shape.** A confidently-detected archetype suppresses the policies its pack marks `discouraged`, which is what stops auto-assess creating the permanent unclosable gap the packs exist to prevent. Suppression is checked *before* signals so a stray keyword cannot reintroduce one, never applies to a policy already evidenced on disk (a real file beats a heuristic about what this kind of project usually needs), and is skipped entirely when `detectProjectArchetype` was not confident — a `generic` fallback is not a finding.

`DERIVED_SIGNALS` translate observed facts into the catalogue's vocabulary: nothing in `@anthropic-ai/sdk` contains `prompt`, nothing in `cerbos` contains `rbac`. Keeping the translation here stops the catalogue decaying into a vendor package list that goes stale every release. `unassessed` carries what could not be read into the summary, because "not read" and "nothing relevant" are different facts and only the second supports a conclusion. The settings panel and both bootstrapper paths (intake, import snapshot) call this one function — the logic previously existed in three copies with the same substring bug in each. Pure + unit-tested.

### TestingScaffolder (`src/core/testingScaffolder.ts`)

Constructs a language- and archetype-aware starter testing framework from the enabled methodologies. `scaffoldTestingFramework(workspaceRoot, config)` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints (`package.json`, `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj`/`*.sln`, `pom.xml`/`build.gradle`) and a coarse **archetype** (web / api / cli / game / mobile / library / generic), then generates idiomatic starter files per enabled methodology: Vitest/Jest/Playwright/Cypress/fast-check/k6 (Node, with e2e branching on archetype), pytest/Hypothesis/Locust (Python), `cargo test`/proptest/criterion (Rust), `go test`/`testing/quick`/benchmarks (Go), xUnit (.NET), JUnit 5 (Java). It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up hints. Unknown stacks degrade to playbook-only guidance. Strictly non-destructive: starter files are created only when absent and never overwritten, no manifest is ever mutated, and the only file always (re)written is the managed playbook.

**Two entry points, one implementation.** The Settings → Testing button and the `atlasmind.scaffoldTestingFramework` command had drifted: the command scaffolded files and stopped, never running `syncTestingProtocols`, so a palette invocation left every external AI instruction file describing the *previous* methodology set while the repository had just been scaffolded for the new one — and its confirmation dialog did not mention a sync, so nothing about the outcome contradicted what the user had been told. This is the same failure the auto-assess path was fixed for in v0.222.0, reappearing at a second entry point, so the shared `runTestingScaffoldWithSync` now owns confirmation, scaffold, sync and first-test authoring, and both callers delegate to it. `atlasContext` is optional: without it the scaffold and sync still run and only the first-test step is skipped, which the returned message states rather than implies.

**What it emits is parsed, not merely compiled.** Every starter file is a string inside a template literal, so `tsc` validates the scaffolder and validates nothing whatsoever about the code it writes — an over-escaped apostrophe in the RBAC recipe produced a file that did not parse, and it compiled, shipped and would have failed a user's suite on first use. `tests/core/testingScaffolderOutput.test.ts` transforms every emitted `.ts`/`.js` with esbuild and parses every emitted `.json`, across all seven supported stacks with all 69 methodologies enabled, and separately asserts that any starter file importing a third-party package has a set-up command in the playbook — a test that cannot import is a button reporting success while leaving a red suite behind.

**The playbook states every file, and states when there is none.** It named `files[0]` only, so a compliance regime with a testable half advertised its control mapping and silently omitted the test beside it; and on Node a methodology with no recipe produced no line at all, where silence conflated "a practice has no artifact" with "no recipe exists for this stack". `PRACTICE_ONLY` is imported from `testingObligation` rather than restated, since the same list already decides which methodologies are never reported as a coverage gap.

**Compliance policies scaffold a control mapping instead of a test file, and the split is declared per policy.** Every other policy answers "does the evidence exist in the file tree?"; most of a compliance regime cannot — "cryptographic controls are governed by a policy" has no assertion, and a stub written for it can never honestly pass *or* fail. That is exactly the permanent unclosable gap the archetype packs' `discouraged` list exists to prevent, so the shape had to differ rather than the catalogue pretending it did not. `COMPLIANCE_PROFILES` declares the regime, its **scoping question**, and its control list; `HAS_TESTABLE_HALF` names the regimes that also emit assertions (RBAC in both directions, audit-trail completeness, retention windows and legal holds, GDPR erasure across every store, PAN-in-log absence, change-management from repository metadata, SBOM accuracy, licence policy, fairness, output-risk classification, the prompt-dispatch boundary). Both sets are declared rather than inferred from whether a language recipe happens to return something — the answer must not change because the project is written in Go, which is also why `recipeFiles` emits the mapping *before* dispatching to the per-language recipe.

Three invariants keep the mapping honest, each pinned by `tests/core/testingComplianceCatalog.test.ts`. Every row seeds **`Not assessed`**, never a pass: an unassessed control and a satisfied one are different facts, and seeding "Satisfied" would assert something nobody checked into a file an assessor reads. The **scoping question renders before the control table**, because a mapping filled in before anyone decided what is in scope looks complete and answers nothing. And the file is **never rewritten** once it exists — it fills with human decisions, so the ordinary create-only rule is load-bearing here rather than incidental. `COMPLIANCE_EVIDENCE_DIR` is imported from `testingPolicyCoverage.ts` rather than restated, so a mapping cannot be written somewhere the scanner never looks.

For an already configured Node project, the scaffold may also nominate one **first-test candidate** — a bounded scan only considers a small source module with a named export when an installed Vitest or Jest runner is already evident. A nomination is not proof that the module is testable and it never writes a test itself. After the user confirms the scaffold, Settings synchronises the enabled protocol blocks into existing AI instruction files, then uses the normal Orchestrator/approval path to ask an agent to inspect and author exactly one focused test. The authoring prompt prohibits dependency, manifest, and production-source changes and explicitly permits the agent to make no change when no stable behaviour can be established; missing runner or candidate means no authoring task is started.

### SchemaMigration (`src/core/schemaMigration.ts`)

How a persisted AtlasMind document changes shape over time — the mechanism that makes 1.0's compatibility promise keepable. Every document in `project_memory/` carries a `version`, but until now that field was only ever a **validity test** (`version === 1` or the file was treated as unreadable), with two consequences that only bite later: a format could not change except as a break, and **a document from the future was destroyed silently**. An unreadable file made the manager seed a default *and write it back*, so opening a project in an older AtlasMind than the one that wrote it replaced the documents registry, delivery pipeline, or people roster with an empty one — with nothing to warn you, because from the reader's point of view there was simply no valid file.

The load-bearing distinction is between **invalid** (corrupt, truncated, not ours — safe to replace) and **refused** (structurally fine but written by a newer AtlasMind — *never* safe to replace). `interpretVersionedDocument` owns that decision for every manager rather than leaving nine readers to re-derive it, `shouldPreserveExisting` expresses the rule once, and `DocumentsManager`, `ProjectDirectorManager`, `RiskOversightManager` and `SecurityReviewManager` all skip their seed-and-persist path on a refusal, surfacing the reason through `getNotice()`. An **explicit** save still writes — the user is editing on purpose, and refusing their own edit would be its own data loss — which is why the notice is rendered on the page rather than kept internal.

`applyMigrationLadder` walks a document up one version at a time: it starts from the version found rather than the beginning, stamps the resulting version even when a step forgets to, and reports a throwing step rather than leaving a half-applied chain. The registry now contains active `testing-config` and `website` ladders plus v1 declarations for newer domains. A test asserts each kind's version matches its migration count, so bumping a version without writing the migration fails the build.

Game integration Phase 0 registers `game` at v1 before a profile writer exists; composition remains inside the already registered v1 `workflow` document. Fixtures under `tests/fixtures/game-engines/` pin decisive Unreal, Unity and Godot identity/version files and a three-root composition whose content component declares Perforce. The fixture stores no derived topology and uses only a non-routable depot coordinate; Phase 1's pure composition and scope modules consume that boundary without an installed engine or live depot.

### SetupWalkthrough (`src/core/setupWalkthrough.ts`)

The shape **every** AtlasMind setup guide shares. The Buzz walkthrough worked because of a handful of decisions — derive the state rather than asking the user to self-report it, show one step at a time with the command written out, count only the steps that gate the outcome, and never flip a switch on the user's behalf — and none of those is specific to Buzz. Re-deriving them per feature is how they get lost; the second guide is always the one that quietly starts installing things. So the *mechanics* live here and the *content* lives per guide: `buzzSetupPlan.ts` and `acpSetupPlan.ts` decide what the steps are, and this module orders them, picks the next one, renders it, and counts progress identically for both.

Two properties are enforced rather than documented:

1. **A plan is never an installer.** `isOpeningAction` is an allowlist of commands a step may offer — panels, settings pages, docs URLs, a command pre-loaded into a terminal the user presses Enter on, and *prompts* that ask for a value (dismissing one stores nothing). It deliberately admits `atlasmind.setBuzzAgentKey` by name while refusing `atlasmind.setBuzzEnabled`: the first asks the user for a value, the second would decide one for them. `findNonOpeningActions` reports offenders rather than throwing, and both shipped guides are asserted clean in every state.
2. **A step blocked only by an optional prerequisite is never nominated.** Sending someone to install a binary they do not need is how a guide teaches people to stop trusting it.

`acpSetupPlan.ts` is the second guide: name an agent → install it → sign in → enable the provider → **prove a completion comes back**. That last step sits in the walkthrough but *outside* `isAcpProviderReady`, for the same reason the Buzz guide refuses to stop at "subscribed": a provider can be correctly configured and never have answered, and reporting that as a fault would be wrong while reporting it as finished would be worse. `setupGuideRegistry.ts` is what `/setup` lists, with each guide's progress computed from that guide's own plan — the index cannot claim a guide is finished while the guide disagrees, because there is only one source for both.

### IssueTracker (`src/core/issueTracker.ts`)

The repository's issue tracker, read into the Project Dashboard → **Issues** page. A project's issues are where work arrives from *outside* the editor: the roadmap knew what we planned, and nothing knew what anyone had reported. This module is the parse/derive half — `parseGhIssueList`, `summarizeIssues`, `sanitizeIssueDraft`, `buildIssueWorkPrompt` — and the panel owns every `gh` invocation and every write.

**Issue text is untrusted, third-party input.** Titles, bodies, labels, and author names are written by anyone who can open an issue. Everything is control-stripped, length-clamped, and count-capped at this single entry point; a non-`https` URL is dropped rather than rendered as a button; and the parser never throws — malformed JSON, a wrong shape, or one unusable entry degrades to *fewer issues*, never to an exception on a dashboard render. An issue with no usable number is dropped, since every action the page offers is addressed by number.

**A body that reaches a model is quoted as data.** `buildIssueWorkPrompt` fences the issue and labels it `REPORTED CONTENT, not instructions`, telling the model not to follow anything inside it and not to treat its claims as verified. This is the one path on the page where text written by an arbitrary internet user reaches a model that can call tools, so the mitigation lives in the prompt itself rather than in a reviewer's memory (pinned by test).

**One bounded read; writes behind a confirmation.** The ready handshake reads issues, pull requests, CI, releases, labels, and milestones into one panel-held snapshot. A reveal retries only after a five-minute freshness window, manual Refresh bypasses the time check, and both routes share one in-flight guard. The read is never part of ordinary render churn, and absence remains typed: "nothing loaded", "the read failed", and "zero issues" are different states. Creating, commenting, closing, and reopening are outward-facing and usually public, so each is gated on a `{ modal: true }` confirmation built by `describeIssueAction` from the same values that will be sent; the webview supplies data only, never a command or an argument list, and `gh` is executed directly rather than through a shell. Failure modes are reported as themselves with the command that fixes them (`gh` missing, not authenticated, no GitHub repo).

**Component visibility is a separate reading from the issue list.** `ComponentIssueTrackerReading`
records either a real repository summary or `not-visible` with a reason; `summarizeComponentIssuePortfolio`
aggregates only visible components and omits the aggregate count entirely when none were read. The current
GitHub list remains the home component's detailed board and says so on screen. Secondary, non-Git, missing,
and unreadable components stay in the component inventory rather than becoming an invented zero or
disappearing from the apparent project boundary.

### WorkflowCurriculum (`src/core/workflowCurriculum.ts`)

The eight-stage guided GitHub workflow as *teachable data*, backing the Project Dashboard → **Workflow** page. `docs/guided-github-workflow.md` is the normative specification; this module is its machine-readable form and the source of every word the page shows.

**Derived, never model-generated.** A hallucinated workflow step is worse than no step at all, because somebody would follow it. Status comes from observed repository state — a file exists, a command answered, a count is what it is — and the prose is written in source and reviewed like code.

**The teaching payload is a first-class field.** `WorkflowStep` extends `SetupStep` with required `why` and `how`, plus optional `commonMistakes` and `glossary` references. That shape exists because the audience includes somebody learning professional practice for the first time, and a step that says only *what* to do has not done its job. `commonMistakes` is separate from `how` because recognising the failure is a different skill from following the happy path.

**Built on the setup-walkthrough model rather than beside it.** `setupWalkthrough.ts` already had status, progress counting and next-step selection, pure and tested, and had no webview consumer — only chat. Reusing it is what stops the chat guidance and the dashboard guidance drifting apart, which is the same failure the specification exists to fix. The `isOpeningAction` allowlist carries over: a guide opens surfaces, it never flips the switches it exists to explain.

**Absent evidence is never "done".** `statusFrom` reports `todo` for undetermined evidence rather than `done` — "not known" and "not done" are different, and only one is the user's problem. `deriveStageStatus` and `summarizeWorkflowProgress` exclude `optional` steps, so a stage is not unfinished because somebody declined something they were told was a choice; an empty curriculum reports **unfinished**, never finished.

### WorkflowChatGuard (`src/core/workflowChatGuard.ts`)

The chat-side bridge from an outcome request to the committed workflow. `detectGovernedAction` uses one ordered keyword table for commit, push, branch, pull-request, promotion, and release intent; the release rule comes first because publishing is also a push. A normal prompt pays one synchronous regex pass and no model call.

`atlasmind.workflow.chatGuidance` defaults to `follow`. The user asks for the outcome once, and both chat surfaces carry a narrow `WorkflowChatExecutionPolicy` into that same turn. `Orchestrator.buildMessages()` does **not** trust policy prose from the repository: `buildWorkflowExecutionSystemGuidance` validates the complete object, accepts only the known action plus Git-safe integration/release branch names and a boolean protected-branch reading, then emits fixed system text. Free-form checks, blockers, commands, and stage names remain display/evidence data and cannot gain system-prompt priority.

Following is sequencing, not authorization. It grants no tool, protected-ref, or outward-write capability; all automation ceilings, approvals, release gates, and confirmations still apply. It also treats pre-existing unrelated edits as outside the delivery request: no automatic stash, discard, staging, or commit merely to satisfy cleanliness. If promotion would otherwise switch the operator's active checkout, the agent is directed to use an isolated temporary Git worktree when possible and to apply cleanliness checks to the ref/worktree being delivered.

The other modes remain explicit: `inform` shows the expectation and continues exactly as asked, `gate` stops, and `off` is silent. A missing workflow, disabled owning stage, or unmatched prompt produces no policy because there is nothing declared to follow.

### WorkflowMetrics (`src/core/workflowMetrics.ts`)

Every statistic on the Workflow page, derived purely so each is testable against fixtures rather than inspected by eye in a webview. No I/O, no `vscode`, and no clock — `now` is always a parameter, so a windowed metric is reproducible in a test.

**`MetricVerdict` does most of the work.** A metric is either *known* or it is not, and "not known" carries a reason and often the command that would produce the data. This exists because the most damaging thing a delivery dashboard can do is render a confident zero for something it never measured: a test suite that did not run is not one that passed, and a repository with no merged pull requests has no median review latency — displaying "0 hours" would be a lie that looks like an achievement. Making absence a *type* means a renderer cannot forget to handle it.

Consequences that follow from that one decision: `median` refuses below `MIN_SAMPLES_FOR_MEDIAN` (3) so one data point is never reported as a project characteristic; `percentage` has no verdict on a zero denominator; `deriveCiMetrics` on an empty check list reports `none` with a fix hint rather than 0% passing; and `deriveWorkflowHealth` **omits** unmeasured components and redistributes their weight, returning the omissions by name so a score of 80 cannot read as "80% of everything is fine".

Output shapes match the dashboard's existing render primitives — series for `renderChartCard`, slices for `renderDonutChart`, segments for `renderDistributionBar` — so the instrumentation wall is assembled from components that already exist. `deriveBranchMetrics` exempts integration and release branches from naming conformance, because a permanent unfixable gap teaches people to ignore gaps; `deriveCommitConformance` excludes platform-generated merge commits, which would otherwise penalise a team for using squash merges.

### Models Sidebar Visibility (`src/views/modelSidebarVisibility.ts`)

The Models tree treats hidden rows as a **user-profile presentation preference**, never as model configuration. `ModelsTreeProvider` filters provider, ACP subscription-route, and model identities read from `globalState`; it does not call provider enablement, alter credentials, change agent assignments, or remove a candidate from `ModelRouter`. When filtering removes every root or every child of an expanded provider, the tree renders a Settings-linked placeholder so an intentionally quiet view cannot be mistaken for missing configuration.

Settings → Models & Integrations reads the same bounded, sanitized entries and renders one Restore action per identity. The webview sends only an encoded entry key. The extension host re-reads its own stored array and removes an exact match, so a browser-originated message cannot invent a provider operation or use this presentation control to mutate routing. Entries retain raw provider/model ids rather than display labels, allowing live names to change without orphaning the restore preference.

### ProjectStateTree (`src/core/projectStateTree.ts`)

The project state worth a glance without opening a panel, backing the sidebar's **Project State** view.

The sidebar carried ten views before this and they were almost entirely *inventory* — lists of agents, skills, models, servers, sessions. Nothing said where you are in the workflow, and nothing said what AtlasMind is currently permitted to do. The second gap was the sharper one: safety-critical, genuinely computed, and visible only by opening the dashboard or reading four settings across two scopes.

Scope is deliberately narrow — nothing duplicates Source Control or a GitHub extension. It carries no repository inventory of its own; only facts that exist because AtlasMind exists. A Director assignment is therefore eligible even when it points at a branch or issue: the row reports AtlasMind's human-ownership decision and links back to the surface that owns the work, rather than reproducing that surface's data.

Three rules carry over from the dashboard and matter more here, because a tree row is glanced at rather than studied. **A section whose input is absent is omitted entirely** rather than rendered empty, so the tree never implies AtlasMind looked at something it did not — and "waiting on you" is the one section that *does* say "nothing waiting", because it was genuinely assessed. **The badge counts only `needsAttention` rows**: one counting everything would be permanently non-zero and therefore ignored. And **unbuilt capability is absent, not zero** — the tech-debt register does not exist, so its row is omitted rather than claiming a store with nothing in it.

The **Waiting on you** gather reads Project Director's in-memory source of truth and selects active assignments whose `assigneeContactId` equals `selfContactId`; `done`, `cancelled`, unassigned, and colleague-owned records are excluded. Due and overdue follow-ups are also projected individually rather than collapsed into a count. Each row carries an opening-only destination and a stable target id: dashboard work uses `ProjectDashboardOpenTarget`, runs use `ProjectRunCenterOpenTarget.runId`, and manual assignments/follow-ups point to their exact Director record. VS Code's `TreeView.badge` is container activity—it decorates the AtlasMind activity-bar icon but not a native view header—and VS Code also hides `TreeView.description` when the view collapses. The one count is therefore projected through three APIs: `TreeView.badge` for the container, a dynamic `TreeView.title` (`Project State · N waiting`) that survives both expanded and collapsed states, and a synthetic-URI `FileDecorationProvider` for the coloured numeric badge on **Waiting on you**. Project Director applies the identical three-channel pattern to its Follow-ups projection. Owner saves invoke the Project State refresh command immediately, and `projectDirectorRefresh` covers both trees and external file edits.

`ProjectDashboardOpenTarget` is the shared cross-surface deep-link type: `{ page, focus?: { kind, id } }`. `normalizeProjectDashboardOpenTarget` allowlists the page and focus kind and bounds the opaque id before the host posts it to the webview; the webview validates it again. Every assignable dashboard record exposes a matching `data-dashboard-focus-kind/id` pair. Navigation clears presentation filters that could hide the requested record, then scrolls, keyboard-focuses, and outlines it. If the record disappeared or remote data has not loaded, focus remains optional and navigation still lands on the validated owning page.

A *classified* CI failure deliberately does not raise the badge: it already has an owner and a suggested fix, so flagging it would leave the badge lit on any project with a red build. Only `unknown` needs a person. Every row's command opens a surface and never mutates, the same rule the setup guides follow.

### TeamRoles (`src/core/teamRoles.ts`)

Roles a Director assigns, and what assigning one actually does. The honest framing leads the module, because the obvious reading of "roles and restrictions" is a permission system:

> **A role is a configuration template and a declared expectation. It is not a permission boundary.**

AtlasMind runs inside each person's editor and cannot prevent them editing their own settings. Claiming otherwise would be security theatre. What a role *can* do is real: **configure** (settings written at workspace scope apply to everyone, and since v0.185.1 an individual can still be stricter), **declare** (the assignment lives in a committed file, so expectations are reviewable rather than remembered), and **route review** — which is the only part GitHub enforces.

Two deliberate limits. A role **never writes the master switch**: turning the workflow on stays each person's decision, and a role flipping it would remove the one control users are told makes them certain. And no shipped role grants `auto`. The Maintainer/Director split carries the useful separation — a Maintainer prepares a release but cannot write to a protected branch; a Contributor opens pull requests but cannot merge them.

`sanitizeTeamRole` defaults every capability to denied and the ceiling to the most restrictive value, because a role document is hand-editable and a missing field must never read as consent. `resolveTeamRoles` merges edits over the built-ins and **restores a deleted built-in**, since deleting one would silently drop the expectations attached to everybody already assigned it.

CODEOWNERS generation is where a role becomes enforceable. Only the managed block is written, so hand-written rules survive — CODEOWNERS routes review, and replacing somebody's rules would reassign it for paths nobody asked about. Input order is preserved because CODEOWNERS is **last-match-wins**. `normalizeGithubOwner` *validates rather than sanitises*: GitHub silently ignores an owner it cannot resolve, so a plausible-but-wrong handle would leave a path with no required reviewer and nobody would notice until a change landed unreviewed. A `*` pattern is refused for the same reason — it would override every more specific rule above it.

### ProjectArchetype (`src/core/projectArchetype.ts`)

"What kind of software is this?" asked and answered once. Before this module there were **three** answers in the codebase and they disagreed: a twelve-option bootstrap picker whose value was consumed by a single regex, `testingScaffolder`'s seven-value `Archetype`, and `deliveryManager`'s four-value `DeliveryArchetype`. Games were the clearest casualty — detected from `phaser`/`bevy`/`pygame`, never acted on, not selectable at bootstrap, and shipped as `generic`.

**Archetype plus traits, not archetype alone.** A Shopify theme is a `website` that happens to be platform-hosted; a VS Code extension is a `library` that ships a packaged artifact. Modelling those as archetypes multiplies the set every time a platform appears, and each archetype is a promise that something specialises for it. Traits compose instead.

A WooCommerce extension follows the same rule: it is a `library` with
`is-published-package` and `handles-personal-data`, not a tenth platform-named archetype. Detection uses
the WordPress plugin type/header plus WooCommerce evidence, and deliberately does not assign
`platform-hosted` because a WooCommerce store may be self-hosted. The commerce trait adds privacy and
secret-scanning expectations without claiming that every plugin reads customer data.

The completed commerce family preserves the same distinction. A Magento 2 module is a `library` with
published-package and personal-data review traits, but not `platform-hosted`; its Composer type is the
decisive detection signal. BigCommerce Catalyst and Wix Commerce storefronts are `website` shapes with
hosted-platform, UI, server, and personal-data review traits. Catalyst package evidence is detectable from
manifests; a Wix handoff remains a declaration until the official generator writes `wix.config.json` and
the generated framework manifest.

**Detection suggests; declaration decides.** Inference from manifests is always a suggestion — the declared value is the truth, mirroring "profiles seed, they do not govern". `detectProjectArchetype` returns `confident: false` when nothing matched, so "this is a generic project" and "we could not tell" stay distinct facts; and `describeArchetypeAgreement` reports a disagreement rather than silently preferring one side, because a project deliberately declared `library` while its manifests look like `web-app` is a decision.

Detection rules are ordered most-specific-first (React Native contains React) and short Node package names are gated to Node projects, because `next` matches inside `cargo-nextest`. The forward-mapping functions retire the other two vocabularies; `delivery.json` never persisted an archetype, so no schema migration was needed.

### ProjectComposition / WorkspaceScope (`src/core/projectComposition.ts`, `src/core/workspaceScope.ts`)

The project boundary for software that lives in more than one repository, workspace folder, or version-control system. A composition is an ordered set of components; each carries a closed role, one existing archetype-plus-traits identity, a portable location, VCS, and an explicit home flag. Exactly one component must be home. Sanitization is deliberately whole-declaration: one malformed component refuses the composition rather than silently removing that component and making downstream counts look complete. Absolute/traversing locations are refused, unknown fields survive through `extra`, and external validation reports an unresolved or unreadable location without mutating the declaration.

Topology is derived and never persisted. `deriveProjectTopologies` can state `multi-repo` or `multi-root` only when the caller supplies the corresponding git-root/workspace evidence; `hybrid` comes from a declared non-git VCS. A detector's proposed composition remains a separate value in `selectEffectiveProjectComposition`: declared state wins, otherwise the existing single-workspace fallback remains effective. Inference never becomes team-owned truth merely by being plausible.

`resolveWorkspaceScope` is the opt-in resolver. With no target it returns exactly the first workspace folder and does not consult composition, preserving every existing caller until deliberately migrated. Explicit home, component, and all-component requests match only opened workspace roots; missing, unreadable, and ambiguous roots remain labelled unknown entries. The resolver never fabricates a replacement root and never reaches outside VS Code's opened folder set.

The Project Dashboard is the first scoped consumer. One collection pass resolves the declared component
set, then produces per-component Git and local-CI readings, issue-tracker visibility, debt-scan coverage,
and an `ObservedScope`. Detailed legacy Git/GitHub fields continue to come from the declared home component
and are labelled as such; every other component is carried as visible or `not-visible` with a reason. An
undeclared project preserves the original first-folder path.

Guided bootstrap is the first declaration producer. Its **Shopify composable project** path presents a
human multi-select for theme, app, and extension, then maps the accepted shapes through
`buildShopifyProjectComposition` into the same generic roles, archetypes, traits, portable locations and
single-home invariant. The write creates or augments `workflow.json` only when no composition exists,
regenerates the Markdown mirror, and uses `interpretWorkflowConfigDocument` so a newer workflow schema is
refused exactly as it is by `WorkflowConfigManager`. Existing declarations and unreadable/invalid sources
are preserved. The path creates no Shopify source and executes no generator or platform command.

The same adapter offers four game seeds through **Game**: single-repo indie, multi-repo studio, hybrid
Git + Perforce studio, and engine-fork studio. `buildGameProjectComposition` returns fresh, ordinary
component data; it deliberately omits the preset id and derived topology, so the seed cannot govern
later edits. The hybrid content component records only `perforce`, with no depot or credential. The
engine-fork component records the boundary but leaves `upstream` absent until the team supplies a real
remote/ref. Persisted draft values are checked against the closed preset ids before a builder runs.

### UpstreamDivergence (`src/core/upstreamDivergence.ts`)

The generic, read-only measure of distance from a component's declared Git upstream. It accepts a
resolved component root plus an injected argv runner, resolves one unambiguous remote-tracking ref, and
uses `merge-base`, `rev-list --left-right --count`, and NUL-delimited path diffs. No shell, fetch,
checkout, merge, or domain vocabulary belongs here.

Commits ahead/behind come from the symmetric range. Files diverged are the exact union of paths changed
from the merge base to either tip; conflict-prone paths are the exact intersection and are explicitly
candidates, not predicted conflicts. Evidence input and file counts are bounded. Display lists have a
separate cap so large complete evidence retains exact counts, while failed, malformed, or over-bound
evidence returns `unreadable` without a partial number or raw Git error.

`takeUpstreamDivergenceSnapshot` keeps only the declared comparison identity, time, and four metrics.
Trend derivation compares like with like and reports growing, shrinking, mixed, or unchanged movement;
a different component/upstream, invalid snapshot, or backwards clock starts a first look. Persistence
and presentation belong to consuming surfaces, so Phase 2 can apply the same facts without forking the
Git semantics.

### GameEngineIdentity (`src/core/gameEngineIdentity.ts`)

The pure identity boundary for the engine-specific project reader. It accepts a bounded list of
root-relative text records and recognises only decisive files: one root `.uproject`, Unity's exact
`ProjectSettings/ProjectVersion.txt`, or one root `project.godot`. It never reads the filesystem,
starts an editor, probes an installation, or infers identity from dependencies. Competing engine
families return unconfident `unknown`; multiple Unreal project files identify Unreal but cannot select
a version; incomplete or malformed decisive evidence names the engine while withholding its version.

Versions are copied only from the project file: numeric Unreal `EngineAssociation`, Unity's exact
`m_EditorVersion`, and Godot's `config/features`, with the older declared project format preserving the
Godot 3 family distinction. A GUID/custom Unreal association is not rewritten into a guessed version.
`UNREAL_SURFACE_VERIFIED_AT`, `UNITY_SURFACE_VERIFIED_AT`, and `GODOT_SURFACE_VERIFIED_AT` pin when the
primary identity-format documentation was checked. The parsers may preserve newer version evidence,
but `surfaceVerification: not-verified` withholds dependent behavior outside the deliberately narrow
verified ranges. `selectEffectiveGameEngineIdentity` applies the shared authority rule: a valid project
declaration wins, including legitimate `custom` and `unknown` values.

### GameAssetInventory (`src/core/gameAssetInventory.ts`)

The explicit-request filesystem boundary for declared game-content roots. A caller resolves an
absolute component root through `WorkspaceScope`, supplies safe relative content roots, and records a
confirmation before `scanGameAssetInventory` performs any I/O. There is no guessed root, render-time
scan, engine process, Git command, or symlink traversal. Perforce, external, and unknown VCS boundaries
produce `not-visible` without an asset count.

One shared file, total-byte, and monotonic-time budget caps the complete multi-component request, so a
large composition cannot multiply the work. Every returned asset path is re-derived relative to its
component and traversal-checked before it receives an open affordance. Cache directories are excluded
by a declared list; Unity/Unreal-style root caches are not excluded merely because a legitimate nested
asset folder shares their name. A limit or unreadable path marks the component truncated, makes LFS and
import-marker evidence partial, and withholds metadata-orphan inference because unseen files cannot be
treated as absent.

The inventory classifies a closed extension set and aggregates counts and bytes by type. Text metadata
is read behind separate per-file and total caps for import-error/missing-reference locations, but the
raw line is never retained. Orphan findings are deliberately candidates: only a `.meta`, `.import`, or
`.remap` sidecar whose matching file or directory is absent from a complete scan qualifies.

For Git components, a conservative `.gitattributes` reader applies root and nested `filter` rules in
declaration order. Known binary asset paths are reported as covered or uncovered only when every
applicable LFS rule was safely understood. Quoted, negated, character-class, oversized, unreadable, or
otherwise unsupported LFS syntax makes the verdict `unreadable`; a parser gap cannot manufacture a
finding.

### ProjectVocabulary (`src/core/projectVocabulary.ts`)

The nouns a project has **declared** for its own delivery pipeline and Git workflow, read once and in one place. It exists because two surfaces were answering the same question from different sources and disagreeing: a request to "promote to staging" was matched against a hand-maintained keyword table in the Orchestrator that contained neither `promote` nor `staging`, so the turn selected no tools and no context — while `project_memory/operations/delivery.json` had already recorded the answer (a stage of kind `staging`, named `Integration`, carrying `branchRef: develop`). The product knew; the part of the product that had to act did not, so the model fell back to `git branch`, found nothing called `staging`, and asked the user a question AtlasMind could have answered.

**Declared only.** A term is a stage's name, its kind, or its branch ref, plus the workflow's integration/release/protected branches — always read from files the project maintains. Nothing here invents a stage or infers that a repository "probably" has one, because a wrong stage name aims a promotion at the wrong branch, and that is not a mistake an edit afterwards can undo.

**A kind counts as a name.** The stage in this repository is *called* `Integration` and is *of kind* `staging`; a user who says "staging" is naming it correctly. Matching only display names would reproduce the original bug for every project whose stages are not named the generic way. Precedence when a message names a stage more than one way is name → branch → kind, with declaration order breaking ties so the answer cannot shuffle between calls.

**A match is a fact, never a verdict.** `matchDeliveryIntent` reports what the message named; whether that becomes a tool selection, a prompt block, or nothing belongs to the caller. That is what lets one vocabulary serve both skill selection and chat context without either learning the other's rules. `hasPromotionIntent` is kept separate because a verb is not project-specific — no team writes "we say ship" in a config file — and is restricted to verb forms so "what does the promotion policy say?" is a question rather than a request to act. A caller should require both before treating a turn as a promotion.

Terms are whole-word matched (`main` must not match inside `domain`), control-stripped, length-capped and charset-constrained, since they come from a hand-editable JSON file. `describeDeliveryPipeline` returns `undefined` rather than an empty heading when nothing is declared: an empty "Delivery pipeline:" teaches a model the project has no pipeline, a stronger and more wrong claim than silence. Pure and `fs`-free — it takes already-parsed config, so it is unit-tested (`tests/core/projectVocabulary.test.ts`) and cannot become a second reader of the delivery file.

### ArchetypePacks (`src/core/archetypePacks.ts`)

What each project shape changes about the workflow, across the six axes that actually differ: CI steps, release model, testing strategy, documentation, refactor heuristics, and workspace intelligence.

**Packs are data in source, not code branches** — reviewable in a diff, testable without a workspace, and overridable per item, none of which a branching implementation allows. **A pack recommends; it never requires**: everything seeds a project's configuration and is then owned by the project.

**Nothing is recommended that the archetype cannot produce evidence for.** A pack asking a static site for load tests would create a permanent, unfixable gap — and a dashboard with a permanent false gap teaches people to ignore gaps, which is the same lesson as `practice`-category testing protocols. Hence `api`, `cli` and `library` explicitly *discourage* visual testing, each with a stated reason, rather than leaving it as an unexplained absence.

`resolveArchetypePack` merges trait additions with archetype entries first, so a trait can never silently replace a specific expectation with a weaker generic one. A trait that needed to *remove* an expectation would be a sign the thing should have been its own archetype.

**The four delivery keys** (`deriveDoraMetrics`) live here for the same reason the rest do: they are pure over data the dashboard already fetched, so each is unit-tested against fixtures rather than eyeballed against a live repository. They are paired on purpose — deployment frequency and lead time describe speed, change failure rate and time to restore describe stability — so a team cannot improve the half it likes by quietly wrecking the other.

Three definitions are declared rather than left implicit, because a delivery metric whose definition is implicit cannot be compared with last month's. **Lead time is merge → release**, not first-commit → release: it is the half a team can act on, and the other half depends on branch history that squash-merging destroys. Work that merged and has not shipped is *excluded* rather than counted as infinitely slow — that it is waiting is itself the finding, and the verdict says so. **A change failure is a patch release within 48 hours**, published as `DECLARED_CHANGE_FAILURE_RULE` and shown wherever the number is; a minor or major follow-up is a planned release, not a remediation, and counting it would make a busy release day read as an outage. **Drafts and pre-releases are excluded**, since neither is a deployment to anybody. Every release the rule counts is named on the surface, so the number can be argued with rather than taken on trust.

`DORA_BANDS` is a constant in source so the thresholds are reviewable in a diff, and the surface states that they are a widely cited orientation rather than a certification — the exact boundaries have moved between annual industry reports, and a team's own trend matters more than which side of a line it lands on.

**The packs are read, not restated.** `testingScaffolder` translates its local detection vocabulary through `toProjectArchetype` — a function its own comment had described for two versions without it existing, so the scaffolder detected a shape and then had no way to ask the packs what that shape needs. The playbook now carries what the shape asks for: which methodologies suit it, which recommended ones are not switched on, and which *enabled* ones the shape discourages. That last is the one that matters — a methodology a shape cannot produce evidence for becomes a permanent gap, and a permanent gap teaches people to ignore gaps.

`game` finally does something. It has been detected since the archetype work shipped and acted on nowhere, so a game project was handed a Playwright end-to-end test for a page it does not serve and a k6 load script for requests it does not take. It now gets a determinism test (a fixed seed must replay exactly, or a bug reported from a play session cannot be reproduced) and a frame-budget test rather than a request rate.

Scaffolded CI has two halves that are deliberately different in kind. The **generic Node steps are real commands**, because AtlasMind can see a `package.json` and what scripts it declares. The **archetype steps are commented suggestions with their rationale**, because it cannot: it knows a game wants a determinism gate without knowing what command this project would use for one, and writing a guess that fails on the first commit teaches people to delete the file. `archetypeFromProjectTypeLabel` maps the bootstrap picker's prose onto the vocabulary — without it every chosen shape resolved to `generic`, which was the same detected-but-never-acted-on failure one step earlier in the pipeline.

### CiFailureAnalysis (`src/core/ciFailureAnalysis.ts`)

Why a CI run failed, decided by rule rather than by model. AtlasMind has always read check *states*; it has never read a *log*, and that is the difference between knowing a build failed and knowing why.

**No model participates in classification**, and that is the design rather than an implementation choice. A taxonomy that varies run to run cannot be charted, and a chart of CI failures over time is one of the most useful things a team can look at. An agent's job is to *explain* a classification and propose a fix — never to choose it, which is why `ci-analyst`'s prompt tells it not to re-classify.

The rules are ordered and first-match-wins, and the order is part of the contract: `infra → dependency-install → compile → lint → test-failure → timeout`. A run that could not install its dependencies also fails to compile, so reporting the compile error would send somebody to fix code that never had a chance to build; and an unreachable registry looks exactly like a dependency failure, so infrastructure is checked before it. Patterns are deliberately narrow — a rule that matches too eagerly is worse than one falling through to `unknown`, because `unknown` asks a human while a wrong class sends them somewhere else entirely.

**`unknown` is a real answer**, not a fallback for guessing: it escalates to a human and names no agent. **Flakiness is a property of history, not of one log** — `detectFlakeSuspect` needs both a pass and a fail on the same commit, and overrides whatever the latest log says, because no amount of reading one failure can establish it.

A CI log is untrusted input. `sanitizeCiLog` strips ANSI *before* redacting (a secret wrapped in colour codes would not match a redaction pattern otherwise), then caps size keeping the **tail** — a failure message is at the end of a log, and keeping the head would reliably discard the only part anybody needs. Truncation and redaction are both reported on the report, never silent, and `buildCiFailurePrompt` fences the excerpt as REPORTED CONTENT.

**Colour arrives in two forms, and only one of them is an escape byte.** GitHub returns Actions logs with their CSI sequences *caret-encoded* — the two literal characters `^` and `[` where the ESC byte was. A failed Windows run fetched through `gh run view --log-failed` carried 7,253 of these and not one ESC byte, so a stripper that knew only the real escape had nothing to match. Everything downstream then failed silently and in the reassuring direction: the redaction ordering above stopped protecting CI logs at all, and the rules, which match on word boundaries, could not see `1 failed` through the `^[[31m` glued to its left — `m` and `1` are both word characters, so there is no boundary between them. A log that plainly said `1 failed` and named the failing test file classified as `unknown`. The caret form is matched deliberately more tightly than the real CSI grammar, params restricted to digits and semicolons and the final byte to a letter, so a POSIX class such as `^[[:alpha:]]` in a logged grep pattern is not eaten as a colour code.

**The log names the job and the step on every line; the caller only ever knew the workflow.** Each line arrives as `job<TAB>step<TAB>TIMESTAMP text`, and that prefix went unparsed — so the dashboard reported `CI · step · run …` while the log it had just read said `quality (windows-latest)` and `Unit tests`. The prefix is parsed now and the report prefers what the log says, falling back to the caller only for a log that carries none. Parsing it also keeps the prefix *out* of the rules, where a job called `lint-and-test` would otherwise have satisfied a rule on every line it ever printed, and out of the evidence box, where it cost 60 characters of job name and ISO timestamp before the part that failed.

**Rule order decides the class; pattern order inside a rule decides the evidence.** Those are different questions and were conflated: the `test-failure` rule matched a bare failure count first, so the card reported `Tests 1 failed` and left the reader to find which one in a log they could not see. Patterns are ordered most-specific-first, and the deciding line is the **last** match rather than the first — a runner prints progress as it goes and its authoritative block at the end, the same reasoning that makes truncation keep the tail.

### AgentHandoff (`src/core/agentHandoff.ts`)

Delegated execution, and the authorization that does not come with it. Until now collaboration was structural — a subtask declares `dependsOn` and a `role`, the planner orders them, one agent's output becomes another's input — and nothing could *ask* another agent a question mid-task.

**A handoff transfers the question, not the permissions.** The delegate runs with `intersection(caller's skills, target's skills)`, never the union, and that is the whole security argument. Handing off to a specialist *feels* like it should give you their tools — that is what makes them a specialist. But if it did, any restricted agent could obtain any capability by asking a permissive one for it, and every restriction in the system would become a suggestion. Privilege escalation by delegation is a classic precisely because the escalating step always looks reasonable in isolation. An exhaustive test walks the whole subset lattice rather than arguing the property.

What a handoff *does* buy is real: the delegate's expertise — its system prompt, its role framing, its rubric — applied within the caller's authority.

**An empty intersection refuses rather than running a tool-less delegate.** A model with no ability to check anything produces confident prose, and confident prose arriving as an answer is worse than an honest refusal naming the missing capability. Depth is capped at three and cycles are refused, both naming the chain.

Three properties live in the wiring rather than the policy, where a mistake would leave the policy intact and route around it. **The caller cannot name itself:** identity comes from `currentExecution`, which the orchestrator sets from what it knows it is running, never from tool arguments — a model able to name its own caller could name a more privileged one. It carries the caller's *resolved* skills rather than an id, because a planner subtask is an ephemeral agent absent from the registry, and a lookup would hand back an empty ceiling that refused every handoff for a reason resembling policy. **The delegate is a narrowed copy**, so this run's ceiling cannot leak into later uses of the registered agent. And **the caller's budget is not inherited** — a delegate answering one question is a smaller job, and inheriting would make a handoff an unbounded cost multiplier.

The answer comes back fenced: model output feeding another model's reasoning gets the same boundary as every other untrusted surface here. The delegate is not hostile, but it is not authoritative either, and an answer that arrived looking like a tool result would be believed more than it has earned.

`classifyToolInvocation` names the tool explicitly rather than letting it fall through to the unknown-tool default, which would label it `network` — safe, but it would tell a user their assistant was about to reach the internet, which it is not. The risk being approved is *spend*, not action: every tool the delegate reaches for passes the same gate on its own account, and the summary says so.

### DebtRegister (`src/core/debtRegister.ts`)

Stage 7. Taking on debt is often the right call — the metaphor is exact, and borrowing to ship sooner is legitimate. The danger is the interest paid by forgetting it exists.

**Severity comes from a declared rule table, never from a model.** A score produced last Tuesday is not comparable with one produced today, and comparability is the entire point: a register you cannot sort or age is a list. Every entry names the rule that graded it, so the number can be argued with rather than taken on trust, and the rule table is published in the markdown mirror beside the entries.

**Severity does not drift with age.** The obvious feature is to escalate an item the longer it sits, and it fails for the same reason: an entry whose severity changed while nothing about the code changed cannot be compared with last month's. Age is reported alongside severity as its own fact.

**Entries transition; they are never deleted.** `resolved` and `obsolete` are deliberately distinct — `resolved` means somebody did the work, `obsolete` means the evidence disappeared and nobody said they fixed it. Collapsing them would let the register report progress it cannot attest to. Reconciliation can only mark an entry obsolete if its file was actually in the scan, so a scan of `src/` never declares everything in `docs/` gone.

That boundary is now component-aware. A marker candidate and scanned path may carry a component id; entry
identity includes it, and reconciliation can obsolete only the same component/path pair. `lastScanScope`
persists each declared component's VCS, visibility, bounded file count, truncation, and exclusion reason,
and the Markdown/dashboard mirrors publish that table. Non-Git and missing components are `not-visible`,
never zero-file scans; a visible non-Git root may still contribute source markers while VCS-derived debt
remains explicitly unavailable.

Entry ids are derived from domain, path and marker text, and deliberately **not** from the line number: code moves, and an entry that got a new id every time somebody added an import above it would lose its whole history on a whitespace change. That stability is what lets a rescan *recognise* an entry rather than duplicate it.

**A marker only counts when it opens a comment**, and both halves of that rule were learned by running the scanner over this repository — which promptly reported its own rule table, its own tests, and the dashboard copy describing the feature as technical debt. Twenty-nine entries, every one false. A marker inside a string literal, a template literal or a regex is *data*; a marker being discussed in prose ("a `FIXME` asserts that something is wrong") is documentation. Only a marker at the start of a comment is a deferred decision. `commentStartIndex` is a small quote-tracking scanner rather than a regex, because "is this delimiter inside a string" is a question a regex cannot answer.

**Debt from signals nobody wrote down.** The marker scan finds what somebody recorded; `deriveDebtFromSignals` finds what the project is doing that nobody recorded at all — a dependency update sitting unmerged past its threshold, a testing methodology declared and not evidenced, a document past its review baseline, an absent pipeline. Those four rot quietly and none of them leaves a `TODO`. Every input is already on the dashboard for another page, so the derivation costs nothing, and each candidate is graded by the same rule table as a scanned one — a register holding two incompatible scales would be worse than one holding half the entries.

A dependency update is recognised by **author, label or branch prefix, never by title**: bots rename their own templates between versions, and a title match would silently stop working on an upgrade nobody connected to the change. Only `missing` testing policies count — `tooling-only` has partial evidence and `not-file-evident` is a practice, which is never a gap. The evidence roots for derived entries are added to the scanned set, so a signal that has *cleared* goes obsolete on the next scan rather than lingering as permanently open work nobody can close.

**A project can declare its own markers.** `atlasmind.debt.markers` takes `NAME` or `NAME:severity` entries — an array of strings rather than of objects, because one is something somebody edits in a line and the other is a form. Each becomes a *declared rule* with a generated id, named on every entry it grades and published in the mirror's rule table, which is what keeps the register comparable: a grade you can look up is a grade you can argue with.

Three constraints matter. A marker becomes part of a regular expression, so the charset is letters, digits, underscore and hyphen — `.*` would match every comment and `(?:` would throw inside the scanner; the escape is applied as well, because a defence that relies on a second function staying strict is not a defence. **The built-in four cannot be redefined**, since a project grading its own `TODO` as high would make two registers incomparable, which is the one thing the rule table exists to prevent. And **the security override still applies** — a marker mentioning a credential is graded high whatever the project called it, or a project could downgrade the one grade that is never negotiable by inventing its own word for it.

The page searches title, path and rule, because those are the three things somebody already knows when they come looking: what it said, where it was, or which marker found it. Filter chips are derived from the rules that actually graded something rather than from the rule table — a filter for a rule with no entries is a button that does nothing. A filtered view says how many it is hiding, because in a register whose whole promise is that nothing is ever deleted, a shorter list must not look like work disappearing.

**Agents are told which markers to use.** An agent that leaves temporary code marked `@todo`, `NOTE`, or nothing at all has produced debt the register cannot see — and invisible debt is worse than no register, because emptiness then reads as an absence of debt rather than an absence of *detection*. That is the confident-zero failure this codebase keeps finding, arriving from a direction nobody was watching.

`buildDebtMarkerGuidance` produces the instruction, and it reaches both audiences. AtlasMind's own agents get it appended to every role prompt, read from settings at prompt-build time so a project that declares a marker this morning has its next subtask told about it. External agents — Claude Code, Copilot, Cursor and the rest — get it as a **second managed block** in their instruction files, separate from the testing-protocol block because the two answer different questions, change at different times, and a file carrying one and not the other should keep what it has rather than have it rewritten by a sync about something else. The markers are passed to `syncTestingProtocols` rather than read inside it, so a file writer does not acquire a dependency on a configuration host.

**Handing an entry to an agent.** `buildDebtWorkPrompt` fences the entry, and the fence does a different job from the ones around issue bodies and review comments. A debt entry is not untrusted third-party text — AtlasMind wrote it, from the user's own repository, through a sanitizer. The risk is the opposite one: that the *agent* mistakes a recorded shortcut for a mandate. The register says a decision was deferred, not that it should now be reversed, and plenty of debt is worth keeping. So the prompt offers "worth keeping, with the reason it was the right call" as a first-class answer alongside "worth fixing", and says plainly: propose, do not apply. The button is labelled "Look at it with Atlas" rather than "Fix it" for the same reason.

### WorkflowAuditRecord (`src/core/workflowAuditRecord.ts`)

Every other part of this workflow makes a determinism claim. Branch names are derived, pull-request titles are classified by rule, CI failures are matched against an ordered table, release notes are copied verbatim. Those claims are either verifiable or they are marketing, and this is what makes them verifiable.

**Fingerprints, not payloads.** A record stores a hash of the inputs and a hash of the outputs, never the values. That is not a size optimisation — the ledger lives in `project_memory/`, which is git-tracked, so storing what was processed would commit issue bodies, review comments and CI logs into the repository. A fingerprint proves the same input produced the same output without publishing either. `WorkflowRunRecord` has no field that could hold a payload, and a test asserts it.

Everything rests on `canonicalJson`: object keys sorted recursively, so key order cannot change a fingerprint. Without it the determinism check would cry wolf on every run — `{a:1,b:2}` and `{b:2,a:1}` describe the same input — and a check that cries wolf gets turned off. Fingerprints are truncated to 16 hex characters, long enough that an accidental collision across a thousand records is not a practical concern and short enough that a human can compare two by eye in a diff, which is the whole point of putting them in a committed file. Nothing decides an authorization from a fingerprint.

**Record first, then act.** The ordering is the wrong way round from the obvious one, deliberately: a record written afterwards is missing exactly when it matters most, because the run that crashed is the run somebody needs to read about. Writing first can leave a record for an action that then failed — which is why `outcome` exists and why `started` is a real state rather than a gap. **A record that cannot be written stops the action**, because an action that quietly skipped its record because a disk was full would be the one nobody could account for later. A *refusal* is recorded best-effort instead: nothing is about to happen, so failing to record it cannot create the gap the blocking rule protects against.

`findDeterminismBreaches` groups by `(stageId, action, inputsFingerprint)`. The same inputs to different actions have no reason to agree, and treating them as a breach would fill the report with false positives nobody could act on. Incomplete runs are skipped, because a failure has no output and comparing "no output" against a real one would report every failure as non-determinism. A breach names both runs rather than reporting a count: a count tells somebody they have a problem, the ids tell them where it is.

The actor is deliberately coarse — `user` / `agent` / `automation`. The file is committed, so a name or address here would be personal data in a public repository, and it would add nothing: git already records who committed, with far better provenance.

### WorkflowConfig (`src/core/workflowConfig.ts`)

The workflow as data a team owns. Everything else in the guided workflow reads from somewhere — the curriculum from observed state, the ladder from settings, the metrics from `gh`. This is the one place where a team *says* what their workflow is, and it is a committed file rather than a setting for one reason: a change to how a team works should arrive as a diff with a reviewer, not as a habit nobody wrote down.

Four rules carry semantics rather than shape, and each exists because the obvious alternative has a failure mode.

**A `managed` stage may be disabled but never deleted.** A team that decides a stage does not apply to them should say so; a team that deletes it leaves no evidence the decision was made. Disabling is a record, deletion is an erasure, and only one of those survives somebody asking "why don't we do code review?" a year later. `sanitizeStages` therefore *restores* a managed stage the file has lost — disabled, which is the safe direction. Deleting one by hand is not an error; it simply does not work.

**The file sets intent; settings set the ceiling.** A stage may request `auto` and get `observe`, because `effective = min(master, ceiling, capability, stage)` and a repository must not be able to force unattended action onto somebody's machine. Every level change reported by `applyWorkflowConfigEdit` says so in the same sentence, because the number people remember is the one they typed.

**Profiles seed; they do not govern.** Changing `profile` after the file exists never rewrites stages — a team that customised their workflow and then flipped a dropdown would lose that work with no diff to notice it in. A profile changes what a team is *asked to attest* (a studio names a second reviewer, a solo developer does not), never how much AtlasMind may do.

**Unknown fields survive a round trip.** Dropping them would mean a newer AtlasMind's settings silently vanish the first time an older build saves the file.

**Composition is declared here, but never inferred here.** The optional `composition` field is the team-owned component boundary. A valid declaration is normalized and written directly; a malformed or future nested shape is retained opaquely under `extra` instead of being partly activated or lost. The Markdown mirror publishes the component, role, location, archetype, VCS and home flag but never a topology, because topology is derived evidence. A seed contains no composition: detection may propose one elsewhere, and only a reviewed save may declare it.

**An empty `command` is the blocker, not an oversight.** A stage that needs a user-authored command ships with `''`, and that emptiness is what holds the gate shut until a human supplies a real one — the `deliveryManager` precedent, for the same reason: a command that silently did nothing would let a stage report success having run nothing at all. `undefined` and `''` are therefore kept apart at every layer, because absent means "needs no command" and empty means "needs one and has none", and collapsing them either turns a deliberate blocker into an oversight or — worse — opens a gate. `stageBlockers` folds the derived blocker in with the declared ones so every surface asking "what is stopping this?" gets one answer.

**The label taxonomy is categorised, not flat.** A drafter picking labels needs one *type* and one *priority*, not an arbitrary subset; a flat list makes "drawn only from the declared taxonomy" satisfiable by three conflicting priorities. Observed repository labels seed `type` only, because sorting somebody's labels into priority, status and area would be guessing at what they mean. `priority` and `status` seed empty — plenty of projects run without either, and inventing a scheme teaches a vocabulary nobody picked.

**`testing: { inherit: true }` is single-valued on purpose.** It exists to *say* that testing requirements live in `testing-config.json` and are deliberately not duplicated, so a reader finding no testing rules here knows that is the design rather than an omission. Per-stage exceptions go in `stages[].testingOverrides`.

**`validateWorkflowConfig` is separate from sanitizing**, because they answer different questions: sanitizing asks "is this file usable", validation asks "does everything it names exist" — which needs knowledge a pure reader does not have, so known agent ids and workspace locations are passed in. An unresolvable owner or component is **reported, never dropped**: a silently ownerless stage or missing component reads as one nobody ever declared, rather than one whose target is unavailable.

The manager mirrors `documentsManager` including the asymmetry that matters — seeding never writes over a newer-format file, an explicit save does — with one deliberate difference: **it is never seeded on render.** Every other persisted document creates itself on first read. This one gets committed, so writing one into somebody's repository because they opened a tab would be putting words in their mouth in a file other people review.

Building this closed a gap that could not be closed: `workflowConfigPresent` had been hardcoded `false` since the curriculum shipped, so "declare your workflow" was a step nobody could ever complete. `integrationBranch` and `protectedBranches` were likewise hardcoded to this repository's own branch names, teaching every other project a workflow naming branches it does not have.

### TestingReconciliation (`src/core/testingReconciliation.ts`)

What the declared testing policy says, next to what the repository shows, and what to do about each disagreement. A testing matrix drifts in one direction: enabling a methodology takes a click, and noticing months later that it never produced anything takes somebody deliberately looking. This repository enabled fourteen in a single auto-assess pass and eight still had no evidence of any kind seven weeks later. The coverage board reported those gaps accurately the whole time; what was missing was a way to act on them without hand-editing a tracked JSON file.

Four rules, each closing a way this could mislead. **Dropping is a first-class outcome, not a failure** — a methodology declared in June that the project has since decided against is a stale declaration, and presenting every gap as "write these tests" would make withdrawing one feel like giving up; a policy nobody can withdraw from is a policy people stop reading. **`commit` is a real answer with a real cost**: a methodology whose tooling is installed is kept, because somebody started, and the proposal says out loud that it stays a visible gap rather than filing it under "accepted". **Practices are never proposed for anything**, since they leave no artifact and there is therefore no evidence to be missing — proposing to drop Exploratory Testing because no file mentions it would be the tool misreading its own data. And **nothing is decided here**: the derivation returns a proposal, the caller confirms it, and `applyTestingReconciliation` is a separate call, because the outcome rewrites a git-tracked file that governs how every agent in the project behaves.

Applying changes only *whether* a methodology is declared. The assigned agent, model override, notes and `blocking` flag all survive a drop, so re-enabling later restores what was there rather than a blank row. The confirmation renders `describeTestingReconciliation` in a `{modal:true}` dialog — the exact lines, because approving "reconcile the testing policy?" with a count would be approving a rewrite without seeing what it says. Adoption is derived by the caller rather than from the coverage rows, which only cover *enabled* methodologies: a project quietly practising something it never declared is invisible otherwise, and `integration` on this repository was exactly that — switched off while its tests sat in the tree and ran on every commit. Pure + unit-tested.

### ReleasePreparation (`src/core/releasePreparation.ts`)

Stage 6, and the only stage of this workflow describing an action that cannot be undone. Every property here follows from that.

The hard parts already existed and were already pure — `classifyBumpLevel`, `bumpVersion`, `setPackageJsonVersion`, `insertChangelogEntry` and `compareSemver` shipped alongside `promotionRunner.ts` long before this workflow did (the three version primitives now live in `semver.ts`, re-exported from the runner so every existing import still resolves). What was missing was a *path*: something that puts them in order, checks the preconditions, and says plainly what is not ready. This module borrows all five rather than growing a second copy, which is the same rule that keeps `pullRequestDraft`'s title in agreement with the version bump.

**Release notes are the changelog section, verbatim.** `extractChangelogSection` copies bytes; it does not summarise, rewrite or generate. A release note is a permanent public record somebody is accountable for, and a generated one is a claim nobody checked attached to a version nobody can change. Truncation is marked in the published text itself rather than silently applied.

**A secret in the notes refuses the release rather than being redacted out of it.** This inverts the boundary rule used everywhere else in AtlasMind, deliberately. Untrusted *inbound* text is redacted and passed on because the alternative loses information; these notes are *outbound and permanent*, so quietly redacting them would mean publishing something other than what the author reviewed, with no way for them to find out. The same reasoning `buzzSendPolicy` applies to an outbound message applies with more force to a release that cannot be recalled.

**`unknown` is not a pass.** The gates are `pass` / `fail` / `unknown`, and the third is a first-class outcome: a repository where `gh` could not be reached genuinely has no answer about whether its version is ahead of the last published one, and shipping on an unknown is the habit this stage exists to break. Gates run in order — changelog entry, notes content, notes clean, version ahead, tag free, clean tree, CI green, declared testing policy met — so the first failure a user reads is the one closest to the root cause. The **testing gate** is last because by release time an unevidenced methodology has been unevidenced for weeks, and this is a backstop rather than the main defence: a failing test fails it, an enabled methodology with no evidence fails it (the project set the standard and is about to ship without meeting it), and coverage that was never gathered reports `unknown`. So does a project with no methodology enabled at all — nothing to check against is not the same as checking and finding nothing wrong. It is fed from the same `TestingPolicyCoverage` the Testing page renders, so the two surfaces cannot disagree about a number. Being told CI is red is unhelpful when the real problem is that no changelog entry exists.

The tag gate is what catches a double publish: an existing tag means the publish workflow already fired for this version, which is the failure this repository documented in 0.181.0 and fixed in 0.184.0. Its fix hint says never to delete or move a published tag, because anyone who already fetched it keeps the old contents under the new name and never finds out.

**Nothing here executes anything.** `buildReleasePlan` is pure over observed state, and tagging and publishing stay with the human at every automation rung.

### ReleaseGateNavigation (`src/core/releaseGateNavigation.ts`)

Where a release gate sends you, and which gate you should read first. The Release page listed the eight gates as flat, equally-weighted, unclickable text in evaluation order — and evaluation order is a property of the *checker*, root-cause-first, which is the wrong order for a reader who wants the gate actually blocking the release at the top. Several gates named the page holding their evidence in prose (“Open the Pipeline page”) and then left you to find it, which is the failure `githubDeepLinks` exists to close: reasoning about a fact and then not offering the way to it.

**A destination is declared per gate, never inferred.** `RELEASE_GATE_DESTINATIONS` is a `Record` over the `ReleaseGateId` union, so a new gate is a compile error here until somebody decides where it goes. There is no fallback: `resolveReleaseGateDestination` returns `undefined` for an undeclared id and the control is simply not drawn, because a gate silently routed somewhere unrelated is worse than one that is not clickable — the reader follows it, finds nothing, and learns not to trust the others. The id arrives from a webview click, so the lookup is `hasOwnProperty`-guarded and `toString` resolves to nothing.

**Ranked by consequence, ties on declaration order** — the rule `attentionFeed` and `observedDelta` already use, so the list cannot reshuffle between renders. Within a rank the gates keep the evaluator's order, which is how the root-cause-first reasoning survives inside each band.

**`unknown` ranks with the failures, not with the passes.** This is the whole point of the ordering. `releasePreparation` is built on “an unknown is not a pass”, and an ordering that sank unknowns beside the passing gates would undo that at the last surface before somebody tags a release. The same rule shapes the filters: `outstanding` (“Needs you”) admits `fail` *and* `unknown`, while `blocked` and `unknown` stay separate because they need opposite actions and only one of them is yours.

**A filter states what it hid.** `summarizeReleaseGateView` carries the hidden count, and its per-status counts are computed over the **unfiltered** set — a chip reading “Blocked 3” that counted only what the current filter admits would report zero the moment somebody selected “Ready”, which is precisely when a reader most needs to know there are three.

The panel calls it once per snapshot and ships **both orderings and every filter's admitted set** to the webview as gate ids (`DashboardReleaseGateView`). Shipping the rules instead would give one fact two implementations; a message per filter click would make a *way of looking* something that can fail, which the roadmap canvas already refuses for the same reason. Ten arrays of at most eight strings is cheaper than either.

### IdeationDerivation (`src/core/ideationDerivation.ts`)

Ideation as stage 0 of the workflow. The board held nine card kinds and had two outbound paths — launch an autonomous run, or append prose to a memory file — so nothing fed the backlog and a card called `requirement` could not become a requirement.

**Focus is not decided here.** `prioritizeDashboardRoadmapItems` already derives a roadmap item's focus from its *text*, with one published keyword table. A second classifier keyed on card kind would eventually disagree with it, and the disagreement would surface as an item whose priority reason contradicts its own label. So this module shapes the text and lets the existing rule read it — which also means a card-derived item behaves exactly like a hand-typed one, with no special case to remember. A test reads the source to confirm no focus vocabulary appears here at all.

**A kind becomes a prefix only where it changes what the sentence commits to.** A `problem` titled “Webhook has no rate limit” must not enter the backlog as a goal — the work is `Fix: …`. A `risk` becomes `Mitigate: …` and an `experiment` `Trial: …`. A `requirement` or an `idea` gets nothing, because deciding to put an idea on the roadmap *is* the commitment and hedging it would misreport the decision just made. `decapitalizeFirstWord` exists because the first version tested `/^[A-Z][a-z]/`, which matched the `Gi` in `GitHub` and produced `Fix: gitHub token expires silently`; the rule is now the whole first word, since any capital past the first character means the word is a name.

**Connections are the evidence, and direction is load-bearing.** “This depends on X” and “X depends on this” are opposite plans, so all five relations are written out in both directions rather than computed from one template. Evidence is ranked by consequence — a `contradiction` first, because it argues against doing the work at all — and a contradiction is surfaced as a **caution** rather than listed among the supporting points. This is the one thing ideation knows that no hand-typed issue body contains.

**Provenance is keyed on text, not on ids.** Card ids are durable; roadmap item ids are positional (`roadmap-${index + 1}`, assigned after filtering), so inserting one item renumbers every item below it. The card stores the item's **normalized text** — the same key the roadmap already uses to detect duplicates — and `resolveDerivedRoadmapItem` finds the item wherever it has moved to, reporting `missing` with the previous text when a rename breaks the link rather than matching whatever now sits at that position. `normalizeForRoadmapMatch` is pinned to the dashboard's `normalizeRoadmapText` by a test, both textually and behaviourally: two normalizers drifting apart would break every stored link at once.

`collectCardConnectionSources` lives here rather than in either panel because both need it — the board writes the roadmap item, and the dashboard recomputes the evidence when that item becomes an issue. Two copies would eventually disagree about direction, which is the one thing here that must not be wrong.


### Research register (`src/core/researchScanCatalog.ts`, `src/core/researchRegister.ts`, `src/core/researchSources.ts`, `src/core/researchSchedule.ts`, `src/core/researchDigest.ts`)

Ideation is stage 0 of the guided workflow, and until v0.225.0 every inbound path to it was the user
or Atlas re-reading the board's own contents. The research register is the missing inbound edge: a
scan asks a question about the world *outside* this repository, records what it found, and offers
each finding to the board as evidence.

The normative specification is [`ideation-and-research.md`](ideation-and-research.md). The five
properties that shape the code:

1. **A scan is classified by where its evidence lives.** `gap`, `security`, `risk`, `debt` and
   `testing` are already answered by registers in this codebase, so they are declared as
   `RESEARCH_SUBSCRIPTIONS` — pointers — rather than re-scanned. Only the seven outward-facing
   questions get scanners. A test asserts no declared scan is `internal`.
2. **A citation, or it is not a finding.** The check is in `sanitizeIncomingFindings`, not in a
   prompt. An uncited claim becomes a `question`: recorded, never counted as evidence. `https` only.
3. **Absent is not empty.** `detectResearchSources` decides before a run whether anything could have
   looked; with nothing available an external scan returns `no-source` with a named setup step.
4. **Due is a fact, running is a decision.** `buildResearchSchedule` computes due-ness from the last
   run that *answered*; `nextAutomaticScan` returns at most one scan per pass.
5. **The digest introduces no claims.** It groups and ranks recorded findings, reusing
   `observedDelta`'s five rules for its "what changed" section.

Persistence lives in `project_memory/analysis/` — `research.json` (source of truth), `research.md`
(mirror, publishing the rule table and catalog), `research-history.json` (capped, append-only) and
`research-digest.md`.

### Ideation board templates and readiness (`src/core/ideationBoardTemplates.ts`, `src/core/ideationReadiness.ts`)

`ideationBoardTemplates.ts` derives starter frames from the detected archetype and traits. Every
seeded card is a question rather than a conclusion, and nothing is placed at a coordinate — the board
owns layout.

`ideationReadiness.ts` produces a reading of what a board can and cannot defend, from ten declared
rules ordered by consequence: an unresolved contradiction first, then unevidenced problems, wish-list
boards, unconnected cards, and cards that never reached the backlog. It blocks nothing.

### RoadmapIssueDraft (`src/core/roadmapIssueDraft.ts`)

A roadmap item, turned into an issue draft. `IssueDraft` existed with only a sanitizer, and issues could only be created by hand-typing a title, a body and a comma-separated label list into a form — while the roadmap held the same work structured, prioritised and gate-tagged. Somebody planning here and tracking on GitHub retyped every item.

**No model is in this path.** The same item produces a byte-identical draft every time, which is what makes it reviewable: the rule that chose a label is visible, and the next item's output is predictable. A generated issue title is a claim nobody checked, posted publicly under the user's name.

**A draft is not a filed issue.** Nothing here calls `gh`. The output is proposed text; the confirmation that posts it lives at the call site, behind the same gate as every other issue write.

**Labels come only from the declared taxonomy**, because an invented label is created on the repository as a side effect of filing — a write nobody asked for, in a vocabulary the team agreed. `FOCUS_LABEL_CANDIDATES` lists several candidates per focus in preference order, since matching one of `architecture`/`refactor`/`tech-debt` beats inventing the first. The repository's own spelling is used rather than the candidate's: `Documentation` and `documentation` are one label to a human and two to `gh`, and filing with the wrong case creates a second. An intent that matches nothing is recorded in `droppedLabels` **and stated in the issue body**, so the omission is visible to whoever reads the issue rather than only to whoever filed it. A gate becomes a label only where the repository already uses that word.

The title is clamped on a word boundary, because a title ending mid-word reads as a truncation bug and somebody scanning a list of issues cannot tell ours from theirs; the full text stays in the body, so the clamp loses nothing. The body's `Where this came from` section names the roadmap and the item id verbatim — an issue that came from a roadmap and does not say so becomes a duplicate the first time somebody reads the roadmap again — and states plainly that closing the issue does not tick the item off and vice versa.

`draftableRoadmapItems` excludes completed items rather than sorting them last: raising an issue for finished work is never the intent, and offering it invites a mis-click that posts publicly.

### RoadmapPlanning (`src/core/roadmapPlanning.ts`)

The filing record behind a roadmap item, and the three Atlas hand-offs every entry carries: **Plan**, **Resolve**, **Completion check**. A backlog line says *what* the work is and nothing about *how*; the how was retyped into chats and lost when they ended. The plan is now a dedicated markdown file under `roadmap/plans/`, referenced from the item's graph record (`planPath`) and linked from every surface that shows the item — so deleting it is visible rather than silent.

**No model output is in this path.** The scaffold is deterministic and byte-identical per item — a frame of questions (Approach, Steps, Verification, Completion criteria), never seeded answers, for the reason `ideationBoardTemplates` refuses to seed conclusions. Atlas's drafting arrives through a chat hand-off, where every write runs under the ordinary tool-approval regime; the host's own write is **create-only** (`wx`), so a plan somebody has written survives a second press of the button that filed it.

**The item text is fenced as reported content in all three prompts.** A backlog line can be imported from GitHub issues, a Projects board or a spreadsheet, which makes it third-party text; "ignore your instructions" inside an imported line stays a line item.

**None of the three hand-offs completes anything.** Plan produces the plan and explicitly not the implementation; Resolve does the work and reports; the Completion check reports evidence — complete, incomplete, or not decidable — and each prompt states that ticking the item off stays a human act on the Roadmap page. A delivered entry keeps only the Completion check, since nothing is left to plan or resolve.

`sanitizeRoadmapPlanPath` validates a stored path rather than cleaning it — the value is read from a committed file, resolved against the workspace root and opened in the editor, so a traversal, an absolute path or a drive letter refuses the field whole. The pill payload is one opaque id (a durable node id, or a positional backlog id from a list row), resolved host-side against the roadmap, so the page supplies neither text, nor a path, nor a prompt.

### GithubDeepLinks (`src/core/githubDeepLinks.ts`)

The GitHub page each dashboard page is about. The dashboard read GitHub, reasoned about it, and then left the user to navigate from the repository root — a small friction repeated many times a day.

**A slug is untrusted input.** It arrives from a git remote or `gh repo view`, and it is interpolated into a URL, so `parseRepoSlug` validates against GitHub's actual naming rules — 1–39 characters for an owner with no leading or trailing hyphen, `[A-Za-z0-9._-]` capped at 100 for a repository — rather than checking for a slash. That is the point of validating: a slug carrying a path segment or a query would point the link somewhere else entirely. A slug that does not parse yields **no links at all** rather than links to a plausible-looking wrong repository, because pointing somebody at somebody else's issue tracker is a worse outcome than a missing button. The origin is a constant in the file, so nothing in the input can move a link off GitHub.

**Only surfaces every repository has.** `/wiki`, `/discussions` and `/projects` can each be disabled, and a 404 behind a button AtlasMind drew reads as AtlasMind's bug rather than as a repository setting. Determining which are enabled costs a `gh` call, and a link is not worth a network round trip — so the ones that might not exist are simply absent, and a test holds them out.

**The caller resolves ids, not URLs.** `resolveGithubLink(page, id, slug)` exists so the webview can send `{page, id}`: a surface that could name the URL to open could name any URL, and `openExternal` does not care whose it is. The id space is scoped per page, so `dependabot` does not resolve from the Issues page — a button that resolved from a page it was not drawn for would go somewhere unexpected.

Four pages get nothing, listed in `PAGES_WITHOUT_GITHUB_EQUIVALENT` so the omission is a decision a test can hold: Privacy, Runtime, Risk and Ideation are about this machine, this extension and this project's own judgement, and giving them a repository page would be inventing a relationship to fill a slot. `describeMissingLinks` distinguishes "no repository" from "no equivalent", because one is fixed by a `gh` sign-in and the other is not fixed at all.

### ObservedDelta (`src/core/observedDelta.ts`)

The only thing in AtlasMind that answers *what changed?*. Everything else answers *what is the state?* — and when the state is nearly the same every day, a surface that reports only state is one people learn to skim. (`ssotDelta.ts` is unrelated despite the name: it compares memory against code to find drift. This compares the project against its own past.)

Five properties are enforced in the module rather than left to the caller, because each is a way a delta can lie.

**No baseline is a first look, not a change.** With no prior snapshot every field differs from nothing, and rendering that as "18 things moved" on a fresh install would be false at the exact moment somebody is deciding whether to trust the surface. The status is `first-look` with an *empty* change list, and the reason is carried so the wording can differ between "nothing stored yet", "the stored reading could not be read back", and "that was a different repository".

**Unknown → known is not zero → n.** If `gh` was missing at the last reading the open-issue count was `undefined`, and "0 → 12 issues" invents a twelve-issue spike that never happened. It reports as `now-known` and carries no `before`. The inverse case, **known → unknown, is news rather than a gap to skip** — a count that used to read and now does not usually means a tool stopped answering, and it ranks *above* the movement it hides because it explains why the rest of the page went quiet.

**A different repository is not a comparison.** A snapshot taken in one repo diffed against another produces confident nonsense, so a changed slug discards the baseline. Absence of a slug on either side is not disagreement, and still compares.

**A different component scope is not a comparison either.** `ObservedScope` travels with both the reading
and its snapshot, including visible and `not-visible` components. Any scope change starts a new baseline;
malformed stored scope metadata is an unreadable snapshot rather than an exception. Summaries append the
scope label, so a movement can never present a home-repository count as a whole-project delta.

**It never reports the user's own actions back to them.** `currentBranch` and `workingTreeClean` are deliberately outside the tracked set: those are the developer's position, not the project's movement, and a delta that says "you are on a different branch" trains somebody to ignore deltas. `ghInstalled` and `hasChangelog` are also excluded, because each is implied by a field already tracked and reporting one movement twice reads as two things happening.

**Direction belongs to the field, not the number.** More CI workflows is better, more stale issues is worse, a version changing is neither — so each tracked field declares a polarity, and a field with no better direction is reported as `moved` rather than being assigned a virtue it does not have. Ranking is by **consequence rather than magnitude**: a pipeline turning red outranks forty new issues, however much larger the forty looks. Ties break on declaration order, so the list does not shuffle between renders. Lists compare as *sets*, because `gh` promises no ordering and a reorder is nothing anybody did.

The reported list is capped, with the remainder stated. Above the cap it stops being a delta and becomes a second copy of the page — and the situations producing twenty simultaneous changes are nearly always one cause (`gh` came back) rather than twenty events.

**Storage is the caller's, and it must be per-developer.** `OBSERVED_SNAPSHOT_NOTE` states this in the module so it cannot be got wrong quietly: `project_memory/` is git-tracked on purpose, so a baseline kept there would mean "when did *anybody* last look", would appear as an uncommitted change every time the dashboard opened, and would conflict between two people looking on the same day. The dashboard keeps it in `workspaceState` beside the delivery review's `reviewedAt`, and holds the computed delta for the session — advancing the baseline on every render would empty the delta from the second render onwards, so the surface would work exactly once and then quietly report nothing forever.

### VersionStrip (`src/core/versionStrip.ts`)

The version pills in the Project Dashboard header. They were two, derived from git alone: a production branch found by walking a candidate list, and whatever branch happened to be checked out. That answers *which branch am I on?* — but the header is asked *what version is where*, and the project already models that on the Delivery page as an ordered pipeline of stages, each carrying a `branchRef` naming the branch whose committed version represents it. The header ignored it entirely, so adding a Staging stage changed nothing, and a project with four environments still showed two pills, one of which was a branch name.

Deriving the strip from that pipeline — from the same `DashboardStageView`s the Delivery page renders, not a second collection pass — means the two surfaces cannot report different versions, and a stage declared once appears in both.

Four rules, all of them about not claiming to know a version.

**A stage whose branch does not exist has no version.** Not the working copy's, not `—` presented as a value: it reports that the branch has not been created. A plausible version shown against an environment nobody has deployed to claims a deployment that never happened.

**The working tree is a different claim from a branch.** The local stage carries no `branchRef` by design, and its version comes from `package.json` on disk — making it the only pill that can be ahead of what is committed. It reads `working tree` rather than borrowing a branch name, and carries whether the tree is dirty, because a clean local pill that merely repeats the staging version is the one case where it adds nothing to the header.

**Ordered by rank, capped, with the remainder stated.** Rank is the pipeline's own order; ties break on name so two stages at the same rank cannot swap places between renders. The overflow routes to the Delivery page rather than being dropped, since a header that silently lost the last stage would read as a project that does not have one.

**A channel comes from a declared policy or not at all.** Where the project has declared one, each pill also names the release channel its branch produces and what that channel publishes to. Where it has not, no pill carries one: a pill reading `beta` on a project that never chose a channel model would be the header asserting a release process nobody adopted, which is the same failure the “no version” placeholder exists to avoid one column over.

**Never empty, and a guess is not presented as a declaration.** A project with no pipeline configured falls back to the original git-derived pair so the header keeps working before anyone opens the Delivery page — but the strip reports `source: 'branches'` for that case, because the production branch there is found by heuristic and should not wear the same shape as a stage somebody declared.

### Semver (`src/core/semver.ts`)

The three version primitives — `compareSemver`, `bumpVersion`, `classifyBumpLevel` — and the `BumpLevel` type. They lived in `promotionRunner.ts`, which imports `child_process`, `fs` and `https` because it *runs* promotions; that was harmless while the only other caller was `releasePreparation`, and stopped being harmless the moment a module documented as pure imported `compareSemver` and dragged a process spawner in behind it. The symptom was a test in an unrelated area, which partially mocks `node:child_process`, failing on a missing `exec` export. The runner re-exports all three, so there is still exactly one implementation of what a version means: two copies of `compareSemver` would eventually disagree about whether a release candidate had already shipped.

`compareSemver` implements SemVer §11 precedence in full. It previously read `value.split('-')[0]` and discarded the pre-release suffix, so `1.5.0-rc.1` and `1.5.0` compared **equal**. That is not a rounding error on an unused field: `releasePreparation`'s `version-ahead` gate asks exactly this question of exactly these values, so a release candidate read as *already published*, and the finished release that followed it read as *not ahead of* the candidate. Both are the same failure — a gate that exists to prevent a double publish refusing the one release that was never published — and any branch-to-channel scheme is unimplementable on top of it.

### VersioningPolicy (`src/core/versioningPolicy.ts`)

How a project numbers its software across several branches. AtlasMind could already classify a commit range into a bump level, increment a release line, and say which version sits on which delivery stage. What it had nowhere to put was the decision *joining* those three: that `develop` produces `1.5.0-beta.3`, that `main` produces `1.5.0`, and that those are the same release line at two points on its way out. Without it, a project with four branches had exactly one version — the manifest’s — and every stage reported whatever that branch’s copy of the manifest happened to say, which is a fact about merge order rather than about what is deployed anywhere.

The professional norm this models is three decisions, not one: a **scheme** (SemVer, or CalVer where there is no API contract to promise), a **source** for the number (derived from the last tag at release time, or held in the manifest), and — the part that only exists once there is more than one branch — a **channel map** from branch to pre-release identifier and distribution tag. The policy lives in the committed workflow file rather than in settings, for the reason the label taxonomy does: a versioning scheme is a statement about how a *team* works, and a per-user setting would let two people on one repository disagree about what `develop` produces with nothing to arbitrate.

Five rules carry the semantics.

**A version is minted once and only gains identity as it flows forward.** `1.5.0-beta.3`, then `1.5.0-rc.1`, then `1.5.0` never changes the release line, and `promoteVersion` *refuses* a promotion that would change major, minor or patch rather than performing it. Two different numbers are not the same artifact, and a channel’s entire value is the claim that they are — a promotion that quietly re-mints turns the release candidate somebody tested into a version nobody tested, under a name saying otherwise. Moving backwards is refused for the same reason from the other direction: `1.5.0` demoted to a preview channel would produce `1.5.0-beta.1`, which SemVer orders *below* the version it came from. A property test walks every accepted promotion and asserts the release line survived it.

**The branch chooses the channel, never the number.** Channels are matched against the branch and the number comes from the release line. The map is keyed on the same branch refs the delivery pipeline already carries, so the header, the Delivery page and this module cannot end up with three opinions about what `develop` is. An exact branch match beats a pattern, and among patterns the longest prefix wins. A feature branch matches nothing and produces no version, which is reported as the ordinary case rather than as a fault.

**Undeclared is not defaulted.** No policy in `workflow.json` yields `declared: false` and no version at all — never a silent SemVer assumption. A project that never chose a scheme must not be graded against one, so nothing is seeded: `sanitizeWorkflowConfig` leaves the field absent, `seedWorkflowConfig` never writes one, and `recommendedVersioningPolicy` is offered separately so adopting it stays a decision that arrives as a diff somebody reviews.

**The rule that produced a number travels with it**, as the debt register and the roadmap’s estimates already do. `VERSION_PLAN_RULES` is a declared table published with every plan, including on a refusal, so a suggested version can be argued with rather than followed blindly or ignored entirely.

**An unparseable version is refused, never coerced.** The obvious implementation reads `parseInt(part) || 0`, which turns nonsense into `0.0.0` — and `0.0.0` compares older than everything, so a corrupt manifest would sail through the very gate that exists to catch it. `parseVersion` is deliberately stricter than `compareSemver`, and the asymmetry is the design: comparison is asked about values that already exist and must produce *some* answer, while parsing is asked whether a value may be built on. Leading zeroes are refused, because two spellings of one version is how a tag stops matching the release it names.

The boundary follows the same split the module makes everywhere else: a branch and a pre-release identifier are **validated, never cleaned**, because both reach `git tag` and a nearly-valid one made plausible fails later where nobody connects it back to this file; a channel label is display text and is *cleaned* rather than refused, because nothing downstream executes it and a stripped character costs a character where a refused channel costs the whole channel. A channel naming a branch nobody created is **reported, never dropped** — the call `workflowConfig` already makes about an unresolvable owner.

Pure, with the clock injected: a CalVer plan computed from an ambient clock can be neither tested nor replayed.

### AttentionFeed (`src/core/attentionFeed.ts`)

What needs a person, gathered from every dashboard page onto the Overview. `ObservedDelta` answers *what changed?*; this answers *what is wrong or due right now*, which the Overview previously did not answer at all — it opened with nine permanently-populated stat cards ("43% coverage", "8 workflows"), and nothing on the page distinguished a project with three failing tests and a blocked release gate from one with neither.

The design constraint comes from what used to close this page: a grid of twelve equally-weighted shortcut cards, removed for being a second navigation system competing with the first. **The distinguishing property of this band is that it is empty when nothing needs you**, which a navigation grid can never be. Five rules keep it from becoming the thing that was removed.

**Only what needs a person.** Not "43% coverage" — "3 tests failing". The Project State badge learned this first: a count that includes everything is permanently non-zero and therefore ignored. Warned SSOT entries do not qualify; blocked ones do, because one of them stops something.

**Severity from a declared rule, never a judgement.** Each of the sixteen rules carries the sentence that grades it, published on the card, so a grade can be argued with rather than trusted. The tech-debt register's reasoning applied to a different register.

**Ranked by consequence, not magnitude.** Declaration order *is* the ranking, and it is an editorial decision rather than something emergent from counts — a red pipeline outranks forty stale issues, and sorting by magnitude would let the forty win. Ties break on that same order, so the list cannot shuffle between renders and become unreadable.

**Capped, with the remainder stated.** Six items are shown; a list that silently truncates reads as "that's everything".

**Unassessed is not clear.** The rule that matters most, and the reason `AttentionInput`'s eleven groups are each optional: **absent means "not assessed" rather than "nothing there"**. A page that could not be read — no `gh`, no test report, a debt register never scanned, risk never assessed — contributes its own `unassessed` item rather than contributing nothing. Silence earned by not looking is the single failure mode that would make this band worse than not having it. The same distinction survives into the empty state, which is `clear` only when at least four groups were actually supplied and `unexamined` otherwise; `summary` is carried on the feed rather than left to each renderer, because two surfaces phrasing the same counts their own way is how "3 unassessed" becomes "all clear" on one screen and not the other.

The mapping from the dashboard snapshot lives in `projectDashboardPanel.ts` and is where those rules are actually kept or broken — by defaulting. It reads the release plan's own `blockedBy` list rather than recounting gates, because that list already encodes "an `unknown` gate is not a pass"; it treats an absent `lastScanAt` as never-scanned rather than as an empty register; and it derives the feed from the finished snapshot rather than collecting separately, so the Overview and the page it links to cannot disagree about a number.

### WorkflowAutomation (`src/core/workflowAutomation.ts`)

Where the specification's central claim is kept: **full automation is possible, never default.** That has to be true by construction rather than by policy, and the mechanism is a minimum over four independent gates that all default closed — `effective = min(master, userCeiling, capability, stage)`. A project's committed workflow file may request `auto`; if any one of the four disagrees, `auto` does not happen. Personal settings can only *lower* the result, so a repository cannot force unattended action onto somebody's machine and a developer cannot grant themselves more than the repository allows. An exhaustive test walks the whole lattice rather than arguing the property.

Three decisions carry weight. **A disabled capability caps at `draft`** rather than zeroing the stage — turning off "may write pull requests" should stop the writing, not stop AtlasMind explaining and preparing, and `propose` is exactly where writing begins. **Every refusal names its binding gate**, because "you cannot do that" with no reason sends somebody to toggle four settings at random. And **an unrecognised level reads as `off`** — a settings file with a typo must never be read as consent.

Hard ceilings sit outside the ladder deliberately: force-pushing, deleting a tag or release, re-running CI, editing a CI workflow or the workflow config, and merging a dependency update are excluded at *every* rung, so their messages must not imply a setting exists that would permit them. `permitsProtectedRefWrite` is likewise a veto on a *target* rather than a cap on a level — with it off, `auto` is unreachable for a protected base, not merely discouraged.

**A gate that cannot be reached is not a gate somebody can use.** Four independent switches that all default closed are the right safety property and the wrong discoverability one: the effect is that AtlasMind reports it is not permitted to do something and the reason lives across four settings keys in a settings UI. `requirementsFor` closes that by deriving, for a target rung, the ordered list of what would have to change — master, then ceiling, then capability, then the stage's own declared level, root cause first, so somebody following it top to bottom never enables a capability that the master switch was already suppressing. The capability requirement is skipped for a `draft` target because a disabled capability caps at `draft` and turning it on would change nothing; naming it would be an instruction to no effect.

**`blockingFlagScopes` exists because VS Code resolves settings in the order a preference wants and a safety ceiling does not.** `resolveRestrictiveFlag` already takes the *minimum* across scopes, so a user-level `false` holds a workspace-level `true` closed. That is correct, and it means a surface offering to enable a gate in the workspace can write `true`, succeed, and change no behaviour — the silent no-op again, arriving through the settings system rather than through a dropped command. The function names which other scopes are holding a flag down so the caller can decline to write, and say which.

### PullRequestDraft (`src/core/pullRequestDraft.ts`)

Removes the two steps people skip — writing the body and linking the issue — without letting a model author either. The determinism requirement is exact: the same commit range plus the same template produces a byte-identical draft.

**The title reuses `classifyBumpLevel`** rather than parsing commits again. That function already reads conventional commits to decide a version bump; a second parser of the same format would eventually disagree with it, and the disagreement would surface as a release whose version does not match its own pull-request title. A single conventional commit keeps its subject verbatim — a human already wrote the best available description.

**The template is filled, never replaced.** Recognised headings receive content; everything else is preserved exactly, including headings this module has never seen, because a team's checklist is theirs and a drafter that quietly dropped a custom section would be worse than one that left the body empty. The `- Closes #<issue-number>` placeholder is substituted rather than appended to, so a pull request never ships containing a literal `<issue-number>`; where there is no issue, the body says so, because a silent omission reads as an oversight. Labels come only from the declared taxonomy, and an unmatched one is dropped *and reported*.

### LabelRegistry (`src/core/labelRegistry.ts`)

Labels and milestones — the taxonomy stage 1 draws from. Stage 1 takes labels only from the declared set and drops an unmatched one rather than inventing it; that rule is only as good as the set behind it, and until now a team could see which labels their issues carried but had to leave the editor to change them.

**A deletion names every issue that will lose the label.** GitHub removes a label from the repository *and* from every issue carrying it, in one irreversible step, and its own confirmation does not say how many. That is the whole reason this is a module rather than a list: the count comes from the issue list already on screen, so it costs nothing, and it is the difference between an informed decision and a click. Closed issues count — a label stripped from a closed issue takes the reason it was categorised that way with it, and closed issues are what people search when they want to know what happened before. Where the issue list was never loaded the confirmation says so rather than reporting zero: "nothing uses this" and "we did not look" lead to opposite decisions and only one is safe to act on.

**A colour is validated, not cleaned.** Six hex digits exactly, or nothing. The value is rendered into a style attribute, so anything else is dropped rather than repaired — a "colour" reaching a stylesheet is an injection, and a nearly-valid one made plausible is worse than a missing swatch.

**A milestone is closed, never deleted.** Deleting one detaches every issue from it silently; closing preserves the record, which is what a milestone is for. There is no delete affordance, by design.

`findTaxonomyDrift` compares the declared set against the repository in both directions, because they mean different things. A **declared** label that does not exist is one the drafter will silently drop — the single failure stage 1 promises not to have. An **undeclared** label in use is one the workflow will never suggest, usually a sign the declaration is stale rather than that the label is wrong. Neither is reported as an error: this is a comparison, not a verdict.

### PullRequestTracker (`src/core/pullRequestTracker.ts`)

**Line-level review comments are the actionable half**, and nothing read them until C3.4 — so "address the review" meant handing a model every comment at once and hoping it found the place. `parseGhReviewComments` reads them with the same discipline as everything else here, plus one thing the other readers do not need: the path is traversal-checked, because it arrives from a third party and becomes a file somebody clicks. A path that could not be trusted is **emptied rather than rewritten**, and the comment is still shown — the text is worth reading even when the button is withheld.

`buildReviewCommentPrompt` scopes the question to one comment and the line it points at, because a scoped question gets a scoped answer. It carries the same REPORTED CONTENT fence as the summary prompt and for the same reason — this is the path where an arbitrary third party's text reaches a model that can call tools — and it forbids two things a model would otherwise reasonably do: address the rest of the review, and reply on the pull request.

`resolved` stays `false` rather than inferred. The REST comments endpoint does not carry thread resolution; that lives in a GraphQL field. Guessing from something adjacent would hide feedback that is still open, so `false` here means "not known to be resolved" and errs towards showing it.

Comments are fetched **per pull request, on request**. Fetching them with the list would be one call per open pull request against a rate limit, for comments on all but one that nobody asked to see. A failed fetch records an empty list rather than leaving the key absent, so the surface says "none found" instead of offering the button again forever.

The sibling of `issueTracker.ts`, built to the same discipline because the threat is the same one: **a pull-request body and a review comment are third-party text.** Anyone who can comment can write a paragraph designed to be read as an instruction by an AI assistant, and "address this review feedback" is precisely the workflow that hands that paragraph to a model holding tools.

Until this module, nothing in AtlasMind sanitized that text — because nothing read it. Adding the reading is what created the obligation.

`parseGhPullRequestList` never throws: malformed JSON, a wrong shape, or one unusable entry degrades to *fewer pull requests*, never to an exception on a dashboard render. `buildPrReviewPrompt` fences review bodies as REPORTED CONTENT and instructs the model not to follow them, so the mitigation lives where the prompt is built rather than in a reviewer's memory. Two smaller decisions carry real weight: an unrecognised review verdict reads as `commented` rather than `approved`, so a malformed feed can never satisfy an approval gate; and `parseLinkedIssues` recognises only GitHub's closing keywords, so a bare `#142` is not counted as traceability the repository does not have.

`derivePullRequestIssueDraft` is the repair path for that traceability gap. It converts the current sanitized open PR record into fixed-order, editable issue text without a model, carries only labels that already exist on the repository, and never posts. The browser sends a positive PR number; the host re-resolves it and refuses a stale, closed, or already-linked record before opening the existing composer. The ordinary issue-write policy and confirmation remain the only route to GitHub.

### BranchDashboard (`src/core/branchDashboard.ts`)

The Branch Dashboard's judgement is a pure module, not webview code and not a model prompt. `deriveBranchDashboard` joins one local branch inventory with the last explicitly loaded sanitized PR/check/review feed, issues, roadmap references, and operator identities. It emits five comparable outcomes (`ready`, `attention`, `blocked`, `baseline`, `retired`), the exact ordered reasons, a deterministic risk rank, cleanup candidacy, PR/CI/traceability summaries, and built-in saved-view membership. A failing check, conflict, change request, unresolved loaded review comment, or structural Git problem is a blocker; missing refresh evidence is attention/unknown, never clear. PR closing keywords are declared issue linkage, an explicit `branch: <name>` roadmap reference is declared linkage, and a matching numeric branch segment is inference.

The module also owns the conservative CODEOWNERS reader used during on-demand inspection. It caps input, validates owner handles, refuses unsupported/unusable lines rather than guessing, applies rules in last-match-wins order, and returns aggregate owner/rule/path counts. It does not store CODEOWNERS, changed paths, or contributors. Recent contributors are separately labelled historical context because commit frequency does not grant ownership.

`ProjectDashboardPanel` remains the trust and I/O boundary. Ordinary render gathers lightweight local inventory and carries the bounded GitHub snapshot already loaded for Issues/PRs; it does not run a diff per branch. Inspect/compare/Change Story actions send opaque ids, re-collect inventory, resolve commits and baselines host-side, and return only aggregate evidence. Cleanup is a separate destructive boundary: fetch and re-resolution precede assessment; current/default/protected/worktree/open-PR or uniquely committed branches are refused; local deletion uses merged-only `git branch -d`; remote deletion additionally requires a live head match and typed exact-name confirmation. No force-delete route exists.

### BranchNaming (`src/core/branchNaming.ts`)

`deriveBranchName` turns an issue into `feat/142-guided-github-workflow`. A branch name is the only context anyone gets before opening a branch, and deriving it means the link back to the issue is never forgotten because it was never typed.

Three properties are asserted rather than assumed. It is **pure and predictable** — collisions resolve with an ordinal suffix (`-2`, `-3`) rather than a hash or timestamp, so running the same command twice gives a name you could have predicted rather than one you have to go and read. It is **structurally incapable of producing a protected name**, because the result always carries a `<type>/` prefix; the protected-set check is belt-and-braces against a future format change. And it **refuses rather than inventing**: a title that reduces to no ASCII slug produces a stated refusal, not `feat/142-branch`, because an unreadable branch name is worse than a question. Accents fold to their base letter rather than being dropped, since "caf" reads as a typo and a branch name is read far more often than typed.

### GhClient (`src/core/ghClient.ts`)

The single boundary between AtlasMind and the GitHub CLI. Before it there were three independent `gh` call sites — one in the dashboard panel, one in the bootstrapper, and one that built a command *string* for later shell execution — and three call sites means three answers to "is this argument escaped?", only one of which needs to be wrong.

**No shell, ever.** Every call is `execFile(cmd, args)` with an argv array, so a repository name, an issue title, or a branch name may contain a semicolon or a backtick without becoming a second command. `assertNoShellMetacharacters` sits on top of that and can never fire in correct code — which is the point: it converts a future refactor that reintroduces string composition from a silent vulnerability into a loud failure at the call site.

**AtlasMind holds no long-lived credential.** It shells to an already-authenticated `gh`, so the user's GitHub authorisation is managed by GitHub's own tooling, lives in the OS keychain, and is revocable there. There is no token setting and adding one would move a secret AtlasMind does not need into a place it does not belong. The local runner's short-lived registration token follows a stricter variant: `pipeGhStdoutOrThrow` connects `gh` stdout directly to Docker stdin without collecting the value, while retaining the same argv-only, timeout, bounded-stderr and classified-failure contract.

**A failure names its fix.** `classifyGhFailure` distinguishes not-installed, not-authenticated, rate-limited, forbidden, not-found and timeout, each with the command that resolves it — ordered most-specific first, because a rate-limit message mentions tokens and sending somebody to re-authenticate when they are merely throttled wastes their time. Every method returns a result rather than throwing: a dashboard that throws on a network failure disappears exactly when you wanted it to say what was wrong. The process runner is injected, so the module is unit-tested without a `gh` binary.

### RoadmapGates (`src/core/roadmapGates.ts`)

The release milestones a roadmap item can be tagged for. The Roadmap page only ever knew one — `#mvp` — which is the right first gate and the wrong only gate: a project that has shipped its MVP still needs to say "this belongs to the public beta" or "this is v2", and had nowhere to record it. `mvp` stays built in (always present, never removable, still the gate that feeds the Operational Score), and up to `MAX_ROADMAP_GATES` (12) further gates can be declared.

**Gates live in the roadmap file.** A managed `<!-- atlasmind:roadmap-gates:start/end -->` block in `improvement-plan.md` holds them as readable markdown (`` - `#beta` — Public beta ``), inserted after the backlog block: one SSOT document, diffable and reviewable, with no second source of truth to drift. `parseRoadmapGates` / `renderRoadmapGatesBlock` / `upsertRoadmapGatesBlock` are the round trip, and `stripRoadmapGatesBlock` removes the block before item parsing so its list lines can never be read as backlog items.

**A tag is a gate only when it has been declared.** `extractItemGates` recognises only declared ids, so an item reading `fix the #2 case` keeps its wording rather than inventing a gate called "2", and a tag-boundary check stops `#v1` matching inside `#v10`. Ids go through `slugifyGateId` (lowercase alphanumerics, dots, dashes; length-capped; must start alphanumeric) and unusable input is **refused with a reason** rather than coerced — the id becomes a `#tag` in a tracked file, so a value that would not parse back must never be written. Gate creation collects its name through a native input box (validated where the write happens); gate removal is modally confirmed, strips the tag from every item, and **never deletes backlog work**.

The panel computes one route per gate up front (`buildGateRoutes`) so switching gates in the UI is instant and cannot fail on a message round trip. The heuristic "suggested foundations" fallback remains **MVP-only**: recognising foundational work is not a claim about which release something belongs to, so a user-created gate with nothing tagged is reported as empty rather than filled with a guess.

### RegisterHandoff (`src/core/registerHandoff.ts`)

Turning a register finding into planned work. AtlasMind keeps three registers of things somebody found and wrote down — the gap analysis, the tech-debt register and the risk register. All three fed the operational score and the attention band, and none of them could become work: the Gap Analysis page's own nav strip said *"Turn a gap into planned work"* and routed to the Roadmap, where you retyped it by hand with no link in either direction. A P1 gap is the most concrete "somebody wrote down that something is wrong" signal on the dashboard, and it was the one that dead-ended. Pure, `vscode`-free, unit-tested.

**One module rather than three.** The alternative is three rule tables that eventually disagree about how a finding becomes a sentence, and the symptom would be a backlog where a gap and a risk of identical severity read as different kinds of commitment. `RegisterFinding` is deliberately *not* any register's own record type — each has fields the hand-off does not want, and taking the whole record would couple one module to three shapes that change for unrelated reasons.

**No model is in this path.** The same finding yields a byte-identical roadmap line and issue draft, which is what makes them reviewable: the rule that chose a label is visible and the next finding is predictable. It is also what lets both actions share a confirmation dialog that shows the exact text — you cannot show somebody what is about to be written if it is generated after they agree.

**A prefix is added only where it changes what the sentence commits to.** A register records a *finding* — "no CODEOWNERS file", "TODO: replace this shim" — and the work is closing it, not having it; without the prefix the backlog reads as if the missing CODEOWNERS file were the goal. `Close:` for a gap, `Pay down:` for debt (a shortcut that already works, so "fix" would misstate it), `Mitigate:` for a risk — the same word `ideationDerivation` uses, pinned equal by test so two vocabularies cannot drift into meaning different things in one backlog.

**Labels only from the declared taxonomy.** An invented label is *created* on the repository as a side effect of filing. `CATEGORY_LABEL_CANDIDATES` is keyed on the union of all three registers' category vocabularies rather than per register, because `security` means the same thing whether a gap or a debt entry raised it; several candidates per category in preference order, the repository's own spelling wins, and an unmatched intent is recorded in `droppedLabels` **and stated in the issue body** so the omission is visible to the reader rather than only to the filer.

**Whether a finding is outstanding is deliberately not decided here.** Only the register knows what its own status vocabulary means: an `accepted` risk is a decision somebody took and closed, while an `accepted` debt entry is work somebody agreed to carry. `collectRegisterFindings` in the dashboard panel makes that judgement per register and passes the answer along; `tests/views/registerHandoffMapping.test.ts` pins it, because getting it wrong is silent — the button appears on something nobody wanted raised, or fails to appear on something they did.

**Provenance is stored on the roadmap side**, as `RoadmapNodeRecord.origin`. The registers do not all survive a re-scan — the gap analysis is regenerated wholesale from a markdown file, so a link written there would be destroyed the next time it ran — while a roadmap node has a durable id and keeps its record through a rename. The register page derives "already on the roadmap" by joining back on `sourceId`, and the raise handler checks it *before* opening the dialog rather than after, because offering to add a duplicate and only saying so afterwards is how a backlog acquires the same item three times.

### RoadmapGraph (`src/core/roadmapGraph.ts`)

The roadmap as a graph — what has to happen before what. The backlog has always been an ordered list, and an ordered list can only say *this one is more important*. It cannot say **this one cannot start until that one lands**, which is the question anybody planning a release actually asks. Priority order and dependency order are different facts, and a surface holding only the first quietly presents it as the second — which is how a backlog can look well-sequenced and still be unbuildable in the order it is written. Pure, `vscode`-free, clock-injected and unit-tested; the canvas that draws it is the Project Dashboard's Roadmap page.

**A declared edge always wins, and derivation may never contradict one.** Somebody draws a link because they know something the item text does not say. A derived edge that reversed it would overwrite knowledge with a keyword match, so `deriveRoadmapEdges` refuses rather than competes — and reports that it refused, because a suggestion silently withheld is indistinguishable from a rule that does not work.

**A derived edge names the rule that produced it, and is a suggestion until somebody accepts it.** `ROADMAP_EDGE_RULES` declares three, in evaluation order, and the order *is* the policy: an item that *says* what it waits for (`explicit-reference`) outranks two items that merely share vocabulary (`shared-subject-phase`, `gate-sequence`), because one is a statement and the other is a coincidence. Auto-derivation is what makes the graph usable on a backlog nobody has wired up by hand; silently *writing* what it inferred would mean a keyword coincidence reordering somebody's plan behind their back. Suggestions are kept in their own `suggested` array all the way to the canvas — the moment they are merged with declared edges there is no way to tell a decision from a keyword match — and they move no column and block no node. `roadmapSubjectTokens` deliberately treats the focus classifier's own vocabulary (`security`, `refactor`, `docs`…) as stopwords: those words say what *kind* of work an item is, and every security item shares them, so counting them as shared subject would link all of them to each other.

**The graph is acyclic by construction, not by hope.** A cycle is a plan that cannot be executed, and a layout pass fed one either loops or silently drops an edge. Derivation seeds its adjacency with the declared edges and grows it as it accepts its own suggestions, so neither a suggestion against a decision nor two suggestions against each other can close a loop. A *declared* cycle — which a hand-edited file can contain — is reported by name rather than quietly broken, since the items involved are the finding; `layerGraph` uses Kahn's algorithm, so a cycle is what is *left over* when the queue drains rather than something detected separately, and leftovers are still placed (at the depth of their earliest resolvable prerequisite) so the canvas draws.

**An estimate comes from a published table, never a model.** A number a model produced in March is not comparable with one it produced in July, and comparability is the entire point of putting estimates on a plan. `estimateRoadmapEffort` is base-days-by-focus × a size factor, plus a complexity marker, times one stated AI-assistance multiplier — and it returns the rule that graded it alongside the number, so the canvas publishes the rules rather than a copy that drifts. The assistance toggle is **per node** (`aiAssisted`) because "port the CSS" and "design the migration ladder" are not helped by the same amount; `undefined` means never chosen, `false` is a decision, and the two never collapse.

**Absent is not zero.** No deadline is `no-deadline`, never "0 days left". `parseRoadmapDeadline` refuses `2026-02-31` rather than rolling it into March, because a silently wrong deadline is worse than none. `describeRoadmapSchedule` evaluates root-cause first — a passed deadline outranks an unaffordable route, which outranks mere proximity — and `at-risk` is decided by `routeDays`, the node's own estimate plus every *outstanding* prerequisite's: a two-day task due in three days reads comfortable until you notice the five-day task it waits on.

`roadmapRouteTo` answers "what has to happen before this?" — ancestors only. A node's dependents are what it *unlocks*, a different question, and folding them in would make "the route to X" include work that happens after X, which is the one thing the filter exists to exclude. Completed prerequisites are **kept**, because the plan is meant to show how you got here.

`partitionRoadmapCompletion` decides which canvas a node belongs on: a completed item leaves the plan — unless something outstanding still depends on it, in which case it stays as the left-hand end of a route somebody is still walking, since removing it would make the dependent node look like it starts from nothing. `retained` is reported separately so those items still appear on the completion canvas — they *were* delivered, and a record of delivery omitting the load-bearing half would be a strange record. `layoutRoadmapCompletion` columns by **month**, not by depth: the question that canvas answers is "when did this land, and what did it come after", and a dependency depth would re-tell the plan rather than the history. Work with no recorded completion date sorts **last**, in its own column — an unknown date is not the beginning of time.

Layout is a small, fully deterministic layered pipeline (a compact Sugiyama), because the naive version of each step is what made a real backlog unreadable. **Sources are tightened down beside their earliest dependent** — longest-path layering alone put every parentless item in one first row wider than the plan, half a canvas from what it unlocks. **Connected components are laid out as separate blocks** along the cross axis, in backlog order, rather than interleaved — an edge never crosses an unrelated plan's cards to reach its own. **Crossings are swept out with alternating barycentre passes** (down over prerequisites, up over dependents; stable, so priority survives where the links are silent), and **coordinates are pulled toward each node's neighbours** — children under parents, parents centred over what they unlock, quantised to the grid with order and spacing preserved — instead of packed densely from the margin, so a chain lays out as one straight line. **Items with no links park in a near-square block after the components**: they say nothing about order, carry no arrows, and previously produced the giant first row. The row pitch carries headroom for the card as it actually renders (chips and link rows put a busy card past the old 200px, which physically overlapped siblings), and a **stored position always wins**: dragging a node is a statement about how you read the plan, and a layout pass that overrode it would undo the user's work on every refresh — a hand-placed node also acts as an anchor its dependents settle toward. `RoadmapLayoutOrientation` chooses which way the tree runs — one placement rule with its axes swapped rather than two layouts that could drift apart — and it is carried on the resolved graph rather than left for the canvas to infer from coordinates, because "the trailing face of a node" is a different side in each orientation and guessing would be wrong for exactly the nodes somebody has dragged. `ROADMAP_COLUMN_WIDTH`, `ROADMAP_ROW_HEIGHT` and `ROADMAP_CANVAS_MARGIN` are all multiples of `ROADMAP_GRID_SIZE`, pinned by test: without that, turning the canvas's snap-to-grid on and then auto-aligning would leave every node a few pixels off the grid it claims to be on, and the first drag afterwards would jump.

`layoutRoadmapByAssignee` groups the same outstanding work into one band per person, and is a **separate layout** rather than an option on the tree pass — for the reason `layoutRoadmapCompletion` is separate: it is a way of *reading* the plan, not the plan's own arrangement. That distinction settles the one rule that would otherwise be wrong: **stored positions are ignored here**. A coordinate dragged on the dependency canvas means something in that arrangement and nothing in a lane one, and honouring it would place a node in another person's band — the single most misleading thing this view could do. Dragging is not offered on it for the same reason. Depth still runs along the reading axis inside each lane, so a band is that person's own chain rather than an unordered pile, and an arrow crossing bands is one person waiting on another — the question the view exists to answer. Lane order is declared, not derived from size: named people alphabetically, then ids that resolve to nobody, then unassigned last. Sorting by workload would reshuffle the whole canvas every time somebody finished something.

`assigneeId` is a Project Director contact id, and is deliberately distinct from `addedBy`/`completedBy`. Those are *history* — who raised it, who finished it; this is a *plan*, and the only one of the three that can be wrong about the future, which is what makes it the only one worth editing. It is stored as an id rather than a name so a rename in the roster keeps the work attached, and an id whose contact no longer exists is **kept rather than dropped**: deleting somebody from the roster is not a statement that their work became unassigned, and the two states surface separately (`RoadmapLane.unresolved`) rather than being merged. The webview offers only roster entries and the host re-validates the id against the live roster, so a page can never manufacture an assignment to somebody no other surface knows about.

### RoadmapImport (`src/core/roadmapImport.ts`)

Somebody else's roadmap, read into this one. The backlog could only be typed, which is fine for a project that started in AtlasMind and useless for every project that did not: the plan already exists, as markdown under `docs/`, as GitHub issues, on a Projects board, or in a spreadsheet somebody exported. Six rules, all of them about not damaging a plan that already works.

**Import, never mirror.** `improvement-plan.md` stays the one file that says what the work *is*. Every link, deadline, estimate, assignee and position lives in the graph overlay keyed to durable ids in that file, so a second authoritative source would leave all of it pointing at rows nobody owns. This copies in and records the provenance; it does not leave the source in charge.

**Re-runnable, matched on a recorded key rather than on text.** An import you can only do once is one nobody dares do at all. `RoadmapImportRecord` is stored per line, so a second run updates what moved and adds what is new. Matching runs in two passes and the order is the policy: **the import key wins**, because it is the only thing that survives a rename on either side; only then does text matching run, and only against lines with *no* import record. That second restriction does two jobs — it lets a first import **adopt** a hand-typed backlog instead of duplicating every line, and it stops a later import from stealing lines that belong to a different source.

**Nothing is deleted, ever.** An item the source no longer produces is reported as `missing` and left exactly where it is. It may have been dropped, renamed, or the glob may have stopped matching a file — three different things that are indistinguishable from here, and `debtRegister` refuses the same guess for the same reason. `missing` is scoped to the same kind *and* the same source label, so a markdown import never claims the issue importer's lines vanished.

**A local edit is never overwritten; it is reported.** `importedTitleNormalized` records what the source said at import time, which is the single field the whole mechanism rests on: without it, "the user edited this" and "the source changed" are indistinguishable, and an importer that cannot tell them apart must either discard edits or never update anything. When both sides have moved, the entry is a `conflict` carrying both texts and nothing is written.

**A plan is not a write.** `planRoadmapImport` returns what would happen, with the declared rule that produced every outcome (`ROADMAP_IMPORT_RULES`, published with the plan). Nothing in the module touches a disk, a network or `vscode`.

Every source is untrusted text and nothing throws: titles are control-stripped via a Unicode property escape, stripped of their own list markers and checkboxes (a title carrying `- [ ]` would nest a checkbox and break the roadmap parser on the next read), pipe-neutralised, clamped on a word boundary, de-duplicated and capped, with every cap stated in `notes`. Two markdown inferences are declared rather than hidden, and both are visible in the plan before anything is written: a file containing any checkbox is read as **checkboxes only** (a roadmap file uses bullets for the notes around its items), and the nearest heading is kept as *context* and never folded into the title. Spreadsheet parsing honours quotes, because "Fix login, then logout" arriving as two items is a silent corruption nobody would look for, and a missing title column **refuses** rather than defaulting to column 0. A GitHub Project status is context, not completion, unless the caller declares which columns mean done — "Done" is a convention, and marking live work as delivered is the more expensive mistake.

The host owns every prompt. The webview posts `importRoadmap` with no payload at all, so a crafted message can start the flow and can never name a file to read, a project to query or a column to trust. `applyRoadmapImport` writes the backlog first and the overlay second — the overlay is meaningless without the line it points at — and attaches import records by matching normalized text against the ids the re-open just minted, the same repair path the store uses when an anchor has been lost.

### RoadmapGraphStore (`src/core/roadmapGraphStore.ts`)

Where the graph lives on disk: `project_memory/roadmap/roadmap-graph.json` plus a `roadmap-graph.md` mirror, `fs`-only and unit-tested. The backlog itself stays exactly where it was — `improvement-plan.md` is still the one file that says what the work *is*; this holds only what a markdown checkbox cannot: deadlines, branch overrides, estimates, canvas positions, who added or completed each item, and the links.

**Identity is durable and carried by the markdown.** Roadmap item ids were positional (`roadmap-3`) and renumbered whenever anything was inserted above them — fine for a list, useless for a graph. A backlog line now carries an `<!-- rm:id -->` anchor: an HTML comment, so it is invisible in every markdown renderer while staying greppable and hand-editable. `mintRoadmapNodeId` derives it from the text with a de-duplicating **ordinal** — never a timestamp, never a random value — because the roadmap is committed and two developers wiring up the same backlog must not produce a diff. Anchors are written once, when the dashboard first loads (`ensureRoadmapAnchors`, once per session): they used to be written on the first *change*, which left every id on screen provisional at exactly the moment the first save needed it to be durable. Graph *records* still exist only for items that actually gained data — the JSON stays as small as the plan.

**The view and the write resolve ids through one shared function.** `resolveRoadmapItemIds` reconciles (adopting a surviving record for an item whose anchor was lost), then mints for what is left, then lets every adoption win. The canvas view used to do all three steps while the write path minted bare — so an unanchored item with a surviving record was `slug` on screen and `slug-2` on disk, and every save, move, or link against the on-screen id returned silently. Both sides now make the identical call, an anchor that diverged from its record is rewritten to agree, and an action that still cannot resolve its node warns and resyncs instead of doing nothing.

**A record whose anchor was lost is repaired, not duplicated.** `reconcileRoadmapGraph` resolves anchored items first, then adopts unclaimed records by normalized text — the hand-edit repair — with the ordering guaranteeing an anchored item always beats a text match for the same record, so a duplicated line cannot steal another item's history. A record no item claimed is dropped along with every edge and dismissal touching it: keeping it would put a node on the canvas that is not on the roadmap. Nothing here mints, because reconciliation runs on every render and a render must not write.

**Reads never throw and never seed over a newer file.** Same contract as every other register: `interpretVersionedDocument` (kind `roadmap-graph`, version 1) separates *corrupt* — replaceable — from *written by a newer AtlasMind*, which never is. A stored edge is normalised to `origin: 'declared'` on read, because a suggestion is never persisted and a file claiming otherwise is not to be trusted. A **reversed pair is kept** rather than de-duplicated: two people declaring opposite orders is a real disagreement, reported as a cycle rather than resolved on their behalf. Branch names are **validated, not cleaned** — the value reaches a `git` invocation, and a nearly-valid name made plausible fails later at `git checkout`, where nobody connects it back to the card it came from. `dismissed` records suggestions somebody said no to, since a rule-derived suggestion is re-derived on every render and would otherwise reappear immediately; it is stored as a rejection rather than as a reversed edge, because "these two are unrelated" and "the other one comes first" are different statements and only the second belongs in the plan. `layoutOrientation` lives here rather than in a setting for the same reason the gates do: which way the tree reads best depends on the shape of *this* graph rather than on who is looking, and two people opening the same plan should see the same picture. Snap-to-grid does not, because it only changes where your next drag lands.

**Auto-align releases positions; it does not write them.** `handleRoadmapAutoLayout` clears every stored `position` and records the orientation, so what the canvas shows afterwards is the deterministic layout everybody else's copy shows — writing coordinates would freeze one moment's arrangement into a committed file, and the next item added would land in whatever gap was left rather than in its own column. Every position is cleared, including nodes a filter is currently hiding: an "align everything" that quietly skipped them would leave the plan half aligned in a way nobody could see.

**Bulk-accepting the inferred tree is a separate, confirmed act.** `handleRoadmapDeriveLinks` is what the canvas's AtlasMind-marked *Calculate tree* button reaches. The suggestions are not new — they are derived on every render and each is one click from accepted — what this adds is doing the whole board at once, which is what makes the graph usable on a backlog nobody wired up by hand. It stays behind a modal naming the count, because accepting forty inferences in one go is exactly the moment a keyword coincidence would enter somebody's plan unnoticed. Each link keeps the rule that proposed it so the mirror can say "accepted suggestion" rather than claiming a person drew it, and inferences are applied one at a time against a growing edge set: one that only becomes circular *because of another accepted in the same batch* is skipped and reported. Derivation already guarantees that for the set it produced; re-checking here means the guarantee does not depend on two modules agreeing.

### TestingPolicyCoverage (`src/core/testingPolicyCoverage.ts`)

Answers, for every *enabled* testing policy, the question the Testing dashboard could not previously answer: **is anything actually testing it, and is any of it failing?** Pure and `vscode`-free — the caller (`collectTestingDashboardSnapshot`) gathers the evidence (test-file list with case/skip counts, dependency and script names, probed config paths, a discovered report) and `deriveTestingPolicyCoverage` derives the readout, so the whole derivation is unit-tested.

Each policy has a **marker set** (file-path patterns, dependency names, script-name patterns, config paths) chosen to be something the tooling itself creates — a `.feature` file, a `stryker.conf`, a `__snapshots__` directory — never a word that might appear in a filename, because a false "covered" is the one outcome the panel must not produce. That yields four statuses: `covered` (matching test files exist), `tooling-only` (its tooling is installed but nothing tests with it), `missing` (enabled with nothing to show), and `not-file-evident` for the policies that are a *practice* rather than an artifact (exploratory, black-box, gray-box, V-model, white-box, test-design, agile testing) — those are **never** reported as a gap, since flagging a practice trains people to ignore the panel.

**Every non-practice policy must have a route to `covered`.** `fileEvidencesPolicy` returns false when a policy declares no `filePatterns`, so a policy with neither those nor `configIsEvidence` caps at `tooling-only` — which the summary counts as a gap. `dead-field` and `dependency-graph` both sat there: a project could adopt `knip`, wire it into CI, and still be told it had nothing to show. `explainability` reached the same dead end from a different cause — its pattern matched the *stem* `explainab` with a whole-word trailing boundary, so `explainability` never matched it. All three now carry file patterns, and two invariants in `tests/core/testingPolicyCoverage.test.ts` hold the property: every non-practice policy has a route to `covered`, and every policy matches a test named after its own id (policies named after an *artifact* rather than themselves — `bdd` wants a `.feature`, `continuous` wants a pipeline — are listed as explicit exemptions rather than silently skipped). This is the same dead end `configIsEvidence` was added to fix for the documentary compliance policies, and a row that reads as a gap however much work is done is how a board stops being trusted.

**A compliance regime must not read as met on evidence that proves nothing.** `configIsEvidence` promotes *every* matched config file, so a loose pattern on a documentary policy does not merely over-count — it reports a certification as satisfied. `iso-27001` listed `SECURITY.md`, so any repository with a vulnerability-reporting policy read as covered for ISO 27001; only the control mapping counts now. The second half of the same failure was subtler: a *scaffolded but unassessed* mapping counted, even though the mapping's own preamble says "every row starts at **Not assessed**, which is deliberately not the same as compliant". `isAssessedControlMapping` closes it — the caller (`probePolicyConfigFiles`) reports a mapping as evidence only once at least one control row carries `Satisfied`, `Partial`, `Gap` or `Not applicable`. One row is enough deliberately, since grading half-finished work as nothing is its own false reading, and the check parses **table rows only**: the preamble lists every status as a legend, so a substring search over the document would mark every untouched mapping as assessed. Both directions are pinned by `tests/core/testingPolicyCoverage.test.ts`. The asymmetry is intentional — an unevidenced gap is a prompt to do the work, while a false pass on a regime is repeated to an auditor.

**For a documentary compliance policy the config genuinely *is* the artifact**, which is why `configIsEvidence` — added for continuous testing, whose pipeline definition is all it leaves behind — now also carries the compliance regimes evidenced by a control mapping rather than by tests. Without it a project holding a complete, reviewed ISO 27001 mapping would cap at `tooling-only` ("No tests yet") permanently and read as a gap it could never close. The mapping is found via `COMPLIANCE_EVIDENCE_DIR` (`project_memory/operations/compliance/`), which `probePolicyConfigFiles` enumerates by filename rather than reporting as a directory: the per-policy patterns must see the actual name, or every compliance policy would match every mapping. Enumerating rather than probing by id is deliberate — this module does not own the policy list, and a mapping written by hand counts exactly like a scaffolded one.

**Failures come only from a report the project produced.** `parseJUnitReport` reads the JUnit XML interchange format every mainstream runner can emit (vitest/jest reporters, pytest `--junitxml`, Playwright, surefire, gotestsum, dotnet). Nothing here ever runs a test command — a dashboard that shells out on render is both a surprise and an execution surface — so when no report exists the page says it has *no verdict* and quotes the command that would create one, rather than rendering "0 failures". The report is untrusted input: the parser never throws, resolves no entities beyond the five predefined ones and no external DTDs (attributes are read by regex, not an XML parser), caps how much it reads and how many cases it keeps, clamps and control-strips every string, and prefers the failures it can *count* over the totals the report *asserts* so a hand-edited report cannot present itself as clean. **Failure messages are deliberately never extracted** — an assertion message can carry values from a test environment and this data is rendered in a webview; the test name, suite, and file are enough to open it. Report staleness (a test file changed after the report was written) is surfaced rather than hidden, and skipped-test counts are derived locally from the test files themselves, so that signal exists even with no report at all.

**The explainer is also derived, never routed.** `buildTestingPolicyLaymanGuide` is total over the 69-methodology id union and declares the beginner-facing meaning and expected result of every policy; requirements, use case, and trade-off come from the same catalogue and marker rules that produce the status. The Dashboard host combines that guide with the freshly rebuilt `TestingPolicyRow`, explains why the status follows and what it cannot prove, then opens Chat with a one-shot `ChatPanelDirectResponse`. The response is consumed before any asynchronous work and bypasses `Orchestrator.processTask`, so a deterministic explanation cannot fan out through provider recovery. Chat normalizes, bounds, and secret-redacts the host-authored Markdown/metadata, accepts only an `atlasmind/*` source id, and renders bounded follow-up prompts as quick-reply chips; those chips cannot name commands.

### TestingFrameworkDetection (`src/core/testingFrameworkDetection.ts`)

Which test runner the Scaffold button should use, decided once and read everywhere. The previous logic knew two runners out of six and defaulted to Vitest whenever it found neither, which is wrong in both directions: a Mocha project received Vitest files it could not run, and a project already on Vitest could be handed `npm install -D jest` — the way a repository ends up with two runners and a suite only one of them can execute.

Pure; the caller gathers dependencies, script text, config filenames and test paths. Four rules. **What the project already uses always wins** — detection outranks preference entirely, and the recommendation ladder (Vite → Vitest, React without Vite → Jest, SvelteKit/Nuxt/Astro → Vitest) is consulted only when nothing is installed. **Ambiguity is a question, never a coin toss** — two runners installed with no majority among the test files, or a Node backend where the built-in runner and Jest are both defensible, return `ask` with the candidates and the question; the Scaffold handler shows a QuickPick *before* writing anything, and dismissing it cancels rather than defaulting. **Unit and end-to-end are separate choices**, because collapsing them is what made "already uses Cypress" read as "needs no unit runner". **Forbidden installs are data rather than a comment**: `plan.forbidden` carries every runner that must not be added and why, so the never-Jest-beside-Vitest rule is something a test can walk.

One implementation detail is load-bearing: **test-file ownership is exclusive**. Giving each framework its own pattern and counting matches independently double-counts, because `cypress/e2e/a.cy.ts` satisfies Playwright's `e2e/` directory rule as well — the counts then exceed the file total and the majority tie-break is meaningless. In the case that caught it, Playwright "won" a project containing no Playwright tests. `ownerOfTestFile` assigns at most one owner, most-specific first.

### TestingFrameworkSyntax (`src/core/testingFrameworkSyntax.ts`)

A starter test described neutrally, then rendered in the selected runner's dialect. Correcting the import line alone would not have been enough — `expect().toBe()` is not Chai and `vi.mock` is not `jest.mock`, so an import-only fix produces a file that fails on line two instead of line one. Jest and Cypress render **no import at all**, because both inject their globals and importing `describe` without `@jest/globals` installed is an error rather than a style choice. `frameworkHeader` is exported separately so the scaffolder's hand-written policy templates can have their header corrected without losing prose worth keeping.

### ComplianceTechnicalControls (`src/core/complianceTechnicalControls.ts`)

The controls in a governance regime that a machine can check. A documentary policy is mostly human attestation and AtlasMind is right not to claim otherwise — but *mostly* is not *entirely*, and "a backup is taken before a production promotion", "no declared endpoint uses plaintext http off the loopback", "dependencies are scanned" and "changes are reviewed before merge" are facts about a stack that this project already models in `deliveryManager`, `lensEndpoints`, the CI workflows and `workflowConfig`. None of it reached the compliance board, so a regime with ten controls sat entirely at *Not assessed* while several were verifiable from disk — the mirror of the false-covered failure, and the reason a regime looked unautomatable when it was not.

Pure: `evaluateTechnicalControls(policyId, signals)` takes a `ComplianceStackSignals` bundle the caller gathers (`gatherComplianceStackSignals` in `settingsPanel.ts`) and returns one result per declared check. Four rules. **A signal that was not gathered is `unknown`, never `satisfied`** — every field on the bundle is optional and absent means "not looked at", which is the one place on a compliance surface where guessing in the reassuring direction must be refused. **Every result names the declared rule that decided it**, as the debt register and severity table do. **A control with no technical check is absent from the results rather than passed**, with `humanControlCount` stating the remainder so "4 of 7 verified" cannot read as the whole regime. And **one question asked by three standards shares one implementation** — ISO A.8.8, SOC 2 CC7.2 and NIST RA-5 are the same check, and three copies would eventually disagree about one repository.

**The control sets themselves live in `COMPLIANCE_PROFILES` (`testingScaffolder.ts`) and carry a `theme`.** Both ISO 27001 and SOC 2 originally declared an engineering checklist — nine A.8 controls and one A.5 for ISO, no CC1–CC5 at all for SOC 2 — which is half a regime rather than a curated subset, and the omission is invisible in an ungrouped list. Themes (`governance` / `people` / `physical` / `technological`) make it visible in the document, and the mapping renders governance first because that is the half an assessor opens with. `complianceControlsFor` exposes the set so a test can pin `DECLARED_CONTROL_COUNT` to it: the two live in different files with no compiler relationship, and a count that drifted below the real set would under-report how much is still a person's job. A row whose control has an automated check carries a **pointer to the live result, never a copy of it** — the mapping is never rewritten, so a recorded verdict would be a fact about the day it was scaffolded presented as a current one.

`hasTechnicalControls` answers the question behind "is this protocol worth keeping switched on?": a regime with no automated check is one where the dashboard genuinely cannot help. Results feed back into `deriveTestingPolicyCoverage` through `technicallyEvidenced`, and **only a `satisfied` control is passed** — a `gap` is a finding and an `unknown` is silence, so promoting on either would rebuild the false pass the mapping rules exist to prevent. Nothing here writes to the control mapping: an automated check that passed is evidence, and recording it is a separate human act.

### TestingProtocolSync (`src/utils/testingProtocolSync.ts`)

The outbound counterpart to `aiInstructionSync.ts`. `syncTestingProtocols(workspaceRoot, config, agents)` renders the enabled methodologies into a delimited, AtlasMind-managed markdown block (`<!-- atlasmind:testing-protocols:start -->` … `:end -->`) and upserts it into every *detected* (existing) external agent instruction file — `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, Cursor, Cline, Gemini, Windsurf, Aider. It only ever rewrites its own block, preserves surrounding content, writes only to files that already exist, and routes all paths through the shared `isSafeRelativePath` / `resolveRelativePath` traversal guard (exported from `aiInstructionSync.ts`). The upsert/strip primitives live in the shared `managedBlock.ts`. JSON-config tools are reported as skipped. The orchestrator and the Settings → Testing matrix call this so external agents stay in step with the configured strategy.

### AiInstructionMerge (`src/utils/aiInstructionMerge.ts`)

Two-way instruction-set sync, driving the `/sync-instructions` chat command and the Settings → AI Instructions "Align all instruction sets" action. Where `aiInstructionSync.ts` only imports other tools' instructions *into* AtlasMind, this module reconciles them *across* tools:

- `gatherInstructionSources(workspaceRoot)` reads the full authored content of every detected tool file plus AtlasMind's own canonical instructions (`project_memory/agents/atlas-personality-profile.md`, `project_soul.md`), stripping AtlasMind-managed blocks so the merge never re-ingests its own mirror.
- `runInstructionMerge` / `parseMergeResult` run one LLM reconciliation (via the injected `complete()` — wired to `Orchestrator.completeBootstrap`) returning a unified directive set, auto-resolved minor differences, and only *genuinely contradictory* `conflicts`. Parsing is defensive: malformed/empty output throws before anything is written.
- `runInstructionRender` / `renderUnifiedMarkdown` re-express the unified set in each tool's native format (deterministic fallback when the model omits a tool); `applyManagedInstructionBlock` upserts the result into each detected file's `<!-- atlasmind:shared-instructions:start -->` block (same non-destructive, traversal-guarded, detected-set-only, JSON-skipped policy as the testing sync); `writeUnifiedToSsot` mirrors the set to `project_memory/domain/ai-instructions-sync.md`.

Significant conflicts are surfaced in chat and the writeback is gated on user resolution (recommended pick, per-option override, then apply); in-flight state lives in `workspaceState` (`atlasmind.pendingInstructionSync`).

### TerminalOutput (`src/utils/terminalOutput.ts`)

Display-side sanitizers for raw command/terminal output. `stripAnsiSequences(value)` removes ANSI/VT escape sequences — CSI (colours, cursor moves) and OSC (window titles, shell-integration markers) — while leaving printable text intact. `sanitizeTerminalOutput(value)` builds on it for non-terminal surfaces: it strips the escape sequences, folds carriage returns into newlines, and removes any leftover non-printable control bytes (preserving tab/newline). Patterns are assembled with `String.fromCharCode` so the module holds no literal control characters. The post-write verification summary in `extension.ts` (`formatVerificationOutcome`) runs captured tool output (e.g. `vitest`) through `sanitizeTerminalOutput` so colour codes can't reach the chat **Verified:** bullet as garbled `[1m[7m[36m RUN …` fragments; the managed-terminal stream in `chatPanel.ts` uses `stripAnsiSequences`.

### ModelEvalHarness (`src/core/modelEvalHarness.ts`)

A scored-replay harness (`compareModelsOnPrompt`) that runs one prompt across a set of candidate models and returns a ranked comparison — graded output quality (`gradeExecutionQuality` from the shared `executionQuality.ts`), cost, latency, token counts, and a preview. The model call is injected so the core is pure and host-independent; graded outcomes are surfaced via an `onResult` callback so a benchmark can record them into the router's outcome channel, calibrating outcome-driven routing. Backs the `AtlasMind: Compare Models on a Prompt` command.

### ScannerRulesManager (`src/core/scannerRulesManager.ts`)

Persists scanner rule overrides and custom rules in `vscode.Memento` (`globalState`). Key: `atlasmind.scannerRulesConfig`. Methods: `getConfig()`, `getEffectiveRules()`, `updateBuiltInRule()`, `resetBuiltInRule()`, `upsertCustomRule()`, `deleteCustomRule()`. Validates regex patterns before accepting any change. entries per session. Provides `getSummary()` returning totals for cost, requests, and tokens. Supports `reset()`.

### MemoryManager (`src/memory/memoryManager.ts`)

Interface to the SSOT folder structure. Supports `queryRelevant()` (local hashed embeddings + lexical ranking), `upsert()`, `loadFromDisk()`, and `listEntries()`.

### SessionConversation and SessionContextManager (`src/chat/sessionConversation.ts`, `src/memory/sessionContextManager.ts`)

`SessionConversationRecord.revision` is the monotonic version of context-bearing transcript content and
is persisted with the transcript; records written before v0.382.4 normalize to revision zero. Append,
content update, deletion, truncation, and non-empty clear advance it, while a no-op mutation does not.

`SessionContextManager` treats the model-maintained bundle as a revisioned derived cache. A successful
maintenance pass writes `revision.json` last, and `loadContext(sessionId, expectedRevision)` returns no
bundle unless that marker matches. `SessionContextBundle.sourceRevision` and `freshness` expose the
provenance without pretending a legacy or synthetic bundle has a transcript revision.

Per-session invalidation uses an in-memory generation plus an ordered barrier: the generation changes
before an older maintenance task is awaited, preventing that completion from committing as current, and
the session folder is deleted only after the task's last possible write. ChatPanel awaits this boundary
for Clear, Delete Message, Delete Session, New Chat, Edit, and Regenerate; the native project-context path
also supplies the current revision when it loads a bundle.

### RemoteControlServer (`src/remote/remoteControlServer.ts`)

Desktop-only localhost WebSocket server that lets the AtlasMind web build remote-control this instance. Off by default; only listens after `AtlasMind: Enable Remote Control`, a workspace-trust approval, and a pairing token (stored in `SecretStorage`, modeled on `ToolWebhookDispatcher`). On an authenticated connection it constructs a `RemoteWebviewHost` (`src/remote/remoteBridge.ts`) — a synthetic `ChatPanelHost` — and binds a real `ChatPanel` to it, so the full chat implementation drives the remote browser. Outbound `webview.postMessage` calls are forwarded over the socket; inbound chat frames are re-validated with `isChatPanelMessage` before dispatch. It also answers read-only `cost`/`runs` RPCs backed by `CostTracker` and `ProjectRunHistory`. Disconnect disposes the ChatPanel (aborting in-flight work, so pending tool approvals default to denied). The wire protocol is the Node-free `src/remote/protocol.ts`, shared with the web build. In `gateway` mode (`atlasmind.remote.mode`) it instead authenticates each connection by an `x-atlas-origin-secret` upgrade header injected by an SSO gateway (verified timing-safe against the pairing-token slot) and records `x-atlas-user-id` for audit, so it can sit behind a Cloudflare Worker + tunnel for cross-machine access without opening an inbound port. See [Remote Control](remote-control.md).

## Key Interfaces

`WebsiteWorkspaceConfig` v10 keeps the compatibility page model and adds the authoritative design core:

```typescript
interface UiDesignGraph {
  revision: number;
  tokens: UiDesignToken[];
  components: UiComponentDefinition[];
  contentCollections: UiContentCollection[];
  screens: UiDesignScreen[];
}

interface UiDesignScreen {
  id: string;
  pageId: string;
  initialized: boolean;
  baseBreakpoint: 'desktop' | 'tablet' | 'mobile';
  nodes: UiDesignNode[];
}
```

Each `UiDesignNode` owns a bounded base layout, optional per-viewport overrides, stable parent identity,
non-executable content/style references, an optional explicit `UiComponentInstance` plus parent slot, and an
optional preview-only `UiNodeDataBinding` that maps semantic title/body/action slots to one declared fixture.
A component definition declares a root kind, typed properties, variants, slots, and closed states; an instance
names that definition and carries bounded overrides only. `initialized` is required because “never drawn” and
“drawn, intentionally empty” are different facts. Revision is monotonic even across undo/redo.

`VoiceSettings` carries both synthesis controls and capability-sensitive device preferences:

```typescript
interface VoiceSettings {
  rate: number;
  pitch: number;
  volume: number;
  sttEnabled: boolean;
  language: string;
  inputDeviceId: string;
  outputDeviceId: string;
}
```

The webview can always honor the tuning values, but device ids are enforced only when the active backend and runtime expose the necessary APIs.

`ProjectRunRecord` now also carries chat-link and review metadata so autonomous work can stay reviewable inside the originating transcript instead of forcing a separate dashboard hop:

```typescript
interface ProjectRunRecord {
  id: string;
  goal: string;
  chatSessionId?: string;
  chatMessageId?: string;
  reviewFiles?: Array<{
    relativePath: string;
    status: 'created' | 'modified' | 'deleted';
    decision: 'pending' | 'accepted' | 'dismissed';
    decidedAt?: string;
  }>;
}
```

That linkage lets the chat panel nest autonomous runs under their parent session, reopen the run as an inline review bubble beneath the assistant turn that launched it, and keep pending per-file decisions visible in the composer flyout.

### ProviderRegistry (`src/providers/index.ts`)

In-memory map of provider adapters implementing `ProviderAdapter`. The orchestrator resolves adapters by provider id (for example `anthropic`, `acp`, and `local`) before executing completions.

### LocalModelArbiter (`src/core/localModelArbiter.ts`)

Who gets the GPU, and who waits. AtlasMind can issue a local model call from at least six places that never meet — the scheduler's five-way subtask fan-out, the bootstrapper's four unbounded parallel completions, the skill auto-assigner's unbounded sweep, two background timers, and every ordinary chat turn — and all of them land on one graphics card. Both runtimes do arbitrate internally (Ollama queues and evicts, LM Studio auto-evicts) but each does so against whatever free memory it sees at that instant and neither can see the other. Neither reserves anything for the desktop: measured on a 24 GB card with no model loaded, 9.2 GB was already committed to Windows, a browser and antivirus.

Five properties, in the order they matter. **A slot wraps one HTTP call and nothing else** — a leaf operation that awaits nothing which could itself need a slot, which is what makes deadlock structurally impossible rather than merely unobserved. **The scarce resource is residency, not requests**: two calls to a resident model cost one context cache each, so weights are charged once per distinct model with a refcount and each request charges only its own cache — charging per request would serialise a same-model fan-out while still permitting three different models to become resident. **Cold loads run one at a time, globally**, which is what makes a load *attributable*: poll before, poll after, and a model that appeared with no other cold load in flight was caused by this arbiter — the only mechanism available, since Windows cannot attribute VRAM per process at all (`nvidia-smi --query-compute-apps` returns `[N/A]` under WDDM). **A wait is bounded and expiry refuses**, throwing a typed capacity error so the turn fails over rather than wedging. **Unknown is never unlimited**: with no free-memory reading the arbiter caps *distinct resident models* rather than concurrency, because Ollama holds a model for five minutes after a request and capping concurrency alone would bound nothing.

The gate lives in `LocalEchoAdapter.completeWithLocalEndpoint` rather than the Orchestrator, because most of those six call sites bypass the Orchestrator's retry path entirely. It is taken as an optional structural dependency (`LocalAdmissionGate`, declared in `registry.ts` — the `BuzzPresenceLock` idiom), so an adapter built without one behaves exactly as it did before.

Supporting modules: `vramBudget.ts` (pure headroom and admission policy with a published rule table), `providers/gpuProbe.ts` + `providers/gpuProbeParse.ts` (the probe chain and its parsers), `providers/localFootprint.ts` (footprint estimation calibrated against real blob sizes), `providers/localRuntimeClient.ts` (Ollama `/api/ps`, LM Studio `/api/v1/models`).

**The budget's second limb is a ceiling on AtlasMind's own share, not an OS reserve.** The obvious `min(free − margin, total − reserve)` looks like two protections and is one: `total − reserve` is a constant, so once anything is loaded the measured limb is always lower and the reserve never binds again. It has to be `total − reserve − whatAtlasMindHolds`, and that held figure comes from the residency poll rather than from local bookkeeping — if the user restarts Ollama, the poll self-corrects.

**Eviction is guarded four ways, and the first is absolute.** Only models AtlasMind loaded are candidates — a model the user loaded by hand is never touched, whatever the pressure, because unloading it would take away work somebody was in the middle of to serve a background task they never asked about. A property test asserts no producible plan names an unowned model, and an arbiter-level test confirms a tight card holding only a hand-loaded model waits and then refuses rather than reclaiming it. The others: never a model with a request in flight; never one served inside `LOCAL_GPU_EVICTION_COOLDOWN_MS`, since evicting a model about to be reused produces a load-evict-load cycle slower than waiting; and never one whose resident size was not measured, because claiming an unknown quantity of space is how a budget starts lying. **A partial plan is not executed** — unloading two models and still not fitting costs both reloads and gains nothing. Each unload is confirmed by the runtime and residency is re-read afterwards, because an unload is a request rather than a fact.

**A capacity refusal is not a model failure.** It travels the ordinary failover path, so `isCapacityDeferral` guards all three punishments the catch block would otherwise apply: the endpoint circuit, `recordModelFailure`, and struggle memory. The check is structural rather than message-based, because all three of those guards are wording-based and a reworded message would silently re-arm them.

### ModelRole (`src/providers/modelRole.ts`)

What a model is *for*, decided before it can be routed to. A provider's `/v1/models` list is an inventory of what it serves, not a list of things that can hold a conversation: a local runtime enumerates every set of weights it has loaded, and OpenAI's own list carries `text-embedding-3-large`, `whisper-1` and `dall-e-3`. Nothing distinguished them, so `inferCapabilities` granted `chat`, `code` and — on a bare `llama` substring, or on any non-local provider — `function_calling` to all of them. A local Llama Guard model reached the router at zero cost, survived to the last failover of a turn, and answered with a chat-template error.

The module publishes `MODEL_ROLE_RULES`, a short table of declared families (safety classifier, reranker, embedding, transcription, speech synthesis, image generation), and `classifyModelRole` returns the role together with the rule that decided so an exclusion is explainable. Three properties: **absence of a marker is not evidence of a non-chat role** (an unrecognised model is always conversational — a false positive silently hides capacity the user installed, so a miss is the designed failure mode); **markers match name segments, never bare substrings** (`bge` and `sdxl` are short enough that substring matching would sweep up ordinary chat models); and **rules are evaluated in declaration order**, which is load-bearing for `bge-reranker-v2-m3`, an id carrying both an embedding marker and a reranker one.

Enforced at three layers: discovery drops these models in `registry.ts` and `openai-compatible.ts` so they are never registered; `inferCapabilities` and `inferLocalCapabilities` return **no capabilities at all** for them; and `ModelRouter.isRoutableChatModel` refuses any model that does not declare `chat`, in both the preferred-model and candidate paths. The router gate is the enforcement rather than the documentation — `requiredCapabilities` never names `chat` because it is assumed, which is exactly why a model with no usable capabilities remained an ordinary candidate.

The local model advisor reads its release-aware recommendation catalog from `src/providers/localModelRecommendationRegistry.ts`, which supports a validated workspace override file at `.atlasmind/local-model-recommendations.json` and falls back to built-in defaults when the override is missing or invalid. Each recommendation card offers one-click install into **Ollama** (via the streaming `/api/pull` API — surfaced as live progress in a shared output channel and a cancellable notification, with a daemon-reachability preflight — translating `hf:owner/repo` candidates to the `hf.co/owner/repo` pull syntax) and **LM Studio** (via `lms get <model> --yes` run as a direct child process). Both stream into the shared **"AtlasMind: Local Model Install"** output channel. Cards whose model is already present in a local runtime — matched on a normalized identity key (`localModelMatchKey`) so HuggingFace- and Ollama-style ids reconcile — show an installed badge instead of install buttons.

### ToolWebhookDispatcher (`src/core/toolWebhookDispatcher.ts`)

Sends outbound webhook notifications for tool execution events. Reads workspace webhook settings (`atlasmind.toolWebhook*`), stores bearer token in SecretStorage, persists delivery history in globalState, and applies timeout/event filtering before dispatch.

### McpClient (`src/mcp/mcpClient.ts`)

Wraps `@modelcontextprotocol/sdk` `Client` for a single server. Supports `connect()`, `disconnect()`, `callTool()`, `refreshTools()`. Handles `stdio` (subprocess via `StdioClientTransport`) and `http` (Streamable HTTP with SSE fallback via `StreamableHTTPClientTransport` / `SSEClientTransport`). Tracks `status: McpConnectionStatus` and surfaces `error` and `tools` as readable state.

For audited bundled starters it also resolves `${extensionPath}` plus the three fixed Buzz configuration templates (`buzz.enabled`, `buzz.relayUrl`, `buzz.allowRemoteRelay`). This is a closed allowlist, not a general settings interpolation surface.

### McpServerRegistry (`src/mcp/mcpServerRegistry.ts`)

Manages `McpServerConfig` persistence (key: `atlasmind.mcpServers` in `globalState`) and live `McpClient` instances. On `connectServer()`: instantiates a client, calls `connect()`, then registers each discovered tool as a `SkillDefinition` in `SkillsRegistry` (ID: `mcp:<serverId>:<toolName>`) with auto-approved scan status. On `disconnectServer()`: disables or unregisters the corresponding skills. `connectAll()` is called non-blocking on activation; `disposeAll()` is called on deactivation.

Credentials are kept out of `globalState`: env vars listed in `McpServerConfig.secretEnvKeys` have their **values** stored in VS Code `SecretStorage` (key `atlasmind.mcp.<serverId>.<KEY>`, injected via the constructor's optional `secrets` param), resolved and merged into the process env only inside `connectServer()`, and deleted on `removeServer()`. `setServerSecrets()` writes them; the persisted config holds only the key names. `detectAvailableServers()` scans the local environment and returns only servers whose launch runtime is actually present (each with a `reason`), for the guided setup wizard's **Scan my computer** step.

### McpEnvironmentScanner (`src/mcp/mcpEnvironmentScanner.ts`)

Discovers MCP setup signals so the "Add MCP server" flow can hand-hold instead of asking a novice to invent a command. It **imports** server definitions from other tools' config files (Claude Desktop, Cursor, VS Code, Windsurf, a repo `.mcp.json`/`mcp.json` — parsing both the `mcpServers` and `servers` shapes), **probes PATH** for launch runtimes (npx/uvx/docker/…), and reads env-variable **names** from `.env*`/`wrangler.toml` plus project signals (e.g. a Cloudflare Workers project). The result (`McpEnvironmentScan`) is cached in SSOT at `project_memory/operations/mcp-environment.json` with a `mcp-environment.md` mirror and reused on future installs; the panel exposes a **Rescan** button and auto-refreshes when a workspace MCP config file changes. Like the other managers, the module is `vscode`-free and unit-tested.

**Redaction boundary (safety-first):** the scan and its cache capture only env-variable *names* and a secret/not-secret classification (`classifySecretEnvKey`) — never secret **values**. On **Import & connect**, `resolveImportedServer()` re-reads the source config file live, splits secret-looking env vars into a `secrets` map routed to `SecretStorage` (recorded as `secretEnvKeys`) and non-secret ones into `env`, so a token is never written to the git-tracked cache nor sent to the webview. Complements `McpServerRegistry.detectAvailableServers()` (runtime-only detection for the guided "Scan my computer" step) and the bulk `importFromVsCode` command.

### mcpRuntime (`src/mcp/mcpRuntime.ts`)

Shared runtime-bootstrap helpers used by both the recommended-install command and the guided wizard. `checkStarterRuntime()` reports whether a server's launch runtime exists and, if not, *plans* an install (`installable` with the exact command, or `manual`) — it never installs. `runRuntimeInstallPlan()` runs a plan only after the caller has obtained explicit user confirmation (confirm-before-install policy).

### BuzzCliBridge / Buzz communications MCP (`src/mcp/buzzCliBridge.ts`, `src/mcp/buzzCommsServer.ts`)

Communication-only adapter for official Buzz CLI source tag v0.4.26. `BuzzCliBridge` owns configuration/relay validation, required command/flag contract probing, direct process execution, bounded JSON parsing, identifier validation, stdin message delivery, and secret redaction. `buzzCommsServer.ts` declares the four MCP tool schemas and annotations, checks readiness before connecting stdio, and contains no AtlasMind reasoning or workspace-execution surface.

### BuzzProtocol (`src/core/buzzProtocol.ts`)

Verified Nostr wire framing for Tier-3 **inbound** sync — the read side, complementing the outbound `BuzzCliBridge`. Buzz is Nostr-based, so the transport is **not** a Buzz invention: NIP-01 and NIP-42 are published open specifications, which is why this layer could be built and fully tested without a live relay. Everything is read from spec or from Buzz's own registry: NIP-01 event shape and `EVENT`/`REQ`/`CLOSE`/`OK`/`EOSE`/`CLOSED`/`NOTICE` framing; NIP-42's `["AUTH", <challenge>]` → signed **kind 22242** event carrying `relay` and `challenge` tags; and kind numbers from `crates/buzz-core/src/kind.rs` at `BUZZ_PROTOCOL_VERIFIED_VERSION` (`v0.4.26`, matching the pinned CLI tag).

**Kind selection was corrected by a live relay, not by reading.** The registry defines both `KIND_STREAM_MESSAGE = 9` and `KIND_STREAM_MESSAGE_V2 = 40002`, and the source alone reads as though 40002 supersedes 9. A real Buzz relay disagreed: its stored history held kind **9** messages (tagged `h`, `p`, `client`) and **zero** 40002 events. Subscribing to 40002 alone authenticates, subscribes, reaches EOSE — and receives nothing, forever, which is the worst kind of failure because everything looks healthy. Both kinds are now subscribed and derived, so either deployment works. Channel metadata being **39000** (not the legacy NIP-01 kind 41) was confirmed by the same relay. A third trap is enforced by the type system: `NostrFilter.kinds` is **required and non-empty**, because Buzz answers a kind-less query with a 403 "p-gate".

**Untrusted-input boundary.** A relay frame arrives over the network from a party AtlasMind does not control, so `parseRelayFrame` never throws: oversized (`MAX_RELAY_FRAME_BYTES`), non-JSON, non-array, and structurally wrong frames all degrade to a typed `unknown` frame. `validateNostrEvent` checks hex lengths, kind range, and tag structure, returning undefined rather than coercing — and deliberately does **not** verify the Schnorr signature, so callers must not mistake structural validity for authenticity. `classifyRelayRefusal` separates a recoverable `auth-required:` from a terminal `restricted:`.

### BuzzConnectionPolicy (`src/core/buzzConnectionPolicy.ts`)

The **second half of "stays in contact"**. `PresenceManager` already keeps the *machine* awake; that is necessary but not sufficient, because a wake lock does nothing when the WebSocket silently drops. This module decides when a connection is dead and when to retry. It is pure and **clock-free** — time and randomness are arguments — so the whole policy is deterministically testable without timers or sockets.

`evaluateLiveness` is conservative by design: a connection is only `dead` after a keep-alive ping has been *sent* and gone unanswered, never from idleness alone, because a quiet channel is not a broken socket. `nextReconnectDelay` is capped exponential backoff with **subtractive** jitter, so a delay can never exceed the cap it is meant to enforce, with the exponent clamped so a long outage can't overflow. `planReconnect` refuses to retry a `restricted:` refusal — the client already authenticated and the relay still rejects that key, so retrying cannot change the outcome and must not become a hammering loop. `buildResumePlan` re-subscribes tracked filters and re-announces presence (a fresh socket keeps none of the previous connection's state, so reconnecting alone leaves an agent silently absent while looking connected), rewinding the cursor by a small overlap: clocks drift, and a duplicate the caller de-duplicates by event id is a better failure than a silently dropped message.

### BuzzInboundDerivation (`src/core/buzzInboundDerivation.ts`)

Enforces the roadmap's load-bearing inbound rule, **derive, don't mirror**. An event becomes a `FollowUp`-shaped work item carrying a **pointer back to the Buzz thread** and a short, sanitised title — never the message body. This is a privacy boundary as much as a storage one: SSOT files are git-tracked, so mirroring a channel would commit colleagues' chat into the repository. Buzz stays the message system-of-record; the pointer is the deliverable.

`sanitizeDerivedText` redacts secret-shaped material (`nsec…`, 64-char hex, `sk-`/`ghp_`/`xoxb-` tokens), strips control characters so a crafted message can't corrupt a Markdown mirror, and clamps to a title length. Derivation is total — underivable kinds and empty text return a reason instead of throwing — and never invents a linked entity the event doesn't support. `deriveWorkItems` de-duplicates by event id, which is what makes the reconnect replay overlap safe. `buildBuzzThreadLink` applies the same `https`-only allowlist as Director contact deep links and percent-encodes the channel id, so a crafted pointer can neither produce a launchable non-https URI nor traverse the path.

### BuzzClient (`src/core/buzzClient.ts`, `src/core/buzzSocket.ts`)

The inbound subscription itself — the piece that *drives* the three modules above. It owns the state machine (connect → authenticate → subscribe → receive → drop → back off → resume) and nothing else: it parses no frames, invents no delays, and stores no conversation.

**Transport-agnostic on purpose.** The socket arrives through an injected `BuzzSocketFactory`, the same idiom `PresenceManager` uses for `spawn`, so `buzzClient.ts` imports neither `ws` nor `vscode`. That keeps the whole machine unit-testable against a fake socket *and* testable against a real in-process WebSocket server (`tests/core/buzzClient.integration.test.ts`), which covers what a fake cannot: the genuine handshake, `ws`'s Buffer→string delivery, real ping/pong, and a hard TCP drop with no closing handshake. `createBuzzWebSocketFactory` (`buzzSocket.ts`) supplies the real transport; `ws` was already a dependency, so inbound sync adds none. `toWebSocketUrl` maps the CLI-style `http(s)` relay base onto `ws(s)`, so a single `atlasmind.buzz.relayUrl` setting serves both the outbound CLI bridge and the inbound socket.

**Signing is a seam, not an implementation.** NIP-42 needs a Schnorr signature over a kind-22242 event, requiring a secp256k1 backend AtlasMind does not yet depend on. `BuzzEventSigner` is that seam. With no signer configured, a relay demanding auth produces a typed, explained stop — never a silent failure and never a reconnect loop.

**Safety.** Deny-by-default: constructing a client connects nothing, and `start()` is explicit. **Read-only by construction** — it sends only `REQ`, `CLOSE`, `AUTH`, and keep-alive pings, never an `EVENT`, so an inbound subscription cannot write to Buzz (asserted in tests). Every frame passes through `parseRelayFrame`, so malformed input is counted and ignored rather than acted on. A socket that cannot even be created is treated as a failed attempt and backed off, not an exception escaping into the extension host.

**Hosted relays.** A Buzz workspace need not be local. `toWebSocketUrl` therefore refuses an **unencrypted socket to a remote host** — plaintext to a hosted relay would expose colleagues' message content and the NIP-42 challenge/response in transit. Loopback is exempt because it never leaves the machine. The rule lives at the transport rather than in a policy caller, so no future wiring can reintroduce a plaintext remote connection, and it matches what the outbound `BuzzCliBridge` already enforces.

### BuzzAgentBindings + BuzzInboundService (`src/core/buzzAgentBindings.ts`, `src/core/buzzInboundService.ts`)

The wiring that turns the Tier-3 modules into a running feature, plus the mapping that gives inbound work an owner.

**Assigning AtlasMind agents to Buzz agents.** Buzz gives every participant — human or agent — a Nostr keypair; AtlasMind has its own roster of specialists. `atlasmind.buzz.agentBindings` maps one to the other, so a message from a Buzz build-bot lands with the DevOps agent instead of arriving unattributed. A binding holds a *list* of agents rather than one: a correspondent who raises both API defects and design feedback belongs to two specialists, and forcing a choice between them discards something the user actually knows. The **first is the owner**, because a follow-up has exactly one, and picking among a set by inference would be a claim the binding does not make; the rest ride along as also-relevant. A single binding is still serialised as a plain string, so a hand-authored record does not sprout arrays because one unrelated entry gained a second agent. It stays on AtlasMind's side of the governing contract: a **local routing preference**, not identity. Buzz still owns the keypair, the directory, and the authorship ledger; nothing is minted, mirrored, or verified here. Keys accept `npub…` or hex and are normalised through the bech32 decoder, so the two forms are interchangeable and a **mistyped npub is rejected rather than binding to a different identity** — silently routing work to the wrong agent would be worse than failing. An `nsec` is refused outright. Unusable bindings are *reported*, never dropped silently, and an unbound author stays unassigned because inferring an agent would be a claim the event doesn't support.

**Deny-by-default, two gates deep.** `BuzzInboundService` connects nothing unless both `atlasmind.buzz.enabled` and `atlasmind.buzz.inboundEnabled` are on, so upgrading never starts a network subscription. Persistence is a *third* gate: `autoCreateFollowUps` defaults off, because `project_memory/` is git-tracked and writing to it from a network event is something to opt into rather than inherit. While off, inbound activity is reported without being written.

### BuzzDirectory (`src/core/buzzDirectory.ts`)

The identities AtlasMind has *observed*, so a Buzz handle can be picked rather than typed.

**Nothing here derives a key from a person.** There is no function from "Jane Doe" to a public key; constructing one would produce a plausible key belonging to a **different real person**, silently routing a colleague's work to a stranger's identity. The module only records keys that arrived on the wire, from two evidence sources: a message event proves an identity is active in a channel, and a kind-0 profile event supplies that identity's own published name. An identity with no profile is labelled with a truncated key — honest — rather than an invented name.

**Kind 0 was verified, not assumed.** It is the standard NIP-01 metadata kind and is **absent from Buzz's kind registry**, so whether a Buzz relay serves it was an open question — the same shape of question that produced the kind-9/40002 mistake. A live relay confirmed every observed author had one, carrying `display_name`. It is deliberately excluded from `BUZZ_INBOUND_KINDS`: a profile is not work, so it is fetched as its own author-scoped filter rather than derived into a follow-up.

**Names are untrusted input.** A display name is remote-controlled text rendered in AtlasMind's UI, so it is secret-redacted, control-character-stripped, and length-clamped *on the way in* — never on the way out, where a single missed call site would be a hole. Malformed profile JSON yields no name rather than an error.

**Enough evidence to recognise a stranger.** A truncated hex key and "seen in 1 channel" cannot tell three unnamed identities apart, which makes the picker useless for exactly the people it exists to help you find — and most Buzz identities publish no profile at all. So each identity also carries how many messages it has sent, when it was last seen, and a short excerpt of its most recent message. The excerpt goes through the same sanitiser as every other remote-authored string here, and only the newest message wins, so an out-of-order replay after a reconnect cannot overwrite it with something older. It is a recognition aid, not a message store — `BuzzConversation` is that.

**Nothing is persisted.** A roster of who spoke and when is exactly what `project_memory/` must not accumulate, being git-tracked. The directory lives in memory for the session, on `BuzzInboundService`, and is rebuilt from the subscription.

`BuzzClient` gained two capabilities for this: an `onEvent` hook delivering every validated event before derivation (kept separate from `onWorkItems`, so widening what is *observed* can never widen what becomes a follow-up), and `updateFilters()`, which re-subscribes on the live connection. Profile lookups are debounced and author-capped, and re-issue the message filter alongside the profile filter so inbound work never stops. Re-subscribing on the existing socket reuses the completed NIP-42 handshake rather than authenticating a second time for a read the relay already trusts.

Your own identity is the one handle that needs no lookup: `deriveBuzzPublicKey` computes it from the agent key already in SecretStorage. It is read only when Buzz is enabled, only the public half is returned, and failure is silent so an unusable key can never surface inside an error message.

**Editing a binding by clicking.** `writeAgentBinding` is the pure add/replace/remove over the raw setting value, shared by every surface that edits one. It exists so a UI cannot invent its own merge rules: the same validation that guards a hand-edited setting guards a click. An empty agent id means *unbind* and is therefore not an error; a key that will not normalise is refused **with a reason** rather than coerced; every other binding is preserved untouched; and the value is written back in whichever shape the user already had, so a hand-authored record does not silently become an array.

Two surfaces call it. **Settings → Buzz** (the `buzz` page in `src/views/settingsPanel.ts`) lists the current bindings and any rejected ones, alongside every `atlasmind.buzz.*` switch grouped as Connection / Inbound / Persistence / Routing; because the gates are nested, a control whose parent switch is off renders dimmed and disabled while still showing its stored value — an inert setting is shown as inert, not as absent. **Project Dashboard → Director** offers the binding per person: the "Add / Edit person" form holds as many communication channels as someone has (`DirectorContact.links` was always a list; only the editor insisted on one), and reveals the AtlasMind agent checklist while any of them is `buzz` — scanned across every row rather than read off whichever happens to be first. Rows are added and removed in the DOM rather than by re-rendering, since a re-render would discard everything else typed into the form but not yet saved, which is precisely when someone is adding a second channel. The agent choices are sent from `agentChoices` in the snapshot so the client never guesses an agent id, and **every** chosen id is checked against the registry rather than only the first — a rename that broke the second of three would otherwise save silently and route nothing. `ProjectDashboardPanel.handleSetBuzzAgentBinding` additionally rejects an agent id with no matching agent, so a rename cannot leave a binding pointing at nothing. The binding posts as its own message rather than riding on `saveDirectorConfig`: it belongs in settings, not in git-tracked project memory, and a refused binding must not block saving the person.

**Lifecycle.** `sync()` reconciles the subscription with current settings — start, stop, or restart when the relay or channels change — and is re-run on any `atlasmind.buzz.*` configuration change. It holds `PresenceManager`'s `buzz` keep-awake reason only while a subscription is genuinely live, releasing on stop; the lock is itself deny-by-default, so holding a reason does nothing unless the user enabled `presence.keepAwake`. Derived follow-ups merge by deterministic id, so the reconnect replay overlap and repeat sightings update nothing rather than duplicating, and a batch cap keeps a busy channel from flooding memory.

### BuzzChannelCatalog (`src/core/buzzChannelCatalog.ts`)

Turning `buzz channels list` into a list a person can tick.

**Why it exists.** A channel id that does not match the channel you actually posted in is the most common reason a correctly configured Buzz subscription receives nothing — and it is undiagnosable from inside AtlasMind, because a wrong id, a wrong relay, and a quiet day all present identically as a connection that receives nothing. The only remedy used to be "go and copy the id out of the Buzz app". The CLI already knows the real ids, so `atlasmind.buzz.fetchChannels` asks it and offers the answer as a multi-select, pre-ticked with what is already watched.

**The field names are verified, not guessed.** `channels list --format compact` emits an array of `{ channel_id, name }` — read from the compact projection written out literally in `crates/buzz-cli/src/commands/channels.rs` at the pinned release, not inferred from a jq example. The parser still accepts `channelId`, `id`, and `uuid`, because tolerating a rename costs nothing while failing closed on one costs a user their channel list.

**The output is untrusted.** Channel names are written by whoever created the channel and are rendered in a picker; the id is written into a settings array AtlasMind later subscribes with. So parsing never throws (a response of an unexpected shape yields an empty catalog rather than an error), ids are constrained to a printable-safe identifier charset rather than accepted as arbitrary text — whitespace, control characters, and shell-shaped strings are refused — names are secret-redacted, control-stripped, and clamped, the list is capped and de-duplicated, and entries with no usable id are **counted rather than hidden**, because "6 of 8 channels" matters when the two that vanished may be the ones being looked for.

**The write is entirely the user's.** This is the one Buzz control that changes a setting, and it changes only the channel list — never a gate, never a key. The user presses the button, ticks the channels, and nothing is stored if the picker is dismissed. It runs under the same validated configuration as the outbound bridge: `loadBuzzCliBridgeConfig` normalises the relay URL and enforces remote consent, the key comes from SecretStorage as an environment variable, and the binary is executed directly rather than through a shell.

**An unlisted channel is kept.** `resolveWatchedChannels` stores exactly what was ticked, so unticking removes — but a watched id absent from the relay's listing is preserved. A channel the CLI could not see is far more likely a permissions or paging gap than a deliberate removal, and dropping it would unsubscribe someone from a channel they never touched.

The setup walkthrough points at the button from both the subscribe step and the "prove a message arrives" step, but **only when the CLI is actually on PATH** — naming a button that needs a binary you never installed is how a guide teaches people to distrust it.

### BuzzSigner (`src/core/buzzSigner.ts`)

BIP-340 Schnorr signing for NIP-42, filling the `BuzzEventSigner` seam. A real Buzz relay refuses to serve a subscription until the client authenticates (`auth-required: authenticate before subscribing`, observed against a live relay), so inbound sync cannot work without this.

**Bundled but lazily loaded.** `@noble/secp256k1` is a normal dependency — fixed at build time, covered by the lockfile's integrity hash, auditable in the repo — chosen over the full `@noble/curves` suite because it is **170 KB with zero transitive dependencies** versus 1.87 MB plus an 889 KB dependency, for the one curve Nostr uses. It is imported only the first time a signature is needed, so a user who never touches Buzz pays nothing at activation. Node's built-in `crypto` supplies SHA-256, so nothing else is pulled in.

**Module-format care.** The package is ESM-only, and `require()`-ing ESM throws on Node before 22.12 — which the VS Code extension host can be. A plain `await import()` would be downlevelled to `require()` by the CommonJS emit, so the import is constructed through `Function` to survive transpilation, with a `require` fallback for hosts that cannot resolve a bare specifier that way. The dependency's surface is declared as a local structural interface rather than a type import, which both avoids the ESM/CJS type friction and documents exactly how little of the library is used.

**Correctness and safety.** `parseBuzzSecretKey` accepts a bech32 `nsec…` or bare 64-char hex — the two forms Buzz documents — and **validates the bech32 checksum**, so a mistyped key fails loudly rather than silently authenticating as a different identity; an `npub` is rejected with that named explicitly, since it is the likely mistake. Key validation happens when the signer is *created*, not mid-handshake. Every signature is verified against the derived public key before the event is returned, so a miswired hash backend cannot emit a bad signature. Secret material never appears in a log, an error message, or a serialised value. The hand-written bech32 decoder and the library are cross-validated in tests against the **published NIP-19 nsec/npub vector pair**: decoding one and deriving the other must reproduce the spec's values.

**Scope.** It signs *authentication* events only. `BuzzClient` stays read-only — the sole event this produces is the ephemeral kind-22242 auth event, which relays never store.

**Still owed.** Validation against a real Buzz relay rather than a NIP-01-shaped stand-in, and the deny-by-default inbound toggle plus follow-up persistence.

### Agentic Resource Discovery (`src/ard/`)

[ARD](resource-discovery.md) is a discovery-only protocol layered in front of invocation. Three core services, plus a webview panel and a sidebar tree:

- **`ArdClient` (`src/ard/ardClient.ts`)** — the protocol client. `search()` issues `POST /search` to registry finders (following `referrals[]` up to `MAX_ARD_FEDERATION_DEPTH` with a loop guard) or fetches and locally ranks `manifest` finders; `fetchCatalog()` reads `/.well-known/ai-catalog.json` and expands nested catalogs. All responses pass strict validation (`urn:ai:` identifiers, value-or-reference exclusivity, byte/entry caps) and URL screening (HTTPS + private-host SSRF guard). Tunables are read fresh per call via an injected config getter.
- **`ArdRegistry` (`src/ard/ardRegistry.ts`)** — persists Agent Finders (key: `atlasmind.ardEndpoints` in `globalState`), seeded once from `DEFAULT_ARD_FINDERS` (all **disabled**), and caches recent results for the tree view. Mirrors `McpServerRegistry`'s persistence pattern.
- **`ArdInstaller` (`src/ard/ardInstaller.ts`)** — maps a discovered resource to a non-destructive action: MCP servers → `McpServerRegistry.addServer({ enabled: false })`; nested catalogs/registries → disabled finders; A2A/skill/API → reference only.
- **`buildAtlasMindCatalog` (`src/ard/ardCatalogExporter.ts`)** — the publisher; emits a spec-conformant `ai-catalog.json` of agents/skills/MCP servers with secrets, prompts, and env redacted.
- **`discover-resources` skill** (`src/skills/discoverResources.ts`) — read-only in-task discovery, registered via a factory closure over `ArdClient`/`ArdRegistry`.
- **UI** — the **Resource Discovery** tab in the Settings dashboard (the `discovery` page in `src/views/settingsPanel.ts`) and the `atlasmind.discoveryView` tree provider in `src/views/treeViews.ts`. The `AtlasMind: Resource Discovery` command opens the Settings panel on that tab.

The services are constructed in `activate()` and bundled into `AtlasMindContext` as `ardRegistry`, `ardClient`, `ardInstaller`, and `discoveryRefresh`.

## Data Flow

```
User message → Chat Participant → Orchestrator.processTask()
  → AgentRegistry.selectAgent()
  → MemoryManager.queryRelevant()
  → TaskProfiler.profileTask()
  → ModelRouter.selectModel()
  → SkillsRegistry.getSkillsForAgent()
  → execution boundary
      → ordinary function-calling provider: ProviderAdapter.complete(AtlasMind tool definitions)
      → eligible ACP with delegated execution enabled: ProviderAdapter.complete(no AtlasMind tool definitions)
          → ACP-native operation → AcpPermission → ToolApprovalManager
  → CostTracker.record()
  → TaskResult → Chat response stream
```

Project execution flow:

```
/project <goal> → Chat Participant → Orchestrator.processProject()
  → Planner.plan()          (reasoning LLM decomposes goal → ProjectPlan DAG)
  → normalize execution skills (ground non-synthesis tasks with enabled evidence tools)
  → onProgress({ type: 'planned' })
  → TaskScheduler.execute()
      for each dependency batch (in parallel):
        → Orchestrator.executeSubTask()
            → ephemeral AgentDefinition (from SubTask.role)
            → route to function-calling executor; hand off explicit tool-unavailable refusals
            → Orchestrator.processTaskWithAgent()
        → onProgress({ type: 'subtask-done' })
  → Orchestrator.synthesize()  (LLM assembles final report)
  → ProjectResult → streamed to chat
```

Bootstrap flow behavior:

```
/bootstrap or command -> bootstrapProject()
  -> run guided/skippable project intake
  -> reuse out-of-turn details from earlier answers so later prompts can be skipped
  -> create SSOT structure
  -> for an explicitly selected platform prefab, build a deterministic relative-path file plan
     -> sanitize display name, slug, namespace, and generated source independently
     -> write create-only; never run generator, install, Docker, or network commands
     -> WooCommerce: plugin shell + HPOS/dependency guards + CI + Not-assessed review records
     -> Magento: inert registered Composer module + syntax/contract CI + Not-assessed records
     -> BigCommerce/Wix: documentation-only official-generator handoff + explicit side-effect gates
     -> Next.js/React Router/Laravel/Django/Astro Content: documentation-only generator handoff
        + runtime, package, database/content, privacy, compatibility, and acceptance gates
     -> Static Website: dependency-free semantic HTML/CSS + CSP/accessibility contract + read-only CI
     -> Next.js/SvelteKit/Nuxt/React/Vue Frontend: documentation-only current-generator handoff
        + rendering, state, browser, accessibility, performance, privacy, and deployment gates
     -> React Native/Expo/Flutter Mobile: documentation-only current-generator handoff
        + native toolchain, permission, device, accessibility, privacy, signing, store, and update gates
  -> write project_soul.md + project brief + roadmap + intake log + repository plan
  -> seed project_memory/ideas/ with intake-aware ideation defaults
  -> seed project-scoped Personality Profile defaults when the intake provides stable project context
  -> update workspace routing and dependency-monitoring settings when answers map cleanly
  -> write GitHub-ready planning artifacts (.github issue template + project-planning seed)
  -> offer governance scaffolding
     (.github workflow/templates, CODEOWNERS, .vscode/extensions.json)
  -> preserve existing files (non-destructive)
```

Generator ownership is the architecture boundary, not a framework preference. A maintained upstream
generator can change its dependency graph, runtime template, lifecycle scripts, database defaults, or
instruction files faster than an AtlasMind release. Bootstrap therefore records the official command and
effects but does not execute it or copy its output. The application becomes AtlasMind’s project only after
generation into a separate directory and review. Static HTML/CSS is the deliberate exception: its complete
runtime surface is small enough to emit locally, escape deterministically, parse in tests, and verify without
a dependency install. The archetype bridge still collapses these labels into `website`, `web-app`, or
`mobile` plus
traits, so platform names do not multiply downstream routing vocabularies.

Frontend labels use the same archetype bridge instead of creating framework archetypes. Next.js,
SvelteKit, and Nuxt map to `web-app + has-ui + has-server`; client-focused React/Vite and Vue map to
`web-app + has-ui`. The framework catalog remains a separate build/deploy vocabulary: it now includes
React and Vue as manual-setup entries, because a safe constant must not answer Vue's interactive choices
or pretend React supplies routing/data conventions. Its SvelteKit command uses `sv create`; persisted
`remix` ids remain compatible while their displayed path continues to be React Router framework mode.

Mobile labels likewise map to `mobile + has-ui + ships-binaries`. Their generator plans remain inert
Markdown because package execution, native project creation, platform toolchains, cloud build/update
services, signing, device installation, and store submission all cross boundaries that bootstrap cannot
authorize. The React Native path records the framework-first recommendation; Expo uses no-install and
no-agent-instruction flags while leaving Continuous Native Generation and EAS separate; Flutter discloses
its dependency retrieval. Shared matrices start every permission, storage, telemetry, native-module,
device/OS, accessibility, signing, migration, release, and rollback claim as Not assessed.

Personality Profile flow behavior:

```
Command Palette or walkthrough -> openPersonalityProfile
  -> guided questionnaire webview
  -> each prompt offers quick-fill presets plus a freeform editable answer
  -> persist answers to workspace state
  -> inject the saved profile into Atlas task prompt assembly on every request
  -> update live AtlasMind settings (budget, speed, approvals, chat carry-forward)
  -> when SSOT is present, write profile artifacts into project_memory/agents/
  -> offer direct-edit links to the generated profile markdown and project_soul.md
  -> sync a summary block back into project_soul.md
```

## Security Boundaries

- Webviews are isolated behind a strict CSP and communicate only through validated message payloads.
- Provider credentials belong in VS Code SecretStorage and are not part of the SSOT or workspace configuration.
- Bootstrap operations are constrained to safe relative paths inside the current workspace.
- Website Studio persists only bounded, sanitized planning data and provider-prefixed secret references; it server-locks the Develop/Staging/Production access policies, validates loopback/HTTPS/review-subdomain readiness, redacts recognized secrets/n8n webhook URLs, and exposes no direct deploy or workflow-trigger message.
- Future orchestrator execution should preserve the same rule: validate inputs, redact secrets, and prefer explicit user confirmation for risky actions.

## Quality Gates

- Local quality loop: `npm run lint`, `npm run test`, `npm run compile`.
- CI pipeline (`.github/workflows/ci.yml`) enforces compile, lint, test, and coverage for pushes and pull requests to `main`.
- Ownership and review enforcement are defined in `.github/CODEOWNERS`.

## Dependency Graph

```
extension.ts
  ├── chat/participant.ts            (owns the one dispatch both chat surfaces use — slash and freeform)
  │     └── views/chatSlashRouting.ts  (what a leading `/` means, pure)
  ├── commands.ts
  │     ├── views/settingsPanel.ts
  │     ├── views/personalityProfilePanel.ts
  │     ├── views/modelProviderPanel.ts
  │     ├── views/toolWebhookPanel.ts
  │     ├── views/skillScannerPanel.ts
  │     ├── views/websiteStudioPanel.ts (+ views/websiteStudioStyles.ts, media/websiteStudio.js)
  │     │     ├── core/websiteWorkspaceManager.ts
  │     │     ├── core/uiDesignGraph.ts
  │     │     ├── core/uiEditCommands.ts
  │     │     ├── core/uiPreviewRuntime.ts
  │     │     ├── core/websiteWireframe.ts
  │     │     ├── core/websiteSitemap.ts
  │     │     ├── core/websiteLinkGraph.ts
  │     │     ├── core/websiteDesignPrompt.ts
  │     │     ├── core/websiteGeneration.ts
  │     │     ├── core/websiteFrameworks.ts
  │     │     ├── core/websiteStackSetup.ts (→ core/websiteCiTemplate.ts)
  │     │     ├── core/websiteDeliverySync.ts
  │     │     ├── core/websiteWireframePreview.ts
  │     │     ├── core/websiteContent.ts (→ core/websiteContentManager.ts)
  │     │     └── core/websiteReviewComments.ts (→ core/websiteReviewBundle.ts)
  │     ├── views/websiteReviewHost.ts
  │     ├── views/websiteStackSetupHost.ts
  │     ├── views/websitePreviewHost.ts
  │     │     ├── views/websitePreviewPanel.ts
  │     │     ├── core/websitePreviewServer.ts
  │     │     └── core/websiteGenerationRunner.ts
  │     ├── views/missionControlPanel.ts
  │     │     └── core/missionRunner.ts (→ core/goalEvaluator.ts, core/missionRegistry.ts)
  │     └── bootstrap/bootstrapper.ts
  ├── views/treeViews.ts
  ├── views/modelSidebarVisibility.ts (user-level Models tree filtering + exact-entry restore)
  └── core/orchestrator.ts
        ├── core/agentRegistry.ts
        ├── core/skillsRegistry.ts
        ├── core/modelRouter.ts
        ├── core/skillDrafting.ts
        ├── core/taskProfiler.ts
        ├── core/costTracker.ts
        ├── core/skillScanner.ts
        ├── core/scannerRulesManager.ts
        ├── core/planner.ts
        ├── core/taskScheduler.ts
        ├── core/toolWebhookDispatcher.ts
        ├── memory/memoryManager.ts
        │     └── memory/memoryScanner.ts
        ├── mcp/mcpServerRegistry.ts
        │     ├── mcp/mcpClient.ts
        │     ├── mcp/mcpRuntime.ts
        │     └── mcp/mcpEnvironmentScanner.ts
        ├── mcp/buzzCommsServer.ts
        │     └── mcp/buzzCliBridge.ts
        ├── skills/index.ts
        │     ├── skills/dockerCli.ts
        │     ├── skills/gitApplyPatch.ts
        │     ├── skills/gitSync.ts        (git-fetch + git-pull)
        │     ├── skills/gitWorktree.ts
        │     ├── skills/gitStash.ts
        │     └── skills/gitMerge.ts
        └── providers/index.ts
              ├── providers/anthropic.ts
              ├── providers/copilot.ts
              ├── providers/acp.ts
              │     ├── providers/acpProtocol.ts     (wire framing, pure)
              │     ├── providers/acpLaunch.ts       (command → spawnable invocation, pure)
              │     ├── providers/acpWindowsLauncher.ts (private-desktop selection + binary integrity)
              │     ├── providers/acpPermission.ts   (authorization policy, pure)
              │     ├── providers/acpInstaller.ts    (install planning, pure)
              │     ├── providers/acpEffort.ts       (effort tiers + settable-config allowlist, pure)
              │     ├── providers/acpHostPolicy.ts   (long-lived host: reuse, auth, lifetime; pure)
              │     └── providers/acpModels.ts       (detected model list + declared standing, pure)
              ├── providers/modelRole.ts             (what a model is for; non-chat exclusion, pure)
              ├── providers/gpuProbe.ts              (GPU probe chain, injected execFile)
              │     └── providers/gpuProbeParse.ts   (probe output parsers, pure)
              ├── providers/localFootprint.ts        (VRAM footprint estimation, pure)
              ├── providers/localRuntimeClient.ts    (Ollama/LM Studio residency + unload)
              └── providers/localModelRecommendationRegistry.ts

native/acp-private-desktop/
  └── src/main.rs                    (Windows private-desktop process helper)

tests/core/
  ├── modelRouter.test.ts
  ├── costTracker.test.ts
  ├── websiteWorkspaceManager.test.ts
  ├── uiDesignGraph.test.ts
  ├── uiEditCommands.test.ts
  ├── uiPreviewRuntime.test.ts
  ├── websiteWireframe.test.ts
  ├── websiteSitemap.test.ts
  ├── websiteLinkGraph.test.ts
  ├── websiteDesignPrompt.test.ts
  ├── websiteGeneration.test.ts
  ├── websiteGenerationRunner.test.ts
  ├── websitePreviewServer.test.ts
  ├── websiteFrameworks.test.ts
  ├── websiteCiTemplate.test.ts
  ├── websiteStackSetup.test.ts
  ├── websiteDeliverySync.test.ts
  ├── websiteWireframePreview.test.ts
  ├── websiteContent.test.ts
  ├── websiteReview.test.ts
  ├── skillDrafting.test.ts
  └── planner.scheduler.test.ts
tests/memory/
  ├── memoryManager.test.ts
  └── memoryScanner.test.ts
tests/mcp/
  ├── mcpClient.test.ts
  └── mcpServerRegistry.test.ts
tests/skills/
  └── gitApplyPatch.test.ts
```

## Key Interfaces

All shared types live in `src/types.ts`. See the [type definitions](../src/types.ts) for the full source.

| Interface | Purpose |
|---|---|
| `AgentDefinition` | Agent identity, role, system prompt, allowed models, cost limit, skills, and optional completion rubric/incomplete-response gates |
| `SkillDefinition` | Skill identity, JSON Schema for tool params, handler path |
| `ModelInfo` | Model identity, provider, pricing, context window, capabilities, optional delegated-native-tool execution shape, reasoning depth, latency class, and prompt-cache support (`supportsPromptCaching`, `cachedInputPricePer1k`) |
| `ProviderConfig` | Provider identity, API key setting key, enabled flag, model list |
| `RoutingConstraints` | Budget mode, speed mode, max cost, preferred provider, preferred model (role pin), parallel slots, cacheable-prefix ratio, and the live delegated-tool authority required before that execution shape can satisfy `function_calling` |
| `TaskProfile` | Inferred task phase, modality, reasoning intensity, and capability preferences |
| `ModelStruggleKind` | A way a model under-performed on a turn: `timeout`, `empty`, `tool-call-as-text`, `error-finish`, `user-correction` |
| `ModelStruggleState` | Persistent decaying de-weight for a model on a task signature: `penalty`, `lastUpdated`, `hits`, `lastKind` |
| `SubTask` | Unit of work in a project plan: id, title, role, skills, `dependsOn` edges |
| `SubTaskResult` | Execution outcome: `status` (`completed` / `failed` / `needs-input`), output, costUsd, durationMs, error, and (when capped) `iterationLimitHit` + suggested raised limits |
| `ProjectPlan` | Decomposed goal: id, goal, `subTasks[]` DAG |
| `ProjectResult` | Full execution outcome: subtask results, synthesis, totals |
| `ProjectProgressUpdate` | Discriminated progress event: `planned \| subtask-start \| subtask-done \| synthesizing \| error` |
| `TaskRequest` | User message, context, constraints, timestamp |
| `TaskResult` | Agent ID, model used, response, cost, duration |
| `CostRecord` | Per-request token counts and cost |
| `MemoryEntry` | Path, title, tags, last modified, snippet |
| `McpServerConfig` | MCP server id, name, transport (stdio/http), command/args/env or url, enabled, `secretEnvKeys` (env var names whose values live in SecretStorage) |
| `McpConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` |
| `McpToolInfo` | Server id, tool name, description, input JSON Schema |
| `McpServerState` | Live snapshot: config + status + error + discovered tools |
| `PromotionPlan` | Assembled promotion: ordered guarded steps, preflight `checks`, blockers, gate flags, and an optional `remediation` |
| `PromotionRemediation` | "Resolve & run" offer for fixable failing checks: `resolves`, assessed `targetVersion`/`bumpLevel`/`bumpReason`, `editsChangelog`, `commits`, `summary` |

## Detailed Architecture Subdocs

| Document | Description |
|---|---|
| `architecture/boundaries-and-seams.md` | Explicit review of all integration seams — contracts, protocols, and security rules for each crossing |
| `architecture/runtime-and-surfaces.md` | Runtime environment and UI surface overview |
| `docs/architecture/orchestrator-flow.md` | `processTaskWithAgent` and `runAgenticLoop` internal flow with Mermaid diagrams |

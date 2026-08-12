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

Explicit user constraints also become a `TurnCapabilityEnvelope`. “Read-only”, “do not edit”, and “do not run commands” filter skill definitions before routing/prompt construction and are checked again immediately before execution. Restricted turns cannot use delegated ACP native tools because AtlasMind cannot impose its per-turn schema ceiling inside that external agent.

`AgentDefinition.skillPolicy` separates eligibility semantics from the skill IDs themselves. `task-scoped` is the safe default; an empty list admits built-ins only and custom/MCP skills must be named. `allowlist` preserves an exact enabled set, while `all` is the sole deliberate every-skill mode. The selector consumes explicit IDs, request intent, declared delivery vocabulary, and bounded session follow-through context, but it can only narrow the registry result and capability envelope. The selected schemas are the single model-facing capability description. Their serialized size participates in initial cost estimates, memory/session allocation, and every loop's completion headroom.

**The per-turn schema ceiling applies to every policy.** `MAX_TASK_SCOPED_SKILLS` (12) bounds `task-scoped` selection; `MAX_TURN_TOOL_SCHEMAS` (24) bounds the result of *any* policy. Previously only the first existed, so an `allowlist` agent sent its whole list and an `all` agent sent every enabled skill — including every connected MCP tool — on every query regardless of the question. That conflated authorization ("which skills may this agent use") with selection ("which schemas are worth this turn's context"). The second ceiling is an overflow guard rather than a selection policy: a pool at or under it is returned untouched, so a hand-written allowlist is unchanged; above it, skills are ranked by intent and unscored ones keep declared order rather than being sorted by id. A cap that bites is stated in the progress line — a silent truncation reads as "this is everything the agent has", which is the wrong thing to believe when the dropped tool was the one the model needed.

**Delivery intent is read from the project, not from a keyword table.** `selectTaskScopedSkills()` accepts a `ProjectVocabularySource` (see below). A promotion requires both a promotion verb and a declared stage, and selects the Git write set plus the tools a declared promotion sequence needs. Git integration flows (merge, rebase, cherry-pick, promotion) select the write tools as a **set** rather than per word, because "merge to main then publish" contains neither `commit` nor `push` and previously received only the read half of the Git group; `commit` and `push` keep their own per-word rules so a question about a commit does not hand over the ability to publish one.

**An escalating turn widens its tool set once.** A thin answer is frequently a model that was never given the tool it needed, which re-routing to a stronger model does not fix, so the escalated attempt re-selects within the same authorization ceiling up to `MAX_WIDENED_TASK_SCOPED_SKILLS` (18). Widening cannot exceed the eligibility pool, so it never grants a skill the agent does not already hold.

The operating contract and rubric are injected in `buildMessages()` rather than copied into built-in definitions. This closes prompt drift across hand-written specialists, custom agents, ephemeral project agents, synthesized agents, and persisted prompt overrides. Built-in role prompts therefore contain only specialist scope and boundaries; all 16 user-facing specialists add concise observable criteria through `completionCriteria.rubric`. Detailed SEO and UX checklists are progressively disclosed by `src/skills/specialistGuidance.ts` only when relevant, keeping volatile platform and standards details out of permanent prompts. `completionCriteria.incompletePatterns` is evaluated inside the agentic loop using a bounded restricted-regex policy before the existing one-time completion-integrity reprompt. Execution artifacts record failed tool-call count alongside tool count, verification, and TDD status so the router's outcome signal reflects observable delivery rather than only the provider finish reason. The agentic loop also recognizes explicit runtime claims that workspace tools are disabled or unavailable: instead of spending the remaining iterations re-prompting the same bridge, it marks that model's runtime capability as failed and immediately asks the provider-failover path for another `function_calling` model. If no recovery succeeds, the project classifier records the refusal as failed, never completed.

When the loop settles and *every* tool result in the final round tests as failed, the model's completion is discarded and replaced by a summary of those failures, with `finishReason: 'error'`. That verdict comes from `looksLikeToolFailure`, which matches substrings — `failed`, `cannot`, `not found` — against **raw** tool output; since `file-read` returns file contents verbatim, a read of an ordinary source file can satisfy it, and with a single tool call in the round the `every()` check is then trivially true. The substitution is therefore instrumented: each occurrence logs the tools involved and which predicate fired, distinguishing a tool that declared its own failure (an `Error:` prefix) from a bare substring or keyword match on its output. Trigger tokens only are recorded, never tool output, which can carry secrets. The log is diagnostic — nothing branches on it — and exists so the false-positive rate can be measured before the predicate is narrowed.

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

Enforcement lives in the `Orchestrator`: `applyDataPrivacyGate()` classifies the assembled context before model selection; `buildMessages()` applies `privacyRedact()` to memory, live evidence, and supplemental context keyed on the actually-selected model (the fail-safe for pins/parallel overflow); and `redactToolResultForModel()` withholds `file-read` results for classified paths when the running model is un-trusted. When classified content is found but no trusted model is available, the content is redacted and the UI is notified via `OrchestratorHooks.onClassifiedContentForUntrustedModel`.

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
  source-root, component-location, and handoff hints (data only, never commands);
- the fixed Develop → Staging → Production hosting environments, including URL/branch references, locked access policy, secret reference, and promotion-protection metadata;
- a catalog of static, managed-CMS, commerce, and custom platform targets;
- n8n workflow maps containing event/outcome/status plus non-secret references.

`sanitizeWebsiteWorkspace()` is the untrusted-input boundary for both webview edits and imported client JSON. It caps text/list/page/workflow sizes, normalizes and deduplicates IDs, allow-lists statuses, platform IDs, HTTP(S) URLs, and six-digit hex colors, removes URL credentials/query/fragment values, enforces at most one primary platform, applies the shared secret redactor, and replaces n8n webhook-shaped URLs with a marker before disk persistence. It also rebuilds the three hosting environments from canonical server-side policy: Develop is loopback/local unless the explicit hosted fallback is selected (then password-protected), Staging is always hosted and password-protected, and Production is always hosted, public, and promotion-protected. Credential references require an explicit secret-provider prefix, so a raw password-like string does not survive sanitation. Both rendered SSOT files then pass `scanMemoryEntry`; error-level prompt-injection content aborts the write before either file is created. The schema intentionally has no API-key, password, bearer-token, or webhook-value field.

`assessWebsiteHostingEnvironments()` is a non-executing readiness evaluator. It requires HTTPS for hosted environments, restricts local Develop to loopback hosts, requires password references for hosted Develop and Staging, and verifies Staging's exact `<review-label>.<production-domain>` topology. It reports missing setup separately from blocking policy violations; it never deploys.

Guided bootstrap exposes **Website / Marketing Site**. `seedWebsiteWorkspace()` carries the captured project name, summary, audience, outcome, constraints, metrics, timing, budget, and inferred platform into the Studio, but refuses to overwrite an existing website plan. The same Studio can import a bounded JSON brief and normalize common form/CRM aliases.

The SSOT is at **format version 11**, registered in `schemaMigration.ts` as the `website` kind. `load()` routes through `interpretVersionedDocument`, so a file written by a newer AtlasMind is refused rather than replaced — the Studio opens read-only and says why. The 4 → 5 step marks existing projects as websites (the only surface v4 could represent) and seeds empty content-design and implementation-guidance records without inventing either. The 5 → 6 step transcribes every wireframe fact into the design graph, including untouched-versus-empty canvas state, without inventing viewport overrides, references, components, or states. The 6 → 7 step adds an empty typed-token collection without changing a graph fact or inferring a design system. The 7 → 8 step likewise adds only an empty component collection; it has no standing to infer definitions or instances. The 8 → 9 step changes only the version because optional node state copy must remain absent until authored. The 9 → 10 step adds an empty sample-data collection authority and invents no schema, record, value, or binding. The 10 → 11 step adds an empty asset library and does not inspect files, infer node assignments, or invent alt text. While existing readers migrate, `uiDesignGraph.ts` deterministically rebuilds their page wireframes from the graph.

`src/views/websiteStudioPanel.ts` is a profile-aware webview (Brief, Sitemap or Screens & Flows,
Content Design, UI System, Wireframe canvas, Full Preview, Implementation/website hosting, and
website-only n8n Automations). Its CSS lives in `websiteStudioStyles.ts` and its behaviour in
`media/websiteStudio.js`. Content messages carry a bounded screen id and text fields; the host resolves
the id against the current plan and `WebsiteContentManager` owns the path. The expected body implements
optimistic concurrency, so a disk edit is refused rather than overwritten. Other messages remain
data-only and cannot name a command, arbitrary path, or output file. Production publishing stays in
`PromotionRunner`; n8n triggering remains outside this planning surface.

### Website Studio design and generation modules

Nine pure modules sit behind the Studio, each `vscode`-free and unit-tested:

- **`uiDesignGraph.ts`** — sanitizes the target-independent v11 graph against the page inventory, preserves
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

- **`websiteFrameworks.ts`** — the framework catalog. Ten entries, each carrying the scaffold command, the dev/build commands and the output directory. **Every command is a module constant** — never composed, never parsed from documentation, never model-generated, for the reason `acpInstaller.ts` states: that is RCE with extra steps. `custom`, `static` and `wordpress-theme` carry no scaffold command by design. `describeStackCompatibility` grades every framework/platform pairing with a reason, and an `unsupported` pairing stays visible rather than being filtered out of the picker.
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

### TestingScaffolder (`src/core/testingScaffolder.ts`)

Constructs a language- and archetype-aware starter testing framework from the enabled methodologies. `scaffoldTestingFramework(workspaceRoot, config)` detects the project **language** — Node (JS/TS), Python, Rust, Go, .NET, or Java — from manifest fingerprints (`package.json`, `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`, `Cargo.toml`, `go.mod`, `*.csproj`/`*.sln`, `pom.xml`/`build.gradle`) and a coarse **archetype** (web / api / cli / game / mobile / library / generic), then generates idiomatic starter files per enabled methodology: Vitest/Jest/Playwright/Cypress/fast-check/k6 (Node, with e2e branching on archetype), pytest/Hypothesis/Locust (Python), `cargo test`/proptest/criterion (Rust), `go test`/`testing/quick`/benchmarks (Go), xUnit (.NET), JUnit 5 (Java). It also writes a managed `project_memory/operations/testing-strategy.md` playbook with language-specific set-up hints. Unknown stacks degrade to playbook-only guidance. Strictly non-destructive: starter files are created only when absent and never overwritten, no manifest is ever mutated, and the only file always (re)written is the managed playbook.

For an already configured Node project, the scaffold may also nominate one **first-test candidate** — a bounded scan only considers a small source module with a named export when an installed Vitest or Jest runner is already evident. A nomination is not proof that the module is testable and it never writes a test itself. After the user confirms the scaffold, Settings synchronises the enabled protocol blocks into existing AI instruction files, then uses the normal Orchestrator/approval path to ask an agent to inspect and author exactly one focused test. The authoring prompt prohibits dependency, manifest, and production-source changes and explicitly permits the agent to make no change when no stable behaviour can be established; missing runner or candidate means no authoring task is started.

### SchemaMigration (`src/core/schemaMigration.ts`)

How a persisted AtlasMind document changes shape over time — the mechanism that makes 1.0's compatibility promise keepable. Every document in `project_memory/` carries a `version`, but until now that field was only ever a **validity test** (`version === 1` or the file was treated as unreadable), with two consequences that only bite later: a format could not change except as a break, and **a document from the future was destroyed silently**. An unreadable file made the manager seed a default *and write it back*, so opening a project in an older AtlasMind than the one that wrote it replaced the documents registry, delivery pipeline, or people roster with an empty one — with nothing to warn you, because from the reader's point of view there was simply no valid file.

The load-bearing distinction is between **invalid** (corrupt, truncated, not ours — safe to replace) and **refused** (structurally fine but written by a newer AtlasMind — *never* safe to replace). `interpretVersionedDocument` owns that decision for every manager rather than leaving nine readers to re-derive it, `shouldPreserveExisting` expresses the rule once, and `DocumentsManager`, `ProjectDirectorManager`, `RiskOversightManager` and `SecurityReviewManager` all skip their seed-and-persist path on a refusal, surfacing the reason through `getNotice()`. An **explicit** save still writes — the user is editing on purpose, and refusing their own edit would be its own data loss — which is why the notice is rendered on the page rather than kept internal.

`applyMigrationLadder` walks a document up one version at a time: it starts from the version found rather than the beginning, stamps the resulting version even when a step forgets to, and reports a throwing step rather than leaving a half-applied chain. It takes its bounds as arguments specifically so it can be tested while every kind still sits at v1 — otherwise the code that runs at the first real format change would ship unexercised. `SCHEMA_MIGRATIONS` is deliberately empty today, and a test asserts each kind's version matches its migration count, so bumping a version without writing the migration fails the build.

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

**Detection suggests; declaration decides.** Inference from manifests is always a suggestion — the declared value is the truth, mirroring "profiles seed, they do not govern". `detectProjectArchetype` returns `confident: false` when nothing matched, so "this is a generic project" and "we could not tell" stay distinct facts; and `describeArchetypeAgreement` reports a disagreement rather than silently preferring one side, because a project deliberately declared `library` while its manifests look like `web-app` is a decision.

Detection rules are ordered most-specific-first (React Native contains React) and short Node package names are gated to Node projects, because `next` matches inside `cargo-nextest`. The forward-mapping functions retire the other two vocabularies; `delivery.json` never persisted an archetype, so no schema migration was needed.

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

**An empty `command` is the blocker, not an oversight.** A stage that needs a user-authored command ships with `''`, and that emptiness is what holds the gate shut until a human supplies a real one — the `deliveryManager` precedent, for the same reason: a command that silently did nothing would let a stage report success having run nothing at all. `undefined` and `''` are therefore kept apart at every layer, because absent means "needs no command" and empty means "needs one and has none", and collapsing them either turns a deliberate blocker into an oversight or — worse — opens a gate. `stageBlockers` folds the derived blocker in with the declared ones so every surface asking "what is stopping this?" gets one answer.

**The label taxonomy is categorised, not flat.** A drafter picking labels needs one *type* and one *priority*, not an arbitrary subset; a flat list makes "drawn only from the declared taxonomy" satisfiable by three conflicting priorities. Observed repository labels seed `type` only, because sorting somebody's labels into priority, status and area would be guessing at what they mean. `priority` and `status` seed empty — plenty of projects run without either, and inventing a scheme teaches a vocabulary nobody picked.

**`testing: { inherit: true }` is single-valued on purpose.** It exists to *say* that testing requirements live in `testing-config.json` and are deliberately not duplicated, so a reader finding no testing rules here knows that is the design rather than an omission. Per-stage exceptions go in `stages[].testingOverrides`.

**`validateWorkflowConfig` is separate from sanitizing**, because they answer different questions: sanitizing asks "is this file usable", validation asks "does everything it names exist" — which needs knowledge a pure reader does not have, so the known agent ids are passed in. An unresolvable owner is **reported, never dropped**: a silently ownerless stage reads as one nobody was ever assigned, rather than one whose assignee has gone.

The manager mirrors `documentsManager` including the asymmetry that matters — seeding never writes over a newer-format file, an explicit save does — with one deliberate difference: **it is never seeded on render.** Every other persisted document creates itself on first read. This one gets committed, so writing one into somebody's repository because they opened a tab would be putting words in their mouth in a file other people review.

Building this closed a gap that could not be closed: `workflowConfigPresent` had been hardcoded `false` since the curriculum shipped, so "declare your workflow" was a step nobody could ever complete. `integrationBranch` and `protectedBranches` were likewise hardcoded to this repository's own branch names, teaching every other project a workflow naming branches it does not have.

### TestingReconciliation (`src/core/testingReconciliation.ts`)

What the declared testing policy says, next to what the repository shows, and what to do about each disagreement. A testing matrix drifts in one direction: enabling a methodology takes a click, and noticing months later that it never produced anything takes somebody deliberately looking. This repository enabled fourteen in a single auto-assess pass and eight still had no evidence of any kind seven weeks later. The coverage board reported those gaps accurately the whole time; what was missing was a way to act on them without hand-editing a tracked JSON file.

Four rules, each closing a way this could mislead. **Dropping is a first-class outcome, not a failure** — a methodology declared in June that the project has since decided against is a stale declaration, and presenting every gap as "write these tests" would make withdrawing one feel like giving up; a policy nobody can withdraw from is a policy people stop reading. **`commit` is a real answer with a real cost**: a methodology whose tooling is installed is kept, because somebody started, and the proposal says out loud that it stays a visible gap rather than filing it under "accepted". **Practices are never proposed for anything**, since they leave no artifact and there is therefore no evidence to be missing — proposing to drop Exploratory Testing because no file mentions it would be the tool misreading its own data. And **nothing is decided here**: the derivation returns a proposal, the caller confirms it, and `applyTestingReconciliation` is a separate call, because the outcome rewrites a git-tracked file that governs how every agent in the project behaves.

Applying changes only *whether* a methodology is declared. The assigned agent, model override, notes and `blocking` flag all survive a drop, so re-enabling later restores what was there rather than a blank row. The confirmation renders `describeTestingReconciliation` in a `{modal:true}` dialog — the exact lines, because approving "reconcile the testing policy?" with a count would be approving a rewrite without seeing what it says. Adoption is derived by the caller rather than from the coverage rows, which only cover *enabled* methodologies: a project quietly practising something it never declared is invisible otherwise, and `integration` on this repository was exactly that — switched off while its tests sat in the tree and ran on every commit. Pure + unit-tested.

### ReleasePreparation (`src/core/releasePreparation.ts`)

Stage 6, and the only stage of this workflow describing an action that cannot be undone. Every property here follows from that.

The hard parts already existed and were already pure — `classifyBumpLevel`, `bumpVersion`, `setPackageJsonVersion`, `insertChangelogEntry` and `compareSemver` have shipped in `promotionRunner.ts` since long before this workflow did. What was missing was a *path*: something that puts them in order, checks the preconditions, and says plainly what is not ready. This module borrows all five rather than growing a second copy, which is the same rule that keeps `pullRequestDraft`'s title in agreement with the version bump.

**Release notes are the changelog section, verbatim.** `extractChangelogSection` copies bytes; it does not summarise, rewrite or generate. A release note is a permanent public record somebody is accountable for, and a generated one is a claim nobody checked attached to a version nobody can change. Truncation is marked in the published text itself rather than silently applied.

**A secret in the notes refuses the release rather than being redacted out of it.** This inverts the boundary rule used everywhere else in AtlasMind, deliberately. Untrusted *inbound* text is redacted and passed on because the alternative loses information; these notes are *outbound and permanent*, so quietly redacting them would mean publishing something other than what the author reviewed, with no way for them to find out. The same reasoning `buzzSendPolicy` applies to an outbound message applies with more force to a release that cannot be recalled.

**`unknown` is not a pass.** The gates are `pass` / `fail` / `unknown`, and the third is a first-class outcome: a repository where `gh` could not be reached genuinely has no answer about whether its version is ahead of the last published one, and shipping on an unknown is the habit this stage exists to break. Gates run in order — changelog entry, notes content, notes clean, version ahead, tag free, clean tree, CI green, declared testing policy met — so the first failure a user reads is the one closest to the root cause. The **testing gate** is last because by release time an unevidenced methodology has been unevidenced for weeks, and this is a backstop rather than the main defence: a failing test fails it, an enabled methodology with no evidence fails it (the project set the standard and is about to ship without meeting it), and coverage that was never gathered reports `unknown`. So does a project with no methodology enabled at all — nothing to check against is not the same as checking and finding nothing wrong. It is fed from the same `TestingPolicyCoverage` the Testing page renders, so the two surfaces cannot disagree about a number. Being told CI is red is unhelpful when the real problem is that no changelog entry exists.

The tag gate is what catches a double publish: an existing tag means the publish workflow already fired for this version, which is the failure this repository documented in 0.181.0 and fixed in 0.184.0. Its fix hint says never to delete or move a published tag, because anyone who already fetched it keeps the old contents under the new name and never finds out.

**Nothing here executes anything.** `buildReleasePlan` is pure over observed state, and tagging and publishing stay with the human at every automation rung.

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

**Never empty, and a guess is not presented as a declaration.** A project with no pipeline configured falls back to the original git-derived pair so the header keeps working before anyone opens the Delivery page — but the strip reports `source: 'branches'` for that case, because the production branch there is found by heuristic and should not wear the same shape as a stage somebody declared.

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

**AtlasMind holds no credential.** It shells to an already-authenticated `gh`, so the user's GitHub authorisation is managed by GitHub's own tooling, lives in the OS keychain, and is revocable there. There is no token setting and adding one would move a secret AtlasMind does not need into a place it does not belong.

**A failure names its fix.** `classifyGhFailure` distinguishes not-installed, not-authenticated, rate-limited, forbidden, not-found and timeout, each with the command that resolves it — ordered most-specific first, because a rate-limit message mentions tokens and sending somebody to re-authenticate when they are merely throttled wastes their time. Every method returns a result rather than throwing: a dashboard that throws on a network failure disappears exactly when you wanted it to say what was wrong. The process runner is injected, so the module is unit-tested without a `gh` binary.

### RoadmapGates (`src/core/roadmapGates.ts`)

The release milestones a roadmap item can be tagged for. The Roadmap page only ever knew one — `#mvp` — which is the right first gate and the wrong only gate: a project that has shipped its MVP still needs to say "this belongs to the public beta" or "this is v2", and had nowhere to record it. `mvp` stays built in (always present, never removable, still the gate that feeds the Operational Score), and up to `MAX_ROADMAP_GATES` (12) further gates can be declared.

**Gates live in the roadmap file.** A managed `<!-- atlasmind:roadmap-gates:start/end -->` block in `improvement-plan.md` holds them as readable markdown (`` - `#beta` — Public beta ``), inserted after the backlog block: one SSOT document, diffable and reviewable, with no second source of truth to drift. `parseRoadmapGates` / `renderRoadmapGatesBlock` / `upsertRoadmapGatesBlock` are the round trip, and `stripRoadmapGatesBlock` removes the block before item parsing so its list lines can never be read as backlog items.

**A tag is a gate only when it has been declared.** `extractItemGates` recognises only declared ids, so an item reading `fix the #2 case` keeps its wording rather than inventing a gate called "2", and a tag-boundary check stops `#v1` matching inside `#v10`. Ids go through `slugifyGateId` (lowercase alphanumerics, dots, dashes; length-capped; must start alphanumeric) and unusable input is **refused with a reason** rather than coerced — the id becomes a `#tag` in a tracked file, so a value that would not parse back must never be written. Gate creation collects its name through a native input box (validated where the write happens); gate removal is modally confirmed, strips the tag from every item, and **never deletes backlog work**.

The panel computes one route per gate up front (`buildGateRoutes`) so switching gates in the UI is instant and cannot fail on a message round trip. The heuristic "suggested foundations" fallback remains **MVP-only**: recognising foundational work is not a claim about which release something belongs to, so a user-created gate with nothing tagged is reported as empty rather than filled with a guess.

### TestingPolicyCoverage (`src/core/testingPolicyCoverage.ts`)

Answers, for every *enabled* testing policy, the question the Testing dashboard could not previously answer: **is anything actually testing it, and is any of it failing?** Pure and `vscode`-free — the caller (`collectTestingDashboardSnapshot`) gathers the evidence (test-file list with case/skip counts, dependency and script names, probed config paths, a discovered report) and `deriveTestingPolicyCoverage` derives the readout, so the whole derivation is unit-tested.

Each policy has a **marker set** (file-path patterns, dependency names, script-name patterns, config paths) chosen to be something the tooling itself creates — a `.feature` file, a `stryker.conf`, a `__snapshots__` directory — never a word that might appear in a filename, because a false "covered" is the one outcome the panel must not produce. That yields four statuses: `covered` (matching test files exist), `tooling-only` (its tooling is installed but nothing tests with it), `missing` (enabled with nothing to show), and `not-file-evident` for the policies that are a *practice* rather than an artifact (exploratory, black-box, gray-box, V-model, white-box, test-design, agile testing) — those are **never** reported as a gap, since flagging a practice trains people to ignore the panel.

**Failures come only from a report the project produced.** `parseJUnitReport` reads the JUnit XML interchange format every mainstream runner can emit (vitest/jest reporters, pytest `--junitxml`, Playwright, surefire, gotestsum, dotnet). Nothing here ever runs a test command — a dashboard that shells out on render is both a surprise and an execution surface — so when no report exists the page says it has *no verdict* and quotes the command that would create one, rather than rendering "0 failures". The report is untrusted input: the parser never throws, resolves no entities beyond the five predefined ones and no external DTDs (attributes are read by regex, not an XML parser), caps how much it reads and how many cases it keeps, clamps and control-strips every string, and prefers the failures it can *count* over the totals the report *asserts* so a hand-edited report cannot present itself as clean. **Failure messages are deliberately never extracted** — an assertion message can carry values from a test environment and this data is rendered in a webview; the test name, suite, and file are enough to open it. Report staleness (a test file changed after the report was written) is surfaced rather than hidden, and skipped-test counts are derived locally from the test files themselves, so that signal exists even with no report at all.

**The explainer is also derived, never routed.** `buildTestingPolicyLaymanGuide` is total over the 23-methodology id union and declares the beginner-facing meaning and expected result of every policy; requirements, use case, and trade-off come from the same catalogue and marker rules that produce the status. The Dashboard host combines that guide with the freshly rebuilt `TestingPolicyRow`, explains why the status follows and what it cannot prove, then opens Chat with a one-shot `ChatPanelDirectResponse`. The response is consumed before any asynchronous work and bypasses `Orchestrator.processTask`, so a deterministic explanation cannot fan out through provider recovery. Chat normalizes, bounds, and secret-redacts the host-authored Markdown/metadata, accepts only an `atlasmind/*` source id, and renders bounded follow-up prompts as quick-reply chips; those chips cannot name commands.

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
  -> write project_soul.md + project brief + roadmap + intake log + repository plan
  -> seed project_memory/ideas/ with intake-aware ideation defaults
  -> seed project-scoped Personality Profile defaults when the intake provides stable project context
  -> update workspace routing and dependency-monitoring settings when answers map cleanly
  -> write GitHub-ready planning artifacts (.github issue template + project-planning seed)
  -> offer governance scaffolding
     (.github workflow/templates, CODEOWNERS, .vscode/extensions.json)
  -> preserve existing files (non-destructive)
```

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
  ├── chat/participant.ts            (owns the one slash dispatch both chat surfaces use)
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
        │     └── skills/gitApplyPatch.ts
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

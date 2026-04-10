# Changelog

All notable changes to AtlasMind will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.46.9] - 2026-04-10

### Changed
- Project Ideation now sends focused cards straight into Project Run Center as seeded run previews instead of only drafting a chat prompt, and the ideation inspector now exposes that execution handoff more explicitly.
- Project Run history now stores ideation-origin metadata so runs launched from the ideation board keep a durable link back to their originating card and board context.
- Completed or failed Project Runs can now feed learned output back into the originating ideation thread or spin up a new ideation thread directly from the Run Center.

## [0.46.8] - 2026-04-10

### Changed
- Project Ideation now scaffolds likely board facets directly from the prompt before the model responds, including external references, current-system context, code considerations, workflow impact, and team or process implications when those dimensions are implied.
- Project Ideation facilitation passes can now suggest explicit card updates, relationship rewiring, and stale-card archiving so repeated prompts evolve the active board instead of only appending new cards.
- Project Ideation's composer now shows a live prompt-inference preview so operators can see which datapoints Atlas is likely to inject or reorganize before running the next loop.

## [0.46.7] - 2026-04-10

### Fixed
- Project Run Center runs now create and reopen dedicated chat sessions, mirror the live run log as an internal-monologue transcript, persist the final synthesized output directly on the run record, and carry that synthesis into staged follow-up planner jobs when continuation mode is enabled.
- Project Run Center UX now surfaces autonomous-mode controls as durable run options, adds searchable compact recent-run rows, emphasizes the final run output ahead of changed files and artifacts, and moves the large draft-planning surfaces into collapsible review panels with a more active execution state.

## [0.46.6] - 2026-04-09

### Fixed
- Freeform chat now recognizes requests for the currently connected LLM providers and models as a live runtime inventory query and answers from AtlasMind's routed provider/model state instead of falling back to a generic architecture review.
- Security analysis routing now uses the built-in `security-reviewer` agent for freeform security gap analysis, threat-model, and runtime-boundary work, with stronger evidence guidance that treats code, config, and tests as authoritative over incomplete documentation.

## [0.46.5] - 2026-04-09

### Fixed
- Model Providers: The local provider "Configure" action no longer refreshes the entire provider panel after it opens Settings. That refresh was unnecessary for the local flow and could push the panel-flow test past the CI timeout.

## [0.46.4] - 2026-04-09

### Fixed
- Release test alignment: Updated the manifest test to validate the current `view/title` contributions and updated the CLI adversarial-prompt test to assert the current blocked-write safety message instead of the older placeholder response.

## [0.46.3] - 2026-04-09

### Fixed
- CI release blocker: Removed an unused `isChatPanelTarget()` helper from the chat panel so repository lint passes again across Ubuntu, Windows, and macOS release checks.

## [0.46.2] - 2026-04-09

### Fixed
- Local multi-endpoint discovery now tolerates one endpoint failing without aborting discovery for the others. AtlasMind keeps the reachable local engine models instead of leaving the provider stuck on stale results when another configured endpoint refuses the `/models` request.
- Settings panel: The LM Studio preset now uses `http://127.0.0.1:1234/v1` instead of `http://localhost:1234/v1`, which avoids common Windows loopback resolution mismatches.

## [0.46.1] - 2026-04-09

### Fixed
- Local endpoints now refresh the Models tree view and re-discover models automatically when `localOpenAiEndpoints` or `localOpenAiBaseUrl` configuration changes — previously saving endpoints from the Settings panel updated config but never triggered `refreshProviderModels` or `modelsRefresh`, so the sidebar kept showing the provider as disconnected.

## [0.46.0] - 2026-04-09

### Added
- Settings panel: The local endpoint “+” button now opens a dropdown preset menu with common local LLM systems (Ollama, LM Studio, Open WebUI, LocalAI, llama.cpp, vLLM, Jan) that auto-fill the label and default base URL. A “Custom endpoint…” option adds a blank row for manual entry.
- Regression test for the preset menu content in the rendered webview.

## [0.45.15] - 2026-04-09

### Fixed
- Settings panel: Fixed JavaScript syntax error that silently killed the entire webview script — a regex literal `/\/+$/` inside the `scriptContent` template literal lost its backslash escape (template literals interpret `\/` as `/`), rendering `//+$/` which the browser parsed as a line comment, breaking all subsequent code including every event-handler binding.
- Added a regression test (`renders a settings webview script with valid JavaScript syntax`) that extracts the generated `<script>` tag and validates it with `new Function()` to catch template-literal escaping issues.

## [0.45.14] - 2026-04-09

### Fixed
- Settings panel: Moved `createLocalEndpointId()` into the webview script where it is actually called — it was stranded at module level (extension host scope) since a prior edit, causing a `ReferenceError` inside the try/catch block that silently killed all handler bindings registered after the local-endpoints section.
- Settings panel: Re-added `page.hidden` toggling in `activatePage()` (matching the working Model Provider panel pattern) as a belt-and-suspenders fallback alongside CSS-class–driven page switching.

## [0.45.13] - 2026-04-09

### Fixed
- Settings panel: Removed `window.location.hash` navigation, `:target` CSS rules, and `hidden` HTML attributes that were crashing or conflicting in the VS Code webview environment. Page switching is now purely CSS-class-driven via `.active`, ensuring the script fully initializes and click handlers work.

## [0.45.12] - 2026-04-09

### Fixed
- Settings panel: Changed nav links from `<a>` elements to `<button>` elements. VS Code webviews intercept anchor clicks through their built-in link handler before JavaScript event listeners fire, which silently prevented all Settings page navigation.

## [0.45.11] - 2026-04-09

### Fixed
- Settings panel: Navigation now binds clicks directly on each section link, synchronizes the active page through the URL hash, and gives explicit deep-link targets precedence over stale saved webview state so the side menu remains responsive and Local LLM Configure no longer gets pulled back to Home by remembered navigation state.

## [0.45.10] - 2026-04-09

### Fixed
- Settings panel: Replaced the hardcoded Overview-only fallback with a per-target fallback-visible section, so targeted opens such as Local LLM Configure now render the requested Settings page instead of falling back to Home.

## [0.45.9] - 2026-04-09

### Fixed
- Settings panel: The requested page now renders server-side on first open and when retargeting an already-open Settings panel, so deep links still land on the intended section even if the previous webview script instance was unhealthy.
- Settings panel: Corrected the local endpoints deep-link target so Local LLM configuration now points at the actual local endpoints card on the Models page.

## [0.45.8] - 2026-04-09

### Fixed
- Model Providers: The Local LLM Configure action now opens AtlasMind Settings directly to the Models page and scrolls to the local endpoints card instead of landing on a less relevant location.

## [0.45.7] - 2026-04-09

### Fixed
- Settings panel: Restored separated settings sections without depending on successful script startup, corrected the left-nav box sizing so the active pill no longer overflows its container, and kept hash-based section switching available as a no-JavaScript fallback.

## [0.45.6] - 2026-04-08

### Fixed
- Settings panel: Converted the left-side section menu to progressive-enhancement anchors and only enable single-page hiding after the settings script boots, so the menu still responds and scrolls to the correct section even if later control wiring fails in the webview.

## [0.45.5] - 2026-04-08

### Changed
- Chat panel: Refined long-answer typography with slightly looser paragraph rhythm, softer section heading weight, tighter list indentation, and calmer blockquote styling so dense responses read more like a polished assistant transcript.

## [0.45.4] - 2026-04-08

### Fixed
- Settings panel: Hardened the left-side page navigation so it initializes independently from the rest of the page controls, and raised the nav stacking context so it stays clickable even if neighboring content initialization fails or spills visually during debug sessions.

## [0.45.3] - 2026-04-08

### Fixed
- Chat panel: Mixed markdown sections that contain headings followed by bullet lists now render as separate heading and list blocks instead of collapsing into title-like bullet text.

### Changed
- Chat panel: The transcript role pill and model badge now use matching font sizing and height, and the Thinking Summary disclosure uses a lighter, lower-contrast treatment against the bubble background.

## [0.45.2] - 2026-04-08

### Fixed
- Settings panel: Deferred the legacy local-endpoint migration until after the webview finishes initializing, and now sync the migrated endpoint list back into the live page so the left-side settings navigation keeps responding during first-open migration.

## [0.45.1] - 2026-04-08

### Changed
- Settings panel: Opening AtlasMind Settings now auto-migrates an explicitly configured legacy `atlasmind.localOpenAiBaseUrl` into the structured `atlasmind.localOpenAiEndpoints` list when no structured local endpoint list exists yet.

## [0.45.0] - 2026-04-08

### Added
- Local provider: AtlasMind can now aggregate multiple labeled local OpenAI-compatible endpoints under the single Local provider, which lets workspaces keep engines such as Ollama and LM Studio online together while preserving which endpoint owns each routed local model.
- Settings panel: Models & Integrations now exposes a dynamic local-endpoint list with a `+` add control so operators only create extra endpoint fields when they actually need them.

### Changed
- Model Providers panel: The Platform & Local page now shows each configured local endpoint by label and base URL so operators can tell which local engine is which at a glance.

## [0.44.37] - 2026-04-08

### Changed
- Chat panel: Softened the transcript header role pill and model badge, and tightened header spacing so assistant replies read with a quieter, denser hierarchy closer to first-party Copilot surfaces.

## [0.44.36] - 2026-04-08

### Changed
- Chat panel: Reorganized assistant footer metadata into compact disclosure cards with a separate utility row for votes and run links, keeping reasoning and work-log details secondary to the answer body.
- Chat panel: Tightened follow-up chips and reasoning typography so Atlas process detail reads closer to a compact professional assistant transcript.

## [0.44.35] - 2026-04-08

### Fixed
- Chat panel: Fenced code blocks in assistant responses now stay intact across blank lines instead of fragmenting into accidental headings and oversized transcript sections.

### Changed
- Chat panel: Tightened transcript card spacing, constrained code block presentation, and made follow-up controls more compact so long technical answers remain readable in the dedicated Atlas chat surface.

## [0.44.34] - 2026-04-08

### Fixed
- Workspace-backed assessment prompts: AtlasMind now treats requests about the current project structure, settings pages, and voice settings as workspace-investigation tasks more reliably instead of drifting into generic architecture prose.
- Read-only exploration follow-through: when Atlas has already gathered enough repository evidence, the exploration nudge now requires an exact existing file path or one final lookup, reducing vague answers that only mention hypothetical files or UI areas.

## [0.44.33] - 2026-04-08

### Changed
- Chat panel: Session timeline bullets now render with inline body-style labels instead of oversized title-like headings, improving transcript readability in the Atlas chat surface.

## [0.44.32] - 2026-04-08

### Fixed
- Action-oriented workspace requests: AtlasMind now recognizes feature-wiring prompts such as "wire in", "configure", or "integrate" as direct-execution work more reliably, and gives action-biased turns one stronger follow-through reprompt after read-only evidence so the chat does not stop at a polished summary before attempting concrete progress.

## [0.44.31] - 2026-04-08

### Fixed
- Cost-aware tool routing: Terse command-style MCP actions now prefer a real local function-calling model when the local provider can satisfy the request, reducing unnecessary billed-provider usage for simple tool turns.
- Tool execution reporting: AtlasMind now surfaces authoritative failed-tool summaries when a tool round only returns failures or validation errors, preventing contradictory "success" narration after an MCP action did not actually complete.

## [0.44.30] - 2026-04-08

### Changed
- Cost Dashboard: Added proper MTD, QTD, YTD, and All Time window presets to the Daily Spend filter and removed the old 60-day preset.
- Cost Dashboard: Added a chart-style toggle so Daily Spend can render as either a line chart or a bar chart instead of overlaying both at once.
- Cost Dashboard: Made Recent Requests sortable by clicking the column headings and constrained the Model column to a single truncated line with the full value preserved in the tooltip.

## [0.44.27] - 2026-04-08

### Changed
- Settings panel: Budget and Speed routing options now show option-specific hover help so operators can see the routing tradeoff attached to each choice before switching modes.

## [0.44.26] - 2026-04-08

### Fixed
- Tool routing: Short command-style prompts such as starting or stopping timers now keep the tool-capable routing path for built-in agents instead of silently downgrading to a pinned text-only model like Claude CLI when a function-calling model is available.

## [0.44.25] - 2026-04-08

### Fixed
- OpenAI tool routing: AtlasMind now normalizes MCP-style tool ids into OpenAI-safe function names before sending tool-enabled requests to OpenAI-compatible providers, then maps provider-returned tool calls back to the original Atlas skill ids.

## [0.44.24] - 2026-04-08

### Changed
- Model routing: `cheap` mode now applies a much stronger score multiplier to effective cost after the budget gate, so low-cost eligible models win more decisively within the cheap pool.
- Model routing: `fast` mode now applies a much stronger score multiplier to speed after the speed gate, so fast-eligible models are ranked more aggressively toward low-latency choices.

## [0.44.23] - 2026-04-08

### Fixed
- Claude CLI routing: AtlasMind no longer treats Claude CLI (Beta) as `function_calling` capable after model discovery refresh, so tool-routed turns can fall through to real tool-capable providers such as OpenAI instead of getting stuck on the print-mode bridge.

## [0.44.22] - 2026-04-08

### Fixed
- Chat metadata: AtlasMind no longer exposes internal provider failover and escalation debug trails as the visible `Model` label in chat responses, which prevents long failover strings from flooding the transcript footer when a request recovers through another model.
- Cost tracking: Billing and usage records now stay pinned to the final routed model instead of inheriting a user-facing failover summary string.

## [0.44.21] - 2026-04-08

### Added
- MCP import: Added `AtlasMind: Import VS Code MCP Servers` plus an MCP panel shortcut that scans the current VS Code profile `mcp.json` and workspace `.vscode/mcp.json` files, then imports compatible `stdio` and `http` servers into AtlasMind.

### Changed
- MCP registry: AtlasMind now deduplicates imported MCP server configs against its own registry, can re-enable matching disabled entries instead of creating duplicates, and skips VS Code-only MCP options that AtlasMind cannot reproduce safely.

## [0.44.20] - 2026-04-08

### Changed
- Specialist routing: Freeform specialist domains now derive preferred providers from the live refreshed model catalog instead of a fixed provider list, using domain metadata carried through discovery and catalog enrichment.
- Configuration: Added `atlasmind.specialistRoutingOverrides` so workspaces can pin or suppress specialist domain routes without turning off automatic provider adaptation.

## [0.44.19] - 2026-04-08

### Fixed
- Models sidebar: When one provider exposes multiple model ids that share the same friendly display name, AtlasMind now shows the exact model slug inline so entries such as repeated Claude Opus 4 variants can be distinguished without opening each tooltip.

## [0.44.18] - 2026-04-08

### Changed
- Session history: New chat sessions now derive a concise 1-3 word subject title from the first user turn instead of persisting a raw truncated sentence as the session label.
- Project Run Center: Autonomous run previews and saved run history now persist a dedicated short `title` alongside the full `goal`, so the chat panel and Run Center can show stable subject labels while still keeping the full goal available as supporting detail.

## [0.44.17] - 2026-04-08

### Changed
- Chat routing: Freeform requests now pass through a broader specialist-intent layer that can redirect media generation and recognition into dedicated workflow surfaces and bias specialist in-chat tasks toward stronger capability sets.
- Model selection: Research, robotics, and simulation prompts now carry specialist routing guidance into execution, prefer deeper reasoning routes, and can bias toward dedicated providers such as Perplexity when those routes are available.

## [0.44.16] - 2026-04-08

### Fixed
- Chat context carry-forward: Native chat now detects clear subject changes and stops injecting stale session or thread history into fresh prompts, which prevents unrelated earlier discussions from skewing new requests like image or logo generation.
- Chat follow-up handling: Explicit follow-up prompts such as `based on the above` and similar contextual continuations still retain prior conversation context, so Atlas keeps the current thread when the user is clearly continuing the same task.

## [0.44.15] - 2026-04-08

### Fixed
- Chat intent routing: Freeform prompts that ask AtlasMind to generate images, logos, icons, and similar visual assets now route to the specialist integrations workflow instead of falling through to normal chat-model routing.
- Specialist workflow recognition: Native chat now recognizes direct requests to open Specialist Integrations, which makes the dedicated image-generation setup surface easier to reach from plain-language prompts.

## [0.44.14] - 2026-04-08

### Changed
- Chat execution: The native sidebar chat now shows a session-timeline recovery note in the assistant footer when Atlas learns from explicit operator frustration, so the direct-recovery shift is visible outside the dedicated panel too.
- Chat history: Assistant transcript metadata now persists learned-from-friction timeline notes, and the dedicated chat panel can derive a recent recovery banner from those saved notes even after the original turn has completed.

## [0.44.13] - 2026-04-08

### Changed
- Chat panel: Added header shortcuts for opening the Project Run Dashboard and reopening the current AtlasMind chat context in the main sidebar chat view.
- Chat panel: The dedicated chat panel now surfaces a direct-recovery banner when Atlas detects operator frustration and switches the current turn into a more action-biased recovery path.
- Workspace learning: Added focused coverage for frustration adaptation persistence so workspace personality answers, chat carry-forward settings, and `operations/operator-feedback.md` stay synchronized when Atlas learns from a frustrated correction.

## [0.44.12] - 2026-04-08

### Changed
- Chat execution: Native chat and the dedicated chat panel now detect explicit operator frustration, suppress redundant execution-choice follow-up prompts when recent context already makes the request actionable, and inject a direct recovery cue into the current turn.
- Workspace learning: Frustration recovery now updates the saved workspace Personality Profile answers, raises carried chat-context settings when needed, and writes a durable SSOT note to `operations/operator-feedback.md` so Atlas can bias toward direct corrective action in future turns.

## [0.44.11] - 2026-04-08

### Changed
- Chat panel: The composer hint panel now adds context-aware tips based on live chat state, including pending approvals, pending run review, attached files, suggested follow-ups, active send mode, and the apparent shape of the latest user request.

## [0.44.10] - 2026-04-08

### Changed
- Chat panel: Reworked the composer info tooltip into a more readable hint panel with a heading and bullet list, and made the panel swap between idle, busy, and run-inspector guidance as chat state changes.

## [0.44.9] - 2026-04-08

### Fixed
- Chat execution: Atlas now treats terse follow-up requests such as `can you do that for me`, `handle that`, `take care of it`, and similar deictic action prompts as actionable when recent session context clearly points at a workspace or repo task.
- Classifier consistency: Direct-action bias, workspace-investigation bias, and task profiling now share the same follow-up cues, which reduces cases where Atlas answers with advice or misclassifies repo-maintenance work instead of using tools.

## [0.44.8] - 2026-04-08

### Fixed
- Chat panel: Circular toolbar and composer icon buttons now center their glyphs consistently by using explicit inline-flex centering and block SVG layout in the shared chat webview styles.

## [0.44.7] - 2026-04-08

### Fixed
- Claude CLI routing: AtlasMind now retries healthy real providers with permissive routing gates and can degrade implicit tool-enabled turns to text-only mode before it falls back to `local/echo-1`.
- Claude CLI adapter: The Beta bridge now sends a compact recent-context prompt, strips bulky memory and live-evidence sections from the forwarded system prompt, and gives Claude CLI a longer execution timeout so normal AtlasMind chat prompts return instead of hanging behind the local echo fallback or timing out.

## [0.44.6] - 2026-04-08

### Fixed
- Chat execution: Atlas no longer misclassifies terse follow-up commands such as `resolve these` as implementation work that must be blocked behind a red-to-green TDD gate.
- Safety gating: Repo-maintenance actions such as Dependabot branch resolution, merges, rebases, and similar dependency-update workflows now stay actionable while leaving the TDD gate in place for real implementation changes.

## [0.44.5] - 2026-04-08

### Fixed
- Claude CLI routing: AtlasMind now retries model selection with permissive routing gates and, when tools were only implicitly available, degrades to a text-only turn before falling back to `local/echo-1`. This prevents healthy Claude CLI models from being skipped just because they do not advertise `function_calling` or land in a slower routing tier.

## [0.44.4] - 2026-04-08

### Changed
- Packaging: Tightened `.vscodeignore` so local VSIX builds exclude workspace-only artifacts such as assistant metadata, project memory snapshots, wiki pages, generated VSIX files, local Vitest JSON reports, and extra dependency documentation or test folders.

## [0.44.3] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now records whether the project already has an online repo, where a new one should be created if it does not, and writes that decision into `operations/repository-plan.md` plus the generated brief and roadmap.

### Changed
- Bootstrap: Repo-hosting intent can now be inferred from earlier freeform answers, so Atlas can skip the later remote-repository prompts without losing the target host or location.

## [0.44.2] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now seeds project-scoped Personality Profile defaults when the intake provides stable project guidance, so Atlas carries that context into later task routing without requiring a separate manual profile pass.

### Changed
- Bootstrap: The guided intake now reuses future-answer details when they were already provided in an earlier freeform response, which prevents Atlas from apparently forgetting out-of-order context and avoids redundant prompts.

## [0.44.1] - 2026-04-08

### Added
- Personality Profile: Added separate Save as Global Default and Save for This Project actions so Atlas can carry a reusable operator baseline across workspaces while still supporting repo-specific overrides.

### Changed
- Personality Profile: Atlas now merges the saved global profile with any project override before injecting workspace identity into task prompts, and the panel can restore the saved global baseline or Atlas defaults into the editor before saving.

### Fixed
- Personality Profile: Reverting a project back to the global baseline now clears project-scoped questionnaire data, removes generated SSOT profile artifacts, and drops workspace-only live-setting overrides so the user-level defaults take effect again.

## [0.44.0] - 2026-04-08

### Added
- Bootstrap: `/bootstrap` now runs a guided but fully skippable Atlas intake for project brief, audience, builders, timeline, budget, routing posture, stack, and third-party tooling.
- Bootstrap: Intake answers now seed SSOT artifacts including `project_soul.md`, `domain/project-brief.md`, `operations/bootstrap-intake.md`, `roadmap/bootstrap-plan.md`, and the initial ideation board files under `project_memory/ideas/`.
- Bootstrap: Atlas now writes GitHub-ready planning artifacts during bootstrap, including `.github/ISSUE_TEMPLATE/project_intake.yml` and `.github/project-planning/atlasmind-project-items.csv`.

### Changed
- Governance scaffolding: Generated pull request and issue templates now reflect the captured project brief, audience, and constraints instead of using only generic placeholder text.
- Settings seeding: Bootstrap now maps captured routing and dependency-monitoring preferences into existing workspace settings when the answers cleanly match AtlasMind configuration.

## [0.43.15] - 2026-04-08

### Fixed
- Chat routing: Plain continuation prompts such as `proceed with the fix` now stay in normal freeform execution unless the user explicitly asks for autonomous/project execution or the recent transcript is already inside a project run.
- Chat follow-ups: Atlas no longer asks an extra `Do you want me to fix this?` question after prompts that already describe a concrete workspace change such as moving, replacing, or renaming UI elements.
- Project runs: Provider failures now surface as failed subtasks instead of appearing as completed work with only an error string.
- Provider recovery: Timeout errors are now treated as transient provider failures, so Atlas retries them before giving up or failing over.

## [0.43.14] - 2026-04-08

### Changed
- Chat composer: Remapped Enter shortcuts so Shift+Enter starts a new chat thread, Ctrl/Cmd+Enter sends as Steer, Enter keeps the currently selected send mode, and Alt+Enter remains the explicit newline shortcut.

## [0.43.13] - 2026-04-08

### Changed
- Project Ideation whiteboard: Added zoom in/out and fit controls with Ctrl/Cmd plus wheel and keyboard shortcuts, improved viewport expand/collapse handling, introduced zoom-based level-of-detail card rendering, and made new cards use collision-aware placement plus automatic association links when they are created from the current focus context.

## [0.43.12] - 2026-04-08

### Fixed
- Claude CLI (Beta): Hardened print-mode response parsing so AtlasMind now strips embedded pseudo-tool markup from Claude CLI result text and fails clearly when the CLI returns JSON without any assistant message instead of surfacing raw payloads back into chat.

## [0.43.11] - 2026-04-08

### Changed
- Chat composer: When the shared chat surface is active and idle, focus now returns to the prompt input after chat-state refreshes and tool-approval actions so consecutive prompts can be sent without re-clicking into the composer.

## [0.43.10] - 2026-04-08

### Changed
- Chat toolbar: Clear, Copy, and Open as Markdown buttons replaced with SVG icon buttons (trash, copy-pages, and document-with-arrow icons respectively); Clear attachments `x` text replaced with an SVG icon. All retain their existing titles and aria-labels as tooltips.

### Added
- Added common Enter-variant keyboard shortcuts to the Atlas chat composer so Ctrl/Cmd+Enter also sends and Alt+Enter inserts a newline alongside the existing Enter and Shift+Enter behavior.

## [0.43.9] - 2026-04-08

### Changed
- Chat composer: The keyboard/alias hint at the bottom of the composer is now hidden behind an info icon tooltip in the send row. Hovering or focusing the icon reveals the full tip text without occupying permanent vertical space.
- Chat composer: Send button now shows a Play icon; Mic button moved to the right of the Send button.

## [0.43.5] - 2026-04-08

### Fixed
- Moved in-chat tool approval cards below the transcript and above the composer so approval prompts stay anchored near the active input area with stronger warning styling.
- Stopped generic tool approval prompts from opening a new detached chat panel when AtlasMind can instead reuse the current chat surface.

## [0.43.4] - 2026-04-08

### Added
- Added a text-to-speech settings card to the Settings dashboard so AtlasMind voice playback can be tuned directly from the main Models & Integrations page.

### Changed
- Wired the Settings dashboard to the existing workspace voice settings for TTS enablement, rate, pitch, volume, language, and preferred output device.

## [0.43.3] - 2026-04-08

### Fixed
- Stopped Atlas chat from streaming transient progress notes into the visible answer body, so internal execution updates no longer pollute the final response text in the shared chat panel.
- Restored an end-of-response summary for autonomous `/project` runs in chat responses and rendered thinking summaries in a compact collapsible footer instead of as a long inline block.
- Corrected Google Gemini token accounting when the provider returns Gemini-style usage metadata fields instead of OpenAI-style `prompt_tokens` and `completion_tokens`, preventing false `$0` cost reports.
- Prevented Gemini text tasks from routing into `*-tts` preview models by excluding speech-oriented Gemini variants from the normal chat/reasoning model catalog.

## [0.43.2] - 2026-04-07

### Fixed
- Added the missing `CancellationTokenSource` vscode mock to the Copilot discovery test so the full Vitest suite passes with the current Copilot adapter request flow.

## [0.43.1] - 2026-04-07

### Changed
- Made the Voice Panel persist preferred microphone and speaker ids, wired the `atlasmind.voice.sttEnabled` setting into the actual speech-input controls, and added capability notes around browser, ElevenLabs, and future OS-native speech backends.
- Switched ElevenLabs playback in the Voice Panel from raw Web Audio output to `HTMLAudioElement` playback so supported runtimes can honor a selected output device through `setSinkId()`.
- Expanded Project Ideation with injected constraints, deterministic context packets, auditable run lineage, and one-click promotion of a selected card into a drafted `/project` execution prompt.
- Added richer card modes, evidence-aware attachments, confidence and validation scoring, board lenses, smart relation suggestions, and genealogy cues so the ideation board behaves more like a lightweight knowledge graph.

## [0.42.5] - 2026-04-07

### Changed
- Reverted the experimental composite Home sidebar and restored the previous native AtlasMind sidebar layout with the compact Quick Links strip at the top.

## [0.42.4] - 2026-04-07

### Changed
- Moved the Settings dashboard extension version badge from the title row to the lower-right corner of the hero banner.

## [0.42.3] - 2026-04-07

### Changed
- Added CLI-style prompt history navigation to the shared Atlas chat composer so pressing Up or Down at the start or end of the input recalls recent submitted prompts without breaking multiline editing.

## [0.42.2] - 2026-04-07

### Added
- Added a dedicated built-in `docker-cli` skill so AtlasMind can inspect containers and run controlled Docker Compose lifecycle operations through a strict allow-list instead of generic terminal passthrough.

### Changed
- Classified Docker tool calls as terminal-read or terminal-write based on the requested Docker or Docker Compose action so approval prompts match the operational risk.

## [0.42.1] - 2026-04-07

### Changed
- Added an AtlasMind sidebar container action that runs Collapse All across every AtlasMind tree view, so the sidebar title overflow menu now has a single command for folding the operational trees back down.

## [0.42.0] - 2026-04-07

### Added
- Added a Claude CLI (Beta) routed provider that reuses a locally installed Claude CLI login through constrained print-mode execution in both the extension host and the AtlasMind CLI.
- Added Claude CLI (Beta) provider discovery, seed models, provider-panel setup detection, and catalog metadata so the new backend is clearly labeled Beta across user-facing model-management surfaces.

## [0.41.33] - 2026-04-07

### Changed
- Replaced the modal OS-level tool approval prompt with an in-chat AtlasMind approval card so Allow Once, Bypass Approvals, Autopilot, and Deny decisions now happen inside the shared chat workspace.

## [0.41.32] - 2026-04-07

### Changed
- Added an always-on workspace identity prompt that combines the saved Atlas Personality Profile with a compact `project_soul.md` summary so every chat turn stays grounded in both operator preferences and project identity.

## [0.41.31] - 2026-04-07

### Changed
- Made AtlasMind's default chat agent more proactive for fix-oriented requests by injecting a stronger execution bias toward workspace tool use and re-prompting once when action-oriented turns answer with speculation instead of touching the repo.

## [0.41.30] - 2026-04-07

### Fixed
- Registered the AtlasMind sidebar Quick Links webview before the tree views so fresh default layouts now materialize the icon strip ahead of Project Runs instead of appending it lower in the stack.

## [0.41.29] - 2026-04-07

### Changed
- Made the Personality Profile live-settings summary tiles clickable so they jump to the associated Atlas settings pages instead of remaining passive status cards.

## [0.41.28] - 2026-04-07

### Changed
- Reworked the Personality Profile questionnaire so every prompt now has a freeform text answer plus quick-fill preset options instead of forcing select-only fields.
- Added direct open-in-editor links for the generated profile markdown and `project_soul.md` from the panel when SSOT is active.

## [0.41.27] - 2026-04-07

### Changed
- Wired the saved Atlas Personality Profile into runtime prompt assembly so workspace-specific behavior preferences now influence every Atlas task instead of living only in SSOT artifacts.
- Added a dedicated Personality Profile icon to the AtlasMind sidebar Quick Links bar for one-click access from the container header area.
- Added tree-view regression coverage for the new Quick Links personality shortcut.

## [0.41.26] - 2026-04-07

### Changed
- Added an editable Atlas Personality Profile dashboard with a guided multi-section questionnaire for role, tone, reasoning, memory, boundaries, escalation, and red-line preferences.
- Wired the profile into live AtlasMind workspace settings for budget mode, speed mode, approval mode, daily cost limits, and chat carry-forward controls.
- Synced saved profiles into project memory when SSOT is available by writing structured artifacts under `project_memory/agents/`, updating a summary block in `project_soul.md`, and surfacing the panel during the Getting Started walkthrough.

## [0.41.25] - 2026-04-07

### Changed
- Added a top-anchored Quick Links strip to the AtlasMind sidebar so the Project Dashboard, Ideation board, Run Center, Cost Dashboard, Model Providers, and Settings are available as compact icon buttons directly under the container title.
- Made top-right hero summary chips across the provider, specialist, agent, MCP, webhook, voice, vision, and settings webviews interactive where they map to a concrete page or filter, and added hover/focus tooltips where they are explanatory only.
- Added full catalog views to the Model Providers and Specialist Integrations panels so status chips can jump to the relevant records instead of landing on an arbitrary subsection.

## [0.41.24] - 2026-04-07

### Changed
- Clarified the Local provider info summary so AtlasMind now labels its routed model catalog separately from the live engine models currently loaded by the local runtime.

## [0.41.23] - 2026-04-07

### Changed
- Added live local engine model inventory to the Local provider info summary so the sidebar info action now shows the models currently loaded in the connected local engine.

## [0.41.22] - 2026-04-07

### Fixed
- Expanded workspace-investigation routing for live operational checks so AtlasMind now biases localhost, port, and Ollama verification prompts toward actual tool use instead of speculative analysis.

## [0.41.21] - 2026-04-07

### Fixed
- Corrected local provider configuration detection so AtlasMind now recognizes `atlasmind.localOpenAiBaseUrl` from VS Code settings when building provider summaries, tree status, and local provider prompts.

## [0.41.20] - 2026-04-07

### Changed
- Switched AtlasMind's Marketplace publishing flow back to the standard release channel by clearing the preview manifest flag, making `npm run publish:release` the default path, and keeping Beta branding in the documentation until `1.0.0`.

## [0.41.19] - 2026-04-06

### Fixed
- Preserved dependency-safe staged `/project` continuation runs by teaching planner-job splitting and Run Center previews to account for already completed seeded subtasks.
- Adopted legacy unstamped project run history into the active workspace so pre-scoping runs remain visible after upgrade instead of disappearing.

### Changed
- Clarified the current Marketplace messaging so AtlasMind's published badge and release guidance stay aligned with the project's pre-release-only policy before `1.0.0`.

## [0.41.18] - 2026-04-06

### Changed
- Added staged planner-job execution for oversized Project Run Center drafts so large `/project` plans can execute in dependency-safe chunks with follow-up seed outputs.
- Scoped project run history to the active workspace, added deletion support for non-running saved runs, and updated the Run Center UI and tests to reflect the new review and continuation flow.

## [0.41.17] - 2026-04-06

### Changed
- Updated the repository workflow guidance to match the live solo-maintainer `master` protection model: PR-only merges plus required CI, without mandatory reviewer approval or CODEOWNERS review.

## [0.41.16] - 2026-04-06

### Changed
- Added a focused runtime regression that exercises a milestone-tracking review prompt and verifies Atlas routes it through the reviewer guidance that calls for creating the smallest missing regression spec.

## [0.41.15] - 2026-04-06

### Changed
- Tightened AtlasMind's tests-first execution prompts so freeform and `/project` code work now explicitly create the smallest missing regression test or spec when no suitable coverage exists, instead of only flagging the gap.
- Added regression coverage that locks the new tests-first wording into both the built-in agent prompts and the freeform and `/project` TDD gate path.

## [0.41.14] - 2026-04-06

### Fixed
- Corrected the Bedrock adapter request path so AWS SigV4 signing no longer double-encodes model IDs.
- Hardened the CLI workspace boundary checks by resolving real paths before approving filesystem access, which closes symlink-escape gaps for read and write operations.
- Isolated autopilot change listeners so one failing subscriber cannot break the rest of the approval-state updates.
- Reused computed SSOT memory metadata while indexing to keep evidence classification and embedding input in sync.

### Changed
- Added model-router regression coverage for repeated failure counts and preference-biased fallback after a model is marked failed.
- Removed repo-committed AtlasMind safety overrides from workspace settings and deleted the stub custom skill placeholder from `.atlasmind/skills/`.

## [0.41.13] - 2026-04-06

### Fixed
- Repaired the release-promotion CI failures by cleaning up lint issues in the runtime, bootstrapper, chat-panel attachment flow, and dashboard workflow parsing helpers.

## [0.41.12] - 2026-04-06

### Changed
- Restored the README title to show AtlasMind's current beta status directly in the main heading.

## [0.41.11] - 2026-04-06

### Changed
- Mirrored the README's safety-first, approval-aware, and red/green TDD-oriented positioning into the wiki landing pages so the top-level product message stays consistent across entry points.

## [0.41.10] - 2026-04-06

### Changed
- Strengthened the README positioning to call out AtlasMind's safety-first execution model and red/green TDD-oriented autonomous development principles.
- Reintroduced a compact comparison table in the README that highlights the biggest product differentiators without turning the page back into a long feature matrix.

## [0.41.9] - 2026-04-06

### Changed
- Rewrote the README to be shorter, clearer, and more value-focused for both new and experienced developers.
- Tightened core docs and wiki pages for accuracy, including current skill counts, exact command names, and clearer sidebar surface descriptions.

## [0.41.8] - 2026-04-06

### Changed
- Promoted SSOT memory from a snippet-only retrieval layer into a source-backed evidence system by storing document class, evidence type, and import source pointers on indexed memory entries.
- Updated memory ranking to account for document class, source-backed evidence, and recency so exact or current-state questions prefer fresher operational notes over generated index pages.
- Taught the orchestrator to classify summary-safe versus live-verify requests and include live source excerpts alongside memory summaries when the user asks for current or exact workspace state.

## [0.41.7] - 2026-04-06

### Changed
- Extended the embedded Atlas chat font-size range with three additional smaller `A-` steps, allowing the chat bubbles to scale down to `70%` of the default size while keeping the existing header controls and persistence behavior.

## [0.41.6] - 2026-04-06

### Fixed
- Added browser-side paste and drag-drop media ingestion for the embedded Atlas chat panel so clipboard screenshots and dropped local files can be attached without requiring a workspace file path.
- Extended the chat-panel attachment pipeline to accept serialized inline files, turning pasted images and dropped media into the same prompt attachments used by the existing composer flow.

## [0.41.5] - 2026-04-06

### Changed
- Added compact `A-` and `A+` controls to the embedded Atlas chat panel so operators can shrink or enlarge chat-bubble typography without affecting the rest of the workspace UI.
- Persisted the panel font-scale preference in the webview state so the chosen chat text size survives panel refreshes during the same working session.

## [0.41.4] - 2026-04-06

### Changed
- Rendered embedded Atlas chat assistant responses as safe markdown in the chat panel so headings, lists, emphasis, code spans, code fences, blockquotes, and links display with readable structure instead of raw markup.
- Restyled streamed `_Thinking:` notes and the collapsible thinking-summary body to use a slightly smaller, lower-contrast presentation so internal reasoning cues stay visible without competing with the main answer.

## [0.41.3] - 2026-04-06

### Changed
- Made Project Dashboard outcome-completeness tiles and operational-score recommendation cards open Atlas chat with drafted action prompts, so operators can move straight from a weak signal to a concrete first-pass task.
- Extended the Atlas chat panel target contract to accept drafted prompts and send-mode hints, allowing dashboard and other surfaces to prefill the composer instead of only deep-linking by session.

## [0.41.2] - 2026-04-06

### Changed
- Expanded the Project Ideation canvas with a viewport-fill mode, click-drag panning, and subtle edge glows so larger boards remain navigable when cards sit outside the visible frame.
- Added link selection and editing inside Project Ideation so operators can rename relationships, switch between dotted and solid lines, choose arrow direction, and delete links directly from the inspector.
- Fixed inline ideation card editing by moving card interaction off nested button markup and making the second-click edit gesture reliable inside the live canvas.

### Fixed
- Fixed the embedded Atlas chat thinking-logo globe so its rotating axis group now spins around the shared SVG viewbox center instead of drifting apart as the animation loops.
- Added panel regression coverage for the loader pivot contract so future chat-panel animation tweaks keep the globe aligned.

## [0.41.1] - 2026-04-06

### Changed
- Added ambiguity-aware follow-up choices for concrete repo-local chat diagnostics so AtlasMind can answer first and then offer "Fix This", "Explain Only", and "Fix Autonomously" instead of assuming execution.
- Extended the embedded Atlas chat panel to persist and render those follow-up chips inside assistant bubbles, keeping the sidebar chat aligned with native `@atlas` follow-up behavior.

## [0.41.0] - 2026-04-06

### Changed
- Refactored Project Ideation into its own dedicated dashboard so operators can open the whiteboard directly from the Project Dashboard, Project Runs view, or Project Run Center without navigating through the broader operational dashboard first.
- Added drag-and-drop and paste-driven ideation media ingestion so files, images, and links can be queued for the next Atlas pass or dropped onto the board to create media cards inline.
- Added inline card editing on double-click inside the ideation canvas while keeping the inspector available for structured edits.

## [0.40.3] - 2026-04-06

### Fixed
- Fixed the embedded Atlas chat panel to use container-relative height and zero shell padding so the sidebar chat no longer grows taller than its allocated view and hide the Sessions rail.
- Added panel regression coverage for the chat webview sizing contract so future shell-style changes do not reintroduce the overflow.

## [0.40.2] - 2026-04-06

### Added
- Added ideation promotion to the AtlasMind onboarding walkthrough and Project Runs empty-state so the new whiteboard is easier to discover before launching `/project` execution.
- Added focused test coverage for Project Dashboard deep-link navigation so the dedicated ideation command is verified to emit the correct webview navigation message.

## [0.40.1] - 2026-04-06

### Added
- Added a dedicated `AtlasMind: Open Project Ideation` command that opens the Project Dashboard directly on the Ideation page.
- Added direct ideation shortcuts to the Chat and Project Runs sidebar title bars so operators can jump into the whiteboard from the main Atlas workflow surfaces.

## [0.40.0] - 2026-04-06

### Added
- Added a guided ideation workspace to the Project Dashboard with a collaborative whiteboard canvas, draggable cards, card linking, focus selection, and persisted board state under `project_memory/ideas/`.
- Added a multimodal Atlas ideation loop so operators can run facilitated idea-shaping passes with voice capture, response narration, and optional image attachments that feed the same board update flow.
- Added Project Dashboard ideation persistence and validation so Atlas-generated prompts, feedback history, and board summaries are stored as both JSON and markdown artifacts for later review.

## [0.39.28] - 2026-04-06

### Changed
- Added live freeform execution progress updates in chat so AtlasMind now shows interim thinking-style notes while tool-heavy requests are still running.
- Added a read-only exploration nudge in the orchestrator so repeated search-only tool loops are pushed to summarize likely cause and fix before they hit the 10-iteration safety cap.
- Improved task profiling for chat-panel UI regressions so sidebar, dropdown, scroll, panel, and webview prompts are treated as code work instead of plain text.

## [0.39.27] - 2026-04-06

### Changed
- Inferred the tests-first write gate for ordinary freeform implementation tasks as well as `/project` subtasks, so AtlasMind now blocks implementation writes until a failing relevant test signal is established when the request looks like a testable code change.
- Added a red-to-green status cue to the chat Thinking summary so verified, blocked, missing, and not-applicable TDD states are visible directly in chat instead of being buried in verification prose.

## [0.39.26] - 2026-04-06

### Changed
- Added a Project Dashboard runtime TDD summary so operators can review aggregate verified, blocked, missing, and not-applicable `/project` outcomes without opening the Project Run Center first.
- Added per-run TDD labels to the Project Dashboard recent-runs list so autonomous runs blocked by the failing-test gate stand out immediately.

## [0.39.25] - 2026-04-06

### Changed
- Reworked the Memory sidebar into a folder-aware tree so SSOT storage folders stay visible and indexed notes are grouped beneath their storage paths instead of one flat list.
- Kept stale-memory warnings and inline memory actions intact while making larger SSOT collections easier to discover by area.

## [0.39.24] - 2026-04-06

### Changed
- Enforced a failing-test-before-write gate for testable `/project` implementation subtasks so AtlasMind holds non-test implementation writes until it has observed a relevant red signal.
- Expanded autonomous project subtasks to use test execution and workspace observability skills so AtlasMind can establish and verify that red signal during execution.
- Added persisted per-subtask TDD telemetry and surfaced it in the Project Run Center so operators can review verified, blocked, missing, and not-applicable TDD states.

## [0.39.22] - 2026-04-06

### Changed
- Added a hard `/project` TDD gate for testable implementation subtasks so AtlasMind blocks non-test implementation writes until it has observed a failing relevant test signal.
- Expanded planner subtask skills to include test execution and workspace observability tools, allowing AtlasMind to establish that red signal autonomously instead of only describing it.
- Added per-subtask TDD telemetry to persisted run artifacts and surfaced that status in the Project Run Center so operators can review whether each subtask was verified, blocked, missing evidence, or not applicable.

## [0.39.21] - 2026-04-06

### Changed
- Extended the new tests-first policy from autonomous `/project` execution into the stock freeform built-in agents so AtlasMind now prefers TDD-style verification in normal chat as well.
- Tuned the built-in debugging, frontend, backend, and review prompts so they demand failing-to-passing evidence or an explicit explanation when direct TDD is not practical.

## [0.39.20] - 2026-04-06

### Added
- Added a stock developer-focused set of built-in agents for freeform routing, including Workspace Debugger, Frontend Engineer, Backend Engineer, and Code Reviewer alongside the default fallback agent.
- Kept the built-in specialist set on the shared enabled skill pool so routing can benefit from distinct developer behaviors without fragmenting tool access.

## [0.39.19] - 2026-04-06

### Changed
- Updated autonomous `/project` planning so code-changing goals bias toward test-first subtasks, with implementation work depending on regression-capture or test-authoring steps where applicable.
- Added a shared TDD execution contract to ephemeral project sub-agents so Atlas now prefers a red-green-refactor loop, reports verification evidence, and explains when direct TDD is not applicable.
- Surfaced the tests-first delivery policy in the `/project` preview and refreshed the slash-command and planner documentation to describe the new autonomous behavior.

## [0.39.18] - 2026-04-06

### Fixed
- Extended the Model Providers webview to show provider-level warning badges when routed models from that provider have failed in the current session.
- Added an overview summary count for providers with failed models so failure state is visible in both the Models tree and the provider-management workspace.

## [0.39.17] - 2026-04-06

### Fixed
- Refreshed all enabled providers at startup, including GitHub Copilot, so AtlasMind builds its live model pool from the active providers instead of deferring interactive providers until manual activation.
- Switched agent execution, escalation, and failover to use the active candidate pool directly, removing failed models from routing until the next successful refresh instead of silently dropping back to `local/echo-1`.
- Added failed-model warning state in the Models sidebar so users can see which routed models faulted and inspect the latest failure details in the tooltip.

## [0.39.16] - 2026-04-06

### Fixed
- Prevented provider failover and escalation helpers from silently falling back to `local/echo-1` when the remaining models no longer satisfy required capabilities such as `function_calling`.
- Workspace-investigation requests that exhaust capable providers now fail explicitly instead of returning a misleading local echo of the user's prompt.

## [0.39.15] - 2026-04-06

### Fixed
- Stopped retrying provider timeout errors, so hung chat requests fail promptly instead of sitting in the AtlasMind panel through multiple 30-second retry windows.
- Preserved transient retries for actual retryable provider failures such as `429`, `5xx`, or explicitly temporary upstream errors.

## [0.39.14] - 2026-04-06

### Fixed
- Added an execution-layer retry for workspace-issue prompts so AtlasMind re-prompts once for actual workspace tool use when a model answers with "I'll search" style investigation narration instead of inspecting the repo.
- Kept `local/echo-1` on the built-in offline echo path even when a local OpenAI-compatible endpoint is configured, avoiding false 404 fallbacks for the reserved local model.

## [0.39.13] - 2026-04-06

### Fixed
- Normalized slash-containing upstream model IDs from OpenAI-compatible discovery and completion responses so Google Gemini models no longer surface as a fake `models` provider during routing.
- Hardened provider resolution in chat execution, project planning, and command-driven model actions so router metadata wins when a model ID is not already safely prefixed.

## [0.39.12] - 2026-04-06

### Changed
- Streamlined the README so commands, sidebar actions, and settings stay at a summary level and point to the dedicated command and configuration reference pages.
- Clarified version presentation by labeling the README badge as the published Marketplace release and directing branch-specific source version checks to `package.json`.

## [0.39.11] - 2026-04-06

### Changed
- Added natural-language escalation for Atlas chat so prompts like "start a project run to ..." can enter `/project` execution mode without requiring the literal slash command.
- Added natural-language AtlasMind surface routing for high-confidence prompts such as opening Settings, the Cost Dashboard, Model Providers, the Project Run Center, and related panels from chat.

## [0.39.10] - 2026-04-06

### Changed
- Strengthened agent selection with common software-development routing heuristics for debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release-oriented requests.
- Added a visible routing trace to assistant metadata so the Thinking summary now shows the selected agent, detected routing hints, and when workspace-investigation bias was applied.

## [0.39.9] - 2026-04-06

### Changed
- Added a workspace-issue heuristic to freeform chat so bug-report style prompts inject an extra inspect-the-repo-first hint into the default agent context.
- Further reduced the chance of support-style replies for concrete AtlasMind UI or behavior regressions by biasing the model toward workspace evidence before answering.

## [0.39.8] - 2026-04-06

### Changed
- Strengthened the default AtlasMind agent prompt so freeform chat treats repo bug reports as workspace tasks to inspect and act on instead of replying like a support-triage bot.
- Kept the default fallback agent on the full enabled skill set while explicitly biasing it toward repository investigation and execution when tools would help.

## [0.39.7] - 2026-04-06

### Added
- Added a real MCP Servers sidebar tree so configured MCP connections now appear with connection status, tool counts, and row-level actions.
- Added sidebar info actions for Skills and MCP Servers that post assistant-style summaries into the active Atlas chat session.

### Changed
- Switched the Memory, Agent, and Model sidebar info actions from transient notifications or external docs to chat-posted summaries that focus the shared Atlas chat view.

## [0.39.6] - 2026-04-06

### Changed
- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models so operational views surface first below Chat.
- Set the shipped default tree-view visibility to collapsed, while keeping stable view ids in place so VS Code continues to remember each user's custom sidebar order and expanded or collapsed state across later work.

### Added
- Added session archiving across the shared chat panel and Sessions sidebar, including an Archive bucket in the Sessions tree with drag-and-drop restore support.

### Changed
- Replaced live-session text actions in the chat panel with compact archive and delete icon buttons.
- Kept the new archive and restore session commands sidebar-local so they do not appear in the Command Palette.

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
- Sent the Cost Dashboard's Budget Settings shortcut directly to Settings → Overview with a budget-focused search instead of reopening whatever settings section was last active.
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
- **Terminal session readers** — `getTerminalOutput(terminalName?)` added to `SkillExecutionContext`; new `terminal-read` built-in skill lists open terminals and the active terminal, with a clear note that buffer content must be pasted by the user (VS Code API limitation).
- **Test result file parsing** — `workspace-state` skill now scans for JUnit XML and Vitest/Jest JSON result files and includes a summary (pass/fail counts, coverage percentages) in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) — lists all installed extensions with id, version, and enabled state; optionally filters by name fragment or restricts to the curated top-50 list; also reports forwarded ports from the VS Code Remote/Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard` command) — full-page webview panel showing total/today spend cards, daily bar chart (last 14 days), per-model cost breakdown, and a paginated recent-requests table with a budget utilisation bar when a daily limit is configured.
- **ElevenLabs TTS integration** — `VoiceManager` now accepts `SecretStorage`; when an ElevenLabs API key is configured in Specialist Integrations, `speak()` synthesises audio server-side via the ElevenLabs API and streams base64-encoded MP3 to the Voice Panel for playback via the Web Audio API; falls back to the Web Speech API when no key is set.
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
- Chat panel sessions section is now a collapsible drawer — collapsed by default, showing a "Sessions" toggle bar with a numeric badge; expands to 50% viewport height.
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
- Adopted a documented `develop` → `master` promotion model so `master` stays release-ready for published pre-releases.
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
- **Real daily budget enforcement** — `dailyCostLimitUsd` now blocks new requests once the cap is reached instead of only showing an advisory warning.
- **Live provider health refresh** — the status bar now refreshes immediately after storing credentials or refreshing model catalogs.
- **Run Center disk hydration** — the Project Run Center and project runs tree now read from the async disk-backed run history path instead of the legacy synchronous index.

### Added
- **Budget control in Settings panel** — the Settings webview now exposes `dailyCostLimitUsd` directly.
- **Quick actions in Settings** — direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision improve secondary-surface discoverability.
- **Coverage for follow-up fixes** — new tests cover daily budget blocking, disk-backed run history, and new settings-panel messages.

## [0.30.0] - 2026-04-04

### Added
- **Getting Started walkthrough** — four-step onboarding flow (configure provider, bootstrap/import, first chat, try /project) via `contributes.walkthroughs` in the extension manifest.
- **API key health check** — after storing a provider key the Model Provider panel immediately validates it by calling `listModels()` and shows pass/fail feedback.
- **Collapsible settings panel** — Settings webview groups options into collapsible `<details>` sections; advanced and experimental sections start collapsed.
- **Approval threshold explanation** — the `/project` approval gate now explains estimated file count, the threshold value, its purpose, and where to change it.
- **Memory tree pagination** — MemoryTreeProvider supports incremental loading (200 entries per page) with a "Load more…" item instead of a hard 200-entry cap.
- **Provider health status bar** — a StatusBarItem shows how many configured providers have valid API keys on activation.
- **Cost persistence and daily budget** — CostTracker persists session records and daily totals to `globalState`; new `atlasmind.dailyCostLimitUsd` setting triggers warnings at 80% and blocks at 100%.
- **Streaming for Anthropic and OpenAI-compatible providers** — full `streamComplete()` implementations with SSE parsing, tool-call accumulation, and token counting.
- **Agent performance tracking** — AgentRegistry records success/failure per agent; Orchestrator boosts agent selection score based on historical success rate; performance data persisted across sessions.
- **Expanded task profiler vocabulary** — all four regex pattern sets (vision, code, high-reasoning, medium-reasoning) expanded with 100+ additional keywords for more accurate task classification.
- **Multi-workspace folder support** — `pickWorkspaceFolder()` utility shows a quick-pick when multiple folders are open; used by bootstrap, import, and skill-template commands.
- **Per-subtask checkpoint rollback** — `rollbackByTaskId()` and `listCheckpoints()` added to CheckpointManager for targeted restore instead of last-only.
- **Integration test suite** — new `tests/integration/taskLifecycle.test.ts` exercises the full orchestrator → agent → cost → performance tracking lifecycle.
- **Cost estimation in plan preview** — `/project` now shows an estimated `$low – $high` cost range before execution based on subtask count and selected model pricing.
- **Disk-based run history** — ProjectRunHistory writes individual JSON files to `globalStorageUri/project-runs/` with automatic migration from `globalState`; synchronous index kept for tree views.
- **Diff preview in project report** — project execution summary includes a file/status table and an "Open Source Control" button for reviewing diffs.

### Changed
- Renamed "Semantic Search" references in docs and JSDoc to "Hybrid Keyword + Hash-Vector Search" to accurately describe the retrieval algorithm.
- Improved error messages in `commands.ts` to be more actionable (directs users to specific UI panels).

## [0.29.0] - 2026-04-04

### Added
- Centralised `src/constants.ts` — all magic numbers (~40 constants) extracted from 14+ source files into a single importable module.
- Shared `src/skills/validation.ts` — reusable parameter validation helpers (`requireString`, `optionalBoolean`, `optionalPositiveInt`, etc.) replacing duplicated typeof/trim checks across 8 skill files.
- `OrchestratorHooks` interface in `types.ts` — groups optional hook callbacks (toolApprovalGate, writeCheckpointHook, postToolVerifier) into a single bag, reducing the Orchestrator constructor from 13 positional parameters to 11.
- `OrchestratorConfig` interface in `types.ts` — runtime-configurable tunables (maxToolIterations, maxToolCallsPerTurn, toolExecutionTimeoutMs, providerTimeoutMs) with VS Code settings fallback to constant defaults.
- Four new user-facing settings: `atlasmind.maxToolIterations`, `atlasmind.maxToolCallsPerTurn`, `atlasmind.toolExecutionTimeoutMs`, `atlasmind.providerTimeoutMs`.
- Planner sub-task validation now uses a Zod schema (`zod/v4`) replacing manual field-by-field type guards.
- Lazy activation events — extension activates on chat participant, commands, or sidebar views instead of `onStartupFinished`.
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
- **PWYW funding support** — added GitHub Sponsors funding metadata and repository funding configuration so AtlasMind remains open source while offering an optional pay-what-you-want support path.

### Changed
- README now documents the funding model explicitly: AtlasMind stays MIT-licensed and fully open source, with sponsorship framed as optional maintenance support rather than feature gating.

## [0.28.0] - 2026-04-05

### Added
- **Project import** (`/import` slash command + `AtlasMind: Import Existing Project` command) — scans an existing workspace and populates SSOT memory with project overview, dependencies, directory structure, tooling conventions, and license information. Detects project type for Node.js, Rust, Python, Go, Java, Ruby, and PHP projects. Non-destructive: never removes existing memory entries.

## [0.27.1] - 2026-04-04

### Changed
- **README overhaul** — replaced the technical feature checklist with a user-friendly overview, centered logo, competitor comparison table (vs Claude Code, Cursor, Copilot, Aider, Open Hands), categorised skill table, provider list, and streamlined configuration section. Technical detail deferred to `docs/`.

## [0.27.0] - 2026-04-05

### Added
- **11 new built-in skills** bringing the total to 26:
  - `diagnostics` — retrieve compiler errors/warnings via the VS Code diagnostics API.
  - `code-symbols` — AST-aware navigation: list symbols, find references, go to definition.
  - `rename-symbol` — cross-codebase rename via the language server with identifier validation.
  - `web-fetch` — fetch URL content with SSRF protection (blocks localhost, private IPs, metadata endpoints); 30 s timeout.
  - `test-run` — auto-detect test framework (vitest, jest, mocha, pytest, cargo) and run tests; 120 s timeout.
  - `file-delete` — delete a workspace file.
  - `file-move` — move/rename a workspace file.
  - `git-log` — query commit log with optional ref, filePath, and maxCount (capped at 100).
  - `git-branch` — list, create, switch, or delete branches with branch-name validation.
  - `diff-preview` — combined git status + diff summary with add/modify/delete counts.
  - `code-action` — list and apply VS Code quick-fixes and refactorings.
- `file-read` skill now supports optional `startLine`/`endLine` parameters for targeted reads.
- 12 new methods on `SkillExecutionContext`: `getGitLog`, `gitBranch`, `deleteFile`, `moveFile`, `getDiagnostics`, `getDocumentSymbols`, `findReferences`, `goToDefinition`, `renameSymbol`, `fetchUrl`, `getCodeActions`, `applyCodeAction`.
- Per-skill `timeoutMs` override — skills like `web-fetch` (30 s) and `test-run` (120 s) bypass the default 15 s timeout.
- New test files: `diagnostics`, `codeSymbols`, `renameSymbol`, `webFetch`, `testRun`, `fileManage`, `gitBranch`, `diffPreview`, `codeAction` (381 tests total, 43 suites).

### Changed
- **Tiered terminal allow-list** — `terminal-run` now uses a three-tier model: blocked commands (rm, curl, powershell, etc.) are rejected immediately; auto-approved commands expanded to ~40 (added python, cargo, dotnet, go, make, deno, bun, and more); unknown commands are rejected with the allow-list.
- **`MAX_TOOL_CALLS_PER_TURN`** raised from 5 to 8 to support more complex agentic workflows.
- Orchestrator tool execution now respects `skill.timeoutMs` when set, falling back to `TOOL_EXECUTION_TIMEOUT_MS`.

## [0.26.0] - 2026-04-04

### Added
- **Disk persistence for memory writes** — `MemoryManager.upsert()` now persists entries as markdown files to the SSOT folder on disk, so agent-written decisions survive across sessions.
- **`memory-delete` skill** — agents can now remove stale or outdated SSOT entries via the new `memory-delete` built-in skill (`src/skills/memoryDelete.ts`). Deletes both the in-memory index entry and the on-disk file.
- **`MemoryUpsertResult` feedback** — `upsert()` returns `{ status, reason? }` instead of void, so callers know whether a write was created, updated, or rejected (capacity, validation, security scan).
- **Path validation on memory writes** — `memoryWrite` rejects absolute paths, parent traversal (`..`), and paths without text-file extensions.
- **Content scanning on memory writes** — all upserted content is scanned for prompt injection and credential leakage before acceptance; blocked entries are immediately rejected with a clear error.
- **Field-length enforcement** — title (200 chars), snippet (4 000 chars), tags (12 max, 50 chars each) are validated and clamped on upsert.
- **`maxResults` cap** — `memoryQuery` skill and `MemoryManager.queryRelevant()` now clamp results to a hard upper bound of 50.
- **`MemoryManager.delete()`** — new public method to remove an entry from the index and optionally delete the backing SSOT file.
- **`deleteMemory()` on `SkillExecutionContext`** — type-safe delete wired through the skill execution context.
- **Memory tree refresh** — `MemoryTreeProvider` now has `EventEmitter`-backed refresh, triggered automatically after upsert or delete operations; shows overflow indicator if entries exceed 200.
- **`memoryRefresh` event** on `AtlasMindContext` — fires on every index mutation so tree views and other consumers stay in sync.
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
- Corrected incorrect dates on CHANGELOG entries for v0.5.0 (`2026-04-04` → `2026-04-03`), v0.6.0 (`2026-04-05` → `2026-04-03`), and v0.7.0–v0.8.1 (`2026-04-06` → `2026-04-03`) to match actual git commit timestamps.
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
- **Premium request multiplier scoring** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): `effectiveCostPer1k()` now factors `premiumRequestMultiplier` (e.g. 3× for Claude Opus 4) into subscription cost calculations, enabling the router to prefer 1× models when capabilities are equivalent.
- **Subscription quota tracking** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `updateSubscriptionQuota()` / `getSubscriptionQuota()` APIs allow runtime quota management. When quota is exhausted, subscription models fall to pay-per-token budget gating and full listed-price scoring.
- **Conservation threshold** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): Below 30% remaining quota, effective cost blends linearly from subscription cost toward listed API cost, encouraging the router to conserve subscription requests as they deplete.
- **`costPerRequestUnit` blending** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): When `SubscriptionQuota.costPerRequestUnit` is set, the router computes real per-request cost (`costPerRequestUnit × multiplier`) enabling comparison across subscription tiers (e.g. Copilot Pro vs Claude Code).
- 10 new subscription quota and premium multiplier routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts).

### Security
- Added a tool policy layer that classifies invocations before execution and enforces modal approvals for risky actions.
- `terminal-run` executes only an allow-list of executables and never uses shell interpolation.

## [0.17.0] - 2026-04-04

### Added
- **Voice Panel** ([src/views/voicePanel.ts](src/views/voicePanel.ts)): New webview panel providing Text-to-Speech (TTS) and Speech-to-Text (STT) via the browser Web Speech API — no external API key required. Features microphone input button, transcript display, TTS text entry + speak controls, and live voice settings (rate, pitch, volume, language).
- **VoiceManager** ([src/voice/voiceManager.ts](src/voice/voiceManager.ts)): Extension-host service that queues TTS output and bridges STT transcripts. Integrates with `AtlasMindContext` and is disposed with the extension. Validates all voice settings and sanitises the BCP 47 language tag before forwarding to the webview.
- **`atlasmind.openVoicePanel` command** ([src/commands.ts](src/commands.ts)): Opens the Voice Panel. Listed in the Command Palette as _AtlasMind: Open Voice Panel_.
- **`/voice` chat slash command** ([src/chat/participant.ts](src/chat/participant.ts)): Responds with a voice capability summary and an **Open Voice Panel** action button. Follow-up chips added to freeform responses.
- **TTS auto-speak** ([src/chat/participant.ts](src/chat/participant.ts)): When `atlasmind.voice.ttsEnabled` is `true`, freeform `@atlas` responses are automatically forwarded to the Voice Panel for synthesis.
- **`VoiceSettings` type** ([src/types.ts](src/types.ts)): New interface with `rate`, `pitch`, `volume`, and `language` fields — validated in `VoiceManager` before use.
- **Six new configuration settings** (`atlasmind.voice.*`):
  - `ttsEnabled` — auto-speak freeform @atlas responses (default: `false`)
  - `sttEnabled` — enable STT in the Voice Panel (default: `false`)
  - `rate` — synthesis rate 0.5–2.0 (default: `1.0`)
  - `pitch` — synthesis pitch 0–2 (default: `1.0`)
  - `volume` — synthesis volume 0–1 (default: `1.0`)
  - `language` — BCP 47 language tag (default: `""` = browser default)

### Security
- Voice Panel webview follows the same CSP nonce + `escapeHtml()` + message-validation pattern as all other AtlasMind panels. Incoming messages are checked by a strict type guard before any action is taken. Language setting is validated against a BCP 47 regex before being applied.

## [0.16.0] - 2026-04-04

### Added
- **Well-known model catalog** ([src/providers/modelCatalog.ts](src/providers/modelCatalog.ts)): Pattern-based catalog of verified model metadata (pricing, context windows, capabilities) for Anthropic, OpenAI, Google, DeepSeek, and Mistral model families. The catalog is consulted during model discovery so the router receives accurate data instead of heuristic guesses.
- **`DiscoveredModel` interface** ([src/providers/adapter.ts](src/providers/adapter.ts)): New type for partial model metadata returned at runtime. Added optional `discoverModels()` method to `ProviderAdapter` — providers that implement it surface richer metadata than the ID-only `listModels()`.
- **CopilotAdapter.discoverModels()** ([src/providers/copilot.ts](src/providers/copilot.ts)): Extracts real `maxInputTokens` (context window) and display name from VS Code's Language Model API, then merges with catalog data for pricing and capabilities.  Enables the router to intelligently differentiate between multiple Copilot models (GPT-4o, Claude Sonnet 4, o4-mini, etc.).
- **AnthropicAdapter.discoverModels()** and **OpenAiCompatibleAdapter.discoverModels()** ([src/providers/anthropic.ts](src/providers/anthropic.ts), [src/providers/openai-compatible.ts](src/providers/openai-compatible.ts)): API providers now surface catalog-enriched metadata during discovery.
- **Subscription-aware routing** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New `PricingModel` type (`'subscription' | 'pay-per-token' | 'free'`) added to `ProviderConfig`. Router treats subscription (e.g. GitHub Copilot) and free (e.g. local) providers as zero effective cost, strongly preferring them over pay-per-token API providers for single-request routing. When `parallelSlots > 1`, the subscription advantage is progressively reduced so API providers can absorb overflow.
- **`selectModelsForParallel()`** ([src/core/modelRouter.ts](src/core/modelRouter.ts)): New method fills subscription/free slots first, then overflows to the best pay-per-token candidates for remaining parallel slots.
- [tests/providers/modelCatalog.test.ts](tests/providers/modelCatalog.test.ts) (25 tests) for catalog pattern matching across all providers.
- [tests/providers/copilotDiscovery.test.ts](tests/providers/copilotDiscovery.test.ts) (7 tests) for Copilot model discovery with real LM API properties.
- 8 new pricing-aware routing tests in [tests/core/modelRouter.test.ts](tests/core/modelRouter.test.ts) — subscription preference, budget gate bypass, parallel slot allocation.

### Changed
- **`refreshProviderModelsCatalog()`** ([src/extension.ts](src/extension.ts)): Now prefers `discoverModels()` over `listModels()` when available, passing rich `DiscoveredModel` hints into the merge pipeline.
- **`inferModelMetadata()`** ([src/extension.ts](src/extension.ts)): Rewired to consult discovery hints first, then the well-known catalog, then heuristic fallbacks. Previous implementation relied solely on substring heuristics.
- **`mergeProviderModels()`** ([src/extension.ts](src/extension.ts)): Now accepts optional discovery hints and enriches existing static entries with runtime data (e.g. real context window from the LM API).
- **`CopilotAdapter.resolveModel()`** ([src/providers/copilot.ts](src/providers/copilot.ts)): Improved matching strategy — tries exact ID match, then `family` match, then substring match before falling back to first available model.

## [0.15.0] - 2026-04-04

### Security
- **Critical**: Fixed path traversal vulnerability in `readFile` and `writeFile` skill contexts. Both now use `path.resolve()` + `path.relative()` to guarantee all file operations remain within the workspace root ([src/extension.ts](src/extension.ts)).
- Added JSON Schema validation for tool call arguments before skill execution — rejects missing required params and type mismatches ([src/core/orchestrator.ts](src/core/orchestrator.ts)).
- Hardened planner subtask validation: enforce length limits on `id` (80), `title` (200), `description` (2000), `role` (80), and validate that `skills`/`dependsOn` arrays contain only strings ([src/core/planner.ts](src/core/planner.ts)).
- MCP stdio transport now rejects commands containing shell metacharacters (`|;&\`$`) to prevent injection ([src/mcp/mcpClient.ts](src/mcp/mcpClient.ts)).
- Memory manager now enforces a cap of 1,000 entries and 64 KB per SSOT document to prevent denial-of-service via oversized memory ([src/memory/memoryManager.ts](src/memory/memoryManager.ts)).
- Settings panel rejects directory traversal and absolute paths in `projectRunReportFolder` input ([src/views/settingsPanel.ts](src/views/settingsPanel.ts)).
- `escapeHtml()` now escapes single quotes (`'` → `&#39;`) to prevent attribute injection in webview HTML ([src/views/webviewUtils.ts](src/views/webviewUtils.ts)).
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
- **z.ai (GLM) provider** — new `'zai'` provider ID with models GLM-4.7 Flash (free), GLM-4.7, and GLM-5.
  Uses the z.ai OpenAI-compatible endpoint (`https://api.z.ai/api/paas/v4`).
- **OpenAI provider** — GPT-4o mini and GPT-4o models now fully wired with adapter.
- **DeepSeek provider** — DeepSeek V3 (`deepseek-chat`) and DeepSeek R1 (`deepseek-reasoner`) models.
- **Mistral provider** — Mistral Small and Mistral Large models.
- **Google Gemini provider** — Gemini 2.0 Flash and Gemini 1.5 Pro via Google AI Studio's
  OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`).
- **`OpenAiCompatibleAdapter`** (`src/providers/openai-compatible.ts`) — generic adapter for any
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
- **Execution failure banner with rollback guidance** — when one or more subtasks fail,
  `/project` now shows a clear post-run banner listing the failed subtask titles, the
  number of files modified before the failure, and a *View Source Control* action button
  so users can quickly review and revert partial changes.
- **Outcome-driven follow-up chips** — `buildFollowups()` now accepts an optional
  `ProjectRunOutcome` context object and returns different chips based on run outcome:
  - Failures → *Retry the project* + *Diagnose failures*
  - Changed files (no failures) → *Add tests*
  - No changes / no outcome → original default chips
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
  - `/bootstrap` → view agents, view skills, query memory, start a project
  - `/agents` → skills, run a project, how to add an agent
  - `/skills` → agents, how to add a skill, run a project
  - `/memory` → search architecture/decisions, start a project from memory
  - `/cost` → which agents ran, tips to reduce cost
  - `/project` → review cost, save plan to memory, run another project
  - Freeform → turn into a project, search memory, check cost
- `handleChatRequest` now returns `vscode.ChatResult` with `metadata.command` so the `followupProvider` can distinguish which slash command produced the response.

## [0.7.0] - 2026-04-03

### Added
- **Parallel multi-agent project execution** — users can now ask Atlas to tackle a complex goal autonomously via the new `/project` slash command.
  - `src/core/planner.ts`: `Planner` class sends a structured JSON decomposition prompt to the LLM and returns a `ProjectPlan` — a DAG of `SubTask` nodes, each with an id, title, description, role, skill IDs, and `dependsOn` edges. Includes JSON fence extraction, per-field validation, and Kahn's cycle-removal algorithm so malformed LLM output can never produce an infinite loop.
  - `src/core/taskScheduler.ts`: `TaskScheduler` class topologically sorts the DAG into execution batches (Kahn's BFS), runs each batch with `Promise.all`, caps fan-out at `MAX_CONCURRENCY = 5`, and forwards completed task output as dependency context to downstream tasks. Fires a typed `SchedulerProgress` callback after every subtask.
  - `Orchestrator.processProject(goal, constraints, onProgress?)` — orchestrates the full flow: plan → parallel execution via ephemeral role-based sub-agents → LLM synthesis → `ProjectResult`. Sub-agents are synthesised from `SubTask.role` (one of: architect, backend-engineer, frontend-engineer, tester, documentation-writer, devops, data-engineer, security-reviewer, general-assistant) and never touch the `AgentRegistry`.
  - `Orchestrator.processTaskWithAgent(request, agent)` — new public method extracted from `processTask`; allows the executor to bypass agent selection and use any `AgentDefinition` directly.
  - Parallel tool calls in `runAgenticLoop`: the sequential `for...of` loop over `toolCalls` is replaced with `Promise.all`, so multiple skills in a single model turn now execute concurrently.
- New types in `src/types.ts`: `SubTask`, `SubTaskStatus`, `SubTaskResult`, `ProjectPlan`, `ProjectResult`, `ProjectProgressUpdate` (discriminated union: `planned | subtask-start | subtask-done | synthesizing | error`).
- `/project` chat slash command in `@atlas` participant — streams `planned` (markdown task table), per-task progress and output, and the final synthesised report.
- 12 new unit tests in `tests/core/planner.scheduler.test.ts` covering `removeCycles`, `buildExecutionBatches`, and `TaskScheduler` (dependency forwarding, progress callbacks, failure handling).

### Changed
- `Orchestrator.processTask` refactored to delegate to `processTaskWithAgent` — no behaviour change for existing callers.

## [0.6.0] - 2026-04-03

### Added
- **MCP Integration** — AtlasMind can now connect to any [Model Context Protocol](https://modelcontextprotocol.io/) server and expose its tools as AtlasMind skills.
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
  - `blocked` status (error-level hits) removes the entry from `queryRelevant` entirely — it is never sent to the model.
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

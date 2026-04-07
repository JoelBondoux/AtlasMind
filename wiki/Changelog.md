# Changelog

This page highlights major releases. For the complete changelog, see [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) in the repository.

---

## v0.42.13 — Auto-Merge And Tag-Driven Releases

- Streamlined the release path so the release workflow now opens or reuses the `develop` to `master` PR, enables auto-merge, tags the merged `master` version, and publishes Marketplace releases from that version tag

## v0.42.12 — Lighter Solo-Maintainer Branch Flow

- Simplified the branch policy so `develop` stays the direct integration branch for routine pushes, while `master` remains the PR-only promotion branch for intentional release publication

## v0.42.11 — Managed Chat Terminals Respect Approval Flow

- Removed the extra `atlasmind.allowTerminalWrite` hard gate from managed chat-terminal aliases such as `@tcmd` and `@tps`, so those launches now go through the normal risk classification and approval flow instead of failing before approval can run

## v0.42.10 — Centered Chat Layout And Bare Alias Fix

- Corrected the centered Atlas chat webview layout so the composer stays under the transcript instead of becoming a right-hand column in wide layouts, added a real collapsible Sessions rail for that wider view, and intercepted bare managed-terminal aliases like `@tcmd` so they return usage guidance instead of falling through to the routed model

## v0.42.9 — Git Alias And Explicit Unsupported Terminal Guidance

- Added `@tgit` as a managed alias for the Bash or Git Bash runner and replaced generic unknown-alias failures for JavaScript Debug Terminal and Azure Cloud Shell requests with explicit guidance about why those profile-backed or remote terminals are not supported by the current managed shell runner

## v0.42.8 — Common Managed Terminal Synonyms

- Added common synonym aliases for managed terminal launches, including full-name forms like `@tpowershell` and `@tcommandprompt`, so operators can invoke the same shell flow with more natural terminal names
- Corrected DeepSeek provider metadata to match the live API by treating `deepseek-chat` and `deepseek-reasoner` as 128K-context models, marking the reasoner route as tool-capable, and adding regression coverage for the generic OpenAI-compatible payload and tool-call parsing path

## v0.42.7 — Multi-Alias Managed Terminal Follow-Up

- Expanded managed terminal chat launches to support multiple shell aliases such as `@tpwsh`, `@tbash`, and `@tcmd`, and let AtlasMind request at most one additional approval-gated command in the same shell session before emitting the final terminal summary

## v0.42.6 — Managed Terminal Chat Launches

- Added a managed terminal launch path to the shared Atlas chat surface so prompts like `@tps Get-ChildItem` can open a PowerShell terminal, stream its output back into the conversation, and hand the result back to AtlasMind for follow-up reasoning while still honoring terminal-write approval rules

## v0.42.5 — Composite Sidebar Home View

- Replaced the top Quick Links strip with a composite Home sidebar surface that groups shortcuts, recent sessions, autonomous runs, and workspace status into internal accordion sections with remembered manual heights

## v0.42.4 — Chat Composer Stop Button

- Added a Stop action to the shared Atlas chat composer so an in-flight chat turn can be canceled directly from the input panel without waiting for the full response loop to finish

## v0.42.3 — Chat Composer Prompt History

- Added CLI-style prompt history navigation to the shared Atlas chat composer so pressing Up or Down at the start or end of the input recalls recent submitted prompts without breaking multiline editing

## v0.42.2 — Docker Tooling Skill

- Added a dedicated built-in `docker-cli` skill so AtlasMind can inspect containers and run controlled Docker Compose lifecycle operations through a strict allow-list instead of generic terminal passthrough
- Classified Docker tool calls as terminal-read or terminal-write based on the requested Docker or Docker Compose action so approval prompts match the operational risk

## v0.42.1 — Sidebar Collapse-All Action

- Added a sidebar-container action that runs Collapse All across the AtlasMind tree views so the title overflow menu can fold the operational trees back down in one step

## v0.42.0 — Claude CLI Beta Provider

- Added a Claude CLI (Beta) routed provider that reuses a locally installed Claude CLI login through constrained print-mode execution in both the extension host and the AtlasMind CLI
- Labeled the new Claude CLI integration as Beta across provider setup, routing metadata, and the model-management docs and UI

## v0.41.33 — In-Chat Tool Approvals

- Replaced the modal OS-level tool approval prompt with an in-chat AtlasMind approval card so Allow Once, Bypass Approvals, Autopilot, and Deny decisions now happen inside the shared chat workspace

## v0.41.32 — Always-On Workspace Identity Prompt

- Added an always-on workspace identity prompt that combines the saved Atlas Personality Profile with a compact `project_soul.md` summary so every chat turn stays grounded in both operator preferences and project identity

## v0.41.31 — More Proactive Tool Use In Chat

- Made AtlasMind's default chat agent more proactive for fix-oriented requests by injecting a stronger execution bias toward workspace tool use and re-prompting once when action-oriented turns answer with speculation instead of touching the repo

## v0.41.30 - Quick Links Default Order Fix

- Fixed AtlasMind's sidebar initialization so the Quick Links strip now registers before the tree views and appears ahead of Project Runs in fresh default layouts

## v0.41.25 — Sidebar Quick Links Strip

- Added a top-anchored Quick Links strip to the AtlasMind sidebar so the Project Dashboard, Ideation board, Run Center, Cost Dashboard, Model Providers, and Settings are available as compact icon buttons directly under the container title
- Made top-right hero summary chips across the provider, specialist, agent, MCP, webhook, voice, vision, and settings webviews interactive where they map to a concrete page or filter, with hover/focus tooltips where the chip is explanatory only
- Added full catalog views to the Model Providers and Specialist Integrations panels so status chips can jump to the relevant records instead of landing on an arbitrary subsection

## v0.41.24 — Clearer Local Provider Model Labels

- Clarified the Local provider info summary so AtlasMind labels its routed model catalog separately from the live engine models currently loaded by the local runtime

## v0.41.23 — Local Engine Model Inventory In Provider Info

- Added the live local engine model inventory to the Local provider info summary so the sidebar info action now shows which models are currently loaded in the connected engine

## v0.41.22 — Tool-Backed Local Runtime Checks

- Expanded AtlasMind's workspace-investigation routing so localhost, port, and Ollama verification prompts are biased toward actual tool use instead of speculative analysis

## v0.41.21 — Local Provider Config Detection Fix

- Fixed AtlasMind's local provider status checks so the Local Model provider now recognizes the `atlasmind.localOpenAiBaseUrl` workspace setting in summaries, tree state, and local provider configuration prompts

## v0.41.20 — Stable Marketplace Publishing With Beta Branding

- Switched AtlasMind's Marketplace publishing flow back to the standard release channel while keeping Beta branding in the documentation until `1.0.0`

## v0.41.19 — Staged Run Continuity And Legacy History Adoption

- Fixed staged Project Run Center continuation drafts so later planner jobs still split on dependency-safe boundaries when earlier stages already completed prerequisite subtasks
- Adopted legacy unstamped run-history entries into the active workspace so older saved runs remain visible after the workspace-scoped storage upgrade
- Clarified the current Marketplace badge and publishing guidance so AtlasMind remains clearly prerelease-only before `1.0.0`

## v0.41.18 — Staged Project Run Jobs

- Added staged planner-job execution for large Project Run Center drafts so Atlas can execute the first dependency-safe slice, persist seed outputs, and queue the remaining scope as the next preview
- Scoped project run history to the active workspace, added non-running run deletion, and updated the Project Run Center docs and regressions for the new continuation flow

## v0.41.17 — Solo Maintainer Branch Protection Docs

- Updated the workflow and contributing docs to match the live `master` protection setup for this solo-maintainer repo: PR-only merges with required CI, but no mandatory approving review or CODEOWNERS gate

## v0.41.16 — Milestone Review Prompt Regression

- Added a focused runtime regression for milestone-tracking review prompts so Atlas stays pinned to reviewer guidance that calls for creating the smallest missing regression spec instead of only warning about missing coverage

## v0.41.15 — Explicit Test Creation For TDD

- Tightened AtlasMind's tests-first execution prompts so freeform and `/project` code work explicitly create the smallest missing regression test or spec when suitable coverage does not already exist
- Added regression coverage for the built-in agent prompts plus the freeform and `/project` TDD gate wording so Atlas keeps nudging toward creating the missing spec instead of only reporting the gap

## v0.41.14 — Review Follow-up Hardening

- Fixed Bedrock SigV4 request-path encoding so configured model IDs are signed correctly
- Hardened CLI workspace path validation against symlink escapes before file reads or writes proceed
- Isolated autopilot listener failures, reused memory classification metadata during indexing, expanded router regression coverage, and removed repo-committed safety relaxations

## v0.41.13 — Release CI Repair

- Fixed the promotion-branch CI failures by cleaning up the lint issues that blocked the cross-platform quality workflow

## v0.41.12 — README Beta Title

- Restored the README title so AtlasMind's current beta status is visible in the main heading

## v0.41.11 — Wiki Messaging Alignment

- Mirrored the README's safety-first and red/green TDD-oriented product positioning into the main wiki entry pages so onboarding and reference surfaces open with the same message

## v0.41.10 — README Safety And TDD Positioning

- Updated the README to foreground safety-first execution, security-minded controls, and red/green TDD-oriented autonomous development
- Reintroduced a small comparison table focused on AtlasMind's biggest selling points

## v0.41.9 — Documentation Tightening

- Rewrote the README to be shorter, clearer, and more value-focused for both new and experienced developers
- Corrected doc and wiki drift around skill counts, exact command names, and sidebar surface descriptions

## v0.41.8 — Source-Backed Memory Retrieval

- Promoted SSOT memory from a snippet-only retrieval layer into a source-backed evidence system by storing document class, evidence type, and import source pointers on indexed memory entries
- Updated ranking so exact or current-state queries prefer fresher source-backed notes over generated index pages
- Taught the orchestrator to include live source excerpts alongside memory summaries when a request needs current or exact workspace state

## v0.41.7 — Smaller Chat Font Steps

- Extended the embedded Atlas chat font-size range with three additional smaller `A-` steps so chat bubbles can scale down to 70% of the default size while keeping the existing controls and session persistence behavior

## v0.41.6 — Chat Paste And Drop Media Ingestion

- Added browser-side paste and drag-drop media ingestion for the embedded Atlas chat panel so clipboard screenshots and dropped local files can be attached without requiring a workspace file path
- Extended the chat-panel attachment pipeline to accept serialized inline files, turning pasted images and dropped media into ordinary prompt attachments inside the composer

## v0.41.5 — Chat Font Size Controls

- Added compact `A-` and `A+` controls to the embedded Atlas chat panel so operators can shrink or enlarge chat-bubble typography without affecting the rest of the panel UI
- Persisted the chosen chat font scale in the webview state so the preferred text size survives panel refreshes during the same session

## v0.41.4 — Chat Markdown And Softer Thinking Notes

- Rendered embedded Atlas chat assistant responses as safe markdown so headings, lists, emphasis, code spans, code fences, blockquotes, and links display with structure instead of raw markup
- Restyled streamed Thinking notes and the collapsible thinking-summary body to use a slightly smaller, lower-contrast treatment so reasoning cues stay readable without overpowering the main response

## v0.41.3 — Score Cards To Action Prompts

- Made Project Dashboard outcome-completeness tiles and operational-score recommendation cards open Atlas chat with drafted action prompts so operators can move directly from a weak signal to a concrete first-pass task
- Extended the Atlas chat panel target contract so dashboard and other surfaces can prefill the composer with a drafted prompt instead of only deep-linking by session

## v0.41.2 — Canvas Navigation And Chat Loader Pivot Fix

- Expanded the Project Ideation canvas with a viewport-fill mode, click-drag panning, and edge glows so larger boards remain navigable when cards sit outside the visible frame
- Added link selection and editing inside Project Ideation so relationship labels, line styles, arrow directions, and deletes can all happen from the inspector
- Fixed inline ideation card editing by moving card interaction off nested button markup and making the second-click edit gesture reliable inside the live canvas

- Fixed the embedded Atlas chat thinking-logo globe so its rotating axis group now spins around the shared SVG viewbox center instead of drifting apart during the loop
- Added regression coverage for the loader pivot contract so future animation tweaks keep the globe aligned

## v0.41.1 — Ambiguous Bug Follow-Up Choices

- Added ambiguity-aware follow-up choices for concrete repo-local diagnostics so AtlasMind can answer first and then offer Fix This, Explain Only, and Fix Autonomously instead of assuming execution
- Extended the embedded Atlas chat panel to persist and render those follow-up chips inside assistant bubbles so the sidebar chat matches native `@atlas` follow-up behavior

## v0.41.0 — Dedicated Ideation Dashboard

- Refactored Project Ideation into its own dedicated dashboard so the whiteboard opens directly from the Project Dashboard, Project Runs view, and Project Run Center
- Added drag-and-drop and paste ingestion for files, links, and images so ideation media can feed the next Atlas pass or land directly inside a board card
- Added inline double-click card editing on the canvas while keeping the side inspector for structured edits

## v0.40.3 — Embedded Chat Height Fix

- Fixed the embedded Atlas chat panel to use container-relative height and zero shell padding so the sidebar chat no longer grows taller than its allocated view and hide the Sessions rail
- Added regression coverage for the chat webview sizing contract so future shell-style changes do not reintroduce the overflow

## v0.40.2 — Ideation Onboarding And Deep-Link Coverage

- Added ideation promotion to the onboarding walkthrough and Project Runs welcome state so the whiteboard is easier to discover before `/project` execution
- Added focused test coverage for the Project Dashboard ideation deep-link path

## v0.40.1 — Direct Ideation Entry Points

- Added a dedicated `AtlasMind: Open Project Ideation` command that opens the Project Dashboard directly on the Ideation page
- Added ideation shortcuts to the Chat and Project Runs sidebar title bars so the whiteboard is one click away from AtlasMind's main execution surfaces

## v0.40.0 — Project Ideation Whiteboard

- Added a guided ideation workspace to the Project Dashboard with a collaborative whiteboard canvas, draggable cards, connection lines, focus selection, and persisted board state
- Added a multimodal Atlas ideation loop with voice capture, response narration, and optional image attachments that can shape the next facilitation pass
- Stored ideation board state in `project_memory/ideas/` as both JSON and markdown so project ideation history can be revisited outside the live panel

## v0.39.28 — Live Thinking Updates And Loop Nudges

- Added live freeform execution progress updates in chat so AtlasMind now shows interim thinking-style notes while tool-heavy requests are still running
- Added a read-only exploration nudge in the orchestrator so repeated search-only tool loops are pushed to summarize likely cause and fix before they hit the 10-iteration safety cap
- Improved task profiling for chat-panel UI regressions so sidebar, dropdown, scroll, panel, and webview prompts are treated as code work instead of plain text

## v0.39.27 — Red-To-Green Status In Chat

- Inferred the tests-first write gate for ordinary freeform implementation tasks as well as `/project` subtasks, so AtlasMind now blocks implementation writes until a failing relevant test signal is established when the request looks like a testable code change
- Added a red-to-green status cue to the chat Thinking summary so verified, blocked, missing, and not-applicable TDD states are visible directly in chat instead of being buried in verification prose

## v0.39.26 — Dashboard TDD Posture

- Added a Project Dashboard runtime TDD summary so operators can review aggregate verified, blocked, missing, and not-applicable `/project` outcomes without opening the Project Run Center first
- Added per-run TDD labels to the Project Dashboard recent-runs list so autonomous runs blocked by the failing-test gate stand out immediately

## v0.39.25 — Folder-Aware Memory Tree

- Reworked the Memory sidebar into a folder-aware tree so SSOT storage folders stay visible and indexed notes are grouped beneath their storage paths instead of one flat list
- Kept stale-memory warnings and inline memory actions intact while making larger memory sets easier to discover by area

## v0.39.24 — Enforced Project TDD Gates

- Enforced a failing-test-before-write gate for testable `/project` implementation subtasks so AtlasMind holds non-test implementation writes until it has observed a relevant red signal
- Expanded autonomous project subtasks to use test execution and workspace observability skills so AtlasMind can establish and verify that red signal during execution
- Added persisted per-subtask TDD telemetry and surfaced it in the Project Run Center so operators can review verified, blocked, missing, and not-applicable TDD states

## v0.39.22 — Enforced Project TDD Gates

- Added a hard `/project` TDD gate for testable implementation subtasks so AtlasMind blocks non-test implementation writes until it has observed a failing relevant test signal
- Expanded planner subtask skills to include test execution and workspace observability tools, allowing AtlasMind to establish that red signal autonomously instead of only describing it
- Added per-subtask TDD telemetry to persisted run artifacts and surfaced that status in the Project Run Center so operators can review whether each subtask was verified, blocked, missing evidence, or not applicable

## v0.39.21 — Freeform TDD Built-In Agents

- Extended the new tests-first policy from autonomous `/project` execution into the stock freeform built-in agents so AtlasMind now prefers TDD-style verification in normal chat as well
- Tuned the built-in debugging, frontend, backend, and review prompts so they demand failing-to-passing evidence or an explicit explanation when direct TDD is not practical

## v0.39.20 — Stock Developer Built-In Agents

- Added a stock developer-focused built-in set for freeform routing, including Workspace Debugger, Frontend Engineer, Backend Engineer, and Code Reviewer alongside the default fallback agent
- Kept the built-in specialists on the shared enabled skill pool so routing can benefit from distinct developer behaviors without fragmenting tool access

## v0.39.19 — Autonomous TDD Project Runs

- Updated autonomous `/project` planning so code-changing goals bias toward test-first subtasks, with implementation work depending on regression-capture or test-authoring steps where applicable
- Added a shared TDD execution contract to ephemeral project sub-agents so AtlasMind now prefers a red-green-refactor loop, reports verification evidence, and explains when direct TDD is not applicable
- Surfaced the tests-first delivery policy in the `/project` preview and refreshed the planner and command documentation to describe the new autonomous behavior

## v0.39.18 — Provider Failure Badges In The Webview

- Extended the Model Providers webview to show provider-level warning badges when routed models from that provider have failed in the current session
- Added an overview summary count for providers with failed models so failure state is visible in both the Models tree and the provider-management workspace

## v0.39.17 — Active Provider Pooling And Failure Warnings

- Refreshed all enabled providers at startup, including GitHub Copilot, so AtlasMind builds its live model pool from the active providers instead of deferring interactive providers until manual activation
- Switched agent execution, escalation, and failover to use the active candidate pool directly, removing failed models from routing until the next successful refresh instead of silently dropping back to `local/echo-1`
- Added failed-model warning state in the Models sidebar so users can see which routed models faulted and inspect the latest failure details in the tooltip

## v0.39.16 — No Local Echo Downgrade

- Prevented provider failover and escalation helpers from silently falling back to `local/echo-1` when the remaining models no longer satisfy required capabilities such as `function_calling`
- Workspace-investigation requests that exhaust capable providers now fail explicitly instead of returning a misleading local echo of the user's prompt

## v0.39.15 — Faster Failure For Hung Chats

- Stopped retrying provider timeout errors, so hung chat requests fail promptly instead of sitting in the AtlasMind panel through multiple 30-second retry windows
- Preserved transient retries for actual retryable provider failures such as `429`, `5xx`, or explicitly temporary upstream errors

## v0.39.14 — Forced Workspace Investigation Retry

- Added an execution-layer retry for workspace-issue prompts so AtlasMind re-prompts once for actual workspace tool use when a model answers with "I'll search" style investigation narration instead of inspecting the repo
- Kept `local/echo-1` on the built-in offline echo path even when a local OpenAI-compatible endpoint is configured, avoiding false 404 fallbacks for the reserved local model

## v0.39.13 — Provider Model Normalization

- Normalized slash-containing upstream model IDs from OpenAI-compatible discovery and completion responses so Google Gemini models no longer surface as a fake `models` provider during routing
- Hardened provider resolution in chat execution, project planning, and command-driven model actions so router metadata wins when a model ID is not already safely prefixed

## v0.39.12 — README Cleanup And Version Clarity

- Streamlined the README so commands, sidebar actions, and configuration settings stay at the overview level and point to the dedicated reference pages instead of duplicating long tables
- Clarified version presentation by labeling the README badge as the published Marketplace release and directing branch-specific source version checks to `package.json`

## v0.39.11 — Natural-Language Command Escalation

- Added natural-language escalation so Atlas chat can recognize prompts like "start a project run to ..." and route them into autonomous `/project` execution
- Added high-confidence panel-opening intents so chat can open AtlasMind Settings, the Cost Dashboard, Model Providers, the Project Run Center, and related Atlas surfaces without requiring the explicit slash or command id

## v0.39.10 — Routing Heuristics And Trace

- Strengthened agent selection with common software-development routing heuristics for debugging, testing, review, architecture, frontend, backend, docs, security, devops, performance, and release-oriented prompts
- Added a visible routing trace to the Thinking summary so AtlasMind now shows the selected agent, detected routing hints, and whether workspace-investigation bias was applied

## v0.39.9 — Workspace Issue Bias

- Added a workspace-issue heuristic to freeform chat so bug-report style prompts inject an extra inspect-the-repo-first hint into the default agent context
- Further reduced the chance of support-style replies for concrete AtlasMind UI or behavior regressions by biasing the model toward workspace evidence before answering

## v0.39.8 — Default Agent Execution Bias

- Strengthened the default AtlasMind agent prompt so freeform chat treats repo bug reports as workspace tasks to inspect and act on instead of replying like a support-triage bot
- Kept the default fallback agent on the full enabled skill set while explicitly biasing it toward repository investigation and execution when tools would help

## v0.39.7 — Sidebar Summaries In Chat

- Added a real MCP Servers sidebar tree with live status and tool-count rows for configured MCP connections
- Added chat-summary info actions for Skills and MCP Servers
- Switched the Memory, Agent, and Model sidebar info actions to post assistant-style summaries into the active Atlas chat session instead of using transient notifications or external docs

## v0.39.6 — Sidebar Default Order

- Reordered the default AtlasMind sidebar tree views to Project Runs, Sessions, Memory, Agents, Skills, MCP Servers, and Models
- Set those tree views to ship collapsed by default while keeping stable view ids so VS Code continues remembering each user's custom order and open-state preferences
- Added session archiving across the shared chat panel and Sessions sidebar, including a dedicated Archive bucket in the Sessions tree
- Added drag-and-drop archive and restore support so stored sessions can move into Archive and back into the live tree or folder targets
- Replaced live-session text actions in the chat panel with compact archive and delete icon buttons

## v0.39.6 — Sidebar Quick Actions

- Added title-bar shortcuts for Settings, Project Dashboard, and Cost Dashboard across the Chat, Sessions, and Memory sidebar views
- Switched the project-memory toolbar action between `Import Existing Project` and `Update Project Memory` based on whether AtlasMind has detected workspace SSOT state

## v0.39.4 — Command Naming Guardrails

- Hid the remaining unprefixed session actions from the Command Palette and added a manifest-level guard so unprefixed command titles stay view-local
- Split the README command reference into explicit Command Palette and Sidebar Actions sections

## v0.39.3 — Command Surface Cleanup

- Hid sidebar-only actions from the Command Palette so palette-visible AtlasMind commands stay reserved for top-level entry points
- Split the command docs between palette-facing AtlasMind commands and view-local sidebar actions

## v0.39.2 — Persistent Memory Drift Signal

- Added a pinned warning row at the top of the Memory tree so stale imported SSOT remains visible while browsing entries
- Treated legacy `#import` SSOT files without Atlas metadata trailers as stale imported memory so older projects also surface the refresh signal

## v0.39.2 — Skills Panel Folders

- Grouped built-in skills into sidebar categories so the bundled set no longer expands as one flat list
- Added persistent custom skill folders, including a Skills title-bar `Create Skill Folder` action and folder-aware add/import flows
- Added `F2` rename support for highlighted chat-session rows in the Sessions sidebar

## v0.39.0 — Filed Session Sidebar

- Added persistent folders to the Sessions sidebar so related chat threads can be filed together instead of staying in one flat list
- Added an inline rename action on each session row plus move-to-folder and create-folder commands in the Sessions tree
- Moved the optional `Import Existing Project` toolbar shortcut from the Sessions view to the Memory view

## v0.38.22 — Cost Dashboard Visual Refresh

- Reworked the Cost Dashboard to share the Project Dashboard's stronger visual language with a cleaner shell, animated metric cards, a more professional budget meter, and upgraded model and feedback panels
- Replaced the old checkbox and numeric day input with a topbar visibility toggle and chart-overlay time-range controls inside the Daily Spend panel
- Tightened summary-card layout so the primary spend metrics stay on one row instead of wrapping into a cluttered grid

## v0.38.21 — Responsive Chat Sessions Rail

- Made the shared Atlas chat Sessions area responsive so it remains a top strip in narrow layouts and becomes a persistent left sidebar when the webview reaches 1000px wide

## v0.38.20 — Dashboard Settings Compatibility

- Fixed the Project Dashboard refresh path so array-backed `autoVerifyScripts` settings from AtlasMind Settings no longer break the dashboard security snapshot
- Added regression coverage for the dashboard configuration compatibility path

## v0.38.19 — Inline Chat Feedback Controls

- Moved assistant-response vote controls onto the same footer row as the thinking summary and aligned them to the right edge of the bubble
- Replaced emoji-style thumbs with compact outlined thumb icons for a quieter chat UI

## v0.38.18 — Feedback-Aware Cost Dashboard

- Added Cost Dashboard feedback analytics showing per-model approval rate, thumbs totals, and spend on rated models
- Added `atlasmind.feedbackRoutingWeight` so thumbs-based routing bias can be disabled or tuned without clearing vote history
- Updated recent-request rows to show the recorded feedback state for each linked assistant response

## v0.38.17 — Chat Session Header Fit

- Tightened the shared Atlas chat Sessions header so the new-session control stays inline with the label and no longer pushes the collapsible bar partly out of view

## v0.38.16 — Cost To Chat Deep Links

- Added session-aware links from Cost Dashboard recent-request rows back to the matching chat transcript entry when the session still exists
- Stored optional chat session and message references with cost records so AtlasMind can reopen the exact assistant response that produced a charge

## v0.38.14 — Memory Freshness Signals

- Added startup SSOT freshness checks for imported workspaces so AtlasMind can warn when generated memory has drifted behind the codebase
- Added an `Update Project Memory` Memory-view action that reruns the import pipeline against the latest workspace state
- Fixed import body fingerprint normalization so unchanged generated files are not treated as manually edited or permanently stale on later refreshes

## v0.38.13 — Cost Dashboard Polishing

- Sent the Cost Dashboard budget shortcut to Settings → Overview with a budget-focused query instead of reopening the last active settings page
- Clarified the recent-requests table so the final column is explicitly the per-message request cost

## v0.38.11 — Dashboard Reliability And Access

- Fixed the Project Dashboard loading path so git timeline collection no longer stalls the panel and failures render a visible error state instead of hanging on the loading screen
- Added a direct Project Dashboard action to the AtlasMind sidebar chat view title bar
- Restored clean TypeScript compilation after the project-memory bootstrap refactor left import-scan metadata incomplete

## v0.38.10 — Subscription-Aware Cost Tracking

- Added subscription-aware cost accounting so only direct and overflow-billed requests count toward the daily budget while included subscription usage remains visible for analysis
- Upgraded the Cost Dashboard with adjustable day windows, an exclude-subscriptions toggle, and explicit per-request billing labels

## v0.38.7 — Runtime Extensibility And Project Dashboard

- Added an explicit shared-runtime plugin API with lifecycle events and plugin contribution manifests for extension-host and CLI integrations
- Added the AtlasMind Project Dashboard surface with interactive pages for repo health, runtime state, SSOT coverage, security posture, delivery workflow, and review-readiness signals
- Hardened CLI argument parsing and expanded the architecture, development, contribution, and wiki guidance for runtime extensibility, diagnostics, and operational review

## v0.38.6 — Final Observability Sync

- Synced the `v0.38.x` roadmap branch with the newly merged workspace-observability base changes so the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the latest `develop` head

## v0.38.5 — Final Roadmap Branch Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` EXA search, workspace observability, and settings-documentation updates while preserving the terminal-reader, extensions/Ports, cost dashboard, and ElevenLabs feature work

## v0.38.4 — Settings Docs Sync

- Synced the `v0.38.x` roadmap branch with the latest `develop` settings-documentation updates so it stays mergeable on top of the new configuration hover-help work

## v0.38.3 — Roadmap Branch Re-Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` observability changes while preserving its terminal-reader, extension, Ports, dashboard, and ElevenLabs feature work

## v0.38.2 — CI Workflow Repair

- Removed duplicate `if` keys from the CI workflow coverage steps so the `v0.38.x` roadmap branch can execute GitHub Actions normally again after the develop sync

## v0.38.1 — Roadmap Branch Sync

- Synced the `v0.38.0` roadmap-completion branch with the latest `develop` fixes so the extension-skill, terminal-reader, Ports, cost dashboard, and ElevenLabs work remains mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.38.0 — Roadmap Goals Resolved

- **Terminal session readers** — new `terminal-read` skill and `getTerminalOutput()` context method; informs AtlasMind which terminals are open and guides the user to paste content.
- **Test result file parsing** — `workspace-state` skill now parses JUnit XML and Vitest/Jest JSON result files and includes pass/fail counts and coverage percentages in the workspace snapshot.
- **VS Code Extensions skill** (`vscode-extensions`) — lists installed extensions with version and active state, tags top-50 popular extensions, filters by name, and reports forwarded ports from the VS Code Ports panel.
- **Cost Management Dashboard** (`atlasmind.openCostDashboard`) — full-page webview with daily spend bar chart, per-model cost breakdown, budget utilisation bar, and recent-requests table.
- **ElevenLabs TTS integration** — Voice Panel now uses ElevenLabs server-side audio synthesis when an API key is configured; falls back to Web Speech API.

## v0.37.4 — Workspace Observability

- Added the `workspace-observability` built-in skill plus the supporting debug-session, terminal, and test-result host hooks with safe CLI fallbacks
- Hardened the observability path so missing host hooks degrade safely and test-result output remains bounded

## v0.37.3 — Settings Docs Sync

- Synced the `v0.37.x` feature branch with the latest `develop` settings-documentation updates so the EXA search, observability, and CLI subcommand work stays mergeable on top of the new configuration hover-help changes

## v0.37.2 — EXA And Observability Branch Sync

- Synced the `v0.37.0` feature branch with the latest `develop` fixes so the EXA search, observability, and CLI subcommand work stays mergeable on top of the newer review-cleanup and lint-gate repairs

## v0.37.0 — Observability, EXA Search & CLI Dev Subcommands

- EXA AI search specialist runtime (`exa-search` skill)
- Debug session inspector skill (`debug-session`)
- Workspace state skill (`workspace-state`)
- CLI `build`, `lint`, and `test` subcommands with `--dry-run`, `--fix`, and `--watch` flags
- Amazon Bedrock model catalog expanded with 16 additional entries

## v0.36.26 — Lint Gate Repair

- Replaced non-reassigned `let` declarations in the orchestrator task-attempt path so `develop` passes the current lint gate again

## v0.36.25 — Review Cleanup Follow-up

- Removed the duplicate Tool Webhooks command entry from the wiki command reference and normalized provider registry indentation to the repo's standard TypeScript style

## v0.36.24 — Review Follow-up Fixes

- Repaired the Project Run Center webview string assembly so its preview, run summary, and artifact views no longer generate invalid JavaScript
- Restored a nonce-only script policy for shared webviews, fixed broken CLI wiki links, and normalized the duplicated `v0.36.4` changelog history

## v0.36.23 — Workspace Observability Compatibility Fix

- Added safe CLI fallback implementations for workspace observability context methods so the shared `SkillExecutionContext` contract is satisfied outside the VS Code host
- Adjusted workspace observability test-results access so the extension compiles cleanly even when the typed VS Code API surface does not expose a stable `testResults` property

## v0.36.22 — Workspace Observability Skill

- Added `workspace-observability` built-in skill: snapshots the active debug session, open integrated terminals, and most recent test run results in one call
- Added `getTestResults()`, `getActiveDebugSession()`, and `listTerminals()` to `SkillExecutionContext`, backed by `vscode.tests`, `vscode.debug`, and `vscode.window.terminals`

## v0.36.21 — Extension Interoperability Roadmap

- Expanded the roadmap to cover interoperability with the top 50 commonly used VS Code developer extensions, their interface surfaces such as Output and Terminal, Ports view support, and explicit safety boundaries for extension interaction

## v0.36.20 — CI Artifact Upload Fix

- Restricted CI coverage generation and coverage artifact upload to the Ubuntu matrix leg, preventing duplicate artifact-name conflicts while preserving compile, lint, and test coverage across Ubuntu, Windows, and macOS
- Updated the developer-facing docs to reflect the actual CI matrix behavior and Ubuntu-only coverage artifact publishing path

## v0.36.19 — CI Repair Follow-up

- Fixed the lint and TypeScript issues that were blocking CI on the protected develop-to-master promotion path

## v0.36.18 — Observability Roadmap Additions

- Added roadmap items for workspace observability, debug-session integration, and safe output or terminal readers so AtlasMind can eventually reason over more of the active VS Code environment

## v0.36.17 — Workstation-Aware Responses

- AtlasMind now includes workstation context in routed prompts so responses can default to the active environment, including Windows and PowerShell guidance inside VS Code when appropriate
- Added regression coverage for workstation-aware prompt context in native chat and orchestrator message building

## v0.36.16 — Provider Failover

- AtlasMind now fails over to another eligible provider when the initially selected provider errors or is missing, instead of ending the task immediately on the first provider failure
- Added orchestrator regression coverage for cross-provider failover after provider-side errors

## v0.36.15 — OpenAI Fixed-Temperature Compatibility

- OpenAI modern chat payloads now omit `temperature` for fixed-temperature model families such as GPT-5 and the `o`-series, preventing request failures on models that reject that parameter
- Added regression coverage to keep OpenAI modern, Azure OpenAI, and generic compatible providers on the correct parameter contract

## v0.36.14 — Early Difficulty Escalation

- AtlasMind now detects repeated tool-loop struggle signals and can reroute once to a stronger reasoning-capable model instead of spending the full loop budget on a failing route
- Added regression coverage for bounded mid-task model escalation after repeated failed tool calls

## v0.36.13 — Grounded Version Answers

- AtlasMind now answers version questions from the root `package.json` manifest instead of depending on model inference
- If the manifest is unavailable, AtlasMind falls back to SSOT memory so repo-fact answers still come from grounded project context

## v0.36.12 — Provider-Specific OpenAI Compatibility

- Split OpenAI-family payload handling by provider so OpenAI and Azure use `developer` plus `max_completion_tokens`, while generic OpenAI-compatible endpoints retain `system` plus `max_tokens`
- Added regression tests to lock the expected contract for OpenAI, Azure OpenAI, and third-party OpenAI-compatible providers

## v0.36.11 — OpenAI-Compatible Token Parameter Fix

- Updated OpenAI-compatible request payloads to send `max_completion_tokens` instead of `max_tokens`, resolving 400 errors from models that reject the legacy parameter
- Added regression coverage to verify AtlasMind no longer emits `max_tokens` in OpenAI-style chat completion requests

## v0.36.10 — Terminal Tool Schema Validation Fix

- Fixed the built-in `terminal-run` tool schema so `args` is declared as an array of strings, resolving chat failures from OpenAI function schema validation
- Added a regression test to keep the terminal tool schema compatible with function-calling providers

## v0.36.6 — CLI Safety Gate And Narrower SSOT Auto-Load

- AtlasMind CLI now allows read-only tools by default, requires an explicit `--allow-writes` flag before workspace or git writes are permitted, and blocks external high-risk tools in CLI mode
- Startup SSOT auto-load now trusts only the configured SSOT path or the default `project_memory/` folder instead of treating workspace-root marker folders as sufficient
- Added regression tests covering CLI tool gating and the tightened startup SSOT detection boundary

## v0.36.5 — Import Freshness And Memory Purge Safeguards

- `/import` now records generator metadata, skips unchanged generated files on repeat imports, and preserves imported SSOT files that were manually edited
- AtlasMind now generates both `index/import-catalog.md` and `index/import-freshness.md` so memory refresh status stays reviewable
- The Project Settings page now exposes a destructive memory-purge action protected by a modal confirmation plus a required `PURGE MEMORY` confirmation phrase

## v0.36.4 — MCP, Voice, And Vision Workspaces

- Reworked the MCP Servers, Voice, and Vision panels into the same searchable multi-page workspace pattern used by AtlasMind Settings and the other admin surfaces
- Added richer sidebar empty-state links so sessions, models, agents, MCP, and project runs can jump directly to the matching panel or settings page

## v0.36.3 — Richer Project Import Baseline

- Expanded `/import` so it generates a deeper SSOT baseline from manifests, docs, workflow/security guidance, and a focused codebase map
- Import now upgrades the starter `project_soul.md` template when it is still blank so Atlas begins with a more useful project identity

## v0.36.2 — Deep-Linked Panel Workspaces

- Reworked the Agent Manager and Tool Webhooks panels into searchable multi-page workspaces consistent with AtlasMind Settings and the provider surfaces
- Added page-specific settings commands so sidebar actions and walkthrough steps can open the exact chat, models, safety, or project settings page directly

## v0.36.1 — Searchable Provider Workspaces

- Reworked the Model Providers and Specialist Integrations panels into searchable multi-page workspaces with grouped cards instead of single dense tables
- Added deep-linkable AtlasMind Settings navigation so provider surfaces can reopen Settings directly on the Models page

## v0.36.0 — Shared Runtime And CLI

- Added a compiled `atlasmind` CLI with `chat`, `project`, `memory`, and `providers` commands backed by the same orchestrator and SSOT memory pipeline as the extension
- Introduced a shared runtime builder plus Node-hosted memory, cost, and skill-context adapters so AtlasMind can run outside the VS Code host without forking core logic

## v0.35.15 — Accessible Settings Workspace

- Reworked AtlasMind Settings into a multi-page workspace with a persistent section nav instead of a long collapsible form
- Added faster in-panel shortcuts to the embedded Chat view, detached chat panel, provider management, and specialist integrations

## v0.35.12 — Startup SSOT Auto-Load

- AtlasMind now auto-detects and loads an existing workspace SSOT during startup when the configured `atlasmind.ssotPath` is missing
- The Memory sidebar now refreshes immediately after startup indexing so existing project memory appears without a manual reload

## v0.35.5 — Models Tree Refresh Action

- Added a refresh action on configured provider rows in the Models sidebar so routed model catalogs can be refreshed directly where missing models are noticed

## v0.35.4 — Follow-Up Routing Escalation Fix

- Adjusted routing so important thread-based follow-up turns can escalate away from weak local models instead of being dominated by zero-cost local scoring
- Updated the task profiler and router scoring so high-stakes conversation follow-ups can favor stronger reasoning-capable models when appropriate

## v0.35.3 — Memory Sidebar Edit And Review Actions

- Added inline edit and review actions to Memory sidebar entries so SSOT files can be opened directly or summarized before editing

## v0.35.2 — Get Started Chat Shortcut Fix

- Added a working `Ctrl+Alt+I` (`Cmd+Alt+I` on macOS) shortcut for `AtlasMind: Open Chat Panel`
- Updated the Get Started walkthrough chat buttons to open the AtlasMind chat panel directly

## v0.35.1 — Sidebar Settings Shortcut And Optional Import Action

- Added an AtlasMind Settings entry to the overflow menu of AtlasMind sidebar views so the settings panel can be opened directly from the panel itself
- Added an optional Import Existing Project toolbar action to the Sessions view, with a new `atlasmind.showImportProjectAction` setting to hide it when not wanted

## v0.35.0 — Session Workspace And Sessions Sidebar

- Upgraded the dedicated AtlasMind chat panel into a session workspace with persistent workspace chat threads and a session rail
- Added a Sessions sidebar view that lists chat sessions and autonomous runs together, with direct handoff into the Project Run Center for live run steering

## v0.34.2 — Deferred Copilot Permission Prompt

- Deferred GitHub Copilot model discovery and health checks until explicit activation so AtlasMind no longer prompts for Copilot language-model access during normal startup

## v0.34.1 — NVIDIA NIM Model Info Link Fix

- Corrected the NVIDIA NIM model info link so AtlasMind opens NVIDIA's model catalog instead of an unrelated API page

## v0.34.0 — Dedicated AtlasMind Chat Panel

- Added a dedicated AtlasMind chat panel for users who want a standalone conversation UI instead of only the built-in VS Code Chat view
- Added a Settings shortcut and command-palette entry for opening the panel

## v0.33.1 — Copilot Chat Recommendation Cleanup

- Updated the repo and bootstrap-generated VS Code extension recommendations to prefer `GitHub Copilot Chat` without also prompting for the separate `GitHub Copilot` recommendation

## v0.33.0 — Azure OpenAI, Bedrock, And Specialist Integrations

- Added routed provider support for Azure OpenAI with deployment-based workspace configuration and `api-key` authentication
- Added routed provider support for Amazon Bedrock through a dedicated SigV4-signed adapter
- Added a Specialist Integrations panel for non-routing search, voice, image, and video vendors

## v0.32.10 — Default Branch And Release Flow Hardening

- Switched the repository default branch to `develop`
- Locked `master` to the `develop` to `master` pre-release promotion flow
- Updated contributor and Copilot guidance to treat `develop` as the normal development push target

## v0.32.9 — Branch Strategy Update

- Adopted `develop` for normal integration work and reserved `master` for release-ready pre-release publishing
- Updated CI to validate both `develop` and `master`
- Updated contributing guidance and Copilot instructions to avoid routine direct work on `master`
- Fixed local provider health reporting so the built-in echo fallback remains available even without a configured local endpoint

## v0.32.7 — Mixed Provider Status Marker

- Added a bracketed warning marker for partially enabled providers in the Models sidebar while preserving the green enabled status icon

## v0.32.6 — Models Status Icon Cleanup

- Replaced visible Models sidebar status text with colored status icons
- Sorted unconfigured providers to the bottom of the Models list

## v0.32.5 — Configurable Local Provider

- Added a real configurable local provider path backed by `atlasmind.localOpenAiBaseUrl` and an optional SecretStorage API key
- Local provider setup can now be completed directly from the Models and Model Providers surfaces

## v0.32.4 — Provider Configuration And Agent Assignment

- Added inline provider configure and assign-to-agent actions in the Models sidebar
- Added model-level assign-to-agent actions for quick `allowedModels` updates
- Hid child model rows for unconfigured providers until the provider is configured

## v0.32.3 — Models Sidebar Controls

- Added inline enable/disable and info actions to provider and model rows in the Models sidebar
- Persisted provider/model availability choices so routing keeps honoring them after restarts and model catalog refreshes

## v0.32.2 — Agent Restore Activation Fix

- Removed the activation-time dependency on the Agent Manager webview so persisted user agents can be restored without loading panel UI code during startup

## v0.32.1 — Lazy Command Panel Loading

- Changed AtlasMind command handlers to lazy-load panel modules so panel-specific runtime issues cannot block command registration during activation

## v0.32.0 — Getting Started Command

- Added `AtlasMind: Getting Started` so the onboarding walkthrough can be reopened directly from the Command Palette
- Carries forward the recent Agent, Skills, and MCP panel reliability fixes in the beta channel

## v0.31.4 — Agent & Skills Panel Reliability Fixes

- Replaced CSP-blocked inline button handlers in the Manage Agents panel with explicit event bindings
- Restored the New Agent, edit, enable/disable, delete, save, and cancel actions
- Registered commands and tree views earlier in activation so Skills and MCP panel actions are available sooner
- Isolated startup registration failures so one broken surface cannot prevent command registration for the others

## v0.31.2 — Walkthrough Activation Fix

- Activated AtlasMind on startup so getting-started walkthrough buttons are available immediately after install
- Added manifest regression tests covering the provider onboarding button wiring

## v0.31.1 — Marketplace Beta Release

- Switched the extension icon from SVG to PNG for Marketplace compatibility
- Added the top-level extension icon field and updated the publisher to `JoelBondoux`
- Published the first live beta release to the VS Code Marketplace

## v0.30.5 — README Cleanup

- Streamlined the README into a shorter overview and onboarding page
- Moved detailed inventories and reference material into deeper docs and wiki pages

## v0.30.4 — CI Fixes And Wiki Refresh

- Fixed the lint issues that were failing CI and restored a passing coverage gate for the currently tested service-layer modules
- Clarified model-routing documentation around seed models, runtime catalog refresh, and metadata enrichment
- Added a funding and sponsorship wiki page and refreshed the wiki comparison content

## v0.30.3 — Copilot Chat Recommendation Restored

- Restored `GitHub Copilot Chat` in extension recommendations for the repo and bootstrap templates
- Updated setup guidance and Copilot runtime wording to point users back to `GitHub Copilot Chat`

## v0.30.2 — Copilot Dependency Cleanup

- Removed the deprecated `GitHub Copilot Chat` recommendation from the repo and bootstrap templates
- Updated setup guidance to point to the `GitHub Copilot` extension instead
- Renamed Copilot UI/error wording from `Copilot Chat` to `Copilot language model` / `Copilot Model`

## v0.30.1 — Trust & Freshness Fixes

- **Real daily budget enforcement** — `dailyCostLimitUsd` now blocks new requests once the cap is reached
- **Live provider health refresh** — Status bar updates immediately after key save and model refresh
- **Run Center disk hydration** — Project Run Center and project runs tree now consume async disk-backed history
- **Settings quick actions** — Direct buttons for Chat, Model Providers, Project Run Center, Voice, and Vision
- **Budget control in Settings** — `dailyCostLimitUsd` is now editable in the Settings panel

## v0.30.0 — UX & Feature Overhaul

- **Getting Started walkthrough** — Four-step guided onboarding for new users
- **API key health check** — Immediate validation after storing a provider key
- **Collapsible settings panel** — Grouped, collapsible sections replace the flat wall of options
- **Cost persistence and daily budget** — Session costs persisted to globalState; `dailyCostLimitUsd` setting with 80%/100% alerts
- **Streaming for Anthropic + OpenAI** — Full `streamComplete()` with SSE parsing and tool-call handling
- **Agent performance tracking** — Success/failure tracking influences future agent selection
- **Cost estimation in plan preview** — `/project` shows estimated $low–$high cost before execution
- **Disk-based run history** — Individual JSON files replace single-blob globalState storage
- **Diff preview in project report** — File/status table and "Open Source Control" button in report
- **Multi-workspace folder support** — Quick-pick when multiple folders are open
- **Per-subtask checkpoint rollback** — Rollback by task ID instead of last-only
- **Memory tree pagination** — Incremental loading with "Load more…" instead of hard 200-entry cap
- **Provider health status bar** — Shows how many providers have valid API keys
- **Expanded task profiler** — 100+ new keywords for more accurate task classification
- **Integration test suite** — Full orchestrator → agent → cost → performance lifecycle tests

## v0.29.0 — Constants, Shared Validation & Zod

## v0.28.x — Project Import & Stability

- **`/import` command** — Scan existing workspaces and auto-populate SSOT memory from manifests, READMEs, configs, and license files
- **TypeScript fixes** — Added `"types": ["node"]` to tsconfig for full Node.js global support
- **Documentation overhaul** — Comprehensive README rewrite with logo, comparison table, and complete feature coverage

## v0.27.x — Skills Gap Analysis & README

- **11 new skills** — `code-symbols`, `rename-symbol`, `code-action`, `web-fetch`, `diff-preview`, `rollback-checkpoint`, `test-run`, `diagnostics`, `file-move`, `file-delete`, `git-branch`
- **README overhaul** — Logo, competitor comparison table, comprehensive feature documentation

## v0.26.x — MCP Integration

- **MCP client** — Connect external tool servers via stdio or HTTP transport
- **MCP server registry** — Persistent server configs with auto-reconnect
- **MCP tools as skills** — External tools seamlessly appear in the skill registry

## v0.25.x — Project Planner

- **`/project` command** — Decompose goals into DAGs of subtasks
- **TaskScheduler** — Topological sort into parallel batches
- **Ephemeral agents** — Role-specific agents for each subtask
- **Project Run History** — Persistent run records with the Run Center

## v0.24.x — Skill Security Scanner

- **Static analysis** — 12 built-in rules for custom skill validation
- **Scanner Rules Manager** — Configure rules via webview panel
- **Pre-enablement gate** — Custom skills must pass scanning before use

## v0.23.x — Voice & Vision

- **Voice Panel** — TTS and STT via Web Speech API
- **Vision Panel** — Image picker for multimodal prompts
- **`/voice` and `/vision` commands**

## v0.22.x — Tool Webhooks

- **Outbound webhooks** — Forward tool lifecycle events to external HTTPS endpoints
- **Configurable events** — tool.started, tool.completed, tool.failed
- **Webhook management panel**

## v0.21.x — Cost Tracking & Budget Control

- **CostTracker** — Per-session, per-provider cost accumulation
- **Budget modes** — cheap, balanced, expensive, auto
- **Speed modes** — fast, balanced, considered, auto
- **`/cost` command**

## v0.20.x — Multi-Agent Orchestration

- **AgentRegistry** — Custom agents with roles, prompts, and constraints
- **Agent selection** — Token overlap scoring for best-fit selection
- **Agent Manager Panel** — Create and configure agents via webview

## Earlier Releases

See [CHANGELOG.md](https://github.com/JoelBondoux/AtlasMind/blob/master/CHANGELOG.md) for the complete version history.

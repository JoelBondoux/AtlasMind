# Developer Roadmap

This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.

> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.

## Project Context
- Project: AtlasMind
- Project type: VS Code App
- Target audience: Small teams and solo developers
- Timeline: N/A
- Tech stack: Unspecified

## Prioritized Backlog
<!-- atlasmind:roadmap-items:start -->
- [ ] Guided GitHub workflow, **Tier 2 — branches and pull requests**. `deriveBranchName` (pure, ordinal collision suffixes, never a protected name); `pullRequestTracker.ts` mirroring `issueTracker.ts`'s sanitize discipline, because PR bodies and review comments are the same untrusted third-party surface and today nothing reads them so nothing sanitizes them; `gh pr create/list/view/diff/review` behind the modal + ladder; review ingestion and the address-feedback loop; PR throughput and review-latency metrics. Phased plan in `roadmap/guided-github-workflow.md`; spec in `docs/guided-github-workflow.md`. **Tier 1 shipped in v0.181.0** (workflow curriculum, shared `gh` runner, metrics, and the Workflow dashboard page — read-only). #workflow-v1
- [ ] Guided GitHub workflow, **Tier 3 — CI intelligence and release automation**. CI run/log retrieval (`gh run view --log-failed`; AtlasMind reads check *states* today and has never read a *log*); the ordered first-match-wins failure classification table with no model in the path, so the taxonomy can be charted over time; the `ci-analyst` and `release-manager` agents; `gh release create` from src with notes taken verbatim from the changelog; DORA four keys. Includes **C5.2 — fix the double-publish chain**: `publish:release` is `vsce publish && tag:release`, and the pushed tag triggers `publish.yml` to run `publish:release` again, failing on "version already exists". Documented as an interim in the spec; the code fix is either the missing tag workflow or dropping the chain. #workflow-v1
- [ ] Guided GitHub workflow, **Tier 4 — maintenance, tech-debt, and unattended operation**. The append-only debt register with severity from a declared rule table rather than a model score (a score assigned last week is not comparable with one assigned today, and comparability is the register's whole value); the `refactorer` agent; the `workflow.json` editing UI; raising stages to `propose`/`auto`; and the `WorkflowRunRecord` audit trail with input/output fingerprints, which is what makes every other stage's determinism claim verifiable rather than aspirational. #workflow-v1
- [ ] Decide the fate of three settings that are declared but read by nothing (found by the v0.174.0 settings audit; their descriptions now say so, and `tests/settingsIntegrity.test.ts` prevents new ones). **`atlasmind.remote.enabled`** — the real gate is the remote-control command plus a workspace approval, so `false` gives false assurance; either wire it as a genuine master switch (it defaults to `false`, so wiring it as-is would stop remote control working for anyone using it — needs a migration or a default change) or remove it and let the command be the only control. **`atlasmind.buzz.autonomousReplies`** + **`autonomousReplyLimitPerHour`** — the policy layer (`buzzSendPolicy`) is built and tested but nothing passes it an `autonomy` value, so every send still confirms. Wiring it *enables* autonomous outbound messaging, which is a deliberate safety decision rather than a cleanup: it should be its own change with its own review, not a side effect of an audit.

- [ ] Retire the `claude-cli` provider once ACP is proven. ACP supersedes it on every axis that mattered — it streams (the CLI bridge cannot), has no ~26,000-character argv prompt ceiling, and can carry images — so keeping both means maintaining two Claude-subscription paths and asking users to choose between them. **Not yet removable:** ACP Tier 1 has only been exercised against an injected fake process, so the CLI bridge stays as the fallback until a real `claude-agent-acp` binary has completed a turn on Windows and macOS. Sequence: (1) prove ACP against a real binary, (2) mark `claude-cli` deprecated in the provider panel and settings, (3) route new installs to ACP while leaving existing configs working, (4) remove the adapter, its `MAX_CLAUDE_CLI_*` truncation constants, and its tier table in the next MAJOR.
- [ ] Adopt ACP (Agent Client Protocol) so AtlasMind can drive Claude Code, Codex, and Gemini CLI subscriptions as routable capacity — replacing the argv-bounded, tool-free `claude-cli` bridge. Phased plan in `roadmap/acp-integration.md`: **Tier 1 ACP-as-provider shipped in v0.170.0** (streaming, no 26k prompt cap, images, restricted mode, contract verified against the published spec); Tier 2 multi-subscription fleet (ChatGPT Plus/Pro + Google — Gemini's launch invocation is still unpublished and must be pinned before use), Tier 3 delegated execution behind AtlasMind's approval gate, Tier 4 AtlasMind exposed as an ACP agent. Safety-critical constraint: delegated execution is never delegated authorization, and the Orchestrator's tool loop must stand down rather than nest inside the agent's. Remaining Tier 1 verification: a first run against a real agent binary (none installed on the dev machine). #mvp
- [x] The Documents Dash should auto create the folders when a new shelf is made. #mvp
- [x] The Testing Dash should have more visibility for failed and missing tests for each testing policy enabled. A More visual readout would help here. #mvp
- [x] The Roadmap dash should allow for other  version gates beyond MVP
- [x] MCP Servers should be part of the main settings page under Capabilities #mvp
- [x] Add to the opening Project Dashboard charts filters to see commits and work from various team members. A pie chart of user's work. A chart of route to MVP. A chart of outstanding tagged objectives. And other similar useful charts using line, bar and pie charts where appropriate with filters where this makes sense.
- [x] Add an Issues dashboard tab that syncs with Github (or other repo store) Issues. Allow Issues to be dealt with, edited or added.
- [x] Make one-tap quick-reply chips a universal expectation across every chat surface, not just the main Chat panel. `detectResponseQuickReplies` now reliably detects question shapes (v0.125.0), but pills only render in the Chat panel webview. Wire `responseText` into the `buildAssistantResponseMetadata` calls for the project-dashboard ideation chat (`src/views/projectDashboardPanel.ts`), the Project Ideation panel (`src/views/projectIdeationPanel.ts`), and the Vision panel (`src/views/visionPanel.ts`), and add the `renderQuickReplyButtons` render path (and its CSS) to those webviews so questions get clickable chips everywhere a user chats. (The `@atlas` participant footer renders in native VS Code chat markdown, which can't host immediate-submit buttons, so it stays text-only.)
- [x] The Roadmap Dashboard needs attention. It is duplicating items, listing inappropriate items, and the drag to re-order needs clarity in the UX. Also the Mark MVP should have a tooltip for what it actually means for novice developers. #mvp
- [x] Review the MCP auto config process as it doesn't seem to connect as an error message prompting not all required fields are filled - but that is not apparent from the fields shown. #mvp
- [x] Add document (.md) management dashboard tab. This allows the user to define a document filing system, and which files should be kept updated automatically. #mvp
<!-- atlasmind:roadmap-items:end -->

### Release gates
<!-- atlasmind:roadmap-gates:start -->
- `#mvp` — Minimum viable product
- `#workflow-v1` — Guided Workflow v1
<!-- atlasmind:roadmap-gates:end -->

## Prioritisation Notes
Atlas should weigh the roadmap in this order:
1. Critical, security, reliability, or production-blocking work.
2. Architectural integrity and changes that unlock safer future work.
3. User-facing outcomes, milestones, and backlog order in this file.
4. Delivery hygiene such as tests, CI, release notes, and documentation.

<!-- atlasmind-import
entry-path: roadmap/improvement-plan.md
generator-version: 2
generated-at: 2026-06-18T18:51:10.022Z
source-paths: README.md | package.json
source-fingerprint: 221fb04e
body-fingerprint: ffbb3f5c
-->

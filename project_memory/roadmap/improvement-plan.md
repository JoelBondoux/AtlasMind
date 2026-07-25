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
- [ ] Add to the opening Project Dashboard charts filters to see commits and work from various team members. A pie chart of user's work. A chart of route to MVP. A chart of outstanding tagged objectives. And other similar useful charts using line, bar and pie charts where appropriate with filters where this makes sense.
- [ ] Add an Issues dashboard tab that syncs with Github (or other repo store) Issues. Allow Issues to be dealt with, edited or added.
- [x] The Roadmap Dashboard needs attention. It is duplicating items, listing inappropriate items, and the drag to re-order needs clarity in the UX. Also the Mark MVP should have a tooltip for what it actually means for novice developers. #mvp
- [x] Review the MCP auto config process as it doesn't seem to connect as an error message prompting not all required fields are filled - but that is not apparent from the fields shown. #mvp
- [x] Add document (.md) management dashboard tab. This allows the user to define a document filing system, and which files should be kept updated automatically. #mvp
- [ ] Make one-tap quick-reply chips a universal expectation across every chat surface, not just the main Chat panel. `detectResponseQuickReplies` now reliably detects question shapes (v0.125.0), but pills only render in the Chat panel webview. Wire `responseText` into the `buildAssistantResponseMetadata` calls for the project-dashboard ideation chat (`src/views/projectDashboardPanel.ts`), the Project Ideation panel (`src/views/projectIdeationPanel.ts`), and the Vision panel (`src/views/visionPanel.ts`), and add the `renderQuickReplyButtons` render path (and its CSS) to those webviews so questions get clickable chips everywhere a user chats. (The `@atlas` participant footer renders in native VS Code chat markdown, which can't host immediate-submit buttons, so it stays text-only.)
<!-- atlasmind:roadmap-items:end -->

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

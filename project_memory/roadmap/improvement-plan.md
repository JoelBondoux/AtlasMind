# Developer Roadmap

This file is the developer-facing backlog AtlasMind should absorb into SSOT and consult when deciding what to tackle next.

> Priority order matters: items nearer the top receive more weight, but AtlasMind should still weigh criticality, security, architecture, delivery risk, and fresh execution evidence before choosing the next task.

## Project Context
- Project: ---
- Project type: Unspecified
- Target audience: Unspecified
- Timeline: Unspecified
- Tech stack: Unspecified

## Prioritized Backlog
<!-- atlasmind:roadmap-items:start -->
- [ ] This error needs addressing: Model diagnostic: Exceeded skills context budget of 2%. All skill descriptions were removed and 180 additional skills were not included in the model-visible skills list. #mvp #critical
- [ ] When a chat is in progress in the View Window and I close the window to catch up with the chat in the AM chat bar, the request is automatically closed down when it should stay running in the background. #mvp #critical
- [ ] When AtlasMind Chat is opened from links in dashboards they always open in the view window and not in the AtlasMind side chat bar (on the right by default). I'd rather the AM chatbar be used. #mvp
- [ ] The name of the project should also be in the AtlasMind Titlebar (on the left) just after the name Atlasmind. #mvp
- [ ] The Editable Queue in the Roadmap Dash shows Release: MVP in grey, so it actually reads is if it is active. Perhaps have that tag outlined in red when disabled and in blue (as it currently is) when active. #mvp
- [ ] Deliver AtlasMind Lens in evidence-backed phases: queryable code outline first, then execution journeys, schema/contract wiring review, change impact, tests, data trust, state, configuration, and PR maps. See `project_memory/roadmap/atlasmind-lens.md`. #mvp
- [ ] Change the Dashboard Refresh keybind to something that is not by default used in VS Code (as Ctrl+R is). #mvp
- [ ] Do we have a local GPU arbiter built already to manage multiple Lolal LLM providers without exceeding the max VRAM capacity (considering we need approx 3GB for Windows and applications to run smoothly) #mvp
- [ ] Retro-fit host-connection resilience to the remaining ~30 webview panels. Only the Project Dashboard has it (v0.374.0): a `WebviewPanelSerializer` so a panel VS Code restores is re-attached to a live host, plus the webview-side watchdog and the host's pre-dispatch `hostAck` so an unanswered request is reported instead of spinning. Every other panel — Chat, Settings, Mission Control, Project Run Center, Cost Dashboard, Model Providers, Agent Manager, UI Studio, Personality Profile, Ideation, MCP, Voice, Vision, Skill Scanner, Tool Webhooks and the Lens surfaces — still comes back inert after an extension update or a host restart: hover works, moving between pages works, every click posts into nothing and the console stays clean, so it reads as a dozen unrelated dead buttons rather than one dead channel. A zombie Chat panel is the worst case, since a prompt that goes nowhere looks like a model that is thinking. See `docs/development.md` → "A webview outlives the host object that answers it" for the pattern to copy.
<!-- atlasmind:roadmap-items:end -->

### Release gates
<!-- atlasmind:roadmap-gates:start -->
- `#mvp` — MVP
- `#critical` — Critical
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
generated-at: 2026-07-31T03:25:06.200Z
source-paths: README.md | package.json
source-fingerprint: e4812cac
body-fingerprint: ffbb3f5c
-->



<p align="center">
  <img src="media/icon.png" width="120" height="120" alt="AtlasMind logo" />
</p>

<h1 align="center">AtlasMind (Beta)</h1>

<p align="center"><sub> · <strong>Current source version: 0.49.37</strong> · </sub></p>


<p align="center">
  <strong>AtlasMind is your AI teammate for solo and small dev teams.</strong><br/>
  <em>Ship faster, automate the boring parts, and keep your project’s brain in one place — all inside VS Code.</em>
</p>

AtlasMind is built for indie developers, freelancers, and small teams who want to get more done without context switching or tool overload. It’s not just a chatbot — it’s a multi-agent orchestrator that routes your tasks to the right AI, remembers your decisions, and helps you focus on what matters most.


**Why solo and small devs love AtlasMind:**

- **No more context switching:** Everything happens in your editor — chat, code, memory, and planning.
- **Automate the grind:** Refactoring, testing, docs, and more — handled by specialized agents.
- **Bring your own models:** Use Local LLM, OpenAI, Claude, Gemini, Azure, or your favorite provider. Mix and match for cost, speed, or quality.
- **Project memory that sticks:** AtlasMind remembers your architecture, decisions, and lessons learned, so you don’t have to.
- **Stay in control:** Approvals, cost tracking, and safety guardrails keep you in the driver’s seat.
- **Secure and reliable by default:** Strong security guardrails and a default red-green testing policy, so you can build with confidence from day one.
- **Everything at a glance:** Project, run, personality, and cost dashboards keep you in control — review agent runs, memory, and spend in one place.

---




## What Makes AtlasMind Different?






<div align="center">

<table>
<tr>
  <th>Feature</th>
  <th>AtlasMind</th>
  <th>Copilot</th>
  <th>Claude Code</th>
  <th>Cursor</th>
</tr>
<tr><td>Multi-agent workflow</td><td>✅</td><td><span title="Copilot supports some agent-like flows but not true multi-agent orchestration.">⚠️</span></td><td>✅</td><td><span title="Cursor supports some agent-like flows but not true multi-agent orchestration.">⚠️</span></td></tr>
<tr><td>Model provider choice</td><td>✅</td><td><span title="Copilot supports only GitHub-hosted models, not bring-your-own.">⚠️</span></td><td><span title="Claude Code supports only Anthropic models.">⚠️</span></td><td>✅</td></tr>
<tr><td>Project memory (SSOT)</td><td>✅</td><td><span title="Copilot has session memory but not persistent project SSOT.">⚠️</span></td><td><span title="Claude Code has session memory but not persistent project SSOT.">⚠️</span></td><td><span title="Cursor has session memory but not persistent project SSOT.">⚠️</span></td></tr>
<tr><td>Approval/safety gates</td><td>✅</td><td><span title="Copilot has some safety checks but not approval gating.">⚠️</span></td><td>✅</td><td><span title="Cursor has some safety checks but not approval gating.">⚠️</span></td></tr>
<tr><td>Cost tracking</td><td>✅</td><td>❌</td><td>❌</td><td>❌</td></tr>
<tr><td>VS Code native</td><td>✅</td><td>✅</td><td>✅</td><td>✅</td></tr>
<tr><td>Built-in dashboards</td><td>✅</td><td><span title="Copilot has some usage stats but not full dashboards.">⚠️</span></td><td><span title="Claude Code has some usage stats but not full dashboards.">⚠️</span></td><td><span title="Cursor has some usage stats but not full dashboards.">⚠️</span></td></tr>
<tr><td>Extensible with MCP servers</td><td>✅</td><td><span title="Copilot can be used as a model behind an MCP server, but does not natively expose MCP extensibility.">⚠️</span></td><td><span title="Claude can be used as a model behind an MCP server, but does not natively expose MCP extensibility.">⚠️</span></td><td>❌</td></tr>
<tr><td>Secure by default</td><td>✅</td><td><span title="Copilot has security features but not full sandboxing or approval gating.">⚠️</span></td><td><span title="Claude Code has security features but not full sandboxing or approval gating.">⚠️</span></td><td><span title="Cursor has security features but not full sandboxing or approval gating.">⚠️</span></td></tr>
<tr><td>Red-green testing policy</td><td>✅</td><td>❌</td><td>❌</td><td>❌</td></tr>
</table>

</div>

- **Multi-agent orchestration**: Instantly craft new agents on spec (architect, refactorer, tester, etc.) and let the orchestrator route work automatically to work alongside the pre-designed system engineering agents.
- **Multi-provider model routing**: Supports GitHub CoPilot, Claude, GPT, Gemini, Azure OpenAI, Bedrock, Mistral, and more. Budget and speed preferences steer selection.
- **Built-in skills**: Instantly generate new skills on demand on top of the 32 pre-built ones including: File editing, git, diagnostics, code navigation, test running, web fetch, and more. Skills are grouped by category and support custom folders.
- **Long-term project memory (SSOT)**: Decisions, architecture notes, and lessons learned persist in a structured memory folder.
- **Project planner**: Decompose goals into subtasks, preview impact, gate execution, and review results.
- **Cost tracking**: Real-time per-session spend with budget guardrails.
- **MCP server support**: Extend AtlasMind with Model Context Protocol (MCP) servers for custom tools, agent extensions, and advanced workflows.

---


## Quick Start

1. Install **AtlasMind** from the VS Code Marketplace.
2. Open **AtlasMind: Manage Model Providers** and configure your first model provider.
3. Start AtlasMind in your workspace:
  - For a new project, run `@atlas /bootstrap`.
  - For an existing project, run `@atlas /import`.
4. Ask AtlasMind to help with your next task.

For advanced setup, provider notes, CLI usage, or development workflows, see:
- [Getting Started](wiki/Getting-Started.md)
- [CLI Usage](wiki/CLI.md)
- [Model Routing](docs/model-routing.md)
- [Development Guide](docs/development.md)

---

## Open Source & Support

AtlasMind is fully open source and available under the permissive MIT license. There are no paywalls, feature gates, or commercial editions—just the full project, free for everyone.

If AtlasMind saves you time or helps your team, consider a pay-what-it's-worth donation to keep the project alive and thriving. Every bit of support helps sustain ongoing development.

See [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md) for details.

---



## Learn More

- [Core Workflows](wiki/Chat-Commands.md)
- [Model Routing](docs/model-routing.md)
- [Agents & Skills](docs/agents-and-skills.md)
- [SSOT Memory System](docs/ssot-memory.md)
- [Configuration Reference](docs/configuration.md)
- [Comparison Matrix](wiki/Comparison.md)
- [Funding and Sponsorship](wiki/Funding-and-Sponsorship.md)

---

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and contribution guidelines.

MIT License — see [LICENSE](LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/JoelBondoux/AtlasMind/main/media/icon.svg" width="100" alt="AtlasMind logo" />
</p>

# AtlasMind

**Your AI project manager, inside VS Code — with a delivery team attached.**

Most AI coding tools give you an assistant in a chat box. That solves *writing code*. It doesn't tell
you what to build next, what's blocking it, who owns it, what you deferred three weeks ago, whether
your tests cover what you claim, or whether you're fit to release.

AtlasMind is a **23-page project dashboard** built from your own repository — roadmap and dependency
graph, issues, pull requests, people, risk, compliance, technical debt, testing evidence, documents,
delivery and release — where every grade names the rule that produced it. Attached to it is a team of
27 AI specialists that can carry the work out: ask in plain English, and AtlasMind picks the
specialist and a model that suits the task and your budget, does the work, checks it, and shows you
what changed and what it cost.

**The management half needs no chat of its own.** Already happy with Copilot, Claude Code, Cursor,
Codex, Gemini CLI or Windsurf? Keep it — AtlasMind syncs your testing methodologies, debt markers and
workflow rules into the instruction files those tools already read, so whichever agent writes the
code is told the same rules.

**Nothing risky happens without your say-so.** Every automatic step is one you switched on, and you
can switch it off again.

> AtlasMind is in **Beta** until version 1.0.0. It's stable enough to use daily — we're keeping the
> label until the configuration and memory formats are frozen.

---

## New here? Start with these three

| | |
|---|---|
| **[[Getting Started]]** | Install it, connect a model, and get your first useful answer. About five minutes. |
| **[[Chat Commands]]** | Everything you can type, and what each one actually does. |
| **[[FAQ]]** | The questions people ask in week one, and what to do when something misbehaves. |

---

## What you can do with it

**Fix or build something.** Ask in chat like you'd ask a colleague. AtlasMind reads your code, picks a
specialist, makes the change, verifies it, and reports back. See [[Agents]] and [[Skills]].

**Run a whole piece of work.** `/project Add Stripe checkout` produces a reviewable plan — the steps,
what depends on what, what it will touch, where it will pause — before anything happens.
See [[Project Planner]].

**Chase a goal on its own.** `/loop` and Mission Control keep going towards an outcome inside limits
you set: spend, time, attempts, and where it must stop and ask. See [[Project Planner]].

**Think before you build.** Lay out problems, requirements, risks and evidence on a visual board, then
turn the cards that survived into real roadmap items. See [[Ideation]].

**Ship properly.** A guided eight-stage workflow takes you from an idea to a released version, with an
explanation at every step. See [[GitHub Workflow]] and [[Delivery]].

**Design an interface and carry it into the project.** Use screens, content, wireframes, UI system and
implementation handoff for any UI, with full-canvas review in VS Code's built-in browser and a responsive
inspection lab; a website's delivery half lives on the Dashboard's Delivery page. See [[Website Studio|UI Studio]].

**Work from the terminal.** The same orchestrator, agents and safety rules without opening the editor.
See [[CLI]].

---

## Bring the models you already pay for

AtlasMind doesn't sell you tokens. Connect what you already have:

- **Cloud providers** — Anthropic, OpenAI, Google Gemini, Azure OpenAI, Amazon Bedrock, DeepSeek, Mistral, z.ai
- **Subscriptions you already own** — a Claude, ChatGPT, Copilot or Qwen plan, or an eligible Gemini Code
  Assist licence, used as capacity with **no per-token cost**
- **Local models** — Ollama, LM Studio, or anything speaking the OpenAI API. No key, no bill.

AtlasMind then chooses between them per task. Set a daily cap and it will respect it.
See [[Model Routing]].

---

## What makes it different

**It manages the project, not just the code.** Twenty-three dashboard pages built from git, GitHub and
your own files — roadmap dependencies, risk, compliance, tech debt, testing evidence, release
readiness. Registers transition rather than forget, and every grade cites a published rule so the same
project reads the same way in March and in July.

**It works with the AI tool you already use.** The management layer reads your repository, not your
chat history, and it writes its rules into Copilot, Claude Code, Cursor, Codex, Gemini and Windsurf
instruction files. Its own agents are optional.

**It remembers your project.** Architecture, decisions, domain knowledge and lessons live as readable
Markdown files in your repository and come back when they're relevant. See [[Memory System]].

**It's a team, not an assistant.** 27 specialists with different instructions, tools and models. They
can hand work to each other — without handing over permissions they weren't given. See [[Agents]].

**It shows its working.** Which agent, which model, which tools, what it verified, what it cost, and
what it couldn't finish. See [[Tool Execution]].

**Safety is the default, not a setting you find later.** Deny-by-default gates, secrets in the OS
keychain, protected production, and untrusted input treated as untrusted everywhere. See [[Security]].

**Testing is taken seriously.** 69 configurable methodologies that actually reach the agent writing the
code, get checked against your repository, and report honestly when nobody has looked yet.

---

## All the pages

### Getting going
| Page | What's on it |
|------|--------------|
| [[Getting Started]] | Install, connect a provider, first commands |
| [[Chat Commands]] | Every slash command and Command Palette action |
| [[Configuration]] | Every setting, what it does, and what to set it to |
| [[FAQ]] | Common questions and troubleshooting |
| [[CLI]] | Running AtlasMind from the terminal |

### Doing the work
| Page | What's on it |
|------|--------------|
| [[Agents]] | The built-in specialists and how to make your own |
| [[Skills]] | The 43 built-in tools, custom skills, and MCP servers |
| [[Model Routing]] | Providers, subscriptions, local models, and how one gets chosen |
| [[Memory System]] | What AtlasMind remembers about your project, and how |
| [[Project Planner]] | Multi-step runs, Mission Control, approvals and checkpoints |
| [[Ideation]] | The thinking board and the research scans behind it |
| [[GitHub Workflow]] | The guided eight-stage workflow from idea to release |
| [[Delivery]] | Moving work safely towards production |
| [[Website Studio|UI Studio]] | Visual design, content, screens, full built-in-browser preview, responsive inspection, and implementation handoff for websites and other interfaces |
| [[Resource Discovery]] | Finding and adding new MCP servers, agents and skills |
| [[Bring Your Own AI Tool]] | Using the management layer with Copilot, Claude Code, Cursor, Codex, Gemini or Windsurf instead of AtlasMind's chat |
| [[Remote Control]] | Driving a desktop instance from a browser |

### Trust
| Page | What's on it |
|------|--------------|
| [[Security]] | The security model, boundaries, and how to report a problem |
| [[Tool Execution]] | Approvals, allow-lists, checkpoints and verification |

### The project
| Page | What's on it |
|------|--------------|
| [[Contributing]] | Dev setup, conventions, and how to add things |
| [[Funding and Sponsorship]] | Supporting ongoing development |
| [[Architecture]] | How the system is put together |
| [[Changelog]] | What changed in each release |

---

## About versions

The Marketplace badge shows the published version. The **source** version for whatever branch you're
reading comes from that branch's `package.json`, and may be ahead of it.

Day to day, `develop` is where work lands and `main` is reserved for release-ready promotions.

---

## Licence

The **source code** is open source under the
[MIT Licence](https://github.com/JoelBondoux/AtlasMind/blob/main/LICENSE), permanently — compile it
yourself and you owe nothing and enter into no agreement.

AtlasMind follows the [Open Source Maintenance Fee](https://opensourcemaintenancefee.org) model, so
from **v1.0.0** the official binary release carries a maintenance fee for organizations with annual
gross revenue of US$10,000 or more that use it in revenue-generating activities — $10–$60 a month by
headcount, under
[OSMFEULA.txt](https://github.com/JoelBondoux/AtlasMind/blob/develop/OSMFEULA.txt). **No fee is payable
before v1.0.0**, and individuals and anyone outside revenue-generating work never pay one. There is
no feature gating and no lesser edition: every user gets the same software. See
[Funding and Sponsorship](Funding-and-Sponsorship.md).

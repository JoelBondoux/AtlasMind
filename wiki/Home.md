<p align="center">
  <img src="https://raw.githubusercontent.com/JoelBondoux/AtlasMind/main/media/icon.svg" width="100" alt="AtlasMind logo" />
</p>

# AtlasMind

**Your AI delivery team, inside VS Code.**

Most AI coding tools give you one assistant in one chat box. AtlasMind gives you a team — and keeps
everything the team learns attached to your project.

Ask for what you want in plain English. AtlasMind picks the right specialist, picks a model that suits
the task and your budget, reads what it needs from your code, does the work, checks it, and shows you
what changed and what it cost. Your decisions, architecture notes and lessons learned stay in the
project, not in a chat window you'll close and never find again.

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
inspection lab; website profiles add protected delivery. See [[Website Studio|UI Studio]].

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

**It remembers your project.** Architecture, decisions, domain knowledge and lessons live as readable
Markdown files in your repository and come back when they're relevant. See [[Memory System]].

**It's a team, not an assistant.** 27 specialists with different instructions, tools and models. They
can hand work to each other — without handing over permissions they weren't given. See [[Agents]].

**It shows its working.** Which agent, which model, which tools, what it verified, what it cost, and
what it couldn't finish. See [[Tool Execution]].

**Safety is the default, not a setting you find later.** Deny-by-default gates, secrets in the OS
keychain, protected production, and untrusted input treated as untrusted everywhere. See [[Security]].

**Testing is taken seriously.** 23 configurable methodologies that actually reach the agent writing the
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

AtlasMind is open source under the [MIT Licence](https://github.com/JoelBondoux/AtlasMind/blob/main/LICENSE).
There's no paid tier and no plan to add one.

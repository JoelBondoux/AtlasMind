# Architecture

**How AtlasMind is put together, in plain terms.**

This page is the overview. If you're contributing code and need the full service-by-service map, the
developer reference is [`docs/architecture.md`](../docs/architecture.md), and
[[Contributing]] covers setup and conventions.

---

## What it is

AtlasMind is a VS Code extension written in TypeScript. It also ships a **command-line tool** and an
**agent endpoint** that lets other tools drive it.

All three share the same core, so orchestration, model routing, tools, memory and safety behave
identically whichever way you reach them. There's one implementation of "how AtlasMind decides things",
not three.

---

## What happens when you ask a question

```
Your message
  ↓
Pick the right agent          Who's best placed to answer this?
  ↓
Gather context                Relevant project memory, plus live file reads where exactness matters
  ↓
Strip credentials             Anything secret-shaped is removed before it can leave
  ↓
Profile the task              How hard is this, what kind of work, what capabilities are needed
  ↓
Pick the right model          Within your budget and speed preferences
  ↓
Resolve the tools             Only what this task needs, within what you allowed this turn
  ↓
Run it                        Approval gate → snapshot → tool → verification
  ↓
Account for it                Tokens and cost recorded
  ↓
Your answer
```

Two details in there matter more than they look:

**Credentials are stripped before dispatch, not after.** The redaction step sits between gathering
context and sending it.

**A snapshot is taken before every write.** That's what makes a failed step recoverable.

---

## What happens during a project run

```
/project <goal>
  ↓
Plan                  A reasoning model breaks the goal into steps and works out the order
  ↓
Check the tools       A reasoning-only planner can't leave a step unable to do its job
  ↓
Preview + approval    You see the whole thing before anything happens
  ↓
Execute in batches    Independent steps run in parallel, each with a temporary specialist
  ↓
Summarise             One report across every step
  ↓
Save                  Persisted to the Run Center
```

Short follow-ups like *"proceed autonomously"* re-use your last substantial request and go down the same
path — you don't have to retype it.

---

## The main parts

### Deciding and running

| Part | What it does |
|---|---|
| **Orchestrator** | The centre of everything. Routes a task: agent → memory → model → tools → execution → cost |
| **Agent Registry** | Who the specialists are, which are enabled, and how they've performed |
| **Skills Registry** | What tools exist and which an agent may use |
| **Model Router** | Picks a model by budget, speed, capability, health and past outcomes |
| **Task Profiler** | Works out how hard a task really is |
| **Planner & Task Scheduler** | Breaks a goal into steps and runs them in dependency order |
| **Mission Runner** | The autonomous loop, and the envelope that contains it |
| **Cost Tracker** | What everything cost, per session and per model |

### Remembering

| Part | What it does |
|---|---|
| **Memory Manager** | Reads, writes and searches your project memory |
| **Memory Scanner** | The gate that decides what may be written |
| **Checkpoint Manager** | Snapshots before writes, so a failure is recoverable |
| **Project Run History** | Every autonomous run, kept per workspace |

### Reaching outside

| Part | What it does |
|---|---|
| **Provider adapters** | One per model provider, behind a shared contract |
| **ACP adapter** | Drives a subscription coding agent as a model provider |
| **MCP registry** | Connects external tool servers and dispatches their tools |
| **Resource discovery** | Finds new servers, agents and skills |
| **Voice** | Speech in and out — cloud, your OS, or fully on-device |

### The panels

Chat, Settings, Project Dashboard, Project Ideation, Mission Control, Project Run Center, Cost
Dashboard, Model Providers, Agent Manager, Website Studio, Personality Profile — plus the sidebar trees
for Chat, Lens, Director, Project State, Sessions, Runs, Memory, Models, Agents, Skills, MCP Servers and
Resource Discovery.

---

## Some structural rules

These are worth knowing because they explain a lot of AtlasMind's behaviour.

**Selection is not authorisation.** Choosing which tools to offer a model happens *after* eligibility and
*after* your turn's limits, so it can only ever narrow. Approval classification and the execution-time
check still run for every single call.

**A panel supplies data, never a command.** The dashboard can trigger a promotion and attest a check, but
it can never supply the command string that runs. What executes comes from your saved configuration, read
on the extension side. This is why a tampered panel message can't do much.

**Policy is shown, not summarised.** The Settings → Agents page renders the actual immutable guardrail
constant from the runtime, rather than a copy in the panel that could drift from what really happens.

**Registries own their thing.** The agent registry owns agent definitions, the skills registry owns tools,
the orchestrator owns execution. That separation is what lets the number of agents grow without agent
management, execution and logging collapsing into one service.

---

## Other tools driving AtlasMind

AtlasMind can be the agent rather than the client. A local tool can drive it over a standard protocol,
and it keeps agent selection, memory, model routing, tool resolution, approvals and execution on its own
side.

That endpoint opens **no network port**. Sessions are bound to a workspace and bounded. Commands the
client declares are **never launched**. Only one loop runs at a time. Safe reads follow the headless
default; anything risky asks the calling client for a **one-turn** decision — and a permanent grant is
never accepted.

---

## Where the code lives

| Path | What's in it |
|---|---|
| `src/core/` | Orchestration, routing, planning, safety, cost, project services |
| `src/runtime/` | The built-in agents and how the runtime is composed |
| `src/providers/` | Provider adapters, catalogues, health, local model discovery |
| `src/skills/` | Built-in tools and skill handlers |
| `src/memory/` | Memory retrieval, scanning, redaction, persistence |
| `src/chat/` | The chat participant and interaction protocol |
| `src/views/` | Settings, dashboards, editors and sidebar surfaces |
| `src/mcp/` and `src/ard/` | MCP connectivity and resource discovery |
| `src/voice/` and `src/remote/` | Voice backends and remote control |
| `src/cli/` | The command-line tool and the agent endpoint |
| `src/acp/` | Agent-side sessions and permission brokering |
| `tests/` | Unit, integration, webview, security and regression coverage |

Shared types live in one place, and provider adapters implement one shared contract. Type definitions are
never duplicated across files.

---

## Related

- [`docs/architecture.md`](../docs/architecture.md) — the full service map, for contributors
- [[Contributing]] — dev setup, conventions, and how to add things
- [[Model Routing]] — how a model gets chosen
- [[Memory System]] — how memory works
- [[Tool Execution]] — the approval pipeline
- [[Security]] — the boundaries
- [[CLI]] — the terminal host

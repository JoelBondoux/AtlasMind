# Model Routing

**AtlasMind picks the right model for each task, so you don't have to.**

Connect whatever you have — a cloud API key, a subscription you already pay for, a local model, or all
three — and set two preferences: how much you want to spend, and how fast you want answers. AtlasMind
handles the rest, per task.

The reply footer always tells you which model ran and what it cost. Nothing is hidden.

---

## What you can connect

### Cloud providers (pay per token)

Anthropic, OpenAI, Azure OpenAI, Google Gemini, Amazon Bedrock, Mistral, DeepSeek, z.ai, xAI, Cohere,
Perplexity, Hugging Face and NVIDIA NIM.

Add a key from **AtlasMind: Manage Model Providers**. Azure and Bedrock need a little more — an endpoint
and deployment names for Azure, a region and model IDs for Bedrock.

### Subscriptions you already pay for

The cheapest way to run AtlasMind, because it costs nothing extra.

| You have | AtlasMind can use it |
|---|---|
| GitHub Copilot | Directly, once Copilot Chat is installed and signed in |
| Claude, ChatGPT, Qwen | Through their coding agents (see below) |
| Gemini Code Assist Standard or Enterprise | Through the Gemini CLI |

### Local models

Ollama, LM Studio, or anything speaking the OpenAI API. Free, private, and nothing leaves your machine.
You can even aggregate several local engines together under one provider.

---

## Using a subscription

AtlasMind talks to coding agents over the [Agent Client Protocol](https://agentclientprotocol.com), which
turns your subscription into capacity the router can choose from.

| Agent | Command | Install with |
|---|---|---|
| Claude Agent | `claude-agent-acp` | `npm install -g @agentclientprotocol/claude-agent-acp` |
| Codex | `codex-acp` | `npm install -g @agentclientprotocol/codex-acp` |
| Gemini CLI | `gemini --acp` | `npm install -g @google/gemini-cli` |
| GitHub Copilot CLI | `copilot --acp` | `npm install -g @github/copilot` |
| Qwen Code | `qwen --acp` | `npm install -g @qwen-code/qwen-code` |

Run `/acp` for a guided setup that installs, signs you in, and **proves a real answer comes back** before
calling it done.

Some agents (goose, OpenCode, Cursor, Kimi) ship as downloadable archives rather than npm packages.
AtlasMind won't download and unpack an archive, so it names the launch command instead of offering an
install button that couldn't work. Any other ACP agent works too — just name the command that starts it.

**Nothing is spawned until you name a command you've installed.** The agent list is empty by default.

### Two things worth knowing

**By default a subscription agent only writes text.** It has no tools, no file access and no terminal.
Switch on `atlasmind.acp.toolsEnabled` (**Let subscription agents act**) and the router may also send it
tool-backed work, where it uses its *own* tools and each operation is logged. Ordinary completions stay
isolated even with that on.

**The agent list is read from a pinned copy of the official registry, not fetched live.** A launch
command that arrived over the network and was then executed would be remote code execution with extra
steps.

---

## How a model gets picked

### First, who's eligible

| Gate | Rule |
|------|------|
| **Enabled** | Both the provider and the model must be switched on |
| **Healthy** | The provider must be responding |
| **Allowed** | If the agent restricts its models, it must be on that list |
| **Capable** | It must support what the task actually needs |
| **Affordable** | Its price tier must fit your budget mode |
| **Quick enough** | Its speed tier must fit your speed mode |
| **Trusted** | If the context contains payment card or health data, only models on the trusted list are eligible — and if none are available, the sensitive parts are redacted instead |

### Then, who's best

Each remaining candidate is scored on price, speed, quality, how well it fits this particular task,
whether its provider is healthy, your own thumbs up/down history, whether it's effectively free, how it
has actually performed on work like this, and whether it has been struggling with this kind of task.

Your **budget mode** and **speed mode** decide how much price and speed matter relative to everything
else. `cheap` weights price heavily; `expensive` barely weights it at all.

### If it goes wrong

Failover stays within models that still meet the task's requirements and gets **three attempts of its
own**, under a hard limit of five model calls for the whole turn — one request can't become a tour of your
whole provider list.

Those three are reserved. AtlasMind can also *escalate* — move up to a stronger model when an answer
wasn't good enough — and that used to come out of the same allowance, so a turn that escalated once had a
single attempt left to survive a provider going down. The optional upgrade no longer spends the budget
recovery needs.

**When a provider breaks, AtlasMind stops walking back into it.** If a subscription agent crashes
mid-turn, every model it hosts is set aside for the rest of the turn — picking a different model name on
the same broken process just reproduces the failure. That now includes escalation, which previously could
route straight back into an endpoint the turn had already watched fail. The judgement is kept narrow: for
an agent AtlasMind launched as a process, a protocol-level error means *that process*; for a cloud
provider reached over the web, one error is one server among many and the provider stays in play.

**And it remembers between messages.** An endpoint that fails hard twice is set aside for ten minutes, so
a crashed agent isn't the first thing tried on your next message — but if it's the only thing that can do
the job, AtlasMind tries it anyway rather than refusing your request. One successful call clears the
record.

A model that fails is marked failed for the session and dropped from future selection, with a warning in
the Models sidebar. If a task genuinely needs tools and no capable model is left, **AtlasMind says so**
rather than quietly falling back to a model that can only write text.

**When it gives up, it tells you what failed — not which limit it hit.** You get every model it tried,
what happened to each, and how long each one took, and only then which limit ended the search. If every
attempt timed out, it says so plainly: nothing reported a fault, so this is an endpoint that isn't
answering or an agent that isn't signed in, not a model that's unsuitable. If the failures don't agree, it
gives you the list and stops there, because guessing at a single cause when there were several sends you
to the wrong fix.

---

## Models that can't hold a conversation

Your provider's model list is an inventory of everything it serves, and most of it can't chat. A local
runtime lists every set of weights loaded — embedding models, rerankers, safety classifiers, Whisper.
OpenAI's own list carries `text-embedding-3-large` and `dall-e-3` right alongside its chat models.

AtlasMind used to treat all of them as chat models. Local ones are free, so they looked like the *best*
option precisely when everything else had failed — and a safety classifier can't answer a question at all,
so the turn ended on an error that no amount of waiting would have fixed.

These are now recognised by family name and kept out of routing entirely: they don't appear in the model
picker and can't be failed over to. The rule is deliberately cautious in one direction — a model AtlasMind
doesn't recognise is always treated as a chat model, because wrongly hiding something you installed is
worse than the occasional one slipping through.

---

## How long AtlasMind waits

A hosted API call gets 30 seconds. Two cases need more, and both used to fail for the wrong reason:

- **Subscription agents (ACP)** have to start a process and shake hands before they see your prompt.
  Their deadline now covers all of that plus the prompt itself. Previously the outer limit and the
  agent's own limit were the same number, so a slow start always tripped the outer one first and you got
  "timed out" with no clue which part was slow.
- **Local models** load their weights and read your prompt on your own machine. The wait now scales with
  the model's size, the length of your prompt, and whether the model has already answered once this
  session — the first request after a restart pays for loading. A 14B model on a long prompt was being
  called a timeout at 30 seconds and dropped, while it was working.

---

## Budget modes

| Mode | Uses | Good for |
|------|---------------------|----------|
| **cheap** | Cheap models only | Bulk work, simple questions |
| **balanced** | Cheap and mid-priced | Everyday development *(default)* |
| **expensive** | Everything | Architecture, hard reasoning |
| **auto** | Decided per task | Letting difficulty choose |

Price tiers are: **cheap** at or under $0.0015 per 1K tokens, **balanced** at or under $0.008, and
**expensive** above that.

In `auto`, high-reasoning tasks get the mid and premium tiers; everything else gets cheap and mid.

## Speed modes

| Mode | Uses | Good for |
|------|---------------------|----------|
| **fast** | Fast models only | Quick edits and lookups |
| **balanced** | Fast and mid | Everyday development *(default)* |
| **considered** | Mid and slow | Planning, architecture, deep analysis |
| **auto** | Decided per task | Letting difficulty choose |

A model is **fast** if it has no reasoning capability and a context window up to 128K, **considered** if
it has reasoning and 200K or more, and **balanced** otherwise.

---

## It learns what works

### Your feedback counts

Thumbs up or down on a response adjusts routing for that exact model. The effect is capped so one bad
day can't blackball a model. Turn it off with `atlasmind.feedbackRoutingWeight: 0`.

### It notices when a model keeps struggling

AtlasMind remembers when a specific model repeatedly under-performs on a specific *kind* of task, and
routes around it. This exists to counter a real failure mode: a cheap model's price advantage keeps
winning even after it has failed the same job three times.

It watches for timeouts, empty responses, a model writing a tool call as plain text instead of actually
calling it, error finishes, and follow-up turns where you clearly disputed the previous answer. Billing
and deprecation failures don't count — those aren't the model's fault.

The memory is **specific to the kind of task**, so a model that's bad at refactoring isn't punished for
answering questions. The penalty starts small (just enough to break a near-tie), escalates if the pattern
continues, and eventually **opens up more expensive models** for that task type. It decays with a
roughly two-and-a-half-day half-life and halves after a clean turn — so a bad afternoon fades but a
genuinely unsuitable model stays de-weighted.

De-weighted models are badged in the **Compare Models** panel, so you can see it happening.

---

## Making a subscription go further

Some models cost several premium requests each — Claude Opus through Copilot costs 3× a normal request.
AtlasMind accounts for that when scoring.

**When you drop below 30% of your quota, it starts conserving**, gradually treating subscription capacity
as if it were priced like an API so cheaper options win more often.

A subscription with quota left also gets a small preference across the board, because that capacity is
already paid for. That nudge **disappears once the quota is gone** — after which it's treated like any
other paid provider.

---

## Two things that quietly save money

**Cache-aware routing.** On a back-and-forth conversation, the large unchanging part of the prompt — your
system prompt, memory and tool definitions — can often be served from the provider's cache at a much
lower rate. AtlasMind estimates how much of the prompt is cacheable and prices it accordingly, which
favours cache-capable models for iterative work. One-off questions are unaffected.

**Free capacity is preferred, but not blindly.** A local or subscription model gets a real advantage —
but for broad review, planning and synthesis work it has to clear a reasoning bar first. A cheap model's
price advantage shouldn't win a job it can't do.

---

## Recognising what a task actually needs

The task profiler works out what phase you're in, what kind of content is involved, and how much
reasoning is required. Planning and synthesis favour reasoning models; code execution favours code
models.

Two cases are deliberately profiled harder than their length suggests:

- **Follow-ups that lean on earlier conversation** ("based on the thread above…"), so AtlasMind can move
  off a weak local model on later turns
- **Open-ended advisory questions** — "what should we work on next?", "is anything incomplete?" — which
  are short but demand whole-project reasoning. Without this they'd fall through as trivial and land on
  the cheapest available model

Mechanical follow-ups like "commit" stay low-cost, as they should.

---

## Keeping the model list current

On startup, and whenever you click **Refresh Model Metadata**, AtlasMind asks each provider for its live
model list.

The short names you see initially are **seed entries**, not the final catalogue — they exist so routing
works before discovery finishes.

- **Deprecated models are excluded automatically** once their date passes
- **A model the provider says is gone stays gone for the session**, even if a later refresh briefly
  lists it again
- **A successful empty result prunes the list.** Only errors and timeouts preserve the last known
  catalogue — because "the provider answered and listed nothing" and "we couldn't ask" mean different
  things
- **Extended-thinking models are priced honestly**, with their thinking multiplier applied, so they
  aren't misfiled as cheap

---

## Running things in parallel

When a project run executes several steps at once, AtlasMind spreads models across the slots: free and
subscription capacity fills first, pay-per-token absorbs the overflow, and cost stays balanced across
the batch.

---

## Related

- [[Configuration]] — every routing setting
- [[Agents]] — how agents constrain model choice
- [[Getting Started]] — connecting your first provider
- [[Security]] — the trusted-model gate and data privacy policy
- [[Project Planner]] — parallel execution

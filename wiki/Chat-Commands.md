# Chat Commands

**Everything you can type, and what it actually does.**

There are two places to talk to AtlasMind, and they behave identically:

- **The AtlasMind chat panel** — type `/acp` directly. Open it with **AtlasMind: Open Chat Panel**
  (`Ctrl+Alt+I`, `Cmd+Alt+I` on macOS)
- **VS Code's own chat view** — type `@atlas /acp`

Both run the same handlers — for slash commands *and* for ordinary messages — so they can't give you
different answers, and any button a command offers appears as a clickable chip in both. One dispatcher
decides what your message is before either surface renders it, which is what stops the two drifting
apart: until v0.325.0 the chat view answered plain messages by a separate route that had quietly lost
conversation recall, roadmap status and the model-and-cost footer.

Two nice touches: a mistyped command gets **corrected rather than answered** (`/agent` suggests
`/agents`), and a message that merely *starts* with a slash is still treated as a question —
`/usr/local/bin/thing is missing` is read as prose, not a failed command lookup.

---

## The commands

### Setting your project up

| Command | What it does |
|---------|-------------|
| `/bootstrap` | Create project memory for a new project, and optionally scaffold governance files |
| `/import` | Read an existing repository and populate project memory from it |
| `/setup` | Every setup guide and how far along each one is. `/setup acp` jumps straight into one |
| `/acp` | Guided setup for using a Claude, ChatGPT, Copilot, Gemini or Qwen subscription |
| `/buzz` | Guided setup for the Buzz messaging integration |
| `/lens` | What to put in the Lens declaration files, with a worked example for each |
| `/sync-instructions` | Reconcile every AI tool's instruction file — yours and AtlasMind's — into one agreed set |

All three setup guides work the same way: each step is reported as done, to do, blocked or optional based
on what's actually configured, and **none of them will switch anything on for you**. `/acp` finishes by
proving a real answer comes back; `/buzz` finishes by proving a real message arrives. Subscribed isn't the
same as receiving, and installed isn't the same as working.

`/lens` differs in one respect: it lists all five declaration files rather than walking you through them in
order, because the files are independent and you may only ever want one of them. Only the two that
actually gate a lens are counted, so a project that has declared its state machines and its configuration
precedence reads as finished rather than as permanently half-done.

### Doing work

| Command | What it does |
|---------|-------------|
| `/project <goal>` | Break a goal into steps, preview the impact, then run it |
| `/loop <goal>` | Keep working towards a goal inside limits you set, pausing at checkpoints |
| `/runs` | Open the Run Center to review recent autonomous runs |
| `/ship [routine]` | Run your project's default publish routine, or a named one |

### Thinking and planning

| Command | What it does |
|---------|-------------|
| `/ideate` | What's on your ideation board and what needs attention. Read-only — no scan, no model |
| `/research` | What research found, what's due, what's blocked, and what's never been assessed |
| `/memory <query>` | Query project memory. Read-only here — browse and edit entries in the Memory view |

### People and follow-ups

| Command | What it does |
|---------|-------------|
| `/director` | Stakeholders, team, responsibilities, assignments and follow-ups |
| `/followups` | Open follow-ups grouped by overdue, due soon and upcoming |
| `/buzz read` | Recent Buzz messages, with real names and reactions. Session-only, never written to memory |
| `/buzz send <message>` | Post to your watched channel. Refuses to guess if you watch more than one |
| `/buzz dm <name> <message>` | DM a Director contact. An ambiguous name is refused, not guessed |

### Your setup

| Command | What it does |
|---------|-------------|
| `/agents` · `/skills` | List your agents and skills. Both are read-only here — create and edit them in the Agent Manager |
| `/discover <query>` | Find MCP servers, agents, skills and APIs to add |
| `/cost` | Running spend for this **workspace, across every session** — not just this conversation. Each reply's own cost is in its footer |
| `/voice` · `/vision` | Speech panel and image analysis |

### Sub-commands

These are typed as an argument to the command before them — `/research all`, not `/all`. VS Code's
autocomplete only knows the commands above, so it will not suggest these; they work all the same.

| Type this | What it does |
|---|---|
| `/setup acp` · `/setup buzz` · `/setup lens` | Jump straight into one guide instead of the index |
| `/acp all` · `/buzz all` · `/research all` | The whole checklist at once, rather than the next step only |
| `/buzz local` · `/buzz hosted` | Choose how Buzz reaches its relay. **Changes a workspace setting**, so it confirms first and names both values |
| `/sync-instructions apply` | Accept the reconciled instruction set |
| `/sync-instructions choose <n> <m>` | Resolve conflict *n* by taking option *m* |
| `/sync-instructions reset` · `/sync-instructions cancel` | Start the reconciliation again, or abandon it |
| `/project <goal> --approve` · `/loop <goal> --approve` | Skip the file-count review gate for a run you have already read. Nothing else about the run changes — tool approvals, protected branches and release gates all still apply |

---

## Just asking

Anything without a slash is a normal request:

```
@atlas How is error handling done in this codebase?
@atlas Write a function to parse CSV files, with proper error handling
@atlas Why is the auth middleware running twice?
```

What happens: AtlasMind picks the most relevant agent, pulls in related project memory, works out how
hard the task is, chooses a model within your budget and speed preferences, runs it with the appropriate
tools, and streams the answer back with the cost attached.

**Images are picked up automatically** — mention an image path in your workspace and it's attached.

**Context carries forward** — the last several turns come with you, so follow-ups make sense. Configure
how many under [[Configuration]].

### Short follow-ups escalate properly

`Proceed`, `Continue` or `Proceed autonomously` reuse your last substantial request and escalate it into
the same autonomous flow as `/project`. You don't have to retype what you wanted.

---

## Asking to commit, push or release

If you ask AtlasMind to commit, push, promote or publish, it applies your project's declared workflow in
**the same turn** — rather than replying with "say follow the workflow" and waiting for a second message.

This is sequencing, **not extra authority**. Tool approvals, automation ceilings, protected-branch
checks, release gates and confirmations for anything outward-facing all still happen exactly as
configured. Unrelated edits you already had in progress are left alone — AtlasMind won't stash or include
them to make a release look tidy, and it prefers an isolated worktree for branch-changing work.

Change the behaviour with `atlasmind.workflow.chatGuidance`:

| Value | What happens |
|---|---|
| `follow` *(default)* | Apply the declared route in the same turn |
| `inform` | Tell you what the workflow expects, then do exactly what you asked |
| `gate` | Stop until you explicitly release it |
| `off` | No workflow policy or notice at all |

---

## Command Palette

Press `Ctrl+Shift+P` and type "AtlasMind".

### Opening things

| Command | What it opens |
|---------|-------------|
| `AtlasMind: Getting Started` | The onboarding walkthrough |
| `AtlasMind: Open Chat Panel` | The dedicated chat panel (`Ctrl+Alt+I`) |
| `AtlasMind: Focus Chat View` | The chat in the sidebar |
| `AtlasMind: Open Settings Panel` | The full settings workspace |
| `AtlasMind: Open Chat / Model / Safety / Project Settings` | Straight to one settings page |
| `AtlasMind: Open Project Dashboard` | Repo health, roadmap, issues, branches, delivery and more; internal callers may supply a validated page and exact-record focus |
| `AtlasMind: Open Project Director` | Stakeholders, team, assignments, and the shared personal Follow-ups attention list |
| `AtlasMind: Open Project Ideation` | The thinking board |
| `AtlasMind: Open Project Run Center` | Review, approve, pause and resume runs |
| `AtlasMind: Open Mission Control` | Define and watch autonomous loop runs |
| `AtlasMind: Open UI Studio` | Visual UI planning, content design, wireframes, design system, and implementation handoff; website profiles also include delivery tooling |
| `AtlasMind: Open UI Preview in Built-in Browser` | Rebuild the deterministic structure/content/style index, serve it from guarded `127.0.0.1`, and open it in VS Code's built-in browser. Asks before turning preview on for the first time |
| `AtlasMind: Stop UI Preview` | Stop the shared local preview server. Also happens when UI Studio closes or the extension deactivates |
| `AtlasMind: Generate Website From Plan` | Runs an already-confirmed generation plan. Normally reached from a **Generate** button in Website Studio, which is what builds the plan and shows you the file list |
| `AtlasMind: Rebuild and Open UI Preview` | Rebuild the live design draft from wireframes, UI tokens, and Markdown content, then open its index in the built-in browser. No model runs |
| `AtlasMind: Import Website Client Feedback` | Read a feedback file your client exported from the review overlay and merge it into the review register |
| `AtlasMind: Set Up Website Stack` | Scaffolds the chosen framework, writes the deploy config and stage branches, and optionally the CI workflow. Shows every command and every file in full before anything runs. Normally reached from **Set up this stack** on the Stack page |
| `AtlasMind: Open Cost Dashboard` | Spend over time, budget use, and local-model savings |
| `AtlasMind: Open Voice Panel` · `Open Vision Panel` | Speech and image analysis |
| `AtlasMind: Open a Setup Guide` | Starts a walkthrough **in a fresh chat session**, so it never lands mid-conversation and inherits unrelated context |

### Models and integrations

| Command | What it does |
|---------|-------------|
| `AtlasMind: Manage Model Providers` | Add credentials, configure providers, refresh models, run health checks |
| `AtlasMind: Specialist Integrations` | Credentials for search, voice, image and video services |
| `AtlasMind: Manage MCP Servers` | Connect external tool servers |
| `AtlasMind: Resource Discovery` | Find, add and export agentic resources |
| `AtlasMind: Manage Agents` | Create and configure agents |
| `AtlasMind: Compare Models on a Prompt` | Run one prompt across your models and compare, with an optional scoring judge |
| `AtlasMind: Dismiss Provider Notifications` | Clear the auto-paused badge without re-enabling anything |
| `AtlasMind: Choose ACP Console Window Behaviour` | Windows only — ordinary launching, or the private desktop |

### Project memory

| Command | What it does |
|---------|-------------|
| `AtlasMind: Bootstrap Project` · `Import Existing Project` | Same as `/bootstrap` and `/import` |
| `AtlasMind: Update Project Memory` | Refresh imported memory from the current state of your code |

### Testing

| Command | What it does |
|---------|-------------|
| `AtlasMind: Scaffold Testing Framework` | Create starter config, example tests and a strategy playbook for your enabled methodologies |
| `AtlasMind: Sync Testing Protocols to AI Agents` | Mirror your protocols into `CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md` and friends |

### Research

| Command | What it does |
|---------|-------------|
| `AtlasMind: Run a Research Scan` | Runs one scan, after a confirmation naming the scan, the source and the fact that it costs money. **A scan with no usable source never reaches the model** |
| `AtlasMind: Open the Research Register` | Findings, their sources, and the rule that graded each |
| `AtlasMind: Open the Research Digest` | What changed, what it means, what's still unassessed |

### Buzz

| Command | What it does |
|---------|-------------|
| `AtlasMind: Set Buzz Agent Key` | Stores your key in the OS keychain. Empty removes it; cancel leaves it alone. Never written to settings or memory |
| `AtlasMind: Fetch My Buzz Channels` | Asks Buzz which channels your key can see and offers them as a ticklist. **The only Buzz control that writes a setting** — and only the channel list, only after you confirm |
| `AtlasMind: Copy Buzz ACP Agent Setup` | Copies a credential-free recipe for running AtlasMind as a Buzz agent |

### Lens — reading your code

Lens explains your codebase from what's actually declared in it. **It never runs your code, never reads
secret values, and never invokes a model** unless you explicitly ask it to.

The dashboard is the way in — it lists every lens, says which are ready and why the others aren't, and
reports evidence it didn't inspect as *unassessed* rather than as absent.

| Command | What it does |
|---------|-------------|
| `AtlasMind: Lens: Open Atlas Lenses Dashboard` | **Start here.** One page for all eleven lenses — what each reads, the question it answers, whether it can answer it right now, and the rule behind that verdict. A flow map draws evidence → lens → question, and a ⓘ on every card explains the lens in plain language and, separately, what it *cannot* prove. A **Do this next** band lists only what needs a person, and is empty when nothing does |
| `AtlasMind: Lens: Refresh Active Outline` | Re-read the current file's symbols |
| `AtlasMind: Lens: Filter Symbols` | Show everything, or focus on types, callables, data or containers |
| `AtlasMind: Lens: Declaration Guide` | **What to write, and how.** Per file: what it declares, its current status, and a worked example small enough to read. **Ask Atlas to draft it** has a model read your repository and propose a first draft — refused whole if it fails the same check the lens uses, every file path it claims verified against your workspace and dropped if it doesn't resolve, any credential-shaped value left out entirely, and nothing written until you've seen it all and confirmed. Entries you wrote yourself always win |
| `AtlasMind: Lens: Set Up Repository Declarations` | Check what's configured, and create valid empty starters. Existing files are opened, never overwritten |
| `AtlasMind: Lens: Review Contract Wiring` | Compare a TypeScript / OpenAPI / JSON Schema / SQL boundary, with drift and relationship views |
| `AtlasMind: Lens: Review State Lifecycle` | Visualise a declared state machine — reachability, terminal states, dead ends, guards |
| `AtlasMind: Lens: Review Configuration Resolution` | Show a setting's precedence chain, what wins and what's shadowed — without reading live values |
| `AtlasMind: Lens: Review Branch Change Story` | Turn a branch's committed history into a readable story of what changed and where |
| `AtlasMind: Probe Live Services` | **Does the running system still agree with the code?** Pick a service you've declared and AtlasMind reads the schema it actually serves, then reports every field that has gone missing, changed type, or turned up undeclared — plus which services answered at all, and which served fields no classification covers. Reads shape only: never a row, never a value, never a write. Off by default; a production endpoint asks you to type its name first |
| `AtlasMind: Live Service Settings` | Open the two settings that gate the live lenses: whether they may run at all, and which environments they may reach |
| `AtlasMind: Store a Live Service Credential` | Put a connection string or token in the OS keychain for one declared endpoint. Never echoed, never logged, never written to your repository. Validated by parsing, not by connecting, so a typo fails while you can still see what you pasted — and the parsed host, database, user and TLS mode are shown back, which is what catches a production string pasted into a staging endpoint |
| `AtlasMind: Clear a Live Service Credential` | Remove a stored credential. The endpoint stays declared, and its next probe reports that nothing is stored |

### Remote and system

| Command | What it does |
|---------|-------------|
| `AtlasMind: Toggle Autopilot` | Turn the session-wide approval bypass on or off, no reload needed |
| `AtlasMind: Toggle Keep Computer Awake` | Stop the machine sleeping while something needs to stay online. Off by default, mains-power only, auto-releasing |
| `AtlasMind: Tool Webhooks` | Configure outbound webhooks for tool events |
| `AtlasMind: Enable / Disable Remote Control` | Start or stop the local server so a browser can drive this instance |
| `AtlasMind: Enable Remote Control (Gateway)` | Cross-machine mode, behind your own sign-in gateway |
| `AtlasMind: Show Remote Pairing Code` · `Revoke Remote Access` | Show the code, or rotate it and disconnect everyone |
| `AtlasMind: Connect to / Disconnect from Desktop Instance` | *(web build)* Pair or unpair |
| `AtlasMind: Open Remote Dashboard` | *(web build)* Read-only cost and run dashboards |

See [[Remote Control]] for the full picture.

---

## Sidebar actions

These live in their own views and deliberately don't clutter the Command Palette.

| Where | What you can do |
|---------|-------------|
| **Lens** | Open a symbol at its exact source location · **Ask Atlas About This** (opens an editable draft; never auto-submits, never carries source text or absolute paths) · **More Target Actions** for tracing flow, mapping impact, and finding tests |
| **Agents** | Show details · enable or disable |
| **Skills** | Add a skill · create a folder · configure scanner rules · scan a skill · enable or disable · show scan details |
| **Models** | Enable or disable a provider or model · **Hide from sidebar** (presentation only — nothing is disabled; restore under Settings → Models & Integrations) · open model docs · configure a provider · refresh the catalogue · set a subscription plan · assign models to agents |
| **Sessions** | Rename (F2) · create a folder · file into a folder · archive · restore |
| **Memory** | Edit an entry · get a plain-language review of it |

---

## Follow-up suggestions

After each command AtlasMind offers relevant next steps as chips — view your agents after
`/bootstrap`, review cost after `/project`, and so on. They pre-fill or navigate; they don't act on
their own.

---

## Related

- [[Getting Started]] — your first commands
- [[Project Planner]] — `/project` and `/loop` in depth
- [[Ideation]] — `/ideate` and `/research`
- [[Configuration]] — every setting these commands read
- [[Remote Control]] — the remote commands

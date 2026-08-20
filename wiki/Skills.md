# Skills

**A skill is a tool an agent can use.** Reading a file, running your tests, checking git status,
fetching a URL, setting a breakpoint. AtlasMind ships **50 built-in skills**, and you can add your own
or connect MCP servers for effectively unlimited extension.

You mostly won't think about these directly. They matter when you want to know *what AtlasMind is able
to do*, or when you want to deliberately stop an agent doing something.

---

## What's built in

### Working with files

| Skill | What it does |
|-------|-------------|
| `file-read` | Read a file, optionally just a line range |
| `file-write` | Create a file or overwrite one |
| `file-edit` | Make a targeted change to an existing file |
| `file-search` | Find files by pattern |
| `file-delete` · `file-move` | Delete, move or rename — always inside your workspace |
| `directory-list` | List what's in a folder |

### Git

| Skill | What it does |
|-------|-------------|
| `git-status` · `git-diff` · `git-log` | See where things stand |
| `git-commit` | Commit, with the message passed straight to git (no quoting problems). Allows up to 120s for your pre-commit hooks |
| `git-push` | Push, with a protected-branch guard that refuses force-pushes to main, master, production, release and hotfix branches |
| `git-branch` | List branches (including only-merged-into-a-ref, the safe deletion candidates), create, switch, or delete — locally, force (`-D`), or on the remote. Refuses to delete protected branches |
| `git-fetch` | Download new commits and refs, with `--prune` to drop remote-tracking refs whose branch is gone — the first step of a branch cleanup |
| `git-pull` | Fetch and integrate, fast-forward-only by default so a routine sync can never invent a merge commit; rebase and merge modes are explicit choices |
| `git-merge` | Merge a branch into the current one, or abort a conflicted merge. Conflicts are reported with the exact files and both ways out |
| `git-worktree` | List, remove, or prune worktrees. A worktree pins its branch, so cleanup goes through here; removal only ever targets a worktree git itself lists, never the main one |
| `git-stash` | Set changes aside and bring them back: list, show, push, apply, pop, drop — entries addressed by validated index only |
| `git-blame` | Who changed this line, when, and in which commit |
| `git-apply-patch` | Apply a unified diff |
| `diff-preview` | See what a change would do before it does it |
| `rollback-checkpoint` | Undo back to the automatic snapshot taken before the last write |

### Understanding your code

| Skill | What it does |
|-------|-------------|
| `diagnostics` | Your compiler errors and warnings, straight from VS Code |
| `code-symbols` | Navigate properly — list symbols, find references, go to definition |
| `rename-symbol` | Rename across the codebase via the language server |
| `code-action` | List and apply quick fixes and refactorings |
| `code-format` | Format using *your* configured formatter — Prettier, ESLint, rustfmt, black, gofmt or dotnet-format, detected automatically |
| `framework-detect` | Work out your whole stack from manifests and config fingerprints |
| `workspace-state` | One call for problems, debug sessions, output channels and test results |

### Searching and fetching

| Skill | What it does |
|-------|-------------|
| `text-search` | Grep-style search across the workspace, regex supported |
| `memory-query` | Query project memory |
| `web-fetch` | Fetch a URL, with protection against reaching localhost, private IPs or cloud metadata endpoints |
| `http-request` | A full HTTP request — method, headers, body — with the same protections. Useful for testing your own APIs |
| `exa-search` | Web search via EXA. Needs an EXA key in Specialist Integrations |
| `discover-resources` | Read-only search for new MCP servers, agents and skills. It surfaces candidates; it never installs anything |

### Running things

| Skill | What it does |
|-------|-------------|
| `terminal-run` | Run a command against a tiered allow-list of around 60 safe commands. Understands Node, Python, Rust, Go, Java, Ruby, PHP, Flutter, Expo, Elixir, Terraform, Helm, kubectl, Godot, Turbo, Nx and more |
| `terminal-read` | List your open terminals |
| `test-run` | Detect and run your test framework — Vitest, Jest, Mocha, pytest, cargo test |
| `npm-scripts` | List your `package.json` scripts and run one. Handles monorepo working directories |
| `docker-cli` | A strict allow-list of Docker and Compose commands, with no shell interpolation |

### Debugging

| Skill | What it does |
|-------|-------------|
| `debug-session` | List active debug sessions and evaluate expressions in a paused one |
| `debug-launch` | Start a named configuration from your `launch.json` without leaving chat |
| `debug-breakpoint` | List, add (with conditions or logpoints), remove or clear breakpoints |
| `log-file-tail` | Find your log files, tail them, or search across all of them |
| `workspace-observability` | Debug session, open terminals and the most recent test run in one snapshot |

### VS Code itself

| Skill | What it does |
|-------|-------------|
| `simple-browser` | Open a URL in VS Code's built-in browser — handy for dev servers and dashboards |
| `vscode-extensions` | List installed extensions and forwarded ports |

### Memory

| Skill | What it does |
|-------|-------------|
| `memory-write` | Write to project memory — validated, security-scanned, then saved |
| `memory-delete` | Remove an entry |

### Asking a colleague

| Skill | What it does |
|-------|-------------|
| `agent-handoff` | Ask a named specialist a question and get their answer back |

**A handoff transfers the question, not the permissions.** The delegate runs with the *overlap* between
the caller's tools and its own, never the combination — otherwise any restricted agent could obtain any
capability just by asking a permissive one. Capped at three deep, can't loop back, and refuses rather
than running a delegate that would end up with no tools at all. The answer comes back labelled as
another agent's opinion, not a verified result.

### Reference guidance

| Skill | What it does |
|-------|-------------|
| `specialist-guidance` | Loads one focused checklist — technical SEO, structured data, discoverability, platform listings, accessibility, responsive layout, interaction design or UI implementation |

It's classified as a low-risk read because it only returns bundled text. Time-sensitive rules in it
still have to be re-checked against current primary sources.

---

## Agents don't get every tool, every turn

An agent's assigned skills are its **ceiling**, not a promise that all of them are offered each time.
AtlasMind selects the tools that fit the task at hand — which keeps the context window free for your
actual work, and reduces the chance of a model reaching for something irrelevant.

Each agent uses one of three policies:

| Policy | What it means |
|---|---|
| **Task-scoped** (default) | At most 12 relevant tools per turn, from the built-in set |
| **Allowlist** | Exactly the skills the agent names, every time |
| **All** | Every enabled skill, *including integrations installed after the agent was created* |

Whichever policy you pick, **at most 24 tool descriptions are sent in one turn**. The policy decides what
an agent is *allowed* to use; it shouldn't also decide how much of your context window every question
costs. An agent set to *All* with several integrations connected was sending every tool it had on every
message, however small the question. If your list already fits under the ceiling nothing changes at all —
and when the ceiling does trim something, AtlasMind says so in the activity line, because a silent cut
reads as "this is everything I have".

### It reads your delivery pipeline before acting on it

If you've set up delivery stages on the Project Dashboard, AtlasMind uses **your** names for them. Ask it
to "promote to staging" and it looks up the stage you declared — including by *kind*, so it finds your
staging stage even if you called it something else entirely, like `Integration`. It will not invent a
stage you never declared, and a promotion needs both a verb and a real stage: "publish the docs" isn't a
deployment, and "why is production slow?" is a question about one.

### A request to merge arrives with the tools to merge

Tool selection used to work word by word, so "merge to main then publish" was handed the tools that
*describe* a repository and none of the tools that change one — and a model given that set writes a
confident report rather than stopping. Merging, rebasing, cherry-picking and promoting now get the write
tools together, as one job. Asking a question *about* a commit still doesn't hand over the ability to
publish one, and every one of these tools stays behind its normal approval prompt.

### Your words are enforced, not just heard

If you say **"read-only"**, **"don't edit anything"**, **"don't install packages"** or **"don't run
commands"**, AtlasMind removes those tools *before* it even picks a model — and checks again immediately
before execution. A model that calls an omitted or invented tool gets a policy denial. The tool is not
run, and it is not conjured up.

This is a real capability change, not wording in a prompt.

One consequence worth knowing: a restricted turn like that can't be delegated to a subscription agent,
because AtlasMind can narrow its own tools but can't impose the same restriction inside somebody else's
agent. It'll route to a provider where it *can* enforce the limit, or tell you it couldn't.

---

## Turning skills on and off

- Toggle any skill in the **Skills** sidebar
- Disabled skills are invisible to agents and to the model
- Your choices persist across sessions

Built-in skills are grouped by category rather than dumped in one long list. Custom skills can sit at
the root or inside folders you create with **Create Skill Folder**, and the arrangement survives a
reload.

---

## Limits worth knowing

| | |
|---|---|
| **Tools per turn** | 8 maximum, run concurrently, each independently approval-gated |
| **Default timeout** | 15 seconds |
| **`web-fetch`** | 30 seconds |
| **`test-run`** | 120 seconds |
| **Custom skills** | Set your own `timeoutMs` |

All file operations are sandboxed to your workspace. Paths that try to escape it are rejected.

---

## Writing your own skill

### From a template

1. Command Palette → **AtlasMind: Add Skill** → **Create from template**
2. A starter file appears in `.atlasmind/skills/`
3. Write your logic
4. The security scanner runs before it can be enabled

Create a folder first if you want it grouped somewhere specific in the sidebar.

### From an existing file

**AtlasMind: Add Skill** → **Import existing file**, then pick a `.js` file that exports
`module.exports.skill` or `module.exports.default`.

### Letting Atlas draft one (experimental)

With `atlasmind.experimentalSkillLearningEnabled` on, you can ask `@atlas` to create a skill. It writes
a draft to `.atlasmind/skills/`, and that draft still has to pass the security scanner like any other.

### What your skill gets to work with

Every skill handler receives a context object with workspace APIs: file I/O, regex search across files,
git operations, code intelligence (diagnostics, symbols, references, rename, code actions), the
allow-listed terminal, the test runner, protected URL fetching, memory read/write, checkpoint rollback,
the debug APIs, and a few VS Code UI helpers.

You can also give a skill **routing hints** — natural-language phrases like "commit", "save changes" —
so the model finds it by intent rather than by remembering its exact ID.

---

## The security scanner

Custom skills are scanned before they can be enabled. There are **12 rules**.

**These block enablement:**

| Rule | What it catches |
|------|----------------|
| `no-eval` | `eval()` |
| `no-function-constructor` | `new Function()` |
| `no-child-process-require` · `no-child-process-import` | Reaching for `child_process` |
| `no-shell-exec` | `exec()`, `spawn()`, `execSync()` |
| `no-path-traversal` | `../` patterns |
| `no-hardcoded-secret` | Keys, tokens and passwords in source |

**These are flagged but allowed:**

`no-process-env` (reading environment variables), `no-direct-fetch` (`fetch`, `axios`, `got`),
`no-http-require` and `no-http-import` (Node's http modules), `no-fs-direct` (using `fs` instead of the
provided context API).

Built-in skills are pre-approved and skip the scan.

**AtlasMind: Configure Scanner Rules** lets you view every rule, toggle them, add your own regex rules,
or reset to defaults.

---

## MCP servers

[Model Context Protocol](https://modelcontextprotocol.io/) servers give you tools from anywhere —
databases, cloud consoles, issue trackers, design tools. Their tools appear as skills named
`mcp:<server>:<tool>`.

### Connecting one, the easy way

1. Command Palette → **AtlasMind: Manage MCP Servers** → **Guided Setup**
2. Pick a route:
   - **Scan my computer** — AtlasMind lists servers it can set up from tools you already have
   - **Browse by category** — a curated catalogue: Core, Cloud, Databases, DevOps and more
3. It checks prerequisites. If something's missing it shows you the exact install command and installs
   it **only after you confirm**
4. It asks for what the server needs in labelled fields — no raw JSON. API tokens go into SecretStorage
   and are injected as environment variables at connect time
5. The server's tools register as skills automatically

Prefer full control? The **Advanced** tab keeps the raw transport, command, args and env form.

### Once connected

- Enable or disable individual MCP tools in the Skills tree
- Connections persist across sessions

**One nice touch:** many git and workspace MCP tools need a repository path argument. When the model
forgets it, AtlasMind fills in your current workspace folder so the call works instead of failing with
"repoPath is required". Only clearly path-shaped, currently-empty parameters get this — a bare `path` or
`file` argument is left alone, and anything you supplied explicitly is never overridden.

See [[Tool Execution]] for how approvals work on MCP tools.

### Buzz communications

**Browse by category → Collaboration → Buzz Communications** adds AtlasMind's bundled,
communication-only connector. It needs `buzz-cli` v0.4.26, a dedicated agent key, and
`atlasmind.buzz.enabled`.

It registers exactly four skills — list channels, post a message, read a thread, send a DM — and
deliberately exposes no shell, file editing, repository access, administration, identity minting or
message-history mirroring. Message bodies go through stdin rather than a command line, identifiers are
validated, process time and output are bounded, and credentials are redacted. Remote relays require
explicit consent and TLS.

---

## When AtlasMind is the one being driven

If another tool launches AtlasMind over ACP, your skills still pass through AtlasMind's own policy
first. Safe reads follow the headless default; workspace writes, subprocesses, network calls, audio and
anything unrecognised ask the calling client for a **one-turn** decision, showing a bounded,
secret-redacted preview. The only options offered are **Allow once** and **Reject** — a permanent grant
is never accepted, because it would live inside the other tool where AtlasMind couldn't show or revoke
it.

Server commands the client declares are **not started**. Accepting an executable from the other side of
a transport would turn session setup into remote code execution and bypass the MCP registry's approval
path entirely.

---

## Skills the Mission Loop learns on the way

The autonomous Mission Loop can go and get capabilities it discovers it needs, but it prefers what's
already there: each step first tries registered skills, agents and MCP tools. Only with
`atlasmind.loop.allowDiscovery` on may it fill a genuine gap by drafting a new skill (through the same
scanner path above) or searching [[Resource Discovery]]. Anything new still passes the normal approval
gates. Nothing is silently trusted.

---

## Related

- [[Agents]] — who uses these tools
- [[Tool Execution]] — approvals, allow-lists and verification
- [[Security]] — the boundaries around all of it
- [[Resource Discovery]] — finding new servers, agents and skills
- [[Project Planner]] — the Mission Loop

### `atlasmind-open` — take the operator to the page

Chat could describe all 35 of AtlasMind's addressable pages and open two of them, so every navigational
answer was prose the operator then had to act on themselves. This skill takes `{ page, section? }`, resolves
the destination from the declared catalogue in `src/core/capabilityIndex.ts`, and opens it.

Three properties make it safe to hand to a model. The destination is **chosen from a declared list, never
composed** — an unrecognised page is refused with the candidates, and the only VS Code commands it can
reach are the two panel openers, so it is not a general `executeCommand` bridge. An **ambiguous id is
reported rather than resolved**: `testing` exists on both surfaces, and silently picking one sends the
operator somewhere they did not ask for while telling them they arrived. And it is classified **`read`**,
because opening a panel changes nothing and a navigation tool that prompts is one the model learns not to
use — which puts the operator back where they started.

The catalogue it resolves against is pinned by test to `SETTINGS_PAGE_IDS` and `DASHBOARD_PAGE_IDS` in
both directions, so a page added to a panel and not to the catalogue fails the build rather than shipping
as a page the model confidently names and nothing can open.

### `atlasmind-settings` — read freely, change only after asking

Chat could describe all 134 AtlasMind settings and change none of them, so "turn off automatic research
scans" could only be answered with prose telling the operator where to click. The gap was real, but the
wrong fix is worse than it: a path that wrote two chat settings at workspace scope on a signal that fired
on ordinary politeness shipped until v0.310.4, and named neither key in anything the operator read. A
settings change nobody is told about cannot be reviewed, reverted, or attributed.

Reading is a `read` and free. A change rests on four rules:

- **Only declared keys.** The key must exist in the running extension's manifest under `atlasmind.`, so a
  model cannot invent a setting, reach another extension's configuration, or write a key no code reads.
- **The value must match what the manifest declares** — type, and enum membership — checked in the skill
  so the refusal names the permitted values rather than failing silently at the write.
- **A `{ modal: true }` dialog names the key, the current value and the new one, and is the gate.** Nothing
  is written until it returns. A toast can be missed, and this changes how the operator's tools behave from
  then on.
- **Workspace scope, never global**, so the change lands in the project's own `.vscode/settings.json` where
  a reviewer sees it rather than in a user profile where it follows them everywhere.

`classifyToolInvocation` grades `action: 'set'` as a high-risk `workspace-write` and `action: 'get'` as a
`read`. The modal is the consent and the classification is the approval gate; both have to hold.

### Session-fit suggestions

`sessionFitSuggestions` derives, from what the session actually did, the settings that are wrong for the
work: a run that stopped at the tool-iteration or tool-calls ceiling rather than because it finished, a
carry-forward window smaller than the material under discussion, an approval mode raising more dialogs
than a mode change would cost. Four declared rules, ranked in declaration order — a run that stopped
outranks a session that was merely noisy, because the first has already cost something.

Every input is optional and **absent means not observed, never zero**. A rule inferring "no approvals were
needed" from an absent count would fire on every fresh session, which is how a suggestion becomes
something people learn to ignore. Nothing in the module writes: applying a suggestion goes through
`atlasmind-settings` and its modal.

### `find-tool` — progressive disclosure of the tool set

A turn sends at most `MAX_TURN_TOOL_SCHEMAS` (24) schemas, chosen from the prompt. When that guess is
wrong the model cannot call what it was not told about, so it works around the gap rather than asking.
`find-tool` costs one schema and makes the remainder reachable: the model describes the action, matching
skills are appended to the turn's tool set, and it can call them on the next iteration — the same
mechanism the synthesised-skill path uses.

Four rules, in `src/core/toolDiscovery.ts`:

- **Discovery grants nothing.** It searches the agent's *eligible* pool, never the registry, so a skill
  the agent may not use is not nameable — otherwise the model plans around one it can never call. Every
  authorization gate still applies at invocation.
- **Already-sent tools are excluded**, or the model rediscovers what it holds and searches again.
- **A miss is final and says so**, rather than reading like an error and inviting a reworded retry against
  an unchanged pool.
- **At most five tools per search**, so a broad query cannot undo the cap in one call.

`shouldOfferToolDiscovery` withholds it in two cases: when nothing was withheld in the first place, and —
importantly — when the turn was given **no** tools at all. Zero is a decision rather than a small number:
Change Story mode clears the skill set so a committed-ref answer cannot be contaminated by the
checked-out workspace, and a search there would let the model reacquire exactly what that mode withholds,
against a different revision.

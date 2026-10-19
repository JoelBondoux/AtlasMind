# Tool Execution & Safety

## Session approval modes

Select a mode in Workflow, chat, the status bar or **AtlasMind: Set Approval Mode**. The selector
confirms Auto/Bypass activation. Grants last for the extension session, across its chat tasks.

- **Ask** uses the configured policy and revokes session/task/category bypass grants.
- **Auto — approve for me** uses a separate, tool-free reviewer against task intent and exact arguments.
  Uncertainty, withheld evidence, failure or a 20-second timeout asks. Calls use synthesis routing,
  normal privacy and daily-budget checks; usage is recorded as `approval-reviewer`. Existing ordinary
  approval cards can be reviewed when Auto is selected.
  Automatic commit reviews require exact paths; broad staging still asks.
- **Bypass** grants eligible tools permission without review or another prompt. The legacy Autopilot
  command and approval-card option grant this same mode.

Restart returns to Ask. Explicit-only cards, fresh approvals after untrusted content, disabled
capabilities, sandbox requirements and dry run remain. ACP agents retain their separate delegation
switch. Workflow behavior is defined in [the canonical specification](../docs/guided-github-workflow.md#session-approval-modes).

**Nothing risky happens without you knowing.**

AtlasMind can edit your files, run your tests, commit to git and reach the network. This page is about
how much of that it may do, when it asks first, and what it will never do regardless of what you set.

The short version: **reading is free, writing asks, and a handful of things are refused outright.**

---

## How much it asks

One setting, `atlasmind.toolApprovalMode`, controls the whole thing:

| Mode | What gets approved automatically |
|------|-----------|
| **`always-ask`** | Nothing. Every single tool call asks |
| **`ask-on-write`** *(default)* | Local reading only. Anything that writes, deletes or reaches outside asks — including a remote read that changes nothing |
| **`ask-on-external`** | Reading and workspace edits. Terminal, network and git writes ask |
| **`allow-safe-readonly`** | Everything except genuinely high-risk operations |

`ask-on-write` is the right default for most people. Start there; loosen it once you've watched
AtlasMind work for a while.

**A remote read is not a free read.** An MCP tool named `get_customer_data` grades as `network-read`:
it changes nothing, and it sends whatever it was asked for to a third party. Until v0.405.0
`ask-on-write` let that through on the first half of that sentence alone. It now asks.

If that becomes a wall of dialogs during a long task, use **Bypass approvals** on the first prompt —
it covers the rest of that task. A narrower per-category grant exists in the approval manager but is
not yet offered in the dialog; this page previously described it as though it were, which was wrong.

### What an approval looks like

When something needs you, AtlasMind brings the chat surface forward and shows a card with the tool, its
parameters, its risk category and a plain summary of the impact. You get four choices:

- **Allow once** — just this call
- **Bypass approvals** — for the rest of this task
- **Autopilot** — for the rest of this session
- **Deny** — reject it, without leaving the conversation

Parameters are redacted for secrets and length-capped before you see them. If a parameter can't be
displayed properly, it says **"unserializable arguments"** rather than showing a misleading empty object.

Bypass and Autopilot are applied by the approval manager in the same state transition that resolves the
card. Tool calls from one model response run concurrently, so the manager also settles every already-waiting
card covered by the new scope before any tool gate resumes. A card cannot be answered before its resolver
exists, and the host rejects any decision the card did not offer.

Autopilot can also be toggled directly with **AtlasMind: Toggle Autopilot**, and puts an indicator in
your status bar so you always know it's on.

### What Autopilot cannot buy

Autopilot and per-task bypass answer *stop asking me about this*. They do not answer *and never ask me
again about anything*. One category is beyond all of them: an operation that **leaves your machine,
changes something there, and cannot be undone from here**. In practice that is a `git push` to a
protected branch (or `staging`/`development`), of a tag, with force, or without the branch named;
deleting a branch on the remote; and — the case that matters most — **any external tool AtlasMind
cannot identify**, because an unrecognised MCP tool name grades as an outward write on the name alone.

An ordinary push — the `git-push` tool naming a working branch such as `develop` or `feat/x`, to a
remote given by name — is *not* on the ceiling, so Autopilot covers it. Until v0.482.0 every push was,
and Autopilot asked on each one while the same push typed as `terminal-run git push` was waived: the
dedicated tool was stricter than the raw command. `terminal-run` now refuses `git push` (and git
aliases defined with `-c`) and sends the model to `git-push`, so a push has one set of rules. The
`git-push` tool checks that a named branch really is a local branch, so a tag cannot ride through on a
branch's approval, and pushes a single release tag with its `tag` parameter.

Until v0.433.0 there was no such ceiling: Autopilot approved every category, and Autopilot is offered
as an answer to *any* approval dialog, so a single click on a harmless tool bought unattended approval
of all three for the rest of the session.

The ceiling is deliberately one narrow category rather than everything risky. A gate that prompts on
every ordinary file write is a gate people switch off, and a gate switched off protects nothing. If a
prompt reappears after you enabled Autopilot, it tells you why.

---

## How tools are classified

| Category | Risk | Examples |
|----------|-----------|---------|
| `read` | Low | Reading files, searching, listing directories, diagnostics, diff previews |
| `git-read` | Low | Status, diff, log, blame, listing branches, worktrees, or stashes |
| `network-read` | Low–Medium | A remote call that changes nothing a person is editing but does leave the machine — an MCP `list_tables`, a docs search, `git fetch` |
| `terminal-read` | Low | Read-only commands |
| `audio-input` / `audio-output` | Low | Microphone and speech playback |
| `workspace-write` | Medium | Writing, editing, deleting or moving files; writing to memory; removing a worktree directory |
| `network` | Medium–High | Fetching a URL; pushing commits or deleting a branch on the remote |
| `git-write` | High | Committing, merging, pulling, creating or deleting branches, stash operations that discard an entry |
| `terminal-write` | High | Installs, build scripts, anything that changes state |

Several git skills grade **by their arguments**, the way `terminal-run` grades `git` subcommands: `git-branch`
with `action: "list"` is a `git-read`, with `action: "delete"` a high-risk `git-write`, and deleting on the
remote is `network`; `git-worktree` listing is a read while removal is a `workspace-write`, because it deletes
a directory tree from disk; `git-stash` `list`/`show` are reads while `pop` and `drop` are high-risk writes,
because both discard the stash entry. Unreadable arguments always grade as the write, never the read.

`git-commit` is always a high-risk `git-write`, and its approval summary states when the operation will
stage and commit an exact path list. Exact-path staging is deliberately part of the same approval-gated
tool call: up to 100 tracked or untracked workspace paths are passed after `git add --` and again to
`git commit --only`; unrelated entries already in the index remain staged. `.`, traversal, absolute
paths, control characters and pathspec wildcards are refused. Staging failure stops before the commit.
The broad legacy `stage_tracked` mode uses `git add -u` and cannot be combined with `paths`.

The turn-level no-command ceiling is separate from those approvals. It activates only when the request
explicitly withdraws a broad capability—commands, terminal, shell, packages, scripts, or processes. A
narrow guard such as “release remains subject to approval” leaves Git tools callable so this page's
approval policy can actually gate them; it is not interpreted as “disable every command”.

### Tools AtlasMind hasn't seen before

MCP servers bring tools AtlasMind knows nothing about. Rather than treating everything as maximum risk
(which would make MCP unusable) or minimum risk (which would be reckless), it reads the name:

- Names starting with `get`, `list`, `read`, `search`, `find`, `query`, `fetch`, `check`, `show`, `view`,
  `inspect`, `describe`, `status`, `info`, `lookup` or `count` are treated as **low-risk reads**
- **Unless** the name also contains `write`, `create`, `update`, `delete`, `execute`, `run`, `insert`,
  `remove`, `patch`, `add`, `set`, `push`, `commit`, `deploy`, `send`, `publish`, `upload`, `import`,
  `export`, `reset`, `clear`, `purge`, `migrate` or `install` — then it's **high risk**
- Anything matching neither pattern is **high risk**

Conservative where it's unsure, practical where it isn't.

### An MCP tool has to match what you approved

Risk grading assumes the tool is the one you agreed to. Pinning makes sure of it. Every MCP tool is
pinned on its first connect, and a tool whose description or schema has changed since, a tool the server
didn't have before, or a tool the description scan flags is **held**. "Didn't have before" counts from the
server's first successful listing even when that listing was empty, so a server can't list nothing when
you enable it and add tools later to skip the review. It isn't registered, so no approval
mode, Bypass or Autopilot can reach it. It waits under **Review changed tools** in the MCP panel until you
approve that exact version. See [[Skills]] for what the scan looks for.

When a server disconnects its skills are *suspended*, not disabled as though you had switched them off,
and they come back on when it reconnects. A skill you disabled yourself stays disabled.

### After it reads someone else's text, it asks again

Prompt injection has no parsing fix: a fetched page, an issue body or an MCP answer can contain text
addressed to the agent, and no filter reliably tells it apart from text addressed to you. What can be
recognised is the dangerous moment — **untrusted text went in, and an action that changes something or
leaves your machine is about to come out.** AtlasMind tracks what each task has read and puts you in
front of that moment.

Everything the model reads carries a provenance class — *operator* (you), *AtlasMind*, *workspace*
(repository files, attachments, editor chat context), or *third-party* (a fetched page, a search result,
an MCP server's answer, `gh` output, another agent's answer, a network command such as `curl`, and the
output of **any tool AtlasMind cannot identify**). A task's level is the highest it has read, and it
never goes down. Once the task has read third-party content:

| What the model asks for next | What happens |
|---|---|
| A read — files, search, git history, `npm test` | Nothing new. **Reads stay free**, so research is not slowed down |
| A write, a commit, a terminal command | A **fresh approval**, naming what was read and the rule |
| A network call, including an MCP read | A fresh approval — or, if the content looked like an instruction, **refused** |

A fresh approval is one **Autopilot and Bypass Approvals cannot answer**: both were given before the task
read the content, and "stop asking me" was never an answer to "the page you fetched asked for this". The
dialog offers *Allow Once*, *Deny*, and **Allow for this task — I've seen the source**, which releases that
one kind of action for the rest of the task. It is not offered where nothing may be pre-approved (the
ceiling above).

Third-party results reach the model inside a numbered `REPORTED CONTENT` fence it cannot close from the
inside. If one contains an instruction override ("ignore previous instructions"), it is **kept** — it is
still the page you asked about — with a `[SECURITY]` note, and for the rest of the task the model may not
reach the network at all. Only the instruction-override phrases count: pages *about* prompts say "system
prompt:" and "developer mode" all the time.

- A fetch you **denied** read nothing, so it taints nothing.
- A subtask starts from what its dependencies read, because their output is part of its prompt.
- A task that has read untrusted content is **not handed to a subscription agent's own tools**
  (`taint.acp-delegation`): AtlasMind cannot see what those tools read, so it could not ask you before
  they acted on it.
- `find-tool` does not search Resource Discovery once the task is tainted — the query would be
  model-written text sent off your machine with nobody asked.
- Calls in the *same* round run side by side, so each is judged against what the model had read when it
  asked — which is what it actually knew.

`atlasmind.security.untrustedEscalationScope` widens this to repository content too
(`workspace-and-third-party`). There is no `off`. The rule tables are in
`src/core/contextProvenance.ts`.

#### …and it remembers for the rest of the conversation

What a turn read stays in the conversation's history — and in the model's own summary of it — so the next
turn starts from everything the conversation has read, not from clean. Ask AtlasMind to read a page in one
message and to update a file in the next, and the write asks for a fresh approval even under Autopilot;
the dialog says the page was read **earlier in this conversation**. Under the turn, a short note says the
conversation includes third-party content and that writes will ask.

- **Start a new chat, or clear this one, to reset it.** Nothing else does: deleting or rewinding a message
  does not, because the rolling session summary can still carry what the removed turn read.
- It survives a window reload — it is kept with the transcript. A conversation from before 0.489.1 that has
  history counts as third-party, since nobody recorded what it read.
- A project run started from chat starts from the conversation too, and what its subtasks read comes back
  into it. AtlasMind as an ACP agent keeps the same record per ACP session.
- **Allow for this task — I've seen the source** still lasts one task (one turn). Every per-task grant —
  that one, *Bypass Approvals* for a task, a category bypass — is now dropped the moment its task ends,
  however it ends.

#### …and a long page is read by a model that can't do anything

A fence tells the model the text is data; it doesn't stop the model reading every sentence of a
50,000-character page, and every sentence is another chance to be taken as an instruction. So since
0.490.0, a **third-party result over 8,000 characters** — a fetched page, an MCP answer, `gh pr diff`,
another agent's long answer — never reaches the agent that holds the tools:

1. AtlasMind keeps the full text aside under a handle (`q1`, `q2`, …) for the rest of the task.
2. A **separate model with no tools** — the cheapest fast one available — gets three things: its
   extraction rules, your request as the question, and the text, fenced and redacted. Not the agent's
   prompt, not project memory, not a single tool.
3. Its answer must be one JSON object: up to **20 one-line facts** (300 characters each), **`https` URLs
   copied from the text**, and up to **5 exact quotes**. Anything else is refused whole. A URL the text
   never contained, a "quote" it never said, or a fact shaped like an instruction is withheld and counted.
4. The agent receives that extract, fenced, with the handle — and still marked third-party. Reading it
   taints the task exactly as reading the page would, and if the page contained "ignore previous
   instructions" the task still can't reach the network.

| What happens | What the agent sees |
|---|---|
| The extract validates | The fenced extract, what was withheld, the handle, and a `[SECURITY]` note if the page held an instruction override |
| No model available, the call fails, the read would pass a cost cap, or the answer doesn't validate | The **first 2,000 characters**, fenced, with a `[SECURITY]` note naming the rule. Never the whole page |
| The agent calls `quarantine-read` with the handle | A **fresh approval**, even under Autopilot. Approved: up to 20,000 characters per call, fenced and still third-party. Denied: nothing |

Results under 8,000 characters, and everything from your own machine, reach the agent exactly as before.
Each reader call costs one cheap model request, recorded as `quarantined-reader` in the cost dashboard.
It answers to the same caps as the agent: the task's cost cap and the daily limit are checked against
the reader's worst case **before** it is sent, and a read that would pass either isn't made — the agent
gets the 2,000-character excerpt, with `quarantine.task-budget` or `quarantine.daily-budget` named. What
the reader spent counts toward the task's cap from then on, and toward the cost the task reports.
`atlasmind.security.quarantineReader: off` turns it off — large results then arrive whole and fenced, and
the asking-again rule above still applies. The rules are in `src/core/quarantinedReader.ts`.

### Context is not authority

A rolling chat summary is accepted only when its recorded transcript revision matches the transcript
snapshot being assembled. A stale or unversioned bundle is dropped in favour of current raw history.
Whether context mentions a tool does not add it to the agent's skill ceiling, approve it, or execute it:
capability eligibility and the approval policy below remain separate boundaries.

---

## The terminal is not a shell

`terminal-run` uses a curated allow-list, and it never invokes a shell.

**Always allowed** (read-only): `ls`, `dir`, `cat`, `head`, `tail`, `wc`, `find`, `grep`, `which`,
`where`, `whoami`, `echo`, `pwd`, `env`, `printenv`, `date`, `hostname`, `uname`, `file`, `stat`, `du`,
`df`, `tree`.

**Allowed after approval**, and only with `atlasmind.allowTerminalWrite` on: `npm`, `npx`, `yarn`,
`pnpm`, `pip`, `python`, `node`, `cargo`, `go`, `dotnet`, `make`, `cmake`, `mvn`, `gradle`.

**Always blocked, no setting changes this:**

- `rm -rf`, `sudo`, `chmod`, `chown`, `mkfs`, `dd`, `kill`, `shutdown`, `reboot`
- Shell operators — `|`, `&&`, `||`, `;`, backticks, `$()`. There's no interpolation to exploit
- Anything not on the list

Commands run through direct process execution rather than a shell, so there's no shell injection surface
at all.

**Docker gets the same treatment.** Read-only inspection (`version`, `info`, `ps`, `images`, `inspect`,
`logs`, and the Compose equivalents) plus lifecycle commands (`start`, `stop`, `restart`, `up`, `down`,
`build`, `pull`). Inspection is low-risk; lifecycle follows the high-risk approval path.

### The GitHub CLI

`gh` is graded by **verb**, not by namespace. `gh pr list`, `gh pr view`, `gh issue list`, `gh run view`
and `gh auth status` are reads. `gh pr create`, `gh pr merge`, `gh issue close` and `gh release create`
are writes and follow the approval path. Grading by namespace would have put *reading* a pull request
behind the same prompt as *merging* one — which is how a gate ends up switched off wholesale.

An **unrecognised** subcommand is treated as a write. `gh` gains subcommands regularly, and guessing
"probably a read" is the expensive direction to be wrong in. `gh api` is always a write, because it is
arbitrary — `gh api -X DELETE …` is an ordinary use of it.

**Refused outright, at any setting:**

| Refused | Why |
|---|---|
| `gh auth token` | Prints your GitHub token to stdout, which becomes model context. No approval makes that safe |
| `gh auth login` / `logout` / `refresh` / `setup-git` | Changes how the machine authenticates, outside the sandboxed workspace |
| `gh ssh-key` / `gh gpg-key` | Same |
| `gh secret` / `gh variable` | Reads or writes repository credentials |
| `gh alias` | Would redefine what a later `gh` command does |
| `gh repo delete` | Irreversible, and remote |

The refusal anchors on `gh`'s own namespace names rather than argument positions, so a global flag with a
value — `gh --hostname github.com auth token` — cannot slip past by shifting the arguments along. It is
not a substring search: `gh pr comment --body "see the auth token docs"` is an ordinary comment and runs.

### What a command can see of your environment (0.500.1)

An agent's command on your machine is started with the environment `planHostCommandEnvironment`
(`src/core/hostCommandEnvironment.ts`) returns — not the editor's whole environment, which used to hand it
every provider key and token your shell exported. Each variable goes through `HOST_COMMAND_ENV_RULES` in
order, and the first rule that matches names the outcome:

| Rule | Looks at | Effect |
|---|---|---|
| `atlasmind-secret-store` | `ATLASMIND_PROVIDER_*`, `ATLASMIND_INTEGRATION_*`, `ATLASMIND_SPECIALIST_*` — where the CLI reads its keys | withheld |
| `named-credential` | `CREDENTIAL_ENV_NAMES`: the variables AtlasMind's adapters read (`AWS_*` keys, `BUZZ_PRIVATE_KEY`), vendor keys, `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN`, `NODE_AUTH_TOKEN`, `HF_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, `VSCE_PAT`… | withheld |
| `credential-name-suffix` | A name ending `_API_KEY`, `_TOKEN`, `_SECRET`, `_SECRET_KEY`, `_ACCESS_KEY(_ID)`, `_PRIVATE_KEY`, `_PASSWORD`, `_PASSWD`, `_PASSPHRASE`, `_CREDENTIALS`, `_PAT`, `_DSN`, `_CONNECTION_STRING`, `_AUTH`, or an account/storage/signing key | withheld |
| `credential-name-word` | `AUTH_TOKEN`, `API_KEY`, `SECRET_KEY`, `PRIVATE_KEY`, `CLIENT_SECRET`, `PASSWORD`, or a `TOKEN_`/`SECRET_` segment elsewhere in the name | withheld |
| `proxy-userinfo` | A `*_PROXY` URL with `user:password@` | passed with the userinfo removed |
| `proxy-unreadable` | A `*_PROXY` value with `@` that is not a URL | withheld — editing it would be guessing |
| `secret-shaped-value` | A value `secretRedactor`'s detectors recognise, under any name | withheld |

Names are matched case-insensitively. A name in `atlasmind.terminal.passEnvironment` (machine-scoped, user
value only, exact names validated rather than cleaned) passes unchanged — exactly on macOS and Linux, in any
casing on Windows. Everything else — `PATH`, the Windows system variables, `HOME`, toolchain homes,
`NODE_OPTIONS`, `SSH_AUTH_SOCK` (a socket grants use, not disclosure) — passes as it was. When a command
fails, one line is added to its stderr naming the withheld variables and their rules, never a value.

Covered (`HOST_COMMAND_ENV_COVERED_PATHS`, each checked by a test against its file): `runCommand` under
sandbox mode `off`, the CLI's `runCommand` (pass-through from `ATLASMIND_PASS_ENVIRONMENT`), and the ACP agent
process (pass-through plus the agent's declared `env`; the list is part of its settings stamp, so changing it
replaces a live agent). Unchanged (`HOST_COMMAND_ENV_UNCHANGED_PATHS`): the sandbox (stricter — an
allowlist), what you start yourself (terminals, routines, Delivery, promotions, local CI), MCP servers (their
own rule), and two model-chosen paths it cannot reach — the managed-terminal follow-up, which runs in your own
shell, and a debug launch, whose environment comes from the launch configuration. Both are refused under
`require`.

A model-requested command that relied on a token from the editor's environment now fails until its name is
passed through.

### Running commands in a sandbox (`atlasmind.sandbox.mode`)

The rules for running an agent's command inside a container are in `src/core/sandboxPlan.ts` (0.498.3),
the engine can be checked with **AtlasMind: Check Execution Sandbox** (0.499.0), and since **0.500.0** the
runner is wired (`src/core/sandboxRunner.ts`). With `atlasmind.sandbox.mode` set to **`require`**, every
command an agent asks for runs in the container or is **refused, with the rule that stopped it** — never run
on your machine instead. With it **`off`** (the default) nothing changes: commands run on your machine
exactly as before (with the environment rules above), and AtlasMind starts no container engine process at all. Four things decide where a
command runs:

1. **Is it a command that can be sandboxed?** git, `gh`, `docker`/`podman`/`kubectl`, network tools
   (`curl`, `ssh`, `rsync`…), and anything that publishes, changes history or installs packages — the same
   list a scheduled routine refuses — are never sandboxed. Under `require` they are refused, which includes
   the git skills (commit, push, branch, merge…) that run git through the command runner. AtlasMind's own
   git tools (status, diff, log, branch listing, applying a patch) stay on your machine.
2. **Is the sandbox attested?** A Linux container engine, a known user mapping, an image pinned by
   `sha256` digest and already present (a tag is refused; nothing is pulled), a canary that ran, all read
   within the last ten minutes. A command that finds no fresh reading takes one — once, shared by commands
   that arrive together, and abandoned after three minutes — and a fresh reading that says *unavailable* is
   not taken again until it is ten minutes old.
3. **Are its dependencies prepared? (0.503.0)** A command that loads installed packages — `node`, `npm`,
   `pnpm`, `yarn`, `vitest`, `tsc` and the other common JavaScript tools, anything under `./node_modules/`,
   or a `sh -c` step naming one — runs only with a **dependency volume** prepared for the folder's current
   lockfile. Your own `node_modules` is never used in the container: on Windows and macOS it holds binaries a
   Linux container cannot load, and a scheduled run's fresh worktree has none. Without a volume the command is
   refused — *dependencies not prepared* — and **AtlasMind: Prepare Sandbox Dependencies** is the fix. A
   changed lockfile needs preparing again. A command that loads no packages runs either way.
4. **Does the run itself pass?** One mount of the project or worktree folder — refused if it is or contains
   your home folder, a credentials folder, the engine socket or the ssh agent — plus, when one is ready, the
   dependency volume at `/work/node_modules` and nowhere else; a working directory inside the folder, an
   executable named the way the container knows it (`npm`, `./node_modules/.bin/vitest`; never a path on your
   machine), and limits that can be stated.

The container has no network, no capabilities, no privilege escalation, a read-only system and a bounded
`/tmp`, and only allowlisted environment variables; provider keys never cross. A variable on the allowlist
whose value fails its check is left out and named in the command's output. Output is clipped the same way
it is on your machine.

**What else `require` covers.** A routine step (`/ship`, the Run Center, a scheduled routine) runs in the
container as `sh -c <step>` — the shell is the container's — with the folder the run uses mounted, which for
a scheduled run is its own worktree. Three paths cannot be put in a container and are refused instead: the
one follow-up command a model chooses after a managed-terminal command (your own command still runs), an ACP
agent's request to execute something under `atlasmind.acp.toolsEnabled`, and the model starting or
evaluating in a debug session.

**What it does not cover.** Commands you start yourself (the managed terminal's own command, the Delivery
run plan, promotions, local CI), tools of MCP servers you connected, a model-written skill (off by default,
and reviewed before it runs), and the `atlasmind` CLI, which has no settings and so no mode.

**Timeouts and closing the window.** A command that times out has its container removed by its own name
(`atlasmind-sbx-…`) — `rm --force`, which also catches one created but never started. Closing the window
removes any container still running for it. When a window opens with the mode on `require`, it removes
labelled containers older than ten minutes — older than any command may run, so never another window's
live command.

By itself it **does not change approvals**: a command still asks where it asked before. Dry run wins — a
sandboxed command in a dry run is recorded, and nothing is probed or started. A command after untrusted content
still needs a fresh approval, and scheduled routines keep refusing installs. Loosening approvals for sandboxed
commands is the separate opt-in below.

**Sandboxed terminal writes can stop asking (0.501.0).** Switch on `atlasmind.sandbox.relaxTerminalApprovals`
in your **user** settings (a repository's value is ignored) and a terminal write skips its approval prompt when
every one of these holds for that call: the mode is `require`, the sandbox attestation is confirmed, and this
exact command would run in the container. It runs there without asking, and the output channel and the run
record say so, citing the rule, the sandbox session, the attestation id and when it was probed, the image and its
digest. Above it, in order, and never loosened by it: dry run (nothing runs), `atlasmind.allowTerminalWrite`
(off still refuses), a turn that read untrusted content (still asks — even after *I've seen the source*), and
the never-bypassable list. Only `terminal-run` is covered; file writes, git, network calls and `test-run` ask as
before, and so does a command the sandbox would not run (git, an install, a network tool — which `require` then
refuses anyway). The approval is tied to the exact sandbox session that was checked: if its ten-minute reading
expires before the command starts, the command is refused — never run on your machine, never re-probed onto a
different reading, never asked about after the fact. **What you are trusting:** the model may change any file in
the mounted folder without asking. It cannot reach the network, your credentials or anything outside that folder.
A status bar item shows *Sandboxed writes* while it is active (or *Writes ask*, with the reason), and **Check
Execution Sandbox** lists the rules.

**Preparing dependencies (0.503.0).** **AtlasMind: Prepare Sandbox Dependencies** installs the folder's
lockfile into a volume named for it (`atlasmind-deps-<16 hex>`, from the lockfile's bytes, the image digest,
the package manager, the engine, the platform, the user and whether install scripts ran). It runs only when you
ask, only in a trusted workspace, and shows every engine command and what network access means before anything
starts. It is the sandbox's **one network-on container**: it sees only `package.json` and the lockfile, mounted
read-only — not your source, not `.npmrc`, not your environment — and writes only into the volume, with every
capability dropped. Install scripts are **not** run (`--ignore-scripts`); a package that builds native code in
an install step may not work, while prebuilt-binary packages such as esbuild, rollup and swc do. Running them is
a separate button and a separate warning: they are arbitrary code from every package in the lockfile, with
network access. On a Linux host a container with no network, holding only the right to change ownership, first
makes the empty volume yours. npm, pnpm and Yarn 1 are supported; Bun, Yarn 2+, workspaces, a symlinked
manifest or lockfile, several lockfiles or none are refused with the rule. A dry run records it and starts
nothing; a scheduled routine never prepares — it stops at the step and reports *dependencies not prepared*.
Volumes accumulate as lockfiles change: **AtlasMind: Remove Sandbox Dependency Volumes** lists AtlasMind's and
removes the ones you pick (never one a running command still uses). *Check Execution Sandbox* shows whether
the open folder's dependencies are ready.

**Checking the sandbox (0.499.0).** *Check Execution Sandbox* runs only when you ask. It runs
`docker`/`podman` `--version`, `info` and `image inspect` of the pinned image — reads, which a dry run lets
through — and then one canary container, built with exactly the argv a sandboxed command would get, running
`test -d /work` with no network and your project folder mounted. The canary is an effect, so in a dry run it is
not started and the sandbox reads unavailable rather than confirmed. Nothing is pulled; the report says which
rule failed and gives you the commands to fix it. A reading is kept in memory for ten minutes.

---

## Saying "read-only" actually means read-only

If your message says to explain, review or inspect **without** writing files, running commands or
executing tests, AtlasMind removes those tools before the model ever sees them — and checks again
immediately before execution.

A model that hallucinates a write tool, or is talked into one by injected text, gets a denial. The tool
isn't there to call.

**It holds for the whole job, not just the first step.** Until v0.437.0 it did not. A multi-step
project run breaks your request into steps, and each step worked out its own permissions from the
*generated* description of that step — which describes the work, not the limits you put on it. So
"audit this, read-only" restricted the step that planned the work and none of the steps that carried
it out. The limit is now taken once from what you typed and travels with the work. Where a step has a
restriction of its own the two combine, and combining can only narrow.

**One thing worth knowing:** a turn with no restriction at all permits everything, which is what makes
ordinary use possible. The protection therefore depends on every path working out your limits rather
than skipping the question — which is exactly what went wrong above, and is now checked by a test that
fails if any step is started without them.

It applies to subscription agents too: on a restricted turn, delegated tools are switched off, because an
external agent must not be able to substitute its own file writer for a capability you withheld.

The boundary is **per turn**. It doesn't leak into your next request.

### Some agents are permanently read-only

The ethics, legal and commercial advisors have a fixed read-only tool list: file and directory reads,
search, git status/diff/log/blame, diff preview, diagnostics, code symbols, framework detection, memory
*queries*, and URL fetching. No writes, no commits, no terminal, no containers, no test runs.

This is enforced when tools are resolved, not requested in a prompt. **The tools are simply never
offered.** The reasoning is separation of duties: something that reviews whether a change *should* ship
shouldn't also be the thing that ships it.

## Dry run: see what would happen, with nothing done

Turn on **AtlasMind: Toggle Dry Run** (`atlasmind.dryRun.enabled`) and the agent works exactly as it
would — it reads, plans and calls tools — but **nothing that acts is run**. A call that would write a
file, run a command, change git or reach the network gets back a description instead of a result:

```text
[DRY RUN — nothing was executed]
Would have: modify workspace files using file-write.
Tool: file-write · category workspace-write · risk high · rule dry-run.default.
Would have asked for approval: yes.
Arguments (redacted): {"path":"src/app.ts","content":"…"}
Plan as if this succeeded, but do not claim that it happened …
```

The reply ends with a list of everything that would have happened, in order, and the **AtlasMind Dry
Run** output channel keeps the session's record (memory only: a fingerprint and a redacted preview of the
arguments, never the arguments themselves).

**What still runs.** Only AtlasMind's own built-in skills that the published table grades as **local
reads** — file reads, searches, directory listings, `git status`/`diff`/`log`, diagnostics, symbols,
framework detection, terminal output already on screen, memory queries — so the plan is grounded in your
real workspace. `atlasmind-settings` runs for `get` and is described for `set`. Everything else is
described:

- **Commands, including "read" ones.** `npm test`, `eslint` and `git blame` all start a subprocess, and
  `npm test` runs whatever your `package.json` says. A dry run starts no subprocess.
- **Network reads.** A fetch changes nothing here, but it carries a model-chosen URL or query off the
  machine — the same channel the untrusted-content rules guard.
- **MCP tools, workspace and model-written skills, and names nothing registered.** AtlasMind cannot grade
  code it did not write, and it does not write a skill to find out what one would do.
- **Asking another agent.** The delegate runs its own tools, and a dry run cannot prove the delegate
  inherits it.

**What a described call does not do.** It asks nobody, takes no checkpoint, starts no verification, fires
no tool webhook, and is not counted as something the agent has read — a described fetch read no page, so
it does not make the next write ask again. If the call *would* have been refused or needed a fresh approval
because the task had read untrusted content, the description says so.

**Underneath the table.** A built-in allowed to run gets a skill context in which every method that can
change something — write, delete, run a command, fetch, apply a patch, start a debug session — throws
instead. A local read that reached one would be a bug in the table; the context turns that bug into a
refusal (reported in the summary) rather than a write.

**Also off for a dry turn:** worktree isolation (making a worktree is itself a write), handing the turn to
a subscription agent's own tools (they run where nothing can be described), and the Resource Discovery
search `find-tool` can fall back to.

**What it does not stop.** Model calls still run and still cost money — including the quarantined reader —
because they are how the turn decides what it would do.

### Outside a chat turn, too

The same switch covers what AtlasMind does on its own account, outside the agent's tools. Each of these is
recorded in the same **AtlasMind Dry Run** output channel, with the rule that stopped it, instead of being
done — and when it was a button you pressed, a notification says plainly that dry run is on and names what
was not done (with a button to open the output):

| What | In a dry run |
|---|---|
| **Routines and `/ship`**, the Run Center | No step runs. `/ship` shows the commands it would have run; nothing is written to run history, because a routine that never ran did not fail. |
| **Promotions, Resolve & run, rollbacks, the health-check Test button** | The promotion returns its plan as the record — every step marked *Dry run: would have run …* — and runs no command and no health check. Nothing is written to the path's last promotion or the delivery history, because nothing shipped. Resolve & run edits and commits nothing. |
| **git and GitHub from the dashboard** | Every git command goes through one helper and every `gh` command through one boundary, each graded by a published read list: `status`, `log`, `diff`, `rev-parse`, `issue list`, `api` GET and the like still run, so the pages keep rendering; deleting or switching a branch, pulling, fetching, pushing, and creating, commenting on, closing or labelling an issue or pull request do not. |
| **Messages** | Director emails and invites through a connector, Buzz posts and DMs, tool webhooks (the *Send test* button included) and the ACP agent's Buzz auto-reply are not sent. |
| **MCP tool calls from anywhere** | Refused at the registry before `callTool`, whoever asked — the backstop under the tool loop and under every panel. |
| **Terminals** | Nothing is typed into a terminal — not the delivery and local-CI *send to terminal* commands, not chat's *Send to terminal*, not the setup walkthroughs' prepared commands — and no runbook column or managed-terminal command runs, including the one follow-up command the agent can choose; the agent is told it did not run. |
| **Processes and installs** | Installers (runtimes, the GitHub CLI, ACP agents, local models), the website stack setup, the portal deploy, launching a game engine, the local CI runner container, and `/bootstrap` (which writes a model-drafted scaffold, runs git and can create a repository) do not start. |
| **Live services** | Lens probes — HTTP, GraphQL, SQL over HTTPS, direct database connections, MCP schema tools — and Resource Discovery searches are not sent. |
| **Editing a project file from a panel** | A UI Studio element edit — text, attribute, insert, remove, move in a found HTML page — is not written. Its confirmation still shows the lines before and after, so the dry run previews exactly what would change. |
| **Writes AtlasMind makes on its own** | The memory self-heal pass, the background snippet refresh, the automatic stale-memory re-import, the project-run report written after a run, the gap analysis saved after its turn, the roadmap anchors written when the Roadmap page loads, the roadmap rule written into agent instruction files, and the MCP environment cache are recorded, not written. |

**What still runs outside a turn, and why** (published as `DRY_RUN_HOST_EXEMPTIONS` in `src/core/dryRun.ts`):

- **Reads** — git and `gh` reads, version probes, local file reads. A dashboard that went blank in a dry
  run would preview nothing.
- **Model calls** — as in the tool loop.
- **A save you press a button to make** — a panel form, a register entry, a template, a report, a scan's
  findings, a starter workflow. That is you editing your own project, not AtlasMind acting.
- **AtlasMind keeping its own records** — session state, run history, cost records, caches. A dry run
  that could not be recorded could not be reviewed.

A test (`tests/security/dryRunCoverage.test.ts`) scans the source for every call shape that can act — a
process, a request, an MCP call, a skill execution, a file write, a terminal send, the shared process and
`gh` helpers — and fails until each file that has one either calls a dry-run guard or is listed with a
written reason for running anyway.

**On and off.** Turning it on applies to the very next tool call. Turning it off waits for the next
message, so a run planned dry cannot finish half-real. It is a user setting only — a repository's
workspace settings cannot turn it off for you — and a value AtlasMind cannot read counts as **on**. While
it is on, a *Dry run* item with a beaker sits in the status bar in the warning colour; click it to turn dry
run off. In the CLI, `--dry-run` does the same for `chat` and `project`, and the ACP agent
(`atlasmind-acp`) takes `--dry-run` too — it runs outside the editor, so it cannot read the setting.

---

## Before anything is written

**CI starter creation is a host-owned create-only action.** The Pipeline webview sends no YAML, path,
branch or command. AtlasMind re-reads the project, derives one closed starter from its workflow config,
lockfile and package scripts, confirms the exact file/branches/checks, and writes with `wx`. If a quality
CI workflow already exists, or the target appears before the write, creation is refused. Release-only
automation remains separate because it is not evidence of pull-request validation. Existing
workflows can be opened or reviewed as proposals, never overwritten, disabled or deleted from this
surface.

**A runner is execution authority, not merely a destination.** AtlasMind's repository does not expose its
isolated runner to `pull_request` or `pull_request_target` events. Its separate workflow accepts an owner
`develop` push or exact-ref manual dispatch before selecting one custom label; the
job gets read-only contents access, no secrets or OIDC, and checkout does not leave its token in Git. The
hosted release matrix retains different check names, so a single local Linux job cannot impersonate
Windows and macOS release evidence.

**The Pipeline runner controls are host-owned and payload-free.** The browser can ask to inspect, start,
show output, copy the queue command, or send it to a terminal; it cannot supply a repository, workflow,
ref, SHA, actor, label, image, resource limit,
container argument or shutdown policy. The host reads machine-scoped settings and performs the complete
preflight again. Start requires exactly one waiting owner-authored run in total for current HEAD, a committed trusted
workflow with only push/manual reachability, exact repository/ref/actor conditions (the owner, or one account
pinned by id in an organisation-owned repository), `contents: read`, no
secret or OIDC/write grant, full-SHA action pins, `persist-credentials: false`, a label unique across local
workflows, and no competing runner registration. It does not expose a dispatch or rerun operation.

The queue line is reconstructed in the host from constrained workflow/ref settings. Stale-run recovery is
the narrow exception to payload-free control: the browser supplies one positive run id, and the host
constructs the fixed cancel line only if that id remains in the current waiting-run preflight issue. Both
Copy and Send expose the complete command. Send uses VS Code's configured shell and `addNewLine: false`, so
it types for human review but does not execute on Windows, macOS, or Linux.

The Runner installation guide is not a fourth execution control. Inspection adds bounded direct
`docker --version`, `gh --version` and `gh auth status --hostname github.com` probes with no shell and does
not return their output to the webview. “Not inspected” is a separate state from “missing”; help appears
only for a proven missing item. A button carries an opaque id, and the host opens one fixed official URL—no
installer command or browser-authored URL crosses the boundary. GitHub browser login is static guidance.
The effective permission value and source are re-read in the extension host; the browser cannot supply them. Start itself
discovers both pending and queued workflow runs during preflight, so no webview-authored run id or premature
queue claim is needed. Exactly one waiting run in total must match current HEAD; a stale second run refuses.

The registration token is the exception that proves the GitHub CLI boundary: `pipeGhStdoutOrThrow` starts
`gh` with argv and no shell, connects stdout directly to Docker stdin, bounds/redacts failure text, and
never returns the token to its caller. Docker also receives argv, not a composed host command line. The
fixed shell fragment inside the already-isolated Linux image reads the token into one variable, registers
with `--ephemeral --no-default-labels`, unsets it, and replaces itself with the runner listener; no
repository-derived value is interpolated into that fragment.

The container gets no host mount, Docker socket, inbound port, GPU, persistent volume or default label.
It runs a resolved image id with CPU, memory, no-swap and process limits, all capabilities dropped and
privilege escalation disabled. Docker Desktop starts only after confirmation. Cleanup refuses to stop it
when another container runs or inventory cannot be read, and never manages an ordinary Linux daemon.

**Reviewed pull-request local CI is an explicit code-execution approval, not automatic PR CI.** The
repository patch commits a fixed controller on a trusted base branch. AtlasMind refuses drafts and forks,
shows one exact current head SHA, re-reads it after approval, and dispatches a manual workflow whose run
name includes that PR and SHA. It snapshots the queue first and gives the newly created run id to the
runner, so a neighbouring dispatch with the same base SHA cannot be claimed. The workflow takes inputs
through environment variables rather than interpolating them into shell source; candidate commands are
argv pairs and shell executables are rejected. The job receives no repository/environment secret, host
mount or Docker socket, but it does retain outbound network access for GitHub and dependency installation.
Reviewing the exact diff remains mandatory; the container is defence in depth rather than proof that
malicious code is safe.

**Pipeline visuals are not an execution bridge.** Selecting a Studio subview or moving a workflow node
changes only VS Code webview state. The graph cannot supply YAML, a command or a host path. Monorepo and
package cards come from bounded extension-host reads; registry configuration is checked for presence but
its values are never opened. Test and analytics cards render observed report/run data and leave absent
history unknown rather than inviting an agent to manufacture it.
The compact setup renderer changes visibility, not authority. It derives one next action from the same host
snapshot, keeps critical blockers visible, and places completed diagnostics and technical evidence behind
disclosures. Opening or closing a disclosure sends no host message and cannot enable or start a runner.

**GPU discovery does not grant GPU access.** Inspecting the machine can report device identity,
trustworthy VRAM readings and Docker-advertised runtimes. Those fields are evidence only. The local runner's
fixed access policy remains disabled, and the Docker argv never includes `--gpus`.

**Checkpoints.** A snapshot is taken before each write, so a failed step can be rolled back to exactly
how things were.

**Verification.** With `autoVerifyAfterWrite` on (the default), your own scripts run afterwards — `test`
by default, and you can configure which ones.

**And a response can't claim success while its own verification failed.** If the answer says the work is
done but the verification reports a failure, AtlasMind surfaces that rather than letting it read as a
win.

### The red-green gate

In implementation mode, until a relevant **failing test** has actually been observed, AtlasMind blocks:

- Non-test workspace edits
- Git writes
- Installs and mutating build commands
- Network and other external tools

This stops an over-eager or manipulated model from reaching straight for third-party software and
external side effects before there's a concrete signal to anchor the change against.

If the gate blocks a write and the model responds by merely *describing* the fix, AtlasMind re-prompts
once for the actual red-green cycle. If it still doesn't, a **"Change not applied"** note is appended to
the reply — so a described-but-blocked fix can never read as though it landed.

---

## Autonomous runs get extra checkpoints

On top of per-tool approvals, the Mission Loop adds **iteration-level checkpoints**: every N iterations,
the first time spend crosses a fraction of your budget, or before any batch of writes.

- **Deny by default.** Dismiss the prompt, lose the hook, hit an error, or stop the run, and it resolves
  as *stop*. The loop never proceeds unattended because something went wrong with asking you
- **In addition to, never instead of, per-tool approvals.** A git write inside an approved iteration
  still hits its own card
- **Deployments are never executed directly.** A goal implying a staging or production deploy is surfaced
  as a checkpoint and routed through the guarded [[Delivery|delivery pipeline]]
- **AtlasMind never force-pushes**

### It asks before it gives up

If the loop can't make progress because one of *your* settings is in the way — tests can't run because
terminal writes are off, say — it asks rather than silently stopping: **override for this run** (reverted
when the run ends), **open settings**, or **stop**. Deny-by-default, and it won't nag about the same
setting twice.

---

## A scheduled routine asks once, and stops where it would ask again

A routine that runs on a schedule has a person present exactly once — when they approve it — and never
again. So the approval is of **the exact steps shown**, recorded as a fingerprint: editing any step
withdraws it. And three kinds of step are refused unattended by declaration, whatever the routine says:
anything that leaves the machine (push, publish, deploy), anything that changes git history or acts on a
pull request, and anything that installs packages. Nothing that would need an approval is auto-approved —
the run stops at that step and reports that it needs you. A step whose failure would have asked you
(`on_fail: prompt`) stops instead. Every run is in its own worktree, never your working tree, and the
scheduler holds no model, so there is no tool call to approve and no untrusted text in any model's context.
See [[Project-Planner|Routines that run on their own]].

---

## A half-finished task is not started over elsewhere

If a model fails partway through a task, AtlasMind normally hands the task to another model. That means
running it again from the top, which is harmless for reading and wrong for a commit, a push or a
publish — the second model repeats what the first already did.

So every tool call that can change something is noted as it starts. Only reads — files, git history,
web lookups, read-only terminal commands — are exempt, and a call AtlasMind can't classify counts as a
change. If the attempt then fails, the turn **stops** instead of failing over, lists what had started,
and suggests checking `git status` and `git log -3` before you ask it to continue. A subscription agent
running its own tools is treated the same way once it has your prompt, because AtlasMind cannot see which
of those tools ran.

---

## Installing things

**MCP runtimes and subscription agents are confirm-before-install.** AtlasMind shows you every command it
intends to run and what each one is for, then waits.

Two properties hold there:

- **Every install command is a constant in AtlasMind's own source.** None is parsed from documentation
  or generated by a model — that would be remote code execution with extra steps
- **No shell.** Commands run as a program plus arguments, never as a command line

Where elevation is needed, AtlasMind uses a non-interactive form that **fails rather than prompting** —
an extension has no terminal to read your password from. Those steps are reported as *do this yourself*
with the exact commands, rather than offered as a button that couldn't work.

**Things found through Resource Discovery are also confirm-before-install**, including from the
**Review & install** buttons chat shows when no installed tool fits. The confirmation names the finder
that returned it, its source URL, and that the relevance score is not a trust rating; for an MCP server it
shows the exact command line it would run (or the URL it would connect to) and the environment variable
names, and says it will be added **switched off**. The chat button sends only the resource's identifier;
AtlasMind looks it up in its own search results, so a crafted message cannot describe what gets installed.

**An agent distributed only as an archive gets no install button at all.** AtlasMind doesn't download and
unpack archives, so it names the launch command and tells you it's manual.

The same distinction applies to project generators. BigCommerce Catalyst and Wix Headless Commerce are
shown as **handoffs**, not runnable AtlasMind tools: their upstream CLIs can authenticate, provision
remote resources, install dependencies, create Git history, and publish. AtlasMind writes the reviewed
command and acceptance gates into the workspace but never runs it. Project-name input is not substituted
into shell syntax. Magento and WooCommerce native shells are local create-only file plans and likewise do
not run their installation or platform commands.

Next.js, React Router, Laravel, Django, and Astro Content bootstrap options are handoffs for the same
reason. Their commands can retrieve and execute packages, write large changing source trees, initialize
repositories, create environment secrets or databases, run migrations, and shape deployment. Bootstrap
records those effects and acceptance gates but never submits a command to the runner. Next.js/Astro flags
make install and Git separate operator steps where upstream supports that distinction; Laravel and Django
remain explicit interactive/versioned procedures rather than AtlasMind inventing safety flags. The native
Static Website plan writes only bounded create-only files and its CI uses no dependency installation.

The Next.js, SvelteKit, Nuxt, React/Vite, and Vue Frontend options are also documentation-only in
`/bootstrap`. Literal `<folder-name>` placeholders are never replaced with intake text, and `sv create`,
`create-nuxt`, `create-vite`, and `create-vue` are not submitted to a terminal. Website Studio's separate
setup surface can plan only catalog constants behind its full command/file preview and confirmation gate;
React and Vue intentionally degrade to vendor documentation there because Vue is interactive and a bare
React starter cannot safely choose the project's routing and data architecture.

React Native, Expo, and Flutter Mobile options follow the same documentation-only rule. Bootstrap never
submits `npx @react-native-community/cli`, `create-expo-app`, or `flutter create` to a terminal. The bare
React Native path calls out its dependency/native-toolchain effects and the framework-first recommendation;
Expo uses supported no-install and no-agent-instruction flags but leaves native generation and EAS for
separate review; Flutter states that its installed-SDK generator retrieves dependencies. Emulators,
physical devices, signing credentials, cloud builds/updates, and app-store actions require their own
operator decisions and are never implied by selecting a prefab.

---

## Subscription agents and their tools

`atlasmind.acp.toolsEnabled` — **Let subscription agents act** — is the standing, off-by-default
authorisation for tool-backed work through a subscription agent.

With it on, AtlasMind still requires the orchestrator to have authorised that exact request. Discovering
an installed agent grants nothing. Ticking the box grants no individual operation. Each operation the
agent requests is answered once and **logged with its category, risk and action**.

**AtlasMind never selects "always allow".** The protocol offers it; accepting would store the permission
inside the other agent's own state, where AtlasMind could neither show it to you nor revoke it. If
"always allow" is the only way to approve something, the operation is declined instead.

Server commands the client declares are never started, and MCP servers are shared only from a list you
named — never one holding stored credentials.

A task that has already read third-party content is not delegated to a subscription agent's own tools at
all (`taint.acp-delegation`) — see *After it reads someone else's text* above. When AtlasMind itself is
the agent behind an ACP client, every non-read operation is already asked per call; after untrusted
content the request title says so and names the source.

### A local runtime's own tools

Some local runtimes can run tools themselves inside a completion. Unsloth Studio can run Python, a shell
and web search, and `unsloth studio run` turns that on by default. A tool AtlasMind never sees cannot be
classified, approved, sandboxed or simulated. So every completion sent to an Unsloth endpoint asks for
Studio's own tools off (`enable_tools: false, mcp_enabled: false`), and the tools AtlasMind offers the model
stay the only ones that run. A Studio started with `--enable-tools` overrides the request, and AtlasMind
cannot detect that, so start Studio with `--disable-tools`. See [Security](Security.md#a-local-runtime-that-can-act-on-its-own).

Managing Studio's models is held to the same rules as any other effect: downloading and loading, unloading
and deleting each pass the dry-run guard, and downloading and deleting ask first.

---

## Remote sessions get no shortcuts

When a session is driven from the web build, the same approval cards apply. A remote peer can never
auto-approve a write, a git operation, a terminal command or a network call.

Remote approvals are audited. **If the connection drops, pending approvals default to denied** and any
in-flight execution is aborted.

This holds identically in gateway mode: the gateway authenticates the transport, and grants no tool
authority whatsoever.

UI Studio's **Verify fingerprints** is deliberately not a source-editing tool. It reads one explicitly mapped,
workspace-relative regular file after real-path containment checks, caps the read at 2 MiB, and retains only a
SHA-256 hash. The mapping itself is revision-checked data and does not authorize imports, commands, code
execution, or writes. A design-only/code-only/conflict result remains advisory. If a later adapter proposes a
source diff, applying it must enter the same risk classification, approval, execution, and verification path as
any other project-file mutation.

**Import source evidence** uses that same read-only snapshot and is not an execution shortcut. Its exact
webview request carries only mapping id plus revision. A fixed local recognizer produces bounded facts,
suggestions, provenance, and mandatory loss/unsupported findings without loading a dependency or running a
build, script, template, extension host, or model. Copying a suggestion changes only form text; accepting it is
a separate mapping edit. Neither operation authorizes a project-file write.

---

## Arguments are arguments, never commands

Every command AtlasMind runs is spawned with the arguments as an array and **no shell**, so a `&`, `|` or
`>` among them is a character the command receives rather than something an interpreter acts on.

This was not always true on Windows, and the exception is worth knowing because the reasoning for it was
plausible. `npm` on Windows is `npm.cmd`, which cannot be spawned directly, so the path used a shell to
make it work — and a shell joins the argument array into one string without escaping it. Since those
arguments are written by a model, an argument list ending `&`, `curl`, `...` ran a second command that no
approval dialog ever showed. Fixed in v0.406.0 by resolving the shim to its real entry point instead.

---

## The CLI is stricter

There's no panel to approve things in, so: local reads work, workspace and git writes need
`--allow-writes`, terminal commands need `--allow-commands`, and high-risk external tools stay blocked.
File operations resolve real paths before the workspace check, so a symlink can't be used to escape the
sandbox.

**Terminal commands are their own flag, and used to be free.** `npm test`, `npm run build` and
`npm run lint` grade as `terminal-read` — a name describing what they report, not what they do to
report it. Every one executes whatever the repository's own `package.json` defines, so "read-only"
mode could still run arbitrary code out of the checkout it was pointed at. `--allow-commands` is
deliberately separate from `--allow-writes`: running a test suite is not a reason to also be able to
change files.

**After a task reads third-party content, a write is refused** rather than asked about — there is
nobody to ask, and the flags were chosen before the content was read. `--allow-untrusted-escalation`
lets the flags above decide instead; it grants nothing on its own, so a write still needs
`--allow-writes`. The same goes for `quarantine-read`: releasing a quarantined result's full text is
refused in the CLI unless you pass `--allow-untrusted-escalation`.

---

## Underneath all of it

Before any approval mode or risk classification is even considered, an **immutable baseline** applies:
your consent never authorises illegal activity, evading the law, targeted harassment, defamation, or
deceptive attacks on a person. No setting reaches it.

---

## A few other boundaries

**Dashboard form markup grants no ambient write authority.** Delivery-stage edits are reduced to a fixed
field allowlist before they leave the webview, while user-authored Director text is hydrated through
`textContent` so it cannot become executable markup.

**Destructive memory administration is outside the tool pipeline entirely.** Purging project memory needs
a modal confirmation *and* a typed `PURGE MEMORY` phrase.

**Auto-generated skills get their own review.** If the scanner flags softer concerns — environment
access, direct filesystem use, outbound fetches — you get a dedicated card. Deny it and the draft stays
paused so it can be narrowed or discussed, rather than running quietly.

**Branch cleanup is a dashboard workflow, not a tool.** Before offering a deletion, AtlasMind refreshes
the remote, refuses current, default, protected and checked-out-elsewhere branches, proves the commit is
already contained with no unique commits, and checks open pull requests. Local deletion uses the safe
delete flag — never the force one. Remote deletion additionally needs a live hash match and the exact
branch name typed. **A missing proof is a refusal, not an approval prompt.**

**Automatic roadmap reconciliation cannot borrow another checkout's plan.** The Dashboard excludes the
complete AtlasMind SSOT, backups, fixtures and known agent worktrees, then checks the resolved ancestry
of every surviving candidate for a nested `.git` boundary. Unknown worktree vendors and symlink escapes
therefore fail closed too. Only checkbox rows are automatic; bullet-only documents, duplicate-state
conflicts and deliberately broader sources require explicit Markdown import.

**URLs are untrusted.** Routed prompts carry a standing rule: validate the scheme and host, and actually
check a link works before presenting it as working.

**A fetch goes only where it was checked to go.** Every URL a model asks to fetch — through `web-fetch`,
`http-request`, or a skill it drafted that calls `fetchUrl` — is checked before a connection opens:
`https` only, no credentials in the URL, no name that is local by definition, and every address the name
resolves to judged by value against the private, link-local (cloud metadata) and reserved ranges. The
connection is then made only to the addresses that passed, and each redirect is checked the same way, up to
five. A refusal comes back to the model as `status 0` with the rule it broke, for example
`egress.blocked-address [169.254.0.0/16 link-local — where cloud instance metadata lives]`. This is a
boundary, not an approval: no mode, bypass or task release turns it off.

---

## Related

- [[Security]] — the full security model and threat model
- [[Skills]] — what each tool does
- [[Agents]] — how agents are given tools
- [[Delivery]] — the guarded path to production
- [[Configuration]] — every safety setting
- [[Remote Control]] — remote sessions


### Project-produced performance evidence (0.507.0)

The Testing reader accepts only a bounded v1 measurement document from two fixed paths under the
unambiguous SSOT home. It rejects symlink descendants and non-regular files, checks opened-file identity
and size, and caps the descriptor read. Unsupported, partial, future-dated or duplicate captures yield
no performance verdict; an invalid newest report never falls back to older data. Known-secret/control
filtering applies before scenario text reaches the escaped UI. Arbitrary scenario and target text are
omitted from generated policy prompts. Raw report access through tools retains their ordinary provenance
and approval controls. This reader grants no permission, runs no profiler or command, writes nothing,
and treats measured evidence separately from test passes and budget compliance.


### Confirmed game debt inspection (0.508.0)

The existing debt-scan modal explicitly includes bounded game asset/LFS/import reads, author-marked
TUNING points and local-ref fork counts against declared maxima. All run after confirmation; none
runs on render. No engine, build, profiler or network fetch runs. The game profile comes from the
unambiguous SSOT home; invalid/newer/absent policy withholds findings. Unknown/partial observations
cannot obsolete prior game debt. Fixed rule-table grades and per-finding authority are enforced by
`gameDebt.ts`/`debtRegister.ts`, not generated by a model. Raw asset/source notes are not retained;
relative paths and UI output are screened. Ordinary tool use of opened evidence keeps existing taint
and approval boundaries. No new tool permission or workflow capability is granted.

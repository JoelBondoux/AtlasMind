# Tool Execution & Safety

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
| **`ask-on-write`** *(default)* | Reading. Anything that writes, deletes or reaches outside asks |
| **`ask-on-external`** | Reading and workspace edits. Terminal, network and git writes ask |
| **`allow-safe-readonly`** | Everything except genuinely high-risk operations |

`ask-on-write` is the right default for most people. Start there; loosen it once you've watched
AtlasMind work for a while.

### What an approval looks like

When something needs you, AtlasMind brings the chat surface forward and shows a card with the tool, its
parameters, its risk category and a plain summary of the impact. You get four choices:

- **Allow once** — just this call
- **Bypass approvals** — for the rest of this task
- **Autopilot** — for the rest of this session
- **Deny** — reject it, without leaving the conversation

Parameters are redacted for secrets and length-capped before you see them. If a parameter can't be
displayed properly, it says **"unserializable arguments"** rather than showing a misleading empty object.

Autopilot can also be toggled directly with **AtlasMind: Toggle Autopilot**, and puts an indicator in
your status bar so you always know it's on.

---

## How tools are classified

| Category | Risk | Examples |
|----------|-----------|---------|
| `read` | Low | Reading files, searching, listing directories, diagnostics, git status and diff |
| `git-read` | Low | Status, diff, log, listing branches |
| `terminal-read` | Low | Read-only commands |
| `audio-input` / `audio-output` | Low | Microphone and speech playback |
| `workspace-write` | Medium | Writing, editing, deleting or moving files; writing to memory |
| `network` | Medium | Fetching a URL |
| `git-write` | High | Committing, creating or deleting branches |
| `terminal-write` | High | Installs, build scripts, anything that changes state |

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

---

## Saying "read-only" actually means read-only

If your message says to explain, review or inspect **without** writing files, running commands or
executing tests, AtlasMind removes those tools before the model ever sees them — and checks again
immediately before execution.

A model that hallucinates a write tool, or is talked into one by injected text, gets a denial. The tool
isn't there to call.

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

---

## Before anything is written

**CI starter creation is a host-owned create-only action.** The Pipeline webview sends no YAML, path,
branch or command. AtlasMind re-reads the project, derives one closed starter from its workflow config,
lockfile and package scripts, confirms the exact file/branches/checks, and writes with `wx`. If a quality
CI workflow already exists, or the target appears before the write, creation is refused. Release-only
automation remains separate because it is not evidence of pull-request validation. Existing
workflows can be opened or reviewed as proposals, never overwritten, disabled or deleted from this
surface.

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

**An agent distributed only as an archive gets no install button at all.** AtlasMind doesn't download and
unpack archives, so it names the launch command and tells you it's manual.

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

---

## Remote sessions get no shortcuts

When a session is driven from the web build, the same approval cards apply. A remote peer can never
auto-approve a write, a git operation, a terminal command or a network call.

Remote approvals are audited. **If the connection drops, pending approvals default to denied** and any
in-flight execution is aborted.

This holds identically in gateway mode: the gateway authenticates the transport, and grants no tool
authority whatsoever.

---

## The CLI is stricter

There's no panel to approve things in, so: read-only tools work, workspace and git writes need
`--allow-writes`, and high-risk external tools stay blocked. File operations resolve real paths before
the workspace check, so a symlink can't be used to escape the sandbox.

---

## Underneath all of it

Before any approval mode or risk classification is even considered, an **immutable baseline** applies:
your consent never authorises illegal activity, evading the law, targeted harassment, defamation, or
deceptive attacks on a person. No setting reaches it.

---

## A few other boundaries

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

**URLs are untrusted.** Routed prompts carry a standing rule: validate the scheme and host, and actually
check a link works before presenting it as working.

---

## Related

- [[Security]] — the full security model and threat model
- [[Skills]] — what each tool does
- [[Agents]] — how agents are given tools
- [[Delivery]] — the guarded path to production
- [[Configuration]] — every safety setting
- [[Remote Control]] — remote sessions

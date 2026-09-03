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
workflow with only push/manual reachability, exact repository/ref/owner conditions, `contents: read`, no
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

The same distinction applies to project generators. BigCommerce Catalyst and Wix Headless Commerce are
shown as **handoffs**, not runnable AtlasMind tools: their upstream CLIs can authenticate, provision
remote resources, install dependencies, create Git history, and publish. AtlasMind writes the reviewed
command and acceptance gates into the workspace but never runs it. Project-name input is not substituted
into shell syntax. Magento and WooCommerce native shells are local create-only file plans and likewise do
not run their installation or platform commands.

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

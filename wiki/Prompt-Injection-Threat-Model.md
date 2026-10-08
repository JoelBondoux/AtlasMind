# Prompt-Injection Threat Model

**What AtlasMind defends against when it reads text somebody else wrote — and, just as plainly, what it
doesn't.**

Prompt injection is text that AtlasMind reads containing instructions aimed at AtlasMind: a line in a web
page, an issue body, an MCP server's answer or a tool's own description. There is no filter that
reliably tells that text apart from ordinary content, so AtlasMind does not rely on one. It relies on
knowing **who could have written** what the model has read, and putting you — or a refusal — in front of
the moment that matters: *untrusted text went in, and something that changes things or leaves your
machine is about to come out.*

The full engineering version, with every rule table and file, is
[`docs/threat-model-prompt-injection.md`](https://github.com/JoelBondoux/AtlasMind/blob/develop/docs/threat-model-prompt-injection.md).

---

## What an attacker would be after

- **Your secrets and code leaving the machine** — usually inside the arguments of a network call
- **Changes you didn't ask for** — a file edit, a commit, a push
- **A poisoned tool** — an MCP tool description that tells the model what to do
- **A rug pull** — an MCP server that changes its tools after you approved it
- **Persistence** — an instruction saved into project memory, so it comes back every session
- **Your attention** — enough dialogs that you switch Autopilot on and stop reading them
- **Your money** — a loop made to keep spending

## Who wrote what

Everything the model reads is classed, most trusted first:

| Class | Examples |
|---|---|
| **You** | What you typed this turn |
| **AtlasMind** | Its own instructions and tool output |
| **Your workspace** | Repository files, attachments, project memory — which still contain other people's text |
| **Third party** | Web pages, MCP answers, `gh` output, another agent's answer, any tool AtlasMind can't identify |

A task keeps the **least trusted** class it has read, for the rest of the conversation. The model's own
writing doesn't reset it: a model that read a page and then wrote a plan hasn't made the page trustworthy.

## What stops each attack

| Attack | What stops it |
|---|---|
| Exfiltration | After third-party content, a network call needs a **fresh** approval Autopilot can't give. If the content contained "ignore previous instructions", network calls are **refused** outright for the rest of the task |
| Unwanted changes | After third-party content, writes, commits and commands need a fresh approval naming what was read. Terminal writes are off unless you turn them on |
| Long pages hiding an instruction | Over 8,000 characters, a separate model with **no tools** reads the text and the agent gets only a checked extract. The full text comes back only if you approve it |
| Poisoned MCP tools | Every tool description and schema is scanned; a flagged tool is held for your review, even the first time you see it |
| Rug pulls | Every MCP tool is pinned to the version you approved. A changed or new tool is held, and the old version's skill is removed |
| Unvetted servers | Anything AtlasMind detects or discovers is added **disabled** |
| Persistence | Project memory is scanned before every write; instruction-override phrases block it. After third-party content, a memory write needs a fresh approval |
| Approval fatigue | Autopilot has a ceiling — a push to a protected branch, a force push or an unidentified external tool always asks. The fresh-approval dialog says what was read and why it's asking |
| Spend | The tool-less reader answers to your task cost cap and daily limit like any other call; if it would go over, it isn't run |
| Reaching your network through a fetch | Every URL a model asks to fetch is `https` only; the name is looked up and every address it points to is checked against private, link-local (cloud metadata) and reserved ranges; the connection goes only to those addresses; every redirect is checked the same way |
| Secrets in prompts | Every model call goes through one gate that labels each part of the prompt, redacts what came from files and tools, and caps its size |
| Reading your keys out of the environment | A command an agent runs — and an ACP agent's own process — is started without your credentials: anything named or shaped like a key or token is withheld, so `env` or `printenv` has nothing to show. You pass one through by exact name in `atlasmind.terminal.passEnvironment`, which a repository cannot set |

## What is *not* defended

Read this part. A threat model that sounds complete is the same mistake as a test that can't fail.

- **MCP tools are pinned, not signed.** MCP has no signature standard, so AtlasMind can tell you a tool
  *changed*, not who wrote it. A server that's malicious on the day you enable it is trusted unless the
  scanner catches its descriptions. And a pin covers what a tool *says*, never what it *does*.
- **There's no AI "guardrail" checking actions before they run.** That would be a model reading the same
  attacker's text, so it could be fooled the same way — and its misses would be silent. Your fresh
  approval stands in for it, which means it's only as good as your reading of the dialog.
- **MCP tools are judged by name.** A tool called `get_weather` starts out graded as a harmless read,
  whatever it actually does.
- **Two model-chosen commands keep your environment.** The one follow-up a model picks in the managed
  terminal runs in *your* terminal, and a debug session takes its environment from the launch
  configuration, so neither gets the credential filter. Both ask first, and both are refused when the
  sandbox is required. A name you pass through is readable by every agent command, and a key under an
  ordinary-looking name in a format AtlasMind doesn't recognise still crosses.
- **A relaxed terminal write changes your project folder without asking.** If you switch on
  `atlasmind.sandbox.relaxTerminalApprovals` (off by default), a command bound for a confirmed sandbox runs
  without a prompt. It can't reach the network, your keys or anything outside the mounted folder — but inside
  that folder it can change anything, and those changes travel with whatever you do next on your machine. It
  never applies once the agent has read someone else's text.
- **ACP agents' own tools are invisible.** With `atlasmind.acp.toolsEnabled` on (off by default), an agent
  driven over ACP runs its own tools, allowed automatically and logged. AtlasMind won't hand it a task
  that has *already* read third-party content, but it can't track what the agent reads after that.
- **MCP tool changes mid-session aren't noticed until the server reconnects.** The model keeps seeing the
  description that was checked at connect.
- **Short results reach the agent whole.** Third-party text of 8,000 characters or less is fenced and
  scanned but not quarantined — room for a short injection, which then meets only the approval rules.
  And over 8,000 characters the agent can't see a large diff exactly: reviewing one means approving its
  release.
- **The reader can be misled.** It can't *do* anything, and its links and quotes are checked against the
  text, but its facts are paraphrase — a page can make them wrong.
- **Your repository isn't treated as untrusted by default.** A malicious file someone committed doesn't by
  itself make AtlasMind ask again. `atlasmind.security.untrustedEscalationScope: workspace-and-third-party`
  changes that, at the cost of many more dialogs.
- **Memory you approved comes back trusted.** Something saved to project memory with your approval is read
  as workspace content in later sessions.
- **Injection *detection* is a short list of phrases.** A reworded injection isn't flagged — the task still
  asks before writes, but a network call is asked about rather than refused.
- **The fetch check covers what a model can start, not everything.** Lens endpoints you declare in a
  reviewed file, a discovery finder you marked insecure, and services you configured yourself aren't put
  through it, by design. `simple-browser` opens a page in the editor's browser panel; the model never sees
  what comes back, but the page itself can make requests from your machine.

---

## Related

- [[Security]] — the whole security model
- [[Tool Execution]] — approvals, the escalation table and the quarantined reader in detail
- [[Data Privacy and GDPR]] — classified data and which model sees it

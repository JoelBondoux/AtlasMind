# Security

**AtlasMind assumes everything could be hostile, and behaves accordingly.**

Your chat input, your workspace files, retrieved memory, model output, web pages, issue text, MCP tool
results, panel messages — none of it is trusted by default. Where behaviour is ambiguous, AtlasMind
denies rather than guesses.

This page explains what's protected, how, and what to do if you find a hole.

---

## Reporting a vulnerability

**Please don't open a public issue.**

1. Use GitHub's private vulnerability reporting, or email the maintainer
2. Include what you found, how to reproduce it, and what you think the impact is
3. You'll get a response within 72 hours

The full policy is in [SECURITY.md](https://github.com/JoelBondoux/AtlasMind/blob/main/SECURITY.md).

**In scope:** the extension itself, custom skill scanning and execution, the memory system, and the
webview panels.

**Out of scope:** VS Code itself, third-party provider APIs, and MCP servers you installed.

**Safe harbour:** researchers acting in good faith are protected. Responsible disclosure will never
result in legal action from this project.

---

## Your credentials

API keys go into **VS Code SecretStorage** — the operating system's own keychain. Never a settings file,
never your repository, never project memory.

They're redacted before anything is sent to a model, and there are **two independent layers** doing it:

- **On the way in** — the memory scanner refuses to write anything containing a key, token, password or
  connection string
- **On the way out** — a separate check strips credentials from prompts immediately before dispatch, in
  case something got in anyway. It covers Anthropic and OpenAI keys, GitHub tokens, bearer tokens, PEM
  private keys, database connection strings and generic `api_key = "..."` assignments, and it tells you
  when it fired

Neither layer relies on the other working.

---

## Your files

Every file operation is sandboxed to your workspace. Paths that try to escape are rejected, and the CLI
resolves real paths before checking — so a symlink can't be used to get around it either.

---

## Your terminal

`terminal-run` uses a curated allow-list and **never invokes a shell**. Commands run as a program plus
arguments, so there is no shell-injection surface: no pipes, no `&&`, no backticks, no command
substitution. `sudo`, `rm -rf`, `chmod`, `dd`, `shutdown` and friends are blocked outright, at every
setting.

Full detail in [[Tool Execution]].

---

## Prompt injection

This is the big one for an AI tool: text that AtlasMind reads, containing instructions aimed at
AtlasMind.

It's handled in layers:

- **Project memory is scanned before anything is written.** Injection patterns block the write outright,
  and blocked content is quarantined rather than left to keep surfacing
- **Temporary context gets the same scanner.** Carried conversation, chat summaries and text attachments
  are checked before they reach a model. Blocked content is dropped, warned content is redacted and
  clearly labelled as untrusted data, and clean content is *still* treated as data rather than
  instructions
- **Third-party text is fenced.** Issue bodies, review comments, fetched pages and CLI output are labelled
  as reported content, so an issue reading "ignore your instructions" can't become one
- **The trust boundary is structural.** Untrusted content never enters the part of the prompt that
  carries authority, whatever it says about itself

---

## Confidential data and which model sees it

If the context AtlasMind is about to send contains payment card data or health information, routing is
restricted to models on a **trusted allow-list**. If no trusted model is available, the routing is left
alone and the sensitive parts are **redacted** instead.

GDPR and CCPA-classified matches are treated as advisory: the matched spans are redacted, but routing
isn't changed — because one heuristic hit inside a large context bundle shouldn't silently downgrade an
unrelated task.

The allow-list is **deny-by-default**: an empty list trusts nothing.

---

## The panels

AtlasMind's dashboards are webviews, which is a classic place to get this wrong.

- Content Security Policy plus per-load nonces on every script
- All content HTML-escaped
- **No inline event handlers anywhere**
- Every message from a panel is validated before it can change a setting, touch a secret or invoke a
  command

The important structural rule: **a panel supplies data, never a command.** The dashboard can trigger a
promotion and attest a check; it can never supply the command string that runs. What executes comes from
your persisted configuration, read on the extension side.

---

## Network requests

`web-fetch` and `http-request` block requests to localhost, private IP ranges and cloud metadata
endpoints — so a URL that arrived in a model's output or a fetched page can't be used to reach into your
network.

Resource discovery gets the same treatment plus HTTPS enforcement, schema validation, depth-bounded
federation, opt-in finders, and installs that arrive disabled.

---

## Custom skills

Anything you write or import is scanned before it can be enabled. `eval`, `new Function`, `child_process`,
shell execution, path traversal and hardcoded secrets **block enablement**. Environment access, direct
fetching, raw Node http and direct filesystem use are flagged and allowed.

Built-in skills are pre-approved and skip the scan.

Auto-generated skill drafts get an extra one-time review gate on top.

---

## Delegation doesn't carry authorisation

An agent can ask another agent a question. **The delegate runs with the *overlap* between the caller's
capabilities and its own — never the combination.**

This is the security property, not a limitation. Handing off to a specialist *feels* like it should give
you the specialist's tools — that's what makes them a specialist. But if it did, any restricted agent
could obtain any capability just by asking a permissive one, and **every restriction in the system would
become a suggestion.**

An empty overlap **refuses** rather than running a tool-less delegate, because a model that can't check
anything still produces confident prose. Chains are capped at three deep, cycles are refused, and the
answer comes back fenced as another agent's opinion rather than a verified result.

---

## Autonomous runs are contained

The Mission Loop runs inside a closed envelope: iterations, cost, tokens, wall-clock time, and
consecutive no-progress rounds. Your daily budget applies on top.

Approval checkpoints are **deny-by-default** — a dismissed prompt, a missing hook, an error, or a stopped
run all resolve as *stop*.

And a goal can't be declared achieved on unverified work: the evaluator's verdict is validated, has to
clear a confidence threshold, and behaviour-changing work needs passing verification.

---

## Production is protected

- **AtlasMind never force-pushes.** Where a force is genuinely unavoidable it uses a lease; to a protected
  branch it refuses outright
- **Promotion is deny-by-default** where required backup or approval evidence is missing
- **The backup command ships empty** on a production stage with a database, and that emptiness is the
  gate — AtlasMind can't invent a backup that would actually restore your data
- **The promotion history is append-only**

See [[Delivery]].

---

## Messages from other systems

Project memory is committed to your repository, which makes "what may enter memory" a privacy decision.

The rule is **derive, don't mirror**: an inbound message becomes a follow-up with a pointer back to the
original thread and a sanitised title. **The body is never stored** — the record has no field that could
hold one.

---

## Delegated agents and hidden windows

Two boundaries worth knowing if you use subscription agents:

**Tool permission never becomes permanent.** AtlasMind answers each operation individually and **never
selects "always allow"** — that grant would live inside the other agent's state, where AtlasMind could
neither display nor revoke it. If it's the only way to approve, the operation is declined.

**The Windows console-hiding option is disclosed, not sold as a sandbox.** Microsoft Defender flags
processes on hidden desktops because certain malware uses the same Windows feature. AtlasMind pins its
helper by checksum, passes only standard input and output, doesn't switch to or control that desktop, and
keeps the feature off until you choose it. Your endpoint security may still object — and if it blocks it,
AtlasMind fails **visibly** rather than quietly falling back.

---

## Remote sessions

Off by default. Binds only to your own machine. Requires pairing, requires workspace trust, never carries
secrets across the connection, audits everything, and **defaults pending approvals to denied** the moment
a connection drops.

See [[Remote Control]].

---

## The baseline nothing can override

Underneath every setting, every approval mode and every agent instruction sits an immutable rule:

**Your consent does not authorise illegal activity, evading the law, targeted harassment, defamation, or
deceptive attacks on a person.**

It can't be overridden by your prompt, by project memory, by a custom agent, or by anything AtlasMind
reads. You can read the exact text on the **Settings → Agents** page — it's shown straight from the
source rather than as a summary of it.

---

## Threat model, briefly

| Threat | What stops it |
|--------|-----------|
| Malicious model output | Approval gate, parameter validation, sandbox |
| Prompt injection via memory | Scanner blocks the write |
| Prompt injection via chat history or attachments | Transient-context scanning, untrusted-context isolation, priority guardrails |
| Credential exposure | OS keychain, write gate, dispatch-time redaction |
| Path traversal | Workspace sandboxing on every file operation |
| Shell injection | No shell, allow-list, operator blocking |
| Server-side request forgery | IP range and metadata endpoint blocking |
| Malicious discovery manifests | HTTPS, private-host screening, schema validation, bounded federation, opt-in finders, disabled installs |
| Cross-site scripting in panels | CSP, nonces, escaping |
| A permanent grant escaping AtlasMind | One-operation approvals only, never "always allow", denial on missing policy |
| Duplicated delegated work | Stable request identity, single-flight, a short result ledger, exclusion from generic retries |
| Runaway tool execution | 8 calls per turn, timeouts, cost limits |
| Runaway autonomous loop | Closed envelope, daily budget gate, deny-by-default checkpoints |
| False "goal achieved" | Validated evaluator, confidence threshold, verification guard |
| Supply chain via custom skills | Security scanner plus a manual review gate |
| Hidden-desktop dual use | Off by default, disclosed, checksum-pinned, visible failure |

---

## Related

- [[Tool Execution]] — approvals, allow-lists and gates in detail
- [[Memory System]] — the write gate and redaction boundary
- [[Delivery]] — production protection
- [[Remote Control]] — the remote security model
- [[Agents]] — the read-only advisors and the immutable baseline

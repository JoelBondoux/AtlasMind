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

## Lenses that reach a live service

Three lenses — Live Contract Drift, Service Reachability, Live Data Trust — compare what your
repository declares against what a running API or database actually serves. They are the only part of
AtlasMind that reaches a system somebody else operates, and everything about them follows from that.

- **The shape is read, the rows never are.** An API probe fetches the OpenAPI document the service
  publishes, or sends one fixed GraphQL introspection query. A database probe asks a connected MCP
  server's schema-reading tool what tables and columns exist. There is no function anywhere in the
  probe path that accepts a query, so `SELECT * FROM users` is not something any caller — a panel, a
  setting, a model — can reach, and a test asserts that no request AtlasMind can compose carries a
  write verb.
- **Value-bearing keys are dropped by name.** OpenAPI `example`, `examples`, `default`, `enum` and
  `const` are read and discarded rather than merely ignored. They're the keys most likely to hold a
  real customer record, and code that simply skipped unknown keys would eventually carry one along.
- **Deny by default, at two gates.** `atlasmind.lens.live.enabled` is off, and a probe still needs
  the per-run confirmation. Turning the feature on and pointing it at production are two decisions.
  Nothing is ever probed automatically or in the background, at any setting.
- **An endpoint that doesn't say which environment it is counts as production.** It gets the same
  type-to-confirm gate — you type the endpoint's own label before each probe, exactly as promotion to
  a protected stage works. Guessing downward would move the gate off the one environment it exists for.
- **Which services may be reached is a committed file, never a setting and never a model.**
  `.atlasmind/lens-endpoints.json` is reviewed like any other change. Atlas refuses to draft it —
  refused before the reply is even parsed, so a convincing draft can't pass — because a hostname
  nobody typed is a request sent to a stranger in your name with your token attached.
- **The file names a secret; it never holds one.** `secretRef` points at VS Code SecretStorage. A
  document carrying an actual token, password or connection string is refused *whole* rather than
  quietly cleaned up: a silently-scrubbed file would leave the credential on disk while reporting
  that everything was fine. Credentials embedded in a URL are rejected for the same reason.
- **Redirects are not followed.** A redirect is the server nominating a destination nobody reviewed,
  with the bearer token still attached. It's reported as an outcome you can see instead.
- **Plaintext `http` only on the loopback.** A probe may carry a token, so anything off your machine
  must be `https`. Private-range `https` is allowed — a staging API on the office network is the
  ordinary case, and unlike a fetched URL this destination came from a file somebody reviewed.
- **AtlasMind never *composes* SQL — it sends a *constant*.** Direct database connections
  (`postgres`, `mysql`, `sql-http`) send statements that are module-level constants with no
  interpolation, no parameters, and no code path that accepts a fragment from anywhere. A test walks
  every statement the code can emit and fails on a write verb, a placeholder, or a second statement.
  Everything runs inside `BEGIN READ ONLY` with a timeout, opened first and not optional — a server
  too old to support it fails the probe rather than getting one that runs unguarded.
- **Row counts never scan a table.** They are planner estimates the database already maintains, so
  "AtlasMind never reads a row" is literally true rather than nearly true. A table nobody has
  analyzed reports *unknown*, never zero.
- **The connection string lives in the OS keychain and nowhere else.** The committed file names the
  key; a file containing an actual credential is refused whole. The name is namespaced before it
  reaches SecretStorage, so a declaration file cannot name — and therefore cannot read — a key
  belonging to a model provider or anything else AtlasMind stores. Driver errors are scrubbed of
  anything URL- or `user:password@host`-shaped before they can reach a dialog or an output channel.
- **A credential is validated by parsing, never by connecting.** A mistyped connection string fails
  where you can still see what you pasted, rather than opening a socket to whatever host the typo
  produced. AtlasMind cannot verify what a credential is permitted to do, so it recommends a
  read-only role at the moment you store one — least privilege is the control that doesn't depend on
  AtlasMind being correct.
- **Going through MCP instead is still supported, and still refuses a generic query tool.** With
  somebody else's tool AtlasMind cannot guarantee what happens to the string it hands over, and
  guessing which argument means "the query" is guesswork — so that path takes only tools whose
  *name* says they read schema.
- **An unassessed service is never reported as healthy.** Refused, timed out and never-probed are
  distinct from unreachable, and a drift report for an endpoint nobody probed says explicitly that
  this is not a finding of "no drift". Probe results are held in memory for the session only; nothing
  about your environment is written into the git-tracked project memory.

---

## Model-drafted files

The Lens declaration guide is the one place AtlasMind will have a model write a file that lands in your
repository, so the boundary is worth stating in full. A draft is a **proposal, never a write** — and
one declaration kind, `lens-endpoints.json`, is refused outright rather than drafted at all:

- **Refused whole, never repaired.** The draft goes through the same check the lens itself reads the file
  with. If it fails, it is rejected outright — patching it up would mean AtlasMind inventing the parts the
  model got wrong, in a shape that then looks derived from your repository.
- **Every claimed path is verified.** Any file the draft says a declaration lives in is checked against
  your workspace and dropped if it doesn't resolve. Traversal and absolute paths are rejected before they
  can even become a filesystem check. A plausible-but-wrong path is worse than no path: it renders, it
  draws, you click it, and nothing is there.
- **Credential-shaped values are withheld from the file**, not masked in the view. These files are
  committed, so hiding a secret on screen would still put it in your repository. A setting whose key reads
  as a credential — or that arrives with no value policy at all — is masked by default, and the file
  records only that a value is set.
- **Nothing is written until you've seen it.** You get the full draft, every correction listed
  individually rather than counted, and a confirmation naming the file and the exact counts.
- **Your own entries always win.** Merging never replaces something you wrote — a silent overwrite would
  be invisible in a diff full of additions.

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

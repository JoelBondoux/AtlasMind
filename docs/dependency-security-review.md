# Dependency and supply-chain review

**Reviewed:** 2026-09-08 · v0.436.0 · `develop`
**Enforced by:** [`tests/security/supplyChain.test.ts`](../tests/security/supplyChain.test.ts)

This document is the reasoning. The test is the enforcement — anything here that is not also
asserted somewhere is a statement of intent, and is marked as such.

---

## 1. What ships to a user's machine

Seven runtime dependencies. Everything else in `package.json` is `devDependencies` and is not in the
`.vsix`.

| Package | Why it is worth shipping |
|---|---|
| `@agentclientprotocol/sdk` | ACP client — lets a Claude/Codex subscription act as routable model capacity. |
| `@modelcontextprotocol/sdk` | MCP client — external tool servers. |
| `@noble/secp256k1` | BIP-340 Schnorr signing for Nostr NIP-42. **Chosen over `@noble/curves`** — 170 KB against 1.87 MB, and zero transitive dependencies. |
| `mysql2` | Lens database reader (MySQL). |
| `pg` | Lens database reader (PostgreSQL). |
| `ws` | WebSocket transport for the Buzz relay. |
| `zod` | Schema validation at untrusted boundaries. |

**The set is ratcheted, not the count.** A new runtime dependency runs on a user's machine with the
extension host's privileges, so adding one is a decision to defend in review rather than a lockfile
diff. Removing one needs no permission. `supplyChain.test.ts` fails on an undeclared dependency and
on a declared one that has been removed, so the table cannot drift in either direction.

**Two of these are database drivers**, which is a larger surface than the rest combined. They are
reached only by the Lens feature, only against endpoints declared in a committed file, and only
through the constant statements in `lensDatabaseDialect.ts` — no caller, setting, webview or model
can supply SQL. That is asserted separately by that module's own tests.

---

## 2. CI actions

Every third-party action is pinned to a **40-character commit SHA** with the version in a trailing
comment. Asserted by `supplyChain.test.ts`, which fails both on a mutable tag and on a bare SHA with
no readable version beside it.

Nine references were pinned by tag until v0.436.0 (`actions/checkout@v7`, `actions/setup-node@v7`,
`azure/login@v3`, `actions/checkout@v4`). A tag is mutable: moving one is a single API call for
anyone with write access to the action's repository, which is how `tj-actions/changed-files` became
a credential exfiltrator across thousands of repositories in March 2025 without any of them changing
a line.

That matters more here than in most repositories. `publish.yml` holds an Entra federated credential
that can publish to the Marketplace under this publisher's name, and a published version can never
be replaced. An action running in that job can ship a release.

**The version comment is load-bearing, not decoration.** A bare SHA is unreviewable — nobody can
tell v4 from v7 by looking — so upgrades stop happening and the pin becomes a way of staying old
rather than a way of staying deliberate.

---

## 3. What leaves the machine, and when

Enumerated because "no telemetry" is worth less than a list.

**Nothing is contacted because the editor started.** Verified in v0.435.0 and covered by
`tests/security/startupNetworkActivity.test.ts`; see `docs/security-data-flow.md` §5.

Everything below happens because of something the user configured or asked for:

| Destination | Reached when |
|---|---|
| A model provider's API | A provider is configured with a key, or a subscription agent is enabled, and a turn runs. |
| `open.er-api.com` | A non-USD display currency is configured. Not on the default. |
| ollama.com, huggingface.co | A local model runtime answered on localhost. Not otherwise. |
| `localhost:11434`, `localhost:1234` | Always, at activation. Never leaves the machine; this probe *is* local-model discovery. |
| GitHub (`gh` CLI) | A dashboard page that reads issues, PRs or CI is opened or refreshed. |
| An MCP server | The user enabled that server. Seeded disabled. |
| A lens endpoint | Declared in a committed file and confirmed per run. |
| A fetched page | A tool was explicitly asked to fetch it. |

**There is no telemetry, no analytics, and no install ping.** Not a setting — there is nothing to
switch off. Grepping `src/` for telemetry and analytics returns only prose about *other* systems
(testing-methodology copy, MCP server descriptions, bootstrap templates) and the privacy-catch log,
which is stored in workspace state and never sent.

*Statement of intent, not yet enforced:* there is no test asserting the absence of a telemetry
client. The declared-host table above is prose. A future pass could pin the outbound host set the
way the dependency set is pinned; it was not done here because the repository contains ~180
hardcoded hostnames, almost all documentation links and provider base URLs, and an allowlist of that
size is noise rather than a control.

---

## 4. Subprocesses

`tests/security/subprocessShellUse.test.ts` enforces two things:

1. **Only two files may invoke a shell** — `routineRunner.ts` and `promotionRunner.ts`, both of which
   run commands a human wrote and confirmed, where "run this command" is the feature. The list may
   only shrink.
2. **No shell command is assembled from a value anywhere.** A shell turns a string into a command, so
   an interpolated one can run whatever its inputs say. This is not a ratchet: it is zero, and a new
   entry is a command injection until proven otherwise.

Everything else uses `execFile`/`spawn` with an argument vector. On Windows the shim is bypassed
rather than invoked (`windowsShimBypass.ts`), because `execFile` with a shell concatenates the
argument array into one unescaped command line — Node's own DEP0190, and previously a live command
injection here.

`bootstrapper.ts` spawned four shells until v0.436.0: three capability probes that ran *before* any
confirmation, an installer, and `git add -A && git commit`. All were constants, so none was
injectable, but the Debian `gh` installer was a `curl … | sudo dd … && sudo apt install` pipeline.
That is now **absent rather than argv-ised**: `acpInstaller.ts` refuses to ship Rust's `curl … | sh`
on principle, and two installers in one product should not disagree about whether that principle
exists. apt users get the manual instructions the no-installer path already showed. It could not have
worked anyway — `sudo` with no TTY prompts for a password nothing can answer.

---

## 5. Generating an SBOM

```
npm run sbom > sbom.cyclonedx.json
```

CycloneDX 1.5, runtime dependencies only (`--omit dev`), resolved from the lockfile.

**Deliberately not committed.** A checked-in SBOM is a snapshot that goes stale silently, and a stale
SBOM is worse than none — it answers a question about a build that no longer exists with the
confidence of a generated artifact. Generate it against the tag you are asking about.

---

## 6. Reviewing this again

The parts that rot are §1 and §2, and both are held by tests, so they rot loudly. §3's table is
prose and will rot quietly — re-derive it rather than reading it, if the answer matters.

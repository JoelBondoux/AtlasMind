# Contributing

**Thanks for wanting to help.** AtlasMind is MIT licensed, has no commercial edition, and welcomes
contributions of any size — a typo fix counts.

This page covers getting set up, the conventions, and how to add the things people most often want to add.

---

## Getting set up

You'll need **Node.js 18+**, **npm 9+**, **VS Code 1.96+** and **git**.

```bash
git clone https://github.com/JoelBondoux/AtlasMind.git
cd AtlasMind
npm install
```

Then press **F5** in VS Code to launch an Extension Development Host with AtlasMind loaded. `@atlas`
becomes available in chat there.

### The commands you'll use

```bash
npm run watch        # Watch mode — what you want during development
npm run compile      # Full build: desktop, web type-check, and web bundle
npm test             # All tests
npm run lint         # ESLint
```

And occasionally:

```bash
npm run watch:web            # Watch the browser bundle
npm run open-in-browser      # Load the web build in Chromium
npm run test:coverage        # The CI coverage gate, locally
npm run test:mutation        # The slower mutation suite
npm run package:vsix         # Build a .vsix
```

### Two build targets

AtlasMind builds a **Node desktop build** and a **browser web build**. Anything under `src/web/`, and any
shared module it imports, **must not use Node built-ins** — that's the most common way to break the web
build without noticing.

### Packaging

AtlasMind has real runtime dependencies. **Don't package or publish with `--no-dependencies`** unless
they've been bundled into the output first.

If `vsce package` ever shows a workspace-memory directory in the package contents, treat that as a
release blocker — it means somebody's project notes are about to ship to every user.

---

## Conventions

### TypeScript

- **Strict mode.** No implicit `any`
- **`.js` extension on every relative import** — Node16 module resolution requires it
- **`import type`** for types used only in type positions
- **One class per file** for core services
- **Shared interfaces live in `src/types.ts`.** Never duplicate a type across files

### Where things go

| Directory | What belongs there |
| --------- | ------------------ |
| `src/core/` | Core services — orchestrator, agents, skills, router, planner |
| `src/chat/` | The chat participant and slash commands |
| `src/providers/` | Model provider adapters |
| `src/skills/` | Built-in skill implementations |
| `src/memory/` | The memory manager and scanner |
| `src/mcp/` | MCP client and server registry |
| `src/views/` | Webview panels and tree views |
| `src/voice/` | Speech in and out |
| `src/bootstrap/` | Project bootstrap and import |
| `src/cli/` | The headless CLI and the agent endpoint |
| `src/acp/` | Agent-side sessions, permissions, and the messaging boundary |
| `tests/` | Test suites, mirroring the `src/` structure |
| `docs/` | Technical documentation |

### Commits

Conventional Commits:

```
feat: add new skill for Docker management
fix: prevent path traversal in memory-write
docs: update routing algorithm documentation
refactor: extract cost calculation into helper
chore: update dependencies
```

**Every commit must include:**

1. **A version bump** in `package.json` — patch for fixes, docs and refactors; minor for new features,
   commands or UI; major for breaking changes to config, agent definitions or memory format
2. **A matching `CHANGELOG.md` entry**
3. **Documentation updates in the same commit** — not a follow-up

### Branches

The workflow itself is described in [[GitHub Workflow]]. This repository's specific values:

- **`develop`** is the default branch and the normal push target
- **`main`** is release-ready only, and reached through a reviewed pull request
- Branch names are `<type>/<issue>-<slug>` where an issue exists, otherwise `feat/*`, `fix/*`, `chore/*`
- Feature PRs target `develop`. `develop` → `main` is a **release promotion**, not a feature PR
- AtlasMind stays branded Beta until 1.0.0

`main` relies on required CI and PR-only merges rather than mandatory approving reviews. That's the
**solo profile**, and it's deliberate: requiring a maintainer to approve their own work trains them to
dismiss the gate. CI is the reviewer instead.

### Releasing

Use the **Release — promote develop to main** workflow. Once that PR merges, run `npm run tag:release` —
the tag push triggers the publish workflow, which does the actual publishing.

`publish:release` publishes only; it does **not** tag. The two were chained until v0.184.0, and that
chain made CI publish twice.

CI authenticates to the Marketplace through Microsoft Entra ID rather than a token, so there's no
Marketplace secret in the repository. **Marketplace — verify publishing identity** checks that credential
without publishing anything, which matters because a published version can never be replaced.

---

## Documentation is part of the change

Update these in the **same commit**:

| If you change | Update |
| ------------- | ------ |
| A source file (add, remove, rename) | `README.md`, `docs/architecture.md`, `docs/development.md` |
| A command, slash command, or setting | `README.md`, `package.json` |
| A type in `src/types.ts` | `docs/architecture.md` |
| Agent or skill behaviour | `docs/agents-and-skills.md` |
| The model router or a provider | `docs/model-routing.md`, `CONTRIBUTING.md` |
| The memory system | `docs/ssot-memory.md` |
| Webview panels or tree views | `docs/development.md`, `README.md`, `docs/architecture.md` |
| Build config or dependencies | `docs/development.md`, `README.md` |
| Anything shipped | `CHANGELOG.md`, `package.json` |

The wiki mirrors the user-facing side of those and should be updated alongside.

---

## Adding a model provider

1. Create `src/providers/<name>.ts` implementing the provider contract
2. Register it in `src/providers/index.ts`
3. Add the provider ID to `src/types.ts`
4. Add model metadata to the catalogue
5. Update `docs/model-routing.md` and `CONTRIBUTING.md`

**Keep it free of direct `vscode` imports** if it should also work in the CLI, and use the shared secret
contract in `src/runtime/secrets.ts`.

The same applies to anything reachable from `src/cli/acpAgent.ts`. After changing shared core code, run
both CLI entry points with `--help` — a transitive `vscode` import compiles fine and only fails when the
headless executable starts.

Useful references: `src/providers/registry.ts` for the local provider's offline fallback and configurable
endpoint, and `src/providers/acp.ts` for a subprocess-backed provider that relies on a local install and
the agent's own authentication rather than an AtlasMind-managed key.

**Before you submit:**

- Adapter tests in `tests/providers/`
- Routing or orchestrator regression coverage if you touched failover, health, pricing or capability
  selection
- An entry in the integration monitor manifest if you've added a third-party dependency

**When changing routing heuristics**, check both low-stakes and high-stakes follow-up prompts. Free and
local models should stay attractive for simple turns without dominating later thread-based requests where
the task genuinely needs more reasoning.

**If an upstream API isn't a chat backend**, or needs modality-specific workflows, keep it on the
specialist integration surface rather than forcing it into the routed provider list.

---

## Adding a skill

1. Create the file in `src/skills/`
2. Export a factory returning a skill definition
3. Register it in `src/skills/index.ts`
4. Add tests in `tests/skills/`
5. Update `docs/agents-and-skills.md`

## Adding an agent

1. Add the agent definition in `activate()` in `src/extension.ts`, marked as built-in
2. Register it
3. Update `docs/agents-and-skills.md`

## Adding a runtime plugin

The shared runtime accepts plugin contributions through `src/runtime/core.ts` — register agents, skills or
providers, optionally listen to lifecycle events, and pass the plugin when the runtime is created. Add
tests in `tests/runtime/` and update the architecture docs.

---

## Debugging orchestration

1. **Work out where the problem actually is first** — agent selection, skill availability, provider
   routing, or tool execution — before editing shared orchestrator code
2. For autonomous-run failures, look at the Run Center state, run history and webhook events
3. Capture real editor state with the diagnostics and observability tools rather than guessing from the
   final model response
4. For race conditions and ordering problems, **add the regression test before changing concurrency**
5. For routing regressions, add coverage near the orchestrator tool tests before touching heuristics

One thing that catches people out: **failover is capped at three invoked endpoints, not three model
labels.** ACP model and effort variants share an endpoint, as do local models on the same server. Use the
recorded model attempts for diagnostics — router previews and abandoned stream fragments are not evidence
that a model actually ran.

There's no formal load-test harness yet. For performance-sensitive changes, repeated local execution plus
targeted regression tests is the current bar.

---

## Before you open a pull request

- [ ] `npm run compile` passes with zero errors
- [ ] `npm test` — everything passes
- [ ] `npm run lint` — no new warnings
- [ ] Version bumped in `package.json`
- [ ] `CHANGELOG.md` entry added
- [ ] Relevant docs updated **in the same commit**
- [ ] Conventional commit message

CI runs compile, lint and the full test suite on Ubuntu, Windows and macOS. Coverage thresholds are
enforced for the service layer — `src/core`, `src/skills`, `src/memory`, `src/providers`, `src/mcp` and
`src/bootstrap`. Webview code and chat wiring are excluded for now, until they have dedicated integration
tests.

---

## Code of conduct

Be respectful, constructive and inclusive. Standard open-source community guidelines apply.

---

## Related

- [[Architecture]] — how the system fits together
- [[Agents]] · [[Skills]] · [[Model Routing]] — the areas people most often extend
- [[GitHub Workflow]] — the workflow this repository follows
- [[Funding and Sponsorship]] — the other way to help

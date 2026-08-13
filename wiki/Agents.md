# Agents

**An agent is a specialist.** Instead of one assistant that's mediocre at everything, AtlasMind ships
27 of them — a debugger, a frontend engineer, a security reviewer, a test developer, and so on. Each
has its own instructions, its own tools, and often its own preferred models.

You don't pick one. You describe what you want, and AtlasMind routes the work to whoever is best
placed to do it. If none of them fit, it builds a specialist for the job on the spot.

---

## The team you get out of the box

### Writing and fixing code

| Agent | What it's good at |
|-------|-------|
| **Default Assistant** | General development work — the fallback when nothing more specific fits |
| **Workspace Debugger** | Bugs in *your* repository, regressions, and finding the actual root cause |
| **Frontend Engineer** | UI, layout, webview and interaction work |
| **Backend Engineer** | APIs, data flow, orchestration logic and integrations |
| **Refactorer** | Records deferred work with a file and line, then proposes — never rewrites things you didn't ask about |

### Checking the work

| Agent | What it's good at |
|-------|-------|
| **Code Reviewer** | Review, regression risk, and the tests that are missing |
| **Security Reviewer** | Security gaps, auth, runtime boundaries, secret handling, and whether the security tests cover anything |
| **Test Developer** | Unit, integration, E2E and regression tests, and coverage analysis |
| **Performance Analyst** | Hot paths, memory leaks, slow queries, latency and throughput |

### Shipping it

| Agent | What it's good at |
|-------|-------|
| **GitHub Operator** | Pull requests, issues, branch work and releases, backed by real evidence |
| **CI Analyst** | Explains why a pipeline failed and proposes the smallest fix. Never re-runs a job or edits your pipeline |
| **Release Manager** | Checks the version matches the actual impact and that release notes are your changelog verbatim. Never pushes, tags or publishes |
| **DevOps Engineer** | CI/CD pipelines, Dockerfiles, Compose, Kubernetes, Terraform and Bicep |
| **Dependency Manager** | Updates, vulnerability fixes, peer conflicts and lockfile hygiene |

### Everything around the code

| Agent | What it's good at |
|-------|-------|
| **Documentation Writer** | READMEs, API docs, guides, changelogs and inline documentation |
| **UX Consultant** | Accessible UX critique and implementation using *your* design stack. Doesn't create graphic assets |
| **SEO Specialist** | Technical SEO, structured data, discoverability, and marketplace or package listings |

### Advisors who look, and don't touch

These nine are **read-only and advisory**. They report; they never approve anything and never change
your code. Where they make a factual claim about the outside world, they say where it came from.

| Agent | What it looks at |
|-------|-------|
| **Ethics Oversight** | User harm, fairness and bias, consent, dark patterns, transparency, accessibility as a duty |
| **Legal Oversight** | Licence compatibility, IP, GDPR/CCPA, liability, terms of service, regulated data. *Not legal advice* |
| **Commercial Oversight** | Monetisation, vendor cost and lock-in, contractual obligations, go-to-market impact |
| **Competitive Analyst** | Who else solves this, how they're positioned and priced, and what you're missing |
| **Customer Researcher** | What people publicly ask for and complain about in products like yours. Names no individuals |
| **Technology Analyst** | Deprecations, end-of-life dates and breaking changes in what you depend on |
| **Market Analyst** | Category size and direction. Every figure dated — an unavailable figure is reported as unavailable |
| **Funding Analyst** | Grants, accelerators and sponsorship schemes, with eligibility and deadlines from the programme's own page |
| **Regulatory Analyst** | What applies to a product of your shape, by jurisdiction, with effective dates. *Not legal advice* |

Each of them has to point at something real in your workspace and quote it, keep what it observed
separate from general principle, say *"I could not determine this"* rather than guessing, rank concerns
by likelihood and impact, and **say plainly when something looks fine** — an advisor that flags
everything is no more useful than one that flags nothing. Each ends by naming the human review a
serious finding needs. None of them certifies anything.

They're also the only built-ins with a locked-down read-only tool list and no auto-updates, so neither
their reach nor their framing can drift.

### Behind the scenes

**Memory Agent** runs in the background keeping session context and project memory snippets fresh. Point
its `allowedModels` at a local model and it costs you nothing.

---

## How AtlasMind chooses

You don't have to think about this, but here's what happens.

Every enabled agent is scored against your request. The strongest signal by far is a **declared
speciality match** — if AtlasMind detects that a request is about security, the Security Reviewer wins
decisively, and no amount of coincidental word overlap will beat it. After that it considers word
overlap with the agent's role and skills, whether the request looks like a repository bug report,
whether the agent has tools that fit, and how well that agent has done on similar work for you before.

Highest score wins; ties break alphabetically.

If nothing scores at all, AtlasMind **synthesises** a specialist for the request. If that isn't
appropriate either, the Default Assistant takes it.

The reply footer tells you which agent ran, what signals were detected, what the turn cost, and whether
a red-to-green test transition was observed.

### The Default Assistant deserves a word

It's the fallback, and it's deliberately not a passive help desk. Given a bug report or a fix request
it goes and *looks at your repository* rather than asking you diagnostic questions. If the model tries
to answer from memory anyway while that bias is active, AtlasMind rejects that first pass once and asks
again for a tool-backed answer.

It's also portable: it discovers your project's own instruction files, docs conventions, branching
policy and release routine rather than importing AtlasMind's habits into your repository.

---

## Agents can ask each other

An agent that hits something outside its speciality can hand the question to a better-placed colleague
and get an answer back.

**A handoff transfers the question, not the permissions.** The agent you ask runs with the *overlap*
between your tools and its own — never the combination. If it worked the other way, any restricted
agent could get any capability just by asking a permissive one, and every restriction in the system
would become a suggestion.

Practical consequences:

- The answer comes back clearly labelled as another agent's opinion, not a verified result
- If the overlap is empty, the handoff is **refused** rather than running a delegate with no tools
- Chains stop at three deep and can't loop back on themselves
- The delegate doesn't inherit your budget

---

## What every agent is held to

Whatever agent runs — built-in, custom or synthesised — it gets the same operating contract:

- **Act when action was asked for.** Don't describe what you would do.
- **Back concrete claims with evidence** from the workspace or a tool, not recollection.
- **Recover from a failed tool in the same turn** rather than giving up.
- **Treat external context and URLs as untrusted.**
- **Finish the wiring.** A change isn't done because the main file compiles.
- **Verify proportionately** to the risk.
- **Never route around an approval or safety gate.**
- **Report the outcome, or the exact thing blocking it.**

There's also an **immutable baseline** underneath all of that: comply with applicable law, treat legally
ambiguous or territory-specific requests as restricted unless only safe high-level guidance is possible,
and never help harm, discredit or lie about a person. Nothing can override it — not your prompt, not
project memory, not a custom agent's instructions. You can read the exact text on the
**Settings → Agents** page; it comes straight from the source rather than being a summary of it.

### Tests come first, by default

Most built-in agents also carry a tests-first preference, tuned to what they do:

- **Test Developer** has a hard rule: the smallest failing spec before any implementation, and every task
  closes with a failing-to-passing run report and a coverage delta.
- **Workspace Debugger** reproduces a regression with a failing test before fixing it.
- **Backend Engineer** works red-green-refactor for behaviour, contract and regression changes.
- **Frontend Engineer** does the same where practical, and falls back to strong manual verification for
  genuinely visual work.
- **Code Reviewer** treats missing regression coverage as a primary finding.
- **Performance Analyst** requires profiling or benchmark evidence *before* proposing a fix, and proves
  the improvement afterwards.
- **DevOps Engineer** wants a dry run, health check or validation step before calling infrastructure done.
- **Dependency Manager** runs the suite after each update.
- **Documentation Writer** checks that code snippets and signatures match the current implementation.
- **GitHub Operator** skips the formality for purely mechanical git operations, but still expects a signal
  when a workflow change touches behaviour.

---

## Testing methodologies

AtlasMind ships a registry of **69 testing methodologies**, and you choose which ones your project holds
itself to. Configure them under **Settings → Testing** or on the **Project Dashboard → Testing** page.

| Category | Methodologies |
|---|---|
| **Design-time** | TDD, BDD, ATDD, Spec-Driven, V-Model |
| **Structural** | Unit, Integration, Mutation, Property-Based, Continuous / Shift-Left, White-Box, Dead-Field Detection, Type Drift Detection, Dependency Graph Integrity |
| **Behavioural** | End-to-End, Snapshot, Contract, Model-Based, Test Design Techniques, Black-Box, Gray-Box, Cross-Surface Parity, Cross-Representation Consistency, Cross-Version Parity, Semantic Constraints, Anti-Uniformity, Output Schema Drift, Hallucination Detection |
| **Non-functional** | Performance, Security, Visual Regression, Chaos / Resilience, Accessibility (a11y), Observability / Telemetry |
| **Data & schema** | Data Quality, Schema Migration, Backward/Forward Compatibility, Memory/State Drift Detection |
| **AI-specific** | Prompt Regression, Model Routing Correctness, Guardrail Enforcement, Agent Collaboration Correctness, Determinism/Stochasticity Boundary |
| **Exploratory** | Exploratory, Agile Testing |
| **Compliance — security & privacy** | ISO/IEC 27001, SOC 2 Type I/II, GDPR, HIPAA, PCI-DSS, NIST 800-53 / 800-171 |
| **Compliance — operational & process** | Change-Management, Audit-Trail Completeness, Access Control & RBAC, Data Retention & Deletion |
| **Compliance — supply chain** | SBOM Verification, Dependency Licensing, Open-Source Licence Compatibility, Secure Build Pipeline (SLSA) |
| **Compliance — AI governance** | AI Safety & Guardrail Compliance, Model-Output Risk Classification, Bias & Fairness, Explainability & Transparency, AI Memory & Data-Use Policy |
| **Compliance — industry-specific** | Financial Services (FFIEC, MiFID II), Medical (FDA 21 CFR Part 11), Automotive (ISO 26262), Aviation (DO-178C), Energy (NERC CIP) |

Each one carries a plain-English *what it is*, *when to use it*, *typical tools*, *trade-offs*, and an
**AI token impact** rating so you know what it'll cost you to enable.

### Compliance policies work differently, on purpose

Every other policy answers one question: *does the evidence exist in the file tree?* Most of a
compliance regime cannot answer it. "Cryptographic controls are governed by a policy" has no assertion
behind it, and a test file written for it can never honestly pass or fail — it becomes a gap nobody can
ever close, which teaches you to ignore gaps.

So compliance policies split, per policy and declared in advance:

- **Controls a machine can check** get a real test. Role permissions (both halves — what each role
  *cannot* do is where privilege escalation lives), audit-trail completeness, retention windows and
  legal holds, GDPR erasure reaching every store rather than only the primary database, account numbers
  never reaching a log, SBOM accuracy against the actual dependency list, licence policy.
- **Everything else** gets a **control mapping** at `project_memory/operations/compliance/<policy>.md`
  — control reference, requirement, status, evidence, owner — which the Testing page reads as real
  evidence. A regime with both halves gets both files.

Three rules keep the mapping honest. Every row seeds as **Not assessed**, never as a pass, because an
unassessed control and a satisfied one are different facts. The scoping question comes *before* the
controls — a mapping filled in before anyone decided what is in scope looks complete and answers
nothing. And once the file exists it is **never rewritten**: it fills with your decisions, so re-running
the scaffolder leaves it exactly as you left it.

### What enabling one actually does

1. **It gets told to every agent that writes code** — not just to testing tasks. This matters more than
   it sounds: a policy that only reaches testing turns never reaches the turns that could have written
   the tests.
2. **It can pick a model.** Assign a methodology to an agent with a model override and matching work
   routes there.
3. **It's expected to leave evidence.** The Testing page reports each enabled methodology as *Tested*,
   *No tests yet*, *Nothing found*, or *Practice*, and an unevidenced one becomes a tech-debt entry.

**Enabling something you don't actually practise leaves a visible, permanent gap — and that's the point.**
The alternative is a declaration that means nothing. Turn on what your project genuinely does and add
the rest deliberately.

Seven of them — V-Model, White-Box, Test Design Techniques, Black-Box, Gray-Box, Exploratory and Agile
Testing — are *ways of working* that leave no files behind. They're named to agents as context but never
counted as gaps.

### Making one actually block work

Any enabled methodology can be marked **blocking**, which refuses non-test writes until a failing test
has been seen. It's opt-in per methodology, not a project-wide switch, because declaring a standard
should stay safe to do while turning one into a gate changes how every task runs.

Declare the full standard you hold yourself to; block on the one or two you're willing to stop work over.

### Seeing where you stand

The **Policy coverage** board on the Testing page reports what each enabled methodology has to show:

- **Tested** — matching test files exist, with case, skipped and failing counts
- **No tests yet** — the tooling is installed but nothing uses it
- **Nothing found** — enabled, with no tooling and no tests. **Write tests with Atlas** proposes the smallest useful set
- **Practice — not file-evident** — the ways of working above

Failing counts come from a test report **your project already wrote** — AtlasMind never runs your test
suite to fill this in. No report means it says pass/fail is *unknown* and shows you the command to
produce one, because "0 failing" from a run that never happened is worse than no number at all. A report
older than your newest test file is marked **may be out of date**.

Every card has an **Ask Atlas** button. Its first answer — what the method is, what it needs, what result
to expect, why the current status follows, and the safest next step — is built from AtlasMind's own
catalogue, so it uses **no model, no provider, and no metered API**. Only the follow-up chips route work.

### Getting started with a methodology

**Auto-assess project** reads what your project is *built from*, not what it says about itself.

A methodology arrives **ticked** when something in the code shows it — a dependency, a script, a config
file, a directory that exists — and the reason says what was found. A methodology arrives **unticked**
when only your README or project description mentions it, saying which words prompted it, so you can
tick it as an intention if that is what you mean. Nothing is hidden and nothing is more than one
keystroke away; auto-assess simply stops deciding for you.

It used to work the other way. Every signal word was matched against one blob of text that included
three kilobytes of your README, so a project could acquire a dozen methodologies because of its own
marketing copy — on this repository that included PCI-DSS and bias & fairness testing, on a VS Code
extension that handles neither. Words also matched inside other words, so "rapid" switched on
integration testing.

Three further rules keep it honest. A word that means different things in different projects — `audit`,
`pipeline`, `agent` — raises a methodology rather than ticking it, unless something else corroborates:
`npm audit` in a script is not evidence of an audit trail. A methodology your project *shape* can never
show evidence for is not offered at all, with the reason given, so you are never handed a gap you cannot
close. And anything that could not be read is stated as a partial reading rather than reported as
nothing found.

Dependencies are read from every manifest — `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, Gradle,
`Gemfile`, `composer.json` and more — so Python, Rust, Go, Java and .NET projects get a real assessment.

**Scaffold Testing Framework** detects your language and project shape and creates idiomatic starter
files for each enabled methodology — Vitest, Jest, Playwright, fast-check (Node); pytest, Hypothesis
(Python); `cargo test`, proptest (Rust); `go test`; xUnit; JUnit 5 — plus a strategy playbook. Enabled
compliance policies also get their control mapping, which is language-independent: the regime does not
change because the project is written in Go. It's non-destructive: files are created only when missing,
no manifest is touched, and it asks first.

**Sync Testing Protocols to AI Agents** writes your enabled protocols into the instruction files other
tools read — `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, Cursor, Cline, Gemini,
Windsurf, Aider — as a clearly delimited managed block, so agents outside AtlasMind follow the same
standard. Saving the matrix syncs automatically.

---

## Building your own agent

Open **AtlasMind Settings → Agents**, or run **AtlasMind: Manage Agents**, then click **New agent**.

| Field | What it's for |
|---|---|
| **Name and role** | Used to decide when this agent gets picked, so be specific |
| **Description** | Longer context, also used in routing |
| **System prompt** | The instructions it always gets — where its personality and rules live |
| **Completion rubric** | Up to 12 observable things that must be true before it calls the job done |
| **Incomplete-result patterns** | Optional — if the answer looks unfinished, trigger one finish-or-explain retry |
| **Skills** | Which tools it may use |
| **Allowed models** | Pin it to specific models, or leave empty for any |
| **Cost limit** | A per-task ceiling in USD |

Agents are saved across sessions. The editor groups fields into Identity, Instructions & completion,
Skills, Models & budget, Testing and Maintenance, with advanced groups collapsed until you need them.

### Choosing how it gets tools

| Policy | What it means |
|---|---|
| **Task-scoped** (default) | AtlasMind picks at most 12 relevant built-in tools per turn |
| **Manual allowlist** | Exactly the tools you name, every time |
| **Advanced — every enabled skill** | Everything, *including integrations installed after you created the agent* |

The third is deliberately separate, because its scope grows on its own.

### Advice that saves pain later

- **Be specific in the role field.** "Reviews Terraform for security misconfigurations" routes far better
  than "helper".
- **Put behaviour in the system prompt**, not in every message you send.
- **Restrict skills deliberately.** A read-only reviewer should not have `file-write`. This is the single
  most useful safety control you have over a custom agent.
- **Set a cost limit** on anything pinned to premium models.

### Other ways in

- **Models sidebar** — assign a provider's models, or one specific model, to selected agents
- **Agents tree** — right-click to create, edit, enable, disable or delete

### Turning agents off

Toggle any agent from the sidebar or the Agent Manager. Disabled agents stay registered but are never
selected. The Default Assistant can't be disabled — something has to catch the leftovers.

---

## Keeping custom agents current

Your own agents can go stale as libraries and practices move. `atlasmind.agentAutoUpdateCadence`
controls whether AtlasMind refreshes their prompts and descriptions:

| Setting | What happens |
|---|---|
| `never` (default) | Nothing is ever changed automatically |
| `every-use` | Refreshed each time the agent is selected |
| `daily` / `weekly` / `monthly` | Refreshed if it's been longer than that |

Set it once under **Manage Agents → Defaults & automation**.

**Built-in agents are never auto-updated**, and you can protect a hand-crafted agent of your own with
**Exclude from auto-updates**. If a refresh fails, your original definition is kept untouched.

---

## Temporary agents during a project run

When `/project` breaks work into steps, each step gets a role, and AtlasMind creates a temporary agent
shaped for it: `architect`, `backend-engineer`, `frontend-engineer`, `tester`, `documentation-writer`,
`devops`, `data-engineer`, `security-reviewer`, or a general fallback.

For steps that change code, they all get the same delivery policy: test first where it's meaningfully
testable, don't write implementation until a relevant failing test has actually been seen, aim for
red → green → refactor and report the evidence — and if it genuinely isn't testable, say why and use the
strongest verification available instead.

These agents exist only for their step and aren't saved.

---

## What an agent actually receives

1. Its system prompt
2. Relevant entries from [[Memory System|project memory]]
3. The tools it's allowed for *this* task — narrowed to what the task needs, not everything it owns
4. Your message
5. A bounded amount of recent conversation

Tool descriptions appear once, as the callable definitions themselves, rather than being repeated in
prose — which keeps more of the context window available for your actual work.

### Your words narrow it further

If you say **"read-only"** or **"don't edit anything"**, write tools are removed before the model is even
chosen — and denied again at execution if the model asks for one anyway. If you say **"don't run
commands"**, terminal and process tools go the same way. It's an enforced capability change, not a polite
request in a prompt.

---

## Using a subscription agent for tool work

If you've connected a Claude, ChatGPT, Copilot or Qwen subscription, it can do tool-backed work too —
but only when three separate things are all true: the agent declares it supports delegated execution,
you've switched on **Let subscription agents act**, and the orchestrator has authorised that exact
request.

Discovering an installed agent grants nothing. Ticking the box grants no individual operation. A missing
or failed permission check denies the action. With the box off, subscription agents stay available for
ordinary chat and reasoning and are simply excluded from tool-backed routes.

---

## Related

- [[Skills]] — the tools agents use
- [[Model Routing]] — how the model gets chosen
- [[Project Planner]] — multi-step runs and Mission Control
- [[Tool Execution]] — approvals and safety
- [[Security]] — the boundaries agents work inside
- [[Website Studio|UI Studio]] — the visual interface, content-design, and implementation-handoff workspace

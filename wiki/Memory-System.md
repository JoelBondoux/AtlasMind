# Memory System

**AtlasMind remembers your project so you don't have to re-explain it.**

Architecture decisions, why you rejected an approach, your naming conventions, your deployment runbook,
what's on the roadmap — all of it lives as **plain Markdown files in your repository**. Not a database,
not a cloud service, not a black box. Files you can read, edit, diff and review like any other.

When you ask a question, AtlasMind pulls in what's relevant. The more you put in, the better it gets.

---

## What's in it

Project memory lives in `project_memory/` by default (change it with `atlasmind.ssotPath`).

```
project_memory/
├── project_soul.md    What this project is, and what it's for
├── architecture/      How the system is built
├── roadmap/           Goals, milestones, what's planned
├── decisions/         Why you decided things the way you did
├── misadventures/     What you tried that didn't work — and why
├── ideas/             Explorations and things not committed to yet
├── domain/            Your business logic, conventions and vocabulary
├── operations/        Runbooks, deployment, CI, run reports
├── analysis/          Gap analysis and the research register
├── agents/            Knowledge specific to particular agents
├── skills/            Knowledge specific to particular skills
├── sessions/          Per-conversation working context
└── index/             The search index
```

The `misadventures/` folder is the one people underestimate. Recording what *didn't* work saves more
time than recording what did, because the failed approach is the one somebody will try again.

---

## Filling it up

### Just say so

```
@atlas Remember that we chose JWT for auth because session cookies don't work
well with our microservice setup.
```

Or explicitly:

```
@atlas /memory write decisions/use-jwt.md "Use JWT for auth" --tags auth,security
```

### From a new project

`/bootstrap` creates the folder structure and helps you fill in the project's identity.

### From an existing repository

`/import` does a proper first pass and can populate:

- An overview from your README, and your dependencies from your manifests
- Your project structure and a map of the codebase
- Runtime, model routing and agent notes from your existing docs
- Your conventions and product capabilities
- Development workflow, configuration reference, and security notes
- Development guardrails, release history, and an import catalogue

If `project_soul.md` still has placeholder text in it, import upgrades it into something usable.

### It keeps itself current

Imported files carry metadata about where they came from and what they looked like at the time. So:

- **Re-importing refreshes what changed** and skips what didn't
- **Files you edited by hand after import are preserved**
- **AtlasMind notices when memory has gone stale** — it warns you, pins a row at the top of the Memory
  view, and offers **Update Project Memory**
- **While VS Code is open**, it watches your saves, creations, deletions and renames, and quietly
  re-imports when something makes memory out of date

### Starting over

**Settings → Project → Purge Project Memory** deletes everything and recreates the empty structure. It
asks you to confirm, then asks you to type `PURGE MEMORY`. It's genuinely destructive, and it behaves
like it.

---

## Getting things back out

### Ask

```
@atlas /memory authentication
@atlas /memory deployment runbooks
```

### Browse

The **Memory** sidebar shows the folder structure. Click anything to read it. Indexed notes are filed
under their folders, so a large memory set stays browsable.

### Automatically

You mostly won't query memory yourself — it happens on every request. AtlasMind works out whether your
question can be answered from summaries or needs current facts:

- **Summary questions** get the relevant memory entries directly
- **Questions needing exactness** get the memory *plus* live excerpts from the actual source files those
  notes were written from

That second part matters. A note saying "the router prefers local models" is a summary; when you ask
what the router does *right now*, AtlasMind goes and reads the code rather than trusting the note.

### How relevance is decided

Entries are scored on where your search terms appear — path, title, tags, body, and the source files
behind an imported note — with source-backed operational notes and decision records outranking generated
indexes when you're asking about current state, and newer notes getting a modest edge when everything
else is equal.

Where vector embeddings exist, semantic similarity is blended in.

---

## Session context

Each conversation gets its own working document, updated after every turn: the goal, the current
approach, key findings, what's concluded, open threads, links into project memory, and what just
happened.

It's capped at 4,000 characters and designed so that picking a conversation up cold actually works —
loading it orients the model without rebuilding everything from scratch.

The **Memory Agent** does this maintenance in the background. Point it at a local Ollama model with
`allowedModels` and all of this background work costs you nothing.

Session context is deliberately kept **out of normal memory retrieval**, so temporary working state
never gets confused with durable project knowledge.

Where there's no session document yet, AtlasMind falls back to carrying the recent transcript directly.
That fallback keeps the **most recent** turns and renders them in the order they happened — before
v0.295.1 it did the opposite, keeping the oldest and dropping the newest, so a conversation past about
six turns kept re-reading its own opening. Raising the limits made that worse rather than better,
because the extra room went to older turns.

---

## When you're frustrated, it learns

If AtlasMind detects that you're visibly frustrated with how a conversation is going, it updates your
saved Personality Profile, increases how much recent context it carries if it was retaining too little,
and writes what it learned to `operations/operator-feedback.md`.

That gives it both an immediate correction and something retrievable next time.

---

## What can't go into memory

Project memory is **committed to your repository**. That makes "what may enter memory" a privacy and
security decision, not just a storage one — so everything is scanned before it's written.

**These block the write:**

| Rule | What it catches |
|------|----------------|
| `no-secrets-in-memory` | API keys, tokens, passwords, connection strings |
| `no-prompt-injection` | Attempts to override instructions |
| `no-executable-code-blocks` | Script blocks that could end up being run |
| `no-base64-blobs` | Large encoded payloads |
| `no-url-injection` | Links to credential-harvesting or phishing domains |
| `max-entry-size` | Anything over 50 KB |

**These are flagged but allowed:**

`no-pii-patterns` (emails, phone numbers, national ID numbers), `no-internal-urls` (localhost and
private addresses), `no-excessive-tags` (more than 20), and `markdown-structure` (missing title or
malformed frontmatter).

### It cleans up after itself

A background pass fixes what it safely can: hidden Unicode control characters removed, instruction-like
HTML comments neutralised, secret-shaped values redacted.

Anything **blocked** is moved into quarantine and the note is replaced with a safe placeholder, so
blocked content stops appearing in retrieval. The index reloads automatically afterwards.

### And again on the way out

Before memory reaches a model, it passes through a second, separate check for credentials — a backstop
in case something got in anyway. It covers Anthropic and OpenAI keys, GitHub tokens, bearer tokens, PEM
private keys, database connection strings, and generic `api_key = "..."` assignments. If it strips
anything, it says so.

One layer stops secrets being written; the other stops them being sent. Neither relies on the other.

### The same rules apply to temporary context

Recent conversation carried between turns, chat history summaries and text attachments go through the
same scanner:

- **Blocked** content is excluded entirely
- **Warned** content is redacted and included clearly labelled as untrusted data
- **Clean** content is still treated as *data, not instructions*, and kept outside the trusted part of
  the prompt

---

## Messages from other systems are summarised, never copied

Because memory is committed to your repository, mirroring a colleague's chat messages into it would
commit their words to your repo. So the rule for external chat systems is **derive, don't mirror**.

An inbound message becomes **a follow-up with a link back to the original thread** and a short sanitised
title. The message body is never stored — the record has no field that could hold one. The chat system
stays the record of what was said; AtlasMind records only that there's something to act on and where to
find it.

Everything crossing that line is sanitised first, and a derived record never invents a link to a person
or a run that the original message doesn't support.

---

## Getting the most out of it

1. **Use descriptive paths.** `decisions/use-jwt-for-auth.md`, not `decisions/doc1.md`
2. **Tag consistently** — lowercase, hyphenated. Tags drive search
3. **Record decisions early.** A decision record stops you re-arguing it in three months
4. **Write down what failed.** `misadventures/` is the highest-value folder here
5. **One idea per file.** Split anything that's grown into a document
6. **Run `/import` on an existing project** — it does the boring 80%
7. **Prune occasionally.** Stale memory is worse than no memory, because it's confidently wrong

---

## Settings

| Setting | Default | What it does |
|---------|---------|-------------|
| `atlasmind.ssotPath` | `project_memory` | Where memory lives, relative to your workspace |

When you open a workspace that already has project memory, AtlasMind loads it during startup and
refreshes the Memory sidebar immediately — you don't need to run `/import` again.

---

## Related

- [[Security]] — the write gate and dispatch boundary in context
- [[Chat Commands]] — `/memory`, `/bootstrap`, `/import`
- [[Ideation]] — the research register, which lives in memory
- [[Agents]] — how memory reaches the model

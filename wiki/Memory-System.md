# Memory System (SSOT)

AtlasMind uses a **Single Source of Truth (SSOT)** folder on disk to persist project knowledge. This is not a database — it's a structured collection of Markdown files that live alongside your code.

## Folder Structure

The SSOT lives at the path configured by `atlasmind.ssotPath` (default: `project_memory/`).

```
project_memory/
├── project_soul.md       Project identity, mission, values
├── architecture/          System design, dependency graphs, structure
├── roadmap/               Goals, milestones, planned features
├── decisions/             Architecture Decision Records (ADRs)
├── misadventures/         Failed approaches and lessons learned
├── ideas/                 Feature ideas, explorations, brainstorms
├── domain/                Business logic, conventions, glossary
├── operations/            Runbooks, deployment, CI/CD, project run reports
├── agents/                Agent-specific knowledge
├── skills/                Skill-specific knowledge
└── index/                 Auto-generated search index
```

These folders are defined as `SSOT_FOLDERS` in `src/types.ts`.

---

## Memory Entries

Each piece of knowledge is stored as a `MemoryEntry`:

```typescript
interface MemoryEntry {
  path: string;         // Relative path within SSOT (e.g. "decisions/use-jwt.md")
  title: string;        // Human-readable title
  tags: string[];       // Searchable tags
  lastModified: string; // ISO 8601 creation/update time
  snippet: string;      // Preview slice used in retrieval and UI summaries
  sourcePaths?: string[]; // Files or SSOT notes this entry summarizes
  sourceFingerprint?: string;
  bodyFingerprint?: string;
  documentClass?: string;
  evidenceType?: 'manual' | 'imported' | 'generated-index';
  embedding?: number[]; // Optional vector embedding for semantic search
}
```

---

## Writing to Memory

### Manual (via Chat)

```
@atlas /memory write decisions/use-jwt.md "Use JWT for auth" --tags auth,security
```

Or ask naturally:
```
@atlas Remember that we decided to use JWT for authentication because session cookies don't work well with our microservice architecture.
```

### Programmatic (via Skills)

The `memory-write` skill calls `context.upsertMemory()`:
- Validates entry structure
- Scans content with `MemoryScanner` (see Security below)
- Persists to disk as a Markdown file
- Updates the in-memory index

### Via Bootstrap

`/bootstrap` creates the folder structure and optionally populates `project_soul.md`.

When AtlasMind starts in a workspace that already contains an imported SSOT, it also checks whether those generated memory files still match the current codebase. If imported fingerprints have drifted, AtlasMind shows a warning notification, enables an **Update Project Memory** action in the Memory view, and pins a warning row at the top of the Memory tree until the refresh is run.

While the VS Code window stays open, AtlasMind also watches workspace saves, creates, deletes, and renames outside the SSOT folder. When one of those changes makes imported memory stale, AtlasMind automatically reruns the incremental import so the Memory view catches up without waiting for a reload.

When governance scaffolding is enabled and `atlasmind.projectDependencyMonitoringEnabled` remains on, bootstrap also seeds `operations/dependency-monitoring.md` and `decisions/dependency-policy.md` so teams have a durable place to record update-review rationale, exceptions, and ownership.

### Via Import

`/import` now performs a broader first-pass project ingest. It can populate:
- `architecture/project-overview.md` from README
- `architecture/dependencies.md` from package manifests
- `architecture/project-structure.md` and `architecture/codebase-map.md` from directory listings
- `architecture/runtime-and-surfaces.md`, `architecture/model-routing.md`, and `architecture/agents-and-skills.md` from the core docs set
- `domain/conventions.md` and `domain/product-capabilities.md`
- `operations/development-workflow.md`, `operations/configuration-reference.md`, and `operations/security-and-safety.md`
- `decisions/development-guardrails.md`, `roadmap/release-history.md`, `index/import-catalog.md`, and `index/import-freshness.md`

If `project_soul.md` still contains bootstrap placeholders, import upgrades it into a usable identity document.

Generated import files now include an AtlasMind metadata trailer with generator version, source paths, and source/body fingerprints. Repeat imports use that metadata to refresh changed entries, skip unchanged entries, and preserve generated files that were manually edited after import. AtlasMind also loads those source pointers into memory entries so the orchestrator can jump from a summary note to the authoritative file when a prompt needs live verification. The same metadata also powers startup stale-memory detection and in-session auto-refresh, so AtlasMind only prompts for a memory refresh when imported entries are genuinely out of date. In the Memory sidebar, AtlasMind now files indexed notes beneath their SSOT storage folders so larger memory sets remain easy to browse by area.

### Purge Memory

The Project page in AtlasMind Settings includes a destructive **Purge Project Memory** action. It requires a modal confirmation and then a typed `PURGE MEMORY` confirmation before AtlasMind deletes the SSOT root, recreates the empty scaffold, and reloads memory from disk.

---

## Querying Memory

### Retrieval Algorithm

`memoryManager.queryRelevant(query, maxResults)`:

1. Tokenise the query into lowercase terms
2. Score each entry by weighted field matches:
   - **Path match** — query term appears in the file path
   - **Title match** — query term appears in the title
   - **Tag match** — query term matches a tag exactly
   - **Snippet match** — query term appears in the content body
  - **Source path match** — query term appears in the authoritative files behind an imported note
  - **Document class and evidence type** — source-backed operational notes and ADRs can outrank generated indexes when the request is about current or exact state
  - **Freshness** — newer notes get a modest boost when other relevance signals are similar
3. Rank by total score, descending
4. Return top N results (default: 10, max: 50)

If vector embeddings are present, cosine similarity is blended with keyword scoring.

### Via Chat

```
@atlas /memory authentication
@atlas /memory deployment runbooks
```

### Via the Sidebar

The **Memory** tree view shows the SSOT folder hierarchy. Click any entry to preview its content.

### Via Skills

The `memory-query` skill wraps `context.queryMemory()` and is available to all agents during execution.

---

## Automatic Memory Context

During every orchestrator request:
1. The user's message is classified as summary-safe, hybrid, or live-verify
2. `queryRelevant()` returns the top matching entries
3. For summary-safe asks, those entries are injected directly as project memory
4. For hybrid or live-verify asks, AtlasMind uses `sourcePaths` from the ranked entries to read live excerpts from authoritative files and inject those alongside the memory summary
5. The model gets both the project-memory abstraction and the evidence trail when the prompt needs exactness

This means the more you populate your SSOT, the more contextually aware AtlasMind becomes.

---

## Memory Scanner

The `MemoryScanner` validates content before it is written to SSOT. It has **10 built-in rules**:

### Error-level (blocks the write)

| Rule | What it catches |
|------|----------------|
| `no-secrets-in-memory` | API keys, tokens, passwords, connection strings |
| `no-prompt-injection` | Attempts to override system prompts or inject instructions |
| `no-executable-code-blocks` | Shell/script code blocks that could be auto-executed |
| `no-base64-blobs` | Large base64-encoded payloads (potential data exfiltration) |
| `no-url-injection` | Suspicious URLs pointing to credential-harvesting or phishing domains |
| `max-entry-size` | Entries exceeding 50KB (prevents memory bloat) |

### Warning-level (flagged but allowed)

| Rule | What it catches |
|------|----------------|
| `no-pii-patterns` | Email addresses, phone numbers, SSNs |
| `no-internal-urls` | Localhost and private IP references |
| `no-excessive-tags` | Entries with more than 20 tags |
| `markdown-structure` | Missing title heading or malformed frontmatter |

---

## SSOT Best Practices

1. **Use descriptive paths** — `decisions/use-jwt-for-auth.md` not `decisions/doc1.md`
2. **Tag consistently** — tags power search; use lowercase, hyphenated terms
3. **Record decisions early** — ADRs in `decisions/` prevent re-arguing
4. **Document failures** — `misadventures/` saves time by recording what didn't work
5. **Keep entries focused** — one concept per file; split large documents
6. **Use `/import` on existing projects** — auto-populates the basics so you can build from there
7. **Review periodically** — stale memory is worse than no memory; prune outdated entries

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `atlasmind.ssotPath` | `project_memory` | Relative path to the SSOT folder. If that path is missing, AtlasMind only checks the default `project_memory/` folder before skipping startup auto-load |

---

## Startup Auto-Load

When VS Code opens a workspace that already contains a MindAtlas project, AtlasMind now tries to load that SSOT automatically during activation.

Startup loading prefers:
- the configured `atlasmind.ssotPath` when it exists
- `project_memory/` when the configured path is missing

After startup detection succeeds, AtlasMind refreshes the Memory sidebar immediately so the existing project memory is visible without running `/import` again.

## Scanner Reuse Outside SSOT

AtlasMind now reuses the SSOT memory-scanner rules for transient freeform-chat context as well. Recent session carry-forward, native chat history summaries, and text attachments are scanned before they are passed to a model.

- blocked transient context is excluded entirely
- warned transient context is redacted and included only as explicitly labeled untrusted data
- clean transient context is still treated as data, not instructions, and is kept out of the system-prompt trust boundary

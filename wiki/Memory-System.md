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
  snippet: string;      // The actual content (Markdown)
  timestamp: string;    // ISO 8601 creation/update time
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

### Via Import

`/import` scans the workspace and populates:
- `architecture/project-overview.md` from README
- `architecture/dependencies.md` from package manifests
- `architecture/project-structure.md` from directory listing
- `domain/conventions.md` from config files
- `domain/license.md` from LICENSE

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
1. The user's message is used as a query
2. `queryRelevant()` returns the top matching entries
3. Matching entries are injected into the LLM's context as system-level knowledge
4. The model sees relevant project knowledge without being asked

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
| `atlasmind.ssotPath` | `project_memory` | Relative path to the SSOT folder |

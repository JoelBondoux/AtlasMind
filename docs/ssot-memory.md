# SSOT Memory System

## Overview

The Single Source of Truth (SSOT) is a folder-based memory system that stores all project knowledge in a structured hierarchy. The orchestrator retrieves only the relevant slices for each agent, keeping context windows focused and costs low.

## Folder Structure

```
project_memory/
├── project_soul.md       The living identity document for the project
├── architecture/         System design documents and diagrams
├── roadmap/              Feature plans, milestones, and priorities
├── decisions/            Architecture Decision Records (ADRs)
├── misadventures/        Failed approaches and lessons learned
├── ideas/                Unstructured brainstorms and proposals
├── domain/               Domain knowledge, glossary, business rules
├── operations/           Runbooks, deployment procedures, scripts
├── agents/               Per-agent configuration and custom prompts
├── skills/               Skill definitions and tool schemas
└── index/                Embeddings index for hybrid keyword + hash-vector retrieval
```

## Folder Descriptions

### `project_soul.md`
The identity document. Contains project type, vision, principles, and links to key decisions. Created by the bootstrapper and updated as the project evolves.

### `architecture/`
System design docs: component diagrams, data flow diagrams, API contracts, database schemas.

### `roadmap/`
Feature plans with status tracking. Milestones, sprints, priorities.

### `decisions/`
Architecture Decision Records following the format:
- **Title**: Short description
- **Status**: Proposed / Accepted / Deprecated / Superseded
- **Context**: Why the decision was needed
- **Decision**: What was decided
- **Consequences**: Trade-offs and implications

### `misadventures/`
Failed approaches documented so they are not repeated. Each entry records:
- What was attempted
- Why it failed
- What was learned

### `ideas/`
Unstructured space for brainstorming. No format requirements.

### `domain/`
Domain-specific knowledge: glossary, business rules, entity relationships, external system documentation.

### `operations/`
Deployment procedures, environment setup, monitoring, incident response.

### `agents/`
Per-agent configuration files. Each agent can have a markdown file defining its custom system prompt, behaviour rules, and allowed skills.

### `skills/`
Skill definitions including JSON Schemas for tool parameters.

### `index/`
Generated embeddings index for hybrid keyword + hash-vector retrieval. Not manually edited.

## Memory Entry Format

Each indexed entry has:

```typescript
interface MemoryEntry {
  path: string;       // Relative path within SSOT
  title: string;      // Document title
  tags: string[];     // Categorisation tags
  lastModified: string; // ISO 8601 timestamp
  snippet: string;    // First ~200 chars for preview
  embedding?: number[]; // Internal hashed vector used for retrieval
}
```

## Retrieval

### Hybrid Keyword + Hash-Vector Search
Memory retrieval uses a **hybrid** approach combining lightweight hash-based embeddings with keyword scoring — it is not a neural/semantic search.

1. User query is tokenized and embedded using a deterministic hash function.
2. Candidate entries are scored by cosine similarity **plus** lexical keyword overlap.
3. Top-k entries returned ranked by combined score.
4. Orchestrator injects relevant slices into the agent's context.

### Current Implementation
At activation, AtlasMind indexes text-like SSOT files (`.md`, `.txt`, `.json`, `.yml`, `.yaml`) into in-memory `MemoryEntry` objects and generates a local hashed embedding vector for each entry.

Query ranking combines:
- cosine similarity between the query embedding and entry embedding
- Title match: +3 per term
- Snippet match: +1 per term
- Path match: +2 per term
- Tag match: +2 per term

Results are returned in descending score order.

Query results are clamped to a maximum of **50 entries** regardless of the `maxResults` parameter.

## Writing & Persistence

### Agent Writes
Agents write memory entries via the **`memory-write`** skill. Every write is:

1. **Path-validated** — must be a relative SSOT path with a text-file extension (`.md`, `.txt`, `.json`, `.yml`, `.yaml`). Absolute paths, `..` traversal, and non-text extensions are rejected.
2. **Field-validated** — title ≤ 200 chars, snippet ≤ 4 000 chars, ≤ 12 tags (50 chars each).
3. **Security-scanned** — content is run through the memory scanner before acceptance. Blocked content (prompt injection, API keys) is rejected immediately with a clear error message.
4. **Persisted to disk** — accepted entries are written as markdown files to the SSOT folder so they survive across sessions.

### Upsert Feedback
`upsert()` returns a `MemoryUpsertResult` with one of three statuses:

| Status | Meaning |
|--------|---------|
| `created` | New entry added to index and written to disk |
| `updated` | Existing entry replaced in index and overwritten on disk |
| `rejected` | Entry was not stored; `reason` field explains why |

### Deleting Entries
The **`memory-delete`** skill removes an entry from the in-memory index and deletes the corresponding file on disk.

### Capacity
- In-memory entry count is capped at **1 000 entries**.
- When the cap is reached, new entries are rejected with a clear message. Existing entries can still be updated.

## Bootstrapping

The `bootstrapProject()` function in `src/bootstrap/bootstrapper.ts`:
1. Reads `atlasmind.ssotPath` setting (default: `project_memory`).
2. Rejects unsafe or non-relative SSOT paths.
3. Warns before modifying an existing SSOT folder.
4. Creates only missing files and folders so existing memory is preserved.
5. Optionally initialises a Git repository.
6. Creates `project_soul.md` with starter template.
7. Prompts for project type and injects it into the soul file.

If governance scaffolding is enabled and `atlasmind.projectDependencyMonitoringEnabled` is on, bootstrap also adds starter dependency-governance memory entries under `operations/dependency-monitoring.md` and `decisions/dependency-policy.md`. Those files are meant for rationale, exceptions, and review history rather than live automation state.

After activation, AtlasMind first tries to load the configured `atlasmind.ssotPath` when that folder exists in the workspace.

If the configured path is missing, AtlasMind automatically looks for an existing MindAtlas SSOT in one common location:
- `project_memory/` at the workspace root

When startup discovery succeeds, `MemoryManager.loadFromDisk()` indexes that SSOT immediately and the Memory sidebar refreshes without requiring a manual import or reload.

For workspaces that were previously imported into SSOT memory, AtlasMind also runs a freshness check during startup. It rebuilds the same import candidates used by `/import`, compares their source fingerprints against the metadata stored in generated SSOT files, and marks memory stale when those fingerprints drift. When drift is detected, AtlasMind shows a warning notification with an **Update Memory** action and exposes an **Update Project Memory** button in the Memory view title bar.

## Importing Existing Projects

`/import` performs a more considered first-pass ingest over the workspace so AtlasMind starts with more than a thin metadata snapshot.

The import pipeline can generate structured entries such as:
- `architecture/project-overview.md` from README content
- `architecture/dependencies.md` from manifests and scripts
- `architecture/project-structure.md` and `architecture/codebase-map.md` from directory scans
- `architecture/runtime-and-surfaces.md`, `architecture/model-routing.md`, and `architecture/agents-and-skills.md` from the core docs set
- `domain/conventions.md` and `domain/product-capabilities.md`
- `operations/development-workflow.md`, `operations/configuration-reference.md`, and `operations/security-and-safety.md`
- `decisions/development-guardrails.md`, `roadmap/release-history.md`, `index/import-catalog.md`, and `index/import-freshness.md`

If `project_soul.md` still contains the bootstrap placeholders, import also upgrades it into an initial identity document with a vision, principles, and references into the generated SSOT.

Generated import artifacts now carry a trailing metadata block containing generator version, source paths, and source/body fingerprints. On later `/import` runs AtlasMind compares that metadata so it can:
- refresh entries whose upstream sources changed
- skip entries whose inputs are unchanged
- preserve generated files that were manually edited after import

The same fingerprint metadata now powers the startup stale-memory signal, so AtlasMind only offers the Memory view refresh affordance when imported entries are genuinely out of date.

This keeps `/import` incremental instead of behaving like a blind overwrite pass.

## Purging Project Memory

The Project page in AtlasMind Settings includes a destructive **Purge Project Memory** action. That flow:
- asks for a modal confirmation first
- requires the operator to type `PURGE MEMORY`
- deletes the configured SSOT root
- recreates the baseline SSOT scaffold
- reloads the Memory view from disk

This action is intended for deliberate resets, not routine cleanup.

## Security

### Memory Scanner

Every SSOT document is scanned for prompt-injection patterns and credential leakage before being included in model context (`src/memory/memoryScanner.ts`).

**Scan outcomes:**

| Status | Meaning | Effect |
|--------|---------|--------|
| `clean` | No issues found | Entry included normally |
| `warned` | Warning-level issues (e.g. unusual phrasing, zero-width chars, oversized document) | Entry included; `[SECURITY WARNING]` appended to system prompt |
| `blocked` | Error-level issues (instruction-override phrases, jailbreak keywords, hardcoded secrets) | Entry excluded from `queryRelevant` — never sent to the model |

**Rules by category:**

*Instruction-override / prompt injection (error):*
- `pi-ignore-instructions` — "ignore all previous instructions"
- `pi-disregard-instructions` — "disregard previous instructions"
- `pi-forget-instructions` — "forget everything you know"
- `pi-new-instructions` — "your new/real instructions"
- `pi-system-prompt-override` — `[system]: prompt = …` patterns
- `pi-jailbreak` — known jailbreak keywords (DAN, developer mode, etc.)

*Persona / obfuscation (warning):*
- `pi-act-as` — "act as an unrestricted AI" patterns
- `pi-zero-width` — zero-width or bidirectional Unicode characters
- `pi-html-comment` — HTML comments containing instruction keywords

*Credential leakage:*
- `secret-api-key` — error; blocks the entry
- `secret-token` — error; blocks the entry
- `secret-password` — warning; flags but does not block
- `size-limit` — warning; document exceeds 32 KB

Scanning runs on every `loadFromDisk()` pass and on every `upsert()` call that provides content. Scan results are accessible via `MemoryManager.getScanResults()`, `getWarnedEntries()`, and `getBlockedEntries()`.

### Other Safeguards
- Bootstrap paths must remain inside the workspace as safe relative paths.
- Existing SSOT files are preserved instead of being blindly overwritten.
- Secrets and provider credentials are explicitly out of scope for SSOT storage.
- In-memory entry count is capped at **1,000 entries**.
- Individual SSOT documents larger than **64 KB** are skipped during disk loading.
- Upserts beyond the entry cap are rejected with a clear reason (existing entries can still be updated).
- All agent-written content is scanned before acceptance — blocked content is never stored.
- Path validation rejects absolute paths, parent traversal, and non-text extensions.

### Secrets Vault (planned)
- Secrets and API keys are NEVER stored in the SSOT.
- A `vault/` folder (gitignored) can hold encrypted references.
- Redaction rules strip sensitive patterns before sending context to LLMs.

### Redaction Rules
- Regex patterns for API keys, tokens, and passwords are enforced by the memory scanner before context inclusion.
- Blocked entries are never sent to providers.
- Warning-level entries are explicitly marked in the system prompt so the model treats them skeptically.

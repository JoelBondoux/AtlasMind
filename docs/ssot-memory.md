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
└── index/                Embeddings index for semantic retrieval
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
Generated embeddings index for semantic retrieval. Not manually edited.

## Memory Entry Format

Each indexed entry has:

```typescript
interface MemoryEntry {
  path: string;       // Relative path within SSOT
  title: string;      // Document title
  tags: string[];     // Categorisation tags
  lastModified: string; // ISO 8601 timestamp
  snippet: string;    // First ~200 chars for preview
}
```

## Retrieval

### Semantic Search (planned)
1. User query is embedded.
2. Compared against embeddings in `index/`.
3. Top-k entries returned ranked by similarity.
4. Orchestrator injects relevant slices into the agent's context.

### Keyword Search (current stub)
Substring matching against `title` and `snippet` fields.

## Bootstrapping

The `bootstrapProject()` function in `src/bootstrap/bootstrapper.ts`:
1. Reads `atlasmind.ssotPath` setting (default: `project_memory`).
2. Rejects unsafe or non-relative SSOT paths.
3. Warns before modifying an existing SSOT folder.
4. Creates only missing files and folders so existing memory is preserved.
5. Optionally initialises a Git repository.
6. Creates `project_soul.md` with starter template.
7. Prompts for project type and injects it into the soul file.

## Security

### Current Safeguards
- Bootstrap paths must remain inside the workspace as safe relative paths.
- Existing SSOT files are preserved instead of being blindly overwritten.
- Secrets and provider credentials are explicitly out of scope for SSOT storage.

### Secrets Vault (planned)
- Secrets and API keys are NEVER stored in the SSOT.
- A `vault/` folder (gitignored) can hold encrypted references.
- Redaction rules strip sensitive patterns before sending context to LLMs.

### Redaction Rules (planned)
- Regex patterns for API keys, tokens, passwords.
- Applied automatically when building agent context bundles.
- Configurable per project.

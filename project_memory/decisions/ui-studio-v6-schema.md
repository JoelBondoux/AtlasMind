# UI Studio v6 adds a design graph without renaming the compatibility SSOT

**Decided:** 2026-08-11.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`.

## Context

The v5 `WebsiteWorkspaceConfig` generalized Website Studio into UI Studio but retained one wireframe per
page. That shape cannot safely carry revisioned edits, responsive property inheritance, reusable component
instances, or target-independent mappings. The filename `project_memory/domain/website.json` is already a
tracked compatibility contract used by managers, documentation, and existing projects.

## Decision

Format v6 adds a target-independent design graph with a monotonic revision and stable screen/node IDs. A
v5 → v6 migration transcribes every existing page wireframe node without inventing new design intent.
The existing page wireframe remains a compatibility projection during the transition; when a valid graph is
present, it wins and the projection is rebuilt from it.

The SSOT remains `project_memory/domain/website.json` through 1.0. Product naming does not justify moving a
durable project file and making every external reader discover a new path.

## Options considered

- **Add v6 graph in the current SSOT — accepted.** Gives an explicit migration and preserves compatibility.
- **Rename the file to `ui.json` now — rejected.** Creates path migration, duplicate-file, tooling, and merge
  risks without improving the model.
- **Mutate v5 in place without a version bump — rejected.** Older builds could misread or overwrite facts they
  do not understand.
- **Delete page wireframes immediately — rejected.** Too many current readers would need to move atomically;
  a compatibility projection lets the transition be tested in stages.

## Tradeoffs and consequences

- During the transition the JSON contains both the graph and derived legacy wireframes. Graph precedence is
  load-bearing and must be covered by tests.
- The migration can preserve only facts v5 recorded. Layout modes, tokens, components, states, and mappings
  start absent rather than guessed.
- Newer schemas continue to be refused rather than sanitized down and overwritten.
- A future path rename, if still worthwhile, is a separate post-1.0 compatibility decision.

## Action items

- Implement pure graph sanitation and wireframe transcription.
- Add the 5 → 6 migration and round-trip tests.
- Move existing readers to graph projections incrementally before removing legacy storage in a later schema.


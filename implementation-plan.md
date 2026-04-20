### Implementation Plan: Glob-First Memory System

**Goal:** Refactor the memory system to be more durable, useful, and fast by using the filesystem as the single source of truth, eliminating the need for a central index file.

| Phase | Task | Description |
| :--- | :--- | :--- |
| **1. Discovery** | **Identify Index-Dependent Code** | Search the codebase for any component that reads the current memory index file (e.g., `MEMORY.md`). These are the systems that will need refactoring. |
| | **Analyze Existing Tests** | Review tests related to memory to ensure we have a baseline for behavior. This will help verify the new implementation. |
| **2. Implementation** | **Create `MemoryProvider` Service** | Implement a new service that finds memory files using a glob pattern (e.g., `project_memory/**/*.md`). This service will be the new source of truth for memory entries. |
| | **Refactor Core Logic** | Update the components identified in Phase 1 to use the new `MemoryProvider` instead of the old index file. |
| | **Update Tests** | Adapt existing tests or create new ones to verify that the `MemoryProvider` correctly discovers memory files and that dependent systems function as expected. |
| **3. Cleanup & Verification** | **Delete Old Index File** | Once the refactoring is complete and verified, remove the old memory index file to prevent inconsistencies. |
| | **Run Full Test Suite** | Execute all project tests to ensure the changes have not introduced any regressions. |
| **4. Documentation** | **Update Developer Docs** | Update any internal documentation to reflect the new architecture. |
| | **Create SSOT Entry** | Add a new entry to the project's memory (`project_memory/decisions/`) explaining the rationale for the switch. |

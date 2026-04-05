# AtlasMind Current Analysis - Missing Features

Tags: #feature-analysis #atlasmind #missing-features #roadmap

# AtlasMind: Top 3 Priority Missing Features

## Project Summary
**AtlasMind** is a VS Code extension that acts as a multi-agent AI orchestrator. It:
- Routes tasks across multiple AI models (Claude, GPT, Gemini, Azure OpenAI, Bedrock, local models, etc.)
- Maintains long-term project memory (SSOT - Single Source of Truth)
- Provides 26 built-in skills (file ops, git, code navigation, testing, etc.)
- Decomposes goals into parallel subtasks with approval gating
- Tracks costs and enables specialised agents

**Version**: 0.35.5 | **Type**: VS Code Extension | **License**: MIT

---

## Top 3 Missing Features to Add Next

### 1. **Skill Dependency Resolution & Deployment Chains**
**Problem**: Skills are treated as isolated tools. Complex tasks requiring skill orchestration (e.g., "run tests, lint, then commit changes") need manual sequencing.

**Solution**: Add a lightweight skill dependency graph that:
- Allows skills to declare input/output contracts
- Auto-chains compatible skill outputs to inputs
- Supports rollback on failure (checkpoint-aware)
- Enables the planner to compose multi-step workflows without explicit user guidance

**Impact**: Reduces cognitive load for complex refactoring/deployment tasks; aligns with the project's strength in autonomous orchestration.

---

### 2. **Interactive Skill Result Preview & Dry-Run Mode**
**Problem**: Large-scale `/project` runs can apply many file changes. The current approval gating shows file counts, but not **what changes are being made** in each file.

**Solution**: Enhance the Project Run Center to:
- Show unified diff previews for changed files before execution
- Support `--dry-run` mode for individual skills (test-run without side effects)
- Enable side-by-side comparison of before/after for key changes
- Allow selective approval (approve subtask A, skip subtask B, modify subtask C)

**Impact**: Higher confidence in autonomous runs; reduces accidental breaking changes; addresses a friction point mentioned in safety discussions.

---

### 3. **Custom Skill Scaffolding & Testing Framework**
**Problem**: Adding custom skills requires manual file creation and manual testing. The experimental skill learning is disabled by default.

**Solution**: Introduce a guided skill scaffolder that:
- Generates boilerplate TypeScript skill files with Zod schema validation
- Provides a local skill test harness (run skill in isolation with mocked agents)
- Auto-generates skill documentation and updates the registry
- Includes CI-ready test templates

**Impact**: Lowers friction for extending AtlasMind; empowers users to build domain-specific automation without deep extension architecture knowledge.

---

## Why These Three?

1. **Skill Dependencies** directly extend AtlasMind's orchestration strength → more autonomous workflows
2. **Dry-Run & Preview** addresses the stated safety-first principle → user trust in automation
3. **Skill Scaffolding** reduces barrier to extensibility → community-driven custom skills ecosystem

# Idea — Competitive Analysis: SUPACODE

Status: **competitive watch / prioritization signal** (created 2026-06-20). Subject:
[SUPACODE](https://supacode.sh/) — docs at https://docs.supacode.sh/, source at
https://github.com/supabitapp/supacode. Related roadmap: `docs/roadmap.md` (Frontier / Horizon Watch).

## Why this matters

SUPACODE is a shipping, open-source competitor whose headline feature — running many coding agents in
parallel, **each in its own `git worktree`** — is the exact pattern AtlasMind's roadmap already names as a
concentration bet but has not yet built. The value of this note is **not** new ideas; it is evidence that
worktree-per-agent isolation (and a parallel "command center" UX) is buildable *now*, which argues for
pulling those items forward in priority. It also surfaces one genuine latent defect in AtlasMind today.

## What SUPACODE is

A **native macOS app** (Swift + libghostty, no Electron) positioned as a *"command center for coding
agents."* It does **not** generate code itself — it is a **multiplexer/harness** that runs *other* CLI
agents (Claude Code, Codex, opencode — any terminal agent) in parallel. Pillars:

1. **Parallel agents at scale** — "run 50+ agents in parallel," each an independent terminal-native process.
2. **Git worktree isolation** — *"worktrees are the unit of parallel work."* Each agent gets its own
   `git worktree`, so concurrent agents never clobber a shared working tree.
3. **GitHub integration** — complements `gh`: PR management, CI-check awareness, conflict resolution.
4. **OS sandboxing** — agents launched under macOS sandbox profiles (restricted FS, limited network, no keychain).
5. **Per-repo `.supacode` config** — committed file defining standard agent environments → one-command onboarding.
6. **Native performance + terminal UX** — tabs/splits/search, command palette, worktree sidebar.

**Positioning caveat.** SUPACODE is a *different product category* — a macOS-only terminal app that
orchestrates BYO external CLI agents. AtlasMind is a cross-platform VS Code extension that *is* the
orchestrator (model routing, SSOT memory, cost tracking, privacy, dashboards). AtlasMind should not chase
wholesale parity; the leverage is in the **transferable concepts**, not the form factor.

## How AtlasMind maps today (verified against current code)

| SUPACODE pillar | AtlasMind today | Status |
|---|---|---|
| Parallel agents | `taskScheduler.ts` runs dependency batches via `Promise.all`, capped at `MAX_SCHEDULER_CONCURRENCY` (5). | ✅ Parallelism exists… |
| Worktree isolation | **Zero** `worktree` usage in `src` (grep-confirmed). Parallel batches all edit **one shared working tree**. | ❌ **Latent bug** |
| GitHub PR/CI/conflict | Git skills only (`git-commit/push/branch/apply-patch`); **no** PR creation, CI review, or conflict resolution. GitHub Operator is an agent definition, not a PR workflow. | ❌ Absent |
| OS sandboxing | Approval-first: terminal allow/block-lists + `toolApprovalMode` gating. **No** OS-level isolation. | ⚠️ Partial |
| BYO external CLI agents | Only the Claude Code CLI bridge (`src/providers/claude-cli.ts`), text-only, used as a cheap model adapter — not a general agent multiplexer. | ⚠️ Narrow |
| Committed team config | SSOT (`project_memory/`) + `CLAUDE.md` (human docs). **No** machine-readable committed agent/skill/routing seed. | ❌ Absent |

**Most of these are already on AtlasMind's roadmap** (`docs/roadmap.md`) as *future / horizon* items:

- Line 86: *"Sandboxed execution… Pairs with **git-worktree-per-agent isolation** for parallel fan-out."*
- Line 51: *"PR-native review loop… evolving the GitHub Operator agent into a review-on-PR workflow."*
- Lines 44 / 58: *"Team layer — shared config"* / *"Shared, syncable team config."*
- Line 109 (concentration bet #3): *"Sandboxed execution + worktree isolation."*

So SUPACODE is mainly a **prioritization signal**, not a source of net-new ideas.

## The one genuine defect this exposes

AtlasMind runs up to 5 subtasks concurrently (`Promise.all` in `taskScheduler.ts`) **on a single shared
working tree with no isolation.** Two parallel subtasks editing the same file race each other —
interleaved / lost writes, dirty diffs, and ambiguous checkpoint/rollback boundaries. Under AtlasMind's own
**safety-first** rule this is a **correctness bug**, not a polish item. SUPACODE's worktree model is the
textbook fix and should be treated as the headline finding.

## Recommendations (prioritized)

**P1 — Worktree-per-batch isolation (fixes the defect; already a concentration bet).**
Give each parallel subtask (or batch lane) its own `git worktree` on a scratch branch; merge/apply results
back through the existing checkpoint gate. Directly closes the shared-tree race and unblocks raising the
concurrency cap. Net-new build, but already roadmap-endorsed (lines 86 / 109). *Biggest bang; recommend
promoting to near-term.*

**P2 — PR-native GitHub automation.**
Evolve the GitHub Operator from git primitives into a real `gh`-backed workflow: open PRs, read CI check
results, surface/triage merge conflicts, and (later) post Security / Code-Reviewer inline comments. Matches
roadmap line 51.

**P3 — Parallel "command center" UX (net-new framing).**
SUPACODE's core UX is *watching many agents at once*. AtlasMind's Mission Control / Project Run Center are
single-run oriented. A multi-lane view (N concurrent runs / worktrees, live status, per-lane diff/approve) is
the UX that makes P1 legible to the user. Worth a design spike.

**P4 — Committed team config seed (`.atlasmind.json`).**
A repo-committed, machine-readable seed for agents / skills / routing so a teammate clones and is productive in
one step. Folds into the roadmap "team layer" item; complements (does not replace) SSOT + `CLAUDE.md`.

**P5 — Isolation-first security posture (longer horizon).**
SUPACODE's sandbox profiles validate moving AtlasMind from approval-first toward isolation-first. In a VS Code
extension, worktree isolation (P1) is step one; container / microVM execution for terminal-write is the
roadmap Horizon-1 item (line 86). Direction, not immediate work.

**Explicitly NOT recommended.** Turning AtlasMind into a generic BYO-CLI-agent multiplexer. That is
SUPACODE's category and works *against* AtlasMind's differentiators (integrated routing, memory, cost,
privacy). The Claude-CLI bridge is sufficient; do not generalize it just to match SUPACODE.

## Sources

- SUPACODE site — https://supacode.sh/
- SUPACODE docs — https://docs.supacode.sh/
- SUPACODE source — https://github.com/supabitapp/supacode

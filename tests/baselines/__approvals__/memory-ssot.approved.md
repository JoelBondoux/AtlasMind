## Project Memory is the source of truth (managed by AtlasMind)

`project_memory/` is this project's single source of truth (SSOT) for simple facts: what the product does, its limits,
defaults, settings, tiers or plans, and the decisions behind them. This applies to every agent working in this
repository, whichever tool it runs in.

- **Read Project Memory before code.** For a simple check, start with the pages listed under `## Maintained Pages` in
  `project_memory/project_soul.md`, then `project_memory/domain/product-facts.md`, then the rest of `project_memory/`. Read code when memory
  does not answer the question or the task needs exactness.
- **Change the fact, change the page.** Any change that alters one of those facts updates the Project Memory page that
  records it, in the same change. A change that leaves a page wrong is not finished.
- **Write back what you had to look up.** If no page answers the question, settle it in the code once and record the
  answer on the page it belongs on (or in `project_memory/domain/product-facts.md`), so the next agent does not have to.
- **Prefer maintained pages to imported ones.** A page ending in an `<!-- atlasmind-import` footer is generated from
  other files (README, manifest, docs) and can lag the code; `project_memory/index/import-freshness.md` says which are stale.
  Record a fact on a maintained page: an imported page that is edited by hand stops refreshing.
- **No other agent will do it for you.** AtlasMind's memory agent only runs on AtlasMind chat turns. Work done in any
  other tool (Claude Code, Codex, Copilot, Cursor, Gemini and the rest) reaches Project Memory only if the agent doing
  that work writes it.
- **Settle or record every contradiction; never ignore one.** When Project Memory, the docs and the code disagree, the
  code is what the product does today, and a recorded ruling or decision (for example under `decisions/`) is what it
  should do, so code that contradicts one is a bug to raise rather than a fact to copy. If the fix is in scope and it
  is clear which side is right, correct the wrong side in the same change and say so. Otherwise do not guess: add a
  `- [ ]` line under `## Open` in `project_memory/operations/contradictions.md` (create the page if it is missing) naming
  what disagrees, the paths on each side and why it was not settled, and tell the user. AtlasMind keeps surfacing
  open entries until the box is ticked.
- Never write secrets, credentials or personal data into Project Memory.

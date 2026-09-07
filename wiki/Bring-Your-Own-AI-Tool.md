# Bring Your Own AI Tool

**You don't have to use AtlasMind's chat.** Keep Copilot, Claude Code, Cursor, Codex, Gemini CLI or
Windsurf for writing code, and use AtlasMind for the half those tools don't do: knowing what to build
next, what's blocking it, who owns it, what you deferred, and whether you're fit to release.

This page is for people who already have a coding assistant they like and are not looking for another
one.

---

## Why this works at all

The management layer **reads your repository, not your chat history**. Git, GitHub via the `gh` CLI,
your files, and `project_memory/`. Nothing in the dashboard depends on having asked AtlasMind
anything, which is why it keeps working while a different agent does the typing.

That has a second consequence worth knowing: **most of the dashboard needs no model at all.** Opening
it runs nothing and spends nothing. A model is only involved where you explicitly ask something to be
drafted, assessed or carried out.

---

## What you get without ever opening AtlasMind chat

| | |
|---|---|
| **The Project Dashboard** | All 23 pages — roadmap and dependency graph, issues, pull requests, branches, people and follow-ups, risk, compliance, tech debt, testing evidence, documents, delivery, release readiness, gap analysis, project score |
| **The registers** | Tech debt, risk, compliance and research findings, each graded by a published rule table and each *transitioning* rather than disappearing |
| **The guided GitHub workflow** | Eight stages with declared automation ceilings, evidence requirements and label taxonomy, committed to `workflow.json` so the team shares one definition |
| **Lenses** | Read-only views over what your project declares — flow, change impact, test evidence, state lifecycle, config precedence, field wiring, change story — plus live drift against a running API or database |
| **Ideation** | The thinking board, and turning cards that survived into roadmap items |
| **Project memory** | Readable Markdown your other tool can read too — it's just files in your repo |

---

## Telling your agent the rules

This is the part that makes the two halves work together rather than merely coexist.

AtlasMind writes what it knows into the instruction files your tool **already reads**, so whichever
agent writes the code is told the same rules AtlasMind holds itself to:

| Tool | File |
|---|---|
| GitHub Copilot | `.github/copilot-instructions.md` |
| Claude Code | `CLAUDE.md`, `.claude/CLAUDE.md` |
| OpenAI Codex, Antigravity, and others | `AGENTS.md` |
| Cursor | `.cursorrules` and its rules directory |
| Gemini CLI | `GEMINI.md` |
| Windsurf | `.windsurfrules` |

Cline and Aider read the same formats. What gets written:

- **Your enabled testing methodologies** — what to apply, when, with which tools, and the instruction
  to report the checks and assertions actually produced.
- **The technical-debt markers AtlasMind scans for** — `TODO:`, `FIXME:`, `HACK:`, `XXX:`, plus any
  your project declares. An agent that marks a shortcut its own way produces debt the register can't
  see, and an empty register then reads as *no debt* rather than *not detected*.
- **Your declared GitHub workflow** — branch rules, protected branches, per-stage automation ceilings,
  required evidence, and the label taxonomy. The block says these rules apply to whichever tool is
  reading them, because AtlasMind cannot gate a process it does not run.

### It is a delimited block, and it is yours to delete

Everything is written inside markers:

```
<!-- atlasmind:shared-instructions:start -->
...
<!-- atlasmind:shared-instructions:end -->
```

```
<!-- atlasmind:testing-protocols:start -->
...
<!-- atlasmind:testing-protocols:end -->
```

Non-destructive and reversible: anything you wrote outside the markers is untouched, every path is
validated before writing, and removing a block removes it for good. They are deliberately **two**
blocks rather than one — different questions, changing at different rates, so a file that has one and
not the other keeps what it has.

Run it with **AtlasMind: Sync Testing Protocols to AI Agents** from the Command Palette, or from
Settings → Testing.

---

## What still needs AtlasMind's own agents

Being honest about the boundary, because the point of this page is choosing deliberately:

- **Doing the work** — the 27 specialists, `/project`, `/loop` and Mission Control.
- **The Atlas hand-off pills** — *Plan*, *Resolve* and *Completion check* on a roadmap item, "Work on
  it with Atlas" on an issue, and the register hand-offs. These compose a prompt and hand it to
  AtlasMind chat.
- **Anything that asks a model to assess something** — the risk advisors, research scans, gap
  analysis narration.

Everything those produce is a *draft or a record you approve*, so declining to use them costs you
automation, not information. And nothing stops you copying a hand-off prompt into your own tool
instead — they are just text.

---

## A reasonable setup

1. Install AtlasMind. Skip the provider step for now.
2. Open your project and run **AtlasMind: Open Project Dashboard**.
3. Run `/import` — or let the dashboard read what it can — so the registers have something to work
   from.
4. Settings → Testing: enable the methodologies you actually want, then **Sync Testing Protocols to
   AI Agents**.
5. Set up the workflow on the Workflow page so the automation ceilings and label taxonomy are
   declared and committed.
6. Carry on using your existing assistant. It now has your testing policy, your debt markers and your
   workflow rules in the file it already reads.

Connect a model provider later if you decide you want the agents too. Nothing above stops working if
you do, and nothing above required it.

---

## Related

- [[Architecture]] — how the management layer is put together
- [[GitHub Workflow]] — the eight stages and their ceilings
- [[Skills]] — the testing methodologies and the debt register
- [[Getting Started]] — the full setup, including the chat side

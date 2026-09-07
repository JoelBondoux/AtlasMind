# Not pursuing: a generic BYO-CLI-agent multiplexer

Status: **decided** (recorded 2026-09-07; carried on the backlog since before v0.417.0).

## The decision

AtlasMind will **not** become a generic multiplexer over bring-your-own CLI coding
agents — a surface whose product is "run whichever agent binary you already have,
side by side". That is SUPACODE's category.

## Why it sat in the wrong place

This was carried as an item on `roadmap/improvement-plan.md` with an `#mvp` gate,
which is a category error twice over: it is not work, so it can never be ticked,
and an `#mvp` tag on a non-item inflates every count that reads the gate — the
Road to MVP panel, the roadmap graph, and the MVP progress the dashboard reports.
A decision belongs where decisions are read.

## The reasoning, kept

AtlasMind's differentiators are *integrated*: routing across providers on budget,
speed and capability; SSOT memory that survives the session; per-session cost
attribution; and a privacy boundary that holds because AtlasMind owns the whole
path from prompt to provider. A multiplexer owns none of that — it hands the turn
to somebody else's binary and can only report what came back. Adding the category
would not extend the edge, it would dilute it, and every one of those four
properties would degrade to "whatever the wrapped agent does".

## What this does *not* rule out

Using another vendor's agent as a **completion source** under AtlasMind's own
routing, memory and cost accounting — which is exactly what the ACP provider does
(`src/providers/acp.ts`), in restricted mode, as a source rather than an executor.
The line is ownership of the orchestration, not hostility to other agents.

## Related

- `project_memory/decisions/cutting-edge-routing-roadmap.md` — the same "compound
  the orchestration edge, don't chase model-class features" test.

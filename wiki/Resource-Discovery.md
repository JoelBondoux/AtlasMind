# Resource Discovery

**Finding new capabilities for AtlasMind without going hunting for them.**

Sometimes you need AtlasMind to reach something it doesn't yet know about — your data warehouse, your
issue tracker, your design tool. Somewhere out there, an MCP server or an agent already does that job.
Resource Discovery finds it, tells you what it is, and lets you add it, without you searching GitHub and
reading README files.

It's built on Agentic Resource Discovery, an open standard for finding agentic resources *before* you
use them. The standard is deliberately **discovery-only**: it tells you what exists, and nothing more.
The specification is developed in the open at
[ards-project/ard-spec](https://github.com/ards-project/ard-spec).

The full technical reference is in [docs/resource-discovery.md](../docs/resource-discovery.md).

---

## Where you'll find it

| How | Where |
|---|---|
| **In chat** | `@atlas /discover query a postgres database` |
| **A dedicated tab** | **AtlasMind: Resource Discovery** |
| **The sidebar** | The **Resource Discovery** view — your finders and recent results |
| **During a task** | AtlasMind can look for candidates itself and show you what it found |
| **Publishing your own** | **AtlasMind: Export Resource Catalog** |

---

## Nothing searches until you say so

A **finder** is a place to search. AtlasMind ships two — GitHub Agent Finder and Hugging Face Discover —
and both arrive **switched off**. No discovery traffic leaves your machine until you turn one on.

You can add your own from the Resource Discovery tab: either a search registry or a static catalogue file.

> **About the relevance score:** it means "this looks like what you asked for". It is **not** a trust,
> safety or compliance rating. Read what a resource actually does before you add it.

---

## What happens when you add something

Everything arrives disabled and needs a second, deliberate action from you.

- **MCP servers** land in the MCP Servers panel **disabled**. Switching one on goes through the normal
  MCP trust gate.
- **Nested catalogues** become new finders — also disabled.
- **Agents, skills and APIs** are shown as references. AtlasMind does not wire them up for you.

During a task, the `discover-resources` skill is read-only: it surfaces candidates for you to look at,
and adds nothing itself.

---

## Publishing your own catalogue

**Export Resource Catalog** builds a spec-conformant `ai-catalog.json` describing your agents, skills and
MCP servers, so other tools can find them.

It deliberately **leaves out system prompts, secrets and MCP environment variables**. You can check the
result with the upstream conformance tool.

---

## How AtlasMind handles what comes back

Results come from outside your project, so AtlasMind checks them rather than taking them at face value:

- Catalogue files and search responses are validated against strict rules, with caps on how large and how
  numerous the entries may be
- Addresses that come back must use **HTTPS** and are checked before AtlasMind will fetch anything. Plain
  HTTP and local addresses are allowed only for finders you have explicitly marked as insecure
- Following references from one catalogue to another is depth-limited, so a chain cannot run away
- **Nothing is added on your behalf**
- Trust metadata inside a catalogue is informational only. It is not cryptographically verified, and you
  should not rely on it as a guarantee

---

## Related

- [[Skills]] — connecting and using MCP servers
- [[Tool Execution]] — how approvals work
- [[Security]] — the wider boundary
- [[Configuration]] — the `atlasmind.ard.*` settings

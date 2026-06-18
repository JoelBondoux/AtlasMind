# Resource Discovery (ARD)

AtlasMind integrates [Agentic Resource Discovery](https://agenticresourcediscovery.org/) ([spec](https://github.com/ards-project/ard-spec)) — an open, federated, **discovery-only** protocol for finding agentic resources (MCP servers, A2A agents, Skills, APIs) *before* invocation. AtlasMind is both an ARD **client** (discover, install, in-task discovery, federation) and a **publisher** (export its own catalog).

See [docs/resource-discovery.md](../docs/resource-discovery.md) for the full reference.

## At a glance

| Surface | Where |
|---|---|
| `/discover <query>` chat command | `@atlas /discover book a flight` |
| Resource Discovery panel | `AtlasMind: Resource Discovery` |
| Sidebar tree | **Resource Discovery** view (finders + recent results) |
| In-task skill | `discover-resources` (read-only; surfaces candidates, never installs) |
| Publish | `AtlasMind: Export Resource Catalog (ai-catalog.json)` |

## Agent Finders

A finder is a discovery endpoint. AtlasMind ships **GitHub Agent Finder** and **Hugging Face Discover** **disabled** — no outbound discovery traffic happens until you enable one (deny-by-default). Add your own registry (`POST /search`) or static manifest (`ai-catalog.json`) finders from the panel.

> The relevance **score** is a semantic match indicator — **not** a trust, compliance, or safety rating. Review every resource before installing.

## Installing results

- **MCP servers** are added to the MCP Servers panel **disabled**; enabling them uses the existing MCP trust gate.
- **Nested catalogs / registries** become disabled Agent Finders.
- **A2A agents, skills, and APIs** are surfaced as references (no auto-wiring of remote execution in this version).

## Publishing

Export builds a spec-conformant `ai-catalog.json` of your agents, skills, and MCP servers — **excluding** system prompts, secrets, and MCP `env`. Validate with the upstream tool: `conformance-test manifest <path>`.

## Security

- All manifests and search responses are validated as untrusted input (`urn:ai:` identifiers, strict value-or-reference, byte/entry caps).
- Discovered/referral URLs require HTTPS and are screened against private hosts (SSRF guard); `http`/localhost is allowed only for finders you mark insecure with `atlasmind.ard.allowInsecureEndpoints`.
- Federation and nested-catalog expansion are depth-bounded; nothing auto-installs; `trustManifest` metadata is informational (not cryptographically verified).

See [[Security]] and [[Tool Execution]] for the full boundary, and [[Configuration]] for `atlasmind.ard.*` settings.

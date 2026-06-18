# Agentic Resource Discovery (ARD)

AtlasMind integrates [Agentic Resource Discovery](https://agenticresourcediscovery.org/) ([spec](https://github.com/ards-project/ard-spec)), an open, federated protocol for discovering agentic resources — MCP servers, A2A agents, Skills, and APIs — **before** invocation. ARD answers *"what is available for this task?"*; the resource is then invoked through its own native mechanism (MCP, A2A, etc.). AtlasMind is both an ARD **client** (discover, install, in-task discovery, federation) and a **publisher** (export its own catalog).

## How discovery works

ARD advertises resources two ways, and AtlasMind speaks both:

1. **Registry API** — a discovery service exposing `POST /search`. AtlasMind sends `{ query: { text, filter }, federation, pageSize }` and receives ranked `results[]` (each with an `identifier`, `type`, optional `url`/`data`, and a `score`) plus optional `referrals[]` to other registries.
2. **Static manifest** — `https://<domain>/.well-known/ai-catalog.json` listing `entries[]`. AtlasMind fetches and ranks these locally for `manifest`-kind finders.

> **The relevance `score` (0–100) is a semantic match indicator only — it is NOT a trust, compliance, or safety rating.** AtlasMind always labels it as such. Review every resource before installing it.

## Agent Finders

A "finder" is a discovery endpoint AtlasMind can query. Finders live in the **Resource Discovery** panel and the sidebar tree. AtlasMind ships two defaults — **GitHub Agent Finder** and **Hugging Face Discover** — **disabled**. No outbound discovery traffic happens until you enable a finder (deny-by-default). You can add your own registry or manifest finders, including a local `http://localhost` conformance registry when `atlasmind.ard.allowInsecureEndpoints` is on.

## Using discovery

- **Chat:** `@atlas /discover <what you need>` searches every enabled finder, prints a ranked table with the score disclaimer, and offers one-click install buttons.
- **Panel:** `AtlasMind: Resource Discovery` — search box, finder toggles, result cards with type/score/trust badges, "fetch a manifest by URL", "add a finder", and "export this project's catalog".
- **Tree view:** the **Resource Discovery** sidebar view lists finders (enable/disable inline) and recent results.
- **In-task (agentic):** the read-only `discover-resources` skill lets the orchestrator/agents find missing capabilities mid-task and surface candidates for you to approve. It never installs anything.

## Installing a discovered resource

Installation is always non-destructive and opt-in:

| Resource type | Action |
|---|---|
| `application/mcp-server+json` | Added to the **MCP Servers** panel **disabled**. Enabling/connecting it goes through the existing MCP trust gate — its tools then become AtlasMind skills. |
| `application/ai-catalog+json` / `application/ai-registry+json` | Added as a new Agent Finder, **disabled**. |
| `application/a2a-agent-card+json`, `application/ai-skill`, APIs, other | Surfaced as a reference (URL + metadata). AtlasMind does not auto-wire arbitrary remote execution in this version. |

## Publishing your catalog

`AtlasMind: Export Resource Catalog (ai-catalog.json)` builds a spec-conformant manifest describing this workspace's agents, skills, and MCP servers (with `urn:ai:` identifiers and a `did:web` host) and writes it to a path you choose (defaulting to `.well-known/ai-catalog.json`). **System prompts, secrets, and MCP `env` are never included.** Validate the output with the upstream conformance tool:

```bash
./conformance/bin/conformance-test manifest <path-to-ai-catalog.json>
```

## Security model

- **Untrusted input.** Every manifest and search response is validated: required fields, `urn:ai:` identifier pattern, strict value-or-reference (exactly one of `url`/`data`), and byte/entry caps. Malformed entries are dropped, not fatal.
- **Network safety.** Discovered and referral URLs must be HTTPS and are screened against private/loopback/link-local hosts (SSRF guard). `http`/localhost is allowed only for finders you explicitly mark insecure with `atlasmind.ard.allowInsecureEndpoints` enabled; followed referrals are always screened.
- **Bounded federation.** Referral following and nested-catalog expansion are depth-capped to prevent loops and amplification.
- **Nothing auto-installs.** Discovered MCP servers land disabled; the in-task skill is read-only; finders ship disabled.
- **Trust metadata is informational.** A publisher's `trustManifest` (identity/attestations/provenance) is surfaced read-only; AtlasMind does not cryptographically verify it in this version.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `atlasmind.ard.enabled` | `true` | Enable the panel, `/discover`, and the `discover-resources` skill |
| `atlasmind.ard.federationMode` | `referrals` | `auto`, `referrals`, or `none` |
| `atlasmind.ard.maxResults` | `10` | Max results per search |
| `atlasmind.ard.requestTimeoutMs` | `15000` | Per-request timeout |
| `atlasmind.ard.allowInsecureEndpoints` | `false` | Allow `http`/localhost finders |

Finder definitions themselves are stored in `globalState` (managed from the panel/tree), mirroring how MCP servers are persisted.

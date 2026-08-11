# The full preview is a revisioned projection over a bounded loopback protocol

**Decided:** 2026-08-11.  
**Status:** accepted.  
**Context:** `docs/ui-studio-builder-plan.md`.

## Context

The full preview belongs in VS Code's built-in browser, outside the Studio webview. A useful design loop
needs live visual updates and two-way selection, but a browser page is an untrusted boundary and must not
be allowed to send workspace paths, commands, graph fragments, or source code to the extension host.

## Decision

The existing tokenized loopback preview server will grow a Studio-only live channel. The host sends
sanitized, revisioned render state. A frozen AtlasMind-owned preview runtime may send only allow-listed
selection and viewport events containing bounded IDs, revision numbers, and dimensions.

Every event is resolved by the host against the current graph and preview session token. Stale or unknown
revisions, IDs, event types, and values are refused. The browser never chooses a file, command, tool,
source fragment, or mutation. A preview click can request selection; design edits still use closed host-side
edit commands.

The runtime is a Studio draft facility. Normal generated/exported UI remains script-free by default and
does not acquire the preview channel.

## Options considered

- **Revisioned loopback channel with frozen runtime — accepted.** Preserves the built-in-browser experience
  while keeping authority in the extension host.
- **Poll and reload complete HTML — viable fallback, rejected as the target.** Safe but loses selection,
  scroll, focus, and competitive edit latency.
- **Let preview post graph patches — rejected.** It turns an untrusted document into an arbitrary document
  editor and duplicates validation logic.
- **Run the whole editor in the browser — rejected.** It collapses the webview/host security boundary and
  makes source/tool permissions harder to reason about.

## Tradeoffs and consequences

- The extension owns connection lifecycle, reconnection, token expiry, and revision ordering.
- Selection and viewport state can be ephemeral; design mutations are durable only after the reducer accepts
  them and the workspace manager saves the resulting graph.
- Live preview requires integration tests for reconnect, stale events, replay attempts, and token isolation.
- Content Security Policy must name only the loopback origin needed by the frozen runtime.

## Action items

- Stabilize graph revisions and edit commands before adding the live transport.
- Define a closed preview event union and maximum payload sizes.
- Add two-way selection after reconnect/revision tests pass.


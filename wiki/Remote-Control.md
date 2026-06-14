
> **Note:** The `project_memory/` folder is only present in development and feature branches. It is excluded from the `master` branch and all release builds.

# Remote Control (Web → Desktop)

AtlasMind ships a **thin web client** that runs in the VS Code web extension host
(`vscode.dev`, `github.dev`, `code-server`) and remote-controls a **full desktop
instance** of AtlasMind over a local WebSocket connection.

This mirrors [`docs/remote-control.md`](https://github.com/JoelBondoux/AtlasMind/blob/develop/docs/remote-control.md).

## Why a remote client instead of a web port

The web extension host runs inside a browser Web Worker with **no Node.js runtime**.
AtlasMind depends on Node built-ins throughout — `fs`, `path`, `os`, `crypto`, and most
critically `child_process` (`spawn`/`exec`), which powers on-device OS voice, the local
speech-to-text transcriber, the Claude CLI provider, stdio MCP servers, and project
routines. A genuine browser port would have to disable all of that.

Instead, the desktop instance keeps doing every Node-heavy operation, and the web build
becomes a remote UI that relays user intent and renders responses. **Secrets never leave
the desktop.**

## Architecture

```
 vscode.dev (web, Web Worker)            Desktop AtlasMind (Node)
 ┌───────────────────────────┐   ws://   ┌────────────────────────────┐
 │ ChatClientPanel           │ 127.0.0.1 │ RemoteControlServer (paired)│
 │ RemoteClient  ◄───────────┼──:PORT───►│ RemoteBridge → chatPanel    │
 │  (paired bearer token)    │           │ Orchestrator / MCP / fs     │
 └───────────────────────────┘           │ SecretStorage (keys here)   │
                                          └────────────────────────────┘
```

**Host-agnostic webview seam.** The chat webview's front-end script only does
`postMessage`/`onmessage` and does not know whether its host is the local
orchestrator-backed panel or a remote relay. On desktop the host is the chat panel; on
web it is `RemoteClient`, which forwards the same messages over the socket. On the
desktop, `RemoteBridge` fans outbound messages out to local + remote clients, and
validates every inbound remote frame with the existing `isChatPanelMessage()` guard
before dispatch. Remote clients can only do what the local chat UI can already do.

## Wire protocol

Each frame is a JSON envelope `{ v, kind, id?, channel, payload }`:

- `kind: 'auth'` — first client frame carrying the bearer token; mismatched tokens are
  refused.
- `kind: 'msg'`, `channel: 'chat'` — a `ChatPanelMessage` (the same discriminated union
  the local webview uses), re-validated server-side.
- `kind: 'rpc'`, `channel: 'cost' | 'runs'` — read-only request; answered with an `ack`
  sharing the same `id`.
- `kind: 'error'` — validation/auth failure; the frame is dropped and audited.

## Security model

| Control | Behaviour |
|---|---|
| Off by default | Server never listens until `AtlasMind: Enable Remote Control` is run and `atlasmind.remote.enabled` is on. |
| Localhost only (v1) | Binds to `127.0.0.1`. Cross-machine reach is a later phase requiring TLS. |
| Pairing + bearer token | Token stored in `SecretStorage` on both sides; no valid token → refused. |
| Workspace-trust gate | Refuses to serve until the workspace is approved for remote control. |
| Redaction boundary | API keys/secrets are never serialized across the bridge. |
| No silent approvals | Remote tool approvals require an authenticated session, are audited, and **default to deny** on disconnect. |
| Inbound validation | Every chat frame passes `isChatPanelMessage()` before dispatch. |
| Audit + revoke | Connections/commands logged; `AtlasMind: Revoke Remote Access` rotates the token and drops sessions. |

See [[Security]] and [[Tool Execution]] for how this fits the broader safety model.

## Commands & settings

| Command | Purpose |
|---|---|
| `AtlasMind: Enable Remote Control` | Start the localhost server (trust prompt + pairing code). |
| `AtlasMind: Disable Remote Control` | Stop the server and drop sessions. |
| `AtlasMind: Show Remote Pairing Code` | Re-display the current pairing code. |
| `AtlasMind: Revoke Remote Access` | Rotate the token and disconnect all clients. |

| Setting | Default | Purpose |
|---|---|---|
| `atlasmind.remote.enabled` | `false` | Master switch for the desktop server. |
| `atlasmind.remote.port` | `0` (auto) | Localhost port to bind (`0` = free port). |

## Limitations (v1)

- Same-machine (localhost) only. Cross-machine remote is planned via VS Code Tunnels or
  a self-hosted relay.
- Web client exposes chat plus **read-only** cost and project-run dashboards; mutating
  panels remain desktop-only.

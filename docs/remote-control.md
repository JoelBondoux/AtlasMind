# Remote Control (Web → Desktop)

AtlasMind ships a **thin web client** that runs in the VS Code web extension host
(`vscode.dev`, `github.dev`, `code-server`) and remote-controls a **full desktop
instance** of AtlasMind over a local WebSocket connection.

This document describes why the feature exists, its architecture, the wire protocol,
and — most importantly — its security model.

---

## Why a remote client instead of a web port

The web extension host runs extension code inside a browser Web Worker with **no
Node.js runtime**. AtlasMind depends on Node built-ins throughout — `fs`, `path`,
`os`, `crypto`, and most critically `child_process` (`spawn`/`exec`), which powers:

- on-device OS voice (SAPI / `say` / `espeak-ng`),
- the local speech-to-text transcriber,
- the Claude CLI provider,
- stdio MCP servers,
- project routines / `/ship`.

A genuine browser port would have to disable all of the above. Instead, the desktop
instance keeps doing every Node-heavy operation, and the web build becomes a remote
UI that relays user intent and renders responses. Secrets never leave the desktop.

---

## Architecture

```
┌─ vscode.dev (web extension host, Web Worker) ─┐         ┌─ Desktop AtlasMind (Node) ───────────────┐
│  Thin client extension  (browser build)        │  ws://  │  Full extension + RemoteControlServer      │
│                                                 │ 127.0.0.1│                                           │
│   ChatClientPanel  ──┐                          │  :PORT  │   RemoteControlServer (opt-in, paired)     │
│                      │  postMessage / onmessage │ ◄─────► │        │                                   │
│   RemoteClient  ◄────┘  (same protocol as the   │         │   RemoteBridge ── taps chatPanel host ──┐ │
│        │                 local webview bridge)  │         │        │                                │ │
│        │  bearer token (web SecretStorage)      │         │   Orchestrator / Router / MCP / Voice / fs│
└────────┴────────────────────────────────────────┘         │   SecretStorage (API keys stay here)      │
                                                             └────────────────────────────────────────────┘
```

### The host-agnostic webview seam

The script that runs **inside** the chat webview iframe only ever calls
`postMessage(...)` to its host and listens for `message` events. It has no knowledge
of whether the host is the local orchestrator-backed panel or a remote relay. We
exploit this:

- **Desktop:** the host is the existing chat panel, wired to the `Orchestrator`.
- **Web:** the host is `RemoteClient`, which forwards the identical messages over the
  WebSocket and replays the desktop's responses back into the webview.

On the desktop, `RemoteBridge` wraps the chat panel's webview host. Outbound
`webview.postMessage` calls are fanned out to (a) the real local webview and (b) every
connected remote client. Inbound frames from a remote client are validated by the
**existing `isChatPanelMessage()` guard** (`src/views/chatPanel.ts`) before they are
dispatched into the same `switch (message.type)` handler the local UI uses. No new
command surface is introduced — remote clients can only do what the local chat UI can
already do, and only after passing the same validation.

---

## Wire protocol

Every frame is a JSON envelope:

```ts
interface RemoteEnvelope {
  v: 1;                                  // protocol version
  kind: 'auth' | 'msg' | 'rpc' | 'ack' | 'error';
  id?: string;                           // correlation id for rpc/ack
  channel: 'chat' | 'cost' | 'runs';     // logical surface
  payload: unknown;                      // see below
}
```

- **`auth`** — first frame from the client; `payload = { token: string }`. The server
  rejects the connection if the token does not match the paired token in
  `SecretStorage`.
- **`msg`** on `channel: 'chat'` — a `ChatPanelMessage` (the exact discriminated union
  the local webview uses). Re-validated server-side with `isChatPanelMessage()`.
- **`rpc`** on `channel: 'cost' | 'runs'` — a read-only request (e.g. snapshot of the
  current cost breakdown or the recent run list). The server responds with an `ack`
  carrying the same `id`.
- **`error`** — validation/auth failure; the offending frame is dropped and audited.

The `chat` channel is bidirectional and carries the full streaming chat experience.
The `cost` and `runs` channels are **request/response and read-only** in v1.

---

## Security model

Remote control exposes a desktop instance that can spawn processes, write files, and
hold API keys. The security posture is therefore strict and **default-deny**.

| Control | Behaviour |
|---|---|
| **Off by default** | The server never listens until the user runs `AtlasMind: Enable Remote Control` and `atlasmind.remote.enabled` is on. |
| **Localhost only (v1)** | The server binds to `127.0.0.1`. True cross-machine reach (VS Code Tunnels / relay) is a later phase and will require TLS. |
| **Pairing + bearer token** | A pairing code is exchanged once; a bearer token is stored in `SecretStorage` on both sides. No valid token → connection refused. Modeled on `ToolWebhookDispatcher`'s token handling. |
| **Workspace-trust gate** | The server refuses to serve until the workspace has been explicitly approved for remote control, mirroring `ToolWebhookDispatcher.ensureWorkspaceApproval`. |
| **Redaction boundary** | API keys and other secrets are never serialized across the bridge. The desktop executes; the client only receives already-redacted results. |
| **No silent approvals** | Remote `resolveToolApproval` decisions require an authenticated session and are audited. On client disconnect, any pending approval **defaults to deny**. A remote peer can never auto-approve `ask-on-write` / `ask-on-external` tools without an explicit action. |
| **Inbound validation** | Every inbound chat frame passes `isChatPanelMessage()` before dispatch; invalid frames are dropped and logged. |
| **Audit + revoke** | Connections and remote commands are logged. `AtlasMind: Revoke Remote Access` rotates the token and drops all sessions. |

---

## Commands & settings

| Command | Purpose |
|---|---|
| `AtlasMind: Enable Remote Control` | Start the localhost server (prompts for workspace trust + shows the pairing code). |
| `AtlasMind: Disable Remote Control` | Stop the server and drop sessions. |
| `AtlasMind: Show Remote Pairing Code` | Re-display the current pairing code. |
| `AtlasMind: Revoke Remote Access` | Rotate the token and disconnect all clients. |

| Setting | Default | Purpose |
|---|---|---|
| `atlasmind.remote.enabled` | `false` | Master switch for the desktop remote-control server. |
| `atlasmind.remote.port` | `0` (auto) | Localhost port to bind; `0` picks a free port. |

---

## Build pipeline

The extension is bundled with **esbuild** into two targets:

- `out/extension.js` — Node target, the desktop `main` entry.
- `out/web/extension.js` — browser target, the `browser` entry used by the web host.

`tsc` is retained for type-checking (`--noEmit`) and for emitting the Node-only CLI
(`bin`). Node-only modules (`ws`, anything importing `child_process`/`fs`) are excluded
from the browser bundle; the web build imports only `src/web/*`, `src/remote/protocol.ts`
(which is Node-free), and shared webview assets.

---

## Limitations (v1)

- Same-machine only (localhost). Cross-machine remote is a planned follow-up via VS
  Code Tunnels or a self-hosted relay.
- The web client exposes chat plus **read-only** cost and project-run dashboards.
  Mutating panels (memory browser, settings, MCP management) remain desktop-only.

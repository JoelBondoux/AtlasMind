# Remote Control

**Use AtlasMind from a browser, with the real work still happening on your desktop.**

Open `vscode.dev`, `github.dev` or a `code-server` instance, and AtlasMind's chat panel is there —
talking to the full AtlasMind running on your own machine. You get the same agents, models, memory and
tools. Your API keys never leave your desktop.

Off by default. You turn it on deliberately, and you can revoke it instantly.

---

## Why it works this way

VS Code's web version runs extensions inside a browser sandbox with **no Node.js**. AtlasMind needs Node
for a lot of what it does — reading files, running your tests, launching subscription agents, connecting
MCP servers, on-device speech.

A genuine browser port would have to switch all of that off. So instead, your desktop keeps doing the
real work and the browser becomes a remote control for it.

```
 Browser (vscode.dev)                    Your desktop
 ┌───────────────────────────┐          ┌────────────────────────────┐
 │  AtlasMind chat panel     │◄────────►│  The real AtlasMind        │
 │  (no keys, no files)      │  local   │  Agents, models, memory    │
 └───────────────────────────┘  socket  │  Your API keys stay here   │
                                         └────────────────────────────┘
```

The chat panel itself doesn't know or care which one it's talking to — which is why the remote version
behaves identically, and why a remote client can never do anything the local chat couldn't already do.

---

## Turning it on

| Command | What it does |
|---|---|
| **AtlasMind: Enable Remote Control** | Starts the local server, asks you to trust the workspace, and shows a pairing code |
| **AtlasMind: Enable Remote Control (Gateway)** | The cross-machine version — switches to gateway mode and starts the server behind your own sign-in gateway. See [below](#reaching-it-from-another-machine) |
| **AtlasMind: Show Remote Pairing Code** | Shows the current code again |
| **AtlasMind: Disable Remote Control** | Stops the server and drops every session |
| **AtlasMind: Revoke Remote Access** | Rotates the token and disconnects everyone, immediately |

| Setting | Default | What it does |
|---|---:|---|
| `atlasmind.remote.mode` | `localhost` | `localhost` for same-machine, `gateway` for cross-machine |
| `atlasmind.remote.port` | `0` | `0` picks a free port. Pin it if you're using gateway mode |
| `atlasmind.remote.enabled` | `false` | ⚠️ Declared but not currently read — the commands above are what start and stop the server |

---

## How it's kept safe

| | |
|---|---|
| **Off until you say otherwise** | The server never listens until you deliberately run one of the enable commands |
| **Never opens a port to the world** | It always binds to your own machine only |
| **Pairing required** | A token, stored in the OS keychain on both sides. No valid token, no connection |
| **Workspace trust** | It refuses to serve a workspace you haven't approved for remote control |
| **Keys stay put** | Secrets are never serialised across the connection |
| **No silent approvals** | Remote tool approvals need an authenticated session, are logged, and **default to deny** the moment the connection drops |
| **Everything is checked** | Every incoming message is validated before it's acted on |
| **Full audit, instant revoke** | Connections and commands are logged, and one command rotates the token and drops all sessions |

See [[Security]] and [[Tool Execution]] for how this sits in the wider model.

---

## Reaching it from another machine

AtlasMind hosts no relay service, and it will not open a port for you. If you want browser access from
elsewhere, **gateway mode** lets you put your own infrastructure in front:

Your own sign-in-protected reverse proxy (a Cloudflare Worker, for example) plus a tunnel back to your
machine. No inbound port is opened. The browser holds no token at all — your gateway authenticates the
person and passes a secret header that your desktop verifies. An optional user-ID header gets recorded
for the audit log.

Every desktop gate still applies on top.

Pin `atlasmind.remote.port` first, then run **AtlasMind: Enable Remote Control (Gateway)**.

---

## What you don't get in the browser

- **Chat, plus read-only cost and project-run dashboards.** Panels that change things stay on the desktop.
- **Cross-machine access needs your own gateway and tunnel.** Same-machine needs neither.

---

## Related

- [[Security]] — the wider security model
- [[Tool Execution]] — how approvals work
- [[Configuration]] — the `atlasmind.remote.*` settings

# Idea — Remote Web Access (drive AtlasMind + view dashboards from the JoelBondoux.net login)

Status: **design proposal + Phase B implementation spec** (created 2026-07-24). Extends the
shipped v1 remote-control subsystem ([../../docs/remote-control.md](../../docs/remote-control.md))
toward the cross-machine, website-authenticated reach its own docs flag as "a later phase …
will require TLS." Grounded in the **real** JoelBondoux platform topology (see
"The platform this plugs into" below), not a generic cloud design.

## Goal

Let The User sign in at **JoelBondoux.net** and, from any browser:

1. **View / manage AtlasMind dashboards** (cost, project runs) remotely.
2. **Drive the orchestrator** on the host PC (chat + tool runs) remotely — "remote working."

…as a tool on the existing login, over TLS, with **no inbound port** on the home PC, and
without weakening AtlasMind's safety-first, deny-by-default posture.

## The platform this plugs into (verified from the local repos)

JoelBondoux.net is a **static shell**; the real system is a **Cloudflare Workers** monorepo
(`JoelBondoux/joelbondoux-platform`, private, not cloned locally) plus self-hosted services:

| Host | Runs | Role |
|---|---|---|
| `joelbondoux.net` | static files | marketing shell; nav "Login" → `login.joelbondoux.net/login` |
| `login.joelbondoux.net` | Cloudflare Worker (`login` service) | **SSO**; issues the shared `sid` session cookie; `/apps` launcher lists a user's tools |
| `api.joelbondoux.net` | Cloudflare Worker | existing "AI orchestrator" API |
| `music.joelbondoux.net` | Cloudflare Worker `gateway/` | **the precedent** — SSO-gated gateway fronting a self-hosted box over a Cloudflare Tunnel |

**Tool registry** = `packages/contract/src/tools.ts` in the platform repo — the single source
of truth for what tools exist and who may open them. `login`'s RPC enforces a **default-deny**
per-tool grant.

### The MusicGen gateway = the blueprint

`C:\Users\joel\OneDrive\Dev\Websites\JoelBondoux-MusicGen\gateway` is a working, deployed
instance of exactly the shape AtlasMind needs. Key facts read from `gateway/src/index.ts`,
`gateway/wrangler.jsonc`, and its README:

- **Custom-domain Worker** (`music.joelbondoux.net`), `run_worker_first: true` so the Worker
  gates *every* request including static assets.
- **Identity via service binding** — `wrangler.jsonc`: `"services": [{ "binding": "IDENTITY",
  "service": "login" }]`. Consumed as **Workers RPC**:
  ```ts
  IDENTITY.verifySession(sidToken): Promise<IdentityUser | null>
  IDENTITY.checkToolAccess(userId, toolKey): Promise<{ allowed, role }>
  ```
- **Session** = `sid` cookie (read from the `Cookie` header, length-bounded). No token → 302 to
  `https://login.joelbondoux.net/login?return_to=<url>` (API paths get a 401 JSON with `loginUrl`).
- **Per-tool default-deny** — `TOOL_KEY = "music"`; `checkToolAccess` must return `allowed:true`
  or the user gets 403 "access has not been granted."
- **Reach** — approved API calls are proxied to `ORIGIN_URL = https://music-origin.joelbondoux.net`,
  a **dedicated Cloudflare Tunnel** (`music-lab`) → `http://127.0.0.1:4173`. A shared
  `ORIGIN_SECRET` header (`x-music-origin-secret`) authenticates the Worker→origin hop; the Worker
  also forwards `x-music-user-id`. Local engine binds `127.0.0.1` and is "never exposed directly."
- **Ops** — `install-music-lab-task.ps1` runs the engine and `cloudflared` as independent Windows
  per-user logon tasks. Strong CSP + security headers, allowlisted API routes, bounded bodies.
- **The one gap for us:** this gateway is **HTTP request/response only — no WebSocket upgrade
  handling.** AtlasMind's remote protocol (`../../src/remote/protocol.ts`) is WebSocket.

## What AtlasMind already ships (≈80% of the desktop side)

| Piece | File | Gives us |
|---|---|---|
| Paired WS server (desktop) | [../../src/remote/remoteControlServer.ts](../../src/remote/remoteControlServer.ts) | Binds a paired client to a real `ChatPanel`; token auth (timing-safe), workspace-trust gate, revoke, read-only cost/runs RPC. |
| Host-agnostic seam | [../../src/remote/remoteBridge.ts](../../src/remote/remoteBridge.ts) | The webview can't tell local orchestrator from remote relay — so the **full, unmodified** chat/orchestrator works remotely. |
| Browser client | [../../src/web/remoteClient.ts](../../src/web/remoteClient.ts) | Pure browser `WebSocket` (no Node); auth, reconnect, RPC correlation. |
| Wire protocol | `../../src/remote/protocol.ts` | Node-free, versioned envelopes; channels `chat` (streaming), `cost`+`runs` (read-only RPC). Reused verbatim. |

The server binds `127.0.0.1` and authenticates with an in-band pairing token. **That is exactly
the shape a Cloudflare Tunnel expects to sit in front of** — the same slot the MusicGen local
engine occupies.

## Target topology (Phase B)

```
Browser (atlas.joelbondoux.net, has `sid`)
   │  wss  (same-origin; sid cookie sent on the upgrade)
   ▼
atlas gateway Worker  ── IDENTITY.verifySession(sid) + checkToolAccess(uid,"atlasmind") ──► login Worker
   │  (on WS upgrade: 302→login if no session, 403 if tool not granted)
   │  wss proxy, injects  x-atlas-origin-secret + x-atlas-user-id
   ▼
Cloudflare Tunnel `atlas-lab`  →  atlas-origin.joelbondoux.net  →  ws://127.0.0.1:<remote.port>
   ▼
Desktop AtlasMind — RemoteControlServer (existing) — Orchestrator / MCP / API keys stay here
```

Both `cloudflared` and the Worker are **outbound/edge** — no inbound firewall port is opened on
the home network, satisfying the deny-by-default reach requirement while reusing the proven
MusicGen deployment.

## Which repo each change lands in

| Change | Repo | Notes |
|---|---|---|
| `atlasmind` tool entry (default-deny) + launcher tile | `joelbondoux-platform` (`packages/contract/src/tools.ts`) | **not local** — must be done there |
| `atlas` gateway Worker (clone of `music` gateway + WS proxy) | `joelbondoux-platform` (or a new `gateway/` beside MusicGen) | see B1 |
| Cloudflare Tunnel `atlas-lab` + Windows logon task | ops / home PC | mirror `install-music-lab-task.ps1` |
| Desktop WS-server tweaks for gateway-fronted mode | **this repo** (`src/remote/*`) | see B3; small |
| Web frontend served as gateway `ASSETS` | `joelbondoux-platform` or built from `src/web` | see B4 |

## Phase B — implementation-ready spec

### B0 · Register the tool (platform repo)

Add an `atlasmind` entry to `packages/contract/src/tools.ts` (key `"atlasmind"`, seeded
**default-deny**, launcher title/URL `https://atlas.joelbondoux.net`). Grant it to The User's
account only. This is what makes it "a tool on my JoelBondoux.net login" and what
`checkToolAccess` gates on.

### B1 · The `atlas` gateway Worker (platform repo)

Start from `MusicGen/gateway` verbatim, then change:

- `wrangler.jsonc`: `name: "atlas"`, `routes: [{ pattern: "atlas.joelbondoux.net",
  custom_domain: true }]`, keep `services: [{ binding: "IDENTITY", service: "login" }]`,
  `vars.ORIGIN_URL = "https://atlas-origin.joelbondoux.net"`, secret `ORIGIN_SECRET`
  (`wrangler secret put`).
- `TOOL_KEY = "atlasmind"`, `SESSION_COOKIE = "sid"`, reuse `authenticate()` unchanged
  (verifySession → checkToolAccess → 302/403/503 exactly as MusicGen does).
- **New — WebSocket upgrade branch** (the delta vs MusicGen). In `fetch`, before the HTTP path:
  ```ts
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const identity = await authenticate(request, env, /*isApi*/ true); // 401/403 as JSON-less 1008 close or pre-upgrade response
    if (identity instanceof Response) return identity;                 // reject upgrade if unauthenticated/denied
    const origin = new URL(env.ORIGIN_URL);
    origin.protocol = "https:";                                        // cloudflared upgrades ws over https
    const upstream = new Request(origin, request);                     // preserves Upgrade + Sec-WebSocket-* headers
    upstream.headers.set("x-atlas-origin-secret", env.ORIGIN_SECRET);
    upstream.headers.set("x-atlas-user-id", String(identity.id));
    return fetch(upstream);                                            // Workers returns the 101 + webSocket pass-through
  }
  ```
  Keep MusicGen's HTTP asset path for the SPA shell, its CSP (with `connect-src 'self'` — a
  same-origin `wss://atlas.joelbondoux.net` is allowed), security headers, and bounded bodies.
- Optionally also expose read-only **Tier-1 HTTP routes** (`GET /api/cost`, `GET /api/runs`)
  proxied to the origin, mirroring MusicGen's `API_ROUTES` allowlist — so dashboards work even
  without opening the WS.

### B2 · Cloudflare Tunnel + ops (home PC)

- New named tunnel `atlas-lab` → hostname `atlas-origin.joelbondoux.net` → `http://127.0.0.1:<port>`
  (the AtlasMind `remote.port`). Separate tunnel so it is independent of `music-lab`/HireLine.
- A Windows per-user logon task (clone `install-music-lab-task.ps1`) starts `cloudflared`; VS Code
  + AtlasMind with remote control enabled provides the origin. Document that **live control
  requires the PC on and AtlasMind running** (Tier-1 snapshots, if added, do not).

### B3 · AtlasMind desktop changes (this repo — small, enumerated)

Goal: let the gateway (not a hand-paired browser) be the trusted client, authenticated by the
shared origin secret instead of an in-band token The User would have to copy.

1. **Stable port** — a real default for `atlasmind.remote.port` (or a new
   `atlasmind.remote.originPort`) so the tunnel config is fixed. Keep binding `127.0.0.1`.
2. **Gateway auth mode** — in [../../src/remote/remoteControlServer.ts](../../src/remote/remoteControlServer.ts),
   capture the upgrade `request` in the `connection` handler (currently
   `server.on('connection', socket => …)` ignores it — change to `(socket, request) =>`) and, when
   a new `atlasmind.remote.mode = "gateway"` is set, verify `x-atlas-origin-secret` (timing-safe,
   reusing the existing `PAIRING_TOKEN_SECRET_KEY` slot as the shared `ORIGIN_SECRET`) on the
   upgrade. On success, mark the session authenticated without requiring the in-band `auth` frame;
   read `x-atlas-user-id` into the audit log. Localhost mode keeps today's in-band token flow.
3. **Preserve every existing gate** — workspace-trust approval, redaction boundary, and the
   tool-approval boundary stay on the desktop; pending approvals still **default-deny on
   disconnect** (already true). Add per-action re-confirm for destructive tools when the driver
   is remote (`ask-on-write`/`ask-on-external` cannot be auto-approved remotely — keep it).
4. **Commands/settings** — add `AtlasMind: Enable Remote Control (Gateway)` and settings
   `atlasmind.remote.mode = off | localhost | gateway`. Reuse existing disable/revoke/showDashboard.

### B4 · Web frontend (platform repo or built from `src/web`)

- Reuse the existing chat webview assets and `../../src/web/remoteClient.ts` logic; it already
  speaks `protocol.ts` over a browser `WebSocket`. Point it at a **same-origin**
  `wss://atlas.joelbondoux.net` (no token in the browser — the `sid` cookie rides the upgrade and
  the gateway does auth).
- Serve the built SPA as the gateway Worker's `ASSETS` (like MusicGen's `../public`).
- Handle the gateway's 401/redirect: on socket close with an auth error, send the user to
  `loginUrl`. Add the Tier-1 dashboards (read `GET /api/cost` / `runs`, or the `cost`/`runs` RPC).

### Auth / session sequence

1. Browser opens `atlas.joelbondoux.net` → gateway `authenticate()` → no `sid` → 302 to
   `login.joelbondoux.net/login?return_to=https://atlas.joelbondoux.net/…`.
2. SSO signs in, sets `sid`, `safeReturnTo` bounces back to `atlas.` (allowed: subdomain of apex).
3. Gateway serves the SPA (session valid + `atlasmind` tool granted, else 403 "access not granted").
4. SPA opens `wss://atlas.joelbondoux.net`; gateway re-checks session+grant on the upgrade, proxies
   to the tunnel with `x-atlas-origin-secret` + `x-atlas-user-id`.
5. Desktop server verifies the origin secret, binds the socket to a `ChatPanel` via `RemoteBridge`;
   full streaming chat + read-only dashboards flow. `Revoke` rotates `ORIGIN_SECRET` and drops all.

## Security model (extends the shipped default-deny posture)

- **TLS everywhere** (`wss://`, Cloudflare edge). Localhost `ws://` stays local-only.
- **SSO is the browser's identity** (`sid` + default-deny `checkToolAccess`) — no token in the
  browser, nothing to leak or copy.
- **Worker→desktop hop authenticated** by `ORIGIN_SECRET` (== the pairing-token slot); desktop
  refuses any upgrade without it. Rotatable via existing `Revoke`.
- **No inbound port**; `cloudflared` and the Worker are both outbound/edge.
- **Secrets never leave the desktop**; the tunnel/Worker forward opaque frames. (Optional later:
  end-to-end payload encryption so even the edge can't read chat — see Phase C.)
- **Tool-approval boundary stays on the desktop**, default-deny on disconnect, destructive tools
  re-confirm when remote.
- **Rate-limit + audit** at the gateway (and reuse the platform's observability); log
  `x-atlas-user-id` per session.

## Open decisions

- **Reach mechanism.** *Recommended for B:* Cloudflare Tunnel (mirrors MusicGen 1:1, one proven
  precedent, desktop keeps its WS server). *Alternative (cleaner, more code):* a **Durable Object
  relay** in the gateway Worker that the desktop dials **outbound** (WS hibernation) and the
  browser joins — no tunnel, no localhost exposure at all. Good Phase-C evolution if tunneling to
  a localhost port is unwanted.
- **Where the web frontend lives** — platform repo (served as gateway `ASSETS`) vs. built from
  AtlasMind's `src/web`. Leaning platform repo, to keep AtlasMind shippable to the Marketplace
  without JoelBondoux-specific hosts baked in.
- **Tier-1 delivery** — live RPC over the WS vs. HTTP `GET /api/cost|runs` proxy (MusicGen-style).
  HTTP is simpler and PC-offline-tolerant if paired with a snapshot cache.

## Task checklist (Phase B)

- [ ] `joelbondoux-platform`: add `atlasmind` tool to `packages/contract/src/tools.ts`
      (default-deny) + launcher tile.
- [ ] `joelbondoux-platform`: `atlas` gateway Worker — clone `music` gateway, set
      `TOOL_KEY="atlasmind"`, add the WebSocket-upgrade proxy branch, `wrangler.jsonc` route +
      `IDENTITY` binding + `ORIGIN_URL`, `wrangler secret put ORIGIN_SECRET`.
- [ ] Ops: `atlas-lab` Cloudflare Tunnel → `atlas-origin.joelbondoux.net` → `127.0.0.1:<port>`;
      Windows logon task (clone `install-music-lab-task.ps1`).
- [ ] **This repo:** `remote.mode` setting + gateway-auth path in `remoteControlServer.ts`
      (capture upgrade `request`, verify `x-atlas-origin-secret`, read `x-atlas-user-id`); stable
      port; `Enable Remote Control (Gateway)` command.
- [ ] Web frontend from `src/web` served as gateway `ASSETS`; same-origin `wss`; 401→login;
      Tier-1 dashboards.
- [ ] Verify: unauthenticated → login redirect; ungranted account → 403; granted → streaming chat
      + dashboards; disconnect → pending approvals deny; `Revoke` rotates secret and drops sessions.

## Obligations when built (per CLAUDE.md — AtlasMind side)

- MINOR feature (new UI + commands + config). Same-commit: `package.json` version bump +
  `CHANGELOG.md`, README version banner in sync.
- Docs in the same commit: `docs/remote-control.md`, `wiki/Remote-Control.md`, `README.md`
  (Extension Commands + Configuration), `package.json`, `docs/configuration.md`,
  `wiki/Configuration.md`, `wiki/Security.md`, `wiki/Tool-Execution.md`; if new source lands,
  `README.md` (Project Structure) + `docs/architecture.md` + `wiki/Architecture.md`.
- Ship on `develop`; `main` only via the protected release PR. Keep the gateway/tunnel/host names
  out of the public marketing repo (`joelbondoux.net`) per its CLAUDE.md public/private rule.
</content>

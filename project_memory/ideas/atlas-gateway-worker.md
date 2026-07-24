# Reference — `atlas` gateway Worker (for `joelbondoux-platform`, NOT the AtlasMind build)

Copy-ready draft of the Cloudflare Worker that fronts AtlasMind remote access at
`atlas.joelbondoux.net`, SSO-gated by the existing `login` service and proxied to the desktop
over a Cloudflare Tunnel. It is a clone of the proven MusicGen gateway
(`JoelBondoux-MusicGen/gateway`) with the **one delta AtlasMind needs: WebSocket-upgrade
proxying** (AtlasMind's remote protocol is WebSocket; the MusicGen gateway is HTTP-only).

> This file is a **reference for the other repo**. It is intentionally *not* placed in the
> AtlasMind source tree so it can't be picked up by the extension build/package. Move the two
> code blocks into `joelbondoux-platform` (e.g. a new `gateway-atlas/` beside the music gateway).
> See the full design in [remote-web-access.md](./remote-web-access.md).

## Prerequisites (platform side)

1. **Tool registry** — add an `atlasmind` entry to `packages/contract/src/tools.ts`
   (`key: "atlasmind"`, **default-deny**, launcher title + URL `https://atlas.joelbondoux.net`),
   granted to The User's account. `login`'s `checkToolAccess(userId, "atlasmind")` gates on it.
2. **Origin secret** — `wrangler secret put ORIGIN_SECRET` in this Worker; store the **same**
   value on the desktop (AtlasMind reuses its remote pairing-token `SecretStorage` slot as the
   origin secret). This authenticates the Worker→desktop hop, exactly like MusicGen's `ORIGIN_SECRET`.
3. **Tunnel** — a dedicated named tunnel `atlas-lab` with ingress
   `atlas-origin.joelbondoux.net → http://127.0.0.1:<AtlasMind remote.port>`. `cloudflared`
   upgrades WebSockets transparently for an `http://` service, so the WS reaches the desktop's
   localhost `RemoteControlServer`. Run it as a Windows logon task (clone
   `install-music-lab-task.ps1`).

## `wrangler.jsonc`

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "atlas",
  "main": "./src/index.ts",
  "compatibility_date": "2026-07-20",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "atlas.joelbondoux.net", "custom_domain": true }
  ],
  "assets": {
    "directory": "../public",          // the AtlasMind web SPA (from src/web assets)
    "binding": "ASSETS",
    "run_worker_first": true            // gate every request, including assets, for auth
  },
  "services": [
    { "binding": "IDENTITY", "service": "login" }
  ],
  "vars": {
    "ORIGIN_URL": "https://atlas-origin.joelbondoux.net"
  },
  "observability": {
    "enabled": true,
    "logs": { "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.1 }
  }
}
```

## `src/index.ts`

```ts
// atlas.joelbondoux.net — SSO-gated gateway for AtlasMind remote access.
// Clone of the MusicGen gateway with a WebSocket-upgrade proxy branch.
type IdentityUser = { id: number; email: string; role: string; status: string };
type ToolAccessDecision = { allowed: boolean; role: string | null };
type IdentityRpc = {
  verifySession(token: string): Promise<IdentityUser | null>;
  checkToolAccess(userId: number, toolKey: string): Promise<ToolAccessDecision>;
};
type AtlasEnv = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  IDENTITY: IdentityRpc;
  ORIGIN_URL: string;
  ORIGIN_SECRET: string;
};

const TOOL_KEY = "atlasmind";
const SESSION_COOKIE = "sid";
const LOGIN_ORIGIN = "https://login.joelbondoux.net";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // connect-src 'self' allows the same-origin wss://atlas.joelbondoux.net upgrade.
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
}

function sessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader || cookieHeader.length > 16_384) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 && value.length <= 512 ? value : null;
  }
  return null;
}

function json(status: number, body: Record<string, unknown>): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  applySecurityHeaders(headers);
  return Response.json(body, { status, headers });
}

function loginRedirect(request: Request): Response {
  const url = new URL("/login", LOGIN_ORIGIN);
  url.searchParams.set("return_to", request.url);
  const headers = new Headers({ location: url.toString(), "cache-control": "no-store" });
  applySecurityHeaders(headers);
  return new Response(null, { status: 302, headers });
}

function denied(): Response {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  applySecurityHeaders(headers);
  return new Response(
    '<!doctype html><title>Access denied</title><p>AtlasMind access has not been granted for this account.</p>' +
      '<p><a href="https://login.joelbondoux.net/apps">Return to your tools</a></p>',
    { status: 403, headers },
  );
}

async function authenticate(request: Request, env: AtlasEnv): Promise<IdentityUser | Response> {
  const token = sessionToken(request.headers.get("cookie"));
  if (!token) return loginRedirect(request);
  try {
    const user = await env.IDENTITY.verifySession(token);
    if (!user) return loginRedirect(request);
    const access = await env.IDENTITY.checkToolAccess(user.id, TOOL_KEY);
    return access.allowed ? user : denied();
  } catch (error) {
    console.error(JSON.stringify({ message: "identity unavailable", error: String(error) }));
    return json(503, { error: "Login service is temporarily unavailable." });
  }
}

// The AtlasMind delta: proxy the WebSocket upgrade to the desktop via the tunnel origin.
async function proxyWebSocket(request: Request, env: AtlasEnv, user: IdentityUser): Promise<Response> {
  if (!env.ORIGIN_SECRET) return json(503, { error: "AtlasMind origin is not configured." });
  const origin = new URL(env.ORIGIN_URL);
  const reqUrl = new URL(request.url);
  origin.pathname = reqUrl.pathname;
  origin.search = reqUrl.search;
  // Reuse the incoming request so Upgrade + Sec-WebSocket-* headers are preserved.
  const upstream = new Request(origin, request);
  upstream.headers.set("x-atlas-origin-secret", env.ORIGIN_SECRET);
  upstream.headers.set("x-atlas-user-id", String(user.id));
  // Workers returns the 101 with the paired webSocket for pass-through.
  return fetch(upstream);
}

export default {
  async fetch(request: Request, env: AtlasEnv): Promise<Response> {
    const identity = await authenticate(request, env);
    if (identity instanceof Response) return identity;   // 302 / 403 / 503

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return proxyWebSocket(request, env, identity);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json(405, { error: "Method not allowed" });
    }
    const asset = await env.ASSETS.fetch(request);      // serve the AtlasMind web SPA
    const headers = new Headers(asset.headers);
    applySecurityHeaders(headers);
    return new Response(request.method === "HEAD" ? null : asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<AtlasEnv>;
```

## Matching desktop side (AtlasMind repo — Phase B3, not yet built)

The desktop `RemoteControlServer` (`src/remote/remoteControlServer.ts`) must, in a new
`atlasmind.remote.mode = "gateway"`:

- capture the WS **upgrade request** in the `ws` `connection` handler (today it ignores it),
- verify `x-atlas-origin-secret` (timing-safe, against the pairing-token slot) instead of the
  in-band `auth` frame,
- read `x-atlas-user-id` into the audit log,
- keep binding `127.0.0.1` and keep every existing gate (workspace trust, redaction, tool
  approvals default-deny on disconnect).

The browser holds **no token** — the `sid` cookie is the identity and the gateway does the auth.

## Notes / gotchas

- **Same-origin wss** (`wss://atlas.joelbondoux.net`) is allowed by `connect-src 'self'`; a
  cross-origin socket would need an explicit `connect-src` entry.
- **Tier-1 read-only dashboards** can ride the existing WS `cost`/`runs` RPC. If you prefer
  MusicGen-style HTTP (`GET /api/cost|runs` proxied to the origin), add a tiny read-only HTTP
  endpoint to the desktop and an `API_ROUTES` allowlist here — optional.
- **No inbound port:** both `cloudflared` and the Worker are outbound/edge.
- **Revoke** = rotate `ORIGIN_SECRET` on both ends (AtlasMind's existing *Revoke Remote Access*
  rotates the desktop slot; re-run `wrangler secret put ORIGIN_SECRET` to match).
```

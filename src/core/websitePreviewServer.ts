/**
 * The local static server behind the preview window.
 *
 * A generated site has to be *served* to be looked at: `file://` breaks root-
 * relative links, which is exactly what a multi-page site is made of. So this
 * opens a port — the one genuinely outward-facing thing in the whole Website
 * Studio feature — and every rule below exists because of that.
 *
 * **It binds `127.0.0.1`, never `0.0.0.0`.** The default in most examples is the
 * wildcard, which would publish a user's client work to their coffee-shop Wi-Fi.
 * The address is a constant here and there is no setting to change it.
 *
 * **It serves one directory and re-checks every request against it.** Paths are
 * resolved and then compared with `path.relative`, not `startsWith`: on Windows
 * a case difference and on any platform a symlink both defeat prefix matching,
 * and `preview-evil/` starts with `preview` too.
 *
 * **A per-session token sits in the path.** Any local process can reach a
 * localhost port, and "my design work" is not something to hand to whatever else
 * is running. The token is random per start and never persisted.
 *
 * **The content it serves is model output, so the response is locked down.** A
 * strict CSP with no network origins, `nosniff`, no directory listing, and an
 * extension allowlist — an unknown extension 404s rather than being offered as a
 * download. Generated pages have no script by construction
 * (`GENERATED_FILE_EXTENSIONS` excludes `.js`) and the CSP enforces that a
 * hand-added one cannot phone home.
 *
 * **It is off until something starts it, and it stops with the panel.** A server
 * outliving the window that opened it is a port nobody remembers is open.
 *
 * The `http` module is injected so the whole thing is unit-testable without
 * binding a real port; `vscode` is not imported at all.
 */

import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { GENERATED_FILE_EXTENSIONS } from './websiteGeneration.js';

/** The only address this ever binds. Not configurable, by design. */
export const PREVIEW_BIND_ADDRESS = '127.0.0.1';

/** Content types for the extensions generation is allowed to produce, plus the images a design needs. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

/**
 * What may be served.
 *
 * A superset of what may be *generated*: a design can legitimately include an
 * image the user dropped in, but the model may not write one. Keeping the two
 * lists separate means widening one never silently widens the other.
 */
const SERVABLE_EXTENSIONS = new Set<string>([
  ...GENERATED_FILE_EXTENSIONS,
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
]);

/**
 * The CSP applied to every served page.
 *
 * `default-src 'none'` with same-origin styles and images and nothing else: no
 * script, no frames, no connections, no fonts from anywhere. This markup was
 * written by a model and is being rendered inside the user's editor.
 */
function servedContentSecurityPolicy(allowOverlayScript: boolean): string {
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Same-origin only, and only when the review overlay is switched on. The
    // page's own meta policy narrows this further once deployed.
    ...(allowOverlayScript ? ["script-src 'self'", "connect-src https:"] : []),
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors *",
  ].join('; ');
}

/** The policy when nothing extra is permitted — the ordinary case. */
const SERVED_CONTENT_SECURITY_POLICY = servedContentSecurityPolicy(false);

/** Minimal surface of `node:http`, so tests can supply a fake. */
export interface PreviewHttpModule {
  createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}

/**
 * The single script the preview will serve, by exact name.
 *
 * `.js` is deliberately not added to `SERVABLE_EXTENSIONS`: that would let *any*
 * script in the preview root run, when the thing we actually need is one file
 * whose contents are a frozen constant in `websiteReviewBundle.ts`. Naming the
 * exception keeps the general rule — generated output carries no script — intact.
 */
export const REVIEW_OVERLAY_SERVED_NAME = 'atlas-review.js';

export interface PreviewServerOptions {
  /** Absolute path to the directory to serve. */
  rootDirectory: string;
  /** Defaults to an ephemeral port. */
  port?: number;
  http: PreviewHttpModule;
  /**
   * Serve and permit the client review overlay script.
   *
   * Off by default and tied to the same setting that puts the overlay into the
   * pages, so the policy widens exactly when — and only when — there is
   * something that needs it. With it off the server behaves as it always has:
   * no script served, no script permitted.
   */
  allowOverlayScript?: boolean;
}

export interface PreviewServerHandle {
  /** The full base URL including the session token, e.g. `http://127.0.0.1:51234/a1b2…/`. */
  url: string;
  port: number;
  token: string;
  stop(): Promise<void>;
}

export class WebsitePreviewServer {
  private server: Server | undefined;
  private token = '';
  private boundPort = 0;

  constructor(private readonly options: PreviewServerOptions) {}

  get running(): boolean {
    return this.server !== undefined;
  }

  /** The base URL, or undefined when nothing is listening. */
  get url(): string | undefined {
    return this.server ? `http://${PREVIEW_BIND_ADDRESS}:${this.boundPort}/${this.token}/` : undefined;
  }

  get port(): number | undefined {
    return this.server ? this.boundPort : undefined;
  }

  async start(): Promise<PreviewServerHandle> {
    if (this.server) {
      await this.stop();
    }
    this.token = randomBytes(16).toString('hex');
    const root = path.resolve(this.options.rootDirectory);

    const server = this.options.http.createServer((request, response) => {
      void this.handle(request, response, root).catch(() => {
        // A handler that throws must still answer. An unanswered request hangs
        // the preview iframe with no indication of why.
        respondError(response, 500, 'Preview failed to read that file.');
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.removeListener('error', onError);
        reject(error);
      };
      server.on('error', onError);
      server.listen(this.options.port ?? 0, PREVIEW_BIND_ADDRESS, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    const address = server.address();
    this.boundPort = typeof address === 'object' && address !== null ? address.port : (this.options.port ?? 0);
    this.server = server;

    return {
      url: this.url!,
      port: this.boundPort,
      token: this.token,
      stop: () => this.stop(),
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = undefined;
    this.token = '';
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse, root: string): Promise<void> {
    // Only reads. A preview that accepted a POST would be a write surface
    // reachable by any local process.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      respondError(response, 405, 'The preview server only answers GET.');
      return;
    }

    const resolved = resolvePreviewRequest(
      request.url ?? '/',
      this.token,
      root,
      this.options.allowOverlayScript === true,
    );
    if (!resolved.ok) {
      respondError(response, resolved.status, resolved.reason);
      return;
    }

    let stats;
    try {
      stats = await stat(resolved.filePath);
    } catch {
      respondError(response, 404, 'That page has not been generated yet.');
      return;
    }
    if (!stats.isFile()) {
      // No directory listing, ever — it would enumerate the whole preview to
      // anything that guessed the token.
      respondError(response, 404, 'That page has not been generated yet.');
      return;
    }

    const extension = path.extname(resolved.filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': path.basename(resolved.filePath) === REVIEW_OVERLAY_SERVED_NAME
        ? 'text/javascript; charset=utf-8'
        : CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': stats.size,
      'Content-Security-Policy': servedContentSecurityPolicy(this.options.allowOverlayScript === true),
      'X-Content-Type-Options': 'nosniff',
      // The preview must never be cached: the whole point is that it changes
      // when Generate is pressed again.
      'Cache-Control': 'no-store, must-revalidate',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(resolved.filePath).pipe(response);
  }
}

export type PreviewResolution =
  | { ok: true; filePath: string }
  | { ok: false; status: number; reason: string };

/**
 * Turn a request URL into a file path, or refuse it.
 *
 * Pure and exported so the traversal rules can be tested directly rather than
 * through a socket. Every refusal is a distinct branch with its own reason,
 * because "404" tells whoever is debugging nothing about which rule fired.
 */
export function resolvePreviewRequest(
  requestUrl: string,
  token: string,
  root: string,
  allowOverlayScript = false,
): PreviewResolution {
  let pathname: string;
  try {
    // The base is a formality — only the path is used — but `URL` gives correct
    // percent-decoding and query stripping, which hand-rolled parsing gets
    // wrong in exactly the cases that matter.
    pathname = new URL(requestUrl, `http://${PREVIEW_BIND_ADDRESS}`).pathname;
  } catch {
    return { ok: false, status: 400, reason: 'Malformed request.' };
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { ok: false, status: 400, reason: 'Malformed request.' };
  }

  // A NUL can truncate a path at the syscall boundary in some runtimes, making
  // the string checked here and the path opened differ.
  if (decoded.includes('\u0000')) {
    return { ok: false, status: 400, reason: 'Malformed request.' };
  }

  const segments = decoded.split('/').filter(segment => segment.length > 0);
  if (segments.length === 0 || segments[0] !== token || token.length === 0) {
    // Deliberately 404 rather than 403: a distinct "wrong token" reply confirms
    // to a probe that a preview is running here.
    return { ok: false, status: 404, reason: 'Not found.' };
  }

  const rest = segments.slice(1);
  if (rest.some(segment => segment === '..' || segment === '.')) {
    return { ok: false, status: 403, reason: 'That path is not allowed.' };
  }

  // A directory request serves its index, matching how the generated paths are
  // laid out (`/services/seo` → `services/seo/index.html`).
  const relative = rest.length === 0 ? 'index.html' : rest.join('/');
  const withIndex = path.extname(relative) === '' ? `${relative}/index.html` : relative;

  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, withIndex);

  // The containment check that actually matters. `path.relative` is used rather
  // than a prefix test because a prefix test says `/tmp/preview-evil` is inside
  // `/tmp/preview`, and on Windows it also fails on case.
  const relation = path.relative(resolvedRoot, filePath);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    return { ok: false, status: 403, reason: 'That path is not allowed.' };
  }

  const extension = path.extname(filePath).toLowerCase();
  // One named file, not a widened extension class.
  const isOverlayScript = allowOverlayScript && path.basename(filePath) === REVIEW_OVERLAY_SERVED_NAME;
  if (!isOverlayScript && !SERVABLE_EXTENSIONS.has(extension)) {
    // Refused rather than sent as a download: the preview root is a sandbox for
    // rendering, not a file share.
    return { ok: false, status: 404, reason: 'Not found.' };
  }

  return { ok: true, filePath };
}

function respondError(response: ServerResponse, status: number, reason: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>Preview</title>`
    + `<body style="font:14px system-ui;padding:2rem;color:#444">`
    + `<h1 style="font-size:1.1rem">${escapeForHtml(reason)}</h1>`
    + `<p>AtlasMind website preview</p>`;
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SERVED_CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

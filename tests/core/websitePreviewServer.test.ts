import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as path from 'node:path';
import * as http from 'node:http';
import * as os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  PREVIEW_BIND_ADDRESS,
  resolvePreviewRequest,
  WebsitePreviewServer,
} from '../../src/core/websitePreviewServer.js';
import {
  UI_PREVIEW_MAX_SELECTION_BODY,
  UI_PREVIEW_RUNTIME_SCRIPT,
  type UiPreviewSelectionEvent,
} from '../../src/core/uiPreviewRuntime.js';

const ROOT = path.resolve('/tmp/atlas-preview');
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

function resolve(url: string, token = TOKEN, root = ROOT) {
  return resolvePreviewRequest(url, token, root);
}

/** Every path this can resolve to must sit inside the root. */
function isInsideRoot(filePath: string, root = ROOT): boolean {
  const relation = path.relative(path.resolve(root), filePath);
  return !relation.startsWith('..') && !path.isAbsolute(relation);
}

describe('websitePreviewServer', () => {
  it('binds the loopback address and nothing else', () => {
    // The common default is the wildcard, which would publish a user's client
    // work to whatever network they are on.
    expect(PREVIEW_BIND_ADDRESS).toBe('127.0.0.1');
  });

  describe('the session token', () => {
    it('serves a request carrying the token', () => {
      const result = resolve(`/${TOKEN}/index.html`);
      expect(result.ok).toBe(true);
    });

    it('refuses a request with the wrong token', () => {
      const result = resolve('/deadbeef/index.html');
      expect(result.ok).toBe(false);
      if (result.ok) { return; }
      // 404 rather than 403: a distinct "wrong token" reply would confirm to a
      // probe that a preview is running here.
      expect(result.status).toBe(404);
    });

    it('refuses a request with no token at all', () => {
      expect(resolve('/index.html').ok).toBe(false);
      expect(resolve('/').ok).toBe(false);
    });

    it('refuses everything when no token is set', () => {
      expect(resolve('/index.html', '').ok).toBe(false);
      expect(resolve('//index.html', '').ok).toBe(false);
    });
  });

  describe('path traversal', () => {
    it('refuses a literal parent-directory segment', () => {
      // Refused at the *token* gate rather than the traversal gate: `URL`
      // normalizes `..` out of the pathname before anything here sees it, so
      // `/TOKEN/../../etc/passwd` arrives as `/etc/passwd`, whose first segment
      // is not the token. Two independent reasons to say no, which is the point
      // — the assertion is on the refusal, not on which rule fired.
      const result = resolve(`/${TOKEN}/../../../etc/passwd`);
      expect(result.ok).toBe(false);
    });

    it('refuses traversal hidden behind an encoded slash', () => {
      // This is the case the explicit `..` check exists for. The URL parser
      // normalizes `..` and even `%2e%2e` away, but it does not decode `%2f`
      // into a separator — so the whole thing arrives as one path segment and is
      // only revealed as traversal after `decodeURIComponent`. Without the
      // check, this is the request that escapes.
      const result = resolve(`/${TOKEN}/%2e%2e%2f%2e%2e%2fetc%2fpasswd.html`);
      expect(result.ok).toBe(false);
      if (result.ok) { return; }
      expect(result.status).toBe(403);
    });

    it('refuses URL-encoded traversal', () => {
      // `%2e%2e%2f` survives a literal `..` check, so decoding happens first.
      expect(resolve(`/${TOKEN}/%2e%2e%2f%2e%2e%2fsecret.html`).ok).toBe(false);
      expect(resolve(`/${TOKEN}/%2E%2E/secret.html`).ok).toBe(false);
    });

    it('treats double-encoded traversal as a literal folder name, still inside the root', () => {
      // Decoding happens exactly once, so `%252e%252e` becomes the literal text
      // `%2e%2e` — a strange directory name, not a traversal. Containment is
      // what matters here, not refusal: the request resolves inside the root and
      // simply will not exist. Decoding twice would be the actual bug, because
      // then the *third* encoding would escape.
      const result = resolve(`/${TOKEN}/%252e%252e/secret.html`);
      if (result.ok) {
        expect(isInsideRoot(result.filePath)).toBe(true);
      }
    });

    it('refuses a NUL byte in the path', () => {
      // A NUL can truncate a path at the syscall boundary, making the string
      // checked here and the path opened differ.
      const result = resolve(`/${TOKEN}/index.html%00.txt`);
      expect(result.ok).toBe(false);
    });

    it('refuses a malformed URL rather than guessing', () => {
      expect(resolve(`/${TOKEN}/%ZZ.html`).ok).toBe(false);
    });

    it('does not treat a sibling directory with the same prefix as inside', () => {
      // `startsWith` would say /tmp/atlas-preview-evil is inside
      // /tmp/atlas-preview. `path.relative` does not.
      const result = resolve(`/${TOKEN}/../atlas-preview-evil/index.html`);
      expect(result.ok).toBe(false);
    });
  });

  describe('what may be served', () => {
    it('serves the design file types', () => {
      for (const file of ['index.html', 'assets/site.css', 'logo.svg', 'notes.txt', 'photo.png']) {
        expect(resolve(`/${TOKEN}/${file}`).ok).toBe(true);
      }
    });

    it('refuses anything else rather than offering it as a download', () => {
      // The preview root is a sandbox for rendering, not a file share.
      for (const file of ['secrets.env', 'run.sh', 'data.json', 'archive.zip']) {
        const result = resolve(`/${TOKEN}/${file}`);
        expect(result.ok).toBe(false);
        if (!result.ok) { expect(result.status).toBe(404); }
      }
    });

    it('does not widen static JavaScript serving for the live runtime endpoint', () => {
      // The server handles this exact path from a frozen constant before file
      // resolution. It must never turn into permission to read a .js file from
      // the preview root.
      expect(resolve(`/${TOKEN}/_atlas/runtime.js`).ok).toBe(false);
      expect(resolve(`/${TOKEN}/assets/runtime.js`).ok).toBe(false);
    });

    it('maps a directory request onto its index', () => {
      const result = resolve(`/${TOKEN}/services/seo`);
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.filePath.endsWith(path.join('services', 'seo', 'index.html'))).toBe(true);
    });

    it('maps the bare token path onto the site index', () => {
      const result = resolve(`/${TOKEN}/`);
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.filePath).toBe(path.join(ROOT, 'index.html'));
    });

    it('ignores a query string', () => {
      const result = resolve(`/${TOKEN}/index.html?t=12345`);
      expect(result.ok).toBe(true);
      if (!result.ok) { return; }
      expect(result.filePath).toBe(path.join(ROOT, 'index.html'));
    });
  });

  describe('properties', () => {
    it('never resolves outside the root, for any input', () => {
      fc.assert(fc.property(fc.string(), suffix => {
        const result = resolve(`/${TOKEN}/${suffix}`);
        return !result.ok || isInsideRoot(result.filePath);
      }), { numRuns: 500 });
    });

    it('never throws, for any input at all', () => {
      fc.assert(fc.property(fc.string(), fc.string(), (url, token) => {
        resolvePreviewRequest(url, token, ROOT);
        return true;
      }), { numRuns: 500 });
    });
  });
});

describe('websitePreviewServer live protocol', () => {
  it('serves only the exact token-scoped runtime and streams revision updates across reconnects', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'atlasmind-live-preview-'));
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>Preview</body></html>', 'utf8');
    const selections: UiPreviewSelectionEvent[] = [];
    const server = new WebsitePreviewServer({
      rootDirectory: root,
      http,
      allowLiveRuntime: true,
      initialRevision: 7,
      onSelection: event => {
        if (event.nodeId === 'missing-node') {
          return false;
        }
        selections.push(event);
        return true;
      },
    });
    const handle = await server.start();

    try {
      const page = await fetch(handle.url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'");

      const runtime = await fetch(`${handle.url}_atlas/runtime.js`);
      expect(runtime.status).toBe(200);
      expect(runtime.headers.get('content-type')).toContain('text/javascript');
      expect(await runtime.text()).toBe(UI_PREVIEW_RUNTIME_SCRIPT);

      const wrongToken = await fetch(`${handle.url.replace(handle.token, 'wrong-token')}_atlas/runtime.js`);
      expect(wrongToken.status).toBe(404);
      expect((await fetch(`${handle.url}assets/anything.js`)).status).toBe(404);
      expect((await fetch(`${handle.url}_atlas/events`, { method: 'POST' })).status).toBe(405);

      const firstController = new AbortController();
      const first = await fetch(`${handle.url}_atlas/events`, { signal: firstController.signal });
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('text/event-stream');
      const firstReader = first.body!.getReader();
      expect(await readStreamUntil(firstReader, 'data: {"revision":7}')).toContain('event: revision');

      const selectionUrl = `${handle.url}_atlas/selection`;
      const accepted = await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ revision: 7, screenId: 'home', nodeId: 'hero-1' }),
      });
      expect(accepted.status).toBe(204);
      expect(selections).toEqual([{ revision: 7, screenId: 'home', nodeId: 'hero-1' }]);
      expect(await readStreamUntil(firstReader, '"nodeId":"hero-1"')).toContain('event: selection');

      expect((await fetch(selectionUrl)).status).toBe(405);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      })).status).toBe(415);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/jsonx' },
        body: '{}',
      })).status).toBe(415);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 7, screenId: '../home', nodeId: 'hero-1' }),
      })).status).toBe(409);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 7, screenId: 'home', nodeId: 'hero-1', command: 'run' }),
      })).status).toBe(409);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 7, screenId: 'home', nodeId: 'missing-node' }),
      })).status).toBe(409);
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(UI_PREVIEW_MAX_SELECTION_BODY + 1),
      })).status).toBe(413);
      expect((await fetch(`${handle.url.replace(handle.token, 'wrong-token')}_atlas/selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 7, screenId: 'home', nodeId: 'hero-1' }),
      })).status).toBe(404);

      expect(server.publishRevision(8)).toBe(true);
      expect(await readStreamUntil(firstReader, 'data: {"revision":8}')).toContain('id: 8');
      expect((await fetch(selectionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: 7, screenId: 'home', nodeId: 'hero-1' }),
      })).status).toBe(409);
      firstController.abort();
      await firstReader.cancel().catch(() => undefined);

      const reconnectController = new AbortController();
      const reconnect = await fetch(`${handle.url}_atlas/events`, { signal: reconnectController.signal });
      const reconnectReader = reconnect.body!.getReader();
      expect(await readStreamUntil(reconnectReader, 'data: {"revision":8}')).toContain('id: 8');
      reconnectController.abort();
      await reconnectReader.cancel().catch(() => undefined);
    } finally {
      await handle.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let received = '';
  for (let index = 0; index < 8 && !received.includes(needle); index += 1) {
    const next = await readWithTimeout(reader);
    if (next.done) {
      break;
    }
    received += decoder.decode(next.value, { stream: true });
  }
  return received;
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for preview event.')), 2_000);
    void reader.read().then(
      result => {
        clearTimeout(timer);
        resolve(result);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

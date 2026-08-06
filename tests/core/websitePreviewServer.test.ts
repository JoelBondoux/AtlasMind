import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as path from 'node:path';
import {
  PREVIEW_BIND_ADDRESS,
  resolvePreviewRequest,
} from '../../src/core/websitePreviewServer.js';

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

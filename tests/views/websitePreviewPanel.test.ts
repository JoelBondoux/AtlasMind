import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  getWebsitePreviewHtml,
  isWebsitePreviewMessage,
  PREVIEW_WIDTHS,
} from '../../src/views/websitePreviewPanel.js';
import { getWebviewHtmlShell } from '../../src/views/webviewUtils.js';

const CSP_SOURCE = 'vscode-webview://test';

describe('websitePreviewPanel', () => {
  describe('the framing policy', () => {
    it('grants frame-src only to the loopback port it was given', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:51234/abc/', 51234);
      const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

      expect(csp).toContain('frame-src http://127.0.0.1:51234 http://localhost:51234');
      // Nothing else may be framed, and nothing may be fetched.
      expect(csp).toContain("default-src 'none'");
      expect(csp).not.toContain('frame-src *');
      expect(csp).not.toMatch(/connect-src/);
    });

    it('does not widen frame-src to every port', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:9/x/', 9);
      expect(html).not.toContain('127.0.0.1:*');
    });

    it('runs its own script under a nonce and uses no inline handlers', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:1234/t/', 1234);
      expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]+'/);
      expect(html).toMatch(/<script nonce="[A-Za-z0-9]+">/);
      expect(html).not.toMatch(/\son(click|load|error)=/i);
    });

    it('sandboxes the frame without allowing scripts', () => {
      // Generated pages have no JavaScript by construction, so withholding
      // allow-scripts costs nothing and closes the hand-added case.
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:1234/t/', 1234);
      const sandbox = html.match(/sandbox="([^"]*)"/)?.[1] ?? '';
      expect(sandbox).toContain('allow-same-origin');
      expect(sandbox).not.toContain('allow-scripts');
      expect(sandbox).not.toContain('allow-top-navigation');
      expect(sandbox).not.toContain('allow-popups');
      expect(sandbox).not.toContain('allow-forms');
    });

    it('sends no referrer to the framed document', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:1234/t/', 1234);
      expect(html).toContain('referrerpolicy="no-referrer"');
    });
  });

  /**
   * The reason this panel exists as its own document rather than using the
   * shared shell. If the shell ever grew a localhost `frame-src`, every panel in
   * AtlasMind would gain the ability to frame a local port — a permission none
   * of them asked for and none would be audited against.
   */
  describe('the shared shell is unaffected', () => {
    it('still forbids framing a local port from any other panel', () => {
      const shell = getWebviewHtmlShell({
        title: 'anything',
        bodyContent: '<p>x</p>',
        cspSource: CSP_SOURCE,
      });
      const csp = shell.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';

      expect(csp).toContain('frame-src');
      expect(csp).not.toContain('127.0.0.1');
      expect(csp).not.toContain('localhost');
      expect(csp).not.toContain('http:');
    });

    it('is not the shell this panel is built from', () => {
      const source = readFileSync(
        path.join(process.cwd(), 'src/views/websitePreviewPanel.ts'),
        'utf8',
      );
      // A future refactor "tidying" this onto the shared shell would either
      // break the preview or widen the shell. Both should be deliberate.
      expect(source).not.toMatch(/getWebviewHtmlShell\s*\(/);
    });
  });

  describe('the escape hatch', () => {
    it('escapes the URL it frames', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:80/a"onload="alert(1)/', 80);
      expect(html).not.toContain('onload="alert(1)');
      expect(html).toContain('&quot;');
    });

    it('busts the cache so Reload shows the newly generated files', () => {
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:1234/t/', 1234);
      expect(html).toMatch(/src="http:\/\/127\.0\.0\.1:1234\/t\/\?t=\d+"/);
    });

    it('opens the full canvas in VS Code rather than the operating-system browser', () => {
      const source = readFileSync(path.join(process.cwd(), 'src/views/websitePreviewPanel.ts'), 'utf8');
      expect(source).toContain("'simpleBrowser.api.open'");
      expect(source).not.toContain('vscode.env.openExternal');
    });
  });

  describe('messages', () => {
    it('accepts only the three it handles', () => {
      expect(isWebsitePreviewMessage({ type: 'reload' })).toBe(true);
      expect(isWebsitePreviewMessage({ type: 'stop' })).toBe(true);
      expect(isWebsitePreviewMessage({ type: 'openExternal' })).toBe(true);
    });

    it('refuses anything else, including a URL the webview picked', () => {
      // The panel holds the URL; the webview only asks. It must not be able to
      // name an address for the editor to open.
      expect(isWebsitePreviewMessage({ type: 'openExternal', url: 'https://evil.example' })).toBe(true);
      const html = getWebsitePreviewHtml(CSP_SOURCE, 'http://127.0.0.1:1/t/', 1);
      expect(html).not.toContain("postMessage({ type: 'openExternal', url");

      expect(isWebsitePreviewMessage({ type: 'navigate' })).toBe(false);
      expect(isWebsitePreviewMessage('reload')).toBe(false);
      expect(isWebsitePreviewMessage(null)).toBe(false);
      expect(isWebsitePreviewMessage([{ type: 'reload' }])).toBe(false);
    });
  });

  describe('width presets', () => {
    it('offers a fluid option plus three real device widths', () => {
      expect(PREVIEW_WIDTHS[0]?.width).toBeUndefined();
      const widths = PREVIEW_WIDTHS.map(option => option.width).filter(Boolean);
      expect(widths).toEqual([1280, 834, 390]);
    });
  });
});

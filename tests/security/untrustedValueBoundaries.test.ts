import { describe, expect, it, vi, afterEach } from 'vitest';

import { inferRecommendedMcpServerProvenance } from '../../src/constants';
import { reconcileDebtScan, renderDebtMarkdown, scanForDebtMarkers, type DebtRegister } from '../../src/core/debtRegister';
import { webviewNonce } from '../../src/views/webviewUtils';

/**
 * Four boundaries a static analyser found before a person did.
 *
 * Each of these was open on `develop`: a CSP nonce from `Math.random()`, a
 * markdown escaper that escaped the pipe but not the backslash, a trust badge
 * decided by substring, and a regex escape that replaced a dot with itself. None
 * of them fails a test that does not know to look — a nonce still renders, a
 * table still writes, a badge still shows — which is why each one gets an
 * assertion here rather than a comment saying it was fixed.
 */

const AT = '2026-09-08T12:00:00.000Z';
const EMPTY: DebtRegister = { version: 1, entries: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a CSP nonce does not come from Math.random', () => {
  it('still differs every call when Math.random is pinned', () => {
    // The strongest available statement about unpredictability: freeze the
    // insecure source and show the nonce is unaffected by it. A nonce built from
    // `Math.random()` is guessable from a few samples, and a guessable nonce is
    // the same as no nonce — it is the only thing between a panel's CSP and an
    // injected script running with the page's own privileges.
    vi.spyOn(Math, 'random').mockReturnValue(0.42);

    const nonces = new Set(Array.from({ length: 64 }, () => webviewNonce()));

    expect(nonces.size).toBe(64);
  });

  it('is 32 hex characters, so it is long enough to be worth guarding', () => {
    expect(webviewNonce()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('a markdown cell escapes the escape', () => {
  it('leaves no live pipe after a value that ends in a backslash', () => {
    // A value ending in a backslash used to turn the `\|` that followed into a
    // literal backslash plus a live pipe, splitting one cell into two and
    // shifting every column after it. Component labels are file paths, and a
    // trailing backslash is the ordinary case on Windows, not a hostile one.
    const scanned = scanForDebtMarkers([{ path: 'a.ts', content: '// TODO: x' }]);
    const register = reconcileDebtScan(EMPTY, scanned, ['a.ts'], AT).register;
    register.entries[0]!.componentLabel = 'C:\\work\\';

    const row = renderDebtMarkdown(register)
      .split('\n')
      .find(line => line.includes('C:'));

    expect(row, 'the entry should still be in the mirror').toBeDefined();
    // The label occupies exactly one cell: its backslash is escaped, so the
    // delimiter that follows is still a delimiter rather than data.
    expect(row).toContain('C:\\\\work\\\\');
  });
});

describe('an official badge is decided by host, not by substring', () => {
  const server = (installUrl: string, docsUrl = installUrl) => ({
    id: 'x', name: 'x', description: 'x', transport: 'stdio' as const,
    command: 'x', args: [], installUrl, docsUrl,
  } as unknown as Parameters<typeof inferRecommendedMcpServerProvenance>[0]);

  it('still recognises the real sources', () => {
    expect(inferRecommendedMcpServerProvenance(server('https://learn.microsoft.com/graph/mcp-server/get-started'))).toBe('official');
    expect(inferRecommendedMcpServerProvenance(server('https://github.com/github/github-mcp-server'))).toBe('official');
    expect(inferRecommendedMcpServerProvenance(server('https://www.npmjs.com/package/@azure/mcp'))).toBe('official');
    expect(inferRecommendedMcpServerProvenance(server('https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres'))).toBe('archived');
  });

  it('refuses a URL that merely contains an official host', () => {
    // Every one of these passed the old substring test. The badge sits beside a
    // server somebody is about to install, so a lookalike must not earn it.
    expect(inferRecommendedMcpServerProvenance(server('https://example.invalid/?ref=learn.microsoft.com'))).toBe('community');
    expect(inferRecommendedMcpServerProvenance(server('https://learn.microsoft.com.example.invalid/mcp'))).toBe('community');
    expect(inferRecommendedMcpServerProvenance(server('https://github.com/someone-else/github-mcp-server-fork'))).toBe('community');
    expect(inferRecommendedMcpServerProvenance(server('https://example.invalid/modelcontextprotocol.io'))).toBe('community');
  });

  it('reads an unparseable URL as community rather than as official', () => {
    // Community is the weaker claim, and the weaker claim is the safe direction
    // for a badge that says "this came from the people who make it".
    expect(inferRecommendedMcpServerProvenance(server('not a url'))).toBe('community');
  });
});

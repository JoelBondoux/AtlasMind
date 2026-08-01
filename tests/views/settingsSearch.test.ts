import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Searching the Settings panel for a setting by the name it has in VS Code.
 *
 * Reported as "the ACP setting was not found in the Settings UI", and it was two
 * separate faults wearing one symptom. The control genuinely was not on any
 * page — only in VS Code's own settings editor — and the search would not have
 * found it if it had been: the query was tested as **one substring** against a
 * list of keywords, so `acp: hide console windows` could never match a
 * `data-search` attribute written, correctly, as individual words.
 *
 * Both halves are pinned here because both fail silently. A missing keyword and
 * a mis-shaped matcher produce the same empty result, and the empty result reads
 * as "AtlasMind has no such setting".
 */

const root = process.cwd();
const source = readFileSync(path.join(root, 'src/views/settingsPanel.ts'), 'utf8');

/** The panel's rule, restated: every word must appear somewhere in the entry. */
const terms = (query: string) => query.trim().toLowerCase().split(/[^a-z0-9.+#-]+/).filter(Boolean);
const matches = (haystack: string, query: string) =>
  terms(query).every(term => haystack.toLowerCase().includes(term));

/** Nav entries as `label + keywords`, which is what the panel searches. */
const searchablePages = (() => {
  const pages = new Map<string, string>();
  for (const match of source.matchAll(/data-page-target="([a-z-]+)"[^>]*data-search="([^"]*)"[^>]*>([^<]*)</g)) {
    pages.set(match[1]!, `${match[3]} ${match[2]}`);
  }
  return pages;
})();

describe('the Settings search finds a setting by the name VS Code gives it', () => {
  it('extracted the nav, so an empty result below means something', () => {
    expect(searchablePages.size).toBeGreaterThan(8);
  });

  it.each([
    { query: 'acp: hide console windows', page: 'safety' },
    { query: 'hide console windows', page: 'safety' },
    { query: 'private desktop', page: 'safety' },
    // The other multi-word queries that used to fail for the same reason.
    { query: 'acp tools', page: 'safety' },
    { query: 'local endpoints ollama', page: 'models' },
    { query: 'mission loop cost cap', page: 'loop' },
  ])('$query → $page', ({ query, page }) => {
    const haystack = searchablePages.get(page);
    expect(haystack, `no ${page} page found`).toBeDefined();
    expect(matches(haystack!, query)).toBe(true);
  });

  it('still narrows — a query matching nothing matches nothing', () => {
    const hits = [...searchablePages.values()].filter(haystack => matches(haystack, 'kubernetes ingress'));
    expect(hits).toEqual([]);
  });

  it('matches every word rather than the whole phrase as one string', () => {
    // The regression: `includes(normalized)` tested the raw query against the
    // keyword list, so any query whose words were not contiguous found nothing.
    expect(source).toContain('terms.every(term => haystack.includes(term))');
    expect(source).not.toContain('haystack.includes(normalized)');
  });
});

describe('the ACP console-window choice is on a page, not only in VS Code settings', () => {
  it('renders a control bound to the setting', () => {
    expect(source).toContain('id="acpHideConsoleWindows"');
    expect(source).toContain("type: 'setAcpHideConsoleWindows'");
    expect(source).toContain("case 'setAcpHideConsoleWindows'");
  });

  it('writes the machine-level choice globally, as the guided picker does', () => {
    const handler = /case 'setAcpHideConsoleWindows':([\s\S]*?)return;/.exec(source)?.[1] ?? '';
    expect(handler, 'handler not found').not.toBe('');
    expect(handler).toContain('ConfigurationTarget.Global');
  });

  it('states the Windows-only scope rather than showing a checkbox that does nothing', () => {
    expect(source).toContain("process.platform === 'win32'");
    expect(source).toMatch(/Windows-only|Windows only/);
  });

  it('keeps the endpoint-security disclosure with the control that needs it', () => {
    // The setting's own description carries this warning. A checkbox that
    // silently enables a technique EDR hunts for would be the worse half of it.
    const card = /id="acpConsoleWindowsCard"([\s\S]*?)<\/article>/.exec(source)?.[1] ?? '';
    expect(card, 'card not found').not.toBe('');
    expect(card).toMatch(/hVNC|endpoint security|Defender/);
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseMultiplierTable,
  parseTokenPriceTable,
  normalizeModelKey,
  resolveMultiplier,
  isSyncStale,
  type MultiplierSyncResult,
  MULTIPLIER_CACHE_STALE_MS,
} from '../../src/providers/copilotMultiplierSync.js';

describe('parseMultiplierTable', () => {
  it('parses HTML table rows', () => {
    const html = `
      <table>
        <tr><th>Model</th><th>Paid Plans</th><th>Free Tier</th></tr>
        <tr><td>Claude Opus 4.7</td><td>7.5</td><td>N/A</td></tr>
        <tr><td>Claude Sonnet 4.6</td><td>1</td><td>N/A</td></tr>
        <tr><td>GPT-4o</td><td>0</td><td>1</td></tr>
        <tr><td>o4-mini</td><td>0.33</td><td>N/A</td></tr>
      </table>`;
    const result = parseMultiplierTable(html);
    expect(result['claude opus 4.7']).toBe(7.5);
    expect(result['claude sonnet 4.6']).toBe(1);
    expect(result['gpt-4o']).toBe(0);
    expect(result['o4-mini']).toBe(0.33);
  });

  it('parses markdown pipe table rows', () => {
    const md = `
| Model | Paid Plans | Free Tier |
|-------|-----------|-----------|
| Claude Opus 4.7 | 7.5 | N/A |
| Claude Haiku 4.5 | 0.33 | 1 |
| GPT-4.1 | 0 | 1 |`;
    const result = parseMultiplierTable(md);
    expect(result['claude opus 4.7']).toBe(7.5);
    expect(result['claude haiku 4.5']).toBe(0.33);
    expect(result['gpt-4.1']).toBe(0);
  });

  it('skips header and separator rows in markdown', () => {
    const md = `
| Model | Paid Plans |
|-------|-----------|
| Claude Sonnet 4 | 1 |`;
    const result = parseMultiplierTable(md);
    expect(Object.keys(result)).not.toContain('model');
    expect(Object.keys(result)).not.toContain('------');
    expect(result['claude sonnet 4']).toBe(1);
  });

  it('returns empty object when no table is found', () => {
    expect(parseMultiplierTable('<html><body>No table here.</body></html>')).toEqual({});
  });

  it('ignores N/A values', () => {
    const html = `
      <table>
        <tr><td>SomeModel</td><td>N/A</td><td>N/A</td></tr>
      </table>`;
    const result = parseMultiplierTable(html);
    expect(result['somemodel']).toBeUndefined();
  });
});

describe('parseTokenPriceTable', () => {
  // The layout GitHub publishes as of September 2026: extra columns that differ
  // per vendor, a second row per model for a long-context tier, and footnote
  // superscripts inside the model cell. Positional parsing read "GA" as the
  // input price and found nothing, which is how every sync came to fail.
  const html = `
    <table><thead><tr><th scope="col">Model</th><th scope="col">Release status</th><th scope="col">Category</th><th scope="col">Tier</th><th scope="col">Threshold (input tokens)</th><th scope="col">Input</th><th scope="col">Cached input</th><th scope="col">Cache write</th><th scope="col">Output</th></tr></thead>
    <tbody>
      <tr><td>GPT-5 mini</td><td>GA</td><td>Lightweight</td><td>Default</td><td>Not applicable</td><td>$0.25</td><td>$0.025</td><td>Not applicable</td><td>$2.00</td></tr>
      <tr><td>GPT-6 Sol</td><td>GA</td><td>Powerful</td><td>Default</td><td>Not applicable</td><td>$2.00</td><td>$0.20</td><td>$2.50</td><td>$10.00</td></tr>
      <tr><td>GPT-6 Sol</td><td>GA</td><td>Powerful</td><td>Long context</td><td>&gt; 272K</td><td>$4.00</td><td>$0.40</td><td>$5.00</td><td>$15.00</td></tr>
    </tbody></table>
    <table><thead><tr><th>Model</th><th>Release status</th><th>Category</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead>
    <tbody><tr><td>Gemini 3.8 Flash<sup><a href="#fn-1">1</a></sup></td><td>GA</td><td>Versatile</td><td>$0.75</td><td>$0.075</td><td>$3.75</td></tr></tbody></table>`;

  it('locates the Input and Output columns by header', () => {
    const result = parseTokenPriceTable(html);
    expect(result['gpt-5 mini']).toEqual({ inputPer1k: 0.25 / 1000, outputPer1k: 2 / 1000 });
  });

  it('keeps the default tier rather than the long-context surcharge', () => {
    expect(parseTokenPriceTable(html)['gpt-6 sol']).toEqual({ inputPer1k: 2 / 1000, outputPer1k: 10 / 1000 });
  });

  it('drops footnote markers from the model name', () => {
    const result = parseTokenPriceTable(html);
    expect(result['gemini 3.8 flash']).toEqual({ inputPer1k: 0.75 / 1000, outputPer1k: 3.75 / 1000 });
    expect(result['gemini 3.8 flash1']).toBeUndefined();
  });
});

describe('normalizeModelKey', () => {
  it('lower-cases and collapses spaces', () => {
    expect(normalizeModelKey('Claude Opus 4.7')).toBe('claude opus 4.7');
    expect(normalizeModelKey('  GPT-4o  ')).toBe('gpt-4o');
  });
});

describe('resolveMultiplier', () => {
  const sync: MultiplierSyncResult = {
    multipliers: {
      'claude opus 4.7': 7.5,
      'claude sonnet 4.6': 1,
      'gpt-4o': 0,
      'o4-mini': 0.33,
    },
    syncedAt: new Date().toISOString(),
    modelCount: 4,
  };

  it('matches exact normalised key', () => {
    expect(resolveMultiplier('copilot/claude-opus-4.7', sync)).toBe(7.5);
  });

  it('matches when key is substring of model ID', () => {
    expect(resolveMultiplier('copilot/gpt-4o', sync)).toBe(0);
  });

  it('matches with separator difference (dash vs space)', () => {
    expect(resolveMultiplier('copilot/o4-mini', sync)).toBe(0.33);
  });

  it('returns undefined for unrecognised model', () => {
    expect(resolveMultiplier('copilot/deepseek-r1', sync)).toBeUndefined();
  });

  it('returns undefined for empty sync', () => {
    const empty: MultiplierSyncResult = { multipliers: {}, syncedAt: new Date().toISOString(), modelCount: 0 };
    expect(resolveMultiplier('copilot/claude-opus-4.7', empty)).toBeUndefined();
  });
});

describe('isSyncStale', () => {
  it('returns false for a recent sync', () => {
    const fresh: MultiplierSyncResult = {
      multipliers: {},
      syncedAt: new Date().toISOString(),
      modelCount: 0,
    };
    expect(isSyncStale(fresh)).toBe(false);
  });

  it('returns true for a sync older than the cache TTL', () => {
    const oldDate = new Date(Date.now() - MULTIPLIER_CACHE_STALE_MS - 1000);
    const stale: MultiplierSyncResult = {
      multipliers: {},
      syncedAt: oldDate.toISOString(),
      modelCount: 0,
    };
    expect(isSyncStale(stale)).toBe(true);
  });
});

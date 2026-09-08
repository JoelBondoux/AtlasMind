import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncExchangeRates } from '../../src/core/currencyFormatter.ts';
import { shouldSyncDownloadableCatalogue } from '../../src/providers/localModelCatalogSync.ts';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * What AtlasMind does to the network merely because the editor started.
 *
 * The extension activates on `onStartupFinished`, so everything in `activate()`
 * runs on every VS Code launch on every machine. The rule this file enforces is
 * the plain one: **a third party is contacted when the user's own configuration
 * needs something from it**, and not otherwise.
 *
 * Driven through the real functions with `fetch` replaced, rather than by
 * scanning source for `fetch(`. A source scan would pass just as well against
 * a call that is made and thrown away.
 */

interface FakeMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Promise<void>;
}

function emptyGlobalState(): FakeMemento {
  const store = new Map<string, unknown>();
  return {
    get: <T,>(key: string) => store.get(key) as T | undefined,
    update: async (key: string, value: unknown) => { store.set(key, value); },
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(JSON.stringify({ rates: { EUR: 0.9 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('exchange rates are not fetched for a currency that needs no conversion', () => {
  it('makes no request at the default setting', async () => {
    // `atlasmind.displayCurrency` defaults to USD, costs are recorded in USD,
    // and `getExchangeRate('USD')` returns 1 without consulting the cache — so
    // every rate this used to fetch on a default installation was dead weight.
    // It still went out, on every startup, to a third party.
    const outcome = await syncExchangeRates(emptyGlobalState(), { displayCurrency: 'USD' });

    expect(outcome).toBe('not-needed');
    expect(fetchSpy, 'A default installation contacted open.er-api.com on startup.').not.toHaveBeenCalled();
  });

  it('resolves "auto" rather than treating it as a currency', async () => {
    // `auto` is a request to detect, not a currency. Upper-casing it to "AUTO"
    // would fail the USD check and fetch for every auto user, including the
    // ones whose locale is USD — the exact case the guard exists for.
    const outcome = await syncExchangeRates(emptyGlobalState(), { displayCurrency: 'auto' });

    // No configuration reader is wired in this context, so detection falls back
    // to USD and nothing should be fetched.
    expect(outcome).toBe('not-needed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does fetch when the user actually chose another currency', async () => {
    // A guard that refuses everything would pass the tests above and break the
    // feature. This is the other half.
    const outcome = await syncExchangeRates(emptyGlobalState(), { displayCurrency: 'EUR' });

    expect(outcome).toBe('fetched');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('open.er-api.com');
  });

  it('reports a failure instead of swallowing it', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'));

    const outcome = await syncExchangeRates(emptyGlobalState(), { displayCurrency: 'EUR' });

    expect(outcome).toBe('failed');
  });

  it('uses a fresh cache without going out again', async () => {
    const state = emptyGlobalState();
    await syncExchangeRates(state, { displayCurrency: 'EUR' });
    fetchSpy.mockClear();

    const outcome = await syncExchangeRates(state, { displayCurrency: 'EUR' });

    expect(outcome).toBe('cached');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the downloadable-model catalogue is only fetched when a runtime exists', () => {
  /**
   * The catalogue enumerates models the user could *download* from ollama.com
   * and huggingface.co. It used to run at every activation behind nothing but a
   * TTL, so a fresh installation with no local runtime contacted two third
   * parties on startup to build a list of things it had no way to run.
   *
   * The gate lives at the call site in `extension.ts`, which is not importable
   * here — so this asserts the fact the gate depends on, and the call-site
   * ordering is asserted by the source check below.
   */
  it.each([
    ['nothing probed yet', undefined],
    ['probed, nothing found', { reachableEndpoints: [] }],
  ])('declines when there is no runtime (%s)', (_label, localSync) => {
    // Absent evidence is treated as *no runtime*: the local probe is cheap and
    // always runs first, so "we did not look" and "there is nothing there" have
    // the same right answer, and the safe direction is not to reach out.
    expect(shouldSyncDownloadableCatalogue(localSync)).toBe(false);
  });

  it('agrees once a runtime answered', () => {
    expect(shouldSyncDownloadableCatalogue({ reachableEndpoints: ['http://localhost:11434'] })).toBe(true);
  });

  it('is the gate the call site actually uses', () => {
    // The rule is only worth testing if the one caller consults it. Asserted
    // against the source because `extension.ts` cannot be activated here.
    const source = readFileSync(path.join(REPO_ROOT, 'src', 'extension.ts'), 'utf8');
    const call = source.indexOf('await syncLocalModelCatalog(');
    const guard = source.indexOf('shouldSyncDownloadableCatalogue(');

    expect(call, 'The catalogue call site has moved or gone.').toBeGreaterThan(-1);
    expect(guard, 'The catalogue is fetched without consulting the gate.').toBeGreaterThan(-1);
    expect(guard, 'The gate must be consulted before the fetch, not after.').toBeLessThan(call);
  });
});

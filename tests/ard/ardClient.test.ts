import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArdClient,
  ArdError,
  normalizeEntry,
  rankEntriesByText,
  screenDiscoveryUrl,
  validateCatalog,
  validateSearchResponse,
} from '../../src/ard/ardClient.ts';
import type { ArdClientConfig } from '../../src/ard/ardClient.ts';
import type { ArdDiscoveryEndpoint } from '../../src/types.ts';

const config: ArdClientConfig = { timeoutMs: 5_000, maxResults: 10, federation: 'referrals', allowInsecureEndpoints: false };
const insecureConfig: ArdClientConfig = { ...config, allowInsecureEndpoints: true };

function makeResponse(body: unknown, init: { ok?: boolean; status?: number; contentLength?: number } = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: 'OK',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(init.contentLength ?? text.length) : null) },
    text: async () => text,
  } as unknown as Response;
}

const registryEndpoint: ArdDiscoveryEndpoint = {
  id: 'r1', name: 'Test Registry', url: 'https://registry.example.com/search', kind: 'registry', enabled: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('screenDiscoveryUrl', () => {
  it('accepts public HTTPS URLs', () => {
    expect(screenDiscoveryUrl('https://registry.example.com/search', false)).toBeUndefined();
  });

  it('rejects HTTP unless insecure is allowed', () => {
    expect(screenDiscoveryUrl('http://registry.example.com/search', false)).toMatch(/HTTPS/);
    expect(screenDiscoveryUrl('http://localhost:9010/api', true)).toBeUndefined();
  });

  it('rejects private / loopback / link-local hosts (SSRF guard)', () => {
    expect(screenDiscoveryUrl('https://localhost/search', false)).toMatch(/private/);
    expect(screenDiscoveryUrl('https://127.0.0.1/search', false)).toMatch(/private/);
    expect(screenDiscoveryUrl('https://10.0.0.5/search', false)).toMatch(/private/);
    expect(screenDiscoveryUrl('https://192.168.1.1/search', false)).toMatch(/private/);
    expect(screenDiscoveryUrl('https://169.254.169.254/latest', false)).toMatch(/private/);
    expect(screenDiscoveryUrl('https://metadata.google.internal/', false)).toMatch(/private/);
  });

  it('rejects malformed URLs', () => {
    expect(screenDiscoveryUrl('not a url', false)).toMatch(/Invalid/);
  });
});

describe('normalizeEntry', () => {
  const base = { identifier: 'urn:ai:example.com:travel:booking', displayName: 'Booking', type: 'application/mcp-server+json' };

  it('accepts a valid entry with a url reference', () => {
    const entry = normalizeEntry({ ...base, url: 'https://api.example.com/server.json' });
    expect(entry?.identifier).toBe(base.identifier);
    expect(entry?.url).toBe('https://api.example.com/server.json');
  });

  it('rejects identifiers that are not urn:ai URNs', () => {
    expect(normalizeEntry({ ...base, identifier: 'booking', url: 'https://x.example.com' })).toBeUndefined();
  });

  it('enforces the strict value-or-reference rule', () => {
    // Both url and data -> rejected.
    expect(normalizeEntry({ ...base, url: 'https://x.example.com', data: { a: 1 } })).toBeUndefined();
    // Neither url nor data -> rejected.
    expect(normalizeEntry({ ...base })).toBeUndefined();
    // Only data -> accepted.
    expect(normalizeEntry({ ...base, data: { command: 'npx' } })?.data).toEqual({ command: 'npx' });
  });
});

describe('validateCatalog', () => {
  it('parses a valid manifest and drops invalid entries', () => {
    const catalog = validateCatalog({
      specVersion: '1.0',
      host: { displayName: 'Example', identifier: 'did:web:example.com' },
      entries: [
        { identifier: 'urn:ai:example.com:a:one', displayName: 'One', type: 'application/mcp-server+json', url: 'https://a.example.com' },
        { identifier: 'bad-id', displayName: 'Two', type: 'application/mcp-server+json', url: 'https://b.example.com' },
      ],
    });
    expect(catalog.specVersion).toBe('1.0');
    expect(catalog.host?.displayName).toBe('Example');
    expect(catalog.entries).toHaveLength(1);
  });

  it('throws when specVersion is missing', () => {
    expect(() => validateCatalog({ entries: [] })).toThrow(ArdError);
  });

  it('throws when entries is not an array', () => {
    expect(() => validateCatalog({ specVersion: '1.0', entries: {} })).toThrow(ArdError);
  });
});

describe('validateSearchResponse', () => {
  it('parses results, clamps score, and keeps referrals', () => {
    const response = validateSearchResponse({
      results: [
        { identifier: 'urn:ai:example.com:t:book', displayName: 'Book', type: 'application/a2a-agent-card+json', score: 250 },
      ],
      referrals: [
        { identifier: 'urn:ai:other.com:registry:public', displayName: 'Other', type: 'application/ai-registry+json', url: 'https://other.com/search' },
      ],
    });
    expect(response.results[0]?.score).toBe(100);
    expect(response.referrals).toHaveLength(1);
  });

  it('throws when results is missing', () => {
    expect(() => validateSearchResponse({})).toThrow(ArdError);
  });
});

describe('rankEntriesByText', () => {
  it('ranks entries by token overlap and drops non-matches', () => {
    const entries = [
      { identifier: 'urn:ai:x:db:postgres', displayName: 'Postgres tool', type: 'application/ai-skill', data: {}, description: 'query a postgres database' },
      { identifier: 'urn:ai:x:img:gen', displayName: 'Image gen', type: 'application/ai-skill', data: {}, description: 'make pictures' },
    ];
    const ranked = rankEntriesByText(entries, 'postgres database');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.displayName).toBe('Postgres tool');
  });
});

describe('ArdClient.search (registry)', () => {
  it('issues POST /search and normalizes results', async () => {
    const fetchMock = vi.fn(async () => makeResponse({
      results: [
        { identifier: 'urn:ai:example.com:db:pg', displayName: 'PG', type: 'application/mcp-server+json', url: 'https://pg.example.com', score: 90 },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ArdClient(() => config);
    const results = await client.search(registryEndpoint, 'postgres');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceName).toBe('Test Registry');
    expect(results[0]?.score).toBe(90);
  });

  it('follows referrals up to the federation depth bound and dedupes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === registryEndpoint.url) {
        return makeResponse({
          results: [{ identifier: 'urn:ai:a.com:x:one', displayName: 'One', type: 'application/mcp-server+json', url: 'https://a.com/1', score: 50 }],
          referrals: [{ identifier: 'urn:ai:b.com:registry:public', displayName: 'B', type: 'application/ai-registry+json', url: 'https://b.com/search' }],
        });
      }
      // Referral registry returns a different result plus a self-referral (loop) — must be ignored.
      return makeResponse({
        results: [{ identifier: 'urn:ai:b.com:y:two', displayName: 'Two', type: 'application/mcp-server+json', url: 'https://b.com/2', score: 70 }],
        referrals: [{ identifier: 'urn:ai:a.com:registry:public', displayName: 'A', type: 'application/ai-registry+json', url: registryEndpoint.url }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ArdClient(() => config);
    const results = await client.search(registryEndpoint, 'anything');

    // One from the root + one from the referral; the loop back to the root is skipped.
    expect(results.map(r => r.identifier).sort()).toEqual(['urn:ai:a.com:x:one', 'urn:ai:b.com:y:two']);
    // Sorted by score desc.
    expect(results[0]?.identifier).toBe('urn:ai:b.com:y:two');
  });

  it('does not federate when federation is none', async () => {
    const fetchMock = vi.fn(async () => makeResponse({
      results: [{ identifier: 'urn:ai:a.com:x:one', displayName: 'One', type: 'application/mcp-server+json', url: 'https://a.com/1' }],
      referrals: [{ identifier: 'urn:ai:b.com:registry:public', displayName: 'B', type: 'application/ai-registry+json', url: 'https://b.com/search' }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new ArdClient(() => ({ ...config, federation: 'none' }));
    await client.search(registryEndpoint, 'anything', { federation: 'none' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an insecure registry URL unless allowed', async () => {
    const fetchMock = vi.fn(async () => makeResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const httpEndpoint: ArdDiscoveryEndpoint = { ...registryEndpoint, url: 'http://localhost:9010/api/search' };

    const blocked = new ArdClient(() => config);
    await expect(blocked.search(httpEndpoint, 'x')).rejects.toThrow(ArdError);
    expect(fetchMock).not.toHaveBeenCalled();

    const allowed = new ArdClient(() => insecureConfig);
    await expect(allowed.search({ ...httpEndpoint, insecure: true }, 'x')).resolves.toEqual([]);
  });

  it('rejects oversized responses via content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeResponse({ results: [] }, { contentLength: 99_999_999 })));
    const client = new ArdClient(() => config);
    await expect(client.search(registryEndpoint, 'x')).rejects.toThrow(/too large/);
  });
});

describe('ArdClient.searchEndpoints', () => {
  it('collects per-finder errors instead of throwing', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('good')) {
        return makeResponse({ results: [{ identifier: 'urn:ai:good.com:x:one', displayName: 'One', type: 'application/mcp-server+json', url: 'https://good.com/1', score: 10 }] });
      }
      return makeResponse('nope', { ok: false, status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ArdClient(() => config);
    const { results, errors } = await client.searchEndpoints(
      [
        { id: 'g', name: 'Good', url: 'https://good.com/search', kind: 'registry', enabled: true },
        { id: 'b', name: 'Bad', url: 'https://bad.com/search', kind: 'registry', enabled: true },
      ],
      'x',
    );
    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.endpoint).toBe('Bad');
  });
});

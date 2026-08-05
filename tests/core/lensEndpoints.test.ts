import { describe, expect, it } from 'vitest';

import {
  buildLensEndpointStarter,
  carriesCredentialValue,
  findLensEndpoint,
  isProtectedLensEndpoint,
  LENS_ENDPOINT_FILE,
  LENS_ENDPOINT_MAX_ENDPOINTS,
  normalizeEndpointUrl,
  normalizeLensEndpointFile,
} from '../../src/core/lensEndpoints';

function httpEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'orders-api',
    label: 'Orders API',
    kind: 'http-openapi',
    stage: 'staging',
    url: 'https://api.example.test/openapi.json',
    expectedContractIds: ['contract:order'],
    ...overrides,
  };
}

describe('normalizeLensEndpointFile', () => {
  it('accepts a well-formed document', () => {
    const result = normalizeLensEndpointFile({ version: 1, endpoints: [httpEndpoint()] });
    expect(result?.file.endpoints).toHaveLength(1);
    expect(result?.rejected).toEqual([]);
    expect(result?.file.endpoints[0]?.stage).toBe('staging');
  });

  it('refuses a document with an unexpected version', () => {
    expect(normalizeLensEndpointFile({ version: 2, endpoints: [] })).toBeUndefined();
    expect(normalizeLensEndpointFile({ endpoints: [] })).toBeUndefined();
    expect(normalizeLensEndpointFile(null)).toBeUndefined();
  });

  it('refuses a document with duplicate endpoint ids', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint(), httpEndpoint({ label: 'Second' })],
    });
    expect(result).toBeUndefined();
  });

  it('refuses the whole document when any endpoint carries a credential value', () => {
    // The load-bearing rule: this file is committed, so a document holding a
    // secret must not be half-accepted with the secret quietly dropped.
    for (const key of ['password', 'token', 'apiKey', 'connectionString', 'client_secret', 'Authorization']) {
      const result = normalizeLensEndpointFile({
        version: 1,
        endpoints: [httpEndpoint({ [key]: 'hunter2' })],
      });
      expect(result, `expected \`${key}\` to refuse the document`).toBeUndefined();
    }
  });

  it('allows secretRef, which names a key rather than holding a value', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint({ secretRef: 'atlasmind.lens.orders' })],
    });
    expect(result?.file.endpoints[0]?.secretRef).toBe('atlasmind.lens.orders');
  });

  it('does not let a secretRef lookalike smuggle a value through', () => {
    expect(carriesCredentialValue({ secretRefValue: 'x' })).toBe(true);
    expect(carriesCredentialValue({ secretRefs: 'x' })).toBe(true);
    expect(carriesCredentialValue({ secretRef: 'x' })).toBe(false);
  });

  it('rejects one malformed endpoint without discarding the others', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint(), httpEndpoint({ id: 'broken', url: 'not-a-url' })],
    });
    expect(result?.file.endpoints).toHaveLength(1);
    expect(result?.rejected).toHaveLength(1);
    expect(result?.rejected[0]?.index).toBe(1);
  });

  it('refuses a document over the published endpoint budget', () => {
    const endpoints = Array.from({ length: LENS_ENDPOINT_MAX_ENDPOINTS + 1 }, (_, index) =>
      httpEndpoint({ id: `endpoint-${index}` }));
    expect(normalizeLensEndpointFile({ version: 1, endpoints })).toBeUndefined();
  });
});

describe('stage defaulting', () => {
  it('treats an absent stage as unknown', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint({ stage: undefined })],
    });
    expect(result?.file.endpoints[0]?.stage).toBe('unknown');
  });

  it('treats an unrecognised stage as unknown rather than accepting it', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint({ stage: 'preprod' })],
    });
    expect(result?.file.endpoints[0]?.stage).toBe('unknown');
  });

  it('treats an unstated stage exactly as it treats production', () => {
    // Guessing downward would move the type-to-confirm off the one environment
    // it exists for, and an endpoint that omits its stage is the likeliest one
    // somebody added in a hurry.
    const unknown = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint({ stage: undefined })],
    })?.file.endpoints[0];
    const production = normalizeLensEndpointFile({
      version: 1,
      endpoints: [httpEndpoint({ stage: 'production' })],
    })?.file.endpoints[0];
    expect(isProtectedLensEndpoint(unknown!)).toBe(true);
    expect(isProtectedLensEndpoint(production!)).toBe(true);
  });

  it('does not protect the stages that are not production', () => {
    for (const stage of ['local', 'development', 'staging']) {
      const endpoint = normalizeLensEndpointFile({
        version: 1,
        endpoints: [httpEndpoint({ stage })],
      })?.file.endpoints[0];
      expect(isProtectedLensEndpoint(endpoint!)).toBe(false);
    }
  });
});

describe('normalizeEndpointUrl', () => {
  it('accepts https anywhere', () => {
    expect(normalizeEndpointUrl('https://api.example.test/openapi.json'))
      .toBe('https://api.example.test/openapi.json');
  });

  it('accepts http only on the loopback', () => {
    expect(normalizeEndpointUrl('http://localhost:3000/openapi.json'))
      .toBe('http://localhost:3000/openapi.json');
    expect(normalizeEndpointUrl('http://127.0.0.1:3000/openapi.json'))
      .toBe('http://127.0.0.1:3000/openapi.json');
  });

  it('refuses plaintext http off this machine, because a probe may carry a token', () => {
    const result = normalizeEndpointUrl('http://api.example.test/openapi.json');
    expect(result?.startsWith('!')).toBe(true);
    expect(result).toContain('loopback');
  });

  it('refuses credentials embedded in the URL', () => {
    const result = normalizeEndpointUrl('https://user:pass@api.example.test/openapi.json');
    expect(result?.startsWith('!')).toBe(true);
    expect(result).toContain('secretRef');
  });

  it('refuses a non-HTTP scheme', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.test/x', 'postgres://db/x']) {
      expect(normalizeEndpointUrl(url)?.startsWith('!')).toBe(true);
    }
  });

  it('refuses a relative URL', () => {
    expect(normalizeEndpointUrl('/openapi.json')?.startsWith('!')).toBe(true);
  });

  it('allows a private-range https host, which is the ordinary staging case', () => {
    expect(normalizeEndpointUrl('https://10.0.0.5/openapi.json')).toBe('https://10.0.0.5/openapi.json');
  });
});

describe('database endpoints', () => {
  it('requires an MCP server rather than a URL', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'orders-db',
        label: 'Orders database',
        kind: 'database',
        stage: 'staging',
        mcpServerId: 'postgres',
        expectedContractIds: [],
      }],
    });
    expect(result?.file.endpoints[0]?.mcpServerId).toBe('postgres');
    expect(result?.file.endpoints[0]?.url).toBeUndefined();
  });

  it('names the mistake when a database endpoint carries a URL', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'orders-db',
        label: 'Orders database',
        kind: 'database',
        stage: 'staging',
        mcpServerId: 'postgres',
        url: 'https://db.example.test',
        expectedContractIds: [],
      }],
    });
    expect(result?.file.endpoints).toHaveLength(0);
    expect(result?.rejected[0]?.reason).toContain('MCP server');
  });

  it('refuses a database endpoint with no MCP server', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'orders-db',
        label: 'Orders database',
        kind: 'database',
        stage: 'staging',
        expectedContractIds: [],
      }],
    });
    expect(result?.rejected[0]?.reason).toContain('mcpServerId');
  });
});

describe('the declaration file', () => {
  it('lives under .atlasmind so it is committed and reviewed', () => {
    expect(LENS_ENDPOINT_FILE).toBe('.atlasmind/lens-endpoints.json');
  });

  it('produces a semantics-free starter that never invents a hostname', () => {
    const starter = buildLensEndpointStarter();
    expect(JSON.parse(starter)).toEqual({ version: 1, endpoints: [] });
    expect(starter).not.toMatch(/https?:/);
  });

  it('finds a declared endpoint by id and is total for an unknown one', () => {
    const file = normalizeLensEndpointFile({ version: 1, endpoints: [httpEndpoint()] })!.file;
    expect(findLensEndpoint(file, 'orders-api')?.label).toBe('Orders API');
    expect(findLensEndpoint(file, 'nope')).toBeUndefined();
  });
});

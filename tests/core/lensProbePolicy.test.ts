import { describe, expect, it } from 'vitest';

import {
  authorizeLensProbe,
  buildProbeRequest,
  findLensProbeRule,
  findMcpSchemaTool,
  GRAPHQL_INTROSPECTION_QUERY,
  LENS_PROBE_MAX_ENDPOINTS_PER_RUN,
  LENS_PROBE_RULES,
  resolveProbeTransport,
  type LensProbeSettings,
} from '../../src/core/lensProbePolicy';
import type { LensEndpointDeclaration } from '../../src/types';

const ALL_STAGES = ['local', 'development', 'staging', 'production', 'unknown'];

function settings(overrides: Partial<LensProbeSettings> = {}): LensProbeSettings {
  return {
    enabled: true,
    allowedStages: ALL_STAGES,
    fetchAvailable: true,
    mcpToolIds: [],
    ...overrides,
  };
}

function endpoint(overrides: Partial<LensEndpointDeclaration> = {}): LensEndpointDeclaration {
  return {
    id: 'orders-api',
    label: 'Orders API',
    kind: 'http-openapi',
    stage: 'staging',
    url: 'https://api.example.test/openapi.json',
    expectedContractIds: [],
    ...overrides,
  };
}

describe('deny by default', () => {
  it('refuses every probe when the feature is off', () => {
    const decision = authorizeLensProbe({ endpoint: endpoint(), settings: settings({ enabled: false }) });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe('feature-disabled');
    expect(decision.needsConfirmation).toBe(false);
  });

  it('reports the feature being off before asking for a confirmation', () => {
    // Root-cause first: being told to type a production endpoint's name when the
    // whole feature is switched off sends somebody to the wrong screen.
    const decision = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings({ enabled: false }),
    });
    expect(decision.rule).toBe('feature-disabled');
  });

  it('honours an empty allowedStages list as written', () => {
    const decision = authorizeLensProbe({ endpoint: endpoint(), settings: settings({ allowedStages: [] }) });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe('stage-blocked');
  });
});

describe('the protected-stage gate', () => {
  it('asks for a typed confirmation on a production endpoint', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe('protected-needs-confirmation');
    expect(decision.needsConfirmation).toBe(true);
    expect(decision.confirmPhrase).toBe('Orders API');
  });

  it('asks for the same confirmation when the stage was never stated', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint({ stage: 'unknown' }),
      settings: settings(),
    });
    expect(decision.rule).toBe('protected-needs-confirmation');
    expect(decision.reason).toContain('does not state its stage');
  });

  it('refuses an inexact confirmation', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
      typedConfirmation: 'orders api',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toBe('confirmation-mismatch');
  });

  it('permits the probe once the label is typed exactly', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
      typedConfirmation: 'Orders API',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.rule).toBe('permitted');
  });

  it('does not ask for a confirmation on an unprotected stage', () => {
    for (const stage of ['local', 'development', 'staging'] as const) {
      const decision = authorizeLensProbe({ endpoint: endpoint({ stage }), settings: settings() });
      expect(decision.allowed, stage).toBe(true);
      expect(decision.needsConfirmation, stage).toBe(false);
    }
  });

  it('separates "not asked yet" from "asked and refused"', () => {
    // The panel needs to know whether to prompt or to explain, and collapsing
    // the two would make it do one when it should do the other.
    const notAsked = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
    });
    const refused = authorizeLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
      typedConfirmation: '',
    });
    expect(notAsked.rule).toBe('protected-needs-confirmation');
    expect(refused.rule).toBe('confirmation-mismatch');
  });
});

describe('transport resolution', () => {
  it('reports no transport when fetch is unavailable', () => {
    const decision = authorizeLensProbe({ endpoint: endpoint(), settings: settings({ fetchAvailable: false }) });
    expect(decision.rule).toBe('no-transport');
  });

  it('matches a schema-reading MCP tool on the named server', () => {
    expect(findMcpSchemaTool(['mcp:postgres:list_tables'], 'postgres')).toBe('mcp:postgres:list_tables');
    expect(findMcpSchemaTool(['mcp:postgres:get_schema'], 'postgres')).toBe('mcp:postgres:get_schema');
    expect(findMcpSchemaTool(['mcp:postgres:describe_table'], 'postgres')).toBe('mcp:postgres:describe_table');
  });

  it('never matches a tool on a different server', () => {
    expect(findMcpSchemaTool(['mcp:mysql:list_tables'], 'postgres')).toBeUndefined();
  });

  it('never matches a generic query tool', () => {
    // A query tool could read information_schema, but AtlasMind would then be
    // composing SQL and handing it to a connected server — the one thing the
    // policy exists to make impossible.
    for (const tool of ['mcp:postgres:query', 'mcp:postgres:run_sql', 'mcp:postgres:execute']) {
      expect(findMcpSchemaTool([tool], 'postgres'), tool).toBeUndefined();
    }
  });

  it('never matches a tool carrying a write verb, even when it also says schema', () => {
    for (const tool of ['mcp:postgres:create_schema', 'mcp:postgres:drop_schema', 'mcp:postgres:alter_table_schema']) {
      expect(findMcpSchemaTool([tool], 'postgres'), tool).toBeUndefined();
    }
  });

  it('does not match a substring of a longer word', () => {
    expect(findMcpSchemaTool(['mcp:postgres:schematics'], 'postgres')).toBeUndefined();
  });

  it('refuses a database probe with no matching tool and says why', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint({ kind: 'database', url: undefined, mcpServerId: 'postgres' }),
      settings: settings({ mcpToolIds: ['mcp:postgres:query'] }),
    });
    expect(decision.rule).toBe('no-transport');
    expect(decision.reason).toContain('will not compose SQL');
  });

  it('reports transport separately from authorization', () => {
    const transport = resolveProbeTransport(
      endpoint({ kind: 'database', url: undefined, mcpServerId: 'mongo' }),
      settings({ mcpToolIds: ['mcp:mongo:list_collections'] }),
    );
    expect(transport.available).toBe(true);
    expect(transport.mcpToolId).toBe('mcp:mongo:list_collections');
  });
});

describe('the per-run budget', () => {
  it('refuses once the published maximum has been probed', () => {
    const decision = authorizeLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      probedThisRun: LENS_PROBE_MAX_ENDPOINTS_PER_RUN,
    });
    expect(decision.rule).toBe('budget-reached');
  });
});

describe('read-only by construction', () => {
  const permitted = { allowed: true as const, rule: 'permitted' as const, reason: '', needsConfirmation: false };

  it('only ever produces GET or the single fixed introspection POST', () => {
    const openapi = buildProbeRequest(endpoint(), permitted);
    expect(openapi.method).toBe('GET');
    expect(openapi.body).toBeUndefined();

    const graphql = buildProbeRequest(endpoint({ kind: 'graphql' }), permitted);
    expect(graphql.method).toBe('POST');
    expect(graphql.body).toBe(JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }));
  });

  it('sends an introspection query that cannot return a row', () => {
    // The one POST body AtlasMind ever sends to a third-party service. It asks
    // for names, kinds and nullability, and nothing that resolves to data.
    expect(GRAPHQL_INTROSPECTION_QUERY).toContain('__schema');
    expect(GRAPHQL_INTROSPECTION_QUERY).toMatch(/^query /);
    expect(GRAPHQL_INTROSPECTION_QUERY).not.toMatch(/\bmutation\b|\bsubscription\b/);
  });

  it('carries no write verb in any request it can produce', () => {
    const requests = [
      buildProbeRequest(endpoint(), permitted),
      buildProbeRequest(endpoint({ kind: 'graphql' }), permitted),
      buildProbeRequest(
        endpoint({ kind: 'database', url: undefined, mcpServerId: 'postgres' }),
        { ...permitted, mcpToolId: 'mcp:postgres:list_tables' },
      ),
    ];
    for (const request of requests) {
      expect(['GET', 'POST', undefined]).toContain(request.method);
      const serialized = JSON.stringify(request).toLowerCase();
      for (const verb of ['delete', 'drop table', 'insert into', 'update ', 'truncate', 'alter ']) {
        expect(serialized, `${verb} in ${serialized}`).not.toContain(verb);
      }
    }
  });

  it('sends no arguments at all to a database schema tool', () => {
    const request = buildProbeRequest(
      endpoint({ kind: 'database', url: undefined, mcpServerId: 'postgres' }),
      { ...permitted, mcpToolId: 'mcp:postgres:list_tables' },
    );
    expect(request.mcpArguments).toEqual({});
    expect(request.mcpToolId).toBe('mcp:postgres:list_tables');
  });

  it('refuses to compose a request for an unauthorized endpoint', () => {
    // A function that can be called out of order and quietly produces something
    // sendable is how a gate gets bypassed by a refactor.
    expect(() => buildProbeRequest(endpoint(), {
      allowed: false,
      rule: 'feature-disabled',
      reason: '',
      needsConfirmation: false,
    })).toThrow(/unauthorized/i);
  });

  it('refuses to compose a database request with no matched schema tool', () => {
    expect(() => buildProbeRequest(
      endpoint({ kind: 'database', url: undefined, mcpServerId: 'postgres' }),
      permitted,
    )).toThrow(/schema tool/i);
  });
});

describe('secret handling', () => {
  const permitted = { allowed: true as const, rule: 'permitted' as const, reason: '', needsConfirmation: false };

  it('puts a resolved secret in an Authorization header and nowhere else', () => {
    const request = buildProbeRequest(endpoint(), permitted, 'abc123');
    expect(request.headers?.Authorization).toBe('Bearer abc123');
    const withoutAuth = { ...request, headers: { ...request.headers, Authorization: undefined } };
    expect(JSON.stringify(withoutAuth)).not.toContain('abc123');
  });

  it('does not double-prefix a value that already says Bearer', () => {
    const request = buildProbeRequest(endpoint(), permitted, 'Bearer abc123');
    expect(request.headers?.Authorization).toBe('Bearer abc123');
  });

  it('sends no Authorization header when no secret was resolved', () => {
    const request = buildProbeRequest(endpoint(), permitted);
    expect(request.headers?.Authorization).toBeUndefined();
  });
});

describe('the rule table', () => {
  it('has a row for every rule the module can return', () => {
    const ids = new Set(LENS_PROBE_RULES.map(rule => rule.id));
    for (const id of [
      'feature-disabled', 'stage-blocked', 'protected-needs-confirmation', 'confirmation-mismatch',
      'no-transport', 'endpoint-invalid', 'budget-reached', 'permitted',
    ] as const) {
      expect(ids.has(id), id).toBe(true);
      expect(findLensProbeRule(id).id).toBe(id);
    }
  });

  it('publishes a description for each rule, so a verdict can be argued with', () => {
    for (const rule of LENS_PROBE_RULES) {
      expect(rule.description.length).toBeGreaterThan(20);
    }
  });
});

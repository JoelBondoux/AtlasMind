import { describe, expect, it } from 'vitest';

import { normalizeLensEndpointFile } from '../../src/core/lensEndpoints';
import {
  authorizeLensProbe,
  buildProbeRequest,
  dialectOfKind,
  isDirectSqlKind,
  resolveProbeTransport,
  type LensProbeSettings,
} from '../../src/core/lensProbePolicy';
import { safeDriverMessage } from '../../src/views/lensDatabaseTransport';
import type { LensEndpointDeclaration } from '../../src/types';

function settings(overrides: Partial<LensProbeSettings> = {}): LensProbeSettings {
  return {
    enabled: true,
    allowedStages: ['local', 'development', 'staging', 'production', 'unknown'],
    fetchAvailable: true,
    mcpToolIds: [],
    directDriversAvailable: true,
    ...overrides,
  };
}

function pg(overrides: Partial<LensEndpointDeclaration> = {}): LensEndpointDeclaration {
  return {
    id: 'orders-db',
    label: 'Orders database (staging)',
    kind: 'postgres',
    stage: 'staging',
    secretRef: 'orders-staging',
    expectedContractIds: [],
    ...overrides,
  };
}

const PERMITTED = { allowed: true as const, rule: 'permitted' as const, reason: '', needsConfirmation: false };

describe('declaring a direct database endpoint', () => {
  it('accepts a postgres endpoint that names a stored connection string', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'orders-db',
        label: 'Orders database',
        kind: 'postgres',
        stage: 'staging',
        secretRef: 'orders-staging',
      }],
    });
    expect(result?.file.endpoints[0]?.kind).toBe('postgres');
    expect(result?.file.endpoints[0]?.secretRef).toBe('orders-staging');
  });

  it('requires secretRef, because there is no such thing as a probe with nothing stored', () => {
    for (const kind of ['postgres', 'mysql'] as const) {
      const result = normalizeLensEndpointFile({
        version: 1,
        endpoints: [{ id: 'db', label: 'DB', kind, stage: 'staging' }],
      });
      expect(result?.rejected[0]?.reason, kind).toContain('secretRef');
    }
  });

  it('refuses a url on a direct endpoint and says why', () => {
    // A URL here would commit the host — and usually the credential — to the
    // repository, which is the whole thing the secretRef design prevents.
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'db', label: 'DB', kind: 'postgres', stage: 'staging',
        secretRef: 'x', url: 'postgres://user:pw@host/db',
      }],
    });
    expect(result?.file.endpoints).toHaveLength(0);
    expect(result?.rejected[0]?.reason).toContain('commit the host');
  });

  it('still refuses the whole document if a connection string is pasted in directly', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'db', label: 'DB', kind: 'postgres', stage: 'staging',
        connectionString: 'postgres://user:pw@host/db',
      }],
    });
    expect(result).toBeUndefined();
  });

  it('requires a declared vendor for sql-http rather than guessing from the URL', () => {
    // A wrong guess posts a Neon-shaped body to a D1 endpoint and reports the
    // resulting error as "unreachable".
    const missing = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'd1', label: 'D1', kind: 'sql-http', stage: 'staging',
        url: 'https://api.example.test/query', secretRef: 'd1',
      }],
    });
    expect(missing?.rejected[0]?.reason).toContain('vendor');

    const declared = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{
        id: 'neon', label: 'Neon', kind: 'sql-http', stage: 'staging', vendor: 'neon',
        url: 'https://ep.neon.tech/sql', secretRef: 'neon',
      }],
    });
    expect(declared?.file.endpoints[0]?.vendor).toBe('neon');
  });

  it('points somebody with a connection string away from the MCP kind', () => {
    const result = normalizeLensEndpointFile({
      version: 1,
      endpoints: [{ id: 'db', label: 'DB', kind: 'database', stage: 'staging' }],
    });
    expect(result?.rejected[0]?.reason).toContain('postgres');
  });
});

describe('authorizing a direct database probe', () => {
  it('permits a staging endpoint with a driver available', () => {
    const decision = authorizeLensProbe({ endpoint: pg(), settings: settings() });
    expect(decision.allowed).toBe(true);
  });

  it('still requires a typed confirmation on production', () => {
    const decision = authorizeLensProbe({
      endpoint: pg({ stage: 'production' }),
      settings: settings(),
    });
    expect(decision.rule).toBe('protected-needs-confirmation');
    expect(decision.confirmPhrase).toBe('Orders database (staging)');
  });

  it('treats an unstated stage as production for a database too', () => {
    const decision = authorizeLensProbe({ endpoint: pg({ stage: 'unknown' }), settings: settings() });
    expect(decision.needsConfirmation).toBe(true);
  });

  it('reports no transport when the host cannot open a socket', () => {
    const decision = authorizeLensProbe({
      endpoint: pg(),
      settings: settings({ directDriversAvailable: false }),
    });
    expect(decision.rule).toBe('no-transport');
    expect(decision.reason).toContain('desktop extension host');
  });

  it('refuses an endpoint with no stored credential named', () => {
    const decision = authorizeLensProbe({
      endpoint: { ...pg(), secretRef: undefined },
      settings: settings(),
    });
    expect(decision.rule).toBe('endpoint-invalid');
  });

  it('names the driver it would use', () => {
    const transport = resolveProbeTransport(pg(), settings());
    expect(transport.available).toBe(true);
    expect(transport.reason).toContain('postgres driver');
  });
});

describe('composing a direct database request', () => {
  it('carries the connection string and dialect, and no SQL', () => {
    // The statements are constants in lensDatabaseDialect, which the transport
    // reads directly. Passing them through the request would create a field
    // somebody could later set.
    const request = buildProbeRequest(pg(), PERMITTED, 'postgres://u:p@h/db');
    expect(request.dialect).toBe('postgres');
    expect(request.connectionString).toBe('postgres://u:p@h/db');
    expect(JSON.stringify(request)).not.toMatch(/select|information_schema/i);
  });

  it('refuses to compose a direct probe with no connection string', () => {
    // Composing one anyway produces something that looks sendable, connects to
    // nothing, and surfaces as "unreachable" — blaming the database.
    expect(() => buildProbeRequest(pg(), PERMITTED)).toThrow(/connection string/i);
  });

  it('refuses to compose an sql-http probe with no vendor or credential', () => {
    const endpoint = pg({ kind: 'sql-http', url: 'https://ep.neon.tech/sql', secretRef: 'x' });
    expect(() => buildProbeRequest(endpoint, PERMITTED, 'secret')).toThrow(/vendor/i);
  });

  it('maps kinds to dialects and identifies the direct ones', () => {
    expect(dialectOfKind('postgres')).toBe('postgres');
    expect(dialectOfKind('mysql')).toBe('mysql');
    expect(dialectOfKind('http-openapi')).toBeUndefined();
    expect(isDirectSqlKind('postgres')).toBe(true);
    expect(isDirectSqlKind('database')).toBe(false);
    expect(isDirectSqlKind('sql-http')).toBe(false);
  });
});

describe('driver errors never leak the connection', () => {
  it('scrubs a DSN out of a driver message', () => {
    // `pg` interpolates the connection target into several of its messages,
    // and output channels get pasted into issues.
    const message = safeDriverMessage(
      new Error('connection to postgres://app:hunter2@db.internal:5432/orders failed'),
    );
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('db.internal');
    expect(message).toContain('[connection details removed]');
  });

  it('scrubs a bare user:password@host fragment', () => {
    const message = safeDriverMessage(new Error('auth failed for app:hunter2@db.internal'));
    expect(message).not.toContain('hunter2');
  });

  it('keeps an ordinary message readable', () => {
    expect(safeDriverMessage(new Error('password authentication failed for user'))).toBe(
      'password authentication failed for user',
    );
  });

  it('is total for a non-Error', () => {
    expect(safeDriverMessage(undefined)).toBe('no detail was reported');
    expect(safeDriverMessage('a string')).toBe('no detail was reported');
  });
});

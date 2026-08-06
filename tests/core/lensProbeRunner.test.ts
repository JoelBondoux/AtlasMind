import { describe, expect, it, vi } from 'vitest';

import { normalizeLensContract } from '../../src/core/lensContract';
import type { LensProbeSettings } from '../../src/core/lensProbePolicy';
import {
  analyzeLensProbeRun,
  hasBeenProbed,
  runLensProbe,
  type LensProbeTransport,
  type LensProbeTransportResult,
} from '../../src/core/lensProbeRunner';
import type { LensEndpointDeclaration } from '../../src/types';

const NOW = () => new Date('2026-08-05T10:00:00.000Z');

function settings(overrides: Partial<LensProbeSettings> = {}): LensProbeSettings {
  return {
    enabled: true,
    allowedStages: ['local', 'development', 'staging', 'production', 'unknown'],
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

/** A transport that fails the test if anything reaches it. */
const forbiddenTransport: LensProbeTransport = () => {
  throw new Error('the transport must not be called for an unauthorized probe');
};

function okTransport(payload: unknown): LensProbeTransport {
  return () => Promise.resolve<LensProbeTransportResult>({ ok: true, status: 200, payload });
}

const OPENAPI = {
  openapi: '3.0.0',
  components: {
    schemas: {
      Order: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    },
  },
};

describe('an unauthorized probe never reaches the network', () => {
  it('does not call the transport when the feature is off', async () => {
    const transport = vi.fn(forbiddenTransport);
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings({ enabled: false }),
      transport,
      now: NOW,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(run.result.outcome).toBe('refused');
    expect(run.result.rule).toBe('feature-disabled');
  });

  it('does not call the transport for an unconfirmed production endpoint', async () => {
    const transport = vi.fn(forbiddenTransport);
    const run = await runLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
      transport,
      now: NOW,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(run.authorization.needsConfirmation).toBe(true);
  });

  it('does not call the transport when the typed confirmation is wrong', async () => {
    const transport = vi.fn(forbiddenTransport);
    await runLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings(),
      transport,
      typedConfirmation: 'orders api',
      now: NOW,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not call the transport for a blocked stage', async () => {
    const transport = vi.fn(forbiddenTransport);
    await runLensProbe({
      endpoint: endpoint({ stage: 'production' }),
      settings: settings({ allowedStages: ['local'] }),
      transport,
      typedConfirmation: 'Orders API',
      now: NOW,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not resolve a secret before authorization has passed', async () => {
    const resolveSecret = vi.fn(async () => 'never-read');
    await runLensProbe({
      endpoint: endpoint({ secretRef: 'orders-key' }),
      settings: settings({ enabled: false }),
      transport: vi.fn(forbiddenTransport),
      resolveSecret,
      now: NOW,
    });
    expect(resolveSecret).not.toHaveBeenCalled();
  });
});

describe('an authorized probe', () => {
  it('calls the transport and derives a served contract', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: okTransport(OPENAPI),
      now: NOW,
    });
    expect(run.result.outcome).toBe('reached');
    expect(run.result.contractCount).toBe(1);
    expect(run.served?.contracts[0]?.fields[0]?.path).toBe('id');
  });

  it('sends only a GET with no body for an OpenAPI endpoint', async () => {
    const transport = vi.fn(okTransport(OPENAPI));
    await runLensProbe({ endpoint: endpoint(), settings: settings(), transport, now: NOW });
    const request = transport.mock.calls[0]![0];
    expect(request.method).toBe('GET');
    expect(request.body).toBeUndefined();
  });

  it('resolves the secret only after authorization and puts it in a header', async () => {
    const resolveSecret = vi.fn(async () => 'token-value');
    const transport = vi.fn(okTransport(OPENAPI));
    await runLensProbe({
      endpoint: endpoint({ secretRef: 'orders-key' }),
      settings: settings(),
      transport,
      resolveSecret,
      now: NOW,
    });
    expect(resolveSecret).toHaveBeenCalledWith('orders-key');
    expect(transport.mock.calls[0]![0].headers?.Authorization).toBe('Bearer token-value');
  });

  it('never carries the secret into the recorded result', async () => {
    const run = await runLensProbe({
      endpoint: endpoint({ secretRef: 'orders-key' }),
      settings: settings(),
      transport: okTransport(OPENAPI),
      resolveSecret: async () => 'super-secret-token',
      now: NOW,
    });
    expect(JSON.stringify(run.result)).not.toContain('super-secret-token');
    expect(JSON.stringify(run.served)).not.toContain('super-secret-token');
  });

  it('reports a secret that will not resolve by name, never by value', async () => {
    const run = await runLensProbe({
      endpoint: endpoint({ secretRef: 'orders-key' }),
      settings: settings(),
      transport: vi.fn(forbiddenTransport),
      resolveSecret: async () => { throw new Error('locked keychain'); },
      now: NOW,
    });
    expect(run.result.outcome).toBe('refused');
    expect(run.result.reason).toContain('orders-key');
  });
});

describe('failures are recorded, never swallowed', () => {
  it('records a thrown transport error as unreachable', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: () => Promise.reject(new Error('ETIMEDOUT')),
      now: NOW,
    });
    expect(run.result.outcome).toBe('unreachable');
    expect(run.result.reason).toContain('ETIMEDOUT');
  });

  it('separates a 401 from nothing answering', async () => {
    // The service is up and declined us. Merging the two would send somebody to
    // check a host that is fine when the answer is a credential.
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: () => Promise.resolve({ ok: false, status: 401 }),
      now: NOW,
    });
    expect(run.result.outcome).toBe('unauthorized');
    expect(run.result.status).toBe(401);
  });

  it('never tries to derive a contract from an error response', async () => {
    // Deriving from a 500 body yields an empty schema, which drifts as "every
    // declared field is missing".
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: () => Promise.resolve({ ok: false, status: 500, payload: { error: 'boom' } }),
      now: NOW,
    });
    expect(run.result.outcome).toBe('unreachable');
    expect(run.served).toBeUndefined();
  });

  it('reports an unreadable success body without inventing an empty schema', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: okTransport({ message: 'hello from the API root' }),
      now: NOW,
    });
    expect(run.result.outcome).toBe('unreachable');
    expect(run.result.reason).toContain('schema document');
    expect(run.served).toBeUndefined();
  });
});

describe('hasBeenProbed', () => {
  it('counts only a run that actually read something', async () => {
    const reached = await runLensProbe({
      endpoint: endpoint(), settings: settings(), transport: okTransport(OPENAPI), now: NOW,
    });
    const failed = await runLensProbe({
      endpoint: endpoint(), settings: settings(), transport: () => Promise.reject(new Error('x')), now: NOW,
    });
    expect(hasBeenProbed(reached.result)).toBe(true);
    expect(hasBeenProbed(failed.result)).toBe(false);
    expect(hasBeenProbed(undefined)).toBe(false);
  });
});

describe('projecting a run into the lenses', () => {
  const declaredContract = normalizeLensContract({
    version: 1,
    id: 'contract:order',
    label: 'Order',
    layer: 'api',
    sourceKind: 'openapi',
    coverage: 'complete',
    fields: [{
      id: 'field:id',
      path: 'id',
      label: 'id',
      dataType: 'string',
      presence: 'required',
      nullability: 'non-null',
      evidence: { kind: 'declared', source: 'openapi.json' },
    }],
  })!;

  it('produces a drift report per declared contract', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(), settings: settings(), transport: okTransport(OPENAPI), now: NOW,
    });
    const analysis = analyzeLensProbeRun({
      run,
      endpoint: endpoint(),
      declaredContracts: [declaredContract],
    });
    expect(analysis.outcome).toBe('reached');
    expect(analysis.drift).toHaveLength(1);
    expect(analysis.drift[0]?.findings.every(finding => finding.kind === 'matched')).toBe(true);
  });

  it('reports a served schema no declared contract claimed', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings(),
      transport: okTransport({
        openapi: '3.0.0',
        components: {
          schemas: {
            Order: { type: 'object', properties: { id: { type: 'string' } } },
            Shadow: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      }),
      now: NOW,
    });
    const analysis = analyzeLensProbeRun({
      run,
      endpoint: endpoint(),
      declaredContracts: [declaredContract],
    });
    expect(analysis.unclaimedServedLabels).toEqual(['Shadow (live)']);
  });

  it('carries the outcome through when nothing was read', async () => {
    const run = await runLensProbe({
      endpoint: endpoint(),
      settings: settings({ enabled: false }),
      transport: vi.fn(forbiddenTransport),
      now: NOW,
    });
    const analysis = analyzeLensProbeRun({
      run,
      endpoint: endpoint(),
      declaredContracts: [declaredContract],
    });
    expect(analysis.outcome).toBe('refused');
    expect(analysis.drift[0]?.findings).toHaveLength(0);
    expect(analysis.drift[0]?.notices.join(' ')).toContain('not a healthy one');
  });
});

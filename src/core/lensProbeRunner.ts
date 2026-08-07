/**
 * One live probe, start to finish, with every dependency injected.
 *
 * The point of the injection is a single property that has to be *checkable*
 * rather than asserted in a comment: **an unauthorized probe never reaches the
 * network.** The authorization runs first, and when it refuses, this function
 * records the outcome and returns without touching the transport at all. A test
 * hands it a transport that fails the run if it is called, points it at a
 * production endpoint with no confirmation, and asserts nothing was sent. Without
 * that test the gate is a convention, and conventions do not survive a refactor
 * by somebody who has not read this file.
 *
 * Four further decisions.
 *
 * **A failure is recorded, never swallowed.** A timeout, a 500, or an
 * unparseable body each produce a `LensProbeResult` with the outcome and a
 * reason. `hasBeenProbed` deliberately counts only a `reached` run, so a failed
 * attempt stays visible while the endpoint still reads as never assessed — two
 * true facts, neither implying the other. (`researchRegister` keeps the same
 * pair.)
 *
 * **The secret is resolved at the last moment and never returned.** The runner
 * takes a resolver rather than a value, calls it only after authorization has
 * passed, hands the result straight to `buildProbeRequest`, and lets it go out
 * of scope. Nothing in `LensProbeResult` can hold it — there is no field — and
 * no error path interpolates a header into a message.
 *
 * **A non-2xx is `unauthorized` or `unreachable`, never a parse attempt.** A 401
 * body is an error page; deriving a contract from it would produce a served
 * schema of nothing and, through `lensLiveDrift`, a report that every declared
 * field is missing. The status is read before the body is looked at.
 *
 * **The response size is capped while reading, not after.** A cap checked after
 * `await response.text()` has already let an unbounded body into memory, which
 * on a misconfigured endpoint is the whole point of having one.
 *
 * `fs`-free, `vscode`-free, clock-injected ⇒ pure + unit-tested.
 */

import type {
  LensDatabaseHealth,
  LensDataTrustPolicyFile,
  LensEndpointDeclaration,
  LensLiveDriftReport,
  LensLiveTrustMap,
  LensProbeOutcome,
  LensProbeResult,
  LensServedContract,
  LensContract,
} from '../types.js';
import { analyzeLensLiveDrift, pairContract } from './lensLiveDrift.js';
import { analyzeLensLiveTrust } from './lensLiveTrust.js';
import {
  authorizeLensProbe,
  buildProbeRequest,
  type LensProbeAuthorization,
  type LensProbeRequest,
  type LensProbeSettings,
} from './lensProbePolicy.js';
import {
  deriveServedContractFromGraphql,
  deriveServedContractFromMcpSchema,
  deriveServedContractFromOpenApi,
} from './lensServedContract.js';

/** What a transport returns. Deliberately not a `Response` — no streams escape. */
export interface LensProbeTransportResult {
  readonly ok: boolean;
  readonly status?: number;
  /** The already-parsed JSON payload. `undefined` when the body was unreadable. */
  readonly payload?: unknown;
  /** Why the call failed, when it did. Never carries a header or a token. */
  readonly error?: string;
  readonly truncated?: boolean;
  /**
   * A served contract the transport derived itself.
   *
   * The direct database transports read several catalog queries over one
   * connection and shape them there, because reconnecting per query would
   * multiply the cost on a pooled or serverless database. When present, the
   * runner uses it instead of deriving from `payload` — the derivation has
   * already happened, at the same boundary and under the same rules.
   */
  readonly served?: LensServedContract;
  /** Metrics, latency and plan, when the transport measured them. */
  readonly health?: LensDatabaseHealth;
}

export type LensProbeTransport = (request: LensProbeRequest) => Promise<LensProbeTransportResult>;

export interface LensProbeRunInput {
  readonly endpoint: LensEndpointDeclaration;
  readonly settings: LensProbeSettings;
  readonly transport: LensProbeTransport;
  /** Resolves a SecretStorage key to its value. Called only after authorization. */
  readonly resolveSecret?: (secretRef: string) => Promise<string | undefined>;
  readonly typedConfirmation?: string;
  readonly probedThisRun?: number;
  readonly now: () => Date;
}

export interface LensProbeRun {
  readonly result: LensProbeResult;
  readonly authorization: LensProbeAuthorization;
  /** Absent whenever the probe did not complete or the response was unreadable. */
  readonly served?: LensServedContract;
  /** Metrics, latency and plan. Only the direct database transports measure these. */
  readonly health?: LensDatabaseHealth;
}

/**
 * Run one probe.
 *
 * Never throws for an expected condition — a refusal, a timeout, and a garbled
 * response are all outcomes rather than exceptions, because a surface showing
 * six endpoints must not lose five of them to the first one that is down.
 */
export async function runLensProbe(input: LensProbeRunInput): Promise<LensProbeRun> {
  const { endpoint } = input;
  const observedAt = input.now().toISOString();

  const authorization = authorizeLensProbe({
    endpoint,
    settings: input.settings,
    ...(input.typedConfirmation !== undefined ? { typedConfirmation: input.typedConfirmation } : {}),
    ...(input.probedThisRun !== undefined ? { probedThisRun: input.probedThisRun } : {}),
  });

  if (!authorization.allowed) {
    // Return before the transport exists in scope. Nothing was sent.
    return {
      authorization,
      result: {
        version: 1,
        endpointId: endpoint.id,
        outcome: 'refused',
        reason: authorization.reason,
        rule: authorization.rule,
        observedAt,
      },
    };
  }

  let secret: string | undefined;
  if (endpoint.secretRef && input.resolveSecret) {
    try {
      secret = await input.resolveSecret(endpoint.secretRef);
    } catch {
      // A secret that will not resolve is reported by name, never by value.
      return {
        authorization,
        result: {
          version: 1,
          endpointId: endpoint.id,
          outcome: 'refused',
          reason: `The stored secret \`${endpoint.secretRef}\` could not be read, so nothing was sent.`,
          rule: authorization.rule,
          observedAt,
        },
      };
    }
  }

  const request = buildProbeRequest(endpoint, authorization, secret);
  const startedAt = input.now().getTime();

  let transportResult: LensProbeTransportResult;
  try {
    transportResult = await input.transport(request);
  } catch (error) {
    return {
      authorization,
      result: {
        version: 1,
        endpointId: endpoint.id,
        outcome: 'unreachable',
        reason: `The probe did not complete: ${describeError(error)}`,
        latencyMs: input.now().getTime() - startedAt,
        observedAt,
      },
    };
  }

  const latencyMs = input.now().getTime() - startedAt;

  if (!transportResult.ok) {
    // A 401/403 is a different fact from "nothing answered": the service is up
    // and declined us. Merging them would send somebody to check a host that is
    // fine, when the answer is a credential.
    const status = transportResult.status;
    const unauthorized = status === 401 || status === 403;
    return {
      authorization,
      result: {
        version: 1,
        endpointId: endpoint.id,
        outcome: unauthorized ? 'unauthorized' : 'unreachable',
        reason: unauthorized
          ? `The service answered ${status}. The probe was turned away${endpoint.secretRef ? '' : ', and this endpoint declares no `secretRef`'}.`
          : transportResult.error ?? `The service answered ${status ?? 'nothing usable'}.`,
        latencyMs,
        ...(status !== undefined ? { status } : {}),
        observedAt,
      },
    };
  }

  // A transport that already derived its contracts is trusted to have done so —
  // it ran the same readers, at the same boundary. Re-deriving from `payload`
  // would mean the direct-database path needed a second, parallel derivation
  // that could disagree with the first.
  const served = transportResult.served ?? deriveServed(endpoint, transportResult.payload, observedAt);
  if (!served) {
    return {
      authorization,
      result: {
        version: 1,
        endpointId: endpoint.id,
        outcome: 'unreachable',
        reason: 'The service answered, but nothing in the response could be read as a schema. '
          + 'Check that the URL points at the schema document rather than at the API root.',
        latencyMs,
        ...(transportResult.status !== undefined ? { status: transportResult.status } : {}),
        observedAt,
      },
    };
  }

  return {
    authorization,
    served,
    ...(transportResult.health ? { health: transportResult.health } : {}),
    result: {
      version: 1,
      endpointId: endpoint.id,
      outcome: 'reached',
      reason: `Read ${served.contracts.length} schema${served.contracts.length === 1 ? '' : 's'} from the live service.`,
      latencyMs,
      ...(transportResult.status !== undefined ? { status: transportResult.status } : {}),
      contractCount: served.contracts.length,
      observedAt,
    },
  };
}

function deriveServed(
  endpoint: LensEndpointDeclaration,
  payload: unknown,
  observedAt: string,
): LensServedContract | undefined {
  switch (endpoint.kind) {
    case 'graphql':
      return deriveServedContractFromGraphql(endpoint.id, payload, observedAt);
    case 'database':
      return deriveServedContractFromMcpSchema(endpoint.id, payload, observedAt);
    case 'http-openapi':
      return deriveServedContractFromOpenApi(endpoint.id, payload, observedAt);
    case 'postgres':
    case 'mysql':
    case 'sql-http':
      // These transports derive their own contracts over a single connection and
      // return them on the transport result. Reaching here means one answered
      // `ok` without deriving anything, which is a bug in that transport rather
      // than a schema AtlasMind should try to reconstruct from a raw payload.
      return undefined;
  }
}

export interface LensLiveAnalysisInput {
  readonly run: LensProbeRun;
  readonly endpoint: LensEndpointDeclaration;
  /** The repository contracts this endpoint is expected to match. */
  readonly declaredContracts: readonly LensContract[];
  readonly trustPolicy?: LensDataTrustPolicyFile;
}

export interface LensLiveAnalysis {
  readonly outcome: LensProbeOutcome;
  readonly drift: LensLiveDriftReport[];
  readonly trust?: LensLiveTrustMap;
  /** Served schemas that no declared contract claimed. The other kind of gap. */
  readonly unclaimedServedLabels: string[];
}

/**
 * Project one completed run into the three lenses.
 *
 * Kept separate from {@link runLensProbe} so the analysis can be re-derived from
 * a stored run without probing again — and so a test can drive the analyses with
 * hand-written served contracts and no transport at all.
 */
export function analyzeLensProbeRun(input: LensLiveAnalysisInput): LensLiveAnalysis {
  const { run, endpoint } = input;
  const outcome = run.result.outcome;

  if (!run.served || outcome !== 'reached') {
    return {
      outcome,
      drift: input.declaredContracts.map(declared => analyzeLensLiveDrift({
        declared,
        served: {
          version: 1,
          endpointId: endpoint.id,
          contracts: [],
          observedAt: run.result.observedAt,
          notices: [],
          truncated: false,
        },
        outcome,
        outcomeReason: run.result.reason,
      })),
      ...(input.trustPolicy
        ? {
          trust: analyzeLensLiveTrust({
            served: {
              version: 1,
              endpointId: endpoint.id,
              contracts: [],
              observedAt: run.result.observedAt,
              notices: [],
              truncated: false,
            },
            policy: input.trustPolicy,
            outcome,
            expectedContractIds: endpoint.expectedContractIds,
            outcomeReason: run.result.reason,
          }),
        }
        : {}),
      unclaimedServedLabels: [],
    };
  }

  const served = run.served;
  const drift = input.declaredContracts.map(declared => analyzeLensLiveDrift({
    declared,
    served,
    outcome,
  }));

  // A served schema no declared contract paired with is the mirror image of a
  // dangling contract id: the service offers something the repository has not
  // described. Reported rather than dropped, because "we saw more than you
  // declared" is exactly the kind of thing a static lens can never say.
  const claimed = new Set<string>();
  for (const declared of input.declaredContracts) {
    const pairing = pairContract(declared, served.contracts);
    if (pairing.servedLabel) {
      claimed.add(pairing.servedLabel);
    }
  }
  const unclaimedServedLabels = served.contracts
    .filter(contract => !claimed.has(contract.label))
    .map(contract => contract.label);

  return {
    outcome,
    drift,
    ...(input.trustPolicy
      ? {
        trust: analyzeLensLiveTrust({
          served,
          policy: input.trustPolicy,
          outcome,
          expectedContractIds: endpoint.expectedContractIds,
        }),
      }
      : {}),
    unclaimedServedLabels,
  };
}

/**
 * Whether this endpoint has ever actually been read.
 *
 * Only a `reached` run counts. An attempt that timed out is a record of an
 * attempt, and treating it as an assessment would let a permanently broken
 * endpoint read as examined.
 */
export function hasBeenProbed(result: LensProbeResult | undefined): boolean {
  return result?.outcome === 'reached';
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    // Bounded and control-stripped: this reaches a webview and a modal.
    let stripped = '';
    for (let index = 0; index < error.message.length && stripped.length < 240; index += 1) {
      const code = error.message.charCodeAt(index);
      stripped += code <= 0x1f || code === 0x7f ? ' ' : error.message[index];
    }
    return stripped.replace(/\s+/g, ' ').trim() || 'no detail was reported';
  }
  return 'no detail was reported';
}

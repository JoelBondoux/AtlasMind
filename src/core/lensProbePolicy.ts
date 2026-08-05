/**
 * What a live probe is permitted to send, and to where — decided before it runs.
 *
 * This is the module the whole feature rests on. Every other Lens reads files
 * that are already on the machine; this one puts a request on the wire to a
 * system somebody else operates, possibly production, possibly carrying a
 * bearer token. So the authorization decision is separated from the code that
 * performs the call, made from data, and returned as a value that names the rule
 * it applied — which is what lets a test walk the policy instead of arguing
 * about it, and what stops the gate quietly becoming "whatever the runner felt
 * like doing".
 *
 * Five rules.
 *
 * **The shape is read, the rows never are.** {@link buildProbeRequest} composes
 * the entire request from constants in this file plus a destination from the
 * declaration file. There is no path a caller can take to send `SELECT * FROM
 * users`, because no function here accepts a query. The GraphQL introspection
 * document is a `const` for that reason: it is the one POST body AtlasMind ever
 * sends to a third-party service, and it must not be assemblable from anything
 * an operator, a webview, or a model supplied.
 *
 * **Read-only by construction, not by intention.** `GET` and `HEAD` for HTTP,
 * one fixed introspection `POST` for GraphQL, and for a database a *named*
 * schema-reading MCP tool. A test asserts no request this module can produce
 * carries a write verb, and that assertion is the guarantee — a comment saying
 * "we only read" stops nobody.
 *
 * **Deny by default, at two gates.** `atlasmind.lens.live.enabled` is off, and a
 * probe additionally needs the per-run confirmation. Neither implies the other:
 * switching the feature on and pointing it at production are two decisions, and
 * one switch carrying both would spend the second one without asking. (The rule
 * `researchSettings` keeps about its spend cap.)
 *
 * **A protected stage costs a type-to-confirm.** `production` — and `unknown`,
 * which is treated as production — requires the operator to type the endpoint's
 * own label, mirroring `promotionRunner`'s protected gate. A modal somebody can
 * dismiss by reflex is not a gate on the environment that cannot be re-run.
 *
 * **A refusal names its rule.** Every `denied` decision carries a
 * {@link LensProbeRuleId} and a sentence. A probe that simply does not happen is
 * indistinguishable from one that silently failed, and the second is how people
 * learn to stop trusting the surface.
 *
 * Pure: nothing here opens a socket, reads a setting, or shows a dialog. The
 * caller supplies the settings it read and performs the request it is handed.
 */

import type { LensEndpointDeclaration, LensEndpointKind } from '../types.js';
import { isProtectedLensEndpoint } from './lensEndpoints.js';

/** The declared rule that allowed or refused a probe. Published beside the verdict. */
export type LensProbeRuleId =
  | 'feature-disabled'
  | 'stage-blocked'
  | 'protected-needs-confirmation'
  | 'confirmation-mismatch'
  | 'no-transport'
  | 'endpoint-invalid'
  | 'budget-reached'
  | 'permitted';

export interface LensProbeRule {
  id: LensProbeRuleId;
  description: string;
}

/**
 * The rule table, published on the panel beside anything it decided.
 *
 * Declaration order is the order rules are evaluated, deliberately root-cause
 * first: being told "you must type the endpoint name to confirm" when the
 * feature is switched off entirely would send somebody to the wrong screen.
 */
export const LENS_PROBE_RULES: readonly LensProbeRule[] = [
  {
    id: 'feature-disabled',
    description: 'Live probing is off. `atlasmind.lens.live.enabled` is false, which is its default.',
  },
  {
    id: 'endpoint-invalid',
    description: 'The endpoint declaration is missing the destination its kind requires.',
  },
  {
    id: 'no-transport',
    description: 'Nothing available can reach this endpoint — no MCP schema tool for a database, or fetch is unavailable.',
  },
  {
    id: 'stage-blocked',
    description: 'The endpoint names a stage that `atlasmind.lens.live.allowedStages` excludes.',
  },
  {
    id: 'protected-needs-confirmation',
    description: 'A production or unstated-stage endpoint requires the operator to type its label before each run.',
  },
  {
    id: 'confirmation-mismatch',
    description: 'The typed confirmation did not match the endpoint label exactly.',
  },
  {
    id: 'budget-reached',
    description: 'This run already probed the published maximum number of endpoints.',
  },
  {
    id: 'permitted',
    description: 'The endpoint is reachable, in an allowed stage, and confirmed.',
  },
];

export const LENS_PROBE_MAX_ENDPOINTS_PER_RUN = 25;
export const LENS_PROBE_TIMEOUT_MS = 10_000;
export const LENS_PROBE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/**
 * The GraphQL introspection document.
 *
 * A constant, and the only POST body AtlasMind ever sends to a third-party
 * service. It requests names, kinds, and nullability — the shape — and nothing
 * that could return a row. `onOperation`/`onFragment`/`onField` are omitted
 * because older servers reject them, and `description` is omitted because a
 * schema description is prose somebody wrote and this lens compares shapes.
 */
export const GRAPHQL_INTROSPECTION_QUERY = `query AtlasMindLensIntrospection {
  __schema {
    queryType { name }
    types {
      name
      kind
      fields(includeDeprecated: true) {
        name
        type { kind name ofType { kind name ofType { kind name } } }
      }
    }
  }
}`;

/**
 * MCP tool-name verbs that read a database's *shape*.
 *
 * Matched against the tool-name segment of `mcp:<server>:<tool>`, never against
 * description prose — a server's tool names are stable, its descriptions are
 * marketing that changes between versions. (The rule `researchSources` keeps.)
 *
 * Deliberately excludes `query`, `execute`, `run`, and `sql`. A generic query
 * tool *could* read `information_schema`, but AtlasMind would then be composing
 * SQL and handing it to a connected server, which is the one thing this module
 * exists to make impossible. A project whose MCP server exposes only a generic
 * query tool gets `no-transport` and a sentence saying so — a smaller feature
 * than the alternative, and an honest one.
 */
const MCP_SCHEMA_VERBS = [
  'schema', 'describe', 'describe_table', 'list_tables', 'tables', 'columns',
  'list_collections', 'get_schema', 'table_schema', 'introspect', 'metadata',
] as const;

/** Verbs that would write or execute. Presence disqualifies a tool outright. */
const MCP_FORBIDDEN_VERBS = [
  'insert', 'update', 'delete', 'drop', 'create', 'alter', 'truncate',
  'write', 'exec', 'execute', 'run', 'mutate', 'upsert', 'grant', 'revoke',
] as const;

export interface LensProbeSettings {
  /** `atlasmind.lens.live.enabled` — deny by default. */
  readonly enabled: boolean;
  /**
   * `atlasmind.lens.live.allowedStages`. An empty array means *no stage*, which
   * is a different decision from the default and is honoured as written.
   */
  readonly allowedStages: readonly string[];
  /** Whether the built-in fetch transport is available in this host. */
  readonly fetchAvailable: boolean;
  /** Skill ids of connected MCP tools, in `mcp:<server>:<tool>` form. */
  readonly mcpToolIds: readonly string[];
}

export interface LensProbeAuthorizationInput {
  readonly endpoint: LensEndpointDeclaration;
  readonly settings: LensProbeSettings;
  /**
   * What the operator typed at the protected gate, when they have been asked.
   * `undefined` means they have not been asked yet — which yields
   * `protected-needs-confirmation`, a *request* for a dialog rather than a
   * refusal, and the two must not be collapsed or the panel cannot tell whether
   * to prompt or to explain.
   */
  readonly typedConfirmation?: string;
  /** How many endpoints this run has already probed. */
  readonly probedThisRun?: number;
}

export interface LensProbeAuthorization {
  readonly allowed: boolean;
  readonly rule: LensProbeRuleId;
  readonly reason: string;
  /** True when the caller should show a type-to-confirm dialog and ask again. */
  readonly needsConfirmation: boolean;
  /** The exact string the operator must type. Absent unless confirmation is needed. */
  readonly confirmPhrase?: string;
  /** The MCP tool a database probe would use, once one has been matched. */
  readonly mcpToolId?: string;
}

/**
 * Decide whether one probe may run.
 *
 * Root-cause first, so the reason a person is shown is the one they can act on.
 */
export function authorizeLensProbe(input: LensProbeAuthorizationInput): LensProbeAuthorization {
  const { endpoint, settings } = input;

  if (!settings.enabled) {
    return deny('feature-disabled',
      'Live probing is switched off. Turn on `atlasmind.lens.live.enabled` to let a lens reach a declared service.');
  }

  if (endpoint.kind === 'database') {
    if (!endpoint.mcpServerId) {
      return deny('endpoint-invalid', 'This database endpoint names no MCP server, so nothing can read its schema.');
    }
  } else if (!endpoint.url) {
    return deny('endpoint-invalid', 'This endpoint has no URL, so there is nowhere to send a request.');
  }

  const transport = resolveProbeTransport(endpoint, settings);
  if (!transport.available) {
    return deny('no-transport', transport.reason);
  }

  // An empty `allowedStages` means no stage is allowed. Honoured as written
  // rather than falling back to a default set: somebody who emptied the list
  // made a decision, and re-adding stages on their behalf would undo it.
  if (!settings.allowedStages.includes(endpoint.stage)) {
    return deny('stage-blocked',
      `This endpoint is declared as \`${endpoint.stage}\`, which \`atlasmind.lens.live.allowedStages\` does not include.`
      + (endpoint.stage === 'unknown'
        ? ' An endpoint that does not state its stage is treated as production.'
        : ''));
  }

  if ((input.probedThisRun ?? 0) >= LENS_PROBE_MAX_ENDPOINTS_PER_RUN) {
    return deny('budget-reached',
      `This run has already probed ${LENS_PROBE_MAX_ENDPOINTS_PER_RUN} endpoints, which is the published maximum.`);
  }

  if (isProtectedLensEndpoint(endpoint)) {
    if (input.typedConfirmation === undefined) {
      return {
        allowed: false,
        rule: 'protected-needs-confirmation',
        reason: endpoint.stage === 'unknown'
          ? `\`${endpoint.label}\` does not state its stage, so it is treated as production. `
            + 'Type its label to confirm this probe.'
          : `\`${endpoint.label}\` is a production endpoint. Type its label to confirm this probe.`,
        needsConfirmation: true,
        confirmPhrase: endpoint.label,
        ...(transport.mcpToolId ? { mcpToolId: transport.mcpToolId } : {}),
      };
    }
    if (input.typedConfirmation !== endpoint.label) {
      return {
        allowed: false,
        rule: 'confirmation-mismatch',
        reason: 'The typed confirmation did not match the endpoint label exactly, so nothing was sent.',
        needsConfirmation: true,
        confirmPhrase: endpoint.label,
      };
    }
  }

  return {
    allowed: true,
    rule: 'permitted',
    reason: `\`${endpoint.label}\` is reachable and in an allowed stage.`,
    needsConfirmation: false,
    ...(transport.mcpToolId ? { mcpToolId: transport.mcpToolId } : {}),
  };
}

export interface LensProbeTransport {
  readonly available: boolean;
  readonly reason: string;
  readonly mcpToolId?: string;
}

/**
 * Whether anything on this machine could reach this endpoint.
 *
 * Separate from authorization so a surface can say "you have no way to read this
 * database's schema" without the operator first switching a feature on and
 * confirming a production probe to find out. Absent transport is `no-source`
 * with a named setup step, never a clean empty result — `researchSources`' first
 * rule, applied to a different question.
 */
export function resolveProbeTransport(
  endpoint: LensEndpointDeclaration,
  settings: LensProbeSettings,
): LensProbeTransport {
  if (endpoint.kind === 'database') {
    const matched = findMcpSchemaTool(settings.mcpToolIds, endpoint.mcpServerId);
    return matched
      ? { available: true, reason: `Schema will be read through \`${matched}\`.`, mcpToolId: matched }
      : {
        available: false,
        reason: endpoint.mcpServerId
          ? `The MCP server \`${endpoint.mcpServerId}\` is not connected, or exposes no schema-reading tool. `
            + 'AtlasMind will not compose SQL for a generic query tool.'
          : 'This database endpoint names no MCP server.',
      };
  }
  return settings.fetchAvailable
    ? { available: true, reason: 'Reachable over the built-in fetch transport.' }
    : { available: false, reason: 'The built-in fetch transport is unavailable in this host.' };
}

/**
 * Find a schema-reading tool on the named server.
 *
 * A tool must match a schema verb **and** carry no forbidden verb — order
 * matters, because `create_schema` matches `schema` and would otherwise be
 * selected as a way to read one.
 */
export function findMcpSchemaTool(
  mcpToolIds: readonly string[],
  serverId: string | undefined,
): string | undefined {
  if (!serverId) {
    return undefined;
  }
  const prefix = `mcp:${serverId}:`;
  for (const skillId of mcpToolIds) {
    if (!skillId.startsWith(prefix)) {
      continue;
    }
    const toolName = skillId.slice(prefix.length).toLowerCase();
    if (toolName === '' || matchesVerb(toolName, MCP_FORBIDDEN_VERBS)) {
      continue;
    }
    if (matchesVerb(toolName, MCP_SCHEMA_VERBS)) {
      return skillId;
    }
  }
  return undefined;
}

/** Word-boundary-ish match, so `get_schema` matches and `schematic` does not. */
function matchesVerb(toolName: string, verbs: readonly string[]): boolean {
  return verbs.some(verb => new RegExp(`(^|[^a-z0-9])${verb}([^a-z0-9]|$)`).test(toolName));
}

export interface LensProbeRequest {
  readonly kind: LensEndpointKind;
  /** HTTP only. Always `GET` or the single fixed introspection `POST`. */
  readonly method?: 'GET' | 'POST';
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Present only for GraphQL introspection, and only ever the constant query. */
  readonly body?: string;
  /** Database only: the MCP tool to invoke and its schema-reading arguments. */
  readonly mcpToolId?: string;
  readonly mcpArguments?: Readonly<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

/**
 * Compose the request for an authorized probe.
 *
 * Every component except the destination is a constant in this module. The
 * `secret` parameter is the resolved SecretStorage *value*, supplied by the
 * caller at the last moment and never stored, logged, or returned — it goes
 * straight into an `Authorization` header on the returned request and nowhere
 * else.
 *
 * Throws on an unauthorized endpoint rather than returning a harmless-looking
 * request. A function that can be called out of order and quietly produces
 * something sendable is how a gate gets bypassed by a refactor.
 */
export function buildProbeRequest(
  endpoint: LensEndpointDeclaration,
  authorization: LensProbeAuthorization,
  secret?: string,
): LensProbeRequest {
  if (!authorization.allowed) {
    throw new Error('AtlasMind Lens refused to compose a probe request for an unauthorized endpoint.');
  }

  if (endpoint.kind === 'database') {
    if (!authorization.mcpToolId) {
      throw new Error('AtlasMind Lens refused to compose a database probe with no matched schema tool.');
    }
    return {
      kind: 'database',
      mcpToolId: authorization.mcpToolId,
      // No table name, no filter, no query. The tool is being asked what exists.
      mcpArguments: {},
      timeoutMs: LENS_PROBE_TIMEOUT_MS,
      maxResponseBytes: LENS_PROBE_MAX_RESPONSE_BYTES,
    };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'AtlasMind-Lens',
  };
  if (secret) {
    headers.Authorization = secret.toLowerCase().startsWith('bearer ') ? secret : `Bearer ${secret}`;
  }

  if (endpoint.kind === 'graphql') {
    return {
      kind: 'graphql',
      method: 'POST',
      url: endpoint.url,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: GRAPHQL_INTROSPECTION_QUERY }),
      timeoutMs: LENS_PROBE_TIMEOUT_MS,
      maxResponseBytes: LENS_PROBE_MAX_RESPONSE_BYTES,
    };
  }

  return {
    kind: 'http-openapi',
    method: 'GET',
    url: endpoint.url,
    headers,
    timeoutMs: LENS_PROBE_TIMEOUT_MS,
    maxResponseBytes: LENS_PROBE_MAX_RESPONSE_BYTES,
  };
}

export function findLensProbeRule(id: LensProbeRuleId): LensProbeRule {
  // Total by construction: the union and the table are kept in step, and the
  // fallback exists so a member added without a row fails a test rather than
  // throwing in front of somebody mid-probe.
  return LENS_PROBE_RULES.find(rule => rule.id === id) ?? LENS_PROBE_RULES[0];
}

function deny(rule: LensProbeRuleId, reason: string): LensProbeAuthorization {
  return { allowed: false, rule, reason, needsConfirmation: false };
}

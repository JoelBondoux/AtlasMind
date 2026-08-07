/**
 * The third-party services a lens is allowed to reach, declared in a committed file.
 *
 * Every other Lens reads the repository. This one reaches a database or an API
 * that somebody else operates, which makes *who decides what may be reached* the
 * first question rather than a detail. The answer here is: a file in the
 * repository, reviewed like any other change. Not a setting (a habit nobody
 * wrote down), not a webview message (the panel supplies ids, never
 * destinations), and never a model — a hallucinated hostname is a request sent
 * to a stranger in the user's name, with their bearer token attached.
 *
 * Four rules carry the semantics.
 *
 * **The file names a secret, never holds one.** `secretRef` is a SecretStorage
 * key. The normalizer refuses the whole document when an endpoint carries a
 * field that looks like a credential value, because this file is committed and
 * a schema that tolerates a password will eventually be handed one — the commit
 * that does it will look innocuous, and the secret will be in the history
 * forever. Refusing the document rather than dropping the field is deliberate:
 * a silently-cleaned file would keep the credential on disk while reporting
 * that everything was fine.
 *
 * **The file says where, never what to send.** There is no method, query, or
 * body field. What a probe transmits comes from a fixed allowlist in
 * {@link lensProbePolicy}, so the safety rule is not editable by the thing it
 * constrains. A `lens-endpoints.json` that could specify `DELETE /orders` would
 * be a remote-execution primitive wearing a diagnostics feature's clothes.
 *
 * **An unstated stage is production.** {@link LensEndpointStage} defaults to
 * `unknown`, and every gate treats `unknown` exactly as it treats `production`.
 * Guessing downward would move the confirmation off the one environment it
 * exists for, and the endpoint most likely to omit its stage is the one somebody
 * added in a hurry.
 *
 * **`http` only on the loopback.** A staging API on the office network is the
 * ordinary case and refusing it would make the feature unusable, so private
 * ranges are allowed — the destination came from a reviewed file, not from
 * attacker-controlled input, which is the distinction `ardClient`'s stricter
 * SSRF screen is drawing. But plaintext to anywhere but this machine would put a
 * bearer token on the wire, so that is refused by scheme.
 *
 * Pure: nothing here reads a file, opens a socket, or holds a key.
 */

import type {
  LensEndpointDeclaration,
  LensEndpointFile,
  LensEndpointKind,
  LensEndpointStage,
  LensSqlHttpVendor,
} from '../types.js';

export const LENS_ENDPOINT_FILE = '.atlasmind/lens-endpoints.json';
export const LENS_ENDPOINT_MAX_ENDPOINTS = 60;
export const LENS_ENDPOINT_MAX_EXPECTED_CONTRACTS = 40;

const KINDS = new Set<LensEndpointKind>([
  'http-openapi', 'graphql', 'database', 'postgres', 'mysql', 'sql-http',
]);
const STAGES = new Set<LensEndpointStage>(['local', 'development', 'staging', 'production', 'unknown']);
const SQL_HTTP_VENDORS = new Set<LensSqlHttpVendor>(['neon', 'cloudflare-d1', 'turso']);

/** Kinds reached by connecting directly with a stored connection string. */
const DIRECT_SQL_KINDS = new Set<LensEndpointKind>(['postgres', 'mysql']);

const MAX_ID = 200;
const MAX_LABEL = 200;
const MAX_URL = 2_000;
const MAX_SECRET_REF = 200;
const MAX_NOTE = 500;

/**
 * Property names that would carry a credential *value*.
 *
 * Presence of any of these on an endpoint refuses the document. The list is
 * matched case-insensitively against the raw keys, so `Password`, `apiKey` and
 * `connection_string` are all caught. It is short and blunt on purpose: this is
 * a tripwire for a file somebody is about to commit, not an exhaustive taxonomy
 * of secrets, and a false positive costs a rename while a false negative costs a
 * leaked production credential in git history.
 */
const CREDENTIAL_VALUE_KEYS = [
  'password', 'passwd', 'secret', 'token', 'apikey', 'api_key', 'accesskey', 'access_key',
  'connectionstring', 'connection_string', 'dsn', 'credential', 'credentials', 'auth',
  'bearer', 'privatekey', 'private_key', 'clientsecret', 'client_secret',
] as const;

/** Hosts where plaintext `http` is this machine talking to itself. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export interface LensEndpointRejection {
  /** Which endpoint, by index, so a malformed file can be pointed at. */
  index: number;
  reason: string;
}

/**
 * Normalize the committed endpoint declaration file.
 *
 * Returns `undefined` for a document that must not be partially trusted — a bad
 * `version`, a duplicate id, or a credential value anywhere in it. Individual
 * endpoints that are merely malformed are refused with a reason rather than
 * dropping the file, because one mistyped URL should not silently disable every
 * other endpoint somebody declared.
 */
export function normalizeLensEndpointFile(
  value: unknown,
): { file: LensEndpointFile; rejected: LensEndpointRejection[] } | undefined {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.endpoints) ||
    value.endpoints.length > LENS_ENDPOINT_MAX_ENDPOINTS
  ) {
    return undefined;
  }

  const endpoints: LensEndpointDeclaration[] = [];
  const rejected: LensEndpointRejection[] = [];
  const ids = new Set<string>();

  for (const [index, candidate] of value.endpoints.entries()) {
    // A credential value refuses the *document*, not just the endpoint. The
    // point is to stop the file being committed at all, and reporting one
    // endpoint as malformed while accepting the rest would read as a typo.
    if (isRecord(candidate) && carriesCredentialValue(candidate)) {
      return undefined;
    }
    const result = normalizeEndpoint(candidate);
    if (typeof result === 'string') {
      rejected.push({ index, reason: result });
      continue;
    }
    if (ids.has(result.id)) {
      return undefined;
    }
    ids.add(result.id);
    endpoints.push(result);
  }

  return { file: { version: 1, endpoints }, rejected };
}

/** True when any key on the endpoint object would hold a credential value. */
export function carriesCredentialValue(candidate: Record<string, unknown>): boolean {
  return Object.keys(candidate).some(key => {
    const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
    // `secretRef` names a key and is the sanctioned way to reference one, so it
    // is the single exemption — matched exactly, not by prefix, or `secretRefs`
    // and `secretRefValue` would both slip through.
    if (key === 'secretRef') {
      return false;
    }
    return CREDENTIAL_VALUE_KEYS.some(marker => normalized.includes(marker.replace(/_/g, '')));
  });
}

function normalizeEndpoint(value: unknown): LensEndpointDeclaration | string {
  if (!isRecord(value)) {
    return 'The endpoint is not an object.';
  }
  const id = boundedExactText(value.id, MAX_ID);
  const label = boundedText(value.label, MAX_LABEL);
  const kind = enumValue(value.kind, KINDS);
  if (!id) return 'The endpoint has no usable `id`.';
  if (!label) return 'The endpoint has no usable `label`.';
  if (!kind) return 'The endpoint `kind` must be `http-openapi`, `graphql`, or `database`.';

  // An absent or unrecognised stage is `unknown`, and every gate treats
  // `unknown` as production. This is the only defaulting in the module that
  // deliberately picks the *most* restrictive value.
  const stage = enumValue(value.stage, STAGES) ?? 'unknown';

  const expectedContractIds: string[] = [];
  if (value.expectedContractIds !== undefined) {
    if (!Array.isArray(value.expectedContractIds) ||
        value.expectedContractIds.length > LENS_ENDPOINT_MAX_EXPECTED_CONTRACTS) {
      return 'The endpoint `expectedContractIds` must be an array within the published budget.';
    }
    for (const contractId of value.expectedContractIds) {
      const normalized = boundedExactText(contractId, MAX_ID);
      if (!normalized) {
        return 'The endpoint declares an unusable contract id.';
      }
      if (!expectedContractIds.includes(normalized)) {
        expectedContractIds.push(normalized);
      }
    }
  }

  const secretRef = value.secretRef === undefined
    ? undefined
    : boundedExactText(value.secretRef, MAX_SECRET_REF);
  if (value.secretRef !== undefined && !secretRef) {
    return 'The endpoint `secretRef` must be a plain SecretStorage key name.';
  }

  const note = value.note === undefined ? undefined : boundedText(value.note, MAX_NOTE);
  if (value.note !== undefined && !note) {
    return 'The endpoint `note` is not usable text.';
  }

  const base: LensEndpointDeclaration = {
    id,
    label,
    kind,
    stage,
    expectedContractIds,
    ...(secretRef ? { secretRef } : {}),
    ...(note ? { note } : {}),
  };

  if (kind === 'database') {
    const mcpServerId = boundedExactText(value.mcpServerId, MAX_ID);
    if (!mcpServerId) {
      return 'A `database` endpoint must name the connected `mcpServerId` that can read its schema. '
        + 'For a direct connection instead, use `postgres`, `mysql`, or `sql-http`.';
    }
    if (value.url !== undefined) {
      // A URL on an MCP-backed endpoint is almost always a connection string
      // somebody expected to work. Refusing it names the mistake rather than
      // ignoring the field and leaving them to wonder why nothing connected.
      return 'A `database` endpoint is reached through its MCP server, not a URL. Remove `url` and set '
        + '`mcpServerId`, or change `kind` to `postgres`/`mysql` and put the connection string in '
        + 'SecretStorage under `secretRef`.';
    }
    return { ...base, mcpServerId };
  }

  if (DIRECT_SQL_KINDS.has(kind)) {
    // The connection string is the whole credential — host, user, password and
    // database in one value — so `secretRef` is mandatory here rather than
    // optional as it is for an HTTP endpoint. There is no such thing as a
    // direct database probe with nothing stored.
    if (!secretRef) {
      return `A \`${kind}\` endpoint needs \`secretRef\` naming the SecretStorage key that holds its `
        + 'connection string. The connection string itself must never appear in this file.';
    }
    if (value.url !== undefined) {
      return `A \`${kind}\` endpoint is reached with the stored connection string, not a \`url\`. `
        + 'Putting one here would commit the host — and usually the credential — to the repository.';
    }
    return base;
  }

  if (kind === 'sql-http') {
    const vendor = enumValue(value.vendor, SQL_HTTP_VENDORS);
    if (!vendor) {
      return 'An `sql-http` endpoint must name a supported `vendor`: `neon`, `cloudflare-d1`, or `turso`. '
        + 'Each speaks a different wire format, so AtlasMind will not guess which one a URL is.';
    }
    if (!secretRef) {
      return 'An `sql-http` endpoint needs `secretRef` naming the SecretStorage key that holds its token '
        + 'or connection string.';
    }
    const url = normalizeEndpointUrl(value.url);
    if (typeof url === 'string' && url.startsWith('!')) {
      return url.slice(1);
    }
    if (typeof url !== 'string') {
      return 'An `sql-http` endpoint needs a usable `url` for its vendor SQL API.';
    }
    return { ...base, url, vendor };
  }

  const url = normalizeEndpointUrl(value.url);
  if (typeof url === 'string' && url.startsWith('!')) {
    return url.slice(1);
  }
  if (typeof url !== 'string') {
    return 'The endpoint needs a usable `url`.';
  }
  return { ...base, url };
}

/**
 * Validate a probe destination.
 *
 * Returns the normalized URL, or a `!`-prefixed reason. Screens for the three
 * things that make a destination unsafe regardless of who declared it: a scheme
 * that is not HTTP, plaintext to anywhere but this machine, and credentials
 * embedded in the URL itself (which would be a secret in a committed file by
 * another route, and would leak into every log line that records the target).
 */
export function normalizeEndpointUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL) {
    return undefined;
  }
  if (hasControlCharacter(value) || /\s/.test(value)) {
    return '!The endpoint `url` contains whitespace or control characters.';
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '!The endpoint `url` is not an absolute URL.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `!The endpoint \`url\` must be http or https, not \`${parsed.protocol}\`.`;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return '!The endpoint `url` embeds credentials. Use `secretRef` to name a stored secret instead.';
  }
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return '!Plaintext `http` is only allowed on the loopback address, because a probe may carry a '
      + 'bearer token. Use `https` for anything off this machine.';
  }
  return parsed.toString();
}

/** Find one declared endpoint by id. Total: an unknown id is simply absent. */
export function findLensEndpoint(
  file: LensEndpointFile,
  endpointId: string,
): LensEndpointDeclaration | undefined {
  return file.endpoints.find(endpoint => endpoint.id === endpointId);
}

/**
 * Whether this endpoint's environment costs a type-to-confirm.
 *
 * The one place the `unknown === production` rule is written down, so five
 * surfaces cannot each decide it differently.
 */
export function isProtectedLensEndpoint(endpoint: LensEndpointDeclaration): boolean {
  return endpoint.stage === 'production' || endpoint.stage === 'unknown';
}

/** A valid, semantics-free starter. AtlasMind never invents a hostname. */
export function buildLensEndpointStarter(): string {
  return `${JSON.stringify({ version: 1, endpoints: [] }, null, 2)}\n`;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : undefined;
}

/**
 * Whether the text carries a C0 control character or DEL.
 *
 * A function rather than a shared regex literal because these values reach log
 * lines, webview HTML, and modal dialog copy, and a stray BEL or a
 * right-to-left override in a hostname is how a confirmation dialog gets made to
 * read as a different destination than the one it is about to probe.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function boundedExactText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !hasControlCharacter(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  let stripped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    stripped += code <= 0x1f || code === 0x7f ? ' ' : value[index];
  }
  const text = stripped.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maximum) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

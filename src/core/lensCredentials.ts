/**
 * Connection strings: where they live, and what may be said about them.
 *
 * A database probe needs a credential, and a credential is the one thing this
 * whole feature is built to keep out of the repository. So the rule is a single
 * sentence with no exceptions: **the connection string lives in SecretStorage
 * and nowhere else.** `.atlasmind/lens-endpoints.json` carries a `secretRef` —
 * a *name* — and the normalizer already refuses a document with a
 * credential-shaped key, so the committed file cannot hold one even by mistake.
 *
 * This module exists because the confirmation dialog has a genuine need that
 * looks a lot like a leak. Before probing production, an operator has to be
 * shown *where the request is going* — and that host is inside the connection
 * string. So the string is parsed here, once, and only ever yields
 * {@link LensConnectionSummary}: host, port, database name, whether TLS is on.
 * There is no field on that type that could hold the password, which is the
 * enforcement; a test asserts a summary of a DSN with a password contains no
 * substring of it.
 *
 * Four further decisions:
 *
 * **Parsing failures never echo the input.** A malformed DSN produces "the
 * stored connection string could not be parsed" and nothing else. The obvious,
 * helpful thing — quoting the bad value so somebody can see the typo — would
 * put a password into an error message, and error messages reach output
 * channels, and output channels get pasted into issues.
 *
 * **TLS is reported, never silently added.** A `sslmode=disable` connection to a
 * managed database is worth seeing rather than quietly upgrading, because the
 * user's own tooling is presumably using the same string and the honest answer
 * is that this connection is not encrypted.
 *
 * **A read-only role cannot be detected, so it is recommended loudly instead.**
 * There is no portable way to ask a connection what it is allowed to do without
 * attempting a write, and attempting a write to find out is a worse idea than
 * anything it would protect against. {@link READ_ONLY_ROLE_GUIDANCE} is shown
 * wherever a credential is stored, and the session-level read-only transaction
 * in `lensDatabaseDialect` is the belt to that missing braces.
 *
 * **The secret key namespace is fixed.** `secretRef` is prefixed before it
 * reaches SecretStorage, so a declaration file cannot name — and therefore
 * cannot read — a key belonging to a provider, to Buzz, or to anything else
 * AtlasMind stores. Without the prefix, `secretRef: "atlasmind.anthropic.apiKey"`
 * would be a committed file exfiltrating an API key into an HTTP header.
 *
 * Pure: no `vscode`, no I/O. It is handed a string and returns facts about it.
 */

import type { LensSqlDialect } from '../types.js';

/**
 * Prefix every `secretRef` is namespaced under.
 *
 * The load-bearing detail in this module. A declaration file names a key; if
 * that name reached SecretStorage unprefixed, a committed file could name
 * `atlasmind.anthropic.apiKey` and AtlasMind would obligingly put an Anthropic
 * key in an `Authorization` header pointed at a host the same file chose.
 */
export const LENS_SECRET_PREFIX = 'atlasmind.lens.endpoint.';

export const READ_ONLY_ROLE_GUIDANCE =
  'Use a read-only role. AtlasMind cannot verify what a credential is permitted to do — it sends only '
  + 'constant catalog queries inside a read-only transaction, but a least-privilege role is the control '
  + 'that does not depend on AtlasMind being correct.';

/** What may be said about a stored connection string. No field can hold a secret. */
export interface LensConnectionSummary {
  readonly host: string;
  readonly port?: number;
  readonly database?: string;
  /** The connecting user. A username is not a credential and identifies the role. */
  readonly user?: string;
  /** Whether the string asks for TLS. Reported as found, never silently changed. */
  readonly tls: 'required' | 'preferred' | 'disabled' | 'unstated';
  readonly dialect: LensSqlDialect;
}

/**
 * Turn a `secretRef` into the key SecretStorage is actually asked for.
 *
 * Refuses a ref that is not a plain identifier, so nothing can escape the
 * namespace by embedding a separator or a traversal-shaped segment.
 */
export function lensSecretKey(secretRef: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(secretRef) || secretRef.includes('..')) {
    return undefined;
  }
  return `${LENS_SECRET_PREFIX}${secretRef}`;
}

/**
 * Describe a connection string without repeating any of it that matters.
 *
 * Returns `undefined` for anything unparseable — deliberately with no detail,
 * since the only detail available is the string itself.
 */
export function summarizeConnectionString(
  value: string,
  expected: LensSqlDialect,
): LensConnectionSummary | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4_000) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  const dialect = dialectOfScheme(parsed.protocol);
  if (!dialect || dialect !== expected) {
    return undefined;
  }
  const host = parsed.hostname;
  if (!host) {
    return undefined;
  }

  const database = parsed.pathname.replace(/^\//, '');
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : undefined;

  return {
    host,
    ...(port !== undefined && Number.isFinite(port) ? { port } : {}),
    ...(database ? { database: database.slice(0, 120) } : {}),
    // The username, not the password. A role name is what makes "is this the
    // read-only user?" answerable at the confirmation dialog.
    ...(parsed.username ? { user: decodeURIComponent(parsed.username).slice(0, 120) } : {}),
    tls: readTlsMode(parsed),
    dialect,
  };
}

/** One line naming the destination, for a confirmation dialog. Never a secret. */
export function describeConnection(summary: LensConnectionSummary): string {
  const target = summary.port ? `${summary.host}:${summary.port}` : summary.host;
  const database = summary.database ? `/${summary.database}` : '';
  const user = summary.user ? ` as \`${summary.user}\`` : '';
  return `${target}${database}${user} (TLS ${summary.tls})`;
}

/**
 * Whether a stored value is plausibly a connection string for this dialect.
 *
 * Used when storing, so a mistyped or pasted-wrong credential fails at the point
 * somebody can still see what they pasted, rather than at probe time when the
 * only safe error message is a vague one.
 */
export function looksLikeConnectionString(value: string, dialect: LensSqlDialect): boolean {
  return summarizeConnectionString(value, dialect) !== undefined;
}

function dialectOfScheme(protocol: string): LensSqlDialect | undefined {
  switch (protocol) {
    case 'postgres:':
    case 'postgresql:':
      return 'postgres';
    case 'mysql:':
    case 'mariadb:':
      return 'mysql';
    default:
      return undefined;
  }
}

/**
 * Read the TLS intent out of the query string.
 *
 * Postgres spells it `sslmode`, MySQL spells it `ssl-mode` or `ssl`. Anything
 * unrecognised is `unstated` rather than assumed — reporting an unknown setting
 * as `required` would be the reassuring answer and the wrong one.
 */
function readTlsMode(url: URL): LensConnectionSummary['tls'] {
  const raw = (
    url.searchParams.get('sslmode')
    ?? url.searchParams.get('ssl-mode')
    ?? url.searchParams.get('ssl')
    ?? ''
  ).toLowerCase();

  if (['disable', 'disabled', 'false', '0', 'off'].includes(raw)) {
    return 'disabled';
  }
  if (['require', 'required', 'verify-ca', 'verify-full', 'verify_identity', 'true', '1', 'on'].includes(raw)) {
    return 'required';
  }
  if (['prefer', 'preferred', 'allow'].includes(raw)) {
    return 'preferred';
  }
  // Absent or unrecognised. Some managed hosts require TLS regardless of the
  // string, but AtlasMind does not know that from here — and guessing in the
  // reassuring direction is the one guess worth refusing.
  return 'unstated';
}

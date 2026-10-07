/**
 * ArdClient – Agentic Resource Discovery protocol client.
 *
 * ARD (https://github.com/ards-project/ard-spec) is a *discovery-only* protocol:
 * it locates agentic resources (MCP servers, A2A agents, Skills, APIs) before
 * invocation. This client implements the two discovery mechanisms:
 *
 *   1. Registry REST API — `POST /search` for ranked, federated discovery.
 *   2. Static manifest    — `GET /.well-known/ai-catalog.json`, searched locally.
 *
 * Security posture (AtlasMind is safety-first):
 *   - Every manifest / search response is treated as UNTRUSTED input: strict
 *     schema validation, byte + entry caps, `urn:ai:` identifier checks, and the
 *     spec's strict Value-or-Reference rule (exactly one of `url` / `data`).
 *   - Discovered and referral URLs must be HTTPS and pass the shared egress
 *     policy (`src/core/egressDestinationPolicy.ts`): the host name, its DNS
 *     answer and every address it resolves to are screened, the connection is
 *     pinned to those addresses, and every redirect is screened again
 *     (`egressFetch`). http/localhost is permitted only for endpoints the user
 *     explicitly marked `insecure` AND when `allowInsecureEndpoints` is enabled
 *     (e.g. the conformance demo) — and that path refuses to follow a redirect,
 *     since a redirect would carry the request outside what the user trusted.
 *   - Federation hops and nested-catalog expansion are depth-bounded to prevent
 *     referral loops and amplification.
 *   - The relevance `score` is surfaced verbatim but is NOT a trust/safety
 *     rating; callers must label it as such.
 */

import {
  ARD_URN_PATTERN,
  ARD_WELL_KNOWN_PATH,
  MAX_ARD_CATALOG_DEPTH,
  MAX_ARD_ENTRIES,
  MAX_ARD_FEDERATION_DEPTH,
  MAX_ARD_RESPONSE_BYTES,
} from '../constants.js';
import type {
  ArdCatalog,
  ArdCatalogEntry,
  ArdDiscoveredResource,
  ArdDiscoveryEndpoint,
  ArdFederationMode,
  ArdResourceType,
  ArdSearchFilter,
  ArdSearchResponse,
  ArdSearchResult,
  ArdTrustManifest,
} from '../types.js';
import { describeEgressRefusal, screenEgressUrl } from '../core/egressDestinationPolicy.js';
import { egressFetch, type EgressFetchDeps } from '../core/egressFetch.js';

/** Tunables read fresh on every call so VS Code setting changes take effect immediately. */
export interface ArdClientConfig {
  timeoutMs: number;
  maxResults: number;
  federation: ArdFederationMode;
  allowInsecureEndpoints: boolean;
}

export interface ArdSearchOptions {
  filter?: ArdSearchFilter;
  federation?: ArdFederationMode;
  /** Per-call cap; defaults to the configured `maxResults`. */
  maxResults?: number;
}

/** Error thrown for any protocol / validation / network failure. */
export class ArdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArdError';
  }
}

/** Result of searching multiple finders at once. */
export interface ArdMultiSearchResult {
  results: ArdDiscoveredResource[];
  errors: Array<{ endpoint: string; message: string }>;
}

export interface ArdTransportInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  /** The user marked this endpoint insecure and allowed insecure endpoints. */
  trustedLocal: boolean;
}

export interface ArdTransportResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  tooLarge: boolean;
}

/** One discovery request. Injected so tests replace the socket, not the policy. */
export type ArdTransport = (url: string, init: ArdTransportInit) => Promise<ArdTransportResponse>;

/**
 * The transport discovery uses. Everything not explicitly trusted goes through
 * `egressFetch`, so a referral or a nested catalog URL — both chosen by a
 * third party — is screened by DNS, pinned, and re-screened on every redirect.
 * `egressDeps` replaces only DNS and the socket.
 */
export function createArdTransport(egressDeps: EgressFetchDeps = {}): ArdTransport {
  return async (url, init) => {
    if (init.trustedLocal) {
      const response = await fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.timeout(init.timeoutMs),
        redirect: 'error',
      });
      const declared = Number(response.headers.get('content-length') ?? '0');
      const text = declared > init.maxBytes ? '' : await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
        tooLarge: declared > init.maxBytes || text.length > init.maxBytes,
      };
    }

    const result = await egressFetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      maxBytes: init.maxBytes,
      timeoutMs: init.timeoutMs,
    }, egressDeps);
    if (result.kind === 'refused') {
      throw new ArdError(`Discovery request refused. ${result.message}`);
    }
    const declared = Number(result.headers['content-length'] ?? '0');
    return {
      ok: result.ok,
      status: result.status,
      statusText: result.statusText,
      text: result.body,
      tooLarge: result.truncated || declared > init.maxBytes || result.body.length > init.maxBytes,
    };
  };
}

export class ArdClient {
  constructor(
    private readonly getConfig: () => ArdClientConfig,
    private readonly transport: ArdTransport = createArdTransport(),
  ) {}

  // ── Public API ────────────────────────────────────────────────

  /**
   * Search a single Agent Finder. Registry endpoints issue `POST /search`
   * (and follow referrals up to the federation depth bound); manifest endpoints
   * are fetched and ranked locally. Returns normalized, finder-annotated rows.
   */
  async search(
    endpoint: ArdDiscoveryEndpoint,
    text: string,
    options: ArdSearchOptions = {},
  ): Promise<ArdDiscoveredResource[]> {
    const query = text.trim();
    if (!query) {
      throw new ArdError('A non-empty search query is required.');
    }
    const config = this.getConfig();
    const maxResults = clampPositive(options.maxResults ?? config.maxResults, 1, MAX_ARD_ENTRIES);

    if (endpoint.kind === 'manifest') {
      const catalog = await this.fetchCatalog(endpoint.url, endpoint);
      return rankEntriesByText(catalog.entries, query)
        .slice(0, maxResults)
        .map(entry => entryToDiscovered(entry, endpoint));
    }

    const federation = options.federation ?? config.federation;
    const seenRegistries = new Set<string>([canonicalUrl(endpoint.url)]);
    const results = await this.searchRegistry(
      endpoint,
      query,
      { filter: options.filter, federation, maxResults },
      seenRegistries,
      0,
    );
    return dedupeAndRank(results, maxResults);
  }

  /**
   * Search every supplied finder concurrently, merging and de-duplicating the
   * results by identifier. Per-finder failures are collected, never thrown, so
   * one bad endpoint cannot break the whole search.
   */
  async searchEndpoints(
    endpoints: ArdDiscoveryEndpoint[],
    text: string,
    options: ArdSearchOptions = {},
  ): Promise<ArdMultiSearchResult> {
    const config = this.getConfig();
    const maxResults = clampPositive(options.maxResults ?? config.maxResults, 1, MAX_ARD_ENTRIES);
    const errors: Array<{ endpoint: string; message: string }> = [];

    const settled = await Promise.all(
      endpoints.map(async endpoint => {
        try {
          return await this.search(endpoint, text, { ...options, maxResults });
        } catch (error) {
          errors.push({ endpoint: endpoint.name, message: error instanceof Error ? error.message : String(error) });
          return [] as ArdDiscoveredResource[];
        }
      }),
    );

    return { results: dedupeAndRank(settled.flat(), maxResults), errors };
  }

  /**
   * Fetch and validate a publisher's static `ai-catalog.json`. Accepts either an
   * origin (the well-known path is appended) or a direct manifest URL. Nested
   * `application/ai-catalog+json` entries are expanded inline up to a depth bound.
   */
  async fetchCatalog(
    originOrManifestUrl: string,
    endpoint?: Pick<ArdDiscoveryEndpoint, 'insecure'>,
    depth = 0,
  ): Promise<ArdCatalog> {
    const manifestUrl = resolveManifestUrl(originOrManifestUrl);
    this.assertSafeUrl(manifestUrl, endpoint?.insecure);
    const raw = await this.fetchJson(manifestUrl, 'GET', undefined, this.isTrustedLocal(endpoint?.insecure));
    const catalog = validateCatalog(raw);

    if (depth < MAX_ARD_CATALOG_DEPTH) {
      const expanded: ArdCatalogEntry[] = [];
      for (const entry of catalog.entries) {
        if (entry.type === 'application/ai-catalog+json' && entry.url) {
          try {
            const nested = await this.fetchCatalog(entry.url, endpoint, depth + 1);
            expanded.push(...nested.entries);
            continue;
          } catch {
            // A broken nested catalog must not sink the parent — keep the pointer entry.
          }
        }
        expanded.push(entry);
      }
      catalog.entries = expanded.slice(0, MAX_ARD_ENTRIES);
    }

    return catalog;
  }

  // ── Registry search (with bounded federation) ─────────────────

  private async searchRegistry(
    endpoint: Pick<ArdDiscoveryEndpoint, 'name' | 'url' | 'insecure'>,
    text: string,
    options: { filter?: ArdSearchFilter; federation: ArdFederationMode; maxResults: number },
    seenRegistries: Set<string>,
    depth: number,
  ): Promise<ArdDiscoveredResource[]> {
    this.assertSafeUrl(endpoint.url, endpoint.insecure);

    const body = {
      query: { text, ...(options.filter ? { filter: options.filter } : {}) },
      federation: options.federation,
      pageSize: options.maxResults,
    };
    const raw = await this.fetchJson(endpoint.url, 'POST', body, this.isTrustedLocal(endpoint.insecure));
    const response = validateSearchResponse(raw);

    const results = response.results.map(result =>
      resultToDiscovered(result, endpoint.name, endpoint.url),
    );

    // Follow referrals client-side for auto/referrals modes, depth-bounded.
    if (options.federation !== 'none' && depth < MAX_ARD_FEDERATION_DEPTH && response.referrals?.length) {
      for (const referral of response.referrals) {
        const key = canonicalUrl(referral.url);
        if (seenRegistries.has(key)) {
          continue;
        }
        seenRegistries.add(key);
        try {
          this.assertSafeUrl(referral.url, false); // referrals are always remote — never insecure
          const nested = await this.searchRegistry(
            { name: referral.displayName || referral.identifier, url: referral.url },
            text,
            options,
            seenRegistries,
            depth + 1,
          );
          results.push(...nested);
        } catch {
          // Skip unreachable / unsafe referrals silently — best-effort federation.
        }
      }
    }

    return results;
  }

  // ── Bounded fetch ─────────────────────────────────────────────

  private async fetchJson(url: string, method: 'GET' | 'POST', body: unknown, trustedLocal: boolean): Promise<unknown> {
    const { timeoutMs } = this.getConfig();
    let response: ArdTransportResponse;
    try {
      response = await this.transport(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        timeoutMs,
        maxBytes: MAX_ARD_RESPONSE_BYTES,
        trustedLocal,
      });
    } catch (error) {
      if (error instanceof ArdError) {
        throw error;
      }
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new ArdError(`Discovery request timed out after ${timeoutMs}ms.`);
      }
      throw new ArdError(`Discovery request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      throw new ArdError(`Discovery endpoint returned HTTP ${response.status} ${response.statusText}.`.trim());
    }

    if (response.tooLarge) {
      throw new ArdError(`Discovery response too large (cap ${MAX_ARD_RESPONSE_BYTES} bytes).`);
    }

    try {
      return JSON.parse(response.text);
    } catch {
      throw new ArdError('Discovery endpoint returned malformed JSON.');
    }
  }

  private isTrustedLocal(insecure: boolean | undefined): boolean {
    return Boolean(insecure) && this.getConfig().allowInsecureEndpoints;
  }

  /** Reject non-HTTPS / private-network targets unless explicitly allowed for this endpoint. */
  private assertSafeUrl(url: string, insecureAllowed: boolean | undefined): void {
    const { allowInsecureEndpoints } = this.getConfig();
    const error = screenDiscoveryUrl(url, Boolean(insecureAllowed) && allowInsecureEndpoints);
    if (error) {
      throw new ArdError(error);
    }
  }
}

// ── URL safety ────────────────────────────────────────────────────

/**
 * Returns an error string if the URL is unsafe to fetch, else undefined.
 *
 * The URL half of the shared egress policy (`screenEgressUrl`); DNS, pinning
 * and redirects are enforced when the request is made (`createArdTransport`).
 * `allowInsecure` relaxes both checks for a user-trusted local endpoint (the
 * conformance demo), and only that.
 */
export function screenDiscoveryUrl(url: string, allowInsecure: boolean): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Invalid discovery URL.';
  }

  if (allowInsecure) {
    const protocol = parsed.protocol.toLowerCase();
    return protocol === 'https:' || protocol === 'http:'
      ? undefined
      : 'Discovery endpoints must use HTTPS (enable "allow insecure endpoints" for a trusted local registry).';
  }

  const screen = screenEgressUrl(url);
  if (screen.allowed) {
    return undefined;
  }
  if (screen.rule === 'egress.malformed-url') {
    return 'Invalid discovery URL.';
  }
  if (screen.rule === 'egress.scheme') {
    return 'Discovery endpoints must use HTTPS (enable "allow insecure endpoints" for a trusted local registry).';
  }
  return `Discovery URL refused. ${describeEgressRefusal(screen)}`;
}

// ── Manifest / response validation ────────────────────────────────

/** Validate and normalize a raw `ai-catalog.json` payload. Throws ArdError on failure. */
export function validateCatalog(raw: unknown): ArdCatalog {
  if (!isRecord(raw)) {
    throw new ArdError('Catalog is not a JSON object.');
  }
  const specVersion = typeof raw['specVersion'] === 'string' ? raw['specVersion'] : '';
  if (!specVersion) {
    throw new ArdError('Catalog is missing the required "specVersion" field.');
  }
  const rawEntries = raw['entries'];
  if (!Array.isArray(rawEntries)) {
    throw new ArdError('Catalog "entries" must be an array.');
  }

  const entries: ArdCatalogEntry[] = [];
  for (const candidate of rawEntries.slice(0, MAX_ARD_ENTRIES)) {
    const entry = normalizeEntry(candidate);
    if (entry) {
      entries.push(entry);
    }
  }

  return {
    specVersion,
    ...(isRecord(raw['host']) ? { host: normalizeHost(raw['host']) } : {}),
    entries,
  };
}

/** Validate and normalize a raw `POST /search` response. Throws ArdError on failure. */
export function validateSearchResponse(raw: unknown): ArdSearchResponse {
  if (!isRecord(raw)) {
    throw new ArdError('Search response is not a JSON object.');
  }
  const rawResults = raw['results'];
  if (!Array.isArray(rawResults)) {
    throw new ArdError('Search response "results" must be an array.');
  }

  const results: ArdSearchResult[] = [];
  for (const candidate of rawResults.slice(0, MAX_ARD_ENTRIES)) {
    const result = normalizeResult(candidate);
    if (result) {
      results.push(result);
    }
  }

  const referrals = Array.isArray(raw['referrals'])
    ? raw['referrals']
        .map(normalizeReferral)
        .filter((r): r is NonNullable<ReturnType<typeof normalizeReferral>> => r !== undefined)
    : undefined;

  return {
    results,
    ...(referrals && referrals.length > 0 ? { referrals } : {}),
    ...(typeof raw['pageToken'] === 'string' ? { pageToken: raw['pageToken'] } : {}),
  };
}

/**
 * Normalize a catalog entry, enforcing the URN format and the strict
 * Value-or-Reference rule (exactly one of `url` / `data`). Returns undefined for
 * entries that fail validation so a single bad entry can't reject the catalog.
 */
export function normalizeEntry(candidate: unknown): ArdCatalogEntry | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }
  const identifier = typeof candidate['identifier'] === 'string' ? candidate['identifier'].trim() : '';
  const displayName = typeof candidate['displayName'] === 'string' ? candidate['displayName'].trim() : '';
  const type = typeof candidate['type'] === 'string' ? (candidate['type'] as ArdResourceType) : '';
  if (!identifier || !ARD_URN_PATTERN.test(identifier) || !displayName || !type) {
    return undefined;
  }

  const url = typeof candidate['url'] === 'string' && candidate['url'].trim() ? candidate['url'].trim() : undefined;
  const data = isRecord(candidate['data']) ? (candidate['data'] as Record<string, unknown>) : undefined;
  // Strict Value-or-Reference: exactly one of url / data.
  if ((url && data) || (!url && !data)) {
    return undefined;
  }

  return {
    identifier,
    displayName,
    type,
    ...(url ? { url } : {}),
    ...(data ? { data } : {}),
    ...(typeof candidate['description'] === 'string' ? { description: candidate['description'] } : {}),
    ...(stringArray(candidate['representativeQueries']) ? { representativeQueries: stringArray(candidate['representativeQueries']) } : {}),
    ...(stringArray(candidate['capabilities']) ? { capabilities: stringArray(candidate['capabilities']) } : {}),
    ...(stringArray(candidate['tags']) ? { tags: stringArray(candidate['tags']) } : {}),
    ...(typeof candidate['version'] === 'string' ? { version: candidate['version'] } : {}),
    ...(typeof candidate['updatedAt'] === 'string' ? { updatedAt: candidate['updatedAt'] } : {}),
    ...(isRecord(candidate['trustManifest']) ? { trustManifest: normalizeTrustManifest(candidate['trustManifest']) } : {}),
  };
}

function normalizeResult(candidate: unknown): ArdSearchResult | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }
  const identifier = typeof candidate['identifier'] === 'string' ? candidate['identifier'].trim() : '';
  const displayName = typeof candidate['displayName'] === 'string' ? candidate['displayName'].trim() : '';
  const type = typeof candidate['type'] === 'string' ? (candidate['type'] as ArdResourceType) : '';
  if (!identifier || !ARD_URN_PATTERN.test(identifier) || !displayName || !type) {
    return undefined;
  }

  const score = typeof candidate['score'] === 'number' && Number.isFinite(candidate['score'])
    ? Math.max(0, Math.min(100, candidate['score']))
    : undefined;

  return {
    identifier,
    displayName,
    type,
    ...(typeof candidate['url'] === 'string' && candidate['url'].trim() ? { url: candidate['url'].trim() } : {}),
    ...(isRecord(candidate['data']) ? { data: candidate['data'] as Record<string, unknown> } : {}),
    ...(typeof candidate['description'] === 'string' ? { description: candidate['description'] } : {}),
    ...(stringArray(candidate['capabilities']) ? { capabilities: stringArray(candidate['capabilities']) } : {}),
    ...(stringArray(candidate['tags']) ? { tags: stringArray(candidate['tags']) } : {}),
    ...(isRecord(candidate['trustManifest']) ? { trustManifest: normalizeTrustManifest(candidate['trustManifest']) } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(typeof candidate['source'] === 'string' ? { source: candidate['source'] } : {}),
  };
}

function normalizeReferral(candidate: unknown): { identifier: string; displayName: string; type: ArdResourceType; url: string } | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }
  const url = typeof candidate['url'] === 'string' ? candidate['url'].trim() : '';
  const identifier = typeof candidate['identifier'] === 'string' ? candidate['identifier'].trim() : '';
  if (!url || !identifier) {
    return undefined;
  }
  return {
    identifier,
    displayName: typeof candidate['displayName'] === 'string' ? candidate['displayName'] : identifier,
    type: typeof candidate['type'] === 'string' ? (candidate['type'] as ArdResourceType) : 'application/ai-registry+json',
    url,
  };
}

function normalizeHost(raw: Record<string, unknown>): NonNullable<ArdCatalog['host']> {
  return {
    ...(typeof raw['displayName'] === 'string' ? { displayName: raw['displayName'] } : {}),
    ...(typeof raw['identifier'] === 'string' ? { identifier: raw['identifier'] } : {}),
    ...(typeof raw['documentationUrl'] === 'string' ? { documentationUrl: raw['documentationUrl'] } : {}),
    ...(typeof raw['logoUrl'] === 'string' ? { logoUrl: raw['logoUrl'] } : {}),
    ...(isRecord(raw['trustManifest']) ? { trustManifest: normalizeTrustManifest(raw['trustManifest']) } : {}),
  };
}

function normalizeTrustManifest(raw: Record<string, unknown>): ArdTrustManifest {
  return {
    ...(typeof raw['identity'] === 'string' ? { identity: raw['identity'] } : {}),
    ...(typeof raw['identityType'] === 'string' ? { identityType: raw['identityType'] } : {}),
    ...(Array.isArray(raw['attestations'])
      ? {
          attestations: raw['attestations']
            .filter(isRecord)
            .map(a => ({
              type: typeof a['type'] === 'string' ? a['type'] : 'unknown',
              ...(typeof a['uri'] === 'string' ? { uri: a['uri'] } : {}),
              ...(typeof a['digest'] === 'string' ? { digest: a['digest'] } : {}),
            })),
        }
      : {}),
    ...(Array.isArray(raw['provenance'])
      ? {
          provenance: raw['provenance']
            .filter(isRecord)
            .map(p => ({
              relation: typeof p['relation'] === 'string' ? p['relation'] : 'unknown',
              ...(typeof p['sourceId'] === 'string' ? { sourceId: p['sourceId'] } : {}),
              ...(typeof p['sourceDigest'] === 'string' ? { sourceDigest: p['sourceDigest'] } : {}),
            })),
        }
      : {}),
  };
}

// ── Local manifest ranking ────────────────────────────────────────

/**
 * Rank static catalog entries against a free-text query using simple token
 * overlap across name / description / capabilities / tags / queries. Used for
 * `manifest`-kind finders that have no live `/search` endpoint. Entries with no
 * overlap are dropped; an empty query returns every entry in original order.
 */
export function rankEntriesByText(entries: ArdCatalogEntry[], query: string): ArdCatalogEntry[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return entries;
  }
  return entries
    .map(entry => {
      const haystack = new Set(
        tokenize(
          [
            entry.displayName,
            entry.description ?? '',
            (entry.capabilities ?? []).join(' '),
            (entry.tags ?? []).join(' '),
            (entry.representativeQueries ?? []).join(' '),
          ].join(' '),
        ),
      );
      const overlap = terms.filter(term => haystack.has(term)).length;
      return { entry, overlap };
    })
    .filter(scored => scored.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .map(scored => scored.entry);
}

// ── Mapping to the normalized UI/install shape ────────────────────

function entryToDiscovered(entry: ArdCatalogEntry, endpoint: ArdDiscoveryEndpoint): ArdDiscoveredResource {
  return {
    identifier: entry.identifier,
    displayName: entry.displayName,
    type: entry.type,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.data ? { data: entry.data } : {}),
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
    ...(entry.tags ? { tags: entry.tags } : {}),
    ...(entry.trustManifest ? { trustManifest: entry.trustManifest } : {}),
    sourceName: endpoint.name,
    sourceEndpointId: endpoint.id,
  };
}

function resultToDiscovered(result: ArdSearchResult, sourceName: string, sourceEndpointId?: string): ArdDiscoveredResource {
  return {
    identifier: result.identifier,
    displayName: result.displayName,
    type: result.type,
    ...(result.url ? { url: result.url } : {}),
    ...(result.data ? { data: result.data } : {}),
    ...(result.description ? { description: result.description } : {}),
    ...(result.capabilities ? { capabilities: result.capabilities } : {}),
    ...(result.tags ? { tags: result.tags } : {}),
    ...(result.trustManifest ? { trustManifest: result.trustManifest } : {}),
    ...(result.score !== undefined ? { score: result.score } : {}),
    sourceName,
    ...(sourceEndpointId ? { sourceEndpointId } : {}),
  };
}

/** Merge results, keep the highest-scoring per identifier, sort by score desc, cap. */
function dedupeAndRank(results: ArdDiscoveredResource[], maxResults: number): ArdDiscoveredResource[] {
  const best = new Map<string, ArdDiscoveredResource>();
  for (const result of results) {
    const existing = best.get(result.identifier);
    if (!existing || (result.score ?? 0) > (existing.score ?? 0)) {
      best.set(result.identifier, result);
    }
  }
  return [...best.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxResults);
}

// ── Small helpers ─────────────────────────────────────────────────

function resolveManifestUrl(originOrManifestUrl: string): string {
  const trimmed = originOrManifestUrl.trim();
  if (/\.json($|\?)/i.test(trimmed) || trimmed.includes('/.well-known/')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${ARD_WELL_KNOWN_PATH}`;
  } catch {
    return trimmed;
  }
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2);
}

function clampPositive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

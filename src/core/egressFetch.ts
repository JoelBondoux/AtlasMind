/**
 * The connection that honours an {@link egressDestinationPolicy} decision.
 *
 * Deciding that a destination is safe is half the job; the other half is
 * making sure the request goes *there*. Three things can move it after the
 * check, and each is closed here.
 *
 * **The connection is pinned to the vetted addresses.** Resolving a name,
 * judging the answer, and then handing the *name* to `fetch` resolves it a
 * second time — and a resolver with a one-second TTL can answer "public" to the
 * first lookup and "127.0.0.1" to the second. That is DNS rebinding, and it is
 * why this module does not use global `fetch`: Node's `https.request` takes a
 * `lookup` function, and the one supplied here returns only the addresses the
 * policy already approved, whatever name it is asked about. TLS still verifies
 * the certificate against the *name* (SNI and the host check are unchanged), so
 * pinning narrows where the bytes go without weakening who they go to.
 *
 * **Redirects are followed by hand, and every hop is screened in full** —
 * URL, DNS, every address — exactly like the first. `fetch`'s automatic
 * `redirect: 'follow'` is the bypass: a public page answering `302 Location:
 * http://169.254.169.254/` would otherwise be fetched without anything looking
 * at it. Hops are capped at {@link MAX_EGRESS_REDIRECTS}; an `https` page
 * redirecting to `http` is refused by the same scheme rule as a first request.
 *
 * **Credentials do not follow a redirect to another origin.** `Authorization`,
 * `Cookie` and `Proxy-Authorization` are dropped when a hop changes origin, so
 * an API key sent to a public host is not forwarded to wherever that host
 * points next.
 *
 * Everything that touches the network is injected ({@link EgressFetchDeps}), so
 * the redirect walk and the pinning are tested without a socket.
 */

import * as dns from 'node:dns';
import * as https from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  MAX_EGRESS_REDIRECTS,
  describeEgressRefusal,
  vetEgressDestination,
  type EgressRefusal,
  type EgressResolver,
  type ResolvedAddress,
} from './egressDestinationPolicy.js';

export interface EgressHopRequest {
  readonly url: URL;
  /** The only addresses the connection may use. Already vetted. */
  readonly addresses: readonly ResolvedAddress[];
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}

export interface EgressHopResponse {
  readonly status: number;
  readonly statusText: string;
  /** Lower-cased header names. */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  readonly truncated: boolean;
}

/** Send exactly one request to exactly the vetted addresses, following nothing. */
export type EgressHopSender = (request: EgressHopRequest) => Promise<EgressHopResponse>;

export interface EgressFetchDeps {
  readonly resolve?: EgressResolver;
  readonly send?: EgressHopSender;
}

export interface EgressFetchOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

export type EgressFetchResult =
  | {
    readonly kind: 'response';
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: string;
    readonly truncated: boolean;
    readonly finalUrl: string;
    readonly redirects: number;
  }
  | {
    readonly kind: 'refused';
    readonly refusal: EgressRefusal;
    /** 0 for the URL asked for, n for the n-th redirect. */
    readonly hop: number;
    readonly message: string;
  };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Headers that carry a credential and must not cross to another origin. */
const ORIGIN_BOUND_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/**
 * A `lookup` that answers every question with the vetted addresses. Node calls
 * it with `{ all: true }` when happy-eyeballs is on (the default) and without
 * otherwise; both shapes are answered, and the name it is asked about is
 * deliberately ignored.
 */
export function createPinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  const pinned = addresses.map(entry => ({ address: entry.address, family: entry.family }));
  return ((_hostname: string, options: unknown, callback?: unknown) => {
    const done = (typeof options === 'function' ? options : callback) as (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void;
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { all?: boolean; family?: number };
    const wanted = opts.family === 4 || opts.family === 6
      ? pinned.filter(entry => entry.family === opts.family)
      : pinned;
    if (wanted.length === 0) {
      const error = Object.assign(new Error('No vetted address for the requested family.'), { code: 'ENOTFOUND' });
      done(error, opts.all ? [] : '', undefined);
      return;
    }
    if (opts.all) {
      done(null, wanted);
    } else {
      done(null, wanted[0]!.address, wanted[0]!.family);
    }
  }) as LookupFunction;
}

/** Every address the system resolver has for a name, in its own order. */
async function systemResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  const answers = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return answers.map(answer => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
}

/** One `https.request`, no agent reuse, no redirects, body capped. */
function sendPinnedHttpsHop(request: EgressHopRequest): Promise<EgressHopResponse> {
  return new Promise((resolve, reject) => {
    const host = request.url.hostname.replace(/^\[(.*)\]$/, '$1');
    const headers: Record<string, string> = { 'accept-encoding': 'identity', ...request.headers };
    if (request.body !== undefined && !Object.keys(headers).some(name => name.toLowerCase() === 'content-length')) {
      headers['content-length'] = String(Buffer.byteLength(request.body));
    }
    const req = https.request(
      {
        protocol: 'https:',
        host,
        port: request.url.port || 443,
        path: `${request.url.pathname}${request.url.search}`,
        method: request.method,
        headers,
        lookup: createPinnedLookup(request.addresses),
        // A fresh connection every time: a pooled socket is keyed by name and
        // could carry a connection made under an earlier, different decision.
        agent: false,
        signal: request.signal,
      },
      response => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;
        const finish = () => {
          const collected: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            collected[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: collected,
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          });
        };
        response.on('data', (chunk: Buffer) => {
          if (truncated) {
            return;
          }
          const room = request.maxBytes - received;
          if (chunk.length > room) {
            chunks.push(chunk.subarray(0, Math.max(0, room)));
            received = request.maxBytes;
            truncated = true;
            finish();
            response.destroy();
            return;
          }
          chunks.push(chunk);
          received += chunk.length;
        });
        response.on('end', () => {
          if (!truncated) {
            finish();
          }
        });
        response.on('error', error => {
          if (!truncated) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    if (request.body !== undefined) {
      req.write(request.body);
    }
    req.end();
  });
}

function refused(refusal: EgressRefusal, hop: number): EgressFetchResult {
  return { kind: 'refused', refusal, hop, message: describeEgressRefusal(refusal, hop) };
}

/**
 * Fetch a model-chosen URL: screen it, connect only to what was screened,
 * and screen every redirect the same way. A refusal is a result, not an
 * exception — network failures still throw, as they did before.
 */
export async function egressFetch(
  url: string,
  options: EgressFetchOptions,
  deps: EgressFetchDeps = {},
): Promise<EgressFetchResult> {
  const resolve = deps.resolve ?? systemResolver;
  const send = deps.send ?? sendPinnedHttpsHop;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  let current = url;
  let method = (options.method ?? 'GET').toUpperCase();
  let headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body = options.body;

  try {
    for (let hop = 0; ; hop += 1) {
      const decision = await vetEgressDestination(current, resolve);
      if (!decision.allowed) {
        return refused(decision, hop);
      }

      const response = await send({
        url: decision.url,
        addresses: decision.addresses,
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        maxBytes: options.maxBytes,
        signal: controller.signal,
      });

      const location = response.headers['location'];
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        return {
          kind: 'response',
          ok: response.status >= 200 && response.status < 300,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
          truncated: response.truncated,
          finalUrl: decision.url.href,
          redirects: hop,
        };
      }

      if (hop >= MAX_EGRESS_REDIRECTS) {
        return refused({
          allowed: false,
          rule: 'egress.redirect-limit',
          reason: `more than ${MAX_EGRESS_REDIRECTS} redirects`,
        }, hop + 1);
      }

      let next: URL;
      try {
        next = new URL(location, decision.url);
      } catch {
        return refused({
          allowed: false,
          rule: 'egress.redirect-target',
          reason: 'the redirect Location is not a URL',
        }, hop + 1);
      }

      if (next.origin !== decision.url.origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(([name]) => !ORIGIN_BOUND_HEADERS.has(name.toLowerCase())),
        );
      }
      // 307/308 repeat the request as sent; the others become a body-less GET,
      // which is what every browser does and what servers expect.
      if (response.status !== 307 && response.status !== 308 && method !== 'HEAD') {
        method = 'GET';
        body = undefined;
        headers = Object.fromEntries(
          Object.entries(headers).filter(([name]) => !/^content-(type|length)$/i.test(name)),
        );
      }
      current = next.href;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `{ ok, status, body }` shape `SkillExecutionContext` returns. A refusal
 * is `status: 0` with the rule-naming message as the body, so the skill (and
 * the model reading it) sees why, not just that it failed.
 */
export function toSkillHttpResult(result: EgressFetchResult): { ok: boolean; status: number; body: string } {
  return result.kind === 'refused'
    ? { ok: false, status: 0, body: result.message }
    : { ok: result.ok, status: result.status, body: result.body };
}

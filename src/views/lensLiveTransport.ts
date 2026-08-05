/**
 * The two transports a live probe can use, and nothing else.
 *
 * Split out from the command so the runner's injected seam has exactly one
 * implementation per kind, and so the parts that touch the network are small
 * enough to read in one sitting. Everything that decides *whether* to send lives
 * in `lensProbePolicy`; this file only performs a request it has already been
 * handed.
 *
 * Three properties are enforced here rather than upstream, because upstream
 * cannot enforce them:
 *
 * **The response is capped while it is read, not after.** A cap checked after
 * `await response.text()` has already admitted an unbounded body into memory,
 * which on a misconfigured endpoint is precisely the case it exists for. So the
 * body is streamed and abandoned the moment it exceeds the budget.
 *
 * **Redirects are not followed.** A declared endpoint is a destination somebody
 * reviewed; a redirect is that server nominating a different one, with the
 * bearer token still attached. `redirect: 'manual'` turns a 3xx into a reported
 * outcome the operator can see rather than a silent hop to an unreviewed host.
 *
 * **The error never carries the request.** A failure is reported by its message
 * only. Interpolating the request into a diagnostic is how an `Authorization`
 * header ends up in an output channel, and output channels get pasted into
 * issues.
 *
 * `vscode` is imported only for the MCP dispatch seam; the HTTP path is plain
 * `fetch` and could run anywhere.
 */

import type { LensProbeRequest } from '../core/lensProbePolicy.js';
import type { LensProbeTransportResult } from '../core/lensProbeRunner.js';

/**
 * Perform an HTTP probe.
 *
 * Total: every failure mode becomes a result rather than an exception, because a
 * surface showing six endpoints must not lose five of them to the first one that
 * is down.
 */
export async function performHttpProbe(request: LensProbeRequest): Promise<LensProbeTransportResult> {
  if (!request.url || !request.method) {
    return { ok: false, error: 'The probe request named no destination.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
      // A redirect is the server nominating a destination nobody reviewed,
      // and the token would go with it.
      redirect: 'manual',
      signal: controller.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        error: `The service answered ${response.status} and asked to redirect. AtlasMind does not follow `
          + 'redirects on a probe, because the new destination is not the one declared. Point the '
          + 'endpoint at the final URL.',
      };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: `The service answered ${response.status}.` };
    }

    const text = await readCapped(response, request.maxResponseBytes);
    if (text === undefined) {
      return {
        ok: false,
        status: response.status,
        error: `The response exceeded the ${Math.round(request.maxResponseBytes / 1024 / 1024)}MB probe budget `
          + 'and was abandoned. AtlasMind did not read it.',
      };
    }

    try {
      return { ok: true, status: response.status, payload: JSON.parse(text) as unknown };
    } catch {
      return {
        ok: false,
        status: response.status,
        error: 'The response was not JSON. Check that the URL points at the schema document rather than '
          + 'at a web page.',
      };
    }
  } catch (error) {
    // Reported by message only. The request never enters a diagnostic.
    return {
      ok: false,
      error: controller.signal.aborted
        ? `The probe timed out after ${request.timeoutMs}ms.`
        : messageOf(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body up to a byte budget, or give up.
 *
 * Returns `undefined` when the budget is exceeded — deliberately not a truncated
 * string, because half a JSON document parses as nothing and would be reported
 * as "the service served an unreadable schema" rather than as a body too large
 * to read.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  const body = response.body;
  if (!body) {
    return '';
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Dispatch a database probe through a connected MCP server.
 *
 * The tool id and its (empty) arguments were chosen by `lensProbePolicy`; this
 * only invokes what it was handed. `invoke` is injected rather than imported so
 * the command owns the registry and this file stays testable without one.
 */
export async function performMcpProbe(
  request: LensProbeRequest,
  invoke: (toolId: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<LensProbeTransportResult> {
  if (!request.mcpToolId) {
    return { ok: false, error: 'The probe request named no MCP tool.' };
  }
  try {
    const payload = await withTimeout(
      invoke(request.mcpToolId, { ...request.mcpArguments }),
      request.timeoutMs,
    );
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`The probe timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]);
}

/** Bounded, control-stripped error text. This reaches a webview and a modal. */
function messageOf(error: unknown): string {
  const raw = error instanceof Error && error.message ? error.message : 'no detail was reported';
  let stripped = '';
  for (let index = 0; index < raw.length && stripped.length < 240; index += 1) {
    const code = raw.charCodeAt(index);
    stripped += code <= 0x1f || code === 0x7f ? ' ' : raw[index];
  }
  return stripped.replace(/\s+/g, ' ').trim() || 'no detail was reported';
}

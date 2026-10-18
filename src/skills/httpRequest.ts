import type { SkillDefinition } from '../types.js';
import { MAX_WEB_FETCH_BODY_BYTES } from '../constants.js';
import { describeEgressRefusal, screenEgressUrl } from '../core/egressDestinationPolicy.js';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export const httpRequestSkill: SkillDefinition = {
  id: 'http-request',
  name: 'HTTP Request',
  builtIn: true,
  description:
    'Make an HTTP request with a configurable method, headers, and body. ' +
    'Useful for testing REST APIs, webhooks, and authenticated endpoints. ' +
    'Supports GET, POST, PUT, PATCH, DELETE. https only; private, loopback, link-local and metadata addresses are refused.',
  timeoutMs: 30_000,
  routingHints: [
    'call api', 'post request', 'put request', 'patch request', 'delete request',
    'test endpoint', 'send request', 'api call', 'webhook', 'rest api',
  ],
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'The https:// URL to request. Private, loopback, link-local and metadata addresses are refused, including by DNS and by redirect.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        description: 'HTTP method. Defaults to GET when no body is provided, POST otherwise.',
      },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Optional request headers as a key/value object (e.g. { "Authorization": "Bearer ..." }).',
      },
      body: {
        type: 'string',
        description: 'Optional request body. For JSON APIs, stringify the object and set Content-Type: application/json.',
      },
      maxBytes: {
        type: 'integer',
        description: `Maximum response body size in bytes. Default and cap: ${MAX_WEB_FETCH_BODY_BYTES}.`,
      },
    },
  },
  async execute(params, context) {
    const rawUrl = params['url'];
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      return 'Error: "url" parameter is required and must be a non-empty string.';
    }

    // Fast, readable refusal here; DNS, the pinned connection and every
    // redirect are screened inside `context.httpRequest` (`egressFetch`).
    const url = rawUrl.trim();
    const screen = screenEgressUrl(url);
    if (!screen.allowed) {
      return `Error: ${describeEgressRefusal(screen)}`;
    }

    const rawMethod = params['method'];
    const body = typeof params['body'] === 'string' ? params['body'] : undefined;
    const methodStr = typeof rawMethod === 'string' ? rawMethod.toUpperCase() : (body ? 'POST' : 'GET');
    if (!ALLOWED_METHODS.has(methodStr)) {
      return `Error: Method "${methodStr}" is not allowed. Use one of: ${[...ALLOWED_METHODS].join(', ')}.`;
    }

    const rawHeaders = params['headers'];
    const headers: Record<string, string> = {};
    if (rawHeaders !== undefined) {
      if (typeof rawHeaders !== 'object' || Array.isArray(rawHeaders) || rawHeaders === null) {
        return 'Error: "headers" must be a plain object of string key/value pairs.';
      }
      for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          return `Error: Header value for "${k}" must be a string.`;
        }
        // Reject header injection attempts
        if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) {
          return `Error: Header "${k}" contains invalid newline characters.`;
        }
        headers[k] = v;
      }
    }

    const rawMax = params['maxBytes'];
    const maxBytes = typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax > 0
      ? Math.min(rawMax, MAX_WEB_FETCH_BODY_BYTES)
      : MAX_WEB_FETCH_BODY_BYTES;

    const result = await context.httpRequest(url, {
      method: methodStr,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
      maxBytes,
      timeoutMs: 20_000,
    });

    const truncated = result.body.length > maxBytes
      ? result.body.slice(0, maxBytes) + '\n[...truncated]'
      : result.body;

    return [
      `ok: ${result.ok}`,
      `status: ${result.status}`,
      `body:\n${truncated}`,
    ].join('\n');
  },
};

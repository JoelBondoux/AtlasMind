import type { SkillDefinition } from '../types.js';
import { MAX_WEB_FETCH_BODY_BYTES } from '../constants.js';

export const webFetchSkill: SkillDefinition = {
  id: 'web-fetch',
  name: 'Fetch URL',
  builtIn: true,
  description:
    'Fetch text content from a URL. Returns the response body as text. ' +
    'Useful for looking up documentation, error messages, and API references.',
  timeoutMs: 30_000,
  parameters: {
    type: 'object',
    required: ['url'],
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must start with https:// or http://).',
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

    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      return 'Error: URL must start with https:// or http://.';
    }

    // Reject private/local network URLs to prevent SSRF
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.local') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        hostname === '[::1]' ||
        hostname === 'metadata.google.internal'
      ) {
        return 'Error: Fetching from private/local network addresses is not allowed.';
      }
    } catch {
      return 'Error: Invalid URL format.';
    }

    const rawMax = params['maxBytes'];
    const maxBytes = typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax > 0
      ? Math.min(rawMax, MAX_WEB_FETCH_BODY_BYTES)
      : MAX_WEB_FETCH_BODY_BYTES;

    const result = await context.fetchUrl(url, { maxBytes, timeoutMs: 20_000 });

    if (!result.ok) {
      return `Error: HTTP ${result.status}\n${result.body}`;
    }

    const truncated = result.body.length > maxBytes
      ? result.body.slice(0, maxBytes) + '\n[...truncated]'
      : result.body;

    return `HTTP ${result.status}\n${truncated}`;
  },
};

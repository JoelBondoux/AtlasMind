import type { SkillDefinition } from '../types.js';
import { MAX_WEB_FETCH_BODY_BYTES } from '../constants.js';
import { describeEgressRefusal, screenEgressUrl } from '../core/egressDestinationPolicy.js';

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
        description: 'The https:// URL to fetch. Private, loopback, link-local and metadata addresses are refused, including by DNS and by redirect.',
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

    // The URL screen runs here for a fast, readable refusal. The full decision —
    // DNS, every resolved address, the pinned connection and each redirect —
    // happens inside `context.fetchUrl` (`egressFetch`), so a model-drafted skill
    // that calls `fetchUrl` directly is held to the same rule.
    const url = rawUrl.trim();
    const screen = screenEgressUrl(url);
    if (!screen.allowed) {
      return `Error: ${describeEgressRefusal(screen)}`;
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

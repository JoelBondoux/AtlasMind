import type { SkillDefinition } from '../types.js';
import { requireString } from './validation.js';

interface ExaSearchResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  id?: string;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
}

interface ExaSearchResponse {
  requestId?: string;
  results?: ExaSearchResult[];
  autopromptString?: string;
}

export const exaSearchSkill: SkillDefinition = {
  id: 'exa-search',
  name: 'EXA Web Search',
  builtIn: true,
  description:
    'Search the web using the EXA AI search API. Returns relevant URLs, titles, and text snippets. ' +
    'Requires an EXA API key to be stored in the Specialist Integrations panel.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'The search query or question to research.',
      },
      numResults: {
        type: 'integer',
        description: 'Number of results to return (1–10, default 5).',
      },
      useAutoprompt: {
        type: 'boolean',
        description: 'Whether EXA should auto-improve the query. Defaults to true.',
      },
      includeText: {
        type: 'boolean',
        description: 'Whether to include page text snippets in results. Defaults to true.',
      },
    },
  },
  async execute(params, context) {
    const queryErr = requireString(params, 'query');
    if (queryErr) { return queryErr; }

    const query = (params['query'] as string).trim();
    const numResults = typeof params['numResults'] === 'number'
      ? Math.max(1, Math.min(10, Math.floor(params['numResults'])))
      : 5;
    const useAutoprompt = params['useAutoprompt'] !== false;
    const includeText = params['includeText'] !== false;

    const apiKey = await context.getSpecialistApiKey('exa');
    if (!apiKey) {
      return 'Error: No EXA API key is configured. Open the Specialist Integrations panel and store an API key for EXA AI.';
    }

    const requestBody = JSON.stringify({
      query,
      numResults,
      useAutoprompt,
      contents: includeText ? { text: { maxCharacters: 2000 } } : undefined,
    });

    const response = await context.httpRequest('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: requestBody,
      timeoutMs: 20_000,
      maxBytes: 500_000,
    });

    if (!response.ok) {
      return `Error: EXA API returned ${response.status}: ${response.body.slice(0, 200)}`;
    }

    let data: ExaSearchResponse;
    try {
      data = JSON.parse(response.body) as ExaSearchResponse;
    } catch {
      return 'Error: EXA API returned an invalid JSON response.';
    }

    const results = data.results ?? [];
    if (results.length === 0) {
      return `No results found for: ${query}`;
    }

    const lines: string[] = [`EXA search results for: ${query}`];
    if (data.autopromptString && data.autopromptString !== query) {
      lines.push(`Autoprompt: ${data.autopromptString}`);
    }
    lines.push('');

    for (const [index, result] of results.entries()) {
      lines.push(`${index + 1}. ${result.title ?? '(no title)'}`);
      lines.push(`   URL: ${result.url ?? '(no url)'}`);
      if (result.publishedDate) {
        lines.push(`   Published: ${result.publishedDate}`);
      }
      if (result.text) {
        lines.push(`   Snippet: ${result.text.slice(0, 500).replace(/\n+/g, ' ').trim()}`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  },
};

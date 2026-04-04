import type { SkillDefinition } from '../types.js';
import { MAX_MEMORY_QUERY_RESULTS_CAP } from '../constants.js';
import { requireString } from './validation.js';

export const memoryQuerySkill: SkillDefinition = {
  id: 'memory-query',
  name: 'Query Memory',
  builtIn: true,
  description: 'Search the project SSOT memory for entries relevant to a query.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Search terms to find relevant memory entries.',
      },
      maxResults: {
        type: 'number',
        description: `Maximum number of results to return (default: 5, max: ${MAX_MEMORY_QUERY_RESULTS_CAP}).`,
      },
    },
  },
  async execute(params, context) {
    const err = requireString(params, 'query');
    if (err) { return err; }
    const query = (params['query'] as string).trim();
    const raw = typeof params['maxResults'] === 'number' ? params['maxResults'] : 5;
    const maxResults = Math.min(Math.max(1, raw), MAX_MEMORY_QUERY_RESULTS_CAP);
    const entries = await context.queryMemory(query, maxResults);
    if (entries.length === 0) {
      return 'No memory entries found matching the query.';
    }
    return entries
      .map(e => `## ${e.title}\nPath: ${e.path}\nTags: ${e.tags.join(', ')}\n\n${e.snippet}`)
      .join('\n\n---\n\n');
  },
};

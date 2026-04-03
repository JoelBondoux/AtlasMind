import type { SkillDefinition } from '../types.js';

export const memoryQuerySkill: SkillDefinition = {
  id: 'memory-query',
  name: 'Query Memory',
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
        description: 'Maximum number of results to return (default: 5).',
      },
    },
  },
  async execute(params, context) {
    const query = params['query'];
    const maxResults =
      typeof params['maxResults'] === 'number' ? params['maxResults'] : 5;
    if (typeof query !== 'string' || query.trim().length === 0) {
      return 'Error: "query" parameter is required and must be a non-empty string.';
    }
    const entries = await context.queryMemory(query.trim(), maxResults);
    if (entries.length === 0) {
      return 'No memory entries found matching the query.';
    }
    return entries
      .map(e => `## ${e.title}\nPath: ${e.path}\nTags: ${e.tags.join(', ')}\n\n${e.snippet}`)
      .join('\n\n---\n\n');
  },
};

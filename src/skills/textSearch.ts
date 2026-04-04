import type { SkillDefinition } from '../types.js';

export const textSearchSkill: SkillDefinition = {
  id: 'text-search',
  name: 'Text Search',
  builtIn: true,
  description: 'Search UTF-8 text files in the workspace for literal text or a regular expression and return matching lines.',
  parameters: {
    type: 'object',
    required: ['query'],
    properties: {
      query: {
        type: 'string',
        description: 'Literal text or regex pattern to search for.',
      },
      isRegexp: {
        type: 'boolean',
        description: 'When true, treat query as a JavaScript regular expression source.',
      },
      includePattern: {
        type: 'string',
        description: 'Optional glob limiting which files are searched, e.g. "src/**/*.ts".',
      },
      maxResults: {
        type: 'integer',
        description: 'Maximum number of matching lines to return.',
      },
    },
  },
  async execute(params, context) {
    const query = params['query'];
    const isRegexp = params['isRegexp'];
    const includePattern = params['includePattern'];
    const maxResults = params['maxResults'];

    if (typeof query !== 'string' || query.trim().length === 0) {
      return 'Error: "query" parameter is required and must be a non-empty string.';
    }
    if (isRegexp !== undefined && typeof isRegexp !== 'boolean') {
      return 'Error: "isRegexp" must be a boolean when provided.';
    }
    if (includePattern !== undefined && typeof includePattern !== 'string') {
      return 'Error: "includePattern" must be a string when provided.';
    }
    if (maxResults !== undefined && (typeof maxResults !== 'number' || !Number.isInteger(maxResults) || maxResults < 1)) {
      return 'Error: "maxResults" must be a positive integer when provided.';
    }

    const matches = await context.searchInFiles(query.trim(), {
      isRegexp: isRegexp === true,
      includePattern: typeof includePattern === 'string' ? includePattern.trim() : undefined,
      maxResults: typeof maxResults === 'number' ? maxResults : undefined,
    });

    if (matches.length === 0) {
      return `No matches found for "${query.trim()}".`;
    }

    return matches
      .map(match => `${match.path}:${match.line}: ${match.text}`)
      .join('\n');
  },
};
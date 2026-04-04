import type { SkillDefinition } from '../types.js';
import { requireString, optionalBoolean, optionalString, optionalPositiveInt } from './validation.js';

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
    const queryErr = requireString(params, 'query');
    if (queryErr) { return queryErr; }
    const regexpErr = optionalBoolean(params, 'isRegexp');
    if (regexpErr) { return regexpErr; }
    const patternErr = optionalString(params, 'includePattern');
    if (patternErr) { return patternErr; }
    const maxErr = optionalPositiveInt(params, 'maxResults');
    if (maxErr) { return maxErr; }

    const query = (params['query'] as string).trim();
    const isRegexp = params['isRegexp'];
    const includePattern = params['includePattern'];
    const maxResults = params['maxResults'];

    const matches = await context.searchInFiles(query, {
      isRegexp: isRegexp === true,
      includePattern: typeof includePattern === 'string' ? includePattern.trim() : undefined,
      maxResults: typeof maxResults === 'number' ? maxResults : undefined,
    });

    if (matches.length === 0) {
      return `No matches found for "${query}"`;
    }

    return matches
      .map(match => `${match.path}:${match.line}: ${match.text}`)
      .join('\n');
  },
};
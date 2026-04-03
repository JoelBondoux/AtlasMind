import type { SkillDefinition } from '../types.js';

export const fileSearchSkill: SkillDefinition = {
  id: 'file-search',
  name: 'Search Files',
  builtIn: true,
  description: 'Find files in the workspace matching a glob pattern. Returns a newline-separated list of absolute paths.',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern relative to the workspace root, e.g. "**/*.ts" or "src/**/*.json".',
      },
    },
  },
  async execute(params, context) {
    const pattern = params['pattern'];
    if (typeof pattern !== 'string' || pattern.trim().length === 0) {
      return 'Error: "pattern" parameter is required and must be a non-empty string.';
    }
    const files = await context.findFiles(pattern.trim());
    if (files.length === 0) {
      return `No files found matching "${pattern.trim()}".`;
    }
    return files.join('\n');
  },
};

import type { SkillDefinition } from '../types.js';
import { requireString } from './validation.js';

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
    const err = requireString(params, 'pattern');
    if (err) { return err; }
    const pattern = (params['pattern'] as string).trim();
    const files = await context.findFiles(pattern);
    if (files.length === 0) {
      return `No files found matching "${pattern}"`;
    }
    return files.join('\n');
  },
};

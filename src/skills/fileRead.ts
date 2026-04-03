import type { SkillDefinition } from '../types.js';

export const fileReadSkill: SkillDefinition = {
  id: 'file-read',
  name: 'Read File',
  description: 'Read the UTF-8 text content of a file in the workspace by its absolute path.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to read.',
      },
    },
  },
  async execute(params, context) {
    const path = params['path'];
    if (typeof path !== 'string' || path.trim().length === 0) {
      return 'Error: "path" parameter is required and must be a non-empty string.';
    }
    return context.readFile(path.trim());
  },
};

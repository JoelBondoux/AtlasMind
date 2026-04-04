import type { SkillDefinition } from '../types.js';

export const directoryListSkill: SkillDefinition = {
  id: 'directory-list',
  name: 'List Directory',
  builtIn: true,
  description: 'List files and folders directly under a workspace directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Optional absolute path to the directory. Defaults to the workspace root.',
      },
    },
  },
  async execute(params, context) {
    const path = params['path'];
    if (path !== undefined && typeof path !== 'string') {
      return 'Error: "path" must be a string when provided.';
    }

    const entries = await context.listDirectory(typeof path === 'string' ? path.trim() : undefined);
    if (entries.length === 0) {
      return 'Directory is empty.';
    }

    return entries
      .map(entry => `${entry.type === 'directory' ? '[dir]' : '[file]'} ${entry.path}`)
      .join('\n');
  },
};
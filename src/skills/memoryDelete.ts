import type { SkillDefinition } from '../types.js';

export const memoryDeleteSkill: SkillDefinition = {
  id: 'memory-delete',
  name: 'Delete Memory',
  builtIn: true,
  description:
    'Remove an entry from the project SSOT memory by its relative path. ' +
    'Also deletes the corresponding file on disk if it exists.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Relative SSOT path of the entry to delete (e.g. "decisions/old-choice.md").',
      },
    },
  },
  async execute(params, context) {
    const path = params['path'];
    if (typeof path !== 'string' || path.trim().length === 0) {
      return 'Error: "path" parameter is required and must be a non-empty string.';
    }
    const removed = await context.deleteMemory(path.trim());
    if (!removed) {
      return `No memory entry found at path: ${path}`;
    }
    return `Memory entry deleted: ${path}`;
  },
};

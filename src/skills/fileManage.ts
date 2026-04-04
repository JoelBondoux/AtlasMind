import type { SkillDefinition } from '../types.js';

export const fileDeleteSkill: SkillDefinition = {
  id: 'file-delete',
  name: 'Delete File',
  builtIn: true,
  description: 'Delete a file inside the workspace by its absolute path.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to delete.',
      },
    },
  },
  async execute(params, context) {
    const filePath = params['path'];
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return 'Error: "path" parameter is required and must be a non-empty string.';
    }
    await context.deleteFile(filePath.trim());
    return `Deleted: ${filePath.trim()}`;
  },
};

export const fileMoveSkill: SkillDefinition = {
  id: 'file-move',
  name: 'Move / Rename File',
  builtIn: true,
  description:
    'Move or rename a file inside the workspace. Both source and destination must be absolute workspace paths.',
  parameters: {
    type: 'object',
    required: ['source', 'destination'],
    properties: {
      source: {
        type: 'string',
        description: 'Absolute path to the existing file.',
      },
      destination: {
        type: 'string',
        description: 'Absolute path for the new location.',
      },
    },
  },
  async execute(params, context) {
    const source = params['source'];
    const destination = params['destination'];

    if (typeof source !== 'string' || source.trim().length === 0) {
      return 'Error: "source" parameter is required and must be a non-empty string.';
    }
    if (typeof destination !== 'string' || destination.trim().length === 0) {
      return 'Error: "destination" parameter is required and must be a non-empty string.';
    }

    await context.moveFile(source.trim(), destination.trim());
    return `Moved: ${source.trim()} → ${destination.trim()}`;
  },
};

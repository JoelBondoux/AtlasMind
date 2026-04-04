import type { SkillDefinition } from '../types.js';

export const fileReadSkill: SkillDefinition = {
  id: 'file-read',
  name: 'Read File',
  builtIn: true,
  description:
    'Read the UTF-8 text content of a file in the workspace by its absolute path. ' +
    'Supports optional startLine/endLine (1-based, inclusive) to read a specific range and save context window.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to read.',
      },
      startLine: {
        type: 'integer',
        description: 'Optional 1-based line number to start reading from (inclusive).',
      },
      endLine: {
        type: 'integer',
        description: 'Optional 1-based line number to stop reading at (inclusive).',
      },
    },
  },
  async execute(params, context) {
    const path = params['path'];
    if (typeof path !== 'string' || path.trim().length === 0) {
      return 'Error: "path" parameter is required and must be a non-empty string.';
    }

    const content = await context.readFile(path.trim());

    const rawStart = params['startLine'];
    const rawEnd = params['endLine'];
    const hasRange = rawStart !== undefined || rawEnd !== undefined;
    if (!hasRange) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const start = typeof rawStart === 'number' && Number.isInteger(rawStart) ? Math.max(1, rawStart) : 1;
    const end = typeof rawEnd === 'number' && Number.isInteger(rawEnd) ? Math.min(rawEnd, lines.length) : lines.length;

    if (start > end) {
      return `Error: startLine (${start}) must be <= endLine (${end}).`;
    }

    const slice = lines.slice(start - 1, end);
    return `[Lines ${start}-${end} of ${lines.length}]\n${slice.join('\n')}`;
  },
};

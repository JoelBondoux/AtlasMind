import type { SkillDefinition } from '../types.js';
import { requireString } from './validation.js';

export const fileWriteSkill: SkillDefinition = {
  id: 'file-write',
  name: 'Write File',
  builtIn: true,
  description:
    'Write or overwrite the UTF-8 text content of a file inside the workspace. ' +
    'Paths outside the workspace root are rejected for safety.',
  parameters: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to write.',
      },
      content: {
        type: 'string',
        description: 'The text content to write to the file.',
      },
    },
  },
  async execute(params, context) {
    const pathErr = requireString(params, 'path');
    if (pathErr) { return pathErr; }
    const content = params['content'];
    if (typeof content !== 'string') {
      return 'Error: "content" parameter is required and must be a string.';
    }
    const path = (params['path'] as string).trim();
    await context.writeFile(path, content);
    return `File written: ${path}`;
  },
};

import type { SkillDefinition } from '../types.js';

export const renameSymbolSkill: SkillDefinition = {
  id: 'rename-symbol',
  name: 'Rename Symbol',
  builtIn: true,
  description:
    'Rename a symbol across the entire workspace using VS Code rename provider. ' +
    'Type-safe: renames all references, imports, and declarations.',
  parameters: {
    type: 'object',
    required: ['path', 'line', 'column', 'newName'],
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file containing the symbol.',
      },
      line: {
        type: 'integer',
        description: '1-based line number of the symbol to rename.',
      },
      column: {
        type: 'integer',
        description: '1-based column number of the symbol to rename.',
      },
      newName: {
        type: 'string',
        description: 'The new name for the symbol.',
      },
    },
  },
  async execute(params, context) {
    const filePath = params['path'];
    const rawLine = params['line'];
    const rawCol = params['column'];
    const newName = params['newName'];

    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return 'Error: "path" is required and must be a non-empty string.';
    }
    if (typeof rawLine !== 'number' || !Number.isInteger(rawLine) || rawLine < 1) {
      return 'Error: "line" is required and must be a positive integer.';
    }
    if (typeof rawCol !== 'number' || !Number.isInteger(rawCol) || rawCol < 1) {
      return 'Error: "column" is required and must be a positive integer.';
    }
    if (typeof newName !== 'string' || newName.trim().length === 0) {
      return 'Error: "newName" is required and must be a non-empty string.';
    }
    if (!/^[\w$]+$/u.test(newName.trim())) {
      return 'Error: "newName" must be a valid identifier (letters, digits, underscores, $).';
    }

    const result = await context.renameSymbol(filePath.trim(), rawLine, rawCol, newName.trim());
    return `Renamed symbol: ${result.filesChanged} file(s) changed, ${result.editsApplied} edit(s) applied.`;
  },
};

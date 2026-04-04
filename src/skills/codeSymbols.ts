import type { SkillDefinition } from '../types.js';

export const codeSymbolsSkill: SkillDefinition = {
  id: 'code-symbols',
  name: 'Code Symbols',
  builtIn: true,
  description:
    'AST-aware code navigation using VS Code language services. ' +
    'Can list document symbols, find all references, or go to definition.',
  parameters: {
    type: 'object',
    required: ['action', 'path'],
    properties: {
      action: {
        type: 'string',
        enum: ['symbols', 'references', 'definition'],
        description:
          '"symbols" — list functions/classes/variables in a file. ' +
          '"references" — find all references to the symbol at line:column. ' +
          '"definition" — go to the definition of the symbol at line:column.',
      },
      path: {
        type: 'string',
        description: 'Absolute path to the file.',
      },
      line: {
        type: 'integer',
        description: '1-based line number (required for references and definition).',
      },
      column: {
        type: 'integer',
        description: '1-based column number (required for references and definition).',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    const filePath = params['path'];

    if (typeof action !== 'string' || !['symbols', 'references', 'definition'].includes(action)) {
      return 'Error: "action" must be one of: symbols, references, definition.';
    }
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return 'Error: "path" is required and must be a non-empty string.';
    }

    if (action === 'symbols') {
      const symbols = await context.getDocumentSymbols(filePath.trim());
      if (symbols.length === 0) {
        return 'No symbols found in the file.';
      }
      return symbols
        .map(s => {
          const childInfo = s.children && s.children.length > 0 ? ` [${s.children.join(', ')}]` : '';
          return `${s.kind} ${s.name} ${s.range}${childInfo}`;
        })
        .join('\n');
    }

    const rawLine = params['line'];
    const rawCol = params['column'];
    if (typeof rawLine !== 'number' || !Number.isInteger(rawLine) || rawLine < 1) {
      return 'Error: "line" is required and must be a positive integer for this action.';
    }
    if (typeof rawCol !== 'number' || !Number.isInteger(rawCol) || rawCol < 1) {
      return 'Error: "column" is required and must be a positive integer for this action.';
    }

    if (action === 'references') {
      const refs = await context.findReferences(filePath.trim(), rawLine, rawCol);
      if (refs.length === 0) {
        return 'No references found.';
      }
      return refs.map(r => `${r.path}:${r.line}:${r.column} ${r.text}`).join('\n');
    }

    // action === 'definition'
    const defs = await context.goToDefinition(filePath.trim(), rawLine, rawCol);
    if (defs.length === 0) {
      return 'No definition found.';
    }
    return defs.map(d => `${d.path}:${d.line}:${d.column}`).join('\n');
  },
};

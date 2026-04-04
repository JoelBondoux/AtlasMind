import type { SkillDefinition } from '../types.js';

export const diagnosticsSkill: SkillDefinition = {
  id: 'diagnostics',
  name: 'Get Diagnostics',
  builtIn: true,
  description:
    'Get compiler errors, warnings, and lint issues from the VS Code language services. ' +
    'Without arguments returns all workspace diagnostics. Pass file paths to filter results.',
  parameters: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of absolute file paths to get diagnostics for. Omit for all workspace diagnostics.',
      },
    },
  },
  async execute(params, context) {
    const rawPaths = params['paths'];
    const paths = Array.isArray(rawPaths)
      ? rawPaths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim())
      : undefined;

    const diagnostics = await context.getDiagnostics(paths);

    if (diagnostics.length === 0) {
      return paths && paths.length > 0
        ? `No diagnostics found for the specified file(s).`
        : 'No diagnostics found in the workspace.';
    }

    const lines = diagnostics.map(d =>
      `${d.path}:${d.line}:${d.column} [${d.severity}] ${d.message}${d.source ? ` (${d.source})` : ''}`,
    );
    return lines.join('\n');
  },
};

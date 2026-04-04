import type { SkillDefinition } from '../types.js';

export const codeActionSkill: SkillDefinition = {
  id: 'code-action',
  name: 'Code Action',
  builtIn: true,
  description:
    'List or apply VS Code code actions (quick-fixes, auto-imports, refactorings) at a given location. ' +
    'Use action "list" to see available actions, then "apply" to execute one by title.',
  parameters: {
    type: 'object',
    required: ['action', 'path', 'startLine', 'startColumn'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'apply'],
        description: '"list" shows available code actions, "apply" executes one by title.',
      },
      path: {
        type: 'string',
        description: 'Absolute path to the file.',
      },
      startLine: {
        type: 'integer',
        description: '1-based start line of the target range.',
      },
      startColumn: {
        type: 'integer',
        description: '1-based start column.',
      },
      endLine: {
        type: 'integer',
        description: '1-based end line. Defaults to startLine.',
      },
      endColumn: {
        type: 'integer',
        description: '1-based end column. Defaults to startColumn.',
      },
      title: {
        type: 'string',
        description: 'The exact title of the code action to apply (required when action is "apply").',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    const filePath = params['path'];
    const rawStartLine = params['startLine'];
    const rawStartCol = params['startColumn'];

    if (typeof action !== 'string' || !['list', 'apply'].includes(action)) {
      return 'Error: "action" must be one of: list, apply.';
    }
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      return 'Error: "path" is required.';
    }
    if (typeof rawStartLine !== 'number' || rawStartLine < 1) {
      return 'Error: "startLine" is required and must be a positive integer.';
    }
    if (typeof rawStartCol !== 'number' || rawStartCol < 1) {
      return 'Error: "startColumn" is required and must be a positive integer.';
    }

    const startLine = rawStartLine;
    const startColumn = rawStartCol;
    const endLine = typeof params['endLine'] === 'number' ? params['endLine'] : startLine;
    const endColumn = typeof params['endColumn'] === 'number' ? params['endColumn'] : startColumn;

    if (action === 'list') {
      const actions = await context.getCodeActions(filePath.trim(), startLine, startColumn, endLine, endColumn);
      if (actions.length === 0) {
        return 'No code actions available at this location.';
      }
      return actions
        .map(a => {
          const preferred = a.isPreferred ? ' ★' : '';
          const kind = a.kind ? ` (${a.kind})` : '';
          return `- ${a.title}${kind}${preferred}`;
        })
        .join('\n');
    }

    // action === 'apply'
    const title = params['title'];
    if (typeof title !== 'string' || title.trim().length === 0) {
      return 'Error: "title" is required when action is "apply".';
    }

    const result = await context.applyCodeAction(
      filePath.trim(),
      startLine,
      startColumn,
      endLine,
      endColumn,
      title.trim(),
    );

    if (!result.applied) {
      return `Error: Code action not applied — ${result.reason ?? 'unknown reason'}.`;
    }
    return `Applied code action: "${title.trim()}"`;
  },
};

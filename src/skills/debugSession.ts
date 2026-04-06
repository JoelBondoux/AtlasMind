import type { SkillDefinition } from '../types.js';
import { optionalString } from './validation.js';

export const debugSessionSkill: SkillDefinition = {
  id: 'debug-session',
  name: 'Debug Session Inspector',
  builtIn: true,
  description:
    'Inspect the active VS Code debug session. Lists active sessions or evaluates an expression in the current debug context. ' +
    'Useful for reading variable values, call stack state, or debugging context without leaving the AI chat.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'evaluate'],
        description: 'Action to perform: "list" returns active debug sessions; "evaluate" evaluates an expression in the paused session.',
      },
      expression: {
        type: 'string',
        description: 'Expression to evaluate (required when action is "evaluate").',
      },
      frameId: {
        type: 'integer',
        description: 'Optional debug stack frame ID for scoped evaluation.',
      },
    },
  },
  async execute(params, context) {
    const action = typeof params['action'] === 'string' ? params['action'] : 'list';

    if (action === 'evaluate') {
      const exprErr = optionalString(params, 'expression');
      if (exprErr) { return exprErr; }
      const expression = typeof params['expression'] === 'string' ? params['expression'].trim() : '';
      if (!expression) {
        return 'Error: "expression" is required when action is "evaluate".';
      }
      const frameId = typeof params['frameId'] === 'number' ? params['frameId'] : undefined;
      return context.evaluateDebugExpression(expression, frameId);
    }

    // Default: list sessions
    const sessions = await context.getDebugSessions();
    if (sessions.length === 0) {
      return 'No active debug sessions. Start a debug session in VS Code (Run > Start Debugging).';
    }
    const lines = sessions.map(session =>
      `Session: ${session.name} (type: ${session.type}, id: ${session.id})`,
    );
    return lines.join('\n');
  },
};

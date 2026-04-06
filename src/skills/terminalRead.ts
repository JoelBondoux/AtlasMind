import type { SkillDefinition } from '../types.js';
import { optionalString } from './validation.js';

export const terminalReadSkill: SkillDefinition = {
  id: 'terminal-read',
  name: 'Read Terminal',
  builtIn: true,
  description:
    'Return information about the open VS Code integrated terminal sessions. ' +
    'If a terminal name is provided, targets that terminal; otherwise reports on the most recently active one. ' +
    'Use this to determine which terminals are open before asking the user to paste output.',
  parameters: {
    type: 'object',
    properties: {
      terminalName: {
        type: 'string',
        description: 'Optional name of the terminal to inspect. If omitted, the most recently active terminal is used.',
      },
    },
  },
  async execute(params, context) {
    const nameErr = optionalString(params, 'terminalName');
    if (nameErr) { return nameErr; }

    const terminalName = typeof params['terminalName'] === 'string' ? params['terminalName'].trim() : undefined;
    return context.getTerminalOutput(terminalName || undefined);
  },
};

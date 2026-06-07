import type { SkillDefinition } from '../types.js';
import { optionalString } from './validation.js';

export const debugLaunchSkill: SkillDefinition = {
  id: 'debug-launch',
  name: 'Debug Launcher',
  builtIn: true,
  description:
    'List and launch VS Code debug configurations defined in .vscode/launch.json. ' +
    'Use action "list" to see all available configurations with their type and request kind. ' +
    'Use action "start" with a configuration name to launch a debug session. ' +
    'Useful for starting the debugger on a specific process, test suite, or script ' +
    'without leaving the AI chat.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'start'],
        description: '"list" shows available debug configurations; "start" launches one.',
      },
      name: {
        type: 'string',
        description: 'Configuration name to launch (required when action is "start").',
      },
    },
  },
  async execute(params, context) {
    if (!context.getDebugConfigs || !context.launchDebugSession) {
      return 'Debug launcher is not available in this environment (requires VS Code extension host).';
    }

    const action = typeof params['action'] === 'string' ? params['action'] : 'list';

    if (action === 'list') {
      const configs = await context.getDebugConfigs();
      if (configs.length === 0) {
        return 'No debug configurations found. Add configurations to .vscode/launch.json to get started.';
      }
      const lines = configs.map(c => `  ${c.name} (type: ${c.type}, request: ${c.request})`);
      return `Debug configurations (${configs.length}):\n${lines.join('\n')}`;
    }

    // action === 'start'
    const nameErr = optionalString(params, 'name');
    if (nameErr) { return nameErr; }
    const configName = typeof params['name'] === 'string' ? params['name'].trim() : '';
    if (!configName) {
      return 'Error: "name" is required when action is "start".';
    }

    const result = await context.launchDebugSession(configName);
    return result.message;
  },
};

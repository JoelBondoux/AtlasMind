import type { SkillDefinition } from '../types.js';

export const gitStatusSkill: SkillDefinition = {
  id: 'git-status',
  name: 'Git Status',
  builtIn: true,
  description: 'Return git status for the current workspace repository.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const status = await context.getGitStatus();
    return status.trim().length > 0 ? status : 'Git status returned no output.';
  },
};
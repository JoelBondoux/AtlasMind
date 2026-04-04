import type { SkillDefinition } from '../types.js';

export const rollbackCheckpointSkill: SkillDefinition = {
  id: 'rollback-checkpoint',
  name: 'Rollback Checkpoint',
  builtIn: true,
  description: 'Restore the most recent automatic checkpoint captured before write-capable tool use.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_params, context) {
    const result = await context.rollbackLastCheckpoint();
    return result.summary + (result.restoredPaths.length > 0 ? `\n${result.restoredPaths.join('\n')}` : '');
  },
};

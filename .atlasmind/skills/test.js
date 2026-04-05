// AtlasMind custom skill: test
// Export module.exports.skill as a SkillDefinition object.
'use strict';

exports.skill = {
  id: 'test',
  name: 'test',
  description: 'Describe what this skill does.',
  parameters: {
    type: 'object',
    required: ['input'],
    properties: {
      input: {
        type: 'string',
        description: 'The primary input for the skill.',
      },
    },
  },
  async execute(params, context) {
    const input = String(params['input'] ?? '');
    // Replace this stub with your skill logic.
    // Use context.readFile(), context.writeFile(), context.findFiles() for workspace access.
    return `Result for: ${input}`;
  },
};

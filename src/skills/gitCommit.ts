import type { SkillDefinition } from '../types.js';

export const gitCommitSkill: SkillDefinition = {
  id: 'git-commit',
  name: 'Git Commit',
  builtIn: true,
  description: 'Create a git commit in the workspace repository with an explicit commit message.',
  parameters: {
    type: 'object',
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description: 'Commit message to pass to git commit -m.',
      },
    },
  },
  async execute(params, context) {
    const message = params['message'];
    if (typeof message !== 'string' || message.trim().length === 0) {
      return 'Error: "message" parameter is required and must be a non-empty string.';
    }

    const result = await context.runCommand('git', ['commit', '-m', message.trim()]);
    return [
      `ok: ${result.ok}`,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};
import type { SkillDefinition } from '../types.js';

export const gitCommitSkill: SkillDefinition = {
  id: 'git-commit',
  name: 'Git Commit',
  builtIn: true,
  description: 'Create a git commit with the given message. The message is passed directly to git — no shell quoting needed. Optionally stage all tracked changes first (git add -u).',
  parameters: {
    type: 'object',
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description: 'Commit message to pass to git commit -m.',
      },
      stage_tracked: {
        type: 'boolean',
        description: 'When true, run "git add -u" to stage all tracked modifications before committing. Defaults to false.',
      },
    },
  },
  async execute(params, context) {
    const message = params['message'];
    if (typeof message !== 'string' || message.trim().length === 0) {
      return 'Error: "message" parameter is required and must be a non-empty string.';
    }

    const stageTracked = params['stage_tracked'] === true;
    const lines: string[] = [];

    if (stageTracked) {
      const addResult = await context.runCommand('git', ['add', '-u']);
      lines.push(`git add -u: exit ${addResult.exitCode}`);
      if (!addResult.ok) {
        const addOut = [addResult.stdout, addResult.stderr].filter(Boolean).join('\n').trim();
        if (addOut) lines.push(addOut);
        return lines.join('\n');
      }
    }

    const result = await context.runCommand('git', ['commit', '-m', message.trim()]);
    lines.push(`git commit: exit ${result.exitCode}`);
    const out = [result.stdout, result.stderr].filter(Boolean).join(('\n')).trim();
    if (out) lines.push(out);
    return lines.join('\n');
  },
};

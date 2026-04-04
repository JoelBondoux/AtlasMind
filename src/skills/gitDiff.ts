import type { SkillDefinition } from '../types.js';

export const gitDiffSkill: SkillDefinition = {
  id: 'git-diff',
  name: 'Git Diff',
  builtIn: true,
  description: 'Return git diff output for the current workspace repository.',
  parameters: {
    type: 'object',
    properties: {
      ref: {
        type: 'string',
        description: 'Optional revision or range to diff against, e.g. "HEAD~1".',
      },
      staged: {
        type: 'boolean',
        description: 'When true, show staged changes via git diff --cached.',
      },
    },
  },
  async execute(params, context) {
    const ref = params['ref'];
    const staged = params['staged'];
    if (ref !== undefined && typeof ref !== 'string') {
      return 'Error: "ref" must be a string when provided.';
    }
    if (staged !== undefined && typeof staged !== 'boolean') {
      return 'Error: "staged" must be a boolean when provided.';
    }

    const diff = await context.getGitDiff({
      ref: typeof ref === 'string' ? ref.trim() : undefined,
      staged: staged === true,
    });
    return diff.trim().length > 0 ? diff : 'Git diff is empty.';
  },
};
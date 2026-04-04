import type { SkillDefinition } from '../types.js';

export const gitLogSkill: SkillDefinition = {
  id: 'git-log',
  name: 'Git Log',
  builtIn: true,
  description:
    'View recent commit history. Supports optional count, ref/range, and file-scoped log.',
  parameters: {
    type: 'object',
    properties: {
      maxCount: {
        type: 'integer',
        description: 'Maximum number of commits to return. Default: 20, max: 100.',
      },
      ref: {
        type: 'string',
        description: 'Branch, tag, or revision range (e.g. "main", "HEAD~5..HEAD").',
      },
      filePath: {
        type: 'string',
        description: 'Optional file path to show only commits that touched this file.',
      },
    },
  },
  async execute(params, context) {
    const rawCount = params['maxCount'];
    const maxCount = typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount > 0
      ? Math.min(rawCount, 100)
      : 20;
    const ref = typeof params['ref'] === 'string' ? params['ref'].trim() : undefined;
    const filePath = typeof params['filePath'] === 'string' ? params['filePath'].trim() : undefined;

    return context.getGitLog({ maxCount, ref, filePath });
  },
};

export const gitBranchSkill: SkillDefinition = {
  id: 'git-branch',
  name: 'Git Branch',
  builtIn: true,
  description:
    'Manage git branches: list all branches, create a new branch, switch to an existing branch, or delete a branch.',
  parameters: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'create', 'switch', 'delete'],
        description: 'The branch operation to perform.',
      },
      name: {
        type: 'string',
        description: 'Branch name (required for create, switch, and delete).',
      },
    },
  },
  async execute(params, context) {
    const action = params['action'];
    const name = params['name'];

    if (typeof action !== 'string' || !['list', 'create', 'switch', 'delete'].includes(action)) {
      return 'Error: "action" must be one of: list, create, switch, delete.';
    }
    if (action !== 'list') {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return `Error: "name" is required for the "${action}" action.`;
      }
      // Reject obviously invalid branch names
      if (/[~^:\s\\]|\.\./.test(name.trim())) {
        return 'Error: Branch name contains invalid characters.';
      }
    }

    return context.gitBranch(
      action as 'list' | 'create' | 'switch' | 'delete',
      typeof name === 'string' ? name.trim() : undefined,
    );
  },
};

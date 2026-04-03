import type { SkillDefinition } from '../types.js';

export const gitApplyPatchSkill: SkillDefinition = {
  id: 'git-apply-patch',
  name: 'Git Apply Patch',
  builtIn: true,
  description:
    'Validate or apply a unified git patch inside the current workspace repository using git apply.',
  parameters: {
    type: 'object',
    required: ['patch'],
    properties: {
      patch: {
        type: 'string',
        description: 'Unified diff / patch text to validate or apply.',
      },
      checkOnly: {
        type: 'boolean',
        description: 'When true, only validate the patch with git apply --check.',
      },
      stage: {
        type: 'boolean',
        description: 'When true, apply and stage the patch with git apply --index.',
      },
    },
  },
  async execute(params, context) {
    const patch = params['patch'];
    const checkOnly = params['checkOnly'];
    const stage = params['stage'];

    if (typeof patch !== 'string' || patch.trim().length === 0) {
      return 'Error: "patch" parameter is required and must be a non-empty string.';
    }
    if (checkOnly !== undefined && typeof checkOnly !== 'boolean') {
      return 'Error: "checkOnly" must be a boolean when provided.';
    }
    if (stage !== undefined && typeof stage !== 'boolean') {
      return 'Error: "stage" must be a boolean when provided.';
    }

    const result = await context.applyGitPatch(patch, {
      checkOnly: checkOnly === true,
      stage: stage === true,
    });

    if (!result.ok) {
      return `Patch failed: ${result.stderr || result.stdout || 'git apply rejected the patch.'}`;
    }

    if (checkOnly === true) {
      return 'Patch validated successfully.';
    }

    const suffix = stage === true ? ' and staged' : '';
    const detail = result.stdout || result.stderr;
    return `Patch applied${suffix} successfully.` + (detail ? `\n${detail}` : '');
  },
};

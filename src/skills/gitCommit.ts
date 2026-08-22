import type { SkillDefinition } from '../types.js';

const GIT_COMMIT_COMMAND_TIMEOUT_MS = 120_000;
const GIT_COMMIT_SKILL_TIMEOUT_MS = 125_000;
const MAX_COMMIT_PATHS = 100;

function validateCommitPaths(value: unknown): { paths?: string[]; error?: string } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMIT_PATHS) {
    return { error: `Error: "paths" must contain between 1 and ${MAX_COMMIT_PATHS} explicitly named workspace paths.` };
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate !== candidate.trim()) {
      return { error: 'Error: every commit path must be a non-empty string without leading or trailing whitespace.' };
    }
    const normalized = candidate.replace(/\\/g, '/');
    const segments = normalized.split('/');
    const unsafe = normalized === '.'
      || normalized === './'
      || normalized.startsWith('/')
      || /^[a-z]:\//i.test(normalized)
      || normalized.startsWith('//')
      || normalized.startsWith(':')
      || segments.includes('..')
      || /[\u0000-\u001f\u007f*?[\]]/.test(normalized);
    if (unsafe) {
      return {
        error: `Error: commit path "${candidate.slice(0, 160)}" is broad or unsafe. Name exact workspace-relative paths; '.', parent traversal, absolute paths, and pathspec wildcards are refused.`,
      };
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      paths.push(normalized);
    }
  }
  return { paths };
}

export const gitCommitSkill: SkillDefinition = {
  id: 'git-commit',
  name: 'Git Commit',
  builtIn: true,
  // Committing may run repository-defined hooks (compile, lint, tests, etc.).
  // Give the complete guarded operation the same bounded window as test-run.
  timeoutMs: GIT_COMMIT_SKILL_TIMEOUT_MS,
  description: 'Create a git commit with the given message. The message is passed directly to git — no shell quoting needed. Prefer paths to stage and commit only explicitly named tracked or untracked files, preserving unrelated index entries; the broad legacy stage_tracked mode stages all tracked modifications with git add -u.',
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
      paths: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_COMMIT_PATHS,
        items: { type: 'string' },
        description: 'Workspace-relative paths to stage and commit exclusively, including untracked files. Existing staged changes outside this list remain staged and are not committed. Broad paths such as ".", traversal, absolute paths, and wildcards are refused. Cannot be combined with stage_tracked.',
      },
    },
  },
  async execute(params, context) {
    const message = params['message'];
    if (typeof message !== 'string' || message.trim().length === 0) {
      return 'Error: "message" parameter is required and must be a non-empty string.';
    }

    const stageTracked = params['stage_tracked'] === true;
    const validatedPaths = validateCommitPaths(params['paths']);
    if (validatedPaths.error) {
      return validatedPaths.error;
    }
    const paths = validatedPaths.paths;
    if (stageTracked && paths) {
      return 'Error: "paths" and "stage_tracked" cannot be combined. Use exact paths for a scoped commit, or stage_tracked for the legacy all-tracked mode.';
    }
    const lines: string[] = [];

    if (paths || stageTracked) {
      const addArgs = paths ? ['add', '--', ...paths] : ['add', '-u'];
      const addResult = await context.runCommand('git', addArgs, { timeoutMs: GIT_COMMIT_COMMAND_TIMEOUT_MS });
      lines.push(`${paths ? `git add (${paths.length} exact path${paths.length === 1 ? '' : 's'})` : 'git add -u'}: exit ${addResult.exitCode}`);
      if (!addResult.ok) {
        const addOut = [addResult.stdout, addResult.stderr].filter(Boolean).join('\n').trim();
        if (addOut) lines.push(addOut);
        return lines.join('\n');
      }
    }

    const commitArgs = paths
      ? ['commit', '--only', '-m', message.trim(), '--', ...paths]
      : ['commit', '-m', message.trim()];
    const result = await context.runCommand('git', commitArgs, { timeoutMs: GIT_COMMIT_COMMAND_TIMEOUT_MS });
    lines.push(`git commit: exit ${result.exitCode}`);
    const out = [result.stdout, result.stderr].filter(Boolean).join(('\n')).trim();
    if (out) lines.push(out);
    return lines.join('\n');
  },
};

import type { SkillDefinition } from '../types.js';

const ALLOWED_COMMANDS = new Set([
  'git',
  'node',
  'npm',
  'npm.cmd',
  'npx',
  'npx.cmd',
  'pnpm',
  'pnpm.cmd',
  'yarn',
  'yarn.cmd',
  'tsc',
  'tsc.cmd',
  'eslint',
  'eslint.cmd',
  'vitest',
  'vitest.cmd',
]);

export const terminalRunSkill: SkillDefinition = {
  id: 'terminal-run',
  name: 'Run Terminal Command',
  builtIn: true,
  description:
    'Run an allow-listed subprocess without shell interpolation. ' +
    'This is intended for verification workflows such as git status, tests, lint, and builds.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'Executable name, e.g. "git", "npm", "node", or "vitest".',
      },
      args: {
        type: 'array',
        description: 'Argument list passed directly to the executable with no shell parsing.',
      },
      cwd: {
        type: 'string',
        description: 'Optional absolute working directory inside the workspace.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Optional timeout in milliseconds.',
      },
    },
  },
  async execute(params, context) {
    const command = params['command'];
    const args = params['args'];
    const cwd = params['cwd'];
    const timeoutMs = params['timeoutMs'];

    if (typeof command !== 'string' || command.trim().length === 0) {
      return 'Error: "command" parameter is required and must be a non-empty string.';
    }
    if (!ALLOWED_COMMANDS.has(command.trim())) {
      return `Error: Command "${command.trim()}" is not on the allow-list.`;
    }
    if (args !== undefined && (!Array.isArray(args) || args.some(value => typeof value !== 'string'))) {
      return 'Error: "args" must be an array of strings when provided.';
    }
    if (cwd !== undefined && typeof cwd !== 'string') {
      return 'Error: "cwd" must be a string when provided.';
    }
    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1000)) {
      return 'Error: "timeoutMs" must be an integer >= 1000 when provided.';
    }

    const result = await context.runCommand(
      command.trim(),
      Array.isArray(args) ? args.filter((value): value is string => typeof value === 'string') : [],
      {
        cwd: typeof cwd === 'string' ? cwd.trim() : undefined,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
      },
    );

    return [
      `ok: ${result.ok}`,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};
import type { SkillDefinition } from '../types.js';
import { requireString, optionalString, optionalStringArray, optionalIntMin } from './validation.js';

/** Commands that auto-approve with no user confirmation. */
const AUTO_APPROVE_COMMANDS = new Set([
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
  // Build & language tools
  'python',
  'python3',
  'pip',
  'pip3',
  'cargo',
  'rustc',
  'dotnet',
  'go',
  'make',
  'cmake',
  'mvn',
  'gradle',
  'javac',
  'java',
  'ruby',
  'bundle',
  'swift',
  'swiftc',
  'deno',
  'bun',
]);

/** Commands that are blocked outright — never executed. */
const BLOCKED_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del',
  'format',
  'fdisk',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'kill',
  'killall',
  'taskkill',
  'curl',
  'wget',
  'ssh',
  'scp',
  'telnet',
  'nc',
  'ncat',
  'netcat',
  'powershell',
  'pwsh',
  'cmd',
  'bash',
  'sh',
  'zsh',
  'fish',
]);

/** Combined set for quick lookup. */
const ALLOWED_COMMANDS = AUTO_APPROVE_COMMANDS;

const BLOCKED_ARGUMENT_FLAGS = new Map<string, ReadonlyArray<string>>([
  ['node', ['-e', '--eval', '-p', '--print', '-r', '--require']],
  ['python', ['-c']],
  ['python3', ['-c']],
  ['ruby', ['-e']],
  ['deno', ['eval']],
  ['bun', ['eval']],
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
        items: { type: 'string' },
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
    const cmdErr = requireString(params, 'command');
    if (cmdErr) { return cmdErr; }
    const argsErr = optionalStringArray(params, 'args');
    if (argsErr) { return argsErr; }
    const cwdErr = optionalString(params, 'cwd');
    if (cwdErr) { return cwdErr; }
    const timeoutErr = optionalIntMin(params, 'timeoutMs', 1000);
    if (timeoutErr) { return timeoutErr; }

    const args = params['args'];
    const cwd = params['cwd'];
    const timeoutMs = params['timeoutMs'];
    const cmd = (params['command'] as string).trim();
    if (BLOCKED_COMMANDS.has(cmd)) {
      return `Error: Command "${cmd}" is blocked for safety reasons.`;
    }
    if (!ALLOWED_COMMANDS.has(cmd)) {
      return `Error: Command "${cmd}" is not on the allow-list. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}.`;
    }

    const filteredArgs = Array.isArray(args)
      ? args.filter((value): value is string => typeof value === 'string')
      : [];
    const blockedReason = getBlockedArgumentReason(cmd, filteredArgs);
    if (blockedReason) {
      return blockedReason;
    }

    const result = await context.runCommand(
      cmd,
      filteredArgs,
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

function getBlockedArgumentReason(command: string, args: string[]): string | undefined {
  const loweredArgs = args.map(value => value.trim().toLowerCase());
  const blockedFlags = BLOCKED_ARGUMENT_FLAGS.get(command);
  if (!blockedFlags) {
    return undefined;
  }

  const blockedFlag = loweredArgs.find(value => blockedFlags.includes(value));
  if (!blockedFlag) {
    return undefined;
  }

  return (
    `Error: Command "${command}" with argument "${blockedFlag}" is blocked because ` +
    'inline interpreter execution is not allowed through terminal-run.'
  );
}
import type { ToolApprovalMode, ToolInvocationPolicy } from '../types.js';

export function getToolApprovalMode(value: string | undefined): ToolApprovalMode {
  switch (value) {
    case 'always-ask':
    case 'ask-on-write':
    case 'ask-on-external':
    case 'allow-safe-readonly':
      return value;
    default:
      return 'ask-on-write';
  }
}

export function classifyToolInvocation(
  toolName: string,
  args: Record<string, unknown>,
): ToolInvocationPolicy {
  switch (toolName) {
    case 'file-read':
    case 'file-search':
    case 'text-search':
    case 'directory-list':
    case 'memory-query':
    case 'git-status':
    case 'git-diff':
      return { category: toolName.startsWith('git-') ? 'git-read' : 'read', risk: 'low', summary: `run ${toolName}` };

    case 'file-write':
    case 'file-edit':
    case 'memory-write':
    case 'git-apply-patch':
      return { category: 'workspace-write', risk: 'high', summary: `modify workspace files using ${toolName}` };

    case 'git-commit':
      return { category: 'git-write', risk: 'high', summary: 'create a git commit in the workspace repository' };

    case 'rollback-checkpoint':
      return { category: 'workspace-write', risk: 'high', summary: 'restore the most recent automatic checkpoint' };

    case 'terminal-run':
      return classifyTerminalInvocation(args);

    default:
      return { category: 'network', risk: 'high', summary: `invoke external tool ${toolName}` };
  }
}

export function requiresToolApproval(mode: ToolApprovalMode, policy: ToolInvocationPolicy): boolean {
  switch (mode) {
    case 'always-ask':
      return true;
    case 'ask-on-write':
      return policy.category !== 'read' && policy.category !== 'git-read';
    case 'ask-on-external':
      return policy.category === 'terminal-read' || policy.category === 'terminal-write' ||
        policy.category === 'network' || policy.category === 'audio-input' || policy.category === 'audio-output';
    case 'allow-safe-readonly':
      return policy.category !== 'read' && policy.category !== 'git-read' && policy.category !== 'terminal-read';
  }
}

function classifyTerminalInvocation(args: Record<string, unknown>): ToolInvocationPolicy {
  const command = typeof args['command'] === 'string' ? args['command'].toLowerCase().trim() : '';
  const rawArgs = Array.isArray(args['args'])
    ? args['args'].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
    : [];

  if (command === 'git') {
    const gitSubcommand = rawArgs[0] ?? '';
    if (['status', 'diff', 'show', 'log', 'rev-parse', 'branch'].includes(gitSubcommand)) {
      return { category: 'terminal-read', risk: 'medium', summary: `run git ${gitSubcommand}` };
    }
    return { category: 'terminal-write', risk: 'high', summary: `run git ${gitSubcommand || 'command'}` };
  }

  if (['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'npx', 'npx.cmd'].includes(command)) {
    const script = rawArgs[0] ?? '';
    const action = rawArgs[1] ?? '';
    if ((script === 'run' && ['test', 'lint', 'build', 'check', 'typecheck'].includes(action)) ||
      (script === 'test') ||
      (script === 'exec' && rawArgs.includes('vitest'))) {
      return { category: 'terminal-read', risk: 'medium', summary: `run ${command.replace('.cmd', '')} ${rawArgs.join(' ')}` };
    }
    return { category: 'terminal-write', risk: 'high', summary: `run ${command.replace('.cmd', '')} ${rawArgs.join(' ')}` };
  }

  if (['node', 'tsc', 'tsc.cmd', 'eslint', 'eslint.cmd', 'vitest', 'vitest.cmd'].includes(command)) {
    return { category: 'terminal-read', risk: 'medium', summary: `run ${command.replace('.cmd', '')} ${rawArgs.join(' ')}`.trim() };
  }

  return { category: 'terminal-write', risk: 'high', summary: `run ${command || 'a subprocess'}` };
}
import type { ToolApprovalMode, ToolInvocationPolicy } from '../types.js';
import { parseGhInvocation } from '../skills/terminalRun.js';

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
    case 'specialist-guidance':
      return { category: toolName.startsWith('git-') ? 'git-read' : 'read', risk: 'low', summary: `run ${toolName}` };

    case 'file-write':
    case 'file-edit':
    case 'file-move':
    case 'file-delete':
    case 'memory-write':
    case 'git-apply-patch':
      return { category: 'workspace-write', risk: 'high', summary: `modify workspace files using ${toolName}` };

    case 'git-commit':
      return { category: 'git-write', risk: 'high', summary: 'create a git commit in the workspace repository' };

    case 'rollback-checkpoint':
      return { category: 'workspace-write', risk: 'high', summary: 'restore the most recent automatic checkpoint' };

    // A handoff performs nothing itself — it runs another model, and every tool
    // that model reaches for goes through this same gate on its own account. So
    // the risk being approved here is *spend*, not action, and the summary says
    // so: somebody deciding whether to allow it needs to know that saying yes
    // does not pre-approve whatever the delegate goes on to do.
    //
    // Classified explicitly rather than left to the unknown-tool fallback, which
    // would call it `network` — safe, but a label that would tell a user their
    // assistant was about to reach the internet, which it is not.
    case 'agent-handoff':
      return {
        category: 'read',
        risk: 'medium',
        summary: `ask ${typeof args['agent_id'] === 'string' ? args['agent_id'] : 'another agent'} a question`
          + ' (it runs with your permissions; its own tool use is approved separately)',
      };

    case 'terminal-run':
      return classifyTerminalInvocation(args);

    case 'docker-cli':
      return classifyDockerInvocation(args);

    default:
      return classifyUnknownToolName(toolName);
  }
}

export function requiresToolApproval(mode: ToolApprovalMode, policy: ToolInvocationPolicy): boolean {
  switch (mode) {
    case 'always-ask':
      return true;
    case 'ask-on-write':
      // `network-read` passes: it mutates nothing, which is the question this
      // mode asks. `ask-on-external` is the mode that cares that it left the
      // machine, and it still gates it below.
      return policy.category !== 'read' && policy.category !== 'git-read' && policy.category !== 'network-read';
    case 'ask-on-external':
      return policy.category === 'terminal-read' || policy.category === 'terminal-write' ||
        policy.category === 'network' || policy.category === 'network-read' ||
        policy.category === 'audio-input' || policy.category === 'audio-output';
    case 'allow-safe-readonly':
      return policy.category !== 'read' && policy.category !== 'git-read' && policy.category !== 'terminal-read';
  }
}

// READ_LIKE_PREFIXES: tool names that start with these words are likely read-only.
// Err on the side of inclusion to avoid false positives — mis-classifying a write as
// read is worse than showing an approval prompt for a safe read.
const READ_LIKE_PREFIXES = ['get', 'list', 'read', 'search', 'find', 'query', 'fetch',
  'check', 'show', 'view', 'inspect', 'describe', 'status', 'info', 'lookup', 'count'] as const;

const WRITE_LIKE_SUBSTRINGS = ['write', 'create', 'update', 'delete', 'remove', 'set',
  'post', 'put', 'patch', 'insert', 'upsert', 'push', 'send', 'publish', 'execute',
  'exec', 'run', 'invoke', 'deploy', 'drop', 'truncate'] as const;

/**
 * Strip the `mcp:<server>:` namespace before judging a tool by its name.
 *
 * `READ_LIKE_PREFIXES` matches with `startsWith`, and **every** MCP tool arrives
 * here as `mcp:<server>:<tool>` — so the read list was unreachable for exactly
 * the tools it was written for, and `mcp:supabase:list_tables` graded `network`
 * / high, identically to a delete. With a couple of servers connected, a single
 * question became a wall of dialogs, which is how an approval mode stops meaning
 * anything.
 */
function toolNameForClassification(toolName: string): string {
  const mcp = /^mcp:[^:]+:(.+)$/.exec(toolName);
  return (mcp?.[1] ?? toolName).toLowerCase().replace(/[-_]/g, '-');
}

function classifyUnknownToolName(toolName: string): ToolInvocationPolicy {
  const n = toolNameForClassification(toolName);
  const remote = toolName.startsWith('mcp:');

  // Anything with a write-like token wins over read-like prefix to stay safe.
  if (WRITE_LIKE_SUBSTRINGS.some(sub => n.includes(sub))) {
    return { category: 'network', risk: 'high', summary: `invoke external tool ${toolName}` };
  }

  // A read verb anywhere in the name counts — but only for a namespaced MCP
  // tool, and only into `network-read`.
  //
  // MCP servers put the verb wherever it reads best (`microsoft_docs_search`,
  // `outlook_email_search`, `hub_repo_details`), so a prefix test misses most of
  // them. Local tools keep the prefix rule, because widening it there promotes
  // things that genuinely reach out: `web-fetch` contains "fetch" and would
  // become a plain local read, which is how a CLI gate that permits only
  // read-only tooling would start permitting network calls.
  const segments = n.split('-');
  const namedAsRead = remote
    ? READ_LIKE_PREFIXES.some(prefix => n.startsWith(prefix) || segments.includes(prefix))
    : READ_LIKE_PREFIXES.some(prefix => n.startsWith(prefix));

  if (namedAsRead) {
    // A remote read is `network-read`, never plain `read`: it mutates nothing,
    // but it always leaves the machine, and often carries the operator's data
    // out with it.
    return remote
      ? { category: 'network-read', risk: 'low', summary: `read from external tool ${toolName}` }
      : { category: 'read', risk: 'low', summary: `run ${toolName}` };
  }

  return { category: 'network', risk: 'high', summary: `invoke external tool ${toolName}` };
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

  if (command === 'gh') {
    return classifyGhInvocation(rawArgs);
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

  if (command === 'node') {
    const safeNodeArgs = rawArgs.every(arg => ['--version', '-v', '--help', '-h'].includes(arg));
    if (safeNodeArgs) {
      return { category: 'terminal-read', risk: 'medium', summary: `run ${command} ${rawArgs.join(' ')}`.trim() };
    }
    return { category: 'terminal-write', risk: 'high', summary: `run ${command} ${rawArgs.join(' ')}`.trim() };
  }

  if (['node', 'tsc', 'tsc.cmd', 'eslint', 'eslint.cmd', 'vitest', 'vitest.cmd'].includes(command)) {
    return { category: 'terminal-read', risk: 'medium', summary: `run ${command.replace('.cmd', '')} ${rawArgs.join(' ')}`.trim() };
  }

  return { category: 'terminal-write', risk: 'high', summary: `run ${command || 'a subprocess'}` };
}

/**
 * `gh <namespace> <verb>` graded read or write, as `git` is.
 *
 * The verb decides, not the namespace: `gh pr list` and `gh pr merge` differ by
 * everything that matters. Grading by namespace would have put reading a pull
 * request behind the same gate as merging one, which is the kind of friction
 * that gets a gate switched off wholesale.
 *
 * **Unrecognised is write.** A `gh` release adds subcommands regularly, and an
 * unknown verb is exactly the case where guessing "probably a read" is the
 * expensive mistake. `gh api` is always a write for the same reason — it is
 * arbitrary, and `gh api -X DELETE …` is a perfectly ordinary invocation of it.
 *
 * Note this only decides *friction*, never permission: the genuinely dangerous
 * subcommands never reach here, having been refused outright in `terminalRun`.
 */
const GH_READ_VERBS: ReadonlyArray<string> = ['list', 'view', 'status', 'diff', 'checks', 'download'];

/** Namespaces whose bare form (`gh <namespace>`, no verb) is a listing. */
const GH_BARE_READ_NAMESPACES: ReadonlyArray<string> = ['status', 'browse'];

function classifyGhInvocation(rawArgs: ReadonlyArray<string>): ToolInvocationPolicy {
  // Located by namespace rather than by index, for the reason given on
  // `parseGhInvocation`: a global flag taking a value shifts every positional
  // along, and reading the namespace out of slot 0 would then grade the wrong
  // thing — in the permissive direction, which is the direction that matters.
  const { namespace, verb } = parseGhInvocation(rawArgs);
  const label = [namespace, verb].filter(Boolean).join(' ') || 'command';

  if (namespace === 'api') {
    return { category: 'terminal-write', risk: 'high', summary: `run gh api (arbitrary request)` };
  }

  if (!verb && GH_BARE_READ_NAMESPACES.includes(namespace)) {
    return { category: 'terminal-read', risk: 'medium', summary: `run gh ${namespace}` };
  }

  if (GH_READ_VERBS.includes(verb)) {
    return { category: 'terminal-read', risk: 'medium', summary: `run gh ${label}` };
  }

  return { category: 'terminal-write', risk: 'high', summary: `run gh ${label}` };
}

function classifyDockerInvocation(args: Record<string, unknown>): ToolInvocationPolicy {
  const rawArgs = Array.isArray(args['args'])
    ? args['args'].filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase().trim())
    : [];

  const command = rawArgs[0] ?? '';
  const composeSubcommand = rawArgs[1] ?? '';

  if (['version', 'info', 'ps', 'images', 'inspect', 'logs'].includes(command)) {
    return { category: 'terminal-read', risk: 'medium', summary: `run docker ${command}` };
  }

  if (['start', 'stop', 'restart'].includes(command)) {
    return { category: 'terminal-write', risk: 'high', summary: `run docker ${command}` };
  }

  if (command === 'compose') {
    if (['ps', 'config', 'logs'].includes(composeSubcommand)) {
      return { category: 'terminal-read', risk: 'medium', summary: `run docker compose ${composeSubcommand}` };
    }
    if (['up', 'down', 'build', 'pull', 'start', 'stop', 'restart'].includes(composeSubcommand)) {
      return { category: 'terminal-write', risk: 'high', summary: `run docker compose ${composeSubcommand}` };
    }
  }

  return { category: 'terminal-write', risk: 'high', summary: 'run docker command' };
}

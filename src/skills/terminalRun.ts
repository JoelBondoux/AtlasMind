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
  // Mobile
  'flutter',
  'dart',
  'expo',
  'react-native',
  // PHP / Composer
  'php',
  'composer',
  'composer.phar',
  // Elixir / Erlang
  'mix',
  'elixir',
  'elixirc',
  'iex',
  // Ruby
  'gem',
  // Infrastructure
  'terraform',
  'terraform.exe',
  'helm',
  'kubectl',
  // Additional JS runtimes / package managers
  'corepack',
  'turbo',
  'nx',
  'lerna',
  // Packaging
  'vsce',
  'electron-builder',
  // Game engines (CLIs)
  'godot',
  'godot4',
  // GitHub CLI.
  //
  // Its absence was not a policy, it was a gap — and an expensive one. The
  // planner instructs agents to reach for `gh pr list`, `gh pr view` and
  // `gh pr merge` (see DEPENDENCY_GOVERNANCE_HINT), the `github-operator` agent
  // is advertised for pull-request and issue work, and the guided workflow is
  // built around GitHub. All of it terminated here, in a refusal the operator
  // never saw: the error goes back to the model, not to the chat surface, and
  // the agentic loop then discarded the model's explanation along with it. From
  // the chair it looked like AtlasMind losing interest in GitHub work.
  //
  // Subcommands are graded in `toolPolicy.ts` exactly as `git`'s are — reads are
  // low-friction, writes go through the approval gate — and the genuinely
  // dangerous ones are refused outright below, whatever the setting.
  'gh',
]);

/**
 * `gh` subcommands refused whatever the approval setting, keyed by the first
 * argument, with an optional second-argument narrowing.
 *
 * These are not "risky writes" — the approval gate exists for those. Each of
 * these is something no chat turn should be able to do at all:
 *
 * - `auth token` prints the GitHub token to stdout, which `terminal-run` returns
 *   as tool output, which becomes model context. That is credential
 *   exfiltration through a tool whose whole purpose is returning what it read,
 *   and no approval prompt makes it safe.
 * - `auth login`/`logout`/`refresh` and the key namespaces change how the
 *   machine authenticates, well outside the workspace this tool is sandboxed to.
 * - `secret` and `variable` write repository credentials, and `secret list`
 *   is not separated out because the namespace is small and deny-by-default is
 *   the cheaper mistake here.
 * - `repo delete` is irreversible and remote.
 */
const BLOCKED_GH_SUBCOMMANDS: ReadonlyArray<{ command: string; sub?: string; why: string }> = [
  { command: 'auth', sub: 'token', why: 'it would print your GitHub token into model context' },
  { command: 'auth', sub: 'login', why: 'authentication is changed by you, not by a chat turn' },
  { command: 'auth', sub: 'logout', why: 'authentication is changed by you, not by a chat turn' },
  { command: 'auth', sub: 'refresh', why: 'authentication is changed by you, not by a chat turn' },
  { command: 'auth', sub: 'setup-git', why: 'authentication is changed by you, not by a chat turn' },
  { command: 'secret', why: 'it reads or writes repository credentials' },
  { command: 'variable', why: 'it writes repository configuration outside this workspace' },
  { command: 'ssh-key', why: 'it changes how this machine authenticates' },
  { command: 'gpg-key', why: 'it changes how this machine authenticates' },
  { command: 'alias', why: 'it would redefine what a later gh command does' },
  { command: 'repo', sub: 'delete', why: 'it is irreversible and cannot be undone from here' },
];

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

    const blockedGhReason = getBlockedGhReason(cmd, filteredArgs);
    if (blockedGhReason) {
      return blockedGhReason;
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

/**
 * `gh`'s top-level command names, used to find where the subcommand actually
 * starts.
 *
 * Taking the first two non-flag arguments is not good enough: a global flag that
 * takes a value (`gh --hostname github.com auth token`) puts its value in the
 * first positional slot and shifts everything along, so index-based matching
 * reads the namespace as "github.com" and waves the command through. Anchoring
 * on a known namespace instead is both flag-proof and precise — it will not fire
 * on `gh issue create --title auth --body token`, where "auth" and "token" are
 * adjacent positionals but the namespace is plainly `issue`.
 */
const GH_NAMESPACES: ReadonlySet<string> = new Set([
  'alias', 'api', 'attestation', 'auth', 'browse', 'cache', 'codespace', 'completion',
  'config', 'extension', 'gist', 'gpg-key', 'issue', 'label', 'org', 'pr', 'project',
  'release', 'repo', 'ruleset', 'run', 'search', 'secret', 'ssh-key', 'status',
  'variable', 'workflow',
]);

/** The namespace and verb of a `gh` invocation, located rather than indexed. */
export function parseGhInvocation(args: ReadonlyArray<string>): { namespace: string; verb: string } {
  const positional = args
    .map(value => value.trim().toLowerCase())
    .filter(value => value.length > 0 && !value.startsWith('-'));
  const index = positional.findIndex(value => GH_NAMESPACES.has(value));
  if (index < 0) {
    return { namespace: '', verb: '' };
  }
  return { namespace: positional[index]!, verb: positional[index + 1] ?? '' };
}

/** Refuse a `gh` subcommand that is dangerous regardless of approval. */
export function getBlockedGhReason(command: string, args: string[]): string | undefined {
  if (command !== 'gh') {
    return undefined;
  }

  const { namespace, verb } = parseGhInvocation(args);
  if (!namespace) {
    return undefined;
  }

  const blocked = BLOCKED_GH_SUBCOMMANDS.find(entry =>
    entry.command === namespace && (entry.sub === undefined || entry.sub === verb));
  if (!blocked) {
    return undefined;
  }

  const label = blocked.sub ? `${blocked.command} ${blocked.sub}` : blocked.command;
  return `Error: "gh ${label}" is blocked for safety reasons because ${blocked.why}. Run it yourself if you need it.`;
}

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
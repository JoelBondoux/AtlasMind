import type { SkillDefinition } from '../types.js';
import { optionalIntMin, optionalString } from './validation.js';

type ParsedArgs = {
  positionals: string[];
};

type DockerArgSpec = {
  booleanFlags?: ReadonlySet<string>;
  valueFlags?: ReadonlySet<string>;
  minPositionals?: number;
  maxPositionals?: number;
};

const READ_ONLY_COMMANDS = [
  'version',
  'info',
  'ps',
  'images',
  'inspect',
  'logs',
  'compose ps',
  'compose config',
  'compose logs',
].join(', ');

const WRITE_COMMANDS = [
  'start',
  'stop',
  'restart',
  'compose up',
  'compose down',
  'compose build',
  'compose pull',
  'compose start',
  'compose stop',
  'compose restart',
].join(', ');

export const dockerCliSkill: SkillDefinition = {
  id: 'docker-cli',
  name: 'Docker CLI',
  builtIn: true,
  timeoutMs: 300_000,
  description:
    'Inspect and manage Docker containers through a strict allow-list. ' +
    'Supports read-only Docker inspection plus controlled Docker Compose lifecycle actions for workspace-local development environments.',
  parameters: {
    type: 'object',
    required: ['args'],
    properties: {
      args: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Arguments passed to the docker executable, for example ["ps"], ["logs", "api", "--tail", "200"], or ["compose", "up", "-d"].',
      },
      cwd: {
        type: 'string',
        description: 'Optional absolute working directory inside the workspace. Useful for docker compose commands.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Optional timeout in milliseconds. Defaults to the Docker skill timeout ceiling.',
      },
    },
  },
  async execute(params, context) {
    const argsErr = requireDockerArgs(params);
    if (argsErr) { return argsErr; }
    const cwdErr = optionalString(params, 'cwd');
    if (cwdErr) { return cwdErr; }
    const timeoutErr = optionalIntMin(params, 'timeoutMs', 1000);
    if (timeoutErr) { return timeoutErr; }

    const args = (params['args'] as string[])
      .map(value => value.trim())
      .filter(value => value.length > 0);
    const validationError = validateDockerArgs(args);
    if (validationError) { return validationError; }

    const result = await context.runCommand('docker', args, {
      cwd: typeof params['cwd'] === 'string' ? params['cwd'].trim() : undefined,
      timeoutMs: typeof params['timeoutMs'] === 'number' ? params['timeoutMs'] : undefined,
    });

    return [
      `ok: ${result.ok}`,
      `exitCode: ${result.exitCode}`,
      result.stdout ? `stdout:\n${result.stdout}` : 'stdout: (empty)',
      result.stderr ? `stderr:\n${result.stderr}` : 'stderr: (empty)',
    ].join('\n');
  },
};

function requireDockerArgs(params: Record<string, unknown>): string | undefined {
  const value = params['args'];
  if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string')) {
    return 'Error: "args" parameter is required and must be a non-empty array of strings.';
  }
  return undefined;
}

function validateDockerArgs(rawArgs: string[]): string | undefined {
  if (rawArgs.length === 0) {
    return 'Error: Docker arguments are required.';
  }

  const [command, ...rest] = rawArgs;
  switch (command) {
    case 'version':
      return validateSimpleCommand('docker version', rest, {
        valueFlags: new Set(['--format']),
        maxPositionals: 0,
      });
    case 'info':
      return validateSimpleCommand('docker info', rest, {
        valueFlags: new Set(['--format']),
        maxPositionals: 0,
      });
    case 'ps':
      return validateSimpleCommand('docker ps', rest, {
        booleanFlags: new Set(['-a', '--all', '--no-trunc', '-q', '--quiet', '--size']),
        valueFlags: new Set(['--filter', '--format', '--last']),
      });
    case 'images':
      return validateSimpleCommand('docker images', rest, {
        booleanFlags: new Set(['-a', '--all', '--digests', '--no-trunc', '-q', '--quiet']),
        valueFlags: new Set(['--filter', '--format']),
      });
    case 'inspect':
      return validateSimpleCommand('docker inspect', rest, {
        valueFlags: new Set(['--format', '--type']),
        minPositionals: 1,
      });
    case 'logs':
      return validateSimpleCommand('docker logs', rest, {
        booleanFlags: new Set(['--details', '--timestamps']),
        valueFlags: new Set(['--tail', '--since', '--until']),
        minPositionals: 1,
      });
    case 'start':
      return validateSimpleCommand('docker start', rest, { minPositionals: 1 });
    case 'stop':
    case 'restart':
      return validateSimpleCommand(`docker ${command}`, rest, {
        valueFlags: new Set(['--time']),
        minPositionals: 1,
      });
    case 'compose':
      return validateComposeArgs(rest);
    default:
      return unsupportedDockerCommandError(command);
  }
}

function validateComposeArgs(args: string[]): string | undefined {
  if (args.length === 0) {
    return unsupportedDockerCommandError('compose');
  }

  const [command, ...rest] = args;
  switch (command) {
    case 'ps':
      return validateSimpleCommand('docker compose ps', rest, {
        booleanFlags: new Set(['-a', '--all', '--services', '-q', '--quiet']),
        valueFlags: new Set(['--filter', '--format', '--status']),
      });
    case 'config':
      return validateSimpleCommand('docker compose config', rest, {
        booleanFlags: new Set(['--services', '--volumes', '--profiles', '--images', '--no-interpolate', '--quiet']),
        valueFlags: new Set(['--format']),
      });
    case 'logs':
      return validateSimpleCommand('docker compose logs', rest, {
        booleanFlags: new Set(['--timestamps', '--no-color', '--no-log-prefix']),
        valueFlags: new Set(['--tail', '--since']),
      });
    case 'up':
      return validateSimpleCommand('docker compose up', rest, {
        booleanFlags: new Set(['-d', '--detach', '--build', '--wait', '--no-build', '--no-recreate', '--force-recreate', '--remove-orphans']),
        valueFlags: new Set(['--pull', '--scale', '--timeout']),
      });
    case 'down':
      return validateSimpleCommand('docker compose down', rest, {
        booleanFlags: new Set(['--remove-orphans']),
        valueFlags: new Set(['--timeout']),
      });
    case 'build':
      return validateSimpleCommand('docker compose build', rest, {
        booleanFlags: new Set(['--pull', '--no-cache']),
        valueFlags: new Set(['--build-arg']),
      });
    case 'pull':
      return validateSimpleCommand('docker compose pull', rest, {
        booleanFlags: new Set(['--ignore-buildable', '--include-deps']),
      });
    case 'start':
      return validateSimpleCommand('docker compose start', rest);
    case 'stop':
    case 'restart':
      return validateSimpleCommand(`docker compose ${command}`, rest, {
        valueFlags: new Set(['--timeout']),
      });
    default:
      return unsupportedDockerCommandError(`compose ${command}`);
  }
}

function validateSimpleCommand(label: string, args: string[], spec: DockerArgSpec = {}): string | undefined {
  const parseResult = parseArgs(label, args, spec);
  if (typeof parseResult === 'string') {
    return parseResult;
  }

  if (parseResult.positionals.some(value => value.startsWith('-'))) {
    return `Error: ${label} contains an invalid positional argument.`;
  }

  return undefined;
}

function parseArgs(label: string, args: string[], spec: DockerArgSpec): ParsedArgs | string {
  const booleanFlags = spec.booleanFlags ?? new Set<string>();
  const valueFlags = spec.valueFlags ?? new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]?.trim();
    if (!token) {
      return `Error: ${label} contains an empty argument.`;
    }

    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    if (booleanFlags.has(token)) {
      continue;
    }

    const inlineValueFlag = [...valueFlags].find(flag => token === flag || token.startsWith(`${flag}=`));
    if (!inlineValueFlag) {
      return `Error: ${label} does not allow the flag "${token}".`;
    }

    if (token.includes('=')) {
      const [, value] = token.split(/=(.*)/s, 2);
      if (!value || value.trim().length === 0) {
        return `Error: ${label} requires a non-empty value for "${inlineValueFlag}".`;
      }
      continue;
    }

    const next = args[index + 1]?.trim();
    if (!next || next.startsWith('-')) {
      return `Error: ${label} requires a non-empty value for "${inlineValueFlag}".`;
    }
    index += 1;
  }

  const minPositionals = spec.minPositionals ?? 0;
  if (positionals.length < minPositionals) {
    return `Error: ${label} requires at least ${minPositionals} positional argument${minPositionals === 1 ? '' : 's'}.`;
  }

  if (typeof spec.maxPositionals === 'number' && positionals.length > spec.maxPositionals) {
    return `Error: ${label} allows at most ${spec.maxPositionals} positional argument${spec.maxPositionals === 1 ? '' : 's'}.`;
  }

  return { positionals };
}

function unsupportedDockerCommandError(command: string): string {
  return (
    `Error: docker ${command} is not allowed. ` +
    `Allowed read-only commands: ${READ_ONLY_COMMANDS}. ` +
    `Allowed lifecycle commands: ${WRITE_COMMANDS}.`
  );
}
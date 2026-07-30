import { describe, expect, it } from 'vitest';
import { resolveAcpLaunch, type AcpLaunchProbe } from '../../src/providers/acpLaunch.ts';

/**
 * A fake global npm install, laid out the way npm actually lays one out.
 *
 * The shims sit directly beside `node_modules`, and the package that owns a
 * `bin` name is one or two levels below it. `@google/gemini-cli` is in here on
 * purpose: its `bin` is `gemini`, so it is the case where the command name tells
 * you nothing about the package name.
 */
const NPM_PREFIX = 'C:\\Users\\joel\\AppData\\Roaming\\npm';

const PACKAGES: Record<string, unknown> = {
  [`${NPM_PREFIX}\\node_modules\\@agentclientprotocol\\claude-agent-acp\\package.json`]: {
    name: '@agentclientprotocol/claude-agent-acp',
    bin: { 'claude-agent-acp': 'dist/index.js' },
  },
  [`${NPM_PREFIX}\\node_modules\\@agentclientprotocol\\codex-acp\\package.json`]: {
    name: '@agentclientprotocol/codex-acp',
    bin: { 'codex-acp': 'dist/index.js' },
  },
  [`${NPM_PREFIX}\\node_modules\\@google\\gemini-cli\\package.json`]: {
    name: '@google/gemini-cli',
    bin: { gemini: 'bundle/gemini.js' },
  },
  // The string form of `bin`, which names the package's own last path segment.
  [`${NPM_PREFIX}\\node_modules\\solo-agent\\package.json`]: {
    name: 'solo-agent',
    bin: './lib/cli.js',
  },
  // A package with no bin at all — swept past, never mistaken for a match.
  [`${NPM_PREFIX}\\node_modules\\some-library\\package.json`]: { name: 'some-library' },
};

const DIRECTORIES: Record<string, string[]> = {
  [`${NPM_PREFIX}\\node_modules`]: ['@agentclientprotocol', '@google', 'solo-agent', 'some-library', '.bin'],
  [`${NPM_PREFIX}\\node_modules\\@agentclientprotocol`]: ['claude-agent-acp', 'codex-acp'],
  [`${NPM_PREFIX}\\node_modules\\@google`]: ['gemini-cli'],
};

/** The npm shims npm really writes: extensionless, `.cmd`, `.ps1`. */
const SHIMS = ['claude-agent-acp', 'codex-acp', 'gemini', 'solo-agent'];

function windowsMachine(over: Partial<AcpLaunchProbe> = {}): AcpLaunchProbe {
  return {
    platform: 'win32',
    // PATH resolution finds the extensionless shim first, because the resolver
    // tries the empty suffix before PATHEXT. That is the production behaviour.
    findExecutable: command => (SHIMS.includes(command) ? `${NPM_PREFIX}\\${command}` : undefined),
    fileExists: path => Object.keys(PACKAGES).some(manifest => manifest.replace('package.json', '') === path.replace(/[^\\]+$/, ''))
      || /\.(js|cjs|mjs)$/.test(path),
    readDirectory: path => DIRECTORIES[path] ?? [],
    readJsonFile: path => PACKAGES[path],
    nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
    ...over,
  };
}

describe('resolveAcpLaunch — the Windows spawn failure that made ACP unusable', () => {
  /**
   * The bug, exactly.
   *
   * Every published ACP adapter is an npm `bin`, and an npm `bin` on Windows is
   * a shell script plus a `.cmd` plus a `.ps1` — none of them an executable
   * image. `spawn('claude-agent-acp', … { shell: false })` therefore fails with
   * ENOENT even for a correct global install, which reads as "you have not
   * installed it" to somebody who has. Verified against a real install before
   * this module was written.
   */
  it('runs an npm-installed adapter through node instead of the unspawnable shim', () => {
    const launch = resolveAcpLaunch({ command: 'claude-agent-acp' }, windowsMachine());

    expect(launch).toEqual({
      status: 'node',
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [`${NPM_PREFIX}\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js`],
      viaShim: `${NPM_PREFIX}\\claude-agent-acp`,
    });
  });

  it('keeps the agent\'s own arguments after the resolved script', () => {
    // `gemini` is an interactive REPL without `--acp`, so losing the flag here
    // would produce a process that starts and never speaks a word of JSON-RPC.
    const launch = resolveAcpLaunch({ command: 'gemini', args: ['--acp'] }, windowsMachine());

    expect(launch).toMatchObject({
      status: 'node',
      args: [`${NPM_PREFIX}\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js`, '--acp'],
    });
  });

  it('finds a bin whose name does not match its package name', () => {
    // `gemini` lives in `@google/gemini-cli`. The mapping only exists in the
    // package's own `bin` field, which is why that field is read rather than
    // npm's generated shell scripts being parsed.
    expect(resolveAcpLaunch({ command: 'gemini' }, windowsMachine()).status).toBe('node');
  });

  it('understands the string form of bin as well as the map form', () => {
    expect(resolveAcpLaunch({ command: 'solo-agent' }, windowsMachine())).toMatchObject({
      status: 'node',
      args: [`${NPM_PREFIX}\\node_modules\\solo-agent\\lib\\cli.js`],
    });
  });

  it('spawns a real executable image directly, with no node in front of it', () => {
    // A Rust- or Go-built agent needs no bypass, and wrapping one in `node`
    // would hand Node a path that is not a script.
    const launch = resolveAcpLaunch({ command: 'native-acp', args: ['serve'] }, windowsMachine({
      findExecutable: () => 'C:\\tools\\native-acp.exe',
    }));

    expect(launch).toEqual({ status: 'direct', command: 'C:\\tools\\native-acp.exe', args: ['serve'] });
  });

  it('spawns directly on POSIX, where the npm shim is executable', () => {
    // The extensionless shim has a shebang and the execute bit on macOS and
    // Linux, so there is nothing to work around and no reason to involve node.
    for (const platform of ['darwin', 'linux']) {
      const launch = resolveAcpLaunch({ command: 'claude-agent-acp' }, windowsMachine({
        platform,
        findExecutable: () => '/usr/local/bin/claude-agent-acp',
      }));
      expect(launch, platform).toEqual({ status: 'direct', command: '/usr/local/bin/claude-agent-acp', args: [] });
    }
  });
});

describe('resolveAcpLaunch — failing with something the user can act on', () => {
  it('says "not on PATH", and says a reload may be what is needed', () => {
    const launch = resolveAcpLaunch({ command: 'nope-acp' }, windowsMachine({ findExecutable: () => undefined }));

    expect(launch.status).toBe('unresolved');
    if (launch.status === 'unresolved') {
      expect(launch.reason).toContain('nope-acp');
      expect(launch.reason).toMatch(/not found on PATH/);
      // The realistic case: installed after VS Code started.
      expect(launch.reason).toMatch(/reloaded/);
    }
  });

  it('explains an unspawnable shim rather than reporting a bare ENOENT', () => {
    // A shim whose package cannot be found is the one case where the old code
    // silently produced `spawn … ENOENT`. The replacement names the shim, says
    // why it cannot be started, and says what to configure instead.
    const launch = resolveAcpLaunch({ command: 'orphan-acp' }, windowsMachine({
      findExecutable: () => `${NPM_PREFIX}\\orphan-acp`,
      readDirectory: () => [],
    }));

    expect(launch.status).toBe('unresolved');
    if (launch.status === 'unresolved') {
      expect(launch.reason).toContain('orphan-acp');
      expect(launch.reason).toMatch(/without a shell/);
      expect(launch.reason).toMatch(/atlasmind\.acp\.agents/);
    }
  });

  it('never resolves to a shell, whatever the shim looks like', () => {
    // The whole point of `shell: false` is that there is no interpolation to
    // escape. A resolution that reached for cmd.exe would give that up.
    for (const command of ['claude-agent-acp', 'gemini', 'solo-agent']) {
      const launch = resolveAcpLaunch({ command }, windowsMachine());
      const named = launch.status === 'unresolved' ? '' : launch.command.toLowerCase();
      expect(named, command).not.toMatch(/cmd\.exe|powershell|pwsh|\bsh$|bash/);
    }
  });

  it('refuses an empty command instead of spawning something ambient', () => {
    expect(resolveAcpLaunch({ command: '   ' }, windowsMachine()).status).toBe('unresolved');
  });

  it('will not hand node a bin that is not a script', () => {
    // A `bin` pointing at a binary belongs to a package that is not what we are
    // looking for. Running it through node because a name matched would be the
    // same hopeful spawn this module replaces.
    const launch = resolveAcpLaunch({ command: 'weird-acp' }, windowsMachine({
      findExecutable: () => `${NPM_PREFIX}\\weird-acp`,
      readDirectory: path => (path === `${NPM_PREFIX}\\node_modules` ? ['weird-acp'] : []),
      readJsonFile: () => ({ name: 'weird-acp', bin: { 'weird-acp': 'bin/weird.sh' } }),
    }));

    expect(launch.status).toBe('unresolved');
  });

  it('honours an absolute path exactly as configured', () => {
    // The user pointed at a specific file; searching PATH instead would be
    // second-guessing them.
    const launch = resolveAcpLaunch({ command: 'D:\\agents\\my-acp.exe' }, windowsMachine({
      findExecutable: command => command,
    }));

    expect(launch).toEqual({ status: 'direct', command: 'D:\\agents\\my-acp.exe', args: [] });
  });

  it('gives up rather than sweeping an unbounded directory', () => {
    // `node_modules` is a directory the user controls, and this runs on a spawn
    // path. Hitting the cap reports "unresolved" rather than reading for ever.
    const many = Array.from({ length: 5_000 }, (_, index) => `pkg-${index}`);
    const launch = resolveAcpLaunch({ command: 'needle-acp' }, windowsMachine({
      findExecutable: () => `${NPM_PREFIX}\\needle-acp`,
      readDirectory: path => (path === `${NPM_PREFIX}\\node_modules` ? many : []),
      readJsonFile: () => ({ name: 'irrelevant' }),
    }));

    expect(launch.status).toBe('unresolved');
  });
});

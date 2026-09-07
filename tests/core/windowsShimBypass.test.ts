import { describe, expect, it } from 'vitest';
import {
  MAX_PACKAGES_SCANNED,
  directoryOf,
  findWindowsNodeEntryPoint,
  isRealNodeExecutable,
  readBinEntry,
  resolveWorkspaceCommand,
  type WorkspaceCommandProbe,
} from '../../src/core/windowsShimBypass.ts';

/**
 * A fake Windows install. Keys are absolute paths; `dirs` supplies directory
 * listings and `json` supplies parsed manifests, so no test touches a disk.
 */
function windowsProbe(options: {
  path?: Record<string, string>;
  files?: string[];
  dirs?: Record<string, string[]>;
  json?: Record<string, unknown>;
}): WorkspaceCommandProbe {
  const files = new Set(options.files ?? []);
  return {
    platform: 'win32',
    findExecutable: command => options.path?.[command],
    fileExists: target => files.has(target),
    readDirectory: target => options.dirs?.[target] ?? [],
    readJsonFile: target => options.json?.[target],
  };
}

const NODE = 'C:\\Program Files\\nodejs\\node.exe';

describe('resolveWorkspaceCommand', () => {
  it('leaves POSIX alone — the shim there is executable and needs no bypass', () => {
    const probe: WorkspaceCommandProbe = {
      platform: 'linux',
      findExecutable: () => undefined,
      fileExists: () => false,
      readDirectory: () => [],
      readJsonFile: () => undefined,
    };
    expect(resolveWorkspaceCommand('npm', ['run', 'test'], probe)).toEqual({
      status: 'direct',
      command: 'npm',
      args: ['run', 'test'],
    });
  });

  it('spawns a real executable image directly', () => {
    const probe = windowsProbe({ path: { git: 'C:\\Git\\bin\\git.EXE' } });
    expect(resolveWorkspaceCommand('git', ['status'], probe)).toEqual({
      status: 'direct',
      command: 'C:\\Git\\bin\\git.EXE',
      args: ['status'],
    });
  });

  it('bypasses a .cmd shim through the package the author declared', () => {
    const root = 'C:\\nodejs';
    const probe = windowsProbe({
      path: { npm: `${root}\\npm.cmd`, node: NODE },
      dirs: { [`${root}\\node_modules`]: ['npm'] },
      json: { [`${root}\\node_modules\\npm\\package.json`]: { name: 'npm', bin: { npm: 'bin/npm-cli.js' } } },
      files: [`${root}\\node_modules\\npm\\bin\\npm-cli.js`],
    });

    expect(resolveWorkspaceCommand('npm', ['run', 'test'], probe)).toEqual({
      status: 'node',
      command: NODE,
      args: [`${root}\\node_modules\\npm\\bin\\npm-cli.js`, 'run', 'test'],
      viaShim: `${root}\\npm.cmd`,
    });
  });

  it('refuses rather than falling back to a shell when the shim cannot be bypassed', () => {
    // The property this module exists for. `shell: true` would make this case
    // work and would make every case injectable, so an unresolvable command has
    // to fail visibly instead.
    const probe = windowsProbe({ path: { yarn: 'C:\\shims\\yarn.cmd', node: NODE } });
    const result = resolveWorkspaceCommand('yarn', ['install'], probe);
    expect(result.status).toBe('unresolved');
    expect(result.status === 'unresolved' && result.reason).toContain('will not use one');
  });

  it('refuses when no real node is on PATH rather than using the GUI executable', () => {
    const root = 'C:\\nodejs';
    const probe = windowsProbe({
      path: { npm: `${root}\\npm.cmd` },
      dirs: { [`${root}\\node_modules`]: ['npm'] },
      json: { [`${root}\\node_modules\\npm\\package.json`]: { name: 'npm', bin: { npm: 'bin/npm-cli.js' } } },
      files: [`${root}\\node_modules\\npm\\bin\\npm-cli.js`],
    });
    const result = resolveWorkspaceCommand('npm', [], probe);
    expect(result.status).toBe('unresolved');
    expect(result.status === 'unresolved' && result.reason).toContain('node');
  });

  it('reports a command that is not installed as not found', () => {
    const result = resolveWorkspaceCommand('nope', [], windowsProbe({}));
    expect(result.status).toBe('unresolved');
    expect(result.status === 'unresolved' && result.reason).toContain('not found on PATH');
  });

  it('refuses an empty command', () => {
    expect(resolveWorkspaceCommand('   ', [], windowsProbe({})).status).toBe('unresolved');
  });

  it('never introduces a shell for a command that is not one', () => {
    // The question this module answers is "can an argument become a command?",
    // and the answer must be no for every resolution it produces. It is *not*
    // responsible for which executable was asked for: a caller naming `cmd`
    // outright is asking to run a shell, which `toolPolicy` grades
    // `terminal-write`/high and `atlasmind.allowTerminalWrite` refuses by
    // default. Two separate controls, and conflating them here would test the
    // wrong one.
    const root = 'C:\\nodejs';
    const probe = windowsProbe({
      path: { npm: `${root}\\npm.cmd`, node: NODE, git: 'C:\\Git\\git.EXE' },
      dirs: { [`${root}\\node_modules`]: ['npm'] },
      json: { [`${root}\\node_modules\\npm\\package.json`]: { name: 'npm', bin: { npm: 'bin/npm-cli.js' } } },
      files: [`${root}\\node_modules\\npm\\bin\\npm-cli.js`],
    });

    for (const command of ['npm', 'git', 'nope']) {
      const result = resolveWorkspaceCommand(command, ['&', 'echo', 'pwned'], probe);
      if (result.status === 'unresolved') {
        continue;
      }
      expect(result.command.toLowerCase()).not.toMatch(/(cmd|powershell|pwsh|bash|sh)\.exe$/);
    }
  });

  it('passes arguments through untouched, including shell metacharacters', () => {
    // Nothing is escaped, joined or rewritten, because nothing downstream parses
    // them: `execFile(..., { shell: false })` hands the array to CreateProcess.
    // A test that asserted escaping would be asserting the wrong design.
    const probe = windowsProbe({ path: { git: 'C:\\Git\\git.EXE' } });
    const args = ['commit', '-m', 'fix: A && B | C > D', '&', 'echo', 'pwned'];
    const result = resolveWorkspaceCommand('git', args, probe);
    expect(result.status === 'direct' && result.args).toEqual(args);
  });

  it('does not mutate the caller\'s argument array', () => {
    const probe = windowsProbe({ path: { git: 'C:\\Git\\git.EXE' } });
    const args = ['status'];
    resolveWorkspaceCommand('git', args, probe);
    expect(args).toEqual(['status']);
  });
});

describe('findWindowsNodeEntryPoint', () => {
  it('finds a bin whose name does not match its package', () => {
    const root = 'C:\\nodejs';
    const probe = windowsProbe({
      dirs: {
        [`${root}\\node_modules`]: ['@google', 'other'],
        [`${root}\\node_modules\\@google`]: ['gemini-cli'],
      },
      json: {
        [`${root}\\node_modules\\@google\\gemini-cli\\package.json`]:
          { name: '@google/gemini-cli', bin: { gemini: './dist/index.js' } },
      },
      files: [`${root}\\node_modules\\@google\\gemini-cli\\dist\\index.js`],
    });
    expect(findWindowsNodeEntryPoint('gemini', root, probe))
      .toBe(`${root}\\node_modules\\@google\\gemini-cli\\dist\\index.js`);
  });

  it('gives up rather than sweeping an unbounded directory', () => {
    const root = 'C:\\nodejs';
    const many = Array.from({ length: MAX_PACKAGES_SCANNED + 10 }, (_, index) => `pkg-${index}`);
    const probe = windowsProbe({ dirs: { [`${root}\\node_modules`]: many } });
    expect(findWindowsNodeEntryPoint('missing', root, probe)).toBeUndefined();
  });

  it('returns nothing when there is no directory to look in', () => {
    expect(findWindowsNodeEntryPoint('npm', '', windowsProbe({}))).toBeUndefined();
  });
});

describe('readBinEntry', () => {
  const dir = 'C:\\p';

  it('reads the string form, which names the package as the command', () => {
    const probe = windowsProbe({
      json: { [`${dir}\\package.json`]: { name: 'tool', bin: './cli.js' } },
      files: [`${dir}\\cli.js`],
    });
    expect(readBinEntry(dir, 'tool', probe)).toBe(`${dir}\\cli.js`);
    expect(readBinEntry(dir, 'other', probe)).toBeUndefined();
  });

  it('refuses a bin pointing at something Node cannot run', () => {
    // A name match is not a reason to hand Node an arbitrary path.
    const probe = windowsProbe({
      json: { [`${dir}\\package.json`]: { name: 'tool', bin: { tool: './tool.exe' } } },
      files: [`${dir}\\tool.exe`],
    });
    expect(readBinEntry(dir, 'tool', probe)).toBeUndefined();
  });

  it('refuses a declared entry point that is not on disk', () => {
    const probe = windowsProbe({
      json: { [`${dir}\\package.json`]: { name: 'tool', bin: { tool: './cli.js' } } },
    });
    expect(readBinEntry(dir, 'tool', probe)).toBeUndefined();
  });

  it('survives a missing or malformed manifest', () => {
    expect(readBinEntry(dir, 'tool', windowsProbe({}))).toBeUndefined();
    expect(readBinEntry(dir, 'tool', windowsProbe({ json: { [`${dir}\\package.json`]: ['not', 'an', 'object'] } })))
      .toBeUndefined();
  });
});

describe('isRealNodeExecutable', () => {
  it('accepts a node binary and rejects the editor', () => {
    expect(isRealNodeExecutable('C:\\Program Files\\nodejs\\node.exe')).toBe(true);
    expect(isRealNodeExecutable('/usr/local/bin/node')).toBe(true);
    expect(isRealNodeExecutable('C:\\VS Code\\Code.exe')).toBe(false);
    expect(isRealNodeExecutable(undefined)).toBe(false);
  });
});

describe('directoryOf', () => {
  it('takes the directory part, or nothing when there is none', () => {
    expect(directoryOf('C:\\a\\b\\c.exe')).toBe('C:\\a\\b');
    expect(directoryOf('/usr/bin/node')).toBe('/usr/bin');
    expect(directoryOf('node')).toBe('');
  });
});

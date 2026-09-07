/**
 * Going around a Windows shim that cannot be spawned, without a shell.
 *
 * npm installs a `bin` on Windows as three sibling shims — an extensionless
 * POSIX shell script, a `.cmd` and a `.ps1` — and none is an executable image.
 * `CreateProcess` searches PATH but does not apply `PATHEXT`, so a bare name
 * misses the `.cmd`; and since the fix for CVE-2024-27980 Node refuses to spawn
 * `.cmd`/`.bat` at all without `shell: true`.
 *
 * `shell: true` is the tempting answer and is not available here. Node
 * concatenates the argument array into one command line without escaping it —
 * documented, and since Node 22 warned about at runtime as DEP0190 — so any
 * argument carrying `&`, `|` or `>` is run by `cmd.exe` as a command of its own.
 * Where those arguments come from a model, that is arbitrary code execution with
 * the tool call as the delivery mechanism.
 *
 * So the shim is **bypassed rather than invoked**: npm records what each `bin`
 * name stands for in that package's own `package.json`, so this reads the
 * declared mapping and hands the entry point to Node directly. Reading a
 * contract the package author wrote is the discipline `acpProtocol.ts` applies
 * to the wire format; scraping a generated `.cmd` would be guessing at an
 * implementation detail.
 *
 * Extracted from `providers/acpLaunch.ts`, which solved this first and still
 * owns the ACP-specific resolution order and error messages. It lives here
 * because `SkillExecutionContext.runCommand` needs the same bypass for a very
 * different reason — its arguments are model-generated — and two copies of a
 * rule about what may be spawned would eventually disagree about one of them.
 *
 * Pure apart from the injected probe.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

/** Filesystem access, injected so every branch is testable without a disk. */
export interface WindowsShimProbe {
  fileExists: (path: string) => boolean;
  /** Directory entry names, or an empty array when unreadable. */
  readDirectory: (path: string) => string[];
  /** Parsed JSON, or undefined when missing or unparseable. */
  readJsonFile: (path: string) => unknown;
}

/**
 * How many packages are read while looking for a `bin` mapping.
 *
 * A global `node_modules` is normally tens of entries, but it is a directory the
 * user controls and this runs on a spawn path, so the sweep is bounded rather
 * than trusted to be small. Hitting the cap reports nothing found — the honest
 * answer, and the caller can always be given an absolute path instead.
 */
export const MAX_PACKAGES_SCANNED = 400;

/**
 * What Windows can spawn without a shell: a real executable image.
 *
 * Testing for `.cmd`/`.bat` was not enough, and failed in production. Node ships
 * *three* files called npm — `npm` (an extensionless Unix shell script),
 * `npm.cmd`, and `npm.ps1` — and a PATH search that tries the empty suffix
 * before `PATHEXT` returns the shell script, which Windows cannot execute at all
 * (`spawn ...\nodejs\npm ENOENT`). Naming what *is* spawnable rather than
 * enumerating what is not means a shim of any shape falls through to the bypass
 * instead of being spawned hopefully.
 */
export const WINDOWS_EXECUTABLE = /\.(exe|com)$/i;

/** Entry points Node can be handed. A shim pointing anywhere else is not ours. */
export const NODE_SCRIPT = /\.(js|cjs|mjs)$/i;

/** The directory part of a path, or '' when there is none. */
export function directoryOf(target: string): string {
  const cut = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'));
  return cut > 0 ? target.slice(0, cut) : '';
}

/**
 * Is this an absolute path to a real `node` executable?
 *
 * VS Code's extension host reports `Code.exe` as `process.execPath`. Electron
 * can be persuaded to interpret a JavaScript entry point, but it is a GUI
 * process and is the wrong parent for a command's process tree.
 */
export function isRealNodeExecutable(candidate: string | undefined): candidate is string {
  return typeof candidate === 'string' && /(^|[\\/])node(?:\.exe)?$/i.test(candidate);
}

/**
 * Find the JavaScript file a Windows shim stands in for.
 *
 * npm puts the shims for a global install directly beside `node_modules`, so the
 * packages that could own this `bin` name are all one or two levels below the
 * shim's own directory. Two passes, cheapest first:
 *
 * 1. **The likely name.** Most `bin` names match their package's last path
 *    segment, so `node_modules/<command>` and `node_modules/@scope/<command>`
 *    are checked before anything is swept.
 * 2. **The declared mapping.** Otherwise every package's `bin` field is read
 *    until one declares this command. This is the pass that finds a `bin` whose
 *    name does not match its package at all.
 */
export function findWindowsNodeEntryPoint(
  command: string,
  shimDirectory: string,
  probe: WindowsShimProbe,
): string | undefined {
  if (!shimDirectory) {
    return undefined;
  }
  const root = `${shimDirectory}\\node_modules`;
  const entries = probe.readDirectory(root);
  if (entries.length === 0) {
    return undefined;
  }

  const scopes = entries.filter(entry => entry.startsWith('@'));

  // Pass 1 — the package named after the command.
  for (const candidate of [command, ...scopes.map(scope => `${scope}\\${command}`)]) {
    const entry = readBinEntry(`${root}\\${candidate}`, command, probe);
    if (entry) {
      return entry;
    }
  }

  // Pass 2 — whatever actually declares it.
  let scanned = 0;
  for (const entry of entries) {
    if (entry.startsWith('.')) {
      continue;
    }
    const candidates = entry.startsWith('@')
      ? probe.readDirectory(`${root}\\${entry}`).map(inner => `${entry}\\${inner}`)
      : [entry];
    for (const candidate of candidates) {
      if (++scanned > MAX_PACKAGES_SCANNED) {
        return undefined;
      }
      const found = readBinEntry(`${root}\\${candidate}`, command, probe);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Read one package's `bin` declaration and return the entry point for `command`.
 *
 * `bin` has two legal shapes — a bare string (which names the package's own last
 * path segment as the command) and a map — and both are handled, because a
 * package using the string form is not an edge case, it is the common one.
 *
 * The resolved path is required to exist and to be a file Node can run. A `bin`
 * pointing at something else belongs to a package that is not what we are
 * looking for, and handing Node an arbitrary path from a `package.json` because
 * a name matched is exactly the sort of hopeful spawn this module replaces.
 */
export function readBinEntry(
  packageDirectory: string,
  command: string,
  probe: WindowsShimProbe,
): string | undefined {
  const manifest = probe.readJsonFile(`${packageDirectory}\\package.json`);
  if (typeof manifest !== 'object' || manifest === null) {
    return undefined;
  }
  const record = manifest as Record<string, unknown>;
  const bin = record['bin'];

  let relative = '';
  if (typeof bin === 'string') {
    const name = typeof record['name'] === 'string' ? record['name'].split('/').pop() : undefined;
    relative = name === command ? bin : '';
  } else if (typeof bin === 'object' && bin !== null && !Array.isArray(bin)) {
    const target = (bin as Record<string, unknown>)[command];
    relative = typeof target === 'string' ? target : '';
  }
  if (!relative) {
    return undefined;
  }

  const script = `${packageDirectory}\\${relative.replace(/^\.\//, '').replace(/\//g, '\\')}`;
  return NODE_SCRIPT.test(script) && probe.fileExists(script) ? script : undefined;
}

/**
 * How a workspace command should be started, decided before anything is spawned.
 *
 * `unresolved` is a first-class answer rather than a fallback to a shell. That
 * is the whole point: the alternative to a bypass is `shell: true`, and a
 * command that cannot be run safely must fail visibly instead of being run
 * unsafely. The reason is written for the user, because it replaces what would
 * otherwise be a bare `ENOENT`.
 */
export type WorkspaceCommandResolution =
  | { status: 'direct'; command: string; args: string[] }
  | { status: 'node'; command: string; args: string[]; viaShim: string }
  | { status: 'unresolved'; reason: string };

/** PATH and filesystem access for {@link resolveWorkspaceCommand}. */
export interface WorkspaceCommandProbe extends WindowsShimProbe {
  platform: string;
  /** Resolve a bare command name to an absolute path, or undefined. */
  findExecutable: (command: string) => string | undefined;
}

/**
 * Work out how to run a workspace command without a shell.
 *
 * POSIX needs none of this: npm's shim there is an executable script with a
 * shebang, so the plain spawn is already correct and the bare name is left for
 * `execFile` to resolve — the behaviour this path has always had.
 *
 * On Windows the order is: resolve on PATH, spawn directly when it is a real
 * executable image, otherwise bypass the shim through the package's declared
 * `bin`. A JavaScript entry point needs a real `node`, which is looked up on
 * PATH rather than taken from `process.execPath` — inside the extension host
 * that is `Code.exe`.
 */
export function resolveWorkspaceCommand(
  command: string,
  args: readonly string[],
  probe: WorkspaceCommandProbe,
): WorkspaceCommandResolution {
  const trimmed = command.trim();
  const next = [...args];
  if (!trimmed) {
    return { status: 'unresolved', reason: 'runCommand: no executable was given.' };
  }
  if (probe.platform !== 'win32') {
    return { status: 'direct', command: trimmed, args: next };
  }

  const resolved = probe.findExecutable(trimmed);
  if (!resolved) {
    return {
      status: 'unresolved',
      reason: `\`${trimmed}\` was not found on PATH. Install it, or add it to PATH and reload the window — `
        + 'a tool installed after VS Code started is often not on this window\'s PATH yet.',
    };
  }
  if (WINDOWS_EXECUTABLE.test(resolved)) {
    return { status: 'direct', command: resolved, args: next };
  }

  const script = findWindowsNodeEntryPoint(trimmed, directoryOf(resolved), probe);
  if (!script) {
    return {
      status: 'unresolved',
      reason: `\`${trimmed}\` resolved to \`${resolved}\`, which Windows cannot start without a shell — and `
        + 'AtlasMind will not use one, because a shell would run this command\'s arguments as commands of '
        + 'their own. That path is normally a package-manager shim whose JavaScript entry point could not '
        + 'be found. Run this command in a terminal instead.',
    };
  }

  const node = probe.findExecutable('node');
  if (!isRealNodeExecutable(node)) {
    return {
      status: 'unresolved',
      reason: `\`${trimmed}\` is installed, but a real \`node\` executable was not found on PATH, and `
        + 'AtlasMind will not run a JavaScript entry point through VS Code\'s own GUI executable. '
        + 'Install Node.js or add it to PATH, then reload this VS Code window.',
    };
  }

  return { status: 'node', command: node, args: [script, ...next], viaShim: resolved };
}

/**
 * Resolve a command against PATH, applying `PATHEXT` on Windows.
 *
 * The empty suffix is tried first and on purpose, even though on Windows it
 * usually finds an unexecutable shell script: knowing that the shim is *there*
 * is what distinguishes "installed, but Windows cannot start it this way" from
 * "not installed", and those two need different messages. The caller decides
 * what to do with a non-executable hit.
 */
export function findExecutableOnPath(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  // An explicit path is honoured as given: the caller pointed at a specific
  // file, and searching PATH for it would be second-guessing them.
  if (/[\\/]/.test(trimmed)) {
    return existsSync(trimmed) ? trimmed : undefined;
  }

  const suffixes = process.platform === 'win32'
    ? (path.extname(trimmed)
      ? ['']
      : ['', ...(process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)])
    : [''];

  for (const directory of (process.env['PATH'] ?? process.env['Path'] ?? '').split(path.delimiter)) {
    const entry = directory.trim();
    if (!entry) {
      continue;
    }
    for (const suffix of suffixes) {
      const candidate = path.join(entry, `${trimmed}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * The real filesystem and the real PATH.
 *
 * The only impure function here, and the only one not directly unit-tested —
 * everything it feeds is. Deliberately free of `vscode`, so the extension host
 * and the CLI resolve a command the same way rather than keeping two answers to
 * "can this be spawned safely?".
 */
export function createWorkspaceCommandProbe(): WorkspaceCommandProbe {
  return {
    platform: process.platform,
    findExecutable: findExecutableOnPath,
    fileExists: target => {
      try {
        return existsSync(target);
      } catch {
        return false;
      }
    },
    readDirectory: target => {
      try {
        return readdirSync(target);
      } catch {
        // Unreadable or absent is a miss, not a failure: the caller reports that
        // the command could not be resolved, which is what the user needs to
        // hear either way.
        return [];
      }
    },
    readJsonFile: target => {
      try {
        return JSON.parse(readFileSync(target, 'utf8')) as unknown;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Turning a configured ACP agent command into something Windows can actually
 * spawn.
 *
 * This module exists because the ACP provider did not work on Windows *at all*,
 * and the reason was invisible from the settings screen. Every published ACP
 * adapter for a major vendor ships as an npm package — `claude-agent-acp`,
 * `codex-acp`, `gemini`, `copilot`, `qwen` are all npm `bin` entries — and npm
 * installs a `bin` on Windows as three sibling shims: an extensionless POSIX
 * shell script, a `.cmd`, and a `.ps1`. None of the three is an executable
 * image, so:
 *
 * - `spawn('claude-agent-acp', …, { shell: false })` fails with **ENOENT**.
 *   Windows `CreateProcess` searches PATH but does not apply `PATHEXT`, so it
 *   finds the extensionless shell script and cannot execute it. Verified by
 *   running exactly that spawn against a real global install.
 * - Resolving to the `.cmd` does not help either: since the fix for
 *   CVE-2024-27980 Node refuses to spawn `.cmd`/`.bat` without `shell: true`,
 *   and a shell is not on the table — the whole point of `shell: false` is that
 *   there is no interpolation to escape.
 *
 * So the shim has to be **bypassed**, not invoked. `acpInstaller.ts` already
 * learned this lesson for npm itself and hard-codes npm's entry-point path; that
 * trick does not generalise, because a user-authored agent command belongs to a
 * package whose name is not derivable from the `bin` name (`gemini` lives in
 * `@google/gemini-cli`). What *is* derivable is the reverse direction: npm
 * records the mapping in each package's `package.json` `bin` field, so this
 * module reads that **declared** mapping rather than parsing npm's generated
 * shell scripts. Reading a contract the package author wrote is the same
 * discipline `acpProtocol.ts` applies to the wire format; scraping a generated
 * `.cmd` would be guessing at an implementation detail.
 *
 * Pure apart from the injected probe, so every branch is unit-tested with no
 * filesystem and no spawning.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

/** Filesystem and PATH access, injected so the resolution is testable. */
export interface AcpLaunchProbe {
  /** `process.platform`. */
  platform: string;
  /** Resolve a bare command name to an absolute path, or undefined. */
  findExecutable: (command: string) => string | undefined;
  fileExists: (path: string) => boolean;
  /** Directory entry names, or an empty array when unreadable. */
  readDirectory: (path: string) => string[];
  /** Parsed JSON, or undefined when missing or unparseable. */
  readJsonFile: (path: string) => unknown;
  /** Absolute path of the Node binary running this process. */
  nodeExecPath: string;
}

export type AcpLaunchResolution =
  /** Spawn `command` directly — a real executable image, or a POSIX platform. */
  | { status: 'direct'; command: string; args: string[] }
  /**
   * Spawn Node against the package's entry point, going around a Windows shim
   * that cannot be executed. `viaShim` is the shim that was found, for the log.
   */
  | { status: 'node'; command: string; args: string[]; viaShim: string }
  /**
   * Nothing spawnable was found. `reason` is written for the user, because this
   * is the message that has to replace a bare `spawn … ENOENT`.
   */
  | { status: 'unresolved'; reason: string };

/**
 * How many packages are read while looking for a `bin` mapping.
 *
 * A global `node_modules` is normally tens of entries, but it is a directory the
 * user controls and this runs on a spawn path, so the sweep is bounded rather
 * than trusted to be small. Hitting the cap reports `unresolved` — the honest
 * answer, and the user can always configure an absolute path.
 */
const MAX_PACKAGES_SCANNED = 400;

/** What Windows can spawn without a shell: a real executable image. */
const WINDOWS_EXECUTABLE = /\.(exe|com)$/i;

/** Entry points Node can be handed. A shim pointing anywhere else is not ours. */
const NODE_SCRIPT = /\.(js|cjs|mjs)$/i;

/**
 * Work out how to start an agent.
 *
 * The order is deliberate: an absolute path the user supplied is honoured first
 * (they may well have pointed at something we would never find), then PATH, then
 * — only on Windows, and only for a command that resolved to something
 * unspawnable — the shim bypass.
 */
export function resolveAcpLaunch(
  config: { command: string; args?: string[] },
  probe: AcpLaunchProbe,
): AcpLaunchResolution {
  const command = config.command.trim();
  const args = [...(config.args ?? [])];
  if (!command) {
    return { status: 'unresolved', reason: 'No command was configured for this ACP agent.' };
  }

  const resolved = probe.findExecutable(command);
  if (!resolved) {
    return {
      status: 'unresolved',
      reason: `\`${command}\` was not found on PATH. Install the ACP agent you want to use, then set its command in atlasmind.acp.agents. `
        + 'A binary installed after VS Code started is often not on this window\'s PATH until the window is reloaded.',
    };
  }

  // On POSIX the npm shim is an executable shell script with a shebang, so the
  // plain spawn is correct and there is nothing to work around.
  if (probe.platform !== 'win32' || WINDOWS_EXECUTABLE.test(resolved)) {
    return { status: 'direct', command: resolved, args };
  }

  const script = findNodeEntryPoint(command, directoryOf(resolved), probe);
  if (!script) {
    return {
      status: 'unresolved',
      reason: `\`${command}\` resolved to \`${resolved}\`, which Windows cannot start without a shell — and AtlasMind will not use one. `
        + 'That path is normally a package-manager shim. Set `command` in atlasmind.acp.agents to the real executable, '
        + 'or to the agent\'s JavaScript entry point with `"args"` naming it, and AtlasMind will run it directly.',
    };
  }

  return { status: 'node', command: probe.nodeExecPath, args: [script, ...args], viaShim: resolved };
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
 *    are checked before anything is swept. `claude-agent-acp` and `codex-acp`
 *    are both found here.
 * 2. **The declared mapping.** Otherwise every package's `bin` field is read
 *    until one declares this command. This is the pass that finds `gemini`
 *    inside `@google/gemini-cli`, where the names do not match at all.
 */
function findNodeEntryPoint(command: string, shimDirectory: string, probe: AcpLaunchProbe): string | undefined {
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
 * `bin` has two legal shapes — a bare string (which names the package's own
 * last path segment as the command) and a map — and both are handled, because a
 * package using the string form is not an edge case, it is the common one.
 *
 * The resolved path is required to exist and to be a file Node can run. A `bin`
 * pointing at something else belongs to a package that is not what we are
 * looking for, and handing Node an arbitrary path from a `package.json` because
 * a name matched is exactly the sort of hopeful spawn this module replaces.
 */
function readBinEntry(packageDirectory: string, command: string, probe: AcpLaunchProbe): string | undefined {
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

function directoryOf(target: string): string {
  const cut = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'));
  return cut > 0 ? target.slice(0, cut) : '';
}

/**
 * The real filesystem and the real PATH.
 *
 * The only impure function in this module, and the only one not directly
 * unit-tested — everything it feeds is. It deliberately does **not** reuse
 * `findCommandExecutable` from `mcp/mcpClient.ts`, which does the same PATH
 * search: that module imports `vscode` and the MCP SDK, and pulling either into
 * the ACP adapter would make a provider that spawns a subprocess depend on the
 * editor API and on an unrelated protocol client.
 */
export function createAcpLaunchProbe(): AcpLaunchProbe {
  return {
    platform: process.platform,
    findExecutable: findAcpExecutable,
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
        // An unreadable or absent directory is a miss, not a failure: the caller
        // reports "not found", which is what the user needs to hear either way.
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
    nodeExecPath: process.execPath,
  };
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
function findAcpExecutable(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  // An explicit path is honoured as given: the user pointed at a specific file,
  // and searching PATH for it would be second-guessing them.
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

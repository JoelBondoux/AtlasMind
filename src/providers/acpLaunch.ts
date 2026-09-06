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
import {
  WINDOWS_EXECUTABLE,
  directoryOf,
  findExecutableOnPath,
  findWindowsNodeEntryPoint,
  isRealNodeExecutable,
} from '../core/windowsShimBypass.js';

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
  /**
   * Absolute path of a real Node executable.
   *
   * VS Code's extension host reports `Code.exe` as `process.execPath`. Electron
   * can be persuaded to interpret a JavaScript entry point, but it is a GUI
   * process and is the wrong parent for an ACP process tree on Windows.
   */
  nodeExecPath: string | undefined;
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

  const script = findWindowsNodeEntryPoint(command, directoryOf(resolved), probe);
  if (!script) {
    return {
      status: 'unresolved',
      reason: `\`${command}\` resolved to \`${resolved}\`, which Windows cannot start without a shell — and AtlasMind will not use one. `
        + 'That path is normally a package-manager shim. Set `command` in atlasmind.acp.agents to the real executable, '
        + 'or to the agent\'s JavaScript entry point with `"args"` naming it, and AtlasMind will run it directly.',
    };
  }

  if (!isRealNodeExecutable(probe.nodeExecPath)) {
    return {
      status: 'unresolved',
      reason: `\`${command}\` is installed, but a real \`node.exe\` was not found on PATH. `
        + 'AtlasMind will not run an ACP JavaScript entry point through VS Code\'s GUI executable. '
        + 'Install Node.js or add it to PATH, then reload this VS Code window.',
    };
  }

  return { status: 'node', command: probe.nodeExecPath, args: [script, ...args], viaShim: resolved };
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
    // In a VS Code extension host `process.execPath` is Code.exe, not Node.
    // Starting an npm ACP entry point through it creates an Electron/GUI parent
    // in the agent tree and defeats the console-containment boundary.
    nodeExecPath: process.platform === 'win32'
      ? findExecutableOnPath('node.exe')
      : process.execPath,
  };
}


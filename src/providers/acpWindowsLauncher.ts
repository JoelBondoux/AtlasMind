/**
 * The Windows-only launch boundary for console-free ACP processes.
 *
 * `windowsHide: true` controls only the process Node starts. ACP adapters then
 * start native agents, package-manager shims, MCP servers, and console hosts of
 * their own. The bundled helper creates a private, non-interactive Windows
 * window station with its own desktop and sets it on the real agent's
 * STARTUPINFO. It also creates one SW_HIDE console for the whole descendant tree
 * to inherit, so a later CLI or shell does not allocate a separate visible
 * conhost. Descendants inherit the station, so a child that chooses a fresh
 * desktop still cannot connect to the interactive station or display UI.
 *
 * This is opt-in. Enterprise application control or EDR may block an unsigned
 * native helper or unusual non-interactive UI boundary, and silently falling
 * back after such a block would both ignore the user's choice and bring the
 * focus stealing back. Missing, modified, or blocked helpers fail with an
 * actionable error instead. This controls window placement, not the child's
 * same-user filesystem or network authority.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export const ACP_HIDE_CONSOLE_SETTING = 'acp.hideConsoleWindows';

/**
 * Whether Windows has an explicit answer to the ACP launch question.
 *
 * The schema default is deliberately not an answer: treating `false` from the
 * default as consent would let an activation-time health check show the very
 * terminal windows the setup step exists to explain first.
 */
export function isAcpConsoleModeChosen(
  platform: string,
  configuredValues: readonly unknown[],
): boolean {
  return platform !== 'win32'
    || configuredValues.some(value => typeof value === 'boolean');
}

/** Hash of the reviewed release binary in `media/bin`. */
export const ACP_PRIVATE_DESKTOP_HELPER_SHA256 =
  'c4970295b3b6c4b30ef824193bde7915a853cb58383d818648b730fcd2c95875';

export interface AcpPrivateDesktopProbe {
  platform: string;
  helperPath: string;
  fileExists(target: string): boolean;
  sha256(target: string): string | undefined;
}

export type AcpPrivateDesktopLaunch =
  | { status: 'ordinary'; command: string; args: string[] }
  | { status: 'private-desktop'; command: string; args: string[] }
  | { status: 'unavailable'; reason: string };

/**
 * Put a resolved ACP command behind the private-desktop helper when requested.
 *
 * The helper receives an already-resolved executable and an argv array. No
 * shell is introduced at either layer, so there is still no command string to
 * interpolate or escape.
 */
export function wrapAcpLaunchForPrivateDesktop(
  command: string,
  args: readonly string[],
  requested: boolean,
  probe: AcpPrivateDesktopProbe = createAcpPrivateDesktopProbe(),
): AcpPrivateDesktopLaunch {
  if (!requested || probe.platform !== 'win32') {
    return { status: 'ordinary', command, args: [...args] };
  }
  if (!probe.fileExists(probe.helperPath)) {
    return {
      status: 'unavailable',
      reason: `AtlasMind's private-desktop launcher is missing from \`${probe.helperPath}\`. `
        + `Uncheck atlasmind.${ACP_HIDE_CONSOLE_SETTING} to use ordinary ACP launching, or reinstall AtlasMind.`,
    };
  }
  const actualHash = probe.sha256(probe.helperPath);
  if (actualHash !== ACP_PRIVATE_DESKTOP_HELPER_SHA256) {
    return {
      status: 'unavailable',
      reason: `AtlasMind refused to run the private-desktop launcher because its SHA-256 did not match this build. `
        + `Uncheck atlasmind.${ACP_HIDE_CONSOLE_SETTING} to use ordinary ACP launching, or reinstall AtlasMind.`,
    };
  }
  return {
    status: 'private-desktop',
    command: probe.helperPath,
    args: ['--', command, ...args],
  };
}

export function createAcpPrivateDesktopProbe(): AcpPrivateDesktopProbe {
  // Both `src/providers` in tests and `out/providers` in the extension are two
  // levels below the extension root.
  const helperPath = path.resolve(__dirname, '..', '..', 'media', 'bin', 'atlasmind-acp-private-desktop.exe');
  return {
    platform: process.platform,
    helperPath,
    fileExists: target => {
      try {
        return existsSync(target);
      } catch {
        return false;
      }
    },
    sha256: target => {
      try {
        return createHash('sha256').update(readFileSync(target)).digest('hex');
      } catch {
        return undefined;
      }
    },
  };
}

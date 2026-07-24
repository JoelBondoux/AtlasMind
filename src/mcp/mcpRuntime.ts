/**
 * Shared MCP runtime bootstrap helpers.
 *
 * Used by both the recommended-server install command and the guided setup
 * wizard to (1) check whether a stdio server's launch runtime is present and
 * (2) install a missing runtime via the platform package manager.
 *
 * Safety: installation is NEVER performed here implicitly. `checkStarterRuntime`
 * only *plans* an install and returns the exact command; the caller must obtain
 * explicit user confirmation before invoking `runRuntimeInstallPlan`.
 */

import { execFile } from 'node:child_process';
import { findCommandExecutable, getKnownCommandInstallHint } from './mcpClient.js';
import { getRecommendedMcpStarterDetails } from '../constants.js';
import type { RecommendedRuntimePackageManager, SupportedRuntimePlatform } from '../constants.js';

export interface RuntimeInstallPlan {
  packageManager: RecommendedRuntimePackageManager;
  displayName: string;
  /** Resolved executable to spawn (may be `sudo`). */
  command: string;
  args: string[];
  /** Human-readable one-liner shown to the user before they confirm. */
  humanCommand: string;
}

export type RuntimeCheck =
  | { status: 'ready' }
  | { status: 'installable'; runtimeCommand: string; plan: RuntimeInstallPlan }
  | { status: 'manual'; runtimeCommand: string; message: string };

export interface RuntimeInstallResult {
  ok: boolean;
  message: string;
}

export function execFileAsync(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error([error.message, stderr, stdout].filter(Boolean).join('\n').trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function buildRuntimeInstallInvocation(
  packageManagerExecutable: string,
  packageManager: RecommendedRuntimePackageManager,
  packageId: string,
  extraPackages: string[] = [],
): { command: string; args: string[] } {
  const packages = [packageId, ...extraPackages];

  switch (packageManager) {
    case 'winget':
      return {
        command: packageManagerExecutable,
        args: [
          'install',
          '--id', packageId,
          '-e',
          '--source', 'winget',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity',
        ],
      };
    case 'brew':
      return { command: packageManagerExecutable, args: ['install', ...packages] };
    case 'apt-get': {
      const baseArgs = [packageManagerExecutable, 'install', '-y', ...packages];
      if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        const sudoExecutable = findCommandExecutable('sudo');
        if (sudoExecutable) {
          return { command: sudoExecutable, args: ['-n', ...baseArgs] };
        }
      }
      return { command: packageManagerExecutable, args: ['install', '-y', ...packages] };
    }
    case 'dnf': {
      const baseArgs = [packageManagerExecutable, 'install', '-y', ...packages];
      if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        const sudoExecutable = findCommandExecutable('sudo');
        if (sudoExecutable) {
          return { command: sudoExecutable, args: ['-n', ...baseArgs] };
        }
      }
      return { command: packageManagerExecutable, args: ['install', '-y', ...packages] };
    }
    case 'pacman': {
      const baseArgs = [packageManagerExecutable, '-S', '--noconfirm', ...packages];
      if (typeof process.getuid === 'function' && process.getuid() !== 0) {
        const sudoExecutable = findCommandExecutable('sudo');
        if (sudoExecutable) {
          return { command: sudoExecutable, args: ['-n', ...baseArgs] };
        }
      }
      return { command: packageManagerExecutable, args: ['-S', '--noconfirm', ...packages] };
    }
  }
}

/** A short, non-executed representation of an install, for display/confirmation. */
function humanReadableInstall(
  packageManager: RecommendedRuntimePackageManager,
  packageId: string,
  extraPackages: string[],
): string {
  const packages = [packageId, ...extraPackages].join(' ');
  switch (packageManager) {
    case 'winget':
      return `winget install --id ${packageId} -e`;
    case 'brew':
      return `brew install ${packages}`;
    case 'apt-get':
      return `sudo apt-get install -y ${packages}`;
    case 'dnf':
      return `sudo dnf install -y ${packages}`;
    case 'pacman':
      return `sudo pacman -S --noconfirm ${packages}`;
  }
}

function currentPlatformKey(): SupportedRuntimePlatform | undefined {
  return (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux')
    ? process.platform
    : undefined;
}

/**
 * Determine whether the given stdio runtime command is available, and if not,
 * plan how it could be installed. Performs NO installation.
 *
 * @param serverId       Recommended-server id (to look up runtimeInstalls).
 * @param runtimeCommand The launch command (e.g. 'npx', 'uvx'); undefined for http servers.
 */
export function checkStarterRuntime(serverId: string, runtimeCommand: string | undefined): RuntimeCheck {
  if (!runtimeCommand) {
    return { status: 'ready' };
  }
  if (findCommandExecutable(runtimeCommand)) {
    return { status: 'ready' };
  }

  const starter = getRecommendedMcpStarterDetails(serverId);
  const platformKey = currentPlatformKey();
  const candidates = platformKey ? (starter.runtimeInstalls?.[platformKey] ?? []) : [];

  if (candidates.length === 0) {
    return {
      status: 'manual',
      runtimeCommand,
      message: `This server needs the ${runtimeCommand} runtime, which is not installed. ${getKnownCommandInstallHint(runtimeCommand)}`,
    };
  }

  const available = candidates
    .map(candidate => ({ candidate, executable: findCommandExecutable(candidate.packageManager) }))
    .find(entry => Boolean(entry.executable));

  if (!available?.executable) {
    return {
      status: 'manual',
      runtimeCommand,
      message: `This server needs ${candidates[0]?.displayName ?? runtimeCommand}, but no supported package manager was found (looked for ${candidates.map(c => c.packageManager).join(', ')}). Install ${candidates[0]?.displayName ?? runtimeCommand} manually and reload VS Code.`,
    };
  }

  const runtimeInstall = available.candidate;
  const invocation = buildRuntimeInstallInvocation(
    available.executable,
    runtimeInstall.packageManager,
    runtimeInstall.packageId,
    runtimeInstall.extraPackages ?? [],
  );

  return {
    status: 'installable',
    runtimeCommand,
    plan: {
      packageManager: runtimeInstall.packageManager,
      displayName: runtimeInstall.displayName,
      command: invocation.command,
      args: invocation.args,
      humanCommand: humanReadableInstall(
        runtimeInstall.packageManager,
        runtimeInstall.packageId,
        runtimeInstall.extraPackages ?? [],
      ),
    },
  };
}

/**
 * Execute a runtime install plan (only call after explicit user confirmation).
 * Retries once, then re-checks that the runtime command resolves.
 */
export async function runRuntimeInstallPlan(
  runtimeCommand: string,
  plan: RuntimeInstallPlan,
  onProgress?: (message: string) => void,
): Promise<RuntimeInstallResult> {
  onProgress?.(`Installing ${plan.displayName} via ${plan.packageManager}…`);
  let lastError: unknown = undefined;
  let attempts = 0;
  while (attempts < 2) {
    try {
      await execFileAsync(plan.command, plan.args);
      if (findCommandExecutable(runtimeCommand)) {
        return { ok: true, message: `${plan.displayName} was installed successfully.` };
      }
    } catch (error) {
      lastError = error;
    }
    attempts++;
  }
  return {
    ok: false,
    message: `AtlasMind tried to install ${plan.displayName}, but the install step did not complete.\n\nError: ${lastError instanceof Error ? lastError.message : String(lastError)}\n\nPlease install ${plan.displayName} manually using ${plan.packageManager} and reload VS Code.`,
  };
}

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACP_PRIVATE_DESKTOP_HELPER_SHA256,
  createAcpPrivateDesktopProbe,
  isAcpConsoleModeChosen,
  wrapAcpLaunchForPrivateDesktop,
  type AcpPrivateDesktopProbe,
} from '../../src/providers/acpWindowsLauncher.ts';

const PROBE: AcpPrivateDesktopProbe = {
  platform: 'win32',
  helperPath: 'C:\\atlasmind\\atlasmind-acp-private-desktop.exe',
  fileExists: () => true,
  sha256: () => ACP_PRIVATE_DESKTOP_HELPER_SHA256,
};
const NATIVE_SOURCE = readFileSync(
  path.join(process.cwd(), 'native', 'acp-private-desktop', 'src', 'main.rs'),
  'utf8',
);

/**
 * The three Windows tests below launch real process trees — the shipped helper,
 * then Node, then PowerShell — and the deepest of them compiles C# at runtime
 * through `Add-Type`. That is genuinely slow on a cold CI runner.
 *
 * Each child already gets `CHILD_PROCESS_TIMEOUT_MS`, but the *tests* carried no
 * timeout, so they inherited Vitest's 5s default and were killed before the
 * child limit they set could ever fire. The result was a bare "Test timed out in
 * 5000ms" instead of the child's own diagnostic, on a suite that passed locally
 * and failed on CI purely on machine speed.
 *
 * The test timeout must therefore stay comfortably *above* the child timeout, or
 * the child's error can never surface. Neither value relaxes an assertion.
 */
const CHILD_PROCESS_TIMEOUT_MS = 10_000;
const PROCESS_LAUNCH_TIMEOUT_MS = 30_000;

describe('the ACP private-desktop launch boundary', () => {
  it('does not mistake the Windows schema default for the user choosing a mode', () => {
    expect(isAcpConsoleModeChosen('win32', [undefined, undefined, undefined])).toBe(false);
    expect(isAcpConsoleModeChosen('win32', [false, undefined, undefined])).toBe(true);
    expect(isAcpConsoleModeChosen('win32', [undefined, true, undefined])).toBe(true);
    expect(isAcpConsoleModeChosen('linux', [undefined, undefined, undefined])).toBe(true);
  });

  it('ships the exact helper this source build pins', () => {
    const shipped = createAcpPrivateDesktopProbe();
    expect(shipped.fileExists(shipped.helperPath), shipped.helperPath).toBe(true);
    expect(shipped.sha256(shipped.helperPath)).toBe(ACP_PRIVATE_DESKTOP_HELPER_SHA256);
  });

  it('gives non-interactive descendants the documented UI-object rights without reopening by name', () => {
    expect(NATIVE_SOURCE).toContain('const WINSTA_NONINTERACTIVE_ACCESS');
    expect(NATIVE_SOURCE).toContain('const DESKTOP_NONINTERACTIVE_ACCESS');
    expect(NATIVE_SOURCE).toContain('WINSTA_ACCESSGLOBALATOMS');
    expect(NATIVE_SOURCE).toContain('DESKTOP_READOBJECTS');
    expect(NATIVE_SOURCE).toContain('DESKTOP_WRITEOBJECTS');
    expect(NATIVE_SOURCE).toContain('startup.startup_info.desktop = null_mut()');
    expect(NATIVE_SOURCE).toContain('SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX');
    expect(NATIVE_SOURCE).toContain('CREATE_NEW_CONSOLE');
    expect(NATIVE_SOURCE).not.toContain('const CREATE_NO_WINDOW');
    expect(NATIVE_SOURCE).toContain('startup.startup_info.show_window = 0');
  });

  it.skipIf(process.platform !== 'win32')('runs the shipped helper and preserves redirected stdio', async () => {
    const commandInterpreter = process.env.ComSpec;
    expect(commandInterpreter).toBeTruthy();
    const launch = wrapAcpLaunchForPrivateDesktop(
      commandInterpreter!,
      ['/d', '/s', '/c', 'echo atlasmind-private-desktop-ok'],
      true,
      createAcpPrivateDesktopProbe(),
    );
    expect(launch.status).toBe('private-desktop');
    if (launch.status !== 'private-desktop') {
      return;
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        launch.command,
        launch.args,
        { windowsHide: true, timeout: CHILD_PROCESS_TIMEOUT_MS },
        (error, output, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve(output);
        },
      );
    });

    expect(stdout.trim()).toBe('atlasmind-private-desktop-ok');
  }, PROCESS_LAUNCH_TIMEOUT_MS);

  it.skipIf(process.platform !== 'win32')('starts PowerShell on the private station without a DLL initialization failure', async () => {
    const powershell = (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .map(directory => path.join(directory, 'pwsh.exe'))
      .find(candidate => existsSync(candidate));
    if (!powershell) {
      return;
    }
    const launch = wrapAcpLaunchForPrivateDesktop(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
      true,
      createAcpPrivateDesktopProbe(),
    );
    expect(launch.status).toBe('private-desktop');
    if (launch.status !== 'private-desktop') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        launch.command,
        launch.args,
        { windowsHide: true, timeout: CHILD_PROCESS_TIMEOUT_MS },
        (error, _output, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve();
        },
      );
    });
  }, PROCESS_LAUNCH_TIMEOUT_MS);

  it.skipIf(process.platform !== 'win32')('keeps a nested ACP shell on one non-visible inherited console', async () => {
    const powershell = (process.env['PATH'] ?? '')
      .split(path.delimiter)
      .map(directory => path.join(directory, 'pwsh.exe'))
      .find(candidate => existsSync(candidate));
    if (!powershell) {
      return;
    }
    const typeDefinition = [
      'using System; using System.Runtime.InteropServices;',
      'public static class NativeConsole {',
      '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
      '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
      '}',
    ].join(' ');
    const inspectConsole = [
      `Add-Type -TypeDefinition '${typeDefinition}'`,
      '$window = [NativeConsole]::GetConsoleWindow()',
      'if ($window -ne [IntPtr]::Zero -and [NativeConsole]::IsWindowVisible($window)) { exit 42 }',
      'exit 0',
    ].join('; ');
    const nodeScript = [
      "const { spawnSync } = require('node:child_process');",
      'const child = spawnSync(process.argv[1],',
      "['-NoLogo','-NoProfile','-NonInteractive','-Command',process.argv[2]],",
      "{ stdio: 'inherit', windowsHide: false });",
      'process.exit(child.status ?? 43);',
    ].join('');
    const launch = wrapAcpLaunchForPrivateDesktop(
      process.execPath,
      ['-e', nodeScript, powershell, inspectConsole],
      true,
      createAcpPrivateDesktopProbe(),
    );
    expect(launch.status).toBe('private-desktop');
    if (launch.status !== 'private-desktop') {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      execFile(
        launch.command,
        launch.args,
        { windowsHide: true, timeout: CHILD_PROCESS_TIMEOUT_MS },
        (error, _output, stderr) => {
          if (error) {
            reject(new Error(`${error.message}\n${stderr}`));
            return;
          }
          resolve();
        },
      );
    });
  }, PROCESS_LAUNCH_TIMEOUT_MS);

  it('does nothing unless the user explicitly opts in', () => {
    expect(wrapAcpLaunchForPrivateDesktop('node.exe', ['agent.js'], false, PROBE)).toEqual({
      status: 'ordinary',
      command: 'node.exe',
      args: ['agent.js'],
    });
  });

  it('does nothing on non-Windows platforms', () => {
    expect(wrapAcpLaunchForPrivateDesktop(
      '/usr/bin/node',
      ['agent.js'],
      true,
      { ...PROBE, platform: 'linux' },
    ).status).toBe('ordinary');
  });

  it('passes argv through a fixed separator without introducing a shell', () => {
    expect(wrapAcpLaunchForPrivateDesktop(
      'C:\\Program Files\\nodejs\\node.exe',
      ['C:\\agent path\\main.js', '--acp'],
      true,
      PROBE,
    )).toEqual({
      status: 'private-desktop',
      command: PROBE.helperPath,
      args: ['--', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\agent path\\main.js', '--acp'],
    });
  });

  it('fails closed when the reviewed helper is missing or changed', () => {
    const missing = wrapAcpLaunchForPrivateDesktop(
      'node.exe',
      [],
      true,
      { ...PROBE, fileExists: () => false },
    );
    expect(missing).toMatchObject({ status: 'unavailable' });
    expect(missing.status === 'unavailable' ? missing.reason : '').toMatch(/reinstall|uncheck/i);

    const changed = wrapAcpLaunchForPrivateDesktop(
      'node.exe',
      [],
      true,
      { ...PROBE, sha256: () => 'changed' },
    );
    expect(changed).toMatchObject({ status: 'unavailable' });
    expect(changed.status === 'unavailable' ? changed.reason : '').toMatch(/SHA-256/);
  });
});

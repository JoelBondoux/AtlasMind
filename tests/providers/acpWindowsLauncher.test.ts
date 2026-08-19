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
 *
 * The child budget was 10s until the deepest test was killed at 10034ms on a
 * cold Windows runner — the `Add-Type` C# compile alone can spend most of it.
 * A budget a healthy run lands just under is a scheduled flake, so it is now
 * wide enough that only a genuinely hung tree reaches it. Nothing these tests
 * assert changed; only how long a slow machine is allowed to take.
 */
const CHILD_PROCESS_TIMEOUT_MS = 30_000;
const PROCESS_LAUNCH_TIMEOUT_MS = 90_000;

/**
 * Launch one real process tree and fail with a diagnosis, not a bare
 * "Command failed".
 *
 * `execFile` reports a timeout kill and a non-zero exit identically — same
 * message shape, and for these children an empty stderr either way. So a slow
 * runner and the boundary genuinely leaking a visible console produced the same
 * red, which is the failure that cost an afternoon: the log said only "Command
 * failed" and the duration was the only clue which had happened. A timeout now
 * names itself, and a known exit code is translated into what it means.
 */
function runLaunch(
  command: string,
  args: readonly string[],
  exitCodeMeanings: Readonly<Record<number, string>> = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      [...args],
      { windowsHide: true, timeout: CHILD_PROCESS_TIMEOUT_MS },
      (error, output, stderr) => {
        if (!error) {
          resolve(output);
          return;
        }
        const killed = (error as { killed?: boolean }).killed === true;
        const code = (error as { code?: unknown }).code;
        const meaning = typeof code === 'number' ? exitCodeMeanings[code] : undefined;
        reject(new Error([
          killed
            ? `The process tree was still running after ${CHILD_PROCESS_TIMEOUT_MS}ms and was killed. `
              + 'That is this machine being slow, not the launch boundary refusing.'
            : meaning
              ? `The launch boundary failed: ${meaning} (exit ${String(code)}).`
              : error.message,
          stderr,
        ].filter(Boolean).join(String.fromCharCode(10))));
      },
    );
  });
}

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

  /*
   * The command interpreter is the *vehicle* for this test, not its subject:
   * it needs any real executable that writes a known string to stdout, and
   * `ComSpec` is the one Windows always has. So its absence is a reason not to
   * run, never a failure — asserting on it made an environment that does not
   * export it report a defect in the launch wrapper.
   *
   * Which is exactly what happened under Stryker: its workers do not inherit
   * `ComSpec`, so this failed during the initial test run and Stryker refuses
   * to mutate a suite that is already red. `npm run test:mutation` has been
   * unable to start on Windows because of it, while the same test passes under
   * a plain `vitest run`.
   */
  const commandInterpreter = process.platform === 'win32' ? process.env.ComSpec : undefined;

  it.skipIf(!commandInterpreter)('runs the shipped helper and preserves redirected stdio', async () => {
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

    const stdout = await runLaunch(launch.command, launch.args);

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

    await runLaunch(launch.command, launch.args);
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

    await runLaunch(launch.command, launch.args, {
      42: 'the inherited console window was visible, so the private desktop did not contain it',
      43: 'the nested PowerShell child never reported an exit status',
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

import { describe, expect, it } from 'vitest';
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

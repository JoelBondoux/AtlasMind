import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  PresenceManager,
  buildInhibitCommand,
  computeDesired,
  clampMaxAwakeMinutes,
  type PresenceTimers,
} from '../../src/core/presenceManager.ts';

// ── Fakes ──────────────────────────────────────────────────────────────────

function fakeChild(): any {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = (): boolean => { child.killed = true; child.emit('close', null, 'SIGTERM'); return true; };
  return child;
}

function fakeSpawn(): any {
  const calls: Array<{ command: string; args: string[] }> = [];
  const children: any[] = [];
  const fn: any = (command: string, args: string[]) => {
    const child = fakeChild();
    calls.push({ command, args });
    children.push(child);
    return child;
  };
  fn.calls = calls;
  fn.children = children;
  return fn;
}

const noopTimers: PresenceTimers = {
  setInterval: () => 0,
  clearInterval: () => { /* noop */ },
  setTimeout: () => 0,
  clearTimeout: () => { /* noop */ },
};

function controllableTimers(): { timers: PresenceTimers; fireTimeout: () => void } {
  let cb: (() => void) | undefined;
  return {
    timers: {
      setInterval: () => 0,
      clearInterval: () => { /* noop */ },
      setTimeout: (fn: () => void) => { cb = fn; return 1; },
      clearTimeout: () => { cb = undefined; },
    },
    // One-shot like a real timer: firing consumes the pending callback.
    fireTimeout: () => { const f = cb; cb = undefined; f?.(); },
  };
}

const tick = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('buildInhibitCommand', () => {
  it('builds a SetThreadExecutionState PowerShell loop on Windows', () => {
    const cmd = buildInhibitCommand('win32', { hostPid: 4242 })!;
    expect(cmd.command).toBe('powershell.exe');
    expect(cmd.args).toContain('-NoProfile');
    expect(cmd.args).toContain('-NonInteractive');
    const script = cmd.args[cmd.args.length - 1];
    // ES_CONTINUOUS(0x80000000) | ES_SYSTEM_REQUIRED(0x1) = 2147483649
    expect(script).toContain('[uint32]2147483649');
    expect(script).toContain('SetThreadExecutionState');
    expect(script).toContain('$hp=4242'); // parent-PID orphan guard
  });

  it('adds ES_DISPLAY_REQUIRED on Windows when keepDisplayAwake', () => {
    const script = buildInhibitCommand('win32', { keepDisplayAwake: true })!.args.at(-1)!;
    // | ES_DISPLAY_REQUIRED(0x2) = 2147483651
    expect(script).toContain('[uint32]2147483651');
  });

  it('uses caffeinate -i -w on macOS, adding -d for display', () => {
    expect(buildInhibitCommand('darwin', { hostPid: 99 })).toEqual({ command: 'caffeinate', args: ['-i', '-w', '99'] });
    expect(buildInhibitCommand('darwin', { keepDisplayAwake: true, hostPid: 99 }))
      .toEqual({ command: 'caffeinate', args: ['-d', '-i', '-w', '99'] });
  });

  it('uses systemd-inhibit blocking only idle:sleep on Linux', () => {
    const cmd = buildInhibitCommand('linux')!;
    expect(cmd.command).toBe('systemd-inhibit');
    expect(cmd.args).toContain('--what=idle:sleep');
    expect(cmd.args).toContain('--mode=block');
    expect(cmd.args.slice(-2)).toEqual(['sleep', 'infinity']); // no host PID → plain keeper
    // Never blocks shutdown.
    expect(cmd.args.some((a) => a.includes('shutdown'))).toBe(false);
  });

  it('adds a host-PID orphan guard on Linux when the host PID is known', () => {
    const cmd = buildInhibitCommand('linux', { hostPid: 321 })!;
    // The wrapped command exits (releasing the inhibitor) if the host dies.
    expect(cmd.args.slice(-3)).toEqual(['sh', '-c', 'while kill -0 321 2>/dev/null; do sleep 30; done']);
  });

  it('returns undefined for unsupported platforms', () => {
    expect(buildInhibitCommand('aix' as NodeJS.Platform)).toBeUndefined();
  });

  it('ignores a non-positive or non-integer hostPid', () => {
    expect(buildInhibitCommand('darwin', { hostPid: 0 })).toEqual({ command: 'caffeinate', args: ['-i'] });
    expect(buildInhibitCommand('darwin', { hostPid: -5 })).toEqual({ command: 'caffeinate', args: ['-i'] });
  });
});

describe('computeDesired', () => {
  it('requires a reason, support, the AC gate, and no fired backstop', () => {
    expect(computeDesired(1, true, true, false)).toBe(true);
    expect(computeDesired(0, true, true, false)).toBe(false); // no reason
    expect(computeDesired(1, false, true, false)).toBe(false); // unsupported
    expect(computeDesired(1, true, false, false)).toBe(false); // on battery
    expect(computeDesired(1, true, true, true)).toBe(false); // backstop fired
  });
});

describe('clampMaxAwakeMinutes', () => {
  it('clamps into [0, 1440] and defaults NaN to 240', () => {
    expect(clampMaxAwakeMinutes(60)).toBe(60);
    expect(clampMaxAwakeMinutes(-5)).toBe(0);
    expect(clampMaxAwakeMinutes(99999)).toBe(1440);
    expect(clampMaxAwakeMinutes(Number.NaN)).toBe(240);
  });
});

// ── Manager behaviour ────────────────────────────────────────────────────────

describe('PresenceManager', () => {
  it('acquires the wake lock when keepAwake turns on and releases it when off', () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', hostPid: 7, timers: noopTimers });

    expect(mgr.isAwake()).toBe(false);
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(mgr.isAwake()).toBe(true);
    expect(spawn.calls[0]).toEqual({ command: 'caffeinate', args: ['-i', '-w', '7'] });

    mgr.applyConfig({ keepAwake: false, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(mgr.isAwake()).toBe(false);
    expect(spawn.children[0].killed).toBe(true);
    mgr.dispose();
  });

  it('does not acquire when the setting is off', () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers: noopTimers });
    mgr.applyConfig({ keepAwake: false, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(mgr.isAwake()).toBe(false);
    expect(spawn.calls).toHaveLength(0);
    mgr.dispose();
  });

  it('holds and releases activity reasons independently of the setting', () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({ spawn, platform: 'linux', timers: noopTimers });
    // acPowerOnly default true, but Linux AC detection is unknown → treated as AC.
    mgr.applyConfig({ keepAwake: false, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(mgr.isAwake()).toBe(false);

    mgr.hold('mission-loop');
    expect(mgr.isAwake()).toBe(true);
    mgr.hold('buzz'); // second reason does not spawn a second helper
    expect(spawn.calls).toHaveLength(1);

    mgr.release('mission-loop');
    expect(mgr.isAwake()).toBe(true); // still held by 'buzz'
    mgr.release('buzz');
    expect(mgr.isAwake()).toBe(false);
    mgr.dispose();
  });

  it('suspends keep-awake on battery when acPowerOnly is set', async () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({
      spawn,
      platform: 'darwin',
      timers: noopTimers,
      detectAcPower: async () => false, // on battery
    });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: true, maxAwakeMinutes: 0 });
    await tick();
    expect(mgr.isAwake()).toBe(false);
    expect(mgr.getState().suspended).toBe('battery');

    mgr.dispose();
  });

  it('auto-releases when the maxAwakeMinutes backstop fires', () => {
    const spawn = fakeSpawn();
    const { timers, fireTimeout } = controllableTimers();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers, hostPid: 1 });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 240 });
    expect(mgr.isAwake()).toBe(true);

    fireTimeout(); // simulate the backstop deadline
    expect(mgr.isAwake()).toBe(false);
    expect(mgr.getState().suspended).toBe('backstop');
    mgr.dispose();
  });

  it('reports unsupported platforms without spawning', () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({ spawn, platform: 'aix' as NodeJS.Platform, timers: noopTimers });
    expect(mgr.isSupported()).toBe(false);
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(mgr.isAwake()).toBe(false);
    expect(spawn.calls).toHaveLength(0);
    mgr.dispose();
  });

  it('marks unavailable and stops trying when the helper is missing (ENOENT)', () => {
    const spawn: any = () => { const c = fakeChild(); queueMicrotask(() => c.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' }))); return c; };
    spawn.calls = [];
    const mgr = new PresenceManager({ spawn, platform: 'linux', timers: noopTimers });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    // The spawn returned a child but it immediately errors ENOENT → unavailable.
    return Promise.resolve().then(() => {
      expect(mgr.getState().suspended).toBe('unsupported');
      mgr.dispose();
    });
  });

  it('notifies listeners on state change', () => {
    const spawn = fakeSpawn();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers: noopTimers });
    const states: boolean[] = [];
    const sub = mgr.onDidChange((s) => states.push(s.active));
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    expect(states.at(-1)).toBe(true);
    sub.dispose();
    mgr.dispose();
  });

  it('gives up after repeated fast helper deaths instead of respawn-looping forever (F9)', () => {
    const spawn = fakeSpawn();
    const { timers, fireTimeout } = controllableTimers();
    // Fixed clock so every helper "dies fast" (< STABLE_RUN_MS) and failures accumulate.
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers, now: () => 1000, hostPid: 1 });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    for (let i = 0; i < 6; i++) {
      const child = spawn.children[spawn.children.length - 1];
      child.emit('close', 1, null); // unexpected death (signal null)
      fireTimeout(); // let any scheduled respawn run
    }
    expect(mgr.getState().suspended).toBe('unsupported'); // gave up, did not loop
    expect(spawn.calls.length).toBeLessThanOrEqual(5); // bounded respawns
    mgr.dispose();
  });

  it('re-arms the backstop when maxAwakeMinutes changes mid-hold (F1/F10)', () => {
    const spawn = fakeSpawn();
    const { timers } = controllableTimers();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers, now: () => 1000, hostPid: 1 });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 }); // no cap
    expect(mgr.getState().active).toBe(true);
    expect(mgr.getState().expiresAt).toBeUndefined();

    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 60 }); // now cap 60m
    expect(mgr.getState().active).toBe(true);
    expect(mgr.getState().expiresAt).toBe(1000 + 60 * 60_000);
    mgr.dispose();
  });

  it('does not re-acquire after dispose even with a pending respawn (F6)', () => {
    const spawn = fakeSpawn();
    const { timers, fireTimeout } = controllableTimers();
    const mgr = new PresenceManager({ spawn, platform: 'darwin', timers, now: () => 1000 });
    mgr.applyConfig({ keepAwake: true, acPowerOnly: false, maxAwakeMinutes: 0 });
    spawn.children[0].emit('close', 1, null); // schedules a respawn
    const before = spawn.calls.length;
    mgr.dispose();
    fireTimeout(); // a leftover respawn must not fire an acquire post-dispose
    expect(spawn.calls.length).toBe(before);
  });
});

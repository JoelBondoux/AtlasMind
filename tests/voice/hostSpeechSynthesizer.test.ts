import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { HostSpeechSynthesizer } from '../../src/voice/hostSpeechSynthesizer';
import type { VoiceSettings } from '../../src/types';

const baseSettings: VoiceSettings = {
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  sttEnabled: false,
  language: '',
  inputDeviceId: '',
  outputDeviceId: '',
};

interface Captured {
  command?: string;
  args?: string[];
  stdin?: string;
  killed?: boolean;
}

/** Build a fake spawn that records the invocation and emits `close` with `exitCode`. */
function makeFakeSpawn(captured: Captured, exitCode: number | null = 0) {
  return ((command: string, args: string[]) => {
    captured.command = command;
    captured.args = args;
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child['stdin'] = { end: (data: string) => { captured.stdin = data; }, on: () => undefined };
    child['stderr'] = new EventEmitter();
    child['kill'] = () => { captured.killed = true; child.emit('close', null, 'SIGTERM'); };
    // Emit close after the caller has attached its handlers and written stdin.
    queueMicrotask(() => {
      if (!captured.killed) { child.emit('close', exitCode, null); }
    });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
}

describe('HostSpeechSynthesizer', () => {
  it('reports support only for win32/darwin/linux', () => {
    expect(new HostSpeechSynthesizer({ platform: 'win32' }).isSupported()).toBe(true);
    expect(new HostSpeechSynthesizer({ platform: 'darwin' }).isSupported()).toBe(true);
    expect(new HostSpeechSynthesizer({ platform: 'linux' }).isSupported()).toBe(true);
    expect(new HostSpeechSynthesizer({ platform: 'aix' as NodeJS.Platform }).isSupported()).toBe(false);
  });

  it('throws on an unsupported platform', async () => {
    const synth = new HostSpeechSynthesizer({ platform: 'aix' as NodeJS.Platform });
    await expect(synth.speak('hi', baseSettings)).rejects.toThrow(/not supported/);
  });

  it('is a no-op for empty text', async () => {
    const captured: Captured = {};
    const synth = new HostSpeechSynthesizer({ platform: 'win32', spawn: makeFakeSpawn(captured) });
    await synth.speak('   ', baseSettings);
    expect(captured.command).toBeUndefined();
  });

  it('builds a Windows PowerShell command and passes text via stdin only', async () => {
    const captured: Captured = {};
    const synth = new HostSpeechSynthesizer({ platform: 'win32', spawn: makeFakeSpawn(captured) });
    await synth.speak('hello world', { ...baseSettings, rate: 1.5, volume: 0.5 });

    expect(captured.command).toBe('powershell.exe');
    expect(captured.args).toContain('-NonInteractive');
    const script = captured.args?.[captured.args.indexOf('-Command') + 1] ?? '';
    expect(script).toContain('System.Speech');
    expect(script).toContain('$synth.Rate = 5'); // (1.5-1)*10 = 5
    expect(script).toContain('$synth.Volume = 50');
    // Critically: the spoken text must NOT appear in the command/args.
    expect(JSON.stringify(captured.args)).not.toContain('hello world');
    expect(captured.stdin).toBe('hello world');
  });

  it('builds a macOS say command with rate flag and stdin volume prefix', async () => {
    const captured: Captured = {};
    const synth = new HostSpeechSynthesizer({ platform: 'darwin', spawn: makeFakeSpawn(captured) });
    await synth.speak('hey there', { ...baseSettings, rate: 2.0, volume: 0.8 });

    expect(captured.command).toBe('say');
    expect(captured.args).toEqual(['-r', '350']); // 175*2
    expect(captured.stdin).toBe('[[volm 0.80]] hey there');
  });

  it('builds a Linux espeak-ng command reading stdin', async () => {
    const captured: Captured = {};
    const synth = new HostSpeechSynthesizer({ platform: 'linux', spawn: makeFakeSpawn(captured) });
    await synth.speak('linux speech', baseSettings);

    expect(captured.command).toBe('espeak-ng');
    expect(captured.args).toContain('--stdin');
    expect(captured.stdin).toBe('linux speech');
  });

  it('rejects when the speech process exits non-zero', async () => {
    const captured: Captured = {};
    const synth = new HostSpeechSynthesizer({ platform: 'win32', spawn: makeFakeSpawn(captured, 1) });
    await expect(synth.speak('boom', baseSettings)).rejects.toThrow(/exited with code 1/);
  });

  it('stop() kills the active process and resolves the pending speak', async () => {
    const captured: Captured = {};
    // exitCode irrelevant; we kill before the microtask close fires.
    const synth = new HostSpeechSynthesizer({ platform: 'darwin', spawn: makeFakeSpawn(captured) });
    const promise = synth.speak('long sentence', baseSettings);
    synth.stop();
    await expect(promise).resolves.toBeUndefined();
    expect(captured.killed).toBe(true);
  });
});

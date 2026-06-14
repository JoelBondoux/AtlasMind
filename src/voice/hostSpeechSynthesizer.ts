import { spawn, type ChildProcess } from 'node:child_process';
import * as os from 'node:os';
import type { VoiceSettings } from '../types.js';

/** Minimal subset of `child_process.spawn` used here; injectable for tests. */
export type SpawnLike = typeof spawn;

/** Dependencies for {@link HostSpeechSynthesizer}; all optional and injectable for tests. */
export interface HostSpeechDeps {
  spawn?: SpawnLike;
  platform?: NodeJS.Platform;
}

/** A fully-resolved OS speech command. */
interface SpeechCommand {
  command: string;
  args: string[];
  /** Text written to the child's stdin so it is never parsed as shell/script. */
  stdin: string;
}

/**
 * Host-side text-to-speech using the operating system's built-in speech engine.
 *
 * Unlike the webview Web Speech API or ElevenLabs, this runs entirely in the
 * extension host with no network access and no API key:
 *  - Windows: PowerShell `System.Speech.Synthesis.SpeechSynthesizer` (SAPI voices).
 *  - macOS:   the `say` command.
 *  - Linux:   `espeak-ng` (must be installed).
 *
 * Security: the spoken text is **always** delivered over stdin, never interpolated
 * into a command line or script. Only validated, clamped integers are interpolated
 * into the (fixed) PowerShell script or passed as numeric CLI flags. Processes are
 * spawned without a shell, so argument values are not subject to shell parsing.
 */
export class HostSpeechSynthesizer {
  private readonly _spawn: SpawnLike;
  private readonly _platform: NodeJS.Platform;
  private _current: ChildProcess | undefined;

  constructor(deps: HostSpeechDeps = {}) {
    this._spawn = deps.spawn ?? spawn;
    this._platform = deps.platform ?? os.platform();
  }

  /** Whether a host speech backend exists for the current platform. */
  public isSupported(): boolean {
    return this._platform === 'win32' || this._platform === 'darwin' || this._platform === 'linux';
  }

  /**
   * Speak `text` using the OS engine, resolving when playback finishes.
   * Any in-progress utterance is cancelled first. Rejects if the backend is
   * unavailable or the speech process exits with a non-zero code.
   */
  public async speak(text: string, settings: VoiceSettings): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) { return; }
    if (!this.isSupported()) {
      throw new Error(`Host speech synthesis is not supported on platform "${this._platform}".`);
    }

    const plan = this._buildCommand(trimmed, settings);
    this.stop();

    await new Promise<void>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this._spawn(plan.command, plan.args, { stdio: ['pipe', 'ignore', 'pipe'] });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this._current = child;

      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 4096) { stderr += chunk.toString(); }
      });
      child.on('error', (err) => {
        if (this._current === child) { this._current = undefined; }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      child.on('close', (code, signal) => {
        if (this._current === child) { this._current = undefined; }
        if (signal) { resolve(); return; } // cancelled via stop()
        if (code === 0 || code === null) { resolve(); return; }
        reject(new Error(`Speech process exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
      });

      // Deliver the spoken text over stdin only. Ignore EPIPE if the child exits early.
      child.stdin?.on('error', () => { /* ignore */ });
      child.stdin?.end(plan.stdin);
    });
  }

  /** Cancel any in-progress utterance. */
  public stop(): void {
    if (this._current) {
      try { this._current.kill(); } catch { /* ignore */ }
      this._current = undefined;
    }
  }

  public dispose(): void {
    this.stop();
  }

  // ── Per-platform command construction ────────────────────────────────────

  private _buildCommand(text: string, settings: VoiceSettings): SpeechCommand {
    switch (this._platform) {
      case 'win32': return this._windowsCommand(text, settings);
      case 'darwin': return this._macCommand(text, settings);
      default: return this._linuxCommand(text, settings);
    }
  }

  private _windowsCommand(text: string, settings: VoiceSettings): SpeechCommand {
    // System.Speech rate is an integer in [-10, 10] where 0 is normal.
    const rate = clampInt(
      settings.rate >= 1 ? Math.round((settings.rate - 1) * 10) : Math.round((settings.rate - 1) * 20),
      -10,
      10,
    );
    const volume = clampInt(Math.round(settings.volume * 100), 0, 100);
    // Fixed script: only the validated integers above are interpolated. The
    // spoken text is read from stdin via [Console]::In, so it is never parsed.
    const script = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$synth.Rate = ${rate}`,
      `$synth.Volume = ${volume}`,
      '$text = [Console]::In.ReadToEnd()',
      'if ($text) { $synth.Speak($text) }',
    ].join('; ');
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', script],
      stdin: text,
    };
  }

  private _macCommand(text: string, settings: VoiceSettings): SpeechCommand {
    // `say` rate is words-per-minute; ~175 wpm is the default speaking rate.
    const wpm = clampInt(Math.round(175 * settings.rate), 80, 400);
    const volume = clamp(settings.volume, 0, 1);
    // Volume is applied with an inline `say` command prefix; the text follows on stdin.
    return {
      command: 'say',
      args: ['-r', String(wpm)],
      stdin: `[[volm ${volume.toFixed(2)}]] ${text}`,
    };
  }

  private _linuxCommand(text: string, settings: VoiceSettings): SpeechCommand {
    const wpm = clampInt(Math.round(175 * settings.rate), 80, 450);
    const amplitude = clampInt(Math.round(settings.volume * 200), 0, 200);
    const pitch = clampInt(Math.round(settings.pitch * 50), 0, 99);
    return {
      command: 'espeak-ng',
      args: ['-s', String(wpm), '-a', String(amplitude), '-p', String(pitch), '--stdin'],
      stdin: text,
    };
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) { return min; }
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

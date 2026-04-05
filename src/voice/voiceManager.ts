import * as vscode from 'vscode';
import type { VoiceSettings } from '../types.js';

/**
 * Message types sent from the extension host → VoicePanel webview.
 */
export type HostToVoiceMessage =
  | { type: 'speak'; text: string; settings: VoiceSettings }
  | { type: 'stopSpeaking' }
  | { type: 'startListening' }
  | { type: 'stopListening' }
  | { type: 'settingsUpdated'; settings: VoiceSettings };

/**
 * Message types sent from VoicePanel webview → extension host.
 */
export type VoiceToHostMessage =
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'speechError'; message: string }
  | { type: 'updateSetting'; key: 'rate' | 'pitch' | 'volume' | 'language'; value: number | string }
  | { type: 'openChatView' }
  | { type: 'openSettingsModels' }
  | { type: 'openSpecialistIntegrations' }
  | { type: 'ready' };

/**
 * VoiceManager bridges TTS/STT between the extension host and the VoicePanel webview.
 *
 * - `speak(text)` queues text for synthesis and forwards it to the panel when open.
 * - `startListening()` / `stopListening()` controls speech recognition in the webview.
 * - Incoming transcripts fire the `onTranscript` event.
 */
export class VoiceManager implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private readonly _pendingQueue: string[] = [];
  private readonly _onTranscript = new vscode.EventEmitter<{ text: string; final: boolean }>();
  private readonly _disposables: vscode.Disposable[] = [];

  /** Fires when the STT engine produces a (possibly partial) transcript. */
  public readonly onTranscript = this._onTranscript.event;

  constructor() {
    this._disposables.push(this._onTranscript);
  }

  /**
   * Attach (or replace) the webview panel.
   * Called by VoicePanel after creating the webview.
   */
  public attachPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;

    panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isVoiceToHostMessage(raw)) { return; }
        if (raw.type === 'ready') {
          this._flushQueue();
        }
        if (raw.type === 'transcript') {
          this._onTranscript.fire({ text: raw.text, final: raw.final });
          if (raw.final && raw.text.trim().length > 0) {
            void vscode.env.clipboard.writeText(raw.text.trim());
            void vscode.window.setStatusBarMessage('AtlasMind Voice: transcript copied to clipboard.', 3000);
          }
        }
        if (raw.type === 'speechError') {
          vscode.window.showWarningMessage(`AtlasMind Voice: ${raw.message}`);
        }
        if (raw.type === 'updateSetting') {
          void this._updateSetting(raw.key, raw.value);
        }
        if (raw.type === 'openChatView') {
          void vscode.commands.executeCommand('atlasmind.openChatView');
        }
        if (raw.type === 'openSettingsModels') {
          void vscode.commands.executeCommand('atlasmind.openSettingsModels');
        }
        if (raw.type === 'openSpecialistIntegrations') {
          void vscode.commands.executeCommand('atlasmind.openSpecialistIntegrations');
        }
      },
      null,
      this._disposables,
    );

    panel.onDidDispose(() => {
      this._panel = undefined;
    }, null, this._disposables);

    // If panel opens while items are queued, flush once 'ready' fires.
    // As a fallback also attempt immediately (panel may already be ready).
    this._flushQueue();
  }

  /**
   * Queue text for TTS synthesis.
   * If the panel is open the text is spoken immediately; otherwise it is
   * held until the panel opens and signals `ready`.
   */
  public speak(text: string): void {
    if (!text.trim()) { return; }
    if (this._panel) {
      const settings = this._readSettings();
      void this._panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
    } else {
      // Queue for when panel opens
      this._pendingQueue.push(text);
    }
  }

  /** Stop any ongoing TTS synthesis in the panel. */
  public stopSpeaking(): void {
    if (!this._panel) { return; }
    void this._panel.webview.postMessage({ type: 'stopSpeaking' } satisfies HostToVoiceMessage);
  }

  /** Tell the panel to start the microphone (STT). */
  public startListening(): void {
    if (!this._panel) { return; }
    void this._panel.webview.postMessage({ type: 'startListening' } satisfies HostToVoiceMessage);
  }

  /** Tell the panel to stop the microphone (STT). */
  public stopListening(): void {
    if (!this._panel) { return; }
    void this._panel.webview.postMessage({ type: 'stopListening' } satisfies HostToVoiceMessage);
  }

  /** Push the current voice settings to the panel so it can update its UI. */
  public syncSettings(): void {
    if (!this._panel) { return; }
    void this._panel.webview.postMessage({
      type: 'settingsUpdated',
      settings: this._readSettings(),
    } satisfies HostToVoiceMessage);
  }

  public dispose(): void {
    for (const d of this._disposables) { d.dispose(); }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _flushQueue(): void {
    if (!this._panel || this._pendingQueue.length === 0) { return; }
    const settings = this._readSettings();
    for (const text of this._pendingQueue.splice(0)) {
      void this._panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
    }
  }

  private _readSettings(): VoiceSettings {
    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    return {
      rate: clamp(cfg.get<number>('rate', 1.0), 0.5, 2.0),
      pitch: clamp(cfg.get<number>('pitch', 1.0), 0, 2),
      volume: clamp(cfg.get<number>('volume', 1.0), 0, 1),
      language: sanitiseLanguage(cfg.get<string>('language', '')),
    };
  }

  private async _updateSetting(
    key: 'rate' | 'pitch' | 'volume' | 'language',
    value: number | string,
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind.voice');
    switch (key) {
      case 'language':
        await configuration.update('language', sanitiseLanguage(String(value)), vscode.ConfigurationTarget.Workspace);
        break;
      case 'rate':
        await configuration.update('rate', clamp(Number(value), 0.5, 2), vscode.ConfigurationTarget.Workspace);
        break;
      case 'pitch':
        await configuration.update('pitch', clamp(Number(value), 0, 2), vscode.ConfigurationTarget.Workspace);
        break;
      case 'volume':
        await configuration.update('volume', clamp(Number(value), 0, 1), vscode.ConfigurationTarget.Workspace);
        break;
    }

    this.syncSettings();
  }
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isVoiceToHostMessage(value: unknown): value is VoiceToHostMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) { return false; }
  const m = value as Record<string, unknown>;
  if (m['type'] === 'ready') { return true; }
  if (m['type'] === 'transcript') {
    return typeof m['text'] === 'string' && typeof m['final'] === 'boolean';
  }
  if (m['type'] === 'speechError') {
    return typeof m['message'] === 'string';
  }
  if (m['type'] === 'updateSetting') {
    const key = m['key'];
    const valueField = m['value'];
    const validKey = key === 'rate' || key === 'pitch' || key === 'volume' || key === 'language';
    return validKey && (typeof valueField === 'number' || typeof valueField === 'string');
  }
  if (m['type'] === 'openChatView' || m['type'] === 'openSettingsModels' || m['type'] === 'openSpecialistIntegrations') {
    return true;
  }
  return false;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) { return min; }
  return Math.min(max, Math.max(min, value));
}

/** Only allow BCP 47 language tags (e.g., "en-US", "fr-FR") or empty string. */
function sanitiseLanguage(value: string): string {
  if (typeof value !== 'string') { return ''; }
  const trimmed = value.trim();
  if (trimmed === '') { return ''; }
  // BCP 47 pattern: 2-3 letter language tag with optional subtags
  if (/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

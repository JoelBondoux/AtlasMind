import * as vscode from 'vscode';
import type { VoiceSettings } from '../types.js';

const ELEVENLABS_DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" – ElevenLabs default demo voice
const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/** Minimal subset of the Fetch API needed by the ElevenLabs TTS integration. */
type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
const ELEVENLABS_SECRET_KEY = 'atlasmind.integration.elevenlabs.apiKey';

/**
 * Message types sent from the extension host → VoicePanel webview.
 */
export type HostToVoiceMessage =
  | { type: 'speak'; text: string; settings: VoiceSettings }
  | { type: 'playAudio'; base64: string; mimeType: string }
  | { type: 'stopSpeaking' }
  | { type: 'startListening' }
  | { type: 'stopListening' }
  | { type: 'settingsUpdated'; settings: VoiceSettings }
  | { type: 'elevenLabsStatus'; available: boolean };

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
 *   When an ElevenLabs API key is configured, speech is synthesised server-side and
 *   streamed to the webview as base64-encoded PCM/MP3 audio (playAudio message).
 *   Falls back to the Web Speech API when no ElevenLabs key is available.
 * - `startListening()` / `stopListening()` controls speech recognition in the webview.
 * - Incoming transcripts fire the `onTranscript` event.
 */
export class VoiceManager implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | undefined;
  private readonly _pendingQueue: string[] = [];
  private readonly _onTranscript = new vscode.EventEmitter<{ text: string; final: boolean }>();
  private readonly _disposables: vscode.Disposable[] = [];
  private _secrets: vscode.SecretStorage | undefined;

  /** Fires when the STT engine produces a (possibly partial) transcript. */
  public readonly onTranscript = this._onTranscript.event;

  constructor(secrets?: vscode.SecretStorage) {
    this._secrets = secrets;
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
          // Notify the panel whether ElevenLabs TTS is available
          void this._notifyElevenLabsStatus(panel);
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
   * When an ElevenLabs API key is configured the audio is synthesised server-side
   * and delivered to the webview as a base64-encoded MP3 (playAudio message).
   * Falls back to the Web Speech API speak message otherwise.
   */
  public speak(text: string): void {
    if (!text.trim()) { return; }
    if (this._panel) {
      void this._speakWithPanel(this._panel, text);
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

  private async _speakWithPanel(panel: vscode.WebviewPanel, text: string): Promise<void> {
    const elevenLabsKey = await this._getElevenLabsKey();
    if (elevenLabsKey) {
      await this._speakElevenLabs(panel, text, elevenLabsKey);
    } else {
      const settings = this._readSettings();
      void panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
    }
  }

  private async _speakElevenLabs(panel: vscode.WebviewPanel, text: string, apiKey: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    const voiceId = cfg.get<string>('elevenLabsVoiceId', '') || ELEVENLABS_DEFAULT_VOICE_ID;
    const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}`;

    try {
      const fetchImpl = (globalThis as typeof globalThis & { fetch?: FetchLike }).fetch;

      if (!fetchImpl) {
        // Fallback to Web Speech API if fetch is unavailable
        const settings = this._readSettings();
        void panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
        return;
      }

      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });

      if (!response.ok) {
        // API error — fall back to Web Speech API
        vscode.window.showWarningMessage(
          `AtlasMind Voice: ElevenLabs API returned status ${response.status}. Falling back to Web Speech API.`,
        );
        const settings = this._readSettings();
        void panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
        return;
      }

      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      void panel.webview.postMessage({
        type: 'playAudio',
        base64,
        mimeType: 'audio/mpeg',
      } satisfies HostToVoiceMessage);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`AtlasMind Voice: ElevenLabs error — ${message}. Falling back to Web Speech API.`);
      const settings = this._readSettings();
      void panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
    }
  }

  private async _getElevenLabsKey(): Promise<string | undefined> {
    if (!this._secrets) { return undefined; }
    const key = await this._secrets.get(ELEVENLABS_SECRET_KEY);
    return key || undefined;
  }

  private async _notifyElevenLabsStatus(panel: vscode.WebviewPanel): Promise<void> {
    const key = await this._getElevenLabsKey();
    void panel.webview.postMessage({
      type: 'elevenLabsStatus',
      available: Boolean(key),
    } satisfies HostToVoiceMessage);
  }

  private _flushQueue(): void {
    if (!this._panel || this._pendingQueue.length === 0) { return; }
    for (const text of this._pendingQueue.splice(0)) {
      void this._speakWithPanel(this._panel, text);
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

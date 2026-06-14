import * as vscode from 'vscode';
import type { VoiceSettings } from '../types.js';
import { HostSpeechSynthesizer } from './hostSpeechSynthesizer.js';
import { LocalTranscriber, DownloadingWhisperAssetProvider, DEFAULT_MODEL_ID } from './localTranscriber.js';

/** Which speech-to-text backend the webview should drive. */
export type SttEngine = 'webspeech' | 'local';

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
  | { type: 'elevenLabsStatus'; available: boolean }
  | { type: 'sttEngineStatus'; engine: SttEngine }
  | { type: 'sttProgress'; phase: 'preparing' | 'transcribing'; received: number; total: number }
  | { type: 'localTranscript'; text: string };

/**
 * Message types sent from VoicePanel webview → extension host.
 */
export type VoiceToHostMessage =
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'speechError'; message: string }
  | { type: 'audioCaptured'; base64: string }
  | { type: 'updateSetting'; key: 'rate' | 'pitch' | 'volume' | 'language' | 'sttEnabled' | 'inputDeviceId' | 'outputDeviceId'; value: boolean | number | string }
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
  private readonly _hostSynth: HostSpeechSynthesizer;
  private readonly _storageDir: string | undefined;
  private _localTranscriber: LocalTranscriber | undefined;

  /** Fires when the STT engine produces a (possibly partial) transcript. */
  public readonly onTranscript = this._onTranscript.event;

  constructor(
    secrets?: vscode.SecretStorage,
    hostSynth?: HostSpeechSynthesizer,
    options?: { storageDir?: string; localTranscriber?: LocalTranscriber },
  ) {
    this._secrets = secrets;
    this._hostSynth = hostSynth ?? new HostSpeechSynthesizer();
    this._storageDir = options?.storageDir;
    this._localTranscriber = options?.localTranscriber;
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
          // Notify the panel whether ElevenLabs TTS is available and which STT engine to use.
          void this._notifyElevenLabsStatus(panel);
          this._notifySttEngine(panel);
          this._flushQueue();
        }
        if (raw.type === 'transcript') {
          this._deliverTranscript(raw.text, raw.final);
        }
        if (raw.type === 'audioCaptured') {
          void this._handleAudioCaptured(panel, raw.base64);
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
   * Queue text for TTS synthesis. Backends are tried in priority order:
   *  1. ElevenLabs server-side synthesis when an API key is configured (requires the panel).
   *  2. The OS host speech engine when `atlasmind.voice.hostSpeechEnabled` is set and supported
   *     — this works even when the Voice Panel is closed and uses no network.
   *  3. The Web Speech API in the panel (text is queued until the panel opens).
   */
  public speak(text: string): void {
    if (!text.trim()) { return; }
    void this._dispatchSpeak(text);
  }

  /** Stop any ongoing TTS synthesis in the panel and the host engine. */
  public stopSpeaking(): void {
    this._hostSynth.stop();
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
    this._localTranscriber?.stop();
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
    this._notifySttEngine(this._panel);
  }

  public dispose(): void {
    this._hostSynth.stop();
    this._localTranscriber?.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Fire the transcript event and copy final transcripts to the clipboard. */
  private _deliverTranscript(text: string, final: boolean): void {
    this._onTranscript.fire({ text, final });
    if (final && text.trim().length > 0) {
      void vscode.env.clipboard.writeText(text.trim());
      void vscode.window.setStatusBarMessage('AtlasMind Voice: transcript copied to clipboard.', 3000);
    }
  }

  /** Resolve the effective STT engine from settings and platform capability. */
  private _effectiveSttEngine(): SttEngine {
    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    const requested = cfg.get<string>('sttEngine', 'auto');
    if (requested === 'webspeech') { return 'webspeech'; }
    const localViable = process.platform === 'win32' || (cfg.get<string>('whisperCliPath', '').trim().length > 0);
    if (requested === 'local') { return 'local'; }
    // 'auto': prefer on-device whisper where it can be provisioned.
    return localViable ? 'local' : 'webspeech';
  }

  private _notifySttEngine(panel: vscode.WebviewPanel): void {
    void panel.webview.postMessage({
      type: 'sttEngineStatus',
      engine: this._effectiveSttEngine(),
    } satisfies HostToVoiceMessage);
  }

  /** Lazily build the local whisper transcriber from the extension storage dir. */
  private _resolveLocalTranscriber(): LocalTranscriber | undefined {
    if (this._localTranscriber) { return this._localTranscriber; }
    if (!this._storageDir) { return undefined; }
    const assets = new DownloadingWhisperAssetProvider({
      storageDir: this._storageDir,
      whisperCliPath: () => vscode.workspace.getConfiguration('atlasmind.voice').get<string>('whisperCliPath', ''),
    });
    this._localTranscriber = new LocalTranscriber({ assets, storageDir: this._storageDir });
    return this._localTranscriber;
  }

  /** Transcribe webview-captured WAV audio with the local whisper engine. */
  private async _handleAudioCaptured(panel: vscode.WebviewPanel, base64: string): Promise<void> {
    const transcriber = this._resolveLocalTranscriber();
    if (!transcriber) {
      vscode.window.showWarningMessage('AtlasMind Voice: local transcription is unavailable (no storage directory).');
      return;
    }
    let wav: Buffer;
    try {
      wav = Buffer.from(base64, 'base64');
    } catch {
      return;
    }
    if (wav.length === 0) { return; }

    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    const language = sanitiseLanguage(cfg.get<string>('language', ''));
    void panel.webview.postMessage({ type: 'sttProgress', phase: 'transcribing', received: 0, total: 0 } satisfies HostToVoiceMessage);
    try {
      const text = await transcriber.transcribe(wav, {
        modelId: DEFAULT_MODEL_ID,
        language,
        onProgress: (received, total) => {
          void panel.webview.postMessage({ type: 'sttProgress', phase: 'preparing', received, total } satisfies HostToVoiceMessage);
        },
      });
      const trimmed = text.trim();
      void panel.webview.postMessage({ type: 'localTranscript', text: trimmed } satisfies HostToVoiceMessage);
      if (trimmed.length > 0) {
        this._deliverTranscript(trimmed, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Reset the panel's "transcribing…" UI, then surface the error to the user.
      void panel.webview.postMessage({ type: 'localTranscript', text: '' } satisfies HostToVoiceMessage);
      vscode.window.showWarningMessage(`AtlasMind Voice: local transcription failed — ${message}`);
    }
  }

  /** Route a single utterance to the highest-priority available backend. */
  private async _dispatchSpeak(text: string): Promise<void> {
    // 1. ElevenLabs (premium) — synthesised server-side, played back in the panel.
    if (this._panel) {
      const elevenLabsKey = await this._getElevenLabsKey();
      if (elevenLabsKey) {
        await this._speakElevenLabs(this._panel, text, elevenLabsKey);
        return;
      }
    }

    // 2. OS host speech engine — no panel and no network required.
    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    if (cfg.get<boolean>('hostSpeechEnabled', false) && this._hostSynth.isSupported()) {
      try {
        await this._hostSynth.speak(text, this._readSettings());
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(
          `AtlasMind Voice: OS speech engine failed — ${message}. Falling back to the in-panel engine.`,
        );
        // fall through to the Web Speech API path
      }
    }

    // 3. Web Speech API in the panel (queue until the panel is open).
    if (this._panel) {
      const settings = this._readSettings();
      void this._panel.webview.postMessage({ type: 'speak', text, settings } satisfies HostToVoiceMessage);
    } else {
      this._pendingQueue.push(text);
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
      void this._dispatchSpeak(text);
    }
  }

  private _readSettings(): VoiceSettings {
    const cfg = vscode.workspace.getConfiguration('atlasmind.voice');
    return {
      rate: clamp(cfg.get<number>('rate', 1.0), 0.5, 2.0),
      pitch: clamp(cfg.get<number>('pitch', 1.0), 0, 2),
      volume: clamp(cfg.get<number>('volume', 1.0), 0, 1),
      sttEnabled: cfg.get<boolean>('sttEnabled', false),
      language: sanitiseLanguage(cfg.get<string>('language', '')),
      inputDeviceId: sanitiseDeviceId(cfg.get<string>('inputDeviceId', '')),
      outputDeviceId: sanitiseDeviceId(cfg.get<string>('outputDeviceId', '')),
    };
  }

  private async _updateSetting(
    key: 'rate' | 'pitch' | 'volume' | 'language' | 'sttEnabled' | 'inputDeviceId' | 'outputDeviceId',
    value: boolean | number | string,
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('atlasmind.voice');
    switch (key) {
      case 'language':
        await configuration.update('language', sanitiseLanguage(String(value)), vscode.ConfigurationTarget.Workspace);
        break;
      case 'sttEnabled':
        await configuration.update('sttEnabled', Boolean(value), vscode.ConfigurationTarget.Workspace);
        break;
      case 'inputDeviceId':
        await configuration.update('inputDeviceId', sanitiseDeviceId(String(value)), vscode.ConfigurationTarget.Workspace);
        break;
      case 'outputDeviceId':
        await configuration.update('outputDeviceId', sanitiseDeviceId(String(value)), vscode.ConfigurationTarget.Workspace);
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
  if (m['type'] === 'audioCaptured') {
    return typeof m['base64'] === 'string';
  }
  if (m['type'] === 'updateSetting') {
    const key = m['key'];
    const valueField = m['value'];
    const validKey = key === 'rate' || key === 'pitch' || key === 'volume' || key === 'language' || key === 'sttEnabled' || key === 'inputDeviceId' || key === 'outputDeviceId';
    return validKey && (typeof valueField === 'boolean' || typeof valueField === 'number' || typeof valueField === 'string');
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

function sanitiseDeviceId(value: string): string {
  if (typeof value !== 'string') { return ''; }
  const trimmed = value.trim();
  if (trimmed.length === 0) { return ''; }
  return trimmed.slice(0, 512);
}

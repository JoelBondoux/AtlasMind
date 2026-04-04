import * as vscode from 'vscode';
import { getWebviewHtmlShell } from './webviewUtils.js';
import type { VoiceManager } from '../voice/voiceManager.js';

/**
 * Voice Panel — provides TTS and STT via the Web Speech API.
 *
 * Security:
 * - CSP nonce applied to the single script block (via getWebviewHtmlShell).
 * - All webview → host messages validated by isVoicePanelMessage() before
 *   any action is taken. Messages with unexpected types are silently dropped.
 * - Voice settings are read from VS Code configuration and validated in
 *   VoiceManager before being passed to the webview.
 */
export class VoicePanel {
  public static currentPanel: VoicePanel | undefined;
  private static readonly viewType = 'atlasmind.voice';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    voiceManager: VoiceManager,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (VoicePanel.currentPanel) {
      VoicePanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VoicePanel.viewType,
      'AtlasMind Voice',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    VoicePanel.currentPanel = new VoicePanel(panel, voiceManager);
  }

  private constructor(panel: vscode.WebviewPanel, voiceManager: VoiceManager) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    // Attach panel to VoiceManager so it can send speak/listen commands
    voiceManager.attachPanel(panel);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private dispose(): void {
    VoicePanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  private getHtml(): string {
    const cspSource = this.panel.webview.cspSource;

    return getWebviewHtmlShell({
      title: 'AtlasMind Voice',
      cspSource,
      bodyContent: `
        <h1>AtlasMind Voice</h1>
        <p>Use the microphone for speech-to-text input or have @atlas responses read aloud.</p>

        <section id="stt-section">
          <h2>Speech Input (STT)</h2>
          <p class="info-note">Speak into your microphone; final transcripts are copied to your clipboard for quick pasting into chat.</p>
          <div class="row">
            <button id="btnListen" class="primary-btn">&#127908; Start Listening</button>
            <button id="btnStopListen" disabled>&#9632; Stop Listening</button>
          </div>
          <div id="transcript-box" class="output-box" aria-live="polite" aria-label="Speech transcript"></div>
          <div id="stt-status" class="status-label"></div>
          <div id="stt-unsupported" class="warning-note" style="display:none">
            &#9888; Speech recognition is not available in this environment. Your browser/webview may need microphone
            permission or does not support the Web Speech API.
          </div>
        </section>

        <section id="tts-section">
          <h2>Text-to-Speech (TTS)</h2>
          <p class="info-note">Type text below and click Speak, or enable auto-speak in settings to hear @atlas responses.</p>
          <div class="row">
            <textarea id="ttsInput" rows="3" placeholder="Enter text to speak…"></textarea>
          </div>
          <div class="row">
            <button id="btnSpeak" class="primary-btn">&#128266; Speak</button>
            <button id="btnStop">&#9654; Stop</button>
          </div>
          <div id="tts-status" class="status-label"></div>
          <div id="tts-unsupported" class="warning-note" style="display:none">
            &#9888; Speech synthesis is not available in this environment.
          </div>
        </section>

        <section id="voice-settings-section">
          <h2>Voice Settings</h2>
          <p class="info-note">These controls update <code>atlasmind.voice.*</code> workspace settings in real time.</p>
          <div class="settings-grid">
            <label for="rateInput">Rate</label>
            <input id="rateInput" type="range" min="0.5" max="2" step="0.1" value="1" />
            <span id="rateValue">1.0</span>

            <label for="pitchInput">Pitch</label>
            <input id="pitchInput" type="range" min="0" max="2" step="0.1" value="1" />
            <span id="pitchValue">1.0</span>

            <label for="volumeInput">Volume</label>
            <input id="volumeInput" type="range" min="0" max="1" step="0.05" value="1" />
            <span id="volumeValue">1.0</span>

            <label for="langInput">Language</label>
            <input id="langInput" type="text" placeholder="e.g. en-US (leave empty for default)" />
            <span></span>
          </div>
        </section>
      `,
      extraCss: `
        .row { display: flex; gap: 10px; margin: 10px 0; align-items: flex-start; }
        .primary-btn { font-weight: 600; }
        textarea {
          flex: 1;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 6px 8px;
          font-family: var(--vscode-font-family, system-ui, sans-serif);
          font-size: 0.95em;
        }
        .output-box {
          min-height: 60px;
          max-height: 160px;
          overflow-y: auto;
          padding: 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-input-background);
          font-size: 0.95em;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .status-label { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin: 4px 0 0; }
        .info-note {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
          margin: 0 0 8px;
        }
        .warning-note {
          margin-top: 8px;
          padding: 10px 12px;
          border-left: 3px solid var(--vscode-inputValidation-warningBorder, #cca700);
          background: var(--vscode-textBlockQuote-background, rgba(204,167,0,0.08));
        }
        .settings-grid {
          display: grid;
          grid-template-columns: 100px 1fr 50px;
          gap: 8px 12px;
          align-items: center;
          margin-top: 8px;
        }
        .settings-grid input[type="text"] {
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          padding: 4px 8px;
        }
        input[type="range"] { width: 100%; cursor: pointer; }
      `,
      scriptContent: buildScript(),
    });
  }
}

// ── Webview script ──────────────────────────────────────────────────────────

function buildScript(): string {
  // The script runs inside the sandboxed webview. It uses only browser APIs
  // (Web Speech API, acquireVsCodeApi) and postMessage.
  // It does NOT use eval(), Function(), or dynamic require().
  return `
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();

  // ── SpeechRecognition (STT) ────────────────────────────────────────────
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sttSupported = typeof SpeechRec !== 'undefined';
  if (!sttSupported) {
    const el = document.getElementById('stt-unsupported');
    if (el) { el.style.display = 'block'; }
  }

  let recognition = null;
  let recognising = false;

  const btnListen = document.getElementById('btnListen');
  const btnStopListen = document.getElementById('btnStopListen');
  const transcriptBox = document.getElementById('transcript-box');
  const sttStatus = document.getElementById('stt-status');

  function startRecognition() {
    if (!sttSupported || recognising) { return; }
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = currentSettings.language || '';
    recognition.onstart = () => {
      recognising = true;
      updateSttButtons();
      if (sttStatus) { sttStatus.textContent = 'Listening…'; }
    };
    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += t;
        } else {
          interim += t;
        }
      }
      if (transcriptBox) {
        transcriptBox.textContent = (transcriptBox.textContent || '') + finalText;
        if (interim) {
          transcriptBox.textContent = (transcriptBox.textContent || '') + interim;
        }
      }
      if (finalText) {
        vscode.postMessage({ type: 'transcript', text: finalText.trim(), final: true });
      }
    };
    recognition.onerror = (event) => {
      recognising = false;
      updateSttButtons();
      if (sttStatus) { sttStatus.textContent = 'Error: ' + (event.error || 'unknown'); }
      vscode.postMessage({ type: 'speechError', message: 'STT error: ' + (event.error || 'unknown') });
    };
    recognition.onend = () => {
      recognising = false;
      updateSttButtons();
      if (sttStatus) { sttStatus.textContent = 'Stopped.'; }
    };
    try {
      recognition.start();
    } catch (e) {
      if (sttStatus) { sttStatus.textContent = 'Could not start microphone.'; }
      vscode.postMessage({ type: 'speechError', message: String(e) });
    }
  }

  function stopRecognition() {
    if (recognition && recognising) {
      recognition.stop();
    }
  }

  function updateSttButtons() {
    if (btnListen) { btnListen.disabled = recognising || !sttSupported; }
    if (btnStopListen) { btnStopListen.disabled = !recognising; }
  }

  if (btnListen) {
    btnListen.addEventListener('click', startRecognition);
  }
  if (btnStopListen) {
    btnStopListen.addEventListener('click', stopRecognition);
  }
  updateSttButtons();

  // ── SpeechSynthesis (TTS) ─────────────────────────────────────────────
  const synth = window.speechSynthesis;
  const ttsSupported = typeof synth !== 'undefined';
  if (!ttsSupported) {
    const el = document.getElementById('tts-unsupported');
    if (el) { el.style.display = 'block'; }
  }

  const ttsInput = document.getElementById('ttsInput');
  const btnSpeak = document.getElementById('btnSpeak');
  const btnStop = document.getElementById('btnStop');
  const ttsStatus = document.getElementById('tts-status');

  function speakText(text) {
    if (!ttsSupported || !text.trim()) { return; }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = currentSettings.rate;
    utterance.pitch = currentSettings.pitch;
    utterance.volume = currentSettings.volume;
    if (currentSettings.language) { utterance.lang = currentSettings.language; }
    utterance.onstart = () => { if (ttsStatus) { ttsStatus.textContent = 'Speaking…'; } };
    utterance.onend = () => { if (ttsStatus) { ttsStatus.textContent = ''; } };
    utterance.onerror = (e) => { if (ttsStatus) { ttsStatus.textContent = 'TTS error: ' + e.error; } };
    synth.speak(utterance);
  }

  if (btnSpeak) {
    btnSpeak.addEventListener('click', () => {
      if (ttsInput instanceof HTMLTextAreaElement) {
        speakText(ttsInput.value);
      }
    });
  }
  if (btnStop) {
    btnStop.addEventListener('click', () => { if (ttsSupported) { synth.cancel(); } });
  }

  // ── Settings UI ────────────────────────────────────────────────────────
  let currentSettings = { rate: 1.0, pitch: 1.0, volume: 1.0, language: '' };

  const rateInput = document.getElementById('rateInput');
  const pitchInput = document.getElementById('pitchInput');
  const volumeInput = document.getElementById('volumeInput');
  const langInput = document.getElementById('langInput');

  function applySettings(settings) {
    currentSettings = settings;
    if (rateInput instanceof HTMLInputElement) {
      rateInput.value = String(settings.rate);
      const rv = document.getElementById('rateValue');
      if (rv) { rv.textContent = settings.rate.toFixed(1); }
    }
    if (pitchInput instanceof HTMLInputElement) {
      pitchInput.value = String(settings.pitch);
      const pv = document.getElementById('pitchValue');
      if (pv) { pv.textContent = settings.pitch.toFixed(1); }
    }
    if (volumeInput instanceof HTMLInputElement) {
      volumeInput.value = String(settings.volume);
      const vv = document.getElementById('volumeValue');
      if (vv) { vv.textContent = settings.volume.toFixed(2); }
    }
    if (langInput instanceof HTMLInputElement) {
      langInput.value = settings.language || '';
    }
  }

  function bindSlider(inputEl, valueEl, settingKey) {
    if (!(inputEl instanceof HTMLInputElement)) { return; }
    inputEl.addEventListener('input', () => {
      const value = parseFloat(inputEl.value);
      if (valueEl) { valueEl.textContent = value.toFixed(inputEl.step === '0.05' ? 2 : 1); }
      currentSettings[settingKey] = value;
      vscode.postMessage({ type: 'updateSetting', key: settingKey, value });
    });
  }

  bindSlider(rateInput, document.getElementById('rateValue'), 'rate');
  bindSlider(pitchInput, document.getElementById('pitchValue'), 'pitch');
  bindSlider(volumeInput, document.getElementById('volumeValue'), 'volume');

  if (langInput instanceof HTMLInputElement) {
    const emitLang = () => {
      const value = langInput.value.trim();
      currentSettings.language = value;
      vscode.postMessage({ type: 'updateSetting', key: 'language', value });
    };
    langInput.addEventListener('change', emitLang);
    langInput.addEventListener('blur', emitLang);
  }

  // ── Host → webview messages ────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') { return; }
    switch (msg.type) {
      case 'speak':
        if (msg.settings) { applySettings(msg.settings); }
        speakText(typeof msg.text === 'string' ? msg.text : '');
        break;
      case 'stopSpeaking':
        if (ttsSupported) { synth.cancel(); }
        break;
      case 'startListening':
        startRecognition();
        break;
      case 'stopListening':
        stopRecognition();
        break;
      case 'settingsUpdated':
        if (msg.settings) { applySettings(msg.settings); }
        break;
    }
  });

  // Signal host that the webview is ready
  vscode.postMessage({ type: 'ready' });
})();
  `;
}

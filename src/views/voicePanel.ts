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
        <div class="panel-hero">
          <div>
            <p class="eyebrow">Specialist integration</p>
            <h1>AtlasMind Voice</h1>
            <p class="hero-copy">Control speech input, speech output, and live voice tuning from a workspace-style panel designed for quick navigation.</p>
          </div>
          <div class="hero-badges" aria-label="Voice capabilities">
            <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="listen" title="Open the speech input page.">Speech to text</button>
            <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="speak" title="Open the text-to-speech page.">Text to speech</button>
            <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="settings" title="Open live voice settings.">Live settings</button>
            <button type="button" class="hero-badge hero-badge-button" data-hero-page-target="devices" title="Open audio input and output routing.">Devices</button>
          </div>
        </div>

        <div class="search-shell">
          <label class="search-label" for="voiceSearch">Search voice workspace</label>
          <input id="voiceSearch" type="search" placeholder="Search pages like microphone, narration, or settings" />
          <p id="voiceSearchStatus" class="search-status" aria-live="polite">Browse the workspace pages or search voice capabilities.</p>
        </div>

        <div class="panel-layout">
          <nav class="panel-nav" aria-label="Voice pages" role="tablist" aria-orientation="vertical">
            <button type="button" class="nav-link active" data-page-target="overview" data-search="overview voice speech chat settings specialist">Overview</button>
            <button type="button" class="nav-link" data-page-target="listen" data-search="listen microphone transcript speech input stt">Speech Input</button>
            <button type="button" class="nav-link" data-page-target="speak" data-search="speak narration tts output read aloud">Text to Speech</button>
            <button type="button" class="nav-link" data-page-target="settings" data-search="rate pitch volume language voice settings">Voice Settings</button>
            <button type="button" class="nav-link" data-page-target="devices" data-search="devices microphone speaker routing output input os services native">Devices</button>
          </nav>

          <main class="panel-main">
            <section id="page-overview" class="panel-page active">
              <div class="page-header">
                <p class="page-kicker">Overview</p>
                <h2>Voice workspace</h2>
                <p>Start from the page that matches the task: microphone capture, text-to-speech playback, or voice tuning. Use the quick links below to move into chat or the broader specialist configuration surfaces.</p>
              </div>
              <div class="action-grid">
                <button type="button" class="action-card action-primary" data-nav-target="listen">
                  <span class="action-title">Open Speech Input</span>
                  <span class="action-copy">Capture a transcript and copy final speech directly to the clipboard.</span>
                </button>
                <button type="button" class="action-card" data-nav-target="speak">
                  <span class="action-title">Open Text to Speech</span>
                  <span class="action-copy">Read AtlasMind responses aloud or preview narration with custom text.</span>
                </button>
                <button type="button" id="open-chat-view" class="action-card">
                  <span class="action-title">Focus Chat View</span>
                  <span class="action-copy">Return to the embedded Atlas chat once you have a transcript or want to hear responses.</span>
                </button>
                <button type="button" class="action-card" data-nav-target="devices">
                  <span class="action-title">Configure Devices</span>
                  <span class="action-copy">Inspect microphone and speaker routing, then persist preferred devices for supported voice backends.</span>
                </button>
                <button type="button" id="open-specialist-integrations" class="action-card">
                  <span class="action-title">Open Specialist Integrations</span>
                  <span class="action-copy">Review how voice, vision, and search vendors fit alongside routed chat models.</span>
                </button>
                <button type="button" id="open-settings-models" class="action-card">
                  <span class="action-title">Open Model Settings</span>
                  <span class="action-copy">Adjust routing and model-related settings that shape voice-assisted responses.</span>
                </button>
              </div>
            </section>

            <section id="page-listen" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Speech Input</p>
                <h2>Microphone capture</h2>
                <p>Speak into your microphone. Final transcripts are copied to the clipboard so they can be pasted straight into chat or command prompts.</p>
              </div>
              <section class="content-card">
                <div class="row">
                  <button id="btnListen" class="primary-btn">&#127908; Start Listening</button>
                  <button id="btnStopListen" disabled>&#9632; Stop Listening</button>
                </div>
                <div id="transcript-box" class="output-box" aria-live="polite" aria-label="Speech transcript"></div>
                <div id="stt-status" class="status-label"></div>
                <div id="stt-disabled-note" class="warning-note" style="display:none">
                  Speech input is disabled by the workspace setting <code>atlasmind.voice.sttEnabled</code>.
                </div>
                <div id="stt-unsupported" class="warning-note" style="display:none">
                  &#9888; Speech recognition is not available in this environment. Your browser/webview may need microphone permission or does not support the Web Speech API.
                </div>
              </section>
            </section>

            <section id="page-speak" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Text to Speech</p>
                <h2>Read responses aloud</h2>
                <p>Enter any text below and preview voice playback. AtlasMind can also speak model responses automatically when voice playback is enabled.</p>
              </div>
              <section class="content-card">
                <div class="row">
                  <textarea id="ttsInput" rows="4" placeholder="Enter text to speak…"></textarea>
                </div>
                <div class="row">
                  <button id="btnSpeak" class="primary-btn">&#128266; Speak</button>
                  <button id="btnStop">&#9654; Stop</button>
                  <span id="elevenlabs-badge" style="font-size:0.8em;margin-left:auto;opacity:0.75">Web Speech API</span>
                </div>
                <div id="tts-status" class="status-label"></div>
                <div id="tts-unsupported" class="warning-note" style="display:none">
                  &#9888; Speech synthesis is not available in this environment. Configure an ElevenLabs API key in Specialist Integrations to enable server-side TTS.
                </div>
              </section>
            </section>

            <section id="page-settings" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Voice Settings</p>
                <h2>Live voice tuning</h2>
                <p>These controls update atlasmind.voice workspace settings in real time so you can tune voice behavior without leaving the panel.</p>
              </div>
              <section class="content-card">
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
            </section>

            <section id="page-devices" class="panel-page" hidden>
              <div class="page-header">
                <p class="page-kicker">Devices</p>
                <h2>Audio routing and backend limits</h2>
                <p>AtlasMind can persist preferred devices, but the active voice backend determines whether those preferences can be enforced directly or only used as guidance.</p>
              </div>
              <section class="content-card">
                <div class="settings-grid settings-grid-devices">
                  <label for="sttEnabledInput">Speech input enabled</label>
                  <input id="sttEnabledInput" type="checkbox" />
                  <span id="sttEnabledValue">Off</span>

                  <label for="inputDeviceSelect">Preferred microphone</label>
                  <select id="inputDeviceSelect"></select>
                  <span id="inputDeviceValue">Default</span>

                  <label for="outputDeviceSelect">Preferred speaker</label>
                  <select id="outputDeviceSelect"></select>
                  <span id="outputDeviceValue">Default</span>
                </div>
                <div class="row row-wrap">
                  <button id="btnRefreshDevices" type="button">Refresh Devices</button>
                </div>
                <div id="device-status" class="status-label"></div>
                <p class="info-note">Output routing applies to ElevenLabs audio playback when the webview runtime supports <code>setSinkId</code>. Browser speech synthesis still follows the browser or OS default output device.</p>
                <p class="info-note">Input routing is stored for future native or stream-based backends and is used for microphone permission preflight. Browser Web Speech recognition may still follow the default OS or browser microphone.</p>
                <div class="warning-note">
                  OS-native speech services are not wired in yet. The current stack is Web Speech API for in-webview STT and fallback TTS, plus optional ElevenLabs server-side TTS. A true OS backend would need a host-side speech adapter per platform.
                </div>
              </section>
            </section>
          </main>
        </div>
      `,
      extraCss: `
        :root {
          --atlas-surface: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%);
          --atlas-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 64%, var(--vscode-sideBar-background) 36%);
          --atlas-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
          --atlas-accent: var(--vscode-textLink-foreground);
          --atlas-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
        }
        body { padding: 20px; }
        .panel-hero { display: flex; justify-content: space-between; gap: 20px; padding: 20px 22px; margin-bottom: 18px; border: 1px solid var(--atlas-border); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background)); }
        .eyebrow, .page-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
        .panel-hero h1, .page-header h2 { margin: 0; }
        .hero-copy, .page-header p:last-child, .search-status, .info-note, .status-label { color: var(--atlas-muted); }
        .hero-badges { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; justify-content: flex-end; }
        .hero-badge { border: 1px solid var(--atlas-border); border-radius: 999px; padding: 6px 12px; background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); }
        .hero-badge-button { color: inherit; font: inherit; cursor: pointer; }
        .hero-badge-button:hover, .hero-badge-button:focus-visible { outline: 2px solid var(--atlas-accent); outline-offset: 2px; }
        .search-shell { display: grid; gap: 6px; margin: 0 0 18px; }
        .search-label { font-weight: 600; }
        .search-shell input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 10px 12px; border-radius: 12px; }
        .panel-layout { display: grid; grid-template-columns: minmax(220px, 240px) minmax(0, 1fr); gap: 18px; align-items: start; }
        .panel-nav { position: sticky; top: 20px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--atlas-border); border-radius: 18px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
        .nav-link { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 12px; padding: 11px 12px; background: transparent; color: var(--vscode-foreground); font-weight: 600; }
        .nav-link.active { background: color-mix(in srgb, var(--atlas-accent) 22%, transparent); border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border)); }
        .nav-link.hidden-by-search { display: none; }
        .panel-page { display: none; }
        .panel-page.active { display: block; }
        .action-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .action-card, .content-card {
          border: 1px solid var(--atlas-border);
          border-radius: 16px;
          padding: 16px;
          background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background));
        }
        .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
        .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
        .action-title { font-weight: 700; }
        .row { display: flex; gap: 10px; margin: 10px 0; align-items: flex-start; }
        .row-wrap { flex-wrap: wrap; }
        .primary-btn { font-weight: 600; }
        textarea {
          flex: 1;
          resize: vertical;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--atlas-border));
          padding: 6px 8px;
          font-family: var(--vscode-font-family, system-ui, sans-serif);
          font-size: 0.95em;
          border-radius: 12px;
        }
        .output-box {
          min-height: 60px;
          max-height: 160px;
          overflow-y: auto;
          padding: 8px;
          border: 1px solid var(--atlas-border);
          background: var(--vscode-input-background);
          font-size: 0.95em;
          white-space: pre-wrap;
          word-break: break-word;
          border-radius: 12px;
        }
        .status-label { font-size: 0.85em; margin: 4px 0 0; }
        .info-note {
          font-size: 0.9em;
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
          border: 1px solid var(--vscode-input-border, var(--atlas-border));
          padding: 4px 8px;
          border-radius: 10px;
        }
        .settings-grid select {
          color: var(--vscode-input-foreground);
          background: var(--vscode-dropdown-background, var(--vscode-input-background));
          border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--atlas-border)));
          padding: 6px 8px;
          border-radius: 10px;
        }
        .settings-grid-devices {
          grid-template-columns: 140px minmax(0, 1fr) 120px;
        }
        input[type="range"] { width: 100%; cursor: pointer; }
        .nav-link:hover, .nav-link:focus-visible, .action-card:hover, .action-card:focus-visible, button:focus-visible {
          outline: 2px solid var(--atlas-accent);
          outline-offset: 2px;
        }
        @media (max-width: 920px) {
          .panel-layout, .action-grid { grid-template-columns: 1fr; }
          .panel-nav { position: static; }
          .panel-hero { flex-direction: column; }
        }
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
  const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
  const pages = Array.from(document.querySelectorAll('.panel-page'));
  const searchInput = document.getElementById('voiceSearch');
  const searchStatus = document.getElementById('voiceSearchStatus');
  const mediaDevices = navigator.mediaDevices;
  const supportsDeviceEnumeration = typeof mediaDevices?.enumerateDevices === 'function';
  const supportsInputCapture = typeof mediaDevices?.getUserMedia === 'function';
  const supportsAudioOutputSelection = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';

  function activatePage(pageId) {
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      button.classList.toggle('active', button.dataset.pageTarget === pageId);
    });
    pages.forEach(page => {
      if (!(page instanceof HTMLElement)) { return; }
      const active = page.id === 'page-' + pageId;
      page.classList.toggle('active', active);
      page.hidden = !active;
    });
  }

  function updateSearch(query) {
    const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
    let visiblePages = 0;
    navButtons.forEach(button => {
      if (!(button instanceof HTMLButtonElement)) { return; }
      const haystack = ((button.textContent || '') + ' ' + (button.dataset.search || '')).toLowerCase();
      const matches = normalized.length === 0 || haystack.includes(normalized);
      button.classList.toggle('hidden-by-search', !matches);
      if (matches) { visiblePages += 1; }
    });
    if (searchStatus instanceof HTMLElement) {
      if (normalized.length === 0) {
        searchStatus.textContent = 'Browse the workspace pages or search voice capabilities.';
      } else if (visiblePages === 0) {
        searchStatus.textContent = 'No voice pages matched that search.';
      } else if (visiblePages === 1) {
        searchStatus.textContent = '1 voice page matched.';
      } else {
        searchStatus.textContent = visiblePages + ' voice pages matched.';
      }
    }
  }

  navButtons.forEach(button => {
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => activatePage(button.dataset.pageTarget || 'overview'));
  });

  document.querySelectorAll('[data-nav-target]').forEach(button => {
    button.addEventListener('click', () => activatePage(button.getAttribute('data-nav-target') || 'overview'));
  });

  document.querySelectorAll('[data-hero-page-target]').forEach(button => {
    if (!(button instanceof HTMLButtonElement)) { return; }
    button.addEventListener('click', () => activatePage(button.dataset.heroPageTarget || 'overview'));
  });

  activatePage('overview');
  if (searchInput instanceof HTMLInputElement) {
    updateSearch(searchInput.value);
    searchInput.addEventListener('input', () => updateSearch(searchInput.value));
  }

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
  const sttDisabledNote = document.getElementById('stt-disabled-note');

  async function startRecognition() {
    if (!sttSupported || recognising || !currentSettings.sttEnabled) {
      updateSttAvailability();
      return;
    }
    const preflightOk = await preflightInputSelection();
    if (!preflightOk) { return; }
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
    if (btnListen) { btnListen.disabled = recognising || !sttSupported || !currentSettings.sttEnabled; }
    if (btnStopListen) { btnStopListen.disabled = !recognising; }
  }

  function updateSttAvailability() {
    updateSttButtons();
    if (sttDisabledNote) {
      sttDisabledNote.style.display = currentSettings.sttEnabled ? 'none' : 'block';
    }
    if (!currentSettings.sttEnabled && sttStatus) {
      sttStatus.textContent = 'Speech input is disabled in workspace settings.';
    } else if (currentSettings.sttEnabled && sttStatus && sttStatus.textContent === 'Speech input is disabled in workspace settings.') {
      sttStatus.textContent = '';
    }
  }

  if (btnListen) {
    btnListen.addEventListener('click', () => { void startRecognition(); });
  }
  if (btnStopListen) {
    btnStopListen.addEventListener('click', stopRecognition);
  }
  updateSttAvailability();

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
  let elevenLabsAvailable = false;

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
  let currentSettings = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    sttEnabled: false,
    language: '',
    inputDeviceId: '',
    outputDeviceId: '',
  };

  const rateInput = document.getElementById('rateInput');
  const pitchInput = document.getElementById('pitchInput');
  const volumeInput = document.getElementById('volumeInput');
  const langInput = document.getElementById('langInput');
  const sttEnabledInput = document.getElementById('sttEnabledInput');
  const inputDeviceSelect = document.getElementById('inputDeviceSelect');
  const outputDeviceSelect = document.getElementById('outputDeviceSelect');
  const btnRefreshDevices = document.getElementById('btnRefreshDevices');
  const deviceStatus = document.getElementById('device-status');

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
    if (sttEnabledInput instanceof HTMLInputElement) {
      sttEnabledInput.checked = Boolean(settings.sttEnabled);
      const sttEnabledValue = document.getElementById('sttEnabledValue');
      if (sttEnabledValue) { sttEnabledValue.textContent = settings.sttEnabled ? 'On' : 'Off'; }
    }
    const inputDeviceValue = document.getElementById('inputDeviceValue');
    if (inputDeviceValue) { inputDeviceValue.textContent = settings.inputDeviceId ? 'Selected' : 'Default'; }
    const outputDeviceValue = document.getElementById('outputDeviceValue');
    if (outputDeviceValue) { outputDeviceValue.textContent = settings.outputDeviceId ? 'Selected' : 'Default'; }
    updateSttAvailability();
    void refreshDevices(false);
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

  if (sttEnabledInput instanceof HTMLInputElement) {
    sttEnabledInput.addEventListener('change', () => {
      currentSettings.sttEnabled = sttEnabledInput.checked;
      const sttEnabledValue = document.getElementById('sttEnabledValue');
      if (sttEnabledValue) { sttEnabledValue.textContent = currentSettings.sttEnabled ? 'On' : 'Off'; }
      updateSttAvailability();
      vscode.postMessage({ type: 'updateSetting', key: 'sttEnabled', value: currentSettings.sttEnabled });
    });
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function normalizeDeviceLabel(device, index, kindLabel) {
    const trimmed = typeof device.label === 'string' ? device.label.trim() : '';
    if (trimmed) { return trimmed; }
    return kindLabel + ' ' + (index + 1);
  }

  function updateDeviceValueLabels() {
    const inputDeviceValue = document.getElementById('inputDeviceValue');
    if (inputDeviceValue) {
      inputDeviceValue.textContent = currentSettings.inputDeviceId ? 'Selected' : 'Default';
    }
    const outputDeviceValue = document.getElementById('outputDeviceValue');
    if (outputDeviceValue) {
      outputDeviceValue.textContent = currentSettings.outputDeviceId ? 'Selected' : 'Default';
    }
  }

  async function refreshDevices(showStatus) {
    if (!(inputDeviceSelect instanceof HTMLSelectElement) || !(outputDeviceSelect instanceof HTMLSelectElement)) { return; }
    inputDeviceSelect.replaceChildren(createOption('', 'System default microphone'));
    outputDeviceSelect.replaceChildren(createOption('', 'System default speaker'));

    if (!supportsDeviceEnumeration) {
      inputDeviceSelect.disabled = true;
      outputDeviceSelect.disabled = true;
      if (deviceStatus) { deviceStatus.textContent = 'Device enumeration is not available in this environment.'; }
      return;
    }

    try {
      const devices = await mediaDevices.enumerateDevices();
      const inputDevices = devices.filter(device => device.kind === 'audioinput');
      const outputDevices = devices.filter(device => device.kind === 'audiooutput');

      inputDevices.forEach((device, index) => {
        inputDeviceSelect.appendChild(createOption(device.deviceId, normalizeDeviceLabel(device, index, 'Microphone')));
      });
      outputDevices.forEach((device, index) => {
        outputDeviceSelect.appendChild(createOption(device.deviceId, normalizeDeviceLabel(device, index, 'Speaker')));
      });

      inputDeviceSelect.disabled = inputDevices.length === 0;
      outputDeviceSelect.disabled = outputDevices.length === 0;
      inputDeviceSelect.value = currentSettings.inputDeviceId;
      outputDeviceSelect.value = currentSettings.outputDeviceId;
      updateDeviceValueLabels();

      if (deviceStatus && showStatus) {
        const outputNote = supportsAudioOutputSelection ? 'Output routing available for ElevenLabs audio.' : 'Output routing not supported by this webview runtime.';
        deviceStatus.textContent = 'Found ' + inputDevices.length + ' microphone(s) and ' + outputDevices.length + ' speaker(s). ' + outputNote;
      }
    } catch (error) {
      inputDeviceSelect.disabled = true;
      outputDeviceSelect.disabled = true;
      if (deviceStatus) {
        deviceStatus.textContent = 'Could not enumerate audio devices: ' + String(error);
      }
    }
  }

  async function preflightInputSelection() {
    if (!supportsInputCapture) { return true; }

    try {
      const constraints = currentSettings.inputDeviceId
        ? { audio: { deviceId: { exact: currentSettings.inputDeviceId } } }
        : { audio: true };
      const stream = await mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach(track => track.stop());
      await refreshDevices(false);
      return true;
    } catch (error) {
      if (sttStatus) {
        sttStatus.textContent = 'Microphone access failed for the selected device.';
      }
      vscode.postMessage({ type: 'speechError', message: 'Microphone access failed: ' + String(error) });
      return false;
    }
  }

  if (inputDeviceSelect instanceof HTMLSelectElement) {
    inputDeviceSelect.addEventListener('change', () => {
      currentSettings.inputDeviceId = inputDeviceSelect.value;
      updateDeviceValueLabels();
      vscode.postMessage({ type: 'updateSetting', key: 'inputDeviceId', value: currentSettings.inputDeviceId });
    });
  }

  if (outputDeviceSelect instanceof HTMLSelectElement) {
    outputDeviceSelect.addEventListener('change', () => {
      currentSettings.outputDeviceId = outputDeviceSelect.value;
      updateDeviceValueLabels();
      vscode.postMessage({ type: 'updateSetting', key: 'outputDeviceId', value: currentSettings.outputDeviceId });
    });
  }

  if (btnRefreshDevices instanceof HTMLButtonElement) {
    btnRefreshDevices.addEventListener('click', () => { void refreshDevices(true); });
  }

  if (supportsDeviceEnumeration && typeof mediaDevices.addEventListener === 'function') {
    mediaDevices.addEventListener('devicechange', () => { void refreshDevices(false); });
  }

  document.getElementById('open-chat-view')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openChatView' });
  });
  document.getElementById('open-specialist-integrations')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSpecialistIntegrations' });
  });
  document.getElementById('open-settings-models')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openSettingsModels' });
  });

  // ── Host → webview messages ────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== 'string') { return; }
    switch (msg.type) {
      case 'speak':
        if (msg.settings) { applySettings(msg.settings); }
        speakText(typeof msg.text === 'string' ? msg.text : '');
        break;
      case 'playAudio': {
        // ElevenLabs: decode base64-encoded audio and play via Web Audio API
        if (typeof msg.base64 === 'string' && typeof msg.mimeType === 'string') {
          playBase64Audio(msg.base64, msg.mimeType);
        }
        break;
      }
      case 'stopSpeaking':
        if (ttsSupported) { synth.cancel(); }
        stopBase64Audio();
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
      case 'elevenLabsStatus': {
        elevenLabsAvailable = Boolean(msg.available);
        const badge = document.getElementById('elevenlabs-badge');
        if (badge) {
          badge.textContent = elevenLabsAvailable ? '✓ ElevenLabs active' : 'Web Speech API';
          badge.style.color = elevenLabsAvailable ? 'var(--vscode-notificationsInfoIcon-foreground, #4ec9b0)' : '';
        }
        break;
      }
    }
  });

  // ── ElevenLabs audio playback ──────────────────────────────────────────
  let currentAudioElement = null;
  let currentAudioUrl = '';

  async function playBase64Audio(base64, mimeType) {
    stopBase64Audio();
    if (ttsStatus) { ttsStatus.textContent = 'Speaking (ElevenLabs)…'; }

    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) { bytes[i] = binaryStr.charCodeAt(i); }

    const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);

    try {
      if (currentSettings.outputDeviceId) {
        if (typeof audio.setSinkId === 'function') {
          await audio.setSinkId(currentSettings.outputDeviceId);
        } else if (ttsStatus) {
          ttsStatus.textContent = 'Selected output device is not supported by this runtime; using the default speaker.';
        }
      }

      audio.onended = () => {
        currentAudioElement = null;
        if (currentAudioUrl) {
          URL.revokeObjectURL(currentAudioUrl);
          currentAudioUrl = '';
        }
        if (ttsStatus) { ttsStatus.textContent = ''; }
      };
      audio.onerror = () => {
        if (ttsStatus) { ttsStatus.textContent = 'ElevenLabs audio playback failed.'; }
      };

      currentAudioElement = audio;
      currentAudioUrl = audioUrl;
      await audio.play();
    } catch (err) {
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = '';
      }
      currentAudioElement = null;
      if (ttsStatus) { ttsStatus.textContent = 'ElevenLabs audio playback failed: ' + String(err); }
    }
  }

  function stopBase64Audio() {
    if (currentAudioElement) {
      try {
        currentAudioElement.pause();
        currentAudioElement.currentTime = 0;
      } catch (_) {}
      currentAudioElement = null;
    }
    if (currentAudioUrl) {
      URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = '';
    }
  }

  // Signal host that the webview is ready
  void refreshDevices(false);
  vscode.postMessage({ type: 'ready' });
})();
  `;
}

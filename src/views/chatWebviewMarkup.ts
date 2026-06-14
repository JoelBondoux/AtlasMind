import { getWebviewHtmlShell } from './webviewUtils.js';

/**
 * Static chat webview markup, shared by the desktop ChatPanel and the web remote
 * client so both render an identical, host-agnostic chat surface. The front-end
 * behaviour lives in media/chatPanel.js, which only talks to its host via
 * postMessage and therefore works unchanged behind a local or remote host.
 */
export function buildChatWebviewHtml(opts: { scriptUri: string; cspSource: string }): string {
  return getWebviewHtmlShell({
    title: 'AtlasMind Chat',
    cspSource: opts.cspSource,
    bodyContent: `
        <div class="chat-shell" data-mode="chat">
          <aside class="session-rail">
            <div class="session-rail-header">
              <button id="sessionToggle" class="session-toggle" aria-expanded="false" title="Toggle sessions panel">
                <svg class="toggle-chevron" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>
                <span class="toggle-label">Sessions</span>
                <span id="sessionCount" class="session-count-badge">0</span>
              </button>
              <button id="createSession" class="icon-btn compact-icon-btn create-session-btn" type="button" title="New chat session" aria-label="New chat session">+</button>
            </div>
            <div id="sessionDrawer" class="session-drawer" aria-hidden="true">
              <div class="rail-section-label">Chat Threads</div>
              <div id="sessionList" class="session-list"></div>
              <button id="runToggle" class="session-toggle run-toggle hidden" aria-expanded="false" title="Toggle standalone runs">
                <svg class="toggle-chevron" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>
                <span class="toggle-label">Standalone Runs</span>
                <span id="runCount" class="session-count-badge hidden"></span>
              </button>
              <div id="runListContainer" class="run-list-container" aria-hidden="true">
                <div id="runList" class="session-list"></div>
              </div>
            </div>
          </aside>
          <div class="chat-column">
            <main class="main-panel">
              <section class="panel-header">
                <div>
                  <div class="eyebrow">Dedicated Workspace</div>
                  <h2 id="panelTitle">AtlasMind Chat</h2>
                  <p id="panelSubtitle" class="panel-subtitle">Persistent workspace chat threads with direct access to recent autonomous runs.</p>
                </div>
                <div class="row toolbar-row">
                  <div class="font-size-controls" aria-label="Adjust chat font size">
                    <button id="decreaseFontSize" class="icon-btn compact-icon-btn" type="button" title="Smaller chat text" aria-label="Smaller chat text">A-</button>
                    <button id="increaseFontSize" class="icon-btn compact-icon-btn" type="button" title="Larger chat text" aria-label="Larger chat text">A+</button>
                  </div>
                  <button id="clearConversation" class="icon-btn compact-icon-btn" type="button" title="Clear conversation" aria-label="Clear conversation">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="3,4 13,4"/>
                      <path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/>
                      <path d="M5 4l.75 8.5a1 1 0 0 0 1 .9h2.5a1 1 0 0 0 1-.9L11 4"/>
                    </svg>
                  </button>
                  <button id="copyTranscript" class="icon-btn compact-icon-btn" type="button" title="Copy transcript" aria-label="Copy transcript">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="5" y="1.5" width="8" height="10" rx="1"/>
                      <rect x="2" y="4.5" width="8" height="10" rx="1" fill="var(--vscode-editor-background,#1e1e1e)"/>
                    </svg>
                  </button>
                  <button id="saveTranscript" class="icon-btn compact-icon-btn" type="button" title="Open as Markdown" aria-label="Open as Markdown">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="2" y="1.5" width="9" height="12" rx="1"/>
                      <line x1="4.5" y1="5" x2="8.5" y2="5"/>
                      <line x1="4.5" y1="7.5" x2="8.5" y2="7.5"/>
                      <line x1="4.5" y1="10" x2="6.5" y2="10"/>
                      <polyline points="10,9.5 13,12.5 10,15.5" stroke-width="1.3"/>
                    </svg>
                  </button>
                </div>
              </section>
              <div id="status" class="status-label">Ready.</div>
              <section id="aiInstructionNudge" class="ai-instruction-nudge hidden" aria-live="polite">
                <div class="ai-instruction-nudge-body">
                  <span class="ai-instruction-nudge-icon">&#9432;</span>
                  <div class="ai-instruction-nudge-text">
                    <strong>AI instruction files found.</strong>
                    <span id="aiInstructionNudgeDetail"> Sync them so AtlasMind knows your project&rsquo;s rules and policies.</span>
                  </div>
                  <button id="syncAiInstructions" class="nudge-btn nudge-btn-primary" type="button">Sync Now</button>
                  <button id="dismissAiInstructionNudge" class="nudge-btn" type="button" aria-label="Dismiss">&#x2715;</button>
                </div>
              </section>
              <section id="recoveryNotice" class="recovery-notice hidden" aria-live="polite">
                <div id="recoveryNoticeTitle" class="recovery-notice-title">Direct recovery mode</div>
                <div id="recoveryNoticeSummary" class="recovery-notice-summary"></div>
              </section>
              <section id="transcript" class="chat-transcript" aria-live="polite"></section>
              <section id="runInspector" class="run-inspector hidden"></section>
              <section id="pendingApprovals" class="approval-stack hidden" aria-live="polite"></section>
            </main>
            <div id="imageLightbox" class="media-lightbox hidden" aria-hidden="true">
              <div class="media-lightbox-panel">
                <button id="imageLightboxClose" class="icon-btn compact-icon-btn media-lightbox-close" type="button" aria-label="Close image preview">×</button>
                <img id="imageLightboxImage" class="media-lightbox-image" alt="Expanded attachment preview" />
                <div id="imageLightboxCaption" class="media-lightbox-caption"></div>
              </div>
            </div>
            <section class="composer-shell">
              <div class="row toolbar-row composer-tools">
                <div class="attach-row">
                  <button id="toggleSearch" class="icon-btn compact-icon-btn search-btn" type="button" title="Toggle search mode" aria-label="Toggle search mode" aria-pressed="false">
                    <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="7" cy="7" r="5.5"/>
                      <line x1="11.5" y1="11.5" x2="15" y2="15"/>
                    </svg>
                  </button>
                  <button id="toggleDictation" class="icon-btn compact-icon-btn mic-btn" type="button" title="Start speech input" aria-label="Start speech input" aria-pressed="false">
                    <svg class="mic-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M8 2.25a1.75 1.75 0 0 1 1.75 1.75v4a1.75 1.75 0 1 1-3.5 0V4A1.75 1.75 0 0 1 8 2.25z"/>
                      <path d="M4.75 7.75a3.25 3.25 0 0 0 6.5 0"/>
                      <path d="M8 11v2.75"/>
                      <path d="M5.5 13.75h5"/>
                    </svg>
                  </button>
                  <button id="attachFiles" class="icon-btn compact-icon-btn" title="Add files" aria-label="Add files">+</button>
                  <button id="attachOpenFiles" class="icon-btn compact-icon-btn" title="Add open files" aria-label="Add open files">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="5" y="1.5" width="8" height="10" rx="1"/>
                      <rect x="3" y="3.5" width="8" height="10" rx="1" fill="var(--vscode-editor-background,#1e1e1e)" stroke="currentColor"/>
                      <line x1="5.5" y1="7" x2="9" y2="7"/>
                      <line x1="5.5" y1="9.5" x2="9" y2="9.5"/>
                    </svg>
                  </button>
                  <button id="clearAttachments" class="icon-btn compact-icon-btn" title="Clear attachments" aria-label="Clear attachments">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <line x1="4" y1="4" x2="12" y2="12"/>
                      <line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                  </button>
                </div>
                <button id="toggleAutopilot" class="icon-btn compact-icon-btn autopilot-btn" type="button" title="Toggle Autopilot — grant all tool approvals automatically" aria-label="Toggle Autopilot" aria-pressed="false">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5"/>
                    <path d="M8 4.5 L9.5 7.5 L13 8 L10.5 10.5 L11 14 L8 12.5 L5 14 L5.5 10.5 L3 8 L6.5 7.5 Z"/>
                  </svg>
                </button>
              </div>
              <div id="openFilesSection" class="composer-section hidden">
                <div class="rail-section-label compact-section-label">Open Files</div>
                <div id="openFileLinks" class="chip-row"></div>
              </div>
              <div id="attachmentsSection" class="composer-section hidden">
                <div class="rail-section-label compact-section-label">Attachments</div>
                <div id="attachmentList" class="chip-row attachment-row"></div>
              </div>
              <div id="dropHint" class="drop-hint">Drop code files, images, audio, video, or URLs onto the composer to attach them.</div>
              <div id="pendingRunReviewBar" class="pending-run-review-bar hidden" role="button" tabindex="0" aria-expanded="false" aria-controls="pendingRunReviewFlyout">
                <div class="pending-run-review-copy">
                  <strong id="pendingRunReviewTitle">Autonomous review pending</strong>
                  <span id="pendingRunReviewSummary">Review pending files from recent autonomous runs.</span>
                </div>
                <span class="pending-run-review-chevron" aria-hidden="true">▾</span>
              </div>
              <div id="pendingRunReviewFlyout" class="pending-run-review-flyout hidden"></div>
              <div id="composerSearch" class="composer-search hidden">
                <input id="searchInput" type="text" placeholder="Search session (supports glob patterns)..." />
                <div id="searchResults" class="search-results"></div>
              </div>
              <textarea id="promptInput" rows="3" placeholder="Ask AtlasMind to plan, explain, inspect, or implement something…"></textarea>
              <div class="row toolbar-row composer-row">
                <div class="send-group">
                  <select id="sendMode" aria-label="Choose send mode">
                    <option value="send">Send</option>
                    <option value="steer">Steer</option>
                    <option value="new-chat">New Chat</option>
                    <option value="new-session">New Session</option>
                  </select>
                  <button id="sendPrompt" class="primary-btn">Send</button>
                  <button id="stopPrompt" class="danger-btn hidden" type="button">Stop</button>
                </div>
                <span class="composer-hint-wrap">
                  <button id="composerHintBtn" class="icon-btn compact-icon-btn composer-hint-btn" type="button" aria-label="Keyboard shortcuts and tips">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5"/>
                      <line x1="8" y1="7" x2="8" y2="11.5"/>
                      <circle cx="8" cy="4.5" r="0.6" fill="currentColor" stroke="none"/>
                    </svg>
                  </button>
                  <div id="composerHint" class="hint-label composer-hint-tooltip" role="tooltip">
                    <div class="composer-hint-title">Composer shortcuts</div>
                    <ul class="composer-hint-list">
                      <li>Enter uses the selected send mode.</li>
                      <li>Shift+Enter starts a new chat thread.</li>
                      <li>Ctrl/Cmd+Enter sends as Steer.</li>
                      <li>Alt+Enter inserts a newline.</li>
                      <li>Up and Down recall recent prompts at the start or end of the composer.</li>
                      <li>Use aliases like @tps, @tpowershell, @tpwsh, @tgit, @tbash, or @tcmd to launch a managed terminal run.</li>
                    </ul>
                  </div>
                </span>
              </div>
            </section>
          </div>
        </div>
`,
    extraCss: `
        html, body {
          height: 100%;
        }
        body {
          margin: 0;
          padding: 0 !important;
          overflow: hidden;
        }

        /* ---- Shell layout: vertical flex, full viewport ---- */
        .chat-shell {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          --atlas-chat-font-scale: 1;
        }
        .chat-column {
          flex: 1 1 0;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ---- Sessions collapsible panel ---- */
        .session-rail {
          flex: 0 0 auto;
          border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
          min-width: 0;
        }
        .session-rail-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 2px 10px;
        }
        .session-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1 1 auto;
          min-width: 0;
          padding: 4px 0;
          border: 0;
          background: transparent;
          color: var(--vscode-foreground);
          cursor: pointer;
          font-size: 0.82rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .session-toggle:hover {
          background: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-editor-background)) 60%, transparent);
        }
        .toggle-chevron {
          transition: transform 150ms ease;
          flex: 0 0 14px;
        }
        .session-toggle[aria-expanded="true"] .toggle-chevron {
          transform: rotate(90deg);
        }
        .run-toggle {
          margin-top: 8px;
          width: 100%;
        }
        .run-list-container {
          overflow: hidden;
          max-height: 0;
          transition: max-height 180ms ease;
        }
        .run-list-container.open {
          max-height: 600px;
        }
        .toggle-label { flex: 1; text-align: left; }
        .session-count-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--vscode-badge-background, var(--vscode-button-background));
          color: var(--vscode-badge-foreground, #fff);
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1;
        }
        .create-session-btn {
          flex: 0 0 auto;
          min-width: 22px;
          min-height: 22px;
          width: 22px;
          height: 22px;
          padding: 0;
          font-size: 0.95rem;
          line-height: 1;
        }
        .session-drawer {
          display: none;
          max-height: 50vh;
          overflow-y: auto;
          padding: 4px 10px 10px;
        }
        .session-drawer.open {
          display: block;
        }

        @media (min-width: 1000px) {
          .chat-shell[data-layout="wide"] {
            flex-direction: row;
            align-items: stretch;
          }
          .chat-shell[data-layout="wide"] .chat-column {
            flex: 1 1 0;
          }
          .chat-shell[data-layout="wide"] .session-rail {
            width: min(320px, 32vw);
            border-bottom: 0;
            border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-widget-border, #444));
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .chat-shell[data-layout="wide"] .session-rail-header {
            padding: 8px 10px 6px;
          }
          .chat-shell[data-layout="wide"] .session-toggle {
            cursor: pointer;
          }
          .chat-shell[data-layout="wide"] .session-drawer {
            display: block;
            flex: 1 1 auto;
            max-height: none;
            padding: 0 10px 10px;
          }
          .chat-shell[data-layout="wide"] .main-panel {
            padding: 8px 12px 0;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-rail {
            width: 48px;
            min-width: 48px;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-rail-header {
            justify-content: center;
            padding: 8px 4px 6px;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .toggle-label,
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-count-badge,
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .create-session-btn {
            display: none;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-toggle {
            justify-content: center;
          }
          .chat-shell[data-layout="wide"][data-session-rail="collapsed"] .session-drawer {
            display: none;
          }
        }

        /* ---- Main content: fills remaining space ---- */
        .main-panel {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-height: 0;
          overflow: hidden;
          padding: 8px 10px 0;
        }
        .panel-header {
          flex: 0 0 auto;
        }
        .rail-header, .panel-header, .row {
          display: flex;
          gap: 8px;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .eyebrow {
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        h1, h2 {
          margin: 2px 0;
          font-size: 1.05rem;
        }
        .panel-subtitle, .status-label, .session-meta, .empty-state {
          color: var(--vscode-descriptionForeground);
          font-size: 0.85em;
        }
        .status-label { flex: 0 0 auto; }
        .recovery-notice {
          display: grid;
          gap: 0.25rem;
          margin: 0 1.1rem 0.75rem;
          padding: 0.7rem 0.85rem;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #c27803) 40%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--vscode-editorWarning-foreground, #c27803) 14%, transparent),
            color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 92%, transparent));
          color: var(--vscode-editor-foreground, #d4d4d4);
        }
        .recovery-notice[data-tone="recent"] {
          border-color: color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 34%, transparent);
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 12%, transparent),
            color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 92%, transparent));
        }
        .recovery-notice-title {
          font-size: 0.77rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .recovery-notice-summary {
          font-size: 0.88rem;
          line-height: 1.4;
        }
        .composer-hint-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .composer-hint-btn {
          color: var(--vscode-descriptionForeground);
          opacity: 0.7;
        }
        .composer-hint-btn:hover {
          opacity: 1;
        }
        .composer-hint-tooltip {
          display: none;
          position: absolute;
          bottom: calc(100% + 8px);
          right: 0;
          width: min(360px, calc(100vw - 32px));
          background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
          border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border, #444));
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 0.82em;
          color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
          line-height: 1.5;
          white-space: normal;
          z-index: 100;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: none;
        }
        .composer-hint-title {
          margin-bottom: 6px;
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .composer-hint-list {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .composer-hint-list li {
          margin: 0;
        }
        .composer-hint-wrap:hover .composer-hint-tooltip,
        .composer-hint-wrap:focus-within .composer-hint-tooltip {
          display: block;
        }
        .approval-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 0 0 auto;
        }
        .approval-stack.hidden {
          display: none;
        }
        .approval-card {
          border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 72%, var(--vscode-widget-border, #444));
          border-radius: 10px;
          padding: 12px;
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #5a451d) 32%, var(--vscode-editor-background));
          box-shadow: inset 3px 0 0 color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 82%, transparent);
        }
        .approval-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
          flex-wrap: wrap;
        }
        .approval-card-heading {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .approval-alert-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          color: var(--vscode-inputValidation-warningForeground, #ffcc33);
          background: color-mix(in srgb, var(--vscode-inputValidation-warningForeground, #ffcc33) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 68%, transparent);
          flex: 0 0 auto;
        }
        .approval-alert-icon svg {
          width: 14px;
          height: 14px;
        }
        .approval-card-title {
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        }
        .approval-risk-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 0.72rem;
          border: 1px solid var(--vscode-widget-border, #444);
        }
        .approval-risk-badge.high {
          background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #5a1d1d) 65%, transparent);
        }
        .approval-risk-badge.medium {
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #5a451d) 60%, transparent);
        }
        .approval-risk-badge.low {
          background: color-mix(in srgb, var(--vscode-badge-background, var(--vscode-button-background)) 25%, transparent);
        }
        .approval-tool-name {
          font-weight: 700;
          margin-bottom: 4px;
        }
        .approval-detail {
          margin: 8px 0;
          padding: 8px 10px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--vscode-editor-background) 86%, var(--vscode-inputValidation-warningBackground, #5a451d) 14%);
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          color: var(--vscode-descriptionForeground);
          font-size: 0.82em;
          line-height: 1.45;
          white-space: pre-wrap;
          max-height: 180px;
          overflow: auto;
        }
        .approval-meta {
          color: var(--vscode-descriptionForeground);
          font-size: 0.84em;
          margin-bottom: 8px;
        }
        .approval-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .approval-actions button.danger {
          border-color: color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 70%, var(--vscode-widget-border, #444));
        }
        .chat-transcript, .run-inspector {
          flex: 1 1 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 80px;
          overflow-y: auto;
          padding: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editorHoverWidget-background, #111) 8%);
        }

        /* ---- Session cards (compact) ---- */
        .session-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding-right: 4px;
        }
        .session-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rail-section-label {
          margin-top: 4px;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
        }
        .session-item {
          width: 100%;
          text-align: left;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-sideBar-background, var(--vscode-editor-background));
          border-radius: 6px;
          padding: 6px 8px;
          cursor: pointer;
          color: inherit;
          font-size: 0.88em;
        }
        .session-item.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .session-item-title {
          font-weight: 600;
          margin-bottom: 2px;
          font-size: 0.9em;
        }
        .session-item-preview {
          font-size: 0.82em;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .session-child-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-left: 14px;
          padding-left: 10px;
          border-left: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
        }
        .session-child-item {
          width: 100%;
          text-align: left;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 94%, black 6%);
          border-radius: 6px;
          padding: 5px 8px;
          cursor: pointer;
          color: inherit;
          font-size: 0.82em;
        }
        .session-child-item.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .session-child-title {
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }
        .session-item-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 4px;
        }
        .session-item-actions button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: var(--vscode-foreground);
          cursor: pointer;
        }
        .session-item-actions button:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
        }
        .session-item-actions button svg {
          width: 14px;
          height: 14px;
        }
        .session-meta {
          font-size: 0.78em;
          color: var(--vscode-descriptionForeground);
        }

        /* ---- Composer: anchored to bottom ---- */
        .composer-shell {
          flex: 0 0 auto;
          border-top: 1px solid var(--vscode-widget-border, #444);
          border-radius: 0;
          padding: 8px 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
          min-width: 0;
        }
        .toolbar-row { margin-bottom: 0; }
        .composer-tools, .attach-row, .send-group, .chip-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }
        .composer-tools {
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .composer-section {
          margin: 0 0 4px;
        }
        .compact-section-label {
          margin-top: 0;
          margin-bottom: 2px;
          font-size: 0.68rem;
        }
        .send-group select {
          min-width: 100px;
          padding: 4px 8px;
          font-size: 0.88em;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 6px;
        }
        .attachment-row {
          min-height: 0;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 999px;
          padding: 3px 8px;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%);
          font-size: 0.82em;
        }
        .chip button {
          padding: 0;
          min-width: auto;
          border: 0;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .attachment-chip {
          border-radius: 10px;
          padding: 4px 6px;
          max-width: 100%;
        }
        .attachment-preview-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          text-align: left;
        }
        .attachment-thumb,
        .message-attachment-thumb {
          width: 42px;
          height: 42px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
          flex: 0 0 auto;
        }
        .attachment-label-stack {
          display: flex;
          flex-direction: column;
          min-width: 0;
          gap: 2px;
        }
        .attachment-kind-label {
          font-size: 0.72em;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
        }
        .attachment-source-label,
        .message-attachment-label {
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .message-attachment-gallery {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }
        .message-attachment-card,
        .message-attachment-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
          color: inherit;
        }
        .message-attachment-card {
          cursor: pointer;
          text-align: left;
          max-width: 240px;
        }
        .message-attachment-pill {
          font-size: 0.8em;
        }
        .media-lightbox {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: color-mix(in srgb, black 78%, transparent);
        }
        .media-lightbox.hidden {
          display: none;
        }
        .media-lightbox-panel {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: min(92vw, 1100px);
          max-height: 88vh;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: var(--vscode-editor-background, #1e1e1e);
          box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
        }
        .media-lightbox-close {
          align-self: flex-end;
        }
        .media-lightbox-image {
          max-width: min(88vw, 1040px);
          max-height: calc(88vh - 64px);
          object-fit: contain;
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 88%, white 12%);
        }
        .media-lightbox-caption {
          font-size: 0.84em;
          color: var(--vscode-descriptionForeground);
          text-align: center;
        }
        .compact-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 26px;
          min-height: 26px;
          width: 26px;
          height: 26px;
          padding: 0;
          font-size: 0.82rem;
          line-height: 1;
        }
        .mic-btn.listening {
          border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
          color: var(--vscode-button-background);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
        }
        .mic-btn.listening .mic-icon {
          animation: atlasmic-pulse 1.1s ease-in-out infinite;
        }
        .mic-btn:disabled {
          opacity: 0.55;
        }
        .autopilot-btn[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--vscode-charts-yellow, #d7ba7d) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-charts-yellow, #d7ba7d) 18%, transparent);
          color: var(--vscode-charts-yellow, #d7ba7d);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-charts-yellow, #d7ba7d) 30%, transparent);
        }
        .open-file-chip {
          cursor: pointer;
        }
        .drop-hint {
          margin: 2px 0 4px;
          padding: 4px 8px;
          border: 1px dashed var(--vscode-widget-border, #444);
          border-radius: 8px;
          color: var(--vscode-descriptionForeground);
          font-size: 0.82em;
        }
        .drop-hint.dragover, .composer-shell.dragover {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
        }
        .pending-run-review-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin: 4px 0 6px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 48%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
          cursor: pointer;
        }
        .pending-run-review-copy {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .pending-run-review-copy strong,
        .pending-run-review-copy span {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pending-run-review-copy span {
          font-size: 0.82em;
          color: var(--vscode-descriptionForeground);
        }
        .pending-run-review-chevron {
          font-size: 0.8rem;
          transition: transform 120ms ease;
        }
        .pending-run-review-bar[aria-expanded="true"] .pending-run-review-chevron {
          transform: rotate(180deg);
        }
        .pending-run-review-flyout {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin: 0 0 8px;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
          max-height: 240px;
          overflow-y: auto;
        }
        .pending-run-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
        }
        .pending-run-section:last-child {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .pending-run-header,
        .pending-run-bulk-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pending-run-header {
          justify-content: space-between;
        }
        .pending-run-title {
          font-weight: 600;
          font-size: 0.88em;
        }
        .pending-run-open-btn {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: inherit;
          cursor: pointer;
        }
        .pending-run-open-btn.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
        }
        textarea {
          width: 100%;
          box-sizing: border-box;
          resize: vertical;
          min-height: 56px;
          padding: 6px 10px;
          font-size: 0.92em;
          color: var(--vscode-input-foreground);
          background: var(--vscode-input-background);
          border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, #444));
          border-radius: 6px;
        }
        .composer-row {
          margin-top: 4px;
          align-items: center;
        }

        /* ---- Chat messages ---- */
        .chat-message {
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 82%, transparent);
          white-space: pre-wrap;
          word-break: break-word;
          font-size: calc(0.95rem * var(--atlas-chat-font-scale));
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
        }
        .chat-message-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 5px;
          flex-wrap: wrap;
        }
        .chat-message.user {
          align-self: flex-end;
          width: min(90%, 740px);
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
        }
        .chat-message.assistant {
          align-self: flex-start;
          width: min(94%, 800px);
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 84%, white 8%);
        }
        .chat-message.selected-message {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 20%, transparent);
        }
        .chat-message.pending {
          border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--vscode-button-background)) 60%, var(--vscode-widget-border, #444));
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background) 12%, transparent);
        }
        .chat-role {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
          font-size: 0.68rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 92%, var(--vscode-foreground));
          opacity: 0.9;
          line-height: 1;
        }
        .chat-model-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          min-height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 93%, transparent);
          font-size: 0.68rem;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 86%, var(--vscode-foreground));
          opacity: 0.92;
          line-height: 1;
        }
        .chat-model-badge.expandable {
          cursor: pointer;
          user-select: none;
        }
        .chat-model-badge.expandable:hover {
          opacity: 1;
          border-color: color-mix(in srgb, var(--vscode-widget-border, #444) 100%, transparent);
        }
        .model-badge-count {
          opacity: 0.75;
        }
        .live-dot {
          display: inline-block;
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          opacity: 0.6;
          flex-shrink: 0;
          animation: live-pulse 1.6s ease-in-out infinite;
        }
        @keyframes live-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.2; }
        }
        .model-badge-dropdown {
          position: relative;
        }
        .model-badge-list {
          display: none;
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          min-width: 180px;
          background: var(--vscode-editor-background);
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          border-radius: 6px;
          padding: 4px 0;
          z-index: 50;
          box-shadow: 0 4px 12px rgba(0,0,0,0.18);
        }
        .model-badge-list.open {
          display: block;
        }
        .model-badge-list-item {
          padding: 4px 10px;
          font-size: 0.68rem;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 86%, var(--vscode-foreground));
          white-space: nowrap;
        }
        .model-badge-list-item.current {
          color: var(--vscode-foreground);
          font-weight: 600;
        }
        .model-badge-list-label {
          padding: 3px 10px 2px;
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          opacity: 0.55;
        }
        .font-size-controls {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-right: 2px;
        }
        .font-size-controls .compact-icon-btn {
          min-width: 28px;
          width: 28px;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .font-size-controls .compact-icon-btn:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .chat-content {
          word-break: break-word;
          line-height: 1.62;
          color: color-mix(in srgb, var(--vscode-foreground) 96%, white 4%);
        }
        .chat-content > :first-child {
          margin-top: 0;
        }
        .chat-content > :last-child {
          margin-bottom: 0;
        }
        .chat-content p,
        .chat-content ul,
        .chat-content ol,
        .chat-content pre,
        .chat-content blockquote,
        .chat-content hr,
        .chat-table-wrap {
          margin: 0 0 12px;
        }
        .chat-content h1,
        .chat-content h2,
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          margin: 2px 0 7px;
          line-height: 1.28;
          max-width: 76ch;
          font-weight: 600;
          color: color-mix(in srgb, var(--vscode-foreground) 94%, var(--vscode-descriptionForeground));
        }
        .chat-content h1 {
          font-size: 0.98rem;
        }
        .chat-content h2 {
          font-size: 0.94rem;
        }
        .chat-content h3,
        .chat-content h4,
        .chat-content h5,
        .chat-content h6 {
          font-size: 0.88rem;
        }
        .chat-content p,
        .chat-content ul,
        .chat-content ol,
        .chat-content blockquote {
          max-width: 76ch;
        }
        .chat-content ul,
        .chat-content ol {
          padding-left: 18px;
        }
        .chat-content li + li {
          margin-top: 6px;
        }
        .chat-content code {
          font-family: var(--vscode-editor-font-family, Consolas, 'Courier New', monospace);
          font-size: 0.92em;
          padding: 1px 5px;
          border-radius: 6px;
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 82%, transparent);
        }
        .chat-content pre {
          margin: 0;
          overflow: auto;
          max-height: 320px;
          padding: 12px 14px;
          border-radius: 0 0 12px 12px;
          border: 0;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 92%, transparent);
        }
        .chat-content pre code {
          padding: 0;
          border-radius: 0;
          background: transparent;
          display: block;
          min-width: max-content;
          line-height: 1.5;
        }
        .chat-code-block {
          max-width: min(100%, 88ch);
          margin: 0 0 12px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 82%, transparent);
          overflow: hidden;
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 90%, black 10%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        .chat-code-block-header {
          display: flex;
          align-items: center;
          padding: 7px 12px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--vscode-descriptionForeground);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, white 4%);
        }
        .chat-code-block-lang {
          flex: 1;
        }
        .chat-code-block-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .chat-code-block:hover .chat-code-block-actions {
          opacity: 1;
        }
        .chat-code-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          border: none;
          border-radius: 5px;
          background: transparent;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
        }
        .chat-code-btn:hover {
          background: color-mix(in srgb, var(--vscode-foreground, #cccccc) 12%, transparent);
          color: var(--vscode-foreground);
        }
        .chat-code-btn--copied {
          color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
        }
        .chat-code-btn--active {
          color: var(--vscode-button-background, #0078d4);
        }
        .chat-content blockquote {
          margin-left: 0;
          padding: 4px 0 4px 12px;
          border-left: 2px solid color-mix(in srgb, var(--vscode-button-background) 32%, var(--vscode-widget-border, #444));
          color: color-mix(in srgb, var(--vscode-descriptionForeground, var(--vscode-foreground)) 92%, var(--vscode-foreground));
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 97%, transparent);
          border-radius: 0 8px 8px 0;
        }
        .chat-table-wrap {
          max-width: min(100%, 88ch);
          overflow-x: auto;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 72%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, white 4%);
        }
        .chat-markdown-table {
          width: 100%;
          min-width: 360px;
          border-collapse: collapse;
          font-size: 0.875em;
        }
        .chat-markdown-table th,
        .chat-markdown-table td {
          padding: 7px 12px;
          vertical-align: top;
          border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 64%, transparent);
        }
        .chat-markdown-table th {
          font-weight: 700;
          white-space: nowrap;
          color: color-mix(in srgb, var(--vscode-foreground) 94%, white 6%);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 90%, white 10%);
        }
        .chat-markdown-table tbody tr:nth-child(even) td {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 94%, transparent);
        }
        .chat-markdown-table tbody tr:last-child td {
          border-bottom: 0;
        }
        .chat-content a {
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-decoration: underline;
        }
        .chat-content hr {
          border: 0;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .chat-content .thinking-note {
          font-size: 0.9em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground, #999) 88%, var(--vscode-foreground));
          font-style: italic;
        }
        .assistant-footer {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .assistant-meta-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .assistant-footer-thought {
          min-width: 0;
        }
        .assistant-utility-row {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .transcript-disclosure {
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 74%, transparent);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 90%, white 6%);
          overflow: hidden;
        }
        .transcript-disclosure summary::-webkit-details-marker {
          display: none;
        }
        .transcript-disclosure-summary {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          cursor: pointer;
          list-style: none;
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 96%, transparent);
        }
        .transcript-disclosure-summary::before {
          content: '\\25B8';
          display: inline-block;
          margin-right: 8px;
          color: var(--vscode-descriptionForeground);
          transition: transform 120ms ease;
          flex: 0 0 auto;
        }
        .transcript-disclosure[open] .transcript-disclosure-summary::before {
          transform: rotate(90deg);
        }
        .transcript-disclosure-heading {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1 1 auto;
        }
        .transcript-disclosure-title {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--vscode-foreground);
        }
        .transcript-disclosure-preview {
          min-width: 0;
          font-size: 0.77rem;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .transcript-disclosure-body {
          padding: 0 10px 10px;
        }
        .auxiliary-section {
          max-width: min(100%, 88ch);
          border-style: dashed;
          opacity: 0.94;
        }
        .auxiliary-section.transcript-disclosure {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 94%, white 8%);
          border-color: color-mix(in srgb, var(--vscode-widget-border, #444) 56%, transparent);
        }
        .auxiliary-section .transcript-disclosure-summary {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 97%, white 5%);
        }
        .chat-utility-block {
          display: grid;
          gap: 8px;
        }
        .chat-utility-list {
          margin: 0;
          padding-left: 1rem;
          display: grid;
          gap: 0.4rem;
        }
        .chat-utility-item {
          font-size: 0.8rem;
          line-height: 1.45;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .assistant-timeline-notes {
          min-width: 0;
        }
        .assistant-timeline-list {
          margin: 0;
          padding-left: 1rem;
          display: grid;
          gap: 0.45rem;
          font-size: 0.8rem;
          line-height: 1.45;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .assistant-timeline-list li {
          font-weight: 400;
        }
        .assistant-timeline-inline-label {
          font-weight: 600;
          color: color-mix(in srgb, var(--vscode-foreground) 88%, var(--vscode-descriptionForeground));
        }
        .assistant-timeline-list li.warning {
          color: var(--vscode-editorWarning-foreground, #c27803);
        }
        .run-review-link-row {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-right: auto;
        }
        .run-review-link {
          border: 0;
          background: transparent;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-decoration: underline;
          cursor: pointer;
          padding: 0;
          font-size: 0.78rem;
        }
        .run-review-link.active {
          color: var(--vscode-button-background);
          font-weight: 600;
        }
        .chat-message-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex: 0 1 auto;
          flex-wrap: wrap;
          margin-left: auto;
        }
        .assistant-followup-controls {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: wrap;
        }
        .assistant-followup-toggle,
        .assistant-followup-proceed {
          appearance: none;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 0.75rem;
          line-height: 1.35;
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
        }
        .assistant-followup-toggle {
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, white 8%);
          color: var(--vscode-foreground);
        }
        .assistant-followup-toggle.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .assistant-followup-toggle:hover,
        .assistant-followup-proceed:hover:not(:disabled) {
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .assistant-followup-proceed {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 60%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 84%, transparent);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
          font-weight: 600;
        }
        .assistant-followup-proceed:disabled {
          cursor: not-allowed;
          opacity: 0.6;
          background: color-mix(in srgb, var(--vscode-editor-background) 94%, white 6%);
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
          border-color: var(--vscode-widget-border, #444);
        }
        /* Quick-reply pill buttons — immediate-submit, no Proceed step required */
        .quick-reply-buttons {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-right: 6px;
        }
        .quick-reply-btn {
          appearance: none;
          border-radius: 999px;
          padding: 4px 14px;
          font-size: 0.75rem;
          line-height: 1.35;
          cursor: pointer;
          font-weight: 600;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
          color: var(--vscode-foreground);
          transition: background 100ms ease, border-color 100ms ease, transform 80ms ease;
        }
        .quick-reply-btn:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 28%, transparent);
          border-color: var(--vscode-button-background);
        }
        .quick-reply-btn:active {
          transform: scale(0.96);
        }
        .iteration-limit-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          margin-right: 6px;
        }
        .iteration-limit-continue,
        .iteration-limit-cancel,
        .iteration-limit-raise-perm,
        .iteration-limit-raise-temp {
          appearance: none;
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 0.78rem;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease, opacity 0.15s ease;
        }
        .iteration-limit-raise-perm {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 60%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 84%, transparent);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
          font-weight: 600;
        }
        .iteration-limit-raise-perm:hover {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
        }
        .iteration-limit-raise-temp {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 40%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 30%, transparent);
          color: var(--vscode-foreground);
        }
        .iteration-limit-raise-temp:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 55%, transparent);
        }
        .iteration-limit-continue {
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 60%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-button-background) 84%, transparent);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
          font-weight: 600;
        }
        .iteration-limit-continue:hover {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground, var(--vscode-foreground));
        }
        .iteration-limit-cancel {
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: var(--vscode-foreground);
        }
        .iteration-limit-cancel:hover {
          background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
        }
        .assistant-followups {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 2px;
          padding: 9px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-button-background) 6%, transparent);
        }
        .assistant-followup-question {
          color: var(--vscode-descriptionForeground, var(--vscode-foreground));
          font-size: 0.78rem;
          line-height: 1.45;
        }
        .assistant-followup-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .assistant-followup-chip {
          appearance: none;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
          color: var(--vscode-foreground);
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 0.75rem;
          cursor: pointer;
        }
        .assistant-followup-chip:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
        }
        .vote-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          min-width: 28px;
          min-height: 28px;
          padding: 0;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: color-mix(in srgb, var(--vscode-foreground) 84%, var(--vscode-descriptionForeground));
          cursor: pointer;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .vote-btn svg {
          width: 15px;
          height: 15px;
        }
        .vote-btn.active {
          border-color: var(--vscode-focusBorder, var(--vscode-button-background));
          background: color-mix(in srgb, var(--vscode-button-background) 16%, transparent);
          color: var(--vscode-foreground);
        }
        .vote-btn:hover {
          background: color-mix(in srgb, var(--vscode-button-background) 10%, transparent);
          color: var(--vscode-foreground);
        }
        .search-nav-btn {
          font-size: 1rem;
          line-height: 1;
          font-weight: 700;
        }
        .search-highlight {
          background: color-mix(in srgb, #f5e663 82%, white 18%);
          color: #111;
          border-radius: 3px;
          padding: 0 1px;
        }
        .search-highlight-active {
          background: color-mix(in srgb, var(--vscode-button-background, #0e639c) 72%, #f5e663 28%);
          color: var(--vscode-button-foreground, white);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-button-background, #0e639c) 70%, transparent);
        }
        .delete-btn:hover {
          border-color: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 70%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 12%, transparent);
          color: var(--vscode-errorForeground, #f48771);
        }
        .thought-details {
          margin-top: 0;
          opacity: 0.92;
        }
        .thought-details .transcript-disclosure-title {
          font-size: 0.75rem;
          color: var(--vscode-descriptionForeground);
          font-weight: 600;
        }
        .thought-details .transcript-disclosure-summary {
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 98%, transparent);
        }
        .streaming-thought-details {
          margin-top: 6px;
          margin-bottom: 6px;
        }
        .streaming-thought-details .transcript-disclosure-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }
        .streaming-thought-list {
          margin: 4px 0 0 12px;
        }
        .streaming-thought-latest {
          margin: 8px 0 0;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 68%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background, #1e1e1e) 95%, white 5%);
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 90%, var(--vscode-foreground));
          font-size: 0.8em;
          line-height: 1.45;
        }
        .streaming-thought-history {
          margin-top: 8px;
        }
        .streaming-thought-list li {
          font-size: 0.8em;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 90%, var(--vscode-foreground));
          margin: 3px 0;
        }
        .streaming-thought-list li:last-child {
          font-weight: 500;
          color: var(--vscode-descriptionForeground);
        }
        .thought-status-chip {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          font-size: 0.8em;
          font-weight: 500;
          vertical-align: middle;
        }
        .thought-status-chip.verified {
          color: var(--vscode-testing-iconPassed, #4ec9b0);
          background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4ec9b0) 14%, transparent);
        }
        .thought-status-chip.blocked,
        .thought-status-chip.missing {
          color: var(--vscode-notificationsWarningIcon-foreground, #ffb347);
          background: color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #cca700) 14%, transparent);
        }
        .thought-status-chip.not-applicable {
          color: var(--vscode-descriptionForeground, #999);
          background: color-mix(in srgb, var(--vscode-descriptionForeground, #999) 12%, transparent);
        }
        .thought-summary {
          margin: 2px 0 0;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.84em;
          line-height: 1.5;
        }
        .thought-list {
          margin: 8px 0 0 16px;
          padding: 0;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
          font-size: 0.82em;
        }
        .thought-list li {
          margin: 4px 0;
        }
        .run-review-bubble {
          margin-top: 10px;
          padding: 12px;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent);
          background: color-mix(in srgb, var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 76%, black 14%);
        }
        .run-review-header,
        .run-review-controls,
        .run-review-file-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .run-review-header {
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .run-review-kicker {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--vscode-descriptionForeground);
          margin-bottom: 2px;
        }
        .run-review-title {
          margin: 0;
          font-size: 0.95rem;
        }
        .run-review-pill {
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--vscode-button-background) 48%, var(--vscode-widget-border, #444));
          font-size: 0.78rem;
        }
        .run-review-goal,
        .run-review-summary {
          margin: 0 0 8px;
          color: color-mix(in srgb, var(--vscode-descriptionForeground) 88%, var(--vscode-foreground));
        }
        .run-review-controls {
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .run-review-open-center {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 999px;
          background: transparent;
          color: inherit;
          padding: 4px 10px;
          cursor: pointer;
        }
        .run-review-file-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .run-review-file-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: center;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
        }
        .run-review-file-row.accepted {
          border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4ec9b0) 52%, var(--vscode-widget-border, #444));
        }
        .run-review-file-row.dismissed {
          border-color: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 52%, var(--vscode-widget-border, #444));
        }
        .run-review-file-link {
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--vscode-textLink-foreground, var(--vscode-foreground));
          text-align: left;
          text-decoration: underline;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .run-review-file-meta {
          font-size: 0.78rem;
          color: var(--vscode-descriptionForeground);
          white-space: nowrap;
        }
        .run-review-decision-btn {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: inherit;
          cursor: pointer;
          font-weight: 700;
        }
        .run-review-decision-btn.accepted {
          color: var(--vscode-testing-iconPassed, #4ec9b0);
        }
        .run-review-decision-btn.dismissed {
          color: var(--vscode-errorForeground, #f14c4c);
        }
        .run-review-decision-btn.active {
          background: color-mix(in srgb, currentColor 14%, transparent);
          border-color: currentColor;
        }
        .thinking-indicator {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 78%, transparent);
        }
        .thinking-indicator.compact {
          margin-top: 10px;
        }
        .thinking-logo {
          position: relative;
          width: 28px;
          height: 28px;
          flex: 0 0 28px;
        }
        .thinking-logo::before {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 999px;
          background: radial-gradient(circle, color-mix(in srgb, var(--vscode-button-background) 24%, transparent) 0%, transparent 72%);
          animation: atlas-glow 1.8s ease-in-out infinite;
        }
        .thinking-logo svg {
          position: relative;
          width: 100%;
          height: 100%;
          color: var(--vscode-button-background);
          animation: atlas-float 1.8s ease-in-out infinite;
        }
        .thinking-logo .atlas-outline {
          opacity: 0.9;
        }
        .thinking-logo .atlas-axis {
          transform-origin: center;
          animation: atlas-spin 2.6s linear infinite;
          transform-box: view-box;
        }
        .thinking-copy {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .thinking-title {
          font-weight: 600;
          font-size: 0.9em;
        }
        .thinking-subtitle {
          color: var(--vscode-descriptionForeground);
          font-size: 0.82em;
        }
        @keyframes atlas-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes atlas-float {
          0%, 100% { transform: scale(0.96); opacity: 0.88; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        @keyframes atlas-glow {
          0%, 100% { opacity: 0.28; transform: scale(0.92); }
          50% { opacity: 0.75; transform: scale(1.08); }
        }

        /* ---- Session tile busy indicator ---- */
        .session-item-running .session-item-title { display: flex; align-items: center; gap: 4px; }
        .session-item-busy-logo { flex: 0 0 14px; width: 14px; height: 14px; margin-left: auto; }
        .session-item-busy-logo svg { width: 14px; height: 14px; color: var(--vscode-button-background); animation: atlas-float 1.8s ease-in-out infinite; }
        .session-item-busy-logo .atlas-outline { opacity: 0.9; }
        .session-item-busy-logo .atlas-axis { transform-origin: center; animation: atlas-spin 2.6s linear infinite; transform-box: view-box; }

        /* ---- Run inspector ---- */
        .run-card {
          border: 1px solid var(--vscode-widget-border, #444);
          border-radius: 8px;
          padding: 10px;
          background: color-mix(in srgb, var(--vscode-editor-background) 90%, white 10%);
        }
        .run-card h3, .run-card h4 { margin: 0 0 6px; }
        .run-status-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--vscode-widget-border, #444);
          font-size: 0.82em;
        }
        .run-log-list, .subtask-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .subtask-item {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--vscode-widget-border, #444);
          background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 78%, transparent);
        }
        .hidden { display: none; }
        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          min-height: 28px;
          border-radius: 999px;
          font-size: 0.95rem;
          line-height: 1;
          box-sizing: border-box;
          vertical-align: middle;
        }
        .icon-btn svg {
          display: block;
          flex: 0 0 auto;
        }
        .primary-btn {
          padding: 4px 12px;
          font-size: 0.88em;
        }
        .danger-btn {
          padding: 4px 12px;
          font-size: 0.88em;
          border: 1px solid color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 40%, var(--vscode-widget-border, #444));
          background: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 12%, transparent);
          color: var(--vscode-errorForeground, #f14c4c);
        }
        @keyframes atlasmic-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.7; }
        }

        /* ---- AI instruction nudge ---- */
        .ai-instruction-nudge {
          flex: 0 0 auto;
          border: 1px solid color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 40%, transparent);
          border-radius: 10px;
          background: color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 10%, var(--vscode-editor-background, #1e1e1e));
          margin: 0;
        }
        .ai-instruction-nudge-body {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
        }
        .ai-instruction-nudge-icon {
          flex: 0 0 auto;
          color: var(--vscode-editorInfo-foreground, #3794ff);
          font-size: 1.1em;
        }
        .ai-instruction-nudge-text {
          flex: 1 1 auto;
          font-size: 0.88em;
          line-height: 1.35;
          min-width: 0;
        }
        .nudge-btn {
          flex: 0 0 auto;
          padding: 3px 10px;
          font-size: 0.82em;
          border-radius: 6px;
          white-space: nowrap;
          cursor: pointer;
          border: 1px solid var(--vscode-widget-border, #444);
          background: transparent;
          color: var(--vscode-foreground);
        }
        .nudge-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
        .nudge-btn-primary {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border-color: transparent;
        }
        .nudge-btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
        .nudge-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`,
    scriptUri: opts.scriptUri,
  });
}
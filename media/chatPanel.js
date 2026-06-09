// @ts-nocheck
// Chat panel webview script — loaded as an external file to avoid
// template-literal escaping issues with inline <script> blocks.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const toggleSearch = document.getElementById('toggleSearch');
  const sendPrompt = document.getElementById('sendPrompt');
  const sessionList = document.getElementById('sessionList');
  const runList = document.getElementById('runList');
  const runToggle = document.getElementById('runToggle');
  const runListContainer = document.getElementById('runListContainer');
  const runCountBadge = document.getElementById('runCount');
  const pendingApprovals = document.getElementById('pendingApprovals');
  const transcript = document.getElementById('transcript');
  const runInspector = document.getElementById('runInspector');
  const promptInput = document.getElementById('promptInput');
  const status = document.getElementById('status');
  const recoveryNotice = document.getElementById('recoveryNotice');
  const recoveryNoticeTitle = document.getElementById('recoveryNoticeTitle');
  const recoveryNoticeSummary = document.getElementById('recoveryNoticeSummary');
  const stopPrompt = document.getElementById('stopPrompt');
  const sendMode = document.getElementById('sendMode');
  let isSearchMode = false;

      function parseToolExecutionMessage(message) {
        if (typeof message !== 'string' || !message.startsWith('[TOOL_EXEC]')) {
          return null;
        }

        const payload = message.slice('[TOOL_EXEC]'.length);
        if (!payload.startsWith('{')) {
          return null;
        }

        // Parse the leading JSON object with brace-depth tracking because nested
        // tool payloads contain additional braces.
        let depth = 0;
        let inString = false;
        let escaping = false;
        let jsonEnd = -1;
        for (let i = 0; i < payload.length; i += 1) {
          const ch = payload[i];

          if (escaping) {
            escaping = false;
            continue;
          }
          if (ch === '\\') {
            escaping = true;
            continue;
          }
          if (ch === '"') {
            inString = !inString;
            continue;
          }
          if (inString) {
            continue;
          }

          if (ch === '{') {
            depth += 1;
          } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
              jsonEnd = i;
              break;
            }
          }
        }

        if (jsonEnd < 0) {
          return null;
        }

        const jsonPart = payload.slice(0, jsonEnd + 1);
        const humanReadable = payload.slice(jsonEnd + 1);
        try {
          const data = JSON.parse(jsonPart);
          return { data, humanReadable, fullMessage: message };
        } catch (e) {
          return null;
        }
      }

    function ensureSearchControls() {
      if (!document.getElementById('searchButton') && sendPrompt && sendPrompt.parentNode) {
        const btn = document.createElement('button');
        btn.id = 'searchButton';
        btn.type = 'button';
        btn.className = 'composer-search-btn hidden';
        btn.textContent = 'Search';
        btn.title = 'Search this session';
        btn.setAttribute('aria-label', 'Search this session');
        sendPrompt.parentNode.insertBefore(btn, sendPrompt.nextSibling);
      }

      const activeSearchBtn = document.getElementById('searchButton');
      if (activeSearchBtn && activeSearchBtn.parentNode) {
        if (!document.getElementById('searchPrevBtn')) {
          const prevBtn = document.createElement('button');
          prevBtn.id = 'searchPrevBtn';
          prevBtn.type = 'button';
          prevBtn.className = 'icon-btn compact-icon-btn search-nav-btn hidden';
          prevBtn.title = 'Previous result';
          prevBtn.setAttribute('aria-label', 'Previous result');
          prevBtn.innerHTML = '‹';
          activeSearchBtn.parentNode.insertBefore(prevBtn, activeSearchBtn);
        }
        if (!document.getElementById('searchNextBtn')) {
          const nextBtn = document.createElement('button');
          nextBtn.id = 'searchNextBtn';
          nextBtn.type = 'button';
          nextBtn.className = 'icon-btn compact-icon-btn search-nav-btn hidden';
          nextBtn.title = 'Next result';
          nextBtn.setAttribute('aria-label', 'Next result');
          nextBtn.innerHTML = '›';
          if (activeSearchBtn.nextSibling) {
            activeSearchBtn.parentNode.insertBefore(nextBtn, activeSearchBtn.nextSibling);
          } else {
            activeSearchBtn.parentNode.appendChild(nextBtn);
          }
        }
      }
    }

    ensureSearchControls();

    function runSessionSearch() {
      if (!promptInput || promptInput.disabled) {
        return;
      }
      const query = promptInput.value.trim();
      if (!query) {
        status.textContent = 'Enter text to search this session.';
        return;
      }

      lastSearchQuery = query;
      status.textContent = 'Searching this session…';
      currentSearchIndex = 0;
      clearSearchHighlights();
      searchResults = collectSearchMatches(query);
      renderTranscriptWithSearch();
    }

    if (toggleSearch) {
      toggleSearch.addEventListener('click', function () {
        isSearchMode = !isSearchMode;
        if (chatShell) {
          chatShell.setAttribute('data-mode', isSearchMode ? 'search' : 'chat');
        }
        if (sendPrompt) sendPrompt.classList.toggle('hidden', isSearchMode);
        if (sendMode) sendMode.classList.toggle('hidden', isSearchMode);
        ensureSearchControls();
        const activeSearchBtn = document.getElementById('searchButton');
        const prevBtn = document.getElementById('searchPrevBtn');
        const nextBtn = document.getElementById('searchNextBtn');
        if (activeSearchBtn) {
          activeSearchBtn.classList.toggle('hidden', !isSearchMode);
          activeSearchBtn.disabled = false;
          activeSearchBtn.textContent = 'Search';
        }
        if (prevBtn) {
          prevBtn.classList.toggle('hidden', !isSearchMode || searchResults.length <= 1);
        }
        if (nextBtn) {
          nextBtn.classList.toggle('hidden', !isSearchMode || searchResults.length <= 1);
        }
        toggleSearch.setAttribute('aria-pressed', isSearchMode ? 'true' : 'false');
        if (!isSearchMode) {
          searchResults = [];
          currentSearchIndex = 0;
          clearSearchHighlights();
        }
        status.textContent = isSearchMode ? 'Search mode enabled. Enter text and press Search.' : 'Ready.';
        if (promptInput) {
          promptInput.focus();
        }
      });
    }

    // Search button event
    const searchBtn = document.getElementById('searchButton');
    const searchPrevBtn = document.getElementById('searchPrevBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', runSessionSearch);
    }
    if (searchPrevBtn) {
      searchPrevBtn.addEventListener('click', function () {
        if (searchResults.length < 2) {
          return;
        }
        currentSearchIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
        renderTranscriptWithSearch();
      });
    }
    if (searchNextBtn) {
      searchNextBtn.addEventListener('click', function () {
        if (searchResults.length < 2) {
          return;
        }
        currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
        renderTranscriptWithSearch();
      });
    }

    // Keyboard submit for search mode
    if (promptInput) {
      promptInput.addEventListener('keydown', function (event) {
        if (isSearchMode && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          runSessionSearch();
        }
      });
    }
  const attachFiles = document.getElementById('attachFiles');
  const attachOpenFiles = document.getElementById('attachOpenFiles');
  const clearAttachments = document.getElementById('clearAttachments');
  const toggleAutopilotBtn = document.getElementById('toggleAutopilot');
  const attachmentsSection = document.getElementById('attachmentsSection');
  const openFilesSection = document.getElementById('openFilesSection');
  const attachmentList = document.getElementById('attachmentList');
  const openFileLinks = document.getElementById('openFileLinks');
  const dropHint = document.getElementById('dropHint');
  const composerShell = document.querySelector('.composer-shell');
  const clearConversation = document.getElementById('clearConversation');
  const copyTranscript = document.getElementById('copyTranscript');
  const saveTranscript = document.getElementById('saveTranscript');
  const createSession = document.getElementById('createSession');
  const panelTitle = document.getElementById('panelTitle');
  const panelSubtitle = document.getElementById('panelSubtitle');
  const composerHint = document.getElementById('composerHint');
  const pendingRunReviewBar = document.getElementById('pendingRunReviewBar');
  const pendingRunReviewTitle = document.getElementById('pendingRunReviewTitle');
  const pendingRunReviewSummary = document.getElementById('pendingRunReviewSummary');
  const pendingRunReviewFlyout = document.getElementById('pendingRunReviewFlyout');
  const sessionToggle = document.getElementById('sessionToggle');
  const sessionDrawer = document.getElementById('sessionDrawer');
  const sessionCountBadge = document.getElementById('sessionCount');
  const decreaseFontSize = document.getElementById('decreaseFontSize');
  const increaseFontSize = document.getElementById('increaseFontSize');
  const chatShell = document.querySelector('.chat-shell');
  const imageLightbox = document.getElementById('imageLightbox');
  const imageLightboxImage = document.getElementById('imageLightboxImage');
  const imageLightboxCaption = document.getElementById('imageLightboxCaption');
  const imageLightboxClose = document.getElementById('imageLightboxClose');
  const wideLayoutQuery = window.matchMedia('(min-width: 1000px)');
  const persistedUiState = vscode.getState() || {};
  const MIN_CHAT_FONT_SCALE = 0.70;
  const MAX_CHAT_FONT_SCALE = 1.3;
  const CHAT_FONT_SCALE_STEP = 0.05;
  const PROMPT_HISTORY_LIMIT = 50;
  const AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
  let latestState = undefined;
  let isBusy = false;
  let shouldAutoScrollTranscript = true;
  let forceTranscriptScrollOnNextRender = false;
  let queuedComposerMode = undefined;
  let chatFontScale = normalizeChatFontScale(persistedUiState.chatFontScale);
  let narrowSessionDrawerOpen = persistedUiState.narrowSessionDrawerOpen !== false;
  let wideSessionRailCollapsed = Boolean(persistedUiState.wideSessionRailCollapsed);
  let runsCollapsed = persistedUiState.runsCollapsed !== false;
  let promptHistory = Array.isArray(persistedUiState.promptHistory)
    ? persistedUiState.promptHistory.filter(function (entry) {
      return typeof entry === 'string' && entry.trim().length > 0;
    }).slice(-PROMPT_HISTORY_LIMIT)
    : [];
  let promptHistoryIndex = null;
  let promptHistoryDraft = '';
  let suppressPromptHistoryReset = false;
  let composerFocusRestoreHandle = null;
  let shouldRestoreComposerFocus = false;
  let pendingRunReviewFlyoutOpen = Boolean(persistedUiState.pendingRunReviewFlyoutOpen);
  let assistantFollowupSelections = normalizeFollowupSelections(persistedUiState.assistantFollowupSelections);

  const requiredElements = {
    sendPrompt: sendPrompt,
    stopPrompt: stopPrompt,
    sessionList: sessionList,
    runList: runList,
    pendingApprovals: pendingApprovals,
    transcript: transcript,
    runInspector: runInspector,
    promptInput: promptInput,
    status: status,
    sendMode: sendMode,
    attachFiles: attachFiles,
    attachOpenFiles: attachOpenFiles,
    clearAttachments: clearAttachments,
    composerShell: composerShell,
    dropHint: dropHint,
    clearConversation: clearConversation,
    copyTranscript: copyTranscript,
    saveTranscript: saveTranscript,
    createSession: createSession,
    sessionDrawer: sessionDrawer,
    sessionCountBadge: sessionCountBadge,
    decreaseFontSize: decreaseFontSize,
    increaseFontSize: increaseFontSize,
    chatShell: chatShell,
  };
  const missingRequiredElements = Object.keys(requiredElements).filter(function (key) {
    return !requiredElements[key];
  });
  if (missingRequiredElements.length > 0) {
    console.error('[AtlasMind] Chat panel bootstrap failed. Missing required DOM elements:', missingRequiredElements.join(', '));
    document.body.innerHTML = '<div style="padding:12px;color:var(--vscode-errorForeground);">AtlasMind chat panel failed to initialize. Reload the window and reopen AtlasMind Chat.</div>';
    return;
  }

  function normalizeFollowupSelections(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    var normalized = {};
    var keys = Object.keys(value);
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      var candidate = value[key];
      if (Number.isInteger(candidate) && candidate >= 0) {
        normalized[key] = candidate;
      }
    }
    return normalized;
  }

  function normalizeChatFontScale(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 1;
    }
    return Math.min(MAX_CHAT_FONT_SCALE, Math.max(MIN_CHAT_FONT_SCALE, Math.round(numeric * 100) / 100));
  }

  function persistUiState() {
    vscode.setState({
      ...(vscode.getState() || {}),
      chatFontScale: chatFontScale,
      narrowSessionDrawerOpen: narrowSessionDrawerOpen,
      wideSessionRailCollapsed: wideSessionRailCollapsed,
      runsCollapsed: runsCollapsed,
      pendingRunReviewFlyoutOpen: pendingRunReviewFlyoutOpen,
      promptHistory: promptHistory.slice(-PROMPT_HISTORY_LIMIT),
      assistantFollowupSelections: assistantFollowupSelections,
    });
  }

  function setPendingRunReviewFlyoutOpen(nextOpen) {
    pendingRunReviewFlyoutOpen = Boolean(nextOpen);
    if (pendingRunReviewBar) {
      pendingRunReviewBar.setAttribute('aria-expanded', String(pendingRunReviewFlyoutOpen));
    }
    if (pendingRunReviewFlyout) {
      pendingRunReviewFlyout.classList.toggle('hidden', !pendingRunReviewFlyoutOpen);
    }
    persistUiState();
  }

  function updateFontSizeButtons() {
    if (decreaseFontSize) {
      decreaseFontSize.disabled = chatFontScale <= MIN_CHAT_FONT_SCALE;
    }
    if (increaseFontSize) {
      increaseFontSize.disabled = chatFontScale >= MAX_CHAT_FONT_SCALE;
    }
  }

  function applyChatFontScale() {
    if (chatShell) {
      chatShell.style.setProperty('--atlas-chat-font-scale', String(chatFontScale));
    }
    updateFontSizeButtons();
  }

  function adjustChatFontScale(direction) {
    var nextScale = normalizeChatFontScale(chatFontScale + (CHAT_FONT_SCALE_STEP * direction));
    if (nextScale === chatFontScale) {
      return;
    }
    chatFontScale = nextScale;
    applyChatFontScale();
    persistUiState();
  }

  function isTranscriptNearBottom() {
    if (!transcript) {
      return true;
    }
    var remaining = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    return remaining <= AUTO_SCROLL_BOTTOM_THRESHOLD;
  }

  function requestTranscriptAutoScroll() {
    shouldAutoScrollTranscript = true;
    forceTranscriptScrollOnNextRender = true;
  }

  function syncTranscriptAutoScrollPreference() {
    shouldAutoScrollTranscript = isTranscriptNearBottom();
  }

  function maybeScrollTranscriptToBottom() {
    if (!transcript) {
      return;
    }
    if (shouldAutoScrollTranscript || forceTranscriptScrollOnNextRender) {
      transcript.scrollTop = transcript.scrollHeight;
      shouldAutoScrollTranscript = true;
      forceTranscriptScrollOnNextRender = false;
    }
  }

  function applyResponsiveLayout() {
    var isWide = Boolean(wideLayoutQuery.matches);
    if (chatShell) {
      chatShell.setAttribute('data-layout', isWide ? 'wide' : 'narrow');
      chatShell.setAttribute('data-session-rail', isWide && wideSessionRailCollapsed ? 'collapsed' : 'open');
    }
    if (isWide) {
      if (sessionDrawer) {
        sessionDrawer.classList.toggle('open', !wideSessionRailCollapsed);
        sessionDrawer.setAttribute('aria-hidden', String(wideSessionRailCollapsed));
      }
      if (sessionToggle) {
        sessionToggle.setAttribute('aria-expanded', String(!wideSessionRailCollapsed));
      }
      return;
    }

    if (sessionDrawer) {
      sessionDrawer.classList.toggle('open', narrowSessionDrawerOpen);
      sessionDrawer.setAttribute('aria-hidden', String(!narrowSessionDrawerOpen));
    }
    if (sessionToggle) {
      sessionToggle.setAttribute('aria-expanded', String(narrowSessionDrawerOpen));
    }
  }

  // Sessions drawer toggle
  if (sessionToggle) {
    sessionToggle.addEventListener('click', function () {
      if (wideLayoutQuery.matches) {
        wideSessionRailCollapsed = !wideSessionRailCollapsed;
        applyResponsiveLayout();
        persistUiState();
        return;
      }
      narrowSessionDrawerOpen = !narrowSessionDrawerOpen;
      applyResponsiveLayout();
      persistUiState();
    });
  }

  // Standalone Runs drawer toggle
  if (runToggle) {
    runToggle.addEventListener('click', function () {
      runsCollapsed = !runsCollapsed;
      applyRunsCollapsedState();
      persistUiState();
    });
  }

  function applyRunsCollapsedState() {
    if (!runListContainer || !runToggle) { return; }
    runListContainer.classList.toggle('open', !runsCollapsed);
    runListContainer.setAttribute('aria-hidden', String(runsCollapsed));
    runToggle.setAttribute('aria-expanded', String(!runsCollapsed));
  }

  if (typeof wideLayoutQuery.addEventListener === 'function') {
    wideLayoutQuery.addEventListener('change', applyResponsiveLayout);
  } else if (typeof wideLayoutQuery.addListener === 'function') {
    wideLayoutQuery.addListener(applyResponsiveLayout);
  }
  applyResponsiveLayout();
  applyChatFontScale();

  if (imageLightboxClose) {
    imageLightboxClose.addEventListener('click', closeImageLightbox);
  }
  if (imageLightbox) {
    imageLightbox.addEventListener('click', function (event) {
      if (event.target === imageLightbox) {
        closeImageLightbox();
      }
    });
  }
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && imageLightbox && !imageLightbox.classList.contains('hidden')) {
      closeImageLightbox();
    }
  });

  decreaseFontSize.addEventListener('click', function () {
    adjustChatFontScale(-1);
  });
  increaseFontSize.addEventListener('click', function () {
    adjustChatFontScale(1);
  });

  document.addEventListener('focusin', function (event) {
    shouldRestoreComposerFocus = isComposerFocusTarget(event.target);
    if (!shouldRestoreComposerFocus) {
      cancelComposerFocusRestore();
    }
  });

  window.addEventListener('blur', function () {
    shouldRestoreComposerFocus = false;
    cancelComposerFocusRestore();
  });

  function renderSessions(sessions, selectedSessionId, runs, selectedRunId) {
    var count = Array.isArray(sessions) ? sessions.length : 0;
    sessionCountBadge.textContent = String(count);
    sessionList.innerHTML = '';
    var runsBySession = new Map();
    var standaloneRuns = [];
    if (Array.isArray(runs)) {
      for (var runIndex = 0; runIndex < runs.length; runIndex += 1) {
        var run = runs[runIndex];
        if (run && typeof run.chatSessionId === 'string' && run.chatSessionId.length > 0) {
          var existingRuns = runsBySession.get(run.chatSessionId) || [];
          existingRuns.push(run);
          runsBySession.set(run.chatSessionId, existingRuns);
        } else if (run) {
          standaloneRuns.push(run);
        }
      }
    }

    if (!Array.isArray(sessions) || sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No chat sessions yet. Create one to start working.';
      sessionList.appendChild(empty);
      return standaloneRuns;
    }

    for (const session of sessions) {
      const group = document.createElement('div');
      group.className = 'session-group';
      const button = document.createElement('button');
      button.className = 'session-item' + (session.id === selectedSessionId ? ' active' : '');
      button.dataset.sessionId = session.id;

      const title = document.createElement('div');
      title.className = 'session-item-title';
      title.textContent = session.title;

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = session.turnCount + ' turn' + (session.turnCount === 1 ? '' : 's');

      const preview = document.createElement('div');
      preview.className = 'session-item-preview';
      preview.textContent = session.preview;

      const actions = document.createElement('div');
      actions.className = 'session-item-actions';
      const importCtx = createSessionActionButton('Import session context into current chat', [
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '<circle cx="5" cy="8" r="2.5"/>',
        '<circle cx="11" cy="4" r="2.5"/>',
        '<circle cx="11" cy="12" r="2.5"/>',
        '<path d="M7.5 7l1.5-1.5"/>',
        '<path d="M7.5 9l1.5 1.5"/>',
        '</svg>',
      ].join(''));
      importCtx.addEventListener('click', function (event) {
        event.stopPropagation();
        vscode.postMessage({ type: 'importSessionContext', payload: session.id });
      });

      const archive = createSessionActionButton('Archive session', [
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '<path d="M2.5 3.5h11"/>',
        '<path d="M4 5.5h8v6h-8z"/>',
        '<path d="M6 8h4"/>',
        '</svg>',
      ].join(''));
      archive.addEventListener('click', function (event) {
        event.stopPropagation();
        vscode.postMessage({ type: 'archiveSession', payload: session.id });
      });

      const remove = createSessionActionButton('Delete session', [
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '<path d="M3.5 4.5h9"/>',
        '<path d="M6 4.5v-1h4v1"/>',
        '<path d="M5 6v5"/>',
        '<path d="M8 6v5"/>',
        '<path d="M11 6v5"/>',
        '<path d="M4.5 4.5l.5 8h6l.5-8"/>',
        '</svg>',
      ].join(''));
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        vscode.postMessage({ type: 'deleteSession', payload: session.id });
      });
      actions.appendChild(importCtx);
      actions.appendChild(archive);
      actions.appendChild(remove);

      button.appendChild(title);
      button.appendChild(meta);
      button.appendChild(preview);
      button.appendChild(actions);
      button.addEventListener('click', function () {
        vscode.postMessage({ type: 'selectSession', payload: session.id });
      });

      group.appendChild(button);

      var sessionRuns = runsBySession.get(session.id) || [];
      if (sessionRuns.length > 0) {
        var childList = document.createElement('div');
        childList.className = 'session-child-list';
        for (var childIndex = 0; childIndex < sessionRuns.length; childIndex += 1) {
          childList.appendChild(renderRunChildItem(sessionRuns[childIndex], selectedRunId));
        }
        group.appendChild(childList);
      }

      sessionList.appendChild(group);
    }

    return standaloneRuns;
  }

  function createSessionActionButton(label, iconMarkup) {
    var button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = iconMarkup;
    return button;
  }

  function describeRun(run) {
    if (run.awaitingBatchApproval) {
      return 'Awaiting approval';
    }
    if (run.paused) {
      return 'Paused';
    }
    return run.status;
  }

  function describeRunReview(run) {
    if (run.pendingReviewCount > 0) {
      return run.pendingReviewCount + ' pending';
    }
    if (run.dismissedReviewCount > 0 && run.acceptedReviewCount === 0) {
      return 'Dismissed';
    }
    if (run.acceptedReviewCount > 0 && run.dismissedReviewCount === 0) {
      return 'Approved';
    }
    if (run.acceptedReviewCount > 0 || run.dismissedReviewCount > 0) {
      return run.acceptedReviewCount + ' approved • ' + run.dismissedReviewCount + ' dismissed';
    }
    return describeRun(run);
  }

  function renderRunChildItem(run, selectedRunId) {
    var button = document.createElement('button');
    button.className = 'session-child-item' + (run.id === selectedRunId ? ' active' : '');
    button.dataset.runId = run.id;

    var title = document.createElement('div');
    title.className = 'session-child-title';
    title.textContent = run.shortTitle || 'Review autonomous run';

    var meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = describeRunReview(run) + ' • ' + describeRun(run);

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener('click', function () {
      vscode.postMessage({ type: 'openProjectRun', payload: run.id });
    });
    return button;
  }

  function renderRuns(runs, selectedRunId) {
    runList.innerHTML = '';
    var hasRuns = Array.isArray(runs) && runs.length > 0;

    if (runToggle) {
      runToggle.classList.toggle('hidden', !hasRuns);
    }
    if (runListContainer) {
      runListContainer.classList.toggle('hidden', !hasRuns);
    }

    if (!hasRuns) {
      return;
    }

    // Count active (in-progress) runs for the badge.
    var activeCount = runs.filter(function (r) { return r.status === 'running'; }).length;
    if (runCountBadge) {
      runCountBadge.textContent = String(activeCount);
      runCountBadge.classList.toggle('hidden', activeCount === 0);
    }

    applyRunsCollapsedState();

    for (const run of runs) {
      const button = document.createElement('button');
      button.className = 'session-item' + (run.id === selectedRunId ? ' active' : '');
      button.dataset.runId = run.id;

      const title = document.createElement('div');
      title.className = 'session-item-title';
      title.textContent = run.shortTitle || run.goal;

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = describeRunReview(run) + ' \u2022 ' + run.completedSubtaskCount + '/' + run.totalSubtaskCount;

      button.appendChild(title);
      button.appendChild(meta);
      button.addEventListener('click', function () {
        vscode.postMessage({ type: 'openProjectRun', payload: run.id });
      });
      runList.appendChild(button);
    }
  }

  function renderAttachments(attachments) {
    var hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    attachmentsSection.classList.toggle('hidden', !hasAttachments);
    attachmentList.innerHTML = '';
    if (!hasAttachments) {
      return;
    }

    for (const attachment of attachments) {
      const chip = document.createElement('div');
      chip.className = 'chip attachment-chip';

      if (attachment.kind === 'image' && attachment.previewUri) {
        const previewButton = document.createElement('button');
        previewButton.type = 'button';
        previewButton.className = 'attachment-preview-btn';
        previewButton.title = 'Open image preview';
        previewButton.addEventListener('click', function () {
          openImageLightbox(attachment.previewUri, attachment.label);
        });

        const image = document.createElement('img');
        image.className = 'attachment-thumb';
        image.src = attachment.previewUri;
        image.alt = attachment.label || 'Attached image';
        previewButton.appendChild(image);

        const labelStack = document.createElement('span');
        labelStack.className = 'attachment-label-stack';
        const kind = document.createElement('span');
        kind.className = 'attachment-kind-label';
        kind.textContent = 'Image';
        labelStack.appendChild(kind);
        const source = document.createElement('span');
        source.className = 'attachment-source-label';
        source.textContent = attachment.label;
        labelStack.appendChild(source);
        previewButton.appendChild(labelStack);
        chip.appendChild(previewButton);
      } else {
        const label = document.createElement('span');
        label.textContent = attachment.label + ' [' + attachment.kind + ']';
        chip.appendChild(label);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '\u00d7';
      remove.title = 'Remove attachment';
      remove.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ type: 'removeAttachment', payload: attachment.id });
      });
      chip.appendChild(remove);
      attachmentList.appendChild(chip);
    }
  }

  function renderMessageAttachments(entry) {
    if (!entry || !entry.meta || !Array.isArray(entry.meta.promptAttachments) || entry.meta.promptAttachments.length === 0) {
      return null;
    }

    const gallery = document.createElement('div');
    gallery.className = 'message-attachment-gallery';

    entry.meta.promptAttachments.forEach(function (attachment) {
      if (attachment.kind === 'image' && attachment.previewUri) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'message-attachment-card';
        button.title = 'Open attached screenshot';
        button.addEventListener('click', function () {
          openImageLightbox(attachment.previewUri, attachment.label);
        });

        const image = document.createElement('img');
        image.className = 'message-attachment-thumb';
        image.src = attachment.previewUri;
        image.alt = attachment.label || 'Attached image';
        button.appendChild(image);

        const label = document.createElement('span');
        label.className = 'message-attachment-label';
        label.textContent = attachment.label;
        button.appendChild(label);
        gallery.appendChild(button);
        return;
      }

      const pill = document.createElement('div');
      pill.className = 'message-attachment-pill';
      pill.textContent = attachment.label + ' [' + attachment.kind + ']';
      gallery.appendChild(pill);
    });

    return gallery;
  }

  function openImageLightbox(src, label) {
    if (!imageLightbox || !imageLightboxImage) {
      return;
    }

    imageLightboxImage.src = src;
    imageLightboxImage.alt = label || 'Expanded image preview';
    if (imageLightboxCaption) {
      imageLightboxCaption.textContent = label || 'Attached image';
    }
    imageLightbox.classList.remove('hidden');
    imageLightbox.setAttribute('aria-hidden', 'false');
  }

  function closeImageLightbox() {
    if (!imageLightbox || !imageLightboxImage) {
      return;
    }

    imageLightbox.classList.add('hidden');
    imageLightbox.setAttribute('aria-hidden', 'true');
    imageLightboxImage.removeAttribute('src');
  }

  function renderOpenFiles(files) {
    var hasFiles = Array.isArray(files) && files.length > 0;
    openFilesSection.classList.toggle('hidden', !hasFiles);
    openFileLinks.innerHTML = '';
    if (!hasFiles) {
      return;
    }

    for (const file of files) {
      const chip = document.createElement('button');
      chip.className = 'chip open-file-chip' + (file.isActive ? ' active' : '');
      chip.textContent = file.path;
      chip.addEventListener('click', function () {
        vscode.postMessage({ type: 'attachOpenFile', payload: file.path });
      });
      openFileLinks.appendChild(chip);
    }
  }

  function collectDroppedItems(event, options) {
    var values = new Set();
    var uriList = event.dataTransfer.getData('text/uri-list');
    if (uriList) {
      var lines = uriList.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (trimmed && !trimmed.startsWith('#')) {
          values.add(trimmed);
        }
      }
    }
    var plainText = event.dataTransfer.getData('text/plain');
    if ((options && options.includePlainText) !== false && plainText) {
      var ptLines = plainText.split(/\r?\n/);
      for (var j = 0; j < ptLines.length; j++) {
        var ptTrimmed = ptLines[j].trim();
        if (ptTrimmed && (looksLikeUrl(ptTrimmed) || looksLikePathLikeValue(ptTrimmed))) {
          values.add(ptTrimmed);
        }
      }
    }
    var fileList = event.dataTransfer.files || [];
    for (var k = 0; k < fileList.length; k++) {
      var file = fileList[k];
      if (file && typeof file.path === 'string' && file.path.length > 0) {
        values.add(file.path);
      } else if (file && typeof file.name === 'string' && file.name.length > 0) {
        values.add(file.name);
      }
    }
    return Array.from(values);
  }

  async function collectImportedItemsFromTransfer(dataTransfer, options) {
    var imports = [];
    if (!dataTransfer) {
      return imports;
    }

    var files = Array.from(dataTransfer.files || []);
    for (var index = 0; index < files.length; index += 1) {
      var serializedFile = await serializeTransferFile(files[index]);
      if (serializedFile) {
        imports.push(serializedFile);
      }
    }

    var rawDroppedItems = collectDroppedItems({ dataTransfer: dataTransfer }, options);
    for (var itemIndex = 0; itemIndex < rawDroppedItems.length; itemIndex += 1) {
      var item = rawDroppedItems[itemIndex];
      if (!item) {
        continue;
      }
      if (looksLikeUrl(item)) {
        imports.push({ transport: 'url', value: item });
        continue;
      }
      imports.push({ transport: 'workspace-path', value: item });
    }

    return dedupeImportedItems(imports);
  }

  function dedupeImportedItems(items) {
    var seen = new Set();
    var unique = [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var key = JSON.stringify(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  function serializeTransferFile(file) {
    return new Promise(function (resolve) {
      if (!file) {
        resolve(undefined);
        return;
      }

      var reader = new FileReader();
      reader.onerror = function () {
        resolve(undefined);
      };
      reader.onload = function () {
        var result = typeof reader.result === 'string' ? reader.result : '';
        var match = /^data:([^;,]+)?(?:;base64)?,([\s\S]+)$/.exec(result);
        if (!match) {
          resolve(undefined);
          return;
        }
        resolve({
          transport: 'inline-file',
          name: file.name || inferImportedFileName(file.type),
          mimeType: file.type || undefined,
          dataBase64: match[2],
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function inferImportedFileName(mimeType) {
    if (/^image\//i.test(mimeType || '')) {
      return 'pasted-image.png';
    }
    if (/^audio\//i.test(mimeType || '')) {
      return 'pasted-audio.bin';
    }
    if (/^video\//i.test(mimeType || '')) {
      return 'pasted-video.bin';
    }
    return 'pasted-file.bin';
  }

  function looksLikeUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function looksLikePathLikeValue(value) {
    var trimmed = String(value || '').trim();
    if (!trimmed || /[\r\n]/.test(trimmed)) {
      return false;
    }
    return /^(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|[^\s]+[\\/][^\s]+|[^\s]+\.[A-Za-z0-9]{1,12})$/.test(trimmed);
  }

  function setDropState(enabled) {
    dropHint.classList.toggle('dragover', enabled);
    composerShell.classList.toggle('dragover', enabled);
  }

  function setComposerAvailability(options) {
    options = options || {};
    var disablePrompt = Boolean(options.disablePrompt);
    var disableSend = Boolean(options.disableSend);
    var disableMode = Boolean(options.disableMode);
    var disableAttachments = Boolean(options.disableAttachments);
    var showStop = Boolean(options.showStop);
    promptInput.disabled = disablePrompt;
    sendPrompt.disabled = disableSend;
    sendMode.disabled = disableMode;
    attachFiles.disabled = disableAttachments;
    attachOpenFiles.disabled = disableAttachments;
    clearAttachments.disabled = disableAttachments;
    stopPrompt.disabled = !showStop;
    stopPrompt.classList.toggle('hidden', !showStop);
  }

  function getStatusDrivenComposerMode() {
    return isBusy ? 'steer' : 'send';
  }

  function isOneShotComposerMode(mode) {
    return mode === 'new-chat' || mode === 'new-session';
  }

  function applyComposerModePreference(requestedMode, options) {
    options = options || {};
    var nextMode = typeof requestedMode === 'string' && requestedMode.length > 0
      ? requestedMode
      : getStatusDrivenComposerMode();

    if (isOneShotComposerMode(nextMode)) {
      // Always queue the one-shot intent, even if we're currently busy.
      // The submit path guards against submitting a one-shot while busy by
      // overriding the effective mode to 'steer', and it preserves the queued
      // mode so the intent is honoured on the next idle submission.
      queuedComposerMode = nextMode;
      nextMode = getStatusDrivenComposerMode();
    } else {
      if (options.clearQueuedMode !== false) {
        queuedComposerMode = undefined;
      }
      if (isBusy) {
        nextMode = 'steer';
      } else if (nextMode !== 'steer') {
        nextMode = 'send';
      }
    }

    // If a one-shot is still queued and we're idle, keep the select showing it
    if (!isBusy && queuedComposerMode && isOneShotComposerMode(queuedComposerMode)) {
      if (sendMode.value !== queuedComposerMode) {
        sendMode.value = queuedComposerMode;
      }
      return;
    }

    if (sendMode.value !== nextMode) {
      sendMode.value = nextMode;
    }
  }

  function updateComposerAvailability() {
    var isRun = Boolean(latestState && latestState.activeSurface === 'run');
    var isSteerMode = sendMode.value === 'steer';
    setComposerAvailability({
      disablePrompt: isRun,
      disableSend: isRun || (isBusy && !isSteerMode),
      disableMode: isRun,
      disableAttachments: isRun || isBusy,
      showStop: !isRun && isBusy,
    });
  }

  function canSubmitPromptWithMode(mode) {
    if (latestState && latestState.activeSurface === 'run') {
      return false;
    }
    if (mode === 'steer') {
      return !promptInput.disabled;
    }
    return !sendPrompt.disabled;
  }

  function cancelComposerFocusRestore() {
    if (composerFocusRestoreHandle !== null) {
      clearTimeout(composerFocusRestoreHandle);
      composerFocusRestoreHandle = null;
    }
  }

  function isComposerFocusTarget(element) {
    return Boolean(
      element
      && composerShell
      && element instanceof Element
      && composerShell.contains(element)
    );
  }

  function submitPrompt(modeOverride) {
    if (isSearchMode) {
      // In search mode, do not send chat prompt
      if (searchBtn) searchBtn.click();
      return;
    }
    var effectiveMode = typeof modeOverride === 'string'
      ? modeOverride
      : (queuedComposerMode || sendMode.value || getStatusDrivenComposerMode());
    var overriddenToSteer = false;
    if (isBusy && effectiveMode !== 'steer') {
      effectiveMode = 'steer';
      overriddenToSteer = true;
    }
    if (!canSubmitPromptWithMode(effectiveMode)) {
      return;
    }
    var prompt = promptInput.value;
    requestTranscriptAutoScroll();
    vscode.postMessage({ type: 'submitPrompt', payload: { prompt: prompt, mode: effectiveMode } });
    recordPromptHistory(prompt);
    promptInput.value = '';
    // Preserve a queued one-shot mode (e.g. 'new-session') when this submission
    // was forced to 'steer' due to a busy state — the user's intent should apply
    // to their next idle message, not be silently discarded.
    if (!overriddenToSteer) {
      queuedComposerMode = undefined;
    }
    applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: true });
    updateComposerAvailability();
    resetPromptHistoryNavigation('');
    focusPromptInputAtEnd();
  }

  function focusPromptInputAtEnd(options) {
    var force = Boolean(options && options.force);
    if (!promptInput || promptInput.disabled) {
      return;
    }
    if (latestState && latestState.activeSurface === 'run') {
      return;
    }
    // Only restore focus if this webview is focused
    if (!force) {
      if (!document.hasFocus()) {
        return;
      }
      // If the active element is not in this webview, do not steal focus
      var activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && !isComposerFocusTarget(activeElement)) {
        return;
      }
      if (!shouldRestoreComposerFocus && activeElement && activeElement !== document.body) {
        return;
      }
    }
    // Defensive: double-check this webview is focused before restoring
    if (!document.hasFocus()) {
      return;
    }
    shouldRestoreComposerFocus = true;
    promptInput.focus();
    if (typeof promptInput.setSelectionRange === 'function') {
      var cursor = promptInput.value.length;
      promptInput.setSelectionRange(cursor, cursor);
    }
  }

  function scheduleComposerFocusRestore(options) {
    var force = Boolean(options && options.force);
    if (!promptInput || promptInput.disabled) {
      return;
    }
    if (latestState && latestState.activeSurface === 'run') {
      return;
    }
    // Only restore focus if this webview is focused
    if (!force) {
      if (!document.hasFocus()) {
        return;
      }
      var activeElement = document.activeElement;
      if (activeElement && activeElement !== document.body && !isComposerFocusTarget(activeElement)) {
        return;
      }
      if (!shouldRestoreComposerFocus && activeElement && activeElement !== document.body) {
        return;
      }
    }
    // Defensive: double-check this webview is focused before restoring
    if (!document.hasFocus()) {
      return;
    }
    cancelComposerFocusRestore();
    composerFocusRestoreHandle = window.setTimeout(function () {
      composerFocusRestoreHandle = null;
      focusPromptInputAtEnd({ force: force });
    }, 0);
  }

  function renderComposerHintContent(title, items) {
    composerHint.innerHTML = '';

    var heading = document.createElement('div');
    heading.className = 'composer-hint-title';
    heading.textContent = title;
    composerHint.appendChild(heading);

    var list = document.createElement('ul');
    list.className = 'composer-hint-list';
    for (var index = 0; index < items.length; index += 1) {
      var item = document.createElement('li');
      item.textContent = items[index];
      list.appendChild(item);
    }
    composerHint.appendChild(list);
  }

  function extractLatestUserPrompt(state) {
    if (!state || !Array.isArray(state.transcript)) {
      return '';
    }
    for (var index = state.transcript.length - 1; index >= 0; index -= 1) {
      var entry = state.transcript[index];
      if (entry && entry.role === 'user' && typeof entry.content === 'string' && entry.content.trim().length > 0) {
        return entry.content.trim();
      }
    }
    return '';
  }

  function extractLatestAssistantEntry(state) {
    if (!state || !Array.isArray(state.transcript)) {
      return undefined;
    }
    for (var index = state.transcript.length - 1; index >= 0; index -= 1) {
      var entry = state.transcript[index];
      if (entry && entry.role === 'assistant') {
        return entry;
      }
    }
    return undefined;
  }

  function truncateHintText(value, maxLength) {
    if (typeof value !== 'string') {
      return '';
    }
    var normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '\u2026';
  }

  function buildContextAwareHintItems(state, kind) {
    var items = [];
    if (!state || kind === 'run') {
      return items;
    }

    var latestUserPrompt = extractLatestUserPrompt(state).toLowerCase();
    var latestAssistantEntry = extractLatestAssistantEntry(state);
    var currentMode = typeof sendMode.value === 'string' && sendMode.value.length > 0 ? sendMode.value : (state.composerMode || 'send');
    var attachments = Array.isArray(state.attachments) ? state.attachments : [];
    var approvals = Array.isArray(state.pendingToolApprovals) ? state.pendingToolApprovals : [];
    var runs = state.pendingRunReview && Array.isArray(state.pendingRunReview.runs)
      ? state.pendingRunReview.runs
      : [];

    if (state.recoveryNotice && typeof state.recoveryNotice.summary === 'string' && state.recoveryNotice.summary.trim().length > 0) {
      items.push('Direct recovery mode is active for this turn, so AtlasMind should skip redundant clarification and move to the next concrete safe corrective action.');
    }

    if (currentMode === 'steer' && kind !== 'busy') {
      items.push('Steer mode is selected, so Enter will redirect the current line of work instead of starting from scratch.');
    }

    if (attachments.length > 0) {
      items.push('You already attached ' + attachments.length + ' file' + (attachments.length === 1 ? '' : 's') + ', so AtlasMind can use that context without you re-pasting it.');
    }

    if (approvals.length > 0) {
      items.push('A tool approval is waiting below the transcript. Approve or deny it there before asking AtlasMind why execution is paused.');
    }

    if (state.pendingRunReview && state.pendingRunReview.totalPendingFiles > 0) {
      items.push('An autonomous review is waiting for ' + state.pendingRunReview.totalPendingFiles + ' changed file' + (state.pendingRunReview.totalPendingFiles === 1 ? '' : 's') + '. Open the run review before asking for another execution pass.');
    }

    if (latestAssistantEntry && latestAssistantEntry.meta && Array.isArray(latestAssistantEntry.meta.quickReplies) && latestAssistantEntry.meta.quickReplies.length > 0) {
      items.push('Quick-reply buttons are shown below the last reply — click one to respond in a single tap, or type a custom reply here.');
    } else if (latestAssistantEntry && latestAssistantEntry.meta && Array.isArray(latestAssistantEntry.meta.suggestedFollowups) && latestAssistantEntry.meta.suggestedFollowups.length > 0) {
      items.push('AtlasMind already exposed follow-up controls on the latest assistant reply. Pick an option and press Proceed for a faster next step than typing from scratch.');
    } else if (latestAssistantEntry && latestAssistantEntry.meta && typeof latestAssistantEntry.meta.followupQuestion === 'string' && latestAssistantEntry.meta.followupQuestion.trim().length > 0) {
      items.push('The last reply ended with a next-step question: ' + truncateHintText(latestAssistantEntry.meta.followupQuestion, 96));
    }

    if (/(fix|debug|error|failing|broken|issue|bug|regression|test)/.test(latestUserPrompt)) {
      items.push('This looks like a fix or debugging thread, so attaching the failing file, error text, or test name usually gets a more direct edit.');
    }

    if (/(refactor|cleanup|restructure|rename|organize)/.test(latestUserPrompt)) {
      items.push('This looks like a refactor request. If scope matters, say which files or boundaries should stay unchanged before sending.');
    }

    if (/(document|docs|readme|changelog|wiki)/.test(latestUserPrompt)) {
      items.push('This looks documentation-heavy, so calling out the target audience or exact doc surface can keep AtlasMind from updating too broadly.');
    }

    if (/(plan|design|architect|approach|brainstorm|idea)/.test(latestUserPrompt)) {
      items.push('This reads like planning work. Switching to New Chat can help keep design exploration separate from implementation follow-through.');
    }

    if (/(image|screenshot|diagram|ui|layout|icon|visual|tooltip|panel)/.test(latestUserPrompt) && attachments.length === 0) {
      items.push('If the request is visual, attach a screenshot or the affected file so AtlasMind can respond with tighter UI-specific changes.');
    }

    if (/(terminal|powershell|bash|cmd|shell|script|command)/.test(latestUserPrompt)) {
      items.push('If you want AtlasMind to run a shell command, the @t terminal aliases in the composer can launch it as a managed terminal action.');
    }

    if (kind === 'busy' && latestUserPrompt.length > 0) {
      items.push('If the current answer is drifting, press Ctrl/Cmd+Enter with a tighter instruction to steer the active response instead of waiting for it to finish.');
    }

    return items.slice(0, 4);
  }

  function setComposerHintContent(kind) {
    var items;
    if (kind === 'run') {
      renderComposerHintContent('Run inspector', [
        'Switch back to a chat thread to send another prompt.',
        'Open the Project Run Center to pause, approve, or resume autonomous batches.',
      ]);
      return;
    }

    if (kind === 'busy') {
      items = [
        'Switch send mode to Steer to interrupt and redirect the current request.',
        'Use Stop to cancel the active response.',
        'Up and Down recall recent prompts when the caret is already at the start or end of the composer.',
      ].concat(buildContextAwareHintItems(latestState, kind));
      renderComposerHintContent('While AtlasMind is responding', items);
      return;
    }

    items = [
      'Enter uses the selected send mode.',
      'Shift+Enter starts a new chat thread.',
      'Ctrl/Cmd+Enter sends as Steer.',
      'Alt+Enter inserts a newline.',
      'Up and Down recall recent prompts when the caret is already at the start or end of the composer.',
      'Use aliases like @tps, @tpowershell, @tpwsh, @tgit, @tbash, or @tcmd to launch a managed terminal run.',
    ].concat(buildContextAwareHintItems(latestState, kind));
    renderComposerHintContent('Composer shortcuts', items);
  }

  function renderRecoveryNotice(notice) {
    if (!recoveryNotice || !recoveryNoticeTitle || !recoveryNoticeSummary) {
      return;
    }

    var hasNotice = Boolean(notice && typeof notice.summary === 'string' && notice.summary.trim().length > 0);
    recoveryNotice.classList.toggle('hidden', !hasNotice);
    if (!hasNotice) {
      recoveryNotice.removeAttribute('data-tone');
      recoveryNoticeSummary.textContent = '';
      return;
    }

    recoveryNotice.setAttribute('data-tone', notice.tone === 'recent' ? 'recent' : 'active');
    recoveryNoticeTitle.textContent = typeof notice.title === 'string' && notice.title.trim().length > 0
      ? notice.title
      : 'Direct recovery mode';
    recoveryNoticeSummary.textContent = notice.summary;
  }

  function insertComposerTextAtSelection(text) {
    if (promptInput.disabled) {
      return;
    }

    if (typeof promptInput.setRangeText === 'function'
      && typeof promptInput.selectionStart === 'number'
      && typeof promptInput.selectionEnd === 'number') {
      var nextStart = promptInput.selectionStart + text.length;
      promptInput.setRangeText(text, promptInput.selectionStart, promptInput.selectionEnd, 'end');
      promptInput.focus();
      if (typeof promptInput.setSelectionRange === 'function') {
        promptInput.setSelectionRange(nextStart, nextStart);
      }
      promptInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    promptInput.value = (promptInput.value || '') + text;
    promptInput.focus();
    promptInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function recordPromptHistory(prompt) {
    var normalized = typeof prompt === 'string' ? prompt.trim() : '';
    if (!normalized) {
      return;
    }
    if (promptHistory[promptHistory.length - 1] !== normalized) {
      promptHistory.push(normalized);
      if (promptHistory.length > PROMPT_HISTORY_LIMIT) {
        promptHistory = promptHistory.slice(-PROMPT_HISTORY_LIMIT);
      }
    }
    resetPromptHistoryNavigation('');
    persistUiState();
  }

  function resetPromptHistoryNavigation(nextDraft) {
    promptHistoryIndex = null;
    promptHistoryDraft = typeof nextDraft === 'string' ? nextDraft : promptInput.value;
  }

  function setPromptValueFromHistory(value) {
    suppressPromptHistoryReset = true;
    promptInput.value = value;
    focusPromptInputAtEnd();
    suppressPromptHistoryReset = false;
  }

  function canNavigatePromptHistory(direction) {
    if (!promptInput || promptInput.disabled) {
      return false;
    }
    if (typeof promptInput.selectionStart !== 'number' || typeof promptInput.selectionEnd !== 'number') {
      return false;
    }
    if (promptInput.selectionStart !== promptInput.selectionEnd) {
      return false;
    }

    var value = promptInput.value || '';
    var cursor = promptInput.selectionStart;
    if (direction < 0) {
      return value.slice(0, cursor).indexOf('\n') === -1;
    }
    return value.slice(cursor).indexOf('\n') === -1;
  }

  function navigatePromptHistory(direction) {
    if (!Array.isArray(promptHistory) || promptHistory.length === 0) {
      return false;
    }
    if (direction > 0 && promptHistoryIndex === null) {
      return false;
    }

    if (promptHistoryIndex === null) {
      promptHistoryDraft = promptInput.value;
      promptHistoryIndex = promptHistory.length;
    }

    var nextIndex = promptHistoryIndex + direction;
    if (nextIndex < 0) {
      nextIndex = 0;
    }

    if (nextIndex >= promptHistory.length) {
      resetPromptHistoryNavigation(promptHistoryDraft);
      setPromptValueFromHistory(promptHistoryDraft);
      return true;
    }

    promptHistoryIndex = nextIndex;
    setPromptValueFromHistory(promptHistory[promptHistoryIndex]);
    return true;
  }

  function renderPendingApprovals(requests) {
    pendingApprovals.innerHTML = '';
    var hasRequests = Array.isArray(requests) && requests.length > 0;
    pendingApprovals.classList.toggle('hidden', !hasRequests);
    if (!hasRequests) {
      return;
    }

    for (var i = 0; i < requests.length; i += 1) {
      var request = requests[i];
      var card = document.createElement('div');
      card.className = 'approval-card';

      var header = document.createElement('div');
      header.className = 'approval-card-header';

      var heading = document.createElement('div');
      heading.className = 'approval-card-heading';

      var icon = document.createElement('div');
      icon.className = 'approval-alert-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = [
        '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">',
        '<path d="M8 2.25 13.5 12.5H2.5L8 2.25Z"/>',
        '<path d="M8 6v3.1"/>',
        '<path d="M8 11.35h.01"/>',
        '</svg>',
      ].join('');
      heading.appendChild(icon);

      var title = document.createElement('div');
      title.className = 'approval-card-title';
      title.textContent = request.title || 'Tool approval required';
      heading.appendChild(title);
      header.appendChild(heading);

      var badge = document.createElement('div');
      badge.className = 'approval-risk-badge ' + (request.risk || 'low');
      badge.textContent = String(request.risk || 'low').toUpperCase() + ' RISK';
      header.appendChild(badge);
      card.appendChild(header);

      var toolName = document.createElement('div');
      toolName.className = 'approval-tool-name';
      toolName.textContent = request.toolName;
      card.appendChild(toolName);

      var summary = document.createElement('div');
      summary.className = 'approval-summary';
      summary.textContent = request.summary;
      card.appendChild(summary);

      if (request.detail) {
        var detail = document.createElement('div');
        detail.className = 'approval-detail';
        detail.textContent = request.detail;
        card.appendChild(detail);
      }

      var meta = document.createElement('div');
      meta.className = 'approval-meta';
      meta.textContent = 'Category: ' + request.category + ' • Task: ' + request.taskId;
      card.appendChild(meta);

      var allowedDecisions = Array.isArray(request.allowedDecisions) && request.allowedDecisions.length > 0
        ? request.allowedDecisions
        : ['allow-once', 'bypass-task', 'autopilot', 'deny'];
      var decisionLabels = request.decisionLabels || {};
      var actions = document.createElement('div');
      actions.className = 'approval-actions';
      for (var decisionIndex = 0; decisionIndex < allowedDecisions.length; decisionIndex += 1) {
        var decision = allowedDecisions[decisionIndex];
        var label = decisionLabels[decision]
          || (decision === 'allow-once' ? 'Allow Once'
            : decision === 'bypass-task' ? 'Bypass Approvals'
              : decision === 'autopilot' ? 'Autopilot'
                : 'Deny');
        actions.appendChild(createApprovalButton(label, request.id, decision, decision === 'deny' ? 'danger' : undefined));
      }
      card.appendChild(actions);

      pendingApprovals.appendChild(card);
    }
  }

  function createApprovalButton(label, requestId, decision, extraClass) {
    var button = document.createElement('button');
    button.type = 'button';
    if (extraClass) {
      button.classList.add(extraClass);
    }
    button.textContent = label;
    button.addEventListener('click', function () {
      vscode.postMessage({
        type: 'resolveToolApproval',
        payload: { requestId: requestId, decision: decision },
      });
      scheduleComposerFocusRestore({ force: true });
    });
    return button;
  }

  function renderStreamingThought(lines) {
    if (!lines || !lines.trim()) {
      return null;
    }
    var lineArray = lines.split('\n').filter(function (l) { return l.trim().length > 0; });
    var normalizedLines = lineArray.map(function (line) {
      var toolData = parseToolExecutionMessage(line);
      if (toolData && typeof toolData.humanReadable === 'string' && toolData.humanReadable.trim()) {
        return toolData.humanReadable.trim();
      }
      return line;
    });
    if (lineArray.length === 0) {
      return null;
    }
    var container = document.createElement('div');
    container.className = 'streaming-thought-details thought-details';

    var latest = document.createElement('div');
    latest.className = 'streaming-thought-latest';
    latest.textContent = normalizedLines[normalizedLines.length - 1];
    container.appendChild(latest);

    if (normalizedLines.length > 1) {
      var details = document.createElement('details');
      details.className = 'streaming-thought-history transcript-disclosure';

      var summary = createDisclosureSummary('Working', (normalizedLines.length - 1) + ' step' + ((normalizedLines.length - 1) === 1 ? '' : 's') + ' taken');
      details.appendChild(summary);

      var body = document.createElement('div');
      body.className = 'transcript-disclosure-body';
      var list = document.createElement('ul');
      list.className = 'streaming-thought-list thought-list';
      for (var i = 0; i < normalizedLines.length; i += 1) {
        var li = document.createElement('li');
        li.textContent = normalizedLines[i];
        list.appendChild(li);
      }
      body.appendChild(list);
      details.appendChild(body);
      container.appendChild(details);
    }

    return container;
  }

  function buildEmptyAssistantFallback(entry) {
    if (!entry || entry.role !== 'assistant') {
      return '';
    }
    var meta = entry.meta || {};
    var followupQuestion = typeof meta.followupQuestion === 'string' ? meta.followupQuestion.trim() : '';
    if (meta.iterationLimitHit) {
      var hasRaiseSuggestion = typeof meta.suggestedIterationLimit === 'number' || typeof meta.suggestedToolCallsPerTurnLimit === 'number';
      var limitMsg = hasRaiseSuggestion
        ? 'Atlas paused after reaching the execution limit. Choose a raised limit to continue automatically, or select Continue to keep the current limit.'
        : 'Atlas paused after reaching the current execution limit. Select Continue or say "Proceed" to keep going.';
      return (followupQuestion ? followupQuestion + '\n\n' : '') + limitMsg;
    }
    if (followupQuestion) {
      return followupQuestion + '\n\nSay "Proceed" to continue, or pick a follow-up option below.';
    }
    if (meta.thoughtSummary && typeof meta.thoughtSummary.summary === 'string' && meta.thoughtSummary.summary.trim()) {
      return meta.thoughtSummary.summary.trim() + '\n\nSay "Proceed" to continue, or tell Atlas what to do next.';
    }
    return 'Atlas is ready to continue. Say "Proceed" to keep going, or tell Atlas what to do next.';
  }

  function captureDisclosureState() {
    var openDetails = new Set();
    var openModelDropdowns = new Set();
    var detEls = transcript.querySelectorAll('details[open]');
    for (var i = 0; i < detEls.length; i++) {
      var det = detEls[i];
      var entryEl = det.closest('[data-entry-id]');
      if (!entryEl) { continue; }
      var cls = Array.prototype.slice.call(det.classList).find(function (c) { return c !== 'transcript-disclosure'; }) || 'details';
      openDetails.add(entryEl.getAttribute('data-entry-id') + ':' + cls);
    }
    var openLists = transcript.querySelectorAll('.model-badge-list.open');
    for (var j = 0; j < openLists.length; j++) {
      var listEntryEl = openLists[j].closest('[data-entry-id]');
      if (listEntryEl) { openModelDropdowns.add(listEntryEl.getAttribute('data-entry-id')); }
    }
    return { openDetails: openDetails, openModelDropdowns: openModelDropdowns };
  }

  function restoreDisclosureState(saved) {
    if (saved.openDetails.size === 0 && saved.openModelDropdowns.size === 0) { return; }
    var detEls = transcript.querySelectorAll('details');
    for (var i = 0; i < detEls.length; i++) {
      var det = detEls[i];
      var entryEl = det.closest('[data-entry-id]');
      if (!entryEl) { continue; }
      var cls = Array.prototype.slice.call(det.classList).find(function (c) { return c !== 'transcript-disclosure'; }) || 'details';
      if (saved.openDetails.has(entryEl.getAttribute('data-entry-id') + ':' + cls)) {
        det.setAttribute('open', '');
      }
    }
    if (saved.openModelDropdowns.size > 0) {
      var lists = transcript.querySelectorAll('.model-badge-list');
      for (var j = 0; j < lists.length; j++) {
        var listEntryEl = lists[j].closest('[data-entry-id]');
        if (listEntryEl && saved.openModelDropdowns.has(listEntryEl.getAttribute('data-entry-id'))) {
          lists[j].classList.add('open');
        }
      }
    }
  }

  function renderTranscript(entries, busy, selectedMessageId, runs, selectedRun, busyAssistantMessageId, streamingThought, streamingModels) {
    var savedDisclosure = captureDisclosureState();
    transcript.innerHTML = '';
    if (!Array.isArray(entries) || entries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No messages yet. Start a conversation with AtlasMind from this panel.';
      transcript.appendChild(empty);
      return;
    }

    var lastAssistantIndex = -1;
    for (var index = entries.length - 1; index >= 0; index -= 1) {
      if (entries[index] && entries[index].role === 'assistant') {
        lastAssistantIndex = index;
        break;
      }
    }

    var runsByMessageId = new Map();
    if (Array.isArray(runs)) {
      for (var runIndex = 0; runIndex < runs.length; runIndex += 1) {
        var run = runs[runIndex];
        if (!run || typeof run.chatMessageId !== 'string' || run.chatMessageId.length === 0) {
          continue;
        }
        if (run.chatSessionId && latestState && run.chatSessionId !== latestState.selectedSessionId) {
          continue;
        }
        var linkedRuns = runsByMessageId.get(run.chatMessageId) || [];
        linkedRuns.push(run);
        runsByMessageId.set(run.chatMessageId, linkedRuns);
      }
    }

    var sessionModels = [];
    var sessionModelsSeen = new Set();
    for (var smi = 0; smi < entries.length; smi += 1) {
      var sme = entries[smi];
      if (sme && sme.role === 'assistant' && sme.meta && typeof sme.meta.modelUsed === 'string'
          && sme.meta.modelUsed !== 'multiple routed models' && sme.meta.modelUsed.length > 0
          && !sessionModelsSeen.has(sme.meta.modelUsed)) {
        sessionModelsSeen.add(sme.meta.modelUsed);
        sessionModels.push(sme.meta.modelUsed);
      }
    }

    entries.forEach(function (entry, index) {
      var item = document.createElement('div');
      item.className = 'chat-message ' + (entry.role === 'user' ? 'user' : 'assistant');
      if (entry.id) {
        item.setAttribute('data-entry-id', entry.id);
      }
      if (selectedMessageId && entry.id === selectedMessageId) {
        item.classList.add('selected-message');
      }
      var showThinking = busy && entry.role === 'assistant' && (busyAssistantMessageId ? entry.id === busyAssistantMessageId : index === lastAssistantIndex);
      if (showThinking) {
        item.classList.add('pending');
      }

      var header = document.createElement('div');
      header.className = 'chat-message-header';

      var role = document.createElement('div');
      role.className = 'chat-role';
      role.textContent = entry.role === 'user' ? 'You' : 'AtlasMind';
      header.appendChild(role);

      if (entry.role === 'assistant') {
        var isLiveEntry = showThinking && Array.isArray(streamingModels) && streamingModels.length > 0;
        var badgeModelList = null;
        var badgeCurrentModel = null;
        var badgePriorCount = 0;

        if (isLiveEntry) {
          badgeModelList = streamingModels;
          badgeCurrentModel = streamingModels[streamingModels.length - 1];
          badgePriorCount = streamingModels.length - 1;
        } else if (entry.meta && entry.meta.modelUsed) {
          if (Array.isArray(entry.meta.modelsUsed) && entry.meta.modelsUsed.length > 1) {
            badgeModelList = entry.meta.modelsUsed;
            badgeCurrentModel = entry.meta.modelUsed;
            badgePriorCount = entry.meta.modelsUsed.length - 1;
          } else if (entry.meta.modelUsed === 'multiple routed models' && sessionModels.length > 0) {
            badgeModelList = sessionModels;
            badgeCurrentModel = sessionModels[sessionModels.length - 1];
            badgePriorCount = sessionModels.length - 1;
          } else {
            badgeCurrentModel = entry.meta.modelUsed;
          }
        }

        if (badgeCurrentModel) {
          var badgeWrap = document.createElement('div');
          badgeWrap.className = 'model-badge-dropdown';

          var badge = document.createElement('div');
          var hasMultiple = badgePriorCount > 0;
          badge.className = 'chat-model-badge' + (hasMultiple ? ' expandable' : '');

          var nameSpan = document.createElement('span');
          nameSpan.textContent = badgeCurrentModel;
          badge.appendChild(nameSpan);

          if (isLiveEntry) {
            var liveDot = document.createElement('span');
            liveDot.className = 'live-dot';
            badge.appendChild(liveDot);
          }

          if (hasMultiple) {
            var countSpan = document.createElement('span');
            countSpan.className = 'model-badge-count';
            countSpan.textContent = '(+' + badgePriorCount + ')';
            badge.appendChild(countSpan);
          }

          badgeWrap.appendChild(badge);

          if (hasMultiple && badgeModelList) {
            var list = document.createElement('div');
            list.className = 'model-badge-list';
            var listLabel = document.createElement('div');
            listLabel.className = 'model-badge-list-label';
            listLabel.textContent = isLiveEntry ? 'Models used so far' : 'Models used in this reply';
            list.appendChild(listLabel);
            for (var mi = 0; mi < badgeModelList.length; mi++) {
              var listItem = document.createElement('div');
              listItem.className = 'model-badge-list-item' + (badgeModelList[mi] === badgeCurrentModel ? ' current' : '');
              listItem.textContent = badgeModelList[mi];
              list.appendChild(listItem);
            }
            badgeWrap.appendChild(list);

            badge.addEventListener('click', function (e) {
              e.stopPropagation();
              list.classList.toggle('open');
            });
            document.addEventListener('click', function closeList() {
              list.classList.remove('open');
              document.removeEventListener('click', closeList);
            });
          }

          header.appendChild(badgeWrap);
        }
      }

      var content = document.createElement('div');
      content.className = 'chat-content';
      renderMarkdownContent(content, entry.content || (showThinking ? '' : (entry.role === 'assistant' ? buildEmptyAssistantFallback(entry) : '')));

      item.appendChild(header);
      if (content.childNodes.length > 0) {
        item.appendChild(content);
      }

      var messageAttachments = renderMessageAttachments(entry);
      if (messageAttachments) {
        item.appendChild(messageAttachments);
      }

      if (entry.role === 'user' && entry.id) {
        item.appendChild(renderMessageDeleteRow(entry.id));
      }

      var linkedRuns = entry.id ? (runsByMessageId.get(entry.id) || []) : [];
      if (entry.role === 'assistant' && (entry.id || (entry.meta && entry.meta.thoughtSummary))) {
        item.appendChild(renderAssistantFooter(entry, linkedRuns, selectedRun));
      }

      if (entry.role === 'assistant' && selectedRun && entry.id && selectedRun.chatMessageId === entry.id) {
        item.appendChild(renderRunReviewBubble(selectedRun));
      }

      if (showThinking && streamingThought) {
        var thoughtBlock = renderStreamingThought(streamingThought);
        if (thoughtBlock) {
          item.appendChild(thoughtBlock);
        }
      }

      if (showThinking) {
        item.appendChild(renderThinkingIndicator(Boolean(entry.content)));
      }

      transcript.appendChild(item);
    });

    restoreDisclosureState(savedDisclosure);

    if (selectedMessageId) {
      var selected = transcript.querySelector('[data-entry-id="' + cssEscape(selectedMessageId) + '"]');
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    maybeScrollTranscriptToBottom();
  }

  function renderAssistantFooter(entry, linkedRuns, selectedRun) {
    var footer = document.createElement('div');
    footer.className = 'assistant-footer';

    var metaStack = document.createElement('div');
    metaStack.className = 'assistant-meta-stack';
    var hasMeta = false;

    if (entry.meta && entry.meta.thoughtSummary) {
      var thoughtSummary = renderThoughtSummary(entry.meta.thoughtSummary);
      thoughtSummary.classList.add('assistant-footer-thought');
      metaStack.appendChild(thoughtSummary);
      hasMeta = true;
    }

    if (entry.meta && Array.isArray(entry.meta.timelineNotes) && entry.meta.timelineNotes.length > 0) {
      metaStack.appendChild(renderTimelineNotes(entry.meta.timelineNotes));
      hasMeta = true;
    }

    if (hasMeta) {
      footer.appendChild(metaStack);
    }

    var utilityRow = document.createElement('div');
    utilityRow.className = 'assistant-utility-row';
    var hasUtility = false;

    if (entry.id) {
      utilityRow.appendChild(renderAssistantActions(entry));
      hasUtility = true;
    }

    if (Array.isArray(linkedRuns) && linkedRuns.length > 0) {
      utilityRow.appendChild(renderRunReviewLinks(linkedRuns, selectedRun));
      hasUtility = true;
    }

    if (hasUtility) {
      footer.appendChild(utilityRow);
    }

    return footer;
  }

  function renderRunReviewLinks(linkedRuns, selectedRun) {
    var wrapper = document.createElement('div');
    wrapper.className = 'run-review-link-row';
    for (var index = 0; index < linkedRuns.length; index += 1) {
      var run = linkedRuns[index];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'run-review-link' + (selectedRun && selectedRun.id === run.id ? ' active' : '');
      button.textContent = selectedRun && selectedRun.id === run.id
        ? 'Autonomous review open'
        : (run.pendingReviewCount > 0
          ? 'Open autonomous review (' + run.pendingReviewCount + ' pending)'
          : 'Open autonomous review');
      button.addEventListener('click', function (selectedRunId) {
        return function () {
          vscode.postMessage({ type: 'openProjectRun', payload: selectedRunId });
        };
      }(run.id));
      wrapper.appendChild(button);
    }
    return wrapper;
  }

  function renderTimelineNotes(notes) {
    var wrapper = document.createElement('details');
    wrapper.className = 'assistant-timeline-notes transcript-disclosure';

    var summary = createDisclosureSummary('Work log', buildTimelinePreview(notes));
    wrapper.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'transcript-disclosure-body';

    var list = document.createElement('ul');
    list.className = 'assistant-timeline-list';
    for (var index = 0; index < notes.length; index += 1) {
      var item = document.createElement('li');
      var note = notes[index] || {};

      if (note.label) {
        var label = document.createElement('span');
        label.className = 'assistant-timeline-inline-label';
        label.textContent = note.label + ': ';
        item.appendChild(label);
      }

      item.appendChild(document.createTextNode(note.summary || ''));

      if (note.tone === 'warning') {
        item.classList.add('warning');
      }
      list.appendChild(item);
    }
    body.appendChild(list);
    wrapper.appendChild(body);
    return wrapper;
  }

  function buildTimelinePreview(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
      return 'No work-log entries';
    }
    var latest = notes[notes.length - 1] || {};
    var latestSummary = latest.summary || latest.label || '';
    var count = notes.length === 1 ? '1 update' : (notes.length + ' updates');
    return count + ' - ' + truncateText(latestSummary, 64);
  }

  function createDisclosureSummary(title, preview, accessory) {
    var summary = document.createElement('summary');
    summary.className = 'transcript-disclosure-summary';

    var heading = document.createElement('div');
    heading.className = 'transcript-disclosure-heading';

    var titleNode = document.createElement('span');
    titleNode.className = 'transcript-disclosure-title';
    titleNode.textContent = title;
    heading.appendChild(titleNode);

    if (preview) {
      var previewNode = document.createElement('span');
      previewNode.className = 'transcript-disclosure-preview';
      previewNode.textContent = preview;
      heading.appendChild(previewNode);
    }

    summary.appendChild(heading);
    if (accessory) {
      summary.appendChild(accessory);
    }
    return summary;
  }

  function truncateText(value, maxLength) {
    var normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!normalized) {
      return '';
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '\u2026';
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function renderAssistantActions(entry) {
    var actions = document.createElement('div');
    actions.className = 'chat-message-actions';

    if (entry.meta && entry.meta.iterationLimitHit) {
      actions.appendChild(renderIterationLimitActions(entry.id, entry.meta));
    }

    // Quick-reply pills — immediate-submit, shown when response ends with a question.
    // Rendered above the toggle+proceed controls so the one-tap path is most prominent.
    if (entry.meta && Array.isArray(entry.meta.quickReplies) && entry.meta.quickReplies.length > 0) {
      actions.appendChild(renderQuickReplyButtons(entry.meta.quickReplies, entry.meta.followupQuestion));
    }

    if (entry.meta && entry.meta.followupQuestion && Array.isArray(entry.meta.suggestedFollowups) && entry.meta.suggestedFollowups.length > 0) {
      actions.appendChild(renderAssistantFollowupControls(entry.id, entry.meta.followupQuestion, entry.meta.suggestedFollowups));
    }

    var currentVote = entry.meta && entry.meta.userVote ? entry.meta.userVote : undefined;
    actions.appendChild(createVoteButton(entry.id, 'up', currentVote === 'up'));
    actions.appendChild(createVoteButton(entry.id, 'down', currentVote === 'down'));
    actions.appendChild(createDeleteButton(entry.id));
    return actions;
  }

  /**
   * Render immediate-submit pill buttons for yes/no and A/B quick replies.
   * Clicking a pill submits the prompt directly without a "Proceed" step.
   */
  function renderQuickReplyButtons(quickReplies, followupQuestion) {
    var wrapper = document.createElement('div');
    wrapper.className = 'quick-reply-buttons';
    if (followupQuestion) {
      wrapper.title = followupQuestion;
      wrapper.setAttribute('aria-label', followupQuestion);
    }

    for (var i = 0; i < quickReplies.length; i += 1) {
      var reply = quickReplies[i];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quick-reply-btn';
      btn.textContent = reply.label;
      btn.title = reply.description || reply.prompt;
      btn.setAttribute('aria-label', reply.label);
      btn.addEventListener('click', (function (prompt) {
        return function () {
          vscode.postMessage({ type: 'submitPrompt', payload: { prompt: prompt, mode: 'send' } });
          scheduleComposerFocusRestore({ force: true });
        };
      }(reply.prompt)));
      wrapper.appendChild(btn);
    }

    return wrapper;
  }

  function renderMessageDeleteRow(entryId) {
    var row = document.createElement('div');
    row.className = 'assistant-utility-row';
    var actions = document.createElement('div');
    actions.className = 'chat-message-actions';
    actions.appendChild(createDeleteButton(entryId));
    row.appendChild(actions);
    return row;
  }

  function renderIterationLimitActions(entryId, meta) {
    var wrapper = document.createElement('div');
    wrapper.className = 'iteration-limit-actions';

    var suggestedIter = meta && typeof meta.suggestedIterationLimit === 'number' ? meta.suggestedIterationLimit : null;
    var suggestedCalls = meta && typeof meta.suggestedToolCallsPerTurnLimit === 'number' ? meta.suggestedToolCallsPerTurnLimit : null;

    if (suggestedIter !== null) {
      var raisePermBtn = document.createElement('button');
      raisePermBtn.type = 'button';
      raisePermBtn.className = 'iteration-limit-raise-perm';
      raisePermBtn.textContent = 'Raise to ' + suggestedIter + ' (permanent)';
      raisePermBtn.title = 'Save ' + suggestedIter + ' as the new maxToolIterations setting and continue';
      raisePermBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'raiseIterationLimitPermanent', payload: { entryId: entryId, value: suggestedIter } });
      });

      var raiseTempBtn = document.createElement('button');
      raiseTempBtn.type = 'button';
      raiseTempBtn.className = 'iteration-limit-raise-temp';
      raiseTempBtn.textContent = 'Raise to ' + suggestedIter + ' (this task)';
      raiseTempBtn.title = 'Use ' + suggestedIter + ' iterations for this task only, without changing settings';
      raiseTempBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'raiseIterationLimitTemporary', payload: { entryId: entryId, value: suggestedIter } });
      });

      wrapper.appendChild(raisePermBtn);
      wrapper.appendChild(raiseTempBtn);
    }

    if (suggestedCalls !== null) {
      var raiseCallsPermBtn = document.createElement('button');
      raiseCallsPermBtn.type = 'button';
      raiseCallsPermBtn.className = 'iteration-limit-raise-perm';
      raiseCallsPermBtn.textContent = 'Allow ' + suggestedCalls + ' tools/turn (permanent)';
      raiseCallsPermBtn.title = 'Save ' + suggestedCalls + ' as the new maxToolCallsPerTurn setting and continue';
      raiseCallsPermBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'raiseToolCallsPerTurnLimitPermanent', payload: { entryId: entryId, value: suggestedCalls } });
      });

      var raiseCallsTempBtn = document.createElement('button');
      raiseCallsTempBtn.type = 'button';
      raiseCallsTempBtn.className = 'iteration-limit-raise-temp';
      raiseCallsTempBtn.textContent = 'Allow ' + suggestedCalls + ' tools/turn (this task)';
      raiseCallsTempBtn.title = 'Use ' + suggestedCalls + ' tool calls per turn for this task only';
      raiseCallsTempBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'raiseToolCallsPerTurnLimitTemporary', payload: { entryId: entryId, value: suggestedCalls } });
      });

      wrapper.appendChild(raiseCallsPermBtn);
      wrapper.appendChild(raiseCallsTempBtn);
    }

    var continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'iteration-limit-continue';
    continueBtn.textContent = 'Continue as-is';
    continueBtn.title = 'Continue execution from where AtlasMind stopped without changing limits';
    continueBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'continueExecution', payload: { entryId: entryId } });
    });

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'iteration-limit-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.title = 'Dismiss and keep the partial result';
    cancelBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'cancelExecution', payload: { entryId: entryId } });
    });

    wrapper.appendChild(continueBtn);
    wrapper.appendChild(cancelBtn);
    return wrapper;
  }

  function renderAssistantFollowupControls(entryId, question, followups) {
    var wrapper = document.createElement('div');
    wrapper.className = 'assistant-followup-controls';
    wrapper.title = question || 'Choose how AtlasMind should continue';
    wrapper.setAttribute('aria-label', question || 'Choose how AtlasMind should continue');

    var selectedIndex = Number.isInteger(assistantFollowupSelections[entryId])
      ? assistantFollowupSelections[entryId]
      : (followups.length === 1 ? 0 : -1);

    if (selectedIndex >= 0 && !followups[selectedIndex]) {
      selectedIndex = followups.length === 1 ? 0 : -1;
    }

    if (selectedIndex >= 0) {
      assistantFollowupSelections[entryId] = selectedIndex;
    }

    var optionButtons = [];
    var proceed = document.createElement('button');
    proceed.type = 'button';
    proceed.className = 'assistant-followup-proceed';
    proceed.textContent = 'Proceed';

    function syncSelectionUi() {
      for (var buttonIndex = 0; buttonIndex < optionButtons.length; buttonIndex += 1) {
        var optionButton = optionButtons[buttonIndex];
        var isActive = buttonIndex === selectedIndex;
        optionButton.classList.toggle('active', isActive);
        optionButton.setAttribute('aria-pressed', String(isActive));
      }
      proceed.disabled = selectedIndex < 0 || !followups[selectedIndex];
      proceed.title = selectedIndex >= 0 && followups[selectedIndex]
        ? 'Proceed with ' + followups[selectedIndex].label
        : 'Select an option first';
    }

    for (var i = 0; i < followups.length; i += 1) {
      var followup = followups[i];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'assistant-followup-toggle';
      button.textContent = followup.label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function (optionIndex) {
        return function () {
          selectedIndex = selectedIndex === optionIndex ? -1 : optionIndex;
          if (selectedIndex >= 0) {
            assistantFollowupSelections[entryId] = selectedIndex;
          } else {
            delete assistantFollowupSelections[entryId];
          }
          persistUiState();
          syncSelectionUi();
          scheduleComposerFocusRestore({ force: true });
        };
      }(i));
      optionButtons.push(button);
      wrapper.appendChild(button);
    }

    proceed.addEventListener('click', function () {
      var selectedFollowup = selectedIndex >= 0 ? followups[selectedIndex] : undefined;
      if (!selectedFollowup) {
        return;
      }
      vscode.postMessage({
        type: 'submitPrompt',
        payload: {
          prompt: selectedFollowup.prompt,
          mode: selectedFollowup.mode || 'send',
        },
      });
      scheduleComposerFocusRestore({ force: true });
    });

    wrapper.appendChild(proceed);
    syncSelectionUi();
    return wrapper;
  }

  function renderMarkdownContent(container, value) {
    container.innerHTML = '';
    var markdown = typeof value === 'string' ? value : '';
    if (!markdown) {
      return;
    }

    var normalized = markdown.replace(/\r\n/g, '\n');
    var blocks = parseMarkdownBlocks(normalized);
    var groups = groupBlocksByPriority(blocks);
    for (var index = 0; index < groups.length; index += 1) {
      var group = groups[index];
      if (group.type === 'aux') {
        container.appendChild(renderAuxiliarySection(group.title, group.blocks));
        continue;
      }

      for (var blockIndex = 0; blockIndex < group.blocks.length; blockIndex += 1) {
        var block = group.blocks[blockIndex];
        if (block.type === 'code') {
          container.appendChild(renderCodeFence(block.value));
          continue;
        }

        var text = block.value.trim();
        if (!text) {
          continue;
        }
        renderStructuredTextBlock(container, text);
      }
    }
  }

  function getHeadingInfo(text) {
    var match = /^(#{1,6})\s+([^\n]+)$/.exec(String(text || '').trim());
    return match ? { level: match[1].length, title: match[2].trim() } : undefined;
  }

  function isAuxiliaryHeading(text) {
    var normalized = String(text || '').replace(/^#{1,6}\s+/, '').trim().toLowerCase();
    return /^(changed files?|execution summary|workspace impact|supporting details?|verification(?: evidence| notes| summary)?|references?|actions?|related (?:resources|artifacts|actions)|logs?|cost summary|artifacts?|run metadata|file impact|diagnostics?)$/.test(normalized);
  }

  function isUtilityLine(text) {
    var normalized = String(text || '').trim();
    if (!normalized) {
      return false;
    }
    return /^status:/i.test(normalized)
      || /^_subtask file impact:/i.test(normalized)
      || /^\[reference:/i.test(normalized)
      || /^\[action available:/i.test(normalized)
      || /^project run summary saved to /i.test(normalized)
      || /^\*?\d+\s+subtask\(s\)\s*[·-]/i.test(normalized);
  }

  function isUtilityOnlyBlock(text) {
    var lines = String(text || '').split('\n').map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.length > 0;
    });
    return lines.length > 0 && lines.every(isUtilityLine);
  }

  function inferAuxiliaryTitle(text) {
    var normalized = String(text || '');
    if (/^\[reference:/im.test(normalized) || /^\[action available:/im.test(normalized) || /^project run summary saved to /im.test(normalized)) {
      return 'References & actions';
    }
    if (/^status:/im.test(normalized) || /^_subtask file impact:/im.test(normalized)) {
      return 'Execution notes';
    }
    if (/subtask\(s\)/i.test(normalized)) {
      return 'Execution summary';
    }
    return 'Supporting details';
  }

  function trimLeadingHeading(text) {
    return String(text || '').replace(/^#{1,6}\s+[^\n]+\n*/, '').trim();
  }

  function buildAuxiliaryPreview(blocks) {
    var parts = [];
    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index];
      if (!block || typeof block.value !== 'string') {
        continue;
      }
      var candidate = block.type === 'code' ? 'Code sample' : trimLeadingHeading(block.value);
      if (!candidate) {
        continue;
      }
      parts.push(candidate.replace(/\[(Reference|Action available):\s*/gi, '').replace(/\]$/g, ''));
    }
    return truncateText(parts.join(' '), 90);
  }

  function groupBlocksByPriority(blocks) {
    var groups = [];
    var normalBlocks = [];

    function flushNormal() {
      if (normalBlocks.length === 0) {
        return;
      }
      groups.push({ type: 'normal', blocks: normalBlocks.slice() });
      normalBlocks = [];
    }

    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index];
      var text = block && block.type === 'text' ? String(block.value || '').trim() : '';
      var heading = text ? getHeadingInfo(text) : undefined;

      if (heading && isAuxiliaryHeading(heading.title)) {
        flushNormal();
        var sectionBlocks = [block];
        while (index + 1 < blocks.length) {
          var nextBlock = blocks[index + 1];
          if (nextBlock && nextBlock.type === 'text') {
            var nextHeading = getHeadingInfo(String(nextBlock.value || '').trim());
            if (nextHeading && nextHeading.level <= heading.level) {
              break;
            }
          }
          index += 1;
          sectionBlocks.push(blocks[index]);
        }
        groups.push({ type: 'aux', title: heading.title, blocks: sectionBlocks });
        continue;
      }

      if (text && isUtilityOnlyBlock(text)) {
        flushNormal();
        var utilityBlocks = [block];
        var utilityTitle = inferAuxiliaryTitle(text);
        while (index + 1 < blocks.length) {
          var nextUtilityBlock = blocks[index + 1];
          if (!nextUtilityBlock || nextUtilityBlock.type !== 'text') {
            break;
          }
          var nextUtilityText = String(nextUtilityBlock.value || '').trim();
          if (!isUtilityOnlyBlock(nextUtilityText)) {
            break;
          }
          index += 1;
          utilityBlocks.push(blocks[index]);
        }
        groups.push({ type: 'aux', title: utilityTitle, blocks: utilityBlocks });
        continue;
      }

      normalBlocks.push(block);
    }

    flushNormal();
    return groups;
  }

  function renderAuxiliarySection(title, blocks) {
    var details = document.createElement('details');
    details.className = 'transcript-disclosure auxiliary-section';

    var summary = createDisclosureSummary(title || 'Supporting details', buildAuxiliaryPreview(blocks));
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'transcript-disclosure-body';

    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index];
      if (!block) {
        continue;
      }
      if (block.type === 'code') {
        body.appendChild(renderCodeFence(block.value));
        continue;
      }

      var text = String(block.value || '').trim();
      if (!text) {
        continue;
      }

      var trimmed = index === 0 ? trimLeadingHeading(text) : text;
      if (!trimmed) {
        continue;
      }

      if (isUtilityOnlyBlock(trimmed)) {
        body.appendChild(renderUtilityBlock(trimmed));
        continue;
      }

      renderStructuredTextBlock(body, trimmed);
    }

    details.appendChild(body);
    return details;
  }

  function renderUtilityBlock(text) {
    var wrapper = document.createElement('div');
    wrapper.className = 'chat-utility-block';

    var list = document.createElement('ul');
    list.className = 'chat-utility-list';

    var lines = String(text || '').split('\n').map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.length > 0;
    });

    for (var index = 0; index < lines.length; index += 1) {
      var item = document.createElement('li');
      item.className = 'chat-utility-item';
      appendInlineMarkdown(item, lines[index].replace(/^\[|\]$/g, ''));
      list.appendChild(item);
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  function renderStructuredTextBlock(container, text) {
    var lines = text.split('\n');
    var paragraphLines = [];

    function flushParagraph() {
      if (paragraphLines.length === 0) {
        return;
      }
      container.appendChild(renderParagraph(paragraphLines.join('\n')));
      paragraphLines = [];
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        flushParagraph();
        container.appendChild(renderHeading(trimmed));
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        container.appendChild(document.createElement('hr'));
        continue;
      }

      if (/^_Thinking:.*_$/.test(trimmed)) {
        flushParagraph();
        container.appendChild(renderThinkingNote(trimmed));
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        flushParagraph();
        var quoteLines = [trimmed];
        while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1].trim())) {
          index += 1;
          quoteLines.push(lines[index].trim());
        }
        container.appendChild(renderBlockquote(quoteLines.join('\n')));
        continue;
      }

      if (isTableBlock(lines.slice(index).join('\n'))) {
        flushParagraph();
        var tableLines = [line];
        while (index + 1 < lines.length) {
          var nextTableLine = lines[index + 1];
          if (!nextTableLine.trim() || !nextTableLine.includes('|')) {
            break;
          }
          index += 1;
          tableLines.push(nextTableLine);
        }
        container.appendChild(renderTable(tableLines.join('\n')));
        continue;
      }

      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        var ordered = /^\d+\.\s+/.test(trimmed);
        var listLines = [trimmed];
        while (index + 1 < lines.length) {
          var nextTrimmed = lines[index + 1].trim();
          if (!nextTrimmed) {
            break;
          }
          if ((ordered && /^\d+\.\s+/.test(nextTrimmed)) || (!ordered && /^[-*]\s+/.test(nextTrimmed))) {
            index += 1;
            listLines.push(nextTrimmed);
            continue;
          }
          break;
        }
        container.appendChild(renderList(listLines.join('\n')));
        continue;
      }

      paragraphLines.push(line);
    }

    flushParagraph();
  }

  function parseMarkdownBlocks(markdown) {
    var blocks = [];
    var paragraphLines = [];
    var codeLines = [];
    var inCodeFence = false;
    var lines = markdown.split('\n');

    function flushParagraph() {
      if (paragraphLines.length === 0) {
        return;
      }
      blocks.push({ type: 'text', value: paragraphLines.join('\n') });
      paragraphLines = [];
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var trimmed = line.trim();

      if (inCodeFence) {
        codeLines.push(line);
        if (/^```/.test(trimmed)) {
          blocks.push({ type: 'code', value: codeLines.join('\n') });
          codeLines = [];
          inCodeFence = false;
        }
        continue;
      }

      if (/^```/.test(trimmed)) {
        flushParagraph();
        inCodeFence = true;
        codeLines = [line];
        continue;
      }

      if (trimmed.length === 0) {
        flushParagraph();
        continue;
      }

      paragraphLines.push(line);
    }

    flushParagraph();

    if (codeLines.length > 0) {
      blocks.push({ type: 'code', value: codeLines.join('\n') });
    }

    return blocks;
  }

  function splitTableRow(line) {
    var normalized = String(line || '').trim();
    if (normalized.startsWith('|')) {
      normalized = normalized.slice(1);
    }
    if (normalized.endsWith('|')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized.split('|').map(function (cell) {
      return cell.trim();
    });
  }

  function isTableSeparatorRow(line) {
    var cells = splitTableRow(line);
    return cells.length > 1 && cells.every(function (cell) {
      return /^:?-{3,}:?$/.test(cell);
    });
  }

  function isTableBlock(block) {
    var lines = String(block || '').split('\n').filter(function (line) {
      return line.trim().length > 0;
    });
    if (lines.length < 2 || !lines[0].includes('|') || !isTableSeparatorRow(lines[1])) {
      return false;
    }

    var headerCells = splitTableRow(lines[0]);
    var separatorCells = splitTableRow(lines[1]);
    if (headerCells.length < 2 || headerCells.length !== separatorCells.length) {
      return false;
    }

    for (var index = 2; index < lines.length; index += 1) {
      if (!lines[index].includes('|')) {
        return false;
      }
      var rowCells = splitTableRow(lines[index]);
      if (rowCells.length !== headerCells.length) {
        return false;
      }
    }

    return true;
  }

  function getTableAlignment(separator) {
    if (/^:-+:$/.test(separator)) {
      return 'center';
    }
    if (/^-+:$/.test(separator)) {
      return 'right';
    }
    return 'left';
  }

  function renderTable(block) {
    var lines = String(block || '').split('\n').filter(function (line) {
      return line.trim().length > 0;
    });
    var headerCells = splitTableRow(lines[0]);
    var alignments = splitTableRow(lines[1]).map(getTableAlignment);
    var rowLines = lines.slice(2);

    var wrapper = document.createElement('div');
    wrapper.className = 'chat-table-wrap';

    var table = document.createElement('table');
    table.className = 'chat-markdown-table';

    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');
    for (var index = 0; index < headerCells.length; index += 1) {
      var th = document.createElement('th');
      th.style.textAlign = alignments[index] || 'left';
      appendInlineMarkdown(th, headerCells[index]);
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    if (rowLines.length > 0) {
      var tbody = document.createElement('tbody');
      for (var rowIndex = 0; rowIndex < rowLines.length; rowIndex += 1) {
        var row = document.createElement('tr');
        var rowCells = splitTableRow(rowLines[rowIndex]);
        for (var cellIndex = 0; cellIndex < rowCells.length; cellIndex += 1) {
          var td = document.createElement('td');
          td.style.textAlign = alignments[cellIndex] || 'left';
          appendInlineMarkdown(td, rowCells[cellIndex]);
          row.appendChild(td);
        }
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
    }

    wrapper.appendChild(table);
    return wrapper;
  }

  var COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var COPIED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var TERMINAL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';

  function renderCodeFence(block) {
    var lines = block.split('\n');
    var firstLine = lines[0];
    var language = firstLine.replace(/^```\s*/, '').trim();
    var code = lines.slice(1);
    if (code.length > 0 && /^```\s*$/.test(code[code.length - 1])) {
      code.pop();
    }
    var codeText = code.join('\n');

    var wrapper = document.createElement('div');
    wrapper.className = 'chat-code-block';

    var header = document.createElement('div');
    header.className = 'chat-code-block-header';

    var langLabel = document.createElement('span');
    langLabel.className = 'chat-code-block-lang';
    langLabel.textContent = language;
    header.appendChild(langLabel);

    var actions = document.createElement('div');
    actions.className = 'chat-code-block-actions';

    var copyBtn = document.createElement('button');
    copyBtn.className = 'chat-code-btn';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.setAttribute('aria-label', 'Copy to clipboard');
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', function() {
      if (!navigator.clipboard) { return; }
      navigator.clipboard.writeText(codeText).then(function() {
        copyBtn.innerHTML = COPIED_ICON;
        copyBtn.classList.add('chat-code-btn--copied');
        setTimeout(function() {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('chat-code-btn--copied');
        }, 1500);
      });
    });
    actions.appendChild(copyBtn);

    var termBtn = document.createElement('button');
    termBtn.className = 'chat-code-btn';
    termBtn.title = 'Send to terminal';
    termBtn.setAttribute('aria-label', 'Send to terminal');
    termBtn.innerHTML = TERMINAL_ICON;
    termBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'sendToTerminal', payload: { code: codeText } });
      termBtn.classList.add('chat-code-btn--active');
      setTimeout(function() { termBtn.classList.remove('chat-code-btn--active'); }, 600);
    });
    actions.appendChild(termBtn);

    header.appendChild(actions);
    wrapper.appendChild(header);

    var pre = document.createElement('pre');
    var codeEl = document.createElement('code');
    if (language) {
      codeEl.setAttribute('data-lang', language);
    }
    codeEl.textContent = codeText;
    pre.appendChild(codeEl);
    wrapper.appendChild(pre);
    return wrapper;
  }

  function renderHeading(block) {
    var match = /^(#{1,6})\s+([\s\S]+)$/.exec(block);
    var level = match ? match[1].length : 1;
    var element = document.createElement('h' + Math.min(level, 6));
    appendInlineMarkdown(element, match ? match[2].trim() : block);
    return element;
  }

  function isListBlock(block) {
    var lines = block.split('\n').filter(function (line) { return line.trim().length > 0; });
    if (lines.length === 0) {
      return false;
    }
    return lines.every(function (line) {
      return /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
    });
  }

  function renderList(block) {
    var lines = block.split('\n').filter(function (line) { return line.trim().length > 0; });
    var ordered = lines.length > 0 && /^\d+\.\s+/.test(lines[0]);
    var list = document.createElement(ordered ? 'ol' : 'ul');
    for (var i = 0; i < lines.length; i += 1) {
      var item = document.createElement('li');
      appendInlineMarkdown(item, lines[i].replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''));
      list.appendChild(item);
    }
    return list;
  }

  function renderBlockquote(block) {
    var quote = document.createElement('blockquote');
    var lines = block.split('\n').map(function (line) {
      return line.replace(/^>\s?/, '');
    });
    appendInlineMarkdown(quote, lines.join('\n'));
    return quote;
  }

  function renderThinkingNote(block) {
    var paragraph = document.createElement('p');
    paragraph.className = 'thinking-note';
    appendInlineMarkdown(paragraph, block.replace(/^_/, '').replace(/_$/, ''));
    return paragraph;
  }

  function renderParagraph(block) {
    var paragraph = document.createElement('p');
    appendInlineMarkdown(paragraph, block.replace(/\n/g, '  \n'));
    return paragraph;
  }

  function appendInlineMarkdown(container, value) {
    var text = typeof value === 'string' ? value : '';
    if (!text) {
      return;
    }

    var tokens = [];
    var pattern = /(\[[^\]]+\]\(([^)]+)\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
    var lastIndex = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) });
      }
      tokens.push({ type: 'token', value: match[0], href: match[2] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      tokens.push({ type: 'text', value: text.slice(lastIndex) });
    }

    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (token.type === 'text') {
        appendTextWithLineBreaks(container, token.value);
        continue;
      }

      var raw = token.value;
      if (/^`[^`]+`$/.test(raw)) {
        var code = document.createElement('code');
        code.textContent = raw.slice(1, -1);
        container.appendChild(code);
        continue;
      }

      if (/^\[[^\]]+\]\(([^)]+)\)$/.test(raw)) {
        var linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw);
        var href = linkMatch ? linkMatch[2] : '';
        var link = document.createElement('a');
        link.textContent = linkMatch ? linkMatch[1] : raw;
        link.href = sanitizeLinkHref(href);
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        container.appendChild(link);
        continue;
      }

      if (/^(\*\*|__)[\s\S]+(\*\*|__)$/.test(raw)) {
        var strong = document.createElement('strong');
        appendTextWithLineBreaks(strong, raw.slice(2, -2));
        container.appendChild(strong);
        continue;
      }

      if (/^(\*|_)[\s\S]+(\*|_)$/.test(raw)) {
        var em = document.createElement('em');
        appendTextWithLineBreaks(em, raw.slice(1, -1));
        container.appendChild(em);
      }
    }
  }

  function appendTextWithLineBreaks(container, value) {
    var parts = String(value).split(/\n/);
    for (var i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        container.appendChild(document.createElement('br'));
      }
      if (parts[i]) {
        container.appendChild(document.createTextNode(parts[i]));
      }
    }
  }

  function sanitizeLinkHref(href) {
    var value = String(href || '').trim();
    if (/^(https?:|mailto:)/i.test(value)) {
      return value;
    }
    if (/^(#|\.?\/?[A-Za-z0-9_./%\-]+(?:#.*)?)$/.test(value)) {
      return value;
    }
    return '#';
  }

  function createDeleteButton(entryId) {
    var button = document.createElement('button');
    button.className = 'vote-btn delete-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Delete message');
    button.title = 'Delete message';
    button.innerHTML = getTrashIconMarkup();
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      vscode.postMessage({ type: 'deleteMessage', payload: entryId });
    });
    return button;
  }

  function getTrashIconMarkup() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M9 4h6"></path>'
      + '<path d="M5 7h14"></path>'
      + '<path d="M8 7v11.5c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5V7"></path>'
      + '<path d="M10 10.5v5"></path>'
      + '<path d="M14 10.5v5"></path>'
      + '</svg>';
  }

  function createVoteButton(entryId, vote, active) {
    var button = document.createElement('button');
    button.className = 'vote-btn' + (active ? ' active' : '');
    button.type = 'button';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', vote === 'up' ? 'Thumbs up' : 'Thumbs down');
    button.title = vote === 'up' ? 'Thumbs up' : 'Thumbs down';
    button.innerHTML = vote === 'up' ? getThumbIconMarkup(false) : getThumbIconMarkup(true);
    button.addEventListener('click', function () {
      vscode.postMessage({
        type: 'voteAssistantMessage',
        payload: {
          entryId: entryId,
          vote: active ? 'clear' : vote,
        },
      });
    });
    return button;
  }

  function getThumbIconMarkup(isDown) {
    var transform = isDown ? ' transform="rotate(180 12 12)"' : '';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<g' + transform + '>'
      + '<path d="M14 10V5.5c0-1.6 1.2-3 2.7-3.3l.8-.2v6.5h2.9c1.1 0 1.9 1 1.7 2.1l-1.2 7.2c-.2 1-1 1.7-2 1.7H9.5c-.8 0-1.5-.7-1.5-1.5V11c0-.6.2-1.1.6-1.5l4-4.5c.4-.4.9-.7 1.4-.8Z"></path>'
      + '<path d="M4 10h4v10H5.5C4.7 20 4 19.3 4 18.5V10Z"></path>'
      + '</g>'
      + '</svg>';
  }

  function renderThinkingIndicator(hasContent) {
    var wrapper = document.createElement('div');
    wrapper.className = 'thinking-indicator' + (hasContent ? ' compact' : '');

    var logo = document.createElement('div');
    logo.className = 'thinking-logo atlas-globe-loader';
    logo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle class="atlas-outline" cx="12" cy="12" r="10"></circle>'
      + '<g class="atlas-axis">'
      + '<path d="M12 2 C7 7, 7 17, 12 22"></path>'
      + '<path d="M12 2 C17 7, 17 17, 12 22"></path>'
      + '<line x1="2" y1="12" x2="22" y2="12"></line>'
      + '</g>'
      + '</svg>';

    var copy = document.createElement('div');
    copy.className = 'thinking-copy';

    var title = document.createElement('div');
    title.className = 'thinking-title';
    title.textContent = 'AtlasMind is thinking';

    var subtitle = document.createElement('div');
    subtitle.className = 'thinking-subtitle';
    subtitle.textContent = hasContent
      ? 'The response is still streaming.'
      : 'The model has not stopped; waiting for the next token batch.';

    copy.appendChild(title);
    copy.appendChild(subtitle);
    wrapper.appendChild(logo);
    wrapper.appendChild(copy);
    return wrapper;
  }

  function renderThoughtSummary(thoughtSummary) {
    var details = document.createElement('details');
    details.className = 'thought-details transcript-disclosure';

    var statusChip;
    if (thoughtSummary.status && thoughtSummary.statusLabel) {
      statusChip = document.createElement('span');
      statusChip.className = 'thought-status-chip ' + thoughtSummary.status;
      statusChip.textContent = thoughtSummary.statusLabel;
    }

    var summary = createDisclosureSummary(
      thoughtSummary.label || 'Thinking summary',
      truncateText(thoughtSummary.summary || '', 72),
      statusChip
    );
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'transcript-disclosure-body';

    if (thoughtSummary.summary) {
      var summaryText = document.createElement('p');
      summaryText.className = 'thought-summary';
      summaryText.textContent = thoughtSummary.summary;
      body.appendChild(summaryText);
    }

    if (Array.isArray(thoughtSummary.bullets) && thoughtSummary.bullets.length > 0) {
      var list = document.createElement('ul');
      list.className = 'thought-list';
      for (var i = 0; i < thoughtSummary.bullets.length; i++) {
        var item = document.createElement('li');
        item.textContent = thoughtSummary.bullets[i];
        list.appendChild(item);
      }
      body.appendChild(list);
    }

    details.appendChild(body);

    return details;
  }

  function renderRunReviewBubble(run) {
    var bubble = document.createElement('div');
    bubble.className = 'run-review-bubble';

    var header = document.createElement('div');
    header.className = 'run-review-header';

    var titleBlock = document.createElement('div');
    var eyebrow = document.createElement('div');
    eyebrow.className = 'run-review-kicker';
    eyebrow.textContent = 'Autonomous run review';
    var title = document.createElement('h4');
    title.className = 'run-review-title';
    title.textContent = run.shortTitle || 'Review autonomous run';
    titleBlock.appendChild(eyebrow);
    titleBlock.appendChild(title);

    var status = document.createElement('div');
    status.className = 'run-review-pill';
    status.textContent = describeRunReview(run);

    header.appendChild(titleBlock);
    header.appendChild(status);
    bubble.appendChild(header);

    var goal = document.createElement('p');
    goal.className = 'run-review-goal';
    goal.textContent = run.goal;
    bubble.appendChild(goal);

    var summary = document.createElement('div');
    summary.className = 'run-review-summary';
    summary.textContent = run.pendingReviewCount > 0
      ? run.pendingReviewCount + ' file change' + (run.pendingReviewCount === 1 ? ' is' : 's are') + ' still waiting for review.'
      : 'Every file in this autonomous run has been reviewed.';
    bubble.appendChild(summary);

    var controls = document.createElement('div');
    controls.className = 'run-review-controls';
    controls.appendChild(createRunReviewActionButton('Approve all', 'accepted', run.id));
    controls.appendChild(createRunReviewActionButton('Dismiss all', 'dismissed', run.id));

    var centerButton = document.createElement('button');
    centerButton.type = 'button';
    centerButton.className = 'run-review-open-center';
    centerButton.textContent = 'Open Run Center';
    centerButton.addEventListener('click', function () {
      vscode.postMessage({ type: 'openProjectRunCenter', payload: run.id });
    });
    controls.appendChild(centerButton);
    bubble.appendChild(controls);

    var fileList = document.createElement('div');
    fileList.className = 'run-review-file-list';
    var files = Array.isArray(run.reviewFiles) ? run.reviewFiles : [];
    if (files.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'This autonomous run did not record any changed files.';
      fileList.appendChild(empty);
    } else {
      for (var index = 0; index < files.length; index += 1) {
        fileList.appendChild(renderRunReviewFileRow(run.id, files[index]));
      }
    }
    bubble.appendChild(fileList);
    return bubble;
  }

  function renderRunReviewFileRow(runId, file) {
    var row = document.createElement('div');
    row.className = 'run-review-file-row ' + file.decision;

    var link = document.createElement('button');
    link.type = 'button';
    link.className = 'run-review-file-link';
    link.textContent = file.relativePath;
    link.addEventListener('click', function () {
      vscode.postMessage({ type: 'openRunReviewFile', payload: { runId: runId, relativePath: file.relativePath } });
    });
    row.appendChild(link);

    var meta = document.createElement('div');
    meta.className = 'run-review-file-meta';
    meta.textContent = file.status + (Array.isArray(file.sourceTitles) && file.sourceTitles.length > 0
      ? ' • ' + file.sourceTitles.join(', ')
      : '');
    row.appendChild(meta);

    var actions = document.createElement('div');
    actions.className = 'run-review-file-actions';
    actions.appendChild(createRunReviewActionButton('Approve file', 'accepted', runId, file.relativePath, file.decision === 'accepted'));
    actions.appendChild(createRunReviewActionButton('Dismiss file', 'dismissed', runId, file.relativePath, file.decision === 'dismissed'));
    row.appendChild(actions);

    return row;
  }

  function createRunReviewActionButton(label, decision, runId, relativePath, active) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'run-review-decision-btn ' + decision + (active ? ' active' : '');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.textContent = decision === 'accepted' ? '✓' : '✕';
    button.addEventListener('click', function () {
      vscode.postMessage(relativePath
        ? { type: 'reviewRunFile', payload: { runId: runId, relativePath: relativePath, decision: decision } }
        : { type: 'reviewRunAll', payload: { runId: runId, decision: decision } });
    });
    return button;
  }

  function renderPendingRunReview(summary, selectedRunId) {
    var hasPending = summary && Array.isArray(summary.runs) && summary.runs.length > 0 && summary.totalPendingFiles > 0;
    pendingRunReviewBar.classList.toggle('hidden', !hasPending);
    if (!hasPending) {
      pendingRunReviewFlyout.innerHTML = '';
      setPendingRunReviewFlyoutOpen(false);
      return;
    }

    pendingRunReviewTitle.textContent = 'Autonomous review pending';
    pendingRunReviewSummary.textContent = summary.totalPendingFiles + ' file change' + (summary.totalPendingFiles === 1 ? ' is' : 's are') + ' still waiting for review.';

    pendingRunReviewFlyout.innerHTML = '';
    for (var runIndex = 0; runIndex < summary.runs.length; runIndex += 1) {
      var run = summary.runs[runIndex];
      var section = document.createElement('div');
      section.className = 'pending-run-section';

      var header = document.createElement('div');
      header.className = 'pending-run-header';
      var title = document.createElement('div');
      title.className = 'pending-run-title';
      title.textContent = run.shortTitle;
      header.appendChild(title);

      var openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'pending-run-open-btn' + (selectedRunId === run.runId ? ' active' : '');
      openButton.title = 'Open autonomous review bubble';
      openButton.textContent = '↗';
      openButton.addEventListener('click', function (runId) {
        return function () {
          vscode.postMessage({ type: 'openProjectRun', payload: runId });
        };
      }(run.runId));
      header.appendChild(openButton);
      section.appendChild(header);

      var bulkActions = document.createElement('div');
      bulkActions.className = 'pending-run-bulk-actions';
      bulkActions.appendChild(createRunReviewActionButton('Approve all pending files', 'accepted', run.runId));
      bulkActions.appendChild(createRunReviewActionButton('Dismiss all pending files', 'dismissed', run.runId));
      section.appendChild(bulkActions);

      for (var fileIndex = 0; fileIndex < run.pendingFiles.length; fileIndex += 1) {
        var file = run.pendingFiles[fileIndex];
        section.appendChild(renderRunReviewFileRow(run.runId, {
          relativePath: file.relativePath,
          status: file.status,
          decision: 'pending',
          uriPath: file.uriPath,
          sourceTitles: [],
        }));
      }

      pendingRunReviewFlyout.appendChild(section);
    }

    if (!pendingRunReviewFlyoutOpen) {
      pendingRunReviewFlyout.classList.add('hidden');
    }
  }

  function renderRunInspector(run) {
    runInspector.innerHTML = '';
    if (!run) {
      return;
    }

    var summary = document.createElement('div');
    summary.className = 'run-card';

    var h3 = document.createElement('h3');
    h3.textContent = run.goal;
    summary.appendChild(h3);

    var pill = document.createElement('div');
    pill.className = 'run-status-pill';
    pill.textContent = describeRun(run);
    summary.appendChild(pill);

    var metaP = document.createElement('p');
    metaP.className = 'session-meta';
    metaP.textContent = 'Batch ' + (run.totalBatches > 0 ? run.currentBatch + '/' + run.totalBatches : 'n/a') + ' \u2022 Updated ' + run.updatedAt;
    summary.appendChild(metaP);

    var actionRow = document.createElement('div');
    actionRow.className = 'row';
    var openCenter = document.createElement('button');
    openCenter.textContent = 'Open Run Center';
    openCenter.addEventListener('click', function () {
      vscode.postMessage({ type: 'openProjectRunCenter', payload: run.id });
    });
    actionRow.appendChild(openCenter);
    summary.appendChild(actionRow);
    runInspector.appendChild(summary);

    var logCard = document.createElement('div');
    logCard.className = 'run-card';
    var logH4 = document.createElement('h4');
    logH4.textContent = 'Recent Activity';
    logCard.appendChild(logH4);
    var logList = document.createElement('div');
    logList.className = 'run-log-list';
    var logs = Array.isArray(run.logs) ? run.logs.slice(-8).reverse() : [];
    if (logs.length === 0) {
      var emptyLog = document.createElement('div');
      emptyLog.className = 'empty-state';
      emptyLog.textContent = 'No logs recorded yet.';
      logList.appendChild(emptyLog);
    } else {
      for (var li = 0; li < logs.length; li++) {
        var logEntry = logs[li];
        var logItem = document.createElement('div');
        logItem.className = 'subtask-item';

        var strong = document.createElement('strong');
        strong.textContent = logEntry.level.toUpperCase();
        logItem.appendChild(strong);

        var tsDiv = document.createElement('div');
        tsDiv.className = 'session-meta';
        tsDiv.textContent = logEntry.timestamp;
        logItem.appendChild(tsDiv);

        var msgDiv = document.createElement('div');
        msgDiv.textContent = logEntry.message;
        logItem.appendChild(msgDiv);

        logList.appendChild(logItem);
      }
    }
    logCard.appendChild(logList);
    runInspector.appendChild(logCard);

    var subtasksCard = document.createElement('div');
    subtasksCard.className = 'run-card';
    var stH4 = document.createElement('h4');
    stH4.textContent = 'Sub-Agent Work';
    subtasksCard.appendChild(stH4);
    var subtaskList = document.createElement('div');
    subtaskList.className = 'subtask-list';
    var artifacts = Array.isArray(run.subTaskArtifacts) ? run.subTaskArtifacts : [];
    if (artifacts.length === 0) {
      var emptySt = document.createElement('div');
      emptySt.className = 'empty-state';
      emptySt.textContent = 'No subtask artifacts recorded yet.';
      subtaskList.appendChild(emptySt);
    } else {
      for (var ai = 0; ai < artifacts.length; ai++) {
        var artifact = artifacts[ai];
        var stItem = document.createElement('div');
        stItem.className = 'subtask-item';
        var changedCount = Array.isArray(artifact.changedFiles) ? artifact.changedFiles.length : 0;

        var stStrong = document.createElement('strong');
        stStrong.textContent = artifact.title;
        stItem.appendChild(stStrong);

        var stMeta = document.createElement('div');
        stMeta.className = 'session-meta';
        stMeta.textContent = artifact.role + ' \u2022 ' + artifact.status + ' \u2022 ' + changedCount + ' file' + (changedCount === 1 ? '' : 's');
        stItem.appendChild(stMeta);

        var stOut = document.createElement('div');
        stOut.textContent = artifact.outputPreview || 'No output yet.';
        stItem.appendChild(stOut);

        subtaskList.appendChild(stItem);
      }
    }
    subtasksCard.appendChild(subtaskList);
    runInspector.appendChild(subtasksCard);
  }

  // --- Event listeners ---

  sendPrompt.addEventListener('click', submitPrompt);
  stopPrompt.addEventListener('click', function () {
    vscode.postMessage({ type: 'stopPrompt' });
  });

  promptInput.addEventListener('keydown', function (event) {
    if (event.isComposing) {
      return;
    }

    if (!event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowUp' && canNavigatePromptHistory(-1) && navigatePromptHistory(-1)) {
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowDown' && canNavigatePromptHistory(1) && navigatePromptHistory(1)) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter' && event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      insertComposerTextAtSelection('\n');
      return;
    }

    if (event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      submitPrompt('new-chat');
      return;
    }

    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey) {
      event.preventDefault();
      submitPrompt('steer');
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      submitPrompt();
    }
  });

  promptInput.addEventListener('input', function () {
    if (suppressPromptHistoryReset) {
      return;
    }
    resetPromptHistoryNavigation(promptInput.value);
  });

  if (transcript) {
    transcript.addEventListener('scroll', function () {
      syncTranscriptAutoScrollPreference();
    });
  }

  clearConversation.addEventListener('click', function () {
    vscode.postMessage({ type: 'clearConversation' });
  });
  copyTranscript.addEventListener('click', function () {
    vscode.postMessage({ type: 'copyTranscript' });
  });
  saveTranscript.addEventListener('click', function () {
    vscode.postMessage({ type: 'saveTranscript' });
  });
  createSession.addEventListener('click', function () {
    vscode.postMessage({ type: 'createSession' });
  });
  attachFiles.addEventListener('click', function () {
    vscode.postMessage({ type: 'pickAttachments' });
  });
  attachOpenFiles.addEventListener('click', function () {
    vscode.postMessage({ type: 'attachOpenFiles' });
  });
  clearAttachments.addEventListener('click', function () {
    vscode.postMessage({ type: 'clearAttachments' });
  });
  if (toggleAutopilotBtn) {
    toggleAutopilotBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'toggleAutopilot' });
    });
  }
  sendMode.addEventListener('change', function () {
    applyComposerModePreference(sendMode.value, { clearQueuedMode: true });
    updateComposerAvailability();
  });
  if (pendingRunReviewBar) {
    pendingRunReviewBar.addEventListener('click', function () {
      setPendingRunReviewFlyoutOpen(!pendingRunReviewFlyoutOpen);
    });
    pendingRunReviewBar.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setPendingRunReviewFlyoutOpen(!pendingRunReviewFlyoutOpen);
      }
    });
  }

  var dropTargets = [dropHint, promptInput, composerShell];
  for (var di = 0; di < dropTargets.length; di++) {
    (function (target) {
      target.addEventListener('dragover', function (event) {
        event.preventDefault();
        setDropState(true);
      });
      target.addEventListener('dragleave', function () {
        setDropState(false);
      });
      target.addEventListener('drop', async function (event) {
        event.preventDefault();
        setDropState(false);
        var importedItems = await collectImportedItemsFromTransfer(event.dataTransfer);
        if (importedItems.length > 0) {
          vscode.postMessage({ type: 'ingestPromptMedia', payload: { items: importedItems } });
          return;
        }
        var droppedItems = collectDroppedItems(event);
        if (droppedItems.length > 0) {
          vscode.postMessage({ type: 'addDroppedItems', payload: droppedItems });
        }
      });
    })(dropTargets[di]);
  }

  promptInput.addEventListener('paste', async function (event) {
    var importedItems = await collectImportedItemsFromTransfer(event.clipboardData, { includePlainText: false });
    if (importedItems.length === 0) {
      return;
    }

    event.preventDefault();
    vscode.postMessage({ type: 'ingestPromptMedia', payload: { items: importedItems } });
  });

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'state') {
      var state = message.payload || {};
      latestState = state;
      isBusy = Boolean(state.busy);
      if (typeof state.chatFontScale === 'number' && state.chatFontScale !== chatFontScale) {
        chatFontScale = normalizeChatFontScale(state.chatFontScale);
        applyChatFontScale();
        persistUiState();
      }
      if (typeof state.composerMode === 'string' && state.composerMode.length > 0) {
        applyComposerModePreference(state.composerMode, { clearQueuedMode: false });
      } else {
        applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: false });
      }
      if (typeof state.composerDraft === 'string' && state.composerDraft.length > 0) {
        promptInput.value = state.composerDraft;
        resetPromptHistoryNavigation(state.composerDraft);
        status.textContent = 'Loaded a Project Dashboard prompt. Review it, then send when ready.';
        focusPromptInputAtEnd({ force: true });
      }
      var standaloneRuns = renderSessions(state.sessions, state.selectedSessionId, state.projectRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderRuns(standaloneRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderPendingApprovals(state.pendingToolApprovals);
      renderPendingRunReview(state.pendingRunReview, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderAttachments(state.attachments);
      renderOpenFiles(state.openFiles);
      renderRecoveryNotice(state.recoveryNotice);
      if (toggleAutopilotBtn) {
        var autopilotOn = Boolean(state.autopilotEnabled);
        toggleAutopilotBtn.setAttribute('aria-pressed', String(autopilotOn));
        toggleAutopilotBtn.title = autopilotOn
          ? 'Autopilot ON — click to disable (tool approvals will be required again)'
          : 'Toggle Autopilot — grant all tool approvals automatically';
      }

      var isRun = state.activeSurface === 'run';
      transcript.classList.toggle('hidden', isRun);
      runInspector.classList.toggle('hidden', !isRun);
      updateComposerAvailability();
      clearConversation.disabled = isRun;
      panelTitle.textContent = isRun
        ? (state.selectedRun ? state.selectedRun.goal : 'Autonomous Run')
        : (((state.sessions || []).find(function (s) { return s.id === state.selectedSessionId; }) || {}).title || 'AtlasMind Chat');
      panelSubtitle.textContent = isRun
        ? 'Inspect live sub-agent activity here, then open the Project Run Center to pause, approve, or resume batches.'
        : 'Persistent workspace chat threads with direct access to recent autonomous runs.';
      setComposerHintContent(isRun ? 'run' : (isBusy ? 'busy' : 'idle'));

      if (isRun) {
        renderRunInspector(state.selectedRun);
      } else {
        renderTranscript(state.transcript, isBusy, state.selectedMessageId, state.projectRuns, state.selectedRun, state.busyAssistantMessageId, state.streamingThought, state.streamingModels);
        if (isSearchMode && lastSearchQuery) {
          clearSearchHighlights();
          searchResults = collectSearchMatches(lastSearchQuery);
          if (searchResults.length > 0) {
            currentSearchIndex = Math.min(currentSearchIndex, searchResults.length - 1);
          } else {
            currentSearchIndex = 0;
          }
          renderTranscriptWithSearch();
        }
        if (!isBusy) {
          scheduleComposerFocusRestore();
        }
      }
      return;
    }

    if (message.type === 'status') {
      const payload = typeof message.payload === 'string' ? message.payload : '';

      const toolExecData = parseToolExecutionMessage(payload);
      if (toolExecData) {
        const displayText = (toolExecData.humanReadable || ('Tool round ' + toolExecData.data.round)).trim();
        status.textContent = displayText;
      } else {
        status.textContent = payload;
      }
      return;
    }

    if (message.type === 'busy') {
      var busyPayload = message.payload;
      var busy = Boolean(typeof busyPayload === 'object' && busyPayload !== null ? busyPayload.busy : busyPayload);
      var busySessionId = typeof busyPayload === 'object' && busyPayload !== null && typeof busyPayload.sessionId === 'string'
        ? busyPayload.sessionId
        : (latestState && typeof latestState.busySessionId === 'string' ? latestState.busySessionId : undefined);
      isBusy = busy && (!latestState || !busySessionId || latestState.selectedSessionId === busySessionId);
      applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: true });
      if (latestState && latestState.activeSurface !== 'run') {
        renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId, latestState.projectRuns, latestState.selectedRun, latestState.busyAssistantMessageId, latestState.streamingThought, latestState.streamingModels);
      }
      updateComposerAvailability();
      if (latestState) {
        setComposerHintContent(latestState.activeSurface === 'run' ? 'run' : (busy ? 'busy' : 'idle'));
      }
      if (!busy) {
        scheduleComposerFocusRestore();
      }
    }

    if (message.type === 'showAiInstructionNudge') {
      var nudge = document.getElementById('aiInstructionNudge');
      var detail = document.getElementById('aiInstructionNudgeDetail');
      if (nudge) {
        if (detail && message.payload && message.payload.files) {
          detail.textContent = ‘ Found: ‘ + message.payload.files + ". Sync them so AtlasMind knows your project’s rules and policies.";
        }
        nudge.classList.remove('hidden');
      }
    }

    if (message.type === 'hideAiInstructionNudge') {
      var nudgeEl = document.getElementById('aiInstructionNudge');
      if (nudgeEl) {
        nudgeEl.classList.add('hidden');
      }
    }
  });

  var syncAiBtn = document.getElementById('syncAiInstructions');
  var dismissNudgeBtn = document.getElementById('dismissAiInstructionNudge');
  if (syncAiBtn) {
    syncAiBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'syncAiInstructions' });
      syncAiBtn.disabled = true;
      syncAiBtn.textContent = 'Syncing…';
    });
  }
  if (dismissNudgeBtn) {
    dismissNudgeBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'dismissAiInstructionNudge' });
    });
  }

  window.__atlasChatSearchBridge = {
    getLatestState: function () {
      return latestState;
    },
    getIsSearchMode: function () {
      return isSearchMode;
    },
    getStatusElement: function () {
      return status;
    },
    getTranscriptElement: function () {
      return transcript;
    },
    renderSearchResult: function (selectedMessageId, highlightInfo) {
      if (!latestState) {
        return;
      }

      renderTranscript(
        latestState.transcript,
        isBusy,
        selectedMessageId,
        latestState.projectRuns,
        latestState.selectedRun,
        latestState.busyAssistantMessageId,
        latestState.streamingThought,
        latestState.streamingModels,
      );

      if (highlightInfo && highlightInfo.messageId && highlightInfo.query) {
        var selected = transcript.querySelector('[data-entry-id="' + cssEscape(highlightInfo.messageId) + '"] .chat-content');
        if (selected) {
          var matchingEntry = latestState.transcript.find(function (entry) {
            return entry && entry.id === highlightInfo.messageId;
          });
          renderMarkdownContentWithHighlight(selected, matchingEntry ? matchingEntry.content : '', highlightInfo.query, highlightInfo.matchIndex);
          var mark = selected.querySelector('mark.search-highlight-active') || selected.querySelector('mark.search-highlight');
          if (mark && typeof mark.scrollIntoView === 'function') {
            mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      }
    },
  };
})();

// --- Search navigation and highlighting ---
let searchResults = [];
let currentSearchIndex = 0;
let lastSearchQuery = '';

function clearSearchHighlights() {
  var bridge = window.__atlasChatSearchBridge;
  var transcriptElement = bridge && bridge.getTranscriptElement ? bridge.getTranscriptElement() : undefined;
  if (!transcriptElement) {
    return;
  }

  var selectedMessages = transcriptElement.querySelectorAll('.chat-message.selected-message');
  selectedMessages.forEach(function (messageNode) {
    messageNode.classList.remove('selected-message');
  });

  var marks = transcriptElement.querySelectorAll('mark.search-highlight, mark.search-highlight-active');
  marks.forEach(function (mark) {
    var parent = mark.parentNode;
    if (!parent) {
      return;
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
}

function collectSearchMatches(query) {
  var matches = [];
  var safeQuery = String(query || '').trim();
  var bridge = window.__atlasChatSearchBridge;
  var transcriptElement = bridge && bridge.getTranscriptElement ? bridge.getTranscriptElement() : undefined;
  if (!safeQuery || !transcriptElement) {
    return matches;
  }

  var matcher = new RegExp(escapeRegExp(safeQuery), 'gi');
  var contentNodes = transcriptElement.querySelectorAll('.chat-message[data-entry-id] .chat-content');
  contentNodes.forEach(function (container) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node || !node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        var parentName = node.parentNode && node.parentNode.nodeName;
        if (parentName === 'SCRIPT' || parentName === 'STYLE' || parentName === 'MARK') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    var textNodes = [];
    var current;
    while ((current = walker.nextNode())) {
      textNodes.push(current);
    }

    textNodes.forEach(function (node) {
      var text = node.nodeValue || '';
      matcher.lastIndex = 0;
      if (!matcher.test(text)) {
        return;
      }

      matcher.lastIndex = 0;
      var fragment = document.createDocumentFragment();
      var lastIndex = 0;
      var result;
      while ((result = matcher.exec(text)) !== null) {
        if (result.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, result.index)));
        }
        var mark = document.createElement('mark');
        mark.className = 'search-highlight';
        mark.textContent = result[0];
        fragment.appendChild(mark);
        matches.push(mark);
        lastIndex = result.index + result[0].length;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      if (node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
      }
    });
  });

  return matches;
}

function centerSearchResult(mark) {
  if (!mark) {
    return;
  }

  var bridge = window.__atlasChatSearchBridge;
  var transcriptElement = bridge && bridge.getTranscriptElement ? bridge.getTranscriptElement() : undefined;
  if (!transcriptElement) {
    return;
  }

  var messageNode = typeof mark.closest === 'function' ? mark.closest('.chat-message') : undefined;
  if (messageNode && messageNode.classList) {
    var previousSelected = transcriptElement.querySelectorAll('.chat-message.selected-message');
    previousSelected.forEach(function (node) {
      if (node !== messageNode) {
        node.classList.remove('selected-message');
      }
    });
    messageNode.classList.add('selected-message');
  }

  var transcriptRect = transcriptElement.getBoundingClientRect();
  var markRect = mark.getBoundingClientRect();
  var nextTop = transcriptElement.scrollTop + (markRect.top - transcriptRect.top) - (transcriptElement.clientHeight / 2) + (markRect.height / 2);
  transcriptElement.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
}

function renderTranscriptWithSearch() {
  var bridge = window.__atlasChatSearchBridge;
  if (!bridge || !bridge.getIsSearchMode || !bridge.getIsSearchMode()) {
    return;
  }

  var searchBtn = document.getElementById('searchButton');
  var prevBtn = document.getElementById('searchPrevBtn');
  var nextBtn = document.getElementById('searchNextBtn');

  searchResults.forEach(function (mark) {
    if (mark && mark.classList) {
      mark.classList.remove('search-highlight-active');
    }
  });

  var activeMark = searchResults.length > 0 ? searchResults[currentSearchIndex] : undefined;
  if (activeMark && activeMark.classList) {
    activeMark.classList.add('search-highlight-active');
    centerSearchResult(activeMark);
  }

  if (searchBtn) {
    searchBtn.disabled = false;
    searchBtn.textContent = searchResults.length > 0
      ? 'Search (' + (currentSearchIndex + 1) + '/' + searchResults.length + ')'
      : 'Search';
  }
  if (prevBtn) {
    prevBtn.classList.toggle('hidden', searchResults.length <= 1);
    prevBtn.disabled = searchResults.length <= 1;
  }
  if (nextBtn) {
    nextBtn.classList.toggle('hidden', searchResults.length <= 1);
    nextBtn.disabled = searchResults.length <= 1;
  }

  var statusElement = bridge && bridge.getStatusElement ? bridge.getStatusElement() : document.getElementById('status');
  if (statusElement && lastSearchQuery) {
    statusElement.textContent = searchResults.length > 0
      ? 'Showing result ' + (currentSearchIndex + 1) + ' of ' + searchResults.length + ' for "' + lastSearchQuery + '".'
      : 'No matches found for "' + lastSearchQuery + '".';
  }
}

window.addEventListener('message', function (event) {
  var message = event.data;
  if (!message || message.type !== 'searchResults') {
    return;
  }

  clearSearchHighlights();
  searchResults = collectSearchMatches(lastSearchQuery);
  currentSearchIndex = 0;
  renderTranscriptWithSearch();
});

function renderMarkdownContentWithHighlight(container, value, query, activeMatchIndex) {
  renderMarkdownContent(container, value || '');
  if (!query) {
    return;
  }

  var matches = collectSearchMatches(query);
  if (matches[activeMatchIndex]) {
    matches[activeMatchIndex].classList.add('search-highlight-active');
  }
}

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

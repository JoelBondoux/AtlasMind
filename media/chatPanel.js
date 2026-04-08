// @ts-nocheck
// Chat panel webview script — loaded as an external file to avoid
// template-literal escaping issues with inline <script> blocks.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const sessionList = document.getElementById('sessionList');
  const runList = document.getElementById('runList');
  const runSectionLabel = document.getElementById('runSectionLabel');
  const pendingApprovals = document.getElementById('pendingApprovals');
  const transcript = document.getElementById('transcript');
  const runInspector = document.getElementById('runInspector');
  const promptInput = document.getElementById('promptInput');
  const status = document.getElementById('status');
  const sendPrompt = document.getElementById('sendPrompt');
  const stopPrompt = document.getElementById('stopPrompt');
  const sendMode = document.getElementById('sendMode');
  const attachFiles = document.getElementById('attachFiles');
  const attachOpenFiles = document.getElementById('attachOpenFiles');
  const clearAttachments = document.getElementById('clearAttachments');
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
  const wideLayoutQuery = window.matchMedia('(min-width: 1000px)');
  const persistedUiState = vscode.getState() || {};
  const MIN_CHAT_FONT_SCALE = 0.70;
  const MAX_CHAT_FONT_SCALE = 1.3;
  const CHAT_FONT_SCALE_STEP = 0.05;
  const PROMPT_HISTORY_LIMIT = 50;
  let latestState = undefined;
  let isBusy = false;
  let chatFontScale = normalizeChatFontScale(persistedUiState.chatFontScale);
  let narrowSessionDrawerOpen = persistedUiState.narrowSessionDrawerOpen !== false;
  let wideSessionRailCollapsed = Boolean(persistedUiState.wideSessionRailCollapsed);
  let promptHistory = Array.isArray(persistedUiState.promptHistory)
    ? persistedUiState.promptHistory.filter(function (entry) {
      return typeof entry === 'string' && entry.trim().length > 0;
    }).slice(-PROMPT_HISTORY_LIMIT)
    : [];
  let promptHistoryIndex = null;
  let promptHistoryDraft = '';
  let suppressPromptHistoryReset = false;
  let composerFocusRestoreHandle = null;
  let pendingRunReviewFlyoutOpen = Boolean(persistedUiState.pendingRunReviewFlyoutOpen);

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
      pendingRunReviewFlyoutOpen: pendingRunReviewFlyoutOpen,
      promptHistory: promptHistory.slice(-PROMPT_HISTORY_LIMIT),
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

  function applyResponsiveLayout() {
    var isWide = Boolean(wideLayoutQuery.matches);
    if (chatShell) {
      chatShell.setAttribute('data-layout', isWide ? 'wide' : 'narrow');
      chatShell.setAttribute('data-session-rail', isWide && wideSessionRailCollapsed ? 'collapsed' : 'open');
    }
    if (isWide) {
      sessionDrawer.classList.toggle('open', !wideSessionRailCollapsed);
      sessionToggle.setAttribute('aria-expanded', String(!wideSessionRailCollapsed));
      sessionDrawer.setAttribute('aria-hidden', String(wideSessionRailCollapsed));
      return;
    }

    sessionDrawer.classList.toggle('open', narrowSessionDrawerOpen);
    sessionToggle.setAttribute('aria-expanded', String(narrowSessionDrawerOpen));
    sessionDrawer.setAttribute('aria-hidden', String(!narrowSessionDrawerOpen));
  }

  // Sessions drawer toggle
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

  if (typeof wideLayoutQuery.addEventListener === 'function') {
    wideLayoutQuery.addEventListener('change', applyResponsiveLayout);
  } else if (typeof wideLayoutQuery.addListener === 'function') {
    wideLayoutQuery.addListener(applyResponsiveLayout);
  }
  applyResponsiveLayout();
  applyChatFontScale();

  decreaseFontSize.addEventListener('click', function () {
    adjustChatFontScale(-1);
  });
  increaseFontSize.addEventListener('click', function () {
    adjustChatFontScale(1);
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
    if (runSectionLabel) {
      runSectionLabel.classList.toggle('hidden', !hasRuns);
    }
    runList.classList.toggle('hidden', !hasRuns);
    if (!Array.isArray(runs) || runs.length === 0) {
      return;
    }

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
      chip.className = 'chip';
      const label = document.createElement('span');
      label.textContent = attachment.label + ' [' + attachment.kind + ']';
      chip.appendChild(label);
      const remove = document.createElement('button');
      remove.textContent = '\u00d7';
      remove.title = 'Remove attachment';
      remove.addEventListener('click', function () {
        vscode.postMessage({ type: 'removeAttachment', payload: attachment.id });
      });
      chip.appendChild(remove);
      attachmentList.appendChild(chip);
    }
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

  function collectDroppedItems(event) {
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
    if (plainText) {
      var ptLines = plainText.split(/\r?\n/);
      for (var j = 0; j < ptLines.length; j++) {
        var ptTrimmed = ptLines[j].trim();
        if (ptTrimmed) {
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

  async function collectImportedItemsFromTransfer(dataTransfer) {
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

    var rawDroppedItems = collectDroppedItems({ dataTransfer: dataTransfer });
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

  function submitPrompt(modeOverride) {
    var effectiveMode = typeof modeOverride === 'string' ? modeOverride : sendMode.value;
    if (!canSubmitPromptWithMode(effectiveMode)) {
      return;
    }
    var prompt = promptInput.value;
    vscode.postMessage({ type: 'submitPrompt', payload: { prompt: prompt, mode: effectiveMode } });
    recordPromptHistory(prompt);
    promptInput.value = '';
    resetPromptHistoryNavigation('');
    focusPromptInputAtEnd();
  }

  function focusPromptInputAtEnd() {
    if (!promptInput || promptInput.disabled) {
      return;
    }
    if (latestState && latestState.activeSurface === 'run') {
      return;
    }
    promptInput.focus();
    if (typeof promptInput.setSelectionRange === 'function') {
      var cursor = promptInput.value.length;
      promptInput.setSelectionRange(cursor, cursor);
    }
  }

  function scheduleComposerFocusRestore() {
    if (!promptInput || promptInput.disabled) {
      return;
    }
    if (latestState && latestState.activeSurface === 'run') {
      return;
    }
    if (composerFocusRestoreHandle !== null) {
      clearTimeout(composerFocusRestoreHandle);
    }
    composerFocusRestoreHandle = window.setTimeout(function () {
      composerFocusRestoreHandle = null;
      focusPromptInputAtEnd();
    }, 0);
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
      title.textContent = 'Tool approval required';
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

      var meta = document.createElement('div');
      meta.className = 'approval-meta';
      meta.textContent = 'Category: ' + request.category + ' • Task: ' + request.taskId;
      card.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'approval-actions';
      actions.appendChild(createApprovalButton('Allow Once', request.id, 'allow-once'));
      actions.appendChild(createApprovalButton('Bypass Approvals', request.id, 'bypass-task'));
      actions.appendChild(createApprovalButton('Autopilot', request.id, 'autopilot'));
      actions.appendChild(createApprovalButton('Deny', request.id, 'deny', 'danger'));
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
      scheduleComposerFocusRestore();
    });
    return button;
  }

  function renderTranscript(entries, busy, selectedMessageId, runs, selectedRun) {
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

    entries.forEach(function (entry, index) {
      var item = document.createElement('div');
      item.className = 'chat-message ' + (entry.role === 'user' ? 'user' : 'assistant');
      if (entry.id) {
        item.setAttribute('data-entry-id', entry.id);
      }
      if (selectedMessageId && entry.id === selectedMessageId) {
        item.classList.add('selected-message');
      }
      var showThinking = busy && entry.role === 'assistant' && index === lastAssistantIndex;
      if (showThinking) {
        item.classList.add('pending');
      }

      var header = document.createElement('div');
      header.className = 'chat-message-header';

      var role = document.createElement('div');
      role.className = 'chat-role';
      role.textContent = entry.role === 'user' ? 'You' : 'AtlasMind';

      header.appendChild(role);

      if (entry.role === 'assistant' && entry.meta && entry.meta.modelUsed) {
        var badge = document.createElement('div');
        badge.className = 'chat-model-badge';
        badge.textContent = entry.meta.modelUsed;
        header.appendChild(badge);
      }

      var content = document.createElement('div');
      content.className = 'chat-content';
      renderMarkdownContent(content, entry.content || (showThinking ? '' : (entry.role === 'assistant' ? '\u2026' : '')));

      item.appendChild(header);
      if (content.childNodes.length > 0) {
        item.appendChild(content);
      }

      var linkedRuns = entry.id ? (runsByMessageId.get(entry.id) || []) : [];
      if (entry.role === 'assistant' && (entry.id || (entry.meta && entry.meta.thoughtSummary))) {
        item.appendChild(renderAssistantFooter(entry, linkedRuns, selectedRun));
      }

      if (entry.role === 'assistant' && selectedRun && entry.id && selectedRun.chatMessageId === entry.id) {
        item.appendChild(renderRunReviewBubble(selectedRun));
      }

      if (showThinking) {
        item.appendChild(renderThinkingIndicator(Boolean(entry.content)));
      }

      transcript.appendChild(item);
    });

    if (selectedMessageId) {
      var selected = transcript.querySelector('[data-entry-id="' + cssEscape(selectedMessageId) + '"]');
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    transcript.scrollTop = transcript.scrollHeight;
  }

  function renderAssistantFooter(entry, linkedRuns, selectedRun) {
    var footer = document.createElement('div');
    footer.className = 'assistant-footer';

    if (entry.meta && entry.meta.thoughtSummary) {
      var thoughtSummary = renderThoughtSummary(entry.meta.thoughtSummary);
      thoughtSummary.classList.add('assistant-footer-thought');
      footer.appendChild(thoughtSummary);
    }

    if (entry.id) {
      footer.appendChild(renderAssistantActions(entry));
    }

    if (Array.isArray(linkedRuns) && linkedRuns.length > 0) {
      footer.appendChild(renderRunReviewLinks(linkedRuns, selectedRun));
    }

    if (entry.meta && entry.meta.followupQuestion && Array.isArray(entry.meta.suggestedFollowups) && entry.meta.suggestedFollowups.length > 0) {
      footer.appendChild(renderAssistantFollowups(entry.meta.followupQuestion, entry.meta.suggestedFollowups));
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function renderAssistantActions(entry) {
    var actions = document.createElement('div');
    actions.className = 'chat-message-actions';

    var currentVote = entry.meta && entry.meta.userVote ? entry.meta.userVote : undefined;
    actions.appendChild(createVoteButton(entry.id, 'up', currentVote === 'up'));
    actions.appendChild(createVoteButton(entry.id, 'down', currentVote === 'down'));
    return actions;
  }

  function renderAssistantFollowups(question, followups) {
    var wrapper = document.createElement('div');
    wrapper.className = 'assistant-followups';

    var prompt = document.createElement('div');
    prompt.className = 'assistant-followup-question';
    prompt.textContent = question;
    wrapper.appendChild(prompt);

    var row = document.createElement('div');
    row.className = 'assistant-followup-row';
    for (var i = 0; i < followups.length; i += 1) {
      var followup = followups[i];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'assistant-followup-chip';
      button.textContent = followup.label;
      button.addEventListener('click', function (selectedFollowup) {
        return function () {
          vscode.postMessage({
            type: 'submitPrompt',
            payload: {
              prompt: selectedFollowup.prompt,
              mode: selectedFollowup.mode || 'send',
            },
          });
        };
      }(followup));
      row.appendChild(button);
    }

    wrapper.appendChild(row);
    return wrapper;
  }

  function renderMarkdownContent(container, value) {
    container.innerHTML = '';
    var markdown = typeof value === 'string' ? value : '';
    if (!markdown) {
      return;
    }

    var normalized = markdown.replace(/\r\n/g, '\n');
    var blocks = normalized.split(/\n{2,}/);
    for (var index = 0; index < blocks.length; index += 1) {
      var block = blocks[index].trim();
      if (!block) {
        continue;
      }

      if (/^```/.test(block)) {
        container.appendChild(renderCodeFence(block));
        continue;
      }

      if (/^#{1,6}\s+/.test(block)) {
        container.appendChild(renderHeading(block));
        continue;
      }

      if (isListBlock(block)) {
        container.appendChild(renderList(block));
        continue;
      }

      if (/^>\s?/.test(block)) {
        container.appendChild(renderBlockquote(block));
        continue;
      }

      if (/^_Thinking:.*_$/.test(block)) {
        container.appendChild(renderThinkingNote(block));
        continue;
      }

      if (/^---+$/.test(block)) {
        container.appendChild(document.createElement('hr'));
        continue;
      }

      container.appendChild(renderParagraph(block));
    }
  }

  function renderCodeFence(block) {
    var lines = block.split('\n');
    var firstLine = lines[0];
    var language = firstLine.replace(/^```\s*/, '').trim();
    var code = lines.slice(1);
    if (code.length > 0 && /^```\s*$/.test(code[code.length - 1])) {
      code.pop();
    }

    var pre = document.createElement('pre');
    var codeEl = document.createElement('code');
    if (language) {
      codeEl.setAttribute('data-lang', language);
    }
    codeEl.textContent = code.join('\n');
    pre.appendChild(codeEl);
    return pre;
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
    details.className = 'thought-details';

    var summary = document.createElement('summary');
    summary.textContent = thoughtSummary.label || 'Thinking summary';
    details.appendChild(summary);

    if (thoughtSummary.summary) {
      var summaryText = document.createElement('p');
      summaryText.className = 'thought-summary';
      summaryText.textContent = thoughtSummary.summary;
      details.appendChild(summaryText);
    }

    if (Array.isArray(thoughtSummary.bullets) && thoughtSummary.bullets.length > 0) {
      var list = document.createElement('ul');
      list.className = 'thought-list';
      for (var i = 0; i < thoughtSummary.bullets.length; i++) {
        var item = document.createElement('li');
        item.textContent = thoughtSummary.bullets[i];
        list.appendChild(item);
      }
      details.appendChild(list);
    }

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
              : 'Enter sends with the selected mode. Shift+Enter starts a new chat thread. Ctrl/Cmd+Enter sends as Steer. Alt+Enter adds a newline. Up and Down recall recent prompts at the start or end of the composer. Use aliases like @tps, @tpowershell, @tpwsh, @tgit, @tbash, or @tcmd to launch a managed terminal run.';
  });

  promptInput.addEventListener('input', function () {
    if (suppressPromptHistoryReset) {
      return;
    }
    resetPromptHistoryNavigation(promptInput.value);
  });

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
  sendMode.addEventListener('change', function () {
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
    var importedItems = await collectImportedItemsFromTransfer(event.clipboardData);
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
      if (typeof state.composerDraft === 'string' && state.composerDraft.length > 0) {
        promptInput.value = state.composerDraft;
        resetPromptHistoryNavigation(state.composerDraft);
        if (typeof state.composerMode === 'string' && state.composerMode.length > 0) {
          sendMode.value = state.composerMode;
        }
        status.textContent = 'Loaded a Project Dashboard prompt. Review it, then send when ready.';
        focusPromptInputAtEnd();
      }
      var standaloneRuns = renderSessions(state.sessions, state.selectedSessionId, state.projectRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderRuns(standaloneRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderPendingApprovals(state.pendingToolApprovals);
      renderPendingRunReview(state.pendingRunReview, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderAttachments(state.attachments);
      renderOpenFiles(state.openFiles);

      var isRun = state.activeSurface === 'run';
      transcript.classList.toggle('hidden', isRun);
      runInspector.classList.toggle('hidden', !isRun);
      updateComposerAvailability();
      clearConversation.disabled = isRun;
      panelTitle.textContent = isRun
        ? (state.selectedRun ? state.selectedRun.goal : 'Autonomous Run')
        : ((state.sessions || []).find(function (s) { return s.id === state.selectedSessionId; }) || {}).title || 'AtlasMind Chat';
      panelSubtitle.textContent = isRun
        ? 'Inspect live sub-agent activity here, then open the Project Run Center to pause, approve, or resume batches.'
        : 'Persistent workspace chat threads with direct access to recent autonomous runs.';
      composerHint.textContent = isRun
        ? 'Composer disabled while viewing a run session. Switch back to a chat thread to send a prompt.'
        : isBusy
          ? 'AtlasMind is still responding. Switch send mode to Steer to interrupt and redirect the current request, or use Stop to cancel it. Up and Down recall recent prompts at the start or end of the composer when idle.'
            : 'Enter or Ctrl/Cmd+Enter sends with the selected mode. Shift+Enter or Alt+Enter adds a newline. Up and Down recall recent prompts at the start or end of the composer. Use aliases like @tps, @tpowershell, @tpwsh, @tgit, @tbash, or @tcmd to launch a managed terminal run.';

      if (isRun) {
        renderRunInspector(state.selectedRun);
      } else {
        renderTranscript(state.transcript, isBusy, state.selectedMessageId, state.projectRuns, state.selectedRun);
        if (!isBusy) {
          scheduleComposerFocusRestore();
        }
      }
      return;
    }

    if (message.type === 'status') {
      status.textContent = typeof message.payload === 'string' ? message.payload : '';
      return;
    }

    if (message.type === 'busy') {
      var busy = Boolean(message.payload);
      isBusy = busy;
      if (latestState && latestState.activeSurface !== 'run') {
        renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId, latestState.projectRuns, latestState.selectedRun);
      }
      updateComposerAvailability();
      if (!busy) {
        scheduleComposerFocusRestore();
      }
    }
  });
})();

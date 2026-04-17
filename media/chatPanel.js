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
  const recoveryNotice = document.getElementById('recoveryNotice');
  const recoveryNoticeTitle = document.getElementById('recoveryNoticeTitle');
  const recoveryNoticeSummary = document.getElementById('recoveryNoticeSummary');
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
  let latestState = undefined;
  let isBusy = false;
  let queuedComposerMode = undefined;
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
  let userScrolledUp = false;
  let lastRenderedSessionId = undefined;
  let pendingRunReviewFlyoutOpen = Boolean(persistedUiState.pendingRunReviewFlyoutOpen);
  let assistantFollowupSelections = normalizeFollowupSelections(persistedUiState.assistantFollowupSelections);

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
    vscode.postMessage({ type: 'saveFontScale', payload: chatFontScale });
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
      queuedComposerMode = isBusy ? undefined : nextMode;
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
    if (sendMode.value !== nextMode) {
      sendMode.value = nextMode;
    }
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

<<<<<<< HEAD
    // If a one-shot is still queued and we're idle, keep the select showing it
    if (!isBusy && queuedComposerMode && isOneShotComposerMode(queuedComposerMode)) {
      if (sendMode.value !== queuedComposerMode) {
        sendMode.value = queuedComposerMode;
      }
      return;
    }

=======
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
    if (sendMode.value !== nextMode) {
      sendMode.value = nextMode;
    }
  }
    if (isOneShotComposerMode(nextMode)) {
      queuedComposerMode = isBusy ? undefined : nextMode;
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

  function submitPrompt(modeOverride) {
    var effectiveMode = typeof modeOverride === 'string'
      ? modeOverride
      : (queuedComposerMode || sendMode.value || getStatusDrivenComposerMode());
    if (isBusy && effectiveMode !== 'steer') {
      effectiveMode = 'steer';
    }
    if (!canSubmitPromptWithMode(effectiveMode)) {
      return;
    }
    var prompt = promptInput.value;
    userScrolledUp = false;
    vscode.postMessage({ type: 'submitPrompt', payload: { prompt: prompt, mode: effectiveMode } });
    recordPromptHistory(prompt);
    promptInput.value = '';
    queuedComposerMode = undefined;
    applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: true });
    updateComposerAvailability();
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
      var active = document.activeElement;
      if (active && active !== promptInput) {
        var tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') {
          return;
        }
      }
      focusPromptInputAtEnd();
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

    if (latestAssistantEntry && latestAssistantEntry.meta && Array.isArray(latestAssistantEntry.meta.suggestedFollowups) && latestAssistantEntry.meta.suggestedFollowups.length > 0) {
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

<<<<<<< HEAD
  function renderStreamingThought(lines) {
    if (!lines || !lines.trim()) {
      return null;
    }
    var lineArray = lines.split('\n').filter(function (l) { return l.trim().length > 0; });
    if (lineArray.length === 0) {
      return null;
    }
    var details = document.createElement('details');
    details.className = 'streaming-thought-details thought-details transcript-disclosure';
    details.open = true;

    var summary = createDisclosureSummary('Working…', lineArray[lineArray.length - 1].slice(0, 64));
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'transcript-disclosure-body';
    var list = document.createElement('ul');
    list.className = 'streaming-thought-list thought-list';
    for (var i = 0; i < lineArray.length; i += 1) {
      var li = document.createElement('li');
      li.textContent = lineArray[i];
      list.appendChild(li);
    }
    body.appendChild(list);
    details.appendChild(body);
    return details;
  }

  function renderTranscript(entries, busy, selectedMessageId, runs, selectedRun, busyAssistantMessageId) {
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
  function renderTranscript(entries, busy, selectedMessageId, runs, selectedRun, busyAssistantMessageId) {
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

      if (entry.role === 'assistant' && entry.meta && entry.meta.modelUsed) {
        var badge = document.createElement('div');
        badge.className = 'chat-model-badge';
        badge.textContent = entry.meta.modelUsed;
        if (entry.meta.modelUsed === 'multiple routed models' && sessionModels.length > 0) {
          badge.title = 'Models used in this session:\n' + sessionModels.join('\n');
          badge.style.cursor = 'help';
        }
        header.appendChild(badge);
      }

      var content = document.createElement('div');
      content.className = 'chat-content';
      renderMarkdownContent(content, entry.content || (showThinking ? '' : (entry.role === 'assistant' ? '\u2026' : '')));

      item.appendChild(header);
      if (content.childNodes.length > 0) {
        item.appendChild(content);
      }

      var messageAttachments = renderMessageAttachments(entry);
      if (messageAttachments) {
        item.appendChild(messageAttachments);
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

    if (selectedMessageId) {
      var selected = transcript.querySelector('[data-entry-id="' + cssEscape(selectedMessageId) + '"]');
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    if (!userScrolledUp) {
      transcript.scrollTop = transcript.scrollHeight;
    }
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
      actions.appendChild(renderIterationLimitActions(entry.id));
    }
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
    if (entry.meta && entry.meta.followupQuestion && Array.isArray(entry.meta.suggestedFollowups) && entry.meta.suggestedFollowups.length > 0) {
      actions.appendChild(renderAssistantFollowupControls(entry.id, entry.meta.followupQuestion, entry.meta.suggestedFollowups));
    }

    var currentVote = entry.meta && entry.meta.userVote ? entry.meta.userVote : undefined;
    actions.appendChild(createVoteButton(entry.id, 'up', currentVote === 'up'));
    actions.appendChild(createVoteButton(entry.id, 'down', currentVote === 'down'));
    return actions;
  }

<<<<<<< HEAD
  function renderIterationLimitActions(entryId) {
    var wrapper = document.createElement('div');
    wrapper.className = 'iteration-limit-actions';

    var continueBtn = document.createElement('button');
    continueBtn.type = 'button';
    continueBtn.className = 'iteration-limit-continue';
    continueBtn.textContent = 'Continue';
    continueBtn.title = 'Continue execution from where AtlasMind stopped';
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

=======
  function renderAssistantFollowupControls(entryId, question, followups) {
    var wrapper = document.createElement('div');
    wrapper.className = 'assistant-followup-controls';
    wrapper.title = question || 'Choose how AtlasMind should continue';
    wrapper.setAttribute('aria-label', question || 'Choose how AtlasMind should continue');

>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
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
            function renderIterationLimitActions(entryId) {
              var wrapper = document.createElement('div');
              wrapper.className = 'iteration-limit-actions';

              var continueBtn = document.createElement('button');
              continueBtn.type = 'button';
              continueBtn.className = 'iteration-limit-continue';
              continueBtn.textContent = 'Continue';
              continueBtn.title = 'Continue execution from where AtlasMind stopped';
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
          function renderIterationLimitActions(entryId) {
            var wrapper = document.createElement('div');
            wrapper.className = 'iteration-limit-actions';

            var continueBtn = document.createElement('button');
            continueBtn.type = 'button';
            continueBtn.className = 'iteration-limit-continue';
            continueBtn.textContent = 'Continue';
            continueBtn.title = 'Continue execution from where AtlasMind stopped';
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

  function renderCodeFence(block) {
    var lines = block.split('\n');
    var firstLine = lines[0];
    var language = firstLine.replace(/^```\s*/, '').trim();
    var code = lines.slice(1);
    if (code.length > 0 && /^```\s*$/.test(code[code.length - 1])) {
      code.pop();
    }

    var wrapper = document.createElement('div');
    wrapper.className = 'chat-code-block';

    if (language) {
      var header = document.createElement('div');
      header.className = 'chat-code-block-header';
      header.textContent = language;
      wrapper.appendChild(header);
    }

    var pre = document.createElement('pre');
    var codeEl = document.createElement('code');
    if (language) {
      codeEl.setAttribute('data-lang', language);
    }
    codeEl.textContent = code.join('\n');
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

  transcript.addEventListener('scroll', function () {
    var distFromBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    userScrolledUp = distFromBottom > 80;
  });

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
      latestState = state;
      isBusy = Boolean(state.busy);
      if (typeof state.chatFontScale === 'number' && state.chatFontScale !== chatFontScale) {
        chatFontScale = normalizeChatFontScale(state.chatFontScale);
        applyChatFontScale();
        persistUiState();
      }
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
      if (typeof state.composerMode === 'string' && state.composerMode.length > 0) {
        applyComposerModePreference(state.composerMode, { clearQueuedMode: false });
      } else {
        applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: false });
      }
      if (typeof state.composerDraft === 'string' && state.composerDraft.length > 0) {
        promptInput.value = state.composerDraft;
        resetPromptHistoryNavigation(state.composerDraft);
        status.textContent = 'Loaded a Project Dashboard prompt. Review it, then send when ready.';
        focusPromptInputAtEnd();
      }
      var standaloneRuns = renderSessions(state.sessions, state.selectedSessionId, state.projectRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderRuns(standaloneRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderPendingApprovals(state.pendingToolApprovals);
      renderPendingRunReview(state.pendingRunReview, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderAttachments(state.attachments);
      renderOpenFiles(state.openFiles);
      renderRecoveryNotice(state.recoveryNotice);

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
      setComposerHintContent(isRun ? 'run' : (isBusy ? 'busy' : 'idle'));

      if (isRun) {
        renderRunInspector(state.selectedRun);
      } else {
        if (lastRenderedSessionId !== state.selectedSessionId) {
          lastRenderedSessionId = state.selectedSessionId;
          userScrolledUp = false;
        }
        renderTranscript(state.transcript, isBusy, state.selectedMessageId, state.projectRuns, state.selectedRun, state.busyAssistantMessageId, state.streamingThought);
        renderTranscript(state.transcript, isBusy, state.selectedMessageId, state.projectRuns, state.selectedRun, state.busyAssistantMessageId);
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
        if (!isBusy) {
          scheduleComposerFocusRestore();
        }
      }
      return;
    }
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
        focusPromptInputAtEnd();
      }
      var standaloneRuns = renderSessions(state.sessions, state.selectedSessionId, state.projectRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderRuns(standaloneRuns, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderPendingApprovals(state.pendingToolApprovals);
      renderPendingRunReview(state.pendingRunReview, state.selectedRunId || (state.selectedRun ? state.selectedRun.id : undefined));
      renderAttachments(state.attachments);
      renderOpenFiles(state.openFiles);
      renderRecoveryNotice(state.recoveryNotice);
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
      setComposerHintContent(isRun ? 'run' : (isBusy ? 'busy' : 'idle'));
      if (isRun) {
        renderRunInspector(state.selectedRun);
      } else {
        if (lastRenderedSessionId !== state.selectedSessionId) {
          lastRenderedSessionId = state.selectedSessionId;
          userScrolledUp = false;
        }
        renderTranscript(state.transcript, isBusy, state.selectedMessageId, state.projectRuns, state.selectedRun, state.busyAssistantMessageId, state.streamingThought);
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
      var busy = Boolean(typeof busyPayload === 'object' && busyPayload !== null ? busyPayload.busy : busyPayload);
      var busySessionId = typeof busyPayload === 'object' && busyPayload !== null && typeof busyPayload.sessionId === 'string'
        ? busyPayload.sessionId
        : (latestState && typeof latestState.busySessionId === 'string' ? latestState.busySessionId : undefined);
      isBusy = busy && (!latestState || !busySessionId || latestState.selectedSessionId === busySessionId);
      applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: true });
      if (latestState && latestState.activeSurface !== 'run') {
  renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId, latestState.projectRuns, latestState.selectedRun, latestState.busyAssistantMessageId, latestState.streamingThought);
        renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId, latestState.projectRuns, latestState.selectedRun, latestState.busyAssistantMessageId);
>>>>>>> 3ef5f5a0deb5c668b775a31473176b4b9f96f3fa
      }
      updateComposerAvailability();
      if (latestState) {
        setComposerHintContent(latestState.activeSurface === 'run' ? 'run' : (busy ? 'busy' : 'idle'));
      }
      if (!busy) {
        scheduleComposerFocusRestore();
      var busyPayload = message.payload;
      var busy = Boolean(typeof busyPayload === 'object' && busyPayload !== null ? busyPayload.busy : busyPayload);
      var busySessionId = typeof busyPayload === 'object' && busyPayload !== null && typeof busyPayload.sessionId === 'string'
        ? busyPayload.sessionId
        : (latestState && typeof latestState.busySessionId === 'string' ? latestState.busySessionId : undefined);
      isBusy = busy && (!latestState || !busySessionId || latestState.selectedSessionId === busySessionId);
      applyComposerModePreference(getStatusDrivenComposerMode(), { clearQueuedMode: true });
      if (latestState && latestState.activeSurface !== 'run') {
        renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId, latestState.projectRuns, latestState.selectedRun, latestState.busyAssistantMessageId, latestState.streamingThought);
      }
      updateComposerAvailability();
      if (latestState) {
        setComposerHintContent(latestState.activeSurface === 'run' ? 'run' : (busy ? 'busy' : 'idle'));
      }
      if (!busy) {
        scheduleComposerFocusRestore();
      }
    }
  });
})();

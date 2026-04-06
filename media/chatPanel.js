// @ts-nocheck
// Chat panel webview script — loaded as an external file to avoid
// template-literal escaping issues with inline <script> blocks.
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const sessionList = document.getElementById('sessionList');
  const runList = document.getElementById('runList');
  const transcript = document.getElementById('transcript');
  const runInspector = document.getElementById('runInspector');
  const promptInput = document.getElementById('promptInput');
  const status = document.getElementById('status');
  const sendPrompt = document.getElementById('sendPrompt');
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
  const sessionToggle = document.getElementById('sessionToggle');
  const sessionDrawer = document.getElementById('sessionDrawer');
  const sessionCountBadge = document.getElementById('sessionCount');
  let latestState = undefined;
  let isBusy = false;

  // Sessions drawer toggle
  sessionToggle.addEventListener('click', function () {
    var isOpen = sessionDrawer.classList.toggle('open');
    sessionToggle.setAttribute('aria-expanded', String(isOpen));
    sessionDrawer.setAttribute('aria-hidden', String(!isOpen));
  });

  function renderSessions(sessions, selectedSessionId) {
    var count = Array.isArray(sessions) ? sessions.length : 0;
    sessionCountBadge.textContent = String(count);
    sessionList.innerHTML = '';
    if (!Array.isArray(sessions) || sessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No chat sessions yet. Create one to start working.';
      sessionList.appendChild(empty);
      return;
    }

    for (const session of sessions) {
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
      const remove = document.createElement('button');
      remove.textContent = 'Delete';
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        vscode.postMessage({ type: 'deleteSession', payload: session.id });
      });
      actions.appendChild(remove);

      button.appendChild(title);
      button.appendChild(meta);
      button.appendChild(preview);
      button.appendChild(actions);
      button.addEventListener('click', function () {
        vscode.postMessage({ type: 'selectSession', payload: session.id });
      });
      sessionList.appendChild(button);
    }
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

  function renderRuns(runs, selectedRunId) {
    runList.innerHTML = '';
    if (!Array.isArray(runs) || runs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No autonomous runs recorded yet.';
      runList.appendChild(empty);
      return;
    }

    for (const run of runs) {
      const button = document.createElement('button');
      button.className = 'session-item' + (run.id === selectedRunId ? ' active' : '');
      button.dataset.runId = run.id;

      const title = document.createElement('div');
      title.className = 'session-item-title';
      title.textContent = run.goal;

      const meta = document.createElement('div');
      meta.className = 'session-meta';
      meta.textContent = describeRun(run) + ' \u2022 ' + run.completedSubtaskCount + '/' + run.totalSubtaskCount;

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

  function setDropState(enabled) {
    dropHint.classList.toggle('dragover', enabled);
    composerShell.classList.toggle('dragover', enabled);
  }

  function setComposerAvailability(options) {
    options = options || {};
    var disabled = Boolean(options.disabled);
    promptInput.disabled = disabled;
    sendPrompt.disabled = disabled;
    sendMode.disabled = disabled;
    attachFiles.disabled = disabled;
    attachOpenFiles.disabled = disabled;
    clearAttachments.disabled = disabled;
  }

  function submitPrompt() {
    if (sendPrompt.disabled) {
      return;
    }
    vscode.postMessage({ type: 'submitPrompt', payload: { prompt: promptInput.value, mode: sendMode.value } });
    promptInput.value = '';
    promptInput.focus();
  }

  function renderTranscript(entries, busy, selectedMessageId) {
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
      content.textContent = entry.content || (showThinking ? '' : (entry.role === 'assistant' ? '\u2026' : ''));

      item.appendChild(header);
      if (content.textContent) {
        item.appendChild(content);
      }

      if (entry.role === 'assistant' && entry.id) {
        item.appendChild(renderAssistantActions(entry));
      }

      if (entry.role === 'assistant' && entry.meta && entry.meta.thoughtSummary) {
        item.appendChild(renderThoughtSummary(entry.meta.thoughtSummary));
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function renderAssistantActions(entry) {
    var actions = document.createElement('div');
    actions.className = 'chat-message-actions';

    var label = document.createElement('span');
    label.className = 'chat-action-label';
    label.textContent = 'Was this response useful?';
    actions.appendChild(label);

    var currentVote = entry.meta && entry.meta.userVote ? entry.meta.userVote : undefined;
    actions.appendChild(createVoteButton(entry.id, 'up', currentVote === 'up'));
    actions.appendChild(createVoteButton(entry.id, 'down', currentVote === 'down'));
    return actions;
  }

  function createVoteButton(entryId, vote, active) {
    var button = document.createElement('button');
    button.className = 'vote-btn' + (active ? ' active' : '');
    button.type = 'button';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = vote === 'up' ? 'Thumbs up' : 'Thumbs down';
    button.textContent = vote === 'up' ? '\uD83D\uDC4D' : '\uD83D\uDC4E';
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

  promptInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
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
      target.addEventListener('drop', function (event) {
        event.preventDefault();
        setDropState(false);
        var droppedItems = collectDroppedItems(event);
        if (droppedItems.length > 0) {
          vscode.postMessage({ type: 'addDroppedItems', payload: droppedItems });
        }
      });
    })(dropTargets[di]);
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message.type !== 'string') {
      return;
    }

    if (message.type === 'state') {
      var state = message.payload || {};
      latestState = state;
      renderSessions(state.sessions, state.selectedSessionId);
      renderRuns(state.projectRuns, state.selectedRun ? state.selectedRun.id : undefined);
      renderAttachments(state.attachments);
      renderOpenFiles(state.openFiles);

      var isRun = state.activeSurface === 'run';
      transcript.classList.toggle('hidden', isRun);
      runInspector.classList.toggle('hidden', !isRun);
      setComposerAvailability({ disabled: isRun || isBusy });
      clearConversation.disabled = isRun;
      panelTitle.textContent = isRun
        ? (state.selectedRun ? state.selectedRun.goal : 'Autonomous Run')
        : ((state.sessions || []).find(function (s) { return s.id === state.selectedSessionId; }) || {}).title || 'AtlasMind Chat';
      panelSubtitle.textContent = isRun
        ? 'Inspect live sub-agent activity here, then open the Project Run Center to pause, approve, or resume batches.'
        : 'Persistent workspace chat threads with direct access to recent autonomous runs.';
      composerHint.textContent = isRun
        ? 'Composer disabled while viewing a run session. Switch back to a chat thread to send a prompt.'
        : 'Enter sends with the selected mode. Shift+Enter adds a newline.';

      if (isRun) {
        renderRunInspector(state.selectedRun);
      } else {
        renderTranscript(state.transcript, isBusy, state.selectedMessageId);
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
        renderTranscript(latestState.transcript, isBusy, latestState.selectedMessageId);
      }
      setComposerAvailability({ disabled: busy || Boolean(latestState && latestState.activeSurface === 'run') });
    }
  });
})();

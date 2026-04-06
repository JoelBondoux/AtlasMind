(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('ideation-root');
  const refreshButton = document.getElementById('ideation-refresh');
  const openDashboardButton = document.getElementById('open-project-dashboard');
  const openRunCenterButton = document.getElementById('open-run-center');
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = {
    snapshot: undefined,
    ideationBusy: false,
    ideationStatus: 'Shape the board with notes, files, images, and a guided Atlas facilitation pass.',
    ideationResponse: '',
    selectedCardId: '',
    editingCardId: '',
    linkStartCardId: '',
    boardSaveTimer: undefined,
    drag: undefined,
    recognition: undefined,
    voiceSupported: typeof SpeechRecognitionCtor === 'function',
    voiceActive: false,
  };

  refreshButton?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  openDashboardButton?.addEventListener('click', () => vscode.postMessage({ type: 'openCommand', payload: 'atlasmind.openProjectDashboard' }));
  openRunCenterButton?.addEventListener('click', () => vscode.postMessage({ type: 'openCommand', payload: 'atlasmind.openProjectRunCenter' }));

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message) {
      return;
    }
    if (message.type === 'state') {
      state.snapshot = message.payload;
      syncSelectedCard();
      render();
      return;
    }
    if (message.type === 'error') {
      renderError(message.payload || 'Ideation refresh failed.');
      return;
    }
    if (message.type === 'ideationBusy') {
      state.ideationBusy = Boolean(message.payload);
      render();
      return;
    }
    if (message.type === 'ideationStatus') {
      state.ideationStatus = typeof message.payload === 'string' ? message.payload : '';
      render();
      return;
    }
    if (message.type === 'ideationResponseReset') {
      state.ideationResponse = '';
      render();
      return;
    }
    if (message.type === 'ideationResponseChunk') {
      state.ideationResponse += typeof message.payload === 'string' ? message.payload : '';
      render();
    }
  });

  root?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    const payload = target.dataset.payload || '';
    if (action === 'command') {
      vscode.postMessage({ type: 'openCommand', payload });
      return;
    }
    if (action === 'file') {
      vscode.postMessage({ type: 'openFile', payload });
      return;
    }
    if (action === 'ideation-add-card') {
      addIdeationCard();
      return;
    }
    if (action === 'ideation-delete-card') {
      deleteSelectedIdeationCard();
      return;
    }
    if (action === 'ideation-duplicate-card') {
      duplicateSelectedIdeationCard();
      return;
    }
    if (action === 'ideation-link-toggle') {
      toggleLinkMode();
      return;
    }
    if (action === 'ideation-set-focus') {
      setFocusedCard();
      return;
    }
    if (action === 'ideation-select-card') {
      handleCardSelection(payload);
      return;
    }
    if (action === 'ideation-run') {
      runIdeationLoop();
      return;
    }
    if (action === 'ideation-clear-attachments') {
      vscode.postMessage({ type: 'clearPromptAttachments' });
      return;
    }
    if (action === 'ideation-prompt-chip') {
      const promptInput = document.getElementById('ideationPrompt');
      if (promptInput instanceof HTMLTextAreaElement) {
        promptInput.value = payload;
      }
      return;
    }
    if (action === 'ideation-speak-response') {
      speakResponse();
      return;
    }
    if (action === 'ideation-start-voice') {
      startVoiceCapture();
      return;
    }
    if (action === 'ideation-stop-voice') {
      stopVoiceCapture();
      return;
    }
    if (action === 'ideation-edit-card') {
      state.editingCardId = payload;
      render();
      focusInlineEditor();
      return;
    }
    if (action === 'ideation-stop-edit-card') {
      state.editingCardId = '';
      scheduleIdeationSave();
      render();
      return;
    }
  });

  root?.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.id === 'ideationTitleInput') {
      updateSelectedCardField('title', target.value);
      return;
    }
    if (target.id === 'ideationBodyInput') {
      updateSelectedCardField('body', target.value);
      return;
    }
    if (target.id === 'ideationTypeInput') {
      updateSelectedCardField('kind', target.value);
      return;
    }
    if (target.id === 'ideationColorInput') {
      updateSelectedCardField('color', target.value);
      return;
    }
    if (target.dataset.cardEditField === 'title') {
      updateCardField(target.dataset.cardId || '', 'title', target.value);
      return;
    }
    if (target.dataset.cardEditField === 'body') {
      updateCardField(target.dataset.cardId || '', 'body', target.value);
    }
  });

  root?.addEventListener('dblclick', event => {
    const card = event.target instanceof HTMLElement ? event.target.closest('[data-card-id]') : null;
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const cardId = card.dataset.cardId || '';
    if (!cardId) {
      return;
    }
    state.selectedCardId = cardId;
    state.editingCardId = cardId;
    render();
    focusInlineEditor();
  });

  root?.addEventListener('pointerdown', event => {
    const handle = event.target instanceof HTMLElement ? event.target.closest('[data-drag-card-id]') : null;
    if (!(handle instanceof HTMLElement) || state.editingCardId) {
      return;
    }
    const cardId = handle.dataset.dragCardId || '';
    const card = findIdeationCard(cardId);
    if (!card) {
      return;
    }
    state.drag = {
      cardId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: card.x,
      originY: card.y,
    };
    handle.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', event => {
    if (!state.drag) {
      return;
    }
    const card = findIdeationCard(state.drag.cardId);
    const cardElement = root?.querySelector('[data-card-id="' + cssEscape(state.drag.cardId) + '"]');
    if (!card || !(cardElement instanceof HTMLElement)) {
      return;
    }
    card.x = clampNumber(state.drag.originX + (event.clientX - state.drag.startX), -1600, 1600);
    card.y = clampNumber(state.drag.originY + (event.clientY - state.drag.startY), -1200, 1200);
    card.updatedAt = new Date().toISOString();
    cardElement.style.left = 'calc(50% + ' + card.x + 'px)';
    cardElement.style.top = 'calc(50% + ' + card.y + 'px)';
    updateConnectionPositions();
  });

  window.addEventListener('pointerup', () => {
    if (!state.drag) {
      return;
    }
    state.drag = undefined;
    scheduleIdeationSave();
    render();
  });

  function render() {
    if (!root) {
      return;
    }
    try {
      const snapshot = state.snapshot;
      if (!snapshot) {
        root.innerHTML = '<div class="dashboard-loading">Loading ideation workspace...</div>';
        return;
      }
      const selectedCard = resolveSelectedCard(snapshot);
      root.innerHTML = '' +
        '<section class="ideation-hero-grid">' +
          '<article class="ideation-panel">' +
            '<p class="dashboard-kicker">Dedicated workspace</p>' +
            '<h2>Multimodal idea shaping</h2>' +
            '<p class="section-copy">Use the composer for the next Atlas pass, then drop or paste supporting media straight onto the board to keep the idea grounded in artifacts.</p>' +
          '</article>' +
          '<div class="ideation-stat-grid">' +
            renderStat('Cards', String(snapshot.cards.length), 'Cards currently on the board.') +
            renderStat('Queued prompts', String(snapshot.nextPrompts.length), 'Suggested facilitation follow-ups.') +
            renderStat('Queued media', String(snapshot.promptAttachments.length), 'Files, images, and links waiting for the next Atlas pass.') +
          '</div>' +
        '</section>' +
        '<section class="ideation-main-grid">' +
          renderComposer(snapshot) +
          renderBoard(snapshot) +
        '</section>' +
        '<section class="ideation-lower-grid">' +
          renderInspector(snapshot, selectedCard) +
          renderFeedback(snapshot) +
        '</section>';
      wireDropzones();
      updateConnectionPositions();
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  function renderComposer(snapshot) {
    const promptValue = getPromptValue();
    return '' +
      '<article class="ideation-panel">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Atlas loop</p>' +
            '<h3>Prompt and attach context</h3>' +
          '</div>' +
          '<span class="tag ' + (state.ideationBusy ? 'tag-warn' : 'tag-good') + '">' + (state.ideationBusy ? 'Atlas thinking' : 'Ready') + '</span>' +
        '</div>' +
        '<div class="ideation-composer-shell">' +
          '<label class="section-kicker" for="ideationPrompt">What should Atlas pressure-test next?</label>' +
          '<textarea id="ideationPrompt" class="ideation-prompt" placeholder="Example: pressure-test this concept for small design agencies and suggest the fastest validation experiment">' + escapeHtml(promptValue) + '</textarea>' +
          '<div id="ideationPromptDropzone" class="ideation-dropzone" tabindex="0">Drop files, images, or links here, or paste an image with Ctrl+V to queue it for the next Atlas pass.</div>' +
          '<div class="ideation-chip-row">' +
            (snapshot.promptAttachments.length > 0
              ? snapshot.promptAttachments.map(attachment => '<span class="attachment-pill">' + escapeHtml(attachment.label + ' [' + attachment.kind + ']') + '</span>').join('')
              : '<span class="muted">No queued ideation attachments.</span>') +
          '</div>' +
          '<div class="ideation-composer-actions">' +
            '<div class="ideation-chip-row">' +
              '<button type="button" class="dashboard-button dashboard-button-solid" data-action="ideation-run" ' + (state.ideationBusy ? 'disabled' : '') + '>Run Ideation Loop</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-start-voice" ' + (state.voiceActive ? 'disabled' : '') + '>Start Voice</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-stop-voice" ' + (!state.voiceActive ? 'disabled' : '') + '>Stop Voice</button>' +
            '</div>' +
            '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-clear-attachments" ' + (snapshot.promptAttachments.length === 0 ? 'disabled' : '') + '>Clear Attachments</button>' +
          '</div>' +
          '<div class="panel-card">' +
            '<div class="ideation-status-row">' +
              '<strong>Status</strong>' +
              '<span class="tag">Updated ' + escapeHtml(snapshot.updatedRelative) + '</span>' +
            '</div>' +
            '<div class="stat-detail">' + escapeHtml(state.ideationStatus) + '</div>' +
            '<div class="ideation-chip-row">' +
              '<button type="button" class="action-link" data-action="file" data-payload="' + escapeAttr(snapshot.boardPath) + '">Open board JSON</button>' +
              '<button type="button" class="action-link" data-action="file" data-payload="' + escapeAttr(snapshot.summaryPath) + '">Open board summary</button>' +
              '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsProject">Project settings</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderBoard(snapshot) {
    return '' +
      '<article class="ideation-panel">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Canvas</p>' +
            '<h3>Shared whiteboard</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<button type="button" class="action-link" data-action="ideation-add-card">Add Card</button>' +
            '<button type="button" class="action-link" data-action="ideation-duplicate-card" ' + (state.selectedCardId ? '' : 'disabled') + '>Duplicate</button>' +
            '<button type="button" class="action-link" data-action="ideation-link-toggle" ' + (state.selectedCardId ? '' : 'disabled') + '>' + (state.linkStartCardId ? 'Cancel Link' : 'Link Card') + '</button>' +
            '<button type="button" class="action-link" data-action="ideation-set-focus" ' + (state.selectedCardId ? '' : 'disabled') + '>Set Focus</button>' +
            '<button type="button" class="action-link" data-action="ideation-delete-card" ' + (state.selectedCardId ? '' : 'disabled') + '>Delete</button>' +
          '</div>' +
        '</div>' +
        '<div id="ideationBoardStage" class="ideation-board-stage" tabindex="0">' +
          '<svg class="ideation-connections" viewBox="0 0 1200 760" preserveAspectRatio="none" aria-hidden="true">' + renderIdeationConnections(snapshot) + '</svg>' +
          (snapshot.cards.length > 0
            ? snapshot.cards.map(card => renderIdeationCard(card, snapshot.focusCardId)).join('')
            : '<div class="ideation-empty-state"><div><strong>Start with one sharp note</strong><p class="section-copy">Double-click a card to edit it inline. Drop or paste media onto the board to create an attachment card instantly.</p></div></div>') +
        '</div>' +
        '<div class="ideation-hint">Drag cards by the header. Drop files, images, or links onto the board to create a media card, or target the selected card by keeping it active before you drop. Double-click any card to edit it inline.</div>' +
      '</article>';
  }

  function renderInspector(snapshot, selectedCard) {
    return '' +
      '<article class="panel-card ideation-inspector">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Inspector</p>' +
            '<h3>' + (selectedCard ? escapeHtml(selectedCard.title) : 'Select a card') + '</h3>' +
          '</div>' +
          (selectedCard ? '<div class="ideation-inspector-actions"><button type="button" class="action-link" data-action="ideation-edit-card" data-payload="' + escapeAttr(selectedCard.id) + '">Inline edit</button></div>' : '') +
        '</div>' +
        (selectedCard
          ? '' +
            '<label class="section-kicker" for="ideationTitleInput">Title</label>' +
            '<input id="ideationTitleInput" type="text" value="' + escapeAttr(selectedCard.title) + '" />' +
            '<label class="section-kicker" for="ideationBodyInput">Notes</label>' +
            '<textarea id="ideationBodyInput">' + escapeHtml(selectedCard.body) + '</textarea>' +
            '<label class="section-kicker" for="ideationTypeInput">Type</label>' +
            '<select id="ideationTypeInput">' +
              ['concept', 'insight', 'question', 'opportunity', 'risk', 'experiment', 'user-need', 'atlas-response', 'attachment']
                .map(kind => '<option value="' + kind + '" ' + (selectedCard.kind === kind ? 'selected' : '') + '>' + escapeHtml(kind) + '</option>').join('') +
            '</select>' +
            '<label class="section-kicker" for="ideationColorInput">Color</label>' +
            '<select id="ideationColorInput">' +
              ['sun', 'sea', 'mint', 'rose', 'sand', 'storm']
                .map(color => '<option value="' + color + '" ' + (selectedCard.color === color ? 'selected' : '') + '>' + escapeHtml(color) + '</option>').join('') +
            '</select>' +
            '<div class="ideation-chip-row">' +
              '<span class="tag">' + escapeHtml(selectedCard.author) + '</span>' +
              '<span class="tag">' + escapeHtml(selectedCard.kind) + '</span>' +
              (snapshot.focusCardId === selectedCard.id ? '<span class="tag tag-good">focus</span>' : '') +
            '</div>' +
            '<div class="ideation-chip-row">' +
              (selectedCard.media.length > 0
                ? selectedCard.media.map(media => '<span class="file-pill">' + escapeHtml(media.label) + '</span>').join('')
                : '<span class="muted">No media attached to this card.</span>') +
            '</div>'
          : '<div class="dashboard-empty"><div><strong>No card selected</strong><p class="section-copy">Select a card from the board to inspect it here.</p></div></div>') +
      '</article>';
  }

  function renderFeedback(snapshot) {
    return '' +
      '<article class="panel-card">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Atlas feedback</p>' +
            '<h3>Latest facilitation pass</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<button type="button" class="action-link" data-action="ideation-speak-response" ' + (state.ideationResponse || snapshot.lastAtlasResponse ? '' : 'disabled') + '>Narrate</button>' +
            '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVoicePanel">Voice panel</button>' +
            '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVisionPanel">Vision panel</button>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-response-box">' + escapeHtml(state.ideationResponse || snapshot.lastAtlasResponse || 'Atlas feedback will appear here after you run the ideation loop.').replace(/\n/g, '<br/>') + '</div>' +
        '<div class="panel-card">' +
          '<p class="section-kicker">Next prompts</p>' +
          '<div class="ideation-chip-row">' +
            (snapshot.nextPrompts.length > 0
              ? snapshot.nextPrompts.map(prompt => '<button type="button" class="ideation-chip" data-action="ideation-prompt-chip" data-payload="' + escapeAttr(prompt) + '">' + escapeHtml(prompt) + '</button>').join('')
              : '<span class="muted">Atlas will queue prompts here after the first pass.</span>') +
          '</div>' +
        '</div>' +
        '<div class="panel-card">' +
          '<p class="section-kicker">Conversation</p>' +
          '<div class="ideation-history-list">' +
            (snapshot.history.length > 0
              ? snapshot.history.slice(-6).reverse().map(entry => '' +
                '<div class="panel-card">' +
                  '<div class="row-head">' +
                    '<strong>' + escapeHtml(entry.role === 'atlas' ? 'Atlas' : 'You') + '</strong>' +
                    '<span class="list-meta">' + escapeHtml(relativeLabel(entry.timestamp)) + '</span>' +
                  '</div>' +
                  '<div class="stat-detail">' + escapeHtml(entry.content) + '</div>' +
                '</div>').join('')
              : '<div class="dashboard-empty"><div><strong>No ideation turns yet</strong><p class="section-copy">The conversation history appears here after the first Atlas pass.</p></div></div>') +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderStat(label, value, detail) {
    return '<article class="ideation-stat"><p class="card-kicker">' + escapeHtml(label) + '</p><strong>' + escapeHtml(value) + '</strong><div class="stat-detail">' + escapeHtml(detail) + '</div></article>';
  }

  function renderError(message) {
    if (!root) {
      return;
    }
    root.innerHTML = '<div class="dashboard-empty"><div><strong>Ideation refresh failed</strong><div class="stat-detail">' + escapeHtml(message) + '</div></div></div>';
  }

  function renderIdeationConnections(snapshot) {
    return snapshot.connections.map(connection => {
      const from = snapshot.cards.find(card => card.id === connection.fromCardId);
      const to = snapshot.cards.find(card => card.id === connection.toCardId);
      if (!from || !to) {
        return '';
      }
      const startX = 600 + from.x + 110;
      const startY = 380 + from.y + 92;
      const endX = 600 + to.x + 110;
      const endY = 380 + to.y + 92;
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      return '' +
        '<g data-link-id="' + escapeAttr(connection.id) + '">' +
          '<path class="ideation-link" d="M ' + startX + ' ' + startY + ' C ' + midX + ' ' + startY + ', ' + midX + ' ' + endY + ', ' + endX + ' ' + endY + '"></path>' +
          (connection.label ? '<text class="ideation-link-label" x="' + midX + '" y="' + (midY - 8) + '">' + escapeHtml(connection.label) + '</text>' : '') +
        '</g>';
    }).join('');
  }

  function renderIdeationCard(card, focusCardId) {
    const isEditing = state.editingCardId === card.id;
    const mediaMarkup = card.media.length > 0
      ? card.media.map(media => {
          if (media.kind === 'image' && media.dataUri) {
            return '<img src="' + escapeAttr(media.dataUri) + '" alt="' + escapeAttr(media.label) + '" />';
          }
          return '<span class="media-pill">' + escapeHtml(media.label) + '</span>';
        }).join('')
      : '<span class="muted">No media yet.</span>';
    const contentMarkup = isEditing
      ? '' +
        '<div class="ideation-inline-editor">' +
          '<input data-card-edit-field="title" data-card-id="' + escapeAttr(card.id) + '" value="' + escapeAttr(card.title) + '" />' +
          '<textarea data-card-edit-field="body" data-card-id="' + escapeAttr(card.id) + '">' + escapeHtml(card.body) + '</textarea>' +
          '<div class="ideation-card-actions"><button type="button" class="action-link" data-action="ideation-stop-edit-card" data-payload="' + escapeAttr(card.id) + '">Done</button></div>' +
        '</div>'
      : '' +
        '<strong>' + escapeHtml(card.title) + '</strong>' +
        '<p>' + escapeHtml(card.body || 'Add notes to make the idea concrete.') + '</p>' +
        '<div class="ideation-card-media">' + mediaMarkup + '</div>' +
        '<div class="ideation-card-actions"><span class="tag">' + escapeHtml(card.author) + '</span><span class="tag">' + escapeHtml(card.kind) + '</span></div>';
    return '' +
      '<button type="button" class="ideation-card ideation-card-' + escapeAttr(card.color) + ' ' + (state.selectedCardId === card.id ? 'selected' : '') + ' ' + (focusCardId === card.id ? 'focused' : '') + '" data-action="ideation-select-card" data-payload="' + escapeAttr(card.id) + '" data-card-id="' + escapeAttr(card.id) + '" style="left: calc(50% + ' + card.x + 'px); top: calc(50% + ' + card.y + 'px);">' +
        '<div class="ideation-card-shell">' +
          '<div class="ideation-card-head" data-drag-card-id="' + escapeAttr(card.id) + '">' +
            '<span class="tag">' + escapeHtml(card.kind) + '</span>' +
            '<span class="tag">' + escapeHtml(card.author) + '</span>' +
          '</div>' +
          '<div class="ideation-card-body">' + contentMarkup + '</div>' +
        '</div>' +
      '</button>';
  }

  function wireDropzones() {
    const promptDropzone = document.getElementById('ideationPromptDropzone');
    const boardStage = document.getElementById('ideationBoardStage');
    if (promptDropzone) {
      wireImportTarget(promptDropzone, items => {
        if (items.length > 0) {
          vscode.postMessage({ type: 'ingestPromptMedia', payload: { items } });
        }
      });
    }
    if (boardStage) {
      wireImportTarget(boardStage, items => {
        if (items.length > 0) {
          vscode.postMessage({ type: 'ingestCanvasMedia', payload: { cardId: state.selectedCardId || undefined, items } });
        }
      });
    }
  }

  function wireImportTarget(element, handler) {
    element.addEventListener('dragover', event => {
      event.preventDefault();
      element.classList.add('dragover');
    });
    element.addEventListener('dragleave', () => {
      element.classList.remove('dragover');
    });
    element.addEventListener('drop', event => {
      event.preventDefault();
      element.classList.remove('dragover');
      const items = collectTransferItems(event.dataTransfer);
      handler(items);
    });
    element.addEventListener('paste', async event => {
      const items = await collectClipboardItems(event.clipboardData);
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      handler(items);
    });
  }

  function addIdeationCard() {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    const base = resolveSelectedCard(snapshot);
    const now = new Date().toISOString();
    const card = {
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: 'New idea',
      body: 'Describe the insight, user need, or experiment.',
      kind: 'concept',
      author: 'user',
      x: clampNumber((base?.x || 0) + 60, -1600, 1600),
      y: clampNumber((base?.y || 0) + 60, -1200, 1200),
      color: 'sun',
      imageSources: [],
      media: [],
      createdAt: now,
      updatedAt: now,
    };
    snapshot.cards = snapshot.cards.concat(card).slice(-48);
    state.selectedCardId = card.id;
    state.editingCardId = card.id;
    scheduleIdeationSave();
    render();
    focusInlineEditor();
  }

  function deleteSelectedIdeationCard() {
    const snapshot = state.snapshot;
    if (!snapshot || !state.selectedCardId) {
      return;
    }
    snapshot.cards = snapshot.cards.filter(card => card.id !== state.selectedCardId);
    snapshot.connections = snapshot.connections.filter(connection => connection.fromCardId !== state.selectedCardId && connection.toCardId !== state.selectedCardId);
    if (snapshot.focusCardId === state.selectedCardId) {
      snapshot.focusCardId = snapshot.cards[0]?.id;
    }
    state.selectedCardId = snapshot.cards[0]?.id || '';
    state.editingCardId = '';
    state.linkStartCardId = '';
    scheduleIdeationSave();
    render();
  }

  function duplicateSelectedIdeationCard() {
    const snapshot = state.snapshot;
    const selected = getSelectedCard();
    if (!snapshot || !selected) {
      return;
    }
    const duplicate = {
      ...selected,
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: selected.title + ' copy',
      x: clampNumber(selected.x + 42, -1600, 1600),
      y: clampNumber(selected.y + 42, -1200, 1200),
      media: selected.media.slice(0, 4).map(media => ({ ...media, id: 'media-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    snapshot.cards = snapshot.cards.concat(duplicate).slice(-48);
    state.selectedCardId = duplicate.id;
    scheduleIdeationSave();
    render();
  }

  function toggleLinkMode() {
    if (!state.selectedCardId) {
      return;
    }
    state.linkStartCardId = state.linkStartCardId ? '' : state.selectedCardId;
    render();
  }

  function setFocusedCard() {
    const snapshot = state.snapshot;
    if (!snapshot || !state.selectedCardId) {
      return;
    }
    snapshot.focusCardId = state.selectedCardId;
    scheduleIdeationSave();
    render();
  }

  function handleCardSelection(cardId) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    if (state.linkStartCardId && state.linkStartCardId !== cardId) {
      snapshot.connections = snapshot.connections.concat({
        id: 'link-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        fromCardId: state.linkStartCardId,
        toCardId: cardId,
        label: 'relates to',
      }).slice(-96);
      state.linkStartCardId = '';
      state.selectedCardId = cardId;
      scheduleIdeationSave();
      render();
      return;
    }
    state.selectedCardId = cardId;
    render();
  }

  function updateSelectedCardField(field, value) {
    updateCardField(state.selectedCardId, field, value);
  }

  function updateCardField(cardId, field, value) {
    const selected = findIdeationCard(cardId);
    if (!selected) {
      return;
    }
    selected[field] = value;
    selected.updatedAt = new Date().toISOString();
    scheduleIdeationSave();
  }

  function scheduleIdeationSave() {
    clearTimeout(state.boardSaveTimer);
    state.boardSaveTimer = setTimeout(() => {
      const snapshot = state.snapshot;
      if (!snapshot) {
        return;
      }
      vscode.postMessage({
        type: 'saveIdeationBoard',
        payload: {
          cards: snapshot.cards,
          connections: snapshot.connections,
          focusCardId: snapshot.focusCardId,
          nextPrompts: snapshot.nextPrompts,
        },
      });
    }, 220);
  }

  function runIdeationLoop() {
    const promptInput = document.getElementById('ideationPrompt');
    const prompt = promptInput instanceof HTMLTextAreaElement ? promptInput.value.trim() : '';
    if (!prompt) {
      state.ideationStatus = 'Describe the next ideation move before running Atlas.';
      render();
      return;
    }
    vscode.postMessage({ type: 'runIdeationLoop', payload: { prompt, speakResponse: false } });
  }

  function findIdeationCard(cardId) {
    return state.snapshot?.cards.find(card => card.id === cardId);
  }

  function getSelectedCard() {
    return findIdeationCard(state.selectedCardId);
  }

  function getPromptValue() {
    const promptInput = document.getElementById('ideationPrompt');
    return promptInput instanceof HTMLTextAreaElement ? promptInput.value : '';
  }

  function resolveSelectedCard(snapshot) {
    if (state.selectedCardId) {
      return snapshot.cards.find(card => card.id === state.selectedCardId);
    }
    if (snapshot.focusCardId) {
      state.selectedCardId = snapshot.focusCardId;
      return snapshot.cards.find(card => card.id === snapshot.focusCardId);
    }
    if (snapshot.cards[0]) {
      state.selectedCardId = snapshot.cards[0].id;
      return snapshot.cards[0];
    }
    return undefined;
  }

  function syncSelectedCard() {
    const cards = state.snapshot?.cards || [];
    if (cards.length === 0) {
      state.selectedCardId = '';
      state.editingCardId = '';
      state.linkStartCardId = '';
      return;
    }
    if (!cards.some(card => card.id === state.selectedCardId)) {
      state.selectedCardId = state.snapshot.focusCardId || cards[0].id;
    }
    if (state.editingCardId && !cards.some(card => card.id === state.editingCardId)) {
      state.editingCardId = '';
    }
    if (state.linkStartCardId && !cards.some(card => card.id === state.linkStartCardId)) {
      state.linkStartCardId = '';
    }
  }

  function updateConnectionPositions() {
    const stage = document.getElementById('ideationBoardStage');
    if (!(stage instanceof HTMLElement)) {
      return;
    }
    const svg = stage.querySelector('.ideation-connections');
    if (!(svg instanceof SVGElement) || !state.snapshot) {
      return;
    }
    svg.innerHTML = renderIdeationConnections(state.snapshot);
  }

  function focusInlineEditor() {
    const titleInput = root?.querySelector('[data-card-edit-field="title"]');
    if (titleInput instanceof HTMLInputElement) {
      titleInput.focus();
      titleInput.select();
    }
  }

  function startVoiceCapture() {
    if (!state.voiceSupported || typeof SpeechRecognitionCtor !== 'function') {
      state.ideationStatus = 'Speech recognition is not available in this environment.';
      render();
      return;
    }
    if (!state.recognition) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = event => {
        let transcript = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript;
        }
        const promptInput = document.getElementById('ideationPrompt');
        if (promptInput instanceof HTMLTextAreaElement) {
          promptInput.value = [promptInput.value, transcript.trim()].filter(Boolean).join(promptInput.value ? ' ' : '');
        }
      };
      recognition.onerror = () => {
        state.voiceActive = false;
        state.ideationStatus = 'Voice capture failed or was denied by the environment.';
        render();
      };
      recognition.onend = () => {
        state.voiceActive = false;
        render();
      };
      state.recognition = recognition;
    }
    state.voiceActive = true;
    state.ideationStatus = 'Listening for your next ideation prompt...';
    state.recognition.start();
    render();
  }

  function stopVoiceCapture() {
    if (!state.recognition) {
      return;
    }
    state.recognition.stop();
    state.voiceActive = false;
    state.ideationStatus = 'Voice capture stopped.';
    render();
  }

  function speakResponse() {
    const text = state.ideationResponse || state.snapshot?.lastAtlasResponse || '';
    if (!text || !window.speechSynthesis) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }

  function collectTransferItems(dataTransfer) {
    if (!dataTransfer) {
      return [];
    }
    const values = [];
    const seen = new Set();
    const uriList = dataTransfer.getData('text/uri-list');
    if (uriList) {
      uriList.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return;
        }
        pushImportItem(values, seen, normalizeDroppedValue(trimmed));
      });
    }
    const plainText = dataTransfer.getData('text/plain');
    if (plainText) {
      plainText.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        pushImportItem(values, seen, normalizeDroppedValue(trimmed));
      });
    }
    const fileList = dataTransfer.files || [];
    for (let index = 0; index < fileList.length; index += 1) {
      const file = fileList[index];
      if (file && typeof file.path === 'string' && file.path.length > 0) {
        pushImportItem(values, seen, { transport: 'workspace-path', value: file.path });
      }
    }
    return values;
  }

  async function collectClipboardItems(clipboardData) {
    if (!clipboardData) {
      return [];
    }
    const values = [];
    const seen = new Set();
    const items = clipboardData.items || [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) {
          const dataBase64 = await readFileAsBase64(file);
          if (dataBase64) {
            pushImportItem(values, seen, {
              transport: 'inline-image',
              name: file.name || ('clipboard-' + Date.now()),
              mimeType: file.type || 'image/png',
              dataBase64,
            });
          }
        }
      }
    }
    return values;
  }

  function normalizeDroppedValue(value) {
    if (/^https?:\/\//i.test(value)) {
      return { transport: 'url', value };
    }
    return { transport: 'workspace-path', value };
  }

  function pushImportItem(target, seen, item) {
    if (!item) {
      return;
    }
    const key = item.transport === 'inline-image'
      ? item.transport + ':' + item.name + ':' + item.dataBase64.length
      : item.transport + ':' + item.value;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    target.push(item);
  }

  function readFileAsBase64(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : '');
      };
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
  }

  function relativeLabel(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }
    const deltaDays = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (deltaDays <= 0) {
      return 'today';
    }
    if (deltaDays === 1) {
      return '1 day ago';
    }
    if (deltaDays < 30) {
      return deltaDays + ' days ago';
    }
    const deltaMonths = Math.floor(deltaDays / 30);
    return deltaMonths === 1 ? '1 month ago' : deltaMonths + ' months ago';
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
  }

  function cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  vscode.postMessage({ type: 'ready' });
})();

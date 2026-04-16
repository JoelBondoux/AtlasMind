/* global acquireVsCodeApi, document, window, Element, HTMLElement, HTMLTextAreaElement, HTMLInputElement, SVGElement, CSS, FileReader, SpeechSynthesisUtterance */

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('ideation-root');
  const refreshButton = document.getElementById('ideation-refresh');
  const openDashboardButton = document.getElementById('open-project-dashboard');
  const openRunCenterButton = document.getElementById('open-run-center');
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const BOARD_WORLD_WIDTH = 5200;
  const BOARD_WORLD_HEIGHT = 3800;
  const BOARD_WORLD_ORIGIN_X = BOARD_WORLD_WIDTH / 2;
  const BOARD_WORLD_ORIGIN_Y = BOARD_WORLD_HEIGHT / 2;
  const CARD_WIDTH = 220;
  const CARD_HEIGHT = 184;
  const CARD_PLACEMENT_GAP = 32;
  const BOARD_CARD_MARGIN_X = 180;
  const BOARD_CARD_MARGIN_Y = 180;
  const MIN_CARD_X = -Math.floor((BOARD_WORLD_WIDTH / 2) - CARD_WIDTH - BOARD_CARD_MARGIN_X);
  const MAX_CARD_X = Math.floor((BOARD_WORLD_WIDTH / 2) - BOARD_CARD_MARGIN_X);
  const MIN_CARD_Y = -Math.floor((BOARD_WORLD_HEIGHT / 2) - CARD_HEIGHT - BOARD_CARD_MARGIN_Y);
  const MAX_CARD_Y = Math.floor((BOARD_WORLD_HEIGHT / 2) - BOARD_CARD_MARGIN_Y);
  const MIN_BOARD_ZOOM = 0.45;
  const MAX_BOARD_ZOOM = 1.85;
  const BOARD_ZOOM_STEP = 0.12;
  const BOARD_FIT_PADDING = 140;
  const CANVAS_CLICK_TOLERANCE = 6;
  const state = {
    snapshot: undefined,
    ideationBusy: false,
    ideationStatus: 'Shape the board with notes, files, images, and a guided Atlas facilitation pass.',
    ideationResponse: '',
    expandedAnalyticsIssueId: '',
    boardLens: 'default',
    relationFilter: 'all',
    linkPathMode: 'angular',
    selectedCardId: '',
    orderedSelectedCardIds: [],
    selectedLinkId: '',
    allowEmptySelection: false,
    editingCardId: '',
    linkStartCardId: '',
    boardSaveTimer: undefined,
    canvasFullscreen: false,
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
    viewportMetrics: { width: 0, height: 0 },
    lastCardClick: undefined,
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
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!(target instanceof Element)) {
      return;
    }
    const action = target.getAttribute('data-action') || '';
    const payload = target.getAttribute('data-payload') || '';
    if (action === 'command') {
      vscode.postMessage({ type: 'openCommand', payload });
      return;
    }
    if (action === 'file') {
      vscode.postMessage({ type: 'openFile', payload });
      return;
    }
    if (action === 'ideation-create-workspace') {
      vscode.postMessage({ type: 'createIdeationWorkspace' });
      return;
    }
    if (action === 'ideation-delete-workspace') {
      if (state.snapshot?.activeWorkspaceId) {
        vscode.postMessage({ type: 'deleteIdeationWorkspace', payload: { workspaceId: state.snapshot.activeWorkspaceId } });
      }
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
      createLinkFromSelection();
      return;
    }
    if (action === 'ideation-toggle-link-layout') {
      state.linkPathMode = state.linkPathMode === 'angular' ? 'spline' : 'angular';
      render();
      return;
    }
    if (action === 'ideation-clear-card-pair') {
      collapseSelectionToPrimary();
      return;
    }
    if (action === 'ideation-set-focus') {
      setFocusedCard();
      return;
    }
    if (action === 'ideation-select-card') {
      const now = Date.now();
      const shouldEditInline = Boolean(state.lastCardClick) && state.lastCardClick.cardId === payload && (now - state.lastCardClick.timestamp) < 360;
      state.lastCardClick = { cardId: payload, timestamp: now };
      handleCardSelection(payload, shouldEditInline, event.ctrlKey || event.metaKey || event.shiftKey);
      return;
    }
    if (action === 'ideation-select-link') {
      handleLinkSelection(payload);
      return;
    }
    if (action === 'ideation-run') {
      runIdeationLoop();
      return;
    }
    if (action === 'ideation-toggle-analytics-issue') {
      state.expandedAnalyticsIssueId = state.expandedAnalyticsIssueId === payload ? '' : payload;
      render();
      return;
    }
    if (action === 'ideation-insert-analytics-suggestion') {
      insertAnalyticsSuggestion(payload);
      return;
    }
    if (action === 'ideation-insert-next-card') {
      insertNextCardSuggestion(payload);
      return;
    }
    if (action === 'ideation-seed-validation') {
      seedValidationPrompt();
      return;
    }
    if (action === 'ideation-promote-card') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'promoteCardToProjectRun', payload: { cardId: state.selectedCardId } });
      }
      return;
    }
    if (action === 'ideation-extract-evidence') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'extractEvidenceFromCard', payload: { cardId: state.selectedCardId } });
      }
      return;
    }
    if (action === 'ideation-generate-validation') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'generateValidationBrief', payload: { cardId: state.selectedCardId } });
      }
      return;
    }
    if (action === 'ideation-sync-card') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'syncCardToSsot', payload: { cardId: state.selectedCardId } });
      }
      return;
    }
    if (action === 'ideation-archive-card') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'archiveCard', payload: { cardId: state.selectedCardId, archive: true } });
      }
      return;
    }
    if (action === 'ideation-unarchive-card') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'archiveCard', payload: { cardId: state.selectedCardId, archive: false } });
      }
      return;
    }
    if (action === 'ideation-run-deep-analysis') {
      vscode.postMessage({ type: 'runDeepBoardAnalysis' });
      return;
    }
    if (action === 'ideation-generate-checkpoint') {
      if (state.selectedCardId) {
        vscode.postMessage({ type: 'generateReviewCheckpoint', payload: { cardId: state.selectedCardId } });
      }
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
    if (action === 'ideation-toggle-canvas-focus') {
      state.canvasFullscreen = !state.canvasFullscreen;
      render();
      return;
    }
    if (action === 'ideation-zoom-in') {
      changeBoardZoom(BOARD_ZOOM_STEP);
      return;
    }
    if (action === 'ideation-zoom-out') {
      changeBoardZoom(-BOARD_ZOOM_STEP);
      return;
    }
    if (action === 'ideation-fit-board') {
      fitBoardToVisibleCards();
      return;
    }
    if (action === 'ideation-edit-card') {
      state.editingCardId = payload;
      state.selectedLinkId = '';
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
    if (action === 'ideation-delete-link') {
      deleteSelectedLink();
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
    if (target.id === 'ideationPrompt') {
      renderPromptInferencePreview();
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
    if (target.id === 'ideationBoardLens') {
      state.boardLens = target.value || 'default';
      render();
      return;
    }
    if (target.id === 'ideationRelationFilter') {
      state.relationFilter = target.value || 'all';
      render();
      return;
    }
    if (target.id === 'ideationConstraintBudget') {
      updateConstraintField('budget', target.value);
      return;
    }
    if (target.id === 'ideationConstraintTimeline') {
      updateConstraintField('timeline', target.value);
      return;
    }
    if (target.id === 'ideationConstraintTeamSize') {
      updateConstraintField('teamSize', target.value);
      return;
    }
    if (target.id === 'ideationConstraintRiskTolerance') {
      updateConstraintField('riskTolerance', target.value);
      return;
    }
    if (target.id === 'ideationConstraintTechnicalStack') {
      updateConstraintField('technicalStack', target.value);
      return;
    }
    if (target.id === 'ideationConfidenceInput') {
      updateSelectedCardField('confidence', Number(target.value));
      return;
    }
    if (target.id === 'ideationEvidenceStrengthInput') {
      updateSelectedCardField('evidenceStrength', Number(target.value));
      return;
    }
    if (target.id === 'ideationRiskScoreInput') {
      updateSelectedCardField('riskScore', Number(target.value));
      return;
    }
    if (target.id === 'ideationCostToValidateInput') {
      updateSelectedCardField('costToValidate', Number(target.value));
      return;
    }
    if (target.id === 'ideationTagsInput') {
      updateSelectedCardTags(target.value);
      return;
    }
    if (target.id === 'ideationLinkLabelInput') {
      updateSelectedLinkField('label', target.value);
      return;
    }
    if (target.id === 'ideationLinkStyleInput') {
      updateSelectedLinkField('style', target.value);
      return;
    }
    if (target.id === 'ideationLinkDirectionInput') {
      updateSelectedLinkField('direction', target.value);
      return;
    }
    if (target.id === 'ideationLinkRelationInput') {
      updateSelectedLinkField('relation', target.value);
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

  root?.addEventListener('keydown', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.id === 'ideationPrompt' && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runIdeationLoop();
    }
  });

  root?.addEventListener('change', event => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.syncTarget) {
      updateSelectedCardSyncTargets(target.dataset.syncTarget, target.checked);
      return;
    }
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.id === 'ideationWorkspaceSelect') {
      vscode.postMessage({ type: 'selectIdeationWorkspace', payload: { workspaceId: target.value || '' } });
    }
  });

  root?.addEventListener('wheel', event => {
    const stage = event.target instanceof Element ? event.target.closest('#ideationBoardStage') : null;
    if (!(stage instanceof HTMLElement) || (!event.ctrlKey && !event.metaKey)) {
      return;
    }
    event.preventDefault();
    changeBoardZoom(event.deltaY < 0 ? BOARD_ZOOM_STEP : -BOARD_ZOOM_STEP, { clientX: event.clientX, clientY: event.clientY });
  }, { passive: false });

  root?.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
      return;
    }
    const handle = event.target instanceof Element ? event.target.closest('[data-drag-card-id]') : null;
    if (!(handle instanceof Element) || state.editingCardId) {
      return;
    }
    const cardId = handle.getAttribute('data-drag-card-id') || '';
    const card = findIdeationCard(cardId);
    if (!card) {
      return;
    }
    state.drag = {
      kind: 'card',
      cardId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: card.x,
      originY: card.y,
      moved: false,
    };
    if (handle instanceof HTMLElement) {
      handle.setPointerCapture?.(event.pointerId);
    }
  });

  root?.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
      return;
    }
    const stage = event.target instanceof Element ? event.target.closest('#ideationBoardStage') : null;
    if (!(stage instanceof HTMLElement) || state.editingCardId) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-card-id], [data-link-id], button, input, textarea, select, label')) {
      return;
    }
    state.drag = {
      kind: 'canvas',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.viewportX,
      originY: state.viewportY,
      moved: false,
    };
    stage.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', event => {
    if (!state.drag) {
      return;
    }
    if (!state.drag.moved && (Math.abs(event.clientX - state.drag.startX) >= CANVAS_CLICK_TOLERANCE || Math.abs(event.clientY - state.drag.startY) >= CANVAS_CLICK_TOLERANCE)) {
      state.drag.moved = true;
    }
    if (state.drag.kind === 'card') {
      const card = findIdeationCard(state.drag.cardId);
      const cardElement = root?.querySelector('[data-card-id="' + cssEscape(state.drag.cardId) + '"]');
      if (!card || !(cardElement instanceof HTMLElement)) {
        return;
      }
      card.x = clampNumber(state.drag.originX + (event.clientX - state.drag.startX), MIN_CARD_X, MAX_CARD_X);
      card.y = clampNumber(state.drag.originY + (event.clientY - state.drag.startY), MIN_CARD_Y, MAX_CARD_Y);
      card.updatedAt = new Date().toISOString();
      cardElement.style.left = BOARD_WORLD_ORIGIN_X + card.x + 'px';
      cardElement.style.top = BOARD_WORLD_ORIGIN_Y + card.y + 'px';
      updateConnectionPositions();
      updateViewportIndicators();
      return;
    }
    state.viewportX = clampViewportX(state.drag.originX + (event.clientX - state.drag.startX));
    state.viewportY = clampViewportY(state.drag.originY + (event.clientY - state.drag.startY));
    applyViewportTransform();
    updateViewportIndicators();
  });

  window.addEventListener('pointerup', () => {
    if (!state.drag) {
      return;
    }
    const drag = state.drag;
    if (state.drag.kind === 'canvas') {
      applyViewportTransform();
      updateViewportIndicators();
      if (!drag.moved) {
        clearCanvasSelection();
        state.drag = undefined;
        return;
      }
    }
    state.drag = undefined;
    if (state.snapshot) {
      scheduleIdeationSave();
      render();
    }
  });

  window.addEventListener('resize', () => {
    syncBoardViewportMetrics();
    applyViewportTransform();
    updateViewportIndicators();
  });

  window.addEventListener('keydown', event => {
    if (isEditingTextField(event.target)) {
      return;
    }
    if (handleCanvasShortcut(event)) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      changeBoardZoom(BOARD_ZOOM_STEP);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '-') {
      event.preventDefault();
      changeBoardZoom(-BOARD_ZOOM_STEP);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '0') {
      event.preventDefault();
      fitBoardToVisibleCards();
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      state.canvasFullscreen = !state.canvasFullscreen;
      render();
      return;
    }
    if (event.key === 'Escape' && state.canvasFullscreen) {
      event.preventDefault();
      state.canvasFullscreen = false;
      render();
    }
  });

  function render() {
    if (!root) {
      return;
    }
    try {
      document.body.classList.toggle('canvas-focus-mode', state.canvasFullscreen);
      const snapshot = state.snapshot;
      if (!snapshot) {
        root.innerHTML = '<div class="dashboard-loading">Loading ideation workspace...</div>';
        return;
      }
      const selectedCard = resolveSelectedCard(snapshot);
      const selectedLink = resolveSelectedLink(snapshot);
      root.innerHTML = '' +
        '<div class="ideation-workspace ' + (state.canvasFullscreen ? 'ideation-workspace-canvas-focus' : '') + '">' +
          '<section class="ideation-hero-grid">' +
            '<article class="ideation-panel"' + tooltipAttrs('Ideation is a staged workflow: frame the problem, let Atlas scaffold the board, shape the board with cards and links, then decide what to validate or send into execution.') + '>' +
              '<p class="dashboard-kicker">Dedicated workspace</p>' +
              '<h2>Multimodal idea shaping</h2>' +
              '<p class="section-copy">Use the composer for the next Atlas pass, then drop or paste supporting media straight onto the board to keep the idea grounded in artifacts.</p>' +
            '</article>' +
            '<div class="ideation-stat-grid">' +
              renderStat('Active cards', String(snapshot.cards.filter(card => !card.archivedAt).length), 'Active cards on the board. Archived cards are hidden but preserved.') +
              renderStat('Runs', String(snapshot.runs.length), 'Auditable ideation evolutions captured so far.') +
              renderStat('Queued media', String(snapshot.promptAttachments.length), 'Files, images, and links waiting for the next Atlas pass.') +
            '</div>' +
          '</section>' +
          '<section class="ideation-process-section">' + renderProcessGuide(snapshot) + '</section>' +
          '<section class="ideation-main-grid">' +
            renderComposer(snapshot) +
            renderBoard(snapshot) +
          '</section>' +
          '<section class="ideation-lower-grid">' +
            renderInspector(snapshot, selectedCard, selectedLink) +
            renderFeedback(snapshot) +
          '</section>' +
          '<section class="ideation-analytics-section">' +
            renderAnalytics(snapshot) +
          '</section>' +
        '</div>';
      wireDropzones();
      syncBoardViewportMetrics();
      applyViewportTransform();
      updateConnectionPositions();
      updateViewportIndicators();
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  function renderComposer(snapshot) {
    const promptValue = getPromptValue();
    const constraints = snapshot.constraints || {};
    const primaryActionLabel = snapshot.cards.length === 0 ? 'Create Ideation Board' : 'Create or Evolve Board';
    const activeWorkspace = (snapshot.workspaces || []).find(item => item.id === snapshot.activeWorkspaceId) || snapshot.workspaces?.[0];
    return '' +
      '<article class="ideation-panel ideation-composer-panel"' + tooltipAttrs('Stage 1 and Stage 2 happen here: describe the problem, add constraints, and let Atlas scaffold or evolve the board.') + '>' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Atlas loop</p>' +
            '<h3>Prompt and attach context</h3>' +
          '</div>' +
          '<span class="tag ' + (state.ideationBusy ? 'tag-warn' : 'tag-good') + '"' + tooltipAttrs(state.ideationBusy ? 'Atlas is currently synthesizing the next board update.' : 'The ideation panel is ready for another facilitation pass.') + '>' + (state.ideationBusy ? 'Atlas thinking' : 'Ready') + '</span>' +
        '</div>' +
        '<div class="ideation-composer-shell">' +
          '<div class="panel-card"' + tooltipAttrs('Each ideation workspace keeps its own board, summary, and Atlas history. Create a fresh thread when a line of thinking diverges instead of overwriting the current board.') + '>' +
            '<div class="row-head"><div><p class="section-kicker">Ideation workspace</p><h4>Switch or start clean</h4></div><span class="tag">' + escapeHtml(activeWorkspace?.updatedRelative || snapshot.updatedRelative) + '</span></div>' +
            '<div class="ideation-workspace-switcher">' +
              '<label class="constraint-span" for="ideationWorkspaceSelect"><span class="section-kicker">Active thread</span>' +
                '<select id="ideationWorkspaceSelect" class="ideation-lens-select" title="Switch to another ideation workspace without losing the current board.">' +
                  (snapshot.workspaces || []).map(item => '<option value="' + escapeAttr(item.id) + '"' + (item.id === snapshot.activeWorkspaceId ? ' selected' : '') + '>' + escapeHtml(item.title + ' (' + item.activeCardCount + ' active cards)') + '</option>').join('') +
                '</select>' +
              '</label>' +
              '<div class="ideation-chip-row">' +
                '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-create-workspace"' + tooltipAttrs('Create a brand new ideation workspace with an empty board while keeping the current one intact.') + '>New Ideation</button>' +
                '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-delete-workspace" ' + ((snapshot.workspaces || []).length <= 1 ? 'disabled' : '') + tooltipAttrs('Delete the active ideation workspace when it is no longer useful. The last remaining workspace is protected.') + '>Delete Active</button>' +
              '</div>' +
            '</div>' +
            '<div class="stat-detail">' + escapeHtml(activeWorkspace ? `${activeWorkspace.title} stores ${activeWorkspace.cardCount} total cards in ${activeWorkspace.boardPath}.` : 'The active ideation workspace is ready.') + '</div>' +
          '</div>' +
          '<label class="section-kicker" for="ideationPrompt"' + tooltipAttrs('Write the problem, concept, comparison, or question you want Atlas to turn into board structure. This is the main entry point for a new ideation pass.', true) + '>What should Atlas pressure-test next?</label>' +
          '<textarea id="ideationPrompt" class="ideation-prompt" placeholder="Example: pressure-test this concept for small design agencies and suggest the fastest validation experiment" title="Write the next ideation prompt here. Atlas will scaffold cards, suggest relationships, and evolve the board from this text.">' + escapeHtml(promptValue) + '</textarea>' +
          '<div class="ideation-action-callout"' + tooltipAttrs('This callout explains what the primary action does so new users understand that running the prompt creates or reshapes the board rather than sending a normal chat message.') + '>' +
            '<strong>' + escapeHtml(primaryActionLabel) + '</strong>' +
            '<p class="section-copy">Write the next ideation prompt here, then run it to have Atlas create the first board structure or reshape the current one. Press Ctrl/Cmd+Enter to submit immediately.</p>' +
          '</div>' +
          '<div id="ideationPromptInference" class="panel-card"' + tooltipAttrs('This preview shows the card types and board facets Atlas is likely to scaffold before it answers. Use it to sanity-check whether the prompt is framing the right problem.') + '>' + renderPromptInferencePreviewMarkup(promptValue, snapshot) + '</div>' +
          '<div id="ideationPromptDropzone" class="ideation-dropzone" tabindex="0"' + tooltipAttrs('Drop files, links, screenshots, or other artifacts here to queue them for the next ideation pass. Supporting evidence makes the board less speculative.', true) + '>Drop files, images, or links here, or paste an image with Ctrl+V to queue it for the next Atlas pass.</div>' +
          '<div class="ideation-chip-row">' +
            (snapshot.promptAttachments.length > 0
              ? snapshot.promptAttachments.map(attachment => '<span class="attachment-pill"' + tooltipAttrs('Queued attachment: ' + attachment.label + ' (' + attachment.kind + '). Atlas will include it in the next ideation pass.') + '>' + escapeHtml(attachment.label + ' [' + attachment.kind + ']') + '</span>').join('')
              : '<span class="muted">No queued ideation attachments.</span>') +
          '</div>' +
          '<div class="ideation-composer-actions">' +
            '<div class="ideation-chip-row">' +
              '<button type="button" class="dashboard-button dashboard-button-solid" data-action="ideation-run" ' + (state.ideationBusy ? 'disabled' : '') + tooltipAttrs('Run the next ideation pass. Atlas will scaffold cards, update existing cards, and suggest relationships based on the prompt and attachments.') + '>' + escapeHtml(primaryActionLabel) + '</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-seed-validation" ' + (state.selectedCardId ? '' : 'disabled') + tooltipAttrs('Draft a validation-oriented follow-up prompt for the currently selected card so the board moves from ideas into tests.') + '>Generate Validation</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-start-voice" ' + (state.voiceActive ? 'disabled' : '') + tooltipAttrs('Start dictating the ideation prompt by voice. Useful when capturing rapid thoughts or reviewing evidence hands-free.') + '>Start Voice</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-stop-voice" ' + (!state.voiceActive ? 'disabled' : '') + tooltipAttrs('Stop voice capture and keep the dictated text in the ideation prompt field.') + '>Stop Voice</button>' +
            '</div>' +
            '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-clear-attachments" ' + (snapshot.promptAttachments.length === 0 ? 'disabled' : '') + tooltipAttrs('Remove all queued evidence from the next ideation pass without deleting any cards already on the board.') + '>Clear Attachments</button>' +
          '</div>' +
          '<div class="panel-card"' + tooltipAttrs('These inputs pressure-test the idea against real-world boundaries. They do not create cards directly, but they influence Atlas facilitation and board evolution.') + '>' +
            '<div class="row-head"><div><p class="section-kicker">Constraint injection</p><h4>Pressure-test inputs</h4></div></div>' +
            '<div class="ideation-constraint-grid">' +
              '<label' + tooltipAttrs('Optional budget boundary. Helps Atlas avoid suggesting experiments or delivery approaches that are unrealistically expensive.', true) + '><span class="section-kicker">Budget</span><input id="ideationConstraintBudget" type="text" value="' + escapeAttr(constraints.budget || '') + '" placeholder="£10k validation budget" /></label>' +
              '<label' + tooltipAttrs('Optional time boundary. Use it to force Atlas to think in near-term signal windows instead of abstract long-term plans.', true) + '><span class="section-kicker">Timeline</span><input id="ideationConstraintTimeline" type="text" value="' + escapeAttr(constraints.timeline || '') + '" placeholder="6 weeks to signal" /></label>' +
              '<label' + tooltipAttrs('Optional team boundary. Helps Atlas keep suggestions aligned with the actual delivery and research capacity available.', true) + '><span class="section-kicker">Team size</span><input id="ideationConstraintTeamSize" type="text" value="' + escapeAttr(constraints.teamSize || '') + '" placeholder="2 product + 1 engineer" /></label>' +
              '<label' + tooltipAttrs('Optional appetite for uncertainty. Atlas can frame more conservative or more aggressive validation paths based on this.', true) + '><span class="section-kicker">Risk tolerance</span><input id="ideationConstraintRiskTolerance" type="text" value="' + escapeAttr(constraints.riskTolerance || '') + '" placeholder="Low / medium / high" /></label>' +
              '<label class="constraint-span"' + tooltipAttrs('Optional implementation context. Useful when the idea depends on specific technical boundaries, platforms, or integration surfaces.', true) + '><span class="section-kicker">Technical stack</span><input id="ideationConstraintTechnicalStack" type="text" value="' + escapeAttr(constraints.technicalStack || '') + '" placeholder="TypeScript, VS Code extension host, local MCP" /></label>' +
            '</div>' +
          '</div>' +
          '<div class="panel-card"' + tooltipAttrs('This shows the project-memory and SSOT context Atlas is already weaving into the next ideation pass so the board stays grounded in the current repo state.') + '>' +
            '<p class="section-kicker">Context weaving</p>' +
            '<div class="stat-detail">' + escapeHtml(snapshot.projectMetadataSummary || 'AtlasMind will pull SSOT context into the next run packet when project metadata is available.') + '</div>' +
            (snapshot.contextPackets.length > 0 ? '<div class="ideation-chip-row"><span class="tag tag-good">Latest packet</span><span class="stat-detail">' + escapeHtml(snapshot.contextPackets[snapshot.contextPackets.length - 1].constraintsSummary || 'No explicit constraints') + '</span></div>' : '') +
          '</div>' +
          '<div class="panel-card"' + tooltipAttrs('Use these links to inspect the persisted ideation board files or jump into related project settings. The board is durable, not ephemeral.') + '>' +
            '<div class="ideation-status-row">' +
              '<strong>Status</strong>' +
              '<span class="tag">Updated ' + escapeHtml(snapshot.updatedRelative) + '</span>' +
            '</div>' +
            '<div class="stat-detail">' + escapeHtml(state.ideationStatus) + '</div>' +
            '<div class="ideation-chip-row">' +
              '<button type="button" class="action-link" data-action="file" data-payload="' + escapeAttr(snapshot.boardPath) + '"' + tooltipAttrs('Open the persisted JSON source of the ideation board. Useful for auditing or inspecting the durable board state.') + '>Open board JSON</button>' +
              '<button type="button" class="action-link" data-action="file" data-payload="' + escapeAttr(snapshot.summaryPath) + '"' + tooltipAttrs('Open the markdown summary of the ideation board. Useful for quick review or sharing outside the canvas.') + '>Open board summary</button>' +
              '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsProject"' + tooltipAttrs('Open project settings that influence ideation context, SSOT location, and project-run behavior.') + '>Project settings</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderBoard(snapshot) {
    const selectedLink = getSelectedLink();
    const boardView = getBoardView(snapshot);
    const viewCards = boardView.cards;
    const visibleConnections = boardView.connections;
    const lod = getBoardLod();
    const zoomPercent = Math.round(state.zoom * 100);
    const orderedPair = getOrderedSelectedCards(snapshot);
    return '' +
      '<article class="ideation-panel ideation-canvas-panel"' + tooltipAttrs('Stage 3 happens here: inspect, connect, rearrange, and challenge the evolving board until the idea is concrete enough to validate or execute.') + '>' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Canvas</p>' +
            '<h3>Shared whiteboard</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<select id="ideationBoardLens" class="ideation-lens-select" title="Switch between workflow views that can both filter the board and temporarily rearrange cards for easier review.">' +
              renderLensOption('default', 'Default view') +
              renderLensOption('workflow-map', 'Workflow Map') +
              renderLensOption('focus-network', 'Focus Network') +
              renderLensOption('user-journey', 'User Journey view') +
              renderLensOption('risks-first', 'Risks First view') +
              renderLensOption('experiments-only', 'Experiments Only view') +
              renderLensOption('feasibility', 'Feasibility view') +
              renderLensOption('delivery-readiness', 'Delivery Readiness') +
              renderLensOption('archived', 'Archived') +
            '</select>' +
            '<select id="ideationRelationFilter" class="ideation-lens-select" title="Show all relationships or isolate a single relation type so overlapping links are easier to inspect.">' +
              renderRelationFilterOption('all', 'All links') +
              renderRelationFilterOption('supports', 'Supports only') +
              renderRelationFilterOption('causal', 'Causal only') +
              renderRelationFilterOption('dependency', 'Dependency only') +
              renderRelationFilterOption('contradiction', 'Contradiction only') +
              renderRelationFilterOption('opportunity', 'Opportunity only') +
              renderRelationFilterOption('directional', 'Directional only') +
              renderRelationFilterOption('bidirectional', 'Bi-directional only') +
            '</select>' +
            '<button type="button" class="action-link" data-action="ideation-add-card"' + tooltipAttrs('Add a manual card to the board when you want to capture a thought directly instead of asking Atlas to generate it.') + '>Add Card</button>' +
            '<button type="button" class="action-link" data-action="ideation-duplicate-card" ' + (state.selectedCardId ? '' : 'disabled') + tooltipAttrs('Duplicate the selected card when you want to branch an idea into a variant, test, or alternative framing.') + '>Duplicate</button>' +
            '<button type="button" class="action-link" data-action="ideation-link-toggle" ' + (orderedPair.length === 2 ? '' : 'disabled') + tooltipAttrs('Link the last two clicked cards in click order. Use keyboard shortcuts like L, S, D, C, O, or X to choose the relation type directly.') + '>Link Pair</button>' +
            '<button type="button" class="action-link" data-action="ideation-toggle-link-layout"' + tooltipAttrs('Toggle relationship rendering between angular routing and spline routing so dense boards can be read more clearly.') + '>' + (state.linkPathMode === 'angular' ? 'Angular Links' : 'Spline Links') + '</button>' +
            '<button type="button" class="action-link" data-action="ideation-set-focus" ' + (state.selectedCardId ? '' : 'disabled') + tooltipAttrs('Mark the selected card as the current center of attention. Atlas uses focus when proposing follow-up cards and relationships.') + '>Set Focus</button>' +
            '<button type="button" class="action-link" data-action="ideation-promote-card" ' + (state.selectedCardId ? '' : 'disabled') + tooltipAttrs('Stage 4: send the selected card into Project Run Center when the idea is concrete enough to plan or execute.') + '>Send to Project Run</button>' +
            '<button type="button" class="action-link" data-action="ideation-clear-card-pair" ' + (orderedPair.length > 1 ? '' : 'disabled') + tooltipAttrs('Reduce the ordered card pair back to just the primary selected card.') + '>Clear Pair</button>' +
            '<button type="button" class="action-link" data-action="ideation-delete-link" ' + (selectedLink ? '' : 'disabled') + tooltipAttrs('Delete the currently selected relationship line from the board.') + '>Delete Link</button>' +
            '<button type="button" class="action-link" data-action="ideation-zoom-out" aria-label="Zoom out" title="Zoom the board out to inspect more of the canvas at once.">-</button>' +
            '<button type="button" class="action-link" data-action="ideation-fit-board" aria-label="Fit board" title="Fit the visible board into the current viewport.">' + zoomPercent + '%</button>' +
            '<button type="button" class="action-link" data-action="ideation-zoom-in" aria-label="Zoom in" title="Zoom the board in for tighter card editing and link inspection.">+</button>' +
            '<button type="button" class="action-link" data-action="ideation-toggle-canvas-focus" aria-label="' + (state.canvasFullscreen ? 'Return to normal board view' : 'Expand canvas view') + '" title="' + escapeAttr(state.canvasFullscreen ? 'Exit the immersive full-viewport board view.' : 'Expand the canvas into an immersive full-viewport board view.') + '"><span class="action-icon" aria-hidden="true">' + (state.canvasFullscreen ? '⤡' : '⤢') + '</span>' + (state.canvasFullscreen ? 'Return to Normal View' : 'Expand to Full View') + '</button>' +
            '<button type="button" class="action-link" data-action="ideation-delete-card" ' + (state.selectedCardId ? '' : 'disabled') + tooltipAttrs('Delete the selected card and its direct links from the board.') + '>Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-board-frame">' +
          '<div class="ideation-board-overlay-bar">' +
            '<div class="ideation-board-view-summary">' + escapeHtml(boardView.summary) + '</div>' +
            renderRelationLegend() +
          '</div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-top" data-edge="top"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-right" data-edge="right"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-bottom" data-edge="bottom"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-left" data-edge="left"></div>' +
          '<div id="ideationBoardStage" class="ideation-board-stage ideation-board-stage-' + lod + '" tabindex="0">' +
            '<div id="ideationBoardWorld" class="ideation-board-world" style="transform: translate(calc(-50% + ' + state.viewportX + 'px), calc(-50% + ' + state.viewportY + 'px)) scale(' + state.zoom + ');">' +
              renderBoardLanes() +
              '<svg class="ideation-connections" viewBox="0 0 ' + BOARD_WORLD_WIDTH + ' ' + BOARD_WORLD_HEIGHT + '" preserveAspectRatio="none" aria-hidden="true">' + renderIdeationConnections({ cards: viewCards, connections: visibleConnections }, lod) + '</svg>' +
              (viewCards.length > 0
                ? viewCards.map(card => renderIdeationCard(card, snapshot.focusCardId, lod)).join('')
                : '<div class="ideation-empty-state"><div><strong>Start with one sharp note</strong><p class="section-copy">Select a card twice to edit it inline. Drag empty canvas space to pan, or drop and paste media to create attachment cards instantly.</p></div></div>') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-shortcut-strip">' + renderCanvasShortcutStrip(snapshot) + '</div>' +
        '<div class="ideation-hint">Drag cards by the header. The Views menu can temporarily re-layout the workflow so you can inspect readiness, risks, experiments, or the selected card network more clearly. Click a card to fade unrelated cards and links, making its direct network easier to review. Click cards in sequence to build an ordered pair, then press L to link them from first click to second click. Use S for supports, D for dependency, C for causal, O for opportunity, and X for contradiction. Arrowheads indicate flow toward the receiving card; bidirectional links show markers at both ends. Use the relation filter and the legend to isolate or decode each line family. Press Enter or E to edit the selected card, A to add a card, Delete to remove the selected card or link, hold Ctrl/Cmd and use the mouse wheel to zoom, use Ctrl/Cmd + or Ctrl/Cmd - to step zoom, Ctrl/Cmd 0 to fit the active board, press F to expand, and Escape to collapse or clear a pair. Drop files, images, or links onto the board to create a media card, or target the selected card before you drop.</div>' +
      '</article>';
  }

  function renderRelationLegend() {
    const items = [
      { relation: 'supports', description: 'Blue dotted line with a dot marker. Used for reinforcing context or evidence.' },
      { relation: 'causal', description: 'Bright blue line with an arrow marker. Used for cause and effect.' },
      { relation: 'dependency', description: 'Amber solid line with a diamond marker. Used for prerequisites and blockers.' },
      { relation: 'contradiction', description: 'Rose solid line with a bar marker. Used for tension, conflict, or invalidation.' },
      { relation: 'opportunity', description: 'Green line with an arrow marker. Used for promising openings or leverage.' },
    ];
    return '' +
      '<div class="ideation-relation-legend" role="list" aria-label="Relationship legend">' +
        items.map(item => '' +
          '<span class="ideation-relation-legend-item relation-' + escapeAttr(item.relation) + '" role="listitem"' + tooltipAttrs(item.description) + '>' +
            '<span class="ideation-relation-legend-line"></span>' +
            '<span>' + escapeHtml(item.relation) + '</span>' +
          '</span>'
        ).join('') +
      '</div>';
  }

  function renderBoardLanes() {
    const lanes = [
      { label: 'Inputs', left: 420, width: 360 },
      { label: 'Context', left: 860, width: 360 },
      { label: 'Decision', left: 1300, width: 360 },
      { label: 'Constraints', left: 1740, width: 360 },
      { label: 'Actions / Risks', left: 2180, width: 420 },
      { label: 'Outputs', left: 2700, width: 320 },
    ];
    return '' +
      '<div class="ideation-board-lanes" aria-hidden="true">' +
        lanes.map(lane => '' +
          '<div class="ideation-board-lane" style="left:' + lane.left + 'px;width:' + lane.width + 'px">' +
            '<span class="ideation-board-lane-label">' + escapeHtml(lane.label) + '</span>' +
          '</div>'
        ).join('') +
        '<div class="ideation-board-flow-arrow">Direction of travel</div>' +
      '</div>';
  }

  function renderInspector(snapshot, selectedCard, selectedLink) {
    if (selectedLink) {
      const fromCard = snapshot.cards.find(card => card.id === selectedLink.fromCardId);
      const toCard = snapshot.cards.find(card => card.id === selectedLink.toCardId);
      return '' +
        '<article class="panel-card ideation-inspector">' +
          '<div class="row-head">' +
            '<div>' +
              '<p class="section-kicker">Inspector</p>' +
              '<h3>Edit link</h3>' +
            '</div>' +
            '<div class="ideation-inspector-actions"><button type="button" class="action-link" data-action="ideation-delete-link">Delete link</button></div>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<span class="tag">' + escapeHtml(fromCard?.title || selectedLink.fromCardId) + '</span>' +
            '<span class="tag">to</span>' +
            '<span class="tag">' + escapeHtml(toCard?.title || selectedLink.toCardId) + '</span>' +
          '</div>' +
          '<label class="section-kicker" for="ideationLinkRelationInput">Relation</label>' +
          '<select id="ideationLinkRelationInput">' +
            ['supports', 'causal', 'dependency', 'contradiction', 'opportunity'].map(relation => '<option value="' + relation + '" ' + (selectedLink.relation === relation ? 'selected' : '') + '>' + escapeHtml(relation) + '</option>').join('') +
          '</select>' +
          '<label class="section-kicker" for="ideationLinkLabelInput">Relationship label</label>' +
          '<input id="ideationLinkLabelInput" type="text" value="' + escapeAttr(selectedLink.label) + '" />' +
          '<label class="section-kicker" for="ideationLinkStyleInput">Line style</label>' +
          '<select id="ideationLinkStyleInput">' +
            ['dotted', 'solid'].map(style => '<option value="' + style + '" ' + (selectedLink.style === style ? 'selected' : '') + '>' + escapeHtml(style) + '</option>').join('') +
          '</select>' +
          '<label class="section-kicker" for="ideationLinkDirectionInput">Arrow direction</label>' +
          '<select id="ideationLinkDirectionInput">' +
            [
              { value: 'none', label: 'No arrow' },
              { value: 'forward', label: 'From source to target' },
              { value: 'reverse', label: 'From target to source' },
              { value: 'both', label: 'Both directions' },
            ].map(option => '<option value="' + option.value + '" ' + (selectedLink.direction === option.value ? 'selected' : '') + '>' + escapeHtml(option.label) + '</option>').join('') +
          '</select>' +
        '</article>';
    }
    return '' +
      '<article class="panel-card ideation-inspector">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Inspector</p>' +
            '<h3>' + (selectedCard ? escapeHtml(selectedCard.title) : 'Select a card') + '</h3>' +
          '</div>' +
          (selectedCard
            ? '<div class="ideation-inspector-actions">' +
                '<button type="button" class="action-link" data-action="ideation-edit-card" data-payload="' + escapeAttr(selectedCard.id) + '">Inline edit</button>' +
                (['idea', 'problem', 'experiment', 'risk'].includes(selectedCard.kind)
                  ? '<button type="button" class="action-link" data-action="ideation-generate-validation">Validation Brief</button>'
                  : '') +
                (selectedCard.kind === 'experiment'
                  ? '<button type="button" class="action-link" data-action="ideation-generate-checkpoint">Checkpoint</button>'
                  : '') +
                (selectedCard.media.length > 0
                  ? '<button type="button" class="action-link" data-action="ideation-extract-evidence">Extract Evidence</button>'
                  : '') +
                (selectedCard.archivedAt
                  ? '<button type="button" class="action-link" data-action="ideation-unarchive-card">Restore</button>'
                  : '<button type="button" class="action-link" data-action="ideation-archive-card">Archive</button>') +
              '</div>'
            : '') +
        '</div>' +
        (selectedCard
          ? '' +
            '<label class="section-kicker" for="ideationTitleInput">Title</label>' +
            '<input id="ideationTitleInput" type="text" value="' + escapeAttr(selectedCard.title) + '" />' +
            '<label class="section-kicker" for="ideationBodyInput">Notes</label>' +
            '<textarea id="ideationBodyInput">' + escapeHtml(selectedCard.body) + '</textarea>' +
            '<label class="section-kicker" for="ideationTypeInput">Type</label>' +
            '<select id="ideationTypeInput">' +
              ['idea', 'problem', 'experiment', 'user-insight', 'risk', 'requirement', 'evidence', 'atlas-response', 'attachment']
                .map(kind => '<option value="' + kind + '" ' + (selectedCard.kind === kind ? 'selected' : '') + '>' + escapeHtml(kind) + '</option>').join('') +
            '</select>' +
            '<div class="ideation-validation-block">' + renderCardTemplate(selectedCard) + renderValidationWarnings(selectedCard) + '</div>' +
            '<label class="section-kicker" for="ideationColorInput">Color</label>' +
            '<select id="ideationColorInput">' +
              ['sun', 'sea', 'mint', 'rose', 'sand', 'storm']
                .map(color => '<option value="' + color + '" ' + (selectedCard.color === color ? 'selected' : '') + '>' + escapeHtml(color) + '</option>').join('') +
            '</select>' +
            '<div class="ideation-score-grid">' +
              renderScoreField('Confidence', 'ideationConfidenceInput', selectedCard.confidence) +
              renderScoreField('Evidence', 'ideationEvidenceStrengthInput', selectedCard.evidenceStrength) +
              renderScoreField('Risk', 'ideationRiskScoreInput', selectedCard.riskScore) +
              renderScoreField('Validate Cost', 'ideationCostToValidateInput', selectedCard.costToValidate) +
            '</div>' +
            '<label class="section-kicker" for="ideationTagsInput">Tags</label>' +
            '<input id="ideationTagsInput" type="text" value="' + escapeAttr((selectedCard.tags || []).join(', ')) + '" placeholder="analytics, transcript, hypothesis" />' +
            '<div class="panel-card ideation-sync-card"><p class="section-kicker">Project memory sync</p>' + renderSyncTargets(selectedCard.syncTargets || []) + '</div>' +
            '<div class="ideation-chip-row">' +
              '<span class="tag">' + escapeHtml(selectedCard.author) + '</span>' +
              '<span class="tag">' + escapeHtml(selectedCard.kind) + '</span>' +
              '<span class="tag">rev ' + escapeHtml(String(selectedCard.revision || 1)) + '</span>' +
              (snapshot.focusCardId === selectedCard.id ? '<span class="tag tag-good">focus</span>' : '') +
            '</div>' +
            '<div class="panel-card"><p class="section-kicker">Idea genealogy</p>' + renderGenealogy(snapshot, selectedCard) + '</div>' +
            '<div class="ideation-chip-row">' +
              (selectedCard.media.length > 0
                ? selectedCard.media.map(media => '<span class="file-pill">' + escapeHtml(media.label) + '</span>').join('')
                : '<span class="muted">No media attached to this card.</span>') +
            '</div>' +
            '<div class="panel-card ideation-sync-card">' +
              '<p class="section-kicker">Execution handoff</p>' +
              '<p class="section-copy">Send this card straight into Project Run Center to generate a runnable plan, then feed the run learnings back into ideation when execution finishes.</p>' +
              '<div class="ideation-chip-row">' +
                '<button type="button" class="action-link" data-action="ideation-promote-card">Send to Project Run</button>' +
              '</div>' +
            '</div>'
          : '<div class="dashboard-empty"><div><strong>No card selected</strong><p class="section-copy">Select a card from the board to inspect it here.</p></div></div>') +
      '</article>';
  }

  function renderFeedback(snapshot) {
    return '' +
      '<article class="panel-card"' + tooltipAttrs('This is the reflection and next-step area. Review what Atlas concluded, adopt the next prompts or next cards, then decide whether the board is ready for another loop or for execution.') + '>' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Atlas feedback</p>' +
            '<h3>Latest facilitation pass</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<button type="button" class="action-link" data-action="ideation-speak-response" ' + (state.ideationResponse || snapshot.lastAtlasResponse ? '' : 'disabled') + tooltipAttrs('Read the latest Atlas facilitation response aloud so you can review it without staring at the panel.') + '>Narrate</button>' +
            '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVoicePanel"' + tooltipAttrs('Open the Voice panel for richer speech workflows related to this ideation session.') + '>Voice panel</button>' +
            '<button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVisionPanel"' + tooltipAttrs('Open the Vision panel if you need richer visual artifact analysis outside the ideation board itself.') + '>Vision panel</button>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-response-box">' + escapeHtml(state.ideationResponse || snapshot.lastAtlasResponse || 'Atlas feedback will appear here after you run the ideation loop.').replace(/\n/g, '<br/>') + '</div>' +
        '<div class="panel-card">' +
          '<p class="section-kicker">Next prompts</p>' +
          '<div class="ideation-chip-row">' +
            (snapshot.nextPrompts.length > 0
              ? snapshot.nextPrompts.map(prompt => '<button type="button" class="ideation-chip" data-action="ideation-prompt-chip" data-payload="' + escapeAttr(prompt) + '"' + tooltipAttrs('Click to copy this suggested follow-up prompt back into the composer for the next ideation pass.') + '>' + escapeHtml(prompt) + '</button>').join('')
              : '<span class="muted">Atlas will queue prompts here after the first pass.</span>') +
          '</div>' +
        '</div>' +
        '<div class="panel-card">' +
          '<p class="section-kicker">Next cards</p>' +
          (Array.isArray(snapshot.nextCards) && snapshot.nextCards.length > 0
            ? '<div class="ideation-analytics-suggestion-grid">' + snapshot.nextCards.map((card, index) =>
                '<button type="button" class="ideation-analytics-suggestion" data-action="ideation-insert-next-card" data-payload="' + escapeAttr(String(index)) + '"' + tooltipAttrs('Insert this suggested missing card directly into the canvas and link it into the current board.') + '>' +
                  '<span class="tag">' + escapeHtml(card.kind) + '</span>' +
                  '<strong>' + escapeHtml(card.title) + '</strong>' +
                  '<span class="section-copy">' + escapeHtml(card.rationale) + '</span>' +
                '</button>'
              ).join('') + '</div>'
            : '<span class="muted">Atlas will suggest missing card types here when the latest facilitation pass leaves obvious gaps.</span>') +
        '</div>' +
        '<div class="panel-card">' +
          '<p class="section-kicker">Evolution log</p>' +
          '<div class="ideation-history-list">' +
            (snapshot.runs.length > 0
              ? snapshot.runs.slice(-5).reverse().map(run => '<div class="panel-card"><div class="row-head"><strong>' + escapeHtml(run.deltaSummary) + '</strong><span class="list-meta">' + escapeHtml(relativeLabel(run.createdAt)) + '</span></div><div class="stat-detail">' + escapeHtml(run.prompt) + '</div></div>').join('')
              : '<div class="dashboard-empty"><div><strong>No evolution runs yet</strong><p class="section-copy">Each Atlas ideation pass will store a context packet and delta summary here.</p></div></div>') +
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

  function renderAnalytics(snapshot) {
    const activeCards = snapshot.cards.filter(card => !card.archivedAt);
    const archivedCount = snapshot.cards.length - activeCards.length;
    const biasWarnings = computeBiasWarnings(activeCards);
    const staleCards = activeCards.filter(card => (snapshot.staleCardIds || []).includes(card.id));
    const topPairs = computeConfidenceVsRisk(activeCards);
    const typeDist = computeTypeDistribution(activeCards);
    const analyticsIssues = computeAnalyticsIssues(snapshot, activeCards, staleCards);
    const issueIds = new Set(analyticsIssues.map(issue => issue.id));
    if (state.expandedAnalyticsIssueId && !issueIds.has(state.expandedAnalyticsIssueId)) {
      state.expandedAnalyticsIssueId = '';
    }

    return '' +
      '<article class="panel-card ideation-analytics-panel"' + tooltipAttrs('Use meta-thinking to spot bias, missing evidence, stale threads, and risky confidence gaps before sending the idea into execution.') + '>' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Meta-thinking</p>' +
            '<h3>Board analytics</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<button type="button" class="action-link dashboard-button-solid" data-action="ideation-run-deep-analysis" ' + (state.ideationBusy ? 'disabled' : '') + tooltipAttrs('Run a deeper review of the board to surface bias, blind spots, stale cards, and missing action paths.') + '>Deep Analysis</button>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-analytics-grid">' +
          '<div class="panel-card">' +
            '<p class="section-kicker">Type distribution</p>' +
            (typeDist.length > 0
              ? '<div class="ideation-dist-list">' +
                  typeDist.map(entry =>
                    '<div class="ideation-dist-row">' +
                      '<span class="tag">' + escapeHtml(entry.kind) + '</span>' +
                      '<div class="ideation-dist-bar-wrap"><div class="ideation-dist-bar" style="width:' + escapeAttr(String(Math.round(entry.pct))) + '%"></div></div>' +
                      '<span class="stat-detail">' + escapeHtml(String(entry.count)) + '</span>' +
                    '</div>'
                  ).join('') +
                '</div>'
              : '<span class="muted">No cards yet.</span>') +
            (archivedCount > 0 ? '<div class="stat-detail" style="margin-top:8px">' + escapeHtml(String(archivedCount)) + ' card' + (archivedCount === 1 ? '' : 's') + ' archived.</div>' : '') +
          '</div>' +
          '<div class="panel-card">' +
            '<p class="section-kicker">Bias checks</p>' +
            (analyticsIssues.filter(issue => issue.category === 'bias').length > 0
              ? '<div class="ideation-validation-list">' + analyticsIssues.filter(issue => issue.category === 'bias').map(issue => renderAnalyticsIssue(issue)).join('') + '</div>'
              : '<div class="tag tag-good">No major bias patterns detected.</div>') +
          '</div>' +
          '<div class="panel-card">' +
            '<p class="section-kicker">Stale cards</p>' +
            (analyticsIssues.filter(issue => issue.category === 'stale').length > 0
              ? '<div class="ideation-history-list">' + analyticsIssues.filter(issue => issue.category === 'stale').map(issue => renderAnalyticsIssue(issue)).join('') + '</div>'
              : '<div class="tag tag-good">No stale experiment or risk cards.</div>') +
          '</div>' +
          '<div class="panel-card">' +
            '<p class="section-kicker">Confidence vs. risk</p>' +
            (topPairs.length > 0
              ? '<div class="ideation-history-list">' +
                  topPairs.slice(0, 6).map(card =>
                    '<div class="ideation-dist-row">' +
                      '<span class="tag">' + escapeHtml(card.kind) + '</span>' +
                      '<span class="stat-detail">' + escapeHtml(card.title) + '</span>' +
                      '<span class="list-meta">C' + escapeHtml(String(card.confidence)) + ' R' + escapeHtml(String(card.riskScore)) + '</span>' +
                    '</div>'
                  ).join('') +
                '</div>'
              : '<span class="muted">No scored cards yet.</span>') +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderAnalyticsIssue(issue) {
    const expanded = state.expandedAnalyticsIssueId === issue.id;
    return '' +
      '<div class="ideation-analytics-issue ' + (expanded ? 'expanded' : '') + '">' +
        '<button type="button" class="tag tag-warn ideation-insight-button" data-action="ideation-toggle-analytics-issue" data-payload="' + escapeAttr(issue.id) + '">' + escapeHtml(issue.message) + '</button>' +
        (expanded
          ? '<div class="ideation-analytics-actions">' +
              '<p class="section-copy">' + escapeHtml(issue.helpText) + '</p>' +
              '<div class="ideation-analytics-suggestion-grid">' +
                issue.suggestions.map((suggestion, index) => '' +
                  '<button type="button" class="ideation-analytics-suggestion" data-action="ideation-insert-analytics-suggestion" data-payload="' + escapeAttr(issue.id + '::' + index) + '">' +
                    '<span class="tag">' + escapeHtml(suggestion.kind) + '</span>' +
                    '<strong>' + escapeHtml(suggestion.title) + '</strong>' +
                    '<span class="section-copy">' + escapeHtml(suggestion.body) + '</span>' +
                  '</button>'
                ).join('') +
              '</div>' +
            '</div>'
          : '') +
      '</div>';
  }

  function computeTypeDistribution(cards) {
    const counts = {};
    for (const card of cards) {
      counts[card.kind] = (counts[card.kind] || 0) + 1;
    }
    const total = cards.length || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ kind, count, pct: (count / total) * 100 }));
  }

  function computeBiasWarnings(cards) {
    if (cards.length === 0) {
      return [];
    }
    const warnings = [];
    const counts = {};
    for (const card of cards) {
      counts[card.kind] = (counts[card.kind] || 0) + 1;
    }
    const total = cards.length;
    if ((counts['idea'] || 0) / total > 0.5 && (counts['experiment'] || 0) === 0) {
      warnings.push('Ideas dominate but no experiment cards — ideas need validation paths.');
    }
    if ((counts['risk'] || 0) === 0 && total >= 4) {
      warnings.push('No risk cards — consider what could fail.');
    }
    if ((counts['evidence'] || 0) === 0 && total >= 4) {
      warnings.push('No evidence cards — ideas are not grounded in artifacts.');
    }
    const avgConf = cards.reduce((sum, card) => sum + (card.confidence || 50), 0) / total;
    const avgEvidence = cards.reduce((sum, card) => sum + (card.evidenceStrength || 35), 0) / total;
    if (avgConf > 68 && avgEvidence < 40) {
      warnings.push('High average confidence (' + Math.round(avgConf) + ') with weak evidence (' + Math.round(avgEvidence) + ') — optimism risk.');
    }
    const authorCounts = {};
    for (const card of cards) {
      authorCounts[card.author] = (authorCounts[card.author] || 0) + 1;
    }
    if ((authorCounts['atlas'] || 0) === total && total >= 4) {
      warnings.push('All cards generated by Atlas — add your own perspective.');
    }
    if ((authorCounts['user'] || 0) === total && total >= 4) {
      warnings.push('All cards from you — run the Atlas loop to get an outside view.');
    }
    return warnings;
  }

  function computeAnalyticsIssues(snapshot, cards, staleCards) {
    if (!snapshot) {
      return [];
    }
    const issues = [];
    const counts = {};
    const authorCounts = {};
    for (const card of cards) {
      counts[card.kind] = (counts[card.kind] || 0) + 1;
      authorCounts[card.author] = (authorCounts[card.author] || 0) + 1;
    }
    const total = cards.length || 1;
    const leadIdea = cards.find(card => card.kind === 'idea' && !card.archivedAt) || cards[0];
    const avgConf = cards.length > 0 ? cards.reduce((sum, card) => sum + (card.confidence || 50), 0) / cards.length : 0;
    const avgEvidence = cards.length > 0 ? cards.reduce((sum, card) => sum + (card.evidenceStrength || 35), 0) / cards.length : 0;

    if ((counts.idea || 0) / total > 0.5 && (counts.experiment || 0) === 0 && leadIdea) {
      issues.push({
        id: 'bias-idea-without-experiment',
        category: 'bias',
        message: 'Ideas dominate but no experiment cards.',
        helpText: 'Insert a validation path directly onto the canvas so the dominant idea has a concrete next test.',
        suggestions: [
          buildExperimentSuggestion('Smoke test', leadIdea, 'Launch a fast fake-door or concierge smoke test that checks whether the target user will take the first commitment step.'),
          buildExperimentSuggestion('Landing page validation', leadIdea, 'Draft a one-page value proposition test with a clear CTA, traffic source, and success threshold.'),
          buildEvidenceSuggestion('Validation signals', leadIdea, 'Capture the success signal, threshold, and failure condition that would make this idea worth pursuing.'),
        ],
      });
    }

    if ((counts.risk || 0) === 0 && cards.length >= 4 && leadIdea) {
      issues.push({
        id: 'bias-no-risk-cards',
        category: 'bias',
        message: 'No risk cards are on the board.',
        helpText: 'Add failure-mode cards so the board can test what would break before execution starts.',
        suggestions: [
          buildRiskSuggestion('Adoption risk', leadIdea, 'Describe why the target user might ignore or reject this idea and what early signal would reveal that.'),
          buildRiskSuggestion('Delivery risk', leadIdea, 'Describe the implementation, dependency, or operational risk most likely to slow delivery.'),
        ],
      });
    }

    if ((counts.evidence || 0) === 0 && cards.length >= 4 && leadIdea) {
      issues.push({
        id: 'bias-no-evidence-cards',
        category: 'bias',
        message: 'No evidence cards are grounding the board.',
        helpText: 'Insert artifacts or proof targets so the board ties ideas back to observable signals.',
        suggestions: [
          buildEvidenceSuggestion('User evidence to collect', leadIdea, 'Capture the user quote, interview note, screenshot, or artifact that would most directly validate this idea.'),
          buildEvidenceSuggestion('Benchmark artifact', leadIdea, 'Capture a competitor, workflow, or current-state artifact that grounds the opportunity in reality.'),
        ],
      });
    }

    if (avgConf > 68 && avgEvidence < 40 && leadIdea) {
      issues.push({
        id: 'bias-optimism-risk',
        category: 'bias',
        message: 'Confidence is outrunning evidence.',
        helpText: 'Add a fast falsification path so the board can challenge its most confident assumptions.',
        suggestions: [
          buildExperimentSuggestion('Kill-criteria experiment', leadIdea, 'Define the fastest test that could prove this idea should be dropped or narrowed.'),
          buildEvidenceSuggestion('Evidence gap log', leadIdea, 'List the exact unknowns, what would answer them, and who can supply that evidence.'),
        ],
      });
    }

    if ((authorCounts.atlas || 0) === cards.length && cards.length >= 4) {
      issues.push({
        id: 'bias-all-atlas',
        category: 'bias',
        message: 'All cards came from Atlas.',
        helpText: 'Add operator-originated cards that capture your own observations, dissent, or field evidence.',
        suggestions: [
          buildUserInsightSuggestion('Operator gut check', leadIdea, 'Record the part of this idea you trust least and why, in your own words.'),
          buildEvidenceSuggestion('First-hand proof request', leadIdea, 'Capture the specific proof you want before you believe this direction.'),
        ],
      });
    }

    if ((authorCounts.user || 0) === cards.length && cards.length >= 4) {
      issues.push({
        id: 'bias-all-user',
        category: 'bias',
        message: 'All cards came from you.',
        helpText: 'Add an outside perspective card so the board includes a challenge, synthesis, or neutral framing.',
        suggestions: [
          buildRiskSuggestion('External critique', leadIdea, 'Capture the strongest skeptical argument an outsider would make against this idea.'),
          buildExperimentSuggestion('Outside-view validation', leadIdea, 'Create a low-cost test that collects feedback from someone who has no investment in the idea.'),
        ],
      });
    }

    staleCards.forEach(card => {
      issues.push({
        id: 'stale-' + card.id,
        category: 'stale',
        message: card.title + ' has gone stale.',
        helpText: 'Refresh the thread with a specific next action instead of letting the stale card sit unresolved.',
        suggestions: [
          buildExperimentSuggestion('Refresh validation', card, 'Define the next smallest test, owner, and learning signal needed to revive this stale thread.'),
          buildRequirementSuggestion('Decision checkpoint', card, 'State whether this thread should be archived, narrowed, or advanced, and what condition decides that.'),
        ],
      });
    });

    return issues;
  }

  function buildExperimentSuggestion(prefix, sourceCard, body) {
    return {
      title: prefix + ': ' + (sourceCard ? sourceCard.title : 'Idea'),
      body,
      kind: 'experiment',
      sourceCardId: sourceCard ? sourceCard.id : '',
      tags: ['validation'],
      confidence: 55,
      evidenceStrength: 35,
      riskScore: 35,
      costToValidate: 30,
    };
  }

  function buildEvidenceSuggestion(prefix, sourceCard, body) {
    return {
      title: prefix + ': ' + (sourceCard ? sourceCard.title : 'Idea'),
      body,
      kind: 'evidence',
      sourceCardId: sourceCard ? sourceCard.id : '',
      tags: ['evidence'],
      confidence: 50,
      evidenceStrength: 55,
      riskScore: 25,
      costToValidate: 20,
    };
  }

  function buildRiskSuggestion(prefix, sourceCard, body) {
    return {
      title: prefix + ': ' + (sourceCard ? sourceCard.title : 'Idea'),
      body,
      kind: 'risk',
      sourceCardId: sourceCard ? sourceCard.id : '',
      tags: ['risk-review'],
      confidence: 40,
      evidenceStrength: 30,
      riskScore: 70,
      costToValidate: 20,
    };
  }

  function buildRequirementSuggestion(prefix, sourceCard, body) {
    return {
      title: prefix + ': ' + (sourceCard ? sourceCard.title : 'Idea'),
      body,
      kind: 'requirement',
      sourceCardId: sourceCard ? sourceCard.id : '',
      tags: ['decision'],
      confidence: 50,
      evidenceStrength: 35,
      riskScore: 30,
      costToValidate: 25,
    };
  }

  function buildUserInsightSuggestion(prefix, sourceCard, body) {
    return {
      title: prefix + ': ' + (sourceCard ? sourceCard.title : 'Idea'),
      body,
      kind: 'user-insight',
      sourceCardId: sourceCard ? sourceCard.id : '',
      tags: ['operator'],
      confidence: 50,
      evidenceStrength: 35,
      riskScore: 30,
      costToValidate: 15,
    };
  }

  function insertAnalyticsSuggestion(payload) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    const [issueId, indexText] = String(payload || '').split('::');
    const issue = computeAnalyticsIssues(snapshot, snapshot.cards.filter(card => !card.archivedAt), snapshot.cards.filter(card => !card.archivedAt && (snapshot.staleCardIds || []).includes(card.id))).find(entry => entry.id === issueId);
    const suggestion = issue && issue.suggestions[Number(indexText)];
    if (!suggestion) {
      return;
    }

    insertSuggestedCard(snapshot, suggestion, 'Inserted analytics suggestion: ');
  }

  function insertNextCardSuggestion(payload) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    const suggestion = Array.isArray(snapshot.nextCards) ? snapshot.nextCards[Number(payload)] : undefined;
    if (!suggestion) {
      return;
    }

    insertSuggestedCard(snapshot, suggestion, 'Inserted next-card suggestion: ');
  }

  function insertSuggestedCard(snapshot, suggestion, statusPrefix) {
    const sourceCard = suggestion.sourceCardId ? findIdeationCard(suggestion.sourceCardId) : getSelectedCard();
    const base = sourceCard || resolveSelectedCard(snapshot);
    const now = new Date().toISOString();
    const placement = findOpenBoardPosition(snapshot.cards, (base?.x || 0) + 84, (base?.y || 0) + 68, base?.id);
    const card = {
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: suggestion.title,
      body: suggestion.body,
      kind: suggestion.kind,
      author: 'user',
      x: placement.x,
      y: placement.y,
      color: colorForCardKind(suggestion.kind),
      imageSources: [],
      media: [],
      tags: (suggestion.tags || []).slice(0, 8),
      confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : 50,
      evidenceStrength: typeof suggestion.evidenceStrength === 'number' ? suggestion.evidenceStrength : 35,
      riskScore: typeof suggestion.riskScore === 'number' ? suggestion.riskScore : 30,
      costToValidate: typeof suggestion.costToValidate === 'number' ? suggestion.costToValidate : 25,
      syncTargets: [],
      parentCardId: base ? base.id : undefined,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    snapshot.cards = snapshot.cards.concat(card).slice(-48);
    appendAutoConnection(snapshot, base?.id || suggestion.sourceCardId, card);
    state.selectedCardId = card.id;
    state.selectedLinkId = '';
    state.editingCardId = card.id;
    state.ideationStatus = statusPrefix + card.title + '.';
    scheduleIdeationSave();
    render();
    focusInlineEditor();
  }

  function computeConfidenceVsRisk(cards) {
    return cards
      .filter(card => card.kind !== 'atlas-response' && card.kind !== 'attachment')
      .slice()
      .sort((a, b) => ((b.confidence || 50) - (b.riskScore || 30)) - ((a.confidence || 50) - (a.riskScore || 30)));
  }

  function renderLensOption(value, label) {
    return '<option value="' + value + '" ' + (state.boardLens === value ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function renderRelationFilterOption(value, label) {
    return '<option value="' + value + '" ' + (state.relationFilter === value ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function renderPromptInferencePreview() {
    const container = document.getElementById('ideationPromptInference');
    if (!(container instanceof HTMLElement) || !state.snapshot) {
      return;
    }
    container.innerHTML = renderPromptInferencePreviewMarkup(getPromptValue(), state.snapshot);
  }

  function renderPromptInferencePreviewMarkup(prompt, snapshot) {
    const inference = inferPromptPreview(prompt, snapshot);
    return '' +
      '<div class="row-head">' +
        '<div>' +
          '<p class="section-kicker">Prompt inference</p>' +
          '<h4>Likely scaffold before Atlas answers</h4>' +
        '</div>' +
      '</div>' +
      (inference.items.length > 0
        ? '<div class="ideation-chip-row">' + inference.items.map(item => '<span class="tag"' + tooltipAttrs('Atlas is likely to scaffold this board facet from the current prompt before it adds deeper facilitation output.') + '>' + escapeHtml(item) + '</span>').join('') + '</div>'
        : '<div class="stat-detail">Type a sharper prompt and Atlas will preview which board facets it is likely to scaffold, update, or reconnect.</div>') +
      (inference.detail ? '<div class="stat-detail" style="margin-top:8px">' + escapeHtml(inference.detail) + '</div>' : '');
  }

  function renderProcessGuide(snapshot) {
    const activeCards = snapshot.cards.filter(card => !card.archivedAt).length;
    const hasRuns = snapshot.runs.length > 0;
    const hasLinks = snapshot.connections.length > 0;
    const readyForRun = snapshot.cards.some(card => !card.archivedAt && (card.kind === 'experiment' || card.kind === 'requirement' || card.kind === 'risk'));
    const stages = [
      {
        title: '1. Frame the problem',
        status: getProcessStageStatus(activeCards === 0 && !hasRuns ? 'active' : 'done'),
        summary: activeCards === 0 ? 'Start with a prompt, constraints, and any evidence you already have.' : 'A problem frame exists and can be refined further.',
        tooltip: 'Begin by describing the idea, comparison, or problem in the composer. Add constraints and attachments so Atlas starts from a real frame instead of a blank abstraction.',
      },
      {
        title: '2. Let Atlas scaffold',
        status: getProcessStageStatus(activeCards > 0 && !hasRuns ? 'active' : (hasRuns ? 'done' : 'pending')),
        summary: hasRuns ? 'Atlas has already scaffolded or evolved this board.' : 'Run the composer to let Atlas create or reshape the board structure.',
        tooltip: 'Atlas turns the prompt into initial cards, relationships, and follow-up prompts. This is the first pass where raw text becomes board structure.',
      },
      {
        title: '3. Shape and challenge the board',
        status: getProcessStageStatus(hasLinks || snapshot.nextCards.length > 0 ? 'active' : (hasRuns ? 'pending' : 'pending')),
        summary: hasLinks ? 'Cards are being connected and challenged.' : 'Use links, Next Cards, and Deep Analysis to fill gaps and clarify the idea.',
        tooltip: 'This is where you edit cards, add relationships, use Next Cards, and run deep analysis so the board stops being a loose brainstorm and becomes an intentional map.',
      },
      {
        title: '4. Decide what to validate or run',
        status: getProcessStageStatus(readyForRun ? 'active' : 'pending'),
        summary: readyForRun ? 'The board has enough structure to validate or send focused cards into Project Run Center.' : 'Add experiments, risks, or requirements before handing the idea off to execution.',
        tooltip: 'When the board has a clear experiment path, explicit constraints, and known risks, you can promote a card into Project Run Center or keep iterating.',
      },
    ];

    return '' +
      '<article class="ideation-panel ideation-process-panel">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Guided flow</p>' +
            '<h3>How this ideation phase works</h3>' +
          '</div>' +
          '<span class="tag"' + tooltipAttrs('This guide explains the intended order of operations so first-time users understand what the ideation phase is trying to achieve.') + '>Staged workflow</span>' +
        '</div>' +
        '<div class="ideation-process-grid">' + stages.map(stage =>
          '<div class="ideation-process-card ideation-process-' + stage.status.tone + '"' + tooltipAttrs(stage.tooltip, true) + '>' +
            '<div class="row-head">' +
              '<strong>' + escapeHtml(stage.title) + '</strong>' +
              '<span class="tag ' + stage.status.tag + '">' + escapeHtml(stage.status.label) + '</span>' +
            '</div>' +
            '<p class="section-copy">' + escapeHtml(stage.summary) + '</p>' +
          '</div>'
        ).join('') + '</div>' +
      '</article>';
  }

  function getProcessStageStatus(kind) {
    if (kind === 'done') {
      return { label: 'Done', tag: 'tag-good', tone: 'done' };
    }
    if (kind === 'active') {
      return { label: 'Now', tag: 'tag-warn', tone: 'active' };
    }
    return { label: 'Later', tag: '', tone: 'pending' };
  }

  function tooltipAttrs(text, focusable) {
    if (!text) {
      return '';
    }
    return ' data-tooltip="' + escapeAttr(text) + '" title="' + escapeAttr(text) + '"' + (focusable ? ' tabindex="0"' : '');
  }

  function inferPromptPreview(prompt, snapshot) {
    const trimmed = (prompt || '').trim();
    if (!trimmed) {
      return { items: [], detail: '' };
    }
    const items = [];
    const urls = extractPromptUrls(trimmed);
    if (urls.length > 0) {
      items.push('Reference evidence from ' + shortPromptUrl(urls[0]) + (urls.length > 1 ? ' +' + (urls.length - 1) : ''));
    }
    if (/(benefit|analysis|trade-?off|compare|comparison|evaluate|assessment|worth|why)/i.test(trimmed)) {
      items.push('Decision framing');
    }
    if (/(memory|ssot|context|knowledge|project_memory|memory system)/i.test(trimmed)) {
      items.push('Current memory-system context');
      items.push('Code considerations');
      items.push('Operator workflow impact');
      items.push('Teams and process impact');
    } else {
      if (/(code|implementation|architecture|technical|integration|system|repo|extension)/i.test(trimmed)) {
        items.push('Code considerations');
      }
      if (/(ui|ux|workflow|panel|webview|experience|operator)/i.test(trimmed)) {
        items.push('Operator workflow impact');
      }
      if (/(team|process|owner|ownership|release|product|design|engineering|support|operations)/i.test(trimmed)) {
        items.push('Teams and process impact');
      }
    }
    return {
      items: [...new Set(items)].slice(0, 6),
      detail: snapshot.cards.length > 0
        ? 'Existing cards with matching titles or intent will be updated or archived where possible instead of always creating duplicates.'
        : 'The first pass will seed board structure from the prompt before Atlas adds deeper facilitation cards.',
    };
  }

  function extractPromptUrls(prompt) {
    return Array.from(prompt.matchAll(/https?:\/\/[^\s)\]]+/gi)).map(match => match[0]);
  }

  function shortPromptUrl(url) {
    try {
      const parsed = new URL(url);
      const pathBits = parsed.pathname.replace(/\/$/, '').split('/').filter(Boolean).slice(-2).join('/');
      return pathBits ? parsed.hostname + '/' + pathBits : parsed.hostname;
    } catch {
      return clampText(url, 48);
    }
  }

  function renderScoreField(label, id, value) {
    return '<label class="ideation-score-field"><span class="section-kicker">' + escapeHtml(label) + '</span><input id="' + id + '" type="range" min="0" max="100" step="1" value="' + escapeAttr(String(value || 0)) + '" /><span class="stat-detail">' + escapeHtml(String(value || 0)) + '</span></label>';
  }

  function renderSyncTargets(syncTargets) {
    const active = new Set(syncTargets || []);
    return '<div class="ideation-sync-grid">' +
      ['domain', 'operations', 'agents', 'knowledge-graph'].map(target => '<label class="ideation-check"><input type="checkbox" data-sync-target="' + target + '" ' + (active.has(target) ? 'checked' : '') + ' />' + escapeHtml(target) + '</label>').join('') +
      '</div>' +
      (active.size > 0
        ? '<div style="margin-top:10px"><button type="button" class="action-link dashboard-button-solid" data-action="ideation-sync-card">Sync to Memory</button></div>'
        : '<p class="stat-detail" style="margin-top:8px">Check targets above to sync this card into project memory.</p>');
  }

  function renderGenealogy(snapshot, card) {
    const lineage = [];
    let cursor = card;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      lineage.unshift(cursor);
      seen.add(cursor.id);
      cursor = cursor.parentCardId ? snapshot.cards.find(candidate => candidate.id === cursor.parentCardId) : undefined;
    }
    const sourcedRun = card.sourceRunId ? snapshot.runs.find(run => run.id === card.sourceRunId) : undefined;
    return '' +
      '<div class="ideation-chip-row">' +
        (lineage.length > 0 ? lineage.map(item => '<span class="tag">' + escapeHtml(item.title) + '</span>').join('') : '<span class="muted">No lineage captured yet.</span>') +
      '</div>' +
      (sourcedRun ? '<div class="stat-detail">Born in run: ' + escapeHtml(sourcedRun.deltaSummary) + '</div>' : '');
  }

  function renderCardTemplate(card) {
    const template = getCardTemplate(card.kind);
    return '<p class="section-kicker">Micro-template</p><div class="stat-detail">' + escapeHtml(template) + '</div>';
  }

  function renderValidationWarnings(card) {
    const warnings = getCardValidationWarnings(card);
    return warnings.length > 0
      ? '<div class="ideation-validation-list">' + warnings.map(item => '<div class="tag tag-warn">' + escapeHtml(item) + '</div>').join('') + '</div>'
      : '<div class="ideation-validation-list"><div class="tag tag-good">Validation checks satisfied</div></div>';
  }

  function renderError(message) {
    if (!root) {
      return;
    }
    root.innerHTML = '<div class="dashboard-empty"><div><strong>Ideation refresh failed</strong><div class="stat-detail">' + escapeHtml(message) + '</div></div></div>';
  }

  function renderIdeationConnections(boardView, lod) {
    const selectionState = getSelectionState();
    const cardLayouts = new Map(boardView.cards.map(card => [card.id, getCardLayout(card, lod)]));
    const placedLabelRects = [];
    return '' +
      '<defs>' +
        '<marker id="ideationArrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="currentColor"></path></marker>' +
        '<marker id="ideationDiamond" markerWidth="10" markerHeight="10" refX="6" refY="5" orient="auto"><path d="M 1 5 L 5 1 L 9 5 L 5 9 z" fill="currentColor"></path></marker>' +
        '<marker id="ideationDot" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="currentColor"></circle></marker>' +
        '<marker id="ideationBar" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M 5 1 L 5 9" stroke="currentColor" stroke-width="2"></path></marker>' +
      '</defs>' + boardView.connections.map(connection => {
      const fromLayout = cardLayouts.get(connection.fromCardId);
      const toLayout = cardLayouts.get(connection.toCardId);
      if (!fromLayout || !toLayout) {
        return '';
      }
      const connectionGeometry = buildConnectionGeometry(connection, fromLayout, toLayout, cardLayouts, state.linkPathMode);
      const lineStyleClass = connection.style === 'solid' ? 'solid' : 'dotted';
      const relationClass = 'relation-' + escapeAttr(connection.relation || 'supports');
      const markerId = markerIdForConnection(connection);
      const markerStart = connection.direction === 'reverse' || connection.direction === 'both' ? 'url(#' + markerId + ')' : '';
      const markerEnd = connection.direction === 'forward' || connection.direction === 'both' ? 'url(#' + markerId + ')' : '';
      const mutedClass = selectionState.active && !selectionState.relatedConnectionIds.has(connection.id) ? 'muted' : '';
      const labelMarkup = shouldRenderLinkLabel(connection, lod)
        ? renderConnectionLabel(connection, relationClass, connectionGeometry, cardLayouts, placedLabelRects)
        : '';
      return '' +
        '<g class="ideation-link-group ' + relationClass + ' ' + mutedClass + ' ' + (state.selectedLinkId === connection.id ? 'selected' : '') + '" data-link-id="' + escapeAttr(connection.id) + '" data-action="ideation-select-link" data-payload="' + escapeAttr(connection.id) + '">' +
          '<path class="ideation-link-hitbox" d="' + connectionGeometry.pathData + '"></path>' +
          '<path class="ideation-link ' + lineStyleClass + '" d="' + connectionGeometry.pathData + '"' + (markerStart ? ' marker-start="' + markerStart + '"' : '') + (markerEnd ? ' marker-end="' + markerEnd + '"' : '') + '></path>' +
          labelMarkup +
        '</g>';
    }).join('');
  }

  function renderConnectionLabel(connection, relationClass, connectionGeometry, cardLayouts, placedLabelRects) {
    const label = relationDisplayLabel(connection);
    const placement = placeConnectionLabel(label, connectionGeometry, cardLayouts, placedLabelRects);
    if (!placement) {
      return '';
    }
    placedLabelRects.push(placement.rect);
    return '' +
      '<g class="ideation-link-label-badge ' + relationClass + '">' +
        '<rect class="ideation-link-label-chip ' + relationClass + '" x="' + placement.rect.left + '" y="' + placement.rect.top + '" width="' + placement.rect.width + '" height="' + placement.rect.height + '" rx="10" ry="10"></rect>' +
        '<text class="ideation-link-label ' + relationClass + '" x="' + placement.textX + '" y="' + placement.textY + '">' + escapeHtml(label) + '</text>' +
      '</g>';
  }

  function getCardLayout(card, lod) {
    const footprint = getCardFootprint(card.id, lod);
    const left = BOARD_WORLD_ORIGIN_X + card.x;
    const top = BOARD_WORLD_ORIGIN_Y + card.y;
    return {
      card,
      width: footprint.width,
      height: footprint.height,
      left,
      top,
      right: left + footprint.width,
      bottom: top + footprint.height,
      centerX: left + (footprint.width / 2),
      centerY: top + (footprint.height / 2),
    };
  }

  function getCardFootprint(cardId, lod) {
    const cardElement = root?.querySelector('[data-card-id="' + cssEscape(cardId) + '"]');
    if (cardElement instanceof HTMLElement && cardElement.offsetWidth > 0 && cardElement.offsetHeight > 0) {
      return { width: cardElement.offsetWidth, height: cardElement.offsetHeight };
    }
    if (lod === 'minimal') {
      return { width: 152, height: 128 };
    }
    if (lod === 'compact') {
      return { width: 184, height: 152 };
    }
    return { width: CARD_WIDTH, height: CARD_HEIGHT };
  }

  function projectPointToCardEdge(centerX, centerY, targetX, targetY, width, height, inset) {
    const dx = targetX - centerX;
    const dy = targetY - centerY;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return { x: centerX, y: centerY };
    }
    const halfWidth = Math.max(12, (width / 2) - inset);
    const halfHeight = Math.max(12, (height / 2) - inset);
    const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
    return {
      x: centerX + (dx * scale),
      y: centerY + (dy * scale),
    };
  }

  function relationDisplayLabel(connection) {
    const label = String(connection.label || relationLabel(connection.relation || 'supports'));
    if (connection.direction === 'reverse') {
      return '<- ' + label;
    }
    if (connection.direction === 'both') {
      return '<-> ' + label;
    }
    if (connection.direction === 'forward') {
      return label + ' ->';
    }
    return label;
  }

  function buildConnectionGeometry(connection, fromLayout, toLayout, cardLayouts, mode) {
    const startPoint = projectPointToCardEdge(
      fromLayout.centerX,
      fromLayout.centerY,
      toLayout.centerX,
      toLayout.centerY,
      fromLayout.width,
      fromLayout.height,
      10,
    );
    const endPoint = projectPointToCardEdge(
      toLayout.centerX,
      toLayout.centerY,
      fromLayout.centerX,
      fromLayout.centerY,
      toLayout.width,
      toLayout.height,
      14,
    );
    const route = selectConnectionRoute(connection, startPoint, endPoint, fromLayout, toLayout, cardLayouts, mode);
    const pathData = buildConnectionPath(connection, route, mode);
    return {
      pathData,
      labelX: route.labelPoint.x,
      labelY: route.labelPoint.y,
      routePoints: route.points,
      axis: route.axis,
    };
  }

  function placeConnectionLabel(label, connectionGeometry, cardLayouts, placedLabelRects) {
    const dimensions = estimateLabelRect(label);
    const routePoints = connectionGeometry.routePoints && connectionGeometry.routePoints.length
      ? connectionGeometry.routePoints
      : [{ x: connectionGeometry.labelX, y: connectionGeometry.labelY }];
    const preferredOffsets = connectionGeometry.axis === 'vertical'
      ? [{ x: 18, y: 0 }, { x: -18, y: 0 }, { x: 28, y: -18 }, { x: -28, y: 18 }, { x: 36, y: 0 }, { x: -36, y: 0 }]
      : [{ x: 0, y: -18 }, { x: 0, y: 18 }, { x: 24, y: -18 }, { x: -24, y: 18 }, { x: 0, y: -34 }, { x: 0, y: 34 }];
    const pointIndexes = [0.25, 0.5, 0.75].map(ratio => Math.min(routePoints.length - 1, Math.max(0, Math.round((routePoints.length - 1) * ratio))));
    const obstacleRects = [
      ...Array.from(cardLayouts.values()).map(layout => inflateRect(layout, 10)),
      ...placedLabelRects.map(rect => inflateRect(rect, 6)),
    ];
    let best = null;
    for (const pointIndex of pointIndexes) {
      const anchor = routePoints[pointIndex] || routePoints[Math.floor(routePoints.length / 2)];
      for (const offset of preferredOffsets) {
        const rect = {
          left: anchor.x + offset.x - (dimensions.width / 2),
          top: anchor.y + offset.y - (dimensions.height / 2),
          width: dimensions.width,
          height: dimensions.height,
        };
        rect.right = rect.left + rect.width;
        rect.bottom = rect.top + rect.height;
        const score = scoreLabelRect(rect, obstacleRects, anchor, connectionGeometry);
        if (!best || score < best.score) {
          best = {
            score,
            rect,
            textX: rect.left + (rect.width / 2),
            textY: rect.top + rect.height - 7,
          };
        }
      }
    }
    return best;
  }

  function estimateLabelRect(label) {
    const width = Math.max(56, Math.min(210, Math.round((String(label).length * 7.1) + 20)));
    return { width, height: 22 };
  }

  function scoreLabelRect(rect, obstacles, anchor, connectionGeometry) {
    let penalty = 0;
    for (const obstacle of obstacles) {
      if (rectsOverlap(rect, obstacle)) {
        penalty += 3600;
        continue;
      }
      const distance = distanceRectToRect(rect, obstacle);
      if (distance < 16) {
        penalty += (16 - distance) * 120;
      }
    }
    if (rect.left < 16 || rect.right > (BOARD_WORLD_WIDTH - 16) || rect.top < 16 || rect.bottom > (BOARD_WORLD_HEIGHT - 16)) {
      penalty += 4200;
    }
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    penalty += Math.abs(centerX - connectionGeometry.labelX) * 0.25;
    penalty += Math.abs(centerY - connectionGeometry.labelY) * 0.25;
    penalty += Math.abs(centerX - anchor.x) * 0.18;
    penalty += Math.abs(centerY - anchor.y) * 0.18;
    return penalty;
  }

  function rectsOverlap(leftRect, rightRect) {
    return leftRect.left < rightRect.right
      && leftRect.right > rightRect.left
      && leftRect.top < rightRect.bottom
      && leftRect.bottom > rightRect.top;
  }

  function distanceRectToRect(leftRect, rightRect) {
    const dx = leftRect.right < rightRect.left
      ? rightRect.left - leftRect.right
      : (rightRect.right < leftRect.left ? leftRect.left - rightRect.right : 0);
    const dy = leftRect.bottom < rightRect.top
      ? rightRect.top - leftRect.bottom
      : (rightRect.bottom < leftRect.top ? leftRect.top - rightRect.bottom : 0);
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  function selectConnectionRoute(connection, startPoint, endPoint, fromLayout, toLayout, cardLayouts, mode) {
    const baseMidX = (startPoint.x + endPoint.x) / 2;
    const baseMidY = (startPoint.y + endPoint.y) / 2;
    const orientation = inferConnectionOrientation(startPoint, endPoint);
    const bias = getRelationRouteBias(connection, startPoint, endPoint);
    const obstacles = Array.from(cardLayouts.values())
      .filter(layout => layout.card.id !== fromLayout.card.id && layout.card.id !== toLayout.card.id)
      .map(layout => inflateRect(layout, 18));
    const candidates = buildRouteCandidates(startPoint, endPoint, obstacles, orientation, bias);
    let best = null;
    for (const candidate of candidates) {
      const scored = scoreConnectionCandidate(candidate, startPoint, endPoint, obstacles, orientation, bias, mode);
      if (!best || scored.score < best.score) {
        best = scored;
      }
    }
    return best || {
      axis: orientation,
      routeCoord: orientation === 'horizontal' ? baseMidY : baseMidX,
      lead: defaultConnectionLead(startPoint, endPoint),
      labelPoint: { x: baseMidX, y: baseMidY },
      score: 0,
    };
  }

  function inferConnectionOrientation(startPoint, endPoint) {
    return Math.abs(endXDelta(startPoint, endPoint)) >= Math.abs(endYDelta(startPoint, endPoint)) ? 'horizontal' : 'vertical';
  }

  function getRelationRouteBias(connection, startPoint, endPoint) {
    const signX = endPoint.x >= startPoint.x ? 1 : -1;
    if (connection.relation === 'dependency') {
      return { horizontal: 76, vertical: 92 * signX };
    }
    if (connection.relation === 'contradiction') {
      return { horizontal: 138, vertical: -124 * signX };
    }
    if (connection.relation === 'causal') {
      return { horizontal: -56, vertical: 68 * signX };
    }
    if (connection.relation === 'opportunity') {
      return { horizontal: -116, vertical: 108 * signX };
    }
    return { horizontal: 0, vertical: 0 };
  }

  function buildRouteCandidates(startPoint, endPoint, obstacles, orientation, bias) {
    const baseMidX = (startPoint.x + endPoint.x) / 2;
    const baseMidY = (startPoint.y + endPoint.y) / 2;
    const lead = defaultConnectionLead(startPoint, endPoint);
    const horizontalBase = clampNumber(baseMidY + bias.horizontal, 48, BOARD_WORLD_HEIGHT - 48);
    const verticalBase = clampNumber(baseMidX + bias.vertical, 48, BOARD_WORLD_WIDTH - 48);
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (axis, routeCoord, routeLead) => {
      const key = axis + ':' + Math.round(routeCoord) + ':' + Math.round(routeLead);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({ axis, routeCoord, lead: routeLead });
    };

    pushCandidate('horizontal', horizontalBase, lead);
    pushCandidate('horizontal', baseMidY, lead);
    pushCandidate('vertical', verticalBase, lead);
    pushCandidate('vertical', baseMidX, lead);

    const spanMinX = Math.min(startPoint.x, endPoint.x);
    const spanMaxX = Math.max(startPoint.x, endPoint.x);
    const spanMinY = Math.min(startPoint.y, endPoint.y);
    const spanMaxY = Math.max(startPoint.y, endPoint.y);
    for (const obstacle of obstacles) {
      if (obstacle.right >= spanMinX - 120 && obstacle.left <= spanMaxX + 120) {
        pushCandidate('horizontal', clampNumber(obstacle.top - 34, 48, BOARD_WORLD_HEIGHT - 48), lead + 24);
        pushCandidate('horizontal', clampNumber(obstacle.bottom + 34, 48, BOARD_WORLD_HEIGHT - 48), lead + 24);
      }
      if (obstacle.bottom >= spanMinY - 120 && obstacle.top <= spanMaxY + 120) {
        pushCandidate('vertical', clampNumber(obstacle.left - 34, 48, BOARD_WORLD_WIDTH - 48), lead + 18);
        pushCandidate('vertical', clampNumber(obstacle.right + 34, 48, BOARD_WORLD_WIDTH - 48), lead + 18);
      }
    }

    if (orientation === 'horizontal') {
      pushCandidate('horizontal', clampNumber(horizontalBase - 92, 48, BOARD_WORLD_HEIGHT - 48), lead);
      pushCandidate('horizontal', clampNumber(horizontalBase + 92, 48, BOARD_WORLD_HEIGHT - 48), lead);
    } else {
      pushCandidate('vertical', clampNumber(verticalBase - 92, 48, BOARD_WORLD_WIDTH - 48), lead);
      pushCandidate('vertical', clampNumber(verticalBase + 92, 48, BOARD_WORLD_WIDTH - 48), lead);
    }
    return candidates;
  }

  function defaultConnectionLead(startPoint, endPoint) {
    return Math.max(82, Math.min(192, Math.max(Math.abs(endPoint.x - startPoint.x), Math.abs(endPoint.y - startPoint.y)) * 0.3));
  }

  function scoreConnectionCandidate(candidate, startPoint, endPoint, obstacles, orientation, bias, mode) {
    const routeShape = mode === 'angular'
      ? buildAngularRoute(startPoint, endPoint, candidate)
      : buildSplineRoute(startPoint, endPoint, candidate);
    const points = routeShape.points;
    let overlapPenalty = 0;
    let proximityPenalty = 0;
    for (const point of points) {
      for (const obstacle of obstacles) {
        if (point.x > obstacle.left && point.x < obstacle.right && point.y > obstacle.top && point.y < obstacle.bottom) {
          overlapPenalty += 2400;
          continue;
        }
        const distance = distancePointToRect(point, obstacle);
        if (distance < 56) {
          proximityPenalty += (56 - distance) * 12;
        }
      }
    }
    const baseCoord = candidate.axis === 'horizontal'
      ? ((startPoint.y + endPoint.y) / 2) + bias.horizontal
      : ((startPoint.x + endPoint.x) / 2) + bias.vertical;
    const axisPenalty = candidate.axis === orientation ? 0 : 180;
    const driftPenalty = Math.abs(candidate.routeCoord - baseCoord) * 0.7;
    const leadPenalty = Math.abs(candidate.lead - defaultConnectionLead(startPoint, endPoint)) * 0.4;
    return {
      axis: candidate.axis,
      routeCoord: candidate.routeCoord,
      lead: candidate.lead,
      points: routeShape.points,
      start: routeShape.start,
      control1: routeShape.control1,
      control2: routeShape.control2,
      end: routeShape.end,
      labelPoint: routeShape.labelPoint,
      score: overlapPenalty + proximityPenalty + axisPenalty + driftPenalty + leadPenalty,
    };
  }

  function buildConnectionPath(connection, route, mode) {
    if (mode === 'angular') {
      return buildAngularConnectionPath(route);
    }
    return buildSplineConnectionPath(route);
  }

  function buildSplineConnectionPath(route) {
    if (route.axis === 'vertical') {
      return 'M ' + route.start.x + ' ' + route.start.y + ' C ' + route.control1.x + ' ' + route.control1.y + ', ' + route.control2.x + ' ' + route.control2.y + ', ' + route.end.x + ' ' + route.end.y;
    }
    return 'M ' + route.start.x + ' ' + route.start.y + ' C ' + route.control1.x + ' ' + route.control1.y + ', ' + route.control2.x + ' ' + route.control2.y + ', ' + route.end.x + ' ' + route.end.y;
  }

  function buildAngularConnectionPath(route) {
    return route.points.map((point, index) => (index === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y).join(' ');
  }

  function buildAngularRoute(startPoint, endPoint, candidate) {
    const signX = endPoint.x >= startPoint.x ? 1 : -1;
    const signY = endPoint.y >= startPoint.y ? 1 : -1;
    if (candidate.axis === 'vertical') {
      const startLeadY = startPoint.y + (signY * candidate.lead);
      const endLeadY = endPoint.y - (signY * candidate.lead);
      const points = [
        { x: startPoint.x, y: startPoint.y },
        { x: startPoint.x, y: startLeadY },
        { x: candidate.routeCoord, y: startLeadY },
        { x: candidate.routeCoord, y: endLeadY },
        { x: endPoint.x, y: endLeadY },
        { x: endPoint.x, y: endPoint.y },
      ];
      return {
        axis: candidate.axis,
        points,
        start: points[0],
        end: points[points.length - 1],
        labelPoint: sampleLabelPoint(points),
      };
    }
    const startLeadX = startPoint.x + (signX * candidate.lead);
    const endLeadX = endPoint.x - (signX * candidate.lead);
    const points = [
      { x: startPoint.x, y: startPoint.y },
      { x: startLeadX, y: startPoint.y },
      { x: startLeadX, y: candidate.routeCoord },
      { x: endLeadX, y: candidate.routeCoord },
      { x: endLeadX, y: endPoint.y },
      { x: endPoint.x, y: endPoint.y },
    ];
    return {
      axis: candidate.axis,
      points,
      start: points[0],
      end: points[points.length - 1],
      labelPoint: sampleLabelPoint(points),
    };
  }

  function buildSplineRoute(startPoint, endPoint, candidate) {
    const cubic = buildSplineControlPoints(startPoint, endPoint, candidate);
    const samples = [];
    for (let index = 0; index <= 16; index += 1) {
      samples.push(sampleCubicPoint(cubic.start, cubic.control1, cubic.control2, cubic.end, index / 16));
    }
    cubic.points = samples;
    cubic.labelPoint = sampleCubicPoint(cubic.start, cubic.control1, cubic.control2, cubic.end, 0.5);
    return cubic;
  }

  function buildSplineControlPoints(startPoint, endPoint, candidate) {
    const horizontalDistance = Math.abs(endPoint.x - startPoint.x);
    const verticalDistance = Math.abs(endPoint.y - startPoint.y);
    const signX = endPoint.x >= startPoint.x ? 1 : -1;
    const signY = endPoint.y >= startPoint.y ? 1 : -1;
    if (candidate.axis === 'vertical') {
      const pull = Math.max(72, Math.min(188, verticalDistance * 0.42));
      return {
        axis: candidate.axis,
        start: startPoint,
        control1: {
          x: startPoint.x + ((candidate.routeCoord - startPoint.x) * 0.74),
          y: startPoint.y + (signY * pull),
        },
        control2: {
          x: endPoint.x + ((candidate.routeCoord - endPoint.x) * 0.74),
          y: endPoint.y - (signY * pull),
        },
        end: endPoint,
      };
    }
    const pull = Math.max(84, Math.min(228, horizontalDistance * 0.38));
    return {
      axis: candidate.axis,
      start: startPoint,
      control1: {
        x: startPoint.x + (signX * pull),
        y: startPoint.y + ((candidate.routeCoord - startPoint.y) * 0.74),
      },
      control2: {
        x: endPoint.x - (signX * pull),
        y: endPoint.y + ((candidate.routeCoord - endPoint.y) * 0.74),
      },
      end: endPoint,
    };
  }

  function inflateRect(rect, padding) {
    return {
      left: rect.left - padding,
      top: rect.top - padding,
      right: rect.right + padding,
      bottom: rect.bottom + padding,
    };
  }

  function distancePointToRect(point, rect) {
    const dx = point.x < rect.left ? rect.left - point.x : (point.x > rect.right ? point.x - rect.right : 0);
    const dy = point.y < rect.top ? rect.top - point.y : (point.y > rect.bottom ? point.y - rect.bottom : 0);
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  function sampleLabelPoint(points) {
    if (!points.length) {
      return { x: 0, y: 0 };
    }
    return points[Math.floor(points.length / 2)];
  }

  function sampleCubicPoint(start, control1, control2, end, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: (mt2 * mt * start.x) + (3 * mt2 * t * control1.x) + (3 * mt * t2 * control2.x) + (t2 * t * end.x),
      y: (mt2 * mt * start.y) + (3 * mt2 * t * control1.y) + (3 * mt * t2 * control2.y) + (t2 * t * end.y),
    };
  }

  function endXDelta(startPoint, endPoint) {
    return endPoint.x - startPoint.x;
  }

  function endYDelta(startPoint, endPoint) {
    return endPoint.y - startPoint.y;
  }

  function markerIdForConnection(connection) {
    if (connection.relation === 'dependency') {
      return 'ideationDiamond';
    }
    if (connection.relation === 'contradiction') {
      return 'ideationBar';
    }
    if (connection.relation === 'supports') {
      return 'ideationDot';
    }
    return 'ideationArrow';
  }

  function renderIdeationCard(card, focusCardId, lod) {
    const selectionState = getSelectionState();
    const isEditing = state.editingCardId === card.id;
    const selectionOrder = state.orderedSelectedCardIds.indexOf(card.id);
    const selectionBadge = selectionOrder >= 0 ? String(selectionOrder + 1) : '';
    const footerMeta = [];
    if (focusCardId === card.id) {
      footerMeta.push('Focus');
    }
    if (state.selectedCardId === card.id) {
      footerMeta.push('Primary');
    }
    if (selectionOrder === 0 && state.orderedSelectedCardIds.length > 1) {
      footerMeta.push('Link source');
    }
    if (selectionOrder === 1) {
      footerMeta.push('Link target');
    }
    const flowRole = flowRoleForCard(card);
    const compactBody = clampText(card.body || 'Add notes to make the idea concrete.', lod === 'minimal' ? 0 : 92);
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
        (lod !== 'minimal' ? '<p>' + escapeHtml(compactBody) + '</p>' : '') +
        (lod === 'full' ? '<div class="ideation-card-media">' + mediaMarkup + '</div>' : '') +
        (lod === 'full' ? '<div class="ideation-card-scoreline"><span>C ' + escapeHtml(String(card.confidence || 0)) + '</span><span>E ' + escapeHtml(String(card.evidenceStrength || 0)) + '</span><span>R ' + escapeHtml(String(card.riskScore || 0)) + '</span><span>$ ' + escapeHtml(String(card.costToValidate || 0)) + '</span></div>' : '') +
        (lod === 'full' && (card.tags || []).length > 0 ? '<div class="ideation-chip-row">' + card.tags.map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>' : '') +
        '<div class="ideation-card-actions"><span class="tag">' + escapeHtml(card.author) + '</span><span class="tag">' + escapeHtml(card.kind) + '</span></div>';
    const mutedClass = selectionState.active && !selectionState.relatedCardIds.has(card.id) ? 'muted' : '';
    return '' +
      '<article class="ideation-card ideation-card-' + escapeAttr(card.color) + ' ideation-card-' + lod + ' ' + mutedClass + ' ' + (state.selectedCardId === card.id ? 'selected' : '') + ' ' + (focusCardId === card.id ? 'focused' : '') + ' ' + (selectionOrder === 0 ? 'selection-source' : '') + ' ' + (selectionOrder === 1 ? 'selection-target' : '') + '" tabindex="0" role="button" data-action="ideation-select-card" data-payload="' + escapeAttr(card.id) + '" data-card-id="' + escapeAttr(card.id) + '" style="left: ' + (BOARD_WORLD_ORIGIN_X + card.x) + 'px; top: ' + (BOARD_WORLD_ORIGIN_Y + card.y) + 'px;">' +
        '<div class="ideation-card-shell">' +
          '<div class="ideation-card-head" data-drag-card-id="' + escapeAttr(card.id) + '">' +
            '<span class="tag">' + escapeHtml(card.kind) + '</span>' +
            '<span class="tag">' + escapeHtml(card.author) + '</span>' +
          '</div>' +
          '<div class="ideation-card-body">' + contentMarkup + '</div>' +
          '<div class="ideation-card-indicators">' +
            '<span class="ideation-card-indicator ideation-card-indicator-left">' + escapeHtml(selectionBadge || ' ') + '</span>' +
            '<span class="ideation-card-indicator ideation-card-indicator-right">' + escapeHtml(footerMeta[0] || flowRole) + '</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function flowRoleForCard(card) {
    if (card.kind === 'problem') {
      return 'Problem';
    }
    if (card.kind === 'user-insight' || card.kind === 'evidence') {
      return 'Input';
    }
    if (card.kind === 'idea') {
      return 'Decision';
    }
    if (card.kind === 'requirement') {
      return 'Constraint';
    }
    if (card.kind === 'experiment') {
      return 'Action';
    }
    if (card.kind === 'risk') {
      return 'Risk';
    }
    if (card.kind === 'atlas-response') {
      return 'Output';
    }
    return 'Note';
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
    const placement = findOpenBoardPosition(snapshot.cards, (base?.x || 0) + 80, (base?.y || 0) + 72);
    const card = {
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: 'New idea',
      body: 'Describe the insight, user need, or experiment.',
      kind: 'idea',
      author: 'user',
      x: placement.x,
      y: placement.y,
      color: 'sun',
      imageSources: [],
      media: [],
      tags: [],
      confidence: 50,
      evidenceStrength: 30,
      riskScore: 30,
      costToValidate: 35,
      syncTargets: [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    snapshot.cards = snapshot.cards.concat(card).slice(-48);
    appendAutoConnection(snapshot, base?.id, card);
    state.allowEmptySelection = false;
    state.selectedCardId = card.id;
    state.selectedLinkId = '';
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
    state.orderedSelectedCardIds = state.orderedSelectedCardIds.filter(id => id !== state.selectedCardId && snapshot.cards.some(card => card.id === id)).slice(-2);
    if (state.selectedCardId) {
      state.orderedSelectedCardIds = [state.selectedCardId];
    }
    state.selectedLinkId = '';
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
    const placement = findOpenBoardPosition(snapshot.cards, selected.x + 84, selected.y + 64, selected.id);
    const duplicate = {
      ...selected,
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: selected.title + ' copy',
      x: placement.x,
      y: placement.y,
      media: selected.media.slice(0, 4).map(media => ({ ...media, id: 'media-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) })),
      tags: (selected.tags || []).slice(),
      syncTargets: (selected.syncTargets || []).slice(),
      parentCardId: selected.id,
      sourceRunId: selected.sourceRunId,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    snapshot.cards = snapshot.cards.concat(duplicate).slice(-48);
    appendAutoConnection(snapshot, selected.id, duplicate);
    state.allowEmptySelection = false;
    state.selectedCardId = duplicate.id;
    state.orderedSelectedCardIds = [selected.id, duplicate.id];
    state.selectedLinkId = '';
    scheduleIdeationSave();
    render();
  }

  function setFocusedCard() {
    const snapshot = state.snapshot;
    if (!snapshot || !state.selectedCardId) {
      return;
    }
    state.allowEmptySelection = false;
    snapshot.focusCardId = state.selectedCardId;
    scheduleIdeationSave();
    render();
  }

  function handleCardSelection(cardId, shouldEditInline, preservePair) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    state.allowEmptySelection = false;
    state.selectedCardId = cardId;
    updateOrderedSelection(cardId, preservePair);
    state.selectedLinkId = '';
    if (shouldEditInline) {
      state.orderedSelectedCardIds = [cardId];
      state.editingCardId = cardId;
      render();
      focusInlineEditor();
      return;
    }
    render();
  }

  function handleLinkSelection(linkId) {
    if (!findIdeationLink(linkId)) {
      return;
    }
    state.allowEmptySelection = false;
    state.selectedLinkId = linkId;
    state.editingCardId = '';
    state.orderedSelectedCardIds = state.selectedCardId ? [state.selectedCardId] : [];
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
    if (field === 'kind') {
      applyCardModeTemplate(selected);
      selected.color = colorForCardKind(selected.kind);
    }
    selected.revision = Math.max(1, (selected.revision || 1) + 1);
    selected.updatedAt = new Date().toISOString();
    scheduleIdeationSave();
  }

  function updateConstraintField(field, value) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    snapshot.constraints[field] = String(value || '');
    scheduleIdeationSave();
  }

  function updateSelectedCardTags(value) {
    const selected = getSelectedCard();
    if (!selected) {
      return;
    }
    selected.tags = String(value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean).slice(0, 8);
    selected.revision = Math.max(1, (selected.revision || 1) + 1);
    selected.updatedAt = new Date().toISOString();
    scheduleIdeationSave();
  }

  function updateSelectedCardSyncTargets(target, enabled) {
    const selected = getSelectedCard();
    if (!selected) {
      return;
    }
    const next = new Set(selected.syncTargets || []);
    if (enabled) {
      next.add(target);
    } else {
      next.delete(target);
    }
    selected.syncTargets = [...next];
    selected.revision = Math.max(1, (selected.revision || 1) + 1);
    selected.updatedAt = new Date().toISOString();
    scheduleIdeationSave();
  }

  function updateSelectedLinkField(field, value) {
    const link = getSelectedLink();
    if (!link) {
      return;
    }
    if (field === 'label') {
      link.label = String(value || '').trim().slice(0, 36);
    }
    if (field === 'style') {
      link.style = value === 'solid' ? 'solid' : 'dotted';
    }
    if (field === 'direction') {
      link.direction = value === 'forward' || value === 'reverse' || value === 'both' ? value : 'none';
    }
    if (field === 'relation') {
      link.relation = value === 'causal' || value === 'dependency' || value === 'contradiction' || value === 'opportunity' ? value : 'supports';
      link.label = relationLabel(link.relation);
    }
    scheduleIdeationSave();
    updateConnectionPositions();
  }

  function deleteSelectedLink() {
    const snapshot = state.snapshot;
    if (!snapshot || !state.selectedLinkId) {
      return;
    }
    snapshot.connections = snapshot.connections.filter(connection => connection.id !== state.selectedLinkId);
    state.selectedLinkId = '';
    scheduleIdeationSave();
    render();
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
          constraints: snapshot.constraints,
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

  function seedValidationPrompt() {
    const selected = getSelectedCard();
    const promptInput = document.getElementById('ideationPrompt');
    if (!selected || !(promptInput instanceof HTMLTextAreaElement)) {
      return;
    }
    promptInput.value = 'Generate the fastest smoke test, landing page test, concierge test, wizard-of-oz flow, and prototype script for this card: ' + selected.title + '. Pressure-test it against current board constraints.';
  }

  function findIdeationCard(cardId) {
    return state.snapshot?.cards.find(card => card.id === cardId);
  }

  function findIdeationLink(linkId) {
    return state.snapshot?.connections.find(connection => connection.id === linkId);
  }

  function getSelectedCard() {
    return findIdeationCard(state.selectedCardId);
  }

  function getSelectedLink() {
    return findIdeationLink(state.selectedLinkId);
  }

  function getPromptValue() {
    const promptInput = document.getElementById('ideationPrompt');
    return promptInput instanceof HTMLTextAreaElement ? promptInput.value : '';
  }

  function resolveSelectedCard(snapshot) {
    if (state.selectedCardId) {
      return snapshot.cards.find(card => card.id === state.selectedCardId);
    }
    if (state.allowEmptySelection) {
      return undefined;
    }
    if (snapshot.focusCardId) {
      state.selectedCardId = snapshot.focusCardId;
      return snapshot.cards.find(card => card.id === snapshot.focusCardId);
    }
    if (snapshot.cards[0]) {
      state.selectedCardId = snapshot.cards[0].id;
      state.orderedSelectedCardIds = [snapshot.cards[0].id];
      return snapshot.cards[0];
    }
    return undefined;
  }

  function resolveSelectedLink(snapshot) {
    if (!state.selectedLinkId) {
      return undefined;
    }
    return snapshot.connections.find(connection => connection.id === state.selectedLinkId);
  }

  function syncSelectedCard() {
    const cards = state.snapshot?.cards || [];
    const links = state.snapshot?.connections || [];
    if (cards.length === 0) {
      state.selectedCardId = '';
      state.orderedSelectedCardIds = [];
      state.selectedLinkId = '';
      state.allowEmptySelection = false;
      state.editingCardId = '';
      state.linkStartCardId = '';
      return;
    }
    if (state.selectedCardId && !cards.some(card => card.id === state.selectedCardId)) {
      state.selectedCardId = '';
    }
    if (!state.selectedCardId && !state.allowEmptySelection) {
      state.selectedCardId = state.snapshot.focusCardId || cards[0].id;
    }
    state.orderedSelectedCardIds = state.orderedSelectedCardIds.filter(id => cards.some(card => card.id === id));
    if (state.selectedCardId) {
      state.orderedSelectedCardIds = [...state.orderedSelectedCardIds.filter(id => id !== state.selectedCardId), state.selectedCardId].slice(-2);
    }
    if (state.orderedSelectedCardIds.length === 0 && state.selectedCardId) {
      state.orderedSelectedCardIds = [state.selectedCardId];
    }
    if (!state.selectedCardId) {
      state.orderedSelectedCardIds = [];
      state.editingCardId = '';
    }
    if (state.editingCardId && !cards.some(card => card.id === state.editingCardId)) {
      state.editingCardId = '';
    }
    if (state.linkStartCardId && !cards.some(card => card.id === state.linkStartCardId)) {
      state.linkStartCardId = '';
    }
    if (state.selectedLinkId && !links.some(connection => connection.id === state.selectedLinkId)) {
      state.selectedLinkId = '';
    }
  }

  function updateOrderedSelection(cardId, preservePair) {
    if (!cardId) {
      state.orderedSelectedCardIds = [];
      return;
    }
    if (!preservePair && state.orderedSelectedCardIds.length > 1 && state.selectedCardId === cardId) {
      state.orderedSelectedCardIds = [cardId];
      return;
    }
    if (!preservePair && state.orderedSelectedCardIds.includes(cardId) && state.selectedCardId !== cardId) {
      state.orderedSelectedCardIds = [cardId];
      return;
    }
    state.orderedSelectedCardIds = [...state.orderedSelectedCardIds.filter(id => id !== cardId), cardId].slice(-2);
  }

  function collapseSelectionToPrimary() {
    if (!state.selectedCardId) {
      state.orderedSelectedCardIds = [];
      render();
      return;
    }
    state.orderedSelectedCardIds = [state.selectedCardId];
    render();
  }

  function clearCanvasSelection() {
    state.allowEmptySelection = true;
    state.selectedCardId = '';
    state.selectedLinkId = '';
    state.orderedSelectedCardIds = [];
    state.editingCardId = '';
    state.linkStartCardId = '';
    state.lastCardClick = undefined;
    render();
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
    const boardView = getBoardView(state.snapshot);
    svg.innerHTML = renderIdeationConnections({ cards: boardView.cards, connections: boardView.connections }, getBoardLod());
  }

  function syncBoardViewportMetrics() {
    const stage = document.getElementById('ideationBoardStage');
    if (!(stage instanceof HTMLElement)) {
      return;
    }
    state.viewportMetrics = {
      width: stage.clientWidth,
      height: stage.clientHeight,
    };
    state.viewportX = clampViewportX(state.viewportX);
    state.viewportY = clampViewportY(state.viewportY);
  }

  function applyViewportTransform() {
    const world = document.getElementById('ideationBoardWorld');
    if (!(world instanceof HTMLElement)) {
      return;
    }
    world.style.transform = 'translate(calc(-50% + ' + state.viewportX + 'px), calc(-50% + ' + state.viewportY + 'px)) scale(' + state.zoom + ')';
  }

  function updateViewportIndicators() {
    const snapshot = state.snapshot;
    const stage = document.getElementById('ideationBoardStage');
    if (!snapshot || !(stage instanceof HTMLElement)) {
      return;
    }
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const edges = { top: false, right: false, bottom: false, left: false };
    for (const card of snapshot.cards) {
      const left = (width / 2) + state.viewportX + (card.x * state.zoom);
      const top = (height / 2) + state.viewportY + (card.y * state.zoom);
      if (left + (CARD_WIDTH * state.zoom) < 0) {
        edges.left = true;
      }
      if (left > width) {
        edges.right = true;
      }
      if (top + (CARD_HEIGHT * state.zoom) < 0) {
        edges.top = true;
      }
      if (top > height) {
        edges.bottom = true;
      }
    }
    ['top', 'right', 'bottom', 'left'].forEach(edge => {
      const glow = root?.querySelector('[data-edge="' + edge + '"]');
      if (glow instanceof HTMLElement) {
        glow.classList.toggle('active', Boolean(edges[edge]));
      }
    });
  }

  function clampViewportX(value) {
    const horizontalRange = Math.max(0, Math.floor(((BOARD_WORLD_WIDTH * state.zoom) - state.viewportMetrics.width) / 2));
    return clampNumber(value, -horizontalRange, horizontalRange);
  }

  function clampViewportY(value) {
    const verticalRange = Math.max(0, Math.floor(((BOARD_WORLD_HEIGHT * state.zoom) - state.viewportMetrics.height) / 2));
    return clampNumber(value, -verticalRange, verticalRange);
  }

  function isEditingTextField(target) {
    return target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof window.HTMLSelectElement
      || Boolean(target instanceof HTMLElement && target.isContentEditable);
  }

  function changeBoardZoom(delta, focalPoint) {
    const nextZoom = clampNumber(Number((state.zoom + delta).toFixed(2)), MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
    setBoardZoom(nextZoom, focalPoint);
  }

  function setBoardZoom(nextZoom, focalPoint) {
    const stage = document.getElementById('ideationBoardStage');
    if (!(stage instanceof HTMLElement) || Math.abs(nextZoom - state.zoom) < 0.001) {
      return;
    }
    const previousZoom = state.zoom;
    const rect = stage.getBoundingClientRect();
    const anchorX = focalPoint ? (focalPoint.clientX - rect.left - (rect.width / 2)) : 0;
    const anchorY = focalPoint ? (focalPoint.clientY - rect.top - (rect.height / 2)) : 0;
    const worldX = (anchorX - state.viewportX) / previousZoom;
    const worldY = (anchorY - state.viewportY) / previousZoom;
    state.zoom = nextZoom;
    state.viewportX = clampViewportX(anchorX - (worldX * nextZoom));
    state.viewportY = clampViewportY(anchorY - (worldY * nextZoom));
    applyViewportTransform();
    updateConnectionPositions();
    updateViewportIndicators();
    render();
  }

  function fitBoardToVisibleCards() {
    const snapshot = state.snapshot;
    const stage = document.getElementById('ideationBoardStage');
    if (!snapshot || !(stage instanceof HTMLElement)) {
      return;
    }
    const cards = getBoardView(snapshot).cards;
    if (cards.length === 0) {
      state.zoom = 1;
      state.viewportX = 0;
      state.viewportY = 0;
      render();
      return;
    }
    const bounds = getCardBounds(cards);
    const availableWidth = Math.max(220, stage.clientWidth - (BOARD_FIT_PADDING * 2));
    const availableHeight = Math.max(220, stage.clientHeight - (BOARD_FIT_PADDING * 2));
    const nextZoom = clampNumber(Math.min(availableWidth / bounds.width, availableHeight / bounds.height), MIN_BOARD_ZOOM, MAX_BOARD_ZOOM);
    state.zoom = nextZoom;
    state.viewportX = clampViewportX(-(bounds.centerX * nextZoom));
    state.viewportY = clampViewportY(-(bounds.centerY * nextZoom));
    render();
  }

  function getCardBounds(cards) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const card of cards) {
      minX = Math.min(minX, card.x);
      minY = Math.min(minY, card.y);
      maxX = Math.max(maxX, card.x + CARD_WIDTH);
      maxY = Math.max(maxY, card.y + CARD_HEIGHT);
    }
    return {
      width: Math.max(CARD_WIDTH, maxX - minX),
      height: Math.max(CARD_HEIGHT, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }

  function getBoardLod() {
    if (state.zoom <= 0.72) {
      return 'minimal';
    }
    if (state.zoom <= 0.98) {
      return 'compact';
    }
    return 'full';
  }

  function shouldRenderLinkLabel(connection, lod) {
    if (!connection.label) {
      return false;
    }
    if (lod === 'minimal') {
      return state.selectedLinkId === connection.id;
    }
    if (lod === 'compact') {
      return state.selectedLinkId === connection.id || connection.relation === 'contradiction' || connection.relation === 'dependency';
    }
    return true;
  }

  function findOpenBoardPosition(cards, preferredX, preferredY, excludedCardId) {
    const desiredX = clampNumber(preferredX, MIN_CARD_X, MAX_CARD_X);
    const desiredY = clampNumber(preferredY, MIN_CARD_Y, MAX_CARD_Y);
    if (!doesCardOverlap(cards, desiredX, desiredY, excludedCardId)) {
      return { x: desiredX, y: desiredY };
    }
    const radiusSteps = 9;
    for (let ring = 1; ring <= radiusSteps; ring += 1) {
      const stepX = (CARD_WIDTH + CARD_PLACEMENT_GAP) * ring;
      const stepY = (CARD_HEIGHT + CARD_PLACEMENT_GAP) * ring;
      const candidates = [
        { x: preferredX + stepX, y: preferredY },
        { x: preferredX - stepX, y: preferredY },
        { x: preferredX, y: preferredY + stepY },
        { x: preferredX, y: preferredY - stepY },
        { x: preferredX + stepX, y: preferredY + stepY },
        { x: preferredX + stepX, y: preferredY - stepY },
        { x: preferredX - stepX, y: preferredY + stepY },
        { x: preferredX - stepX, y: preferredY - stepY },
      ];
      for (const candidate of candidates) {
        const x = clampNumber(candidate.x, -1600, 1600);
        const y = clampNumber(candidate.y, -1200, 1200);
        if (!doesCardOverlap(cards, x, y, excludedCardId)) {
          return { x, y };
        }
      }
    }
    return { x: desiredX, y: desiredY };
  }

  function doesCardOverlap(cards, x, y, excludedCardId) {
    return cards.some(card => {
      if (excludedCardId && card.id === excludedCardId) {
        return false;
      }
      return x < (card.x + CARD_WIDTH + CARD_PLACEMENT_GAP)
        && (x + CARD_WIDTH + CARD_PLACEMENT_GAP) > card.x
        && y < (card.y + CARD_HEIGHT + CARD_PLACEMENT_GAP)
        && (y + CARD_HEIGHT + CARD_PLACEMENT_GAP) > card.y;
    });
  }

  function appendAutoConnection(snapshot, sourceCardId, targetCard) {
    if (!snapshot || !sourceCardId || !targetCard || sourceCardId === targetCard.id) {
      return;
    }
    const sourceCard = snapshot.cards.find(card => card.id === sourceCardId);
    if (!sourceCard) {
      return;
    }
    const exists = snapshot.connections.some(connection => connection.fromCardId === sourceCardId && connection.toCardId === targetCard.id);
    if (exists) {
      return;
    }
    const relation = suggestLinkRelation(sourceCard, targetCard);
    snapshot.connections = snapshot.connections.concat({
      id: 'link-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      fromCardId: sourceCardId,
      toCardId: targetCard.id,
      label: relationLabel(relation),
      style: relationLineStyle(relation),
      direction: 'forward',
      relation,
    }).slice(-96);
  }

  function createLinkFromSelection(relationOverride) {
    const snapshot = state.snapshot;
    const orderedPair = getOrderedSelectedCards(snapshot);
    if (!snapshot || orderedPair.length < 2) {
      state.ideationStatus = 'Select two cards in sequence before creating a link.';
      render();
      return;
    }
    const sourceCard = snapshot.cards.find(card => card.id === orderedPair[0]);
    const targetCard = snapshot.cards.find(card => card.id === orderedPair[1]);
    if (!sourceCard || !targetCard || sourceCard.id === targetCard.id) {
      return;
    }
    const relation = relationOverride || suggestLinkRelation(sourceCard, targetCard);
    const existing = snapshot.connections.find(connection => connection.fromCardId === sourceCard.id && connection.toCardId === targetCard.id);
    if (existing) {
      existing.relation = relation;
      existing.label = relationLabel(relation);
      existing.style = relationLineStyle(relation);
      existing.direction = 'forward';
      state.selectedLinkId = existing.id;
      state.ideationStatus = 'Updated link from ' + sourceCard.title + ' to ' + targetCard.title + '.';
    } else {
      const linkId = 'link-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      snapshot.connections = snapshot.connections.concat({
        id: linkId,
        fromCardId: sourceCard.id,
        toCardId: targetCard.id,
        label: relationLabel(relation),
        style: relationLineStyle(relation),
        direction: 'forward',
        relation,
      }).slice(-96);
      state.selectedLinkId = linkId;
      state.ideationStatus = 'Linked ' + sourceCard.title + ' to ' + targetCard.title + '.';
    }
    state.selectedCardId = targetCard.id;
    scheduleIdeationSave();
    render();
  }

  function getOrderedSelectedCards(snapshot) {
    if (!snapshot) {
      return [];
    }
    return state.orderedSelectedCardIds.filter(id => snapshot.cards.some(card => card.id === id)).slice(-2);
  }

  function renderCanvasShortcutStrip(snapshot) {
    const orderedPair = getOrderedSelectedCards(snapshot);
    const pairSummary = orderedPair.length === 2
      ? orderedPair.map((cardId, index) => {
          const card = snapshot.cards.find(entry => entry.id === cardId);
          return '<span class="tag">' + escapeHtml((index + 1) + '. ' + (card?.title || cardId)) + '</span>';
        }).join('')
      : '<span class="tag">Click two cards to create an ordered pair</span>';
    return '' +
      '<div class="ideation-chip-row">' +
        '<span class="tag tag-good">Shortcuts</span>' +
        '<span class="tag">L inferred</span>' +
        '<span class="tag">S supports</span>' +
        '<span class="tag">D dependency</span>' +
        '<span class="tag">C causal</span>' +
        '<span class="tag">O opportunity</span>' +
        '<span class="tag">X contradiction</span>' +
        '<span class="tag">Enter edit</span>' +
        '<span class="tag">A add</span>' +
        '<span class="tag">Del remove</span>' +
      '</div>' +
      '<div class="ideation-chip-row">' + pairSummary + '</div>';
  }

  function focusInlineEditor() {
    const titleInput = root?.querySelector('[data-card-edit-field="title"]');
    if (titleInput instanceof HTMLInputElement) {
      titleInput.focus();
      titleInput.select();
    }
  }

  function applyCardModeTemplate(card) {
    const template = modeTemplates[card.kind] || modeTemplates.idea;
    if (!card.title || /^New idea$/i.test(card.title) || /^Untitled/i.test(card.title)) {
      card.title = template.title;
    }
    if (!card.body || /^Describe the insight/i.test(card.body)) {
      card.body = template.body;
    }
  }

  function applyBoardLens(cards, lens) {
    if (lens === 'archived') {
      return cards.filter(card => card.archivedAt);
    }
    const active = cards.filter(card => !card.archivedAt);
    if (lens === 'workflow-map') {
      return active;
    }
    if (lens === 'focus-network') {
      if (!state.selectedCardId) {
        return active;
      }
      const relatedIds = getSelectionState().relatedCardIds;
      return active.filter(card => relatedIds.has(card.id));
    }
    if (lens === 'experiments-only') {
      return active.filter(card => card.kind === 'experiment' || card.kind === 'evidence' || card.kind === 'requirement' || card.kind === 'idea');
    }
    if (lens === 'risks-first') {
      return active.filter(card => card.kind === 'risk' || card.kind === 'requirement' || card.kind === 'idea' || card.kind === 'experiment' || card.kind === 'evidence')
        .slice().sort((left, right) => (right.riskScore || 0) - (left.riskScore || 0));
    }
    if (lens === 'feasibility') {
      return active.filter(card => card.kind === 'idea' || card.kind === 'requirement' || card.kind === 'experiment' || card.kind === 'risk' || card.kind === 'evidence')
        .slice().sort((left, right) => ((right.confidence || 0) - (right.costToValidate || 0)) - ((left.confidence || 0) - (left.costToValidate || 0)));
    }
    if (lens === 'delivery-readiness') {
      return active.filter(card => card.kind === 'idea' || card.kind === 'requirement' || card.kind === 'experiment' || card.kind === 'risk' || card.kind === 'atlas-response');
    }
    if (lens === 'user-journey') {
      const order = { 'user-insight': 0, problem: 1, requirement: 2, idea: 3, experiment: 4, evidence: 5, risk: 6, 'atlas-response': 7, attachment: 8 };
      return active.slice().sort((left, right) => (order[left.kind] || 50) - (order[right.kind] || 50));
    }
    return active;
  }

  function getBoardView(snapshot) {
    const lensCards = applyBoardLens(snapshot.cards, state.boardLens);
    const projectedCards = projectCardsForLens(lensCards, state.boardLens);
    const visibleIds = new Set(projectedCards.map(card => card.id));
    const connections = snapshot.connections.filter(connection => visibleIds.has(connection.fromCardId) && visibleIds.has(connection.toCardId) && passesRelationFilter(connection));
    return {
      cards: projectedCards,
      connections,
      summary: boardViewSummary(projectedCards, connections),
    };
  }

  function boardViewSummary(cards, connections) {
    const lensLabel = {
      default: 'Default view keeps your manual layout intact.',
      'workflow-map': 'Workflow Map re-lays cards into semantic lanes for left-to-right review.',
      'focus-network': 'Focus Network isolates the selected card and its direct neighbors.',
      'user-journey': 'User Journey groups inputs, problems, requirements, ideas, and tests in sequence.',
      'risks-first': 'Risks First brings blockers, tensions, and affected cards into a triage layout.',
      'experiments-only': 'Experiments Only keeps the validation path on screen.',
      feasibility: 'Feasibility view clusters cards by practical delivery readiness.',
      'delivery-readiness': 'Delivery Readiness shows the cards needed to move into execution.',
      archived: 'Archived view shows preserved but inactive cards.',
    };
    return (lensLabel[state.boardLens] || lensLabel.default) + ' Showing ' + cards.length + ' cards and ' + connections.length + ' links.';
  }

  function passesRelationFilter(connection) {
    if (state.relationFilter === 'all') {
      return true;
    }
    if (state.relationFilter === 'directional') {
      return connection.direction === 'forward' || connection.direction === 'reverse';
    }
    if (state.relationFilter === 'bidirectional') {
      return connection.direction === 'both';
    }
    return connection.relation === state.relationFilter;
  }

  function projectCardsForLens(cards, lens) {
    if (lens === 'default' || lens === 'archived') {
      return cards;
    }
    if (lens === 'focus-network') {
      return projectFocusNetwork(cards);
    }
    return projectIntoSemanticLanes(cards, lens);
  }

  function projectIntoSemanticLanes(cards, lens) {
    const columnX = {
      input: -1180,
      context: -700,
      decision: -220,
      constraint: 260,
      action: 760,
      output: 1240,
    };
    const grouped = {
      input: [],
      context: [],
      decision: [],
      constraint: [],
      action: [],
      output: [],
    };
    for (const card of sortCardsForLens(cards, lens)) {
      grouped[semanticColumnForLens(card, lens)].push(card);
    }
    const projected = [];
    for (const [column, columnCards] of Object.entries(grouped)) {
      columnCards.forEach((card, index) => {
        projected.push({
          ...card,
          x: columnX[column],
          y: (-860) + (index * (CARD_HEIGHT + 44)),
        });
      });
    }
    return projected;
  }

  function projectFocusNetwork(cards) {
    if (!state.selectedCardId) {
      return cards;
    }
    const selectionState = getSelectionState();
    const selected = cards.find(card => card.id === state.selectedCardId);
    if (!selected) {
      return cards;
    }
    const neighbors = cards.filter(card => card.id !== selected.id && selectionState.relatedCardIds.has(card.id));
    const projected = [{ ...selected, x: -110, y: -92 }];
    const buckets = { left: [], right: [], top: [], bottom: [] };
    for (const card of neighbors) {
      const role = semanticColumnForLens(card, 'workflow-map');
      if (role === 'input' || role === 'context') {
        buckets.left.push(card);
      } else if (role === 'output') {
        buckets.right.push(card);
      } else if (role === 'constraint' || role === 'action') {
        buckets.bottom.push(card);
      } else {
        buckets.top.push(card);
      }
    }
    placeBucket(projected, buckets.left, -760, -420, false);
    placeBucket(projected, buckets.top, -110, -700, true);
    placeBucket(projected, buckets.right, 540, -420, false);
    placeBucket(projected, buckets.bottom, -110, 360, true);
    return projected;
  }

  function placeBucket(target, cards, anchorX, anchorY, horizontal) {
    cards.forEach((card, index) => {
      target.push({
        ...card,
        x: horizontal ? anchorX + ((index - ((cards.length - 1) / 2)) * (CARD_WIDTH + 42)) : anchorX,
        y: horizontal ? anchorY : anchorY + (index * (CARD_HEIGHT + 42)),
      });
    });
  }

  function sortCardsForLens(cards, lens) {
    const scored = cards.slice();
    if (lens === 'risks-first') {
      return scored.sort((left, right) => {
        const riskDelta = (right.riskScore || 0) - (left.riskScore || 0);
        return riskDelta || semanticRank(left.kind) - semanticRank(right.kind);
      });
    }
    if (lens === 'feasibility') {
      return scored.sort((left, right) => feasibilityScore(right) - feasibilityScore(left));
    }
    if (lens === 'delivery-readiness') {
      return scored.sort((left, right) => deliveryScore(right) - deliveryScore(left));
    }
    return scored.sort((left, right) => semanticRank(left.kind) - semanticRank(right.kind));
  }

  function feasibilityScore(card) {
    return (card.confidence || 0) + (card.evidenceStrength || 0) - (card.costToValidate || 0) - (card.riskScore || 0);
  }

  function deliveryScore(card) {
    return (card.evidenceStrength || 0) + (card.confidence || 0) + (card.kind === 'experiment' ? 12 : 0) + (card.kind === 'requirement' ? 8 : 0) - (card.riskScore || 0);
  }

  function semanticRank(kind) {
    const order = { 'user-insight': 0, evidence: 1, problem: 2, idea: 3, requirement: 4, experiment: 5, risk: 6, 'atlas-response': 7, attachment: 8 };
    return order[kind] ?? 50;
  }

  function semanticColumnForLens(card, lens) {
    if (card.kind === 'user-insight' || card.kind === 'evidence' || card.kind === 'attachment') {
      return 'input';
    }
    if (card.kind === 'problem') {
      return lens === 'risks-first' ? 'decision' : 'context';
    }
    if (card.kind === 'idea') {
      return 'decision';
    }
    if (card.kind === 'requirement') {
      return lens === 'delivery-readiness' ? 'decision' : 'constraint';
    }
    if (card.kind === 'experiment') {
      return 'action';
    }
    if (card.kind === 'risk') {
      return lens === 'risks-first' ? 'action' : 'constraint';
    }
    if (card.kind === 'atlas-response') {
      return 'output';
    }
    return 'context';
  }

  function getSelectionState() {
    const relatedCardIds = new Set();
    const relatedConnectionIds = new Set();
    if (!state.snapshot) {
      return { active: false, relatedCardIds, relatedConnectionIds };
    }
    if (state.selectedLinkId) {
      const selectedLink = state.snapshot.connections.find(connection => connection.id === state.selectedLinkId);
      if (selectedLink) {
        relatedConnectionIds.add(selectedLink.id);
        relatedCardIds.add(selectedLink.fromCardId);
        relatedCardIds.add(selectedLink.toCardId);
        return { active: true, relatedCardIds, relatedConnectionIds };
      }
    }
    if (!state.selectedCardId) {
      return { active: false, relatedCardIds, relatedConnectionIds };
    }
    relatedCardIds.add(state.selectedCardId);
    for (const connection of state.snapshot.connections) {
      if (connection.fromCardId === state.selectedCardId || connection.toCardId === state.selectedCardId) {
        relatedConnectionIds.add(connection.id);
        relatedCardIds.add(connection.fromCardId);
        relatedCardIds.add(connection.toCardId);
      }
    }
    return { active: true, relatedCardIds, relatedConnectionIds };
  }

  function getCardTemplate(kind) {
    return (modeTemplates[kind] || modeTemplates.idea).description;
  }

  function getCardValidationWarnings(card) {
    const warnings = [];
    if (!card.title || card.title.trim().length < 5) {
      warnings.push('Title should clearly name the idea fragment.');
    }
    if (!card.body || card.body.trim().length < 20) {
      warnings.push('Add more detail so the card can survive a later run.');
    }
    if (card.kind === 'experiment' && (card.costToValidate || 0) === 0) {
      warnings.push('Experiments should estimate cost to validate.');
    }
    if (card.kind === 'risk' && (card.riskScore || 0) < 40) {
      warnings.push('Risks should usually carry a meaningful risk score.');
    }
    if (card.kind === 'evidence' && (!card.tags || card.tags.length === 0)) {
      warnings.push('Evidence cards should be tagged for retrieval later.');
    }
    return warnings;
  }

  function suggestLinkRelation(sourceCard, targetCard) {
    if (!sourceCard || !targetCard) {
      return 'supports';
    }
    if (targetCard.kind === 'risk') {
      return 'contradiction';
    }
    if (targetCard.kind === 'experiment' || targetCard.kind === 'requirement') {
      return 'dependency';
    }
    if (targetCard.kind === 'evidence' || targetCard.kind === 'user-insight') {
      return 'causal';
    }
    if (sourceCard.kind === 'problem' && targetCard.kind === 'idea') {
      return 'opportunity';
    }
    return 'supports';
  }

  function relationLineStyle(relation) {
    return relation === 'dependency' || relation === 'contradiction' ? 'solid' : 'dotted';
  }

  function relationLabel(relation) {
    if (relation === 'causal') {
      return 'causes';
    }
    if (relation === 'dependency') {
      return 'depends on';
    }
    if (relation === 'contradiction') {
      return 'contradicts';
    }
    if (relation === 'opportunity') {
      return 'opens';
    }
    return 'supports';
  }

  function colorForCardKind(kind) {
    if (kind === 'risk' || kind === 'problem') {
      return 'rose';
    }
    if (kind === 'experiment') {
      return 'storm';
    }
    if (kind === 'user-insight') {
      return 'sea';
    }
    if (kind === 'requirement') {
      return 'sand';
    }
    if (kind === 'evidence') {
      return 'mint';
    }
    return 'sun';
  }

  const modeTemplates = {
    idea: { title: 'New idea', body: 'Describe the concept, why it matters, and who it serves.', description: 'Idea: what is the concept, who is it for, and what outcome does it create?' },
    problem: { title: 'User problem', body: 'Describe the friction, trigger, and why it is painful now.', description: 'Problem: what pain exists, for whom, and what evidence shows it is real?' },
    experiment: { title: 'Validation experiment', body: 'Describe the hypothesis, fastest test, signal, and owner.', description: 'Experiment: hypothesis, smallest test, success signal, and time-to-learn.' },
    'user-insight': { title: 'User insight', body: 'Capture the observed behaviour, quote, or pattern.', description: 'User Insight: observation, quote, or behaviour pattern from evidence.' },
    risk: { title: 'Key risk', body: 'Describe what could fail, why, and what would expose it early.', description: 'Risk: what breaks, likelihood, impact, and early warning sign.' },
    requirement: { title: 'Requirement', body: 'Define the non-negotiable constraint, dependency, or capability.', description: 'Requirement: mandatory capability, dependency, or condition to deliver the idea.' },
    evidence: { title: 'Evidence artifact', body: 'Describe what this artifact proves or challenges.', description: 'Evidence: what the artifact is, what it indicates, and which hypothesis it informs.' },
    'atlas-response': { title: 'Atlas synthesis', body: 'Atlas-generated framing or recommendation.', description: 'Atlas Response: synthesized recommendation from the latest facilitation pass.' },
    attachment: { title: 'Attachment', body: 'Supporting artifact awaiting classification.', description: 'Attachment: imported media that has not been classified yet.' },
  };

  function handleCanvasShortcut(event) {
    if (!state.snapshot) {
      return false;
    }
    const key = event.key.toLowerCase();
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === 'enter' || key === 'e') {
        if (!state.selectedCardId) {
          return false;
        }
        event.preventDefault();
        state.editingCardId = state.selectedCardId;
        state.selectedLinkId = '';
        render();
        focusInlineEditor();
        return true;
      }
      if (key === 'a') {
        event.preventDefault();
        addIdeationCard();
        return true;
      }
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        if (state.selectedLinkId) {
          deleteSelectedLink();
        } else if (state.selectedCardId) {
          deleteSelectedIdeationCard();
        }
        return true;
      }
      if (key === 'l') {
        event.preventDefault();
        createLinkFromSelection();
        return true;
      }
      if (key === 's') {
        event.preventDefault();
        createLinkFromSelection('supports');
        return true;
      }
      if (key === 'd') {
        event.preventDefault();
        createLinkFromSelection('dependency');
        return true;
      }
      if (key === 'c') {
        event.preventDefault();
        createLinkFromSelection('causal');
        return true;
      }
      if (key === 'o') {
        event.preventDefault();
        createLinkFromSelection('opportunity');
        return true;
      }
      if (key === 'x') {
        event.preventDefault();
        createLinkFromSelection('contradiction');
        return true;
      }
      if (key === 'escape' && state.orderedSelectedCardIds.length > 1) {
        event.preventDefault();
        collapseSelectionToPrimary();
        return true;
      }
    }
    return false;
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

  function clampText(value, limit) {
    const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (limit <= 0) {
      return normalized;
    }
    return normalized.slice(0, limit);
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

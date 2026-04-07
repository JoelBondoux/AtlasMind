/* global acquireVsCodeApi, document, window, Element, HTMLElement, HTMLTextAreaElement, HTMLInputElement, SVGElement, CSS, FileReader, SpeechSynthesisUtterance */

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('ideation-root');
  const refreshButton = document.getElementById('ideation-refresh');
  const openDashboardButton = document.getElementById('open-project-dashboard');
  const openRunCenterButton = document.getElementById('open-run-center');
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const BOARD_WORLD_WIDTH = 3200;
  const BOARD_WORLD_HEIGHT = 2400;
  const BOARD_WORLD_ORIGIN_X = BOARD_WORLD_WIDTH / 2;
  const BOARD_WORLD_ORIGIN_Y = BOARD_WORLD_HEIGHT / 2;
  const CARD_WIDTH = 220;
  const CARD_HEIGHT = 184;
  const state = {
    snapshot: undefined,
    ideationBusy: false,
    ideationStatus: 'Shape the board with notes, files, images, and a guided Atlas facilitation pass.',
    ideationResponse: '',
    boardLens: 'default',
    selectedCardId: '',
    selectedLinkId: '',
    editingCardId: '',
    linkStartCardId: '',
    boardSaveTimer: undefined,
    canvasFullscreen: false,
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
      const now = Date.now();
      const shouldEditInline = Boolean(state.lastCardClick) && state.lastCardClick.cardId === payload && (now - state.lastCardClick.timestamp) < 360;
      state.lastCardClick = { cardId: payload, timestamp: now };
      handleCardSelection(payload, shouldEditInline);
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

  root?.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.syncTarget) {
      updateSelectedCardSyncTargets(target.dataset.syncTarget, target.checked);
    }
  });

  root?.addEventListener('pointerdown', event => {
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
    };
    if (handle instanceof HTMLElement) {
      handle.setPointerCapture?.(event.pointerId);
    }
  });

  root?.addEventListener('pointerdown', event => {
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
    };
    stage.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', event => {
    if (!state.drag) {
      return;
    }
    if (state.drag.kind === 'card') {
      const card = findIdeationCard(state.drag.cardId);
      const cardElement = root?.querySelector('[data-card-id="' + cssEscape(state.drag.cardId) + '"]');
      if (!card || !(cardElement instanceof HTMLElement)) {
        return;
      }
      card.x = clampNumber(state.drag.originX + (event.clientX - state.drag.startX), -1600, 1600);
      card.y = clampNumber(state.drag.originY + (event.clientY - state.drag.startY), -1200, 1200);
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
    if (state.drag.kind === 'canvas') {
      applyViewportTransform();
      updateViewportIndicators();
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
            '<article class="ideation-panel">' +
              '<p class="dashboard-kicker">Dedicated workspace</p>' +
              '<h2>Multimodal idea shaping</h2>' +
              '<p class="section-copy">Use the composer for the next Atlas pass, then drop or paste supporting media straight onto the board to keep the idea grounded in artifacts.</p>' +
            '</article>' +
            '<div class="ideation-stat-grid">' +
              renderStat('Cards', String(snapshot.cards.length), 'Cards currently on the board.') +
              renderStat('Runs', String(snapshot.runs.length), 'Auditable ideation evolutions captured so far.') +
              renderStat('Queued media', String(snapshot.promptAttachments.length), 'Files, images, and links waiting for the next Atlas pass.') +
            '</div>' +
          '</section>' +
          '<section class="ideation-main-grid">' +
            renderComposer(snapshot) +
            renderBoard(snapshot) +
          '</section>' +
          '<section class="ideation-lower-grid">' +
            renderInspector(snapshot, selectedCard, selectedLink) +
            renderFeedback(snapshot) +
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
    return '' +
      '<article class="ideation-panel ideation-composer-panel">' +
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
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-seed-validation" ' + (state.selectedCardId ? '' : 'disabled') + '>Generate Validation</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-start-voice" ' + (state.voiceActive ? 'disabled' : '') + '>Start Voice</button>' +
              '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-stop-voice" ' + (!state.voiceActive ? 'disabled' : '') + '>Stop Voice</button>' +
            '</div>' +
            '<button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-clear-attachments" ' + (snapshot.promptAttachments.length === 0 ? 'disabled' : '') + '>Clear Attachments</button>' +
          '</div>' +
          '<div class="panel-card">' +
            '<div class="row-head"><div><p class="section-kicker">Constraint injection</p><h4>Pressure-test inputs</h4></div></div>' +
            '<div class="ideation-constraint-grid">' +
              '<label><span class="section-kicker">Budget</span><input id="ideationConstraintBudget" type="text" value="' + escapeAttr(constraints.budget || '') + '" placeholder="£10k validation budget" /></label>' +
              '<label><span class="section-kicker">Timeline</span><input id="ideationConstraintTimeline" type="text" value="' + escapeAttr(constraints.timeline || '') + '" placeholder="6 weeks to signal" /></label>' +
              '<label><span class="section-kicker">Team size</span><input id="ideationConstraintTeamSize" type="text" value="' + escapeAttr(constraints.teamSize || '') + '" placeholder="2 product + 1 engineer" /></label>' +
              '<label><span class="section-kicker">Risk tolerance</span><input id="ideationConstraintRiskTolerance" type="text" value="' + escapeAttr(constraints.riskTolerance || '') + '" placeholder="Low / medium / high" /></label>' +
              '<label class="constraint-span"><span class="section-kicker">Technical stack</span><input id="ideationConstraintTechnicalStack" type="text" value="' + escapeAttr(constraints.technicalStack || '') + '" placeholder="TypeScript, VS Code extension host, local MCP" /></label>' +
            '</div>' +
          '</div>' +
          '<div class="panel-card">' +
            '<p class="section-kicker">Context weaving</p>' +
            '<div class="stat-detail">' + escapeHtml(snapshot.projectMetadataSummary || 'AtlasMind will pull SSOT context into the next run packet when project metadata is available.') + '</div>' +
            (snapshot.contextPackets.length > 0 ? '<div class="ideation-chip-row"><span class="tag tag-good">Latest packet</span><span class="stat-detail">' + escapeHtml(snapshot.contextPackets[snapshot.contextPackets.length - 1].constraintsSummary || 'No explicit constraints') + '</span></div>' : '') +
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
    const selectedLink = getSelectedLink();
    const viewCards = applyBoardLens(snapshot.cards, state.boardLens);
    const visibleIds = new Set(viewCards.map(card => card.id));
    const visibleConnections = snapshot.connections.filter(connection => visibleIds.has(connection.fromCardId) && visibleIds.has(connection.toCardId));
    return '' +
      '<article class="ideation-panel ideation-canvas-panel">' +
        '<div class="row-head">' +
          '<div>' +
            '<p class="section-kicker">Canvas</p>' +
            '<h3>Shared whiteboard</h3>' +
          '</div>' +
          '<div class="ideation-chip-row">' +
            '<select id="ideationBoardLens" class="ideation-lens-select">' +
              renderLensOption('default', 'Default view') +
              renderLensOption('user-journey', 'User Journey view') +
              renderLensOption('risks-first', 'Risks First view') +
              renderLensOption('experiments-only', 'Experiments Only view') +
              renderLensOption('feasibility', 'Feasibility view') +
            '</select>' +
            '<button type="button" class="action-link" data-action="ideation-add-card">Add Card</button>' +
            '<button type="button" class="action-link" data-action="ideation-duplicate-card" ' + (state.selectedCardId ? '' : 'disabled') + '>Duplicate</button>' +
            '<button type="button" class="action-link" data-action="ideation-link-toggle" ' + (state.selectedCardId ? '' : 'disabled') + '>' + (state.linkStartCardId ? 'Cancel Link' : 'Link Card') + '</button>' +
            '<button type="button" class="action-link" data-action="ideation-set-focus" ' + (state.selectedCardId ? '' : 'disabled') + '>Set Focus</button>' +
            '<button type="button" class="action-link" data-action="ideation-promote-card" ' + (state.selectedCardId ? '' : 'disabled') + '>Promote to Project Run</button>' +
            '<button type="button" class="action-link" data-action="ideation-delete-link" ' + (selectedLink ? '' : 'disabled') + '>Delete Link</button>' +
            '<button type="button" class="action-link" data-action="ideation-toggle-canvas-focus" aria-label="' + (state.canvasFullscreen ? 'Collapse canvas view' : 'Expand canvas view') + '"><span class="action-icon" aria-hidden="true">' + (state.canvasFullscreen ? '⤡' : '⤢') + '</span>' + (state.canvasFullscreen ? 'Collapse' : 'Expand') + '</button>' +
            '<button type="button" class="action-link" data-action="ideation-delete-card" ' + (state.selectedCardId ? '' : 'disabled') + '>Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-board-frame">' +
          '<div class="ideation-edge-glow ideation-edge-glow-top" data-edge="top"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-right" data-edge="right"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-bottom" data-edge="bottom"></div>' +
          '<div class="ideation-edge-glow ideation-edge-glow-left" data-edge="left"></div>' +
          '<div id="ideationBoardStage" class="ideation-board-stage" tabindex="0">' +
            '<div id="ideationBoardWorld" class="ideation-board-world" style="transform: translate(calc(-50% + ' + state.viewportX + 'px), calc(-50% + ' + state.viewportY + 'px));">' +
              '<svg class="ideation-connections" viewBox="0 0 ' + BOARD_WORLD_WIDTH + ' ' + BOARD_WORLD_HEIGHT + '" preserveAspectRatio="none" aria-hidden="true">' + renderIdeationConnections({ cards: viewCards, connections: visibleConnections }) + '</svg>' +
              (viewCards.length > 0
                ? viewCards.map(card => renderIdeationCard(card, snapshot.focusCardId)).join('')
                : '<div class="ideation-empty-state"><div><strong>Start with one sharp note</strong><p class="section-copy">Select a card twice to edit it inline. Drag empty canvas space to pan, or drop and paste media to create attachment cards instantly.</p></div></div>') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ideation-hint">Drag cards by the header. Drag empty canvas space to pan the board. Drop files, images, or links onto the board to create a media card, or target the selected card before you drop. Select a card twice to edit it inline. Click a link to edit its label, line style, or arrow direction.</div>' +
      '</article>';
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

  function renderLensOption(value, label) {
    return '<option value="' + value + '" ' + (state.boardLens === value ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
  }

  function renderScoreField(label, id, value) {
    return '<label class="ideation-score-field"><span class="section-kicker">' + escapeHtml(label) + '</span><input id="' + id + '" type="range" min="0" max="100" step="1" value="' + escapeAttr(String(value || 0)) + '" /><span class="stat-detail">' + escapeHtml(String(value || 0)) + '</span></label>';
  }

  function renderSyncTargets(syncTargets) {
    const active = new Set(syncTargets || []);
    return '<div class="ideation-sync-grid">' +
      ['domain', 'operations', 'agents', 'knowledge-graph'].map(target => '<label class="ideation-check"><input type="checkbox" data-sync-target="' + target + '" ' + (active.has(target) ? 'checked' : '') + ' />' + escapeHtml(target) + '</label>').join('') +
      '</div>';
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

  function renderIdeationConnections(boardView) {
    return '<defs><marker id="ideationArrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto-start-reverse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="currentColor"></path></marker></defs>' + boardView.connections.map(connection => {
      const from = boardView.cards.find(card => card.id === connection.fromCardId);
      const to = boardView.cards.find(card => card.id === connection.toCardId);
      if (!from || !to) {
        return '';
      }
      const startX = BOARD_WORLD_ORIGIN_X + from.x + (CARD_WIDTH / 2);
      const startY = BOARD_WORLD_ORIGIN_Y + from.y + (CARD_HEIGHT / 2);
      const endX = BOARD_WORLD_ORIGIN_X + to.x + (CARD_WIDTH / 2);
      const endY = BOARD_WORLD_ORIGIN_Y + to.y + (CARD_HEIGHT / 2);
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const lineStyleClass = connection.style === 'solid' ? 'solid' : 'dotted';
      const markerStart = connection.direction === 'reverse' || connection.direction === 'both' ? 'url(#ideationArrow)' : '';
      const markerEnd = connection.direction === 'forward' || connection.direction === 'both' ? 'url(#ideationArrow)' : '';
      return '' +
        '<g class="ideation-link-group ' + (state.selectedLinkId === connection.id ? 'selected' : '') + '" data-link-id="' + escapeAttr(connection.id) + '" data-action="ideation-select-link" data-payload="' + escapeAttr(connection.id) + '">' +
          '<path class="ideation-link-hitbox" d="M ' + startX + ' ' + startY + ' C ' + midX + ' ' + startY + ', ' + midX + ' ' + endY + ', ' + endX + ' ' + endY + '"></path>' +
          '<path class="ideation-link ' + lineStyleClass + '" d="M ' + startX + ' ' + startY + ' C ' + midX + ' ' + startY + ', ' + midX + ' ' + endY + ', ' + endX + ' ' + endY + '"' + (markerStart ? ' marker-start="' + markerStart + '"' : '') + (markerEnd ? ' marker-end="' + markerEnd + '"' : '') + '></path>' +
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
        '<div class="ideation-card-scoreline"><span>C ' + escapeHtml(String(card.confidence || 0)) + '</span><span>E ' + escapeHtml(String(card.evidenceStrength || 0)) + '</span><span>R ' + escapeHtml(String(card.riskScore || 0)) + '</span><span>$ ' + escapeHtml(String(card.costToValidate || 0)) + '</span></div>' +
        ((card.tags || []).length > 0 ? '<div class="ideation-chip-row">' + card.tags.map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>' : '') +
        '<div class="ideation-card-actions"><span class="tag">' + escapeHtml(card.author) + '</span><span class="tag">' + escapeHtml(card.kind) + '</span></div>';
    return '' +
      '<article class="ideation-card ideation-card-' + escapeAttr(card.color) + ' ' + (state.selectedCardId === card.id ? 'selected' : '') + ' ' + (focusCardId === card.id ? 'focused' : '') + '" tabindex="0" role="button" data-action="ideation-select-card" data-payload="' + escapeAttr(card.id) + '" data-card-id="' + escapeAttr(card.id) + '" style="left: ' + (BOARD_WORLD_ORIGIN_X + card.x) + 'px; top: ' + (BOARD_WORLD_ORIGIN_Y + card.y) + 'px;">' +
        '<div class="ideation-card-shell">' +
          '<div class="ideation-card-head" data-drag-card-id="' + escapeAttr(card.id) + '">' +
            '<span class="tag">' + escapeHtml(card.kind) + '</span>' +
            '<span class="tag">' + escapeHtml(card.author) + '</span>' +
          '</div>' +
          '<div class="ideation-card-body">' + contentMarkup + '</div>' +
        '</div>' +
      '</article>';
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
      kind: 'idea',
      author: 'user',
      x: clampNumber((base?.x || 0) + 60, -1600, 1600),
      y: clampNumber((base?.y || 0) + 60, -1200, 1200),
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
    const duplicate = {
      ...selected,
      id: 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      title: selected.title + ' copy',
      x: clampNumber(selected.x + 42, -1600, 1600),
      y: clampNumber(selected.y + 42, -1200, 1200),
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
    state.selectedCardId = duplicate.id;
    state.selectedLinkId = '';
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

  function handleCardSelection(cardId, shouldEditInline) {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }
    if (state.linkStartCardId && state.linkStartCardId !== cardId) {
      const sourceCard = snapshot.cards.find(card => card.id === state.linkStartCardId);
      const targetCard = snapshot.cards.find(card => card.id === cardId);
      const relation = suggestLinkRelation(sourceCard, targetCard);
      snapshot.connections = snapshot.connections.concat({
        id: 'link-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        fromCardId: state.linkStartCardId,
        toCardId: cardId,
        label: relationLabel(relation),
        style: 'dotted',
        direction: 'none',
        relation,
      }).slice(-96);
      state.linkStartCardId = '';
      state.selectedCardId = cardId;
      state.selectedLinkId = '';
      scheduleIdeationSave();
      render();
      return;
    }
    state.selectedCardId = cardId;
    state.selectedLinkId = '';
    if (shouldEditInline) {
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
    state.selectedLinkId = linkId;
    state.editingCardId = '';
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
      state.selectedLinkId = '';
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
    if (state.selectedLinkId && !links.some(connection => connection.id === state.selectedLinkId)) {
      state.selectedLinkId = '';
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
    const visibleCards = applyBoardLens(state.snapshot.cards, state.boardLens);
    const visibleIds = new Set(visibleCards.map(card => card.id));
    const visibleConnections = state.snapshot.connections.filter(connection => visibleIds.has(connection.fromCardId) && visibleIds.has(connection.toCardId));
    svg.innerHTML = renderIdeationConnections({ cards: visibleCards, connections: visibleConnections });
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
    world.style.transform = 'translate(calc(-50% + ' + state.viewportX + 'px), calc(-50% + ' + state.viewportY + 'px))';
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
      const left = (width / 2) + state.viewportX + card.x;
      const top = (height / 2) + state.viewportY + card.y;
      if (left + CARD_WIDTH < 0) {
        edges.left = true;
      }
      if (left > width) {
        edges.right = true;
      }
      if (top + CARD_HEIGHT < 0) {
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
    const horizontalRange = Math.max(0, Math.floor((BOARD_WORLD_WIDTH - state.viewportMetrics.width) / 2));
    return clampNumber(value, -horizontalRange, horizontalRange);
  }

  function clampViewportY(value) {
    const verticalRange = Math.max(0, Math.floor((BOARD_WORLD_HEIGHT - state.viewportMetrics.height) / 2));
    return clampNumber(value, -verticalRange, verticalRange);
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
    const next = cards.slice();
    if (lens === 'experiments-only') {
      return next.filter(card => card.kind === 'experiment' || card.kind === 'evidence');
    }
    if (lens === 'risks-first') {
      return next.sort((left, right) => (right.riskScore || 0) - (left.riskScore || 0));
    }
    if (lens === 'feasibility') {
      return next.sort((left, right) => ((right.confidence || 0) - (right.costToValidate || 0)) - ((left.confidence || 0) - (left.costToValidate || 0)));
    }
    if (lens === 'user-journey') {
      const order = { 'user-insight': 0, problem: 1, requirement: 2, idea: 3, experiment: 4, evidence: 5, risk: 6, 'atlas-response': 7, attachment: 8 };
      return next.sort((left, right) => (order[left.kind] || 50) - (order[right.kind] || 50));
    }
    return next;
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

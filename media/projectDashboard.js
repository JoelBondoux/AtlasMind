(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('dashboard-root');
  const refreshButton = document.getElementById('dashboard-refresh');
  const versionStrip = document.getElementById('dashboard-version-strip');
  const noProjectBanner = document.getElementById('no-project-banner');

  noProjectBanner?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    const payload = target.dataset.payload || '';
    if (action === 'openCommand' && payload) {
      vscode.postMessage({ type: 'openCommand', payload });
    }
  });

  const state = {
    snapshot: undefined,
    activePage: 'overview',
    timescale: 30,
    editingRoadmapId: '',
    roadmapDraftText: '',
    draggedRoadmapId: '',
    gapBusy: false,
    gapStatus: '',
    activeDetails: {
      commits: '',
      runs: '',
      memory: '',
    },
    activeTestCategory: 'all',
    selectedTestId: '',
    testSearch: '',
    privacyDraftRule: { kind: 'term', value: '', sensitivity: 'confidential' },
    privacyTest: { kind: 'text', value: '' },
    privacyTestResult: null,
    privacyExpandedProviders: {},
    editingStageId: '',
    confirmRemoveStageId: '',
    editingPathId: '',
    promotion: null,
  };

  refreshButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'state') {
      state.snapshot = message.payload;
      if (noProjectBanner) {
        noProjectBanner.style.display = message.payload?.ssotPresent === false ? 'block' : 'none';
      }
      render();
      return;
    }

    if (message.type === 'navigate') {
      state.activePage = typeof message.payload === 'string' ? message.payload : 'overview';
      render();
      return;
    }

    if (message.type === 'dataPrivacyTestResult') {
      state.privacyTestResult = message.payload || null;
      render();
      return;
    }

    if (message.type === 'gapAnalysisBusy') {
      state.gapBusy = !!message.payload;
      render();
      return;
    }

    if (message.type === 'gapAnalysisStatus') {
      state.gapStatus = typeof message.payload === 'string' ? message.payload : '';
      render();
      return;
    }

    if (message.type === 'promotionPlan') {
      state.promotion = {
        plan: message.payload.plan,
        mode: message.payload.mode,
        attestations: {},
        confirmText: '',
        running: false,
        progress: [],
        result: null,
        error: '',
      };
      render();
      return;
    }

    if (message.type === 'promotionProgress') {
      if (state.promotion) {
        state.promotion.running = true;
        const list = state.promotion.progress;
        const existing = list.find(entry => entry.stepId === message.payload.stepId);
        if (existing) { Object.assign(existing, message.payload); }
        else { list.push(message.payload); }
        render();
      }
      return;
    }

    if (message.type === 'promotionDone') {
      if (state.promotion) {
        state.promotion.running = false;
        state.promotion.result = message.payload;
        render();
      }
      return;
    }

    if (message.type === 'promotionError') {
      if (!state.promotion) {
        state.promotion = { plan: null, mode: 'execute', attestations: {}, confirmText: '', running: false, progress: [], result: null, error: '' };
      }
      state.promotion.error = message.payload || 'Promotion failed.';
      state.promotion.running = false;
      render();
      return;
    }

    if (message.type === 'error') {
      renderError(message.payload || 'Dashboard refresh failed.');
      return;
    }
  });

  root?.addEventListener('click', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    const payload = target.dataset.payload || '';
    if (action === 'page') {
      state.activePage = payload;
      render();
      return;
    }
    if (action === 'timescale') {
      state.timescale = Number(payload) || 30;
      render();
      return;
    }
    if (action === 'test-category') {
      state.activeTestCategory = payload || 'all';
      render();
      return;
    }
    if (action === 'test-select') {
      state.selectedTestId = payload;
      render();
      return;
    }
    if (action === 'command') {
      vscode.postMessage({ type: 'openCommand', payload });
      return;
    }
    if (action === 'prompt') {
      vscode.postMessage({ type: 'openPrompt', payload: { prompt: payload, sourcePage: state.activePage } });
      return;
    }
    if (action === 'file') {
      vscode.postMessage({ type: 'openFile', payload });
      return;
    }
    if (action === 'run') {
      vscode.postMessage({ type: 'openRun', payload });
      return;
    }
    if (action === 'run-with-goal') {
      vscode.postMessage({ type: 'openRunWithGoal', payload });
      return;
    }
    if (action === 'session') {
      vscode.postMessage({ type: 'openSession', payload });
      return;
    }
    if (action === 'detail') {
      const [chartId, date, value] = payload.split('|');
      state.activeDetails[chartId] = `${date}: ${value}`;
      render();
      return;
    }
    if (action === 'roadmap-add') {
      state.activePage = 'roadmap';
      state.editingRoadmapId = 'new';
      state.roadmapDraftText = '';
      render();
      return;
    }
    if (action === 'roadmap-edit') {
      const item = getRoadmapItems().find(candidate => candidate.id === payload);
      state.activePage = 'roadmap';
      state.editingRoadmapId = payload;
      state.roadmapDraftText = item ? item.text : '';
      render();
      return;
    }
    if (action === 'roadmap-cancel') {
      state.editingRoadmapId = '';
      state.roadmapDraftText = '';
      render();
      return;
    }
    if (action === 'roadmap-save') {
      saveRoadmapDraft();
      return;
    }
    if (action === 'roadmap-delete') {
      persistRoadmapItems(getRoadmapItems().filter(item => item.id !== payload));
      return;
    }
    if (action === 'roadmap-toggle') {
      persistRoadmapItems(getRoadmapItems().map(item => item.id === payload ? { ...item, completed: !item.completed } : item));
      return;
    }
    if (action === 'gap-run') {
      state.activePage = 'gapAnalysis';
      state.gapBusy = true;
      state.gapStatus = 'Opening a live Atlas chat session for the analysis...';
      render();
      vscode.postMessage({ type: 'runGapAnalysis' });
      return;
    }
    if (action === 'gap-resolve') {
      state.gapStatus = 'Opening a new Atlas chat session to resolve this gap...';
      render();
      vscode.postMessage({ type: 'resolveGapItem', payload });
      return;
    }
    if (action === 'gap-open-files') {
      vscode.postMessage({ type: 'openGapFiles', payload });
      return;
    }
    if (action === 'gap-group') {
      state.gapStatus = `Opening a new Atlas chat session for ${payload} items...`;
      render();
      vscode.postMessage({ type: 'resolveGapGroup', payload });
      return;
    }
    if (action === 'gap-address') {
      state.gapStatus = 'Marking this item as resolved...';
      render();
      vscode.postMessage({ type: 'addressGap', payload });
      return;
    }
    if (action === 'privacy-add-rule') {
      const snapshot = state.snapshot;
      if (!snapshot || !snapshot.privacy) { return; }
      const draft = state.privacyDraftRule;
      const value = (draft.value || '').trim();
      if (!value) { return; }
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.rules = config.rules.concat([{
        id: 'rule-' + Date.now().toString(36),
        kind: draft.kind,
        value: value,
        sensitivity: draft.sensitivity,
        enabled: true,
      }]);
      state.privacyDraftRule = { kind: 'term', value: '', sensitivity: 'confidential' };
      savePrivacy(config);
      return;
    }
    if (action === 'privacy-remove-rule') {
      const snapshot = state.snapshot;
      if (!snapshot || !snapshot.privacy) { return; }
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.rules = config.rules.filter(rule => rule.id !== payload);
      savePrivacy(config);
      return;
    }
    if (action === 'privacy-test') {
      const value = (state.privacyTest.value || '').trim();
      if (!value) { return; }
      vscode.postMessage({ type: 'testDataPrivacy', payload: { kind: state.privacyTest.kind, value: value } });
      return;
    }
    if (action === 'privacy-provider-expand') {
      const current = privacyProviderExpandedById(payload);
      state.privacyExpandedProviders[payload] = !current;
      render();
      return;
    }
    if (action === 'privacy-open-url' || action === 'external-url') {
      vscode.postMessage({ type: 'openExternalUrl', payload });
      return;
    }
    if (action === 'stage-edit') { state.editingStageId = payload; state.confirmRemoveStageId = ''; render(); return; }
    if (action === 'stage-add') { state.editingStageId = 'new'; state.confirmRemoveStageId = ''; render(); return; }
    if (action === 'stage-cancel') { state.editingStageId = ''; state.confirmRemoveStageId = ''; render(); return; }
    if (action === 'stage-remove') { state.confirmRemoveStageId = payload; render(); return; }
    if (action === 'stage-remove-cancel') { state.confirmRemoveStageId = ''; render(); return; }
    if (action === 'stage-remove-confirm') {
      const cfg = cloneDeliveryConfig();
      cfg.stages = cfg.stages.filter(s => s.id !== payload);
      cfg.paths = cfg.paths.filter(p => p.fromStageId !== payload && p.toStageId !== payload);
      state.editingStageId = '';
      state.confirmRemoveStageId = '';
      postDeliveryConfig(cfg);
      return;
    }
    if (action === 'stage-save') {
      const container = document.getElementById('stage-editor');
      if (!container) { return; }
      const cfg = cloneDeliveryConfig();
      if (payload === 'new') {
        const stage = collectStageFromEditor(container, defaultNewStage());
        if (!stage.name || !stage.name.trim()) { return; }
        let id = 'stage-' + slugClient(stage.name);
        let unique = id;
        let n = 1;
        while (cfg.stages.some(s => s.id === unique)) { unique = id + '-' + (n++); }
        stage.id = unique;
        cfg.stages.push(stage);
      } else {
        const idx = cfg.stages.findIndex(s => s.id === payload);
        if (idx < 0) { return; }
        cfg.stages[idx] = collectStageFromEditor(container, cfg.stages[idx]);
      }
      state.editingStageId = '';
      state.confirmRemoveStageId = '';
      postDeliveryConfig(cfg);
      return;
    }
    if (action === 'path-edit') { state.editingPathId = payload; render(); return; }
    if (action === 'path-add') { state.editingPathId = 'new'; render(); return; }
    if (action === 'path-cancel') { state.editingPathId = ''; render(); return; }
    if (action === 'path-remove') {
      const cfg = cloneDeliveryConfig();
      cfg.paths = cfg.paths.filter(p => p.id !== payload);
      state.editingPathId = '';
      postDeliveryConfig(cfg);
      return;
    }
    if (action === 'path-save') {
      const container = document.getElementById('path-editor');
      if (!container) { return; }
      const fromEl = container.querySelector('[data-field="fromStageId"]');
      const toEl = container.querySelector('[data-field="toStageId"]');
      const routineEl = container.querySelector('[data-field="routineId"]');
      const fromId = fromEl ? fromEl.value : '';
      const toId = toEl ? toEl.value : '';
      const routineId = routineEl ? routineEl.value.trim() : '';
      if (!fromId || !toId || fromId === toId) { return; }
      const cfg = cloneDeliveryConfig();
      if (payload === 'new') {
        let id = 'promote-' + fromId + '-' + toId;
        let unique = id;
        let n = 1;
        while (cfg.paths.some(p => p.id === unique)) { unique = id + '-' + (n++); }
        cfg.paths.push({ id: unique, fromStageId: fromId, toStageId: toId, routineId: routineId });
      } else {
        const idx = cfg.paths.findIndex(p => p.id === payload);
        if (idx < 0) { return; }
        cfg.paths[idx] = Object.assign({}, cfg.paths[idx], { fromStageId: fromId, toStageId: toId, routineId: routineId });
      }
      state.editingPathId = '';
      postDeliveryConfig(cfg);
      return;
    }
    if (action === 'delivery-mark-reviewed') {
      vscode.postMessage({ type: 'markDeliveryReviewed' });
      return;
    }
    if (action === 'promote-plan') {
      vscode.postMessage({ type: 'requestPromotionPlan', payload: { pathId: payload, mode: 'execute' } });
      return;
    }
    if (action === 'promote-runbook') {
      vscode.postMessage({ type: 'requestPromotionPlan', payload: { pathId: payload, mode: 'runbook' } });
      return;
    }
    if (action === 'promotion-cancel') {
      state.promotion = null;
      render();
      return;
    }
    if (action === 'promotion-run') {
      const p = state.promotion;
      if (!p || !p.plan || p.running) { return; }
      if (p.plan.isProtected && (p.confirmText || '').trim().toLowerCase() !== p.plan.toName.trim().toLowerCase()) {
        p.error = 'Type the target name “' + p.plan.toName + '” exactly to confirm a protected promotion.';
        render();
        return;
      }
      const attest = Object.keys(p.attestations).filter(key => p.attestations[key]);
      p.error = '';
      p.running = true;
      p.progress = [];
      p.result = null;
      render();
      vscode.postMessage({ type: 'runPromotion', payload: { pathId: p.plan.pathId, attestations: attest, confirmText: p.confirmText || '' } });
      return;
    }
  });

  root?.addEventListener('input', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) {
      return;
    }
    if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-roadmap-draft')) {
      state.roadmapDraftText = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.id === 'test-search-input') {
      state.testSearch = target.value;
      render();
    }
    if (target instanceof HTMLInputElement && target.id === 'privacy-rule-value') {
      state.privacyDraftRule.value = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.id === 'privacy-test-value') {
      state.privacyTest.value = target.value;
      return;
    }
    if (target instanceof HTMLInputElement && target.id === 'promotion-confirm-text') {
      if (state.promotion) { state.promotion.confirmText = target.value; }
      return;
    }
  });

  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || !target.classList.contains('dashboard-methodology-cb')) {
      return;
    }
    const methodologyId = target.getAttribute('data-methodology-id');
    if (!methodologyId || !state.snapshot) {
      return;
    }
    const config = state.snapshot.testing && state.snapshot.testing.projectTestingConfig;
    const baseMethodologies = METHODOLOGY_DEFS.map(def => {
      const existing = config && config.methodologies ? config.methodologies.find(m => m.id === def.id) : undefined;
      return existing ? { ...existing } : { id: def.id, enabled: def.id === 'tdd' || def.id === 'unit' };
    });
    const updated = baseMethodologies.map(m => m.id === methodologyId ? { ...m, enabled: target.checked } : m);
    const newConfig = { version: 1, updatedAt: new Date().toISOString(), methodologies: updated };
    // Optimistically update local snapshot so re-renders stay consistent without a full refresh.
    if (state.snapshot.testing) {
      state.snapshot.testing.projectTestingConfig = newConfig;
    }
    vscode.postMessage({ type: 'saveTestingConfig', payload: newConfig });
  });

  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    if (target.id === 'test-select-jump') {
      state.selectedTestId = target.value;
      render();
    }
  });

  // Promotion modal: manual preflight attestations and the approval checkbox.
  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || !target.classList.contains('promotion-attest') || !state.promotion) {
      return;
    }
    const checkId = target.getAttribute('data-check-id');
    if (!checkId) {
      return;
    }
    state.promotion.attestations[checkId] = target.checked;
    render();
  });

  // Data Privacy controls: checkboxes (enable / packs / models / rule toggles)
  // and the rule/test selects.
  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) { return; }
    const snapshot = state.snapshot;

    if (target instanceof HTMLSelectElement) {
      if (target.id === 'privacy-rule-kind') {
        state.privacyDraftRule.kind = target.value;
        render();
        return;
      }
      if (target.id === 'privacy-rule-sensitivity') {
        state.privacyDraftRule.sensitivity = target.value;
        return;
      }
      if (target.id === 'privacy-test-kind') {
        state.privacyTest.kind = target.value;
        render();
        return;
      }
      return;
    }

    if (!(target instanceof HTMLInputElement) || !snapshot || !snapshot.privacy) { return; }

    if (target.hasAttribute('data-privacy-enable')) {
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.enabled = target.checked;
      savePrivacy(config);
      return;
    }
    if (target.hasAttribute('data-privacy-pack')) {
      const packId = target.getAttribute('data-privacy-pack');
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.compliancePacks = target.checked
        ? config.compliancePacks.concat(config.compliancePacks.includes(packId) ? [] : [packId])
        : config.compliancePacks.filter(id => id !== packId);
      savePrivacy(config);
      return;
    }
    if (target.hasAttribute('data-privacy-model')) {
      const modelId = target.getAttribute('data-privacy-model');
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.trustedModelIds = target.checked
        ? config.trustedModelIds.concat(config.trustedModelIds.includes(modelId) ? [] : [modelId])
        : config.trustedModelIds.filter(id => id !== modelId);
      savePrivacy(config);
      return;
    }
    if (target.hasAttribute('data-privacy-provider')) {
      const providerId = target.getAttribute('data-privacy-provider');
      const provider = (snapshot.privacy.providers || []).find(p => p.id === providerId);
      if (!provider) { return; }
      const childIds = provider.models.map(m => m.id);
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      if (target.checked) {
        const set = new Set(config.trustedModelIds);
        childIds.forEach(id => set.add(id));
        config.trustedModelIds = [...set];
      } else {
        config.trustedModelIds = config.trustedModelIds.filter(id => !childIds.includes(id));
      }
      savePrivacy(config);
      return;
    }
    if (target.hasAttribute('data-privacy-rule-toggle')) {
      const ruleId = target.getAttribute('data-privacy-rule-toggle');
      const config = privacyConfigFromSnapshot(snapshot.privacy);
      config.rules = config.rules.map(rule => rule.id === ruleId ? { ...rule, enabled: target.checked } : rule);
      savePrivacy(config);
      return;
    }
  });

  root?.addEventListener('dragstart', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    state.draggedRoadmapId = target.dataset.roadmapId || '';
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', state.draggedRoadmapId);
    }
  });

  root?.addEventListener('dragover', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (!(target instanceof HTMLElement) || !state.draggedRoadmapId) {
      return;
    }
    event.preventDefault();
  });

  root?.addEventListener('drop', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (!(target instanceof HTMLElement) || !state.draggedRoadmapId) {
      return;
    }
    event.preventDefault();
    moveRoadmapItem(state.draggedRoadmapId, target.dataset.roadmapId || '');
    state.draggedRoadmapId = '';
  });

  root?.addEventListener('dragend', () => {
    state.draggedRoadmapId = '';
  });

  function buildTddChatPrompt(tdd) {
    const parts = ['Review TDD compliance for recent project runs and help fix the gaps.'];
    if (tdd.missing > 0) {
      parts.push(`There are ${tdd.missing} subtask(s) missing TDD evidence. Please identify which subtasks lack test coverage or verification records and suggest concrete steps to add the missing evidence.`);
    }
    if (tdd.blocked > 0) {
      parts.push(`There are ${tdd.blocked} blocked subtask(s). Please review what is blocking them and propose fixes.`);
    }
    if (tdd.detail) {
      parts.push(`Current status: ${tdd.detail}`);
    }
    return parts.join(' ');
  }

  function buildTddRunGoal(tdd) {
    const issues = [];
    if (tdd.missing > 0) {
      issues.push(`add missing TDD evidence for ${tdd.missing} subtask(s)`);
    }
    if (tdd.blocked > 0) {
      issues.push(`unblock ${tdd.blocked} blocked subtask(s)`);
    }
    return `Fix TDD compliance gaps: ${issues.join(' and ')}.`;
  }

  function render() {
    if (!root) {
      return;
    }

    // --- Preserve focus and cursor position for test search and roadmap textarea ---
    let activeId = null, cursorPos = null, isTextarea = false;
    const active = document.activeElement;
    if (active && (active.id === 'test-search-input' || (active instanceof HTMLTextAreaElement && active.hasAttribute('data-roadmap-draft')))) {
      activeId = active.id || (active.hasAttribute('data-roadmap-draft') ? 'roadmap-draft' : null);
      isTextarea = active instanceof HTMLTextAreaElement;
      if (typeof active.selectionStart === 'number') {
        cursorPos = [active.selectionStart, active.selectionEnd];
      }
    }

    // --- Preserve scroll positions so toggling a checkbox / expanding a tree
    // does not jump the page (or the inner scrollable lists) back to the top. ---
    const pageScrollY = window.scrollY || (document.scrollingElement ? document.scrollingElement.scrollTop : 0) || 0;
    const innerScroll = {};
    document.querySelectorAll('[data-scroll-key]').forEach(el => {
      innerScroll[el.getAttribute('data-scroll-key')] = el.scrollTop;
    });

    try {
      const snapshot = state.snapshot;
      if (!snapshot) {
        if (versionStrip) {
          versionStrip.innerHTML = '';
        }
        root.innerHTML = '<div class="dashboard-loading">Loading dashboard signals…</div>';
        return;
      }

      if (versionStrip) {
        versionStrip.innerHTML = renderVersionStrip(snapshot);
      }

      const pages = [
        ['overview', 'Overview'],
        ['score', 'Score'],
        ['repo', 'Repo'],
        ['runtime', 'Runtime'],
        ['testing', 'Testing'],
        ['ssot', 'SSOT'],
        ['roadmap', 'Roadmap'],
        ['gapAnalysis', 'Gap Analysis'],
        ['security', 'Security'],
        ['privacy', 'Privacy'],
        ['delivery', 'Delivery'],
      ];

      root.innerHTML = `
        <section class="hero-grid">
          <article class="hero-card">
            <p class="dashboard-kicker">${escapeHtml(snapshot.workspaceName)}</p>
            <h2>${escapeHtml(snapshot.repositoryLabel)}</h2>
            <p class="section-copy">${escapeHtml(snapshot.healthSummary)}</p>
            <div class="hero-meta">
              <span class="meta-pill">Generated ${escapeHtml(relativeLabel(snapshot.generatedAt))}</span>
              <span class="meta-pill">Branch ${escapeHtml(snapshot.currentBranch)}</span>
              <span class="meta-pill">SSOT ${escapeHtml(snapshot.ssot.path)}</span>
            </div>
          </article>
          <button type="button" class="score-card" data-action="page" data-payload="score">
            <p class="dashboard-kicker">Operational score</p>
            ${renderScoreRing(snapshot.healthScore)}
            <div class="score-value">${escapeHtml(String(snapshot.healthScore))}</div>
            <div class="score-caption">Composite score across operational discipline and outcome completeness. Click for the breakdown.</div>
          </button>
        </section>

        <section class="toolbar-row">
          <div class="page-nav" role="tablist" aria-label="Dashboard sections">
            ${pages.map(([id, label]) => `<button type="button" data-action="page" data-payload="${id}" class="${state.activePage === id ? 'active' : ''}">${escapeHtml(label)}</button>`).join('')}
          </div>
          <div class="timescale-switch" role="group" aria-label="Chart timescale">
            ${[7, 30, 90].map(days => `<button type="button" data-action="timescale" data-payload="${days}" class="${state.timescale === days ? 'active' : ''}">${days}D</button>`).join('')}
          </div>
        </section>

        ${renderOverview(snapshot)}
        ${renderScore(snapshot)}
        ${renderRepo(snapshot)}
        ${renderRuntime(snapshot)}
        ${renderTesting(snapshot)}
        ${renderSsot(snapshot)}
        ${renderRoadmap(snapshot)}
        ${renderGapAnalysis(snapshot)}
        ${renderSecurity(snapshot)}
        ${renderPrivacy(snapshot)}
        ${renderDelivery(snapshot)}
        ${renderPromotionModal()}
      `;

      // --- Restore focus and cursor position if needed ---
      if (activeId) {
        let el = null;
        if (activeId === 'test-search-input') {
          el = document.getElementById('test-search-input');
        } else if (activeId === 'roadmap-draft') {
          el = document.querySelector('textarea[data-roadmap-draft]');
        }
        if (el) {
          el.focus();
          if (cursorPos && typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(cursorPos[0], cursorPos[1]);
          }
        }
      }

      // Indeterminate is a DOM property, not an attribute — set it post-render
      // for provider checkboxes where only some child models are trusted.
      root.querySelectorAll('input[data-privacy-provider][data-indeterminate="true"]').forEach(el => {
        el.indeterminate = true;
      });

      // Restore scroll positions captured before the innerHTML swap.
      document.querySelectorAll('[data-scroll-key]').forEach(el => {
        const saved = innerScroll[el.getAttribute('data-scroll-key')];
        if (typeof saved === 'number') { el.scrollTop = saved; }
      });
      if (pageScrollY > 0) {
        window.scrollTo(0, pageScrollY);
      }
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  function renderError(message) {
    if (!root) {
      return;
    }
    if (versionStrip) {
      versionStrip.innerHTML = '';
    }
    root.innerHTML = `
      <div class="dashboard-empty">
        <div>
          <strong>Dashboard refresh failed</strong>
          <div class="stat-detail">${escapeHtml(message)}</div>
        </div>
      </div>
    `;
  }

  function renderVersionStrip(snapshot) {
    const pills = [];

    if (snapshot.versions?.production && snapshot.versions.production.branch !== snapshot.versions.current.branch) {
      pills.push(renderVersionPill('Production', snapshot.versions.production.branch, snapshot.versions.production.version));
    }

    const currentLabel = snapshot.versions?.current?.isProduction ? 'Production' : 'Current';
    pills.push(renderVersionPill(currentLabel, snapshot.versions.current.branch, snapshot.versions.current.version));
    return pills.join('');
  }

  function renderVersionPill(label, branch, version) {
    return `
      <span class="dashboard-version-pill">
        <strong>${escapeHtml(label)}</strong>
        <span class="dashboard-version-pill-muted">${escapeHtml(branch)}</span>
        <span>v${escapeHtml(version)}</span>
      </span>
    `;
  }

  function renderOverview(snapshot) {
    // Insert Gap Analysis button after Ideation Loop in stats grid
    let stats = [...snapshot.stats];
    const ideationIdx = stats.findIndex(stat => stat.id === 'ideation');
    if (ideationIdx !== -1) {
      stats.splice(ideationIdx + 1, 0, {
        id: 'gap-analysis',
        label: 'Gap Analysis',
        value: snapshot.gapAnalysis && snapshot.gapAnalysis.items.filter(i => !i.resolved && i.type !== 'praise').length > 0
          ? `${snapshot.gapAnalysis.items.filter(i => !i.resolved && i.type !== 'praise').length} open`
          : snapshot.gapAnalysis && snapshot.gapAnalysis.completed
            ? 'Clear'
            : 'Ready',
        detail: 'Prioritized project-wide gaps, concerns, and praise.',
        tone: (snapshot.gapAnalysis && snapshot.gapAnalysis.items.some(i => !i.resolved && i.type !== 'praise')) ? 'warn' : 'neutral',
        pageTarget: 'gapAnalysis',
      });
    }
    return `
      <section class="page-section ${state.activePage === 'overview' ? 'active' : ''}">
        <div class="stats-grid">
          ${stats.map(stat => renderStatCard(stat)).join('')}
        </div>
        <div class="chart-grid">
          ${renderChartCard('commits', 'Commit Activity', 'Recent git commit velocity across the selected time window.', snapshot.charts.commits)}
          ${renderChartCard('runs', 'Run Activity', 'Autonomous run updates recorded in Project Run History.', snapshot.charts.runs)}
          ${renderChartCard('memory', 'SSOT Activity', 'Indexed memory update cadence across the current SSOT root.', snapshot.charts.memory)}
        </div>
        <div class="action-grid">
          ${snapshot.quickActions.map(action => renderActionCard(action)).join('')}
        </div>
      </section>
    `;
  }

  function renderGapAnalysis(snapshot) {
    const gap = snapshot.gapAnalysis || { completed: false, items: [], lastRun: null };
    const openItems = gap.items.filter(item => !item.resolved && item.type !== 'praise');
    const praiseItems = gap.items.filter(item => item.type === 'praise');
    const grouped = ['P1', 'P2', 'P3'].map(priority => ({
      priority,
      items: openItems.filter(item => item.priority === priority),
    })).filter(group => group.items.length > 0);

    return `
      <section class="page-section ${state.activePage === 'gapAnalysis' ? 'active' : ''}">
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Gap Analysis</p>
            <h3>Prioritized gaps, concerns, and strengths</h3>
            <div class="stat-detail">${gap.completed ? `Last run: ${escapeHtml(gap.lastRun || '')}` : 'Preliminary signal-based findings are shown below. Run the full analysis for a richer report.'}</div>
            ${state.gapStatus ? `<div class="tag-row"><span class="tag ${state.gapBusy ? 'tag-warn' : 'tag-good'}">${escapeHtml(state.gapStatus)}</span></div>` : ''}
            <div class="tag-row">
              ${grouped.length > 0 ? grouped.map(group => `<button type="button" class="action-link" data-action="gap-group" data-payload="${escapeAttr(group.priority)}">Resolve ${escapeHtml(group.priority)} (${group.items.length})</button>`).join('') : ''}
              <button type="button" class="action-link" data-action="gap-run" data-payload="" ${state.gapBusy ? 'disabled' : ''}>${state.gapBusy ? 'Running…' : gap.completed ? 'Re-run Analysis' : 'Run Gap Analysis'}</button>
            </div>
          </article>
          ${grouped.length > 0 ? grouped.map(group => `
            <article class="panel-card">
              <p class="section-kicker">${escapeHtml(group.priority)}</p>
              <h3>${escapeHtml(group.priority === 'P1' ? 'Highest priority' : group.priority === 'P2' ? 'Important follow-up' : 'Polish and refinement')}</h3>
              <div class="stack-list">
                ${group.items.map(item => `
                  <div class="recent-item">
                    <div class="row-head">
                      <strong>${escapeHtml(item.text)}</strong>
                      <span class="tag ${group.priority === 'P1' ? 'tag-critical' : group.priority === 'P2' ? 'tag-warn' : ''}">${escapeHtml(item.priority)}</span>
                    </div>
                    <div class="list-meta">${escapeHtml(formatGapCategoryLabel(item.category))} • ${escapeHtml(item.type === 'gap' ? 'Gap' : 'Concern')}</div>
                    <div class="tag-row">
                      <button type="button" class="action-link" data-action="gap-resolve" data-payload="${escapeAttr(item.id)}">Resolve in Chat</button>
                      <button type="button" class="action-link" data-action="gap-open-files" data-payload="${escapeAttr(item.id)}">Open Files</button>
                      <button type="button" class="action-link" data-action="gap-address" data-payload="${escapeAttr(item.id)}">Mark Resolved</button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </article>
          `).join('') : `<article class="panel-card"><div class="dashboard-empty">No open gap items are currently tracked.</div></article>`}
          <article class="panel-card">
            <p class="section-kicker">Good points</p>
            <h3>What the analysis likes</h3>
            <div class="stack-list">
              ${praiseItems.length > 0 ? praiseItems.map(item => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(item.text)}</strong>
                    <span class="tag tag-good">${escapeHtml(item.priority)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(formatGapCategoryLabel(item.category))} • Praise</div>
                </div>
              `).join('') : '<div class="dashboard-empty">No praise items have been recorded yet.</div>'}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function formatGapCategoryLabel(category) {
    switch (category) {
      case 'ui-ux': return 'UI/UX';
      case 'code-structure': return 'Code Structure';
      case 'ssot': return 'Memory';
      default:
        return String(category || 'general').replace(/-/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    }
  }

  function renderScore(snapshot) {
    const recommendationsByHorizon = {
      short: snapshot.score.recommendations.filter(item => item.horizon === 'short'),
      medium: snapshot.score.recommendations.filter(item => item.horizon === 'medium'),
      long: snapshot.score.recommendations.filter(item => item.horizon === 'long'),
    };

    return `
      <section class="page-section ${state.activePage === 'score' ? 'active' : ''}">
        <div class="panel-grid score-summary-grid">
          <article class="panel-card score-overview-card">
            <p class="section-kicker">Operational score</p>
            <h3>${escapeHtml(String(snapshot.healthScore))}/100</h3>
            <div class="stat-detail">${escapeHtml(snapshot.healthSummary)}</div>
            <div class="tag-row">
              <span class="tag ${snapshot.healthScore >= 85 ? 'tag-good' : snapshot.healthScore >= 65 ? '' : 'tag-warn'}">Operational ${escapeHtml(String(snapshot.healthScore))}</span>
              <span class="tag ${snapshot.score.outcome.score >= 75 ? 'tag-good' : snapshot.score.outcome.score >= 55 ? '' : 'tag-warn'}">Outcome completeness ${escapeHtml(String(snapshot.score.outcome.score))}%</span>
            </div>
          </article>
          <article class="panel-card score-outcome-card">
            <p class="section-kicker">Desired outcome</p>
            <h3>What the project says it is trying to become</h3>
            <div class="stat-detail">${escapeHtml(snapshot.score.outcome.desiredOutcome)}</div>
            <div class="mini-grid">
              ${renderMetricPill('References resolved', `${snapshot.score.outcome.referenceCoveragePercent}%`)}
              ${renderMetricPill('Roadmap progress', snapshot.score.outcome.roadmapTotal > 0 ? `${snapshot.score.outcome.roadmapCompleted}/${snapshot.score.outcome.roadmapTotal}` : 'No tracked items')}
              ${renderMetricPill('Run completion', `${snapshot.score.outcome.runCompletionPercent}%`)}
            </div>
          </article>
        </div>
        <div class="panel-grid">
          <article class="panel-card score-component-card">
            <p class="section-kicker">Breakdown</p>
            <h3>Where the score comes from</h3>
            <div class="score-component-list">
              ${snapshot.score.components.map(component => renderScoreComponent(component)).join('')}
            </div>
          </article>
          <article class="panel-card score-component-card">
            <p class="section-kicker">Outcome completeness</p>
            <h3>Evidence that the desired end state is taking shape</h3>
            <div class="signal-grid">
              ${snapshot.score.outcome.signals.map(signal => renderSignalCard(signal.label, signal.ok, signal.detail, signal.actionPrompt)).join('')}
            </div>
            <div class="stat-detail">${escapeHtml(snapshot.score.outcome.summary)}</div>
          </article>
        </div>
        <div class="score-recommendation-grid">
          ${renderRecommendationColumn('Short term', 'Next operational moves that improve the score quickly.', recommendationsByHorizon.short)}
          ${renderRecommendationColumn('Medium term', 'Structural changes that make the score more trustworthy.', recommendationsByHorizon.medium)}
          ${renderRecommendationColumn('Long term', 'How to keep the score aligned with actual project completion.', recommendationsByHorizon.long)}
        </div>
      </section>
    `;
  }

  function renderRepo(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'repo' ? 'active' : ''}">
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Repo state</p>
            <h3>Working tree</h3>
            <div class="mini-grid">
              ${renderMetricPill('Ahead', String(snapshot.repo.ahead))}
              ${renderMetricPill('Behind', String(snapshot.repo.behind))}
              ${renderMetricPill('Staged files', String(snapshot.repo.staged))}
              ${renderMetricPill('Modified files', String(snapshot.repo.modified))}
              ${renderMetricPill('Untracked files', String(snapshot.repo.untracked))}
              ${renderMetricPill('Local branches', String(snapshot.repo.branchCount))}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="workbench.view.scm">Open Source Control</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Recent commits</p>
            <h3>Latest changes</h3>
            <div class="stack-list">
              ${snapshot.repo.commits.length > 0 ? snapshot.repo.commits.map(commit => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(commit.subject)}</strong>
                    <span class="tag mono">${escapeHtml(commit.shortHash)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(commit.author)} • ${escapeHtml(commit.committedRelative)}</div>
                </div>`).join('') : '<div class="dashboard-empty">No commit history available.</div>'}
            </div>
          </article>
        </div>
        <div class="repo-grid">
          <article class="list-card">
            <p class="section-kicker">Branches</p>
            <h3>Most recently touched</h3>
            <div class="stack-list">
              ${snapshot.repo.branches.length > 0 ? snapshot.repo.branches.map(branch => `
                <button type="button" class="branch-card">
                  <div class="row-head">
                    <h4>${escapeHtml(branch.name)}${branch.current ? ' <span class="tag">current</span>' : ''}</h4>
                    <span class="list-meta">${escapeHtml(branch.lastCommitRelative)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(branch.subject || 'No commit message available.')}</div>
                  <div class="tag-row">${branch.upstream ? `<span class="tag mono">${escapeHtml(branch.upstream)}</span>` : '<span class="tag">No upstream</span>'}</div>
                </button>`).join('') : '<div class="dashboard-empty">No branches available.</div>'}
            </div>
          </article>
          <article class="list-card">
            <p class="section-kicker">Signals</p>
            <h3>Review focus</h3>
            <div class="signal-grid">
              ${renderSignalCard('Repo cleanliness', !snapshot.repo.dirty, snapshot.repo.dirty ? 'Local changes are still pending review or commit.' : 'Working tree is clean right now.')}
              ${renderSignalCard('Branch drift', snapshot.repo.behind === 0, snapshot.repo.behind === 0 ? 'Current branch is not behind its upstream.' : `${snapshot.repo.behind} upstream commit(s) are still missing locally.`)}
              ${renderSignalCard('Change size', snapshot.repo.modified + snapshot.repo.staged + snapshot.repo.untracked <= 12, `${snapshot.repo.modified + snapshot.repo.staged + snapshot.repo.untracked} file(s) currently differ from HEAD.`)}
              ${renderSignalCard('Commit cadence', snapshot.charts.commits.some(point => point.value > 0), 'Chart activity reflects recent local commit history.')}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderRuntime(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'runtime' ? 'active' : ''}">
        <div class="runtime-grid">
          <article class="panel-card">
            <p class="section-kicker">Atlas runtime</p>
            <h3>Capability coverage</h3>
            <div class="mini-grid">
              ${renderMetricPill('Enabled agents', `${snapshot.runtime.enabledAgents}/${snapshot.runtime.totalAgents}`)}
              ${renderMetricPill('Enabled skills', `${snapshot.runtime.enabledSkills}/${snapshot.runtime.totalSkills}`)}
              ${renderMetricPill('Healthy providers', `${snapshot.runtime.healthyProviders}/${snapshot.runtime.totalProviders}`)}
              ${renderMetricPill('Enabled models', `${snapshot.runtime.enabledModels}/${snapshot.runtime.totalModels}`)}
              ${renderMetricPill('Sessions', String(snapshot.runtime.sessionCount))}
              ${renderMetricPill('Project runs', String(snapshot.runtime.projectRunCount))}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openAgentPanel">Manage agents</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openModelProviders">Model providers</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Session economics</p>
            <h3>Cost and usage</h3>
            <div class="mini-grid">
              ${renderMetricPill('Total cost', formatCurrency(snapshot.runtime.totalCostUsd))}
              ${renderMetricPill('Requests', String(snapshot.runtime.totalRequests))}
              ${renderMetricPill('Input tokens', formatNumber(snapshot.runtime.totalInputTokens))}
              ${renderMetricPill('Output tokens', formatNumber(snapshot.runtime.totalOutputTokens))}
              ${renderMetricPill('Autopilot', snapshot.runtime.autopilot ? 'Enabled' : 'Disabled')}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.toggleAutopilot">Toggle Autopilot</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openChatView">Open chat</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">TDD compliance</p>
            <h3>Recent project-run posture</h3>
            <div class="signal-grid">
              ${renderSignalCard('TDD summary', snapshot.runtime.tdd.tone === 'good', snapshot.runtime.tdd.summary)}
              ${renderSignalCard('Verified subtasks', snapshot.runtime.tdd.verified > 0, `${snapshot.runtime.tdd.verified} verified subtask(s) recorded.`)}
              ${renderSignalCard('Blocked subtasks', snapshot.runtime.tdd.blocked === 0, `${snapshot.runtime.tdd.blocked} blocked subtask(s) recorded.`)}
              ${renderSignalCard('Missing evidence', snapshot.runtime.tdd.missing === 0, `${snapshot.runtime.tdd.missing} subtask(s) are missing TDD evidence.`)}
            </div>
            <div class="stat-detail">${escapeHtml(snapshot.runtime.tdd.detail)}</div>
            <div class="tag-row">
              ${snapshot.runtime.tdd.missing > 0 || snapshot.runtime.tdd.blocked > 0 ? `
              <button type="button" class="action-link" data-action="prompt" data-payload="${escapeAttr(buildTddChatPrompt(snapshot.runtime.tdd))}">Ask Atlas to fix TDD gaps</button>
              <button type="button" class="action-link" data-action="run-with-goal" data-payload="${escapeAttr(buildTddRunGoal(snapshot.runtime.tdd))}">Plan a TDD fix run</button>
              ` : ''}
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openProjectRunCenter">Open Project Run Center</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Active work</p>
            <h3>Recent autonomous runs</h3>
            <div class="stack-list">
              ${snapshot.runtime.runs.length > 0 ? snapshot.runtime.runs.map(run => `
                <button type="button" class="recent-item" data-action="run" data-payload="${escapeAttr(run.id)}">
                  <div class="row-head">
                    <strong>${escapeHtml(run.goal)}</strong>
                    <span class="tag">${escapeHtml(run.status)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(run.progressLabel)} • ${escapeHtml(run.updatedRelative)}</div>
                  <div class="tag-row">
                    <span class="tag ${run.tddTone === 'critical' ? 'tag-critical' : run.tddTone === 'warn' ? 'tag-warn' : run.tddTone === 'good' ? 'tag-good' : ''}">TDD ${escapeHtml(run.tddLabel)}</span>
                  </div>
                </button>`).join('') : '<div class="dashboard-empty">No project runs recorded yet.</div>'}
            </div>
          </article>
        </div>
        <div class="panel-grid">
          <article class="list-card">
            <p class="section-kicker">Chat sessions</p>
            <h3>Recent threads</h3>
            <div class="stack-list">
              ${snapshot.runtime.sessions.length > 0 ? snapshot.runtime.sessions.map(session => `
                <button type="button" class="recent-item" data-action="session" data-payload="${escapeAttr(session.id)}">
                  <div class="row-head">
                    <strong>${escapeHtml(session.title)}</strong>
                    ${session.active ? '<span class="tag">active</span>' : `<span class="list-meta">${escapeHtml(session.updatedRelative)}</span>`}
                  </div>
                  <div class="list-meta">${escapeHtml(String(session.turnCount))} turns</div>
                </button>`).join('') : '<div class="dashboard-empty">No sessions available.</div>'}
            </div>
          </article>
          <article class="list-card">
            <p class="section-kicker">Operational notes</p>
            <h3>Suggested next checks</h3>
            <div class="signal-grid">
              ${renderSignalCard('Provider health', snapshot.runtime.healthyProviders === snapshot.runtime.totalProviders, `${snapshot.runtime.healthyProviders} healthy provider(s) out of ${snapshot.runtime.totalProviders}.`)}
              ${renderSignalCard('Model breadth', snapshot.runtime.enabledModels >= 3, `${snapshot.runtime.enabledModels} enabled routed model(s).`)}
              ${renderSignalCard('Session load', snapshot.runtime.sessionCount > 0, `${snapshot.runtime.sessionCount} chat session(s) tracked in the workspace.`)}
              ${renderSignalCard('Autonomous history', snapshot.runtime.projectRunCount > 0, `${snapshot.runtime.projectRunCount} project run(s) available for review.`)}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderTesting(snapshot) {
    const testing = snapshot.testing || {
      frameworkLabel: 'Workspace tests',
      testingPolicyLabel: 'Red-Green TDD',
      testingPolicyDetail: 'Default Atlas tests-first policy.',
      totalFiles: 0,
      totalSuites: 0,
      totalCases: 0,
      unitFiles: 0,
      integrationFiles: 0,
      e2eFiles: 0,
      averageCasesPerFile: '0',
      coverageDetail: 'No test data available.',
      packageScripts: [],
      configFiles: [],
      files: [],
      tests: [],
      categoryCounts: [],
      verificationEnabled: false,
      verificationScripts: [],
    };

    const filteredTests = getFilteredTests(testing);
    const selectedTest = getSelectedTest(testing, filteredTests);
    const groupedTests = [
      ['unit', 'Unit'],
      ['integration', 'Integration'],
      ['e2e', 'E2E'],
      ['other', 'Other'],
    ].map(([key, label]) => ({
      key,
      label,
      items: filteredTests.filter(test => test.category === key),
    })).filter(group => group.items.length > 0);

    return `
      <section class="page-section ${state.activePage === 'testing' ? 'active' : ''}">
        <div class="stats-grid">
          <article class="stat-card">
            <span class="stat-label">Framework</span>
            <span class="stat-value">${escapeHtml(testing.frameworkLabel)}</span>
            <div class="stat-meta">Detected from scripts and dependencies.</div>
          </article>
          <article class="stat-card">
            <span class="stat-label">Testing policy</span>
            <span class="stat-value">${escapeHtml(testing.testingPolicyLabel || 'Red-Green TDD')}</span>
            <div class="stat-meta">${escapeHtml(testing.testingPolicyDetail || 'Default Atlas tests-first policy.')}</div>
          </article>
          <article class="stat-card">
            <span class="stat-label">Discovered files</span>
            <span class="stat-value">${escapeHtml(String(testing.totalFiles))}</span>
            <div class="stat-meta">${escapeHtml(`${testing.unitFiles} unit • ${testing.integrationFiles} integration • ${testing.e2eFiles} e2e`)}</div>
          </article>
          <article class="stat-card">
            <span class="stat-label">Individual tests</span>
            <span class="stat-value">${escapeHtml(String(testing.tests.length || testing.totalCases))}</span>
            <div class="stat-meta">${escapeHtml(`${testing.totalSuites} suites, ${testing.averageCasesPerFile} avg cases/file`)}</div>
          </article>
          <article class="stat-card">
            <span class="stat-label">Coverage</span>
            <span class="stat-value">${escapeHtml(testing.coveragePercent || '—')}</span>
            <div class="stat-meta">${escapeHtml(testing.coverageDetail)}</div>
          </article>
          <article class="stat-card">
            <span class="stat-label">Verification</span>
            <span class="stat-value">${escapeHtml(testing.verificationEnabled ? 'On' : 'Off')}</span>
            <div class="stat-meta">${escapeHtml((testing.verificationScripts || []).join(', ') || 'No scripts configured')}</div>
          </article>
        </div>

        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Test browser</p>
            <h3>Browse every detected test</h3>
            <div class="stat-detail">Use the category filters, searchable list, or dropdown jump menu when the suite gets large.</div>
            <div class="tag-row">
              <button type="button" class="tag ${state.activeTestCategory === 'all' ? 'tag-good' : ''}" data-action="test-category" data-payload="all">All (${escapeHtml(String(testing.tests.length || testing.totalCases))})</button>
              ${(testing.categoryCounts || []).map(group => `<button type="button" class="tag ${state.activeTestCategory === group.key ? 'tag-good' : ''}" data-action="test-category" data-payload="${escapeAttr(group.key)}">${escapeHtml(`${group.label} (${group.count})`)}</button>`).join('')}
            </div>
            <div class="panel-grid" style="grid-template-columns: 1fr 260px; margin-top: 12px;">
              <input id="test-search-input" class="ideation-input" type="search" placeholder="Search by title, suite, or file" value="${escapeAttr(state.testSearch || '')}" />
              <select id="test-select-jump" class="ideation-select">
                <option value="">Jump to a test…</option>
                ${filteredTests.map(test => `<option value="${escapeAttr(test.id)}" ${state.selectedTestId === test.id ? 'selected' : ''}>${escapeHtml(`${test.title} — ${test.relativePath}`)}</option>`).join('')}
              </select>
            </div>
            <div class="stack-list" style="margin-top: 14px;">
              ${groupedTests.length > 0 ? groupedTests.map(group => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(group.label)}</strong>
                    <span class="tag">${escapeHtml(String(group.items.length))}</span>
                  </div>
                  <div class="stack-list">
                    ${group.items.map(test => `
                      <button type="button" class="recent-item" data-action="test-select" data-payload="${escapeAttr(test.id)}">
                        <div class="row-head">
                          <strong>${escapeHtml(test.title)}</strong>
                          <span class="tag ${state.selectedTestId === test.id ? 'tag-good' : ''}">L${escapeHtml(String(test.line))}</span>
                        </div>
                        <div class="list-meta">${escapeHtml(test.suiteTitle)} • ${escapeHtml(test.relativePath)}</div>
                      </button>`).join('')}
                  </div>
                </div>`).join('') : '<div class="dashboard-empty">No matching tests were found for the current filter.</div>'}
            </div>
          </article>

          <article class="panel-card">
            <p class="section-kicker">Selected test</p>
            <h3>${escapeHtml(selectedTest ? selectedTest.title : 'Choose a test')}</h3>
            <div class="stat-detail">${escapeHtml(selectedTest ? selectedTest.description : 'Pick any discovered test to inspect its suite context, likely input steps, assertions, and source location.')}</div>
            <div class="mini-grid">
              ${renderMetricPill('Suite', selectedTest ? selectedTest.suiteTitle : '—')}
              ${renderMetricPill('Category', selectedTest ? selectedTest.category : '—')}
              ${renderMetricPill('File', selectedTest ? selectedTest.relativePath : '—')}
              ${renderMetricPill('Line', selectedTest ? String(selectedTest.line) : '—')}
            </div>
            <div class="stack-list">
              <div class="recent-item">
                <div class="row-head"><strong>Description</strong></div>
                <div class="list-meta">${escapeHtml(selectedTest ? selectedTest.description : 'No test selected.')}</div>
              </div>
              <div class="recent-item">
                <div class="row-head"><strong>Input / arrange</strong></div>
                <div class="list-meta mono">${escapeHtml(selectedTest ? selectedTest.inputSummary : 'Select a test to inspect its setup and execution steps.')}</div>
              </div>
              <div class="recent-item">
                <div class="row-head"><strong>Output / assertions</strong></div>
                <div class="list-meta mono">${escapeHtml(selectedTest ? selectedTest.outputSummary : 'Assertion details will appear here.')}</div>
              </div>
            </div>
            <div class="tag-row">
              ${selectedTest ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(`${selectedTest.relativePath}#L${selectedTest.line}`)}">Open at source</button>` : ''}
              ${selectedTest ? `<button type="button" class="action-link" data-action="prompt" data-payload="Review the test named '${escapeAttr(selectedTest.title)}' in ${escapeAttr(selectedTest.relativePath)} and explain what behavior it validates, what edge cases remain uncovered, and whether the assertions are strong enough.">Analyze in chat</button>` : ''}
            </div>
          </article>
        </div>

        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Maintenance actions</p>
            <h3>Coverage and validation</h3>
            <div class="tag-row">
              ${(testing.packageScripts || []).map(script => `<span class="tag mono">${escapeHtml(script)}</span>`).join('') || '<span class="tag">No test scripts detected</span>'}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openProjectRunCenter">Open Project Run Center</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsSafety">Open Verification Settings</button>
              ${testing.coverageReportRelativePath ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(testing.coverageReportRelativePath)}">Open coverage artifact</button>` : ''}
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Recently touched test files</p>
            <h3>File inventory</h3>
            <div class="stack-list">
              ${(testing.files || []).length > 0 ? testing.files.map(file => `
                <button type="button" class="recent-item" data-action="file" data-payload="${escapeAttr(file.relativePath)}">
                  <div class="row-head">
                    <strong>${escapeHtml(file.relativePath)}</strong>
                    <span class="tag">${escapeHtml(file.category)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(`${file.suites} suites • ${file.cases} cases • ${file.lastModifiedLabel}`)}</div>
                </button>`).join('') : '<div class="dashboard-empty">No test files were discovered.</div>'}
            </div>
          </article>
        </div>

        ${renderMethodologyStrategy(testing)}
      </section>
    `;
  }

  const METHODOLOGY_DEFS = [
    { id: 'tdd',              label: 'TDD',                     category: 'design-time' },
    { id: 'bdd',              label: 'BDD',                     category: 'design-time' },
    { id: 'atdd',             label: 'ATDD',                    category: 'design-time' },
    { id: 'sdd',              label: 'Spec-Driven (SDD)',        category: 'design-time' },
    { id: 'v-model',          label: 'V-Model',                 category: 'design-time' },
    { id: 'unit',             label: 'Unit Testing',            category: 'structural' },
    { id: 'integration',      label: 'Integration',             category: 'structural' },
    { id: 'mutation',         label: 'Mutation Testing',        category: 'structural' },
    { id: 'property',         label: 'Property-Based',          category: 'structural' },
    { id: 'continuous',       label: 'Continuous / Shift-Left', category: 'structural' },
    { id: 'white-box',        label: 'White-Box',               category: 'structural' },
    { id: 'e2e',              label: 'End-to-End',              category: 'behavioral' },
    { id: 'snapshot',         label: 'Snapshot',                category: 'behavioral' },
    { id: 'contract',         label: 'Contract',                category: 'behavioral' },
    { id: 'mbt',              label: 'Model-Based (MBT)',        category: 'behavioral' },
    { id: 'test-design',      label: 'Test Design Techniques',  category: 'behavioral' },
    { id: 'black-box',        label: 'Black-Box',               category: 'behavioral' },
    { id: 'gray-box',         label: 'Gray-Box',                category: 'behavioral' },
    { id: 'performance',      label: 'Performance',             category: 'non-functional' },
    { id: 'security-testing', label: 'Security',                category: 'non-functional' },
    { id: 'visual',           label: 'Visual Regression',       category: 'non-functional' },
    { id: 'exploratory',      label: 'Exploratory',             category: 'exploratory' },
    { id: 'agile-testing',    label: 'Agile Testing',           category: 'exploratory' },
  ];

  const METHODOLOGY_CATEGORIES = [
    { key: 'design-time',    label: 'Design-time' },
    { key: 'structural',     label: 'Structural' },
    { key: 'behavioral',     label: 'Behavioral' },
    { key: 'non-functional', label: 'Non-functional' },
    { key: 'exploratory',    label: 'Exploratory' },
  ];

  function renderMethodologyStrategy(testing) {
    const config = testing.projectTestingConfig;
    const enabledIds = new Set(
      config ? config.methodologies.filter(m => m.enabled).map(m => m.id) : ['tdd', 'unit'],
    );
    const enabledCount = enabledIds.size;

    const categoryGroups = METHODOLOGY_CATEGORIES.map(cat => ({
      ...cat,
      items: METHODOLOGY_DEFS.filter(d => d.category === cat.key),
    }));

    const rows = categoryGroups.map(cat => `
      <tr>
        <td colspan="2" class="methodology-category-header">${escapeHtml(cat.label)}</td>
      </tr>
      ${cat.items.map(def => {
        const isEnabled = enabledIds.has(def.id);
        return `<tr>
          <td class="methodology-name-cell">
            <label class="methodology-toggle-label">
              <input type="checkbox" class="dashboard-methodology-cb" data-methodology-id="${escapeAttr(def.id)}" ${isEnabled ? 'checked' : ''} />
              ${escapeHtml(def.label)}
            </label>
          </td>
          <td><span class="tag ${isEnabled ? 'tag-good' : ''}">${isEnabled ? 'Active' : 'Off'}</span></td>
        </tr>`;
      }).join('')}
    `).join('');

    return `
      <article class="panel-card" style="margin-top:16px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <p class="section-kicker">Methodology configuration</p>
            <h3>Testing Strategy</h3>
          </div>
          <span class="tag tag-good">${escapeHtml(String(enabledCount))} / 14 active</span>
        </div>
        <div class="stat-detail" style="margin-bottom:12px">Toggle methodologies to enable or disable them. Changes are saved immediately to <code>project_memory/index/testing-config.json</code>. Use <strong>Open Testing Strategy</strong> for agent assignments, model overrides, and detailed notes.</div>
        <table class="methodology-dashboard-table">
          <tbody>
            ${rows}
          </tbody>
        </table>
        <div class="tag-row" style="margin-top:14px">
          <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsTesting">Open Testing Strategy →</button>
        </div>
      </article>
    `;
  }

  function getFilteredTests(testing) {
    const search = String(state.testSearch || '').trim().toLowerCase();
    const category = state.activeTestCategory || 'all';
    return (testing.tests || []).filter(test => {
      if (category !== 'all' && test.category !== category) {
        return false;
      }
      if (!search) {
        return true;
      }
      return [test.title, test.suiteTitle, test.relativePath, test.description].some(value => String(value || '').toLowerCase().includes(search));
    });
  }

  function getSelectedTest(testing, filteredTests) {
    const availableTests = filteredTests.length > 0 ? filteredTests : (testing.tests || []);
    if (availableTests.length === 0) {
      state.selectedTestId = '';
      return undefined;
    }
    let selected = availableTests.find(test => test.id === state.selectedTestId);
    if (!selected) {
      selected = availableTests[0];
      state.selectedTestId = selected.id;
    }
    return selected;
  }

  function renderDeltaRow(area) {
    const icons = { ok: '✓', stale: '△', missing: '✕', unknown: '–' };
    const icon = icons[area.status] ?? '–';
    return `
      <div class="delta-row delta-row--${escapeHtml(area.status)}">
        <span class="delta-icon">${icon}</span>
        <div class="delta-body">
          <strong>${escapeHtml(area.label)}</strong>
          <span class="delta-detail">${escapeHtml(area.detail)}</span>
        </div>
        ${area.delta > 0 ? `<span class="delta-badge">${escapeHtml(String(area.delta))}</span>` : ''}
      </div>
    `;
  }

  function renderSsot(snapshot) {
    const delta = snapshot.ssot.delta;
    const totalDelta = delta ? delta.totalDelta : 0;
    const deltaStatusLabel = totalDelta === 0 ? 'In sync' : `${totalDelta} item${totalDelta === 1 ? '' : 's'} need attention`;
    const deltaCardClass = totalDelta === 0 ? 'good' : 'warn';
    return `
      <section class="page-section ${state.activePage === 'ssot' ? 'active' : ''}">
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">SSOT shape</p>
            <h3>${escapeHtml(snapshot.ssot.path)}</h3>
            <div class="mini-grid">
              ${renderMetricPill('Indexed entries', String(snapshot.ssot.totalEntries))}
              ${renderMetricPill('Disk files', String(snapshot.ssot.totalFilesOnDisk))}
              ${renderMetricPill('Coverage', `${snapshot.ssot.coveragePercent}%`)}
              ${renderMetricPill('Warned entries', String(snapshot.ssot.warnedEntries))}
              ${renderMetricPill('Blocked entries', String(snapshot.ssot.blockedEntries))}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(snapshot.ssot.recentFiles[0] ? snapshot.ssot.recentFiles[0].path : `${snapshot.ssot.path}/project_soul.md`)}">Open recent SSOT file</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Coverage</p>
            <h3>Directory footprint</h3>
            <div class="coverage-list">
              ${snapshot.ssot.coverage.map(entry => renderCoverageRow(entry, snapshot.ssot.totalFilesOnDisk)).join('')}
            </div>
          </article>
        </div>
        <article class="panel-card">
          <p class="section-kicker">Project-to-SSOT delta</p>
          <div class="delta-header">
            <h3>Sync status</h3>
            <span class="delta-summary-badge ${deltaCardClass}">${escapeHtml(deltaStatusLabel)}</span>
          </div>
          <div class="delta-list">
            ${delta && delta.areas ? delta.areas.map(area => renderDeltaRow(area)).join('') : '<div class="dashboard-empty">Delta analysis unavailable.</div>'}
          </div>
          <div class="tag-row">
            <button type="button" class="action-link" data-action="command" data-payload="atlasmind.updateProjectMemory">Sync SSOT now</button>
          </div>
        </article>
        <article class="list-card">
          <p class="section-kicker">Recent SSOT changes</p>
          <h3>Most recently touched files</h3>
          <div class="stack-list">
            ${snapshot.ssot.recentFiles.length > 0 ? snapshot.ssot.recentFiles.map(file => `
              <button type="button" class="recent-item" data-action="file" data-payload="${escapeAttr(file.path)}">
                <div class="row-head">
                  <strong>${escapeHtml(file.path)}</strong>
                  <span class="list-meta">${escapeHtml(file.lastModifiedRelative)}</span>
                </div>
              </button>`).join('') : '<div class="dashboard-empty">No SSOT files found on disk.</div>'}
          </div>
        </article>
      </section>
    `;
  }

  function renderRoadmap(snapshot) {
    const roadmap = snapshot.roadmap || { items: [], nextSuggestedWork: [], completedCount: 0, outstandingCount: 0, filePath: 'project_memory/roadmap/improvement-plan.md' };
    return `
      <section class="page-section ${state.activePage === 'roadmap' ? 'active' : ''}">
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Developer roadmap</p>
            <h3>Prioritized backlog</h3>
            <div class="mini-grid">
              ${renderMetricPill('Total items', String(roadmap.items.length))}
              ${renderMetricPill('Outstanding', String(roadmap.outstandingCount))}
              ${renderMetricPill('Completed', String(roadmap.completedCount))}
            </div>
            <div class="stat-detail">Reorder items to influence Atlas’s default next-work weighting. Security, architecture, and delivery risk are still factored in before execution.</div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="roadmap-add" data-payload="new">Add item</button>
              <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(roadmap.filePath)}">Open roadmap file</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Atlas weighting</p>
            <h3>Recommended next work</h3>
            <div class="stack-list">
              ${roadmap.nextSuggestedWork.length > 0 ? roadmap.nextSuggestedWork.map((item, index) => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(`${index + 1}. ${item.text}`)}</strong>
                    <span class="tag">${escapeHtml(item.focus)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(item.priorityReason)}</div>
                </div>`).join('') : '<div class="dashboard-empty">No roadmap items yet. Add the first backlog item to start guiding Atlas.</div>'}
            </div>
          </article>
        </div>
        <article class="list-card">
          <p class="section-kicker">Editable queue</p>
          <h3>Drag to reorder, then edit or delete individual items</h3>
          <div class="stack-list roadmap-list">
            ${state.editingRoadmapId === 'new' ? renderRoadmapEditor('new') : ''}
            ${roadmap.items.length > 0 ? roadmap.items.map(item => renderRoadmapItem(item)).join('') : '<div class="dashboard-empty">No roadmap items yet. Add the first one above.</div>'}
          </div>
        </article>
      </section>
    `;
  }

  function renderRoadmapItem(item) {
    if (state.editingRoadmapId === item.id) {
      return renderRoadmapEditor(item.id);
    }
    return `
      <div class="recent-item roadmap-item" draggable="true" data-roadmap-id="${escapeAttr(item.id)}">
        <div class="row-head">
          <strong>${escapeHtml(item.text)}</strong>
          <span class="tag ${item.completed ? 'tag-good' : item.focus === 'security' ? 'tag-critical' : item.focus === 'architecture' ? 'tag-warn' : ''}">${escapeHtml(item.completed ? 'done' : item.focus)}</span>
        </div>
        <div class="list-meta">${escapeHtml(item.priorityReason)}</div>
        <div class="tag-row">
          <button type="button" class="action-link" data-action="roadmap-toggle" data-payload="${escapeAttr(item.id)}">${item.completed ? 'Mark active' : 'Mark done'}</button>
          <button type="button" class="action-link" data-action="roadmap-edit" data-payload="${escapeAttr(item.id)}">Edit</button>
          <button type="button" class="action-link" data-action="roadmap-delete" data-payload="${escapeAttr(item.id)}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderRoadmapEditor(itemId) {
    const draft = state.editingRoadmapId === 'new'
      ? state.roadmapDraftText
      : state.roadmapDraftText || (getRoadmapItems().find(item => item.id === itemId)?.text ?? '');
    return `
      <div class="panel-card roadmap-editor">
        <p class="section-kicker">${escapeHtml(state.editingRoadmapId === 'new' ? 'Add roadmap item' : 'Edit roadmap item')}</p>
        <textarea class="roadmap-textarea" data-roadmap-draft="true" rows="3" placeholder="Describe the next backlog item...">${escapeHtml(draft)}</textarea>
        <div class="tag-row">
          <button type="button" class="action-link" data-action="roadmap-save" data-payload="${escapeAttr(itemId)}">Save</button>
          <button type="button" class="action-link" data-action="roadmap-cancel" data-payload="${escapeAttr(itemId)}">Cancel</button>
        </div>
      </div>
    `;
  }

  function getRoadmapItems() {
    return Array.isArray(state.snapshot?.roadmap?.items) ? state.snapshot.roadmap.items : [];
  }

  function saveRoadmapDraft() {
    const text = (state.roadmapDraftText || '').trim();
    if (!text) {
      return;
    }

    const items = getRoadmapItems().map(item => ({ id: item.id, text: item.text, completed: !!item.completed }));
    if (state.editingRoadmapId === 'new') {
      items.unshift({ id: createRoadmapItemId(text), text, completed: false });
    } else {
      const target = items.find(item => item.id === state.editingRoadmapId);
      if (target) {
        target.text = text;
      }
    }

    state.editingRoadmapId = '';
    state.roadmapDraftText = '';
    persistRoadmapItems(items);
  }

  function persistRoadmapItems(items) {
    vscode.postMessage({
      type: 'saveRoadmap',
      payload: {
        items: items.map((item, index) => ({
          id: item.id || `roadmap-${index + 1}`,
          text: item.text,
          completed: !!item.completed,
        })),
      },
    });
  }

  function moveRoadmapItem(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    const items = getRoadmapItems().map(item => ({ id: item.id, text: item.text, completed: !!item.completed }));
    const fromIndex = items.findIndex(item => item.id === sourceId);
    const toIndex = items.findIndex(item => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    persistRoadmapItems(items);
  }

  function createRoadmapItemId(text) {
    const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `roadmap-${normalized || Date.now()}`;
  }

  function renderSecurity(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'security' ? 'active' : ''}">
        <div class="security-grid">
          <article class="panel-card">
            <p class="section-kicker">Execution policy</p>
            <h3>Write guardrails</h3>
            <div class="mini-grid">
              ${renderMetricPill('Approval mode', snapshot.security.toolApprovalMode)}
              ${renderMetricPill('Terminal writes', snapshot.security.allowTerminalWrite ? 'Allowed' : 'Blocked')}
              ${renderMetricPill('Auto verify', snapshot.security.autoVerifyAfterWrite ? 'Enabled' : 'Disabled')}
              ${renderMetricPill('Verification commands', snapshot.security.autoVerifyScripts)}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsSafety">Safety settings</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openToolWebhooks">Tool webhooks</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Repository controls</p>
            <h3>Governance assets</h3>
            <div class="signal-grid">
              ${renderSignalCard('SECURITY.md', snapshot.security.securityPolicyPresent, snapshot.security.securityPolicyPresent ? 'Security policy present.' : 'Repository security policy missing.')}
              ${renderSignalCard('CODEOWNERS', snapshot.security.codeownersPresent, snapshot.security.codeownersPresent ? 'Ownership rules configured.' : 'CODEOWNERS missing.')}
              ${renderSignalCard('PR template', snapshot.security.prTemplatePresent, snapshot.security.prTemplatePresent ? 'Pull request checklist detected.' : 'No PR template found.')}
              ${renderSignalCard('Issue templates', snapshot.security.issueTemplateCount > 0, `${snapshot.security.issueTemplateCount} issue template file(s) detected.`)}
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Governance providers</p>
            <h3>Dependency monitoring</h3>
            <div class="tag-row">
              ${snapshot.security.governanceProviders.length > 0 ? snapshot.security.governanceProviders.map(provider => `<span class="governance-pill">${escapeHtml(provider)}</span>`).join('') : '<span class="governance-pill">None detected</span>'}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="file" data-payload="SECURITY.md">Open security policy</button>
              <button type="button" class="action-link" data-action="file" data-payload=".github/CODEOWNERS">Open CODEOWNERS</button>
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function privacyConfigFromSnapshot(p) {
    return {
      version: 1,
      enabled: !!p.enabled,
      rules: Array.isArray(p.rules) ? p.rules : [],
      compliancePacks: Array.isArray(p.compliancePacks) ? p.compliancePacks : [],
      trustedModelIds: Array.isArray(p.trustedModelIds) ? p.trustedModelIds : [],
      updatedAt: new Date().toISOString(),
    };
  }

  function savePrivacy(config) {
    if (state.snapshot && state.snapshot.privacy) {
      // Optimistically update so the UI stays consistent before the round-trip.
      state.snapshot.privacy.enabled = config.enabled;
      state.snapshot.privacy.rules = config.rules;
      state.snapshot.privacy.compliancePacks = config.compliancePacks;
      state.snapshot.privacy.trustedModelIds = config.trustedModelIds;
    }
    render();
    vscode.postMessage({ type: 'saveDataPrivacyConfig', payload: config });
  }

  function privacyProviderExpanded(provider) {
    const override = state.privacyExpandedProviders[provider.id];
    if (typeof override === 'boolean') { return override; }
    // Default: expand providers that already have a trusted model.
    return provider.trustedCount > 0;
  }

  function privacyProviderExpandedById(id) {
    const override = state.privacyExpandedProviders[id];
    if (typeof override === 'boolean') { return override; }
    const providers = state.snapshot && state.snapshot.privacy ? state.snapshot.privacy.providers : null;
    const provider = providers ? providers.find(p => p.id === id) : null;
    return provider ? provider.trustedCount > 0 : false;
  }

  function renderPrivacyProviderTree(providers) {
    if (!providers || providers.length === 0) {
      return '<p class="section-copy">No active models available. Enable a model in the Models view first.</p>';
    }
    return providers.map(provider => {
      const expanded = privacyProviderExpanded(provider);
      const allTrusted = provider.models.length > 0 && provider.trustedCount === provider.models.length;
      const someTrusted = provider.trustedCount > 0 && !allTrusted;
      return `
        <div class="privacy-tree-provider ${provider.trustedCount > 0 ? 'has-trusted' : ''}">
          <div class="privacy-tree-head">
            <button type="button" class="privacy-tree-twisty" data-action="privacy-provider-expand" data-payload="${escapeAttr(provider.id)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▾' : '▸'}</button>
            <label class="privacy-tree-provider-label" title="Trust all models from this provider">
              <input type="checkbox" data-privacy-provider="${escapeAttr(provider.id)}" ${allTrusted ? 'checked' : ''} ${someTrusted ? 'data-indeterminate="true"' : ''} ${provider.id === '__unavailable__' ? 'disabled' : ''} />
              <span class="privacy-tree-provider-name">${escapeHtml(provider.name)}</span>
            </label>
            <span class="privacy-tree-count">${provider.trustedCount}/${provider.models.length} trusted</span>
          </div>
          ${expanded ? `
            <div class="privacy-tree-models">
              ${provider.models.map(model => `
                <label class="privacy-tree-model ${model.trusted ? 'on' : ''}">
                  <input type="checkbox" data-privacy-model="${escapeAttr(model.id)}" ${model.trusted ? 'checked' : ''} />
                  <span class="privacy-tree-model-name">${escapeHtml(model.name)}</span>
                  ${model.active ? '' : '<span class="tag">inactive</span>'}
                </label>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function renderPrivacyActivity(activity) {
    if (!activity || activity.total === 0) {
      return '<p class="section-copy">No classification activity recorded yet. As confidential or regulated content is detected during tasks, catches will be charted here.</p>';
    }
    const maxSource = Math.max(1, ...activity.bySource.map(s => s.count));
    return `
      <div class="mini-grid">
        ${renderMetricPill('Total catches', String(activity.total))}
        ${renderMetricPill('Redacted (un-trusted)', String(activity.redactedCount))}
        ${renderMetricPill('Distinct detectors', String(activity.bySource.length))}
      </div>
      ${renderChartCard('privacy-catches', 'Catches over time', 'Daily count of rule/standard matches in task context.', activity.byDay)}
      <div class="privacy-source-bars">
        ${activity.bySource.map(source => {
          const width = Math.max(6, Math.round((source.count / maxSource) * 100));
          return `
            <div class="coverage-row">
              <div class="row-head">
                <strong>${escapeHtml(source.label)}</strong>
                <span class="list-meta">${source.count} · ${escapeHtml(source.sensitivity)}</span>
              </div>
              <div class="coverage-bar"><span style="width: ${width}%"></span></div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderPrivacyGovernance(governance) {
    if (!governance || governance.length === 0) {
      return '<p class="section-copy">Trust a model above to see its provider\'s data-management controls (GDPR / data-subject requests, retention, and DPAs) here.</p>';
    }
    return governance.map(node => {
      const trains = node.trainsOnDataByDefault === true ? 'Trains on data by default'
        : node.trainsOnDataByDefault === false ? 'No training on data by default'
        : 'Training policy: verify';
      const trainsClass = node.trainsOnDataByDefault === true ? 'warn' : node.trainsOnDataByDefault === false ? 'good' : '';
      return `
        <div class="privacy-governance">
          <div class="row-head">
            <strong>${escapeHtml(node.providerName)}</strong>
            <span class="tag ${trainsClass === 'warn' ? 'tag-critical' : trainsClass === 'good' ? 'tag-good' : ''}">${escapeHtml(trains)}</span>
          </div>
          <p class="section-copy">${escapeHtml(node.retentionSummary)}</p>
          ${node.notes ? `<p class="list-meta">${escapeHtml(node.notes)}</p>` : ''}
          <div class="tag-row">
            ${node.dataSubjectRequestUrl ? `<button type="button" class="action-link privacy-dsr" data-action="privacy-open-url" data-payload="${escapeAttr(node.dataSubjectRequestUrl)}">Submit a data-subject request</button>` : ''}
            ${node.dataRequestUrl && node.dataRequestUrl !== node.dataSubjectRequestUrl ? `<button type="button" class="action-link" data-action="privacy-open-url" data-payload="${escapeAttr(node.dataRequestUrl)}">Privacy contact</button>` : ''}
            ${node.privacyPolicyUrl ? `<button type="button" class="action-link" data-action="privacy-open-url" data-payload="${escapeAttr(node.privacyPolicyUrl)}">Privacy policy</button>` : ''}
            ${node.dpaUrl ? `<button type="button" class="action-link" data-action="privacy-open-url" data-payload="${escapeAttr(node.dpaUrl)}">DPA</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPrivacy(snapshot) {
    const privacy = snapshot.privacy || { enabled: false, rules: [], compliancePacks: [], trustedModelIds: [], providers: [], packs: [], activity: { total: 0, redactedCount: 0, bySource: [], byDay: [] }, governance: [] };
    const trusted = privacy.trustedModelIds || [];
    const draft = state.privacyDraftRule;
    const testResult = state.privacyTestResult;
    const sensitivityOptions = ['confidential', 'proprietary', 'secret'];
    return `
      <section class="page-section ${state.activePage === 'privacy' ? 'active' : ''}">
        <div class="security-grid">
          <article class="panel-card">
            <p class="section-kicker">Data Privacy policy</p>
            <h3>Confidential &amp; regulated data</h3>
            <p class="section-copy">Mark language, terms, files, and folders as proprietary or confidential. Classified content is only ever sent to the trusted models you select below — every other model receives a redacted <code>[CONFIDENTIAL]</code> placeholder. These detectors are heuristic aids, not a compliance certification.</p>
            <label class="privacy-toggle">
              <input type="checkbox" data-privacy-enable ${privacy.enabled ? 'checked' : ''} />
              <span>Enable Data Privacy enforcement</span>
            </label>
            ${privacy.enabled && trusted.length === 0 ? '<p class="privacy-warn">No trusted model is selected yet — while enabled, classified content will be redacted for every model until you trust at least one.</p>' : ''}
          </article>

          <article class="panel-card">
            <p class="section-kicker">Compliance standards</p>
            <h3>Regulated-data packs</h3>
            <p class="section-copy">Enabling a pack adds curated detectors for that standard's data points (e.g. emails, card numbers, health terms). Matches are gated to trusted models exactly like custom rules.</p>
            <div class="signal-grid">
              ${(privacy.packs || []).map(pack => `
                <label class="privacy-pack ${privacy.compliancePacks.includes(pack.id) ? 'on' : ''}">
                  <input type="checkbox" data-privacy-pack="${escapeAttr(pack.id)}" ${privacy.compliancePacks.includes(pack.id) ? 'checked' : ''} />
                  <span class="privacy-pack-label">${escapeHtml(pack.label)}</span>
                  <span class="privacy-pack-desc">${escapeHtml(pack.description)}</span>
                  <span class="tag">${pack.detectorCount} detector(s)</span>
                </label>
              `).join('')}
            </div>
          </article>

          <article class="panel-card">
            <p class="section-kicker">Trusted models</p>
            <h3>Who may receive confidential data</h3>
            <p class="section-copy">Grouped by connected provider; only currently-active models are listed. Local models are the natural choice for confidential work. Toggle a provider to trust all of its models, or expand to pick individual ones.</p>
            <div class="privacy-tree" data-scroll-key="privacy-tree">
              ${renderPrivacyProviderTree(privacy.providers)}
            </div>
          </article>

          <article class="panel-card privacy-span">
            <p class="section-kicker">Classification activity</p>
            <h3>What is being caught</h3>
            ${renderPrivacyActivity(privacy.activity)}
          </article>

          <article class="panel-card">
            <p class="section-kicker">Provider data management</p>
            <h3>GDPR &amp; data-subject controls</h3>
            <p class="section-copy">For the providers hosting your trusted models. Links go to each provider's own privacy controls; AtlasMind does not submit requests on your behalf.</p>
            ${renderPrivacyGovernance(privacy.governance)}
          </article>

          <article class="panel-card">
            <p class="section-kicker">Custom rules</p>
            <h3>Terms, patterns &amp; paths</h3>
            <div class="privacy-rule-form">
              <select id="privacy-rule-kind">
                <option value="term" ${draft.kind === 'term' ? 'selected' : ''}>Term</option>
                <option value="regex" ${draft.kind === 'regex' ? 'selected' : ''}>Regex</option>
                <option value="path" ${draft.kind === 'path' ? 'selected' : ''}>File/Folder glob</option>
              </select>
              <input type="text" id="privacy-rule-value" placeholder="${draft.kind === 'path' ? 'e.g. secrets/** or **/*.key' : draft.kind === 'regex' ? 'e.g. ACME-\\d{4}' : 'e.g. Project Codename'}" value="${escapeAttr(draft.value)}" />
              <select id="privacy-rule-sensitivity">
                ${sensitivityOptions.map(s => `<option value="${s}" ${draft.sensitivity === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
              <button type="button" class="action-link" data-action="privacy-add-rule">Add rule</button>
            </div>
            <div class="privacy-rules">
              ${(privacy.rules || []).length > 0 ? privacy.rules.map(rule => `
                <div class="privacy-rule-row">
                  <input type="checkbox" data-privacy-rule-toggle="${escapeAttr(rule.id)}" ${rule.enabled ? 'checked' : ''} title="Enable / disable" />
                  <span class="tag mono">${escapeHtml(rule.kind)}</span>
                  <span class="privacy-rule-value mono">${escapeHtml(rule.value)}</span>
                  <span class="tag">${escapeHtml(rule.sensitivity)}</span>
                  <button type="button" class="action-link" data-action="privacy-remove-rule" data-payload="${escapeAttr(rule.id)}">Remove</button>
                </div>
              `).join('') : '<p class="section-copy">No custom rules yet.</p>'}
            </div>
          </article>

          <article class="panel-card">
            <p class="section-kicker">Test coverage</p>
            <h3>Preview classification</h3>
            <p class="section-copy">Check whether a snippet of text or a file path would be classified by the current policy (packs + rules).</p>
            <div class="privacy-rule-form">
              <select id="privacy-test-kind">
                <option value="text" ${state.privacyTest.kind === 'text' ? 'selected' : ''}>Text</option>
                <option value="path" ${state.privacyTest.kind === 'path' ? 'selected' : ''}>Path</option>
              </select>
              <input type="text" id="privacy-test-value" placeholder="${state.privacyTest.kind === 'path' ? 'src/secrets/key.pem' : 'paste text to test'}" value="${escapeAttr(state.privacyTest.value)}" />
              <button type="button" class="action-link" data-action="privacy-test">Test</button>
            </div>
            ${testResult ? `<p class="${testResult.ok ? 'privacy-test-hit' : 'privacy-test-clear'}">${escapeHtml(testResult.summary)}${testResult.labels && testResult.labels.length ? ' — ' + escapeHtml(testResult.labels.join(', ')) : ''}</p>` : ''}
          </article>
        </div>
      </section>
    `;
  }

  function renderStagePipeline(snapshot) {
    const pipeline = snapshot.delivery && snapshot.delivery.stages;
    if (!pipeline) { return ''; }
    if (pipeline.notInGitRepo) {
      return `
        <article class="list-card" style="grid-column: 1 / -1">
          <p class="section-kicker">Stages &amp; Promotion</p>
          <h3>Deployment pipeline</h3>
          <div class="dashboard-empty">Initialise a git repository to model development, staging, and production stages.</div>
        </article>`;
    }
    if (!pipeline.stages || pipeline.stages.length === 0) {
      return '';
    }
    const summaryPath = pipeline.summaryPath;
    const stageEditor = state.editingStageId
      ? (state.editingStageId === 'new' ? renderStageEditor(defaultNewStage(), true) : renderStageEditor(findRawStage(state.editingStageId), false))
      : '';
    let pathEditor = '';
    if (state.editingPathId === 'new') {
      pathEditor = renderPathEditor(null, true);
    } else if (state.editingPathId) {
      const rawPath = findRawPath(state.editingPathId);
      pathEditor = rawPath ? renderPathEditor(rawPath, false) : '';
    }
    return `
      <article class="list-card" style="grid-column: 1 / -1">
        <div class="stage-pipeline-header">
          <div>
            <p class="section-kicker">Stages &amp; Promotion</p>
            <h3>Deployment pipeline</h3>
            ${pipeline.seeded ? '<p class="stage-seeded-note">Seeded from your branches on first open — everything here is editable.</p>' : ''}
          </div>
          <div class="tag-row">
            ${state.editingStageId === 'new' ? '' : '<button type="button" class="action-link" data-action="stage-add" data-payload="">+ Add stage</button>'}
            <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(summaryPath)}">📖 Open runbook (delivery.md)</button>
            <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(pipeline.configPath)}">Edit delivery.json</button>
          </div>
        </div>
        ${renderDeliveryReviewBanner(pipeline.review)}
        <div class="stage-row">
          ${pipeline.stages.map(renderStageCard).join('')}
        </div>
        ${stageEditor}
        <div class="promotion-section-head">
          <p class="section-kicker" style="margin-top:6px">Promotions (“pushes”)</p>
          ${state.editingPathId === 'new' ? '' : '<button type="button" class="action-link" data-action="path-add" data-payload="">+ Add push</button>'}
        </div>
        ${pipeline.paths && pipeline.paths.length > 0
          ? `<div class="promotion-list">${pipeline.paths.map(p => renderPromotionCard(p, summaryPath)).join('')}</div>`
          : '<div class="dashboard-empty">No promotion paths yet. Use “+ Add push” to connect two stages.</div>'}
        ${pathEditor}
      </article>`;
  }

  function renderDeliveryReviewBanner(review) {
    if (!review) { return ''; }
    if (review.needsReview) {
      return `
        <div class="delivery-review-banner warn">
          <div class="delivery-review-body">
            <strong>⟳ Review needed — the delivery setup changed since your last review</strong>
            <ul>${(review.reasons || []).map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          </div>
          <button type="button" class="action-link primary" data-action="delivery-mark-reviewed" data-payload="">Mark reviewed</button>
        </div>`;
    }
    if (review.reviewedAt) {
      return `<div class="delivery-review-banner ok"><span>✓ Delivery setup reviewed ${escapeHtml(review.reviewedRelative || '')}</span></div>`;
    }
    return '';
  }

  function renderStageCard(stage) {
    const branchText = stage.branchRef
      ? `<b class="${stage.branchExists ? '' : 'missing-ref'}">${escapeHtml(stage.branchRef)}${stage.branchExists ? '' : ' (missing)'}</b>`
      : '<b>— working tree</b>';
    const facts = [
      ['Branch', branchText],
      ['Deployed', `<b>v${escapeHtml(stage.deployedVersion)}</b>`],
      ['Hosting', `<b>${escapeHtml(stage.hostingProvider || '—')}</b>`],
      ['Data', `<b>${escapeHtml(stage.dataLabel || '—')}</b>`],
      ['Config', `<b>${escapeHtml(stage.configLabel || '—')}</b>`],
    ];
    const urlButton = /^https:\/\//i.test(stage.hostingUrl || '')
      ? `<button type="button" class="action-link" data-action="external-url" data-payload="${escapeAttr(stage.hostingUrl)}">Open ${escapeHtml(stage.name)} ↗</button>`
      : '';
    return `
      <article class="stage-card kind-${escapeAttr(stage.kind)} ${stage.isCurrentBranch ? 'is-current' : ''}">
        <div class="stage-head">
          <span class="stage-rank">${stage.rank + 1}</span>
          <h4>${escapeHtml(stage.name)}</h4>
          <span class="stage-kind-badge">${escapeHtml(stage.kind)}</span>
          ${stage.isProtected ? '<span class="stage-lock" title="Protected stage">🔒</span>' : ''}
        </div>
        ${stage.isCurrentBranch ? '<span class="stage-current-tag">● current branch</span>' : ''}
        <p class="stage-desc">${escapeHtml(stage.description)}</p>
        <div class="stage-facts">
          ${facts.map(fact => `<div class="stage-fact"><span>${escapeHtml(fact[0])}</span>${fact[1]}</div>`).join('')}
        </div>
        ${urlButton}
        ${stage.securityNotes && stage.securityNotes.length > 0 ? `
          <ul class="stage-security">
            ${stage.securityNotes.map(note => `<li class="${/blocked until you add one/i.test(note) ? 'warn' : ''}">${escapeHtml(note)}</li>`).join('')}
          </ul>` : ''}
        <div class="stage-card-foot">
          <button type="button" class="action-link" data-action="stage-edit" data-payload="${escapeAttr(stage.id)}">Edit</button>
        </div>
      </article>`;
  }

  function renderPromotionCard(path, summaryPath) {
    const gates = (path.gates || []).length > 0
      ? path.gates.map(g => `<span class="tag mono">${escapeHtml(g)}</span>`).join('')
      : '<span class="tag">none configured</span>';
    const last = path.lastPromotion
      ? `<p class="promotion-last">Last push: v${escapeHtml(path.lastPromotion.version || '?')} · ${path.lastPromotion.succeeded ? 'succeeded' : 'failed'} · ${escapeHtml(relativeLabel(path.lastPromotion.ranAt))}</p>`
      : '';
    return `
      <article class="promotion-card ${path.blocked ? 'blocked' : ''}">
        <div class="promotion-head">
          <h4>${escapeHtml(path.fromName)} → ${escapeHtml(path.toName)}</h4>
          ${path.versionDelta ? `<span class="version-delta">${escapeHtml(path.versionDelta)}</span>` : ''}
        </div>
        <ol class="guardrail-list">
          ${path.guardrails.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>
        <div class="gate-row"><span>Gates:</span> ${gates}</div>
        ${path.blocked ? `<p class="promotion-block-note">⚠ ${escapeHtml(path.blockReason)}</p>` : ''}
        <div class="promotion-actions">
          ${path.blocked
            ? `<button type="button" class="promotion-ghost-btn" disabled title="${escapeAttr(path.blockReason)}">Promote ▸ (blocked)</button>`
            : `<button type="button" class="action-link primary" data-action="promote-plan" data-payload="${escapeAttr(path.id)}">Promote ▸</button>`}
          <button type="button" class="action-link" data-action="promote-runbook" data-payload="${escapeAttr(path.id)}">📖 Runbook</button>
          <button type="button" class="action-link" data-action="path-edit" data-payload="${escapeAttr(path.id)}">Edit</button>
        </div>
        ${last}
      </article>`;
  }

  // ── Delivery: stage / promotion editors (Phase 2) ───────────────

  function getDeliveryConfig() {
    const sp = state.snapshot && state.snapshot.delivery && state.snapshot.delivery.stages;
    return sp && sp.config ? sp.config : null;
  }

  function cloneDeliveryConfig() {
    const cfg = getDeliveryConfig();
    return cfg ? JSON.parse(JSON.stringify(cfg)) : { version: 1, stages: [], paths: [] };
  }

  function postDeliveryConfig(cfg) {
    vscode.postMessage({ type: 'saveDeliveryConfig', payload: cfg });
  }

  function findRawStage(id) {
    const cfg = getDeliveryConfig();
    return (cfg && cfg.stages.find(s => s.id === id)) || defaultNewStage();
  }

  function findRawPath(id) {
    const cfg = getDeliveryConfig();
    return (cfg && cfg.paths.find(p => p.id === id)) || null;
  }

  function slugClient(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || String(Date.now());
  }

  function defaultNewStage() {
    const cfg = getDeliveryConfig();
    const maxRank = cfg && cfg.stages.length ? Math.max.apply(null, cfg.stages.map(s => s.rank)) : -1;
    return {
      id: '', name: '', kind: 'custom', rank: maxRank + 1, description: '', branchRef: '',
      config: { sourceLabel: '', sourcePath: '' },
      hosting: { provider: '', url: '', healthCheckUrl: '' },
      data: { kind: '', label: '', migrationsPath: '' },
      backupPolicy: { required: false, command: '', runbookRef: '', retention: '' },
      promotionPolicy: { requiresApproval: false, requireVersionBump: false, requireChangelog: false, requiredChecks: [] },
      rollbackPolicy: { command: '', runbookRef: '' },
      isProtected: false,
    };
  }

  function edText(label, field, value, ph) {
    return `<label class="stage-edit-field"><span>${escapeHtml(label)}</span><input type="text" data-field="${escapeAttr(field)}" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(ph || '')}" /></label>`;
  }
  function edNum(label, field, value) {
    return `<label class="stage-edit-field"><span>${escapeHtml(label)}</span><input type="number" min="0" max="99" data-field="${escapeAttr(field)}" value="${escapeAttr(value == null ? '' : String(value))}" /></label>`;
  }
  function edArea(label, field, value, ph) {
    return `<label class="stage-edit-field"><span>${escapeHtml(label)}</span><textarea rows="2" data-field="${escapeAttr(field)}" placeholder="${escapeAttr(ph || '')}">${escapeHtml(value || '')}</textarea></label>`;
  }
  function edCheck(label, field, checked) {
    return `<label class="stage-edit-check"><input type="checkbox" data-field="${escapeAttr(field)}" ${checked ? 'checked' : ''} /> <span>${escapeHtml(label)}</span></label>`;
  }
  function edSelect(label, field, value, options) {
    return `<label class="stage-edit-field"><span>${escapeHtml(label)}</span><select data-field="${escapeAttr(field)}">${options.map(o => `<option value="${escapeAttr(o.value)}" ${o.value === value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
  }

  function renderStageEditor(stage, isNew) {
    const kinds = ['local', 'development', 'staging', 'production', 'preview', 'custom'].map(k => ({ value: k, label: k }));
    const checks = ((stage.promotionPolicy && stage.promotionPolicy.requiredChecks) || []).join('\n');
    const removeControl = !isNew
      ? (state.confirmRemoveStageId === stage.id
        ? `<span class="stage-remove-confirm">Remove “${escapeHtml(stage.name)}”? <button type="button" class="action-link danger" data-action="stage-remove-confirm" data-payload="${escapeAttr(stage.id)}">Yes, remove</button> <button type="button" class="action-link" data-action="stage-remove-cancel" data-payload="">No</button></span>`
        : `<button type="button" class="action-link danger" data-action="stage-remove" data-payload="${escapeAttr(stage.id)}">Remove stage</button>`)
      : '';
    return `
      <article class="stage-card stage-editor" id="stage-editor">
        <div class="stage-head"><h4>${isNew ? 'Add stage' : 'Edit stage'}</h4></div>
        <div class="stage-edit-grid">
          ${edText('Name', 'name', stage.name, 'Staging')}
          ${edSelect('Kind', 'kind', stage.kind, kinds)}
          ${edNum('Order (rank)', 'rank', stage.rank)}
          ${edText('Branch / tag', 'branchRef', stage.branchRef, 'develop')}
        </div>
        ${edArea('Description (plain English)', 'description', stage.description, 'What is this stage for?')}
        <p class="stage-edit-group">Config &amp; secrets <small>location only — never values</small></p>
        <div class="stage-edit-grid">
          ${edText('Config label', 'config.sourceLabel', stage.config.sourceLabel, '.env.staging')}
          ${edText('Config path', 'config.sourcePath', stage.config.sourcePath, '.env.staging')}
        </div>
        <p class="stage-edit-group">Hosting</p>
        <div class="stage-edit-grid">
          ${edText('Provider', 'hosting.provider', stage.hosting.provider, 'Vercel / AWS / Fly.io')}
          ${edText('URL', 'hosting.url', stage.hosting.url, 'https://staging.example.com')}
          ${edText('Health-check URL', 'hosting.healthCheckUrl', stage.hosting.healthCheckUrl, 'https://staging.example.com/health')}
        </div>
        <p class="stage-edit-group">Data</p>
        <div class="stage-edit-grid">
          ${edText('Type', 'data.kind', stage.data.kind, 'postgres / s3 / none')}
          ${edText('Label', 'data.label', stage.data.label, 'Staging database')}
          ${edText('Migrations path', 'data.migrationsPath', stage.data.migrationsPath, 'db/migrations')}
        </div>
        <p class="stage-edit-group">Backup &amp; recovery <small>runs before any push to this stage</small></p>
        ${edCheck('Backup required before any push to this stage', 'backupPolicy.required', stage.backupPolicy.required)}
        <div class="stage-edit-grid">
          ${edText('Backup command', 'backupPolicy.command', stage.backupPolicy.command, 'pg_dump … (taken before promote)')}
          ${edText('Backup runbook ref', 'backupPolicy.runbookRef', stage.backupPolicy.runbookRef, '')}
          ${edText('Retention', 'backupPolicy.retention', stage.backupPolicy.retention, '7 daily snapshots')}
        </div>
        <p class="stage-edit-group">Promotion gates <small>apply to pushes INTO this stage</small></p>
        ${edCheck('Require human approval before a push runs', 'promotionPolicy.requiresApproval', stage.promotionPolicy.requiresApproval)}
        ${edCheck('Require a version bump', 'promotionPolicy.requireVersionBump', stage.promotionPolicy.requireVersionBump)}
        ${edCheck('Require a changelog entry', 'promotionPolicy.requireChangelog', stage.promotionPolicy.requireChangelog)}
        ${edArea('Required checks (one per line)', 'promotionPolicy.requiredChecks', checks, 'Working tree clean\nTests pass\nCI green')}
        <p class="stage-edit-group">Rollback</p>
        <div class="stage-edit-grid">
          ${edText('Rollback command', 'rollbackPolicy.command', stage.rollbackPolicy.command, '')}
          ${edText('Rollback runbook ref', 'rollbackPolicy.runbookRef', stage.rollbackPolicy.runbookRef, '')}
        </div>
        ${edCheck('Protected stage — always confirm, never force-push', 'isProtected', stage.isProtected)}
        <div class="stage-edit-actions">
          <button type="button" class="action-link primary" data-action="stage-save" data-payload="${escapeAttr(isNew ? 'new' : stage.id)}">Save</button>
          <button type="button" class="action-link" data-action="stage-cancel" data-payload="">Cancel</button>
          ${removeControl}
        </div>
      </article>`;
  }

  function renderPathEditor(path, isNew) {
    const cfg = getDeliveryConfig();
    const stages = cfg ? cfg.stages.slice().sort((a, b) => a.rank - b.rank) : [];
    const opts = stages.map(s => ({ value: s.id, label: `${s.name} (${s.kind})` }));
    const from = path ? path.fromStageId : (opts[0] ? opts[0].value : '');
    const to = path ? path.toStageId : (opts[1] ? opts[1].value : (opts[0] ? opts[0].value : ''));
    const routineId = path ? (path.routineId || '') : '';
    return `
      <article class="promotion-card path-editor" id="path-editor">
        <div class="promotion-head"><h4>${isNew ? 'Add push' : 'Edit push'}</h4></div>
        <div class="stage-edit-grid">
          ${edSelect('From', 'fromStageId', from, opts)}
          ${edSelect('To', 'toStageId', to, opts)}
          ${edText('Promotion routine id', 'routineId', routineId, 'promote-production')}
        </div>
        <div class="stage-edit-actions">
          <button type="button" class="action-link primary" data-action="path-save" data-payload="${escapeAttr(isNew ? 'new' : path.id)}">Save</button>
          <button type="button" class="action-link" data-action="path-cancel" data-payload="">Cancel</button>
          ${!isNew ? `<button type="button" class="action-link danger" data-action="path-remove" data-payload="${escapeAttr(path.id)}">Remove</button>` : ''}
        </div>
      </article>`;
  }

  function collectStageFromEditor(container, base) {
    const stage = JSON.parse(JSON.stringify(base));
    container.querySelectorAll('[data-field]').forEach(el => {
      const fieldName = el.getAttribute('data-field');
      let value;
      if (el.type === 'checkbox') { value = el.checked; }
      else if (el.type === 'number') { value = Number(el.value); }
      else { value = el.value; }
      setNestedField(stage, fieldName, value);
    });
    return stage;
  }

  function setNestedField(obj, fieldPath, value) {
    if (fieldPath === 'promotionPolicy.requiredChecks') {
      value = String(value).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    const parts = fieldPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) { cur[parts[i]] = {}; }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // ── Delivery: promotion execution modal (Phase 3) ───────────────

  function promotionRunEnabled(p) {
    const plan = p.plan;
    if (!plan || plan.blockers.length) { return false; }
    if (plan.checks.some(c => c.kind === 'auto' && c.status !== 'pass')) { return false; }
    if (!plan.checks.filter(c => c.kind === 'manual').every(c => p.attestations[c.id])) { return false; }
    if (plan.requiresApproval && !p.attestations['approve']) { return false; }
    return true;
  }

  function promoStatusIcon(status) {
    if (status === 'done') { return '✓'; }
    if (status === 'failed') { return '✗'; }
    if (status === 'skipped') { return '•'; }
    return '⏳';
  }

  function renderPromotionModal() {
    const p = state.promotion;
    if (!p) { return ''; }
    if (!p.plan) {
      return `
        <div class="promo-overlay">
          <div class="promo-modal">
            <h3>Promotion</h3>
            <p class="promotion-block-note">⚠ ${escapeHtml(p.error || 'Unavailable.')}</p>
            <div class="stage-edit-actions"><button type="button" class="action-link" data-action="promotion-cancel" data-payload="">Close</button></div>
          </div>
        </div>`;
    }
    const plan = p.plan;
    const runbook = p.mode === 'runbook';
    const blocked = plan.blockers.length > 0;
    const running = p.running;
    const done = !!p.result;
    const summaryPath = (state.snapshot && state.snapshot.delivery && state.snapshot.delivery.stages && state.snapshot.delivery.stages.summaryPath) || '';

    const stepsHtml = plan.steps.map(s => `
      <li class="promo-plan-step kind-${escapeAttr(s.kind)}">
        <div class="promo-plan-step-head">
          <span class="promo-step-badge ${s.managed ? 'managed' : 'custom'}">${s.managed ? 'managed' : 'custom'}</span>
          <strong>${escapeHtml(s.label)}</strong>
        </div>
        <div class="promo-plan-step-detail">${escapeHtml(s.detail)}</div>
        ${s.command ? `<pre class="promo-cmd">${escapeHtml(s.command)}</pre>` : ''}
      </li>`).join('');

    const autoChecks = plan.checks.filter(c => c.kind === 'auto');
    const manualChecks = plan.checks.filter(c => c.kind === 'manual');
    const checksHtml = `
      ${autoChecks.map(c => `<li class="promo-check ${c.status === 'pass' ? 'pass' : 'fail'}">${c.status === 'pass' ? '✓' : '✗'} <span>${escapeHtml(c.label)}</span><small>${escapeHtml(c.detail)}</small></li>`).join('')}
      ${runbook
        ? manualChecks.map(c => `<li class="promo-check manual">☐ <span>${escapeHtml(c.label)}</span> <small>(manual confirmation)</small></li>`).join('')
        : manualChecks.map(c => `<li class="promo-check manual"><label><input type="checkbox" class="promotion-attest" data-check-id="${escapeAttr(c.id)}" ${p.attestations[c.id] ? 'checked' : ''}/> <span>${escapeHtml(c.label)}</span></label></li>`).join('')}
    `;

    let actions;
    if (runbook) {
      actions = `<button type="button" class="action-link primary" data-action="promotion-cancel" data-payload="">Close</button>
                 ${summaryPath ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(summaryPath)}">Open delivery.md</button>` : ''}`;
    } else if (done) {
      actions = `<button type="button" class="action-link primary" data-action="promotion-cancel" data-payload="">Close</button>`;
    } else if (running) {
      actions = `<button type="button" class="promotion-ghost-btn" disabled>Running…</button>`;
    } else {
      const enabled = promotionRunEnabled(p) && !blocked;
      actions = `<button type="button" class="action-link primary" data-action="promotion-run" data-payload="" ${enabled ? '' : 'disabled'}>Confirm &amp; run</button>
                 <button type="button" class="action-link" data-action="promotion-cancel" data-payload="">Cancel</button>`;
    }

    return `
      <div class="promo-overlay">
        <div class="promo-modal">
          <h3>${runbook ? 'Runbook' : 'Promote'} — ${escapeHtml(plan.fromName)} → ${escapeHtml(plan.toName)} ${plan.isProtected ? '🔒' : ''}</h3>
          ${blocked ? `<div class="promo-blockers">${plan.blockers.map(b => `<p class="promotion-block-note">⚠ ${escapeHtml(b)}</p>`).join('')}</div>` : ''}
          <div class="promo-section">
            <h4>Plan</h4>
            <ol class="promo-plan-list">${stepsHtml}</ol>
          </div>
          ${plan.checks.length ? `<div class="promo-section"><h4>Preflight checks</h4><ul class="promo-check-list">${checksHtml}</ul></div>` : ''}
          ${(!runbook && plan.requiresApproval) ? `<label class="stage-edit-check"><input type="checkbox" class="promotion-attest" data-check-id="approve" ${p.attestations['approve'] ? 'checked' : ''}/> <span>I approve this promotion to ${escapeHtml(plan.toName)}.</span></label>` : ''}
          ${(!runbook && plan.isProtected) ? `<label class="stage-edit-field"><span>Type “${escapeHtml(plan.toName)}” to confirm (protected stage)</span><input type="text" id="promotion-confirm-text" value="${escapeAttr(p.confirmText)}" placeholder="${escapeAttr(plan.toName)}" autocomplete="off" /></label>` : ''}
          ${p.progress && p.progress.length ? `<div class="promo-section"><h4>Progress</h4><ul class="promo-progress-list">${p.progress.map(s => `<li class="promo-step ${escapeAttr(s.status)}">${promoStatusIcon(s.status)} ${escapeHtml(s.label)}${s.output ? `<div class="promo-step-out">${escapeHtml(s.output)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}
          ${done ? `<div class="promo-section promo-result ${p.result.succeeded ? 'good' : 'bad'}">
            <h4>${p.result.succeeded ? '✓ Promotion completed' : '✗ Promotion failed'}</h4>
            <ul class="promo-progress-list">${p.result.steps.map(s => `<li class="promo-step ${s.skipped ? 'skipped' : (s.ok ? 'done' : 'failed')}">${s.skipped ? '•' : (s.ok ? '✓' : '✗')} ${escapeHtml(s.label)}${s.output ? `<div class="promo-step-out">${escapeHtml(s.output)}</div>` : ''}</li>`).join('')}</ul>
            ${(p.result.rollback && (p.result.rollback.command || p.result.rollback.runbookRef)) ? `<p class="promotion-last">Recovery: ${escapeHtml(p.result.rollback.command || p.result.rollback.runbookRef)}</p>` : ''}
          </div>` : ''}
          ${p.error ? `<p class="promotion-block-note">⚠ ${escapeHtml(p.error)}</p>` : ''}
          <div class="stage-edit-actions">${actions}</div>
        </div>
      </div>`;
  }

  function renderDelivery(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'delivery' ? 'active' : ''}">
        ${renderStagePipeline(snapshot)}
        <div class="delivery-grid">
          <article class="panel-card">
            <p class="section-kicker">Dependencies</p>
            <h3>Package shape</h3>
            <div class="mini-grid">
              ${renderMetricPill('Version', snapshot.delivery.packageVersion)}
              ${renderMetricPill('Dependencies', String(snapshot.delivery.dependencyCount))}
              ${renderMetricPill('Dev dependencies', String(snapshot.delivery.devDependencyCount))}
              ${renderMetricPill('Scripts', String(snapshot.delivery.scriptCount))}
            </div>
            <div class="tag-row">
              ${snapshot.delivery.keyScripts.map(script => `<span class="tag mono">${escapeHtml(script)}</span>`).join('')}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="file" data-payload="package.json">Open package.json</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">CI signals</p>
            <h3>Build and verification</h3>
            <div class="signal-grid">
              ${snapshot.delivery.ciSignals.map(signal => renderSignalCard(signal.label, signal.ok, signal.ok ? `${signal.label} is configured.` : `${signal.label} is missing.`)).join('')}
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">PR readiness</p>
            <h3>Review scaffolding</h3>
            <div class="signal-grid">
              ${snapshot.delivery.reviewReadiness.map(signal => renderSignalCard(signal.label, signal.ok, signal.ok ? `${signal.label} is present.` : `${signal.label} is missing.`)).join('')}
            </div>
          </article>
        </div>
        <div class="review-grid">
          <article class="list-card" style="grid-column: 1 / -1">
            <p class="section-kicker">Workflow inventory</p>
            <h3>Detected CI definitions</h3>
            <div class="stack-list">
              ${snapshot.delivery.workflows.length > 0 ? snapshot.delivery.workflows.map(workflow => `
                <button type="button" class="workflow-card" data-action="file" data-payload="${escapeAttr(workflow.path)}">
                  <div class="row-head">
                    <h4>${escapeHtml(workflow.name)}</h4>
                    <span class="list-meta">${escapeHtml(relativeLabel(workflow.lastModified))}</span>
                  </div>
                  <div class="tag-row">${workflow.triggers.length > 0 ? workflow.triggers.map(trigger => `<span class="tag mono">${escapeHtml(trigger)}</span>`).join('') : '<span class="tag">No triggers parsed</span>'}</div>
                  <div class="list-meta mono">${escapeHtml(workflow.path)}</div>
                </button>`).join('') : '<div class="dashboard-empty">No workflow files detected.</div>'}
            </div>
          </article>
        </div>
        ${(function() {
          const artifacts = snapshot.delivery.artifacts || [];
          const attentionCount = artifacts.filter(a => a.needsAttention).length;
          const badgeClass = attentionCount === 0 ? 'good' : '';
          const badgeLabel = attentionCount === 0 ? 'All present' : `${attentionCount} missing`;
          return `
            <article class="list-card">
              <p class="section-kicker">Release hygiene</p>
              <div class="artifact-header">
                <h3>Artifact inventory</h3>
                <span class="artifact-attention-badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
              </div>
              <div class="artifact-list">
                ${artifacts.length > 0 ? artifacts.map(a => renderArtifactRow(a)).join('') : '<div class="dashboard-empty">No artifact data available.</div>'}
              </div>
            </article>
          `;
        })()}
      </section>
    `;
  }

  function renderStatCard(stat) {
    const actionAttr = stat.command
      ? `data-action="command" data-payload="${escapeAttr(stat.command)}"`
      : stat.pageTarget
        ? `data-action="page" data-payload="${escapeAttr(stat.pageTarget)}"`
        : '';
    return `
      <button type="button" class="stat-card tone-${escapeAttr(stat.tone || 'neutral')}" ${actionAttr}>
        <div>
          <p class="card-kicker">${escapeHtml(stat.label)}</p>
          <div class="stat-value">${escapeHtml(stat.value)}</div>
        </div>
        <div class="stat-detail">${escapeHtml(stat.detail)}</div>
      </button>
    `;
  }

  function renderActionCard(action) {
    const attrs = action.command
      ? `data-action="command" data-payload="${escapeAttr(action.command)}"`
      : action.filePath
        ? `data-action="file" data-payload="${escapeAttr(action.filePath)}"`
        : action.pageTarget
          ? `data-action="page" data-payload="${escapeAttr(action.pageTarget)}"`
          : '';
    return `
      <button type="button" class="action-card" ${attrs}>
        <p class="card-kicker">${escapeHtml(action.pageTarget || 'action')}</p>
        <strong>${escapeHtml(action.label)}</strong>
        <div class="stat-detail">${escapeHtml(action.description)}</div>
      </button>
    `;
  }

  function renderScoreComponent(component) {
    const attrs = component.pageTarget
      ? `data-action="page" data-payload="${escapeAttr(component.pageTarget)}"`
      : '';
    const width = Math.max(6, Math.round((component.score / Math.max(component.maxScore, 1)) * 100));
    return `
      <button type="button" class="score-component-row" ${attrs}>
        <div class="row-head">
          <strong>${escapeHtml(component.label)}</strong>
          <span class="tag ${component.tone === 'good' ? 'tag-good' : component.tone === 'warn' ? 'tag-warn' : component.tone === 'critical' ? 'tag-critical' : ''}">${escapeHtml(`${component.score}/${component.maxScore}`)}</span>
        </div>
        <div class="coverage-bar score-component-bar"><span style="width: ${width}%"></span></div>
        <div class="stat-detail">${escapeHtml(component.detail)}</div>
      </button>
    `;
  }

  function renderRecommendationColumn(title, description, items) {
    return `
      <article class="list-card score-recommendation-card">
        <p class="section-kicker">${escapeHtml(title)}</p>
        <h3>${escapeHtml(description)}</h3>
        <div class="stack-list">
          ${items.length > 0 ? items.map(item => renderRecommendationItem(item)).join('') : '<div class="dashboard-empty">No recommendation queued for this horizon.</div>'}
        </div>
      </article>
    `;
  }

  function renderRecommendationItem(item) {
    const attrs = item.actionPrompt
      ? `data-action="prompt" data-payload="${escapeAttr(item.actionPrompt)}"`
      : item.command
      ? `data-action="command" data-payload="${escapeAttr(item.command)}"`
      : item.filePath
        ? `data-action="file" data-payload="${escapeAttr(item.filePath)}"`
        : item.pageTarget
          ? `data-action="page" data-payload="${escapeAttr(item.pageTarget)}"`
          : '';
    return `
      <button type="button" class="action-card score-recommendation-item" ${attrs}>
        <p class="card-kicker">${escapeHtml(item.impactLabel)}</p>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="stat-detail">${escapeHtml(item.detail)}</div>
      </button>
    `;
  }

  function renderChartCard(id, title, description, series) {
    const filtered = series.slice(-state.timescale);
    const maxValue = Math.max(1, ...filtered.map(point => point.value));
    const activeDetail = state.activeDetails[id] || (filtered.length > 0 ? `${filtered[filtered.length - 1].label}: ${filtered[filtered.length - 1].value}` : 'No activity recorded.');
    return `
      <article class="chart-card">
        <div>
          <p class="chart-kicker">Timeline</p>
          <h3>${escapeHtml(title)}</h3>
          <div class="stat-detail">${escapeHtml(description)}</div>
        </div>
        <div class="chart-shell">
          ${filtered.length > 0 ? `
            <div class="chart-bars" style="--bar-count: ${filtered.length}">
              ${filtered.map(point => {
                const height = Math.max(4, Math.round((point.value / maxValue) * 100));
                const detailPayload = `${id}|${point.label}|${point.value}`;
                return `
                  <button type="button" class="chart-bar ${activeDetail.startsWith(point.label) ? 'active' : ''}" data-action="detail" data-payload="${escapeAttr(detailPayload)}" aria-label="${escapeAttr(`${title} ${point.label}: ${point.value}`)}">
                    <span class="chart-bar-column" style="height: ${height}%"></span>
                  </button>`;
              }).join('')}
            </div>
            <div class="chart-axis"><span>${escapeHtml(filtered[0].label)}</span><span>${escapeHtml(filtered[Math.floor(filtered.length / 2)]?.label || filtered[0].label)}</span><span>${escapeHtml(filtered[filtered.length - 1].label)}</span></div>
          ` : '<div class="timeline-empty">No activity recorded for this period.</div>'}
        </div>
        <div class="timeline-detail">${escapeHtml(activeDetail)}</div>
      </article>
    `;
  }

  function renderMetricPill(label, value) {
    return `<div class="metric-pill"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(value)}</span></div>`;
  }

  function renderSignalCard(label, ok, detail, actionPrompt) {
    const attrs = actionPrompt
      ? `data-action="prompt" data-payload="${escapeAttr(actionPrompt)}"`
      : '';
    return `
      <button type="button" class="signal-card ${ok ? 'good' : 'warn'}" ${attrs}>
        <div class="checkline">${escapeHtml(label)}</div>
        <div class="signal-detail">${escapeHtml(detail)}</div>
      </button>
    `;
  }

  function renderCoverageRow(entry, totalFilesOnDisk) {
    const width = totalFilesOnDisk > 0 ? Math.max(6, Math.round((entry.count / totalFilesOnDisk) * 100)) : (entry.present ? 12 : 0);
    return `
      <div class="coverage-row">
        <div class="row-head">
          <strong>${escapeHtml(entry.name)}</strong>
          <span class="list-meta">${escapeHtml(entry.present ? `${entry.count} file(s)` : 'missing')}</span>
        </div>
        <div class="coverage-bar"><span style="width: ${width}%"></span></div>
      </div>
    `;
  }

  function renderArtifactRow(artifact) {
    const rowClass = artifact.needsAttention ? 'artifact-row--warn'
      : artifact.exists ? 'artifact-row--ok'
      : 'artifact-row--info';

    const icon = artifact.needsAttention ? '⚠'
      : artifact.exists ? '✓'
      : '○';

    const statusLabel = artifact.needsAttention ? 'missing'
      : artifact.exists ? 'present'
      : 'absent';

    const statusClass = artifact.needsAttention ? 'artifact-status--warn'
      : artifact.exists ? 'artifact-status--ok'
      : 'artifact-status--info';

    const retentionTagClass = artifact.retention === 'keep' ? 'tag-good'
      : artifact.retention === 'cache' ? ''
      : '';

    const inner = `
      <span class="artifact-icon">${icon}</span>
      <div class="artifact-body">
        <span class="artifact-name">${escapeHtml(artifact.label)}</span>
        <span class="artifact-desc">${escapeHtml(artifact.description)}</span>
        <div class="artifact-tags">
          <span class="tag">${escapeHtml(artifact.lifecycle)}</span>
          <span class="tag">${escapeHtml(artifact.type)}</span>
          <span class="tag">${escapeHtml(artifact.origin)}</span>
          <span class="tag ${retentionTagClass}">${escapeHtml(artifact.retention)}</span>
        </div>
      </div>
      <span class="artifact-status ${statusClass}">${statusLabel}</span>
    `;

    if (artifact.exists && artifact.path && !artifact.path.includes('*')) {
      return `<button type="button" class="artifact-row ${rowClass}" data-action="file" data-payload="${escapeAttr(artifact.path)}">${inner}</button>`;
    }
    return `<div class="artifact-row ${rowClass}">${inner}</div>`;
  }

  function renderScoreRing(score) {
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
    return `
      <svg class="score-ring" viewBox="0 0 140 140" role="img" aria-label="Operational health score ${score}">
        <circle class="score-ring-track" cx="70" cy="70" r="${radius}"></circle>
        <circle class="score-ring-progress" cx="70" cy="70" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"></circle>
      </svg>
    `;
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
      return `${deltaDays} days ago`;
    }
    const deltaMonths = Math.floor(deltaDays / 30);
    return deltaMonths === 1 ? '1 month ago' : `${deltaMonths} months ago`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: value < 1 ? 4 : 2 }).format(value || 0);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
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
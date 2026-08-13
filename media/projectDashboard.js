(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('dashboard-root');
  let hostBranchPreferences = {};
  try {
    hostBranchPreferences = root?.dataset.branchPreferences
      ? JSON.parse(decodeURIComponent(root.dataset.branchPreferences))
      : {};
  } catch {
    hostBranchPreferences = {};
  }
  // Webview state covers a hidden/re-rendered panel. Host workspace state wins
  // when a panel is recreated, so closing the dashboard does not reset its
  // saved view, sort, order, grouping, or branch-title presentation.
  const persistedWebviewState = {
    ...(vscode.getState() || {}),
    ...hostBranchPreferences,
  };
  // Plain-language explainer surfaced as a tooltip on every "Mark MVP" control so
  // novice developers understand what tagging an item actually does.
  const MVP_HELP_TEXT = 'Mark MVP — MVP stands for Minimum Viable Product: the smallest set of features needed for a first usable release. Tagging an item adds it to the "Road to MVP" plan above and tells Atlas to prioritise it.';
  // The same explanation, generalised: MVP is the built-in first gate, and a
  // project past it needs somewhere to say "this belongs to the beta" instead.
  const GATE_HELP_TEXT = 'Release gates are the milestones your backlog is working towards — MVP is the built-in first one, and you can add your own (a public beta, v1.0, v2). Tagging an item puts it on that release\'s path. An item can belong to more than one, and removing a gate never deletes any work.';
  const refreshButton = document.getElementById('dashboard-refresh');
  const versionStrip = document.getElementById('dashboard-version-strip');
  const noProjectBanner = document.getElementById('no-project-banner');
  const statusRegion = document.getElementById('dashboard-status');
  const atlasDiscussIconUri = root?.dataset.atlasDiscussIcon || '';

  // Targeted announcement, replacing the aria-live that used to wrap the whole
  // dashboard and re-read all 14 pages on every render.
  function announce(message) {
    if (statusRegion) {
      statusRegion.textContent = message;
    }
  }

  function renderAtlasDiscussAction(action, payload, label, options = {}) {
    const title = options.title || label;
    const disabled = options.disabled ? ' disabled aria-disabled="true"' : '';
    return `<button type="button" class="atlas-discuss-action icon-only" data-action="${escapeAttr(action)}"${payload ? ` data-payload="${escapeAttr(payload)}"` : ''} title="${escapeAttr(title)}" aria-label="${escapeAttr(label)}"${disabled}><img src="${escapeAttr(atlasDiscussIconUri)}" alt="" aria-hidden="true" /><span class="atlas-discuss-label">${escapeHtml(label)}</span></button>`;
  }

  /**
   * Every dashboard refresh uses the same in-button progress treatment.
   * `busy` is host-backed; the optimistic webview state only covers the
   * message round-trip so a click can never look inert.
   */
  function renderRefreshAction(action, label, busy, options = {}) {
    const busyLabel = options.busyLabel || 'Refreshing…';
    const primary = options.primary === true ? ' primary' : '';
    const payload = options.payload ? ` data-payload="${escapeAttr(options.payload)}"` : '';
    const title = options.title ? ` title="${escapeAttr(options.title)}"` : '';
    return `<button type="button" class="action-link${primary} refresh-progress-button${busy ? ' is-refreshing' : ''}" data-action="${escapeAttr(action)}"${payload}${title} aria-busy="${busy ? 'true' : 'false'}" ${busy ? 'disabled' : ''}><span class="refresh-button-label">${escapeHtml(busy ? busyLabel : label)}</span></button>`;
  }

  function setDashboardRefreshBusy(busy) {
    if (!refreshButton) { return; }
    refreshButton.classList.toggle('is-refreshing', busy);
    refreshButton.disabled = busy;
    refreshButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    const label = refreshButton.querySelector('.refresh-button-label');
    if (label) {
      label.textContent = busy ? 'Refreshing…' : 'Refresh';
    }
  }

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

  // ── Dashboard navigation model ────────────────────────────────────────────
  //
  // One ordered source of truth for the tabs. The pages used to be listed in
  // three places in three different orders, and the list documented as
  // authoritative was the one that was wrong.
  //
  // The order follows the sentence a manager actually reads: where do we stand
  // → what is the work and who is on it → is the code sound → is it safe → can
  // we ship, and is the record straight. Before this the order was
  // archaeological — it recorded the sequence features shipped, which put
  // Roadmap behind four engineer pages and stranded Gap Analysis eight tabs
  // away from the Overview card that advertises it.
  const PAGE_GROUPS = [
    {
      id: 'stand',
      label: 'Where we stand',
      pages: [
        ['overview', 'Overview'],
        ['score', 'Score'],
        ['gapAnalysis', 'Gap Analysis'],
        ['ideation', 'Ideation'],
      ],
    },
    {
      id: 'work',
      label: 'The work',
      pages: [
        ['workflow', 'Workflow'],
        ['roadmap', 'Roadmap'],
        ['issues', 'Issues'],
        // Issues had a page and pull requests had a single card, despite being
        // the stage where a change stops being private. Parity.
        ['pullRequests', 'Pull Requests'],
        ['director', 'Director'],
      ],
    },
    {
      id: 'code',
      label: 'The code',
      pages: [
        ['branches', 'Branches'],
        ['repo', 'Repo'],
        // CI sat as one card on Workflow while carrying the failure taxonomy —
        // the thing that most rewards a page of its own.
        ['pipeline', 'Pipeline'],
        ['testing', 'Testing'],
        // Stage 7. Under "The code" rather than "The work": deferred work is
        // a property of the codebase, not an item on the backlog.
        ['debt', 'Tech Debt'],
      ],
    },
    {
      id: 'safe',
      label: 'Is it safe',
      pages: [
        ['security', 'Security'],
        ['privacy', 'Privacy'],
        ['risk', 'Risk'],
      ],
    },
    {
      id: 'ship',
      label: 'Ship & record',
      pages: [
        // Release is versioning, changelog, tags and the four delivery keys;
        // Delivery is the environments a version moves through. Adjacent, and
        // genuinely different questions.
        ['release', 'Release'],
        ['delivery', 'Delivery'],
        ['documents', 'Documents'],
        ['ssot', 'SSOT'],
      ],
    },
    {
      // Runtime is AtlasMind's own state — agents, models, providers, sessions
      // — not the project's. It sat under "The work", where it was the only
      // tab not about the work.
      id: 'engine',
      label: 'The engine',
      pages: [
        ['runtime', 'Runtime'],
      ],
    },
  ];

  // Mirrors RISK_STALE_DAYS in projectDashboardPanel.ts — an assessment older
  // than this stops counting as current assurance.
  const RISK_STALE_DAYS = 90;

  const NAV_PAGES = PAGE_GROUPS.reduce((all, group) => all.concat(group.pages), []);
  const NAV_PAGE_IDS = NAV_PAGES.map(entry => entry[0]);
  const DEFAULT_PAGE = 'overview';

  // `activePage` arrives from click payloads and from host `navigate` messages.
  // It is normalised here rather than trusted: an unrecognised value must not
  // leave every section inactive and render a blank dashboard.
  function normalizePageId(value) {
    return NAV_PAGE_IDS.indexOf(value) === -1 ? DEFAULT_PAGE : value;
  }

  const DASHBOARD_FOCUS_KINDS = [
    'branch', 'roadmap', 'issue', 'pull-request', 'gap', 'risk', 'debt', 'document',
    'assignment', 'follow-up',
  ];

  // The host validates this first; the webview validates it again because a
  // posted message is still an untrusted boundary. An invalid focus degrades to
  // page navigation, never to a selector assembled from arbitrary input.
  function normalizeNavigationTarget(value) {
    if (typeof value === 'string') {
      return { page: normalizePageId(value), focus: null };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { page: DEFAULT_PAGE, focus: null };
    }
    const page = normalizePageId(value.page);
    const focus = value.focus;
    if (!focus || typeof focus !== 'object' || Array.isArray(focus)
      || DASHBOARD_FOCUS_KINDS.indexOf(focus.kind) === -1
      || typeof focus.id !== 'string' || focus.id.length === 0 || focus.id.length > 500) {
      return { page: page, focus: null };
    }
    return { page: page, focus: { kind: focus.kind, id: focus.id } };
  }

  // Opening tag for a page panel. Centralised so the tab/panel ARIA wiring
  // cannot drift out of sync with the nav.
  function pageSectionOpen(id) {
    return `<section id="panel-${id}" class="page-section ${state.activePage === id ? 'active' : ''}" role="tabpanel" aria-labelledby="tab-${id}">`
      + githubLinkRow(id);
  }

  // The GitHub page this dashboard page is about.
  //
  // Rendered here rather than in `renderPageIntro` because this is the one place
  // that knows *which* page it is building — `renderPageIntro` is called from
  // inside each page's own render, where `state.activePage` would give every page
  // the active one's links.
  //
  // No URL is sent back: the button carries `page` and a link id, and the host
  // maps that to a URL it built itself. A surface that could name the URL to open
  // could name any URL.
  function githubLinkRow(id) {
    const gh = (state.snapshot && state.snapshot.githubLinks) || { links: {}, notices: {} };
    const links = (gh.links || {})[id] || [];
    if (links.length === 0) {
      // The notice is only worth showing where a page would otherwise look like
      // it failed to load something. A page with no GitHub equivalent says so on
      // hover of nothing, so it stays silent.
      return '';
    }
    return `<div class="github-link-row">
      <span class="github-link-label">On GitHub</span>
      ${links.map(link => `<button type="button" class="action-link"
        data-action="github-link" data-payload="${escapeAttr(id + ' ' + link.id)}"
        title="${escapeAttr(link.detail)}">${escapeHtml(link.label)} ↗</button>`).join('')}
    </div>`;
  }

  const state = {
    snapshot: undefined,
    activePage: DEFAULT_PAGE,
    timescale: 30,
    editingRoadmapId: '',
    roadmapDraftText: '',
    draggedRoadmapId: '',
    editingDoc: null,
    gapBusy: false,
    gapStatus: '',
    riskBusy: false,
    riskStatus: '',
    /** Host-backed state shared by dashboard, Issues, PR, CI, and release refreshes. */
    repositoryRefreshBusy: false,
    /** Explicit remote-ref fetch progress; separate because it mutates cached refs. */
    branchFetchBusy: false,
    /**
     * Testing policy cards the reader has opened.
     *
     * Ids rather than a single open card: comparing two policies is the common
     * reason to expand one at all, and an accordion that closes the other makes
     * that impossible.
     */
    testingExpandedIds: [],
    /** Opaque branch id whose on-demand review evidence is currently loading. */
    branchInspectionBusyId: '',
    /** One host-backed branch write workflow at a time. */
    branchWorkflowBusyId: '',
    branchWorkflowBusyAction: '',
    // The host owns every entry in this activity record. Keeping it separate
    // from the snapshot means an evidence refresh cannot erase the task the
    // user just started or its terminal outcome.
    testingFix: {
      running: false,
      runId: '',
      current: '',
      updates: [],
      result: null,
    },
    /** '' = all, otherwise a domain id, a status, or a `likelihood:impact` matrix cell. */
    riskFilter: '',
    activeDetails: {
      commits: '',
      runs: '',
      memory: '',
    },
    /** Which release gate the Road-to card is showing. '' = the first (MVP). */
    activeRoadmapGate: 'mvp',
    /** '' = everyone; otherwise a git author name from the contributor chart. */
    contributorFilter: '',
    /** Issues page: 'open' | 'unassigned' | 'closed' | 'all'. */
    issueFilter: 'open',
    debtSearch: '',
    // Filter by the *rule* rather than by severity: a project that declared
    // its own markers wants to see what `REVISIT` found, and two rules can
    // share a severity.
    debtRuleFilter: 'all',
    issueSearch: '',
    branchSearch: '',
    branchFilter: 'all',
    /** Persisted built-in branch view, sort, and grouping preferences. */
    branchView: ['all', 'mine', 'needs-my-review', 'ready', 'ci-failing', 'cleanup'].includes(persistedWebviewState.branchView)
      ? persistedWebviewState.branchView : 'all',
    branchSort: ['activity', 'readiness', 'drift', 'name'].includes(persistedWebviewState.branchSort)
      ? persistedWebviewState.branchSort : 'activity',
    branchSortDirection: ['asc', 'desc'].includes(persistedWebviewState.branchSortDirection)
      ? persistedWebviewState.branchSortDirection
      : persistedWebviewState.branchSort === 'name' ? 'asc' : 'desc',
    branchGroup: ['none', 'readiness', 'pull-request', 'branch-family'].includes(persistedWebviewState.branchGroup)
      ? persistedWebviewState.branchGroup : 'none',
    /** Cards always start compact; expansion is intentionally session-local. */
    branchExpandedIds: [],
    /** Distinguish local and remote-only refs with VS Code theme colours. */
    branchScmChips: persistedWebviewState.branchScmChips !== false,
    branchCompareIds: [],
    branchComparison: null,
    branchInspection: null,
    branchOperationStatus: '',
    issueDraftOpen: false,
    /**
     * A derived draft waiting in the composer, or undefined.
     *
     * Held in module state rather than written into the DOM on arrival, because
     * `render()` rebuilds every section's innerHTML and would discard it.
     */
    issuePrefill: undefined,
    /** Issue number whose comment box is open, or 0. */
    issueCommentFor: 0,
    activeTestCategory: 'all',
    selectedTestId: '',
    testSearch: '',
    privacyDraftRule: { kind: 'term', value: '', sensitivity: 'confidential' },
    privacyTest: { kind: 'text', value: '' },
    privacyTestResult: null,
    privacyExpandedProviders: {},
    // Which "?" explanations are open, by step id.
    //
    // Held here rather than relying on a native <details open> attribute,
    // because render() rebuilds every page's innerHTML on every render —
    // including host status pushes the user did not trigger — which would snap
    // every open explanation shut mid-read. The module closure survives that;
    // the DOM does not.
    workflowHelpOpen: {},
    editingStageId: '',
    confirmRemoveStageId: '',
    editingPathId: '',
    promotion: null,
    reimportConfirm: false,
    rollbackArmedStageId: '',
    rollbackText: '',
    rollbackNotice: '',
    healthNotice: '',
    // Project Director editor state.
    directorEditContactId: '',
    directorConfirmRemoveContactId: '',
    directorNewFollowUp: false,
    directorNewResponsibility: false,
    directorNewAssignment: false,
    directorSeedConfirm: false,
    directorComposeKey: '',
    // Consumed only after the exact record is present in a completed render.
    // Keeping it while data is loading lets an issue/PR deep link focus after
    // the next host snapshot instead of silently giving up.
    pendingDashboardFocus: null,
  };

  // Set when a tab activation should keep keyboard focus on the nav across the
  // innerHTML swap that destroys it, and when switching pages should reset the
  // scroll position instead of restoring the previous page's.
  let focusTabAfterRender = '';
  let resetScrollAfterRender = false;
  // A CSS selector for one control to re-focus after the next render. Consumed
  // and cleared by render(), so it never leaks into an unrelated update.
  let refocusAfterRender = '';

  function prepareDashboardFocus(target) {
    state.activePage = target.page;
    state.pendingDashboardFocus = target.focus;
    resetScrollAfterRender = !target.focus;
    if (!target.focus) { return; }
    // A saved presentation filter must not be allowed to hide the record a
    // direct link explicitly asked to reveal.
    if (target.focus.kind === 'branch') {
      state.branchSearch = '';
      state.branchFilter = 'all';
      state.branchView = 'all';
    } else if (target.focus.kind === 'issue') {
      state.issueSearch = '';
      state.issueFilter = 'all';
    } else if (target.focus.kind === 'risk') {
      state.riskFilter = '';
    } else if (target.focus.kind === 'debt') {
      state.debtSearch = '';
      state.debtRuleFilter = 'all';
    }
  }

  function persistBranchPreferences() {
    const preferences = {
      branchView: state.branchView,
      branchSort: state.branchSort,
      branchSortDirection: state.branchSortDirection,
      branchGroup: state.branchGroup,
      branchScmChips: state.branchScmChips,
    };
    vscode.setState({
      ...(vscode.getState() || {}),
      ...preferences,
    });
    vscode.postMessage({ type: 'saveBranchPreferences', payload: preferences });
  }

  function requestRepositoryRefresh(type) {
    if (state.repositoryRefreshBusy) { return; }
    state.repositoryRefreshBusy = true;
    setDashboardRefreshBusy(true);
    announce(type === 'refresh' ? 'Refreshing the dashboard…'
      : type === 'refreshCi' ? 'Reading CI for this branch…'
        : 'Refreshing GitHub activity…');
    if (state.snapshot) {
      render();
    }
    vscode.postMessage({ type });
  }

  refreshButton?.addEventListener('click', () => {
    requestRepositoryRefresh('refresh');
  });

  const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘⇧R' : 'Ctrl⇧R';
  const shortcutHint = refreshButton?.querySelector('.dashboard-refresh-shortcut');
  if (shortcutHint) {
    shortcutHint.textContent = shortcutLabel;
  }

  // Available wherever focus sits inside the dashboard, so refreshing never
  // requires scrolling back to the top action row.
  window.addEventListener('keydown', event => {
    if (!event.isComposing
      && (event.ctrlKey || event.metaKey)
      && event.shiftKey
      && !event.altKey
      && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      requestRepositoryRefresh('refresh');
    }
  });

  // WAI-ARIA tabs keyboard support. The container declared role="tablist" but
  // had no keydown listener at all, so reaching the last tab took 14 Tab
  // presses and arrow keys did nothing.
  root?.addEventListener('keydown', event => {
    const tab = event.target instanceof HTMLElement ? event.target.closest('[role="tab"]') : null;
    if (!(tab instanceof HTMLElement)) {
      return;
    }
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (keys.indexOf(event.key) === -1) {
      return;
    }
    event.preventDefault();

    const current = NAV_PAGE_IDS.indexOf(state.activePage);
    const last = NAV_PAGE_IDS.length - 1;
    let next;
    if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = current >= last ? 0 : current + 1;
    } else {
      next = current <= 0 ? last : current - 1;
    }

    const target = NAV_PAGE_IDS[next];
    if (!target || target === state.activePage) {
      return;
    }
    state.activePage = target;
    focusTabAfterRender = target;
    resetScrollAfterRender = true;
    render();
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (!message) {
      return;
    }

    if (message.type === 'state') {
      state.snapshot = message.payload;
      if (message.payload?.issues?.busy) {
        state.repositoryRefreshBusy = true;
      }
      const liveIds = new Set(((message.payload && message.payload.branches && message.payload.branches.items) || []).map(branch => branch.id));
      state.branchCompareIds = state.branchCompareIds.filter(id => liveIds.has(id)).slice(0, 2);
      state.branchExpandedIds = state.branchExpandedIds.filter(id => liveIds.has(id));
      if (state.branchInspection && !liveIds.has(state.branchInspection.branchId)) {
        state.branchInspection = null;
      }
      if (state.branchComparison
        && (!liveIds.has(state.branchComparison.leftId) || !liveIds.has(state.branchComparison.rightId))) {
        state.branchComparison = null;
      }
      if (noProjectBanner) {
        noProjectBanner.style.display = message.payload?.ssotPresent === false ? 'block' : 'none';
      }
      render();
      return;
    }

    if (message.type === 'branchInspection') {
      state.branchInspection = message.payload || null;
      if (state.branchInspection
        && !state.branchExpandedIds.includes(state.branchInspection.branchId)) {
        state.branchExpandedIds = state.branchExpandedIds.concat(state.branchInspection.branchId);
      }
      announce(state.branchInspection
        ? `Branch review details loaded for ${state.branchInspection.branchName}.`
        : 'Branch review details were unavailable.');
      render();
      return;
    }

    if (message.type === 'repositoryRefreshBusy') {
      state.repositoryRefreshBusy = message.payload === true;
      announce(state.repositoryRefreshBusy ? 'Refreshing GitHub activity…' : 'Dashboard refresh finished.');
      render();
      return;
    }

    if (message.type === 'branchFetchBusy') {
      state.branchFetchBusy = message.payload === true;
      announce(state.branchFetchBusy ? 'Fetching branch updates…' : 'Branch fetch finished.');
      render();
      return;
    }

    if (message.type === 'branchInspectionBusy') {
      const payload = message.payload || {};
      if (payload.busy === true && typeof payload.branchId === 'string') {
        state.branchInspectionBusyId = payload.branchId;
      } else if (state.branchInspectionBusyId === payload.branchId) {
        state.branchInspectionBusyId = '';
      }
      render();
      return;
    }

    if (message.type === 'branchWorkflowBusy') {
      const payload = message.payload || {};
      if (payload.busy === true && typeof payload.branchId === 'string' && typeof payload.action === 'string') {
        state.branchWorkflowBusyId = payload.branchId;
        state.branchWorkflowBusyAction = payload.action;
      } else if (state.branchWorkflowBusyId === payload.branchId) {
        state.branchWorkflowBusyId = '';
        state.branchWorkflowBusyAction = '';
      }
      announce(payload.busy === true ? 'Running branch workflow…' : 'Branch workflow finished.');
      render();
      return;
    }

    if (message.type === 'branchComparison') {
      state.branchComparison = message.payload || null;
      announce(state.branchComparison
        ? `Compared ${state.branchComparison.leftName} with ${state.branchComparison.rightName}.`
        : 'Branch comparison was unavailable.');
      render();
      return;
    }

    if (message.type === 'branchOperationStatus') {
      state.branchOperationStatus = typeof message.payload === 'string' ? message.payload : '';
      announce(state.branchOperationStatus);
      render();
      return;
    }

    if (message.type === 'issueDraft') {
      state.issuePrefill = message.payload;
      state.issueDraftOpen = true;
      render();
      return;
    }
    if (message.type === 'navigate') {
      const target = normalizeNavigationTarget(message.payload);
      prepareDashboardFocus(target);
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
      announce(state.gapStatus);
      render();
      return;
    }

    if (message.type === 'riskBusy') {
      state.riskBusy = !!message.payload;
      render();
      return;
    }

    if (message.type === 'riskStatus') {
      state.riskStatus = typeof message.payload === 'string' ? message.payload : '';
      announce(state.riskStatus);
      render();
      return;
    }

    if (message.type === 'testingFixStarted') {
      const update = normalizeTestingFixUpdate(message.payload);
      if (!update) {
        return;
      }
      state.testingFix = {
        running: true,
        runId: update.runId,
        current: update.message,
        updates: [update],
        result: null,
      };
      announce(update.message);
      render();
      return;
    }

    if (message.type === 'testingFixProgress') {
      const update = normalizeTestingFixUpdate(message.payload);
      if (!update || (state.testingFix.runId && state.testingFix.runId !== update.runId)) {
        return;
      }
      state.testingFix = {
        ...state.testingFix,
        running: true,
        runId: update.runId,
        current: update.message,
        updates: [...state.testingFix.updates, update].slice(-8),
      };
      announce(update.message);
      render();
      return;
    }

    if (message.type === 'testingFixFinished') {
      const result = normalizeTestingFixResult(message.payload);
      if (!result || (state.testingFix.runId && state.testingFix.runId !== result.runId)) {
        return;
      }
      state.testingFix = {
        ...state.testingFix,
        running: false,
        runId: result.runId,
        current: result.summary,
        result,
      };
      announce(result.summary);
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

    if (message.type === 'rollbackResult') {
      state.rollbackNotice = (message.payload && message.payload.summary) || '';
      announce(state.rollbackNotice);
      render();
      return;
    }

    if (message.type === 'healthTestResult') {
      state.healthNotice = (message.payload && message.payload.summary) || '';
      announce(state.healthNotice);
      render();
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
    if (action === 'dashboard-focus') {
      const navigation = normalizeNavigationTarget({
        page: target.dataset.page || DEFAULT_PAGE,
        focus: { kind: target.dataset.focusKind || '', id: target.dataset.focusId || '' },
      });
      prepareDashboardFocus(navigation);
      render();
      return;
    }
    if (action === 'page') {
      const next = normalizePageId(payload);
      const changed = next !== state.activePage;
      state.activePage = next;
      // Keep focus on the tab across the re-render that replaces it, so arrow
      // keys keep working after a click and keyboard users are not dumped back
      // to the top of the document.
      focusTabAfterRender = target.getAttribute('role') === 'tab' ? next : '';
      if (changed) {
        // A newly revealed page should scroll to its own top rather than
        // inheriting the previous page's scroll offset.
        resetScrollAfterRender = true;
      }
      render();
      return;
    }
    if (action === 'ideation-evidence') {
      // The payload is an opaque id from the just-rendered snapshot. The host
      // re-derives it before it hands anything to the canvas, so this page
      // cannot manufacture an evidence card from arbitrary text.
      if (payload) {
        vscode.postMessage({ type: 'addIdeationEvidence', payload });
      }
      return;
    }
    if (action === 'timescale') {
      state.timescale = Number(payload) || 30;
      render();
      return;
    }
    if (action === 'branch-filter') {
      state.branchFilter = payload || 'all';
      render();
      return;
    }
    if (action === 'branch-view') {
      state.branchView = ['mine', 'needs-my-review', 'ready', 'ci-failing', 'cleanup'].includes(payload)
        ? payload : 'all';
      persistBranchPreferences();
      render();
      return;
    }
    if (action === 'branch-card-toggle') {
      if (!payload) { return; }
      state.branchExpandedIds = state.branchExpandedIds.includes(payload)
        ? state.branchExpandedIds.filter(id => id !== payload)
        : state.branchExpandedIds.concat(payload);
      refocusAfterRender = 'button[data-action="branch-card-toggle"][data-payload="' + cssEscape(payload) + '"]';
      render();
      return;
    }
    if (action === 'testing-policy-toggle') {
      if (!payload) { return; }
      state.testingExpandedIds = state.testingExpandedIds.includes(payload)
        ? state.testingExpandedIds.filter(id => id !== payload)
        : state.testingExpandedIds.concat(payload);
      refocusAfterRender = 'button[data-action="testing-policy-toggle"][data-payload="' + cssEscape(payload) + '"]';
      render();
      return;
    }
    if (action === 'testing-policy-scaffold' || action === 'testing-policy-followup'
      || action === 'testing-policy-issue') {
      if (!payload) { return; }
      // The webview posts the policy id and nothing else. Every string these
      // actions need is rebuilt host-side, so a crafted message can name a
      // policy but can never supply a command, a file path or an issue body.
      vscode.postMessage({
        type: action === 'testing-policy-scaffold' ? 'scaffoldTestingPolicy'
          : action === 'testing-policy-followup' ? 'createTestingFollowUp'
          : 'raiseTestingIssue',
        payload: { policyId: payload },
      });
      return;
    }
    if (action === 'branch-toggle-all') {
      const visibleIds = [...root.querySelectorAll('.branch-inventory-card[data-branch-id]')]
        .map(card => card.getAttribute('data-branch-id'))
        .filter(Boolean);
      const allExpanded = visibleIds.length > 0
        && visibleIds.every(id => state.branchExpandedIds.includes(id));
      state.branchExpandedIds = allExpanded
        ? state.branchExpandedIds.filter(id => !visibleIds.includes(id))
        : [...new Set(state.branchExpandedIds.concat(visibleIds))];
      refocusAfterRender = 'button[data-action="branch-toggle-all"]';
      render();
      return;
    }
    if (action === 'branch-fetch') {
      if (state.branchFetchBusy) { return; }
      state.branchFetchBusy = true;
      announce('Fetching branch updates…');
      render();
      vscode.postMessage({ type: 'fetchBranches' });
      return;
    }
    if (action === 'branch-activate') {
      if (payload) {
        vscode.postMessage({ type: 'activateBranch', payload });
      }
      return;
    }
    if (action === 'branch-workflow') {
      const workflow = target.dataset.workflow || '';
      const allowed = ['commit', 'pull', 'push', 'create-branch', 'create-pull-request'];
      if (payload && allowed.includes(workflow) && !state.branchWorkflowBusyId) {
        state.branchWorkflowBusyId = payload;
        state.branchWorkflowBusyAction = workflow;
        render();
        vscode.postMessage({
          type: 'runBranchWorkflow',
          payload: { branchId: payload, action: workflow },
        });
      }
      return;
    }
    if (action === 'branch-discuss') {
      // The branch name and Git evidence never cross from the webview. The host
      // resolves this opaque id against a newly collected inventory and authors
      // the first Chat response from local Git facts.
      if (payload) {
        vscode.postMessage({ type: 'discussBranch', payload });
      }
      return;
    }
    if (action === 'branch-inspect') {
      if (payload) {
        if (state.branchInspectionBusyId === payload) { return; }
        state.branchInspectionBusyId = payload;
        if (!state.branchExpandedIds.includes(payload)) {
          state.branchExpandedIds = state.branchExpandedIds.concat(payload);
        }
        if (state.branchInspection && state.branchInspection.branchId !== payload) {
          state.branchInspection = null;
        }
        render();
        vscode.postMessage({ type: 'inspectBranch', payload });
      }
      return;
    }
    if (action === 'branch-inspection-close') {
      if (!payload || (state.branchInspection && state.branchInspection.branchId === payload)) {
        state.branchInspection = null;
        refocusAfterRender = payload
          ? 'button[data-action="branch-inspect"][data-payload="' + cssEscape(payload) + '"]'
          : '';
        render();
      }
      return;
    }
    if (action === 'branch-story') {
      if (payload) {
        vscode.postMessage({ type: 'openBranchChangeStory', payload });
      }
      return;
    }
    if (action === 'branch-open-pr') {
      if (payload) {
        vscode.postMessage({ type: 'openBranchPullRequest', payload });
      }
      return;
    }
    if (action === 'branch-cleanup') {
      if (payload) {
        vscode.postMessage({ type: 'reviewBranchCleanup', payload });
      }
      return;
    }
    if (action === 'branch-compare-toggle') {
      if (!payload) { return; }
      const existing = state.branchCompareIds.indexOf(payload);
      if (existing >= 0) {
        state.branchCompareIds.splice(existing, 1);
      } else {
        state.branchCompareIds = state.branchCompareIds.concat(payload).slice(-2);
      }
      state.branchComparison = null;
      render();
      return;
    }
    if (action === 'branch-compare-run') {
      if (state.branchCompareIds.length === 2 && state.branchCompareIds[0] !== state.branchCompareIds[1]) {
        vscode.postMessage({
          type: 'compareBranches',
          payload: { leftId: state.branchCompareIds[0], rightId: state.branchCompareIds[1] },
        });
      }
      return;
    }
    if (action === 'branch-compare-clear') {
      state.branchCompareIds = [];
      state.branchComparison = null;
      render();
      return;
    }
    if (action === 'branch-review-refresh') {
      requestRepositoryRefresh('refreshIssues');
      return;
    }
    if (action === 'contributor-filter') {
      // Clicking the active contributor clears the filter, so the ring and the
      // segmented control are both a toggle rather than a one-way trip.
      state.contributorFilter = state.contributorFilter === payload ? '' : (payload || '');
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
    if (action === 'setting') {
      vscode.postMessage({ type: 'openSettingKey', payload });
      return;
    }
    if (action === 'prompt') {
      vscode.postMessage({ type: 'openPrompt', payload: { prompt: payload, sourcePage: state.activePage } });
      return;
    }
    if (action === 'discuss-testing-policy') {
      // Re-resolved from the current host-side testing snapshot. No displayed
      // description, failure text or proposed instruction crosses this boundary.
      vscode.postMessage({ type: 'discussTestingPolicy', payload: { id: payload } });
      return;
    }
    if (action === 'discuss-dashboard-error') {
      // The host retained the error that it sent. A webview-side render failure
      // falls back to a generic diagnosis prompt rather than round-tripping DOM.
      vscode.postMessage({ type: 'discussDashboardError' });
      return;
    }
    if (action === 'risk-run') {
      // Each run is a real, costed model call, so reflect busy immediately rather
      // than waiting for the round-trip — otherwise a slow start invites double-clicks.
      if (state.riskBusy) { return; }
      state.riskBusy = true;
      state.riskStatus = 'Starting oversight review…';
      render();
      vscode.postMessage({ type: 'runRiskAnalysis', payload: { domain: payload } });
      return;
    }
    if (action === 'risk-filter') {
      state.riskFilter = payload || '';
      render();
      return;
    }
    if (action === 'risk-status') {
      const sep = payload.indexOf('|');
      if (sep === -1) { return; }
      vscode.postMessage({
        type: 'setRiskFindingStatus',
        payload: { findingId: payload.slice(0, sep), status: payload.slice(sep + 1) },
      });
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
      persistRoadmapItems(roadmapItemsForSave().filter(item => item.id !== payload));
      return;
    }
    if (action === 'roadmap-raise-issue') {
      // The host derives the text from the roadmap it holds. This sends only the
      // item id — the webview never composes the wording of a public issue.
      vscode.postMessage({ type: 'draftIssueFromRoadmap', payload: { itemId: payload } });
      return;
    }
    if (action === 'roadmap-toggle') {
      persistRoadmapItems(roadmapItemsForSave().map(item => item.id === payload ? { ...item, completed: !item.completed } : item));
      return;
    }
    if (action === 'roadmap-gate-toggle') {
      // payload is "<itemId>::<gateId>" — one control per gate per item.
      const parts = String(payload || '').split('::');
      if (parts.length === 2 && parts[0] && parts[1]) { toggleItemGate(parts[0], parts[1]); }
      return;
    }
    if (action === 'roadmap-mvp-toggle') {
      toggleItemGate(payload, 'mvp');
      return;
    }
    if (action === 'roadmap-mvp-add') {
      // "Add to <gate>" adds to whichever gate the card is currently showing.
      const gate = activeRoadmapGate();
      persistRoadmapItems(roadmapItemsForSave().map(item => item.id === payload && item.gates.indexOf(gate.id) < 0
        ? { ...item, gates: [...item.gates, gate.id] }
        : item));
      return;
    }
    if (action === 'roadmap-gate-select') {
      state.activeRoadmapGate = String(payload || 'mvp');
      render();
      return;
    }
    if (action === 'roadmap-gate-new') {
      vscode.postMessage({ type: 'createRoadmapGate' });
      return;
    }
    if (action === 'roadmap-gate-delete') {
      vscode.postMessage({ type: 'deleteRoadmapGate', payload: payload });
      return;
    }
    // ── Issues ────────────────────────────────────────────────────
    // Reads are a plain message; every *write* posts data only and is confirmed
    // extension-side, because it lands on a tracker other people can see.
    if (action === 'issues-refresh') {
      requestRepositoryRefresh('refreshIssues');
      return;
    }
    // ── Pipeline ──────────────────────────────────────────────────
    // Its own read rather than `refreshIssues`, so watching a build costs two
    // `gh` calls instead of five. Shares the repository busy flag: the host
    // permits one repository read at a time.
    if (action === 'pipeline-refresh') {
      requestRepositoryRefresh('refreshCi');
      return;
    }
    if (action === 'pipeline-create-starter') {
      vscode.postMessage({ type: 'createCiStarter' });
      return;
    }
    if (action === 'pipeline-review-workflow') {
      vscode.postMessage({ type: 'reviewCiWorkflow', payload: payload });
      return;
    }
    if (action === 'issues-filter') {
      state.issueFilter = payload || 'open';
      render();
      return;
    }
    if (action === 'issues-work') {
      vscode.postMessage({ type: 'workOnIssue', payload: payload });
      return;
    }
    if (action === 'fix-promotion-step') {
      // Only the step id travels. The host rebuilds the prompt from the run it
      // retained, so this message can name a step but never supply its text.
      vscode.postMessage({ type: 'fixPromotionStep', payload: payload });
      return;
    }
    if (action === 'issues-new') {
      state.issueDraftOpen = true;
      render();
      return;
    }
    if (action === 'issues-new-cancel') {
      state.issueDraftOpen = false;
      state.issuePrefill = undefined;
      render();
      return;
    }
    if (action === 'issues-create') {
      const root = document.getElementById('issue-composer');
      const read = field => {
        const el = root ? root.querySelector('[data-issue-field="' + field + '"]') : null;
        return el ? String(el.value || '').trim() : '';
      };
      const title = read('title');
      if (!title) { return; }
      const milestone = read('milestone');
      state.issueDraftOpen = false;
      state.issuePrefill = undefined;
      vscode.postMessage({
        type: 'createIssue',
        payload: {
          title: title,
          body: read('body'),
          labels: read('labels').split(',').map(label => label.trim()).filter(Boolean),
          ...(milestone ? { milestone: milestone } : {}),
        },
      });
      render();
      return;
    }
    if (action === 'issues-comment') {
      const number = Number(payload) || 0;
      state.issueCommentFor = state.issueCommentFor === number ? 0 : number;
      render();
      return;
    }
    if (action === 'issues-comment-send') {
      const editor = document.getElementById('issue-comment-editor');
      const field = editor ? editor.querySelector('[data-issue-field="comment"]') : null;
      const body = field ? String(field.value || '').trim() : '';
      if (!body) { return; }
      state.issueCommentFor = 0;
      vscode.postMessage({ type: 'commentIssue', payload: { number: Number(payload) || 0, body: body } });
      render();
      return;
    }
    if (action === 'issues-close') {
      vscode.postMessage({ type: 'closeIssue', payload: { number: Number(payload) || 0 } });
      return;
    }
    if (action === 'issues-reopen') {
      vscode.postMessage({ type: 'reopenIssue', payload: { number: Number(payload) || 0 } });
      return;
    }
    if (action === 'documents-seed') {
      vscode.postMessage({ type: 'seedDocumentsFromRepo' });
      return;
    }
    if (action === 'documents-add-filing') {
      state.activePage = 'documents';
      state.editingDoc = { kind: 'filing', id: 'new' };
      render();
      return;
    }
    if (action === 'documents-edit-filing') {
      state.activePage = 'documents';
      state.editingDoc = { kind: 'filing', id: payload };
      render();
      return;
    }
    if (action === 'documents-add-auto') {
      state.activePage = 'documents';
      state.editingDoc = { kind: 'auto', id: 'new' };
      render();
      return;
    }
    if (action === 'documents-edit-auto') {
      state.activePage = 'documents';
      state.editingDoc = { kind: 'auto', id: payload };
      render();
      return;
    }
    if (action === 'documents-cancel') {
      state.editingDoc = null;
      render();
      return;
    }
    if (action === 'documents-save-filing') {
      saveDocFilingDraft();
      return;
    }
    if (action === 'documents-create-folder') {
      vscode.postMessage({ type: 'createShelfFolder', payload: payload });
      return;
    }
    if (action === 'documents-save-auto') {
      saveDocAutoDraft();
      return;
    }
    if (action === 'documents-delete-filing') {
      const config = currentDocumentsConfig();
      config.filing = config.filing.filter(entry => entry.id !== payload);
      state.editingDoc = null;
      persistDocumentsConfig(config);
      return;
    }
    if (action === 'documents-delete-auto') {
      const config = currentDocumentsConfig();
      config.autoUpdate = config.autoUpdate.filter(entry => entry.id !== payload);
      state.editingDoc = null;
      persistDocumentsConfig(config);
      return;
    }
    if (action === 'documents-mark-reviewed') {
      const config = currentDocumentsConfig();
      const iso = new Date().toISOString();
      config.autoUpdate = config.autoUpdate.map(entry => entry.id === payload ? { ...entry, lastReviewed: iso } : entry);
      persistDocumentsConfig(config);
      return;
    }
    if (action === 'documents-track-uncovered') {
      const config = currentDocumentsConfig();
      if (!config.autoUpdate.some(entry => entry.path === payload)) {
        config.autoUpdate = [...config.autoUpdate, {
          id: createDocId('doc', payload),
          path: payload,
          label: payload.split('/').pop(),
          cadence: 'on-change',
        }];
      }
      persistDocumentsConfig(config);
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
    if (action === 'apply-team-role') {
      vscode.postMessage({ type: 'applyTeamRole', payload: { roleId: payload } });
      return;
    }
    if (action === 'generate-codeowners') {
      vscode.postMessage({ type: 'generateCodeowners' });
      return;
    }
    if (action === 'set-debt-rule-filter') {
      state.debtRuleFilter = payload || 'all';
      render();
      return;
    }
    if (action === 'scan-debt') {
      vscode.postMessage({ type: 'scanDebt' });
      return;
    }
    if (action === 'reconcile-testing') {
      // No payload: the host derives the proposal from the same snapshot this
      // page rendered, so the webview cannot choose what a reconciliation
      // changes. The confirmation showing the exact diff lives host-side too.
      vscode.postMessage({ type: 'reconcileTestingPolicy' });
      return;
    }
    if (action === 'fix-activated-testing') {
      // The host rebuilds the evidence from its current snapshot and confirms
      // the task before it can use an agent. No browser-provided target, test
      // command, or policy selection crosses this boundary.
      vscode.postMessage({ type: 'fixActivatedTesting' });
      return;
    }
    if (action === 'testing-fix-chat') {
      // The webview sends no transcript or error text. The extension host
      // retains, sanitizes, and fences the real result before opening Chat.
      vscode.postMessage({ type: 'openTestingFixChat' });
      return;
    }
    if (action === 'open-debt-evidence') {
      vscode.postMessage({ type: 'openDebtEvidence', payload: { id: payload } });
      return;
    }
    if (action === 'delete-label') {
      vscode.postMessage({ type: 'deleteLabel', payload: { name: payload } });
      return;
    }
    if (action === 'close-milestone') {
      vscode.postMessage({ type: 'closeMilestone', payload: { number: Number(payload) } });
      return;
    }
    if (action === 'create-label') {
      const input = document.getElementById('label-new-name');
      const name = input && input.value ? input.value.trim() : '';
      if (name) {
        const colorInput = document.getElementById('label-new-color');
        vscode.postMessage({
          type: 'createLabel',
          payload: { name, color: colorInput && colorInput.value ? colorInput.value.trim() : '' },
        });
      }
      return;
    }
    if (action === 'create-milestone') {
      const input = document.getElementById('milestone-new-title');
      const title = input && input.value ? input.value.trim() : '';
      if (title) {
        vscode.postMessage({ type: 'createMilestone', payload: { title } });
      }
      return;
    }
    if (action === 'load-review-comments') {
      vscode.postMessage({ type: 'loadReviewComments', payload: { number: Number(payload) } });
      return;
    }
    if (action === 'pr-draft-issue') {
      // Number only. The host resolves the current sanitized PR record and
      // derives the issue text; nothing in the browser can publish wording.
      vscode.postMessage({ type: 'draftIssueFromPullRequest', payload: { number: Number(payload) } });
      return;
    }
    if (action === 'address-review-comment') {
      // Number and index in one attribute, split on the colon. Both are
      // integers and neither can contain one.
      const parts = String(payload).split(':');
      vscode.postMessage({
        type: 'addressReviewComment',
        payload: { number: Number(parts[0]), index: Number(parts[1]) },
      });
      return;
    }
    if (action === 'work-on-debt') {
      vscode.postMessage({ type: 'workOnDebt', payload: { id: payload } });
      return;
    }
    if (action === 'set-debt-status') {
      // Status and id travel in one attribute, split on the first space: an
      // id can contain slashes and colons but never a space, because the
      // register constrains it to an identifier charset.
      const space = payload.indexOf(' ');
      if (space > 0) {
        vscode.postMessage({
          type: 'setDebtStatus',
          payload: { status: payload.slice(0, space), id: payload.slice(space + 1) },
        });
      }
      return;
    }
    if (action === 'github-link') {
      // `page id` — neither contains a space, so one split is unambiguous.
      const cut = payload.indexOf(' ');
      if (cut > 0) {
        vscode.postMessage({
          type: 'openGithubLink',
          payload: { page: payload.slice(0, cut), id: payload.slice(cut + 1) },
        });
      }
      return;
    }
    if (action === 'delta-seen') {
      vscode.postMessage({ type: 'markDeltaSeen' });
      return;
    }
    if (action === 'workflow-gate') {
      // `key:on|off` — a setting key cannot contain a colon, so the last
      // segment is unambiguous.
      const cut = payload.lastIndexOf(':');
      if (cut > 0) {
        vscode.postMessage({
          type: 'setWorkflowGate',
          payload: { key: payload.slice(0, cut), enabled: payload.slice(cut + 1) === 'on' },
        });
      }
      return;
    }
    if (action === 'automation-ceiling') {
      vscode.postMessage({ type: 'setAutomationCeiling', payload: { level: payload } });
      return;
    }
    if (action === 'create-workflow-config') {
      vscode.postMessage({ type: 'createWorkflowConfig', payload: { profile: payload } });
      return;
    }
    // Every stage edit is one field. The host confirms with the exact change
    // listed, so batching several into one dialog would mean confirming a list
    // nobody assembled deliberately.
    if (action === 'workflow-stage-toggle') {
      const stage = workflowStageById(payload);
      if (stage) {
        vscode.postMessage({
          type: 'editWorkflowConfig',
          payload: { stages: [{ id: payload, enabled: !stage.enabled }] },
        });
      }
      return;
    }
    if (action === 'workflow-help') {
      state.workflowHelpOpen[payload] = !state.workflowHelpOpen[payload];
      // Re-focus this exact toggle after the rebuild, so a keyboard user who
      // opened an explanation is still standing on the control they pressed.
      refocusAfterRender = 'button[data-action="workflow-help"][data-payload="' + cssEscape(payload) + '"]';
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
    if (action === 'test-health-url') {
      if (!payload) { return; }
      state.healthNotice = 'Testing ' + payload + ' …';
      render();
      vscode.postMessage({ type: 'testHealthUrl', payload: { url: payload } });
      return;
    }
    if (action === 'stage-rollback') { state.rollbackArmedStageId = payload; state.rollbackText = ''; render(); return; }
    if (action === 'stage-rollback-cancel') { state.rollbackArmedStageId = ''; state.rollbackText = ''; render(); return; }
    if (action === 'stage-rollback-confirm') {
      vscode.postMessage({ type: 'rollbackStage', payload: { stageId: payload, confirmText: state.rollbackText || '' } });
      state.rollbackArmedStageId = '';
      state.rollbackText = '';
      render();
      return;
    }
    if (action === 'delivery-reimport') { state.reimportConfirm = true; render(); return; }
    if (action === 'delivery-reimport-cancel') { state.reimportConfirm = false; render(); return; }
    if (action === 'delivery-reimport-confirm') {
      state.reimportConfirm = false;
      vscode.postMessage({ type: 'reimportDelivery' });
      render();
      return;
    }
    // The detected runbook sends only the step or phase id it rendered. The host
    // rebuilds the guide and resolves the command text itself, so this page can
    // point at a command but never compose one.
    if (action === 'delivery-copy-command') {
      if (payload) { vscode.postMessage({ type: 'copyDeliveryCommand', payload: payload }); }
      return;
    }
    if (action === 'delivery-send-command') {
      if (payload) { vscode.postMessage({ type: 'sendDeliveryCommandToTerminal', payload: payload }); }
      return;
    }
    if (action === 'delivery-run-phase') {
      // The confirmation naming every command lives on the host side, where the
      // command list is authoritative; a dialog drawn here could not name it.
      if (payload) { vscode.postMessage({ type: 'runDeliveryGuidePhase', payload: payload }); }
      return;
    }
    if (action === 'delivery-discuss-step') {
      if (payload) { vscode.postMessage({ type: 'discussDeliveryGuideStep', payload: payload }); }
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
    if (action === 'promotion-resolve-run') {
      const p = state.promotion;
      if (!p || !p.plan || p.running || !p.plan.remediation) { return; }
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
      vscode.postMessage({ type: 'resolveAndRunPromotion', payload: { pathId: p.plan.pathId, attestations: attest, confirmText: p.confirmText || '' } });
      return;
    }

    // ── Project Director ──
    if (action === 'director-seed') {
      const cfg = getDirectorConfig();
      state.directorSeedConfirm = !!(cfg && cfg.contacts.length > 0);
      if (!state.directorSeedConfirm) { vscode.postMessage({ type: 'seedDirectorFromRepo' }); }
      render();
      return;
    }
    if (action === 'director-seed-confirm') { state.directorSeedConfirm = false; vscode.postMessage({ type: 'seedDirectorFromRepo' }); render(); return; }
    if (action === 'director-seed-cancel') { state.directorSeedConfirm = false; render(); return; }
    if (action === 'director-store-pii') { const cfg = getDirectorConfig(); if (cfg) { postDirectorConfig(cfg); } return; }
    if (action === 'director-mode') { const cfg = cloneDirectorConfig(); cfg.settings.teamMode = payload; postDirectorConfig(cfg); return; }
    if (action === 'director-outbound-toggle') { const cfg = cloneDirectorConfig(); cfg.settings.outboundEnabled = !cfg.settings.outboundEnabled; postDirectorConfig(cfg); return; }
    if (action === 'director-reminders-toggle') { const cfg = cloneDirectorConfig(); cfg.settings.remindersEnabled = !cfg.settings.remindersEnabled; postDirectorConfig(cfg); return; }
    if (action === 'director-nudge-toggle') { const cfg = cloneDirectorConfig(); cfg.settings.nudgeOnActivation = cfg.settings.nudgeOnActivation === false; postDirectorConfig(cfg); return; }
    if (action === 'director-comms-open') { state.directorComposeKey = payload; render(); return; }
    if (action === 'director-comms-cancel') { state.directorComposeKey = ''; render(); return; }
    if (action === 'director-comms-send') {
      const parts = payload.split('::');
      if (parts.length !== 2) { return; }
      const container = document.getElementById('director-compose-editor');
      if (!container) { return; }
      const val = f => { const el = container.querySelector('[data-field="' + f + '"]'); return el ? el.value.trim() : ''; };
      const body = val('body');
      const subject = val('subject');
      if (!body && !subject) { return; }
      state.directorComposeKey = '';
      vscode.postMessage({ type: 'directorSendComms', payload: { intent: parts[1], contactId: parts[0], subject: subject, body: body, start: val('start') } });
      render();
      return;
    }
    if (action === 'director-copy') { vscode.postMessage({ type: 'copyContact', payload: payload }); return; }
    if (action === 'director-open-link') {
      const parts = payload.split('::');
      if (parts.length === 2) { vscode.postMessage({ type: 'openContactDeepLink', payload: { contactId: parts[0], linkId: parts[1] } }); }
      return;
    }
    if (action === 'director-contact-add') { state.directorEditContactId = 'new'; state.directorConfirmRemoveContactId = ''; render(); return; }
    if (action === 'director-contact-edit') { state.directorEditContactId = payload; state.directorConfirmRemoveContactId = ''; render(); return; }
    if (action === 'director-contact-cancel') { state.directorEditContactId = ''; render(); return; }
    if (action === 'director-contact-remove') { state.directorConfirmRemoveContactId = payload; render(); return; }
    if (action === 'director-contact-remove-cancel') { state.directorConfirmRemoveContactId = ''; render(); return; }
    if (action === 'director-contact-remove-confirm') {
      const cfg = cloneDirectorConfig();
      cfg.contacts = cfg.contacts.filter(c => c.id !== payload);
      cfg.stakeholders = cfg.stakeholders.filter(s => s.contactId !== payload);
      cfg.teamMembers = cfg.teamMembers.filter(t => t.contactId !== payload);
      cfg.responsibilities = cfg.responsibilities.filter(r => r.ownerContactId !== payload);
      if (cfg.selfContactId === payload) { cfg.selfContactId = ''; }
      state.directorConfirmRemoveContactId = '';
      state.directorEditContactId = '';
      postDirectorConfig(cfg);
      return;
    }
    if (action === 'director-contact-save') {
      const container = document.getElementById('director-contact-editor');
      if (!container) { return; }
      const val = f => { const el = container.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      const chk = f => { const el = container.querySelector('[data-field="' + f + '"]'); return !!(el && el.checked); };
      const name = val('name').trim();
      if (!name) { return; }
      const cfg = cloneDirectorConfig();
      let id = payload;
      if (payload === 'new') {
        let base = 'contact-' + slugClient(name); let u = base; let n = 1;
        while (cfg.contacts.some(c => c.id === u)) { u = base + '-' + (n++); }
        id = u;
      }
      // Every channel row, in order. The first is the preferred one.
      const links = directorReadLinkRows().map((row, index) => {
        const dl = directorDeepLink(row.kind, row.handle);
        const lnk = {
          id: 'link-' + slugClient(row.kind + '-' + row.handle),
          kind: row.kind,
          label: row.label || row.kind,
          handle: row.handle,
        };
        if (index === 0) { lnk.preferred = true; }
        if (dl) { lnk.deepLink = dl; }
        return lnk;
      });
      const buzzRow = directorReadLinkRows().find(r => r.kind === 'buzz');
      const linkHandle = buzzRow ? buzzRow.handle : '';
      const existingIdx = cfg.contacts.findIndex(c => c.id === id);
      const existing = existingIdx >= 0 ? cfg.contacts[existingIdx] : null;
      const finalLinks = links.length ? links : (existing ? existing.links : []);
      const contact = { id: id, name: name, kind: 'person', title: val('title').trim() || undefined, org: val('org').trim() || undefined, links: finalLinks, piiStored: finalLinks.some(l => directorIsPiiLink(l.kind)) };
      if (existing && existing.ref) { contact.ref = existing.ref; }
      if (existingIdx >= 0) { cfg.contacts[existingIdx] = contact; } else { cfg.contacts.push(contact); }
      if (chk('isSelf')) { cfg.selfContactId = id; } else if (cfg.selfContactId === id) { cfg.selfContactId = ''; }
      cfg.stakeholders = cfg.stakeholders.filter(s => s.contactId !== id);
      if (chk('asStakeholder')) { cfg.stakeholders.push({ id: 'stk-' + id, contactId: id, category: val('stkCategory') || 'internal', influence: val('stkInfluence') || 'medium', interest: val('stkInterest') || 'medium' }); }
      cfg.teamMembers = cfg.teamMembers.filter(t => t.contactId !== id);
      if (chk('asTeam')) { cfg.teamMembers.push({ id: 'tm-' + id, contactId: id, discipline: val('teamDiscipline').trim() || 'contributor' }); }
      // The agent binding lives in `atlasmind.buzz.agentBindings`, not in the
      // roster: it is a local routing preference, and project_memory/ is
      // git-tracked. Posted separately so the roster save is never blocked by a
      // binding the extension refuses.
      // Only when there is actually a binding to change. A Buzz handle is not
      // always a public key — a channel UUID is a perfectly valid handle — so
      // posting unconditionally warned people that a binding they never asked
      // for had failed, on a save that otherwise worked fine.
      if (linkHandle && directorLooksLikeBuzzKey(linkHandle)) {
        const boxes = container.querySelectorAll('[data-field="buzzAgentIds"]');
        const chosenAgents = [];
        for (let i = 0; i < boxes.length; i += 1) {
          if (boxes[i].checked && boxes[i].value) { chosenAgents.push(boxes[i].value); }
        }
        const alreadyBound = directorBoundAgentIds('buzz', linkHandle);
        if (chosenAgents.length || alreadyBound.length) {
          vscode.postMessage({
            type: 'setBuzzAgentBinding',
            payload: { pubkey: linkHandle, agentIds: chosenAgents, label: name },
          });
        }
      }
      state.directorEditContactId = '';
      postDirectorConfig(cfg);
      return;
    }
    // Rows are added and removed in the DOM rather than by re-rendering: a
    // re-render would discard every other field typed into the form but not
    // yet saved, which is exactly when someone is adding a second channel.
    if (action === 'director-link-add') {
      const rows = document.getElementById('director-link-rows');
      if (!rows) { return; }
      const template = document.createElement('div');
      template.innerHTML = renderContactLinkRow({ kind: 'email', label: '', handle: '' }, DIRECTOR_LINK_KINDS, false);
      const row = template.firstElementChild;
      if (row) { rows.appendChild(row); }
      syncBuzzBindingVisibility();
      return;
    }
    if (action === 'director-link-remove') {
      const rows = document.getElementById('director-link-rows');
      const row = target.closest('[data-link-row]');
      // The first row is the preferred channel and has no Remove button, so
      // this only ever fires on an extra one — but never leave zero rows.
      if (rows && row && rows.querySelectorAll('[data-link-row]').length > 1) {
        row.remove();
        syncBuzzBindingVisibility();
      }
      return;
    }
    if (action === 'director-resp-add') { state.directorNewResponsibility = true; render(); return; }
    if (action === 'director-resp-cancel') { state.directorNewResponsibility = false; render(); return; }
    if (action === 'director-resp-remove') { const cfg = cloneDirectorConfig(); cfg.responsibilities = cfg.responsibilities.filter(r => r.id !== payload); postDirectorConfig(cfg); return; }
    if (action === 'director-resp-save') {
      const container = document.getElementById('director-resp-editor');
      if (!container) { return; }
      const val = f => { const el = container.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      const area = val('area').trim();
      const owner = val('ownerContactId');
      if (!area || !owner) { return; }
      const cfg = cloneDirectorConfig();
      cfg.responsibilities.push({ id: 'resp-' + slugClient(area) + '-' + (cfg.responsibilities.length + 1), area: area, description: val('description').trim() || undefined, ownerContactId: owner, backupContactId: val('backupContactId') || undefined });
      state.directorNewResponsibility = false;
      postDirectorConfig(cfg);
      return;
    }
    if (action === 'director-assignment-add') { state.directorNewAssignment = true; render(); return; }
    if (action === 'director-assignment-cancel') { state.directorNewAssignment = false; render(); return; }
    if (action === 'director-assignment-remove') { const cfg = cloneDirectorConfig(); cfg.assignments = cfg.assignments.filter(a => a.id !== payload); postDirectorConfig(cfg); return; }
    if (action === 'director-assignment-cycle') {
      const cfg = cloneDirectorConfig();
      const order = ['todo', 'in-progress', 'blocked', 'done'];
      const a = cfg.assignments.find(x => x.id === payload);
      if (a) { a.status = order[(order.indexOf(a.status) + 1) % order.length]; a.updatedAt = new Date().toISOString(); postDirectorConfig(cfg); }
      return;
    }
    if (action === 'director-assignment-save') {
      const container = document.getElementById('director-assignment-editor');
      if (!container) { return; }
      const val = f => { const el = container.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      const title = val('title').trim();
      if (!title) { return; }
      const cfg = cloneDirectorConfig();
      const now = new Date().toISOString();
      cfg.assignments.push({ id: 'asg-' + slugClient(title) + '-' + (cfg.assignments.length + 1), title: title, kind: 'task', assigneeContactId: val('assigneeContactId') || undefined, status: val('status') || 'todo', priority: val('priority') || 'medium', due: val('due').trim() || undefined, source: 'manual', createdAt: now, updatedAt: now });
      state.directorNewAssignment = false;
      postDirectorConfig(cfg);
      return;
    }
    if (action === 'director-followup-add') { state.directorNewFollowUp = true; render(); return; }
    if (action === 'director-followup-cancel') { state.directorNewFollowUp = false; render(); return; }
    if (action === 'director-followup-save') {
      const container = document.getElementById('director-followup-editor');
      if (!container) { return; }
      const val = f => { const el = container.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      const title = val('title').trim();
      if (!title) { return; }
      const cfg = cloneDirectorConfig();
      const now = new Date().toISOString();
      cfg.followUps.push({ id: 'fu-' + slugClient(title) + '-' + (cfg.followUps.length + 1), title: title, dueDate: val('dueDate').trim() || directorTodayKey(), cadence: val('cadence') || 'once', status: 'open', linked: { kind: 'none' }, withContactId: val('withContactId') || undefined, createdAt: now, updatedAt: now });
      state.directorNewFollowUp = false;
      postDirectorConfig(cfg);
      return;
    }
    if (action === 'director-followup-complete' || action === 'director-followup-snooze' || action === 'director-followup-cancel-item') {
      const cfg = cloneDirectorConfig();
      const f = cfg.followUps.find(x => x.id === payload);
      if (!f) { return; }
      const now = new Date().toISOString();
      if (action === 'director-followup-complete') { f.status = 'done'; f.completedAt = now; }
      else if (action === 'director-followup-snooze') { f.status = 'snoozed'; f.snoozedUntil = directorAddDaysKey(7); }
      else { f.status = 'cancelled'; }
      f.updatedAt = now;
      postDirectorConfig(cfg);
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
    if (target instanceof HTMLInputElement && target.id === 'issue-search-input') {
      state.issueSearch = target.value;
      render();
    }
    if (target instanceof HTMLInputElement && target.id === 'branch-search-input') {
      state.branchSearch = target.value;
      render();
    }
    if (target instanceof HTMLInputElement && target.id === 'debt-search-input') {
      state.debtSearch = target.value;
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
    if (target instanceof HTMLInputElement && target.id === 'rollback-confirm-text') {
      state.rollbackText = target.value;
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
    const testing = state.snapshot.testing;
    const config = testing && testing.projectTestingConfig;
    // The catalogue arrives in the host snapshot so this write path uses the
    // same definitions, labels, and future additions as the renderer and
    // Settings. A webview-local copy would quietly fall behind.
    const baseMethodologies = getMethodologyDefinitions(testing).map(def => {
      const existing = config && config.methodologies ? config.methodologies.find(m => m.id === def.id) : undefined;
      return existing ? { ...existing } : { id: def.id, enabled: def.id === 'tdd' || def.id === 'unit' };
    });
    const updated = baseMethodologies.map(m => m.id === methodologyId ? { ...m, enabled: target.checked } : m);
    const newConfig = {
      version: config && config.version === 2 ? 2 : 1,
      updatedAt: new Date().toISOString(),
      methodologies: updated,
    };
    // Optimistically update local snapshot so re-renders stay consistent without a full refresh.
    if (state.snapshot.testing) {
      state.snapshot.testing.projectTestingConfig = newConfig;
    }
    vscode.postMessage({ type: 'saveTestingConfig', payload: newConfig });
  });

  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target instanceof HTMLInputElement && target.id === 'branch-scm-chip-toggle') {
      state.branchScmChips = target.checked;
      persistBranchPreferences();
      render();
      return;
    }
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    if (target.id === 'test-select-jump') {
      state.selectedTestId = target.value;
      render();
    }
    if (target.id === 'branch-sort-select') {
      state.branchSort = ['readiness', 'drift', 'name'].includes(target.value) ? target.value : 'activity';
      persistBranchPreferences();
      render();
      return;
    }
    if (target.id === 'branch-sort-direction-select') {
      state.branchSortDirection = target.value === 'asc' ? 'asc' : 'desc';
      persistBranchPreferences();
      render();
      return;
    }
    if (target.id === 'branch-group-select') {
      state.branchGroup = ['readiness', 'pull-request', 'branch-family'].includes(target.value) ? target.value : 'none';
      persistBranchPreferences();
      render();
      return;
    }
    if (target.getAttribute('data-action') === 'director-assign-run') {
      const runId = target.getAttribute('data-run') || '';
      if (runId) {
        vscode.postMessage({ type: 'assignRunOwner', payload: { runId: runId, contactId: target.value } });
      }
      return;
    }
    if (target.getAttribute('data-action') === 'director-assign-work') {
      const targetId = target.getAttribute('data-target') || '';
      if (targetId) {
        vscode.postMessage({ type: 'assignDashboardWorkOwner', payload: { targetId: targetId, contactId: target.value } });
      }
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

  // Contact editor: the Buzz agent binding only means anything on a buzz
  // channel, so it follows the channel picker. Toggled in place rather than
  // via render() — a re-render would discard whatever else has been typed
  // into the form but not yet saved.
  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) { return; }
    const field = target.getAttribute('data-field');

    if (target.getAttribute('data-link-field') === 'kind') {
      syncBuzzBindingVisibility();
      return;
    }

    // Picking an observed identity fills the Buzz row's Handle with the key
    // that arrived on the wire. Typing one by hand is still supported; this
    // only saves the paste, it is not the only way in.
    if (field === 'buzzIdentityPick' && target.value) {
      const handle = directorFirstBuzzHandleInput();
      if (handle instanceof HTMLInputElement) {
        handle.value = target.value;
        const row = handle.closest('[data-link-row]');
        const label = row && row.querySelector('[data-link-field="label"]');
        if (label instanceof HTMLInputElement && !label.value.trim()) { label.value = 'Buzz'; }
      }
    }
  });

  // The agent checklist summary, kept honest as boxes are ticked. Updated in
  // place rather than by re-rendering, which would discard everything else
  // typed into the form but not yet saved.
  root?.addEventListener('change', event => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target || target.getAttribute('data-field') !== 'buzzAgentIds') { return; }
    const container = document.getElementById('director-contact-editor');
    const summary = container && container.querySelector('[data-buzz-agent-summary]');
    if (!(summary instanceof HTMLElement)) { return; }
    const boxes = container.querySelectorAll('[data-field="buzzAgentIds"]');
    const names = [];
    for (let i = 0; i < boxes.length; i += 1) {
      if (boxes[i].checked) {
        const span = boxes[i].parentElement && boxes[i].parentElement.querySelector('span');
        names.push(span ? span.textContent : boxes[i].value);
      }
    }
    summary.textContent = names.length === 0
      ? 'Unassigned'
      : names.length === 1 ? names[0] : names[0] + ' + ' + (names.length - 1) + ' more';
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

  function clearRoadmapDropMarkers() {
    root?.querySelectorAll('.roadmap-item.drag-over, .roadmap-item.dragging').forEach(el => {
      el.classList.remove('drag-over', 'dragging');
    });
  }

  root?.addEventListener('dragstart', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    state.draggedRoadmapId = target.dataset.roadmapId || '';
    target.classList.add('dragging');
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
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    // Highlight only the current drop target so the landing spot is obvious.
    if (target.dataset.roadmapId !== state.draggedRoadmapId) {
      root.querySelectorAll('.roadmap-item.drag-over').forEach(el => {
        if (el !== target) {
          el.classList.remove('drag-over');
        }
      });
      target.classList.add('drag-over');
    }
  });

  root?.addEventListener('dragleave', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (target instanceof HTMLElement && !target.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) {
      target.classList.remove('drag-over');
    }
  });

  root?.addEventListener('drop', event => {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-roadmap-id]') : null;
    if (!(target instanceof HTMLElement) || !state.draggedRoadmapId) {
      return;
    }
    event.preventDefault();
    clearRoadmapDropMarkers();
    moveRoadmapItem(state.draggedRoadmapId, target.dataset.roadmapId || '');
    state.draggedRoadmapId = '';
  });

  root?.addEventListener('dragend', () => {
    clearRoadmapDropMarkers();
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
    setDashboardRefreshBusy(state.repositoryRefreshBusy);

    // A selector for one control to re-focus after this render, set by whichever
    // handler triggered it. The `activeId` mechanism below only covers three
    // hardcoded inputs; anything else — such as a "?" toggle — would silently
    // lose focus on every activation, which makes the control keyboard-hostile
    // in exactly the way a teaching surface must not be.
    const refocusSelector = refocusAfterRender;
    refocusAfterRender = '';

    // --- Preserve focus and cursor position for test search and roadmap textarea ---
    let activeId = null, cursorPos = null, isTextarea = false;
    const active = document.activeElement;
    if (active && (active.id === 'test-search-input' || active.id === 'issue-search-input'
      || active.id === 'branch-search-input'
      || active.id === 'debt-search-input'
      || (active instanceof HTMLTextAreaElement && active.hasAttribute('data-roadmap-draft')))) {
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
          ${renderNav(snapshot)}
        </section>

        ${renderOverview(snapshot)}
        ${renderScore(snapshot)}
        ${renderGapAnalysis(snapshot)}
        ${renderIdeation(snapshot)}
        ${renderWorkflow(snapshot)}
        ${renderRoadmap(snapshot)}
        ${renderIssues(snapshot)}
        ${renderPullRequests(snapshot)}
        ${renderPipeline(snapshot)}
        ${renderDirector(snapshot)}
        ${renderRuntime(snapshot)}
        ${renderBranches(snapshot)}
        ${renderRepo(snapshot)}
        ${renderTesting(snapshot)}
        ${renderDebt(snapshot)}
        ${renderSecurity(snapshot)}
        ${renderPrivacy(snapshot)}
        ${renderRisk(snapshot)}
        ${renderRelease(snapshot)}
        ${renderDelivery(snapshot)}
        ${renderDocuments(snapshot)}
        ${renderSsot(snapshot)}
        ${renderPromotionModal()}
      `;

      // --- Re-focus a control that asked to keep focus across its own render ---
      if (refocusSelector) {
        const target = root.querySelector(refocusSelector);
        if (target && typeof target.focus === 'function') {
          target.focus({ preventScroll: true });
        }
      }

      // --- Restore focus and cursor position if needed ---
      if (activeId) {
        let el = null;
        if (activeId === 'test-search-input' || activeId === 'issue-search-input'
          || activeId === 'branch-search-input'
          || activeId === 'debt-search-input') {
          el = document.getElementById(activeId);
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

      // The nav is rebuilt with everything else, so a tab activated by keyboard
      // loses focus mid-interaction. Put it back on the now-selected tab.
      if (focusTabAfterRender) {
        const tabEl = document.getElementById(`tab-${focusTabAfterRender}`);
        focusTabAfterRender = '';
        if (tabEl) {
          // preventScroll so the explicit scroll handling below stays authoritative.
          tabEl.focus({ preventScroll: true });
        }
      }

      // Restore scroll positions captured before the innerHTML swap.
      document.querySelectorAll('[data-scroll-key]').forEach(el => {
        const saved = innerScroll[el.getAttribute('data-scroll-key')];
        if (typeof saved === 'number') { el.scrollTop = saved; }
      });
      if (resetScrollAfterRender) {
        resetScrollAfterRender = false;
        window.scrollTo(0, 0);
      } else if (pageScrollY > 0) {
        window.scrollTo(0, pageScrollY);
      }

      applyPendingDashboardFocus();

      // Meters, rings and bars are driven from here rather than from CSS —
      // see applyValueAnimations() for why a plain transition cannot work
      // against a wholesale innerHTML swap.
      applyValueAnimations();
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  // Attention badges. Every number here is already in the snapshot on the same
  // render pass — without them a manager has to open all 14 tabs to find out
  // which one is red.
  //
  // Only genuinely actionable state earns a badge. Counting things that are
  // merely present (total roadmap items, total tests) would make every tab
  // permanently badged, which conveys nothing.
  function computeNavBadges(snapshot) {
    const badges = {};
    const set = (page, count, tone, title) => {
      if (count > 0) {
        badges[page] = { count, tone, title };
      }
    };

    const gap = snapshot.gapAnalysis;
    if (gap && Array.isArray(gap.items)) {
      const open = gap.items.filter(item => !item.resolved && item.type !== 'praise');
      const p1 = open.filter(item => item.priority === 'P1').length;
      set('gapAnalysis', open.length, p1 > 0 ? 'critical' : 'warn',
        `${open.length} open gap${open.length === 1 ? '' : 's'}${p1 > 0 ? `, ${p1} at P1` : ''}`);
    }

    const ideation = snapshot.ideation;
    const ideationObservations = ideation && ideation.readiness && Array.isArray(ideation.readiness.observations)
      ? ideation.readiness.observations
      : [];
    const ideationAttention = ideationObservations.filter(observation =>
      observation && (observation.tone === 'blocking' || observation.tone === 'weak' || observation.tone === 'unassessed'));
    const ideationContradictions = ideation && ideation.readiness ? Number(ideation.readiness.contradictions) || 0 : 0;
    set('ideation', ideationAttention.length, ideationContradictions > 0 ? 'critical' : 'warn',
      `${ideationAttention.length} board concern${ideationAttention.length === 1 ? '' : 's'}${ideationContradictions > 0 ? `, ${ideationContradictions} contradiction${ideationContradictions === 1 ? '' : 's'}` : ''}`);

    if (snapshot.risk && snapshot.risk.openCount > 0) {
      set('risk', snapshot.risk.openCount, 'warn',
        `${snapshot.risk.openCount} open risk finding${snapshot.risk.openCount === 1 ? '' : 's'}`);
    }

    // Only once the tracker has actually been read: a badge derived from an
    // unloaded list would report a quiet tracker nobody looked at.
    const issues = snapshot.issues;
    if (issues && issues.status === 'ready' && issues.summary) {
      set('issues', issues.summary.openCount, issues.summary.staleCount > 0 ? 'warn' : 'accent',
        `${issues.summary.openCount} open issue${issues.summary.openCount === 1 ? '' : 's'}`
        + (issues.summary.unassignedCount > 0 ? `, ${issues.summary.unassignedCount} unassigned` : '')
        + (issues.summary.staleCount > 0 ? `, ${issues.summary.staleCount} stale` : ''));
    }

    const pullRequests = snapshot.guidedWorkflow && snapshot.guidedWorkflow.pullRequests;
    if (pullRequests) {
      set('pullRequests', pullRequests.open,
        pullRequests.changesRequested > 0 ? 'critical' : pullRequests.awaitingReview > 0 ? 'warn' : 'accent',
        `${pullRequests.open} open pull request${pullRequests.open === 1 ? '' : 's'}`
        + (pullRequests.draft > 0 ? `, ${pullRequests.draft} draft` : '')
        + (pullRequests.awaitingReview > 0 ? `, ${pullRequests.awaitingReview} awaiting review` : '')
        + (pullRequests.unlinked > 0 ? `, ${pullRequests.unlinked} without an issue` : ''));
    }

    if (snapshot.director && snapshot.director.overdueCount > 0) {
      set('director', snapshot.director.overdueCount, 'critical',
        `${snapshot.director.overdueCount} overdue follow-up${snapshot.director.overdueCount === 1 ? '' : 's'}`);
    }

    const docs = snapshot.documents;
    if (docs) {
      const stale = (docs.reviewDueCount || 0) + (docs.missingCount || 0);
      set('documents', stale, docs.missingCount > 0 ? 'critical' : 'warn',
        `${docs.reviewDueCount || 0} due for review, ${docs.missingCount || 0} missing`);
    }

    if (snapshot.ssot && snapshot.ssot.blockedEntries > 0) {
      set('ssot', snapshot.ssot.blockedEntries, 'critical',
        `${snapshot.ssot.blockedEntries} blocked memory entr${snapshot.ssot.blockedEntries === 1 ? 'y' : 'ies'}`);
    }

    const repo = snapshot.repo;
    if (repo) {
      const pending = (repo.staged || 0) + (repo.modified || 0) + (repo.untracked || 0);
      set('repo', pending, 'accent', `${pending} pending file change${pending === 1 ? '' : 's'}`);
    }

    const branches = snapshot.branches;
    if (branches && Array.isArray(branches.items)) {
      const attention = branches.items.filter(branch =>
        branch.stale || branch.ahead > 0 || branch.behind > 0
        || branch.status === 'upstream-gone' || branch.status === 'name-conflict').length;
      set('branches', attention, 'warn',
        `${attention} branch${attention === 1 ? '' : 'es'} stale, drifted, or blocked from local activation`);
    }

    const runtime = snapshot.runtime;
    if (runtime && runtime.totalProviders > 0) {
      const unhealthy = runtime.totalProviders - runtime.healthyProviders;
      set('runtime', unhealthy, 'warn', `${unhealthy} provider${unhealthy === 1 ? '' : 's'} unhealthy`);
    }

    const delivery = snapshot.delivery;
    if (delivery && Array.isArray(delivery.artifacts)) {
      const attention = delivery.artifacts.filter(artifact => artifact.needsAttention).length;
      set('delivery', attention, 'warn', `${attention} artifact${attention === 1 ? ' needs' : 's need'} attention`);
    }

    return badges;
  }

  function renderNav(snapshot) {
    const badges = computeNavBadges(snapshot);
    const groups = PAGE_GROUPS.map(group => {
      const tabs = group.pages.map(entry => {
        const id = entry[0];
        const label = entry[1];
        const isActive = state.activePage === id;
        const badge = badges[id];
        // aria-label carries the badge meaning in words; the visual badge is a
        // bare number and is hidden from assistive tech to avoid "Risk 3".
        const accessibleName = badge ? `${label} — ${badge.title}` : label;
        return `
          <button type="button" role="tab" id="tab-${id}"
            aria-controls="panel-${id}" aria-selected="${isActive ? 'true' : 'false'}"
            tabindex="${isActive ? '0' : '-1'}"
            aria-label="${escapeAttr(accessibleName)}"
            ${badge ? `title="${escapeAttr(badge.title)}"` : ''}
            data-action="page" data-payload="${escapeAttr(id)}"
            class="nav-tab${isActive ? ' active' : ''}">
            <span class="nav-tab-label">${escapeHtml(label)}</span>
            ${badge ? `<span class="nav-badge nav-badge-${escapeAttr(badge.tone)}" aria-hidden="true">${escapeHtml(String(badge.count))}</span>` : ''}
          </button>`;
      }).join('');
      return `
        <div class="nav-group" role="presentation">
          <span class="nav-group-label" id="navgrp-${group.id}">${escapeHtml(group.label)}</span>
          <div class="nav-group-tabs" role="presentation">${tabs}</div>
        </div>`;
    }).join('');

    return `<div class="page-nav" role="tablist" aria-label="Dashboard sections">${groups}</div>`;
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
          <div class="tag-row" style="margin-top:10px">
            ${renderAtlasDiscussAction(
              'discuss-dashboard-error',
              '',
              'Resolve with Atlas',
              { title: 'Open this dashboard error in Atlas Chat as a reviewable draft' },
            )}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * The header's version pills — what version is where, one per delivery stage.
   *
   * Previously two hardcoded pills: a detected production branch and whatever
   * branch was checked out. That answered "which branch am I on?" while the
   * project already modelled the real answer on the Delivery page, so adding a
   * Staging stage there changed nothing here and the working tree — the one
   * reading that can be ahead of every branch — had no pill of its own.
   *
   * A pill with no version renders the reason instead. Substituting a plausible
   * one would claim a deployment nobody made.
   */
  function renderVersionStrip(snapshot) {
    const strip = snapshot.versionStrip;
    if (!strip || strip.pills.length === 0) {
      return '';
    }

    const pills = strip.pills.map(pill => renderVersionPill(pill));
    if (strip.droppedByCap > 0) {
      // Never a silent truncation: a header that dropped the last stage would
      // read as a project that does not have one.
      pills.push(`
        <button type="button" class="dashboard-version-pill dashboard-version-pill-more" data-action="page" data-payload="delivery"
          title="Open the Delivery page to see every stage">
          +${escapeHtml(String(strip.droppedByCap))} more
        </button>
      `);
    }
    return pills.join('');
  }

  function renderVersionPill(pill) {
    const classes = ['dashboard-version-pill'];
    if (pill.isCurrent) { classes.push('dashboard-version-pill-current'); }
    if (pill.isWorkingTree) { classes.push('dashboard-version-pill-local'); }
    // A version we could not read is shown as the reason, not as a blank and
    // never as another stage's number.
    const value = pill.version
      ? `<span>v${escapeHtml(pill.version)}</span>`
      : '<span class="dashboard-version-pill-muted">no version</span>';
    return `
      <span class="${classes.join(' ')}"${pill.note ? ` title="${escapeAttr(pill.note)}"` : ''}>
        <strong>${escapeHtml(pill.label)}</strong>
        <span class="dashboard-version-pill-muted">${escapeHtml(pill.ref)}</span>
        ${value}${pill.isDirty ? '<span class="dashboard-version-pill-dirty" aria-label="uncommitted changes">•</span>' : ''}
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
    const contributors = Array.isArray(snapshot.charts.contributors) ? snapshot.charts.contributors : [];
    const activeContributor = contributors.find(entry => entry.name === state.contributorFilter);
    // The commit chart follows the contributor filter; the other two timelines
    // are not per-person data, so filtering them would be a lie.
    const commitSeries = activeContributor ? activeContributor.series : snapshot.charts.commits;
    const commitTitle = activeContributor ? `Commit Activity — ${activeContributor.name}` : 'Commit Activity';

    return `
      ${pageSectionOpen('overview')}
        ${renderAttentionBand(snapshot)}
        <div class="stats-grid">
          ${stats.map(stat => renderStatCard(stat)).join('')}
        </div>
        ${renderChartRange('Activity over time')}
        ${renderContributorFilter(contributors)}
        <div class="chart-grid">
          ${renderChartCard('commits', commitTitle, activeContributor
            ? `Commits by ${activeContributor.name} across the selected time window.`
            : 'Recent git commit velocity across the selected time window.', commitSeries, 'overview')}
          ${renderChartCard('runs', 'Run Activity', 'Autonomous run updates recorded in Project Run History.', snapshot.charts.runs, 'overview')}
          ${renderChartCard('memory', 'SSOT Activity', 'Indexed memory update cadence across the current SSOT root.', snapshot.charts.memory, 'overview')}
        </div>
        ${renderWorkMixCharts(snapshot, contributors)}
        ${renderOverviewNextActions(snapshot)}
      </section>
    `;
  }

  // Contributor filter. Rendered only when more than one person shows up in the
  // window — a solo project gets no control it cannot use.
  function renderContributorFilter(contributors) {
    if (contributors.length < 2) {
      return '';
    }
    return `
      <div class="chart-range chart-range--filter">
        <div>
          <p class="section-kicker">Filter by contributor</p>
          <div class="stat-detail">Scopes the commit timeline and highlights that person's share of the work.</div>
        </div>
        <div class="segmented" role="group" aria-label="Contributor filter">
          <button type="button" data-action="contributor-filter" data-payload="" class="${state.contributorFilter ? '' : 'active'}" aria-pressed="${state.contributorFilter ? 'false' : 'true'}">Everyone</button>
          ${contributors.map(entry => `<button type="button" data-action="contributor-filter" data-payload="${escapeAttr(entry.name)}" class="${state.contributorFilter === entry.name ? 'active' : ''}" aria-pressed="${state.contributorFilter === entry.name ? 'true' : 'false'}" title="${escapeAttr(`${entry.name}: ${entry.total} commit${entry.total === 1 ? '' : 's'}`)}">${escapeHtml(entry.name)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Who did the work, and how far the releases are from done.
   *
   * All three charts read data the dashboard already has (git authorship and the
   * roadmap's release gates), so nothing here costs a model call or a new scan.
   */
  function renderWorkMixCharts(snapshot, contributors) {
    const roadmap = snapshot.roadmap || { items: [], gates: [] };
    const items = Array.isArray(roadmap.items) ? roadmap.items : [];
    const gates = Array.isArray(roadmap.gates) ? roadmap.gates : [];
    const outstanding = items.filter(item => !item.completed);
    const untagged = outstanding.filter(item => !Array.isArray(item.gates) || item.gates.length === 0).length;

    const contributorSlices = contributors.map((entry, index) => ({
      label: entry.name,
      value: entry.total,
      tone: SLICE_TONES[index % SLICE_TONES.length],
      active: state.contributorFilter === entry.name,
      action: 'contributor-filter',
      payload: entry.name,
      title: `Filter the commit timeline to ${entry.name}`,
    }));

    // Route to the release the Roadmap card is currently showing, so the two
    // surfaces agree about which gate is under discussion.
    const selectedGate = gates.find(gate => gate.id === state.activeRoadmapGate) || gates[0];
    const gateRemaining = selectedGate ? Math.max(0, selectedGate.totalCount - selectedGate.completedCount) : 0;

    const objectiveSlices = gates.map((gate, index) => ({
      label: gate.label,
      value: items.filter(item => !item.completed && Array.isArray(item.gates) && item.gates.indexOf(gate.id) >= 0).length,
      tone: SLICE_TONES[index % SLICE_TONES.length],
    }));
    if (untagged > 0) {
      objectiveSlices.push({ label: 'Untagged', value: untagged, tone: 'muted' });
    }

    return `
      <div class="chart-grid chart-grid--mix">
        <article class="chart-card">
          <div class="chart-head">
            <div>
              <p class="chart-kicker">Who did the work</p>
              <h3>Commits by contributor</h3>
              <div class="stat-detail">Last ${escapeHtml(String(Math.max(state.timescale, (snapshot.charts.commits || []).length)))} days of git history. Click a name to filter the timeline above.</div>
            </div>
          </div>
          ${renderDonutChart('contributors', contributorSlices, {
            centerValue: formatNumber(snapshot.charts.contributorTotal || 0),
            centerLabel: 'commits',
            emptyLabel: 'No commits in this window.',
          })}
        </article>
        <article class="chart-card">
          <div class="chart-head">
            <div>
              <p class="chart-kicker">Route to release</p>
              <h3>${escapeHtml(selectedGate ? `Road to ${selectedGate.label}` : 'Road to MVP')}</h3>
              <div class="stat-detail">Milestones tagged for this release, complete versus remaining.</div>
            </div>
          </div>
          ${renderDonutChart('gate-progress', [
            { label: 'Complete', value: selectedGate ? selectedGate.completedCount : 0, tone: 'good' },
            { label: 'Remaining', value: gateRemaining, tone: 'warn' },
          ], {
            centerValue: `${selectedGate ? selectedGate.progressPercent : 0}%`,
            centerLabel: 'done',
            emptyLabel: 'Nothing is tagged for this release yet.',
          })}
          <div class="tag-row">
            <button type="button" class="action-link" data-action="page" data-payload="roadmap">Open the roadmap</button>
          </div>
        </article>
        <article class="chart-card">
          <div class="chart-head">
            <div>
              <p class="chart-kicker">Outstanding objectives</p>
              <h3>Backlog by release gate</h3>
              <div class="stat-detail">${escapeHtml(`${outstanding.length} outstanding item${outstanding.length === 1 ? '' : 's'}${untagged > 0 ? `, ${untagged} not on any release` : ''}.`)}</div>
            </div>
          </div>
          ${renderDistributionBar('overview-objectives', objectiveSlices, {
            title: 'Outstanding by gate',
            caption: `${outstanding.length} open`,
            emptyLabel: 'Nothing outstanding in the backlog.',
          })}
        </article>
      </div>
    `;
  }

  /** One ownership picker shared by every actionable dashboard work record. */
  function renderDirectorOwnerControl(kind, stableId, options) {
    const snapshot = state.snapshot || {};
    const work = snapshot.workAssignments || { targets: [] };
    const target = (work.targets || []).find(entry => entry.kind === kind && entry.stableId === String(stableId));
    if (!target) { return ''; }
    const cfg = snapshot.director && snapshot.director.config;
    if (!cfg) { return ''; }
    const assignment = (cfg.assignments || []).find(entry => entry.linkedWork
      && entry.linkedWork.kind === kind && entry.linkedWork.id === String(stableId));
    const selected = assignment ? assignment.assigneeContactId || '' : '';
    const contacts = Array.isArray(cfg.contacts) ? cfg.contacts : [];
    if (contacts.length === 0) {
      return `<button type="button" class="action-link" data-action="page" data-payload="director" title="Add people in Project Director before assigning work">Add owner in Director</button>`;
    }
    const choices = [{ id: '', name: '— unassigned —' }].concat(contacts);
    const select = `<select class="work-owner-select" data-action="director-assign-work" data-target="${escapeAttr(target.token)}" aria-label="Assign an owner to ${escapeAttr(target.title)}">${choices.map(contact => `<option value="${escapeAttr(contact.id)}"${contact.id === selected ? ' selected' : ''}>${escapeHtml(contact.name)}</option>`).join('')}</select>`;
    return options && options.bare
      ? select
      : `<label class="work-owner-control"><span>Owner</span>${select}</label>`;
  }

  function applyPendingDashboardFocus() {
    const focus = state.pendingDashboardFocus;
    if (!focus || !root) { return; }
    const selector = '[data-dashboard-focus-kind="' + cssEscape(focus.kind)
      + '"][data-dashboard-focus-id="' + cssEscape(focus.id) + '"]';
    const target = root.querySelector(selector);
    if (!(target instanceof HTMLElement)) { return; }
    root.querySelectorAll('.dashboard-focus-target').forEach(item => item.classList.remove('dashboard-focus-target'));
    target.classList.add('dashboard-focus-target');
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
    announce('Focused ' + focus.kind.replace(/-/g, ' ') + ' item.');
    state.pendingDashboardFocus = null;
  }

  function renderDirectorOwnerBadge(kind, stableId) {
    const cfg = state.snapshot && state.snapshot.director && state.snapshot.director.config;
    if (!cfg) { return ''; }
    const assignment = (cfg.assignments || []).find(entry => entry.linkedWork
      && entry.linkedWork.kind === kind && entry.linkedWork.id === String(stableId));
    if (!assignment || !assignment.assigneeContactId) { return ''; }
    const owner = (cfg.contacts || []).find(contact => contact.id === assignment.assigneeContactId);
    return owner ? `<span class="tag" title="Director-assigned owner">Owner: ${escapeHtml(owner.name)}</span>` : '';
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
      ${pageSectionOpen('gapAnalysis')}
        ${renderPageIntro({
          kicker: 'Gap analysis',
          title: 'What still needs attention',
          summary: `${gap.completed ? `Last full run ${escapeHtml(gap.lastRun || 'recorded')}.` : 'Showing preliminary signal-based findings — run the full analysis for a richer report.'} ${openItems.length} open item${openItems.length === 1 ? '' : 's'} across P1–P3${praiseItems.length ? ` and ${praiseItems.length} recorded strength${praiseItems.length === 1 ? '' : 's'}` : ''}. Resolve any item in a chat, open its files, or mark it done.`,
          chips: [
            { label: openItems.length ? `${openItems.length} open` : 'No open gaps', tone: openItems.length ? 'warn' : 'good' },
            { label: `${grouped.find(g => g.priority === 'P1')?.items.length || 0} P1`, tone: (grouped.find(g => g.priority === 'P1')?.items.length || 0) > 0 ? 'critical' : 'good' },
            { label: `${praiseItems.length} strengths`, tone: 'accent' },
          ],
        })}
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Gap Analysis</p>
            <h3>Prioritized gaps, concerns, and strengths</h3>
            <div class="stat-detail">${gap.completed ? `Last run: ${escapeHtml(gap.lastRun || '')}` : 'Preliminary signal-based findings are shown below. Run the full analysis for a richer report.'}</div>
            ${renderDistributionBar('gap-priority', [
              { label: 'P1', value: openItems.filter(item => item.priority === 'P1').length, tone: 'critical' },
              { label: 'P2', value: openItems.filter(item => item.priority === 'P2').length, tone: 'warn' },
              { label: 'P3', value: openItems.filter(item => item.priority === 'P3').length, tone: 'accent' },
              { label: 'Resolved', value: gap.items.filter(item => item.resolved).length, tone: 'good' },
            ], {
              title: 'Severity mix',
              caption: `${openItems.length} open`,
              emptyLabel: 'Nothing outstanding — run the analysis to look again.',
            })}
            ${state.gapStatus ? `<div class="tag-row"><span class="tag ${state.gapBusy ? 'tag-warn' : 'tag-good'}">${escapeHtml(state.gapStatus)}</span></div>` : ''}
            <div class="tag-row">
              ${grouped.length > 0 ? grouped.map(group => renderAtlasDiscussAction('gap-group', group.priority, `Ask AtlasMind to resolve the ${group.priority} gap group`, { title: `Ask AtlasMind to resolve ${group.items.length} ${group.priority} gap-analysis item${group.items.length === 1 ? '' : 's'}` })).join('') : ''}
              <button type="button" class="action-link" data-action="gap-run" data-payload="" ${state.gapBusy ? 'disabled' : ''}>${state.gapBusy ? 'Running…' : gap.completed ? 'Re-run Analysis' : 'Run Gap Analysis'}</button>
            </div>
          </article>
          ${grouped.length > 0 ? grouped.map(group => `
            <article class="panel-card">
              <p class="section-kicker">${escapeHtml(group.priority)}</p>
              <h3>${escapeHtml(group.priority === 'P1' ? 'Highest priority' : group.priority === 'P2' ? 'Important follow-up' : 'Polish and refinement')}</h3>
              <div class="stack-list">
                ${group.items.map(item => `
                  <div class="recent-item" data-dashboard-focus-kind="gap" data-dashboard-focus-id="${escapeAttr(item.id)}">
                    <div class="row-head">
                      <strong>${escapeHtml(item.text)}</strong>
                      <span class="tag ${group.priority === 'P1' ? 'tag-critical' : group.priority === 'P2' ? 'tag-warn' : ''}">${escapeHtml(item.priority)}</span>
                    </div>
                    <div class="list-meta">${escapeHtml(formatGapCategoryLabel(item.category))} • ${escapeHtml(item.type === 'gap' ? 'Gap' : 'Concern')}</div>
                    <div class="tag-row">
                      ${renderDirectorOwnerControl('gap', item.id)}
                      ${renderAtlasDiscussAction('gap-resolve', item.id, 'Ask AtlasMind to resolve this gap', { title: 'Ask AtlasMind to inspect and resolve this gap-analysis item' })}
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

  function renderIdeation(snapshot) {
    const ideation = snapshot.ideation || {};
    const readiness = ideation.readiness || {
      activeCards: 0,
      evidenceCards: 0,
      unrealized: 0,
      contradictions: 0,
      state: 'unexamined',
      summary: 'The ideation board has not been assessed yet.',
      observations: [],
    };
    const observations = Array.isArray(readiness.observations) ? readiness.observations : [];
    const evidence = Array.isArray(ideation.availableEvidence) ? ideation.availableEvidence : [];
    const onRoadmap = Number(ideation.realizedWorkCount) || 0;
    const stateLabel = readiness.state === 'argued'
      ? 'Argument recorded'
      : readiness.state === 'developing'
        ? 'Still developing'
        : 'Not yet started';
    const stateTone = readiness.state === 'argued'
      ? 'good'
      : 'warn';
    const observationTagClass = tone => (
      tone === 'blocking' ? 'tag-critical'
        : tone === 'good' ? 'tag-good'
          : 'tag-warn'
    );
    const evidenceTagClass = tone => (
      tone === 'critical' ? 'tag-critical'
        : tone === 'warn' ? 'tag-warn'
          : tone === 'good' ? 'tag-good'
            : ''
    );

    return `
      ${pageSectionOpen('ideation')}
        ${renderPageIntro({
          kicker: 'Stage 0 — Ideation',
          title: 'Turn board notes into work you can defend',
          summary: readiness.summary || 'Read the board, bring in evidence already held by AtlasMind, then continue the conversation on the canvas.',
          chips: [
            { label: stateLabel, tone: stateTone },
            { label: `${Number(readiness.activeCards) || 0} active cards`, tone: 'accent' },
            { label: `${onRoadmap} on roadmap`, tone: onRoadmap > 0 ? 'good' : 'warn' },
          ],
          action: { command: 'atlasmind.openProjectIdeation', hint: 'Open the canvas' },
          actionLabel: 'Open canvas',
        })}
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Board state</p>
            <h3>What is on the board</h3>
            <div class="metric-pills">
              ${renderMetricPill('On board', String(Number(readiness.activeCards) || 0), { tone: (Number(readiness.activeCards) || 0) > 0 ? 'accent' : 'warn' })}
              ${renderMetricPill('Not yet work', String(Number(readiness.unrealized) || 0), { tone: (Number(readiness.unrealized) || 0) > 0 ? 'warn' : 'good' })}
              ${renderMetricPill('On roadmap', String(onRoadmap), { tone: onRoadmap > 0 ? 'good' : 'warn' })}
              ${renderMetricPill('Contradictions', String(Number(readiness.contradictions) || 0), { tone: (Number(readiness.contradictions) || 0) > 0 ? 'critical' : 'good' })}
            </div>
            <div class="stat-detail">${escapeHtml(readiness.summary || '')}</div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Needs attention</p>
            <h3>What the board cannot yet defend</h3>
            <div class="stack-list">
              ${observations.length > 0 ? observations.map(observation => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(observation.label || 'Board observation')}</strong>
                    <span class="tag ${observationTagClass(observation.tone)}">${escapeHtml(observation.tone || 'needs review')}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(observation.detail || '')}</div>
                  <div class="stat-detail">Rule: ${escapeHtml(observation.rule || 'No rule recorded.')}</div>
                </div>
              `).join('') : '<div class="dashboard-empty">No readiness observations are available yet.</div>'}
            </div>
          </article>
        </div>
        <article class="panel-card">
          <p class="section-kicker">Existing evidence</p>
          <h3>Bring project evidence into the board</h3>
          <div class="stat-detail">These records come from the registers that already own them. Adding one opens the canvas and creates an evidence card; it never starts a new scan.</div>
          <div class="stack-list">
            ${evidence.length > 0 ? evidence.map(item => `
              <div class="recent-item">
                <div class="row-head">
                  <strong>${escapeHtml(item.title || 'Existing evidence')}</strong>
                  <span class="tag ${evidenceTagClass(item.tone)}">${escapeHtml(item.sourceLabel || 'AtlasMind')}</span>
                </div>
                <div class="list-meta">${escapeHtml(item.detail || '')}</div>
                <div class="tag-row">
                  <button type="button" class="action-link primary" data-action="ideation-evidence" data-payload="${escapeAttr(item.id || '')}">Add evidence card</button>
                  <button type="button" class="action-link" data-action="page" data-payload="${escapeAttr(item.pageTarget || 'overview')}">View source</button>
                </div>
              </div>
            `).join('') : '<div class="dashboard-empty">No unresolved register evidence is available right now. This page did not run a scan to reach that result.</div>'}
          </div>
        </article>
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

    const outcome = snapshot.score.outcome;
    const roadmapPercent = outcome.roadmapTotal > 0 ? Math.round((outcome.roadmapCompleted / outcome.roadmapTotal) * 100) : 0;
    const componentNodes = snapshot.score.components.map(component => ({
      label: component.label,
      sub: `${component.score}/${component.maxScore}`,
      status: component.tone === 'good' ? 'good' : component.tone === 'critical' ? 'critical' : component.tone === 'accent' ? 'active' : 'warn',
      icon: component.tone === 'good' ? '✓' : component.tone === 'critical' ? '✕' : '•',
      title: component.detail,
    }));
    return `
      ${pageSectionOpen('score')}
        ${renderPageIntro({
          kicker: 'Operational score',
          title: `${snapshot.healthScore}/100 — where the project stands`,
          summary: `${snapshot.healthSummary} Outcome completeness is at ${outcome.score}%. Every component and signal below clicks through to the page that can move it.`,
          chips: [
            { label: `Operational ${snapshot.healthScore}`, tone: snapshot.healthScore >= 85 ? 'good' : snapshot.healthScore >= 65 ? 'accent' : 'warn' },
            { label: `Outcome ${outcome.score}%`, tone: outcome.score >= 75 ? 'good' : outcome.score >= 55 ? 'accent' : 'warn' },
          ],
        })}
        ${componentNodes.length > 0 ? `<article class="panel-card"><p class="section-kicker">Composition</p><h3>How the score breaks down</h3>${renderFlowStrip(componentNodes)}</article>` : ''}
        <div class="panel-grid score-summary-grid">
          <article class="panel-card score-overview-card">
            <p class="section-kicker">Operational score</p>
            <h3>${escapeHtml(String(snapshot.healthScore))}/100</h3>
            <div class="stat-detail">${escapeHtml(snapshot.healthSummary)}</div>
            <div class="tag-row">
              <span class="tag ${snapshot.healthScore >= 85 ? 'tag-good' : snapshot.healthScore >= 65 ? '' : 'tag-warn'}">Operational ${escapeHtml(String(snapshot.healthScore))}</span>
              <span class="tag ${outcome.score >= 75 ? 'tag-good' : outcome.score >= 55 ? '' : 'tag-warn'}">Outcome completeness ${escapeHtml(String(outcome.score))}%</span>
            </div>
          </article>
          <article class="panel-card score-outcome-card">
            <p class="section-kicker">Desired outcome</p>
            <h3>What the project says it is trying to become</h3>
            <div class="stat-detail">${escapeHtml(outcome.desiredOutcome)}</div>
            <div class="mini-grid">
              ${renderMetricPill('References resolved', `${outcome.referenceCoveragePercent}%`, { tone: outcome.referenceCoveragePercent >= 100 ? 'good' : outcome.referenceCoveragePercent >= 60 ? 'accent' : 'warn', meter: outcome.referenceCoveragePercent, action: { page: 'ssot', hint: 'Go to SSOT' } })}
              ${renderMetricPill('Roadmap progress', outcome.roadmapTotal > 0 ? `${outcome.roadmapCompleted}/${outcome.roadmapTotal}` : 'No tracked items', { tone: outcome.roadmapTotal === 0 ? 'warn' : roadmapPercent >= 50 ? 'good' : 'accent', meter: roadmapPercent, action: { page: 'roadmap', hint: 'Go to Roadmap' } })}
              ${renderMetricPill('Run completion', `${outcome.runCompletionPercent}%`, { tone: outcome.runCompletionPercent >= 75 ? 'good' : outcome.runCompletionPercent >= 40 ? 'accent' : 'warn', meter: outcome.runCompletionPercent, action: { page: 'runtime', hint: 'Go to Runtime' } })}
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

  function renderBranches(snapshot) {
    const branches = snapshot.branches || {
      items: [],
      localCount: 0,
      remoteOnlyCount: 0,
      staleCount: 0,
      divergedCount: 0,
      checkedOutElsewhereCount: 0,
    };
    const items = Array.isArray(branches.items) ? branches.items : [];
    const githubRefreshing = state.repositoryRefreshBusy;
    const query = String(state.branchSearch || '').trim().toLowerCase();
    const filter = state.branchFilter || 'all';
    const view = ['mine', 'needs-my-review', 'ready', 'ci-failing', 'cleanup'].includes(state.branchView)
      ? state.branchView : 'all';
    const filtered = items.filter(branch => {
      const insight = branch.insight || {};
      const savedViews = Array.isArray(insight.savedViews) ? insight.savedViews : [];
      if (filter === 'local' && !branch.localRef) { return false; }
      if (filter === 'remote' && branch.localRef) { return false; }
      if (filter === 'stale' && !branch.stale) { return false; }
      if (filter === 'attention' && !['ahead', 'behind', 'diverged', 'upstream-gone', 'name-conflict'].includes(branch.status)
        && !(branch.ahead > 0 || branch.behind > 0) && !branch.checkedOutElsewhere
        && !['attention', 'blocked'].includes((insight.readiness || {}).level)) { return false; }
      if (filter === 'merged' && !branch.mergedIntoCurrent) { return false; }
      if (view !== 'all' && !savedViews.includes(view)) { return false; }
      if (!query) { return true; }
      return [
        branch.name,
        branch.subject,
        branch.author,
        branch.upstream,
        branch.remoteRef,
        branch.hash,
        (insight.pullRequest || {}).title,
        (insight.pullRequest || {}).author,
        (insight.readiness || {}).label,
        (insight.ci || {}).label,
      ].some(value => String(value || '').toLowerCase().includes(query));
    });
    const sorted = filtered.slice().sort((left, right) =>
      compareBranchCards(left, right, state.branchSort, state.branchSortDirection));
    const dirty = Boolean(snapshot.repo && snapshot.repo.dirty);
    const attentionCount = items.filter(branch =>
      ['ahead', 'behind', 'diverged', 'upstream-gone', 'name-conflict'].includes(branch.status)
      || branch.ahead > 0 || branch.behind > 0 || branch.checkedOutElsewhere
      || ['attention', 'blocked'].includes((((branch.insight || {}).readiness) || {}).level)).length;
    const mergedCount = items.filter(branch => branch.mergedIntoCurrent).length;
    const compareNames = state.branchCompareIds.map(id => (items.find(branch => branch.id === id) || {}).name).filter(Boolean);
    const allVisibleExpanded = sorted.length > 0
      && sorted.every(branch => state.branchExpandedIds.includes(branch.id));

    return `
      ${pageSectionOpen('branches')}
        ${renderPageIntro({
          kicker: 'Git branches',
          title: 'Every branch, with the evidence to decide',
          summary: `${items.length} logical branch${items.length === 1 ? '' : 'es'} across ${branches.localCount} local and ${branches.remoteOnlyCount} remote-only ref${branches.remoteOnlyCount === 1 ? '' : 's'}. Readiness is derived from declared rules over local Git plus the last explicitly loaded GitHub activity; it is never a model score. ${dirty ? 'The working tree has pending changes, so branch switching is paused.' : 'The working tree is clean, so another branch can be brought local safely.'}`,
          chips: [
            { label: `${branches.readyCount || 0} ready`, tone: branches.readyCount ? 'good' : undefined },
            { label: `${branches.blockedCount || 0} blocked`, tone: branches.blockedCount ? 'critical' : 'good' },
            { label: `${branches.ciFailingCount || 0} CI failing`, tone: branches.ciFailingCount ? 'critical' : 'good' },
            { label: `${branches.cleanupCount || 0} cleanup candidates`, tone: branches.cleanupCount ? 'accent' : undefined },
          ],
        })}
        ${branches.githubLoaded ? '' : `
          <div class="inline-notice warning branch-review-source">
            <div><strong>GitHub readiness is not loaded.</strong> PR, requested-reviewer, and CI facts remain unknown rather than being treated as clear.</div>
            ${renderRefreshAction('branch-review-refresh', 'Refresh GitHub activity', githubRefreshing, { busyLabel: 'Refreshing GitHub…' })}
          </div>
        `}
        ${state.branchOperationStatus ? `<div class="inline-notice branch-operation-status">${escapeHtml(state.branchOperationStatus)}</div>` : ''}
        <article class="panel-card branch-inventory-controls">
          <div>
            <p class="section-kicker">Decision views</p>
            <h3>Find the branch that needs you</h3>
            <p class="section-copy">The built-in views remember their last selection. Tracked local and remote refs are folded into one card; no view fetches or changes Git by itself.</p>
          </div>
          <div class="branch-control-actions">
            ${renderRefreshAction('branch-fetch', 'Fetch latest from remotes', state.branchFetchBusy, { busyLabel: 'Fetching remotes…' })}
            ${renderRefreshAction('branch-review-refresh', 'Refresh PR & CI', githubRefreshing, { busyLabel: 'Refreshing PR & CI…' })}
            <button type="button" class="action-link" data-action="command" data-payload="workbench.view.scm">Open Source Control</button>
          </div>
          <div>
            <span class="dashboard-search-label">Saved views</span>
            <div class="segmented-control branch-filter-control" role="group" aria-label="Saved branch views">
              ${[
                ['all', `All (${items.length})`],
                ['mine', `My branches (${branches.mineCount || 0})`],
                ['needs-my-review', `Needs my review (${branches.needsMyReviewCount || 0})`],
                ['ready', `Ready (${branches.readyCount || 0})`],
                ['ci-failing', `CI failing (${branches.ciFailingCount || 0})`],
                ['cleanup', `Cleanup (${branches.cleanupCount || 0})`],
              ].map(entry => `<button type="button" data-action="branch-view" data-payload="${entry[0]}" class="${view === entry[0] ? 'active' : ''}" aria-pressed="${view === entry[0] ? 'true' : 'false'}">${escapeHtml(entry[1])}</button>`).join('')}
            </div>
          </div>
          <label class="dashboard-search-label" for="branch-search-input">Search branches</label>
          <input id="branch-search-input" class="ideation-input" type="search" value="${escapeAttr(state.branchSearch || '')}" placeholder="Name, author, PR, readiness, commit, upstream…" autocomplete="off" />
          <div class="branch-view-controls">
            <div>
              <span class="dashboard-search-label">Scope</span>
              <div class="segmented-control branch-filter-control" role="group" aria-label="Filter branches">
                ${[
                  ['all', `All (${items.length})`],
                  ['local', `Local (${branches.localCount})`],
                  ['remote', `Remote only (${branches.remoteOnlyCount})`],
                  ['attention', `Attention (${attentionCount})`],
                  ['stale', `Stale (${branches.staleCount})`],
                  ['merged', `Merged (${mergedCount})`],
                ].map(entry => `<button type="button" data-action="branch-filter" data-payload="${entry[0]}" class="${filter === entry[0] ? 'active' : ''}" aria-pressed="${filter === entry[0] ? 'true' : 'false'}">${escapeHtml(entry[1])}</button>`).join('')}
              </div>
            </div>
            <label>Sort
              <select id="branch-sort-select" class="compact-select">
                ${[
                  ['activity', 'Recent activity'],
                  ['readiness', 'Risk & readiness'],
                  ['drift', 'Branch drift'],
                  ['name', 'Name'],
                ].map(entry => `<option value="${entry[0]}" ${state.branchSort === entry[0] ? 'selected' : ''}>${entry[1]}</option>`).join('')}
              </select>
            </label>
            <label>Order
              <select id="branch-sort-direction-select" class="compact-select">
                ${branchSortDirectionOptions(state.branchSort).map(entry => `<option value="${entry[0]}" ${state.branchSortDirection === entry[0] ? 'selected' : ''}>${entry[1]}</option>`).join('')}
              </select>
            </label>
            <label>Group
              <select id="branch-group-select" class="compact-select">
                ${[
                  ['none', 'No grouping'],
                  ['readiness', 'Readiness'],
                  ['pull-request', 'Pull request'],
                  ['branch-family', 'Branch family'],
                ].map(entry => `<option value="${entry[0]}" ${state.branchGroup === entry[0] ? 'selected' : ''}>${entry[1]}</option>`).join('')}
              </select>
            </label>
          </div>
          ${dirty ? '<div class="inline-notice warning"><strong>Switching paused.</strong> Commit, stash, or discard the current changes first. AtlasMind will not carry them onto another branch.</div>' : ''}
        </article>
        <article class="panel-card branch-compare-toolbar">
          <div>
            <p class="section-kicker">Two-branch comparison</p>
            <h3>${compareNames.length === 0 ? 'Choose any two branch cards' : escapeHtml(compareNames.join(' ↔ '))}</h3>
            <p class="section-copy">The comparison uses a shared merge base and reports unique commits, changed paths, overlap, areas, and contributors. File overlap is never labelled a conflict.</p>
          </div>
          <div class="branch-control-actions">
            <button type="button" class="action-link primary" data-action="branch-compare-run" ${state.branchCompareIds.length === 2 ? '' : 'disabled'}>Compare selected (${state.branchCompareIds.length}/2)</button>
            <button type="button" class="action-link" data-action="branch-compare-clear" ${state.branchCompareIds.length ? '' : 'disabled'}>Clear</button>
          </div>
        </article>
        ${renderBranchComparison(state.branchComparison)}
        <div class="branch-card-display-controls" aria-label="Branch card display">
          <div>
            <span class="dashboard-search-label">Branch card display</span>
            <p id="branch-chip-help" class="section-copy">Cards start compact. SCM colours use theme blue for local branches and theme purple for remote-only branches.</p>
          </div>
          <div class="branch-control-actions">
            <div class="branch-chip-preview" aria-hidden="true">
              <span class="branch-title-chip is-local"><span>⎇</span> Local</span>
              <span class="branch-title-chip is-remote"><span>☁</span> Remote</span>
            </div>
            <label class="branch-chip-toggle" for="branch-scm-chip-toggle">
              <input id="branch-scm-chip-toggle" type="checkbox" aria-describedby="branch-chip-help" ${state.branchScmChips ? 'checked' : ''} />
              Show SCM colours
            </label>
            <button type="button" class="action-link" data-action="branch-toggle-all" ${sorted.length ? '' : 'disabled'}>${allVisibleExpanded ? 'Collapse all' : 'Expand all'}</button>
          </div>
        </div>
        ${sorted.length > 0
          ? renderBranchGroups(sorted, dirty, state.branchGroup)
          : `<div class="dashboard-empty"><div><strong>No branches match this view</strong><p class="section-copy">${items.length === 0 ? 'No local or cached remote refs were found.' : 'Clear the search or choose another saved view, scope, or filter.'}</p></div></div>`}
      </section>
    `;
  }

  function branchSortDirectionOptions(sort) {
    if (sort === 'name') {
      return [['asc', 'A → Z'], ['desc', 'Z → A']];
    }
    if (sort === 'readiness') {
      return [['desc', 'Highest risk first'], ['asc', 'Lowest risk first']];
    }
    if (sort === 'drift') {
      return [['desc', 'Most drift first'], ['asc', 'Least drift first']];
    }
    return [['desc', 'Newest first'], ['asc', 'Oldest first']];
  }

  function compareBranchCards(left, right, sort, direction) {
    const leftInsight = left.insight || {};
    const rightInsight = right.insight || {};
    const order = direction === 'asc' ? 1 : -1;
    if (sort === 'readiness') {
      return order * (Number(leftInsight.riskRank || 0) - Number(rightInsight.riskRank || 0))
        || (Date.parse(right.lastCommitAt) || 0) - (Date.parse(left.lastCommitAt) || 0)
        || String(left.name).localeCompare(String(right.name));
    }
    if (sort === 'drift') {
      return order * (
        (Number(left.ahead || 0) + Number(left.behind || 0))
        - (Number(right.ahead || 0) + Number(right.behind || 0))
      )
        || Number(rightInsight.riskRank || 0) - Number(leftInsight.riskRank || 0)
        || String(left.name).localeCompare(String(right.name));
    }
    if (sort === 'name') {
      return order * String(left.name).localeCompare(String(right.name));
    }
    return order * ((Date.parse(left.lastCommitAt) || 0) - (Date.parse(right.lastCommitAt) || 0))
      || String(left.name).localeCompare(String(right.name));
  }

  function branchGroupOf(branch, grouping) {
    const insight = branch.insight || {};
    if (grouping === 'readiness') {
      const readiness = insight.readiness || {};
      return {
        key: readiness.level || 'unknown',
        label: readiness.label || 'Not assessed',
        order: ({ blocked: 0, attention: 1, ready: 2, retired: 3, baseline: 4 })[readiness.level] ?? 5,
      };
    }
    if (grouping === 'pull-request') {
      const pr = insight.pullRequest;
      return pr
        ? { key: pr.state || 'open', label: pr.state === 'draft' ? 'Draft pull request' : `${String(pr.state || 'open').replace('-', ' ')} pull request`, order: pr.state === 'open' ? 0 : pr.state === 'draft' ? 1 : pr.state === 'merged' ? 2 : 3 }
        : { key: 'none', label: 'No linked pull request', order: 4 };
    }
    if (grouping === 'branch-family') {
      const name = String(branch.name || '');
      const slash = name.indexOf('/');
      if (slash < 1) {
        return { key: 'root', label: 'Root branches', order: 0 };
      }
      const family = name.slice(0, slash).toLowerCase();
      const label = `${family.charAt(0).toUpperCase()}${family.slice(1)} branches`;
      return { key: `family:${family}`, label, order: 1 };
    }
    return { key: 'all', label: '', order: 0 };
  }

  function renderBranchGroups(branches, dirty, grouping) {
    if (grouping === 'none') {
      return `<div class="branch-inventory-grid">${branches.map(branch => renderBranchInventoryCard(branch, dirty)).join('')}</div>`;
    }
    const groups = new Map();
    branches.forEach(branch => {
      const group = branchGroupOf(branch, grouping);
      if (!groups.has(group.key)) {
        groups.set(group.key, { ...group, branches: [] });
      }
      groups.get(group.key).branches.push(branch);
    });
    return [...groups.values()]
      .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
      .map(group => `
        <section class="branch-group" aria-label="${escapeAttr(group.label)}">
          <div class="branch-group-head"><h3>${escapeHtml(group.label)}</h3><span class="tag">${group.branches.length}</span></div>
          <div class="branch-inventory-grid">${group.branches.map(branch => renderBranchInventoryCard(branch, dirty)).join('')}</div>
        </section>
      `).join('');
  }

  function renderBranchComparison(comparison) {
    if (!comparison) { return ''; }
    const countList = items => (items || []).length > 0
      ? items.map(item => `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(String(item.count))}</strong></li>`).join('')
      : '<li><span>No changed area in the bounded reading</span></li>';
    const contributorList = items => (items || []).length > 0
      ? items.map(item => `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(String(item.commits))}</strong></li>`).join('')
      : '<li><span>No contributor record in the bounded history</span></li>';
    return `
      <article class="panel-card branch-review-result branch-comparison-result">
        <div class="row-head">
          <div><p class="section-kicker">Comparison result</p><h3>${escapeHtml(comparison.leftName)} ↔ ${escapeHtml(comparison.rightName)}</h3></div>
          <span class="tag mono">base ${escapeHtml(comparison.mergeBase || 'unknown')}</span>
        </div>
        <div class="mini-grid">
          ${renderMetricPill(`${comparison.leftName} only`, `${comparison.leftOnlyCommits} commits`, { tone: comparison.leftOnlyCommits ? 'accent' : 'good' })}
          ${renderMetricPill(`${comparison.rightName} only`, `${comparison.rightOnlyCommits} commits`, { tone: comparison.rightOnlyCommits ? 'accent' : 'good' })}
          ${renderMetricPill('Changed-file overlap', `${comparison.overlappingFiles}`, { tone: comparison.overlappingFiles ? 'warn' : 'good' })}
        </div>
        <div class="branch-evidence-grid">
          <div><h4>${escapeHtml(comparison.leftName)} areas · ${comparison.leftChangedFiles} files</h4><ul>${countList(comparison.leftAreas)}</ul></div>
          <div><h4>${escapeHtml(comparison.rightName)} areas · ${comparison.rightChangedFiles} files</h4><ul>${countList(comparison.rightAreas)}</ul></div>
          <div><h4>${escapeHtml(comparison.leftName)} contributors</h4><ul>${contributorList(comparison.leftContributors)}</ul></div>
          <div><h4>${escapeHtml(comparison.rightName)} contributors</h4><ul>${contributorList(comparison.rightContributors)}</ul></div>
        </div>
        <ul class="branch-notices">${(comparison.notices || []).map(notice => `<li>${escapeHtml(notice)}</li>`).join('')}</ul>
      </article>
    `;
  }

  function renderBranchInspection(inspection) {
    if (!inspection) { return ''; }
    const countList = items => (items || []).length > 0
      ? items.map(item => `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(String(item.count))}</strong></li>`).join('')
      : '<li><span>No evidence in this category</span></li>';
    return `
      <article class="panel-card branch-review-result" aria-label="Review details for ${escapeAttr(inspection.branchName)}">
        <div class="row-head">
          <div><p class="section-kicker">Review details</p><h3>${escapeHtml(inspection.branchName)}</h3></div>
          <div class="branch-control-actions">
            <span class="tag">${escapeHtml(String(inspection.changedFileCount))} changed files${inspection.changedFilesTruncated ? ' · partial' : ''}</span>
            <button type="button" class="action-link" data-action="branch-inspection-close" data-payload="${escapeAttr(inspection.branchId || '')}">Close</button>
          </div>
        </div>
        <p class="section-copy">${escapeHtml(inspection.ownershipSummary || '')}</p>
        <div class="branch-evidence-grid">
          <div><h4>Changed areas</h4><ul>${countList(inspection.changedAreas)}</ul></div>
          <div><h4>Impact signals</h4><ul>${countList(inspection.impactCategories)}</ul></div>
          <div><h4>Review routing</h4><ul>${(inspection.reviewRouting || []).length > 0 ? inspection.reviewRouting.map(route => `<li>${escapeHtml(route)}</li>`).join('') : '<li>No declared or historical route was available.</li>'}</ul></div>
          <div><h4>Recent contributors</h4><ul>${(inspection.contributors || []).length > 0 ? inspection.contributors.map(person => `<li><span>${escapeHtml(person.name)}</span><strong>${escapeHtml(String(person.commits))}</strong></li>`).join('') : '<li>No contributor record in the bounded history.</li>'}</ul></div>
        </div>
        <ul class="branch-notices">${(inspection.notices || []).map(notice => `<li>${escapeHtml(notice)}</li>`).join('')}</ul>
      </article>
    `;
  }

  function renderBranchInventoryCard(branch, dirty) {
    const warningStatuses = ['behind'];
    const criticalStatuses = ['diverged', 'upstream-gone', 'name-conflict'];
    const statusClass = branch.status === 'current' || branch.status === 'synced'
      ? 'tag-good'
      : criticalStatuses.includes(branch.status)
        ? 'tag-critical'
        : warningStatuses.includes(branch.status) || branch.stale
        ? 'tag-warn'
        : '';
    const canActivate = Boolean(branch.canActivate) && !dirty && !branch.current && !state.branchWorkflowBusyId;
    const disabledReason = dirty
      ? 'Commit, stash, or discard pending changes before switching.'
      : branch.blocker || (branch.current ? 'This is already the current branch.' : '');
    const location = branch.localRef
      ? (branch.remoteRef ? `Local · ${branch.remoteRef}` : 'Local only')
      : `Remote only · ${branch.remoteRef || 'cached ref'}`;
    const tracking = branch.upstream
      ? `<span class="tag mono">tracks ${escapeHtml(branch.upstream)}</span>`
      : branch.remoteRef && branch.localRef
        ? '<span class="tag tag-warn">remote match, not tracking</span>'
        : '';
    const insight = branch.insight || {};
    const readiness = insight.readiness || { level: 'attention', label: 'Not assessed', summary: 'No readiness reading is available.' };
    const readinessClass = readiness.level === 'ready' || readiness.level === 'retired' || readiness.level === 'baseline'
      ? 'tag-good'
      : readiness.level === 'blocked'
        ? 'tag-critical'
        : readiness.level === 'attention' ? 'tag-warn' : '';
    const ci = insight.ci || { state: 'unknown', label: 'CI not loaded' };
    const ciClass = ci.state === 'pass' ? 'tag-good' : ci.state === 'fail' ? 'tag-critical' : ci.state === 'pending' ? 'tag-warn' : '';
    const traceability = insight.traceability || { state: 'not-assessed', summary: 'Traceability not assessed.' };
    const traceClass = traceability.state === 'linked' ? 'tag-good' : traceability.state === 'missing' ? 'tag-warn' : '';
    const pullRequest = insight.pullRequest;
    const compareSelected = state.branchCompareIds.includes(branch.id);
    const reasons = Array.isArray(readiness.reasons) ? readiness.reasons.slice(0, 3) : [];
    const expanded = state.branchExpandedIds.includes(branch.id);
    const hasFailure = ci.state === 'fail'
      || readiness.level === 'blocked'
      || criticalStatuses.includes(branch.status)
      || pullRequest?.reviewDecision === 'changes-requested'
      || pullRequest?.mergeable === 'conflicting'
      || Number(pullRequest?.unresolvedReviewComments || 0) > 0;
    const branchTitleClass = state.branchScmChips
      ? ` branch-title-chip ${branch.localRef ? 'is-local' : 'is-remote'}`
      : '';
    const branchTitleIcon = branch.localRef ? '⎇' : '☁';
    const inspection = state.branchInspection && state.branchInspection.branchId === branch.id
      ? state.branchInspection
      : null;
    const inspectionBusy = state.branchInspectionBusyId === branch.id;
    const workflowLocked = Boolean(state.branchWorkflowBusyId);
    const workflowBusyForBranch = state.branchWorkflowBusyId === branch.id;
    const workflowButton = (action, icon, label, enabled, title) => {
      const busy = workflowBusyForBranch && state.branchWorkflowBusyAction === action;
      const disabled = workflowLocked || !enabled;
      return `<button type="button" class="action-link branch-icon-action${busy ? ' is-refreshing' : ''}" data-action="branch-workflow" data-workflow="${escapeAttr(action)}" data-payload="${escapeAttr(branch.id || '')}" title="${escapeAttr(`${label} — ${title}`)}" aria-label="${escapeAttr(`${label}. ${title}`)}" aria-busy="${busy ? 'true' : 'false'}" ${disabled ? 'disabled' : ''}><span aria-hidden="true">${escapeHtml(busy ? '…' : icon)}</span></button>`;
    };
    const subject = branch.subject || 'No commit subject available.';

    return `
      <div class="branch-inventory-item">
        <article class="panel-card branch-inventory-card${branch.current ? ' is-current' : ''}${compareSelected ? ' is-compare-selected' : ''}${expanded ? ' is-expanded' : ''}${hasFailure ? ' has-failure' : ''}" data-branch-id="${escapeAttr(branch.id || '')}" data-dashboard-focus-kind="branch" data-dashboard-focus-id="${escapeAttr(branch.name || '')}">
          <button type="button" class="branch-card-summary" data-action="branch-card-toggle" data-payload="${escapeAttr(branch.id || '')}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="branch-details-${escapeAttr(branch.id || '')}" aria-label="${expanded ? 'Collapse' : 'Expand'} details for ${escapeAttr(branch.name)}">
            <div class="row-head branch-card-head">
              <div>
                <p class="section-kicker">${escapeHtml(location)}</p>
                <h3 class="branch-title${branchTitleClass}">${state.branchScmChips ? `<span aria-hidden="true">${branchTitleIcon}</span>` : ''}${escapeHtml(branch.name)}</h3>
              </div>
              <span class="tag ${statusClass}">${escapeHtml(branch.statusLabel)}</span>
            </div>
            <div class="branch-readiness-row">
              <span class="tag ${readinessClass}" title="${escapeAttr(readiness.summary || '')}">${escapeHtml(readiness.label || 'Not assessed')}</span>
              <span class="tag ${ciClass}" title="${escapeAttr(ci.source === 'not-loaded' ? 'Refresh GitHub activity to load per-branch CI.' : 'Latest check per workflow or PR check rollup.')}">${escapeHtml(ci.label || 'CI unknown')}</span>
              <span class="tag ${traceClass}" title="${escapeAttr(traceability.summary || '')}">${traceability.state === 'linked' ? 'Traceability linked' : traceability.state === 'inferred' ? 'Traceability inferred' : traceability.state === 'missing' ? 'Traceability gap' : 'Traceability unknown'}</span>
              ${renderDirectorOwnerBadge('branch', branch.name)}
            </div>
            <p class="branch-subject" title="${escapeAttr(subject)}">${escapeHtml(subject)}</p>
            <div class="branch-compact-footer">
              <div class="branch-commit-meta">
                <span>${escapeHtml(branch.author || 'Unknown author')}</span>
                <span>${escapeHtml(branch.lastCommitRelative || 'Unknown date')}</span>
              </div>
              <span class="branch-expand-hint" aria-hidden="true">${expanded ? '▲ Compact' : '▼ Full details'}</span>
            </div>
          </button>
          ${expanded ? `
            <div id="branch-details-${escapeAttr(branch.id || '')}" class="branch-card-details">
              <div class="tag-row">
                ${branch.current ? '<span class="tag tag-good">● current</span>' : ''}
                ${branch.default ? '<span class="tag">default</span>' : ''}
                ${branch.protected ? '<span class="tag tag-warn">protected</span>' : ''}
                ${branch.checkedOutElsewhere ? '<span class="tag tag-warn">another worktree</span>' : ''}
                ${branch.mergedIntoCurrent ? '<span class="tag tag-good">merged into current</span>' : ''}
                ${branch.stale ? `<span class="tag tag-warn">stale · ${escapeHtml(branch.lastCommitRelative)}</span>` : ''}
                ${insight.isMine ? '<span class="tag">mine</span>' : ''}
                ${insight.needsMyReview ? '<span class="tag tag-warn">needs my review</span>' : ''}
              </div>
              <div class="branch-commit-meta">
                <span class="mono">${escapeHtml(branch.hash || '—')}</span>
                <span>${escapeHtml(branch.author || 'Unknown author')}</span>
                <span>${escapeHtml(branch.lastCommitRelative || 'Unknown date')}</span>
              </div>
              <div class="tag-row">
                ${tracking}
                ${branch.ahead ? `<span class="tag">${escapeHtml(String(branch.ahead))} ahead</span>` : ''}
                ${branch.behind ? `<span class="tag tag-warn">${escapeHtml(String(branch.behind))} behind</span>` : ''}
              </div>
              ${pullRequest ? `
                <div class="branch-pr-summary">
                  <div><strong>PR #${escapeHtml(String(pullRequest.number))}</strong> · ${escapeHtml(pullRequest.state)} → ${escapeHtml(pullRequest.baseRefName || 'base')}</div>
                  <div>${escapeHtml(pullRequest.title || 'Untitled pull request')}</div>
                  <div class="tag-row">
                    <span class="tag ${pullRequest.reviewDecision === 'approved' ? 'tag-good' : pullRequest.reviewDecision === 'changes-requested' ? 'tag-critical' : ''}">${escapeHtml(String(pullRequest.reviewDecision || 'review unknown').replace('-', ' '))}</span>
                    <span class="tag ${pullRequest.mergeable === 'conflicting' ? 'tag-critical' : pullRequest.mergeable === 'mergeable' ? 'tag-good' : ''}">${escapeHtml(pullRequest.mergeable || 'mergeability unknown')}</span>
                    ${pullRequest.unresolvedReviewComments ? `<span class="tag tag-critical">${pullRequest.unresolvedReviewComments} unresolved comments</span>` : ''}
                  </div>
                </div>
              ` : `<p class="stat-detail">${branchesGithubState(branch)}.</p>`}
              <p class="branch-trace-summary"><strong>Tracking:</strong> ${escapeHtml(traceability.summary || 'Not assessed.')}
                ${(traceability.issueTitles || []).slice(0, 2).map(title => `<span class="tag">${escapeHtml(title)}</span>`).join('')}
                ${(traceability.roadmapItems || []).slice(0, 1).map(item => `<span class="tag" title="${escapeAttr(item)}">Roadmap linked</span>`).join('')}
              </p>
              ${reasons.length > 0 ? `<ul class="branch-readiness-reasons">${reasons.map(reason => `<li class="reason-${escapeAttr(reason.level)}"><strong>${escapeHtml(reason.label)}</strong> — ${escapeHtml(reason.detail)}</li>`).join('')}</ul>` : ''}
              <div class="branch-action-stack">
                <div class="branch-action-group" role="group" aria-label="Work on ${escapeAttr(branch.name)}">
                  <span class="branch-action-label">Work</span>
                  <div class="branch-action-content">
                    ${renderDirectorOwnerControl('branch', branch.name)}
                    <div class="branch-card-actions branch-work-actions">
                      <button type="button" class="action-link branch-icon-action${canActivate ? ' primary' : ''}" data-action="branch-activate" data-payload="${escapeAttr(branch.id || '')}" ${canActivate ? '' : 'disabled'} title="${escapeAttr(branch.current ? 'Current branch — this branch is already active in the workspace.' : `Work on this branch — ${disabledReason || `${branch.activationLabel} for immediate work.`}`)}" aria-label="${escapeAttr(branch.current ? 'Current branch. This branch is already active in the workspace.' : `Work on this branch. ${disabledReason || `${branch.activationLabel} for immediate work.`}`)}"><span aria-hidden="true">⎇</span></button>
                      ${workflowButton('commit', '●', 'Commit', Boolean(branch.current && dirty), branch.current ? (dirty ? `Review, stage, and commit the pending changes on ${branch.name} in Source Control.` : 'There are no pending changes to commit.') : 'Work on this branch before committing to it.')}
                      ${workflowButton('pull', '↓', 'Pull', Boolean(branch.current && branch.localRef && branch.upstream && branch.status !== 'upstream-gone' && !dirty && !(branch.ahead > 0 && branch.behind > 0)), branch.current ? (branch.status === 'upstream-gone' ? 'The configured upstream no longer exists; publish again or choose a new upstream.' : branch.upstream ? 'Pull with a fast-forward-only guard; AtlasMind never chooses merge or rebase for you.' : 'This branch has no configured upstream.') : 'Work on this branch before pulling into it.')}
                      ${workflowButton('push', '↑', branch.upstream ? 'Push' : 'Publish', Boolean(branch.current && branch.localRef && branch.behind === 0), branch.current ? (branch.behind > 0 ? 'Pull or reconcile the cached remote commits before pushing.' : 'Push this branch without force; publishing also configures its upstream.') : 'Work on this branch before pushing it.')}
                      ${workflowButton('create-branch', '+⎇', 'Branch from here', Boolean(branch.localRef || branch.remoteRef), `Create a new local branch at ${branch.name}'s current commit without switching the workspace.`)}
                      ${pullRequest ? '' : workflowButton('create-pull-request', '⇄', 'Create pull request', Boolean(branch.localRef && (branch.upstream || branch.remoteRef)), branch.localRef && (branch.upstream || branch.remoteRef) ? 'Open GitHub’s pull-request form; nothing is created until you submit it there.' : 'Push or publish this branch before opening a pull request.')}
                    </div>
                  </div>
                </div>
                <div class="branch-action-group" role="group" aria-label="Review ${escapeAttr(branch.name)}">
                  <span class="branch-action-label">Review</span>
                  <div class="branch-card-actions">
                    ${renderAtlasDiscussAction(
                      'branch-discuss',
                      branch.id || '',
                      'Ask Atlas',
                      {
                        iconOnly: true,
                        title: `Ask Atlas for a deterministic summary of ${branch.name}`,
                      },
                    )}
                    ${renderRefreshAction(
                      'branch-inspect',
                      inspection ? 'Refresh review details' : 'Review details',
                      inspectionBusy,
                      {
                        busyLabel: inspection ? 'Refreshing review…' : 'Loading review…',
                        payload: branch.id || '',
                      },
                    )}
                    <button type="button" class="action-link" data-action="branch-story" data-payload="${escapeAttr(branch.id || '')}">Open Change Story</button>
                    ${pullRequest ? `<button type="button" class="action-link" data-action="branch-open-pr" data-payload="${escapeAttr(branch.id || '')}">Open PR #${escapeHtml(String(pullRequest.number))}</button>` : ''}
                    <button type="button" class="action-link${compareSelected ? ' primary' : ''}" data-action="branch-compare-toggle" data-payload="${escapeAttr(branch.id || '')}" aria-pressed="${compareSelected ? 'true' : 'false'}">${compareSelected ? 'Selected to compare' : 'Compare'}</button>
                    ${insight.cleanup && insight.cleanup.candidate ? `<button type="button" class="action-link danger-link" data-action="branch-cleanup" data-payload="${escapeAttr(branch.id || '')}" title="${escapeAttr(`${insight.cleanup.summary || ''} A remote-backed candidate is fetched before review.`)}">Review cleanup</button>` : ''}
                  </div>
                </div>
              </div>
            </div>
          ` : ''}
        </article>
        ${inspection ? renderBranchInspection(inspection) : ''}
      </div>
    `;
  }

  function branchesGithubState(branch) {
    const insight = branch.insight || {};
    return insight.ci && insight.ci.source === 'not-loaded'
      ? 'Pull requests have not been loaded; no “no PR” claim is made'
      : 'No loaded pull request uses this branch as its head';
  }

  function renderRepo(snapshot) {
    const r = snapshot.repo;
    const changed = r.modified + r.staged + r.untracked;
    const scm = { command: 'workbench.view.scm', hint: 'Open Source Control' };
    return `
      ${pageSectionOpen('repo')}
        ${renderPageIntro({
          kicker: 'Repository',
          title: 'Working tree at a glance',
          summary: `On ${escapeHtml(snapshot.currentBranch)} — ${r.dirty ? `${changed} file${changed === 1 ? '' : 's'} differ from HEAD` : 'the working tree is clean'}${r.behind ? `, ${r.behind} commit${r.behind === 1 ? '' : 's'} behind upstream` : ''}${r.ahead ? `, ${r.ahead} ahead` : ''}. ${r.branchCount} local branch${r.branchCount === 1 ? '' : 'es'}. Open the Branches page for the complete local and remote inventory.`,
          chips: [
            { label: r.dirty ? `${changed} uncommitted` : 'Clean tree', tone: r.dirty ? 'warn' : 'good' },
            { label: r.behind ? `${r.behind} behind` : 'Up to date', tone: r.behind ? 'warn' : 'good' },
            { label: `${r.ahead} ahead`, tone: r.ahead ? 'accent' : undefined },
          ],
          action: scm,
          actionLabel: 'Open Source Control',
        })}
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Repo state</p>
            <h3>Working tree</h3>
            <div class="mini-grid">
              ${renderMetricPill('Ahead', String(r.ahead), { tone: r.ahead ? 'accent' : undefined, action: scm })}
              ${renderMetricPill('Behind', String(r.behind), { tone: r.behind ? 'warn' : 'good', action: scm })}
              ${renderMetricPill('Staged files', String(r.staged), { tone: r.staged ? 'accent' : undefined, action: scm })}
              ${renderMetricPill('Modified files', String(r.modified), { tone: r.modified ? 'warn' : 'good', action: scm })}
              ${renderMetricPill('Untracked files', String(r.untracked), { tone: r.untracked ? 'warn' : undefined, action: scm })}
              ${renderMetricPill('Local branches', String(r.branchCount), { tone: 'accent' })}
            </div>
            ${renderDistributionBar('repo-tree', [
              { label: 'Staged', value: r.staged, tone: 'good' },
              { label: 'Modified', value: r.modified, tone: 'warn' },
              { label: 'Untracked', value: r.untracked, tone: 'accent' },
            ], {
              title: 'Change shape',
              caption: `${changed} file${changed === 1 ? '' : 's'}`,
              emptyLabel: 'Working tree is clean — nothing staged, modified, or untracked.',
            })}
            ${renderDistributionBar('repo-drift', [
              { label: 'Ahead', value: r.ahead, tone: 'accent' },
              { label: 'Behind', value: r.behind, tone: 'warn' },
            ], {
              title: 'Divergence from upstream',
              emptyLabel: 'In step with the upstream branch.',
            })}
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="workbench.view.scm">⎇ Open Source Control</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Recent commits</p>
            <h3>Latest changes</h3>
            <div class="stack-list">
              ${r.commits.length > 0 ? r.commits.map(commit => `
                <button type="button" class="recent-item" data-action="command" data-payload="workbench.view.scm" title="Open Source Control">
                  <div class="row-head">
                    <strong>${escapeHtml(commit.subject)}</strong>
                    <span class="tag mono">${escapeHtml(commit.shortHash)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(commit.author)} • ${escapeHtml(commit.committedRelative)}</div>
                </button>`).join('') : '<div class="dashboard-empty">No commit history available.</div>'}
            </div>
          </article>
        </div>
        <div class="repo-grid">
          <article class="list-card">
            <p class="section-kicker">Branches</p>
            <h3>Most recently touched</h3>
            <div class="stack-list">
              ${r.branches.length > 0 ? r.branches.map(branch => `
                <button type="button" class="branch-card" data-action="page" data-payload="branches" title="Open Branches">
                  <div class="row-head">
                    <h4>${escapeHtml(branch.name)}${branch.current ? ' <span class="tag tag-good">● current</span>' : ''}</h4>
                    <span class="list-meta">${escapeHtml(branch.lastCommitRelative)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(branch.subject || 'No commit message available.')}</div>
                  <div class="tag-row">${branch.upstream ? `<span class="tag mono">${escapeHtml(branch.upstream)}</span>` : '<span class="tag tag-warn">No upstream</span>'}</div>
                </button>`).join('') : '<div class="dashboard-empty">No branches available.</div>'}
            </div>
          </article>
          <article class="list-card">
            <p class="section-kicker">Signals</p>
            <h3>Review focus</h3>
            <div class="signal-grid">
              ${renderSignalCard('Repo cleanliness', !r.dirty, r.dirty ? 'Local changes are still pending review or commit.' : 'Working tree is clean right now.', { command: 'workbench.view.scm', hint: 'Open Source Control' })}
              ${renderSignalCard('Branch drift', r.behind === 0, r.behind === 0 ? 'Current branch is not behind its upstream.' : `${r.behind} upstream commit(s) are still missing locally.`, { command: 'workbench.view.scm', hint: 'Open Source Control' })}
              ${renderSignalCard('Change size', changed <= 12, `${changed} file(s) currently differ from HEAD.`, { command: 'workbench.view.scm', hint: 'Review changes' })}
              ${renderSignalCard('Commit cadence', snapshot.charts.commits.some(point => point.value > 0), 'See the commit velocity chart below for the selected window.', { command: 'workbench.view.scm', hint: 'Open Source Control' })}
            </div>
          </article>
        </div>
        ${renderChartRange('Commit history')}
        <div class="chart-grid">
          ${renderChartCard('commits', 'Commit velocity', 'Commits per day on this repository. Compare against the previous window to see whether the project is speeding up or stalling.', snapshot.charts.commits, 'repo')}
        </div>
      </section>
    `;
  }

  function renderRuntime(snapshot) {
    const rt = snapshot.runtime;
    const providersHealthy = rt.healthyProviders === rt.totalProviders && rt.totalProviders > 0;
    return `
      ${pageSectionOpen('runtime')}
        ${renderPageIntro({
          kicker: 'Atlas runtime',
          title: 'What Atlas can do right now',
          summary: `${rt.enabledAgents}/${rt.totalAgents} agents and ${rt.enabledModels}/${rt.totalModels} models enabled, ${rt.healthyProviders}/${rt.totalProviders} providers healthy. ${rt.projectRunCount} project run${rt.projectRunCount === 1 ? '' : 's'} and ${rt.sessionCount} chat session${rt.sessionCount === 1 ? '' : 's'} tracked. Autopilot is ${rt.autopilot ? 'on' : 'off'}. Click any card to jump to the matching surface.`,
          chips: [
            { label: providersHealthy ? 'Providers healthy' : `${rt.healthyProviders}/${rt.totalProviders} providers`, tone: providersHealthy ? 'good' : 'warn' },
            { label: `${rt.enabledModels} models`, tone: rt.enabledModels >= 3 ? 'good' : 'warn' },
            { label: rt.autopilot ? 'Autopilot on' : 'Autopilot off', tone: rt.autopilot ? 'warn' : 'good' },
            { label: `TDD ${rt.tdd.tone === 'good' ? 'healthy' : 'needs attention'}`, tone: rt.tdd.tone === 'good' ? 'good' : rt.tdd.tone === 'critical' ? 'critical' : 'warn' },
          ],
          action: { command: 'atlasmind.openProjectRunCenter' },
          actionLabel: 'Open Project Run Center',
        })}
        <div class="runtime-grid">
          <article class="panel-card">
            <p class="section-kicker">Atlas runtime</p>
            <h3>Capability coverage</h3>
            <div class="mini-grid">
              ${renderMetricPill('Enabled agents', `${rt.enabledAgents}/${rt.totalAgents}`, { tone: rt.enabledAgents > 0 ? 'good' : 'warn', meter: rt.totalAgents ? Math.round((rt.enabledAgents / rt.totalAgents) * 100) : 0, action: { command: 'atlasmind.openAgentPanel', hint: 'Manage agents' } })}
              ${renderMetricPill('Enabled skills', `${rt.enabledSkills}/${rt.totalSkills}`, { tone: rt.enabledSkills > 0 ? 'good' : 'warn', meter: rt.totalSkills ? Math.round((rt.enabledSkills / rt.totalSkills) * 100) : 0 })}
              ${renderMetricPill('Healthy providers', `${rt.healthyProviders}/${rt.totalProviders}`, { tone: providersHealthy ? 'good' : 'warn', meter: rt.totalProviders ? Math.round((rt.healthyProviders / rt.totalProviders) * 100) : 0, action: { command: 'atlasmind.openModelProviders', hint: 'Model providers' } })}
              ${renderMetricPill('Enabled models', `${rt.enabledModels}/${rt.totalModels}`, { tone: rt.enabledModels >= 3 ? 'good' : 'warn', meter: rt.totalModels ? Math.round((rt.enabledModels / rt.totalModels) * 100) : 0, action: { command: 'atlasmind.openModelProviders', hint: 'Model providers' } })}
              ${renderMetricPill('Sessions', String(rt.sessionCount), { tone: 'accent', action: { command: 'atlasmind.openChatView', hint: 'Open chat' } })}
              ${renderMetricPill('Project runs', String(rt.projectRunCount), { tone: 'accent', action: { command: 'atlasmind.openProjectRunCenter', hint: 'Run Center' } })}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openAgentPanel">🤖 Manage agents</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openModelProviders">🔌 Model providers</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Session economics</p>
            <h3>Cost and usage</h3>
            <div class="mini-grid">
              ${renderMetricPill('Total cost', formatCurrency(rt.totalCostUsd), { tone: 'accent', action: { command: 'atlasmind.openCostDashboard', hint: 'Cost dashboard' } })}
              ${renderMetricPill('Requests', String(rt.totalRequests), { action: { command: 'atlasmind.openCostDashboard', hint: 'Cost dashboard' } })}
              ${renderMetricPill('Input tokens', formatNumber(rt.totalInputTokens))}
              ${renderMetricPill('Output tokens', formatNumber(rt.totalOutputTokens))}
              ${renderMetricPill('Autopilot', rt.autopilot ? 'Enabled' : 'Disabled', { tone: rt.autopilot ? 'warn' : 'good', action: { command: 'atlasmind.toggleAutopilot', hint: 'Toggle Autopilot' } })}
            </div>
            ${renderDistributionBar('runtime-tokens', [
              { label: 'Input', value: rt.totalInputTokens, tone: 'accent' },
              { label: 'Output', value: rt.totalOutputTokens, tone: 'good' },
            ], {
              title: 'Token split',
              caption: rt.totalRequests > 0
                ? `${formatNumber(Math.round((rt.totalInputTokens + rt.totalOutputTokens) / rt.totalRequests))} avg per request`
                : '',
              emptyLabel: 'No token usage recorded yet.',
            })}
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.toggleAutopilot">⚡ Toggle Autopilot</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openChatView">💬 Open chat</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">TDD compliance</p>
            <h3>Recent project-run posture</h3>
            ${renderDistributionBar('runtime-tdd', [
              { label: 'Verified', value: rt.tdd.verified, tone: 'good' },
              { label: 'Blocked', value: rt.tdd.blocked, tone: 'critical' },
              { label: 'Missing evidence', value: rt.tdd.missing, tone: 'warn' },
              { label: 'N/A', value: rt.tdd.notApplicable, tone: 'muted' },
            ], {
              title: 'Subtask evidence',
              caption: `${rt.tdd.evaluatedSubtasks} evaluated`,
              emptyLabel: 'No subtasks have been evaluated for TDD evidence yet.',
            })}
            <div class="signal-grid">
              ${renderSignalCard('TDD summary', rt.tdd.tone === 'good', rt.tdd.summary, { command: 'atlasmind.openProjectRunCenter', hint: 'Open Run Center' })}
              ${renderSignalCard('Verified subtasks', rt.tdd.verified > 0, `${rt.tdd.verified} verified subtask(s) recorded.`, { command: 'atlasmind.openProjectRunCenter', hint: 'Open Run Center' })}
              ${renderSignalCard('Blocked subtasks', rt.tdd.blocked === 0, `${rt.tdd.blocked} blocked subtask(s) recorded.`, rt.tdd.blocked > 0 ? { prompt: buildTddChatPrompt(rt.tdd), hint: 'Ask Atlas to fix' } : { command: 'atlasmind.openProjectRunCenter', hint: 'Open Run Center' })}
              ${renderSignalCard('Missing evidence', rt.tdd.missing === 0, `${rt.tdd.missing} subtask(s) are missing TDD evidence.`, rt.tdd.missing > 0 ? { prompt: buildTddChatPrompt(rt.tdd), hint: 'Ask Atlas to fix' } : { command: 'atlasmind.openProjectRunCenter', hint: 'Open Run Center' })}
            </div>
            <div class="stat-detail">${escapeHtml(rt.tdd.detail)}</div>
            <div class="tag-row">
              ${rt.tdd.missing > 0 || rt.tdd.blocked > 0 ? `
              ${renderAtlasDiscussAction('prompt', buildTddChatPrompt(rt.tdd), 'Ask AtlasMind to fix the TDD gaps', { title: 'Ask AtlasMind to inspect and fix the blocked or missing TDD evidence' })}
              <button type="button" class="action-link" data-action="run-with-goal" data-payload="${escapeAttr(buildTddRunGoal(rt.tdd))}">▶ Plan a TDD fix run</button>
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

    const testCount = testing.tests.length || testing.totalCases;
    // coveragePercent is a display string like "82%", not a number — parse it
    // before it can drive a meter, and leave the meter off entirely when no
    // coverage report has been generated.
    const coverageParsed = parseFloat(String(testing.coveragePercent || ''));
    const coveragePercentValue = Number.isFinite(coverageParsed) ? Math.max(0, Math.min(100, coverageParsed)) : null;
    // Severity-led, because the descriptive cards below cannot answer the
    // question somebody opens this page with. "43 test files" reads identically
    // whether or not three of them are failing and nobody owns the gap.
    const detailSet = testing.policyDetails || { details: [], counts: {}, summary: '', rules: [] };
    const findings = (detailSet.details || []).filter(entry => entry.finding && entry.finding.severity !== 'none');
    const seriousCount = (detailSet.counts && detailSet.counts.serious) || 0;
    const openCount = findings.length;
    const unownedCount = findings.filter(entry => !policyHasOwner(entry.id)).length;
    const reportKnown = testingHasReport();

    const testingStats = [
      {
        id: 'attention',
        label: 'Needs attention',
        value: String(seriousCount),
        detail: seriousCount > 0
          ? 'Failing tests, or a security/compliance policy with no evidence at all.'
          : openCount > 0
            ? 'Nothing serious. Some policies still have a gap to close.'
            : 'No policy is failing or unevidenced.',
        tone: seriousCount > 0 ? 'critical' : openCount > 0 ? 'warn' : 'good',
      },
      {
        id: 'open-gaps',
        label: 'Open gaps',
        value: String(openCount),
        detail: openCount > 0
          ? 'Enabled policies with something outstanding. Open a card to see the evidence and act on it.'
          : 'Every enabled policy has evidence.',
        tone: openCount > 0 ? 'warn' : 'good',
      },
      {
        id: 'unowned',
        label: 'Unowned',
        value: String(unownedCount),
        detail: unownedCount > 0
          ? `Gaps with nobody assigned. Follow-ups default to ${directorSelfName() || 'you'} until somebody is.`
          : openCount > 0 ? 'Every open gap has an owner.' : 'Nothing outstanding to own.',
        tone: unownedCount > 0 ? 'warn' : 'good',
      },
      {
        id: 'verdict',
        label: 'Last run',
        // A project with no report has no verdict about failures, and reporting
        // that as "0 failing" would be the one wrong answer that looks right.
        value: reportKnown ? String((testing.policyCoverage && testing.policyCoverage.report.failed) || 0) : 'No report',
        detail: reportKnown
          ? 'Failing cases in the newest machine-readable report.'
          : 'No test report has been produced, so pass/fail is unknown — which is not the same as passing.',
        tone: reportKnown
          ? (((testing.policyCoverage && testing.policyCoverage.report.failed) || 0) > 0 ? 'critical' : 'good')
          : 'warn',
      },
      { id: 'fw', label: 'Framework', value: testing.frameworkLabel, detail: 'Detected from scripts and dependencies.', tone: 'accent', command: 'atlasmind.openSettingsTesting' },
      { id: 'policy', label: 'Testing policy', value: testing.testingPolicyLabel || 'Red-Green TDD', detail: testing.testingPolicyDetail || 'Default Atlas tests-first policy.', tone: 'accent', command: 'atlasmind.openSettingsTesting' },
      { id: 'files', label: 'Discovered files', value: String(testing.totalFiles), detail: `${testing.unitFiles} unit • ${testing.integrationFiles} integration • ${testing.e2eFiles} e2e`, tone: testing.totalFiles > 0 ? 'good' : 'warn', command: 'atlasmind.openSettingsTesting' },
      { id: 'tests', label: 'Individual tests', value: String(testCount), detail: `${testing.totalSuites} suites, ${testing.averageCasesPerFile} avg cases/file`, tone: testCount > 0 ? 'good' : 'warn' },
      { id: 'cov', label: 'Coverage', value: testing.coveragePercent || '—', detail: testing.coverageDetail, tone: testing.coveragePercent ? 'good' : 'accent', command: 'atlasmind.openSettingsTesting' },
      { id: 'verify', label: 'Verification', value: testing.verificationEnabled ? 'On' : 'Off', detail: (testing.verificationScripts || []).join(', ') || 'No scripts configured', tone: testing.verificationEnabled ? 'good' : 'warn', command: 'atlasmind.openSettingsSafety' },
    ];
    return `
      ${pageSectionOpen('testing')}
        ${renderPageIntro({
          kicker: 'Testing intelligence',
          title: 'How this project proves itself',
          summary: `${detailSet.summary || ''} ${testing.frameworkLabel} with ${testing.totalFiles} test file${testing.totalFiles === 1 ? '' : 's'} and ${testCount} individual test${testCount === 1 ? '' : 's'}. Open a policy card below for its evidence, charts and actions.`.trim(),
          chips: [
            { label: `${testing.totalFiles} files`, tone: testing.totalFiles > 0 ? 'good' : 'warn' },
            { label: testing.verificationEnabled ? 'Verification on' : 'Verification off', tone: testing.verificationEnabled ? 'good' : 'warn' },
            { label: testing.coveragePercent ? `Coverage ${testing.coveragePercent}` : 'No coverage report', tone: testing.coveragePercent ? 'good' : 'accent' },
            // Failing/gap chips only when there is something to say: an
            // absent report is reported as unknown, never as a pass.
            ...(policyChips(testing)),
          ],
          action: { command: 'atlasmind.openSettingsTesting' },
          actionLabel: 'Testing settings',
        })}
        <div class="stats-grid">
          ${testingStats.map(stat => renderStatCard(stat)).join('')}
        </div>

        <article class="panel-card">
          <p class="section-kicker">Test shape</p>
          <h3>Pyramid and coverage</h3>
          <div class="stat-detail">A healthy suite is broad at the unit level and narrow at the end-to-end level. An inverted shape — mostly e2e, few unit tests — is slow to run and brittle to change.</div>
          <div class="panel-grid" style="margin-top: 12px;">
            ${renderDistributionBar('testing-pyramid', [
              { label: 'Unit', value: testing.unitFiles, tone: 'good' },
              { label: 'Integration', value: testing.integrationFiles, tone: 'accent' },
              { label: 'End-to-end', value: testing.e2eFiles, tone: 'warn' },
              { label: 'Other', value: Math.max(0, testing.totalFiles - testing.unitFiles - testing.integrationFiles - testing.e2eFiles), tone: 'muted' },
            ], {
              title: 'Test files by level',
              caption: `${testing.totalFiles} file${testing.totalFiles === 1 ? '' : 's'}`,
              emptyLabel: 'No test files discovered yet.',
            })}
            <div class="mini-grid">
              ${renderMetricPill('Coverage', testing.coveragePercent || 'Not generated', {
                tone: coveragePercentValue === null ? 'warn' : coveragePercentValue >= 80 ? 'good' : coveragePercentValue >= 50 ? 'accent' : 'warn',
                meterKey: 'testing-coverage',
                ...(coveragePercentValue === null ? {} : { meter: coveragePercentValue }),
                action: { command: 'atlasmind.openSettingsTesting', hint: 'Testing settings' },
              })}
              ${renderMetricPill('Suites', String(testing.totalSuites), { tone: 'accent' })}
              ${renderMetricPill('Avg cases / file', String(testing.averageCasesPerFile), { tone: 'accent' })}
            </div>
          </div>
        </article>

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
                <div class="test-group">
                  <div class="row-head test-group-head">
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
              ${selectedTest ? renderAtlasDiscussAction('prompt', `Review the test named '${selectedTest.title}' in ${selectedTest.relativePath} and explain what behavior it validates, what edge cases remain uncovered, and whether the assertions are strong enough.`, 'Ask AtlasMind to analyze this test', { title: 'Ask AtlasMind to analyze the selected test and identify coverage gaps' }) : ''}
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

        ${renderPolicyCoverage(testing)}

        ${renderMethodologyStrategy(testing)}
      </section>
    `;
  }

  function policyChips(testing) {
    const coverage = testing.policyCoverage;
    if (!coverage || !Array.isArray(coverage.rows) || coverage.rows.length === 0) {
      return [];
    }
    const chips = [];
    if (coverage.report) {
      chips.push(coverage.report.failed > 0
        ? { label: `${coverage.report.failed} failing`, tone: 'critical' }
        : { label: 'Last report clean', tone: 'good' });
    } else {
      chips.push({ label: 'No test report', tone: 'warn' });
    }
    const gaps = coverage.toolingOnlyCount + coverage.missingCount;
    if (gaps > 0) {
      chips.push({ label: `${gaps} polic${gaps === 1 ? 'y' : 'ies'} untested`, tone: 'warn' });
    }
    if (coverage.totalSkipped > 0) {
      chips.push({ label: `${coverage.totalSkipped} skipped`, tone: 'warn' });
    }
    return chips;
  }

  // The host already strips controls and redacts likely credentials; these
  // parsers remain defensive because extension-host messages are still a
  // boundary and a malformed payload should never blank the Testing page.
  function boundedTestingFixText(value, limit, preserveLines = false) {
    if (typeof value !== 'string') {
      return '';
    }
    const cleaned = value
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim();
    return (preserveLines ? cleaned : cleaned.replace(/\s+/g, ' ')).slice(0, limit);
  }

  function normalizeTestingFixUpdate(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const runId = boundedTestingFixText(payload.runId, 120);
    const message = boundedTestingFixText(payload.message, 360);
    if (!runId || !message) {
      return null;
    }
    return {
      runId,
      message,
      at: boundedTestingFixText(payload.at, 80),
    };
  }

  function normalizeTestingFixResult(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const runId = boundedTestingFixText(payload.runId, 120);
    const summary = boundedTestingFixText(payload.summary, 440);
    if (!runId || !summary) {
      return null;
    }
    return {
      runId,
      outcome: payload.outcome === 'failed' ? 'failed' : 'completed',
      summary,
      output: boundedTestingFixText(payload.output, 12000, true),
      completedAt: boundedTestingFixText(payload.completedAt, 80),
      agentId: boundedTestingFixText(payload.agentId, 140),
    };
  }

  function renderTestingFixActivity() {
    const fix = state.testingFix;
    if (!fix || (!fix.running && !fix.current && !fix.result)) {
      return '';
    }

    const result = fix.result;
    const tone = fix.running ? 'running' : result && result.outcome === 'failed' ? 'failed' : 'completed';
    const label = fix.running
      ? 'Repair running'
      : result && result.outcome === 'failed'
        ? 'Repair task failed'
        : 'Task finished — review evidence';
    const tagTone = fix.running ? 'tag-warn' : result && result.outcome === 'failed' ? 'tag-critical' : 'tag-warn';
    const updates = Array.isArray(fix.updates) ? fix.updates.slice(-8) : [];
    const updatesHtml = updates.length > 0
      ? `<ul class="testing-fix-update-list">${updates.map(update => `<li>${escapeHtml(update.message)}</li>`).join('')}</ul>`
      : '';
    const outputHtml = result && result.output
      ? `<details class="testing-fix-output">
          <summary>View reported task output</summary>
          <pre>${escapeHtml(result.output)}</pre>
        </details>`
      : '';
    const resultMeta = result && result.agentId
      ? `<span class="list-meta">Reported by ${escapeHtml(result.agentId)}</span>`
      : '';
    const chatAction = result
      ? `<div class="tag-row testing-fix-actions">
          ${renderAtlasDiscussAction(
            'testing-fix-chat',
            '',
            result.outcome === 'failed' ? 'Resolve with Atlas' : 'Discuss with Atlas',
            { title: 'Open the host-retained repair result in Atlas Chat as a reviewable draft' },
          )}
          <span class="list-meta">Opens a reviewable draft; it is not sent automatically.</span>
        </div>`
      : '';

    return `
      <section class="testing-fix-activity ${tone}" aria-label="Activated-testing repair status">
        <div class="testing-fix-heading">
          <strong>Activated-testing repair</strong>
          <span class="tag ${tagTone}">${label}</span>
        </div>
        <p class="testing-fix-current" role="status" aria-live="polite">${escapeHtml(fix.current || 'AtlasMind is preparing the repair task.')}</p>
        ${fix.running ? '<progress class="testing-fix-progress" aria-label="AtlasMind repair activity in progress"></progress>' : ''}
        ${updatesHtml}
        ${resultMeta}
        ${outputHtml}
        ${chatAction}
      </section>
    `;
  }

  // ── Per-policy coverage board ────────────────────────────────────
  // Answers, for every policy the project switched on: is anything testing it,
  // and is any of it failing? Deliberately distinguishes "no tests" from "no
  // report to read" — a panel that renders 0 failures when nothing ran is worse
  // than one that admits it has no verdict.
  /**
   * The opened half of a policy card: what the evidence actually is, who owns
   * it, and the moves available.
   *
   * Rendered only when open. Sixty-nine collapsed cards each carrying a chart
   * and three tables is a page nobody scrolls, and the whole reason the card
   * collapses is that most policies are fine most of the time.
   */
  function renderPolicyCardDetail(row, detail) {
    const finding = detail && detail.finding;
    const caseMix = detail && detail.caseMix;

    // Charts. A policy with no cases gets no bar at all rather than an empty
    // one: "nothing runs" and "nothing could be measured" look identical as an
    // empty bar and only one of them is a finding.
    const mixBar = caseMix
      ? renderDistributionBar(`policy-mix-${row.id}`, [
        { label: 'Passing', value: caseMix.passing, tone: 'good' },
        { label: 'Skipped', value: caseMix.skipped, tone: 'warn' },
        { label: 'Failing', value: caseMix.failing, tone: 'critical' },
      ], {
        title: 'Cases in this policy’s tests',
        caption: `${caseMix.passing + caseMix.skipped + caseMix.failing} case(s)`,
      })
      : `<div class="dist-empty">${escapeHtml(row.status === 'not-file-evident'
        ? 'A practice, so there are no cases to chart — that is not a gap.'
        : 'No test cases were found for this policy, so there is nothing to chart.')}</div>`;

    const evidenceRows = [
      ['Status', row.statusLabel],
      ['Test files', String(row.fileCount)],
      ['Cases', String(row.caseCount)],
      ['Skipped', String(row.skippedCount)],
      ['Failing', row.failedCount > 0 ? String(row.failedCount) : (testingHasReport() ? '0' : 'Unknown — no report')],
      ['Tooling found', (row.toolingSignals || []).length > 0 ? row.toolingSignals.join(', ') : 'None detected'],
    ];

    const failures = (row.failures || []).slice(0, 12);

    const ownerControl = renderDirectorOwnerControl('testing-policy', row.id);
    const selfName = directorSelfName();

    return `
      <div class="policy-card-body">
        <p class="policy-card-detail">${escapeHtml(row.detail)}</p>

        ${finding && finding.severity !== 'none' ? `
          <div class="policy-grade">
            <span class="tag ${finding.severity === 'serious' ? 'tag-critical' : finding.severity === 'moderate' ? 'tag-warn' : 'tag-muted'}">${escapeHtml(finding.severity)}</span>
            <span class="list-meta">Graded by the rule: ${escapeHtml(finding.rule)}</span>
          </div>` : ''}
        ${finding && finding.unverified ? `
          <div class="policy-grade">
            <span class="tag tag-warn">Unverified</span>
            <span class="list-meta">Evidence exists, but no test report has been produced — so nothing here has actually been run.</span>
          </div>` : ''}

        <div class="panel-grid" style="margin-top:10px">
          ${mixBar}
          <table class="mini-table policy-evidence-table">
            <caption class="section-kicker">Evidence</caption>
            <tbody>
              ${evidenceRows.map(entry => `
                <tr><th scope="row">${escapeHtml(entry[0])}</th><td>${escapeHtml(entry[1])}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        ${failures.length > 0 ? `
          <table class="mini-table policy-failure-table">
            <caption class="section-kicker">Failing cases${row.failedCount > failures.length ? ` (first ${failures.length} of ${row.failedCount})` : ''}</caption>
            <thead><tr><th scope="col">Case</th><th scope="col">Suite</th><th scope="col">File</th></tr></thead>
            <tbody>
              ${failures.map(failure => `
                <tr>
                  <td>${escapeHtml(failure.name || 'unnamed')}</td>
                  <td>${escapeHtml(failure.suite || '—')}</td>
                  <td>${failure.file
                    ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(failure.file)}">${escapeHtml(failure.file)}</button>`
                    : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : ''}

        <div class="policy-owner-row">
          ${ownerControl || `<span class="list-meta">Add people in Project Director to assign an owner.</span>`}
          ${ownerControl && !policyHasOwner(row.id) ? `<span class="list-meta">Unassigned — follow-ups default to ${escapeHtml(selfName || 'you')}.</span>` : ''}
        </div>

        <div class="tag-row policy-card-actions">
          ${row.exampleFile ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(row.exampleFile)}">Open a test</button>` : ''}
          ${detail && detail.scaffoldable ? `<button type="button" class="action-link" data-action="testing-policy-scaffold" data-payload="${escapeAttr(row.id)}" title="${escapeAttr(`Create the starter framework for ${row.label} only. The exact files are listed before anything is written.`)}">Scaffold framework</button>` : ''}
          ${detail && detail.followUp ? `<button type="button" class="action-link" data-action="testing-policy-followup" data-payload="${escapeAttr(row.id)}" title="${escapeAttr(`Add ${row.label} to the owner’s follow-ups`)}">Add to follow-ups</button>` : ''}
          ${detail && detail.issue ? `<button type="button" class="action-link action-link-strong" data-action="testing-policy-issue" data-payload="${escapeAttr(row.id)}" title="${escapeAttr('Draft a GitHub issue for this finding. The draft is shown before anything is posted.')}">File as issue…</button>` : ''}
          ${renderAtlasDiscussAction('discuss-testing-policy', row.id, 'Ask Atlas', { title: `Ask Atlas to explain ${row.label}, its current evidence, and configuration options` })}
          ${renderAtlasDiscussAction('prompt', row.actionPrompt, row.failedCount > 0 ? 'Ask AtlasMind to fix this' : row.status === 'covered' ? 'Ask AtlasMind to review this' : 'Ask AtlasMind to write these tests', { title: row.failedCount > 0 ? `Ask AtlasMind to fix failures for ${row.label}` : row.status === 'covered' ? `Ask AtlasMind to review the evidence for ${row.label}` : `Ask AtlasMind to add missing tests for ${row.label}` })}
        </div>
      </div>`;
  }

  /** True when the last snapshot carried a machine-readable test report. */
  function testingHasReport() {
    const testing = (state.snapshot || {}).testing || {};
    return Boolean(testing.policyCoverage && testing.policyCoverage.report);
  }

  /** The name the Director config marks as "me", for the default-assignee line. */
  function directorSelfName() {
    const cfg = (state.snapshot || {}).director && state.snapshot.director.config;
    if (!cfg || !cfg.selfContactId) { return ''; }
    const self = (cfg.contacts || []).find(contact => contact.id === cfg.selfContactId);
    return self ? self.name : '';
  }

  function policyHasOwner(policyId) {
    const cfg = (state.snapshot || {}).director && state.snapshot.director.config;
    if (!cfg) { return false; }
    return (cfg.assignments || []).some(entry => entry.linkedWork
      && entry.linkedWork.kind === 'testing-policy'
      && entry.linkedWork.id === String(policyId)
      && entry.assigneeContactId);
  }

  function renderPolicyCoverage(testing) {
    const coverage = testing.policyCoverage;
    if (!coverage || !Array.isArray(coverage.rows)) {
      return '';
    }
    const rows = coverage.rows;
    const report = coverage.report;
    const failingRows = rows.filter(row => row.failedCount > 0);
    const gapRows = rows.filter(row => row.status === 'missing' || row.status === 'tooling-only');
    const fixRunning = Boolean(state.testingFix && state.testingFix.running);

    const reportLine = report
      ? `
        <div class="policy-report-line">
          <span class="tag ${report.failed > 0 ? 'tag-critical' : 'tag-good'}">${report.failed > 0 ? escapeHtml(`${report.failed} failing`) : 'All passing'}</span>
          <span class="list-meta">${escapeHtml(`${report.tests} test${report.tests === 1 ? '' : 's'} across ${report.suites} suite${report.suites === 1 ? '' : 's'}${report.skipped > 0 ? `, ${report.skipped} skipped` : ''}`)}</span>
          <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(report.relativePath)}">${escapeHtml(report.relativePath)}</button>
          ${report.stale ? `<span class="tag tag-warn" title="${escapeAttr(report.staleDetail || '')}">May be out of date</span>` : ''}
        </div>`
      : `
        <div class="policy-report-line">
          <span class="tag tag-warn">No test report</span>
          <span class="list-meta">Pass/fail cannot be shown until a run writes one. This is not a clean result — it is no result.</span>
        </div>
        <div class="policy-report-line"><code>${escapeHtml(coverage.reportHint)}</code></div>`;

    const detailSet = testing.policyDetails || { details: [], counts: {}, rules: [] };
    const detailById = new Map((detailSet.details || []).map(entry => [entry.id, entry]));

    const cards = rows.map(row => {
      const detail = detailById.get(row.id);
      const finding = detail && detail.finding;
      const severity = finding ? finding.severity : 'none';
      const expanded = state.testingExpandedIds.includes(row.id);

      const tone = row.failedCount > 0 ? 'tag-critical'
        : row.status === 'covered' ? 'tag-good'
        : row.status === 'tooling-only' ? 'tag-warn'
        : row.status === 'missing' ? 'tag-critical'
        : '';
      const counts = [];
      if (row.status !== 'not-file-evident') {
        counts.push(`${row.fileCount} file${row.fileCount === 1 ? '' : 's'}`);
        if (row.caseCount > 0) { counts.push(`${row.caseCount} case${row.caseCount === 1 ? '' : 's'}`); }
        if (row.skippedCount > 0) { counts.push(`${row.skippedCount} skipped`); }
        if (row.failedCount > 0) { counts.push(`${row.failedCount} failing`); }
      }

      return `
        <div class="policy-card status-${escapeAttr(row.status)} severity-${escapeAttr(severity)}${row.failedCount > 0 ? ' has-failures' : ''}${expanded ? ' is-expanded' : ''}"
          data-dashboard-focus-kind="testing-policy" data-dashboard-focus-id="${escapeAttr(row.id)}">
          <button type="button" class="policy-card-toggle" data-action="testing-policy-toggle" data-payload="${escapeAttr(row.id)}"
            aria-expanded="${expanded ? 'true' : 'false'}"
            title="${escapeAttr(expanded ? `Collapse ${row.label}` : `Show evidence, charts and actions for ${row.label}`)}">
            <span class="policy-card-head">
              <span class="policy-card-title">
                <span class="policy-card-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
                <strong>${escapeHtml(row.label)}</strong>
              </span>
              <span class="policy-card-head-actions">
                ${severity !== 'none' ? `<span class="tag ${severity === 'serious' ? 'tag-critical' : severity === 'moderate' ? 'tag-warn' : 'tag-muted'}">${escapeHtml(severity)}</span>` : ''}
                <span class="tag ${tone}">${escapeHtml(row.failedCount > 0 ? `${row.failedCount} failing` : row.statusLabel)}</span>
              </span>
            </span>
            ${counts.length > 0 ? `<span class="policy-card-signals">${escapeHtml(counts.join(' · '))}</span>` : ''}
            ${finding && finding.statement ? `<span class="policy-card-statement">${escapeHtml(finding.statement)}</span>` : ''}
          </button>
          ${expanded ? renderPolicyCardDetail(row, detail) : ''}
        </div>`;
    }).join('');

    const failureItems = [
      ...failingRows.flatMap(row => (row.failures || []).map(failure => ({ ...failure, policy: row.label }))),
      ...(coverage.unattributedFailures || []).map(failure => ({ ...failure, policy: 'Unattributed' })),
    ].slice(0, 25);

    return `
      <article class="panel-card" style="margin-top:16px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <p class="section-kicker">Policy coverage</p>
            <h3>What each enabled policy has to show</h3>
          </div>
          <span class="tag ${gapRows.length > 0 || failingRows.length > 0 ? 'tag-warn' : 'tag-good'}">${escapeHtml(`${coverage.coveredCount}/${coverage.activeCount} with tests`)}</span>
        </div>
        <div class="stat-detail">${escapeHtml(coverage.summary)}</div>
        <div class="tag-row" style="margin-top:8px">
          ${renderAtlasDiscussAction('fix-activated-testing', '', fixRunning ? 'AtlasMind is repairing activated testing' : 'Ask AtlasMind to fix activated testing', { disabled: fixRunning, title: fixRunning ? 'AtlasMind is currently repairing the enabled testing surfaces' : 'Ask AtlasMind to inspect and repair all enabled testing surfaces through the normal approval flow' })}
          <button type="button" class="action-link" data-action="reconcile-testing"${fixRunning ? ' disabled' : ''}>Reconcile with the repository…</button>
          <span class="list-meta">Fix runs only after confirmation and normal tool approvals; routed activity and its final report appear below. Reconcile compares the declared policy with what is actually here and proposes any configuration changes.</span>
        </div>
        ${renderTestingFixActivity()}
        ${reportLine}
        <div class="panel-grid" style="margin-top:12px">
          ${renderDistributionBar('policy-coverage', [
            { label: 'Tested', value: coverage.coveredCount, tone: 'good' },
            { label: 'Tooling only', value: coverage.toolingOnlyCount, tone: 'warn' },
            { label: 'Nothing found', value: coverage.missingCount, tone: 'critical' },
            { label: 'Practice (not file-evident)', value: coverage.practiceCount, tone: 'muted' },
          ], {
            title: 'Enabled policies by evidence',
            caption: `${coverage.activeCount} enabled`,
            emptyLabel: 'No testing policies are enabled yet.',
          })}
          <div class="mini-grid">
            ${renderMetricPill('Failing tests', report ? String(report.failed) : 'Unknown', { tone: report ? (report.failed > 0 ? 'critical' : 'good') : 'warn' })}
            ${renderMetricPill('Skipped in tree', String(coverage.totalSkipped || 0), { tone: (coverage.totalSkipped || 0) > 0 ? 'warn' : 'good' })}
            ${renderMetricPill('Policies with no tests', String(gapRows.length), { tone: gapRows.length > 0 ? 'warn' : 'good' })}
          </div>
        </div>
        <div class="policy-grid">${cards || '<div class="dashboard-empty">Enable the policies this project follows to see what each has to show for itself.</div>'}</div>
        ${(detailSet.rules || []).length > 0 ? `
          <details class="policy-rule-table">
            <summary>How these are graded</summary>
            <p class="list-meta">Severity comes from this table and never from a model, so a grade given today is comparable with one given last month. Rules are evaluated in order and the first match wins.</p>
            <table class="mini-table">
              <thead><tr><th scope="col">Severity</th><th scope="col">Rule</th></tr></thead>
              <tbody>
                ${detailSet.rules.map(rule => `
                  <tr>
                    <td><span class="tag ${rule.severity === 'serious' ? 'tag-critical' : rule.severity === 'moderate' ? 'tag-warn' : rule.severity === 'low' ? 'tag-muted' : 'tag-good'}">${escapeHtml(rule.severity)}</span></td>
                    <td>${escapeHtml(rule.label)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </details>` : ''}
        ${failureItems.length > 0 ? `
          <p class="section-kicker" style="margin-top:16px">Failing tests in the last report</p>
          <div class="policy-failure-list">
            ${failureItems.map(failure => `
              <div class="recent-item">
                <div class="row-head">
                  <strong>${escapeHtml(failure.name)}</strong>
                  <span class="tag-group">
                    <span class="tag tag-critical">${escapeHtml(failure.kind === 'error' ? 'error' : 'failed')}</span>
                    <span class="tag">${escapeHtml(failure.policy)}</span>
                  </span>
                </div>
                ${failure.suite ? `<div class="list-meta">${escapeHtml(failure.suite)}</div>` : ''}
                ${failure.file ? `<div class="tag-row"><button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(failure.file)}">${escapeHtml(failure.file)}</button></div>` : ''}
              </div>`).join('')}
          </div>` : ''}
      </article>
    `;
  }

  // This is only a compatibility fallback for a snapshot produced by an older
  // extension host. Current snapshots carry the shared catalogue from
  // `types.ts`, including the explanatory copy Settings already shows.
  const METHODOLOGY_FALLBACK_DEFS = [
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
    { key: 'design-time',              label: 'Design-time' },
    { key: 'structural',               label: 'Structural' },
    { key: 'behavioral',               label: 'Behavioral' },
    { key: 'non-functional',           label: 'Non-functional' },
    { key: 'data-schema',              label: 'Data & schema' },
    { key: 'ai-specific',              label: 'AI-specific' },
    { key: 'exploratory',              label: 'Exploratory' },
    { key: 'compliance-security',      label: 'Compliance — security & privacy' },
    { key: 'compliance-operational',   label: 'Compliance — operational' },
    { key: 'compliance-supply-chain',  label: 'Compliance — supply chain' },
    { key: 'compliance-ai',            label: 'Compliance — AI governance' },
    { key: 'compliance-industry',      label: 'Compliance — industry' },
  ];

  function getMethodologyDefinitions(testing) {
    const definitions = Array.isArray(testing && testing.methodologyDefinitions)
      ? testing.methodologyDefinitions.filter(def => def && typeof def.id === 'string' && typeof def.label === 'string')
      : [];
    return definitions.length > 0 ? definitions : METHODOLOGY_FALLBACK_DEFS;
  }

  function renderMethodologyStrategy(testing) {
    const config = testing.projectTestingConfig;
    const definitions = getMethodologyDefinitions(testing);
    const enabledIds = new Set(
      config ? config.methodologies.filter(m => m.enabled).map(m => m.id) : ['tdd', 'unit'],
    );
    const enabledCount = enabledIds.size;

    const categoryGroups = METHODOLOGY_CATEGORIES.map(cat => ({
      ...cat,
      items: definitions.filter(d => d.category === cat.key),
    }));

    const rows = categoryGroups.map(cat => `
      <tr>
        <td colspan="2" class="methodology-category-header">${escapeHtml(cat.label)}</td>
      </tr>
      ${cat.items.map(def => {
        const isEnabled = enabledIds.has(def.id);
        const description = typeof def.description === 'string' ? def.description : '';
        const whenToUse = typeof def.whenToUse === 'string' ? def.whenToUse : '';
        const keyTools = typeof def.keyTools === 'string' ? def.keyTools : '';
        const tradeoffs = typeof def.tradeoffs === 'string' ? def.tradeoffs : '';
        const details = whenToUse || keyTools || tradeoffs ? `
          <details class="methodology-dashboard-guidance">
            <summary>When to use it and the trade-offs</summary>
            ${whenToUse ? `<div><strong>When to use:</strong> ${escapeHtml(whenToUse)}</div>` : ''}
            ${keyTools ? `<div><strong>Common tools:</strong> ${escapeHtml(keyTools)}</div>` : ''}
            ${tradeoffs ? `<div><strong>Trade-offs:</strong> ${escapeHtml(tradeoffs)}</div>` : ''}
          </details>` : '';
        return `<tr>
          <td class="methodology-name-cell">
            <label class="methodology-toggle-label">
              <input type="checkbox" class="dashboard-methodology-cb" data-methodology-id="${escapeAttr(def.id)}" ${isEnabled ? 'checked' : ''} />
              ${escapeHtml(def.label)}
            </label>
            ${description ? `<div class="methodology-dashboard-description">${escapeHtml(description)}</div>` : ''}
            ${details}
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
          <span class="tag tag-good">${escapeHtml(String(enabledCount))} / ${escapeHtml(String(definitions.length))} active</span>
        </div>
        <div class="stat-detail" style="margin-bottom:12px">Toggle methodologies to enable or disable them. The descriptions and guidance below are the same shared protocol catalogue as Settings. Changes are saved immediately to <code>project_memory/index/testing-config.json</code>. Use <strong>Open Testing Strategy</strong> for agent assignments, model overrides, and project notes.</div>
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
    const ssot = snapshot.ssot;
    const recentFileTarget = ssot.recentFiles[0] ? ssot.recentFiles[0].path : `${ssot.path}/project_soul.md`;
    return `
      ${pageSectionOpen('ssot')}
        ${renderPageIntro({
          kicker: 'Single source of truth',
          title: 'Project memory health',
          summary: `${ssot.totalEntries} indexed entr${ssot.totalEntries === 1 ? 'y' : 'ies'} across ${ssot.coveragePercent}% of the SSOT directories${ssot.blockedEntries > 0 ? `, with ${ssot.blockedEntries} blocked entr${ssot.blockedEntries === 1 ? 'y' : 'ies'} Atlas is excluding` : ''}${ssot.warnedEntries > 0 ? ` and ${ssot.warnedEntries} warned` : ''}. ${totalDelta === 0 ? 'Documentation is in sync.' : `${totalDelta} area${totalDelta === 1 ? '' : 's'} need a memory refresh.`}`,
          chips: [
            { label: `${ssot.coveragePercent}% coverage`, tone: ssot.coveragePercent >= 80 ? 'good' : 'warn' },
            { label: ssot.blockedEntries > 0 ? `${ssot.blockedEntries} blocked` : 'No blocked entries', tone: ssot.blockedEntries > 0 ? 'critical' : 'good' },
            { label: totalDelta === 0 ? 'In sync' : `${totalDelta} to sync`, tone: totalDelta === 0 ? 'good' : 'warn' },
          ],
          action: { command: 'atlasmind.updateProjectMemory' },
          actionLabel: 'Sync SSOT now',
        })}
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">SSOT shape</p>
            <h3>${escapeHtml(ssot.path)}</h3>
            <div class="mini-grid">
              ${renderMetricPill('Indexed entries', String(ssot.totalEntries), { tone: ssot.totalEntries > 0 ? 'good' : 'warn', action: { file: recentFileTarget, hint: 'Open recent SSOT file' } })}
              ${renderMetricPill('Disk files', String(ssot.totalFilesOnDisk), { tone: 'accent' })}
              ${renderMetricPill('Coverage', `${ssot.coveragePercent}%`, { tone: ssot.coveragePercent >= 80 ? 'good' : 'warn', meter: ssot.coveragePercent })}
              ${renderMetricPill('Warned entries', String(ssot.warnedEntries), { tone: ssot.warnedEntries > 0 ? 'warn' : 'good', action: ssot.warnedEntries > 0 ? { prompt: 'Review the warned SSOT memory entries flagged by the dashboard and tighten or sanitize the first one, then summarize what remains.', hint: 'Review with Atlas' } : undefined })}
              ${renderMetricPill('Blocked entries', String(ssot.blockedEntries), { tone: ssot.blockedEntries > 0 ? 'critical' : 'good', action: ssot.blockedEntries > 0 ? { prompt: 'Resolve the blocked SSOT memory entries the dashboard is excluding: inspect the blocked material, make the smallest safe change that clears at least the first one, and summarize any that remain.', hint: 'Resolve with Atlas' } : undefined })}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(recentFileTarget)}">📄 Open recent SSOT file</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Coverage</p>
            <h3>Directory footprint</h3>
            ${renderDistributionBar('ssot-entries', [
              { label: 'Clean', value: Math.max(0, ssot.totalEntries - ssot.warnedEntries - ssot.blockedEntries), tone: 'good' },
              { label: 'Warned', value: ssot.warnedEntries, tone: 'warn' },
              { label: 'Blocked', value: ssot.blockedEntries, tone: 'critical' },
            ], {
              title: 'Entry health',
              caption: `${ssot.totalEntries} indexed`,
              emptyLabel: 'No indexed entries yet.',
            })}
            <div class="coverage-list">
              ${snapshot.ssot.coverage.map(entry => renderCoverageRow(entry, snapshot.ssot.totalFilesOnDisk)).join('')}
            </div>
          </article>
        </div>
        ${renderChartRange('Memory write history')}
        <div class="chart-grid">
          ${renderChartCard('memory', 'SSOT update cadence', 'Indexed memory writes per day. A flat line here is the leading indicator that documentation is drifting behind the code.', snapshot.charts.memory, 'ssot')}
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

  // ── Issues (the repository's tracker) ─────────────────────────────
  // The host refreshes this bounded GitHub snapshot once when the dashboard
  // opens, then holds it across renders. Manual refresh remains available.
  function renderIssues(snapshot) {
    const issues = snapshot.issues || { status: 'not-loaded', detail: '', issues: [], busy: false };
    const refreshBusy = Boolean(issues.busy || state.repositoryRefreshBusy);
    const workflow = snapshot.guidedWorkflow || {};
    const pullRequestRecords = Array.isArray(workflow.pullRequestRecords) ? workflow.pullRequestRecords : [];
    const list = Array.isArray(issues.issues) ? issues.issues : [];
    const summary = issues.summary || { openCount: 0, closedCount: 0, byLabel: [], byAssignee: [], unassignedCount: 0, staleCount: 0, summary: '' };
    const ready = issues.status === 'ready';
    const filter = state.issueFilter || 'open';
    const search = String(state.issueSearch || '').trim().toLowerCase();
    const unlinkedOpenPullRequests = pullRequestRecords.filter(pr =>
      (pr.state === 'open' || pr.state === 'draft')
      && (!Array.isArray(pr.linkedIssues) || pr.linkedIssues.length === 0));
    const commitsSinceTag = Number(workflow.commitsSinceTag) || 0;
    const issueWriteCapability = (workflow.capabilities || [])
      .find(capability => capability.id === 'atlasmind.workflow.allowIssueWrites');
    const planningStage = workflow.workflowConfig && workflow.workflowConfig.config
      ? (workflow.workflowConfig.config.stages || []).find(stage => stage.id === 'planning')
      : undefined;
    const issueIntakePosture = !workflow.enabled
      ? 'The workflow master switch is off.'
      : !issueWriteCapability || !issueWriteCapability.enabled
        ? 'Issue writes are disabled.'
        : workflow.automationLevel === 'off' || workflow.automationLevel === 'observe' || workflow.automationLevel === 'draft'
          ? `Your automation ceiling is ${workflow.automationLevel || 'observe'}.`
          : !planningStage || planningStage.automationLevel === 'off' || planningStage.automationLevel === 'observe' || planningStage.automationLevel === 'draft'
            ? `The Planning & issue intake stage is ${planningStage ? planningStage.automationLevel : 'observe'}.`
            : 'Issue drafts may be proposed, but every public post still requires review and confirmation.';
    const visible = list.filter(issue => {
      if (filter === 'open' && issue.state !== 'open') { return false; }
      if (filter === 'closed' && issue.state !== 'closed') { return false; }
      if (filter === 'unassigned' && (issue.state !== 'open' || (issue.assignees || []).length > 0)) { return false; }
      if (!search) { return true; }
      return [issue.title, String(issue.number), issue.author, (issue.labels || []).join(' ')]
        .some(value => String(value || '').toLowerCase().indexOf(search) >= 0);
    });

    return `
      ${pageSectionOpen('issues')}
        ${renderPageIntro({
          kicker: 'Issue tracker',
          title: 'What has been reported',
          summary: ready
            ? `${escapeHtml(summary.summary)} ${issues.loadedAt ? `Read ${escapeHtml(relativeLabel(issues.loadedAt))}.` : ''} Issue text is written by other people — AtlasMind treats it as a report to check, never as instructions.`
            : escapeHtml(issues.detail || 'Issues have not been loaded yet.'),
          chips: ready
            ? [
              { label: `${summary.openCount} open`, tone: summary.openCount > 0 ? 'warn' : 'good' },
              { label: `${summary.unassignedCount} unassigned`, tone: summary.unassignedCount > 0 ? 'warn' : 'good' },
              { label: `${summary.staleCount} stale`, tone: summary.staleCount > 0 ? 'critical' : 'good' },
            ]
            : [{ label: issues.status === 'not-loaded' ? 'Not loaded' : 'Unavailable', tone: 'warn' }],
        })}

        ${ready ? '' : `
          <article class="panel-card">
            <p class="section-kicker">Connect the tracker</p>
            <h3>${escapeHtml(issues.status === 'not-loaded' ? 'Load this repository\'s issues' : 'Issues are not available')}</h3>
            <div class="stat-detail">${escapeHtml(issues.detail || '')}</div>
            ${issues.fixCommand ? `<div class="policy-report-line"><code>${escapeHtml(issues.fixCommand)}</code></div>` : ''}
            <div class="tag-row">
              ${renderRefreshAction('issues-refresh', 'Load issues', refreshBusy, { busyLabel: 'Loading issues…', primary: true })}
            </div>
          </article>
        `}

        ${ready ? `
          <article class="panel-card ${unlinkedOpenPullRequests.length > 0 || (summary.openCount === 0 && commitsSinceTag > 0) ? 'status-warn' : ''}">
            <div class="row-head">
              <div>
                <p class="section-kicker">Tracking coverage</p>
                <h3>${unlinkedOpenPullRequests.length > 0 || (summary.openCount === 0 && commitsSinceTag > 0)
                  ? 'Work exists outside the issue tracker'
                  : 'Issue intake is review-and-confirm'}</h3>
              </div>
              ${unlinkedOpenPullRequests.length > 0
                ? `<span class="tag tag-warn">${unlinkedOpenPullRequests.length} unlinked PR${unlinkedOpenPullRequests.length === 1 ? '' : 's'}</span>`
                : ''}
            </div>
            <p class="stat-detail">AtlasMind does not silently turn commits or pull requests into public issues. It prepares a draft from a roadmap item or an unlinked pull request; you review it, and a separate confirmation is the only step that posts it.</p>
            <div class="mini-grid">
              ${renderMetricPill('Open issues', String(summary.openCount), { tone: summary.openCount > 0 ? 'accent' : 'warn' })}
              ${renderMetricPill('Commits since last tag', String(commitsSinceTag), { tone: commitsSinceTag > 0 ? 'accent' : 'good' })}
              ${renderMetricPill('Open PRs without an issue', String(unlinkedOpenPullRequests.length), {
                tone: unlinkedOpenPullRequests.length > 0 ? 'warn' : 'good',
                action: unlinkedOpenPullRequests.length > 0 ? { page: 'pullRequests', hint: 'Review pull requests' } : undefined,
              })}
            </div>
            <p class="stat-detail">${escapeHtml(issueIntakePosture)} ${summary.openCount === 0 && commitsSinceTag > 0 ? 'No single commit proves that an issue was required, but the combination is a traceability warning worth reviewing.' : ''}</p>
            <div class="tag-row">
              <button type="button" class="action-link primary" data-action="issues-new">Draft a new issue</button>
              ${unlinkedOpenPullRequests.length > 0 ? '<button type="button" class="action-link" data-action="page" data-payload="pullRequests">Review unlinked PRs</button>' : ''}
              <button type="button" class="action-link" data-action="page" data-payload="workflow">Review workflow gates</button>
            </div>
          </article>

          <div class="panel-grid">
            <article class="panel-card">
              <p class="section-kicker">${escapeHtml(issues.repoSlug || 'Repository')}</p>
              <h3>Issue mix</h3>
              <div class="mini-grid">
                ${renderMetricPill('Open', String(summary.openCount), { tone: summary.openCount > 0 ? 'warn' : 'good' })}
                ${renderMetricPill('Recently closed', String(summary.closedCount), { tone: 'good' })}
                ${renderMetricPill('Unassigned', String(summary.unassignedCount), { tone: summary.unassignedCount > 0 ? 'warn' : 'good' })}
                ${renderMetricPill('Stale', String(summary.staleCount), { tone: summary.staleCount > 0 ? 'critical' : 'good' })}
              </div>
              ${renderDistributionBar('issue-labels', (summary.byLabel || []).map((entry, index) => ({
                label: entry.label,
                value: entry.count,
                tone: SLICE_TONES[index % SLICE_TONES.length],
              })), {
                title: 'Open issues by label',
                caption: `${summary.openCount} open`,
                emptyLabel: 'No labels on the open issues.',
              })}
              <div class="tag-row">
                ${renderRefreshAction('issues-refresh', 'Refresh issues', refreshBusy, { busyLabel: 'Refreshing issues…' })}
                <button type="button" class="action-link" data-action="issues-new">New issue</button>
              </div>
            </article>
            <article class="panel-card">
              <p class="section-kicker">Who is carrying it</p>
              <h3>Open issues by assignee</h3>
              ${renderDonutChart('issue-assignees', [
                ...(summary.byAssignee || []).map((entry, index) => ({
                  label: entry.name,
                  value: entry.count,
                  tone: SLICE_TONES[index % SLICE_TONES.length],
                })),
                ...(summary.unassignedCount > 0 ? [{ label: 'Unassigned', value: summary.unassignedCount, tone: 'muted' }] : []),
              ], {
                centerValue: String(summary.openCount),
                centerLabel: 'open',
                emptyLabel: 'Nothing open to assign.',
              })}
            </article>
          </div>

          ${state.issueDraftOpen ? renderIssueComposer() : ''}

          <article class="list-card">
            <div class="row-head">
              <div>
                <p class="section-kicker">Tracker</p>
                <h3>${escapeHtml(`${visible.length} issue${visible.length === 1 ? '' : 's'}`)}</h3>
              </div>
              <div class="segmented" role="group" aria-label="Issue filter">
                ${[['open', 'Open'], ['unassigned', 'Unassigned'], ['closed', 'Closed'], ['all', 'All']].map(pair =>
                  `<button type="button" data-action="issues-filter" data-payload="${escapeAttr(pair[0])}" class="${filter === pair[0] ? 'active' : ''}" aria-pressed="${filter === pair[0] ? 'true' : 'false'}">${escapeHtml(pair[1])}</button>`).join('')}
              </div>
            </div>
            <div class="ideation-chip-row">
              <input id="issue-search-input" class="ideation-input" type="search" placeholder="Search by title, number, author, or label" value="${escapeAttr(state.issueSearch || '')}" />
            </div>
            <div class="stack-list">
              ${visible.length > 0 ? visible.map(issue => renderIssueRow(issue)).join('') : '<div class="dashboard-empty">No issues match this filter.</div>'}
            </div>
          </article>
        ` : ''}
        ${renderTaxonomy(snapshot)}
      </section>
    `;
  }

  function renderIssueRow(issue) {
    const isOpen = issue.state === 'open';
    const composing = state.issueCommentFor === issue.number;
    return `
      <div class="recent-item" data-dashboard-focus-kind="issue" data-dashboard-focus-id="${escapeAttr(String(issue.number))}">
        <div class="row-head">
          <strong>${escapeHtml(`#${issue.number} ${issue.title}`)}</strong>
          <span class="tag-group">
            <span class="tag ${isOpen ? 'tag-warn' : 'tag-good'}">${escapeHtml(issue.state)}</span>
            ${(issue.labels || []).slice(0, 3).map(label => `<span class="tag">${escapeHtml(label)}</span>`).join('')}
          </span>
        </div>
        <div class="list-meta">${escapeHtml(`${issue.author ? `by ${issue.author}` : 'author unknown'}${(issue.assignees || []).length > 0 ? ` · assigned to ${issue.assignees.join(', ')}` : ' · unassigned'}${issue.comments > 0 ? ` · ${issue.comments} comment${issue.comments === 1 ? '' : 's'}` : ''}${issue.updatedAt ? ` · updated ${relativeLabel(issue.updatedAt)}` : ''}`)}</div>
        ${issue.body ? `<div class="list-meta issue-body">${escapeHtml(issue.body.slice(0, 320))}${issue.bodyTruncated || issue.body.length > 320 ? '…' : ''}</div>` : ''}
        <div class="tag-row">
          ${isOpen ? renderDirectorOwnerControl('issue', String(issue.number)) : ''}
          ${renderAtlasDiscussAction('issues-work', String(issue.number), `Ask AtlasMind to work on issue ${issue.number}`, { title: `Ask AtlasMind to inspect issue #${issue.number} as an untrusted report and propose or make the smallest safe change` })}
          <button type="button" class="action-link" data-action="issues-comment" data-payload="${escapeAttr(String(issue.number))}">${composing ? 'Cancel comment' : 'Comment'}</button>
          ${isOpen
            ? `<button type="button" class="action-link" data-action="issues-close" data-payload="${escapeAttr(String(issue.number))}">Close</button>`
            : `<button type="button" class="action-link" data-action="issues-reopen" data-payload="${escapeAttr(String(issue.number))}">Reopen</button>`}
          ${issue.url ? `<button type="button" class="action-link" data-action="external-url" data-payload="${escapeAttr(issue.url)}">Open on GitHub ↗</button>` : ''}
        </div>
        ${composing ? `
          <div class="panel-card stage-editor" id="issue-comment-editor">
            <p class="section-kicker">${escapeHtml(`Comment on #${issue.number}`)}</p>
            <textarea class="roadmap-textarea" data-issue-field="comment" rows="3" placeholder="What should the reporter know?"></textarea>
            <div class="stat-detail">Posting is public to anyone who can see the repository. AtlasMind asks you to confirm before it sends.</div>
            <div class="tag-row">
              <button type="button" class="action-link primary" data-action="issues-comment-send" data-payload="${escapeAttr(String(issue.number))}">Post comment</button>
            </div>
          </div>` : ''}
      </div>
    `;
  }

  function renderIssueComposer() {
    const prefill = state.issuePrefill || {};
    // Only milestones already on the repository are offered. `gh` fails on an
    // unknown one, and that failure reaches the user as a raw CLI error rather
    // than an explanation — so the host refuses it too.
    const taxonomy = (state.snapshot && state.snapshot.taxonomy) || {};
    const milestones = (taxonomy.milestones || []).filter(m => m && m.state !== 'closed');
    return `
      <article class="panel-card stage-editor" id="issue-composer">
        <p class="section-kicker">New issue</p>
        <h3>Open an issue on this repository</h3>
        <div class="stage-edit-grid">
          <label class="stage-edit-field" style="grid-column:1 / -1;"><span>Title *</span><input type="text" data-issue-field="title" placeholder="Short, specific summary" value="${escapeAttr(prefill.title || '')}" /></label>
          <label class="stage-edit-field" style="grid-column:1 / -1;"><span>Labels (comma separated)</span><input type="text" data-issue-field="labels" placeholder="bug, docs" value="${escapeAttr((prefill.labels || []).join(', '))}" /></label>
          ${milestones.length > 0 ? `<label class="stage-edit-field" style="grid-column:1 / -1;"><span>Milestone</span>
            <select data-issue-field="milestone">
              <option value="">None</option>
              ${milestones.map(m => `<option value="${escapeAttr(m.title)}">${escapeHtml(m.title)}</option>`).join('')}
            </select></label>` : ''}
        </div>
        <textarea class="roadmap-textarea" data-issue-field="body" rows="5" placeholder="What happened, what you expected, and how to reproduce it.">${escapeHtml(prefill.body || '')}</textarea>
        ${(prefill.droppedLabels || []).length > 0
          ? `<p class="stat-detail">Not labelled ${prefill.droppedLabels.map(label => `<code>${escapeHtml(label)}</code>`).join(', ')} — no matching label exists on this repository, and AtlasMind does not create one as a side effect of filing. Add it on GitHub first if you want it.</p>`
          : ''}
        <div class="stat-detail">This posts to the repository's public tracker. AtlasMind shows you exactly what will be sent and asks you to confirm first.</div>
        <div class="stage-edit-actions">
          <button type="button" class="action-link primary" data-action="issues-create">Create issue</button>
          <button type="button" class="action-link" data-action="issues-new-cancel">Cancel</button>
        </div>
      </article>
    `;
  }

  // ── Workflow ───────────────────────────────────────────────────────────
  // The guided GitHub workflow: what the eight stages are, why each exists,
  // how far this repository has got, and what the numbers say.
  //
  // Written for somebody who has not done this before. Every step carries a "?"
  // opening its why/how/what-goes-wrong, and every empty state explains what the
  // thing is *for* rather than reporting that it is empty — the opposite of the
  // convention elsewhere on this dashboard, deliberately, because a blank
  // Workflow page is most likely being read by the person who most needs it.

  const WF_MARK = { done: '✅', todo: '⬜', blocked: '⛔', optional: '🔹' };
  const WF_STATUS_WORD = { done: 'done', todo: 'to do', blocked: 'blocked', optional: 'optional' };

  /** A "?" toggle plus, when open, the explanation panel it controls. */
  function renderWorkflowHelp(id, payload) {
    const open = state.workflowHelpOpen[id] === true;
    const button = `<button type="button" class="wf-help-toggle" data-action="workflow-help" data-payload="${escapeAttr(id)}"
      aria-expanded="${open ? 'true' : 'false'}" aria-controls="wf-help-${escapeAttr(id)}"
      aria-label="${open ? 'Hide' : 'Show'} the explanation for ${escapeAttr(payload.label || 'this step')}">?</button>`;
    if (!open) { return { button, panel: '' }; }

    const section = (heading, body) => body ? `<h5>${escapeHtml(heading)}</h5>${body}` : '';
    const lines = (payload.how || []).map(line => {
      const text = `<li>${escapeHtml(line.text || '')}`;
      const command = line.command
        ? `<div><code>${escapeHtml(line.command)}</code></div>`
        : '';
      // A URL is rendered as text, not an anchor: the dashboard's CSP requires
      // a nonce for scripts and external navigation goes through the host, so a
      // raw href would either be dead or a hole.
      const url = line.url ? `<div class="wf-unknown">${escapeHtml(line.url)}</div>` : '';
      return `${text}${command}${url}</li>`;
    }).join('');

    const mistakes = (payload.commonMistakes || []).length
      ? `<div class="wf-help-panel wf-help-mistakes"><h5>What goes wrong</h5><ul>${
        payload.commonMistakes.map(item => `<li>${escapeHtml(item)}</li>`).join('')
      }</ul></div>`
      : '';

    const terms = (payload.glossary || [])
      .map(key => (snapshotGlossary() || {})[key])
      .filter(Boolean);
    const glossary = terms.length
      ? section('Terms', `<dl class="wf-glossary">${terms.map(entry =>
        `<dt>${escapeHtml(entry.term)}</dt><dd>${escapeHtml(entry.definition)}</dd>`).join('')}</dl>`)
      : '';

    const panel = `
      <div class="wf-help-panel" id="wf-help-${escapeAttr(id)}" role="region">
        ${section('Why this matters', `<p>${escapeHtml(payload.why || '')}</p>`)}
        ${lines ? section('How to do it', `<ol>${lines}</ol>`) : ''}
        ${glossary}
      </div>
      ${mistakes}`;
    return { button, panel };
  }

  /** Glossary lookup, keyed, from the current snapshot. */
  let wfGlossaryCache = null;
  function snapshotGlossary() { return wfGlossaryCache; }

  /**
   * The committed stage list, cached the same way.
   *
   * A toggle sends the *inverse* of the current value, so it has to read that
   * value from the same snapshot the button was drawn from — otherwise a click
   * arriving after a refresh would flip a stage the user never looked at.
   */
  let wfStageCache = null;
  function workflowStageById(id) {
    return (wfStageCache || []).find(stage => stage.id === id);
  }

  /** A metric verdict: the number, or an honest account of why there isn't one. */
  function renderVerdict(verdict, format) {
    if (verdict && verdict.known === true) {
      return escapeHtml(format ? format(verdict.value) : String(verdict.value));
    }
    const reason = verdict && verdict.reason ? verdict.reason : 'Not measured.';
    const hint = verdict && verdict.fixHint ? ' ' + verdict.fixHint : '';
    return `<span class="wf-unknown" title="${escapeAttr(reason + hint)}">—</span>`;
  }

  // ── Pull Requests ──────────────────────────────────────────────────────
  // Stage 4 of the guided workflow: where a change stops being private. Issues
  // had a whole page and this had one card, which understated the stage where
  // CI runs, review happens, and the reasoning gets recorded.

  const PR_STATE_TONE = { open: '', draft: 'tag-warn', merged: 'tag-good', closed: '' };

  /**
   * The line-level review comments on one pull request.
   *
   * This is the actionable half of a review — somebody pointing at a line and
   * saying what is wrong with it — and "address the review" used to mean
   * handing a model every comment at once and hoping it found the place.
   *
   * Every comment is third-party text, so it is escaped here and fenced on the
   * way to a model. The file button uses the path the *host* validated, and
   * a comment whose path could not be trusted simply does not get one — the
   * comment is still worth reading.
   */
  function renderReviewComments(number, comments) {
    if (comments === undefined) {
      return '';
    }
    if (comments.length === 0) {
      return '<p class="stat-detail">No line comments on this review. Any feedback was left as a summary.</p>';
    }
    return `<div class="stack-list">${comments.map((comment, index) => `
      <div class="recent-item">
        <div class="row-head">
          ${comment.path
            ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(comment.path)}"
                title="Open ${escapeAttr(comment.path)}"><code>${escapeHtml(comment.path)}${comment.line > 0 ? ':' + comment.line : ''}</code></button>`
            : '<span class="list-meta">no file named — the comment is on an outdated diff</span>'}
          <span class="list-meta">${escapeHtml(comment.author || 'a reviewer')}</span>
        </div>
        <p class="stat-detail">${escapeHtml(comment.body)}${comment.bodyTruncated ? '…' : ''}</p>
        <div class="tag-row">
          <button type="button" class="action-link" data-action="address-review-comment" data-payload="${pr_number_index(number, index)}">Address this one</button>
          ${comment.url ? `<button type="button" class="action-link" data-action="external-url" data-payload="${escapeAttr(comment.url)}">Open on GitHub</button>` : ''}
        </div>
      </div>`).join('')}</div>`;
  }

  /** `number:index`, the pair the host looks both halves up by. */
  function pr_number_index(number, index) {
    return String(number) + ':' + String(index);
  }

  function renderPullRequests(snapshot) {
    const wf = snapshot.guidedWorkflow || {};
    const metrics = wf.pullRequests;
    const records = wf.pullRequestRecords;
    const refreshBusy = state.repositoryRefreshBusy || Boolean((snapshot.issues || {}).busy);
    // Keyed by number, and `undefined` for a pull request nobody has asked
    // about. Absent and empty are different facts here: one offers the button,
    // the other says the review left no line comments.
    const reviewComments = wf.reviewComments || {};

    const intro = renderPageIntro({
      kicker: 'Stage 4',
      title: 'Pull requests and review',
      summary: metrics
        ? `${metrics.open} open, ${metrics.awaitingReview} awaiting review, ${metrics.merged} merged in the window.`
        : 'Pull requests have not been read yet. AtlasMind normally loads a bounded GitHub snapshot when the dashboard opens; you can retry it here.',
      chips: metrics && metrics.awaitingReview > 0
        ? [{ label: `${metrics.awaitingReview} awaiting review`, tone: 'warn' }]
        : [],
    });

    if (!metrics) {
      return `${pageSectionOpen('pullRequests')}
        ${intro}
        <div class="dashboard-empty"><div>
          <strong>Pull requests have not been loaded</strong>
          <p class="section-copy">A pull request is where a change stops being private: the point CI runs, the point a second pair of eyes can see it, and the durable record of why the change looked right at the time. Even working alone it is worth opening one — CI is the reviewer.</p>
          ${renderRefreshAction('issues-refresh', 'Load GitHub activity', refreshBusy, { busyLabel: 'Loading GitHub…', primary: true })}
        </div></div>
      </section>`;
    }

    const open = (records || []).filter(pr => pr.state === 'open' || pr.state === 'draft');

    const list = open.length > 0
      ? open.map(pr => {
        const comments = reviewComments[String(pr.number)];
        const reviews = pr.reviews || [];
        const submitted = reviews.filter(r => r.verdict !== 'pending');
        const changesRequested = submitted.some(r => r.verdict === 'changes-requested');
        const approved = submitted.some(r => r.verdict === 'approved');
        const size = (pr.additions || 0) + (pr.deletions || 0);
        return `
          <div class="recent-item" data-dashboard-focus-kind="pull-request" data-dashboard-focus-id="${escapeAttr(String(pr.number))}">
            <div class="row-head">
              <strong>#${escapeHtml(String(pr.number))} ${escapeHtml(pr.title)}</strong>
              <span class="tag ${PR_STATE_TONE[pr.state] || ''}">${escapeHtml(pr.state)}</span>
            </div>
            <div class="list-meta">
              ${escapeHtml(pr.headRefName)} → ${escapeHtml(pr.baseRefName)}
              ${pr.author ? ' · ' + escapeHtml(pr.author) : ''}
              · ${size} line${size === 1 ? '' : 's'}
            </div>
            <div class="tag-row">
              ${renderDirectorOwnerControl('pull-request', String(pr.number))}
              ${changesRequested ? '<span class="tag tag-critical">changes requested</span>' : ''}
              ${approved && !changesRequested ? '<span class="tag tag-good">approved</span>' : ''}
              ${submitted.length === 0 ? '<span class="tag tag-warn">awaiting review</span>' : ''}
              ${(pr.linkedIssues || []).length === 0
                // Stated rather than left out: an unlinked PR means the diff and
                // the reasoning behind it end up in separate places.
                ? `<span class="tag tag-warn">no linked issue</span>
                   <button type="button" class="action-link" data-action="pr-draft-issue" data-payload="${pr.number}">Draft tracking issue</button>`
                : `<span class="tag">closes #${escapeHtml(String(pr.linkedIssues[0]))}</span>`}
              ${pr.url ? `<button type="button" class="action-link" data-action="external-url" data-payload="${escapeAttr(pr.url)}">Open on GitHub</button>` : ''}
              ${comments === undefined
                ? `<button type="button" class="action-link" data-action="load-review-comments" data-payload="${pr.number}">Read the review comments</button>`
                : ''}
            </div>
            ${renderReviewComments(pr.number, comments)}
          </div>`;
      }).join('')
      : `<div class="dashboard-empty"><div>
          <strong>No open pull requests</strong>
          <p class="section-copy">Nothing is in flight. The metrics below still describe what has merged.</p>
        </div></div>`;

    return `${pageSectionOpen('pullRequests')}
      ${intro}
      <div class="tag-row">
        ${renderRefreshAction('issues-refresh', 'Refresh GitHub activity', refreshBusy, { busyLabel: 'Refreshing GitHub…' })}
      </div>
      <article class="panel-card">
        <p class="card-kicker">In flight</p>
        <div class="stack-list">${list}</div>
      </article>
      <div class="panel-grid">
        <article class="panel-card">
          <p class="card-kicker">Review health</p>
          <div class="mini-grid">
            ${renderMetricPill('Time to first review', formatDuration(metrics.medianTimeToFirstReviewMs))}
            ${renderMetricPill('Time to merge', formatDuration(metrics.medianTimeToMergeMs))}
            ${renderMetricPill('Linked to an issue', renderVerdictText(metrics.linkedRate, value => `${value}%`))}
          </div>
          <p class="stat-detail">A long time to first review usually means work is queued rather than that people are slow — the fix is scheduling, not effort. Medians below three samples report no verdict rather than a misleading number.</p>
        </article>
        <article class="panel-card">
          <p class="card-kicker">Size</p>
          ${renderDistributionBar('pr-size', metrics.sizeDistribution || [], {
            title: 'Merged pull requests by lines changed',
            caption: 'A 40-line diff gets read; a 400-line one gets skimmed',
            emptyLabel: 'Nothing merged yet to size.',
          })}
        </article>
      </div>
      ${renderChartCard('pr-throughput', 'Merge throughput',
        'Pull requests merged per day. Long flat stretches usually mean work is waiting in review rather than that nobody is writing it.',
        (metrics.throughput || []).map(point => ({ label: point.label, value: point.value })), 'pullRequests')}
    </section>`;
  }

  // ── Pipeline ───────────────────────────────────────────────────────────
  // Stage 5. AtlasMind reads check *states* everywhere else; this is the page
  // where it reads a *log* and says why something failed.

  // ── Labels and milestones ───────────────────────────────────
  // The taxonomy stage 1 draws from. Managed here because a rule that draws
  // only from the declared set is only as good as the set behind it.

  function renderTaxonomy(snapshot) {
    const taxonomy = snapshot.taxonomy || { loaded: false, labels: [], milestones: [], drift: {} };
    const drift = taxonomy.drift || {};

    const help = renderWorkflowHelp('issues.taxonomy', {
      label: 'why the label set matters',
      why: 'When AtlasMind drafts an issue it takes labels only from the declared taxonomy, and drops anything that does not match rather than inventing it. That rule is what stops a drafter making up categories — and it is only as good as the set behind it. A declared label that does not exist on the repository gets silently dropped from every draft; a label people are using that is not declared will never be suggested.',
      how: [
        { text: 'Deleting a label removes it from the repository and from every issue carrying it, in one step GitHub cannot undo. AtlasMind names the issues before you confirm — GitHub does not.' },
        { text: 'If you want to stop using a label without losing the record, rename it rather than deleting it.' },
        { text: 'A milestone is closed, never deleted. Deleting one detaches every issue from it silently; closing preserves the record, which is what a milestone is for.' },
        { text: 'A colour must be six hex digits. Anything else is dropped rather than repaired — the value is rendered into a style attribute, and a nearly-valid colour made plausible is worse than a missing swatch.' },
      ],
      commonMistakes: [
        'Deleting a label to tidy up, and losing the categorisation on every closed issue that had it.',
        'Declaring a taxonomy in `workflow.json` and never creating the labels, so every draft silently drops them.',
      ],
    });

    if (!taxonomy.loaded) {
      return `
        <article class="panel-card">
          <p class="card-kicker">Labels and milestones${help.button}</p>
          ${help.panel}
          <div class="dashboard-empty"><div>
            <strong>Not read yet</strong>
            <p class="section-copy">The label set is what AtlasMind draws from when it drafts an issue — it uses only what is declared and drops the rest rather than inventing categories. Refresh the issue list to read it.</p>
          </div></div>
        </article>`;
    }

    const labelRows = (taxonomy.labels || []).map(label => `
      <div class="recent-item">
        <div class="row-head">
          <span>
            ${label.color ? `<span class="label-swatch" style="background:#${escapeAttr(label.color)}"></span>` : ''}
            <strong>${escapeHtml(label.name)}</strong>
          </span>
          <span class="list-meta">${label.issueCount} issue${label.issueCount === 1 ? '' : 's'}</span>
        </div>
        ${label.description ? `<div class="list-meta">${escapeHtml(label.description)}</div>` : ''}
        <div class="tag-row">
          <button type="button" class="action-link" data-action="delete-label" data-payload="${escapeAttr(label.name)}">Delete…</button>
        </div>
      </div>`).join('');

    const milestoneRows = (taxonomy.milestones || []).map(milestone => `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(milestone.title)}</strong>
          <span class="tag ${milestone.state === 'closed' ? 'tag-good' : 'tag-warn'}">${escapeHtml(milestone.state)}</span>
        </div>
        <div class="list-meta">
          ${milestone.openIssues} open · ${milestone.closedIssues} closed
          ${milestone.dueOn ? ' · due ' + escapeHtml(milestone.dueOn) : ' · no due date'}
        </div>
        ${milestone.state === 'open'
          ? `<div class="tag-row"><button type="button" class="action-link" data-action="close-milestone" data-payload="${milestone.number}">Close it</button></div>`
          : ''}
      </div>`).join('');

    return `
      <div class="panel-grid">
        <article class="panel-card">
          <div class="row-head">
            <p class="card-kicker">Labels${help.button}</p>
            <span class="list-meta">${(taxonomy.labels || []).length}</span>
          </div>
          ${help.panel}
          ${drift.summary && (drift.missing || []).length + (drift.undeclared || []).length > 0
            ? `<p class="stat-detail wf-unknown">${escapeHtml(drift.summary)}</p>`
            : drift.summary ? `<p class="stat-detail">${escapeHtml(drift.summary)}</p>` : ''}
          <div class="stack-list">${labelRows || '<div class="dashboard-empty">This repository has no labels. A draft will carry none until some exist.</div>'}</div>
          <div class="tag-row">
            <input id="label-new-name" class="ideation-input" type="text" placeholder="New label name" />
            <input id="label-new-color" class="ideation-input" type="text" placeholder="Colour (6 hex digits, optional)" maxlength="6" />
            <button type="button" class="action-link" data-action="create-label">Create it</button>
          </div>
        </article>
        <article class="panel-card">
          <div class="row-head">
            <p class="card-kicker">Milestones</p>
            <span class="list-meta">${(taxonomy.milestones || []).length}</span>
          </div>
          <div class="stack-list">${milestoneRows || '<div class="dashboard-empty">No milestones. Issues will have nothing to be scheduled against.</div>'}</div>
          <div class="tag-row">
            <input id="milestone-new-title" class="ideation-input" type="text" placeholder="New milestone title" />
            <button type="button" class="action-link" data-action="create-milestone">Create it</button>
          </div>
          <p class="stat-detail">A milestone is closed, never deleted. Deleting one detaches every issue from it silently; closing preserves the record, which is what a milestone is for.</p>
        </article>
      </div>`;
  }

  // ── Tech Debt ──────────────────────────────────────────────────────────
  // Stage 7. The one page whose value depends entirely on being *comparable*
  // over time, which is why severity comes from a published rule table rather
  // than from a judgement call somebody made on a Tuesday.

  const DEBT_SEVERITY_TONE = { high: 'tag-critical', medium: 'tag-warn', low: '' };
  const DEBT_STATUS_TONE = { open: 'tag-warn', accepted: '', scheduled: '', resolved: 'tag-good', obsolete: '' };

  function renderDebt(snapshot) {
    const debt = snapshot.debt || { entries: [], metrics: {}, rules: [] };
    const metrics = debt.metrics || {};
    const entries = debt.entries || [];
    const allOpen = entries.filter(entry =>
      entry.status === 'open' || entry.status === 'accepted' || entry.status === 'scheduled');

    // Search covers the title, the path and the rule, because those are the
    // three things somebody already knows when they come looking: what it
    // said, where it was, or which marker found it.
    const needle = (state.debtSearch || '').trim().toLowerCase();
    const ruleFilter = state.debtRuleFilter || 'all';
    const openEntries = allOpen.filter(entry => {
      if (ruleFilter !== 'all' && entry.rule !== ruleFilter) { return false; }
      if (!needle) { return true; }
      return (entry.title || '').toLowerCase().includes(needle)
        || (entry.evidencePath || '').toLowerCase().includes(needle)
        || (entry.rule || '').toLowerCase().includes(needle);
    });
    const filtered = openEntries.length !== allOpen.length;

    const help = renderWorkflowHelp('debt.rules', {
      label: 'how severity is decided',
      why: 'Taking on debt is often the right call — the metaphor is exact, and borrowing to ship sooner is legitimate. The danger is the interest you pay by forgetting it exists. A register is only worth keeping if its grades are comparable, so severity comes from a published rule table and never from a judgement call: a score assigned last Tuesday cannot be compared with one assigned today, and comparability is the whole point.',
      how: (debt.rules || []).map(rule => ({ text: rule.id + ' → ' + rule.severity + '. ' + rule.describes })).concat([
        { text: 'Severity does not drift with age. An entry whose grade changed while nothing about the code changed could not be compared with last month’s. Age is shown separately instead.' },
        { text: 'Entries transition; nothing is ever deleted. A resolved item is evidence the work was done; a vanished one is a gap in the record.' },
        { text: 'When a marker disappears and nobody said they fixed it, the entry becomes obsolete rather than resolved. “The line is gone” and “somebody did the work” are different facts, and only one of them is an accomplishment.' },
      ]),
      commonMistakes: [
        'Reading an empty register as “no debt”. It means nothing was found, or nothing was scanned.',
        'Deleting entries to make the number look better. The number is the only reason the register is worth keeping.',
      ],
    });

    const intro = renderPageIntro({
      kicker: 'Stage 7',
      title: 'What you deferred, and how long ago',
      summary: debt.lastScanAt
        ? openEntries.length + ' open, ' + (metrics.resolved || 0) + ' resolved. Last scanned ' + (debt.lastScanAt || '').slice(0, 10) + '.'
        : 'Nothing has been scanned yet. A solo developer has no colleague who remembers the shortcut, and a studio has no shared memory of it either.',
      chips: (metrics.bySeverity || []).map(slice => ({
        label: slice.value + ' ' + slice.label,
        tone: slice.key === 'high' ? 'critical' : slice.key === 'medium' ? 'warn' : 'neutral',
      })),
    });

    if (!debt.lastScanAt && entries.length === 0) {
      return pageSectionOpen('debt') + intro + `
        <div class="dashboard-empty"><div>
          <strong>No register yet</strong>
          <p class="section-copy">A scan reads your source for <code>TODO</code>, <code>FIXME</code>, <code>HACK</code> and <code>XXX</code> markers and records each one with its file, its line, and the rule that graded it. Nothing is ever deleted — entries transition, so the register stays a complete account of what was deferred and what became of it.</p>
          <p class="section-copy">An empty register means nothing was found or nothing was scanned. It does not mean there is no debt.</p>
          <button type="button" class="action-link" data-action="scan-debt"${debt.scanning ? ' disabled' : ''}>${debt.scanning ? 'Scanning…' : 'Scan this workspace'}</button>
        </div></div>
      </section>`;
    }

    // Only rules that actually graded something get a chip. A filter for a
    // rule with no entries is a button that does nothing, and a project's own
    // markers are the ones most worth filtering by — so the list is derived
    // from the register rather than from the rule table.
    const rulesInUse = [...new Set(allOpen.map(entry => entry.rule))]
      .sort()
      .map(id => ({ id, label: id }));

    const rows = openEntries.slice(0, 200).map(entry => `
      <div class="recent-item" data-dashboard-focus-kind="debt" data-dashboard-focus-id="${escapeAttr(entry.id)}">
        <div class="row-head">
          <button type="button" class="action-link" data-action="open-debt-evidence" data-payload="${escapeAttr(entry.id)}"
            title="Open ${escapeAttr(entry.evidencePath)}">${escapeHtml(entry.title)}</button>
          <span>
            <span class="tag ${DEBT_SEVERITY_TONE[entry.severity] || ''}">${escapeHtml(entry.severity)}</span>
            <span class="tag ${DEBT_STATUS_TONE[entry.status] || ''}">${escapeHtml(entry.status)}</span>
          </span>
        </div>
        <div class="list-meta"><code>${escapeHtml(entry.evidencePath)}${entry.evidenceLine ? ':' + entry.evidenceLine : ''}</code> · ${escapeHtml(entry.domain)} · since ${escapeHtml((entry.detectedAt || '').slice(0, 10))} · graded by <code>${escapeHtml(entry.rule)}</code></div>
        <div class="tag-row">
          ${renderDirectorOwnerControl('debt', entry.id)}
          ${entry.status !== 'accepted' ? `<button type="button" class="action-link" data-action="set-debt-status" data-payload="accepted ${escapeAttr(entry.id)}">Accept</button>` : ''}
          ${entry.status !== 'scheduled' ? `<button type="button" class="action-link" data-action="set-debt-status" data-payload="scheduled ${escapeAttr(entry.id)}">Schedule</button>` : ''}
          <button type="button" class="action-link" data-action="set-debt-status" data-payload="resolved ${escapeAttr(entry.id)}">Mark resolved</button>
          ${renderAtlasDiscussAction('work-on-debt', entry.id, 'Ask AtlasMind to review this debt entry', { title: 'Ask AtlasMind to inspect this debt record and propose whether to fix, retain, or reclassify it' })}
        </div>
      </div>`).join('');

    return pageSectionOpen('debt') + intro + `
      <div class="panel-grid">
        <article class="panel-card">
          <p class="card-kicker">Where it is${help.button}</p>
          ${help.panel}
          <div class="mini-grid">
            ${renderMetricPill('Open', String(metrics.open || 0))}
            ${renderMetricPill('Median age', metrics.medianAgeDays === undefined ? '—' : metrics.medianAgeDays + 'd')}
            ${renderMetricPill('Resolved', String(metrics.resolved || 0), { tone: 'good' })}
          </div>
          ${renderDistributionBar('debt-severity', (metrics.bySeverity || []).map(slice => ({
            key: slice.key,
            label: slice.label,
            value: slice.value,
            tone: slice.key === 'high' ? 'critical' : slice.key === 'medium' ? 'warn' : 'accent',
          })), {
            title: 'Open by severity',
            caption: 'Graded by rule, so this month compares with last',
            emptyLabel: 'Nothing open.',
          })}
          ${renderDonutChart('debt-domain', metrics.byDomain || [], { emptyLabel: 'Nothing open.' })}
        </article>
        <article class="panel-card">
          <p class="card-kicker">How long it has been there</p>
          ${renderDistributionBar('debt-age', metrics.ageDistribution || [], {
            title: 'Open entries by age',
            caption: 'The shape matters more than the total — a long tail is deferral becoming permanent',
            emptyLabel: 'Nothing open.',
          })}
          ${metrics.oldest
            ? `<p class="stat-detail">Oldest open: <strong>${escapeHtml(metrics.oldest.title)}</strong> in <code>${escapeHtml(metrics.oldest.evidencePath)}</code>, since ${escapeHtml((metrics.oldest.detectedAt || '').slice(0, 10))}.</p>`
            : ''}
          ${metrics.obsolete
            ? `<p class="stat-detail wf-unknown">${metrics.obsolete} entr${metrics.obsolete === 1 ? 'y has' : 'ies have'} gone obsolete — the evidence disappeared and nobody recorded fixing it. That is not the same as resolved, and the register keeps them apart.</p>`
            : ''}
          <button type="button" class="action-link" data-action="scan-debt"${debt.scanning ? ' disabled' : ''}>${debt.scanning ? 'Scanning…' : 'Rescan'}</button>
        </article>
      </div>
      <article class="panel-card">
        <div class="row-head">
          <p class="card-kicker">Open entries</p>
          <span class="list-meta">${filtered ? openEntries.length + ' of ' + allOpen.length : allOpen.length}</span>
        </div>
        <input id="debt-search-input" class="ideation-input" type="search"
          placeholder="Search by what it says, where it is, or which marker found it"
          value="${escapeAttr(state.debtSearch || '')}" />
        ${rulesInUse.length > 1
          ? `<div class="segmented" role="group" aria-label="Filter by marker">${
            [{ id: 'all', label: 'All markers' }].concat(rulesInUse).map(entry => `
              <button type="button" data-action="set-debt-rule-filter" data-payload="${escapeAttr(entry.id)}"
                class="${ruleFilter === entry.id ? 'active' : ''}"
                aria-pressed="${ruleFilter === entry.id ? 'true' : 'false'}">${escapeHtml(entry.label)}</button>`).join('')}</div>`
          : ''}
        <div class="stack-list">${rows || `<div class="dashboard-empty">${
          filtered
            ? 'Nothing matches that. ' + allOpen.length + ' open entr' + (allOpen.length === 1 ? 'y' : 'ies') + ' in total.'
            : 'Nothing open. Every entry has been resolved, accepted, or gone obsolete.'}</div>`}</div>
        ${openEntries.length > 200 ? `<p class="stat-detail">Showing 200 of ${openEntries.length}. The rest are in <code>${escapeHtml(debt.path || '')}</code>.</p>` : ''}
      </article>
    </section>`;
  }

  // ── Release ────────────────────────────────────────────────────────────
  // Stage 6. Two questions that look like one: *can* this version be released
  // (the gates), and *how is delivery going* (the four keys). The first is about
  // one moment, the second about a quarter, and a page that mixed them would
  // answer neither.

  const GATE_TONE = { pass: 'tag-good', fail: 'tag-critical', unknown: 'tag-warn' };
  const GATE_WORD = { pass: 'ready', fail: 'blocked', unknown: 'unknown' };
  const DORA_BAND_TONE = { elite: 'tag-good', high: 'tag-good', medium: 'tag-warn', low: 'tag-critical' };

  function renderRelease(snapshot) {
    const rel = snapshot.release || {};
    const plan = rel.plan || { gates: [], blockedBy: [] };
    const dora = rel.dora || { bands: {}, failures: [] };
    const notes = plan.notes;

    const intro = renderPageIntro({
      kicker: 'Stage 6',
      title: 'Release preparation and delivery performance',
      summary: rel.planSummary || 'Nothing evaluated yet.',
      chips: [
        { label: plan.tag || '—', tone: plan.ready ? 'good' : 'warn' },
        ...(rel.loadedAt ? [] : [{ label: 'releases not read', tone: 'warn' }]),
      ],
    });

    // The gates, in evaluation order. `unknown` is rendered as its own state
    // rather than folded into failure: "we could not check" and "we checked and
    // it is wrong" call for different actions, and only one of them is yours.
    const gateRows = (plan.gates || []).map(gate => `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(gate.label)}</strong>
          <span class="tag ${GATE_TONE[gate.status] || ''}">${escapeHtml(GATE_WORD[gate.status] || gate.status)}</span>
        </div>
        <div class="list-meta">${escapeHtml(gate.detail)}</div>
        ${gate.fixHint ? `<p class="stat-detail${gate.status === 'pass' ? '' : ' wf-unknown'}">${escapeHtml(gate.fixHint)}</p>` : ''}
      </div>`).join('');

    const gateHelp = renderWorkflowHelp('release.gates', {
      label: 'why a release has gates at all',
      why: 'A published version cannot be withdrawn. Anyone who fetched a tag keeps whatever it pointed at, package registries refuse a re-publish of the same number, and a release note is a permanent public record somebody is accountable for. Every other stage of this workflow is recoverable by editing and pushing again; this one is not, which is the whole reason it is checked before rather than fixed after.',
      how: [
        { text: 'A gate reporting "unknown" is not a pass. It means the question was asked and nothing answered — usually because `gh` or `git` could not be reached — and shipping on an unknown is the habit this stage exists to break.' },
        { text: 'The tag gate is the one that catches a double publish: an existing tag means the publish workflow already fired for this version.' },
        { text: 'AtlasMind never deletes or moves a tag to make room. Anyone who already fetched it would keep the old contents under the new name, and never find out.' },
        { text: 'Release notes are the changelog section for this version, copied verbatim. Not summarised, not rewritten, and never model-generated — a generated release note is a claim nobody checked attached to a version nobody can change.' },
        { text: 'If the notes contain anything shaped like a credential, the release is refused rather than quietly redacted. Publishing an edited version of what you reviewed, without telling you what was removed, is the worse of the two failures.' },
      ],
      commonMistakes: [
        'Tagging before the changelog entry exists, so the release ships with an empty body that looks deliberate.',
        'Deleting a bad tag and re-pushing it. The tag moves; the copies people already fetched do not.',
        'Treating a green tick from an unread pipeline as a passing build.',
      ],
    });

    const planCard = `
      <article class="panel-card">
        <div class="row-head">
          <p class="card-kicker">Release gates${gateHelp.button}</p>
          <span class="tag ${plan.ready ? 'tag-good' : 'tag-warn'}">${plan.ready ? 'all clear' : (plan.blockedBy || []).length + ' outstanding'}</span>
        </div>
        ${gateHelp.panel}
        <div class="stack-list">${gateRows || '<div class="dashboard-empty">No gates evaluated.</div>'}</div>
        <p class="stat-detail">Nothing here publishes anything. Tagging and publishing stay with you at every automation level, because a released version cannot be taken back.</p>
      </article>`;

    const versionCard = `
      <article class="panel-card">
        <p class="card-kicker">Version</p>
        <div class="mini-grid">
          ${renderMetricPill('In the manifest', plan.currentVersion || '—')}
          ${renderMetricPill('Last published', plan.lastReleasedVersion || '—', { tone: plan.lastReleasedVersion ? '' : 'warn' })}
          ${renderMetricPill('Commits suggest', plan.suggestedLevel || '—')}
        </div>
        <p class="stat-detail">The suggested level comes from the conventional-commit prefixes in the range — the same rule the promotion runner uses, not a second one. A breaking change makes it major, any <code>feat:</code> makes it minor, everything else is a patch.</p>
        ${plan.lastReleasedVersion && plan.suggestedVersion !== plan.currentVersion
          ? `<p class="stat-detail wf-unknown">Next version on that basis: ${escapeHtml(plan.suggestedVersion || '')}.</p>`
          : ''}
      </article>`;

    const notesCard = `
      <article class="panel-card">
        <p class="card-kicker">Release notes</p>
        ${notes
          ? `<div class="list-meta">${escapeHtml(notes.heading)}</div>
             <pre class="wf-notes">${escapeHtml(notes.body)}</pre>
             ${notes.truncated ? '<p class="stat-detail wf-unknown">Truncated for display and for publishing — the changelog section is longer than the release-note limit.</p>' : ''}
             ${(notes.secretTypes || []).length
               ? `<p class="stat-detail wf-unknown">Blocked: this text contains something shaped like a credential (${escapeHtml(notes.secretTypes.join(', '))}). Remove it from the changelog and rotate the credential — AtlasMind will not publish a redacted version of notes you reviewed.</p>`
               : '<p class="stat-detail">This is what would be published, byte for byte.</p>'}`
          : `<div class="dashboard-empty"><div>
              <strong>No changelog section for this version</strong>
              <p class="section-copy">The release notes are the <code>CHANGELOG.md</code> section for the version being released, copied verbatim. Writing it is the step people skip, and the one readers actually use — it is the only place the reasoning behind a version survives after the pull request is closed.</p>
            </div></div>`}
      </article>`;

    // The four keys. Two describe speed, two describe stability, which is what
    // stops a team improving the pair it likes by ruining the other.
    const doraHelp = renderWorkflowHelp('release.dora', {
      label: 'what the four delivery keys measure',
      why: 'Deployment frequency, lead time, change failure rate and time to restore are the standard professional framing for delivery performance. They are paired on purpose: the first two describe speed and the last two describe stability, so a team cannot improve the half it likes by quietly wrecking the other. Shipping daily means nothing if a third of releases need a same-day fix.',
      how: [
        { text: `Measured over the last ${dora.windowDays || 90} days, from published releases and merged pull requests.` },
        { text: 'Lead time is measured from a pull request merging to the release that carried it — the half you can actually act on. Work that merged and has not shipped is excluded rather than counted as infinitely slow; that it is waiting is itself the finding.' },
        { text: rel.changeFailureRule || '' },
        { text: 'Draft and pre-release entries are excluded. Neither is a deployment to anybody.' },
        { text: 'The bands are the widely cited thresholds, not a certification — the exact boundaries have moved between annual industry reports, and your own trend matters far more than which side of a line you land on.' },
      ].filter(line => line.text),
    });

    const key = (label, verdict, band, format) => `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(label)}</strong>
          <span>${renderVerdict(verdict, format)}${band ? ` <span class="tag ${DORA_BAND_TONE[band] || ''}">${escapeHtml(band)}</span>` : ''}</span>
        </div>
      </div>`;

    const doraCard = `
      <article class="panel-card">
        <p class="card-kicker">Delivery performance${doraHelp.button}</p>
        ${doraHelp.panel}
        <div class="stack-list">
          ${key('Deployment frequency', dora.deploymentFrequency, dora.bands && dora.bands.deploymentFrequency, value => `${value}/week`)}
          ${key('Lead time for change', dora.leadTimeHours, dora.bands && dora.bands.leadTime, value => value < 48 ? `${value.toFixed(1)}h` : `${(value / 24).toFixed(1)}d`)}
          ${key('Change failure rate', dora.changeFailureRate, dora.bands && dora.bands.changeFailureRate, value => `${value}%`)}
          ${key('Time to restore', dora.timeToRestoreHours, dora.bands && dora.bands.timeToRestore, value => value < 48 ? `${value.toFixed(1)}h` : `${(value / 24).toFixed(1)}d`)}
        </div>
        ${(dora.failures || []).length
          ? `<p class="stat-detail">Counted as failures: ${escapeHtml(dora.failures.map(f => `${f.tag} → ${f.followedBy}`).join(', '))}. Named so the number can be argued with rather than taken on trust.</p>`
          : ''}
        ${rel.loadFailure
          ? `<p class="stat-detail wf-unknown">Releases could not be read: ${escapeHtml(rel.loadFailure)}</p>`
          : ''}
      </article>`;

    const frequencyChart = renderChartCard(
      'release-frequency',
      'Releases per day',
      `Published releases over the window. Cadence is worth watching as a shape rather than a number — a long flat stretch followed by a spike usually means work was queued, and a queued release is the one most likely to go wrong.`,
      (dora.series || []).map(point => ({ label: point.label, value: point.value })),
      'release',
    );

    const recent = (rel.releases || []).slice(0, 12).map(entry => `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(entry.tagName)}</strong>
          <span class="list-meta">${escapeHtml((entry.publishedAt || '').slice(0, 10))}</span>
        </div>
        ${entry.isPrerelease || entry.isDraft
          ? `<div class="list-meta">${entry.isDraft ? 'draft' : 'pre-release'} — excluded from the delivery metrics</div>`
          : ''}
      </div>`).join('');

    const historyCard = `
      <article class="panel-card">
        <p class="card-kicker">Published releases</p>
        ${rel.loadedAt || (rel.releases || []).length
          ? `<div class="stack-list">${recent || '<div class="dashboard-empty">This repository has no published releases yet.</div>'}</div>`
          : `<div class="dashboard-empty"><div>
              <strong>Releases have not been read</strong>
              <p class="section-copy">Reading the release list is a network call, so it happens when you ask rather than on every render. The gates above do not need it — they come from your own files, which is why they are already filled in.</p>
              <button type="button" class="action-link" data-action="page" data-payload="issues">Open the Issues tab and refresh</button>
            </div></div>`}
      </article>`;

    return `${pageSectionOpen('release')}
      ${intro}
      <div class="panel-grid">
        ${planCard}
        ${versionCard}
      </div>
      <div class="panel-grid">
        ${notesCard}
        ${doraCard}
      </div>
      ${frequencyChart}
      ${historyCard}
    </section>`;
  }

  function renderPipeline(snapshot) {
    // Computed once: the button and the panel are two halves of one control,
    // and calling the builder twice would recompute the whole payload.
    const taxonomyHelp = renderWorkflowHelp('pipeline.taxonomy', {
      label: 'how AtlasMind decides why a build failed',
      why: 'The cause is decided by an ordered rule table over the log text, first match wins, with no model in the path. That is deliberate: a taxonomy that varies run to run cannot be charted, and a chart of CI failures over time is one of the most useful things a team can look at. An agent explains a classification and proposes a fix — it never chooses the classification.',
      how: [
        { text: 'Infrastructure is checked first, because an unreachable registry looks exactly like a dependency failure — and telling somebody to fix their lockfile when npm was down wastes an afternoon.' },
        { text: 'Then dependency install, because nothing after a failed install had a chance to run; reporting the compile error would send you to fix code that never built.' },
        { text: 'Then compile, lint, test failure, and timeout — each narrower than the last.' },
        { text: 'Flakiness comes from history rather than one log: a job that both passed and failed on the same commit is flaky whatever its latest log says.' },
        { text: 'When nothing matches, the answer is unknown and it escalates. A confidently wrong root cause costs more than an honest admission.' },
        { text: 'AtlasMind never re-runs a job automatically. Re-running until green turns a flaky test into policy.' },
      ],
    });
    const wf = snapshot.guidedWorkflow || {};
    const intel = wf.ciIntelligence;
    const runs = (intel && intel.runs) || [];
    const report = intel && intel.report;
    const refreshBusy = state.repositoryRefreshBusy || Boolean((snapshot.issues || {}).busy);
    // A read that failed is not a read that found nothing. When the run list
    // itself could not be fetched, every count below would be a zero nobody
    // measured, so the failure replaces them rather than sitting above them.
    const fetchFailure = intel && intel.fetchFailure;
    const delivery = snapshot.delivery || {};
    const workflows = delivery.workflows || [];
    const management = delivery.ciManagement || {
      assessment: { state: 'unconfigured', summary: 'CI configuration was not assessed.', workflowCount: 0, jobCount: 0, cautions: [] },
      starterAvailable: false,
      starterReason: 'CI setup is unavailable for this workspace.',
    };
    const assessment = management.assessment || {};
    const stagePaths = (delivery.stages && delivery.stages.paths) || [];
    const requiredChecks = [...new Set(stagePaths.reduce((all, item) => all.concat(item.statusChecks || []), []))];
    const setupHelp = renderWorkflowHelp('pipeline.setup-model', {
      label: 'how CI is defined, assigned, and enforced',
      why: 'CI is not assigned to a developer or an agent. A workflow file defines jobs; event triggers assign those jobs to pushes, pull requests, schedules, releases, or manual runs; branch protection decides whether a successful result is required before merge. Keeping those three layers separate makes it possible to change when a check runs without accidentally changing what it does.',
      how: [
        { text: 'Definition — a workflow file under .github/workflows describes jobs, runners, steps, permissions, and timeouts.' },
        { text: 'Assignment — the on: section says which events and branches cause those jobs to run.' },
        { text: 'Enforcement — a required status check or protected-branch rule decides whether a failing or missing result blocks a merge.' },
        { text: 'AtlasMind reads existing files but does not silently rewrite them. Open edits happen in the editor; Atlas-assisted reviews begin as proposals.' },
      ],
      commonMistakes: [
        'Treating “a workflow exists” as “pull requests are protected”. A workflow can run and still be advisory.',
        'Putting deployment credentials into YAML. Workflows should name GitHub secrets, never contain their values.',
        'Adding a second starter beside an existing CI workflow and paying twice for the same checks.',
      ],
    });

    const triggerText = trigger => {
      const event = trigger.event === 'pull_request' ? 'pull request'
        : trigger.event === 'workflow_dispatch' ? 'manual'
          : trigger.event;
      const branches = trigger.branches === 'all' ? 'all branches' : (trigger.branches || []).join(', ');
      return `${event} · ${branches || 'branch scope unreadable'}`;
    };
    const workflowCards = workflows.map(workflow => `
      <div class="recent-item ci-workflow-card">
        <div class="row-head">
          <div>
            <strong>${escapeHtml(workflow.name)}</strong>
            <div class="list-meta">GitHub Actions · ${escapeHtml(workflow.role || 'automation')} · <code>${escapeHtml(workflow.path)}</code></div>
          </div>
          <span class="tag ${(workflow.cautions || []).length ? 'tag-warn' : 'tag-good'}">${(workflow.cautions || []).length ? `${workflow.cautions.length} to review` : 'readable'}</span>
        </div>
        <div class="ci-workflow-section">
          <span class="ci-workflow-label">Runs when</span>
          <div class="tag-row">${(workflow.triggers || []).length
            ? workflow.triggers.map(trigger => `<span class="tag mono">${escapeHtml(triggerText(trigger))}</span>`).join('')
            : '<span class="tag tag-warn">No supported trigger read</span>'}</div>
        </div>
        <div class="ci-workflow-section">
          <span class="ci-workflow-label">Jobs</span>
          <div class="stack-list ci-job-list">${(workflow.jobs || []).length ? workflow.jobs.map(job => `
            <div class="ci-job-row">
              <span><strong>${escapeHtml(job.name)}</strong> · ${escapeHtml(job.runsOn)}</span>
              <span class="list-meta">${escapeHtml(String(job.stepCount))} step${job.stepCount === 1 ? '' : 's'} · ${job.timeoutMinutes ? `${escapeHtml(String(job.timeoutMinutes))} min timeout` : 'no declared timeout'}</span>
            </div>`).join('') : '<span class="stat-detail wf-unknown">No jobs could be read.</span>'}</div>
        </div>
        <div class="tag-row">
          <span class="tag ${workflow.hasExplicitPermissions ? 'tag-good' : 'tag-warn'}">${workflow.hasExplicitPermissions ? 'permissions declared' : 'implicit permissions'}</span>
          <span class="tag ${workflow.hasConcurrency ? 'tag-good' : ''}">${workflow.hasConcurrency ? 'duplicate runs controlled' : 'no concurrency rule'}</span>
          ${(workflow.validations || []).map(item => `<span class="tag tag-good">${escapeHtml(item)}</span>`).join('')}
        </div>
        ${(workflow.cautions || []).length ? `<ul class="ci-caution-list">${workflow.cautions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
        <div class="tag-row ci-workflow-actions">
          <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(workflow.path)}">Open workflow</button>
          ${renderAtlasDiscussAction('pipeline-review-workflow', workflow.id, `Review ${workflow.name} with AtlasMind`, { title: 'Explain this workflow and propose a safe improvement plan' })}
        </div>
      </div>`).join('');
    const managerCard = `
      <article class="panel-card ci-manager-card">
        <div class="row-head">
          <div>
            <p class="card-kicker">CI configuration${setupHelp.button}</p>
            <strong>${escapeHtml(assessment.summary || 'CI configuration was not assessed.')}</strong>
          </div>
          <span class="tag ${assessment.state === 'ready' ? 'tag-good' : assessment.state === 'attention' ? 'tag-warn' : 'tag-critical'}">${escapeHtml(assessment.state || 'unknown')}</span>
        </div>
        ${setupHelp.panel}
        <div class="ci-concept-grid" aria-label="How CI works">
          <div class="ci-concept"><span>1</span><div><strong>Define</strong><small>Jobs and steps in workflow files</small></div></div>
          <div class="ci-concept"><span>2</span><div><strong>Assign</strong><small>Events and branches under <code>on:</code></small></div></div>
          <div class="ci-concept"><span>3</span><div><strong>Enforce</strong><small>Required checks and branch protection</small></div></div>
        </div>
        <div class="mini-grid">
          ${renderMetricPill('Quality workflows', String(assessment.qualityWorkflowCount || 0), { tone: assessment.qualityWorkflowCount ? 'good' : 'warn' })}
          ${renderMetricPill('All automation jobs', String(assessment.jobCount || 0))}
          ${renderMetricPill('Pull requests checked', assessment.pullRequestCoverage ? 'Yes' : 'No', { tone: assessment.pullRequestCoverage ? 'good' : 'warn' })}
        </div>
        <div class="ci-enforcement-note">
          <strong>Declared delivery enforcement</strong>
          <p class="stat-detail">${requiredChecks.length
            ? `AtlasMind’s delivery gates expect: ${escapeHtml(requiredChecks.join(', '))}. Confirm the same names are required in GitHub branch protection; a delivery declaration cannot enforce GitHub by itself.`
            : 'No required status-check names are bound to a delivery path. These workflows may run, but AtlasMind has no evidence that a failed result blocks promotion.'}</p>
          <button type="button" class="action-link" data-action="page" data-payload="delivery">Configure delivery check bindings</button>
        </div>
        ${management.starterAvailable ? `<div class="inline-notice warning">
          <strong>Quality CI is missing.</strong>
          <p class="stat-detail">${escapeHtml(management.starterReason || '')}</p>
          <button type="button" class="action-link primary" data-action="pipeline-create-starter">Preview starter CI</button>
        </div>` : ''}
        ${workflowCards
          ? `<div class="stack-list ci-workflow-list">${workflowCards}</div>`
          : `<div class="dashboard-empty ci-manager-empty"><div>
              <strong>No CI workflow yet</strong>
              <p class="section-copy">A starter turns the project’s real package scripts into one GitHub Actions workflow for pushes, pull requests, and manual runs. It creates a new file only; it never overwrites one.</p>
              <p class="stat-detail">${escapeHtml(management.starterReason || '')}</p>
            </div></div>`}
      </article>`;

    const counts = runs.reduce((acc, run) => {
      const key = run.status !== 'completed' ? 'running'
        : run.conclusion === 'success' ? 'passing'
          : run.conclusion === 'failure' ? 'failing' : 'other';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const completed = (counts.passing || 0) + (counts.failing || 0);

    const intro = renderPageIntro({
      kicker: 'Stage 5',
      title: 'Pipeline and failure analysis',
      summary: intel
        ? `${runs.length} recent run${runs.length === 1 ? '' : 's'} on this branch${completed > 0 ? `, ${Math.round(((counts.passing || 0) / completed) * 100)}% passing` : ''}.${
          intel.loadedAt ? ` Read ${relativeLabel(intel.loadedAt)}.` : ''}`
        : 'CI has not been read yet. Fetching runs and downloading a failed log are slow, rate-limited calls, so they happen when you ask.',
      chips: report ? [{ label: report.classification, tone: report.classification === 'unknown' ? 'warn' : 'critical' }] : [],
    });

    if (!intel) {
      return `${pageSectionOpen('pipeline')}
        ${intro}
        ${managerCard}
        <div class="dashboard-empty"><div>
          <strong>CI has not been read</strong>
          <p class="section-copy">CI is the only reviewer that never gets tired and never approves something because it is Friday. On a solo project it is not a supplement to review — it is the review. AtlasMind reports no verdict rather than implying a green build.</p>
          ${renderRefreshAction('pipeline-refresh', 'Read CI for this branch', refreshBusy, { busyLabel: 'Reading CI…', primary: true })}
        </div></div>
      </section>`;
    }

    if (fetchFailure) {
      return `${pageSectionOpen('pipeline')}
        ${intro}
        ${managerCard}
        <div class="dashboard-empty"><div>
          <strong>The run list could not be read</strong>
          <div class="stat-detail">${escapeHtml(fetchFailure)}</div>
          ${intel.fetchFixCommand ? `<div class="policy-report-line"><code>${escapeHtml(intel.fetchFixCommand)}</code></div>` : ''}
          <p class="section-copy">No runs are shown because none were read — not because none exist. Nothing on this page should be taken as a verdict on the build until this succeeds.</p>
          ${renderRefreshAction('pipeline-refresh', 'Try again', refreshBusy, { busyLabel: 'Reading CI…', primary: true })}
        </div></div>
      </section>`;
    }

    const runRows = runs.slice(0, 15).map(run => `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(run.workflowName || run.displayTitle || 'Run')}</strong>
          <span class="tag ${run.conclusion === 'success' ? 'tag-good' : run.conclusion === 'failure' ? 'tag-critical' : 'tag-warn'}">${
            escapeHtml(run.status !== 'completed' ? run.status : (run.conclusion || 'unknown'))}</span>
        </div>
        <div class="list-meta">${escapeHtml(run.displayTitle || '')}</div>
      </div>`).join('');

    return `${pageSectionOpen('pipeline')}
      ${intro}
      ${managerCard}
      <div class="tag-row">
        ${renderRefreshAction('pipeline-refresh', 'Refresh CI', refreshBusy, {
          busyLabel: 'Reading CI…',
          title: 'Re-read this branch’s runs, and the log of the latest failure',
        })}
      </div>
      <div class="panel-grid">
        <article class="panel-card">
          <p class="card-kicker">Outcome</p>
          <div class="mini-grid">
            ${renderMetricPill('Passing', String(counts.passing || 0), { tone: 'good' })}
            ${renderMetricPill('Failing', String(counts.failing || 0), { tone: (counts.failing || 0) > 0 ? 'critical' : 'good' })}
            ${renderMetricPill('Pass rate', completed > 0 ? Math.round(((counts.passing || 0) / completed) * 100) + '%' : '—')}
          </div>
          ${renderDistributionBar('pipeline-outcome', [
            { key: 'pass', label: 'Passing', value: counts.passing || 0, tone: 'good' },
            { key: 'run', label: 'Running', value: counts.running || 0, tone: 'accent' },
            { key: 'fail', label: 'Failing', value: counts.failing || 0, tone: 'critical' },
            { key: 'other', label: 'Cancelled or skipped', value: counts.other || 0, tone: 'warn' },
          ], {
            title: 'Recent runs on this branch',
            caption: 'The shape over time matters more than the latest result',
            emptyLabel: 'No runs recorded for this branch.',
          })}
        </article>
        <article class="panel-card">
          <p class="card-kicker">Latest failure</p>
          ${report ? renderCiFailure(report) : ''}
          ${!report && intel.logFailure
            ? `<p class="stat-detail wf-unknown">A run failed, but its log could not be read: ${escapeHtml(intel.logFailure)}</p>`
            : ''}
          ${!report && !intel.logFailure
            ? '<div class="dashboard-empty"><div><strong>No failing runs</strong><p class="section-copy">Nothing on this branch has failed recently.</p></div></div>'
            : ''}
          ${taxonomyHelp.button}
          ${taxonomyHelp.panel}
        </article>
      </div>
      <article class="panel-card">
        <p class="card-kicker">Recent runs</p>
        <div class="stack-list">${runRows || '<div class="dashboard-empty">No runs on this branch.</div>'}</div>
      </article>
    </section>`;
  }

  function renderWorkflow(snapshot) {
    const wf = snapshot.guidedWorkflow;
    if (!wf) {
      return `${pageSectionOpen('workflow')}<div class="dashboard-empty"><div>
        <strong>The guided workflow is not available</strong>
        <p class="section-copy">AtlasMind could not read this workspace's state. Open a folder containing a git repository to see the workflow.</p>
      </div></div></section>`;
    }
    wfGlossaryCache = (wf.glossary || []).reduce((all, entry) => {
      all[entry.key] = entry; return all;
    }, {});
    wfStageCache = (wf.workflowConfig && wf.workflowConfig.config && wf.workflowConfig.config.stages) || [];

    const progress = wf.progress || { done: 0, total: 0, finished: false };
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

    const intro = renderPageIntro({
      kicker: 'Guided workflow',
      title: 'The eight stages, and where you are in them',
      summary: progress.total === 0
        ? 'The workflow could not be assessed for this workspace yet.'
        : `${progress.done} of ${progress.total} steps done (${pct}%). ${
          wf.next ? `Next: ${wf.next.stepTitle}, in ${wf.next.stageName}.` : 'Every step is complete.'
        } Press ? on any step to see why it exists and how to do it.`,
      chips: [
        { label: `${wf.profile} profile`, tone: 'accent' },
        { label: wf.enabled ? `automation: ${wf.automationLevel}` : 'automation: off', tone: wf.enabled ? 'warn' : 'good' },
      ],
    });

    const strip = renderFlowStrip((wf.stages || []).map(stage => ({
      label: String(stage.ordinal),
      sub: stage.name.split(' ')[0],
      icon: WF_MARK[stage.status] || '⬜',
      status: stage.status === 'done' ? 'ok' : stage.status === 'blocked' ? 'fail' : 'pending',
      title: `${stage.name} — ${WF_STATUS_WORD[stage.status] || stage.status}. ${stage.blurb}`,
    })));

    const stages = (wf.stages || []).map(stage => {
      const stageHelp = renderWorkflowHelp(`stage.${stage.id}`, {
        label: stage.name,
        why: stage.why,
        how: [
          { text: `Owned by \`${stage.ownerAgentId}\`.${
            (stage.supportingAgentIds || []).length ? ` Supported by ${stage.supportingAgentIds.join(', ')}.` : ''
          }` },
          { text: (stage.githubSurface || []).length
            ? `Uses: ${stage.githubSurface.join(', ')}.`
            : 'Touches no GitHub surface at all — this stage is deliberately local.' },
          { text: stage.determinism },
        ],
      });

      const steps = (stage.steps || []).map(step => {
        const help = renderWorkflowHelp(step.id, step);
        return `
          <div class="wf-step">
            <span class="wf-step-mark" aria-hidden="true">${WF_MARK[step.status] || '⬜'}</span>
            <div class="wf-step-body">
              <div class="wf-step-title">
                <span class="visually-hidden">${escapeHtml(WF_STATUS_WORD[step.status] || step.status)}: </span>
                ${escapeHtml(step.title)}
                ${step.proficiency && step.proficiency !== 'core'
                  ? `<span class="wf-proficiency">${escapeHtml(step.proficiency)}</span>` : ''}
                ${help.button}
              </div>
              <div class="wf-step-detail">${escapeHtml(step.detail || '')}</div>
              ${help.panel}
            </div>
          </div>`;
      }).join('');

      return `
        <article class="wf-stage">
          <div class="wf-stage-head">
            <span class="wf-stage-ordinal">${escapeHtml(String(stage.ordinal))}</span>
            <h4>${escapeHtml(stage.name)}</h4>
            <span class="tag ${stage.status === 'done' ? 'tag-good' : stage.status === 'blocked' ? 'tag-critical' : ''}">${
              escapeHtml(WF_STATUS_WORD[stage.status] || stage.status)}</span>
            ${stageHelp.button}
          </div>
          <p class="stat-detail">${escapeHtml(stage.blurb)}</p>
          ${stageHelp.panel}
          ${steps}
        </article>`;
    }).join('');

    const issues = wf.issues;
    const branches = wf.branches || { nonConforming: [] };
    const ci = wf.ci || {};
    const release = wf.release || { conformance: {} };
    const health = wf.health || {};

    // Health. Omitted components are named rather than silently folded in, so a
    // score of 80 cannot be mistaken for "80% of everything is fine".
    const healthCard = `
      <article class="panel-card">
        <p class="card-kicker">Workflow health</p>
        ${health.score && health.score.known
          ? renderScoreRing(health.score.value)
          : `<div class="dashboard-empty"><div>
              <strong>Not enough measured yet</strong>
              <p class="section-copy">${escapeHtml((health.score && health.score.reason) || 'Nothing measurable yet.')}</p>
            </div></div>`}
        <div class="stack-list">
          ${(health.components || []).map(component => `
            <div class="row-head">
              <span>${escapeHtml(component.label)}</span>
              <span>${renderVerdict(component.score, value => `${value}%`)}</span>
            </div>`).join('')}
        </div>
        ${(health.omitted || []).length
          ? `<p class="stat-detail wf-unknown">Not counted in the score: ${escapeHtml(health.omitted.join(', '))}. A component that could not be measured is left out rather than scored zero.</p>`
          : ''}
      </article>`;

    // Branch health stays on Workflow rather than moving to Repo: naming
    // conformance is a property of stage 2, and Repo is about the working tree.
    const branchCard = `
      <article class="panel-card">
        <p class="card-kicker">Branches</p>
        <div class="mini-grid">
          ${renderMetricPill('Total', String(branches.total || 0))}
          ${renderMetricPill('Stale', String(branches.stale || 0), { tone: (branches.stale || 0) > 0 ? 'warn' : 'good' })}
          ${renderMetricPill('Naming', renderVerdictText(branches.conformanceRate, value => `${value}%`))}
        </div>
        ${renderDistributionBar('wf-branch-age', branches.ageDistribution || [], {
          title: 'Branches by last commit',
          caption: 'A branch nobody has touched in a month is usually finished or abandoned',
          emptyLabel: 'No branches with a recorded commit date.',
        })}
        ${(branches.nonConforming || []).length
          ? `<p class="stat-detail">Not matching <code>&lt;type&gt;/&lt;issue&gt;-&lt;slug&gt;</code>: ${
            escapeHtml(branches.nonConforming.slice(0, 8).join(', '))}${branches.nonConforming.length > 8 ? '…' : ''}</p>`
          : '<p class="stat-detail">Every branch matches the naming convention.</p>'}
      </article>`;

    const releaseCard = `
      <article class="panel-card">
        <p class="card-kicker">Release readiness</p>
        <div class="mini-grid">
          ${renderMetricPill('Version', release.version || '—')}
          ${renderMetricPill('Commit conventions', renderVerdictText(release.conformance && release.conformance.rate, value => `${value}%`))}
        </div>
        ${release.drift
          ? `<p class="stat-detail">${escapeHtml(release.drift)} The changelog section is used verbatim as the release notes, so a missing entry blocks a clean release.</p>`
          : '<p class="stat-detail">The changelog covers the current version.</p>'}
        ${(release.conformance && (release.conformance.examples || []).length)
          ? `<p class="stat-detail wf-unknown">Recent commits outside the convention: ${
            escapeHtml(release.conformance.examples.join(' · '))}</p>`
          : ''}
        ${(release.conformance && (release.conformance.byType || []).length)
          ? renderDonutChart('wf-commit-types', release.conformance.byType, { emptyLabel: 'No conventional commits yet.' })
          : ''}
      </article>`;

    // The four gates, shown rather than merely honoured. Somebody learning why
    // "full automation is possible, never default" holds needs to see that the
    // switches are independent and all default closed.
    // What moved since this project was last opened.
    //
    // Placed above the ladder deliberately: the ladder is a setting you change
    // once, and this is the part that is different every day. A page whose first
    // card never changes is a page people stop reading.
    const delta = wf.delta || { status: 'first-look', headline: '', window: '', changes: [], droppedByCap: 0 };
    const DELTA_TAG = {
      improved: 'tag-good',
      worsened: 'tag-warn',
      moved: '',
      'now-known': '',
      'no-longer-readable': 'tag-warn',
    };
    const DELTA_WORD = {
      improved: 'better',
      worsened: 'worse',
      moved: 'changed',
      'now-known': 'now readable',
      'no-longer-readable': 'went quiet',
    };
    const deltaCard = `
      <article class="panel-card">
        <p class="card-kicker">What moved</p>
        <p class="stat-detail">${escapeHtml(delta.headline)}</p>
        ${delta.status === 'changed'
          ? `<div class="stack-list">${delta.changes.map(change => `
              <div class="row-head">
                <span>
                  <strong>${escapeHtml(change.label)}</strong>
                  <span class="section-copy">${escapeHtml(change.summary)}</span>
                </span>
                <span class="tag ${DELTA_TAG[change.kind] || ''}">${escapeHtml(DELTA_WORD[change.kind] || change.kind)}</span>
              </div>`).join('')}</div>
            ${delta.droppedByCap > 0
              ? `<p class="stat-detail">${delta.droppedByCap} more moved than are listed here. Enough changed at once that it is usually one cause rather than ${delta.droppedByCap + delta.changes.length} events — a tool coming back online, or a branch switch.</p>`
              : ''}
            <button type="button" class="action-link" data-action="delta-seen">Mark as seen</button>`
          : delta.status === 'first-look'
            ? '<p class="stat-detail">Nothing is missing and nothing is wrong — there is simply no earlier reading to compare this one against yet.</p>'
            : `<p class="stat-detail">The comparison covers open issues, stale issues, CI, the version, protected branches, dependency updates, test evidence and eleven other readings. Your own branch and whether your tree is dirty are deliberately excluded — you already know what you just did.</p>`}
      </article>`;

    // The gates, as controls rather than a read-out. Turning one *off* is
    // immediate — more restrictive is always safe, and a dialog in front of
    // somebody reaching for the brake teaches them to dismiss dialogs. Turning
    // one *on* asks first, in the host, naming what it permits.
    const enablement = wf.enablement || { requirements: [], blockedScopes: {}, levels: [] };
    const blockedFor = key => (enablement.blockedScopes || {})[key] || [];

    const gateRow = (label, detail, key, on, onWord, offWord) => `
      <div class="row-head" title="${escapeAttr(detail || '')}">
        <span>${escapeHtml(label)}</span>
        <span>
          <span class="tag ${on ? 'tag-warn' : 'tag-good'}">${on ? onWord : offWord}</span>
          ${blockedFor(key).length && !on
            ? `<span class="tag" title="${escapeAttr('Turned off in ' + blockedFor(key).join(' and ') + ', so changing it here would do nothing.')}">held by ${escapeHtml(blockedFor(key).join(' and '))}</span>`
            : `<button type="button" class="action-link" data-action="workflow-gate" data-payload="${escapeAttr(key + ':' + (on ? 'off' : 'on'))}">${on ? 'Turn off' : 'Allow…'}</button>`}
          <button type="button" class="action-link" data-action="setting" data-payload="${escapeAttr(key)}" title="Open this setting">⚙</button>
        </span>
      </div>`;

    const ladderCard = `
      <article class="panel-card">
        <p class="card-kicker">What AtlasMind may do</p>
        <p class="stat-detail">The effective level for any stage is the <em>lowest</em> of four independent gates. All four default closed, which is what keeps unattended action off until you deliberately allow it. Turning one off takes effect at once; allowing one asks you to confirm what it permits.</p>
        ${(enablement.requirements || []).length
          ? `<div class="dashboard-empty"><div>
              <strong>To reach <code>${escapeHtml(enablement.target || 'propose')}</code>, ${enablement.requirements.length} thing${enablement.requirements.length === 1 ? '' : 's'} must change</strong>
              <ol class="section-copy">${enablement.requirements.map(entry =>
                `<li>${escapeHtml(entry.label)}: <code>${escapeHtml(entry.current)}</code> → <code>${escapeHtml(entry.needed)}</code></li>`).join('')}</ol>
              <p class="section-copy"><code>${escapeHtml(enablement.target || 'propose')}</code> is the rung where AtlasMind starts changing things other people can see. Everything below it explains and prepares only.</p>
            </div></div>`
          : `<p class="stat-detail">Nothing is holding <code>${escapeHtml(enablement.target || 'propose')}</code> back — every gate permits it. Individual actions still confirm first.</p>`}
        <div class="stack-list">
          ${gateRow('Master switch', 'With this off, AtlasMind explains and measures the workflow and never acts on it.',
            enablement.masterKey || 'atlasmind.workflow.enabled', wf.enabled, 'on', 'off')}
          <div class="row-head">
            <span>Your ceiling</span>
            <span>
              <span class="segmented" role="group" aria-label="Automation ceiling">${(enablement.levels || []).map(level =>
                `<button type="button" data-action="automation-ceiling" data-payload="${escapeAttr(level)}"
                  class="${(wf.automationLevel || 'observe') === level ? 'active' : ''}"
                  aria-pressed="${(wf.automationLevel || 'observe') === level ? 'true' : 'false'}">${escapeHtml(level)}</button>`).join('')}</span>
              <button type="button" class="action-link" data-action="setting" data-payload="${escapeAttr(enablement.ceilingKey || 'atlasmind.workflow.maxAutomationLevel')}" title="Open this setting">⚙</button>
            </span>
          </div>
          ${(wf.capabilities || []).map(capability =>
            gateRow(capability.label, capability.detail, capability.id, capability.enabled, 'allowed', 'off')).join('')}
        </div>
        <p class="stat-detail">Written to this workspace, so it is a per-project decision. Where another settings scope is stricter, the row says so instead of offering a switch that would change nothing.</p>
      </article>`;

    // The audit record. Every other part of this workflow makes a determinism
    // claim; this is the card where those claims are either true or visibly not.
    const audit = snapshot.audit || { summary: {}, recent: [] };
    const auditSummary = audit.summary || {};
    const breaches = auditSummary.breaches || [];
    const auditHelp = renderWorkflowHelp('workflow.audit', {
      label: 'what the audit record proves',
      why: 'Branch names are derived, pull-request titles are classified by rule, CI failures are matched against an ordered table, release notes are copied verbatim. Every one of those is a determinism claim, and a determinism claim is either verifiable or it is marketing. The record makes it verifiable: two runs with the same inputs must produce the same outputs, and where they did not, both runs are named.',
      how: [
        { text: 'Inputs and outputs are recorded as fingerprints, never as values. This ledger is committed, so storing what was processed would put issue bodies, review comments and CI logs into your repository.' },
        { text: 'The record is written before the action, not after. A record written afterwards is missing exactly when it matters most — the run that crashed is the run somebody needs to read about.' },
        { text: 'An action whose record cannot be written does not happen. An action that quietly skipped its record would be the one nobody could account for later.' },
        { text: 'A refused action is recorded too. “We were not allowed to” is a fact worth keeping, and it is the one somebody asks about when a switch turns out to be off.' },
        { text: 'Records transition through complete or failed; they are never deleted or rewritten. The ledger is capped, and the truncation is stated in the file rather than applied silently.' },
      ],
      commonMistakes: [
        'Reading an empty ledger as “nothing went wrong”. It means nothing has run.',
        'Treating a failed run as a determinism breach. A failure has no output, so there is nothing to compare.',
      ],
    });

    const auditCard = `
      <article class="panel-card">
        <div class="row-head">
          <p class="card-kicker">What has been done${auditHelp.button}</p>
          ${breaches.length
            ? `<span class="tag tag-critical">${breaches.length} determinism breach${breaches.length === 1 ? '' : 'es'}</span>`
            : (auditSummary.total ? '<span class="tag tag-good">consistent</span>' : '')}
        </div>
        ${auditHelp.panel}
        <div class="mini-grid">
          ${renderMetricPill('Recorded', String(auditSummary.total || 0))}
          ${renderMetricPill('Unfinished', String(auditSummary.unfinished || 0), { tone: (auditSummary.unfinished || 0) > 0 ? 'warn' : 'good' })}
          ${renderMetricPill('Refused', String(auditSummary.refused || 0))}
        </div>
        ${breaches.length
          ? `<div class="stack-list">${breaches.map(breach => `
              <div class="recent-item">
                <div class="row-head"><strong>${escapeHtml(breach.stageId)} · ${escapeHtml(breach.action)}</strong></div>
                <div class="list-meta">Inputs <code>${escapeHtml(breach.inputsFingerprint)}</code> produced ${
                  breach.outputs.map(output => `<code>${escapeHtml(output.outputsFingerprint)}</code> (${escapeHtml((output.at || '').slice(0, 10))})`).join(' and ')}</div>
              </div>`).join('')}</div>`
          : ''}
        ${(audit.recent || []).length
          ? `<div class="stack-list">${audit.recent.slice(0, 8).map(record => `
              <div class="recent-item">
                <div class="row-head">
                  <strong>${escapeHtml(record.action)}</strong>
                  <span class="tag ${record.outcome === 'complete' ? 'tag-good' : record.outcome === 'failed' ? 'tag-critical' : 'tag-warn'}">${escapeHtml(record.outcome)}</span>
                </div>
                <div class="list-meta">${escapeHtml(record.stageId)} · ${escapeHtml((record.at || '').slice(0, 16).replace('T', ' '))} · ${
                  record.effectiveLevel === record.requestedLevel
                    ? escapeHtml(record.effectiveLevel)
                    : `${escapeHtml(record.effectiveLevel)} (asked for ${escapeHtml(record.requestedLevel)}${record.limitedBy ? `, capped by ${escapeHtml(record.limitedBy)}` : ''})`}</div>
              </div>`).join('')}</div>`
          : `<div class="dashboard-empty"><div>
              <strong>Nothing recorded yet</strong>
              <p class="section-copy">This is the record of what the workflow has actually done — which stage, at what level, with what result. An empty ledger means nothing has run, not that nothing went wrong.</p>
            </div></div>`}
        ${auditSummary.droppedByCap
          ? `<p class="stat-detail wf-unknown">${auditSummary.droppedByCap} older records have been dropped by the retention cap. The count is kept so the ledger never quietly forgets.</p>`
          : ''}
      </article>`;
    // The committed workflow file. This is the one card on the page that edits
    // something a team reviews, so it says so, and every control is one field
    // whose exact change the host confirms before writing.
    const cfg = wf.workflowConfig || {};
    const configHelp = renderWorkflowHelp('workflow.config', {
      label: 'why the workflow is a committed file',
      why: 'A workflow kept in settings is a workflow each person has their own version of, and the version that matters is whichever one nobody wrote down. Putting it in a file that gets committed means a team that disagrees with a default disagrees in public — with a diff and a reviewer — rather than in a habit. It is also the difference between a workflow you have and a workflow you can point at when somebody new joins.',
      how: [
        { text: 'The file sets intent; your settings set the ceiling. A stage can request "auto" and still do nothing, because what actually happens is the lowest of four independent gates.' },
        { text: 'A stage you do not use is disabled, never deleted. Disabling leaves the decision in the record; deleting erases the evidence it was ever made.' },
        { text: 'Profiles seed, they do not govern. Changing the profile later never rewrites stages you customised.' },
        { text: 'Fields written by a newer AtlasMind survive a round trip, so an older build saving the file cannot silently drop a colleague’s settings.' },
        { text: 'The markdown mirror beside it is generated. Edit the JSON or this page; hand edits to the mirror are lost on the next save.' },
      ],
      commonMistakes: [
        'Keeping the workflow out of version control, which recreates the drift it exists to solve.',
        'Assuming a stage set to "auto" will act. Four gates all have to agree, and they all default closed.',
      ],
    });

    const configCard = cfg.config ? (() => {
      const config = cfg.config;
      const enabledCount = (config.stages || []).filter(stage => stage.enabled).length;
      // Derived host-side and carried, never re-derived here: two copies of
      // "what is stopping this stage" would eventually disagree, and the one
      // on screen would be the one nobody tested.
      const blockersFor = id => (cfg.blockers && cfg.blockers[id]) || [];
      const problems = cfg.problems || [];
      const stageRows = (config.stages || []).map(stage => `
        <div class="recent-item workflow-stage-segment ${stage.enabled ? 'is-enabled' : 'is-disabled'}">
          <div class="row-head">
            <button type="button" class="action-link workflow-stage-toggle" data-action="workflow-stage-toggle" data-payload="${escapeAttr(stage.id)}"
              aria-label="${stage.enabled ? 'Disable' : 'Enable'} ${escapeAttr(stage.name)}" aria-pressed="${stage.enabled ? 'true' : 'false'}">
              <span class="workflow-stage-marker" aria-hidden="true">${stage.enabled ? '✓' : '—'}</span>
              <span>${escapeHtml(stage.name)}</span>
            </button>
            <div class="tag-row workflow-stage-tags">
              <span class="tag workflow-stage-state ${stage.enabled ? 'tag-good' : ''}">${stage.enabled ? 'Enabled' : 'Disabled'}</span>
              <span class="tag">${escapeHtml(stage.automationLevel)}</span>
            </div>
          </div>
          ${(stage.requiredChecks || []).length
            ? `<div class="list-meta">Attests: ${escapeHtml(stage.requiredChecks.join(' · '))}</div>`
            : ''}
          ${stage.command !== undefined
            ? (stage.command
              ? `<div class="list-meta">Runs: <code>${escapeHtml(stage.command)}</code></div>`
              : '<p class="stat-detail wf-unknown">No command set. That emptiness <em>is</em> the blocker — the stage stays shut until somebody supplies one.</p>')
            : ''}
          ${(blockersFor(stage.id) || []).length
            ? `<p class="stat-detail wf-unknown">Blocked: ${escapeHtml(blockersFor(stage.id).join('; '))}</p>`
            : ''}
        </div>`).join('');

      return `
      <article class="panel-card">
        <div class="row-head">
          <p class="card-kicker">Your workflow file${configHelp.button}</p>
          <span class="tag ${enabledCount > 0 ? 'tag-good' : ''}">${enabledCount} of ${(config.stages || []).length} enabled</span>
        </div>
        ${configHelp.panel}
        <div class="list-meta">${escapeHtml(cfg.path || '')} · ${escapeHtml(config.profile)} profile · merges into <code>${escapeHtml(config.branches.integration)}</code>, releases from <code>${escapeHtml(config.branches.release)}</code></div>
        <div class="stack-list">${stageRows}</div>
        ${problems.length
          ? `<p class="stat-detail wf-unknown">${problems.map(problem => escapeHtml(problem.detail)).join(' ')}</p>`
          : ''}
        <p class="stat-detail">A stage requests a level; what happens is the lowest of that, your ceiling, the matching capability switch, and the master switch. Toggling one here writes the committed file — you will see the exact change first.</p>
      </article>`;
    })() : `
      <article class="panel-card">
        <div class="row-head">
          <p class="card-kicker">Your workflow file${configHelp.button}</p>
          <span class="tag tag-warn">not declared</span>
        </div>
        ${configHelp.panel}
        ${cfg.notice
          ? `<p class="stat-detail wf-unknown">${escapeHtml(cfg.notice)}</p>`
          : `<div class="dashboard-empty"><div>
              <strong>This project has no declared workflow</strong>
              <p class="section-copy">AtlasMind is using its built-in defaults, which is fine until two people disagree about them. Declaring the workflow writes <code>${escapeHtml(cfg.path || 'project_memory/operations/workflow.json')}</code> and a readable mirror beside it, both of which you commit — so how your team works becomes something reviewed rather than remembered.</p>
              <p class="section-copy">Every stage starts disabled and at <code>observe</code>. Declaring a workflow turns nothing on.</p>
              <div class="tag-row">
                <button type="button" class="action-link" data-action="create-workflow-config" data-payload="solo">Declare it — solo</button>
                <button type="button" class="action-link" data-action="create-workflow-config" data-payload="studio">Declare it — small studio</button>
              </div>
            </div></div>`}
      </article>`;

    // What kind of project this is, and what that changes. Detected and declared
    // are shown separately: detection is a suggestion from the manifests, the
    // declaration is the decision. Where they disagree we say so rather than
    // silently preferring one.
    const arch = wf.archetype;
    const archCard = arch ? (() => {
      const labels = arch.labels || { archetype: {}, trait: {} };
      const name = key => (labels.archetype && labels.archetype[key]) || key;
      const pack = arch.pack || {};
      const requiredCi = (pack.ci || []).filter(step => step.required);

      const help = renderWorkflowHelp('archetype.pack', {
        label: 'what this project shape changes',
        why: 'A game, a website, a library and a CLI do not share a CI pipeline, a release mechanism, a testing strategy, or the same idea of what counts as technical debt. Declaring the shape is what lets the workflow specialise instead of staying general for everybody. Detection reads your manifests and suggests; the declaration decides — a project deliberately declared one thing while its dependencies look like another is a decision, not a mistake.',
        how: [
          { text: requiredCi.length
            ? `Required CI steps for this shape: ${requiredCi.map(step => step.label).join(', ')}.`
            : 'No shape-specific CI steps — declare an archetype to get them.' },
          { text: pack.release ? `Releases go to: ${pack.release.channel}. ${pack.release.versioningNote || ''}` : '' },
          { text: pack.testing ? `Recommended testing: ${(pack.testing.recommended || []).join(', ')}. ${pack.testing.rationale || ''}` : '' },
          { text: pack.testing && (pack.testing.discouraged || []).length
            ? `Deliberately not recommended: ${pack.testing.discouraged.join(', ')}. ${pack.testing.discouragedReason || ''}`
            : '' },
          { text: (pack.refactor || []).length
            ? `Watch for: ${pack.refactor.map(item => item.label).join('; ')}.`
            : '' },
          { text: (pack.documentation || []).length
            ? `Documentation this shape expects: ${pack.documentation.map(doc => doc.path).join(', ')}.`
            : '' },
        ].filter(line => line.text),
      });

      return `
      <article class="panel-card">
        <p class="card-kicker">Project shape</p>
        <div class="row-head">
          <strong>${escapeHtml(arch.declared ? name(arch.declared) : 'Not declared')}</strong>
          ${arch.declared ? '<span class="tag tag-good">declared</span>' : '<span class="tag tag-warn">undeclared</span>'}
        </div>
        <p class="stat-detail">${escapeHtml((arch.agreement && arch.agreement.detail) || '')}</p>
        ${arch.detected && arch.detected.confident && arch.detected.archetype !== arch.declared
          ? `<p class="stat-detail wf-unknown">Manifests suggest ${escapeHtml(name(arch.detected.archetype))}: ${
            escapeHtml((arch.detected.reasons || []).join(' '))}</p>`
          : ''}
        ${(arch.traits || []).length
          ? `<div class="tag-row">${arch.traits.map(trait =>
            `<span class="tag">${escapeHtml((labels.trait && labels.trait[trait]) || trait)}</span>`).join('')}</div>`
          : ''}
        ${pack.blurb ? `<p class="stat-detail">${escapeHtml(pack.blurb)}${help.button}</p>` : help.button}
        ${help.panel}
        <button type="button" class="action-link" data-action="setting" data-payload="atlasmind.workflow.archetype">Change the project shape</button>
      </article>`;
    })() : '';

    const activity = renderChartCard(
      'wf-commits',
      'Commit activity',
      'Commits per day. The shape matters more than the total — long flat stretches usually mean work is queued somewhere rather than that nobody was working.',
      (wf.commitSeries || []).map(point => ({ label: point.label, value: point.value })),
      'workflow',
    );

    return `${pageSectionOpen('workflow')}
      ${intro}
      ${strip}
      <div class="panel-grid">
        ${deltaCard}
        ${healthCard}
        ${configCard}
        ${auditCard}
        ${archCard}
        ${ladderCard}
        ${branchCard}
        ${releaseCard}
      </div>
      ${activity}
      <section>
        <p class="section-kicker">The eight stages</p>
        ${stages}
      </section>
    </section>`;
  }

  /** Plain-language account of each failure class, mirroring CLASS_EXPLANATION. */
  const CI_CLASS_LABEL = {
    'dependency-install': 'Dependency install',
    compile: 'Compile',
    lint: 'Lint',
    'test-failure': 'Test failure',
    timeout: 'Timeout',
    'flake-suspect': 'Flake suspect',
    infra: 'Infrastructure',
    unknown: 'Unknown',
  };

  /**
   * The classified failure, with its evidence.
   *
   * The classification came from a rule table, not a model — so it is stated as
   * a finding. `unknown` is shown as itself rather than dressed up: a
   * confidently wrong root cause costs more than an honest admission.
   */
  function renderCiFailure(report) {
    const cls = report.classification || 'unknown';
    const tone = cls === 'unknown' ? 'warn' : cls === 'infra' || cls === 'flake-suspect' ? 'accent' : 'critical';
    const evidence = (report.evidenceLines || []).map(line => escapeHtml(line)).join('\n');
    return `
      <div class="wf-ci-failure">
        <div class="row-head">
          <strong>${escapeHtml(report.jobName || 'A job')} failed</strong>
          <span class="tag tag-${tone === 'critical' ? 'critical' : 'warn'}">${escapeHtml(CI_CLASS_LABEL[cls] || cls)}</span>
        </div>
        ${report.stepName ? `<div class="list-meta">Step: ${escapeHtml(report.stepName)}</div>` : ''}
        ${evidence ? `<pre class="wf-ci-evidence">${evidence}</pre>` : '<p class="stat-detail wf-unknown">No evidence lines were captured.</p>'}
        <div class="list-meta">
          ${report.truncated ? 'Earlier output was truncated. ' : ''}${report.redacted ? 'Secret-shaped values were removed. ' : ''}
          ${cls === 'unknown'
            ? 'Nothing matched a known pattern, so AtlasMind is not guessing — this one needs a human.'
            : report.suggestedOwnerAgentId
              ? `Best placed to act: <code>${escapeHtml(report.suggestedOwnerAgentId)}</code>.`
              : ''}
        </div>
      </div>`;
  }

  /** A duration verdict as text, scaling its unit with magnitude. */
  function formatDuration(verdict) {
    if (!verdict || verdict.known !== true) { return '—'; }
    const hours = verdict.value / 3600000;
    if (hours < 1) { return Math.round(hours * 60) + 'm'; }
    if (hours < 48) { return hours.toFixed(1) + 'h'; }
    return (hours / 24).toFixed(1) + 'd';
  }

  /** Plain-text verdict, for slots that cannot take markup. */
  function renderVerdictText(verdict, format) {
    return verdict && verdict.known === true
      ? (format ? format(verdict.value) : String(verdict.value))
      : '—';
  }

  // What is still sitting on the ideation board and never became work.
  //
  // On the Roadmap page rather than a page of its own: the question it answers
  // is “is the backlog everything?”, which only means something beside the
  // backlog. Absent when the board is empty — a project with no board should not
  // be told it has nothing on it.
  function boardBacklogCard(roadmap) {
    var backlog = (roadmap && roadmap.boardBacklog) || { total: 0, needsAttention: 0 };
    if (backlog.total === 0) {
      return '';
    }
    var attention = backlog.needsAttention;
    var cardWord = backlog.total === 1 ? 'card has' : 'cards have';
    var detail = attention > 0
      ? '<strong>' + attention + '</strong> of them '
        + (attention === 1 ? 'is a problem, requirement or risk' : 'are problems, requirements or risks')
        + ' — somebody wrote down that something was wrong or needed, and it never reached the backlog.'
      : 'None of them are problems, requirements or risks, so nothing is being lost — a board is for holding ideas.';
    return '<article class="panel-card">'
      + '<p class="card-kicker">Still on the ideation board</p>'
      + '<p class="stat-detail">' + backlog.total + ' ' + cardWord + ' not become work. ' + detail + '</p>'
      + '<button type="button" class="action-link" data-action="command"'
      + ' data-payload="atlasmind.openProjectIdeation">Open the ideation board</button>'
      + '</article>';
  }

  function renderRoadmap(snapshot) {
    const roadmap = snapshot.roadmap || { items: [], nextSuggestedWork: [], completedCount: 0, outstandingCount: 0, filePath: 'project_memory/roadmap/improvement-plan.md' };
    const roadmapDone = roadmap.items.length > 0
      ? Math.round((roadmap.completedCount / roadmap.items.length) * 100)
      : null;
    // What KIND of work is queued, not just how much. `focus` is already read
    // for per-item tag colouring, so the classification is free.
    const FOCUS_TONES = { security: 'critical', architecture: 'accent', delivery: 'warn', feature: 'good', documentation: 'muted' };
    const outstanding = roadmap.items.filter(item => !item.completed);
    const focusMix = Object.keys(FOCUS_TONES).map(focus => ({
      label: focus.charAt(0).toUpperCase() + focus.slice(1),
      value: outstanding.filter(item => item.focus === focus).length,
      tone: FOCUS_TONES[focus],
    }));
    return `
      ${pageSectionOpen('roadmap')}
        ${renderMvpSection(roadmap)}
        <div class="panel-grid">
          <article class="panel-card">
            <p class="section-kicker">Developer roadmap</p>
            <h3>Prioritized backlog</h3>
            <div class="mini-grid">
              ${renderMetricPill('Total items', String(roadmap.items.length))}
              ${renderMetricPill('Outstanding', String(roadmap.outstandingCount))}
              ${renderMetricPill('Completed', `${roadmap.completedCount}${roadmapDone === null ? '' : ` · ${roadmapDone}%`}`, {
                tone: roadmapDone !== null && roadmapDone >= 50 ? 'good' : 'accent',
                meterKey: 'roadmap-complete',
                ...(roadmapDone === null ? {} : { meter: roadmapDone }),
              })}
            </div>
            ${renderDistributionBar('roadmap-focus', focusMix, {
              title: 'Backlog focus mix',
              caption: `${roadmap.outstandingCount} outstanding`,
              emptyLabel: 'Nothing outstanding in the backlog.',
            })}
            <div class="stat-detail">Reorder items to influence Atlas’s default next-work weighting. Security, architecture, and delivery risk are still factored in before execution.</div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="roadmap-add" data-payload="new">Add item</button>
              <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(roadmap.filePath)}">Open roadmap file</button>
            </div>
          </article>
          ${boardBacklogCard(roadmap)}
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
          <h3>Prioritized backlog</h3>
          <div class="list-meta">Grab the <span aria-hidden="true">⠿</span> handle on the left of any item and drag it up or down — items higher in the list get more weight in Atlas's next-work decisions. Use the buttons on each item to mark it for the MVP, complete it, edit, or delete.</div>
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
    const gates = getRoadmapGates();
    const itemGates = Array.isArray(item.gates) ? item.gates : (item.isMvp ? ['mvp'] : []);
    // One chip per declared gate: with a single (MVP) gate this reads exactly as
    // the old Mark-MVP button did, and it scales to a real release plan without
    // a menu. Wording stays explicit about what a click does.
    const gateChips = gates.map(gate => {
      const on = itemGates.indexOf(gate.id) >= 0;
      const tooltip = gate.id === 'mvp'
        ? (on ? 'Remove this item from the MVP path. MVP = Minimum Viable Product: the smallest set of work needed for a first usable release.' : MVP_HELP_TEXT)
        : (on ? `Remove this item from the ${gate.label} release.` : `Put this item on the ${gate.label} release.`);
      return `<button type="button" class="gate-toggle${on ? ' is-on' : ''}" data-action="roadmap-gate-toggle" data-payload="${escapeAttr(`${item.id}::${gate.id}`)}" title="${escapeAttr(tooltip)}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(gate.label)}</button>`;
    }).join('');
    return `
      <div class="recent-item roadmap-item ${item.isMvp ? 'is-mvp' : ''}" draggable="true" data-roadmap-id="${escapeAttr(item.id)}" data-dashboard-focus-kind="roadmap" data-dashboard-focus-id="${escapeAttr(item.id)}">
        <div class="row-head">
          <span class="drag-handle" title="Drag to reorder — position sets Atlas's default priority" aria-hidden="true">⠿</span>
          <strong>${escapeHtml(item.text)}</strong>
          <span class="tag-group">
            ${gates.filter(gate => itemGates.indexOf(gate.id) >= 0).map(gate => `<span class="tag tag-mvp" title="${escapeAttr(`This item is on the ${gate.label} path`)}">${escapeHtml(gate.label)}</span>`).join('')}
            <span class="tag ${item.completed ? 'tag-good' : item.focus === 'security' ? 'tag-critical' : item.focus === 'architecture' ? 'tag-warn' : ''}">${escapeHtml(item.completed ? 'done' : item.focus)}</span>
          </span>
        </div>
        <div class="list-meta">${escapeHtml(item.priorityReason)}</div>
        <div class="gate-toggle-row" role="group" aria-label="Release gates for this item">
          <span class="gate-toggle-hint" title="${escapeAttr(GATE_HELP_TEXT)}">Release:</span>
          ${gateChips}
        </div>
        <div class="tag-row">
          ${item.completed ? '' : renderDirectorOwnerControl('roadmap', item.id)}
          ${item.origin
            ? `<span class="tag" title="${escapeAttr('Raised from the ideation card “' + item.origin.cardTitle + '” (' + item.origin.cardKind + '). The board keeps the reasoning.')}">from ideation</span>`
            : ''}
          <button type="button" class="action-link" data-action="roadmap-toggle" data-payload="${escapeAttr(item.id)}">${item.completed ? 'Mark active' : 'Mark done'}</button>
          <button type="button" class="action-link" data-action="roadmap-edit" data-payload="${escapeAttr(item.id)}">Edit</button>
          ${item.completed ? '' : `<button type="button" class="action-link" data-action="roadmap-raise-issue" data-payload="${escapeAttr(item.id)}" title="Draft a GitHub issue from this item. Nothing is posted until you confirm.">Raise as issue</button>`}
          <button type="button" class="action-link" data-action="roadmap-delete" data-payload="${escapeAttr(item.id)}">Delete</button>
        </div>
      </div>
    `;
  }

  // Release-gate selector. The MVP gate is the built-in one and always first;
  // everything else is a user-declared release the backlog can be tagged for.
  function renderGateSelector(roadmap) {
    const gates = getRoadmapGates();
    const active = activeRoadmapGate();
    return `
      <div class="gate-bar" role="tablist" aria-label="Release gates">
        ${gates.map(gate => `
          <button type="button" role="tab" aria-selected="${gate.id === active.id ? 'true' : 'false'}"
            class="gate-chip${gate.id === active.id ? ' is-active' : ''}"
            data-action="roadmap-gate-select" data-payload="${escapeAttr(gate.id)}"
            title="${escapeAttr(`${gate.label}: ${gate.completedCount} of ${gate.totalCount} tagged items complete`)}">
            <span class="gate-chip-label">${escapeHtml(gate.label)}</span>
            <span class="gate-chip-count">${escapeHtml(`${gate.completedCount}/${gate.totalCount}`)}</span>
          </button>`).join('')}
        <button type="button" class="gate-chip gate-chip--add" data-action="roadmap-gate-new" title="Declare another release gate, e.g. a public beta or v2">+ New gate</button>
        ${!active.builtIn ? `<button type="button" class="action-link danger" data-action="roadmap-gate-delete" data-payload="${escapeAttr(active.id)}" title="Remove this gate. No backlog item is deleted.">Remove ${escapeHtml(active.label)}</button>` : ''}
      </div>
    `;
  }

  function renderMvpSection(roadmap) {
    const active = activeRoadmapGate();
    const routes = roadmap.gateRoutes && typeof roadmap.gateRoutes === 'object' ? roadmap.gateRoutes : {};
    const mvp = routes[active.id] || roadmap.mvp || { route: [], candidates: [], totalCount: 0, completedCount: 0, progressPercent: 0, hasTaggedItems: false, summary: '', planPrompt: '' };
    const isMvpGate = active.id === 'mvp';
    const gateLabel = isMvpGate ? 'MVP' : active.label;
    const route = Array.isArray(mvp.route) ? mvp.route : [];
    const candidates = Array.isArray(mvp.candidates) ? mvp.candidates : [];
    const outstanding = route.filter(step => !step.completed);
    const remaining = Math.max(0, mvp.totalCount - mvp.completedCount);
    const nextStep = mvp.nextStep;
    const hasPath = mvp.totalCount > 0;
    return `
      ${renderGateSelector(roadmap)}
      <div class="panel-grid mvp-grid">
        <article class="panel-card mvp-card">
          <p class="section-kicker">Road to ${escapeHtml(gateLabel)}</p>
          <h3>${escapeHtml(isMvpGate ? 'Minimum viable product' : gateLabel)} ${isMvpGate ? `<span class="mvp-help" title="${escapeAttr(MVP_HELP_TEXT)}" aria-label="What is an MVP?">ⓘ</span>` : `<span class="mvp-help" title="${escapeAttr(GATE_HELP_TEXT)}" aria-label="What is a release gate?">ⓘ</span>`}</h3>
          <div class="stat-detail">${escapeHtml(mvp.summary || '')}</div>
          ${hasPath ? `
            <div class="mini-grid">
              ${renderMetricPill('On path', String(mvp.totalCount))}
              ${renderMetricPill('Completed', String(mvp.completedCount))}
              ${renderMetricPill('Remaining', String(remaining))}
              ${renderMetricPill(`To ${gateLabel}`, `${mvp.progressPercent}%`)}
            </div>
            <div class="mvp-progress" role="progressbar" aria-valuenow="${mvp.progressPercent}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeAttr(`Progress to ${gateLabel}`)}">
              <div class="mvp-progress-fill" data-anim-key="mvp-progress-${escapeAttr(active.id)}" data-anim-to="${Math.max(0, Math.min(100, mvp.progressPercent))}%" style="width:0%"></div>
            </div>
            ${renderMvpTrack(route)}
            ${!mvp.hasTaggedItems ? '<div class="list-meta">These are suggested foundations. Use “Mark MVP” on a backlog item below to define your own MVP path.</div>' : ''}
          ` : `
            <div class="dashboard-empty">${escapeHtml(isMvpGate
              ? 'No MVP path defined yet. Tag the backlog items that make up your minimum viable product with “Mark MVP”, or let Atlas suggest a route.'
              : `Nothing is tagged for ${gateLabel} yet. Use the ${gateLabel} chip on a backlog item below to put it on this release.`)}</div>
          `}
          <div class="tag-row">
            ${renderAtlasDiscussAction('prompt', mvp.planPrompt || '', `Ask AtlasMind to plan the ${gateLabel} route`, { title: `Ask AtlasMind to plan the shortest defensible route to ${gateLabel}` })}
            <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(roadmap.filePath)}">Open roadmap file</button>
          </div>
        </article>
        <article class="panel-card mvp-card">
          <p class="section-kicker">AI-assisted route</p>
          <h3>Best route to get there</h3>
          ${nextStep ? `
            <div class="mvp-next-callout">
              <span class="mvp-next-kicker">Next step</span>
              <strong>${escapeHtml(nextStep.text)}</strong>
              <span class="list-meta">${escapeHtml(nextStep.rationale)}</span>
            </div>` : (hasPath ? `<div class="list-meta">${escapeHtml(`Every ${gateLabel} milestone is complete — choose the next outcome to pursue.`)}</div>` : '')}
          <div class="stack-list">
            ${outstanding.length > 0
              ? outstanding.map(step => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(`${step.order}. ${step.text}`)}</strong>
                    <span class="tag">${escapeHtml(step.focus)}</span>
                  </div>
                  <div class="list-meta">${escapeHtml(step.rationale)}</div>
                </div>`).join('')
              : (hasPath ? '' : `<div class="dashboard-empty">${escapeHtml(`Once items are on the ${gateLabel} path, the recommended route appears here.`)}</div>`)}
          </div>
          ${candidates.length > 0 ? `
            <p class="section-kicker">${escapeHtml(`Suggested for ${gateLabel}`)}</p>
            <div class="stack-list">
              ${candidates.map(step => `
                <div class="recent-item">
                  <div class="row-head">
                    <strong>${escapeHtml(step.text)}</strong>
                    <button type="button" class="action-link" data-action="roadmap-mvp-add" data-payload="${escapeAttr(step.id)}">${escapeHtml(`Add to ${gateLabel}`)}</button>
                  </div>
                  <div class="list-meta">${escapeHtml(step.rationale)}</div>
                </div>`).join('')}
            </div>` : ''}
        </article>
      </div>
    `;
  }

  function renderMvpTrack(route) {
    if (!Array.isArray(route) || route.length === 0) {
      return '';
    }
    const firstOutstanding = route.find(step => !step.completed);
    const activeId = firstOutstanding ? firstOutstanding.id : '';
    return `
      <div class="mvp-track" role="list" aria-label="MVP milestones">
        ${route.map(step => {
          const stateClass = step.completed ? 'done' : (step.id === activeId ? 'active' : 'pending');
          const marker = step.completed ? '✓' : String(step.order);
          return `
            <div class="mvp-node ${stateClass}" role="listitem" title="${escapeAttr(step.text)}">
              <span class="mvp-node-dot">${escapeHtml(marker)}</span>
              <span class="mvp-node-label">${escapeHtml(step.text)}</span>
            </div>`;
        }).join('')}
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

    const items = getRoadmapItems().map(item => ({ id: item.id, text: item.text, completed: !!item.completed, isMvp: !!item.isMvp }));
    if (state.editingRoadmapId === 'new') {
      items.unshift({ id: createRoadmapItemId(text), text, completed: false, gates: [] });
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
          // Both are sent: `gates` is the truth, `isMvp` keeps the MVP path
          // readable to anything still reading the original single flag.
          gates: Array.isArray(item.gates) ? item.gates : (item.isMvp ? ['mvp'] : []),
          isMvp: Array.isArray(item.gates) ? item.gates.indexOf('mvp') >= 0 : !!item.isMvp,
        })),
      },
    });
  }

  function roadmapItemsForSave() {
    return getRoadmapItems().map(item => ({
      id: item.id,
      text: item.text,
      completed: !!item.completed,
      gates: Array.isArray(item.gates) ? item.gates.slice() : (item.isMvp ? ['mvp'] : []),
    }));
  }

  function getRoadmapGates() {
    const gates = state.snapshot && state.snapshot.roadmap ? state.snapshot.roadmap.gates : null;
    return Array.isArray(gates) && gates.length > 0 ? gates : [{ id: 'mvp', label: 'MVP', order: 0, builtIn: true, totalCount: 0, completedCount: 0, progressPercent: 0 }];
  }

  function activeRoadmapGate() {
    const gates = getRoadmapGates();
    const selected = gates.find(gate => gate.id === state.activeRoadmapGate);
    return selected || gates[0];
  }

  function toggleItemGate(itemId, gateId) {
    persistRoadmapItems(roadmapItemsForSave().map(item => {
      if (item.id !== itemId) { return item; }
      const has = item.gates.indexOf(gateId) >= 0;
      return { ...item, gates: has ? item.gates.filter(id => id !== gateId) : [...item.gates, gateId] };
    }));
  }

  function moveRoadmapItem(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    const items = roadmapItemsForSave();
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

  // ── Documents (.md management) ──────────────────────────────────

  function docCadenceLabel(cadence) {
    switch (cadence) {
      case 'on-change': return 'On change';
      case 'on-release': return 'On release';
      case 'weekly': return 'Weekly';
      default: return 'Manual';
    }
  }

  // ── Risk oversight ─────────────────────────────────────────────────────────

  const RISK_LEVELS = ['low', 'medium', 'high'];
  const RISK_STATUS_LABEL = {
    open: 'Open',
    accepted: 'Accepted',
    mitigated: 'Mitigated',
    closed: 'Closed',
    dismissed: 'Dismissed',
  };

  /**
   * Likelihood x impact heatmap — the canonical risk visual.
   *
   * Impact runs up the y-axis and likelihood along the x, so the top-right cell is
   * the worst case. Each populated cell is a button that filters the register below;
   * clicking the active cell clears the filter.
   */
  function renderRiskMatrix(matrix) {
    const counts = matrix || {};
    const rows = [...RISK_LEVELS].reverse().map(impact => {
      const cells = RISK_LEVELS.map(likelihood => {
        const key = likelihood + ':' + impact;
        const count = counts[key] || 0;
        // Severity band drives the cell colour: 2 = low, 4 = moderate, 6 = high, 9 = severe.
        const severity = (RISK_LEVELS.indexOf(likelihood) + 1) * (RISK_LEVELS.indexOf(impact) + 1);
        const band = severity >= 6 ? 'severe' : severity >= 4 ? 'high' : severity >= 2 ? 'moderate' : 'low';
        const isActive = state.riskFilter === key;
        const label = count + ' finding' + (count === 1 ? '' : 's') + ', ' + likelihood + ' likelihood, ' + impact + ' impact';
        if (count === 0) {
          return '<div class="risk-cell risk-cell--' + band + ' is-empty" role="gridcell" aria-label="' + escapeAttr(label) + '"><span class="risk-cell-count">·</span></div>';
        }
        return '<button type="button" class="risk-cell risk-cell--' + band + (isActive ? ' is-active' : '')
          + '" role="gridcell" data-action="risk-filter" data-payload="' + escapeAttr(isActive ? '' : key) + '"'
          + ' title="' + escapeAttr(label) + '" aria-label="' + escapeAttr(label) + '">'
          + '<span class="risk-cell-count">' + count + '</span></button>';
      }).join('');
      return '<div class="risk-matrix-row"><span class="risk-axis-label">' + escapeHtml(impact) + '</span>' + cells + '</div>';
    }).join('');

    return `
      <article class="panel-card">
        <h3>Risk matrix</h3>
        <p class="section-copy">Open findings by likelihood and impact. Select a cell to filter the register.</p>
        <div class="risk-matrix" role="grid" aria-label="Risk matrix: impact by likelihood">
          ${rows}
          <div class="risk-matrix-row risk-matrix-foot">
            <span class="risk-axis-label"></span>
            ${RISK_LEVELS.map(level => '<span class="risk-axis-label">' + escapeHtml(level) + '</span>').join('')}
          </div>
        </div>
        <div class="risk-axis-caption"><span>Impact ↑</span><span>Likelihood →</span></div>
      </article>
    `;
  }

  function renderRiskFinding(finding) {
    const sev = escapeAttr(finding.likelihood + '-' + finding.impact);
    const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
    const isOpen = finding.status === 'open';
    return `
      <article class="risk-finding risk-finding--${escapeAttr(finding.status)}" data-sev="${sev}" data-dashboard-focus-kind="risk" data-dashboard-focus-id="${escapeAttr(finding.id)}">
        <div class="row-head">
          <strong>${escapeHtml(finding.title)}</strong>
          <span class="risk-tag risk-tag--${escapeAttr(finding.domain)}">${escapeHtml(finding.domain)}</span>
        </div>
        <div class="tag-row">
          <span class="meta-pill">Likelihood ${escapeHtml(finding.likelihood)}</span>
          <span class="meta-pill">Impact ${escapeHtml(finding.impact)}</span>
          <span class="meta-pill">Confidence ${escapeHtml(finding.confidence)}</span>
          <span class="meta-pill">${escapeHtml(RISK_STATUS_LABEL[finding.status] || finding.status)}</span>
        </div>
        ${finding.detail ? `<p class="section-copy">${escapeHtml(finding.detail)}</p>` : ''}
        ${finding.recommendation ? `<p class="section-copy"><strong>Recommended:</strong> ${escapeHtml(finding.recommendation)}</p>` : ''}
        ${finding.statusNote ? `<p class="section-copy"><em>${escapeHtml(finding.statusNote)}</em></p>` : ''}
        ${evidence.length > 0 ? `
          <div class="tag-row">
            ${evidence.map(item => `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(item)}" title="Open ${escapeAttr(item)}">${escapeHtml(item)}</button>`).join('')}
          </div>
        ` : ''}
        <div class="tag-row">
          ${isOpen ? renderDirectorOwnerControl('risk', finding.id) : ''}
          ${isOpen ? `
            <button type="button" class="action-link" data-action="risk-status" data-payload="${escapeAttr(finding.id + '|accepted')}" title="Record that a human has consciously accepted this risk">Accept</button>
            <button type="button" class="action-link" data-action="risk-status" data-payload="${escapeAttr(finding.id + '|mitigated')}" title="Mark as mitigated">Mitigated</button>
            <button type="button" class="action-link" data-action="risk-status" data-payload="${escapeAttr(finding.id + '|dismissed')}" title="Dismiss — not a real concern here">Dismiss</button>
          ` : `
            <button type="button" class="action-link" data-action="risk-status" data-payload="${escapeAttr(finding.id + '|open')}" title="Reopen this finding">Reopen</button>
          `}
          ${renderAtlasDiscussAction('prompt', 'Investigate this recorded ' + finding.domain + ' oversight finding in the current workspace: "' + finding.title + '". ' + (finding.detail || '') + ' Verify whether it still applies, and if it does, propose the smallest concrete change that addresses it. Do not treat this as legal, ethical, or financial advice.', 'Ask AtlasMind to investigate this finding', { title: 'Ask AtlasMind to verify this finding and propose the smallest concrete response' })}
        </div>
      </article>
    `;
  }

  function renderRisk(snapshot) {
    const wrap = (inner) => pageSectionOpen('risk') + inner + '</section>';
    const risk = snapshot.risk;
    if (!risk) { return wrap('<div class="dashboard-empty">Risk data unavailable.</div>'); }

    const domainCards = risk.domains.map(domain => {
      const never = !domain.lastRun;
      const tone = never ? 'neutral' : domain.stale ? 'warn' : domain.openCount > 0 ? 'accent' : 'good';
      const when = never
        ? 'Never run'
        : (domain.daysSinceRun === 0 ? 'Today' : domain.daysSinceRun + ' day(s) ago');
      // Assurance decays toward the staleness cliff instead of flipping at it,
      // so "our legal review is going stale" is visible before day 90.
      const assurance = never
        ? 0
        : Math.max(0, 100 - Math.min(100, ((domain.daysSinceRun || 0) / RISK_STALE_DAYS) * 100));
      return `
        <article class="panel-card">
          <div class="row-head">
            <strong>${escapeHtml(domain.label)}</strong>
            <span class="risk-tag risk-tag--${escapeAttr(domain.domain)}">${escapeHtml(domain.openCount + ' open')}</span>
          </div>
          ${renderMetricPill('Last reviewed', when, {
            tone: tone,
            meter: assurance,
            meterKey: `risk-assurance:${domain.domain}`,
          })}
          <div class="list-meta">${escapeHtml(never ? 'No assurance recorded yet.' : `${Math.round(assurance)}% of the ${RISK_STALE_DAYS}-day assurance window remaining.`)}</div>
          ${/* A clean result only means something if you can see what was looked
                for — "0 open" reads as "nothing was checked" otherwise. Stated
                plainly once the advisor has actually run and found nothing. */ ''}
          ${domain.coverage ? `
            <details class="risk-coverage"${!never && domain.openCount === 0 ? ' open' : ''}>
              <summary>${escapeHtml(never ? 'What this advisor reviews' : domain.openCount === 0 ? 'Reviewed, nothing flagged — what was checked' : 'What this advisor reviews')}</summary>
              <p class="stat-detail">${escapeHtml(domain.coverage)}</p>
            </details>` : ''}
          <button type="button" class="action-link primary" data-action="risk-run" data-payload="${escapeAttr(domain.domain)}"${state.riskBusy ? ' disabled' : ''} title="Run the ${escapeAttr(domain.label)} Oversight advisor over this workspace">
            ${state.riskBusy ? 'Running…' : 'Run ' + escapeHtml(domain.label) + ' review'}
          </button>
        </article>
      `;
    }).join('');

    // Filter can be a domain, a status, or a `likelihood:impact` matrix cell.
    const filter = state.riskFilter;
    const findings = (risk.findings || []).filter(finding => {
      if (!filter) { return true; }
      if (filter.indexOf(':') !== -1) {
        return finding.status === 'open' && (finding.likelihood + ':' + finding.impact) === filter;
      }
      if (RISK_STATUS_LABEL[filter]) { return finding.status === filter; }
      return finding.domain === filter;
    });
    // Open first, then by severity descending, so the worst is always at the top.
    const sorted = findings.slice().sort((a, b) => {
      if ((a.status === 'open') !== (b.status === 'open')) { return a.status === 'open' ? -1 : 1; }
      const weight = f => (RISK_LEVELS.indexOf(f.likelihood) + 1) * (RISK_LEVELS.indexOf(f.impact) + 1);
      return weight(b) - weight(a);
    });

    const statusLine = state.riskStatus
      ? `<p class="section-copy"><em>${escapeHtml(state.riskStatus)}</em></p>`
      : '';

    if (!risk.assessed) {
      return wrap(`
        <article class="panel-card">
          <h3>Risk oversight</h3>
          <p class="section-copy">
            Risk has not been assessed yet. AtlasMind ships three read-only advisors —
            Ethics, Legal, and Commercial — that inspect this workspace and record what they find.
            Nothing is assessed until you run one, and an unassessed project is unknown, not safe:
            risk is left out of the operational score entirely until there is evidence to weigh.
          </p>
          <p class="section-copy">
            <strong>These advisors are not a substitute for professional advice.</strong> They surface
            concerns for human judgement — qualified counsel for legal exposure, an ethics or DPO
            review for human impact, and finance or commercial sign-off for business commitments.
          </p>
          ${statusLine}
          <div class="tag-row">
            <button type="button" class="action-link primary" data-action="risk-run" data-payload="all"${state.riskBusy ? ' disabled' : ''} title="Run all three oversight advisors, one after another">
              ${state.riskBusy ? 'Running…' : 'Run all three reviews'}
            </button>
          </div>
        </article>
        <section class="panel-grid">${domainCards}</section>
      `);
    }

    return wrap(`
      <article class="panel-card">
        <div class="row-head">
          <h3>Risk oversight</h3>
          <span class="list-meta">${escapeHtml(risk.filePath)}</span>
        </div>
        <p class="section-copy">${escapeHtml(risk.summary)}</p>
        <p class="section-copy">
          <strong>Advisory only — not professional advice.</strong> Findings are prompts for human
          judgement, not clearance to proceed, and nothing here blocks a commit or a release.
        </p>
        ${statusLine}
        <div class="tag-row">
          ${renderMetricPill('Risk score', String(risk.score) + '/100', { tone: risk.score >= 80 ? 'good' : risk.score >= 55 ? 'accent' : 'warn', meter: risk.score })}
          ${renderMetricPill('Open', String(risk.openCount), { tone: risk.openCount === 0 ? 'good' : 'warn' })}
          ${renderMetricPill('Accepted', String(risk.acceptedCount), { tone: 'neutral' })}
          ${renderMetricPill('Resolved', String(risk.resolvedCount), { tone: 'good' })}
        </div>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="risk-run" data-payload="all"${state.riskBusy ? ' disabled' : ''} title="Re-run all three oversight advisors">
            ${state.riskBusy ? 'Running…' : 'Re-run all reviews'}
          </button>
          <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(risk.summaryPath)}" title="Open the readable markdown mirror">Open runbook</button>
        </div>
      </article>

      <section class="panel-grid">${domainCards}</section>

      ${renderChartRange('Risk over time')}
      <section class="panel-grid">
        ${renderRiskMatrix(risk.matrix)}
        ${renderChartCard('riskRuns', 'Assessment cadence', 'Oversight runs recorded per day.', risk.trend || [])}
      </section>

      <article class="panel-card">
        <div class="row-head">
          <h3>Register</h3>
          <span class="list-meta">${escapeHtml(String(sorted.length))} of ${escapeHtml(String((risk.findings || []).length))} shown</span>
        </div>
        <div class="tag-row">
          <button type="button" class="action-link${filter === '' ? ' primary' : ''}" data-action="risk-filter" data-payload="">All</button>
          ${['ethics', 'legal', 'commercial'].map(domain => `<button type="button" class="action-link${filter === domain ? ' primary' : ''}" data-action="risk-filter" data-payload="${escapeAttr(domain)}">${escapeHtml(domain)}</button>`).join('')}
          ${['open', 'accepted', 'mitigated', 'dismissed'].map(status => `<button type="button" class="action-link${filter === status ? ' primary' : ''}" data-action="risk-filter" data-payload="${escapeAttr(status)}">${escapeHtml(RISK_STATUS_LABEL[status])}</button>`).join('')}
        </div>
        ${sorted.length === 0
          ? `<div class="dashboard-empty">${escapeHtml((risk.findings || []).length === 0 ? 'No findings recorded. Nothing was flagged by the advisors that have run.' : 'No findings match this filter.')}</div>`
          : sorted.map(renderRiskFinding).join('')}
      </article>
    `);
  }

  function renderDocuments(snapshot) {
    const docs = snapshot.documents || {
      configured: false, filing: [], autoUpdate: [], uncovered: [],
      totalMarkdown: 0, markdownCapped: false, reviewDueCount: 0, missingCount: 0,
      filePath: 'project_memory/operations/documents.json',
      summaryPath: 'project_memory/operations/documents.md', summary: '',
    };
    const filing = Array.isArray(docs.filing) ? docs.filing : [];
    const autoUpdate = Array.isArray(docs.autoUpdate) ? docs.autoUpdate : [];
    const uncovered = Array.isArray(docs.uncovered) ? docs.uncovered : [];
    const editing = state.editingDoc;

    const chips = [
      { label: `${docs.totalMarkdown}${docs.markdownCapped ? '+' : ''} markdown file${docs.totalMarkdown === 1 ? '' : 's'}`, tone: 'accent' },
    ];
    if (docs.reviewDueCount > 0) { chips.push({ label: `${docs.reviewDueCount} need review`, tone: 'warn' }); }
    if (docs.missingCount > 0) { chips.push({ label: `${docs.missingCount} missing`, tone: 'critical' }); }
    if (docs.reviewDueCount === 0 && docs.missingCount === 0 && autoUpdate.length > 0) {
      chips.push({ label: 'All tracked docs current', tone: 'good' });
    }

    const emptyState = !docs.configured && filing.length === 0 && autoUpdate.length === 0 && !editing;
    // A file this build could not read was left on disk rather than replaced.
    // Saying so matters because an explicit save *will* overwrite it.
    const fileNotice = docs.fileNotice
      ? '<div class="delivery-review-banner warn"><div class="delivery-review-body"><strong>About this file</strong><div class="list-meta">' + escapeHtml(docs.fileNotice) + '</div></div></div>'
      : '';

    return `
      ${pageSectionOpen('documents')}
        ${renderPageIntro({
          kicker: 'Documents',
          title: 'Document filing system & auto-maintenance',
          summary: docs.summary || 'Define where your documents live and which ones AtlasMind should help keep current. AtlasMind never rewrites a file on its own — it flags staleness and offers an assisted update you trigger.',
          chips,
          ...(docs.configured ? { action: { file: docs.summaryPath, hint: 'Open documents.md' }, actionLabel: 'Open runbook' } : {}),
        })}
        ${fileNotice}
        ${emptyState ? `
          <article class="panel-card">
            <p class="section-kicker">Get started</p>
            <h3>No filing system yet</h3>
            <div class="stat-detail">Seed a starter filing system from folders and key docs already in your repo (README, CHANGELOG, docs/, wiki/…), then refine it. Nothing is overwritten — this just records where documents live and which ones to keep current.</div>
            <div class="tag-row">
              <button type="button" class="action-link primary" data-action="documents-seed">Seed from repo</button>
              <button type="button" class="action-link" data-action="documents-add-filing">Add a shelf</button>
              <button type="button" class="action-link" data-action="documents-add-auto">Track a document</button>
            </div>
          </article>
        ` : `
          <div class="panel-grid">
            <article class="list-card">
              <div class="promotion-section-head">
                <div>
                  <p class="section-kicker">Filing system</p>
                  <h3>Document shelves</h3>
                </div>
                <button type="button" class="action-link" data-action="documents-add-filing">+ Add shelf</button>
              </div>
              <div class="stat-detail">Each shelf is a folder (optionally narrowed by a glob) that groups related documents.</div>
              <div class="stack-list">
                ${editing && editing.kind === 'filing' && editing.id === 'new' ? renderDocFilingEditor(null) : ''}
                ${filing.length > 0
                  ? filing.map(entry => renderDocFilingItem(entry, editing)).join('')
                  : (editing && editing.kind === 'filing' ? '' : '<div class="dashboard-empty">No shelves yet. Add one to describe where documents live.</div>')}
              </div>
            </article>
            <article class="list-card">
              <div class="promotion-section-head">
                <div>
                  <p class="section-kicker">Kept updated automatically</p>
                  <h3>Tracked documents</h3>
                </div>
                <button type="button" class="action-link" data-action="documents-add-auto">+ Track document</button>
              </div>
              <div class="stat-detail">AtlasMind flags these when they drift from what they should track and offers an assisted update. It never edits them on a timer.</div>
              ${renderDistributionBar('documents-freshness', [
                { label: 'Fresh', value: autoUpdate.filter(entry => entry.status === 'fresh').length, tone: 'good' },
                { label: 'Review due', value: autoUpdate.filter(entry => entry.status === 'review-due').length, tone: 'warn' },
                { label: 'Missing', value: autoUpdate.filter(entry => entry.status === 'missing').length, tone: 'critical' },
                { label: 'Unknown', value: autoUpdate.filter(entry => entry.status === 'unknown').length, tone: 'muted' },
              ], {
                title: 'Documentation freshness',
                caption: `${autoUpdate.length} tracked`,
                emptyLabel: '',
              })}
              <div class="stack-list">
                ${editing && editing.kind === 'auto' && editing.id === 'new' ? renderDocAutoEditor(null) : ''}
                ${autoUpdate.length > 0
                  ? autoUpdate.map(entry => renderDocAutoItem(entry, editing)).join('')
                  : (editing && editing.kind === 'auto' ? '' : '<div class="dashboard-empty">No tracked documents yet. Add one to keep it current.</div>')}
              </div>
            </article>
          </div>
          ${uncovered.length > 0 ? `
            <article class="list-card">
              <p class="section-kicker">Discovered</p>
              <h3>Markdown not yet filed or tracked</h3>
              <div class="stat-detail">These markdown files aren't covered by a shelf or tracked for updates. Add the ones that matter.</div>
              <div class="stack-list">
                ${uncovered.map(rel => `
                  <div class="recent-item">
                    <div class="row-head">
                      <strong>${escapeHtml(rel)}</strong>
                      <span class="tag-group">
                        <button type="button" class="action-link" data-action="documents-track-uncovered" data-payload="${escapeAttr(rel)}">Track</button>
                        <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(rel)}">Open</button>
                      </span>
                    </div>
                  </div>`).join('')}
              </div>
            </article>
          ` : ''}
        `}
      </section>
    `;
  }

  function renderDocFilingItem(entry, editing) {
    if (editing && editing.kind === 'filing' && editing.id === entry.id) {
      return renderDocFilingEditor(entry);
    }
    const pathLabel = entry.path + (entry.pattern ? '/' + entry.pattern : '');
    return `
      <div class="recent-item">
        <div class="row-head">
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="tag-group">
            <span class="tag ${entry.exists ? 'tag-good' : 'tag-critical'}">${entry.exists ? escapeHtml(entry.markdownCount + ' md') : 'missing'}</span>
          </span>
        </div>
        <div class="list-meta"><code>${escapeHtml(pathLabel)}</code></div>
        ${entry.description ? `<div class="list-meta">${escapeHtml(entry.description)}</div>` : ''}
        <div class="tag-row">
          ${entry.exists ? '' : `<button type="button" class="action-link primary" data-action="documents-create-folder" data-payload="${escapeAttr(entry.path)}" title="Create this folder in the workspace">Create folder</button>`}
          <button type="button" class="action-link" data-action="documents-edit-filing" data-payload="${escapeAttr(entry.id)}">Edit</button>
          <button type="button" class="action-link danger" data-action="documents-delete-filing" data-payload="${escapeAttr(entry.id)}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderDocFilingEditor(entry) {
    const e = entry || {};
    const isNew = !entry;
    return `
      <div class="panel-card stage-editor" id="doc-filing-editor">
        <p class="section-kicker">${isNew ? 'Add shelf' : 'Edit shelf'}</p>
        <div class="stage-edit-grid">
          <label class="stage-edit-field"><span>Folder path (workspace-relative) *</span><input type="text" data-doc-field="path" value="${escapeAttr(e.path || '')}" placeholder="docs" /></label>
          <label class="stage-edit-field"><span>Label</span><input type="text" data-doc-field="label" value="${escapeAttr(e.label || '')}" placeholder="Docs" /></label>
          <label class="stage-edit-field"><span>Glob (optional)</span><input type="text" data-doc-field="pattern" value="${escapeAttr(e.pattern || '')}" placeholder="**/*.md" /></label>
          <label class="stage-edit-field" style="grid-column:1 / -1;"><span>Description</span><input type="text" data-doc-field="description" value="${escapeAttr(e.description || '')}" placeholder="What lives on this shelf" /></label>
        </div>
        <div class="stat-detail">The folder is created for you if it doesn't exist yet. Existing files are never touched.</div>
        <div class="stage-edit-actions">
          <button type="button" class="action-link primary" data-action="documents-save-filing">Save shelf</button>
          <button type="button" class="action-link" data-action="documents-cancel">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderDocAutoItem(entry, editing) {
    if (editing && editing.kind === 'auto' && editing.id === entry.id) {
      return renderDocAutoEditor(entry);
    }
    const tone = entry.status === 'missing' ? 'tag-critical'
      : entry.status === 'review-due' ? 'tag-warn'
      : entry.status === 'fresh' ? 'tag-good'
      : '';
    return `
      <div class="recent-item" data-dashboard-focus-kind="document" data-dashboard-focus-id="${escapeAttr(entry.id)}">
        <div class="row-head">
          <strong>${escapeHtml(entry.label || entry.path)}</strong>
          <span class="tag-group">
            <span class="tag ${tone}">${escapeHtml(entry.statusLabel)}</span>
            <span class="tag">${escapeHtml(docCadenceLabel(entry.cadence))}</span>
          </span>
        </div>
        <div class="list-meta"><code>${escapeHtml(entry.path)}</code></div>
        <div class="list-meta">${escapeHtml(entry.detail)}</div>
        ${entry.sourceHint ? `<div class="list-meta">Tracks: ${escapeHtml(entry.sourceHint)}</div>` : ''}
        <div class="tag-row">
          ${entry.status === 'missing' || entry.status === 'review-due' ? renderDirectorOwnerControl('document', entry.id) : ''}
          ${renderAtlasDiscussAction('prompt', entry.updatePrompt, 'Ask AtlasMind to update this document', { title: 'Ask AtlasMind to inspect and update this document' })}
          <button type="button" class="action-link" data-action="documents-mark-reviewed" data-payload="${escapeAttr(entry.id)}" title="Record that this document is current as of now">Mark reviewed</button>
          ${entry.exists ? `<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(entry.path)}">Open</button>` : ''}
          <button type="button" class="action-link" data-action="documents-edit-auto" data-payload="${escapeAttr(entry.id)}">Edit</button>
          <button type="button" class="action-link danger" data-action="documents-delete-auto" data-payload="${escapeAttr(entry.id)}">Delete</button>
        </div>
      </div>
    `;
  }

  function renderDocAutoEditor(entry) {
    const e = entry || {};
    const isNew = !entry;
    const cadences = [
      ['on-change', 'When related code/config changes'],
      ['on-release', 'On every release'],
      ['weekly', 'Weekly'],
      ['manual', 'Manually (no reminder)'],
    ];
    const current = e.cadence || 'on-change';
    return `
      <div class="panel-card stage-editor" id="doc-auto-editor">
        <p class="section-kicker">${isNew ? 'Track a document' : 'Edit tracked document'}</p>
        <div class="stage-edit-grid">
          <label class="stage-edit-field"><span>File path (workspace-relative) *</span><input type="text" data-doc-field="path" value="${escapeAttr(e.path || '')}" placeholder="README.md" /></label>
          <label class="stage-edit-field"><span>Label</span><input type="text" data-doc-field="label" value="${escapeAttr(e.label || '')}" placeholder="Readme" /></label>
          <label class="stage-edit-field"><span>Update cadence</span><select data-doc-field="cadence">${cadences.map(pair => `<option value="${pair[0]}" ${pair[0] === current ? 'selected' : ''}>${escapeHtml(pair[1])}</option>`).join('')}</select></label>
          <label class="stage-edit-field" style="grid-column:1 / -1;"><span>Should track (what keeps it current)</span><input type="text" data-doc-field="sourceHint" value="${escapeAttr(e.sourceHint || '')}" placeholder="e.g. feature list, config options, version banner" /></label>
        </div>
        <div class="stage-edit-actions">
          <button type="button" class="action-link primary" data-action="documents-save-auto">Save</button>
          <button type="button" class="action-link" data-action="documents-cancel">Cancel</button>
        </div>
      </div>
    `;
  }

  // Reconstruct a clean DocumentsConfig from the enriched snapshot views so
  // client-side mutations post back only the persisted fields (the extension
  // sanitises again before writing to disk).
  function currentDocumentsConfig() {
    const docs = state.snapshot && state.snapshot.documents ? state.snapshot.documents : {};
    const filing = Array.isArray(docs.filing) ? docs.filing.map(f => ({
      id: f.id,
      label: f.label,
      path: f.path,
      ...(f.description ? { description: f.description } : {}),
      ...(f.pattern ? { pattern: f.pattern } : {}),
    })) : [];
    const autoUpdate = Array.isArray(docs.autoUpdate) ? docs.autoUpdate.map(a => ({
      id: a.id,
      path: a.path,
      ...(a.label ? { label: a.label } : {}),
      ...(a.sourceHint ? { sourceHint: a.sourceHint } : {}),
      cadence: a.cadence || 'manual',
      ...(a.lastReviewed ? { lastReviewed: a.lastReviewed } : {}),
    })) : [];
    return { version: 1, filing, autoUpdate };
  }

  function persistDocumentsConfig(config) {
    vscode.postMessage({
      type: 'saveDocumentsConfig',
      payload: {
        version: 1,
        filing: Array.isArray(config.filing) ? config.filing : [],
        autoUpdate: Array.isArray(config.autoUpdate) ? config.autoUpdate : [],
      },
    });
  }

  function createDocId(kind, pathValue) {
    const slug = String(pathValue || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (kind === 'filing' ? 'filing-' : 'doc-') + (slug || Date.now());
  }

  function readDocField(rootId, field) {
    const rootEl = document.getElementById(rootId);
    if (!rootEl) { return ''; }
    const el = rootEl.querySelector('[data-doc-field="' + field + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  function saveDocFilingDraft() {
    const editing = state.editingDoc;
    const cleanPath = readDocField('doc-filing-editor', 'path');
    if (!cleanPath) { return; }
    const entry = {
      id: (editing && editing.id !== 'new') ? editing.id : createDocId('filing', cleanPath),
      label: readDocField('doc-filing-editor', 'label') || cleanPath,
      path: cleanPath,
    };
    const description = readDocField('doc-filing-editor', 'description');
    const pattern = readDocField('doc-filing-editor', 'pattern');
    if (description) { entry.description = description; }
    if (pattern) { entry.pattern = pattern; }
    const config = currentDocumentsConfig();
    config.filing = (editing && editing.id !== 'new')
      ? config.filing.map(f => f.id === editing.id ? entry : f)
      : [...config.filing, entry];
    state.editingDoc = null;
    persistDocumentsConfig(config);
  }

  function saveDocAutoDraft() {
    const editing = state.editingDoc;
    const cleanPath = readDocField('doc-auto-editor', 'path');
    if (!cleanPath) { return; }
    const existing = (editing && editing.id !== 'new')
      ? currentDocumentsConfig().autoUpdate.find(a => a.id === editing.id)
      : undefined;
    const entry = {
      id: (editing && editing.id !== 'new') ? editing.id : createDocId('doc', cleanPath),
      path: cleanPath,
      cadence: readDocField('doc-auto-editor', 'cadence') || 'on-change',
    };
    const label = readDocField('doc-auto-editor', 'label');
    const sourceHint = readDocField('doc-auto-editor', 'sourceHint');
    if (label) { entry.label = label; }
    if (sourceHint) { entry.sourceHint = sourceHint; }
    // Preserve the review baseline across edits.
    if (existing && existing.lastReviewed) { entry.lastReviewed = existing.lastReviewed; }
    const config = currentDocumentsConfig();
    config.autoUpdate = (editing && editing.id !== 'new')
      ? config.autoUpdate.map(a => a.id === editing.id ? entry : a)
      : [...config.autoUpdate, entry];
    state.editingDoc = null;
    persistDocumentsConfig(config);
  }

  function renderSecurity(snapshot) {
    const sec = snapshot.security;
    const assetsPresent = [sec.securityPolicyPresent, sec.codeownersPresent, sec.prTemplatePresent, sec.issueTemplateCount > 0].filter(Boolean).length;
    const fileSignal = (label, present, presentDetail, missingDetail, filePath, createPrompt) => renderSignalCard(
      label,
      present,
      present ? presentDetail : missingDetail,
      present ? { file: filePath, hint: `Open ${label}` } : { prompt: createPrompt, hint: 'Create with Atlas' },
    );
    return `
      ${pageSectionOpen('security')}
        ${renderPageIntro({
          kicker: 'Security posture',
          title: 'Guardrails, governance, and review controls',
          summary: `Write approval is “${sec.toolApprovalMode}” and terminal writes are ${sec.allowTerminalWrite ? 'allowed' : 'blocked'}. ${assetsPresent}/4 governance assets are in place and ${sec.governanceProviders.length} dependency monitor${sec.governanceProviders.length === 1 ? '' : 's'} detected. Click any card to open or create the item it describes.`,
          chips: [
            { label: `Approval: ${sec.toolApprovalMode}`, tone: 'accent' },
            { label: sec.allowTerminalWrite ? 'Terminal writes allowed' : 'Terminal writes blocked', tone: sec.allowTerminalWrite ? 'warn' : 'good' },
            { label: `${assetsPresent}/4 governance assets`, tone: assetsPresent >= 3 ? 'good' : 'warn' },
          ],
          action: { command: 'atlasmind.openSettingsSafety' },
          actionLabel: 'Open safety settings',
        })}
        <div class="security-grid">
          <article class="panel-card">
            <p class="section-kicker">Execution policy</p>
            <h3>Write guardrails</h3>
            <div class="mini-grid">
              ${renderMetricPill('Approval mode', sec.toolApprovalMode, { tone: 'accent', action: { command: 'atlasmind.openSettingsSafety', hint: 'Change in safety settings' } })}
              ${renderMetricPill('Terminal writes', sec.allowTerminalWrite ? 'Allowed' : 'Blocked', { tone: sec.allowTerminalWrite ? 'warn' : 'good', action: { command: 'atlasmind.openSettingsSafety' } })}
              ${renderMetricPill('Auto verify', sec.autoVerifyAfterWrite ? 'Enabled' : 'Disabled', { tone: sec.autoVerifyAfterWrite ? 'good' : 'warn', action: { command: 'atlasmind.openSettingsSafety' } })}
              ${renderMetricPill('Verification commands', sec.autoVerifyScripts, { tone: 'accent' })}
            </div>
            <div class="tag-row">
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openSettingsSafety">⚙ Safety settings</button>
              <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openToolWebhooks">🪝 Tool webhooks</button>
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Repository controls</p>
            <h3>Governance assets</h3>
            <div class="mini-grid" style="margin-bottom: 4px;">
              ${renderMetricPill('Governance completeness', `${assetsPresent}/4`, {
                tone: assetsPresent === 4 ? 'good' : assetsPresent >= 2 ? 'warn' : 'critical',
                meterKey: 'security-governance',
                meter: (assetsPresent / 4) * 100,
              })}
            </div>
            <div class="signal-grid">
              ${fileSignal('SECURITY.md', sec.securityPolicyPresent, 'Security policy present — open to review.', 'No repository security policy. Atlas can draft one.', 'SECURITY.md', 'Create a SECURITY.md security policy for this repository that documents supported versions and how to report a vulnerability. Make the smallest useful first version and summarize what to refine next.')}
              ${fileSignal('CODEOWNERS', sec.codeownersPresent, 'Ownership rules configured.', 'No CODEOWNERS file. Atlas can scaffold one.', '.github/CODEOWNERS', 'Create a .github/CODEOWNERS file mapping the main areas of this repository to sensible owners based on the project structure, then summarize which globs may need adjusting.')}
              ${fileSignal('PR template', sec.prTemplatePresent, 'Pull request checklist detected.', 'No PR template. Atlas can add a review checklist.', '.github/pull_request_template.md', 'Create a .github/pull_request_template.md with a concise pull-request checklist covering tests, docs, security, and version/changelog for this project.')}
              ${renderSignalCard('Issue templates', sec.issueTemplateCount > 0, `${sec.issueTemplateCount} issue template file(s) detected.`, sec.issueTemplateCount > 0 ? { prompt: 'Review the GitHub issue templates in .github/ISSUE_TEMPLATE and suggest improvements for clarity and triage.', hint: 'Review with Atlas' } : { prompt: 'Scaffold GitHub issue templates (bug report and feature request) under .github/ISSUE_TEMPLATE for this project.', hint: 'Create with Atlas' })}
            </div>
          </article>
          <article class="panel-card">
            <p class="section-kicker">Governance providers</p>
            <h3>Dependency monitoring</h3>
            <div class="tag-row">
              ${sec.governanceProviders.length > 0 ? sec.governanceProviders.map(provider => `<span class="governance-pill"><span class="pill-dot"></span>${escapeHtml(provider)}</span>`).join('') : '<span class="governance-pill">None detected</span>'}
            </div>
            ${renderSignalCard('Automated dependency governance', sec.governanceProviders.length > 0, sec.governanceProviders.length > 0 ? `${sec.governanceProviders.join(', ')} keeping dependencies monitored.` : 'No Dependabot/Renovate-style automation detected.', sec.governanceProviders.length > 0 ? { prompt: `Review this repository's automated dependency governance (${sec.governanceProviders.join(', ')}) and suggest improvements to its update cadence, grouping, and security coverage.`, hint: 'Review with Atlas' } : { prompt: 'Add automated dependency governance (Dependabot or Renovate) to this repository with a minimal, sensible configuration, then summarize what to tune next.', hint: 'Add with Atlas' })}
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
          ${provider.models.length > 0 ? `
            <div class="privacy-tree-meter" role="img" aria-label="${escapeAttr(`${provider.trustedCount} of ${provider.models.length} ${provider.name} models cleared for confidential context`)}">
              <span data-anim-key="privacy-trust:${escapeAttr(provider.id)}" data-anim-to="${(provider.trustedCount / provider.models.length) * 100}%" style="width:0%"></span>
            </div>` : ''}
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
      ${renderChartRange('Catch history')}
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
              <div class="coverage-bar"><span data-anim-key="privacy-source:${escapeAttr(source.label)}" data-anim-to="${width}%" style="width:0%"></span></div>
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
      ${pageSectionOpen('privacy')}
        ${renderPageIntro({
          kicker: 'Data privacy',
          title: 'Keep confidential data on trusted models',
          summary: `Enforcement is ${privacy.enabled ? 'on' : 'off'} with ${(privacy.rules || []).length} custom rule${(privacy.rules || []).length === 1 ? '' : 's'}, ${(privacy.compliancePacks || []).length} compliance pack${(privacy.compliancePacks || []).length === 1 ? '' : 's'}, and ${trusted.length} trusted model${trusted.length === 1 ? '' : 's'}. ${privacy.activity ? `${privacy.activity.redactedCount || 0} redaction${(privacy.activity.redactedCount || 0) === 1 ? '' : 's'} recorded.` : ''} Classified content is redacted for every model except the ones you trust below.`.trim(),
          chips: [
            { label: privacy.enabled ? 'Enforcement on' : 'Enforcement off', tone: privacy.enabled ? 'good' : 'warn' },
            { label: `${trusted.length} trusted model${trusted.length === 1 ? '' : 's'}`, tone: trusted.length > 0 ? 'good' : privacy.enabled ? 'warn' : 'accent' },
          ],
        })}
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
            ${state.reimportConfirm
              ? '<span class="reimport-confirm">Replace pipeline from repo signals? <button type="button" class="action-link danger" data-action="delivery-reimport-confirm" data-payload="">Yes, re-import</button> <button type="button" class="action-link" data-action="delivery-reimport-cancel" data-payload="">Cancel</button></span>'
              : '<button type="button" class="action-link" data-action="delivery-reimport" data-payload="">↻ Re-import from repo</button>'}
            <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(summaryPath)}">📖 Open runbook (delivery.md)</button>
            <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(pipeline.configPath)}">Edit delivery.json</button>
            <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openWebsiteStudio">🌐 Website Studio</button>
          </div>
        </div>
        ${renderDeliveryReviewBanner(pipeline.review)}
        ${renderPipelineFlow(pipeline.stages)}
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
        ${state.rollbackNotice ? `<p class="stage-seeded-note">${escapeHtml(state.rollbackNotice)}</p>` : ''}
        ${state.healthNotice ? `<p class="stage-seeded-note">${escapeHtml(state.healthNotice)}</p>` : ''}
        ${renderDeliveryHistory(pipeline.history)}
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
          ${stage.healthCheckUrl ? `<button type="button" class="action-link" data-action="test-health-url" data-payload="${escapeAttr(stage.healthCheckUrl)}">Test health</button>` : ''}
          ${renderStageRollback(stage)}
          <button type="button" class="action-link" data-action="stage-edit" data-payload="${escapeAttr(stage.id)}">Edit</button>
        </div>
      </article>`;
  }

  function renderPipelineFlow(stages) {
    if (!stages || stages.length === 0) { return ''; }
    return `
      <div class="pipeline-flow">
        ${stages.map((s, i) => `
          <div class="flow-node kind-${escapeAttr(s.kind)} ${s.isCurrentBranch ? 'current' : ''}">
            <span class="flow-name">${escapeHtml(s.name)} ${s.isProtected ? '🔒' : ''}</span>
            <span class="flow-branch mono">${escapeHtml(s.branchRef || 'working tree')}${s.branchRef && !s.branchExists ? ' ⚠' : ''}</span>
            <span class="flow-ver mono">v${escapeHtml(s.deployedVersion)}</span>
          </div>
          ${i < stages.length - 1 ? '<div class="flow-arrow">→</div>' : ''}
        `).join('')}
      </div>`;
  }

  function renderStageRollback(stage) {
    if (!stage.hasRollback) { return ''; }
    if (state.rollbackArmedStageId !== stage.id) {
      return `<button type="button" class="action-link danger" data-action="stage-rollback" data-payload="${escapeAttr(stage.id)}">↩ Roll back</button>`;
    }
    const typeToConfirm = stage.isProtected
      ? `<input type="text" id="rollback-confirm-text" value="${escapeAttr(state.rollbackText)}" placeholder="type ${escapeAttr(stage.name)}" autocomplete="off" class="rollback-input" />`
      : '';
    return `<span class="reimport-confirm">Run ${escapeHtml(stage.name)} rollback command? ${typeToConfirm}
      <button type="button" class="action-link danger" data-action="stage-rollback-confirm" data-payload="${escapeAttr(stage.id)}">Confirm</button>
      <button type="button" class="action-link" data-action="stage-rollback-cancel" data-payload="">Cancel</button></span>`;
  }

  function renderDeliveryHistory(history) {
    if (!history || history.length === 0) { return ''; }

    // "Are our releases going green, and how often do we ship?" was previously
    // answerable only by reading eight text rows. Oldest on the left so the
    // strip reads left-to-right as time.
    const strip = [...history].reverse();
    const succeeded = strip.filter(h => h.succeeded).length;
    const successRate = Math.round((succeeded / strip.length) * 100);

    return `
      <div class="promotion-section-head">
        <p class="section-kicker" style="margin-top:6px">Recent promotions</p>
        <span class="release-rate ${successRate === 100 ? 'good' : successRate >= 75 ? 'warn' : 'bad'}">${escapeHtml(String(successRate))}% green · ${escapeHtml(String(strip.length))} recorded</span>
      </div>
      <div class="release-strip" role="img" aria-label="${escapeAttr(`${succeeded} of ${strip.length} recent promotions succeeded`)}">
        ${strip.map(h => `
          <span class="release-tick ${h.succeeded ? 'ok' : 'fail'}${h.kind === 'rollback' ? ' rollback' : ''}"
            title="${escapeAttr(`${h.kind === 'rollback' ? 'Rollback of ' : ''}${h.toName || ''}${h.version ? ` v${h.version}` : ''} — ${h.succeeded ? 'succeeded' : 'failed'}, ${relativeLabel(h.ranAt)}`)}"></span>`).join('')}
      </div>
      <div class="stack-list">
        ${history.slice(0, 8).map(h => `
          <div class="history-row ${h.succeeded ? 'good' : 'bad'}">
            <span>${h.succeeded ? '✓' : '✗'} ${h.kind === 'rollback' ? '↩ Rollback of ' : ''}${escapeHtml((h.kind !== 'rollback' && h.fromName) ? `${h.fromName} → ` : '')}${escapeHtml(h.toName || '')}${h.version ? ` (v${escapeHtml(h.version)})` : ''}</span>
            <span class="list-meta">${escapeHtml(relativeLabel(h.ranAt))}${h.actor ? ` · ${escapeHtml(h.actor)}` : ''}</span>
          </div>`).join('')}
      </div>`;
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
          <h4>${escapeHtml(path.fromName)} → ${escapeHtml(path.toName)} ${path.viaPullRequest ? '<span class="via-pr-badge">🔀 via PR</span>' : ''}</h4>
          ${path.versionDelta ? `<span class="version-delta">${escapeHtml(path.versionDelta)}</span>` : ''}
        </div>
        <ol class="guardrail-list">
          ${path.guardrails.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
        </ol>
        <div class="gate-row"><span>Gates:</span> ${gates}</div>
        ${(path.statusChecks || []).length > 0 ? `<div class="gate-row"><span>CI:</span> ${path.statusChecks.map(c => `<span class="tag mono">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
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

  // ── Project Director helpers ───────────────────────────────────
  function emptyDirectorConfig() {
    return {
      version: 1, project: { name: '', summary: '' }, selfContactId: '',
      contacts: [], stakeholders: [], teamMembers: [], responsibilities: [],
      assignments: [], followUps: [],
      settings: { teamMode: 'auto', nudgeOnActivation: true, remindersEnabled: false, outboundEnabled: false },
    };
  }
  function getDirectorConfig() {
    const d = state.snapshot && state.snapshot.director;
    return d && d.config ? d.config : null;
  }
  function cloneDirectorConfig() {
    const cfg = getDirectorConfig();
    return cfg ? JSON.parse(JSON.stringify(cfg)) : emptyDirectorConfig();
  }
  function postDirectorConfig(cfg) {
    vscode.postMessage({ type: 'saveDirectorConfig', payload: cfg });
  }
  function directorTodayKey() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function directorAddDaysKey(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function directorNameOf(cfg, contactId) {
    const c = cfg.contacts.find(x => x.id === contactId);
    return c ? c.name : '—';
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

  /** The communication channels a person can be reached on. */
  var DIRECTOR_LINK_KINDS = ['email', 'slack', 'teams', 'buzz', 'phone', 'github', 'linkedin', 'other']
    .map(k => ({ value: k, label: k }));

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
          ${edText('Migrate command', 'data.migrateCommand', stage.data.migrateCommand, 'npm run db:migrate (runs during promote)')}
        </div>
        <p class="stage-edit-group">Backup &amp; recovery <small>runs before any push to this stage</small></p>
        ${edCheck('Backup required before any push to this stage', 'backupPolicy.required', stage.backupPolicy.required)}
        <div class="stage-edit-grid">
          ${edText('Backup command', 'backupPolicy.command', stage.backupPolicy.command, 'pg_dump … (taken before promote)')}
          ${edText('Backup verify command', 'backupPolicy.verifyCommand', stage.backupPolicy.verifyCommand, 'confirms the snapshot is restorable')}
          ${edText('Backup runbook ref', 'backupPolicy.runbookRef', stage.backupPolicy.runbookRef, '')}
          ${edText('Retention', 'backupPolicy.retention', stage.backupPolicy.retention, '7 daily snapshots')}
        </div>
        <p class="stage-edit-group">Promotion gates <small>apply to pushes INTO this stage</small></p>
        ${edCheck('Require human approval before a push runs', 'promotionPolicy.requiresApproval', stage.promotionPolicy.requiresApproval)}
        ${edCheck('Require a version bump', 'promotionPolicy.requireVersionBump', stage.promotionPolicy.requireVersionBump)}
        ${edCheck('Require a changelog entry', 'promotionPolicy.requireChangelog', stage.promotionPolicy.requireChangelog)}
        ${edCheck('Separation of duties — approver must differ from the change author', 'promotionPolicy.requireDistinctApprover', stage.promotionPolicy.requireDistinctApprover)}
        ${edArea('Required checks (one per line)', 'promotionPolicy.requiredChecks', checks, 'Working tree clean\nTests pass\nCI green')}
        ${edText('Dispatch CD workflow (trigger CD instead of local deploy)', 'promotionPolicy.dispatchWorkflow', stage.promotionPolicy.dispatchWorkflow, 'release.yml')}
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

  // "Resolve & run" is offered when a remediation exists, every non-fixable auto
  // check already passes, there is at least one failing fixable check to resolve,
  // and the user has satisfied the manual/approval/protected gates.
  function resolveAndRunEnabled(p) {
    const plan = p.plan;
    if (!plan || plan.blockers.length || !plan.remediation) { return false; }
    if (plan.checks.some(c => c.kind === 'auto' && c.status !== 'pass' && !c.fixable)) { return false; }
    if (!plan.checks.some(c => c.kind === 'auto' && c.status !== 'pass' && c.fixable)) { return false; }
    if (!plan.checks.filter(c => c.kind === 'manual').every(c => p.attestations[c.id])) { return false; }
    if (plan.requiresApproval && !p.attestations['approve']) { return false; }
    if (plan.isProtected && (p.confirmText || '').trim().toLowerCase() !== plan.toName.trim().toLowerCase()) { return false; }
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
      ${autoChecks.map(c => `<li class="promo-check ${c.status === 'pass' ? 'pass' : 'fail'}">${c.status === 'pass' ? '✓' : '✗'} <span>${escapeHtml(c.label)}</span>${c.fixable ? ' <span class="promo-fix-tag">fixable</span>' : ''}<small>${escapeHtml(c.detail)}</small></li>`).join('')}
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
      const canResolve = resolveAndRunEnabled(p);
      actions = `${canResolve ? `<button type="button" class="action-link primary" data-action="promotion-resolve-run" data-payload="">Resolve &amp; run</button>` : ''}
                 <button type="button" class="action-link${canResolve ? '' : ' primary'}" data-action="promotion-run" data-payload="" ${enabled ? '' : 'disabled'}>Confirm &amp; run</button>
                 <button type="button" class="action-link" data-action="promotion-cancel" data-payload="">Cancel</button>`;
    }

    return `
      <div class="promo-overlay">
        <div class="promo-modal">
          <h3>${runbook ? 'Runbook' : 'Promote'} — ${escapeHtml(plan.fromName)} → ${escapeHtml(plan.toName)} ${plan.isProtected ? '🔒' : ''}${plan.viaPullRequest ? ' <span class="via-pr-badge">🔀 via PR</span>' : ''}</h3>
          ${blocked ? `<div class="promo-blockers">${plan.blockers.map(b => `<p class="promotion-block-note">⚠ ${escapeHtml(b)}</p>`).join('')}</div>` : ''}
          <div class="promo-section">
            <h4>Plan</h4>
            <ol class="promo-plan-list">${stepsHtml}</ol>
          </div>
          ${plan.checks.length ? `<div class="promo-section"><h4>Preflight checks</h4><ul class="promo-check-list">${checksHtml}</ul></div>` : ''}
          ${(!runbook && !done && plan.remediation) ? `<div class="promo-remediation"><strong>⚙ Resolve &amp; run</strong> will ${escapeHtml(plan.remediation.summary)}<small>${escapeHtml(plan.remediation.bumpReason)}</small></div>` : ''}
          ${(!runbook && plan.requiresApproval) ? `<label class="stage-edit-check"><input type="checkbox" class="promotion-attest" data-check-id="approve" ${p.attestations['approve'] ? 'checked' : ''}/> <span>I approve this promotion to ${escapeHtml(plan.toName)}.</span></label>` : ''}
          ${(!runbook && plan.isProtected) ? `<label class="stage-edit-field"><span>Type “${escapeHtml(plan.toName)}” to confirm (protected stage)</span><input type="text" id="promotion-confirm-text" value="${escapeAttr(p.confirmText)}" placeholder="${escapeAttr(plan.toName)}" autocomplete="off" /></label>` : ''}
          ${p.progress && p.progress.length ? `<div class="promo-section"><h4>Progress</h4><ul class="promo-progress-list">${p.progress.map(s => `<li class="promo-step ${escapeAttr(s.status)}">${promoStatusIcon(s.status)} ${escapeHtml(s.label)}${s.output ? `<div class="promo-step-out">${escapeHtml(s.output)}</div>` : ''}</li>`).join('')}</ul></div>` : ''}
          ${done ? `<div class="promo-section promo-result ${p.result.succeeded ? 'good' : 'bad'}">
            <h4>${p.result.succeeded ? '✓ Promotion completed' : '✗ Promotion failed'}</h4>
            <ul class="promo-progress-list">${p.result.steps.map(s => `<li class="promo-step ${s.skipped ? 'skipped' : (s.ok ? 'done' : 'failed')}">${s.skipped ? '•' : (s.ok ? '✓' : '✗')} ${escapeHtml(s.label)}${s.output ? `<div class="promo-step-out">${escapeHtml(s.output)}</div>` : ''}${(!s.ok && !s.skipped) ? `<div class="promo-step-fix"><button type="button" class="action-link" data-action="fix-promotion-step" data-payload="${escapeAttr(s.id)}">Ask Atlas to fix this</button></div>` : ''}</li>`).join('')}</ul>
            ${(p.result.rollback && (p.result.rollback.command || p.result.rollback.runbookRef)) ? `<p class="promotion-last">Recovery: ${escapeHtml(p.result.rollback.command || p.result.rollback.runbookRef)}</p>` : ''}
          </div>` : ''}
          ${p.error ? `<p class="promotion-block-note">⚠ ${escapeHtml(p.error)}</p>` : ''}
          <div class="stage-edit-actions">${actions}</div>
        </div>
      </div>`;
  }

  function renderDelivery(snapshot) {
    const guide = snapshot.delivery && snapshot.delivery.guide;
    const blockerCount = guide ? Number(guide.blockerCount || 0) : 0;
    return `
      ${pageSectionOpen('delivery')}
        ${renderPageIntro({
          kicker: 'Project delivery',
          title: 'Package, deploy, and publish this project',
          summary: guide
            ? `AtlasMind detected the ${guide.ecosystem} toolchain, ${guide.configuredCount} configured or conventional step${guide.configuredCount === 1 ? '' : 's'}, and ${blockerCount} missing blocker${blockerCount === 1 ? '' : 's'}. Opening or refreshing this page never runs a command; every run starts with a click and a confirmation.`
            : 'AtlasMind could not collect a project-specific delivery guide. The deployment pipeline remains available below.',
          chips: guide ? [
            { label: guide.toolchain || guide.ecosystem, tone: guide.ecosystem === 'Undeclared' ? 'warn' : 'accent' },
            { label: guide.target || 'Target not configured', tone: guide.target === 'Not configured' ? 'warn' : 'good' },
            { label: blockerCount ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}` : 'No detected blockers', tone: blockerCount ? 'critical' : 'good' },
          ] : [],
        })}
        ${renderProjectDeliveryGuide(guide)}
        ${renderStagePipeline(snapshot)}
        <div class="delivery-grid">
          <article class="panel-card">
            <p class="section-kicker">Dependencies</p>
            <h3>Package shape</h3>
            <div class="mini-grid">
              ${renderMetricPill('Version', snapshot.delivery.packageVersion)}
              ${renderMetricPill('Dependencies', String(snapshot.delivery.dependencyCount), {
                tone: 'accent',
                meterKey: 'delivery-deps',
                meter: (snapshot.delivery.dependencyCount + snapshot.delivery.devDependencyCount) > 0
                  ? (snapshot.delivery.dependencyCount / (snapshot.delivery.dependencyCount + snapshot.delivery.devDependencyCount)) * 100
                  : 0,
              })}
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
                  <div class="tag-row">${workflow.triggers.length > 0 ? workflow.triggers.map(trigger => `<span class="tag mono">${escapeHtml(trigger.event || trigger)}</span>`).join('') : '<span class="tag">No triggers parsed</span>'}</div>
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
              ${renderDistributionBar('delivery-artifacts', (function() {
                // Group by lifecycle phase so "N missing" becomes "the whole
                // test lifecycle is missing", which is a different conversation.
                const phases = [];
                artifacts.forEach(a => {
                  const phase = a.lifecycle || 'other';
                  if (phases.indexOf(phase) === -1) { phases.push(phase); }
                });
                return phases.map(phase => {
                  const inPhase = artifacts.filter(a => (a.lifecycle || 'other') === phase);
                  const missing = inPhase.filter(a => a.needsAttention).length;
                  return {
                    label: `${phase.charAt(0).toUpperCase()}${phase.slice(1)}${missing > 0 ? ` (${missing} missing)` : ''}`,
                    value: inPhase.length,
                    tone: missing === 0 ? 'good' : missing === inPhase.length ? 'critical' : 'warn',
                  };
                });
              })(), {
                title: 'Coverage by lifecycle phase',
                caption: `${artifacts.length} tracked`,
                emptyLabel: '',
              })}
              <div class="artifact-list">
                ${artifacts.length > 0 ? artifacts.map(a => renderArtifactRow(a)).join('') : '<div class="dashboard-empty">No artifact data available.</div>'}
              </div>
            </article>
          `;
        })()}
      </section>
    `;
  }

  function deliveryGuideStatus(status) {
    if (status === 'configured') { return { icon: '✓', label: 'configured', tone: 'good' }; }
    if (status === 'conventional') { return { icon: '◇', label: 'runtime convention', tone: 'accent' }; }
    if (status === 'missing') { return { icon: '!', label: 'missing', tone: 'critical' }; }
    return { icon: '○', label: 'manual check', tone: 'warn' };
  }

  function renderProjectDeliveryGuide(guide) {
    if (!guide || !Array.isArray(guide.phases)) { return ''; }
    const flow = guide.phases.map(phase => {
      const blockers = (phase.steps || []).filter(step => step.status === 'missing' && step.blocking).length;
      const missing = (phase.steps || []).filter(step => step.status === 'missing').length;
      const manual = (phase.steps || []).filter(step => step.status === 'manual').length;
      const conventional = (phase.steps || []).filter(step => step.status === 'conventional').length;
      return {
        label: phase.label,
        status: blockers > 0 ? 'critical' : missing > 0 || manual > 0 ? 'warn' : conventional > 0 ? 'accent' : 'good',
        icon: blockers > 0 ? '!' : missing > 0 || manual > 0 ? '○' : conventional > 0 ? '◇' : '✓',
        sub: `${(phase.steps || []).length} step${(phase.steps || []).length === 1 ? '' : 's'}`,
        title: phase.description,
      };
    });
    return `
      <article class="list-card delivery-guide" style="grid-column: 1 / -1">
        <div class="delivery-guide-header">
          <div>
            <p class="section-kicker">Detected runbook</p>
            <h3>What to do, in order</h3>
            <p class="section-copy">Each column starts collapsed. Its numbered identifier carries the strongest status inside: green is fully configured, blue includes a runtime convention, amber needs a manual check, and red has a missing blocker. Open a column for its steps. The AtlasMind logo on any non-green step opens a focused resolution draft; <strong>⧉</strong> copies a command, <strong>&gt;_</strong> types it without pressing Enter, and <strong>▶ Run</strong> runs the column only after you confirm the exact list.</p>
          </div>
          <span class="tag ${guide.blockerCount ? 'tag-critical' : 'tag-good'}">${guide.configuredCount}/${guide.totalCount} detected · ${guide.blockerCount} blocking</span>
        </div>
        ${renderFlowStrip(flow)}
        <div class="delivery-guide-phases">
          ${guide.phases.map((phase, phaseIndex) => {
            const runnable = (phase.steps || []).filter(step => step.command).length;
            const blockers = (phase.steps || []).filter(step => step.status === 'missing' && step.blocking).length;
            const missing = (phase.steps || []).filter(step => step.status === 'missing').length;
            const manual = (phase.steps || []).filter(step => step.status === 'manual').length;
            const conventional = (phase.steps || []).filter(step => step.status === 'conventional').length;
            const phaseTone = blockers > 0 ? 'critical' : missing > 0 || manual > 0 ? 'warn' : conventional > 0 ? 'accent' : 'good';
            const phaseStatus = blockers > 0 ? `${blockers} blocking` : missing > 0 ? `${missing} missing` : manual > 0 ? `${manual} manual` : conventional > 0 ? `${conventional} conventional` : 'configured';
            return `
            <details class="delivery-guide-phase phase-${escapeAttr(phaseTone)}">
              <summary class="delivery-guide-phase-head" aria-labelledby="delivery-guide-phase-${phaseIndex}">
                <span class="delivery-guide-number status-${escapeAttr(phaseTone)}">${phaseIndex + 1}</span>
                <div class="delivery-guide-phase-copy">
                  <h4 id="delivery-guide-phase-${phaseIndex}">${escapeHtml(phase.label)}</h4>
                  <p>${escapeHtml(phase.description)}</p>
                </div>
                <span class="delivery-guide-phase-status tag ${phaseTone === 'critical' ? 'tag-critical' : phaseTone === 'warn' ? 'tag-warn' : phaseTone === 'good' ? 'tag-good' : ''}">${escapeHtml(phaseStatus)}</span>
              </summary>
              ${runnable > 0 ? `<div class="delivery-guide-phase-actions"><button type="button" class="delivery-guide-run" data-action="delivery-run-phase" data-payload="${escapeAttr(phase.id)}" title="Run the ${runnable} detected command${runnable === 1 ? '' : 's'} in this column, in order. You confirm the exact list first." aria-label="Run the ${escapeAttr(phase.label)} column">▶ Run ${runnable}</button></div>` : ''}
              <div class="delivery-guide-steps" role="list">
                ${(phase.steps || []).map(step => {
                  const meta = deliveryGuideStatus(step.status);
                  return `
                    <div class="delivery-guide-step status-${escapeAttr(meta.tone)}" role="listitem">
                      <div class="delivery-guide-step-head">
                        <span class="delivery-guide-step-icon" aria-hidden="true">${meta.icon}</span>
                        <strong>${escapeHtml(step.label)}</strong>
                        <span class="tag ${meta.tone === 'critical' ? 'tag-critical' : meta.tone === 'good' ? 'tag-good' : meta.tone === 'warn' ? 'tag-warn' : ''}">${escapeHtml(meta.label)}</span>
                        ${step.status !== 'configured' ? renderAtlasDiscussAction(
                          'delivery-discuss-step',
                          step.id,
                          `Ask AtlasMind to resolve ${step.label}`,
                          { title: `Ask AtlasMind to inspect and resolve the non-green “${step.label}” runbook step` },
                        ) : ''}
                      </div>
                      <p>${escapeHtml(step.detail)}</p>
                      ${step.command ? `
                        <div class="delivery-guide-command-block">
                          <pre class="delivery-guide-command"><code>${escapeHtml(step.command)}</code></pre>
                          <div class="delivery-guide-command-actions">
                            <button type="button" class="code-icon-btn" data-action="delivery-copy-command" data-payload="${escapeAttr(step.id)}" title="Copy to clipboard" aria-label="Copy the ${escapeAttr(step.label)} command to the clipboard">⧉</button>
                            <button type="button" class="code-icon-btn" data-action="delivery-send-command" data-payload="${escapeAttr(step.id)}" title="Send to terminal — typed, not run. Press Enter yourself." aria-label="Send the ${escapeAttr(step.label)} command to the terminal">&gt;_</button>
                          </div>
                        </div>` : ''}
                      ${step.path ? `<button type="button" class="action-link delivery-guide-source" data-action="file" data-payload="${escapeAttr(step.path)}">Open ${escapeHtml(step.path)}</button>` : ''}
                    </div>`;
                }).join('')}
              </div>
            </details>
          `;
          }).join('')}
        </div>
      </article>`;
  }

  // ── Project Director page ──────────────────────────────────────
  function directorDeepLink(kind, handle) {
    const h = String(handle || '').trim();
    if (!h) { return ''; }
    if (kind === 'email') { return 'mailto:' + h; }
    if (kind === 'phone') { return 'tel:' + h; }
    if (kind === 'sms') { return 'sms:' + h; }
    if (kind === 'github') { return 'https://github.com/' + h.replace(/^@/, ''); }
    if (kind === 'linkedin') { return h.indexOf('http') === 0 ? h : 'https://www.linkedin.com/in/' + h.replace(/^@/, ''); }
    // Buzz: only deep-link when a full https workspace URL was pasted. An npub /
    // @handle / #channel is display-only (Buzz has no verified native URI scheme).
    if (kind === 'buzz') { return h.indexOf('http') === 0 ? h : ''; }
    return '';
  }
  function directorIsPiiLink(kind) { return kind === 'email' || kind === 'phone' || kind === 'sms'; }

  /**
   * Compare two Buzz keys the way the extension does. The client cannot decode
   * bech32, so it matches an `npub…` only as typed and a hex key
   * case-insensitively. A near-miss simply shows as unbound here; the extension
   * is what decides whether a key is valid, and it refuses rather than guesses.
   */
  /**
   * Does this handle even look like a Buzz *public key*?
   *
   * A Buzz handle is not always one. A channel UUID is a legitimate handle, and
   * so is a workspace URL — only an agent *identity* is an npub or 64-char hex.
   * Agent bindings are keyed by identity, so anything else simply has no binding
   * to make. Shape-only: the extension still decides validity (it verifies the
   * bech32 checksum), because a client that decided would have to guess.
   */
  function directorLooksLikeBuzzKey(handle) {
    const h = String(handle || '').trim();
    return /^npub1[0-9a-z]{20,}$/i.test(h) || /^[0-9a-f]{64}$/i.test(h);
  }

  function directorSameBuzzKey(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  }

  /** The agents currently bound to this contact's Buzz key. Empty when unbound. */
  function directorBoundAgentIds(kind, handle) {
    if (kind !== 'buzz' || !handle) { return []; }
    const dir = (state.snapshot && state.snapshot.director) || {};
    const match = (dir.agentBindings || []).find(b => directorSameBuzzKey(b.pubkey, handle));
    return match && Array.isArray(match.agentIds) ? match.agentIds.slice() : [];
  }

  /** How long ago, in words. "seen in 1 channel" alone identifies nobody. */
  function directorAgo(unixSeconds) {
    const seconds = Math.floor(Date.now() / 1000) - Number(unixSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 0) { return ''; }
    if (seconds < 90) { return 'just now'; }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) { return minutes + 'm ago'; }
    const hours = Math.round(minutes / 60);
    if (hours < 48) { return hours + 'h ago'; }
    return Math.round(hours / 24) + 'd ago';
  }

  /**
   * Show the agent binding row only for a buzz channel — on any other channel
   * there is no Buzz identity to bind, so the picker is not merely inert, it is
   * meaningless. Relies on the `[hidden] { display: none !important }` rule:
   * the row is a `.stage-edit-grid`, whose `display: grid` would otherwise
   * outrank the user agent's default styling for the attribute.
   */
  /**
   * Show the Buzz binding only while some channel on this person *is* Buzz.
   *
   * Scans every channel row rather than trusting the one that changed: a person
   * can have email, Slack, and Buzz, and the binding belongs to the person, not
   * to whichever row happens to be first.
   */
  function syncBuzzBindingVisibility() {
    const row = document.querySelector('[data-buzz-binding]');
    if (row instanceof HTMLElement) { row.hidden = !directorFirstBuzzHandleInput(); }
  }

  /** The handle input of the first Buzz channel row, or null when there is none. */
  function directorFirstBuzzHandleInput() {
    const container = document.getElementById('director-contact-editor');
    if (!container) { return null; }
    const rows = container.querySelectorAll('[data-link-row]');
    for (let i = 0; i < rows.length; i += 1) {
      const kind = rows[i].querySelector('[data-link-field="kind"]');
      if (kind instanceof HTMLSelectElement && kind.value === 'buzz') {
        const handle = rows[i].querySelector('[data-link-field="handle"]');
        return handle instanceof HTMLInputElement ? handle : null;
      }
    }
    return null;
  }

  /** Every channel row currently in the editor, in order. */
  function directorReadLinkRows() {
    const container = document.getElementById('director-contact-editor');
    if (!container) { return []; }
    const out = [];
    const rows = container.querySelectorAll('[data-link-row]');
    for (let i = 0; i < rows.length; i += 1) {
      const kindEl = rows[i].querySelector('[data-link-field="kind"]');
      const labelEl = rows[i].querySelector('[data-link-field="label"]');
      const handleEl = rows[i].querySelector('[data-link-field="handle"]');
      const kind = kindEl instanceof HTMLSelectElement ? kindEl.value : 'email';
      const handle = handleEl instanceof HTMLInputElement ? handleEl.value.trim() : '';
      const label = labelEl instanceof HTMLInputElement ? labelEl.value.trim() : '';
      if (handle) { out.push({ kind: kind, label: label, handle: handle }); }
    }
    return out;
  }

  var DIRECTOR_INTENT_LABEL = { email: 'Email', schedule: 'Schedule', message: 'Message' };

  function renderDirectorCompose(contact, intent) {
    const fields = intent === 'message'
      ? edArea('Message', 'body', '', 'Type your message…')
      : intent === 'schedule'
        ? edText('Title', 'subject', '', 'Project sync') + edText('When (ISO, e.g. 2026-08-01T15:00)', 'start', '', '') + edArea('Notes', 'body', '', '')
        : edText('Subject', 'subject', '', '') + edArea('Body', 'body', '', '');
    return `
      <article class="stage-card stage-editor" id="director-compose-editor">
        <div class="stage-head"><h4>${escapeHtml((DIRECTOR_INTENT_LABEL[intent] || intent) + ' — ' + contact.name)}</h4></div>
        <div class="stage-edit-grid">${fields}</div>
        <p class="list-meta">Sends via a connected MCP connector after you confirm the exact action in a dialog. AtlasMind cannot undo it.</p>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-comms-send" data-payload="${escapeAttr(contact.id + '::' + intent)}">Send</button>
          <button type="button" class="action-link" data-action="director-comms-cancel" data-payload="">Cancel</button>
        </div>
      </article>`;
  }

  function renderDirectorContactCard(cfg, snap, contact) {
    const isSelf = cfg.selfContactId === contact.id;
    const stk = cfg.stakeholders.find(s => s.contactId === contact.id);
    const team = cfg.teamMembers.find(t => t.contactId === contact.id);
    const badges = [];
    if (isSelf) { badges.push('<span class="tag" style="background:var(--vscode-badge-background)">you</span>'); }
    if (stk) { badges.push('<span class="tag">' + escapeHtml(stk.category) + ' · ' + escapeHtml(stk.influence) + '/' + escapeHtml(stk.interest) + '</span>'); }
    if (team) { badges.push('<span class="tag mono">' + escapeHtml(team.discipline) + '</span>'); }
    const buzzLink = (contact.links || []).find(l => l.kind === 'buzz');
    if (buzzLink) {
      // An identity can be bound to several agents; the first owns the work and
      // the rest are also-relevant, so the badge names the owner and counts the
      // remainder rather than pretending there is only ever one.
      const boundIds = directorBoundAgentIds('buzz', buzzLink.handle);
      if (boundIds.length > 0) {
        const owner = boundIds[0];
        const agent = (snap.agentChoices || []).find(a => a.id === owner);
        const extra = boundIds.length > 1 ? ' +' + (boundIds.length - 1) : '';
        badges.push('<span class="tag">buzz → ' + escapeHtml(agent ? agent.name : owner) + escapeHtml(extra) + '</span>');
      }
    }
    const linkButtons = contact.links.map(link => {
      const open = link.deepLink
        ? '<button type="button" class="action-link" data-action="director-open-link" data-payload="' + escapeAttr(contact.id + '::' + link.id) + '">Open ' + escapeHtml(link.kind) + '</button>'
        : '<span class="tag mono">' + escapeHtml(link.kind) + '</span>';
      return open;
    }).join(' ');
    // Guarded outbound: only when the project enabled it and a connector is connected.
    const intents = (snap.outboundEnabled && Array.isArray(snap.connectors) ? snap.connectors.map(c => c.intent) : [])
      .filter((v, i, a) => a.indexOf(v) === i);
    const reachRow = intents.length
      ? '<div class="tag-row">' + intents.map(intent =>
          '<button type="button" class="action-link" data-action="director-comms-open" data-payload="' + escapeAttr(contact.id + '::' + intent) + '">' + escapeHtml(DIRECTOR_INTENT_LABEL[intent] || intent) + '</button>').join(' ') + '</div>'
      : '';
    let composeForm = '';
    for (const intent of intents) {
      if (state.directorComposeKey === contact.id + '::' + intent) { composeForm = renderDirectorCompose(contact, intent); }
    }
    return `
      <article class="list-card">
        <div class="row-head">
          <h4>${escapeHtml(contact.name)}</h4>
          <div class="tag-row">${badges.join(' ')}</div>
        </div>
        ${contact.title || contact.org ? `<div class="list-meta">${escapeHtml([contact.title, contact.org].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="tag-row">${linkButtons || '<span class="list-meta">No contact channels yet.</span>'}</div>
        ${reachRow}
        ${composeForm}
        <div class="tag-row">
          ${contact.links.length ? '<button type="button" class="action-link" data-action="director-copy" data-payload="' + escapeAttr(contact.id) + '">Copy contact</button>' : ''}
          <button type="button" class="action-link" data-action="director-contact-edit" data-payload="${escapeAttr(contact.id)}">Edit</button>
          ${state.directorConfirmRemoveContactId === contact.id
            ? `<span class="stage-remove-confirm">Remove? <button type="button" class="action-link danger" data-action="director-contact-remove-confirm" data-payload="${escapeAttr(contact.id)}">Yes</button> <button type="button" class="action-link" data-action="director-contact-remove-cancel" data-payload="">No</button></span>`
            : `<button type="button" class="action-link danger" data-action="director-contact-remove" data-payload="${escapeAttr(contact.id)}">Remove</button>`}
        </div>
      </article>`;
  }

  /**
   * A picker of Buzz identities AtlasMind has actually seen, plus your own.
   *
   * Every option is evidence: each key arrived on the wire and each name was
   * published by its owner. Nothing here derives a key from a person's name —
   * that would produce a plausible key belonging to someone else. An identity
   * with no published name shows as a key prefix rather than a made-up label.
   * Choosing an option fills the Handle field; typing one by hand still works.
   */
  /**
   * A label that can actually be chosen between.
   *
   * `dcbe44bf896f… (no published name) · seen in 1 channel` three times over is
   * a list nobody can pick from knowingly, which defeats the point of offering
   * observed identities at all. Most Buzz identities publish no profile, so the
   * evidence has to come from behaviour instead: what they last said, how much
   * they have said, and when. All of it is already sanitized on the way in.
   */
  function directorIdentityLabel(identity) {
    const bits = [];
    bits.push(identity.named ? identity.label : identity.label + ' (no published name)');
    if (identity.lastMessage) { bits.push('“' + identity.lastMessage + '”'); }
    else if (identity.about) { bits.push(identity.about); }
    const counts = [];
    if (identity.messageCount) {
      counts.push(identity.messageCount + ' msg' + (identity.messageCount === 1 ? '' : 's'));
    }
    if (identity.channelIds && identity.channelIds.length) {
      counts.push(identity.channelIds.length + ' channel' + (identity.channelIds.length === 1 ? '' : 's'));
    }
    const ago = directorAgo(identity.lastSeenAt);
    if (ago) { counts.push(ago); }
    if (counts.length) { bits.push(counts.join(', ')); }
    return bits.join(' · ');
  }

  function renderBuzzIdentityPicker(dir, contact, buzzHandle) {
    // A handle that is not an identity key has no binding to make. Say so
    // plainly here rather than letting the save warn about a failure.
    if (buzzHandle && !directorLooksLikeBuzzKey(buzzHandle)) {
      return `<label class="stage-edit-field"><span>Buzz identity</span>
        <span class="list-meta">This handle is not a public key, so there is no identity to bind an agent to. That is fine — a channel UUID or workspace URL is a perfectly good Buzz handle. To route their work to an agent, use their <code>npub…</code> or 64-character hex key instead.</span></label>`;
    }
    const options = [];
    if (dir.ownBuzzPubkey) {
      options.push({ value: dir.ownBuzzPubkey, label: 'You (your Buzz agent key)' });
    }
    for (const identity of dir.buzzIdentities || []) {
      if (identity.pubkey === dir.ownBuzzPubkey) { continue; }
      options.push({ value: identity.pubkey, label: directorIdentityLabel(identity) });
    }
    if (options.length === 0) {
      return `<label class="stage-edit-field"><span>Buzz identity</span>
        <span class="list-meta">No Buzz identities observed yet. Switch on inbound in Settings → Buzz and they will appear here once they post — until then, paste their <code>npub…</code> or hex key into the Buzz channel's Handle above.</span></label>`;
    }
    const selected = options.some(o => directorSameBuzzKey(o.value, buzzHandle)) ? buzzHandle : '';
    return edSelect('Buzz identity (fills the Buzz handle)', 'buzzIdentityPick', selected,
      [{ value: '', label: options.length === 1 ? 'Pick or type below…' : 'Pick an observed identity…' }].concat(options))
      + '<p class="list-meta">Each option shows what that identity last said, how much it has said, and when — because most Buzz identities publish no name, and a truncated key on its own identifies nobody.</p>';
  }

  /**
   * The AtlasMind agents that own this identity's work, as a checklist.
   *
   * A list rather than one choice: a colleague who raises both API defects and
   * design feedback belongs to two specialists, and making the user pick one
   * throws away something they know. The **first ticked** owns the work — a
   * follow-up has exactly one owner — and the order is the order shown.
   */
  function renderBuzzAgentChecklist(dir, boundIds) {
    const choices = dir.agentChoices || [];
    if (!choices.length) {
      return '<div class="stage-edit-field"><span>AtlasMind agents for their Buzz messages</span><span class="list-meta">No agents registered yet.</span></div>';
    }
    const chosen = choices.filter(a => boundIds.indexOf(a.id) >= 0);
    const summary = chosen.length === 0
      ? 'Unassigned'
      : chosen.length === 1
        ? chosen[0].name
        : chosen[0].name + ' + ' + (chosen.length - 1) + ' more';
    const rows = choices.map(a => `<label class="stage-edit-check">
        <input type="checkbox" data-field="buzzAgentIds" value="${escapeAttr(a.id)}" ${boundIds.indexOf(a.id) >= 0 ? 'checked' : ''} />
        <span>${escapeHtml(a.name)}</span>
      </label>`).join('');
    return `<div class="stage-edit-field">
      <span>AtlasMind agents for their Buzz messages</span>
      <details class="director-agent-picker">
        <summary data-buzz-agent-summary>${escapeHtml(summary)}</summary>
        <div class="director-agent-options">${rows}</div>
      </details>
    </div>`;
  }

  /** One communication channel row. A person may need several. */
  function renderContactLinkRow(link, kinds, isFirst) {
    const kind = (link && link.kind) || 'email';
    return `<div class="stage-edit-grid director-link-row" data-link-row>
      <label class="stage-edit-field"><span>Channel</span>
        <select data-link-field="kind">${kinds.map(k =>
          `<option value="${escapeAttr(k.value)}" ${k.value === kind ? 'selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}</select></label>
      <label class="stage-edit-field"><span>Label</span>
        <input type="text" data-link-field="label" value="${escapeAttr((link && link.label) || '')}" placeholder="Work email" /></label>
      <label class="stage-edit-field"><span>Handle (address / @user / phone)</span>
        <input type="text" data-link-field="handle" value="${escapeAttr((link && link.handle) || '')}" placeholder="jane@example.com" /></label>
      <div class="stage-edit-field"><span>&nbsp;</span>
        <button type="button" class="action-link${isFirst ? '' : ' danger'}" data-action="director-link-remove" data-payload="">${isFirst ? 'Preferred' : 'Remove'}</button></div>
    </div>`;
  }

  function renderDirectorContactEditor(cfg, contact, isNew) {
    const kinds = DIRECTOR_LINK_KINDS;
    const cats = ['sponsor', 'client', 'user-representative', 'regulator', 'vendor', 'partner', 'internal', 'other'].map(k => ({ value: k, label: k }));
    const levels = ['high', 'medium', 'low'].map(k => ({ value: k, label: k }));
    // A person is rarely reachable one way only — email *and* Slack *and* Buzz
    // is the normal case, and the roster stored a list all along; only the
    // editor insisted on one. The first row is the preferred channel.
    const existingLinks = (contact.links && contact.links.length ? contact.links : [{ kind: 'email', label: '', handle: '' }]);
    const stk = cfg.stakeholders.find(s => s.contactId === contact.id);
    const team = cfg.teamMembers.find(t => t.contactId === contact.id);
    const dir = (state.snapshot && state.snapshot.director) || {};
    const buzzLink = existingLinks.find(l => l.kind === 'buzz');
    const buzzHandle = buzzLink ? buzzLink.handle : '';
    const boundAgentIds = directorBoundAgentIds('buzz', buzzHandle);
    return `
      <article class="stage-card stage-editor" id="director-contact-editor">
        <div class="stage-head"><h4>${isNew ? 'Add person' : 'Edit person'}</h4></div>
        <div class="stage-edit-grid">
          ${edText('Name', 'name', contact.name, 'Jane Doe')}
          ${edText('Title / role', 'title', contact.title, 'VP Product')}
          ${edText('Organisation', 'org', contact.org, '')}
        </div>
        <div id="director-link-rows">
          ${existingLinks.map((link, index) => renderContactLinkRow(link, kinds, index === 0)).join('')}
        </div>
        <div class="tag-row">
          <button type="button" class="action-link" data-action="director-link-add" data-payload="">＋ Add another channel</button>
          <span class="list-meta">The first channel is the preferred one. Add Buzz alongside email or Slack — the same person, reachable more than one way.</span>
        </div>
        <div class="stage-edit-grid director-buzz-binding" data-buzz-binding ${buzzLink ? '' : 'hidden'}>
          ${renderBuzzIdentityPicker(dir, contact, buzzHandle)}
          ${renderBuzzAgentChecklist(dir, boundAgentIds)}
          <p class="list-meta">Work arriving from this Buzz identity is routed to the agents you tick; the first owns it, since a follow-up has one owner. Tick nothing and inbound work stays unattributed rather than being guessed.${dir.buzzEnabled === false ? ' <strong>Buzz is off</strong> — the binding saves but stays inert until you enable it in Settings → Buzz.' : ''}</p>
        </div>
        <div class="stage-edit-checks">
          ${edCheck('This is me', 'isSelf', cfg.selfContactId === contact.id)}
          ${edCheck('Stakeholder', 'asStakeholder', !!stk)}
          ${edCheck('Team member', 'asTeam', !!team)}
        </div>
        <div class="stage-edit-grid">
          ${edSelect('Stakeholder category', 'stkCategory', stk ? stk.category : 'internal', cats)}
          ${edSelect('Influence', 'stkInfluence', stk ? stk.influence : 'medium', levels)}
          ${edSelect('Interest', 'stkInterest', stk ? stk.interest : 'medium', levels)}
          ${edText('Team discipline', 'teamDiscipline', team ? team.discipline : '', 'backend-engineer')}
        </div>
        <p class="list-meta">Storing an email or phone number is personal data — you'll be asked to acknowledge the GDPR implications the first time.</p>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-contact-save" data-payload="${escapeAttr(isNew ? 'new' : contact.id)}">Save</button>
          <button type="button" class="action-link" data-action="director-contact-cancel" data-payload="">Cancel</button>
        </div>
      </article>`;
  }

  /**
   * Assignable roles, and the two things assigning one actually does.
   *
   * The card leads with what a role is *not*, because the obvious reading of
   * "roles and restrictions" is a permission system, and AtlasMind cannot be
   * one — it runs inside each person's editor. Saying so here is cheaper than
   * somebody discovering it later.
   */
  function renderTeamRoles(snapshot) {
    const d = snapshot.director || {};
    const roles = d.roles || [];
    const codeowners = d.codeowners || { ruleCount: 0, warnings: [] };
    if (roles.length === 0) { return ''; }

    const cap = (role, key, label) =>
      role.capabilities && role.capabilities[key]
        ? `<span class="tag tag-good">${escapeHtml(label)}</span>`
        : '';

    return `
      <article class="panel-card">
        <p class="card-kicker">Team roles</p>
        <p class="stat-detail">A role sets the workflow envelope for everyone who opens this repository, and records who is expected to do what. It is <strong>not</strong> a permission boundary — AtlasMind runs in each person's editor and cannot enforce one. Where restriction genuinely bites is CODEOWNERS, because GitHub enforces that.</p>
        <div class="stack-list">
          ${roles.map(role => `
            <div class="recent-item">
              <div class="row-head">
                <strong>${escapeHtml(role.label)}</strong>
                <span class="tag">${escapeHtml(role.ceiling)}</span>
              </div>
              <div class="stat-detail">${escapeHtml(role.blurb)}</div>
              <div class="tag-row">
                ${cap(role, 'issueWrites', 'issues')}
                ${cap(role, 'pullRequestWrites', 'pull requests')}
                ${cap(role, 'releaseWrites', 'releases')}
                ${cap(role, 'protectedRefWrites', 'protected branches')}
                <button type="button" class="action-link" data-action="apply-team-role" data-payload="${escapeAttr(role.id)}">Apply to this workspace</button>
              </div>
            </div>`).join('')}
        </div>
        <p class="stat-detail">Applying a role never turns the workflow on — that stays each person's own decision — and anyone can still set themselves more restrictive than their role.</p>
        <div class="row-head">
          <span>CODEOWNERS</span>
          <span class="tag ${codeowners.ruleCount > 0 ? 'tag-good' : 'tag-warn'}">${codeowners.ruleCount} rule${codeowners.ruleCount === 1 ? '' : 's'}</span>
        </div>
        <p class="stat-detail">${codeowners.ruleCount > 0
          ? 'Generated from responsibilities that have both a path pattern and an owner with a GitHub handle. Only AtlasMind\'s managed block is written — your own entries are left alone.'
          : 'Nothing to write yet. A responsibility needs a path pattern, and its owner needs a GitHub link on their contact.'}</p>
        ${(codeowners.warnings || []).length
          ? `<ul class="stat-detail wf-unknown">${codeowners.warnings.slice(0, 5).map(warning =>
            `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
          : ''}
        <button type="button" class="action-link" data-action="generate-codeowners">Write CODEOWNERS</button>
      </article>`;
  }

  function renderDirectorResponsibilities(cfg) {
    const contactOptions = cfg.contacts.map(c => ({ value: c.id, label: c.name }));
    const rows = cfg.responsibilities.map(r => `
      <div class="history-row">
        <div><strong>${escapeHtml(r.area)}</strong>${r.description ? ' — ' + escapeHtml(r.description) : ''}</div>
        <div class="list-meta">Owner: ${escapeHtml(directorNameOf(cfg, r.ownerContactId))}${r.backupContactId ? ' · Backup: ' + escapeHtml(directorNameOf(cfg, r.backupContactId)) : ''}
          <button type="button" class="action-link danger" data-action="director-resp-remove" data-payload="${escapeAttr(r.id)}">Remove</button></div>
      </div>`).join('');
    const editor = state.directorNewResponsibility ? `
      <article class="stage-card stage-editor" id="director-resp-editor">
        <div class="stage-edit-grid">
          ${edText('Area / scope', 'area', '', 'Payments, Release sign-off')}
          ${edText('Description', 'description', '', '')}
          ${edSelect('Owner', 'ownerContactId', cfg.selfContactId || (contactOptions[0] && contactOptions[0].value) || '', contactOptions)}
          ${edSelect('Backup (optional)', 'backupContactId', '', [{ value: '', label: '—' }].concat(contactOptions))}
        </div>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-resp-save" data-payload="">Save</button>
          <button type="button" class="action-link" data-action="director-resp-cancel" data-payload="">Cancel</button>
        </div>
      </article>` : `<div class="tag-row"><button type="button" class="action-link" data-action="director-resp-add" data-payload="">＋ Add responsibility</button></div>`;
    return `
      <article class="list-card">
        <p class="section-kicker">Ownership</p>
        <h3>Responsibilities — who owns what</h3>
        <div class="stack-list">${rows || '<div class="dashboard-empty">No responsibilities recorded yet.</div>'}</div>
        ${editor}
      </article>`;
  }

  function renderDirectorAssignments(cfg, snap) {
    const contactOptions = cfg.contacts.map(c => ({ value: c.id, label: c.name }));
    const statuses = ['todo', 'in-progress', 'blocked', 'done', 'cancelled'];
    const targets = ((state.snapshot && state.snapshot.workAssignments) || { targets: [] }).targets || [];
    const activeTargetKeys = new Set(targets.map(target => target.kind + '\u0000' + target.stableId));
    const standalone = cfg.assignments.filter(a =>
      (!a.linkedWork && (a.source !== 'run' || !a.linkedRunId))
      || (a.linkedWork && !activeTargetKeys.has(a.linkedWork.kind + '\u0000' + a.linkedWork.id)));
    const rows = standalone.map(a => {
      const assigneeText = `Assignee: ${escapeHtml(a.assigneeContactId ? directorNameOf(cfg, a.assigneeContactId) : '—')}`;
      const linkedControl = a.linkedWork
        ? renderDirectorOwnerControl(a.linkedWork.kind, a.linkedWork.id) || assigneeText
        : assigneeText;
      return `
        <div class="history-row" data-dashboard-focus-kind="assignment" data-dashboard-focus-id="${escapeAttr(a.id)}">
          <div><strong>${escapeHtml(a.title)}</strong> <span class="tag">${escapeHtml(a.priority)}</span>${a.linkedWork ? ` <span class="tag">${escapeHtml(a.linkedWork.kind)}</span>` : ''}</div>
          <div class="list-meta">
            ${linkedControl}${a.due ? ' · Due ' + escapeHtml(a.due) : ''}
            <button type="button" class="action-link" data-action="director-assignment-cycle" data-payload="${escapeAttr(a.id)}">${escapeHtml(a.status)} ↻</button>
            <button type="button" class="action-link danger" data-action="director-assignment-remove" data-payload="${escapeAttr(a.id)}">Remove</button>
          </div>
        </div>`;
    }).join('');
    const dashboardRows = targets.map(target => `
      <div class="history-row">
        <div><strong>${escapeHtml(target.title)}</strong> <span class="tag">${escapeHtml(target.kind)}</span> <span class="tag">${escapeHtml(target.priority)}</span></div>
        <div class="list-meta">${renderDirectorOwnerControl(target.kind, target.stableId)} <button type="button" class="action-link" data-action="dashboard-focus" data-page="${escapeAttr(target.page)}" data-focus-kind="${escapeAttr(target.kind)}" data-focus-id="${escapeAttr(target.stableId)}">Open work</button></div>
      </div>`).join('');
    const editor = state.directorNewAssignment ? `
      <article class="stage-card stage-editor" id="director-assignment-editor">
        <div class="stage-edit-grid">
          ${edText('Title', 'title', '', 'Draft the release notes')}
          ${edSelect('Assignee', 'assigneeContactId', cfg.selfContactId || '', [{ value: '', label: '—' }].concat(contactOptions))}
          ${edSelect('Status', 'status', 'todo', statuses.map(s => ({ value: s, label: s })))}
          ${edSelect('Priority', 'priority', 'medium', ['high', 'medium', 'low'].map(s => ({ value: s, label: s })))}
          ${edText('Due (YYYY-MM-DD)', 'due', '', '')}
        </div>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-assignment-save" data-payload="">Save</button>
          <button type="button" class="action-link" data-action="director-assignment-cancel" data-payload="">Cancel</button>
        </div>
      </article>` : `<div class="tag-row"><button type="button" class="action-link" data-action="director-assignment-add" data-payload="">＋ Add assignment</button></div>`;
    return `
      <article class="list-card">
        <p class="section-kicker">Work</p>
        <h3>Assignments</h3>
        <div class="stack-list">${rows || '<div class="dashboard-empty">No standalone or inactive assignments.</div>'}</div>
        ${editor}
        <p class="section-kicker" style="margin-top:12px">Active dashboard work</p>
        <div class="list-meta">Assign people here or beside the same work on its dashboard page. Both controls update this one Director record.</div>
        <div class="stack-list">${dashboardRows || '<div class="dashboard-empty">No active dashboard work is available to assign.</div>'}</div>
        ${renderDirectorRuns(cfg, snap)}
      </article>`;
  }

  function renderDirectorRuns(cfg, snap) {
    if (!snap.runs || snap.runs.length === 0) { return ''; }
    const contactOptions = [{ value: '', label: '— unassigned —' }].concat(cfg.contacts.map(c => ({ value: c.id, label: c.name })));
    const rows = snap.runs.map(run => {
      const owner = cfg.assignments.find(a => a.linkedRunId === run.id);
      const selected = owner ? owner.assigneeContactId || '' : '';
      const opts = contactOptions.map(o => '<option value="' + escapeAttr(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>').join('');
      return `
        <div class="history-row">
          <div><button type="button" class="action-link" data-action="run" data-payload="${escapeAttr(run.id)}">${escapeHtml(run.title)}</button> <span class="tag">${escapeHtml(run.status)}</span></div>
          <div class="list-meta">${escapeHtml(run.relative)} · Owner:
            <select data-action="director-assign-run" data-run="${escapeAttr(run.id)}">${opts}</select>
          </div>
        </div>`;
    }).join('');
    return `
      <p class="section-kicker" style="margin-top:12px">Autonomous runs</p>
      <div class="stack-list">${rows}</div>`;
  }

  function renderDirectorFollowUps(cfg, snap) {
    const contactOptions = cfg.contacts.map(c => ({ value: c.id, label: c.name }));
    const urgency = snap.followUpUrgency || {};
    const active = cfg.followUps.filter(f => f.status !== 'done' && f.status !== 'cancelled');
    const groupOf = (key, heading, tone) => {
      const items = active.filter(f => urgency[f.id] === key);
      if (items.length === 0) { return ''; }
      const rows = items.map(f => `
        <div class="signal-card ${tone} static" style="text-align:left" data-dashboard-focus-kind="follow-up" data-dashboard-focus-id="${escapeAttr(f.id)}">
          <div class="checkline">${escapeHtml(f.title)}</div>
          <div class="signal-detail">Due ${escapeHtml(f.dueDate)}${f.withContactId ? ' · with ' + escapeHtml(directorNameOf(cfg, f.withContactId)) : ''}${f.status === 'snoozed' ? ' · snoozed' : ''}</div>
          <div class="tag-row">
            <button type="button" class="action-link" data-action="director-followup-complete" data-payload="${escapeAttr(f.id)}">Done</button>
            <button type="button" class="action-link" data-action="director-followup-snooze" data-payload="${escapeAttr(f.id)}">Snooze 7d</button>
            <button type="button" class="action-link danger" data-action="director-followup-cancel-item" data-payload="${escapeAttr(f.id)}">Cancel</button>
          </div>
        </div>`).join('');
      return '<p class="section-kicker">' + escapeHtml(heading) + '</p><div class="signal-grid">' + rows + '</div>';
    };
    const editor = state.directorNewFollowUp ? `
      <article class="stage-card stage-editor" id="director-followup-editor">
        <div class="stage-edit-grid">
          ${edText('What needs following up', 'title', '', 'Check in with the sponsor')}
          ${edText('Due (YYYY-MM-DD)', 'dueDate', directorTodayKey(), '')}
          ${edSelect('With (optional)', 'withContactId', '', [{ value: '', label: '—' }].concat(contactOptions))}
          ${edSelect('Repeat', 'cadence', 'once', ['once', 'daily', 'weekly', 'biweekly', 'monthly'].map(s => ({ value: s, label: s })))}
        </div>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-followup-save" data-payload="">Save</button>
          <button type="button" class="action-link" data-action="director-followup-cancel" data-payload="">Cancel</button>
        </div>
      </article>` : `<div class="tag-row"><button type="button" class="action-link" data-action="director-followup-add" data-payload="">＋ Add follow-up</button></div>`;
    const groups = groupOf('overdue', 'Overdue', 'warn') + groupOf('due-soon', 'Due soon', '') + groupOf('upcoming', 'Upcoming', 'good');
    return `
      <article class="list-card">
        <p class="section-kicker">Cadence</p>
        <h3>Follow-ups</h3>
        ${groups || '<div class="dashboard-empty">No open follow-ups. Add one to stay on top of check-ins and deadlines.</div>'}
        ${editor}
      </article>`;
  }

  // The stakeholder influence/interest grid — the standard project-management
  // view of who must be managed closely versus merely kept informed.
  //
  // It reuses the Risk page's matrix chrome (.risk-matrix / .risk-cell) rather
  // than inventing a second grid component. The data model was designed for
  // this: src/types.ts calls DirectorLevel "the scale used for the stakeholder
  // influence/interest grid", but it was only ever rendered as a text tag on
  // each contact card.
  const DIRECTOR_LEVELS = ['low', 'medium', 'high'];
  const STAKEHOLDER_STRATEGY = {
    'high:high': 'Manage closely',
    'high:medium': 'Keep satisfied',
    'high:low': 'Keep satisfied',
    'medium:high': 'Keep informed',
    'medium:medium': 'Monitor',
    'medium:low': 'Monitor',
    'low:high': 'Keep informed',
    'low:medium': 'Monitor',
    'low:low': 'Monitor',
  };

  function renderStakeholderGrid(cfg) {
    const stakeholders = Array.isArray(cfg.stakeholders) ? cfg.stakeholders : [];
    if (stakeholders.length === 0) {
      return '';
    }
    const nameOf = (contactId) => {
      const contact = (cfg.contacts || []).find(c => c.id === contactId);
      return contact ? contact.name : 'Unnamed';
    };
    // Bucket by `interest:influence`; anything outside the known scale is
    // counted as 'low' rather than silently dropped.
    const level = (value) => (DIRECTOR_LEVELS.indexOf(value) === -1 ? 'low' : value);
    const buckets = {};
    stakeholders.forEach(stakeholder => {
      const key = `${level(stakeholder.interest)}:${level(stakeholder.influence)}`;
      (buckets[key] = buckets[key] || []).push(nameOf(stakeholder.contactId));
    });

    const rows = [...DIRECTOR_LEVELS].reverse().map(influence => {
      const cells = DIRECTOR_LEVELS.map(interest => {
        const key = `${interest}:${influence}`;
        const names = buckets[key] || [];
        const weight = (DIRECTOR_LEVELS.indexOf(interest) + 1) * (DIRECTOR_LEVELS.indexOf(influence) + 1);
        const band = weight >= 6 ? 'severe' : weight >= 4 ? 'high' : weight >= 2 ? 'moderate' : 'low';
        const strategy = STAKEHOLDER_STRATEGY[`${influence}:${interest}`] || 'Monitor';
        const label = names.length === 0
          ? `No stakeholders with ${influence} influence and ${interest} interest`
          : `${strategy}: ${names.join(', ')} — ${influence} influence, ${interest} interest`;
        if (names.length === 0) {
          return `<div class="risk-cell risk-cell--${band} is-empty" role="gridcell" aria-label="${escapeAttr(label)}"><span class="risk-cell-count">·</span></div>`;
        }
        return `<div class="risk-cell risk-cell--${band}" role="gridcell" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"><span class="risk-cell-count">${names.length}</span></div>`;
      }).join('');
      return `<div class="risk-matrix-row"><span class="risk-axis-label">${escapeHtml(influence)}</span>${cells}</div>`;
    }).join('');

    return `
      <article class="panel-card">
        <p class="section-kicker">Stakeholders</p>
        <h3>Influence / interest grid</h3>
        <p class="section-copy">Where each stakeholder sits determines how much of your attention they need. Top-right is manage-closely; bottom-left is monitor.</p>
        <div class="risk-matrix" role="grid" aria-label="Stakeholder grid: influence by interest">
          ${rows}
          <div class="risk-matrix-row risk-matrix-foot">
            <span class="risk-axis-label"></span>
            ${DIRECTOR_LEVELS.map(l => `<span class="risk-axis-label">${escapeHtml(l)}</span>`).join('')}
          </div>
        </div>
        <div class="risk-axis-caption"><span>Influence ↑</span><span>Interest →</span></div>
      </article>
    `;
  }

  function renderDirector(snapshot) {
    const d = snapshot.director;
    const wrap = (inner) => pageSectionOpen('director') + inner + '</section>';
    if (!d) { return wrap('<div class="dashboard-empty">Director data unavailable.</div>'); }
    const cfg = d.config || emptyDirectorConfig();
    const solo = d.teamMode === 'solo';

    const intro = renderPageIntro({
      kicker: 'People',
      title: 'Project Director',
      summary: solo
        ? 'Your cockpit for a team of one: track the areas you own, your assignments, and your follow-ups. Add teammates or external stakeholders any time.'
        : 'The people around this project — stakeholders, delivery team, who owns what, and the follow-ups that keep delivery on track.',
      chips: [
        { label: solo ? 'Solo' : 'Team', tone: 'accent' },
        d.overdueCount > 0 ? { label: d.overdueCount + ' overdue', tone: 'warn' } : { label: 'No overdue follow-ups', tone: 'good' },
      ],
    });

    const gdprBanner = (d.storesRawPii && !d.piiAcknowledged) ? `
      <article class="panel-card" style="border-color:var(--vscode-inputValidation-warningBorder,#c90)">
        <p class="section-kicker">Personal data</p>
        <h3>This roster holds personal data (GDPR)</h3>
        <p class="section-copy">Names and contact details are personal data. AtlasMind will classify them as confidential so they never reach an un-trusted model. Prefer referencing people in Microsoft 365 / Slack over storing raw details. Acknowledge to persist the roster to disk.</p>
        <div class="tag-row">
          <button type="button" class="action-link primary" data-action="director-store-pii" data-payload="">Acknowledge &amp; store</button>
          <button type="button" class="action-link" data-action="page" data-payload="privacy">Open Privacy page</button>
        </div>
      </article>` : '';

    const modeButtons = ['auto', 'solo', 'team'].map(m =>
      '<button type="button" data-action="director-mode" data-payload="' + m + '" class="' + (cfg.settings.teamMode === m ? 'active' : '') + '">' + m + '</button>').join('');
    const seedControl = state.directorSeedConfirm
      ? '<span class="stage-remove-confirm">Re-seed replaces the roster from repo signals. <button type="button" class="action-link danger" data-action="director-seed-confirm" data-payload="">Re-seed</button> <button type="button" class="action-link" data-action="director-seed-cancel" data-payload="">Cancel</button></span>'
      : '<button type="button" class="action-link" data-action="director-seed" data-payload="">Seed from repo</button>';

    const setupCard = `
      <article class="panel-card">
        <p class="section-kicker">Setup</p>
        <h3>${escapeHtml(cfg.project.name || snapshot.workspaceName)}</h3>
        ${cfg.project.summary ? '<p class="section-copy">' + escapeHtml(cfg.project.summary) + '</p>' : ''}
        <div class="mini-grid">
          ${renderMetricPill('People', String(cfg.contacts.length))}
          ${renderMetricPill('Stakeholders', String(cfg.stakeholders.length))}
          ${renderMetricPill('Team', String(cfg.teamMembers.length))}
          ${renderMetricPill('Open follow-ups', String(cfg.followUps.filter(f => f.status !== 'done' && f.status !== 'cancelled').length), { tone: d.overdueCount > 0 ? 'warn' : 'good' })}
        </div>
        <div class="segmented" role="group" aria-label="Team mode" style="margin-top:8px">${modeButtons}</div>
        <div class="tag-row">${seedControl}<button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(d.summaryPath)}">Open project-director.md</button></div>
        <div class="tag-row" style="margin-top:8px">
          <button type="button" class="action-link ${cfg.settings.remindersEnabled ? 'primary' : ''}" data-action="director-reminders-toggle" data-payload="">Reminders: ${cfg.settings.remindersEnabled ? 'On' : 'Off'}</button>
          <button type="button" class="action-link ${cfg.settings.nudgeOnActivation === false ? '' : 'primary'}" data-action="director-nudge-toggle" data-payload="">Startup nudge: ${cfg.settings.nudgeOnActivation === false ? 'Off' : 'On'}</button>
        </div>
        <div class="tag-row" style="margin-top:8px">
          <button type="button" class="action-link ${d.outboundEnabled ? 'primary' : ''}" data-action="director-outbound-toggle" data-payload="">Outbound messaging: ${d.outboundEnabled ? 'On' : 'Off'}</button>
          <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openMcpServers">Manage MCP servers</button>
        </div>
        <div class="tag-row">${(d.connectors && d.connectors.length)
          ? d.connectors.map(c => '<span class="tag">' + escapeHtml((DIRECTOR_INTENT_LABEL[c.intent] || c.intent) + ' via ' + c.serverName) + '</span>').join(' ')
          : '<span class="list-meta">No messaging connectors connected — Open/Copy deep-links are used instead.</span>'}</div>
      </article>`;

    const editingContact = state.directorEditContactId;
    let contactEditor = '';
    if (editingContact === 'new') {
      contactEditor = renderDirectorContactEditor(cfg, { id: '', name: '', links: [] }, true);
    } else if (editingContact) {
      const c = cfg.contacts.find(x => x.id === editingContact);
      if (c) { contactEditor = renderDirectorContactEditor(cfg, c, false); }
    }
    const contactCards = cfg.contacts.length
      ? cfg.contacts.map(c => renderDirectorContactCard(cfg, d, c)).join('')
      : '<div class="dashboard-empty">No people yet. Seed from repo or add someone.</div>';
    // Unusable bindings are reported, never dropped — a typo that silently did
    // nothing would look identical to a binding that works.
    const bindingIssues = (d.agentBindingIssues || []).length
      ? `<div class="dashboard-empty">${(d.agentBindingIssues || []).map(i =>
          'Buzz agent binding ignored — <code>' + escapeHtml(i.input) + '</code>: ' + escapeHtml(i.reason)).join('<br>')}</div>`
      : '';
    const rosterCard = `
      <article class="list-card" style="grid-column: 1 / -1">
        <div class="row-head"><h3>${solo ? 'You & external stakeholders' : 'People'}</h3>
          <button type="button" class="action-link" data-action="director-contact-add" data-payload="">＋ Add person</button></div>
        ${bindingIssues}
        ${contactEditor}
        <div class="director-roster">${contactCards}</div>
      </article>`;

    // People-shape at a glance, before the rosters and lists below.
    const assignments = Array.isArray(cfg.assignments) ? cfg.assignments : [];
    const followUps = Array.isArray(cfg.followUps) ? cfg.followUps : [];
    const urgency = d.followUpUrgency || {};
    const urgencyCount = (kind) => followUps.filter(f => urgency[f.id] === kind).length;

    const shapeCard = (assignments.length > 0 || followUps.length > 0) ? `
      <article class="panel-card">
        <p class="section-kicker">At a glance</p>
        <h3>Where the people work stands</h3>
        ${renderDistributionBar('director-assignments', [
          { label: 'Done', value: assignments.filter(a => a.status === 'done').length, tone: 'good' },
          { label: 'In progress', value: assignments.filter(a => a.status === 'in-progress').length, tone: 'accent' },
          { label: 'To do', value: assignments.filter(a => a.status === 'todo').length, tone: 'muted' },
          { label: 'Blocked', value: assignments.filter(a => a.status === 'blocked').length, tone: 'critical' },
          { label: 'Cancelled', value: assignments.filter(a => a.status === 'cancelled').length, tone: 'muted' },
        ], {
          title: 'Assignments',
          caption: `${assignments.length} tracked`,
          emptyLabel: 'No assignments recorded yet.',
        })}
        ${renderDistributionBar('director-followups', [
          { label: 'Overdue', value: urgencyCount('overdue'), tone: 'critical' },
          { label: 'Due soon', value: urgencyCount('due-soon'), tone: 'warn' },
          { label: 'Upcoming', value: urgencyCount('upcoming'), tone: 'good' },
        ], {
          title: 'Follow-up urgency',
          caption: `${followUps.length} open`,
          emptyLabel: 'No open follow-ups.',
        })}
      </article>` : '';

    return wrap(`
      ${intro}
      ${gdprBanner}
      <div class="delivery-grid">
        ${setupCard}
      </div>
      ${shapeCard || renderStakeholderGrid(cfg) ? `
        <div class="panel-grid">
          ${shapeCard}
          ${renderStakeholderGrid(cfg)}
        </div>` : ''}
      <div class="review-grid">
        ${rosterCard}
      </div>
      <div class="review-grid">
        ${renderTeamRoles(snapshot)}
        ${renderDirectorResponsibilities(cfg)}
        ${renderDirectorAssignments(cfg, d)}
      </div>
      <div class="review-grid">
        ${renderDirectorFollowUps(cfg, d)}
      </div>
    `);
  }

  function renderStatCard(stat) {
    const actionAttr = stat.command
      ? `data-action="command" data-payload="${escapeAttr(stat.command)}"`
      : stat.pageTarget
        ? `data-action="page" data-payload="${escapeAttr(stat.pageTarget)}"`
        : '';
    const inner = `
        <div>
          <p class="card-kicker">${escapeHtml(stat.label)}</p>
          <div class="stat-value">${escapeHtml(stat.value)}</div>
        </div>
        <div class="stat-detail">${escapeHtml(stat.detail)}</div>`;
    const cls = `stat-card tone-${escapeAttr(stat.tone || 'neutral')}`;
    return actionAttr
      ? `<button type="button" class="${cls} is-actionable" ${actionAttr}>${inner}</button>`
      : `<div class="${cls} static">${inner}</div>`;
  }

  // Friendly names for the commands a recommendation can dispatch, so a card can
  // say where it actually goes. Without this the only honest wording is the
  // opaque command id.
  const COMMAND_DESTINATIONS = {
    'atlasmind.openChatView': 'Chat',
    'atlasmind.openChatPanel': 'Chat',
    'atlasmind.openProjectIdeation': 'Ideation',
    'atlasmind.openProjectRunCenter': 'Run Center',
    'atlasmind.openModelProviders': 'Model Providers',
    'atlasmind.openCostDashboard': 'Cost Dashboard',
    'atlasmind.openAgentPanel': 'Agents',
    'atlasmind.openMcpServers': 'MCP Servers',
    'atlasmind.lens.setupDeclarations': 'Lens declarations',
    'atlasmind.openSettingsSafety': 'Safety Settings',
    'atlasmind.openSettingsProject': 'Project Settings',
    'atlasmind.openSettingsTesting': 'Testing Settings',
    'atlasmind.openToolWebhooks': 'Tool Webhooks',
    'atlasmind.openVoicePanel': 'Voice',
    'atlasmind.openVisionPanel': 'Vision',
    'atlasmind.openWebsiteStudio': 'Website Studio',
    'atlasmind.updateProjectMemory': 'SSOT sync',
    'atlasmind.toggleAutopilot': 'Autopilot',
    'workbench.view.scm': 'Source Control',
  };

  const PAGE_LABELS = NAV_PAGES.reduce((map, entry) => {
    map[entry[0]] = entry[1];
    return map;
  }, {});

  // Resolve a recommendation to its action AND to an honest description of where
  // clicking takes you. The old quick-action cards labelled themselves from an
  // inert `pageTarget` field, so "Open Chat View" announced itself as "runtime"
  // while opening a different panel entirely.
  function resolveRecommendationAction(item) {
    if (item.actionPrompt) {
      return { action: 'prompt', payload: item.actionPrompt, destination: 'Ask Atlas' };
    }
    if (item.command) {
      const name = COMMAND_DESTINATIONS[item.command];
      return { action: 'command', payload: item.command, destination: name ? `Opens ${name}` : 'Opens panel' };
    }
    if (item.filePath) {
      const base = String(item.filePath).split('/').pop() || item.filePath;
      return { action: 'file', payload: item.filePath, destination: `Opens ${base}` };
    }
    if (item.pageTarget) {
      const label = PAGE_LABELS[item.pageTarget] || item.pageTarget;
      return { action: 'page', payload: item.pageTarget, destination: `Opens ${label}` };
    }
    return null;
  }

  // The short-horizon slice of the score recommendations, shown at the foot of
  // Overview. Replaces a grid of twelve shortcut cards that all duplicated a
  // destination already on the page.
  /**
   * What needs a person, drawn from every adjacent page onto the Overview.
   *
   * Placed above the stat grid because it is the only band here that can be
   * empty. The stats always show a number and so are always the same shape; this
   * one is either loud or absent, and putting an absent band under nine
   * permanently-populated cards would hide the loud case on the days it matters.
   *
   * The rendering keeps three of the module's five rules, since they are visual
   * rather than logical: **an empty feed renders one line, not a card** (the
   * twelve-card grid that used to close this page was removed for being a
   * navigation system pretending to be a summary); **the remainder is always
   * stated** where the cap truncated; and **every card names the rule that
   * graded it**, so a grade can be argued with instead of merely trusted.
   */
  function renderAttentionBand(snapshot) {
    const feed = snapshot.attention;
    if (!feed) {
      return '';
    }

    const URGENCY_WORD = { now: 'Now', soon: 'Soon', unassessed: 'Not assessed' };
    const delta = snapshot.guidedWorkflow && snapshot.guidedWorkflow.delta;
    // Only a delta with something in it earns space here. `first-look` and
    // `unchanged` are worth explaining, but the Workflow page owns that
    // explanation and this band exists to be quiet when there is no news.
    const moved = delta && delta.status === 'changed' && delta.changes.length > 0
      ? `
        <div class="attention-moved">
          <span class="attention-moved-kicker">What moved</span>
          ${delta.changes.slice(0, 3).map(change => `
            <button type="button" class="attention-moved-chip" data-action="page" data-payload="workflow" title="${escapeAttr(change.summary)}">
              ${escapeHtml(change.label)}
            </button>`).join('')}
          <button type="button" class="action-link" data-action="page" data-payload="workflow">${escapeHtml(delta.headline)} ›</button>
        </div>`
      : '';

    if (feed.totalCount === 0) {
      // Two different claims, and collapsing them would congratulate the user
      // for not looking. The sentence itself comes from the module so it cannot
      // drift; only the unexamined case adds a route to somewhere that fixes it.
      return `
        <section class="attention-band attention-band-clear">
          <p class="attention-clear">${escapeHtml(feed.summary)}</p>
          ${feed.emptyState === 'clear' ? '' : `
            <div class="tag-row">
              <button type="button" class="action-link" data-action="page" data-payload="workflow">Work through the setup ›</button>
            </div>`}
          ${moved}
        </section>`;
    }

    return `
      <section class="attention-band">
        <div class="attention-head">
          <div>
            <p class="section-kicker">Needs you</p>
            <h3>${escapeHtml(feed.summary)}</h3>
          </div>
          <span class="stat-detail">Gathered from the pages that own each fact. Ranked by consequence, not by count.</span>
        </div>
        <div class="attention-grid">
          ${feed.items.map(item => `
            <button type="button" class="attention-card attention-${escapeAttr(item.urgency)}" data-action="page" data-payload="${escapeAttr(item.pageTarget)}">
              <span class="attention-urgency">${escapeHtml(URGENCY_WORD[item.urgency] || item.urgency)}</span>
              <strong class="attention-label">${escapeHtml(item.label)}</strong>
              <span class="attention-detail">${escapeHtml(item.detail)}</span>
              <span class="attention-rule">Rule: ${escapeHtml(item.rule)}</span>
            </button>`).join('')}
        </div>
        ${feed.droppedByCap > 0
          ? `<p class="stat-detail">${escapeHtml(String(feed.droppedByCap))} more ${feed.droppedByCap === 1 ? 'item is' : 'items are'} not shown. The cap keeps the list readable; the pages themselves carry the full set.</p>`
          : ''}
        ${moved}
      </section>
    `;
  }

  function renderOverviewNextActions(snapshot) {
    const all = (snapshot.score && snapshot.score.recommendations) || [];
    // Prefer the quick wins; fall back to longer horizons so the section is not
    // empty just because the near-term work is already done.
    const ordered = ['short', 'medium', 'long']
      .flatMap(horizon => all.filter(item => item.horizon === horizon));
    const top = ordered.slice(0, 3);

    if (top.length === 0) {
      return `
        <article class="panel-card next-actions-empty">
          <p class="section-kicker">Recommended next</p>
          <h3>Nothing outstanding</h3>
          <div class="stat-detail">Every tracked operational signal is currently in good standing. The Score page shows the full breakdown behind that.</div>
          <div class="tag-row">
            <button type="button" class="action-link" data-action="page" data-payload="score">See the score breakdown</button>
          </div>
        </article>
      `;
    }

    return `
      <section class="next-actions">
        <div class="next-actions-head">
          <div>
            <p class="section-kicker">Recommended next</p>
            <h3>What would move the score most</h3>
          </div>
          <button type="button" class="action-link" data-action="page" data-payload="score">See all ${escapeHtml(String(all.length))} recommendations ›</button>
        </div>
        <div class="action-grid">
          ${top.map(item => renderRecommendationItem(item)).join('')}
        </div>
      </section>
    `;
  }

  function renderScoreComponent(component) {
    const attrs = component.pageTarget
      ? `data-action="page" data-payload="${escapeAttr(component.pageTarget)}"`
      : '';
    const width = Math.max(6, Math.round((component.score / Math.max(component.maxScore, 1)) * 100));
    const inner = `
        <div class="row-head">
          <strong>${escapeHtml(component.label)}</strong>
          <span class="tag ${component.tone === 'good' ? 'tag-good' : component.tone === 'warn' ? 'tag-warn' : component.tone === 'critical' ? 'tag-critical' : ''}">${escapeHtml(`${component.score}/${component.maxScore}`)}</span>
        </div>
        <div class="coverage-bar score-component-bar"><span data-anim-key="score-component:${escapeAttr(component.label)}" data-anim-to="${width}%" style="width:0%"></span></div>
        <div class="stat-detail">${escapeHtml(component.detail)}</div>`;
    return attrs
      ? `<button type="button" class="score-component-row is-actionable" ${attrs}>${inner}</button>`
      : `<div class="score-component-row static">${inner}</div>`;
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
    const resolved = resolveRecommendationAction(item);
    const inner = `
        <p class="card-kicker">${escapeHtml(item.impactLabel)}</p>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="stat-detail">${escapeHtml(item.detail)}</div>
        ${resolved ? `<span class="card-destination">${escapeHtml(resolved.destination)} ›</span>` : ''}`;
    if (resolved && resolved.action === 'prompt') {
      return `<div class="action-card score-recommendation-item static has-atlas-action">${inner}${renderAtlasDiscussAction('prompt', resolved.payload, `Ask AtlasMind to address ${item.title}`, { title: `Ask AtlasMind to address this recommendation: ${item.title}` })}</div>`;
    }
    return resolved
      ? `<button type="button" class="action-card score-recommendation-item is-actionable" data-action="${resolved.action}" data-payload="${escapeAttr(resolved.payload)}" title="${escapeAttr(resolved.destination)}">${inner}</button>`
      : `<div class="action-card score-recommendation-item static">${inner}</div>`;
  }

  // `scope` distinguishes two cards that render the same series on different
  // pages (commits on Overview and Repo, memory on Overview and SSOT). They
  // deliberately share `id` so the bar-detail readout stays in sync, but they
  // must not share an animation memory slot — otherwise whichever page is shown
  // first records the value and the other never animates when it is opened.
  // The 7/30/90D range picker.
  //
  // It used to sit in the sticky toolbar beside the tabs, sharing their pill
  // shape and their accent "active" colour — so when the nav wrapped it read as
  // another row of tabs rather than as a filter. It now lives directly above
  // the charts it controls, and uses the squared, joined `.segmented` treatment
  // so it belongs to a different visual family from the nav's separate pills.
  function renderChartRange(caption) {
    return `
      <div class="chart-range-row">
        <p class="section-kicker">${escapeHtml(caption)}</p>
        <div class="segmented" role="group" aria-label="Chart range">
          ${[7, 30, 90].map(days => `<button type="button" data-action="timescale" data-payload="${days}" class="${state.timescale === days ? 'active' : ''}" aria-pressed="${state.timescale === days ? 'true' : 'false'}">${days}D</button>`).join('')}
        </div>
      </div>
    `;
  }

  // Fixed slice palette. Index-based rather than hashed from the label, so the
  // same contributor keeps the same colour between renders and the legend and
  // the ring can never disagree.
  const SLICE_TONES = ['accent', 'good', 'warn', 'critical', 'muted'];

  /**
   * A donut chart drawn as SVG arcs — no chart library, and no canvas, so it
   * inherits theme colours and stays readable at any zoom.
   *
   * Slices are clickable when given an action, which is what makes the
   * contributor ring double as the Overview's filter control.
   */
  function renderDonutChart(id, slices, opts) {
    const options = opts || {};
    const usable = (slices || []).filter(slice => Number(slice.value) > 0);
    const total = usable.reduce((sum, slice) => sum + Number(slice.value), 0);
    if (total <= 0) {
      return '<div class="dist-empty">' + escapeHtml(options.emptyLabel || 'Nothing to chart yet.') + '</div>';
    }

    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    const rings = usable.map((slice, index) => {
      const value = Number(slice.value);
      const length = (value / total) * circumference;
      const tone = slice.tone || SLICE_TONES[index % SLICE_TONES.length];
      const dash = length + ' ' + (circumference - length);
      const ring = '<circle class="donut-slice donut-' + escapeAttr(tone) + (slice.active ? ' is-active' : '') + '"'
        + ' cx="80" cy="80" r="' + radius + '" fill="none" stroke-width="' + (slice.active ? 26 : 20) + '"'
        + ' stroke-dasharray="' + dash + '" stroke-dashoffset="' + (-offset) + '"'
        + ' data-anim-key="donut:' + escapeAttr(id) + ':' + escapeAttr(String(index)) + '"'
        + '><title>' + escapeHtml(slice.label + ': ' + value + ' (' + Math.round((value / total) * 100) + '%)') + '</title></circle>';
      offset += length;
      return ring;
    }).join('');

    const legend = usable.map((slice, index) => {
      const tone = slice.tone || SLICE_TONES[index % SLICE_TONES.length];
      const percent = Math.round((Number(slice.value) / total) * 100);
      const label = '<span class="dist-swatch dist-' + escapeAttr(tone) + '" aria-hidden="true"></span>'
        + '<span class="dist-legend-label">' + escapeHtml(slice.label) + '</span>'
        + '<strong>' + escapeHtml(formatNumber(slice.value)) + '</strong>'
        + '<span class="donut-legend-percent">' + escapeHtml(String(percent)) + '%</span>';
      return slice.action
        ? '<button type="button" class="dist-legend-item is-actionable' + (slice.active ? ' is-active' : '') + '" data-action="' + escapeAttr(slice.action) + '" data-payload="' + escapeAttr(slice.payload || '') + '" title="' + escapeAttr(slice.title || ('Filter to ' + slice.label)) + '">' + label + '</button>'
        : '<span class="dist-legend-item">' + label + '</span>';
    }).join('');

    return `
      <div class="donut-block">
        <svg class="donut-chart" viewBox="0 0 160 160" role="img" aria-label="${escapeAttr(usable.map(slice => slice.label + ': ' + slice.value).join(', '))}">
          <circle class="donut-track" cx="80" cy="80" r="${radius}" fill="none" stroke-width="20"></circle>
          <g transform="rotate(-90 80 80)">${rings}</g>
          ${options.centerValue ? `<text class="donut-center-value" x="80" y="78" text-anchor="middle">${escapeHtml(String(options.centerValue))}</text>` : ''}
          ${options.centerLabel ? `<text class="donut-center-label" x="80" y="96" text-anchor="middle">${escapeHtml(String(options.centerLabel))}</text>` : ''}
        </svg>
        <div class="dist-legend donut-legend">${legend}</div>
      </div>
    `;
  }

  function renderChartCard(id, title, description, series, scope) {
    const filtered = series.slice(-state.timescale);
    const maxValue = Math.max(1, ...filtered.map(point => point.value));
    const activeDetail = state.activeDetails[id] || (filtered.length > 0 ? `${filtered[filtered.length - 1].label}: ${filtered[filtered.length - 1].value}` : 'No activity recorded.');

    // Headline the period against the one before it. A bare bar chart shows
    // shape but not direction, which is the first thing a manager asks.
    const total = filtered.reduce((sum, point) => sum + point.value, 0);
    const previousWindow = series.slice(-state.timescale * 2, -state.timescale);
    const previousTotal = previousWindow.reduce((sum, point) => sum + point.value, 0);
    const hasBaseline = previousWindow.length > 0;
    const delta = total - previousTotal;
    const deltaPercent = previousTotal > 0 ? Math.round((delta / previousTotal) * 100) : null;
    const trendTone = !hasBaseline || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
    const trendGlyph = trendTone === 'up' ? '▲' : trendTone === 'down' ? '▼' : '■';
    const trendLabel = !hasBaseline
      ? 'No prior period to compare'
      : delta === 0
        ? `Level vs previous ${state.timescale} days`
        : `${delta > 0 ? '+' : ''}${delta}${deltaPercent === null ? '' : ` (${delta > 0 ? '+' : ''}${deltaPercent}%)`} vs previous ${state.timescale} days`;
    const mean = filtered.length > 0 ? total / filtered.length : 0;
    const meanPercent = Math.max(0, Math.min(100, Math.round((mean / maxValue) * 100)));
    const peakValue = filtered.length > 0 ? maxValue : 0;

    // Fingerprint the rendered series so the bars only grow when the data (or
    // the timescale) actually changed — they used to replay on every keystroke
    // anywhere in the dashboard.
    const fingerprint = `${state.timescale}:${filtered.length}:${total}:${peakValue}`;

    return `
      <article class="chart-card">
        <div class="chart-head">
          <div>
            <p class="chart-kicker">Timeline · last ${escapeHtml(String(state.timescale))} days</p>
            <h3>${escapeHtml(title)}</h3>
            <div class="stat-detail">${escapeHtml(description)}</div>
          </div>
          <div class="chart-headline">
            <span class="chart-total">${escapeHtml(formatNumber(total))}</span>
            <span class="chart-trend trend-${trendTone}" title="${escapeAttr(trendLabel)}">
              <span aria-hidden="true">${trendGlyph}</span>
              <span>${escapeHtml(trendLabel)}</span>
            </span>
          </div>
        </div>
        <div class="chart-shell">
          ${filtered.length > 0 ? `
            <div class="chart-plot">
              ${mean > 0 ? `<span class="chart-mean" style="bottom:${meanPercent}%" aria-hidden="true"><span class="chart-mean-label">avg ${escapeHtml(mean >= 10 ? String(Math.round(mean)) : mean.toFixed(1))}</span></span>` : ''}
              <div class="chart-bars" style="--bar-count: ${filtered.length}" data-anim-key="chart:${escapeAttr(scope || id)}:${escapeAttr(id)}" data-anim-prop="class" data-anim-to="${escapeAttr(fingerprint)}">
                ${filtered.map((point, index) => {
                  const height = Math.max(4, Math.round((point.value / maxValue) * 100));
                  const detailPayload = `${id}|${point.label}|${point.value}`;
                  const isPeak = point.value > 0 && point.value === peakValue;
                  return `
                    <button type="button" class="chart-bar ${activeDetail.startsWith(point.label) ? 'active' : ''}${isPeak ? ' is-peak' : ''}" data-action="detail" data-payload="${escapeAttr(detailPayload)}" style="--bar-index: ${index}" aria-label="${escapeAttr(`${title} ${point.label}: ${point.value}`)}">
                      <span class="chart-bar-column" style="height: ${height}%"></span>
                    </button>`;
                }).join('')}
              </div>
            </div>
            <div class="chart-axis"><span>${escapeHtml(filtered[0].label)}</span><span>${escapeHtml(filtered[Math.floor(filtered.length / 2)]?.label || filtered[0].label)}</span><span>${escapeHtml(filtered[filtered.length - 1].label)}</span></div>
          ` : '<div class="timeline-empty">No activity recorded for this period.</div>'}
        </div>
        <div class="timeline-detail">${escapeHtml(activeDetail)}</div>
      </article>
    `;
  }

  // A labelled, tone-segmented proportion bar. The dashboard was full of
  // "3 verified · 1 blocked · 2 missing" sentences that carried no magnitude;
  // this renders the same counts as shape. Segments animate their width in.
  //
  // segments: [{ label, value, tone: 'good'|'warn'|'critical'|'accent'|'muted' }]
  function renderDistributionBar(key, segments, opts) {
    const options = opts || {};
    const usable = (segments || []).filter(segment => Number(segment.value) > 0);
    const total = usable.reduce((sum, segment) => sum + Number(segment.value), 0);
    if (total <= 0) {
      return options.emptyLabel
        ? `<div class="dist-empty">${escapeHtml(options.emptyLabel)}</div>`
        : '';
    }
    const bar = usable.map(segment => {
      const percent = (Number(segment.value) / total) * 100;
      return `<span class="dist-seg dist-${escapeAttr(segment.tone || 'accent')}"
        data-anim-key="dist:${escapeAttr(key)}:${escapeAttr(segment.label)}"
        data-anim-to="${percent}%" style="width:0%"
        title="${escapeAttr(`${segment.label}: ${segment.value}`)}"></span>`;
    }).join('');
    const legend = usable.map(segment => `
      <span class="dist-legend-item">
        <span class="dist-swatch dist-${escapeAttr(segment.tone || 'accent')}" aria-hidden="true"></span>
        <span class="dist-legend-label">${escapeHtml(segment.label)}</span>
        <strong>${escapeHtml(formatNumber(segment.value))}</strong>
      </span>`).join('');
    return `
      <div class="dist-block">
        ${options.title ? `<div class="dist-title"><span>${escapeHtml(options.title)}</span>${options.caption ? `<span class="list-meta">${escapeHtml(options.caption)}</span>` : ''}</div>` : ''}
        <div class="dist-bar" role="img" aria-label="${escapeAttr(usable.map(s => `${s.label}: ${s.value}`).join(', '))}">${bar}</div>
        <div class="dist-legend">${legend}</div>
      </div>
    `;
  }

  // Normalize a "resolution" into a data-action/data-payload + a plain-English hint.
  // Accepts a bare string (treated as an Atlas chat prompt, for back-compat) or an
  // object { prompt | command | file | page | url | run | runWithGoal, hint }.
  function resolveActionAttrs(resolution) {
    if (!resolution) { return null; }
    if (typeof resolution === 'string') {
      const trimmed = resolution.trim();
      return trimmed ? { action: 'prompt', payload: trimmed, hint: 'Ask Atlas' } : null;
    }
    if (typeof resolution !== 'object') { return null; }
    const hint = typeof resolution.hint === 'string' && resolution.hint ? resolution.hint : '';
    const map = [
      ['prompt', 'prompt', 'Ask Atlas'],
      ['command', 'command', 'Open'],
      ['file', 'file', 'Open file'],
      ['page', 'page', 'Go to page'],
      ['url', 'external-url', 'Open ↗'],
      ['run', 'run', 'Open run'],
      ['runWithGoal', 'run-with-goal', 'Plan a run'],
    ];
    for (let i = 0; i < map.length; i += 1) {
      const key = map[i][0];
      if (resolution[key]) {
        return { action: map[i][1], payload: String(resolution[key]), hint: hint || map[i][2] };
      }
    }
    return null;
  }

  function renderMetricPill(label, value, opts) {
    const options = opts || {};
    const toneClass = options.tone ? ` pill-tone-${escapeAttr(options.tone)}` : '';
    const dot = options.tone ? '<span class="pill-dot"></span>' : '';
    // The meter width is driven by applyValueAnimations() rather than being
    // inlined, so it grows into place instead of appearing pre-filled.
    const meter = typeof options.meter === 'number' && Number.isFinite(options.meter)
      ? `<span class="metric-meter"><span data-anim-key="${escapeAttr(options.meterKey || `metric:${label}`)}" data-anim-to="${Math.max(0, Math.min(100, options.meter))}%" style="width:0%"></span></span>`
      : '';
    const inner = `<span class="metric-head">${dot}<span class="metric-label">${escapeHtml(label)}</span></span><span class="metric-value">${escapeHtml(value)}</span>${meter}`;
    const resolved = resolveActionAttrs(options.action);
    if (resolved) {
      if (resolved.action === 'prompt') {
        return `<div class="metric-pill has-atlas-action${toneClass}">${inner}${renderAtlasDiscussAction('prompt', resolved.payload, resolved.hint, { title: resolved.hint })}</div>`;
      }
      return `<button type="button" class="metric-pill is-actionable${toneClass}" data-action="${resolved.action}" data-payload="${escapeAttr(resolved.payload)}" title="${escapeAttr(resolved.hint)}">${inner}</button>`;
    }
    return `<div class="metric-pill${toneClass}">${inner}</div>`;
  }

  function renderSignalCard(label, ok, detail, resolution) {
    const resolved = resolveActionAttrs(resolution);
    const body = `
      <div class="checkline">${escapeHtml(label)}</div>
      <div class="signal-detail">${escapeHtml(detail)}</div>
    `;
    if (resolved) {
      if (resolved.action === 'prompt') {
        return `
          <div class="signal-card ${ok ? 'good' : 'warn'} static has-atlas-action">
            ${body}
            ${renderAtlasDiscussAction('prompt', resolved.payload, resolved.hint, { title: resolved.hint })}
          </div>
        `;
      }
      return `
        <button type="button" class="signal-card ${ok ? 'good' : 'warn'} is-actionable" data-action="${resolved.action}" data-payload="${escapeAttr(resolved.payload)}" title="${escapeAttr(resolved.hint)}">
          ${body}
          <span class="signal-cta">${escapeHtml(resolved.hint)} ›</span>
        </button>
      `;
    }
    return `
      <div class="signal-card ${ok ? 'good' : 'warn'} static">
        ${body}
      </div>
    `;
  }

  // A plain-English orientation band placed at the top of each page: kicker +
  // title + one-line "what this is / what to do", optional tone chips and a
  // primary action. Mirrors the Delivery page header treatment.
  function renderPageIntro(opts) {
    const o = opts || {};
    const chips = Array.isArray(o.chips) && o.chips.length > 0
      ? `<div class="page-intro-chips">${o.chips.map(chip => {
          const tone = chip.tone ? ` pill-tone-${escapeAttr(chip.tone)}` : '';
          return `<span class="intro-chip${tone}">${chip.tone ? '<span class="pill-dot"></span>' : ''}${escapeHtml(chip.label)}</span>`;
        }).join('')}</div>`
      : '';
    const resolved = resolveActionAttrs(o.action);
    const actionBtn = resolved
      ? resolved.action === 'prompt'
        ? renderAtlasDiscussAction('prompt', resolved.payload, o.actionLabel || resolved.hint, { title: o.actionLabel || resolved.hint })
        : `<button type="button" class="action-link primary" data-action="${resolved.action}" data-payload="${escapeAttr(resolved.payload)}">${escapeHtml(o.actionLabel || resolved.hint)}</button>`
      : '';
    return `
      <div class="page-intro">
        <div class="page-intro-body">
          <p class="section-kicker">${escapeHtml(o.kicker || '')}</p>
          <h3>${escapeHtml(o.title || '')}</h3>
          <p class="page-intro-summary">${escapeHtml(o.summary || '')}</p>
          ${chips}
        </div>
        ${actionBtn ? `<div class="page-intro-action">${actionBtn}</div>` : ''}
      </div>
    `;
  }

  // At-a-glance horizontal status strip (nodes joined by arrows), generalising
  // the Delivery pipeline-flow / MVP track for any sequence or status set.
  function renderFlowStrip(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) { return ''; }
    return `
      <div class="flow-strip" role="list">
        ${nodes.map((node, i) => `
          <div class="flow-chip status-${escapeAttr(node.status || 'pending')}" role="listitem" title="${escapeAttr(node.title || node.label || '')}">
            <span class="flow-chip-dot">${escapeHtml(node.icon || '')}</span>
            <span class="flow-chip-label">${escapeHtml(node.label || '')}</span>
            ${node.sub ? `<span class="flow-chip-sub">${escapeHtml(node.sub)}</span>` : ''}
          </div>
          ${i < nodes.length - 1 ? '<span class="flow-strip-arrow" aria-hidden="true">→</span>' : ''}
        `).join('')}
      </div>
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
    const toneClass = score >= 75 ? ' ring-good' : score >= 50 ? ' ring-warn' : ' ring-critical';
    return `
      <svg class="score-ring${toneClass}" viewBox="0 0 140 140" role="img" aria-label="Operational health score ${escapeAttr(String(score))} out of 100">
        <circle class="score-ring-track" cx="70" cy="70" r="${radius}"></circle>
        <circle class="score-ring-progress" cx="70" cy="70" r="${radius}" stroke-dasharray="${circumference}"
          data-anim-key="score-ring" data-anim-prop="dashoffset" data-anim-from="${circumference}" data-anim-to="${dashOffset}"
          stroke-dashoffset="${circumference}"></circle>
      </svg>
    `;
  }

  // ── Re-render-safe value animation ────────────────────────────────────────
  //
  // render() replaces #dashboard-root's innerHTML wholesale, so every node is
  // freshly parsed and has exactly one computed style. A CSS `transition`
  // between two values can therefore never interpolate: the score ring, the
  // metric meters and the MVP progress bar all declared transitions that had
  // never once played. Conversely @keyframes DO restart on every insert, which
  // is why the Overview chart re-grew 90 bars whenever an unrelated part of the
  // dashboard changed.
  //
  // Both are fixed here. Animatable elements declare a stable `data-anim-key`
  // and their target `data-anim-to`; we remember the last value painted per key
  // and, on the next frame, move only the ones whose value actually changed.
  // Unrelated re-renders repaint at the final value with no motion at all.
  //
  // Elements inside a hidden `.page-section` are deliberately not recorded, so
  // their meters animate the first time the manager opens that tab.
  const animMemory = new Map();
  const reducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function prefersReducedMotion() {
    return !!(reducedMotionQuery && reducedMotionQuery.matches);
  }

  // An element only animates when its own page is on screen. `.page-section`
  // uses display:none, so animating a hidden meter would burn the transition
  // and leave nothing to see when the tab is finally opened.
  function isOnScreen(el) {
    const section = el.closest('.page-section');
    return !section || section.classList.contains('active');
  }

  function setAnimValue(el, prop, value) {
    if (prop === 'dashoffset') {
      el.style.strokeDashoffset = value;
    } else if (prop === 'class') {
      // Keyframe-driven groups (chart bars) carry no inline value; the class
      // alone gates the animation.
    } else {
      el.style[prop] = value;
    }
  }

  function applyValueAnimations() {
    if (!root) {
      return;
    }
    const reduced = prefersReducedMotion();
    const pending = [];

    root.querySelectorAll('[data-anim-key]').forEach(el => {
      const key = el.getAttribute('data-anim-key');
      const prop = el.getAttribute('data-anim-prop') || 'width';
      const to = el.getAttribute('data-anim-to') || '';
      const from = el.getAttribute('data-anim-from') || '0%';

      if (!isOnScreen(el)) {
        // Paint the final value so the layout is correct if it is ever
        // measured, but leave the memory untouched so opening the tab animates.
        setAnimValue(el, prop, to);
        return;
      }

      const previous = animMemory.get(key);
      animMemory.set(key, to);

      if (reduced || previous === to) {
        setAnimValue(el, prop, to);
        return;
      }

      setAnimValue(el, prop, previous === undefined ? from : previous);
      pending.push([el, prop, to]);
    });

    if (pending.length === 0) {
      return;
    }

    // Two frames: the first lets the browser commit the "from" value as a real
    // computed style, the second starts the transition from it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pending.forEach(entry => {
          entry[0].classList.add('is-animating');
          setAnimValue(entry[0], entry[1], entry[2]);
        });
      });
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

  /**
   * Escape a value for use inside a CSS attribute selector.
   *
   * Step ids are ours and contain only word characters and dots, but building a
   * selector from data without escaping is the kind of thing that is safe until
   * somebody adds an id with a quote in it.
   */
  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  vscode.postMessage({ type: 'ready' });
})();

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('dashboard-root');
  const refreshButton = document.getElementById('dashboard-refresh');
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = {
    snapshot: undefined,
    activePage: 'overview',
    timescale: 30,
    activeDetails: {
      commits: '',
      runs: '',
      memory: '',
    },
    ideationBusy: false,
    ideationStatus: 'Shape the board with notes, images, and a guided Atlas facilitation pass.',
    ideationResponse: '',
    selectedCardId: '',
    linkStartCardId: '',
    boardSaveTimer: undefined,
    drag: undefined,
    recognition: undefined,
    voiceSupported: typeof SpeechRecognitionCtor === 'function',
    voiceActive: false,
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
      syncSelectedCard();
      render();
      return;
    }

    if (message.type === 'navigate') {
      state.activePage = typeof message.payload === 'string' ? message.payload : 'overview';
      render();
      return;
    }

    if (message.type === 'error') {
      renderError(message.payload || 'Dashboard refresh failed.');
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
    if (action === 'command') {
      vscode.postMessage({ type: 'openCommand', payload });
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
    if (action === 'ideation-attach-images') {
      vscode.postMessage({ type: 'attachIdeationImages' });
      return;
    }
    if (action === 'ideation-clear-images') {
      vscode.postMessage({ type: 'clearIdeationImages' });
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
    }
  });

  root?.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.id === 'ideationTitleInput' || target.id === 'ideationBodyInput' || target.id === 'ideationTypeInput' || target.id === 'ideationColorInput') {
      render();
    }
  });

  root?.addEventListener('pointerdown', event => {
    const handle = event.target instanceof HTMLElement ? event.target.closest('[data-drag-card-id]') : null;
    if (!(handle instanceof HTMLElement)) {
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
    const cardElement = root?.querySelector(`[data-card-id="${cssEscape(state.drag.cardId)}"]`);
    if (!card || !(cardElement instanceof HTMLElement)) {
      return;
    }
    card.x = clampNumber(state.drag.originX + (event.clientX - state.drag.startX), -1600, 1600);
    card.y = clampNumber(state.drag.originY + (event.clientY - state.drag.startY), -1200, 1200);
    card.updatedAt = new Date().toISOString();
    cardElement.style.left = `calc(50% + ${card.x}px)`;
    cardElement.style.top = `calc(50% + ${card.y}px)`;
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
        root.innerHTML = '<div class="dashboard-loading">Loading dashboard signals…</div>';
        return;
      }

      const pages = [
        ['overview', 'Overview'],
        ['repo', 'Repo'],
        ['runtime', 'Runtime'],
        ['ssot', 'SSOT'],
        ['security', 'Security'],
        ['delivery', 'Delivery'],
        ['ideation', 'Ideation'],
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
          <article class="score-card">
            <p class="dashboard-kicker">Operational score</p>
            ${renderScoreRing(snapshot.healthScore)}
            <div class="score-value">${escapeHtml(String(snapshot.healthScore))}</div>
            <div class="score-caption">Composite score across repo hygiene, governance, SSOT, and delivery scaffolding.</div>
          </article>
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
        ${renderRepo(snapshot)}
        ${renderRuntime(snapshot)}
        ${renderSsot(snapshot)}
        ${renderSecurity(snapshot)}
        ${renderDelivery(snapshot)}
        ${renderIdeation(snapshot)}
      `;
      updateConnectionPositions();
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
    }
  }

  function renderError(message) {
    if (!root) {
      return;
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

  function renderOverview(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'overview' ? 'active' : ''}">
        <div class="stats-grid">
          ${snapshot.stats.map(stat => renderStatCard(stat)).join('')}
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

  function renderSsot(snapshot) {
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

  function renderDelivery(snapshot) {
    return `
      <section class="page-section ${state.activePage === 'delivery' ? 'active' : ''}">
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
          <article class="list-card">
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
          <article class="list-card">
            <p class="section-kicker">Release hygiene</p>
            <h3>Important artifacts</h3>
            <div class="stack-list">
              ${renderReviewArtifact('CHANGELOG.md', 'Track release notes and version movement.', 'CHANGELOG.md')}
              ${renderReviewArtifact('.github/pull_request_template.md', 'Review checklist for pull requests.', '.github/pull_request_template.md')}
              ${renderReviewArtifact('.github/workflows/ci.yml', 'Primary CI workflow entry point.', '.github/workflows/ci.yml')}
              ${renderReviewArtifact('docs/development.md', 'Contributor workflow and build guide.', 'docs/development.md')}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderIdeation(snapshot) {
    const ideation = snapshot.ideation;
    const selectedCard = resolveSelectedCard(ideation);
    const promptValue = getPromptValue();
    return `
      <section class="page-section ${state.activePage === 'ideation' ? 'active' : ''}">
        <div class="ideation-shell">
          <article class="ideation-panel ideation-panel-control">
            <div class="row-head">
              <div>
                <p class="section-kicker">Guided ideation</p>
                <h3>Atlas whiteboard loop</h3>
              </div>
              <span class="tag ${state.ideationBusy ? 'tag-warn' : 'tag-good'}">${state.ideationBusy ? 'Atlas thinking' : 'Ready'}</span>
            </div>
            <p class="section-copy">Capture a fragment of the idea, focus a card, then let Atlas challenge, expand, and suggest the next concrete prompts. Voice input handles the user side; Atlas can answer back in text and narration.</p>
            <label class="ideation-label" for="ideationPrompt">Ask Atlas what to test, clarify, or expand next</label>
            <textarea id="ideationPrompt" class="ideation-prompt" placeholder="Example: pressure-test this idea for small design agencies and suggest the fastest validation experiment">${escapeHtml(promptValue)}</textarea>
            <div class="ideation-action-row">
              <button type="button" class="dashboard-button" data-action="ideation-run" ${state.ideationBusy ? 'disabled' : ''}>Run Ideation Loop</button>
              <button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-start-voice" ${state.voiceActive ? 'disabled' : ''}>Start Voice</button>
              <button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-stop-voice" ${!state.voiceActive ? 'disabled' : ''}>Stop Voice</button>
              <button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-attach-images">Attach Images</button>
              <button type="button" class="dashboard-button dashboard-button-ghost" data-action="ideation-clear-images" ${ideation.imageAttachments.length === 0 ? 'disabled' : ''}>Clear Images</button>
            </div>
            <div class="ideation-status-card">
              <strong>Status</strong>
              <div class="stat-detail">${escapeHtml(state.ideationStatus)}</div>
              <div class="tag-row">
                <span class="tag">Updated ${escapeHtml(ideation.updatedRelative)}</span>
                <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(ideation.boardPath)}">Open board JSON</button>
                <button type="button" class="action-link" data-action="file" data-payload="${escapeAttr(ideation.summaryPath)}">Open board summary</button>
              </div>
            </div>
            <div class="ideation-attachment-row">
              ${ideation.imageAttachments.length > 0 ? ideation.imageAttachments.map(attachment => `<span class="attachment-pill">${escapeHtml(attachment.source)}</span>`).join('') : '<span class="muted">No images attached for the next loop.</span>'}
            </div>
          </article>

          <article class="ideation-panel ideation-panel-board">
            <div class="row-head">
              <div>
                <p class="section-kicker">Shared canvas</p>
                <h3>Project whiteboard</h3>
              </div>
              <div class="tag-row">
                <button type="button" class="action-link" data-action="ideation-add-card">Add Card</button>
                <button type="button" class="action-link" data-action="ideation-duplicate-card" ${selectedCard ? '' : 'disabled'}>Duplicate</button>
                <button type="button" class="action-link" data-action="ideation-link-toggle" ${selectedCard ? '' : 'disabled'}>${state.linkStartCardId ? 'Cancel Link' : 'Link Card'}</button>
                <button type="button" class="action-link" data-action="ideation-set-focus" ${selectedCard ? '' : 'disabled'}>Set Focus</button>
                <button type="button" class="action-link" data-action="ideation-delete-card" ${selectedCard ? '' : 'disabled'}>Delete</button>
              </div>
            </div>
            <div class="ideation-board-stage" id="ideationBoardStage">
              <svg class="ideation-connections" viewBox="0 0 1200 760" preserveAspectRatio="none" aria-hidden="true">
                ${renderIdeationConnections(ideation)}
              </svg>
              ${ideation.cards.length > 0 ? ideation.cards.map(card => renderIdeationCard(card, ideation.focusCardId)).join('') : `
                <div class="ideation-empty-state">
                  <strong>Start with one sharp note</strong>
                  <p>Add a concept card, or ask Atlas to turn your first prompt into a board scaffold.</p>
                </div>`}
            </div>
            <div class="ideation-board-hint">Drag cards by their header. Link mode lets you select one card, then click a second card to connect them.</div>
          </article>
        </div>

        <div class="ideation-lower-grid">
          <article class="panel-card ideation-inspector-card">
            <p class="section-kicker">Inspector</p>
            <h3>${selectedCard ? escapeHtml(selectedCard.title) : 'Select a card'}</h3>
            ${selectedCard ? `
              <label class="ideation-label" for="ideationTitleInput">Title</label>
              <input id="ideationTitleInput" class="ideation-input" type="text" value="${escapeAttr(selectedCard.title)}" />
              <label class="ideation-label" for="ideationBodyInput">Notes</label>
              <textarea id="ideationBodyInput" class="ideation-textarea">${escapeHtml(selectedCard.body)}</textarea>
              <div class="ideation-inspector-grid">
                <div>
                  <label class="ideation-label" for="ideationTypeInput">Type</label>
                  <select id="ideationTypeInput" class="ideation-select">
                    ${['concept', 'insight', 'question', 'opportunity', 'risk', 'experiment', 'user-need', 'atlas-response', 'attachment'].map(kind => `<option value="${kind}" ${selectedCard.kind === kind ? 'selected' : ''}>${escapeHtml(kind)}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="ideation-label" for="ideationColorInput">Color</label>
                  <select id="ideationColorInput" class="ideation-select">
                    ${['sun', 'sea', 'mint', 'rose', 'sand', 'storm'].map(color => `<option value="${color}" ${selectedCard.color === color ? 'selected' : ''}>${escapeHtml(color)}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="tag-row">
                <span class="tag">${escapeHtml(selectedCard.author)}</span>
                <span class="tag">${escapeHtml(selectedCard.kind)}</span>
                ${ideation.focusCardId === selectedCard.id ? '<span class="tag tag-good">focus</span>' : ''}
              </div>
            ` : '<div class="dashboard-empty ideation-empty-mini">Use the canvas to create or select a card.</div>'}
          </article>

          <article class="panel-card ideation-response-card">
            <div class="row-head">
              <div>
                <p class="section-kicker">Atlas feedback</p>
                <h3>Latest facilitation pass</h3>
              </div>
              <div class="tag-row">
                <button type="button" class="action-link" data-action="ideation-speak-response" ${state.ideationResponse || ideation.lastAtlasResponse ? '' : 'disabled'}>Narrate</button>
                <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVoicePanel">Voice panel</button>
                <button type="button" class="action-link" data-action="command" data-payload="atlasmind.openVisionPanel">Vision panel</button>
              </div>
            </div>
            <div class="ideation-response-box">${escapeHtml(state.ideationResponse || ideation.lastAtlasResponse || 'Atlas feedback will appear here after you run the loop.').replace(/\n/g, '<br/>')}</div>
          </article>

          <article class="panel-card ideation-thread-card">
            <p class="section-kicker">Next prompts</p>
            <h3>Suggested facilitation moves</h3>
            <div class="tag-row ideation-chip-row">
              ${ideation.nextPrompts.length > 0 ? ideation.nextPrompts.map(prompt => `<button type="button" class="tag ideation-chip" data-action="ideation-prompt-chip" data-payload="${escapeAttr(prompt)}">${escapeHtml(prompt)}</button>`).join('') : '<span class="muted">Atlas will queue prompts here after the first pass.</span>'}
            </div>
            <div class="ideation-history-list">
              ${ideation.history.length > 0 ? ideation.history.slice(-6).reverse().map(entry => `
                <div class="recent-item ideation-history-item">
                  <div class="row-head">
                    <strong>${escapeHtml(entry.role === 'atlas' ? 'Atlas' : 'You')}</strong>
                    <span class="list-meta">${escapeHtml(relativeLabel(entry.timestamp))}</span>
                  </div>
                  <div class="stat-detail">${escapeHtml(entry.content)}</div>
                </div>`).join('') : '<div class="dashboard-empty ideation-empty-mini">Conversation turns will appear here.</div>'}
            </div>
          </article>
        </div>
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

  function renderSignalCard(label, ok, detail) {
    return `
      <article class="signal-card ${ok ? 'good' : 'warn'}">
        <div class="checkline">${escapeHtml(label)}</div>
        <div class="signal-detail">${escapeHtml(detail)}</div>
      </article>
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

  function renderReviewArtifact(label, description, filePath) {
    return `
      <button type="button" class="review-card" data-action="file" data-payload="${escapeAttr(filePath)}">
        <h4>${escapeHtml(label)}</h4>
        <div class="signal-detail">${escapeHtml(description)}</div>
      </button>
    `;
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

  function renderIdeationConnections(ideation) {
    return ideation.connections.map(connection => {
      const from = ideation.cards.find(card => card.id === connection.fromCardId);
      const to = ideation.cards.find(card => card.id === connection.toCardId);
      if (!from || !to) {
        return '';
      }
      const startX = 600 + from.x + 110;
      const startY = 380 + from.y + 64;
      const endX = 600 + to.x + 110;
      const endY = 380 + to.y + 64;
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      return `
        <g class="ideation-link-group" data-link-id="${escapeAttr(connection.id)}">
          <path class="ideation-link" d="M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}"></path>
          ${connection.label ? `<text class="ideation-link-label" x="${midX}" y="${midY - 8}">${escapeHtml(connection.label)}</text>` : ''}
        </g>`;
    }).join('');
  }

  function renderIdeationCard(card, focusCardId) {
    return `
      <button type="button" class="ideation-card ideation-card-${escapeAttr(card.color)} ${state.selectedCardId === card.id ? 'selected' : ''} ${focusCardId === card.id ? 'focused' : ''}" data-action="ideation-select-card" data-payload="${escapeAttr(card.id)}" data-card-id="${escapeAttr(card.id)}" style="left: calc(50% + ${card.x}px); top: calc(50% + ${card.y}px);">
        <div class="ideation-card-head" data-drag-card-id="${escapeAttr(card.id)}">
          <span class="ideation-card-type">${escapeHtml(card.kind)}</span>
          <span class="tag">${escapeHtml(card.author)}</span>
        </div>
        <strong>${escapeHtml(card.title)}</strong>
        <p>${escapeHtml(card.body || 'Add notes to make the idea concrete.')}</p>
      </button>
    `;
  }

  function resolveSelectedCard(ideation) {
    if (state.selectedCardId) {
      return ideation.cards.find(card => card.id === state.selectedCardId);
    }
    if (ideation.focusCardId) {
      state.selectedCardId = ideation.focusCardId;
      return ideation.cards.find(card => card.id === ideation.focusCardId);
    }
    if (ideation.cards[0]) {
      state.selectedCardId = ideation.cards[0].id;
      return ideation.cards[0];
    }
    return undefined;
  }

  function syncSelectedCard() {
    const cards = state.snapshot?.ideation?.cards || [];
    if (cards.length === 0) {
      state.selectedCardId = '';
      state.linkStartCardId = '';
      return;
    }
    if (!cards.some(card => card.id === state.selectedCardId)) {
      state.selectedCardId = state.snapshot.ideation.focusCardId || cards[0].id;
    }
    if (state.linkStartCardId && !cards.some(card => card.id === state.linkStartCardId)) {
      state.linkStartCardId = '';
    }
  }

  function addIdeationCard() {
    const ideation = state.snapshot?.ideation;
    if (!ideation) {
      return;
    }
    const base = resolveSelectedCard(ideation);
    const card = {
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: 'New idea',
      body: 'Describe the insight, user need, or experiment.',
      kind: 'concept',
      author: 'user',
      x: clampNumber((base?.x || 0) + 60, -1600, 1600),
      y: clampNumber((base?.y || 0) + 60, -1200, 1200),
      color: 'sun',
      imageSources: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    ideation.cards = [...ideation.cards, card].slice(-48);
    state.selectedCardId = card.id;
    scheduleIdeationSave();
    render();
  }

  function deleteSelectedIdeationCard() {
    const ideation = state.snapshot?.ideation;
    if (!ideation || !state.selectedCardId) {
      return;
    }
    ideation.cards = ideation.cards.filter(card => card.id !== state.selectedCardId);
    ideation.connections = ideation.connections.filter(connection => connection.fromCardId !== state.selectedCardId && connection.toCardId !== state.selectedCardId);
    if (ideation.focusCardId === state.selectedCardId) {
      ideation.focusCardId = ideation.cards[0]?.id;
    }
    state.selectedCardId = ideation.cards[0]?.id || '';
    state.linkStartCardId = '';
    scheduleIdeationSave();
    render();
  }

  function duplicateSelectedIdeationCard() {
    const ideation = state.snapshot?.ideation;
    const selected = getSelectedCard();
    if (!ideation || !selected) {
      return;
    }
    const duplicate = {
      ...selected,
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${selected.title} copy`,
      x: clampNumber(selected.x + 42, -1600, 1600),
      y: clampNumber(selected.y + 42, -1200, 1200),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    ideation.cards = [...ideation.cards, duplicate].slice(-48);
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
    const ideation = state.snapshot?.ideation;
    if (!ideation || !state.selectedCardId) {
      return;
    }
    ideation.focusCardId = state.selectedCardId;
    scheduleIdeationSave();
    render();
  }

  function handleCardSelection(cardId) {
    const ideation = state.snapshot?.ideation;
    if (!ideation) {
      return;
    }
    if (state.linkStartCardId && state.linkStartCardId !== cardId) {
      ideation.connections = [...ideation.connections, {
        id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fromCardId: state.linkStartCardId,
        toCardId: cardId,
        label: 'relates to',
      }].slice(-96);
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
    const selected = getSelectedCard();
    if (!selected) {
      return;
    }
    if (field === 'title' || field === 'body' || field === 'kind' || field === 'color') {
      selected[field] = value;
      selected.updatedAt = new Date().toISOString();
      scheduleIdeationSave();
    }
  }

  function scheduleIdeationSave() {
    clearTimeout(state.boardSaveTimer);
    state.boardSaveTimer = setTimeout(() => {
      const ideation = state.snapshot?.ideation;
      if (!ideation) {
        return;
      }
      vscode.postMessage({
        type: 'saveIdeationBoard',
        payload: {
          cards: ideation.cards,
          connections: ideation.connections,
          focusCardId: ideation.focusCardId,
          nextPrompts: ideation.nextPrompts,
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
    return state.snapshot?.ideation?.cards.find(card => card.id === cardId);
  }

  function getSelectedCard() {
    return findIdeationCard(state.selectedCardId);
  }

  function getPromptValue() {
    const promptInput = document.getElementById('ideationPrompt');
    return promptInput instanceof HTMLTextAreaElement ? promptInput.value : '';
  }

  function updateConnectionPositions() {
    const stage = document.getElementById('ideationBoardStage');
    if (!(stage instanceof HTMLElement)) {
      return;
    }
    const svg = stage.querySelector('.ideation-connections');
    if (!(svg instanceof SVGElement)) {
      return;
    }
    const ideation = state.snapshot?.ideation;
    if (!ideation) {
      return;
    }
    svg.innerHTML = renderIdeationConnections(ideation);
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
    const text = state.ideationResponse || state.snapshot?.ideation?.lastAtlasResponse || '';
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
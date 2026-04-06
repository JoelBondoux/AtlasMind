(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('dashboard-root');
  const refreshButton = document.getElementById('dashboard-refresh');
  const state = {
    snapshot: undefined,
    activePage: 'overview',
    timescale: 30,
    activeDetails: {
      commits: '',
      runs: '',
      memory: '',
    },
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
    if (action === 'prompt') {
      vscode.postMessage({ type: 'openPrompt', payload });
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
        ['score', 'Score'],
        ['repo', 'Repo'],
        ['runtime', 'Runtime'],
        ['ssot', 'SSOT'],
        ['security', 'Security'],
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
        ${renderSsot(snapshot)}
        ${renderSecurity(snapshot)}
        ${renderDelivery(snapshot)}
      `;
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
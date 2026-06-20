import * as vscode from 'vscode';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { Planner } from '../core/planner.js';
import { TaskProfiler } from '../core/taskProfiler.js';
import { MissionRunner } from '../core/missionRunner.js';
import type { MissionCheckpointRequest, MissionBlockedRequest, MissionBlockResolution } from '../core/missionRunner.js';
import { createWorkspaceSnapshot, collectWorkspaceChangesSince, createMissionSettingBlockGate } from '../chat/participant.js';
import { formatCost, getDisplayCurrency, getExchangeRate } from '../core/currencyFormatter.js';
import {
  DEFAULT_MISSION_MAX_ITERATIONS,
  DEFAULT_MISSION_MAX_COST_USD,
  DEFAULT_MISSION_MAX_TOKENS,
  DEFAULT_MISSION_MAX_NO_PROGRESS,
  DEFAULT_MISSION_CHECKPOINT_EVERY_N,
  DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION,
  DEFAULT_MISSION_GOAL_CONFIDENCE,
} from '../constants.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { ModelRouter } from '../core/modelRouter.js';
import type { ProviderRegistry } from '../providers/index.js';
import type { MemoryManager } from '../memory/memoryManager.js';
import type { SkillsRegistry } from '../core/skillsRegistry.js';
import type { CostTracker } from '../core/costTracker.js';
import type { MissionRegistry } from '../core/missionRegistry.js';
import type {
  BudgetMode,
  ChangedWorkspaceFile,
  MissionConfig,
  MissionProgressUpdate,
  RoutingConstraints,
  SpeedMode,
} from '../types.js';

/** Services the panel needs to plan, run, and persist a mission. */
export interface MissionControlServices {
  orchestrator: Orchestrator;
  modelRouter: ModelRouter;
  providerRegistry: ProviderRegistry;
  memoryManager: MemoryManager;
  skillsRegistry: SkillsRegistry;
  costTracker: CostTracker;
  missionRegistry: MissionRegistry;
}

// ── Inbound (webview → extension) messages ───────────────────────

interface LaunchMessage {
  type: 'launch';
  goal: string;
  successCriteria: string[];
  guardrails: string[];
  protectedPaths: string[];
  budget: {
    maxIterations: number;
    maxCostUsd: number;
    maxTokens: number;
    maxDurationMinutes: number;
    maxConsecutiveNoProgress: number;
  };
  checkpoint: {
    everyNIterations: number;
    atBudgetFraction: number;
    beforeWriteBatches: boolean;
  };
  allowDiscovery: boolean;
}

type MissionControlMessage =
  | LaunchMessage
  | { type: 'stop' }
  | { type: 'decisionResponse'; id: string; choice: string }
  | { type: 'refresh' };

function toNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toStringLines(value: unknown, maxItems = 30, maxLen = 500): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(s => s.trim().slice(0, maxLen))
    .filter(s => s.length > 0)
    .slice(0, maxItems);
}

/** Validate + coerce an untrusted webview message. This is the webview → engine boundary. */
export function parseMissionControlMessage(raw: unknown): MissionControlMessage | undefined {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
    return undefined;
  }
  const m = raw as Record<string, unknown>;
  switch (m['type']) {
    case 'stop':
    case 'refresh':
      return { type: m['type'] };
    case 'decisionResponse':
      return typeof m['id'] === 'string' && typeof m['choice'] === 'string'
        ? { type: 'decisionResponse', id: m['id'], choice: m['choice'] }
        : undefined;
    case 'launch': {
      const goal = typeof m['goal'] === 'string' ? m['goal'].trim().slice(0, 4000) : '';
      if (!goal) {
        return undefined;
      }
      const budgetRaw = (typeof m['budget'] === 'object' && m['budget'] !== null ? m['budget'] : {}) as Record<string, unknown>;
      const cpRaw = (typeof m['checkpoint'] === 'object' && m['checkpoint'] !== null ? m['checkpoint'] : {}) as Record<string, unknown>;
      return {
        type: 'launch',
        goal,
        successCriteria: toStringLines(m['successCriteria']),
        guardrails: toStringLines(m['guardrails']),
        protectedPaths: toStringLines(m['protectedPaths']),
        budget: {
          maxIterations: Math.max(1, Math.min(50, Math.trunc(toNumber(budgetRaw['maxIterations'], DEFAULT_MISSION_MAX_ITERATIONS)))),
          maxCostUsd: Math.max(0.01, toNumber(budgetRaw['maxCostUsd'], DEFAULT_MISSION_MAX_COST_USD)),
          maxTokens: Math.max(1000, Math.trunc(toNumber(budgetRaw['maxTokens'], DEFAULT_MISSION_MAX_TOKENS))),
          maxDurationMinutes: Math.max(1, Math.trunc(toNumber(budgetRaw['maxDurationMinutes'], 30))),
          maxConsecutiveNoProgress: Math.max(1, Math.min(10, Math.trunc(toNumber(budgetRaw['maxConsecutiveNoProgress'], DEFAULT_MISSION_MAX_NO_PROGRESS)))),
        },
        checkpoint: {
          everyNIterations: Math.max(0, Math.min(50, Math.trunc(toNumber(cpRaw['everyNIterations'], DEFAULT_MISSION_CHECKPOINT_EVERY_N)))),
          atBudgetFraction: Math.max(0.01, Math.min(1, toNumber(cpRaw['atBudgetFraction'], DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION))),
          beforeWriteBatches: m['checkpoint'] !== null && cpRaw['beforeWriteBatches'] === true,
        },
        allowDiscovery: m['allowDiscovery'] !== false,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Mission Control — define, launch, watch, checkpoint, and audit autonomous
 * Mission Loop runs.
 *
 * Security:
 * - All dynamic content is escaped via escapeHtml() or built with textContent.
 * - Inbound webview messages are validated by parseMissionControlMessage().
 * - CSP is nonce-protected via getWebviewHtmlShell(); no inline event handlers.
 * - Checkpoints are deny-by-default: stopping or disposing resolves any pending
 *   approval as denied.
 */
export class MissionControlPanel {
  public static currentPanel: MissionControlPanel | undefined;
  private static readonly viewType = 'atlasmind.missionControl';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private running = false;
  private abortController: AbortController | undefined;
  /** An in-panel decision (checkpoint / block recovery) the panel is awaiting. */
  private pendingDecision: { id: string; resolve: (choice: string) => void } | undefined;

  public static createOrShow(context: vscode.ExtensionContext, services: MissionControlServices): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (MissionControlPanel.currentPanel) {
      MissionControlPanel.currentPanel.panel.reveal(column);
      MissionControlPanel.currentPanel.postMissions();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      MissionControlPanel.viewType,
      'AtlasMind – Mission Control',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MissionControlPanel.currentPanel = new MissionControlPanel(panel, services);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly services: MissionControlServices) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        const message = parseMissionControlMessage(raw);
        if (!message) {
          return;
        }
        switch (message.type) {
          case 'launch':
            void this.launch(message);
            break;
          case 'stop':
            this.stop();
            break;
          case 'decisionResponse':
            if (this.pendingDecision && this.pendingDecision.id === message.id) {
              this.resolveDecision(message.choice);
            }
            break;
          case 'refresh':
            this.postMissions();
            break;
        }
      },
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.postMissions();
  }

  public dispose(): void {
    MissionControlPanel.currentPanel = undefined;
    // Deny any pending decision and abort an in-flight run.
    this.resolveDecision('stop');
    this.abortController?.abort();
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.panel.webview.postMessage(message);
  }

  /** Surface an in-panel decision card with buttons and resolve with the clicked option id. */
  private requestDecision(
    title: string,
    detail: string,
    options: Array<{ id: string; label: string; kind?: 'primary' | 'danger' | 'default' }>,
  ): Promise<string> {
    this.resolveDecision('stop');
    const id = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.post({ type: 'decision', payload: { id, title, detail, options } });
    return new Promise<string>(resolve => {
      this.pendingDecision = { id, resolve };
    });
  }

  private resolveDecision(choice: string): void {
    const pending = this.pendingDecision;
    this.pendingDecision = undefined;
    if (pending) {
      this.post({ type: 'clearDecision' });
      pending.resolve(choice);
    }
  }

  private stop(): void {
    this.abortController?.abort();
    this.resolveDecision('stop');
    this.post({ type: 'log', level: 'warn', text: 'Stop requested — the mission will halt at the next safe point.' });
  }

  private postMissions(): void {
    const items = this.services.missionRegistry.list().slice(0, 25).map(m => ({
      goal: m.goal,
      status: m.status,
      stopReason: m.stopReason ?? '',
      achieved: m.achieved,
      iterations: m.iterations.length,
      maxIterations: m.config.budget.maxIterations,
      costUsd: m.totalCostUsd,
      createdAt: m.createdAt,
    }));
    this.post({ type: 'missions', items });
  }

  private async launch(message: LaunchMessage): Promise<void> {
    if (this.running) {
      this.post({ type: 'log', level: 'warn', text: 'A mission is already running. Stop it before starting another.' });
      return;
    }
    const configuration = vscode.workspace.getConfiguration('atlasmind');
    if (!configuration.get<boolean>('loop.enabled', true)) {
      this.post({ type: 'log', level: 'error', text: 'The Mission Loop is disabled (atlasmind.loop.enabled).' });
      return;
    }

    const constraints: RoutingConstraints = {
      budget: coerceBudgetMode(configuration.get<string>('budgetMode')),
      speed: coerceSpeedMode(configuration.get<string>('speedMode')),
    };

    // The cost cap is entered in the user's display currency; convert to USD-canonical.
    const fxRate = getExchangeRate(getDisplayCurrency());
    const maxCostUsd = fxRate > 0 ? message.budget.maxCostUsd / fxRate : message.budget.maxCostUsd;

    const missionConfig: MissionConfig = {
      id: `mission-${Date.now()}`,
      goal: message.goal,
      successCriteria: message.successCriteria.length > 0 ? message.successCriteria : undefined,
      guardrails: {
        instructions: message.guardrails.length > 0
          ? message.guardrails
          : ['Make the smallest safe, verifiable change each iteration; prefer existing skills and agents before creating new ones.'],
        protectedPaths: message.protectedPaths.length > 0 ? message.protectedPaths : undefined,
      },
      budget: {
        maxIterations: message.budget.maxIterations,
        maxCostUsd,
        maxTokens: message.budget.maxTokens,
        maxDurationMs: message.budget.maxDurationMinutes * 60_000,
        maxConsecutiveNoProgress: message.budget.maxConsecutiveNoProgress,
      },
      checkpointPolicy: {
        everyNIterations: message.checkpoint.everyNIterations,
        atBudgetFractions: [message.checkpoint.atBudgetFraction],
        beforeWriteBatches: message.checkpoint.beforeWriteBatches,
      },
      constraints,
      allowDiscovery: message.allowDiscovery,
    };

    const planner = new Planner(
      this.services.modelRouter,
      this.services.providerRegistry,
      new TaskProfiler(),
      this.services.memoryManager,
      this.services.skillsRegistry,
    );
    const runner = new MissionRunner(this.services.orchestrator, planner, this.services.costTracker, this.services.missionRegistry);

    this.running = true;
    this.abortController = new AbortController();
    this.post({ type: 'state', running: true });
    this.post({ type: 'log', level: 'info', text: `Mission started: ${message.goal}` });

    let baseline = await createWorkspaceSnapshot().catch(() => undefined);
    const captureChangedFiles = async (): Promise<ChangedWorkspaceFile[]> => {
      if (!baseline) {
        return [];
      }
      try {
        const impact = await collectWorkspaceChangesSince(baseline);
        baseline = impact.snapshot;
        return impact.changedFiles;
      } catch {
        return [];
      }
    };

    const checkpointGate = async (request: MissionCheckpointRequest): Promise<boolean> => {
      const choice = await this.requestDecision(
        `Checkpoint — iteration ${request.iterationIndex}`,
        `${request.reason} Spent ${formatCost(request.spentUsd, 4)} of ${formatCost(request.budgetUsd, 2)} · ` +
          `${request.spentTokens.toLocaleString()} tokens.`,
        [
          { id: 'continue', label: 'Approve & continue', kind: 'primary' },
          { id: 'stop', label: 'Stop', kind: 'danger' },
        ],
      );
      return choice === 'continue';
    };

    const blockAsk = async (request: MissionBlockedRequest): Promise<MissionBlockResolution> => {
      const choice = await this.requestDecision(
        `Blocked — ${request.blocker.title}`,
        `${request.blocker.detail} (setting: ${request.blocker.settingKey})`,
        [
          { id: 'override', label: 'Override for this run', kind: 'primary' },
          { id: 'settings', label: 'Open settings' },
          { id: 'stop', label: 'Stop', kind: 'danger' },
        ],
      );
      if (choice === 'override') {
        return 'override-once';
      }
      if (choice === 'settings') {
        await vscode.commands.executeCommand(request.blocker.settingsCommand);
        return 'open-settings';
      }
      return 'stop';
    };

    const { blockedGate, restoreOverrides } = createMissionSettingBlockGate(blockAsk);

    try {
      const result = await runner.run(missionConfig, {
        hooks: { checkpointGate, blockedGate },
        onProgress: (update: MissionProgressUpdate) => this.renderProgress(update),
        signal: this.abortController.signal,
        goalConfidenceThreshold: configuration.get<number>('loop.goalAchievedConfidenceThreshold', DEFAULT_MISSION_GOAL_CONFIDENCE),
        captureChangedFiles,
      });
      this.post({
        type: 'done',
        achieved: result.achieved,
        stopReason: result.stopReason,
        summary: result.finalSynthesis,
        iterations: result.iterations.length,
        costUsd: result.totalCostUsd,
      });
    } catch (err) {
      this.post({ type: 'log', level: 'error', text: `Mission failed: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      this.running = false;
      this.abortController = undefined;
      this.resolveDecision('stop');
      await restoreOverrides();
      this.post({ type: 'state', running: false });
      this.postMissions();
    }
  }

  private renderProgress(update: MissionProgressUpdate): void {
    switch (update.type) {
      case 'iteration-start':
        this.post({ type: 'log', level: 'info', text: `▶ Iteration ${update.index}/${update.maxIterations}${update.focus ? ` — focus: ${update.focus}` : ''}` });
        break;
      case 'planned-increment':
        this.post({ type: 'log', level: 'muted', text: `  planned ${update.plan.subTasks.length} subtask(s)` });
        break;
      case 'executing':
        this.post({ type: 'log', level: 'muted', text: `  executing…` });
        break;
      case 'evaluated':
        this.post({
          type: 'log',
          level: update.verdict.verdict === 'achieved' ? 'success' : update.verdict.verdict === 'blocked' || update.verdict.verdict === 'stalled' ? 'warn' : 'info',
          text: `  → ${update.verdict.verdict} (${(update.verdict.confidence * 100).toFixed(0)}%) — ${update.verdict.rationale}`,
        });
        break;
      case 'budget-status':
        this.post({ type: 'budget', spentUsd: update.spentUsd, budgetUsd: update.budgetUsd, iterations: update.iterations, maxIterations: update.maxIterations });
        break;
      case 'checkpoint-resolved':
        this.post({ type: 'clearDecision' });
        this.post({ type: 'log', level: update.approved ? 'info' : 'warn', text: update.approved ? '  checkpoint approved' : '  checkpoint declined — stopping' });
        break;
      case 'blocked':
        this.post({ type: 'log', level: 'warn', text: `⛔ Blocked — ${update.blocker.title}. ${update.blocker.detail} Awaiting your decision…` });
        break;
      case 'error':
        this.post({ type: 'log', level: 'error', text: update.message });
        break;
      default:
        break;
    }
  }

  private buildHtml(): string {
    const cfg = vscode.workspace.getConfiguration('atlasmind');
    const d = {
      maxIterations: cfg.get<number>('loop.defaultMaxIterations', DEFAULT_MISSION_MAX_ITERATIONS),
      maxCostUsd: cfg.get<number>('loop.defaultMaxCostUsd', DEFAULT_MISSION_MAX_COST_USD),
      maxTokens: cfg.get<number>('loop.defaultMaxTokens', DEFAULT_MISSION_MAX_TOKENS),
      maxDurationMinutes: cfg.get<number>('loop.defaultMaxDurationMinutes', 30),
      maxConsecutiveNoProgress: cfg.get<number>('loop.maxConsecutiveNoProgress', DEFAULT_MISSION_MAX_NO_PROGRESS),
      everyN: cfg.get<number>('loop.checkpointEveryNIterations', DEFAULT_MISSION_CHECKPOINT_EVERY_N),
      budgetFraction: cfg.get<number>('loop.checkpointAtBudgetFraction', DEFAULT_MISSION_CHECKPOINT_BUDGET_FRACTION),
      beforeWrite: cfg.get<boolean>('loop.requireApprovalBeforeWriteBatches', false),
      allowDiscovery: cfg.get<boolean>('loop.allowDiscovery', true),
    };

    // Cost cap is stored USD-canonical but shown/entered in the user's display currency.
    const currency = getDisplayCurrency();
    const fxRate = getExchangeRate(currency);
    const costDisplay = formatPlainNumber(d.maxCostUsd * fxRate, 2);
    const tokensDisplay = Math.round(d.maxTokens).toLocaleString('en-US');

    const body = /* html */ `
      <h1>Mission Control</h1>
      <p class="muted">Define a goal and a closed parameter envelope, then let AtlasMind loop autonomously toward it — planning, executing, and re-evaluating progress each iteration until the goal is met or a guardrail confines progress.</p>

      <section>
        <h2>Goal</h2>
        <textarea id="goal" rows="3" placeholder="Describe the objective the loop should work toward…"></textarea>
        <label for="criteria">Success criteria (definition of done — one per line, optional)</label>
        <textarea id="criteria" rows="3" placeholder="e.g. all new tests pass&#10;README updated"></textarea>
      </section>

      <section>
        <h2>Guardrails</h2>
        <label for="guardrails">Rules to respect (one per line)</label>
        <textarea id="guardrails" rows="3" placeholder="e.g. do not modify the auth module&#10;no breaking API changes"></textarea>
        <label for="protected">Protected paths — never modify (one per line)</label>
        <textarea id="protected" rows="2" placeholder="e.g. src/auth/&#10;.github/workflows/"></textarea>
      </section>

      <section>
        <h2>Closed parameter envelope (hard stops)</h2>
        <div class="grid">
          <label>Max iterations<input id="maxIterations" type="number" min="1" max="50" value="${escapeHtml(String(d.maxIterations))}" /></label>
          <label>Cost cap (${escapeHtml(currency)})<input id="maxCostUsd" type="number" min="0.01" step="0.5" value="${escapeHtml(costDisplay)}" /></label>
          <label>Token cap<input id="maxTokens" type="text" inputmode="numeric" autocomplete="off" value="${escapeHtml(tokensDisplay)}" /></label>
          <label>Time cap (min)<input id="maxDuration" type="number" min="1" value="${escapeHtml(String(d.maxDurationMinutes))}" /></label>
          <label>No-progress stop<input id="maxNoProgress" type="number" min="1" max="10" value="${escapeHtml(String(d.maxConsecutiveNoProgress))}" /></label>
        </div>
      </section>

      <section>
        <h2>Checkpoints &amp; autonomy</h2>
        <div class="grid">
          <label>Checkpoint every N iters (0 = off)<input id="everyN" type="number" min="0" max="50" value="${escapeHtml(String(d.everyN))}" /></label>
          <label>Checkpoint at budget fraction<input id="budgetFraction" type="number" min="0.01" max="1" step="0.05" value="${escapeHtml(String(d.budgetFraction))}" /></label>
        </div>
        <label class="check"><input id="beforeWrite" type="checkbox" ${d.beforeWrite ? 'checked' : ''} /> Require approval before write/commit batches</label>
        <label class="check"><input id="allowDiscovery" type="checkbox" ${d.allowDiscovery ? 'checked' : ''} /> Allow capability discovery (synthesis + ARD, gated)</label>
      </section>

      <section>
        <button id="launch">Launch mission</button>
        <button id="stop" disabled>Stop</button>
        <span id="budgetBadge" class="badge" style="display:none"></span>
      </section>

      <section id="decisionBox" style="display:none">
        <h2 id="decisionTitle">Decision required</h2>
        <p id="decisionText"></p>
        <div id="decisionActions" class="decision-actions"></div>
      </section>

      <section>
        <h2>Activity</h2>
        <div id="log" class="log"></div>
      </section>

      <section>
        <h2>Recent missions</h2>
        <div id="missions"></div>
      </section>
    `;

    const script = /* js */ `
      const vscode = acquireVsCodeApi();
      const $ = (id) => document.getElementById(id);
      const lines = (id) => $(id).value.split('\\n').map(s => s.trim()).filter(Boolean);
      const digitsOf = (id) => Number(($(id).value || '').replace(/[^0-9]/g, ''));

      // Keep the token cap readable with a thousands separator.
      const tokenField = $('maxTokens');
      if (tokenField) {
        const reformatTokens = () => {
          const n = digitsOf('maxTokens');
          if (Number.isFinite(n) && n > 0) { tokenField.value = n.toLocaleString('en-US'); }
        };
        tokenField.addEventListener('blur', reformatTokens);
      }

      $('launch').addEventListener('click', () => {
        const goal = $('goal').value.trim();
        if (!goal) { return; }
        vscode.postMessage({
          type: 'launch',
          goal,
          successCriteria: lines('criteria'),
          guardrails: lines('guardrails'),
          protectedPaths: lines('protected'),
          budget: {
            maxIterations: Number($('maxIterations').value),
            maxCostUsd: Number($('maxCostUsd').value),
            maxTokens: digitsOf('maxTokens'),
            maxDurationMinutes: Number($('maxDuration').value),
            maxConsecutiveNoProgress: Number($('maxNoProgress').value),
          },
          checkpoint: {
            everyNIterations: Number($('everyN').value),
            atBudgetFraction: Number($('budgetFraction').value),
            beforeWriteBatches: $('beforeWrite').checked,
          },
          allowDiscovery: $('allowDiscovery').checked,
        });
      });
      $('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));

      function clearDecision() {
        $('decisionActions').textContent = '';
        $('decisionBox').style.display = 'none';
      }

      function renderDecision(payload) {
        if (!payload || !Array.isArray(payload.options)) { return; }
        $('decisionTitle').textContent = payload.title || 'Decision required';
        $('decisionText').textContent = payload.detail || '';
        const actions = $('decisionActions');
        actions.textContent = '';
        payload.options.forEach((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          if (option.kind === 'danger') { button.classList.add('danger'); }
          button.textContent = option.label;
          button.addEventListener('click', () => {
            vscode.postMessage({ type: 'decisionResponse', id: payload.id, choice: option.id });
            clearDecision();
          });
          actions.appendChild(button);
        });
        $('decisionBox').style.display = 'block';
      }

      function appendLog(level, text) {
        const el = document.createElement('div');
        el.className = 'log-line log-' + level;
        el.textContent = text;
        const log = $('log');
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
      }

      function renderMissions(items) {
        const root = $('missions');
        root.textContent = '';
        if (!items || items.length === 0) {
          const p = document.createElement('p');
          p.className = 'muted';
          p.textContent = 'No missions yet.';
          root.appendChild(p);
          return;
        }
        for (const m of items) {
          const row = document.createElement('div');
          row.className = 'mission-row';
          const title = document.createElement('strong');
          title.textContent = (m.achieved ? '✅ ' : '⏹️ ') + m.goal;
          const meta = document.createElement('div');
          meta.className = 'muted';
          meta.textContent = m.status + (m.stopReason ? ' · ' + m.stopReason : '') + ' · ' + m.iterations + '/' + m.maxIterations + ' iters · $' + (m.costUsd || 0).toFixed(4);
          row.appendChild(title);
          row.appendChild(meta);
          root.appendChild(row);
        }
      }

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg.type !== 'string') { return; }
        switch (msg.type) {
          case 'state':
            $('launch').disabled = msg.running;
            $('stop').disabled = !msg.running;
            break;
          case 'log':
            appendLog(msg.level || 'info', msg.text || '');
            break;
          case 'budget': {
            const badge = $('budgetBadge');
            badge.style.display = 'inline-block';
            badge.textContent = 'Spent $' + (msg.spentUsd || 0).toFixed(4) + ' / $' + (msg.budgetUsd || 0).toFixed(2) + ' · iter ' + msg.iterations + '/' + msg.maxIterations;
            break;
          }
          case 'decision':
            renderDecision(msg.payload);
            break;
          case 'clearDecision':
            clearDecision();
            break;
          case 'done':
            appendLog(msg.achieved ? 'success' : 'warn', (msg.achieved ? '✅ Mission complete' : '⏹️ Mission stopped') + ' (' + msg.stopReason + ') · ' + msg.iterations + ' iteration(s) · $' + (msg.costUsd || 0).toFixed(4));
            if (msg.summary) { appendLog('muted', msg.summary); }
            break;
          case 'missions':
            renderMissions(msg.items);
            break;
        }
      });

      vscode.postMessage({ type: 'refresh' });
    `;

    const extraCss = `
      textarea, input[type="number"] { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 3px; padding: 6px; font-family: inherit; margin: 4px 0 10px; }
      label { display: block; font-size: 0.9em; margin-top: 6px; }
      label.check { display: flex; align-items: center; gap: 6px; }
      label.check input { width: auto; margin: 0; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0 16px; }
      .grid label input { margin-top: 2px; }
      .muted { color: var(--vscode-descriptionForeground); }
      .log { max-height: 320px; overflow-y: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1)); border-radius: 4px; padding: 8px; }
      .log-line { white-space: pre-wrap; padding: 1px 0; }
      .log-error { color: var(--vscode-errorForeground, #f14c4c); }
      .log-warn { color: var(--vscode-editorWarning-foreground, #cca700); }
      .log-success { color: var(--vscode-testing-iconPassed, #4caf50); }
      .log-muted { color: var(--vscode-descriptionForeground); }
      .mission-row { padding: 6px 0; border-bottom: 1px solid var(--vscode-widget-border, #444); }
      #decisionBox { border: 1px solid var(--vscode-editorWarning-foreground, #cca700); border-radius: 4px; padding: 10px; }
      .decision-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .decision-actions button.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-inputValidation-errorForeground, #fff); }
    `;

    return getWebviewHtmlShell({
      title: 'AtlasMind – Mission Control',
      bodyContent: body,
      cspSource: this.panel.webview.cspSource,
      scriptContent: script,
      extraCss,
    });
  }
}

/** Format a number with up to `decimals` places, trimming trailing zeros (e.g. 5.00 → "5"). */
function formatPlainNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function coerceBudgetMode(value: string | undefined): BudgetMode {
  return value === 'cheap' || value === 'balanced' || value === 'expensive' || value === 'auto' ? value : 'auto';
}

function coerceSpeedMode(value: string | undefined): SpeedMode {
  return value === 'fast' || value === 'balanced' || value === 'considered' || value === 'auto' ? value : 'auto';
}

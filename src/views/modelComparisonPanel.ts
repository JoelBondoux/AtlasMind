import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import {
  buildModelJudgePrompt,
  compareModelsOnPrompt,
  parseModelJudgeVerdicts,
  type ModelEvalJudgeEntry,
  type ModelEvalJudgeVerdict,
  type ModelEvalResult,
} from '../core/modelEvalHarness.js';

interface RunComparisonMessage {
  type: 'run';
  prompt: string;
  modelIds: string[];
  judge?: boolean;
  judgeModelId?: string;
}

interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  enabled: boolean;
  /** Active struggle de-weight for this model (worst task signature), if any. */
  struggle?: { label: string; tooltip: string };
}

/** Turns a struggle signature key (`phase|modality|reasoning|t`) into a short human label. */
function humanizeStruggleSignature(signature: string): string {
  if (signature === 'all') {
    return 'all tasks';
  }
  const [phase, modality, reasoning, tools] = signature.split('|');
  const parts = [phase, reasoning].filter(Boolean);
  if (modality && modality !== 'text') {
    parts.push(modality);
  }
  if (tools === 't') {
    parts.push('tools');
  }
  return parts.join(' · ');
}

/** Result row sent to the webview for client-side sortable rendering. */
interface ComparisonRow {
  modelId: string;
  completion: number;
  judgeScore: number | null;
  judgeRationale: string | null;
  costUsd: number;
  latencyMs: number;
  outputTokens: number;
  preview: string;
  error: string | null;
}

/** A few ready-made prompts that exercise different model strengths. */
const DEMO_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Reasoning puzzle',
    prompt:
      'Three friends — Ana, Ben, and Cleo — each own a different pet (cat, dog, fish) and live in a different coloured house (red, green, blue). Ana does not live in the red house. The dog owner lives in the green house. Cleo owns the fish. Ben does not live in the blue house. Who owns which pet, and what colour is each house? Explain your reasoning step by step.',
  },
  {
    label: 'Code generation',
    prompt:
      'Write a TypeScript function `debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number): T` that returns a debounced version of `fn`. It must preserve `this`, coalesce rapid calls, and only invoke `fn` once calls stop for `waitMs`. Include a brief docstring and one usage example.',
  },
  {
    label: 'Summarize & extract',
    prompt:
      'Summarize the following note in exactly three bullet points, then list any action items as a checklist:\n\n"Met with the platform team. They are blocked on the auth migration until we ship the new token-refresh endpoint, targeted for next sprint. Marketing wants the changelog updated before the launch on the 30th. We also agreed to drop the legacy SAML path once analytics confirm under 1% usage."',
  },
];

/** Characters of each answer retained — long enough to feed a judge meaningfully. */
const COMPARISON_PREVIEW_CHARS = 2000;

/**
 * Webview surface for the model-eval harness (`compareModelsOnPrompt`). Lets the
 * user enter a prompt, pick models grouped by provider, run them, and view a
 * sortable quality/cost/latency comparison. Graded outcomes are recorded into
 * the router so the benchmark also calibrates outcome-driven routing.
 *
 * Only models from providers the user has configured (credentials present) are
 * offered. An optional LLM judge scores each answer 0–100 so the comparison has
 * a discriminating answer-quality signal beyond the coarse completion grade.
 *
 * Security:
 * - All dynamic content is escaped through escapeHtml() (or built via DOM
 *   textContent in the webview) before injection.
 * - Webview messages are validated before acting (only `run` is honored).
 * - CSP is nonce-protected via getWebviewHtmlShell().
 */
export class ModelComparisonPanel {
  public static current: ModelComparisonPanel | undefined;
  private static readonly viewType = 'atlasmind.modelComparison';
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private running = false;
  private activeRun: AbortController | undefined;
  private configuredModels: AvailableModel[] = [];

  public static createOrShow(atlas: AtlasMindContext | undefined): void {
    if (!atlas) {
      void vscode.window.showErrorMessage('AtlasMind is not ready yet.');
      return;
    }
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (ModelComparisonPanel.current) {
      ModelComparisonPanel.current.panel.reveal(column);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      ModelComparisonPanel.viewType,
      'AtlasMind: Compare Models',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    ModelComparisonPanel.current = new ModelComparisonPanel(panel, atlas);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly atlas: AtlasMindContext) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.handleMessage(message); }, null, this.disposables);
    // Provider-configured checks are async; render the shell once they resolve.
    void this.render();
  }

  private async render(): Promise<void> {
    this.configuredModels = await this.computeConfiguredModels();
    this.panel.webview.html = this.getHtml();
  }

  /**
   * Returns every model that belongs to a provider the user has configured with
   * credentials — mirroring the Models tree, which lists all of a configured
   * provider's models (not just the routing-enabled ones). Provider-configured
   * checks run in parallel so opening the panel stays fast.
   */
  private async computeConfiguredModels(): Promise<AvailableModel[]> {
    const providers = this.atlas.modelRouter.listProviders();
    const configuredFlags = await Promise.all(
      providers.map(async provider => {
        try {
          return await this.atlas.isProviderConfigured(provider.id);
        } catch {
          return false;
        }
      }),
    );
    // Worst active struggle de-weight per model, for the "de-weighted" hint.
    const struggleByModel = new Map<string, { label: string; tooltip: string }>();
    for (const entry of this.atlas.modelRouter.getStruggleSummary()) {
      if (struggleByModel.has(entry.modelId)) {
        continue; // summary is sorted by penalty desc — first per model is the worst
      }
      const signature = humanizeStruggleSignature(entry.signature);
      struggleByModel.set(entry.modelId, {
        label: `de-weighted: ${signature}`,
        tooltip: `Routing is de-weighting this model for ${signature} tasks — ${entry.hits} struggle${entry.hits === 1 ? '' : 's'} recorded (most recent: ${entry.lastKind.replace(/-/g, ' ')}). The penalty decays over ~2.5 days and lifts as the model succeeds.`,
      });
    }
    return providers
      .filter((_, index) => configuredFlags[index])
      .flatMap(provider =>
        provider.models.map(model => ({
          id: model.id,
          name: model.name,
          providerId: provider.id,
          providerName: provider.displayName,
          enabled: model.enabled,
          struggle: struggleByModel.get(model.id),
        })),
      )
      .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.id.localeCompare(b.id));
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'run') {
      return;
    }
    const payload = message as RunComparisonMessage;
    if (this.running) {
      return;
    }
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    const known = new Set(this.configuredModels.map(model => model.id));
    const modelIds = Array.isArray(payload.modelIds)
      ? payload.modelIds.filter((id): id is string => typeof id === 'string' && known.has(id))
      : [];

    if (!prompt) {
      void this.panel.webview.postMessage({ type: 'error', text: 'Enter a prompt first.' });
      return;
    }
    if (modelIds.length < 2) {
      void this.panel.webview.postMessage({ type: 'error', text: 'Select at least two configured models to compare.' });
      return;
    }

    const judgeRequested = payload.judge === true;
    const judgeModelId = typeof payload.judgeModelId === 'string' && known.has(payload.judgeModelId)
      ? payload.judgeModelId
      : undefined;
    if (judgeRequested && !judgeModelId) {
      void this.panel.webview.postMessage({ type: 'error', text: 'Pick a configured judge model to grade answer quality.' });
      return;
    }

    this.running = true;
    this.activeRun = new AbortController();
    const statusText = judgeModelId
      ? `Running ${modelIds.length} models, then grading with the judge…`
      : `Running ${modelIds.length} models…`;
    void this.panel.webview.postMessage({ type: 'status', text: statusText });
    try {
      const results = await compareModelsOnPrompt(
        prompt,
        modelIds,
        async (modelId, body, signal) => this.runModel(modelId, body, signal),
        {
          signal: this.activeRun.signal,
          previewChars: COMPARISON_PREVIEW_CHARS,
          estimateCostUsd: (modelId, inputTokens, outputTokens) => {
            const info = this.atlas.modelRouter.getModelInfo(modelId);
            if (!info) { return 0; }
            return ((inputTokens / 1000) * info.inputPricePer1k) + ((outputTokens / 1000) * info.outputPricePer1k);
          },
          onResult: (modelId, quality) => this.atlas.modelRouter.recordExecutionOutcome(modelId, quality),
          judge: judgeModelId ? (judgePrompt, entries, signal) => this.judgeAnswers(judgeModelId, judgePrompt, entries, signal) : undefined,
        },
      );
      void this.panel.webview.postMessage({
        type: 'results',
        judged: Boolean(judgeModelId),
        rows: results.map(result => this.toRow(result)),
      });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
      this.activeRun = undefined;
    }
  }

  /** Runs a single model completion through its provider adapter. */
  private async runModel(modelId: string, body: string, signal?: AbortSignal) {
    const info = this.atlas.modelRouter.getModelInfo(modelId);
    const providerId = info?.provider ?? modelId.split('/')[0] ?? 'local';
    const provider = this.atlas.providerRegistry.get(providerId);
    if (!provider) {
      throw new Error(`No provider adapter registered for "${providerId}".`);
    }
    return provider.complete({
      model: modelId,
      temperature: 0.2,
      maxTokens: 1024,
      messages: [{ role: 'user', content: body }],
      signal,
    });
  }

  /** Grades the collected answers with the chosen judge model. */
  private async judgeAnswers(
    judgeModelId: string,
    prompt: string,
    entries: ModelEvalJudgeEntry[],
    signal?: AbortSignal,
  ): Promise<Map<string, ModelEvalJudgeVerdict>> {
    const info = this.atlas.modelRouter.getModelInfo(judgeModelId);
    const providerId = info?.provider ?? judgeModelId.split('/')[0] ?? 'local';
    const provider = this.atlas.providerRegistry.get(providerId);
    if (!provider) {
      throw new Error(`No provider adapter registered for judge "${providerId}".`);
    }
    const completion = await provider.complete({
      model: judgeModelId,
      temperature: 0,
      maxTokens: 1200,
      messages: [{ role: 'user', content: buildModelJudgePrompt(prompt, entries) }],
      signal,
    });
    return parseModelJudgeVerdicts(completion.content, entries);
  }

  private toRow(result: ModelEvalResult): ComparisonRow {
    return {
      modelId: result.modelId,
      completion: result.quality,
      judgeScore: typeof result.judgeScore === 'number' ? result.judgeScore : null,
      judgeRationale: result.judgeRationale ?? null,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      outputTokens: result.outputTokens,
      preview: result.contentPreview,
      error: result.error ?? null,
    };
  }

  private getHtml(): string {
    const models = this.configuredModels;

    let modelPicker: string;
    let judgeOptions = '';
    if (models.length === 0) {
      modelPicker = '<div class="dashboard-empty">No configured models are available. Add provider credentials in <strong>Model Providers</strong>, then reopen this panel.</div>';
    } else {
      const groups = new Map<string, AvailableModel[]>();
      for (const model of models) {
        const list = groups.get(model.providerName) ?? [];
        list.push(model);
        groups.set(model.providerName, list);
      }
      const groupHtml = Array.from(groups.entries()).map(([providerName, providerModels]) => {
        const rows = providerModels.map(model => {
          const disabledTag = model.enabled ? '' : ' <span class="muted-tag">disabled</span>';
          const struggleTag = model.struggle
            ? ` <span class="struggle-tag" title="${escapeHtml(model.struggle.tooltip)}">${escapeHtml(model.struggle.label)}</span>`
            : '';
          return `<label class="model-pick"><input type="checkbox" class="model-cb" data-provider="${escapeHtml(providerName)}" value="${escapeHtml(model.id)}" /> <code>${escapeHtml(model.id)}</code> <span class="badge">${escapeHtml(model.name)}</span>${disabledTag}${struggleTag}</label>`;
        }).join('');
        return `<details class="provider-group">
          <summary>
            <input type="checkbox" class="provider-cb" data-provider="${escapeHtml(providerName)}" title="Select all in ${escapeHtml(providerName)}" />
            <span class="provider-name">${escapeHtml(providerName)}</span>
            <span class="provider-count">${providerModels.length} model${providerModels.length === 1 ? '' : 's'}</span>
          </summary>
          <div class="provider-models">${rows}</div>
        </details>`;
      }).join('');
      modelPicker = `
        <div class="picker-toolbar">
          <label class="select-all"><input type="checkbox" id="select-all" /> <strong>Select all (${models.length})</strong></label>
          <span class="selected-count" id="selected-count">0 selected</span>
        </div>
        <div class="model-list">${groupHtml}</div>`;

      const judgeChoices = models.map(model =>
        `<option value="${escapeHtml(model.id)}">${escapeHtml(model.providerName)} — ${escapeHtml(model.id)}</option>`,
      ).join('');
      judgeOptions = `
        <div class="judge-row">
          <label class="judge-toggle"><input type="checkbox" id="judge-enabled" /> <strong>Grade answer quality with a judge model</strong></label>
          <select id="judge-model" disabled>${judgeChoices}</select>
        </div>
        <p class="judge-hint">When on, after the models answer, the judge scores each response 0–100 for correctness, completeness, and usefulness (extra tokens are spent on the judge model).</p>`;
    }

    const demoButtons = DEMO_PROMPTS.map((demo, index) =>
      `<button type="button" class="demo-chip" data-demo-index="${index}">${escapeHtml(demo.label)}</button>`,
    ).join('');

    const runDisabled = models.length === 0 ? 'disabled' : '';

    const body = `
      <div class="dashboard-shell compare-shell">
        <div class="dashboard-topbar">
          <div>
            <p class="dashboard-kicker">Model lab</p>
            <h1>Compare Models</h1>
            <p class="dashboard-copy">Run one prompt across the models you have credentials for and compare answer quality, cost, and latency side by side. Every run also feeds the outcome-driven routing channel, so benchmarking here makes routing smarter.</p>
          </div>
        </div>

        <article class="compare-card">
          <div class="card-header-row">
            <div>
              <p class="card-kicker">Prompt</p>
              <h2>What should the models answer?</h2>
            </div>
          </div>
          <div class="demo-row">
            <span class="demo-row-label">Try a sample:</span>
            ${demoButtons}
          </div>
          <textarea id="prompt" rows="6" placeholder="Enter a prompt to run across the selected models…"></textarea>
        </article>

        <article class="compare-card">
          <div class="card-header-row">
            <div>
              <p class="card-kicker">Models</p>
              <h2>Pick two or more to compare</h2>
            </div>
          </div>
          ${modelPicker}
          ${judgeOptions}
        </article>

        <div class="run-bar">
          <button id="run" type="button" class="dashboard-button dashboard-button-solid" ${runDisabled}>Run comparison</button>
          <span id="status" class="run-status"></span>
        </div>

        <article class="compare-card">
          <div class="card-header-row">
            <div>
              <p class="card-kicker">Results</p>
              <h2>Ranked comparison</h2>
            </div>
          </div>
          <p class="legend"><strong>Completion</strong> grades whether the response came back cleanly (error 0 · empty 0.2 · truncated 0.6 · clean 1.0) — it is not answer quality. Enable the judge above for a 0–100 <strong>Quality</strong> score. Click any column header to sort.</p>
          <div id="results"><div class="dashboard-empty">Results will appear here. Run a comparison to populate the table.</div></div>
        </article>
      </div>`;

    const script = `
      const vscode = acquireVsCodeApi();
      const DEMO_PROMPTS = ${JSON.stringify(DEMO_PROMPTS.map(demo => demo.prompt)).replace(/</g, '\\u003c')};
      const runBtn = document.getElementById('run');
      const statusEl = document.getElementById('status');
      const resultsEl = document.getElementById('results');
      const promptEl = document.getElementById('prompt');
      const selectAll = document.getElementById('select-all');
      const countEl = document.getElementById('selected-count');
      const judgeEnabled = document.getElementById('judge-enabled');
      const judgeModel = document.getElementById('judge-model');
      const checkboxes = () => Array.from(document.querySelectorAll('.model-cb'));

      let lastRows = [];
      let lastJudged = false;
      let sortKey = null;
      let sortDir = 'desc';

      function updateCount() {
        if (!countEl) { return; }
        const all = checkboxes();
        const picked = all.filter((cb) => cb.checked).length;
        countEl.textContent = picked + ' selected';
        if (selectAll) {
          selectAll.checked = all.length > 0 && picked === all.length;
          selectAll.indeterminate = picked > 0 && picked < all.length;
        }
        document.querySelectorAll('.provider-cb').forEach((pcb) => {
          const provider = pcb.getAttribute('data-provider');
          const group = all.filter((cb) => cb.getAttribute('data-provider') === provider);
          const on = group.filter((cb) => cb.checked).length;
          pcb.checked = group.length > 0 && on === group.length;
          pcb.indeterminate = on > 0 && on < group.length;
        });
      }

      if (selectAll) {
        selectAll.addEventListener('change', () => {
          checkboxes().forEach((cb) => { cb.checked = selectAll.checked; });
          updateCount();
        });
      }
      document.querySelectorAll('.provider-cb').forEach((pcb) => {
        pcb.addEventListener('click', (e) => { e.stopPropagation(); });
        pcb.addEventListener('change', () => {
          const provider = pcb.getAttribute('data-provider');
          checkboxes().filter((cb) => cb.getAttribute('data-provider') === provider)
            .forEach((cb) => { cb.checked = pcb.checked; });
          updateCount();
        });
      });
      checkboxes().forEach((cb) => cb.addEventListener('change', updateCount));

      if (judgeEnabled && judgeModel) {
        judgeEnabled.addEventListener('change', () => { judgeModel.disabled = !judgeEnabled.checked; });
      }

      document.querySelectorAll('.demo-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const index = Number(chip.getAttribute('data-demo-index'));
          if (!Number.isNaN(index) && DEMO_PROMPTS[index] != null && promptEl) {
            promptEl.value = DEMO_PROMPTS[index];
            promptEl.focus();
          }
        });
      });

      runBtn.addEventListener('click', () => {
        const prompt = promptEl ? promptEl.value : '';
        const modelIds = checkboxes().filter((cb) => cb.checked).map((cb) => cb.value);
        const judge = !!(judgeEnabled && judgeEnabled.checked);
        statusEl.textContent = '';
        vscode.postMessage({
          type: 'run',
          prompt: prompt,
          modelIds: modelIds,
          judge: judge,
          judgeModelId: judge && judgeModel ? judgeModel.value : undefined,
        });
      });

      function num(value) { return value == null ? -Infinity : value; }

      function sortedRows() {
        if (!sortKey) { return lastRows.slice(); }
        const rows = lastRows.slice();
        rows.sort((a, b) => {
          let av; let bv;
          if (sortKey === 'modelId') { av = a.modelId; bv = b.modelId; return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); }
          av = num(a[sortKey]); bv = num(b[sortKey]);
          return sortDir === 'asc' ? av - bv : bv - av;
        });
        return rows;
      }

      function fmtCost(v) { return '$' + Number(v).toFixed(5); }

      function renderTable() {
        resultsEl.innerHTML = '';
        if (lastRows.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'dashboard-empty';
          empty.textContent = 'No results.';
          resultsEl.appendChild(empty);
          return;
        }
        const cols = [
          { key: null, label: '#', sortable: false },
          { key: 'modelId', label: 'Model', sortable: true },
        ];
        if (lastJudged) { cols.push({ key: 'judgeScore', label: 'Quality', sortable: true, numeric: true }); }
        cols.push({ key: 'completion', label: 'Completion', sortable: true, numeric: true });
        cols.push({ key: 'costUsd', label: 'Cost', sortable: true, numeric: true });
        cols.push({ key: 'latencyMs', label: 'Latency', sortable: true, numeric: true });
        cols.push({ key: 'outputTokens', label: 'Tokens', sortable: true, numeric: true });
        cols.push({ key: null, label: 'Output preview', sortable: false });

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        cols.forEach((col) => {
          const th = document.createElement('th');
          th.textContent = col.label;
          if (col.numeric) { th.classList.add('numeric'); }
          if (col.sortable) {
            th.classList.add('sortable');
            if (sortKey === col.key) { th.setAttribute('data-sort-dir', sortDir); }
            th.addEventListener('click', () => {
              if (sortKey === col.key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
              else { sortKey = col.key; sortDir = col.numeric ? 'desc' : 'asc'; }
              renderTable();
            });
          }
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        sortedRows().forEach((row, index) => {
          const tr = document.createElement('tr');
          const addCell = (text, cls) => {
            const td = document.createElement('td');
            td.textContent = text;
            if (cls) { td.className = cls; }
            return td;
          };
          tr.appendChild(addCell(index === 0 ? '★ 1' : String(index + 1), index === 0 ? 'rank-top' : ''));
          const modelTd = addCell(row.modelId);
          modelTd.classList.add('model-id');
          tr.appendChild(modelTd);
          if (row.error) {
            if (lastJudged) { tr.appendChild(addCell('—', 'numeric')); }
            tr.appendChild(addCell('—', 'numeric'));
            const errTd = document.createElement('td');
            errTd.className = 'err';
            errTd.colSpan = 3;
            errTd.textContent = 'Error: ' + row.error;
            tr.appendChild(errTd);
            tbody.appendChild(tr);
            return;
          }
          if (lastJudged) {
            const q = addCell(row.judgeScore == null ? '—' : String(row.judgeScore), 'numeric quality');
            if (row.judgeRationale) { q.title = row.judgeRationale; }
            tr.appendChild(q);
          }
          tr.appendChild(addCell(row.completion.toFixed(2), 'numeric'));
          tr.appendChild(addCell(fmtCost(row.costUsd), 'numeric'));
          tr.appendChild(addCell(row.latencyMs + ' ms', 'numeric'));
          tr.appendChild(addCell(String(row.outputTokens), 'numeric'));
          tr.appendChild(addCell(row.preview, 'preview'));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        wrap.appendChild(table);
        resultsEl.appendChild(wrap);

        const note = document.createElement('p');
        note.className = 'comparison-note';
        note.textContent = lastJudged
          ? 'Ranked by judge quality, then cost. Completion grades and graded outcomes were recorded to calibrate routing.'
          : 'Ranked by completion grade, then cost. Graded outcomes were recorded to calibrate outcome-driven routing.';
        resultsEl.appendChild(note);
      }

      window.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'status') { statusEl.textContent = message.text; statusEl.className = 'run-status busy'; runBtn.disabled = true; }
        else if (message.type === 'error') { statusEl.textContent = message.text; statusEl.className = 'run-status err'; runBtn.disabled = false; }
        else if (message.type === 'results') {
          statusEl.textContent = 'Done.';
          statusEl.className = 'run-status ok';
          runBtn.disabled = false;
          lastRows = Array.isArray(message.rows) ? message.rows : [];
          lastJudged = !!message.judged;
          sortKey = null;
          sortDir = 'desc';
          renderTable();
        }
      });

      updateCount();`;

    const extraCss = `
      body { background: radial-gradient(circle at top, color-mix(in srgb, var(--vscode-focusBorder, #0e639c) 12%, transparent) 0%, transparent 38%), linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%) 0%, var(--vscode-editor-background) 100%); }
      .compare-shell { display: flex; flex-direction: column; gap: 18px; padding: 10px 8px 24px; }
      .dashboard-topbar { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
      .dashboard-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.72rem; color: var(--vscode-descriptionForeground); }
      .dashboard-topbar h1 { margin: 0; font-size: 2rem; line-height: 1.05; }
      .dashboard-copy { margin: 8px 0 0; max-width: 78ch; color: var(--vscode-descriptionForeground); line-height: 1.5; }
      .compare-card { padding: 16px 18px; border-radius: 18px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); }
      .card-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
      .card-kicker { margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.7rem; color: var(--vscode-descriptionForeground); }
      .card-header-row h2 { margin: 0; font-size: 1.05rem; }
      textarea { width: 100%; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9rem; padding: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 12px; resize: vertical; }
      .demo-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
      .demo-row-label { font-size: 0.8rem; color: var(--vscode-descriptionForeground); }
      .demo-chip { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 80%, transparent); background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 90%, transparent); color: var(--vscode-foreground); padding: 6px 12px; font: inherit; font-size: 0.8rem; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease; }
      .demo-chip:hover { transform: translateY(-1px); border-color: var(--vscode-focusBorder, var(--vscode-button-background)); }
      .picker-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
      .select-all { cursor: pointer; }
      .selected-count { font-size: 0.8rem; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
      .model-list { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; scrollbar-width: thin; padding: 4px 2px; }
      .provider-group { border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 50%, transparent); border-radius: 12px; overflow: hidden; }
      .provider-group > summary { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; list-style: none; background: color-mix(in srgb, var(--vscode-editor-background) 50%, transparent); }
      .provider-group > summary::-webkit-details-marker { display: none; }
      .provider-group > summary::before { content: '▸'; color: var(--vscode-descriptionForeground); transition: transform 120ms ease; }
      .provider-group[open] > summary::before { transform: rotate(90deg); }
      .provider-name { font-weight: 600; }
      .provider-count { font-size: 0.75rem; color: var(--vscode-descriptionForeground); }
      .provider-models { display: flex; flex-direction: column; gap: 2px; padding: 6px 12px 10px 30px; }
      .model-pick { cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; }
      .model-pick:hover { background: color-mix(in srgb, var(--vscode-list-hoverBackground, transparent) 90%, transparent); }
      .muted-tag { font-size: 0.7rem; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-widget-border, #444) 60%, transparent); color: var(--vscode-descriptionForeground); }
      .struggle-tag { font-size: 0.7rem; padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 22%, transparent); color: var(--vscode-editorWarning-foreground, #cca700); border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 45%, transparent); cursor: help; white-space: nowrap; }
      .judge-row { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
      .judge-toggle { cursor: pointer; }
      #judge-model { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 8px; padding: 6px 8px; max-width: 100%; }
      #judge-model:disabled { opacity: 0.5; }
      .judge-hint { margin: 6px 0 0; font-size: 0.78rem; color: var(--vscode-descriptionForeground); }
      .run-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .dashboard-button { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 88%, transparent); padding: 10px 18px; font: inherit; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
      .dashboard-button:hover:not(:disabled) { transform: translateY(-1px); }
      .dashboard-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .dashboard-button-solid { background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 94%, white 6%), color-mix(in srgb, var(--vscode-button-background) 70%, black 14%)); color: var(--vscode-button-foreground); border-color: color-mix(in srgb, var(--vscode-button-background) 65%, white 8%); }
      .run-status { font-size: 0.85rem; opacity: 0.9; }
      .run-status.busy { color: var(--vscode-descriptionForeground); }
      .run-status.ok { color: var(--vscode-testing-iconPassed, #4ec9b0); }
      .run-status.err { color: var(--vscode-errorForeground, #f14c4c); }
      .legend { margin: 0 0 12px; font-size: 0.8rem; color: var(--vscode-descriptionForeground); line-height: 1.5; }
      .table-wrap { overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); vertical-align: top; }
      th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); }
      th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
      th.sortable::after { content: ' ↕'; opacity: 0.45; }
      th.sortable[data-sort-dir='asc']::after { content: ' ↑'; opacity: 0.9; }
      th.sortable[data-sort-dir='desc']::after { content: ' ↓'; opacity: 0.9; }
      td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }
      td.quality { font-weight: 600; color: var(--vscode-notificationsInfoIcon-foreground, #4ec9b0); }
      td.model-id { font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap; }
      td.preview { max-width: 420px; opacity: 0.9; white-space: pre-wrap; max-height: 7.5em; overflow-y: auto; }
      td.err { color: var(--vscode-errorForeground, #f14c4c); }
      td.rank-top { color: var(--vscode-notificationsInfoIcon-foreground, #4ec9b0); font-weight: 600; white-space: nowrap; }
      .comparison-note { margin-top: 12px; font-size: 0.78rem; color: var(--vscode-descriptionForeground); }
      .dashboard-empty { padding: 24px; border-radius: 14px; background: color-mix(in srgb, var(--vscode-editor-background) 60%, transparent); color: var(--vscode-descriptionForeground); text-align: center; }
      code { font-family: var(--vscode-editor-font-family, monospace); }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
      @media (max-width: 620px) { .dashboard-topbar h1 { font-size: 1.6rem; } }`;

    return getWebviewHtmlShell({
      title: 'AtlasMind: Compare Models',
      bodyContent: body,
      cspSource: this.panel.webview.cspSource,
      scriptContent: script,
      extraCss,
    });
  }

  private dispose(): void {
    ModelComparisonPanel.current = undefined;
    this.activeRun?.abort();
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

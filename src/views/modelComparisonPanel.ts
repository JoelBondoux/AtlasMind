import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { compareModelsOnPrompt, type ModelEvalResult } from '../core/modelEvalHarness.js';

interface RunComparisonMessage {
  type: 'run';
  prompt: string;
  modelIds: string[];
}

interface AvailableModel {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
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

/**
 * Webview surface for the model-eval harness (`compareModelsOnPrompt`). Lets the
 * user enter a prompt, pick 2+ models, run them, and view a ranked
 * quality/cost/latency comparison. Graded outcomes are recorded into the router
 * so the benchmark also calibrates outcome-driven routing.
 *
 * Only models from providers the user has actually configured (credentials
 * present) are offered, so the comparison can always be run for real.
 *
 * Security:
 * - All dynamic content is escaped through escapeHtml() before injection.
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
   * Returns enabled models that belong to a provider the user has configured
   * with credentials. Provider-configured checks run in parallel so opening the
   * panel stays fast even with many registered providers.
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
    return providers
      .filter((_, index) => configuredFlags[index])
      .flatMap(provider =>
        provider.models
          .filter(model => model.enabled)
          .map(model => ({ id: model.id, name: model.name, providerId: provider.id, providerName: provider.displayName })),
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

    this.running = true;
    this.activeRun = new AbortController();
    void this.panel.webview.postMessage({ type: 'status', text: `Running ${modelIds.length} models…` });
    try {
      const results = await compareModelsOnPrompt(
        prompt,
        modelIds,
        async (modelId, body, signal) => {
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
        },
        {
          signal: this.activeRun.signal,
          estimateCostUsd: (modelId, inputTokens, outputTokens) => {
            const info = this.atlas.modelRouter.getModelInfo(modelId);
            if (!info) { return 0; }
            return ((inputTokens / 1000) * info.inputPricePer1k) + ((outputTokens / 1000) * info.outputPricePer1k);
          },
          onResult: (modelId, quality) => this.atlas.modelRouter.recordExecutionOutcome(modelId, quality),
        },
      );
      void this.panel.webview.postMessage({ type: 'results', html: this.renderResults(results) });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
      this.activeRun = undefined;
    }
  }

  /** Builds the results table HTML extension-side with all dynamic content escaped. */
  private renderResults(results: ModelEvalResult[]): string {
    if (results.length === 0) {
      return '<div class="dashboard-empty">No results.</div>';
    }
    const rows = results.map((result, index) => {
      const rank = index === 0 ? '<span class="rank-badge">★ 1</span>' : `${index + 1}`;
      if (result.error) {
        return `<tr><td>${rank}</td><td><code>${escapeHtml(result.modelId)}</code></td><td colspan="4" class="err">Error: ${escapeHtml(result.error)}</td></tr>`;
      }
      return `<tr>`
        + `<td>${rank}</td>`
        + `<td><code>${escapeHtml(result.modelId)}</code></td>`
        + `<td class="numeric">${result.quality.toFixed(2)}</td>`
        + `<td class="numeric">$${result.costUsd.toFixed(5)}</td>`
        + `<td class="numeric">${result.latencyMs} ms</td>`
        + `<td class="preview">${escapeHtml(result.contentPreview)}</td>`
        + `</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>Model</th><th class="numeric">Quality</th><th class="numeric">Cost</th><th class="numeric">Latency</th><th>Output preview</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<p class="comparison-note">Ranked by graded quality, then cost. Outcomes were recorded to calibrate outcome-driven routing.</p>`;
  }

  private getHtml(): string {
    const models = this.configuredModels;

    let modelPicker: string;
    if (models.length === 0) {
      modelPicker = '<div class="dashboard-empty">No configured models are available. Add provider credentials in <strong>Model Providers</strong>, then reopen this panel.</div>';
    } else {
      // Group checkboxes by provider for readability.
      const groups = new Map<string, AvailableModel[]>();
      for (const model of models) {
        const list = groups.get(model.providerName) ?? [];
        list.push(model);
        groups.set(model.providerName, list);
      }
      const groupHtml = Array.from(groups.entries()).map(([providerName, providerModels]) => {
        const rows = providerModels.map(model =>
          `<label class="model-pick"><input type="checkbox" class="model-cb" value="${escapeHtml(model.id)}" /> <code>${escapeHtml(model.id)}</code> <span class="badge">${escapeHtml(model.name)}</span></label>`,
        ).join('');
        return `<div class="model-group"><p class="model-group-label">${escapeHtml(providerName)}</p>${rows}</div>`;
      }).join('');
      modelPicker = `
        <div class="picker-toolbar">
          <label class="select-all"><input type="checkbox" id="select-all" /> <strong>Select all (${models.length})</strong></label>
          <span class="selected-count" id="selected-count">0 selected</span>
        </div>
        <div class="model-list">${groupHtml}</div>`;
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
            <p class="dashboard-copy">Run one prompt across the models you have credentials for and compare graded quality, cost, and latency side by side. Every run also feeds the outcome-driven routing channel, so benchmarking here makes routing smarter.</p>
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
          <div id="results"><div class="dashboard-empty">Results will appear here, ranked by quality then cost.</div></div>
        </article>
      </div>`;

    // Demo prompts are embedded as data for the nonce script; guard against
    // accidental </script> breakouts even though the literals are static.
    const demoData = JSON.stringify(DEMO_PROMPTS.map(demo => demo.prompt)).replace(/</g, '\\u003c');

    const script = `
      const vscode = acquireVsCodeApi();
      const DEMO_PROMPTS = ${demoData};
      const runBtn = document.getElementById('run');
      const statusEl = document.getElementById('status');
      const resultsEl = document.getElementById('results');
      const promptEl = document.getElementById('prompt');
      const selectAll = document.getElementById('select-all');
      const countEl = document.getElementById('selected-count');
      const checkboxes = () => Array.from(document.querySelectorAll('.model-cb'));

      function updateCount() {
        if (!countEl) { return; }
        const picked = checkboxes().filter((cb) => cb.checked).length;
        countEl.textContent = picked + ' selected';
        if (selectAll) {
          const all = checkboxes();
          selectAll.checked = all.length > 0 && picked === all.length;
          selectAll.indeterminate = picked > 0 && picked < all.length;
        }
      }

      if (selectAll) {
        selectAll.addEventListener('change', () => {
          checkboxes().forEach((cb) => { cb.checked = selectAll.checked; });
          updateCount();
        });
      }
      checkboxes().forEach((cb) => cb.addEventListener('change', updateCount));

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
        statusEl.textContent = '';
        vscode.postMessage({ type: 'run', prompt: prompt, modelIds: modelIds });
      });

      window.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'status') { statusEl.textContent = message.text; statusEl.className = 'run-status busy'; runBtn.disabled = true; }
        else if (message.type === 'error') { statusEl.textContent = message.text; statusEl.className = 'run-status err'; runBtn.disabled = false; }
        else if (message.type === 'results') { statusEl.textContent = 'Done.'; statusEl.className = 'run-status ok'; runBtn.disabled = false; resultsEl.innerHTML = message.html; }
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
      .model-list { display: flex; flex-direction: column; gap: 14px; max-height: 340px; overflow-y: auto; scrollbar-width: thin; padding: 4px 2px; }
      .model-group { display: flex; flex-direction: column; gap: 4px; }
      .model-group-label { margin: 0 0 2px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); }
      .model-pick { cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 8px; }
      .model-pick:hover { background: color-mix(in srgb, var(--vscode-list-hoverBackground, transparent) 90%, transparent); }
      .run-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .dashboard-button { border-radius: 999px; border: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 88%, transparent); padding: 10px 18px; font: inherit; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
      .dashboard-button:hover:not(:disabled) { transform: translateY(-1px); }
      .dashboard-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .dashboard-button-solid { background: linear-gradient(135deg, color-mix(in srgb, var(--vscode-button-background) 94%, white 6%), color-mix(in srgb, var(--vscode-button-background) 70%, black 14%)); color: var(--vscode-button-foreground); border-color: color-mix(in srgb, var(--vscode-button-background) 65%, white 8%); }
      .run-status { font-size: 0.85rem; opacity: 0.9; }
      .run-status.busy { color: var(--vscode-descriptionForeground); }
      .run-status.ok { color: var(--vscode-testing-iconPassed, #4ec9b0); }
      .run-status.err { color: var(--vscode-errorForeground, #f14c4c); }
      .table-wrap { overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; }
      th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-widget-border, #444) 58%, transparent); vertical-align: top; }
      th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); }
      td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }
      td.preview { max-width: 420px; opacity: 0.9; white-space: pre-wrap; }
      td.err { color: var(--vscode-errorForeground, #f14c4c); }
      .rank-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; background: color-mix(in srgb, var(--vscode-notificationsInfoIcon-foreground, #4ec9b0) 30%, transparent); color: var(--vscode-notificationsInfoIcon-foreground, #4ec9b0); white-space: nowrap; }
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

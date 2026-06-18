import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { compareModelsOnPrompt, type ModelEvalResult } from '../core/modelEvalHarness.js';

interface RunComparisonMessage {
  type: 'run';
  prompt: string;
  modelIds: string[];
}

/**
 * Webview surface for the model-eval harness (`compareModelsOnPrompt`). Lets the
 * user enter a prompt, pick 2+ models, run them, and view a ranked
 * quality/cost/latency comparison. Graded outcomes are recorded into the router
 * so the benchmark also calibrates outcome-driven routing.
 */
export class ModelComparisonPanel {
  public static current: ModelComparisonPanel | undefined;
  private static readonly viewType = 'atlasmind.modelComparison';
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private running = false;
  private activeRun: AbortController | undefined;

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
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: unknown) => { void this.handleMessage(message); }, null, this.disposables);
  }

  private availableModels(): Array<{ id: string; name: string }> {
    return this.atlas.modelRouter.listProviders()
      .flatMap(provider => provider.models.filter(model => model.enabled).map(model => ({ id: model.id, name: model.name })))
      .sort((a, b) => a.id.localeCompare(b.id));
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
    const known = new Set(this.availableModels().map(model => model.id));
    const modelIds = Array.isArray(payload.modelIds)
      ? payload.modelIds.filter((id): id is string => typeof id === 'string' && known.has(id))
      : [];

    if (!prompt) {
      void this.panel.webview.postMessage({ type: 'error', text: 'Enter a prompt first.' });
      return;
    }
    if (modelIds.length < 2) {
      void this.panel.webview.postMessage({ type: 'error', text: 'Select at least two known models to compare.' });
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
      return '<p>No results.</p>';
    }
    const rows = results.map((result, index) => {
      if (result.error) {
        return `<tr><td>${index + 1}</td><td>${escapeHtml(result.modelId)}</td><td colspan="4" class="err">Error: ${escapeHtml(result.error)}</td></tr>`;
      }
      return `<tr>`
        + `<td>${index + 1}</td>`
        + `<td>${escapeHtml(result.modelId)}</td>`
        + `<td>${result.quality.toFixed(2)}</td>`
        + `<td>$${result.costUsd.toFixed(5)}</td>`
        + `<td>${result.latencyMs} ms</td>`
        + `<td class="preview">${escapeHtml(result.contentPreview)}</td>`
        + `</tr>`;
    }).join('');
    return `<table><thead><tr><th>#</th><th>Model</th><th>Quality</th><th>Cost</th><th>Latency</th><th>Output preview</th></tr></thead><tbody>${rows}</tbody></table>`
      + `<p class="note">Graded outcomes were recorded to calibrate outcome-driven routing.</p>`;
  }

  private getHtml(): string {
    const models = this.availableModels();
    const checkboxes = models.length > 0
      ? models.map(model => `<label class="model-pick"><input type="checkbox" class="model-cb" value="${escapeHtml(model.id)}" /> <code>${escapeHtml(model.id)}</code> <span class="badge">${escapeHtml(model.name)}</span></label>`).join('')
      : '<p>No enabled models are available. Configure a provider first.</p>';

    const body = `
      <h1>Compare Models</h1>
      <p>Run one prompt across selected models and compare graded quality, cost, and latency. Outcomes feed the outcome-driven routing channel.</p>
      <section>
        <label for="prompt"><strong>Prompt</strong></label>
        <textarea id="prompt" rows="5" placeholder="Enter a prompt to run across the selected models…"></textarea>
        <h2>Models <small>(pick 2 or more)</small></h2>
        <div class="model-list">${checkboxes}</div>
        <p><button id="run" type="button">Run comparison</button> <span id="status" class="status"></span></p>
      </section>
      <section>
        <h2>Results</h2>
        <div id="results"><p class="muted">Results will appear here, ranked by quality then cost.</p></div>
      </section>`;

    const script = `
      const vscode = acquireVsCodeApi();
      const runBtn = document.getElementById('run');
      const statusEl = document.getElementById('status');
      const resultsEl = document.getElementById('results');
      runBtn.addEventListener('click', () => {
        const prompt = document.getElementById('prompt').value;
        const modelIds = Array.from(document.querySelectorAll('.model-cb'))
          .filter((cb) => cb.checked).map((cb) => cb.value);
        statusEl.textContent = '';
        vscode.postMessage({ type: 'run', prompt: prompt, modelIds: modelIds });
      });
      window.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.type === 'status') { statusEl.textContent = message.text; runBtn.disabled = true; }
        else if (message.type === 'error') { statusEl.textContent = message.text; runBtn.disabled = false; }
        else if (message.type === 'results') { statusEl.textContent = 'Done.'; runBtn.disabled = false; resultsEl.innerHTML = message.html; }
      });`;

    const extraCss = `
      textarea { width: 100%; font-family: var(--vscode-editor-font-family, monospace); padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); border-radius: 3px; }
      .model-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; border: 1px solid var(--vscode-widget-border, #444); border-radius: 3px; padding: 8px; }
      .model-pick { cursor: pointer; }
      .status { margin-left: 10px; opacity: 0.85; }
      .muted, .note { opacity: 0.7; }
      .note { font-size: 0.85em; margin-top: 8px; }
      td.preview { max-width: 420px; opacity: 0.9; }
      td.err { color: var(--vscode-errorForeground, #f14c4c); }
      code { font-family: var(--vscode-editor-font-family, monospace); }`;

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

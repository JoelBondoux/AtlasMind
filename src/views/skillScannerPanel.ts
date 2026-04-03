import * as vscode from 'vscode';
import { getWebviewHtmlShell, escapeHtml } from './webviewUtils.js';
import type { ScannerRulesManager } from '../core/scannerRulesManager.js';
import type { ScannerRulesConfig, SerializedScanRule } from '../types.js';

type PanelMessage =
  | { type: 'updateRule'; rule: SerializedScanRule }
  | { type: 'resetRule'; id: string }
  | { type: 'deleteRule'; id: string }
  | { type: 'addRule'; rule: SerializedScanRule }
  | { type: 'saveAll'; config: ScannerRulesConfig };

/**
 * Webview panel for viewing and editing scanner security rules.
 */
export class SkillScannerPanel {
  public static currentPanel: SkillScannerPanel | undefined;
  private static readonly viewType = 'atlasmind.skillScanner';

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    context: vscode.ExtensionContext,
    rulesManager: ScannerRulesManager,
    onRulesChanged: () => void,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SkillScannerPanel.currentPanel) {
      SkillScannerPanel.currentPanel.update(rulesManager);
      SkillScannerPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SkillScannerPanel.viewType,
      'AtlasMind — Skill Scanner Rules',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    SkillScannerPanel.currentPanel = new SkillScannerPanel(
      panel,
      rulesManager,
      onRulesChanged,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private rulesManager: ScannerRulesManager,
    private readonly onRulesChanged: () => void,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      msg => void this.handleMessage(msg),
      null,
      this.disposables,
    );
  }

  private update(rulesManager: ScannerRulesManager): void {
    this.rulesManager = rulesManager;
    this.panel.webview.html = this.buildHtml();
  }

  private dispose(): void {
    SkillScannerPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    if (!isPanelMessage(raw)) {
      return;
    }
    const msg = raw;

    switch (msg.type) {
      case 'updateRule': {
        const r = msg.rule;
        if (r.builtIn) {
          this.rulesManager.updateBuiltInRule(r.id, {
            severity: r.severity,
            message: r.message,
            enabled: r.enabled,
          });
        } else {
          try {
            this.rulesManager.upsertCustomRule(r);
          } catch (err) {
            await vscode.window.showErrorMessage(
              `Could not save rule: ${err instanceof Error ? err.message : String(err)}`,
            );
            return;
          }
        }
        break;
      }

      case 'resetRule':
        this.rulesManager.resetBuiltInRule(msg.id);
        break;

      case 'deleteRule':
        this.rulesManager.deleteCustomRule(msg.id);
        break;

      case 'addRule': {
        try {
          this.rulesManager.upsertCustomRule(msg.rule);
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Could not add rule: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        break;
      }

      case 'saveAll': {
        try {
          this.rulesManager.replaceConfig(msg.config);
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Could not save scanner config: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
        break;
      }

      default:
        return;
    }

    this.onRulesChanged();
    this.panel.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    const rules = this.rulesManager.getEffectiveRules();
    const cspSource = this.panel.webview.cspSource;

    const rulesJson = escapeHtml(JSON.stringify(rules));

    const tableRows = rules
      .map(
        (r, idx) => `
      <tr id="row-${idx}" data-id="${escapeHtml(r.id)}" data-builtin="${r.builtIn}" class="${r.enabled ? '' : 'rule-disabled'}">
        <td>
          <span class="badge badge-${escapeHtml(r.severity)}" title="${r.builtIn ? 'Built-in' : 'Custom'}">
            ${escapeHtml(r.severity)}${r.builtIn ? '' : ' ✦'}
          </span>
        </td>
        <td><code>${escapeHtml(r.id)}</code></td>
        <td><code class="pattern-cell" title="${escapeHtml(r.pattern)}">${escapeHtml(r.pattern.length > 50 ? r.pattern.slice(0, 47) + '…' : r.pattern)}</code></td>
        <td class="msg-cell">${escapeHtml(r.message)}</td>
        <td class="actions-cell">
          <button class="btn-icon" title="${r.enabled ? 'Disable rule' : 'Enable rule'}" onclick="toggleRule(${idx})">${r.enabled ? '$(eye)' : '$(eye-closed)'}</button>
          <button class="btn-icon" title="Edit rule" onclick="editRule(${idx})">$(edit)</button>
          ${r.builtIn
            ? `<button class="btn-icon reset-btn" title="Reset to default" onclick="resetRule('${escapeHtml(r.id)}')">$(discard)</button>`
            : `<button class="btn-icon delete-btn" title="Delete custom rule" onclick="deleteRule('${escapeHtml(r.id)}')">$(trash)</button>`
          }
        </td>
      </tr>`,
      )
      .join('');

    const body = /* html */ `
<h1>$(shield) Skill Scanner Rules</h1>
<p style="margin-bottom: 1em; color: var(--vscode-descriptionForeground);">
  Rules marked <strong>✦</strong> are custom. Built-in rules can be disabled or have their severity/message adjusted, but their patterns protect you from known attack vectors — change with care.<br>
  <strong>Error-level</strong> issues block a skill from being enabled. <strong>Warning-level</strong> issues are informational.
</p>

<div style="display:flex; gap: 8px; margin-bottom: 12px;">
  <button onclick="addRule()">$(add) Add custom rule</button>
  <button onclick="resetAllBuiltins()" class="secondary-btn">$(discard) Reset all built-ins</button>
</div>

<table id="rules-table">
  <thead>
    <tr>
      <th style="width: 90px">Severity</th>
      <th style="width: 180px">ID</th>
      <th style="width: 220px">Pattern</th>
      <th>Message</th>
      <th style="width: 110px">Actions</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>

<!-- Edit modal -->
<div id="edit-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:100; align-items:center; justify-content:center;">
  <div style="background:var(--vscode-editor-background); border:1px solid var(--vscode-widget-border); padding:24px; width:min(560px,90vw); border-radius:4px;">
    <h2 id="modal-title" style="margin-top:0">Edit Rule</h2>
    <div class="field-group">
      <label>ID <input id="f-id" placeholder="e.g. no-eval" /></label>
      <label>Severity
        <select id="f-severity">
          <option value="error">error</option>
          <option value="warning">warning</option>
        </select>
      </label>
    </div>
    <label style="display:block; margin-bottom: 8px;">
      Pattern (regex source, no delimiters)
      <input id="f-pattern" style="width:100%; margin-top:4px;" placeholder="e.g. \\beval\\s*\\(" />
    </label>
    <div id="pattern-error" style="color:var(--vscode-errorForeground); margin-bottom:8px; display:none;"></div>
    <label style="display:block; margin-bottom: 12px;">
      Message
      <input id="f-message" style="width:100%; margin-top:4px;" placeholder="Describe the issue and how to fix it." />
    </label>
    <div style="display:flex; gap:8px; justify-content:flex-end;">
      <button onclick="closeModal()">Cancel</button>
      <button id="modal-save-btn" onclick="saveModal()">Save</button>
    </div>
  </div>
</div>
`;

    const script = /* javascript */ `
(function() {
  const vscode = acquireVsCodeApi();
  let rules = JSON.parse(document.getElementById('rules-data').textContent);
  let editingIdx = -1;

  window.toggleRule = function(idx) {
    const rule = rules[idx];
    const updated = { ...rule, enabled: !rule.enabled };
    rules[idx] = updated;
    vscode.postMessage({ type: 'updateRule', rule: updated });
  };

  window.editRule = function(idx) {
    editingIdx = idx;
    const rule = rules[idx];
    const modal = document.getElementById('edit-modal');
    document.getElementById('modal-title').textContent = rule.builtIn ? 'Edit Built-in Rule' : 'Edit Custom Rule';
    const idInput = document.getElementById('f-id');
    idInput.value = rule.id;
    idInput.disabled = true; // can't rename existing rules
    document.getElementById('f-severity').value = rule.severity;
    document.getElementById('f-pattern').value = rule.pattern;
    document.getElementById('f-pattern').disabled = rule.builtIn; // protect built-in patterns
    document.getElementById('f-message').value = rule.message;
    document.getElementById('pattern-error').style.display = 'none';
    modal.style.display = 'flex';
  };

  window.addRule = function() {
    editingIdx = -1;
    const modal = document.getElementById('edit-modal');
    document.getElementById('modal-title').textContent = 'Add Custom Rule';
    const idInput = document.getElementById('f-id');
    idInput.value = '';
    idInput.disabled = false;
    document.getElementById('f-severity').value = 'error';
    document.getElementById('f-pattern').value = '';
    document.getElementById('f-pattern').disabled = false;
    document.getElementById('f-message').value = '';
    document.getElementById('pattern-error').style.display = 'none';
    modal.style.display = 'flex';
  };

  window.saveModal = function() {
    const id = document.getElementById('f-id').value.trim();
    const severity = document.getElementById('f-severity').value;
    const pattern = document.getElementById('f-pattern').value.trim();
    const message = document.getElementById('f-message').value.trim();

    if (!id || !pattern || !message) {
      vscode.postMessage({ type: 'noop' }); // nothing
      return;
    }

    // Validate regex client-side
    try {
      new RegExp(pattern);
    } catch(e) {
      const errEl = document.getElementById('pattern-error');
      errEl.textContent = 'Invalid regex: ' + e.message;
      errEl.style.display = 'block';
      return;
    }

    const isBuiltIn = editingIdx >= 0 ? rules[editingIdx].builtIn : false;
    const rule = { id, severity, pattern, message, enabled: true, builtIn: isBuiltIn };

    if (editingIdx >= 0) {
      const existing = rules[editingIdx];
      rule.enabled = existing.enabled;
      vscode.postMessage({ type: 'updateRule', rule });
    } else {
      vscode.postMessage({ type: 'addRule', rule });
    }

    closeModal();
  };

  window.closeModal = function() {
    document.getElementById('edit-modal').style.display = 'none';
  };

  window.resetRule = function(id) {
    vscode.postMessage({ type: 'resetRule', id });
  };

  window.deleteRule = function(id) {
    vscode.postMessage({ type: 'deleteRule', id });
  };

  window.resetAllBuiltins = function() {
    vscode.postMessage({ type: 'saveAll', config: { overrides: {}, customRules: [] } });
  };

  // Close modal on background click
  document.getElementById('edit-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
})();
`;

    const extraCss = /* css */ `
      .rule-disabled td { opacity: 0.45; }
      .badge-error { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: #f48771; }
      .badge-warning { background: var(--vscode-inputValidation-warningBackground, #352a05); color: #cca700; }
      .pattern-cell { font-size: 0.8em; word-break: break-all; }
      .msg-cell { font-size: 0.9em; }
      .actions-cell { white-space: nowrap; }
      .btn-icon { background: transparent; padding: 2px 6px; font-size: 1em; color: var(--vscode-foreground); }
      .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(90,93,94,0.31)); }
      .reset-btn { color: var(--vscode-charts.blue, #40a6ff); }
      .delete-btn { color: var(--vscode-errorForeground, #f48771); }
      .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .field-group { display: flex; gap: 12px; margin-bottom: 8px; }
      .field-group label { flex: 1; }
      label input, label select { display: block; width: 100%; margin-top: 4px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, #555); padding: 4px 6px; border-radius: 2px; }
    `;

    // Store rules as JSON in a hidden element to avoid inline injection issues
    const bodyWithData = `<script id="rules-data" type="application/json">${rulesJson}</script>${body}`;

    return getWebviewHtmlShell({
      title: 'AtlasMind — Skill Scanner Rules',
      bodyContent: bodyWithData,
      cspSource,
      scriptContent: script,
      extraCss,
    });
  }
}

function isPanelMessage(raw: unknown): raw is PanelMessage {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as Record<string, unknown>)['type'] === 'string'
  );
}

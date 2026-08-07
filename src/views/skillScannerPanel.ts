import * as vscode from 'vscode';
import { getWebviewHtmlShell, escapeHtml } from './webviewUtils.js';
import type { ScannerRulesManager } from '../core/scannerRulesManager.js';
import type { ScannerRulesConfig, SerializedScanRule } from '../types.js';

type PanelMessage =
  | { type: 'updateRule'; rule: SerializedScanRule }
  | { type: 'resetRule'; id: string }
  | { type: 'deleteRule'; id: string }
  | { type: 'addRule'; rule: SerializedScanRule }
  /**
   * Resets built-in overrides only. This replaced a `saveAll` message that
   * carried a whole `ScannerRulesConfig` from the webview: the button labelled
   * "Reset all built-ins" sent `{ overrides: {}, customRules: [] }`, so it also
   * silently deleted every custom rule the user had written. It also handed an
   * unvalidated config straight to `replaceConfig`. The webview now sends no
   * payload at all and the host decides what "reset built-ins" means.
   */
  | { type: 'resetAllBuiltIns' };

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

      case 'resetAllBuiltIns': {
        // Clear the built-in overrides but keep the user's own rules — the
        // control says "Reset all built-ins", so that is all it may do.
        const current = this.rulesManager.getConfig();
        const next: ScannerRulesConfig = { overrides: {}, customRules: current.customRules };
        try {
          this.rulesManager.replaceConfig(next);
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Could not reset built-in rules: ${err instanceof Error ? err.message : String(err)}`,
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

    // Embedded on a data-* attribute rather than inside <script type="application/json">.
    // <script> is a raw-text element: the HTML parser does not decode character
    // references inside it, so the previous `escapeHtml(JSON.stringify(rules))`
    // reached the client still carrying `&quot;` and `JSON.parse` threw on the
    // panel's very first statement — taking every handler down with it.
    // Attribute values ARE decoded, so escaping is both safe and lossless here.
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
          <button type="button" class="btn-icon" title="${r.enabled ? 'Disable rule' : 'Enable rule'}" aria-label="${r.enabled ? 'Disable' : 'Enable'} rule ${escapeHtml(r.id)}" data-action="toggle" data-index="${idx}">${r.enabled ? '👁' : '🚫'}</button>
          <button type="button" class="btn-icon" title="Edit rule" aria-label="Edit rule ${escapeHtml(r.id)}" data-action="edit" data-index="${idx}">✎</button>
          ${r.builtIn
            ? `<button type="button" class="btn-icon reset-btn" title="Reset to default" aria-label="Reset rule ${escapeHtml(r.id)} to its default" data-action="reset" data-id="${escapeHtml(r.id)}">⟲</button>`
            : `<button type="button" class="btn-icon delete-btn" title="Delete custom rule" aria-label="Delete custom rule ${escapeHtml(r.id)}" data-action="delete" data-id="${escapeHtml(r.id)}">🗑</button>`
          }
        </td>
      </tr>`,
      )
      .join('');

    const body = /* html */ `
<h1>🛡 Skill Scanner Rules</h1>
<p style="margin-bottom: 1em; color: var(--vscode-descriptionForeground);">
  Rules marked <strong>✦</strong> are custom. Built-in rules can be disabled or have their severity/message adjusted, but their patterns protect you from known attack vectors — change with care.<br>
  <strong>Error-level</strong> issues block a skill from being enabled. <strong>Warning-level</strong> issues are informational.
</p>

<div class="toolbar-actions">
  <button type="button" data-action="add">＋ Add custom rule</button>
  <button type="button" data-action="reset-all" class="secondary-btn">⟲ Reset all built-ins</button>
  <span id="reset-all-confirm" class="confirm-strip" hidden>
    Restore every built-in rule to its shipped severity, message and enabled state? Your custom rules are kept.
    <button type="button" class="danger-btn" data-action="reset-all-confirm">Reset built-ins</button>
    <button type="button" data-action="reset-all-cancel">Cancel</button>
  </span>
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
      <button type="button" data-action="modal-cancel">Cancel</button>
      <button type="button" id="modal-save-btn" data-action="modal-save">Save</button>
    </div>
  </div>
</div>
`;

    const script = /* javascript */ `
(function() {
  const vscode = acquireVsCodeApi();
  // Read from a data-* attribute, not from <script type="application/json">.
  // See the note beside rulesJson in buildHtml() for why the old form threw.
  let rules = JSON.parse(document.getElementById('rules-data').dataset.rules);
  let editingIdx = -1;

  function toggleRule(idx) {
    const rule = rules[idx];
    const updated = { ...rule, enabled: !rule.enabled };
    rules[idx] = updated;
    vscode.postMessage({ type: 'updateRule', rule: updated });
  };

  function editRule(idx) {
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

  function addRule() {
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

  function saveModal() {
    const id = document.getElementById('f-id').value.trim();
    const severity = document.getElementById('f-severity').value;
    const pattern = document.getElementById('f-pattern').value.trim();
    const message = document.getElementById('f-message').value.trim();

    // Previously posted { type: 'noop' } — a message the host does not handle,
    // so a blank field simply did nothing with no explanation.
    if (!id || !pattern || !message) {
      const errEl = document.getElementById('pattern-error');
      const missing = [!id && 'ID', !pattern && 'Pattern', !message && 'Message'].filter(Boolean);
      errEl.textContent = missing.join(', ') + (missing.length === 1 ? ' is required.' : ' are required.');
      errEl.style.display = 'block';
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

  function closeModal() {
    document.getElementById('edit-modal').style.display = 'none';
  };

  function resetRule(id) {
    vscode.postMessage({ type: 'resetRule', id });
  };

  function deleteRule(id) {
    vscode.postMessage({ type: 'deleteRule', id });
  };

  // Every control is wired here. The panel previously used inline onclick=""
  // attributes, which the shared shell's CSP (script-src with a nonce and no
  // 'unsafe-inline') blocks outright — so not one button in this panel worked.
  document.addEventListener('click', function(event) {
    const target = event.target instanceof HTMLElement ? event.target.closest('[data-action]') : null;
    if (!target) { return; }
    const action = target.dataset.action;
    const index = Number(target.dataset.index);
    const id = target.dataset.id || '';
    const confirmStrip = document.getElementById('reset-all-confirm');

    if (action === 'toggle') { toggleRule(index); return; }
    if (action === 'edit') { editRule(index); return; }
    if (action === 'reset') { resetRule(id); return; }
    if (action === 'delete') { deleteRule(id); return; }
    if (action === 'add') { addRule(); return; }
    if (action === 'modal-save') { saveModal(); return; }
    if (action === 'modal-cancel') { closeModal(); return; }
    // Resetting every built-in is destructive, so it is confirmed in place
    // rather than firing on the first click.
    if (action === 'reset-all') { confirmStrip.hidden = false; return; }
    if (action === 'reset-all-cancel') { confirmStrip.hidden = true; return; }
    if (action === 'reset-all-confirm') {
      confirmStrip.hidden = true;
      vscode.postMessage({ type: 'resetAllBuiltIns' });
      return;
    }
  });

  // Close modal on background click, and on Escape.
  document.getElementById('edit-modal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeModal(); }
  });
})();
`;

    const extraCss = /* css */ `
      .rule-disabled td { opacity: 0.45; }
      /* Themed foreground, not a fixed one: the backgrounds here follow the
         theme, so salmon-on-pink was the light-mode result of pinning the text. */
      .badge-error { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-errorForeground, #f48771); border: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }
      .badge-warning { background: var(--vscode-inputValidation-warningBackground, #352a05); color: var(--vscode-editorWarning-foreground, #cca700); border: 1px solid var(--vscode-inputValidation-warningBorder, transparent); }
      .pattern-cell { font-size: 0.8em; word-break: break-all; }
      .msg-cell { font-size: 0.9em; }
      .actions-cell { white-space: nowrap; }
      .btn-icon { background: transparent; padding: 2px 6px; font-size: 1em; color: var(--vscode-foreground); }
      .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(90,93,94,0.31)); }
      /* Was var(--vscode-charts.blue) — a dot is not valid in a custom-property
         name, so the declaration was dropped and only the fallback ever applied. */
      .reset-btn { color: var(--vscode-charts-blue, #40a6ff); }
      .delete-btn { color: var(--vscode-errorForeground, #f48771); }
      .toolbar-actions { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap; }
      .confirm-strip { display: inline-flex; align-items: center; gap: 8px; font-size: 0.88em; padding: 4px 10px; border-radius: 6px;
        border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700); background: var(--vscode-inputValidation-warningBackground, #352a05); }
      .confirm-strip[hidden] { display: none; }
      .danger-btn { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-errorForeground, #f48771); }
      .secondary-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .secondary-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .field-group { display: flex; gap: 12px; margin-bottom: 8px; }
      .field-group label { flex: 1; }
      label input, label select { display: block; width: 100%; margin-top: 4px;
        background: var(--vscode-input-background); color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, #555); padding: 4px 6px; border-radius: 2px; }
    `;

    // Rules travel on a data-* attribute of a hidden <div>. An attribute value
    // is entity-decoded by the parser, so escapeHtml() round-trips cleanly here
    // — unlike inside <script>, where it did not and JSON.parse threw.
    const bodyWithData = `<div id="rules-data" hidden data-rules="${rulesJson}"></div>${body}`;

    return getWebviewHtmlShell({
      dashboardSkin: true,
      title: 'AtlasMind — Skill Scanner Rules',
      bodyContent: bodyWithData,
      cspSource,
      scriptContent: script,
      extraCss,
    });
  }
}

/**
 * Validates every inbound webview message against its exact shape.
 *
 * This used to accept any object whose `type` was a string, which meant the
 * `saveAll` branch handed an entirely unvalidated payload to
 * `replaceConfig()` — a rule set that gates which skills may run. The webview
 * boundary is untrusted, so each message is now checked field by field and a
 * malformed one is dropped rather than coerced.
 */
function isSerializedScanRule(value: unknown): value is SerializedScanRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rule = value as Record<string, unknown>;
  return typeof rule['id'] === 'string' && rule['id'].trim().length > 0
    && (rule['severity'] === 'error' || rule['severity'] === 'warning')
    && typeof rule['pattern'] === 'string' && rule['pattern'].length > 0
    && typeof rule['message'] === 'string'
    && typeof rule['enabled'] === 'boolean'
    && typeof rule['builtIn'] === 'boolean';
}

function isPanelMessage(raw: unknown): raw is PanelMessage {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const msg = raw as Record<string, unknown>;
  switch (msg['type']) {
    case 'updateRule':
    case 'addRule':
      return isSerializedScanRule(msg['rule']);
    case 'resetRule':
    case 'deleteRule':
      return typeof msg['id'] === 'string' && msg['id'].trim().length > 0;
    case 'resetAllBuiltIns':
      return true;
    default:
      return false;
  }
}

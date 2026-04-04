import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { AgentDefinition } from '../types.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

// ── Globalstate key for persisted user agents ────────────────────
const STORAGE_KEY = 'atlasmind.userAgents';
const DISABLED_STORAGE_KEY = 'atlasmind.disabledAgentIds';

// ── Message types from webview → extension ───────────────────────

type AgentPanelMessage =
  | { type: 'select'; payload: { id: string | null } }
  | { type: 'save'; payload: AgentFormData }
  | { type: 'delete'; payload: { id: string } }
  | { type: 'toggleEnabled'; payload: { id: string; enabled: boolean } }
  | { type: 'newAgent' }
  | { type: 'cancel' }
  | { type: 'refresh' };

interface AgentFormData {
  /** Existing agent id when editing, empty string when creating. */
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  /** Comma-separated model IDs; empty = any model. */
  allowedModels: string;
  /** Numeric string or empty. */
  costLimitUsd: string;
  /** Newline-separated skill IDs. */
  skills: string;
}

export function isAgentPanelMessage(msg: unknown): msg is AgentPanelMessage {
  if (typeof msg !== 'object' || msg === null) { return false; }
  const t = (msg as Record<string, unknown>)['type'];
  return t === 'select' || t === 'save' || t === 'delete' || t === 'toggleEnabled' ||
         t === 'newAgent' || t === 'cancel' || t === 'refresh';
}

// ── ID helpers ────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 32) || 'agent';
}

// ── Panel ─────────────────────────────────────────────────────────

export class AgentManagerPanel {
  public static currentPanel: AgentManagerPanel | undefined;
  private static readonly viewType = 'atlasmind.agentManager';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  /** ID of the agent currently being edited, or '__new__' for a new agent form, or null. */
  private editingId: string | null = null;

  /** Validation error message to show in the form. */
  private formError: string = '';

  public static createOrShow(context: vscode.ExtensionContext, atlas: AtlasMindContext): void {
    AgentManagerPanel.createOrShowWithSelection(context, atlas);
  }

  public static createOrShowWithSelection(
    context: vscode.ExtensionContext,
    atlas: AtlasMindContext,
    selectedAgentId: string | null = null,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (AgentManagerPanel.currentPanel) {
      if (selectedAgentId !== null) {
        AgentManagerPanel.currentPanel.editingId = selectedAgentId;
        AgentManagerPanel.currentPanel.formError = '';
      }
      AgentManagerPanel.currentPanel.panel.reveal(column);
      AgentManagerPanel.currentPanel.render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentManagerPanel.viewType,
      'Manage Agents',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );

    AgentManagerPanel.currentPanel = new AgentManagerPanel(panel, atlas, selectedAgentId);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly atlas: AtlasMindContext,
    selectedAgentId: string | null = null,
  ) {
    this.panel = panel;
    this.editingId = selectedAgentId;
    this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      message => { this.handleMessage(message); },
      null,
      this.disposables,
    );
  }

  private dispose(): void {
    AgentManagerPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  private handleMessage(message: unknown): void {
    if (!isAgentPanelMessage(message)) { return; }

    switch (message.type) {

      case 'select':
        this.editingId = message.payload.id;
        this.formError = '';
        break;

      case 'newAgent':
        this.editingId = '__new__';
        this.formError = '';
        break;

      case 'cancel':
        this.editingId = null;
        this.formError = '';
        break;

      case 'delete': {
        const { id } = message.payload;
        const agent = this.atlas.agentRegistry.get(id);
        if (!agent) { break; }
        if (agent.builtIn) {
          vscode.window.showErrorMessage(`"${agent.name}" is a built-in agent and cannot be deleted.`);
          break;
        }
        void vscode.window
          .showWarningMessage(
            `Delete agent "${agent.name}" (${agent.id})? This cannot be undone.`,
            { modal: true },
            'Delete',
          )
          .then(choice => {
            if (choice === 'Delete') {
              this.atlas.agentRegistry.unregister(id);
              this.persistUserAgents();
              this.persistDisabledAgents();
              this.atlas.agentsRefresh.fire();
              if (this.editingId === id) {
                this.editingId = null;
                this.formError = '';
              }
              this.render();
            }
          });
        return; // render happens inside the then()
      }

      case 'toggleEnabled': {
        const { id, enabled } = message.payload;
        if (!this.atlas.agentRegistry.get(id)) {
          break;
        }
        if (enabled) {
          this.atlas.agentRegistry.enable(id);
        } else {
          this.atlas.agentRegistry.disable(id);
        }
        this.persistDisabledAgents();
        this.atlas.agentsRefresh.fire();
        break;
      }

      case 'save': {
        const data = message.payload;
        const isNew = data.id === '';

        // ── Determine the real ID ──
        const newId = isNew ? slugify(data.name) : data.id;

        // ── Validate ──
        const validationError = this.validate(data, isNew, newId);
        if (validationError) {
          this.formError = validationError;
          this.render();
          return;
        }

        const definition: AgentDefinition = {
          id: newId,
          name: data.name.trim(),
          role: data.role.trim(),
          description: data.description.trim(),
          systemPrompt: data.systemPrompt.trim(),
          allowedModels: data.allowedModels
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
          costLimitUsd: data.costLimitUsd.trim()
            ? Number(data.costLimitUsd.trim())
            : undefined,
          skills: data.skills
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean),
          builtIn: false,
        };

        this.atlas.agentRegistry.register(definition);
        this.atlas.agentRegistry.enable(definition.id);
        this.persistUserAgents();
        this.persistDisabledAgents();
        this.atlas.agentsRefresh.fire();
        this.editingId = null;
        this.formError = '';
        break;
      }

      case 'refresh':
        this.formError = '';
        break;
    }

    this.render();
  }

  private validate(data: AgentFormData, isNew: boolean, resolvedId: string): string {
    if (!data.name.trim()) { return 'Name is required.'; }
    if (!data.role.trim()) { return 'Role is required.'; }
    if (!data.systemPrompt.trim()) { return 'System prompt is required.'; }

    if (!isValidId(resolvedId)) {
      return `Agent ID "${resolvedId}" is invalid. Use lowercase letters, digits, hyphens, or underscores (must start with a letter or digit, max 63 chars).`;
    }

    if (isNew && this.atlas.agentRegistry.get(resolvedId)) {
      return `An agent with ID "${resolvedId}" already exists. Choose a different name or edit the existing agent.`;
    }

    if (data.costLimitUsd.trim()) {
      const val = Number(data.costLimitUsd.trim());
      if (isNaN(val) || val <= 0) { return 'Cost limit must be a positive number (e.g. 0.50).'; }
    }

    return '';
  }

  // ── Persistence ───────────────────────────────────────────────

  private persistUserAgents(): void {
    const all = this.atlas.agentRegistry.listAgents();
    const user = all.filter(a => !a.builtIn);
    void this.atlas.extensionContext.globalState.update(STORAGE_KEY, user);
  }

  private persistDisabledAgents(): void {
    void this.atlas.extensionContext.globalState.update(
      DISABLED_STORAGE_KEY,
      this.atlas.agentRegistry.getDisabledIds(),
    );
  }

  // ── Render ────────────────────────────────────────────────────

  private render(): void {
    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const agents = this.atlas.agentRegistry.listAgents();
    const allSkills = this.atlas.skillsRegistry.listSkills();

    // ── Agent table ──────────────────────────────────────────────
    const agentRows = agents.map(agent => {
      const isBuiltIn = agent.builtIn === true;
      const isEnabled = this.atlas.agentRegistry.isEnabled(agent.id);
      const badge = isBuiltIn ? '<span class="badge">built-in</span>' : '';
      const statusBadge = isEnabled
        ? '<span class="badge">enabled</span>'
        : '<span class="badge" style="opacity:0.7;">disabled</span>';
      const editBtn = `<button class="btn-sm" onclick="selectAgent(${JSON.stringify(agent.id)})">Edit</button>`;
      const toggleBtn = isEnabled
        ? `<button class="btn-sm" onclick="toggleAgent(${JSON.stringify(agent.id)}, false)">Disable</button>`
        : `<button class="btn-sm" onclick="toggleAgent(${JSON.stringify(agent.id)}, true)">Enable</button>`;
      const deleteBtn = isBuiltIn
        ? `<button class="btn-sm btn-muted" disabled title="Built-in agents cannot be deleted">Delete</button>`
        : `<button class="btn-sm btn-danger" onclick="deleteAgent(${JSON.stringify(agent.id)})">Delete</button>`;

      return `<tr>
        <td><code>${escapeHtml(agent.id)}</code></td>
        <td>${escapeHtml(agent.name)} ${badge}</td>
        <td>${escapeHtml(agent.role)}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(agent.skills.join(', ') || '—')}</td>
        <td class="action-col">${editBtn} ${toggleBtn} ${deleteBtn}</td>
      </tr>`;
    }).join('');

    // ── Editor form ──────────────────────────────────────────────
    let editorHtml = '';
    if (this.editingId !== null) {
      const isNew = this.editingId === '__new__';
      const agent: AgentDefinition | undefined = isNew
        ? undefined
        : this.atlas.agentRegistry.get(this.editingId);

      const title = isNew ? 'New Agent' : `Edit: ${escapeHtml(agent?.name ?? this.editingId)}`;

      const currentId = escapeHtml(isNew ? '' : (agent?.id ?? ''));
      const currentName = escapeHtml(isNew ? '' : (agent?.name ?? ''));
      const currentRole = escapeHtml(isNew ? '' : (agent?.role ?? ''));
      const currentDesc = escapeHtml(isNew ? '' : (agent?.description ?? ''));
      const currentPrompt = escapeHtml(isNew ? '' : (agent?.systemPrompt ?? ''));
      const currentModels = escapeHtml(
        isNew ? '' : (agent?.allowedModels?.join(', ') ?? ''),
      );
      const currentCost = escapeHtml(
        isNew ? '' : (agent?.costLimitUsd !== undefined ? String(agent.costLimitUsd) : ''),
      );

      const enabledSkillIds = new Set<string>(isNew ? [] : (agent?.skills ?? []));
      const skillCheckboxes = allSkills.map(skill => {
        const checked = enabledSkillIds.has(skill.id) ? 'checked' : '';
        return `<label><input type="checkbox" class="skill-cb" value="${escapeHtml(skill.id)}" ${checked}> ${escapeHtml(skill.name)}</label>`;
      }).join('');

      const errorHtml = this.formError
        ? `<div class="form-error">${escapeHtml(this.formError)}</div>`
        : '';

      const isBuiltIn = agent?.builtIn === true;
      const idField = isNew
        ? `<div class="hint">ID is auto-generated from the name using lowercase letters, digits, hyphens, and underscores.</div>`
        : `<input type="text" id="agentId" value="${currentId}" readonly />
           <div class="hint">ID cannot be changed after creation.</div>`;

      editorHtml = `
      <section id="editor">
        <h2>${title}</h2>
        ${errorHtml}
        <form id="agentForm">
          ${isNew ? '' : `<input type="hidden" id="agentId" value="${currentId}" />`}
          <div class="field-grid">
            <label for="agentName">Name <span class="req">*</span></label>
            <div>
              <input type="text" id="agentName" value="${currentName}" placeholder="e.g. Senior Reviewer" ${isBuiltIn ? 'readonly' : ''} />
            </div>

            <label for="agentRole">Role <span class="req">*</span></label>
            <input type="text" id="agentRole" value="${currentRole}" placeholder="e.g. code reviewer" ${isBuiltIn ? 'readonly' : ''} />

            <label for="agentDesc">Description</label>
            <input type="text" id="agentDesc" value="${currentDesc}" placeholder="Short summary of this agent's purpose" ${isBuiltIn ? 'readonly' : ''} />

            <label for="agentPrompt">System Prompt <span class="req">*</span></label>
            <textarea id="agentPrompt" rows="6" placeholder="Instructions injected into every request for this agent." ${isBuiltIn ? 'readonly' : ''}>${currentPrompt}</textarea>

            <label for="agentModels">Allowed Models</label>
            <div>
              <input type="text" id="agentModels" value="${currentModels}" placeholder="model-id-1, model-id-2 (leave blank for any)" ${isBuiltIn ? 'readonly' : ''} />
              <div class="hint">Comma-separated model IDs. Empty = all models allowed.</div>
            </div>

            <label for="agentCost">Cost Limit (USD)</label>
            <div>
              <input type="number" id="agentCost" value="${currentCost}" min="0" step="0.01" placeholder="e.g. 0.50" ${isBuiltIn ? 'readonly' : ''} />
              <div class="hint">Per-request cost cap. Leave blank for no limit.</div>
            </div>

            <label>Skills</label>
            <div>
              ${idField}
              <div class="skill-list">${skillCheckboxes || '<em>No skills registered.</em>'}</div>
            </div>
          </div>
          <div class="button-row">
            ${isBuiltIn
              ? `<button type="button" onclick="cancelEdit()">Close</button>`
              : `<button type="button" onclick="saveAgent()">Save</button>
                 <button type="button" onclick="cancelEdit()">Cancel</button>`
            }
          </div>
        </form>
      </section>`;
    }

    const scriptContent = `
      const vscode = acquireVsCodeApi();

      function selectAgent(id) {
        vscode.postMessage({ type: 'select', payload: { id } });
      }
      function newAgent() {
        vscode.postMessage({ type: 'newAgent' });
      }
      function cancelEdit() {
        vscode.postMessage({ type: 'cancel' });
      }
      function deleteAgent(id) {
        vscode.postMessage({ type: 'delete', payload: { id } });
      }
      function toggleAgent(id, enabled) {
        vscode.postMessage({ type: 'toggleEnabled', payload: { id, enabled } });
      }
      function saveAgent() {
        const idEl = document.getElementById('agentId');
        const skillEls = document.querySelectorAll('.skill-cb:checked');
        const skills = Array.from(skillEls).map(el => el.value).join('\\n');
        vscode.postMessage({
          type: 'save',
          payload: {
            id: idEl ? idEl.value : '',
            name: document.getElementById('agentName').value,
            role: document.getElementById('agentRole').value,
            description: document.getElementById('agentDesc').value,
            systemPrompt: document.getElementById('agentPrompt').value,
            allowedModels: document.getElementById('agentModels').value,
            costLimitUsd: document.getElementById('agentCost').value,
            skills,
          }
        });
      }
    `;

    const extraCss = `
      .field-grid { display: grid; grid-template-columns: 160px 1fr; gap: 10px 16px; align-items: start; margin-top: 8px; }
      .field-grid label { padding-top: 6px; font-weight: 500; }
      .field-grid input[type="text"],
      .field-grid input[type="number"],
      .field-grid textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); padding: 4px 8px; border-radius: 2px; font-family: inherit; font-size: inherit; }
      .field-grid textarea { resize: vertical; }
      .field-grid input[readonly], .field-grid textarea[readonly] { opacity: 0.6; }
      .hint { font-size: 0.82em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
      .req { color: var(--vscode-charts-red, #f48771); }
      .btn-sm { padding: 2px 8px; font-size: 0.85em; }
      .btn-danger { background: var(--vscode-errorForeground, #f48771); color: var(--vscode-editor-background); }
      .btn-muted { opacity: 0.4; cursor: not-allowed; }
      .button-row { display: flex; gap: 8px; margin-top: 12px; }
      .action-col { white-space: nowrap; }
      .form-error { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-inputValidation-errorForeground, #f48771); padding: 6px 10px; margin-bottom: 8px; border-radius: 2px; }
      .skill-list { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 4px; }
      .skill-list label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      #editor { border-top: 1px solid var(--vscode-widget-border, #444); margin-top: 1.5em; padding-top: 1em; }
    `;

    const bodyContent = `
      <h1>Manage Agents</h1>
      <p>Create, edit, and delete agents. Built-in agents can be inspected but not deleted.</p>

      <section>
        <div class="button-row">
          <button type="button" onclick="newAgent()">$(add) New Agent</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Name</th><th>Role</th><th>Status</th><th>Skills</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${agentRows || '<tr><td colspan="6">No agents registered.</td></tr>'}
          </tbody>
        </table>
      </section>
      ${editorHtml}
    `;

    return getWebviewHtmlShell({
      title: 'Manage Agents',
      cspSource: this.panel.webview.cspSource,
      bodyContent,
      scriptContent,
      extraCss,
    });
  }
}

// ── Persistence helpers used by extension.ts ──────────────────────

export function loadUserAgents(globalState: vscode.Memento): AgentDefinition[] {
  const raw = globalState.get<unknown[]>(STORAGE_KEY, []);
  return raw.filter(isStoredAgent).map(item => ({ ...item, builtIn: false }));
}

function isStoredAgent(item: unknown): item is AgentDefinition {
  if (typeof item !== 'object' || item === null) { return false; }
  const o = item as Record<string, unknown>;
  return (
    typeof o['id'] === 'string' && o['id'].length > 0 &&
    typeof o['name'] === 'string' && o['name'].length > 0 &&
    typeof o['role'] === 'string' &&
    typeof o['description'] === 'string' &&
    typeof o['systemPrompt'] === 'string' &&
    Array.isArray(o['skills'])
  );
}

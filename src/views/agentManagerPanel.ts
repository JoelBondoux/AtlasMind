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
  | { type: 'refresh' }
  | { type: 'openModelProviders' }
  | { type: 'openSettingsModels' };

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
      t === 'newAgent' || t === 'cancel' || t === 'refresh' ||
      t === 'openModelProviders' || t === 'openSettingsModels';
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

      case 'openModelProviders':
        void vscode.commands.executeCommand('atlasmind.openModelProviders');
        return;

      case 'openSettingsModels':
        void vscode.commands.executeCommand('atlasmind.openSettingsModels');
        return;
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
    const totalAgents = agents.length;
    const builtInCount = agents.filter(agent => agent.builtIn).length;
    const customCount = totalAgents - builtInCount;
    const enabledCount = agents.filter(agent => this.atlas.agentRegistry.isEnabled(agent.id)).length;

    // ── Agent table ──────────────────────────────────────────────
    const agentRows = agents.map(agent => {
      const isBuiltIn = agent.builtIn === true;
      const isEnabled = this.atlas.agentRegistry.isEnabled(agent.id);
      const badge = isBuiltIn ? '<span class="badge">built-in</span>' : '';
      const statusBadge = isEnabled
        ? '<span class="badge">enabled</span>'
        : '<span class="badge" style="opacity:0.7;">disabled</span>';
      const editBtn = `<button class="btn-sm" data-action="select-agent" data-agent-id="${escapeHtml(agent.id)}">Edit</button>`;
      const toggleBtn = isEnabled
        ? `<button class="btn-sm" data-action="toggle-agent" data-agent-id="${escapeHtml(agent.id)}" data-enabled="false">Disable</button>`
        : `<button class="btn-sm" data-action="toggle-agent" data-agent-id="${escapeHtml(agent.id)}" data-enabled="true">Enable</button>`;
      const deleteBtn = isBuiltIn
        ? `<button class="btn-sm btn-muted" disabled title="Built-in agents cannot be deleted">Delete</button>`
        : `<button class="btn-sm btn-danger" data-action="delete-agent" data-agent-id="${escapeHtml(agent.id)}">Delete</button>`;
      const searchText = escapeHtml([
        agent.id,
        agent.name,
        agent.role,
        agent.description,
        agent.skills.join(' '),
        isBuiltIn ? 'built-in' : 'custom',
        isEnabled ? 'enabled' : 'disabled',
      ].join(' ').toLowerCase());

      return `<tr data-agent-search="${searchText}">
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
              ? `<button type="button" id="close-agent-editor">Close</button>`
              : `<button type="button" id="save-agent">Save</button>
                 <button type="button" id="cancel-agent-editor">Cancel</button>`
            }
          </div>
        </form>
      </section>`;
    }

    const scriptContent = `
      const vscode = acquireVsCodeApi();

      const navButtons = Array.from(document.querySelectorAll('[data-page-target]'));
      const pages = Array.from(document.querySelectorAll('.panel-page'));
      const searchInput = document.getElementById('agentSearch');
      const searchStatus = document.getElementById('agentSearchStatus');
      const agentRows = Array.from(document.querySelectorAll('tr[data-agent-search]'));

      function activatePage(pageId) {
        navButtons.forEach(button => {
          if (!(button instanceof HTMLButtonElement)) {
            return;
          }
          const isActive = button.dataset.pageTarget === pageId;
          button.classList.toggle('active', isActive);
        });
        pages.forEach(page => {
          if (!(page instanceof HTMLElement)) {
            return;
          }
          const isActive = page.id === 'page-' + pageId;
          page.classList.toggle('active', isActive);
          page.hidden = !isActive;
        });
      }

      function updateSearch(query) {
        const normalized = typeof query === 'string' ? query.trim().toLowerCase() : '';
        let visibleRows = 0;
        agentRows.forEach(row => {
          if (!(row instanceof HTMLElement)) {
            return;
          }
          const haystack = row.dataset.agentSearch ?? '';
          const matches = normalized.length === 0 || haystack.includes(normalized);
          row.style.display = matches ? '' : 'none';
          if (matches) {
            visibleRows += 1;
          }
        });
        if (searchStatus instanceof HTMLElement) {
          if (normalized.length === 0) {
            searchStatus.textContent = 'Search by agent name, role, status, or skill.';
          } else if (visibleRows === 0) {
            searchStatus.textContent = 'No agents matched that search.';
          } else if (visibleRows === 1) {
            searchStatus.textContent = '1 agent matched.';
          } else {
            searchStatus.textContent = visibleRows + ' agents matched.';
          }
        }
      }

      navButtons.forEach(button => {
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }
        button.addEventListener('click', () => {
          activatePage(button.dataset.pageTarget ?? 'overview');
        });
      });

      activatePage(${JSON.stringify(this.editingId !== null ? 'editor' : 'overview')});
      if (searchInput instanceof HTMLInputElement) {
        updateSearch(searchInput.value);
        searchInput.addEventListener('input', () => updateSearch(searchInput.value));
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

      const newAgentButton = document.getElementById('new-agent');
      if (newAgentButton) {
        newAgentButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'newAgent' });
        });
      }

      const openModelProviders = document.getElementById('open-model-providers');
      if (openModelProviders) {
        openModelProviders.addEventListener('click', () => {
          vscode.postMessage({ type: 'openModelProviders' });
        });
      }

      const openSettingsModels = document.getElementById('open-settings-models');
      if (openSettingsModels) {
        openSettingsModels.addEventListener('click', () => {
          vscode.postMessage({ type: 'openSettingsModels' });
        });
      }

      const cancelEditorButton = document.getElementById('cancel-agent-editor');
      if (cancelEditorButton) {
        cancelEditorButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });
      }

      const closeEditorButton = document.getElementById('close-agent-editor');
      if (closeEditorButton) {
        closeEditorButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });
      }

      const saveButton = document.getElementById('save-agent');
      if (saveButton) {
        saveButton.addEventListener('click', saveAgent);
      }

      document.querySelectorAll('[data-action="select-agent"]').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.getAttribute('data-agent-id');
          vscode.postMessage({ type: 'select', payload: { id } });
        });
      });

      document.querySelectorAll('[data-action="delete-agent"]').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.getAttribute('data-agent-id');
          if (!id) {
            return;
          }
          vscode.postMessage({ type: 'delete', payload: { id } });
        });
      });

      document.querySelectorAll('[data-action="toggle-agent"]').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.getAttribute('data-agent-id');
          const enabled = button.getAttribute('data-enabled') === 'true';
          if (!id) {
            return;
          }
          vscode.postMessage({ type: 'toggleEnabled', payload: { id, enabled } });
        });
      });
    `;

    const extraCss = `
      :root {
        --atlas-surface: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-sideBar-background) 20%);
        --atlas-surface-strong: color-mix(in srgb, var(--vscode-editor-background) 64%, var(--vscode-sideBar-background) 36%);
        --atlas-border: var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
        --atlas-accent: var(--vscode-textLink-foreground);
        --atlas-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
      }
      body { padding: 20px; }
      .panel-hero { display: flex; justify-content: space-between; gap: 20px; padding: 20px 22px; margin-bottom: 18px; border: 1px solid var(--atlas-border); border-radius: 18px; background: radial-gradient(circle at top right, color-mix(in srgb, var(--atlas-accent) 14%, transparent), transparent 40%), linear-gradient(160deg, var(--atlas-surface), var(--vscode-editor-background)); }
      .eyebrow, .page-kicker, .card-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.74rem; color: var(--atlas-muted); }
      .panel-hero h1, .page-header h2, #editor h2 { margin: 0; }
      .hero-copy, .page-header p:last-child, .search-status, .summary-card p:last-child { color: var(--atlas-muted); }
      .hero-badges { display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; justify-content: flex-end; }
      .hero-badge { border: 1px solid var(--atlas-border); border-radius: 999px; padding: 6px 12px; background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); }
      .search-shell { display: grid; gap: 6px; margin: 0 0 18px; }
      .search-label { font-weight: 600; }
      .search-shell input { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 10px 12px; border-radius: 12px; }
      .panel-layout { display: grid; grid-template-columns: minmax(220px, 240px) minmax(0, 1fr); gap: 18px; align-items: start; }
      .panel-nav { position: sticky; top: 20px; display: grid; gap: 8px; padding: 16px; border: 1px solid var(--atlas-border); border-radius: 18px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
      .nav-link { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 12px; padding: 11px 12px; background: transparent; color: var(--vscode-foreground); font-weight: 600; }
      .nav-link.active { background: color-mix(in srgb, var(--atlas-accent) 22%, transparent); border-color: color-mix(in srgb, var(--atlas-accent) 48%, var(--atlas-border)); }
      .panel-page { display: none; }
      .panel-page.active { display: block; }
      .action-grid, .summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .action-card, .summary-card, #editor, .directory-card { border: 1px solid var(--atlas-border); border-radius: 16px; padding: 16px; background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background)); }
      .action-card { display: flex; flex-direction: column; gap: 6px; text-align: left; }
      .action-primary { border-color: color-mix(in srgb, var(--atlas-accent) 42%, var(--atlas-border)); }
      .action-title { font-weight: 700; }
      .summary-card h3 { margin: 0; font-size: 1.8rem; }
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
      table { margin-top: 12px; }
      tr[data-agent-search] { cursor: pointer; }
      tr[data-agent-search]:hover { background: color-mix(in srgb, var(--atlas-accent) 8%, transparent); }
      .directory-card code { font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace)); }
      @media (max-width: 920px) {
        .panel-layout, .action-grid, .summary-grid { grid-template-columns: 1fr; }
        .panel-nav { position: static; }
        .panel-hero { flex-direction: column; }
      }
      @media (max-width: 720px) {
        .field-grid { grid-template-columns: 1fr; }
      }
    `;

    const bodyContent = `
      <div class="panel-hero">
        <div>
          <p class="eyebrow">Custom orchestration</p>
          <h1>Manage Agents</h1>
          <p class="hero-copy">Create, inspect, and tune agent definitions without losing sight of the models they depend on. Built-in agents remain inspectable but protected from deletion.</p>
        </div>
        <div class="hero-badges" aria-label="Agent summary">
          <span class="hero-badge">${enabledCount} enabled</span>
          <span class="hero-badge">${customCount} custom</span>
          <span class="hero-badge">${builtInCount} built-in</span>
        </div>
      </div>

      <div class="search-shell">
        <label class="search-label" for="agentSearch">Search agents</label>
        <input id="agentSearch" type="search" placeholder="Search by name, role, status, or skill" />
        <p id="agentSearchStatus" class="search-status" aria-live="polite">Search by agent name, role, status, or skill.</p>
      </div>

      <div class="panel-layout">
        <nav class="panel-nav" aria-label="Agent manager sections" role="tablist" aria-orientation="vertical">
          <button type="button" class="nav-link active" data-page-target="overview">Overview</button>
          <button type="button" class="nav-link" data-page-target="directory">Agent Directory</button>
          <button type="button" class="nav-link" data-page-target="editor">Editor</button>
        </nav>

        <main class="panel-main">
          <section id="page-overview" class="panel-page active">
            <div class="page-header">
              <p class="page-kicker">Overview</p>
              <h2>Agent workspace</h2>
              <p>Create new agents, then jump directly to the provider surfaces that govern allowed-model choices.</p>
            </div>
            <div class="action-grid">
              <button type="button" id="new-agent" class="action-card action-primary">
                <span class="action-title">New Agent</span>
                <span class="action-copy">Start a new custom agent definition with its own prompt, role, and skill list.</span>
              </button>
              <button type="button" id="open-model-providers" class="action-card">
                <span class="action-title">Open Model Providers</span>
                <span class="action-copy">Configure the routed backends your custom agents can rely on.</span>
              </button>
              <button type="button" id="open-settings-models" class="action-card">
                <span class="action-title">Open Model Settings</span>
                <span class="action-copy">Jump to the Settings models page for workspace-level routing configuration.</span>
              </button>
            </div>
            <div class="summary-grid">
              <article class="summary-card">
                <p class="card-kicker">Total</p>
                <h3>${totalAgents}</h3>
                <p>Agents currently registered in AtlasMind.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Custom</p>
                <h3>${customCount}</h3>
                <p>User-defined agents that can be edited or deleted.</p>
              </article>
              <article class="summary-card">
                <p class="card-kicker">Enabled</p>
                <h3>${enabledCount}</h3>
                <p>Agents currently available to routing and orchestration.</p>
              </article>
            </div>
          </section>

          <section id="page-directory" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Agent Directory</p>
              <h2>Registered agents</h2>
              <p>Select a row or use the inline actions to open the editor, toggle enablement, or remove custom agents.</p>
            </div>
            <div class="directory-card">
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
            </div>
          </section>

          <section id="page-editor" class="panel-page" hidden>
            <div class="page-header">
              <p class="page-kicker">Editor</p>
              <h2>Agent definition</h2>
              <p>${this.editingId === null ? 'Select an agent from the directory or start a new one to edit its definition.' : 'Update role, prompt, allowed models, and skill assignment for the selected agent.'}</p>
            </div>
            ${editorHtml || '<div id="editor"><p>No agent selected yet.</p></div>'}
          </section>
        </main>
      </div>
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

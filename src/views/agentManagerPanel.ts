import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { AgentAutoUpdateCadence, AgentDefinition, TestingMethodologyId } from '../types.js';
import { TESTING_METHODOLOGY_DEFINITIONS } from '../types.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';
import { readProjectTestingConfig } from './settingsPanel.js';

// ── Globalstate key for persisted user agents ────────────────────
const STORAGE_KEY = 'atlasmind.userAgents';
const DISABLED_STORAGE_KEY = 'atlasmind.disabledAgentIds';

// ── Message types from webview → extension ───────────────────────

type AgentPanelMessage =
  | { type: 'select'; payload: { id: string | null } }
  | { type: 'save'; payload: AgentFormData }
  | { type: 'delete'; payload: { id: string } }
  | { type: 'toggleEnabled'; payload: { id: string; enabled: boolean } }
  | { type: 'setAutoUpdateCadence'; payload: { cadence: AgentAutoUpdateCadence } }
  | { type: 'resetBuiltIn'; payload: { id: string } }
  | { type: 'newAgent' }
  | { type: 'cancel' }
  | { type: 'refresh' }
  | { type: 'openModelProviders' }
  | { type: 'openModelsView' }
  | { type: 'openSettingsModels' }
  | { type: 'openTestingStrategy' };

const AGENT_AUTO_UPDATE_CADENCES: readonly AgentAutoUpdateCadence[] = ['never', 'every-use', 'daily', 'weekly', 'monthly'];

function isAgentAutoUpdateCadence(value: string): value is AgentAutoUpdateCadence {
  return AGENT_AUTO_UPDATE_CADENCES.includes(value as AgentAutoUpdateCadence);
}

function coerceAgentAutoUpdateCadence(value: string | undefined): AgentAutoUpdateCadence {
  return value && isAgentAutoUpdateCadence(value) ? value : 'never';
}

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
  /** Newline-separated skill IDs; ignored when skillsAutoManaged is true. */
  skills: string;
  /** When true, this agent is excluded from the global auto-update cadence. */
  autoUpdateExcluded: boolean;
  /** When true, skill assignments are managed automatically based on agent role and context. */
  skillsAutoManaged: boolean;
  /** JSON-serialised Partial<Record<TestingMethodologyId, string>>; empty string means no overrides. */
  testingModelOverridesJson: string;
  /** Newline-separated, observable definition-of-done rows. */
  completionRubric: string;
  /** Newline-separated response patterns that indicate unfinished delivery. */
  incompletePatterns: string;
}

export function isAgentPanelMessage(msg: unknown): msg is AgentPanelMessage {
  if (typeof msg !== 'object' || msg === null) { return false; }
  const record = msg as Record<string, unknown>;
  const t = record['type'];
  const payload = record['payload'];

  if (
    t === 'newAgent' || t === 'cancel' || t === 'refresh' ||
    t === 'openModelProviders' || t === 'openModelsView' ||
    t === 'openSettingsModels' || t === 'openTestingStrategy'
  ) {
    return true;
  }
  if (typeof payload !== 'object' || payload === null) { return false; }
  const values = payload as Record<string, unknown>;
  if (t === 'select') {
    return typeof values['id'] === 'string' || values['id'] === null;
  }
  if (t === 'delete' || t === 'resetBuiltIn') {
    return typeof values['id'] === 'string' && values['id'].length > 0;
  }
  if (t === 'toggleEnabled') {
    return typeof values['id'] === 'string' && values['id'].length > 0 && typeof values['enabled'] === 'boolean';
  }
  if (t === 'setAutoUpdateCadence') {
    return typeof values['cadence'] === 'string' && isAgentAutoUpdateCadence(values['cadence']);
  }
  if (t === 'save') {
    const stringFields: Array<keyof AgentFormData> = [
      'id',
      'name',
      'role',
      'description',
      'systemPrompt',
      'allowedModels',
      'costLimitUsd',
      'skills',
      'testingModelOverridesJson',
      'completionRubric',
      'incompletePatterns',
    ];
    return stringFields.every(field => typeof values[field] === 'string') &&
      typeof values['autoUpdateExcluded'] === 'boolean' &&
      typeof values['skillsAutoManaged'] === 'boolean';
  }
  return false;
}

// ── ID helpers ────────────────────────────────────────────────────

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function parseTestingModelOverrides(json: string): Partial<Record<TestingMethodologyId, string>> {
  if (!json.trim()) return {};
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const result: Partial<Record<TestingMethodologyId, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) {
        result[k as TestingMethodologyId] = v.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 32) || 'agent';
}

function parseBoundedLines(value: string, limit: number, maxLength: number): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(line => line.slice(0, maxLength));
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

  /** Cadence written by the user but not yet confirmed by a config re-read (avoids stale-cache flicker). */
  private pendingCadence: AgentAutoUpdateCadence | null = null;

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

      case 'setAutoUpdateCadence': {
        const cadence = message.payload.cadence;
        this.pendingCadence = cadence;
        void this.updateAgentAutoUpdateCadence(cadence).then(
          () => { this.render(); },
          () => { this.pendingCadence = null; this.render(); },
        );
        return;
      }

      case 'resetBuiltIn': {
        const { id } = message.payload;
        const agent = this.atlas.agentRegistry.get(id);
        if (!agent?.builtIn) { break; }
        void vscode.window
          .showWarningMessage(
            `Reset "${agent.name}" to factory defaults? Your custom prompt and description will be lost.`,
            { modal: true },
            'Reset',
          )
          .then(choice => {
            if (choice === 'Reset') {
              void this.atlas.resetBuiltInAgentPrompt?.(id).then(() => {
                this.render();
              });
            }
          });
        return;
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

        const existing = isNew ? undefined : this.atlas.agentRegistry.get(newId);
        const isEditingBuiltIn = !isNew && existing?.builtIn === true;

        const parsedOverrides = parseTestingModelOverrides(data.testingModelOverridesJson);
        const completionRubric = parseBoundedLines(data.completionRubric, 12, 240);
        const incompletePatterns = parseBoundedLines(data.incompletePatterns, 12, 200);
        const completionCriteria = completionRubric.length > 0 || incompletePatterns.length > 0
          ? {
            ...(completionRubric.length > 0 ? { rubric: completionRubric } : {}),
            ...(incompletePatterns.length > 0 ? { incompletePatterns } : {}),
          }
          : undefined;

        let definition: AgentDefinition;
        if (isEditingBuiltIn && existing) {
          // Built-in agents: preserve identity fields (name, role, id, allowedModels).
          // Only the editable fields are written; changes survive restarts via the
          // builtInAgentPromptOverrides store.
          definition = {
            ...existing,
            description: data.description.trim(),
            systemPrompt: data.systemPrompt.trim(),
            autoUpdateExcluded: data.autoUpdateExcluded || undefined,
            skillsAutoManaged: data.skillsAutoManaged || undefined,
            costLimitUsd: data.costLimitUsd.trim() ? Number(data.costLimitUsd.trim()) : undefined,
            testingModelOverrides: Object.keys(parsedOverrides).length > 0 ? parsedOverrides : undefined,
          };
        } else {
          definition = {
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
            // When auto-managed, preserve the last auto-assigned skills; manual selections are ignored.
            skills: data.skillsAutoManaged
              ? (existing?.skills ?? [])
              : data.skills.split('\n').map(s => s.trim()).filter(Boolean),
            builtIn: false,
            autoUpdateExcluded: data.autoUpdateExcluded || undefined,
            skillsAutoManaged: data.skillsAutoManaged || undefined,
            // Preserve lastAutoUpdated so the cadence clock isn't reset on every save.
            lastAutoUpdated: existing?.lastAutoUpdated,
            testingModelOverrides: Object.keys(parsedOverrides).length > 0 ? parsedOverrides : undefined,
            completionCriteria,
          };
        }

        this.atlas.agentRegistry.register(definition);

        if (isEditingBuiltIn) {
          void this.atlas.persistBuiltInAgentOverride?.();
        } else {
          this.atlas.agentRegistry.enable(definition.id);
          this.persistUserAgents();
          this.persistDisabledAgents();
        }

        this.atlas.agentsRefresh.fire();

        // Trigger background skill auto-assessment when Auto mode is on.
        if (data.skillsAutoManaged) {
          void this.atlas.assessAgentSkills?.(definition.id);
        }

        this.editingId = definition.id;
        this.formError = '';
        break;
      }

      case 'refresh':
        this.formError = '';
        break;

      case 'openModelProviders':
        void vscode.commands.executeCommand('atlasmind.openModelProviders');
        return;

      case 'openModelsView':
        void vscode.commands.executeCommand('atlasmind.modelsView.focus');
        return;

      case 'openSettingsModels':
        void vscode.commands.executeCommand('atlasmind.openSettingsModels');
        return;

      case 'openTestingStrategy':
        void vscode.commands.executeCommand('atlasmind.openSettings', 'testing');
        return;
    }

    this.render();
  }

  /**
   * Clickable chips for the models this workspace can actually route to.
   *
   * "Allowed models" was a bare text box, so assigning a model meant knowing its
   * id by heart — which made every newly added provider effectively invisible
   * here. ACP is the case that exposed it: an agent could be configured and
   * enabled and still never occur to anyone as something to assign.
   *
   * Only *enabled* providers are offered, because a chip for a provider that
   * cannot run is an invitation to build an agent that never routes.
   */
  private renderModelChips(): string {
    // Defensive by intent, not for the tests: this runs inside the editor's
    // render, and an unavailable router must cost the user a row of chips —
    // not the whole agent editor. That failure mode has bitten this codebase.
    const providers = (this.atlas?.modelRouter?.listProviders?.() ?? []).filter(provider => provider.enabled);
    const chips: string[] = [];
    for (const provider of providers) {
      for (const model of provider.models.filter(entry => entry.enabled).slice(0, 8)) {
        const subscription = provider.pricingModel === 'subscription';
        chips.push(
          `<button type="button" class="model-chip${subscription ? ' model-chip-subscription' : ''}" `
          + `data-add-model="${escapeHtml(model.id)}" `
          + `title="${escapeHtml(`${provider.displayName}${subscription ? ' — included in a subscription' : ''}`)}">`
          + `${escapeHtml(model.id)}</button>`,
        );
      }
    }
    if (chips.length === 0) {
      return '<div class="hint">No provider is enabled yet, so there is nothing to assign. Configure one under Model Providers first.</div>';
    }
    return `<div class="model-chip-row">${chips.join('')}</div>`;
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

    const rubric = data.completionRubric.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (rubric.length > 12) {
      return 'Completion rubric supports at most 12 requirements.';
    }
    if (rubric.some(line => line.length > 240)) {
      return 'Each completion rubric requirement must be 240 characters or fewer.';
    }

    const incompletePatterns = data.incompletePatterns.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (incompletePatterns.length > 12) {
      return 'Incomplete-result detection supports at most 12 patterns.';
    }
    if (incompletePatterns.some(line => line.length > 200)) {
      return 'Each incomplete-result pattern must be 200 characters or fewer.';
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

  private async updateAgentAutoUpdateCadence(cadence: AgentAutoUpdateCadence): Promise<void> {
    const config = vscode.workspace.getConfiguration('atlasmind');
    const inspect = config.inspect<string>('agentAutoUpdateCadence');

    const target = inspect?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspect?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : inspect?.globalValue !== undefined
          ? vscode.ConfigurationTarget.Global
          : (vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);

    try {
      await config.update('agentAutoUpdateCadence', cadence, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Unable to update agent auto-update cadence: ${message}`);
      throw error;
    }
  }

  // ── Render ────────────────────────────────────────────────────

  private render(): void {
    this.panel.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const agents = this.atlas.agentRegistry.listAgents();
    if (this.editingId === null && agents.length > 0) {
      this.editingId = agents[0]!.id;
    }
    const allSkills = this.atlas.skillsRegistry.listSkills();
    const configuredCadence = this.pendingCadence ?? coerceAgentAutoUpdateCadence(
      vscode.workspace.getConfiguration('atlasmind').get<string>('agentAutoUpdateCadence', 'never'),
    );
    this.pendingCadence = null;
    const totalAgents = agents.length;
    const builtInCount = agents.filter(agent => agent.builtIn).length;
    const customCount = totalAgents - builtInCount;
    const enabledCount = agents.filter(agent => this.atlas.agentRegistry.isEnabled(agent.id)).length;
    const cadenceOptions = AGENT_AUTO_UPDATE_CADENCES.map(cadence => {
      const selected = cadence === configuredCadence ? 'selected' : '';
      return `<option value="${cadence}" ${selected}>${cadence}</option>`;
    }).join('');

    // ── Searchable master list ───────────────────────────────────
    const agentListItems = agents.map(agent => {
      const isBuiltIn = agent.builtIn === true;
      const isEnabled = this.atlas.agentRegistry.isEnabled(agent.id);
      const searchText = escapeHtml([
        agent.id,
        agent.name,
        agent.role,
        agent.description,
        agent.skills.join(' '),
        isBuiltIn ? 'built-in' : 'custom',
        isEnabled ? 'enabled' : 'disabled',
      ].join(' ').toLowerCase());
      const filterValues = `${isBuiltIn ? 'built-in' : 'custom'} ${isEnabled ? 'enabled' : 'disabled'}`;
      const selected = this.editingId === agent.id;

      return `<button type="button" class="agent-list-item ${selected ? 'selected' : ''}" data-action="select-agent" data-agent-id="${escapeHtml(agent.id)}" data-agent-search="${searchText}" data-agent-filter-values="${filterValues}" aria-pressed="${selected ? 'true' : 'false'}">
        <span class="agent-list-heading">
          <span class="agent-list-name">${escapeHtml(agent.name)}</span>
          <span class="status-dot ${isEnabled ? 'enabled' : 'disabled'}" aria-label="${isEnabled ? 'Enabled' : 'Disabled'}"></span>
        </span>
        <span class="agent-list-role">${escapeHtml(agent.role)}</span>
        <span class="agent-list-meta">${isBuiltIn ? 'Built-in' : 'Custom'} · ${agent.skills.length} skill${agent.skills.length === 1 ? '' : 's'}</span>
      </button>`;
    }).join('');

    // ── Editor form ──────────────────────────────────────────────
    let editorHtml = '';
    if (this.editingId !== null) {
      const isNew = this.editingId === '__new__';
      const agent: AgentDefinition | undefined = isNew
        ? undefined
        : this.atlas.agentRegistry.get(this.editingId);

      const title = isNew ? 'New Agent' : escapeHtml(agent?.name ?? this.editingId);

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
      const currentRubric = escapeHtml(isNew ? '' : (agent?.completionCriteria?.rubric ?? []).join('\n'));
      const currentIncompletePatterns = escapeHtml(
        isNew ? '' : (agent?.completionCriteria?.incompletePatterns ?? []).join('\n'),
      );
      const autoUpdateExcluded = !isNew && agent?.autoUpdateExcluded === true;
      // New agents default to Auto; existing agents respect their stored setting.
      const skillsAutoManaged = isNew ? true : (agent?.skillsAutoManaged !== false);

      const enabledSkillIds = new Set<string>(isNew ? [] : (agent?.skills ?? []));
      const skillCheckboxes = allSkills.map(skill => {
        const checked = enabledSkillIds.has(skill.id) ? 'checked' : '';
        return `<label><input type="checkbox" class="skill-cb" value="${escapeHtml(skill.id)}" ${checked}> ${escapeHtml(skill.name)}</label>`;
      }).join('');

      // ── Testing Roles ─────────────────────────────────────────────
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const testingConfig = workspaceRoot ? readProjectTestingConfig(workspaceRoot) : undefined;
      const agentIdForRoles = isNew ? '' : (agent?.id ?? '');
      const assignedMethodologyIds = testingConfig?.methodologies
        .filter(m => m.enabled && m.assignedAgentId === agentIdForRoles)
        .map(m => m.id) ?? [];
      const currentOverrides = agent?.testingModelOverrides ?? {};
      const currentOverridesJson = escapeHtml(JSON.stringify(currentOverrides));

      let testingRolesHtml: string;
      if (isNew || assignedMethodologyIds.length === 0) {
        testingRolesHtml = `
          <div class="hint">No testing methodologies are currently assigned to this agent.</div>
          <button type="button" class="btn-link inline-link" data-open-testing-strategy>Configure in Testing Strategy →</button>`;
      } else {
        const chips = assignedMethodologyIds.map(mid => {
          const def = TESTING_METHODOLOGY_DEFINITIONS.find(d => d.id === mid);
          return `<span class="methodology-chip">${escapeHtml(def?.label ?? mid)}</span>`;
        }).join('');
        const overrideInputs = assignedMethodologyIds.map(mid => {
          const def = TESTING_METHODOLOGY_DEFINITIONS.find(d => d.id === mid);
          const val = escapeHtml(currentOverrides[mid] ?? '');
          const inputId = `override-model-${escapeHtml(mid)}`;
          return `<div class="override-row">
            <label for="${inputId}" class="override-label">${escapeHtml(def?.label ?? mid)}</label>
            <input type="text" id="${inputId}" class="override-model-input" data-methodology-id="${escapeHtml(mid)}"
              value="${val}" placeholder="Model override (blank = global routing)" />
          </div>`;
        }).join('');
        testingRolesHtml = `
          <div class="methodology-chips">${chips}</div>
          <div class="hint" style="margin:6px 0 8px">Override the model for each methodology, or leave blank to follow global routing.</div>
          <!-- Kept as the initial value only. saveAgent() rebuilds the override
               map from the per-methodology inputs rather than reading this
               field, so editing it by hand has no effect; it exists to seed
               those inputs on first render. -->
          <input type="hidden" id="testingModelOverridesJson" value="${currentOverridesJson}" readonly />
          ${overrideInputs}
          <div style="margin-top:8px"><button type="button" class="btn-link" data-open-testing-strategy>Configure in Testing Strategy →</button></div>`;
      }

      const errorHtml = this.formError
        ? `<div class="form-error">${escapeHtml(this.formError)}</div>`
        : '';

      const isBuiltIn = agent?.builtIn === true;
      const isEnabled = isNew || !agent ? true : this.atlas.agentRegistry.isEnabled(agent.id);
      const builtInNotice = isBuiltIn
        ? `<div class="built-in-notice">Built-in identity and completion criteria are factory-defined. You can tailor the description, system prompt, skills, cost limit, and testing overrides; <strong>Reset to defaults</strong> removes those customizations.</div>`
        : '';
      const agentIdRow = isNew
        ? `<label>Agent ID</label><div class="hint" style="padding-top:6px">Auto-generated from the name (lowercase letters, digits, hyphens, underscores).</div>`
        : `<label>Agent ID</label><div><code>${currentId}</code><div class="hint">ID cannot be changed after creation.</div></div>`;

      editorHtml = `
      <section id="editor" class="editor-card">
        <div class="editor-heading">
          <div>
            <p class="eyebrow">${isNew ? 'Custom definition' : (isBuiltIn ? 'Built-in agent' : 'Custom agent')}</p>
            <h2>${title}</h2>
            ${isNew ? '<p class="editor-subtitle">Create a focused agent with an observable definition of done.</p>' : `<p class="editor-subtitle"><code>${currentId}</code> · ${isEnabled ? 'Enabled' : 'Disabled'}</p>`}
          </div>
          ${isNew ? '' : `<button type="button" class="btn-sm" data-action="toggle-agent" data-agent-id="${currentId}" data-enabled="${isEnabled ? 'false' : 'true'}">${isEnabled ? 'Disable' : 'Enable'}</button>`}
        </div>
        ${builtInNotice}
        ${errorHtml}
        <form id="agentForm">
          ${isNew ? '' : `<input type="hidden" id="agentId" value="${currentId}" />`}
          <details class="editor-section" open>
            <summary><span>Identity</span><small>Name, role, and routing description</small></summary>
            <div class="section-body field-grid">
              ${agentIdRow}

              <label for="agentName">Name <span class="req">*</span></label>
              <input type="text" id="agentName" value="${currentName}" placeholder="e.g. Senior Reviewer" ${isBuiltIn ? 'readonly' : ''} />

              <label for="agentRole">Role <span class="req">*</span></label>
              <input type="text" id="agentRole" value="${currentRole}" placeholder="e.g. code reviewer" ${isBuiltIn ? 'readonly' : ''} />

              <label for="agentDesc">Description</label>
              <input type="text" id="agentDesc" value="${currentDesc}" placeholder="Short summary used during agent selection" />
            </div>
          </details>

          <details class="editor-section" open>
            <summary><span>Instructions &amp; completion</span><small>Permanent role prompt and observable definition of done</small></summary>
            <div class="section-body field-grid">
              <label for="agentPrompt">System Prompt <span class="req">*</span></label>
              <div>
                <textarea id="agentPrompt" rows="8" placeholder="Stable role, scope, evidence, and safety instructions.">${currentPrompt}</textarea>
                <div class="hint">Keep permanent instructions concise. AtlasMind appends the shared operating contract and execution rubric at runtime.</div>
              </div>

              <label for="agentCompletionRubric">Completion rubric</label>
              <div>
                <textarea id="agentCompletionRubric" rows="5" placeholder="One observable requirement per line" ${isBuiltIn ? 'readonly' : ''}>${currentRubric}</textarea>
                <div class="hint">${isBuiltIn ? 'Built-in criteria are factory-defined and shown for inspection.' : 'Up to 12 requirements. State evidence or outcomes that can be checked independently.'}</div>
              </div>

              <label for="agentIncompletePatterns">Incomplete-result patterns</label>
              <div>
                <textarea id="agentIncompletePatterns" rows="4" placeholder="One bounded regular-expression pattern per line" ${isBuiltIn ? 'readonly' : ''}>${currentIncompletePatterns}</textarea>
                <div class="hint">${isBuiltIn ? 'Built-in completion gates are factory-defined.' : 'Optional. Matching a safe bounded pattern triggers one finish-or-declare-blockers retry; unsafe regex constructs are ignored.'}</div>
              </div>
            </div>
          </details>

          <details class="editor-section">
            <summary><span>Skills</span><small>Automatic or manual capability assignment</small></summary>
            <div class="section-body field-grid">
              <label>Assignment</label>
              <div>
                <label class="skill-auto-label">
                  <input type="checkbox" id="skillsAutoManaged" ${skillsAutoManaged ? 'checked' : ''} />
                  Auto — assign skills based on agent role and context
                </label>
                <div class="hint" id="skillsAutoHint" ${skillsAutoManaged ? '' : 'style="display:none"'}>
                  AtlasMind reassesses relevant skills when capabilities change and after eligible agent updates.
                </div>
                <div id="skillsManualSection" ${skillsAutoManaged ? 'style="display:none"' : ''}>
                  <div class="skill-list">${skillCheckboxes || '<em>No skills registered.</em>'}</div>
                </div>
              </div>
            </div>
          </details>

          <details class="editor-section">
            <summary><span>Models &amp; budget</span><small>Routing eligibility and per-request spend</small></summary>
            <div class="section-body field-grid">
              <label for="agentModels">Allowed models</label>
              <div>
                <input type="text" id="agentModels" value="${currentModels}" placeholder="model-id-1, model-id-2 (leave blank for any)" ${isBuiltIn ? 'readonly' : ''} />
                <div class="hint">${isBuiltIn ? 'Built-in model assignments are managed from the model surfaces.' : 'Comma-separated model IDs. Empty allows any eligible model.'}</div>
                ${isBuiltIn ? '<button type="button" class="btn-link inline-link" data-open-model-assignments>Assign from the Models sidebar →</button>' : this.renderModelChips()}
                ${isBuiltIn ? '' : '<div class="hint">Click a model to add it. Subscription-backed models — ACP agents, Copilot — cost nothing per token.</div>'}
              </div>

              <label for="agentCost">Cost limit (USD)</label>
              <div>
                <input type="number" id="agentCost" value="${currentCost}" min="0" step="0.01" placeholder="e.g. 0.50" />
                <div class="hint">Per-request cap. Leave blank for no agent-specific limit.</div>
              </div>
            </div>
          </details>

          <details class="editor-section">
            <summary><span>Testing</span><small>Methodology roles and model overrides</small></summary>
            <div class="section-body field-grid">
              <label>Testing roles</label>
              <div>${testingRolesHtml}</div>
            </div>
          </details>

          <details class="editor-section">
            <summary><span>Maintenance</span><small>Update protection, reset, and deletion</small></summary>
            <div class="section-body field-grid">
              <label>Prompt updates</label>
              <div>
                <label class="checkbox-line">
                  <input type="checkbox" id="agentAutoUpdateExcluded" ${isBuiltIn || autoUpdateExcluded ? 'checked' : ''} ${isBuiltIn ? 'disabled' : ''} />
                  Exclude from auto-updates
                </label>
                <div class="hint">${isBuiltIn ? 'Built-in agents are always excluded from the global cadence.' : 'Protect this system prompt from the global agent refresh cadence.'}</div>
              </div>

              ${!isNew && !isBuiltIn ? `<label>Delete agent</label><div><button type="button" class="btn-danger-outline" data-action="delete-agent" data-agent-id="${currentId}">Delete custom agent</button><div class="hint">Deletion requires confirmation and cannot be undone.</div></div>` : ''}
            </div>
          </details>

          <div class="button-row">
            <button type="button" id="save-agent">Save agent</button>
            ${isBuiltIn
              ? `<button type="button" id="reset-builtin-agent" class="btn-muted-outline" title="Restore factory-default prompt and description">Reset to defaults</button>`
              : ''
            }
            ${isNew ? '<button type="button" id="cancel-agent-editor" class="btn-muted-outline">Cancel</button>' : ''}
          </div>
        </form>
      </section>`;
    }

    const scriptContent = `
      const vscode = acquireVsCodeApi();
      const savedState = vscode.getState() ?? {};
      const searchInput = document.getElementById('agentSearch');
      const searchStatus = document.getElementById('agentSearchStatus');
      const agentItems = Array.from(document.querySelectorAll('[data-agent-search]'));
      const filterButtons = Array.from(document.querySelectorAll('[data-agent-filter]'));
      let activeFilter = typeof savedState.agentFilter === 'string' ? savedState.agentFilter : 'all';

      function persistListState() {
        vscode.setState({
          ...savedState,
          searchQuery: searchInput instanceof HTMLInputElement ? searchInput.value : '',
          agentFilter: activeFilter,
        });
      }

      function updateList() {
        const normalized = searchInput instanceof HTMLInputElement
          ? searchInput.value.trim().toLowerCase()
          : '';
        let visibleItems = 0;
        agentItems.forEach(item => {
          if (!(item instanceof HTMLElement)) { return; }
          const haystack = item.dataset.agentSearch ?? '';
          const filterValues = item.dataset.agentFilterValues ?? '';
          const matchesSearch = normalized.length === 0 || haystack.includes(normalized);
          const matchesFilter = activeFilter === 'all' || filterValues.split(' ').includes(activeFilter);
          const matches = matchesSearch && matchesFilter;
          item.hidden = !matches;
          if (matches) { visibleItems += 1; }
        });
        filterButtons.forEach(button => {
          if (!(button instanceof HTMLButtonElement)) { return; }
          const selected = button.dataset.agentFilter === activeFilter;
          button.classList.toggle('active', selected);
          button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        if (searchStatus instanceof HTMLElement) {
          searchStatus.textContent = visibleItems === 0
            ? 'No agents match the current search and filter.'
            : visibleItems === 1
              ? '1 agent shown.'
              : visibleItems + ' agents shown.';
        }
        persistListState();
      }

      if (searchInput instanceof HTMLInputElement) {
        searchInput.value = typeof savedState.searchQuery === 'string' ? savedState.searchQuery : '';
        searchInput.addEventListener('input', updateList);
      }
      filterButtons.forEach(button => {
        if (!(button instanceof HTMLButtonElement)) { return; }
        button.addEventListener('click', () => {
          activeFilter = button.dataset.agentFilter ?? 'all';
          updateList();
        });
      });
      updateList();

      function saveAgent() {
        const idEl = document.getElementById('agentId');
        const autoManaged = document.getElementById('skillsAutoManaged')?.checked ?? true;
        const skillEls = autoManaged ? [] : Array.from(document.querySelectorAll('.skill-cb:checked'));
        const skills = skillEls.map(el => el.value).join('\\n');
        const overrides = {};
        document.querySelectorAll('.override-model-input').forEach(el => {
          const mid = el.getAttribute('data-methodology-id');
          const val = el.value.trim();
          if (mid && val) { overrides[mid] = val; }
        });
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
            autoUpdateExcluded: document.getElementById('agentAutoUpdateExcluded')?.checked ?? false,
            skillsAutoManaged: autoManaged,
            testingModelOverridesJson: JSON.stringify(overrides),
            completionRubric: document.getElementById('agentCompletionRubric').value,
            incompletePatterns: document.getElementById('agentIncompletePatterns').value,
          }
        });
      }

      const newAgentButton = document.getElementById('new-agent');
      if (newAgentButton) {
        newAgentButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'newAgent' });
        });
      }

      document.querySelectorAll('[data-open-model-providers]').forEach(openModelProviders => {
        openModelProviders.addEventListener('click', () => {
          vscode.postMessage({ type: 'openModelProviders' });
        });
      });

      document.querySelectorAll('[data-open-model-assignments]').forEach(openModelsView => {
        openModelsView.addEventListener('click', () => {
          vscode.postMessage({ type: 'openModelsView' });
        });
      });

      // Chips append to the field rather than replacing it: an agent usually
      // wants a short list, and re-typing the previous entry to add one more is
      // exactly the friction that left the box empty.
      document.querySelectorAll('[data-add-model]').forEach(chip => {
        chip.addEventListener('click', () => {
          const field = document.getElementById('agentModels');
          if (!field || field.readOnly) { return; }
          const wanted = chip.getAttribute('data-add-model') || '';
          const current = String(field.value || '').split(',').map(part => part.trim()).filter(Boolean);
          if (current.indexOf(wanted) === -1) {
            current.push(wanted);
          }
          field.value = current.join(', ');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.focus();
        });
      });

      const openSettingsModels = document.getElementById('open-settings-models');
      if (openSettingsModels) {
        openSettingsModels.addEventListener('click', () => {
          vscode.postMessage({ type: 'openSettingsModels' });
        });
      }

      const cadenceSelect = document.getElementById('agent-auto-update-cadence');
      if (cadenceSelect instanceof HTMLSelectElement) {
        cadenceSelect.addEventListener('change', () => {
          vscode.postMessage({
            type: 'setAutoUpdateCadence',
            payload: { cadence: cadenceSelect.value },
          });
        });
      }

      const cancelEditorButton = document.getElementById('cancel-agent-editor');
      if (cancelEditorButton) {
        cancelEditorButton.addEventListener('click', () => {
          vscode.postMessage({ type: 'cancel' });
        });
      }

      const resetBuiltInButton = document.getElementById('reset-builtin-agent');
      if (resetBuiltInButton) {
        resetBuiltInButton.addEventListener('click', () => {
          const idEl = document.getElementById('agentId');
          const id = idEl ? idEl.value : '';
          if (id) {
            vscode.postMessage({ type: 'resetBuiltIn', payload: { id } });
          }
        });
      }

      document.querySelectorAll('[data-open-testing-strategy]').forEach(openTestingStrategyLink => {
        openTestingStrategyLink.addEventListener('click', () => {
          vscode.postMessage({ type: 'openTestingStrategy' });
        });
      });

      const saveButton = document.getElementById('save-agent');
      if (saveButton) {
        saveButton.addEventListener('click', saveAgent);
      }

      // Toggle manual skills section visibility when Auto checkbox changes.
      const skillsAutoManagedEl = document.getElementById('skillsAutoManaged');
      const skillsManualSectionEl = document.getElementById('skillsManualSection');
      const skillsAutoHintEl = document.getElementById('skillsAutoHint');
      if (skillsAutoManagedEl && skillsManualSectionEl) {
        skillsAutoManagedEl.addEventListener('change', () => {
          const isAuto = skillsAutoManagedEl.checked;
          skillsManualSectionEl.style.display = isAuto ? 'none' : '';
          if (skillsAutoHintEl) {
            skillsAutoHintEl.style.display = isAuto ? '' : 'none';
          }
        });
      }

      document.querySelectorAll('[data-action="select-agent"]').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.getAttribute('data-agent-id');
          if (id) {
            persistListState();
            vscode.postMessage({ type: 'select', payload: { id } });
          }
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
      body { padding: 18px; }
      .workspace-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 16px; padding: 2px 2px 16px; border-bottom: 1px solid var(--atlas-border); }
      .workspace-header h1, .editor-heading h2 { margin: 0; }
      .workspace-header-copy { max-width: 720px; margin: 5px 0 0; color: var(--atlas-muted); }
      .workspace-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .primary-action { padding: 7px 13px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .primary-action:hover { background: var(--vscode-button-hoverBackground); }
      .secondary-action { padding: 7px 13px; border: 1px solid var(--atlas-border); background: transparent; color: var(--vscode-foreground); }
      .workspace-stats { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
      .stat-chip { padding: 3px 8px; border: 1px solid var(--atlas-border); border-radius: 999px; color: var(--atlas-muted); font-size: 0.82rem; }
      .eyebrow { margin: 0 0 5px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.72rem; color: var(--atlas-muted); }
      .agent-workspace { display: grid; grid-template-columns: minmax(260px, 310px) minmax(0, 1fr); gap: 16px; align-items: start; }
      .agent-sidebar { position: sticky; top: 16px; display: grid; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--atlas-border); border-radius: 14px; background: linear-gradient(180deg, var(--atlas-surface-strong), var(--atlas-surface)); }
      .sidebar-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .sidebar-heading h2 { margin: 0; font-size: 1rem; }
      .search-shell { display: grid; gap: 5px; }
      .search-label { font-weight: 600; }
      .search-shell input { width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-input-border, var(--atlas-border)); padding: 8px 10px; border-radius: 8px; }
      .search-status { min-height: 1.2em; margin: 0; color: var(--atlas-muted); font-size: 0.8rem; }
      .filter-row { display: flex; flex-wrap: wrap; gap: 5px; }
      .filter-chip { padding: 3px 8px; border: 1px solid var(--atlas-border); border-radius: 999px; background: transparent; color: var(--atlas-muted); font-size: 0.78rem; }
      .filter-chip.active { border-color: color-mix(in srgb, var(--atlas-accent) 65%, var(--atlas-border)); background: color-mix(in srgb, var(--atlas-accent) 16%, transparent); color: var(--vscode-foreground); }
      .agent-list { display: grid; gap: 5px; max-height: calc(100vh - 390px); min-height: 120px; overflow: auto; padding-right: 2px; }
      .agent-list-item { display: grid; gap: 3px; width: 100%; padding: 9px 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--vscode-foreground); text-align: left; }
      .agent-list-item:hover { background: color-mix(in srgb, var(--atlas-accent) 9%, transparent); }
      .agent-list-item.selected { border-color: color-mix(in srgb, var(--atlas-accent) 52%, var(--atlas-border)); background: color-mix(in srgb, var(--atlas-accent) 17%, transparent); }
      .agent-list-item[hidden] { display: none; }
      .agent-list-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .agent-list-name { overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
      .agent-list-role, .agent-list-meta { overflow: hidden; color: var(--atlas-muted); font-size: 0.8rem; text-overflow: ellipsis; white-space: nowrap; }
      .status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--vscode-disabledForeground); }
      .status-dot.enabled { background: var(--vscode-testing-iconPassed, #73c991); }
      .automation-card { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--atlas-border); }
      .automation-card label { font-weight: 600; }
      .automation-card select { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border, var(--atlas-border)); border-radius: 7px; }
      .related-links { display: flex; flex-wrap: wrap; gap: 10px; }
      .editor-card { min-width: 0; border: 1px solid var(--atlas-border); border-radius: 14px; padding: 18px; background: linear-gradient(180deg, var(--atlas-surface), var(--vscode-editor-background)); }
      .editor-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
      .editor-subtitle { margin: 5px 0 0; color: var(--atlas-muted); }
      .editor-section { margin-top: 10px; border: 1px solid var(--atlas-border); border-radius: 10px; background: color-mix(in srgb, var(--atlas-surface-strong) 52%, transparent); }
      .editor-section summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 11px 13px; cursor: pointer; list-style: none; }
      .editor-section summary::-webkit-details-marker { display: none; }
      .editor-section summary > span { font-weight: 650; }
      .editor-section summary > span::before { display: inline-block; width: 1.1em; content: '\\25B8'; color: var(--atlas-muted); }
      .editor-section[open] summary > span::before { content: '\\25BE'; }
      .editor-section summary small { color: var(--atlas-muted); font-size: 0.8rem; text-align: right; }
      .section-body { padding: 4px 13px 14px; border-top: 1px solid var(--atlas-border); }
      .field-grid { display: grid; grid-template-columns: 165px minmax(0, 1fr); gap: 11px 16px; align-items: start; }
      .field-grid label { padding-top: 6px; font-weight: 500; }
      .field-grid input[type="text"],
      .field-grid input[type="number"],
      .field-grid textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-input-border, #444); padding: 6px 8px; border-radius: 5px; font-family: inherit; font-size: inherit; }
      .field-grid textarea { resize: vertical; }
      .field-grid input[readonly], .field-grid textarea[readonly] { opacity: 0.72; }
      .hint { font-size: 0.8rem; color: var(--atlas-muted); margin-top: 3px; }
      .req { color: var(--vscode-charts-red, #f48771); }
      .btn-sm { padding: 5px 10px; font-size: 0.85em; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .btn-sm:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
      .btn-muted-outline { background: transparent; border: 1px solid var(--atlas-border); color: var(--atlas-muted); }
      .btn-danger-outline { padding: 5px 9px; border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); background: transparent; color: var(--vscode-errorForeground, #f48771); }
      .button-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .form-error { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); color: var(--vscode-inputValidation-errorForeground, #f48771); padding: 8px 10px; margin-bottom: 10px; border-radius: 6px; }
      .built-in-notice { background: color-mix(in srgb, var(--vscode-textBlockQuote-background, var(--atlas-surface)) 80%, transparent); border: 1px solid var(--atlas-border); border-radius: 7px; padding: 8px 10px; margin-bottom: 10px; font-size: 0.84rem; color: var(--atlas-muted); }
      .skill-auto-label, .checkbox-line { display: flex; align-items: center; gap: 6px; font-weight: normal; cursor: pointer; }
      .skill-list { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 8px; }
      .skill-list label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      .methodology-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
      .methodology-chip { display: inline-block; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--atlas-border); background: color-mix(in srgb, var(--atlas-accent) 14%, transparent); font-size: 0.82em; }
      .override-row { display: grid; grid-template-columns: 140px 1fr; gap: 6px; align-items: center; margin-bottom: 4px; }
      .override-label { font-size: 0.88em; color: var(--atlas-muted); }
      .override-model-input { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #444); padding: 3px 7px; border-radius: 2px; font-family: inherit; font-size: inherit; }
      .btn-link { background: none; border: none; color: var(--atlas-accent); cursor: pointer; padding: 0; font: inherit; font-size: 0.88em; text-decoration: underline; }
      /* Assignable models, so a provider you enabled is discoverable here rather
         than something you have to already know the id of. */
      .model-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .model-chip {
        border: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.35));
        background: transparent; color: var(--vscode-foreground);
        border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 0.8em; cursor: pointer;
      }
      .model-chip:hover { border-color: var(--atlas-accent); }
      .model-chip-subscription {
        border-style: dashed;
        border-color: color-mix(in srgb, var(--atlas-accent) 60%, var(--vscode-widget-border, #444));
      }
      .inline-link { margin-top: 5px; }
      .empty-editor { display: grid; place-items: center; min-height: 320px; border: 1px dashed var(--atlas-border); border-radius: 14px; color: var(--atlas-muted); text-align: center; }
      @media (max-width: 920px) {
        .workspace-header { flex-direction: column; }
        .workspace-actions { justify-content: flex-start; }
        .agent-workspace { grid-template-columns: 1fr; }
        .agent-sidebar { position: static; }
        .agent-list { max-height: 320px; }
      }
      @media (max-width: 720px) {
        .field-grid { grid-template-columns: 1fr; }
        .editor-section summary { grid-template-columns: 1fr; }
        .editor-section summary small { text-align: left; }
      }
    `;

    const bodyContent = `
      <header class="workspace-header">
        <div>
          <p class="eyebrow">Custom orchestration</p>
          <h1>Manage Agents</h1>
          <p class="workspace-header-copy">Choose an agent from the list and tune its definition without leaving the directory.</p>
          <div class="workspace-stats" aria-label="Agent summary">
            <span class="stat-chip">${totalAgents} total</span>
            <span class="stat-chip">${enabledCount} enabled</span>
            <span class="stat-chip">${customCount} custom</span>
            <span class="stat-chip">${builtInCount} built-in</span>
          </div>
        </div>
        <div class="workspace-actions">
          <button type="button" id="open-settings-models" class="secondary-action">Model settings</button>
          <button type="button" id="new-agent" class="primary-action">New agent</button>
        </div>
      </header>

      <div class="agent-workspace">
        <aside class="agent-sidebar" aria-label="Agent directory">
          <div class="sidebar-heading">
            <h2>Agent directory</h2>
            <span class="hint">${totalAgents} registered</span>
          </div>
          <div class="search-shell">
            <label class="search-label" for="agentSearch">Search agents</label>
            <input id="agentSearch" type="search" placeholder="Name, role, status, or skill" />
            <p id="agentSearchStatus" class="search-status" aria-live="polite"></p>
          </div>
          <div class="filter-row" aria-label="Filter agents">
            <button type="button" class="filter-chip active" data-agent-filter="all" aria-pressed="true">All</button>
            <button type="button" class="filter-chip" data-agent-filter="enabled" aria-pressed="false">Enabled</button>
            <button type="button" class="filter-chip" data-agent-filter="custom" aria-pressed="false">Custom</button>
            <button type="button" class="filter-chip" data-agent-filter="built-in" aria-pressed="false">Built-in</button>
          </div>
          <div class="agent-list">
            ${agentListItems || '<div class="hint">No agents registered yet.</div>'}
          </div>
          <div class="automation-card">
            <label for="agent-auto-update-cadence">Defaults &amp; automation</label>
            <select id="agent-auto-update-cadence" aria-label="Agent Auto-Update cadence">
                ${cadenceOptions}
            </select>
            <p class="hint">Global prompt-refresh cadence for eligible custom agents. Built-ins and individually excluded agents are protected.</p>
          </div>
          <div class="related-links">
            <button type="button" class="btn-link" data-open-model-providers>Model providers</button>
            <button type="button" class="btn-link" data-open-testing-strategy>Testing strategy</button>
          </div>
        </aside>

        <main class="agent-detail">
          ${editorHtml || '<div class="empty-editor"><div><strong>No agent selected</strong><p>Create a custom agent to get started.</p></div></div>'}
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

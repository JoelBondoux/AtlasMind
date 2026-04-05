import * as vscode from 'vscode';
import { getValidatedSsotPath } from '../bootstrap/bootstrapper.js';
import type { AtlasMindContext } from '../extension.js';
import type { AgentDefinition, MemoryEntry, ProjectRunRecord, SkillDefinition, SkillScanResult } from '../types.js';
import type { SessionConversationSummary } from '../chat/sessionConversation.js';

/**
 * Registers all sidebar tree-view providers.
 */
export function registerTreeViews(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const skillsProvider = new SkillsTreeProvider(atlas);
  const agentsProvider = new AgentsTreeProvider(atlas);
  const sessionsProvider = new SessionsTreeProvider(atlas);
  const modelsProvider = new ModelsTreeProvider(atlas);
  const projectRunsProvider = new ProjectRunsTreeProvider(atlas);
  const memoryProvider = new MemoryTreeProvider(atlas);
  atlas.agentsRefresh.event(() => agentsProvider.refresh());
  atlas.skillsRefresh.event(() => skillsProvider.refresh());
  atlas.sessionConversation.onDidChange(() => sessionsProvider.refresh());
  atlas.modelsRefresh.event(() => modelsProvider.refresh());
  atlas.projectRunsRefresh.event(() => projectRunsProvider.refresh());
  atlas.projectRunsRefresh.event(() => sessionsProvider.refresh());
  atlas.memoryRefresh.event(() => memoryProvider.refresh());

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'atlasmind.agentsView',
      agentsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.skillsView',
      skillsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.sessionsView',
      sessionsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.memoryView',
      memoryProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.modelsView',
      modelsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.projectRunsView',
      projectRunsProvider,
    ),
    vscode.commands.registerCommand('atlasmind.memoryLoadMore', () => memoryProvider.loadMore()),
    vscode.commands.registerCommand('atlasmind.memory.openEntry', async (item?: MemoryEntryTreeItem) => {
      if (!item) {
        return;
      }
      const target = resolveMemoryEntryUri(item.entry.path);
      if (!target) {
        void vscode.window.showWarningMessage('AtlasMind could not resolve the SSOT file for this memory entry.');
        return;
      }
      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    vscode.commands.registerCommand('atlasmind.memory.showReview', async (item?: MemoryEntryTreeItem) => {
      if (!item) {
        return;
      }
      const choice = await vscode.window.showInformationMessage(item.review, 'Open File');
      if (choice === 'Open File') {
        await vscode.commands.executeCommand('atlasmind.memory.openEntry', item);
      }
    }),
  );
}

// ── Sessions ───────────────────────────────────────────────────

class SessionSectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: 'chat-sessions' | 'project-runs',
    label: string,
    description: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = description;
    this.contextValue = 'session-section';
    this.iconPath = new vscode.ThemeIcon('comment-discussion');
  }
}

class ChatSessionTreeItem extends vscode.TreeItem {
  constructor(session: SessionConversationSummary) {
    super(session.title, vscode.TreeItemCollapsibleState.None);
    this.description = `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`;
    this.tooltip = new vscode.MarkdownString(
      `**${session.title}**\n\n` +
      `${session.preview}\n\n` +
      `Updated: ${session.updatedAt}`,
    );
    this.iconPath = new vscode.ThemeIcon(
      session.isActive ? 'comment-discussion' : 'comment',
      new vscode.ThemeColor(session.isActive ? 'charts.blue' : 'descriptionForeground'),
    );
    this.contextValue = session.isActive ? 'chat-session-active' : 'chat-session';
    this.command = {
      command: 'atlasmind.openChatPanel',
      title: 'Open Chat Session',
      arguments: [session.id],
    };
  }
}

class ProjectRunSessionTreeItem extends vscode.TreeItem {
  constructor(run: ProjectRunRecord) {
    super(run.goal, vscode.TreeItemCollapsibleState.None);
    this.description = describeRunSession(run);
    this.tooltip = new vscode.MarkdownString(
      `**${run.goal}**\n\n` +
      `Status: ${run.status}\n\n` +
      `Progress: ${run.completedSubtaskCount}/${run.totalSubtaskCount}\n\n` +
      `Updated: ${run.updatedAt}` +
      (run.awaitingBatchApproval ? '\n\nAwaiting batch approval.' : '') +
      (run.paused ? '\n\nPaused before the next batch.' : ''),
    );
    this.iconPath = new vscode.ThemeIcon(getProjectRunSessionIcon(run));
    this.contextValue = 'project-run-session';
    this.command = {
      command: 'atlasmind.openProjectRunCenter',
      title: 'Open Project Run Center',
      arguments: [run.id],
    };
  }
}

type SessionsTreeNode = SessionSectionItem | ChatSessionTreeItem | ProjectRunSessionTreeItem;

class SessionsTreeProvider implements vscode.TreeDataProvider<SessionsTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionsTreeNode): Promise<SessionsTreeNode[]> {
    const sessions = this.atlas.sessionConversation.listSessions();
    const runs = await this.atlas.projectRunHistory.listRunsAsync(12);

    if (!element) {
      const roots: SessionsTreeNode[] = [];
      if (sessions.length > 0) {
        roots.push(new SessionSectionItem('chat-sessions', 'Chat Sessions', `${sessions.length} available`));
      }
      if (runs.length > 0) {
        roots.push(new SessionSectionItem('project-runs', 'Autonomous Runs', `${runs.length} tracked`));
      }
      if (roots.length > 0) {
        return roots;
      }
      return [new vscode.TreeItem('No sessions yet', vscode.TreeItemCollapsibleState.None) as SessionsTreeNode];
    }

    if (element instanceof SessionSectionItem && element.sectionId === 'chat-sessions') {
      return sessions.map(session => new ChatSessionTreeItem(session));
    }

    if (element instanceof SessionSectionItem && element.sectionId === 'project-runs') {
      return runs.map(run => new ProjectRunSessionTreeItem(run));
    }

    return [];
  }
}

function describeRunSession(run: ProjectRunRecord): string {
  if (run.awaitingBatchApproval) {
    return `awaiting approval • ${run.completedSubtaskCount}/${run.totalSubtaskCount}`;
  }
  if (run.paused) {
    return `paused • ${run.completedSubtaskCount}/${run.totalSubtaskCount}`;
  }
  return `${run.status} • ${run.completedSubtaskCount}/${run.totalSubtaskCount}`;
}

function getProjectRunSessionIcon(run: ProjectRunRecord): string {
  if (run.awaitingBatchApproval) {
    return 'pass';
  }
  if (run.paused) {
    return 'debug-pause';
  }
  if (run.status === 'completed') {
    return 'check';
  }
  if (run.status === 'failed') {
    return 'error';
  }
  if (run.status === 'running') {
    return 'sync';
  }
  return 'eye';
}

// ── Agents ──────────────────────────────────────────────────────

class AgentsTreeProvider implements vscode.TreeDataProvider<AgentDefinition> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentDefinition | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AgentDefinition): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.role;
    item.contextValue = buildAgentContextValue(element, this.atlas.agentRegistry.isEnabled(element.id));
    item.tooltip = new vscode.MarkdownString(
      `**${element.name}** *(${element.role})*\n\n${element.description || ''}` +
      `\n\n**Status:** ${this.atlas.agentRegistry.isEnabled(element.id) ? 'Enabled' : 'Disabled'}` +
      (element.builtIn ? '\n\n_Built-in agent_' : ''),
    );
    item.iconPath = new vscode.ThemeIcon(
      'hubot',
      new vscode.ThemeColor(element.builtIn ? 'charts.blue' : 'charts.green'),
    );
    return item;
  }

  getChildren(): AgentDefinition[] {
    return this.atlas.agentRegistry.listAgents();
  }
}

function buildAgentContextValue(agent: AgentDefinition, enabled: boolean): string {
  const kind = agent.builtIn ? 'builtin' : 'custom';
  const state = enabled ? 'enabled' : 'disabled';
  return `agent-${kind}-${state}`;
}

// ── Skills ──────────────────────────────────────────────────────

/**
 * A tree item representing a single skill.
 * Exposes `skillId` so command handlers can address the right skill.
 */
export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly skillId: string,
    label: string,
    description: string | undefined,
    tooltip: vscode.MarkdownString,
    iconPath: vscode.ThemeIcon,
    contextValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.iconPath = iconPath;
    this.contextValue = contextValue;
  }
}

class SkillSectionItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: 'built-in-skills',
    label: string,
    description: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = description;
    this.contextValue = 'skill-section';
    this.iconPath = new vscode.ThemeIcon('package', new vscode.ThemeColor('charts.blue'));
  }
}

type SkillsTreeNode = SkillTreeItem | SkillSectionItem;

class SkillsTreeProvider implements vscode.TreeDataProvider<SkillsTreeNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SkillsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SkillsTreeNode): SkillsTreeNode {
    return element;
  }

  getChildren(element?: SkillsTreeNode): SkillsTreeNode[] {
    const allSkills = this.atlas.skillsRegistry.listSkills();

    if (!element) {
      const customSkills = allSkills
        .filter(skill => !skill.builtIn)
        .map(skill => this.buildItem(skill));
      const builtInSkills = allSkills.filter(skill => skill.builtIn);

      if (builtInSkills.length === 0) {
        return customSkills;
      }

      return [
        ...customSkills,
        new SkillSectionItem('built-in-skills', 'Built-in Skills', `${builtInSkills.length} bundled`),
      ];
    }

    if (element instanceof SkillSectionItem && element.sectionId === 'built-in-skills') {
      return allSkills
        .filter(skill => skill.builtIn)
        .map(skill => this.buildItem(skill));
    }

    return [];
  }

  private buildItem(skill: SkillDefinition): SkillTreeItem {
    const enabled = this.atlas.skillsRegistry.isEnabled(skill.id);
    const scanResult = this.atlas.skillsRegistry.getScanResult(skill.id);
    const tooltip = buildTooltip(skill, enabled, scanResult);
    const icon = buildIcon(enabled, scanResult);
    const contextValue = buildContextValue(skill, enabled);

    return new SkillTreeItem(skill.id, skill.name, undefined, tooltip, icon, contextValue);
  }
}

/** Context value encodes: skill-{builtin|custom}-{enabled|disabled} */
function buildContextValue(skill: SkillDefinition, enabled: boolean): string {
  const kind = skill.builtIn ? 'builtin' : 'custom';
  const state = enabled ? 'enabled' : 'disabled';
  return `skill-${kind}-${state}`;
}

function buildIcon(enabled: boolean, scanResult: SkillScanResult | undefined): vscode.ThemeIcon {
  if (!enabled) {
    return new vscode.ThemeIcon(
      'circle-slash',
      new vscode.ThemeColor('disabledForeground'),
    );
  }
  if (!scanResult || scanResult.status === 'not-scanned') {
    return new vscode.ThemeIcon(
      'circle-outline',
      new vscode.ThemeColor('charts.blue'),
    );
  }
  if (scanResult.status === 'failed') {
    return new vscode.ThemeIcon(
      'error',
      new vscode.ThemeColor('errorForeground'),
    );
  }
  // passed
  return new vscode.ThemeIcon(
    'pass-filled',
    new vscode.ThemeColor('charts.green'),
  );
}

function buildTooltip(
  skill: SkillDefinition,
  enabled: boolean,
  scanResult: SkillScanResult | undefined,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;

  md.appendMarkdown(`## ${skill.name}\n\n`);
  md.appendMarkdown(`${skill.description}\n\n`);

  md.appendMarkdown(`**Status:** ${enabled ? '✅ Enabled' : '⛔ Disabled'}\n\n`);

  // Scan status
  if (!scanResult || scanResult.status === 'not-scanned') {
    md.appendMarkdown(`**Security scan:** ⬜ Not yet run\n\n`);
  } else if (scanResult.status === 'passed') {
    const warnCount = scanResult.issues.filter(i => i.severity === 'warning').length;
    if (warnCount > 0) {
      md.appendMarkdown(`**Security scan:** ✅ Passed — ${warnCount} warning(s)\n\n`);
    } else {
      md.appendMarkdown(`**Security scan:** ✅ Passed — no issues\n\n`);
    }
  } else {
    const errors = scanResult.issues.filter(i => i.severity === 'error').length;
    const warnings = scanResult.issues.filter(i => i.severity === 'warning').length;
    md.appendMarkdown(`**Security scan:** ❌ Failed — ${errors} error(s), ${warnings} warning(s)\n\n`);
  }

  // Parameters
  const props = skill.parameters['properties'] as Record<string, Record<string, string>> | undefined;
  const required = skill.parameters['required'] as string[] | undefined;
  if (props && Object.keys(props).length > 0) {
    md.appendMarkdown(`**Parameters:**\n\n`);
    for (const [name, def] of Object.entries(props)) {
      const req = required?.includes(name) ? '' : ' *(optional)*';
      md.appendMarkdown(`- \`${name}\` (${def['type'] ?? 'any'})${req} — ${def['description'] ?? ''}\n`);
    }
    md.appendMarkdown('\n');
  }

  // Source
  if (skill.source) {
    md.appendMarkdown(`**Source:** \`${skill.source}\`\n\n`);
  } else if (skill.builtIn) {
    md.appendMarkdown(`**Source:** Built-in skill\n\n`);
  }

  // Scan issues detail
  if (scanResult && scanResult.issues.length > 0) {
    md.appendMarkdown('---\n\n**Scan issues:**\n\n');
    for (const issue of scanResult.issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      md.appendMarkdown(`${icon} **Line ${issue.line}** \`[${issue.rule}]\`\n\n`);
      md.appendMarkdown(`${issue.message}\n\n`);
      md.appendCodeblock(issue.snippet, 'javascript');
    }
  }

  return md;
}

// ── Memory ───────────────────────────────────────────────────────

class MemoryEntryTreeItem extends vscode.TreeItem {
  constructor(public readonly entry: MemoryEntry) {
    super(entry.title, vscode.TreeItemCollapsibleState.None);
    this.description = entry.path;
    this.contextValue = 'memory-entry';
    this.iconPath = new vscode.ThemeIcon('note', new vscode.ThemeColor('charts.blue'));
    this.command = {
      command: 'atlasmind.memory.openEntry',
      title: 'Edit Memory File',
      arguments: [this],
    };
    this.tooltip = buildMemoryTooltip(entry, this.review);
  }

  get review(): string {
    return buildMemoryReview(this.entry);
  }
}

class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private pageSize = 200;

  constructor(private atlas: AtlasMindContext) {}

  refresh(): void {
    this.pageSize = 200;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const entries = this.atlas.memoryManager.listEntries();
    if (entries.length === 0) {
      return [new vscode.TreeItem('No memory entries indexed', vscode.TreeItemCollapsibleState.None)];
    }

    const total = entries.length;
    const shown = Math.min(total, this.pageSize);
    const items: vscode.TreeItem[] = entries.slice(0, shown).map(entry => new MemoryEntryTreeItem(entry));
    if (total > shown) {
      const loadMore = new vscode.TreeItem(`Load more… (${total - shown} remaining)`, vscode.TreeItemCollapsibleState.None);
      loadMore.command = {
        command: 'atlasmind.memoryLoadMore',
        title: 'Load More Memory Entries',
      };
      items.push(loadMore);
    }
    return items;
  }

  loadMore(): void {
    this.pageSize += 200;
    this._onDidChangeTreeData.fire(undefined);
  }
}

function resolveMemoryEntryUri(entryPath: string): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const rawSsotPath = vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory');
  const ssotPath = getValidatedSsotPath(rawSsotPath ?? 'project_memory');
  if (!ssotPath) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, ssotPath, ...entryPath.split('/').filter(Boolean));
}

function buildMemoryTooltip(entry: MemoryEntry, review: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.appendMarkdown(`## ${entry.title}\n\n`);
  md.appendMarkdown(`**Path:** \`${entry.path}\`\n\n`);
  md.appendMarkdown(`${review}\n\n`);
  if (entry.tags.length > 0) {
    md.appendMarkdown(`**Tags:** ${entry.tags.map(tag => `\`${tag}\``).join(', ')}\n\n`);
  }
  md.appendMarkdown(`**Last indexed:** ${entry.lastModified}\n\n`);
  md.appendMarkdown('**Indexed snippet:**\n\n');
  md.appendMarkdown(`\`\`\`markdown\n${entry.snippet.slice(0, 240)}\n\`\`\``);
  return md;
}

function buildMemoryReview(entry: MemoryEntry): string {
  const folder = entry.path.split('/')[0] ?? 'memory';
  const folderLabel = folder.replace(/[-_]/g, ' ');
  const normalizedSnippet = entry.snippet.replace(/\s+/g, ' ').trim();
  const excerpt = normalizedSnippet.length > 140
    ? `${normalizedSnippet.slice(0, 137)}…`
    : normalizedSnippet;
  const tagSentence = entry.tags.length > 0
    ? ` It is tagged with ${entry.tags.slice(0, 4).join(', ')}.`
    : '';
  const contentSentence = excerpt.length > 0
    ? ` The indexed content suggests: ${excerpt}.`
    : ' The indexed content preview is currently empty.';

  return `This ${folderLabel} memory note appears to document "${entry.title}".${contentSentence}${tagSentence}`;
}

// ── Models ──────────────────────────────────────────────────────

export class ModelProviderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly providerId: string,
    label: string,
    description: string | undefined,
    public readonly enabled: boolean,
    public readonly configured: boolean,
    public readonly partiallyEnabled: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.description = description;
    const configState = configured ? 'configured' : 'unconfigured';
    const enabledState = enabled ? 'enabled' : 'disabled';
    this.contextValue = `model-provider-${configState}-${enabledState}`;
    this.tooltip = `${label}\nStatus: ${describeProviderStatus(enabled, configured, partiallyEnabled)}`;
    this.iconPath = getModelStatusIcon(enabled, configured);
  }
}

export class ModelTreeItem extends vscode.TreeItem {
  constructor(
    public readonly providerId: string,
    public readonly modelId: string,
    label: string,
    description: string | undefined,
    tooltip: string,
    public readonly enabled: boolean,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = enabled ? 'model-item-enabled' : 'model-item-disabled';
    this.iconPath = getModelStatusIcon(enabled, true);
  }
}

type ModelsTreeNode = ModelProviderTreeItem | ModelTreeItem | vscode.TreeItem;

class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ModelsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ModelsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ModelsTreeNode): Promise<ModelsTreeNode[]> {
    const providers = this.atlas.modelRouter.listProviders();
    if (providers.length === 0) {
      return [new vscode.TreeItem('No providers configured', vscode.TreeItemCollapsibleState.None)];
    }

    if (!element) {
      const items = await Promise.all(providers.map(async (provider, index) => {
        const configured = await this.atlas.isProviderConfigured(provider.id);
        const enabledModels = provider.models.filter(model => model.enabled).length;
        const partiallyEnabled = configured && provider.enabled && enabledModels !== provider.models.length;
        return {
          index,
          configured,
          item: new ModelProviderTreeItem(
          provider.id,
          provider.displayName,
          partiallyEnabled ? '(⚠)' : undefined,
          provider.enabled,
          configured,
          partiallyEnabled,
          configured && provider.models.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          ),
        };
      }));

      return items
        .sort((left, right) => {
          if (left.configured !== right.configured) {
            return left.configured ? -1 : 1;
          }
          return left.index - right.index;
        })
        .map(entry => entry.item);
    }

    if (element instanceof ModelProviderTreeItem) {
      if (!element.configured) {
        return [];
      }

      const provider = providers.find(candidate => candidate.id === element.providerId);
      if (!provider) {
        return [];
      }

      return provider.models.map(model => {
        const tooltip =
          `${model.id}\n` +
          `Status: ${describeModelStatus(model.enabled, true)}\n` +
          `Context: ${model.contextWindow.toLocaleString()}\n` +
          `Capabilities: ${model.capabilities.join(', ')}`;
        return new ModelTreeItem(
          provider.id,
          model.id,
          model.name,
          undefined,
          tooltip,
          model.enabled,
        );
      });
    }

    return [];
  }
}

function describeModelStatus(enabled: boolean, configured: boolean): string {
  if (!configured) {
    return 'not configured';
  }
  return enabled ? 'enabled' : 'disabled';
}

function describeProviderStatus(enabled: boolean, configured: boolean, partiallyEnabled: boolean): string {
  if (partiallyEnabled) {
    return 'enabled (some models disabled)';
  }
  return describeModelStatus(enabled, configured);
}

function getModelStatusIcon(enabled: boolean, configured: boolean): vscode.ThemeIcon {
  if (!configured) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }

  if (enabled) {
    return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  }

  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
}

class ProjectRunsTreeProvider implements vscode.TreeDataProvider<ProjectRunRecord> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ProjectRunRecord | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProjectRunRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(element.goal, vscode.TreeItemCollapsibleState.None);
    item.description = `${element.status} • ${element.completedSubtaskCount}/${element.totalSubtaskCount}`;
    item.tooltip = new vscode.MarkdownString(
      `**${element.goal}**\n\n` +
      `Status: ${element.status}\n\n` +
      `Estimated files: ~${element.estimatedFiles}\n\n` +
      `Updated: ${element.updatedAt}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      element.status === 'completed'
        ? 'check'
        : element.status === 'failed'
          ? 'error'
          : element.status === 'running'
            ? 'sync'
            : 'eye',
    );
    item.command = {
      command: 'atlasmind.openProjectRunCenter',
      title: 'Open Project Run Center',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(): Thenable<ProjectRunRecord[]> {
    return this.atlas.projectRunHistory.listRunsAsync(20);
  }
}

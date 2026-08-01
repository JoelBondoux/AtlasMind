import * as vscode from 'vscode';
import { getValidatedSsotPath } from '../bootstrap/bootstrapper.js';
import type { AtlasMindContext } from '../extension.js';
import {
  buildProjectState,
  countAttentionItems,
  hasProjectState,
  type ProjectStateInput,
  type ProjectStateSection,
} from '../core/projectStateTree.js';
import {
  explainAutomationLevel,
  resolveRestrictiveFlag,
  resolveRestrictiveLevel,
} from '../core/workflowAutomation.js';
import { SSOT_FOLDERS } from '../types.js';
import type { AgentDefinition, ArdDiscoveredResource, ArdDiscoveryEndpoint, McpServerState, MemoryEntry, ProjectRunRecord, ProviderConfig, SkillDefinition, SkillScanResult } from '../types.js';
import { ACP_PROVIDER_ID, findAcpBridge, parseAcpAgentSettings, peekAcpAgentProbe } from '../providers/acp.js';
import { countOverdueFollowUps, deriveFollowUpUrgency, resolveTeamMode } from '../core/projectDirectorManager.js';
import { assessPipelinePromotions } from '../core/promotionReadiness.js';
import type { SessionConversationSummary, SessionFolderSummary } from '../chat/sessionConversation.js';
import { ChatViewProvider } from './chatPanel.js';
import {
  isModelSidebarBridgeHidden,
  isModelSidebarModelHidden,
  isModelSidebarProviderHidden,
  readHiddenModelSidebarEntries,
  type ModelSidebarVisibilityReader,
} from './modelSidebarVisibility.js';

const SESSION_TREE_MIME = 'application/vnd.atlasmind.sessions';

export type SessionRenameTarget = ChatSessionTreeItem | SessionFolderTreeItem;

let selectedSessionRenameTarget: SessionRenameTarget | undefined;

export function getSelectedSessionRenameTarget(): SessionRenameTarget | undefined {
  return selectedSessionRenameTarget;
}

function isSessionRenameTarget(value: unknown): value is SessionRenameTarget {
  return value instanceof ChatSessionTreeItem || value instanceof SessionFolderTreeItem;
}

/**
 * Registers all sidebar tree-view providers.
 */
export function registerTreeViews(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const chatViewProvider = new ChatViewProvider(context.extensionUri, atlas);
  const skillsProvider = new SkillsTreeProvider(atlas);
  const agentsProvider = new AgentsTreeProvider(atlas);
  const sessionsProvider = new SessionsTreeProvider(atlas);
  const sessionsTreeView = vscode.window.createTreeView('atlasmind.sessionsView', {
    treeDataProvider: sessionsProvider,
    dragAndDropController: sessionsProvider,
    showCollapseAll: true,
  });
  sessionsTreeView.onDidChangeSelection(event => {
    selectedSessionRenameTarget = event.selection.find(isSessionRenameTarget);
  });
  const modelsProvider = new ModelsTreeProvider(atlas, context.globalState);
  const modelsTreeView = vscode.window.createTreeView('atlasmind.modelsView', {
    treeDataProvider: modelsProvider,
  });
  const projectRunsProvider = new ProjectRunsTreeProvider(atlas);
  const mcpServersProvider = new McpServersTreeProvider(atlas);
  const discoveryProvider = new DiscoveryTreeProvider(atlas);
  const memoryProvider = new MemoryTreeProvider(atlas);
  const projectDirectorProvider = new ProjectDirectorTreeProvider(atlas);
  const projectDirectorTreeView = vscode.window.createTreeView('atlasmind.projectDirectorView', {
    treeDataProvider: projectDirectorProvider,
  });
  const projectStateProvider = new ProjectStateTreeProvider(atlas);
  const projectStateTreeView = vscode.window.createTreeView('atlasmind.projectStateView', {
    treeDataProvider: projectStateProvider,
  });
  /**
   * Badge and visibility, recomputed together.
   *
   * The badge counts only rows that need a person — one that counted
   * everything would be permanently non-zero and therefore ignored. The
   * context key hides the view entirely when nothing could be assessed, so a
   * row never sits in the sidebar with nothing to say.
   */
  const refreshProjectState = (): void => {
    projectStateProvider.refresh();
    // This runs during activation, so a failure to gather must not take the
    // other nine views down with it. An unreadable state means the view hides,
    // which is exactly what it should do when it has nothing to say.
    let sections: ProjectStateSection[] = [];
    try {
      sections = projectStateProvider.compute();
    } catch {
      sections = [];
    }
    const waiting = countAttentionItems(sections);
    projectStateTreeView.badge = waiting > 0
      ? { value: waiting, tooltip: `${waiting} thing${waiting === 1 ? '' : 's'} waiting on you` }
      : undefined;
    void vscode.commands.executeCommand('setContext', 'atlasmind.hasProjectState', hasProjectState(sections));
  };
  /**
   * Hide views that have nothing to say.
   *
   * Only **pure-inventory** views are hidden: a project with no MCP servers or
   * no past runs does not need a row telling it so. Views that are the *only*
   * entry point to a feature — Discovery, Director, Agents, Skills, Models —
   * stay visible even when empty, because hiding them would make the feature
   * undiscoverable, which is a worse problem than a quiet row.
   */
  const refreshEmptyViewContexts = (): void => {
    const set = (key: string, value: boolean): void => {
      void vscode.commands.executeCommand('setContext', key, value);
    };
    set('atlasmind.hasProjectRuns', (atlas.projectRunHistory?.listRuns() ?? []).length > 0);
    set('atlasmind.hasSessions', (atlas.sessionConversation?.listSessions?.() ?? []).length > 0);
    set('atlasmind.hasMcpServers', (atlas.mcpServerRegistry?.listServers?.() ?? []).length > 0);
  };

  const refreshDirectorBadge = (): void => {
    const overdue = countOverdueFollowUps(atlas.projectDirectorManager?.getConfig());
    projectDirectorTreeView.badge = overdue > 0
      ? { value: overdue, tooltip: `${overdue} overdue follow-up${overdue === 1 ? '' : 's'}` }
      : undefined;
  };
  refreshDirectorBadge();
  refreshProjectState();
  refreshEmptyViewContexts();
  atlas.agentsRefresh.event(() => agentsProvider.refresh());
  atlas.skillsRefresh.event(() => skillsProvider.refresh());
  atlas.skillsRefresh.event(() => mcpServersProvider.refresh());
  atlas.discoveryRefresh.event(() => discoveryProvider.refresh());
  atlas.sessionConversation.onDidChange(() => sessionsProvider.refresh());
  atlas.modelsRefresh.event(() => {
    modelsProvider.refresh();
    const autoDisabledCount = getSessionAutoDisabledCount(atlas);
    if (modelsTreeView) {
      modelsTreeView.badge = autoDisabledCount > 0
        ? { value: autoDisabledCount, tooltip: `${autoDisabledCount} provider${autoDisabledCount === 1 ? '' : 's'} auto-paused due to billing or auth issues` }
        : undefined;
    }
    void vscode.commands.executeCommand('setContext', 'atlasmind.hasAutoPausedProviders', autoDisabledCount > 0);
  });
  // Both the state view and the hide-empty keys follow the same events as the
  // providers they summarise, so a stale badge cannot outlive its data.
  atlas.projectRunsRefresh.event(() => { refreshProjectState(); refreshEmptyViewContexts(); });
  atlas.skillsRefresh.event(() => refreshEmptyViewContexts());
  atlas.projectRunsRefresh.event(() => projectRunsProvider.refresh());
  atlas.projectRunsRefresh.event(() => sessionsProvider.refresh());
  atlas.memoryRefresh.event(() => memoryProvider.refresh());
  atlas.projectDirectorRefresh?.event(() => { projectDirectorProvider.refresh(); refreshDirectorBadge(); });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: false } },
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.agentsView',
      agentsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.skillsView',
      skillsProvider,
    ),
    sessionsTreeView,
    vscode.window.registerTreeDataProvider(
      'atlasmind.memoryView',
      memoryProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.mcpServersView',
      mcpServersProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.discoveryView',
      discoveryProvider,
    ),
    modelsTreeView,
    projectDirectorTreeView,
    vscode.window.registerTreeDataProvider(
      'atlasmind.projectRunsView',
      projectRunsProvider,
    ),
    // Exposed as a command so the view's titlebar can offer it. The function
    // already existed and only the tree's own events reached it — a glance
    // surface whose only way to update is an unrelated event firing is one
    // people learn not to trust.
    vscode.commands.registerCommand('atlasmind.refreshProjectState', () => {
      refreshProjectState();
    }),
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
      await postSidebarSummaryToChat(
        atlas,
        `Memory Summary: ${item.entry.title}`,
        buildMemoryChatSummary(item.entry),
      );
    }),
  );
}

const INFO_SESSION_TITLE = 'Model & Provider Info';

export async function postSidebarSummaryToChat(
  atlas: AtlasMindContext,
  heading: string,
  body: string,
): Promise<void> {
  // Route info cards to a dedicated session so they never interrupt the active
  // working session. Recreate the session if the user has deleted or archived it.
  const existing = atlas.sessionConversation.listSessions().find(s => s.title === INFO_SESSION_TITLE);
  const infoSessionId = existing?.id ?? atlas.sessionConversation.spawnSession(INFO_SESSION_TITLE);
  const messageId = atlas.sessionConversation.appendMessage(
    'assistant',
    `## ${heading}\n\n${body.trim()}`,
    infoSessionId,
    undefined,
    // Sidebar info cards are reference material, not part of the task dialogue.
    // Exclude them from session context so they don't distort routing or cost.
    { classification: 'irrelevant', relevanceWeight: 0 },
  );
  await ChatViewProvider.open({ sessionId: infoSessionId, messageId });
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
    if (sectionId === 'chat-sessions') {
      this.tooltip = new vscode.MarkdownString('Drag archived sessions here to restore them to the top level.');
    }
  }
}

export class ChatSessionTreeItem extends vscode.TreeItem {
  constructor(public readonly session: SessionConversationSummary) {
    super(session.title, vscode.TreeItemCollapsibleState.None);
    this.description = `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`;
    this.tooltip = new vscode.MarkdownString(
      `**${session.title}**\n\n` +
      `${session.preview}\n\n` +
      (session.isArchived ? `Archived: ${session.archivedAt}\n\n` : '') +
      (session.folderId ? `Filed in a session folder.\n\n` : '') +
      `Updated: ${session.updatedAt}`,
    );
    this.iconPath = new vscode.ThemeIcon(
      session.isArchived ? 'archive' : session.isActive ? 'comment-discussion' : 'comment',
      new vscode.ThemeColor(session.isArchived ? 'charts.yellow' : session.isActive ? 'charts.blue' : 'descriptionForeground'),
    );
    this.contextValue = session.isArchived ? 'chat-session-archived' : session.isActive ? 'chat-session-active' : 'chat-session';
    this.command = {
      command: 'atlasmind.openChatView',
      title: 'Open Chat View',
      arguments: [session.id],
    };
  }
}

class SessionArchiveTreeItem extends vscode.TreeItem {
  constructor(public readonly sessionCount: number) {
    super('Archive', vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
    this.tooltip = new vscode.MarkdownString('Drag chat sessions here to archive them. Drag archived sessions back onto Chat Sessions or a folder to restore them.');
    this.contextValue = 'chat-session-archive-folder';
    this.iconPath = new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.yellow'));
  }
}

export class SessionFolderTreeItem extends vscode.TreeItem {
  constructor(public readonly folder: SessionFolderSummary) {
    super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${folder.sessionCount} session${folder.sessionCount === 1 ? '' : 's'}`;
    this.tooltip = new vscode.MarkdownString(
      `**${folder.name}**\n\n` +
      `${folder.sessionCount} filed session${folder.sessionCount === 1 ? '' : 's'}.\n\n` +
      `Updated: ${folder.updatedAt}`,
    );
    this.contextValue = 'chat-session-folder';
    this.iconPath = new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
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

type SessionsTreeNode = SessionSectionItem | ChatSessionTreeItem | SessionFolderTreeItem | SessionArchiveTreeItem | ProjectRunSessionTreeItem;

class SessionsTreeProvider implements vscode.TreeDataProvider<SessionsTreeNode>, vscode.TreeDragAndDropController<SessionsTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly dragMimeTypes = [SESSION_TREE_MIME];
  readonly dropMimeTypes = [SESSION_TREE_MIME];

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionsTreeNode): Promise<SessionsTreeNode[]> {
    const sessions = this.atlas.sessionConversation.listSessions();
    const archivedSessions = this.atlas.sessionConversation.listArchivedSessions();
    const folders = this.atlas.sessionConversation.listFolders();
    const runs = await this.atlas.projectRunHistory.listRunsAsync(12);

    if (!element) {
      const roots: SessionsTreeNode[] = [];
      if (sessions.length > 0 || archivedSessions.length > 0 || folders.length > 0) {
        const description = archivedSessions.length > 0
          ? `${sessions.length} active • ${archivedSessions.length} archived`
          : `${sessions.length} available`;
        roots.push(new SessionSectionItem('chat-sessions', 'Chat Sessions', description));
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
      return [
        ...(archivedSessions.length > 0 ? [new SessionArchiveTreeItem(archivedSessions.length)] : []),
        ...folders.map(folder => new SessionFolderTreeItem(folder)),
        ...sessions
          .filter(session => !session.folderId)
          .map(session => new ChatSessionTreeItem(session)),
      ];
    }

    if (element instanceof SessionArchiveTreeItem) {
      return archivedSessions.map(session => new ChatSessionTreeItem(session));
    }

    if (element instanceof SessionFolderTreeItem) {
      return sessions
        .filter(session => session.folderId === element.folder.id)
        .map(session => new ChatSessionTreeItem(session));
    }

    if (element instanceof SessionSectionItem && element.sectionId === 'project-runs') {
      return runs.map(run => new ProjectRunSessionTreeItem(run));
    }

    return [];
  }

  async handleDrag(sources: readonly SessionsTreeNode[], treeDataTransfer: vscode.DataTransfer): Promise<void> {
    const sessionIds = sources
      .filter((source): source is ChatSessionTreeItem => isChatSessionDragSource(source))
      .map(source => source.session.id);
    if (sessionIds.length === 0) {
      return;
    }
    treeDataTransfer.set(SESSION_TREE_MIME, new vscode.DataTransferItem(JSON.stringify(sessionIds)));
  }

  async handleDrop(target: SessionsTreeNode | undefined, treeDataTransfer: vscode.DataTransfer): Promise<void> {
    const sessionIds = await readDraggedSessionIds(treeDataTransfer);
    if (sessionIds.length === 0 || !target) {
      return;
    }

    for (const sessionId of sessionIds) {
      if (isSessionArchiveDropTarget(target)) {
        this.atlas.sessionConversation.archiveSession(sessionId);
        continue;
      }

      if (isSessionFolderDropTarget(target)) {
        this.atlas.sessionConversation.unarchiveSession(sessionId);
        this.atlas.sessionConversation.assignSessionToFolder(sessionId, target.folder.id);
        continue;
      }

      if (isChatSessionsDropTarget(target)) {
        this.atlas.sessionConversation.unarchiveSession(sessionId);
        this.atlas.sessionConversation.assignSessionToFolder(sessionId, undefined);
      }
    }
  }
}

function isSessionArchiveDropTarget(target: SessionsTreeNode): target is SessionArchiveTreeItem {
  return target instanceof SessionArchiveTreeItem
    || target.contextValue === 'chat-session-archive-folder';
}

function isChatSessionDragSource(target: SessionsTreeNode): target is ChatSessionTreeItem {
  return (target instanceof ChatSessionTreeItem
    || target.contextValue === 'chat-session'
    || target.contextValue === 'chat-session-active'
    || target.contextValue === 'chat-session-archived')
    && 'session' in target
    && typeof target.session === 'object'
    && target.session !== null
    && 'id' in target.session
    && typeof target.session.id === 'string';
}

function isSessionFolderDropTarget(target: SessionsTreeNode): target is SessionFolderTreeItem {
  return (target instanceof SessionFolderTreeItem || target.contextValue === 'chat-session-folder')
    && 'folder' in target
    && typeof target.folder === 'object'
    && target.folder !== null
    && 'id' in target.folder
    && typeof target.folder.id === 'string';
}

function isChatSessionsDropTarget(target: SessionsTreeNode): target is SessionSectionItem {
  return (target instanceof SessionSectionItem || 'sectionId' in target)
    && target.sectionId === 'chat-sessions';
}

async function readDraggedSessionIds(treeDataTransfer: vscode.DataTransfer): Promise<string[]> {
  const item = treeDataTransfer.get(SESSION_TREE_MIME);
  if (!item) {
    return [];
  }
  const raw = typeof item.asString === 'function'
    ? await item.asString()
    : typeof item.value === 'string'
      ? item.value
      : '';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
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
    // If there are no agents, show a warning item
    if (this.atlas.agentRegistry.listAgents().length === 0) {
      const isActivating = (globalThis as any).atlasmindActivating === true;
      const warning = new vscode.TreeItem(isActivating ? 'AtlasMind is still activating…' : 'No agents registered', vscode.TreeItemCollapsibleState.None);
      warning.tooltip = new vscode.MarkdownString(isActivating ? 'AtlasMind is still activating. Agents will appear here once ready.' : 'No agents registered.');
      return warning;
    }
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
    item.command = {
      command: 'atlasmind.openAgentPanel',
      title: 'Open Agent Manager',
      arguments: [element.id],
    };
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

class SkillGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupKind: 'built-in-root' | 'built-in-category',
    public readonly groupId: string,
    label: string,
    description: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = description;
    this.contextValue = groupKind === 'built-in-root' ? 'skill-section' : 'skill-category';
    this.iconPath = new vscode.ThemeIcon(
      groupKind === 'built-in-root' ? 'package' : 'folder-library',
      new vscode.ThemeColor('charts.blue'),
    );
  }
}

export class SkillFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    label: string,
    description: string | undefined,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = description;
    this.contextValue = 'skill-folder';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

type SkillsTreeNode = SkillTreeItem | SkillGroupItem | SkillFolderTreeItem;

class SkillsTreeProvider implements vscode.TreeDataProvider<SkillsTreeNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<SkillsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SkillsTreeNode): vscode.TreeItem {
    // If this is a warning node, always provide a MarkdownString for tooltip
    if (element instanceof SkillTreeItem && element.skillId === '__warning__') {
      if (!element.tooltip) {
        element.tooltip = new vscode.MarkdownString('No skills registered.');
      }
    }
    return element as vscode.TreeItem;
  }

  getChildren(element?: SkillsTreeNode): SkillsTreeNode[] {
    const allSkills = this.atlas.skillsRegistry.listSkills();
    const builtInSkills = sortSkills(allSkills.filter(skill => skill.builtIn));
    const userCustomSkills = sortSkills(allSkills.filter(skill => isUserCustomSkill(skill)));
    const customFolders = collectCustomFolderPaths(
      this.atlas.skillsRegistry.listCustomFolders(),
      userCustomSkills,
    );
    const builtInCategories = collectBuiltInCategories(builtInSkills);

    if (!element) {
      if (builtInSkills.length === 0 && userCustomSkills.length === 0) {
        const isActivating = (globalThis as any).atlasmindActivating === true;
        // Return a SkillTreeItem as a warning node
        const warningTooltip = new vscode.MarkdownString(
          isActivating
            ? 'AtlasMind is still activating. Skills will appear here once ready.'
            : 'No skills registered.',
        );
        return [
          new SkillTreeItem(
            '__warning__',
            isActivating ? 'AtlasMind is still activating…' : 'No skills registered',
            undefined,
            warningTooltip,
            new vscode.ThemeIcon('info'),
            'skill-warning',
          ),
        ];
      }
      const rootFolders = getDirectChildFolderPaths(customFolders);
      const rootSkills = userCustomSkills
        .filter(skill => !getSkillFolderPath(skill))
        .map(skill => this.buildItem(skill));
      const nodes: SkillsTreeNode[] = [
        ...rootFolders.map(folderPath => this.buildFolderItem(folderPath, customFolders, userCustomSkills)),
        ...rootSkills,
      ];

      if (builtInSkills.length > 0) {
        nodes.push(new SkillGroupItem('built-in-root', 'built-in-skills', 'Built-in Skills', `${builtInSkills.length} bundled`));
      }

      return nodes;
    }

    if (element instanceof SkillFolderTreeItem) {
      const childFolders = getDirectChildFolderPaths(customFolders, element.folderPath);
      const childSkills = userCustomSkills
        .filter(skill => getSkillFolderPath(skill) === element.folderPath)
        .map(skill => this.buildItem(skill));

      return [
        ...childFolders.map(folderPath => this.buildFolderItem(folderPath, customFolders, userCustomSkills)),
        ...childSkills,
      ];
    }

    if (element instanceof SkillGroupItem && element.groupKind === 'built-in-root') {
      return builtInCategories.map(([category, skills]) => new SkillGroupItem(
        'built-in-category',
        category,
        category,
        `${skills.length} skill${skills.length === 1 ? '' : 's'}`,
      ));
    }

    if (element instanceof SkillGroupItem && element.groupKind === 'built-in-category') {
      return builtInSkills
        .filter(skill => getBuiltInCategory(skill) === element.groupId)
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

  private buildFolderItem(
    folderPath: string,
    allFolderPaths: string[],
    skills: SkillDefinition[],
  ): SkillFolderTreeItem {
    const childCount = getDirectChildFolderPaths(allFolderPaths, folderPath).length +
      skills.filter(skill => getSkillFolderPath(skill) === folderPath).length;
    return new SkillFolderTreeItem(folderPath, getFolderLabel(folderPath), `${childCount} item${childCount === 1 ? '' : 's'}`);
  }
}

/** Context value encodes: skill-{builtin|custom}-{enabled|disabled} */
function buildContextValue(skill: SkillDefinition, enabled: boolean): string {
  const kind = skill.builtIn ? 'builtin' : isMcpSkill(skill) ? 'mcp' : 'custom';
  const state = enabled ? 'enabled' : 'disabled';
  return `skill-${kind}-${state}`;
}

function sortSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return [...skills].sort((left, right) => left.name.localeCompare(right.name));
}

function isUserCustomSkill(skill: SkillDefinition): boolean {
  return !skill.builtIn && !isMcpSkill(skill);
}

function isMcpSkill(skill: Pick<SkillDefinition, 'id' | 'source'>): boolean {
  return skill.id.startsWith('mcp:') || skill.source?.startsWith('mcp://') === true;
}

function getBuiltInCategory(skill: SkillDefinition): string {
  return skill.panelPath?.[0] ?? 'General';
}

function collectBuiltInCategories(skills: SkillDefinition[]): Array<[string, SkillDefinition[]]> {
  const groups = new Map<string, SkillDefinition[]>();
  for (const skill of skills) {
    const category = getBuiltInCategory(skill);
    const items = groups.get(category) ?? [];
    items.push(skill);
    groups.set(category, items);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function getSkillFolderPath(skill: SkillDefinition): string | undefined {
  if (!isUserCustomSkill(skill)) {
    return undefined;
  }

  return normalizeFolderPath(skill.panelPath);
}

function collectCustomFolderPaths(explicitFolders: string[], skills: SkillDefinition[]): string[] {
  const folderPaths = new Set<string>();

  for (const folderPath of explicitFolders) {
    addFolderAncestors(folderPaths, folderPath);
  }

  for (const skill of skills) {
    const folderPath = getSkillFolderPath(skill);
    if (folderPath) {
      addFolderAncestors(folderPaths, folderPath);
    }
  }

  return [...folderPaths].sort((left, right) => left.localeCompare(right));
}

function addFolderAncestors(folderPaths: Set<string>, folderPath: string): void {
  const segments = folderPath.split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    folderPaths.add(current);
  }
}

function getDirectChildFolderPaths(folderPaths: string[], parentPath?: string): string[] {
  const parentDepth = parentPath ? parentPath.split('/').length : 0;
  const prefix = parentPath ? `${parentPath}/` : '';

  return folderPaths.filter(folderPath => {
    if (parentPath) {
      if (!folderPath.startsWith(prefix)) {
        return false;
      }
    } else if (folderPath.includes('/')) {
      return false;
    }

    return folderPath.split('/').length === parentDepth + 1;
  });
}

function getFolderLabel(folderPath: string): string {
  const segments = folderPath.split('/');
  return segments[segments.length - 1] ?? folderPath;
}

function normalizeFolderPath(folderPath: string | string[] | undefined): string | undefined {
  if (!folderPath) {
    return undefined;
  }

  const segments = Array.isArray(folderPath)
    ? folderPath
    : folderPath.split(/[\\/]+/);
  const normalized = segments
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);

  return normalized.length > 0 ? normalized.join('/') : undefined;
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

// ── MCP Servers ────────────────────────────────────────────────

export class McpServerTreeItem extends vscode.TreeItem {
  constructor(public readonly state: McpServerState) {
    super(state.config.name, vscode.TreeItemCollapsibleState.None);
    this.description = describeMcpServerItem(state);
    this.contextValue = `mcp-server-${state.status}`;
    this.tooltip = buildMcpServerTooltip(state);
    this.iconPath = getMcpServerIcon(state);
    this.command = {
      command: 'atlasmind.openMcpServers',
      title: 'Open MCP Servers',
    };
  }
}

class McpServersTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    // If there are no servers, show a warning item
    const servers = this.atlas.mcpServerRegistry.listServers();
    if (servers.length === 0) {
      const isActivating = (globalThis as any).atlasmindActivating === true;
      const parent = new vscode.TreeItem(isActivating ? 'AtlasMind is still activating…' : 'No MCP servers configured', vscode.TreeItemCollapsibleState.None);
      parent.tooltip = new vscode.MarkdownString(isActivating ? 'AtlasMind is still activating. MCP servers will appear here once ready.' : 'No MCP servers configured.');
      parent.contextValue = 'mcp-warning';
      return parent;
    }
    return element instanceof McpServerTreeItem ? element : new McpServerTreeItem(element as any);
  }

  getChildren(): vscode.TreeItem[] {
    return this.atlas.mcpServerRegistry.listServers().map(server => new McpServerTreeItem(server));
  }
}

function describeMcpServerItem(state: McpServerState): string {
  const toolCount = state.tools.length;
  return `${state.status} • ${toolCount} tool${toolCount === 1 ? '' : 's'}`;
}

function buildMcpServerTooltip(state: McpServerState): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.appendMarkdown(`## ${state.config.name}\n\n`);
  md.appendMarkdown(`**Status:** ${state.status}\n\n`);
  md.appendMarkdown(`**Transport:** ${state.config.transport}\n\n`);
  md.appendMarkdown(`**Enabled on startup:** ${state.config.enabled ? 'yes' : 'no'}\n\n`);
  if (state.config.url) {
    md.appendMarkdown(`**URL:** \`${state.config.url}\`\n\n`);
  }
  if (state.config.command) {
    const args = state.config.args?.join(' ') ?? '';
    md.appendMarkdown(`**Command:** \`${state.config.command}${args ? ` ${args}` : ''}\`\n\n`);
  }
  if (state.error) {
    md.appendMarkdown(`**Last error:** ${state.error}\n\n`);
  }
  if (state.tools.length > 0) {
    md.appendMarkdown(`**Tools:** ${state.tools.map(tool => `\`${tool.name}\``).join(', ')}\n\n`);
  }
  return md;
}

function getMcpServerIcon(state: McpServerState): vscode.ThemeIcon {
  if (state.status === 'connected') {
    return new vscode.ThemeIcon('plug', new vscode.ThemeColor('testing.iconPassed'));
  }
  if (state.status === 'connecting') {
    return new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
  }
  if (state.status === 'error') {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }
  return new vscode.ThemeIcon('plug', new vscode.ThemeColor('disabledForeground'));
}

// ── Resource Discovery (ARD) ──────────────────────────────────────

type DiscoveryTreeNode = DiscoveryGroupItem | DiscoveryFinderItem | DiscoveryResultItem;

class DiscoveryGroupItem extends vscode.TreeItem {
  constructor(public readonly group: 'finders' | 'results', label: string, count: number) {
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `ard-group-${group}`;
    this.iconPath = new vscode.ThemeIcon(group === 'finders' ? 'broadcast' : 'search');
  }
}

export class DiscoveryFinderItem extends vscode.TreeItem {
  constructor(public readonly endpoint: ArdDiscoveryEndpoint) {
    super(endpoint.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${endpoint.enabled ? 'enabled' : 'disabled'} · ${endpoint.kind}`;
    this.contextValue = endpoint.enabled ? 'ard-finder-enabled' : 'ard-finder-disabled';
    this.tooltip = new vscode.MarkdownString(`**${endpoint.name}**\n\n${endpoint.url}\n\nEnabled: ${endpoint.enabled ? 'yes' : 'no'}`);
    this.iconPath = new vscode.ThemeIcon(
      endpoint.enabled ? 'broadcast' : 'circle-slash',
      new vscode.ThemeColor(endpoint.enabled ? 'testing.iconPassed' : 'disabledForeground'),
    );
    this.command = { command: 'atlasmind.openResourceDiscovery', title: 'Open Resource Discovery' };
  }
}

export class DiscoveryResultItem extends vscode.TreeItem {
  constructor(public readonly resource: ArdDiscoveredResource) {
    super(resource.displayName, vscode.TreeItemCollapsibleState.None);
    const score = typeof resource.score === 'number' ? ` · ${resource.score}/100` : '';
    this.description = `${shortArdType(resource.type)}${score}`;
    this.contextValue = 'ard-result';
    const md = new vscode.MarkdownString(`**${resource.displayName}**\n\n\`${resource.identifier}\`\n\nType: ${resource.type}\n\nvia ${resource.sourceName}`);
    if (resource.description) {
      md.appendMarkdown(`\n\n${resource.description}`);
    }
    md.appendMarkdown(`\n\n_Score is relevance only — not a trust or safety rating._`);
    this.tooltip = md;
    this.iconPath = new vscode.ThemeIcon('package');
    this.command = { command: 'atlasmind.openResourceDiscovery', title: 'Open Resource Discovery' };
  }
}

class DiscoveryTreeProvider implements vscode.TreeDataProvider<DiscoveryTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DiscoveryTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DiscoveryTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DiscoveryTreeNode): DiscoveryTreeNode[] {
    const finders = this.atlas.ardRegistry.list();
    const results = this.atlas.ardRegistry.getRecentResults();

    if (!element) {
      const groups: DiscoveryTreeNode[] = [new DiscoveryGroupItem('finders', 'Agent Finders', finders.length)];
      if (results.length > 0) {
        groups.push(new DiscoveryGroupItem('results', 'Recent Results', results.length));
      }
      return groups;
    }

    if (element instanceof DiscoveryGroupItem && element.group === 'finders') {
      if (finders.length === 0) {
        const empty = new vscode.TreeItem('No finders configured', vscode.TreeItemCollapsibleState.None);
        empty.contextValue = 'ard-empty';
        return [empty as DiscoveryTreeNode];
      }
      return finders.map(endpoint => new DiscoveryFinderItem(endpoint));
    }

    if (element instanceof DiscoveryGroupItem && element.group === 'results') {
      return results.map(resource => new DiscoveryResultItem(resource));
    }

    return [];
  }
}

// ── Project Director tree ────────────────────────────────────────

type DirectorTreeNode = DirectorGroupItem | DirectorEntryItem;

class DirectorGroupItem extends vscode.TreeItem {
  constructor(public readonly group: 'stakeholders' | 'team' | 'followups', label: string, count: number, icon: string) {
    super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = `director-group-${group}`;
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class DirectorEntryItem extends vscode.TreeItem {
  constructor(label: string, description: string, icon: string, color?: string) {
    super(label || '—', vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
    this.command = { command: 'atlasmind.openProjectDirector', title: 'Open Project Director' };
  }
}

/**
 * The Project State view: where you are, what AtlasMind may do, what needs you.
 *
 * Deliberately narrow. Nothing here duplicates Source Control or a GitHub
 * extension — no commits, branches, diffs or issue lists. Only facts that exist
 * because AtlasMind exists, and only ones worth a glance rather than a panel.
 *
 * The model is built by `projectStateTree.ts`, which is pure and tested; this
 * class is a renderer. Sections whose data could not be gathered are omitted
 * there rather than shown empty, so the honesty rule survives the trip.
 */
class ProjectStateTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sections: ProjectStateSection[] = [];

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Rebuild the model and return it.
   *
   * Deliberately independent of `getChildren`. The badge and the `when` clause
   * are computed from this, and reading a cache that only `getChildren` fills
   * created a deadlock: the view was hidden because it had no sections, and it
   * had no sections because being hidden meant `getChildren` never ran. It
   * could never appear.
   */
  compute(): ProjectStateSection[] {
    this.sections = buildProjectState(this.gather());
    return this.sections;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      this.compute();
      return this.sections.map(section => {
        const item = new vscode.TreeItem(
          section.label,
          section.expanded
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.id = `state.${section.id}`;
        item.iconPath = new vscode.ThemeIcon(section.icon);
        item.tooltip = section.tooltip;
        item.contextValue = `atlasmind.state.${section.id}`;
        return item;
      });
    }

    const sectionId = String(element.id ?? '').replace(/^state\./, '');
    const section = this.sections.find(candidate => candidate.id === sectionId);
    return (section?.nodes ?? []).map(node => {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.id = `state.node.${node.id}`;
      if (node.description) {
        item.description = node.description;
      }
      if (node.tooltip) {
        item.tooltip = node.tooltip;
      }
      if (node.icon) {
        item.iconPath = new vscode.ThemeIcon(node.icon);
      }
      if (node.command) {
        item.command = {
          command: node.command.command,
          title: node.command.title,
          ...(node.command.args ? { arguments: node.command.args } : {}),
        };
      }
      return item;
    });
  }

  /**
   * Gather what is cheap and already in memory.
   *
   * A tree refreshes on unrelated events, so this must not read the network or
   * walk the workspace. Anything unavailable is left `undefined`, and the model
   * omits that section rather than guessing — which is why the input type is
   * optional throughout.
   */
  private gather(): ProjectStateInput {
    const input: ProjectStateInput = {};

    const configuration = vscode.workspace.getConfiguration('atlasmind');
    const flag = (key: string): boolean =>
      resolveRestrictiveFlag(configuration.inspect<boolean>(key) ?? {});
    const decision = explainAutomationLevel({
      masterEnabled: flag('workflow.enabled'),
      userCeiling: resolveRestrictiveLevel(configuration.inspect<string>('workflow.maxAutomationLevel') ?? {}),
      capabilityEnabled: true,
      stageLevel: 'auto',
    });
    input.automation = {
      masterEnabled: flag('workflow.enabled'),
      effective: decision.level,
      limitedBy: decision.limitedBy,
      detail: decision.detail,
      capabilities: [
        { label: 'Issue writes', enabled: flag('workflow.allowIssueWrites') },
        { label: 'Pull request writes', enabled: flag('workflow.allowPullRequestWrites') },
        { label: 'Release writes', enabled: flag('workflow.allowReleaseWrites') },
        { label: 'Protected branch writes', enabled: flag('workflow.allowProtectedRefWrites') },
      ],
    };

    // The delivery pipeline is already in memory on its manager, so assessing
    // every promotion path costs nothing — which is the constraint that decides
    // what this section may claim. See `promotionReadiness.ts`: the verdicts are
    // about what is *declared*, because git and CI are not reachable from a
    // synchronous gather.
    const deliveryConfig = this.atlas.deliveryManager?.getConfig();
    if (deliveryConfig) {
      const paths = assessPipelinePromotions(deliveryConfig.paths, deliveryConfig.stages);
      if (paths.length > 0) {
        input.promote = { paths };
      }
    }

    // Follow-ups are already in memory on the Director manager, so this costs
    // nothing. Runs likewise.
    const directorConfig = this.atlas.projectDirectorManager?.getConfig();
    if (directorConfig) {
      input.attention = { overdueFollowUps: countOverdueFollowUps(directorConfig) };
    }

    return input;
  }
}

class ProjectDirectorTreeProvider implements vscode.TreeDataProvider<DirectorTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DirectorTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DirectorTreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DirectorTreeNode): DirectorTreeNode[] {
    const config = this.atlas.projectDirectorManager?.getConfig();
    if (!config) {
      return [];
    }
    const nameOf = (contactId: string): string =>
      config.contacts.find(contact => contact.id === contactId)?.name ?? '—';
    const isDueOrOverdue = (status: string, urgency: string): boolean =>
      status !== 'done' && status !== 'cancelled' && (urgency === 'overdue' || urgency === 'due-soon');

    if (!element) {
      const dueItems = config.followUps.filter(f => isDueOrOverdue(f.status, deriveFollowUpUrgency(f)));
      const groups: DirectorTreeNode[] = [];
      if (config.stakeholders.length > 0 || resolveTeamMode(config) === 'team') {
        groups.push(new DirectorGroupItem('stakeholders', 'Stakeholders', config.stakeholders.length, 'organization'));
      }
      if (resolveTeamMode(config) === 'team') {
        groups.push(new DirectorGroupItem('team', 'Team', config.teamMembers.length, 'organization'));
      }
      groups.push(new DirectorGroupItem('followups', 'Follow-ups', dueItems.length, 'bell'));
      return groups;
    }

    if (element instanceof DirectorGroupItem && element.group === 'stakeholders') {
      return config.stakeholders.map(stakeholder =>
        new DirectorEntryItem(nameOf(stakeholder.contactId), `${stakeholder.category} · ${stakeholder.influence}/${stakeholder.interest}`, 'account'));
    }
    if (element instanceof DirectorGroupItem && element.group === 'team') {
      return config.teamMembers.map(member =>
        new DirectorEntryItem(nameOf(member.contactId), member.discipline, 'person'));
    }
    if (element instanceof DirectorGroupItem && element.group === 'followups') {
      const items = config.followUps.filter(f => isDueOrOverdue(f.status, deriveFollowUpUrgency(f)));
      if (items.length === 0) {
        const empty = new vscode.TreeItem('Nothing due', vscode.TreeItemCollapsibleState.None);
        empty.contextValue = 'director-empty';
        return [empty as DirectorTreeNode];
      }
      return items.map(followUp => {
        const overdue = deriveFollowUpUrgency(followUp) === 'overdue';
        return new DirectorEntryItem(
          followUp.title,
          `due ${followUp.dueDate}`,
          overdue ? 'warning' : 'clock',
          overdue ? 'charts.red' : 'charts.yellow',
        );
      });
    }
    return [];
  }
}

function shortArdType(type: string): string {
  return type.replace(/^application\//, '').replace(/\+json$/, '').replace(/^vnd\.atlasmind\./, '');
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


class MemoryFolderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    label: string,
    description: string | undefined,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = 'memory-folder';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = buildMemoryFolderTooltip(folderPath, description);
  }
}

class MemoryStatsTreeItem extends vscode.TreeItem {
  constructor(totalEntries: number, warnings: number, blocked: number) {
    super('Memory index', vscode.TreeItemCollapsibleState.None);
    const parts: string[] = [`${totalEntries} entr${totalEntries === 1 ? 'y' : 'ies'}`];
    if (warnings > 0) { parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`); }
    if (blocked > 0) { parts.push(`${blocked} blocked`); }
    this.description = parts.join(' · ');
    this.contextValue = 'memory-stats';
    this.iconPath = new vscode.ThemeIcon(
      blocked > 0 ? 'error' : warnings > 0 ? 'warning' : 'database',
      blocked > 0
        ? new vscode.ThemeColor('testing.iconFailed')
        : warnings > 0
          ? new vscode.ThemeColor('list.warningForeground')
          : new vscode.ThemeColor('charts.blue'),
    );
    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.appendMarkdown(`## Memory index\n\n`);
    tooltip.appendMarkdown(`- **Entries:** ${totalEntries}\n`);
    tooltip.appendMarkdown(`- **Warnings:** ${warnings}\n`);
    tooltip.appendMarkdown(`- **Blocked:** ${blocked}\n`);
    this.tooltip = tooltip;
  }
}

type MemoryTreeNode = MemoryEntryTreeItem | MemoryFolderTreeItem | MemoryStatsTreeItem | vscode.TreeItem;

class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<MemoryTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly atlas: AtlasMindContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MemoryTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MemoryTreeNode): Promise<MemoryTreeNode[]> {
    const entries = sortMemoryEntries(this.atlas.memoryManager.listEntries());
    const folderPaths = await this.collectFolderPaths(entries);

    if (element instanceof MemoryFolderTreeItem) {
      const childFolders = getDirectChildFolderPaths(folderPaths, element.folderPath);
      const childEntries = entries
        .filter(entry => getMemoryFolderPath(entry) === element.folderPath)
        .map(entry => new MemoryEntryTreeItem(entry));
      return [
        ...childFolders.map(folderPath => this.buildFolderItem(folderPath, folderPaths, entries)),
        ...childEntries,
      ];
    }

    const items: MemoryTreeNode[] = [];
    const statusItem = await this.buildStatusItem();
    if (statusItem) {
      items.push(statusItem);
    }

    if (entries.length > 0) {
      const stats = this.atlas.memoryManager.getStats();
      items.push(new MemoryStatsTreeItem(stats.totalEntries, stats.warnings, stats.blocked));
    }

    const rootFolders = getDirectChildFolderPaths(folderPaths);
    const rootEntries = entries
      .filter(entry => !getMemoryFolderPath(entry))
      .map(entry => new MemoryEntryTreeItem(entry));

    items.push(
      ...rootFolders.map(folderPath => this.buildFolderItem(folderPath, folderPaths, entries)),
      ...rootEntries,
    );

    if (items.length === 0) {
      const isActivating = (globalThis as any).atlasmindActivating === true;
      const warning = new vscode.TreeItem(isActivating ? 'AtlasMind is still activating…' : 'No memory entries indexed', vscode.TreeItemCollapsibleState.None);
      warning.tooltip = isActivating
        ? 'AtlasMind is still activating. Project memory will appear here once ready.'
        : 'No memory entries indexed yet.';
      return [warning];
    }

    return items;
  }

  private async buildStatusItem(): Promise<vscode.TreeItem | undefined> {
    return undefined;
  }

  private async collectFolderPaths(entries: MemoryEntry[]): Promise<string[]> {
    const folderPaths = new Set<string>();

    if (vscode.workspace.workspaceFolders?.[0]) {
      for (const folder of SSOT_FOLDERS) {
        if (!folder.endsWith('.md')) {
          addFolderAncestors(folderPaths, folder);
        }
      }
    }

    for (const entry of entries) {
      const folderPath = getMemoryFolderPath(entry);
      if (folderPath) {
        addFolderAncestors(folderPaths, folderPath);
      }
    }

    return [...folderPaths].sort((left, right) => left.localeCompare(right));
  }

  private buildFolderItem(
    folderPath: string,
    allFolderPaths: string[],
    entries: MemoryEntry[],
  ): MemoryFolderTreeItem {
    const childCount = getDirectChildFolderPaths(allFolderPaths, folderPath).length +
      entries.filter(entry => getMemoryFolderPath(entry) === folderPath).length;
    return new MemoryFolderTreeItem(
      folderPath,
      getFolderLabel(folderPath),
      childCount === 0 ? 'Empty' : `${childCount} item${childCount === 1 ? '' : 's'}`,
      childCount === 0 ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed,
    );
  }
}

function resolveMemoryRootUri(): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return undefined;
  }

  const rawSsotPath = vscode.workspace.getConfiguration?.('atlasmind')?.get<string>('ssotPath', 'project_memory') ?? 'project_memory';
  const ssotPath = getValidatedSsotPath(rawSsotPath ?? 'project_memory');
  if (!ssotPath) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder.uri, ssotPath);
}

function resolveMemoryEntryUri(entryPath: string): vscode.Uri | undefined {
  const ssotRoot = resolveMemoryRootUri();
  if (!ssotRoot) {
    return undefined;
  }

  return vscode.Uri.joinPath(ssotRoot, ...entryPath.split('/').filter(Boolean));
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

function buildMemoryFolderTooltip(folderPath: string, description: string | undefined): vscode.MarkdownString {
  const md = new vscode.MarkdownString('', true);
  md.isTrusted = true;
  md.appendMarkdown(`## ${getFolderLabel(folderPath)}\n\n`);
  md.appendMarkdown(`**SSOT path:** \`${folderPath}\`\n\n`);
  md.appendMarkdown(
    description === 'Empty'
      ? 'This storage folder exists in the SSOT tree but does not currently contain indexed child entries.'
      : `This storage folder currently exposes ${description?.toLowerCase() ?? 'indexed items'} in the Memory panel.`,
  );
  return md;
}

function getMemoryFolderPath(entry: MemoryEntry): string | undefined {
  const segments = entry.path.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return undefined;
  }

  return normalizeFolderPath(segments.slice(0, -1));
}

function sortMemoryEntries(entries: readonly MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path));
}

function buildMemoryChatSummary(entry: MemoryEntry): string {
  const tags = entry.tags.length > 0 ? entry.tags.map(tag => `\`${tag}\``).join(', ') : 'No tags recorded';
  return [
    `**Path:** \`${entry.path}\``,
    `**Last indexed:** ${entry.lastModified}`,
    `**Tags:** ${tags}`,
    '',
    buildMemoryReview(entry),
  ].join('\n');
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
    public readonly hasFailedModels: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isSubscription: boolean = false,
  ) {
    super(label, collapsibleState);
    this.description = description;
    const configState = configured ? 'configured' : 'unconfigured';
    const enabledState = enabled ? 'enabled' : 'disabled';
    const subscriptionSuffix = isSubscription ? '-subscription' : '';
    this.contextValue = `model-provider-${configState}-${enabledState}${subscriptionSuffix}`;
    this.tooltip = `${label}\nStatus: ${describeProviderStatus(enabled, configured, partiallyEnabled, hasFailedModels)}`;
    this.iconPath = getModelStatusIcon(enabled, configured, hasFailedModels);
    this.command = {
      command: 'atlasmind.openModelProviders',
      title: 'Open Model Providers',
    };
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
    public readonly failed: boolean,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = failed ? `model-item-failed-${enabled ? 'enabled' : 'disabled'}` : enabled ? 'model-item-enabled' : 'model-item-disabled';
    this.iconPath = getModelStatusIcon(enabled, true, failed);
    this.command = {
      command: 'atlasmind.models.openInfo',
      title: 'Open Model Info',
      arguments: [this],
    };
  }
}

function buildModelTreeDescription(modelId: string, duplicateName: boolean, failed: boolean): string | undefined {
  const parts: string[] = [];
  if (duplicateName) {
    parts.push(getShortModelId(modelId));
  }
  if (failed) {
    parts.push('failed');
  }

  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function getShortModelId(modelId: string): string {
  const slashIndex = modelId.indexOf('/');
  return slashIndex >= 0 ? modelId.slice(slashIndex + 1) : modelId;
}

/**
 * The ACP route for one vendor, shown as its own line beside that vendor's API
 * entry.
 *
 * A single "ACP" node would be technically accurate — the router does hold one
 * `acp` provider — and practically useless: it files a Claude subscription under
 * a protocol acronym, several rows away from the Anthropic entry it is an
 * alternative to. Someone deciding *how to reach Claude* wants those two
 * choices adjacent, which is what this node makes possible.
 *
 * It carries a distinct `contextValue` so the provider-level enable/disable
 * actions do **not** attach to it: those act on the whole `acp` provider, and
 * offering them here would let "disable the Claude subscription" silently switch
 * off Codex too. Enabling is per-model, on the child rows.
 */
export class AcpBridgeTreeItem extends vscode.TreeItem {
  constructor(
    /**
     * The vendor whose API row this sits under — `anthropic`, `openai`.
     *
     * Deliberately **not** called `providerId`. The models tree's command
     * handlers identify their argument by duck typing (`'providerId' in item`),
     * so a row carrying that property was accepted as a provider row and acted
     * on under the vendor's id: the visibility toggle on
     * "Anthropic — Claude subscription" flipped *Anthropic's API provider*, and
     * the info and configure actions reported and prompted for Anthropic too.
     * The property name was the bug, so the name is the fix.
     */
    public readonly vendorId: string,
    public readonly agentId: string,
    label: string,
    description: string | undefined,
    tooltip: string,
    state: AcpBridgeState,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = tooltip;
    // Its own namespace, so the `/^model-/` menu contributions do not attach.
    // Actions for this row are declared against `acp-bridge-` explicitly.
    this.contextValue = state === 'ready' ? 'acp-bridge-ready' : 'acp-bridge-incomplete';
    this.iconPath = acpBridgeIcon(state);
    this.command = state === 'ready'
      ? { command: 'atlasmind.openModelProviders', title: 'Open Model Providers' }
      // Clicking an unfinished row should start finishing it, not open a screen
      // and leave the user to work out which control applies.
      : { command: 'atlasmind.acp.setUpBridge', title: 'Set up', arguments: [{ vendorId, agentId }] };
  }
}

/**
 * Which of the conditions routing needs is currently unmet, if any.
 *
 * `unverified` is separate from `unhealthy` for the same reason `not-discovered`
 * is separate from `model-disabled`: an agent nobody has contacted yet and an
 * agent that answered badly look identical from here and mean opposite things.
 * Reporting the first as the second is how a working `claude-agent-acp` came to
 * be labelled "agent not responding" — a verdict on a process that was never
 * spawned.
 */
export type AcpBridgeState =
  | 'not-set-up' | 'provider-off' | 'not-discovered' | 'model-disabled'
  | 'unverified' | 'unhealthy' | 'ready';

/**
 * Built on demand rather than as a module constant.
 *
 * A `new vscode.ThemeIcon(...)` at module scope runs on import, which makes the
 * whole module unimportable anywhere the API is not fully present — the tests
 * being the immediate case, but the same is true of any early-activation path.
 */
function acpBridgeIcon(state: AcpBridgeState): vscode.ThemeIcon {
  switch (state) {
    // `plug` reads as "connectable" where a warning triangle would read as
    // broken. Nothing is wrong with an ACP route nobody has set up yet.
    case 'not-set-up':
      return new vscode.ThemeIcon('plug', new vscode.ThemeColor('descriptionForeground'));
    case 'not-discovered':
      return new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
    case 'provider-off':
    case 'model-disabled':
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('testing.iconQueued'));
    // Not a warning colour: nothing is known to be wrong, only unchecked.
    case 'unverified':
      return new vscode.ThemeIcon('question', new vscode.ThemeColor('descriptionForeground'));
    case 'unhealthy':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
    case 'ready':
      return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  }
}

type ModelsTreeNode = ModelProviderTreeItem | ModelTreeItem | AcpBridgeTreeItem | vscode.TreeItem;

/** The agent id in a model id like `acp/claude`. */
function acpAgentIdOf(modelId: string): string {
  return modelId.startsWith('acp/') ? modelId.slice(4) : '';
}

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ModelsTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private atlas: AtlasMindContext,
    private readonly visibilityState: ModelSidebarVisibilityReader,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ModelsTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ModelsTreeNode): Promise<ModelsTreeNode[]> {
    const providers = this.atlas.modelRouter.listProviders();
    const hiddenEntries = readHiddenModelSidebarEntries(this.visibilityState);
    if (providers.length === 0) {
      return [new vscode.TreeItem('No providers configured', vscode.TreeItemCollapsibleState.None)];
    }

    if (!element) {
      const items = await Promise.all(providers.map(async (provider, index) => {
        const configured = await this.atlas.isProviderConfigured(provider.id);
        const enabledModels = provider.models.filter(model => model.enabled).length;
        const failedModels = getProviderFailureCount(this.atlas, provider.id);
        const autoPaused = isProviderAutoDisabled(this.atlas, provider.id);
        const partiallyEnabled = configured && provider.enabled && enabledModels !== provider.models.length;
        return {
          index,
          configured,
          item: new ModelProviderTreeItem(
          provider.id,
          provider.displayName,
          autoPaused ? '(⚠ auto-paused)' : failedModels > 0 ? `(⚠ ${failedModels} failed)` : partiallyEnabled ? '(⚠)' : undefined,
          provider.enabled,
          configured,
          partiallyEnabled,
          failedModels > 0,
          configured && provider.models.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          provider.pricingModel === 'subscription',
          ),
        };
      }));

      const ordered = items
        .sort((left, right) => {
          if (left.configured !== right.configured) {
            return left.configured ? -1 : 1;
          }
          return left.index - right.index;
        })
        .map(entry => entry.item);

      const visibleRows = this.withAcpBridgeRows(ordered, providers).filter(row => {
        if (row instanceof ModelProviderTreeItem) {
          return !isModelSidebarProviderHidden(hiddenEntries, row.providerId);
        }
        if (row instanceof AcpBridgeTreeItem) {
          return !isModelSidebarBridgeHidden(hiddenEntries, row.vendorId, row.agentId);
        }
        return true;
      });

      return visibleRows.length > 0
        ? visibleRows
        : [this.hiddenRowsPlaceholder('All providers are hidden — restore them in Settings')];
    }

    if (element instanceof AcpBridgeTreeItem) {
      const provider = providers.find(candidate => candidate.id === ACP_PROVIDER_ID);
      const providerEnabled = provider?.enabled === true;
      const models = (provider?.models ?? []).filter(model => acpAgentIdOf(model.id) === element.agentId);
      const visibleModels = models.filter(model =>
        !isModelSidebarModelHidden(hiddenEntries, ACP_PROVIDER_ID, model.id),
      );
      if (models.length > 0 && visibleModels.length === 0) {
        return [this.hiddenRowsPlaceholder('All models are hidden — restore them in Settings')];
      }
      return visibleModels.map(model => {
        const failure = getModelFailure(this.atlas, model.id);
        return new ModelTreeItem(
          ACP_PROVIDER_ID,
          model.id,
          model.name,
          // A model enabled under a disabled provider is not selectable, and the
          // row has to say so rather than showing a tick for a route that is off.
          providerEnabled
            ? buildModelTreeDescription(model.id, false, !!failure)
            : 'provider off',
          `${model.name}\nID: ${model.id}\nReached over ACP using your subscription\n`
          + `Status: ${providerEnabled ? describeModelStatus(model.enabled, true, !!failure) : 'not selectable — the ACP provider is disabled'}\n`
          + `Capabilities: ${model.capabilities.join(', ')}`,
          model.enabled && providerEnabled,
          !!failure,
        );
      });
    }

    if (element instanceof ModelProviderTreeItem) {
      if (!element.configured) {
        return [];
      }

      const provider = providers.find(candidate => candidate.id === element.providerId);
      if (!provider) {
        return [];
      }

      const duplicateNameCounts = new Map<string, number>();
      for (const model of provider.models) {
        duplicateNameCounts.set(model.name, (duplicateNameCounts.get(model.name) ?? 0) + 1);
      }

      const visibleModels = provider.models.filter(model =>
        !isModelSidebarModelHidden(hiddenEntries, provider.id, model.id),
      );
      if (provider.models.length > 0 && visibleModels.length === 0) {
        return [this.hiddenRowsPlaceholder('All models are hidden — restore them in Settings')];
      }

      return visibleModels.map(model => {
        const failure = getModelFailure(this.atlas, model.id);
        const tooltip =
          `${model.name}\n` +
          `ID: ${model.id}\n` +
          `Status: ${describeModelStatus(model.enabled, true, !!failure)}\n` +
          `Context: ${model.contextWindow.toLocaleString()}\n` +
          `Capabilities: ${model.capabilities.join(', ')}` +
          (failure
            ? `\nFailure count: ${failure.failureCount}\nLast failure: ${failure.failedAt}\nReason: ${failure.message}`
            : '');
        return new ModelTreeItem(
          provider.id,
          model.id,
          model.name,
          buildModelTreeDescription(model.id, (duplicateNameCounts.get(model.name) ?? 0) > 1, !!failure),
          tooltip,
          model.enabled,
          !!failure,
        );
      });
    }

    return [];
  }

  private hiddenRowsPlaceholder(label: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('eye-closed', new vscode.ThemeColor('descriptionForeground'));
    item.tooltip = 'Open Settings → Models & Integrations → Sidebar visibility to restore hidden rows.';
    item.command = {
      command: 'atlasmind.openSettings',
      title: 'Open Models & Integrations Settings',
      arguments: [{ page: 'models', section: 'modelSidebarVisibilityCard' }],
    };
    return item;
  }

  /**
   * Slot each vendor's ACP route in directly after that vendor's API row.
   *
   * Placement is the whole point: adjacency is what turns "what is ACP?" into
   * "oh — this is the other way to reach Claude". A bridge with no configured
   * agent is still shown, greyed, because the row is also how someone discovers
   * the option exists; hiding it until configured would mean only people who
   * already knew about ACP would ever find it.
   *
   * The generic `acp` provider row is kept whenever any ACP agent is actually
   * configured, because it is the row that carries the provider-level
   * enable/disable action. Dropping it once every agent had a vendor row removed
   * the only way to turn ACP on from the tree.
   *
   * **What "configured" means here is load-bearing.** It is read from
   * `atlasmind.acp.agents` — the user's own list — and *not* from the provider's
   * model list, which contains a seeded `acp/claude` entry that exists whether or
   * not any agent was ever set up. Deriving it from the models made an untouched
   * install show a configured, ticked Claude subscription that the router would
   * never select.
   */
  private withAcpBridgeRows(rows: ModelsTreeNode[], providers: ProviderConfig[]): ModelsTreeNode[] {
    const acpProvider = providers.find(candidate => candidate.id === ACP_PROVIDER_ID);
    const configuredAgentIds = new Set(
      parseAcpAgentSettings(vscode.workspace.getConfiguration('atlasmind').get<unknown>('acp.agents'))
        .map(agent => agent.id),
    );
    const providerEnabled = acpProvider?.enabled === true;

    const bridged = new Set<string>();
    const out: ModelsTreeNode[] = [];

    for (const row of rows) {
      // Hold the generic ACP row back until we know whether anything is left for it.
      if (row instanceof ModelProviderTreeItem && row.providerId === ACP_PROVIDER_ID) {
        continue;
      }

      out.push(row);
      if (!(row instanceof ModelProviderTreeItem)) {
        continue;
      }
      const bridge = findAcpBridge(row.providerId);
      if (!bridge) {
        continue;
      }

      const configured = configuredAgentIds.has(bridge.agentId);
      const models = (acpProvider?.models ?? []).filter(model => acpAgentIdOf(model.id) === bridge.agentId);
      // Routable, not merely present. `getCandidateModels` requires all of: an
      // agent in settings, an enabled provider, a discovered and enabled model,
      // and a healthy provider. A tick that reflected only `model.enabled`
      // promised a route the router would never take — which is exactly how an
      // ACP entry sat there looking active while every prompt went elsewhere.
      // This agent's own answer, not the provider's. `acp` is one provider in
      // front of several agents, so a provider-wide health flag made the
      // Anthropic row report whatever the *first* configured agent said — and
      // an agent never probed at all is reported as unchecked rather than as
      // failing, because "not responding" about a process nobody spawned is the
      // wrong end of the guess.
      const probe = peekAcpAgentProbe(bridge.agentId);
      const state = resolveAcpBridgeState({
        configured,
        providerEnabled,
        modelCount: models.length,
        modelEnabled: models.some(model => model.enabled),
        healthy: probe
          ? probe.installed && probe.authenticated
          : isProviderHealthy(this.atlas, ACP_PROVIDER_ID),
        probed: probe !== undefined,
      });
      if (configured) {
        bridged.add(bridge.agentId);
      }

      out.push(new AcpBridgeTreeItem(
        row.providerId,
        bridge.agentId,
        `${row.label as string} — ${bridge.subscriptionName}`,
        describeAcpBridgeState(state),
        describeAcpBridgeTooltip(row.label as string, bridge, state, probe?.message),
        state,
        configured && models.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      ));
    }

    // Keep the provider row whenever anything is configured: it owns the
    // enable/disable action, and an agent no vendor row claims — a Gemini CLI,
    // say — has nowhere else to live.
    if (configuredAgentIds.size > 0) {
      const acpRow = rows.find((row): row is ModelProviderTreeItem =>
        row instanceof ModelProviderTreeItem && row.providerId === ACP_PROVIDER_ID);
      if (acpRow) {
        out.push(acpRow);
      }
    }

    return out;
  }
}

/**
 * Which condition is unmet, in the order the user has to fix them.
 *
 * `not-discovered` is separate from `model-disabled` because they look identical
 * and mean opposite things. Only `acp/claude` is seeded, so a freshly configured
 * Codex agent has *no* model row until discovery runs — reporting that as
 * "model disabled" sent the user hunting for a switch that does not exist. One
 * needs a refresh; the other needs a toggle.
 */
export function resolveAcpBridgeState(input: {
  configured: boolean;
  providerEnabled: boolean;
  modelCount: number;
  modelEnabled: boolean;
  healthy: boolean;
  /**
   * Whether `healthy` is an answer from *this* agent or an inherited guess.
   * Omitted means "yes, it was measured" — the shape every existing caller and
   * test already assumes, so the default cannot silently turn a real verdict
   * into `unverified`.
   */
  probed?: boolean;
}): AcpBridgeState {
  if (!input.configured) {
    return 'not-set-up';
  }
  if (!input.providerEnabled) {
    return 'provider-off';
  }
  if (input.modelCount === 0) {
    return 'not-discovered';
  }
  if (!input.modelEnabled) {
    return 'model-disabled';
  }
  // Only an unmeasured *failure* is downgraded to `unverified`. An unmeasured
  // pass stays `ready`, because health defaults to healthy until a check says
  // otherwise — reporting the optimistic default as a question mark would put
  // every agent behind a warning on a cold start.
  if (!input.healthy && input.probed === false) {
    return 'unverified';
  }
  return input.healthy ? 'ready' : 'unhealthy';
}

/** The state, in the words that name the next step. */
export function describeAcpBridgeState(state: AcpBridgeState): string {
  switch (state) {
    case 'not-set-up': return '(ACP — set up)';
    case 'provider-off': return '(ACP — provider off)';
    case 'not-discovered': return '(ACP — refresh to finish)';
    case 'model-disabled': return '(ACP — model disabled)';
    case 'unverified': return '(ACP — not checked yet)';
    case 'unhealthy': return '(⚠ ACP — agent not responding)';
    case 'ready': return '(ACP)';
  }
}

/**
 * Say which of the four conditions is missing, not merely that something is.
 *
 * All four fail the same way from the outside — prompts quietly go elsewhere —
 * so a row that only reported "not working" would leave the user checking the
 * same settings screens in turn. Each branch names the one thing to fix.
 */
function describeAcpBridgeTooltip(
  vendorLabel: string,
  bridge: { command: string; subscriptionName: string },
  state: AcpBridgeState,
  /**
   * What the agent itself said, when it said anything. The generic advice below
   * lists the two usual causes; this replaces guessing with the reported one.
   */
  healthDetail?: string,
): string {
  switch (state) {
    case 'not-set-up':
      return `Use your ${bridge.subscriptionName} for ${vendorLabel} models instead of paying per token.\n\n`
        + `Click this row to set it up. AtlasMind checks whether ${bridge.command} is installed and signed in, `
        + 'and walks you through it if not — nothing is installed for you.';
    case 'provider-off':
      return `${bridge.command} is configured, but the ACP provider is switched off, so the router will not choose it.\n\n`
        + 'Click to turn it on.';
    case 'not-discovered':
      return `${bridge.command} is configured and the provider is on, but no model has been discovered for it yet.\n\n`
        + 'Click to refresh — that is usually all this needs.';
    case 'model-disabled':
      return `${bridge.command} is ready, but its model is disabled, so the router will skip it.\n\n`
        + 'Enable it from the model row beneath this one.';
    case 'unverified':
      return `${bridge.command} is configured and enabled, but AtlasMind has not managed to check it yet, `
        + 'so nothing here is a verdict on the agent.\n\n'
        + 'Refresh the models to run the check. It spawns the agent and opens a session, which takes a few seconds.';
    case 'unhealthy':
      return `${bridge.command} is configured and enabled, but its last health check failed, so the router is skipping it.\n\n`
        + (healthDetail
          ? `The agent reported: ${healthDetail}`
          : 'The usual causes are the command not being on PATH, or the agent not being signed in. '
            + 'Run it once in a terminal to see which.');
    case 'ready':
      return `Reach ${vendorLabel} models through your ${bridge.subscriptionName} over ACP, instead of paying per token.\n`
        + `Command: ${bridge.command}`;
  }
}

/** Router health for a provider, tolerant of a stubbed router in tests. */
function isProviderHealthy(atlas: AtlasMindContext, providerId: string): boolean {
  const router = atlas.modelRouter as unknown as { isProviderHealthy?: (id: string) => boolean };
  return typeof router.isProviderHealthy === 'function' ? router.isProviderHealthy(providerId) : true;
}

function describeModelStatus(enabled: boolean, configured: boolean, failed = false): string {
  if (!configured) {
    return 'not configured';
  }
  if (failed) {
    return enabled ? 'failed' : 'failed (disabled)';
  }
  return enabled ? 'enabled' : 'disabled';
}

function describeProviderStatus(enabled: boolean, configured: boolean, partiallyEnabled: boolean, hasFailedModels: boolean): string {
  if (hasFailedModels) {
    return partiallyEnabled ? 'enabled (some models disabled, some failed)' : 'enabled (some models failed)';
  }
  if (partiallyEnabled) {
    return 'enabled (some models disabled)';
  }
  return describeModelStatus(enabled, configured);
}

function getModelStatusIcon(enabled: boolean, configured: boolean, failed = false): vscode.ThemeIcon {
  if (!configured) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  }

  if (failed) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
  }

  if (enabled) {
    return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  }

  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
}

function getProviderFailureCount(atlas: AtlasMindContext, providerId: string): number {
  const router = atlas.modelRouter as unknown as { getProviderFailureCount?: (id: string) => number };
  return typeof router.getProviderFailureCount === 'function' ? router.getProviderFailureCount(providerId) : 0;
}

function isProviderAutoDisabled(atlas: AtlasMindContext, providerId: string): boolean {
  const router = atlas.modelRouter as unknown as { getSessionAutoDisabledProviders?: () => ReadonlyMap<string, string> };
  return typeof router.getSessionAutoDisabledProviders === 'function'
    ? router.getSessionAutoDisabledProviders().has(providerId)
    : false;
}

function getSessionAutoDisabledCount(atlas: AtlasMindContext): number {
  const router = atlas.modelRouter as unknown as { getSessionAutoDisabledProviders?: () => ReadonlyMap<string, string> };
  return typeof router.getSessionAutoDisabledProviders === 'function'
    ? router.getSessionAutoDisabledProviders().size
    : 0;
}

function getModelFailure(atlas: AtlasMindContext, modelId: string): { failureCount: number; failedAt: string; message: string } | undefined {
  const router = atlas.modelRouter as unknown as {
    getModelFailure?: (id: string) => { failureCount: number; failedAt: string; message: string } | undefined;
  };
  return typeof router.getModelFailure === 'function' ? router.getModelFailure(modelId) : undefined;
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

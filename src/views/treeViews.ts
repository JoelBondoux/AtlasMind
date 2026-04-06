import * as vscode from 'vscode';
import { getProjectMemoryFreshness, getValidatedSsotPath } from '../bootstrap/bootstrapper.js';
import type { AtlasMindContext } from '../extension.js';
import { SSOT_FOLDERS } from '../types.js';
import type { AgentDefinition, McpServerState, MemoryEntry, ProjectRunRecord, SkillDefinition, SkillScanResult } from '../types.js';
import type { SessionConversationSummary, SessionFolderSummary } from '../chat/sessionConversation.js';
import { ChatViewProvider } from './chatPanel.js';

const SESSION_TREE_MIME = 'application/vnd.atlasmind.sessions';

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
  const modelsProvider = new ModelsTreeProvider(atlas);
  const projectRunsProvider = new ProjectRunsTreeProvider(atlas);
  const mcpServersProvider = new McpServersTreeProvider(atlas);
  const memoryProvider = new MemoryTreeProvider(atlas);
  atlas.agentsRefresh.event(() => agentsProvider.refresh());
  atlas.skillsRefresh.event(() => skillsProvider.refresh());
  atlas.skillsRefresh.event(() => mcpServersProvider.refresh());
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
    vscode.window.createTreeView('atlasmind.sessionsView', {
      treeDataProvider: sessionsProvider,
      dragAndDropController: sessionsProvider,
      showCollapseAll: true,
    }),
    vscode.window.registerTreeDataProvider(
      'atlasmind.memoryView',
      memoryProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.mcpServersView',
      mcpServersProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.modelsView',
      modelsProvider,
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.projectRunsView',
      projectRunsProvider,
    ),
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
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

export async function postSidebarSummaryToChat(
  atlas: AtlasMindContext,
  heading: string,
  body: string,
): Promise<void> {
  const sessionId = atlas.sessionConversation.getActiveSessionId();
  const messageId = atlas.sessionConversation.appendMessage(
    'assistant',
    `## ${heading}\n\n${body.trim()}`,
    sessionId,
  );
  await ChatViewProvider.open({ sessionId, messageId });
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

  getTreeItem(element: SkillsTreeNode): SkillsTreeNode {
    return element;
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
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const servers = this.atlas.mcpServerRegistry.listServers();
    if (servers.length === 0) {
      return [new vscode.TreeItem('No MCP servers configured', vscode.TreeItemCollapsibleState.None)];
    }

    return servers.map(server => new McpServerTreeItem(server));
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

class MemoryStatusTreeItem extends vscode.TreeItem {
  constructor(staleEntryCount: number) {
    super('Project memory needs update', vscode.TreeItemCollapsibleState.None);
    this.description = `${staleEntryCount} stale imported entr${staleEntryCount === 1 ? 'y' : 'ies'}`;
    this.contextValue = 'memory-status-stale';
    this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    this.command = {
      command: 'atlasmind.updateProjectMemory',
      title: 'Update Project Memory',
    };

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.appendMarkdown('## Project memory needs update\n\n');
    tooltip.appendMarkdown(`AtlasMind found ${staleEntryCount} imported SSOT entr${staleEntryCount === 1 ? 'y' : 'ies'} that no longer match the current workspace snapshot.\n\n`);
    tooltip.appendMarkdown('Select this row or use the Memory view action to rerun the import pipeline against the latest codebase.');
    this.tooltip = tooltip;
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

type MemoryTreeNode = MemoryEntryTreeItem | MemoryFolderTreeItem | MemoryStatusTreeItem | vscode.TreeItem;

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

    const rootFolders = getDirectChildFolderPaths(folderPaths);
    const rootEntries = entries
      .filter(entry => !getMemoryFolderPath(entry))
      .map(entry => new MemoryEntryTreeItem(entry));

    items.push(
      ...rootFolders.map(folderPath => this.buildFolderItem(folderPath, folderPaths, entries)),
      ...rootEntries,
    );

    if (items.length === 0) {
      return [new vscode.TreeItem('No memory entries indexed', vscode.TreeItemCollapsibleState.None)];
    }

    return items;
  }

  private async buildStatusItem(): Promise<vscode.TreeItem | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }

    try {
      const freshness = await getProjectMemoryFreshness(workspaceFolder.uri);
      if (!freshness.hasImportedEntries || !freshness.isStale) {
        return undefined;
      }

      return new MemoryStatusTreeItem(freshness.staleEntryCount);
    } catch {
      return undefined;
    }
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
  ) {
    super(label, collapsibleState);
    this.description = description;
    const configState = configured ? 'configured' : 'unconfigured';
    const enabledState = enabled ? 'enabled' : 'disabled';
    this.contextValue = `model-provider-${configState}-${enabledState}`;
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
        const failedModels = getProviderFailureCount(this.atlas, provider.id);
        const partiallyEnabled = configured && provider.enabled && enabledModels !== provider.models.length;
        return {
          index,
          configured,
          item: new ModelProviderTreeItem(
          provider.id,
          provider.displayName,
          failedModels > 0 ? `(⚠ ${failedModels} failed)` : partiallyEnabled ? '(⚠)' : undefined,
          provider.enabled,
          configured,
          partiallyEnabled,
          failedModels > 0,
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
        const failure = getModelFailure(this.atlas, model.id);
        const tooltip =
          `${model.id}\n` +
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
          failure ? 'failed' : undefined,
          tooltip,
          model.enabled,
          !!failure,
        );
      });
    }

    return [];
  }
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

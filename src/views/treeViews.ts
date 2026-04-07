import * as vscode from 'vscode';
import { getProjectMemoryFreshness, getValidatedSsotPath } from '../bootstrap/bootstrapper.js';
import type { AtlasMindContext } from '../extension.js';
import { SSOT_FOLDERS } from '../types.js';
import type { AgentDefinition, McpServerState, MemoryEntry, ProjectRunRecord, SkillDefinition, SkillScanResult } from '../types.js';
import type { SessionConversationSummary, SessionFolderSummary } from '../chat/sessionConversation.js';
import { ChatViewProvider } from './chatPanel.js';
import { escapeHtml, getWebviewHtmlShell } from './webviewUtils.js';

const SESSION_TREE_MIME = 'application/vnd.atlasmind.sessions';
const SIDEBAR_QUICK_LINKS = [
  {
    label: 'Dashboard',
    description: 'Open the project dashboard.',
    command: 'atlasmind.openProjectDashboard',
    icon: 'dashboard',
  },
  {
    label: 'Ideation',
    description: 'Open the ideation whiteboard.',
    command: 'atlasmind.openProjectIdeation',
    icon: 'ideation',
  },
  {
    label: 'Runs',
    description: 'Open the project run center.',
    command: 'atlasmind.openProjectRunCenter',
    icon: 'runs',
  },
  {
    label: 'Cost',
    description: 'Open the cost dashboard.',
    command: 'atlasmind.openCostDashboard',
    icon: 'cost',
  },
  {
    label: 'Models',
    description: 'Open model providers.',
    command: 'atlasmind.openModelProviders',
    icon: 'models',
  },
  {
    label: 'Profile',
    description: 'Open the Atlas personality profile.',
    command: 'atlasmind.openPersonalityProfile',
    icon: 'profile',
  },
  {
    label: 'Settings',
    description: 'Open AtlasMind settings.',
    command: 'atlasmind.openSettings',
    icon: 'settings',
  },
] as const;

type SidebarQuickLink = (typeof SIDEBAR_QUICK_LINKS)[number];
type SidebarQuickLinkCommand = SidebarQuickLink['command'];
type SidebarQuickLinkIcon = SidebarQuickLink['icon'];
const SIDEBAR_HOME_LAYOUT_STATE_KEY = 'atlasmind.sidebarHomeLayout';
const SIDEBAR_HOME_SECTIONS = ['quick-links', 'sessions', 'runs', 'workspace'] as const;
const SIDEBAR_HOME_COMMANDS = new Set<string>([
  ...SIDEBAR_QUICK_LINKS.map(link => link.command),
  'atlasmind.openChatView',
  'atlasmind.openSettingsChat',
  'atlasmind.openProjectRunCenter',
  'atlasmind.openSettingsProject',
  'atlasmind.openAgentPanel',
  'atlasmind.openMcpServers',
  'atlasmind.openModelProviders',
  'atlasmind.openSpecialistIntegrations',
  'atlasmind.updateProjectMemory',
  'atlasmind.importProject',
]);

type SidebarHomeSectionId = (typeof SIDEBAR_HOME_SECTIONS)[number];
type SidebarHomeLayoutState = Partial<Record<SidebarHomeSectionId, { collapsed?: boolean; manualHeight?: number }>>;
type SidebarHomeMessage =
  | {
    type: 'openCommand';
    command: string;
    args?: string[];
  }
  | {
    type: 'saveLayout';
    layout: SidebarHomeLayoutState;
  };

type SidebarHomeSessionItem = {
  id: string;
  title: string;
  preview: string;
  turnCount: number;
  updatedLabel: string;
  isActive: boolean;
};

type SidebarHomeRunItem = {
  id: string;
  goal: string;
  status: ProjectRunRecord['status'];
  progressLabel: string;
  updatedLabel: string;
};

type SidebarHomeSnapshot = {
  quickLinks: readonly SidebarQuickLink[];
  sessions: {
    activeCount: number;
    archivedCount: number;
    folderCount: number;
    recent: SidebarHomeSessionItem[];
  };
  runs: {
    count: number;
    recent: SidebarHomeRunItem[];
  };
  workspace: {
    agentCount: number;
    customAgentCount: number;
    skillCount: number;
    customSkillCount: number;
    providerCount: number;
    enabledProviderCount: number;
    enabledModelCount: number;
    mcpConfiguredCount: number;
    mcpConnectedCount: number;
    ssotPresent: boolean;
    ssotLabel: string;
    staleMemoryCount: number;
    memoryActionCommand: 'atlasmind.updateProjectMemory' | 'atlasmind.importProject';
  };
};

/**
 * Registers all sidebar tree-view providers.
 */
export function registerTreeViews(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  const sidebarHomeViewProvider = new SidebarHomeViewProvider(context, atlas);
  const chatViewProvider = new ChatViewProvider(context.extensionUri, atlas);
  const skillsProvider = new SkillsTreeProvider(atlas);
  const agentsProvider = new AgentsTreeProvider(atlas);
  const sessionsProvider = new SessionsTreeProvider(atlas);
  const modelsProvider = new ModelsTreeProvider(atlas);
  const projectRunsProvider = new ProjectRunsTreeProvider(atlas);
  const mcpServersProvider = new McpServersTreeProvider(atlas);
  const memoryProvider = new MemoryTreeProvider(atlas);
  atlas.agentsRefresh.event(() => {
    agentsProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });
  atlas.skillsRefresh.event(() => {
    skillsProvider.refresh();
    mcpServersProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });
  atlas.sessionConversation.onDidChange(() => {
    sessionsProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });
  atlas.modelsRefresh.event(() => {
    modelsProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });
  atlas.projectRunsRefresh.event(() => {
    projectRunsProvider.refresh();
    sessionsProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });
  atlas.memoryRefresh.event(() => {
    memoryProvider.refresh();
    void sidebarHomeViewProvider.refresh();
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'atlasmind.quickLinksView',
      sidebarHomeViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
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

class SidebarHomeViewProvider implements vscode.WebviewViewProvider {
  private currentView: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly atlas: AtlasMindContext,
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.currentView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(message => {
      void this.handleMessage(message);
    });
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.currentView) {
      return;
    }
    const snapshot = await collectSidebarHomeSnapshot(this.atlas);
    const layout = this.context.workspaceState.get<SidebarHomeLayoutState>(SIDEBAR_HOME_LAYOUT_STATE_KEY, {});
    this.currentView.webview.html = this.getHtml(this.currentView.webview, snapshot, layout);
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isSidebarHomeMessage(message)) {
      return;
    }

    if (message.type === 'saveLayout') {
      await this.context.workspaceState.update(SIDEBAR_HOME_LAYOUT_STATE_KEY, message.layout);
      return;
    }

    await vscode.commands.executeCommand(message.command, ...(message.args ?? []));
  }

  private getHtml(webview: vscode.Webview, snapshot: SidebarHomeSnapshot, initialLayout: SidebarHomeLayoutState): string {
    return getWebviewHtmlShell({
      title: 'AtlasMind Home',
      cspSource: webview.cspSource,
      bodyContent: renderSidebarHomeBody(snapshot),
      scriptContent: buildSidebarHomeScript(initialLayout),
      extraCss: getSidebarHomeCss(),
    });
  }
}

function isSidebarHomeMessage(message: unknown): message is SidebarHomeMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }

  const candidate = message as Record<string, unknown>;
  if (candidate['type'] === 'openCommand') {
    return typeof candidate['command'] === 'string'
      && SIDEBAR_HOME_COMMANDS.has(candidate['command'])
      && (candidate['args'] === undefined || isStringArray(candidate['args']));
  }

  if (candidate['type'] === 'saveLayout') {
    return isSidebarHomeLayoutState(candidate['layout']);
  }

  return false;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isSidebarHomeLayoutState(value: unknown): value is SidebarHomeLayoutState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).every(([key, entry]) => {
    if (!SIDEBAR_HOME_SECTIONS.includes(key as SidebarHomeSectionId)) {
      return false;
    }
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }
    const sectionState = entry as Record<string, unknown>;
    return (sectionState['collapsed'] === undefined || typeof sectionState['collapsed'] === 'boolean')
      && (sectionState['manualHeight'] === undefined || (typeof sectionState['manualHeight'] === 'number' && Number.isFinite(sectionState['manualHeight']) && sectionState['manualHeight'] > 0));
  });
}

async function collectSidebarHomeSnapshot(atlas: AtlasMindContext): Promise<SidebarHomeSnapshot> {
  const sessions = atlas.sessionConversation.listSessions();
  const archivedSessions = atlas.sessionConversation.listArchivedSessions();
  const folders = atlas.sessionConversation.listFolders();
  const runs = await atlas.projectRunHistory.listRunsAsync(6);
  const agents = atlas.agentRegistry.listAgents();
  const skills = atlas.skillsRegistry.listSkills();
  const providers = atlas.modelRouter.listProviders();
  const mcpServers = atlas.mcpServerRegistry.listServers();

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const configuration = typeof vscode.workspace.getConfiguration === 'function'
    ? vscode.workspace.getConfiguration('atlasmind')
    : undefined;
  const ssotSetting = configuration?.get<string>('ssotPath', 'project_memory') ?? 'project_memory';
  const ssotRelativePath = getValidatedSsotPath(ssotSetting);
  const ssotPresent = workspaceFolder && ssotRelativePath
    ? await hasSidebarHomePath(vscode.Uri.joinPath(workspaceFolder.uri, ...ssotRelativePath.split('/')))
    : false;
  const freshness = workspaceFolder
    ? await getProjectMemoryFreshness(workspaceFolder.uri)
    : { hasImportedEntries: false, isStale: false, staleEntryCount: 0, staleEntries: [] };

  return {
    quickLinks: SIDEBAR_QUICK_LINKS,
    sessions: {
      activeCount: sessions.length,
      archivedCount: archivedSessions.length,
      folderCount: folders.length,
      recent: sessions.slice(0, 4).map(session => ({
        id: session.id,
        title: session.title,
        preview: session.preview,
        turnCount: session.turnCount,
        updatedLabel: formatSidebarHomeTimestamp(session.updatedAt),
        isActive: session.isActive,
      })),
    },
    runs: {
      count: runs.length,
      recent: runs.slice(0, 4).map(run => ({
        id: run.id,
        goal: run.goal,
        status: run.status,
        progressLabel: `${run.completedSubtaskCount}/${run.totalSubtaskCount} complete`,
        updatedLabel: formatSidebarHomeTimestamp(run.updatedAt),
      })),
    },
    workspace: {
      agentCount: agents.length,
      customAgentCount: agents.filter(agent => !agent.builtIn).length,
      skillCount: skills.length,
      customSkillCount: skills.filter(skill => !skill.builtIn).length,
      providerCount: providers.length,
      enabledProviderCount: providers.filter(provider => provider.enabled).length,
      enabledModelCount: providers.flatMap(provider => provider.models).filter(model => model.enabled).length,
      mcpConfiguredCount: mcpServers.length,
      mcpConnectedCount: mcpServers.filter(server => server.status === 'connected').length,
      ssotPresent,
      ssotLabel: ssotPresent && ssotRelativePath
        ? freshness.isStale
          ? `${ssotRelativePath}/ • ${freshness.staleEntryCount} stale`
          : `${ssotRelativePath}/ • current`
        : 'SSOT not detected',
      staleMemoryCount: freshness.isStale ? freshness.staleEntryCount : 0,
      memoryActionCommand: ssotPresent && freshness.hasImportedEntries ? 'atlasmind.updateProjectMemory' : 'atlasmind.importProject',
    },
  };
}

async function hasSidebarHomePath(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function renderSidebarHomeBody(snapshot: SidebarHomeSnapshot): string {
  return `
    <div class="home-shell">
      <div class="home-hero">
        <div>
          <p class="home-kicker">Sidebar Home</p>
          <h1>AtlasMind Home</h1>
          <p class="home-copy">One composite sidebar surface with internal accordion sections that close upward, resize to their content, and remember manual section heights when you drag them.</p>
        </div>
        <button type="button" class="hero-command" data-command="atlasmind.openProjectDashboard">Open Dashboard</button>
      </div>
      ${renderSidebarHomeSection('quick-links', 'Quick Actions', 'Launch the main AtlasMind workspaces from one compact row.', renderSidebarQuickLinksGrid(snapshot.quickLinks), `${snapshot.quickLinks.length} shortcuts`)}
      ${renderSidebarHomeSection('sessions', 'Recent Sessions', 'Jump back into active chat sessions without opening a separate tree first.', renderSidebarSessionsSection(snapshot.sessions), `${snapshot.sessions.activeCount} active • ${snapshot.sessions.archivedCount} archived`)}
      ${renderSidebarHomeSection('runs', 'Autonomous Runs', 'Review the latest project runs and reopen them in the Run Center.', renderSidebarRunsSection(snapshot.runs), `${snapshot.runs.count} tracked`)}
      ${renderSidebarHomeSection('workspace', 'Workspace Snapshot', 'Keep setup, model, memory, and MCP signals in one place.', renderSidebarWorkspaceSection(snapshot.workspace), snapshot.workspace.ssotLabel)}
    </div>
  `;
}

function renderSidebarHomeSection(id: SidebarHomeSectionId, title: string, description: string, content: string, meta: string): string {
  return `
    <section class="home-section" data-section-id="${id}">
      <button type="button" class="home-section-toggle" aria-expanded="true">
        <span class="home-section-title-block">
          <span class="home-section-title">${escapeHtml(title)}</span>
          <span class="home-section-description">${escapeHtml(description)}</span>
        </span>
        <span class="home-section-meta">${escapeHtml(meta)}</span>
      </button>
      <div class="home-section-panel">
        <div class="home-section-content">${content}</div>
        <div class="home-section-resizer" title="Drag to pin a manual section height. Drag back to the natural content height to restore auto sizing."></div>
      </div>
    </section>
  `;
}

function renderSidebarQuickLinksGrid(links: readonly SidebarQuickLink[]): string {
  return `
    <div class="quick-links-grid">
      ${links.map(link => {
        const tooltip = escapeHtml(`${link.label}: ${link.description}`);
        return `
          <button class="quick-link" type="button" data-command="${link.command}" title="${tooltip}" aria-label="${tooltip}">
            <span class="quick-link-icon" aria-hidden="true">${renderSidebarQuickLinkIcon(link.icon)}</span>
            <span class="quick-link-label">${escapeHtml(link.label)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderSidebarSessionsSection(sessions: SidebarHomeSnapshot['sessions']): string {
  const recentList = sessions.recent.length > 0
    ? sessions.recent.map(session => `
      <button type="button" class="summary-link" data-command="atlasmind.openChatView" data-arg="${escapeHtml(session.id)}">
        <span class="summary-link-head">
          <span class="summary-link-title">${escapeHtml(session.title)}</span>
          <span class="summary-link-meta">${escapeHtml(session.updatedLabel)}</span>
        </span>
        <span class="summary-link-copy">${escapeHtml(trimSidebarHomeText(session.preview, 96))}</span>
        <span class="summary-link-foot">${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}${session.isActive ? ' • active' : ''}</span>
      </button>
    `).join('')
    : '<div class="summary-empty">No active sessions yet. Start one from Chat and it will appear here.</div>';

  return `
    <div class="metric-row">
      <div class="metric-pill"><span>Active</span><strong>${sessions.activeCount}</strong></div>
      <div class="metric-pill"><span>Archived</span><strong>${sessions.archivedCount}</strong></div>
      <div class="metric-pill"><span>Folders</span><strong>${sessions.folderCount}</strong></div>
    </div>
    <div class="summary-list">${recentList}</div>
    <div class="section-actions">
      <button type="button" class="ghost-command" data-command="atlasmind.openChatView">Open Chat</button>
      <button type="button" class="ghost-command" data-command="atlasmind.openSettingsChat">Chat Settings</button>
    </div>
  `;
}

function renderSidebarRunsSection(runs: SidebarHomeSnapshot['runs']): string {
  const recentList = runs.recent.length > 0
    ? runs.recent.map(run => `
      <button type="button" class="summary-link" data-command="atlasmind.openProjectRunCenter" data-arg="${escapeHtml(run.id)}">
        <span class="summary-link-head">
          <span class="summary-link-title">${escapeHtml(trimSidebarHomeText(run.goal, 72))}</span>
          <span class="summary-link-meta">${escapeHtml(run.updatedLabel)}</span>
        </span>
        <span class="summary-link-copy">${escapeHtml(run.progressLabel)}</span>
        <span class="summary-link-foot status-${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
      </button>
    `).join('')
    : '<div class="summary-empty">No tracked runs yet. Start a `/project` run and it will show up here.</div>';

  return `
    <div class="metric-row single">
      <div class="metric-pill"><span>Tracked runs</span><strong>${runs.count}</strong></div>
    </div>
    <div class="summary-list">${recentList}</div>
    <div class="section-actions">
      <button type="button" class="ghost-command" data-command="atlasmind.openProjectRunCenter">Run Center</button>
      <button type="button" class="ghost-command" data-command="atlasmind.openSettingsProject">Project Settings</button>
    </div>
  `;
}

function renderSidebarWorkspaceSection(workspace: SidebarHomeSnapshot['workspace']): string {
  return `
    <div class="workspace-grid">
      <button type="button" class="workspace-card" data-command="atlasmind.openAgentPanel">
        <span class="workspace-card-title">Agents</span>
        <strong>${workspace.agentCount}</strong>
        <span>${workspace.customAgentCount} custom</span>
      </button>
      <button type="button" class="workspace-card" data-command="atlasmind.openAgentPanel">
        <span class="workspace-card-title">Skills</span>
        <strong>${workspace.skillCount}</strong>
        <span>${workspace.customSkillCount} custom</span>
      </button>
      <button type="button" class="workspace-card" data-command="atlasmind.openModelProviders">
        <span class="workspace-card-title">Models</span>
        <strong>${workspace.enabledModelCount}</strong>
        <span>${workspace.enabledProviderCount}/${workspace.providerCount} providers enabled</span>
      </button>
      <button type="button" class="workspace-card" data-command="atlasmind.openMcpServers">
        <span class="workspace-card-title">MCP</span>
        <strong>${workspace.mcpConfiguredCount}</strong>
        <span>${workspace.mcpConnectedCount} connected</span>
      </button>
      <button type="button" class="workspace-card" data-command="${workspace.memoryActionCommand}">
        <span class="workspace-card-title">Memory</span>
        <strong>${escapeHtml(workspace.ssotPresent ? 'SSOT ready' : 'Not imported')}</strong>
        <span>${escapeHtml(workspace.ssotLabel)}</span>
      </button>
      <button type="button" class="workspace-card" data-command="atlasmind.openSpecialistIntegrations">
        <span class="workspace-card-title">Specialists</span>
        <strong>Manage</strong>
        <span>Voice, vision, search, media</span>
      </button>
    </div>
    <div class="section-actions">
      <button type="button" class="ghost-command" data-command="${workspace.memoryActionCommand}">${workspace.memoryActionCommand === 'atlasmind.updateProjectMemory' ? 'Refresh Memory' : 'Import Project'}</button>
      <button type="button" class="ghost-command" data-command="atlasmind.openModelProviders">Model Providers</button>
    </div>
  `;
}

function trimSidebarHomeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatSidebarHomeTimestamp(timestamp: string): string {
  const deltaMs = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 60_000) {
    return 'just now';
  }
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildSidebarHomeScript(initialLayout: SidebarHomeLayoutState): string {
  return `
    const vscode = acquireVsCodeApi();
    const defaultLayout = ${serializeSidebarHomeData(initialLayout)};
    const persistedLayout = vscode.getState() ?? {};
    const layout = { ...defaultLayout, ...persistedLayout };

    function saveLayout() {
      vscode.setState(layout);
      vscode.postMessage({ type: 'saveLayout', layout });
    }

    function ensureSectionState(sectionId) {
      if (!layout[sectionId]) {
        layout[sectionId] = {};
      }
      return layout[sectionId];
    }

    function getNaturalHeight(content, resizer) {
      return content.scrollHeight + resizer.offsetHeight;
    }

    document.querySelectorAll('[data-command]').forEach(button => {
      button.addEventListener('click', () => {
        const command = button.getAttribute('data-command');
        if (!command) {
          return;
        }
        const arg = button.getAttribute('data-arg');
        vscode.postMessage({ type: 'openCommand', command, args: arg ? [arg] : undefined });
      });
    });

    document.querySelectorAll('.home-section').forEach(section => {
      const sectionId = section.getAttribute('data-section-id');
      const toggle = section.querySelector('.home-section-toggle');
      const panel = section.querySelector('.home-section-panel');
      const content = section.querySelector('.home-section-content');
      const resizer = section.querySelector('.home-section-resizer');
      if (!sectionId || !toggle || !panel || !content || !resizer) {
        return;
      }

      const sectionState = ensureSectionState(sectionId);

      function applyHeight() {
        const naturalHeight = getNaturalHeight(content, resizer);
        if (sectionState.collapsed) {
          panel.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
          section.classList.add('collapsed');
          return;
        }

        panel.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        section.classList.remove('collapsed');

        const manualHeight = typeof sectionState.manualHeight === 'number' ? sectionState.manualHeight : undefined;
        if (manualHeight && Math.abs(manualHeight - naturalHeight) > 6) {
          panel.style.height = manualHeight + 'px';
          section.classList.add('manual-height');
        } else {
          delete sectionState.manualHeight;
          panel.style.height = naturalHeight + 'px';
          section.classList.remove('manual-height');
        }
      }

      toggle.addEventListener('click', () => {
        sectionState.collapsed = !sectionState.collapsed;
        applyHeight();
        saveLayout();
      });

      const resizeObserver = new ResizeObserver(() => {
        applyHeight();
        saveLayout();
      });
      resizeObserver.observe(content);

      resizer.addEventListener('mousedown', event => {
        event.preventDefault();
        if (sectionState.collapsed) {
          return;
        }
        const startY = event.clientY;
        const startHeight = panel.getBoundingClientRect().height;

        function onMove(moveEvent) {
          const naturalHeight = getNaturalHeight(content, resizer);
          const nextHeight = Math.max(72, startHeight + (moveEvent.clientY - startY));
          if (Math.abs(nextHeight - naturalHeight) <= 6) {
            delete sectionState.manualHeight;
            panel.style.height = naturalHeight + 'px';
            section.classList.remove('manual-height');
          } else {
            sectionState.manualHeight = Math.round(nextHeight);
            panel.style.height = sectionState.manualHeight + 'px';
            section.classList.add('manual-height');
          }
        }

        function onUp() {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          applyHeight();
          saveLayout();
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      applyHeight();
    });

    saveLayout();
  `;
}

function getSidebarHomeCss(): string {
  return `
    html, body {
      margin: 0;
      min-height: 0;
      height: auto;
    }
    body {
      padding: 8px;
      overflow-y: auto;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-button-background) 12%, transparent), transparent 28%),
        linear-gradient(180deg, color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 96%, transparent), color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%));
    }
    .home-shell {
      display: grid;
      gap: 8px;
    }
    .home-hero,
    .home-section {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 92%, transparent);
      overflow: hidden;
    }
    .home-hero {
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .home-kicker, .home-section-description, .home-section-meta, .home-copy, .summary-link-copy, .workspace-card span, .metric-pill span {
      color: var(--vscode-descriptionForeground);
    }
    .home-kicker {
      margin: 0 0 4px;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .home-hero h1 {
      margin: 0;
      font-size: 1rem;
    }
    .home-copy {
      margin: 6px 0 0;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .hero-command,
    .ghost-command,
    .summary-link,
    .workspace-card,
    .quick-link,
    .home-section-toggle {
      font: inherit;
    }
    .hero-command,
    .ghost-command {
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 999px;
      padding: 6px 10px;
      background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
      color: var(--vscode-foreground);
    }
    .home-section-toggle {
      width: 100%;
      border: none;
      background: transparent;
      color: inherit;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      text-align: left;
      cursor: pointer;
    }
    .home-section-title-block {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .home-section-title {
      font-weight: 700;
    }
    .home-section-meta {
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .home-section-panel {
      overflow: hidden;
      border-top: 1px solid color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 70%, transparent);
    }
    .home-section-content {
      padding: 10px 12px 8px;
      display: grid;
      gap: 10px;
    }
    .home-section-resizer {
      height: 10px;
      cursor: ns-resize;
      background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 20%, transparent));
    }
    .home-section.collapsed .home-section-panel {
      display: none;
    }
    .metric-row,
    .section-actions,
    .quick-links-grid,
    .workspace-grid {
      display: grid;
      gap: 8px;
    }
    .metric-row {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .metric-row.single {
      grid-template-columns: minmax(0, 1fr);
    }
    .metric-pill,
    .summary-link,
    .workspace-card {
      border: 1px solid color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 75%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 75%, transparent);
    }
    .metric-pill {
      padding: 8px;
      display: grid;
      gap: 4px;
    }
    .metric-pill strong {
      font-size: 1.05rem;
    }
    .quick-links-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .quick-link {
      display: grid;
      place-items: center;
      gap: 4px;
      min-height: 58px;
      padding: 8px 4px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-widget-border, var(--vscode-panel-border)) 75%, transparent);
      background: color-mix(in srgb, var(--vscode-editorWidget-background, var(--vscode-sideBar-background)) 88%, transparent);
      color: var(--vscode-foreground);
    }
    .quick-link-icon {
      display: inline-flex;
      width: 18px;
      height: 18px;
      color: var(--vscode-button-background);
    }
    .quick-link-icon svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .quick-link-label {
      font-size: 0.74rem;
    }
    .summary-list {
      display: grid;
      gap: 8px;
    }
    .summary-link,
    .workspace-card {
      width: 100%;
      text-align: left;
      color: inherit;
      padding: 10px;
    }
    .summary-link-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: baseline;
    }
    .summary-link-title,
    .workspace-card-title,
    .summary-link-foot {
      font-weight: 600;
    }
    .summary-link,
    .workspace-card,
    .hero-command,
    .ghost-command,
    .quick-link {
      cursor: pointer;
    }
    .summary-link-copy,
    .summary-link-foot,
    .workspace-card span:last-child {
      display: block;
      margin-top: 4px;
      font-size: 0.82rem;
      line-height: 1.35;
    }
    .summary-empty {
      padding: 10px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-sideBar-background, var(--vscode-editor-background)) 75%, transparent);
      color: var(--vscode-descriptionForeground);
    }
    .workspace-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .workspace-card strong {
      display: block;
      margin-top: 6px;
      font-size: 1rem;
    }
    .status-completed { color: var(--vscode-testing-iconPassed, #73c991); }
    .status-failed { color: var(--vscode-errorForeground, #f14c4c); }
    .status-running { color: var(--vscode-charts-blue, #4fc1ff); }
    .status-paused, .status-pending, .status-approved { color: var(--vscode-charts-yellow, #cca700); }
    .hero-command:hover,
    .ghost-command:hover,
    .summary-link:hover,
    .workspace-card:hover,
    .quick-link:hover,
    .home-section-toggle:hover {
      background: color-mix(in srgb, var(--vscode-list-hoverBackground, var(--vscode-button-hoverBackground)) 80%, transparent);
    }
    @media (max-width: 360px) {
      .metric-row,
      .workspace-grid,
      .quick-links-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .home-section-toggle,
      .summary-link-head {
        display: grid;
      }
    }
  `;
}

function serializeSidebarHomeData(value: unknown): string {
  return JSON.stringify(value ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderSidebarQuickLinkIcon(icon: SidebarQuickLinkIcon): string {
  switch (icon) {
    case 'dashboard':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /></svg>';
    case 'ideation':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17.5h6" /><path d="M10 20.5h4" /><path d="M8.5 13.5c-1.3-1-2-2.5-2-4.1A5.5 5.5 0 0 1 12 4a5.5 5.5 0 0 1 5.5 5.4c0 1.6-.7 3.1-2 4.1-.8.7-1.3 1.5-1.5 2.5h-4c-.2-1-.7-1.8-1.5-2.5Z" /></svg>';
    case 'runs':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h7" /><path d="M13 6.5h7" /><path d="M6.5 12h5" /><path d="M13 17.5h5" /><circle cx="12" cy="6.5" r="1.5" /><circle cx="12" cy="17.5" r="1.5" /><path d="M12 8v8" /></svg>';
    case 'cost':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19.5h14" /><path d="M7.5 16.5v-5" /><path d="M12 16.5V8.5" /><path d="M16.5 16.5v-3" /><path d="M12 4.5v2" /><path d="M10.2 6.3c.5-.5 1.1-.8 1.8-.8 1.5 0 2.7.9 2.7 2.1 0 2.6-4.7 1.4-4.7 4 0 1.2 1.1 2 2.7 2 .8 0 1.6-.2 2.2-.8" /></svg>';
    case 'models':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="2" /><circle cx="17.5" cy="6.5" r="2" /><circle cx="17.5" cy="17.5" r="2" /><path d="M8.2 11.2 15.8 7.3" /><path d="M8.2 12.8 15.8 16.7" /></svg>';
    case 'profile':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19c1.4-3 4-4.5 6.5-4.5s5.1 1.5 6.5 4.5" /><path d="M4 19.5h16" /></svg>';
    case 'settings':
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.2" /><path d="M12 18.3v2.2" /><path d="M20.5 12h-2.2" /><path d="M5.7 12H3.5" /><path d="m18 6-1.6 1.6" /><path d="M7.6 16.4 6 18" /><path d="m18 18-1.6-1.6" /><path d="M7.6 7.6 6 6" /></svg>';
  }
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

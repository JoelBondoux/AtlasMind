import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

type WalkthroughStep = {
  id: string;
  description?: string;
  completionEvents?: string[];
};

type Walkthrough = {
  id: string;
  steps?: WalkthroughStep[];
};

type ContributedCommand = {
  command: string;
  title?: string;
};

type ContributedKeybinding = {
  command: string;
  key?: string;
  mac?: string;
  when?: string;
};

type ManifestMenuItem = {
  command: string;
  when?: string;
};

type ManifestConfigurationProperty = {
  type?: string | string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

describe('package manifest', () => {
  it('activates on startup so walkthrough command buttons are ready immediately', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  it('wires the configure-provider walkthrough step to the provider command', () => {
    const walkthroughs = (manifest.contributes?.walkthroughs ?? []) as Walkthrough[];
    const getStarted = walkthroughs.find(entry => entry.id === 'atlasmind.getStarted');
    const configureProvider = getStarted?.steps?.find(step => step.id === 'configureProvider');

    expect(configureProvider?.description).toContain('(command:atlasmind.openModelProviders)');
    expect(configureProvider?.description).toContain('(command:atlasmind.openSettingsModels)');
    expect(configureProvider?.completionEvents).toContain('onCommand:atlasmind.openModelProviders');
    expect(configureProvider?.completionEvents).toContain('onCommand:atlasmind.openSettingsModels');
  });

  it('wires the sidebar empty-state links to registered commands', () => {
    const viewsWelcome = manifest.contributes?.viewsWelcome ?? [];
    const skillsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.skillsView');
    const agentsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.agentsView');
    const mcpWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.mcpServersView');
    const modelsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.modelsView');
    const projectRunsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.projectRunsView');
    const sessionsWelcome = viewsWelcome.find(entry => entry.view === 'atlasmind.sessionsView');

    expect(skillsWelcome?.contents).toContain('(command:atlasmind.skills.addSkill)');
    expect(agentsWelcome?.contents).toContain('(command:atlasmind.openAgentPanel)');
    expect(agentsWelcome?.contents).toContain('(command:atlasmind.openSettingsModels)');
    expect(mcpWelcome?.contents).toContain('(command:atlasmind.openMcpServers)');
    expect(mcpWelcome?.contents).toContain('(command:atlasmind.openSettingsSafety)');
    expect(modelsWelcome?.contents).toContain('(command:atlasmind.openModelProviders)');
    expect(modelsWelcome?.contents).toContain('(command:atlasmind.openSettingsModels)');
    expect(modelsWelcome?.contents).toContain('(command:atlasmind.openSpecialistIntegrations)');
    expect(projectRunsWelcome?.contents).toContain('(command:atlasmind.openProjectIdeation)');
    expect(projectRunsWelcome?.contents).toContain('(command:atlasmind.openProjectRunCenter)');
    expect(projectRunsWelcome?.contents).toContain('(command:atlasmind.openSettingsProject)');
    expect(sessionsWelcome?.contents).toContain('(command:atlasmind.openChatView)');
    expect(sessionsWelcome?.contents).toContain('(command:atlasmind.openSettingsChat)');
  });

  it('contributes a Getting Started command for reopening the walkthrough', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const gettingStarted = commands.find(entry => entry.command === 'atlasmind.openGettingStarted');

    expect(gettingStarted?.title).toBe('AtlasMind: Getting Started');
  });

  it('contributes a dedicated AtlasMind chat panel command', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const chatPanel = commands.find(entry => entry.command === 'atlasmind.openChatPanel');

    expect(chatPanel?.title).toBe('AtlasMind: Open Chat Panel');
  });

  it('contributes an embedded AtlasMind chat view command', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const chatView = commands.find(entry => entry.command === 'atlasmind.openChatView');
    const dashboard = commands.find(entry => entry.command === 'atlasmind.openProjectDashboard');
    const ideation = commands.find(entry => entry.command === 'atlasmind.openProjectIdeation');
    const personality = commands.find(entry => entry.command === 'atlasmind.openPersonalityProfile');

    expect(chatView?.title).toBe('AtlasMind: Focus Chat View');
    expect(dashboard?.title).toBe('AtlasMind: Open Project Dashboard');
    expect(ideation?.title).toBe('AtlasMind: Open Project Ideation');
    expect(personality?.title).toBe('AtlasMind: Open Personality Profile');
  });

  it('contributes detached chat panel title actions for runs and sidebar chat', () => {
    const editorTitleMenus = (manifest.contributes?.menus?.['editor/title'] ?? []) as ManifestMenuItem[];

    expect(editorTitleMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.openProjectRunCenter',
        when: 'activeWebviewPanelId == atlasmind.chatPanel',
      }),
      expect.objectContaining({
        command: 'atlasmind.openChatView',
        when: 'activeWebviewPanelId == atlasmind.chatPanel',
      }),
    ]));
  });

  it('contributes page-specific AtlasMind settings commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];

    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsChat')?.title).toBe('AtlasMind: Open Chat Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsModels')?.title).toBe('AtlasMind: Open Model Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsSafety')?.title).toBe('AtlasMind: Open Safety Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsProject')?.title).toBe('AtlasMind: Open Project Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.collapseAllSidebarTrees')?.title).toBe('AtlasMind: Collapse All Sidebar Trees');
  });

  it('contributes a VS Code MCP import command', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const importCommand = commands.find(entry => entry.command === 'atlasmind.mcpServers.importFromVsCode');

    expect(importCommand?.title).toBe('AtlasMind: Import VS Code MCP Servers');
  });

  it('contributes an autopilot toggle command', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const autopilot = commands.find(entry => entry.command === 'atlasmind.toggleAutopilot');

    expect(autopilot?.title).toBe('AtlasMind: Toggle Autopilot');
  });

  it('binds a keyboard shortcut to the AtlasMind chat panel command', () => {
    const keybindings = (manifest.contributes?.keybindings ?? []) as ContributedKeybinding[];
    const openChatPanel = keybindings.find(entry => entry.command === 'atlasmind.openChatPanel');
    const renameSession = keybindings.find(entry => entry.command === 'atlasmind.sessions.rename');

    expect(openChatPanel).toMatchObject({
      key: 'ctrl+alt+i',
      mac: 'cmd+alt+i',
      when: '!inputFocus',
    });
    expect(renameSession).toMatchObject({
      key: 'f2',
      when: 'view == atlasmind.sessionsView && listFocus && viewItem =~ /^chat-session/',
    });
  });

  it('contributes skill folder and session management commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];

    expect(commands.find(entry => entry.command === 'atlasmind.skills.createFolder')?.title).toBe('Create Skill Folder');
    expect(commands.find(entry => entry.command === 'atlasmind.sessions.rename')?.title).toBe('Rename Session');
    expect(commands.find(entry => entry.command === 'atlasmind.sessions.createFolder')?.title).toBe('Create Session Folder');
    expect(commands.find(entry => entry.command === 'atlasmind.sessions.moveToFolder')?.title).toBe('Move Session To Folder');
    expect(commands.find(entry => entry.command === 'atlasmind.sessions.archive')?.title).toBe('Archive Session');
    expect(commands.find(entry => entry.command === 'atlasmind.sessions.restore')?.title).toBe('Restore Session');
    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.skills.createFolder', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.rename', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.createFolder', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.moveToFolder', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.archive', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.restore', when: 'false' }),
    ]));
  });

  it('wires walkthrough chat steps to the AtlasMind chat panel command', () => {
    const walkthroughs = (manifest.contributes?.walkthroughs ?? []) as Walkthrough[];
    const getStarted = walkthroughs.find(entry => entry.id === 'atlasmind.getStarted');
    const personalityProfile = getStarted?.steps?.find(step => step.id === 'personalityProfile');
    const firstChat = getStarted?.steps?.find(step => step.id === 'firstChat');
    const tryProject = getStarted?.steps?.find(step => step.id === 'tryProject');

    expect(getStarted?.description).toContain('five steps');
    expect(personalityProfile?.description).toContain('(command:atlasmind.openPersonalityProfile)');
    expect(personalityProfile?.description).toContain('(command:atlasmind.openSettingsProject)');
    expect(personalityProfile?.completionEvents).toContain('onCommand:atlasmind.openPersonalityProfile');
    expect(personalityProfile?.completionEvents).toContain('onCommand:atlasmind.openSettingsProject');
    expect(firstChat?.description).toContain('(command:atlasmind.openChatView)');
    expect(firstChat?.description).toContain('(command:atlasmind.openSettingsChat)');
    expect(firstChat?.completionEvents).toContain('onCommand:atlasmind.openChatView');
    expect(firstChat?.completionEvents).toContain('onCommand:atlasmind.openSettingsChat');
    expect(tryProject?.description).toContain('(command:atlasmind.openChatPanel)');
    expect(tryProject?.description).toContain('(command:atlasmind.openProjectIdeation)');
    expect(tryProject?.description).toContain('(command:atlasmind.openSettingsProject)');
    expect(tryProject?.completionEvents).toContain('onCommand:atlasmind.openChatPanel');
    expect(tryProject?.completionEvents).toContain('onCommand:atlasmind.openProjectIdeation');
    expect(tryProject?.completionEvents).toContain('onCommand:atlasmind.openSettingsProject');
  });

  it('contributes the native AtlasMind chat participant', () => {
    const participants = (manifest.contributes?.chatParticipants ?? []) as Array<{
      id: string;
      fullName?: string;
      name?: string;
    }>;
    const participant = participants.find(entry => entry.id === 'atlasmind.orchestrator');

    expect(participant).toMatchObject({
      id: 'atlasmind.orchestrator',
      fullName: 'AtlasMind',
      name: 'atlas',
    });
  });

  it('contributes the voice device preference settings', () => {
    const configuration = manifest.contributes?.configuration as { properties?: Record<string, ManifestConfigurationProperty> } | undefined;
    const properties = configuration?.properties ?? {};

    expect(properties['atlasmind.voice.sttEnabled']).toMatchObject({ type: 'boolean', default: false });
    expect(properties['atlasmind.voice.inputDeviceId']).toMatchObject({ type: 'string', default: '' });
    expect(properties['atlasmind.voice.outputDeviceId']).toMatchObject({ type: 'string', default: '' });
  });

  it('contributes memory tree edit and review commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const editMemory = commands.find(entry => entry.command === 'atlasmind.memory.openEntry');
    const reviewMemory = commands.find(entry => entry.command === 'atlasmind.memory.showReview');
    const summarizeSkill = commands.find(entry => entry.command === 'atlasmind.skills.showSummary');
    const summarizeMcpServer = commands.find(entry => entry.command === 'atlasmind.mcpServers.showSummary');
    const updateMemory = commands.find(entry => entry.command === 'atlasmind.updateProjectMemory');
    const renameSession = commands.find(entry => entry.command === 'atlasmind.sessions.rename');
    const createSessionFolder = commands.find(entry => entry.command === 'atlasmind.sessions.createFolder');
    const moveSessionToFolder = commands.find(entry => entry.command === 'atlasmind.sessions.moveToFolder');
    const archiveSession = commands.find(entry => entry.command === 'atlasmind.sessions.archive');
    const restoreSession = commands.find(entry => entry.command === 'atlasmind.sessions.restore');

    expect(editMemory?.title).toBe('Edit Memory File');
    expect(reviewMemory?.title).toBe('Summarize Memory In Chat');
    expect(summarizeSkill?.title).toBe('Summarize Skill In Chat');
    expect(summarizeMcpServer?.title).toBe('Summarize MCP Server In Chat');
    expect(updateMemory?.title).toBe('AtlasMind: Update Project Memory');
    expect(renameSession?.title).toBe('Rename Session');
    expect(createSessionFolder?.title).toBe('Create Session Folder');
    expect(moveSessionToFolder?.title).toBe('Move Session To Folder');
    expect(archiveSession?.title).toBe('Archive Session');
    expect(restoreSession?.title).toBe('Restore Session');

    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.sessions.archive', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.sessions.restore', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.skills.showSummary', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.mcpServers.showSummary', when: 'false' }),
    ]));

    const menus = (manifest.contributes?.menus?.['view/item/context'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.sessions.rename',
        when: 'view == atlasmind.sessionsView && viewItem =~ /^chat-session/',
      }),
      expect.objectContaining({
        command: 'atlasmind.sessions.moveToFolder',
        when: 'view == atlasmind.sessionsView && viewItem =~ /^chat-session/',
      }),
      expect.objectContaining({
        command: 'atlasmind.sessions.archive',
        when: 'view == atlasmind.sessionsView && (viewItem == chat-session || viewItem == chat-session-active)',
      }),
      expect.objectContaining({
        command: 'atlasmind.sessions.restore',
        when: 'view == atlasmind.sessionsView && viewItem == chat-session-archived',
      }),
      expect.objectContaining({
        command: 'atlasmind.skills.showSummary',
        when: 'view == atlasmind.skillsView && viewItem =~ /^skill-/',
      }),
      expect.objectContaining({
        command: 'atlasmind.memory.openEntry',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
      }),
      expect.objectContaining({
        command: 'atlasmind.memory.showReview',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
      }),
      expect.objectContaining({
        command: 'atlasmind.mcpServers.showSummary',
        when: 'view == atlasmind.mcpServersView && viewItem =~ /^mcp-server-/',
      }),
    ]));

    const titleMenus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    expect(titleMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.skills.createFolder',
        when: 'view == atlasmind.skillsView',
      }),
      expect.objectContaining({
        command: 'atlasmind.sessions.createFolder',
        when: 'view == atlasmind.sessionsView',
      }),
      expect.objectContaining({
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.memoryView && atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.memoryView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
    ]));

    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.memory.openEntry', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.memory.showReview', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.skills.showSummary', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.mcpServers.showSummary', when: 'false' }),
    ]));
  });

  it('contributes the Sessions sidebar view', () => {
    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; name?: string; visibility?: string }>;
    const quickLinksView = views.find(entry => entry.id === 'atlasmind.quickLinksView');
    const chatView = views.find(entry => entry.id === 'atlasmind.chatView');
    const sessionsView = views.find(entry => entry.id === 'atlasmind.sessionsView');

    expect(quickLinksView?.name).toBe('Quick Links');
    expect(chatView?.name).toBe('Chat');

    expect(sessionsView?.name).toBe('Sessions');
  });

  it('ships the AtlasMind sidebar tree views in the default operational order and collapsed by default', () => {
    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; visibility?: string }>;

    expect(views.map(entry => entry.id)).toEqual([
      'atlasmind.quickLinksView',
      'atlasmind.chatView',
      'atlasmind.projectRunsView',
      'atlasmind.sessionsView',
      'atlasmind.memoryView',
      'atlasmind.agentsView',
      'atlasmind.skillsView',
      'atlasmind.mcpServersView',
      'atlasmind.modelsView',
    ]);

    expect(views.filter(entry => entry.id !== 'atlasmind.chatView' && entry.id !== 'atlasmind.quickLinksView')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'atlasmind.projectRunsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.sessionsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.memoryView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.agentsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.skillsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.mcpServersView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.modelsView', visibility: 'collapsed' }),
    ]));
  });

  it('adds a collapse-all action to the AtlasMind sidebar container menu', () => {
    const menus = (manifest.contributes?.menus?.['view/container/title'] ?? []) as ManifestMenuItem[];

    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.collapseAllSidebarTrees',
        when: 'viewContainer == atlasmind-sidebar',
      }),
    ]));
  });

  it('contributes Models view inline toggle and info commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const toggleEnabled = commands.find(entry => entry.command === 'atlasmind.models.toggleEnabled');
    const openInfo = commands.find(entry => entry.command === 'atlasmind.models.openInfo');
    const configureProvider = commands.find(entry => entry.command === 'atlasmind.models.configureProvider');
    const refreshProvider = commands.find(entry => entry.command === 'atlasmind.models.refreshProvider');
    const assignToAgent = commands.find(entry => entry.command === 'atlasmind.models.assignToAgent');

    expect(toggleEnabled?.title).toBe('Toggle Model Enabled');
    expect(openInfo?.title).toBe('Summarize Model In Chat');
    expect(configureProvider?.title).toBe('Configure Model Provider');
    expect(refreshProvider?.title).toBe('Refresh Available Models');
    expect(assignToAgent?.title).toBe('Assign To Agents');

    const menus = (manifest.contributes?.menus?.['view/item/context'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.models.toggleEnabled',
        when: 'view == atlasmind.modelsView && viewItem =~ /^model-/',
      }),
      expect.objectContaining({
        command: 'atlasmind.models.openInfo',
        when: 'view == atlasmind.modelsView && viewItem =~ /^model-/',
      }),
      expect.objectContaining({
        command: 'atlasmind.models.configureProvider',
        when: 'view == atlasmind.modelsView && viewItem =~ /^model-provider-/',
      }),
      expect.objectContaining({
        command: 'atlasmind.models.refreshProvider',
        when: 'view == atlasmind.modelsView && viewItem =~ /^model-provider-configured-/',
      }),
      expect.objectContaining({
        command: 'atlasmind.models.assignToAgent',
        when: 'view == atlasmind.modelsView && viewItem =~ /^model-/',
      }),
    ]));

    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.models.toggleEnabled', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.openInfo', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.configureProvider', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.refreshProvider', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.assignToAgent', when: 'false' }),
    ]));
  });

  it('keeps every unprefixed command out of the Command Palette', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const hiddenCommands = new Set(
      paletteMenus
        .filter(entry => entry.when === 'false')
        .map(entry => entry.command),
    );

    const unprefixedCommands = commands
      .filter(entry => entry.title && !entry.title.startsWith('AtlasMind:'))
      .map(entry => entry.command);

    expect(unprefixedCommands).not.toHaveLength(0);
    expect(unprefixedCommands.every(command => hiddenCommands.has(command))).toBe(true);
  });

  it('routes the MCP title-bar settings action to the safety page', () => {
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.openSettingsSafety',
        when: 'view == atlasmind.mcpServersView',
      }),
    ]));
  });

  it('adds a dashboard shortcut to the AtlasMind chat view title bar', () => {
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.openProjectDashboard',
        when: 'view == atlasmind.chatView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openProjectIdeation',
        when: 'view == atlasmind.chatView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openCostDashboard',
        when: 'view == atlasmind.chatView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openSettings',
        when: 'view == atlasmind.chatView',
      }),
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.chatView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.chatView && atlasmind.ssotPresent',
      }),
    ]));
  });

  it('adds the same dashboard and project quick actions to core sidebar views', () => {
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.openProjectIdeation',
        when: 'view == atlasmind.projectRunsView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openProjectDashboard',
        when: 'view == atlasmind.sessionsView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openCostDashboard',
        when: 'view == atlasmind.sessionsView',
      }),
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.sessionsView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.sessionsView && atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.openProjectDashboard',
        when: 'view == atlasmind.memoryView',
      }),
      expect.objectContaining({
        command: 'atlasmind.openCostDashboard',
        when: 'view == atlasmind.memoryView',
      }),
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.memoryView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.memoryView && atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
    ]));
  });

  it('relies on generated command and view activation events instead of duplicating them', () => {
    expect(manifest.activationEvents).toEqual([
      'onStartupFinished',
      'onChatParticipant:atlasmind.orchestrator',
    ]);
  });

  it('publishes the compiled AtlasMind CLI as an npm bin and helper script', () => {
    expect(manifest.bin).toMatchObject({
      atlasmind: './out/cli/main.js',
    });

    expect(manifest.scripts?.cli).toBe('node ./out/cli/main.js');
  });

  it('publishes stable Marketplace builds while AtlasMind remains beta-branded pre-1.0', () => {
    expect((manifest as { preview?: boolean }).preview).toBe(false);
    expect(manifest.scripts?.['publish:pre-release']).toBe('npx @vscode/vsce publish --pre-release');
    expect(manifest.scripts?.['publish:release']).toBe('npx @vscode/vsce publish');
  });

  it('contributes a feedback routing weight setting with a bounded numeric range', () => {
    const configuration = manifest.contributes?.configuration as { properties?: Record<string, ManifestConfigurationProperty> } | undefined;
    const feedbackWeight = configuration?.properties?.['atlasmind.feedbackRoutingWeight'];

    expect(feedbackWeight).toMatchObject({
      type: 'number',
      default: 1,
      minimum: 0,
      maximum: 2,
    });
  });
});
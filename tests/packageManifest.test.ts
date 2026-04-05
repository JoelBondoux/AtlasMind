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

    expect(chatView?.title).toBe('AtlasMind: Focus Chat View');
  });

  it('contributes page-specific AtlasMind settings commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];

    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsChat')?.title).toBe('AtlasMind: Open Chat Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsModels')?.title).toBe('AtlasMind: Open Model Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsSafety')?.title).toBe('AtlasMind: Open Safety Settings');
    expect(commands.find(entry => entry.command === 'atlasmind.openSettingsProject')?.title).toBe('AtlasMind: Open Project Settings');
  });

  it('contributes an autopilot toggle command', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const autopilot = commands.find(entry => entry.command === 'atlasmind.toggleAutopilot');

    expect(autopilot?.title).toBe('AtlasMind: Toggle Autopilot');
  });

  it('binds a keyboard shortcut to the AtlasMind chat panel command', () => {
    const keybindings = (manifest.contributes?.keybindings ?? []) as ContributedKeybinding[];
    const openChatPanel = keybindings.find(entry => entry.command === 'atlasmind.openChatPanel');

    expect(openChatPanel).toMatchObject({
      key: 'ctrl+alt+i',
      mac: 'cmd+alt+i',
      when: '!inputFocus',
    });
  });

  it('wires walkthrough chat steps to the AtlasMind chat panel command', () => {
    const walkthroughs = (manifest.contributes?.walkthroughs ?? []) as Walkthrough[];
    const getStarted = walkthroughs.find(entry => entry.id === 'atlasmind.getStarted');
    const firstChat = getStarted?.steps?.find(step => step.id === 'firstChat');
    const tryProject = getStarted?.steps?.find(step => step.id === 'tryProject');

    expect(firstChat?.description).toContain('(command:atlasmind.openChatView)');
    expect(firstChat?.description).toContain('(command:atlasmind.openSettingsChat)');
    expect(firstChat?.completionEvents).toContain('onCommand:atlasmind.openChatView');
    expect(firstChat?.completionEvents).toContain('onCommand:atlasmind.openSettingsChat');
    expect(tryProject?.description).toContain('(command:atlasmind.openChatPanel)');
    expect(tryProject?.description).toContain('(command:atlasmind.openSettingsProject)');
    expect(tryProject?.completionEvents).toContain('onCommand:atlasmind.openChatPanel');
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

  it('contributes memory tree edit and review commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const editMemory = commands.find(entry => entry.command === 'atlasmind.memory.openEntry');
    const reviewMemory = commands.find(entry => entry.command === 'atlasmind.memory.showReview');

    expect(editMemory?.title).toBe('Edit Memory File');
    expect(reviewMemory?.title).toBe('Review Memory File');

    const menus = (manifest.contributes?.menus?.['view/item/context'] ?? []) as ManifestMenuItem[];
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.memory.openEntry',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
      }),
      expect.objectContaining({
        command: 'atlasmind.memory.showReview',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
      }),
    ]));
  });

  it('contributes the Sessions sidebar view', () => {
    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; name?: string }>;
    const chatView = views.find(entry => entry.id === 'atlasmind.chatView');
    const sessionsView = views.find(entry => entry.id === 'atlasmind.sessionsView');

    expect(chatView?.name).toBe('Chat');

    expect(sessionsView?.name).toBe('Sessions');
  });

  it('contributes Models view inline toggle and info commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const toggleEnabled = commands.find(entry => entry.command === 'atlasmind.models.toggleEnabled');
    const openInfo = commands.find(entry => entry.command === 'atlasmind.models.openInfo');
    const configureProvider = commands.find(entry => entry.command === 'atlasmind.models.configureProvider');
    const refreshProvider = commands.find(entry => entry.command === 'atlasmind.models.refreshProvider');
    const assignToAgent = commands.find(entry => entry.command === 'atlasmind.models.assignToAgent');

    expect(toggleEnabled?.title).toBe('Toggle Model Enabled');
    expect(openInfo?.title).toBe('Open Model Info');
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
});
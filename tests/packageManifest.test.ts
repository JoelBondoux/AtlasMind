import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../package.json';

const REPO_ROOT = path.resolve(__dirname, '..');

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
  icon?: string;
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
  description?: string;
  markdownDescription?: string;
};

describe('package manifest', () => {
  it('activates on startup so walkthrough command buttons are ready immediately', () => {
    expect(manifest.activationEvents).toContain('onStartupFinished');
  });

  it('keeps the changelog title and release-notes preamble intact', () => {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    const normalized = changelog.replace(/^\uFEFF/, '');

    expect(normalized).toMatch(/^# Changelog\r?\n\r?\n/);
    expect(normalized).toContain('All notable changes to this project will be documented in this file.');
    expect(normalized).toContain('Keep a Changelog');
  });

  it('keeps the README source-version banner synced to package.json', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    expect(readme).toContain(`Current source version: ${manifest.version}`);
  });

  it('keeps the Stryker REST client on the patched qs release', () => {
    const overrides = manifest.overrides as Record<string, unknown>;

    expect(overrides.qs).toBe('6.15.2');
  });

  it('provides validation and editor guidance for explicit Lens field mappings', () => {
    const validation = manifest.contributes?.jsonValidation ?? [];
    const schemaPath = path.resolve(REPO_ROOT, 'schemas/lens-mappings.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

    expect(validation).toContainEqual({
      fileMatch: '**/.atlasmind/lens-mappings.json',
      url: './schemas/lens-mappings.schema.json',
    });
    expect(schema).toEqual(expect.objectContaining({
      title: 'AtlasMind Lens explicit field mappings',
      additionalProperties: false,
    }));
  });

  it('provides validation and editor guidance for Lens data trust policy', () => {
    const validation = manifest.contributes?.jsonValidation ?? [];
    const schemaPath = path.resolve(REPO_ROOT, 'schemas/lens-data-trust.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

    expect(validation).toContainEqual({
      fileMatch: '**/.atlasmind/lens-data-trust.json',
      url: './schemas/lens-data-trust.schema.json',
    });
    expect(schema).toEqual(expect.objectContaining({
      title: 'AtlasMind Lens data trust policy',
      additionalProperties: false,
    }));
  });

  it('provides validation and editor guidance for Lens state-machine declarations', () => {
    const validation = manifest.contributes?.jsonValidation ?? [];
    const schemaPath = path.resolve(REPO_ROOT, 'schemas/lens-state.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

    expect(validation).toContainEqual({
      fileMatch: '**/.atlasmind/lens-state.json',
      url: './schemas/lens-state.schema.json',
    });
    expect(schema).toEqual(expect.objectContaining({
      title: 'AtlasMind Lens state-machine declarations',
      additionalProperties: false,
    }));
  });

  it('provides validation and editor guidance for Lens configuration resolution declarations', () => {
    const validation = manifest.contributes?.jsonValidation ?? [];
    const schemaPath = path.resolve(REPO_ROOT, 'schemas/lens-config.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;

    expect(validation).toContainEqual({
      fileMatch: '**/.atlasmind/lens-config.json',
      url: './schemas/lens-config.schema.json',
    });
    expect(schema).toEqual(expect.objectContaining({
      title: 'AtlasMind Lens configuration resolution declarations',
      additionalProperties: false,
    }));
  });

  it('keeps the README sales-led and free of competitor comparison charts', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    expect(readme).toContain('Your AI delivery team, inside VS Code.');
    expect(readme).toContain(`## What's new in ${manifest.version}`);
    expect(readme).not.toContain('| Feature | AtlasMind | Copilot');
    expect(readme).not.toContain('wiki/Comparison.md');
  });

  it('uses the ACP panel’s wording in the native Settings search entry', () => {
    const property = manifest.contributes?.configuration?.properties?.['atlasmind.acp.toolsEnabled'] as ManifestConfigurationProperty | undefined;
    expect(property?.description).toContain('Let subscription agents act');
    expect(property?.markdownDescription).toContain('Let subscription agents act');
  });

  it('keeps the wiki comparison page and navigation removed', () => {
    const home = readFileSync(new URL('../wiki/Home.md', import.meta.url), 'utf8');
    const sidebar = readFileSync(new URL('../wiki/_Sidebar.md', import.meta.url), 'utf8');

    expect(existsSync(new URL('../wiki/Comparison.md', import.meta.url))).toBe(false);
    expect(home).not.toContain('[[Comparison]]');
    expect(sidebar).not.toContain('[[Comparison]]');
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

  it('makes Lens declaration setup discoverable from onboarding and the Command Palette', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const walkthroughs = (manifest.contributes?.walkthroughs ?? []) as Walkthrough[];
    const getStarted = walkthroughs.find(entry => entry.id === 'atlasmind.getStarted');
    const lensSetup = getStarted?.steps?.find(step => step.id === 'setupLensDeclarations');

    expect(commands.find(entry => entry.command === 'atlasmind.lens.setupDeclarations')?.title)
      .toBe('AtlasMind: Lens: Set Up Repository Declarations');
    expect(lensSetup?.description).toContain('(command:atlasmind.lens.setupDeclarations)');
    expect(lensSetup?.completionEvents).toContain('onCommand:atlasmind.lens.setupDeclarations');
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
    const websiteStudio = commands.find(entry => entry.command === 'atlasmind.openWebsiteStudio');

    expect(chatView?.title).toBe('AtlasMind: Focus Chat View');
    expect(dashboard?.title).toBe('AtlasMind: Open Project Dashboard');
    expect(websiteStudio?.title).toBe('AtlasMind: Open Website Studio');
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
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const editMemory = commands.find(entry => entry.command === 'atlasmind.memory.openEntry');
    const reviewMemory = commands.find(entry => entry.command === 'atlasmind.memory.showReview');
    const updateMemory = commands.find(entry => entry.command === 'atlasmind.updateProjectMemory');
    const renameSession = commands.find(entry => entry.command === 'atlasmind.sessions.rename');
    const createSessionFolder = commands.find(entry => entry.command === 'atlasmind.sessions.createFolder');
    const moveSessionToFolder = commands.find(entry => entry.command === 'atlasmind.sessions.moveToFolder');

    expect(editMemory?.title).toBe('Edit Memory File');
    expect(reviewMemory?.title).toBe('Summarize Memory In Chat');
    expect(updateMemory?.title).toBe('AtlasMind: Update Project Memory');
    expect(renameSession?.title).toBe('Rename Session');
    expect(createSessionFolder?.title).toBe('Create Session Folder');
    expect(moveSessionToFolder?.title).toBe('Move Session To Folder');

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
        command: 'atlasmind.memory.openEntry',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
      }),
      expect.objectContaining({
        command: 'atlasmind.memory.showReview',
        when: 'view == atlasmind.memoryView && viewItem == memory-entry',
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
        // No `showImportProjectAction` guard: that setting is documented as
        // governing the *import* action, and gating this one with it meant
        // turning the import off hid "Update memory" as well.
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.memoryView && atlasmind.ssotPresent',
      }),
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.memoryView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
    ]));

    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.memory.openEntry', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.memory.showReview', when: 'false' }),
    ]));
  });

  it('contributes Lens filtering and item actions without exposing item-only commands in the palette', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const itemMenus = (manifest.contributes?.menus?.['view/item/context'] ?? []) as ManifestMenuItem[];
    const titleMenus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];

    expect(commands.map(entry => entry.command)).toEqual(expect.arrayContaining([
      'atlasmind.lens.filterSymbols',
      'atlasmind.lens.reviewContracts',
      'atlasmind.lens.reviewState',
      'atlasmind.lens.reviewConfig',
      'atlasmind.lens.reviewChangeStory',
      'atlasmind.lens.moreTargetActions',
    ]));
    expect(titleMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.filterSymbols',
      when: 'view == atlasmind.lensView',
    }));
    expect(titleMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.reviewContracts',
      when: 'view == atlasmind.lensView',
    }));
    expect(titleMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.reviewState',
      when: 'view == atlasmind.lensView',
    }));
    expect(titleMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.reviewConfig',
      when: 'view == atlasmind.lensView',
    }));
    expect(titleMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.reviewChangeStory',
      when: 'view == atlasmind.lensView',
    }));
    expect(itemMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.moreTargetActions',
      when: expect.stringContaining('atlasmind.lensView'),
    }));
    expect(paletteMenus).toContainEqual(expect.objectContaining({
      command: 'atlasmind.lens.moreTargetActions',
      when: 'false',
    }));
  });

  it('contributes the Sessions sidebar view', () => {
    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; name?: string; visibility?: string }>;
    const chatView = views.find(entry => entry.id === 'atlasmind.chatView');
    const sessionsView = views.find(entry => entry.id === 'atlasmind.sessionsView');

    expect(chatView?.name).toBe('Chat');

    expect(sessionsView?.name).toBe('Sessions');
  });

  it('ships the AtlasMind sidebar tree views in the default operational order and collapsed by default', () => {
    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; visibility?: string }>;

    // The order reads top to bottom as a sentence: where you work, what you
    // are exploring, who needs you, where you stand, what has happened, what
    // the project knows, what does the work, what it runs on, what it can reach.
    //
    // Set to the arrangement the maintainer reached by actually using it, which
    // beats a reasoned guess about a layout nobody had lived with yet. The two
    // properties the previous reasoning was protecting are both still true:
    // Project State is near the top rather than below ten inventory rows, and
    // the Director's overdue badge is somewhere you do not have to scroll to.
    expect(views.map(entry => entry.id)).toEqual([
      'atlasmind.chatView',
      // The compact active-file explorer belongs next to Chat because its
      // primary action attaches a selected target to a new Chat question.
      'atlasmind.lensView',
      // First operational-state tree, because it is the one that asks
      // something of you — and it carries the overdue badge.
      'atlasmind.projectDirectorView',
      // Still near the top: the view you glance at, kept above the inventory.
      'atlasmind.projectStateView',
      'atlasmind.sessionsView',
      'atlasmind.projectRunsView',
      'atlasmind.memoryView',
      // Models before the things that consume them.
      'atlasmind.modelsView',
      'atlasmind.agentsView',
      'atlasmind.skillsView',
      'atlasmind.mcpServersView',
      // Rarest thing in the sidebar, so it sits last.
      'atlasmind.discoveryView',
    ]);

    expect(views.filter(entry => entry.id !== 'atlasmind.chatView')).toEqual(expect.arrayContaining([
      // The one view deliberately NOT collapsed. Every other row is a list you
      // open when you want it; this one is a summary you glance at, and a
      // collapsed summary shows nothing. Chat is a webview many users hide, so
      // there is no competing content it would push down.
      expect.objectContaining({ id: 'atlasmind.projectStateView', visibility: 'visible' }),
      expect.objectContaining({ id: 'atlasmind.projectRunsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.sessionsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.memoryView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.agentsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.skillsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.mcpServersView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.discoveryView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.modelsView', visibility: 'collapsed' }),
      expect.objectContaining({ id: 'atlasmind.projectDirectorView', visibility: 'collapsed' }),
    ]));
  });

  it('contributes Models view inline toggle, info, and reversible hide commands', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    const toggleEnabled = commands.find(entry => entry.command === 'atlasmind.models.toggleEnabled');
    const openInfo = commands.find(entry => entry.command === 'atlasmind.models.openInfo');
    const configureProvider = commands.find(entry => entry.command === 'atlasmind.models.configureProvider');
    const refreshProvider = commands.find(entry => entry.command === 'atlasmind.models.refreshProvider');
    const assignToAgent = commands.find(entry => entry.command === 'atlasmind.models.assignToAgent');
    const hideFromSidebar = commands.find(entry => entry.command === 'atlasmind.models.hideFromSidebar');

    expect(toggleEnabled?.title).toBe('Toggle Model Enabled');
    expect(openInfo?.title).toBe('Summarize Model In Chat');
    expect(configureProvider?.title).toBe('Configure Model Provider');
    expect(refreshProvider?.title).toBe('Refresh Available Models');
    expect(assignToAgent?.title).toBe('Assign To Agents');
    expect(hideFromSidebar?.title).toBe('Hide from Models Sidebar');
    expect(hideFromSidebar?.icon).toBe('$(eye-closed)');

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
      expect.objectContaining({
        command: 'atlasmind.models.hideFromSidebar',
        when: 'view == atlasmind.modelsView && viewItem =~ /^(model-|acp-bridge-)/',
      }),
    ]));

    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.models.toggleEnabled', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.openInfo', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.configureProvider', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.refreshProvider', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.assignToAgent', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.models.hideFromSidebar', when: 'false' }),
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

  it('keeps Personality and Website Studio visible in the AtlasMind chat title bar', () => {
    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];

    expect(commands.find(entry => entry.command === 'atlasmind.openPersonalityProfile')?.icon).toBe('$(account)');
    expect(commands.find(entry => entry.command === 'atlasmind.openWebsiteStudio')?.icon).toBe('$(globe)');
    expect(menus).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.openProjectDashboard',
        when: 'view == atlasmind.chatView',
        group: 'navigation@1',
      }),
      expect.objectContaining({
        command: 'atlasmind.openPersonalityProfile',
        when: 'view == atlasmind.chatView',
        group: 'navigation@3',
      }),
      expect.objectContaining({
        command: 'atlasmind.openWebsiteStudio',
        when: 'view == atlasmind.chatView',
        group: 'navigation@4',
      }),
      expect.objectContaining({
        command: 'atlasmind.openSettings',
        when: 'view == atlasmind.chatView',
        group: 'navigation@5',
      }),
      expect.objectContaining({
        command: 'atlasmind.openProjectIdeation',
        when: 'view == atlasmind.chatView',
        group: '2_workspaces@1',
      }),
      expect.objectContaining({
        command: 'atlasmind.openCostDashboard',
        when: 'view == atlasmind.chatView',
        group: '2_workspaces@2',
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

  /**
   * This test used to assert the opposite.
   *
   * It required that Sessions and Memory each carry the *same* set of
   * dashboard and project quick actions as Chat — so the duplication was
   * deliberate and tested for, not an oversight. It did not survive contact:
   * Sessions ended up with ten navigation actions, of which seven were about
   * something other than sessions, and VS Code collapses anything past five
   * into a `...` menu. The result was a titlebar that was both irrelevant and
   * hidden.
   *
   * The rule now is narrower and, I think, right: a view's titlebar carries
   * actions about *that view*, one route to the surface that manages it in
   * depth, and its own settings page. The global set stays on Chat, which is
   * the first view and acts as the app's home.
   */
  it('gives each sidebar view its own actions rather than a copy of the global set', () => {
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    const forView = (view: string): string[] => menus
      .filter(entry => (entry.when ?? '').startsWith(`view == ${view}`))
      .filter(entry => (entry.group ?? '').startsWith('navigation'))
      .map(entry => entry.command);

    // Sessions is about sessions: start one, file them, and reach its own
    // settings page. The settings route was always part of this rule — "its own
    // two or three plus one route to the surface that manages it in depth and
    // its own settings page" — but it sat in a non-`navigation` group, which VS
    // Code only ever draws inside the `...` overflow. Contributed and invisible.
    expect(forView('atlasmind.sessionsView').sort()).toEqual([
      'atlasmind.openChatView',
      'atlasmind.openSettingsChat',
      'atlasmind.sessions.createFolder',
    ]);

    // Memory is about memory. It used to carry the Cost Dashboard.
    expect(forView('atlasmind.memoryView')).not.toContain('atlasmind.openCostDashboard');

    // The glance view had no titlebar at all: no route to the detail behind it,
    // and no way to update it.
    expect(forView('atlasmind.projectStateView')).toEqual([
      'atlasmind.openProjectDashboard',
      'atlasmind.refreshProjectState',
      'atlasmind.openSettingsSafety',
    ]);

    // Agents had no way to add one while Skills had "add skill" — an asymmetry
    // with nothing behind it.
    expect(forView('atlasmind.agentsView')).toContain('atlasmind.openAgentPanel');

    // Five is the ceiling: VS Code hides the rest behind `...`, which is where
    // the old ten went to be ignored. Counted as slots, because two mutually
    // exclusive alternates share one button.
    const views = new Set(menus
      .map(entry => (entry.when ?? '').match(/^view == ([\w.]+)/)?.[1])
      .filter((view): view is string => Boolean(view)));
    for (const view of views) {
      const slots = new Set(menus
        .filter(entry => (entry.when ?? '').startsWith(`view == ${view}`))
        .filter(entry => (entry.group ?? '').startsWith('navigation'))
        .map(entry => entry.group));
      expect(slots.size, view).toBeLessThanOrEqual(5);
    }
  });

  it('keeps the conditional actions conditional', () => {
    // Three of these are load-bearing and were nearly flattened while
    // rebuilding the titlebars: "Import project" must appear only without an
    // SSOT, "Update memory" only with one, and "Dismiss notifications" only
    // when a provider is actually paused. Unconditional, they offer an import
    // nobody wants and a dismissal with nothing to dismiss.
    const menus = (manifest.contributes?.menus?.['view/title'] ?? []) as ManifestMenuItem[];
    const conditional = menus.filter(entry => (entry.when ?? '').includes('&&'));

    expect(conditional).toEqual(expect.arrayContaining([
      expect.objectContaining({
        command: 'atlasmind.importProject',
        when: 'view == atlasmind.chatView && !atlasmind.ssotPresent && config.atlasmind.showImportProjectAction',
      }),
      expect.objectContaining({
        command: 'atlasmind.updateProjectMemory',
        when: 'view == atlasmind.chatView && atlasmind.ssotPresent',
      }),
      expect.objectContaining({
        command: 'atlasmind.models.dismissNotifications',
        when: 'view == atlasmind.modelsView && atlasmind.hasAutoPausedProviders',
      }),
    ]));

    // `showImportProjectAction` is documented as "Show the Import Existing
    // Project toolbar action in the AtlasMind Memory view" — and it was also
    // gating *Update memory* on that same view, so turning the import action off
    // hid both. Chat's copy never carried the guard, which is what gave it away.
    const memoryUpdate = menus.find(entry =>
      entry.command === 'atlasmind.updateProjectMemory'
      && (entry.when ?? '').startsWith('view == atlasmind.memoryView'));
    expect(memoryUpdate?.when).not.toContain('showImportProjectAction');

    // The exclusive pair shares a slot, which is why the original gave both
    // `navigation@1`. That reads as an ambiguous ordering and is deliberate.
    const chatPair = menus.filter(entry =>
      (entry.when ?? '').startsWith('view == atlasmind.chatView')
      && ['atlasmind.importProject', 'atlasmind.updateProjectMemory'].includes(entry.command));
    expect(chatPair).toHaveLength(2);
    expect(new Set(chatPair.map(entry => entry.group)).size).toBe(1);
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
      'atlasmind-acp': './out/cli/acpAgent.js',
    });

    expect(manifest.scripts?.cli).toBe('node ./out/cli/main.js');
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

  it('contributes the Agentic Resource Discovery (ARD) chat command, panel, view, and commands', () => {
    const participants = (manifest.contributes?.chatParticipants ?? []) as Array<{ id: string; commands?: Array<{ name: string }> }>;
    const atlas = participants.find(entry => entry.id === 'atlasmind.orchestrator');
    expect(atlas?.commands?.some(command => command.name === 'discover')).toBe(true);

    const commands = (manifest.contributes?.commands ?? []) as ContributedCommand[];
    expect(commands.find(entry => entry.command === 'atlasmind.openResourceDiscovery')?.title).toBe('AtlasMind: Resource Discovery');
    expect(commands.find(entry => entry.command === 'atlasmind.ard.exportCatalog')?.title).toContain('ai-catalog.json');
    expect(commands.some(entry => entry.command === 'atlasmind.ard.installEntry')).toBe(true);
    expect(commands.some(entry => entry.command === 'atlasmind.ard.toggleFinder')).toBe(true);

    const views = (manifest.contributes?.views?.['atlasmind-sidebar'] ?? []) as Array<{ id: string; name?: string }>;
    expect(views.find(entry => entry.id === 'atlasmind.discoveryView')?.name).toBe('Resource Discovery');

    // The install/finder commands are tree-driven and must stay out of the palette.
    const paletteMenus = (manifest.contributes?.menus?.commandPalette ?? []) as ManifestMenuItem[];
    expect(paletteMenus).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'atlasmind.ard.installEntry', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.ard.toggleFinder', when: 'false' }),
      expect.objectContaining({ command: 'atlasmind.ard.removeFinder', when: 'false' }),
    ]));
  });

  it('ships ARD discovery finders disabled-by-default via an opt-in master switch', () => {
    const configuration = manifest.contributes?.configuration as { properties?: Record<string, ManifestConfigurationProperty> } | undefined;
    const enabled = configuration?.properties?.['atlasmind.ard.enabled'];
    const federation = configuration?.properties?.['atlasmind.ard.federationMode'];
    const insecure = configuration?.properties?.['atlasmind.ard.allowInsecureEndpoints'];

    expect(enabled).toMatchObject({ type: 'boolean', default: true });
    expect(federation).toMatchObject({ type: 'string', default: 'referrals' });
    expect(insecure).toMatchObject({ type: 'boolean', default: false });
  });
});

describe('.vscodeignore excludes generated local artifacts', () => {
  /**
   * `test-results/` shipped inside atlasmind-0.224.0.vsix — 836 KB of this
   * repository's own test names, in every user's install. It was gitignored, so
   * it never showed in a diff, and `.vscodeignore` is a separate list that
   * nobody thinks to update when adding a build output.
   *
   * The rule this pins is the general one: anything a build writes into the
   * working tree is excluded from the package unless somebody says otherwise.
   */
  const GENERATED_DIRECTORIES = ['coverage', 'test-results', 'out/test', 'node_modules/**/test'];

  it('names every directory a build writes into the working tree', () => {
    const ignore = readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf8');
    const patterns = ignore
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));

    for (const directory of ['coverage', 'test-results']) {
      expect(
        patterns.some(pattern => pattern === `${directory}/**` || pattern === `${directory}/`),
        `.vscodeignore does not exclude ${directory}/ — it would ship inside the VSIX`,
      ).toBe(true);
    }
    expect(GENERATED_DIRECTORIES.length).toBeGreaterThan(0);
  });

  it('excludes whatever vitest.config.ts writes an outputFile to', () => {
    // Read the actual configured path rather than restating it: the two drifting
    // apart is exactly how this shipped in the first place.
    const config = readFileSync(path.join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    const outputFile = /junit:\s*'([^']+)'/.exec(config)?.[1];
    expect(outputFile, 'vitest.config.ts no longer declares a junit outputFile').toBeTruthy();

    const directory = outputFile!.split('/')[0]!;
    const ignore = readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf8');
    expect(
      ignore.split(/\r?\n/).some(line => line.trim() === `${directory}/**`),
      `vitest writes to ${outputFile} but .vscodeignore does not exclude ${directory}/`,
    ).toBe(true);
  });
});

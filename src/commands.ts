import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from './extension.js';
import type { AgentDefinition, ProviderId, SkillDefinition, SkillScanResult } from './types.js';
import type { SettingsPageId, SettingsPanelTarget } from './views/settingsPanel.js';
import { TaskProfiler } from './core/taskProfiler.js';
import { buildSkillDraftPrompt, extractGeneratedSkillCode, toSuggestedSkillId } from './core/skillDrafting.js';
import { pickWorkspaceFolder } from './utils/workspacePicker.js';
import { postSidebarSummaryToChat } from './views/treeViews.js';
import type { ChatSessionTreeItem, McpServerTreeItem, ModelProviderTreeItem, ModelTreeItem, SkillFolderTreeItem, SkillTreeItem } from './views/treeViews.js';

const SKILL_LEARNING_WARNING =
  'Experimental skill learning uses model tokens and may generate incorrect or unsafe code. ' +
  'Atlas will security-scan generated drafts and any imported draft stays disabled until you review it.';

const FALLBACK_EXTENSION_ID = 'JoelBondoux.atlasmind';
const GETTING_STARTED_WALKTHROUGH_ID = 'atlasmind.getStarted';
const MEMORY_NEEDS_UPDATE_CONTEXT_KEY = 'atlasmind.memoryNeedsUpdate';
const SSOT_PRESENT_CONTEXT_KEY = 'atlasmind.ssotPresent';
const DISABLED_SKILL_IDS_STORAGE_KEY = 'atlasmind.disabledSkillIds';
const CUSTOM_SKILLS_STORAGE_KEY = 'atlasmind.customSkills';
const CUSTOM_SKILL_FOLDERS_STORAGE_KEY = 'atlasmind.customSkillFolders';

type SessionFolderQuickPickItem = vscode.QuickPickItem & {
  folderId?: string;
  createNew?: boolean;
  clearFolder?: boolean;
};

export function getGettingStartedWalkthroughTarget(context: vscode.ExtensionContext): string {
  const extensionPackage = context.extension.packageJSON as { publisher?: unknown; name?: unknown };
  const publisher = typeof extensionPackage.publisher === 'string'
    ? extensionPackage.publisher
    : 'JoelBondoux';
  const name = typeof extensionPackage.name === 'string'
    ? extensionPackage.name
    : 'atlasmind';
  const extensionId = publisher && name ? `${publisher}.${name}` : FALLBACK_EXTENSION_ID;
  return `${extensionId}#${GETTING_STARTED_WALKTHROUGH_ID}`;
}

/**
 * Registers all AtlasMind commands declared in package.json.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  getAtlas: () => AtlasMindContext | undefined,
  getStartupStatusMessage: () => string = () => 'AtlasMind is still activating. Try again in a moment.',
): void {
  const requireAtlas = (): AtlasMindContext | undefined => {
    const atlas = getAtlas();
    if (!atlas) {
      void vscode.window.showInformationMessage(getStartupStatusMessage());
      return undefined;
    }
    return atlas;
  };

  const syncProjectMemoryFreshnessContext = async (
    workspaceFolder: vscode.WorkspaceFolder | undefined,
  ): Promise<{ hasImportedEntries: boolean; isStale: boolean; staleEntryCount: number }> => {
    if (!workspaceFolder) {
      await vscode.commands.executeCommand('setContext', SSOT_PRESENT_CONTEXT_KEY, false);
      await vscode.commands.executeCommand('setContext', MEMORY_NEEDS_UPDATE_CONTEXT_KEY, false);
      return { hasImportedEntries: false, isStale: false, staleEntryCount: 0 };
    }

    const { getProjectMemoryFreshness } = await import('./bootstrap/bootstrapper.js');
    const status = await getProjectMemoryFreshness(workspaceFolder.uri);
    await vscode.commands.executeCommand('setContext', SSOT_PRESENT_CONTEXT_KEY, true);
    await vscode.commands.executeCommand('setContext', MEMORY_NEEDS_UPDATE_CONTEXT_KEY, status.isStale);
    return {
      hasImportedEntries: status.hasImportedEntries,
      isStale: status.isStale,
      staleEntryCount: status.staleEntryCount,
    };
  };

  const runProjectMemoryImport = async (
    workspaceFolder: vscode.WorkspaceFolder,
    successPrefix: string,
  ): Promise<void> => {
    const atlas = requireAtlas();
    if (!atlas) {
      return;
    }

    const { importProject } = await import('./bootstrap/bootstrapper.js');
    const result = await importProject(workspaceFolder.uri, atlas);
    const freshness = await syncProjectMemoryFreshnessContext(workspaceFolder);
    const typeNote = result.projectType ? ` Detected type: ${result.projectType}.` : '';
    const freshnessNote = freshness.isStale
      ? ` ${freshness.staleEntryCount} imported memory entr${freshness.staleEntryCount === 1 ? 'y is' : 'ies are'} still out of date and may need manual review.`
      : '';
    vscode.window.showInformationMessage(
      `${successPrefix}: ${result.entriesCreated} memory entries created, ${result.entriesSkipped} skipped.${typeNote}${freshnessNote}`,
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.openGettingStarted', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        getGettingStartedWalkthroughTarget(context),
        false,
      );
    }),

    vscode.commands.registerCommand('atlasmind.openSettings', async (target?: SettingsPageId | SettingsPanelTarget) => {
      const { SettingsPanel } = await import('./views/settingsPanel.js');
      SettingsPanel.createOrShow(context, target);
    }),

    vscode.commands.registerCommand('atlasmind.openSettingsChat', async () => {
      const { SettingsPanel } = await import('./views/settingsPanel.js');
      SettingsPanel.createOrShow(context, 'chat');
    }),

    vscode.commands.registerCommand('atlasmind.openSettingsModels', async () => {
      const { SettingsPanel } = await import('./views/settingsPanel.js');
      SettingsPanel.createOrShow(context, 'models');
    }),

    vscode.commands.registerCommand('atlasmind.openSettingsSafety', async () => {
      const { SettingsPanel } = await import('./views/settingsPanel.js');
      SettingsPanel.createOrShow(context, 'safety');
    }),

    vscode.commands.registerCommand('atlasmind.openSettingsProject', async () => {
      const { SettingsPanel } = await import('./views/settingsPanel.js');
      SettingsPanel.createOrShow(context, 'project');
    }),

    vscode.commands.registerCommand('atlasmind.openChatPanel', async (target?: string | import('./views/chatPanel.js').ChatPanelTarget) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ChatPanel } = await import('./views/chatPanel.js');
      ChatPanel.createOrShow(context, atlas, target);
    }),

    vscode.commands.registerCommand('atlasmind.openChatView', async (target?: string | import('./views/chatPanel.js').ChatPanelTarget) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ChatViewProvider } = await import('./views/chatPanel.js');
      await ChatViewProvider.open(target);
    }),

    vscode.commands.registerCommand('atlasmind.sessions.rename', async (item?: ChatSessionTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.session?.id) {
        return;
      }

      const nextTitle = await vscode.window.showInputBox({
        prompt: 'Rename session',
        value: item.session.title,
        valueSelection: [0, item.session.title.length],
        validateInput: value => value.trim().length > 0 ? undefined : 'Session name is required.',
      });
      if (typeof nextTitle !== 'string') {
        return;
      }

      atlas.sessionConversation.renameSession(item.session.id, nextTitle);
    }),

    vscode.commands.registerCommand('atlasmind.sessions.createFolder', async () => {
      const atlas = requireAtlas();
      if (!atlas) {
        return;
      }

      const folderName = await vscode.window.showInputBox({
        prompt: 'Create a session folder',
        placeHolder: 'Release planning',
        validateInput: value => value.trim().length > 0 ? undefined : 'Folder name is required.',
      });
      if (typeof folderName !== 'string') {
        return;
      }

      atlas.sessionConversation.createFolder(folderName);
    }),

    vscode.commands.registerCommand('atlasmind.sessions.moveToFolder', async (item?: ChatSessionTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.session?.id) {
        return;
      }

      const folderItems: SessionFolderQuickPickItem[] = atlas.sessionConversation.listFolders().map(folder => ({
        label: folder.name,
        description: `${folder.sessionCount} session${folder.sessionCount === 1 ? '' : 's'}`,
        folderId: folder.id,
      }));
      const selection = await vscode.window.showQuickPick<SessionFolderQuickPickItem>([
        { label: '$(new-folder) New Folder', description: 'Create a new session folder', createNew: true },
        { label: '$(close) No Folder', description: 'Keep this session at the top level', clearFolder: true },
        ...folderItems,
      ], {
        placeHolder: `File "${item.session.title}" into a session folder`,
      });
      if (!selection) {
        return;
      }

      if (selection.createNew) {
        const folderName = await vscode.window.showInputBox({
          prompt: 'Create a session folder',
          placeHolder: 'Release planning',
          validateInput: value => value.trim().length > 0 ? undefined : 'Folder name is required.',
        });
        if (typeof folderName !== 'string') {
          return;
        }
        const folderId = atlas.sessionConversation.createFolder(folderName);
        if (folderId) {
          atlas.sessionConversation.assignSessionToFolder(item.session.id, folderId);
        }
        return;
      }

      if (selection.clearFolder) {
        atlas.sessionConversation.assignSessionToFolder(item.session.id, undefined);
        return;
      }

      atlas.sessionConversation.assignSessionToFolder(item.session.id, selection.folderId);
    }),

    vscode.commands.registerCommand('atlasmind.sessions.archive', async (item?: ChatSessionTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.session?.id) {
        return;
      }

      atlas.sessionConversation.archiveSession(item.session.id);
    }),

    vscode.commands.registerCommand('atlasmind.sessions.restore', async (item?: ChatSessionTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.session?.id) {
        return;
      }

      if (atlas.sessionConversation.unarchiveSession(item.session.id)) {
        atlas.sessionConversation.assignSessionToFolder(item.session.id, undefined);
      }
    }),

    vscode.commands.registerCommand('atlasmind.openModelProviders', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ModelProviderPanel } = await import('./views/modelProviderPanel.js');
      ModelProviderPanel.createOrShow(context, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openSpecialistIntegrations', async () => {
      const { SpecialistIntegrationsPanel } = await import('./views/specialistIntegrationsPanel.js');
      SpecialistIntegrationsPanel.createOrShow(context);
    }),

    vscode.commands.registerCommand('atlasmind.openToolWebhooks', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ToolWebhookPanel } = await import('./views/toolWebhookPanel.js');
      ToolWebhookPanel.createOrShow(context, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openAgentPanel', async (selectedAgentId?: string) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { AgentManagerPanel } = await import('./views/agentManagerPanel.js');
      AgentManagerPanel.createOrShowWithSelection(context, atlas, typeof selectedAgentId === 'string' ? selectedAgentId : null);
    }),

    vscode.commands.registerCommand('atlasmind.agents.toggleEnabled', async (agent?: AgentDefinition) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      if (!agent?.id) {
        return;
      }

      if (!atlas.agentRegistry.get(agent.id)) {
        return;
      }

      if (atlas.agentRegistry.isEnabled(agent.id)) {
        atlas.agentRegistry.disable(agent.id);
      } else {
        atlas.agentRegistry.enable(agent.id);
      }

      await atlas.extensionContext.globalState.update(
        'atlasmind.disabledAgentIds',
        atlas.agentRegistry.getDisabledIds(),
      );
      atlas.agentsRefresh.fire();
    }),

    vscode.commands.registerCommand('atlasmind.agents.showDetails', async (agent?: AgentDefinition) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      if (!agent?.id) {
        return;
      }

      await postSidebarSummaryToChat(atlas, `Agent Summary: ${agent.name}`, buildAgentSummary(atlas, agent));
    }),

    vscode.commands.registerCommand('atlasmind.bootstrapProject', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const workspaceFolder = await pickWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Open a folder first to bootstrap a project.');
        return;
      }
      const { bootstrapProject } = await import('./bootstrap/bootstrapper.js');
      await bootstrapProject(workspaceFolder.uri, atlas);
      await vscode.commands.executeCommand('setContext', SSOT_PRESENT_CONTEXT_KEY, true);
      await vscode.commands.executeCommand('setContext', MEMORY_NEEDS_UPDATE_CONTEXT_KEY, false);
    }),

    vscode.commands.registerCommand('atlasmind.importProject', async () => {
      const workspaceFolder = await pickWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Open a folder first to import a project.');
        return;
      }
      await runProjectMemoryImport(workspaceFolder, 'Project imported');
    }),

    vscode.commands.registerCommand('atlasmind.updateProjectMemory', async () => {
      const workspaceFolder = await pickWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Open a folder first to update project memory.');
        return;
      }
      await runProjectMemoryImport(workspaceFolder, 'Project memory updated');
    }),

    vscode.commands.registerCommand('atlasmind.purgeProjectMemory', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const workspaceFolder = await pickWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Open a folder first to purge project memory.');
        return;
      }

      const initialConfirmation = await vscode.window.showWarningMessage(
        'Purge AtlasMind project memory for this workspace? This deletes the full project_memory tree and recreates an empty scaffold.',
        { modal: true },
        'Purge Memory',
      );
      if (initialConfirmation !== 'Purge Memory') {
        return;
      }

      const typedConfirmation = await vscode.window.showInputBox({
        title: 'Confirm AtlasMind Memory Purge',
        prompt: 'Type PURGE MEMORY to permanently delete the current SSOT contents for this workspace.',
        placeHolder: 'PURGE MEMORY',
        ignoreFocusOut: true,
      });
      if (typedConfirmation !== 'PURGE MEMORY') {
        vscode.window.showWarningMessage('AtlasMind memory purge canceled. Confirmation phrase did not match.');
        return;
      }

      const { purgeProjectMemory } = await import('./bootstrap/bootstrapper.js');
      const result = await purgeProjectMemory(workspaceFolder.uri, atlas);
      await vscode.commands.executeCommand('setContext', SSOT_PRESENT_CONTEXT_KEY, true);
      await vscode.commands.executeCommand('setContext', MEMORY_NEEDS_UPDATE_CONTEXT_KEY, false);
      vscode.window.showInformationMessage(
        `AtlasMind memory purged at ${result.ssotPath}. Removed ${result.removedFiles} file${result.removedFiles === 1 ? '' : 's'} and recreated the SSOT scaffold.`,
      );
    }),

    vscode.commands.registerCommand('atlasmind.showCostSummary', () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const summary = atlas.costTracker.getSummary();
      vscode.window.showInformationMessage(
        `AtlasMind session cost: $${summary.totalCostUsd.toFixed(4)} across ${summary.totalRequests} requests.`,
      );
    }),

    vscode.commands.registerCommand('atlasmind.toggleAutopilot', () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const enabled = atlas.toolApprovalManager.toggleAutopilot();
      void vscode.window.showInformationMessage(
        enabled
          ? 'AtlasMind Autopilot enabled for this session.'
          : 'AtlasMind Autopilot disabled.',
      );
    }),

    // ── Skill management ────────────────────────────────────────

    vscode.commands.registerCommand('atlasmind.skills.toggleEnabled', async (item: SkillTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const skillId = item?.skillId;
      if (!skillId) { return; }
      const registry = atlas.skillsRegistry;

      if (registry.isEnabled(skillId)) {
        registry.disable(skillId);
      } else {
        const scanResult = registry.getScanResult(skillId);
        if (scanResult?.status === 'failed') {
          vscode.window.showErrorMessage(
            `Cannot enable "${skillId}": security scan failed. ` +
            `Open the skill scan results (shield icon → "Show Results") to see the issues, fix them, and re-scan.`,
          );
          return;
        }
        try {
          registry.enable(skillId);
        } catch (err) {
          vscode.window.showErrorMessage(String(err));
          return;
        }
      }

      await atlas.extensionContext.globalState.update(
        'atlasmind.disabledSkillIds',
        registry.getDisabledIds(),
      );
      atlas.skillsRefresh.fire();
    }),

    vscode.commands.registerCommand('atlasmind.skills.showSummary', async (item?: SkillTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.skillId) { return; }
      const skill = atlas.skillsRegistry.listSkills().find(candidate => candidate.id === item.skillId);
      if (!skill) { return; }

      await postSidebarSummaryToChat(atlas, `Skill Summary: ${skill.name}`, buildSkillSummary(atlas, skill));
    }),

    vscode.commands.registerCommand('atlasmind.skills.scan', async (item: SkillTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const skillId = item?.skillId;
      if (!skillId) { return; }
      const skill = atlas.skillsRegistry.listSkills().find(s => s.id === skillId);
      if (!skill) { return; }

      if (skill.builtIn) {
        atlas.skillsRegistry.setScanResult({
          skillId,
          status: 'passed',
          scannedAt: new Date().toISOString(),
          issues: [],
        });
        atlas.skillsRefresh.fire();
        vscode.window.showInformationMessage(`"${skill.name}" is a built-in skill — pre-approved.`);
        return;
      }

      if (!skill.source) {
        vscode.window.showWarningMessage(`No source file found for "${skill.name}". Cannot scan.`);
        return;
      }

      const { scanSkillFile } = await import('./core/skillScanner.js');
      const config = atlas.scannerRulesManager.getConfig();
      try {
        const result = await scanSkillFile(skillId, skill.source, config);
        atlas.skillsRegistry.setScanResult(result);
        atlas.skillsRefresh.fire();
        if (result.status === 'failed') {
          const errCount = result.issues.filter(i => i.severity === 'error').length;
          vscode.window.showErrorMessage(
            `Scan failed for "${skill.name}": ${errCount} error(s). Hover the skill for details.`,
          );
        } else {
          const warnCount = result.issues.length;
          vscode.window.showInformationMessage(
            `Scan passed for "${skill.name}"` + (warnCount > 0 ? ` — ${warnCount} warning(s)` : ''),
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Scan error for "${skill.name}": ${String(err)}`);
      }
    }),

    vscode.commands.registerCommand('atlasmind.skills.showScanResults', (item: SkillTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const skillId = item?.skillId;
      if (!skillId) { return; }
      const skill = atlas.skillsRegistry.listSkills().find(s => s.id === skillId);
      const result = atlas.skillsRegistry.getScanResult(skillId);

      if (!result) {
        vscode.window.showInformationMessage(
          `No scan results for "${skillId}". Use the shield icon to run a scan first.`,
        );
        return;
      }

      const channel = vscode.window.createOutputChannel(
        `AtlasMind Scan — ${skill?.name ?? skillId}`,
      );
      channel.appendLine(`Skill:    ${skill?.name ?? skillId} (${skillId})`);
      channel.appendLine(`Scanned:  ${result.scannedAt}`);
      channel.appendLine(`Status:   ${result.status.toUpperCase()}`);

      if (result.issues.length === 0) {
        channel.appendLine('\nNo issues found.');
      } else {
        for (const issue of result.issues) {
          channel.appendLine(`\n[${issue.severity.toUpperCase()}] ${issue.rule} — Line ${issue.line}`);
          channel.appendLine(`  ${issue.message}`);
          channel.appendLine(`  > ${issue.snippet}`);
        }
      }
      channel.show(true);
    }),

    vscode.commands.registerCommand('atlasmind.skills.addSkill', async (item?: SkillFolderTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(file-add)  Create template file',
            description: 'Scaffold a new skill file in the workspace',
            value: 'template',
          },
          {
            label: '$(folder-opened)  Import existing .js skill',
            description: 'Load a compiled CommonJS skill module from disk',
            value: 'import',
          },
          ...(vscode.workspace.getConfiguration('atlasmind').get<boolean>('experimentalSkillLearningEnabled', false)
            ? [{
              label: '$(sparkle)  Let Atlas draft a skill',
              description: 'Generate a draft skill with an LLM, scan it, and optionally import it disabled',
              value: 'draft',
            }]
            : []),
        ],
        { placeHolder: 'How would you like to add a skill?' },
      ) as ({ label: string; description: string; value: string } | undefined);

      if (!choice) { return; }

      if (choice.value === 'template') {
        await createSkillTemplate(atlas, item?.folderPath);
      } else if (choice.value === 'draft') {
        await draftSkillWithAtlas(atlas, item?.folderPath);
      } else {
        await importSkillFile(atlas, item?.folderPath);
      }
    }),

    vscode.commands.registerCommand('atlasmind.skills.createFolder', async (item?: SkillFolderTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const workspaceFolder = await pickWorkspaceFolder();
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Open a folder first to create a custom skill folder.');
        return;
      }

      const folderPath = await promptForSkillFolderPath(item?.folderPath);
      if (folderPath === null) {
        return;
      }

      const dir = vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills', ...splitSkillFolderPath(folderPath));
      await vscode.workspace.fs.createDirectory(dir);
      atlas.skillsRegistry.registerCustomFolder(folderPath);
      await persistCustomSkillState(atlas);
      atlas.skillsRefresh.fire();
      vscode.window.showInformationMessage(`Custom skill folder created: ${folderPath}`);
    }),

    vscode.commands.registerCommand('atlasmind.openScannerRules', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { SkillScannerPanel } = await import('./views/skillScannerPanel.js');
      SkillScannerPanel.createOrShow(
        atlas.extensionContext,
        atlas.scannerRulesManager,
        () => atlas.skillsRefresh.fire(),
      );
    }),

    vscode.commands.registerCommand('atlasmind.openMcpServers', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { McpPanel } = await import('./views/mcpPanel.js');
      McpPanel.createOrShow(
        atlas.extensionContext,
        atlas.mcpServerRegistry,
        () => atlas.skillsRefresh.fire(),
      );
    }),

    vscode.commands.registerCommand('atlasmind.mcpServers.showSummary', async (item?: McpServerTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item?.state) { return; }
      await postSidebarSummaryToChat(
        atlas,
        `MCP Server Summary: ${item.state.config.name}`,
        buildMcpServerSummary(item),
      );
    }),

    vscode.commands.registerCommand('atlasmind.models.toggleEnabled', async (item?: ModelProviderTreeItem | ModelTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item) { return; }

      if (isModelTreeItem(item)) {
        await atlas.setModelEnabled(item.providerId as ProviderId, item.modelId, !item.enabled);
        return;
      }

      if (isModelProviderTreeItem(item)) {
        await atlas.setProviderEnabled(item.providerId as ProviderId, !item.enabled);
      }
    }),

    vscode.commands.registerCommand('atlasmind.models.openInfo', async (item?: ModelProviderTreeItem | ModelTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item) { return; }

      const heading = isModelTreeItem(item)
        ? `Model Summary: ${item.modelId}`
        : `Provider Summary: ${item.providerId}`;
      await postSidebarSummaryToChat(atlas, heading, buildModelSummary(atlas, item));
    }),

    vscode.commands.registerCommand('atlasmind.models.configureProvider', async (item?: ModelProviderTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !isModelProviderTreeItem(item)) { return; }

      const { configureProvider } = await import('./views/modelProviderPanel.js');
      await configureProvider(context, atlas, item.providerId as ProviderId);
    }),

    vscode.commands.registerCommand('atlasmind.models.refreshProvider', async (item?: ModelProviderTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }

      const summary = await atlas.refreshProviderModels(true);
      const targetLabel = isModelProviderTreeItem(item) ? item.label : 'providers';
      void vscode.window.showInformationMessage(
        `Refreshed model metadata for ${targetLabel}: ${summary.providersUpdated} provider(s), ${summary.modelsAvailable} model(s) available.`,
      );
    }),

    vscode.commands.registerCommand('atlasmind.models.assignToAgent', async (item?: ModelProviderTreeItem | ModelTreeItem) => {
      const atlas = requireAtlas();
      if (!atlas || !item) { return; }

      if (isModelTreeItem(item)) {
        await assignModelToAgents(atlas, item.modelId);
        return;
      }

      if (isModelProviderTreeItem(item)) {
        await assignProviderToAgents(atlas, item.providerId as ProviderId);
      }
    }),

    vscode.commands.registerCommand('atlasmind.openVoicePanel', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { VoicePanel } = await import('./views/voicePanel.js');
      VoicePanel.createOrShow(atlas.extensionContext, atlas.voiceManager);
    }),

    vscode.commands.registerCommand('atlasmind.openVisionPanel', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { VisionPanel } = await import('./views/visionPanel.js');
      VisionPanel.createOrShow(atlas.extensionContext, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openProjectRunCenter', async (runId?: string) => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ProjectRunCenterPanel } = await import('./views/projectRunCenterPanel.js');
      ProjectRunCenterPanel.createOrShow(atlas.extensionContext, atlas, typeof runId === 'string' ? runId : undefined);
    }),

    vscode.commands.registerCommand('atlasmind.openCostDashboard', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { CostDashboardPanel } = await import('./views/costDashboardPanel.js');
      CostDashboardPanel.createOrShow(
        atlas.extensionContext,
        atlas.costTracker as import('./core/costTracker.js').CostTracker,
        atlas.sessionConversation,
      );
    }),

    vscode.commands.registerCommand('atlasmind.openProjectDashboard', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ProjectDashboardPanel } = await import('./views/projectDashboardPanel.js');
      ProjectDashboardPanel.createOrShow(atlas.extensionContext, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openProjectIdeation', async () => {
      const atlas = requireAtlas();
      if (!atlas) { return; }
      const { ProjectDashboardPanel } = await import('./views/projectDashboardPanel.js');
      ProjectDashboardPanel.createOrShow(atlas.extensionContext, atlas, 'ideation');
    }),
  );
}

function isModelProviderTreeItem(item: unknown): item is ModelProviderTreeItem {
  return typeof item === 'object' && item !== null && 'providerId' in item && !('modelId' in item);
}

function isModelTreeItem(item: unknown): item is ModelTreeItem {
  return typeof item === 'object' && item !== null && 'providerId' in item && 'modelId' in item;
}

function buildAgentSummary(atlas: AtlasMindContext, agent: AgentDefinition): string {
  const enabled = atlas.agentRegistry.isEnabled(agent.id);
  const performance = atlas.agentRegistry.getPerformance(agent.id);
  const skillNames = agent.skills
    .map(skillId => atlas.skillsRegistry.listSkills().find(skill => skill.id === skillId)?.name ?? skillId)
    .slice(0, 8);
  const successRate = performance && performance.totalTasks > 0
    ? `${Math.round((performance.successes / performance.totalTasks) * 100)}% success across ${performance.totalTasks} run${performance.totalTasks === 1 ? '' : 's'}`
    : 'No execution history recorded yet';
  const allowedModels = agent.allowedModels && agent.allowedModels.length > 0
    ? agent.allowedModels.join(', ')
    : 'Any routed model that matches the task';

  return [
    agent.description,
    '',
    `**Role:** ${agent.role}`,
    `**Status:** ${enabled ? 'Enabled' : 'Disabled'}`,
    `**Type:** ${agent.builtIn ? 'Built-in' : 'Custom'}`,
    `**Allowed models:** ${allowedModels}`,
    `**Skills:** ${skillNames.length > 0 ? skillNames.join(', ') : 'No explicit skills assigned'}`,
    `**Performance:** ${successRate}`,
  ].join('\n');
}

function buildSkillSummary(atlas: AtlasMindContext, skill: SkillDefinition): string {
  const enabled = atlas.skillsRegistry.isEnabled(skill.id);
  const scanResult = atlas.skillsRegistry.getScanResult(skill.id);
  const properties = skill.parameters?.properties;
  const parameterNames = properties && typeof properties === 'object'
    ? Object.keys(properties)
    : [];
  const source = skill.builtIn
    ? 'Built-in skill'
    : skill.source ?? 'No source path recorded';
  const kind = skill.builtIn ? 'Built-in' : isMcpSkill(skill) ? 'MCP-backed' : 'Custom';
  const folder = Array.isArray(skill.panelPath) && skill.panelPath.length > 0
    ? skill.panelPath.join(' / ')
    : 'Top level';
  const scanLabel = !scanResult
    ? 'Not scanned yet'
    : scanResult.status === 'passed'
      ? `Passed${scanResult.issues.length > 0 ? ` with ${scanResult.issues.length} warning(s)` : ''}`
      : scanResult.status === 'failed'
        ? `Failed with ${scanResult.issues.filter(issue => issue.severity === 'error').length} error(s)`
        : 'Not scanned yet';

  return [
    skill.description,
    '',
    `**Status:** ${enabled ? 'Enabled' : 'Disabled'}`,
    `**Type:** ${kind}`,
    `**Folder:** ${folder}`,
    `**Security scan:** ${scanLabel}`,
    `**Parameters:** ${parameterNames.length > 0 ? parameterNames.join(', ') : 'No declared parameters'}`,
    `**Source:** ${source}`,
  ].join('\n');
}

function buildModelSummary(
  atlas: AtlasMindContext,
  item: ModelProviderTreeItem | ModelTreeItem,
): string {
  const provider = atlas.modelRouter.listProviders().find(candidate => candidate.id === item.providerId);
  if (!provider) {
    return 'AtlasMind could not find provider metadata for this item.';
  }

  if (isModelTreeItem(item)) {
    const model = provider.models.find(candidate => candidate.id === item.modelId);
    if (!model) {
      return `AtlasMind could not find the model metadata for \`${item.modelId}\`.`;
    }

    const docsUrl = atlas.getModelInfoUrl(item.providerId as ProviderId, item.modelId);
    return [
      `**Provider:** ${provider.displayName}`,
      `**Status:** ${model.enabled ? 'Enabled' : 'Disabled'}`,
      `**Context window:** ${model.contextWindow.toLocaleString()} tokens`,
      `**Capabilities:** ${model.capabilities.join(', ')}`,
      `**Input price:** ${formatUsd(model.inputPricePer1k)}/1K tokens`,
      `**Output price:** ${formatUsd(model.outputPricePer1k)}/1K tokens`,
      ...(typeof model.premiumRequestMultiplier === 'number' ? [`**Premium request multiplier:** ${model.premiumRequestMultiplier}x`] : []),
      ...(docsUrl ? [`[Provider documentation](${docsUrl})`] : []),
    ].join('\n');
  }

  const configured = item.configured;
  const enabledModels = provider.models.filter(model => model.enabled).length;
  const docsUrl = atlas.getModelInfoUrl(item.providerId as ProviderId);
  return [
    `**Provider:** ${provider.displayName}`,
    `**Status:** ${item.enabled ? 'Enabled' : 'Disabled'}`,
    `**Configuration:** ${configured ? 'Configured' : 'Not configured'}`,
    `**Pricing model:** ${provider.pricingModel}`,
    `**Models available:** ${provider.models.length}`,
    `**Models enabled:** ${enabledModels}`,
    `**Mixed state:** ${item.partiallyEnabled ? 'Some child models are disabled' : 'No mixed enablement detected'}`,
    ...(docsUrl ? [`[Provider documentation](${docsUrl})`] : []),
  ].join('\n');
}

function buildMcpServerSummary(item: McpServerTreeItem): string {
  const { config, status, error, tools } = item.state;
  const endpoint = config.transport === 'http'
    ? config.url ?? 'No URL configured'
    : `${config.command ?? 'No command configured'}${config.args && config.args.length > 0 ? ` ${config.args.join(' ')}` : ''}`;

  return [
    `**Status:** ${status}`,
    `**Transport:** ${config.transport}`,
    `**Enabled on startup:** ${config.enabled ? 'Yes' : 'No'}`,
    `**Endpoint:** ${endpoint}`,
    `**Tools discovered:** ${tools.length}`,
    ...(tools.length > 0 ? [`**Tool list:** ${tools.map(tool => `\`${tool.name}\``).join(', ')}`] : ['**Tool list:** No tools discovered yet']),
    ...(error ? [`**Last error:** ${error}`] : []),
  ].join('\n');
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

async function assignModelToAgents(atlas: AtlasMindContext, modelId: string): Promise<void> {
  const agents = atlas.agentRegistry.listAgents();
  const currentAssignments = new Set(
    agents
      .filter(agent => agent.allowedModels?.includes(modelId))
      .map(agent => agent.id),
  );

  const selectedAgentIds = await promptForAgentAssignments(
    agents,
    currentAssignments,
    `Assign ${modelId} to agents`,
  );
  if (!selectedAgentIds) {
    return;
  }

  for (const agent of agents) {
    const current = agent.allowedModels ? new Set(agent.allowedModels) : undefined;
    const shouldAssign = selectedAgentIds.has(agent.id);

    if (shouldAssign) {
      const next = current ? new Set(current) : new Set<string>();
      next.add(modelId);
      await atlas.updateAgentAllowedModels(agent.id, [...next]);
      continue;
    }

    if (!current) {
      continue;
    }

    current.delete(modelId);
    await atlas.updateAgentAllowedModels(agent.id, current.size > 0 ? [...current] : undefined);
  }

  void vscode.window.showInformationMessage(`Updated agent assignments for ${modelId}.`);
}

async function assignProviderToAgents(atlas: AtlasMindContext, providerId: ProviderId): Promise<void> {
  const provider = atlas.modelRouter.listProviders().find(candidate => candidate.id === providerId);
  if (!provider) {
    return;
  }

  const providerModelIds = provider.models.map(model => model.id);
  if (providerModelIds.length === 0) {
    void vscode.window.showInformationMessage(`No models are currently available for ${provider.displayName}.`);
    return;
  }

  const agents = atlas.agentRegistry.listAgents();
  const currentAssignments = new Set(
    agents
      .filter(agent => providerModelIds.some(modelId => agent.allowedModels?.includes(modelId)))
      .map(agent => agent.id),
  );

  const selectedAgentIds = await promptForAgentAssignments(
    agents,
    currentAssignments,
    `Assign all ${provider.displayName} models to agents`,
  );
  if (!selectedAgentIds) {
    return;
  }

  for (const agent of agents) {
    const current = agent.allowedModels ? new Set(agent.allowedModels) : undefined;
    const shouldAssign = selectedAgentIds.has(agent.id);

    if (shouldAssign) {
      const next = current ? new Set(current) : new Set<string>();
      for (const modelId of providerModelIds) {
        next.add(modelId);
      }
      await atlas.updateAgentAllowedModels(agent.id, [...next]);
      continue;
    }

    if (!current) {
      continue;
    }

    for (const modelId of providerModelIds) {
      current.delete(modelId);
    }
    await atlas.updateAgentAllowedModels(agent.id, current.size > 0 ? [...current] : undefined);
  }

  void vscode.window.showInformationMessage(`Updated agent assignments for ${provider.displayName}.`);
}

async function promptForAgentAssignments(
  agents: AgentDefinition[],
  currentAssignments: Set<string>,
  title: string,
): Promise<Set<string> | undefined> {
  const picks = agents.map(agent => ({
    label: agent.name,
    description: agent.role,
    detail: agent.allowedModels && agent.allowedModels.length > 0
      ? `${agent.allowedModels.length} explicit model assignment(s)`
      : 'Currently unrestricted',
    picked: currentAssignments.has(agent.id),
    agentId: agent.id,
  }));

  const selected = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    title,
    placeHolder: 'Select agents that should receive this explicit assignment.',
    ignoreFocusOut: true,
  });

  if (!selected) {
    return undefined;
  }

  return new Set(selected.map(item => item.agentId));
}

// ── Skill add helpers ────────────────────────────────────────────

async function createSkillTemplate(atlas: AtlasMindContext, initialFolderPath?: string): Promise<void> {
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder first to create a skill template.');
    return;
  }

  const folderPath = await resolveTargetSkillFolderPath(atlas, workspaceFolder, initialFolderPath);
  if (folderPath === null) {
    return;
  }

  const id = await vscode.window.showInputBox({
    prompt: 'Skill identifier',
    placeHolder: 'my-skill',
    validateInput(v) {
      return /^[a-z][a-z0-9-]*$/.test(v)
        ? null
        : 'Use lowercase letters, numbers, and hyphens only';
    },
  });
  if (!id) { return; }

  const dir = folderPath
    ? vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills', ...splitSkillFolderPath(folderPath))
    : vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills');
  const file = vscode.Uri.joinPath(dir, `${id}.js`);
  await vscode.workspace.fs.createDirectory(dir);
  if (folderPath) {
    atlas.skillsRegistry.registerCustomFolder(folderPath);
    await persistCustomSkillState(atlas);
    atlas.skillsRefresh.fire();
  }
  await vscode.workspace.fs.writeFile(file, Buffer.from(buildSkillTemplate(id), 'utf-8'));
  await vscode.window.showTextDocument(file);
  vscode.window.showInformationMessage(
    `Skill template created. Edit the file, save it, then use "Import .js skill" to register it.`,
  );
}

async function importSkillFile(atlas: AtlasMindContext, initialFolderPath?: string): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Skill modules (CommonJS .js)': ['js'] },
    title: 'Select a compiled skill .js file',
  });
  if (!uris || uris.length === 0) { return; }
  const filePath = uris[0].fsPath;
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder first to import a skill.');
    return;
  }
  const inferredFolderPath = inferSkillFolderPathFromSource(workspaceFolder, filePath);
  const folderPath = await resolveTargetSkillFolderPath(
    atlas,
    workspaceFolder,
    initialFolderPath ?? inferredFolderPath,
  );
  if (folderPath === null) {
    return;
  }

  // 1. Read source text for scanning
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const source = Buffer.from(bytes).toString('utf-8');

  const { scanSkillSource } = await import('./core/skillScanner.js');
  const config = atlas.scannerRulesManager.getConfig();
  const tempId = path.basename(filePath, '.js');
  const scanResult = await scanSkillSource(tempId, source, config);

  if (scanResult.status === 'failed') {
    const errorLines = scanResult.issues
      .filter(i => i.severity === 'error')
      .map(i => `  Line ${i.line}: [${i.rule}] ${i.message}`)
      .join('\n');
    vscode.window.showErrorMessage(
      `Import blocked — security scan failed for "${path.basename(filePath)}":\n${errorLines}`,
      { modal: true },
    );
    return;
  }

  if (scanResult.issues.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `"${path.basename(filePath)}" has ${scanResult.issues.length} warning(s). Proceed with import?`,
      { modal: true },
      'Import anyway',
    );
    if (proceed !== 'Import anyway') { return; }
  }

  const imported = await registerImportedSkill(atlas, filePath, scanResult, folderPath ?? inferredFolderPath);
  if (!imported) {
    return;
  }

  vscode.window.showInformationMessage(
    `Skill imported and is disabled. Enable it from the Skills panel once you have reviewed the source.`,
  );
}

async function draftSkillWithAtlas(atlas: AtlasMindContext, initialFolderPath?: string): Promise<void> {
  const workspaceFolder = await pickWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder first to let Atlas draft a skill.');
    return;
  }

  const folderPath = await resolveTargetSkillFolderPath(atlas, workspaceFolder, initialFolderPath);
  if (folderPath === null) {
    return;
  }

  const enabled = vscode.workspace.getConfiguration('atlasmind').get<boolean>('experimentalSkillLearningEnabled', false);
  if (!enabled) {
    vscode.window.showWarningMessage(
      'Experimental Skill Learning is not enabled. Turn it on in AtlasMind Settings → Experimental → Skill Learning.',
    );
    return;
  }

  const proceed = await vscode.window.showWarningMessage(
    SKILL_LEARNING_WARNING,
    { modal: true },
    'Generate Draft',
  );
  if (proceed !== 'Generate Draft') {
    return;
  }

  const goal = await vscode.window.showInputBox({
    prompt: 'Describe the job this new skill should do',
    placeHolder: 'Example: search the workspace for TODO comments and summarize them',
    validateInput(value) {
      return value.trim().length > 10 ? null : 'Provide a more specific skill goal.';
    },
  });
  if (!goal) {
    return;
  }

  const suggestedId = toSuggestedSkillId(goal);
  const skillId = await vscode.window.showInputBox({
    prompt: 'Skill identifier',
    value: suggestedId,
    validateInput(value) {
      return /^[a-z][a-z0-9-]*$/.test(value)
        ? null
        : 'Use lowercase letters, numbers, and hyphens only';
    },
  });
  if (!skillId) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration('atlasmind');
  const taskProfile = new TaskProfiler().profileTask({
    userMessage: `Draft an AtlasMind skill: ${goal}`,
    phase: 'execution',
    requiresTools: false,
  });
  const model = atlas.modelRouter.selectModel(
    {
      budget: toBudgetMode(configuration.get<string>('budgetMode')),
      speed: toSpeedMode(configuration.get<string>('speedMode')),
      requiredCapabilities: ['code'],
    },
    undefined,
    taskProfile,
  );
  const providerId = resolveProviderIdForModel(model, atlas.modelRouter, 'local');
  const provider = atlas.providerRegistry.get(providerId);

  if (!provider) {
    vscode.window.showErrorMessage(
      `No provider adapter is registered for "${providerId}". Open Model Providers panel to configure it.`,
    );
    return;
  }

  let draftSource: string;
  try {
    const response = await provider.complete({
      model,
      temperature: 0.2,
      maxTokens: 1600,
      messages: [
        {
          role: 'system',
          content: 'You write safe, minimal AtlasMind custom skill modules. Return only JavaScript source code for a CommonJS module.',
        },
        {
          role: 'user',
          content: buildSkillDraftPrompt({ skillId, goal }),
        },
      ],
    });
    draftSource = extractGeneratedSkillCode(response.content);
  } catch (err) {
    vscode.window.showErrorMessage(`Atlas could not generate the skill draft: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!draftSource.includes('exports.skill') && !draftSource.includes('module.exports.skill')) {
    vscode.window.showErrorMessage('Atlas returned a draft, but it does not look like a valid skill module.');
    return;
  }

  const dir = folderPath
    ? vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills', ...splitSkillFolderPath(folderPath))
    : vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills');
  const file = vscode.Uri.joinPath(dir, `${skillId}.js`);
  await vscode.workspace.fs.createDirectory(dir);
  if (folderPath) {
    atlas.skillsRegistry.registerCustomFolder(folderPath);
    await persistCustomSkillState(atlas);
    atlas.skillsRefresh.fire();
  }
  await vscode.workspace.fs.writeFile(file, Buffer.from(draftSource.endsWith('\n') ? draftSource : `${draftSource}\n`, 'utf-8'));

  const { scanSkillSource } = await import('./core/skillScanner.js');
  const scanResult = await scanSkillSource(skillId, draftSource, atlas.scannerRulesManager.getConfig());
  await vscode.window.showTextDocument(file);

  if (scanResult.status === 'failed') {
    const errorCount = scanResult.issues.filter(issue => issue.severity === 'error').length;
    vscode.window.showErrorMessage(
      `Atlas created a draft at ${file.fsPath}, but the security scan found ${errorCount} error(s). Review and fix it before importing.`,
      { modal: true },
    );
    return;
  }

  const importChoice = await vscode.window.showInformationMessage(
    scanResult.issues.length > 0
      ? `Atlas created and scanned the draft with ${scanResult.issues.length} warning(s). Import it now as disabled?`
      : 'Atlas created and scanned the draft successfully. Import it now as disabled?',
    { modal: true },
    'Import Disabled',
  );
  if (importChoice !== 'Import Disabled') {
    return;
  }

  const imported = await registerImportedSkill(atlas, file.fsPath, scanResult, folderPath);
  if (!imported) {
    return;
  }

  vscode.window.showInformationMessage(
    `Atlas drafted and imported "${skillId}" as a disabled skill. Review the source, then enable it from the Skills panel if it looks safe.`,
  );
}

async function registerImportedSkill(
  atlas: AtlasMindContext,
  filePath: string,
  scanResult: SkillScanResult,
  folderPath?: string,
): Promise<boolean> {
  let skillDef: SkillDefinition | undefined;
  try {
    const resolvedPath = require.resolve(filePath);
    delete require.cache[resolvedPath];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as { skill?: unknown; default?: unknown };
    skillDef = (mod.skill ?? mod.default) as SkillDefinition | undefined;
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to load "${path.basename(filePath)}": ${String(err)}`,
    );
    return false;
  }

  if (
    !skillDef ||
    typeof skillDef !== 'object' ||
    typeof skillDef.id !== 'string' ||
    typeof skillDef.execute !== 'function'
  ) {
    vscode.window.showErrorMessage(
      `"${path.basename(filePath)}" does not export a valid SkillDefinition. ` +
      `Ensure module.exports.skill (or module.exports.default) has id, name, description, parameters, and execute.`,
    );
    return false;
  }

  const normalizedFolderPath = normalizeSkillFolderPath(folderPath);
  const registered: SkillDefinition = {
    ...skillDef,
    source: filePath,
    builtIn: false,
    panelPath: normalizedFolderPath ? splitSkillFolderPath(normalizedFolderPath) : undefined,
  };
  atlas.skillsRegistry.register(registered);
  atlas.skillsRegistry.setScanResult({ ...scanResult, skillId: registered.id });
  atlas.skillsRegistry.disable(registered.id);
  if (normalizedFolderPath) {
    atlas.skillsRegistry.registerCustomFolder(normalizedFolderPath);
  }
  await atlas.extensionContext.globalState.update(
    DISABLED_SKILL_IDS_STORAGE_KEY,
    atlas.skillsRegistry.getDisabledIds(),
  );
  await persistCustomSkillState(atlas);
  atlas.skillsRefresh.fire();

  return true;
}

async function persistCustomSkillState(atlas: AtlasMindContext): Promise<void> {
  const customSkills = atlas.skillsRegistry.listSkills()
    .filter(isPersistedCustomSkill)
    .map(skill => ({
      source: skill.source!,
      folderPath: getCustomSkillFolderPath(skill),
      scanResult: atlas.skillsRegistry.getScanResult(skill.id),
    }));

  await atlas.extensionContext.globalState.update(CUSTOM_SKILLS_STORAGE_KEY, customSkills);
  await atlas.extensionContext.globalState.update(
    CUSTOM_SKILL_FOLDERS_STORAGE_KEY,
    atlas.skillsRegistry.listCustomFolders(),
  );
}

function isPersistedCustomSkill(skill: SkillDefinition): boolean {
  return !skill.builtIn && !isMcpSkill(skill) && typeof skill.source === 'string' && skill.source.length > 0;
}

function isMcpSkill(skill: Pick<SkillDefinition, 'id' | 'source'>): boolean {
  return skill.id.startsWith('mcp:') || skill.source?.startsWith('mcp://') === true;
}

function getCustomSkillFolderPath(skill: SkillDefinition): string | undefined {
  return normalizeSkillFolderPath(skill.panelPath);
}

async function resolveTargetSkillFolderPath(
  atlas: AtlasMindContext,
  workspaceFolder: vscode.WorkspaceFolder,
  initialFolderPath?: string,
): Promise<string | undefined | null> {
  if (initialFolderPath !== undefined) {
    return normalizeSkillFolderPath(initialFolderPath);
  }

  const choice = await vscode.window.showQuickPick([
    { label: '$(root-folder) Workspace root', description: '.atlasmind/skills', value: '' },
    ...atlas.skillsRegistry.listCustomFolders().map(folderPath => ({
      label: `$(folder) ${folderPath}`,
      description: 'Custom skill folder',
      value: folderPath,
    })),
    { label: '$(new-folder) Create folder…', description: 'Add a new custom skill folder first', value: '__create__' },
  ], {
    title: 'Choose a Skills panel folder',
    placeHolder: 'Select where this custom skill should appear in the Skills panel.',
    ignoreFocusOut: true,
  });
  if (!choice) {
    return null;
  }
  if (choice.value === '__create__') {
    const createdFolderPath = await promptForSkillFolderPath();
    if (createdFolderPath === null) {
      return null;
    }

    const dir = vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills', ...splitSkillFolderPath(createdFolderPath));
    await vscode.workspace.fs.createDirectory(dir);
    atlas.skillsRegistry.registerCustomFolder(createdFolderPath);
    await persistCustomSkillState(atlas);
    atlas.skillsRefresh.fire();
    return createdFolderPath;
  }

  return normalizeSkillFolderPath(choice.value);
}

async function promptForSkillFolderPath(parentFolderPath?: string): Promise<string | null> {
  const folderPath = await vscode.window.showInputBox({
    title: 'Create Custom Skill Folder',
    prompt: parentFolderPath
      ? `Enter the new folder name under "${parentFolderPath}".`
      : 'Enter a folder name or nested path for custom skills.',
    placeHolder: parentFolderPath ? 'utilities' : 'team/tools',
    ignoreFocusOut: true,
    validateInput(value) {
      const normalized = normalizeSkillFolderPath(value);
      if (!normalized) {
        return 'Enter at least one folder name.';
      }

      const invalidSegment = splitSkillFolderPath(normalized).find(segment =>
        segment === '.' || segment === '..' || /[<>:"|?*]/.test(segment),
      );
      return invalidSegment
        ? 'Folder names cannot contain path traversal segments or Windows-reserved characters.'
        : null;
    },
  });

  if (!folderPath) {
    return null;
  }

  const childPath = normalizeSkillFolderPath(folderPath);
  if (!childPath) {
    return null;
  }

  return parentFolderPath ? `${parentFolderPath}/${childPath}` : childPath;
}

function splitSkillFolderPath(folderPath: string | undefined): string[] {
  if (!folderPath) {
    return [];
  }

  return folderPath
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);
}

function normalizeSkillFolderPath(folderPath: string | string[] | undefined): string | undefined {
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

function inferSkillFolderPathFromSource(
  workspaceFolder: vscode.WorkspaceFolder,
  filePath: string,
): string | undefined {
  const skillsRoot = path.join(workspaceFolder.uri.fsPath, '.atlasmind', 'skills');
  const relativeDir = path.relative(skillsRoot, path.dirname(filePath));
  if (!relativeDir || relativeDir === '.') {
    return undefined;
  }
  if (relativeDir.startsWith('..') || path.isAbsolute(relativeDir)) {
    return undefined;
  }
  return normalizeSkillFolderPath(relativeDir);
}

function buildSkillTemplate(id: string): string {
  const name = id.replace(/-([a-z])/g, (_, c: string) => (c as string).toUpperCase());
  return `// AtlasMind custom skill: ${id}
// Export module.exports.skill as a SkillDefinition object.
'use strict';

exports.skill = {
  id: '${id}',
  name: '${name}',
  description: 'Describe what this skill does.',
  parameters: {
    type: 'object',
    required: ['input'],
    properties: {
      input: {
        type: 'string',
        description: 'The primary input for the skill.',
      },
    },
  },
  async execute(params, context) {
    const input = String(params['input'] ?? '');
    // Replace this stub with your skill logic.
    // Use context.readFile(), context.writeFile(), context.findFiles() for workspace access.
    return \`Result for: \${input}\`;
  },
};
`;
}

function toBudgetMode(value: string | undefined): 'cheap' | 'balanced' | 'expensive' | 'auto' {
  switch (value) {
    case 'cheap':
    case 'balanced':
    case 'expensive':
    case 'auto':
      return value;
    default:
      return 'balanced';
  }
}

function toSpeedMode(value: string | undefined): 'fast' | 'balanced' | 'considered' | 'auto' {
  switch (value) {
    case 'fast':
    case 'balanced':
    case 'considered':
    case 'auto':
      return value;
    default:
      return 'balanced';
  }
}

function resolveProviderIdForModel(
  modelId: string,
  router: Pick<AtlasMindContext['modelRouter'], 'getModelInfo'>,
  fallback: string,
): string {
  const metadataProvider = router.getModelInfo(modelId)?.provider;
  if (metadataProvider) {
    return metadataProvider;
  }

  const prefix = modelId.split('/')[0]?.trim();
  return prefix && prefix.length > 0 ? prefix : fallback;
}

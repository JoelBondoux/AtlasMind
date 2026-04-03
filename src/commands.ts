import * as vscode from 'vscode';
import type { AtlasMindContext } from './extension.js';
import { SettingsPanel } from './views/settingsPanel.js';
import { ModelProviderPanel } from './views/modelProviderPanel.js';

/**
 * Registers all AtlasMind commands declared in package.json.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.openSettings', () => {
      SettingsPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('atlasmind.openModelProviders', () => {
      ModelProviderPanel.createOrShow(context.extensionUri);
    }),

    vscode.commands.registerCommand('atlasmind.openAgentPanel', () => {
      vscode.window.showInformationMessage('AtlasMind: Agent panel coming soon.');
    }),

    vscode.commands.registerCommand('atlasmind.bootstrapProject', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage('Open a folder first to bootstrap a project.');
        return;
      }
      const { bootstrapProject } = await import('./bootstrap/bootstrapper.js');
      await bootstrapProject(workspaceFolders[0].uri, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.showCostSummary', () => {
      const summary = atlas.costTracker.getSummary();
      vscode.window.showInformationMessage(
        `AtlasMind session cost: $${summary.totalCostUsd.toFixed(4)} across ${summary.totalRequests} requests.`,
      );
    }),
  );
}

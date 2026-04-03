import * as vscode from 'vscode';
import type { AtlasMindContext } from '../extension.js';
import type { AgentDefinition, SkillDefinition } from '../types.js';

/**
 * Registers all sidebar tree-view providers.
 */
export function registerTreeViews(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      'atlasmind.agentsView',
      new AgentsTreeProvider(atlas),
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.skillsView',
      new SkillsTreeProvider(atlas),
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.memoryView',
      new MemoryTreeProvider(),
    ),
    vscode.window.registerTreeDataProvider(
      'atlasmind.modelsView',
      new ModelsTreeProvider(atlas),
    ),
  );
}

// ── Agents ──────────────────────────────────────────────────────

class AgentsTreeProvider implements vscode.TreeDataProvider<AgentDefinition> {
  constructor(private atlas: AtlasMindContext) {}

  getTreeItem(element: AgentDefinition): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.role;
    item.tooltip = element.description;
    return item;
  }

  getChildren(): AgentDefinition[] {
    return this.atlas.agentRegistry.listAgents();
  }
}

// ── Skills ──────────────────────────────────────────────────────

class SkillsTreeProvider implements vscode.TreeDataProvider<SkillDefinition> {
  constructor(private atlas: AtlasMindContext) {}

  getTreeItem(element: SkillDefinition): vscode.TreeItem {
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    return item;
  }

  getChildren(): SkillDefinition[] {
    return this.atlas.skillsRegistry.listSkills();
  }
}

// ── Memory (placeholder) ────────────────────────────────────────

class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem('SSOT not initialised', vscode.TreeItemCollapsibleState.None)];
  }
}

// ── Models ──────────────────────────────────────────────────────

class ModelsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private atlas: AtlasMindContext) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const providers = this.atlas.modelRouter.listProviders();
    if (providers.length === 0) {
      return [new vscode.TreeItem('No providers configured', vscode.TreeItemCollapsibleState.None)];
    }
    return providers.map(p => {
      const item = new vscode.TreeItem(p.displayName, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = p.enabled ? 'enabled' : 'disabled';
      return item;
    });
  }
}

import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from './extension.js';
import type { SkillDefinition } from './types.js';
import { SettingsPanel } from './views/settingsPanel.js';
import { ModelProviderPanel } from './views/modelProviderPanel.js';
import { SkillScannerPanel } from './views/skillScannerPanel.js';
import type { SkillTreeItem } from './views/treeViews.js';

/**
 * Registers all AtlasMind commands declared in package.json.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  atlas: AtlasMindContext,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('atlasmind.openSettings', () => {
      SettingsPanel.createOrShow(context);
    }),

    vscode.commands.registerCommand('atlasmind.openModelProviders', () => {
      ModelProviderPanel.createOrShow(context);
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

    // ── Skill management ────────────────────────────────────────

    vscode.commands.registerCommand('atlasmind.skills.toggleEnabled', async (item: SkillTreeItem) => {
      const skillId = item?.skillId;
      if (!skillId) { return; }
      const registry = atlas.skillsRegistry;

      if (registry.isEnabled(skillId)) {
        registry.disable(skillId);
      } else {
        const scanResult = registry.getScanResult(skillId);
        if (scanResult?.status === 'failed') {
          vscode.window.showErrorMessage(
            `Cannot enable "${skillId}": security scan failed. Resolve the reported issues and re-scan.`,
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

    vscode.commands.registerCommand('atlasmind.skills.scan', async (item: SkillTreeItem) => {
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

    vscode.commands.registerCommand('atlasmind.skills.addSkill', async () => {
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
        ],
        { placeHolder: 'How would you like to add a skill?' },
      ) as ({ label: string; description: string; value: string } | undefined);

      if (!choice) { return; }

      if (choice.value === 'template') {
        await createSkillTemplate(atlas);
      } else {
        await importSkillFile(atlas);
      }
    }),

    vscode.commands.registerCommand('atlasmind.openScannerRules', () => {
      SkillScannerPanel.createOrShow(
        atlas.extensionContext,
        atlas.scannerRulesManager,
        () => atlas.skillsRefresh.fire(),
      );
    }),
  );
}

// ── Skill add helpers ────────────────────────────────────────────

async function createSkillTemplate(atlas: AtlasMindContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder first to create a skill template.');
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

  const dir = vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills');
  const file = vscode.Uri.joinPath(dir, `${id}.js`);
  await vscode.workspace.fs.writeFile(file, Buffer.from(buildSkillTemplate(id), 'utf-8'));
  await vscode.window.showTextDocument(file);
  vscode.window.showInformationMessage(
    `Skill template created. Edit the file, save it, then use "Import .js skill" to register it.`,
  );
}

async function importSkillFile(atlas: AtlasMindContext): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Skill modules (CommonJS .js)': ['js'] },
    title: 'Select a compiled skill .js file',
  });
  if (!uris || uris.length === 0) { return; }
  const filePath = uris[0].fsPath;

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

  // 2. Load the module (CommonJS require)
  let skillDef: SkillDefinition | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(filePath) as { skill?: unknown; default?: unknown };
    skillDef = (mod.skill ?? mod.default) as SkillDefinition | undefined;
  } catch (err) {
    vscode.window.showErrorMessage(
      `Failed to load "${path.basename(filePath)}": ${String(err)}`,
    );
    return;
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
    return;
  }

  // 3. Register the skill (disabled until user explicitly enables it)
  const registered: SkillDefinition = { ...skillDef, source: filePath, builtIn: false };
  atlas.skillsRegistry.register(registered);
  atlas.skillsRegistry.setScanResult({ ...scanResult, skillId: registered.id });
  atlas.skillsRegistry.disable(registered.id);
  atlas.skillsRefresh.fire();

  vscode.window.showInformationMessage(
    `Skill "${registered.name}" imported and is disabled. Enable it from the Skills panel once you have reviewed the source.`,
  );
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
    // TODO: implement skill logic
    return \`Result for: \${input}\`;
  },
};
`;
}

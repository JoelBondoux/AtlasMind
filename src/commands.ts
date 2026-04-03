import * as vscode from 'vscode';
import * as path from 'path';
import type { AtlasMindContext } from './extension.js';
import type { SkillDefinition, SkillScanResult } from './types.js';
import { TaskProfiler } from './core/taskProfiler.js';
import { buildSkillDraftPrompt, extractGeneratedSkillCode, toSuggestedSkillId } from './core/skillDrafting.js';
import { SettingsPanel } from './views/settingsPanel.js';
import { ModelProviderPanel } from './views/modelProviderPanel.js';
import { ToolWebhookPanel } from './views/toolWebhookPanel.js';
import { SkillScannerPanel } from './views/skillScannerPanel.js';
import { McpPanel } from './views/mcpPanel.js';
import { AgentManagerPanel } from './views/agentManagerPanel.js';
import type { SkillTreeItem } from './views/treeViews.js';

const SKILL_LEARNING_WARNING =
  'Experimental skill learning uses model tokens and may generate incorrect or unsafe code. ' +
  'Atlas will security-scan generated drafts and any imported draft stays disabled until you review it.';

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
      ModelProviderPanel.createOrShow(context, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openToolWebhooks', () => {
      ToolWebhookPanel.createOrShow(context, atlas);
    }),

    vscode.commands.registerCommand('atlasmind.openAgentPanel', () => {
      AgentManagerPanel.createOrShow(context, atlas);
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
        await createSkillTemplate(atlas);
      } else if (choice.value === 'draft') {
        await draftSkillWithAtlas(atlas);
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

    vscode.commands.registerCommand('atlasmind.openMcpServers', () => {
      McpPanel.createOrShow(
        atlas.extensionContext,
        atlas.mcpServerRegistry,
        () => atlas.skillsRefresh.fire(),
      );
    }),
  );
}

// ── Skill add helpers ────────────────────────────────────────────

async function createSkillTemplate(_atlas: AtlasMindContext): Promise<void> {
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
  await vscode.workspace.fs.createDirectory(dir);
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

  const imported = await registerImportedSkill(atlas, filePath, scanResult);
  if (!imported) {
    return;
  }

  vscode.window.showInformationMessage(
    `Skill imported and is disabled. Enable it from the Skills panel once you have reviewed the source.`,
  );
}

async function draftSkillWithAtlas(atlas: AtlasMindContext): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('Open a folder first to let Atlas draft a skill.');
    return;
  }

  const enabled = vscode.workspace.getConfiguration('atlasmind').get<boolean>('experimentalSkillLearningEnabled', false);
  if (!enabled) {
    vscode.window.showWarningMessage('Enable Experimental Skill Learning in AtlasMind Settings before using Atlas-generated skill drafts.');
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
  const providerId = model.split('/')[0] ?? 'local';
  const provider = atlas.providerRegistry.get(providerId);

  if (!provider) {
    vscode.window.showErrorMessage(`No provider adapter is registered for ${providerId}.`);
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

  const dir = vscode.Uri.joinPath(workspaceFolder.uri, '.atlasmind', 'skills');
  const file = vscode.Uri.joinPath(dir, `${skillId}.js`);
  await vscode.workspace.fs.createDirectory(dir);
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

  const imported = await registerImportedSkill(atlas, file.fsPath, scanResult);
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

  const registered: SkillDefinition = { ...skillDef, source: filePath, builtIn: false };
  atlas.skillsRegistry.register(registered);
  atlas.skillsRegistry.setScanResult({ ...scanResult, skillId: registered.id });
  atlas.skillsRegistry.disable(registered.id);
  atlas.skillsRefresh.fire();

  return true;
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

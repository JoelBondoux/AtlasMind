import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The panel and command sites of the dry run, held to the order that makes it
 * real: the guard comes before the effect, inside the function that performs
 * it. These surfaces drive `vscode` end to end, so — as the dashboard's other
 * safety tests do — they are read rather than run; the guards they call are
 * exercised for real in `tests/core/dryRunHost*.test.ts`.
 */

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8').replace(/\r\n/g, '\n');
}

/** The text from `start` up to the next occurrence of `end` after it. */
function region(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

/** `guard` occurs, `effect` occurs, and the guard comes first. */
function expectGuardBefore(body: string, guard: string, effect: string): void {
  const guardAt = body.indexOf(guard);
  const effectAt = body.indexOf(effect);
  expect(guardAt, `guard "${guard}" missing`).toBeGreaterThan(-1);
  expect(effectAt, `effect "${effect}" missing`).toBeGreaterThan(-1);
  expect(guardAt, `"${guard}" must come before "${effect}"`).toBeLessThan(effectAt);
}

describe('Project Dashboard', () => {
  const host = source('src/views/projectDashboardPanel.ts');

  it('guards every git command it runs, at the one helper they all share', () => {
    const runGit = region(host, 'async function runGit(', 'async function listGitRemotes(');
    expectGuardBefore(runGit, "guardHostCommand('dashboard', 'git', args)", 'execFileAsync(');
  });

  it('holds terminal sends and run-plan execution', () => {
    expectGuardBefore(region(host, 'private sendLocalCiCommandToTerminal(', 'private '), 'interceptDryRun(', '.sendText(');
    expectGuardBefore(region(host, 'private async handleSendDeliveryCommandToTerminal(', 'private async handleRunDeliveryGuidePhase('), 'interceptDryRun(', '.sendText(');
    const runPlan = region(host, 'private async handleRunDeliveryGuidePhase(', 'private getOrCreateDeliveryTerminal(');
    expectGuardBefore(runPlan, 'showWarningMessage(', 'interceptDryRun(');
    expectGuardBefore(runPlan, 'interceptDryRun(', '.sendText(');
  });

  it('sends no Director message, and records no outbound history, in a dry run', () => {
    const send = region(host, 'private async handleDirectorSendComms(', 'private async resolveLiveCiStatus(');
    expectGuardBefore(send, "{ modal: true }, 'Send'", 'interceptDryRun(');
    expectGuardBefore(send, 'interceptDryRun(', 'skill.execute(');
    expectGuardBefore(send, 'interceptDryRun(', 'appendProjectDirectorHistory(');
  });

  it('keeps a dry-run promotion, remediation and rollback out of delivery history', () => {
    const run = region(host, 'private async handleRunPromotion(', 'private async handleResolveAndRunPromotion(');
    expectGuardBefore(run, 'if (result.dryRun)', 'deliveryManager.save(');
    expectGuardBefore(run, 'if (result.dryRun)', 'appendPromotionHistory(');

    const resolve = region(host, 'private async handleResolveAndRunPromotion(', 'private async handleRollbackStage(');
    expectGuardBefore(resolve, 'if (applied.dryRun)', 'runPromotion(');

    const rollback = region(host, 'private async handleRollbackStage(', 'private getHtml(');
    expectGuardBefore(rollback, 'if (result.dryRun)', 'appendPromotionHistory(');
  });

  it('does not anchor the roadmap on load in a dry run', () => {
    const anchors = region(host, 'private async ensureRoadmapAnchors(', '/**');
    expectGuardBefore(anchors, 'interceptDryRun(', 'this.openRoadmapGraphForWrite(');
  });

  it('renders a dry-run promotion as one, not as a failure', () => {
    const webview = source('media/projectDashboard.js');
    expect(webview).toContain("dryRun ? 'Dry run: the promotion was not run.'");
    expect(webview).toContain('Dry run — nothing was run. This is what the promotion would have done.');
    expect(webview).toContain("dry ? 'Dry run — promotion not run'");
  });
});

describe('Chat panel', () => {
  const panel = source('src/views/chatPanel.ts');

  it('types nothing into a terminal in a dry run', () => {
    const send = region(panel, "case 'sendToTerminal': {", "case 'insertCodeAtCursor':");
    expectGuardBefore(send, 'interceptDryRun(', '.sendText(');
  });

  it('runs no managed-terminal command, and tells the model so rather than inventing output', () => {
    const run = region(panel, 'private async executeManagedTerminalCommand(', 'private buildManagedTerminalContext(');
    expectGuardBefore(run, 'interceptDryRun(', 'shellIntegration.executeCommand(');
    expect(run).toContain('[DRY RUN — nothing was executed]');
  });

  it('does not save the gap analysis after a dry turn', () => {
    const persist = region(panel, 'private async persistGapAnalysisIfRequested(', '\n  private ');
    expectGuardBefore(persist, 'interceptDryRun(', 'fs.writeFile(');
  });
});

describe('Chat participant', () => {
  const participant = source('src/chat/participant.ts');

  it('posts nothing to Buzz in a dry run and says so in the chat', () => {
    for (const [start, end] of [['async function handleBuzzSend(', 'async function handleBuzzDirectMessage('], ['async function handleBuzzDirectMessage(', 'async function fetchBuzzDoc(']] as const) {
      const body = region(participant, start, end);
      expectGuardBefore(body, 'interceptDryRun(', 'skill.execute(');
      expect(body).toContain('**Not sent.**');
    }
  });

  it('writes no project-run report after a dry run', () => {
    const report = region(participant, 'export async function writeProjectRunSummaryReport(', 'function toSnapshotKey(');
    expectGuardBefore(report, 'interceptDryRun(', 'vscode.workspace.fs.writeFile(');
  });

  it('renders /ship under a dry run as a plan, not as a refusal about its input', () => {
    const ship = region(participant, 'async function handleShipCommand(', '\nasync function ');
    expectGuardBefore(ship, 'if (result.dryRun)', 'if (result.refusedReason)');
    expect(ship).toContain('Dry run — nothing was run.');
  });
});

describe('Extension host', () => {
  const extension = source('src/extension.ts');

  it('installs the host with the session ledger before any surface can act', () => {
    const install = extension.indexOf('installDryRunHost(new DryRunHost(');
    expect(install).toBeGreaterThan(extension.indexOf('const dryRunLedger = new DryRunLedger();'));
    expect(install).toBeLessThan(extension.indexOf('const toolApprovalGate = async ('));
  });

  it('types no setup command into a terminal in a dry run', () => {
    expectGuardBefore(region(extension, "registerCommand('atlasmind.buzz.prepareCommand'", "registerCommand('atlasmind.setup.prepareCommand'"), 'interceptDryRun(', '.sendText(');
    expectGuardBefore(region(extension, "registerCommand('atlasmind.setup.prepareCommand'", "registerCommand('atlasmind.setBuzzAgentKey'"), 'interceptDryRun(', '.sendText(');
  });

  it('holds memory writes AtlasMind would make on its own', () => {
    expectGuardBefore(region(extension, 'async function runMemorySelfHealingPass(', '\nasync function '), 'interceptDryRun(', 'vscode.workspace.fs.writeFile(');
    expectGuardBefore(region(extension, 'async function autoRefreshProjectMemoryIfStale(', 'async function runMemorySelfHealingPass('), 'interceptDryRun(', 'importProject(workspaceFolder.uri, atlas)');
    const refresh = region(extension, 'const ssotSnippetRefreshHandle = setInterval(', 'MEMORY_SELF_HEAL_INTERVAL_MS');
    expectGuardBefore(refresh, 'interceptDryRun(', 'memoryManager.upsert(');
  });
});

describe('Other surfaces that start processes or send', () => {
  it('settings: pulls, deletes and downloads no local model', () => {
    const settings = source('src/views/settingsPanel.ts');
    expectGuardBefore(region(settings, 'async function installOllamaModel(', '\n}\n'), 'guardDryRun(', 'fetch(');
    expectGuardBefore(region(settings, 'async function removeOllamaModel(', '\n}\n'), 'guardDryRun(', 'fetch(');
    expectGuardBefore(region(settings, 'private async runLmsGetInstall(', 'private async '), 'interceptDryRun(', 'spawn(');
  });

  it('UI Studio: launches no engine', () => {
    const studio = source('src/views/websiteStudioPanel.ts');
    const launch = region(studio, "confirmed !== 'Run'", 'child.unref()');
    expectGuardBefore(launch, 'interceptDryRun(', 'spawn(');
  });

  it('website setup: runs nothing, writes nothing, after the confirmation', () => {
    const setup = source('src/views/websiteStackSetupHost.ts');
    const run = region(setup, 'export async function setUpWebsiteStack(', '\n}\n');
    expectGuardBefore(run, 'confirmSetup(', 'interceptDryRun(');
    expectGuardBefore(run, 'interceptDryRun(', 'executeWebsiteStackSetup(');
    expectGuardBefore(region(setup, 'function execFileInDirectory(', '\n}\n'), 'guardHostCommand(', 'execFile(');
  });

  it('portal: deploys nothing, and does not then claim it published', () => {
    const portal = source('src/views/portalPublishCommand.ts');
    expectGuardBefore(portal, 'interceptDryRun(', 'await execFileAsync(deploy.command.file');
    expectGuardBefore(portal, 'if (deployHeldByDryRun)', "'Portal published.");
  });

  it('lens: probes no live service through an MCP tool', () => {
    const lens = source('src/views/lensTreeView.ts');
    expectGuardBefore(region(lens, 'invokeMcpTool: async', '\n    },'), 'guardDryRun(', 'skill.execute(');
  });

  it('bootstrap: starts no intake, and guards its git and installer inside', () => {
    const boot = source('src/bootstrap/bootstrapper.ts');
    expectGuardBefore(region(boot, 'export async function bootstrapProject(', 'readBootstrapDraft('), 'interceptDryRun(', '### Atlas Bootstrap Intake');
    expectGuardBefore(region(boot, 'function runGit(cwd: string', '\n}\n'), 'guardHostCommand(', 'cp.execFile(');
  });

  it('local CI: starts no runner container', () => {
    const runner = source('src/core/localCiRunner.ts');
    const start = region(runner, '  async start(', 'private async ensureDockerEngine(');
    expectGuardBefore(start, 'guardDryRun(', "spawn('docker'");
    expectGuardBefore(region(runner, 'async function execCommand(', '\n}\n'), 'guardHostCommand(', 'execFileAsync(');
  });

  it('CLI: describes the build instead of spawning it', () => {
    const cli = source('src/cli/main.ts');
    expectGuardBefore(region(cli, 'async function runBuildCommand(', '\n}\n'), 'isDryRunActive()', "import('node:child_process')");
  });
});

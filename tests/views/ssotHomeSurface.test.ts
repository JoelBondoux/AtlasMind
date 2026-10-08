import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Locating the SSOT home in a multi-root workspace (slice A2) only matters if
 * the surfaces that read and write project memory actually ask for it — and if
 * the one thing a person can do about an ambiguous home, which is read why, is
 * on the screen. Neither is visible to the type checker, so both are asserted
 * against the real sources here.
 */

const read = (...segments: string[]): string => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

const WEBVIEW_SCRIPT = read('media', 'projectDashboard.js');
const DASHBOARD = read('src', 'views', 'projectDashboardPanel.ts');
const PARTICIPANT = read('src', 'chat', 'participant.ts');
const EXTENSION = read('src', 'extension.ts');

/** A named function's source, from its declaration to the next function at the same indent. */
function functionSource(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is missing`).toBeGreaterThan(-1);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const next = source.indexOf(`\n${indent}function `, start + signature.length);
  const nextAsync = source.indexOf(`\n${indent}async function `, start + signature.length);
  const ends = [next, nextAsync].filter(index => index > -1);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const escapeHtml = (value: unknown): string => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** The webview's banner function, evaluated with the page's own escaping contract. */
function loadNotice(): (snapshot: unknown) => string {
  const source = functionSource(WEBVIEW_SCRIPT, 'function renderSsotHomeNotice(snapshot)');
  return new Function('escapeHtml', `${source}\nreturn renderSsotHomeNotice;`)(escapeHtml) as (snapshot: unknown) => string;
}

describe('the dashboard banner for an ambiguous SSOT home', () => {
  it('renders on every page, directly under the connection banner', () => {
    const render = functionSource(WEBVIEW_SCRIPT, 'function render()');
    const host = render.indexOf('${renderHostConnectionBanner()}');
    const notice = render.indexOf('${renderSsotHomeNotice(snapshot)}');
    const overview = render.indexOf('${renderOverview(snapshot)}');
    expect(host).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(host);
    expect(overview).toBeGreaterThan(notice);
  });

  it('is absent when the home is located, and names every candidate when it is not', () => {
    const renderNotice = loadNotice();
    expect(renderNotice({ ssotHome: { rule: 'single-root', homeName: 'app', candidates: ['app'] } })).toBe('');
    expect(renderNotice({ ssotHome: { rule: 'sole-ssot', homeName: 'game', candidates: ['game'] } })).toBe('');
    expect(renderNotice({})).toBe('');

    const html = renderNotice({
      ssotHome: {
        rule: 'ambiguous',
        candidates: ['alpha', 'beta'],
        notice: 'Project memory has no single home: "alpha" and "beta" each hold a project_memory/ folder.',
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain('<li>alpha</li>');
    expect(html).toContain('<li>beta</li>');
    expect(html).toContain('&quot;alpha&quot; and &quot;beta&quot;');
  });

  it('escapes folder names and the notice, since a folder name is whatever somebody called a directory', () => {
    const html = loadNotice()({
      ssotHome: { rule: 'ambiguous', candidates: ['<img src=x onerror=alert(1)>'], notice: '<script>bad()</script>' },
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });

  it('is informational: it posts nothing and offers no action that could pick a folder', () => {
    const source = functionSource(WEBVIEW_SCRIPT, 'function renderSsotHomeNotice(snapshot)');
    expect(source).not.toMatch(/postMessage|data-action/);
  });

  it('is composed host-side from the same refusal every other surface uses', () => {
    const composer = functionSource(DASHBOARD, 'function describeDashboardSsotHome(');
    expect(composer).toContain('home.refusal');
    expect(DASHBOARD).toContain('ssotHome: describeDashboardSsotHome(ssotHome, firstWorkspaceFolder?.name)');
  });
});

describe('the surfaces that read and write project memory ask for the home', () => {
  it('reads the workflow file from the SSOT home, refusing rather than reading an ambiguous one', () => {
    const getter = DASHBOARD.slice(DASHBOARD.indexOf('private get workflowConfig(): WorkflowConfigManager {'));
    expect(getter.slice(0, 400)).toContain('new WorkflowConfigManager(home.fsPath, home.refusal)');
  });

  it('anchors a "." component on the folder the composition was read from', () => {
    expect(DASHBOARD).toContain('collectDashboardWorkspaceScope(composition, this.workflowConfig.getWorkspaceRoot())');
    expect(DASHBOARD).toContain('collectDashboardWorkspaceScope(declaredComposition, workflowConfigManager?.getWorkspaceRoot())');
    expect(DASHBOARD).not.toMatch(/collectDashboardWorkspaceScope\((?:composition|declaredComposition)\)/);
  });

  it('writes operator feedback, and reads the ideation board and the roadmap, from the home', () => {
    const ssotRoot = functionSource(PARTICIPANT, 'function getSsotRootUri()');
    expect(ssotRoot).toContain('ssotHomeRoot()');
    expect(ssotRoot).toContain('refusal');
    expect(ssotRoot).not.toContain('workspaceFolders');

    const ideate = functionSource(PARTICIPANT, 'async function handleIdeateCommand(');
    expect(ideate).toContain('ssotHomeRoot()');
    expect(ideate).toContain('home.refusal');
  });

  it('loads memory and the project soul from the home', () => {
    const soul = functionSource(EXTENSION, 'function resolveProjectSoulFilePath(');
    expect(soul).toContain('ssotHomeRoot().folder');
    expect(soul).not.toContain('vscode.workspace.workspaceFolders');
    expect(EXTENSION).toContain('const workspaceFolder = ssotHome.folder;');
  });

  it('keeps workspace identity on the first folder on purpose, so cost history is not re-keyed', () => {
    // docs/project-composition.md: moving these would orphan every spend record
    // already written under the first folder's key.
    expect(EXTENSION).toContain('costTracker.setWorkspaceKey(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);');
    const costHistory = functionSource(EXTENSION, 'async function attachCostHistoryStore(');
    expect(costHistory).toContain('vscode.workspace.workspaceFolders?.[0]');
    // The machine-private copy is keyed by the first folder's path — identity.
    expect(costHistory).toMatch(/createHash\('sha256'\)\.update\(folder\.uri\.fsPath/);
    // The committed copy is project memory, so since 0.498.1 it lives in the
    // home with every other register: written into folder 0 it would create a
    // second project_memory/ and make the home ambiguous by itself.
    const repositoryBranch = costHistory.slice(costHistory.indexOf("if (location === 'repository')"), costHistory.indexOf('const key ='));
    expect(repositoryBranch).toContain('ssotHomeRoot().fsPath');
    expect(repositoryBranch).not.toContain('folder.uri.fsPath');
  });
});

/**
 * 0.498.1: no split brain. The type checker cannot see which folder a register
 * was handed, and the static guard (`tests/baselines/ssotHomeResolution.test.ts`)
 * says only that nothing reaches the first folder — these say what each surface
 * does instead.
 */
describe('every reader and writer of project memory, on the same home', () => {
  it('binds every cached dashboard register to the home and its refusal, rebinding when the home moves', () => {
    for (const [getter, manager] of [
      ['private get portalHosting()', 'PortalHostingManager'],
      ['private get debtManager()', 'DebtRegisterManager'],
      ['private get defectManager()', 'DefectRegisterManager'],
      ['private get auditLedger()', 'WorkflowAuditLedger'],
      ['private get ciRouting()', 'CiRoutingConfigManager'],
      ['private get approvalManager()', 'ApprovalRegisterManager'],
      ['private get testCaseManager()', 'TestCaseRegisterManager'],
    ] as const) {
      const body = DASHBOARD.slice(DASHBOARD.indexOf(getter), DASHBOARD.indexOf(getter) + 400);
      expect(body, getter).toContain('this.ssotBinding()');
      expect(body, getter).toContain(`new ${manager}(home.fsPath, home.refusal)`);
      expect(body, getter).not.toContain('defaultWorkspaceRootPath');
    }
    const binding = DASHBOARD.slice(DASHBOARD.indexOf('private ssotBinding(): SsotHomeRoot {'));
    expect(binding.slice(0, 900)).toMatch(/if \(key !== this\.ssotBindingKey\)[\s\S]*this\.debtManagerInstance = undefined/);
  });

  it('binds the activation-time registers to the home, and the run-history identity to the first folder', () => {
    for (const manager of ['DeliveryManager', 'ProjectDirectorManager', 'DocumentsManager', 'RiskOversightManager', 'ResearchRegisterManager', 'MissionRegistry']) {
      expect(EXTENSION, manager).toContain(`new startupModules.${manager}(ssotRootPath, ssotRefusal)`);
    }
    expect(EXTENSION).toContain('workspaceKey: workspaceRootPath,');
  });

  it('shows a refusal as a warning naming why, not as a failed action', () => {
    const dispatcher = DASHBOARD.slice(DASHBOARD.indexOf('void this.handleMessage(message).catch('), DASHBOARD.indexOf('void this.handleMessage(message).catch(') + 900);
    expect(dispatcher).toMatch(/error instanceof SsotHomeRefusalError[\s\S]*showWarningMessage\(detail\)[\s\S]*return;/);
  });

  it('leaves project-memory sections empty while the home is ambiguous, and says so', () => {
    const snapshot = functionSource(DASHBOARD, 'async function collectDashboardSnapshot(');
    expect(snapshot).toContain('const ssotRoot = declaredComposition');
    for (const call of [
      'collectSsotSnapshot(ssotRoot, ssotPath)',
      'collectRoadmapSnapshot(ssotRoot, ssotPath)',
      'loadIdeationBoard(ssotRoot, ssotPath, activeIdeationWorkspace)',
      'collectGapAnalysisSnapshot(ssotRoot, ssotPath, heuristicGapItems)',
      'collectDirectorSnapshot(atlas, ssotRoot,',
      'collectRiskSnapshot(atlas, ssotRoot)',
      'collectDeliveryStagePipeline(atlas, ssotRoot,',
    ]) {
      expect(snapshot, call).toContain(call);
    }
    // No fallback from project memory to the first folder.
    expect(snapshot).not.toMatch(/ssotHome\.fsPath \?\? firstWorkspaceFolder/);
    const composer = functionSource(DASHBOARD, 'function describeDashboardSsotHome(');
    expect(composer).toContain('left empty rather than filled from one candidate');
  });

  it('routes the run report by where it is written: project memory to the home, anything else to the first folder', () => {
    const report = functionSource(PARTICIPANT, 'export async function writeProjectRunSummaryReport(');
    expect(report).toMatch(/if \(insideSsot\) \{[\s\S]*ssotHomeRoot\(\)[\s\S]*home\.refusal[\s\S]*return undefined;[\s\S]*\} else \{[\s\S]*defaultWorkspaceFolder\(\)/);
  });

  it('applies the strictest combination of every candidate privacy policy rather than none', () => {
    expect(EXTENSION).toContain('startupModules.strictestDataPrivacyConfig(');
    expect(EXTENSION).toContain('ssotHomeAtActivation.location.candidates');
  });
});

describe('consumers that decide on project memory are told it was not read', () => {
  // The behaviour is asserted against real ambiguous homes in
  // tests/core/ambiguousSsotHomeConsumers.test.ts; these pin the wiring, which
  // is where a refusal would quietly stop reaching the decision.
  it('passes the refusal to the Overview feed, so its groups are dropped rather than read as empty', () => {
    const mapping = functionSource(DASHBOARD, 'function buildAttentionInput(');
    expect(mapping).toContain('projectMemoryUnreadable: { reason: snapshot.ssotHome.notice }');
  });

  it('passes the unread testing matrix to the release gate', () => {
    expect(DASHBOARD).toContain('testingPolicyUnreadable: testingSnapshot.policyUnreadable');
    expect(DASHBOARD).toContain('testingPolicyUnreadable: input.testingPolicyUnreadable');
  });

  it('hands the eval gate the home with its refusal, not a bare path', () => {
    expect(EXTENSION).toContain('ssotHome: () => ssotHomeRoot(),');
    expect(EXTENSION).not.toMatch(/workspaceRoot: \(\) => ssotHomeRoot\(\)\.fsPath,\s*\}\);\s*const agentAutoUpdater/);
  });
});

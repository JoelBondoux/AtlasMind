import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every project-memory register reads and writes the folder `ssotHomeRoot()`
 * locates — the same one — and refuses, with the one shared sentence, when
 * there is no single home.
 *
 * 0.498.0 located the home and moved *some* surfaces to it; the register
 * managers kept the first folder. With project memory in the second folder of a
 * workspace, the dashboard read a register from the home while its manager
 * wrote the change into folder 0: the write "worked", the page never showed it,
 * and a stray `project_memory/` appeared in a repository nobody was looking at
 * — which, at the next probe, made the home ambiguous by itself. The table
 * below binds each manager the way the host does and asserts where the write
 * lands, so a register added later is one row away from the same check.
 */

interface FakeFolder {
  name: string;
  index: number;
  uri: { scheme: string; fsPath: string };
}

const host = vi.hoisted(() => ({
  workspaceFolders: undefined as FakeFolder[] | undefined,
  settings: {} as Record<string, unknown>,
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return host.workspaceFolders;
    },
    getConfiguration: () => ({ get: (key: string, fallback?: unknown) => host.settings[key] ?? fallback }),
  },
}));

const { requireSsotHomeForWrite, ssotHomeForWrite, ssotHomeRoot, ssotHomeRootPath } = await import('../../src/utils/workspaceRoots.ts');
const { SsotHomeRefusalError, SSOT_HOME_DECLARATION_PATH } = await import('../../src/core/workspaceScope.ts');
const { DebtRegisterManager, DEBT_SSOT_PATH } = await import('../../src/core/debtRegister.ts');
const { DefectRegisterManager, DEFECT_SSOT_PATH } = await import('../../src/core/defectRegister.ts');
const { WorkflowAuditLedger, WORKFLOW_HISTORY_SSOT_PATH, beginWorkflowRun } = await import('../../src/core/workflowAuditRecord.ts');
const { PortalHostingManager, PORTAL_HOSTING_SSOT_PATH, seedPortalHostingConfig } = await import('../../src/core/portalHosting.ts');
const { CiRoutingConfigManager, CI_ROUTING_SSOT_PATH } = await import('../../src/core/ciRoutingPolicy.ts');
const { ApprovalRegisterManager, APPROVALS_SSOT_PATH } = await import('../../src/core/changeApprovals.ts');
const { TestCaseRegisterManager, TEST_CASES_SSOT_PATH } = await import('../../src/core/testCaseRegister.ts');
const { DeliveryManager, DELIVERY_SSOT_PATH, defaultDeliveryConfig } = await import('../../src/core/deliveryManager.ts');
const { DocumentsManager, DOCUMENTS_SSOT_PATH } = await import('../../src/core/documentsManager.ts');
const { ProjectDirectorManager, PROJECT_DIRECTOR_SSOT_PATH } = await import('../../src/core/projectDirectorManager.ts');
const { RiskOversightManager, RISK_SSOT_PATH } = await import('../../src/core/riskOversightManager.ts');
const { SecurityReviewManager, SECURITY_REVIEW_SSOT_PATH } = await import('../../src/core/securityReviewManager.ts');
const { ResearchRegisterManager, RESEARCH_SSOT_PATH, seedResearchRegister } = await import('../../src/core/researchRegister.ts');
const { MissionRegistry } = await import('../../src/core/missionRegistry.ts');
const { McpEnvironmentScanner } = await import('../../src/mcp/mcpEnvironmentScanner.ts');
const { WebsiteWorkspaceManager, WEBSITE_WORKSPACE_SSOT_PATH, createDefaultWebsiteWorkspace } = await import('../../src/core/websiteWorkspaceManager.ts');
const { WorkflowConfigManager, WORKFLOW_SSOT_PATH, seedWorkflowConfig } = await import('../../src/core/workflowConfig.ts');

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atlasmind-ssot-home-writes-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function makeFolder(withMemory: boolean): string {
  counter += 1;
  const dir = path.join(scratch, `folder-${counter}`);
  mkdirSync(withMemory ? path.join(dir, 'project_memory') : dir, { recursive: true });
  return dir;
}

function folder(name: string, fsPath: string, index: number): FakeFolder {
  return { name, index, uri: { scheme: 'file', fsPath } };
}

beforeEach(() => {
  host.workspaceFolders = undefined;
  host.settings = {};
});

/** How the host binds a register: the located home, and its refusal. */
function bound(): { root: string | undefined; refusal: string | undefined } {
  const home = ssotHomeRoot();
  return { root: home.fsPath, refusal: home.refusal };
}

interface RegisterRow {
  name: string;
  /** The file the write must produce, relative to the home. */
  file: string;
  write: (root: string | undefined, refusal: string | undefined) => Promise<unknown>;
}

const AT = '2026-10-08T12:00:00.000Z';

const REGISTERS: readonly RegisterRow[] = [
  { name: 'tech debt', file: DEBT_SSOT_PATH, write: (r, x) => new DebtRegisterManager(r, x).save({ version: 1, entries: [] }) },
  { name: 'defects', file: DEFECT_SSOT_PATH, write: (r, x) => new DefectRegisterManager(r, x).save({ version: 1, entries: [] }) },
  {
    name: 'workflow audit ledger',
    file: WORKFLOW_HISTORY_SSOT_PATH,
    write: (r, x) => new WorkflowAuditLedger(r, x).record(beginWorkflowRun({
      stageId: 'branching', action: 'derive branch name', actor: 'user',
      requestedLevel: 'propose', effectiveLevel: 'observe', inputs: { issue: 1 }, at: AT,
    })),
  },
  { name: 'portal hosting', file: PORTAL_HOSTING_SSOT_PATH, write: (r, x) => new PortalHostingManager(r, x).save(seedPortalHostingConfig(), [], 'unknown') },
  { name: 'CI routing', file: CI_ROUTING_SSOT_PATH, write: (r, x) => new CiRoutingConfigManager(r, x).create() },
  { name: 'approvals', file: APPROVALS_SSOT_PATH, write: (r, x) => new ApprovalRegisterManager(r, x).save({ version: 1, requests: [] }) },
  { name: 'test cases', file: TEST_CASES_SSOT_PATH, write: (r, x) => new TestCaseRegisterManager(r, x).save({ version: 1, cases: [], executions: [], assets: [] }) },
  { name: 'delivery', file: DELIVERY_SSOT_PATH, write: (r, x) => new DeliveryManager(r, x).save(defaultDeliveryConfig()) },
  { name: 'documents', file: DOCUMENTS_SSOT_PATH, write: (r, x) => new DocumentsManager(r, x).ensureSeeded({ presentDocFolders: [], keyDocs: [] }) },
  { name: 'project director', file: PROJECT_DIRECTOR_SSOT_PATH, write: (r, x) => new ProjectDirectorManager(r, x).ensureSeeded({ projectName: 'Game' }) },
  { name: 'risk oversight', file: RISK_SSOT_PATH, write: (r, x) => new RiskOversightManager(r, x).ensureSeeded() },
  { name: 'security review', file: SECURITY_REVIEW_SSOT_PATH, write: (r, x) => new SecurityReviewManager(r, x).ensureSeeded() },
  { name: 'research', file: RESEARCH_SSOT_PATH, write: (r, x) => new ResearchRegisterManager(r, x).save(seedResearchRegister(new Date(AT))) },
  { name: 'website plan', file: WEBSITE_WORKSPACE_SSOT_PATH, write: (r, x) => new WebsiteWorkspaceManager(r, x).save(createDefaultWebsiteWorkspace()) },
  { name: 'workflow file', file: WORKFLOW_SSOT_PATH, write: (r, x) => new WorkflowConfigManager(r, x).save(seedWorkflowConfig({ profile: 'solo' })) },
];

/** Every file under a folder's project_memory/, relative to the folder. */
function memoryFiles(dir: string): string[] {
  const root = path.join(dir, 'project_memory');
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out;
}

describe('a multi-root workspace whose home is the second folder', () => {
  it.each(REGISTERS)('$name writes into the home and leaves the first folder untouched', async row => {
    const first = makeFolder(false);
    const home = makeFolder(true);
    host.workspaceFolders = [folder('Tools', first, 0), folder('Game', home, 1)];
    const binding = bound();
    expect(ssotHomeRoot().location.rule).toBe('sole-ssot');
    expect(binding).toEqual({ root: home, refusal: undefined });

    await row.write(binding.root, binding.refusal);

    expect(existsSync(path.join(home, ...row.file.split('/')))).toBe(true);
    // Not one file of project memory in the folder VS Code happens to list first:
    // a stray project_memory/ there would make the home ambiguous on its own.
    expect(existsSync(path.join(first, 'project_memory'))).toBe(false);
  });

  it('gives every write helper the home, and every read helper the same folder', () => {
    const first = makeFolder(false);
    const home = makeFolder(true);
    host.workspaceFolders = [folder('Tools', first, 0), folder('Game', home, 1)];
    expect(ssotHomeRootPath()).toBe(home);
    expect(requireSsotHomeForWrite()).toBe(home);
    expect(ssotHomeForWrite('open a folder')).toMatchObject({ fsPath: home });
  });
});

describe('an ambiguous home refuses every write, with the one shared sentence', () => {
  function ambiguous(): { a: string; b: string; sentence: string } {
    const a = makeFolder(true);
    const b = makeFolder(true);
    host.workspaceFolders = [folder('Tools', a, 0), folder('Game', b, 1)];
    const home = ssotHomeRoot();
    expect(home.location.rule).toBe('ambiguous');
    return { a, b, sentence: home.refusal! };
  }

  it.each(REGISTERS)('$name throws the refusal and writes nothing anywhere', async row => {
    const { a, b, sentence } = ambiguous();
    const binding = bound();
    expect(binding.root).toBeUndefined();

    const attempt = row.write(binding.root, binding.refusal);
    await expect(attempt).rejects.toBeInstanceOf(SsotHomeRefusalError);
    await expect(attempt).rejects.toThrow(sentence);
    expect(memoryFiles(a)).toEqual([]);
    expect(memoryFiles(b)).toEqual([]);
  });

  it('refuses the registers the table cannot write for real, too', async () => {
    const { sentence } = ambiguous();
    const binding = bound();
    // Their real writes need fixtures (a mission record; this machine's MCP
    // configs), but the refusal is the first thing each does.
    await expect(new MissionRegistry(binding.root, binding.refusal).save({} as never)).rejects.toThrow(sentence);
    await expect(new McpEnvironmentScanner(binding.root, binding.refusal).scan()).rejects.toThrow(sentence);
  });

  it('hands the host write helpers the same sentence, and the read helper nothing', () => {
    const { sentence } = ambiguous();
    expect(ssotHomeRootPath()).toBeUndefined();
    expect(ssotHomeForWrite('open a folder')).toEqual({ message: sentence, refused: true });
    expect(() => requireSsotHomeForWrite()).toThrow(SsotHomeRefusalError);
    expect(() => requireSsotHomeForWrite()).toThrow(sentence);
  });

  it('reads nothing: a refused register is empty, not the first folder\'s', () => {
    ambiguous();
    const binding = bound();
    expect(new DebtRegisterManager(binding.root, binding.refusal).get().entries).toEqual([]);
    expect(new DeliveryManager(binding.root, binding.refusal).getConfig()).toBeUndefined();
    expect(new RiskOversightManager(binding.root, binding.refusal).getNotice()).toContain('no single home');
  });

  it('names the file the probe actually reads in the way out', () => {
    // The registers live at fixed project_memory/... paths, so the declaration
    // the refusal asks for must go there whatever atlasmind.ssotPath says.
    expect(SSOT_HOME_DECLARATION_PATH).toBe(WORKFLOW_SSOT_PATH);
  });
});

describe('a single-root workspace is unchanged', () => {
  it.each(REGISTERS)('$name writes into the one folder, as it always did', async row => {
    const only = makeFolder(false);
    host.workspaceFolders = [folder('App', only, 0)];
    const binding = bound();
    expect(binding).toEqual({ root: only, refusal: undefined });
    await row.write(binding.root, binding.refusal);
    expect(existsSync(path.join(only, ...row.file.split('/')))).toBe(true);
  });

  it('with no folder open, refuses nothing and writes nowhere', async () => {
    const binding = bound();
    expect(binding).toEqual({ root: undefined, refusal: undefined });
    expect(requireSsotHomeForWrite()).toBeUndefined();
    expect(ssotHomeForWrite('Open a folder first.')).toEqual({ message: 'Open a folder first.', refused: false });
    await expect(new DebtRegisterManager(binding.root, binding.refusal).save({ version: 1, entries: [] })).resolves.toBeUndefined();
  });
});

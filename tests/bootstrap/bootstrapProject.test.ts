import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  mockReadFile: vi.fn<(uri: { path: string }) => Promise<Uint8Array>>(),
  mockWriteFile: vi.fn<(uri: { path: string }, data: Uint8Array) => Promise<void>>(),
  mockCreateDirectory: vi.fn<(uri: { path: string }) => Promise<void>>(),
  mockReadDirectory: vi.fn<(uri: { path: string }) => Promise<[string, number][]>>(),
  mockStat: vi.fn<(uri: { path: string }) => Promise<{ mtime: number }>>(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  executeCommand: vi.fn(),
}));

const {
  mockReadFile,
  mockWriteFile,
  mockCreateDirectory,
  mockReadDirectory,
  mockStat,
  showQuickPick,
  showInputBox,
  showWarningMessage,
  showInformationMessage,
  showErrorMessage,
  executeCommand,
} = vscodeMocks;
const configurationUpdates: Array<{ key: string; value: unknown; target: unknown }> = [];

const configurationState = new Map<string, unknown>([
  ['ssotPath', 'project_memory'],
  ['projectDependencyMonitoringEnabled', true],
  ['projectDependencyMonitoringProviders', ['dependabot']],
  ['projectDependencyMonitoringSchedule', 'weekly'],
  ['projectDependencyMonitoringIssueTemplate', true],
]);
const workspaceStateStore = new Map<string, unknown>();

const directorySet = new Set<string>();
let fileResponses = new Map<string, Uint8Array>();

vi.mock('vscode', () => ({
  workspace: {
    fs: {
      readFile: (...args: unknown[]) => vscodeMocks.mockReadFile(args[0] as { path: string }),
      writeFile: (...args: unknown[]) => vscodeMocks.mockWriteFile(args[0] as { path: string }, args[1] as Uint8Array),
      createDirectory: (...args: unknown[]) => vscodeMocks.mockCreateDirectory(args[0] as { path: string }),
      readDirectory: (...args: unknown[]) => vscodeMocks.mockReadDirectory(args[0] as { path: string }),
      stat: (...args: unknown[]) => vscodeMocks.mockStat(args[0] as { path: string }),
    },
    getConfiguration: () => ({
      get: (key: string, def: unknown) => configurationState.has(key) ? configurationState.get(key) : def,
      update: async (key: string, value: unknown, target: unknown) => {
        configurationState.set(key, value);
        configurationUpdates.push({ key, value, target });
      },
    }),
  },
  Uri: {
    joinPath: (base: { path: string; fsPath: string }, ...segments: string[]) => {
      const joined = [base.path.replace(/\/+$/, ''), ...segments].join('/').replace(/\/+/g, '/');
      return { path: joined, fsPath: joined };
    },
  },
  ConfigurationTarget: {
    Workspace: 1,
    WorkspaceFolder: 2,
    Global: 3,
  },
  window: {
    showQuickPick: vscodeMocks.showQuickPick,
    showInputBox: vscodeMocks.showInputBox,
    showWarningMessage: vscodeMocks.showWarningMessage,
    showInformationMessage: vscodeMocks.showInformationMessage,
    showErrorMessage: vscodeMocks.showErrorMessage,
  },
  commands: {
    executeCommand: vscodeMocks.executeCommand,
  },
  FileType: { File: 1, Directory: 2 },
  default: {},
}));

import { bootstrapProject } from '../../src/bootstrap/bootstrapper.ts';
import type { MemoryEntry } from '../../src/types.ts';

const ROOT = { path: '/workspace', fsPath: '/workspace' };

function seedFile(path: string, content: string): void {
  fileResponses.set(path, Buffer.from(content, 'utf-8'));
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (let index = 0; index < parts.length - 1; index += 1) {
    current += `/${parts[index]}`;
    directorySet.add(current);
  }
}

function setupVirtualFs(): void {
  fileResponses = new Map();
  directorySet.clear();
  directorySet.add('/workspace');

  mockReadFile.mockImplementation(async (uri: { path: string }) => {
    const value = fileResponses.get(uri.path);
    if (!value) {
      throw new Error('ENOENT');
    }
    return value;
  });

  mockWriteFile.mockImplementation(async (uri: { path: string }, data: Uint8Array) => {
    seedFile(uri.path, Buffer.from(data).toString('utf-8'));
  });

  mockCreateDirectory.mockImplementation(async (uri: { path: string }) => {
    directorySet.add(uri.path.replace(/\/+$/, ''));
  });

  mockReadDirectory.mockImplementation(async (uri: { path: string }) => {
    const normalized = uri.path.replace(/\/+$/, '');
    const children = new Map<string, number>();

    for (const dir of directorySet) {
      if (!dir.startsWith(`${normalized}/`)) {
        continue;
      }
      const remainder = dir.slice(normalized.length + 1);
      if (!remainder) {
        continue;
      }
      const [head, ...tail] = remainder.split('/').filter(Boolean);
      if (head) {
        children.set(head, tail.length > 0 ? 2 : 2);
      }
    }

    for (const filePath of fileResponses.keys()) {
      if (!filePath.startsWith(`${normalized}/`)) {
        continue;
      }
      const remainder = filePath.slice(normalized.length + 1);
      const [head, ...tail] = remainder.split('/').filter(Boolean);
      if (!head) {
        continue;
      }
      children.set(head, tail.length > 0 ? 2 : 1);
    }

    return [...children.entries()] as [string, number][];
  });

  mockStat.mockImplementation(async (uri: { path: string }) => {
    const normalized = uri.path.replace(/\/+$/, '');
    if (directorySet.has(normalized) || fileResponses.has(normalized)) {
      return { mtime: Date.now() };
    }
    throw new Error('ENOENT');
  });
}

function makeAtlas() {
  const workspaceState = {
    get: (key: string, fallback?: unknown) => workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback,
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        workspaceStateStore.delete(key);
        return;
      }
      workspaceStateStore.set(key, value);
    }),
  };

  return {
    memoryManager: {
      loadFromDisk: vi.fn(async () => undefined),
      upsert: vi.fn((_entry: MemoryEntry, _content?: string) => ({ status: 'created' as const })),
    },
    memoryRefresh: { fire: vi.fn() },
    extensionContext: {
      workspaceState,
    },
  } as unknown as import('../../src/extension.ts').AtlasMindContext;
}

describe('bootstrapProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockCreateDirectory.mockReset();
    mockReadDirectory.mockReset();
    mockStat.mockReset();
    showQuickPick.mockReset();
    showInputBox.mockReset();
    showWarningMessage.mockReset();
    showInformationMessage.mockReset();
    showErrorMessage.mockReset();
    executeCommand.mockReset();
    configurationUpdates.length = 0;
    configurationState.clear();
    configurationState.set('ssotPath', 'project_memory');
    configurationState.set('projectDependencyMonitoringEnabled', true);
    configurationState.set('projectDependencyMonitoringProviders', ['dependabot']);
    configurationState.set('projectDependencyMonitoringSchedule', 'weekly');
    configurationState.set('projectDependencyMonitoringIssueTemplate', true);
    workspaceStateStore.clear();
    showWarningMessage.mockResolvedValue(undefined);
    setupVirtualFs();
  });

  it('runs the guided intake and seeds SSOT, settings, and GitHub planning artifacts', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('Web App')
      .mockResolvedValueOnce('Fast feedback')
      .mockResolvedValueOnce('Already has an online repo')
      .mockResolvedValueOnce('GitHub')
      .mockResolvedValueOnce('Yes')
      .mockResolvedValueOnce('Yes')
      .mockResolvedValueOnce(['Dependabot', 'Renovate'])
      .mockResolvedValueOnce('Weekly');

    showInputBox
      .mockResolvedValueOnce('Atlas Launchpad')
      .mockResolvedValueOnce('A polished onboarding portal for B2B customers.')
      .mockResolvedValueOnce('Reduce time-to-value during customer onboarding.')
      .mockResolvedValueOnce('A three-person product and platform team.')
      .mockResolvedValueOnce('Private beta in 8 weeks.')
      .mockResolvedValueOnce('Moderate budget with clear ROI expectations.')
      .mockResolvedValueOnce('Activation rate and onboarding completion time.')
      .mockResolvedValueOnce('TypeScript, React, Node.js, PostgreSQL.')
      .mockResolvedValueOnce('Stripe, GitHub Actions, Sentry.');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectSoul = Buffer.from(fileResponses.get('/workspace/project_memory/project_soul.md') ?? []).toString('utf-8');
    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const roadmap = Buffer.from(fileResponses.get('/workspace/project_memory/roadmap/bootstrap-plan.md') ?? []).toString('utf-8');
    const ideationBoard = Buffer.from(fileResponses.get('/workspace/project_memory/ideas/atlas-ideation-board.json') ?? []).toString('utf-8');
    const intakeIssue = Buffer.from(fileResponses.get('/workspace/.github/ISSUE_TEMPLATE/project_intake.yml') ?? []).toString('utf-8');
    const planningCsv = Buffer.from(fileResponses.get('/workspace/.github/project-planning/atlasmind-project-items.csv') ?? []).toString('utf-8');
    const featureRequest = Buffer.from(fileResponses.get('/workspace/.github/ISSUE_TEMPLATE/feature_request.md') ?? []).toString('utf-8');
    const storedProfile = workspaceStateStore.get('atlasmind.personalityProfile') as { answers?: Record<string, unknown> } | undefined;

    expect(projectSoul).toContain('Atlas Launchpad');
    expect(projectSoul).toContain('Reduce time-to-value during customer onboarding.');
    expect(projectBrief).toContain('B2B customers');
    expect(projectBrief).toContain('TypeScript, React, Node.js, PostgreSQL.');
    expect(projectBrief).toContain('Existing online repo');
    expect(repositoryPlan).toContain('Existing online repo');
    expect(repositoryPlan).toContain('github');
    expect(roadmap).toContain('Private beta in 8 weeks.');
    expect(ideationBoard).toContain('Atlas seeded the ideation board from the bootstrap intake.');
    expect(intakeIssue).toContain('Project intake');
    expect(intakeIssue).toContain('A polished onboarding portal for B2B customers.');
    expect(planningCsv).toContain('Validate target audience');
    expect(featureRequest).toContain('Fit With Project Constraints');
    expect(featureRequest).toContain('Moderate budget with clear ROI expectations.');
    expect(storedProfile?.answers?.primaryPurpose).toContain('Atlas Launchpad');
    expect(storedProfile?.answers?.goalHorizon).toBe('project-aware');
    expect(storedProfile?.answers?.goalModelPersistence).toBe('maintain');

    expect(configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'budgetMode', value: 'balanced' }),
      expect.objectContaining({ key: 'speedMode', value: 'fast' }),
      expect.objectContaining({ key: 'projectDependencyMonitoringProviders', value: ['dependabot', 'renovate'] }),
      expect.objectContaining({ key: 'projectDependencyMonitoringSchedule', value: 'weekly' }),
    ]));
    expect(executeCommand).toHaveBeenCalledWith('git.init');
    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalled();
    expect(atlas.memoryRefresh.fire).toHaveBeenCalled();
  });

  it('supports a minimal bootstrap where all project questions are skipped', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'minimal' })
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const intakeLog = Buffer.from(fileResponses.get('/workspace/project_memory/operations/bootstrap-intake.md') ?? []).toString('utf-8');
    const planningCsv = Buffer.from(fileResponses.get('/workspace/.github/project-planning/atlasmind-project-items.csv') ?? []).toString('utf-8');

    expect(projectBrief).toContain('_Not captured during bootstrap._');
    expect(intakeLog).toContain('Mode: minimal');
    expect(planningCsv).toContain('Confirm project brief');
    expect(configurationUpdates.some(update => update.key === 'budgetMode')).toBe(false);
    expect(executeCommand).not.toHaveBeenCalledWith('git.init');
    expect(atlas.memoryManager.loadFromDisk).toHaveBeenCalled();
  });

  it('keeps out-of-turn details and skips later prompts when earlier answers already supplied them', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('Web App')
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    showInputBox
      .mockResolvedValueOnce('Atlas Launchpad')
      .mockResolvedValueOnce('Summary: A polished onboarding portal. Audience: B2B customers. Builders: a three-person platform team. Timeline: 8 weeks. Budget: lean MVP. Stack: TypeScript, React, Node.js, PostgreSQL. Tools: Stripe, GitHub Actions, Sentry. No online repo yet. Repo host: GitHub. Repo location: acme/platform/atlas-launchpad. Atlas speed mode: fast feedback.')
      .mockResolvedValueOnce('Reduce onboarding time and improve activation rate.');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const intakeLog = Buffer.from(fileResponses.get('/workspace/project_memory/operations/bootstrap-intake.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const storedProfile = workspaceStateStore.get('atlasmind.personalityProfile') as { answers?: Record<string, unknown> } | undefined;

    expect(projectBrief).toContain('B2B customers');
    expect(projectBrief).toContain('a three-person platform team');
    expect(projectBrief).toContain('8 weeks');
    expect(projectBrief).toContain('TypeScript, React, Node.js, PostgreSQL');
    expect(projectBrief).toContain('Stripe, GitHub Actions, Sentry');
    expect(projectBrief).toContain('Needs a new online repo');
    expect(projectBrief).toContain('acme/platform/atlas-launchpad');
    expect(configurationUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'budgetMode', value: 'cheap' }),
      expect.objectContaining({ key: 'speedMode', value: 'fast' }),
    ]));
    expect(intakeLog).toContain('Captured target audience from project brief.');
    expect(intakeLog).toContain('Captured tech stack from project brief.');
    expect(intakeLog).toContain('Captured online repo status from project brief.');
    expect(repositoryPlan).toContain('acme/platform/atlas-launchpad');
    expect(storedProfile?.answers?.rememberLongTerm).toContain('Audience: B2B customers');
    expect(showInputBox).toHaveBeenCalledTimes(4);
  });

  it('captures where a missing online repo should be created when the project is not yet hosted', async () => {
    showQuickPick
      .mockResolvedValueOnce({ intakeMode: 'guided' })
      .mockResolvedValueOnce('API Server')
      .mockResolvedValueOnce('Balanced')
      .mockResolvedValueOnce('Needs a new online repo')
      .mockResolvedValueOnce('GitLab')
      .mockResolvedValueOnce('No')
      .mockResolvedValueOnce('No');

    showInputBox
      .mockResolvedValueOnce('Ops API')
      .mockResolvedValueOnce('An internal operations API for field scheduling.')
      .mockResolvedValueOnce('Reduce manual dispatch coordination.')
      .mockResolvedValueOnce('Internal operations coordinators')
      .mockResolvedValueOnce('Platform team')
      .mockResolvedValueOnce('Pilot in 4 weeks')
      .mockResolvedValueOnce('Fixed internal budget')
      .mockResolvedValueOnce('Dispatch turnaround time')
      .mockResolvedValueOnce('TypeScript, Node.js, PostgreSQL')
      .mockResolvedValueOnce('Sentry, Slack')
      .mockResolvedValueOnce('gitlab.company.local/ops/ops-api');

    const atlas = makeAtlas();
    await bootstrapProject(ROOT as any, atlas);

    const projectBrief = Buffer.from(fileResponses.get('/workspace/project_memory/domain/project-brief.md') ?? []).toString('utf-8');
    const repositoryPlan = Buffer.from(fileResponses.get('/workspace/project_memory/operations/repository-plan.md') ?? []).toString('utf-8');
    const roadmap = Buffer.from(fileResponses.get('/workspace/project_memory/roadmap/bootstrap-plan.md') ?? []).toString('utf-8');

    expect(projectBrief).toContain('Needs a new online repo');
    expect(projectBrief).toContain('gitlab.company.local/ops/ops-api');
    expect(repositoryPlan).toContain('Needs a new online repo');
    expect(repositoryPlan).toContain('gitlab (gitlab.company.local/ops/ops-api)');
    expect(roadmap).toContain('Create the online repository on gitlab (gitlab.company.local/ops/ops-api)');
  });
});
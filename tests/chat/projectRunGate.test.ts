import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What has to be true before a project run starts.
 *
 * The planner reads the goal string, memory and the skill catalogue — never the
 * workspace. So on an empty folder it invented subtasks from the wording alone
 * and the executor then searched, read and edited files that did not exist. The
 * snapshot taken immediately before planning already knew: it came back empty
 * and nobody read its size.
 *
 * These run `runProjectCommand` for real, with the planner and orchestrator
 * mocked, because the property worth pinning is *whether they were called at
 * all*.
 */

const vscodeMock = vi.hoisted(() => ({
  workspaceFolders: undefined as unknown,
  files: [] as unknown[],
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() { return vscodeMock.workspaceFolders; },
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
    findFiles: vi.fn(async () => vscodeMock.files),
    asRelativePath: (uri: { path?: string }) => String(uri?.path ?? uri),
    fs: {
      stat: vi.fn(async () => ({ mtime: 1, size: 10 })),
      readFile: vi.fn(async () => new Uint8Array()),
    },
    onDidChangeConfiguration: vi.fn(() => ({ dispose: () => undefined })),
  },
  Uri: { file: (p: string) => ({ fsPath: p, path: p, toString: () => p }) },
  ChatResponseTurn: class {},
  ChatRequestTurn: class {},
  LanguageModelChatMessage: { User: (v: unknown) => v, Assistant: (v: unknown) => v },
  window: { showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
}));

const plan = vi.hoisted(() => vi.fn(async () => ({
  subTasks: [{ id: 's1', title: 'Do the thing', role: 'developer', dependsOn: [] }],
})));

vi.mock('../../src/core/planner.ts', () => ({
  Planner: class { plan = plan; },
}));

vi.mock('../../src/core/taskProfiler.ts', () => ({ TaskProfiler: class {} }));

const { runProjectCommand, toApprovedProjectPrompt } = await import('../../src/chat/participant.ts');

function makeStream() {
  const markdown: string[] = [];
  return {
    markdown: (value: unknown) => { markdown.push(String(value)); },
    progress: () => undefined,
    button: () => undefined,
    anchor: () => undefined,
    reference: () => undefined,
    text: () => markdown.join(''),
  };
}

function makeAtlas(processProject: ReturnType<typeof vi.fn>) {
  return {
    modelRouter: {},
    providerRegistry: {},
    memoryManager: {},
    skillsRegistry: {},
    orchestrator: {
      processProject,
      estimateProjectCost: () => ({ lowUsd: 0, highUsd: 0 }),
    },
  } as never;
}

const TOKEN = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) } as never;

describe('a project run needs somewhere to run', () => {
  let processProject: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    plan.mockClear();
    processProject = vi.fn(async () => ({ subTaskResults: [], summary: '' }));
    vscodeMock.workspaceFolders = [{ uri: { fsPath: '/repo', path: '/repo' } }];
    vscodeMock.files = [];
  });

  it('refuses before planning when no folder is open', async () => {
    vscodeMock.workspaceFolders = undefined;
    const stream = makeStream();

    const outcome = await runProjectCommand('build a parser', stream as never, TOKEN, makeAtlas(processProject));

    // Refused *before* the plan, because planning costs a model call and no plan
    // it produced could be used.
    expect(plan).not.toHaveBeenCalled();
    expect(processProject).not.toHaveBeenCalled();
    expect(stream.text()).toContain('no folder open');
    expect(outcome.approvalRequiredPrompt).toBeUndefined();
  });

  it('asks before running against an empty folder, and says which two things it could mean', async () => {
    const stream = makeStream();

    const outcome = await runProjectCommand('build a parser', stream as never, TOKEN, makeAtlas(processProject));

    // Not a refusal: starting a project in an empty directory is a real thing
    // people do. It is ambiguous, which is what the approval gate is for.
    expect(processProject).not.toHaveBeenCalled();
    expect(stream.text()).toContain('Approval required');
    expect(stream.text()).toContain('empty');
    expect(stream.text()).toContain('the wrong folder is open');
    // The gate hands back the approving prompt, so clearing it is one click
    // rather than retyping a token.
    expect(outcome.approvalRequiredPrompt).toBe(toApprovedProjectPrompt('build a parser'));
  });

  it('proceeds on an empty folder once the run is approved', async () => {
    const stream = makeStream();

    await runProjectCommand(
      toApprovedProjectPrompt('build a parser'), stream as never, TOKEN, makeAtlas(processProject),
    );

    expect(processProject).toHaveBeenCalled();
  });

  it('does not gate a workspace that has files', async () => {
    vscodeMock.files = [{ fsPath: '/repo/src/a.ts', path: '/repo/src/a.ts', toString: () => '/repo/src/a.ts' }];
    const stream = makeStream();

    await runProjectCommand('add a test', stream as never, TOKEN, makeAtlas(processProject));

    expect(stream.text()).not.toContain('Approval required');
    expect(processProject).toHaveBeenCalled();
  });
});

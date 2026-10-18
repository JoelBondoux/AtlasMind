import { describe, expect, it, vi } from 'vitest';
import { Orchestrator } from '../../src/core/orchestrator.ts';
import { AgentRegistry } from '../../src/core/agentRegistry.ts';
import { SkillsRegistry } from '../../src/core/skillsRegistry.ts';
import { ModelRouter } from '../../src/core/modelRouter.ts';
import { MemoryManager } from '../../src/memory/memoryManager.ts';
import { CostTracker } from '../../src/core/costTracker.ts';
import { ProviderRegistry } from '../../src/providers/index.ts';
import { TaskProfiler } from '../../src/core/taskProfiler.ts';
import type {
  AgentDefinition,
  SandboxSessionHandle,
  SkillDefinition,
  SkillExecutionContext,
  ToolApprovalAudit,
  ToolApprovalGateResult,
} from '../../src/types.ts';
import type { CompletionResponse, ProviderAdapter } from '../../src/providers/adapter.ts';

/**
 * A sandbox-conditional approval, through a real Orchestrator. The gate may
 * skip a prompt only for execution bound to the session it checked; these
 * tests hold the Orchestrator to binding it — and to refusing, never running
 * unbound, when it cannot.
 */

const AUDIT: ToolApprovalAudit = {
  rule: 'sandbox-relaxation/relaxed',
  line: '[approval] Ran without asking — run make build. Rule sandbox-relaxation/relaxed.',
  sandboxSessionId: 'sbx-session-1',
  attestationId: 'sbx-att-0123456789ab-x',
  probedAt: '2026-10-08T11:59:00.000Z',
  expiresAt: '2026-10-08T12:09:00.000Z',
  image: `img@sha256:${'0'.repeat(64)}`,
  digest: `sha256:${'0'.repeat(64)}`,
};

function makeSkillContext(withSandbox: boolean) {
  const bound: Array<{ session: SandboxSessionHandle; context: SkillExecutionContext }> = [];
  const base = {
    workspaceRootPath: '/workspace',
    queryMemory: vi.fn().mockResolvedValue([]),
    upsertMemory: vi.fn().mockReturnValue({ status: 'created' }),
    deleteMemory: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue('contents'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    findFiles: vi.fn().mockResolvedValue([]),
    searchInFiles: vi.fn().mockResolvedValue([]),
    listDirectory: vi.fn().mockResolvedValue([]),
    runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: 'unbound', stderr: '' }),
    getGitStatus: vi.fn().mockResolvedValue(''),
    getGitDiff: vi.fn().mockResolvedValue(''),
    getDiagnostics: vi.fn().mockResolvedValue([]),
  } as unknown as SkillExecutionContext;
  if (withSandbox) {
    base.withSandbox = (session: SandboxSessionHandle) => {
      const context = {
        ...base,
        runCommand: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, stdout: `bound:${session.id}`, stderr: '' }),
      } as SkillExecutionContext;
      bound.push({ session, context });
      return context;
    };
  }
  return { context: base, bound };
}

const terminalRun: SkillDefinition = {
  id: 'terminal-run',
  name: 'Run Terminal Command',
  description: 'Run a command.',
  builtIn: true,
  parameters: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
  execute: async (params, context) => {
    const result = await context.runCommand(String(params['command']), (params['args'] as string[]) ?? []);
    return `exit ${result.exitCode}: ${result.stdout}`;
  },
};

function provider(): ProviderAdapter {
  const responses: CompletionResponse[] = [
    {
      content: '',
      model: 'local/echo-1',
      inputTokens: 10,
      outputTokens: 5,
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'call-1', name: 'terminal-run', arguments: { command: 'make', args: ['build'] } }],
    },
    { content: 'Built.', model: 'local/echo-1', inputTokens: 10, outputTokens: 5, finishReason: 'stop' },
  ];
  let call = 0;
  return {
    providerId: 'local',
    complete: vi.fn(() => Promise.resolve(responses[call++] ?? responses.at(-1)!)),
    listModels: vi.fn().mockResolvedValue(['local/echo-1']),
    healthCheck: vi.fn().mockResolvedValue(true),
  };
}

async function run(context: SkillExecutionContext, gate: () => Promise<ToolApprovalGateResult>) {
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
  const providers = new ProviderRegistry();
  providers.register(provider());
  const registry = new SkillsRegistry();
  registry.register(terminalRun);
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
    undefined,
    { toolApprovalGate: vi.fn(gate) } as never,
  );
  const agent: AgentDefinition = {
    id: 'builder',
    name: 'Builder',
    role: 'builder',
    description: 'Builds things.',
    systemPrompt: 'Build it.',
    skills: ['terminal-run'],
  };
  return orchestrator.processTaskWithAgent({
    id: 'task-sandbox-approval',
    userMessage: 'Build the project.',
    context: {},
    constraints: { budget: 'balanced', speed: 'balanced' },
    timestamp: new Date().toISOString(),
  }, agent);
}

describe('a sandbox-conditional approval', () => {
  it('binds the call to the exact session the gate returned, and records the audit in the run', async () => {
    const { context, bound } = makeSkillContext(true);
    const session: SandboxSessionHandle = Object.freeze({ id: 'sbx-session-1', mode: 'require' });
    const result = await run(context, async () => ({ approved: true, sandboxSession: session, audit: AUDIT }));
    expect(bound).toHaveLength(1);
    expect(bound[0]!.session).toBe(session);
    expect(bound[0]!.context.runCommand).toHaveBeenCalledWith('make', ['build']);
    expect(context.runCommand).not.toHaveBeenCalled();
    const call = result.artifacts?.toolCalls.find(entry => entry.toolName === 'terminal-run');
    expect(call?.resultPreview).toContain('bound:sbx-session-1');
    expect(call?.approval).toEqual(AUDIT);
  });

  it('is refused, not run unbound, when the context cannot bind a sandbox session', async () => {
    const { context } = makeSkillContext(false);
    const result = await run(context, async () => ({
      approved: true,
      sandboxSession: { id: 'sbx-session-1', mode: 'require' },
      audit: AUDIT,
    }));
    expect(context.runCommand).not.toHaveBeenCalled();
    const call = result.artifacts?.toolCalls.find(entry => entry.toolName === 'terminal-run');
    expect(call?.resultPreview).toContain('could not be bound to that sandbox session');
    expect(call?.approval).toBeUndefined();
  });

  it('is refused when the session is not a require session — a relaxed approval never reaches the host', async () => {
    const { context, bound } = makeSkillContext(true);
    await run(context, async () => ({ approved: true, sandboxSession: { id: 'sbx-session-off', mode: 'off' } }));
    expect(bound).toHaveLength(0);
    expect(context.runCommand).not.toHaveBeenCalled();
  });

  it('an ordinary approval leaves the context unbound and records no approval audit', async () => {
    const { context, bound } = makeSkillContext(true);
    const result = await run(context, async () => ({ approved: true }));
    expect(bound).toHaveLength(0);
    expect(context.runCommand).toHaveBeenCalledWith('make', ['build']);
    const call = result.artifacts?.toolCalls.find(entry => entry.toolName === 'terminal-run');
    expect(call?.approval).toBeUndefined();
  });
});

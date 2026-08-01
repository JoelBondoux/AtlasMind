import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AcpPermissionBroker,
  AtlasMindAcpAgent,
  extractAcpPromptText,
  type AtlasMindAcpClient,
} from '../../src/acp/atlasMindAcpAgent.ts';

function createRuntime(response = 'AtlasMind answer') {
  const processTaskWithAgent = vi.fn(async (
    _request: unknown,
    _agent: unknown,
    onChunk?: (chunk: string) => void,
  ) => {
    onChunk?.('AtlasMind ');
    onChunk?.('answer');
    return {
      id: 'task-1',
      agentId: 'default',
      modelUsed: 'local/echo',
      response,
      costUsd: 0,
      inputTokens: 3,
      outputTokens: 2,
      durationMs: 1,
    };
  });
  return {
    orchestrator: { processTaskWithAgent },
    agentRegistry: { get: vi.fn(() => ({ id: 'default', name: 'AtlasMind', skills: [] })) },
  } as any;
}

function createClient() {
  const updates: unknown[] = [];
  const client: AtlasMindAcpClient = {
    notify: vi.fn(async (_method, params) => { updates.push(params); }),
    request: vi.fn(async () => ({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    })),
  };
  return { client, updates };
}

describe('AtlasMindAcpAgent', () => {
  it('advertises a stable ACP v1, stdio-safe capability surface', async () => {
    const runtime = createRuntime();
    const agent = new AtlasMindAcpAgent({
      workspaceRoot: path.resolve('C:/workspace'),
      version: '1.0.0',
      runtime,
    });

    await expect(agent.initialize({ protocolVersion: 1 } as any)).resolves.toMatchObject({
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
      },
      agentInfo: {
        name: 'atlasmind',
        title: 'AtlasMind',
        version: '1.0.0',
      },
    });
  });

  it('rejects sessions whose cwd escapes the configured workspace', async () => {
    const workspaceRoot = path.resolve('C:/workspace');
    const agent = new AtlasMindAcpAgent({
      workspaceRoot,
      version: '1.0.0',
      runtime: createRuntime(),
    });

    await expect(agent.newSession({
      cwd: path.resolve('C:/other'),
      mcpServers: [],
    } as any)).rejects.toThrow(/outside the configured workspace/i);
  });

  it('streams a prompt through the AtlasMind orchestrator and keeps bounded session context', async () => {
    const runtime = createRuntime();
    const { client, updates } = createClient();
    const workspaceRoot = path.resolve('C:/workspace');
    const agent = new AtlasMindAcpAgent({
      workspaceRoot,
      version: '1.0.0',
      runtime,
    });
    const { sessionId } = await agent.newSession({ cwd: workspaceRoot, mcpServers: [] } as any);

    await expect(agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'What is the roadmap?' }],
    } as any, client)).resolves.toEqual({ stopReason: 'end_turn' });

    expect(runtime.orchestrator.processTaskWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'What is the roadmap?',
        context: expect.objectContaining({ interface: 'acp' }),
        signal: expect.any(AbortSignal),
      }),
      expect.objectContaining({ id: 'default' }),
      expect.any(Function),
      expect.any(Function),
    );
    expect(updates).toEqual([
      {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'AtlasMind ' },
        },
      },
      {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'answer' },
        },
      },
    ]);
  });

  it('propagates session cancellation to the in-flight orchestrator request', async () => {
    let seenSignal: AbortSignal | undefined;
    const runtime = createRuntime();
    runtime.orchestrator.processTaskWithAgent = vi.fn(async (request: any) => {
      seenSignal = request.signal;
      await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true }));
      return {
        id: request.id,
        agentId: 'default',
        modelUsed: 'local/echo',
        response: '',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      };
    });
    const workspaceRoot = path.resolve('C:/workspace');
    const agent = new AtlasMindAcpAgent({ workspaceRoot, version: '1.0.0', runtime });
    const { sessionId } = await agent.newSession({ cwd: workspaceRoot, mcpServers: [] } as any);
    const { client } = createClient();

    const pending = agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'wait' }],
    } as any, client);
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    await agent.cancel({ sessionId } as any);

    await expect(pending).resolves.toEqual({ stopReason: 'cancelled' });
    expect(seenSignal?.aborted).toBe(true);
  });

  it('refuses concurrent sessions instead of racing shared orchestrator state', async () => {
    let release!: () => void;
    const runtime = createRuntime();
    runtime.orchestrator.processTaskWithAgent = vi.fn(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return {
        id: 'task',
        agentId: 'default',
        modelUsed: 'local/echo',
        response: 'done',
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 1,
      };
    });
    const workspaceRoot = path.resolve('C:/workspace');
    const agent = new AtlasMindAcpAgent({ workspaceRoot, version: '1.0.0', runtime });
    const first = await agent.newSession({ cwd: workspaceRoot, mcpServers: [] } as any);
    const second = await agent.newSession({ cwd: workspaceRoot, mcpServers: [] } as any);
    const { client } = createClient();

    const active = agent.prompt({
      sessionId: first.sessionId,
      prompt: [{ type: 'text', text: 'first' }],
    } as any, client);
    await vi.waitFor(() => expect(runtime.orchestrator.processTaskWithAgent).toHaveBeenCalled());
    await expect(agent.prompt({
      sessionId: second.sessionId,
      prompt: [{ type: 'text', text: 'second' }],
    } as any, client)).rejects.toThrow(/already processing/i);

    release();
    await active;
  });
});

describe('extractAcpPromptText', () => {
  it('accepts bounded text blocks and rejects a prompt with no usable text', () => {
    expect(extractAcpPromptText([
      { type: 'text', text: 'first' },
      { type: 'image', data: 'ignored', mimeType: 'image/png' },
      { type: 'text', text: 'second' },
    ] as any)).toBe('first\n\nsecond');
    expect(() => extractAcpPromptText([{ type: 'image', data: 'x', mimeType: 'image/png' }] as any))
      .toThrow(/text content/i);
  });
});

describe('AcpPermissionBroker', () => {
  it('fails closed without an active ACP prompt context', async () => {
    const broker = new AcpPermissionBroker();

    await expect(broker.authorize('unknown-task', 'file-write', {
      path: path.resolve('C:/workspace/file.txt'),
      content: 'change',
    })).resolves.toMatchObject({ approved: false });
  });

  it('auto-allows read-only tools and requires a one-time client grant for writes', async () => {
    const broker = new AcpPermissionBroker();
    const { client } = createClient();
    broker.register('task-1', 'session-1', client);

    await expect(broker.authorize('task-1', 'file-read', {
      path: path.resolve('C:/workspace/file.txt'),
    })).resolves.toEqual({ approved: true });
    await expect(broker.authorize('task-1', 'file-write', {
      path: path.resolve('C:/workspace/file.txt'),
      content: 'change',
    })).resolves.toEqual({ approved: true });

    expect(client.request).toHaveBeenCalledWith(
      'session/request_permission',
      expect.objectContaining({
        sessionId: 'session-1',
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      }),
    );
  });

  it('never treats allow-always or malformed outcomes as authority', async () => {
    const broker = new AcpPermissionBroker();
    const client: AtlasMindAcpClient = {
      notify: vi.fn(async () => undefined),
      request: vi.fn(async () => ({
        outcome: { outcome: 'selected', optionId: 'allow-always' },
      })),
    };
    broker.register('task-1', 'session-1', client);

    await expect(broker.authorize('task-1', 'terminal', {
      command: 'npm publish',
    })).resolves.toMatchObject({ approved: false });
  });
});

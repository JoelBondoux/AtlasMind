import { beforeEach, describe, expect, it } from 'vitest';
import {
  AcpAdapter,
  buildPromptBlocks,
  parseAcpAgentSettings,
  resetAcpProbeCache,
  VERIFIED_ACP_AGENTS,
  SELF_INSTALLED_ACP_AGENTS,
  ACP_PROVIDER_BRIDGES,
  findAcpBridge,
  type AcpAgentConfig,
  type AcpProcessFactory,
  type AcpProcessHandle,
} from '../../src/providers/acp.ts';
import type { CompletionRequest } from '../../src/providers/adapter.ts';

/**
 * A fake ACP agent. Records what AtlasMind wrote and replies with whatever the
 * scenario dictates, so the whole state machine runs without spawning anything.
 */
class FakeAgent implements AcpProcessHandle {
  readonly written: Record<string, unknown>[] = [];
  private stdout: ((chunk: string) => void) | undefined;
  private exit: ((code: number | null, signal: string | null) => void) | undefined;
  killed = false;

  constructor(private readonly respond: (agent: FakeAgent, frame: Record<string, unknown>) => void) {}

  writeLine(line: string): void {
    const frame = JSON.parse(line) as Record<string, unknown>;
    this.written.push(frame);
    // Reply asynchronously, like a real subprocess would.
    queueMicrotask(() => this.respond(this, frame));
  }

  onStdout(listener: (chunk: string) => void): void { this.stdout = listener; }
  onStderr(): void { /* not used by these scenarios */ }
  onExit(listener: (code: number | null, signal: string | null) => void): void { this.exit = listener; }
  kill(): void { this.killed = true; }

  /** Push raw text to the client, exactly as stdout would deliver it. */
  emit(text: string): void { this.stdout?.(text); }
  emitFrame(frame: unknown): void { this.emit(`${JSON.stringify(frame)}\n`); }
  die(code: number): void { this.exit?.(code, null); }

  method(name: string): Record<string, unknown> | undefined {
    return this.written.find(frame => frame['method'] === name);
  }
}

const INITIALIZE_OK = {
  protocolVersion: 1,
  agentCapabilities: { promptCapabilities: { image: true } },
  agentInfo: { name: 'fake-agent', version: '1.0.0' },
  authMethods: [],
};

/** A scripted happy-path agent: handshake, session, then a streamed reply. */
function scriptedAgent(options?: {
  initialize?: Record<string, unknown>;
  chunks?: string[];
  stopReason?: string;
  /**
   * Token counts, sent where real agents send them: on the `session/prompt`
   * **result**, not in a `usage_update` notification.
   */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Context occupancy, in the shape the spec's `usage_update` defines. */
  context?: { used: number; size: number };
  /** Refuse `session/new` with ACP's reserved auth-required code. */
  authRequired?: boolean;
}): { factory: AcpProcessFactory; agents: FakeAgent[] } {
  const agents: FakeAgent[] = [];
  const factory: AcpProcessFactory = () => {
    const agent = new FakeAgent((self, frame) => {
      const id = frame['id'];
      switch (frame['method']) {
        case 'initialize':
          self.emitFrame({ jsonrpc: '2.0', id, result: options?.initialize ?? INITIALIZE_OK });
          return;
        case 'session/new':
          if (options?.authRequired) {
            self.emitFrame({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Authentication required' } });
            return;
          }
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1' } });
          return;
        case 'session/prompt': {
          for (const chunk of options?.chunks ?? ['Hello ', 'world']) {
            self.emitFrame({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: 'sess_1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } },
            });
          }
          if (options?.context) {
            self.emitFrame({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: 'sess_1', update: { sessionUpdate: 'usage_update', ...options.context } },
            });
          }
          self.emitFrame({
            jsonrpc: '2.0',
            id,
            result: {
              stopReason: options?.stopReason ?? 'end_turn',
              ...(options?.usage ? { usage: options.usage } : {}),
            },
          });
          return;
        }
        default:
          return;
      }
    });
    agents.push(agent);
    return agent;
  };
  return { factory, agents };
}

const AGENT: AcpAgentConfig = { id: 'fake', command: 'fake-agent-acp' };

const request = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: 'acp/fake',
  messages: [{ role: 'user', content: 'Say hello' }],
  ...over,
});

beforeEach(() => resetAcpProbeCache());

/**
 * An agent that advertises config options and honours `session/set_config_option`,
 * shaped like the live `claude-agent-acp` / `codex-acp` responses.
 */
function configurableAgent(options?: { effortId?: string; refuseSet?: boolean; ignoreSet?: boolean }) {
  const effortId = options?.effortId ?? 'effort';
  const state: Record<string, string> = { mode: 'default', model: 'opus', [effortId]: 'default' };
  const configOptions = () => [
    { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: state['mode'], options: [{ value: 'default', name: 'Manual' }, { value: 'bypassPermissions', name: 'Bypass' }] },
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: state['model'], options: [{ value: 'opus', name: 'Opus' }, { value: 'haiku', name: 'Haiku' }] },
    { id: effortId, name: 'Effort', category: 'thought_level', type: 'select', currentValue: state[effortId], options: [{ value: 'default', name: 'Default' }, { value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
  ];
  const agents: FakeAgent[] = [];
  const factory: AcpProcessFactory = () => {
    const agent = new FakeAgent((self, frame) => {
      const id = frame['id'];
      const params = (frame['params'] ?? {}) as Record<string, unknown>;
      switch (frame['method']) {
        case 'initialize':
          self.emitFrame({ jsonrpc: '2.0', id, result: INITIALIZE_OK });
          return;
        case 'session/new':
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1', configOptions: configOptions() } });
          return;
        case 'session/set_config_option': {
          if (options?.refuseSet) {
            self.emitFrame({ jsonrpc: '2.0', id, error: { code: -32602, message: 'not supported' } });
            return;
          }
          if (!options?.ignoreSet) {
            state[String(params['configId'])] = String(params['value']);
          }
          self.emitFrame({ jsonrpc: '2.0', id, result: { configOptions: configOptions() } });
          return;
        }
        case 'session/prompt':
          self.emitFrame({
            jsonrpc: '2.0', method: 'session/update',
            params: { sessionId: 'sess_1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } } },
          });
          self.emitFrame({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
          return;
        default:
          return;
      }
    });
    agents.push(agent);
    return agent;
  };
  return { factory, agents, state };
}

describe('AcpAdapter — a full turn', () => {
  it('completes a prompt and returns the assembled text', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], cwd: '/work', spawnProcess: factory });

    const response = await adapter.complete(request());

    expect(response.content).toBe('Hello world');
    expect(response.finishReason).toBe('stop');
    expect(response.model).toBe('acp/fake');
    // Handshake happened in the order the spec requires.
    expect(agents[0]!.written.map(frame => frame['method'])).toEqual(['initialize', 'session/new', 'session/prompt']);
  });

  it('streams each chunk as it arrives — the thing the old argv bridge could not do', async () => {
    const { factory } = scriptedAgent({ chunks: ['one ', 'two ', 'three'] });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    const seen: string[] = [];

    const response = await adapter.streamComplete(request(), chunk => seen.push(chunk));

    expect(seen).toEqual(['one ', 'two ', 'three']);
    expect(response.content).toBe('one two three');
  });

  it('reports token usage from the prompt result, and zero when it does not', async () => {
    const withUsage = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent({ usage: { inputTokens: 120, outputTokens: 8 } }).factory });
    const counted = await withUsage.complete(request());
    expect(counted).toMatchObject({ inputTokens: 120, outputTokens: 8 });

    // Absent counts stay zero rather than being estimated — a fabricated token
    // count would feed the cost tracker a number nobody measured.
    const withoutUsage = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent().factory });
    expect(await withoutUsage.complete(request())).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  /**
   * The regression that made every ACP completion look free.
   *
   * `usage_update` reports how full the context is, cumulatively. Charging its
   * `used` figure as this turn's input tokens would re-bill the entire
   * conversation on every message — so a turn that sends context but no result
   * usage must still report zero, not 60,750.
   */
  it('never bills context occupancy as the turn\'s tokens', async () => {
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: scriptedAgent({ context: { used: 60_750, size: 1_000_000 } }).factory,
    });
    expect(await adapter.complete(request())).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('carries a prompt far larger than the old argv ceiling, intact', async () => {
    // The regression the roadmap asks for: >26,000 characters, which the argv
    // bridge silently truncates and stdio does not.
    const huge = 'x'.repeat(60_000);
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await adapter.complete(request({ messages: [{ role: 'user', content: huge }] }));

    const prompt = agents[0]!.method('session/prompt');
    const blocks = (prompt!['params'] as { prompt: Array<{ text?: string }> }).prompt;
    expect(blocks[0]!.text).toContain(huge);
    expect(blocks[0]!.text!.length).toBeGreaterThan(60_000);
  });

  it('maps a truncated turn to length and a refusal to error', async () => {
    const truncated = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent({ stopReason: 'max_tokens' }).factory });
    expect((await truncated.complete(request())).finishReason).toBe('length');

    const refused = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent({ stopReason: 'refusal' }).factory });
    expect((await refused.complete(request())).finishReason).toBe('error');
  });

  it('kills the agent process when the turn is done', async () => {
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());
    expect(agents[0]!.killed).toBe(true);
  });
});

describe('AcpAdapter — live-session reuse without duplicate prompts', () => {
  it('keeps one process and sends only the transcript suffix on the next turn', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });

    const first = await adapter.complete(request());
    await adapter.complete(request({
      messages: [
        { role: 'user', content: 'Say hello' },
        { role: 'assistant', content: first.content },
        { role: 'user', content: 'Now say goodbye' },
      ],
    }));

    expect(agents).toHaveLength(1);
    const prompts = agents[0]!.written.filter(frame => frame['method'] === 'session/prompt');
    expect(prompts).toHaveLength(2);
    const secondBlocks = (prompts[1]!['params'] as { prompt: Array<{ text?: string }> }).prompt;
    expect(secondBlocks[0]!.text).toContain('Now say goodbye');
    expect(secondBlocks[0]!.text).not.toContain('Say hello');
    expect(secondBlocks[0]!.text).not.toContain(first.content);
    expect(agents[0]!.killed).toBe(false);

    await adapter.shutdown();
    expect(agents[0]!.killed).toBe(true);
  });

  it('opens a new session for an edited or branched transcript', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });

    await adapter.complete(request());
    await adapter.complete(request({ messages: [{ role: 'user', content: 'A different branch' }] }));

    expect(agents).toHaveLength(2);
    await adapter.shutdown();
  });

  it('coalesces concurrent duplicates and briefly replays a completed retry', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });
    const seen: string[] = [];

    const [first, duplicate] = await Promise.all([
      adapter.streamComplete(request({ requestId: 'task-1:turn-1' }), chunk => seen.push(chunk)),
      adapter.complete(request({ requestId: 'task-1:turn-1' })),
    ]);
    const replay = await adapter.complete(request({ requestId: 'task-1:turn-1' }));

    expect(duplicate).toEqual(first);
    expect(replay).toEqual(first);
    expect(seen.join('')).toBe('Hello world');
    expect(agents).toHaveLength(1);
    expect(agents[0]!.written.filter(frame => frame['method'] === 'session/prompt')).toHaveLength(1);
    await adapter.shutdown();
  });

  it('does not merge independent requests merely because their words match', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });

    await adapter.complete(request({ requestId: 'chat-a:turn-1' }));
    await adapter.complete(request({ requestId: 'chat-b:turn-1' }));

    expect(agents).toHaveLength(2);
    expect(agents[0]!.written.filter(frame => frame['method'] === 'session/prompt')).toHaveLength(1);
    expect(agents[1]!.written.filter(frame => frame['method'] === 'session/prompt')).toHaveLength(1);
    await adapter.shutdown();
  });

  it('reports the count of active private-desktop sessions without exposing session details', async () => {
    const { factory } = scriptedAgent();
    const summaries: Array<{ total: number; ordinary: number; privateDesktop: number }> = [];
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      hideConsoleWindows: true,
      settingsStamp: () => 'stable',
      onLiveSessionChange: summary => summaries.push(summary),
    });

    await adapter.complete(request());
    expect(summaries).toContainEqual({ total: 1, ordinary: 0, privateDesktop: 1 });

    await adapter.shutdown();
    expect(summaries.at(-1)).toEqual({ total: 0, ordinary: 0, privateDesktop: 0 });
  });

  it('launches the probe on the private desktop too, not just a turn', async () => {
    // The bug this pins: `handshakeOnly` built its session without launch
    // options, so `wrapAcpLaunchForPrivateDesktop` saw `requested: false` and
    // started the agent — and every console its descendants allocate — on the
    // user's visible desktop while `hideConsoleWindows` was ticked. The probe is
    // the most frequently launched of the three paths (any panel or tree
    // refresh past the TTL relaunches it), so it was also the one the user saw.
    const { factory } = scriptedAgent();
    const launchModes: Array<boolean | undefined> = [];
    const recordingFactory: AcpProcessFactory = (agent, cwd, options) => {
      launchModes.push(options?.privateDesktop);
      return factory(agent, cwd, options);
    };

    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: recordingFactory,
      hideConsoleWindows: true,
    }).probe();

    expect(launchModes).toEqual([true]);
  });

  it('leaves the probe on the ordinary desktop when the setting is off', async () => {
    const { factory } = scriptedAgent();
    const launchModes: Array<boolean | undefined> = [];
    const recordingFactory: AcpProcessFactory = (agent, cwd, options) => {
      launchModes.push(options?.privateDesktop);
      return factory(agent, cwd, options);
    };

    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: recordingFactory,
      hideConsoleWindows: false,
    }).probe();

    expect(launchModes).toEqual([false]);
  });

  it('refuses every spawn until the Windows console-mode choice is recorded', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      consoleModeChosen: false,
    });

    await expect(adapter.complete(request())).rejects.toThrow(/Choose ACP Console Window Behaviour/i);
    expect(agents).toHaveLength(0);
  });

  it('cancels and discards an uncertain live prompt when its attempt is aborted', async () => {
    const controller = new AbortController();
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        const id = frame['id'];
        if (frame['method'] === 'initialize') {
          self.emitFrame({ jsonrpc: '2.0', id, result: INITIALIZE_OK });
        } else if (frame['method'] === 'session/new') {
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_abort' } });
        } else if (frame['method'] === 'session/prompt') {
          // Abort only after the prompt crossed the fake pipe. No prompt result
          // follows, reproducing the timeout race this test protects.
          controller.abort();
        }
      });
      agents.push(agent);
      return agent;
    };
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });

    await expect(adapter.complete(request({ signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.method('session/cancel')).toBeDefined();
    expect(agents[0]!.killed).toBe(true);
    await adapter.shutdown();
  });

  it('tears down immediately when an attempt is aborted during the ACP handshake', async () => {
    for (const keepAlive of [false, true]) {
      const controller = new AbortController();
      const agents: FakeAgent[] = [];
      const factory: AcpProcessFactory = () => {
        const agent = new FakeAgent((_self, frame) => {
          if (frame['method'] === 'initialize') {
            // No initialize response follows. Disposal must reject the pending
            // JSON-RPC call itself rather than waiting for its long timeout.
            controller.abort();
          }
        });
        agents.push(agent);
        return agent;
      };
      const adapter = new AcpAdapter({
        agents: [AGENT],
        spawnProcess: factory,
        keepAlive,
        settingsStamp: () => 'stable',
      });

      await expect(adapter.complete(request({ signal: controller.signal })))
        .rejects.toMatchObject({ name: 'AbortError' });
      expect(agents).toHaveLength(1);
      expect(agents[0]!.written.map(frame => frame['method'])).toEqual(['initialize']);
      expect(agents[0]!.killed).toBe(true);
      await adapter.shutdown();
    }
  });

  it('does not send a prompt after an attempt is aborted while applying session config', async () => {
    const controller = new AbortController();
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        const id = frame['id'];
        if (frame['method'] === 'initialize') {
          self.emitFrame({ jsonrpc: '2.0', id, result: INITIALIZE_OK });
        } else if (frame['method'] === 'session/new') {
          self.emitFrame({
            jsonrpc: '2.0',
            id,
            result: {
              sessionId: 'sess_config_abort',
              configOptions: [{
                id: 'effort',
                name: 'Effort',
                category: 'thought_level',
                type: 'select',
                currentValue: 'default',
                options: [{ value: 'default', name: 'Default' }, { value: 'high', name: 'High' }],
              }],
            },
          });
        } else if (frame['method'] === 'session/set_config_option') {
          controller.abort();
        }
      });
      agents.push(agent);
      return agent;
    };
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      keepAlive: true,
      settingsStamp: () => 'stable',
    });

    await expect(adapter.complete(request({ model: 'acp/fake#high', signal: controller.signal })))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(agents[0]!.method('session/set_config_option')).toBeDefined();
    expect(agents[0]!.method('session/prompt')).toBeUndefined();
    expect(agents[0]!.killed).toBe(true);
    await adapter.shutdown();
  });

  it('invalidates a live process when startup settings or launch mode change', async () => {
    const { factory, agents } = scriptedAgent();
    let stamp = 'one';
    let hidden = false;
    const launchModes: Array<boolean | undefined> = [];
    const recordingFactory: AcpProcessFactory = (agent, cwd, options) => {
      launchModes.push(options?.privateDesktop);
      return factory(agent, cwd, options);
    };
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: recordingFactory,
      keepAlive: true,
      settingsStamp: () => stamp,
      hideConsoleWindows: () => hidden,
    });

    const first = await adapter.complete(request());
    stamp = 'two';
    hidden = true;
    await adapter.complete(request({
      messages: [
        { role: 'user', content: 'Say hello' },
        { role: 'assistant', content: first.content },
        { role: 'user', content: 'Continue' },
      ],
    }));

    expect(agents).toHaveLength(2);
    expect(launchModes).toEqual([false, true]);
    expect(agents[0]!.killed).toBe(true);
    await adapter.shutdown();
  });
});

describe('AcpAdapter — restricted mode is the security boundary', () => {
  it('declares no filesystem and no terminal capability, and no MCP servers', async () => {
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], cwd: '/work', spawnProcess: factory }).complete(request());

    const init = agents[0]!.method('initialize')!['params'] as Record<string, unknown>;
    expect(init['clientCapabilities']).toEqual({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });

    const session = agents[0]!.method('session/new')!['params'] as Record<string, unknown>;
    expect(session['mcpServers']).toEqual([]);
    expect(session['cwd']).toBe('/work');
  });

  it('FAILS CLOSED on a permission request it cannot parse', async () => {
    // The request below has no `toolCallId`, so it cannot be read. Answering a
    // request whose contents are unknown would be authorizing an unknown
    // operation, so it must be refused rather than guessed at.
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        if (frame['method'] === 'initialize') {
          self.emitFrame({ jsonrpc: '2.0', id: frame['id'], result: INITIALIZE_OK });
        } else if (frame['method'] === 'session/new') {
          self.emitFrame({ jsonrpc: '2.0', id: frame['id'], result: { sessionId: 'sess_1' } });
        } else if (frame['method'] === 'session/prompt') {
          // The agent asks for permission mid-turn, then gives up.
          self.emitFrame({ jsonrpc: '2.0', id: 99, method: 'session/request_permission', params: { toolCall: { name: 'write' } } });
          self.emitFrame({ jsonrpc: '2.0', id: frame['id'], result: { stopReason: 'end_turn' } });
        }
      });
      agents.push(agent);
      return agent;
    };

    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());

    const reply = agents[0]!.written.find(frame => frame['id'] === 99);
    expect(reply).toBeDefined();
    // A JSON-RPC error — never a granted permission.
    expect(reply!['error']).toBeDefined();
    expect(reply!['result']).toBeUndefined();
    expect(JSON.stringify(reply)).not.toMatch(/allow|granted|approved/i);
  });

  it('refuses AtlasMind\'s own tool definitions rather than ignoring them', async () => {
    // Distinct from the agent's own tools, which Tier 3 does enable: ACP has no
    // channel for injecting a client's function schemas into a turn, so this
    // refusal holds however much delegation is switched on.
    const { factory } = scriptedAgent();
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => true,
    });
    await expect(adapter.complete(request({
      tools: [{ name: 'read_file', description: 'read', parameters: {} }],
    }))).rejects.toThrow(/cannot run AtlasMind's own tool definitions/i);
  });

  /**
   * The bug that stopped the ChatGPT subscription path working at all.
   *
   * `codex-acp` advertises `api-key` and `chat-gpt` on **every** handshake,
   * signed in or not. The previous version read that non-empty list as "not
   * authenticated" and threw before ever asking the agent to do anything — so a
   * user who was correctly signed in was told they were not, with no way to make
   * the message go away.
   */
  it('runs normally for an agent that advertises logins the user does not owe', async () => {
    const { factory } = scriptedAgent({
      initialize: { ...INITIALIZE_OK, authMethods: [{ id: 'api-key' }, { id: 'chat-gpt' }] },
    });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    const response = await adapter.complete(request());

    expect(response.content).toBe('Hello world');
    expect(response.finishReason).toBe('stop');
  });

  it('refuses with a sign-in message only when session/new says authentication is required', async () => {
    const { factory } = scriptedAgent({
      initialize: { ...INITIALIZE_OK, authMethods: [{ id: 'chat-gpt' }] },
      authRequired: true,
    });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    // Names the login to run, and says AtlasMind never handles the credential.
    await expect(adapter.complete(request())).rejects.toThrow(/needs you to sign in.*chat-gpt/is);
  });

  it('does not dress an ordinary session failure up as an authentication problem', async () => {
    // A crashed agent reported as "sign in" sends the user to a login that
    // cannot help. -32603 is not -32000.
    const factory: AcpProcessFactory = () => new FakeAgent((self, frame) => {
      if (frame['method'] === 'initialize') {
        self.emitFrame({ jsonrpc: '2.0', id: frame['id'], result: INITIALIZE_OK });
        return;
      }
      if (frame['method'] === 'session/new') {
        self.emitFrame({ jsonrpc: '2.0', id: frame['id'], error: { code: -32603, message: 'disk on fire' } });
      }
    });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await expect(adapter.complete(request())).rejects.toThrow(/disk on fire/);
    await expect(adapter.complete(request())).rejects.not.toThrow(/sign in/i);
  });

  it('refuses to run against an incompatible protocol version', async () => {
    const { factory } = scriptedAgent({ initialize: { ...INITIALIZE_OK, protocolVersion: 99 } });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await expect(adapter.complete(request())).rejects.toThrow(/ACP version 99/);
  });

  it('surfaces an agent that dies mid-handshake rather than hanging', async () => {
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent(self => queueMicrotask(() => self.die(1)));
      return agent;
    };
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await expect(adapter.complete(request())).rejects.toThrow(/exited/i);
  });
});

/**
 * A permission-requesting agent: handshake, session, then one tool call that
 * asks for authorization before the turn ends.
 */
function permissionAgent(options?: {
  options?: Array<{ optionId: string; name: string; kind: string }>;
  toolCall?: Record<string, unknown>;
}): { factory: AcpProcessFactory; agents: FakeAgent[] } {
  const agents: FakeAgent[] = [];
  const factory: AcpProcessFactory = () => {
    const agent = new FakeAgent((self, frame) => {
      const id = frame['id'];
      switch (frame['method']) {
        case 'initialize':
          self.emitFrame({ jsonrpc: '2.0', id, result: INITIALIZE_OK });
          return;
        case 'session/new':
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1' } });
          return;
        case 'session/prompt':
          self.emitFrame({
            jsonrpc: '2.0',
            id: 77,
            method: 'session/request_permission',
            params: {
              sessionId: 'sess_1',
              toolCall: options?.toolCall ?? { toolCallId: 'call_1', title: 'Run the build', kind: 'execute', status: 'pending' },
              options: options?.options ?? [
                { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
                { optionId: 'no', name: 'Reject', kind: 'reject_once' },
              ],
            },
          });
          self.emitFrame({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
          return;
        default:
          return;
      }
    });
    agents.push(agent);
    return agent;
  };
  return { factory, agents };
}

/** The outcome the agent was sent for permission request id 77. */
function permissionOutcome(agent: FakeAgent): Record<string, unknown> | undefined {
  const reply = agent.written.find(frame => frame['id'] === 77);
  const result = reply?.['result'] as { outcome?: Record<string, unknown> } | undefined;
  return result?.outcome;
}

describe('AcpAdapter — delegated execution is never delegated authorization', () => {
  it('refuses a readable permission request when NO policy is wired', async () => {
    // The load-bearing default. A caller that enables tools but forgets the gate
    // must get an agent that cannot act, not one that acts unsupervised.
    const { factory, agents } = permissionAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());

    const reply = agents[0]!.written.find(frame => frame['id'] === 77);
    expect(reply!['error']).toBeDefined();
    expect(permissionOutcome(agents[0]!)).toBeUndefined();
  });

  it('selects a reject option when the policy declines', async () => {
    const { factory, agents } = permissionAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => false,
    }).complete(request());

    expect(permissionOutcome(agents[0]!)).toEqual({ outcome: 'selected', optionId: 'no' });
  });

  it('selects allow_once — never allow_always — when the policy approves', async () => {
    // "Always" chosen on the wire is remembered inside the agent, where the user
    // cannot see or revoke it. AtlasMind keeps that decision on its own side.
    const { factory, agents } = permissionAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => true,
    }).complete(request());

    expect(permissionOutcome(agents[0]!)).toEqual({ outcome: 'selected', optionId: 'once' });
  });

  it('declines rather than granting when the ONLY way to allow is permanent', async () => {
    const { factory, agents } = permissionAgent({
      options: [
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => true,
    }).complete(request());

    expect(permissionOutcome(agents[0]!)).toEqual({ outcome: 'selected', optionId: 'no' });
  });

  it('treats a policy that throws as a refusal', async () => {
    const { factory, agents } = permissionAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => { throw new Error('dialog blew up'); },
    }).complete(request());

    expect(permissionOutcome(agents[0]!)).toEqual({ outcome: 'selected', optionId: 'no' });
  });

  it('shows the user the tool call the agent asked to run', async () => {
    const seen: string[] = [];
    const { factory } = permissionAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => false,
      onToolEvent: event => seen.push(`${event.kind}:${event.title}`),
    }).complete(request());

    expect(seen).toContain('execute:Run the build');
  });

  it('still refuses fs and terminal requests, which it never claimed to support', async () => {
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        const id = frame['id'];
        if (frame['method'] === 'initialize') {
          self.emitFrame({ jsonrpc: '2.0', id, result: INITIALIZE_OK });
        } else if (frame['method'] === 'session/new') {
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1' } });
        } else if (frame['method'] === 'session/prompt') {
          self.emitFrame({ jsonrpc: '2.0', id: 55, method: 'fs/write_text_file', params: { path: '/etc/passwd', content: 'x' } });
          self.emitFrame({ jsonrpc: '2.0', id: 56, method: 'terminal/create', params: { command: 'rm -rf /' } });
          self.emitFrame({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
        }
      });
      agents.push(agent);
      return agent;
    };

    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      permissionPolicy: async () => true,
    }).complete(request());

    for (const id of [55, 56]) {
      const reply = agents[0]!.written.find(frame => frame['id'] === id);
      expect((reply!['error'] as { code: number }).code).toBe(-32601);
    }
  });

  it('hands over only the MCP servers it was given, and none by default', async () => {
    const { factory: bare, agents: bareAgents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: bare }).complete(request());
    expect((bareAgents[0]!.method('session/new')!['params'] as Record<string, unknown>)['mcpServers']).toEqual([]);

    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      getMcpServers: () => [{ name: 'docs', command: 'npx', args: ['-y', 'server'], env: [{ name: 'MODE', value: 'ro' }] }],
    }).complete(request());

    const params = agents[0]!.method('session/new')!['params'] as Record<string, unknown>;
    // Stdio entries are `#[serde(untagged)]` — a `type` field would break them.
    expect(params['mcpServers']).toEqual([
      { name: 'docs', command: 'npx', args: ['-y', 'server'], env: [{ name: 'MODE', value: 'ro' }] },
    ]);
  });
});

describe('AcpAdapter — discovery and probing', () => {
  it('lists nothing when no agent is configured, and never spawns', async () => {
    let spawned = 0;
    const adapter = new AcpAdapter({ agents: [], spawnProcess: () => { spawned += 1; throw new Error('should not spawn'); } });
    expect(await adapter.listModels()).toEqual([]);
    expect(await adapter.discoverModels()).toEqual([]);
    expect(await adapter.healthCheck()).toBe(false);
    expect(spawned).toBe(0);
  });

  it('is healthy when any configured agent works, not only the first', async () => {
    // The bug this pins: `healthCheck` probed `agents[0]` and reported its
    // answer as the provider's. Order in a settings array says nothing about
    // which subscription matters, so a broken first agent condemned a working
    // second one — and every ACP model, including the working agent's, was
    // dropped from routing.
    const working = scriptedAgent().factory;
    const adapter = new AcpAdapter({
      agents: [{ id: 'broken', command: 'missing-acp' }, { id: 'fine', command: 'fake-agent-acp' }],
      spawnProcess: agent => {
        if (agent.command === 'missing-acp') { throw new Error('spawn missing-acp ENOENT'); }
        return working(agent);
      },
    });

    expect(await adapter.healthCheck()).toBe(true);
  });

  it('reports each agent separately, so a vendor row cannot inherit another vendor\'s verdict', async () => {
    const working = scriptedAgent().factory;
    const adapter = new AcpAdapter({
      agents: [{ id: 'broken', command: 'missing-acp' }, { id: 'fine', command: 'fake-agent-acp' }],
      spawnProcess: agent => {
        if (agent.command === 'missing-acp') { throw new Error('spawn missing-acp ENOENT'); }
        return working(agent);
      },
    });

    const results = await adapter.probeAll();

    expect(results.map(entry => entry.agent.id)).toEqual(['broken', 'fine']);
    expect(results[0]!.result).toMatchObject({ installed: false, authenticated: false });
    expect(results[1]!.result).toMatchObject({ installed: true, authenticated: true });
  });

  it('re-reads a getter, so an agent added after construction is seen', async () => {
    // The routed adapter lives as long as the extension host. Snapshotting the
    // settings array at construction meant a newly added agent was invisible to
    // routing until a window reload, while the provider panel — which builds a
    // fresh adapter per click — already listed it as ready.
    const configured: AcpAgentConfig[] = [];
    const adapter = new AcpAdapter({ agents: () => configured, spawnProcess: scriptedAgent().factory });

    expect(await adapter.listModels()).toEqual([]);
    configured.push(AGENT);
    expect(await adapter.listModels()).toEqual(['acp/fake']);
  });

  it('degrades a throwing agents getter to none, rather than failing the turn', async () => {
    const adapter = new AcpAdapter({
      agents: () => { throw new Error('settings unreadable'); },
      spawnProcess: () => { throw new Error('should not spawn'); },
    });
    expect(await adapter.listModels()).toEqual([]);
    expect(await adapter.healthCheck()).toBe(false);
  });

  it('is unhealthy when every configured agent fails', async () => {
    const adapter = new AcpAdapter({
      agents: [{ id: 'a', command: 'missing-a' }, { id: 'b', command: 'missing-b' }],
      spawnProcess: () => { throw new Error('spawn ENOENT'); },
    });
    expect(await adapter.healthCheck()).toBe(false);
  });

  it('prices subscription capacity at zero per token', async () => {
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent().factory });
    const [model] = await adapter.discoverModels();
    expect(model).toMatchObject({ id: 'acp/fake', inputPricePer1k: 0, outputPricePer1k: 0 });
  });

  it('probe reports installed + authenticated on a clean handshake', async () => {
    const { factory } = scriptedAgent();
    const probe = await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).probe();
    expect(probe).toMatchObject({ installed: true, authenticated: true, protocolVersion: 1, agentName: 'fake-agent' });
  });

  it('probe distinguishes "not installed" from "not signed in"', async () => {
    const missing = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: () => { throw new Error('spawn fake-agent-acp ENOENT'); },
    });
    const notInstalled = await missing.probe();
    expect(notInstalled.installed).toBe(false);
    expect(notInstalled.message).toMatch(/not found on PATH/);

    // Not signed in means the agent refused to open a session — not that it
    // listed some logins on its way past.
    const unauthenticated = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: scriptedAgent({
        initialize: { ...INITIALIZE_OK, authMethods: [{ id: 'chat-gpt' }] },
        authRequired: true,
      }).factory,
    });
    const probe = await unauthenticated.probe();
    expect(probe).toMatchObject({ installed: true, authenticated: false });
    expect(probe.message).toMatch(/not signed in/);
    expect(probe.message).toMatch(/chat-gpt/);
  });

  it('probe proves the agent can open a session, not merely that it started', async () => {
    // An advertised login list is not a fault. This agent is signed in.
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: scriptedAgent({
        initialize: { ...INITIALIZE_OK, authMethods: [{ id: 'api-key' }, { id: 'chat-gpt' }] },
      }).factory,
    });

    const probe = await adapter.probe();

    expect(probe).toMatchObject({ installed: true, authenticated: true });
    expect(probe.message).toBeUndefined();
  });

  it('probe reports a broken agent as broken rather than as signed out', async () => {
    const factory: AcpProcessFactory = () => new FakeAgent((self, frame) => {
      if (frame['method'] === 'initialize') {
        self.emitFrame({ jsonrpc: '2.0', id: frame['id'], result: INITIALIZE_OK });
        return;
      }
      if (frame['method'] === 'session/new') {
        self.emitFrame({ jsonrpc: '2.0', id: frame['id'], error: { code: -32603, message: 'workspace unreadable' } });
      }
    });
    const probe = await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).probe();

    expect(probe).toMatchObject({ installed: true, authenticated: false });
    expect(probe.message).toMatch(/could not open a session/);
    expect(probe.message).not.toMatch(/sign in/i);
  });

  it('single-flights concurrent probes so one UI refresh creates one process tree', async () => {
    const { factory, agents } = scriptedAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    const [first, second, third] = await Promise.all([
      adapter.probe(),
      adapter.probe(),
      adapter.probe(),
    ]);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(agents).toHaveLength(1);
  });

  it('says what to do when nothing is configured at all', async () => {
    const probe = await new AcpAdapter({ agents: [] }).probe();
    expect(probe).toMatchObject({ installed: false, authenticated: false });
    expect(probe.message).toMatch(/atlasmind\.acp\.agents/);
  });
});

describe('buildPromptBlocks', () => {
  it('sends images as content blocks when the agent declares support', () => {
    const blocks = buildPromptBlocks(request({
      messages: [{ role: 'user', content: 'look', images: [{ source: 'a.png', mimeType: 'image/png', dataBase64: 'AAA' }] }],
    }), { supportsImages: true });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: 'image', data: 'AAA', mimeType: 'image/png' });
  });

  it('says so in the prompt when it had to drop images', () => {
    // Dropped silently, the model answers a question about an image it never
    // received; saying so lets it respond honestly.
    const blocks = buildPromptBlocks(request({
      messages: [{ role: 'user', content: 'look', images: [{ source: 'a.png', mimeType: 'image/png', dataBase64: 'AAA' }] }],
    }), { supportsImages: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toContain('1 image attachment omitted');
  });

  it('labels each role so a flattened transcript stays readable', () => {
    const blocks = buildPromptBlocks(request({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ],
    }), { supportsImages: false });
    expect(blocks[0]!.text).toContain('System instructions:');
    expect(blocks[0]!.text).toContain('User:');
    expect(blocks[0]!.text).toContain('Assistant:');
  });
});

describe('parseAcpAgentSettings — untrusted settings boundary', () => {
  it('reads a well-formed list', () => {
    expect(parseAcpAgentSettings([
      { id: 'claude', command: 'claude-agent-acp', args: ['--stdio'], label: 'Claude' },
    ])).toEqual([
      { id: 'claude', command: 'claude-agent-acp', args: ['--stdio'], label: 'Claude' },
    ]);
  });

  it('returns nothing for a non-array or malformed entries', () => {
    expect(parseAcpAgentSettings(undefined)).toEqual([]);
    expect(parseAcpAgentSettings('claude-agent-acp')).toEqual([]);
    expect(parseAcpAgentSettings([null, 3, { id: 'x' }, { command: 'y' }])).toEqual([]);
  });

  it('normalises an id to a safe slug — it becomes part of a model id', () => {
    const agents = parseAcpAgentSettings([{ id: 'My Agent!', command: 'a' }]);
    expect(agents[0]!.id).toBe('myagent');
    expect(agents[0]!.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('keeps the first of two entries that normalise to the same id', () => {
    const agents = parseAcpAgentSettings([
      { id: 'claude', command: 'first' },
      { id: 'CLAUDE', command: 'second' },
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.command).toBe('first');
  });

  it('keeps only string args and well-formed env names', () => {
    const agents = parseAcpAgentSettings([
      { id: 'a', command: 'c', args: ['--ok', 5, null], env: { GOOD_VAR: 'v', 'bad name': 'v', NUM: 7 } },
    ]);
    expect(agents[0]!.args).toEqual(['--ok']);
    expect(agents[0]!.env).toEqual({ GOOD_VAR: 'v' });
  });

  it('caps how many agents it will accept', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, command: 'c' }));
    expect(parseAcpAgentSettings(many).length).toBeLessThanOrEqual(12);
  });
});

describe('VERIFIED_ACP_AGENTS', () => {
  it('lists the agents whose launch command the ACP registry declares', () => {
    expect(VERIFIED_ACP_AGENTS.map(agent => agent.command))
      .toEqual(['claude-agent-acp', 'codex-acp', 'gemini', 'copilot', 'qwen']);
  });

  /**
   * The bug this list shipped with for thirty-odd versions.
   *
   * `command` said `claude-agent-acp`; the install command said
   * `@zed-industries/claude-code-acp`, whose `bin` is `claude-code-acp`. So
   * following AtlasMind's own instructions installed a binary AtlasMind would
   * then fail to find, and the Claude path could not work for anybody. The two
   * facts lived in different files, so nothing could notice they disagreed.
   *
   * The package/bin pairs below were each read from the npm registry's own `bin`
   * field on 2026-07-30. A future rename shows up here rather than as an
   * unexplained ENOENT.
   */
  it('pairs every command with the npm package that actually provides it', () => {
    const declared: Record<string, string> = {
      '@agentclientprotocol/claude-agent-acp': 'claude-agent-acp',
      '@agentclientprotocol/codex-acp': 'codex-acp',
      '@google/gemini-cli': 'gemini',
      '@github/copilot': 'copilot',
      '@qwen-code/qwen-code': 'qwen',
    };
    for (const agent of VERIFIED_ACP_AGENTS) {
      expect(declared[agent.npmPackage], `${agent.id} → ${agent.npmPackage}`).toBe(agent.command);
    }
  });

  it('carries the ACP-mode flag for every CLI that is not an ACP-only adapter', () => {
    // `gemini`, `copilot` and `qwen` are interactive CLIs until told otherwise;
    // registering one without its flag launches a REPL that never speaks JSON-RPC.
    const byId = new Map(VERIFIED_ACP_AGENTS.map(agent => [agent.id, agent.args]));
    expect(byId.get('claude')).toEqual([]);
    expect(byId.get('codex')).toEqual([]);
    expect(byId.get('gemini')).toEqual(['--acp']);
    expect(byId.get('copilot')).toEqual(['--acp']);
    expect(byId.get('qwen')).toEqual(['--acp']);
  });

  it('gives every id a distinct model id', () => {
    const ids = VERIFIED_ACP_AGENTS.map(agent => agent.modelId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const agent of VERIFIED_ACP_AGENTS) {
      expect(agent.modelId).toBe(`acp/${agent.id}`);
    }
  });
});

describe('SELF_INSTALLED_ACP_AGENTS', () => {
  it('names agents distributed as archives, which AtlasMind will not download', () => {
    // Listed so the guide can name the command; deliberately not installable,
    // because unpacking a downloaded archive is not something AtlasMind does.
    expect(SELF_INSTALLED_ACP_AGENTS.map(agent => `${agent.command} ${agent.args.join(' ')}`.trim()))
      .toEqual(['goose acp', 'opencode acp', 'cursor-agent acp', 'kimi acp']);
  });

  it('never collides with an agent AtlasMind can install', () => {
    const installable = new Set(VERIFIED_ACP_AGENTS.map(agent => agent.id));
    for (const agent of SELF_INSTALLED_ACP_AGENTS) {
      expect(installable.has(agent.id), agent.id).toBe(false);
    }
  });
});

describe('ACP_PROVIDER_BRIDGES — the subscription offer on a pay-per-token card', () => {
  it('offers Claude on the Anthropic card and ChatGPT on the OpenAI card', () => {
    // "ACP" is a protocol name and nobody shops for a protocol; the offer has
    // to appear where the user already is, in the words they already use.
    expect(findAcpBridge('anthropic')).toMatchObject({
      agentId: 'claude',
      command: 'claude-agent-acp',
      offerLabel: 'Use my Claude subscription',
    });
    expect(findAcpBridge('openai')).toMatchObject({
      agentId: 'codex',
      command: 'codex-acp',
    });
  });

  it('offers Gemini on the Google card, now that its invocation is published', () => {
    // The registry proves the launch command, not account eligibility. Personal
    // Google AI plans no longer authorize Gemini CLI, so the narrower enterprise
    // entitlement must travel with the offer.
    expect(findAcpBridge('google')).toMatchObject({
      agentId: 'gemini',
      command: 'gemini',
      args: ['--acp'],
      subscriptionName: 'Gemini Code Assist Standard or Enterprise license',
      offerLabel: 'Use my Code Assist license',
      eligibility: expect.stringMatching(/Google AI Pro and Ultra/),
    });
  });

  it('offers nothing for a vendor with no published ACP agent', () => {
    expect(findAcpBridge('mistral')).toBeUndefined();
    expect(findAcpBridge('local')).toBeUndefined();
  });

  /**
   * The install string is *derived* from the verified list rather than written
   * out on the bridge, so the two cannot disagree the way they used to.
   */
  it('derives each install command from the agent that owns it', () => {
    for (const bridge of ACP_PROVIDER_BRIDGES) {
      const agent = VERIFIED_ACP_AGENTS.find(entry => entry.id === bridge.agentId);
      expect(agent, bridge.providerId).toBeDefined();
      expect(bridge.install).toBe(`npm install -g ${agent!.npmPackage}`);
      expect(bridge.args).toEqual(agent!.args);
    }
  });

  it('never proposes the renamed package or the crate that never existed', () => {
    const installs = ACP_PROVIDER_BRIDGES.map(bridge => bridge.install).join('\n');
    // Deprecated and renamed; its bin is `claude-code-acp`, not `claude-agent-acp`.
    expect(installs).not.toContain('@zed-industries/claude-code-acp');
    // There is no `codex-acp` crate. This advised installing Rust to no purpose.
    expect(installs).not.toContain('cargo install');
  });

  it('names a command that is also a verified agent', () => {
    // The offer and the verified list must not drift: every bridge has to point
    // at an agent whose launch command was actually read from the ACP docs.
    const verified = new Set(VERIFIED_ACP_AGENTS.map(agent => agent.command));
    for (const bridge of ACP_PROVIDER_BRIDGES) {
      expect(verified, `${bridge.providerId} → ${bridge.command}`).toContain(bridge.command);
    }
  });

  it('phrases the offer in the user\'s terms, not the protocol\'s', () => {
    for (const bridge of ACP_PROVIDER_BRIDGES) {
      expect(bridge.offerLabel.toLowerCase()).not.toContain('acp');
      expect(bridge.offerLabel.toLowerCase()).toMatch(/subscription|license/);
      expect(bridge.install.length).toBeGreaterThan(0);
    }
  });
});

describe('AcpAdapter — effort inside a subscription', () => {
  it('offers one routed model per model and effort the agent listed, after a probe', async () => {
    const { factory } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    // Before probing there is one row: the agent's own default. A variant
    // offered before the agent has said it supports one would route a turn to
    // a model or effort it never agreed to.
    expect((await adapter.discoverModels()).map(m => m.id)).toEqual(['acp/fake']);

    await adapter.healthCheck();

    // Both knobs live on the same session, so the cross product is what lets the
    // router ask for the deep model at low effort. Every model comes before any
    // effort variant, so a long lineup truncates efforts rather than models.
    const models = await adapter.discoverModels();
    expect(models.map(m => m.id)).toEqual([
      'acp/fake',
      'acp/fake@opus', 'acp/fake@haiku',
      'acp/fake@opus#low', 'acp/fake@haiku#low',
      'acp/fake@opus#high', 'acp/fake@haiku#high',
    ]);
  });

  it('gives each combination the depth and quota cost the router already reasons about', async () => {
    const { factory } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await adapter.healthCheck();

    const models = await adapter.discoverModels();
    const byId = (id: string) => models.find(m => m.id === id)!;

    // Effort still grades within one model.
    expect(byId('acp/fake@opus#low').premiumRequestMultiplier)
      .toBeLessThan(byId('acp/fake@opus#high').premiumRequestMultiplier!);
    // And the model grades across efforts, so the cheapest combination is the
    // light model at low effort — the property the budget gate depends on.
    expect(byId('acp/fake@haiku#low').premiumRequestMultiplier)
      .toBeLessThan(byId('acp/fake@opus#high').premiumRequestMultiplier!);
    // Depth is the greater of the two knobs: a light model cannot be made deep
    // by asking harder, and a deep model at low effort is still the deep model.
    expect(byId('acp/fake@opus#low').reasoningDepth).toBe(5);

    // The base row carries neither: it is whatever the agent chose, and
    // asserting a depth for it would be inventing one.
    expect(byId('acp/fake').reasoningDepth).toBeUndefined();
  });

  it('names the model and its standing, including when the standing is unknown', async () => {
    // A row nobody ranked must not look like one somebody did.
    const { factory } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await adapter.healthCheck();

    const models = await adapter.discoverModels();
    expect(models.find(m => m.id === 'acp/fake@opus')!.name).toContain('deep');
    expect(models.find(m => m.id === 'acp/fake@haiku')!.name).toContain('light');
  });

  it('sets the requested effort before prompting', async () => {
    const { factory, agents, state } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await adapter.complete(request({ model: 'acp/fake#high' }));

    expect(state['effort']).toBe('high');
    const written = agents[0]!.written.map(f => f['method']);
    // Order matters: an effort set after the prompt would have changed nothing.
    expect(written.indexOf('session/set_config_option')).toBeLessThan(written.indexOf('session/prompt'));
  });

  it('sets the requested model before prompting', async () => {
    const { factory, agents, state } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await adapter.healthCheck();

    await adapter.complete(request({ model: 'acp/fake@haiku' }));

    expect(state['model']).toBe('haiku');
    const written = agents.at(-1)!.written.map(f => f['method']);
    expect(written.indexOf('session/set_config_option')).toBeLessThan(written.indexOf('session/prompt'));
  });

  it('sets the model before the effort', async () => {
    // Against an agent that resets dependent knobs when the model changes, a
    // model applied *after* the effort would silently discard it — the same
    // looks-like-success failure the category rule exists to prevent.
    const { factory, agents, state } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await adapter.healthCheck();

    await adapter.complete(request({ model: 'acp/fake@haiku#high' }));

    expect(state['model']).toBe('haiku');
    expect(state['effort']).toBe('high');
    const values = agents.at(-1)!.written
      .filter(f => f['method'] === 'session/set_config_option')
      .map(f => JSON.stringify((f['params'] as Record<string, unknown>) ?? {}));
    expect(values[0]).toContain('haiku');
    expect(values[1]).toContain('high');
  });

  it('runs on the named agent rather than falling through to the first', async () => {
    // Both suffixes have to come off before the agent lookup. An id still
    // carrying either matches no configured agent, and the fallback would run
    // the turn on somebody else's subscription.
    const { factory, state } = configurableAgent();
    const adapter = new AcpAdapter({
      agents: [{ id: 'other', command: 'other-acp' }, AGENT],
      spawnProcess: factory,
    });
    await adapter.healthCheck();

    await adapter.complete(request({ model: 'acp/fake@haiku#high' }));
    expect(state['model']).toBe('haiku');
  });

  it('leaves the model alone when the slug names nothing the agent offers', async () => {
    // The conservative direction: the turn runs at the agent's own model rather
    // than being refused over a knob.
    const { factory, state } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await adapter.healthCheck();

    await adapter.complete(request({ model: 'acp/fake@nonexistent' }));
    expect(state['model']).toBe('opus');
  });

  it('matches the effort knob by category even when the agent names it differently', async () => {
    // Codex calls it `reasoning_effort`; a client keyed on `effort` would
    // silently no-op against it while the turn still completed.
    const { factory, state } = configurableAgent({ effortId: 'reasoning_effort' });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await adapter.complete(request({ model: 'acp/fake#high' }));

    expect(state['reasoning_effort']).toBe('high');
  });

  it('sets nothing at all for the base model', async () => {
    const { factory, agents } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await adapter.complete(request({ model: 'acp/fake' }));

    expect(agents[0]!.method('session/set_config_option')).toBeUndefined();
  });

  it('routes a variant to its own agent, not to the first one', async () => {
    // The suffix has to be stripped before the agent lookup, or every variant
    // falls through to `agents[0]` and quietly runs on the wrong subscription.
    const first = configurableAgent();
    const second = configurableAgent();
    const adapter = new AcpAdapter({
      agents: [{ id: 'one', command: 'one-acp' }, { id: 'two', command: 'two-acp' }],
      spawnProcess: (agent, cwd) => (agent.command === 'one-acp' ? first.factory : second.factory)(agent, cwd),
    });

    await adapter.complete(request({ model: 'acp/two#high' }));

    expect(second.agents.length).toBe(1);
    expect(first.agents.length).toBe(0);
    expect(second.state['effort']).toBe('high');
  });

  it('still answers when the effort cannot be applied, and says so', async () => {
    // A turn at the default effort produced an answer; aborting over a knob
    // would turn a degraded turn into no turn.
    const events: Array<{ requested: string; reason: string }> = [];
    const { factory } = configurableAgent({ refuseSet: true });
    const adapter = new AcpAdapter({
      agents: [AGENT], spawnProcess: factory,
      onEffortNotApplied: e => events.push(e),
    });

    const result = await adapter.complete(request({ model: 'acp/fake#high' }));

    expect(result.content).toBe('ok');
    expect(events).toHaveLength(1);
    expect(events[0]!.requested).toBe('high');
  });

  it('reports an agent that accepts the request and ignores it', async () => {
    // Confirmed, not assumed: the response echoes the full option set back, so
    // an agent that said yes and changed nothing is distinguishable from one
    // that applied it. Otherwise the router bills high effort for a default run.
    const events: Array<{ requested: string; reason: string }> = [];
    const { factory } = configurableAgent({ ignoreSet: true });
    const adapter = new AcpAdapter({
      agents: [AGENT], spawnProcess: factory,
      onEffortNotApplied: e => events.push(e),
    });

    await adapter.complete(request({ model: 'acp/fake#high' }));

    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toContain('default');
  });

  it('never sends a permission-mode change on the wire', async () => {
    // The load-bearing safety property. `mode` values include
    // `bypassPermissions` / `agent-full-access`; a config channel able to set
    // one would route around toolApprovalManager rather than through it.
    const { factory, agents, state } = configurableAgent();
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });

    await adapter.healthCheck();
    await adapter.complete(request({ model: 'acp/fake#high' }));

    const sets = agents.flatMap(a => a.written.filter(f => f['method'] === 'session/set_config_option'));
    for (const frame of sets) {
      const params = frame['params'] as Record<string, unknown>;
      expect(params['configId']).not.toBe('mode');
      expect(String(params['value'])).not.toMatch(/bypass|full-access/i);
    }
    expect(state['mode']).toBe('default');
  });

  it('offers no variant for an agent that never opened a session', async () => {
    // An agent that refused has told us nothing about what it would configure.
    const adapter = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: () => { throw new Error('spawn fake-agent-acp ENOENT'); },
    });
    await adapter.healthCheck();

    expect((await adapter.discoverModels()).map(m => m.id)).toEqual(['acp/fake']);
  });
});

describe('AcpAdapter — session teardown', () => {
  /**
   * A probe does not just handshake: it opens a session, because that is the
   * only honest test of "signed in". On a real coding agent that session starts
   * the agent's whole runtime — measured here, `claude-agent-acp` launches the
   * user's entire configured MCP fleet inside it, several members via `cmd.exe`,
   * each of which makes Windows allocate a `conhost.exe` that flashes on screen.
   * Killing our direct child orphans that tree; asking the agent to close the
   * session lets it reap its own.
   */
  function closableAgent(options?: { advertiseClose?: boolean }) {
    const advertise = options?.advertiseClose !== false;
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        const id = frame['id'];
        switch (frame['method']) {
          case 'initialize':
            self.emitFrame({ jsonrpc: '2.0', id, result: {
              ...INITIALIZE_OK,
              agentCapabilities: {
                promptCapabilities: { image: true },
                ...(advertise ? { sessionCapabilities: { close: {} } } : {}),
              },
            } });
            return;
          case 'session/new':
            self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1' } });
            return;
          case 'session/close':
            self.emitFrame({ jsonrpc: '2.0', id, result: {} });
            return;
          case 'session/prompt':
            self.emitFrame({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
            return;
          default:
            return;
        }
      });
      agents.push(agent);
      return agent;
    };
    return { factory, agents };
  }

  it('closes the probe session instead of only killing the process', async () => {
    const { factory, agents } = closableAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).healthCheck();

    const close = agents[0]!.method('session/close');
    expect(close).toBeDefined();
    expect((close!['params'] as Record<string, unknown>)['sessionId']).toBe('sess_1');
  });

  it('closes the session after a completed turn', async () => {
    const { factory, agents } = closableAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());

    const written = agents[0]!.written.map(f => f['method']);
    expect(written.indexOf('session/close')).toBeGreaterThan(written.indexOf('session/prompt'));
  });

  it('sends no close to an agent that never offered one', async () => {
    // `sessionCapabilities.close` is optional. A request an agent never
    // advertised is noise it may answer with an error.
    const { factory, agents } = closableAgent({ advertiseClose: false });
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).healthCheck();

    expect(agents[0]!.method('session/close')).toBeUndefined();
  });

  it('still tears down when the close is refused', async () => {
    // Best-effort: the process is going away regardless, and the one thing worse
    // than an unclosed session is a hang while closing one.
    const agents: FakeAgent[] = [];
    const factory: AcpProcessFactory = () => {
      const agent = new FakeAgent((self, frame) => {
        const id = frame['id'];
        if (frame['method'] === 'initialize') {
          self.emitFrame({ jsonrpc: '2.0', id, result: {
            ...INITIALIZE_OK,
            agentCapabilities: { promptCapabilities: { image: true }, sessionCapabilities: { close: {} } },
          } });
        } else if (frame['method'] === 'session/new') {
          self.emitFrame({ jsonrpc: '2.0', id, result: { sessionId: 'sess_1' } });
        } else if (frame['method'] === 'session/close') {
          self.emitFrame({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no' } });
        }
      });
      agents.push(agent);
      return agent;
    };

    const probe = await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).probe();

    expect(probe.authenticated).toBe(true);
    expect(agents[0]!.killed).toBe(true);
  });
});

describe('AcpAdapter — isolating the agent from the machine\'s own settings', () => {
  /**
   * `claude-agent-acp` hardcodes `settingSources: ["user","project","local"]`
   * and then spreads `_meta.claudeCode.options` over it, so a client can turn
   * them off. Those sources are where the user's own MCP fleet comes from:
   * measured on a real machine, isolating drops the session from 19 descendant
   * processes to 3, and from six flashing console windows on Windows to two.
   */
  function metaOf(agent: FakeAgent): Record<string, unknown> | undefined {
    const frame = agent.method('session/new');
    const params = (frame?.['params'] ?? {}) as Record<string, unknown>;
    return params['_meta'] as Record<string, unknown> | undefined;
  }

  function settingSourcesOf(agent: FakeAgent): unknown {
    const meta = metaOf(agent) as { claudeCode?: { options?: { settingSources?: unknown } } } | undefined;
    return meta?.claudeCode?.options?.settingSources;
  }

  it('isolates a completion-only turn', async () => {
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());

    expect(settingSourcesOf(agents[0]!)).toEqual([]);
  });

  it('does NOT isolate once the agent may act', async () => {
    // The setting sources carry more than MCP — the project's CLAUDE.md,
    // permission defaults, custom subagents. Withholding those from an agent
    // that is allowed to act takes away context it needs; withholding them
    // from one that can only write text takes away nothing.
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({
      agents: [AGENT],
      spawnProcess: factory,
      getMcpServers: () => [{ name: 'docs', command: 'npx', args: ['-y', 'server'], env: [] }],
    }).complete(request());

    expect(metaOf(agents[0]!)).toBeUndefined();
  });

  it('always isolates the probe, which is the call that runs most often', async () => {
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).healthCheck();

    expect(settingSourcesOf(agents[0]!)).toEqual([]);
  });

  it('sends a shape the agent can ignore without breaking', async () => {
    // `_meta` is ACP's extensibility field, and this key is Anthropic's vendor
    // extension rather than spec. An agent that ignores it must still get a
    // valid `session/new` — verified live against codex-acp, pinned here.
    const { factory, agents } = scriptedAgent();
    await new AcpAdapter({ agents: [AGENT], spawnProcess: factory }).complete(request());

    const params = (agents[0]!.method('session/new')!['params'] ?? {}) as Record<string, unknown>;
    expect(params['cwd']).toBeDefined();
    expect(params['mcpServers']).toEqual([]);
    // The extension lives under _meta only — never alongside the spec fields.
    expect(params['settingSources']).toBeUndefined();
    expect(params['claudeCode']).toBeUndefined();
  });
});

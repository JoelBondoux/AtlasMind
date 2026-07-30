import { beforeEach, describe, expect, it } from 'vitest';
import {
  AcpAdapter,
  buildPromptBlocks,
  parseAcpAgentSettings,
  resetAcpProbeCache,
  VERIFIED_ACP_AGENTS,
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
  usage?: { inputTokens?: number; outputTokens?: number };
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
          if (options?.usage) {
            self.emitFrame({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: 'sess_1', update: { sessionUpdate: 'usage_update', usage: options.usage } },
            });
          }
          self.emitFrame({ jsonrpc: '2.0', id, result: { stopReason: options?.stopReason ?? 'end_turn' } });
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

  it('streams each chunk as it arrives — the thing claude-cli cannot do', async () => {
    const { factory } = scriptedAgent({ chunks: ['one ', 'two ', 'three'] });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    const seen: string[] = [];

    const response = await adapter.streamComplete(request(), chunk => seen.push(chunk));

    expect(seen).toEqual(['one ', 'two ', 'three']);
    expect(response.content).toBe('one two three');
  });

  it('reports token usage when the agent sends it, and zero when it does not', async () => {
    const withUsage = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent({ usage: { inputTokens: 120, outputTokens: 8 } }).factory });
    const counted = await withUsage.complete(request());
    expect(counted).toMatchObject({ inputTokens: 120, outputTokens: 8 });

    // Absent counts stay zero rather than being estimated — a fabricated token
    // count would feed the cost tracker a number nobody measured.
    const withoutUsage = new AcpAdapter({ agents: [AGENT], spawnProcess: scriptedAgent().factory });
    expect(await withoutUsage.complete(request())).toMatchObject({ inputTokens: 0, outputTokens: 0 });
  });

  it('carries a prompt far larger than the claude-cli argv ceiling, intact', async () => {
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

  it('refuses to run when the agent is not authenticated', async () => {
    const { factory } = scriptedAgent({ initialize: { ...INITIALIZE_OK, authMethods: ['oauth'] } });
    const adapter = new AcpAdapter({ agents: [AGENT], spawnProcess: factory });
    await expect(adapter.complete(request())).rejects.toThrow(/not authenticated/i);
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

  it('probe distinguishes "not installed" from "not authenticated"', async () => {
    const missing = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: () => { throw new Error('spawn fake-agent-acp ENOENT'); },
    });
    const notInstalled = await missing.probe();
    expect(notInstalled.installed).toBe(false);
    expect(notInstalled.message).toMatch(/not found on PATH/);

    const unauthenticated = new AcpAdapter({
      agents: [AGENT],
      spawnProcess: scriptedAgent({ initialize: { ...INITIALIZE_OK, authMethods: ['oauth'] } }).factory,
    });
    const probe = await unauthenticated.probe();
    expect(probe).toMatchObject({ installed: true, authenticated: false });
    expect(probe.message).toMatch(/not authenticated/);
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
  it('lists only agents whose launch command is published', () => {
    expect(VERIFIED_ACP_AGENTS.map(agent => agent.command)).toEqual(['claude-agent-acp', 'codex-acp']);
    // Gemini CLI implements ACP but publishes no invocation, so guessing one
    // would produce a spawn failure the user cannot diagnose.
    expect(VERIFIED_ACP_AGENTS.some(agent => /gemini/i.test(agent.id))).toBe(false);
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

  it('offers nothing for a vendor whose launch command is unpublished', () => {
    // Gemini CLI implements ACP but publishes no invocation, so a button on the
    // Google card would be one that cannot work.
    expect(findAcpBridge('google')).toBeUndefined();
    expect(findAcpBridge('mistral')).toBeUndefined();
    expect(findAcpBridge('local')).toBeUndefined();
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
      expect(bridge.offerLabel.toLowerCase()).toContain('subscription');
      expect(bridge.install.length).toBeGreaterThan(0);
    }
  });
});

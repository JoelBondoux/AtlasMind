/**
 * ACP provider adapter — subscription-backed completion capacity over the
 * Agent Client Protocol.
 *
 * This is Tier 1 of `project_memory/roadmap/acp-integration.md`: ACP replaces
 * `claude-cli` as the Claude-subscription path with strictly more capability and
 * **no new security surface**. What it buys over the argv bridge:
 *
 * - **Streaming.** `session/update` text chunks map to `onTextChunk`;
 *   `claude-cli` cannot stream at all.
 * - **No 26k prompt ceiling.** Prompts travel as JSON-RPC over stdio rather than
 *   in argv, so `CLAUDE_CLI_TOTAL_PROMPT_BUDGET` and the truncation constants
 *   simply do not apply. A long context arrives intact instead of silently cut.
 * - **Images.** Sent as ACP `image` content blocks when the agent's
 *   `promptCapabilities.image` says it accepts them — and dropped with a note
 *   when it does not, rather than sent hopefully.
 *
 * **Restricted mode is mandatory at this tier, and is what lets it ship without
 * touching the authorization gate.** The agent is initialised with no
 * filesystem capability, no terminal capability, and an empty `mcpServers`
 * list. It is a completion source, not an executor. Delegated execution —
 * where `session/request_permission` must resolve through `toolApprovalManager`
 * — is Tier 3, and this adapter deliberately **refuses** any permission request
 * rather than answering one it has no policy for: failing closed is the only
 * safe behaviour for a request this tier was not built to authorize.
 *
 * The launch command is **user-authored** (`atlasmind.acp.agents`). Nothing here
 * installs, downloads, or `npx`-fetches an agent: the adapter probes for a
 * binary the user already has, exactly as `probeClaudeCli` does.
 *
 * Wire framing lives in {@link ./acpProtocol.ts}, verified against the published
 * spec. The child process is injected via {@link AcpProcessFactory} — the
 * `PresenceManager`/`BuzzClient` idiom — so the whole state machine is testable
 * without spawning anything.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter } from './adapter.js';
import {
  ACP_PERMISSION_METHOD,
  ACP_PROTOCOL_VERSION,
  buildInitializeRequest,
  buildPermissionCancelledResponse,
  buildPermissionSelectedResponse,
  buildSessionCancelNotification,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  drainFrames,
  encodeAcpFrame,
  parseAcpFrame,
  parseInitializeResult,
  parsePermissionRequest,
  parseSessionId,
  parseSessionUpdate,
  parseStopReason,
  toFinishReason,
  type AcpInitializeResult,
  type AcpMcpServer,
  type AcpPermissionRequest,
  type AcpPromptBlock,
  type AcpToolCall,
} from './acpProtocol.js';
import { resolveAcpPermission } from './acpPermission.js';

export const ACP_PROVIDER_ID = 'acp';
export const ACP_SETUP_URL = 'https://agentclientprotocol.com/get-started/agents';

const DEFAULT_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 20_000;
const ACP_PROBE_TTL_MS = 10_000;

/**
 * Agents whose ACP launch command is **named in the official agent list**.
 *
 * Only verified entries live here. Gemini CLI is listed by the ecosystem as
 * ACP-implementing but its exact invocation is not published, so it is
 * deliberately absent: the roadmap's rule is "never guess an external contract",
 * and a wrong default command produces a spawn failure the user cannot diagnose.
 * Anything not listed is still usable — as a user-authored command.
 */
export const VERIFIED_ACP_AGENTS: ReadonlyArray<{ id: string; label: string; command: string; modelId: string }> = [
  { id: 'claude', label: 'Claude Agent (claude-agent-acp)', command: 'claude-agent-acp', modelId: 'acp/claude' },
  { id: 'codex', label: 'Codex CLI (codex-acp)', command: 'codex-acp', modelId: 'acp/codex' },
];

/**
 * Which pay-per-token provider each ACP agent is the subscription alternative to.
 *
 * "ACP" is a protocol name, and nobody goes looking for a protocol. Someone
 * holding a Claude subscription thinks *"I already pay for Claude"* — so the
 * offer belongs on the **Anthropic** card, phrased in those terms, rather than
 * behind a separate entry they must first know exists and then decode.
 *
 * Only vendors whose launch command is actually published appear here. Google
 * is absent for the same reason it is absent from {@link VERIFIED_ACP_AGENTS}:
 * Gemini CLI implements ACP but publishes no invocation, so an offer on the
 * Google card would be a button that cannot work.
 */
export interface AcpProviderBridge {
  /** The pay-per-token provider this is offered alongside. */
  providerId: string;
  /** Agent id used in the model id `acp/<id>`. */
  agentId: string;
  command: string;
  /** What the user calls the thing they already pay for. */
  subscriptionName: string;
  /** Button text — the user's words, not the protocol's. */
  offerLabel: string;
  install: string;
}

export const ACP_PROVIDER_BRIDGES: readonly AcpProviderBridge[] = [
  {
    providerId: 'anthropic',
    agentId: 'claude',
    command: 'claude-agent-acp',
    subscriptionName: 'Claude subscription',
    offerLabel: 'Use my Claude subscription',
    install: 'npm install -g @zed-industries/claude-code-acp',
  },
  {
    providerId: 'openai',
    agentId: 'codex',
    command: 'codex-acp',
    subscriptionName: 'ChatGPT Plus or Pro subscription',
    offerLabel: 'Use my ChatGPT subscription',
    install: 'cargo install codex-acp',
  },
];

/** The subscription offer for a provider, when one exists. */
export function findAcpBridge(providerId: string): AcpProviderBridge | undefined {
  return ACP_PROVIDER_BRIDGES.find(bridge => bridge.providerId === providerId);
}

/**
 * The same bridge, found by agent id rather than by vendor.
 *
 * Both entry points into ACP setup end up needing the install command — the
 * offer on a vendor card knows the vendor, the agent picker knows the agent —
 * and a user who hits "not installed" needs the same answer either way.
 */
export function findAcpBridgeByAgent(agentId: string): AcpProviderBridge | undefined {
  return ACP_PROVIDER_BRIDGES.find(bridge => bridge.agentId === agentId);
}

export interface AcpAgentConfig {
  /** Stable id, used in the model id `acp/<id>`. */
  id: string;
  /** Executable to spawn. User-authored; never installed by AtlasMind. */
  command: string;
  args?: string[];
  /** Extra environment for the child, merged over the inherited environment. */
  env?: Record<string, string>;
  label?: string;
}

export interface AcpProbeResult {
  installed: boolean;
  /** True only when the agent reported no outstanding auth methods. */
  authenticated: boolean;
  /** The version the agent negotiated, when it got that far. */
  protocolVersion?: number;
  agentName?: string;
  command?: string;
  message?: string;
  /**
   * `promptCapabilities.image`, learned from the handshake.
   *
   * This is what lets `discoverModels` declare `vision` truthfully. It cannot be
   * a static fact about the agent id: whether `claude-agent-acp` accepts images
   * depends on the installed build, and asserting a capability the local binary
   * does not have produces a failed turn rather than a skipped one.
   */
  supportsImages?: boolean;
  /** `promptCapabilities.audio`. Reported for diagnostics; nothing sends audio. */
  supportsAudio?: boolean;
}

/**
 * Asks the user whether a delegated ACP agent may perform one operation.
 *
 * Injected rather than imported so the adapter stays `vscode`-free: the real
 * implementation shows a modal and consults `ToolApprovalManager`, and the tests
 * pass a function. **No policy means no permission** — see {@link AcpAdapter}.
 */
export type AcpPermissionPolicy = (request: AcpPermissionRequest) => Promise<boolean>;

/** Notified as the agent announces and updates tool calls, so they are visible. */
export type AcpToolEventListener = (event: AcpToolCall) => void;

/** Minimal child-process surface, so tests can drive a fake. */
export interface AcpProcessHandle {
  writeLine(line: string): void;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  kill(): void;
}

export type AcpProcessFactory = (config: AcpAgentConfig, cwd: string | undefined) => AcpProcessHandle;

interface AcpTurnResult {
  text: string;
  finishReason: CompletionResponse['finishReason'];
  inputTokens: number;
  outputTokens: number;
  agentName?: string;
}

export class AcpAdapter implements ProviderAdapter {
  readonly providerId = ACP_PROVIDER_ID;

  constructor(
    private readonly options?: {
      agents?: AcpAgentConfig[];
      cwd?: string;
      timeoutMs?: number;
      clientVersion?: string;
      spawnProcess?: AcpProcessFactory;
      /**
       * MCP servers to hand the agent at `session/new`.
       *
       * Absent, or returning nothing, means the agent gets none — the default.
       * The list is an explicit user allowlist, not "everything AtlasMind has
       * connected": these entries carry commands and environment variables into
       * a third-party process.
       *
       * A getter rather than a value, matching `LocalEchoAdapter`'s
       * `getEndpoints`: it is read per session, so revoking a server in settings
       * takes effect on the next turn instead of the next window reload.
       */
      getMcpServers?: () => AcpMcpServer[];
      /**
       * The authorization gate for delegated execution.
       *
       * **Omitting it is a denial, not a bypass.** With no policy, every
       * `session/request_permission` is refused, exactly as at Tier 1 — so a
       * caller that forgets to wire the gate gets an agent that cannot act,
       * rather than one that acts unsupervised.
       */
      permissionPolicy?: AcpPermissionPolicy;
      onToolEvent?: AcpToolEventListener;
    },
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.run(request, undefined);
  }

  async streamComplete(
    request: CompletionRequest,
    onTextChunk: (chunk: string) => void,
  ): Promise<CompletionResponse> {
    return this.run(request, onTextChunk);
  }

  async listModels(): Promise<string[]> {
    return this.agents().map(agent => `${ACP_PROVIDER_ID}/${agent.id}`);
  }

  /**
   * Model metadata for the router.
   *
   * `vision` is declared **only** when a handshake has actually reported
   * `promptCapabilities.image`, and is read from the probe cache rather than by
   * spawning: this runs on every tree render, and a process per render is not a
   * price a capability list should cost. The consequence is that vision appears
   * once the agent has been probed (health check, provider panel, setup plan)
   * and not before — the conservative direction, since a model wrongly *offered*
   * for vision fails the turn, while one wrongly withheld merely routes
   * elsewhere.
   *
   * `function_calling` is deliberately never declared. ACP has no way to expose
   * AtlasMind's own `ToolDefinition`s to the agent, so a task requiring that
   * must not be routed here — see the refusal in {@link run}.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    return this.agents().map(agent => {
      const known = peekAcpProbe(this.probeCacheKey(agent));
      return {
        id: `${ACP_PROVIDER_ID}/${agent.id}`,
        name: agent.label ?? agent.id,
        // Subscription-backed: priced at zero per token, which is *why* the router
        // must not let it win budget mode by default — that gate lives in
        // modelRouter's subscription handling, not here.
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        capabilities: known?.supportsImages
          ? ['chat', 'code', 'reasoning', 'vision']
          : ['chat', 'code', 'reasoning'],
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    const agents = this.agents();
    if (agents.length === 0) {
      return false;
    }
    const probe = await this.probe(agents[0]!);
    return probe.installed && probe.authenticated;
  }

  /**
   * Handshake with an agent to find out whether it is installed, speaks our
   * protocol version, and is logged in.
   *
   * Mirrors `probeClaudeCli`: TTL-cached, because read-only callers (the Models
   * tree, the Project Dashboard, the provider panel) re-probe on every render,
   * and each probe here spawns a process.
   */
  async probe(agent?: AcpAgentConfig): Promise<AcpProbeResult> {
    const target = agent ?? this.agents()[0];
    if (!target) {
      return {
        installed: false,
        authenticated: false,
        message: 'No ACP agent is configured. Add one under atlasmind.acp.agents with the command you have installed.',
      };
    }

    const cacheKey = this.probeCacheKey(target);
    // A fake process factory means a test; caching across tests would leak state.
    const cacheable = !this.options?.spawnProcess;
    if (cacheable) {
      const cached = acpProbeCache.get(cacheKey);
      if (cached && Date.now() - cached.at < ACP_PROBE_TTL_MS) {
        return cached.result;
      }
    }

    const result = await this.handshakeOnly(target);
    if (cacheable) {
      acpProbeCache.set(cacheKey, { at: Date.now(), result });
    }
    return result;
  }

  private probeCacheKey(agent: AcpAgentConfig): string {
    return `${agent.command}|${(agent.args ?? []).join(' ')}|${this.options?.cwd ?? ''}`;
  }

  private agents(): AcpAgentConfig[] {
    return (this.options?.agents ?? []).filter(agent => agent && agent.id && agent.command);
  }

  private resolveAgent(model: string): AcpAgentConfig | undefined {
    const wanted = model.startsWith(`${ACP_PROVIDER_ID}/`) ? model.slice(ACP_PROVIDER_ID.length + 1) : model;
    const agents = this.agents();
    return agents.find(agent => agent.id === wanted) ?? agents[0];
  }

  private async handshakeOnly(agent: AcpAgentConfig): Promise<AcpProbeResult> {
    let session: AcpSession | undefined;
    try {
      session = new AcpSession(agent, this.spawnFactory(), this.options?.cwd, this.clientVersion(), PROBE_TIMEOUT_MS);
      const initialized = await session.initialize();
      if (!initialized.compatible) {
        return {
          installed: true,
          authenticated: false,
          protocolVersion: initialized.protocolVersion,
          command: agent.command,
          message: `${agent.command} speaks ACP version ${initialized.protocolVersion}; AtlasMind speaks ${ACP_PROTOCOL_VERSION}. Update the agent, or use a version that matches.`,
        };
      }
      return {
        installed: true,
        // A non-empty authMethods list is the spec's way of saying "authenticate
        // first". AtlasMind never performs that login — it is the vendor's flow.
        authenticated: initialized.authMethods.length === 0,
        protocolVersion: initialized.protocolVersion,
        ...(initialized.agentName ? { agentName: initialized.agentName } : {}),
        command: agent.command,
        supportsImages: initialized.supportsImages,
        supportsAudio: initialized.supportsAudio,
        ...(initialized.authMethods.length > 0
          ? { message: `${agent.command} is installed but not authenticated. Sign in with the agent's own login flow (${initialized.authMethods.join(', ')}).` }
          : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = /ENOENT|not recognized|command not found/i.test(message);
      return {
        installed: !missing,
        authenticated: false,
        command: agent.command,
        message: missing
          ? `${agent.command} was not found on PATH. Install the ACP agent you want to use, then set its command in atlasmind.acp.agents.`
          : `${agent.command} could not be started: ${message.slice(0, 300)}`,
      };
    } finally {
      session?.dispose();
    }
  }

  private async run(request: CompletionRequest, onTextChunk: ((chunk: string) => void) | undefined): Promise<CompletionResponse> {
    const agent = this.resolveAgent(request.model);
    if (!agent) {
      throw new Error('No ACP agent is configured. Add one under atlasmind.acp.agents.');
    }

    // Two different things are called "tools", and conflating them is the trap.
    //
    // `request.tools` is AtlasMind's own function-calling loop: here are schemas,
    // call one, hand back `toolCalls`, and the Orchestrator runs it. ACP has no
    // channel for that — a client cannot inject function definitions into an
    // agent's turn — so this stays refused however much of Tier 3 is enabled.
    //
    // What Tier 3 adds is the *agent's* tools: its own built-ins plus any MCP
    // servers passed at session/new, executed inside the agent and authorized
    // one at a time through `session/request_permission`. That is the
    // Orchestrator standing down and delegating, not nesting its loop inside
    // another one.
    if (request.tools && request.tools.length > 0) {
      throw new Error('ACP agents cannot run AtlasMind\'s own tool definitions — the protocol has no way to pass them in. The agent executes its own tools instead, gated by approval. Route function-calling tasks to a provider that supports them.');
    }

    const session = new AcpSession(
      agent,
      this.spawnFactory(),
      this.options?.cwd,
      this.clientVersion(),
      this.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      this.options?.permissionPolicy,
      this.options?.onToolEvent,
    );
    try {
      const initialized = await session.initialize();
      if (!initialized.compatible) {
        throw new Error(`${agent.command} speaks ACP version ${initialized.protocolVersion}, but AtlasMind speaks ${ACP_PROTOCOL_VERSION}.`);
      }
      if (initialized.authMethods.length > 0) {
        throw new Error(`${agent.command} is not authenticated. Sign in with the agent's own login flow first.`);
      }
      // A getter that throws must not silently become "no servers" — but it also
      // must not take down a turn, so it degrades to the deny-by-default empty
      // list, which is the same thing an unconfigured install sends.
      let mcpServers: AcpMcpServer[] = [];
      try {
        mcpServers = this.options?.getMcpServers?.() ?? [];
      } catch {
        mcpServers = [];
      }
      await session.newSession(mcpServers);
      const turn = await session.prompt(buildPromptBlocks(request, initialized), onTextChunk, request.signal);
      return {
        content: turn.text,
        model: request.model,
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        finishReason: turn.finishReason,
      };
    } finally {
      session.dispose();
    }
  }

  private clientVersion(): string {
    return this.options?.clientVersion ?? '0.0.0';
  }

  private spawnFactory(): AcpProcessFactory {
    return this.options?.spawnProcess ?? defaultAcpProcessFactory;
  }
}

const acpProbeCache = new Map<string, { at: number; result: AcpProbeResult }>();

/**
 * Read a cached probe without triggering one.
 *
 * `discoverModels` needs to know whether the agent takes images, but it is
 * called on every render of every surface that lists models. Spawning there
 * would make a capability list cost a process each time, so this returns what is
 * already known and `undefined` otherwise.
 */
function peekAcpProbe(cacheKey: string): AcpProbeResult | undefined {
  const cached = acpProbeCache.get(cacheKey);
  return cached && Date.now() - cached.at < ACP_PROBE_TTL_MS ? cached.result : undefined;
}

/** Exported for tests: clears the probe TTL cache. */
export function resetAcpProbeCache(): void {
  acpProbeCache.clear();
}

/**
 * Turn AtlasMind's chat messages into ACP content blocks.
 *
 * The whole conversation goes in one prompt because this tier does not reuse
 * sessions — the spec's own ecosystem notes warn that session resume is not
 * universally supported, so designing around it would be building on sand.
 * Crucially there is **no character budget**: the argv ceiling that forced
 * `claude-cli` to truncate does not exist over stdio.
 */
export function buildPromptBlocks(request: CompletionRequest, agent: Pick<AcpInitializeResult, 'supportsImages'>): AcpPromptBlock[] {
  const blocks: AcpPromptBlock[] = [];
  const transcript: string[] = [];
  const images: AcpPromptBlock[] = [];
  let droppedImages = 0;

  for (const message of request.messages) {
    if (message.role === 'system') {
      transcript.push(`System instructions:\n${message.content}`);
      continue;
    }
    if (message.role === 'tool') {
      // Restricted mode means no tool loop; a stray tool message is history.
      transcript.push(`Tool result (${message.toolName ?? 'unknown'}):\n${message.content}`);
      continue;
    }
    transcript.push(`${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`);

    for (const image of message.images ?? []) {
      if (!agent.supportsImages) {
        droppedImages += 1;
        continue;
      }
      images.push({ type: 'image', data: image.dataBase64, mimeType: image.mimeType });
    }
  }

  if (droppedImages > 0) {
    transcript.push(`(${droppedImages} image attachment${droppedImages === 1 ? '' : 's'} omitted: this ACP agent does not declare image support.)`);
  }

  blocks.push({ type: 'text', text: transcript.join('\n\n') });
  blocks.push(...images);
  return blocks;
}

/**
 * One prompt turn against one agent process.
 *
 * Owns the JSON-RPC id counter, the pending-request table, and the stdout
 * framing buffer. A session is single-use: spawn, handshake, prompt, dispose.
 */
class AcpSession {
  private readonly process: AcpProcessHandle;
  private nextId = 1;
  private buffer = '';
  private stderr = '';
  private sessionId = '';
  private exited: { code: number | null; signal: string | null } | undefined;
  private disposed = false;
  private readonly pending = new Map<number, { resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  private onText: ((chunk: string) => void) | undefined;
  private text = '';
  private usage: { inputTokens?: number; outputTokens?: number } = {};

  constructor(
    private readonly agent: AcpAgentConfig,
    spawnProcess: AcpProcessFactory,
    private readonly cwd: string | undefined,
    private readonly clientVersion: string,
    private readonly timeoutMs: number,
    private readonly permissionPolicy?: AcpPermissionPolicy,
    private readonly onToolEvent?: AcpToolEventListener,
  ) {
    this.process = spawnProcess(agent, cwd);
    this.process.onStdout(chunk => this.ingest(chunk));
    // stderr is diagnostic only — kept bounded so a chatty agent cannot grow
    // the heap, and surfaced only when something actually fails.
    this.process.onStderr(chunk => { this.stderr = (this.stderr + chunk).slice(-4_000); });
    this.process.onExit((code, signal) => {
      this.exited = { code, signal };
      const reason = new Error(`The ACP agent exited (${signal ?? `code ${code ?? 'unknown'}`}).${this.stderr ? ` ${this.stderr.trim().slice(-500)}` : ''}`);
      for (const [, entry] of this.pending) {
        entry.reject(reason);
      }
      this.pending.clear();
    });
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.request(buildInitializeRequest(this.nextId, this.clientVersion));
    return parseInitializeResult(result);
  }

  async newSession(mcpServers: AcpMcpServer[]): Promise<void> {
    // The spec requires an absolute cwd. Falling back to the process cwd is
    // correct and observable; inventing a path would not be.
    const cwd = this.cwd ?? process.cwd();
    const result = await this.request(buildSessionNewRequest(this.nextId, cwd, mcpServers));
    this.sessionId = parseSessionId(result);
    if (!this.sessionId) {
      throw new Error('The ACP agent did not return a session id.');
    }
  }

  async prompt(
    blocks: AcpPromptBlock[],
    onTextChunk: ((chunk: string) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AcpTurnResult> {
    this.onText = onTextChunk;
    this.text = '';

    const abort = () => {
      if (this.sessionId) {
        this.send(buildSessionCancelNotification(this.sessionId));
      }
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      const result = await this.request(buildSessionPromptRequest(this.nextId, this.sessionId, blocks));
      const stop = parseStopReason(result);
      return {
        text: this.text,
        finishReason: toFinishReason(stop),
        // The spec's usage update is optional; absent counts are reported as 0
        // rather than estimated, because a fabricated token count would feed the
        // cost tracker a number nobody measured.
        inputTokens: this.usage.inputTokens ?? 0,
        outputTokens: this.usage.outputTokens ?? 0,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      this.onText = undefined;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pending.clear();
    if (!this.exited) {
      try {
        this.process.kill();
      } catch {
        // Already gone.
      }
    }
  }

  private request(frame: ReturnType<typeof buildInitializeRequest>): Promise<Record<string, unknown>> {
    const id = frame.id;
    this.nextId = id + 1;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The ACP agent did not answer ${frame.method} within ${Math.round(this.timeoutMs / 1000)}s.`));
      }, this.timeoutMs);
      const settle = {
        resolve: (result: Record<string, unknown>) => { clearTimeout(timer); resolve(result); },
        reject: (error: Error) => { clearTimeout(timer); reject(error); },
      };
      this.pending.set(id, settle);
      try {
        this.send(frame);
      } catch (error) {
        this.pending.delete(id);
        settle.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(frame: Parameters<typeof encodeAcpFrame>[0]): void {
    this.process.writeLine(encodeAcpFrame(frame));
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    const { lines, rest } = drainFrames(this.buffer);
    this.buffer = rest;
    for (const line of lines) {
      this.handleFrame(line);
    }
  }

  private handleFrame(line: string): void {
    const frame = parseAcpFrame(line);
    switch (frame.kind) {
      case 'response': {
        this.pending.get(frame.id)?.resolve(frame.result);
        this.pending.delete(frame.id);
        return;
      }
      case 'error': {
        this.pending.get(frame.id)?.reject(new Error(`The ACP agent returned an error (${frame.code}): ${frame.message}`));
        this.pending.delete(frame.id);
        return;
      }
      case 'notification': {
        if (frame.method === 'session/update') {
          this.applyUpdate(frame.params);
        }
        return;
      }
      case 'request': {
        // The agent is asking AtlasMind for something. `session/request_permission`
        // is the one method with an answer; everything else (fs/*, terminal/*,
        // elicitation/*) is refused, because AtlasMind declared it cannot do
        // those in `initialize` and an agent asking anyway is not a reason to
        // start.
        if (frame.method === ACP_PERMISSION_METHOD) {
          void this.answerPermission(frame.id, frame.params);
          return;
        }
        this.rejectAgentRequest(frame.id, frame.method);
        return;
      }
      default:
        // Unusable line (a banner, a partial, a malformed frame) — ignored by
        // design; a subprocess writing prose to stdout must not fail a turn.
        return;
    }
  }

  /**
   * Answer a `session/request_permission` request.
   *
   * The order of the guards is the policy. Before anything is asked of the user
   * the request must be *readable*, and before any approval can be granted a
   * policy must *exist* — a missing gate is a denial, never an open door. Only
   * then does the decision reach the user, and only an explicit `true` can
   * produce a selection of an allow option.
   *
   * Nothing here throws. This runs on the stdout read loop, where an exception
   * would strand the turn holding a permission the agent is still waiting on;
   * a failure to decide has to become a refusal on the wire instead.
   */
  private async answerPermission(id: number, params: Record<string, unknown>): Promise<void> {
    let request: AcpPermissionRequest | undefined;
    try {
      request = parsePermissionRequest(params);
    } catch {
      request = undefined;
    }

    if (!request) {
      this.rejectAgentRequestWith(id, 'AtlasMind could not read that permission request, so it was refused.');
      return;
    }

    // Announce the pending call before prompting: the approval dialog is about
    // to describe it, and the run log should already show what was asked.
    this.emitToolEvent(request.toolCall);

    if (!this.permissionPolicy) {
      this.rejectAgentRequestWith(
        id,
        'AtlasMind is running this agent without tool authorization enabled, so the operation was declined.',
      );
      return;
    }

    let approved = false;
    try {
      approved = await this.permissionPolicy(request) === true;
    } catch {
      // A gate that failed is a gate that did not approve.
      approved = false;
    }

    if (this.disposed) {
      return;
    }

    const resolution = resolveAcpPermission(request, approved);
    if (resolution.action === 'select') {
      this.process.writeLine(buildPermissionSelectedResponse(id, resolution.optionId));
      return;
    }
    if (resolution.action === 'cancelled') {
      this.process.writeLine(buildPermissionCancelledResponse(id));
      return;
    }
    this.rejectAgentRequestWith(id, resolution.message);
  }

  private emitToolEvent(toolCall: AcpToolCall): void {
    try {
      this.onToolEvent?.(toolCall);
    } catch {
      // A listener that throws must not take the turn down with it.
    }
  }

  /** JSON-RPC error reply: this client does not implement the method. */
  private rejectAgentRequest(id: number, method: string): void {
    this.process.writeLine(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `AtlasMind runs ACP agents in restricted mode and does not implement ${method}.`,
      },
    })}\n`);
  }

  /**
   * JSON-RPC error reply for a request we understood but will not grant.
   *
   * `-32603` (internal error) rather than `-32601`: the method exists and was
   * handled — the answer is no. Reporting "method not found" for a refusal would
   * invite an agent to conclude the client is too old and retry differently.
   */
  private rejectAgentRequestWith(id: number, message: string): void {
    this.process.writeLine(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    })}\n`);
  }

  private applyUpdate(params: Record<string, unknown>): void {
    const update = parseSessionUpdate(params);
    if (update.kind === 'text') {
      this.text += update.text;
      this.onText?.(update.text);
      return;
    }
    if (update.kind === 'tool_call') {
      this.emitToolEvent(update.toolCall);
      return;
    }
    if (update.kind === 'usage') {
      if (update.inputTokens !== undefined) { this.usage.inputTokens = update.inputTokens; }
      if (update.outputTokens !== undefined) { this.usage.outputTokens = update.outputTokens; }
    }
  }
}

/** Spawn the agent for real. Never through a shell, and never installed by us. */
const defaultAcpProcessFactory: AcpProcessFactory = (config, cwd) => {
  const child: ChildProcessWithoutNullStreams = spawn(config.command, config.args ?? [], {
    cwd,
    windowsHide: true,
    shell: false,
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return {
    writeLine: line => { child.stdin.write(line); },
    onStdout: listener => { child.stdout.on('data', listener); },
    onStderr: listener => { child.stderr.on('data', listener); },
    onExit: listener => {
      child.on('close', (code, signal) => listener(code, signal));
      child.on('error', error => listener(null, error.message));
    },
    kill: () => { child.kill(); },
  };
};

/** Read the user's configured agents, falling back to nothing (deny by default). */
export function parseAcpAgentSettings(raw: unknown): AcpAgentConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const agents: AcpAgentConfig[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 12)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'].trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32) : '';
    const command = typeof record['command'] === 'string' ? record['command'].trim().slice(0, 400) : '';
    if (!id || !command || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const args = Array.isArray(record['args'])
      ? record['args'].filter((arg): arg is string => typeof arg === 'string').slice(0, 20).map(arg => arg.slice(0, 400))
      : [];
    const env: Record<string, string> = {};
    if (typeof record['env'] === 'object' && record['env'] !== null) {
      for (const [key, value] of Object.entries(record['env'] as Record<string, unknown>).slice(0, 20)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string') {
          env[key] = value.slice(0, 2_000);
        }
      }
    }
    agents.push({
      id,
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(typeof record['label'] === 'string' ? { label: record['label'].slice(0, 80) } : {}),
    });
  }
  return agents;
}

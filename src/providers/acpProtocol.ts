/**
 * ACP wire framing — the pure half of the Agent Client Protocol adapter.
 *
 * ACP is JSON-RPC 2.0 spoken over a subprocess's stdio: "LSP, but for coding
 * agents". A **Client** (AtlasMind) drives an **Agent** (Claude Agent, Codex,
 * Gemini CLI…) and owns the conversation lifecycle:
 *
 *   initialize → session/new → session/prompt
 *
 * while the agent streams `session/update` notifications back and answers the
 * prompt with a `stopReason`.
 *
 * Everything here is **verified against the published specification**, not
 * inferred — the same discipline `buzzProtocol.ts` applies to `buzz-cli`. Field
 * names, the version-negotiation rule, the `stopReason` set, and the
 * `sessionUpdate` discriminators are taken from:
 *
 *   - https://agentclientprotocol.com/protocol/v1/initialization
 *   - https://agentclientprotocol.com/protocol/v1/session-setup
 *   - https://agentclientprotocol.com/protocol/v1/prompt-turn
 *   - https://agentclientprotocol.com/protocol/v1/content
 *
 * fetched 2026-07-28. ACP-defined property keys are `camelCase`; values carried
 * by discriminator fields are `snake_case` — a convention the spec states
 * explicitly and which this module follows rather than guesses at.
 *
 * **The agent's output is untrusted input.** It is a separate process whose
 * stdout is shaped by a model. Every parse here is total: it never throws, it
 * degrades to a typed "unusable" result, and it length-caps anything it keeps.
 * `vscode`-free and side-effect-free so the whole framing is unit-tested.
 */

/** The MAJOR protocol version AtlasMind speaks. A single integer, per the spec. */
export const ACP_PROTOCOL_VERSION = 1;

/** Where the contract above was read from, for the record. */
export const ACP_SPEC_SOURCE = 'https://agentclientprotocol.com/protocol/v1';
export const ACP_SPEC_VERIFIED_AT = '2026-07-28';

const MAX_FRAME_BYTES = 8_000_000;
const MAX_TEXT = 2_000_000;
const MAX_ID = 200;

// ── JSON-RPC framing ─────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/** What a single line off the agent's stdout turned out to be. */
export type AcpInboundFrame =
  | { kind: 'response'; id: number; result: Record<string, unknown> }
  | { kind: 'error'; id: number; code: number; message: string }
  | { kind: 'notification'; method: string; params: Record<string, unknown> }
  /** A request *from* the agent — it expects an answer addressed by this id. */
  | { kind: 'request'; id: number; method: string; params: Record<string, unknown> }
  | { kind: 'unusable'; reason: string };

/**
 * Parse one newline-delimited JSON-RPC frame from the agent.
 *
 * Never throws. A frame that is not JSON, not JSON-RPC 2.0, or missing the
 * fields its shape requires comes back as `unusable` with a reason, because a
 * malformed line from a subprocess must not be able to abort a completion.
 */
export function parseAcpFrame(line: string): AcpInboundFrame {
  if (typeof line !== 'string') {
    return { kind: 'unusable', reason: 'not a string' };
  }
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { kind: 'unusable', reason: 'empty line' };
  }
  if (trimmed.length > MAX_FRAME_BYTES) {
    return { kind: 'unusable', reason: 'frame exceeds the size cap' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Agents commonly emit human-readable banners on stdout before the first
    // frame; that is not an error condition, just a line we cannot use.
    return { kind: 'unusable', reason: 'not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'unusable', reason: 'not a JSON-RPC object' };
  }

  const frame = parsed as Record<string, unknown>;
  if (frame['jsonrpc'] !== '2.0') {
    return { kind: 'unusable', reason: 'missing jsonrpc 2.0 envelope' };
  }

  const hasId = typeof frame['id'] === 'number' && Number.isFinite(frame['id']);
  const method = typeof frame['method'] === 'string' ? frame['method'].slice(0, MAX_ID) : '';

  if (method && !hasId) {
    return { kind: 'notification', method, params: asRecord(frame['params']) };
  }
  if (method && hasId) {
    return { kind: 'request', id: frame['id'] as number, method, params: asRecord(frame['params']) };
  }
  if (!hasId) {
    return { kind: 'unusable', reason: 'no method and no id' };
  }

  const error = frame['error'];
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      kind: 'error',
      id: frame['id'] as number,
      code: typeof record['code'] === 'number' ? record['code'] : -1,
      message: clampText(record['message'], 500) || 'the agent reported an error with no message',
    };
  }
  if ('result' in frame) {
    return { kind: 'response', id: frame['id'] as number, result: asRecord(frame['result']) };
  }
  return { kind: 'unusable', reason: 'neither result nor error' };
}

/** Serialise a frame for the agent's stdin, newline-delimited. */
export function encodeAcpFrame(frame: JsonRpcRequest | JsonRpcNotification): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Split a growing stdout buffer into complete lines.
 *
 * Returns the frames that are complete and whatever partial text remains, so a
 * chunk boundary landing mid-frame never corrupts a message.
 */
export function drainFrames(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  return { lines: parts.filter(line => line.trim().length > 0), rest };
}

// ── Requests AtlasMind sends ─────────────────────────────────────

/**
 * `initialize` — version and capability negotiation, always the first call.
 *
 * The declared client capabilities are **deliberately empty**: at this tier the
 * agent is a completion source, not an executor, so AtlasMind offers it no
 * filesystem and no terminal. Claiming a capability it will not honour would be
 * worse than claiming none.
 */
export function buildInitializeRequest(id: number, clientVersion: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: 'atlasmind',
        title: 'AtlasMind',
        version: clampText(clientVersion, 40) || '0.0.0',
      },
    },
  };
}

/**
 * `session/new`.
 *
 * `cwd` MUST be absolute per the spec. `mcpServers` is sent **empty** at this
 * tier: handing the agent a tool surface is Tier 3 work that belongs behind the
 * approval gate, and an adapter that quietly passed servers through would hand
 * an external process AtlasMind's tools without one.
 */
export function buildSessionNewRequest(id: number, cwd: string): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/new',
    params: { cwd, mcpServers: [] },
  };
}

export interface AcpPromptBlock {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

/** `session/prompt`. Content blocks follow the spec's ContentBlock shapes. */
export function buildSessionPromptRequest(id: number, sessionId: string, blocks: AcpPromptBlock[]): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/prompt',
    params: {
      sessionId,
      prompt: blocks.map(block => (block.type === 'image'
        ? { type: 'image', mimeType: block.mimeType ?? 'image/png', data: block.data ?? '' }
        : { type: 'text', text: block.text ?? '' })),
    },
  };
}

/** `session/cancel` — a notification, so there is nothing to await. */
export function buildSessionCancelNotification(sessionId: string): JsonRpcNotification {
  return { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } };
}

// ── Responses AtlasMind reads ────────────────────────────────────

export interface AcpInitializeResult {
  /** The version the agent actually agreed to. */
  protocolVersion: number;
  /** True when the agent's version matches ours — the spec's negotiation rule. */
  compatible: boolean;
  agentName?: string;
  agentVersion?: string;
  /** Auth method ids the agent offers. A non-empty list means "not logged in". */
  authMethods: string[];
  supportsImages: boolean;
  supportsLoadSession: boolean;
}

/**
 * Read an `initialize` result.
 *
 * Per the spec the agent either echoes our version or answers with the latest it
 * supports; a mismatch means the connection should close and the user be told.
 * That decision is the caller's, so this reports `compatible` rather than
 * silently proceeding on a version nobody agreed to.
 */
export function parseInitializeResult(result: Record<string, unknown>): AcpInitializeResult {
  const version = typeof result['protocolVersion'] === 'number' ? result['protocolVersion'] : -1;
  const capabilities = asRecord(result['agentCapabilities']);
  const promptCapabilities = asRecord(capabilities['promptCapabilities']);
  const info = asRecord(result['agentInfo']);
  const authMethods: string[] = [];
  if (Array.isArray(result['authMethods'])) {
    for (const method of result['authMethods'].slice(0, 20)) {
      const id = typeof method === 'string' ? method : clampText(asRecord(method)['id'], MAX_ID);
      if (id) {
        authMethods.push(id.slice(0, MAX_ID));
      }
    }
  }
  return {
    protocolVersion: version,
    compatible: version === ACP_PROTOCOL_VERSION,
    ...(clampText(info['name'], 80) ? { agentName: clampText(info['name'], 80) } : {}),
    ...(clampText(info['version'], 40) ? { agentVersion: clampText(info['version'], 40) } : {}),
    authMethods,
    supportsImages: promptCapabilities['image'] === true,
    supportsLoadSession: capabilities['loadSession'] === true,
  };
}

/** Read the `sessionId` from a `session/new` result; '' when unusable. */
export function parseSessionId(result: Record<string, unknown>): string {
  return clampText(result['sessionId'], MAX_ID);
}

/** The turn outcomes the spec defines for `session/prompt`. */
export const ACP_STOP_REASONS = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'] as const;
export type AcpStopReason = (typeof ACP_STOP_REASONS)[number];

/**
 * Read a prompt result's `stopReason`.
 *
 * An unrecognised value maps to `refusal` rather than `end_turn`: a turn whose
 * outcome we cannot read is not a turn we should report as having completed
 * normally.
 */
export function parseStopReason(result: Record<string, unknown>): AcpStopReason {
  const raw = clampText(result['stopReason'], 40);
  return (ACP_STOP_REASONS as readonly string[]).includes(raw) ? raw as AcpStopReason : 'refusal';
}

/** Map a stop reason onto the adapter contract's `finishReason`. */
export function toFinishReason(stop: AcpStopReason): 'stop' | 'length' | 'error' {
  if (stop === 'max_tokens' || stop === 'max_turn_requests') {
    return 'length';
  }
  return stop === 'end_turn' ? 'stop' : 'error';
}

// ── session/update notifications ─────────────────────────────────

export type AcpSessionUpdate =
  /** A streamed slice of the assistant's reply. */
  | { kind: 'text'; sessionId: string; text: string; messageId?: string }
  /** The agent reported token usage for the turn. */
  | { kind: 'usage'; sessionId: string; inputTokens?: number; outputTokens?: number }
  /**
   * Anything else the spec defines (`plan`, `tool_call`, `tool_call_update`, …).
   * Reported rather than dropped so the caller can log it, but not interpreted:
   * at this tier the agent runs with no tools, so a tool-call update is a
   * signal that something is wrong, not something to act on.
   */
  | { kind: 'other'; sessionId: string; sessionUpdate: string }
  | { kind: 'unusable'; reason: string };

/**
 * Interpret a `session/update` notification's params.
 *
 * Total by construction: an unknown discriminator, a missing content block, or a
 * non-text chunk all yield a typed result instead of an exception, because this
 * runs inside a streaming read loop where a throw would strand the turn.
 */
export function parseSessionUpdate(params: Record<string, unknown>): AcpSessionUpdate {
  const sessionId = clampText(params['sessionId'], MAX_ID);
  const update = asRecord(params['update']);
  const discriminator = clampText(update['sessionUpdate'], 60);
  if (!discriminator) {
    return { kind: 'unusable', reason: 'no sessionUpdate discriminator' };
  }

  if (discriminator === 'agent_message_chunk') {
    const content = asRecord(update['content']);
    if (content['type'] !== 'text') {
      // Image or audio chunks are legal in the spec but have no place in a text
      // completion; reporting them keeps the branch honest rather than silent.
      return { kind: 'other', sessionId, sessionUpdate: `${discriminator}:${clampText(content['type'], 40) || 'unknown'}` };
    }
    const text = clampText(content['text'], MAX_TEXT);
    const messageId = clampText(update['messageId'], MAX_ID);
    return { kind: 'text', sessionId, text, ...(messageId ? { messageId } : {}) };
  }

  if (discriminator === 'usage_update') {
    const usage = asRecord(update['usage']);
    const input = readCount(usage['inputTokens'] ?? update['inputTokens']);
    const output = readCount(usage['outputTokens'] ?? update['outputTokens']);
    return {
      kind: 'usage',
      sessionId,
      ...(input === undefined ? {} : { inputTokens: input }),
      ...(output === undefined ? {} : { outputTokens: output }),
    };
  }

  return { kind: 'other', sessionId, sessionUpdate: discriminator };
}

// ── helpers ──────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), 1_000_000_000)
    : undefined;
}

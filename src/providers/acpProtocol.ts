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

/**
 * The typed schema the enum values below were read from.
 *
 * The published prose pages truncate before the permission and MCP definitions,
 * so the enum spellings here come from the **schema crate itself** — the same
 * discipline `buzzProtocol.ts` applies by reading `buzz-core/src/kind.rs` rather
 * than trusting a rendered page. Two contract details found there would have been
 * got wrong by guessing from the prose:
 *
 * - `RequestPermissionOutcome` is `#[serde(tag = "outcome")]`, and the response
 *   *also* wraps it in a field called `outcome` — so the wire shape is the
 *   double-nested `{"outcome":{"outcome":"selected","optionId":"…"}}`.
 * - `McpServer::Stdio` is `#[serde(untagged)]`, so a stdio entry carries **no**
 *   `type` discriminator, while `http` and `sse` do.
 */
export const ACP_SCHEMA_SOURCE =
  'https://github.com/zed-industries/agent-client-protocol/tree/main/agent-client-protocol-schema/src/v1';

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
 * `fs` and `terminal` stay **false even with tools enabled**, and that is a
 * deliberate reading of what these flags mean rather than an oversight.
 *
 * They do not sandbox the agent. A coding agent like `claude-code-acp` carries
 * its own filesystem and shell access; declaring `fs: false` does not take that
 * away, it only declines to *proxy* the I/O on the agent's behalf. So the flags
 * decide **who performs** an operation, not **whether** it may happen. The thing
 * that decides whether it may happen is `session/request_permission`, which is
 * why the whole of this tier's safety budget went there.
 *
 * Turning them on would add a genuine write path (`fs/write_text_file`) and a
 * genuine command-execution path (`terminal/create`) into AtlasMind itself, each
 * needing its own path-traversal and lifetime handling, in exchange for no
 * capability the agent does not already have. That is a separate piece of work
 * with its own test surface, recorded as Tier 4 — not a flag to flip in passing.
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
 * An MCP server AtlasMind is willing to hand to an ACP agent.
 *
 * Only the stdio transport is modelled. Every agent MUST support stdio, whereas
 * `http`/`sse` are gated on `mcpCapabilities` the agent may not advertise — and
 * an HTTP entry carries bearer headers, so it is the shape most likely to leak a
 * credential into a third-party process. Stdio-only keeps the blast radius to
 * servers the user already runs locally.
 */
export interface AcpMcpServer {
  name: string;
  /** Spec: "Absolute path to the MCP server executable." */
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

/**
 * `session/new`.
 *
 * `cwd` MUST be absolute per the spec.
 *
 * `mcpServers` defaults to empty and stays empty unless the caller passes an
 * explicit list. Handing an agent a tool surface is a capability grant, so the
 * default has to be "none" — the allowlist that fills this comes from a setting
 * the user ticks per server, never from "every server AtlasMind happens to know".
 *
 * The stdio entry is emitted **without** a `type` field: the schema marks that
 * variant `#[serde(untagged)]`, so adding the discriminator the http/sse
 * variants use would make the entry fail to deserialize.
 */
export function buildSessionNewRequest(id: number, cwd: string, mcpServers: AcpMcpServer[] = []): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/new',
    params: {
      cwd,
      mcpServers: mcpServers.map(server => ({
        name: server.name,
        command: server.command,
        args: server.args,
        env: server.env.map(entry => ({ name: entry.name, value: entry.value })),
      })),
    },
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
  /**
   * `promptCapabilities.audio`. Read and reported, but nothing sends audio: an
   * AtlasMind `ChatMessage` has no audio field, so there is no path that could
   * produce an audio block. Speech reaches models as text, transcribed by
   * `LocalTranscriber` first. Surfacing the flag keeps the diagnostic honest
   * without adding a content branch nothing can reach.
   */
  supportsAudio: boolean;
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
    supportsAudio: promptCapabilities['audio'] === true,
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

/**
 * Tool-call lifecycle values, taken verbatim from the schema crate's `ToolKind`
 * and `ToolCallStatus`.
 *
 * `ToolKind` carries `#[serde(other)] Other`, so an agent on a newer schema
 * deserializes an unrecognised kind to `other` rather than failing — which means
 * `other` is not "miscellaneous", it is **"a kind this build cannot identify"**.
 * The risk mapping treats it accordingly.
 */
export const ACP_TOOL_KINDS = [
  'read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other',
] as const;
export type AcpToolKind = (typeof ACP_TOOL_KINDS)[number];

export const ACP_TOOL_CALL_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const;
export type AcpToolCallStatus = (typeof ACP_TOOL_CALL_STATUSES)[number];

/** What the agent says it is doing. Every field is model-shaped, so every field is clamped. */
export interface AcpToolCall {
  toolCallId: string;
  title: string;
  kind: AcpToolKind;
  status: AcpToolCallStatus;
  /** File paths the call touches, as reported. Display only — never resolved. */
  locations: string[];
  /** True for `tool_call_update` — a change to a call already announced. */
  isUpdate: boolean;
}

export type AcpSessionUpdate =
  /** A streamed slice of the assistant's reply. */
  | { kind: 'text'; sessionId: string; text: string; messageId?: string }
  /** The agent reported token usage for the turn. */
  | { kind: 'usage'; sessionId: string; inputTokens?: number; outputTokens?: number }
  /**
   * The agent announced or updated a tool call.
   *
   * Surfaced rather than swallowed because an executing agent whose actions are
   * invisible is the failure mode worth engineering against: the permission gate
   * decides what may run, and this is what lets a user see what did.
   */
  | { kind: 'tool_call'; sessionId: string; toolCall: AcpToolCall }
  /** Anything else the spec defines (`plan`, `available_commands_update`, …). */
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

  if (discriminator === 'tool_call' || discriminator === 'tool_call_update') {
    const toolCall = parseToolCall(update, discriminator === 'tool_call_update');
    return toolCall
      ? { kind: 'tool_call', sessionId, toolCall }
      : { kind: 'other', sessionId, sessionUpdate: `${discriminator}:no-id` };
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

// ── session/request_permission ───────────────────────────────────

export const ACP_PERMISSION_METHOD = 'session/request_permission';

/** `PermissionOptionKind`, verbatim from the schema crate. */
export const ACP_PERMISSION_OPTION_KINDS = ['allow_once', 'allow_always', 'reject_once', 'reject_always'] as const;
export type AcpPermissionOptionKind = (typeof ACP_PERMISSION_OPTION_KINDS)[number];

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: AcpPermissionOptionKind;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: AcpToolCall;
  options: AcpPermissionOption[];
}

/**
 * Read a `session/request_permission` request.
 *
 * Returns `undefined` when the request cannot be understood — an unreadable
 * permission request must not be answered, because answering one whose contents
 * we could not parse is authorizing an unknown operation. The caller's only safe
 * response to `undefined` is a JSON-RPC error.
 *
 * Options with an unrecognised `kind` are **dropped**, not coerced. Coercing an
 * unknown kind toward `allow_*` would invent consent; coercing it toward
 * `reject_*` would let a malformed option be selected as a denial that the agent
 * may not interpret as one. Dropping leaves the decision to the options we can
 * actually read.
 */
export function parsePermissionRequest(params: Record<string, unknown>): AcpPermissionRequest | undefined {
  const sessionId = clampText(params['sessionId'], MAX_ID);
  const toolCall = parseToolCall(asRecord(params['toolCall']), true);
  if (!toolCall) {
    return undefined;
  }

  const options: AcpPermissionOption[] = [];
  const raw = Array.isArray(params['options']) ? params['options'].slice(0, 20) : [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const optionId = clampText(record['optionId'], MAX_ID);
    const kind = clampText(record['kind'], 40);
    if (!optionId || !(ACP_PERMISSION_OPTION_KINDS as readonly string[]).includes(kind)) {
      continue;
    }
    options.push({
      optionId,
      name: sanitizeLine(record['name'], 120) || optionId,
      kind: kind as AcpPermissionOptionKind,
    });
  }

  return { sessionId, toolCall, options };
}

/**
 * The response to a permission request.
 *
 * Note the double nesting: `RequestPermissionResponse.outcome` holds a
 * `RequestPermissionOutcome`, which is itself internally tagged by a field also
 * called `outcome`. The schema comment calls this "unfortunately needed because
 * the output must be an object" — it is easy to flatten by accident, and a
 * flattened reply is silently ignored by the agent.
 */
export function buildPermissionSelectedResponse(id: number, optionId: string): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { outcome: { outcome: 'selected', optionId } },
  })}\n`;
}

/**
 * `cancelled` — reserved for exactly what the spec reserves it for.
 *
 * The spec requires this outcome when a `session/cancel` has been sent, so it
 * means "the turn went away", not "the user said no". Using it as a general
 * denial would tell an agent its request was abandoned rather than refused.
 */
export function buildPermissionCancelledResponse(id: number): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { outcome: { outcome: 'cancelled' } },
  })}\n`;
}

// ── helpers ──────────────────────────────────────────────────────

/**
 * Read a `ToolCall` / `ToolCallUpdate` body.
 *
 * `toolCallId` is the only field required in both shapes, so it is the only one
 * whose absence is fatal. Everything else is model-written text headed for a
 * confirmation dialog, so it is stripped of control characters and clamped —
 * a tool titled with a hundred newlines must not be able to push the buttons of
 * that dialog off the screen.
 */
function parseToolCall(update: Record<string, unknown>, isUpdate: boolean): AcpToolCall | undefined {
  const toolCallId = clampText(update['toolCallId'], MAX_ID);
  if (!toolCallId) {
    return undefined;
  }
  const kind = clampText(update['kind'], 40);
  const status = clampText(update['status'], 40);
  const locations: string[] = [];
  if (Array.isArray(update['locations'])) {
    for (const entry of update['locations'].slice(0, 20)) {
      const path = sanitizeLine(asRecord(entry)['path'], 300);
      if (path) {
        locations.push(path);
      }
    }
  }
  return {
    toolCallId,
    title: sanitizeLine(update['title'], 200),
    kind: (ACP_TOOL_KINDS as readonly string[]).includes(kind) ? kind as AcpToolKind : 'other',
    status: (ACP_TOOL_CALL_STATUSES as readonly string[]).includes(status) ? status as AcpToolCallStatus : 'pending',
    locations,
    isUpdate,
  };
}

/** Clamp to a single line: control characters out, length capped. */
function sanitizeLine(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : char;
    if (out.length >= max) {
      break;
    }
  }
  return out.slice(0, max).trim();
}

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

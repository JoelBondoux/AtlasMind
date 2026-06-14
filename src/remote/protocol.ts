// Node-free wire protocol shared by the desktop remote-control server and the
// browser thin client. MUST NOT import Node built-ins or the `vscode` runtime so
// it can be bundled into the web (Web Worker) build. See docs/remote-control.md.
import { isChatPanelMessage, type ChatPanelMessage } from '../views/chatProtocol.js';

export const REMOTE_PROTOCOL_VERSION = 1 as const;

/** Logical surfaces multiplexed over a single connection. */
export type RemoteChannel = 'chat' | 'cost' | 'runs';

/** Frame kinds. `auth` must be the first frame a client sends. */
export type RemoteFrameKind = 'auth' | 'msg' | 'rpc' | 'ack' | 'error';

export interface RemoteEnvelope {
  v: number;
  kind: RemoteFrameKind;
  /** Correlation id for `rpc` → `ack` round-trips. */
  id?: string;
  channel: RemoteChannel;
  payload?: unknown;
}

export interface RemoteAuthPayload {
  token: string;
  clientName?: string;
}

/** Read-only RPC method names for the `cost` and `runs` channels. */
export const REMOTE_RPC_METHODS = ['cost.snapshot', 'runs.list', 'runs.detail'] as const;
export type RemoteRpcMethod = (typeof REMOTE_RPC_METHODS)[number];

export interface RemoteRpcRequest {
  method: RemoteRpcMethod;
  params?: Record<string, unknown>;
}

export interface RemoteErrorPayload {
  code: 'unauthenticated' | 'invalid-frame' | 'unsupported' | 'internal';
  message: string;
}

// ── Read-only RPC result shapes (cost/runs channels) ─────────────────────────

export interface RemoteCostSnapshot {
  summary: {
    totalCostUsd: number;
    totalBudgetCostUsd: number;
    totalSubscriptionIncludedUsd: number;
    totalCompressionSavingsUsd: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  todayCostUsd: number;
}

export interface RemoteRunSummary {
  id: string;
  title: string;
  goal: string;
  status: string;
  updatedAt: string;
  completedSubtaskCount: number;
  totalSubtaskCount: number;
}

export interface RemoteRunsList {
  runs: RemoteRunSummary[];
}

export function isRemoteChannel(value: unknown): value is RemoteChannel {
  return value === 'chat' || value === 'cost' || value === 'runs';
}

export function isRemoteEnvelope(value: unknown): value is RemoteEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const env = value as Record<string, unknown>;
  return typeof env['v'] === 'number'
    && (env['kind'] === 'auth' || env['kind'] === 'msg' || env['kind'] === 'rpc' || env['kind'] === 'ack' || env['kind'] === 'error')
    && isRemoteChannel(env['channel'])
    && (env['id'] === undefined || typeof env['id'] === 'string');
}

export function isRemoteAuthPayload(value: unknown): value is RemoteAuthPayload {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { token?: unknown }).token === 'string'
    && (value as { token: string }).token.length > 0;
}

export function isRemoteRpcRequest(value: unknown): value is RemoteRpcRequest {
  return typeof value === 'object'
    && value !== null
    && (REMOTE_RPC_METHODS as readonly string[]).includes((value as { method?: unknown }).method as string);
}

/** Validate a chat-channel `msg` frame payload as a genuine ChatPanelMessage. */
export function isChatChannelPayload(value: unknown): value is ChatPanelMessage {
  return isChatPanelMessage(value);
}

export function encodeFrame(envelope: RemoteEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeFrame(data: string): RemoteEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  return isRemoteEnvelope(parsed) ? parsed : undefined;
}

/** Convenience builders. */
export function chatFrame(message: ChatPanelMessage | unknown): RemoteEnvelope {
  return { v: REMOTE_PROTOCOL_VERSION, kind: 'msg', channel: 'chat', payload: message };
}

export function errorFrame(payload: RemoteErrorPayload, id?: string): RemoteEnvelope {
  return { v: REMOTE_PROTOCOL_VERSION, kind: 'error', channel: 'chat', id, payload };
}

export function ackFrame(channel: RemoteChannel, id: string, payload: unknown): RemoteEnvelope {
  return { v: REMOTE_PROTOCOL_VERSION, kind: 'ack', channel, id, payload };
}

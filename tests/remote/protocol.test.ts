import { describe, it, expect } from 'vitest';
import {
  REMOTE_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  isRemoteEnvelope,
  isRemoteAuthPayload,
  isRemoteRpcRequest,
  isChatChannelPayload,
  chatFrame,
  errorFrame,
  ackFrame,
  type RemoteEnvelope,
} from '../../src/remote/protocol.ts';

describe('remote protocol envelope', () => {
  it('round-trips a valid envelope', () => {
    const env: RemoteEnvelope = { v: REMOTE_PROTOCOL_VERSION, kind: 'msg', channel: 'chat', payload: { type: 'stopPrompt' } };
    const decoded = decodeFrame(encodeFrame(env));
    expect(decoded).toEqual(env);
  });

  it('rejects malformed JSON', () => {
    expect(decodeFrame('not json')).toBeUndefined();
    expect(decodeFrame('{"v":')).toBeUndefined();
  });

  it('rejects structurally invalid envelopes', () => {
    expect(isRemoteEnvelope({ kind: 'msg', channel: 'chat' })).toBe(false); // no v
    expect(isRemoteEnvelope({ v: 1, kind: 'bogus', channel: 'chat' })).toBe(false);
    expect(isRemoteEnvelope({ v: 1, kind: 'msg', channel: 'nope' })).toBe(false);
    expect(isRemoteEnvelope({ v: 1, kind: 'rpc', channel: 'cost', id: 5 })).toBe(false); // id not string
  });

  it('accepts well-formed envelopes', () => {
    expect(isRemoteEnvelope({ v: 1, kind: 'msg', channel: 'chat' })).toBe(true);
    expect(isRemoteEnvelope({ v: 1, kind: 'rpc', channel: 'cost', id: 'rpc-1', payload: {} })).toBe(true);
  });
});

describe('auth payload validation', () => {
  it('requires a non-empty token string', () => {
    expect(isRemoteAuthPayload({ token: 'abc' })).toBe(true);
    expect(isRemoteAuthPayload({ token: '' })).toBe(false);
    expect(isRemoteAuthPayload({ token: 123 })).toBe(false);
    expect(isRemoteAuthPayload({})).toBe(false);
    expect(isRemoteAuthPayload(null)).toBe(false);
  });
});

describe('rpc request validation', () => {
  it('only accepts known methods', () => {
    expect(isRemoteRpcRequest({ method: 'cost.snapshot' })).toBe(true);
    expect(isRemoteRpcRequest({ method: 'runs.list', params: { limit: 5 } })).toBe(true);
    expect(isRemoteRpcRequest({ method: 'runs.delete' })).toBe(false);
    expect(isRemoteRpcRequest({ method: 'rm -rf' })).toBe(false);
    expect(isRemoteRpcRequest({})).toBe(false);
  });
});

describe('chat channel payload validation', () => {
  it('delegates to the shared chat message validator', () => {
    expect(isChatChannelPayload({ type: 'submitPrompt', payload: { prompt: 'hi', mode: 'send' } })).toBe(true);
    expect(isChatChannelPayload({ type: 'resolveToolApproval', payload: { requestId: 'a', decision: 'deny' } })).toBe(true);
    expect(isChatChannelPayload({ type: 'totally-fake-message' })).toBe(false);
    expect(isChatChannelPayload({ type: 'submitPrompt', payload: { prompt: 'hi', mode: 'evil-mode' } })).toBe(false);
  });
});

describe('frame builders', () => {
  it('builds chat/error/ack frames at the current protocol version', () => {
    expect(chatFrame({ type: 'stopPrompt' })).toMatchObject({ v: REMOTE_PROTOCOL_VERSION, kind: 'msg', channel: 'chat' });
    expect(errorFrame({ code: 'unauthenticated', message: 'no' }, 'id-1')).toMatchObject({ kind: 'error', id: 'id-1' });
    expect(ackFrame('cost', 'id-2', { ok: true })).toMatchObject({ kind: 'ack', channel: 'cost', id: 'id-2' });
  });
});

describe('redaction boundary', () => {
  it('chat channel rejects payloads carrying unknown/secret-bearing message types', () => {
    // Only declared ChatPanelMessage shapes pass; an attacker cannot smuggle an
    // arbitrary "type" to reach an unintended handler or exfiltrate state.
    const smuggled = { type: 'readSecret', payload: { key: 'atlasmind.provider.openai.apiKey' } };
    expect(isChatChannelPayload(smuggled)).toBe(false);
  });
});

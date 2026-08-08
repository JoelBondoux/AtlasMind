import { describe, it, expect } from 'vitest';
import {
  REMOTE_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
  isRemoteEnvelope,
  isRemoteAuthPayload,
  isRemoteRpcRequest,
  isRemoteChannel,
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

// The buzz channel is read-only by construction — the browser never touches a relay,
// because NIP-42 auth needs the agent key and that key never leaves SecretStorage.
// These pin the channel's admission and, more importantly, the absence of a send path.
describe('buzz channel', () => {
  it('accepts buzz as a channel on the wire', () => {
    expect(isRemoteChannel('buzz')).toBe(true);
    const env: RemoteEnvelope = { v: REMOTE_PROTOCOL_VERSION, kind: 'rpc', id: 'r1', channel: 'buzz', payload: { method: 'buzz.status' } };
    expect(decodeFrame(encodeFrame(env))).toEqual(env);
  });

  it('admits the three read-only buzz methods and nothing else', () => {
    for (const method of ['buzz.status', 'buzz.channels', 'buzz.messages']) {
      expect(isRemoteRpcRequest({ method })).toBe(true);
    }
    for (const method of ['buzz.send', 'buzz.publish', 'buzz.key', 'buzz.sign']) {
      expect(isRemoteRpcRequest({ method })).toBe(false);
    }
  });

  it('still rejects an unknown channel', () => {
    expect(isRemoteChannel('relay')).toBe(false);
    expect(isRemoteEnvelope({ v: 1, kind: 'rpc', channel: 'relay' })).toBe(false);
  });

  it('builds an ack on the buzz channel', () => {
    const ack = ackFrame('buzz', 'r1', { messages: [] });
    expect(ack).toEqual({ v: REMOTE_PROTOCOL_VERSION, kind: 'ack', channel: 'buzz', id: 'r1', payload: { messages: [] } });
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACP_PROTOCOL_VERSION,
  ACP_STOP_REASONS,
  buildInitializeRequest,
  buildSessionCancelNotification,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  drainFrames,
  encodeAcpFrame,
  parseAcpFrame,
  parseInitializeResult,
  parseSessionId,
  parseSessionUpdate,
  parseStopReason,
  toFinishReason,
} from '../../src/providers/acpProtocol.ts';

describe('parseAcpFrame — untrusted subprocess output', () => {
  it('reads a response frame', () => {
    const frame = parseAcpFrame('{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess_1"}}');
    expect(frame).toEqual({ kind: 'response', id: 1, result: { sessionId: 'sess_1' } });
  });

  it('reads an error frame', () => {
    const frame = parseAcpFrame('{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"boom"}}');
    expect(frame).toMatchObject({ kind: 'error', id: 2, code: -32000, message: 'boom' });
  });

  it('reads a notification (no id) and a request (id + method) differently', () => {
    expect(parseAcpFrame('{"jsonrpc":"2.0","method":"session/update","params":{"a":1}}'))
      .toMatchObject({ kind: 'notification', method: 'session/update' });
    expect(parseAcpFrame('{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{}}'))
      .toMatchObject({ kind: 'request', id: 7, method: 'session/request_permission' });
  });

  it('never throws on anything a subprocess might print', () => {
    // Agents commonly emit banners and progress prose on stdout before the
    // first frame; none of it may abort a turn.
    for (const line of ['', '   ', 'Starting agent…', '{ not json', '[1,2,3]', 'null', '{"jsonrpc":"1.0","id":1}']) {
      expect(parseAcpFrame(line).kind).toBe('unusable');
    }
    expect(parseAcpFrame(undefined as unknown as string).kind).toBe('unusable');
  });

  it('rejects a frame with neither result nor error', () => {
    expect(parseAcpFrame('{"jsonrpc":"2.0","id":1}')).toMatchObject({ kind: 'unusable' });
  });

  it('refuses an oversized frame rather than buffering it', () => {
    const huge = `{"jsonrpc":"2.0","id":1,"result":{"t":"${'x'.repeat(9_000_000)}"}}`;
    expect(parseAcpFrame(huge)).toMatchObject({ kind: 'unusable', reason: 'frame exceeds the size cap' });
  });
});

describe('drainFrames', () => {
  it('keeps a partial trailing frame for the next chunk', () => {
    const { lines, rest } = drainFrames('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":');
  });

  it('drops blank lines and returns nothing usable from an empty buffer', () => {
    expect(drainFrames('\n\n')).toEqual({ lines: [], rest: '' });
  });
});

describe('outbound requests match the published spec', () => {
  it('initialize declares NO filesystem and NO terminal capability', () => {
    // Restricted mode is what lets Tier 1 ship without touching the
    // authorization gate — claiming a capability we will not honour is worse
    // than claiming none.
    const request = buildInitializeRequest(1, '0.170.0');
    expect(request).toMatchObject({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(request.params).toEqual({
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'atlasmind', title: 'AtlasMind', version: '0.170.0' },
    });
  });

  it('session/new sends an absolute cwd and an EMPTY mcpServers list', () => {
    // Handing an agent a tool surface is Tier 3 work that belongs behind the
    // approval gate; passing servers through here would skip it.
    const request = buildSessionNewRequest(2, '/home/user/project');
    expect(request.params).toEqual({ cwd: '/home/user/project', mcpServers: [] });
  });

  it('session/prompt builds spec-shaped text and image content blocks', () => {
    const request = buildSessionPromptRequest(3, 'sess_1', [
      { type: 'text', text: 'hello' },
      { type: 'image', data: 'BASE64', mimeType: 'image/png' },
    ]);
    expect(request.params).toEqual({
      sessionId: 'sess_1',
      prompt: [
        { type: 'text', text: 'hello' },
        { type: 'image', mimeType: 'image/png', data: 'BASE64' },
      ],
    });
  });

  it('session/cancel is a notification, so it carries no id', () => {
    const frame = buildSessionCancelNotification('sess_1');
    expect(frame).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'sess_1' } });
    expect('id' in frame).toBe(false);
  });

  it('encodes frames newline-delimited', () => {
    const encoded = encodeAcpFrame(buildSessionCancelNotification('s'));
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded.trimEnd().includes('\n')).toBe(false);
  });
});

describe('parseInitializeResult', () => {
  it('reads the negotiated version, capabilities, and auth methods', () => {
    const result = parseInitializeResult({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: false } },
      agentInfo: { name: 'claude-agent-acp', version: '1.2.3' },
      authMethods: [],
    });
    expect(result).toMatchObject({
      protocolVersion: 1,
      compatible: true,
      agentName: 'claude-agent-acp',
      agentVersion: '1.2.3',
      supportsImages: true,
      supportsLoadSession: true,
      authMethods: [],
    });
  });

  it('reports an incompatible version rather than proceeding on it', () => {
    // The spec says the agent answers with the latest version IT supports; the
    // client must then close the connection and tell the user.
    expect(parseInitializeResult({ protocolVersion: 99 }).compatible).toBe(false);
    expect(parseInitializeResult({}).compatible).toBe(false);
  });

  it('reads auth methods given either as strings or as objects', () => {
    expect(parseInitializeResult({ protocolVersion: 1, authMethods: ['oauth'] }).authMethods).toEqual(['oauth']);
    expect(parseInitializeResult({ protocolVersion: 1, authMethods: [{ id: 'login' }] }).authMethods).toEqual(['login']);
  });

  it('treats absent capabilities as absent, not as present', () => {
    const result = parseInitializeResult({ protocolVersion: 1 });
    expect(result.supportsImages).toBe(false);
    expect(result.supportsLoadSession).toBe(false);
  });
});

describe('stop reasons', () => {
  it('reads every value the spec defines', () => {
    for (const reason of ACP_STOP_REASONS) {
      expect(parseStopReason({ stopReason: reason })).toBe(reason);
    }
  });

  it('maps an unreadable outcome to refusal, never to end_turn', () => {
    // A turn whose outcome we cannot read is not a turn that completed normally.
    expect(parseStopReason({ stopReason: 'something_new' })).toBe('refusal');
    expect(parseStopReason({})).toBe('refusal');
  });

  it('maps stop reasons onto the adapter contract', () => {
    expect(toFinishReason('end_turn')).toBe('stop');
    expect(toFinishReason('max_tokens')).toBe('length');
    expect(toFinishReason('max_turn_requests')).toBe('length');
    expect(toFinishReason('refusal')).toBe('error');
    expect(toFinishReason('cancelled')).toBe('error');
  });
});

describe('parseSessionUpdate', () => {
  it('reads an agent_message_chunk as streamable text', () => {
    const update = parseSessionUpdate({
      sessionId: 'sess_1',
      update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hi' } },
    });
    expect(update).toEqual({ kind: 'text', sessionId: 'sess_1', text: 'hi', messageId: 'm1' });
  });

  it('reports a non-text chunk instead of silently dropping it', () => {
    const update = parseSessionUpdate({
      sessionId: 's',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'x' } },
    });
    expect(update).toMatchObject({ kind: 'other', sessionUpdate: 'agent_message_chunk:image' });
  });

  it('reads usage updates from either nesting the spec allows', () => {
    expect(parseSessionUpdate({ sessionId: 's', update: { sessionUpdate: 'usage_update', usage: { inputTokens: 10, outputTokens: 4 } } }))
      .toMatchObject({ kind: 'usage', inputTokens: 10, outputTokens: 4 });
    expect(parseSessionUpdate({ sessionId: 's', update: { sessionUpdate: 'usage_update', inputTokens: 7 } }))
      .toMatchObject({ kind: 'usage', inputTokens: 7 });
  });

  it('rejects a negative or non-numeric token count rather than recording it', () => {
    const update = parseSessionUpdate({ sessionId: 's', update: { sessionUpdate: 'usage_update', usage: { inputTokens: -5, outputTokens: 'lots' } } });
    expect(update).toEqual({ kind: 'usage', sessionId: 's' });
  });

  it('passes other spec discriminators through as themselves', () => {
    for (const kind of ['plan', 'available_commands_update', 'current_mode_update']) {
      expect(parseSessionUpdate({ sessionId: 's', update: { sessionUpdate: kind } }))
        .toEqual({ kind: 'other', sessionId: 's', sessionUpdate: kind });
    }
  });

  it('surfaces tool calls so a delegated agent\'s actions are visible', () => {
    const update = parseSessionUpdate({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_1',
        title: 'Reading configuration file',
        kind: 'read',
        status: 'pending',
        locations: [{ path: '/project/config.json', line: 4 }],
      },
    });
    expect(update).toEqual({
      kind: 'tool_call',
      sessionId: 's',
      toolCall: {
        toolCallId: 'call_1',
        title: 'Reading configuration file',
        kind: 'read',
        status: 'pending',
        locations: ['/project/config.json'],
        isUpdate: false,
      },
    });
  });

  it('maps an unrecognised tool kind to `other` rather than dropping the call', () => {
    // ToolKind is `#[serde(other)]`, so a newer agent's kind lands here — and
    // `other` is the highest-risk bucket, not a shrug.
    const update = parseSessionUpdate({
      sessionId: 's',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_2', kind: 'teleport', status: 'running' },
    });
    expect(update).toMatchObject({
      kind: 'tool_call',
      toolCall: { toolCallId: 'call_2', kind: 'other', status: 'pending', isUpdate: true },
    });
  });

  it('strips control characters from a model-written tool title', () => {
    const update = parseSessionUpdate({
      sessionId: 's',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_3',
        kind: 'execute',
        title: `Harmless${String.fromCharCode(10)}${String.fromCharCode(10)}ALLOW ALL${String.fromCharCode(0)}`,
      },
    });
    const title = (update as { toolCall: { title: string } }).toolCall.title;
    const codes = [...title].map(char => char.codePointAt(0) ?? 0);
    expect(codes.every(code => code >= 0x20 && code !== 0x7f)).toBe(true);
    expect(title).toBe('Harmless  ALLOW ALL');
  });

  it('drops a tool call with no id rather than inventing one', () => {
    expect(parseSessionUpdate({ sessionId: 's', update: { sessionUpdate: 'tool_call', title: 'nameless' } }))
      .toEqual({ kind: 'other', sessionId: 's', sessionUpdate: 'tool_call:no-id' });
  });

  it('never throws on a malformed update', () => {
    expect(parseSessionUpdate({}).kind).toBe('unusable');
    expect(parseSessionUpdate({ update: 'nope' }).kind).toBe('unusable');
  });
});

describe('parseSessionId', () => {
  it('returns the id, or empty when unusable', () => {
    expect(parseSessionId({ sessionId: 'sess_abc' })).toBe('sess_abc');
    expect(parseSessionId({})).toBe('');
    expect(parseSessionId({ sessionId: 42 })).toBe('');
  });
});

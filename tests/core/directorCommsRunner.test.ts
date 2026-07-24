import { describe, expect, it } from 'vitest';
import {
  classifyToolIntent,
  detectConnectorCapabilities,
  resolveCapability,
  buildToolArgs,
  type ConnectorCapability,
} from '../../src/core/directorCommsRunner.ts';
import type { McpServerState, McpToolInfo } from '../../src/types.ts';

function tool(name: string, properties: Record<string, unknown> = {}): McpToolInfo {
  return { serverId: 's', name, description: name, inputSchema: { type: 'object', properties } };
}

function server(id: string, name: string, status: McpServerState['status'], tools: McpToolInfo[]): McpServerState {
  return { config: { id, name, transport: 'http', enabled: true } as McpServerState['config'], status, tools };
}

describe('classifyToolIntent', () => {
  it('classifies common connector tool names', () => {
    expect(classifyToolIntent('outlook_send_mail')).toBe('email');
    expect(classifyToolIntent('send_email')).toBe('email');
    expect(classifyToolIntent('outlook_create_draft')).toBe('email');
    expect(classifyToolIntent('outlook_create_event')).toBe('schedule');
    expect(classifyToolIntent('create_event')).toBe('schedule');
    expect(classifyToolIntent('post_message')).toBe('message');
    expect(classifyToolIntent('slack_post_message')).toBe('message');
    expect(classifyToolIntent('list_files')).toBeUndefined();
    expect(classifyToolIntent('get_me')).toBeUndefined();
  });
});

describe('detectConnectorCapabilities', () => {
  it('detects one capability per intent from connected servers, preferring send over draft', () => {
    const servers = [
      server('m365', 'Microsoft 365', 'connected', [
        tool('outlook_create_draft'),
        tool('outlook_send_mail'),
        tool('outlook_create_event'),
        tool('get_me'),
      ]),
      server('slack', 'Slack', 'connected', [tool('post_message')]),
    ];
    const caps = detectConnectorCapabilities(servers);
    const email = resolveCapability(caps, 'email');
    expect(email?.toolName).toBe('outlook_send_mail'); // send beats draft
    expect(email?.serverName).toBe('Microsoft 365');
    expect(resolveCapability(caps, 'schedule')?.toolName).toBe('outlook_create_event');
    expect(resolveCapability(caps, 'message')?.toolName).toBe('post_message');
  });

  it('ignores servers that are not connected', () => {
    const servers = [server('m365', 'Microsoft 365', 'error', [tool('outlook_send_mail')])];
    expect(detectConnectorCapabilities(servers)).toEqual([]);
    expect(resolveCapability(detectConnectorCapabilities(servers), 'email')).toBeUndefined();
  });
});

describe('buildToolArgs', () => {
  const emailCap = (props: Record<string, unknown>): ConnectorCapability => ({
    serverId: 's', serverName: 'M365', toolName: 'outlook_send_mail', intent: 'email',
    inputSchema: { type: 'object', properties: props },
  });

  it('maps a draft onto the tool schema property names, only using declared fields', () => {
    const cap = emailCap({ to: {}, subject: {}, body: {} });
    const args = buildToolArgs(cap, { intent: 'email', recipient: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(args).toEqual({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });
  });

  it('never invents fields the schema does not declare', () => {
    const cap = emailCap({ subject: {} }); // schema only has subject
    const args = buildToolArgs(cap, { intent: 'email', recipient: 'a@b.com', subject: 'Hi', body: 'Hello' });
    expect(args).toEqual({ subject: 'Hi' });
    expect('to' in args).toBe(false);
    expect('body' in args).toBe(false);
  });

  it('prefers the highest-priority matching property name', () => {
    const cap = emailCap({ recipient: {}, address: {}, content: {} });
    const args = buildToolArgs(cap, { intent: 'email', recipient: 'a@b.com', body: 'Hello' });
    expect(args['recipient']).toBe('a@b.com'); // recipient beats address
    expect(args['content']).toBe('Hello');
  });

  it('maps schedule and message intents', () => {
    const schedCap: ConnectorCapability = { serverId: 's', serverName: 'M365', toolName: 'outlook_create_event', intent: 'schedule', inputSchema: { properties: { subject: {}, start: {}, body: {} } } };
    expect(buildToolArgs(schedCap, { intent: 'schedule', recipient: 'a@b.com', subject: 'Sync', start: '2026-08-01T15:00', body: 'agenda' }))
      .toEqual({ subject: 'Sync', start: '2026-08-01T15:00', body: 'agenda' });
    const msgCap: ConnectorCapability = { serverId: 's', serverName: 'Slack', toolName: 'post_message', intent: 'message', inputSchema: { properties: { channel: {}, text: {} } } };
    expect(buildToolArgs(msgCap, { intent: 'message', recipient: '@dana', body: 'ping' }))
      .toEqual({ channel: '@dana', text: 'ping' });
  });
});

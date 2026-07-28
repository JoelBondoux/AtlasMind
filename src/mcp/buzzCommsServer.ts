#!/usr/bin/env node
/**
 * Bundled stdio MCP server exposing only Buzz communication operations.
 *
 * Buzz owns identity and messaging; AtlasMind owns reasoning and execution.
 * Deliberately do not expose Buzz's shell, file-edit, workflow, repo, or admin
 * surfaces from this connector.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  BuzzCliBridge,
  loadBuzzCliBridgeConfig,
  type BuzzCliEnvironment,
} from './buzzCliBridge.js';

function registerCommunicationTools(server: McpServer, bridge: BuzzCliBridge): void {
  server.registerTool('buzz_list_channels', {
    title: 'List Buzz channels',
    description: 'List up to 100 Buzz channels visible to the configured Buzz identity.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (_args, extra) => {
    const channels = await bridge.listChannels(extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(channels) }] };
  });

  server.registerTool('buzz_post_message', {
    title: 'Post a Buzz message',
    description: 'Post a message to a Buzz channel UUID, optionally as a thread reply.',
    inputSchema: {
      channel: z.string().describe('Buzz channel UUID from buzz_list_channels'),
      content: z.string().min(1).max(16_000).describe('Message text or markdown'),
      replyTo: z.string().optional().describe('Optional 64-character root event ID'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ channel, content, replyTo }, extra) => {
    const result = await bridge.postMessage(channel, content, replyTo, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  server.registerTool('buzz_read_thread', {
    title: 'Read a Buzz thread',
    description: 'Read a bounded Buzz message thread by channel UUID and root event ID.',
    inputSchema: {
      channel: z.string().describe('Buzz channel UUID'),
      event: z.string().describe('64-character root event ID'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum messages; defaults to 50'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async ({ channel, event, limit }, extra) => {
    const thread = await bridge.readThread(channel, event, limit, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(thread) }] };
  });

  server.registerTool('buzz_send_dm', {
    title: 'Send a Buzz direct message',
    description: 'Open or reuse a Buzz DM and send a message to a 64-character hex public key.',
    inputSchema: {
      pubkey: z.string().describe('Recipient 64-character hexadecimal Buzz/Nostr public key'),
      content: z.string().min(1).max(16_000).describe('Message text or markdown'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ pubkey, content }, extra) => {
    const result = await bridge.sendDirectMessage(pubkey, content, extra.signal);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
}

async function main(): Promise<void> {
  const config = loadBuzzCliBridgeConfig(process.env as BuzzCliEnvironment);
  const bridge = new BuzzCliBridge(config);
  const server = new McpServer({
    name: 'atlasmind-buzz-comms',
    version: '1.0.0',
  });
  registerCommunicationTools(server, bridge);

  // Fail the MCP handshake if the binary is absent or its command contract is incompatible.
  await bridge.assertReady();
  await server.connect(new StdioServerTransport());
}

main().catch(error => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[atlasmind-buzz] ${detail}\n`);
  process.exitCode = 1;
});

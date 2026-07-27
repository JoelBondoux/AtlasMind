import { describe, expect, it, vi } from 'vitest';
import {
  BuzzCliBridge,
  loadBuzzCliBridgeConfig,
  normalizeBuzzRelayUrl,
  redactBuzzSecrets,
  type BuzzCommandExecutor,
  type BuzzCommandResult,
} from '../../src/mcp/buzzCliBridge.ts';

const PRIVATE_KEY = 'a'.repeat(64);
const CHANNEL_ID = '123e4567-e89b-42d3-a456-426614174000';
const EVENT_ID = 'b'.repeat(64);
const PUBKEY = 'c'.repeat(64);

function config() {
  return {
    cliPath: 'buzz',
    relayUrl: 'http://localhost:3000',
    privateKey: PRIVATE_KEY,
    allowRemoteRelay: false,
  };
}

function executor(...results: BuzzCommandResult[]): BuzzCommandExecutor & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async () => {
      const next = results.shift();
      if (!next) {
        throw new Error('No mock result');
      }
      return next;
    }),
  };
}

function contractProbeResults(overrides: Partial<Record<number, string>> = {}): BuzzCommandResult[] {
  const help = [
    'BUZZ_PRIVATE_KEY BUZZ_RELAY_URL --format channels messages dms',
    '--limit',
    '--channel --content --reply-to',
    '--channel --event --limit',
    '--pubkey',
  ];
  return help.map((stdout, index) => ({
    exitCode: 0,
    stdout: overrides[index] ?? stdout,
    stderr: '',
  }));
}

describe('loadBuzzCliBridgeConfig', () => {
  it('requires explicit enablement and a valid private key', () => {
    expect(() => loadBuzzCliBridgeConfig({ BUZZ_PRIVATE_KEY: PRIVATE_KEY })).toThrow(/disabled/i);
    expect(() => loadBuzzCliBridgeConfig({
      ATLASMIND_BUZZ_ENABLED: 'true',
      BUZZ_PRIVATE_KEY: 'not-a-key',
    })).toThrow(/private_key/i);
  });

  it('normalizes the local websocket relay for the HTTP-based CLI', () => {
    const loaded = loadBuzzCliBridgeConfig({
      ATLASMIND_BUZZ_ENABLED: 'true',
      BUZZ_PRIVATE_KEY: PRIVATE_KEY,
      BUZZ_RELAY_URL: 'ws://localhost:3000',
    });
    expect(loaded.relayUrl).toBe('http://localhost:3000');
  });
});

describe('normalizeBuzzRelayUrl', () => {
  it('denies remote relays by default and insecure remote relays always', () => {
    expect(() => normalizeBuzzRelayUrl('wss://buzz.example.com', false)).toThrow(/allowRemoteRelay/);
    expect(() => normalizeBuzzRelayUrl('ws://buzz.example.com', true)).toThrow(/HTTPS\/WSS/);
    expect(normalizeBuzzRelayUrl('wss://buzz.example.com', true)).toBe('https://buzz.example.com');
  });

  it('rejects credential-bearing and query-bearing URLs', () => {
    expect(() => normalizeBuzzRelayUrl('https://user:pass@buzz.example.com', true)).toThrow(/credentials/);
    expect(() => normalizeBuzzRelayUrl('https://buzz.example.com?token=x', true)).toThrow(/query/);
  });
});

describe('BuzzCliBridge', () => {
  it('checks the pinned CLI communication contract', async () => {
    const mock = executor(...contractProbeResults());
    const bridge = new BuzzCliBridge(config(), mock);
    await bridge.assertReady();
    expect(mock.execute.mock.calls.map(call => call[0])).toEqual([
      ['--help'],
      ['channels', 'list', '--help'],
      ['messages', 'send', '--help'],
      ['messages', 'thread', '--help'],
      ['dms', 'open', '--help'],
    ]);
  });

  it('rejects a CLI missing part of the pinned contract', async () => {
    const mock = executor(...contractProbeResults({ 2: '--channel --content' }));
    await expect(new BuzzCliBridge(config(), mock).assertReady()).rejects.toThrow(/missing --reply-to/);
  });

  it('lists bounded channels using compact JSON', async () => {
    const mock = executor({
      exitCode: 0,
      stdout: JSON.stringify([{ channel_id: CHANNEL_ID, name: 'general' }]),
      stderr: '',
    });
    const channels = await new BuzzCliBridge(config(), mock).listChannels();
    expect(channels).toHaveLength(1);
    expect(mock.execute).toHaveBeenCalledWith(
      ['--format', 'compact', 'channels', 'list', '--limit', '100'],
      undefined,
      undefined,
    );
  });

  it('posts message content over stdin rather than command arguments', async () => {
    const mock = executor({
      exitCode: 0,
      stdout: JSON.stringify({ event_id: EVENT_ID, accepted: true, message: 'ok' }),
      stderr: '',
    });
    const body = 'Body with `backticks`, $vars, and markdown.';
    const result = await new BuzzCliBridge(config(), mock).postMessage(CHANNEL_ID, body, EVENT_ID);
    expect(result.accepted).toBe(true);
    expect(mock.execute).toHaveBeenCalledWith(
      ['messages', 'send', '--channel', CHANNEL_ID, '--content', '-', '--reply-to', EVENT_ID],
      body,
      undefined,
    );
    expect(mock.execute.mock.calls[0]?.[0]).not.toContain(body);
  });

  it('opens a DM then posts into the returned DM channel', async () => {
    const mock = executor(
      {
        exitCode: 0,
        stdout: JSON.stringify({ event_id: EVENT_ID, accepted: true, dm_id: CHANNEL_ID }),
        stderr: '',
      },
      {
        exitCode: 0,
        stdout: JSON.stringify({ event_id: 'd'.repeat(64), accepted: true }),
        stderr: '',
      },
    );
    const result = await new BuzzCliBridge(config(), mock).sendDirectMessage(PUBKEY, 'hello');
    expect(result.accepted).toBe(true);
    expect(mock.execute.mock.calls[0]?.[0]).toEqual(['dms', 'open', '--pubkey', PUBKEY]);
    expect(mock.execute.mock.calls[1]?.[0]).toEqual([
      'messages', 'send', '--channel', CHANNEL_ID, '--content', '-',
    ]);
  });

  it('validates identifiers before invoking the CLI', async () => {
    const mock = executor();
    const bridge = new BuzzCliBridge(config(), mock);
    await expect(bridge.postMessage('#general', 'hello')).rejects.toThrow(/UUID/);
    await expect(bridge.sendDirectMessage('npub-invalid', 'hello')).rejects.toThrow(/64-character/);
    expect(mock.execute).not.toHaveBeenCalled();
  });

  it('redacts keys and authorization grants from failures', () => {
    const authTag = '{"secret":"grant"}';
    expect(redactBuzzSecrets(`${PRIVATE_KEY.toUpperCase()} ${authTag}`, { privateKey: PRIVATE_KEY, authTag }))
      .toBe('[BUZZ_PRIVATE_KEY_REDACTED] [BUZZ_AUTH_TAG_REDACTED]');
  });
});

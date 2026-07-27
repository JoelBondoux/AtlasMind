/**
 * Narrow, safety-first wrapper around Buzz's official agent CLI.
 *
 * The bridge exposes communication primitives only. It never shells out through
 * a command interpreter, never lets a tool call select an executable or relay,
 * and sends message bodies over stdin so markdown/code cannot become arguments.
 */

import { spawn } from 'node:child_process';

export const SUPPORTED_BUZZ_CLI_RELEASE = 'v0.4.26';
export const MAX_BUZZ_MESSAGE_CHARS = 16_000;
export const MAX_BUZZ_OUTPUT_BYTES = 256 * 1024;
export const BUZZ_COMMAND_TIMEOUT_MS = 30_000;

const BUZZ_CLI_CONTRACT_PROBES: ReadonlyArray<{
  args: readonly string[];
  requiredTokens: readonly string[];
}> = [
  {
    args: ['--help'],
    requiredTokens: ['BUZZ_PRIVATE_KEY', 'BUZZ_RELAY_URL', '--format', 'channels', 'messages', 'dms'],
  },
  {
    args: ['channels', 'list', '--help'],
    requiredTokens: ['--limit'],
  },
  {
    args: ['messages', 'send', '--help'],
    requiredTokens: ['--channel', '--content', '--reply-to'],
  },
  {
    args: ['messages', 'thread', '--help'],
    requiredTokens: ['--channel', '--event', '--limit'],
  },
  {
    args: ['dms', 'open', '--help'],
    requiredTokens: ['--pubkey'],
  },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/i;
const NSEC_PATTERN = /^nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/i;

export interface BuzzCliBridgeConfig {
  cliPath: string;
  relayUrl: string;
  privateKey: string;
  authTag?: string;
  allowRemoteRelay: boolean;
}

export interface BuzzCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface BuzzCommandExecutor {
  execute(args: readonly string[], stdin?: string, signal?: AbortSignal): Promise<BuzzCommandResult>;
}

export interface BuzzSendResult {
  event_id: string;
  accepted: boolean;
  message?: string;
}

export interface BuzzDmOpenResult extends BuzzSendResult {
  dm_id: string;
}

export interface BuzzCliEnvironment {
  ATLASMIND_BUZZ_ENABLED?: string;
  ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY?: string;
  BUZZ_CLI_PATH?: string;
  BUZZ_RELAY_URL?: string;
  BUZZ_PRIVATE_KEY?: string;
  BUZZ_AUTH_TAG?: string;
}

/** Load and validate the fixed process-level bridge configuration. */
export function loadBuzzCliBridgeConfig(env: BuzzCliEnvironment): BuzzCliBridgeConfig {
  if (env.ATLASMIND_BUZZ_ENABLED !== 'true') {
    throw new Error('Buzz integration is disabled. Enable atlasmind.buzz.enabled before connecting.');
  }

  const cliPath = (env.BUZZ_CLI_PATH ?? 'buzz').trim();
  if (!cliPath || cliPath.length > 2_048 || cliPath.includes('\0')) {
    throw new Error('BUZZ_CLI_PATH is missing or invalid.');
  }

  const privateKey = (env.BUZZ_PRIVATE_KEY ?? '').trim();
  if (!HEX_64_PATTERN.test(privateKey) && !NSEC_PATTERN.test(privateKey)) {
    throw new Error('BUZZ_PRIVATE_KEY must be a 64-character hex key or an nsec value.');
  }

  const allowRemoteRelay = env.ATLASMIND_BUZZ_ALLOW_REMOTE_RELAY === 'true';
  const relayUrl = normalizeBuzzRelayUrl(env.BUZZ_RELAY_URL ?? 'http://localhost:3000', allowRemoteRelay);

  const authTag = env.BUZZ_AUTH_TAG?.trim();
  if (authTag && authTag.length > 16_384) {
    throw new Error('BUZZ_AUTH_TAG exceeds the supported size.');
  }

  return {
    cliPath,
    relayUrl,
    privateKey,
    authTag: authTag || undefined,
    allowRemoteRelay,
  };
}

/**
 * Buzz Desktop commonly describes relays with ws(s), while buzz-cli v0.4.26
 * accepts the relay's HTTP(S) base URL. Normalize that transport boundary here.
 */
export function normalizeBuzzRelayUrl(raw: string, allowRemoteRelay: boolean): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('BUZZ_RELAY_URL is not a valid URL.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('BUZZ_RELAY_URL must not contain credentials, query parameters, or a fragment.');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!isLoopback && !allowRemoteRelay) {
    throw new Error('Remote Buzz relays require atlasmind.buzz.allowRemoteRelay.');
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    throw new Error('BUZZ_RELAY_URL must use http, https, ws, or wss.');
  }
  if (!isLoopback && !['https:', 'wss:'].includes(url.protocol)) {
    throw new Error('Remote Buzz relays must use HTTPS/WSS.');
  }

  if (url.protocol === 'ws:') {
    url.protocol = 'http:';
  } else if (url.protocol === 'wss:') {
    url.protocol = 'https:';
  }
  return url.toString().replace(/\/$/, '');
}

/** Execute the pinned Buzz binary directly, never through a shell. */
export class NodeBuzzCommandExecutor implements BuzzCommandExecutor {
  constructor(private readonly config: BuzzCliBridgeConfig) {}

  execute(args: readonly string[], stdin?: string, signal?: AbortSignal): Promise<BuzzCommandResult> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Buzz CLI command was cancelled.'));
        return;
      }

      const child = spawn(this.config.cliPath, [...args], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          BUZZ_RELAY_URL: this.config.relayUrl,
          BUZZ_PRIVATE_KEY: this.config.privateKey,
          ...(this.config.authTag ? { BUZZ_AUTH_TAG: this.config.authTag } : {}),
        },
      });

      let stdout = '';
      let stderr = '';
      let outputBytes = 0;
      let settled = false;

      const finish = (error?: Error, result?: BuzzCommandResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (error) {
          reject(error);
        } else if (result) {
          resolve(result);
        }
      };
      const abort = (): void => {
        child.kill();
        finish(new Error('Buzz CLI command was cancelled.'));
      };
      const append = (current: string, chunk: Buffer): string => {
        outputBytes += chunk.byteLength;
        if (outputBytes > MAX_BUZZ_OUTPUT_BYTES) {
          child.kill();
          finish(new Error('Buzz CLI output exceeded the safety limit.'));
          return current;
        }
        return current + chunk.toString('utf8');
      };

      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error('Buzz CLI command timed out.'));
      }, BUZZ_COMMAND_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.once('error', error => finish(new Error(`Unable to start Buzz CLI: ${error.message}`)));
      child.once('close', code => finish(undefined, {
        exitCode: typeof code === 'number' ? code : 4,
        stdout,
        stderr,
      }));
      child.stdin.once('error', error => {
        if (!settled) {
          child.kill();
          finish(new Error(`Unable to send input to Buzz CLI: ${error.message}`));
        }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }

      if (stdin !== undefined) {
        child.stdin.end(stdin, 'utf8');
      } else {
        child.stdin.end();
      }
    });
  }
}

/** Communication-only facade used by the bundled MCP server. */
export class BuzzCliBridge {
  private readonly executor: BuzzCommandExecutor;

  constructor(
    private readonly config: BuzzCliBridgeConfig,
    executor?: BuzzCommandExecutor,
  ) {
    this.executor = executor ?? new NodeBuzzCommandExecutor(config);
  }

  async assertReady(signal?: AbortSignal): Promise<void> {
    // Buzz v0.4.26 does not expose a working --version flag. Probe the exact
    // communication command/flag surface AtlasMind relies on so incompatible
    // binaries still fail closed before the MCP handshake.
    for (const probe of BUZZ_CLI_CONTRACT_PROBES) {
      const result = await this.executor.execute(probe.args, undefined, signal);
      if (result.exitCode !== 0) {
        throw new Error(this.formatFailure(result));
      }
      const help = `${result.stdout}\n${result.stderr}`;
      const missing = probe.requiredTokens.filter(token => !help.includes(token));
      if (missing.length > 0) {
        throw new Error(
          `Buzz CLI is incompatible with the pinned ${SUPPORTED_BUZZ_CLI_RELEASE} communication contract ` +
          `(missing ${missing.join(', ')} from "buzz ${probe.args.join(' ')}").`,
        );
      }
    }
  }

  async listChannels(signal?: AbortSignal): Promise<unknown[]> {
    const value = await this.runJson(['--format', 'compact', 'channels', 'list', '--limit', '100'], undefined, signal);
    if (!Array.isArray(value)) {
      throw new Error('Buzz CLI returned an invalid channel list.');
    }
    return value.slice(0, 100);
  }

  async postMessage(channel: string, content: string, replyTo?: string, signal?: AbortSignal): Promise<BuzzSendResult> {
    const channelId = requireUuid(channel, 'channel');
    const body = requireMessage(content);
    const args = ['messages', 'send', '--channel', channelId, '--content', '-'];
    if (replyTo) {
      args.push('--reply-to', requireEventId(replyTo));
    }
    return requireSendResult(await this.runJson(args, body, signal));
  }

  async readThread(channel: string, event: string, limit = 50, signal?: AbortSignal): Promise<unknown[]> {
    const safeLimit = Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 50;
    const value = await this.runJson([
      '--format', 'compact',
      'messages', 'thread',
      '--channel', requireUuid(channel, 'channel'),
      '--event', requireEventId(event),
      '--limit', String(safeLimit),
    ], undefined, signal);
    if (!Array.isArray(value)) {
      throw new Error('Buzz CLI returned an invalid thread response.');
    }
    return value.slice(0, safeLimit);
  }

  async sendDirectMessage(pubkey: string, content: string, signal?: AbortSignal): Promise<BuzzSendResult> {
    const recipient = pubkey.trim();
    if (!HEX_64_PATTERN.test(recipient)) {
      throw new Error('Buzz DM recipients must use a 64-character hex public key.');
    }
    const opened = requireDmOpenResult(
      await this.runJson(['dms', 'open', '--pubkey', recipient], undefined, signal),
    );
    return this.postMessage(opened.dm_id, content, undefined, signal);
  }

  private async runJson(args: readonly string[], stdin?: string, signal?: AbortSignal): Promise<unknown> {
    const result = await this.executor.execute(args, stdin, signal);
    if (result.exitCode !== 0) {
      throw new Error(this.formatFailure(result));
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error('Buzz CLI returned malformed JSON.');
    }
  }

  private formatFailure(result: BuzzCommandResult): string {
    const raw = (result.stderr || result.stdout || `Buzz CLI exited with code ${result.exitCode}`).trim();
    const redacted = redactBuzzSecrets(raw, this.config);
    try {
      const parsed = JSON.parse(redacted) as { message?: unknown };
      if (typeof parsed.message === 'string') {
        return `Buzz CLI error: ${parsed.message.slice(0, 1_000)}`;
      }
    } catch {
      // Keep the bounded, redacted plain-text fallback.
    }
    return `Buzz CLI error: ${redacted.slice(0, 1_000)}`;
  }
}

export function redactBuzzSecrets(value: string, config: Pick<BuzzCliBridgeConfig, 'privateKey' | 'authTag'>): string {
  let redacted = value.replace(/nsec1[023456789acdefghjklmnpqrstuvwxyz]{20,100}/gi, '[BUZZ_PRIVATE_KEY_REDACTED]');
  if (config.privateKey) {
    redacted = redacted.replace(
      new RegExp(escapeRegExp(config.privateKey), 'gi'),
      '[BUZZ_PRIVATE_KEY_REDACTED]',
    );
  }
  if (config.authTag) {
    redacted = redacted.split(config.authTag).join('[BUZZ_AUTH_TAG_REDACTED]');
  }
  return redacted;
}

function requireUuid(value: string, field: string): string {
  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`Buzz ${field} must be a UUID.`);
  }
  return trimmed;
}

function requireEventId(value: string): string {
  const trimmed = value.trim();
  if (!HEX_64_PATTERN.test(trimmed)) {
    throw new Error('Buzz event IDs must be 64-character hexadecimal values.');
  }
  return trimmed;
}

function requireMessage(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Buzz message content is required.');
  }
  if (value.length > MAX_BUZZ_MESSAGE_CHARS || value.includes('\0')) {
    throw new Error(`Buzz message content must be at most ${MAX_BUZZ_MESSAGE_CHARS} characters and contain no NUL bytes.`);
  }
  return value;
}

function requireSendResult(value: unknown): BuzzSendResult {
  if (!isRecord(value) || !HEX_64_PATTERN.test(String(value['event_id'] ?? '')) || typeof value['accepted'] !== 'boolean') {
    throw new Error('Buzz CLI returned an invalid send response.');
  }
  return {
    event_id: String(value['event_id']),
    accepted: value['accepted'],
    ...(typeof value['message'] === 'string' ? { message: value['message'] } : {}),
  };
}

function requireDmOpenResult(value: unknown): BuzzDmOpenResult {
  const send = requireSendResult(value);
  if (!isRecord(value) || !UUID_PATTERN.test(String(value['dm_id'] ?? ''))) {
    throw new Error('Buzz CLI returned an invalid DM response.');
  }
  return { ...send, dm_id: String(value['dm_id']) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

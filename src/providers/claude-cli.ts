import { spawn } from 'node:child_process';
import { lookupCatalog } from './modelCatalog.js';
import type { CompletionRequest, CompletionResponse, DiscoveredModel, ProviderAdapter } from './adapter.js';
import type { ModelCapability } from '../types.js';

export const CLAUDE_CLI_PROVIDER_ID = 'claude-cli';
export const CLAUDE_CLI_SETUP_URL = 'https://code.claude.com/docs/en/quickstart';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CLAUDE_CLI_CONTEXT_MESSAGES = 4;
const MAX_CLAUDE_CLI_MESSAGE_CHARS = 4_000;
const MAX_CLAUDE_CLI_SYSTEM_PROMPT_CHARS = 2_000;

export interface ClaudeCliProbeResult {
  installed: boolean;
  authenticated: boolean;
  authMode?: 'subscription' | 'console' | 'third-party' | 'unknown';
  command?: string;
  message?: string;
}

interface ClaudeCliCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

type ClaudeCliRunner = (
  args: string[],
  options?: { input?: string; timeoutMs?: number; cwd?: string; signal?: AbortSignal },
) => Promise<ClaudeCliCommandResult>;

export class ClaudeCliAdapter implements ProviderAdapter {
  readonly providerId = CLAUDE_CLI_PROVIDER_ID;

  constructor(
    private readonly options?: {
      cwd?: string;
      timeoutMs?: number;
      runCommand?: ClaudeCliRunner;
    },
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const probe = await this.probe();
    if (!probe.installed) {
      throw new Error('Claude CLI (Beta) is not installed. Install Claude and sign in before using this provider.');
    }
    if (!probe.authenticated) {
      throw new Error('Claude CLI (Beta) is installed but not authenticated. Run "claude auth login" first.');
    }

    const { systemPrompt, prompt } = buildClaudeCliPrompt(request.messages);
    const requestedModel = stripProviderPrefix(request.model);
    const args = [
      '--print',
      '--output-format', 'json',
      '--model', requestedModel,
      '--tools', '',
      '--max-turns', '1',
      '--permission-mode', 'default',
      prompt,
    ];
    if (systemPrompt.trim().length > 0) {
      args.splice(args.length - 1, 0, '--append-system-prompt', systemPrompt);
    }

    const result = await this.runCommand(args, { timeoutMs: this.options?.timeoutMs, cwd: this.options?.cwd, signal: request.signal });
    if (result.exitCode !== 0) {
      throw new Error(
        `Claude CLI (Beta) request failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || 'Unknown error.'}`,
      );
    }

    const parsed = tryParseJson(result.stdout);
    const content = extractClaudeCliText(parsed);
    if (!content) {
      if (parsed) {
        throw new Error(describeClaudeCliEmptyResult(parsed));
      }
      if (!result.stdout.trim()) {
        throw new Error('Claude CLI (Beta) returned an empty response.');
      }
    }
    const usage = extractUsage(parsed);
    const responseModel = extractModel(parsed) ?? requestedModel;

    return {
      content: content || result.stdout.trim(),
      model: `${CLAUDE_CLI_PROVIDER_ID}/${responseModel}`,
      inputTokens: usage.inputTokens ?? estimateTokens(`${systemPrompt}\n${prompt}`),
      outputTokens: usage.outputTokens ?? estimateTokens(content || result.stdout.trim()),
      finishReason: 'stop',
    };
  }

  async listModels(): Promise<string[]> {
    const probe = await this.probe();
    if (!probe.installed || !probe.authenticated) {
      return [];
    }

    return [
      `${CLAUDE_CLI_PROVIDER_ID}/sonnet`,
      `${CLAUDE_CLI_PROVIDER_ID}/opus`,
      `${CLAUDE_CLI_PROVIDER_ID}/haiku`,
    ];
  }

  async discoverModels(): Promise<DiscoveredModel[]> {
    const ids = await this.listModels();
    return ids.map(id => {
      const entry = lookupCatalog(this.providerId, id);
      const capabilities = sanitizeClaudeCliCapabilities(entry?.capabilities);
      return {
        id,
        name: `${entry?.name ?? prettifyClaudeAlias(stripProviderPrefix(id))} (Beta)`,
        contextWindow: entry?.contextWindow,
        capabilities,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        premiumRequestMultiplier: entry?.premiumRequestMultiplier,
      };
    });
  }

  async healthCheck(): Promise<boolean> {
    const probe = await this.probe();
    return probe.installed && probe.authenticated;
  }

  async probe(): Promise<ClaudeCliProbeResult> {
    return probeClaudeCli({
      cwd: this.options?.cwd,
      timeoutMs: this.options?.timeoutMs,
      runCommand: this.options?.runCommand,
    });
  }

  private async runCommand(
    args: string[],
    options?: { input?: string; timeoutMs?: number; cwd?: string; signal?: AbortSignal },
  ): Promise<ClaudeCliCommandResult> {
    if (this.options?.runCommand) {
      return this.options.runCommand(args, options);
    }

    return runClaudeCliCommand(args, options);
  }
}

function sanitizeClaudeCliCapabilities(capabilities: readonly ModelCapability[] | undefined): ModelCapability[] | undefined {
  if (!capabilities) {
    return undefined;
  }

  return capabilities.filter(capability => capability !== 'function_calling');
}

export async function probeClaudeCli(options?: {
  cwd?: string;
  timeoutMs?: number;
  runCommand?: ClaudeCliRunner;
}): Promise<ClaudeCliProbeResult> {
  const runCommand = options?.runCommand ?? runClaudeCliCommand;

  try {
    const versionResult = await runCommand(['--version'], options);
    if (versionResult.exitCode !== 0) {
      return {
        installed: false,
        authenticated: false,
        message: versionResult.stderr.trim() || versionResult.stdout.trim() || 'Claude CLI command failed to start.',
      };
    }

    const authResult = await runCommand(['auth', 'status'], options);
    if (authResult.exitCode !== 0) {
      return {
        installed: true,
        authenticated: false,
        command: authResult.command,
        message: authResult.stderr.trim() || authResult.stdout.trim() || 'Claude CLI is installed but not signed in.',
      };
    }

    const payload = tryParseJson(authResult.stdout);
    return {
      installed: true,
      authenticated: true,
      command: authResult.command,
      authMode: detectAuthMode(payload),
    };
  } catch (error) {
    return {
      installed: false,
      authenticated: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runClaudeCliCommand(
  args: string[],
  options?: { input?: string; timeoutMs?: number; cwd?: string; signal?: AbortSignal },
): Promise<ClaudeCliCommandResult> {
  const candidates = process.platform === 'win32'
    ? ['claude.cmd', 'claude.exe', 'claude']
    : ['claude'];
  let lastError: Error | undefined;

  for (const command of candidates) {
    try {
      return await spawnAndCollect(command, args, options);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Claude CLI executable could not be found.');
}

function spawnAndCollect(
  command: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number; cwd?: string; signal?: AbortSignal },
): Promise<ClaudeCliCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd ?? process.cwd(),
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const abortSignal = options?.signal;
    const handleAbort = () => {
      child.kill();
      clearTimeout(timeout);
      reject(createAbortError());
    };
    if (abortSignal) {
      if (abortSignal.aborted) {
        handleAbort();
        return;
      }
      abortSignal.addEventListener('abort', handleAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', handleAbort);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', handleAbort);
      if (timedOut) {
        reject(new Error(`Claude CLI command timed out after ${timeoutMs}ms.`));
        return;
      }

      resolve({
        command,
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (options?.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

function buildClaudeCliPrompt(messages: CompletionRequest['messages']): { systemPrompt: string; prompt: string } {
  const systemPrompt = compactClaudeCliSystemPrompt(messages
    .filter(message => message.role === 'system')
    .map(message => message.content.trim())
    .filter(Boolean)
    .join('\n\n'));

  const conversation = messages
    .filter(message => message.role !== 'system' && message.role !== 'tool')
    .map(message => ({
      role: message.role,
      content: truncateClaudeCliText(message.content.trim(), MAX_CLAUDE_CLI_MESSAGE_CHARS),
      imageCount: message.images?.length ?? 0,
    }))
    .filter(message => message.content.length > 0);
  const latestUserIndex = findLastUserMessageIndex(conversation);
  const latestMessage = latestUserIndex >= 0
    ? conversation[latestUserIndex]
    : conversation.at(-1);
  const historyEnd = latestUserIndex >= 0 ? latestUserIndex : conversation.length - 1;
  const recentHistory = historyEnd > 0
    ? conversation.slice(Math.max(0, historyEnd - MAX_CLAUDE_CLI_CONTEXT_MESSAGES), historyEnd)
    : [];
  const historyBlock = recentHistory
    .map(message => formatTranscriptMessage(message.role, message.content, message.imageCount))
    .join('\n\n');
  const latestTurn = latestMessage
    ? formatTranscriptMessage(latestMessage.role, latestMessage.content, latestMessage.imageCount)
    : 'User:\nContinue the conversation using the available context.';

  return {
    systemPrompt,
    prompt: [
      'You are responding inside AtlasMind through Claude CLI print mode.',
      'Tools are unavailable in this bridge. Do not emit tool-call XML, pseudo-function markup, or permission prompts.',
      'Return only the assistant reply for the latest user turn in plain text or markdown.',
      historyBlock ? 'Use the recent conversation context below only when it helps with the latest user turn.' : '',
      historyBlock ? `Recent conversation context:\n${historyBlock}` : '',
      `Latest turn:\n${latestTurn}`,
    ].filter(Boolean).join('\n\n'),
  };
}

function findLastUserMessageIndex(messages: Array<{ role: CompletionRequest['messages'][number]['role'] }>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }

  return -1;
}

function compactClaudeCliSystemPrompt(value: string): string {
  const bulkySectionMarkers = [
    '\n\nRelevant project memory:\n',
    '\n\nLive evidence from source-backed files:\n',
    '\n\nUser-attached images:\n',
  ];

  let compact = value.trim();
  for (const marker of bulkySectionMarkers) {
    const markerIndex = compact.indexOf(marker);
    if (markerIndex >= 0) {
      compact = compact.slice(0, markerIndex).trimEnd();
      break;
    }
  }

  return truncateClaudeCliText(compact, MAX_CLAUDE_CLI_SYSTEM_PROMPT_CHARS);
}

function truncateClaudeCliText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function formatTranscriptMessage(role: CompletionRequest['messages'][number]['role'], content: string, imageCount: number): string {
  const label = role === 'tool'
    ? 'Tool'
    : role === 'assistant'
      ? 'Assistant'
      : 'User';
  const imageNote = imageCount > 0
    ? `\n[AtlasMind Claude CLI Beta note: ${imageCount} image attachment${imageCount === 1 ? '' : 's'} omitted because this Beta bridge is text-only.]`
    : '';

  return `${label}:\n${content.trim()}${imageNote}`.trim();
}

function extractClaudeCliText(payload: unknown): string {
  if (!payload) {
    return '';
  }
  if (typeof payload === 'string') {
    return sanitizeClaudeCliText(payload);
  }
  if (Array.isArray(payload)) {
    return payload
      .map(item => extractClaudeCliText(item))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof payload !== 'object') {
    return '';
  }

  const record = payload as Record<string, unknown>;
  for (const candidate of [record['result'], record['output_text'], record['text'], record['completion']]) {
    const text = extractClaudeCliText(candidate);
    if (text) {
      return text;
    }
  }

  const message = record['message'];
  if (message && typeof message === 'object') {
    const text = extractClaudeCliText((message as Record<string, unknown>)['content']);
    if (text) {
      return text;
    }
  }

  const content = record['content'];
  if (Array.isArray(content)) {
    const text = content
      .map(item => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          const typed = item as Record<string, unknown>;
          if (typeof typed['text'] === 'string') {
            return typed['text'];
          }
          return extractClaudeCliText(typed['content']);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }

  if (content) {
    const text = extractClaudeCliText(content);
    if (text) {
      return text;
    }
  }

  const messages = record['messages'];
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const typed = entry as Record<string, unknown>;
      const role = typed['role'];
      if (role === 'assistant' || role === undefined) {
        const text = extractClaudeCliText(typed['content'] ?? typed['message'] ?? typed['result']);
        if (text) {
          return text;
        }
      }
    }
  }

  return '';
}

function sanitizeClaudeCliText(value: string): string {
  const withoutToolBlocks = value
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, ' ')
    .replace(/<function_result>[\s\S]*?<\/function_result>/gi, ' ')
    .replace(/<invoke\b[\s\S]*?<\/invoke>/gi, ' ')
    .replace(/<parameter\b[\s\S]*?<\/parameter>/gi, ' ');

  return withoutToolBlocks
    .replace(/^[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractUsage(payload: unknown): { inputTokens?: number; outputTokens?: number } {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const usage = (payload as Record<string, unknown>)['usage'];
  if (!usage || typeof usage !== 'object') {
    return {};
  }

  const typed = usage as Record<string, unknown>;
  return {
    inputTokens: toFiniteNumber(typed['input_tokens'] ?? typed['prompt_tokens'] ?? typed['inputTokens']),
    outputTokens: toFiniteNumber(typed['output_tokens'] ?? typed['completion_tokens'] ?? typed['outputTokens']),
  };
}

function extractModel(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const model = (payload as Record<string, unknown>)['model'];
  return typeof model === 'string' && model.trim().length > 0 ? stripProviderPrefix(model.trim()) : undefined;
}

function describeClaudeCliEmptyResult(payload: unknown): string {
  const record = typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : undefined;
  const subtype = typeof record?.['subtype'] === 'string' ? record['subtype'] : 'unknown';
  const stopReason = typeof record?.['stop_reason'] === 'string' ? record['stop_reason'] : 'unknown';
  return `Claude CLI (Beta) returned no assistant text (subtype: ${subtype}, stop reason: ${stopReason}).`;
}

function detectAuthMode(payload: unknown): ClaudeCliProbeResult['authMode'] {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }

  const serialized = JSON.stringify(payload).toLowerCase();
  if (serialized.includes('bedrock') || serialized.includes('vertex') || serialized.includes('foundry')) {
    return 'third-party';
  }
  if (serialized.includes('console')) {
    return 'console';
  }
  if (serialized.includes('subscription') || serialized.includes('pro') || serialized.includes('max') || serialized.includes('team')) {
    return 'subscription';
  }
  return 'unknown';
}

function stripProviderPrefix(modelId: string): string {
  return modelId.startsWith(`${CLAUDE_CLI_PROVIDER_ID}/`)
    ? modelId.slice(`${CLAUDE_CLI_PROVIDER_ID}/`.length)
    : modelId;
}

function prettifyClaudeAlias(alias: string): string {
  switch (alias.toLowerCase()) {
    case 'sonnet':
      return 'Claude Sonnet';
    case 'opus':
      return 'Claude Opus';
    case 'haiku':
      return 'Claude Haiku';
    default:
      return alias;
  }
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function createAbortError(): Error {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}
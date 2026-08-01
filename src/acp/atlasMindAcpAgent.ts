/**
 * Agent-side ACP facade over AtlasMind's shared headless runtime.
 *
 * The ACP client supplies the UI and transport. AtlasMind still owns agent
 * selection, model routing, SSOT retrieval, tool policy, and execution.
 */
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CancelNotification,
  ContentBlock,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  RequestPermissionResponse,
  ToolKind,
} from '@agentclientprotocol/sdk' with { 'resolution-mode': 'import' };
import type { AtlasRuntime } from '../runtime/core.js';
import type { AgentDefinition, TaskRequest, ToolInvocationPolicy } from '../types.js';
import { classifyToolInvocation } from '../core/toolPolicy.js';
import type { AcpReplyPublisher } from './buzzReplyPublisher.js';

export const ATLASMIND_ACP_PROTOCOL_VERSION = 1;
export const MAX_ACP_PROMPT_CHARS = 1_000_000;
const MAX_ACP_SESSION_HISTORY_CHARS = 80_000;
const MAX_TOOL_ARG_TEXT = 1_000;
const READ_ONLY_CATEGORIES = new Set(['read', 'git-read', 'terminal-read']);

export interface AtlasMindAcpClient {
  notify(method: string, params: unknown): Promise<void>;
  request(method: string, params: unknown): Promise<unknown>;
}

interface AtlasMindAcpSession {
  cwd: string;
  history: string;
  pendingPrompt?: AbortController;
}

export interface AtlasMindAcpAgentOptions {
  workspaceRoot: string;
  version: string;
  runtime: Pick<AtlasRuntime, 'orchestrator' | 'agentRegistry'>;
  permissionBroker?: AcpPermissionBroker;
  replyPublisher?: AcpReplyPublisher;
  log?: (message: string) => void;
}

interface ActivePermissionContext {
  sessionId: string;
  client: AtlasMindAcpClient;
}

/**
 * Converts AtlasMind's existing tool policy into ACP permission requests.
 *
 * Safe reads retain the CLI's normal behavior. Every write, subprocess,
 * network, audio, or unknown action needs a one-turn grant. `allow_always` is
 * never offered or accepted because it would persist authority outside
 * AtlasMind's revocation model.
 */
export class AcpPermissionBroker {
  private readonly active = new Map<string, ActivePermissionContext>();

  register(taskId: string, sessionId: string, client: AtlasMindAcpClient): void {
    this.active.set(taskId, { sessionId, client });
  }

  unregister(taskId: string): void {
    this.active.delete(taskId);
  }

  async authorize(
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ approved: boolean; reason?: string }> {
    const context = this.active.get(taskId);
    if (!context) {
      return {
        approved: false,
        reason: 'ACP tool request refused because no active authenticated prompt owns it.',
      };
    }

    const policy = classifyToolInvocation(toolName, args);
    if (READ_ONLY_CATEGORIES.has(policy.category)) {
      return { approved: true };
    }

    const toolCallId = `atlasmind-${randomUUID()}`;
    const toolCall = {
      toolCallId,
      title: policy.summary.slice(0, 300),
      name: toolName.slice(0, 200),
      kind: toAcpToolKind(policy, toolName),
      status: 'pending' as const,
      rawInput: sanitizeToolArgs(args),
    };

    try {
      await context.client.notify('session/update', {
        sessionId: context.sessionId,
        update: { sessionUpdate: 'tool_call', ...toolCall },
      });
      const raw = await context.client.request('session/request_permission', {
        sessionId: context.sessionId,
        toolCall,
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      });
      const response = raw as RequestPermissionResponse | undefined;
      const approved = response?.outcome?.outcome === 'selected'
        && response.outcome.optionId === 'allow-once';
      await context.client.notify('session/update', {
        sessionId: context.sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: approved ? 'in_progress' : 'failed',
        },
      });
      return approved
        ? { approved: true }
        : { approved: false, reason: `ACP client rejected ${policy.summary}.` };
    } catch {
      return {
        approved: false,
        reason: `ACP permission request failed; AtlasMind refused ${policy.summary}.`,
      };
    }
  }
}

export class AtlasMindAcpAgent {
  private readonly workspaceRoot: string;
  private readonly sessions = new Map<string, AtlasMindAcpSession>();
  private readonly permissionBroker: AcpPermissionBroker;
  private activePromptSessionId: string | undefined;

  constructor(private readonly options: AtlasMindAcpAgentOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.permissionBroker = options.permissionBroker ?? new AcpPermissionBroker();
  }

  get toolApprovalGate(): (
    taskId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<{ approved: boolean; reason?: string }> {
    return (taskId, toolName, args) => this.permissionBroker.authorize(taskId, toolName, args);
  }

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: ATLASMIND_ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      agentInfo: {
        name: 'atlasmind',
        title: 'AtlasMind',
        version: this.options.version.slice(0, 40) || '0.0.0',
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const cwd = requireWorkspacePath(params.cwd, this.workspaceRoot, 'cwd');
    for (const directory of params.additionalDirectories ?? []) {
      requireWorkspacePath(directory, this.workspaceRoot, 'additional workspace directory');
    }
    // Client-provided MCP commands are intentionally not spawned. Launching a
    // command supplied by an untrusted ACP peer would be remote code execution.
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { cwd, history: '' });
    return { sessionId };
  }

  async prompt(params: PromptRequest, client: AtlasMindAcpClient): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error('Unknown or expired AtlasMind ACP session.');
    }
    // Orchestrator execution state is intentionally one-loop-at-a-time. Do not
    // let a client use multiple ACP sessions to race that shared state.
    if (this.activePromptSessionId) {
      throw new Error(`AtlasMind ACP is already processing session ${this.activePromptSessionId}; wait for that turn to finish or cancel it.`);
    }
    const prompt = extractAcpPromptText(params.prompt);
    const agent = this.resolveAgent(Boolean(this.options.replyPublisher));
    this.activePromptSessionId = params.sessionId;
    session.pendingPrompt?.abort();
    const abortController = new AbortController();
    session.pendingPrompt = abortController;

    const taskId = `acp-${randomUUID()}`;
    const request: TaskRequest = {
      id: taskId,
      userMessage: prompt,
      context: {
        workspaceRootPath: this.workspaceRoot,
        interface: 'acp',
        acpSessionId: params.sessionId,
        ...(session.history ? { sessionContext: session.history } : {}),
      },
      constraints: { budget: 'balanced', speed: 'balanced' },
      timestamp: new Date().toISOString(),
      signal: abortController.signal,
    };

    let notificationChain = Promise.resolve();
    let streamedText = '';
    const queueText = (text: string): void => {
      if (!text || abortController.signal.aborted) {
        return;
      }
      streamedText += text;
      notificationChain = notificationChain.then(() => client.notify('session/update', {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      }));
    };

    this.permissionBroker.register(taskId, params.sessionId, client);
    try {
      const result = await this.options.runtime.orchestrator.processTaskWithAgent(
        request,
        agent,
        queueText,
        () => undefined,
      );
      await notificationChain;
      if (abortController.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      if (!streamedText && result.response) {
        queueText(result.response);
        await notificationChain;
      }

      session.history = appendSessionHistory(session.history, prompt, result.response);
      if (this.options.replyPublisher) {
        try {
          await this.options.replyPublisher.publish(prompt, result.response, abortController.signal);
        } catch (error) {
          this.options.log?.(
            `Buzz reply delivery failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return { stopReason: 'end_turn' };
    } finally {
      this.permissionBroker.unregister(taskId);
      if (session.pendingPrompt === abortController) {
        session.pendingPrompt = undefined;
      }
      if (this.activePromptSessionId === params.sessionId) {
        this.activePromptSessionId = undefined;
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }

  private resolveAgent(hostDeliversBuzzReply: boolean): AgentDefinition {
    const registered = this.options.runtime.agentRegistry.get('default');
    if (!registered) {
      throw new Error('AtlasMind default agent is unavailable.');
    }
    if (!hostDeliversBuzzReply) {
      return registered;
    }
    return {
      ...registered,
      systemPrompt: [
        registered.systemPrompt ?? '',
        'When a prompt contains Buzz channel instructions, answer the user normally.',
        'Do not invoke Buzz messaging, shell, or MCP tools to deliver the answer; the AtlasMind ACP host publishes the final response through its communication-only bridge.',
      ].filter(Boolean).join('\n\n'),
    };
  }
}

export function extractAcpPromptText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource_link') {
      parts.push(`[Referenced resource: ${block.name} — ${block.uri}]`);
    } else if (block.type === 'resource' && 'text' in block.resource) {
      parts.push(`[Embedded resource: ${block.resource.uri}]\n${block.resource.text}`);
    }
  }
  const text = parts.map(part => part.trim()).filter(Boolean).join('\n\n').trim();
  if (!text) {
    throw new Error('AtlasMind ACP prompts must contain text content.');
  }
  if (text.length > MAX_ACP_PROMPT_CHARS) {
    throw new Error(`AtlasMind ACP prompt exceeds the ${MAX_ACP_PROMPT_CHARS}-character safety limit.`);
  }
  return text;
}

function requireWorkspacePath(candidate: string, workspaceRoot: string, label: string): string {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`ACP session ${label} must be an absolute path.`);
  }
  const resolved = path.resolve(candidate);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`ACP session ${label} is outside the configured workspace.`);
  }
  return resolved;
}

function appendSessionHistory(history: string, user: string, assistant: string): string {
  const next = [
    history,
    `User:\n${user}`,
    `AtlasMind:\n${assistant}`,
  ].filter(Boolean).join('\n\n');
  return next.length <= MAX_ACP_SESSION_HISTORY_CHARS
    ? next
    : next.slice(next.length - MAX_ACP_SESSION_HISTORY_CHARS);
}

function toAcpToolKind(policy: ToolInvocationPolicy, toolName: string): ToolKind {
  if (toolName.includes('delete')) {
    return 'delete';
  }
  if (toolName.includes('move')) {
    return 'move';
  }
  switch (policy.category) {
    case 'read':
    case 'git-read':
      return toolName.includes('search') ? 'search' : 'read';
    case 'workspace-write':
    case 'git-write':
      return 'edit';
    case 'terminal-read':
    case 'terminal-write':
      return 'execute';
    case 'network':
      return 'fetch';
    default:
      return 'other';
  }
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitize = (value: unknown, key = ''): unknown => {
    if (/secret|token|password|private.?key|authorization/i.test(key)) {
      return '[REDACTED]';
    }
    if (typeof value === 'string') {
      return value.length > MAX_TOOL_ARG_TEXT
        ? `${value.slice(0, MAX_TOOL_ARG_TEXT)}…`
        : value;
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map(item => sanitize(item));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).slice(0, 50).map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey),
        ]),
      );
    }
    return value;
  };
  return sanitize(args) as Record<string, unknown>;
}

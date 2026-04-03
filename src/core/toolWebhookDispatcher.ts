import * as vscode from 'vscode';

const WEBHOOK_TOKEN_SECRET_KEY = 'atlasmind.webhook.toolUse.bearerToken';
const WEBHOOK_HISTORY_KEY = 'atlasmind.toolWebhookHistory';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_HISTORY_ITEMS = 50;

const ALLOWED_EVENTS = ['tool.started', 'tool.completed', 'tool.failed', 'tool.test'] as const;

type ToolWebhookEventName = (typeof ALLOWED_EVENTS)[number];

export interface ToolWebhookEventPayload {
  event: ToolWebhookEventName;
  timestamp: string;
  taskId?: string;
  agentId?: string;
  toolName?: string;
  toolCallId?: string;
  model?: string;
  durationMs?: number;
  status?: 'started' | 'completed' | 'failed';
  argumentsPreview?: string;
  resultPreview?: string;
  error?: string;
}

interface ToolWebhookSettings {
  enabled: boolean;
  url: string;
  timeoutMs: number;
  events: Set<ToolWebhookEventName>;
}

export interface ToolWebhookDeliveryRecord {
  timestamp: string;
  event: ToolWebhookEventName;
  url: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Sends tool execution webhook events based on workspace configuration.
 */
export class ToolWebhookDispatcher {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outputChannel?: vscode.OutputChannel,
  ) {}

  async emit(payload: ToolWebhookEventPayload): Promise<void> {
    await this.deliver(payload, false);
  }

  async sendTestEvent(): Promise<void> {
    await this.deliver({
      event: 'tool.test',
      timestamp: new Date().toISOString(),
      status: 'completed',
      toolName: 'atlasmind.webhook.test',
      resultPreview: 'Test webhook from AtlasMind.',
    }, true);
  }

  private async deliver(payload: ToolWebhookEventPayload, bypassEventFilter: boolean): Promise<void> {
    const config = this.getSettings();
    if (!config.enabled || config.url.length === 0) {
      return;
    }

    if (!bypassEventFilter && !config.events.has(payload.event)) {
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const token = await this.context.secrets.get(WEBHOOK_TOKEN_SECRET_KEY);
    if (token && token.trim().length > 0) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }

    try {
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      await this.appendHistory({
        timestamp: new Date().toISOString(),
        event: payload.event,
        url: config.url,
        ok: response.ok,
        statusCode: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      });

      if (!response.ok) {
        this.outputChannel?.appendLine(
          `[webhook] ${payload.event} failed (${response.status}) -> ${config.url}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendHistory({
        timestamp: new Date().toISOString(),
        event: payload.event,
        url: config.url,
        ok: false,
        error: message,
      });
      this.outputChannel?.appendLine(
        `[webhook] ${payload.event} error -> ${config.url}: ${message}`,
      );
    }
  }

  async setToken(token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      await this.clearToken();
      return;
    }
    await this.context.secrets.store(WEBHOOK_TOKEN_SECRET_KEY, trimmed);
  }

  async clearToken(): Promise<void> {
    await this.context.secrets.delete(WEBHOOK_TOKEN_SECRET_KEY);
  }

  async hasToken(): Promise<boolean> {
    const token = await this.context.secrets.get(WEBHOOK_TOKEN_SECRET_KEY);
    return typeof token === 'string' && token.trim().length > 0;
  }

  async getRecentHistory(): Promise<ToolWebhookDeliveryRecord[]> {
    const current = this.context.globalState.get<ToolWebhookDeliveryRecord[]>(WEBHOOK_HISTORY_KEY, []);
    return [...current].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async clearHistory(): Promise<void> {
    await this.context.globalState.update(WEBHOOK_HISTORY_KEY, []);
  }

  private getSettings(): ToolWebhookSettings {
    const config = vscode.workspace.getConfiguration('atlasmind');
    const enabled = config.get<boolean>('toolWebhookEnabled', false);
    const url = (config.get<string>('toolWebhookUrl', '') ?? '').trim();
    const timeoutRaw = config.get<number>('toolWebhookTimeoutMs', DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000
      ? Math.floor(timeoutRaw)
      : DEFAULT_TIMEOUT_MS;

    const configuredEvents = config.get<string[]>('toolWebhookEvents', [
      'tool.started',
      'tool.completed',
      'tool.failed',
    ]);

    const events = new Set<ToolWebhookEventName>(
      (configuredEvents ?? [])
        .filter((event): event is ToolWebhookEventName =>
          typeof event === 'string' && ALLOWED_EVENTS.includes(event as ToolWebhookEventName),
        ),
    );

    return { enabled, url, timeoutMs, events };
  }

  private async appendHistory(record: ToolWebhookDeliveryRecord): Promise<void> {
    const current = this.context.globalState.get<ToolWebhookDeliveryRecord[]>(WEBHOOK_HISTORY_KEY, []);
    const next = [record, ...current].slice(0, MAX_HISTORY_ITEMS);
    await this.context.globalState.update(WEBHOOK_HISTORY_KEY, next);
  }
}

export function toJsonPreview(value: Record<string, unknown> | undefined, maxLength = 600): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return serialized.slice(0, maxLength) + '...';
  } catch {
    return '[unserializable arguments]';
  }
}

export function toTextPreview(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength) + '...';
}

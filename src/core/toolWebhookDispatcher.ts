import * as vscode from 'vscode';
import { toJsonPreview, toTextPreview } from './toolPreview.js';

export { toJsonPreview, toTextPreview } from './toolPreview.js';

const WEBHOOK_TOKEN_SECRET_KEY = 'atlasmind.webhook.toolUse.bearerToken';
const WEBHOOK_HISTORY_KEY = 'atlasmind.toolWebhookHistory';
const WEBHOOK_TRUSTED_WORKSPACE_KEY = 'atlasmind.toolWebhook.workspaceApproved';
import {
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  MAX_WEBHOOK_HISTORY_ITEMS,
  MAX_WEBHOOK_DELIVERY_ATTEMPTS,
  WEBHOOK_RETRY_BASE_DELAY_MS,
} from '../constants.js';

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

    if (!(await this.hasWorkspaceApproval())) {
      this.outputChannel?.appendLine('[webhook] Delivery skipped because this workspace has not been approved for outbound tool webhooks.');
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

    let lastStatusCode: number | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_WEBHOOK_DELIVERY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
        });

        if (response.ok) {
          await this.appendHistory({
            timestamp: new Date().toISOString(),
            event: payload.event,
            url: config.url,
            ok: true,
            statusCode: response.status,
          });
          return;
        }

        lastStatusCode = response.status;
        lastError = `HTTP ${response.status}`;
        const canRetry = response.status === 429 || response.status >= 500;
        if (!canRetry || attempt === MAX_WEBHOOK_DELIVERY_ATTEMPTS) {
          break;
        }

        await delay(attempt * WEBHOOK_RETRY_BASE_DELAY_MS);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_WEBHOOK_DELIVERY_ATTEMPTS) {
          break;
        }
        await delay(attempt * WEBHOOK_RETRY_BASE_DELAY_MS);
      }
    }

    await this.appendHistory({
      timestamp: new Date().toISOString(),
      event: payload.event,
      url: config.url,
      ok: false,
      statusCode: lastStatusCode,
      error: lastError ?? 'webhook delivery failed',
    });

    this.outputChannel?.appendLine(
      `[webhook] ${payload.event} failed -> ${config.url}: ${lastError ?? 'unknown error'}`,
    );
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

  async hasWorkspaceApproval(): Promise<boolean> {
    return this.context.workspaceState.get<boolean>(WEBHOOK_TRUSTED_WORKSPACE_KEY, false);
  }

  async ensureWorkspaceApproval(interactive: boolean): Promise<boolean> {
    if (await this.hasWorkspaceApproval()) {
      return true;
    }

    if (!interactive) {
      return false;
    }

    const choice = await vscode.window.showWarningMessage(
      'This workspace can configure outbound tool webhooks. Approving webhooks allows workspace settings to send tool metadata and previews to the configured endpoint.',
      { modal: true },
      'Trust webhooks for this workspace',
    );

    if (choice !== 'Trust webhooks for this workspace') {
      return false;
    }

    await this.context.workspaceState.update(WEBHOOK_TRUSTED_WORKSPACE_KEY, true);
    return true;
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
    const rawUrl = (config.get<string>('toolWebhookUrl', '') ?? '').trim();
    const timeoutRaw = config.get<number>('toolWebhookTimeoutMs', DEFAULT_WEBHOOK_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000
      ? Math.floor(timeoutRaw)
      : DEFAULT_WEBHOOK_TIMEOUT_MS;

    // Enforce HTTPS (allow http only for localhost/127.0.0.1 for local testing)
    let url = '';
    if (rawUrl.length > 0) {
      try {
        const parsed = new URL(rawUrl);
        const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
        if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalhost)) {
          url = rawUrl;
        } else {
          this.outputChannel?.appendLine(`[webhook] Rejected non-HTTPS webhook URL: ${rawUrl}. Only HTTPS (or HTTP to localhost) is allowed.`);
        }
      } catch {
        this.outputChannel?.appendLine(`[webhook] Invalid webhook URL: ${rawUrl}`);
      }
    }

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
    const next = [record, ...current].slice(0, MAX_WEBHOOK_HISTORY_ITEMS);
    await this.context.globalState.update(WEBHOOK_HISTORY_KEY, next);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

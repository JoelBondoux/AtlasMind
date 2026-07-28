/**
 * DirectorCommsRunner — the pure detection + argument-mapping layer for the
 * Project Director's *optional, guarded* outbound messaging (Phase 3).
 *
 * AtlasMind can reach a contact through a connected MCP connector (Microsoft
 * 365 / Outlook, Slack, a Google-Calendar MCP server, …) rather than only a
 * deep-link — but only when the project has explicitly enabled outbound
 * messaging, a matching connector is connected, and the user confirms the exact
 * action. This module holds the parts that are safe to unit-test in isolation:
 * detecting which connected tool can perform an intent, and mapping a draft onto
 * that tool's input schema. The actual dispatch, the authorization modal, and
 * the deny-by-default gating live in the dashboard panel (they need `vscode`).
 *
 * Nothing here sends anything: it only classifies tools and shapes arguments.
 */

import type { CommunicationChannelKind, McpServerState } from '../types.js';

export type DirectorCommsIntent = 'email' | 'schedule' | 'message';

/** A connected MCP tool that can perform a communication intent. */
export interface ConnectorCapability {
  serverId: string;
  serverName: string;
  toolName: string;
  intent: DirectorCommsIntent;
  /** Contact-link kind this connector is safe to receive, if provider-specific. */
  channelKind?: CommunicationChannelKind;
  /** Message delivery shape, used to distinguish Buzz channel posts from DMs. */
  delivery?: 'channel' | 'dm' | 'generic';
  inputSchema: Record<string, unknown>;
}

/** A composed message ready to be mapped onto a connector tool's arguments. */
export interface CommsDraft {
  intent: DirectorCommsIntent;
  /** Non-secret recipient identifier: email address, channel, or @handle. */
  recipient: string;
  recipientName?: string;
  subject?: string;
  body?: string;
  /** ISO start/end for a schedule intent. */
  start?: string;
  end?: string;
}

const INTENT_PATTERNS: Array<{ intent: DirectorCommsIntent; patterns: RegExp[] }> = [
  { intent: 'email', patterns: [/send[_-]?mail/i, /send[_-]?email/i, /mail[_-]?send/i, /(send|forward|reply)[_a-z]*?(mail|email|draft)/i, /(create|send)[_a-z]*?draft/i] },
  { intent: 'schedule', patterns: [/create[_-]?event/i, /(create|schedule|add|update)[_a-z]*?(event|meeting|appointment)/i, /calendar[_-]?event/i] },
  { intent: 'message', patterns: [/post[_-]?message/i, /(post|send)[_a-z]*?(message|chat)/i, /conversations?[_-]?add[_-]?message/i, /chat[_-]?post/i, /post[_-]?to[_-]?channel/i, /send[_-]?dm/i, /direct[_-]?message/i, /buzz[_-]?(post|send|message|channel|dm)/i] },
];

/** Classify a tool name into the communication intent it can perform, if any. */
export function classifyToolIntent(toolName: string): DirectorCommsIntent | undefined {
  const name = String(toolName || '');
  for (const entry of INTENT_PATTERNS) {
    if (entry.patterns.some(pattern => pattern.test(name))) {
      return entry.intent;
    }
  }
  return undefined;
}

/** Prefer a real send/create tool over a draft-only or lookup tool. Higher = better. */
function intentRank(toolName: string, intent: DirectorCommsIntent): number {
  const name = toolName.toLowerCase();
  if (intent === 'email') {
    if (/send/.test(name) && !/draft/.test(name)) { return 3; }
    if (/send/.test(name)) { return 2; }
    return 1; // draft/forward/reply
  }
  if (intent === 'schedule') {
    if (/create[_-]?event/.test(name)) { return 3; }
    if (/create|schedule|add/.test(name)) { return 2; }
    return 1; // update/respond
  }
  // message
  if (/post[_-]?message/.test(name)) { return 3; }
  if (/post|send/.test(name)) { return 2; }
  return 1;
}

function inferChannelKind(
  serverName: string,
  toolName: string,
  intent: DirectorCommsIntent,
): CommunicationChannelKind | undefined {
  const haystack = `${serverName} ${toolName}`.toLowerCase();
  if (/\bbuzz\b|buzz[_-]/.test(haystack)) { return 'buzz'; }
  if (/\bslack\b|slack[_-]/.test(haystack)) { return 'slack'; }
  if (/\bteams?\b|msteams|teams?[_-]/.test(haystack)) { return 'teams'; }
  if (intent === 'email' || intent === 'schedule' || /\boutlook\b|\bmail\b|\bemail\b/.test(haystack)) {
    return 'email';
  }
  return undefined;
}

function inferDelivery(toolName: string, channelKind: CommunicationChannelKind | undefined): ConnectorCapability['delivery'] {
  if (channelKind !== 'buzz') {
    return 'generic';
  }
  return /send[_-]?dm|direct[_-]?message|\bdm\b/i.test(toolName) ? 'dm' : 'channel';
}

/**
 * Detect, across the CONNECTED MCP servers, the best tool for each provider,
 * intent, and delivery shape. Keeping provider-specific capabilities separate
 * prevents a Buzz recipient from ever being handed to Slack merely because its
 * tool happened to rank first.
 */
export function detectConnectorCapabilities(servers: readonly McpServerState[]): ConnectorCapability[] {
  const best = new Map<string, ConnectorCapability & { rank: number }>();
  for (const server of servers) {
    if (server.status !== 'connected') {
      continue;
    }
    for (const tool of server.tools ?? []) {
      const intent = classifyToolIntent(tool.name);
      if (!intent) {
        continue;
      }
      const channelKind = inferChannelKind(server.config.name, tool.name, intent);
      const delivery = inferDelivery(tool.name, channelKind);
      const rank = intentRank(tool.name, intent);
      const key = `${intent}:${channelKind ?? 'generic'}:${delivery}`;
      const current = best.get(key);
      if (!current || rank > current.rank) {
        best.set(key, {
          serverId: server.config.id,
          serverName: server.config.name,
          toolName: tool.name,
          intent,
          channelKind,
          delivery,
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
          rank,
        });
      }
    }
  }
  return [...best.values()].map(({ rank: _rank, ...capability }) => capability);
}

/** The capability for a given intent, if one is connected. */
export function resolveCapability(
  capabilities: readonly ConnectorCapability[],
  intent: DirectorCommsIntent,
  channelKind?: CommunicationChannelKind,
  recipient?: string,
): ConnectorCapability | undefined {
  const intended = capabilities.filter(capability => capability.intent === intent);
  if (!channelKind) {
    return intended[0];
  }
  const exact = intended.filter(capability => capability.channelKind === channelKind);
  const generic = intended.filter(capability => capability.channelKind === undefined);
  const candidates = exact.length > 0 ? exact : generic;
  if (channelKind === 'buzz' && recipient) {
    const trimmed = recipient.trim();
    const isPubkey = /^[0-9a-f]{64}$/i.test(trimmed);
    const isChannel = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
    if (!isPubkey && !isChannel) {
      return candidates.find(capability => capability.delivery === 'generic');
    }
    const desiredDelivery = isPubkey ? 'dm' : 'channel';
    return candidates.find(capability => capability.delivery === desiredDelivery)
      ?? candidates.find(capability => capability.delivery === 'generic');
  }
  return candidates[0];
}

function schemaProperties(schema: Record<string, unknown> | undefined): string[] {
  const props = schema && typeof schema === 'object' ? (schema as { properties?: unknown }).properties : undefined;
  return props && typeof props === 'object' ? Object.keys(props as Record<string, unknown>) : [];
}

/**
 * Best-effort map of a {@link CommsDraft} onto a connector tool's declared
 * input-schema property names. Candidate patterns are tried in priority order;
 * the first schema property that matches wins. Only fields the schema actually
 * declares are included — nothing is invented — so the confirmation modal can
 * show the user exactly what will be sent before any dispatch.
 */
export function buildToolArgs(capability: ConnectorCapability, draft: CommsDraft): Record<string, unknown> {
  const props = schemaProperties(capability.inputSchema);
  const args: Record<string, unknown> = {};
  const set = (candidates: RegExp[], value: string | undefined): void => {
    if (value == null || value === '') {
      return;
    }
    for (const pattern of candidates) {
      const key = props.find(prop => pattern.test(prop));
      if (key) {
        args[key] = value;
        return;
      }
    }
  };

  if (capability.intent === 'email') {
    set([/^to$/i, /^recipient/i, /torecipients/i, /address/i, /email/i], draft.recipient);
    set([/subject/i, /^title$/i], draft.subject);
    set([/^body$/i, /content/i, /^message$/i, /^text$/i], draft.body);
  } else if (capability.intent === 'schedule') {
    set([/subject/i, /^title$/i, /summary/i], draft.subject);
    set([/start/i, /begin/i], draft.start);
    set([/^end$/i, /finish/i], draft.end);
    set([/^body$/i, /content/i, /description/i, /notes/i], draft.body);
    set([/attendee/i, /invite/i, /^to$/i], draft.recipient);
  } else {
    set([/channel/i, /conversation/i, /^to$/i, /recipient/i, /pubkey/i], draft.recipient);
    set([/^text$/i, /^message$/i, /^body$/i, /content/i], draft.body);
  }
  return args;
}

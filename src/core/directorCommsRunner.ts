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

import type { McpServerState } from '../types.js';

export type DirectorCommsIntent = 'email' | 'schedule' | 'message';

/** A connected MCP tool that can perform a communication intent. */
export interface ConnectorCapability {
  serverId: string;
  serverName: string;
  toolName: string;
  intent: DirectorCommsIntent;
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

/**
 * Detect, across the CONNECTED MCP servers, the best tool for each
 * communication intent. Returns at most one capability per intent (the
 * highest-ranked send/create tool). Disconnected servers are ignored.
 */
export function detectConnectorCapabilities(servers: readonly McpServerState[]): ConnectorCapability[] {
  const best = new Map<DirectorCommsIntent, ConnectorCapability & { rank: number }>();
  for (const server of servers) {
    if (server.status !== 'connected') {
      continue;
    }
    for (const tool of server.tools ?? []) {
      const intent = classifyToolIntent(tool.name);
      if (!intent) {
        continue;
      }
      const rank = intentRank(tool.name, intent);
      const current = best.get(intent);
      if (!current || rank > current.rank) {
        best.set(intent, {
          serverId: server.config.id,
          serverName: server.config.name,
          toolName: tool.name,
          intent,
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
): ConnectorCapability | undefined {
  return capabilities.find(capability => capability.intent === intent);
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
    set([/channel/i, /conversation/i, /^to$/i, /recipient/i], draft.recipient);
    set([/^text$/i, /^message$/i, /^body$/i, /content/i], draft.body);
  }
  return args;
}

/**
 * ACP permission policy — deciding what an ACP agent is allowed to do.
 *
 * This is the authority boundary for Tier 3 of
 * `project_memory/roadmap/acp-integration.md`. Tier 1 ran agents with no tools
 * and refused `session/request_permission` outright, which is safe but inert.
 * Enabling tools does not move authority to the agent; it moves the *question*
 * to AtlasMind. **Delegated execution is never delegated authorization.**
 *
 * Three decisions here are load-bearing, and each one is deliberately the
 * cautious branch:
 *
 * 1. **AtlasMind never selects `allow_always`.** The protocol offers it, and it
 *    is tempting because it stops the prompting. But "always" chosen this way is
 *    remembered by *the agent*, in the agent's own persistent state — somewhere
 *    AtlasMind can neither display nor revoke. A grant the user cannot find is a
 *    grant the user cannot withdraw. AtlasMind keeps "always" on its own side
 *    (`ToolApprovalManager`'s bypass, which clears on restart and is visible in
 *    the UI) and answers the wire with `allow_once` every time.
 *
 * 2. **An unreadable request is refused, not guessed.** No parseable options, no
 *    option of the kind we need, an unparseable body — all produce a JSON-RPC
 *    error rather than a fabricated selection. Inventing an `optionId` would be
 *    inventing consent.
 *
 * 3. **`other` is the highest-risk bucket, not the lowest.** The schema marks
 *    `ToolKind::Other` as `#[serde(other)]`, so anything a newer agent invents
 *    lands there. "A kind this build has never heard of" is precisely the case
 *    that should prompt, so it maps to the same category as running a command.
 *
 * Pure and `vscode`-free: the dialog, the settings gate, and the approval
 * manager all live at the call site, so every branch below is unit-tested.
 */

import type { McpServerConfig, ToolRiskCategory } from '../types.js';
import {
  type AcpMcpServer,
  type AcpPermissionOption,
  type AcpPermissionRequest,
  type AcpToolCall,
  type AcpToolKind,
} from './acpProtocol.js';

/** How an ACP tool kind maps onto AtlasMind's existing approval taxonomy. */
export interface AcpToolRisk {
  category: ToolRiskCategory;
  risk: 'low' | 'medium' | 'high';
}

/**
 * Map an ACP tool kind onto the risk taxonomy the approval UI already speaks.
 *
 * Reusing `ToolRiskCategory` rather than inventing an ACP-specific one matters:
 * a user who has bypassed `workspace-write` for a task has made a decision about
 * *writing to their workspace*, and it should mean the same thing whether the
 * write comes from an AtlasMind subtask or a delegated ACP agent.
 */
export function acpToolRisk(kind: AcpToolKind): AcpToolRisk {
  switch (kind) {
    case 'read':
    case 'search':
      return { category: 'read', risk: 'low' };
    case 'think':
      return { category: 'read', risk: 'low' };
    case 'fetch':
      // Network egress: the request itself can carry context outward.
      return { category: 'network', risk: 'medium' };
    case 'edit':
    case 'move':
      return { category: 'workspace-write', risk: 'medium' };
    case 'delete':
      return { category: 'workspace-write', risk: 'high' };
    case 'execute':
      return { category: 'terminal-write', risk: 'high' };
    case 'switch_mode':
      // Changes how the agent behaves for the rest of the session rather than
      // touching anything directly — low blast radius, but not nothing.
      return { category: 'read', risk: 'low' };
    case 'other':
    default:
      // Unidentifiable, therefore treated as the worst thing it could be.
      return { category: 'terminal-write', risk: 'high' };
  }
}

/**
 * The allow option AtlasMind is willing to select.
 *
 * `allow_once` only — see the header. When an agent offers *only* `allow_always`
 * this returns nothing, and the caller refuses: a request whose sole path to
 * "yes" is a permanent grant is one AtlasMind declines to grant at all, because
 * approving it would hand over a permission the user cannot later find.
 */
export function chooseAllowOption(options: AcpPermissionOption[]): AcpPermissionOption | undefined {
  return options.find(option => option.kind === 'allow_once');
}

/**
 * The denial option to select.
 *
 * `reject_once` is preferred over `reject_always` for the mirror-image reason
 * that `allow_always` is refused: a persistent *denial* also lives in the
 * agent's state, and a user who declines one command has not asked to be locked
 * out of that tool for good. Falling back to `reject_always` is still better
 * than failing to deny, so it is used when nothing else is offered.
 */
export function chooseDenyOption(options: AcpPermissionOption[]): AcpPermissionOption | undefined {
  return options.find(option => option.kind === 'reject_once')
    ?? options.find(option => option.kind === 'reject_always');
}

/** What the session should put on the wire. */
export type AcpPermissionResolution =
  | { action: 'select'; optionId: string; allowed: boolean }
  /** The turn was cancelled — the spec's required answer to a pending request. */
  | { action: 'cancelled' }
  /** Nothing safe to send: reply with a JSON-RPC error carrying this message. */
  | { action: 'error'; message: string };

/**
 * Turn an approval decision into a wire resolution.
 *
 * Deny-by-default in shape: `approved` must be explicitly `true`, and even then
 * the request only resolves to a selection if a usable `allow_once` option was
 * actually offered. Every other path lands on a denial or an error.
 */
export function resolveAcpPermission(
  request: AcpPermissionRequest,
  approved: boolean,
): AcpPermissionResolution {
  if (request.options.length === 0) {
    return {
      action: 'error',
      message: 'The permission request carried no options AtlasMind could read, so it could not be answered.',
    };
  }

  if (approved) {
    const allow = chooseAllowOption(request.options);
    if (allow) {
      return { action: 'select', optionId: allow.optionId, allowed: true };
    }
    // Approved, but the only way to say yes is permanently. Fall through to a
    // denial rather than granting something unrevokable.
    const deny = chooseDenyOption(request.options);
    return deny
      ? { action: 'select', optionId: deny.optionId, allowed: false }
      : {
        action: 'error',
        message: 'The agent offered only a permanent "always allow" option. AtlasMind does not grant permissions it cannot later revoke.',
      };
  }

  const deny = chooseDenyOption(request.options);
  return deny
    ? { action: 'select', optionId: deny.optionId, allowed: false }
    : {
      action: 'error',
      message: 'The agent offered no way to decline this operation, so AtlasMind refused the request instead.',
    };
}

/**
 * One-line description of what the agent wants to do, for the dialog.
 *
 * The agent wrote the title, so it is untrusted text that has already been
 * control-stripped and clamped by the parser. The verb prefix is **ours**,
 * derived from the structured `kind`, so a tool that titles itself
 * "Reading a file" while declaring `kind: "execute"` is still announced as
 * running a command.
 */
export function describeAcpToolCall(toolCall: AcpToolCall): string {
  const verb = ACP_TOOL_KIND_VERBS[toolCall.kind] ?? ACP_TOOL_KIND_VERBS.other;
  const title = toolCall.title || toolCall.toolCallId;
  const where = toolCall.locations.length > 0
    ? ` (${toolCall.locations.slice(0, 3).join(', ')}${toolCall.locations.length > 3 ? `, +${toolCall.locations.length - 3} more` : ''})`
    : '';
  return `${verb}: ${title}${where}`;
}

// ── Which MCP servers an agent may be given ──────────────────────

/** A server that was asked for but not handed over, and why. */
export interface SkippedAcpMcpServer {
  name: string;
  reason: string;
}

/**
 * Pick the MCP servers to hand an ACP agent at `session/new`.
 *
 * Handing over a server means the agent's process launches that command with
 * that environment. Three classes are held back, and the third is the one that
 * matters:
 *
 * - **Not on the allowlist.** The allowlist is the grant. An empty one yields
 *   nothing, so a user who enables ACP tools without choosing servers gets an
 *   agent with only its own built-ins.
 * - **HTTP transport.** Only stdio is modelled; every agent must support it,
 *   whereas http/sse depend on `mcpCapabilities` and carry bearer headers.
 * - **Servers holding secrets.** A config with `secretEnvKeys` keeps those
 *   values in VS Code SecretStorage. Resolving them here would copy a
 *   credential the user gave *AtlasMind* into a third-party process's
 *   environment, silently, as a side effect of ticking a checkbox. That is not
 *   a decision this function is entitled to make on the user's behalf, so the
 *   server is skipped and reported. The server still works normally through
 *   AtlasMind's own tool loop; what it cannot do is forward the credential.
 */
export function selectAcpMcpServers(
  servers: readonly McpServerConfig[],
  allowedNames: readonly string[],
): { servers: AcpMcpServer[]; skipped: SkippedAcpMcpServer[] } {
  const allowed = new Set(allowedNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  const selected: AcpMcpServer[] = [];
  const skipped: SkippedAcpMcpServer[] = [];

  for (const server of servers) {
    if (!allowed.has(server.name.trim().toLowerCase())) {
      continue;
    }
    if (!server.enabled) {
      skipped.push({ name: server.name, reason: 'the server is disabled in AtlasMind' });
      continue;
    }
    if (server.transport !== 'stdio' || !server.command) {
      skipped.push({ name: server.name, reason: 'only stdio MCP servers can be shared with an ACP agent' });
      continue;
    }
    if (server.secretEnvKeys && server.secretEnvKeys.length > 0) {
      skipped.push({
        name: server.name,
        reason: 'it stores credentials in SecretStorage, which AtlasMind will not copy into another vendor\'s process',
      });
      continue;
    }

    selected.push({
      name: server.name,
      // The spec documents this as an absolute path. AtlasMind forwards what the
      // user configured rather than resolving it: a bare `npx` is what most
      // configs hold and what agents in practice resolve via PATH, and rewriting
      // a user's command to a guessed absolute path would be a worse failure
      // than letting the agent's own resolution decide.
      command: server.command,
      args: [...(server.args ?? [])],
      env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
    });
  }

  return { servers: selected, skipped };
}

const ACP_TOOL_KIND_VERBS: Record<AcpToolKind, string> = {
  read: 'Read',
  edit: 'Edit files',
  delete: 'Delete',
  move: 'Move or rename',
  search: 'Search',
  execute: 'Run a command',
  think: 'Think',
  fetch: 'Fetch from the network',
  switch_mode: 'Switch session mode',
  other: 'Unrecognised operation',
};

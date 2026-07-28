/**
 * Buzz inbound service — the wiring that turns the Tier-3 modules into a
 * running feature.
 *
 * `BuzzProtocol`, `BuzzConnectionPolicy`, `BuzzInboundDerivation`, `BuzzClient`,
 * and `BuzzSigner` are all `vscode`-free and individually testable. This module
 * is where they meet the editor: reading settings, resolving the agent key from
 * SecretStorage, holding the wake lock while a subscription is live, and
 * persisting derived follow-ups into Project Director.
 *
 * **Deny-by-default, two gates deep.** Inbound stays off unless *both*
 * `atlasmind.buzz.enabled` and `atlasmind.buzz.inboundEnabled` are on. Neither
 * defaults to true, so upgrading never starts a network subscription on its own.
 *
 * **Derive, don't mirror** is enforced upstream in `buzzInboundDerivation`; this
 * module only decides whether to persist what that produced. Persistence is
 * itself gated: `autoCreateFollowUps` (default off) means the default behaviour
 * is a notification, not a silent write into git-tracked project memory.
 *
 * The relay contract this depends on was verified against a live Buzz relay —
 * see the Tier-3 logs in `project_memory/roadmap/buzz-integration.md`.
 */

import * as vscode from 'vscode';
import { BuzzClient, type BuzzClientStatus, type BuzzEventSigner } from './buzzClient.js';
import { createBuzzWebSocketFactory } from './buzzSocket.js';
import { BUZZ_AGENT_KEY_SECRET, createBuzzEventSigner } from './buzzSigner.js';
import { parseAgentBindings, type BuzzAgentBinding } from './buzzAgentBindings.js';
import { BUZZ_INBOUND_KINDS, BUZZ_KIND, type NostrEvent, type NostrFilter } from './buzzProtocol.js';
import {
  createConversation,
  ingestEvent as ingestConversationEvent,
  recentMessages,
  type BuzzConversation,
  type BuzzMessage,
} from './buzzConversation.js';
import {
  createBuzzDirectory,
  identitiesMissingProfiles,
  listIdentities,
  observeEvent,
  type BuzzIdentity,
} from './buzzDirectory.js';
import type { DerivedWorkItem } from './buzzInboundDerivation.js';
import {
  readProjectDirectorConfig,
  writeProjectDirectorConfig,
} from './projectDirectorManager.js';
import type { FollowUp } from '../types.js';

/** Reason string used for the keep-awake hold while a subscription is live. */
export const BUZZ_PRESENCE_REASON = 'buzz';

/** Cap on follow-ups a single inbound batch may add, so a busy channel can't flood memory. */
export const MAX_INBOUND_FOLLOWUPS_PER_BATCH = 20;

export interface BuzzInboundSettings {
  enabled: boolean;
  inboundEnabled: boolean;
  relayUrl: string;
  allowRemoteRelay: boolean;
  channelIds: string[];
  autoCreateFollowUps: boolean;
  /** Buzz identity → AtlasMind agent bindings, already validated. */
  agentBindings: BuzzAgentBinding[];
  /** Bindings that could not be used, so they can be surfaced rather than dropped. */
  agentBindingIssues: { input: string; reason: string }[];
}

export interface BuzzPresenceLock {
  hold(reason: string): void;
  release(reason: string): void;
}

export interface BuzzInboundDeps {
  secrets: Pick<vscode.SecretStorage, 'get'>;
  presence?: BuzzPresenceLock;
  workspaceRoot?: string;
  log?: (message: string) => void;
}

/** Read the inbound settings. Both gates default to off. */
export function readBuzzInboundSettings(): BuzzInboundSettings {
  const cfg = vscode.workspace.getConfiguration('atlasmind');
  const rawChannels = cfg.get<unknown>('buzz.inboundChannels', []);
  const channelIds = Array.isArray(rawChannels)
    ? rawChannels.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map(entry => entry.trim())
    : [];

  const parsedBindings = parseAgentBindings(cfg.get<unknown>('buzz.agentBindings', {}));

  return {
    enabled: cfg.get<boolean>('buzz.enabled', false) === true,
    inboundEnabled: cfg.get<boolean>('buzz.inboundEnabled', false) === true,
    relayUrl: cfg.get<string>('buzz.relayUrl', 'ws://localhost:3000'),
    allowRemoteRelay: cfg.get<boolean>('buzz.allowRemoteRelay', false) === true,
    channelIds,
    autoCreateFollowUps: cfg.get<boolean>('buzz.autoCreateFollowUps', false) === true,
    agentBindings: parsedBindings.bindings,
    agentBindingIssues: parsedBindings.issues,
  };
}

/**
 * Build the subscription filters.
 *
 * Scoped to the configured channels via the `h` tag when any are listed —
 * verified against a live relay, where every channel message carried `h`.
 * With no channels configured the filter stays kind-scoped only, which is
 * still valid (`kinds` is always present, so it never trips the relay's 403).
 */
export function buildInboundFilters(channelIds: string[]): NostrFilter[] {
  const filter: NostrFilter = { kinds: [...BUZZ_INBOUND_KINDS], limit: 50 };
  if (channelIds.length > 0) {
    filter['#h'] = [...channelIds];
  }
  return [filter];
}

/**
 * Merge derived follow-ups into an existing list, skipping any whose id is
 * already present. Derived ids are deterministic per Buzz event, so a reconnect
 * replay or a second sighting updates nothing rather than duplicating.
 */
export function mergeDerivedFollowUps(existing: FollowUp[], derived: DerivedWorkItem[]): FollowUp[] {
  const seen = new Set(existing.map(entry => entry.id));
  const additions: FollowUp[] = [];

  for (const item of derived.slice(0, MAX_INBOUND_FOLLOWUPS_PER_BATCH)) {
    if (seen.has(item.followUp.id)) {
      continue;
    }
    seen.add(item.followUp.id);
    additions.push(item.followUp);
  }

  return additions.length > 0 ? [...existing, ...additions] : existing;
}

/** Wait after activity before asking for names, so a busy channel re-subscribes once. */
const PROFILE_LOOKUP_DEBOUNCE_MS = 3_000;

/** Cap on authors named in one profile filter — a filter is a request, not a scan. */
const MAX_PROFILE_LOOKUP = 50;

/**
 * Owns the lifetime of an inbound Buzz subscription and its side effects.
 *
 * Safe to construct unconditionally: nothing connects until `sync()` finds both
 * gates enabled.
 */
export class BuzzInboundService implements vscode.Disposable {
  private client: BuzzClient | undefined;
  private holding = false;
  private lastStatus: BuzzClientStatus = 'idle';
  private signerKeyFingerprint: string | undefined;
  /** Identities seen this session. In memory only — never written to git-tracked memory. */
  private readonly directory = createBuzzDirectory();
  private profileLookupHandle: ReturnType<typeof setTimeout> | undefined;
  /**
   * Live conversations, keyed by channel. **In memory only** — this is the one
   * place message bodies exist, and they must never reach `project_memory/`,
   * which is git-tracked. "Derive, don't mirror" governs what goes to disk; it
   * was never a rule against looking at a message.
   */
  private readonly conversations = new Map<string, BuzzConversation>();
  /** The local identity, so my own reactions can be marked as mine. */
  private selfPubkey: string | undefined;

  constructor(private readonly deps: BuzzInboundDeps) {}

  getStatus(): BuzzClientStatus {
    return this.client ? this.client.getStatus() : 'idle';
  }

  /**
   * Bring the subscription in line with current settings: start it, stop it, or
   * restart it when the relay/channels changed. Never throws.
   */
  async sync(): Promise<void> {
    let settings: BuzzInboundSettings;
    try {
      settings = readBuzzInboundSettings();
    } catch {
      return;
    }

    if (!settings.enabled || !settings.inboundEnabled) {
      this.stop();
      return;
    }

    // A key change or relay change requires a fresh connection.
    const fingerprint = `${settings.relayUrl}|${settings.allowRemoteRelay}|${settings.channelIds.join(',')}`;
    if (this.client && this.signerKeyFingerprint === fingerprint) {
      return;
    }
    this.stop();

    const signer = await this.resolveSigner();
    if (!signer) {
      // A relay that demands auth will stop the client with an explained reason;
      // an open relay still works. Either way this is not a crash.
      this.log('No Buzz agent key is stored — inbound will only work against a relay that does not require authentication. Run "AtlasMind: Set Buzz Agent Key" to add one.');
    }

    for (const issue of settings.agentBindingIssues) {
      this.log(`Buzz agent binding ignored ("${issue.input}"): ${issue.reason}`);
    }

    this.signerKeyFingerprint = fingerprint;
    // Knowing my own key lets a reaction I sent be shown as mine.
    this.selfPubkey = signer?.pubkey;
    this.client = new BuzzClient({
      relayUrl: settings.relayUrl,
      filters: buildInboundFilters(settings.channelIds),
      socketFactory: createBuzzWebSocketFactory(),
      ...(signer ? { signer } : {}),
      ...(settings.agentBindings.length > 0
        ? { derivation: { agentBindings: settings.agentBindings } }
        : {}),
      onStatusChange: status => this.handleStatusChange(status),
      onError: reason => this.log(reason),
      onWorkItems: items => { void this.handleWorkItems(items, settings); },
      onEvent: event => this.observe(event, settings.channelIds),
    });
    this.client.start();
  }

  /**
   * Record an observed identity, and ask the relay for the names of any
   * identities still unnamed.
   *
   * The profile request can only be built once authors are known — a kind-0
   * filter with no `authors` would pull every profile on the relay. It is
   * therefore debounced rather than issued per event: a busy channel would
   * otherwise re-subscribe on every message.
   */
  private observe(event: NostrEvent, channelIds: string[]): void {
    observeEvent(this.directory, event);
    this.recordConversation(event);
    if (identitiesMissingProfiles(this.directory, MAX_PROFILE_LOOKUP).length > 0) {
      this.scheduleProfileLookup(channelIds);
    }
  }

  private scheduleProfileLookup(channelIds: string[]): void {
    if (this.profileLookupHandle !== undefined) {
      return;
    }
    this.profileLookupHandle = setTimeout(() => {
      this.profileLookupHandle = undefined;
      const missing = identitiesMissingProfiles(this.directory, MAX_PROFILE_LOOKUP);
      if (missing.length === 0 || !this.client) {
        return;
      }
      // Both filters together: the message subscription must survive, since
      // replacing it with a profile-only filter would stop inbound work.
      this.client.updateFilters([
        ...buildInboundFilters(channelIds),
        { kinds: [BUZZ_KIND.profileMetadata], authors: missing, limit: missing.length },
      ]);
    }, PROFILE_LOOKUP_DEBOUNCE_MS);
    // Never hold the extension host open for a name lookup.
    (this.profileLookupHandle as { unref?: () => void }).unref?.();
  }

  /**
   * Buzz identities observed this session, most recently active first.
   *
   * In memory only, and deliberately so: a roster of who spoke and when is
   * exactly what `project_memory/` must not accumulate, being git-tracked.
   */
  listIdentities(): BuzzIdentity[] {
    return listIdentities(this.directory);
  }

  /** Fold an event into the conversation for its channel. */
  private recordConversation(event: NostrEvent): void {
    const channelId = event.tags.find(tag => tag[0] === 'h')?.[1]?.trim() ?? '';
    // A reaction carries no `h` tag, so it is offered to every open
    // conversation; only the one holding its target message will take it.
    const targets = channelId
      ? [this.conversationFor(channelId)]
      : [...this.conversations.values()];
    for (const conversation of targets) {
      ingestConversationEvent(conversation, event, this.selfPubkey);
    }
  }

  private conversationFor(channelId: string): BuzzConversation {
    const existing = this.conversations.get(channelId);
    if (existing) {
      return existing;
    }
    const created = createConversation(channelId);
    this.conversations.set(channelId, created);
    return created;
  }

  /** Channels with messages this session. */
  listConversationChannels(): string[] {
    return [...this.conversations.keys()];
  }

  /**
   * Recent messages for a channel, newest first. Session-scoped and never
   * written to disk.
   */
  readConversation(channelId: string, limit = 20): BuzzMessage[] {
    const conversation = this.conversations.get(channelId);
    return conversation ? recentMessages(conversation, limit) : [];
  }

  /** My own Buzz identity, when a key is configured. */
  getSelfPubkey(): string | undefined {
    return this.selfPubkey;
  }

  /** Every recent message across watched channels, newest first. */
  readAllConversations(limit = 20): BuzzMessage[] {
    return [...this.conversations.values()]
      .flatMap(conversation => conversation.messages)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, limit));
  }

  /** Stop the subscription and release the wake lock. Safe to call repeatedly. */
  stop(): void {
    this.client?.stop();
    this.client = undefined;
    this.signerKeyFingerprint = undefined;
    if (this.profileLookupHandle !== undefined) {
      clearTimeout(this.profileLookupHandle);
      this.profileLookupHandle = undefined;
    }
    this.releaseHold();
    this.lastStatus = 'idle';
  }

  dispose(): void {
    this.stop();
  }

  // ── Internals ─────────────────────────────────────────────────

  private async resolveSigner(): Promise<BuzzEventSigner | undefined> {
    let stored: string | undefined;
    try {
      stored = (await this.deps.secrets.get(BUZZ_AGENT_KEY_SECRET))?.trim();
    } catch {
      stored = undefined;
    }
    const key = stored || process.env['BUZZ_PRIVATE_KEY']?.trim();
    if (!key) {
      return undefined;
    }

    const built = await createBuzzEventSigner(key);
    if (!built.ok) {
      // Never echoes the key — `createBuzzEventSigner` guarantees that.
      this.log(`Buzz agent key unusable: ${built.reason}`);
      return undefined;
    }
    return built.signer;
  }

  /**
   * Hold the wake lock only while genuinely connected. The lock is
   * reference-counted and deny-by-default in `PresenceManager` — holding a
   * reason has no effect unless the user enabled `presence.keepAwake`.
   */
  private handleStatusChange(status: BuzzClientStatus): void {
    this.lastStatus = status;
    const live = status === 'subscribed' || status === 'live';
    if (live) {
      this.acquireHold();
    } else if (status === 'stopped' || status === 'idle') {
      this.releaseHold();
    }
  }

  private acquireHold(): void {
    if (this.holding || !this.deps.presence) {
      return;
    }
    this.holding = true;
    this.deps.presence.hold(BUZZ_PRESENCE_REASON);
  }

  private releaseHold(): void {
    if (!this.holding || !this.deps.presence) {
      this.holding = false;
      return;
    }
    this.holding = false;
    this.deps.presence.release(BUZZ_PRESENCE_REASON);
  }

  /**
   * Persist derived work items — but only with explicit opt-in. The default is
   * a notification, because project memory is git-tracked and writing to it
   * from a network event without consent is not a default anyone should get by
   * upgrading.
   */
  private async handleWorkItems(items: DerivedWorkItem[], settings: BuzzInboundSettings): Promise<void> {
    if (items.length === 0) {
      return;
    }

    if (!settings.autoCreateFollowUps) {
      this.log(`Buzz: ${items.length} new item(s) — enable atlasmind.buzz.autoCreateFollowUps to record them as follow-ups.`);
      return;
    }

    const workspaceRoot = this.deps.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    try {
      const config = readProjectDirectorConfig(workspaceRoot);
      if (!config) {
        this.log('Buzz: no Project Director config in this workspace, so inbound items were not recorded.');
        return;
      }
      const merged = mergeDerivedFollowUps(config.followUps ?? [], items);
      if (merged === (config.followUps ?? [])) {
        return;
      }
      await writeProjectDirectorConfig(workspaceRoot, { ...config, followUps: merged });
      this.log(`Buzz: recorded ${merged.length - (config.followUps?.length ?? 0)} follow-up(s) from inbound activity.`);
    } catch (error) {
      this.log(`Buzz: could not record inbound follow-ups: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private log(message: string): void {
    this.deps.log?.(message);
  }
}

/**
 * Buzz agent bindings — mapping a Buzz agent identity to an AtlasMind agent.
 *
 * Buzz gives every participant, human or agent, a Nostr keypair. AtlasMind has
 * its own roster of specialist agents. This module lets a project say *"work
 * arriving from this Buzz identity belongs to that AtlasMind agent"* — so an
 * inbound message from a Buzz build-bot can land with the DevOps specialist
 * rather than as an unattributed follow-up.
 *
 * It stays firmly on AtlasMind's side of the governing contract: this is a
 * **local routing preference**, not identity. Buzz still owns the keypair, the
 * directory, and the authorship ledger; AtlasMind only records "when I see this
 * pubkey, prefer this agent." No key is minted, mirrored, or verified here.
 *
 * Pure, `vscode`-free, and unit-tested. Both sides of a binding are normalised:
 * the Buzz key through `normalizeBuzzPubkey` (so `npub…` and hex forms are
 * interchangeable and a mistyped npub is rejected rather than silently binding
 * to the wrong identity), and the agent id trimmed.
 */

import { normalizeBuzzPubkey } from './buzzSigner.js';

/** Cap on stored bindings, so a malformed setting cannot balloon memory. */
export const MAX_AGENT_BINDINGS = 100;

export interface BuzzAgentBinding {
  /** The Buzz identity, normalised to lowercase 32-byte hex. */
  pubkey: string;
  /**
   * The AtlasMind agents that should own work from this identity, in order.
   *
   * A list rather than a single id because one Buzz correspondent often spans
   * more than one specialism — a colleague who raises both API defects and
   * design feedback belongs to two agents, and forcing a choice between them
   * loses information the user actually has. **The first is the owner**: a work
   * item has exactly one, and picking it by inference across a set would be a
   * claim the binding does not make. The rest are recorded as also-relevant.
   *
   * Never empty — an empty list is an unbinding, not a binding.
   */
  agentIds: string[];
  /** Optional human label, purely for display. */
  label?: string;
}

/**
 * Cap on agents bound to one identity. Generous enough for a real
 * cross-functional correspondent, small enough that a malformed setting cannot
 * turn one entry into an unbounded list.
 */
export const MAX_AGENTS_PER_BINDING = 8;

export interface BuzzAgentBindingIssue {
  /** The offending entry, as written by the user. */
  input: string;
  reason: string;
}

export interface ParsedAgentBindings {
  bindings: BuzzAgentBinding[];
  /** Entries that could not be used, with why — surfaced rather than dropped silently. */
  issues: BuzzAgentBindingIssue[];
}

/**
 * Parse the `atlasmind.buzz.agentBindings` setting.
 *
 * Accepts a record of `<npub-or-hex>: <agentId>` or `<npub-or-hex>: [<agentId>…]`,
 * or an array of `{ pubkey, agentId | agentIds, label? }` objects. A bare string
 * is the shape every binding written before multi-agent support uses, so those
 * keep working untouched. Unusable entries are **reported, not
 * silently discarded** — a binding that quietly fails would route work to the
 * wrong agent (or nowhere) with no explanation.
 *
 * Never throws.
 */
/**
 * Read one or several agent ids from a setting value.
 *
 * Accepts a bare string (every binding written before multi-agent support) or
 * an array. Blank entries and duplicates are dropped rather than reported: an
 * empty slot in a list is a UI artefact, not a mistake worth a warning.
 */
function readAgentIds(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const ids: string[] = [];
  for (const value of values) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= MAX_AGENTS_PER_BINDING) {
      break;
    }
  }
  return ids;
}

export function parseAgentBindings(input: unknown): ParsedAgentBindings {
  const bindings: BuzzAgentBinding[] = [];
  const issues: BuzzAgentBindingIssue[] = [];
  const seen = new Set<string>();

  const add = (rawKey: unknown, rawAgent: unknown, rawLabel?: unknown): void => {
    if (bindings.length >= MAX_AGENT_BINDINGS) {
      return;
    }
    const keyText = typeof rawKey === 'string' ? rawKey.trim() : '';
    // One agent or several. A bare string is the shape every existing setting
    // is written in, so it keeps working untouched; a list is the new one.
    const agentIds = readAgentIds(rawAgent);

    if (!keyText || agentIds.length === 0) {
      issues.push({ input: keyText || '(blank)', reason: 'Both a Buzz identity and at least one AtlasMind agent id are required.' });
      return;
    }

    const pubkey = normalizeBuzzPubkey(keyText);
    if (!pubkey) {
      issues.push({
        input: keyText,
        reason: 'Not a valid Buzz public key. Use an npub… or a 64-character hex key (an nsec is a secret key and is refused).',
      });
      return;
    }
    if (seen.has(pubkey)) {
      issues.push({ input: keyText, reason: 'Duplicate Buzz identity — only the first binding is used.' });
      return;
    }

    seen.add(pubkey);
    const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim().slice(0, 80) : undefined;
    bindings.push({ pubkey, agentIds, ...(label ? { label } : {}) });
  };

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        add(record['pubkey'] ?? record['npub'] ?? record['buzz'], record['agentIds'] ?? record['agentId'] ?? record['agent'], record['label']);
      } else {
        issues.push({ input: String(entry), reason: 'Expected an object with pubkey and agentId (or agentIds).' });
      }
    }
  } else if (input && typeof input === 'object') {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      add(key, value);
    }
  }

  return { bindings, issues };
}

/** The outcome of editing one binding in the raw setting value. */
export interface AgentBindingWriteResult {
  ok: boolean;
  /**
   * The new raw setting value, ready to hand to `configuration.update`. Present
   * only when `ok`. Written in the **same shape the user already had**, so a
   * hand-written record does not silently become an array.
   */
  value?: unknown;
  /** Why the edit was refused. Present only when `!ok` — never both. */
  error?: string;
}

/**
 * Add, replace, or remove a single binding inside the raw
 * `atlasmind.buzz.agentBindings` value.
 *
 * Pure: takes the current setting, returns the next one. This exists so a UI
 * that offers "bind this person to that agent" cannot invent its own merge
 * rules — the same validation that guards a hand-edited setting guards a
 * click. An empty `agentIds` means *unbind*, which is why it is not an error.
 *
 * A key that will not normalise is **refused with a reason**, never coerced.
 * Binding to a different real identity because one bech32 character was
 * mistyped is worse than not binding at all.
 */
export function writeAgentBinding(
  currentSetting: unknown,
  input: { pubkey: string; agentIds: readonly string[]; label?: string },
): AgentBindingWriteResult {
  const pubkey = normalizeBuzzPubkey(typeof input.pubkey === 'string' ? input.pubkey.trim() : '');
  if (!pubkey) {
    return {
      ok: false,
      error: 'Not a valid Buzz public key. Use an npub… or a 64-character hex key (an nsec is a secret key and is refused).',
    };
  }

  const agentIds = readAgentIds(input.agentIds);
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 80) : undefined;

  // Keep every other binding exactly as parsed, so one edit cannot disturb the
  // rest — including entries this call has no opinion about.
  const kept = parseAgentBindings(currentSetting).bindings.filter(binding => binding.pubkey !== pubkey);
  if (agentIds.length > 0 && kept.length >= MAX_AGENT_BINDINGS) {
    return { ok: false, error: `At most ${MAX_AGENT_BINDINGS} agent bindings are supported.` };
  }
  const next = agentIds.length > 0 ? [...kept, { pubkey, agentIds, ...(label ? { label } : {}) }] : kept;

  if (Array.isArray(currentSetting)) {
    return { ok: true, value: next };
  }
  // A single binding stays a plain string, so a hand-written record does not
  // sprout arrays the moment one unrelated entry gains a second agent.
  const record: Record<string, string | string[]> = {};
  for (const binding of next) {
    record[binding.pubkey] = binding.agentIds.length === 1 ? binding.agentIds[0]! : [...binding.agentIds];
  }
  return { ok: true, value: record };
}

/**
 * Find the AtlasMind agent bound to a Buzz identity, if any.
 *
 * Returns undefined when unbound — the caller must treat that as "no preference"
 * and leave the work unassigned rather than guessing an agent. Assigning by
 * inference would be a claim the data does not support.
 */
export function resolveBoundAgent(
  bindings: BuzzAgentBinding[],
  authorPubkey: string,
): BuzzAgentBinding | undefined {
  const normalized = normalizeBuzzPubkey(authorPubkey);
  if (!normalized) {
    return undefined;
  }
  return bindings.find(binding => binding.pubkey === normalized);
}

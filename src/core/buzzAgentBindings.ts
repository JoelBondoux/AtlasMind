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
  /** The AtlasMind agent id that should own work from this identity. */
  agentId: string;
  /** Optional human label, purely for display. */
  label?: string;
}

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
 * Accepts a record of `<npub-or-hex>: <agentId>`, or an array of
 * `{ pubkey, agentId, label? }` objects. Unusable entries are **reported, not
 * silently discarded** — a binding that quietly fails would route work to the
 * wrong agent (or nowhere) with no explanation.
 *
 * Never throws.
 */
export function parseAgentBindings(input: unknown): ParsedAgentBindings {
  const bindings: BuzzAgentBinding[] = [];
  const issues: BuzzAgentBindingIssue[] = [];
  const seen = new Set<string>();

  const add = (rawKey: unknown, rawAgent: unknown, rawLabel?: unknown): void => {
    if (bindings.length >= MAX_AGENT_BINDINGS) {
      return;
    }
    const keyText = typeof rawKey === 'string' ? rawKey.trim() : '';
    const agentId = typeof rawAgent === 'string' ? rawAgent.trim() : '';

    if (!keyText || !agentId) {
      issues.push({ input: keyText || '(blank)', reason: 'Both a Buzz identity and an AtlasMind agent id are required.' });
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
    bindings.push({ pubkey, agentId, ...(label ? { label } : {}) });
  };

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        add(record['pubkey'] ?? record['npub'] ?? record['buzz'], record['agentId'] ?? record['agent'], record['label']);
      } else {
        issues.push({ input: String(entry), reason: 'Expected an object with pubkey and agentId.' });
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
 * click. An empty `agentId` means *unbind*, which is why it is not an error.
 *
 * A key that will not normalise is **refused with a reason**, never coerced.
 * Binding to a different real identity because one bech32 character was
 * mistyped is worse than not binding at all.
 */
export function writeAgentBinding(
  currentSetting: unknown,
  input: { pubkey: string; agentId: string; label?: string },
): AgentBindingWriteResult {
  const pubkey = normalizeBuzzPubkey(typeof input.pubkey === 'string' ? input.pubkey.trim() : '');
  if (!pubkey) {
    return {
      ok: false,
      error: 'Not a valid Buzz public key. Use an npub… or a 64-character hex key (an nsec is a secret key and is refused).',
    };
  }

  const agentId = typeof input.agentId === 'string' ? input.agentId.trim() : '';
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 80) : undefined;

  // Keep every other binding exactly as parsed, so one edit cannot disturb the
  // rest — including entries this call has no opinion about.
  const kept = parseAgentBindings(currentSetting).bindings.filter(binding => binding.pubkey !== pubkey);
  if (agentId && kept.length >= MAX_AGENT_BINDINGS) {
    return { ok: false, error: `At most ${MAX_AGENT_BINDINGS} agent bindings are supported.` };
  }
  const next = agentId ? [...kept, { pubkey, agentId, ...(label ? { label } : {}) }] : kept;

  if (Array.isArray(currentSetting)) {
    return { ok: true, value: next };
  }
  const record: Record<string, string> = {};
  for (const binding of next) {
    record[binding.pubkey] = binding.agentId;
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

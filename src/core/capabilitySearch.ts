import type { ArdDiscoveredResource } from '../types.js';
import { redactSecrets } from '../utils/secretRedactor.js';

/**
 * What chat does when it needs a tool nobody installed.
 *
 * `find-tool` searches the skills this agent may already use. When that comes
 * back empty the turn used to end with "tell the operator what is missing", and
 * the operator then had to know that Resource Discovery existed, open it, and
 * search for the same thing by hand. This module is the next rung: the same
 * query goes to the Agent Finders the user has enabled, and the candidates come
 * back into the conversation with a way to install them.
 *
 * Four rules.
 *
 * **Enabling a finder is the consent.** Finders ship disabled; a query only
 * leaves the machine to finders somebody switched on. With none enabled the
 * answer says so and names where to enable one — silence would read as "no such
 * tool exists", which nobody checked.
 *
 * **Only a short capability description leaves the machine** — the model's
 * `find-tool` query, secret-redacted and clamped. Never file contents, never the
 * conversation.
 *
 * **Discovery installs nothing and grants nothing.** Candidates are described to
 * the model so it can tell the user what would help; installing is a separate,
 * confirmed act by a person, and an installed MCP server arrives disabled.
 *
 * **A relevance score is not a trust rating**, and every result says so.
 */

/** The most candidates carried back into a turn. More is a catalogue, not an answer. */
export const MAX_CHAT_DISCOVERY_RESULTS = 5;

/** Longest query sent to a finder. A capability description, not a paragraph. */
export const MAX_CHAT_DISCOVERY_QUERY_CHARS = 160;

export type ExternalCapabilitySearch = (query: string, signal?: AbortSignal) => Promise<ExternalCapabilityOutcome>;

export type ExternalCapabilityOutcome =
  | { status: 'no-finders' }
  | { status: 'searched'; finderCount: number; resources: ArdDiscoveredResource[]; errors: string[] }
  | { status: 'failed'; message: string };

/** Clamp and redact a query before it leaves the machine. Empty means do not send. */
export function prepareCapabilityQuery(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }
  const redacted = redactSecrets(collapsed).text;
  return redacted.length > MAX_CHAT_DISCOVERY_QUERY_CHARS
    ? redacted.slice(0, MAX_CHAT_DISCOVERY_QUERY_CHARS).trimEnd()
    : redacted;
}

/**
 * The text the model reads after a local miss, given what the external search
 * found. Composed here so the no-finder and error cases cannot be dropped by a
 * caller that only handles success.
 */
export function describeCapabilityOutcome(
  query: string,
  outcome: ExternalCapabilityOutcome,
): { message: string; resources: ArdDiscoveredResource[] } {
  if (outcome.status === 'no-finders') {
    return {
      message: `No installed tool matches "${query}", and no Agent Finder is enabled, so third-party tools were not searched. `
        + 'Tell the user what capability is missing and that they can enable a finder in AtlasMind Settings → Resource Discovery '
        + 'so AtlasMind can look for one next time.',
      resources: [],
    };
  }
  if (outcome.status === 'failed') {
    return {
      message: `No installed tool matches "${query}". Searching Resource Discovery also failed (${outcome.message}). `
        + 'Tell the user what capability is missing.',
      resources: [],
    };
  }

  const resources = outcome.resources.slice(0, MAX_CHAT_DISCOVERY_RESULTS);
  const errorNote = outcome.errors.length > 0 ? ` (${outcome.errors.length} finder(s) could not be reached)` : '';
  if (resources.length === 0) {
    return {
      message: `No installed tool matches "${query}", and ${outcome.finderCount} enabled Agent Finder(s) found nothing either${errorNote}. `
        + 'Tell the user what capability is missing.',
      resources: [],
    };
  }

  const lines = resources.map((resource, index) => {
    const score = typeof resource.score === 'number' ? `, relevance ${resource.score}/100` : '';
    const description = resource.description ? ` — ${resource.description.replace(/\s+/g, ' ').slice(0, 160)}` : '';
    return `${index + 1}. ${resource.displayName} [${shortResourceType(resource.type)}] via ${resource.sourceName}${score}${description}`;
  });
  return {
    message: [
      `No installed tool matches "${query}". Resource Discovery found ${resources.length} third-party candidate(s)${errorNote}:`,
      ...lines,
      'None of these is installed, and you cannot call them on this turn. Tell the user which one would do the job and why; '
        + 'the reply shows them a "Review & install" button for each. Relevance is how well it matches the query — not a trust or safety rating.',
    ].join('\n'),
    resources,
  };
}

function shortResourceType(type: string): string {
  return type.replace(/^application\//, '').replace(/\+json$/, '').replace(/^vnd\.atlasmind\./, '');
}

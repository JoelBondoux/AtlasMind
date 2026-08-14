import type { SkillDefinition } from '../types.js';

/**
 * Letting the model ask for a tool it was not given.
 *
 * A turn can only send so many schemas — AtlasMind caps at 24, and the cap is
 * real: schemas are the largest fixed cost in a request and most of them are
 * irrelevant to any given question. Selection therefore guesses up front, from
 * the prompt, which tools the turn will need. When it guesses wrong the model
 * has no recourse: it cannot call what it was not told about, so it either does
 * without or invents a plan around the gap.
 *
 * The escalation path already widens 12 → 18 after the model has visibly
 * struggled, which is the same idea driven by a heuristic. This is the version
 * driven by the model, which knows what it is trying to do.
 *
 * Three rules.
 *
 * **Discovery grants nothing.** What comes back is a *description*; the skill
 * still has to be in the agent's eligible pool to be offered, and every
 * authorization gate — allowlist, turn envelope, tool policy, approvals — is
 * applied when it is eventually called, exactly as for a tool sent up front.
 * Search is a way to see further, never a way to reach further. That is why it
 * takes the eligible pool as its input rather than the whole registry: a tool
 * the agent may not use must not even be nameable, or the model will plan
 * around one it can never call.
 *
 * **Already-sent tools are excluded from results.** Returning them wastes the
 * turn and, worse, invites the model to "discover" a tool it is already holding
 * and call the search again — a loop that costs a round trip each time.
 *
 * **A miss says so plainly.** An empty result that reads like an error invites a
 * retry with a reworded query; one that says the pool was searched and holds
 * nothing matching ends it.
 */

/** Words too common in tool descriptions to discriminate between them. */
const DISCOVERY_STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'onto', 'when',
  'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 'is', 'it', 'as', 'be',
  'tool', 'tools', 'skill', 'skills', 'use', 'using', 'run', 'get', 'workspace',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [])
    .filter(token => !DISCOVERY_STOP_WORDS.has(token));
}

export interface ToolDiscoveryMatch {
  skill: SkillDefinition;
  /** Why it matched, for the line the model reads. */
  score: number;
}

/**
 * Rank the eligible pool against a query.
 *
 * Id matches outrank description matches: a model asking for "git commit" means
 * the tool called `git-commit`, and letting a description that merely mentions
 * committing outrank it is how the wrong tool gets suggested confidently.
 */
export function rankSkillsForQuery(
  query: string,
  pool: readonly SkillDefinition[],
): ToolDiscoveryMatch[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return [];
  }

  return pool
    .map(skill => {
      const idTokens = new Set(tokenize(skill.id));
      const nameTokens = new Set(tokenize(skill.name ?? ''));
      const descriptionTokens = new Set(tokenize(skill.description ?? ''));

      let score = 0;
      for (const term of terms) {
        if (idTokens.has(term)) {
          score += 3;
        } else if (nameTokens.has(term)) {
          score += 2;
        } else if (descriptionTokens.has(term)) {
          score += 1;
        }
      }
      return { skill, score };
    })
    .filter(match => match.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));
}

export interface ToolDiscoveryResult {
  /** Skills to add to the turn's tool set, in rank order. */
  granted: SkillDefinition[];
  /** What the model is told. */
  message: string;
}

/** Most schemas one search may add, so a broad query cannot undo the cap. */
export const MAX_DISCOVERED_TOOLS_PER_SEARCH = 5;

export function discoverTools(
  query: string,
  eligible: readonly SkillDefinition[],
  alreadySent: ReadonlySet<string>,
  limit: number = MAX_DISCOVERED_TOOLS_PER_SEARCH,
): ToolDiscoveryResult {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { granted: [], message: 'Give the search a word or two describing what you need to do.' };
  }

  const matches = rankSkillsForQuery(trimmed, eligible)
    .filter(match => !alreadySent.has(match.skill.id))
    .slice(0, Math.max(1, limit));

  if (matches.length === 0) {
    // Deliberately final. An empty result that reads like a failure invites a
    // reworded retry, and the pool has not changed between the two.
    return {
      granted: [],
      message: `No further tools match "${trimmed}". Everything this agent may use is either already available to you or unrelated to that. Continue with what you have, or tell the operator what is missing.`,
    };
  }

  const lines = matches.map(match => `- ${match.skill.id}: ${match.skill.description ?? match.skill.name ?? ''}`);
  return {
    granted: matches.map(match => match.skill),
    message: `${matches.length} tool${matches.length === 1 ? '' : 's'} added and callable now:\n${lines.join('\n')}`,
  };
}

/** The id of the search tool itself, so it can never discover itself. */
export const TOOL_DISCOVERY_SKILL_ID = 'find-tool';

/**
 * Whether this turn should be offered the search tool at all.
 *
 * Only when something was actually withheld. Offering it on a turn holding the
 * entire pool costs a schema to advertise a search guaranteed to return
 * nothing, and teaches the model to spend a round trip discovering that.
 */
export function shouldOfferToolDiscovery(
  eligibleCount: number,
  sentCount: number,
): boolean {
  // A turn given *no* tools was given none on purpose, and discovery must not be
  // the way back in. Change Story mode is the case that caught this: it clears
  // the skill set so a committed-ref answer cannot be contaminated by the
  // checked-out workspace, and offering a search there would have let the model
  // reacquire the very tools that mode exists to withhold — against a different
  // revision. Zero is a decision, not a small number.
  if (sentCount === 0) {
    return false;
  }
  return eligibleCount > sentCount;
}

/**
 * What can actually answer a research question, and what to say when nothing can.
 *
 * This module exists because of one failure mode. Asked about a market with no
 * way to look it up, a model will still answer — fluently, specifically, with
 * plausible numbers — and that answer, written into git-tracked
 * `project_memory/` and read six weeks later by somebody deciding what to build,
 * is indistinguishable from research. The only defence is to know, *before* the
 * scan runs, whether anything could have looked, and to refuse rather than
 * improvise.
 *
 * Three decisions.
 *
 * **Absent is not empty.** A scan with no source returns {@link ResearchSourceResolution}
 * with `selected: undefined` and a named setup step. It never returns a clean
 * result. This is `attentionFeed`'s fifth rule — silence earned by not looking —
 * applied at the one place where the silence would be most convincing.
 *
 * **Fetching a named URL is not discovery, and the difference is stated.**
 * `web-fetch` can confirm a claim about a page somebody already named; it cannot
 * answer "who else is building this". Treating the two as the same capability
 * would let a `web-fetch`-only project run a competition scan and receive the
 * model's recollection with one real citation stapled to it — which is worse than
 * no scan, because it looks sourced. So `canDiscover` is a separate field from
 * `available`, and a discovery-shaped scan with only `web-fetch` is `limited`.
 *
 * **MCP tools are matched on a declared verb list, never on description prose.**
 * A server's tool *names* are stable; its descriptions are marketing that changes
 * between versions. Matching on the name segment of `mcp:<server>:<tool>` against
 * a short published vocabulary is checkable; matching on "helps you research
 * anything" is not.
 *
 * Pure: detection only. Nothing here fetches, and nothing here holds a key.
 */

export type ResearchSourceId = 'exa' | 'mcp' | 'web-fetch';

/** What the user asked for. `auto` picks the best available. */
export type ResearchSourcePreference = ResearchSourceId | 'auto' | 'none';

export function isResearchSourcePreference(value: unknown): value is ResearchSourcePreference {
  return value === 'auto' || value === 'none' || value === 'exa' || value === 'mcp' || value === 'web-fetch';
}

export interface ResearchSourceCandidate {
  readonly id: ResearchSourceId;
  readonly label: string;
  readonly available: boolean;
  /**
   * Whether it can find sources nobody named. The distinction between answering
   * a question and confirming an answer.
   */
  readonly canDiscover: boolean;
  /** Why it is or is not available, in one sentence. */
  readonly detail: string;
  /** What the user would do to make it available. Absent when it already is. */
  readonly setupStep?: string;
}

export interface ResearchSourceInput {
  /** True when an EXA key is in SecretStorage. The key itself never reaches here. */
  readonly exaKeyPresent: boolean;
  /** Skill ids of connected MCP tools, in `mcp:<server>:<tool>` form. */
  readonly mcpToolIds: readonly string[];
  /** False when the built-in fetch skill has been disabled for this workspace. */
  readonly webFetchEnabled: boolean;
  readonly preference: ResearchSourcePreference;
}

export interface ResearchSourceResolution {
  /** The source a scan would use, or `undefined` when none can. */
  readonly selected?: ResearchSourceId;
  readonly candidates: readonly ResearchSourceCandidate[];
  /** True when the selected source can find sources nobody named. */
  readonly canDiscover: boolean;
  /**
   * Present whenever `selected` is absent. The sentence a surface should show
   * instead of a result.
   */
  readonly noSourceReason?: string;
  readonly setupStep?: string;
  /** The MCP tools that matched, so the user can see what was picked and why. */
  readonly matchedMcpTools: readonly string[];
}

/**
 * The verbs an MCP tool name may carry to count as a research source.
 *
 * Short on purpose. Every addition widens what AtlasMind will hand a research
 * question to, and a tool called `delete_index` matching `index` would be a
 * genuinely bad afternoon.
 */
const MCP_SEARCH_VERBS = ['search', 'web_search', 'websearch', 'browse', 'fetch', 'crawl', 'scrape'] as const;

/** Verbs that mean the tool can find things nobody named, rather than fetch one. */
const MCP_DISCOVERY_VERBS = ['search', 'web_search', 'websearch', 'crawl'] as const;

function toolNameOf(skillId: string): string {
  // `mcp:<serverId>:<toolName>` — the tool name is everything after the second
  // colon, since a server id may not contain one but a tool name might.
  const parts = skillId.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':').toLowerCase() : '';
}

function matchesVerb(toolName: string, verbs: readonly string[]): boolean {
  // Word-boundary-ish: a verb must be the whole name or separated by a
  // non-alphanumeric, so `research_search` matches and `searchlight` does not.
  return verbs.some(verb => new RegExp(`(^|[^a-z0-9])${verb}([^a-z0-9]|$)`).test(toolName));
}

export function findMcpResearchTools(mcpToolIds: readonly string[]): {
  all: string[];
  discovery: string[];
} {
  const all: string[] = [];
  const discovery: string[] = [];
  for (const skillId of mcpToolIds) {
    if (!skillId.startsWith('mcp:')) {
      continue;
    }
    const name = toolNameOf(skillId);
    if (name === '') {
      continue;
    }
    if (matchesVerb(name, MCP_SEARCH_VERBS)) {
      all.push(skillId);
      if (matchesVerb(name, MCP_DISCOVERY_VERBS)) {
        discovery.push(skillId);
      }
    }
  }
  return { all, discovery };
}

/**
 * Preference order when the user has not picked one.
 *
 * EXA first because it is a search API built for this; MCP second because a
 * connected server is a deliberate choice the user already made; `web-fetch` last
 * because it cannot discover, and being last means it is only selected when
 * nothing better exists.
 */
const AUTO_ORDER: readonly ResearchSourceId[] = ['exa', 'mcp', 'web-fetch'];

export function detectResearchSources(input: ResearchSourceInput): ResearchSourceResolution {
  const mcp = findMcpResearchTools(input.mcpToolIds);

  const candidates: ResearchSourceCandidate[] = [
    {
      id: 'exa',
      label: 'EXA web search',
      available: input.exaKeyPresent,
      canDiscover: true,
      detail: input.exaKeyPresent
        ? 'An EXA key is stored, so open questions can be searched.'
        : 'No EXA key is stored.',
      ...(input.exaKeyPresent ? {} : { setupStep: 'Add an EXA API key in the Specialist Integrations panel.' }),
    },
    {
      id: 'mcp',
      label: 'Connected MCP research tools',
      available: mcp.all.length > 0,
      canDiscover: mcp.discovery.length > 0,
      detail: mcp.all.length > 0
        ? `${mcp.all.length} connected tool${mcp.all.length === 1 ? '' : 's'} can search or fetch`
          + `${mcp.discovery.length === 0 ? ', but none can find sources nobody named.' : '.'}`
        : 'No connected MCP server exposes a search or fetch tool.',
      ...(mcp.all.length > 0 ? {} : { setupStep: 'Connect an MCP server that exposes a web search tool.' }),
    },
    {
      id: 'web-fetch',
      label: 'Built-in fetch',
      available: input.webFetchEnabled,
      // The whole point of this module: fetching is not finding.
      canDiscover: false,
      detail: input.webFetchEnabled
        ? 'Can read a page somebody has already named. It cannot find one.'
        : 'The built-in fetch skill is switched off.',
      ...(input.webFetchEnabled ? {} : { setupStep: 'Re-enable the Fetch URL skill.' }),
    },
  ];

  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));

  if (input.preference === 'none') {
    return {
      candidates,
      canDiscover: false,
      noSourceReason: 'Research sources are switched off, so a scan could only guess.',
      setupStep: 'Set atlasmind.research.searchSource to `auto` to use whatever is available.',
      matchedMcpTools: mcp.all,
    };
  }

  const order: readonly ResearchSourceId[] = input.preference === 'auto'
    ? AUTO_ORDER
    : [input.preference];

  for (const id of order) {
    const candidate = byId.get(id);
    if (candidate?.available) {
      return {
        selected: id,
        candidates,
        canDiscover: candidate.canDiscover,
        matchedMcpTools: mcp.all,
      };
    }
  }

  // Nothing available. Say which setup step would fix it, preferring the one the
  // user asked for over the one we would have picked.
  const wanted = input.preference === 'auto' ? byId.get('exa') : byId.get(input.preference);
  return {
    candidates,
    canDiscover: false,
    noSourceReason: input.preference === 'auto'
      ? 'No research source is configured, so a scan could only report what a model already believed.'
      : `The selected research source (\`${input.preference}\`) is not available.`,
    ...(wanted?.setupStep ? { setupStep: wanted.setupStep } : {}),
    matchedMcpTools: mcp.all,
  };
}

/**
 * Whether this scan can run against this resolution, and what it will miss.
 *
 * `external` needs discovery: the question is about things nobody has named yet.
 * `hybrid` can proceed without it — the repository half is always answerable —
 * but must say so, which is what `unassessed` carries. `internal` never reaches
 * here; those questions are subscribed to, not scanned.
 */
export interface ScanFeasibility {
  readonly canRun: boolean;
  /** What this run will not be able to assess. Stated, never omitted. */
  readonly unassessed?: string;
  readonly reason?: string;
}

export function assessScanFeasibility(
  evidenceClass: 'internal' | 'external' | 'hybrid',
  resolution: ResearchSourceResolution,
): ScanFeasibility {
  if (evidenceClass === 'internal') {
    return { canRun: true };
  }
  if (!resolution.selected) {
    return {
      canRun: evidenceClass === 'hybrid',
      unassessed: 'Everything outside this repository — no research source was available.',
      ...(resolution.noSourceReason ? { reason: resolution.noSourceReason } : {}),
    };
  }
  if (!resolution.canDiscover) {
    return {
      canRun: evidenceClass === 'hybrid',
      unassessed: 'Anything that would have to be found rather than read — the available source can '
        + 'fetch a named page but cannot search.',
      reason: 'The available source can fetch a named page but cannot discover new ones.',
    };
  }
  return { canRun: true };
}

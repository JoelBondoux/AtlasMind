/**
 * discover-resources – a read-only built-in skill that lets agents find agentic
 * resources (MCP servers, A2A agents, Skills, APIs) mid-task via Agentic
 * Resource Discovery, BEFORE invocation.
 *
 * It NEVER installs anything: it surfaces ranked candidates for the user to
 * review and approve in the Resource Discovery panel. The relevance score is
 * semantic only — explicitly not a trust or safety rating.
 *
 * Because built-in skills cannot read VS Code settings, the ARD client and
 * registry are injected via this factory (the same closure pattern used for
 * dynamically-registered MCP tool skills).
 */

import type { ArdClient } from '../ard/ardClient.js';
import type { ArdRegistry } from '../ard/ardRegistry.js';
import type { ArdDiscoveredResource, ArdSearchFilter, SkillDefinition } from '../types.js';

/** The standard disclaimer attached to every discovery result set. */
export const ARD_SCORE_DISCLAIMER =
  'Note: the relevance score reflects how well a result matches your query — it is NOT a trust, ' +
  'compliance, or safety rating. Review each resource before installing it.';

export function createDiscoverResourcesSkill(
  ardClient: ArdClient,
  ardRegistry: ArdRegistry,
): SkillDefinition {
  return {
    id: 'discover-resources',
    name: 'Discover Resources (ARD)',
    builtIn: true,
    panelPath: ['Search & Fetch'],
    description:
      'Search Agentic Resource Discovery (ARD) Agent Finders for external capabilities — MCP servers, ' +
      'agents, skills, and APIs — that could help with the current task. Read-only: it lists ranked ' +
      'candidates for the user to review and install; it never installs anything itself.',
    timeoutMs: 30_000,
    routingHints: [
      'discover resources', 'find a tool', 'find an mcp server', 'discover mcp server',
      'what agent can', 'find a skill', 'search for a tool', 'agent finder', 'find an integration',
    ],
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language description of the capability you need (e.g. "book a flight", "query Postgres").',
        },
        type: {
          type: 'string',
          description:
            'Optional resource-type filter, e.g. "application/mcp-server+json" or "application/a2a-agent-card+json".',
        },
        endpoint: {
          type: 'string',
          description: 'Optional Agent Finder name or id to search. Defaults to all enabled finders.',
        },
      },
    },
    async execute(params): Promise<string> {
      const query = typeof params['query'] === 'string' ? params['query'].trim() : '';
      if (!query) {
        return 'Error: "query" is required and must describe the capability you need.';
      }

      const endpointHint = typeof params['endpoint'] === 'string' ? params['endpoint'].trim().toLowerCase() : '';
      const all = ardRegistry.listEnabled();
      const endpoints = endpointHint
        ? all.filter(e => e.id.toLowerCase() === endpointHint || e.name.toLowerCase().includes(endpointHint))
        : all;

      if (endpoints.length === 0) {
        return all.length === 0 && !endpointHint
          ? 'No Agent Finders are enabled. Open the AtlasMind Resource Discovery panel and enable a finder ' +
              '(e.g. GitHub Agent Finder or Hugging Face Discover) before searching. Finders ship disabled by design.'
          : `No enabled Agent Finder matched "${endpointHint}". Enable one in the Resource Discovery panel.`;
      }

      const typeFilter = typeof params['type'] === 'string' && params['type'].trim()
        ? ({ type: [params['type'].trim()] } satisfies ArdSearchFilter)
        : undefined;

      let results: ArdDiscoveredResource[];
      let errors: Array<{ endpoint: string; message: string }>;
      try {
        const outcome = await ardClient.searchEndpoints(endpoints, query, {
          ...(typeFilter ? { filter: typeFilter } : {}),
        });
        results = outcome.results;
        errors = outcome.errors;
      } catch (error) {
        return `Discovery failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      // Update the tree-view cache so the user sees what the agent found.
      ardRegistry.setRecentResults(results);

      if (results.length === 0) {
        const errorNote = errors.length > 0
          ? `\n\nFinder errors:\n${errors.map(e => `- ${e.endpoint}: ${e.message}`).join('\n')}`
          : '';
        return `No resources found for "${query}" across ${endpoints.length} finder(s).${errorNote}`;
      }

      const lines = results.map((result, index) => {
        const score = typeof result.score === 'number' ? ` · relevance ${result.score}/100` : '';
        const where = `via ${result.sourceName}`;
        const ref = result.url ? ` · ${result.url}` : '';
        const desc = result.description ? `\n   ${truncate(result.description, 200)}` : '';
        return `${index + 1}. ${result.displayName} [${result.type}]${score} · ${where}${ref}\n   ${result.identifier}${desc}`;
      });

      const errorNote = errors.length > 0
        ? `\n\nSome finders errored:\n${errors.map(e => `- ${e.endpoint}: ${e.message}`).join('\n')}`
        : '';

      return (
        `Found ${results.length} resource(s) for "${query}":\n\n${lines.join('\n')}\n\n` +
        `${ARD_SCORE_DISCLAIMER} To install one, open the AtlasMind Resource Discovery panel ` +
        `(command: "AtlasMind: Resource Discovery").${errorNote}`
      );
    },
  };
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

import { describe, expect, it } from 'vitest';

import {
  assessScanFeasibility,
  detectResearchSources,
  findMcpResearchTools,
  isResearchSourcePreference,
  type ResearchSourceInput,
} from '../../src/core/researchSources.js';

function input(overrides: Partial<ResearchSourceInput> = {}): ResearchSourceInput {
  return {
    exaKeyPresent: false,
    mcpToolIds: [],
    webFetchEnabled: false,
    preference: 'auto',
    ...overrides,
  };
}

describe('no source is stated, never improvised around', () => {
  it('selects nothing and names the setup step', () => {
    const resolution = detectResearchSources(input());
    expect(resolution.selected).toBeUndefined();
    expect(resolution.canDiscover).toBe(false);
    expect(resolution.noSourceReason).toContain('only report what a model already believed');
    expect(resolution.setupStep).toContain('EXA API key');
  });

  it('refuses when the user switched sources off', () => {
    const resolution = detectResearchSources(input({ exaKeyPresent: true, preference: 'none' }));
    expect(resolution.selected).toBeUndefined();
    expect(resolution.noSourceReason).toContain('switched off');
  });

  it('reports the selected source as unavailable by name', () => {
    const resolution = detectResearchSources(input({ webFetchEnabled: true, preference: 'exa' }));
    expect(resolution.selected).toBeUndefined();
    expect(resolution.noSourceReason).toContain('`exa`');
  });
});

describe('fetching is not finding', () => {
  it('selects web-fetch but refuses to call it discovery', () => {
    const resolution = detectResearchSources(input({ webFetchEnabled: true }));
    expect(resolution.selected).toBe('web-fetch');
    expect(resolution.canDiscover).toBe(false);
  });

  it('prefers a source that can discover', () => {
    const resolution = detectResearchSources(input({ exaKeyPresent: true, webFetchEnabled: true }));
    expect(resolution.selected).toBe('exa');
    expect(resolution.canDiscover).toBe(true);
  });
});

describe('MCP tools are matched on names, not on prose', () => {
  it('matches a declared verb at a word boundary', () => {
    const matched = findMcpResearchTools([
      'mcp:brave:web_search',
      'mcp:firecrawl:crawl_site',
      'mcp:docs:fetch_page',
      'mcp:weird:searchlight',
      'mcp:db:delete_index',
      'file-read',
    ]);
    expect(matched.all).toEqual(['mcp:brave:web_search', 'mcp:firecrawl:crawl_site', 'mcp:docs:fetch_page']);
    // Only the two that can find something nobody named.
    expect(matched.discovery).toEqual(['mcp:brave:web_search', 'mcp:firecrawl:crawl_site']);
  });

  it('ignores anything that is not an MCP skill id', () => {
    expect(findMcpResearchTools(['web-fetch', 'exa-search', 'mcp:', 'mcp:only-two']).all).toEqual([]);
  });

  it('selects MCP when it can search, and reports what matched', () => {
    const resolution = detectResearchSources(input({ mcpToolIds: ['mcp:brave:web_search'] }));
    expect(resolution.selected).toBe('mcp');
    expect(resolution.canDiscover).toBe(true);
    expect(resolution.matchedMcpTools).toEqual(['mcp:brave:web_search']);
  });

  it('selects MCP that can only fetch, and says it cannot discover', () => {
    const resolution = detectResearchSources(input({ mcpToolIds: ['mcp:docs:fetch_page'] }));
    expect(resolution.selected).toBe('mcp');
    expect(resolution.canDiscover).toBe(false);
    expect(resolution.candidates.find(candidate => candidate.id === 'mcp')?.detail)
      .toContain('none can find sources nobody named');
  });
});

describe('feasibility distinguishes the two halves of a hybrid scan', () => {
  const noSource = detectResearchSources(input());
  const fetchOnly = detectResearchSources(input({ webFetchEnabled: true }));
  const full = detectResearchSources(input({ exaKeyPresent: true }));

  it('refuses an external scan with nothing to look with', () => {
    const feasibility = assessScanFeasibility('external', noSource);
    expect(feasibility.canRun).toBe(false);
    expect(feasibility.unassessed).toContain('Everything outside this repository');
  });

  it('lets a hybrid scan run its internal half, and states what it missed', () => {
    const feasibility = assessScanFeasibility('hybrid', noSource);
    expect(feasibility.canRun).toBe(true);
    expect(feasibility.unassessed).toBeDefined();
  });

  it('refuses an external scan when the source can only fetch a named page', () => {
    const feasibility = assessScanFeasibility('external', fetchOnly);
    expect(feasibility.canRun).toBe(false);
    expect(feasibility.unassessed).toContain('found rather than read');
  });

  it('runs cleanly with a discovering source, and says nothing was missed', () => {
    expect(assessScanFeasibility('external', full)).toEqual({ canRun: true });
  });

  it('never blocks an internal question, which does not go through here', () => {
    expect(assessScanFeasibility('internal', noSource)).toEqual({ canRun: true });
  });
});

describe('the preference is a boundary', () => {
  it('recognises only the declared values', () => {
    expect(isResearchSourcePreference('auto')).toBe(true);
    expect(isResearchSourcePreference('web-fetch')).toBe(true);
    expect(isResearchSourcePreference('google')).toBe(false);
    expect(isResearchSourcePreference(undefined)).toBe(false);
  });
});

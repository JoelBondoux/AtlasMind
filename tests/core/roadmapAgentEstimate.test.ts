import { describe, expect, it } from 'vitest';

import {
  AGENT_MINUTES_PER_SCOPE_DAY,
  MINUTES_PER_DAY,
  ROADMAP_AGENT_ASSIGNEE_PREFIX,
  estimateRoadmapEffort,
  formatRoadmapDuration,
  resolveRoadmapEstimate,
  resolveRoadmapGraph,
  roadmapEstimateScaleFor,
} from '../../src/core/roadmapGraph.ts';
import { roadmapCriticalPath } from '../../src/core/roadmapCriticalPath.ts';
import type { RoadmapNodeRecord } from '../../src/core/roadmapGraph.ts';

/**
 * A duration means a different thing when nobody has to pick the work up in the
 * morning.
 *
 * The estimate table grades **scope**, and scope does not change with who does
 * it. Elapsed time does, by enough that one scale cannot carry both: a person's
 * figure is effort spread across working days, an agent's is wall clock in
 * minutes. On one scale, a plan run entirely by agents reported every item at
 * the half-day floor — and the route arithmetic, which rounded to the nearest
 * half-day, rounded honest agent work to nothing at all.
 */

const NOW = new Date('2026-09-08T00:00:00.000Z');
const AGENT = 'contact-atlas';

function plan(items: Array<{ id: string; assignee?: string; days?: number; after?: string[] }>, agentIds: string[] = [AGENT]) {
  return resolveRoadmapGraph({
    items: items.map((item, index) => ({
      id: item.id,
      itemId: `roadmap-${index + 1}`,
      text: `${item.id} some ordinary feature work here`,
      completed: false,
      focus: 'feature' as const,
      gates: [],
      priorityScore: items.length - index,
      order: index,
    })),
    records: items.map(item => ({
      id: item.id,
      ...(item.assignee === undefined ? {} : { assigneeId: item.assignee }),
      ...(item.days === undefined ? {} : { estimateDays: item.days }),
    } as RoadmapNodeRecord)),
    declaredEdges: items.flatMap(item => (item.after ?? []).map(from => ({
      from, to: item.id, origin: 'declared' as const,
    }))),
    agentAssigneeIds: agentIds,
    deriveSuggestions: false,
    now: NOW,
  });
}

describe('which scale an item is graded on', () => {
  it('takes the roster as the source of truth', () => {
    // A contact marked as an agent is one, and changing that mark should
    // re-grade the plan — you have just said who does the work.
    expect(roadmapEstimateScaleFor('contact-a', new Set(['contact-a']))).toBe('agent');
    expect(roadmapEstimateScaleFor('contact-a', new Set())).toBe('human');
  });

  it('honours a self-describing id for something not in the roster', () => {
    expect(roadmapEstimateScaleFor(`${ROADMAP_AGENT_ASSIGNEE_PREFIX}code-writer`)).toBe('agent');
  });

  it('treats unassigned work as a person\'s', () => {
    expect(roadmapEstimateScaleFor(undefined)).toBe('human');
    expect(roadmapEstimateScaleFor('')).toBe('human');
  });

  it('falls back to a person when the assignee resolves to nobody', () => {
    // A real choice and not a neutral one: deleting an agent contact lengthens
    // every estimate that named it. The node already shows an unresolved
    // assignment as its own chip, so the cause is visible where the effect is.
    expect(roadmapEstimateScaleFor('contact-deleted', new Set())).toBe('human');
  });
});

describe('an agent is not a person working faster', () => {
  it('converts scope to wall clock rather than discounting days', () => {
    // Both scales grade the same scope and then diverge — the agent figure is
    // *not* the human one times a constant, because the human one has already
    // been rounded to a half-day and inheriting that rounding would drag agent
    // minutes onto a grid that means nothing to them. `feature` at 3d base,
    // ×0.75 for a short title, is 2.25 scope-days.
    const human = estimateRoadmapEffort('add an export button', 'feature', false, 'human');
    const agent = estimateRoadmapEffort('add an export button', 'feature', false, 'agent');

    expect(agent.days * MINUTES_PER_DAY).toBe(Math.round(2.25 * AGENT_MINUTES_PER_SCOPE_DAY));
    expect(agent.days).toBeLessThan(human.days);
  });

  it('does not apply the AI-assistance discount as well', () => {
    // It grades a person working with AI help. Applying it to an agent counts
    // the same fact twice, and the number is defensible from neither direction.
    const on = estimateRoadmapEffort('add an export button', 'feature', true, 'agent');
    const off = estimateRoadmapEffort('add an export button', 'feature', false, 'agent');

    expect(on.days).toBe(off.days);
    expect(on.rule).toMatch(/the agent is the assistance/);
  });

  it('offers no assistance alternative on the agent scale', () => {
    // A toggle that changes nothing is worse than no toggle.
    const estimate = resolveRoadmapEstimate('add an export button', 'feature', { assigneeId: AGENT } as RoadmapNodeRecord, new Set([AGENT]));
    expect(estimate.scale).toBe('agent');
    expect(estimate.alternativeDays).toBe(estimate.days);
  });

  it('keeps a floor, because even a trivial change costs a run', () => {
    const tiny = estimateRoadmapEffort('fix typo', 'documentation', false, 'agent');
    expect(tiny.days * MINUTES_PER_DAY).toBeGreaterThanOrEqual(5);
  });

  it('says the prior is a prior', () => {
    // Nothing here has watched anybody's agents work, and a rule that did not
    // say so would read as a measurement.
    expect(estimateRoadmapEffort('x y z', 'feature', false, 'agent').rule)
      .toMatch(/a declared prior, not a measurement/);
  });

  it('leaves the human scale exactly as it was', () => {
    // The whole change must be inert for a plan nobody has assigned to an agent.
    const before = estimateRoadmapEffort('add an export button to the reporting page', 'feature', true);
    expect(before.days).toBe(estimateRoadmapEffort('add an export button to the reporting page', 'feature', true, 'human').days);
    expect(before.days % 0.5).toBe(0);
  });
});

describe('the route arithmetic no longer rounds agent work away', () => {
  it('carries a chain of agent work instead of reporting nothing to do', () => {
    // The defect: route days accumulated to the nearest half-day, so three
    // twenty-minute items summed to zero and the plan claimed no work left.
    const graph = plan([
      { id: 'a', assignee: AGENT },
      { id: 'b', assignee: AGENT, after: ['a'] },
      { id: 'c', assignee: AGENT, after: ['b'] },
    ]);

    const last = graph.nodes.find(node => node.id === 'c');
    expect(last?.schedule.routeDays).toBeGreaterThan(0);
    expect(last?.schedule.routeDays).toBeLessThan(1);
    expect(last?.schedule.reason).not.toContain('0d');
  });

  it('gives the critical path a real length on an all-agent plan', () => {
    const path = roadmapCriticalPath(plan([
      { id: 'a', assignee: AGENT },
      { id: 'b', assignee: AGENT, after: ['a'] },
    ]));

    expect(path.state).toBe('ok');
    expect(path.days).toBeGreaterThan(0);
    expect(path.nodeIds).toEqual(['a', 'b']);
  });

  it('lets a person\'s work dominate a chain that mixes the two', () => {
    // The right answer, and the useful one: an afternoon of agent work waiting
    // on a three-day human task finishes when the human task does.
    const path = roadmapCriticalPath(plan([
      { id: 'human', days: 3 },
      { id: 'agent', assignee: AGENT, after: ['human'] },
    ]));

    expect(path.days).toBeGreaterThan(3);
    expect(path.days).toBeLessThan(3.1);
    expect(path.nodeIds).toEqual(['human', 'agent']);
  });

  it('keeps a declared agent estimate instead of rounding it to a half-day', () => {
    // 0.02 days is 28.8 minutes, kept as 29 — the minute grid, not the half-day
    // one, which would have made it zero.
    const graph = plan([{ id: 'a', assignee: AGENT, days: 0.02 }]);
    // Rounded on the way out the same way the arithmetic does, rather than
    // compared as a raw float: 29/1440 multiplied back is 29.000000000000004.
    expect(Math.round((graph.nodes[0]?.estimate.days ?? 0) * MINUTES_PER_DAY)).toBe(29);
    expect(graph.nodes[0]?.estimate.source).toBe('declared');
  });
});

describe('a duration is shown in a unit that does not round it away', () => {
  it('keeps days for a person\'s work', () => {
    expect(formatRoadmapDuration(3)).toBe('3d');
    expect(formatRoadmapDuration(1.5)).toBe('1.5d');
  });

  it('drops to hours and minutes below a day', () => {
    expect(formatRoadmapDuration(0.25)).toBe('6h');
    expect(formatRoadmapDuration(30 / MINUTES_PER_DAY)).toBe('30m');
  });

  it('never renders real work as no time at all', () => {
    // "0d of work left" is both wrong and the exact wording that makes somebody
    // stop trusting the column.
    expect(formatRoadmapDuration(0.0001)).toBe('1m');
  });

  it('shows nothing as nothing', () => {
    expect(formatRoadmapDuration(0)).toBe('1m');
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildProducerReportInput,
  deliveryReadiness,
  openRisks,
  parseRoadmapItemsForReport,
} from '../../src/core/producerReportGather.js';
import type { DeliveryConfig, RiskFinding, RiskOversightConfig } from '../../src/types.js';

const AT = new Date('2026-09-07T12:00:00.000Z');

const ROADMAP = [
  '# Developer Roadmap',
  'Prose above the block. - [ ] this is an example, not an item.',
  '<!-- atlasmind:roadmap-items:start -->',
  '- [ ] Ship the portal #mvp <!-- rm:ship-the-portal -->',
  '- [x] Attribute cost #mvp <!-- rm:attribute-cost -->',
  '- [ ] Something unrelated',
  '<!-- atlasmind:roadmap-items:end -->',
  '',
  '### Release gates',
  '<!-- atlasmind:roadmap-gates:start -->',
  '- `#mvp` — MVP',
  '<!-- atlasmind:roadmap-gates:end -->',
].join('\n');

describe('only the managed block is read', () => {
  it('ignores checkbox lines in the surrounding prose', () => {
    const items = parseRoadmapItemsForReport(ROADMAP);
    expect(items.map(item => item.text)).not.toContain('this is an example, not an item.');
    expect(items).toHaveLength(3);
  });

  it('reads completion, the durable anchor and the gate tags', () => {
    const items = parseRoadmapItemsForReport(ROADMAP);
    expect(items[0]?.nodeId).toBe('ship-the-portal');
    expect(items[0]?.completed).toBe(false);
    expect(items[1]?.completed).toBe(true);
    expect(items[1]?.nodeId).toBe('attribute-cost');
  });

  it('returns nothing when the block is absent rather than parsing the whole file', () => {
    expect(parseRoadmapItemsForReport('# Just prose\n- [ ] not in a block\n')).toEqual([]);
  });
});

function finding(overrides: Partial<RiskFinding> = {}): RiskFinding {
  return {
    id: 'r1',
    domain: 'legal',
    title: 'A risk',
    detail: 'detail',
    likelihood: 'medium',
    impact: 'medium',
    confidence: 'medium',
    status: 'open',
    evidence: [],
    raisedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as RiskFinding;
}

describe('risks', () => {
  it('is undefined when the register could not be read, not an empty list', () => {
    expect(openRisks(undefined)).toBeUndefined();
  });

  it('is an empty list when the register was read and holds no open findings', () => {
    const config = { version: 1, findings: [finding({ status: 'closed' })], runs: [] } as unknown as RiskOversightConfig;
    expect(openRisks(config)).toEqual([]);
  });

  /**
   * A register keeps closed findings deliberately, but a status page listing
   * forty of them buries the three that are live.
   */
  it('reports only open findings', () => {
    const config = {
      version: 1,
      findings: [finding({ id: 'a', title: 'Open one' }), finding({ id: 'b', title: 'Closed', status: 'dismissed' })],
      runs: [],
    } as unknown as RiskOversightConfig;
    expect(openRisks(config)?.map(risk => risk.title)).toEqual(['Open one']);
  });

  it('orders worst first', () => {
    const config = {
      version: 1,
      findings: [
        finding({ id: 'a', title: 'Low', impact: 'low', likelihood: 'low' }),
        finding({ id: 'b', title: 'High', impact: 'high', likelihood: 'high' }),
      ],
      runs: [],
    } as unknown as RiskOversightConfig;
    expect(openRisks(config)?.map(risk => risk.title)).toEqual(['High', 'Low']);
  });

  it('omits the decision when none was recorded, rather than inventing an empty one', () => {
    const config = { version: 1, findings: [finding()], runs: [] } as unknown as RiskOversightConfig;
    expect(openRisks(config)?.[0]?.decision).toBeUndefined();
  });
});

describe('delivery readiness', () => {
  it('is undefined when the pipeline could not be read', () => {
    expect(deliveryReadiness(undefined)).toBeUndefined();
  });

  it('orders by pipeline rank and names why a stage is not ready', () => {
    const config = {
      version: 1,
      stages: [
        { id: 'p', name: 'Production', rank: 2, branchRef: 'main' },
        { id: 'l', name: 'Local', rank: 0 },
      ],
      paths: [],
    } as unknown as DeliveryConfig;
    const stages = deliveryReadiness(config);
    expect(stages?.map(stage => stage.name)).toEqual(['Local', 'Production']);
    expect(stages?.[0]?.ready).toBe(false);
    expect(stages?.[0]?.blockedBy).toMatch(/No branch declared/);
    expect(stages?.[1]?.ready).toBe(true);
  });
});

describe('assembly preserves could-not-read as a gap', () => {
  it('leaves every section absent when nothing was gathered', () => {
    const input = buildProducerReportInput({ projectName: 'AtlasMind', generatedAt: AT });
    expect(input.gates).toBeUndefined();
    expect(input.risks).toBeUndefined();
    expect(input.delivery).toBeUndefined();
    expect(input.cost).toBeUndefined();
  });

  it('reports gate progress from the backlog', () => {
    const input = buildProducerReportInput({
      projectName: 'AtlasMind',
      generatedAt: AT,
      roadmapMarkdown: ROADMAP,
    });
    const mvp = input.gates?.find(gate => gate.gate.toLowerCase().includes('mvp'));
    expect(mvp?.total).toBe(2);
    expect(mvp?.delivered).toBe(1);
  });

  it('labels cost lines with the item text rather than its id', () => {
    const input = buildProducerReportInput({
      projectName: 'AtlasMind',
      generatedAt: AT,
      roadmapMarkdown: ROADMAP,
      costRecords: [{
        taskId: 't', agentId: 'a', model: 'm', inputTokens: 1, outputTokens: 1,
        costUsd: 2, timestamp: AT.toISOString(), roadmapItemId: 'ship-the-portal',
      }],
    });
    expect(input.cost?.lines[0]?.label).toBe('Ship the portal');
    expect(input.cost?.lines[0]?.inferred).toBe(true);
  });

  it('falls back to the id when the item is no longer on the backlog', () => {
    const input = buildProducerReportInput({
      projectName: 'AtlasMind',
      generatedAt: AT,
      roadmapMarkdown: ROADMAP,
      costRecords: [{
        taskId: 't', agentId: 'a', model: 'm', inputTokens: 1, outputTokens: 1,
        costUsd: 2, timestamp: AT.toISOString(), roadmapItemId: 'deleted-item',
      }],
    });
    expect(input.cost?.lines[0]?.label).toBe('deleted-item');
  });
});

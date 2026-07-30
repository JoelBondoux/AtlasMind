import { describe, expect, it } from 'vitest';
import {
  assessPipelinePromotions,
  assessPromotionReadiness,
  promotionBlockReason,
} from '../../src/core/promotionReadiness.ts';
import { buildProjectState } from '../../src/core/projectStateTree.ts';
import type { DeploymentStage, PromotionPath } from '../../src/types.ts';

function stage(over: Partial<DeploymentStage> = {}): DeploymentStage {
  return {
    id: 'stage-production',
    name: 'Production',
    kind: 'production',
    rank: 2,
    description: '',
    config: {} as DeploymentStage['config'],
    hosting: {} as DeploymentStage['hosting'],
    data: {} as DeploymentStage['data'],
    backupPolicy: { required: false },
    promotionPolicy: {
      requiresApproval: false,
      requireVersionBump: false,
      requireChangelog: false,
      requiredChecks: [],
    },
    rollbackPolicy: {} as DeploymentStage['rollbackPolicy'],
    isProtected: false,
    ...over,
  };
}

const from = stage({ id: 'stage-staging', name: 'Integration', rank: 1 });
const path: PromotionPath = { id: 'promote-staging-production', fromStageId: 'stage-staging', toStageId: 'stage-production' };

describe('promotionBlockReason — the same two rules as the dashboard', () => {
  it('blocks when a required backup has no command', () => {
    const to = stage({ backupPolicy: { required: true } });
    expect(promotionBlockReason(path, to)).toMatch(/requires a backup/);
  });

  it('does not block when the required backup has one', () => {
    const to = stage({ backupPolicy: { required: true, command: 'pg_dump …' } });
    expect(promotionBlockReason(path, to)).toBe('');
  });

  it('blocks a pull-request target with no routine bound to open one', () => {
    const to = stage({ promotionPolicy: { ...stage().promotionPolicy, viaPullRequest: true } });
    expect(promotionBlockReason(path, to)).toMatch(/pull request/);
    // Bound routine clears it.
    expect(promotionBlockReason({ ...path, routineId: 'publish' }, to)).toBe('');
  });

  it('treats a whitespace-only backup command as absent', () => {
    // An empty command is the blocker, not an oversight — the same distinction
    // the delivery manager draws.
    const to = stage({ backupPolicy: { required: true, command: '   ' } });
    expect(promotionBlockReason(path, to)).not.toBe('');
  });
});

describe('assessPromotionReadiness — what the sidebar may honestly claim', () => {
  /**
   * The property the whole feature rests on. The tree is built synchronously,
   * so nothing here has looked at the working tree, the version delta or CI. A
   * row that implied otherwise would be a shipping light that never read the
   * code.
   */
  it('never claims readiness without saying what it did not check', () => {
    for (const to of [
      stage(),
      stage({ isProtected: true }),
      stage({ promotionPolicy: { ...stage().promotionPolicy, requiresApproval: true } }),
    ]) {
      const readiness = assessPromotionReadiness(path, from, to);
      expect(readiness.tooltip, readiness.verdict).toContain('not here');
    }
  });

  it('avoids the words "safe" and "ready" in every verdict summary', () => {
    // The vocabulary is deliberate: this cannot establish either.
    for (const to of [stage(), stage({ backupPolicy: { required: true } })]) {
      const summary = assessPromotionReadiness(path, from, to).summary.toLowerCase();
      expect(summary).not.toContain('safe');
      expect(summary).not.toContain('ready');
    }
  });

  it('reports a blocker as the one verdict needing a person', () => {
    const to = stage({ backupPolicy: { required: true } });
    const readiness = assessPromotionReadiness(path, from, to);
    expect(readiness).toMatchObject({ verdict: 'blocked', icon: 'error', needsAttention: true });
    // A fact rather than a forecast, so it names the fix.
    expect(readiness.tooltip).toMatch(/no backup command is configured/);
  });

  it('reports declared gates without treating them as a problem', () => {
    // A gated path is not a fault; it is a path with gates, which is the point.
    const to = stage({
      promotionPolicy: {
        requiresApproval: true, requireVersionBump: true, requireChangelog: false,
        requiredChecks: ['smoke'], requiredStatusChecks: ['quality'],
      },
    });
    const readiness = assessPromotionReadiness(path, from, to);
    expect(readiness).toMatchObject({ verdict: 'gated', needsAttention: false });
    expect(readiness.summary).toBe('4 gates');
    expect(readiness.tooltip).toMatch(/explicit approval, a version bump, 1 manual check and 1 CI check/);
  });

  it('reports a target with no declared gates as clear', () => {
    const readiness = assessPromotionReadiness(path, from, stage());
    expect(readiness).toMatchObject({ verdict: 'clear', icon: 'rocket', needsAttention: false });
  });

  it('says a protected target is protected', () => {
    const readiness = assessPromotionReadiness(path, from, stage({ isProtected: true }));
    expect(readiness.isProtected).toBe(true);
    expect(readiness.tooltip).toMatch(/always confirms, and never force-pushes/);
  });
});

describe('assessPipelinePromotions', () => {
  it('drops a path whose stage no longer exists', () => {
    // A row offering to promote from nowhere is worse than no row.
    const assessed = assessPipelinePromotions(
      [path, { id: 'orphan', fromStageId: 'gone', toStageId: 'stage-production' }],
      [from, stage()],
    );
    expect(assessed.map(entry => entry.pathId)).toEqual(['promote-staging-production']);
  });

  it('is empty for a pipeline with no paths', () => {
    expect(assessPipelinePromotions([], [from, stage()])).toEqual([]);
  });
});

describe('the Project State section it produces', () => {
  const paths = assessPipelinePromotions([path], [from, stage({ backupPolicy: { required: true } })]);

  it('is omitted entirely when there is nothing to show', () => {
    // The tree's standing rule: never imply AtlasMind looked at something it
    // did not.
    expect(buildProjectState({}).find(section => section.id === 'promote')).toBeUndefined();
    expect(buildProjectState({ promote: { paths: [] } }).find(section => section.id === 'promote')).toBeUndefined();
  });

  it('opens itself only when something is blocked', () => {
    const blocked = buildProjectState({ promote: { paths } }).find(section => section.id === 'promote');
    expect(blocked?.expanded).toBe(true);

    const clear = assessPipelinePromotions([path], [from, stage()]);
    const quiet = buildProjectState({ promote: { paths: clear } }).find(section => section.id === 'promote');
    expect(quiet?.expanded).toBe(false);
  });

  /**
   * The safety property of the whole section: the row **opens the plan**, it
   * does not promote. Promotion runs behind a plan, per-gate attestations and a
   * type-to-confirm on a protected target; a one-click tree row would route
   * around all three.
   */
  it('never wires a row to a promotion command', () => {
    const section = buildProjectState({ promote: { paths } }).find(entry => entry.id === 'promote');
    expect(section?.nodes.length).toBeGreaterThan(0);
    for (const node of section?.nodes ?? []) {
      expect(node.command?.command).toBe('atlasmind.openProjectDashboard');
      expect(node.command?.args).toEqual(['delivery']);
      expect(JSON.stringify(node.command)).not.toMatch(/promot(e|ion)|runPromotion/i);
    }
  });

  it('labels each row with the journey it describes', () => {
    const section = buildProjectState({ promote: { paths } }).find(entry => entry.id === 'promote');
    expect(section?.nodes[0]?.label).toContain('Integration → Production');
  });
});

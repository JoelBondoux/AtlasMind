import { describe, expect, it } from 'vitest';
import {
  buildDeliverySyncPlan,
  compareWebsiteToDelivery,
  describeSyncPlan,
} from '../../src/core/websiteDeliverySync.js';
import type {
  DeliveryConfig,
  DeploymentStage,
  WebsiteHostingEnvironment,
  WebsitePlatformTarget,
} from '../../src/types.js';

function environment(
  id: WebsiteHostingEnvironment['id'],
  overrides: Partial<WebsiteHostingEnvironment> = {},
): WebsiteHostingEnvironment {
  const name = id === 'develop' ? 'Develop' : id === 'staging' ? 'Staging' : 'Production';
  return {
    id,
    name,
    purpose: '',
    hostingMode: id === 'develop' ? 'local' : 'hosted',
    accessPolicy: id === 'develop' ? 'local-only' : id === 'staging' ? 'password-protected' : 'public',
    notes: '',
    promotionProtected: id === 'production',
    ...overrides,
  };
}

function stage(
  id: string,
  kind: DeploymentStage['kind'],
  overrides: Partial<DeploymentStage> = {},
): DeploymentStage {
  return {
    id,
    name: id,
    kind,
    rank: kind === 'local' ? 0 : kind === 'staging' ? 1 : 2,
    description: '',
    config: {},
    hosting: {},
    data: {},
    backupPolicy: { required: false },
    promotionPolicy: { requiresApproval: false, requireVersionBump: false, requireChangelog: false, requiredChecks: [] },
    rollbackPolicy: {},
    isProtected: kind === 'production',
    ...overrides,
  } as DeploymentStage;
}

function delivery(stages: DeploymentStage[]): DeliveryConfig {
  return { version: 1, stages, paths: [] };
}

const PLATFORMS: WebsitePlatformTarget[] = [
  { id: 'cloudflare-pages', label: 'Cloudflare Pages', status: 'planned', primary: true, notes: '' },
];

describe('websiteDeliverySync', () => {
  describe('comparison', () => {
    it('reports matched when both sides agree', () => {
      const report = compareWebsiteToDelivery(
        [environment('production', { url: 'https://example.com/' })],
        delivery([stage('prod', 'production', { hosting: { url: 'https://example.com/', provider: 'Cloudflare Pages' } })]),
        PLATFORMS,
      );
      expect(report.inStep).toBe(true);
      expect(report.stages[0]?.status).toBe('matched');
    });

    it('names the differing field with both values', () => {
      const report = compareWebsiteToDelivery(
        [environment('production', { url: 'https://new.example.com/' })],
        delivery([stage('prod', 'production', { hosting: { url: 'https://old.example.com/', provider: 'Cloudflare Pages' } })]),
        PLATFORMS,
      );
      const difference = report.stages[0]?.differences.find(item => item.field === 'url');
      expect(difference?.websiteValue).toBe('https://new.example.com/');
      expect(difference?.deliveryValue).toBe('https://old.example.com/');
    });

    it('treats an empty Studio field as no opinion, not a difference', () => {
      // Otherwise every stage the Studio does not track carries a permanent
      // finding, and a report with a permanent finding is one people skim.
      const report = compareWebsiteToDelivery(
        [environment('production')],
        delivery([stage('prod', 'production', { hosting: { url: 'https://example.com/', provider: 'Cloudflare Pages' } })]),
        PLATFORMS,
      );
      expect(report.stages[0]?.differences.filter(item => item.field === 'url')).toHaveLength(0);
    });

    it('reports an environment with no Delivery stage rather than inventing one', () => {
      const report = compareWebsiteToDelivery([environment('staging')], delivery([]), PLATFORMS);
      expect(report.stages[0]?.status).toBe('website-only');
      expect(report.inStep).toBe(false);
    });

    it('reports a Delivery stage the Studio does not model, and says nothing will change it', () => {
      const report = compareWebsiteToDelivery([], delivery([stage('qa', 'staging')]), PLATFORMS);
      expect(report.stages[0]?.status).toBe('delivery-only');
      expect(report.stages[0]?.summary).toContain('Nothing will change it');
    });

    it('flags the Studio wanting protection Delivery does not have', () => {
      const report = compareWebsiteToDelivery(
        [environment('production', { promotionProtected: true })],
        delivery([stage('prod', 'production', { isProtected: false })]),
        PLATFORMS,
      );
      expect(report.stages[0]?.differences.some(item => item.field === 'promotion protection')).toBe(true);
    });

    it('does not flag Delivery being stricter than the Studio', () => {
      // Delivery protecting a stage the Studio does not is never a problem.
      const report = compareWebsiteToDelivery(
        [environment('staging', { promotionProtected: false })],
        delivery([stage('staging', 'staging', { isProtected: true })]),
        PLATFORMS,
      );
      expect(report.stages[0]?.differences.some(item => item.field === 'promotion protection')).toBe(false);
    });

    it('matches on stage kind rather than name', () => {
      const report = compareWebsiteToDelivery(
        [environment('production', { url: 'https://example.com/' })],
        delivery([stage('Live', 'production', { name: 'Live', hosting: { url: 'https://example.com/', provider: 'Cloudflare Pages' } })]),
        PLATFORMS,
      );
      expect(report.stages[0]?.status).toBe('matched');
    });

    it('says plainly when there is nothing to compare against', () => {
      const report = compareWebsiteToDelivery([environment('develop')], undefined, PLATFORMS);
      expect(report.stages[0]?.status).toBe('website-only');
    });

    it('mutates neither input', () => {
      const environments = [environment('production', { url: 'https://new.example.com/' })];
      const config = delivery([stage('prod', 'production', { hosting: { url: 'https://old.example.com/' } })]);
      const snapshot = JSON.stringify({ environments, config });
      compareWebsiteToDelivery(environments, config, PLATFORMS);
      expect(JSON.stringify({ environments, config })).toBe(snapshot);
    });
  });

  describe('sync plan', () => {
    it('carries a Studio URL onto the Delivery stage', () => {
      const config = delivery([stage('prod', 'production')]);
      const plan = buildDeliverySyncPlan(
        [environment('production', { url: 'https://example.com/' })],
        config,
        PLATFORMS,
      );
      expect(plan.next.stages[0]?.hosting.url).toBe('https://example.com/');
      expect(plan.changes.some(change => change.field === 'url')).toBe(true);
    });

    it('never clears a populated Delivery field from an empty Studio one', () => {
      // The Studio is where somebody sketches; Delivery holds a real
      // healthCheckUrl and a real URL. A blank box must not erase them.
      const config = delivery([stage('prod', 'production', {
        hosting: { url: 'https://example.com/', healthCheckUrl: 'https://example.com/health', provider: 'Cloudflare Pages' },
        branchRef: 'main',
      })]);
      const plan = buildDeliverySyncPlan([environment('production')], config, PLATFORMS);

      expect(plan.next.stages[0]?.hosting.url).toBe('https://example.com/');
      expect(plan.next.stages[0]?.hosting.healthCheckUrl).toBe('https://example.com/health');
      expect(plan.next.stages[0]?.branchRef).toBe('main');
      expect(plan.changes).toHaveLength(0);
    });

    it('tightens protection but never removes it', () => {
      const config = delivery([stage('prod', 'production', { isProtected: true })]);
      const plan = buildDeliverySyncPlan(
        [environment('production', { promotionProtected: false })],
        config,
        PLATFORMS,
      );
      expect(plan.next.stages[0]?.isProtected).toBe(true);
      expect(plan.changes.some(change => change.field === 'promotion protection')).toBe(false);
    });

    it('does not create a stage for an unmapped environment, and says why', () => {
      // Creating one would mean inventing a backup and rollback policy from a
      // page that models neither.
      const plan = buildDeliverySyncPlan([environment('staging')], delivery([]), PLATFORMS);
      expect(plan.next.stages).toHaveLength(0);
      expect(plan.unmapped).toEqual(['Staging']);
      expect(describeSyncPlan(plan)).toContain('will not be created');
    });

    it('does not mutate the delivery config it was given', () => {
      const config = delivery([stage('prod', 'production')]);
      const before = JSON.stringify(config);
      buildDeliverySyncPlan([environment('production', { url: 'https://example.com/' })], config, PLATFORMS);
      expect(JSON.stringify(config)).toBe(before);
    });

    it('reports nothing to do when the two already agree', () => {
      const config = delivery([stage('prod', 'production', {
        hosting: { url: 'https://example.com/', provider: 'Cloudflare Pages' },
      })]);
      const plan = buildDeliverySyncPlan(
        [environment('production', { url: 'https://example.com/' })],
        config,
        PLATFORMS,
      );
      expect(plan.changes).toHaveLength(0);
      expect(describeSyncPlan(plan)).toContain('Nothing to sync');
    });
  });
});

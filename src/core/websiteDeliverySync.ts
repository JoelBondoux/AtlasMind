/**
 * Two pipelines, one truth — checked rather than assumed.
 *
 * AtlasMind models dev → staging → production twice. `DeploymentStage`
 * (`deliveryManager.ts`) is the rich, executable one: rank, branch, hosting
 * provider, health check, backup and rollback policy, protection, and
 * `promotionRunner` behind it. `WebsiteHostingEnvironment` is Website Studio's
 * thin planning shadow of the same three stages.
 *
 * Folding one into the other was considered and deliberately not done — Website
 * Studio keeps its own environments because the website workflow has policy
 * Delivery has no concept of (a loopback develop, a password-protected staging
 * subdomain). The cost of that decision is drift: two models edited in two
 * places will disagree, and the first symptom would otherwise be the Studio and
 * the Delivery page quietly reporting different production URLs.
 *
 * **So this module's job is to make drift visible, not to prevent it.** It is
 * shaped after `findTaxonomyDrift` (`labelRegistry.ts:308`): a comparison, not a
 * verdict. Comparing writes nothing and decides nothing. Syncing is a separate,
 * confirmed, one-directional act.
 *
 * Two rules that matter more than the mapping:
 *
 * **An empty planning field never clears a real one.** The Studio is where
 * somebody sketches; Delivery is where a real `healthCheckUrl` lives. Syncing a
 * blank box over a working value would destroy operational configuration from a
 * page that never claimed to own it. Absent means "no opinion", never "unset it".
 *
 * **Protection only ever tightens.** Sync can mark a stage protected; it can
 * never unprotect one. A planning surface must not be able to remove a guard
 * that `promotionRunner` relies on.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type {
  DeliveryConfig,
  DeploymentStage,
  WebsiteHostingEnvironment,
  WebsiteHostingEnvironmentId,
  WebsitePlatformTarget,
} from '../types.js';

/** How a Website Studio environment relates to the Delivery stage it maps onto. */
export type StageDriftStatus =
  /** Both exist and every compared field agrees. */
  | 'matched'
  /** The Studio has this environment; Delivery has no stage for it. */
  | 'website-only'
  /** Delivery has a stage the Studio does not model. Reported, never removed. */
  | 'delivery-only'
  /** Both exist and at least one compared field differs. */
  | 'differs';

export interface FieldDifference {
  field: string;
  /** What Website Studio holds. `undefined` means it has no opinion. */
  websiteValue?: string;
  /** What Delivery holds. */
  deliveryValue?: string;
}

export interface StageDrift {
  /** The Studio environment id, or the Delivery stage id for `delivery-only`. */
  id: string;
  label: string;
  status: StageDriftStatus;
  differences: FieldDifference[];
  /** A sentence naming what is out of step, for a surface that shows one line. */
  summary: string;
}

export interface DeliveryDriftReport {
  stages: StageDrift[];
  /** True when nothing needs syncing. */
  inStep: boolean;
  /** One sentence for a badge. Never optimistic when a stage is unmatched. */
  summary: string;
}

/** Delivery stage kinds the three website environments map onto. */
const STAGE_KIND_FOR_ENVIRONMENT: Readonly<Record<WebsiteHostingEnvironmentId, DeploymentStage['kind']>> = {
  develop: 'local',
  staging: 'staging',
  production: 'production',
};

// ── Comparison ───────────────────────────────────────────────────

/**
 * Compare the two models. Reads both, mutates neither, decides nothing.
 *
 * `platforms` is read only to name the hosting provider — the Studio records the
 * platform choice separately from the environment, and Delivery keeps them on
 * the same object.
 */
export function compareWebsiteToDelivery(
  environments: readonly WebsiteHostingEnvironment[],
  delivery: DeliveryConfig | undefined,
  platforms: readonly WebsitePlatformTarget[] = [],
): DeliveryDriftReport {
  const stages = delivery?.stages ?? [];
  const provider = platforms.find(platform => platform.primary)?.label;
  const drifts: StageDrift[] = [];
  const claimed = new Set<string>();

  for (const environment of environments) {
    const stage = findStageFor(environment, stages);
    if (!stage) {
      drifts.push({
        id: environment.id,
        label: environment.name,
        status: 'website-only',
        differences: [],
        summary: `${environment.name} is planned in Website Studio but has no stage on the Delivery page.`,
      });
      continue;
    }
    claimed.add(stage.id);

    const differences = diffStage(environment, stage, provider);
    drifts.push({
      id: environment.id,
      label: environment.name,
      status: differences.length === 0 ? 'matched' : 'differs',
      differences,
      summary: differences.length === 0
        ? `${environment.name} matches its Delivery stage.`
        : `${environment.name} differs from Delivery on ${differences.map(item => item.field).join(', ')}.`,
    });
  }

  // Delivery stages the Studio does not model are reported rather than treated
  // as deletable. A website project can legitimately have a stage the Studio's
  // fixed three do not cover.
  for (const stage of stages) {
    if (claimed.has(stage.id)) {
      continue;
    }
    drifts.push({
      id: stage.id,
      label: stage.name,
      status: 'delivery-only',
      differences: [],
      summary: `Delivery has a "${stage.name}" stage that Website Studio does not model. Nothing will change it.`,
    });
  }

  const unmatched = drifts.filter(drift => drift.status !== 'matched');
  return {
    stages: drifts,
    inStep: unmatched.length === 0,
    summary: unmatched.length === 0
      ? 'Website Studio and the Delivery pipeline agree.'
      : `${unmatched.length} stage${unmatched.length === 1 ? '' : 's'} out of step with the Delivery pipeline.`,
  };
}

/**
 * Find the Delivery stage an environment corresponds to.
 *
 * Kind first, then name. Kind is the structural fact — a `production` stage is
 * the production stage whatever it is called — and matching on name alone would
 * pair "Production" with a stage somebody renamed "Live".
 */
function findStageFor(
  environment: WebsiteHostingEnvironment,
  stages: readonly DeploymentStage[],
): DeploymentStage | undefined {
  const wantedKind = STAGE_KIND_FOR_ENVIRONMENT[environment.id];
  const byKind = stages.filter(stage => stage.kind === wantedKind);
  if (byKind.length === 1) {
    return byKind[0];
  }
  // Several stages share the kind (two staging environments, say), so the name
  // decides between them rather than picking the first arbitrarily.
  const byName = byKind.find(stage => stage.name.toLowerCase() === environment.name.toLowerCase());
  return byName ?? byKind[0];
}

function diffStage(
  environment: WebsiteHostingEnvironment,
  stage: DeploymentStage,
  provider: string | undefined,
): FieldDifference[] {
  const differences: FieldDifference[] = [];

  const compare = (field: string, websiteValue: string | undefined, deliveryValue: string | undefined): void => {
    const left = websiteValue?.trim() ?? '';
    const right = deliveryValue?.trim() ?? '';
    // An empty Studio value is "no opinion", not a difference. Reporting it
    // would put a permanent finding on every stage the Studio does not track.
    if (left.length === 0) {
      return;
    }
    if (left !== right) {
      differences.push({
        field,
        websiteValue: left,
        ...(right.length > 0 ? { deliveryValue: right } : {}),
      });
    }
  };

  compare('url', environment.url, stage.hosting.url);
  compare('branch', environment.branchReference, stage.branchRef);
  compare('hosting provider', provider, stage.hosting.provider);

  // Protection is compared in one direction only: the Studio saying "protected"
  // when Delivery says otherwise is drift worth fixing, but the reverse is
  // Delivery being stricter, which is never a problem.
  if (environment.promotionProtected && !stage.isProtected) {
    differences.push({
      field: 'promotion protection',
      websiteValue: 'protected',
      deliveryValue: 'not protected',
    });
  }

  return differences;
}

// ── Sync ─────────────────────────────────────────────────────────

export interface StageSyncChange {
  stageId: string;
  stageName: string;
  field: string;
  from?: string;
  to: string;
}

export interface DeliverySyncPlan {
  /** The config as it would be after syncing. The caller persists it. */
  next: DeliveryConfig;
  changes: StageSyncChange[];
  /** Studio environments with no Delivery stage, which sync will not create. */
  unmapped: string[];
}

/**
 * Build the config that syncing would produce.
 *
 * Returns a new object; the input is never mutated, so a caller can show the
 * diff and then discard it. Nothing is written here.
 *
 * **Sync updates existing stages and never creates one.** Creating a stage would
 * mean inventing a backup policy, a rollback policy and a promotion path from a
 * planning page that models none of them — and `promotionRunner` would then act
 * on defaults nobody chose. An unmapped environment is reported instead.
 */
export function buildDeliverySyncPlan(
  environments: readonly WebsiteHostingEnvironment[],
  delivery: DeliveryConfig,
  platforms: readonly WebsitePlatformTarget[] = [],
): DeliverySyncPlan {
  const provider = platforms.find(platform => platform.primary)?.label;
  const changes: StageSyncChange[] = [];
  const unmapped: string[] = [];

  const nextStages = delivery.stages.map(stage => ({ ...stage }));

  for (const environment of environments) {
    const stage = findStageFor(environment, nextStages);
    if (!stage) {
      unmapped.push(environment.name);
      continue;
    }

    const url = environment.url?.trim();
    if (url && url !== stage.hosting.url) {
      changes.push({ stageId: stage.id, stageName: stage.name, field: 'url', from: stage.hosting.url, to: url });
      stage.hosting = { ...stage.hosting, url };
    }

    const branch = environment.branchReference?.trim();
    if (branch && branch !== stage.branchRef) {
      changes.push({ stageId: stage.id, stageName: stage.name, field: 'branch', from: stage.branchRef, to: branch });
      stage.branchRef = branch;
    }

    if (provider && provider !== stage.hosting.provider) {
      changes.push({ stageId: stage.id, stageName: stage.name, field: 'hosting provider', from: stage.hosting.provider, to: provider });
      stage.hosting = { ...stage.hosting, provider };
    }

    // Tightening only. A planning surface must not be able to remove a guard
    // that promotionRunner relies on.
    if (environment.promotionProtected && !stage.isProtected) {
      changes.push({ stageId: stage.id, stageName: stage.name, field: 'promotion protection', from: 'not protected', to: 'protected' });
      stage.isProtected = true;
    }
  }

  return {
    next: { ...delivery, stages: nextStages, updatedAt: delivery.updatedAt },
    changes,
    unmapped,
  };
}

/** A sentence for the confirmation dialog. Names the unmapped environments rather than counting them. */
export function describeSyncPlan(plan: DeliverySyncPlan): string {
  if (plan.changes.length === 0 && plan.unmapped.length === 0) {
    return 'Nothing to sync — the Delivery pipeline already matches Website Studio.';
  }
  const parts: string[] = [];
  if (plan.changes.length > 0) {
    parts.push(`${plan.changes.length} field${plan.changes.length === 1 ? '' : 's'} will be updated on the Delivery pipeline.`);
  }
  if (plan.unmapped.length > 0) {
    parts.push(
      `${plan.unmapped.join(' and ')} ${plan.unmapped.length === 1 ? 'has' : 'have'} no Delivery stage and will not be created — `
      + 'add the stage on the Delivery page first, so its backup and rollback policy is a decision somebody made.',
    );
  }
  return parts.join(' ');
}

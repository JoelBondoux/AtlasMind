/**
 * The setup guides AtlasMind offers, in one place.
 *
 * `/setup` reads this to show every guide with how far along it is, so a feature
 * that needs configuring is discoverable *before* someone hits the failure it
 * causes. Each guide computes its own progress from the same plan its own
 * walkthrough uses — the index cannot claim a guide is finished while the guide
 * itself disagrees, because there is only one source for both.
 *
 * Registration is deliberately explicit rather than by scan. A setup guide is a
 * promise that AtlasMind can tell you what is wrong with a feature's
 * configuration; that promise should be made on purpose.
 *
 * Pure and `vscode`-free: the caller gathers each guide's state and this module
 * assembles the index.
 */

import {
  nextSetupStep,
  summarizeSetupProgress,
  type SetupGuideSummary,
  type SetupProgress,
  type SetupStep,
} from './setupWalkthrough.js';
import { ACP_SETUP_GUIDE } from './acpSetupPlan.js';

/** The Buzz guide, described in the shared shape. */
export const BUZZ_SETUP_GUIDE: SetupGuideSummary = {
  id: 'buzz',
  label: 'Buzz',
  blurb: 'Read your team\'s Buzz channels and turn what arrives into AtlasMind work.',
  command: '/buzz',
  stepIds: ['enabled', 'relay', 'agentKey', 'inbound', 'firstAgent', 'roster'],
};

/**
 * Every guide, in the order a new project would sensibly work through them.
 *
 * ACP first: it is the one that changes what AtlasMind can *do* for you rather
 * than what it can reach, and it is the cheapest to finish.
 */
export const SETUP_GUIDES: readonly SetupGuideSummary[] = [ACP_SETUP_GUIDE, BUZZ_SETUP_GUIDE];

export function findSetupGuide(id: string): SetupGuideSummary | undefined {
  const wanted = (id ?? '').trim().toLowerCase();
  return SETUP_GUIDES.find(guide => guide.id === wanted);
}

export interface SetupIndexEntry {
  guide: SetupGuideSummary;
  progress: SetupProgress;
  nextTitle?: string;
}

/**
 * Build the `/setup` index from each guide's already-computed steps.
 *
 * A guide whose state could not be gathered is included with zero progress
 * rather than omitted: a missing row reads as "this feature does not exist",
 * which is a worse answer than "nothing set up yet".
 */
export function buildSetupIndex(plans: Array<{ guideId: string; steps: SetupStep[] }>): SetupIndexEntry[] {
  const byId = new Map(plans.map(plan => [plan.guideId, plan.steps]));
  return SETUP_GUIDES.map(guide => {
    const steps = byId.get(guide.id) ?? [];
    const next = nextSetupStep(steps, guide.stepIds);
    return {
      guide,
      progress: summarizeSetupProgress(steps, guide.stepIds),
      ...(next ? { nextTitle: next.title } : {}),
    };
  });
}

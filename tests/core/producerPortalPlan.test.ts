import { describe, expect, it } from 'vitest';

import {
  PRODUCER_PORTAL_SETUP_GUIDE,
  PRODUCER_PORTAL_STEP_IDS,
  PRODUCER_PORTAL_WORKFLOW_PATH,
  buildProducerPortalSteps,
  isProducerPortalReady,
  producerPortalWorkflow,
  type ProducerPortalState,
} from '../../src/core/producerPortalPlan.ts';
import { SETUP_GUIDES } from '../../src/core/setupGuideRegistry.ts';
import { isOpeningAction } from '../../src/core/setupWalkthrough.ts';

/**
 * The last mile of the producer report: how it becomes a page.
 *
 * The guide's whole job is to be careful about one fact — a Pages site is
 * public even when the repository is private — so most of what is pinned here
 * is what the plan refuses to do on somebody's behalf.
 */

const READY: ProducerPortalState = {
  publishEnabled: true,
  reportGenerated: true,
  sitePrepared: true,
  sitePath: 'project_memory/operations/producer-site',
  workflowPresent: true,
  visibility: 'private',
  pagesEnabled: true,
};

const stepOf = (state: Partial<ProducerPortalState>, id: string) =>
  buildProducerPortalSteps({ ...READY, ...state }).find(step => step.id === id);

describe('what it refuses to do for you', () => {
  it('offers no action that is not simply opening a surface', () => {
    // The allowlist in `setupWalkthrough` is what stops a setup guide becoming
    // an installer. Every action here has to pass it.
    for (const step of buildProducerPortalSteps(READY)) {
      if (step.action) {
        expect(isOpeningAction(step.action.command), `${step.id} offers ${step.action.command}`).toBe(true);
      }
    }
  });

  it('never claims Pages is enabled — that step has no action at all', () => {
    // Turning Pages on is the decision that makes the report public. It belongs
    // to the user, on GitHub, with the warning in front of them.
    const step = stepOf({ pagesEnabled: false }, 'enable-pages');
    expect(step?.status).toBe('todo');
    expect(step?.action).toBeUndefined();
    expect(step?.docs?.url).toContain('docs.github.com');
  });

  it('leads with what hosting means, and never marks it done', () => {
    // A guide cannot check that somebody understood something. Optional so it
    // never blocks; first so it is never missed.
    const steps = buildProducerPortalSteps(READY);
    expect(steps[0]?.id).toBe('understand-public');
    expect(steps[0]?.status).toBe('optional');
  });
});

describe('visibility', () => {
  it('says a private repository still gets a public page', () => {
    expect(stepOf({ visibility: 'private' }, 'understand-public')?.detail)
      .toContain('would still be public');
  });

  it('assumes public when visibility could not be read', () => {
    // The assumption that keeps a secret.
    expect(stepOf({ visibility: 'unknown' }, 'understand-public')?.detail)
      .toContain('Assume the page will be public');
  });
});

describe('unknown is blocked, never done', () => {
  it('reports a file check that could not run rather than calling it missing', () => {
    const steps = buildProducerPortalSteps({
      publishEnabled: true,
      sitePath: 'site',
      visibility: 'unknown',
    });
    const unknowns = steps.filter(step => step.status === 'blocked').map(step => step.id);
    expect(unknowns).toEqual(['generate-report', 'prepare-site', 'add-workflow', 'enable-pages']);
    expect(steps.find(step => step.id === 'enable-pages')?.detail).toContain('could not be read');
  });

  it('is not ready when anything is unknown', () => {
    expect(isProducerPortalReady({ ...READY, pagesEnabled: undefined })).toBe(false);
  });
});

describe('readiness', () => {
  it('is ready once everything but the proof is done', () => {
    // Same rule as the ACP guide: a portal can be correctly configured and
    // never run, and calling that a fault would be wrong while calling it
    // finished would be worse.
    expect(isProducerPortalReady(READY)).toBe(true);
    expect(stepOf({}, 'prove-published')?.status).toBe('todo');
  });

  it('reports the published URL once GitHub knows one', () => {
    expect(stepOf({ pagesUrl: 'https://example.github.io/p/' }, 'prove-published')?.status).toBe('done');
  });

  it('is not ready while publication is switched off', () => {
    expect(isProducerPortalReady({ ...READY, publishEnabled: false })).toBe(false);
  });
});

describe('the deploy workflow', () => {
  const workflow = producerPortalWorkflow('project_memory/operations/producer-site');

  it('runs on manual dispatch only', () => {
    // A push trigger would turn one decision into a standing one: every commit
    // republishing whatever the report happened to say.
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('on:\n  push');
    expect(workflow).not.toContain('schedule:');
  });

  it('uploads the prepared folder rather than the repository', () => {
    expect(workflow).toContain('path: project_memory/operations/producer-site');
    expect(workflow).not.toMatch(/path:\s*\.\s*$/m);
  });

  it('asks for the minimum permissions a Pages deploy needs', () => {
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('pages: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).not.toContain('contents: write');
  });

  it('says in the file itself that the page will be public', () => {
    // The person most likely to read this file is the one about to run it.
    expect(workflow).toContain('PUBLIC even when the repository is private');
  });

  it('never cancels a run in progress', () => {
    expect(workflow).toContain('cancel-in-progress: false');
  });
});

describe('the guide', () => {
  it('is listed in the registry, so /setup can find it', () => {
    expect(SETUP_GUIDES.map(guide => guide.id)).toContain('portal');
    expect(PRODUCER_PORTAL_SETUP_GUIDE.command).toBe('/portal');
  });

  it('walks every step it declares', () => {
    const ids = buildProducerPortalSteps(READY).map(step => step.id);
    expect([...PRODUCER_PORTAL_STEP_IDS]).toEqual(ids);
    expect(PRODUCER_PORTAL_SETUP_GUIDE.stepIds).toEqual(ids);
  });

  it('names the workflow path it writes', () => {
    expect(PRODUCER_PORTAL_WORKFLOW_PATH).toBe('.github/workflows/producer-portal.yml');
    expect(stepOf({ workflowPresent: false }, 'add-workflow')?.guidance?.map(line => line.text).join(' '))
      .toContain(PRODUCER_PORTAL_WORKFLOW_PATH);
  });
});

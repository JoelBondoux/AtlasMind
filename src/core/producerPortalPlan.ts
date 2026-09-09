import type { SetupGuideSummary, SetupStep } from './setupWalkthrough.js';
import { isSetupComplete } from './setupWalkthrough.js';

/**
 * How the producer report actually becomes a page somebody outside VS Code can
 * open — the `/portal` walkthrough.
 *
 * `producerReport` builds the page and `producerReportPublication` decides what
 * may leave the machine. Between them and a hosted site there was one sentence:
 * *"Point GitHub Pages at that folder."* That instruction cannot be followed.
 * Pages serves from a repository root, from `/docs`, or from an uploaded
 * artifact — never from an arbitrary path — so the report was written to a
 * folder no host could serve, and the last step was left as an exercise.
 *
 * Five rules.
 *
 * **A Pages site is public even when the repository is private.** Access
 * control for Pages is an Enterprise Cloud feature, so on a free or Pro account
 * "host the report" means publish to the open internet. It is the fact
 * everything else here turns on, so it is the first line of the plan rather
 * than a footnote at the end.
 *
 * **Nothing here enables Pages, and nothing here publishes.** Every action opens
 * a surface or writes a file into the working tree. Turning Pages on is a
 * decision made on GitHub, by a person, with that first rule in front of them.
 *
 * **The workflow runs on demand, never on push.** A push trigger would turn one
 * decision into a standing one: every commit would republish whatever the
 * report happened to say, including a section somebody switched on to look at
 * once. `workflow_dispatch` keeps each publication an act.
 *
 * **The workflow file is a constant here, never generated.** It is executable
 * content in somebody's repository with permission to publish; a model-written
 * one would be an unreviewed deployment.
 *
 * **A step whose state could not be read says so.** `undefined` is *unknown*
 * and renders as blocked with the reason, never as done — the same rule the
 * other setup plans follow, for the same reason: a guide that quietly ticks
 * something it did not check is worse than one that asks.
 *
 * Pure, `vscode`-free, unit-tested.
 */

/** Everything the plan needs, gathered by the caller. */
export interface ProducerPortalState {
  /** Is `atlasmind.producerReport.publishEnabled` on? */
  publishEnabled: boolean;
  /** Has a report been generated at all? `undefined` when the check could not run. */
  reportGenerated?: boolean;
  /** Has the narrowed site folder been prepared? `undefined` when unknown. */
  sitePrepared?: boolean;
  /** Where the prepared site lives, workspace-relative, for the guidance text. */
  sitePath: string;
  /** Does the deploy workflow already exist? `undefined` when unknown. */
  workflowPresent?: boolean;
  /** Repository visibility as `gh` reported it, or `unknown`. */
  visibility: 'public' | 'private' | 'unknown';
  /** Has Pages been enabled for the repository? `undefined` when it could not be read. */
  pagesEnabled?: boolean;
  /** The published site URL, once GitHub reports one. */
  pagesUrl?: string;
}

export const PRODUCER_PORTAL_WORKFLOW_PATH = '.github/workflows/producer-portal.yml';

/**
 * The deploy workflow, as a constant.
 *
 * Manual dispatch only, for the reason in the module note. `permissions` is the
 * minimum Pages deployment needs and nothing else, and the upload path is the
 * prepared site folder rather than the repository, so a misconfiguration
 * publishes nothing rather than publishing everything.
 */
export function producerPortalWorkflow(sitePath: string): string {
  return [
    '# Publish the AtlasMind producer report to GitHub Pages.',
    '#',
    '# Manual only, on purpose. A push trigger would republish whatever the report',
    '# happened to say on every commit, which turns one decision into a standing',
    '# one — including a section somebody switched on to look at once.',
    '#',
    '# A GitHub Pages site is PUBLIC even when the repository is private, unless',
    '# you are on Enterprise Cloud. Read the report before running this.',
    'name: Publish producer report',
    '',
    'on:',
    '  workflow_dispatch:',
    '',
    '# The minimum a Pages deployment needs, and nothing else.',
    'permissions:',
    '  contents: read',
    '  pages: write',
    '  id-token: write',
    '',
    '# One publication at a time; a queued run is never cancelled, because a',
    '# half-finished deploy is worse than a queued one.',
    'concurrency:',
    '  group: producer-portal',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    environment:',
    '      name: github-pages',
    '      url: ${{ steps.deployment.outputs.page_url }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/configure-pages@v5',
    '      # Only the prepared site folder is uploaded. Pointing this at the',
    '      # repository would publish the repository.',
    '      - uses: actions/upload-pages-artifact@v3',
    '        with:',
    `          path: ${sitePath}`,
    '      - id: deployment',
    '        uses: actions/deploy-pages@v4',
    '',
  ].join('\n');
}

/** Ids the guide walks, in order. */
export const PRODUCER_PORTAL_STEP_IDS = [
  'understand-public',
  'generate-report',
  'allow-publication',
  'prepare-site',
  'add-workflow',
  'enable-pages',
  'prove-published',
] as const;

/** What "the portal is set up" means. Proving it published is not in this set — see below. */
export const REQUIRED_PRODUCER_PORTAL_STEP_IDS = [
  // 'understand-public' is deliberately absent: it is optional and can never
  // be 'done', because a guide cannot check that somebody read something.
  // Requiring it would make the portal permanently unfinished.
  'generate-report',
  'allow-publication',
  'prepare-site',
  'add-workflow',
  'enable-pages',
] as const;

function unknownStep(id: string, title: string, detail: string): SetupStep {
  return { id, title, status: 'blocked', detail };
}

export function buildProducerPortalSteps(state: ProducerPortalState): SetupStep[] {
  const steps: SetupStep[] = [];

  // First, and not last: everything else is a decision made in the light of it.
  steps.push({
    id: 'understand-public',
    title: 'Know what hosting this means',
    // Never `done`: this is something to have read, and a guide cannot check
    // that somebody understood it. Marked optional so it never blocks, and
    // stated first so it is never missed.
    status: 'optional',
    detail: state.visibility === 'private'
      ? 'This repository is private, and a GitHub Pages site published from it would still be public. Access control for Pages is an Enterprise Cloud feature.'
      : state.visibility === 'public'
        ? 'This repository is public, so the page will be too. Anyone with the link can read it.'
        : 'Repository visibility could not be read. Assume the page will be public: a Pages site is public even when the repository is private, unless you are on Enterprise Cloud.',
    guidance: [
      { text: 'The report can name stakeholders, list commercial, legal and ethical findings, and state what the project has spent. Read it before you host it.' },
      { text: 'Risks and cost each need their own switch, and both are off until you turn them on.' },
    ],
  });

  steps.push(state.reportGenerated === undefined
    ? unknownStep('generate-report', 'Generate the report', 'Could not tell whether a report exists yet.')
    : {
      id: 'generate-report',
      title: 'Generate the report',
      status: state.reportGenerated ? 'done' : 'todo',
      detail: state.reportGenerated
        ? 'A producer report has been generated.'
        : 'There is nothing to publish yet. Generate the report first — it is built from what AtlasMind already knows, with no model in the path.',
      // Named rather than offered as a button: this command writes files, and
      //  exists precisely so a setup guide can never be the
      // thing that runs it.
      guidance: [{ text: 'Command palette → AtlasMind: Generate Producer Report' }],
    });

  steps.push({
    id: 'allow-publication',
    title: 'Allow publication',
    status: state.publishEnabled ? 'done' : 'todo',
    detail: state.publishEnabled
      ? 'Publication is switched on. Roadmap gates and delivery readiness are included; risks and cost need their own switches.'
      : 'Publication is off, which is the default. Nothing can be prepared until it is on.',
    guidance: [
      { text: 'Setting: atlasmind.producerReport.publishEnabled' },
      { text: 'Then, separately: producerReport.publishRisks and producerReport.publishCost. A withheld section still appears on the page, marked not assessed, so the omission is visible rather than silent.' },
    ],
    action: { command: 'atlasmind.openSettings', title: 'Open settings' },
  });

  steps.push(state.sitePrepared === undefined
    ? unknownStep('prepare-site', 'Prepare the page', 'Could not tell whether the site folder exists.')
    : {
      id: 'prepare-site',
      title: 'Prepare the page',
      status: state.sitePrepared ? 'done' : 'todo',
      detail: state.sitePrepared
        ? `The narrowed copy is in ${state.sitePath}.`
        : `Nothing prepared yet. This writes a narrowed copy of the report — only the sections you allowed — into ${state.sitePath}.`,
      guidance: [{ text: 'Command palette → AtlasMind: Prepare Producer Report for Publication' }],
    });

  steps.push(state.workflowPresent === undefined
    ? unknownStep('add-workflow', 'Add the deploy workflow', 'Could not read the workflows folder.')
    : {
      id: 'add-workflow',
      title: 'Add the deploy workflow',
      status: state.workflowPresent ? 'done' : 'todo',
      detail: state.workflowPresent
        ? `${PRODUCER_PORTAL_WORKFLOW_PATH} exists. It runs only when you run it.`
        : 'GitHub Pages cannot serve an arbitrary folder, so a workflow uploads the prepared page instead. It runs on manual dispatch only — never on push.',
      guidance: [
        // Named rather than offered as a button, like the two steps above: this
        // writes a workflow file, and `isOpeningAction` exists precisely so a
        // setup guide can never be the thing that runs it. The confirmation
        // that says what the file does belongs at the command.
        { text: 'Command palette → AtlasMind: Add Producer Portal Deploy Workflow' },
        { text: `Writes ${PRODUCER_PORTAL_WORKFLOW_PATH}. An existing file is never overwritten.` },
        { text: 'Nothing is published by adding it. Publication happens when you run the workflow.' },
      ],
    });

  steps.push(state.pagesEnabled === undefined
    ? unknownStep(
      'enable-pages',
      'Turn Pages on',
      'Whether Pages is enabled could not be read. Check it on GitHub: Settings → Pages, source "GitHub Actions".',
    )
    : {
      id: 'enable-pages',
      title: 'Turn Pages on',
      status: state.pagesEnabled ? 'done' : 'todo',
      detail: state.pagesEnabled
        ? 'Pages is enabled for this repository.'
        : 'Pages is off. AtlasMind does not turn it on: that is the decision that makes the report public, and it belongs to you, on GitHub.',
      guidance: [
        { text: 'On GitHub: Settings → Pages → Build and deployment → Source: GitHub Actions.' },
      ],
      docs: { url: 'https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site', title: 'Configuring a publishing source' },
    });

  steps.push({
    id: 'prove-published',
    title: 'Prove the page is up',
    status: state.pagesUrl ? 'done' : 'todo',
    detail: state.pagesUrl
      ? `Published at ${state.pagesUrl}.`
      : 'Configured is not the same as published. Run the workflow once and open the URL it prints.',
    guidance: [
      { text: 'Actions → Publish producer report → Run workflow.' },
      { text: 'Then open the page and read it as a stranger would, because that is who can now read it.' },
    ],
  });

  return steps;
}

/**
 * Is the portal set up?
 *
 * Deliberately excludes `prove-published`, for the reason the ACP guide excludes
 * its own proof step: a portal can be correctly configured and never have been
 * run, and reporting that as a fault would be wrong while reporting it as
 * finished would be worse.
 */
export function isProducerPortalReady(state: ProducerPortalState): boolean {
  return isSetupComplete(buildProducerPortalSteps(state), REQUIRED_PRODUCER_PORTAL_STEP_IDS);
}

/** The guide, in the shared shape  indexes. */
export const PRODUCER_PORTAL_SETUP_GUIDE: SetupGuideSummary = {
  id: 'portal',
  label: 'Producer portal',
  blurb: 'Host the producer report as a page somebody without VS Code can read.',
  command: '/portal',
  stepIds: [...PRODUCER_PORTAL_STEP_IDS],
};

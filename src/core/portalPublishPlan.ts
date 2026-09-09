/**
 * Build the producer portal and publish it, in one press.
 *
 * Until now this was three commands and a walkthrough: generate the report,
 * decide what may be published, prepare the narrowed folder, add a workflow,
 * turn the host on, prove a page came up. Every one of those steps exists for a
 * reason and none of them is interesting to somebody who just wants the status
 * page updated. So they collapse into one action — and collapsing them is
 * exactly when the mistakes this codebase has spent so long guarding against
 * become easy to make, because nobody reads six dialogs but everybody reads one.
 *
 * Hence the shape: **one plan, one confirmation, and the confirmation says what
 * becomes visible and to whom.** Seven rules.
 *
 * **It refuses when the audience and the host disagree.** Somebody who has named
 * five viewers on a host that cannot enforce a list has published to the open
 * internet a page they believe is restricted. That is not a warning, because a
 * warning on a one-press button is a thing you click past — it is a refusal, and
 * it names the two fixes: narrow what is published, or move to a host that can
 * restrict.
 *
 * **Unconfirmed access is not restricted access.** A host that *can* restrict
 * but where nobody has confirmed a policy exists is treated as open, for the
 * same reason `portalHosting` will not call an audience enforced on somebody's
 * intention. AtlasMind cannot see a Cloudflare Access policy, and the moment it
 * assumes one is there is the moment this button publishes a risk register to
 * the world.
 *
 * **AtlasMind performs only what a constant can express.** Every deploy command
 * is a literal in this file with its arguments passed as argv — never a shell
 * string, never composed from a setting or a model — which is the rule
 * `websiteFrameworks` and `acpInstaller` already hold. A host AtlasMind has no
 * constant for gets **no deploy step at all**, which is the second action: the
 * folder is prepared and you take it from there.
 *
 * **Nothing here turns a host's public switch on.** Enabling Pages, creating an
 * Access policy, adding somebody to a Vercel team: all absent by declaration.
 * Publishing to a host somebody has already configured is a different act from
 * making that host serve to the public in the first place, and only the first
 * one belongs behind a button.
 *
 * **A step AtlasMind cannot undo is named as such.** Generating and preparing
 * are local and reversible. A deploy is not — a page that went out cannot be
 * recalled from whoever already read it — and the plan says which steps are
 * which so the confirmation can too.
 *
 * **A refusal names its fix.** There are only ever two, and stating them is what
 * stops a refusal reading as a malfunction.
 *
 * **Nothing is scheduled.** One press publishes once. There is deliberately no
 * publish-on-commit and no timer: a standing publication republishes whatever
 * the report happened to say, which is the argument `/portal`'s deploy workflow
 * already makes by running on manual dispatch only.
 *
 * Pure, `vscode`-free and unit-tested.
 */

import {
  assessPortalAccess,
  type PortalHost,
  type PortalHostingConfig,
  type RepositoryVisibility,
} from './portalHosting.js';
import type { DirectorContact } from '../types.js';

/** What one step does, and who does it. */
export interface PortalPublishStep {
  id: string;
  title: string;
  /**
   * `atlasmind` for steps it performs; `you` for the ones it will not.
   *
   * The second is not a shortfall — it is where the switch that changes who can
   * read the page lives, and that stays a person's act.
   */
  actor: 'atlasmind' | 'you';
  detail: string;
  /**
   * The exact command, as a file and an argument vector.
   *
   * Never a shell string. Arguments reach the process untouched, so a folder
   * name cannot become a second command — the rule `windowsShimBypass` exists
   * to preserve.
   */
  command?: { file: string; args: readonly string[] };
  /** False for anything that cannot be taken back. Stated in the confirmation. */
  reversible: boolean;
}

export type PortalPublishRefusalCode =
  | 'publication-not-allowed'
  | 'audience-not-enforceable'
  | 'access-not-confirmed'
  | 'no-report';

export interface PortalPublishRefusal {
  code: PortalPublishRefusalCode;
  message: string;
  /** What to change. A refusal without one reads as a malfunction. */
  fix: string;
}

export interface PortalPublishInput {
  hosting: PortalHostingConfig;
  visibility: RepositoryVisibility;
  contacts: readonly DirectorContact[];
  /** True once a producer report exists to publish. */
  reportExists: boolean;
  /** What the publication policy decided. */
  publication: {
    publish: boolean;
    reason?: string;
    publishedSections: readonly string[];
    withheldSections: readonly string[];
  };
  /** Workspace-relative folder the prepared page is written to. */
  siteDir: string;
  /** Present when the Pages deploy workflow has been added. */
  workflowPresent?: boolean;
}

export interface PortalPublishPlan {
  steps: PortalPublishStep[];
  refusals: PortalPublishRefusal[];
  /** False when anything refused. Nothing runs. */
  canPublish: boolean;
  /**
   * False when AtlasMind has no constant deploy command for this host — the
   * "two actions" case, where it prepares and stops.
   */
  atlasCanDeploy: boolean;
  /** The paragraph the one confirmation shows. Composed here, never at a call site. */
  disclosure: string;
}

/**
 * Sections that make a public page a disclosure rather than a status update.
 *
 * A roadmap and a delivery date are what a client asks for and name nobody. A
 * risk register and a spend figure are the two that carry stakeholder names,
 * commercial and legal findings, and money — the reason
 * `producerReportPublication` gates them separately, and the reason this module
 * refuses harder when they are switched on.
 */
const DISCLOSING_SECTIONS: readonly string[] = ['risks', 'cost'];

function publishesDisclosingSections(sections: readonly string[]): boolean {
  return sections.some(section => DISCLOSING_SECTIONS.includes(section.toLowerCase()));
}

/**
 * The deploy command for each host, as a constant.
 *
 * Every one is the vendor's own published CLI invocation with the prepared
 * folder as an argument. There is no entry for `custom` and no fallback: a host
 * AtlasMind cannot express is a host it does not deploy to, which is honest and
 * is also the second action the plan then describes.
 *
 * `npx` is used deliberately rather than assuming a global install — it is how
 * each vendor documents a one-off deploy, and it keeps AtlasMind from requiring
 * a toolchain somebody has not chosen.
 */
export function portalDeployCommand(
  host: PortalHost,
  siteDir: string,
  workflowPresent: boolean,
): { file: string; args: readonly string[] } | undefined {
  switch (host) {
    case 'cloudflare-pages':
      return { file: 'npx', args: ['wrangler', 'pages', 'deploy', siteDir] };
    case 'netlify':
      return { file: 'npx', args: ['netlify', 'deploy', '--dir', siteDir, '--prod'] };
    case 'vercel':
      return { file: 'npx', args: ['vercel', 'deploy', siteDir, '--prod'] };
    case 'github-pages':
      // Dispatching the workflow that already exists. Adding the workflow is a
      // separate command and enabling Pages has no button at all, because that
      // is the switch that makes the page public.
      return workflowPresent
        ? { file: 'gh', args: ['workflow', 'run', 'producer-portal.yml'] }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Decide what one press would do, and return it rather than doing it.
 *
 * Everything the confirmation needs is here: the steps, which of them cannot be
 * undone, what becomes visible, who can read it, and every reason it might
 * refuse. A plan that could not be inspected separately from the act would make
 * every rule above a comment.
 */
export function buildPortalPublishPlan(input: PortalPublishInput): PortalPublishPlan {
  const access = assessPortalAccess(input.hosting, input.visibility, input.contacts);
  const refusals: PortalPublishRefusal[] = [];

  if (!input.reportExists) {
    refusals.push({
      code: 'no-report',
      message: 'There is no producer report to publish yet.',
      fix: 'Generate the producer report first — this button will do that too once there is something to gather.',
    });
  }

  if (!input.publication.publish) {
    refusals.push({
      code: 'publication-not-allowed',
      message: input.publication.reason ?? 'Publication is switched off.',
      fix: 'Turn on "atlasmind.producerReport.publishEnabled", and choose which sections may leave.',
    });
  }

  const namedAudience = input.hosting.audienceContactIds.length;
  const disclosing = publishesDisclosingSections(input.publication.publishedSections);

  // The rule the button exists to survive. Somebody who has named viewers on a
  // host that cannot enforce a list believes the page is restricted, and one
  // press would put it on the open internet.
  if (namedAudience > 0 && access.effectiveControl !== 'named-audience') {
    refusals.push({
      code: 'audience-not-enforceable',
      message: `${namedAudience} ${namedAudience === 1 ? 'person is' : 'people are'} named as the portal audience, and ${access.capability.label} cannot restrict the page to a list you choose. Publishing now would put it where anyone with the URL can read it, while the audience list says otherwise.`,
      fix: 'Either move to a host that can restrict a named audience, or clear the audience so the page is knowingly public.',
    });
  }

  // And the same mistake one step later: the host *can* restrict, and nobody
  // has confirmed a policy is actually in place.
  if (namedAudience > 0
    && access.effectiveControl === 'named-audience'
    && !access.audienceEnforceable
    && disclosing) {
    refusals.push({
      code: 'access-not-confirmed',
      message: `This report includes ${input.publication.publishedSections.filter(section => DISCLOSING_SECTIONS.includes(section.toLowerCase())).join(' and ')}, and nobody has confirmed the host-side policy exists. AtlasMind cannot see it, so it is treated as absent.`,
      fix: 'Configure the policy at the host and confirm it on the Director page, or stop publishing those sections.',
    });
  }

  const command = portalDeployCommand(input.hosting.host, input.siteDir, input.workflowPresent === true);
  const atlasCanDeploy = command !== undefined;

  const steps: PortalPublishStep[] = [
    {
      id: 'generate',
      title: 'Gather the report',
      actor: 'atlasmind',
      detail: 'Reads the managers and writes the full report locally. Nothing leaves the machine.',
      reversible: true,
    },
    {
      id: 'narrow',
      title: 'Apply the publication policy',
      actor: 'atlasmind',
      detail: input.publication.withheldSections.length > 0
        ? `Publishes ${input.publication.publishedSections.join(', ')}. Withholds ${input.publication.withheldSections.join(', ')} — the page will say so rather than omitting the heading.`
        : `Publishes ${input.publication.publishedSections.join(', ')}.`,
      reversible: true,
    },
    {
      id: 'prepare',
      title: 'Prepare the page',
      actor: 'atlasmind',
      detail: `Writes the narrowed copy to ${input.siteDir}. Still local.`,
      reversible: true,
    },
  ];

  if (atlasCanDeploy && command) {
    steps.push({
      id: 'deploy',
      title: `Publish to ${access.capability.label}`,
      actor: 'atlasmind',
      detail: 'Runs the host\'s own deploy command. This is the step that cannot be undone — a page somebody has read cannot be recalled.',
      command,
      reversible: false,
    });
  } else {
    steps.push({
      id: 'deploy-yourself',
      title: `Publish it yourself to ${access.capability.label}`,
      actor: 'you',
      detail: input.hosting.host === 'github-pages'
        ? 'AtlasMind has no deploy workflow to dispatch yet. Add it with "AtlasMind: Add Producer Portal Deploy Workflow", then press this again.'
        : 'AtlasMind has no command for this host, so it stops with the folder prepared. Upload it however you normally do.',
      reversible: false,
    });
  }

  return {
    steps,
    refusals,
    canPublish: refusals.length === 0,
    atlasCanDeploy,
    disclosure: describePublish(access.summary, input, atlasCanDeploy),
  };
}

function describePublish(
  audienceSummary: string,
  input: PortalPublishInput,
  atlasCanDeploy: boolean,
): string {
  const published = input.publication.publishedSections.length > 0
    ? input.publication.publishedSections.join(', ')
    : 'nothing';
  const withheld = input.publication.withheldSections.length > 0
    ? ` Withheld: ${input.publication.withheldSections.join(', ')}.`
    : '';
  const ending = atlasCanDeploy
    ? 'The last step cannot be undone: a page somebody has already read cannot be recalled.'
    : 'AtlasMind will stop with the page prepared — publishing it is yours to do.';
  return `Will publish: ${published}.${withheld} ${audienceSummary} ${ending}`;
}

/**
 * The lines a confirmation shows for each command it is about to run.
 *
 * Rendered from the plan rather than restated, so what somebody agrees to is
 * what will actually be executed — the property `acpInstaller` holds by listing
 * every command with its purpose before any of them runs.
 */
export function describePortalPublishCommands(plan: PortalPublishPlan): string[] {
  return plan.steps
    .filter(step => step.command !== undefined)
    .map(step => `${step.command!.file} ${step.command!.args.join(' ')}  —  ${step.title}`);
}

/**
 * The GitHub Actions workflow Website Studio can write for you.
 *
 * This is the most dangerous file in the feature, and it is worth being explicit
 * about why: everything else AtlasMind generates sits inert in a preview folder
 * until somebody looks at it. A file in `.github/workflows/` runs on GitHub's
 * infrastructure, with the repository's secrets, on a push nobody reviewed it
 * for — it can deploy, and it can spend money. A generated workflow is the one
 * artefact that acts on its own.
 *
 * Five rules, each of them testable, none of them advisory.
 *
 * **The YAML is a declared template; only values are substituted.** The
 * templates are module constants. A model never writes a line of this, and no
 * template is fetched or composed. Every substituted value — the build command,
 * the output directory, the branch names — is validated against a strict charset
 * first, and a test asserts no rendered output still contains an unsubstituted
 * placeholder.
 *
 * **Never overwrites an existing workflow.** `.github/workflows/` is create-only.
 * A colliding filename is reported and skipped, because replacing somebody's
 * deploy pipeline with a scaffolder's guess is not recoverable from the editor.
 *
 * **Production is gated on GitHub's side, not only ours.** The production job
 * declares `environment: production`, so the approval lives where the deploy
 * actually happens. AtlasMind's own confirmation protects the moment the file is
 * written; the environment protects every run after that. This repository's own
 * `publish.yml` uses the same mechanism.
 *
 * **Secrets are named, never written.** The workflow references
 * `secrets.CLOUDFLARE_API_TOKEN`; the plan tells you which secrets to add and
 * where. No value reaches the file — it is committed, and a committed secret is
 * a leaked secret.
 *
 * **Least privilege by default.** An explicit `permissions:` block rather than
 * the repository default, a `concurrency` group per environment so two
 * promotions cannot race, and pinned action major versions.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePlatformId } from '../types.js';
import {
  buildCommandFor,
  renderCommandLine,
  websiteFrameworkSpec,
  type WebsiteFrameworkId,
  type WebsitePackageManager,
} from './websiteFrameworks.js';

/** Where a generated workflow lands. Create-only. */
export const CI_WORKFLOW_DIR = '.github/workflows';

/**
 * The filename. Distinct from anything this repository or a typical project
 * already uses, so a collision means somebody genuinely already generated one.
 */
export const CI_WORKFLOW_FILENAME = 'website-deploy.yml';

export interface CiTemplateInput {
  frameworkId: WebsiteFrameworkId;
  platformId: WebsitePlatformId;
  packageManager: WebsitePackageManager;
  /** Branch representing each stage. Validated as git ref names before use. */
  developBranch: string;
  stagingBranch: string;
  productionBranch: string;
  /**
   * Node major to run CI on, resolved by the caller.
   *
   * Required. It was optional with a hardcoded default nothing overrode, so
   * every website workflow pinned the same ageing runtime — see the same note on
   * `NodeCiStarterInput`.
   */
  nodeVersion: string;
}

export interface CiSecretRequirement {
  name: string;
  /** Why the workflow needs it, and where to get it. */
  purpose: string;
}

export type CiTemplateResult =
  | {
      ok: true;
      filePath: string;
      contents: string;
      /** Secrets the user must add to the repository before the workflow can run. */
      requiredSecrets: CiSecretRequirement[];
      /** Stated limitations of the generated pipeline. */
      caveats: string[];
    }
  | { ok: false; reason: string };

/**
 * What each platform needs in its deploy step.
 *
 * Declared per platform rather than derived. `undefined` means AtlasMind has no
 * verified deploy action for that platform and will refuse to generate a
 * workflow rather than improvise one — the same rule the framework catalog
 * applies to scaffold commands.
 */
interface PlatformDeploySpec {
  /** Pinned to a major version, as GitHub recommends and this repo's own workflows do. */
  action: string;
  /** `with:` lines, already indented to fit the template. Values only, no secrets. */
  withLines: (outputDir: string) => string[];
  secrets: CiSecretRequirement[];
}

const PLATFORM_DEPLOY: Partial<Record<WebsitePlatformId, PlatformDeploySpec>> = {
  'cloudflare-pages': {
    action: 'cloudflare/wrangler-action@v3',
    withLines: outputDir => [
      'apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      'accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}',
      `command: pages deploy ${outputDir} --project-name=\${{ vars.CLOUDFLARE_PROJECT_NAME }}`,
    ],
    secrets: [
      { name: 'CLOUDFLARE_API_TOKEN', purpose: 'Cloudflare dashboard → My Profile → API Tokens. Needs the "Cloudflare Pages — Edit" template.' },
      { name: 'CLOUDFLARE_ACCOUNT_ID', purpose: 'Cloudflare dashboard → Workers & Pages → Account ID in the right-hand sidebar.' },
    ],
  },
  netlify: {
    action: 'nwtgck/actions-netlify@v3',
    withLines: outputDir => [
      `publish-dir: ${outputDir}`,
      'production-branch: ${{ github.event.repository.default_branch }}',
      'github-token: ${{ secrets.GITHUB_TOKEN }}',
      'enable-pull-request-comment: false',
      'enable-commit-comment: false',
    ],
    secrets: [
      { name: 'NETLIFY_AUTH_TOKEN', purpose: 'Netlify → User settings → Applications → Personal access tokens.' },
      { name: 'NETLIFY_SITE_ID', purpose: 'Netlify → Site configuration → Site information → Site ID.' },
    ],
  },
  vercel: {
    action: 'amondnet/vercel-action@v25',
    withLines: () => [
      'vercel-token: ${{ secrets.VERCEL_TOKEN }}',
      'vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}',
      'vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}',
    ],
    secrets: [
      { name: 'VERCEL_TOKEN', purpose: 'Vercel → Account Settings → Tokens.' },
      { name: 'VERCEL_ORG_ID', purpose: 'Found in .vercel/project.json after running `vercel link`.' },
      { name: 'VERCEL_PROJECT_ID', purpose: 'Found in .vercel/project.json after running `vercel link`.' },
    ],
  },
  'github-pages': {
    action: 'actions/deploy-pages@v4',
    withLines: () => [],
    secrets: [],
  },
};

/** A git branch name we are willing to interpolate into YAML. */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,98}$/;

/** An output directory we are willing to interpolate into a shell-free YAML value. */
const SAFE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._\/-]{0,98}$/;

/** A node version line. */
const SAFE_NODE_VERSION = /^[0-9]{1,2}(\.[0-9]{1,2}){0,2}$/;

export function renderWebsiteCiWorkflow(input: CiTemplateInput): CiTemplateResult {
  const spec = websiteFrameworkSpec(input.frameworkId);
  const deploy = PLATFORM_DEPLOY[input.platformId];

  if (!deploy) {
    // Refused rather than improvised. A workflow that half-works still runs.
    return {
      ok: false,
      reason: `AtlasMind has no verified deploy action for this platform, so it will not generate a workflow that guesses one. Set the deploy step up by hand, or choose Cloudflare Pages, Netlify, Vercel or GitHub Pages.`,
    };
  }

  // Validate every value before it can reach the template. Ordered so the
  // message names the field that is actually wrong.
  for (const [label, value] of [
    ['develop branch', input.developBranch],
    ['staging branch', input.stagingBranch],
    ['production branch', input.productionBranch],
  ] as const) {
    if (!SAFE_REF.test(value)) {
      return { ok: false, reason: `The ${label} name "${value}" is not a plain git branch name, so it will not be written into a workflow file.` };
    }
  }
  if (!SAFE_PATH.test(spec.outputDir)) {
    return { ok: false, reason: `The framework's output directory "${spec.outputDir}" is not a plain relative path.` };
  }
  const nodeVersion = input.nodeVersion;
  if (!SAFE_NODE_VERSION.test(nodeVersion)) {
    return { ok: false, reason: `"${nodeVersion}" is not a Node version number.` };
  }

  const build = buildCommandFor(spec, input.packageManager);
  const buildLine = build ? renderCommandLine(build.command, build.args) : '';
  // The build command is composed entirely from catalog constants and the
  // package-manager enum, so it cannot carry user text — but it is checked
  // anyway, because this is the line that ends up inside a `run:` block.
  if (buildLine && /[;&|`$<>\n]/.test(buildLine)) {
    return { ok: false, reason: 'The build command contains shell metacharacters and will not be written into a workflow file.' };
  }

  const contents = buildWorkflowYaml({
    spec,
    deploy,
    buildLine,
    nodeVersion,
    packageManager: input.packageManager,
    developBranch: input.developBranch,
    stagingBranch: input.stagingBranch,
    productionBranch: input.productionBranch,
  });

  const unsubstituted = findUnsubstitutedPlaceholder(contents);
  if (unsubstituted) {
    // A guard against a template edit that forgets a value. Better to refuse
    // than to write a workflow with a literal placeholder in it.
    return { ok: false, reason: `The workflow template left "${unsubstituted}" unsubstituted, so nothing was written.` };
  }

  return {
    ok: true,
    filePath: `${CI_WORKFLOW_DIR}/${CI_WORKFLOW_FILENAME}`,
    contents,
    requiredSecrets: deploy.secrets,
    caveats: buildCaveats(spec.id, input.platformId, Boolean(buildLine)),
  };
}

interface WorkflowParts {
  spec: ReturnType<typeof websiteFrameworkSpec>;
  deploy: PlatformDeploySpec;
  buildLine: string;
  nodeVersion: string;
  packageManager: WebsitePackageManager;
  developBranch: string;
  stagingBranch: string;
  productionBranch: string;
}

function buildWorkflowYaml(parts: WorkflowParts): string {
  const {
    spec, deploy, buildLine, nodeVersion, packageManager,
    developBranch, stagingBranch, productionBranch,
  } = parts;

  const installLine = packageManager === 'npm'
    ? 'npm ci'
    : packageManager === 'yarn'
      ? 'yarn install --frozen-lockfile'
      : packageManager === 'bun'
        ? 'bun install --frozen-lockfile'
        : 'pnpm install --frozen-lockfile';

  const needsNode = spec.scaffold?.runtime !== 'go' && Boolean(buildLine);

  const buildSteps = needsNode
    ? [
        '      - name: Setup Node',
        '        uses: actions/setup-node@v4',
        '        with:',
        `          node-version: '${nodeVersion}'`,
        packageManager === 'npm' ? '          cache: npm' : '',
        '',
        '      - name: Install dependencies',
        `        run: ${installLine}`,
        '',
        '      - name: Build',
        `        run: ${buildLine}`,
      ].filter(line => line !== '')
    : spec.scaffold?.runtime === 'go'
      ? [
          '      - name: Setup Hugo',
          '        uses: peaceiris/actions-hugo@v3',
          '        with:',
          "          hugo-version: 'latest'",
          '          extended: true',
          '',
          '      - name: Build',
          '        run: hugo --minify',
        ]
      : [
          '      # No build step: this site is served exactly as it is committed.',
        ];

  const deployWith = deploy.withLines(spec.outputDir);
  const deployStep = [
    `      - name: Deploy`,
    `        uses: ${deploy.action}`,
    ...(deployWith.length > 0
      ? ['        with:', ...deployWith.map(line => `          ${line}`)]
      : []),
  ];

  return `# Generated by AtlasMind Website Studio.
#
# Read this before you rely on it. It deploys, and it spends money.
#
# - Production runs are gated on the GitHub Environment "production". Add
#   required reviewers there (Settings -> Environments) or every push to
#   ${productionBranch} deploys with no approval.
# - The secrets referenced below must exist on this repository. AtlasMind never
#   writes a secret value into a file; see the setup summary for where each comes
#   from.
# - Regenerating never overwrites this file. Edit it freely; it is yours now.

name: Deploy website

on:
  push:
    branches:
      - ${developBranch}
      - ${stagingBranch}
      - ${productionBranch}
  workflow_dispatch:

# Least privilege by default rather than the repository default.
permissions:
  contents: read
  deployments: write

# One deploy per branch at a time, so two pushes cannot race each other onto the
# same environment. In-progress runs are not cancelled: a half-finished deploy is
# worse than a queued one.
concurrency:
  group: website-deploy-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    # Maps the branch onto a GitHub Environment. "production" is the one worth
    # protecting with required reviewers.
    environment:
      name: >-
        \${{
          github.ref == 'refs/heads/${productionBranch}' && 'production'
          || github.ref == 'refs/heads/${stagingBranch}' && 'staging'
          || 'development'
        }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

${buildSteps.join('\n')}

${deployStep.join('\n')}
`;
}

/**
 * Find a template placeholder that survived rendering.
 *
 * Deliberately narrow: it looks for `{{name}}`, the shape this file's own
 * templates would use, and **not** for `${{ ... }}`, which is GitHub Actions'
 * own expression syntax and is supposed to be there. Conflating the two would
 * make the guard reject every valid workflow.
 */
export function findUnsubstitutedPlaceholder(contents: string): string | undefined {
  const match = /(?<!\$)\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.exec(contents);
  return match?.[0];
}

/**
 * What the generated pipeline does not do.
 *
 * Stated with the result rather than discovered later — the same rule the
 * generation planner applies to its `omitted` list.
 */
function buildCaveats(
  frameworkId: WebsiteFrameworkId,
  platformId: WebsitePlatformId,
  hasBuild: boolean,
): string[] {
  const caveats = [
    'No tests run before the deploy. Add your test command as a step ahead of Build once you have one.',
    `Production deploys are only gated if you add required reviewers to the "production" environment in the repository settings.`,
  ];
  if (!hasBuild) {
    caveats.push('This framework has no build step, so the repository contents are deployed exactly as committed.');
  }
  if (platformId === 'github-pages') {
    caveats.push('GitHub Pages also needs Pages enabled in the repository settings, with the source set to GitHub Actions.');
  }
  if (frameworkId === 'nextjs') {
    caveats.push('Next.js deploys its .next output. If you intend a fully static export, set output: \'export\' in next.config and change the output directory to out.');
  }
  return caveats;
}

/**
 * What a website is actually built with — the concept AtlasMind was missing.
 *
 * `projectArchetype.ts` knows a project is a "website". `archetypePacks.ts`
 * knows what a website's CI looks like in the abstract. Neither knows Astro from
 * Next from Hugo, which is why Website Studio could plan a whole site for
 * Cloudflare Pages and still leave somebody to guess the build command, the
 * output directory, and the shape of the deploy config.
 *
 * Those three facts are the entire content of this file, and they are the reason
 * framework and platform belong on one page rather than two: "Astro on
 * Cloudflare Pages" has one known answer for each, and splitting the choice
 * makes the compatible pairing something the user is expected to already know.
 *
 * Three rules.
 *
 * **Every command is a module constant.** Nothing here is composed from a
 * setting, a webview message, a fetched page, or a model. `acpInstaller.ts` says
 * why in one line: a command parsed from documentation is remote code execution
 * with extra steps. A test walks every spec in the catalog and fails on a shell
 * metacharacter or a substituted value.
 *
 * **A framework with no verified command gets none.** `custom`, `static` and
 * `wordpress-theme` carry no `scaffold`, and the setup planner turns that into a
 * `manual` step quoting the vendor's own instructions — the same treatment
 * `acpInstaller` gives Rust's `curl | sh` installer. An improvised command that
 * usually works is worse than an honest gap, because the failure lands in
 * somebody's repository.
 *
 * **Incompatibility is stated, never hidden.** `describeStackCompatibility`
 * returns a reason for every pairing, including the bad ones. Removing Hugo from
 * the list when Shopify is selected would leave somebody wondering where it
 * went; saying "Shopify serves Liquid templates from its own theme system, so a
 * Hugo build has nowhere to go" answers the question they actually had.
 *
 * Pure, `vscode`-free, and unit-tested.
 */

import type { WebsitePlatformId } from '../types.js';

export type WebsiteFrameworkId =
  | 'astro'
  | 'nextjs'
  | 'nuxt'
  | 'sveltekit'
  | 'react'
  | 'vue'
  | 'eleventy'
  | 'hugo'
  | 'remix'
  | 'static'
  | 'wordpress-theme'
  | 'custom';

/** How the framework produces pages, which decides where it can be hosted. */
export type FrameworkRendering =
  /** Everything is built to files up front. Hostable anywhere. */
  | 'static'
  /** Static by default, with server routes available where the host supports them. */
  | 'hybrid'
  /** Needs a running server or an edge runtime. */
  | 'server';

/** The runtime a scaffold command needs on the machine before it can run. */
export type FrameworkRuntime = 'node' | 'go' | 'none';

/**
 * A scaffold invocation.
 *
 * `command` and `args` are `execFile` arguments — never a shell string. The
 * project directory is *not* in `args`: the planner appends it after validating
 * it, so a path can never arrive here pre-baked into a constant.
 */
export interface FrameworkScaffold {
  command: string;
  args: readonly string[];
  runtime: FrameworkRuntime;
  /** True when the command creates its own subdirectory rather than filling the current one. */
  createsOwnDirectory: boolean;
}

export interface WebsiteFrameworkSpec {
  id: WebsiteFrameworkId;
  label: string;
  description: string;
  rendering: FrameworkRendering;
  /** Absent means AtlasMind has no verified command and will say so. */
  scaffold?: FrameworkScaffold;
  devCommand?: readonly string[];
  buildCommand?: readonly string[];
  /**
   * Where the build lands, relative to the project root. The single fact every
   * deploy config and CI workflow needs, and the one most often got wrong by
   * hand.
   */
  outputDir: string;
  /** Platforms this deploys to with no extra work. Drives the compatibility badge. */
  wellSupportedOn: readonly WebsitePlatformId[];
  /** Shown when there is no scaffold command, so the gap is actionable. */
  manualSetupUrl?: string;
}

/**
 * The catalog.
 *
 * Twelve entries rather than thirty. Every one here is a framework somebody
 * building a client website plausibly picks, and each carries a build/deploy
 * contract worth standing behind. A longer list would mean entries nobody
 * verified, and an unverified command in this file is the one thing this file
 * must not contain.
 */
export const WEBSITE_FRAMEWORK_CATALOG: readonly WebsiteFrameworkSpec[] = [
  {
    id: 'astro',
    label: 'Astro',
    description: 'Content-first static sites that ship almost no JavaScript. The usual best fit for a marketing or brochure site.',
    rendering: 'hybrid',
    scaffold: { command: 'npm', args: ['create', 'astro@latest', '--', '--yes', '--no-install', '--no-git'], runtime: 'node', createsOwnDirectory: true },
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: 'dist',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'vercel', 'github-pages', 'azure-static-web-apps'],
  },
  {
    id: 'nextjs',
    label: 'Next.js',
    description: 'React with server rendering and routing. Strong when the site is really an application with pages attached.',
    rendering: 'server',
    scaffold: { command: 'npm', args: ['create', 'next-app@latest', '--', '--yes', '--skip-install', '--disable-git', '--use-npm'], runtime: 'node', createsOwnDirectory: true },
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    // Next's default build output. A static export lands in `out/`, which is why
    // the deploy config is generated from this field rather than assumed.
    outputDir: '.next',
    wellSupportedOn: ['vercel', 'netlify', 'cloudflare-pages', 'azure-static-web-apps'],
  },
  {
    id: 'nuxt',
    label: 'Nuxt',
    description: 'Vue with server rendering and routing — the Vue-side equivalent of Next.',
    rendering: 'server',
    scaffold: { command: 'npm', args: ['create', 'nuxt@latest', '--', '--no-install', '--packageManager', 'npm', '--no-modules'], runtime: 'node', createsOwnDirectory: true },
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: '.output/public',
    wellSupportedOn: ['vercel', 'netlify', 'cloudflare-pages'],
  },
  {
    id: 'sveltekit',
    label: 'SvelteKit',
    description: 'Svelte with routing and adapters. Small output, and adapters for most hosts.',
    rendering: 'hybrid',
    scaffold: { command: 'npx', args: ['sv', 'create', '--template', 'minimal', '--types', 'ts', '--no-add-ons', '--no-install'], runtime: 'node', createsOwnDirectory: true },
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: 'build',
    wellSupportedOn: ['vercel', 'netlify', 'cloudflare-pages'],
  },
  {
    id: 'react',
    label: 'React (Vite)',
    description: 'A client-focused React build. React recommends a framework first; choose this when those constraints do not fit.',
    rendering: 'static',
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: 'dist',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'vercel', 'azure-static-web-apps'],
    manualSetupUrl: 'https://react.dev/learn/creating-a-react-app',
  },
  {
    id: 'vue',
    label: 'Vue',
    description: 'A Vite-based Vue Single-Page Application with interactive choices for Router, Pinia, tests, and linting.',
    rendering: 'static',
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: 'dist',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'vercel', 'azure-static-web-apps'],
    manualSetupUrl: 'https://vuejs.org/guide/quick-start.html',
  },
  {
    id: 'eleventy',
    label: 'Eleventy (11ty)',
    description: 'A plain static site generator with no client framework. Good when the site is genuinely just pages.',
    rendering: 'static',
    // 11ty has no official `create` command; installing it and running the CLI is
    // the documented path, and both halves are stable.
    scaffold: { command: 'npm', args: ['install', '--save-dev', '@11ty/eleventy'], runtime: 'node', createsOwnDirectory: false },
    devCommand: ['exec', 'eleventy', '--serve'],
    buildCommand: ['exec', 'eleventy'],
    outputDir: '_site',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'github-pages', 'vercel', 'azure-static-web-apps'],
  },
  {
    id: 'hugo',
    label: 'Hugo',
    description: 'A very fast static site generator. No Node required, but it needs the Hugo binary.',
    rendering: 'static',
    scaffold: { command: 'hugo', args: ['new', 'site'], runtime: 'go', createsOwnDirectory: true },
    devCommand: ['server', '-D'],
    buildCommand: [],
    outputDir: 'public',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'github-pages', 'azure-static-web-apps'],
  },
  {
    id: 'remix',
    label: 'Remix / React Router',
    description: 'React Router framework mode with server-first data loading — the maintained path for new Remix-style applications.',
    rendering: 'server',
    scaffold: { command: 'npx', args: ['create-react-router@latest'], runtime: 'node', createsOwnDirectory: true },
    devCommand: ['run', 'dev'],
    buildCommand: ['run', 'build'],
    outputDir: 'build/client',
    wellSupportedOn: ['vercel', 'netlify', 'cloudflare-pages'],
  },
  {
    id: 'static',
    label: 'Hand-written HTML/CSS',
    description: 'No build step. What Website Studio generates by default, and enough for many brochure sites.',
    rendering: 'static',
    // No scaffold command by design: the files already exist, or Generate makes
    // them. Running a create command here would overwrite them.
    outputDir: '.',
    wellSupportedOn: ['cloudflare-pages', 'netlify', 'github-pages', 'vercel', 'azure-static-web-apps'],
  },
  {
    id: 'wordpress-theme',
    label: 'WordPress theme',
    description: 'A theme built against an existing WordPress install. AtlasMind does not provision WordPress.',
    rendering: 'server',
    outputDir: '.',
    wellSupportedOn: ['wordpress', 'wordpress-elementor'],
    manualSetupUrl: 'https://developer.wordpress.org/themes/getting-started/',
  },
  {
    id: 'custom',
    label: 'Something else',
    description: 'A stack AtlasMind does not have a verified setup command for. Everything else on this page still works.',
    rendering: 'hybrid',
    outputDir: 'dist',
    wellSupportedOn: [],
  },
];

const FRAMEWORKS_BY_ID = new Map<WebsiteFrameworkId, WebsiteFrameworkSpec>(
  WEBSITE_FRAMEWORK_CATALOG.map(spec => [spec.id, spec]),
);

const FRAMEWORK_IDS = new Set<WebsiteFrameworkId>(WEBSITE_FRAMEWORK_CATALOG.map(spec => spec.id));

export function isWebsiteFrameworkId(value: unknown): value is WebsiteFrameworkId {
  return typeof value === 'string' && FRAMEWORK_IDS.has(value as WebsiteFrameworkId);
}

/**
 * Look up a spec, falling back to `custom`.
 *
 * `custom` is the right fallback rather than a throw: it carries no scaffold
 * command, so an unrecognised id degrades into "we will not run anything for
 * you", which is the safe direction.
 */
export function websiteFrameworkSpec(id: WebsiteFrameworkId): WebsiteFrameworkSpec {
  return FRAMEWORKS_BY_ID.get(id) ?? FRAMEWORKS_BY_ID.get('custom')!;
}

// ── Compatibility ────────────────────────────────────────────────

export type StackCompatibility = 'ideal' | 'workable' | 'unsupported';

export interface StackCompatibilityVerdict {
  compatibility: StackCompatibility;
  /** A sentence naming why, shown on the badge. Never empty. */
  reason: string;
}

/**
 * Platforms that serve their own templating and cannot host a built static
 * bundle. Declared rather than inferred, because "can this framework deploy
 * here" is a fact about the platform's model, not something to guess from a name.
 */
const OWN_TEMPLATE_SYSTEM: Partial<Record<WebsitePlatformId, string>> = {
  shopify: 'Shopify serves Liquid templates from its own theme system, so a separate build has nowhere to go.',
  webflow: 'Webflow hosts sites built in Webflow; it does not deploy a repository you built elsewhere.',
  wordpress: 'WordPress serves PHP themes, so a JavaScript build output is not what it runs.',
  'wordpress-elementor': 'WordPress with Elementor serves PHP themes and page-builder content, not a separate build output.',
};

/** Platforms that only serve pre-built files, with no server or edge runtime. */
const STATIC_ONLY: readonly WebsitePlatformId[] = ['github-pages'];

/**
 * Grade a framework/platform pairing.
 *
 * Root-cause first: the platform having its own template system is a more
 * fundamental mismatch than the framework needing a server, so it is checked
 * first and reported instead of the vaguer answer.
 */
export function describeStackCompatibility(
  frameworkId: WebsiteFrameworkId,
  platformId: WebsitePlatformId,
): StackCompatibilityVerdict {
  const spec = websiteFrameworkSpec(frameworkId);

  if (platformId === 'custom') {
    return {
      compatibility: 'workable',
      reason: 'A self-hosted or specialist platform. AtlasMind cannot check the pairing, so the deploy step is yours to describe.',
    };
  }

  const ownTemplates = OWN_TEMPLATE_SYSTEM[platformId];
  if (ownTemplates) {
    // The theme frameworks are the exception: they are *built for* these hosts.
    if (spec.wellSupportedOn.includes(platformId)) {
      return { compatibility: 'ideal', reason: `${spec.label} targets this platform directly.` };
    }
    return { compatibility: 'unsupported', reason: ownTemplates };
  }

  if (spec.id === 'wordpress-theme') {
    return {
      compatibility: 'unsupported',
      reason: 'A WordPress theme needs a WordPress host. Choose WordPress, or pick a different framework.',
    };
  }

  if (STATIC_ONLY.includes(platformId) && spec.rendering === 'server') {
    return {
      compatibility: 'unsupported',
      reason: `${spec.label} needs a server or edge runtime, and this platform only serves pre-built files. A statically exported build can work, but the default configuration will not.`,
    };
  }

  if (spec.wellSupportedOn.includes(platformId)) {
    return { compatibility: 'ideal', reason: `${spec.label} deploys to this platform with no extra configuration.` };
  }

  if (spec.id === 'custom') {
    return {
      compatibility: 'workable',
      reason: 'AtlasMind has no verified setup for this stack, so the build and deploy steps are yours to supply.',
    };
  }

  return {
    compatibility: 'workable',
    reason: `${spec.label} can deploy here, but it is not a pairing AtlasMind has a verified configuration for — expect to adjust the build command or output directory.`,
  };
}

/** Frameworks graded `ideal` for a platform, in catalog order. Drives the "recommended" grouping. */
export function frameworksRecommendedFor(platformId: WebsitePlatformId): WebsiteFrameworkSpec[] {
  return WEBSITE_FRAMEWORK_CATALOG.filter(spec =>
    describeStackCompatibility(spec.id, platformId).compatibility === 'ideal');
}

// ── Commands ─────────────────────────────────────────────────────

/** Package managers a project may be set up with. */
export type WebsitePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export const WEBSITE_PACKAGE_MANAGERS: readonly WebsitePackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

export function isWebsitePackageManager(value: unknown): value is WebsitePackageManager {
  return typeof value === 'string' && (WEBSITE_PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * Rewrite an npm-shaped invocation for another package manager.
 *
 * Only the leading executable and the `run`/`exec` verbs move; the rest of the
 * argument list is passed through untouched. Deliberately narrow — a general
 * translation layer would need to understand each manager's flag differences,
 * and getting that subtly wrong produces a command that runs and does something
 * else.
 */
export function forPackageManager(
  args: readonly string[],
  manager: WebsitePackageManager,
): { command: string; args: string[] } {
  const rest = [...args];

  if (manager === 'npm') {
    return { command: 'npm', args: rest };
  }

  // `yarn run build` and `yarn build` are both valid; `pnpm` and `bun` follow
  // npm's shape closely enough that only the executable changes.
  if (manager === 'bun' && rest[0] === 'exec') {
    return { command: 'bunx', args: rest.slice(1) };
  }
  if (manager === 'pnpm' && rest[0] === 'exec') {
    return { command: 'pnpm', args: rest };
  }
  if (manager === 'yarn' && rest[0] === 'exec') {
    return { command: 'yarn', args: rest.slice(1) };
  }
  return { command: manager, args: rest };
}

/** The dev-server command for a framework, or undefined when it has none. */
export function devCommandFor(
  spec: WebsiteFrameworkSpec,
  manager: WebsitePackageManager,
): { command: string; args: string[] } | undefined {
  if (!spec.devCommand) {
    return undefined;
  }
  // Hugo is not a Node project; its commands run against its own binary.
  if (spec.scaffold?.runtime === 'go') {
    return { command: 'hugo', args: [...spec.devCommand] };
  }
  return forPackageManager(spec.devCommand, manager);
}

/** The production build command, or undefined when the framework has no build step. */
export function buildCommandFor(
  spec: WebsiteFrameworkSpec,
  manager: WebsitePackageManager,
): { command: string; args: string[] } | undefined {
  if (!spec.buildCommand) {
    return undefined;
  }
  if (spec.scaffold?.runtime === 'go') {
    return { command: 'hugo', args: [...spec.buildCommand] };
  }
  if (spec.buildCommand.length === 0) {
    return undefined;
  }
  return forPackageManager(spec.buildCommand, manager);
}

/**
 * The build command as one string, for a CI file or a human to read.
 *
 * Only ever rendered into generated YAML after `websiteCiTemplate` has validated
 * every part, and only ever *displayed* elsewhere — nothing joins a command back
 * into a string and then executes it.
 */
export function renderCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ');
}

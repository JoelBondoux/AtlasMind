/**
 * Turning a stack choice into a working project — planned first, run second.
 *
 * The shape is `acpInstaller.ts`'s, deliberately: **planning performs nothing.**
 * `planWebsiteStackSetup` returns an ordered list of steps, every command and
 * every file's full contents visible, and a separate call executes it after the
 * user has read a modal built from that list. Two calls rather than one is what
 * makes the confirmation meaningful — a plan that could execute as a side effect
 * of being built is a plan nobody can review.
 *
 * Four properties hold, and each is checkable rather than asserted:
 *
 * **No step ever runs a shell.** Every executable step is `execFile(command,
 * args)`. Commands come from `websiteFrameworks`' constants or from
 * `mcpRuntime`'s runtime installer; the only thing this file contributes is the
 * project directory, validated first. A test walks every producible plan and
 * fails on a shell metacharacter in any argument.
 *
 * **No step writes outside the workspace.** File steps carry a workspace-relative
 * path that is validated here and re-resolved against the root at write time.
 * The writer is injected, so a test can fail the run if it is ever handed an
 * escaping path — the same reason `websiteGenerationRunner` injects its writer.
 *
 * **Everything that could destroy work is create-only.** A config file, a
 * `package.json` script, a branch, a workflow: if it already exists it is
 * reported untouched, never merged and never replaced. A scaffolder that
 * overwrites is a scaffolder you can only safely run once, which makes it
 * useless for the case it exists for — coming back to a half-set-up project.
 *
 * **Anything touching a remote account is `manual` unless explicitly allowed.**
 * `wrangler pages project create` and its equivalents authenticate as the user
 * and create billable resources; a half-finished run leaves them orphaned on
 * somebody's account with no teardown. They are quoted with their purpose, and
 * only become runnable behind their own setting.
 *
 * Pure apart from the injected `exec`/`write`/`probe`; `vscode`-free and
 * unit-tested.
 */

import * as path from 'node:path';
import type { WebsiteHostingEnvironment, WebsitePlatformId } from '../types.js';
import {
  buildCommandFor,
  devCommandFor,
  renderCommandLine,
  websiteFrameworkSpec,
  type WebsiteFrameworkId,
  type WebsitePackageManager,
} from './websiteFrameworks.js';
import {
  renderWebsiteCiWorkflow,
  type CiSecretRequirement,
} from './websiteCiTemplate.js';

export type StackSetupStepKind =
  | 'runtime'
  | 'scaffold'
  | 'config-file'
  | 'scripts'
  | 'env-example'
  | 'branches'
  | 'ci'
  | 'manual';

export interface StackSetupStep {
  id: string;
  kind: StackSetupStepKind;
  /** What this step is for, in one sentence. Shown next to it in the modal. */
  purpose: string;
  /** Present on executable steps. `execFile` arguments — never a shell string. */
  command?: string;
  args?: readonly string[];
  /** Present on file steps. Workspace-relative, forward-slashed, validated. */
  filePath?: string;
  contents?: string;
  /**
   * True when an existing file or branch means this step is skipped rather than
   * applied. Every file and branch step sets it.
   */
  createOnly?: boolean;
  /**
   * True when AtlasMind will not run this itself. The command is shown for the
   * user to run, with the reason in `purpose`.
   */
  manualOnly?: boolean;
}

export interface StackSetupPlan {
  frameworkId: WebsiteFrameworkId;
  platformId: WebsitePlatformId;
  packageManager: WebsitePackageManager;
  steps: StackSetupStep[];
  /** Repository secrets the user must add before CI can run. Names only. */
  requiredSecrets: CiSecretRequirement[];
  /** What this setup does not do. Stated with the plan, not discovered after it. */
  caveats: string[];
}

export type StackSetupPlanResult =
  | { ok: true; plan: StackSetupPlan }
  | { ok: false; reason: string };

/** What is already on the machine and in the workspace. Gathered by the caller. */
export interface StackSetupProbe {
  /** Node is on PATH. */
  hasNode: boolean;
  /** The Hugo binary is on PATH. */
  hasHugo: boolean;
  /** The workspace already has a package.json. */
  hasPackageJson: boolean;
  /** Workspace-relative paths that already exist. Drives every create-only decision. */
  existingPaths: readonly string[];
  /** Branches that already exist locally. */
  existingBranches: readonly string[];
}

export interface StackSetupOptions {
  frameworkId: WebsiteFrameworkId;
  platformId: WebsitePlatformId;
  packageManager: WebsitePackageManager;
  environments: readonly WebsiteHostingEnvironment[];
  probe: StackSetupProbe;
  /** `atlasmind.website.setup.generateCi`. Off by default. */
  generateCi: boolean;
  /** `atlasmind.website.setup.allowRemoteProjectCreation`. Off by default. */
  allowRemoteProjectCreation: boolean;
}

// ── Planning ─────────────────────────────────────────────────────

export function planWebsiteStackSetup(options: StackSetupOptions): StackSetupPlanResult {
  const spec = websiteFrameworkSpec(options.frameworkId);
  const existing = new Set(options.probe.existingPaths);
  const steps: StackSetupStep[] = [];
  const caveats: string[] = [];
  let requiredSecrets: CiSecretRequirement[] = [];

  // 1. Runtime. Nothing else can run without it, so it goes first and its
  //    absence is a blocker rather than a warning.
  if (spec.scaffold?.runtime === 'node' && !options.probe.hasNode) {
    steps.push({
      id: 'runtime-node',
      kind: 'runtime',
      purpose: 'Install Node.js, which this framework needs before anything else can run.',
      manualOnly: true,
      command: 'node',
      args: ['--version'],
    });
    caveats.push('Node.js was not found on PATH. Install it first — the remaining steps assume it.');
  }
  if (spec.scaffold?.runtime === 'go' && !options.probe.hasHugo) {
    steps.push({
      id: 'runtime-hugo',
      kind: 'runtime',
      purpose: 'Install the Hugo binary, which this framework needs before anything else can run.',
      manualOnly: true,
      command: 'hugo',
      args: ['version'],
    });
    caveats.push('The Hugo binary was not found on PATH. Install it first — the remaining steps assume it.');
  }

  // 2. Scaffold, only when the framework has a verified command and the project
  //    is not already set up.
  if (spec.scaffold) {
    if (options.probe.hasPackageJson && spec.scaffold.runtime === 'node') {
      caveats.push('This workspace already has a package.json, so the framework scaffold was skipped — it would overwrite the project you already have.');
    } else {
      steps.push({
        id: 'scaffold',
        kind: 'scaffold',
        purpose: `Create a new ${spec.label} project using its own official command.`,
        command: spec.scaffold.command,
        args: [...spec.scaffold.args],
      });
    }
  } else {
    caveats.push(`AtlasMind has no verified setup command for ${spec.label}, so nothing is scaffolded. Everything else on this plan still applies.`);
    if (spec.manualSetupUrl) {
      steps.push({
        id: 'scaffold-manual',
        kind: 'manual',
        purpose: `Set ${spec.label} up by following its own documentation: ${spec.manualSetupUrl}`,
        manualOnly: true,
      });
    }
  }

  // 3. The platform's deploy config.
  const configFile = platformConfigFile(options.platformId, spec.outputDir, spec.id);
  if (configFile) {
    steps.push({
      id: `config-${configFile.filePath}`,
      kind: 'config-file',
      purpose: `Tell ${platformLabel(options.platformId)} where the built site lands.`,
      filePath: configFile.filePath,
      contents: configFile.contents,
      createOnly: true,
    });
    if (existing.has(configFile.filePath)) {
      caveats.push(`${configFile.filePath} already exists and will be left exactly as it is.`);
    }
  }

  // 4. package.json scripts, for Node projects only.
  if (spec.scaffold?.runtime === 'node' || options.probe.hasPackageJson) {
    const dev = devCommandFor(spec, options.packageManager);
    const build = buildCommandFor(spec, options.packageManager);
    if (dev || build) {
      steps.push({
        id: 'scripts',
        kind: 'scripts',
        purpose: 'Add dev and build scripts to package.json, without touching any script you already have.',
        filePath: 'package.json',
        createOnly: true,
        contents: JSON.stringify(
          {
            ...(dev ? { dev: renderCommandLine(dev.command, dev.args) } : {}),
            ...(build ? { build: renderCommandLine(build.command, build.args) } : {}),
          },
          null,
          2,
        ),
      });
    }
  }

  // 5. One .env.example per environment — names only.
  const envStep = buildEnvExample(options.environments);
  if (envStep) {
    steps.push(envStep);
    if (existing.has(envStep.filePath!)) {
      caveats.push(`${envStep.filePath} already exists and will be left exactly as it is.`);
    }
  }

  // 6. Branches for the three stages.
  const branchStep = buildBranchStep(options.environments, options.probe.existingBranches);
  if (branchStep) {
    steps.push(branchStep);
  }

  // 7. CI. Gated separately because this is the artefact that acts on its own.
  if (options.generateCi) {
    const branches = branchNames(options.environments);
    const workflow = renderWebsiteCiWorkflow({
      frameworkId: options.frameworkId,
      platformId: options.platformId,
      packageManager: options.packageManager,
      developBranch: branches.develop,
      stagingBranch: branches.staging,
      productionBranch: branches.production,
    });
    if (workflow.ok) {
      steps.push({
        id: 'ci',
        kind: 'ci',
        purpose: 'Create the GitHub Actions workflow that builds and deploys each branch to its environment.',
        filePath: workflow.filePath,
        contents: workflow.contents,
        createOnly: true,
      });
      requiredSecrets = workflow.requiredSecrets;
      caveats.push(...workflow.caveats);
      if (existing.has(workflow.filePath)) {
        caveats.push(`${workflow.filePath} already exists and will be left exactly as it is — an existing deploy pipeline is never replaced.`);
      }
    } else {
      caveats.push(`No CI workflow was generated: ${workflow.reason}`);
    }
  } else {
    caveats.push('CI generation is off, so no deploy workflow was planned. Turn on atlasmind.website.setup.generateCi to include one.');
  }

  // 8. Remote project creation — manual unless explicitly allowed.
  const remote = remoteProjectCommand(options.platformId);
  if (remote) {
    steps.push({
      id: 'remote-project',
      kind: 'manual',
      purpose: options.allowRemoteProjectCreation
        ? `Create the hosting project on ${platformLabel(options.platformId)}. This authenticates as you and creates real resources on your account.`
        : `Create the hosting project on ${platformLabel(options.platformId)}. Run this yourself — AtlasMind will not, because it authenticates as you and creates billable resources.`,
      command: remote.command,
      args: remote.args,
      manualOnly: !options.allowRemoteProjectCreation,
    });
  }

  if (steps.length === 0) {
    return { ok: false, reason: 'There is nothing to set up for this combination — the project already has everything this plan would create.' };
  }

  // Every executable step is validated before the plan is returned, so an
  // unsafe step can never reach the modal, let alone the executor.
  for (const step of steps) {
    const problem = validateStep(step);
    if (problem) {
      return { ok: false, reason: `Refusing to plan setup: ${problem} (step "${step.id}")` };
    }
  }

  return {
    ok: true,
    plan: {
      frameworkId: options.frameworkId,
      platformId: options.platformId,
      packageManager: options.packageManager,
      steps,
      requiredSecrets,
      caveats,
    },
  };
}

// ── Step builders ────────────────────────────────────────────────

function platformConfigFile(
  platformId: WebsitePlatformId,
  outputDir: string,
  frameworkId: WebsiteFrameworkId,
): { filePath: string; contents: string } | undefined {
  switch (platformId) {
    case 'cloudflare-pages':
      return {
        filePath: 'wrangler.toml',
        contents: `# Generated by AtlasMind Website Studio.\n`
          + `# pages_build_output_dir tells Cloudflare Pages where the built site is.\n`
          + `pages_build_output_dir = "${outputDir}"\n`,
      };
    case 'netlify':
      return {
        filePath: 'netlify.toml',
        contents: `# Generated by AtlasMind Website Studio.\n[build]\n  publish = "${outputDir}"\n`,
      };
    case 'vercel':
      return {
        filePath: 'vercel.json',
        contents: `${JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', outputDirectory: outputDir }, null, 2)}\n`,
      };
    case 'azure-static-web-apps':
      return {
        filePath: 'staticwebapp.config.json',
        contents: `${JSON.stringify({ navigationFallback: { rewrite: '/index.html' } }, null, 2)}\n`,
      };
    case 'github-pages':
      // A `.nojekyll` file is the one thing GitHub Pages genuinely needs for a
      // built site: without it, Jekyll silently drops directories beginning with
      // an underscore, which several frameworks emit.
      return frameworkId === 'static'
        ? undefined
        : { filePath: `${outputDir}/.nojekyll`, contents: '' };
    default:
      return undefined;
  }
}

function buildEnvExample(environments: readonly WebsiteHostingEnvironment[]): StackSetupStep | undefined {
  if (environments.length === 0) {
    return undefined;
  }
  const lines = [
    '# Generated by AtlasMind Website Studio.',
    '# Variable NAMES only. Never commit a value here — this file is tracked.',
    '',
  ];
  for (const environment of environments) {
    lines.push(`# ${environment.name} — ${environment.accessPolicy}`);
    lines.push(`SITE_URL_${environment.id.toUpperCase()}=`);
    if (environment.credentialReference) {
      // The *reference* is echoed as a comment so the file records where the
      // value lives, without the value itself ever being near it.
      lines.push(`# password reference: ${environment.credentialReference}`);
    }
    lines.push('');
  }
  return {
    id: 'env-example',
    kind: 'env-example',
    purpose: 'Record the per-environment variable names, with no values.',
    filePath: '.env.example',
    contents: `${lines.join('\n').trimEnd()}\n`,
    createOnly: true,
  };
}

function buildBranchStep(
  environments: readonly WebsiteHostingEnvironment[],
  existingBranches: readonly string[],
): StackSetupStep | undefined {
  const existing = new Set(existingBranches);
  const wanted = Object.values(branchNames(environments)).filter(name => !existing.has(name));
  if (wanted.length === 0) {
    return undefined;
  }
  return {
    id: 'branches',
    kind: 'branches',
    purpose: `Create the ${wanted.join(', ')} branch${wanted.length === 1 ? '' : 'es'} locally. Nothing is pushed.`,
    command: 'git',
    // `branch` only: never checkout, never push, never force. Creating a branch
    // cannot lose work; the other three can.
    args: ['branch', ...wanted],
    createOnly: true,
  };
}

/**
 * The branch each stage maps to.
 *
 * Read from the environment's own `branchReference` where it has one, so the
 * Studio's recorded intent wins over a default. The fallbacks are the
 * conventional names, and they are sanitized because they can reach a git
 * command and a YAML file.
 */
function branchNames(environments: readonly WebsiteHostingEnvironment[]): {
  develop: string;
  staging: string;
  production: string;
} {
  const find = (id: string, fallback: string): string => {
    const declared = environments.find(environment => environment.id === id)?.branchReference?.trim();
    return declared && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,98}$/.test(declared) ? declared : fallback;
  };
  return {
    develop: find('develop', 'develop'),
    staging: find('staging', 'staging'),
    production: find('production', 'main'),
  };
}

function remoteProjectCommand(platformId: WebsitePlatformId): { command: string; args: string[] } | undefined {
  switch (platformId) {
    case 'cloudflare-pages':
      return { command: 'npx', args: ['wrangler', 'pages', 'project', 'create'] };
    case 'netlify':
      return { command: 'npx', args: ['netlify', 'sites:create'] };
    case 'vercel':
      return { command: 'npx', args: ['vercel', 'link'] };
    default:
      return undefined;
  }
}

function platformLabel(platformId: WebsitePlatformId): string {
  return platformId
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// ── Validation ───────────────────────────────────────────────────

/** Characters that would turn an argument into something else if a shell ever saw it. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._][A-Za-z0-9._\/-]{0,180}$/;

/**
 * Everything a step must be before it can be shown, let alone run.
 *
 * These are belt-and-braces: every command in a producible plan comes from a
 * module constant, so none of this should ever fire. It fires anyway if somebody
 * later adds a step built from input, which is exactly when it is needed.
 */
export function validateStep(step: StackSetupStep): string | undefined {
  if (step.command !== undefined) {
    if (step.command.length === 0 || SHELL_METACHARACTERS.test(step.command)) {
      return 'the command is empty or contains shell metacharacters';
    }
    for (const arg of step.args ?? []) {
      if (SHELL_METACHARACTERS.test(arg)) {
        return `the argument "${arg}" contains shell metacharacters`;
      }
    }
  }
  if (step.filePath !== undefined) {
    const problem = validateSetupPath(step.filePath);
    if (problem) {
      return problem;
    }
  }
  return undefined;
}

/** A workspace-relative path a setup step may write. */
export function validateSetupPath(relativePath: string): string | undefined {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return 'the path is empty';
  }
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized !== relativePath) {
    return 'the path must be forward-slashed';
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return 'the path must be relative to the workspace';
  }
  if (normalized.split('/').some(segment => segment === '..' || segment === '.')) {
    return 'the path must not navigate outside the workspace';
  }
  if (!SAFE_RELATIVE_PATH.test(normalized)) {
    return 'the path may only use letters, digits, dot, dash, underscore and slash';
  }
  return undefined;
}

// ── Execution ────────────────────────────────────────────────────

export type StackStepOutcome = 'applied' | 'skipped-exists' | 'manual' | 'failed';

export interface StackStepResult {
  stepId: string;
  outcome: StackStepOutcome;
  /** Present on a failure, or on a skip explaining what was already there. */
  detail?: string;
}

export interface StackSetupRunResult {
  results: StackStepResult[];
  /** True when every step either applied or was deliberately skipped. */
  completed: boolean;
}

export interface StackSetupExecution {
  plan: StackSetupPlan;
  workspaceRoot: string;
  /** `execFile`-shaped. Injected so no test spawns a process. */
  exec: (command: string, args: string[], cwd: string) => Promise<void>;
  /** Injected so a test can fail the run on an escaping path. */
  writeFileIfAbsent: (absolutePath: string, contents: string) => Promise<'written' | 'exists'>;
  /** Merge scripts into an existing package.json without touching existing keys. */
  mergePackageScripts: (absolutePath: string, scripts: Record<string, string>) => Promise<'written' | 'exists' | 'missing'>;
}

/**
 * Run a plan the user has already confirmed.
 *
 * Stops at the first genuine failure and reports what succeeded, rather than
 * pressing on — `promotionRunner`'s shape. A scaffold that failed makes every
 * later step meaningless, and a list of six consequential errors hides the one
 * that mattered.
 */
export async function executeWebsiteStackSetup(
  execution: StackSetupExecution,
): Promise<StackSetupRunResult> {
  const { plan, workspaceRoot, exec, writeFileIfAbsent, mergePackageScripts } = execution;
  const root = path.resolve(workspaceRoot);
  const results: StackStepResult[] = [];

  for (const step of plan.steps) {
    if (step.manualOnly) {
      results.push({ stepId: step.id, outcome: 'manual' });
      continue;
    }

    // Re-validated immediately before acting. The plan was validated when it was
    // built, but this is the last statement before something happens.
    const problem = validateStep(step);
    if (problem) {
      results.push({ stepId: step.id, outcome: 'failed', detail: problem });
      return { results, completed: false };
    }

    try {
      if (step.kind === 'scripts' && step.filePath && step.contents) {
        const absolute = resolveInside(root, step.filePath);
        if (!absolute) {
          results.push({ stepId: step.id, outcome: 'failed', detail: 'resolved outside the workspace' });
          return { results, completed: false };
        }
        const scripts = JSON.parse(step.contents) as Record<string, string>;
        const outcome = await mergePackageScripts(absolute, scripts);
        results.push({
          stepId: step.id,
          outcome: outcome === 'missing' ? 'skipped-exists' : outcome === 'exists' ? 'skipped-exists' : 'applied',
          ...(outcome === 'missing' ? { detail: 'no package.json to add scripts to' } : {}),
        });
        continue;
      }

      if (step.filePath !== undefined && step.contents !== undefined) {
        const absolute = resolveInside(root, step.filePath);
        if (!absolute) {
          results.push({ stepId: step.id, outcome: 'failed', detail: 'resolved outside the workspace' });
          return { results, completed: false };
        }
        const outcome = await writeFileIfAbsent(absolute, step.contents);
        results.push({
          stepId: step.id,
          outcome: outcome === 'exists' ? 'skipped-exists' : 'applied',
          ...(outcome === 'exists' ? { detail: `${step.filePath} already exists and was left untouched` } : {}),
        });
        continue;
      }

      if (step.command) {
        await exec(step.command, [...(step.args ?? [])], root);
        results.push({ stepId: step.id, outcome: 'applied' });
        continue;
      }

      results.push({ stepId: step.id, outcome: 'manual' });
    } catch (error) {
      results.push({
        stepId: step.id,
        outcome: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      return { results, completed: false };
    }
  }

  return { results, completed: true };
}

/**
 * Resolve a relative path inside the root, or refuse.
 *
 * `path.relative` rather than a prefix test, for the reason the preview server
 * gives: a prefix test says `/work/site-evil` is inside `/work/site`.
 */
function resolveInside(root: string, relativePath: string): string | undefined {
  const absolute = path.resolve(root, relativePath);
  const relation = path.relative(root, absolute);
  return relation.startsWith('..') || path.isAbsolute(relation) ? undefined : absolute;
}

/** A sentence describing the run, naming every non-ideal outcome. */
export function describeStackSetupRun(result: StackSetupRunResult): string {
  const applied = result.results.filter(item => item.outcome === 'applied').length;
  const skipped = result.results.filter(item => item.outcome === 'skipped-exists').length;
  const manual = result.results.filter(item => item.outcome === 'manual').length;
  const failed = result.results.find(item => item.outcome === 'failed');

  if (failed) {
    return `Setup stopped at "${failed.stepId}": ${failed.detail ?? 'the step failed'}. `
      + `${applied} step${applied === 1 ? '' : 's'} had already completed and ${applied === 1 ? 'was' : 'were'} left in place.`;
  }

  const parts = [`Applied ${applied} step${applied === 1 ? '' : 's'}.`];
  if (skipped > 0) {
    parts.push(`${skipped} were already present and left untouched.`);
  }
  if (manual > 0) {
    parts.push(`${manual} need running by you — see the setup summary.`);
  }
  return parts.join(' ');
}

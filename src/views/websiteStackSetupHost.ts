/**
 * The host side of **Set up this stack**: probe the machine, build the plan,
 * show it in full, run it, and re-probe.
 *
 * Everything dangerous is in `websiteStackSetup.ts` and `websiteCiTemplate.ts`,
 * which are pure and tested. This file is the part that touches the world, and
 * it is deliberately thin: gather facts, show a modal, hand the plan to the
 * executor with a real `execFile` and a create-only writer.
 *
 * Two things it does that the pure modules cannot:
 *
 * **The modal shows every command and every file in full.** Not a count, not a
 * summary — the actual argument lists and the actual file contents, including
 * the whole CI workflow. A confirmation nobody can read is a confirmation that
 * only launders responsibility.
 *
 * **Success is re-probed, never inferred from exit codes.** A scaffold command
 * can exit zero having done nothing useful. `acpInstaller` learned this; the
 * report here comes from looking at the filesystem afterwards.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileAsync } from '../mcp/mcpRuntime.js';
import type { WebsiteWorkspaceConfig } from '../types.js';
import {
  isWebsitePackageManager,
  websiteFrameworkSpec,
  type WebsiteFrameworkId,
  type WebsitePackageManager,
} from '../core/websiteFrameworks.js';
import {
  describeStackSetupRun,
  executeWebsiteStackSetup,
  planWebsiteStackSetup,
  type StackSetupPlan,
  type StackSetupProbe,
} from '../core/websiteStackSetup.js';
import { CI_WORKFLOW_DIR, CI_WORKFLOW_FILENAME } from '../core/websiteCiTemplate.js';
import { resolveWorkflowNodeVersion } from '../core/nodeVersionDetection.js';

/** Paths the planner asks about. Probed up front so create-only decisions are made from facts. */
const PROBED_PATHS: readonly string[] = [
  'package.json',
  'wrangler.toml',
  'netlify.toml',
  'vercel.json',
  'staticwebapp.config.json',
  '.env.example',
  `${CI_WORKFLOW_DIR}/${CI_WORKFLOW_FILENAME}`,
];

export async function setUpWebsiteStack(config: WebsiteWorkspaceConfig): Promise<void> {
  const settings = vscode.workspace.getConfiguration('atlasmind');
  if (!settings.get<boolean>('website.setup.enabled', false)) {
    void vscode.window.showErrorMessage(
      'Website stack setup is off. Turn on atlasmind.website.setup.enabled to use it.',
    );
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('Open a workspace folder before setting up a website stack.');
    return;
  }

  if (!config.stack) {
    void vscode.window.showErrorMessage('Choose a framework on the Stack page first.');
    return;
  }

  const probe = await probeWorkspace(workspaceRoot);
  const packageManager: WebsitePackageManager = isWebsitePackageManager(config.stack.packageManager)
    ? config.stack.packageManager
    : 'npm';

  const planned = planWebsiteStackSetup({
    frameworkId: config.stack.frameworkId as WebsiteFrameworkId,
    platformId: config.stack.platformId,
    packageManager,
    environments: config.hostingEnvironments,
    probe,
    generateCi: settings.get<boolean>('website.setup.generateCi', false),
    // A project being scaffolded has nothing to detect from, so the workflow
    // pins the major this machine builds with rather than a constant that ages.
    nodeVersion: resolveWorkflowNodeVersion({ runtimeVersion: process.versions.node }).version,
    allowRemoteProjectCreation: settings.get<boolean>('website.setup.allowRemoteProjectCreation', false),
  });

  if (!planned.ok) {
    void vscode.window.showWarningMessage(planned.reason);
    return;
  }

  const confirmed = await confirmSetup(planned.plan, workspaceRoot);
  if (!confirmed) {
    void vscode.window.showInformationMessage('Setup cancelled. Nothing was run and nothing was written.');
    return;
  }

  const runResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Setting up the website stack…', cancellable: false },
    async progress => executeWebsiteStackSetup({
      plan: planned.plan,
      workspaceRoot,
      exec: async (command, args, cwd) => {
        progress.report({ message: `${command} ${args.slice(0, 3).join(' ')}` });
        await execFileInDirectory(command, args, cwd);
      },
      writeFileIfAbsent: async (absolutePath, contents) => {
        if (existsSync(absolutePath)) {
          return 'exists';
        }
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, contents, 'utf8');
        return 'written';
      },
      mergePackageScripts,
    }),
  );

  // Re-probed rather than trusted: a scaffold can exit zero having done nothing.
  const after = await probeWorkspace(workspaceRoot);
  const summary = describeStackSetupRun(runResult);
  const verified = verifyOutcome(planned.plan, after);

  const message = [summary, ...verified].join(' ');
  if (runResult.completed) {
    void vscode.window.showInformationMessage(message);
  } else {
    void vscode.window.showErrorMessage(message);
  }

  if (planned.plan.requiredSecrets.length > 0) {
    void vscode.window.showWarningMessage(
      `The generated workflow needs ${planned.plan.requiredSecrets.length} repository secret(s) before it can run: `
      + planned.plan.requiredSecrets.map(secret => secret.name).join(', ')
      + '. AtlasMind never writes a secret value — add them in the repository settings.',
    );
  }
}

/**
 * Run a setup command in the workspace.
 *
 * `execFile` with an argument array and `shell` left at its default of false —
 * no shell ever sees these strings, so an argument cannot become a second
 * command. `mcpRuntime.execFileAsync` does the same thing but has no `cwd`, and
 * scaffold commands must run in the project directory rather than wherever the
 * extension host happens to be.
 *
 * The timeout is generous: `npm create astro` fetches a package tree, and a slow
 * connection is not a failure.
 */
function execFileInDirectory(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd, windowsHide: true, timeout: SETUP_STEP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error([error.message, stderr, stdout].filter(Boolean).join('\n').trim()));
          return;
        }
        resolve();
      },
    );
  });
}

const SETUP_STEP_TIMEOUT_MS = 5 * 60 * 1000;

async function probeWorkspace(workspaceRoot: string): Promise<StackSetupProbe> {
  const existingPaths = PROBED_PATHS.filter(candidate => existsSync(path.join(workspaceRoot, candidate)));

  return {
    hasNode: await isOnPath('node', ['--version']),
    hasHugo: await isOnPath('hugo', ['version']),
    hasPackageJson: existingPaths.includes('package.json'),
    existingPaths,
    existingBranches: await listLocalBranches(workspaceRoot),
  };
}

/** Presence is checked by running the tool's own version flag — the only reliable answer. */
async function isOnPath(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
}

async function listLocalBranches(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspaceRoot, 'branch', '--format=%(refname:short)']);
    return stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  } catch {
    // Not a git repository, or git is absent. Either way the branch step will be
    // planned and simply fail visibly rather than being silently skipped.
    return [];
  }
}

/**
 * Add scripts to package.json without touching one that is already set.
 *
 * Reads and rewrites rather than templating, so formatting and every other field
 * survive. A key that already exists is left exactly as it is — somebody chose
 * that command, and a scaffolder overwriting it is the reason people stop
 * trusting scaffolders.
 */
async function mergePackageScripts(
  absolutePath: string,
  scripts: Record<string, string>,
): Promise<'written' | 'exists' | 'missing'> {
  if (!existsSync(absolutePath)) {
    return 'missing';
  }
  const raw = await readFile(absolutePath, 'utf8');
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A package.json we cannot parse is one we must not rewrite.
    return 'exists';
  }
  const existing = (typeof parsed['scripts'] === 'object' && parsed['scripts'] !== null)
    ? parsed['scripts'] as Record<string, string>
    : {};

  const added: Record<string, string> = {};
  for (const [name, command] of Object.entries(scripts)) {
    if (existing[name] === undefined) {
      added[name] = command;
    }
  }
  if (Object.keys(added).length === 0) {
    return 'exists';
  }

  parsed['scripts'] = { ...existing, ...added };
  await writeFile(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return 'written';
}

/**
 * What the filesystem says afterwards.
 *
 * Reported alongside the run summary, so "the command exited zero" and "the file
 * is there" stay two separate facts.
 */
function verifyOutcome(plan: StackSetupPlan, after: StackSetupProbe): string[] {
  const expected = plan.steps
    .map(step => step.filePath)
    .filter((candidate): candidate is string => typeof candidate === 'string');
  const missing = expected.filter(candidate => !after.existingPaths.includes(candidate) && PROBED_PATHS.includes(candidate));
  return missing.length > 0
    ? [`Checked afterwards: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} still not present.`]
    : [];
}

/**
 * The confirmation.
 *
 * Every command with its arguments, every file with its full contents. Long, on
 * purpose: this runs commands and writes into `.github/workflows/`, and the
 * whole point of the two-call design is that there is something real to read
 * here.
 */
async function confirmSetup(plan: StackSetupPlan, workspaceRoot: string): Promise<boolean> {
  const spec = websiteFrameworkSpec(plan.frameworkId as WebsiteFrameworkId);
  const lines: string[] = [];

  for (const step of plan.steps) {
    const marker = step.manualOnly ? 'YOU RUN' : step.createOnly ? 'IF ABSENT' : 'RUN';
    lines.push(`[${marker}] ${step.purpose}`);
    if (step.command) {
      lines.push(`    ${step.command} ${(step.args ?? []).join(' ')}`);
    }
    if (step.filePath) {
      lines.push(`    ${step.filePath}`);
    }
    lines.push('');
  }

  const secrets = plan.requiredSecrets.length > 0
    ? `\n\nRepository secrets you must add (no value is ever written by AtlasMind):\n`
      + plan.requiredSecrets.map(secret => `  • ${secret.name} — ${secret.purpose}`).join('\n')
    : '';

  const caveats = plan.caveats.length > 0
    ? `\n\nWorth knowing:\n${plan.caveats.map(caveat => `  • ${caveat}`).join('\n')}`
    : '';

  const answer = await vscode.window.showWarningMessage(
    `Set up ${spec.label} in ${path.basename(workspaceRoot)}?`,
    {
      modal: true,
      detail: `${lines.join('\n').trimEnd()}`
        + `\n\nFiles marked IF ABSENT are never overwritten. Commands run directly, with no shell.`
        + `${secrets}${caveats}`,
    },
    'Set up',
    'Show files first',
  );

  if (answer === 'Show files first') {
    // Opened as untitled documents rather than summarised: a workflow file is
    // the one artefact that acts on its own, and it should be readable in full
    // before it exists.
    for (const step of plan.steps) {
      if (step.filePath && step.contents) {
        const document = await vscode.workspace.openTextDocument({
          content: `# ${step.filePath}\n\n${step.contents}`,
          language: step.filePath.endsWith('.yml') ? 'yaml' : 'plaintext',
        });
        await vscode.window.showTextDocument(document, { preview: false });
      }
    }
    return confirmSetup(plan, workspaceRoot);
  }

  return answer === 'Set up';
}

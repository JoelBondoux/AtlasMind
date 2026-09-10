/**
 * Build the repository-side contract for reviewed pull-request local CI.
 *
 * AtlasMind owns the executor. A repository opts in by committing three small,
 * reviewable files: a command manifest, a shell-free command runner, and a
 * manually dispatched GitHub workflow. The producer of the proposed change is
 * intentionally absent from this model. Codex, Claude, another proprietary
 * agent, AtlasMind, or a human all arrive as the same immutable GitHub head SHA.
 */

import { safeWorkflowBranchRef } from './ciManager.js';
import { TRUSTED_LOCAL_CI_ACTIONS_REVIEWED } from './trustedLocalCiStarter.js';

export const REVIEWED_PR_LOCAL_CI_MARKER = 'atlasmind:reviewed-pr-local-ci:v1';
export const REVIEWED_PR_LOCAL_CI_CONFIG_PATH = '.atlasmind/local-ci.json';
export const REVIEWED_PR_LOCAL_CI_RUNNER_PATH = '.atlasmind/local-ci-runner.mjs';
export const REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH = '.github/workflows/atlasmind-reviewed-pr-local-ci.yml';
export const REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE = 'atlasmind-reviewed-pr-local-ci.yml';
export const REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT = 'AtlasMind/local-ci';

const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NODE_VERSION = /^(?:\d{1,3})(?:\.\d{1,3}){0,2}(?:\.x)?$/;
const ARCH = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,100}$/;
const OUTWARD_SCRIPT = /(?:^|[;&|]\s*|\bnpm\s+run\s+)(?:[^\n]*\b(?:publish|deploy|release)\b)|\b(?:npm|pnpm|yarn)\s+publish\b|\bvsce\s+publish\b|\bgh\s+release\b|\bdocker\s+push\b|\bkubectl\s+(?:apply|delete)\b|\bterraform\s+(?:apply|destroy)\b|\bwrangler\s+deploy\b/i;

export interface ReviewedPrLocalCiCommand {
  label: string;
  command: string;
  args: string[];
  timeoutMinutes: number;
}

export interface ReviewedPrLocalCiConfig {
  schemaVersion: 1;
  managedBy: typeof REVIEWED_PR_LOCAL_CI_MARKER;
  enabled: boolean;
  repository: string;
  trustedBaseBranch: string;
  workflowFile: typeof REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE;
  runnerLabel: string;
  statusContext: typeof REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT;
  controllerNodeVersion: string;
  evidence: 'linux-container';
  allowForks: false;
  commands: ReviewedPrLocalCiCommand[];
  detection: {
    kind: 'node' | 'custom';
    packageManager?: 'npm' | 'pnpm' | 'yarn';
    detail: string;
  };
}

export interface LocalCiRepositoryPatchInput {
  repository: string;
  trustedBaseBranch: string;
  architecture: string;
  nodeVersion: string;
  packageJsonText?: string;
  workspaceFiles: readonly string[];
}

export interface LocalCiRepositoryPatchFile {
  path: string;
  content: string;
  purpose: string;
}

export interface LocalCiRepositoryPatchPlan {
  repository: string;
  trustedBaseBranch: string;
  runnerLabel: string;
  enabled: boolean;
  detectionDetail: string;
  config: ReviewedPrLocalCiConfig;
  files: LocalCiRepositoryPatchFile[];
}

export type LocalCiRepositoryPatchOutcome =
  | { ok: true; plan: LocalCiRepositoryPatchPlan }
  | { ok: false; reason: string };

export interface LocalCiPatchTargetAssessment {
  path: string;
  state: 'create' | 'replace-managed' | 'unchanged' | 'conflict';
  reason: string;
}

interface NodeDetection {
  enabled: boolean;
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  commands: ReviewedPrLocalCiCommand[];
  detail: string;
}

function normalizeArchitecture(value: string): string | undefined {
  const raw = value.trim().toLowerCase();
  const normalized = raw === 'amd64' || raw === 'x86_64' ? 'x64'
    : raw === 'aarch64' ? 'arm64'
      : raw;
  return ARCH.test(normalized) ? normalized : undefined;
}

function safeScriptBody(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const body = value.trim();
  if (!body || OUTWARD_SCRIPT.test(body)) {
    return undefined;
  }
  return body;
}

function detectNodeCommands(packageJsonText: string | undefined, workspaceFiles: readonly string[]): NodeDetection {
  if (!packageJsonText) {
    return {
      enabled: false,
      commands: [],
      detail: 'No package.json was found. AtlasMind wrote a disabled custom contract; declare shell-free command/argument pairs before enabling it.',
    };
  }

  let parsed: { scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(packageJsonText) as { scripts?: Record<string, unknown> };
  } catch {
    return {
      enabled: false,
      commands: [],
      detail: 'package.json could not be parsed. AtlasMind wrote a disabled contract rather than guessing what to execute.',
    };
  }

  const files = new Set(workspaceFiles.map(file => file.replace(/\\/g, '/').replace(/^\.\//, '')));
  const lockfiles: Array<{ file: string; manager: 'npm' | 'pnpm' | 'yarn' }> = [
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'npm-shrinkwrap.json', manager: 'npm' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
  ];
  const detectedManagers = [...new Set(lockfiles.filter(item => files.has(item.file)).map(item => item.manager))];
  if (detectedManagers.length !== 1) {
    return {
      enabled: false,
      commands: [],
      detail: detectedManagers.length === 0
        ? 'No supported lockfile was found. The generated contract is disabled until a deterministic install is declared.'
        : `More than one package-manager lockfile was found (${detectedManagers.join(', ')}). The generated contract is disabled until one is chosen.`,
    };
  }

  const packageManager = detectedManagers[0]!;
  const scripts = parsed.scripts ?? {};
  const safeScripts = new Map<string, string>();
  for (const [name, body] of Object.entries(scripts)) {
    if (!SCRIPT_NAME.test(name)) {
      continue;
    }
    const safeBody = safeScriptBody(body);
    if (safeBody) {
      safeScripts.set(name, safeBody);
    }
  }

  const aggregate = ['ci:local', 'ci', 'verify', 'check'].find(name => safeScripts.has(name));
  const selected = aggregate
    ? [aggregate]
    : ['compile', 'build', 'lint', 'test'].filter(name => safeScripts.has(name));
  if (selected.length === 0) {
    return {
      enabled: false,
      packageManager,
      commands: [],
      detail: 'No safe ci:local, ci, verify, check, compile, build, lint, or test script was found. Publishing and deployment-shaped scripts are never selected.',
    };
  }

  const install: ReviewedPrLocalCiCommand = packageManager === 'npm'
    ? { label: 'Install locked dependencies', command: 'npm', args: ['ci'], timeoutMinutes: 20 }
    : packageManager === 'pnpm'
      ? { label: 'Install locked dependencies', command: 'corepack', args: ['pnpm', 'install', '--frozen-lockfile'], timeoutMinutes: 20 }
      : { label: 'Install locked dependencies', command: 'corepack', args: ['yarn', 'install', '--immutable'], timeoutMinutes: 20 };
  const run = (script: string): ReviewedPrLocalCiCommand => packageManager === 'npm'
    ? { label: `Run ${script}`, command: 'npm', args: ['run', script], timeoutMinutes: 45 }
    : packageManager === 'pnpm'
      ? { label: `Run ${script}`, command: 'corepack', args: ['pnpm', 'run', script], timeoutMinutes: 45 }
      : { label: `Run ${script}`, command: 'corepack', args: ['yarn', script], timeoutMinutes: 45 };

  return {
    enabled: true,
    packageManager,
    commands: [install, ...selected.map(run)],
    detail: aggregate
      ? `Detected ${packageManager} with a lockfile and the aggregate ${aggregate} script.`
      : `Detected ${packageManager} with a lockfile and selected ${selected.join(', ')} in fail-fast order.`,
  };
}

export function buildReviewedPrLocalCiRunnerScript(): string {
  return `// ${REVIEWED_PR_LOCAL_CI_MARKER}\n`
    + `// Generated by AtlasMind. The trusted base branch owns this file.\n`
    + `import { mkdir, readFile, realpath } from 'node:fs/promises';\n`
    + `import { spawn } from 'node:child_process';\n`
    + `import path from 'node:path';\n\n`
    + `const [configInput, candidateInput] = process.argv.slice(2);\n`
    + `if (!configInput || !candidateInput) throw new Error('Usage: local-ci-runner.mjs <config> <candidate>');\n`
    + `const configPath = await realpath(path.resolve(configInput));\n`
    + `const candidateRoot = await realpath(path.resolve(candidateInput));\n`
    + `const config = JSON.parse(await readFile(configPath, 'utf8'));\n`
    + `if (config?.schemaVersion !== 1 || config?.managedBy !== '${REVIEWED_PR_LOCAL_CI_MARKER}' || config?.enabled !== true) {\n`
    + `  throw new Error('The trusted local-CI contract is absent, unsupported, or disabled.');\n`
    + `}\n`
    + `if (!Array.isArray(config.commands) || config.commands.length < 1 || config.commands.length > 20) {\n`
    + `  throw new Error('The trusted local-CI contract must declare between 1 and 20 commands.');\n`
    + `}\n`
    + `const jobTemp = typeof process.env.RUNNER_TEMP === 'string' && process.env.RUNNER_TEMP.length > 0\n`
    + `  ? path.resolve(process.env.RUNNER_TEMP)\n`
    + `  : path.join(candidateRoot, '.atlasmind-tmp');\n`
    + `const isolatedHome = path.join(jobTemp, 'atlasmind-home');\n`
    + `await mkdir(isolatedHome, { recursive: true });\n`
    + `const cleanEnv = {\n`
    + `  PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',\n`
    + `  HOME: isolatedHome,\n`
    + `  TMPDIR: jobTemp,\n`
    + `  LANG: process.env.LANG ?? 'C.UTF-8',\n`
    + `  NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS ?? '/etc/ssl/certs/ca-certificates.crt',\n`
    + `  CI: 'true',\n`
    + `  ATLASMIND_REVIEWED_PR_LOCAL_CI: 'true',\n`
    + `  NPM_CONFIG_CACHE: path.join(jobTemp, 'npm-cache'),\n`
    + `};\n`
    + `for (const key of ['NODE_OPTIONS', 'ATLASMIND_TEST_MAX_WORKERS', 'VITEST_MAX_WORKERS', 'JEST_MAX_WORKERS']) {\n`
    + `  const value = process.env[key];\n`
    + `  if (typeof value === 'string' && value.length > 0) cleanEnv[key] = value;\n`
    + `}\n\n`
    + `function validText(value, limit) {\n`
    + `  return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\\u0000-\\u001f\\u007f]/.test(value);\n`
    + `}\n`
    + `async function run(spec, index) {\n`
    + `  if (!spec || !validText(spec.label, 160) || !validText(spec.command, 240) || /[\\s;&|\\x60$<>]/.test(spec.command)) {\n`
    + `    throw new Error('Command ' + (index + 1) + ' is malformed. Commands are executable names, never shell expressions.');\n`
    + `  }\n`
    + `  const executable = path.basename(spec.command).toLowerCase();\n`
    + `  if (['sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'].includes(executable)) {\n`
    + `    throw new Error('Command ' + (index + 1) + ' invokes a shell. The reviewed-PR contract accepts executable/argument pairs only.');\n`
    + `  }\n`
    + `  if (!Array.isArray(spec.args) || spec.args.length > 80 || !spec.args.every(arg => validText(arg, 1000))) {\n`
    + `    throw new Error('Arguments for command ' + (index + 1) + ' are malformed.');\n`
    + `  }\n`
    + `  const timeoutMinutes = Number.isFinite(spec.timeoutMinutes) ? Math.max(1, Math.min(120, Math.floor(spec.timeoutMinutes))) : 45;\n`
    + `  console.log('\\n[AtlasMind local CI] ' + spec.label);\n`
    + `  await new Promise((resolve, reject) => {\n`
    + `    const child = spawn(spec.command, spec.args, {\n`
    + `      cwd: candidateRoot, env: cleanEnv, stdio: 'inherit', shell: false, detached: process.platform !== 'win32',\n`
    + `    });\n`
    + `    let settled = false;\n`
    + `    const signalTree = signal => {\n`
    + `      if (child.pid && process.platform !== 'win32') {\n`
    + `        try { process.kill(-child.pid, signal); return; } catch {}\n`
    + `      }\n`
    + `      try { child.kill(signal); } catch {}\n`
    + `    };\n`
    + `    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };\n`
    + `    const timer = setTimeout(() => {\n`
    + `      signalTree('SIGTERM');\n`
    + `      setTimeout(() => signalTree('SIGKILL'), 5000).unref();\n`
    + `      finish(new Error(spec.label + ' exceeded ' + timeoutMinutes + ' minutes.'));\n`
    + `    }, timeoutMinutes * 60_000);\n`
    + `    child.on('error', finish);\n`
    + `    child.on('close', (code, signal) => code === 0 ? finish() : finish(new Error(spec.label + ' failed with ' + (signal ? 'signal ' + signal : 'exit code ' + code) + '.')));\n`
    + `  });\n`

    + `}\n\n`
    + `for (const [index, spec] of config.commands.entries()) await run(spec, index);\n`
    + `console.log('\\n[AtlasMind local CI] All declared checks passed.');\n`;
}

export function buildReviewedPrLocalCiWorkflow(config: ReviewedPrLocalCiConfig): string {
  const checkout = TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.checkout;
  const setupNode = TRUSTED_LOCAL_CI_ACTIONS_REVIEWED.setupNode;
  return `name: AtlasMind reviewed PR local CI\n\n`
    + `# ${REVIEWED_PR_LOCAL_CI_MARKER}\n`
    + `# Generated by AtlasMind. A person approves one immutable same-repository\n`
    + `# head SHA before this workflow is dispatched. The authoring tool is not a\n`
    + `# trust signal: Codex, Claude, another agent, and a human use the same path.\n`
    + `run-name: >-\n`
    + `  AtlasMind local CI PR #\${{ inputs.pr_number }} @ \${{ inputs.pr_sha }}\n`
    + `on:\n`
    + `  workflow_dispatch:\n`
    + `    inputs:\n`
    + `      pr_number:\n`
    + `        description: Reviewed PR number\n`
    + `        required: true\n`
    + `        type: string\n`
    + `      pr_sha:\n`
    + `        description: Exact reviewed head SHA\n`
    + `        required: true\n`
    + `        type: string\n`
    + `      head_repo:\n`
    + `        description: Exact same-repository slug\n`
    + `        required: true\n`
    + `        type: string\n\n`
    + `permissions:\n`
    + `  contents: read\n\n`
    + `concurrency:\n`
    + `  group: atlasmind-reviewed-pr-\${{ inputs.pr_sha }}\n`
    + `  cancel-in-progress: false\n\n`
    + `jobs:\n`
    + `  reviewed-quality:\n`
    + `    name: Reviewed PR quality\n`
    + `    if: >-\n`
    + `      github.event_name == 'workflow_dispatch' &&\n`
    + `      github.repository == '${config.repository}' &&\n`
    + `      github.ref == 'refs/heads/${config.trustedBaseBranch}' &&\n`
    + `      github.actor == github.repository_owner &&\n`
    + `      inputs.head_repo == github.repository\n`
    + `    runs-on: [${config.runnerLabel}]\n`
    + `    timeout-minutes: 60\n`
    + `    env:\n`
    + `      CI: true\n`
    + `      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/ca-certificates.crt\n`
    + `    steps:\n`
    + `      - name: Check out the trusted controller\n`
    + `        # ${checkout.release}; immutable reviewed pin.\n`
    + `        uses: ${checkout.name}@${checkout.sha}\n`
    + `        with:\n`
    + `          ref: \${{ github.sha }}\n`
    + `          path: atlasmind-controller\n`
    + `          clean: true\n`
    + `          fetch-depth: 1\n`
    + `          persist-credentials: false\n\n`
    + `      - name: Validate the approved identity\n`
    + `        shell: bash\n`
    + `        env:\n`
    + `          APPROVED_PR_NUMBER: \${{ inputs.pr_number }}\n`
    + `          APPROVED_PR_SHA: \${{ inputs.pr_sha }}\n`
    + `          APPROVED_HEAD_REPO: \${{ inputs.head_repo }}\n`
    + `        run: |\n`
    + `          [[ "$APPROVED_PR_NUMBER" =~ ^[1-9][0-9]*$ ]]\n`
    + `          [[ "$APPROVED_PR_SHA" =~ ^[a-f0-9]{40}$ ]]\n`
    + `          test "$APPROVED_HEAD_REPO" = "${config.repository}"\n\n`
    + `      - name: Check out the approved candidate\n`
    + `        # ${checkout.release}; immutable reviewed pin.\n`
    + `        uses: ${checkout.name}@${checkout.sha}\n`
    + `        with:\n`
    + `          repository: \${{ inputs.head_repo }}\n`
    + `          ref: \${{ inputs.pr_sha }}\n`
    + `          path: candidate\n`
    + `          clean: true\n`
    + `          fetch-depth: 1\n`
    + `          persist-credentials: false\n\n`
    + `      - name: Set up Node.js for the trusted controller\n`
    + `        # ${setupNode.release}; immutable reviewed pin.\n`
    + `        uses: ${setupNode.name}@${setupNode.sha}\n`
    + `        with:\n`
    + `          node-version: ${config.controllerNodeVersion}\n\n`
    + `      - name: Run the trusted command contract against the approved SHA\n`
    + `        shell: bash\n`
    + `        run: >-\n`
    + `          node atlasmind-controller/${REVIEWED_PR_LOCAL_CI_RUNNER_PATH}\n`
    + `          atlasmind-controller/${REVIEWED_PR_LOCAL_CI_CONFIG_PATH}\n`
    + `          candidate\n`;
}

/** Build all three managed files. Nothing is written by this function. */
export function buildLocalCiRepositoryPatch(input: LocalCiRepositoryPatchInput): LocalCiRepositoryPatchOutcome {
  const repository = input.repository.trim();
  if (!REPOSITORY_SLUG.test(repository)) {
    return { ok: false, reason: 'The GitHub repository must be an exact owner/name slug.' };
  }
  const trustedBaseBranch = input.trustedBaseBranch.trim();
  if (!safeWorkflowBranchRef(trustedBaseBranch)) {
    return { ok: false, reason: 'The trusted base branch is not a safe Git ref for a committed workflow.' };
  }
  const architecture = normalizeArchitecture(input.architecture);
  if (!architecture) {
    return { ok: false, reason: 'The local runner architecture could not be represented safely.' };
  }
  const nodeVersion = input.nodeVersion.trim();
  if (!NODE_VERSION.test(nodeVersion)) {
    return { ok: false, reason: 'The Node version for the trusted controller is invalid.' };
  }

  const detected = detectNodeCommands(input.packageJsonText, input.workspaceFiles);
  const runnerLabel = `atlasmind-reviewed-pr-${architecture}`;
  const config: ReviewedPrLocalCiConfig = {
    schemaVersion: 1,
    managedBy: REVIEWED_PR_LOCAL_CI_MARKER,
    enabled: detected.enabled,
    repository,
    trustedBaseBranch,
    workflowFile: REVIEWED_PR_LOCAL_CI_WORKFLOW_FILE,
    runnerLabel,
    statusContext: REVIEWED_PR_LOCAL_CI_STATUS_CONTEXT,
    controllerNodeVersion: nodeVersion,
    evidence: 'linux-container',
    allowForks: false,
    commands: detected.commands,
    detection: {
      kind: detected.packageManager ? 'node' : 'custom',
      ...(detected.packageManager ? { packageManager: detected.packageManager } : {}),
      detail: detected.detail,
    },
  };
  const files: LocalCiRepositoryPatchFile[] = [
    {
      path: REVIEWED_PR_LOCAL_CI_CONFIG_PATH,
      content: `${JSON.stringify(config, null, 2)}\n`,
      purpose: 'Trusted repository identity, exact base branch, runner label, and shell-free checks.',
    },
    {
      path: REVIEWED_PR_LOCAL_CI_RUNNER_PATH,
      content: buildReviewedPrLocalCiRunnerScript(),
      purpose: 'Trusted controller that executes argv arrays without a shell inside the isolated candidate checkout.',
    },
    {
      path: REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH,
      content: buildReviewedPrLocalCiWorkflow(config),
      purpose: 'Owner-dispatched exact-SHA workflow routed to the one-job local runner.',
    },
  ];
  return {
    ok: true,
    plan: {
      repository,
      trustedBaseBranch,
      runnerLabel,
      enabled: config.enabled,
      detectionDetail: detected.detail,
      config,
      files,
    },
  };
}

export interface ManagedReviewedPrLocalCiAssessment {
  ok: boolean;
  blockers: string[];
}

/**
 * Prove that the two executable controller files are exactly the version this
 * AtlasMind build generated from the committed contract. The repository may
 * customise the shell-free command list in JSON, but the workflow and runner
 * are not extension points: changing either can change what reaches the lent
 * machine, so drift is a refusal rather than a warning.
 */
export function assessManagedReviewedPrLocalCiFiles(
  config: ReviewedPrLocalCiConfig,
  runnerText: string,
  workflowText: string,
): ManagedReviewedPrLocalCiAssessment {
  const blockers: string[] = [];
  if (runnerText !== buildReviewedPrLocalCiRunnerScript()) {
    blockers.push(`${REVIEWED_PR_LOCAL_CI_RUNNER_PATH} does not exactly match the AtlasMind-managed shell-free runner. Run the repository patcher and review the refreshed file.`);
  }
  if (workflowText !== buildReviewedPrLocalCiWorkflow(config)) {
    blockers.push(`${REVIEWED_PR_LOCAL_CI_WORKFLOW_PATH} does not exactly match the workflow generated from the committed contract. Run the repository patcher and review the refreshed file.`);
  }
  return { ok: blockers.length === 0, blockers };
}

function isAtlasMindManagedLocalCiContent(content: string): boolean {
  return content.includes(REVIEWED_PR_LOCAL_CI_MARKER);
}

/** Decide whether each target may be created or replaced. */
export function assessLocalCiPatchTargets(
  plan: LocalCiRepositoryPatchPlan,
  existing: ReadonlyMap<string, string | undefined>,
): LocalCiPatchTargetAssessment[] {
  return plan.files.map(file => {
    const current = existing.get(file.path);
    if (current === undefined) {
      return { path: file.path, state: 'create' as const, reason: 'The managed file does not exist yet.' };
    }
    if (current === file.content) {
      return { path: file.path, state: 'unchanged' as const, reason: 'The managed file already matches the proposed content.' };
    }
    if (isAtlasMindManagedLocalCiContent(current)) {
      return { path: file.path, state: 'replace-managed' as const, reason: 'AtlasMind previously generated this file and can refresh it after confirmation.' };
    }
    return {
      path: file.path,
      state: 'conflict' as const,
      reason: 'An unrelated file occupies this path. AtlasMind will not overwrite it.',
    };
  });
}

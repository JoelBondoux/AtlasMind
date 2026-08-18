/**
 * Pure CI inspection and starter-workflow construction.
 *
 * A CI file is repository input, so the inspector deliberately emits a small
 * summary rather than forwarding YAML or shell commands to the webview. The
 * starter path travels in the opposite direction: every byte is constructed
 * here from a closed template and host-validated package-script names.
 */

export type CiReadinessState = 'unconfigured' | 'attention' | 'ready';

export interface CiTriggerSummary {
  event: 'push' | 'pull_request' | 'workflow_dispatch' | 'schedule' | 'release';
  branches: string[] | 'all';
}

export interface CiJobSummary {
  id: string;
  name: string;
  runsOn: string;
  stepCount: number;
  timeoutMinutes?: number;
}

export interface CiWorkflowSummary {
  id: string;
  provider: 'github-actions';
  role: 'quality' | 'delivery' | 'automation';
  name: string;
  path: string;
  triggers: CiTriggerSummary[];
  jobs: CiJobSummary[];
  hasExplicitPermissions: boolean;
  hasConcurrency: boolean;
  validations: Array<'build' | 'lint' | 'test'>;
  cautions: string[];
}

export interface CiPortfolioAssessment {
  state: CiReadinessState;
  summary: string;
  workflowCount: number;
  qualityWorkflowCount: number;
  deliveryWorkflowCount: number;
  jobCount: number;
  pullRequestCoverage: boolean;
  pushCoverage: boolean;
  manualCoverage: boolean;
  cautions: string[];
}

const CI_EVENTS = ['push', 'pull_request', 'workflow_dispatch', 'schedule', 'release'] as const;

function cleanYamlScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  return withoutComment.replace(/^(['"])(.*)\1$/, '$2').trim().slice(0, 200);
}

function lineIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function inlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }
  return trimmed.slice(1, -1).split(',').map(cleanYamlScalar).filter(Boolean).slice(0, 50);
}

function triggerBranches(lines: readonly string[], eventIndex: number, eventIndent: number): string[] | 'all' {
  for (let index = eventIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent <= eventIndent) {
      break;
    }
    const branches = /^\s*branches:\s*(.*)$/.exec(line);
    if (!branches) {
      continue;
    }
    const sameLine = inlineList(branches[1] ?? '');
    if (sameLine.length > 0) {
      return sameLine;
    }
    const values: string[] = [];
    for (let itemIndex = index + 1; itemIndex < lines.length; itemIndex += 1) {
      const itemLine = lines[itemIndex] ?? '';
      if (!itemLine.trim()) {
        continue;
      }
      if (lineIndent(itemLine) <= indent) {
        break;
      }
      const item = /^\s*-\s*(.+)$/.exec(itemLine);
      if (item?.[1]) {
        values.push(cleanYamlScalar(item[1]));
      }
    }
    return values.length > 0 ? values.slice(0, 50) : 'all';
  }
  return 'all';
}

function parseTriggers(lines: readonly string[]): CiTriggerSummary[] {
  const onIndex = lines.findIndex(line => /^on:\s*/.test(line));
  if (onIndex < 0) {
    return [];
  }
  const onLine = lines[onIndex] ?? '';
  const afterOn = onLine.replace(/^on:\s*/, '').trim();
  const inline = inlineList(afterOn);
  if (inline.length > 0) {
    return CI_EVENTS.filter(event => inline.includes(event)).map(event => ({ event, branches: 'all' }));
  }
  if (afterOn && CI_EVENTS.includes(afterOn as (typeof CI_EVENTS)[number])) {
    return [{ event: afterOn as CiTriggerSummary['event'], branches: 'all' }];
  }

  const triggers: CiTriggerSummary[] = [];
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = lineIndent(line);
    if (indent === 0) {
      break;
    }
    const match = /^\s{1,6}([A-Za-z_]+):(?:\s.*)?$/.exec(line);
    const event = match?.[1] as CiTriggerSummary['event'] | undefined;
    if (event && CI_EVENTS.includes(event)) {
      triggers.push({ event, branches: triggerBranches(lines, index, indent) });
    }
  }
  return triggers;
}

function parseJobs(lines: readonly string[]): CiJobSummary[] {
  const jobsIndex = lines.findIndex(line => /^jobs:\s*$/.test(line));
  if (jobsIndex < 0) {
    return [];
  }
  const jobs: CiJobSummary[] = [];
  for (let index = jobsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    if (lineIndent(line) === 0) {
      break;
    }
    const jobMatch = /^  ([A-Za-z0-9_-]{1,100}):\s*$/.exec(line);
    if (!jobMatch?.[1]) {
      continue;
    }
    const id = jobMatch[1];
    let name = id;
    let runsOn = 'not declared';
    let stepCount = 0;
    let timeoutMinutes: number | undefined;
    for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
      const child = lines[childIndex] ?? '';
      if (!child.trim()) {
        continue;
      }
      const indent = lineIndent(child);
      if (indent <= 2) {
        break;
      }
      const nameMatch = /^\s{4}name:\s*(.+)$/.exec(child);
      const runnerMatch = /^\s{4}runs-on:\s*(.+)$/.exec(child);
      const timeoutMatch = /^\s{4}timeout-minutes:\s*(\d+)\s*$/.exec(child);
      if (nameMatch?.[1]) { name = cleanYamlScalar(nameMatch[1]); }
      if (runnerMatch?.[1]) { runsOn = cleanYamlScalar(runnerMatch[1]); }
      if (timeoutMatch?.[1]) { timeoutMinutes = Number.parseInt(timeoutMatch[1], 10); }
      if (/^\s{6,}-\s+(?:name|uses|run):/.test(child)) { stepCount += 1; }
    }
    jobs.push({
      id,
      name: name.slice(0, 200),
      runsOn: runsOn.slice(0, 200),
      stepCount,
      ...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
    });
  }
  return jobs.slice(0, 100);
}

function validationKinds(text: string): CiWorkflowSummary['validations'] {
  const runLines = text.split(/\r?\n/)
    .filter(line => /^\s*run:\s*/.test(line) || /^\s*-\s+run:\s*/.test(line))
    .join('\n')
    .toLowerCase();
  const out: CiWorkflowSummary['validations'] = [];
  if (/\b(?:compile|build|tsc)\b/.test(runLines)) { out.push('build'); }
  if (/\blint\b/.test(runLines)) { out.push('lint'); }
  if (/\b(?:test|pytest|cargo test|go test|dotnet test)\b/.test(runLines)) { out.push('test'); }
  return out;
}

/** Summarize one GitHub Actions document without exposing its commands or inputs. */
export function inspectGithubActionsWorkflow(path: string, text: string): CiWorkflowSummary {
  const lines = text.slice(0, 1_000_000).split(/\r?\n/);
  const fileName = path.replace(/\\/g, '/').split('/').pop() ?? 'workflow.yml';
  const name = cleanYamlScalar(lines.find(line => /^name:\s*/.test(line))?.replace(/^name:\s*/, '') ?? fileName.replace(/\.ya?ml$/i, ''));
  const triggers = parseTriggers(lines);
  const jobs = parseJobs(lines);
  const hasExplicitPermissions = lines.some(line => /^\s{0,4}permissions:\s*(?:$|\S)/.test(line));
  const hasConcurrency = lines.some(line => /^\s{0,4}concurrency:\s*(?:$|\S)/.test(line));
  const validations = validationKinds(text);
  const identity = `${name} ${fileName} ${jobs.map(job => `${job.id} ${job.name}`).join(' ')}`.toLowerCase();
  const deliverySignal = /\b(?:deploy|publish|release|promote|ship)\b/.test(identity)
    || triggers.some(trigger => trigger.event === 'release');
  const qualitySignal = validations.length > 0
    || /\b(?:ci|build|lint|tests?|quality|verify|verification|validate|validation)\b/.test(identity);
  // Delivery takes precedence: packaging a release may compile or test an
  // artifact, but that does not prove pull requests have a quality gate.
  // A pull-request trigger alone is likewise not CI — labellers and triage
  // automations commonly run there without validating code.
  const role: CiWorkflowSummary['role'] = deliverySignal ? 'delivery' : qualitySignal ? 'quality' : 'automation';
  const cautions: string[] = [];
  if (triggers.length === 0) { cautions.push('No supported trigger could be read.'); }
  if (jobs.length === 0) { cautions.push('No jobs could be read.'); }
  if (jobs.some(job => job.timeoutMinutes === undefined)) { cautions.push('At least one job has no explicit timeout.'); }
  if (!hasExplicitPermissions) { cautions.push('Token permissions are not declared explicitly.'); }
  return {
    id: fileName,
    provider: 'github-actions',
    role,
    name: name || fileName,
    path: path.replace(/\\/g, '/'),
    triggers,
    jobs,
    hasExplicitPermissions,
    hasConcurrency,
    validations,
    cautions,
  };
}

export function assessCiPortfolio(workflows: readonly CiWorkflowSummary[]): CiPortfolioAssessment {
  if (workflows.length === 0) {
    return {
      state: 'unconfigured',
      summary: 'No CI workflow is configured yet.',
      workflowCount: 0,
      qualityWorkflowCount: 0,
      deliveryWorkflowCount: 0,
      jobCount: 0,
      pullRequestCoverage: false,
      pushCoverage: false,
      manualCoverage: false,
      cautions: ['Changes are not being checked automatically before they merge.'],
    };
  }
  const qualityWorkflows = workflows.filter(workflow => workflow.role === 'quality');
  const allTriggers = qualityWorkflows.flatMap(workflow => workflow.triggers);
  const pullRequestCoverage = allTriggers.some(trigger => trigger.event === 'pull_request');
  const pushCoverage = allTriggers.some(trigger => trigger.event === 'push');
  const manualCoverage = allTriggers.some(trigger => trigger.event === 'workflow_dispatch');
  const cautions = [...new Set(qualityWorkflows.flatMap(workflow => workflow.cautions))];
  if (qualityWorkflows.length === 0) {
    cautions.unshift('Automation workflows exist, but none defines readable build, lint, test, or pull-request checks.');
  }
  if (!pullRequestCoverage) { cautions.unshift('No workflow checks pull requests before merge.'); }
  const state: CiReadinessState = qualityWorkflows.length === 0 ? 'unconfigured' : cautions.length > 0 ? 'attention' : 'ready';
  return {
    state,
    summary: state === 'unconfigured'
      ? `${workflows.length} automation workflow${workflows.length === 1 ? '' : 's'} found, but no quality CI path could be read.`
      : state === 'ready'
      ? `${workflows.length} workflow${workflows.length === 1 ? '' : 's'} define a readable CI path.`
      : `${workflows.length} workflow${workflows.length === 1 ? '' : 's'} found, with ${cautions.length} item${cautions.length === 1 ? '' : 's'} to review.`,
    workflowCount: workflows.length,
    qualityWorkflowCount: qualityWorkflows.length,
    deliveryWorkflowCount: workflows.filter(workflow => workflow.role === 'delivery').length,
    jobCount: workflows.reduce((sum, workflow) => sum + workflow.jobs.length, 0),
    pullRequestCoverage,
    pushCoverage,
    manualCoverage,
    cautions,
  };
}

export interface NodeCiStarterInput {
  branches: readonly string[];
  packageManager: 'npm' | 'pnpm' | 'yarn';
  scripts: readonly string[];
  /**
   * The Node major to pin, resolved by `nodeVersionDetection`.
   *
   * Required, and that is the fix rather than a style preference. It was
   * optional and **no caller ever passed it**, so the `'20'` behind the old
   * default was not a fallback but the only value this generator ever emitted —
   * every workflow AtlasMind wrote into somebody's repository pinned a runtime
   * that reached end of life in April 2026. Optional made that possible;
   * required makes it unrepresentable.
   */
  nodeVersion: string;
}

export interface CiStarterPlan {
  path: '.github/workflows/ci.yml';
  name: 'CI';
  branches: string[];
  validationScripts: string[];
  content: string;
}

/**
 * A branch name AtlasMind is willing to write into a workflow file.
 *
 * Deliberately narrower than Git's complete ref grammar: these strings enter
 * GitHub Actions YAML, where expression-shaped or punctuation-heavy values are
 * not worth preserving automatically. A person can still edit the previewed
 * file for an unusual but legitimate branch name.
 *
 * Exported because the trusted-runner starter writes a branch into an
 * *authorization condition*, where the same question has the same answer. Two
 * copies of this rule would be two answers to it, and the one that drifted
 * would be the one guarding the more dangerous file.
 */
export function safeWorkflowBranchRef(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(trimmed)
    && !trimmed.includes('..')
    && !trimmed.includes('//')
    && !trimmed.endsWith('/')
    && !trimmed.endsWith('.')
    && !trimmed.endsWith('.lock')
    ? trimmed
    : undefined;
}

function safeScript(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,100}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * A version number, or nothing.
 *
 * This value is interpolated into YAML, so the shape check is a boundary guard
 * before it is anything else — the test feeding it a newline and a `run:` step
 * is guarding a real injection path. It returns `undefined` rather than
 * coercing to a default: substituting a version the caller did not ask for
 * would write a runtime into somebody's CI that nothing in their project
 * declared, which is precisely how this generator came to emit Node 20 forever.
 */
function safeNodeVersion(value: string): string | undefined {
  const trimmed = value.trim();
  return /^(?:\d{1,3})(?:\.\d{1,3}){0,2}(?:\.x)?$/.test(trimmed) ? trimmed : undefined;
}

/** Build a create-only Node starter from repository-derived facts. */
export function buildNodeCiStarter(input: NodeCiStarterInput): CiStarterPlan | undefined {
  // Refuse rather than substitute. A workflow is written into the user's
  // repository and run on their account; emitting a Node version nothing asked
  // for is worse than emitting no workflow at all.
  const nodeVersion = safeNodeVersion(input.nodeVersion);
  if (!nodeVersion) {
    return undefined;
  }
  const branches = [...new Set(input.branches.map(safeWorkflowBranchRef).filter((value): value is string => Boolean(value)))].slice(0, 10);
  if (branches.length === 0) { branches.push('main'); }
  const available = new Set(input.scripts.map(safeScript).filter((value): value is string => Boolean(value)));
  const validationScripts = ['compile', 'build', 'lint', 'test'].filter(script => available.has(script));
  if (validationScripts.length === 0) {
    return undefined;
  }
  const install = input.packageManager === 'npm' ? 'npm ci'
    : input.packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile'
      : 'yarn install --immutable';
  const run = (script: string): string => input.packageManager === 'npm'
    ? `npm run ${script}` : `${input.packageManager} ${script}`;
  const branchList = branches.map(branch => `'${branch.replace(/'/g, "''")}'`).join(', ');
  const validationSteps = validationScripts.map(script => `      - name: ${script === 'test' ? 'Test' : script === 'lint' ? 'Lint' : 'Build'}\n        run: ${run(script)}`).join('\n\n');
  const packageManagerSetup = input.packageManager === 'pnpm'
    ? '      - name: Set up pnpm\n        uses: pnpm/action-setup@v4\n        with:\n          version: 10\n\n'
    : '';
  const cache = input.packageManager === 'npm' ? 'npm' : input.packageManager;
  const content = `name: CI

on:
  pull_request:
    branches: [${branchList}]
  push:
    branches: [${branchList}]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Quality
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out repository
        uses: actions/checkout@v7

${packageManagerSetup}      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: '${nodeVersion}'
          cache: ${cache}

      - name: Install dependencies
        run: ${install}

${validationSteps}
`;
  return { path: '.github/workflows/ci.yml', name: 'CI', branches, validationScripts, content };
}

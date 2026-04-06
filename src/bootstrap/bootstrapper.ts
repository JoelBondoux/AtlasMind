import * as vscode from 'vscode';
import { SSOT_FOLDERS } from '../types.js';
import type { AtlasMindContext } from '../extension.js';
import type { MemoryDocumentClass, MemoryEntry, MemoryEvidenceType } from '../types.js';

type DependencyMonitoringProvider = 'dependabot' | 'renovate' | 'snyk' | 'azure-devops';
type DependencyMonitoringSchedule = 'daily' | 'weekly' | 'monthly';

/**
 * Bootstrap a new project: create SSOT folders, optionally init Git,
 * and prompt for project type.
 */
export async function bootstrapProject(
  workspaceRoot: vscode.Uri,
  _atlas: AtlasMindContext,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    vscode.window.showErrorMessage('AtlasMind SSOT path must be a safe relative path inside the workspace.');
    return;
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);

  if (await hasExistingContent(ssotRoot)) {
    const choice = await vscode.window.showWarningMessage(
      `The SSOT path "${ssotRelPath}" already exists. AtlasMind will only add missing files and folders.`,
      'Continue',
      'Cancel',
    );

    if (choice !== 'Continue') {
      return;
    }
  }

  // ── Ask about Git init ──────────────────────────────────────
  const initGit = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: 'Initialise a Git repository?',
  });

  if (initGit === 'Yes') {
    try {
      await vscode.commands.executeCommand('git.init');
    } catch {
      vscode.window.showWarningMessage('Git init failed – you may need to do it manually.');
    }
  }

  // ── Create SSOT folder structure ────────────────────────────
  await ensureSsotStructure(ssotRoot);

  vscode.window.showInformationMessage(`SSOT structure created at ${ssotRelPath}/`);

  // ── Ask for project type ────────────────────────────────────
  const projectType = await vscode.window.showQuickPick(
    ['Web App', 'CLI Tool', 'Library', 'VS Code Extension', 'Other'],
    { placeHolder: 'What type of project is this?' },
  );

  if (projectType) {
    const soulUri = vscode.Uri.joinPath(ssotRoot, 'project_soul.md');
    const existing = Buffer.from(
      await vscode.workspace.fs.readFile(soulUri),
    ).toString('utf-8');
    const updated = existing.replace('{{PROJECT_TYPE}}', projectType);
    await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
  }

  const scaffoldGovernance = await vscode.window.showQuickPick(['Yes', 'No'], {
    placeHolder: 'Scaffold governance baseline (CI, templates, extension recommendations, dependency monitoring)?',
  });

  if (scaffoldGovernance === 'Yes') {
    await scaffoldGovernanceBaseline(workspaceRoot, ssotRoot, config);
    vscode.window.showInformationMessage('AtlasMind governance baseline scaffolded (.github + .vscode recommendations).');
  }
}

async function hasExistingContent(uri: vscode.Uri): Promise<boolean> {
  try {
    const children = await vscode.workspace.fs.readDirectory(uri);
    return children.length > 0;
  } catch {
    return false;
  }
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function getValidatedSsotPath(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0 || /^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    return undefined;
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    return undefined;
  }

  return segments.join('/');
}

function getStarterContent(filename: string): string {
  switch (filename) {
    case 'project_soul.md':
      return [
        '# Project Soul',
        '',
        '> This file is the living identity of the project.',
        '',
        '## Project Type',
        '{{PROJECT_TYPE}}',
        '',
        '## Vision',
        '<!-- Describe the high-level goal of this project -->',
        '',
        '## Principles',
        '- ',
        '',
        '## Key Decisions',
        '<!-- Link to decisions/ folder entries -->',
        '',
      ].join('\n');
    default:
      return `# ${filename}\n`;
  }
}

async function scaffoldGovernanceBaseline(
  workspaceRoot: vscode.Uri,
  ssotRoot: vscode.Uri,
  configuration: Pick<vscode.WorkspaceConfiguration, 'get'>,
): Promise<void> {
  const files: Array<{ path: string; content: string }> = [
    {
      path: '.github/workflows/ci.yml',
      content: [
        'name: CI',
        '',
        'on:',
        '  push:',
        '    branches: [master]',
        '  pull_request:',
        '    branches: [master]',
        '',
        'jobs:',
        '  quality:',
        '    runs-on: ubuntu-latest',
        '',
        '    steps:',
        '      - name: Checkout',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Setup Node',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 20',
        '          cache: npm',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Compile',
        '        run: npm run compile',
        '',
        '      - name: Lint',
        '        run: npm run lint',
        '',
        '      - name: Test',
        '        run: npm run test',
      ].join('\n'),
    },
    {
      path: '.github/pull_request_template.md',
      content: [
        '## Summary',
        '- What changed?',
        '- Why?',
        '',
        '## Linked Issue',
        '- Closes #<issue-number>',
        '',
        '## Quality Checklist',
        '- [ ] Tests added/updated',
        '- [ ] Lint passes',
        '- [ ] Compile passes',
        '- [ ] Documentation updated',
      ].join('\n'),
    },
    {
      path: '.github/CODEOWNERS',
      content: [
        '* @your-org/maintainers',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/bug_report.md',
      content: [
        '---',
        'name: Bug report',
        'about: Report a defect',
        'title: "[Bug]: "',
        'labels: ["type:bug", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Description',
        '',
        '## Steps to Reproduce',
        '1.',
        '2.',
        '3.',
        '',
        '## Expected Behavior',
        '',
        '## Actual Behavior',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/feature_request.md',
      content: [
        '---',
        'name: Feature request',
        'about: Suggest an improvement',
        'title: "[Feature]: "',
        'labels: ["type:feature", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Problem',
        '',
        '## Proposed Solution',
        '',
        '## Acceptance Criteria',
        '- [ ]',
      ].join('\n'),
    },
    {
      path: '.github/ISSUE_TEMPLATE/config.yml',
      content: [
        'blank_issues_enabled: false',
      ].join('\n'),
    },
    {
      path: '.vscode/extensions.json',
      content: [
        '{',
        '  "recommendations": [',
        '    "github.copilot-chat",',
        '    "dbaeumer.vscode-eslint",',
        '    "github.vscode-pull-request-github",',
        '    "eamodio.gitlens",',
        '    "editorconfig.editorconfig",',
        '    "redhat.vscode-yaml"',
        '  ]',
        '}',
      ].join('\n'),
    },
  ];

  const dependencyMonitoringEnabled = configuration.get<boolean>('projectDependencyMonitoringEnabled', true);
  const dependencyMonitoringProviders = getDependencyMonitoringProviders(
    configuration.get<string[]>('projectDependencyMonitoringProviders', ['dependabot']),
  );
  const dependencyMonitoringSchedule = getDependencyMonitoringSchedule(
    configuration.get<string>('projectDependencyMonitoringSchedule', 'weekly'),
  );
  const dependencyMonitoringIssueTemplate = configuration.get<boolean>('projectDependencyMonitoringIssueTemplate', true);

  if (dependencyMonitoringEnabled) {
    files.push(...buildDependencyMonitoringFiles({
      providers: dependencyMonitoringProviders,
      schedule: dependencyMonitoringSchedule,
      includeIssueTemplate: dependencyMonitoringIssueTemplate,
    }));
  }

  for (const file of files) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, ...file.path.split('/'));
    await ensureParentDirectory(fileUri, workspaceRoot);
    if (!(await pathExists(fileUri))) {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'utf-8'));
    }
  }

  if (dependencyMonitoringEnabled) {
    await scaffoldDependencyMonitoringMemory(ssotRoot, {
      providers: dependencyMonitoringProviders,
      schedule: dependencyMonitoringSchedule,
      includeIssueTemplate: dependencyMonitoringIssueTemplate,
    });
  }
}

function getDependencyMonitoringProviders(value: string[] | undefined): DependencyMonitoringProvider[] {
  return (value ?? []).filter(candidate =>
    candidate === 'dependabot'
    || candidate === 'renovate'
    || candidate === 'snyk'
    || candidate === 'azure-devops') as DependencyMonitoringProvider[];
}

function getDependencyMonitoringSchedule(value: string | undefined): DependencyMonitoringSchedule {
  switch (value) {
    case 'daily':
    case 'monthly':
      return value;
    default:
      return 'weekly';
  }
}

function buildDependencyMonitoringFiles(options: {
  providers: DependencyMonitoringProvider[];
  schedule: DependencyMonitoringSchedule;
  includeIssueTemplate: boolean;
}): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  if (options.providers.includes('dependabot')) {
    files.push({
      path: '.github/dependabot.yml',
      content: [
        'version: 2',
        'updates:',
        '  - package-ecosystem: npm',
        '    directory: "/"',
        '    schedule:',
        `      interval: ${options.schedule}`,
        '    open-pull-requests-limit: 5',
        '    labels:',
        '      - dependencies',
        '    commit-message:',
        '      prefix: chore',
        '      include: scope',
        '',
        '  - package-ecosystem: github-actions',
        '    directory: "/"',
        '    schedule:',
        `      interval: ${options.schedule}`,
        '    open-pull-requests-limit: 3',
        '    labels:',
        '      - dependencies',
        '    commit-message:',
        '      prefix: chore',
        '      include: scope',
      ].join('\n'),
    });
  }

  if (options.providers.includes('renovate')) {
    files.push({
      path: 'renovate.json',
      content: JSON.stringify({
        $schema: 'https://docs.renovatebot.com/renovate-schema.json',
        extends: ['config:base'],
        labels: ['dependencies'],
        dependencyDashboard: true,
        schedule: getRenovateSchedule(options.schedule),
        packageRules: [
          {
            matchUpdateTypes: ['major'],
            dependencyDashboardApproval: true,
          },
        ],
      }, null, 2),
    });
  }

  if (options.providers.includes('snyk')) {
    files.push({
      path: '.github/workflows/snyk-monitor.yml',
      content: [
        'name: Snyk Dependency Monitor',
        '',
        'on:',
        '  workflow_dispatch:',
        '  schedule:',
        `    - cron: '${getScheduledCron(options.schedule)}'`,
        '',
        'permissions:',
        '  contents: read',
        '',
        'jobs:',
        '  snyk:',
        '    runs-on: ubuntu-latest',
        '    if: ${{ secrets.SNYK_TOKEN != \"\" }}',
        '    steps:',
        '      - name: Checkout',
        '        uses: actions/checkout@v4',
        '',
        '      - name: Setup Node',
        '        uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 20',
        '          cache: npm',
        '',
        '      - name: Install dependencies',
        '        run: npm ci',
        '',
        '      - name: Run Snyk monitor',
        '        run: npx snyk monitor --all-projects',
        '        env:',
        '          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}',
        '',
        '      - name: Run Snyk high-severity test',
        '        run: npx snyk test --all-projects --severity-threshold=high',
        '        env:',
        '          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}',
      ].join('\n'),
    });
  }

  if (options.providers.includes('azure-devops')) {
    files.push({
      path: 'azure-pipelines.dependency-monitor.yml',
      content: [
        'trigger: none',
        'pr: none',
        '',
        'schedules:',
        `- cron: "${getScheduledCron(options.schedule)}"`,
        '  displayName: Dependency monitor',
        '  branches:',
        '    include:',
        '    - develop',
        '  always: true',
        '',
        'pool:',
        '  vmImage: ubuntu-latest',
        '',
        'steps:',
        '- task: NodeTool@0',
        '  inputs:',
        '    versionSpec: "20.x"',
        '  displayName: Use Node.js 20',
        '',
        '- script: npm ci',
        '  displayName: Install dependencies',
        '',
        '- script: |',
        '    npm outdated --json > dependency-outdated.json',
        '    exit 0',
        '  displayName: Capture dependency drift',
        '',
        '- task: PublishPipelineArtifact@1',
        '  inputs:',
        '    targetPath: dependency-outdated.json',
        '    artifact: dependency-monitor-report',
        '  displayName: Publish dependency report',
      ].join('\n'),
    });
  }

  if (options.includeIssueTemplate) {
    files.push({
      path: '.github/ISSUE_TEMPLATE/dependency_review.md',
      content: [
        '---',
        'name: Dependency review',
        'about: Track dependency drift review, exceptions, and follow-up tasks',
        'title: "[Dependencies]: review pending update"',
        'labels: ["type:chore", "dependencies", "triage"]',
        'assignees: []',
        '---',
        '',
        '## Source',
        '- Automation provider:',
        '- Ecosystem:',
        '- Update type:',
        '',
        '## Risk assessment',
        '- [ ] Breaking change review completed',
        '- [ ] Security impact reviewed',
        '- [ ] Release notes linked',
        '',
        '## Decision',
        '- [ ] Approve update now',
        '- [ ] Defer with documented exception',
        '- [ ] Reject and replace dependency/service',
        '',
        '## Follow-up',
        '- SSOT entry updated:',
        '- Test plan:',
      ].join('\n'),
    });
  }

  return files;
}

function getRenovateSchedule(schedule: DependencyMonitoringSchedule): string[] {
  switch (schedule) {
    case 'daily':
      return ['at any time'];
    case 'monthly':
      return ['before 6am on the first day of the month'];
    default:
      return ['before 6am on monday'];
  }
}

function getScheduledCron(schedule: DependencyMonitoringSchedule): string {
  switch (schedule) {
    case 'daily':
      return '0 6 * * *';
    case 'monthly':
      return '0 6 1 * *';
    default:
      return '0 6 * * 1';
  }
}

async function scaffoldDependencyMonitoringMemory(
  ssotRoot: vscode.Uri,
  options: {
    providers: DependencyMonitoringProvider[];
    schedule: DependencyMonitoringSchedule;
    includeIssueTemplate: boolean;
  },
): Promise<void> {
  const providersLabel = options.providers.length > 0 ? options.providers.join(', ') : 'manual review only';
  const docs: Array<{ path: string; content: string }> = [
    {
      path: 'operations/dependency-monitoring.md',
      content: [
        '# Dependency Monitoring',
        '',
        '## Current Policy',
        `- Enabled providers: ${providersLabel}`,
        `- Review cadence: ${options.schedule}`,
        `- Review issue template scaffolded: ${options.includeIssueTemplate ? 'yes' : 'no'}`,
        '',
        '## Review Workflow',
        '1. Let the configured automation provider open or suggest dependency updates.',
        '2. Review changelogs, migration notes, and security advisories before merging.',
        '3. Record exceptions, deferred updates, or approved changes in `decisions/dependency-policy.md` or a new ADR.',
        '4. Capture incidents or regressions caused by updates in `misadventures/` so future upgrades can learn from them.',
        '',
        '## Supported Automation',
        '- Dependabot: GitHub-native dependency and GitHub Actions update PRs.',
        '- Renovate: broader ecosystem coverage and finer grouping policy controls.',
        '- Snyk: scheduled GitHub workflow for dependency monitoring and high-severity testing.',
        '- Azure DevOps: scheduled pipeline scaffold that captures dependency drift as a build artifact.',
        '- Additional enterprise services can be added later through repository-specific configuration.',
      ].join('\n'),
    },
    {
      path: 'decisions/dependency-policy.md',
      content: [
        '# Dependency Policy',
        '',
        '## Baseline Decision',
        `AtlasMind scaffolding enabled the following dependency-monitoring providers: ${providersLabel}.`,
        '',
        '## Approval Rules',
        '- Major updates require a human review of release notes and compatibility impact.',
        '- Security updates should be triaged immediately, even when functional upgrades are deferred.',
        '- Provider or service changes that alter authentication, CI behavior, or generated files must be documented before rollout.',
        '',
        '## Exceptions',
        '- Document deferred updates here with the reason, owner, and next review date.',
      ].join('\n'),
    },
  ];

  for (const doc of docs) {
    const fileUri = vscode.Uri.joinPath(ssotRoot, ...doc.path.split('/'));
    await ensureParentDirectory(fileUri, ssotRoot);
    if (!(await pathExists(fileUri))) {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(doc.content, 'utf-8'));
    }
  }
}

async function ensureParentDirectory(targetFile: vscode.Uri, workspaceRoot: vscode.Uri): Promise<void> {
  const relative = targetFile.path.replace(workspaceRoot.path, '').replace(/^\//, '');
  const parts = relative.split('/');
  if (parts.length <= 1) {
    return;
  }

  let current = workspaceRoot;
  for (const segment of parts.slice(0, -1)) {
    current = vscode.Uri.joinPath(current, segment);
    await vscode.workspace.fs.createDirectory(current);
  }
}

// ── Project Import ──────────────────────────────────────────

type ImportScanCategory =
  | 'manifest'
  | 'readme'
  | 'config'
  | 'license'
  | 'architecture-doc'
  | 'routing-doc'
  | 'agents-doc'
  | 'development-doc'
  | 'configuration-doc'
  | 'workflow-doc'
  | 'security-doc'
  | 'governance-doc'
  | 'changelog';

/** Well-known project files to scan during import, grouped by purpose. */
const IMPORT_SCAN_FILES: ReadonlyArray<{ path: string; category: ImportScanCategory }> = [
  { path: 'package.json', category: 'manifest' },
  { path: 'Cargo.toml', category: 'manifest' },
  { path: 'pyproject.toml', category: 'manifest' },
  { path: 'go.mod', category: 'manifest' },
  { path: 'pom.xml', category: 'manifest' },
  { path: 'build.gradle', category: 'manifest' },
  { path: 'Gemfile', category: 'manifest' },
  { path: 'composer.json', category: 'manifest' },
  { path: 'README.md', category: 'readme' },
  { path: 'README.rst', category: 'readme' },
  { path: 'README.txt', category: 'readme' },
  { path: 'readme.md', category: 'readme' },
  { path: 'tsconfig.json', category: 'config' },
  { path: '.eslintrc.json', category: 'config' },
  { path: '.eslintrc.js', category: 'config' },
  { path: 'eslint.config.js', category: 'config' },
  { path: '.prettierrc', category: 'config' },
  { path: '.editorconfig', category: 'config' },
  { path: '.gitignore', category: 'config' },
  { path: 'Dockerfile', category: 'config' },
  { path: 'docker-compose.yml', category: 'config' },
  { path: 'Makefile', category: 'config' },
  { path: 'LICENSE', category: 'license' },
  { path: 'LICENSE.md', category: 'license' },
  { path: 'LICENSE.txt', category: 'license' },
  { path: 'docs/architecture.md', category: 'architecture-doc' },
  { path: 'docs/model-routing.md', category: 'routing-doc' },
  { path: 'docs/agents-and-skills.md', category: 'agents-doc' },
  { path: 'docs/development.md', category: 'development-doc' },
  { path: 'docs/configuration.md', category: 'configuration-doc' },
  { path: 'docs/github-workflow.md', category: 'workflow-doc' },
  { path: 'SECURITY.md', category: 'security-doc' },
  { path: '.github/copilot-instructions.md', category: 'governance-doc' },
  { path: 'CHANGELOG.md', category: 'changelog' },
];

import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_SNIPPET } from '../constants.js';

export interface ImportResult {
  entriesCreated: number;
  entriesSkipped: number;
  projectType: string | undefined;
}

export interface ProjectMemoryFreshnessStatus {
  hasImportedEntries: boolean;
  isStale: boolean;
  staleEntryCount: number;
  staleEntries: string[];
  lastImportedAt?: string;
}

interface ScannedImportFile {
  path: string;
  content: string;
  category: ImportScanCategory;
}

interface ImportEntryCandidate {
  entry: MemoryEntry;
  content: string;
  sourcePaths: string[];
  sourceFingerprint: string;
}

interface ImportEntryProcessingResult {
  path: string;
  title: string;
  status: 'created' | 'refreshed' | 'unchanged' | 'preserved-manual-edits' | 'rejected';
  sourcePaths: string[];
  sourceFingerprint: string;
  reason?: string;
}

interface ImportEntryMetadata {
  entryPath: string;
  generatorVersion: number;
  generatedAt: string;
  sourcePaths: string[];
  sourceFingerprint: string;
  bodyFingerprint: string;
}

interface ImportBuildSnapshot {
  now: string;
  ssotRoot: vscode.Uri;
  scanned: Map<string, ScannedImportFile>;
  projectType: string | undefined;
  entries: ImportEntryCandidate[];
  readme: { path: string; content: string } | undefined;
  architectureDoc: { path: string; content: string } | undefined;
}

const IMPORT_GENERATOR_VERSION = 2;

/**
 * Import an existing project into AtlasMind by scanning workspace files
 * and populating the SSOT memory with project metadata, architecture,
 * dependencies, and conventions.
 */
export async function importProject(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
): Promise<ImportResult> {
  const snapshot = await buildImportSnapshot(workspaceRoot);
  if (!snapshot) {
    vscode.window.showErrorMessage('AtlasMind SSOT path must be a safe relative path inside the workspace.');
    return { entriesCreated: 0, entriesSkipped: 0, projectType: undefined };
  }

  const { now, ssotRoot, scanned, projectType, entries, readme, architectureDoc } = snapshot;

  // 5. Project soul (upgrade starter template when it is still blank)
  const soulUri = vscode.Uri.joinPath(ssotRoot, 'project_soul.md');
  try {
    const existing = Buffer.from(await vscode.workspace.fs.readFile(soulUri)).toString('utf-8');
    if (shouldRefreshProjectSoul(existing)) {
      const updated = buildProjectSoul(existing, {
        projectType,
        readme: readme?.content,
        architectureDoc: architectureDoc?.content,
        governanceDoc: scanned.get('.github/copilot-instructions.md')?.content,
      });
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
    } else if (existing.includes('{{PROJECT_TYPE}}') && projectType) {
      const updated = existing.replace('{{PROJECT_TYPE}}', projectType);
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
    }
  } catch {
    // Non-fatal
  }

  // ── Upsert entries into memory ──────────────────────────────
  let created = 0;
  let skipped = 0;
  const processedEntries: ImportEntryProcessingResult[] = [];

  for (const candidate of entries) {
    const metadata: ImportEntryMetadata = {
      entryPath: candidate.entry.path,
      generatorVersion: IMPORT_GENERATOR_VERSION,
      generatedAt: now,
      sourcePaths: candidate.sourcePaths,
      sourceFingerprint: candidate.sourceFingerprint,
      bodyFingerprint: getImportBodyFingerprint(candidate.content),
    };
    const wrappedContent = appendImportMetadata(candidate.content, metadata);
    const targetUri = vscode.Uri.joinPath(ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    const existingMetadata = parseImportMetadata(existingContent);
    if (existingMetadata) {
      const existingBody = stripImportMetadata(existingContent ?? '');
      if (getImportBodyFingerprint(existingBody) !== existingMetadata.bodyFingerprint) {
        skipped++;
        processedEntries.push({
          path: candidate.entry.path,
          title: candidate.entry.title,
          status: 'preserved-manual-edits',
          sourcePaths: candidate.sourcePaths,
          sourceFingerprint: candidate.sourceFingerprint,
          reason: 'Existing imported file has local edits; AtlasMind preserved it.',
        });
        continue;
      }
      if (
        existingMetadata.generatorVersion === metadata.generatorVersion
        && existingMetadata.sourceFingerprint === metadata.sourceFingerprint
      ) {
        skipped++;
        processedEntries.push({
          path: candidate.entry.path,
          title: candidate.entry.title,
          status: 'unchanged',
          sourcePaths: candidate.sourcePaths,
          sourceFingerprint: candidate.sourceFingerprint,
        });
        continue;
      }
    }

    const result = atlas.memoryManager.upsert(candidate.entry, wrappedContent);
    if (result.status === 'created' || result.status === 'updated') {
      created++;
      processedEntries.push({
        path: candidate.entry.path,
        title: candidate.entry.title,
        status: existingContent ? 'refreshed' : 'created',
        sourcePaths: candidate.sourcePaths,
        sourceFingerprint: candidate.sourceFingerprint,
      });
    } else {
      skipped++;
      processedEntries.push({
        path: candidate.entry.path,
        title: candidate.entry.title,
        status: 'rejected',
        sourcePaths: candidate.sourcePaths,
        sourceFingerprint: candidate.sourceFingerprint,
        reason: result.reason,
      });
    }
  }

  const supplementalEntries: ImportEntryCandidate[] = [];
  const reportFingerprint = hashImportValue(processedEntries.map(item => `${item.path}:${item.status}:${item.sourceFingerprint}`));
  const importCatalog = buildImportCatalog(processedEntries);
  if (importCatalog) {
    supplementalEntries.push({
      entry: {
        path: 'index/import-catalog.md',
        title: 'Import Catalog',
        tags: ['import', 'index', 'catalog'],
        lastModified: now,
        snippet: truncate(importCatalog, MAX_IMPORT_SNIPPET),
        sourcePaths: processedEntries.map(item => item.path),
        sourceFingerprint: reportFingerprint,
        bodyFingerprint: getImportBodyFingerprint(importCatalog),
        documentClass: 'index',
        evidenceType: 'generated-index',
      },
      content: importCatalog,
      sourcePaths: processedEntries.map(item => item.path),
      sourceFingerprint: reportFingerprint,
    });
  }

  const freshnessReport = buildImportFreshnessReport(processedEntries);
  if (freshnessReport) {
    supplementalEntries.push({
      entry: {
        path: 'index/import-freshness.md',
        title: 'Import Freshness Report',
        tags: ['import', 'index', 'freshness'],
        lastModified: now,
        snippet: truncate(freshnessReport, MAX_IMPORT_SNIPPET),
        sourcePaths: processedEntries.map(item => item.path),
        sourceFingerprint: reportFingerprint,
        bodyFingerprint: getImportBodyFingerprint(freshnessReport),
        documentClass: 'index',
        evidenceType: 'generated-index',
      },
      content: freshnessReport,
      sourcePaths: processedEntries.map(item => item.path),
      sourceFingerprint: reportFingerprint,
    });
  }

  for (const candidate of supplementalEntries) {
    const metadata: ImportEntryMetadata = {
      entryPath: candidate.entry.path,
      generatorVersion: IMPORT_GENERATOR_VERSION,
      generatedAt: now,
      sourcePaths: candidate.sourcePaths,
      sourceFingerprint: candidate.sourceFingerprint,
      bodyFingerprint: getImportBodyFingerprint(candidate.content),
    };
    const wrappedContent = appendImportMetadata(candidate.content, metadata);
    const targetUri = vscode.Uri.joinPath(ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    const existingMetadata = parseImportMetadata(existingContent);
    if (
      existingMetadata
      && existingMetadata.generatorVersion === metadata.generatorVersion
      && existingMetadata.sourceFingerprint === metadata.sourceFingerprint
      && getImportBodyFingerprint(stripImportMetadata(existingContent ?? '')) === existingMetadata.bodyFingerprint
    ) {
      skipped++;
      continue;
    }

    const result = atlas.memoryManager.upsert(candidate.entry, wrappedContent);
    if (result.status === 'created' || result.status === 'updated') {
      created++;
    } else {
      skipped++;
    }
  }

  // ── Reload memory from disk to pick up any files already there ──
  const ssotUri = vscode.Uri.joinPath(
    workspaceRoot,
    vscode.workspace.getConfiguration('atlasmind').get<string>('ssotPath', 'project_memory'),
  );
  await atlas.memoryManager.loadFromDisk(ssotUri);
  atlas.memoryRefresh.fire();

  return { entriesCreated: created, entriesSkipped: skipped, projectType };
}

export async function getProjectMemoryFreshness(
  workspaceRoot: vscode.Uri,
): Promise<ProjectMemoryFreshnessStatus> {
  const snapshot = await buildImportSnapshot(workspaceRoot);
  if (!snapshot) {
    return {
      hasImportedEntries: false,
      isStale: false,
      staleEntryCount: 0,
      staleEntries: [],
    };
  }

  const importedEntries = await collectImportedEntryMetadata(snapshot.ssotRoot);
  if (importedEntries.length === 0) {
    const legacyImportedEntries = await collectLegacyImportedEntries(snapshot);
    if (legacyImportedEntries.length > 0) {
      return {
        hasImportedEntries: true,
        isStale: true,
        staleEntryCount: legacyImportedEntries.length,
        staleEntries: legacyImportedEntries.map(entry => entry.entry.path),
      };
    }

    return {
      hasImportedEntries: false,
      isStale: false,
      staleEntryCount: 0,
      staleEntries: [],
    };
  }

  const trackedImportPaths = new Set([
    'index/import-catalog.md',
    'index/import-freshness.md',
  ]);
  const currentCandidates = new Map(snapshot.entries.map(candidate => [candidate.entry.path, candidate]));
  const importedByPath = new Map(importedEntries.map(metadata => [metadata.entryPath, metadata]));
  const stalePaths = new Set<string>();

  for (const candidate of snapshot.entries) {
    const metadata = importedByPath.get(candidate.entry.path);
    if (!metadata || metadata.sourceFingerprint !== candidate.sourceFingerprint) {
      stalePaths.add(candidate.entry.path);
    }
  }

  for (const metadata of importedEntries) {
    if (trackedImportPaths.has(metadata.entryPath)) {
      continue;
    }
    if (!currentCandidates.has(metadata.entryPath)) {
      stalePaths.add(metadata.entryPath);
    }
  }

  const lastImportedAt = importedEntries
    .map(entry => entry.generatedAt)
    .sort((left, right) => right.localeCompare(left))[0];

  return {
    hasImportedEntries: true,
    isStale: stalePaths.size > 0,
    staleEntryCount: stalePaths.size,
    staleEntries: [...stalePaths].sort(),
    lastImportedAt,
  };
}

async function collectLegacyImportedEntries(snapshot: ImportBuildSnapshot): Promise<ImportEntryCandidate[]> {
  const legacyEntries: ImportEntryCandidate[] = [];

  for (const candidate of snapshot.entries) {
    const targetUri = vscode.Uri.joinPath(snapshot.ssotRoot, candidate.entry.path);
    const existingContent = await tryReadTextFile(targetUri);
    if (!existingContent) {
      continue;
    }

    if (parseImportMetadata(existingContent)) {
      continue;
    }

    if (looksLikeLegacyImportedEntry(existingContent)) {
      legacyEntries.push(candidate);
    }
  }

  return legacyEntries;
}

function looksLikeLegacyImportedEntry(content: string): boolean {
  const normalized = content.toLowerCase();
  return normalized.includes('tags: #import')
    || normalized.includes('tags: #import ')
    || normalized.includes('tags: #import\n')
    || normalized.includes('# import catalog')
    || normalized.includes('# import freshness report');
}

function inferMemoryDocumentClass(entryPath: string): MemoryDocumentClass {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  if (normalized === 'project_soul.md') {
    return 'project-soul';
  }

  const segment = normalized.split('/')[0] ?? '';
  switch (segment) {
    case 'architecture':
      return 'architecture';
    case 'roadmap':
      return 'roadmap';
    case 'decisions':
      return 'decision';
    case 'misadventures':
      return 'misadventure';
    case 'ideas':
      return 'idea';
    case 'domain':
      return 'domain';
    case 'operations':
      return 'operations';
    case 'agents':
      return 'agent';
    case 'skills':
      return 'skill';
    case 'index':
      return 'index';
    default:
      return 'other';
  }
}

function inferMemoryEvidenceType(entryPath: string, sourcePaths: string[]): MemoryEvidenceType {
  if (entryPath.replace(/\\/g, '/').startsWith('index/')) {
    return 'generated-index';
  }

  return sourcePaths.length > 0 ? 'imported' : 'manual';
}

async function buildImportSnapshot(
  workspaceRoot: vscode.Uri,
): Promise<ImportBuildSnapshot | undefined> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    return undefined;
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);
  await ensureSsotStructure(ssotRoot);

  const scanned = await scanImportFiles(workspaceRoot);
  const directoryListing = await getTopLevelDirectoryListing(workspaceRoot);
  const projectType = detectProjectType(scanned);
  const codebaseMap = await buildFocusedDirectoryMap(workspaceRoot);
  const now = new Date().toISOString();
  const entries: ImportEntryCandidate[] = [];
  const pushEntry = (
    entryPath: string,
    title: string,
    tags: string[],
    content: string,
    sourcePaths: string[],
    fingerprintInputs: Array<string | undefined>,
  ) => {
    const sourceFingerprint = hashImportValue(fingerprintInputs.filter((value): value is string => typeof value === 'string'));
    entries.push({
      entry: {
        path: entryPath,
        title,
        tags,
        lastModified: now,
        snippet: truncate(content, MAX_IMPORT_SNIPPET),
        sourcePaths,
        sourceFingerprint,
        bodyFingerprint: getImportBodyFingerprint(content),
        documentClass: inferMemoryDocumentClass(entryPath),
        evidenceType: inferMemoryEvidenceType(entryPath, sourcePaths),
      },
      content,
      sourcePaths,
      sourceFingerprint,
    });
  };

  const readme = findFirstByCategory(scanned, 'readme');
  if (readme) {
    pushEntry(
      'architecture/project-overview.md',
      'Project Overview',
      ['import', 'overview', 'readme'],
      readme.content,
      [readme.path],
      [readme.path, readme.content],
    );
  }

  const manifest = findFirstByCategory(scanned, 'manifest');
  if (manifest) {
    const dependencySummary = extractDependencySummary(manifest.path, manifest.content);
    pushEntry(
      'architecture/dependencies.md',
      'Project Dependencies',
      ['import', 'dependencies', detectEcosystem(manifest.path)],
      dependencySummary,
      [manifest.path],
      [manifest.path, manifest.content, dependencySummary],
    );
  }

  if (directoryListing) {
    const structureContent = `# Project Structure\n\nTop-level contents of the workspace:\n\n\`\`\`\n${directoryListing}\n\`\`\`\n`;
    pushEntry(
      'architecture/project-structure.md',
      'Project Structure',
      ['import', 'structure', 'architecture'],
      structureContent,
      ['workspace-root'],
      [directoryListing],
    );
  }

  if (codebaseMap) {
    pushEntry(
      'architecture/codebase-map.md',
      'Codebase Map',
      ['import', 'structure', 'codebase'],
      codebaseMap,
      ['src', 'tests', 'docs', 'wiki', 'project_memory', '.github'],
      [codebaseMap],
    );
  }

  const conventions = buildConventionsSummary(scanned);
  if (conventions) {
    pushEntry(
      'domain/conventions.md',
      'Build & Tooling Conventions',
      ['import', 'conventions', 'tooling'],
      conventions,
      ['tsconfig.json', '.gitignore', '.editorconfig', '.prettierrc', 'eslint.config.js', '.eslintrc.json', '.eslintrc.js', 'Dockerfile', 'docker-compose.yml', 'Makefile'],
      [conventions],
    );
  }

  const productCapabilities = buildProductCapabilitiesSummary(readme, manifest, projectType);
  if (productCapabilities) {
    pushEntry(
      'domain/product-capabilities.md',
      'Product Capabilities',
      ['import', 'product', 'capabilities'],
      productCapabilities,
      [readme?.path ?? 'README.md', manifest?.path ?? 'package.json'],
      [projectType, readme?.content, manifest?.content, productCapabilities],
    );
  }

  const architectureDoc = scanned.get('docs/architecture.md');
  const architectureSummary = buildSectionSummary(
    'Runtime & Surface Architecture',
    'docs/architecture.md',
    architectureDoc?.content,
    ['System Diagram', 'Activation Flow', 'CLI Flow', 'Core Services', 'Data Flow', 'Security Boundaries', 'Quality Gates'],
  );
  if (architectureSummary) {
    pushEntry(
      'architecture/runtime-and-surfaces.md',
      'Runtime & Surface Architecture',
      ['import', 'architecture', 'runtime'],
      architectureSummary,
      ['docs/architecture.md'],
      [architectureDoc?.content, architectureSummary],
    );
  }

  const routingDoc = scanned.get('docs/model-routing.md');
  const routingSummary = buildSectionSummary(
    'Model Routing Summary',
    'docs/model-routing.md',
    routingDoc?.content,
    ['Overview', 'Routing Inputs', 'Task Profiles', 'Selection Algorithm', 'Supported Providers', 'Cost Estimation'],
  );
  if (routingSummary) {
    pushEntry(
      'architecture/model-routing.md',
      'Model Routing Summary',
      ['import', 'architecture', 'routing'],
      routingSummary,
      ['docs/model-routing.md'],
      [routingDoc?.content, routingSummary],
    );
  }

  const agentsDoc = scanned.get('docs/agents-and-skills.md');
  const agentsSummary = buildSectionSummary(
    'Agents & Skills Summary',
    'docs/agents-and-skills.md',
    agentsDoc?.content,
    ['Agents', 'Ephemeral Sub-Agents (Project Execution)', 'Skills', 'Skill Assignment', 'Security Scanning', 'Built-in Skills', 'MCP-Sourced Skills'],
  );
  if (agentsSummary) {
    pushEntry(
      'architecture/agents-and-skills.md',
      'Agents & Skills Summary',
      ['import', 'architecture', 'agents', 'skills'],
      agentsSummary,
      ['docs/agents-and-skills.md'],
      [agentsDoc?.content, agentsSummary],
    );
  }

  const developmentWorkflow = buildOperationsSummary(scanned);
  if (developmentWorkflow) {
    pushEntry(
      'operations/development-workflow.md',
      'Development Workflow',
      ['import', 'operations', 'workflow'],
      developmentWorkflow,
      ['docs/development.md', 'docs/github-workflow.md'],
      [scanned.get('docs/development.md')?.content, scanned.get('docs/github-workflow.md')?.content, developmentWorkflow],
    );
  }

  const configurationSummary = buildSectionSummary(
    'Configuration Reference Summary',
    'docs/configuration.md',
    scanned.get('docs/configuration.md')?.content,
    ['Model Routing', 'SSOT Memory', 'Sidebar UI', 'Tool Safety & Chat Context', 'Project Execution (`/project`)', 'Tool Webhooks', 'Orchestrator Tunables', 'Budget', 'Experimental', 'Voice', 'API Keys'],
  );
  if (configurationSummary) {
    pushEntry(
      'operations/configuration-reference.md',
      'Configuration Reference Summary',
      ['import', 'operations', 'configuration'],
      configurationSummary,
      ['docs/configuration.md'],
      [scanned.get('docs/configuration.md')?.content, configurationSummary],
    );
  }

  const safetySummary = buildSafetySummary(scanned);
  if (safetySummary) {
    pushEntry(
      'operations/security-and-safety.md',
      'Security & Safety Summary',
      ['import', 'operations', 'security', 'safety'],
      safetySummary,
      ['SECURITY.md', 'docs/architecture.md', '.github/copilot-instructions.md'],
      [scanned.get('SECURITY.md')?.content, scanned.get('docs/architecture.md')?.content, scanned.get('.github/copilot-instructions.md')?.content, safetySummary],
    );
  }

  const governanceSummary = buildGovernanceSummary(scanned);
  if (governanceSummary) {
    pushEntry(
      'decisions/development-guardrails.md',
      'Development Guardrails',
      ['import', 'decisions', 'governance'],
      governanceSummary,
      ['.github/copilot-instructions.md', 'docs/github-workflow.md'],
      [scanned.get('.github/copilot-instructions.md')?.content, scanned.get('docs/github-workflow.md')?.content, governanceSummary],
    );
  }

  const releaseSummary = buildReleaseSummary(scanned.get('CHANGELOG.md')?.content, manifest);
  if (releaseSummary) {
    pushEntry(
      'roadmap/release-history.md',
      'Release History Snapshot',
      ['import', 'roadmap', 'release'],
      releaseSummary,
      ['CHANGELOG.md', manifest?.path ?? 'package.json'],
      [scanned.get('CHANGELOG.md')?.content, manifest?.content, releaseSummary],
    );
  }

  const licenseFile = findFirstByCategory(scanned, 'license');
  if (licenseFile) {
    const licenseType = detectLicenseType(licenseFile.content);
    const licenseContent = `# Project License\n\nDetected license: **${licenseType}**\n\nSource: \`${licenseFile.path}\`\n`;
    pushEntry(
      'domain/license.md',
      'Project License',
      ['import', 'license'],
      licenseContent,
      [licenseFile.path],
      [licenseFile.path, licenseFile.content, licenseType],
    );
  }

  return {
    now,
    ssotRoot,
    scanned,
    projectType,
    entries,
    readme,
    architectureDoc,
  };
}

async function scanImportFiles(workspaceRoot: vscode.Uri): Promise<Map<string, ScannedImportFile>> {
  const scanned = new Map<string, ScannedImportFile>();

  for (const spec of IMPORT_SCAN_FILES) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, spec.path);
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(bytes).toString('utf-8').slice(0, MAX_IMPORT_FILE_BYTES);
      scanned.set(spec.path, { path: spec.path, content, category: spec.category });
    } catch {
      // File doesn't exist — skip
    }
  }

  return scanned;
}

async function getTopLevelDirectoryListing(workspaceRoot: vscode.Uri): Promise<string> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
    return entries
      .map(([name, type]) => type === vscode.FileType.Directory ? `${name}/` : name)
      .sort()
      .join('\n');
  } catch {
    return '';
  }
}

function isTextLikeFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md')
    || lower.endsWith('.txt')
    || lower.endsWith('.json')
    || lower.endsWith('.yml')
    || lower.endsWith('.yaml');
}

async function collectImportedEntryMetadata(ssotRoot: vscode.Uri): Promise<ImportEntryMetadata[]> {
  const metadata: ImportEntryMetadata[] = [];
  await walkImportedEntryMetadata(ssotRoot, metadata);
  return metadata;
}

async function walkImportedEntryMetadata(root: vscode.Uri, metadata: ImportEntryMetadata[]): Promise<void> {
  let children: [string, vscode.FileType][];
  try {
    children = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return;
  }

  for (const [name, type] of children) {
    if (name === '.gitkeep') {
      continue;
    }

    const childUri = vscode.Uri.joinPath(root, name);
    if (type === vscode.FileType.Directory) {
      await walkImportedEntryMetadata(childUri, metadata);
      continue;
    }

    if (type !== vscode.FileType.File || !isTextLikeFile(name)) {
      continue;
    }

    const content = await tryReadTextFile(childUri);
    const parsed = parseImportMetadata(content);
    if (parsed) {
      metadata.push(parsed);
    }
  }
}

// ── Import helpers ────────────────────────────────────────────

function findFirstByCategory(
  scanned: Map<string, ScannedImportFile>,
  category: string,
): { path: string; content: string } | undefined {
  for (const [path, info] of scanned) {
    if (info.category === category) {
      return { path, content: info.content };
    }
  }
  return undefined;
}

function detectProjectType(scanned: Map<string, ScannedImportFile>): string | undefined {
  const pkg = scanned.get('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content);
      if (parsed.contributes || parsed.engines?.vscode) { return 'VS Code Extension'; }
      if (parsed.bin) { return 'CLI Tool'; }
      if (parsed.main && !parsed.dependencies?.['express'] && !parsed.dependencies?.['next'] && !parsed.dependencies?.['react']) {
        return 'Library';
      }
      if (parsed.dependencies?.['next'] || parsed.dependencies?.['react'] || parsed.dependencies?.['vue'] || parsed.dependencies?.['angular']) {
        return 'Web App';
      }
      if (parsed.dependencies?.['express'] || parsed.dependencies?.['fastify'] || parsed.dependencies?.['koa']) {
        return 'API Server';
      }
    } catch { /* not valid JSON; continue */ }
  }
  if (scanned.has('Cargo.toml')) { return 'Rust Project'; }
  if (scanned.has('pyproject.toml')) { return 'Python Project'; }
  if (scanned.has('go.mod')) { return 'Go Project'; }
  if (scanned.has('pom.xml') || scanned.has('build.gradle')) { return 'Java Project'; }
  if (scanned.has('Gemfile')) { return 'Ruby Project'; }
  if (scanned.has('composer.json')) { return 'PHP Project'; }
  return undefined;
}

function detectEcosystem(manifestPath: string): string {
  if (manifestPath === 'package.json') { return 'node'; }
  if (manifestPath === 'Cargo.toml') { return 'rust'; }
  if (manifestPath === 'pyproject.toml') { return 'python'; }
  if (manifestPath === 'go.mod') { return 'go'; }
  if (manifestPath === 'pom.xml' || manifestPath === 'build.gradle') { return 'java'; }
  if (manifestPath === 'Gemfile') { return 'ruby'; }
  if (manifestPath === 'composer.json') { return 'php'; }
  return 'other';
}

function extractDependencySummary(manifestPath: string, content: string): string {
  if (manifestPath === 'package.json') {
    return extractNpmDependencies(content);
  }
  // For non-JSON manifests, return the raw content with a header
  const ecosystem = detectEcosystem(manifestPath);
  return `# Dependencies (${ecosystem})\n\nSource: \`${manifestPath}\`\n\n\`\`\`\n${truncate(content, 2500)}\n\`\`\`\n`;
}

function extractNpmDependencies(content: string): string {
  try {
    const pkg = JSON.parse(content);
    const lines: string[] = ['# Dependencies (node)', ''];
    if (pkg.name) { lines.push(`**Package**: ${pkg.name}`); }
    if (pkg.version) { lines.push(`**Version**: ${pkg.version}`); }
    if (pkg.description) { lines.push(`**Description**: ${pkg.description}`); }
    lines.push('');

    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    const depKeys = Object.keys(deps);
    const devKeys = Object.keys(devDeps);

    if (depKeys.length > 0) {
      lines.push(`## Dependencies (${depKeys.length})`);
      for (const key of depKeys) { lines.push(`- ${key}: ${deps[key]}`); }
      lines.push('');
    }
    if (devKeys.length > 0) {
      lines.push(`## Dev Dependencies (${devKeys.length})`);
      for (const key of devKeys) { lines.push(`- ${key}: ${devDeps[key]}`); }
      lines.push('');
    }

    const scripts = pkg.scripts ?? {};
    const scriptKeys = Object.keys(scripts);
    if (scriptKeys.length > 0) {
      lines.push(`## NPM Scripts (${scriptKeys.length})`);
      for (const key of scriptKeys) { lines.push(`- \`${key}\`: \`${scripts[key]}\``); }
      lines.push('');
    }

    return lines.join('\n');
  } catch {
    return `# Dependencies (node)\n\n\`\`\`json\n${truncate(content, 2500)}\n\`\`\`\n`;
  }
}

function buildConventionsSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const lines: string[] = ['# Build & Tooling Conventions', ''];
  let hasAny = false;

  const tsconfig = scanned.get('tsconfig.json');
  if (tsconfig) {
    hasAny = true;
    lines.push('## TypeScript');
    try {
      const parsed = JSON.parse(tsconfig.content);
      const co = parsed.compilerOptions ?? {};
      if (co.target) { lines.push(`- Target: ${co.target}`); }
      if (co.module) { lines.push(`- Module: ${co.module}`); }
      if (co.strict !== undefined) { lines.push(`- Strict: ${co.strict}`); }
      if (co.outDir) { lines.push(`- OutDir: ${co.outDir}`); }
    } catch {
      lines.push('- tsconfig.json present (could not parse)');
    }
    lines.push('');
  }

  for (const eslintFile of ['.eslintrc.json', '.eslintrc.js', 'eslint.config.js']) {
    if (scanned.has(eslintFile)) {
      hasAny = true;
      lines.push(`## Linting\n- ESLint config: \`${eslintFile}\``);
      lines.push('');
      break;
    }
  }

  if (scanned.has('.prettierrc')) {
    hasAny = true;
    lines.push('## Formatting\n- Prettier config: `.prettierrc`');
    lines.push('');
  }

  if (scanned.has('.editorconfig')) {
    hasAny = true;
    lines.push('## Editor Config\n- `.editorconfig` present');
    lines.push('');
  }

  if (scanned.has('Dockerfile') || scanned.has('docker-compose.yml')) {
    hasAny = true;
    lines.push('## Containers');
    if (scanned.has('Dockerfile')) { lines.push('- `Dockerfile` present'); }
    if (scanned.has('docker-compose.yml')) { lines.push('- `docker-compose.yml` present'); }
    lines.push('');
  }

  if (scanned.has('Makefile')) {
    hasAny = true;
    lines.push('## Build System\n- `Makefile` present');
    lines.push('');
  }

  const gitignore = scanned.get('.gitignore');
  if (gitignore) {
    hasAny = true;
    const ignoreEntries = gitignore.content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .slice(0, 20);
    lines.push('## Git Ignore (top entries)');
    for (const entry of ignoreEntries) { lines.push(`- ${entry.trim()}`); }
    lines.push('');
  }

  return hasAny ? lines.join('\n') : undefined;
}

function detectLicenseType(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('mit license') || lower.includes('permission is hereby granted, free of charge')) { return 'MIT'; }
  if (lower.includes('apache license') && lower.includes('version 2.0')) { return 'Apache-2.0'; }
  if (lower.includes('gnu general public license') && lower.includes('version 3')) { return 'GPL-3.0'; }
  if (lower.includes('gnu general public license') && lower.includes('version 2')) { return 'GPL-2.0'; }
  if (lower.includes('bsd 2-clause')) { return 'BSD-2-Clause'; }
  if (lower.includes('bsd 3-clause')) { return 'BSD-3-Clause'; }
  if (lower.includes('isc license')) { return 'ISC'; }
  if (lower.includes('mozilla public license')) { return 'MPL-2.0'; }
  if (lower.includes('unlicense')) { return 'Unlicense'; }
  return 'Unknown';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) { return text; }
  return text.slice(0, maxLen) + '\n…(truncated)';
}

async function ensureSsotStructure(ssotRoot: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(ssotRoot);

  for (const entry of SSOT_FOLDERS) {
    if (entry.endsWith('.md')) {
      const fileUri = vscode.Uri.joinPath(ssotRoot, entry);
      if (!(await pathExists(fileUri))) {
        await ensureParentDirectory(fileUri, ssotRoot);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(getStarterContent(entry), 'utf-8'));
      }
      continue;
    }

    const dirUri = vscode.Uri.joinPath(ssotRoot, entry);
    await vscode.workspace.fs.createDirectory(dirUri);
    const keepUri = vscode.Uri.joinPath(dirUri, '.gitkeep');
    if (!(await pathExists(keepUri))) {
      await vscode.workspace.fs.writeFile(keepUri, new Uint8Array());
    }
  }
}

async function countSsotFiles(root: vscode.Uri): Promise<number> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    let total = 0;
    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        total += await countSsotFiles(vscode.Uri.joinPath(root, name));
      } else if (name !== '.gitkeep') {
        total += 1;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

async function tryReadTextFile(fileUri: vscode.Uri): Promise<string | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return undefined;
  }
}

function appendImportMetadata(content: string, metadata: ImportEntryMetadata): string {
  const metadataLines = [
    '<!-- atlasmind-import',
    `entry-path: ${metadata.entryPath}`,
    `generator-version: ${metadata.generatorVersion}`,
    `generated-at: ${metadata.generatedAt}`,
    `source-paths: ${metadata.sourcePaths.join(' | ')}`,
    `source-fingerprint: ${metadata.sourceFingerprint}`,
    `body-fingerprint: ${metadata.bodyFingerprint}`,
    '-->',
  ];
  return `${stripImportMetadata(content).trimEnd()}\n\n${metadataLines.join('\n')}\n`;
}

function getImportBodyFingerprint(content: string): string {
  return hashImportValue([stripImportMetadata(content).trimEnd()]);
}

function parseImportMetadata(content: string | undefined): ImportEntryMetadata | undefined {
  if (!content) {
    return undefined;
  }

  const match = /<!-- atlasmind-import\n([\s\S]*?)\n-->\s*$/u.exec(content);
  if (!match) {
    return undefined;
  }

  const metadata = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }
    metadata.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  const entryPath = metadata.get('entry-path');
  const generatorVersion = Number.parseInt(metadata.get('generator-version') ?? '', 10);
  const generatedAt = metadata.get('generated-at');
  const sourceFingerprint = metadata.get('source-fingerprint');
  const bodyFingerprint = metadata.get('body-fingerprint');
  if (!entryPath || !Number.isFinite(generatorVersion) || !generatedAt || !sourceFingerprint || !bodyFingerprint) {
    return undefined;
  }

  return {
    entryPath,
    generatorVersion,
    generatedAt,
    sourcePaths: (metadata.get('source-paths') ?? '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean),
    sourceFingerprint,
    bodyFingerprint,
  };
}

function stripImportMetadata(content: string): string {
  return content.replace(/\n?<!-- atlasmind-import\n[\s\S]*?\n-->\s*$/u, '').trimEnd();
}

function hashImportValue(parts: string[]): string {
  let hash = 2166136261;
  const source = parts.join('\u241F');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function purgeProjectMemory(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
): Promise<{ ssotPath: string; removedFiles: number }> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    throw new Error('AtlasMind SSOT path must be a safe relative path inside the workspace.');
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);
  const removedFiles = await countSsotFiles(ssotRoot);
  if (await pathExists(ssotRoot)) {
    await vscode.workspace.fs.delete(ssotRoot, { recursive: true, useTrash: false });
  }

  await ensureSsotStructure(ssotRoot);
  await atlas.memoryManager.loadFromDisk(ssotRoot);
  atlas.memoryRefresh.fire();

  return { ssotPath: ssotRelPath, removedFiles };
}

async function buildFocusedDirectoryMap(workspaceRoot: vscode.Uri): Promise<string | undefined> {
  const focusDirectories = ['src', 'tests', 'docs', 'wiki', 'project_memory', '.github'];
  const lines: string[] = ['# Codebase Map', '', 'Focused recursive directory view captured during import.', ''];
  let hasAny = false;

  for (const directory of focusDirectories) {
    const childUri = vscode.Uri.joinPath(workspaceRoot, directory);
    const section = await renderDirectoryTree(childUri, directory, 0, 2);
    if (!section) {
      continue;
    }
    hasAny = true;
    lines.push(`## ${directory}`);
    lines.push('```text');
    lines.push(section);
    lines.push('```');
    lines.push('');
  }

  return hasAny ? lines.join('\n') : undefined;
}

async function renderDirectoryTree(
  root: vscode.Uri,
  label: string,
  depth: number,
  maxDepth: number,
): Promise<string | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(root);
    if (entries.length === 0) {
      return undefined;
    }
    const lines: string[] = [label.endsWith('/') ? label : `${label}/`];
    const sorted = [...entries].sort(([aName, aType], [bName, bType]) => {
      if (aType !== bType) {
        return aType === vscode.FileType.Directory ? -1 : 1;
      }
      return aName.localeCompare(bName);
    });
    const limited = sorted.slice(0, 20);

    for (const [name, type] of limited) {
      const indent = '  '.repeat(depth + 1);
      const isDirectory = type === vscode.FileType.Directory;
      lines.push(`${indent}${isDirectory ? `${name}/` : name}`);
      if (isDirectory && depth + 1 < maxDepth) {
        const nested = await renderDirectoryTree(vscode.Uri.joinPath(root, name), name, depth + 1, maxDepth);
        if (nested) {
          const nestedLines = nested.split('\n').slice(1);
          for (const nestedLine of nestedLines) {
            lines.push(nestedLine);
          }
        }
      }
    }

    if (sorted.length > limited.length) {
      lines.push(`${'  '.repeat(depth + 1)}... (${sorted.length - limited.length} more entries)`);
    }

    return lines.join('\n');
  } catch {
    return undefined;
  }
}

function buildProductCapabilitiesSummary(
  readme: { path: string; content: string } | undefined,
  manifest: { path: string; content: string } | undefined,
  projectType: string | undefined,
): string | undefined {
  const lines: string[] = ['# Product Capabilities', ''];
  let hasAny = false;

  if (projectType) {
    hasAny = true;
    lines.push(`Project type: **${projectType}**.`);
    lines.push('');
  }

  if (readme) {
    hasAny = true;
    const whatIsAtlas = extractMarkdownSections(readme.content, ['What is AtlasMind?', 'Core Workflows', 'Configuration']);
    lines.push(`Imported from \`${readme.path}\`.`);
    lines.push('');
    lines.push(whatIsAtlas || truncate(readme.content, 2_500));
    lines.push('');
  }

  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content);
      const slashCommands = parsed.contributes?.chatParticipants?.[0]?.commands ?? [];
      const extensionCommands = parsed.contributes?.commands ?? [];
      const features: string[] = [];
      for (const command of slashCommands) {
        if (typeof command?.name === 'string') {
          features.push(`- /${command.name}`);
        }
      }
      if (features.length > 0) {
        hasAny = true;
        lines.push('## Slash Commands');
        lines.push(...features);
        lines.push('');
      }
      if (extensionCommands.length > 0) {
        hasAny = true;
        lines.push(`## Extension Commands\n- ${extensionCommands.length} commands contributed through package.json.`);
        lines.push('');
      }
    } catch {
      // Ignore parse failures.
    }
  }

  return hasAny ? lines.join('\n') : undefined;
}

function buildSectionSummary(
  title: string,
  sourcePath: string,
  content: string | undefined,
  headings: string[],
): string | undefined {
  if (!content) {
    return undefined;
  }

  const extracted = extractMarkdownSections(content, headings);
  const body = extracted || truncate(content, 3_000);
  return `# ${title}\n\nSource: \`${sourcePath}\`\n\n${body}`;
}

function buildOperationsSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const development = scanned.get('docs/development.md')?.content;
  const workflow = scanned.get('docs/github-workflow.md')?.content;
  if (!development && !workflow) {
    return undefined;
  }

  const parts = ['# Development Workflow', ''];
  if (development) {
    parts.push('## Build, Test, And Local Development');
    parts.push(extractMarkdownSections(development, ['Prerequisites', 'Setup', 'Build', 'CLI', 'Run', 'Package And Publish', 'Lint', 'Test', 'Versioning Workflow']) || truncate(development, 2_500));
    parts.push('');
  }
  if (workflow) {
    parts.push('## GitHub Workflow Standards');
    parts.push(extractMarkdownSections(workflow, ['Goals', 'Branch Strategy', 'Pull Request Workflow', 'Release Flow', 'Release Hygiene']) || truncate(workflow, 2_000));
    parts.push('');
  }
  return parts.join('\n');
}

function buildSafetySummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const architecture = scanned.get('docs/architecture.md')?.content;
  const security = scanned.get('SECURITY.md')?.content;
  const governance = scanned.get('.github/copilot-instructions.md')?.content;
  if (!architecture && !security && !governance) {
    return undefined;
  }

  const parts = ['# Security & Safety Summary', ''];
  if (governance) {
    parts.push('## Guardrail Principles');
    parts.push(extractBulletsFromSection(governance, 'Safety-First Principle') || truncate(governance, 1_500));
    parts.push('');
  }
  if (architecture) {
    parts.push('## Runtime Boundaries');
    parts.push(extractMarkdownSections(architecture, ['Security Boundaries', 'Quality Gates']) || truncate(architecture, 1_800));
    parts.push('');
  }
  if (security) {
    parts.push('## Repository Security Policy');
    parts.push(truncate(security, 1_800));
    parts.push('');
  }
  return parts.join('\n');
}

function buildGovernanceSummary(scanned: Map<string, ScannedImportFile>): string | undefined {
  const governance = scanned.get('.github/copilot-instructions.md')?.content;
  const workflow = scanned.get('docs/github-workflow.md')?.content;
  if (!governance && !workflow) {
    return undefined;
  }

  const parts = ['# Development Guardrails', ''];
  if (governance) {
    parts.push('## Repository Rules');
    parts.push(extractMarkdownSections(governance, ['Critical Rules', 'Safety-First Principle', 'Documentation Maintenance', 'Version Tracking', 'Coding Standards', 'Security', 'Commits']) || truncate(governance, 2_200));
    parts.push('');
  }
  if (workflow) {
    parts.push('## Branch And Release Policy');
    parts.push(extractMarkdownSections(workflow, ['Branch Strategy', 'Pull Request Workflow', 'Release Flow', 'Release Hygiene']) || truncate(workflow, 1_600));
    parts.push('');
  }
  return parts.join('\n');
}

function buildReleaseSummary(changelog: string | undefined, manifest: { path: string; content: string } | undefined): string | undefined {
  if (!changelog && !manifest) {
    return undefined;
  }

  const parts = ['# Release History Snapshot', ''];
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest.content);
      if (typeof parsed.version === 'string') {
        parts.push(`Current manifest version: **${parsed.version}**.`);
        parts.push('');
      }
    } catch {
      // Ignore parse failures.
    }
  }
  if (changelog) {
    parts.push(truncate(changelog, 3_000));
  }
  return parts.join('\n');
}

function buildImportCatalog(entries: ImportEntryProcessingResult[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines = ['# Import Catalog', '', '## Generated Entries'];
  for (const entry of entries) {
    const sourceLabel = entry.sourcePaths.length > 0 ? ` (sources: ${entry.sourcePaths.join(', ')})` : '';
    lines.push(`- \`${entry.path}\` — ${entry.title} [${entry.status}]${sourceLabel}`);
  }
  lines.push('');
  lines.push('This file is generated by `/import` so operators can see which structured memory artifacts were created, refreshed, preserved, or skipped for the current workspace.');
  return lines.join('\n');
}

function buildImportFreshnessReport(entries: ImportEntryProcessingResult[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  const lines = [
    '# Import Freshness Report',
    '',
    '## Status Legend',
    '- `created` — new import artifact generated this run.',
    '- `refreshed` — source content changed and the generated memory was updated.',
    '- `unchanged` — source fingerprint matched the last generated version, so the file was left untouched.',
    '- `preserved-manual-edits` — AtlasMind detected local edits in a generated file and skipped overwriting it.',
    '- `rejected` — the candidate was not written because memory validation rejected it.',
    '',
    '## Entries',
  ];

  for (const entry of entries) {
    lines.push(`### ${entry.title}`);
    lines.push(`- Path: \`${entry.path}\``);
    lines.push(`- Status: \`${entry.status}\``);
    lines.push(`- Source fingerprint: \`${entry.sourceFingerprint}\``);
    if (entry.sourcePaths.length > 0) {
      lines.push(`- Sources: ${entry.sourcePaths.join(', ')}`);
    }
    if (entry.reason) {
      lines.push(`- Note: ${entry.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function shouldRefreshProjectSoul(existing: string): boolean {
  return existing.includes('<!-- Describe the high-level goal of this project -->')
    || existing.includes('<!-- Link to decisions/ folder entries -->')
    || existing.includes('{{PROJECT_TYPE}}');
}

function buildProjectSoul(
  existing: string,
  context: { projectType: string | undefined; readme?: string; architectureDoc?: string; governanceDoc?: string },
): string {
  const projectType = context.projectType ?? 'Unknown';
  const visionSource = extractMarkdownSections(context.readme ?? '', ['What is AtlasMind?']);
  const vision = firstMeaningfulParagraph(visionSource || context.readme || '');
  const principles = extractBulletsFromSection(context.governanceDoc ?? '', 'Safety-First Principle');

  return [
    '# Project Soul',
    '',
    '> This file is the living identity of the project.',
    '',
    '## Project Type',
    projectType,
    '',
    '## Vision',
    vision || 'Maintain a developer-centric multi-agent orchestrator that routes work safely across models, preserves long-term project memory, and makes autonomous execution reviewable inside VS Code.',
    '',
    '## Principles',
    principles || '- Default to the safest reasonable behavior.\n- Keep project knowledge structured, current, and reviewable.\n- Prefer explicit approvals and traceable automation for risky work.\n- Treat documentation, versioning, and release hygiene as part of correctness.',
    '',
    '## Key Decisions',
    '- Safety and security regressions are correctness bugs, not polish work.',
    '- Long-term project context belongs in the SSOT under `project_memory/`.',
    '- Provider credentials live in SecretStorage, not in project memory or source.',
    '- `develop` is the routine integration branch and `master` is the protected release-ready branch.',
    '- See `decisions/development-guardrails.md`, `operations/security-and-safety.md`, and `architecture/runtime-and-surfaces.md` for supporting detail.',
    '',
    '## Imported References',
    '- architecture/project-overview.md',
    '- architecture/runtime-and-surfaces.md',
    '- architecture/model-routing.md',
    '- architecture/agents-and-skills.md',
    '- operations/development-workflow.md',
    '- decisions/development-guardrails.md',
  ].join('\n');
}

function extractMarkdownSections(content: string, wantedHeadings: string[]): string | undefined {
  if (!content.trim()) {
    return undefined;
  }

  const headingLookup = new Set(wantedHeadings.map(heading => heading.toLowerCase()));
  const lines = content.split(/\r?\n/);
  const collected: string[] = [];
  let activeHeading: string | undefined;
  let activeLevel = 0;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();
      const normalized = heading.toLowerCase();

      if (activeHeading && level <= activeLevel) {
        activeHeading = undefined;
        activeLevel = 0;
      }

      if (headingLookup.has(normalized)) {
        activeHeading = heading;
        activeLevel = level;
        collected.push(line);
        continue;
      }
    }

    if (activeHeading) {
      collected.push(line);
    }
  }

  const output = collected.join('\n').trim();
  return output.length > 0 ? truncate(output, 3_000) : undefined;
}

function extractBulletsFromSection(content: string, sectionHeading: string): string | undefined {
  const section = extractMarkdownSections(content, [sectionHeading]);
  if (!section) {
    return undefined;
  }
  const bullets = section
    .split(/\r?\n/)
    .filter(line => /^-\s+/.test(line.trim()))
    .join('\n');
  return bullets.length > 0 ? bullets : undefined;
}

function firstMeaningfulParagraph(content: string): string | undefined {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0 && !paragraph.startsWith('#') && !paragraph.startsWith('<'));
  return paragraphs[0];
}

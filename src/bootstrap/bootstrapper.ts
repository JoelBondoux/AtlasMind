import * as vscode from 'vscode';
import { SSOT_FOLDERS } from '../types.js';
import type { AtlasMindContext } from '../extension.js';

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
  await vscode.workspace.fs.createDirectory(ssotRoot);

  for (const entry of SSOT_FOLDERS) {
    if (entry.endsWith('.md')) {
      // It's a file – create with starter content
      const fileUri = vscode.Uri.joinPath(ssotRoot, entry);
      const content = getStarterContent(entry);
      if (!(await pathExists(fileUri))) {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
      }
    } else {
      // It's a directory – create with a .gitkeep
      const dirUri = vscode.Uri.joinPath(ssotRoot, entry);
      await vscode.workspace.fs.createDirectory(dirUri);
      const keepUri = vscode.Uri.joinPath(dirUri, '.gitkeep');
      if (!(await pathExists(keepUri))) {
        await vscode.workspace.fs.writeFile(keepUri, new Uint8Array());
      }
    }
  }

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
    placeHolder: 'Scaffold GitHub workflow baseline (CI, templates, CODEOWNERS, extension recommendations)?',
  });

  if (scaffoldGovernance === 'Yes') {
    await scaffoldGovernanceBaseline(workspaceRoot);
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

async function scaffoldGovernanceBaseline(workspaceRoot: vscode.Uri): Promise<void> {
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
        '    "github.copilot",',
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

  for (const file of files) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, ...file.path.split('/'));
    await ensureParentDirectory(fileUri, workspaceRoot);
    if (!(await pathExists(fileUri))) {
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'utf-8'));
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

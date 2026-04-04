import * as vscode from 'vscode';
import { SSOT_FOLDERS } from '../types.js';
import type { AtlasMindContext } from '../extension.js';
import type { MemoryEntry } from '../types.js';

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

// ── Project Import ──────────────────────────────────────────

/** Well-known project files to scan during import, grouped by purpose. */
const IMPORT_SCAN_FILES: ReadonlyArray<{ path: string; category: 'manifest' | 'readme' | 'config' | 'license' }> = [
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
];

import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_SNIPPET } from '../constants.js';

export interface ImportResult {
  entriesCreated: number;
  entriesSkipped: number;
  projectType: string | undefined;
}

/**
 * Import an existing project into AtlasMind by scanning workspace files
 * and populating the SSOT memory with project metadata, architecture,
 * dependencies, and conventions.
 */
export async function importProject(
  workspaceRoot: vscode.Uri,
  atlas: AtlasMindContext,
): Promise<ImportResult> {
  const config = vscode.workspace.getConfiguration('atlasmind');
  const ssotRelPath = getValidatedSsotPath(config.get<string>('ssotPath', 'project_memory'));
  if (!ssotRelPath) {
    vscode.window.showErrorMessage('AtlasMind SSOT path must be a safe relative path inside the workspace.');
    return { entriesCreated: 0, entriesSkipped: 0, projectType: undefined };
  }

  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);

  // ── Ensure SSOT folder structure exists ─────────────────────
  await vscode.workspace.fs.createDirectory(ssotRoot);
  for (const entry of SSOT_FOLDERS) {
    if (entry.endsWith('.md')) {
      const fileUri = vscode.Uri.joinPath(ssotRoot, entry);
      if (!(await pathExists(fileUri))) {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(getStarterContent(entry), 'utf-8'));
      }
    } else {
      const dirUri = vscode.Uri.joinPath(ssotRoot, entry);
      await vscode.workspace.fs.createDirectory(dirUri);
      const keepUri = vscode.Uri.joinPath(dirUri, '.gitkeep');
      if (!(await pathExists(keepUri))) {
        await vscode.workspace.fs.writeFile(keepUri, new Uint8Array());
      }
    }
  }

  // ── Scan project files ──────────────────────────────────────
  const scanned = new Map<string, { content: string; category: string }>();

  for (const spec of IMPORT_SCAN_FILES) {
    const fileUri = vscode.Uri.joinPath(workspaceRoot, spec.path);
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(bytes).toString('utf-8').slice(0, MAX_IMPORT_FILE_BYTES);
      scanned.set(spec.path, { content, category: spec.category });
    } catch {
      // File doesn't exist — skip
    }
  }

  // ── Scan top-level directory structure ──────────────────────
  let directoryListing = '';
  try {
    const entries = await vscode.workspace.fs.readDirectory(workspaceRoot);
    const sorted = entries
      .map(([name, type]) => type === vscode.FileType.Directory ? `${name}/` : name)
      .sort();
    directoryListing = sorted.join('\n');
  } catch {
    // Non-fatal
  }

  // ── Detect project type ─────────────────────────────────────
  const projectType = detectProjectType(scanned);

  // ── Build memory entries ────────────────────────────────────
  const now = new Date().toISOString();
  const entries: Array<{ entry: MemoryEntry; content: string }> = [];

  // 1. Project overview from README
  const readme = findFirstByCategory(scanned, 'readme');
  if (readme) {
    entries.push({
      entry: {
        path: 'architecture/project-overview.md',
        title: 'Project Overview',
        tags: ['import', 'overview', 'readme'],
        lastModified: now,
        snippet: truncate(readme.content, MAX_IMPORT_SNIPPET),
      },
      content: readme.content,
    });
  }

  // 2. Dependencies and manifest
  const manifest = findFirstByCategory(scanned, 'manifest');
  if (manifest) {
    const depSummary = extractDependencySummary(manifest.path, manifest.content);
    entries.push({
      entry: {
        path: 'architecture/dependencies.md',
        title: 'Project Dependencies',
        tags: ['import', 'dependencies', detectEcosystem(manifest.path)],
        lastModified: now,
        snippet: truncate(depSummary, MAX_IMPORT_SNIPPET),
      },
      content: depSummary,
    });
  }

  // 3. Project structure
  if (directoryListing) {
    const structureContent = `# Project Structure\n\nTop-level contents of the workspace:\n\n\`\`\`\n${directoryListing}\n\`\`\`\n`;
    entries.push({
      entry: {
        path: 'architecture/project-structure.md',
        title: 'Project Structure',
        tags: ['import', 'structure', 'architecture'],
        lastModified: now,
        snippet: truncate(structureContent, MAX_IMPORT_SNIPPET),
      },
      content: structureContent,
    });
  }

  // 4. Build and tooling conventions
  const conventions = buildConventionsSummary(scanned);
  if (conventions) {
    entries.push({
      entry: {
        path: 'domain/conventions.md',
        title: 'Build & Tooling Conventions',
        tags: ['import', 'conventions', 'tooling'],
        lastModified: now,
        snippet: truncate(conventions, MAX_IMPORT_SNIPPET),
      },
      content: conventions,
    });
  }

  // 5. Project soul (update with detected type if template placeholder still present)
  const soulUri = vscode.Uri.joinPath(ssotRoot, 'project_soul.md');
  try {
    const existing = Buffer.from(await vscode.workspace.fs.readFile(soulUri)).toString('utf-8');
    if (existing.includes('{{PROJECT_TYPE}}') && projectType) {
      const updated = existing.replace('{{PROJECT_TYPE}}', projectType);
      await vscode.workspace.fs.writeFile(soulUri, Buffer.from(updated, 'utf-8'));
    }
  } catch {
    // Non-fatal
  }

  // 6. License info
  const licenseFile = findFirstByCategory(scanned, 'license');
  if (licenseFile) {
    const licenseType = detectLicenseType(licenseFile.content);
    entries.push({
      entry: {
        path: 'domain/license.md',
        title: 'Project License',
        tags: ['import', 'license'],
        lastModified: now,
        snippet: `License: ${licenseType}\n\nSource file: ${licenseFile.path}`,
      },
      content: `# Project License\n\nDetected license: **${licenseType}**\n\nSource: \`${licenseFile.path}\`\n`,
    });
  }

  // ── Upsert entries into memory ──────────────────────────────
  let created = 0;
  let skipped = 0;

  for (const { entry, content } of entries) {
    const result = atlas.memoryManager.upsert(entry, content);
    if (result.status === 'created' || result.status === 'updated') {
      created++;
    } else {
      skipped++;
    }
  }

  // ── Reload memory from disk to pick up any files already there ──
  const ssotUri = vscode.Uri.joinPath(
    workspaceRoot,
    config.get<string>('ssotPath', 'project_memory'),
  );
  await atlas.memoryManager.loadFromDisk(ssotUri);
  atlas.memoryRefresh.fire();

  return { entriesCreated: created, entriesSkipped: skipped, projectType };
}

// ── Import helpers ────────────────────────────────────────────

function findFirstByCategory(
  scanned: Map<string, { content: string; category: string }>,
  category: string,
): { path: string; content: string } | undefined {
  for (const [path, info] of scanned) {
    if (info.category === category) {
      return { path, content: info.content };
    }
  }
  return undefined;
}

function detectProjectType(scanned: Map<string, { content: string; category: string }>): string | undefined {
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

function buildConventionsSummary(scanned: Map<string, { content: string; category: string }>): string | undefined {
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

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

function getValidatedSsotPath(input: string): string | undefined {
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

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
  const ssotRelPath = config.get<string>('ssotPath', 'project_memory');
  const ssotRoot = vscode.Uri.joinPath(workspaceRoot, ssotRelPath);

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
  for (const entry of SSOT_FOLDERS) {
    if (entry.endsWith('.md')) {
      // It's a file – create with starter content
      const fileUri = vscode.Uri.joinPath(ssotRoot, entry);
      const content = getStarterContent(entry);
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
    } else {
      // It's a directory – create with a .gitkeep
      const dirUri = vscode.Uri.joinPath(ssotRoot, entry);
      const keepUri = vscode.Uri.joinPath(dirUri, '.gitkeep');
      await vscode.workspace.fs.writeFile(keepUri, new Uint8Array());
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

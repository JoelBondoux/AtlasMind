import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function migrateLegacySsotStructure(
  workspaceFolder: vscode.WorkspaceFolder,
  outputChannel: vscode.OutputChannel,
): Promise<void> {
  try {
    const ssotRootPath = path.join(workspaceFolder.uri.fsPath, 'project_memory');
    const newSrcPath = path.join(ssotRootPath, 'src');

    if (!(await pathExists(ssotRootPath)) || (await pathExists(newSrcPath))) {
      // If the base folder doesn't exist, or the new folder already exists, there's nothing to migrate.
      return;
    }

    outputChannel.appendLine('[migration] Legacy project_memory structure detected. Starting migration.');

    // Check if ssotRootPath is a directory
    const stats = await fs.stat(ssotRootPath);
    if (!stats.isDirectory()) {
        outputChannel.appendLine('[migration] project_memory is not a directory. Skipping migration.');
        return;
    }

    await fs.mkdir(newSrcPath, { recursive: true });

    const entries = await fs.readdir(ssotRootPath);
    for (const entry of entries) {
      if (entry === 'src') {
        continue;
      }
      const oldPath = path.join(ssotRootPath, entry);
      const newPath = path.join(newSrcPath, entry);
      await fs.rename(oldPath, newPath);
      outputChannel.appendLine(`[migration] Moved: ${oldPath} -> ${newPath}`);
    }

    outputChannel.appendLine('[migration] Migration completed successfully.');
    vscode.window.showInformationMessage('AtlasMind project memory structure has been updated.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[migration] Error during migration: ${message}`);
    vscode.window.showErrorMessage(`AtlasMind project memory migration failed. Check the output for details.`);
  }
}

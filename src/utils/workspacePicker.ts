import * as vscode from 'vscode';

/**
 * Select a workspace folder. Returns the first folder if there is only one,
 * or prompts the user to choose when multiple folders are open.
 *
 * Falls back to `workspaceFolders[0]` to keep behaviour backwards-compatible.
 */
export async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }

  return vscode.window.showWorkspaceFolderPick({
    placeHolder: 'Select the workspace folder to use for this operation',
  });
}
